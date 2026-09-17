/**
 * 备份/恢复核心逻辑端到端测试（Node + better-sqlite3 临时库，不依赖 Electron）。
 * 覆盖：全量导出 → 校验和防篡改 → 清库 → 恢复 → 数据逐行一致 → 自增序列 → 事务回滚 → 完整性检查 → 跨库迁移。
 *
 * 运行：node scripts/test-backup.js
 */
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  buildPayload, validatePayload, restorePayload, checkIntegrity, atomicWrite,
} = require('../dist-electron/backup/core.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// ===== 与 app 相同的 schema DDL（CREATE IF NOT EXISTS，重放安全） =====
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, instructor TEXT, semester TEXT, color TEXT DEFAULT '#00FF88', description TEXT, tags TEXT DEFAULT '[]', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '#00FF88', emoji TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS course_requirements (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, title TEXT NOT NULL, type TEXT DEFAULT 'homework', description TEXT, due_date INTEGER NOT NULL, priority INTEGER DEFAULT 2, status TEXT DEFAULT 'pending', estimated_hours REAL, actual_hours REAL, notes TEXT, created_at INTEGER NOT NULL, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS course_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS course_miniprograms (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL UNIQUE, app_type TEXT NOT NULL DEFAULT 'timetable', config_json TEXT DEFAULT '{}', active INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER, location TEXT, recurrence TEXT, course_id INTEGER, color TEXT, notes TEXT, all_day INTEGER DEFAULT 0, reminder_minutes INTEGER, category_id INTEGER, type TEXT DEFAULT 'event', recurrence_end INTEGER, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL);
  CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'active', start_date INTEGER, due_date INTEGER, progress INTEGER DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS project_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, course_id INTEGER, title TEXT NOT NULL, status TEXT DEFAULT 'todo', assignee TEXT, due_date INTEGER, order_index INTEGER DEFAULT 0, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL);
  CREATE TABLE IF NOT EXISTS user_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, wx_openid TEXT UNIQUE, wx_nickname TEXT, wx_avatar TEXT, student_id TEXT, real_name TEXT, school TEXT, college TEXT, major TEXT, class_name TEXT, enroll_year INTEGER, graduate_year INTEGER, program TEXT, degree_level TEXT, custom_fields TEXT DEFAULT '[]', encrypted_fields TEXT, privacy_mode INTEGER DEFAULT 0, is_active INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-backup-test-'));
const dbPath = path.join(tmpDir, 'test.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA);

// ===== 造数据（覆盖全部 10 张表） =====
const T = 1760000000000;
db.prepare(`INSERT INTO courses (id,name,code,instructor,semester,color,description,tags,created_at) VALUES (1,'高等代数','MATH-101','李明','2025-2026-2','#00FF88','代数','["核心课"]',?)`).run(T);
db.prepare(`INSERT INTO courses (id,name,code,instructor,semester,color,created_at) VALUES (2,'数据结构','CS-102','王芳','2025-2026-2','#FFEA00',?)`).run(T + 1);
db.prepare(`INSERT INTO course_requirements (course_id,title,type,due_date,status,notes,created_at) VALUES (1,'作业一','homework',?,'done','第一章',?)`).run(T + 100, T);
db.prepare(`INSERT INTO events (title,start_at,end_at,location,recurrence,course_id,type) VALUES ('周一第一节课',?,?,'理化楼401','WEEKLY',1,'class')`).run(T, T + 5400000);
db.prepare(`INSERT INTO projects (id,name,description,status,created_at) VALUES (1,'期末复习计划','全部科目','active',?)`).run(T);
db.prepare(`INSERT INTO project_tasks (project_id,title,status,assignee,due_date) VALUES (1,'整理错题','done','豆芽',?)`).run(T + 999);
db.prepare(`INSERT INTO categories (name,color,emoji,created_at) VALUES ('考试','#FF3366','📚',?)`).run(T);
db.prepare(`INSERT INTO course_notes (course_id,content,created_at) VALUES (1,'李老师语速快，记得预习',?)`).run(T);
db.prepare(`INSERT INTO course_miniprograms (course_id,app_type,active,created_at,updated_at) VALUES (1,'timetable',1,?,?)`).run(T, T);
db.prepare(`INSERT INTO user_profiles (real_name,student_id,is_active,created_at,updated_at) VALUES ('豆芽','2025xxxx',1,?,?)`).run(T, T);
db.prepare(`INSERT INTO settings (key,value) VALUES ('theme','neon-green'),('semester','2025-2026-2')`).run();

console.log('== 1. 全量导出 ==');
const payload = buildPayload(db, '0.3.0-test');
ok(payload.format === 'taskmanager-backup', 'payload 格式标识正确');
ok(payload.tables.courses.length === 2, `courses 导出 2 行（实际 ${payload.tables.courses.length}）`);
ok(payload.tables.events.length === 1 && payload.tables.events[0].type === 'class', 'events 导出含 class 事件');
ok(Object.keys(payload.tables).length === 10, `导出 10 张表（实际 ${Object.keys(payload.tables).length}）`);
const backupFile = path.join(tmpDir, 'backup.json');
atomicWrite(backupFile, JSON.stringify(payload, null, 2));
ok(fs.existsSync(backupFile) && !fs.readdirSync(tmpDir).some(f => f.includes('.tmp-')), '原子写完成且无临时文件残留');

console.log('== 2. 校验与防篡改 ==');
ok(validatePayload(JSON.parse(fs.readFileSync(backupFile, 'utf8'))).ok, '完整备份通过校验');
const tampered = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
tampered.tables.courses[0].name = '被篡改的课程名';
ok(!validatePayload(tampered).ok, '篡改数据被校验和拦截');
const badSum = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
badSum.checksum = 'deadbeef';
ok(!validatePayload(badSum).ok, '错误校验和被拦截');
const badTable = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
badTable.tables['evil_table; DROP TABLE courses'] = [];
ok(!validatePayload(badTable).ok, '未知表名（注入尝试）被拦截');
const badVersion = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
badVersion.version = 99;
ok(!validatePayload(badVersion).ok, '过高的备份版本被拦截');
ok(!validatePayload({ foo: 1 }).ok, '非备份 JSON 被拦截');

console.log('== 3. 清库 + 换数据 + 恢复 ==');
for (const t of ['course_requirements','events','course_notes','course_miniprograms','courses','project_tasks','projects','user_profiles','categories','settings']) {
  db.prepare(`DELETE FROM "${t}"`).run();
}
db.prepare(`INSERT INTO courses (name,code,created_at) VALUES ('脏数据课程','XX-000',?)`).run(T);
ok(db.prepare(`SELECT COUNT(*) c FROM courses`).get().c === 1, '清库后仅剩脏数据');

const restored = restorePayload(db, payload);
ok(restored.courses === 2 && restored.course_requirements === 1 && restored.events === 1, `恢复计数正确（courses=${restored.courses}, reqs=${restored.course_requirements}, events=${restored.events}）`);
ok(db.prepare(`SELECT COUNT(*) c FROM courses`).get().c === 2, '脏数据被完全替换');
const rowC1 = db.prepare(`SELECT * FROM courses WHERE id = 1`).get();
ok(rowC1 && rowC1.name === '高等代数' && rowC1.instructor === '李明', '课程字段逐行一致（含 id 保留）');
const evt = db.prepare(`SELECT * FROM events`).get();
ok(evt && evt.title === '周一第一节课' && evt.type === 'class' && evt.course_id === 1, '事件字段一致且外键关系保留');
ok(db.prepare(`SELECT COUNT(*) c FROM settings`).get().c === 2, 'settings 恢复');

console.log('== 4. 自增序列 ==');
const newId = db.prepare(`INSERT INTO courses (name,code,created_at) VALUES ('恢复后新增','NEW-1',?)`).run(T).lastInsertRowid;
ok(newId === 3, `恢复后新插入 id=3 不冲突（实际 ${newId}）`);

console.log('== 5. 事务回滚（FK 违规） ==');
const snapshot = db.prepare(`SELECT COUNT(*) c FROM courses`).get().c;
const evil = JSON.parse(JSON.stringify(payload));
evil.tables.course_requirements.push({ id: 999, course_id: 424242, title: '孤儿作业', type: 'homework', due_date: T, priority: 2, status: 'pending', created_at: T });
evil.checksum = crypto.createHash('sha256').update(JSON.stringify(evil.tables), 'utf8').digest('hex');
const v = validatePayload(evil);
ok(v.ok, '构造的孤儿数据备份通过格式校验');
let threw = false;
try { restorePayload(db, v.payload); } catch { threw = true; }
ok(threw, 'FK 违规时恢复抛出异常');
ok(db.prepare(`SELECT COUNT(*) c FROM courses`).get().c === snapshot, `事务回滚：库未改动（仍 ${snapshot} 门课程）`);

console.log('== 6. 完整性检查 ==');
const stats = checkIntegrity(db, dbPath);
ok(stats.integrity === 'ok', `integrity_check = ${stats.integrity}`);
ok(stats.foreignKeyViolations === 0, 'foreign_key_check 零违规');
ok(String(stats.journalMode).toLowerCase() === 'wal', `journal_mode = ${stats.journalMode}`);
ok(stats.tables.courses === 3, `表统计正确（courses=${stats.tables.courses}）`);

console.log('== 7. 跨库迁移模拟（导出 → 全新空库 → 恢复） ==');
const db2 = new Database(path.join(tmpDir, 'test2.db'));
db2.pragma('journal_mode = WAL');
db2.pragma('foreign_keys = ON');
db2.exec(SCHEMA);
restorePayload(db2, buildPayload(db, '0.3.0-test'));
const c1 = db.prepare(`SELECT * FROM courses ORDER BY id`).all();
const c2 = db2.prepare(`SELECT * FROM courses ORDER BY id`).all();
ok(JSON.stringify(c1) === JSON.stringify(c2), '跨库迁移：课程数据逐字段一致');
ok(db2.prepare(`SELECT COUNT(*) c FROM events`).get().c === 1, '跨库迁移：事件一致');
ok(db2.prepare(`SELECT COUNT(*) c FROM user_profiles`).get().c === 1, '跨库迁移：账户一致');

db.close(); db2.close();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
