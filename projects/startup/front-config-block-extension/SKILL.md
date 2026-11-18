---
name: front-config-block-extension
description: startup 项目前台配置（tb_front_config / front/config 页面）新增一个 home_* 配置项的六步套路，及存量平铺排序键→sort_keys 优先级链化迁移的兼容套路。触发场景：给 front/config 加配置项、前台配置新增板块、tb_front_config 种子 SQL、FrontConfigCode 注册、分型表单（config_options/default_forms/v-else-if 模板块/排序优先级编辑器）、mergeForm 空数组表单死锁、normalize 规整、normalize 需传存量 config_value 原文、__ 瞬态字段剔除、配置消费端选前端还是后端、门户 HomePage 钳位兜底读配置、直连库改配置后不生效、本页保存前变更核对弹窗（config-diff/save-confirm-dialog）、保存确认原始值修改值核对、启停确认回拨、平铺排序键链化改造（旧键推导等价链/旧键废弃剔除/保存核对旧键噪音行/stringListConfig 数组读取/编辑器标准件通用化）。凡在 startup 给前台配置加 home_* 项、链化平铺排序键或排查其生效/保存核对问题，一律用本 skill。
project: D:\code\startup
---

# front/config 新增 home_* 配置项六步套路（home_notice 先例）

> 先例：home_notice「通知公告轮播」（2026-11-16 落地，SQL 见 `sql/2026-11-16.sql` home_notice 段）。此前还有 home_search/home_declaration/home_calendar/home_match 等十个先例，本 skill 把"新增一个"收敛成可照做的固定动作。

## 0. 底座认知（一分钟读懂链路，决定消费端前必读）

- **一行 = 一个配置项**：`tb_front_config(config_code 编码, config_value JSON 配置体, remark 键含义说明, sort_order 排序, status 启停)`。
- **下发链路**：pub 端启动时 `GET /front/config` 全量拉取 → store `mergeFrontTableConfig` 把 `home_` 前缀剥离并入 `mainSiteFrontConfig.home.xxx`（`home_notice` → `home.notice`，deep-merge：数组整组替换、对象逐字段合并）。
- **缓存链路（生效时机的全部根源）**：
  - 后台保存 → `FrontConfigService.evictPortalCaches()` 清 `portal:cache:home` 组（`@PortalCache` 键含**参数摘要**，配置变化不会自动失效，必须显式清组）→ pub 下次拉取即拿到新值 → **纯前端消费的键保存即时生效**。
  - 其他组（policy 等）的 `@PortalCache` 接口靠 TTL 兜底（聚合 600s）——若后端 Service 消费配置且其查询挂在别的组，接受 ≤TTL 延迟。
  - `PortalCacheAspect.buildKey` = `portal:cache:{group}:{类.方法}:{参数TreeMap排序序列化 sha256 前16位}` → **前端把 limit 等当请求参数传即可让不同参数各占一个键、即时生效**。
- **写穿透**：后台保存/新增自动重建 Redis 快照；**直连库执行 SQL 绕过写穿透** → 需重启 admin/pub（BaseRunner 重载 Redis 快照）或在后台把该配置重新保存一次。

## 六步

### 第 1 步：种子 SQL（两处同步）

- **日期增量** `sql/YYYY-MM-DD.sql` 加段：`DELETE FROM tb_front_config WHERE config_code = 'home_xxx';` + `INSERT`（按 config_code 先删后插，幂等）；段注释写清用途、键含义、幂等方式、以及「直连库执行需重启 admin/pub 或后台重新保存」。
- **基线** `sql/init_startup.sql` 同步种子行（tb_front_config INSERT 段按 sort_order 顺序排），保证只跑 init 能建出完整新库。
- **remark 把每个 JSON 键的含义、取值范围、枚举值写全**——列表页直接展示 remark，它是唯一文档（样例见 home_notice 种子行）。
- **remark 写作约定（纯中文 label 化，2026-11-18 全部 11 个配置项已统一改写）**：remark 面向后台列表页运营读者，用**纯中文 label 表述键与枚举值**——不出现英文键名/编码值（如写"排序优先级"不写 `sort_keys`，写"发布时间"不写 `release_time`）；键级对照以后台编辑表单为准（表单 label 即权威中文名）。改写只更 `remark` 不动 `config_value`，且同步 `init_startup.sql` 基行。写完后用**英文键名负向校验**自查：用全部旧键名清单（columns/row_gap/sort_keys/rotate_enabled/windowed_only/top_first/sort_field/release_time/create_time 等）跑 `\b(?:…)\b` 正则匹配 remark 文本，命中即回改。
- 固定列值：`id` 沿用段内递增手编号（如 `2076120965984594811`）；`sort_order` 接现有尾号（home_notice=110）；`status=1, valid=1, removed=0`；creator/updater=`1067246875800000001`；`origin_id=''`。

