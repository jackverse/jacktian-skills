#!/usr/bin/env node
// scan.mjs — 浏览器上网历史只读审计（绝不写原库：一律在 %TEMP% 快照副本上分析）
// 用法: node --experimental-sqlite scan.mjs [--domain example.com] [--browser all|chrome|edge|firefox] [--profile <名称>]
// Node >= 22（v22 必须带 --experimental-sqlite；v23+ 已默认启用）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

// ---- node:sqlite 动态加载（兼容无 flag 的旧调用方式，给出明确提示）----
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('[x] 当前 Node 不含 node:sqlite。Node 22 请加 flag 运行: node --experimental-sqlite scan.mjs');
  process.exit(1);
}

// ---- 参数 ----
const argv = process.argv.slice(2);
function argOf(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const domain = argOf('--domain', '');
const browser = argOf('--browser', 'all');      // all | chrome | edge | firefox
const profileFilter = argOf('--profile', '');   // 过滤 Profile 目录名（可含空格）

// LIKE 通配转义，配 SQL 里 ESCAPE '\' 使用
const likeParam = `%${domain.replace(/[\\%_]/g, '\\$&')}%`;

// ---- 浏览器进程检测（引号精确匹配，避免撞上 msedgewebview2.exe——它不锁浏览器历史库）----
const BROWSER_PROCS = { chrome: 'chrome.exe', edge: 'msedge.exe', firefox: 'firefox.exe' };
function runningBrowsers() {
  const found = [];
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 15000 }).toLowerCase();
    for (const [b, img] of Object.entries(BROWSER_PROCS)) if (out.includes(`"${img}"`)) found.push(b);
  } catch { /* tasklist 失败时按"未检测到"处理 */ }
  return found;
}

// ---- Profile 枚举：不按名字猜，"目录下存在库文件"就纳入 ----
function chromeTargets(name, userDataRoot) {
  const out = [];
  if (!fs.existsSync(userDataRoot)) return out;
  for (const d of fs.readdirSync(userDataRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const hist = path.join(userDataRoot, d.name, 'History');
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
    const places = path.join(root, d.name, 'places.sqlite');
    if (fs.existsSync(places)) out.push({ browser: 'firefox', profile: d.name, file: places, kind: 'firefox-places' });
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
  return t.filter((x) => !profileFilter || x.profile.toLowerCase().includes(profileFilter.toLowerCase()));
}

// ---- 快照复制（db + -wal + -shm 一起拷，否则最近写入丢失）----
function snapshot(src, dir, tag) {
  const base = path.basename(src);
  const dest = path.join(dir, `${tag}__${base}`);
  fs.copyFileSync(src, dest);
  for (const ext of ['-wal', '-shm', '-journal']) {
    const s = src + ext;
    if (fs.existsSync(s)) fs.copyFileSync(s, dest + ext);
  }
  return dest;
}

// ---- 时间戳换算（必须 BigInt 读取，Number(1.3e17) 已超 2^53）----
const chromeToMs = (us) => Number(us / 1000n) - 11644473600000; // 1601 纪元微秒
const unixToMs = (us) => Number(us / 1000n);                    // Firefox PRTime
function fmt(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
function hostOf(u) {
  try { return new URL(u).hostname; } catch { return u.slice(0, 40); }
}
function setBigInt(stmt) {
  try { stmt.setReadBigInts(true); } catch { /* 旧构建无此 API */ }
  return stmt;
}
function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name);
}
function urlishCols(db, table) {
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
    .map((c) => c.name)
    .filter((n) => ['url', 'page_url', 'tab_url', 'original_url', 'top_level_url', 'frame_url', 'icon_url'].includes(n.toLowerCase()));
}

// ---- Chrome/Edge History 审计 ----
function auditChrome(db, label, dom) {
  const urlsTotal = db.prepare('SELECT COUNT(*) n FROM urls').get().n;
  const visitsTotal = db.prepare('SELECT COUNT(*) n FROM visits').get().n;
  const span = setBigInt(db.prepare('SELECT MIN(visit_time) a, MAX(visit_time) b FROM visits')).get();
  console.log(`  urls: ${urlsTotal} 条 | visits: ${visitsTotal} 条`);
  if (span && span.a) console.log(`  时间跨度: ${fmt(chromeToMs(span.a))} ~ ${fmt(chromeToMs(span.b))}`);

  // Top 域名（按 Chrome 自身 visit_count 计数）
  const top = db.prepare('SELECT url, visit_count vc FROM urls ORDER BY visit_count DESC LIMIT 15').all();
  console.log('  Top 域名(按 visit_count):');
  for (const r of top) console.log(`    ${String(r.vc ?? 0).padStart(6)}  ${hostOf(r.url)}`);

  if (dom) {
    const st = db.prepare('SELECT id, url, title, visit_count vc, last_visit_time lvt FROM urls WHERE url LIKE ? ESCAPE \'\\\' ORDER BY last_visit_time DESC');
    setBigInt(st);
    const matched = st.all(likeParam);
    console.log(`  [匹配 ${dom}] urls 命中 ${matched.length} 条:`);
    for (const r of matched.slice(0, 15)) console.log(`    [${fmt(r.lvt ? chromeToMs(r.lvt) : NaN)}] vc=${r.vc ?? 0} ${r.url} ${r.title ? '「' + String(r.title).slice(0, 40) + '」' : ''}`);
    if (matched.length > 15) console.log(`    ... 其余 ${matched.length - 15} 条略`);
    const vSt = db.prepare('SELECT COUNT(*) n FROM visits WHERE url IN (SELECT id FROM urls WHERE url LIKE ? ESCAPE \'\\\')');
    console.log(`  [匹配 ${dom}] visits 命中 ${vSt.get(likeParam).n} 条`);
    if (tableExists(db, 'keyword_search_terms')) {
      const n = db.prepare("SELECT COUNT(*) n FROM keyword_search_terms WHERE url_id IN (SELECT id FROM urls WHERE url LIKE ? ESCAPE '\\')").get(likeParam).n;
      if (n > 0) {
        console.log(`  [匹配 ${dom}] keyword_search_terms 命中 ${n} 条(搜索词明文):`);
        const terms = db.prepare("SELECT term FROM keyword_search_terms WHERE url_id IN (SELECT id FROM urls WHERE url LIKE ? ESCAPE '\\') LIMIT 10").all(likeParam);
        for (const t of terms) console.log(`    搜索词: ${t.term}`);
      }
    }
    // 兜底：逐表扫 url-like 列的残留命中
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of tables) for (const c of urlishCols(db, t.name)) {
      const n = db.prepare(`SELECT COUNT(*) n FROM ${JSON.stringify(t.name)} WHERE ${JSON.stringify(c)} LIKE ? ESCAPE '\\'`).get(likeParam).n;
      if (n > 0) console.log(`  [兜底扫描] ${t.name}.${c} 命中 ${n} 条`);
    }
  }
}

