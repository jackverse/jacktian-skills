# 无 Python 环境：Node.js + JSZip 直改现有 docx

## 何时使用

Windows 上 `python`/`py` 指向 WindowsApps stub（常见表现为 Permission denied），且没有 pandoc、LibreOffice 或可用的 python-docx 时，用 Node.js + JSZip 对**现有 docx 做定点手术**。此路线直接编辑 `word/document.xml`，保留包内其他部件，不需要重建整篇文档。

适合：改段落文字、改表格数字、重写文本段、追加表格行、按原样式生成小表或替换区块。

不适合单独承担：渲染分页、更新目录/域、复杂嵌套表格解析、无锚点的大规模结构重建。这些工作仍需 Word/渲染工具或命名空间感知的 XML 解析器配合。

通用辅助脚本：[../scripts/docx_xml_edit.js](../scripts/docx_xml_edit.js)。脚本不含任何文档内容；调用方提供锚点、替换文本、样式原型与预期次数。

## 最小环境与读写链路

```bash
node -v
npm install jszip
```

```js
const {
  loadDocx, saveDocx, replaceInTable, rewriteParaText,
  validateXmlTagBalance, xmlToText, getOperationLog,
} = require('./docx_xml_edit'); // 可将通用脚本复制到工作脚本旁

(async () => {
  const file = 'D:/work/input.docx';
  const { zip, xml: sourceXml } = await loadDocx(file);
  let xml = sourceXml;

  // 先探测锚点，再执行编辑；每个操作都有 NOT FOUND/NOT UNIQUE 断言。
  xml = replaceInTable(
    xml, '稳定的表头或首行文本',
    '<w:t>17</w:t>', '<w:t>18</w:t>',
    '示例：表内单项数字更新',
  );
  xml = rewriteParaText(xml, '稳定的连续中文短句', '新的整段文字', '示例：整段重写');

  validateXmlTagBalance(xml);
  await saveDocx(zip, xml, file); // 默认备份到同目录 history/

  // 从落盘产物重新读取，不只检查内存字符串。
  const reopened = await loadDocx(file);
  const fullText = xmlToText(reopened.xml);
  if (!fullText.includes('新的整段文字')) throw new Error('QA: expected text missing');
  console.log(getOperationLog().join('\n'));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

保存时先校验 XML、生成完整 DEFLATE 包并备份现有目标，再写回。

## 标准作业顺序

1. **备份原件**：复制到 `history/`，文件名带时间戳；通用 `saveDocx` 已提供默认备份。文件被 Word 占用时不得强杀程序，改输出路径并说明。
2. **同时看两种事实**：提取全文纯文本用于理解内容；查看 `word/document.xml` 原始片段用于确认 run 边界、样式与真实锚点。纯文本存在不等于相同字符串在 XML 中连续存在。
3. **先探测再替换**：对锚点、旧 XML 片段分别 `indexOf`；默认要求唯一。找不到就先查 run 拆分，不要放宽成全局替换。
4. **缩小范围再改**：先定位段落/表格/行，再在范围内替换。数字统一改成完整 `<w:t>旧值</w:t>` 片段匹配，禁止全文裸替换数字。
5. **生成器克隆原样式**：从同类段落、表格、行、单元格提取 `pPr`、`rPr`、`tblPr`、`tblGrid`、`trPr`、`tcPr`、`tcW`，不要跨文档硬编码 styleId、字体、列宽。
6. **收尾四检**：XML 标签配对校验；重新打开产物并提取全文；逐项核对关键数字、枚举和口径；检查操作日志数量与预期编辑清单一致。

## 核心坑与对策

### 1. Word/WPS 会拆 run，文本锚点经常不连续

数字、英文、引号、间隔号 `·` 等经常被拆成独立的 `<w:r>/<w:t>`。例如纯文本里看到的一句话，XML 中可能是：

```xml
<w:r><w:t>连续中文</w:t></w:r><w:r><w:t>17</w:t></w:r><w:r><w:t>个</w:t></w:r>
```

因此：

- 长句锚点优先选一段**稳定、连续的中文短句**，避开数字、英文、引号、`·` 和可能被改写的词。
- 替换数字时使用 `<w:t>17</w:t>` 这类完整文本节点，并且只在目标段落或表格范围内操作。
- 如果目标文字跨 run，不要拼全局正则硬跨标签；改用更近的稳定锚点，或在确认该段没有域、图片、超链接等部件后用 `rewriteParaText` 整段重写。

### 2. 同一范围连续编辑会使后续锚点失效

若第一处替换改掉了后续操作共同使用的锚点，后续必然 `NOT FOUND`。同一表格的多处修改统一使用**不会被任何编辑触碰的稳定锚点**，如表头或首行测试内容；每次操作后重新计算范围，因为字符串偏移已经变化。

不要复用编辑前保存的数字下标，也不要把刚被替换掉的文字继续当锚点。

### 3. 范围边界与行头切片必须准确

普通非嵌套目标可用：

- 段落：锚点前最近的 `<w:p>`/`<w:p ` 到锚点后首个 `</w:p>`。
- 表格：`lastIndexOf('<w:tbl>', i)` 到 `indexOf('</w:tbl>', i)`。
- 行：锚点前最近的 `<w:tr>`/`<w:tr ` 到锚点后首个 `</w:tr>`。

重写行并保留第一列时，`firstCell` 必须从该行内部第一个 `<w:tc>`（或 `<w:tc `）开始切，到对应 `</w:tc>` 结束。**不能从 `tr[0]` 开始切**，否则会把旧 `<w:tr>` 行头包进新行，形成 `<w:tr>` 嵌套，导致 XML 不合法。

上述字符串边界法以目标范围内无同类嵌套为前提。遇到嵌套表格，换用命名空间感知 XML 解析器或按标签深度扫描，不要继续套简单 `lastIndexOf/indexOf`。

### 4. `String.replace` 默认只换第一个匹配

统计表中同一数字可能出现多次。通用操作默认要求范围内恰好一个匹配；若业务明确要求替换 N 处：

- 传 `{ expected: N }`，脚本会先核对实际次数再全部替换；或
- 在已限定的范围内使用 `split(oldXml).join(newXml)`，同时先计数断言。

不要为了“换干净”改成无范围的全局替换。

## 操作集与生成器骨架

通用脚本提供：

- 定位：`paraRange`、`tableRange`、`trRange`。
- 替换：`replaceOnce`、`replaceInPara`、`replaceInTable`、`replaceParaWith`、`replaceTableWith`、`replaceBlockWith`。
- 结构编辑：`rewriteParaText`、`rewriteRowKeepFirstCell`、`appendRowsToTable`。
- 收尾：`validateXmlTagBalance`、`xmlToText`、`getOperationLog`。

在任务脚本内按文档实际结构实现自己的生成器，建议保持以下职责划分：

```js
// 伪代码：prototype 均从当前文档同类节点克隆，不照抄其他项目。
const makeBodyPara = (text, prototype) => /* pPr + rPr + escaped w:t */;
const makeHeading4 = (text, prototype) => /* 当前文档 H4 的 pPr/rPr */;
const makeCaseTable = (title, rows, prototype) => /* tblPr/tblGrid/trPr/tcPr */;
```

所有生成文本必须 XML 转义；首尾有空格时给 `<w:t>` 加 `xml:space="preserve"`。整段重写只用于纯文本段，因为会移除该段其他 run、域、书签、图片和超链接。

## 交付前检查清单

- [ ] 原文件已进入 `history/`，输出路径明确。
- [ ] 每个编辑都有业务标签，失败信息含 `NOT FOUND`、`NOT UNIQUE` 或次数不符。
- [ ] 多处编辑共用稳定锚点，没有复用旧偏移或已失效锚点。
- [ ] 数字替换限定在目标段/表/行内，重复次数有断言。
- [ ] 新增节点样式来自当前文档原型，文本已转义。
- [ ] 栈式 XML 校验通过，忽略自闭合标签、声明、注释与 CDATA。
- [ ] 重新 `JSZip.loadAsync` 读取落盘产物成功，并重新提取全文复核关键数字与口径。
- [ ] 操作日志与预期修改清单逐项一致；需要版式验收时另行用 Word 渲染检查。

## 整篇重建正文（大纲驱动，保留文档骨架）

### 适用场景

适用于手册、说明书等文档的**内容需要整体重写，但版式与文档骨架必须保留**的场景，例如把“功能罗列式”操作手册按任务大纲整篇改成“任务驱动式”，同时保留封面、标题与正文样式、页眉页脚、分节页脚、环境表和目录。它与前文“按稳定锚点修改少量段落/表格/行”的定点编辑不同：这里以新大纲为内容源，只重建正文与目录缓存，不新建整份 docx，也不替换包内样式、主题、编号、页眉页脚和关系部件。

前提仍是文档骨架存在可验证的边界（分节符、目录 `sdt`、body 末尾 `sectPr`）。先备份原件，并提取原文全文、标题大纲、表格清单及 XML 结构；不要因“整篇重写”跳过事实分析与落盘对账。

### 1. 按文档骨架拆分，而不是另起空白文档

在 `word/document.xml` 中定位并保留以下区域：

- **封面**：首个含 `w:sectPr` 的 `w:p` 之前的内容为封面主体；该分节段是封面收尾和分节边界，重建时一并保留，不能把它当普通空段删除。
- **目录**：从首个 `<w:sdt>`（或带属性的 `<w:sdt ...>`）到与其配对的 `</w:sdt>`。目录可能含多个段落和域缓存，必须按完整 `sdt` 区块处理，不能只替换某一条目录文字。
- **正文**：目录 `sdt` 结束之后，到 `<w:body>` 末尾的 `w:sectPr` 之前。用新大纲生成的标题、段落和表格替换这一区域。
- **文档尾部分节属性**：保留 body 末尾的 `w:sectPr` 原样落回，确保最后一节的页面设置、页眉页脚引用和页码设置不丢失。

环境表等需要保留的正文资产，先从原文提取完整 `w:tbl` XML 及必要上下文，在新大纲规定的位置原样插回；不要凭文字重新画一份“看起来相同”的表。若边界附近还有分节段、书签或关系引用，逐项确认归属后再删旧正文。

### 2. 从当前文档收割样式与域原型

生成器所需原型全部从**当前文档**克隆，不跨文档硬编码 styleId、缩进、字体、字号、域指令或目录容器属性：

- Heading 1–4 各自代表段的 `pPr`（必要时同时保留对应 run 的 `rPr`）。
- 正文代表段的 `pPr + rPr`。
- TOC 1–3 各级代表段的 `pPr`。
- 目录容器的 `sdtPr`，以及原 `instrText` 中的 TOC 域指令。
- 表格的 `tblPr`、`tblGrid`、行/单元格属性；需要保留的环境表直接复用完整原型。

**先查标题编号机制再写标题文本。**读取 `word/styles.xml`，确认 Heading 样式是否通过 `numPr` 关联自动编号，并核对原文代表段是否还有直接 `numPr`：常见情况是 Heading 1/2 自动编号，标题文本本身不写“1”“1.1”；Heading 3/4 不挂自动编号，标题文本需手写 `x.y.z` 前缀。若编号机制判断反了，会出现重复编号或目录缺号。新大纲的层级、标题纯文本与应显示的编号要分别保存，便于后续断言。

### 3. 重建正文、表格与目录域缓存

按新大纲依次生成标题、正文段落和表格，所有文本做 XML 转义；正文样式、列表和表格结构均使用上一步收割的原型。

- **表格边框**：需要六边全框线时，将 `tblBorders` 插在 `tblPr` 内、`tblLayout` 之前，包含 `top/left/bottom/right/insideH/insideV`；同时避免单元格局部边框覆盖表级设置。
- **表格列宽**：读取原表 `tblGrid` 的总宽，按新表各列需求分配列宽，保持总宽不变；不要另填一套导致表格超出版心的固定宽度。
- **TOC 缓存结构**：沿用原 `sdtPr` 与 TOC 域指令。在**首个目录条目段**内放 `fldChar begin` → `instrText` → `fldChar separate`，其后是各级 TOC 条目缓存；在**末个目录条目段尾部**放 `fldChar end`，使域 begin/separate/end 配对且缓存条目处于域结果范围内。
- **缓存页码**：重建阶段可写占位页码，目录条目的文字、级别、顺序必须与正文标题一致。占位值不是交付结果，最后用 Word 更新目录域，得到真实页码并保存。

### 4. 收尾校验与全文对账

1. 保存前执行 XML 标签配对校验，特别检查 `w:p`、`w:tbl`、`w:sdt`、`w:fldChar` 所在域结构及 body 末尾 `sectPr` 是否完整。
2. 用 JSZip 重新打开**落盘产物**，重新提取正文与目录，不只检查内存中的 XML 字符串。
3. 将新大纲作为唯一预期清单，逐项断言：标题文本/层级/顺序、目录条目/级别/顺序、表格数量/位置/每表行数与关键行内容；同时断言封面文本、环境表、保留的分节结构仍在，旧正文应删除的标志性标题不再残留。
4. 样式与页码属于版式事实，最后仍需 Word 打开、更新域并保存；需要视觉验收时再导出 PDF 检查。

### 5. 用 Word COM 批量刷新目录并导出 PDF

Node.js+JSZip 只负责重建包内 XML；真实分页和目录页码交给本机 Word。可对多份产物逐个执行以下流程，`wdExportFormatPDF=17`：

```powershell
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  foreach ($path in $docxPaths) {
    $doc = $word.Documents.Open($path)
    try {
      foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
      $doc.Save()
      if ($exportPdf) {
        $pdfPath = [System.IO.Path]::ChangeExtension($path, '.pdf')
        $doc.ExportAsFixedFormat($pdfPath, 17)
      }
    }
    finally {
      $doc.Close()
    }
  }
}
finally {
  $word.Quit()
}
```

传入 `$docxPaths` 的必须是完整路径，并先确认文件未被其他 Word 进程占用；不要为跑脚本强杀用户已有的 Word。COM 更新完成后，再重开保存后的 docx 核对目录页码已不再是占位值，PDF 仅作为版式验收产物，不能替代 XML 全文对账。
