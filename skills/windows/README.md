# windows — Windows 系统排障类

不绑定具体开发栈、换一台 Windows 机器仍然适用的**排障/诊断**向经验（设备、驱动、服务、注册表、系统行为异常根因定位）。以"清理/操作"为主的经验归 `system/`，以"排障/根因定位"为主的经验归本分类。

| 子目录 | 范围 | 现有 skill |
|--------|------|-----------|
| usb-disk-not-detected/ | 移动硬盘/U盘插入后 Windows 识别不到的完整排查：Get-Disk/Get-PnpDevice 只读分层、ConfigManagerErrorCode 码表、USBSTOR/过滤驱动/设备策略注册表排查、枚举正常但盘体未就绪的硬件判定、修复手段 | usb-disk-not-detected |

## 约定

- 后续 Windows 排障经验（外设/驱动/服务/系统行为异常等）沉淀为平级子目录，并在上表登记范围。
- **生效方式不变**：sync.ps1 递归发现所有 SKILL.md，在 `~/.zcode/skills/` 平铺 junction，skill 目录名（=name）必须与技能名一致，勿改。
- 诊断脚本放各 skill 的 `scripts/`，**脚本内容保持纯 ASCII**（PS 5.1 按系统 ANSI(GBK) 解析无 BOM UTF-8 会乱码报错；bash 内联 `powershell -Command` 会提前展开 `$_`，一律 `-File` 执行）。
