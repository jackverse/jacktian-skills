---
name: usb-disk-not-detected
description: 移动硬盘/U盘插入后 Windows 识别不到的完整排查流程：只读分层定位（Get-Disk/Get-Volume/Get-PnpDevice/ConfigManagerErrorCode 码表）→ 注册表排查（USBSTOR Start、设备 Enum 键 ConfigFlags、RemovableStorageDevices/StorageDevicePolicies/DenyDeviceIDs 设备策略）→ 过滤驱动排查（磁盘类 {4D36E967-...} 与 USB 类 {36FC9E60-...} 的 UpperFilters/LowerFilters，第三方过滤驱动是管控软件特征）→ 深度确认（Service/Driver 绑定 + DEVPKEY_Device_Children 子设备，区分"软件原因"与"硬盘本体未就绪"）→ 修复手段（Enable-PnpDevice、禁用启用循环、Remove-PnpDevice + pnputil /scan-devices、物理拔插换口）。三大环境大坑：Git Bash 内联 powershell -Command 时 $_ 被 bash 提前展开破坏（必须写 .ps1 用 -File）；PS 5.1 按系统 ANSI(GBK) 解码无 BOM UTF-8 的 .ps1 中文乱码致解析错误（脚本纯 ASCII，匹配中文设备名用 InstanceId 正则）；setupapi.dev.log 可能被清理/禁用（保密检查类环境常见）不能依赖。触发场景：移动硬盘插了没反应、U盘识别不到、磁盘管理里看不到盘、设备管理器黄色感叹号、USB 设备被禁用、设备管理器错误代码 22/28/10/43/45/52、移动硬盘灯亮但电脑不显示、硬盘有声音但读不出来、管控软件拦截 USB 存储；以及：设置/设备管理器显示"驱动程序无法使用"但盘不转、WD Elements/Elements SE 复合设备 SES Code 28 无害误报、SES 外壳服务驱动缺失、父设备枚举正常但 Get-Disk 无盘、setupapi.dev.log 不可用时用 Kernel-PnP/Configuration 事件日志还原插拔时间线、中文事件日志经 bash 管道乱码。
---

# 移动硬盘插入后 Windows 识别不到 —— 完整排查流程

## 适用场景

- 移动硬盘/U盘插入后资源管理器、磁盘管理（`diskmgmt.msc`）里都看不到；
- 设备管理器里设备带黄色感叹号，或设备"时隐时现"；
- 怀疑被管控软件/组策略禁用了 USB 存储，或硬盘本体（供电/盘体/转接板）故障。

**总原则：只读优先。** 先全部只读命令把软件层原因排查完，再动手修复；修复也只动"设备启用状态"，不碰数据。

环境前提：Windows PowerShell 5.1 即可（Get-PnpDevice / Get-PnpDeviceProperty 需要 5.1+；Win10/11 自带）。**不要重启/停起任何本地服务。**

## 环境大坑（本次实战踩过，务必遵守）

1. **Git Bash（MSYS）里内联 `powershell -Command "... $_ ..."` 会被 bash 提前展开破坏** —— `$_` 在 bash 双引号里展开为空/成串，命令语义全错。一律把 PowerShell 逻辑写成 `.ps1` 文件用 `powershell -ExecutionPolicy Bypass -File xxx.ps1` 执行。同理在 Git Bash 里直接跑 `reg.exe query ... /v Xxx` 时 `/v` 会被 MSYS 当 POSIX 路径转换而报"无效语法"（要写 `//v`），reg.exe 调用也尽量放进 `.ps1`。
2. **PS 5.1 读取无 BOM 的 UTF-8 `.ps1` 会按系统 ANSI（中文系统是 GBK）解码**，脚本里的中文字符串（含注释里的中文标点）会乱码导致解析错误/秒退无输出。`.ps1` 文件内容保持**纯 ASCII**；需要匹配中文设备名时，改用 **InstanceId 正则**（如 `USBSTOR\\DISK`、`SWD\\WPDBUSENUM`）代替中文。
3. **setupapi.dev.log 可能被清理或禁用**（保密检查类管控环境常见），不能依赖它做枚举历史佐证；只用 PnP 即态查询。
4. **`Get-PnpDeviceProperty` 对部分 Error 状态设备会报 0x80041008（无效参数）**（本次在 SSL VPN 虚拟网卡和 SES 设备上均复现）——回退用 `Get-CimInstance Win32_PnPEntity` 枚举后在 PS 里按 `DeviceID -eq` 匹配取 `ConfigManagerErrorCode`；**不要**用 DeviceID 拼 WQL filter（反斜杠/引号转义极易出错）。
5. **reg.exe 的 `/v` 和值名必须是两个独立参数**，`'/v Start'` 拼成一个字符串传会报"无效语法"（冒烟实测踩过）。
6. **中文 Windows 的事件日志/报告经 bash 管道会乱码**（GBK console 输出直接进 UTF-8 管道）：需要回看/存档的全量报告，用 `Out-File -Encoding utf8` 写临时文件再用 Read 工具读，不要靠 console 直出。`.ps1` 文件本体仍保持**纯 ASCII**；在脚本内设置 `[Console]::OutputEncoding = [Text.Encoding]::UTF8` 是安全的（中文只出现在数据/消息里，不出现在代码与注释中）。

