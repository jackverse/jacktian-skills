#!/usr/bin/env python3
"""docx_cell_templater.py — docx 表格坐标查看与 poi-tl 占位符挖坑工具。

不要按文本匹配挖占位符：Word 会把长文本切成多个 w:r/w:t run，文本匹配必失手。
本工具按「表格索引 + 行索引 + 列索引」定位单元格，整格替换为指定文本（如 {{占位符}}），
保留原单元格段落格式(pPr)与字体(rPr，deepcopy 复用既有 run 的)，完全不碰 tcPr——
因此 vMerge(跨行合并)/gridSpan(跨列合并) 版式天然保留。

子命令:
  dump   列出 docx 各表格的坐标、单元格现文本与合并信息（选坐标、验证产物都用它）
  apply  按映射 JSON 把指定 (表,行,列) 单元格替换为占位符文本，产出 poi-tl 模板

用法:
  python docx_cell_templater.py dump  --src sample.docx [--width 40] [--part word/document.xml]
  python docx_cell_templater.py apply --src sample.docx --map mapping.json --out template.docx
  # 验证产物：对渲染结果 docx 再跑一遍 dump，确认占位符已替换、合并结构未破坏；
  # 或 grep -c '{{' 确认无残留。

mapping.json（列表形式默认作用于 word/document.xml；也可按 part 分组，用于页眉页脚）:
[
  {"table": 0, "row": 2, "col": 1, "text": "{{item_code_count}}"},
  {"table": 0, "row": 3, "col": 1, "text": "{{item_name}}"}
]
或:
{"word/document.xml": [ ... ], "word/header1.xml": [ ... ]}

仅索引表格容器（w:body 或页眉/页脚根）下的直接子表格；嵌套表不参与索引（报告类模板够用）。
目标单元格若含嵌套表格会拒绝改写（--force 强制，嵌套表内容将被删除）。
"""

import argparse
import copy
import io
import json
import sys
import zipfile
import xml.etree.ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def qn(tag: str) -> str:
    prefix, local = tag.split(":")
    if prefix != "w":
        raise ValueError(f"仅支持 w: 前缀，收到 {tag}")
    return f"{{{W_NS}}}{local}"


def parse_preserving_ns(data: bytes) -> ET.Element:
    """先从原文收集全部命名空间前缀并 register，再解析——防止序列化时出现 ns0:/ns1: 前缀污染。"""
    seen = []
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(data), events=("start-ns",)):
        seen.append((prefix, uri))
    for prefix, uri in seen:
        ET.register_namespace(prefix, uri)
    return ET.fromstring(data)


def table_container(root: ET.Element) -> ET.Element:
    body = root.find(qn("w:body"))
    return body if body is not None else root


def cell_text(tc: ET.Element) -> str:
    paras = []
    for p in tc.findall(qn("w:p")):
        paras.append("".join(t.text or "" for t in p.iter(qn("w:t"))))
    return "\n".join(paras)


def merge_info(tc: ET.Element) -> str:
    tcpr = tc.find(qn("w:tcPr"))
    if tcpr is None:
        return ""
    tags = []
    vm = tcpr.find(qn("w:vMerge"))
    if vm is not None:
        val = vm.get(qn("w:val")) or "continue"
        tags.append(f"vM:{val}")
    gs = tcpr.find(qn("w:gridSpan"))
    if gs is not None:
        tags.append(f"grid:{gs.get(qn('w:val'))}")
    return f" [{'|'.join(tags)}]" if tags else ""


def has_nested_table(tc: ET.Element) -> bool:
    return tc.find(qn("w:tbl")) is not None


def pick_rpr(tc: ET.Element):
    """从格内既有 run 抄字体：优先取带文本的 run 的 rPr，否则任意 run 的。返回 deepcopy 或 None。"""
    candidates = []
    for r in tc.iter(qn("w:r")):
        rpr = r.find(qn("w:rPr"))
        if rpr is not None:
            has_text = r.find(qn("w:t")) is not None
            candidates.append((has_text, rpr))
    if not candidates:
        return None
    for has_text, rpr in candidates:
        if has_text:
            return copy.deepcopy(rpr)
    return copy.deepcopy(candidates[0][1])


def make_paragraph(text: str, ppr_tpl, rpr_tpl) -> ET.Element:
    p = ET.Element(qn("w:p"))
    if ppr_tpl is not None:
        p.append(copy.deepcopy(ppr_tpl))
    r = ET.SubElement(p, qn("w:r"))
    if rpr_tpl is not None:
        r.append(copy.deepcopy(rpr_tpl))
    t = ET.SubElement(r, qn("w:t"))
    t.set(XML_SPACE, "preserve")  # 空文本/首尾空格不被 Word 丢弃
    t.text = text
    return p


