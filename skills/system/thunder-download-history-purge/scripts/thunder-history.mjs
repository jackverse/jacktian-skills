#!/usr/bin/env node
// thunder-history.mjs — 迅雷下载记录的只读审计与彻底清理（零依赖，需 Node >= 22）
//
// 用法（必须带 --experimental-sqlite，否则 import node:sqlite 直接报错）：
//   node --experimental-sqlite thunder-history.mjs --audit [--domain <关键字>] [--dat <TaskDb.dat 路径>]
//   node --experimental-sqlite thunder-history.mjs --purge [--yes] [--domain <关键字>] [--dat <TaskDb.dat 路径>]
//
//   --audit   只读审计：快照复制到 %TEMP% 后分析，绝不碰原库
//   --purge   清理：默认 dry-run 只打计划；--yes 才真正执行（自动先备份到 %TEMP%）
//   --domain  报告截图里的域名/关键字（如 pan.baidu.com），审计出明细、清理后做字节级复验
//   --dat     显式指定 TaskDb.dat 路径；不传则自动扫常见安装路径
//
// 处理范围：TaskDb.dat + TaskDbEx.dat（同构库）+ Profiles\historys.json
// 不碰：C:\ProgramData\Thunder Network（升级组件文件）与 %APPDATA%\thunder（leveldb 缓存），只打印提示

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
function argOf(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
const MODE = args.includes('--audit') ? 'audit' : args.includes('--purge') ? 'purge' : null;
const DOMAIN = argOf('--domain');
const DAT_ARG = argOf('--dat');
const YES = args.includes('--yes');

if (!MODE) {
  console.error('用法: node --experimental-sqlite thunder-history.mjs --audit|--purge [--domain 关键字] [--dat TaskDb.dat路径] [--yes]');
  process.exit(2);
}

// ---------- node:sqlite 动态加载（没带 flag 时给出可读提示） ----------
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('node:sqlite 加载失败：Node 22 需加 --experimental-sqlite 标志重跑。');
  process.exit(2);
}

// ---------- 工具 ----------
function findTaskDb() {
  if (DAT_ARG) {
    if (!fs.existsSync(DAT_ARG)) { console.error(`--dat 路径不存在: ${DAT_ARG}`); process.exit(2); }
    return DAT_ARG;
  }
  const candidates = [];
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    for (const base of ['Program Files', 'Program Files (x86)']) {
      candidates.push(`${drive}\\${base}\\Thunder Network`);
    }
  }
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          // 跳过明显无关的大目录
          if (!/^(baidunetdisk|cache|data|extension|skins|users|addons)$/i.test(e.name)) stack.push(p);
        } else if (e.name === 'TaskDb.dat') {
          return p;
        }
      }
    }
  }
  console.error('未在常见路径找到 TaskDb.dat，请用 --dat 显式指定（迅雷安装目录\\Profiles\\TaskDb.dat）。');
  process.exit(2);
}

// 迅雷进程检查：主进程 Thunder.exe + XL 系后台（XLLiveUD/XLServicePlatform 等）。
// 注意 tasklist 过滤 thunder|xunlei 会漏掉 XL 前缀的迅雷后台组件，必须把 ^xl 也算上。
function checkThunderProcesses() {
  let names = [];
  try {
    const out = execSync('tasklist /fo csv /nh', { maxBuffer: 16 * 1024 * 1024 }).toString('latin1');
    for (const m of out.matchAll(/^"([^"]+\.exe)"/gim)) names.push(m[1]);
  } catch (e) {
    console.warn(`[warn ] tasklist 执行失败（${e.message.split('\n')[0]}），跳过进程检查`);
    return [];
  }
  return names.filter((n) => /^(thunder|xunlei|xl)/i.test(n));
}

function copySnapshot(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  fs.copyFileSync(src, dest);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const side = src + suffix;
    if (fs.existsSync(side)) fs.copyFileSync(side, dest + suffix);
  }
  return dest;
}

function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}

