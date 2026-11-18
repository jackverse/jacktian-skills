---
name: startup-message-push-extension
description: startup 项目站内消息引擎扩展套路——给消息中心扩展新来源/新圈定维度/新业务推送（如政策智能推送这类"指定用户清单"消息）的完整实现模式。触发场景：给 tb_message/tb_message_user 消息体系加新 MsgSource 来源、新 MsgScope 圈定方式、按业务画像圈人推送、消息撤回重发收不到、SM4 加密列裸 SQL 查出密文、门户详情接口加用户级浏览埋点、推送防重与幂等设计。含动态 SQL 写 Dao 注解、空链表 CASE WHEN 降级、SQL 基线同步等全部坑位。
project: D:\code\startup
---

# 站内消息引擎扩展套路——指定用户清单推送（政策智能推送先例）

> 先例：政策智能推送（2026-10-30 落地）。机制底座：msg 模块 `tb_message`（主表）+ `tb_message_user`（收件箱），REQ-20260827-001 / ADR-0007（惰性物化）/ ADR-0008（撤回/重发语义）。

## 0. 先读懂底座：两套送达机制（改错必双计或漏达）

- **单发 `MessageSendService.send()`**：一条 `tb_message(targetType=SINGLE)` + 即刻插一条收件箱行，发出即送达。
- **群发 `MessageSendService.emitNow()`**：只插 `tb_message(status=SENT)`，**零铺行**；送达靠 `UserMessageService.materializeDeliverable()` 在用户查收件箱/未读数时**惰性物化**——`hitsTarget()` 按发送对象实时判定：`ALL` 恒命中、`CERT_CATEGORY` 与用户当前有效认证类别交集命中（窗口内新获认证收得到、解绑收不到）。
- 收件箱行插入唯一入口 `MessageSendService.insertInboxRow(messageId, userId, now)`：唯一键 `(message_id, user_id)` 冲突 `DuplicateKeyException` **catch 静默跳过**（冲突=已送达）；逻辑删除的行同样占位，删除后不复活。

## 1. 新场景「精确用户清单推送」三件套扩展

政策推送用的是 **BROADCAST 外形 + 指定清单内核**：`tb_message(targetType=BROADCAST, scope=USER_LIST, source=业务来源)` 一条主表行，收件箱行发送时精确铺好，不参与惰性物化。

### ① 枚举扩展（不用写字典 SQL）

- `msg/enums/MsgScope` 加 `USER_LIST(2, "指定用户")`；`msg/enums/MsgSource` 加业务来源（先例 `policy_push(3, "政策推送")`）。
- 枚举带 `@DictBuilder(dictType=...)` / `@DictValue` / `@DictLabel` 注解（sys-starter），字典由 starter **自动同步**，**不需要写任何字典 SQL**。
- 命名遵守项目强规：枚举/final 成员小写+下划线（`policy_push`、`stage_p1_months`），类名方法名照旧。
- `hitsTarget()` 对未知 scope（含 USER_LIST）返回 false —— 天然不物化，**不用改 UserMessageService**。

### ② 新表 `tb_message_target`（一列三职的唯一键）

```sql
CREATE UNIQUE INDEX uk_message_target_biz ON tb_message_target(biz_type, biz_id, user_id);
```

`(biz_type, biz_id, user_id)` 一列三职：**防重**（同业务同用户只推一次）/ **接收人回查** / **命中理由追溯**（`match_reason` 分号分隔）。表结构见 `sql/init_startup.sql` 中 `tb_message_target` 段；实体 `msg/entity/MessageTargetEntity`。

### ③ 发送编排（`PolicySmartPushService.push`，整体 `@Transactional`）

1. `messageSendService.emitNow(message)` 插主表（BROADCAST+USER_LIST，emitNow 对群发不铺行，正合适）；
2. 逐用户插 `tb_message_target` 行，`DuplicateKeyException` catch 后 `continue`（预览与发送间隙被并发推过，防重跳过）；
3. 每个未撞唯一键的用户 `messageSendService.insertInboxRow(...)` 铺收件箱行（幂等）；
4. 返回实际推送数（= target 插入成功数）。

