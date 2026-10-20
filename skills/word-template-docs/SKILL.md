---
name: word-template-docs
description: 按既有 Word 模板批量生成格式完全一致的文档（验收文档/详细设计/自测报告/用户手册/方案等）。复制模板保格式、替换封面与修订记录、注入 Markdown 正文、重建目录域、渲染 PNG 逐页校验页码。当用户要求"参考某模板出一版新文档"、"格式与模板一致"、"生成验收文档/docx 报告"时使用；也适用于"参考用户手工修订过的 done- 版优化同套其他文档/反向对齐"场景（基线重建+逐段逐表 diff+目录域烘焙）。
---

# Word 模板文档生成

把一份既有 Word 模板（公司/行业固定格式）复制为副本，保留其封面、样式、页眉脚、分节，
替换正文与目录为 Markdown 内容，产出与模板格式一致的新 docx，并渲染校验。

## 何时用

- 有固定格式模板，要按新项目内容产出同类文档（验收四件套、方案书、报告……）
- 模板里有封面/修订记录表/目录页/页脚页码，手工复制粘贴容易丢格式
- 一次生成多份、或反复修订重生成

## 脚本

`scripts/` 下四个工具，全部只依赖 `python-docx`（build/analyze）与
`pywin32`、`pypdfium2`、`pillow`（渲染校验）：

| 脚本 | 作用 |
|------|------|
| `analyze_docx.py` | 模板版式体检：分节/页边距/页眉脚（含 PAGE 域检测）/样式定义/目录标题/封面段落/修订表结构/媒体与隐藏域计数，可选 `--outline` 输出标题大纲 |
| `build_docx.py` | 核心构建：复制模板 → 全文替换 → 删旧目录旧正文 → 注入 Markdown 正文 → 重建目录域 → 写修订记录 → 清未引用媒体 |
| `word2pdf.py` | Word COM 独立实例只读转 PDF，**先更新目录域**（页码才会出现），不动用户已打开的 Word |
| `pdf2png.py` | PDF 渲染 PNG 供视觉检查；`--footers` 提取页脚文字并自动校验页码单调递增 |

## 工作流

### 1. 分析模板（先读版式事实，不靠肉眼）

```bash
python scripts/analyze_docx.py 模板.docx --outline --out tpl_report.md
```

重点看：① Heading 样式是否存在且"段前分页"与否；② 有没有 `Table Grid` 表格样式；
③ "目录"标题段落挂什么样式（决定 build 定位）；④ 修订记录表（表 0）几行几列、
记录行格式；⑤ 页脚哪几节有 PAGE 域；⑥ document.xml 是否含 fldSimple（隐藏"幽灵目录"域）。

### 2. 写内容 Markdown

build 可识别的方言（**刻意无列表语法**，中文公文用不到）：

```
# ~ ######        → Heading 1..6（标题文字不要带编号）
普通段落           → Normal；支持 **加粗**
| a | b |         → 管道表格；首行=表头（表头重复/行不拆分/底纹）；单元格内禁用竖线字符
::IMG::说明文字    → 截图占位框（单格边框表 + 居中题注），后续人工贴图
!PAGEBREAK        → 分页
```

- 行首编号会被自动剥离（模板标题样式自带自动编号时）；`--mode manual` 则按上下文
  给 3 级及以下标题重算字面编号（如 `7.4.1`，而非平铺序号）——适用于 1/2 级样式
  自动编号、深层级不自动的模板（用户操作手册常见）。
- 内容纪律：数字/人名/URL 只能来自用户提供的事实材料，不编造；没有的事实写
  "以实际部署环境为准"。

### 3. 构建

```bash
python scripts/build_docx.py 模板.docx content.md 输出.docx --mode manual \
  --replace "旧项目名称=新项目名称" --replace "二〇二五年五月=二〇二六年十月" \
  --rev-date 2026.10.14 --rev-ver V1.0 --rev-desc 新建 --rev-author 项目组
```

- `--replace` 可多次，替换覆盖**全文**（封面、修订表、页眉脚、域缓存文本）。
  日期若有多种写法（`二〇二五年五月`、`2025年5月`）要逐个传。
- 构建结束打印统计：`body_start / toc paras / rev_row / tables / paras / media dropped / footer_fixed`。

### 4. 渲染校验（必须做，不要目测）

```bash
python scripts/word2pdf.py 输出.docx 预览.pdf        # MS Word COM；无 Word 时降级 LibreOffice
python scripts/pdf2png.py 预览.pdf pages --footers   # 页脚数字单调性脚本判定
```

- 打开生成的 docx 时 Word 会提示"更新域"→ 是，目录页码即刷新（build 已设
  `updateFields`，有的版本仍会问一次）。
- `--footers` 输出每页页脚文字 + 单调性结论，断点直接列出。**勿用肉眼读渲染图上的
  小字号页脚数字**（1.6x 下 40/13 会看成 4/1）。
- 交付前用 zipfile 直读 document.xml 做残留检查：旧项目名/旧日期/旧人名应无命中；
  注意真实业务词（如赛道名）可能合法包含旧关键字，逐条判断。

## 从用户修订版反向对齐同套文档

用户把某份生成版改名 done- 前缀并大量手工修改后，要求：参考 done- 版的改动点
优化同套其他文档，并把 done- 版的目录域更新保存。核心思路：**先重建基线做 diff，
归纳改动模式，再反向应用到其余文档的内容源 md，最后用原管线重建**。

### 1. 基线重建

