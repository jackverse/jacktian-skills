---
name: chart-anomaly-rootcause-repro
description: 看板/报表图表展示异常的根因核查与视觉复现技能：用户报告某图表"展示有问题"（压扁/比例失真/空轨道/空类目/数字对不上）而代码静态看不出毛病时使用。触发场景：echarts 图表被某个大类目压扁、看板数字与业务模块自身列表对不上、口径不一致、图表显示异常需独立复现、直连开发库跑聚合 SQL 验证数据分布、echarts 本地复现截图前后对比。核心方法：先查数据（读口径 → 直连开发库跑同款聚合 SQL + GROUP BY 分布），再判定"数据 vs 展示"——口径问题修统计不改渲染，且统计 SQL 与下钻明细两处必须同步。
---

# 图表展示异常：根因核查与视觉复现（chart-anomaly-rootcause-repro）

## 适用场景与总原则

用户报告"某图表展示有问题"（整张图被压扁、某类目独占全部高度、空轨道、总数与业务列表对不上），但前端 option 代码静态检查看不出毛病。

**总原则：先查数据，再查展示。** 图表"看起来不对"，多数情况不是渲染 bug，而是统计口径混入了口径外数据（如某板块千级行被计入总量，把其他板块全部压扁）。渲染配置排障放在数据验证之后。

判定顺序：**读口径 → 直连开发库验证分布 → echarts 独立复现 → 判定数据 vs 展示 → 修复 → 前后对比闭环**。

> 注意区分另外两类问题：截图本身发白/交互验证失真是**环境失真**（页面实际是好的），见 `browser-anim-screenshot-verify`、`browser-interaction-verify`；图表首屏正常、切换筛选后**整幅空白**是实例生命周期问题（重复 init 复用旧实例 + dispose 顺序反序），见 `echarts-instance-replace-blank`。本技能针对的是**截图忠实地呈现了一个真实问题**。

## 第一步：读口径，找到可疑差异点

1. 读后端聚合 SQL / 枚举口径（看板 Service 的统计方法），列出它统计了哪些表、哪些状态。
2. 读业务模块自身管理列表的查询条件（用户"肉眼觉得应该是什么样"的参照物）。
3. 对比两者，标记差异点：看板计入而业务列表不含的状态行，就是"数字对不上/压扁"的头号嫌疑。

## 第二步：直连开发库验证数据分布

不启动业务系统，用临时 Java 文件 + 本地 .m2 里的 JDBC 驱动 jar 直接跑同款聚合 SQL 和分布查询。

**找驱动 jar**（项目用什么库找什么驱动，换库名即可）：

```bash
find ~/.m2/repository -iname "DmJdbcDriver18*.jar" | head -1
# MySQL: find ~/.m2/repository -iname "mysql-connector-j*.jar"
```

**Git Bash 环境坑（关键）**：

- **临时目录不能用 Git Bash 的 `/tmp`**：`java.exe`/`javac.exe` 是 Windows 进程，解析不了 `/tmp` 路径。临时文件放真实 Windows 目录（如项目外 `D:/code/tmp-chart-check/`，用完删）。
- **classpath 里的 jar 路径要 `cygpath -w` 转 Windows 路径**：Git Bash 的 `/c/Users/...` 形式 Java 不认。

**编译与执行**（scripts/JdbcAdhocQuery.java，任意 JDBC 4+ 驱动通用，自动按 ServiceLoader 注册无需 Class.forName）：

```bash
TMP=D:/code/tmp-chart-check && mkdir -p $TMP
cp <skill路径>/scripts/JdbcAdhocQuery.java $TMP/
JAR=$(cygpath -w "$(find ~/.m2/repository -iname 'DmJdbcDriver18*.jar' | head -1)")
javac -cp "$JAR" -d $TMP $TMP/JdbcAdhocQuery.java
java -cp "$JAR;$TMP" JdbcAdhocQuery "jdbc:dm://host:port?schema=xxx" user pass "select ..." 100
```

**跑什么查询**（两条，第二条是关键）：

