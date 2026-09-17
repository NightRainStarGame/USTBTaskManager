/**
 * 稳定性故障注入测试（必须用 Electron 内置 Node 运行，因为 better-sqlite3 是 Electron ABI）：
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/test-recovery.js
 *
 * 覆盖场景：
 *  S1 写入中途进程被强杀（模拟崩溃/断电）→ 重开库应完好且已提交数据不丢（WAL 验证）
 *  S2 主库文件损坏 + 存在备份 → 自动隔离 + 从备份恢复
 *  S3 主库文件损坏 + 无备份 → 自动隔离 + 新建空库，应用仍可用
 *  S4 WAL 文件尾部损坏 → SQLite 自动截断无效帧，数据完好
 *  S5 reopenFresh 显式兜底
 */
const { spawn, fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { openWithRecovery, reopenFresh, listBackupCandidates } = require('../dist-electron/db/recovery.js');

const ELECTRON_EXE = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-recovery-'));
const dbPath = path.join(tmp, 'task-manager.db');
const backupsDir = path.join(tmp, 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

function integrityOk(db) {
  const r = db.pragma('integrity_check');
  return Array.isArray(r) && r[0] && r[0].integrity_check === 'ok';
}
function makeDbWithRows(p, n) {
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO courses (name) VALUES (?)');
  const tx = db.transaction((k) => { for (let i = 0; i < k; i++) ins.run('课程' + i); });
  tx(n);
  db.close();
}

// ─────────────────────────────────────────────────────────────
section('S1 写入中途强杀进程（崩溃/断电模拟）');

const childScript = path.join(tmp, 'writer.js');
fs.writeFileSync(childScript, `
  const Database = require(${JSON.stringify(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))});
  const fs = require('node:fs');
  const db = new Database(${JSON.stringify(dbPath)});
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec('CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO courses (name) VALUES (?)');
  const marker = ${JSON.stringify(path.join(tmp, 'marker.txt'))};
  for (let i = 0; i < 500; i++) {
    db.transaction(() => ins.run('行' + i))();   // 每行独立事务
    fs.writeFileSync(marker, String(i + 1));      // 提交后打标
  }
  db.close();
`);
const child = fork(childScript, [], { execPath: ELECTRON_EXE, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });

const markerPath = path.join(tmp, 'marker.txt');
function readMarker() {
  try { return parseInt(fs.readFileSync(markerPath, 'utf8') || '0', 10) || 0; }
  catch { return 0; }
}

// 等子进程真正开始写库（Electron exe 启动较慢），至少提交 20 行后强杀
const waitStart = Date.now();
const killTimer = setInterval(() => {
  const m = readMarker();
  if (m >= 20 || Date.now() - waitStart > 15000) {
    clearInterval(killTimer);
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
    setTimeout(() => runRest(markerPath, tmp, backupsDir), 300);
  }
}, 50);

function runRest(markerPath, tmp, backupsDir) {
  const committed = readMarker();
  const db = new Database(dbPath);
  const count = db.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  assert(integrityOk(db), `强杀后重开库 integrity_check = ok`);
  assert(count >= committed, `已提交数据不丢（提交标记 ${committed} 条，实际恢复 ${count} 条）`);
  db.close();

  // ─────────────────────────────────────────────────────────
  section('S2 主库损坏 + 有备份 → 自动恢复');

  makeDbWithRows(dbPath, 20);
  // 制造一份"备份"（模拟 autoRollingBackup 的产出）
  const backupPath = path.join(backupsDir, 'auto-2026-09-16-1000000000000.db');
  fs.copyFileSync(dbPath, backupPath);

  // 损坏主库前记录基数（S1 已写入 27 行，本节再加 20 行）
  const preDb = new Database(dbPath);
  const preCount = preDb.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  preDb.close(); // Windows 下必须关闭句柄，否则后续 rename 可能失败
  const fd = fs.openSync(dbPath, 'r+');
  fs.writeSync(fd, Buffer.from('THIS IS NOT A SQLITE DATABASE AT ALL!!'));
  fs.closeSync(fd);

  const r2 = openWithRecovery(dbPath, backupsDir);
  assert(r2.outcome === 'restored', `outcome === 'restored'（实际 ${r2.outcome}）`);
  assert(r2.usedBackup === backupPath, `使用了最新备份文件`);
  assert(!!r2.quarantined && fs.existsSync(r2.quarantined), `损坏文件已被隔离保存（${r2.quarantined}）`);
  const c2 = r2.db.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  assert(c2 === preCount, `恢复后数据完整（与备份时一致 ${preCount} 条，实际 ${c2}）`);
  assert(integrityOk(r2.db), `恢复后 integrity_check = ok`);
  r2.db.close();

  // ─────────────────────────────────────────────────────────
  section('S3 主库损坏 + 无备份 → 重建空库');

  const tmp2 = path.join(tmp, 'no-backup');
  fs.mkdirSync(tmp2, { recursive: true });
  const dbPath2 = path.join(tmp2, 'task-manager.db');
  makeDbWithRows(dbPath2, 5);
  const fd2 = fs.openSync(dbPath2, 'r+');
  fs.writeSync(fd2, Buffer.from('GARBAGE GARBAGE GARBAGE GARBAGE!!'));
  fs.closeSync(fd2);

  const r3 = openWithRecovery(dbPath2, null);
  assert(r3.outcome === 'fresh', `outcome === 'fresh'（实际 ${r3.outcome}）`);
  assert(integrityOk(r3.db), `新建空库 integrity_check = ok`);
  assert(!!r3.quarantined && fs.existsSync(r3.quarantined), `损坏原文件已隔离，数据可事后找回`);
  r3.db.close();

  // ─────────────────────────────────────────────────────────
  section('S4 WAL 文件尾部损坏 → 自动截断无效帧');

  const dbPath3 = path.join(tmp, 'wal-test.db');
  makeDbWithRows(dbPath3, 10);
  // 关闭后追加垃圾到 -wal（SQLite 校验和失败会忽略这些帧）
  fs.appendFileSync(dbPath3 + '-wal', Buffer.alloc(4096, 0xAB));
  const db4 = new Database(dbPath3);
  const c4 = db4.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  assert(integrityOk(db4), `WAL 尾部损坏后 integrity_check = ok`);
  assert(c4 === 10, `数据完好（10 条，实际 ${c4}）`);
  db4.close();

  // ─────────────────────────────────────────────────────────
  section('S5 损坏备份被跳过，选用次新的有效备份');

  const bd = path.join(tmp, 'backups2');
  fs.mkdirSync(bd, { recursive: true });
  const good = path.join(bd, 'auto-2026-09-15-1000000000000.db');
  makeDbWithRows(good, 7);
  const bad = path.join(bd, 'auto-2026-09-16-1000000000000.db');
  fs.writeFileSync(bad, Buffer.alloc(4096, 0xFF)); // 损坏的新备份
  assert(listBackupCandidates(bd).length === 2, `备份候选识别正确`);
  const dbPath4 = path.join(tmp, 's5.db');
  fs.writeFileSync(dbPath4, 'not a database');
  const r5 = openWithRecovery(dbPath4, bd);
  assert(r5.outcome === 'restored', `跳过损坏备份，用次新备份恢复（outcome=${r5.outcome}）`);
  assert(r5.usedBackup === good, `最终选用的是有效备份`);
  const c5 = r5.db.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  assert(c5 === 7, `次新备份数据完整（7 条，实际 ${c5}）`);
  r5.db.close();

  // ─────────────────────────────────────────────────────────
  section('S6 reopenFresh 显式兜底');

  const dbPath5 = path.join(tmp, 's6.db');
  makeDbWithRows(dbPath5, 3);
  const r6 = reopenFresh(dbPath5);
  assert(r6.outcome === 'fresh' && integrityOk(r6.db), `强制重建返回健康空库`);
  assert(!!r6.quarantined, `旧文件被隔离而非删除`);
  r6.db.close();

  // ─────────────────────────────────────────────────────────
  console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(fail ? 1 : 0);
}
