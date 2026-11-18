---
name: aop-field-change-record
description: Spring Boot 后台业务数据的「字段级修改记录」切面化方案——独立审计表（一行=一个字段变更，entity_name+entity_id 通用关联）+ 方法级注解（@ChangeRecord 挂 Controller 写方法）+ 字段登记注解（@ChangeRecordField，含中文名/值翻译/JSON 模式）+ @Around 切面「方法前查旧快照 → 正常返回后重查真实新值 → 逐字段 diff 落库」。触发场景：后台改动要留痕、字段级审计日志、修改记录（原始值→目标值）展示、操作时间线、新增/删除记动作汇总行、JSON 配置体拍平 diff、谁改了哪个字段从哪改成哪、"修改记录"弹窗按钮权限。凡要给后台 CRUD 加"改了什么、谁改的、什么时候改的"审计能力都应参考。
---

# 字段级修改记录切面化方案（aop-field-change-record）

## 何时使用

后台管理系统需要回答「这条数据被谁、什么时候、把哪个字段从什么改成什么」，且不想要重量级方案（Envers/Hibernate 实体版本表、全量表快照镜像）。适合：MyBatis-Plus/Spring Data 类项目的后台写接口（保存/删除/启停/上下架），记录粒度要求到字段级，同时保留「新增/删除」这类动作时间线。

不适合：需要字段值全版本回溯回滚的（审计表只存前后值，不做版本链）；高频写接口（每写一次 diff 一次，量大了要采样或异步化）；纯操作日志（谁点了什么按钮，用 @LogOperation 类操作日志即可，不必建字段级审计）。

## 核心方案一句话

> **独立审计表（一行 = 一个字段变更）+ 方法级注解声明动作 + 实体字段登记注解声明参与比对 + @Around 切面「方法前 selectById 取旧快照 → 方法正常返回后重查库取真实新值 → 逐登记字段 diff 落库」。**

## 一、审计表设计：一行 = 一个字段变更

```sql
CREATE TABLE tb_change_record (
    id          BIGINT PRIMARY KEY,
    entity_name VARCHAR(64),   -- 业务表名/类名（通用关联键①）
    entity_id   BIGINT,        -- 业务主键（通用关联键②）
    biz_title   VARCHAR(255),  -- 业务标题冗余快照（列表展示，避免回查业务表）
    field_name  VARCHAR(64),   -- 变更字段属性名（汇总行为空）
    field_label VARCHAR(64),   -- 字段中文名（含 JSON 叶子路径的中文映射结果）
    old_value   TEXT,          -- 原始值（JSON 叶子模式=叶子路径旧值）
    new_value   TEXT,          -- 目标值
    action      VARCHAR(64),   -- 动作文案（"保存配置"/"删除配置"…）
    -- 标准审计列：creator/create_date（建议同一次 diff 共享一个 Date，见决策6）
);
CREATE INDEX idx ON tb_change_record(entity_name, entity_id, create_date);
```

关键点：**不要每业务表建一张审计表**。`entity_name + entity_id` 两列即可通用关联任意业务表；查询端点天然统一为 `GET change-record/{id}`（entity_name 由服务端按模块固定，不信任前端传）。

**新业务表接入登记**：用一个枚举集中登记「哪些业务表开启了修改记录」，枚举成员名 = 表名字符串，携带 diff 所需三件元数据：

```java
public enum ChangeRecordTableName {
    tb_front_config(FrontConfigEntity.class, FrontConfigDao.class, "configName");
    // entity_class：反射读登记字段的来源；dao_class：切面按主键查前后快照；title_field：biz_title 冗余
}
```

注解 `@ChangeRecord(entity = ChangeRecordTableName.tb_xxx, ...)` 直接引用枚举成员——比传字符串表名安全（编译期校验、携带类型化元数据、IDE 可跳转）。

## 二、两个注解

```java
@Target(METHOD) @Retention(RUNTIME)
public @interface ChangeRecord {
    ChangeRecordTableName entity();          // 目标业务表（枚举成员）
    String action();                          // 动作文案（修改零变更/删除等汇总行展示）
    String add_action() default "新增";        // 方法执行前库中无该主键时的新增汇总行动作
}

@Target(FIELD) @Retention(RUNTIME)
public @interface ChangeRecordField {
    String value();                           // 字段中文名（记录行展示）
    boolean json() default false;             // JSON 配置体模式：拍平叶子路径 diff（见决策5）
    String[] labels() default {};             // 值翻译 "码值=中文"，如 {"0=停用","1=启用"}（见决策7）
}
```

字段登记是**白名单制**：实体上没标 `@ChangeRecordField` 的字段（主键/审计列/内部字段）不参与比对、不落记录。这样审计列（modifier/create_date 等）天然不会被记成"变更"。

## 三、切面流程（@Around）

```
拦截标 @ChangeRecord 的 Controller 写方法
  ├─ proceed 前：从方法入参解析业务主键（数值实参 / 数值数组 / 带 id 属性的请求体对象，
  │    支持 MultipartFile/ServletRequest/ServletResponse 跳过）→ 按 dao_class selectById 取旧快照
  ├─ proceed()：方法抛异常 → 原样上抛、不记录
  ├─ proceed 正常返回后：再按同一主键 selectById 取库中真实新值
  │    ├─ 旧无 新有 → 新增场景
  │    ├─ 旧有 新无 → 删除场景（逻辑删行还在，靠"零 diff"判定，见决策3）
  │    └─ 两边都有 → 逐登记字段 diff
  ├─ 落库规则（见决策4）：有字段变更→仅字段行；零变更/新增/删除→1 条动作汇总行
  └─ diff/落库任何异常 → catch 静默告警（log.warn），不阻断业务主流程
```

