---
name: quest-poi-tl-word-export
description: Spring Boot 宿主项目用 quest 导出任务 + poi-tl 从 docx 样例生成 Word 报告的完整套路（两个环节）：①按「表格索引+行索引+列索引」从设计样例挖 {{占位符}} 模板——文本匹配必败于 Word 把长文本切成多个 w:r/w:t；②quest starter 导出任务产非 Excel 产物——继承 ExportServiceImpl、自写文件到 QuestProperties.getFilePath() + download(recordId, fileName) 登记，发起两条路：quest 工作台（三参 run）与宿主业务页面带参（QuestRunnerService.export(code, param, userId) 进程内调用 + 联动跳任务记录页）；③javac+python 离线验证渲染产物（不起服务）。触发场景：quest 导出任务、poi-tl、Word 报告导出、docx 模板/占位符挖坑、导出任务出非 Excel 产物、w:r/w:t 切分、vMerge/gridSpan 合并单元格、XWPFTemplate、任务记录页下载导出产物、下载名与内容扩展名不一致、宿主页面带参发起导出。凡"按 Word 样例出报告""quest 导出任务怎么接""业务页面一键出报告"均应参考。
---

# quest 导出任务 + poi-tl 生成 Word 报告（quest-poi-tl-word-export）

后台"按设计样例导出统计报告/台账/审批单"类需求的标准打法，分两个独立环节：

- **环节 A · 模板制作**：从设计给的 docx 样例挖 `{{占位符}}`，产出 poi-tl 模板（纯 Python，零 Java）
- **环节 B · quest 接线**：quest starter 的导出任务实现，渲染模板并把产物挂到任务记录下载（机制经反编译 starter 2.4.2 核实；发起两条路——quest 工作台 / 宿主业务页面带参）

## 环节 A：从 docx 样例挖 poi-tl 模板

### 原则：按坐标挖，绝不按文本挖

Word 会把长文本**切成多个 `w:r`/`w:t` run**（校对标记、拼写检查、rsid、中英混排、编辑历史都会切）。按文本匹配找插入点必失手：要么匹配不到，要么替换后把一个词劈成半截。正确做法：

- 按 **「表格索引 + 行索引 + 列索引」** 定位单元格，**整格替换**；
- 格式靠"抄"不靠"猜"：保留原格首段的 `pPr`（对齐/缩进/行距），deepcopy 格内任意 run 的 `rPr`（字体/加粗/斜体）；
- 合并单元格的 `vMerge`（跨行）/`gridSpan`（跨列）都在 `tcPr` 里——**只动 `w:p`/`w:r`/`w:t`、不碰 `tcPr`，合并版式天然保留**。

### 用脚本三步出模板（scripts/docx_cell_templater.py）

```bash
# 1. dump 样例：看每张表的坐标、现文本、合并信息，挑选要挖的格子
python docx_cell_templater.py dump --src 样例.docx

# 2. 写 mapping.json（坐标 → 占位符）
# 3. apply 出模板
python docx_cell_templater.py apply --src 样例.docx --map mapping.json --out 模板.docx

# 验证：对模板/渲染产物再 dump，或 grep '{{' 查残留
python docx_cell_templater.py dump --src 产物.docx
```

mapping.json（列表默认作用于 `word/document.xml`；按 part 分组可挖页眉页脚）：

```json
[
  {"table": 0, "row": 2, "col": 1, "text": "{{item_code_count}}"},
  {"table": 0, "row": 3, "col": 1, "text": "{{item_name}}"}
]
```

脚本要点（手写等价逻辑时的骨架）：

