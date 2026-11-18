# 专题:既有 docx 定点重构(按新大纲插章节,不重建)

## 何时使用

验收/交付的手册、报告**已成稿**(有截图、版式、目录、页眉脚),而验收口径变了——
比如初验报告的"建设内容"调整后,手册需要补新章/新节、加"章节与建设内容对照表"、
补新功能小节和配图。约束是**绝不重建文档**(通用纪律第 7 条:手工改过/有图的文件
只能定点改),必须在原 docx 的**副本**上做外科手术,保留原有截图、样式、分节与页码。

与相邻专题的分工:
- template-generate 是"从源 md 整篇重建",本专题是"在成品上定点插入";
- node-editing 是无 Python 时的 JSZip 文本级直改,本专题默认有 python-docx;
- img-backfill 回填 `::IMG::` 占位(build 产物),本专题按文档既有截图风格现场插占位/配图;
- reverse-align 处理"用户改过一版、同套其他文档对齐",本专题处理"大纲口径整体升级"。

## 流程总览

1. **副本隔离**:原文件不动;编辑脚本 `Document(原路径)` 打开、`save` 到新输出目录。
   脚本崩溃在 save 之前则磁盘无损,可放心反复重跑。
2. **先分析后动手**:对原件跑 `analyze_docx.py --outline` 拿样式大纲,据此选每个插入点的
   锚点文本;全文 txt(`extract` 类脚本或 analyze 报告)用于改写类定位。
3. **写编辑脚本**:锚点定位 + `Inserter` 游标式插入(见 `scripts/docxkit.py`),逐文档一个函数,
   末尾统一 save。
4. **收尾**:Word COM 刷新目录域并回存(见下"收尾"),再导 PDF 渲染目检。
5. **校验三件套**(见下):大纲对账、表格边框审计、contact sheet 目检。

## 核心手法:游标式 Inserter(add_* 创建 + lxml 搬移)

python-docx 没有"在任意位置插入"的公开 API:`doc.add_heading/add_paragraph/add_table`
一律创建在**文末**。做法是先在文末创建元素,再用 lxml 的 `addnext/addprevious` 把
XML 元素搬到锚点处。`scripts/docxkit.py` 的 `Inserter` 封装成游标:

```python
ins = Inserter(doc, anchor_para)                 # after 模式:插到锚点段之后
ins.heading('创业大赛管理', level=1)              # 标题(继承样式级自动编号)
ins.para('本章介绍……')                           # 正文段,接着上一条往下排
ins.img('shot.jpg', width_cm=14.5)              # 居中插图
ins.caption('图1 登录页')                        # 居中题注
ins.placeholder('登录页(登录按钮)', '登录页')      # 【截图占位:…】+题注,后补图
ins.table([[...]], widths_cm=[3.6, 10.9])        # 六边框表(自动补表后空段)
ins.tip('……')                                    # "提示:"段

ins2 = Inserter(doc, next_chapter_h1, before=True)  # before 模式:插到锚点之前
ins2.heading('新章节', level=1)
ins2.para('……')                                  # 连续调用保持调用顺序,锚点始终在最后
```

### 关键坑:addnext 是"插到锚点之后"

想"插到某章标题**之前**"(新章排在原章前面),必须 `before=True`(内部 `addprevious`
且**游标不前移**,锚点始终是原章标题)。若误用 after 模式(addnext+游标前移),第一个
新元素插在原章标题**之后**,后续内容接在其后——整章新内容插进了"原章标题与原章正文
之间",文档结构被破坏,而脚本不报任何错。本次实战真实踩过,靠交付前重建大纲对账才发现。
识别:大纲对账里新章标题出现在锚章标题**之后**、原章正文挂到了新章名下;连带自动编号
也会错位(新章占了原章的编号)。

## 插入内容的样式纪律

- **标题自动编号**:验收模板的 Heading 1-3 样式通常带 style 级 numPr,`add_heading(text, level)`
  直接继承编号,**文字里不要写字面编号**("3.1"这种)。但要防 pitfalls 17 的反面:老模板
  标题段常带段落级直接 numPr 覆盖,新插标题只有样式编号会渲染成无编号/编号不同步——
  插完必须渲染目检编号。
- **图片**:`run.add_picture(path, width=Cm(14.5))`,宽度按正文可用宽度定(A4 常规页边距
  约 14.5-15cm),居中段承载,图下配居中题注。
- **截图占位**:沿用目标文档既有的"【截图占位:题注】+ 下方居中题注"风格,后补图时按
  img-backfill 的**完整题注全等匹配**纪律回填。
- **新建表格必须显式 tblBorders 六边框**(`top/left/bottom/right/insideH/insideV`,
  single sz=4):`add_table` 默认无边框,别指望 Table Grid 样式(模板可能没有,见 pitfalls 7);
  表后补一个空段,防表格紧贴下一段。列宽用 `widths_cm` 逐列设(均分在中文长句下难看,
  pitfalls 8)。
- **克隆行加数据**:给既有表(如速查表)加行,用 deepcopy 末行 tr → `addnext` → 清空
  runs 填新文本(保格式),别 append 新行逐格设字(丢格式, pitfalls 6/13);
  `scripts/docxkit.py` 的 `clone_row`。

## 定点改写与删段

- **整段换字保格式**:`set_para_text(p, 新文本)`——首 run 赋值、其余 run 清空,适合
  "引言口径改写""按钮文案修正"这类定点改写。
- **按 run 替换片段**:环境表里"东方通7.0→TongWeb 8.0"这类,遍历表格单元格的 runs
  按 `r.text.replace` 改,改动面最小。
