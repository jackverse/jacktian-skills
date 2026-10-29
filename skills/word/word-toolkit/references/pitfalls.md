# 踩坑清单(docx 处理)

每条都真实付过学费。**新踩的坑追加到末尾,编号延续,不重排不删除**——即使某条看似过时,换个模板可能还会踩。

1. **styleId 是数字**:模板里 `"2"`=Heading 1、`"16"`=toc 1。定位样式必须先建
   id→name 映射,不能按名字找。
2. **"目录"两字本身是 toc 样式**:删旧目录条目时要把标题段排除(`t != "目录"`)。
3. **隐藏目录域**:有的模板在 fldSimple 里藏着整份旧目录,Word 一更新域就"长出来"。
   删正文时必须连域缓存一起清。analyze 报告的 fldSimple 项就是为此设的。
4. **先插后删**:新目录域要**先**插入再删旧段落——反过来插到已 detach 的元素前会静默丢失。
5. **删正文连带删分节符**:页脚 PAGE 域挂在正文的 sectPr 上,删旧正文后页码断链。
   build 内置 `ensure_footer_page_number()` 给最后一节兜底补居中 PAGE 域。
6. **修订记录表要复用空白行**:清空模板历史行后写第一行,别 append 新行(行数会膨胀)。
7. **模板可能没有 Table Grid 样式**:只有 Normal Table。build 内置样式兜底+直接加边框。
8. **表格列宽**:均分列宽在中文长句下换行极丑。build 按内容长度加权
   (`min(len,20)**0.7`、最小 1000 twips、fixed layout、gridCol+tcW、表头 tblHeader+cantSplit)。
9. **msiexec 安装 LibreOffice 可能全部挂死**(无管理员权限/无 UAC 交互):
   渲染优先走已装 MS Word COM(word2pdf.py),保真且能更新目录域。
10. **docx 被占用**:用户 Word 开着同名文档时保存报 PermissionError——提示用户关闭后重试;
    竞态覆盖时用 zipfile 直读 XML 判定交付文件的真实版本,别信渲染缓存。
11. **模板正文/标题靠直接格式而非样式定字体与缩进**:很多模板的正文段落带 run 级 rPr
    (宋体/Times New Roman)和段级 w:ind(firstLine=480 即首行缩进 2 字符),标题 run 带
    rPr(黑体+字号),这些都不在样式定义里。只挂样式注入正文会出现"段首不空两格、
    标题字体变了"。对策:build 在删旧正文前收割格式原型(harvest_prototypes:取最长且
    非加粗的 Normal 段的 run rPr 与 w:ind 做正文原型;各级 Heading 首个 run 的 rPr 做
    标题原型),注入时逐 run 套 rPr、逐段套缩进(居中段/题注不套)。构建日志的
    `proto: body_rpr/ind/head` 三项即诊断该能力是否生效。
12. **::IMG:: 占位回填严禁子串匹配**:占位文字必须用正则提取"【截图占位:(.+?)】"后的
    **完整题注做全等匹配**——"系统总体结构图"会误命中"大赛系统总体结构图",两个框被
    填进同一张图。现成脚本 fill_img_placeholders.py,详见 img-backfill.md。
13. **修订表"第一个空行"往往是表尾备用行**:按"找第一个空行写入"会把新记录写到
    最后一行(空白备用行通常排在表尾)。正确姿势:先清空全部数据行,再把新记录写到
    **第一个数据行**(build 已按此实现,手写脚手架时别再踩;第 6 条的"写第一行"即此意)。
14. **LibreOffice 不刷新 TOC 域**:降级用 LibreOffice 转出的 PDF 目录页码缺失/停留在
    旧值(它不执行域更新),只能做排版粗检。交付版必须走 Word COM:先
    `TablesOfContents.Update` + `Fields.Update` 再导出(word2pdf.py 已内置)。
15. **Heading 4+ 常挂独立 numId**:模板 Heading 1/2/3 的自动编号同挂主编号列表
    ("第%1章"/"%1.%2"/"%1.%2.%3"),Heading 4+ 的样式却常挂在另一个 numId 上,编号与
    上级不同步。python-docx 新建标题段不带 numPr 覆盖即继承样式编号——auto 模式标题
    文字不带字面编号正因此;确需 H4+ 自动编号,给段落加 numPr 覆盖(ilvl=3、numId=
    主列表)挂回主编号列表。
