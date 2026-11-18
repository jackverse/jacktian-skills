---
name: word-toolkit
description: 通用 Word/docx 文档处理技能集:按模板批量生成、格式复刻、无 Python 环境用 Node.js+JSZip 直改现有 docx、从 SQL 演进链生成数据库设计说明书、验收周报系列按阶段日历校准、docx 转 PDF、目录域/页码/页眉脚处理、表格样式、修订记录填写、两版文档 diff 对齐找改动、格式异常修复(页码断链/目录疯长/字体缩进漂移等)、既有验收手册按新建设内容大纲定点插章节(不重建、保截图版式)、从官方操作视频抽帧裁剪做手册配图、操作手册写作纪律(同类操作独立成完整流程、截图占位充足且注明按钮/状态)。凡涉及 .docx/.doc 文件的任务都应使用——即使用户没说"Word"或"docx",提到"参考模板出文档""没有 Python 怎么改 Word""JSZip 编辑 docx""SQL 生成数据库设计说明书""验收周报""格式与模板一致""转 PDF""目录页码不对""对比两版文档哪里改了""写操作手册/用户手册/后台手册""手册已成型要按新大纲补章节""从操作视频里截图做配图"等也应触发。先读本页路由表定位场景,再按需读 references/ 对应专题,不要一次全读。
---

# Word 技能集(word-toolkit)

所有 Word 相关能力的沉淀入口。按场景路由、按需加载、持续补充——新能力沉淀进来,老能力不重复加载。

## 路由表(先查这里)

