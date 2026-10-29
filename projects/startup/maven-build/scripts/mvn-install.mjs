// startup 后端 Maven 构建包装脚本（startup 项目后端构建/依赖安装唯一入口）。
//
// 背景：根 pom.xml 声明双源——`public`(aliyun 公库) + `nexus-public`
// (https://10.1.98.21:60003/repository/maven-public/，内网 Nexus，自签证书，
// 仅 <repositories> 声明、releases only)。用户没有 ~/.m2/settings.xml，
// Maven 不走系统/环境代理（JVM 特性），所以本仓 Maven 的坑与前端 npm 不同：
//   1. 内网 Nexus 不在内网/VPN 时，aliyun 先 404 一轮、Nexus 再超时一轮，
//      整个构建挂很久才报错——本脚本安装前先对私库做 TCP 预检，不通快速失败；
//   2. 自签证书：若 JDK 未导入 Nexus 证书，构建报 PKIX/SSLHandshake——
//      本脚本检测到证书类失败后自动带 insecure 参数重试一次（仅本次进程生效，
//      不改 JDK cacerts / 不改 settings.xml）；
//   3. 非交互终端下 -ntp 屏蔽海量下载进度行，日志干净可读。
//
// 用法（专用脚本，默认面向 D:/code/startup，--root 可指向其他检出位置；任意 cwd 均可执行）：
//   node .zcode/skills/maven-build/scripts/mvn-install.mjs              # 根全量：mvn clean install -DskipTests
//   node .zcode/skills/maven-build/scripts/mvn-install.mjs admin        # startup-admin 及其依赖
//   node .zcode/skills/maven-build/scripts/mvn-install.mjs task         # 同理：common/database/admin/task/pub/idp/app
//   node .zcode/skills/maven-build/scripts/mvn-install.mjs -- -pl startup-database -am clean package
//                                                                       # “--”后原样透传 mvn
// 依赖：Node >= 20、Maven >= 3.8、JDK 17（与仓库现状一致）。
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error("[mvn:install] 需要 Node >= 20，当前 " + process.versions.node);
  process.exit(1);
}

// ---------- 0. 定位仓库根（专用脚本默认指向 startup 仓，--root 可覆盖） ----------
const argvAll = process.argv.slice(2);
let rootOverride = null;
const ri = argvAll.indexOf("--root");
if (ri >= 0) {
  rootOverride = argvAll[ri + 1];
  argvAll.splice(ri, 2);
}
const root = path.resolve(rootOverride ?? "D:/code/startup");
const argv = argvAll;
const pom = path.join(root, "pom.xml");
if (!fs.existsSync(pom)) {
  console.error(`[mvn:install] 找不到根 POM：${pom}，请用 --root <路径> 指定仓库位置`);
  process.exit(1);
}
const isWin = process.platform === "win32";
const mvnBin = isWin ? "mvn.cmd" : "mvn";
const shell = isWin; // Node 18.20+ 起 .cmd/.bat 必须经 shell 拉起
const log = (msg) => console.log(`[mvn:install] ${msg}`);

// ---------- 1. 解析根 POM 的仓库声明，区分公/私库 ----------
const pomText = fs.readFileSync(pom, "utf8");
const repoUrls = [...pomText.matchAll(/<(?:plugin)?[Rr]epository>\s*[\s\S]*?<url>([^<]+)<\/url>/g)]
  .map((m) => m[1].trim());
const PRIVATE_HOST_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/; // RFC1918 内网 IP 即私库
const privateRepos = [];
const publicRepos = [];
for (const u of repoUrls) {
  try {
    const h = new URL(u).hostname;
    (PRIVATE_HOST_RE.test(h) ? privateRepos : publicRepos).push(u.replace(/\/+$/, ""));
  } catch { /* 忽略非法项 */ }
}