- **删一段正文范围**:用 XML 元素迭代删,不收集 Paragraph 对象再删(删除中对象失效):
  `delete_para_range(h2._p.getnext(), nxt._p)` 删两标题之间的正文。删完在原位置用
  Inserter 重写新内容("删旧四步→插图重写四步"模式)。

## 锚点定位纪律

- `find_para(doc, startswith=..., style='Heading 1')`:前缀文本+样式双条件定位,
  文本选**稳定且唯一**的连续中文短语(标题文字);python-docx 的 `p.text` 是合并后的,
  不受 Word 拆 run 影响(pitfalls 28 的拆分坑只在 JSZip 字符串层面)。
- 定位表格优先按表头文本找;确无稳定文本时才用 `doc.tables[i]`,且先断言行列数防错表。

## 收尾:Word COM 刷新域并交付

python-docx 插完的文档目录域还是旧缓存,**必须** Word COM 收尾
(参考任务脚本 update_and_render 的顺序,word2pdf.py 是只读版):

```python
doc = word.Documents.Open(abspath, ReadOnly=False, AddToRecentFiles=False)
for i in range(1, doc.TablesOfContents.Count + 1):
    doc.TablesOfContents(i).Update()
doc.Fields.Update()          # 域更新(题注编号等)可能移动页码
for i in range(1, doc.TablesOfContents.Count + 1):   # 第二轮:页码变后再刷一次目录
    doc.TablesOfContents(i).Update()
doc.Save()                   # 回存,交付件自带新目录
doc.ExportAsFixedFormat(abspath_pdf, 17)   # 17 = wdExportFormatPDF
pages = doc.ComputeStatistics(2)           # wdStatisticPages,记页数供对账
```

要点:`DispatchEx` 独立实例(不干扰用户已开的 Word)、`DisplayAlerts=0`、`Close(0)`;
**两轮 TOC Update** 是因为 Fields.Update 会改变分页,只刷一轮目录页码可能停留在旧值
(pitfalls 14 的深化)。只出 PDF 不回存时用 word2pdf.py(ReadOnly)即可。

## 校验三件套(交付前必做)

1. **大纲对账**:重新抽取输出件大纲(`analyze_docx.py --outline`),与
   "原大纲 + 本次插入清单"合成的预期序列比对——顺序、级别、缺失、编号错位。
   上一节的 addnext 坑就靠它兜住。
2. **表格边框审计**:遍历输出件**全部**表格查 tblBorders 六边(不只新建表,通用纪律第 5 条,
   细则见 docx-table-borders-and-split)。
3. **渲染目检**:pdfium 每页 `render(scale≈1.6)` 存 PNG,再用 PIL 拼 3 列 contact sheet
   缩略网格先看整体版式,可疑页再看单页大图——**visual-judge 类子代理不可用时的降级自检法**:

```python
from PIL import Image, ImageDraw
import glob
pages = sorted(glob.glob('render/<stem>/p*.png'))
cols, tw = 3, 420
th = int(tw * 297 / 210)                       # A4 纵向比例
sheet = Image.new('RGB', (cols * tw, ((len(pages)+cols-1)//cols) * th), 'white')
d = ImageDraw.Draw(sheet)
for i, f in enumerate(pages):
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(Image.open(f).resize((tw, th)), (x, y))
    d.rectangle([x, y, x + 56, y + 16], fill='black')
    d.text((x + 4, y + 2), f.rsplit('p', 1)[-1].split('.')[0], fill='white')  # 页号角标
sheet.save('contact_sheet.jpg', quality=85)
```

4. 内容对账:全文 txt 与源材料(验收报告建设内容)对关键词——新章名、口径数字、表名。

## 附:官方操作视频抽帧做手册配图

场景:新功能没有现成截图,官方只给了操作指引视频(网页内嵌 mp4)。依赖
`pip install opencv-python pillow`。

1. **拿真实视频地址**:网页内嵌 mp4 常不在页面 HTML 直接给真实地址。SSR 页面里
   `<video><source src="/video/video-1.mp4">` 这种相对路径**直接拼域名会 404**——真实地址
   往往带应用前缀(如 `/techscore/video/video-1.mp4`)。逐个候选前缀 `curl -I` 试,
   或按页面 base/href 上下文推断;拿到后 `curl -o` 下载。
2. **逐 2 秒抽帧**:cv2 按毫秒定位抽帧,文件名带秒号便于回溯:
   ```python
   import cv2
   cap = cv2.VideoCapture('guide.mp4')
   i = 0
   while True:
       cap.set(cv2.CAP_PROP_POS_MSEC, i * 2000)
       ok, frame = cap.read()
       if not ok:
           break
       cv2.imwrite(f'frames/f_{i*2:04d}s.jpg', frame)
       i += 1
   ```
3. **拼 contact sheet 快速选题**:PIL 把全部帧缩略+文件名(即秒号)标签拼成网格图,
   一眼浏览全程,挑出要进手册的画面。
4. **裁剪**:先 Read 整帧看清黑边、字幕条、播放器控件位置,**定好裁剪框再 crop**,
   不要盲裁;`im.crop((x1, y1, x2, y2)).save('shot.jpg', quality=92)`。
   帧分辨率不够打印宽度时不要放大,宁可选更清晰的邻近帧。
5. **进手册**:按 Inserter 的 `img()` + 居中题注插入,题注写清画面里的按钮/状态
   (manual-writing 纪律),后续有真截图再按 img-backfill 回填替换。