def set_cell_text(tc: ET.Element, text: str) -> None:
    """整格替换文本：保留首段 pPr 与格内 run 的 rPr；按 \\n 拆多段（均套用同一格式）。"""
    paras = tc.findall(qn("w:p"))
    ppr_tpl = None
    if paras:
        first_ppr = paras[0].find(qn("w:pPr"))
        if first_ppr is not None:
            ppr_tpl = copy.deepcopy(first_ppr)
    rpr_tpl = pick_rpr(tc)

    for p in paras:
        tc.remove(p)
    # 其余非段落内容（如嵌套表，已由调用方拦截）不动；新段落追加在 tcPr 之后（末尾即正确位置）
    for line in text.split("\n"):
        tc.append(make_paragraph(line, ppr_tpl, rpr_tpl))


def locate(tables, table_idx, row_idx, col_idx) -> ET.Element:
    try:
        tbl = tables[table_idx]
    except IndexError:
        sys.exit(f"错误: 表索引 {table_idx} 越界（共 {len(tables)} 张表）")
    rows = tbl.findall(qn("w:tr"))
    try:
        cells = rows[row_idx].findall(qn("w:tc"))
    except IndexError:
        sys.exit(f"错误: 行索引 {row_idx} 越界（表 {table_idx} 共 {len(rows)} 行）")
    try:
        return cells[col_idx]
    except IndexError:
        sys.exit(f"错误: 列索引 {col_idx} 越界（表 {table_idx} 行 {row_idx} 共 {len(cells)} 格）")


def cmd_dump(args) -> None:
    with zipfile.ZipFile(args.src) as z:
        data = z.read(args.part)
    root = parse_preserving_ns(data)
    tables = table_container(root).findall(qn("w:tbl"))
    print(f"{args.src} :: {args.part} :: {len(tables)} 张表")
    for ti, tbl in enumerate(tables):
        rows = tbl.findall(qn("w:tr"))
        print(f"== table {ti} ({len(rows)} rows) ==")
        for ri, tr in enumerate(rows):
            for ci, tc in enumerate(tr.findall(qn("w:tc"))):
                text = cell_text(tc).replace("\n", "⏎")
                if len(text) > args.width:
                    text = text[: args.width] + "…"
                flag = " [嵌套表]" if has_nested_table(tc) else ""
                print(f"  r{ri} c{ci}{merge_info(tc)}{flag} \"{text}\"")


def cmd_apply(args) -> None:
    with open(args.map, encoding="utf-8") as f:
        mapping = json.load(f)
    if isinstance(mapping, list):
        mapping = {"word/document.xml": mapping}

    replacements = {}
    with zipfile.ZipFile(args.src) as z:
        names = set(z.namelist())
        for part, items in mapping.items():
            if part not in names:
                sys.exit(f"错误: {part} 不在 {args.src} 内")
            root = parse_preserving_ns(z.read(part))
            tables = table_container(root).findall(qn("w:tbl"))
            for item in items:
                tc = locate(tables, item["table"], item["row"], item["col"])
                if has_nested_table(tc) and not args.force:
                    sys.exit(
                        f"错误: table {item['table']} r{item['row']} c{item['col']} 含嵌套表，"
                        f"改写会删除其内容；确认无误请加 --force"
                    )
                set_cell_text(tc, item["text"])
                print(f"  [{part}] table {item['table']} r{item['row']} c{item['col']} -> {item['text']!r}")
            # 不用 tostring/write 的 standalone 参数（随 Python 版本增减，不稳）：
            # unicode 序列化后手工拼 Word 标准声明，行为跨版本一致
            xml_str = ET.tostring(root, encoding="unicode")
            replacements[part] = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
                + xml_str
            ).encode("utf-8")

    with zipfile.ZipFile(args.src) as zin, zipfile.ZipFile(
        args.out, "w", zipfile.ZIP_DEFLATED
    ) as zout:
        for info in zin.infolist():
            zout.writestr(info, replacements.get(info.filename, zin.read(info.filename)))
    print(f"已写出 {args.out}（共替换 {sum(len(v) for v in mapping.values())} 格）")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("dump", help="列出表格坐标/现文本/合并信息")
    d.add_argument("--src", required=True, help="源 docx 路径")
    d.add_argument("--part", default="word/document.xml", help="zip 内部件路径（默认正文）")
    d.add_argument("--width", type=int, default=40, help="单元格文本截断宽度")

    a = sub.add_parser("apply", help="按映射挖占位符，产出模板")
    a.add_argument("--src", required=True, help="源 docx 样例")
    a.add_argument("--map", required=True, help="单元格映射 JSON")
    a.add_argument("--out", required=True, help="输出模板 docx")
    a.add_argument("--force", action="store_true", help="允许改写含嵌套表的单元格")

    args = ap.parse_args()
    {"dump": cmd_dump, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    main()
