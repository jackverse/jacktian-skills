# -*- coding: utf-8 -*-
"""Word COM 只读转换 docx -> PDF（先更新目录域，再导出 PDF）。
用法: python word2pdf.py <docx> <pdf输出路径>
注意：只读打开，不修改源文档；不干扰用户已打开的 Word 窗口（独立实例）。
"""
import io
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def main():
    import win32com.client  # pip install pywin32

    docx = os.path.abspath(sys.argv[1])
    pdf = os.path.abspath(sys.argv[2])
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = None
    try:
        doc = word.Documents.Open(docx, ReadOnly=True, AddToRecentFiles=False)
        # 更新目录与域（只影响内存副本）
        try:
            for toc in doc.TablesOfContents:
                toc.Update()
        except Exception as e:
            print("toc update warn:", e)
        try:
            doc.Fields.Update()
        except Exception as e:
            print("field update warn:", e)
        doc.ExportAsFixedFormat(pdf, 17)  # wdExportFormatPDF=17
        print("pdf ok:", pdf)
    finally:
        if doc is not None:
            doc.Close(SaveChanges=0)
        word.Quit()


if __name__ == "__main__":
    main()
