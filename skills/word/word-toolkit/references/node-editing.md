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