function tableRowCount(db, t) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${JSON.stringify(t).replace(/"/g, '"')}`).get().c;
  } catch {
    return -1; // 视图/虚拟表等不可查询对象
  }
}

function yearDistribution(db, table = 'TaskBase', col = 'CreationTime') {
  // CreationTime 为 unix 毫秒；0/NULL 归"未知"
  try {
    return db
      .prepare(
        `SELECT CASE WHEN ${col} IS NULL OR ${col} = 0 THEN '未知'
                ELSE strftime('%Y', ${col}/1000, 'unixepoch', 'localtime') END AS y,
              COUNT(*) AS c
         FROM ${table} GROUP BY y ORDER BY y`
      )
      .all();
  } catch (e) {
    console.warn(`[warn ] 年份分布统计失败(${e.message.split('\n')[0]})`);
    return [];
  }
}

function domainMatches(db, domain, table = 'TaskBase', limit = 20) {
  try {
    return db
      .prepare(
        `SELECT Url, Name, datetime(CreationTime/1000, 'unixepoch', 'localtime') AS t, SavePath
           FROM ${table} WHERE Url LIKE ? ORDER BY CreationTime DESC LIMIT ${limit}`
      )
      .all(`%${domain}%`);
  } catch (e) {
    console.warn(`[warn ] 域名匹配失败(${e.message.split('\n')[0]})`);
    return [];
  }
}

// 清理清单：任务/记录相关表全删；Module/Category 等配置表保留（迅雷启动自动重建空库不依赖它们有数据）
const PURGE_TABLES_EXACT = [
  'TaskBase', 'P2spTask', 'BtTask', 'EmuleTask', 'BtFile', 'GroupTask', 'ThunderPanTask',
  'PlayList', 'CloudAddFail', 'PanPluginUploadHistory', 'group_search_history', 'user_file',
];
const PURGE_TABLE_GLOB = ['message_*', 'AccelerateTaskMap*']; // GLOB 匹配

function purgeTargets(db) {
  const tables = listTables(db);
  const hit = [];
  for (const t of tables) {
    if (PURGE_TABLES_EXACT.some((x) => x.toLowerCase() === t.toLowerCase())) hit.push(t);
    else if (PURGE_TABLE_GLOB.some((g) => {
      const re = new RegExp('^' + g.replace(/\*/g, '.*') + '$', 'i');
      return re.test(t);
    })) hit.push(t);
  }
  return hit;
}

// 字节级复验：在文件里搜关键字（该库是 SQLite/UTF-8，但顺带查 UTF-16LE 双保险）
function byteGrep(file, keyword) {
  if (!keyword) return { utf8: -1, utf16le: -1 };
  const buf = fs.readFileSync(file);
  const k8 = Buffer.from(keyword, 'utf8');
  const k16 = Buffer.from(keyword, 'utf16le');
  let c8 = 0, c16 = 0, idx = 0;
  while ((idx = buf.indexOf(k8, idx)) !== -1) { c8++; idx += k8.length; }
  idx = 0;
  while ((idx = buf.indexOf(k16, idx)) !== -1) { c16++; idx += k16.length; }
  return { utf8: c8, utf16le: c16 };
}

function jsonOverview(file, domain) {
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { broken: true }; }
  const urls = Object.keys(data);
  const matched = urls.filter((u) => (domain ? u.toLowerCase().includes(domain.toLowerCase()) : false));
  return { total: urls.length, matched: domain ? matched : urls.slice(0, 10), matchedCount: domain ? matched.length : urls.length, sample: urls.slice(0, 5) };
}

function otherLocationsHint() {
  console.log('\n== 其他迅雷痕迹位置（脚本不处理，按需人工核查）==');
  console.log('- C:\\ProgramData\\Thunder Network\\  : 升级组件 XLLiveUD 的下载记录/补丁包文件');
  console.log('- %APPDATA%\\thunder\\               : 新版客户端 Chromium 内核缓存（leveldb，含内置页面访问痕迹）');
  console.log('- 迅雷账号云端：本地清理不动服务器侧数据，云盘文件与账号任务记录仍在云端');
}

