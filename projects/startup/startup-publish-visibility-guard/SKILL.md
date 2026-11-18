---
name: startup-publish-visibility-guard
description: startup 项目六个门户内容域（政策/政策解读/活动/产业科技/双创展厅/创业故事，含寻技术）未发布、下架、删除内容防门户曝光的排查清单与接入套路——后台主列表/详情、我的收藏、首页推荐独立缓存、搜索索引事件、寻技术自动同步下架、ES 批量删除六个曝光面逐一核查；以及后台 topFlag/notifyFlag/policyCalendarVisibility 发布确认提示与列表标题列标识的统一实现。触发场景：下架了门户还能看到、未发布内容泄露、首页推荐旧缓存不消失、搜索还能搜到已下架、收藏列表失效标记、ES 删除失败/不刷新、发布确认框提示、置顶/月历图标、新增内容模块防曝光接入。
project: D:\code\startup
---

# 未发布/下架门户防曝光排查清单 + 发布提示统一套路

> 先例：2026-11 防曝光加固一轮——六个推荐域补 `RecommendSource.visibleIds`、寻技术全写路径补搜索索引事件、收藏加实时回查、首页榜单缓存命中后复核、ES 批量删除加 refresh+失败抛错、后台发布确认提示统一。

## 0. 总口径：看得到的 = 已发布的

- 全站逻辑删除，可见口径三件套：`valid=1 + removed=0 + release_status=PUBLISHED`（`inno/enums/ReleaseStatus`，1=已发布 2=下架）。
- 栏目型模块再叠加：activity 按 `catalog_code`（活动动态/活动报名）、story 按 `catalog_code`（故事汇/百佳十强/科技金融案例）、agency 按 `org_type2`（E1 载体 / C1 投资机构）。
- 防曝光不是单点：同一条数据有**六个旁路出口**，任何一个漏掉就是"后台下架了、门户还看得到"。排查/接入时按下表逐面过。

## 1. 六个曝光面 × 核查点（排查清单）

| # | 曝光面 | 核查点 | 参考实现 |
|---|--------|--------|----------|
| 1 | 后台主列表/详情（pub 查询） | `startup-pub` 各 PubService 的列表与详情查询必须带三件套 + 栏目条件；`@PortalCache` 只加速不负责正确性，失效靠后台 Service 类/方法 `@PortalCacheEvict(groups)`（变更方法守 save/update/delete/publish/offline/top... 前缀命名） | `PolicyPubService`、`TechnologyPubService`、`PortalCacheGroups` |
| 2 | 我的收藏 | ①`UserFavoriteService.add()` 收藏前实时回查 `visible()`（不存在/未发布/已下架/已删除一律抛「内容不存在或尚未发布」）；②列表 `fillTargets()` 对不可见行 `title=null + invalid=true`；③新收藏类型必须进 `supports` 注册表（可见口径与门户详情一致，机构类叠加 org 条件） | `user/service/UserFavoriteService` |
| 3 | 首页推荐独立缓存 | 榜单整份存 Redis `home:recommend:rank`（TTL `rank_cache_seconds` 默认 60s），**不接 @PortalCacheEvict**——`@PortalCacheEvict(home)` 清不掉它。缓存命中后必须 `filterVisible(rows)`：按 type 分组调 `RecommendSource.visibleIds(ids)` 批量复核，剔除已下架/删除项。`visibleIds` 是接口方法**无 default**，新来源不实现编译期就拦住（防默认放行泄露） | `startup-pub .../recommend/service/HomeRecommendService`、`RecommendSource` 及六个实现 |
| 4 | 搜索索引（ADR-0012） | 后台 Service **所有写路径**（save/update/delete/publish/offline/top/cancelTop/confirmSync/批量/同步落库）都要 `searchIndexEventPublisher.publish(type, id)`；一表多类型用 `publishStory/publishActivity/publishAgency` 全类型发（错误类型事件只会删不存在的文档，天然幂等）。事件事务 afterCommit 才发（回滚不发）；消费端在 **startup-task** `SearchIndexConsumer` → `SearchDocService.build` 不满足 `searchable` 即删文档。`searchable` 与 `wrapperOf` 两处口径必须同步 | `search/mq/SearchIndexEventPublisher`、`search/service/SearchDocService` |
| 5 | 自动同步下架（寻技术） | 源站缺失检测：本轮窗口未出现的已发布行 `release_status=OFFLINE + expired_time + offline_reason="原网站找不到"`；**仅 `updated>0` 才计数+发搜索事件**（0 行更新发事件=日志噪音/计数虚高）。同步 Service 类上挂 `@PortalCacheEvict(groups={technology, home})` 兜缓存失效 | `inno/service/TechnologySyncService`（源站缺失检测段） |
| 6 | ES 批量删除 | `ElasticsearchSearchIndexStore.deleteByIds` 必须 `.refresh(Refresh.True)`（不刷新则删完立查仍命中，防曝光链路失效）且 `response.errors()` 时汇总失败项抛 `IllegalStateException`（最多列 `failed_detail_limit=5` 条样例），**禁止吞错**——静默部分失败=残留泄露。upsertAll 同款纪律 | `search/es/ElasticsearchSearchIndexStore` |

