---
name: docx-table-borders-and-split
description: docx 表格全框线批量修复与按章节拆分成多份手册:验收交付 Word 里数据表格补全六边框线(排除截图容器表)、一份大手册按 Heading 1 删章拆成面向不同读者的多份(改封面/引言/UNO 刷目录/PDF 目检)、Windows 下 python 被劫持/soffice.com/Word 锁文件等环境坑、按读者角色裁剪内容的原则。触发场景:表格没竖线/没外框、表格框线不统一、批量补表格边框、手册拆分成多份、按读者出分册、删章节另存、拆分后目录不对、docx 保存 PermissionError、~$ 锁文件、python Permission denied(WindowsApps) 等。python-docx 可用时优先本 skill;Node.js 直改 XML 路线见 word-toolkit。
---

# docx 表格框线批量修复与按章节拆分(docx-table-borders-and-split)

两个高频验收场景的实战套路,已在真实验收项目中验证。依赖:Python + python-docx + lxml + PyMuPDF(fitz),LibreOffice(刷目录/转 PDF)。

## A. 批量修复表格全框线(python-docx)

场景:验收交付文档(自测报告/试运行方案/操作手册)要求数据表格全框线,但模板样式或手工编辑导致部分表只有横线、无竖线/外框。

要点:
- python-docx **没有 borders API**,直接用 lxml 操作 `table._tbl.tblPr`。
- 逐表检查 `tblPr` 里的 `w:tblBorders`:元素不存在、或任一边 `w:val` 为 `none`/`nil`,就整体重建。
- 完整六边:`top/left/bottom/right/insideH/insideV`,全部 `w:val="single" w:sz="4" w:space="0" w:color="000000"`。`sz` 单位是 1/8 pt,**sz=4 即 0.5pt 细实线**,验收文档常用。
- **排除图片容器表**:1×1 且内含 `w:drawing` 的表通常是截图的边框容器,保持无边框,否则截图会被套一圈黑框。
- **单元格级 `w:tcBorders` 覆盖表级 `w:tblBorders`**:只修表级会被个别单元格的旧框线"顶掉",修复时把 `tcBorders` 一并清掉或统一。

可直接复用的函数:

```python
from docx import Document
from docx.oxml.ns import qn
from lxml import etree

EDGES = ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')

def is_image_container(table):
    """1x1 且内含 w:drawing 的表 = 截图容器,跳过不加框"""
    tbl = table._tbl
    if len(tbl.findall(qn('w:tr'))) != 1:
        return False
    return bool(tbl.findall('.//' + qn('w:drawing')))

def borders_broken(tblPr):
    """tblBorders 缺失,或任一边 val 为 none/nil,视为需修复"""
    borders = tblPr.find(qn('w:tblBorders'))
    if borders is None:
        return True
    for e in borders:
        if e.get(qn('w:val')) in ('none', 'nil'):
            return True
    return False

def rebuild_full_borders(tblPr, sz='4', color='000000'):
    """整体重建六边全框线(先删旧再建,避免新旧混杂)"""
    old = tblPr.find(qn('w:tblBorders'))
    if old is not None:
        tblPr.remove(old)
    borders = etree.SubElement(tblPr, qn('w:tblBorders'))
    for edge in EDGES:
        e = etree.SubElement(borders, qn('w:' + edge))
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), sz)      # 1/8 pt,sz=4 → 0.5pt
        e.set(qn('w:space'), '0')
        e.set(qn('w:color'), color)

def clear_cell_borders(table):
    """tcBorders 覆盖 tblBorders,清掉单元格级框线让表级生效"""
    for tcBorders in table._tbl.findall('.//' + qn('w:tcBorders')):
        tcBorders.getparent().remove(tcBorders)

def fix_docx_table_borders(path):
    doc = Document(path)
    fixed = 0
    for table in doc.tables:
        if is_image_container(table):
            continue                      # 截图容器保持无边框
        if borders_broken(table._tbl.tblPr):
            rebuild_full_borders(table._tbl.tblPr)
            clear_cell_borders(table)
            fixed += 1
        else:
            clear_cell_borders(table)     # 表级正常也可能被 tcBorders 局部破坏
    doc.save(path)
    return fixed
```

## B. 按章节拆分成多份文档(复制+删章+改封面)

场景:一份大手册要拆成多份面向不同读者的手册(如企业用户版/机构用户版/后台管理版)。核心思路:**每版从完整原件复制而来、只做删减**,而不是从零拼装——格式、页眉脚、目录域全部天然保留。

1. **复制多份**:`shutil.copy` 原件为多份副本逐份处理,原件永远不动。
2. **删章**:按 Heading 1 定位章节边界——从该 H1 元素到**下一个 H1 元素之前**的所有 body 元素整块 `el.getparent().remove(el)` 删除。**必须用 body 元素级遍历**(`doc.element.body` 的直接子元素),`doc.paragraphs` 看不到表格,段落表格混排时会删不干净或删错位:

