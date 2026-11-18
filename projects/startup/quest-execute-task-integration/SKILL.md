---
name: quest-execute-task-integration
description: startup 项目 Quartz 定时任务接入 quest 执行任务（execute_task）的完整套路。触发场景：定时任务接 quest / 编写 ExecuteXxxService 执行任务实现类 / QuestRecordUtils.run 包裹 / @QuestRecord 注解 / QUEST_CONFIG 登记 SQL / 任务壳一行转发 questRunnerService.execute / 执行记录不落库或进度通知静默丢失排查 / ExecuteServiceImpl 不覆写 run 无记录 / ITask 任务壳迁 startup-database / QuestProgress 进度推送 / record.summary 盘点文案。含记录机制反编译真相（QuestRecordUtils 与 @QuestRecord 切面缺一不可）与 5 个定时任务落地验证（2026-11-04）。
project: D:\code\startup
---

# Quartz 定时任务接入 quest 执行任务

> 先例：2026-11-04 落地 5 个定时任务接入并验证（寻技术全量/增量同步、科委政策抓取、看板快照重建、浏览量刷库）。单任务设计见 `docs/design/DES-20261103-001-寻技术同步接入quest任务记录.md`。

## 何时用

- 给已有 Quartz 定时任务补 quest 执行记录（QUEST_RECORD 可查、工作台手动触发、SSE 进度）。
- 新写一个 quest 执行任务实现类（`execute_task` 类型）。
- 排查「任务跑了但 QUEST_RECORD 没记录 / 进度通知没推送」。
- 把任务壳/ITask 从 startup-task 物理迁到 startup-database。

## 机制真相：记录是两段接力，不是二选一（反编译 quest starter 2.4.2 验证）

`QuestRecordUtils.run(questId, userId, consumer)` **本身一行 DB 代码都没有**——只构造 `QuestRecordDTO` + try-catch 把业务异常转 DTO 的 error 状态 + 立即完成的 `CompletableFuture`，纯内存。

全引擎唯一 INSERT 点（QUEST_RECORD 落库）在 `@QuestRecord` 注解切面 `QuestRecordAspect.around`：await future → 按 DTO（questId 来自 run 第一参 = QUEST_CONFIG.id）落一行终态记录 + 驱动进度 complete/fail。

两者是接力关系：

| 组合 | 后果 |
|---|---|
| 只包 `QuestRecordUtils.run`，无 `@QuestRecord` | 记录/进度/通知**全部静默丢失，不报错**（最阴险） |
| 只加 `@QuestRecord`，不包 utils | 必须手工构造 `CompletableFuture<QuestRecordDTO>`，否则 void/null 过不了切面 checkcast 契约，恒落 error |
| 两者都用 | 正常：utils 造 DTO，切面落库推进度 |

宿主 52 个实现类统计：`QuestRecordUtils.run` 包裹 24 个与 `@QuestRecord` 24 个是**同一批文件，0 例外**。

## 接入步骤

### 1. 实现类三件套（缺一不可）

`@QuestImplement` + `@Service` + `extends ExecuteServiceImpl implements ExecuteService`；`run` 加 `@Async` + `@QuestRecord`，体内用 `QuestRecordUtils.run` 包裹；调用必须经 Spring 代理。

```java
@QuestImplement
@Slf4j
@Service
public class ExecuteTechnologySyncService extends ExecuteServiceImpl implements ExecuteService {

    @Async
    @QuestRecord
    @Override
    public CompletableFuture<QuestRecordDTO> run(Long questId, Long userId) {
        return QuestRecordUtils.run(questId, userId, record -> {
            JSONObject template = quest_config_service.getQuestTemplate(questId); // hutool JSONObject
            // ... 业务调用，record.setSummary(盘点文案);
        });
    }
}
```

