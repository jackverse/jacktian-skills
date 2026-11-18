#!/usr/bin/env node
// delete.mjs — 浏览器上网历史定向删除（备份 → 事务化删除全关联表 → VACUUM 真擦除 → 复验清零）
// 用法: node --experimental-sqlite delete.mjs --domain example.com [--browser all|chrome|edge|firefox] [--profile <名称>] [--yes]
//   默认 dry-run：只在快照上统计"将删除行数"，不碰原库；--yes 才真正执行（自动先备份到 %TEMP%）。
// Node >= 22（v22 必须带 --experimental-sqlite；v23+ 已默认启用）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('[x] 当前 Node 不含 node:sqlite。Node 22 请加 flag 运行: node --experimental-sqlite delete.mjs');
  process.exit(1);
}

// ---- 参数 ----
const argv = process.argv.slice(2);
function argOf(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const domain = argOf('--domain', '');
const browser = argOf('--browser', 'all');
const profileFilter = argOf('--profile', '');
const execute = argv.includes('--yes');
if (!domain) {
  console.error('用法: node --experimental-sqlite delete.mjs --domain <域名> [--browser all|chrome|edge|firefox] [--profile <名称>] [--yes]');
  process.exit(1);
}
// LIKE 通配转义，配 ESCAPE '\' 使用
const likeParam = `%${domain.replace(/[\\%_]/g, '\\$&')}%`;
const ESC = " ESCAPE '\\'";
const running = [];

// ---- 浏览器进程检测（引号精确匹配；msedgewebview2.exe 是其他 app 的 WebView 组件，不锁历史库，忽略）----
const BROWSER_PROCS = { chrome: 'chrome.exe', edge: 'msedge.exe', firefox: 'firefox.exe' };
function runningBrowsers() {
  const found = [];
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 15000 }).toLowerCase();
    for (const [b, img] of Object.entries(BROWSER_PROCS)) if (out.includes(`"${img}"`)) found.push(b);
  } catch {}
  return found;
}

// ---- Profile 枚举（与 scan.mjs 一致：目录里存在库文件即纳入，含空格目录名）----
function chromeTargets(name, root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const hist = path.join(root, d.name, 'History');
    if (fs.existsSync(hist)) out.push({ browser: name, profile: d.name, file: hist, kind: 'chrome-history' });
  }
  return out;
}
function firefoxTargets() {
  const root = path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(root, d.name, 'places.sqlite');
    if (fs.existsSync(p)) out.push({ browser: 'firefox', profile: d.name, file: p, kind: 'firefox-places' });
  }
  return out;
}
function targets() {
  const t = [];
  const la = process.env.LOCALAPPDATA || '';
  if (browser === 'all' || browser === 'chrome')
    t.push(...chromeTargets('chrome', path.join(la, 'Google', 'Chrome', 'User Data')));
  if (browser === 'all' || browser === 'edge')
    t.push(...chromeTargets('edge', path.join(la, 'Microsoft', 'Edge', 'User Data')));
  if (browser === 'all' || browser === 'firefox') t.push(...firefoxTargets());
  // 同 Profile 目录下的辅助库（地址栏联想/新标签页常用/站点图标——不删会在这些入口"露馅"）
  const aux = [];
  for (const x of [...t]) {
    for (const name of ['Shortcuts', 'Top Sites', 'Favicons']) {
      const f = path.join(path.dirname(x.file), name);
      if (fs.existsSync(f)) aux.push({ browser: x.browser, profile: x.profile, file: f, kind: 'chrome-aux' });
    }
  }
  return t.concat(aux).filter((x) => !profileFilter || x.profile.toLowerCase().includes(profileFilter.toLowerCase()));
}

