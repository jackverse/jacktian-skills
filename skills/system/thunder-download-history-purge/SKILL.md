---
name: thunder-download-history-purge
description: Windows 迅雷下载记录的定位、审计与彻底清理管线：检查类工具"上网记录信息"报告（域名网址/疑似度/最近访问时间/访问次数/软件名称/硬盘名称）中"软件名称=迅雷"时的数据源逆向（安装目录 Profiles\TaskDb.dat SQLite 主库 TaskBase/P2spTask、TaskDbEx.dat 同构库、historys.json 内置浏览器历史、ProgramData\Thunder Network 升级组件、%APPDATA%\thunder leveldb 缓存）、迅雷+XL 系后台进程甄别退出、快照只读审计（域名 LIKE 反查+年份分布）、任务表全链 DELETE+VACUUM 真擦除+字节级复验。触发场景：保密检查/安全检查整改、检查工具上网记录报告里有迅雷记录、清理迅雷下载历史、删 TaskDb.dat、迅雷痕迹审计、上网痕迹清理、离职/回收电脑前清理、卸载迅雷前清残留、TaskBase/P2spTask 表、historys.json、XLLiveUD 记录、涉密载体检查、node --experimental-sqlite 读 dat。
---

# 迅雷下载记录的定位、审计与彻底清理（Windows）

## 适用场景

- 保密检查/安全检查类工具扫出的"上网记录信息"报告（列：域名网址 / 疑似度 / 最近访问时间 / 访问次数 / 软件名称 / 硬盘名称）里出现大量**软件名称=迅雷**的条目——这些条目的数据源不是浏览器，而是**迅雷本地任务库**，要清理得去迅雷自己的库删。
- 迅雷下载历史的审计（什么时间下载过什么）与彻底清理（连同空闲页残留一起擦掉）。
- 离职交接/回收电脑/涉密载体检查前的上网痕迹清理的迅雷专项。

## 一、来源定位（报告里的"迅雷"记录从哪来）

