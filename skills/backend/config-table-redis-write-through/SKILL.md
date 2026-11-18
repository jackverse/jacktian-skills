---
name: config-table-redis-write-through
description: 业务参数配置从硬编码改为独立配置表+Redis 写穿透+Rabbit fanout 广播同步+CommandLineRunner 启动预热+消费端只读缓存的完整套路。触发场景:配置硬编码改配置表、业务参数配置化(排序规则/阈值/开关类)、Redis 写穿透缓存设计、配置多实例广播同步、fanout 配置 reload、启动预热配置快照、配置管理页(按 code 分型结构化表单+JSON 兜底)、配置化改造排序逻辑口径不一致、以配置为参数的结果缓存失效。凡"把代码里写死的参数/规则/开关抽成可后台管理的配置"的后端改造都应参考。
---

# 业务配置表 + Redis 写穿透 + fanout 广播同步 + 启动预热（config-table-redis-write-through）

## 何时使用

代码里写死的业务参数（排序字段、取数条数、阈值开关、展示规则等）需要变成后台可改、改动即时生效，且系统是**多实例部署 + 已有 Redis + 已有 RabbitMQ** 的 Spring Boot（MyBatis-Plus）项目。核心模式一句话：

> **独立配置表（一行一配置项）+ Redis 单键全量快照（写穿透，不设 TTL）+ 管理端变更后 fanout 广播 reload + 各实例启动预热 + 消费端只读缓存（永远带内置缺省值兜底）。**

典型收益：改配置不发版、秒级生效；消费端读配置零 DB 压力；缺省值=改造前线上行为，切换零风险。

不适合：需要审批流/版本化回滚的企业级配置中心场景（直接上 Nacos/Apollo 类产品）；纯前端展示常量（走前端下发通道即可，不必建表）。

## 总体链路

```
管理端改配置
   │ Controller
   │   ├─ service.save/update/delete()      ← @Transactional 纯事务（此处提交）
   │   └─ service.syncCacheAndNotify()      ← 事务返回后才调用（关键，见§二）
   │         ├─ DB 全量重算快照 → Redis 单键（写穿透）
   │         ├─ 清"以配置为参数"的结果缓存组（见§6）
   │         └─ amqpTemplate → fanout exchange 广播 "reload"
   ▼
每个实例（含发起变更的本实例）listener 收到 → reloadFromDb() 只 reload、绝不转发
   ▼
消费端读取 config(code)：Redis 全量快照优先 → miss/异常回源 DB → typed helper + 内置缺省值

应用启动：CommandLineRunner 预热 try/catch 全包（见§5）
前端：新配置并入既有「站点配置」下发通道 deep-merge（见§六）
```

## 一、表与缓存形态设计

### 1. 表设计：一行 = 一个配置项

```sql
CREATE TABLE tb_xxx_config (
    id            BIGINT PRIMARY KEY,
    config_code   VARCHAR(100) NOT NULL,   -- 配置项编码，业务唯一键
    config_name   VARCHAR(200),            -- 展示名（管理页列表用）
    config_value  CLOB,                    -- 配置值，统一存 JSON（对象/数组/标量皆可）
    status        SMALLINT DEFAULT 1,      -- 1 启用 / 0 停用
    sort_order    INT DEFAULT 0,           -- 管理页展示序
    -- 以下接项目业务表九列审计基类：创建人/创建时间/更新人/更新时间/
    -- 版本号/逻辑删除标志等，具体列名以项目基线 SQL 为准
    ...
);
CREATE UNIQUE INDEX uk_xxx_config_code ON tb_xxx_config(config_code);
```

要点：

- **config_value 用 CLOB/TEXT**，不要 VARCHAR——配置值是 JSON，结构复杂时很容易超长。
- 实体继承项目已有的业务表审计基类（九列），逻辑删除；快照构建时过滤掉已删除行。
- **种子行缺省值必须等于改造前线上行为**。这是整个改造零风险切换的锚点：Redis 挂、DB 挂、配置停用，任何一路走到"取不到值"时，消费端落到的缺省值就是改造前的老行为，线上表现不会漂移。种子 SQL 随日期增量 SQL 维护（是否进 init 基线按各项目惯例）。

### 2. Redis 形态：单键全量 JSON Map，写穿透，不设 TTL

```
key:   <业务域>:xxx_config:snapshot        （业务键常量集中登记，见下）
value: {"code_a": {...}, "code_b": [...], ...}   ← 全量启用项的 JSON Map
```