// ---- 工具 ----
const q = (id) => JSON.stringify(id); // 标识符安全引用
function setBigInt(st) { try { st.setReadBigInts(true); } catch {} return st; }
function chunk(arr, n = 500) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
function tableExists(db, name) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
function tables(db) { return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name); }
function columns(db, table) { return db.prepare(`PRAGMA table_info(${q(table)})`).all().map((c) => c.name); }
function urlishCols(db, table) {
  return columns(db, table).filter((n) => ['url', 'page_url', 'tab_url', 'original_url', 'top_level_url', 'frame_url', 'icon_url'].includes(n.toLowerCase()));
}
function countByLike(db, table, col) {
  if (!tableExists(db, table)) return 0;
  if (!columns(db, table).includes(col)) return 0;
  return db.prepare(`SELECT COUNT(*) n FROM ${q(table)} WHERE ${q(col)} LIKE ?${ESC}`).get(likeParam).n;
}
function delByLike(db, table, col) {
  const n = countByLike(db, table, col);
  if (n) db.prepare(`DELETE FROM ${q(table)} WHERE ${q(col)} LIKE ?${ESC}`).run(likeParam);
  return n;
}
function countByIds(db, table, col, ids) {
  let n = 0;
  for (const part of chunk(ids)) if (part.length)
    n += db.prepare(`SELECT COUNT(*) n FROM ${q(table)} WHERE ${q(col)} IN (${part.map(() => '?').join(',')})`).get(...part).n;
  return n;
}
function delByIds(db, table, col, ids) {
  let n = 0;
  for (const part of chunk(ids)) if (part.length) {
    const ph = part.map(() => '?').join(',');
    n += db.prepare(`SELECT COUNT(*) n FROM ${q(table)} WHERE ${q(col)} IN (${ph})`).get(...part).n;
    db.prepare(`DELETE FROM ${q(table)} WHERE ${q(col)} IN (${ph})`).run(...part);
  }
  return n;
}
function idListByLike(db, table, idCol, likeCols) {
  const where = likeCols.map((c) => `${q(c)} LIKE ?${ESC}`).join(' OR ');
  return db.prepare(`SELECT ${q(idCol)} v FROM ${q(table)} WHERE ${where}`).all(...likeCols.map(() => likeParam)).map((r) => r.v);
}
// 按"父表已收集的 id"取子表引用：visits.url 等是整数外键，LIKE 永不匹配，必须走 IN (parentIds) join
function idListByJoinIds(db, table, selectCol, fkCol, parentIds) {
  const out = [];
  for (const part of chunk(parentIds)) if (part.length) {
    const ph = part.map(() => '?').join(',');
    out.push(...db.prepare(`SELECT ${q(selectCol)} v FROM ${q(table)} WHERE ${q(fkCol)} IN (${ph})`).all(...part).map((r) => r.v));
  }
  return out;
}

// ---- Chrome/Edge History：已知表精确清理（先子后父）+ 隐藏表兜底扫描 ----
function cleanChromeHistory(db, report) {
  const urlIds = idListByLike(db, 'urls', 'id', ['url']);
  // 关键：visits.url 是整数外键，不能对它做 LIKE，必须按 urls.id join 收集 visit id
  const visitIds = urlIds.length ? idListByJoinIds(db, 'visits', 'id', 'url', urlIds) : [];
  // 1) 所有带 visit_id 列的表（含 context_annotations/content_annotations/clusters_and_visits 等隐藏表）
  for (const t of tables(db)) if (columns(db, t).includes('visit_id'))
    report(t, delByIds(db, t, 'visit_id', visitIds));
  // 2) visit_source（id 即 visit id）→ visits
  report('visit_source', delByIds(db, 'visit_source', 'id', visitIds));
  report('visits', delByIds(db, 'visits', 'id', visitIds));
  // 3) 搜索词明文（隐私重点）
  report('keyword_search_terms', delByIds(db, 'keyword_search_terms', 'url_id', urlIds));
  // 4) segments / segment_usage
  const segIds = tableExists(db, 'segments') ? idListByLike(db, 'segments', 'id', ['url']) : [];
  if (segIds.length) {
    report('segment_usage', delByIds(db, 'segment_usage', 'segment_id', segIds));
    report('segments', delByIds(db, 'segments', 'id', segIds));
  }
  // 5) 下载记录 + URL 重定向链（极易漏删）
  if (tableExists(db, 'downloads')) {
    const dlCols = columns(db, 'downloads').filter((c) => ['tab_url', 'tab_referrer_url'].includes(c.toLowerCase()));
    const dlIds = dlCols.length ? idListByLike(db, 'downloads', 'id', dlCols) : [];
    report('downloads_url_chains', delByIds(db, 'downloads_url_chains', 'id', dlIds) + delByLike(db, 'downloads_url_chains', 'url'));
    report('downloads', delByIds(db, 'downloads', 'id', dlIds));
  }
  // 6) 父表 urls
  report('urls', delByIds(db, 'urls', 'id', urlIds));
  // 7) visited_links 的 link_url_id 也是整数外键，按 id 显式清理后再兜底
  if (tableExists(db, 'visited_links') && columns(db, 'visited_links').includes('link_url_id'))
    report('visited_links(link_url_id)', delByIds(db, 'visited_links', 'link_url_id', urlIds));
  // 8) 兜底：逐表扫 url-like 文本列，清理文档没提的隐藏表（visited_links 的 top_level_url/frame_url 等）
  for (const t of tables(db)) for (const c of urlishCols(db, t))
    report(`${t}.${c}(兜底)`, delByLike(db, t, c));
  return 0;
}