```python
import copy, io, zipfile, xml.etree.ElementTree as ET

def parse_preserving_ns(data):          # 1) 先收集并注册全部命名空间，防 ns0:/ns1: 前缀污染
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
        ET.register_namespace(prefix, uri)
    return ET.fromstring(data)

def set_cell_text(tc, text):            # 2) 整格替换
    paras = tc.findall(qn("w:p"))
    ppr = copy.deepcopy(paras[0].find(qn("w:pPr"))) if paras and paras[0].find(qn("w:pPr")) is not None else None
    rpr = next((copy.deepcopy(r.find(qn("w:rPr")))                # 优先带文本的 run 的 rPr
                for p in paras for r in p.findall(qn("w:r"))
                if r.find(qn("w:rPr")) is not None and r.find(qn("w:t")) is not None), None)
    for p in paras:
        tc.remove(p)                      # 只删段落，tcPr 原封不动
    for line in text.split("\n"):         # \n 拆多段，均套用同一格式
        p = ET.SubElement(tc, qn("w:p"))
        if ppr is not None: p.append(copy.deepcopy(ppr))
        r = ET.SubElement(p, qn("w:r"))
        if rpr is not None: r.append(copy.deepcopy(rpr))
        t = ET.SubElement(r, qn("w:t"))
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")  # 3) 空格/占位符不被丢弃
        t.text = line

# 4) 序列化 + 重打包：unicode 序列化后手工拼 Word 标准声明（别用 ET 的 standalone 参数，
#    各 Python 版本时有时无）；zip 其余 entry 原样复制，仅替换改过的 part
xml_str = ET.tostring(root, encoding="unicode")
data = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml_str).encode("utf-8")
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
    for info in zin.infolist():
        zout.writestr(info, replacements.get(info.filename, zin.read(info.filename)))
```

### 模板设计约定（固定行数报告类）

- **不搞行循环**（不用 poi-tl 行循环标签）：固定行数的报告/审批单，逐格命名占位符（如 `{{item_code_count}}`）+ Map 填充最稳，合并版式零风险；
- 占位符命名小写+下划线，与填充 Map 的 key 逐一对应；
- `vM:continue`（被合并吞掉的格子）**不写占位符**——它的内容不显示，只写 `vM:restart` 那一格；dump 输出里会标出哪些格是 continue。

## 环节 B：quest starter 导出任务产出 Word

### 实现骨架

```java
@QuestImplement
public class XxxReportExportService extends ExportServiceImpl<XxxReportDTO>
        implements ExportService<XxxReportDTO> {

    // 四参 run：宿主页面带参发起（QuestRunnerService.export(code, param, userId)）走这里
    @Override
    public CompletableFuture<QuestRecordEntity> run(Long recordId, QuestConfigDTO config,
                                                    XxxReportDTO param, Long userId) {
        // 1. 参数：param != null → 页面带来的草稿直接渲染（所见即所得）
        //          param == null → 回落 config.template JSON 参数 + 服务端现查
        // 2. 查数：业务数据照常走本模块 Service
        // 3. 渲染：poi-tl 填充模板，产物写到 QuestProperties.getFilePath()（文件名带时间戳）
        // 4. return download(recordId, fileName);
    }

    // 三参 run：quest 工作台「导出任务」发起走这里，基类是 no-op——委托四参即可复用同一套逻辑
    @Override
    public CompletableFuture<QuestRecordEntity> run(Long recordId, QuestConfigDTO config, Long userId) {
        return run(recordId, config, null, userId);
    }
}
```

要点（均经反编译 starter 2.4.2 核实）：

- **两个 run 的返回类型是 `CompletableFuture<QuestRecordEntity>`，不是 void**；`download(Long recordId, String fileName)` 同类型、内部一行 `questRecordService.setFile(recordId, fileName)`——实现里直接 `return download(...)`；
- 实现类注册为 Spring bean（如 `@Component`），**类简单名即 bean 分发依据**：starter 按 `TB_QUEST_CONFIG.implement_class` 的类简单名 lowerFirst 从容器取实现（`getBean(StrUtil.lowerFirst(implementClass))`）；
- 登记走任务配置页或 migration SQL，关键字段：`quest_type='export_task'`、`implement_class`=全限定类名、`template`=参数 JSON；
- 产物落盘目录取 `QuestProperties.getFilePath()`。