## 排障流程（七步，只读 → 修复）

### 1. 看磁盘/卷是否出现（最上层）

```powershell
Get-Disk | Format-Table Number, FriendlyName, OperationalStatus, HealthStatus, Size
Get-Volume | Format-Table DriveLetter, FileSystemLabel, SizeRemaining, Size
```

- 磁盘出现但无卷 → 卷/分区/盘符问题（diskmgmt 里联机、分配盘符即可，不在本 skill 范围）。
- **磁盘根本没出现** → 进入第 2 步查 PnP 层。

### 2. 找问题设备（PnP 层）

```powershell
Get-PnpDevice -PresentOnly |
  Where-Object { $_.Status -notin 'OK','Unknown' } |
  Format-Table Status, Class, FriendlyName, InstanceId -AutoSize
```

重点看 `Class` 为 `DiskDrive` / `USB` / `WPD` 的条目。注意：FriendlyName 可能含中文，匹配用 Class + InstanceId 正则，如 `$_.InstanceId -match 'USBSTOR'`。

### 3. 取 ConfigManagerErrorCode 并对码表

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.Status -ne 'OK' } |
  ForEach-Object {
    $code = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ConfigManagerErrorCode').Data
    [pscustomobject]@{ Name = $_.FriendlyName; Class = $_.Class; Code = $code; Id = $_.InstanceId }
  } | Format-Table -AutoSize
```

常见码表（CM_PROB_*）：

| Code | 含义 | 常见原因 |
|------|------|---------|
| 22 | 设备被单独禁用（CM_PROB_DISABLED） | 设备管理器"禁用"、Enum 键 ConfigFlags=1、管控软件 |
| 28 | 驱动未安装（CM_PROB_FAILED_INSTALL） | 缺驱动；**复合设备的 SES 辅助 LUN 属无害误报，见下方专段** |
| 10 | 设备无法启动（CM_PROB_FAILED_START） | 驱动加载失败、过滤驱动拦截 |
| 43 | 设备报告失败（CM_PROB_FAILED_POST_START） | 硬件故障或驱动崩溃，看 UpperFilters |
| 45 | 当前未连接（CM_PROB_PHANTOM） | 历史残留"幽灵设备"，非本次插入 |
| 52 | 驱动签名问题（CM_PROB_UNSIGNED_DRIVER） | 未签名/签名被策略拦截 |

**Code 28 的 SES 误报（WD Elements 等复合设备，2026-11-13 实战）**：WD 移动硬盘是复合设备（一个 USB 设备下挂两个 LUN：磁盘 LUN + SES 辅助 LUN）。SES（SCSI Enclosure Services，外壳 LED/辅助通道）Windows 无自带驱动、靠 Windows Update 装，装不上就常年 Code 28，其 Enum 键 ConfigFlags=0x40（CONFIGFLAG_FAILEDINSTALL，注意**不是** DISABLED 的 0x1）。设置 app/设备管理器把这个**子设备**的报错显示在**父设备产品名**下（如"Elements SE 2623 - 驱动程序无法使用"），造成"驱动坏了所以盘不工作"的错觉。**SES Code 28 不承载数据、不影响磁盘 LUN 工作**，判定时直接当噪音忽略，不要往"驱动坏了"方向修。

配套结论：**WD 移动硬盘的磁盘 LUN 用系统内置 disk.inf（GenDisk 兼容 ID 匹配）即可启动，无需任何厂商驱动**——"厂商驱动丢失"在这个故障域里根本不存在，不要去找/装 WD 工具包驱动来"修"。

### 4. 注册表排查（禁用与策略层）

逐项 `reg query` 或 PS 读取（**只读，先不改**）：

```powershell
# 1) USBSTOR 全局禁用：Start=4 表示服务被全局禁用（正常=3）
reg query "HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR" /v Start

