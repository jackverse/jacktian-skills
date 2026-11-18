# system — 系统级操作类

不绑定具体开发栈、换一台 Windows 机器仍然适用的本机系统操作经验:

| 子目录 | 范围 | 现有 skill |
|--------|------|-----------|
| win-browser-history-audit/ | 浏览器上网历史记录(SQLite)的审计与定向删除:Chrome/Edge/Firefox 历史库位置、Node 直读 sqlite、关联表清理、隐私清理 | win-browser-history-audit |
| thunder-download-history-purge/ | 迅雷下载记录的定位、审计与彻底清理:检查报告"软件名称=迅雷"的数据源逆向(TaskDb.dat/TaskDbEx.dat/historys.json)、XL 系后台进程甄别、快照审计+任务表 DELETE+VACUUM+字节级复验 | thunder-download-history-purge |
| windows-update-silent-install/ | Windows 更新无人值守静默安装(不触发重启):COM API 扫描/下载/安装、UAC 提权+日志轮询+心跳、宿主进程消失≠失败的真相三条验证、Get-HotFix 巡检口径、usoclient 不可依赖 | windows-update-silent-install |
| win-usb-wifi-bt-trace-clean/ | 外接设备与无线网络痕迹清理(USB 存储/便携设备 MTP/WiFi/蓝牙/已知网络/事件日志):痕迹源清单与权限边界、USBSTOR Enum 键管理员只读需 SYSTEM 计划任务删、UAC 提权结果文件回传、提权脚本纯 ASCII 纪律、清机交接场景 | win-usb-wifi-bt-trace-clean |

## 约定

- 后续 Windows 系统级经验(注册表、服务、计划任务、文件清理、系统诊断等)沉淀为平级子目录,并在上表登记范围。
- **生效方式不变**:sync.ps1 递归发现所有 SKILL.md,在 `~/.zcode/skills/` 平铺 junction,skill 目录名(=name)必须与技能名一致,勿改。
- 新类目建目录时同步新建本层 README.md 登记范围(参考 skills/frontend/README.md 格式)。