- `@Async` 机制可选，但 24/24 先例全有（长任务 fire-and-forget + SSE 进度靠它）。
- `ExecuteServiceImpl` 基类默认 run = `QuestRecordUtils.run` 空消费者，但**基类方法上无 `@QuestRecord`**——不覆写 run 的子类不会有记录。
- 完整样例：`startup-database/src/main/java/com/wondersgroup/startup/modules/quest/service/execute/ExecuteTechnologySyncService.java`。

### 2. 定时壳正道：一行转发，绝不自己包 utils

ITask 壳自己包 `QuestRecordUtils.run` 是错的：不写库，且壳没有 questId 来源。正确姿势一行转发：

```java
@Component
public class DownloadFileAutoClearTask implements ITask {
    @Resource
    private QuestRunnerService questRunnerService;

    @Override
    public void run(String params) {
        questRunnerService.execute(QuestCodeUtils.getCode(ExecuteRecordExpireService.class), Constant.system_user_id);
    }
}
```

`execute(code)` 内部链路：getByCode → progressCenter.accept（SSE 受理推送）→ ThreadLocal bind → `getBean(lowerFirst(implement_class))` → `run(questId=QUEST_CONFIG.id, userId)`——getBean 即 Spring 代理调用。

- **一类两码**（两条 QUEST_CONFIG 指向同一 implement_class，如全量/增量同步）时 `QuestCodeUtils.getCode` 按类名推码失效，code 须常量直写：`questRunnerService.execute("technology_sync_full", Constant.system_user_id)`。
- **壳必须带 `@ConditionalOnProperty(name = "quest.enabled", havingValue = "true")`**（2026-11-04 pub 启动炸验证）：壳只有裸 `@Component` 时，随 startup-database 类合并进 4 宿主后会在 quest 引擎关闭的宿主（pub/app 的 yml `quest.enabled: false`）也被扫描注册，启动时注入 `QuestRunnerService` 失败直接 APPLICATION FAILED TO START。而 52 个实现类从不踩这个坑——因为 **`@QuestImplement` 是组合注解，元注解自带 `@ConditionalOnProperty(prefix="quest", name=["enabled"], havingValue="true")`**（javap 反编译确认），引擎关闭的宿主自动不注册实现类。壳没有 @QuestImplement，须显式补同款条件注解，与实现类同生共死。
- 先例：`startup-task/.../modules/job/task/impl/quest/DownloadFileAutoClearTask.java`（task 单模块内，天然不受影响）。

### 3. 业务服务不依赖 quest 的进度回调模式

业务 Service 定义嵌套回调接口（**方法全 default 空实现**——直调路径传 null 零噪音），sync/循环内埋点位；quest 实现类内映射到 QuestProgress：

```java
// 业务服务内（参考 TechnologySyncService.SyncProgressListener）
public interface SyncProgressListener {
    default void onTotal(long total) {}      // 条数预估
    default void onRecord() {}               // 单条完成
    default void onPage(int page, int totalPages, int fetched) {}
    default void onMessage(String message) {}   // 阶段消息
    default void onImageFailure(String seq, String label, String sourceUrl) {}
    default void onError(String message) {}
}
```

```java
// quest 实现类内映射
@Override
public void onTotal(long total) { QuestProgress.at(0); QuestProgress.total(total); } // 百分比按阶段重启
@Override
public void onRecord() { QuestProgress.step(1); }   // 门面内置节流，不怕刷屏
// onPage/onMessage → info；onImageFailure/onError → warn
```

### 4. summary 盘点

业务方法 `void` → 改返回 summary（String / int / record，调用方仅壳一处时零风险）；quest run 里 `record.setSummary(...)` 一行文案（列表一眼看），过程明细走 `QuestProgress.info/warn`（落 QUEST_RECORD.content）。

## QUEST_CONFIG 登记 SQL 模板

文件惯例 `sql/migration/日期_主题-quest.sql`，幂等 INSERT...SELECT...WHERE NOT EXISTS：