### 第 2 步：FrontConfigCode.java 注册编码常量

`startup-database` 的 `modules/frontconfig/FrontConfigCode.java` 加：

```java
/** 首页通知公告轮播（轮转开关/轮换间隔秒/悬停暂停/移开恢复延迟秒/参与轮换条数/排序优先级数组，门户前端消费） */
public static final String home_notice = "home_notice";
```

命名遵守项目强规**小写+下划线**；javadoc 一句话列键清单并标明消费端（门户前端消费 / 后端 Service 消费）。

### 第 3 步：admin-web 分型表单（add-or-update.vue 四处）

文件 `startup-admin-web/src/views/front/config/add-or-update.vue`：

1. `config_options` 加 `{ value: "home_notice", label: "通知公告轮播" }`（与种子 config_name 一致）。
2. `default_forms` 加编码→默认值工厂函数，**与 SQL 种子逐字段一致**（含 min/max 边界语义），数组字段用 `[...notice_sort_all_keys]` 拷贝而非共享引用。
3. template 加分型块：`<template v-else-if="dataForm.configCode === 'home_notice'">…</template>`（挂在已知编码链末尾）；不认识的编码自动落 JSON 兜底编辑，无需处理。
4. **排序优先级编辑器**（sort_keys 数组型配置的标准件，已通用化为跨编码共用）：`xxx_sort_key_meta: Record<key, {label, desc}>` 元数据 → `sort_chain_rows(model, all_keys, meta)` computed（启用键在前按数组序、停用键沉底置灰显示"—"；按编码实例化为 `notice_sort_rows`/`declaration_sort_rows`）→ `on_sort_chain_toggle`（开关，`sort_keys.length <= 1` 时禁用关闭防全停）+ `on_sort_chain_move`（上移/下移；两个操作函数均传 model）；CSS 类 `sort-chain-*` 共用。存量平铺排序键板块链化时的兼容要点见下文专节。
5. 保存不用单写：走通用 `JSON.stringify(form.model, (key, value) => key.startsWith("__") ? undefined : value)` 一行 replacer 剔除 `__` 瞬态字段，所有分型共用。

### 第 4 步（关键坑）：mergeForm 数组逐项合并 → 必配 normalize 函数

- `buildForm`/`init` 用 `mergeForm` 给存量 JSON 补新键默认：对象递归合并、**数组是"逐项按序合并"**（`parsed.map((item, i) => mergeForm(base[i], item))`）——存量 `config_value` 里 `sort_keys: []` 这类**空数组会原样保留**，表单出现零启用项，而排序开关的 disabled 依赖 `length >= 1` → **表单死锁**（一个键都开不了）。
- **解法**：凡 default_forms 含数组字段的编码，配一个 `normalize_xxx(model)`（过滤未知键 → 去重 → 空档回退默认全序），且**两处都要调用**：`onCodeChange`（新增切编码）和 `init`（`/front/config/info` 回来后）。样例 `normalize_notice`；链化改造类编码（旧平铺键收敛为 sort_keys）的 normalize 多一个可选第二参传存量 config_value 原文，见下文专节。
- 瞬态 UI 状态（折叠态 `__collapsed`、自定义态 `__icon_custom`、自动 key `__key_auto`）一律 `__` 前缀字段保存，保存时 replacer 统一剔除不落库。

### 第 5 步：消费端选择（动工前先定，放错边返工）

| 放哪边 | 适用 | 生效时机 | 先例 |
|---|---|---|---|
| **门户前端消费**（推荐） | 轮转间隔/悬停暂停/恢复延迟等**纯展示行为**、条数与排序在已知池内重排 | **保存即时生效**（保存清 home 组 → pub 重拉）；前端把 limit 当参数传请求（缓存键含参数摘要）各占一键 | home_notice：`loadNotices()` 取池 `latest(min(50, limit+20))` → 本地 `sortNoticeRows` 重排 → `slice(0, limit)` |
| **后端 Service 消费** | 榜单条数/排序键等参与 SQL 查询的 | 接受 ≤TTL 延迟（组缓存保存即清；挂在别的组的查询按该组 TTL 600s 兜底） | home_declaration / home_match |

注意：`@PortalCache` 键含参数摘要意味着**配置变化不会自动失效旧参数键**——这就是保存要显式清组的原因；新配置项若被别的组的接口间接消费，记得在对应 Service 的 `@PortalCacheEvict` 组清单里确认是否要带 home。

### 第 6 步：门户前端消费（store 零改动 + 页面钳位兜底）

