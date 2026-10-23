# 专题:按模板批量生成格式一致的文档

把一份既有 Word 模板(公司/行业固定格式)复制为副本,保留其封面、样式、页眉脚、分节,
替换正文与目录为 Markdown 内容,产出与模板格式一致的新 docx,并渲染校验。

## 何时用

- 有固定格式模板,要按新项目内容产出同类文档(验收四件套、方案书、报告……)
- 模板里有封面/修订记录表/目录页/页脚页码,手工复制粘贴容易丢格式
- 一次生成多份、或反复修订重生成

## 脚本

`scripts/` 下四个工具,全部只依赖 `python-docx`(build/analyze)与
`pywin32`、`pypdfium2`、`pillow`(渲染校验):

| 脚本 | 作用 |
|------|------|
| `analyze_docx.py` | 模板版式体检:分节/页边距/页眉脚(含 PAGE 域检测)/样式定义/目录标题/封面段落/修订表结构/媒体与隐藏域计数,可选 `--outline` 输出标题大纲 |
| `build_docx.py` | 核心构建:复制模板 → 全文替换 → 删旧目录旧正文 → 注入 Markdown 正文 → 重建目录域 → 写修订记录 → 清未引用媒体 |
| `word2pdf.py` | Word COM 独立实例只读转 PDF,**先更新目录域**(页码才会出现),不动用户已打开的 Word |
| `pdf2png.py` | PDF 渲染 PNG 供视觉检查;`--footers` 提取页脚文字并自动校验页码单调递增 |
| `fill_img_placeholders.py` | `::IMG::` 截图占位框回填真实图片(题注全等匹配),详见 [img-backfill.md](img-backfill.md) |

## 工作流

### 1. 分析模板(先读版式事实,不靠肉眼)

```bash
python scripts/analyze_docx.py 模板.docx --outline --out tpl_report.md
```

重点看:① Heading 样式是否存在且"段前分页"与否;② 有没有 `Table Grid` 表格样式;
③ "目录"标题段落挂什么样式(决定 build 定位);④ 修订记录表(表 0)几行几列、
记录行格式;⑤ 页脚哪几节有 PAGE 域;⑥ document.xml 是否含 fldSimple(隐藏"幽灵目录"域)。

### 2. 写内容 Markdown

build 可识别的方言(**刻意无列表语法**,中文公文用不到):

```
# ~ ######        → Heading 1..6(标题文字不要带编号)
普通段落           → Normal;支持 **加粗**
| a | b |         → 管道表格;首行=表头(表头重复/行不拆分/底纹);单元格内禁用竖线字符
::IMG::说明文字    → 截图占位框(单格边框表 + 居中题注),后续人工贴图
!PAGEBREAK        → 分页
```

- 标题编号默认 **auto 模式**:行首字面编号一律剥离,标题文字不带编号。多数模板的
  Heading 1/2/3 样式自带自动编号(numId 挂在样式上,`lvlText` 如"第%1章"/"%1.%2"/
  "%1.%2.%3"),python-docx 新建的标题段**不带 numPr 覆盖就继承样式编号**,文字里再带
  字面编号会变成"双重编号"。
- 确需 Heading 4+ 时注意:H4+ 样式常挂在**独立 numId**上,与 1-3 级的主编号列表不同步。
  两条路:`--mode manual` 按 manual 模式给 3 级及以下重算字面编号(如 `7.4.1`,按上下文
  而非平铺序号——适用于 1/2 级样式自动、深层级不自动的模板,用户操作手册常见);或给
  H4+ 段落加 numPr 覆盖(ilvl=3、numId=主编号列表)挂回主列表,继续吃自动编号。
- 内容纪律:数字/人名/URL 只能来自用户提供的事实材料,不编造;没有的事实写
  "以实际部署环境为准"。

### 3. 构建

