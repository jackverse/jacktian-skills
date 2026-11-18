---
name: startup-change-record-extension
description: startup 项目「通用字段级修改记录」机制（changerecord 模块）给新业务模块接入的六步套路与机制内幕。触发场景：后台改动要留痕、给某业务表加字段级修改记录、改了哪个字段从哪改成哪、"修改记录"按钮/弹窗接入、tb_change_record 查询、新增漏记排查、JSON 配置体拍平 diff、菜单按钮权限 front:config:change-log 类、修改记录展示口径。凡在 startup 给后台模块接修改记录/排查修改记录没记上，一律用本 skill。
project: D:\code\startup
---

# 通用字段级修改记录——startup 接入套路（startup-change-record-extension）

> 先例：前台配置（tb_front_config，2026-11-16 落地，SQL 见 `sql/2026-11-16.sql`）。机制底座：`startup-database` 的 `modules/changerecord`。通用方案原理与七条设计决策见通用 skill `aop-field-change-record`（skills/backend/），本文件只讲 startup 的具体路径与接入步骤。

## 0. 机制底座（改错必读）

全部在 `startup-database/src/main/java/com/wondersgroup/startup/modules/changerecord/`：

| 关注点 | 文件 | 要点 |
|---|---|---|
| 方法级注解 | `annotation/ChangeRecord.java` | `entity`（枚举成员）+ `action`（动作文案）+ `add_action`（默认"新增"）；挂 Controller 写方法 |
| 字段登记注解 | `annotation/ChangeRecordField.java` | `value` 中文名、`json=true` JSON 拍平模式、`labels={"0=停用","1=启用"}` 值翻译；**白名单制，不标不比对** |
| 业务表登记枚举 | `enums/ChangeRecordTableName.java` | 成员名=表名（如 `tb_front_config`），构造参数 `(Entity.class, Dao.class, "titleField属性名")`，title 属性进 `biz_title` 冗余 |
| 切面 | `aspect/ChangeRecordAspect.java` | @Around：proceed 前 selectById 旧快照 → 正常返回后重查真实新值 → differ diff 落库；入参主键自动解析（数值实参/数组/带 id 请求体，两次解析合并去重）；异常上抛不记录；diff/落库失败 log.warn 不阻断业务 |
| diff 器 | `support/ChangeRecordDiffer.java` | 普通字段/labels 翻译/JSON 拍平叶子路径（`.key`、`[i]`）三模式；同一次 diff 共享一个 `new Date()`（前端分组依赖） |
| JSON 路径中文映射 | `support/ChangeRecordJsonLabels.java` | 整路径精确 map + 未登记回退原路径（键名表 × 下标表预展开）；新 JSON 配置键零登记即可被记录 |
| 查询服务 | `service/ChangeRecordService.java` | `list(ChangeRecordTableName, id)` 按 create_date 倒序，**上限 200 行**（`list_max_rows`） |
| 表 | `tb_change_record` | entity_name+entity_id 通用关联 + biz_title/field_name/field_label/old_value/new_value/action，索引 `(entity_name, entity_id, create_date)` |

配套前端：通用弹窗组件 `startup-admin-web/src/components/change-record-dialog/src/change-record-dialog.vue`（props `url` + `ref.open(entityId)`，组头=时间+操作人+动作、组内字段行 原始值→目标值 3 行截断悬浮全文）。

## 1. 新模块接入六步

以 tb_front_config 为样板（`modules/frontconfig`）：

1. **实体字段标 `@ChangeRecordField`**：业务实体（如 `FrontConfigEntity`）上把要留痕的字段逐一标注中文名；状态/开关类加 `labels`；JSON 配置体字段加 `json = true`。主键/审计列不标。
2. **枚举登记**：`ChangeRecordTableName` 加成员 `tb_xxx(XxxEntity.class, XxxDao.class, "标题属性名")`。注意枚举/final 成员遵守项目强规小写+下划线（`tb_front_config`、`title_field`）。
3. **Controller 接线**（`startup-admin` 模块业务 Controller）：
   - 写方法（save/update 合一方法、delete、status/top 等）逐个挂 `@ChangeRecord(entity = ChangeRecordTableName.tb_xxx, action = "保存配置")`；
   - **Service insert 后回填主键**：`dto.setId(entity.getId())`——否则新增场景切面解析不到主键，**新增漏记**（最高频坑）；
   - 加查询薄端点：
     ```java
     @GetMapping("change-record/{id}")
     @RequiresPermissions(Xxx.xxx_change_log)
     public Result<List<ChangeRecordDTO>> changeRecord(@PathVariable("id") Long id) {
         return new Result<List<ChangeRecordDTO>>().ok(changeRecordService.list(ChangeRecordTableName.tb_xxx, id));
     }
     ```