- **store 不用改**：`startup-pub-web/src/store/index.ts` 的 `mergeFrontTableConfig` 自动把任何 `home_xxx` 并入 `mainSiteFrontConfig.home.xxx`。
- 页面端 computed 读配置**逐字段钳位兜底**（样例 `HomePage.vue` 的 `noticeConfig`）：
  - `clampInt(value, min, max, fallback)`：非数字/越界回退——边界与后台表单 min/max、种子 remark 写的范围**三处一致**；
  - 布尔开关 `cfg.x !== false`（缺省=开）；数组 `[...new Set(rawKeys.filter(已知键))]`，空回默认全序；
  - **缺省值 = 配置化前的线上行为**（如 resume_delay_seconds 默认 1 秒对应"配置化前立即恢复"要写进种子注释）。
- 轮转类定时器标准件：`startNoticeCarousel`（先 clearInterval 再启；轮转关闭/单条/空数据不启）+ `pauseNoticeCarousel`（clearTimeout 挂起的恢复定时器再暂停）+ `resumeNoticeCarousel`（setTimeout 延迟恢复）+ `beforeUnmount` 统一 `clearTimers` 收尾。
- 铁律：配置缺失/脏值时页面行为必须 = 配置化前行为，永不白屏。

## 保存前变更核对（2026-11-18 起保存必经）

- 本页保存/启停不再直落库：提交先经 `config-diff.ts` 构建变更明细（基础字段逐项 + 结构化模型递归 diff + JSON 兜底两侧可解析才递归否则整串对比），弹 `save-confirm-dialog.vue` 核对「变更项/原始值/修改值」，确认才调 `/front/config/save`；无变更 `ElMessage.info` 跳过保存。「原始值」取 `original_snapshot`（init 装载后封存，不随表单改动）。列表行内 el-switch 启停是轻量版（ElMessageBox「由「启用」修改为「停用」」+ 门户生效影响说明，取消/失败回拨开关）。
- **新增分型核对零登记成本**：`build_config_diff` 未登记键回退原键名、枚举回退原值，新 home_* 键自动可读可核对；想要中文路径段/枚举文案，往 `config-diff.ts` 三张映射表（key_labels 字段键 / item_labels 数组元素 / value_enums 枚举值）补登记即可。
- 通用模式与 diff 正确性坑（before 侧须走同一 buildForm 重建、`__` 瞬态剔除、原始值数组整体对比等）见通用技能 `save-confirm-diff-dialog`。

## 平铺排序键 → sort_keys 优先级链化改造的兼容套路（2026-11-18，home_declaration 先例）

适用：home_match/home_calendar 等仍是 `top_first/heat_first/sort_field` 平铺键的板块将来链化时照做。先例 `HomeDeclarationService.resolveSortKeys`（四键 top/in_period/release_time/create_time）。

- **配置体**：旧平铺键（置顶/期内布尔 + 时间字段二选一）收敛为 `sort_keys` 数组——链键固定清单，**缺省链 = 改造前线上行为**；种子 remark 注明「旧键废弃不再读取，存量缺 sort_keys 由后端按旧键推导等价链」（样例 `sql/2026-11-18.sql` home_declaration 段）。
- **后端消费**：`sort_keys` 缺失/空/全脏值 → 按旧键推导等价链（`booleanConfig(code, "top_first", true)` 等读旧键，**缺省 = 开**），保证已手动保存过的自定义配置行为不变；链外并列统一按 **id 倒序**兜底稳定。数组读取标准件 `FrontConfigService.stringListConfig(code, field, default)`：JSON 数组逐元素取文本、跳过对象/数组/空元素，null/非数组回 defaultValue——调用方再做白名单过滤与兜底。
- **admin 表单**：`normalize_xxx(model, config_value?)` **必须传存量 config_value 原文**——区分「sort_keys 是 default_forms 注入的默认链」还是「存量真有 sort_keys」；存量无 sort_keys 时从 model 旧键（mergeForm 已并入）推导等价链（旧键布尔缺省=开），并 `delete` 三个旧键（保存后配置体净化）；**不传 config_value 的调用（onCodeChange 新增）直接走缺省链**。
- **保存核对 before 侧同规整**：`build_confirm_rows` 的 before 侧（`buildForm(original_snapshot.configValue)` 重建后）也要走同一 normalize（同样传 configValue 原文），否则保存核对会冒出「top_first 等旧键将删除」的噪音行。
- **排序优先级编辑器标准件已通用化**：`sort_chain_rows(model, all_keys, meta)` / `on_sort_chain_toggle(model, key, on)` / `on_sort_chain_move(model, key, delta)`——传 model + 全键清单 + meta，不再绑定单一编码；CSS 类 `sort-chain-*`；notice 与 home_declaration 共用。
- **保存即时生效前提**：后端消费的链化板块查询接口须挂 `@PortalCache` home 组（保存 evictPortalCaches 清组），如 `/home/declaration`；挂别的组则接受 ≤TTL 延迟。

## 上线路径（推荐顺序）