| 数据源 | 内容 | 说明 |
|--------|------|------|
| `<迅雷安装目录>\Profiles\TaskDb.dat` | **SQLite 主库** | `TaskBase` 表是任务总表（`Url`/`Name`/`CreationTime`(unix 毫秒)/`SavePath`/`TaskType`）；`P2spTask` 是 HTTP 下载明细（含 RefUrl 来源页）；`user_file` 是云盘文件列表缓存（含 `original_url`） |
| `<迅雷安装目录>\Profiles\TaskDbEx.dat` | 同构备用/回收库 | 同一批记录**再存一份**，只清 TaskDb.dat 会漏一半 |
| `<迅雷安装目录>\Profiles\historys.json` | 新版迅雷内置浏览器历史 | JSON 格式 `{url: {lastAccessTime, visits, visitCount, name}}` |
| `C:\ProgramData\Thunder Network\` | 升级组件 XLLiveUD 的下载记录 | 补丁包/组件下载文件，文件级痕迹 |
| `%APPDATA%\thunder\` | 新版客户端 Chromium 内核缓存 | leveldb 格式，内置页面访问痕迹 |

- 检查工具按域名归因到"迅雷"，是因为 `TaskBase.Url` 里存着完整下载 URL——**用报告截图里的域名 LIKE 反查 TaskBase 即可确认来源**，这一步是审计的锚点。
- `.dat` 扩展名有迷惑性，实际就是 SQLite 文件，直接用 node:sqlite / sqlite3 打开即可。

## 二、审计流程（只读先行）

1. **迅雷必须先退出**——不只是主进程 Thunder.exe，还有 **XL 系后台组件**（XLLiveUD / XLServicePlatform 等）。`tasklist | grep -iE "thunder|xunlei"` **会漏掉 XL 前缀的进程，要单独 grep `^xl`**（正则 `/^(thunder|xunlei|xl)/i` 一次覆盖）。
2. 复制 `TaskDb.dat`（+`TaskDbEx.dat`，有 `-wal/-shm` 顺带）快照到 `%TEMP%` 再分析，不碰原库。
3. `node --experimental-sqlite`（`DatabaseSync`, `readOnly: true`）列出全部表结构和行数——**先 introspect 再动手**，不同迅雷版本表集合有差异。
4. 用报告截图中的域名 `LIKE '%域名%'` 反查 `TaskBase.Url` 确认数据源，核对报告里的"最近访问时间/访问次数"与 `CreationTime`/行数是否对得上。
5. 按 `strftime('%Y', CreationTime/1000, 'unixepoch', 'localtime')` 统计年份分布，圈定清理范围。

## 三、清理流程（顺序不可乱）

1. 进程检查不过关直接拒绝执行（运行中删库轻则锁库失败重则库损坏，让用户自己从托盘退出迅雷）。
2. **备份原库**到 `%TEMP%\thunder-backup-<时间戳>\`（备份本身含全部敏感记录，结尾必须提醒用户确认后自行删除）。
3. **DELETE 任务相关表**（存在才删，配置表保留）：

   | 类别 | 表 |
   |------|-----|
   | 任务主表/明细 | `TaskBase` / `P2spTask` / `BtTask` / `EmuleTask` / `BtFile` / `GroupTask` / `ThunderPanTask` / `PlayList` |
   | 云盘/辅助 | `CloudAddFail` / `PanPluginUploadHistory` / `user_file` / `AccelerateTaskMap*` |
   | 记录类 | `message_*` / `group_search_history` |
   | **保留** | `Module` / `Category` 等配置表（删了不影响，但没必要；空库不影响迅雷使用） |

4. **必须 `VACUUM`**：SQLite 删行只是把页标记为空闲，数据字节仍在文件里，**不做 VACUUM 等于没删**——检查工具照样扫得出来。WAL sidecar 若存在一并清。
5. `historys.json` 写回 `{}`。
6. **复验三件套**：重查清理清单表行数=0 → 对 `.dat` 文件做字节级搜索（utf8 + utf16le 双编码 `Buffer.indexOf`，域名命中=0）→ 文件体积收缩。**小库 VACUUM 后可能仍不缩体积（还在页边界内），残留判定以字节搜索为准，别拿体积当唯一依据。**
7. 迅雷下次启动自动重建空任务库，不影响使用；但新下载会重新积累记录，**清理后要再下东西的话先想清楚**。

## 四、坑与注意

| 症状/风险 | 原因/解法 |
|-----------|-----------|
| 只清了 TaskDb.dat，报告复扫还剩一半 | `TaskDbEx.dat` 同构库存了同一批记录的再存份，两个库都要清 |
| `grep -i thunder` 看似没有迅雷进程但库仍被锁 | XL 系后台组件是 `XL` 前缀（XLLiveUD/XLServicePlatform），tasklist 过滤词要加 `^xl` |
| `grep` 直接搜二进制文件找 UTF-16 字符串会漏 | TaskDb.dat 实际是 SQLite/UTF-8，本场景普通 grep 可用；但通用场景（Windows 软件 protobuf/注册表/leveldb）字符串常是 UTF-16LE，记得 `iconv -f UTF-16LE` 或 `strings -el` 双查再下"不存在"的结论 |
| 删了表字节搜索还能命中 | 没做 VACUUM，数据还在空闲页；DELETE 后必须 VACUUM |
| VACUUM 后体积没变 | 小库在页边界内属正常，权威判据是字节级搜索=0 |
| 检查工具做磁盘残留级取证（已删文件恢复） | 删库+VACUUM 只覆盖**当前文件内**的数据页，文件系统层旧副本/已删文件仍可恢复；需 `cipher /w:X:` 全盘空闲空间覆写等手段（耗时较长，机械盘尤其慢），涉密场景按保密要求处理 |
| 备份目录本身是敏感源 | 备份含全部记录原样副本，留在 `%TEMP%` 并明确告知用户确认后自行删除 |
| 云端记录 | 本地清理不动迅雷账号服务器侧数据（云盘文件、账号任务记录），需用户在迅雷客户端/网页端另行处理——审计报告里必须写明这条边界 |
| `node:sqlite` import 报错 | Node 22 要 `--experimental-sqlite` 标志；`CreationTime` 等毫秒时间戳在 Number 安全范围内，无需 BigInt |

## 脚本用法（scripts/thunder-history.mjs，零依赖，Node ≥ 22）

```bash
# 只读审计（快照副本上分析，不碰原库）：域名来自检查报告截图
node --experimental-sqlite thunder-history.mjs --audit --domain pan.baidu.com

# 显式指定库位置（自动扫描常见安装路径失败时）
node --experimental-sqlite thunder-history.mjs --audit --domain example.com --dat "D:\Thunder\Profiles\TaskDb.dat"

# 清理：默认 dry-run 只打计划；--yes 才真正删（自动先备份到 %TEMP%）
node --experimental-sqlite thunder-history.mjs --purge --domain pan.baidu.com            # dry-run 预览
node --experimental-sqlite thunder-history.mjs --purge --domain pan.baidu.com --yes      # 备份→DELETE→VACUUM→复验
```

脚本内置：TaskDb.dat/TaskDbEx.dat/historys.json 三件套自动处理、`^(thunder|xunlei|xl)` 进程甄别（purge 遇运行中进程直接拒绝）、快照审计、清理清单表逐表行数日志、VACUUM、historys.json 置空、行数+字节双编码搜索+体积三重复验、备份自删/云端残留/取证级擦除三条收尾提示。dry-run 不写任何文件。

> 仿真库验证要点：构造含 TaskBase(含中文文件名+unix毫秒时间戳)/P2spTask/user_file/message_*/AccelerateTaskMap_*/Module/Category 的假库，跑 audit→dry-run→--yes 全链，验证删除行数、配置表保留、字节零残留三处，即可确认脚本无损可用。