- **为什么单键全量而不是 per-key + TTL**：per-key 方案读任意一个配置项都可能 miss 回源，读放大且 TTL 内存在脏读窗口；全量快照一次 load 整包，管理端每次变更整体重算写回（写穿透），维护只有"预热 + 变更同步"两个入口，最简单。
- **为什么不设 TTL**：快照由启动预热 + 变更同步主动维护，TTL 反而引入"过期瞬间回源风暴"。TTL 仅作为垃圾回收可留一个超长值（如数天），业务上不依赖过期。
- **快照是全量语义**：某个 code 不在快照里（未启用/停用/已删）= 该配置未生效，消费端直接落缺省值，**不要**再按 code 单独回源 DB（会破坏"停用即回退缺省"的语义，还引入回源放大）。

Redis 工具类按项目实际为准（下文以 `redisUtils.get/set/deleteByPrefix` 泛化表示，多数封装会自动拼全局 key 前缀，业务代码里写业务键即可）。**业务键常量集中登记**在项目的 Redis 键常量接口/类中，不要散落字符串。

## 二、后端实现套路：Service 职责划分

CRUD 与缓存同步**必须分离成两类方法**：

```java
@Service
public class XxxConfigServiceImpl {

    public static final String cache_key  = "xxx_config:snapshot"; // 登记进 Redis 键常量
    public static final String exchange   = "xxx.config.fanout";   // 登记进 MQ 常量接口

    // ① CRUD：保持 @Transactional 纯事务，绝不在这里碰缓存/发广播
    @Transactional
    public void save(XxxConfigDTO dto) { /* 插入/更新 + 唯一性校验 */ }

    @Transactional
    public void updateStatus(Long id, int status) { /* 启停 */ }

    @Transactional
    public void delete(Long id) { /* 逻辑删除 */ }

    // ② 同步+通知：非事务方法，由 Controller 在事务方法返回后调用
    public void syncCacheAndNotify() {
        // 1. 全量重算快照并写 Redis（只含 status=启用 且未删除的行）
        Map<String, Object> snapshot = loadEnabledSnapshotFromDb();
        redisUtils.set(cache_key, snapshot);
        // 2. 清掉"以该配置为参数"的查询结果缓存组（见 §五，没有则跳过）
        clearRelatedResultCaches();
        // 3. fanout 广播，通知所有实例 reload
        amqpTemplate.convertAndSend(exchange, "", "reload");
    }

    // ③ 供广播消费端/预热调用的纯 reload（只读 DB → 写 Redis，不发广播）
    public void reloadFromDb() {
        redisUtils.set(cache_key, loadEnabledSnapshotFromDb());
    }
}
```

Controller 侧：

```java
@PostMapping("/save")
public Result<Void> save(@RequestBody XxxConfigDTO dto) {
    service.save(dto);             // 事务方法返回时已提交
    service.syncCacheAndNotify();  // 提交之后再同步+广播
    return new Result<>();
}
// update / updateStatus / delete 同款两步；delete 后同样要 syncCacheAndNotify
```

### 为什么同步必须在 Controller、事务返回后触发（核心坑）

如果把 `syncCacheAndNotify()` 写进 Service 的 `save()` 内部，它随 `@Transactional`（传播 REQUIRED）一起进了事务：**广播先于事务提交发出**。fanout 是即时投递，其它实例（以及本实例自己的 listener）收到后立刻回源 DB——此时变更事务尚未提交，读到的还是旧值，把旧值写进快照覆盖掉。结果：改了配置缓存却是旧的，要等下一次变更才自愈，且单实例测试很难复现（本实例后续读可能有本地一致性），多实例必踩。

所以规矩是：**事务方法只管事务；`syncCacheAndNotify()` 一定由 Controller 在事务方法正常返回后调用**。

## 三、广播与预热

### 1. fanout 自建 exchange

exchange 名放**项目自己的 MQ 常量接口**（starter 框架自带的 Rabbit 常量接口通常 final 不可扩展，不要去改它）：

```java
public interface MqConstant {
    String xxx_config_fanout = "xxx.config.fanout"; // 项目常量命名规范：小写+下划线
}
```

```java
@Configuration
public class XxxConfigMqConfig {
    @Bean public FanoutExchange xxxConfigFanoutExchange() {
        return new FanoutExchange(MqConstant.xxx_config_fanout, true, false); // 持久、不自动删
    }
    @Bean public Queue xxxConfigReloadQueue() { return new AnonymousQueue(); } // 每实例独立匿名队列
    @Bean public Binding xxxConfigReloadBinding() {
        return BindingBuilder.bind(xxxConfigReloadQueue()).to(xxxConfigFanoutExchange());
    }
}
```

- 用 **fanout + 每实例 AnonymousQueue**：天然支持多实例增减，不丢广播；单实例也走同一链路（自己发自己收，reload 幂等），逻辑不分叉。
- **listener 只 reload、绝不转发/再广播**——在 reload 里再发广播会形成广播风暴循环：

