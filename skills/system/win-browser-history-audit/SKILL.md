---
name: win-browser-history-audit
description: Windows 上浏览器上网历史记录的 SQLite 审计与定向删除完整管线：Chrome/Edge/Firefox 历史库定位（多 Profile 含 Guest/System Profile）、Node 22 --experimental-sqlite 直读（setReadBigInts 防 Chrome 时间戳 RangeError）、只读审计先行（复制快照→总数/时间跨度/Top域名/匹配明细→用户确认）、定向删除完整关联表（visits/keyword_search_terms/segments/downloads_url_chains/Shortcuts/Top Sites/Favicons 逐库逐表 introspect 动态匹配）、备份+VACUUM 真擦除+integrity_check 复验。触发场景：查上网记录/浏览记录审计、删浏览器历史、定向删除某域名的访问痕迹、隐私清理、清理 google 记录前的本地清理、myactivity 云端残留告知、误删排查、离职交接清理电脑、History/places.sqlite 打不开、sqlite database is locked、node 读 sqlite 报 RangeError。
---

# 浏览器上网历史记录的 SQLite 审计与定向删除（Windows）

## 适用场景

- **审计**：查"这台机器上什么时间访问过什么网站"，出总数/时间跨度/Top 域名/目标域名明细报告。
- **定向删除**：把某域名（或子串）的全部本地痕迹从浏览器历史里擦掉——不是只删 `urls` 表，而是清理全部关联表 + 辅助库，删除后 VACUUM 真正擦除数据页。
- 典型触发：隐私清理、误访问记录定向删除、交接/回收电脑前清理、配合 myactivity.google.com 的 Google 记录删除做本地侧清理。

在 Windows 11 + Node v22.12（无 sqlite3 CLI、Windows Store python 是假 stub 的环境）上实战验证。Firefox 路径按 places.sqlite 标准 schema 实现，本次实战以 Chrome/Edge 为主验证。

## 流程总论（安全前提，顺序不可乱）

1. **只读审计先行**：先把库**复制到临时目录**分析（绝不直接开原库），出审计报告给用户确认。
2. **检查浏览器进程**：删除前用 `tasklist` 检查 `chrome.exe / msedge.exe / firefox.exe` 是否在跑。浏览器运行时历史库被锁（`database is locked`），**必须让用户自己关闭浏览器**（全局规范：不重启/杀用户已开的进程）。
   - **`msedgewebview2.exe` 不是浏览器主进程**——它是其他 app（微信、Outlook 等）内嵌的 WebView 组件，不锁浏览器历史库，**不要误判**。tasklist 判断要引号精确匹配 `"msedge.exe"`，否则子串匹配会撞上 `msedgewebview2.exe` 造成永远"浏览器在运行"的假阳性。
3. **删除前备份原库**（含 `-wal/-shm/-journal` sidecar）到 `%TEMP%` 时间戳目录。
4. **删除 + VACUUM + 复验**：`DELETE` 只是标记删除，**必须 `VACUUM` 才真正擦除数据页**；WAL 库还要 `PRAGMA wal_checkpoint(TRUNCATE)` 清掉 wal 里的残留；最后 `PRAGMA integrity_check` 校验 + 重新按列名匹配计数确认为 0。

## 一、历史库位置（多 Profile 都要扫）

| 浏览器 | 库文件 | Profile 枚举方式 |
|--------|--------|------------------|
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\History` | 枚举 `User Data` 下**含 History 文件的子目录** |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data\<Profile>\History` | 同上 |
| Firefox | `%APPDATA%\Mozilla\Firefox\Profiles\<profile>\places.sqlite` | 枚举 `Profiles` 下含 places.sqlite 的子目录 |

- **不要按名字猜 Profile**：实测目录有 `Default`、`Profile 2`…`Profile 6`（**目录名含空格**）、`Guest Profile`、`System Profile`——全部要扫，正确做法是"该目录下存在 History 文件"就纳入。
- 复制快照时把 `History`、`History-wal`、`History-shm` 一起拷（没有就跳过），打开快照时 SQLite 会自动从 wal 恢复，否则最近写入的记录丢失。

## 二、Node 直读方案（无 sqlite3 CLI / python 是假 stub 时）