# 2) 问题设备单独禁用：设备 Enum 键下的 ConfigFlags（1=CONFIGFLAG_DISABLED）
#    Enum 键路径：HKLM\SYSTEM\CurrentControlSet\Enum\<InstanceId 按 \ 分段>
reg query "HKLM\SYSTEM\CurrentControlSet\Enum\USB\VID_xxxx&PID_yyyy\<serial>" /v ConfigFlags

# 3) 组策略"可移动存储访问"类策略
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\RemovableStorageDevices" /s

# 4) 写保护/设备策略（StorageDevicePolicies 的 WriteProtect 等）
reg query "HKLM\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies" /s

# 5) 设备安装限制（DenyDeviceIDs / DenyDeviceClasses，管控软件/策略拦截特征）
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\DenyDeviceIDs" /s
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\DeviceInstall\DenyDeviceClasses" /s
```

判读：Start=4 → 全局禁 USB 存储（改回 3 需提权）；ConfigFlags=1 → 该设备被单独禁用；DenyDevice* 有值 → 被安装策略拦截。

**排除"管控软件禁用"必须把完整清单全跑一遍**：USBSTOR Start、StorageDevicePolicies、RemovableStorageDevices、DenyDeviceIDs/DenyDeviceClasses、磁盘/USB 类 Upper/LowerFilters、**每个相关设备的 Enum ConfigFlags**。机器上装了多个安全类软件（如 iNode、Lenovo 电脑管家/火绒、深信服、格尔 PKI、保密检查系统 ISO 挂载卷）**不等于有禁用**——必须以证据为准：没有任何一层留痕，就不算禁用，不要被"装了一堆安全软件"带偏方向。

### 5. 过滤驱动排查（管控软件特征）

第三方"管控/加密/审计"类软件常给磁盘类/USB 类挂过滤驱动。**正常只有 partmgr、EhStorClass**，出现其他值（厂商名、*Filter、*Guard 等）即管控特征：

```powershell
# 磁盘类 {4D36E967-E325-11CE-BFC1-08002BE10318}
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Class\{4D36E967-E325-11CE-BFC1-08002BE10318}" /v UpperFilters
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Class\{4D36E967-E325-11CE-BFC1-08002BE10318}" /v LowerFilters
# USB 类 {36FC9E60-C465-11CF-8056-444553540000}
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Class\{36FC9E60-C465-11CF-8056-444553540000}" /v UpperFilters
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Class\{36FC9E60-C465-11CF-8056-444553540000}" /v LowerFilters
# USBSTOR 服务键自身
reg query "HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR" /s
```

### 6. 深度确认：软件原因 vs 硬件本体

对问题设备（InstanceId）执行：

```powershell
$id = '<InstanceId>'
# Service/Driver 是否已绑定（disk 类应绑定 disk 或 USBSTOR）
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Service'
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Driver'
# 磁盘节点下有无 partmgr 子设备（正常应有 SWD\WPDBUSENUM 或 partmgr 子节点）
Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_Children'
```

**判定口诀**：

> 父 USB 设备枚举 OK + `USBSTOR\Disk` 子节点 Status=OK / IsPresent=True / disk.sys 已绑定（Service 非空）
> + Children 为空（无 partmgr 子设备）+ **Get-Disk 无此盘** + 物理不转
> = **硬盘本体未就绪**：供电不足起转失败（USB 口供电不够、Y 型线只插了一头、hub 供电弱），或盘体/转接板硬件故障。
> 与"禁用/驱动/策略类"软件原因（第 3~5 步能查到东西）明确区分。

**"PnP 节点 OK"与"存储栈有盘"是两回事**——节点状态好只说明驱动绑定完成，不代表介质已就绪。判定必须用 Get-Disk 与 DEVPKEY_Device_Children **交叉验证**，不要只看设备管理器全绿就下"软件没问题"的结论。这一步是实战的关键：PnP 栈一切正常但盘不转/不就绪时，继续折腾软件无意义，应转硬件处置（换口/换线/外接供电/送修）。

### 7. 修复手段（按代价从低到高）

```powershell
# a) 设备被单独禁用 → 启用（需提权）
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command',
  "Enable-PnpDevice -InstanceId '<InstanceId>' -Confirm:`$false"

# b) 禁用/启用循环（强制驱动重载）
Disable-PnpDevice -InstanceId '<InstanceId>' -Confirm:$false
Enable-PnpDevice  -InstanceId '<InstanceId>' -Confirm:$false

# c) 删除设备节点后重新扫描（幽灵设备/配置损坏时有效，需提权）
Remove-PnpDevice -InstanceId '<InstanceId>' -Confirm:$false
pnputil /scan-devices