```java
@Component
public class XxxConfigReloadListener {
    @RabbitListener(queues = "#{xxxConfigReloadQueue}")  // 队列 Bean 名按项目实际注入
    public void onMessage(String msg) {
        configService.reloadFromDb();   // 只做 DB → Redis，无任何 send
    }
}
```

### 2. CommandLineRunner 启动预热：try/catch 全包

```java
@Component
public class XxxConfigWarmUp implements CommandLineRunner {
    @Override
    public void run(String... args) {
        try {
            configService.reloadFromDb();   // DB → Redis 全量快照
        } catch (Exception e) {
            log.warn("xxx 配置启动预热失败，应用继续启动（首次读取将回源 DB）", e);
            // 必须吞异常：Redis 未就绪 / DB 慢 / MQ 未起，都不能阻断应用启动
        }
    }
}
```

预热吞异常是硬要求：依赖组件未就绪时启动失败，会把"配置模块"升级成"整个应用起不来"的事故。消费端读取链路本身有 miss 回源兜底（见 §四），预热失败只是冷启动多打一次 DB。

## 四、消费端读取封装：快照优先 + typed helper + 内置缺省

消费方（其它 Service）**只依赖一个薄封装**，不直接摸 Redis：

```java
/** 取配置原始 JSON；快照是全量，code 不在快照 = 未启用，返回 null，不再回源 */
public JsonNode config(String code) {
    try {
        Map<String, JsonNode> snapshot = redisUtils.get(cache_key);
        if (snapshot != null) {
            return snapshot.get(code);           // 全量语义：不在即未启用
        }
    } catch (Exception e) {
        log.warn("读配置快照异常，降级回源 DB", e); // Redis 异常自动降级
    }
    return dbValue(code);                        // miss（冷启动）/异常 → DB 单行
}

/** typed helper：永远带内置缺省值，缺省值 = 改造前线上行为 */
public int intConfig(String code, String field, int def) {
    JsonNode node = config(code);
    return (node != null && node.hasNonNull(field)) ? node.get(field).asInt() : def;
}
// strConfig / boolConfig / listConfig 同款
```

纪律：

- 消费端调用形如 `intConfig(code, "top_n", 10)`——**第三个参数永远写死改造前的原值**，任何一层取不到都安全退化。
- 消费端不要缓存到自己的成员变量里长期不刷新（变更通知到不了它）；要么每次现读快照（Redis GET 很便宜），要么订阅 reload 事件清本地副本。
- `config_value` 是 JSON，所以一个 code 可以装任意结构；多个相关小参数建议合成一个 code 的对象，减少行数。

## 五、关联缓存失效：以配置为参数的结果缓存要手动清

如果某些查询结果本身有结果级缓存（门户/前台通用查询缓存之类），而**缓存键里含配置参数或参数摘要**（如按排序规则取前 N 条的结果），配置变更后这些键**不会自动失效**——键是按"配置值摘要"算出来的，新配置只会生成新键，旧键还挂着旧结果。

处理：在 `syncCacheAndNotify()` 的第 2 步显式清：

- 项目有按组失效机制（结果缓存组常量、组级 evict 注解/工具）→ 在这里调用对应组的失效方法；
- 没有组机制 → `redisUtils.deleteByPrefix(该业务结果缓存前缀)` 一把清。

漏清的症状：配置后台明明改了，前台查询结果还是旧口径，要等结果缓存 TTL 过期才"自己好"。排查配置不生效问题时先查这一步。

## 六、前端下发通道：并入既有「站点配置」deep-merge

若前端已有统一的「站点配置」下发接口/参数通道（启动/进入时拉一次的全局参数对象），**新配置表数据并入同一通道下发**，不要新开接口：

- 后端把配置表的业务负载（剔除 status/sort_order/审计列等内部字段）合并进下发对象；
- 合并规则 **deep-merge：数组整组替换、对象逐字段递归合并**——存量参数不被覆盖、新增配置自然带出；
- 前端改动最小（同一处取参），且天然兼容存量参数消费方。

## 七、配置化改造排序逻辑的关键坑：SQL 与内存必须同源

把「排序字段/方向/取前 N 条」配置化时，排序往往出现在两处：

1. SQL 层 `ORDER BY ... LIMIT N`（DB 内完成截断）；
2. 内存层多源合并后的 `Comparator` 再排再截断。

**两处的字段、方向、条数必须由同一个配置值派生**。常见事故：SQL 用配置拼的 `order_sql`，内存 Comparator 却是另一份手写映射——改了配置只生效一半，「DB 内取前 N」与「合并后再排序」口径不一致，**合并排序能排进前 N 的行根本没进 DB 取数结果，漏数据**。修法是单一取数口：要么都走 SQL 派生，要么 SQL 取数不截断、统一内存排序截断。