### 发起路径与 run 签名的对应关系（别只覆盖一个 run）

starter 对两条发起路径**各自调度不同的 run 重载**，且基类对两个 run **都是 no-op（字节码 aconst_null 直接返回）**：

| 发起路径 | 入口链 | 调度的 run | 记录 content 列存的 |
|---|---|---|---|
| quest 工作台「导出任务」 | 工作台页 → 薄入口 `POST /quest/export/{configId}` → `RunnerService.export(configId, userId)` | **三参** `run(recordId, config, userId)` | `config.code` |
| 宿主页面带参 | 宿主 Controller 进程内 → `RunnerService.export(code, param, userId)` | **四参** `run(recordId, config, param, userId)` | `toJSONString(param)` 全量 JSON |

只覆盖其中一个 run，另一条路径就会调到基类 no-op：返回 null 后 RunnerService 在其上挂 `whenComplete` 直接 NPE，任务记录**当场标 fail**。所以：

- 只做工作台发起 → 覆盖三参即可；
- 只做页面带参发起 → 覆盖四参即可；
- **两类发起都要支持（或拿不准）→ 两个都覆盖**：三参一行委托 `run(recordId, config, null, userId)`，成本一行，免疫路径差异（工作台配置页随时可能有人点「导出」）。

### 宿主业务页面带参发起（QuestRunnerService.export）

需求「业务页面选好条件 → 一键出报告 → 去任务记录页下载」时，不必绕工作台：starter `com.wondersgroup.quest.service.QuestRunnerService` 提供 public 重载 `<T> String export(String code, T param, Long userId)`，**宿主业务 Controller 进程内直调**——不新建/扩展 quest Controller、不碰 quest 前端页面，不违反「严禁重建 quest 端点」边界（quest 的端点与页面一行不动）。

机制链路（反编译 2.4.2 核实）：

```text
export(code, param, userId)
  → questConfigService.getByCode(code) 校验任务配置存在
  → resolveExportFileName(config, …) 预置 fileName
  → addExportRecord(config, userId, fileName, toJSONString(param))   // 建 running 记录，param 全量 JSON 进 content
  → QuestProgressCenter.accept(configId, configName, userId) → executionId
  → QuestExecutionContext.bind + progressCenter.begin
  → getBean(lowerFirst(implementClass)) 反射取实现 bean
  → 四参 run(recordId, config, param, userId)（whenComplete 收尾成功/失败）
  → 返回 executionId（String）
```

宿主端点形态（用户身份只在 Controller 层取）：

```java
@RequiresPermissions("xxx:report:export")        // 进程内调用不走 quest 端点，沿用业务权限点即可，无需 quest:export
@GetMapping("export")
public Result<String> exportReport(XxxQuery query) {
    XxxReportDTO report = xxxReportService.buildDraft(query);    // 用页面当前条件组装草稿 DTO
    return new Result<String>().ok(
            questRunnerService.export(export_monthly_report, report, SecurityUser.getUserId()));  // code=常量（对齐 TB_QUEST_CONFIG.code），data=executionId
}
```

- 注入 `QuestRunnerService` 直用；`export(...)` 返回 **executionId**，前端拿它提示「已提交，可去任务记录页查看进度/下载」；
- code 常量对齐 `TB_QUEST_CONFIG.code`（如 `export_monthly_report`），命名小写+下划线；
- param 即业务 DTO 全量 JSON，序列化后存任务记录 content 列——报表 DTO 几 KB 量级毫无压力，不用省；
- 需定制产物文件名（非 Excel 产物务必）：改用 4 参重载 `export(code, param, userId, fileName)` 传最终名，否则记录展示名/下载名停留 starter 预置的 xlsx 形态——详见「download 只改 FILE_PATH 不改 FILE_NAME」节。

四参 run 内参数双来源，同一实现类同时服务页面与工作台：