16. **模板包内 NULL 悬空关系**:document.xml.rels 里可能残留 `<Relationship ...
    Target="../NULL"/>`(图片关系指向不存在的 part),python-docx 打开直接抛
    KeyError: "There is no item named 'NULL' in the archive"。修法:zipfile 重写包——
    删该 Relationship 条目,并删 document.xml 里引用该 rId 的整个 `<w:drawing>` 块
    (只删 drawing 节点,别删整段,段落里其余内容要保留)。识别:python-docx 打不开而
    Word 能打开的模板,解包 grep rels 里 Target 指向包外/NULL 的关系即中招;"包内
    rels 悬空关系体检+清理"思路可推广,现成后处理脚本 build_pipeline.py 所在管线已含。
17. **标题编号靠段落级直接 numPr**:有的模板 Heading 样式上的 numPr(numId=1,
    lvlText"第%1章")是历史遗留,正文每级标题段都带段落级直接 numPr 覆盖(ilvl=级-1,
    numId=3,lvlText "1."/"%1.%2."/"%1.%2.%3.")。build 注入的新标题只有样式 numPr →
    渲染成"H1=第1章、H2/H3 无编号"。修法:build 后遍历 Heading 1-6 段,pPr 里补
    `<w:numPr><w:ilvl w:val="级-1"/><w:numId w:val="3"/></w:numPr>`;文字匹配 ^附件
    的标题 numId=0(OOXML 约定 0=不编号)。识别:`analyze --outline` 看不出编号问题,
    必须 zipfile+regex/lxml 对照样式表 numPr 与正文段落 numPr 是否一致。注意:lxml
    元素空节点为 falsy,`find(x) or makeelement(x)` 这种写法会错建重复子元素,必须
    显式 `is None` 判断。
18. **"目录"标题前藏着空的 toc 样式段**:analyze 的封面段落 dump 只列非空段,这类
    模板"目录"标题(toc 2 样式)之前还有一个**空的 toc 样式段**。build 的 locate()
    取 min(entry_tocs) 定位 TOC 域插入点,会把新 TOC 域插到"目录"标题**之前**(打开
    文档目录条目长在"目录"二字上面)。修法:构建后校验顺序——找到含 TOC instrText
    的域段落与"目录"标题段,若域在前则 `目录标题段.addnext(域段落)`。识别:
    python-docx 全量 dump 段落(**含空段**)看"目录"前一个段落的样式。
19. **分节符挂在旧目录区段落上**:模板 3 节时,封面节尾 sectPr 挂在"目录"标题前那个
    空 toc 段(见第 18 条)的 pPr 里,目录节尾 sectPr 挂在正文首个(空文本)Heading 1
    段上。build 删旧目录条目段与旧正文时把两个 sectPr 一并删除 → 全文档坍缩成 1 节
    (封面/目录出现页码、目录与封面同页;第 5 条页码断链的近亲,这次塌的是整个分节
    结构)。修法:构建后校验 `len(doc.sections)`,若塌了就从模板 deepcopy 收割各段落级
    sectPr,封面节尾挂回"目录"标题前一空段、目录节尾放进正文首个 Heading 前新建空段
    的 pPr。识别:构建前后各数一次 sections 数,变少即塌节。
20. **固定高度 HTML 架构图裁切 chips/末行文字**:截图成功不代表内容完整,固定层高常把标签或
    最后一行裁掉。截图前必须对 `#diagram`、每个 `.layer`、每个 `.card` 分别断言
    `scrollHeight <= clientHeight` 且 `scrollWidth <= clientWidth`;溢出就增加层高/调整布局并复检,
    不能用 `overflow:hidden` 掩盖。之后仍要 Read PNG 做视觉验收,详见 architecture-diagram.md。
21. **Word 占用 docx 时不得强制关闭用户程序**:保存 `PermissionError` 先保留原件并备份,把结果
    另存为带时间戳的“附图版”临时 docx,明确交付实际路径;不要杀 WINWORD.EXE 或把覆盖原文件
    当作唯一成功路径。fill_img_placeholders.py 已带此 fallback。
22. **SQL 基线+增量直接拼接不等于最终数据库结构**:后续 `ALTER TABLE ADD/DROP COLUMN` 要合并到
    当前快照,后续 `DROP TABLE` 的旧表及其约束/索引要排除;按真实执行顺序处理,不按文件 mtime。
    主键不能只看列内联定义,还要解析表级 `PRIMARY KEY` 与 `CONSTRAINT ... PRIMARY KEY`,复合键保留
    全部列及顺序。DDL 中含括号/引号/表达式时不能按所有逗号硬切,详见 template-generate.md。
23. **数据库说明书只对表数/行数会漏掉错格与残留**:须从最终模型生成预期矩阵并回读 docx 逐单元格
    双向对账,以稳定表锚点和字段/约束语义键定位;同时查缺失、额外、重复、错位,空白单元格也比值。
