---
name: win-usb-wifi-bt-trace-clean
description: Windows 外接设备与无线网络痕迹清理（USB 存储/便携设备 MTP/WiFi/蓝牙/已知网络/事件日志/DNS）完整管线：只读扫描先行（netsh/reg query 免提权）→ AskUserQuestion 两档用户决策（只清记录保留 WiFi 密码 / 全删 + 蓝牙键鼠断连警示）→ UAC 提权删除（Start-Process -Verb RunAs -Wait + 结果文件回传，提权脚本必须纯 ASCII）→ 非提权终验。核心大坑：USBSTOR 所在 Enum 键 ACL 连管理员都只有读权限，PS Remove-Item 报"该子项不存在"（误导，实为拒绝访问），接管所有权+FullControl 仍删不掉，正解 SYSTEM 权限计划任务 schtasks /create /ru SYSTEM /tr "cmd /c reg delete ..." + /run 一步到位并重建空父键。三大坑：PS5.1 按 GBK 解析无 BOM UTF-8 中文 .ps1 提权进程秒退且无任何输出；catch 块里 $_ 是 ErrorRecord 不是管道项（错误细节用 $_.Exception.Message）；CurrentControlSet 是符号链接键 PS 提供器错误信息失真（诊断用 reg.exe 直查 ControlSet001）。触发场景：删 USB 使用记录/U盘插拔痕迹、清 WiFi 连接历史/删 WiFi 密码、删蓝牙配对痕迹、清手机 MTP 连接记录、外设隐私清理、电脑交接/回收/离职前硬件痕迹清理、USBSTOR 删不掉、Enum 键拒绝访问、注册表键管理员也删不掉/接管所有权仍删不掉、SYSTEM 权限计划任务删注册表、NetworkList 网络名/已知网络删不掉、wevtutil 清设备连接日志、上网痕迹硬件侧清理。
---

# Windows 外接设备与无线网络痕迹清理（USB / WiFi / 蓝牙）

## 适用场景

- 隐私清理：把"这台机器插过哪些 U 盘、连过哪些 WiFi（含密码）、配对过哪些蓝牙设备、手机什么时候连过"这一整层硬件痕迹清掉，常与浏览器历史清理（见 `win-browser-history-audit`）搭配用于交接/回收/离职清机。
- 排障：USBSTOR / Enum 键"管理员也删不掉"、Remove-Item 报"该子项不存在"但键明明在、NetworkList 删了等于没删等注册表权限怪象。

本机（Win11，zh-CN）2026-11-12 全链路验证：扫描 → 决策 → 提权删除 → 终验，清理后八类痕迹源全部归零；`scripts/clean.ps1` 扫描路径冒烟通过。环境前提：Windows PowerShell 5.1（系统自带）即可，零依赖。

## 一、痕迹源全景（清单 + 权限边界，顺序即清理顺序）