```java
if (param != null) {
    // 页面带参：用草稿渲染（用户在页面上看到的条件就是产出）
} else {
    // 三参委托进来（工作台发起）：回落 config.template JSON 参数 + 服务端现查
}
```

### 前端联动跳任务记录页

提交成功后 `ElMessageBox.confirm` 引导跳转；跳转口径与 `@wonders/quest-web` 包内一致（包内即 `window.location.hash = "/quest/record"`），hash 路由宿主内 `router.push("/quest/record")` 等效：

```ts
await exportReportApi(query)
ElMessageBox.confirm('导出任务已提交，是否前往任务记录页下载？', '提示', { type: 'success' })
  .then(() => { router.push('/quest/record') })
  .catch(() => undefined)   // 取消分支：no-empty-function 规则会拦 .catch(() => {})，写 undefined
```

### 产物目录：quest.file-path 必须配绝对路径（starter 不解析宿主 `$` 前缀约定）

宿主项目常有相对路径约定（如 startup 的 `RelativePathParser`：`$` 前缀值 `$\upload\` = 相对模块 classpath 解析，oss 上传经 PathConfig/PathContext 正常吃到）。**quest starter 不接入这层约定**：`QuestProperties.getFilePath()` 的值被文件链原样使用——poi-tl 渲染落盘是业务代码自己拼 `new FileOutputStream(new File(path, fileName))`，裸值 `$\upload\` 按相对路径找不存在的目录，直接 FileNotFoundException（startup dev 首跑实锤）。

细节（字节码核实，解释为何「oss 正常、quest 必炸」）：

- starter 自带的 `QuestPathResolver.resolve` 虽认 `$` 前缀，但语义是**剥 `$` 拼 `user.dir`（进程工作目录）**，与宿主「相对模块 classpath」约定不同——即便走到它，落点也不是宿主语义想要的位置；
- 任务记录下载链 `QuestRecordService.resolveCheckedFile` 以 `resolve(file-path)` 为基目录做 canonical 越界校验，**落盘目录必须落在该基目录内**，否则下载时报「下载文件路径越出基目录，已拒绝访问」——file-path 与实际落盘目录不一致时下载必炸。

连带坑：业务此前若一直走「同步内存渲染直下下载」（不落盘），quest.file-path 配错**不会暴露**，直到第一次真正走 quest 任务落盘才炸——排查别只盯报错栈，回溯配置值的约定前缀。

规避三条：

- `quest.file-path` 必须配**绝对路径**（Windows `E:/Git/startup/upload/`、Linux `/repository`；starter 启动检查给出的示例值 `/data/quest` 也是绝对路径）；
- 不要把带 `$` 前缀约定的占位属性（如 `${local.file.path}`）直接喂给 quest.file-path——占位符解析后仍是 `$...` 约定值，oss 正常、quest 必炸；
- 渲染前兜底目录缺失（新机器首跑）：

```java
File target = new File(basePath, fileName);            // basePath=绝对路径（解析后的 file-path）
Files.createDirectories(target.getParent().toPath());  // 目录不存在直接建，免疫新机器首跑
```

### 文件名必须带时间戳（防覆盖）

`setFile` 按 fileName 解析产物文件，**同名会把旧任务记录指向的产物文件覆盖掉**。固定规则：

```java
String fileName = "xxx_report_" + LocalDateTime.now()
        .format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + ".docx";