- **Node 22 必须加 flag**：`node --experimental-sqlite xxx.mjs`（v22 的 `node:sqlite` 是实验特性，不加 flag 直接 import 报错；脚本里用动态 import + try/catch 兜底提示）。
- **`stmt.setReadBigInts(true)` 必须开**：Chrome 时间戳（1601 纪元微秒，如 `13317802684575462`，约 1.3e17）**超出 Number 安全整数（2^53≈9e15）**，不开直接 `RangeError`。
- **BigInt 与 Number 不能混算**（JS 里 `bigint + number` 抛 TypeError），换算时要显式：`Number(us / 1000n) - 11644473600000`。
- 写脚本用 `DatabaseSync`/`StatementSync` 同步 API 即可，无需任何第三方依赖。

## 三、时间戳换算

| 库 | 格式 | 换算 |
|----|------|------|
| Chrome/Edge（History 及全部辅助库） | 微秒自 **1601-01-01 UTC** | `new Date(Number(us / 1000n) - 11644473600000)`（11644473600000 = 1601→1970 的毫秒差） |
| Firefox（places.sqlite PRTime） | 微秒自 **Unix epoch** | `new Date(Number(us / 1000n))` |

## 四、删除不能只删 urls 表——完整关联表清单

只 `DELETE FROM urls` 后复查历史页看似干净，但访问明细、搜索词、下载链还留在关联表里，**等于假删除**。Chrome `History` 库完整清单（存在才删，顺序先子后父）：

| 表 | 关联列 | 说明 |
|----|--------|------|
| `context_annotations` / `content_annotations` | `visit_id` | 访问注解，先于 visits 删 |
| `visit_source` | `id`（=visit id） | 访问来源 |
| `visits` | `url`（→urls.id） | 访问明细主体 |
| `keyword_search_terms` | `url_id` | **搜索词明文，泄露隐私的重点** |
| `segments` / `segment_usage` | `url` / `segment_id` | 自动分段统计 |
| `downloads_url_chains` | `url`、`id`（→downloads.id） | **下载 URL 重定向链，极易漏删** |
| `downloads` | `tab_url` / `tab_referrer_url` | 下载记录本体 |
| `urls` | — | 最后删父表 |

> 注意：`visits.url`、`visited_links.link_url_id`、`moz_historyvisits.place_id` 这类关联列存的是**整数 id**，对它们做 `LIKE '%域名%'` 永不匹配——必须先收集父表命中的 id，再用 `IN` 子查询/join 删子表。脚本内置了这个两段式逻辑，并带逐表删除行数日志（这才是真正的复验依据）。

**同 Profile 目录下的辅助库同样会"露馅"，一起清**（每个是独立 SQLite 文件，无扩展名）：

| 库文件 | 表 | 说明 |
|--------|----|------|
| `Shortcuts` | omnibox 联想表 | 地址栏输入联想仍带被删 URL |
| `Top Sites` | top_sites | 新标签页"常用网站" |
| `Favicons` | `icon_mapping`(`page_url`)/`favicons`(`url` **或** `icon_url`，字段名两代 schema 不一致)/`favicon_bitmaps`(`icon_id`→favicons.id) | 站点图标；删 favicons 前先按 icon_id 删 bitmaps |

## 五、隐藏表陷阱：必须逐库逐表 introspect

不同 Chrome 版本的 History 库存在文档不常提的表（如 `visited_links` 带 `top_level_url`/`frame_url` 列、clusters 系列带 `visit_id`）。**复验时必须逐库逐表 introspect，不能只查已知表**：

```js
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all();
  // 按列名动态匹配：url / page_url / tab_url / original_url / top_level_url / frame_url …
}
```

- 删除逻辑写成"**按列名 url-like 动态匹配**"的兜底扫描，已知表精确处理（含 FK 链），未知表靠兜底扫，两不误。
- **删除后必须复验**：重新 introspect 所有 url-like 列计数，确认目标域名残留为 0。

## 六、只读审计先行的标准流程

1. 复制库文件（含 sidecar）到 `%TEMP%` 快照目录 → 打开快照分析（浏览器在跑也能审计，只是最近几秒可能没落盘）。
2. 报告内容：总 URL 数 / 总访问数 / 时间跨度 / Top 域名（按 `urls.visit_count`）/ 目标域名匹配明细（URL + 标题 + 访问次数 + 最后访问时间）+ `keyword_search_terms` 命中的搜索词。
3. 给用户确认后再动原库。浏览器在运行时**跳过写操作**并明确告知"请关闭浏览器后重试"。

