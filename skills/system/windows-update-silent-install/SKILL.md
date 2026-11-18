---
name: windows-update-silent-install
description: 无人值守静默安装 Windows 更新且不触发重启的完整 PowerShell 管线：COM API（Microsoft.Update.Session）按 "IsInstalled=0 and Type='Software' and IsHidden=0" 扫描 → AcceptEula → 逐个 Download/Install（COM 安装天然不触发重启，装完只置 RebootRequired 标志）；非提权会话用 Start-Process -Verb RunAs 弹 UAC，提权进程 stdout 无法回传，payload 内 Add-Content 写日志文件、主会话轮询日志，另开进程内 runspace 心跳每 60s 写独立文件证明阻塞调用还活着。触发场景：安全巡检基线"及时更新系统补丁"违规整改、静默装补丁、装补丁不重启、补丁装完验证、Get-HotFix 巡检口径、usoclient 不生效/静默无效、IUpdateInstaller.Install 卡住或宿主 powershell 进程消失、UAC 提权脚本日志回传、MaxDownloadSize 体积虚报。基于 Windows 11 家庭版（build 26300）实战验证。
---

# Windows 更新无人值守静默安装（不触发重启）

## 适用场景

- 安全巡检基线报"及时更新系统补丁"违规，需要无人值守把待装补丁静默装完（不弹窗、不自动重启），并给出巡检平台口径的验证证据。
- 任何 Windows 机器通用，不绑定项目。基于 Windows 11 家庭版 build 26300 实测（2026-11），Pro/企业版同样适用；家庭版专属差异见「注意事项」。

## 管线总览（COM API 一条龙，全程不触发自动重启）

COM 安装**天然不会触发重启**：装完只在注册表置 RebootRequired 标志，重启时机留给用户——这正是无人值守整改要的性质。

1. **扫描**：`Microsoft.Update.Session` → `CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software' and IsHidden=0")`（未安装 + 软件类排除驱动 + 排除手动隐藏项）。**扫描无需提权**。
   - 属性小坑：重启行为取 `$u.InstallationBehavior.RebootBehavior`（0=无需重启 1=可能重启 2=必须重启）；`$u.RebootBehavior` 在 PowerShell COM 适配器下取出来是空。
2. **接受协议**：逐个检查 `EulaAccepted`，为假则 `$u.AcceptEula()`，否则下载/安装会失败。
3. **下载**：`Microsoft.Update.UpdateColl` 装入待装更新 → `CreateUpdateDownloader()` 设 `Updates` 属性 → `Download()`（阻塞调用）。
4. **安装**：`CreateUpdateInstaller()` 设同一 `Updates` 属性 → `Install()`（阻塞调用）。**安装必须管理员**。
5. **ResultCode 口径**：`2=成功，3=成功但有错误（部分内容失败），4=失败`（另有 1=未开始、5=中止）；安装结果的 `RebootRequired=True` 表示"挂着重启待办"，不是已重启。

按 update **逐个** download/install（每轮 `UpdateColl` 只放一个更新）：单个更新失败不拖垮整批，日志能定位到具体是哪个更新出问题。

## 一、提权：UAC + 日志文件轮询 + 进程内心跳

- 非提权会话拉起提权 payload：`Start-Process powershell -Verb RunAs -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',<payload>,'-LogDir',<日志目录>)`。用户在 UAC 点"否"时 `Start-Process` 直接抛异常，要 try/catch 给出友好提示。
- **提权进程的 stdout 无法回传**到主会话——payload 必须自己 `Add-Content` 写日志文件（约定 `%TEMP%\wu-install\install.log`），主会话轮询该文件做增量回显。
- `Download()/Install()` 是**长时间阻塞的 COM 调用**，主线程卡在哪一步、进程是死是活看不出来——payload 内开一个**进程内 PowerShell runspace 心跳线程**，每 60s 覆写一次独立心跳文件（`heartbeat.txt`）。心跳在进程内，宿主进程一死心跳必然停止，所以"心跳停摆"正是判定宿主死亡的依据；配合完成标记 `INSTALL_DONE` 区分正常结束与异常（见坑 3）。

## 二、坑 1：Git Bash 里内联 powershell -Command，$ 变量被 bash 吃掉

在 Git Bash 双引号里内联 `powershell -Command "...foreach ($u in $result.Updates)..."`：

- bash 把 `$u`、`$result` 当**自己的环境变量**展开成空串，`$_` 被展开成"上一条命令的最后一个参数"，powershell 收到的是残缺脚本，报莫名其妙的解析错误。
- **解法：复杂逻辑一律写成 .ps1 脚本文件，用 `powershell -NoProfile -ExecutionPolicy Bypass -File xxx.ps1` 执行**，绝不走 -Command 内联。
- 附带编码坑：含中文注释的 .ps1 要存 **UTF-8 with BOM**（Windows PowerShell 5.1 对无 BOM 文件按 ANSI/GBK 解析，中文注释乱码甚至引发语法错误）。

