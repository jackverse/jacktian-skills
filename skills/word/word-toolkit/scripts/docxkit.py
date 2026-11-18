# -*- coding: utf-8 -*-
"""既有 docx 定点重构的通用工具集:锚点定位、游标式插入(标题/段落/图片/占位/表格)、
克隆表格行、按范围删段。配套专题见 references/existing-docx-restructure.md。

通用函数,不含任何文档业务内容;调用方(任务脚本)提供锚点文本与内容。
用法:把本文件复制到任务工作目录,from docxkit import ...
"""
import copy

from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt


def find_para(doc, startswith=None, contains=None, style=None, last=False):
    """按前缀/包含文本(可加样式名过滤)查找段落,返回最后一个匹配(last=True)或第一个。

    文本选稳定且唯一的连续中文短语;p.text 是合并后的文本,不受 Word 拆 run 影响。
    找不到抛 LookupError,不静默。
    """
    hits = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if not t:
            continue
        if startswith is not None and not t.startswith(startswith):
            continue
        if contains is not None and contains not in t:
            continue
        if style is not None and (p.style is None or p.style.name != style):
            continue
        hits.append(p)
    if not hits:
        raise LookupError(f"para not found: startswith={startswith!r} contains={contains!r}")
    return hits[-1] if last else hits[0]


def set_para_text(p, text):
    """整段替换文本,保留第一个 run 的格式(其余 run 清空)。"""
    runs = p.runs
    if runs:
        runs[0].text = text
        for r in runs[1:]:
            r.text = ""
    else:
        p.add_run(text)


def get_style(doc, name):
    """按名称取样式,大小写不敏感兜底(w:name 可能是小写 'heading 1',BabelFish 翻译不齐)。"""
    try:
        return doc.styles[name]
    except KeyError:
        for s in doc.styles:
            if s.name and s.name.lower() == name.lower():
                return s
    raise KeyError(name)


class Inserter:
    """在锚点段落处游标式插入内容;doc.add_* 创建在文末,随后把 XML 元素搬到游标处。

    after 模式(默认):addnext 插到锚点之后,游标前移,连续调用按调用顺序往下排。
    before 模式:插到锚点之前,游标**不前移**(锚点始终是同一段)——"插到某章标题之前"
    必须用它;误用 after 模式会把整章内容插进原章标题与正文之间,且不报错。
    """

    def __init__(self, doc, anchor_para, before=False):
        self.doc = doc
        self.el = anchor_para._p
        self.before = before

    def _move(self, el):
        if self.before:
            self.el.addprevious(el)
            return
        self.el.addnext(el)
        self.el = el

    def heading(self, text, level=1):
        p = self.doc.add_heading(text, level=level)  # 编号继承样式级 numPr,文字勿带字面编号
        self._move(p._p)
        return p

    def para(self, text, align=None, bold=False):
        p = self.doc.add_paragraph()
        r = p.add_run(text)
        r.bold = bold
        if align is not None:
            p.alignment = align
        self._move(p._p)
        return p

    def tip(self, text):
        return self.para("提示：" + text)

    def img(self, path, width_cm=14.5):
        p = self.doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(path, width=Cm(width_cm))
        self._move(p._p)
        return p

    def placeholder(self, hint, caption=None):
        """灰字风格截图占位 + 下方居中题注(与验收手册既有风格一致,后按题注全等匹配回填)。"""
        p = self.doc.add_paragraph()
        p.add_run(f"【截图占位：{hint}】")
        self._move(p._p)
        if caption:
            self.caption(caption)

    def caption(self, text):
        p = self.doc.add_paragraph(text)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        self._move(p._p)
        return p

    def table(self, rows, widths_cm=None, header=True, font_pt=10.5):
        """新建六边框表并搬到游标处,表后补空段;rows: list[list[str]],首行为表头。"""
        ncols = len(rows[0])
        tbl = self.doc.add_table(rows=len(rows), cols=ncols)
        set_table_borders(tbl)
        tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
        tbl.autofit = False
        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                cell = tbl.cell(i, j)
                cell.text = ""
                p = cell.paragraphs[0]
                r = p.add_run(str(val))
                r.font.size = Pt(font_pt)
                if header and i == 0:
                    r.bold = True
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                if widths_cm:
                    cell.width = Cm(widths_cm[j])
        if widths_cm:
            for j, w in enumerate(widths_cm):
                for cell in tbl.columns[j].cells:
                    cell.width = Cm(w)
        self._move(tbl._tbl)
        sp = self.doc.add_paragraph()  # 表后空段,防表格紧贴下一段
        self._move(sp._p)
        return tbl


def set_table_borders(tbl, sz=4):
    """显式补 tblBorders 六边框(add_table 默认无边框,别指望 Table Grid 样式存在)。"""
    tblPr = tbl._tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement(f'w:{edge}')
        e.set(qn('w:val'), 'single')
        e.set(qn('w:sz'), str(sz))
        e.set(qn('w:space'), '0')
        e.set(qn('w:color'), 'auto')
        borders.append(e)
    tblPr.append(borders)


def clone_row(tbl, texts):
    """deepcopy 表末行(保格式)追加到表尾并填充文本,给既有表(速查表等)加行用。"""
    last_tr = tbl.rows[-1]._tr
    new_tr = copy.deepcopy(last_tr)
    last_tr.addnext(new_tr)
    from docx.table import _Row
    row = _Row(new_tr, tbl)
    for j, cell in enumerate(row.cells):
        text = texts[j] if j < len(texts) else ""
        for p in list(cell.paragraphs[1:]):  # 只留首段
            p._p.getparent().remove(p._p)
        p0 = cell.paragraphs[0]
        for r in list(p0.runs):
            r._r.getparent().remove(r._r)
        p0.add_run(text)
    return row


def delete_para_range(start_el, end_el):
    """删除 [start, end) 之间的 XML 元素(含 start 不含 end),参数为 lxml 元素。

    用元素迭代删,不要收集 Paragraph 对象再删(删除过程中对象失效)。
    """
    el = start_el
    while el is not None and el is not end_el:
        nxt = el.getnext()
        el.getparent().remove(el)
        el = nxt
