---
name: quest-host-bean-gating
project: D:\code\wic-sh
description: quest.enabled=false 的进程（如 wic-pub）启动报缺 questTaskExecutor / QuestRecordService / QuestConfigService 等 quest starter Bean（NoSuchBeanDefinitionException）时的排查与修复：宿主 Quest 任务实现类（modules/quest/service/{collect,execute,query}、competition 下 Quest 任务/导出服务、PDF 批量编排链）都在共享模块 wic-database 里被所有进程扫描，必须逐类加 @ConditionalOnProperty(prefix="quest", name="enabled", havingValue="true")，并用 ClassPathBeanDefinitionScanner + TestPropertyValues + ApplicationContextRunner 写关闭后整包扫描校验。触发场景：关闭 Quest 后进程起不来、缺 questTaskExecutor、QuestRecordService/QuestConfigService 注入失败、按依赖链逐层报缺 Bean、宿主 quest 任务 Bean 条件装配、quest.enabled 条件注解漏加、整包扫描验证条件生效。凡"quest.enabled=false 起不来""关掉 quest 缺 Bean""宿主 quest 任务类条件化与回归"均应参考。
---

# quest.enabled=false 宿主 Bean 条件装配与整包回归（wic-sh）

**症状**：未启用 quest 的进程（典型 wic-pub）启动即崩，报缺 `questTaskExecutor` / `QuestRecordService` / `QuestConfigService` 等 starter Bean；且修一个又冒下一个——报错按依赖链逐层上抛。

## 1 根因：wic-database 是共享模块，宿主任务类被所有进程扫描

- 宿主 quest 实现不在 starter 里，全在 wic-database：
  - `com.wondersgroup.wic.modules.quest.service.{collect,execute,query}` 三包，全部 `@Service`/`@Component` + `@QuestImplement`；
  - `modules.competition` 下 Quest 任务/导出服务：`RegistrationFullExportService`、`SecondRecommendExportExecuteService` 等；
  - PDF 批量编排链：`RegistrationPdfBatchOrchestrator` → `RegistrationPdfBatchExportExecuteService`。
- wic-database 被 wic-admin / wic-pub / wic-task 共同依赖并组件扫描；而 `questTaskExecutor`、`QuestRecordService`、`QuestConfigService` 等 starter Bean 只在 `quest.enabled=true` 的进程存在。
- 无条件注解的宿主任务类在 wic-pub（`quest.enabled=false`）照样注册 → 构造注入 starter Bean → 启动失败。

## 2 修复：每个宿主 Quest 实现类逐一条件化

```java
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

@Service
@ConditionalOnProperty(prefix = "quest", name = "enabled", havingValue = "true")
@QuestImplement
public class XxxCollectService ...
```

- **逐类加，不要只修最外层注入**：只给报错最外层加条件，会把 NoSuchBeanDefinition 换成依赖链下一层的同款报错。排查法：quest 任务包内 `grep -L ConditionalOnProperty`，除普通业务类外应零命中。
- **不要条件化无 starter 依赖的普通业务类**：如 `DownloadRecordService`（仅查下载记录）、PDF 基础组件——它们不碰 starter Bean，条件化既没必要，还会让"关闭后扫描应零定义"的校验对象失真。
- 现状锚点（2026-10）：quest 三包 + `QuestAsyncRoutingConfig` + competition 四类共 33 处 `@ConditionalOnProperty`；新增 quest 任务类必须带上该注解。

## 3 回归测试：整包扫描 + 显式注册双校验

参考 `wic-database/src/test/java/com/wondersgroup/wic/modules/competition/service/pdf/RegistrationPdfBatchQuestConditionTest.java`：

1. **true 基线（防空校验）**：`GenericApplicationContext` + `TestPropertyValues.of("quest.enabled=true")` + `ClassPathBeanDefinitionScanner.scan(三包)`，断言定义数 >30，并 `contains` 代表性 bean 名（collect/execute/query 各抽一，如 `collectDictDataService`、`closeExpiredUnlockService`、`queryRegistrationFullExportService`）——没有这条，扫描范围写错会让 false 用例"假通过"。
2. **false 零残留**：同扫描但 `quest.enabled=false`，取 `getBeanDefinitionNames()` 过滤 `org.springframework.context.` 前缀后必须 `isEmpty`。
3. **ApplicationContextRunner 显式注册**：`new ApplicationContextRunner().withUserConfiguration(competition 四类).withPropertyValues("quest.enabled=false")`，逐类 `doesNotHaveBean`——覆盖不经包扫描、由配置类显式注册的编排链。
4. **不误伤用例**：false 下扫 `competition.service.pdf` 包定义数 >0，证明条件没殃及普通业务组件。

## 4 坑

- **ClassPathBeanDefinitionScanner 总会注册 5 个 Spring internal 注解处理器 Bean**（`org.springframework.context.annotation.internal*`）：即便业务 Bean 全被条件挡掉，`getBeanDefinitionCount()` 也不是 0——断言零定义必须按 `!name.startsWith("org.springframework.context.")` 过滤，否则用例恒挂。
- **未 refresh 的 GenericApplicationContext 只能看 bean definition 名称**：`getBeanNamesForType` / `getBeansOfType` 会触发 refresh 且缺 PostProcessor 全链路，不要用；逐名断言一律走 `getBeanDefinitionNames()`。
- 默认 bean 名 = 类名 lowerFirst（`CollectDictDataService` → `collectDictDataService`），`@Service` 未显式命名时按此写 contains。