## 2. 新内容模块接入防曝光 checklist（按序自检）

1. pub 列表/详情查询带三件套 + 栏目条件（对照同域既有 PubService）。
2. 后台 Service 类挂 `@PortalCacheEvict`，变更方法守统一命名前缀。
3. 后台 Service 每个写路径发 `searchIndexEventPublisher`（新 `SearchResourceType` 枚举 + `SearchDocService` 的 `searchable`/wrapper/doc 三处登记）。
4. 收藏：`FavoriteBizType` 加枚举 + `UserFavoriteService` 构造器 `register(...)`。
5. 若上首页推荐榜：`RecommendSource` 实现类实现 `visibleIds`（带完整可见口径，别只查发布）。
6. 自有 Redis 缓存（不接 @PortalCacheEvict 的）：读路径补"命中后按可见口径复核"。
7. 排查存量：`rg -n "searchIndexEventPublisher" startup-database/.../inno/service/XxxService.java` 核对写路径无遗漏；`rg -n "ReleaseStatus.PUBLISHED" startup-pub/...` 核对查询口径。每日对账 `SearchReconcileService` 只兜事件丢失，**不能替代**第 3 步。

## 3. 后台发布提示与列表标识统一套路（admin-web + 后端配套）

单一事实源：`startup-admin-web/src/utils/list-operation.ts` 的 `publish_switch_fields`。**加新开关只改这一处 + 列表图标两小块**。

### ① 发布确认提示（列表 + 表单共用）

- `publishSwitchNote(row)`：只列当前已开启（`=== 1`）的开关，文案「该内容已开启置顶、政策月历展示，发布后将在门户对应位置展示」；无开启不弹。
- `batchPublishSwitchNote(selections)`：按开关汇总条数「所选内容中有 2 条开启置顶、1 条开启政策月历展示…」。
- `confirmPublish(title, row)`：表单"保存并发布"复用；无提示时直接 resolve 不打断。
- 列表行/批量发布：`useListOperation` 的 `publishHandle/batchPublishHandle` 自动带 note，页面零改动。
- 下架联动提示已有独立文案：`notifyFlag=1` 下架会同步取消推送（后端 `noticeService.cancelNotify` 联动），单条与批量（含条数）分文案。

### ② 表单"保存并发布"（置顶类开关只读不提交）

置顶等列表级开关**只用于提示、不参与表单提交**，防旧快照回写覆盖列表操作：

```ts
const readonlyTopFlag = ref(0);        // getInfo 时 readonlyTopFlag.value = d.topFlag ?? 0
if (publish) {
  confirmPublish(dataForm.title, { topFlag: readonlyTopFlag.value })
    .then(submit)
    .catch(() => undefined);           // 取消必须 catch，防 unhandled rejection
} else { submit(); }
```

- 提交 payload 不含 `topFlag`（或后端置 null），`init` 时归零。
- 后端配套（**必须成对做**）：`update()` 里 `ConvertUtils` 转 entity 后 `entity.setTopFlag(null); entity.setTopTime(null);`——MyBatis-Plus update null 字段不落列，编辑表单就覆盖不了列表置顶。先例：`AgencyService`、`PolicyGuideService`、`HatchService`、`LoanService` 等（存量只置了 topTime 的都在补 topFlag）。