# d) 终极手段：物理拔插、换 USB 口（优先直连后置口，不经过 hub）、换线
```

注册表类修复（USBSTOR Start 改回 3、清 ConfigFlags、删 DenyDevice* 值）需提权且**先导出备份**（`reg export`），并先与机主/管控方确认是策略要求而非误伤。

## 时间线还原：Kernel-PnP/Configuration 事件日志（setupapi.dev.log 被清理时的好工具）

setupapi.dev.log 不可依赖（见环境大坑 3）时，**Kernel-PnP/Configuration 日志是插拔历史时间线还原的好工具**（管控机器同样可用，普通权限可读）：

```powershell
Get-WinEvent -FilterHashtable @{
    LogName    = 'Microsoft-Windows-Kernel-PnP/Configuration'
    StartTime  = (Get-Date).AddDays(-3)
} | Format-Table TimeCreated, Id, LevelDisplayName, Message -AutoSize -Wrap
```

关注事件 Id：

| Id | 含义 |
|----|------|
| 400 | 设备已配置（installed/configured） |
| 410 | 设备已启动（started） |
| 420 | 设备已删除（removed）——能看到用户在设置里点"删除此设备"的记录 |
| 430 | 需要进一步安装（驱动仍未就绪） |
| 442 | 设置未迁移 |

**实战判读示例（WD Elements）**：昨天该设备有 410（disk.inf 启动成功）→ 证明历史能正常工作；今天同一设备只有父设备 arrival 而无磁盘节点的 410/介质到达 → 当前未就绪。"历史工作证明 + 当前未就绪"两条凑齐，直接定硬件，软件层无需再排查。中文系统下 Message 里 InstanceId（`USBSTOR\DISK...`、`USB\VID_...`）是 ASCII，可用 `-match 'USBSTOR|USB\\VID_'` 过滤定位目标设备。

## System 事件日志甄别：先过滤背景噪音

按"设备插入时刻之后才出现、且 Provider 与存储相关"过滤，以下均是与 USB 存储无关的背景噪音，不要被带偏：

- **Schannel 36871** TLS 错误（代理软件引起，常见且与本案无关）；
- **服务启动类型来回切换（Event 7040）**：如 Lenovo PCManager 与 Defender 互相拉扯；
- Hyper-V / FilterManager 等开机即有的事件。

## 速查判定表

| 现象 | 根因 | 动作 |
|------|------|------|
| Get-Disk 无盘，PnP 无问题设备 | 枚举都没发生 | 换口/换线/查 hub 供电（硬件） |
| 设置/设备管理器显示"驱动程序无法使用"，但盘在 Get-Disk 里正常 | SES 辅助 LUN Code 28（无害误报） | 忽略，不当磁盘故障修 |
| Code 22 + ConfigFlags=1 | 设备单独禁用 | Enable-PnpDevice |
| USBSTOR Start=4 | USB 存储全局禁用 | 提权改回 3（确认非管控要求） |
| DenyDeviceIDs/Classes 有值 | 安装策略拦截 | 找管控方/清策略 |
| Upper/LowerFilters 多出第三方 | 管控过滤驱动 | 定位管控软件，勿擅自删 |
| 父 USB OK + USBSTOR\Disk 子节点 OK + Children 空 + Get-Disk 无盘 + 物理不转 | 盘体未就绪/硬件故障 | 供电/转接板/盘体处置 |
| Kernel-PnP 昨天有 410、今天只有父 arrival 无磁盘 410 | 历史能工作+当前未就绪 → 硬件 | 时间线定案，转硬件处置 |

## scripts/diagnose.ps1

只读诊断脚本模板（纯 ASCII，分层输出第 1~6 步结果 + Kernel-PnP 时间线），用法：

```powershell
powershell -ExecutionPolicy Bypass -File diagnose.ps1            # 全量只读扫描
powershell -ExecutionPolicy Bypass -File diagnose.ps1 -InstanceId 'USB\VID_xxxx&PID_yyyy\...'
powershell -ExecutionPolicy Bypass -File diagnose.ps1 -Since '2026-11-12 09:00'   # Kernel-PnP 起始时间
powershell -ExecutionPolicy Bypass -File diagnose.ps1 -ReportFile "$env:TEMP\usb-diag-report.txt"
# ↑ 中文系统事件日志内容经 bash 管道会乱码，全量报告用 -ReportFile 输出 UTF-8 文件再读
```

**不要**在 Git Bash 里内联 `powershell -Command` 跑带 `$_` 的管道，脚本一律 `-File` 执行。
