---
name: douyin-data
project: D:\jack\self-knowledge-md
description: 抖音账号数据维护（一次扫码、长期跨机、多账号、只读）。当用户说「更新抖音数据」「同步抖音」「加一个抖音号」「抖音登录」「抖音数据怎么没更新」「换机后抖音登录态」时使用。
---

# Skill: 抖音数据维护（只读）

**一句话**：抖音登录/同步走 hub「抖音」页或 CLI；登录态加密进 git，密钥只在本机；只调创作者中心只读接口，不发布/不点赞/不评论/不改资料。

## 何时用

- 用户要**拉/更新抖音数据** → `--douyin-sync`
- 用户要**加账号 / 重新授权** → `--douyin-login`（弹专用浏览器扫码）
- 用户说**换机器后抖音数据/登录态不对** → 先确认 `sync.key` 是否导入
- 需要看接口返回结构/排错 → `--douyin-probe`（原始响应落 `data/hub/douyin/probe/`，不进 git）

## 命令（在 `D:\jack\self-knowledge-md\tools\hub` 下）

源码（本机 `python` 是 WindowsApps 占位符，用真解释器 `py -3.14` 或下面这条）：
```powershell
& "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe" hub.py --douyin-sync
& "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe" hub.py --douyin-login
& "$env:LOCALAPPDATA\Python\pythoncore-3.14-64\python.exe" hub.py --douyin-probe
```

打包后（仓库根）：
```powershell
.\hub.exe --douyin-sync
```

定时任务：Windows 任务计划程序里的「**抖音数据同步**」，每天 09:10 调 `hub.exe --douyin-sync`；在 hub「抖音 → 定时」里改时间/停用。

## 边界（硬编码在 core/douyin_sync.py 的 ALLOWED）

只允许这些只读数据接口：

- `GET /aweme/v1/creator/user/info/`（认号）
- `GET /web/api/creator/item/list`（作品全量指标）
- `GET /web/api/creator/item/list/download`（导出兜底）
- `GET /janus/douyin/creator/pc/work_list`（兜底）
- `POST /janus/douyin/creator/data/overview/dashboard`（每日趋势）
- `GET /janus/douyin/creator/data/overview/dashboard/fans`（粉丝）
- `POST /janus/douyin/creator/download/data/pc/item/list`（导出兜底）

**不要**调用发布、点赞、评论、删除、改资料、改设置类接口；不要用登录态做数据以外的事。

## 多账号

- 每个号各扫一次；**每次扫码都会新开一个一次性独立 profile**（`data/social/browser/douyin-login-*`，临时端口），扫完即关、用完即删——不会带上一个号的 Cookie / localStorage
- 扫码后若弹出**短信验证码**，在浏览器里输完再点验证；工具会打开数据中心触发安全 SDK 并等约 10 秒补齐 `bd_ticket_guard_*`，别提前关窗口
- 换号：直接再点「打开浏览器扫码」即可；「换个号」只是关掉当前挂着的扫码窗口（不删已保存的登录态）
- 扫码前先在抖音 App 里切到要登录的那个号，再扫；否则扫进的还是手机当前登录的号
- 账号按抖音号分开存 `data/hub/douyin/<handle>.json`，不会串号
- 下拉切换「某个账号」或「全部账号（融合）」

## 跨机器

| 文件 | 说明 | git |
|---|---|---|
| `data/hub/douyin/auth.<机器>.json` | 加密后的登录态，每台一片，按 handle 合并取最新 | ✓ |
| `data/hub/douyin/sync.key` | 同步密钥（32 字节）；另一台粘一次即可 | ✗ |
| `data/hub/douyin/exports/` `probe/` `*.log` | 原始导出/探测/日志 | ✗ |

换机步骤：`git pull` → hub「抖音 → 登录 → 同步密钥… → 从另一台机器导入」→ 粘密钥 →「立即同步」。

## 排错

- **「浏览器没弹出来」**：专用 Chrome 被 DSH 全屏压在后面；代码已用 `SetForegroundWindow` 提前台。仍看不到就点任务栏的「抖音创作者中心」窗口。
- **「登录已失效」**：重新 `--douyin-login` 扫一次；四个号各自独立，不影响其它号。
- **换号后还是旧账号 / 两个抖音登录**：确认扫码前抖音 App 已切到目标号；浏览器侧每个号已用一次性独立 profile（`douyin-login-*`，扫完删），登录前还会 kill 遗留窗口。若仍有残留，删 `data/social/browser/douyin-login-*` 再重开。
- **「有加密登录态，但本机缺同步密钥」**：从另一台机器粘密钥，不要新生成（会混用两把钥匙）。
- **账号显示「没有登录态」**：这个号只加了账号没扫码；「登录 → 换个号」扫它。
- **数据没更新**：看 `data/hub/douyin/sync.log`；确认任务计划「抖音数据同步」上次运行结果。
