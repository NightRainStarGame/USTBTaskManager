import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { openWithRecovery, reopenFresh } from './recovery';

/** 作业码同款字符表（31 字符，避开 0/O/1/I/L）——courseKey 也用它，风格统一 */
const KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * v1.1.7：课程通用固定 ID（courseKey）。
 * 确定性派生：同名 + 同授课老师（忽略大小写/空白差异）在**任何设备**上算出同一个 ID。
 * 老师未设置时用空串参与哈希（同名无老师的课程彼此视为同一门）。
 * 格式：CK- + 10 位字母表编码，例 "CK-K7M3XA2QP9"。
 */
export function computeCourseKey(name: string, instructor?: string | null): string {
  const norm = (s?: string | null) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const basis = `${norm(name)}|${norm(instructor)}`;
  const digest = createHash('sha256').update(`staros-course-key-v1:${basis}`).digest();
  let out = 'CK-';
  for (let i = 0; i < 10; i++) out += KEY_ALPHABET[digest[i] % KEY_ALPHABET.length];
  return out;
}

/**
 * v1.1.7：全量重算 courses.course_key（幂等）。
 * 在迁移时与每次课程增删改后调用，兜住所有建课路径（手建 / 教务导入 / 课表导入）。
 * 返回本次实际更新的行数（多数时候为 0）。
 */
export function refreshCourseKeys(db: Database.Database): number {
  const rows = db.prepare('SELECT id, name, instructor, course_key FROM courses').all() as Array<{
    id: number; name: string; instructor?: string | null; course_key?: string | null;
  }>;
  const upd = db.prepare('UPDATE courses SET course_key = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const key = computeCourseKey(r.name, r.instructor);
    if (r.course_key !== key) { upd.run(key, r.id); n++; }
  }
  return n;
}

let dbInstance: Database.Database | null = null;
let dbPath = '';
let startupRecovery: import('./recovery').RecoveryResult | null = null;

/** 启动期恢复信息（供 UI 展示"已从备份恢复"等提示；正常启动为 normal） */
export function getStartupRecovery() {
  return startupRecovery;
}

function applyPragmas(db: Database.Database) {
  // WAL：写不阻塞读，崩溃后自动恢复；NORMAL：WAL 推荐档，断电最多丢最后一个事务而不损坏库
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // 多进程/异常并发访问时等待而非立刻报 SQLITE_BUSY
  db.pragma('busy_timeout = 5000');
}

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  dbPath = path.join(userDataDir, 'task-manager.db');
  const backupsDir = path.join(userDataDir, 'backups');

  // 打开（含损坏自动恢复：隔离损坏文件 → 尝试最近备份 → 兜底新建空库）
  const result = openWithRecovery(dbPath, backupsDir);
  startupRecovery = result;
  dbInstance = result.db;
  applyPragmas(dbInstance);

  try {
    runMigrations(dbInstance);
    seedDefaults(dbInstance);
  } catch (e) {
    // 迁移失败（极端情况：文件能过 quick_check 但结构异常）→ 最后兜底重建
    try { dbInstance.close(); } catch { /* ignore */ }
    const fresh = reopenFresh(dbPath);
    startupRecovery = { ...fresh, error: `迁移失败已重建空库: ${e instanceof Error ? e.message : String(e)}` };
    dbInstance = fresh.db;
    applyPragmas(dbInstance);
    runMigrations(dbInstance);
    seedDefaults(dbInstance);
  }

  // 每日自动滚动备份（异步、失败不影响启动；保留最近 7 份）
  import('../backup').then(({ autoRollingBackup }) =>
    autoRollingBackup(dbInstance!).catch(() => { /* 备份失败不阻塞启动 */ })
  );

  return dbInstance;
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
}

