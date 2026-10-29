// admin-web 专用 npm install 包装脚本（startup 项目前端依赖安装唯一入口）。
//
// 背景：本项目依赖双源——约 840 个公共包走公网源（registry.npmjs.org），
// 6 个 @wonders/* 组件走内网 Nexus（项目 .npmrc：@wonders:registry=
// https://10.1.98.21:60003/repository/npm-group/，自签证书 strict-ssl=false）。
// 而用户级 ~/.npmrc 常挂本地代理（如 127.0.0.1:7897），内网地址经代理转发
// 是否可达取决于代理分流规则，这是 install「时好时坏」的根因。
//
// 本脚本做四件事：
//   1. 自动从项目/用户 .npmrc 提取私库地址，安装时对私库主机注入 NO_PROXY
//      强制直连，公网源继续走用户代理——两条链路互不干扰（不改任何 .npmrc 文件）；
//   2. 安装前对每个 registry 做 TCP 预检，私库不可达时快速失败并给出
//      「连内网/VPN」提示，避免转圈二十分钟后才发现连不上；
//   3. 网络类失败自动重试一次；文件占用类失败（EBUSY/EPERM）提示先停 dev server；
//   4. 支持 --clean（删 node_modules 重装）/ --fresh（连 lockfile 一起删，慎用）/
//      --ci（严格按 package-lock.json 装），其余参数原样透传给 npm。
//
// 用法（专用脚本，默认面向 D:/code/startup/startup-admin-web，--root 可指向其他检出位置）：
//   node .zcode/skills/admin-web-install/scripts/install.mjs                # startup 仓内任意位置（junction）
//   node D:/code/0X-SKILLS/projects/startup/admin-web-install/scripts/install.mjs   # 绝对路径等价
//   …追加 --clean / --fresh / --ci / 其他 npm 透传参数
// 依赖：Node >= 20。
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error("[admin:install] 需要 Node >= 20，当前 " + process.versions.node);
  process.exit(1);
}

// ---------- 0. 定位项目根（专用脚本默认指向 startup-admin-web，--root 可覆盖） ----------
const argvAll = process.argv.slice(2);
let rootOverride = null;
const ri = argvAll.indexOf("--root");
if (ri >= 0) {
  rootOverride = argvAll[ri + 1];
  argvAll.splice(ri, 2);
}
const root = path.resolve(rootOverride ?? "D:/code/startup/startup-admin-web");
const argv = argvAll;
if (!fs.existsSync(path.join(root, ".npmrc")) || !fs.existsSync(path.join(root, "package.json"))) {
  console.error(`[admin:install] ${root} 下找不到 package.json/.npmrc，请用 --root <路径> 指定项目位置`);
  process.exit(1);
}
const isWin = process.platform === "win32";
const npmBin = isWin ? "npm.cmd" : "npm";
const shell = isWin; // Node 18.20+ 起 .cmd/.bat 必须经 shell 拉起
const log = (msg) => console.log(`[admin:install] ${msg}`);

// ---------- 1. 解析 .npmrc，找出私库 registry ----------
function parseNpmrc(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#;=\s]+?)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
// 与 npm 实际优先级一致：项目 .npmrc 覆盖用户级
const rc = {
  ...parseNpmrc(path.join(os.homedir(), ".npmrc")),
  ...parseNpmrc(path.join(root, ".npmrc")),
};
const npmjsHost = "registry.npmjs.org";
// 私库 = 所有 scoped/全局 registry 中非 npmjs 官方源
const privateRegistries = Object.entries(rc)
  .filter(([k, v]) => (k === "registry" || k.endsWith(":registry")) && !v.includes(npmjsHost))
  .map(([, v]) => v.replace(/\/+$/, ""));
const publicRegistry = rc.registry ?? `https://${npmjsHost}/`;

// 私库主机注入 NO_PROXY 强制直连；localhost 恒直连；公网源保持用户代理不动
function withNoProxy(baseEnv) {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const r of privateRegistries) {
    try {
      const u = new URL(r);
      hosts.add(u.hostname);          // 10.1.98.21
      if (u.port) hosts.add(u.host);  // 10.1.98.21:60003
    } catch { /* 忽略非法项 */ }
  }
  const list = [...hosts].join(",");
  const env = { ...baseEnv };
  for (const key of ["NO_PROXY", "no_proxy"]) {
    env[key] = env[key] ? `${env[key].replace(/,+$/, "")},${list}` : list;
  }
  return env;
}
const env = withNoProxy(process.env);