```

记录创建那一刻 fileName 已被 RunnerService 的 `resolveExportFileName` **预置**写入任务记录（两条发起路径都如此）；run 里 `download(recordId, 自己拼的时间戳名)` 经 `setFile` 只能保证**物理文件**不重名、不覆盖旧产物——但 `setFile` **不改记录展示名 FILE_NAME**，下载名仍是预置名（见下节）：时间戳防的是覆盖、不是改名。

### download 只改 FILE_PATH 不改 FILE_NAME（下载名与内容名实分离）

反编译 2.4.2 定案：`ExportServiceImpl.download(recordId, fileName)` → `QuestRecordService.setFile` 的 DB 更新列**仅有 FILE_PATH/FILE_SIZE/STATUS/END_DATE/COST**——run 里自拟的文件名只进 FILE_PATH（下载端按它取物理文件）；而任务记录**展示名**与下载 **Content-Disposition** 用的是 FILE_NAME，停留在 addExportRecord 创建时 `resolveExportFileName` 生成的预置名 `{config.name}_{随机时间戳}_{6位随机串}.xlsx`。症状：run 里自拟 docx 名落盘并 download 登记后，用户从任务记录下载到「**.xlsx 文件名、Word 内容**」的文件（二跑实锤）。

正解——**发起时就传最终名、run 里取同一个名字**：物理文件、FILE_PATH、FILE_NAME 三者统一，双端零漂移。

```java
// ① 发起侧：4 参重载 export(String code, T param, Long userId, String fileName)
//    resolveExportFileName(config, override) 对含 . 的 override 原样采用（不含 . 才追加 config.exportExtension），
//    FILE_NAME 自记录创建起即正确
questRunnerService.export(export_monthly_report, report, SecurityUser.getUserId(),
        fileService.buildFileName("monthly_report", "docx"));
```

```java
// ② run 内：QuestExecutionContext.current().getFileName() 取发起时的同一名字渲染落盘 + download 登记
//    （runner 发起时同线程 bind，public API，同步实现内可用）；
//    兼容工作台发起（无 override，预置名必为 .xlsx 形态）：以 .docx 结尾才采用，否则回落自拟名
String execName = QuestExecutionContext.current().getFileName();
String fileName = execName != null && execName.endsWith(".docx")
        ? execName
        : "xxx_report_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + ".docx";
// 渲染写 new File(basePath, fileName) 后
return download(recordId, fileName);
```

兼容事实（反编译核实）：runner 的 whenComplete lambda 只做 fail/complete 标记、**不动文件名**——FILE_NAME 一经创建写错便无人纠正；工作台无 override 发起路径按 ② 兜底后**内容正确，但记录展示名保留 starter 预置形态**（starter 不提供更新 FILE_NAME 的 API，无法修正）。

### poi-tl 渲染骨架

```java
Map<String, Object> data = new HashMap<>();
data.put("item_code_count", count);        // key 与模板占位符逐一对应

try (InputStream is = getClass().getResourceAsStream("/templates/xxx_report.docx")) {
    XWPFTemplate.compile(is)               // 模板放 resources，必须流读——打 jar 后 File 读不到
        .render(data)
        .writeAndClose(new FileOutputStream(new File(path, fileName)));
        // ^ path=quest.file-path 解析出的绝对路径（务必绝对路径，见上节），fileName 带时间戳
}
```

依赖 `com.deepoove:poi-tl`，版本与宿主 POI 大版本有强对应（如 poi-tl 1.12.x ↔ POI 5.2.x），引入前先看依赖树防版本冲突。

## 离线验证管线（不起后端服务）

联调前先本地闭环，三步：

```bash
# 1. 导出宿主全量 classpath
mvn -pl <业务模块> -am dependency:build-classpath -Dmdep.outputFile=cp.txt

# 2. 临时 main 直调渲染段（注入的 Service 可置 null，只测 poi-tl 渲染）
javac -cp "$(cat cp.txt)" TmpRenderMain.java   # git-bash 注意：cp.txt 本就是 Windows 分号分隔格式
java -cp "$(cat cp.txt);." TmpRenderMain        # 原样传给 javac/java，不要换冒号

