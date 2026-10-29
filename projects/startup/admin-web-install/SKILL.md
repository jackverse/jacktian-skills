---
name: admin-web-install
project: D:\code\startup
description: startup 项目 admin-web（startup-admin-web 前端）依赖安装专用脚本与私库排查。当用户要求 install/装 admin-web 依赖、npm install 报私库/网络/EBUSY/证书错误、提到 @wonders 私库包或内网 Nexus 安装问题时使用。一律走 install.mjs 脚本，不要裸跑 npm install。
---

# Skill: admin-web 依赖安装（私库专用 install 脚本）

> 专用 skill（绑定 startup 项目，脚本在 `scripts/` 内，不落项目仓库）。

## 何时使用

- 用户要求给 startup-admin-web 装/重装依赖（install）。
- admin-web `npm install` 报私库连不上、超时、代理（tunnel/socket）、证书（UNABLE_TO_VERIFY/SELF_SIGNED）、EBUSY/EPERM 等错误时的排查与重装。

## 用法（一条命令，任意目录可执行）

```bash
node .zcode/skills/admin-web-install/scripts/install.mjs                # startup 仓内任意位置（junction）
node D:/code/0X-SKILLS/projects/startup/admin-web-install/scripts/install.mjs   # 绝对路径等价
# 常规安装（默认 --prefer-offline，热缓存约 2s）
node .zcode/skills/admin-web-install/scripts/install.mjs --clean        # 删 node_modules 重装（dev server 占用/装一半中断时）
node .zcode/skills/admin-web-install/scripts/install.mjs --fresh        # 连 package-lock.json 一起删（慎用，版本会漂移）
node .zcode/skills/admin-web-install/scripts/install.mjs --ci           # 严格按 lockfile 装（复现环境）
node .zcode/skills/admin-web-install/scripts/install.mjs --root D:/elsewhere/startup-admin-web  # 仓库检出在别处时
```

其余参数原样透传 npm（如 `--no-prefer-offline`）。

## 背景（为什么不能裸 npm install）

依赖双源：约 840 个公共包走公网源，6 个 `@wonders/*` 组件走内网 Nexus
`https://10.1.98.21:60003/repository/npm-group/`（项目 `.npmrc`：`strict-ssl=false` + `legacy-peer-deps=true`）。
用户级 `~/.npmrc` 常挂本地代理（`127.0.0.1:7897`），内网地址走不走得通取决于代理分流规则——这是 install「时好时坏」的根因。

脚本做的事（不改任何 `.npmrc` 文件）：

1. 从项目/用户 `.npmrc` 自动提取非 npmjs 的私库地址，安装子进程注入 `NO_PROXY`（私库 IP/host:port/localhost）强制直连，公网源继续走用户代理——两条链路互不干扰；
2. 安装前对每个 registry 做 **TCP 预检**（不走代理、不看证书，只判主机可达）：私库不通 → 快速失败并提示连内网/VPN，公网不通 → 警告后继续（可能全走缓存）；
3. 网络类失败自动重试一次；按错误特征归因（EBUSY→占用、CERT→strict-ssl、ETIMEDOUT→网络/代理）给出针对性建议；
4. 私库地址若变更只改 `.npmrc`，脚本自适应，无需改脚本。

## 关键约定与坑

1. **脚本名含空格**：`npm run "admin dev"` / `"admin build"` 调用必须整体加引号。
2. **dev server 占用**：EBUSY/EPERM 大概率是 vite dev server 正在跑。按全局规范**不要替用户停/重启服务**——提示用户自己停掉后再 `--clean`。
3. **`@wonders/vital-web` 双形态**：私库 1.0.4 产物 vs `D:\code\vital-web-vue3` 本地联调副本（`npm run vital:sync` 原位覆盖，版本同为 1.0.4 难以肉眼区分）。**增量 install 不会动已有副本；`--clean`/`--fresh` 全新安装后回到私库产物，在做 vital 联调时需重新 `npm run vital:sync`**（脚本装完会自动提示）。
4. `--fresh` 删 lockfile 前三思：装完务必 `git diff package-lock.json` 检查版本漂移。
5. 项目 `.npmrc` 的 `strict-ssl=false`、`legacy-peer-deps=true` 是私库自签证书与老 peer 冲突的解，别“顺手清理”。
6. 预检只保证 TCP 可达；若仍报证书错，优先确认项目 `.npmrc` 未被用户级/CI 配置覆盖。
