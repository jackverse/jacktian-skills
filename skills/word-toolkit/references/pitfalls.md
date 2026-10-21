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