# 3. python 验证产物：占位符全替换、无 {{ 残留、合并结构未破坏
python docx_cell_templater.py dump --src 产物.docx
grep -c '{{' <(python 解析产物 w:t 文本)         # 应为 0
```

## 坑清单（速查表）

| # | 坑 | 规避 |
|---|----|------|
| 1 | 按文本匹配挖占位符，长文本被切成多个 w:r/w:t 匹配不到/劈半截 | 按 (表，行，列) 坐标整格替换 |
| 2 | ET 重序列化后命名空间变 `ns0:`/`ns1:`，Word 打不开 | 解析前 iterparse start-ns 收集并 register 全部前缀 |
| 3 | 依赖 ET 序列化的 `standalone` 参数，Python 版本间时有时无 | unicode 序列化 + 手工拼 XML 声明 |
| 4 | 空格新建 run 未设 `xml:space="preserve"`，占位符/空格被 Word 丢弃 | 建 run 时一律设 |
| 5 | 同名产物文件覆盖旧任务记录的下载内容 | 文件名拼 `yyyyMMddHHmmss` 时间戳 |
| 6 | 模板用 `new File("src/main/resources/...")` 读，打 jar 后 FileNotFound | `getResourceAsStream` 流读 |
| 7 | poi-tl 与宿主 POI 版本冲突，运行期 NoSuchMethod | 对照官方兼容表选版，先看依赖树 |
| 8 | git-bash 下把 cp.txt 分号换冒号，javac 全部 classpath 失效 | 原样传，Windows JVM 认分号 |
| 9 | 以为导出参数只能来自任务配置 `template` JSON | 页面带参发起走 `RunnerService.export(code, param, userId)`，草稿 JSON 存记录 content，run 四参直取 |
| 10 | 给 `vM:continue` 被合并格也写了占位符，内容不显示 | 只写 restart 格；dump 会标出 continue 格 |
| 11 | 自建 quest 导出端点/页面 | 带参发起走宿主 Controller 一行进程内调 `RunnerService.export(...)`（quest 端点/页面不动）；发起界面全走 starter 薄入口自带端点 |
| 12 | 只覆盖一个 run，另一条发起路径调到基类 no-op → `whenComplete(null)` NPE → 记录当场标 fail | 按发起路径对应覆盖三参/四参；双路径（或拿不准）三参委托 `run(recordId, config, null, userId)` |
| 13 | 按旧文档把 run 写成 `void` | 返回类型是 `CompletableFuture<QuestRecordEntity>`，实现里直接 `return download(recordId, fileName)` |
| 14 | quest.file-path 配了宿主 `$` 前缀约定值（starter 不解析 RelativePathParser，裸 `$\upload\` 落盘 FileNotFoundException） | 绝对路径；不喂 `${local.file.path}` 类占位属性；渲染前 `Files.createDirectories` 兜底目录缺失 |
| 15 | `download(recordId, 自拟名)` 只改 FILE_PATH 不改 FILE_NAME，下载到「xlsx 文件名、Word 内容」 | 发起时 4 参 `export(code, param, userId, fileName)` 传最终名 + run 用 `QuestExecutionContext.current().getFileName()` 取同名渲染落盘登记 |

## 真实案例（已泛化）

某 Spring Boot 管理项目需按设计样例 docx 产统计报告 Word（固定表格 + 多组跨行/跨列合并）。环节 A 用坐标挖坑法（zipfile + ElementTree 整格替换）约半小时出模板，合并版式零破坏；环节 B 继承 quest starter `ExportServiceImpl`，产物带时间戳落 `QuestProperties.getFilePath()` 后 `download` 登记，任务记录页直接下载；业务侧要求「页面上选好条件一键出报告」，经反编译 starter 2.4.2 摸清 `QuestRunnerService.export(code, param, userId)` 带参通道——宿主 Controller 进程内一行发起、四参 run 直取页面草稿、三参委托 null 兼容工作台发起，前端 confirm 后跳 `/quest/record`，不碰 quest 任何端点与页面；渲染走 javac+python 离线管线验证（占位符全替换、无残留、合并保留）后才联调，一次通过；二跑实锤 `download` 只改 FILE_PATH 不改 FILE_NAME（下载到「xlsx 文件名、Word 内容」），反编译定案后改为发起 4 参 export 传最终名、run 取 execution 同名渲染，物理文件/FILE_PATH/FILE_NAME 三端统一。