## 四、七条关键设计决策与踩坑（方案成败所在）

1. **用「方法后重查库」而非「diff 请求 DTO」**。Service 内部常有保护逻辑把请求 DTO 的敏感/权限字段置 null 再落库，diff DTO 会记出"幽灵变更"；proceed 后重查库 100% 反映实际落库状态，且切面不需要知道 Service 内部逻辑。代价是多一次主键查询（写接口频度下可忽略）。

2. **新增场景请求 DTO 无主键 → insert 后回填 + 两次解析合并去重**。切面 proceed 前从入参解析主键时 DTO.id 是 null，查不到旧快照即判"新增"；但落记录需要 entity_id——Service 必须在 insert 后回填 `dto.setId(entity.getId())`，切面 proceed 后**重新解析一次入参主键**，与第一次解析结果合并去重（编辑场景两次结果相同去重为 1，新增场景第一次 null 第二次有值取第二次）。**漏掉回填则新增永远记不出记录**——这是接入新模块最高频的踩坑。

3. **逻辑删（removed=1）行仍在库中，切面无感、零特殊分支**。删除走逻辑删时，proceed 后 selectById 仍能查到行；被删实体上通常没有登记字段值变化，天然零 diff → 按决策4 落 1 条"删除"汇总行。**不要**在切面里写"检测 removed 标志"之类的分支——只要删除接口的 Service 不动登记字段的值，零 diff 规则自动覆盖。物理删则查不到行，按"新无"判定，同样零分支。

4. **记录粒度三态**：有字段变更 → 只记字段行（原始值→目标值，不额外记动作行，避免同一次修改双份）；零变更/新增/删除 → 1 条动作汇总行（field 相关列为空，仅 action 文案）——保留操作时间线（"谁什么时候动过这条数据"，即使没改出字段差异）。方法抛异常或业务响应失败（`Result.code != 0` 类）不记录任何行。

5. **JSON 配置体字段拍平叶子路径 diff**。字段值是 JSON 串时（`json = true`），两侧解析后递归拍平到叶子（对象键路径 `.key`、数组下标 `[i]`），变更的每个叶子路径各记一行（如 `services[2].title`）；两侧任一侧解析不出 JSON 容器（一边是 JSON 一边是普通串）回退为整体字符串比对。路径中文映射用「**整路径精确 map + 未登记回退原路径**」：只登记已知配置结构的路径（代码里按 键名表 × 数组下标表 预展开），未登记的新路径照常被记录、只是展示为英文路径——**新增配置项零登记成本**，不会漏记。

6. **同一次 diff 共享一个 `new Date()`**。一次修改可能落 N 行字段记录，若每行各取当前时间会出现毫秒级参差，前端按「时间+操作人+动作」分组时会裂成多组。切面入口取一次时间、操作人，全组行共用。

7. **值翻译与超长截断**。状态类字段用 `labels = {"0=停用","1=启用"}` 在落库前把码值翻译成中文（diff 比较码值、记录存中文，展示端零逻辑）；超长文本值按展示列宽截断并加省略尾标（如 `…[共N字]`），前端弹窗再做 3 行截断+悬浮全文兜底——两层截断别只做一层，TEXT 大字段会把记录行撑爆。

## 五、前端配套（通用两件套）

- **通用「修改记录」弹窗组件**：`props: url + open(entityId)`（或 ref 方法调用式），内部按「组头 = 时间 + 操作人 + 动作、组内字段行：字段中文名 原始值 → 目标值」分组展示；组内字段值 3 行截断、悬浮显示全文。
- **列表页操作列「更多」下拉收纳**：操作按钮多时把「修改记录」收进 el-dropdown「更多」项——箭头旋转交互用 `moreOpenMap: Record<id, boolean>`（dropdown visible-change 事件回写），v-if 用模块按钮权限指令（如 hasPermission）控权限。入口放操作列而不放详情页，因为用户习惯在列表行上直接查"谁动过"。

## 六、权限与 SQL 纪律

- **权限粒度**：每模块独立按钮权限标识，命名 `模块:业务:change-log`（按钮级，不与编辑权限合并——看记录的人未必能改数据）。修改记录查询端点与按钮权限标识一一对应。
- **菜单 SQL 幂等**：按钮权限入菜单表用「顶部 DELETE IN 清单 + INSERT 段」两处同步的幂等写法；多语言表同步登记按钮文案。
- **基线同步**：审计表建表入业务表 init 基线（`DROP TABLE ... CASCADE` 前置），按钮权限入菜单 init 基线——保证只跑 init 基线能建出带修改记录能力的完整新库。
- 一个具体项目（startup）的接入步骤与文件路径，见项目专用 skill `projects/startup/startup-change-record-extension`。

## 七、移植到新项目 checklist

1. 建审计表（一行一字段变更 + entity_name/entity_id 通用关联 + 索引）→ 入基线；
2. 定义两个注解（方法级 + 字段级）与业务表登记枚举（成员名=表名，携带 entity/dao/title 元数据）；
3. 实现 @Around 切面（前取旧快照、后重查新值、异常上抛不记录、diff 失败静默告警）+ diff 器（普通字段 / labels 翻译 / JSON 拍平三模式）；
4. Service insert 后回填 `dto.setId(...)`（决策2，否则新增漏记）；
5. Controller 写方法挂 `@ChangeRecord`，加统一 `GET change-record/{id}` 薄端点 + 按钮权限；
6. 前端通用弹窗组件 + 列表页更多下拉收纳；
7. 菜单 SQL 幂等 + init 双基线同步。