**幂等与事务的关键认知**：MyBatis+Spring 下 mapper 抛 `DuplicateKeyException` 被 catch 后事务**不会**被标记 rollback-only，可以安全继续——项目先例即 `MessageSendService.insertInboxRow` 同模式，直接照抄。

## 2. 撤回重发的坑（必踩，务必处理）

`MsgManageService.revoke()` 会**物理删除**全部收件箱行（ADR-0008）。已撤回消息可重新编辑再次发出，但 USER_LIST 消息**不参与惰性物化**——若不处理，重发后**没有任何人收得到**。

解法：`MsgManageService.update()` 里 sendType=立即 && scope=USER_LIST 分支，按 `tb_message_target` 清单（message_id 反查，valid=1 removed=0）逐用户幂等重铺收件箱行，对齐 ADR-0008「重新发出后全量重新送达」。新增清单类消息来源时，这个分支是通用的，无需改。

## 3. 匹配层套路（业务→画像→用户）

先例：政策 → 企业/机构画像 → 已认证用户。核心结构可整体复刻：

- **候选圈定**：`tb_user_certificate(cert_category + audit_status='certificated')` JOIN `tb_unit`（企业画像）/ `tb_agency`（机构画像）。
- **成长阶段推导**：`tb_unit.establish_date` 距今 <2 年=初创 / 2~5 年=成长 / >5 年=成熟（边界常量按月：24/60），与门户 `PolicyPubService.match` 弹窗口径互为镜像——**同一政策字段两边算出同一批人**，改口径必须两边同步。
- **产业链文本命中**：`industryChainService.validCodes(存储串)` → 逐码 `nameOf(code)` 取节点名（叶子名），**长度 ≥2 才参与**（防「机」「电」这类单字误命中），在经营范围/所属行业/AI 画像 `company_profile` 三列文本 LIKE。
- **排除列内联**：已推送（`tb_message_target`）、已浏览（`tb_user_browse_log`）用 `CASE WHEN EXISTS (SELECT 1 ...) THEN 1 ELSE 0 END` 直接作为候选行标志列，Service 统计+过滤一份数据搞定。
- **规则区人话化**：preview 接口按政策字段自动推导规则说明清单（含「暂无画像字段不参与匹配」「普惠推送全量纳入」明示），先确认人群规模再推送。
- 命中理由由 **Java 侧按画像指标生成**（SQL 只圈人），排序按理由数多者优先。

### 动态 SQL 全写 Dao 的 `@Select("<script>")` 注解里（项目无 mapper xml）

项目惯例与语法坑（见 `inno/dao/PolicySmartPushDao`）：

- 多条件 OR 收口：`<trim prefix='AND (' suffix=')' suffixOverrides='OR'>`，每个 `<if>` 段末尾带 `OR`，由 trim 剪掉最后一个；
- **空链表降级**：`chainHitNames` 可能为空，`<choose><when test='...size() > 0'>CASE WHEN <foreach.../> THEN 1 ELSE 0 END AS chainHit</when><otherwise>0 AS chainHit</otherwise></choose>`——否则 CASE WHEN 语法残缺直接 SQL 报错；
- 整段命中条件可开关：`<if test='has_filter'>`（普惠政策：无适用对象且无产业链时不拼 WHERE 命中条件，全量纳入）；
- 达梦字符串连接用 `'%'||#{name}||'%'`。

## 4. 加密列大坑（裸 @Select 拿到的是密文）

`tb_user.mobile`、`tb_user_certificate.apply_info` 等是 SM4 加密列：**裸 `@Select` 自定义 SQL 不经 MyBatis-Plus `autoResultMap` 的 EncryptTypeHandler，SELECT 出来直接是密文**（`UserCertificateDao` 头注释有明文警告）。

铁律：