4. **权限常量**：模块权限常量类加 `public static final String xxx_change_log = "xxx:xxx:change-log";`（小写+下划线强规；看记录权限独立于编辑权限）。
5. **SQL 三处同步**（强规，见根 AGENTS.md「SQL 变更必须同步维护 init 基线」）：
   - 日期增量 `sql/YYYY-MM-DD.sql`：按钮权限 DELETE-INSERT + SYS_LANGUAGE 多语言；
   - `sql/init_menu.sql`：顶部幂等 DELETE IN 清单与 INSERT 段**两处都加**；
   - `tb_change_record` 建表已在 `sql/init_startup.sql`（无需重复，但新业务表本身的基线照常维护）。
6. **前端列表页**（仿 `views/front/config/index.vue`）：
   ```ts
   import ChangeRecordDialog from "@/components/change-record-dialog/src/change-record-dialog.vue"; // 直接 import src 路径
   const moreOpenMap = reactive<Record<number, boolean>>({});
   const onMoreVisible = (id: number, visible: boolean) => { moreOpenMap[id] = visible; };
   ```
   模板：操作列「更多」el-dropdown 收纳「修改记录」入口（v-if hasPermission(`xxx:xxx:change-log`)，箭头 `moreOpenMap[id]` 旋转交互，`@visible-change`）；页面尾部放 `<change-record-dialog ref="changeRecordRef" url="/xxx/yyy/change-record"></change-record-dialog>`，点击项调 `changeRecordRef.value.open(row.id)`。仿 inno/agency/audit.vue 引 numeric-audit-dialog 的既有模式。

## 2. 排查速查

| 症状 | 先查 |
|---|---|
| 新增没记上 | Service insert 后是否回填 `dto.setId(...)`（六步-3）；`add_action` 场景依赖 proceed 后重新解析入参主键 |
| 改了没记上 | 实体字段是否标了 `@ChangeRecordField`（白名单制）；方法是否正常返回（业务响应失败不记录） |
| 记录字段值不对 | 切面是 proceed 后重查库取真实新值——Service 内部置 null 的保护字段不会进记录；若记错说明业务表没真落库 |
| 删除记不出"删除" | 逻辑删行仍在、零 diff 自动落汇总行——检查是否误在 Service 里改了登记字段值 |
| 一次修改裂成多组 | 同一次 diff 是否共享一个 `new Date()`（改过切面/differ 则核对） |
| JSON 字段整串一行 | 实体字段漏 `json = true`；或两侧一侧解析不出 JSON 容器回退整体比对（符合预期） |
| JSON 新键展示英文路径 | 正常——未登记路径原样展示；要中文就去 `ChangeRecordJsonLabels` 补路径登记 |
| 记录不全 | `ChangeRecordService.list` 上限 200 行（`list_max_rows`），属设计预期 |
| 落库失败静默 | 切面 diff/落库 catch 后仅 log.warn 不阻断业务——查 startup-database 日志 |

## 3. 参考实现索引（照抄起点）

| 关注点 | 文件 |
|---|---|
| 全套机制（注解/切面/differ/枚举/服务） | `startup-database .../modules/changerecord/`（见 §0 表） |
| Controller 接线样板 | `startup-admin .../frontconfig/controller/FrontConfigController.java`（save/delete/status 挂注解 + `GET change-record/{id}`，权限 `front_config_change_log`） |
| Service 主键回填样板 | `startup-database .../frontconfig/service/FrontConfigService.java`（insert 后 `dto.setId`） |
| 实体字段登记样板 | `startup-database .../frontconfig/entity/FrontConfigEntity.java`（含 json=true、labels 用法） |
| 建表 SQL | `sql/2026-11-16.sql`、`sql/init_startup.sql`（tb_change_record 段） |
| 按钮权限菜单 SQL | `sql/2026-11-16.sql`、`sql/init_menu.sql`（front:config:change-log） |
| 前端弹窗组件 | `startup-admin-web/src/components/change-record-dialog/src/change-record-dialog.vue` |
| 前端页面接入样板 | `startup-admin-web/src/views/front/config/index.vue`（更多下拉 + moreOpenMap + dialog） |