### ③ 列表标题列标识

- 标题列流式小图标 + tooltip：既有 `topFlag` 星标（`StarFilled`），`policyCalendarVisibility` 月历标（`Calendar`，仅 policy / policy-guide 两页有此字段），样式类 `color: var(--el-color-primary); vertical-align: -2px`。
- 加新标识三步：`@element-plus/icons-vue` import 图标 → 标题列 `v-if="scope.row.xxx === 1"` 加 tooltip 图标 → `<style>` 加 `.xxx-icon` 类。
- 非默认标题字段的列表页记得 `useListOperation(basePath, refresh, { titleKey: "question" })`（FAQ 是 question，贷款 productName，机构 orgName）。

## 4. 踩坑速查

| 坑 | 后果 | 正解 |
|----|------|------|
| 编辑表单回写 topFlag/topTime 旧快照 | 列表置顶操作被编辑静默清掉 | 后端 update 置 null + 前端 readonly 回显不提交 |
| 首页榜单 Redis 独立缓存当 @PortalCache 缓存对待 | 下架内容在首页滞留一个 TTL | 命中后 `filterVisible` 按 `visibleIds` 复核 |
| `visibleIds` 只查 release_status 漏栏目条件 | story/activity 跨栏目串台（A 栏目下架 B 栏目还显示） | 带全口径：三件套 + catalog/org 条件 |
| ES bulk delete 不带 refresh / 吞 errors | 删完仍搜得到；部分失败残留无感知 | `Refresh.True` + errors 抛 `IllegalStateException` |
| 自动同步 offline 0 行更新也发事件/计数 | 日志噪音、offlined 统计虚高 | `updated>0` 才计数+发事件 |
| 收藏 add 不回查 | 用户可收藏未发布 id，稍后列表 title=null 才暴露 | add 前实时 `visible()` 回查 |
| 新写路径不发搜索事件 | 依赖每日对账修复，窗口期泄露 | 写路径全部补 `publish`；对账只是兜底 |
| confirm 取消不 catch | 控制台 unhandled rejection | `.catch(() => undefined)` |

## 5. 参考实现索引（照抄起点）

| 关注点 | 文件 |
|---|---|
| 榜单缓存命中复核 / 重建 | `startup-pub .../recommend/service/HomeRecommendService.java` |
| visibleIds 六实现（含 story 三栏目/activity 栏目口径） | 同目录 `PolicyRecommendSource`、`PolicyGuideRecommendSource`、`ActivityRecommendSource`、`IndustryTechRecommendSource`、`ExhibitionRecommendSource`、`AbstractStoryRecommendSource` |
| 收藏注册表/回查/失效标记 | `startup-database .../user/service/UserFavoriteService.java`、`user/enums/FavoriteBizType.java` |
| 搜索事件发布/事务后发/多类型 | `startup-database .../search/mq/SearchIndexEventPublisher.java` |
| 可检索判定与文档构建（口径双处） | `startup-database .../search/service/SearchDocService.java` |
| 搜索消费（单应用） | `startup-task .../search/consumer/SearchIndexConsumer.java` |
| 每日对账兜底 | `startup-database .../search/service/SearchReconcileService.java` |
| ES 批量删除 refresh+抛错 | `startup-database .../search/es/ElasticsearchSearchIndexStore.java` |
| 自动同步下架 | `startup-database .../inno/service/TechnologySyncService.java`（源站缺失检测段） |
| 发布提示/开关单一事实源 | `startup-admin-web/src/utils/list-operation.ts` |
| 表单只读置顶 + confirmPublish | `startup-admin-web/src/views/inno/policy/add-or-update.vue`、`policy-guide/`、`policy-express/`、`policy-faq/`、`policy-interaction/`、`technology/` 同名文件 |
| 月历列表标识 | `startup-admin-web/src/views/inno/policy/index.vue`、`policy-guide/index.vue` |
| topFlag 置 null 先例 | `startup-database .../inno/service/PolicyGuideService.java`（update）、`AgencyService`、`HatchService` 等 |