24. **表格 XML 正确仍可能出现分页孤行**:续页表头只对真正表头行设 `w:tblHeader`,数据行设
    `cantSplit`;表标题/用途说明、索引标题/引导行用 `keep_with_next` 避免孤悬页底。最终必须 Word
    渲染逐页检查表头重复、表用途与表头同页、索引无孤行;不要给整张大表强制同页造成大片空白。
25. **占用探测走 `~$` 锁文件,占用时整批改输出到新目录**:目标文件同目录存在 `~$` 开头的锁文件
    即用户 Word 正开着该文档,写入必 PermissionError——不要杀进程(纪律见第 21 条),把整批输出
    改到**新目录**并在交付结论里说明实际输出路径,而不是反复重试覆盖原文件。同时**每次构建前
    先把旧输出目录整体备份**(改名加时间戳或整体拷贝),重建失败或要 diff 回滚都有退路。
26. **同事用旧底稿覆盖了新版本——patch 前必须先对账“预期口径”**:AI 在 T1 日按用户确认的口径
    重建了文档;用户同事在更早的旧版(Word 仍开着旧版)上插图并保存,保存动作把 T1 重建版覆盖回
    旧文字。之后用户再提新需求时,AI 若只按“上次改过”的记忆做增量 patch,会在错误底稿上叠加
    错误。正确做法:每次接手“别人动过的文档”,先把当前文件全文关键词扫描一遍,核对上一轮全部
    已确认口径(日期、枚举、表结构)是否仍在;发现丢失,先向用户说明“哪版被谁覆盖、丢了什么”,
    再在保图前提下用定点手术补回(参考 build_pipeline.py 的“手工改过的文件绝不重建”原则——
    有图片/手工编辑的文件只能 python-docx/lxml 定点改)。
27. **docx 表格整表重排(行序重排+重新编号)**:按新的分组清单(如采购附件九大子系统)重排测试
    范围表,行数不变但分组顺序要变。做法:①先逐行读出原行数据(按表头文本定位表,禁止用表
    索引);②构造“原行号→新分组”映射和目标顺序列表,assert 顺序列表是与原行数相同的排列;
    ③`trs = [row._tr for row in table.rows[1:]]`,逐个 `tbl.remove(el)` 后按新顺序
    `tbl.append(tr)`(表头 tr 不动);④每行 set_cell 重写序号/分组列,set_cell 实现:保留首段、
    删多余段落、runs[0].text 赋值+其余 run 清空(保格式);⑤异常安全:脚本崩溃在 save 之前则
    磁盘文件无损伤,可放心重跑。注意:deepcopy 别的表做新表壳时,记得先删光其 w:tr 再逐行造/填;
    插表用 `锚点段._p.addnext(表元素)`,插入引言段用 deepcopy 邻近普通段保样式。
28. **JSZip 直改 document.xml 先做 run 拆分探测**:Word/WPS 常把数字、英文、引号、间隔号拆成独立
    `w:r/w:t`,纯文本存在不代表 XML 字符串连续。长句锚点选稳定连续中文短句;数字用完整
    `<w:t>旧值</w:t>` 在目标段/表范围内替换,禁止全文裸替换。详见 node-editing.md。
29. **同表顺序替换要共用稳定锚点**:第一处编辑若改掉后续共用的锚点,后续会 NOT FOUND;每次编辑后
    字符串偏移也会变化。全表操作统一用不被修改的表头/首行文字,并重新计算范围,不复用旧下标。
30. **字符串范围重写表格行时 firstCell 从首个 `<w:tc>` 起切**:若从 tr 开头切,会把旧 `<w:tr>` 行头
    包进新行形成嵌套,XML 不合法。lastIndexOf/indexOf 范围法只用于普通非嵌套目标;嵌套表格换
    命名空间感知解析器或深度扫描。
31. **String.replace 只换第一个匹配**:统计表同值多处替换必须先计数,按预期次数断言后在限定范围内
    split/join;通用操作默认 NOT FOUND/NOT UNIQUE 快速失败,不能为“换干净”退化成全局替换。
32. **Node.js 直改 docx 的收尾不能省**:写回前做栈式 XML 标签配对校验(忽略声明/注释/CDATA/自闭合),
    默认备份到 history;写回后重新 JSZip 打开落盘产物、提取全文核对关键数字与口径,并对照操作日志。
    样式原型(tblPr/tcW/pPr/rPr 等)从当前文档克隆,不跨模板硬编码。