// ---- Chrome 辅助库：Shortcuts / Top Sites 通用 url-like 清理 ----
function cleanChromeAux(db, report) {
  for (const t of tables(db)) for (const c of urlishCols(db, t))
    report(`${t}.${c}`, delByLike(db, t, c));
  return 0;
}

// ---- Favicons：bitmaps(按 icon_id) → favicons(列名两代 schema 不同：url 或 icon_url) → icon_mapping(page_url) ----
function cleanFavicons(db, report) {
  if (tableExists(db, 'favicons')) {
    const cols = columns(db, 'favicons');
    const urlCol = cols.find((c) => c.toLowerCase() === 'url') || cols.find((c) => c.toLowerCase() === 'icon_url');
    if (urlCol && tableExists(db, 'favicon_bitmaps') && columns(db, 'favicon_bitmaps').includes('icon_id')) {
      const ids = idListByLike(db, 'favicons', 'id', [urlCol]);
      report('favicon_bitmaps', delByIds(db, 'favicon_bitmaps', 'icon_id', ids));
    }
    if (urlCol) report(`favicons.${urlCol}`, delByLike(db, 'favicons', urlCol));
  }
  if (tableExists(db, 'icon_mapping')) report('icon_mapping.page_url', delByLike(db, 'icon_mapping', 'page_url'));
  cleanChromeAux(db, report); // 其余表兜底
  return 0;
}

// ---- Firefox places.sqlite：书签保护 → annos/inputhistory/visits → places ----
// 返回"有意保留"的行数（被书签引用的 place），供复验时区分"清零"与"保留"
function cleanFirefox(db, report) {
  const matched = db.prepare(`SELECT id, url FROM moz_places WHERE url LIKE ?${ESC}`).all(likeParam);
  const bm = db.prepare('SELECT p.id id, p.url url FROM moz_places p JOIN moz_bookmarks b ON b.fk = p.id WHERE p.url LIKE ?' + ESC).all(likeParam);
  const bmIds = new Set(bm.map((r) => r.id));
  const ids = matched.filter((r) => !bmIds.has(r.id)).map((r) => r.id);
  if (bmIds.size) {
    console.log(`  [i] 有 ${bmIds.size} 条匹配记录被书签引用，为保书签完整已跳过：`);
    for (const r of bm.slice(0, 5)) console.log(`      书签保留: ${r.url}`);
  }
  report('moz_annos', delByIds(db, 'moz_annos', 'place_id', ids));
  report('moz_inputhistory', delByIds(db, 'moz_inputhistory', 'place_id', ids));
  report('moz_historyvisits', delByIds(db, 'moz_historyvisits', 'place_id', ids));
  report('moz_places', delByIds(db, 'moz_places', 'id', ids));
  // 兜底扫描必须排除 moz_places：否则会把书签保护的 place 一并删掉，保护形同虚设
  for (const t of tables(db)) {
    if (t === 'moz_places') continue;
    for (const c of urlishCols(db, t)) report(`${t}.${c}(兜底)`, delByLike(db, t, c));
  }
  return bmIds.size;
}

// ---- 删除后复验：所有 url-like 列残留计数，必须为 0 ----
function verifyZero(db) {
  let left = 0;
  for (const t of tables(db)) for (const c of urlishCols(db, t)) left += countByLike(db, t, c);
  return left;
}
// ---- 真擦除：DELETE 只标记，VACUUM 才清数据页；WAL 还要 checkpoint(TRUNCATE) ----
function vacuumAndCheck(db) {
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  let ok = '?';
  try { ok = db.prepare('PRAGMA integrity_check').get(); ok = ok && Object.values(ok)[0]; } catch {}
  return ok;
}
// ---- 备份（含 -wal/-shm/-journal，先于任何写操作）----
function backup(file, backupDir, tag) {
  const dir = path.join(backupDir, tag);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(file));
  fs.copyFileSync(file, dest);
  for (const ext of ['-wal', '-shm', '-journal']) { const s = file + ext; if (fs.existsSync(s)) fs.copyFileSync(s, dest + ext); }
  return dest;
}
function snapshot(src, dir, tag) {
  const dest = path.join(dir, `${tag}__${path.basename(src)}`);
  fs.copyFileSync(src, dest);
  for (const ext of ['-wal', '-shm', '-journal']) { const s = src + ext; if (fs.existsSync(s)) fs.copyFileSync(s, dest + ext); }
  return dest;
}