```sql
INSERT INTO QUEST_CONFIG (id, code, name, quest_type, implement_class, template, valid, removed, seq, creator, create_date, updater, update_date, remark)
SELECT 7310000000000013, 'technology_sync_full', '寻技术源站全量同步', 'execute_task',
       'ExecuteTechnologySyncService', '{"forceFull": true}', 1, 0, 290,
       1067246875800000001, now(), 1067246875800000001, now(), '备注'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM QUEST_CONFIG WHERE code = 'technology_sync_full');
```

- `implement_class` 填**简单类名**（execute 内部 lowerFirst 后 getBean）。
- `template` 放参数 JSON，实现类用 `getQuestTemplate(questId)` 读（hutool JSONObject，判 null）；无参数可不写该列。
- **id 沿 731 手工段**、**seq 查空闲段**（防与已用 seq 冲突——历史踩坑：270/271 与 secure 系列撞过，后挪 278/279）。
- `record_expire` **不写走列默认 1 = 过期清理**（该列是 0/1 开关不是天数）：每分钟/每 10 分钟高频任务的记录膨胀靠它兜住。
- 纯种子数据**不进 init 基线**（现状惯例仅随日期 SQL）。
- 样例：`sql/migration/2026-11-04_schedule-tasks-quest.sql`（5 任务批量登记）、`sql/migration/2026-10-15_search-index-quest.sql`。

## 任务壳/ITask 迁 startup-database 的安全姿势

- **包名不变纯物理移动**（`git mv` 保 rename）。ITask 必须随壳走——依赖方向 database 不能依赖 task。
- 同包跨 Maven 模块：task 侧剩余壳与调度基建（ScheduleConfig / JobCommandLineRunner / ScheduleJobConsumer / ScheduleUtils / ScheduleJob 留 task 绑定单宿主）**编译期经依赖解析零改动**。
- `QRTZ_JOB_DETAILS.JOB_CLASS_NAME` 存的是 ScheduleJob 执行壳类名（不动它就零 SQL 迁移）；`schedule_job.bean_name` 不变则数据零迁移。
- database 是 4 宿主类合并共享库：壳 `@Component` 在 admin/pub/app 空载无害（只有 task 有 Quartz 触发）。

## 坑清单（速查）

1. 只包 `QuestRecordUtils.run` 不加 `@QuestRecord` → 记录/进度/通知静默全丢、不报错。
2. 只加注解不包 utils、方法返回 void/null → 切面 checkcast 契约不过，恒落 error。
3. 不覆写 `run`（用基类默认空实现）→ 基类方法无注解，无记录。
4. 壳内自己包 utils → 不写库且没有 questId 来源；必须转发 `questRunnerService.execute(code, userId)`。
5. 一类两码时 `QuestCodeUtils.getCode` 推码错误 → 常量直写 code。
6. seq 撞已用段 → INSERT 后唯一约束冲突/排序混乱；登记前先查空闲段。
7. 以为 `record_expire` 是天数 → 它是 0/1 开关；高频任务不写它靠默认 1 自动过期清理。
8. 每次执行都 WARN「全程未上报进度，建议按 L2 接入 QuestProgress」→ `QuestProgressCenter.warnIfSilent` 在任务完成时检查 `businessEventCount==0` 就打（每次执行都打，高频任务刷屏）。无配置开关可关；正解是秒级任务也补一行 `QuestProgress.info(...)`（info/warn/step/total 任意一次上报即豁免）。
9. 「写回 0 键」类 summary 为 0 别当故障 → 无流量时 Redis 无增量键，空转正常。
10. 高频任务（每分钟级）空转轮次刷爆记录/日志 → `record.setRecordable(false)`：切面 `!Boolean.FALSE.equals(dto.getRecordable())` 判定后**只 notify 不写 QUEST_RECORD**（QuestRecordDTO 原生机制）；配合日志降 `log.debug`，空转零落盘、有活干的轮次才落记录。
