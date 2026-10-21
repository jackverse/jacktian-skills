---
name: word-toolkit
description: 通用 Word/docx 文档处理技能集:按模板批量生成、格式复刻、docx 转 PDF、目录域/页码/页眉脚处理、表格样式、修订记录填写、两版文档 diff 对齐找改动、格式异常修复(页码断链/目录疯长/字体缩进漂移等)。凡涉及 .docx/.doc 文件的任务都应使用——即使用户没说"Word"或"docx",提到"参考模板出文档""格式与模板一致""转 PDF""目录页码不对""对比两版文档哪里改了"等也应触发。先读本页路由表定位场景,再按需读 references/ 对应专题,不要一次全读。
---

# Word 技能集(word-toolkit)

所有 Word 相关能力的沉淀入口。按场景路由、按需加载、持续补充——新能力沉淀进来,老能力不重复加载。

## 路由表(先查这里)

| 场景 | 读这个 | 相关脚本 |
|------|--------|---------|
| 按既有模板批量生成格式一致的新文档(验收/方案/报告/手册等) | [references/template-generate.md](references/template-generate.md) | analyze_docx.py、build_docx.py、word2pdf.py、pdf2png.py |
| 参考用户手工修订过的 done- 版,反向对齐同套其他文档 | [references/reverse-align.md](references/reverse-align.md) | 同上 |
| 排查 docx 诡异问题(页码断链、目录"长出来"、字体缩进漂移、表格变丑等) | [references/pitfalls.md](references/pitfalls.md) | 按条目所指 |
| 新沉淀的 Word 能力 | 见文末「沉淀规范」 | — |

## 通用纪律(所有场景适用)

1. **先分析后动手**:处理前先跑 `analyze_docx.py` 读版式事实(样式、分节、域、表格结构、隐藏域),不靠肉眼猜。
2. **校验不目测**:交付前 `word2pdf.py` → `pdf2png.py` 渲染;页码单调性用 `--footers` 脚本判定,勿肉眼读渲染图上的小字号页脚;残留检查用 zipfile 直读 document.xml。
3. **内容不编造**:数字/人名/URL 只能来自用户提供的事实材料;没有的写"以实际部署环境为准"。
4. **用户手工改过的文件绝不重建**,只更新域;同套其他文件重建前先备份。

## 环境

- Windows + 已装 MS Word(渲染走 COM 最保真,还能更新目录域);`pip install python-docx pywin32 pypdfium2 pillow`
- analyze/build/pdf2png 跨平台(纯 python-docx/pdfium);word2pdf 仅 Windows+Word,无 Word 时降级 LibreOffice

## 沉淀规范(每次补充 Word 相关技能时照此执行)

1. 判断新能力属于**已有专题**(往对应 references 文件补章节)还是**新专题**(新建 `references/<topic>.md`)
2. 上方路由表登记一行(场景 | 读哪个 | 用什么脚本);新脚本放 `scripts/`,并在本文件的「环境」补依赖说明
3. 踩坑经验一律追加到 `references/pitfalls.md`,编号延续不重排
4. `LOG.md` 追加一行台账(改 | 一句话说明)
5. 提交推送
