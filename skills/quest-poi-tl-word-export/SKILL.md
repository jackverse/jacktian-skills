---
name: quest-poi-tl-word-export
description: Spring Boot 宿主项目用 quest 导出任务 + poi-tl 从 docx 样例生成 Word 报告的完整套路（两个环节）：①按「表格索引+行索引+列索引」从设计样例挖 {{占位符}} 模板——文本匹配必败于 Word 把长文本切成多个 w:r/w:t；②quest starter 导出任务产非 Excel 产物——继承 ExportServiceImpl、自写文件到 QuestProperties.getFilePath() + download(recordId, fileName) 登记；③javac+python 离线验证渲染产物（不起服务）。触发场景：quest 导出任务、poi-tl、Word 报告导出、docx 模板/占位符挖坑、导出任务出非 Excel 产物、w:r/w:t 切分、vMerge/gridSpan 合并单元格、XWPFTemplate、任务记录页下载导出产物。凡"按 Word 样例出报告""quest 导出任务怎么接"均应参考。
---

# quest 导出任务 + poi-tl 生成 Word 报告（quest-poi-tl-word-export）

后台"按设计样例导出统计报告/台账/审批单"类需求的标准打法，分两个独立环节：

- **环节 A · 模板制作**：从设计给的 docx 样例挖 `{{占位符}}`，产出 poi-tl 模板（纯 Python，零 Java）
- **环节 B · quest 接线**：quest starter 的导出任务实现，渲染模板并把产物挂到任务记录下载（机制经反编译 starter 核实）

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
@QuestImplement                                   // 裸注解，dto 用默认 Void（导出无动态参数实体）
public class XxxReportExportService extends ExportServiceImpl<Void> {

    @Override
    public void run(Long recordId, QuestConfigDTO config, Long userId) {
        // 1. 参数：从任务配置的 template JSON 解析（导出发起没有动态参数表单）
        // 2. 查数：业务数据照常走本模块 Service
        // 3. 渲染：poi-tl 填充模板，产物写到 QuestProperties.getFilePath() 目录
        // 4. 登记：return download(recordId, fileName);
    }
}
```

要点（均经反编译 starter 核实）：

- **只覆盖三参 `run(Long recordId, QuestConfigDTO config, Long userId)`**，其余方法不动；
- 实现类注册为 Spring bean（如 `@Component`），**类简单名即 bean 分发依据**：starter 按 `TB_QUEST_CONFIG.implement_class` 的类简单名 lowerFirst 从容器取实现；
- 登记走任务配置页或 migration SQL，关键字段：`quest_type='export_task'`、`implement_class`=全限定类名、`template`=参数 JSON；
- 发起端点是 starter 薄入口自带的 `POST /quest/export/{configId}`，**宿主严禁自建 quest Controller/页面**；
- 产物落盘目录取 `QuestProperties.getFilePath()`；
- `return download(recordId, fileName)` → 基类 `setFile` 落 `QuestRecordEntity` 的 fileName/fileSize 并置 `status=done`，任务记录页即可下载。

### 文件名必须带时间戳（防覆盖）

`setFile` 按 fileName 解析产物文件，**同名会把旧任务记录指向的产物文件覆盖掉**。固定规则：

```java
String fileName = "xxx_report_" + LocalDateTime.now()
        .format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + ".docx";
```

### poi-tl 渲染骨架

```java
Map<String, Object> data = new HashMap<>();
data.put("item_code_count", count);        // key 与模板占位符逐一对应

try (InputStream is = getClass().getResourceAsStream("/templates/xxx_report.docx")) {
    XWPFTemplate.compile(is)               // 模板放 resources，必须流读——打 jar 后 File 读不到
        .render(data)
        .writeAndClose(new FileOutputStream(new File(path, fileName)));
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
| 9 | 以为导出发起有动态参数表单，做了参数收集 | 无表单；参数走任务配置 `template` JSON 自行解析 |
| 10 | 给 `vM:continue` 被合并格也写了占位符，内容不显示 | 只写 restart 格；dump 会标出 continue 格 |
| 11 | 自建 quest 导出端点/页面 | 发起/下载全走 starter 薄入口自带端点 |

## 真实案例（已泛化）

某 Spring Boot 管理项目需按设计样例 docx 产统计报告 Word（固定表格 + 多组跨行/跨列合并）。环节 A 用坐标挖坑法（zipfile + ElementTree 整格替换）约半小时出模板，合并版式零破坏；环节 B 继承 quest starter `ExportServiceImpl<Void>`，产物带时间戳落 `QuestProperties.getFilePath()` 后 `download` 登记，任务记录页直接下载；渲染走 javac+python 离线管线验证（占位符全替换、无残留、合并保留）后才联调，一次通过。