// ---------- 2. registry 连通性 TCP 预检（不走代理、不看证书，只判主机可达） ----------
function tcpProbe(registry) {
  return new Promise((resolve) => {
    try {
      const u = new URL(registry);
      const socket = net.connect({ host: u.hostname, port: Number(u.port) || 443, timeout: 8000 });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("timeout", () => { socket.destroy(); resolve(false); });
      socket.on("error", () => resolve(false));
    } catch { resolve(false); }
  });
}

if (privateRegistries.length) {
  for (const r of privateRegistries) {
    log(`预检私库 → ${r}`);
    if (await tcpProbe(r)) {
      log("  ✓ 私库可达（已注入 NO_PROXY 直连，绕过本地代理）");
      continue;
    }
    log("  ✗ 私库不可达：请确认在内网环境/已连 VPN；若开着代理，检查其分流规则对 10.x 网段是否直连。安装终止。");
    process.exit(1);
  }
} else {
  log("未发现私库 registry 配置，按普通 npm install 处理");
}
log(`预检公网源 → ${publicRegistry}`);
if (!(await tcpProbe(publicRegistry))) {
  log("  ! 公网源不可达（若开着代理可能仅代理可达）。本地缓存齐全时仍可能装成功，继续尝试…");
} else {
  log("  ✓ 公网源可达");
}

// ---------- 3. 组装并执行 npm ----------
const clean = argv.includes("--clean");
const fresh = argv.includes("--fresh");
const ci = argv.includes("--ci");
const pass = argv.filter((a) => !["--clean", "--fresh", "--ci"].includes(a));

function rmNodeModules() {
  const dir = path.join(root, "node_modules");
  log(`删除 ${dir} …`);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 800 });
  } catch (e) {
    log(`删除失败：${e.code ?? e.message}`);
    log("大概率是 vite dev server / 编辑器正占用 node_modules，请先停掉 dev server 再重试（服务由你自己重启）。");
    process.exit(1);
  }
}

if (clean || fresh) rmNodeModules();
if (fresh) {
  log("已删除 package-lock.json：版本将按 package.json 重新解析，可能与既有 lockfile 漂移，装完请检查 diff");
  fs.rmSync(path.join(root, "package-lock.json"), { force: true });
}

const npmArgs = ci
  ? ["ci", "--no-audit", "--no-fund", ...pass]
  : ["install", "--no-audit", "--no-fund", "--fetch-retries=3",
     ...(fresh ? [] : ["--prefer-offline"]), ...pass];

function runNpm(args) {
  log(`执行 npm ${args.join(" ")} …`);
  const child = spawn(npmBin, args, { cwd: root, env, shell, windowsHide: true });
  let tail = "";
  const tee = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    tail = (tail + text).slice(-12000); // 留尾部用于失败归因
  };
  child.stdout.on("data", tee);
  child.stderr.on("data", tee);
  return new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, tail })));
}

const TRANSIENT = /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|tunnel|EPIPE)/i;
let result = await runNpm(npmArgs);
if (result.code !== 0 && result.signal == null && TRANSIENT.test(result.tail)) {
  log("检测到网络类错误，10 秒后自动重试一次…");
  await new Promise((r) => setTimeout(r, 10_000));
  result = await runNpm(npmArgs);
}

if (result.code !== 0) {
  const t = result.tail;
  log(`npm 失败：退出码 ${result.code}${result.signal ? `（信号 ${result.signal}）` : ""}`);
  if (/(EBUSY|EPERM|ENOTEMPTY|unlink)/i.test(t)) {
    log("文件被占用（EBUSY/EPERM）：大概率 vite dev server 正在运行，请先停掉 dev server，再重跑本脚本 --clean（服务由你自己重启）。");
  } else if (/(UNABLE_TO_VERIFY|SELF_SIGNED|CERT_HAS_EXPIRED|CERT)/i.test(t)) {
    log("证书校验失败：确认项目 .npmrc 里 strict-ssl=false 仍在、未被用户级配置覆盖。");
  } else if (TRANSIENT.test(t)) {
    log("网络仍不通：① 确认在内网/VPN；② 检查 ~/.npmrc 的 proxy/https-proxy 是否在跑、对 10.x 是否直连；③ 手动验证 curl -k https://10.1.98.21:60003/repository/npm-group/");
  }
  process.exit(result.code ?? 1);
}

log("依赖安装完成 ✓");
log('下一步：npm run "admin dev"（脚本名含空格，整体加引号）');
if ((clean || fresh) && fs.existsSync(path.resolve(root, "../../vital-web-vue3"))) {
  log("提示：本次为全新安装，@wonders/vital-web 是私库 1.0.4 产物；若在做 vital 本地联调，执行 npm run vital:sync 换回本地构建副本。");
}