## 七、云端残留必须告知用户

Chrome 登录并开启同步时，**myactivity.google.com 有云端历史副本，本地删除不清云端**。要彻底删需用户自己在 Google 活动记录页操作（或"我的活动"按域名删除）。Edge 同理（Microsoft 账户活动）。Skill 输出和脚本结尾都要打印这条提示。

## 脚本用法（scripts/ 目录，零依赖，仅 Node ≥ 22）

```bash
# 只读审计（不碰原库）：指定目标域名，扫全部浏览器全部 Profile
node --experimental-sqlite scan.mjs --domain example.com

# 只概览不指定域名 / 只扫某浏览器 / 只扫某 Profile
node --experimental-sqlite scan.mjs --browser chrome
node --experimental-sqlite scan.mjs --domain example.com --browser edge --profile "Profile 2"

# 删除：默认 dry-run 只打计划；--yes 才真正删（自动先备份）
node --experimental-sqlite delete.mjs --domain example.com          # dry-run 预览将删行数
node --experimental-sqlite delete.mjs --domain example.com --yes    # 备份→删除→VACUUM→复验
```

脚本内置：多 Profile 枚举（含空格目录名）、`msedgewebview2.exe` 甄别、运行中浏览器跳过、备份、事务化删除、隐藏表兜底扫描、VACUUM + wal checkpoint(TRUNCATE) + integrity_check + 复验、云端残留提示。dry-run 同样只在 `%TEMP%` 快照副本上统计，**不碰原库**；`--yes` 实删路径可用假 `LOCALAPPDATA`/`APPDATA` 目录 + 仿真库先行演练（实测一次即验证全链删除行数、零误伤、书签保护）。

## 踩坑清单（速查）

| 症状 | 原因/解法 |
|------|-----------|
| 读 `visit_time` 报 `RangeError` | 未开 `setReadBigInts(true)`；BigInt 与 Number 混算报 TypeError，用 `Number(us/1000n)` 显式转换 |
| `database is locked` | 浏览器主进程在跑，锁原库；让用户关闭浏览器。审计用复制快照不受影响 |
| tasklist 判断"浏览器在运行"永远为真 | 子串匹配撞上 `msedgewebview2.exe`；必须引号精确匹配 `"msedge.exe"`，webview2 不锁历史库 |
| 删了 urls 表历史页还在/复搜还在 | 只删了父表；visits/keyword_search_terms/downloads_url_chains/Shortcuts/Top Sites/Favicons 全链清理 |
| **`visits` 一行都没删但"复验通过"** | `visits.url` 是**整数外键**，`LIKE '%domain%'` 对整数永不匹配——必须先收集 urls.id 再按外键 `IN` join 取 visit id；同理 `visited_links.link_url_id`、Firefox 的 `moz_historyvisits.place_id`。且复验只数 url 文本列会**假阴性**，要靠逐表删除行数日志核对 |
| **书签保护的记录仍被删掉** | Firefox 兜底 url 扫描会把显式删除时保住的 `moz_places` 行（被 `moz_bookmarks.fk` 引用）一并删掉；兜底扫描必须排除已做保护语义的表 |
| Firefox 查 `moz_places` 报 `no such column: last_visit_time` | 新版 Firefox 列名是 `last_visit_date`（旧版 `last_visit_time`）；按 PRAGMA table_info 动态取 |
| 删除后取证工具仍能恢复数据 | 只 DELETE 未 VACUUM；删后 `VACUUM` + `PRAGMA wal_checkpoint(TRUNCATE)` |
| 快照缺最近的记录 | 没拷 `-wal/-shm`；三件套一起拷 |
| 某辅助库列名对不上 | Favicons 的列名两代 schema 不同（`url` vs `icon_url`、`page_url`）；按 PRAGMA table_info 动态取列名，不要写死 |
| Windows Store `python` / `sqlite3` 命令跑不起来 | 前者是假 stub、后者多半没装；直接用 Node 22 `node:sqlite` 零依赖方案 |