// ---- Firefox places.sqlite 审计（列名按 schema 动态取：新版是 last_visit_date，旧版是 last_visit_time）----
function auditFirefox(db, label, dom) {
  const pCols = columnsOf(db, 'moz_places');
  const total = db.prepare('SELECT COUNT(*) n FROM moz_places').get().n;
  const visTotal = db.prepare('SELECT COUNT(*) n FROM moz_historyvisits').get().n;
  const span = setBigInt(db.prepare('SELECT MIN(visit_date) a, MAX(visit_date) b FROM moz_historyvisits')).get();
  console.log(`  moz_places: ${total} 条 | moz_historyvisits: ${visTotal} 条`);
  if (span && span.a) console.log(`  时间跨度: ${fmt(unixToMs(span.a))} ~ ${fmt(unixToMs(span.b))}`);
  const top = db.prepare('SELECT url, visit_count vc FROM moz_places ORDER BY visit_count DESC LIMIT 15').all();
  console.log('  Top 域名(按 visit_count):');
  for (const r of top) console.log(`    ${String(r.vc ?? 0).padStart(6)}  ${hostOf(r.url)}`);
  if (dom) {
    const lvd = pCols.find((c) => c.toLowerCase() === 'last_visit_date') || pCols.find((c) => c.toLowerCase() === 'last_visit_time');
    const st = db.prepare(`SELECT id, url, title, visit_count vc${lvd ? ', ' + JSON.stringify(lvd) + ' lvt' : ', NULL lvt'} FROM moz_places WHERE url LIKE ? ESCAPE '\\' ORDER BY ${lvd ? JSON.stringify(lvd) : 'id'} DESC`);
    setBigInt(st);
    const matched = st.all(likeParam);
    console.log(`  [匹配 ${dom}] moz_places 命中 ${matched.length} 条:`);
    for (const r of matched.slice(0, 15)) console.log(`    [${fmt(r.lvt ? unixToMs(r.lvt) : NaN)}] vc=${r.vc ?? 0} ${r.url}`);
    if (matched.length > 15) console.log(`    ... 其余 ${matched.length - 15} 条略`);
  }
}

// ---- 主流程 ----
const running = runningBrowsers();
if (running.length) console.log(`[i] 检测到正在运行: ${running.join(', ')} —— 审计基于快照副本，最近几秒的记录可能未落盘；写删除需先关闭浏览器。`);
else console.log('[i] 未检测到浏览器主进程在运行。');

const all = targets();
if (!all.length) { console.log('未发现任何浏览器历史库。'); process.exit(0); }
console.log(`发现 ${all.length} 个历史库，逐库快照审计中...\n`);

const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-scan-'));
let opened = 0;
for (const t of all) {
  const label = `${t.browser} [${t.profile}] ${path.basename(t.file)}`;
  console.log(`== ${label}`);
  let snap;
  try { snap = snapshot(t.file, snapDir, `${t.browser}-${t.profile.replace(/[^\w-]/g, '_')}`); }
  catch (e) { console.log(`  [跳过] 复制失败: ${e.message}`); continue; }
  let db;
  try { db = new DatabaseSync(snap); }
  catch {
    // sidecar 不匹配等导致打不开时，退化只拷主文件（可能缺最近记录）
    try { db = new DatabaseSync(snapshot(t.file, snapDir, `bare-${t.profile.replace(/[^\w-]/g, '_')}`)); }
    catch (e2) { console.log(`  [跳过] 打开快照失败: ${e2.message}`); continue; }
  }
  try {
    opened++;
    if (t.kind === 'chrome-history') auditChrome(db, label, domain);
    else auditFirefox(db, label, domain);
  } finally { try { db.close(); } catch {} }
  console.log('');
}
console.log(`审计完成：${opened}/${all.length} 个库成功分析（快照目录 ${snapDir}，可直接删除）。`);
if (domain) {
  console.log(`[i] 如需删除匹配记录，先关闭浏览器，再运行:\n    node --experimental-sqlite delete.mjs --domain ${domain} --yes`);
}
console.log('[i] Chrome 同步开启时 myactivity.google.com 有云端副本，本地操作不清云端。');