// ---------- 定位文件 ----------
const taskDb = findTaskDb();
const profilesDir = path.dirname(taskDb);
const taskDbEx = path.join(profilesDir, 'TaskDbEx.dat');
const historysJson = path.join(profilesDir, 'historys.json');
const datFiles = [taskDb, ...(fs.existsSync(taskDbEx) ? [taskDbEx] : [])];

console.log('== 目标文件 ==');
for (const f of datFiles) console.log(`- ${f} (${fs.existsSync(f) ? fs.statSync(f).size : '不存在'})`);
if (fs.existsSync(historysJson)) console.log(`- ${historysJson} (${fs.statSync(historysJson).size})`);

// ---------- 进程检查 ----------
const procs = checkThunderProcesses();
if (procs.length) {
  console.log('\n== 进程检查 ==');
  console.log(`迅雷相关进程仍在运行: ${[...new Set(procs)].join(', ')}`);
  if (MODE === 'purge') {
    console.error('清理前必须完全退出迅雷（含托盘退出与 XL 系后台组件）。请自行退出后重跑。');
    process.exit(3);
  }
  console.log('[warn ] 审计使用快照副本可继续，但最新记录可能未落盘，且建议退出后重跑以获得完整快照。');
} else {
  console.log('\n== 进程检查 == 未发现迅雷/XL 系进程');
}

// ---------- 审计模式 ----------
if (MODE === 'audit') {
  const snapRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thunder-audit-'));
  const snapProfiles = path.join(snapRoot, 'Profiles');
  fs.mkdirSync(snapProfiles, { recursive: true });
  console.log(`\n== 快照 == ${snapRoot}`);
  const snaps = [];
  for (const f of datFiles) if (fs.existsSync(f)) snaps.push(copySnapshot(f, snapProfiles));

  for (const snap of snaps) {
    const db = new DatabaseSync(snap, { readOnly: true });
    console.log(`\n---- ${path.basename(snap)} 表清单（行数）----`);
    for (const t of listTables(db)) {
      const c = tableRowCount(db, t);
      if (c > 0) console.log(`  ${t}: ${c}`);
    }
    if (listTables(db).some((t) => t.toLowerCase() === 'taskbase')) {
      console.log(`\n---- TaskBase 年份分布 ----`);
      for (const r of yearDistribution(db)) console.log(`  ${r.y}: ${r.c}`);
      if (DOMAIN) {
        console.log(`\n---- Url 含 "${DOMAIN}" 的明细（前 20 条）----`);
        const rows = domainMatches(db, DOMAIN);
        if (!rows.length) console.log('  （无匹配）');
        for (const r of rows) console.log(`  [${r.t}] ${r.Name || '(无名)'}\n      ${r.Url}\n      -> ${r.SavePath || '?'}`);
      }
    }
    db.close();
  }

  const overview = jsonOverview(historysJson, DOMAIN);
  if (overview) {
    console.log(`\n---- historys.json ----`);
    if (overview.broken) console.log('  解析失败（非 JSON 或损坏）');
    else {
      console.log(`  共 ${overview.total} 条内置浏览器历史`);
      if (DOMAIN) {
        console.log(`  匹配 "${DOMAIN}": ${overview.matchedCount} 条`);
        for (const u of overview.matched.slice(0, 10)) console.log(`    ${u}`);
      } else {
        console.log(`  样例: ${overview.sample.join(' | ')}`);
      }
    }
  }
  otherLocationsHint();
  console.log(`\n快照保留在 ${snapRoot}，审计完成后可自行删除。`);
  process.exit(0);
}

// ---------- 清理模式 ----------
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupRoot = path.join(os.tmpdir(), `thunder-backup-${stamp}`);
fs.mkdirSync(backupRoot, { recursive: true });
console.log(`\n== 备份 == ${backupRoot}`);
for (const f of [...datFiles, ...(fs.existsSync(historysJson) ? [historysJson] : [])]) {
  copySnapshot(f, backupRoot);
}

