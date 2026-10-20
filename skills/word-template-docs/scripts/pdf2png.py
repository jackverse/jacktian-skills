# -*- coding: utf-8 -*-
"""把 PDF 渲染为 PNG 页面图，并可选提取每页页脚区域的文字（校验页码）。

典型工作流（docx 交付前校验）:
  1. word2pdf.py 把 docx 转 PDF（会更新目录域）
  2. pdf2png.py 渲染页面图供视觉检查
  3. --footers 提取每页页脚文字，脚本自动判断页码是否单调递增
     （教训：渲染图上肉眼读小字号页脚数字极易误读，必须用文本提取校验）

用法:
  python pdf2png.py <pdf> <outdir> [--scale 1.6] [--max-pages 0] [--footers] [--footer-h 0.08]
依赖: pip install pypdfium2 pillow
"""
import argparse
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("outdir")
    ap.add_argument("--scale", type=float, default=1.6, help="渲染倍率，1.6≈115dpi")
    ap.add_argument("--max-pages", type=int, default=0, help="只渲染前 N 页，0=全部")
    ap.add_argument("--footers", action="store_true", help="提取每页底部文字并校验页码单调")
    ap.add_argument("--footer-h", type=float, default=0.08, help="页脚区占页高比例")
    args = ap.parse_args()

    import pypdfium2 as pdfium

    os.makedirs(args.outdir, exist_ok=True)
    doc = pdfium.PdfDocument(os.path.abspath(args.pdf))
    n = len(doc)
    limit = n if args.max_pages <= 0 else min(n, args.max_pages)

    footer_texts = []
    for i in range(limit):
        page = doc[i]
        w, h = page.get_size()
        bitmap = page.render(scale=args.scale)
        pil = bitmap.to_pil()
        pil.save(os.path.join(args.outdir, "page-%03d.png" % (i + 1)))
        if args.footers:
            # 裁底部 footer_h 比例区域做文字提取（PDF 坐标系原点在左下）
            tp = page.get_textpage()
            txt = tp.get_text_bounded(left=0, bottom=0, right=w, top=h * args.footer_h)
            footer_texts.append(" ".join(txt.split()))

    print(f"pages: {n} (rendered {limit}) -> {args.outdir}")

    if args.footers:
        print("\n-- 页脚文字（每页） --")
        nums = []
        for i, t in enumerate(footer_texts):
            print(f"  p{i+1:>3}: {t!r}")
            # 取页脚文字里“最大的数字”当作页码候选（目录页常含罗马数字/无数字）
            digits = re.findall(r"\d+", t)
            if digits:
                nums.append((i + 1, max(int(d) for d in digits)))
        if nums:
            mono = all(b > a for (_, a), (_, b) in zip(nums, nums[1:]))
            print(f"\n页码候选共 {len(nums)} 页，单调递增: {'YES ✓' if mono else 'NO ✗ ← 检查下面这些断点：'}")
            if not mono:
                for (pa, va), (pb, vb) in zip(nums, nums[1:]):
                    if vb <= va:
                        print(f"  p{pa}={va} -> p{pb}={vb}")


if __name__ == "__main__":
    main()