用生成管线（build 脚本 + 当初的内容 md + 当初的构建参数）重建一份"基线 docx"，
与 done- 版对比。**不要直接拿内容 md 对比 done- 版**——build 过程有编号剥离/目录
重建/替换等加工，结构对不齐。

### 2. 逐段 + 逐表双重 diff

- 段落：python-docx 提取两版全部非空段落 `(style, text)` 序列，`difflib.SequenceMatcher`
  对齐。
- **表格必须单独再 diff 一遍**：行文本用 `cell.text` 去重合并单元格后拼接。表格差异是
  段落 diff 完全看不到的盲区——环境表被用户换回模板值就是靠表格 diff 才发现的。
- 跳过目录条目段的差异（那是域更新造成的，不是用户改动）。

### 3. 改动模式归纳（真实案例提炼的典型用户偏好，可作探针）

- 通用章节回填模板原文（目的/原则/依据/开发语言/技术框架/应急组织等套话），
  业务事实章节保留生成内容
- 长句拆段："引导句：…（1）…；（2）…"连排 → 引导句独立成段 + 每个编号项独立成段
- 环境/技术栈口径统一到模板值（而非代码库真实值）
- 修订记录表改手填日期（作者列留空）
- 细节替换：`7×24`→`7*24`、"与"→"/" 等
- 验证回填来源：把 done 版新出现的句子去模板 document.xml 里 grep，命中即确认
  来自模板原文

### 4. 反向应用

把归纳出的规则交给并行子代理改各文档的内容源 md → 用原构建参数重建。构建参数
要与用户偏好一致：如 `--rev-date` 用用户手填的日期、`--rev-author` 留空。

### 5. 目录烘焙（done- 版只更新域，绝不动内容）

Word COM `DispatchEx` 打开（`ReadOnly=False`）→ `TablesOfContents(i).Update()` +
`doc.Fields.Update()` + 遍历 `StoryRanges` 再刷 → `doc.Save()`。done- 版文件同样只做
域更新不动内容。跑前先检查目录下无 `~$` 锁文件（用户 Word 可能开着）。

### 6. 校验

zipfile 直读 document.xml 查违禁残留；pypdfium2 提取页脚数字验单调。
小字号页脚勿肉眼读（1.6x 渲染图上 "28" 会看成 "2"）。

### 注意事项

- 用户改过的文件**绝不重建**，只更新域；同套其他文件重建前先备份旧版。
- "第X章"式目录编号可能只是模板 Heading 1 样式自带的编号定义（`lvlText=第%1章`）
  经域更新渲染出来，不要误判为用户改动。
- 修订记录表的空白行复用逻辑对用户手填行同样适用（vals 写入第一个空白行）。

## 踩坑清单（每条都真实付过学费）

1. **styleId 是数字**：模板里 `"2"`=Heading 1、`"16"`=toc 1。定位样式必须先建
   id→name 映射，不能按名字找。
2. **"目录"两字本身是 toc 样式**：删旧目录条目时要把标题段排除（`t != "目录"`）。
3. **隐藏目录域**：有的模板在 fldSimple 里藏着整份旧目录，Word 一更新域就"长出来"。
   删正文时必须连域缓存一起清。analyze 报告的 fldSimple 项就是为此设的。
4. **先插后删**：新目录域要**先**插入再删旧段落——反过来插到已 detach 的元素前会静默丢失。
5. **删正文连带删分节符**：页脚 PAGE 域挂在正文的 sectPr 上，删旧正文后页码断链。
   build 内置 `ensure_footer_page_number()` 给最后一节兜底补居中 PAGE 域。
6. **修订记录表要复用空白行**：清空模板历史行后写第一行，别 append 新行（行数会膨胀）。
7. **模板可能没有 Table Grid 样式**：只有 Normal Table。build 内置样式兜底+直接加边框。
8. **表格列宽**：均分列宽在中文长句下换行极丑。build 按内容长度加权
   （`min(len,20)**0.7`、最小 1000 twips、fixed layout、gridCol+tcW、表头 tblHeader+cantSplit）。
9. **msiexec 安装 LibreOffice 可能全部挂死**（无管理员权限/无 UAC 交互）：
   渲染优先走已装 MS Word COM（word2pdf.py），保真且能更新目录域。
10. **docx 被占用**：用户 Word 开着同名文档时保存报 PermissionError——提示用户关闭后重试；
    竞态覆盖时用 zipfile 直读 XML 判定交付文件的真实版本，别信渲染缓存。
11. **模板正文/标题靠直接格式而非样式定字体与缩进**：很多模板的正文段落带 run 级 rPr
    （宋体/Times New Roman）和段级 w:ind（firstLine=480 即首行缩进 2 字符），标题 run 带
    rPr（黑体+字号），这些都不在样式定义里。只挂样式注入正文会出现"段首不空两格、
    标题字体变了"。对策：build 在删旧正文前收割格式原型（harvest_prototypes：取最长且
    非加粗的 Normal 段的 run rPr 与 w:ind 做正文原型；各级 Heading 首个 run 的 rPr 做
    标题原型），注入时逐 run 套 rPr、逐段套缩进（居中段/题注不套）。构建日志的
    `proto: body_rpr/ind/head` 三项即诊断该能力是否生效。

## 环境

- Windows + 已装 MS Word（渲染路线）；`pip install python-docx pywin32 pypdfium2 pillow`
- build/analyze/pdf2png 跨平台（纯 python-docx/pdfium）；word2pdf 仅 Windows+Word
