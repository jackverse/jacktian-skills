'use strict';

// Generic helpers for surgical edits to word/document.xml in an existing .docx.
// Requires jszip only when loadDocx() is called. Keep document-specific content,
// style prototypes, anchors, and expected values in the caller's build script.

const fs = require('fs');
const path = require('path');

const LOG = [];

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function textNode(value) {
  const text = String(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:t${preserve}>${esc(text)}</w:t>`;
}

function note(label) {
  LOG.push(label);
}

function getOperationLog() {
  return LOG.slice();
}

function clearOperationLog() {
  LOG.length = 0;
}

function countOccurrences(haystack, needle) {
  if (!needle) throw new Error('Search text must not be empty');
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return count;
    count += 1;
    from = i + needle.length;
  }
}

function uniqueIndex(xml, anchor, label) {
  const i = xml.indexOf(anchor);
  if (i < 0) throw new Error(`NOT FOUND: ${label}`);
  if (xml.indexOf(anchor, i + 1) >= 0) {
    throw new Error(`NOT UNIQUE: ${label}`);
  }
  return i;
}

function openTagBefore(xml, i, tag) {
  return Math.max(
    xml.lastIndexOf(`<${tag}>`, i),
    xml.lastIndexOf(`<${tag} `, i),
  );
}

function closeTagAfter(xml, i, tag, label) {
  const start = xml.indexOf(`</${tag}>`, i);
  if (start < 0) throw new Error(`RANGE END NOT FOUND: ${label}`);
  return start + `</${tag}>`.length;
}

function rangeFor(xml, anchor, tag, label) {
  const i = uniqueIndex(xml, anchor, `${label} anchor`);
  const start = openTagBefore(xml, i, tag);
  if (start < 0) throw new Error(`RANGE START NOT FOUND: ${label}`);
  const end = closeTagAfter(xml, i, tag, label);
  if (start >= i || i >= end) throw new Error(`INVALID RANGE: ${label}`);
  return [start, end];
}

// These boundary helpers are intended for ordinary, non-nested target ranges.
// For nested tables, use a namespace-aware XML parser or a depth-aware scanner.
function paraRange(xml, anchor, label = 'paragraph') {
  return rangeFor(xml, anchor, 'w:p', label);
}

function tableRange(xml, anchor, label = 'table') {
  return rangeFor(xml, anchor, 'w:tbl', label);
}

function trRange(xml, anchor, label = 'row') {
  return rangeFor(xml, anchor, 'w:tr', label);
}

function replaceOnce(xml, oldXml, newXml, label) {
  const i = uniqueIndex(xml, oldXml, label);
  note(`replace once: ${label}`);
  return xml.slice(0, i) + newXml + xml.slice(i + oldXml.length);
}

function replaceInRange(xml, start, end, oldXml, newXml, label, options = {}) {
  const expected = options.expected === undefined ? 1 : options.expected;
  const block = xml.slice(start, end);
  const count = countOccurrences(block, oldXml);

  if (count === 0) throw new Error(`NOT FOUND: ${label}`);
  if (expected === 1 && count !== 1) {
    throw new Error(`NOT UNIQUE: ${label}; found ${count}`);
  }
  if (expected !== null && expected !== 1 && count !== expected) {
    throw new Error(`COUNT MISMATCH: ${label}; expected ${expected}, found ${count}`);
  }

  const replaced = block.split(oldXml).join(newXml);
  note(`replace in range: ${label}; count=${count}`);
  return xml.slice(0, start) + replaced + xml.slice(end);
}

function replaceInPara(xml, anchor, oldXml, newXml, label, options) {
  const [start, end] = paraRange(xml, anchor, label);
  return replaceInRange(xml, start, end, oldXml, newXml, label, options);
}

function replaceInTable(xml, anchor, oldXml, newXml, label, options) {
  const [start, end] = tableRange(xml, anchor, label);
  return replaceInRange(xml, start, end, oldXml, newXml, label, options);
}

function replaceParaWith(xml, anchor, newXml, label) {
  const [start, end] = paraRange(xml, anchor, label);
  note(`replace paragraph: ${label}`);
  return xml.slice(0, start) + newXml + xml.slice(end);
}

function replaceTableWith(xml, anchor, newXml, label) {
  const [start, end] = tableRange(xml, anchor, label);
  note(`replace table: ${label}`);
  return xml.slice(0, start) + newXml + xml.slice(end);
}

function replaceBlockWith(xml, paraAnchor, tableAnchor, newXml, label) {
  const [paraStart] = paraRange(xml, paraAnchor, `${label} start`);
  const [, tableEnd] = tableRange(xml, tableAnchor, `${label} end`);
  if (paraStart >= tableEnd) throw new Error(`BLOCK ORDER INVALID: ${label}`);
  note(`replace block: ${label}`);
  return xml.slice(0, paraStart) + newXml + xml.slice(tableEnd);
}

function appendRowsToTable(xml, anchor, rowsXml, label) {
  if (!/^\s*<w:tr(?:\s|>)/.test(rowsXml)) {
    throw new Error(`ROWS XML MUST START WITH w:tr: ${label}`);
  }
  const [start, end] = tableRange(xml, anchor, label);
  const tableClose = '</w:tbl>';
  const insertAt = end - tableClose.length;
  if (insertAt < start) throw new Error(`INVALID TABLE RANGE: ${label}`);
  note(`append rows: ${label}`);
  return xml.slice(0, insertAt) + rowsXml + xml.slice(insertAt);
}

// Use only on text-only paragraphs. This intentionally drops all other runs and
// any drawings, fields, bookmarks, or hyperlinks in the selected paragraph.
function rewriteParaText(xml, anchor, newText, label) {
  const [start, end] = paraRange(xml, anchor, label);
  const para = xml.slice(start, end);
  const open = (para.match(/^<w:p(?:\s[^>]*)?>/) || ['<w:p>'])[0];
  const pPr = (para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
  const rPr = (para.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  const newPara = `${open}${pPr}<w:r>${rPr}${textNode(newText)}</w:r></w:p>`;
  note(`rewrite paragraph: ${label}`);
  return xml.slice(0, start) + newPara + xml.slice(end);
}

// Preserve the row opening tag, row properties, and the complete first cell.
// restCellsXml must contain only the replacement cells after the first cell.
function rewriteRowKeepFirstCell(xml, anchor, restCellsXml, label) {
  if (/<w:tr(?:\s|>)/.test(restCellsXml)) {
    throw new Error(`REST CELLS MUST NOT CONTAIN w:tr: ${label}`);
  }
  const [start, end] = trRange(xml, anchor, label);
  const row = xml.slice(start, end);
  const rowOpen = (row.match(/^<w:tr(?:\s[^>]*)?>/) || ['<w:tr>'])[0];
  const trPr = (row.match(/<w:trPr>[\s\S]*?<\/w:trPr>/) || [''])[0];

  // Do not slice from row[0]: that would include the old row opening tag in
  // firstCell and produce invalid nested <w:tr> markup.
  const firstCellStart = row.search(/<w:tc(?:\s|>)/);
  if (firstCellStart < 0) throw new Error(`FIRST CELL NOT FOUND: ${label}`);
  const firstCellClose = row.indexOf('</w:tc>', firstCellStart);
  if (firstCellClose < 0) throw new Error(`FIRST CELL END NOT FOUND: ${label}`);
  const firstCellEnd = firstCellClose + '</w:tc>'.length;
  const firstCell = row.slice(firstCellStart, firstCellEnd);

  const newRow = `${rowOpen}${trPr}${firstCell}${restCellsXml}</w:tr>`;
  note(`rewrite row keeping first cell: ${label}`);
  return xml.slice(0, start) + newRow + xml.slice(end);
}

function findTagEnd(xml, start) {
  let quote = null;
  for (let i = start + 1; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

// Lightweight final guard, not a replacement for a full XML parser. It checks
// tag nesting and pairing while ignoring declarations, comments, CDATA, and
// self-closing elements.
function validateXmlTagBalance(xml) {
  const stack = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;

    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0) throw new Error('XML ERROR: unterminated comment');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end < 0) throw new Error('XML ERROR: unterminated CDATA');
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0) throw new Error('XML ERROR: unterminated processing instruction');
      cursor = end + 2;
      continue;
    }

    const end = findTagEnd(xml, start);
    if (end < 0) throw new Error(`XML ERROR: unterminated tag at ${start}`);
    const tag = xml.slice(start, end + 1);
    cursor = end + 1;

    if (/^<!/.test(tag)) continue;
    const match = tag.match(/^<(\/?)\s*([A-Za-z_][\w:.-]*)\b/);
    if (!match) throw new Error(`XML ERROR: cannot parse tag ${tag}`);

    const closing = match[1] === '/';
    const name = match[2];
    const selfClosing = /\/\s*>$/.test(tag);
    if (selfClosing) continue;

    if (closing) {
      const open = stack.pop();
      if (open !== name) {
        throw new Error(`XML ERROR: expected </${open || 'none'}>, found </${name}>`);
      }
    } else {
      stack.push(name);
    }
  }

  if (stack.length) {
    throw new Error(`XML ERROR: unclosed tags: ${stack.slice(-8).join(', ')}`);
  }
  return true;
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlToText(xml) {
  const withBreaks = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n');
  return decodeEntities(withBreaks.replace(/<[^>]+>/g, ''));
}

async function loadDocx(filePath) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('word/document.xml not found in docx');
  const xml = await part.async('string');
  return { zip, xml };
}

async function saveDocx(zip, xml, targetPath, options = {}) {
  validateXmlTagBalance(xml);
  if (!zip.file('word/document.xml')) {
    throw new Error('word/document.xml not found in docx');
  }
  zip.file('word/document.xml', xml);
  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  if (options.backup !== false) {
    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      const historyDir = options.historyDir || path.join(path.dirname(targetPath), 'history');
      await fs.promises.mkdir(historyDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const parsed = path.parse(targetPath);
      const backupPath = path.join(historyDir, `${parsed.name}.${stamp}${parsed.ext}`);
      await fs.promises.copyFile(targetPath, backupPath);
      note(`backup: ${backupPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  await fs.promises.writeFile(targetPath, output);
  note(`saved: ${targetPath}`);
}

module.exports = {
  appendRowsToTable,
  clearOperationLog,
  countOccurrences,
  esc,
  getOperationLog,
  loadDocx,
  paraRange,
  replaceBlockWith,
  replaceInPara,
  replaceInRange,
  replaceInTable,
  replaceOnce,
  replaceParaWith,
  replaceTableWith,
  rewriteParaText,
  rewriteRowKeepFirstCell,
  saveDocx,
  tableRange,
  textNode,
  trRange,
  validateXmlTagBalance,
  xmlToText,
};