1. **配置行还没建** → 直接在后台 front/config 页「新增」选编码保存：写穿透自动建 Redis 快照，**零重启即时生效**（推荐路径；种子 SQL 照常进日期增量与基线，供存量库/新库对齐）。
2. **直连库执行 SQL** → 绕过写穿透，需重启 admin/pub（BaseRunner 重载 Redis 快照）或在后台把该配置重新保存一次。
3. 仅改种子的 UPDATE 段（如 home_declaration 调默认值）不影响已手动保存过的存量配置——写明"仅更新种子默认值"。

## 关键文件清单

| 关注点 | 路径 |
|---|---|
| 种子 SQL 段 | `D:\code\startup\sql\2026-11-16.sql`（home_notice 段）、`sql\2026-11-18.sql`（home_declaration 链化段：DELETE+INSERT 种子 / UPDATE 存量默认值，remark 注明旧键废弃与推导兜底；末尾「列表说明统一中文 label 化」段=全量 11 项 remark 改写范例）、`sql\init_startup.sql`（约 2028 行，种子行按 sort_order 排） |
| 编码常量 | `startup-database\src\main\java\com\wondersgroup\startup\modules\frontconfig\FrontConfigCode.java` |
| 分型表单 | `startup-admin-web\src\views\front\config\add-or-update.vue`（config_options ≈632 行 / default_forms ≈866 行 / declaration 模板块 ≈409 行 / notice 模板块 ≈569 行 / 编辑器标准件 sort_chain_rows ≈1009 行 / normalize_notice ≈1112 行 / normalize_declaration ≈1126 行 / __ replacer ≈1309 行） |
| 变更明细构建 | `startup-admin-web\src\views\front\config\config-diff.ts`（key_labels/item_labels/value_enums 三表 + 递归 diff + strip_transient） |
| 核对弹窗 | `startup-admin-web\src\views\front\config\save-confirm-dialog.vue`（open({title,rows,on_confirm}) 命令式入口，失败保持打开可重试） |
| 保存核对接入 | add-or-update.vue（original_snapshot ≈977 / build_confirm_rows ≈1253，before 侧同走 normalize_declaration / 提交接入 ≈1309）；index.vue 行内启停 statusHandle ≈149 |
| 保存清组 + 数组读取 | `startup-database\...\frontconfig\service\FrontConfigService.java`（evictPortalCaches → PortalCacheGroups.home；stringListConfig ≈298 行：排序链 sort_keys 数组读取标准件） |
| 链化后端消费 | `startup-pub\src\main\java\com\wondersgroup\startup\modules\home\service\HomeDeclarationService.java`（resolveSortKeys ≈121：sort_keys 白名单过滤去重，缺失/空回旧键推导等价链缺省=开；链尾 id 倒序兜底）+ 同包 `HomePubController`（/home/declaration 挂 @PortalCache home 组） |
| 缓存键 | `startup-database\...\portal\cache\aspect\PortalCacheAspect.java`（buildKey：组+类.方法+参数摘要 sha256 前 16 位） |
| store 合并 | `startup-pub-web\src\store\index.ts`（mergeFrontTableConfig：home_ 前缀剥离 deep-merge，零改动） |
| 门户消费 | `startup-pub-web\src\pages\HomePage.vue`（noticeConfig ≈1311 行、loadNotices/sortNoticeRows/startNoticeCarousel/pauseNoticeCarousel/resumeNoticeCarousel ≈1474-1530 行） |

## 排查速查

- **改了配置门户没生效** → ① 直连库改的？后台重新保存一次或重启 admin/pub；② 消费接口挂在 policy 等别的组？等 TTL ≤600s；③ 总开关 `portal_cache_enabled` 被关？缺失视为开启。
- **表单开关全灰/动不了** → 存量 `sort_keys` 空数组没被 normalize，检查 `init` 与 `onCodeChange` 两处是否都调用了。
- **保存核对冒出「top_first/in_period_first/sort_field 将删除」噪音行** → before 侧没走链化 normalize：`build_confirm_rows` 里 `buildForm` 重建原始模型后要补调 `normalize_declaration(before_model, original_snapshot.configValue)`（同传原文）。
- **链化后旧配置排序变了** → 后端没做旧键推导等价链兜底：`sort_keys` 缺失/空时须按旧布尔/文本键（缺省=开）推导，保证已手动保存过的自定义配置行为不变；勿只认 sort_keys。
- **存量配置体残留废弃键** → mergeForm 只补缺不删多，残留无害；在 remark 注明"废弃不再读取"（home_calendar 的 include_* 与 home_declaration 旧排序键先例）。
- **新增键存量库没值** → 正常：缺键走前端/后端缺省兜底（钳位 fallback），不必强推 UPDATE 全量刷值。
- **改完 remark 列表页没变** → 列表页直读库，刷新即生效，无需重启；只有 `config_value` 改动才走缓存/写穿透链路。