```bash
python scripts/build_docx.py 模板.docx content.md 输出.docx --mode manual \
  --replace "旧项目名称=新项目名称" --replace "二〇二五年五月=二〇二六年十月" \
  --rev-date 2026.10.14 --rev-ver V1.0 --rev-desc 新建 --rev-author 项目组
```

- `--replace` 可多次,替换覆盖**全文**(封面、修订表、页眉脚、域缓存文本)。
  日期若有多种写法(`二〇二五年五月`、`2025年5月`)要逐个传。
- 构建结束打印统计:`body_start / toc paras / rev_row / tables / paras / media dropped / footer_fixed`。

### 4. 内容对账(渲染前)

用 python-docx 把产物的标题大纲 + 全文 dump 出来,与 md 源对账:

- 标题一一对应:数量、顺序、文字(编号差异除外——auto 模式已剥离字面编号)。
- 全文 grep 过时术语:旧项目名/旧技术名词/旧日期,产物与 md 源两侧各查一遍。
- 目的:渲染前先确认"产物 = 源 + 预期加工",把"内容不对"定位到构建侧还是源侧
  (疑似不对时的完整排障见下文「证据链」)。

### 5. 渲染校验(必须做,不要目测)

```bash
python scripts/word2pdf.py 输出.docx 预览.pdf        # MS Word COM;无 Word 时降级 LibreOffice
python scripts/pdf2png.py 预览.pdf pages --footers   # 页脚数字单调性脚本判定
```

- **LibreOffice 降级渲染不刷新 TOC 域**(目录页码缺失/停留在旧值),只可作排版粗检;
  交付版必须走 Word COM(先 `TablesOfContents.Update` + `Fields.Update` 再导出,
  word2pdf.py 已内置)。
- 打开生成的 docx 时 Word 会提示"更新域"→ 是,目录页码即刷新(build 已设
  `updateFields`,有的版本仍会问一次)。
- `--footers` 输出每页页脚文字 + 单调性结论,断点直接列出。**勿用肉眼读渲染图上的
  小字号页脚数字**(1.6x 下 40/13 会看成 4/1)。
- 交付前用 zipfile 直读 document.xml 做残留检查:旧项目名/旧日期/旧人名应无命中;
  注意真实业务词(如赛道名)可能合法包含旧关键字,逐条判断。

## 重建优于打补丁(老模板尤其)

接手的老 docx/老模板正文常残留大量与目标项目无关的样板章节(上个年代的过时技术描述:
J2EE/SOA/WebService/ActiveX 之类)与老剪贴画图片。此时:

- **从模板全正文重建,不要在旧 docx 上打补丁**。补丁式修改必漏删残留,逐处排查残留的
  成本远高于一次重建;重建 = build 的"删旧目录旧正文 + 注入 md + 清未引用媒体"全链路。
- 模板旧媒体不必逐张人工找:`strip_unused_media` 用**包内 rels 引用分析**整体剥离——
  遍历包内 `**/*.rels` 建立 rid→media 映射,统计各 part XML 里
  `r:embed/r:id/r:link/r:pict` 的实际引用,全包未引用的 media 直接删并同步清 rels
  悬空项。手工清理照同一思路做,不要按文件名猜。

## 排障:"文档内容不对"先看证据链

先定位问题层级再动手,不要上来就手改产物 docx——手改在下次重建时必丢:

1. **版本链**:bak 目录多版本 docx 互 diff 大纲(`analyze_docx.py --outline` 输出直接
   diff),先排除"拿错版本/构建产物过时"。
2. **产物 vs 产物**:疑似分叉的两版做正文全文 diff(python-docx 段落 `(style, text)`
   序列,或 zipfile 直读 document.xml),找到从哪一段开始不一样。
3. **产物 vs 源**:产物大纲对 md 源大纲 diff——确认"产物 = 源 + 预期加工"后,
   剩下的差异就是源内容本身的问题。

结论分支:构建产物过时 → 用原参数重新 build;源内容错 → 改 md 再 build。
