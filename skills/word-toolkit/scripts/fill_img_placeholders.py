#!/usr/bin/env python3
"""把 build_docx.py 生成的 ::IMG:: 截图占位框回填为真实图片。

用法:
  python fill_img_placeholders.py 文档.docx --img "题注一=截图1.png" --img "题注二=截图2.png" \
      [--width 14] [--out 输出.docx] [--dry-run]

规则:
- 遍历所有顶层表格单元格,用正则"【截图占位：(.+?)】"提取**完整题注**,与 --img 的键
  **全等**匹配。严禁子串包含匹配——"系统总体结构图"会误命中"大赛系统总体结构图"。
- 回填方式:清空占位单元格全部段落 runs(保留段落)→ 居中 → run.add_picture(path,
  width=Cm(width))。占位框下方的题注段保持不动。
- 只处理顶层表格(build 生成的占位框即顶层单格表);合并单元格按 tc 去重避免重复处理。

退出码:存在未匹配的占位题注或未被使用的 --img 键时为 1(文件仍已保存,便于分批回填);
--dry-run 只打印匹配报告不保存。
"""
import argparse
import os
import re
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm

PLACEHOLDER_RE = re.compile(r"【截图占位：(.+?)】")


def iter_placeholder_cells(doc):
    """yield (cell, caption)。合并单元格(重复 tc)去重。"""
    for tbl in doc.tables:
        seen_tc = set()
        for row in tbl.rows:
            for cell in row.cells:
                if id(cell._tc) in seen_tc:
                    continue
                seen_tc.add(id(cell._tc))
                m = PLACEHOLDER_RE.search(cell.text or "")
                if m:
                    yield cell, m.group(1).strip()


def fill_cell(cell, image_path, width_cm):
    """清空占位单元格全部段落 runs,保留首段居中后插入图片。"""
    paras = cell.paragraphs
    # 多余段落直接删除,只留首段
    for p in paras[1:]:
        p._p.getparent().remove(p._p)
    p = paras[0]
    for r in list(p.runs):  # 清掉"【截图占位：…】"文字 run
        r._r.getparent().remove(r._r)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(image_path, width=Cm(width_cm))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("docx")
    ap.add_argument("--img", action="append", default=[], metavar="题注=图片路径",
                    help="可多次;题注必须与占位框内【截图占位：…】的题注全等")
    ap.add_argument("--width", type=float, default=14.0, help="图片宽 cm,默认 14(A4 版心内)")
    ap.add_argument("--out", help="输出路径,默认覆盖原文档")
    ap.add_argument("--dry-run", action="store_true", help="只报告匹配情况,不保存")
    args = ap.parse_args()

    mapping = {}
    for item in args.img:
        if "=" not in item:
            sys.exit("bad --img (需 题注=图片路径): %r" % item)
        cap, path = item.split("=", 1)
        cap, path = cap.strip(), path.strip()
        if cap in mapping:
            sys.exit("题注重复: %r" % cap)
        if not os.path.isfile(path):
            sys.exit("图片不存在: %r" % path)
        mapping[cap] = path

    doc = Document(args.docx)
    placeholders = list(iter_placeholder_cells(doc))
    used = set()
    filled = []
    for cell, caption in placeholders:
        path = mapping.get(caption)
        if path is None:
            print("未匹配(缺图): %s" % caption)
            continue
        used.add(caption)
        if not args.dry_run:
            fill_cell(cell, path, args.width)
        filled.append(caption)

    for cap in mapping:
        if cap not in used:
            print("未匹配(文档中无此占位): %s" % cap)

    print("占位框 %d 个,回填 %d 个%s" % (len(placeholders), len(filled),
          "(dry-run 未保存)" if args.dry_run else ""))
    if not args.dry_run:
        out = args.out or args.docx
        doc.save(out)
        print("saved:", out)
    # 有任何未匹配(缺图或键名对不上)都返回 1,方便脚本化迭代
    unmatched = len(placeholders) - len(filled) + sum(1 for c in mapping if c not in used)
    sys.exit(1 if unmatched else 0)


if __name__ == "__main__":
    main()