export function getDbPath(): string {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbPath;
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT,
      instructor TEXT,
      semester TEXT,
      color TEXT DEFAULT '#00FF88',
      description TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS course_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT CHECK(type IN ('homework','exam','project','reading','other')) DEFAULT 'homework',
      description TEXT,
      due_date INTEGER NOT NULL,
      priority INTEGER DEFAULT 2,
      status TEXT DEFAULT 'pending',
      estimated_hours REAL,
      actual_hours REAL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER,
      location TEXT,
      recurrence TEXT,
      course_id INTEGER,
      color TEXT,
      notes TEXT,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      start_date INTEGER,
      due_date INTEGER,
      progress INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      course_id INTEGER,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'todo',
      assignee TEXT,
      due_date INTEGER,
      order_index INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 分类表（先建，让 events.category_id 可以安全引用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#00FF88',
      emoji TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // 课程备注（多段时间戳备注）
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  );
`);

  // 用户资料表（支持多账户切换、隐私模式加密字段）
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wx_openid TEXT UNIQUE,
      wx_nickname TEXT,
      wx_avatar TEXT,
      student_id TEXT,
      real_name TEXT,
      school TEXT,
      college TEXT,
      major TEXT,
      class_name TEXT,
      enroll_year INTEGER,
      graduate_year INTEGER,
      program TEXT,
      degree_level TEXT,
      custom_fields TEXT DEFAULT '[]',
      encrypted_fields TEXT,
      privacy_mode INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 迁移：本地账号密码列（替代早期"微信扫码"占位方案）
  addColumnIfMissing(db, 'user_profiles', 'username', 'TEXT');
  addColumnIfMissing(db, 'user_profiles', 'password_hash', 'TEXT');

  // 课程小程序配置（每门课可挂不同自制小程序）
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_miniprograms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL UNIQUE,
      app_type TEXT NOT NULL DEFAULT 'timetable',
      config_json TEXT DEFAULT '{}',
      active INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // courses 表新增标签字段
  addColumnIfMissing(db, 'courses', 'tags', "TEXT DEFAULT '[]'");

  // v1.1.6：课程 guid（作业同步精确挂载——同名课程靠它区分，发布包带上 courseGuid）
  addColumnIfMissing(db, 'courses', 'guid', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_guid ON courses(guid) WHERE guid IS NOT NULL`);
  {
    // 存量课程回填 8 位 guid（C- 前缀 + 作业码同款字符表，避开 0/O/1/I/L）
    const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const rows = db.prepare(`SELECT id FROM courses WHERE guid IS NULL OR TRIM(guid) = ''`).all() as Array<{ id: number }>;
    if (rows.length) {
      const upd = db.prepare('UPDATE courses SET guid = ? WHERE id = ?');
      for (const r of rows) {
        let g = 'C-';
        for (let i = 0; i < 8; i++) g += ALPHA[Math.floor(Math.random() * ALPHA.length)];
        upd.run(g, r.id);
      }
    }
  }

  // v1.1.7：课程通用固定 ID（courseKey）——同名同授课老师的课程在所有设备上算出
  // 同一个确定性 ID，作业发布/接收凭它精确挂载，不再依赖每台设备随机生成的 guid。
  addColumnIfMissing(db, 'courses', 'course_key', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_courses_course_key ON courses(course_key)`);
  refreshCourseKeys(db);

  // 增量迁移：events 表新增字段（向后兼容老数据库）
  // 注意：SQLite ALTER TABLE ADD COLUMN 不支持外键约束，这里只做纯 INTEGER 字段
  addColumnIfMissing(db, 'events', 'all_day', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'events', 'reminder_minutes', 'INTEGER');
  addColumnIfMissing(db, 'events', 'category_id', 'INTEGER');
  addColumnIfMissing(db, 'events', 'type', "TEXT DEFAULT 'event'");
  addColumnIfMissing(db, 'events', 'recurrence_end', 'INTEGER');
  addColumnIfMissing(db, 'course_miniprograms', 'active', 'INTEGER DEFAULT 0');

  // 关键修复：course_requirements.notes 列缺失会导致「添加作业」直接报 no such column
  addColumnIfMissing(db, 'course_requirements', 'notes', 'TEXT');
  // 老库补 description（新表定义里已有）
  addColumnIfMissing(db, 'course_requirements', 'description', 'TEXT');
  addColumnIfMissing(db, 'course_requirements', 'estimated_hours', 'REAL');
  addColumnIfMissing(db, 'course_requirements', 'actual_hours', 'REAL');

  // 作业同步（GitHub 发布 / 同步）：来源标记 + 远端条目 ID + 上课日期 + 发布人
  // source: 'local' 本地手建 | 'github' 从 GitHub 同步下来
  addColumnIfMissing(db, 'course_requirements', 'source', "TEXT DEFAULT 'local'");
  addColumnIfMissing(db, 'course_requirements', 'remote_id', 'TEXT');
  // session_date: 该作业对应的上课日期 'YYYY-MM-DD'（每节课作业可能不同）
  addColumnIfMissing(db, 'course_requirements', 'session_date', 'TEXT');
  addColumnIfMissing(db, 'course_requirements', 'publisher', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_req_remote ON course_requirements(remote_id) WHERE remote_id IS NOT NULL`);

  // v1.1.9：自动清理——完成时间戳（status 变 done 的时刻；取消完成置 NULL）
  addColumnIfMissing(db, 'course_requirements', 'completed_at', 'INTEGER');
  addColumnIfMissing(db, 'project_tasks', 'done_at', 'INTEGER');
  addColumnIfMissing(db, 'projects', 'completed_at', 'INTEGER');
  // 存量 done 行回填：作业用 created_at（历史完成时间近似）；任务表无时间列用迁移时刻
  db.exec(`
    UPDATE course_requirements SET completed_at = created_at
     WHERE status = 'done' AND completed_at IS NULL;
    UPDATE project_tasks SET done_at = ${Date.now()}
     WHERE status = 'done' AND done_at IS NULL;
    UPDATE projects SET completed_at = ${Date.now()}
     WHERE status IN ('done','completed') AND completed_at IS NULL;
  `);

  // v1.1.9：回收站（软删除快照；purge_at 到期后真删）
  db.exec(`
    CREATE TABLE IF NOT EXISTS recycle_bin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      entity_id INTEGER,
      snapshot TEXT NOT NULL,
      extra TEXT,
      reason TEXT,
      deleted_at INTEGER NOT NULL,
      purge_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bin_purge ON recycle_bin(purge_at);
    CREATE INDEX IF NOT EXISTS idx_bin_kind ON recycle_bin(kind);
  `);

  // 若从未设置开学日，但库里有教务导入的课程（type='class'）→
  // 用最早一节课所在周的周一当作第 1 周，这样课表/日历能直接显示「第 N 周」
  const hasSemesterStart = db.prepare("SELECT 1 FROM settings WHERE key = 'semester_start'").get();
  if (!hasSemesterStart) {
    const first = db.prepare("SELECT MIN(start_at) AS m FROM events WHERE type = 'class'").get() as { m?: number } | undefined;
    if (first?.m) {
      const d = new Date(first.m);
      d.setHours(0, 0, 0, 0);
      const dow = d.getDay(); // 0=周日
      d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
      db.prepare("INSERT INTO settings (key, value) VALUES ('semester_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(d.getTime()));
    }
  }

  // v1.2.1 画布编辑器（达芬奇式节点连线）：3 表（与项目看板的 projects/project_tasks 完全独立的新模块）
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      viewport_x REAL DEFAULT 0,
      viewport_y REAL DEFAULT 0,
      viewport_zoom REAL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS canvas_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canvas_id INTEGER NOT NULL,
      node_type TEXT NOT NULL CHECK(node_type IN ('task','course','homework','event','note','group','custom')) DEFAULT 'custom',
      entity_id INTEGER,
      pos_x REAL NOT NULL DEFAULT 0,
      pos_y REAL NOT NULL DEFAULT 0,
      width REAL DEFAULT 220,
      height REAL DEFAULT 80,
      title TEXT NOT NULL,
      data_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS canvas_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canvas_id INTEGER NOT NULL,
      source_node_id INTEGER NOT NULL,
      target_node_id INTEGER NOT NULL,
      edge_type TEXT NOT NULL DEFAULT 'sequence' CHECK(edge_type IN ('sequence','dependency','relation','critical')),
      label TEXT,
      data_json TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE CASCADE,
      FOREIGN KEY (source_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_req_course ON course_requirements(course_id);
    CREATE INDEX IF NOT EXISTS idx_req_due ON course_requirements(due_date);
    CREATE INDEX IF NOT EXISTS idx_evt_start ON events(start_at);
    CREATE INDEX IF NOT EXISTS idx_evt_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_pt_project ON project_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_note_course ON course_notes(course_id);
    CREATE INDEX IF NOT EXISTS idx_profile_openid ON user_profiles(wx_openid);
    CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas ON canvas_nodes(canvas_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_edges_canvas ON canvas_edges(canvas_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_edges_source ON canvas_edges(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_canvas_edges_target ON canvas_edges(target_node_id);
  `);

  // v1.3.0：画布并入项目（一项目一画布）+ todolist 增强（优先级/描述）
  addColumnIfMissing(db, 'canvases', 'project_id', 'INTEGER');
  addColumnIfMissing(db, 'project_tasks', 'priority', "INTEGER DEFAULT 1");
  addColumnIfMissing(db, 'project_tasks', 'description', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvases(project_id);
    CREATE INDEX IF NOT EXISTS idx_pt_priority ON project_tasks(priority);
  `);

  // v1.3.0：一次性主题迁移 —— 旧默认（空/starry/neon-green）→ aurora（新默认主题）；
  // 主动选择过 sakura 的用户保留原选择
  {
    const row = db.prepare("SELECT value FROM settings WHERE key='theme'").get() as { value?: string } | undefined;
    const t = (row?.value || '').trim();
    if (!t || t === 'starry' || t === 'neon-green') {
      db.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'aurora') ON CONFLICT(key) DO UPDATE SET value='aurora'").run();
    }
  }

  // ── v1.2.3 学业 / 专注 / 习惯 / 出勤 / 小组清单 ──────────────────
  // 成绩（一门课可有多条组成部分成绩 + 一条总评）
  db.exec(`
    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      semester TEXT,
      component TEXT DEFAULT 'total',
      score REAL,
      credit REAL DEFAULT 0,
      full_score REAL DEFAULT 100,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // 考试（考试周模式）
  db.exec(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      title TEXT NOT NULL,
      exam_date INTEGER NOT NULL,
      location TEXT,
      duration_minutes INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'upcoming',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE SET NULL
    );
  `);

  // 番茄钟专注记录（可绑课程 / 任意任务引用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS pomodoro_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER,
      ref_type TEXT,
      ref_id INTEGER,
      label TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      minutes INTEGER NOT NULL,
      mode TEXT DEFAULT 'work',
      created_at INTEGER NOT NULL
    );
  `);

  // 习惯打卡（长期追踪）
  db.exec(`
    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🔥',
      color TEXT DEFAULT '#00FF88',
      frequency TEXT DEFAULT 'daily',
      target_per_week INTEGER,
      archived INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habit_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habit_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(habit_id, date),
      FOREIGN KEY (habit_id) REFERENCES habits(id) ON DELETE CASCADE
    );
  `);

  // 出勤记录（按课程按天打卡）
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('present','late','absent','leave')),
      note TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(course_id, date),
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // 小组共享清单（远端 GitHub grouplists/<groupCode>.json 为真源，本地为镜像）
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner_name TEXT,
      last_synced_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      remote_key TEXT,
      title TEXT NOT NULL,
      assignee TEXT,
      status TEXT DEFAULT 'todo',
      due_date INTEGER,
      sort_order INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (list_id) REFERENCES group_lists(id) ON DELETE CASCADE
    );
  `);

  // 作业周期任务：none(默认)/daily/weekly/biweekly，完成时自动生成下一轮
  addColumnIfMissing(db, 'course_requirements', 'recurrence', 'TEXT');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_grades_course ON grades(course_id);
    CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date);
    CREATE INDEX IF NOT EXISTS idx_pomo_started ON pomodoro_sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_checkin_habit ON habit_checkins(habit_id);
    CREATE INDEX IF NOT EXISTS idx_checkin_date ON habit_checkins(date);
    CREATE INDEX IF NOT EXISTS idx_att_course ON attendance(course_id);
    CREATE INDEX IF NOT EXISTS idx_gli_list ON group_list_items(list_id);
  `);

  // 迁移：若 settings 里已有 profile_* 键但 user_profiles 为空，则生成一条默认资料
  const profileExists = (db.prepare('SELECT COUNT(*) as c FROM user_profiles').get() as any).c;
  if (profileExists === 0) {
    const oldProfile = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'profile_%'").all() as Array<{ key: string; value: string }>;
    if (oldProfile.length > 0) {
      const map: Record<string, string> = {};
      oldProfile.forEach(r => { map[r.key] = r.value; });
      const now = Date.now();
      db.prepare(`INSERT INTO user_profiles
        (wx_openid, wx_nickname, student_id, real_name, school, college, major, class_name, enroll_year, graduate_year, program, degree_level, custom_fields, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        map.wx_openid || '', map.wx_nickname || '',
        map.profile_studentId || '', map.profile_realName || '',
        map.profile_school || '', map.profile_college || '', map.profile_major || '', map.profile_className || '',
        map.profile_enrollYear ? Number(map.profile_enrollYear) : null,
        map.profile_graduateYear ? Number(map.profile_graduateYear) : null,
        map.profile_program || '', map.profile_degreeLevel || '', '[]', now, now
      );
    }
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function seedDefaults(db: Database.Database) {
  // 一次性清理早期版本预填的演示数据（课程/作业/事件/项目/任务/默认分类）
  clearDemoData(db);

  const exists = db.prepare("SELECT value FROM settings WHERE key='seeded'").get();
  if (exists) return;

  const now = Date.now();

  // 默认设置（仅系统配置，不含任何演示内容）
  const insertSet = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
  insertSet.run('seeded', '1');
  insertSet.run('theme', 'neon-green');
  insertSet.run('semester', '2026-Fall');
  insertSet.run('semester_start', String(new Date(now).setHours(0, 0, 0, 0))); // 默认开学日 = 第一次运行时刻
  insertSet.run('miniprogram_enabled', 'false');
  insertSet.run('miniprogram_appid', '');
}