```python
from docx import Document
from docx.oxml.ns import qn

def find_h1_starts(doc):
    """返回 body 直接子元素列表中每个 Heading 1 段落的下标"""
    body = doc.element.body
    starts = []
    for i, el in enumerate(body):
        if el.tag == qn('w:p'):
            pPr = el.find(qn('w:pPr'))
            if pPr is not None:
                style = pPr.find(qn('w:pStyle'))
                if style is not None and style.get(qn('w:val')) == '1':
                    starts.append(i)      # Heading 1 的 styleId 常为 '1',先 analyze 确认
    return starts

def delete_chapters(src, dst, keep_titles):
    """保留 keep_titles 中的 H1 章(含其下所有内容),其余整章删除"""
    import shutil
    shutil.copy(src, dst)
    doc = Document(dst)
    body = doc.element.body
    children = list(body)
    h1_idx = find_h1_starts(doc)
    # 先算出每个 H1 章的 [start, end) 元素范围,再统一删
    ranges, n = [], len(h1_idx)
    for k in range(n):
        title = ''.join(children[h1_idx[k]].itertext())
        end = h1_idx[k + 1] if k + 1 < n else len(children)
        ranges.append((title, h1_idx[k], end))
    for title, s, e in ranges:
        if title.strip() not in keep_titles:
            for el in children[s:e]:
                body.remove(el)
    doc.save(dst)
```

   注意:章节范围含** sectPr/分节符**时要小心——若被删章里藏着分节符,删掉会改变保留下文的页面设置;删完后核对其余章节页眉页脚正常。
3. **改封面标题/文档名**:找到封面页文字段落,只改 `w:t` 文本、不动 run 格式。做法:**保留首个 run、改其 w:t,清空该段其余 run**——直接改 `paragraph.text` 会丢掉整段字体格式:

```python
def replace_text_keep_format(paragraph, new_text):
    runs = paragraph.runs
    runs[0].text = new_text          # 首 run 带着原格式承接新文本
    for r in runs[1:]:
        r.text = ''                  # 其余清空不删,格式结构不动
```

4. **改引言里的读者描述**:按唯一子串全文定位目标段落(先断言子串在全文档只出现一次,防止误伤),同样用 `replace_text_keep_format`。
5. **刷新 TOC 域(必做)**:拆完目录还是原文档的章节,必须用 LibreOffice UNO 刷新:`document.refresh()` 后对 indexes 逐一 `updateAll`,再 `store()` 保存。Word COM(Windows+装 Word)也可,LibreOffice 路线通用。
6. **PDF 目检**:`soffice.com --headless --convert-to pdf` 渲染,用 PyMuPDF(fitz) 抽目录页与各章首页文本,断言:该版应保留的章在、应删的章不在、封面标题已改、目录条目与实际章节一致。

## C. Windows 环境注意点

- **python 劫持**:Windows 上直呼 `python`/`py` 可能命中 WindowsApps 的假入口报 `Permission denied`(或弹出商店),用完整路径,Git Bash 形如 `/c/Users/<user>/AppData/Local/Python/bin/python.exe`(先 `where python`/试几个常见位置确认真身)。
- **LibreOffice CLI 用 `soffice.com` 而非 `soffice.exe`**:前者才有可靠的 stdout/退出码,后者是 GUI 入口输出不可靠。
- **UNO 刷目录**:要起**独立 headless 实例**并指定**独立 UserInstallation profile**(`-env:UserInstallation=file:///C:/temp/lo_profile_xxx`),否则会撞上已开着的 LibreOffice 连不上;Writer 文档**没有 `calculateAll()`**(那是 Calc 的),刷新域用 `refresh()` + indexes `updateAll`。
- **Word 锁文件**:目标文件正被 Word 打开时存在同名 `~$xxx.docx` 锁文件,python-docx `save()` 会 PermissionError。**不要杀用户的 Word**——先探测锁文件,存在就轮询等待或请用户关闭后再写;可改写到新文件名再让用户替换。

## D. 拆分手册的读者视角裁剪原则

- **按读者角色裁内容,不机械对半**:企业用户版放门户+企业端功能;机构用户版只放认证、信息发布、邀约审批等机构相关操作;后台版只放管理后台章节。判断标准是"这个读者要用哪些功能",不是"内容均分三份"。
- **保留骨架、削描述**:某模块对某读者只需简要操作时,保留小节标题+精简操作步骤,删掉设计性/背景性描述段落。
- **无关模块整章删干净**:完全无关的独立系统整章删除,且引言/概述里也不提及,避免读者困惑"这章为什么说有却没有"。
- **每版引言都要改**:封面标题、文档名、引言中的读者定位描述三处与正文同等重要——目录对了但封面还是总册名,交付时照样被打回。