| 场景 | 读这个 | 相关脚本 |
|------|--------|---------|
| 按既有模板批量生成格式一致的新文档(验收/方案/报告/手册等) | [references/template-generate.md](references/template-generate.md) | analyze_docx.py、build_docx.py、word2pdf.py、pdf2png.py |
| Windows 无 Python/pandoc/LibreOffice,用 Node.js+JSZip 定点编辑现有 docx(段落/表格/行) | [references/node-editing.md](references/node-editing.md) | docx_xml_edit.js + 任务脚本 |
| Windows 无 Python,用 Node.js+JSZip 按新大纲整篇重建正文与目录,保留封面/样式/环境表/分节页脚,再用 Word COM 刷新真实页码 | [references/node-editing.md](references/node-editing.md#整篇重建正文大纲驱动保留文档骨架) | docx_xml_edit.js + 任务脚本 + Word COM |
| 从 SQL 初始化基线+日期增量+migration 生成数据库设计说明书 | [references/template-generate.md](references/template-generate.md#从-sql-演进链生成数据库设计说明书) | build_docx.py、word2pdf.py、pdf2png.py；逐单元格对账按专题实现 |
| 按正式参考 docx 重建规范版式(修订表逐 cell 设宽/正文节页码重启/表题无编号样式) | [references/template-generate.md](references/template-generate.md#按正式参考-docx-重建规范版式) | build_docx.py、build_pipeline.py |
| 验收周报系列按阶段日历批量生成与校验(日期避假日、阶段宣称有据、成套 QA 断言) | [references/weekly-report.md](references/weekly-report.md) | build_docx.py、word2pdf.py、pdf2png.py + 自写断言脚本 |
| 参考用户手工修订过的 done- 版,反向对齐同套其他文档 | [references/reverse-align.md](references/reverse-align.md) | 同上 |
| 给文档里的 ::IMG:: 截图占位框回填真实图片 | [references/img-backfill.md](references/img-backfill.md) | fill_img_placeholders.py |
| 验收手册/报告已成型,按新的"建设内容"大纲在原 docx **副本**上定点插新章/节/对照表/配图,保留原截图与版式,不重建 | [references/existing-docx-restructure.md](references/existing-docx-restructure.md) | docxkit.py + word2pdf.py、pdf2png.py |
| 没有现成截图,从官方操作指引视频(网页内嵌 mp4)抽帧/裁剪做手册配图 | [references/existing-docx-restructure.md](references/existing-docx-restructure.md#附官方操作视频抽帧做手册配图) | opencv+PIL 内联脚本(专题内) |
| 写操作手册正文(操作流程怎么写、截图占位留哪些/题注怎么起名) | [references/manual-writing.md](references/manual-writing.md) | — |
| 为设计说明书制作系统总体结构图、截图并回填 Word | [references/architecture-diagram.md](references/architecture-diagram.md) | render_html_diagram.py、fill_img_placeholders.py |
| 排查 docx 诡异问题(页码断链、目录"长出来"、字体缩进漂移、表格变丑等) | [references/pitfalls.md](references/pitfalls.md) | 按条目所指 |
| 新沉淀的 Word 能力 | 见文末「沉淀规范」 | — |

## 通用纪律(所有场景适用)

1. **先分析后动手**:处理前先读版式事实(样式、分节、域、表格结构、隐藏域),不靠肉眼猜。有 Python 时跑 `analyze_docx.py`;无 Python 时按 node-editing 专题直读 `word/document.xml`,并同时提取纯文本核对。
2. **校验不目测**:交付前先做产物 vs 源 md 对账(标题大纲+全文,见 template-generate「内容对账」),需要版式验收且工具可用时再 `word2pdf.py` → `pdf2png.py` 渲染;页码单调性用 `--footers` 脚本判定,勿肉眼读渲染图上的小字号页脚;残留检查用 zipfile/JSZip 直读 document.xml。
3. **内容不编造**:数字/人名/URL 只能来自用户提供的事实材料;没有的写"以实际部署环境为准"。
4. **面向最终读者写作,禁止元叙述**:手册/报告只写读者需要的内容本身,不把需求方的口头要求、修改意见或写作思路写进正文;避免"本手册不再按菜单罗列功能""按您要求的视角""本手册围绕用户最关心的……组织"等自我说明或对比句式,引言直接陈述文档用途与内容范围。
5. **数据表格必须六边全框**:验收交付文档中的新建表和旧文档保留表(如速查表、对照表、环境表)均须有完整 `tblBorders`(`top/left/bottom/right/insideH/insideV`,`single sz=4`);边框检查覆盖文档内全部数据表,不只查本次新建表,具体修复与校验见 docx-table-borders-and-split。
6. **操作手册写作两条硬纪律**(细则见 manual-writing.md):功能相似的同类操作(各类审核等)每类必须独立写成完整流程(进入页面→筛选→详情→通过/退回→备注→结果去向),禁止"操作方法同 XX"省略写法,通用章节只做概览不替代步骤;`::IMG::` 截图占位要充足且可指导回填——按钮操作节题注注明含哪个按钮,门户审核类业务"通过显示/不通过显示(退回原因)"成对占位,多种登录方式每种单独占位。
7. **用户手工改过的文件绝不重建**,只更新域;同套其他文件重建前先备份。

## 环境

- Windows + 已装 MS Word(渲染走 COM 最保真,还能更新目录域);`pip install python-docx pywin32 pypdfium2 pillow`
- analyze/build/pdf2png 跨平台(纯 python-docx/pdfium);word2pdf 仅 Windows+Word,无 Word 时降级 LibreOffice
- HTML 架构图截图使用 `render_html_diagram.py`：`pip install playwright`，配本机 Chrome；默认 2 倍设备像素截图并做 DOM 溢出检查
- 既有 docx 定点重构：通用函数在 `docxkit.py`(锚点定位/游标式 Inserter/六边框表/克隆行/删段),复制到任务工作目录 import;操作视频抽帧另需 `pip install opencv-python`
- 无 Python 环境的现有 docx 定点编辑：Node.js + `npm install jszip`，使用 `docx_xml_edit.js` 读写 `word/document.xml`；该路线不替代 Word 渲染与域更新

## 沉淀规范(每次补充 Word 相关技能时照此执行)

1. 判断新能力属于**已有专题**(往对应 references 文件补章节)还是**新专题**(新建 `references/<topic>.md`)
2. 上方路由表登记一行(场景 | 读哪个 | 用什么脚本);新脚本放 `scripts/`,并在本文件的「环境」补依赖说明
3. 踩坑经验一律追加到 `references/pitfalls.md`,编号延续不重排
4. `LOG.md` 追加一行台账(改 | 一句话说明)
5. 是否 git commit/push 由用户决定,不擅自提交