- 圈定 SQL **只返回 userId + 非加密画像窄列**（org_name、establish_date、employee_count 等业务画像列未加密，可直取）；
- 姓名/手机号由 Service 按 userId 走 `userDao.selectBatchIds(userIds)`（wrapper/MP 内置方法走 autoResultMap，自动解密）批量补全；
- 后台展示手机号统一脱敏（11 位保留前 3 后 4 `xxx****xxxx`，非 11 位整体打码）；
- 确需明文（如单发接收人详情眼睛图标）走 starter `SecurePlainViewService.view(table, id, column, operator, ip)`，自带审计与日配额；
- 加密列模糊查询用 `SecureQuery.like(wrapper, UserEntity.class, "mobile", keyword)`，注意两 gram 限制（<4 位纯数字会抛「加密字段查询最短 4 位」）。

## 5. 埋点套路：门户详情加「用户级浏览流水」

推送的「已浏览不再推送」信号来自 `tb_user_browse_log`（一行=某用户首次浏览某业务内容，唯一键 `(biz_type, biz_id, user_id)`）：

- 写入唯一入口 `statistic/service/BrowseLogService.record(bizType, bizId, userId)`：`DuplicateKeyException`/任何异常**全部静默吞掉**，埋点永不影响详情主流程；bizType 在 `UserBrowseBizType` 枚举登记。
- 端点在 **pub 模块 @Anonymous 控制器**里，拦截器不注入 userId，须在 Controller 内兜底解析（`LogOperationAspect.resolveUser` 同款写法）：

```java
String token = ssoTokenService.readToken(request);
if (StringUtils.isBlank(token)) return;
PubUserToken form = ssoTokenService.parse(token);
browseLogService.record(..., form == null ? null : form.getUserId());
```

- **埋点必须放在没挂 `@PortalCache` 的 Controller**：详情接口挂了 `@ClickCount` 后禁止再挂 `@PortalCache`（AGENTS.md 明文），因此 Controller 方法体必达、埋点不丢；若挂了 PortalCache 且命中缓存，方法体根本不执行，埋点就没了。
- `@ClickCount`（匿名聚合浏览量）与本流水（登录用户级行为信号）两套体系并存互不干扰，同接口可同时用。

## 6. SQL 基线同步强规（漏一处新库就不完整）

- 新表：入 `sql/init_startup.sql`（`DROP TABLE ... CASCADE` 前置 + 表段注释头 + 唯一/普通索引）；
- 按钮/菜单权限：入 `sql/init_menu.sql`，**顶部幂等 DELETE IN 清单与 INSERT 段两处都要加**；
- 日期增量 SQL（`sql/YYYY-MM-DD.sql`）：建表 + 菜单/多语言 DELETE-INSERT + **给已有相关权限角色做 SYS_ROLE_MENU 继承**（INSERT ... SELECT 既有父按钮权限的角色，先例：2026-10-14.sql 知识图谱、2026-10-30.sql 智能推送——已有政策「查看」权限的角色自动获得「智能推送」按钮）；
- 字典不用管（枚举注解自动同步，见 §1①）。

## 7. 参考实现索引（照抄起点）

| 关注点 | 文件 |
|---|---|
| 圈定 SQL / 动态注解 SQL | `startup-database .../inno/dao/PolicySmartPushDao.java` |
| 匹配+推送编排/规则推导/脱敏 | `startup-database .../inno/service/PolicySmartPushService.java` |
| 发送引擎/幂等收件箱行 | `startup-database .../msg/service/MessageSendService.java` |
| 惰性物化/hitsTarget | `startup-database .../msg/service/UserMessageService.java` |
| 撤回重发 USER_LIST 重铺分支 | `startup-database .../msg/service/MsgManageService.java`（update 方法） |
| 清单表实体/Dao | `startup-database .../msg/entity/MessageTargetEntity.java`、`msg/dao/MessageTargetDao.java` |
| 枚举扩展样例 | `startup-database .../msg/enums/MsgScope.java`、`MsgSource.java` |
| 浏览流水埋点 | `startup-database .../statistic/service/BrowseLogService.java`、`startup-pub .../policy/controller/PolicyPubController.java` |
| 后台端点 | `startup-admin .../inno/controller/PolicyController.java`（`inno:policy:smart-push`） |
| SQL 先例 | `sql/2026-10-30.sql`、`sql/init_startup.sql`、`sql/init_menu.sql` |