const plan = [];
for (const f of datFiles) {
  if (!fs.existsSync(f)) continue;
  const db = new DatabaseSync(f, { readOnly: true });
  const targets = purgeTargets(db);
  const rows = targets.map((t) => ({ table: t, count: tableRowCount(db, t) }));
  plan.push({ file: f, rows });
  db.close();
}

console.log('\n== 清理计划 ==');
for (const p of plan) {
  console.log(`---- ${path.basename(p.file)} ----`);
  for (const r of p.rows) console.log(`  DELETE ${r.table} (${r.count} 行)`);
  console.log('  （Module/Category 等配置表保留不动）');
}

if (!YES) {
  console.log('\n[dry-run] 以上为计划，未做任何改动。确认后加 --yes 执行。');
  process.exit(0);
}

// 真正执行
const beforeSizes = new Map(datFiles.filter(fs.existsSync).map((f) => [f, fs.statSync(f).size]));
console.log('\n== 执行删除 ==');
for (const p of plan) {
  const db = new DatabaseSync(p.file);
  try {
    db.exec('BEGIN');
    for (const r of p.rows) {
      try {
        const res = db.prepare(`DELETE FROM ${JSON.stringify(r.table).replace(/"/g, '"')}`).run();
        console.log(`  ${path.basename(p.file)} :: ${r.table} 删除 ${res.changes} 行`);
      } catch (e) {
        console.warn(`  [warn ] ${r.table} 删除失败: ${e.message.split('\n')[0]}`);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 忽略回滚失败 */ }
    console.error(`  事务失败回滚: ${e.message}`);
    process.exit(4);
  }
  console.log(`  ${path.basename(p.file)} :: VACUUM ...`);
  db.exec('VACUUM'); // 删行只是标记空闲页，不 VACUUM 数据仍在文件里，等于没删
  db.close();
}

// historys.json 写回空对象
if (fs.existsSync(historysJson)) {
  fs.writeFileSync(historysJson, '{}', 'utf8');
  console.log(`\n== historys.json == 已写回 {}`);
}

// 复验
console.log('\n== 复验 ==');
let pass = true;
for (const p of plan) {
  const db = new DatabaseSync(p.file, { readOnly: true });
  const left = p.rows.map((r) => ({ t: r.table, c: tableRowCount(db, r.table) })).filter((x) => x.c > 0);
  if (left.length) {
    pass = false;
    console.log(`  [FAIL] ${path.basename(p.file)} 残留: ${left.map((x) => `${x.t}=${x.c}`).join(', ')}`);
  } else {
    console.log(`  [OK] ${path.basename(p.file)} 清理清单表行数全为 0`);
  }
  db.close();
  const after = fs.statSync(p.file).size;
  const before = beforeSizes.get(p.file) ?? after;
  console.log(`  体积 ${before} -> ${after} 字节${after < before ? '（已收缩）' : '（小库可能仍在页边界内不缩体积，残留以字节搜索为准）'}`);
  if (DOMAIN) {
    const hits = byteGrep(p.file, DOMAIN);
    console.log(`  字节级搜索 "${DOMAIN}": utf8=${hits.utf8}, utf16le=${hits.utf16le} ${hits.utf8 === 0 && hits.utf16le === 0 ? '[OK] 零残留' : (pass = false, '[FAIL] 仍有字节残留')}`);
  }
}

otherLocationsHint();
console.log(`
== 收尾提示 ==
- 备份（含全部敏感记录）保留在 ${backupRoot}，确认清理效果后请自行删除。
- 迅雷下次启动会自动重建空任务库，不影响使用；新下载会重新积累记录。
- 若检查工具做磁盘残留级取证（已删文件恢复）：删库+VACUUM 只覆盖当前文件内数据页，
  文件系统层旧副本需 cipher /w:X:（对所在盘全盘空闲空间覆写，耗时较长）等手段处理。
- 云端残留：迅雷账号服务器侧的云盘文件/任务记录不受本地清理影响，需在迅雷客户端/网页端另行处理。`);
process.exit(pass ? 0 : 5);