// ---- 单库处理 ----
function processTarget(t, backupDir) {
  const label = `${t.browser} [${t.profile}] ${path.basename(t.file)}`;
  console.log(`== ${label}`);
  if (execute && running.includes(t.browser)) {
    console.log('  [跳过] 浏览器正在运行，历史库被锁（database is locked）。请关闭浏览器后重试。');
    return;
  }
  const run = (db) => {
    const report = (name, n) => { if (n > 0) console.log(`    ${name}: 删除 ${n} 行`); };
    const totalBefore = () => { let s = 0; for (const tb of tables(db)) for (const c of urlishCols(db, tb)) s += countByLike(db, tb, c); return s; };
    const before = totalBefore();
    console.log(`  目标 "${domain}" 当前残留引用: ${before} 行`);
    if (!before) { console.log('  无需删除。'); return; }
    if (!execute) { console.log('  [dry-run] 未做任何修改。确认后加 --yes 执行。'); return; }
    let kept = 0;
    db.exec('BEGIN');
    try {
      if (t.kind === 'chrome-history') kept = cleanChromeHistory(db, report);
      else if (t.kind === 'chrome-aux') { kept = path.basename(t.file) === 'Favicons' ? cleanFavicons(db, report) : cleanChromeAux(db, report); }
      else kept = cleanFirefox(db, report);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const left = verifyZero(db);
    const ok = vacuumAndCheck(db);
    const tail = left === 0 ? ' (已清零)' : left === kept ? ` (保留 ${kept} 条书签保护项)` : ` [!]仍有残留`;
    console.log(`  VACUUM 完成已擦除数据页 | wal_checkpoint(TRUNCATE) | integrity_check: ${ok} | 复验残留: ${left} 行${tail}`);
  };
  if (!execute) {
    // dry-run：在快照副本上统计，绝不碰原库
    const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-dryrun-'));
    let db;
    try {
      db = new DatabaseSync(snapshot(t.file, snapDir, t.profile.replace(/[^\w-]/g, '_')));
      run(db);
    } catch (e) { console.log(`  [跳过] ${e.message}`); }
    finally { try { db && db.close(); } catch {} }
  } else {
    let db;
    try {
      const bdir = path.join(backupDir, `${t.browser}-${t.profile.replace(/[^\w-]/g, '_')}`);
      const bpath = backup(t.file, path.dirname(bdir), path.basename(bdir));
      console.log(`  已备份 → ${bpath}`);
      db = new DatabaseSync(t.file);
      run(db);
    } catch (e) { console.log(`  [失败] ${e.message}`); }
    finally { try { db && db.close(); } catch {} }
  }
  console.log('');
}

// ---- 主流程 ----
running.push(...runningBrowsers());
console.log(execute ? '[模式] 实删（自动备份）' : '[模式] dry-run 预览（不修改任何文件，加 --yes 实删）');
if (running.length) console.log(`[i] 正在运行: ${running.join(', ')}${execute ? ' —— 对应浏览器的写删除将被跳过，请先关闭。' : ''}`);
if (!execute) console.log('[i] Chrome 同步开启时 myactivity.google.com 有云端副本，本地删除不清云端。');

const backupDir = path.join(os.tmpdir(), `history-backup-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`);
const list = targets();
if (!list.length) { console.log('未发现任何浏览器历史库。'); process.exit(0); }
console.log(`目标 "${domain}"，共 ${list.length} 个库（含辅助库）。${execute ? `备份目录: ${backupDir}` : ''}\n`);
for (const t of list) processTarget(t, backupDir);
console.log('[i] 全部完成。云端残留提醒：Chrome 同步开启时需到 myactivity.google.com 单独删除云端记录。');
if (execute) console.log(`[i] 原库备份在 ${backupDir}，确认无误后可删除；如需回滚，关闭浏览器后用备份覆盖原文件即可。`);