/** 清理历史版本预填的演示数据（只执行一次，用 settings.demo_cleared 标记）。
 *
 * ⚠️ 修复：旧逻辑按名称/代号匹配，会把真实用户数据一起删掉。
 * 用户的课程代码和项目名可能与演示数据完全相同（旧版演示课程正是
 * MATH-201/CS-203/ENG-102，项目名为"毕业设计开题"），且描述/进度等
 * 字段也几乎一致，无法用项目内容安全区分"演示"与"真实"。
 *
 * 新策略：
 *   1. 先检查用户是否已有真实数据（存在非演示课程或非默认进度/描述的项目），
 *      一旦有真实数据立即跳过所有破坏性清理并打标 demo_cleared=1。
 *   2. 仅当 DB 看起来仍是"出厂演示态"时，才执行原演示数据删除。
 */
function clearDemoData(db: Database.Database) {
  const cleared = db.prepare("SELECT value FROM settings WHERE key='demo_cleared'").get();
  if (cleared) return;

  // ── 安全闸门：用户已使用即跳过 ─────────────────────────────────
  // 真实课程：代码不在演示清单内，或代码为空（用户自定义课程）
  const realCourses = db.prepare(
    `SELECT COUNT(*) AS n FROM courses
     WHERE code IS NULL OR code NOT IN ('MATH-201','CS-203','ENG-102')`
  ).get() as { n: number };
  // 真实项目：项目名/描述与演示默认不同；或进度非 20；或起止日期不一致
  const realProjects = db.prepare(
    `SELECT COUNT(*) AS n FROM projects
     WHERE name <> '毕业设计开题'
        OR (description IS NOT NULL AND description <> '完成选题与文献综述')
        OR progress <> 20
        OR (start_date IS NOT NULL AND due_date IS NOT NULL AND start_date <> due_date)`
  ).get() as { n: number };
  if (realCourses.n > 0 || realProjects.n > 0) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_cleared', '1')`).run();
    return;
  }
  // ────────────────────────────────────────────────────────────────

  // 演示课程：高等数学 / 数据结构 / 英语写作（连带其时间段、作业、备注、小程序配置）
  const demoCourses = db.prepare(
    `SELECT id FROM courses WHERE code IN ('MATH-201', 'CS-203', 'ENG-102')`
  ).all() as Array<{ id: number }>;
  if (demoCourses.length) {
    const ids = demoCourses.map((c) => c.id);
    const inClause = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM events WHERE course_id IN (${inClause})`).run(...ids);
    db.prepare(`DELETE FROM course_requirements WHERE course_id IN (${inClause})`).run(...ids);
    db.prepare(`DELETE FROM course_notes WHERE course_id IN (${inClause})`).run(...ids);
    db.prepare(`DELETE FROM course_miniprograms WHERE course_id IN (${inClause})`).run(...ids);
    db.prepare(`DELETE FROM courses WHERE id IN (${inClause})`).run(...ids);
  }

  // 演示项目：毕业设计开题（连带任务）
  const demoProjects = db.prepare(`SELECT id FROM projects WHERE name = '毕业设计开题'`).all() as Array<{ id: number }>;
  if (demoProjects.length) {
    const ids = demoProjects.map((p) => p.id);
    const inClause = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM project_tasks WHERE project_id IN (${inClause})`).run(...ids);
    db.prepare(`DELETE FROM projects WHERE id IN (${inClause})`).run(...ids);
  }

  // 预填的默认分类（课程/作业/考试/会议/生活/纪念日）
  db.prepare(
    `DELETE FROM categories WHERE name IN ('课程', '作业', '考试', '会议', '生活', '纪念日')`
  ).run();

  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('demo_cleared', '1')`).run();
}


export type DB = Database.Database;