| # | 痕迹源 | 位置/命令 | 暴露什么 | 删除权限 | 删除方式 |
|---|--------|----------|---------|---------|---------|
| 1 | WiFi 配置文件 | `netsh wlan show profiles`（落盘 XML 在 `C:\ProgramData\Microsoft\Wlansvc\Profiles\Interfaces\`，keyMaterial 是**明文密码**，netsh 删 profile 时系统一并删 XML） | SSID + 密码 | **普通权限即可删** | `netsh wlan delete profile name="*" i="*"`（输出 GBK 乱码但实际成功，以删除后再 show 复验为准） |
| 2 | 蓝牙配对 | `HKLM\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices`（子键名=MAC，`Name` 值=设备名 REG_BINARY UTF-16LE） | 配对过的设备清单 | 管理员可删 | PS `Remove-Item` 逐子键 |
| 3 | USB 存储历史 | `HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR`（子键=厂商/产品，孙键=序列号实例） | 插过的每个 U 盘/移动硬盘 | **连管理员都只有读权限** | SYSTEM 权限计划任务（见专节） |
| 4 | 便携设备(手机 MTP) | `HKLM\SOFTWARE\Microsoft\Windows Portable Devices\Devices`（`FriendlyName` 值） | 连过的手机/平板 | 管理员可删 | PS `Remove-Item` 逐子键 |
| 5 | 网络名历史 | `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\Profiles`（`ProfileName`）+ `Signatures\Unmanaged` | 连过的所有网络名（含手机热点） | **需管理员**；普通权限删会被静默拒绝（显示删了 0 项），本机实测普通权限**连读都被拒**（reg query 报"拒绝访问"，但 `Test-Path` 仍 True） | PS `Remove-Item` 逐子键，Profiles 与 `Signatures\Unmanaged` **都要删** |
| 6 | 事件日志 | `Microsoft-Windows-WLAN-AutoConfig/Operational`（WiFi 连接史 SSID+时间）、`NetworkProfile/Operational`、`Kernel-PnP/Configuration`（设备接入/安装史）、`Bluetooth-MtpEnum/-BthLEEnum/-Policy/Operational` | 接入时间线 | 需管理员 | `wevtutil cl <通道名>`（通道不存在会报错，逐通道容忍；个别通道 `RecordCount` 为 null 显示 `?`） |
| 7 | 设备安装日志 | `C:\Windows\INF\setupapi*.log`（dev/backup 系列可删；`setupapi.setup.log` 受 TrustedInstaller 保护删不掉属正常） | 设备安装明细含序列号 | 需管理员 | 删 `setupapi*.log` |
| 8 | DNS 缓存 | — | 最近解析过的域名 | 普通权限 | `ipconfig /flushdns` |

## 二、流程纪律（顺序不可乱）

1. **只读扫描先行**：`netsh wlan show profiles`、`reg query` 全部免提权，可反复跑。出发现清单（含当前在线 USB 设备 `[ONLINE NOW]` 标记）。
2. **用户决策（AskUserQuestion），动手前必问**——WiFi 密码/蓝牙配对删除有日常副作用：
   - **只清记录保留密码**：WiFi profile 不动（不用重输密码），其余全清 → `-KeepWiFiPassword`
   - **全删**：WiFi 配置文件+蓝牙配对一起删 → `-All`
   - 追加确认：**蓝牙键盘/鼠标删配对后会当场断连**，需重新配对才能用；不想断就加 `-KeepBluetooth`
3. **提权删除**：脚本自提权（UAC 弹窗 → payload 写结果文件 → 回读）。
4. **非提权终验**：提权进程退出后再跑一次 `-Scan`，逐项比对为 0/空。
5. **在线设备不算痕迹**：当前插着的 USB 设备其 USBSTOR 项删了会被 PnP **立刻重建**，扫描里标 `[ONLINE NOW]`——终验看到它不算残留，拔掉再验或直接跳过。

## 三、USBSTOR 专节：Enum 键"管理员也删不掉"的真相与正解

**ACL 现状**：`Enum` 及其子键连 Administrators 都只有读权限，SYSTEM 才有 FullControl。

**实测三次失败记录**（别重蹈）：
1. PS `Remove-Item` 报 **"该子项不存在"** —— 误导性错误，键明明在（PS 注册表提供器经 CurrentControlSet 符号链接键把"拒绝访问"报成"不存在"）；
2. `reg.exe delete` 报**真实原因"拒绝访问"**；
3. 接管所有权（take ownership）+ 授予 Administrators FullControl 后**仍然删不掉**（Enum 父链同样受限）——实测无解，别恋战。

**正解：SYSTEM 权限计划任务，两步到位**：

```bat
schtasks /create /tn TraceCleanUsbStor /ru SYSTEM /sc once /st 23:59 /f /tr "cmd /c reg delete HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR /f"
schtasks /run /tn TraceCleanUsbStor
```

- `/run` 是**异步**的：轮询 `Test-Path` 直到键消失（脚本内置 30s 超时），然后 `schtasks /delete /tn TraceCleanUsbStor /f` 清任务。
- 删父键后**重建空的 USBSTOR 父键**：`reg add HKLM\SYSTEM\CurrentControlSet\Enum\USBSTOR /f`（或留给 PnP 重建），保持 PnP 期望的节点存在。
- PowerShell 里 `/tr` 参数用**单引号字符串整体传**（`/tr 'cmd /c reg delete ... /f'`），路径无空格可省内层引号。

## 四、UAC 提权模式（结果文件回传）

提权进程的 stdout **无法回传**主会话，标准套路（与 `windows-update-silent-install` 同款）：

1. 主会话把要跑的逻辑写成 .ps1（本技能直接**复用脚本自身**：非提权运行 + 删除开关 → 自动重启自己），结果路径约定 `%TEMP%\trace-clean\result-*.txt`；
2. `Start-Process powershell -Verb RunAs -PassThru -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"<脚本>",...,'-ResultFile',"<结果>")`；
3. 提权进程把结果写文件，`-Wait` 退出后主会话 `Get-Content` 回读，再跑非提权终验；
4. **用户点 UAC"否"：Start-Process 直接抛异常**（"操作已被用户取消"），必须 try/catch 后友好退出（exit≠0 是正常路径）；
5. ArgumentList 的**含空格路径要手动加引号**（PS5.1 不自动给元素加引号）：`('"{0}"' -f $path)`；提权前后同一用户，`%TEMP%` 相同，结果文件路径可靠。

## 五、三大坑（提权脚本翻车的根源，必须背下来）

1. **PS5.1 GBK 解析坑**：AI/工具产出的 .ps1 是**无 BOM UTF-8**；含中文时 PS5.1 按 GBK 解析 → 中文注释乱码 + "字符串缺少终止符"等假语法错 → **提权进程秒退且无任何输出**、结果文件不生成，因 RunAs 窗口一闪而过排障极难。**提权脚本必须纯 ASCII（消息全英文）**——`scripts/clean.ps1` 全英文即此原因。
2. **catch 块里 `$_` 是 ErrorRecord 不是管道项**：`catch { L "$($_.PSChildName)" }` 输出**空**。要记录"哪个键失败"就把管道项存闭包变量（循环变量直接用），要记录"为什么失败"用 `$_.Exception.Message`。
3. **CurrentControlSet 是指向 ControlSet001 的符号链接键**：PS 注册表提供器经它操作时错误信息失真（"不存在"实为"拒绝访问"）。诊断 ACL/内容用 `reg.exe` 直查 `HKLM\SYSTEM\ControlSet001\...`。

## 六、scripts/clean.ps1 用法（ASCII 版合并脚本：扫描 + 参数化删除）

| 命令 | 行为 |
|------|------|
| `clean.ps1`（或 `-Scan`） | 只读扫描，免提权，可反复跑 |
| `clean.ps1 -KeepWiFiPassword` | 全清但**保留 WiFi 配置文件/密码** |
| `clean.ps1 -All` | 全清（含 WiFi 密码 + 蓝牙配对） |
| 追加 `-KeepBluetooth` | 任一删除档位上跳过蓝牙卸配对（键鼠不断连） |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\clean.ps1 -Scan
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\clean.ps1 -KeepWiFiPassword   # 非提权运行会自动弹 UAC
```