配套两条：

- **动态拼 `order_sql` 必须对 `sort_field` 做白名单校验**（只允许登记过的列名进 ORDER BY），否则配置表可写等于 SQL 注入入口。白名单本身也可以做成配置的一部分或常量表。
- **单测 mock 配置服务用 `thenAnswer` 回退缺省值**（缺省 = 原行为），保持既有断言语义：

```java
when(configService.strConfig(anyString(), eq("sort_field"), anyString()))
    .thenAnswer(inv -> inv.getArgument(2));  // 直接回传传入的缺省值
// 不要 thenReturn(null)：会把缺省路径打死，存量断言全崩
```

## 八、管理页设计要点

三件套（前端泛化写法，Vue3/Element Plus 风格，以项目实际组件为准）：

1. **列表页**：config_code / config_name / 启停 switch / 编辑。启停 switch 即时生效——调 `updateStatus` + `syncCacheAndNotify`，无需进编辑页。
2. **按 code 分型结构化表单**：已知 code 渲染专属动态表单（字段下拉、方向单选、数值输入等）；动态数组配置用 **item-block 卡片编辑器**（每个数组元素一张卡片，上移/下移/删除用 splice 操作副本数组，新增 push 空模板）。
3. **未知 code 的 JSON 兜底**：不在分型清单里的 code 统一落 JSON textarea，保存前 `JSON.parse` 校验，解析失败禁用提交按钮。

表单模型构建用「**内置默认 + 存量 JSON 逐字段递归合并**」：给每个分型 code 维护一份默认模板，加载时与存量 config_value 递归合并（对象逐字段，数组以存量整组为准）。这样后台给配置结构**新增字段后，旧数据自动补上默认值**，表单不缺字段、保存不丢字段。

```ts
function mergeDefaults(defaults: any, stored: any): any {
  if (Array.isArray(defaults)) return Array.isArray(stored) ? stored : defaults; // 数组整组取存量
  if (defaults && typeof defaults === 'object') {
    const out: any = { ...defaults };
    for (const k of Object.keys(defaults)) if (stored && stored[k] !== undefined) out[k] = mergeDefaults(defaults[k], stored[k]);
    return out;
  }
  return stored !== undefined ? stored : defaults;
}
```

## 九、常见坑清单

| # | 坑 | 后果 / 规避 |
|---|----|------------|
| 1 | `syncCacheAndNotify()` 写进 Service 事务方法内部 | 广播先于提交，其它实例回源读到旧值覆盖快照；必须 Controller 在事务返回后调（§二） |
| 2 | 启动预热不吞异常 | Redis/MQ 未就绪时整个应用起不来；try/catch 全包（§三） |
| 3 | listener reload 里又发广播 | 广播风暴死循环；只 reload 不转发（§三） |
| 4 | 快照 miss 按 code 回源后把单行写回快照 | 破坏快照全量语义；回源只用于本次读取，整体维护只走全量 reload |
| 5 | 种子缺省值 ≠ 改造前线上行为 | 切换瞬间行为漂移；种子值以改造前代码为准逐项核对 |
| 6 | 排序配置 SQL / 内存 Comparator 双轨不同源 | 取前 N 条漏数据；单一配置值派生两处（§七） |
| 7 | 动态 order_sql 不做白名单校验 | 配置表成为 SQL 注入入口；sort_field 白名单 |
| 8 | 忘清以配置为参数的结果缓存 | 配置改了查询结果不变，TTL 过期才自愈；syncCacheAndNotify 第 2 步显式清（§五） |
| 9 | 停用配置 ≠ 删除配置 | 停用 = 快照里没有该 code = 消费端落缺省值（回到改造前行为）；与缺省值设计联动理解 |
| 10 | 多实例只清本实例缓存 | 其它实例还读旧快照；统一直接 fanout 广播，单实例也走同一链路（自己发自己收，幂等） |
| 11 | config_value 用 VARCHAR | JSON 超长截断/报错；CLOB/TEXT |
| 12 | 消费端把配置缓存进成员变量不刷新 | 收不到变更；现读快照或订阅 reload 清副本 |
| 13 | 删除配置后忘记 syncCacheAndNotify | 已删配置仍在快照里生效；delete 与 update 同款两步 |

## 交叉引用

- 与「门户查询缓存」类结果缓存机制配合时，本 skill §五 的手动失效是不可省的一环（结果缓存键含参数摘要不随配置变更失效）。
- 多实例部署的其它缓存一致性广播（列表缓存、榜单缓存失效）可复用同一 fanout 模式。
