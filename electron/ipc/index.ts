import type { DB } from '../db/index';
import { getDbPath, refreshCourseKeys } from '../db/index';
import { ipcMain } from 'electron';
import { registerInputDiagIpc } from '../diag/inputDiag';
import { registerAboutIpc as registerAbout } from '../about';
import { softDeleteRow, registerCleanup } from '../cleanup';
import { registerWebdav } from '../webdav';

import { registerBilling } from '../billing';
import { registerClass } from '../class/index';

// ====== Courses ======
function registerCourses(db: DB) {
  ipcMain.handle('db:courses:list', () => db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all());
  ipcMain.handle('db:courses:get', (_e, id) => db.prepare('SELECT * FROM courses WHERE id = ?').get(id));
  ipcMain.handle('db:courses:create', (_e, data) => {
    const stmt = db.prepare(
      `INSERT INTO courses (name, code, instructor, semester, color, description, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.name, data.code ?? null, data.instructor ?? null,
      data.semester ?? null, data.color ?? '#00FF88',
      data.description ?? null, JSON.stringify(data.tags || []), Date.now()
    );
    // v1.1.7：建课后立刻刷新 course_key（通用固定 ID，作业同步挂载依据）
    refreshCourseKeys(db);
    return db.prepare('SELECT * FROM courses WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:courses:update', (_e, id, data) => {
    db.prepare(
      `UPDATE courses SET name=?, code=?, instructor=?, semester=?, color=?, description=?, tags=? WHERE id=?`
    ).run(data.name, data.code, data.instructor, data.semester, data.color, data.description, JSON.stringify(data.tags || []), id);
    // v1.1.7：改名/换老师后 course_key 跟着变（确定性派生）
    refreshCourseKeys(db);
    return db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  });
  ipcMain.handle('db:courses:delete', (_e, id) => {
    db.prepare('DELETE FROM events WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_requirements WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_notes WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_miniprograms WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    return { ok: true };
  });
}

// ====== Requirements ======
function registerRequirements(db: DB) {
  ipcMain.handle('db:requirements:list', (_e, filter) => {
    let sql = `SELECT r.*, c.name as course_name, c.color as course_color
               FROM course_requirements r
               LEFT JOIN courses c ON r.course_id = c.id`;
    const params: any[] = [];
    if (filter?.courseId) { sql += ' WHERE r.course_id = ?'; params.push(filter.courseId); }
    sql += ' ORDER BY r.due_date ASC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:requirements:create', (_e, data) => {
    const stmt = db.prepare(
      `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, estimated_hours, actual_hours, notes, created_at, completed_at, recurrence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.course_id, data.title, data.type ?? 'homework',
      data.description ?? null, data.due_date, data.priority ?? 2,
      data.status ?? 'pending', data.estimated_hours ?? null, data.actual_hours ?? null, data.notes ?? null, Date.now(),
      data.status === 'done' ? Date.now() : null,
      data.recurrence ?? null
    );
    return db.prepare('SELECT * FROM course_requirements WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:requirements:update', (_e, id, data) => {
    const prev = db.prepare('SELECT * FROM course_requirements WHERE id = ?').get(id) as any;
    db.prepare(
      `UPDATE course_requirements SET title=?, type=?, description=?, due_date=?, priority=?, status=?, estimated_hours=?, actual_hours=?, notes=?, recurrence=? WHERE id=?`
    ).run(data.title, data.type, data.description, data.due_date, data.priority, data.status, data.estimated_hours, data.actual_hours, data.notes ?? null, data.recurrence ?? null, id);
    // v1.1.9 自动清理：完成时间戳（变 done 记录时刻；取消完成清空）
    db.prepare(
      `UPDATE course_requirements SET completed_at = CASE WHEN status = 'done' THEN COALESCE(completed_at, ?) ELSE NULL END WHERE id = ?`
    ).run(Date.now(), id);

    // v1.2.3 周期任务：完成带 recurrence 的作业时自动生成下一轮（同课同题同截止偏移去重）
    if (prev && data.status === 'done' && prev.status !== 'done' && prev.recurrence) {
      const stepDays = prev.recurrence === 'daily' ? 1 : prev.recurrence === 'biweekly' ? 14 : 7;
      const nextDue = Number(data.due_date) + stepDays * 86400000;
      const dup = db.prepare(
        `SELECT 1 FROM course_requirements WHERE course_id = ? AND title = ? AND due_date = ? AND status != 'done'`
      ).get(prev.course_id, data.title, nextDue);
      if (!dup) {
        db.prepare(
          `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status, notes, created_at, recurrence)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
        ).run(prev.course_id, data.title, data.type, data.description ?? null, nextDue, data.priority ?? 2, data.notes ?? null, Date.now(), prev.recurrence);
      }
    }
    return db.prepare('SELECT * FROM course_requirements WHERE id = ?').get(id);
  });
  ipcMain.handle('db:requirements:delete', (_e, id) => {
    // v1.1.9：手动删除进回收站（30 天可恢复）
    softDeleteRow(db, 'requirement', id);
    return { ok: true };
  });
}

// ====== Events ======
function registerEvents(db: DB) {
  ipcMain.handle('db:events:list', (_e, filter) => {
    let sql = `SELECT e.*, c.name as course_name, c.color as course_color,
                      cat.name as category_name, cat.color as category_color, cat.emoji as category_emoji
               FROM events e
               LEFT JOIN courses c ON e.course_id = c.id
               LEFT JOIN categories cat ON e.category_id = cat.id`;
    const params: any[] = [];
    if (filter?.from && filter?.to) {
      sql += ' WHERE e.start_at >= ? AND e.start_at < ?';
      params.push(filter.from, filter.to);
    } else if (filter?.from) {
      sql += ' WHERE e.start_at >= ?';
      params.push(filter.from);
    }
    sql += ' ORDER BY e.start_at ASC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:events:create', (_e, data) => {
    const stmt = db.prepare(
      `INSERT INTO events (title, start_at, end_at, location, recurrence, recurrence_end,
                           course_id, color, notes, all_day, reminder_minutes, category_id, type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.title, data.start_at, data.end_at ?? null, data.location ?? null,
      data.recurrence ?? null, data.recurrence_end ?? null,
      data.course_id ?? null, data.color ?? null, data.notes ?? null,
      data.all_day ? 1 : 0, data.reminder_minutes ?? null,
      data.category_id ?? null, data.type ?? 'event'
    );
    return db.prepare(`
      SELECT e.*, c.name as course_name, c.color as course_color,
             cat.name as category_name, cat.color as category_color, cat.emoji as category_emoji
      FROM events e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN categories cat ON e.category_id = cat.id
      WHERE e.id = ?
    `).get(info.lastInsertRowid);
  });
  ipcMain.handle('db:events:update', (_e, id, data) => {
    db.prepare(
      `UPDATE events SET title=?, start_at=?, end_at=?, location=?, recurrence=?, recurrence_end=?,
                         course_id=?, color=?, notes=?, all_day=?, reminder_minutes=?, category_id=?, type=?
       WHERE id=?`
    ).run(
      data.title, data.start_at, data.end_at, data.location,
      data.recurrence, data.recurrence_end,
      data.course_id, data.color, data.notes,
      data.all_day ? 1 : 0, data.reminder_minutes,
      data.category_id, data.type, id
    );
    return db.prepare(`
      SELECT e.*, c.name as course_name, c.color as course_color,
             cat.name as category_name, cat.color as category_color, cat.emoji as category_emoji
      FROM events e
      LEFT JOIN courses c ON e.course_id = c.id
      LEFT JOIN categories cat ON e.category_id = cat.id
      WHERE e.id = ?
    `).get(id);
  });
  ipcMain.handle('db:events:delete', (_e, id) => {
    // v1.1.9：手动删除进回收站
    softDeleteRow(db, 'event', id);
    return { ok: true };
  });
}

// ====== Categories ======
function registerCategories(db: DB) {
  ipcMain.handle('db:categories:list', () =>
    db.prepare('SELECT * FROM categories ORDER BY id ASC').all()
  );
  ipcMain.handle('db:categories:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO categories (name, color, emoji, created_at) VALUES (?, ?, ?, ?)`
    ).run(data.name, data.color ?? '#00FF88', data.emoji ?? null, Date.now());
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:categories:update', (_e, id, data) => {
    db.prepare(`UPDATE categories SET name=?, color=?, emoji=? WHERE id=?`)
      .run(data.name, data.color, data.emoji, id);
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  });
  ipcMain.handle('db:categories:delete', (_e, id) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    return { ok: true };
  });
}

// ====== ICS 导出 ======
import * as fs from 'node:fs';
import { dialog, BrowserWindow } from 'electron';

function pad(n: number) { return n.toString().padStart(2, '0'); }

function toIcsDate(ts: number, allDay: boolean): string {
  const d = new Date(ts);
  if (allDay) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcs(s: string): string {
  return s.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
}

function buildIcs(events: any[]): string {
  const now = toIcsDate(Date.now(), false);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaskManager//CN//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TaskManager 日历',
  ];
  for (const e of events) {
    const allDay = !!e.all_day;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@taskmanager`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${toIcsDate(e.start_at, allDay)}`);
    if (e.end_at) lines.push(`DTEND:${toIcsDate(e.end_at, allDay)}`);
    lines.push(`SUMMARY:${escapeIcs(e.title || '')}`);
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeIcs(e.notes)}`);
    if (e.recurrence) {
      const r = e.recurrence;
      if (r === 'WEEKLY') lines.push('RRULE:FREQ=WEEKLY');
      else if (r === 'DAILY') lines.push('RRULE:FREQ=DAILY');
      else if (r === 'MONTHLY') lines.push('RRULE:FREQ=MONTHLY');
      else if (r === 'YEARLY') lines.push('RRULE:FREQ=YEARLY');
    }
    if (e.recurrence_end) {
      lines.push(`UNTIL=${toIcsDate(e.recurrence_end, false)}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function registerIcsExport() {
  ipcMain.handle('ics:export', async (_e, events) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const defaultName = `TaskManager-日历-${new Date().toISOString().slice(0, 10)}.ics`;
    const result = await dialog.showSaveDialog(win!, {
      title: '导出日程到系统日历',
      defaultPath: defaultName,
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, buildIcs(events), 'utf8');
    return { ok: true, path: result.filePath, count: events.length };
  });
}

// ====== Projects ======
function registerProjects(db: DB) {
  ipcMain.handle('db:projects:list', () => db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all());
  ipcMain.handle('db:projects:get', (_e, id) => db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  ipcMain.handle('db:projects:create', (_e, data) => {
    const stmt = db.prepare(
      `INSERT INTO projects (name, description, status, start_date, due_date, progress, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.name, data.description ?? null, data.status ?? 'active',
      data.start_date ?? null, data.due_date ?? null, data.progress ?? 0, Date.now()
    );
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:projects:update', (_e, id, data) => {
    db.prepare(
      `UPDATE projects SET name=?, description=?, status=?, start_date=?, due_date=?, progress=? WHERE id=?`
    ).run(data.name, data.description, data.status, data.start_date, data.due_date, data.progress, id);
    // v1.1.9 自动清理：完结时间戳
    db.prepare(
      `UPDATE projects SET completed_at = CASE WHEN status IN ('done','completed') THEN COALESCE(completed_at, ?) ELSE NULL END WHERE id = ?`
    ).run(Date.now(), id);
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  });
  ipcMain.handle('db:projects:delete', (_e, id) => {
    // v1.1.9：手动删除进回收站（项目 + 任务一起快照）
    softDeleteRow(db, 'project', id);
    return { ok: true };
  });
}

// ====== Tasks ======
function registerTasks(db: DB) {
  ipcMain.handle('db:tasks:list', (_e, filter) => {
    let sql = `SELECT t.*, p.name as project_name FROM project_tasks t
               LEFT JOIN projects p ON t.project_id = p.id`;
    const params: any[] = [];
    if (filter?.projectId) { sql += ' WHERE t.project_id = ?'; params.push(filter.projectId); }
    sql += ' ORDER BY t.order_index ASC, t.id ASC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:tasks:create', (_e, data) => {
    const stmt = db.prepare(
      `INSERT INTO project_tasks (project_id, course_id, title, status, assignee, due_date, order_index, priority, description, done_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.project_id, data.course_id ?? null, data.title,
      data.status ?? 'todo', data.assignee ?? null,
      data.due_date ?? null, data.order_index ?? 0,
      data.priority ?? 1, data.description ?? null,
      data.status === 'done' ? Date.now() : null
    );
    return db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:tasks:update', (_e, id, data) => {
    db.prepare(
      `UPDATE project_tasks SET title=?, status=?, assignee=?, due_date=?, order_index=?, course_id=?, priority=COALESCE(?, priority), description=COALESCE(?, description) WHERE id=?`
    ).run(
      data.title, data.status, data.assignee, data.due_date,
      data.order_index ?? 0, data.course_id,
      data.priority ?? null, data.description ?? null, id
    );
    // v1.1.9 自动清理：完成时间戳
    db.prepare(
      `UPDATE project_tasks SET done_at = CASE WHEN status = 'done' THEN COALESCE(done_at, ?) ELSE NULL END WHERE id = ?`
    ).run(Date.now(), id);
    return db.prepare('SELECT * FROM project_tasks WHERE id = ?').get(id);
  });
  ipcMain.handle('db:tasks:delete', (_e, id) => {
    // v1.1.9：手动删除进回收站
    softDeleteRow(db, 'task', id);
    return { ok: true };
  });
}

// ====== Settings ======
function registerSettings(db: DB) {
  ipcMain.handle('db:settings:getAll', () => {
    const rows = db.prepare('SELECT * FROM settings').all() as Array<{ key: string; value: string }>;
    const out: Record<string, string> = {};
    rows.forEach(r => { out[r.key] = r.value; });
    return out;
  });
  ipcMain.handle('db:settings:set', (_e, key, value) => {
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
    return { ok: true };
  });
}

// ====== Stats ======
function registerUserProfiles(db: DB) {
  ipcMain.handle('db:userProfiles:list', () => db.prepare('SELECT * FROM user_profiles ORDER BY updated_at DESC').all());
  ipcMain.handle('db:userProfiles:getActive', () => db.prepare('SELECT * FROM user_profiles WHERE is_active = 1 LIMIT 1').get());
  ipcMain.handle('db:userProfiles:getByOpenid', (_e, openid: string) => db.prepare('SELECT * FROM user_profiles WHERE wx_openid = ?').get(openid));
  ipcMain.handle('db:userProfiles:create', (_e, data) => {
    const now = Date.now();
    const stmt = db.prepare(
      `INSERT INTO user_profiles (username, password_hash, wx_openid, wx_nickname, wx_avatar, student_id, real_name, school, college, major, class_name, enroll_year, graduate_year, program, degree_level, custom_fields, encrypted_fields, privacy_mode, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      data.username ?? null, data.password_hash ?? null,
      data.wx_openid ?? null, data.wx_nickname ?? null, data.wx_avatar ?? null,
      data.student_id ?? null, data.real_name ?? null, data.school ?? null,
      data.college ?? null, data.major ?? null, data.class_name ?? null,
      data.enroll_year ?? null, data.graduate_year ?? null, data.program ?? null,
      data.degree_level ?? null, JSON.stringify(data.custom_fields || []), data.encrypted_fields ?? null,
      data.privacy_mode ? 1 : 0, data.is_active ? 1 : 0, now, now
    );
    return db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:userProfiles:update', (_e, id, data) => {
    const now = Date.now();
    // password_hash 为 undefined/null 时保留原值（避免普通资料更新误清密码）；
    // 传空字符串 '' 表示主动清除密码
    db.prepare(
      `UPDATE user_profiles SET username=?, password_hash=COALESCE(?, password_hash), wx_openid=?, wx_nickname=?, wx_avatar=?, student_id=?, real_name=?, school=?, college=?, major=?, class_name=?, enroll_year=?, graduate_year=?, program=?, degree_level=?, custom_fields=?, encrypted_fields=?, privacy_mode=?, is_active=?, updated_at=?
       WHERE id=?`
    ).run(
      data.username ?? null, data.password_hash ?? null,
      data.wx_openid ?? null, data.wx_nickname ?? null, data.wx_avatar ?? null,
      data.student_id ?? null, data.real_name ?? null, data.school ?? null,
      data.college ?? null, data.major ?? null, data.class_name ?? null,
      data.enroll_year ?? null, data.graduate_year ?? null, data.program ?? null,
      data.degree_level ?? null, JSON.stringify(data.custom_fields || []), data.encrypted_fields ?? null,
      data.privacy_mode ? 1 : 0, data.is_active ? 1 : 0, now, id
    );
    return db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(id);
  });
  ipcMain.handle('db:userProfiles:delete', (_e, id) => {
    db.prepare('DELETE FROM user_profiles WHERE id = ?').run(id);
    return { ok: true };
  });
  ipcMain.handle('db:userProfiles:setActive', (_e, id) => {
    db.prepare('UPDATE user_profiles SET is_active = 0').run();
    db.prepare('UPDATE user_profiles SET is_active = 1 WHERE id = ?').run(id);
    return db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(id);
  });
}

function registerCourseNotes(db: DB) {
  ipcMain.handle('db:courseNotes:list', (_e, courseId: number) =>
    db.prepare('SELECT * FROM course_notes WHERE course_id = ? ORDER BY created_at DESC').all(courseId)
  );
  ipcMain.handle('db:courseNotes:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO course_notes (course_id, content, created_at) VALUES (?, ?, ?)`
    ).run(data.course_id, data.content, Date.now());
    return db.prepare('SELECT * FROM course_notes WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:courseNotes:update', (_e, id, data) => {
    db.prepare('UPDATE course_notes SET content=? WHERE id=?').run(data.content, id);
    return db.prepare('SELECT * FROM course_notes WHERE id = ?').get(id);
  });
  ipcMain.handle('db:courseNotes:delete', (_e, id) => {
    db.prepare('DELETE FROM course_notes WHERE id = ?').run(id);
    return { ok: true };
  });
}

function registerCourseMiniPrograms(db: DB) {
  ipcMain.handle('db:miniPrograms:list', () => db.prepare('SELECT * FROM course_miniprograms ORDER BY updated_at DESC').all());
  ipcMain.handle('db:miniPrograms:getByCourse', (_e, courseId: number) =>
    db.prepare('SELECT * FROM course_miniprograms WHERE course_id = ?').get(courseId)
  );
  ipcMain.handle('db:miniPrograms:getActive', () =>
    db.prepare('SELECT * FROM course_miniprograms WHERE active = 1 LIMIT 1').get()
  );
  ipcMain.handle('db:miniPrograms:createOrUpdate', (_e, data) => {
    const now = Date.now();
    const existing = db.prepare('SELECT id FROM course_miniprograms WHERE course_id = ?').get(data.course_id) as { id: number } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE course_miniprograms SET app_type=?, config_json=?, active=?, updated_at=? WHERE id=?`
      ).run(data.app_type ?? 'timetable', JSON.stringify(data.config_json || {}), data.active ? 1 : 0, now, existing.id);
      return db.prepare('SELECT * FROM course_miniprograms WHERE id = ?').get(existing.id);
    }
    const info = db.prepare(
      `INSERT INTO course_miniprograms (course_id, app_type, config_json, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(data.course_id, data.app_type ?? 'timetable', JSON.stringify(data.config_json || {}), data.active ? 1 : 0, now, now);
    return db.prepare('SELECT * FROM course_miniprograms WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:miniPrograms:setActive', (_e, id: number) => {
    db.prepare('UPDATE course_miniprograms SET active = 0').run();
    db.prepare('UPDATE course_miniprograms SET active = 1 WHERE id = ?').run(id);
    return db.prepare('SELECT * FROM course_miniprograms WHERE id = ?').get(id);
  });
  ipcMain.handle('db:miniPrograms:delete', (_e, id) => {
    db.prepare('DELETE FROM course_miniprograms WHERE id = ?').run(id);
    return { ok: true };
  });
}

function registerStats(db: DB) {
  ipcMain.handle('db:stats:dashboard', () => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7);

    const totalReq = (db.prepare('SELECT COUNT(*) as c FROM course_requirements').get() as any).c;
    const pendingReq = (db.prepare("SELECT COUNT(*) as c FROM course_requirements WHERE status='pending'").get() as any).c;
    const overdueReq = (db.prepare("SELECT COUNT(*) as c FROM course_requirements WHERE status IN ('pending','in_progress') AND due_date < ?").get(todayStart.getTime()) as any).c;
    const dueTodayReq = (db.prepare("SELECT COUNT(*) as c FROM course_requirements WHERE due_date >= ? AND due_date < ?").get(todayStart.getTime(), tomorrowStart.getTime()) as any).c;
    const dueWeekReq = (db.prepare("SELECT COUNT(*) as c FROM course_requirements WHERE due_date >= ? AND due_date < ? AND status IN ('pending','in_progress')").get(todayStart.getTime(), weekEnd.getTime()) as any).c;
    const totalCourses = (db.prepare('SELECT COUNT(*) as c FROM courses').get() as any).c;
    const activeProjects = (db.prepare("SELECT COUNT(*) as c FROM projects WHERE status='active'").get() as any).c;
    const todayEvents = (db.prepare('SELECT COUNT(*) as c FROM events WHERE start_at >= ? AND start_at < ?').get(todayStart.getTime(), tomorrowStart.getTime()) as any).c;

    return {
      totalReq, pendingReq, overdueReq, dueTodayReq, dueWeekReq,
      totalCourses, activeProjects, todayEvents,
    };
  });
}

// ====== MiniProgram（微信小程序嵌套接口预留） ======
function registerMiniProgram() {
  ipcMain.handle('miniprogram:open', (_e, appId: string) => {
    // 预留：
    // 方案 A：使用 Electron webview 加载 wx mini program 调试版 URL（需 WMPF）
    // 方案 B：嵌入 H5 版本小程序的 URL
    // 方案 C：调用微信开放平台 PC 小程序 API
    // 当前实现：返回 appId，由渲染进程 webview 加载占位 UI
    return { ok: true, appId, mode: 'placeholder' };
  });
  ipcMain.handle('miniprogram:isReady', () => true);
  ipcMain.handle('miniprogram:config:get', () => ({
    enabled: false,
    appId: '',
    mode: 'webview',
    note: '微信小程序 PC 端嵌入需要：1) 小程序后台关联公众号；2) 配置业务域名白名单；3) 或使用 WMPF 扫码登录。当前版本为占位实现。',
  }));
  ipcMain.handle('miniprogram:config:set', (_e, cfg) => cfg);
}

// ====== 贝壳课表（USTB SSO 扫码登录 + BYYT 教务课表导入） ======
import { randomUUID } from 'node:crypto';
import { CookieJar } from '../ustb/http';
import {
  createContext,
  startQrLogin,
  getQrImage,
  pollQrStatus,
  completeQrLogin,
  getByytUserInfo,
  fetchCurriculum,
  fetchPeriods,
  parseCurriculum,
  type UstbContext,
} from '../ustb/api';
import { importCurriculum } from '../ustb/importer';
import { registerBackup, safetyBackup } from '../backup/index';
import { registerUpdater } from '../updater/index';
import { registerHomework } from '../homework/index';
import { registerXlsImport } from '../timetable-xls/index';

function registerUstb(db: DB) {
  const getSetting = (key: string): string | undefined =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const setSetting = (key: string, value: string) =>
    db
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, value);

  // 进行中的扫码会话（sessionId → 上下文）
  const sessions = new Map<string, UstbContext>();

  ipcMain.handle('ustb:status', () => {
    const cookie = getSetting('ustb_cookie');
    let user: { name: string; school: string; userId: string } | null = null;
    try {
      user = JSON.parse(getSetting('ustb_user') ?? 'null');
    } catch {
      user = null;
    }
    let term: { xn: string; xq: string } | null = null;
    try {
      term = JSON.parse(getSetting('ustb_term') ?? 'null');
    } catch {
      term = null;
    }
    const lastSync = Number(getSetting('ustb_last_sync') ?? 0) || null;
    let importedCount = 0;
    try {
      importedCount = (JSON.parse(getSetting('ustb_imported_courses') ?? '[]') as number[]).length;
    } catch {
      /* 忽略 */
    }
    return { loggedIn: !!cookie, user, term, lastSync, importedCount };
  });

  ipcMain.handle('ustb:qr:start', async () => {
    const ctx = createContext();
    await startQrLogin(ctx);
    const qrImage = await getQrImage(ctx);
    const sessionId = randomUUID();
    sessions.set(sessionId, ctx);
    // 5 分钟无进展自动回收
    setTimeout(() => sessions.delete(sessionId), 5 * 60 * 1000);
    return { sessionId, qrImage };
  });

  ipcMain.handle('ustb:qr:poll', async (_e, sessionId: string) => {
    const ctx = sessions.get(sessionId);
    if (!ctx) throw new Error('登录会话不存在或已过期，请重新生成二维码');
    const r = await pollQrStatus(ctx);
    if (r.status === 'success' && r.passcode) {
      const user = await completeQrLogin(ctx, r.passcode);
      setSetting('ustb_cookie', ctx.jar.toJSON());
      setSetting('ustb_user', JSON.stringify(user));
      sessions.delete(sessionId);
      return { status: 'success' as const, user };
    }
    return r;
  });

  ipcMain.handle('ustb:qr:cancel', (_e, sessionId: string) => {
    sessions.delete(sessionId);
    return { ok: true };
  });

  const restoreContext = (): UstbContext => {
    const cookie = getSetting('ustb_cookie');
    if (!cookie) throw new Error('尚未登录，请先扫码');
    return createContext(CookieJar.fromJSON(cookie));
  };

  const loadAndParse = async (ctx: UstbContext, xn: string, xq: string) => {
    const [rawItems, periods] = await Promise.all([
      fetchCurriculum(ctx, xn, xq),
      fetchPeriods(ctx, xn, xq).catch(() => []),
    ]);
    return { items: parseCurriculum(rawItems), periods };
  };

  // 预览：只拉取解析，不写库
  ipcMain.handle('ustb:preview', async (_e, term: { xn: string; xq: string }) => {
    const ctx = restoreContext();
    const user = await getByytUserInfo(ctx); // 顺带校验 cookie 有效性
    const { items, periods } = await loadAndParse(ctx, term.xn, String(term.xq));
    return { user, items, periods, count: items.length };
  });

  // 导入 / 同步（同一动作：替换上次贝壳课表导入的数据，手动数据不动）
  ipcMain.handle('ustb:import', async (_e, opts: { xn: string; xq: string; semesterStart: number }) => {
    const ctx = restoreContext();
    await getByytUserInfo(ctx);
    const { items, periods } = await loadAndParse(ctx, opts.xn, String(opts.xq));
    if (!items.length) throw new Error('该学期没有解析到任何课程');
    // 导入会替换既有课表 —— 先做安全备份（backups/pre-import-*.db），出问题可回滚
    try { await safetyBackup(db); } catch { /* 备份失败不阻断导入 */ }
    return importCurriculum(db, items, {
      xn: opts.xn,
      xq: String(opts.xq),
      semesterStart: opts.semesterStart,
      periods,
    });
  });

  ipcMain.handle('ustb:logout', () => {
    for (const k of ['ustb_cookie', 'ustb_user', 'ustb_term', 'ustb_last_sync']) {
      db.prepare('DELETE FROM settings WHERE key = ?').run(k);
    }
    return { ok: true };
  });
}

// ====== v1.2.1 画布编辑器（达芬奇式节点连线） ======
function registerCanvases(db: DB) {
  ipcMain.handle('db:canvases:list', () =>
    db.prepare('SELECT * FROM canvases ORDER BY updated_at DESC').all()
  );
  ipcMain.handle('db:canvases:get', (_e, id) =>
    db.prepare('SELECT * FROM canvases WHERE id = ?').get(id)
  );
  // v1.3.0：画布并入项目 —— 按项目取画布（一项目一画布，取最新一条）
  ipcMain.handle('db:canvases:getByProject', (_e, projectId: number) =>
    db.prepare('SELECT * FROM canvases WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1').get(projectId)
  );
  ipcMain.handle('db:canvases:create', (_e, data) => {
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO canvases (name, description, project_id, viewport_x, viewport_y, viewport_zoom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.name, data.description ?? null, data.project_id ?? null,
      data.viewport_x ?? 0, data.viewport_y ?? 0, data.viewport_zoom ?? 1,
      now, now
    );
    return db.prepare('SELECT * FROM canvases WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:canvases:update', (_e, id, data) => {
    db.prepare(
      `UPDATE canvases SET name=?, description=?, project_id=?, viewport_x=?, viewport_y=?, viewport_zoom=?, updated_at=? WHERE id=?`
    ).run(
      data.name, data.description ?? null, data.project_id ?? null,
      data.viewport_x ?? 0, data.viewport_y ?? 0, data.viewport_zoom ?? 1,
      Date.now(), id
    );
    return db.prepare('SELECT * FROM canvases WHERE id = ?').get(id);
  });
  ipcMain.handle('db:canvases:delete', (_e, id) => {
    db.prepare('DELETE FROM canvases WHERE id = ?').run(id);
    return { ok: true };
  });
}

function registerCanvasNodes(db: DB) {
  ipcMain.handle('db:canvasNodes:listByCanvas', (_e, canvasId: number) =>
    db.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ? ORDER BY id ASC').all(canvasId)
  );
  ipcMain.handle('db:canvasNodes:create', (_e, data) => {
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO canvas_nodes (canvas_id, node_type, entity_id, pos_x, pos_y, width, height, title, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.canvas_id, data.node_type ?? 'custom', data.entity_id ?? null,
      data.pos_x ?? 0, data.pos_y ?? 0, data.width ?? 220, data.height ?? 80,
      data.title, JSON.stringify(data.data || {}), now, now
    );
    return db.prepare('SELECT * FROM canvas_nodes WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:canvasNodes:update', (_e, id, data) => {
    db.prepare(
      `UPDATE canvas_nodes SET node_type=?, entity_id=?, pos_x=?, pos_y=?, width=?, height=?, title=?, data_json=?, updated_at=? WHERE id=?`
    ).run(
      data.node_type ?? 'custom', data.entity_id ?? null,
      data.pos_x ?? 0, data.pos_y ?? 0, data.width ?? 220, data.height ?? 80,
      data.title, JSON.stringify(data.data || {}), Date.now(), id
    );
    return db.prepare('SELECT * FROM canvas_nodes WHERE id = ?').get(id);
  });
  // 批量更新坐标：拖拽过程中减少 IPC 次数；用事务保证原子性
  ipcMain.handle('db:canvasNodes:updatePositions', (_e, batch: Array<{ id: number; pos_x: number; pos_y: number }>) => {
    const upd = db.prepare('UPDATE canvas_nodes SET pos_x=?, pos_y=?, updated_at=? WHERE id=?');
    const tx = db.transaction((rows: Array<{ id: number; pos_x: number; pos_y: number }>) => {
      const now = Date.now();
      for (const r of rows) upd.run(r.pos_x, r.pos_y, now, r.id);
    });
    tx(batch);
    return { ok: true, count: batch.length };
  });
  ipcMain.handle('db:canvasNodes:delete', (_e, id) => {
    db.prepare('DELETE FROM canvas_nodes WHERE id = ?').run(id);
    return { ok: true };
  });
}

function registerCanvasEdges(db: DB) {
  ipcMain.handle('db:canvasEdges:listByCanvas', (_e, canvasId: number) =>
    db.prepare('SELECT * FROM canvas_edges WHERE canvas_id = ? ORDER BY id ASC').all(canvasId)
  );
  ipcMain.handle('db:canvasEdges:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO canvas_edges (canvas_id, source_node_id, target_node_id, edge_type, label, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.canvas_id, data.source_node_id, data.target_node_id,
      data.edge_type ?? 'sequence', data.label ?? null,
      JSON.stringify(data.data || {}), Date.now()
    );
    return db.prepare('SELECT * FROM canvas_edges WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:canvasEdges:update', (_e, id, data) => {
    db.prepare(
      `UPDATE canvas_edges SET edge_type=?, label=?, data_json=? WHERE id=?`
    ).run(
      data.edge_type ?? 'sequence', data.label ?? null,
      JSON.stringify(data.data || {}), id
    );
    return db.prepare('SELECT * FROM canvas_edges WHERE id = ?').get(id);
  });
  ipcMain.handle('db:canvasEdges:delete', (_e, id) => {
    db.prepare('DELETE FROM canvas_edges WHERE id = ?').run(id);
    return { ok: true };
  });
}

// ====== v1.2.3：成绩 ======
function registerGrades(db: DB) {
  ipcMain.handle('db:grades:list', (_e, filter) => {
    let sql = `SELECT g.*, c.name as course_name, c.color as course_color
               FROM grades g LEFT JOIN courses c ON g.course_id = c.id`;
    const params: any[] = [];
    if (filter?.semester) { sql += ' WHERE g.semester = ?'; params.push(filter.semester); }
    if (filter?.courseId) { sql += (params.length ? ' AND' : ' WHERE') + ' g.course_id = ?'; params.push(filter.courseId); }
    sql += ' ORDER BY g.course_id ASC, g.id ASC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:grades:create', (_e, data) => {
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO grades (course_id, semester, component, score, credit, full_score, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.course_id, data.semester ?? null, data.component ?? 'total',
      data.score ?? null, data.credit ?? 0, data.full_score ?? 100, data.notes ?? null, now, now
    );
    return db.prepare('SELECT * FROM grades WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:grades:update', (_e, id, data) => {
    db.prepare(
      `UPDATE grades SET course_id=?, semester=?, component=?, score=?, credit=?, full_score=?, notes=?, updated_at=? WHERE id=?`
    ).run(data.course_id, data.semester, data.component, data.score, data.credit, data.full_score, data.notes ?? null, Date.now(), id);
    return db.prepare('SELECT * FROM grades WHERE id = ?').get(id);
  });
  ipcMain.handle('db:grades:delete', (_e, id) => {
    db.prepare('DELETE FROM grades WHERE id = ?').run(id);
    return { ok: true };
  });
}

// ====== v1.2.3：考试 ======
function registerExams(db: DB) {
  ipcMain.handle('db:exams:list', (_e, filter) => {
    let sql = `SELECT e.*, c.name as course_name, c.color as course_color
               FROM exams e LEFT JOIN courses c ON e.course_id = c.id`;
    const params: any[] = [];
    if (filter?.status) { sql += ' WHERE e.status = ?'; params.push(filter.status); }
    else { sql += ` WHERE e.status != 'cancelled'`; }
    sql += ' ORDER BY e.exam_date ASC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:exams:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO exams (course_id, title, exam_date, location, duration_minutes, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.course_id ?? null, data.title, data.exam_date, data.location ?? null,
      data.duration_minutes ?? null, data.notes ?? null, data.status ?? 'upcoming', Date.now()
    );
    return db.prepare('SELECT * FROM exams WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:exams:update', (_e, id, data) => {
    db.prepare(
      `UPDATE exams SET course_id=?, title=?, exam_date=?, location=?, duration_minutes=?, notes=?, status=? WHERE id=?`
    ).run(data.course_id ?? null, data.title, data.exam_date, data.location, data.duration_minutes, data.notes ?? null, data.status ?? 'upcoming', id);
    return db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  });
  ipcMain.handle('db:exams:delete', (_e, id) => {
    db.prepare('DELETE FROM exams WHERE id = ?').run(id);
    return { ok: true };
  });
}

// ====== v1.2.3：番茄钟 ======
function registerPomodoro(db: DB) {
  ipcMain.handle('db:pomodoro:list', (_e, filter) => {
    let sql = `SELECT p.*, c.name as course_name, c.color as course_color
               FROM pomodoro_sessions p LEFT JOIN courses c ON p.course_id = c.id`;
    const params: any[] = [];
    const conds: string[] = [];
    if (filter?.from) { conds.push('p.started_at >= ?'); params.push(filter.from); }
    if (filter?.to) { conds.push('p.started_at < ?'); params.push(filter.to); }
    if (filter?.courseId) { conds.push('p.course_id = ?'); params.push(filter.courseId); }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY p.started_at DESC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:pomodoro:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO pomodoro_sessions (course_id, ref_type, ref_id, label, started_at, ended_at, minutes, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.course_id ?? null, data.ref_type ?? null, data.ref_id ?? null, data.label ?? null,
      data.started_at ?? Date.now(), data.ended_at ?? null, data.minutes ?? 25, data.mode ?? 'work', Date.now()
    );
    return db.prepare('SELECT * FROM pomodoro_sessions WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:pomodoro:stop', (_e, id, minutes) => {
    db.prepare(`UPDATE pomodoro_sessions SET ended_at = ?, minutes = ? WHERE id = ?`)
      .run(Date.now(), minutes ?? null, id);
    return db.prepare('SELECT * FROM pomodoro_sessions WHERE id = ?').get(id);
  });
  ipcMain.handle('db:pomodoro:stats', (_e, from, to) => {
    const byDay = db.prepare(
      `SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS day,
              SUM(minutes) AS minutes, COUNT(*) AS sessions
       FROM pomodoro_sessions
       WHERE mode = 'work' AND started_at >= ? AND started_at < ?
       GROUP BY day ORDER BY day`
    ).all(from, to);
    const byCourse = db.prepare(
      `SELECT p.course_id AS courseId, c.name AS courseName, c.color AS courseColor,
              SUM(p.minutes) AS minutes, COUNT(*) AS sessions
       FROM pomodoro_sessions p LEFT JOIN courses c ON p.course_id = c.id
       WHERE p.mode = 'work' AND p.started_at >= ? AND p.started_at < ?
       GROUP BY p.course_id ORDER BY minutes DESC`
    ).all(from, to);
    return { byDay, byCourse };
  });
}

// ====== v1.2.3：习惯打卡 ======
function registerHabits(db: DB) {
  ipcMain.handle('db:habits:list', () => {
    const habits = db.prepare('SELECT * FROM habits WHERE archived = 0 ORDER BY sort_order ASC, id ASC').all() as any[];
    const checkins = db.prepare('SELECT habit_id, date FROM habit_checkins').all() as Array<{ habit_id: number; date: string }>;
    const byHabit = new Map<number, string[]>();
    for (const c of checkins) {
      if (!byHabit.has(c.habit_id)) byHabit.set(c.habit_id, []);
      byHabit.get(c.habit_id)!.push(c.date);
    }
    return habits.map((h) => ({ ...h, checkinDates: (byHabit.get(h.id) || []).sort() }));
  });
  ipcMain.handle('db:habits:create', (_e, data) => {
    const info = db.prepare(
      `INSERT INTO habits (name, emoji, color, frequency, target_per_week, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      data.name, data.emoji ?? '🔥', data.color ?? '#00FF88', data.frequency ?? 'daily',
      data.target_per_week ?? null, data.sort_order ?? 0, Date.now()
    );
    return db.prepare('SELECT * FROM habits WHERE id = ?').get(info.lastInsertRowid);
  });
  ipcMain.handle('db:habits:update', (_e, id, data) => {
    db.prepare(
      `UPDATE habits SET name=?, emoji=?, color=?, frequency=?, target_per_week=?, archived=?, sort_order=? WHERE id=?`
    ).run(data.name, data.emoji, data.color, data.frequency, data.target_per_week, data.archived ? 1 : 0, data.sort_order ?? 0, id);
    return db.prepare('SELECT * FROM habits WHERE id = ?').get(id);
  });
  ipcMain.handle('db:habits:delete', (_e, id) => {
    db.prepare('DELETE FROM habit_checkins WHERE habit_id = ?').run(id);
    db.prepare('DELETE FROM habits WHERE id = ?').run(id);
    return { ok: true };
  });
  // 打卡 / 取消打卡（同一天幂等切换）
  ipcMain.handle('db:habits:toggleCheckin', (_e, habitId, date) => {
    const existing = db.prepare('SELECT id FROM habit_checkins WHERE habit_id = ? AND date = ?').get(habitId, date);
    if (existing) {
      db.prepare('DELETE FROM habit_checkins WHERE id = ?').run((existing as any).id);
      return { ok: true, checked: false };
    }
    db.prepare('INSERT INTO habit_checkins (habit_id, date, created_at) VALUES (?, ?, ?)').run(habitId, date, Date.now());
    return { ok: true, checked: true };
  });
}

// ====== v1.2.3：出勤 ======
function registerAttendance(db: DB) {
  ipcMain.handle('db:attendance:list', (_e, filter) => {
    let sql = `SELECT a.*, c.name as course_name, c.color as course_color
               FROM attendance a LEFT JOIN courses c ON a.course_id = c.id`;
    const params: any[] = [];
    if (filter?.courseId) { sql += ' WHERE a.course_id = ?'; params.push(filter.courseId); }
    sql += ' ORDER BY a.date DESC';
    return db.prepare(sql).all(params);
  });
  ipcMain.handle('db:attendance:upsert', (_e, data) => {
    db.prepare(
      `INSERT INTO attendance (course_id, date, status, note, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(course_id, date) DO UPDATE SET status = excluded.status, note = excluded.note`
    ).run(data.course_id, data.date, data.status, data.note ?? null, Date.now());
    return db.prepare('SELECT * FROM attendance WHERE course_id = ? AND date = ?').get(data.course_id, data.date);
  });
  ipcMain.handle('db:attendance:stats', (_e, courseId) => {
    const sql = `SELECT status, COUNT(*) AS n FROM attendance ${courseId ? 'WHERE course_id = ?' : ''} GROUP BY status`;
    const rows = courseId ? db.prepare(sql).all(courseId) : db.prepare(sql).all();
    const out: Record<string, number> = { present: 0, late: 0, absent: 0, leave: 0 };
    for (const r of rows as any[]) out[r.status] = r.n;
    return out;
  });
}

// ====== v1.2.3：统计报表（周报 / 月报聚合） ======
function registerStatsReport(db: DB) {
  ipcMain.handle('db:stats:report', (_e, from, to) => {
    const reqDoneByDay = db.prepare(
      `SELECT strftime('%Y-%m-%d', completed_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
       FROM course_requirements
       WHERE completed_at >= ? AND completed_at < ?
       GROUP BY day ORDER BY day`
    ).all(from, to);
    const reqDoneByCourse = db.prepare(
      `SELECT r.course_id AS courseId, c.name AS courseName, c.color AS courseColor, COUNT(*) AS n
       FROM course_requirements r LEFT JOIN courses c ON r.course_id = c.id
       WHERE r.completed_at >= ? AND r.completed_at < ?
       GROUP BY r.course_id ORDER BY n DESC`
    ).all(from, to);
    const habitCheckinsByDay = db.prepare(
      `SELECT date AS day, COUNT(*) AS n
       FROM habit_checkins WHERE date >= ? AND date < ?
       GROUP BY date ORDER BY date`
    ).all(dayjsDate(from), dayjsDate(to));
    const attendanceSummary = (() => {
      const rows = db.prepare(
        `SELECT status, COUNT(*) AS n FROM attendance WHERE date >= ? AND date < ? GROUP BY status`
      ).all(dayjsDate(from), dayjsDate(to));
      const out: Record<string, number> = { present: 0, late: 0, absent: 0, leave: 0 };
      for (const r of rows as any[]) out[r.status] = r.n;
      return out;
    })();
    return { reqDoneByDay, reqDoneByCourse, habitCheckinsByDay, attendanceSummary, range: { from, to } };
  });
}

/** 毫秒时间戳 → 'YYYY-MM-DD'（本地时区） */
function dayjsDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function registerAllIpc(db: DB) {
  // 统一 IPC 错误包装：所有 handler 的异常都记入主进程日志后再抛回渲染进程。
  // 保持 rejection 语义（页面侧现有 .catch / try-catch 不受影响），但主进程可留痕排查。
  const origHandle = ipcMain.handle.bind(ipcMain);
  (ipcMain as { handle: typeof ipcMain.handle }).handle = (channel: string, fn: (...args: any[]) => any) => {
    origHandle(channel, (...args: unknown[]) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((err) => {
            console.error(`[IPC:${channel}]`, err);
            throw err;
          });
        }
        return result;
      } catch (err) {
        console.error(`[IPC:${channel}]`, err);
        throw err;
      }
    });
  };

  registerCourses(db);
  registerRequirements(db);
  registerEvents(db);
  registerCategories(db);
  registerProjects(db);
  registerTasks(db);
  registerSettings(db);
  registerUserProfiles(db);
  registerCourseNotes(db);
  registerCourseMiniPrograms(db);
  registerStats(db);
  registerIcsExport();
  registerMiniProgram();
  registerUstb(db);
  registerBackup(db, getDbPath());
  registerUpdater(db);
  registerHomework(db);
  registerXlsImport(db);
  registerAbout(db);
  // v1.1.6：输入框失灵埋点（块 3）—— 不依赖 db，save dialog 不传 parent 即可
  registerInputDiagIpc();
  // v1.1.9：自动清理 & 回收站
  registerCleanup(db);
  // v1.2.1 画布编辑器（达芬奇式节点连线）
  registerCanvases(db);
  registerCanvasNodes(db);
  registerCanvasEdges(db);
  // v1.2.3 学业 / 专注 / 习惯 / 出勤 / 统计报表
  registerGrades(db);
  registerExams(db);
  registerPomodoro(db);
  registerHabits(db);
  registerAttendance(db);
  registerStatsReport(db);
  // v1.2.3 WebDAV 云同步
  registerWebdav(db);
  // v1.2.6 付费体系（纯本地，月卡 30 天计时；v1.2.5 班级系统已删除）
  registerBilling(db);
  // v1.2.7 P2P 班级（GitHub raw + 北科云盘双源；去 VPS 化）
  registerClass(db);
}