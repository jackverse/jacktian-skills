---
name: quest-collect-task
description: 基于 quest-spring-boot starter（com.wondersgroup.quest，boot4 版 2.4.x）实现「采集导入任务」（collect_task）的完整接入模式：CollectServiceImpl SPI、@QuestImplement rawStream 原始流透传、TB_QUEST_CONFIG 登记规则、上传体积限制坑（quest.upload-max-size + multipart）。当用户要求在 Spring Boot 宿主项目接入 quest 采集任务、上传 ZIP/JSON 等外部产物包解析入库、或排查 quest 工作台上传报体积超限/实现类找不到时使用。
---

# quest 采集任务（collect_task）接入

场景：工作台上传外部产物包（爬虫 ZIP / JSON 等非 Excel 文件），服务端异步解析入库到业务表，全程在 quest 引擎内登记、记录执行日志。引擎与工作台页面均在 starter / npm 包内，宿主只需写一个业务实现类 + 一行配置登记。

## 一、SPI 形态

starter 提供 `CollectService<T>` 接口与 `CollectServiceImpl<T>` 基类，**双签名**：

- `run(Long questId, List<T> data, Long userId)` — `rawStream=false` 时走 EasyExcel 把上传 Excel 解析成 `List<T>` 后回调。
- `run(Long questId, InputStream in, Class<T> dtoClass, Long userId)` — `rawStream=true` 时工作台上传文件的**原始流直接透传**，适合 ZIP/JSON 等非 Excel 产物，自行解包解析。

二选一实现即可（通常重写 rawStream 对应那条）。

## 二、注解组合（固定套路）

```java
@Service
@QuestImplement(dto = XxxCollectDto.class, rawStream = true)
public class CollectXxxService extends CollectServiceImpl<XxxCollectDto> {

    @Override
    @Async
    @QuestRecord
    public void run(Long questId, InputStream in, Class<XxxCollectDto> dtoClass, Long userId) {
        QuestRecordUtils.run(questId, userId, record -> {
            // 1. 解包 in（ZipInputStream 等），逐条解析成 DTO
            // 2. 校验 + 入库（幂等：按业务唯一键 upsert）
            // 3. 收口执行摘要
            record.setSummary("导入成功 N 条，跳过 M 条");
        });
    }
}
```

要点：

- 类级：`@QuestImplement` + `@Service`（缺一不可，引擎按 Spring Bean 找实现）。
- 方法级：`@Async`（异步执行不阻塞上传请求）+ `@QuestRecord`（执行记录切面）。
- 方法体统一用 `QuestRecordUtils.run(questId, userId, record -> {...})` 收口，成功/失败状态与 summary 由它落库，**不要再手写执行记录落库**。

## 三、TB_QUEST_CONFIG 登记规则

| 字段 | 取值规则 |
|------|----------|
| `quest_type` | `'collect_task'` |
| `implement_class` | **类简单名**（如 `CollectXxxService`），框架按**首字母小写的 Bean 名**（`collectXxxService`）从容器获取 |
| `code` | 由类名去 `Service` 后缀转下划线派生（`CollectXxxService` → `collect_xxx`） |

登记可走任务配置页或 migration SQL。

## 四、踩坑清单（实操验证）

1. **上传体积默认仅 10MB**：`quest.uploadMaxSize` 默认 `10_485_760` 字节。带附件的产物包必超，报体积超限。需要在宿主 application yml 配：
   ```yaml
   quest:
     upload-max-size: 52428800   # 注意是 long 字节数，不是 DataSize 字符串（写 50MB 会绑定失败）
   ```
2. **Spring multipart 上限要同步放大**，否则 multipart 层先拦：
   ```yaml
   spring:
     servlet:
       multipart:
         max-file-size: 50MB
         max-request-size: 50MB
   ```
   两处（quest 层 + multipart 层）都要够大，只改一处仍会失败。
3. **实现类必须被扫描覆盖**：实现类放宿主业务包，且包路径要被 starter 的 `quest.scan-base-packages` 覆盖（例：配了根包 `com.example.host`，则其下任意新子包 `.../service/collect/` 自然被覆盖，无需额外登记）。找不到实现的报错先查这条。
4. **`rawStream=true` 与 `dto` 不矛盾**：`@QuestImplement(dto=X.class, rawStream=true)` 中 dto 仍要声明（作为元数据/泛型锚点），但运行期拿到的是原始 `InputStream`，Excel 解析不会发生。

## 五、边界提醒

- 只写业务实现类：**不要**在宿主重建/扩展 quest 的 Controller / 前端页面（工作台端点与页面由 starter / npm 包提供）。
- 入库逻辑注意幂等（同一包重复上传不应产生重复数据）。
- `@Async` 生效前提是宿主已开启异步（`@EnableAsync` 或等价配置），没有则任务会同步执行、上传接口被拖住。