1. **同款聚合 SQL**：把看板 Service 里的统计 SQL 原样拿来跑，拿到图上展示的总数，确认和页面一致（排除缓存/环境因素）。
2. **分布查询**：对状态列 `GROUP BY`，看每组的量级。口径外数据的特征一目了然——某组千级、其余组几十级，且该组恰好不在业务列表口径内。

凭证来源：开发环境 `application-*-dev.yml`（只读使用，**不要写进任何会提交的文件**；命令行参数用完随临时目录一起删除）。

## 第三步：echarts 独立视觉复现（不登录业务系统）

用项目 `node_modules` 里的 echarts dist + 静态 node 服务 + ZCode 内嵌浏览器，独立复现图表真实观感，修复前后各截一张对比。

1. **取 echarts**：`node_modules/echarts/dist/echarts.min.js` 拷进临时目录（版本对齐业务项目的 echarts，避免新旧版本行为差异干扰判断）。
2. **写 repro.html**：复刻业务图表的 option（series 类型、坐标系、dataZoom 等），数据喂第二步查到的**真实分布**。两个版本：
   - `before.html`：原始口径数据（含口径外组）——应能复现用户看到的压扁观感；
   - `after.html`：剔除口径外组后的数据——验证修复后观感恢复正常。
3. **起静态服务**（scripts/serve.js，零依赖，默认随机端口，只绑 127.0.0.1）：

   ```bash
   node <skill路径>/scripts/serve.js $TMP
   # 用 Bash 工具 run_in_background: true 执行，从后台输出里读 "serving ... at http://127.0.0.1:PORT"
   ```

4. **截图对比**：按 `browser-use` 技能操作 ZCode 内嵌浏览器，分别打开 `http://127.0.0.1:PORT/before.html` 与 `after.html` 截图。若截图发白/像冻结在入场帧，先参考 `browser-anim-screenshot-verify` 快进动画再截，避免把环境失真误判为数据问题。

复现的意义：确认"数据分布 → 视觉压扁"的因果链成立，修复方案才能对症；同时拿到修复前后的证据图，向用户交代时直观。

## 第四步：判定"数据 vs 展示"并修复

| 分布查询结果 | 结论 | 修什么 |
|---|---|---|
| 存在口径外大组，且业务模块自身列表不含该组 | **口径问题** | 修统计口径，**不动渲染** |
| 分布正常、与业务列表一致，但图仍不对 | 展示配置问题 | 查 option：y 轴 max、dataZoom、series 类型、类目轴配置 |
| 看板与业务列表口径各有道理 | 产品口径之争 | 先与用户确认应按哪个口径，再动代码 |

**口径修复必须两处同步**：统计 SQL 和下钻明细（点图表看明细的接口）走的是两条查询，只改一处必然口径漂移——图修好了、点进去明细却多出来。推荐做法：**用一个枚举/常量集中声明每个板块的 scope 片段**（如板块枚举成员携带各自的状态过滤条件），统计 SQL 与明细查询两处共用同一来源，加板块时天然两处一致。

修复后闭环验证：重跑第二步分布 SQL（口径外组应被排除）+ 重截 after 截图，两证齐全再收尾。

## 收尾清理

- `TaskStop` 停掉后台 node 静态服务；
- 删除临时目录（含 JDBC 临时 class 文件、repro.html、SQL 文件——里面可能有连接串/凭证痕迹）；
- repro 截图如需留证，放对话里即可，不落业务仓库。

## 坑速查

- Git Bash 下 java/javac/classpath 全部要 Windows 路径：jar 用 `cygpath -w`，临时目录别放 `/tmp`。
- 长聚合 SQL 别硬塞命令行：写 UTF-8 文件用 `@file.sql` 传入，免引号转义灾难。
- echarts 版本对齐业务项目（看 `node_modules/echarts/package.json`），不要随手网上拉 CDN 最新版。
- 截图异常先排除环境失真（动画冻结发白），再谈数据问题——两类问题修法完全不同。
- 修口径只改统计 SQL 不改下钻明细 = 图对了、明细仍多，用户必然回来找。