// ---------- 2. registry 连通性 TCP 预检（只判主机可达，不看证书） ----------
function tcpProbe(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const socket = net.connect({ host: u.hostname, port: Number(u.port) || 443, timeout: 8000 });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
      socket.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

for (const r of privateRepos) {
  log(`预检私库 → ${r}`);
  if (await tcpProbe(r)) {
    log("  ✓ 私库可达");
    continue;
  }
  log("  ✗ 私库不可达：请确认在内网环境/已连 VPN（Maven 不走系统代理，与 npm 不同，开着代理也救不了内网连通性）。构建终止。");
  process.exit(1);
}
for (const r of publicRepos) {
  log(`预检公库 → ${r}`);
  if (await tcpProbe(r)) {
    log("  ✓ 公库可达");
  } else {
    log("  ! 公库不可达，本地仓库(~/.m2)已有依赖时仍可继续构建，但缺件会失败");
  }
}
if (!privateRepos.length) log("根 POM 未声明内网仓库，按普通构建处理");
if (/(-Dmaven\.proxy|<proxy)/i.test(process.env.MAVEN_ARGS ?? "") || /(http\.proxyHost|https\.proxyHost)/i.test(process.env.MAVEN_OPTS ?? "")) {
  log("! 检测到 MAVEN_ARGS/MAVEN_OPTS 配置了代理：内网 Nexus 走代理可能不通，失败时优先排查此项");
}

// ---------- 3. 组装 mvn 命令 ----------
// 模块简称 → 实际模块目录（与根 POM <modules> 一致）
const MODULES = {
  common: "startup-common",
  database: "startup-database",
  admin: "startup-admin",
  task: "startup-task",
  pub: "startup-pub",
  idp: "startup-idp",
  app: "startup-app",
};
const first = argv[0];
let mvnArgs;
if (first === "--") {
  mvnArgs = argv.slice(1); // 全自定义，原样透传
} else if (first && first.startsWith("-")) {
  mvnArgs = argv; // 选项开头也视为透传
} else if (first) {
  const mod = MODULES[first];
  if (!mod) {
    log(`未知模块简称「${first}」，可选：${Object.keys(MODULES).join(" / ")}；或用 "-- <mvn参数>" 透传`);
    process.exit(1);
  }
  mvnArgs = ["-pl", mod, "-am", "clean", "install", "-DskipTests"];
} else {
  mvnArgs = ["clean", "install", "-DskipTests"]; // 根全量（仓库默认不跑测试）
}

function runMvn(extraArgs = [], extraEnv = {}) {
  const args = ["-B", "-ntp", ...extraArgs, ...mvnArgs];
  log(`执行 mvn ${args.join(" ")} …`);
  const child = spawn(mvnBin, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    shell, windowsHide: true,
  });
  let tail = "";
  const tee = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    tail = (tail + text).slice(-16000); // 留尾部用于失败归因
  };
  child.stdout.on("data", tee);
  child.stderr.on("data", tee);
  return new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, tail })));
}

// ---------- 4. 执行 + 证书类失败自动重试 + 失败归因 ----------
const SSL_ERR = /(PKIX|SSLHandshakeException|sun\.security\.validator|unable to find valid certification path|certificate)/i;
const SSL_RETRY_ARGS = [
  "-Daether.connector.https.securityMode=insecure", // Maven 3.9 resolver 原生 HTTP 传输
  "-Dmaven.wagon.http.ssl.insecure=true",           // 以下 wagon 系兼容旧传输/插件
  "-Dmaven.wagon.http.ssl.allowall=true",
  "-Dmaven.wagon.http.ssl.ignore.validity.dates=true",
];

let result = await runMvn();
if (result.code !== 0 && result.signal == null && SSL_ERR.test(result.tail)) {
  log("检测到证书校验失败（自签 Nexus），自动带 insecure 参数重试一次（仅本次进程生效，不改 JDK 信任库）…");
  result = await runMvn(SSL_RETRY_ARGS);
}

if (result.code !== 0) {
  const t = result.tail;
  log(`mvn 失败：退出码 ${result.code}${result.signal ? `（信号 ${result.signal}）` : ""}`);
  if (SSL_ERR.test(t)) {
    log("仍是证书问题：根治方案是导出 Nexus 证书并导入 JDK 信任库（keytool -importcert -cacerts），或长期用 -Daether.connector.https.securityMode=insecure。");
  } else if (/10\.1\.98\.21|nexus-public/i.test(t) && /(Could not transfer|Could not resolve|Connect timed out|Read timed out)/i.test(t)) {
    log("私库取件失败：确认内网/VPN；预检已通过但构建中中断，多为 VPN 抖动，重跑一次即可。");
  } else if (/(maven\.aliyun|repo\.maven\.apache)/i.test(t) && /(Could not transfer|UnknownHost|Connect timed out)/i.test(t)) {
    log("公库取件失败：检查外网连通性（aliyun 需要能出公网）；本地 ~/.m2 已有依赖时可离线重试 -- -o。");
  } else if (/OutOfMemory/i.test(t)) {
    log("内存不足：设置 MAVEN_OPTS=-Xmx2g 后重试。");
  }
  process.exit(result.code ?? 1);
}

log("后端构建/依赖安装完成 ✓");
log("模块全量产物在各 target/ 下；前端另行见 admin-web-install skill");
log("提示：后端服务启动(spring-boot:run)按约定由你自己执行");