- 非提权 + 删除开关 → 自提权（UAC）→ 结果写 `%TEMP%\trace-clean\result-*.txt` → 回读 → 自动再跑一遍只读扫描做终验。
- 删除阶段逐项打日志（`[WiFi] before/after`、`[Bluetooth] removed N failed M`、`[USBSTOR] SYSTEM 任务结果`、`[NetworkList] profiles+signatures`、`[EventLog]` 逐通道、`[SetupApi]`、`[DNS]`），失败项带 `$_ .Exception.Message`，这就是复验依据。
- 扫描的注册表枚举做了**三态区分**：空键显示 `(none)`、ACL 拒读显示 `(not readable without admin rights)`、键不存在同样归为 `(none)`——不要用 `-ErrorAction SilentlyContinue` 把拒读吞成"空"。

## 七、清理后须知（要告诉用户的）

- 之后**重新插过/连过的设备会生成新记录**（USB 项、WiFi profile、MTP 登记），属正常现象，不算清理失败；
- **蓝牙键盘/鼠标删配对后当场断连**，需重新配对（`-KeepBluetooth` 可避免）；
- WiFi 全删后首次连接要重输密码；
- 手机重新插 USB 选"文件传输(MTP)"会再登记便携设备；
- 在线 USB 设备的 USBSTOR 项是 PnP 即时重建的，不属历史痕迹。

## 踩坑速查表

| 症状 | 原因/解法 |
|------|-----------|
| Remove-Item 删 USBSTOR 报"该子项不存在"（键明明在） | Enum 键 ACL 管理员只读 + CurrentControlSet 符号链接键令 PS 错误失真；用 reg.exe 确认真实错误"拒绝访问"；正解 SYSTEM 计划任务（见专节） |
| 接管所有权 + FullControl 后仍删不掉 | Enum 父链同样受限，实测无解；直接上 SYSTEM 计划任务，别恋战 |
| 提权 payload 秒退、结果文件没生成、无任何输出 | 无 BOM UTF-8 含中文被 PS5.1 按 GBK 解析成假语法错（"字符串缺少终止符"）；提权脚本必须纯 ASCII |
| catch 日志打出来的键名/错误是空的 | catch 里 `$_` 是 ErrorRecord 不是管道项；键名用循环变量、错误用 `$_.Exception.Message` |
| NetworkList 删完"显示删了 0 项"/扫描显示空但实际有条目 | 普通权限读删都被拒（读报"不允许所请求的注册表访问权"，`Test-Path` 仍返回 True）；必须提权，且扫描代码要区分"空"与"拒读"，禁用 SilentlyContinue 吞错 |
| 扫描把"空键"误显示成"不可读" | PS5.1 空管道求值为 $null，`,$null` 解包回 $null（`,@()` 只保住字面空数组）；必须 `,@(Get-ChildItem ...)` 先 `@()` 收集再逗号保形。同理 `@($null)` 是**单元素**数组，foreach 会跑一次 null |
| netsh wlan delete profile 输出乱码 | GBK 输出乱码但删除实际成功（普通权限即可）；以删除后再 `show profiles` 复验为准 |
| `wevtutil cl` 某通道报错 | Bluetooth-BthLEEnum 等通道部分系统不存在；逐通道 try/catch 容忍失败 |
| `Get-WinEvent -ListLog` 的 RecordCount 显示空白 | 个别通道（如 Bluetooth-Policy）元数据 RecordCount 为 null；显示 `?` 即可 |
| 终验时 USBSTOR 又有条目 | 在线设备的项被 PnP 立刻重建，非历史痕迹；拔掉再验 |
| `schtasks /run` 后键还在就接着跑 | `/run` 异步；轮询 `Test-Path` 至键消失（设超时）再删任务、重建空父键 |
| UAC 点"否"后脚本退出非 0 | `Start-Process -Verb RunAs` 抛异常，属正常路径，提示用户即可 |
| Start-Process -ArgumentList 含空格路径被截断 | PS5.1 不自动加引号；元素手动 `('"{0}"' -f $path)` |
| Git Bash 里内联 `powershell -Command "...$u..."` 语法乱炸 | bash 把 `$u/$result/$_` 当自己的变量展开；复杂逻辑一律落 .ps1 用 `-File` 跑 |
