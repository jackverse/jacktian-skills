---
name: maven-build
project: D:\code\startup
description: startup 项目后端 Maven 构建专用脚本与双源（aliyun 公库 + 内网 Nexus 私库）排查。当用户要求 mvn install/打包/编译后端/装后端依赖、构建报私库连不上/超时/PKIX 证书错误、或提到 nexus-public/maven 私库问题时使用。一律走 mvn-install.mjs 脚本，不要裸跑 mvn。
---

# Skill: 后端 Maven 构建（公私双源专用脚本）

> 专用 skill（绑定 startup 项目，脚本在 `scripts/` 内，不落项目仓库）。

## 何时使用

- 用户要求给 startup 后端做 `mvn clean install` / 打包 / 编译 / 装依赖。
- Maven 构建报私库取件失败、Connect timed out、PKIX/SSLHandshake 证书错误时的排查重试。

## 用法（任意目录可执行，默认面向 D:/code/startup，`--root` 可覆盖）

```bash
node .zcode/skills/maven-build/scripts/mvn-install.mjs          # 根全量：mvn clean install -DskipTests
node .zcode/skills/maven-build/scripts/mvn-install.mjs admin    # startup-admin 及其依赖(-pl -am) clean install -DskipTests
node .zcode/skills/maven-build/scripts/mvn-install.mjs task     # 同理：common/database/admin/task/pub/idp/app
node .zcode/skills/maven-build/scripts/mvn-install.mjs -- -pl startup-database -am clean package
                                                                # "--" 后原样透传 mvn，不再附加默认 goal
node .zcode/skills/maven-build/scripts/mvn-install.mjs -- -DskipTests=false test  # 需要跑测试时（仓库默认 skipTests=true）
node .zcode/skills/maven-build/scripts/mvn-install.mjs --root D:/elsewhere/startup  # 仓库检出在别处时
```

脚本自动做三件事：TCP 预检私库（不通快速失败并提示内网/VPN，不再傻等超时）；证书类失败自动带 `-Daether.connector.https.securityMode=insecure`（含 wagon 兼容参数）重试一次（仅该次进程生效，不动 JDK cacerts / settings.xml）；失败日志按特征归因（私库超时/公库断网/OOM）。

## 背景（为什么 Maven 和 npm 的私库套路不同）

- 根 `pom.xml` 双源：`public`→aliyun + `nexus-public`→`https://10.1.98.21:60003/repository/maven-public/`（自签证书；**仅 `<repositories>`，releases only、snapshots=false**，插件仓库只有 aliyun）。
- 用户**没有** `~/.m2/settings.xml`，且 JVM 默认不吃系统/环境代理——npm 那套「NO_PROXY 绕代理」在 Maven 无效也**不需要**；反之，若哪天在 `MAVEN_OPTS` 配了 `http.proxyHost`，内网 Nexus 反而可能被代理带挂（脚本会检测并提示）。
- 私库不可达的典型症状：aliyun 先 404 一轮、Nexus 再超时一轮，构建挂很久——所以预检必须先做。

## 关键约定与坑

1. **后端服务启动不做**：`spring-boot:run` / 服务重启按全局规范由用户自己执行，脚本只管构建。
2. 根目录全量默认 `clean install -DskipTests`（AGENTS.md 惯例：仓库默认不跑测试）；要跑测试走 `-- -DskipTests=false` 透传。
3. 脚本在 Windows 下经 shell 拉起 `mvn.cmd`（Node 18.20+ 安全限制），已内置处理。
4. 证书根治方案（可选）：导出 Nexus 证书 `keytool -importcert -cacerts` 导入 JDK17 信任库；不想导就一直让脚本自动 insecure 重试。
5. 内网构建中 VPN 抖动报 `Could not transfer ... 10.1.98.21`：预检已通过、构建中断，直接重跑一次即可。
6. 与前端分工：前端依赖装 admin-web-install skill（`scripts/install.mjs`），两边互不替代。