## 三、坑 2：usoclient 在 Win11 上不可依赖

- 非提权 `usoclient StartInstall` / `ScanInstallWait` 是**静默 no-op**：无报错、无下载、无安装，什么也不发生。
- 提权后再跑：只有事件日志活动（`Microsoft-Windows-WindowsUpdateClient/Operational`：实测出现 Id 26 = 搜索完成/找到 N 个更新、Id 41 = 已下载），**经常不进入安装阶段**，且没有可控的完成判定。
- 无人值守整改**不要赌 usoclient**，直接走 COM API 管线（本技能主体）。

## 四、坑 3（最关键）：宿主 powershell 进程消失 ≠ 安装失败

`IUpdateInstaller.Install()` 装大体积累积更新（LCU，GB 级）时，**宿主 powershell 进程可能直接消失**：心跳停止、`INSTALL_DONE` 完成标记不出现、`-PassThru` 拿到的进程句柄报 HasExited。

- **这不代表安装失败**。真正执行安装的是 **TrustedInstaller / TiWorker 服务**（宿主 powershell 只是发起方），宿主崩溃只是"报告链路"断了，安装由服务在后台继续跑。
- 正确动作：**不要立刻重跑安装**（并发安装互相干扰），先做下面三条"真相验证"。

### 验证真相三条

```powershell
# ① Get-HotFix：KB 是否已带当天日期注册进 QFE（巡检平台正是读这个，见下节）
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 HotFixID, Description, InstalledOn

# ② 注册表重启待定标志：键存在 = 装上了且挂着重启（COM 安装的本来面貌）
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'

# ③ 复扫（scripts/wu-scan.ps1）：该 KB 仍显示在待安装列表，属重启前的正常现象
#    （安装完成态要重启后才完全生效，扫描才不再列出）
```

判读：① 里 KB 出现且 `InstalledOn=当天`，或 ② 任一为 True → 安装实际成功，只欠重启；①② 皆无、复扫也确实还在 → 才是真空了，此时再重跑安装。

## 五、Get-HotFix 是巡检平台的口径

- 巡检平台的"系统最近更新时间"读的是 `Win32_QuickFixEngineering`（PowerShell 即 `Get-HotFix`）。**KB 装完不必等重启**就注册进 QFE，`InstalledOn` = 安装当天 → 平台指标立刻刷新。
- MSRT 类小补丁（KB890830，恶意软件删除工具）装完无重启要求，是低成本刷"最近更新时间"的典型。
- 注意 QFE 不覆盖所有更新类型（部分 .NET / Defender 病毒库等更新不在其中），但巡检基线就以它为准——坑 3 验证时若某 KB 不在 Get-HotFix 里，先想想它是否属于"不进 QFE"的类型。

## 六、注意事项

- 装 LCU 后系统挂"等待重启"。**家庭版**没有组策略，自动重启只发生在活动时间之外的窗口（设置 > Windows 更新 > 高级选项 > 活动时间可查/可调；本机窗口为 1:00–7:00）——提醒用户自行挑时间重启，或接受半夜自动重启。
- `MaxDownloadSize` **经常严重虚报**（标 90GB 实际只下几百 MB~几 GB）：express 分发只下差异包，不要被体积吓到，也不要拿它当真实下载量展示给用户。
- 权限边界：扫描/下载无需提权，安装必须管理员。

## scripts/ 三件套

| 脚本 | 作用 | 提权 |
|------|------|------|
| `scripts/wu-scan.ps1` | 扫描待安装更新清单（数量/KB/体积/重启行为） | 否 |
| `scripts/wu-run-elevated.ps1` | 非提权入口：弹 UAC 拉起 payload，轮询日志与心跳直到完成标记或宿主退出 | 否（内部弹 UAC） |
| `scripts/wu-install-elevated.ps1` | 提权 payload：心跳 runspace + 逐个 AcceptEula/Download/Install + 写日志与完成标记 | 是（由上一脚本拉起） |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\wu-scan.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\wu-run-elevated.ps1
```

日志约定（`%TEMP%\wu-install\`）：`install.log` 主日志（payload 增量写、主会话轮询回显）、`heartbeat.txt` 心跳（60s 覆写）、`INSTALL_DONE` 完成标记（宿主被杀时不会出现）。脚本文件存 UTF-8 with BOM，脚本内 `[Console]::OutputEncoding = UTF8` 防控制台中文乱码。
