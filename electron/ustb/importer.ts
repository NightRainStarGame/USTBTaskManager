/**
 * 贝壳课表导入器：把解析后的课表写入本地数据库。
 * 策略：每次导入前先删除「上一次贝壳课表导入的课程」（按 settings.ustb_imported_courses 记录），
 * 手动添加的课程/作业/日程完全不受影响。
 * 事件按周次展开成具体日期（type='class'），保证单双周、跳周都能在日历上精确显示。
 */
import type { Database } from 'better-sqlite3';
import type { ByytPeriod, ParsedClassItem } from './api';
import { refreshCourseKeys } from '../db/index';


export interface ImportOptions {
  xn: string; // 学年，如 "2025-2026"
  xq: string; // 学期，"1"=秋 "2"=春
  semesterStart: number; // 第 1 周周一（本地时间毫秒，会自动规整到周一）
  periods: ByytPeriod[];
}

export interface ImportSummary {
  courses: number;
  events: number;
  items: number;
  courseIds: number[];
  warnings: string[];
}

const DAY = 86400000;

const PALETTE = ['#00FF88', '#00D4FF', '#FFD166', '#FF6B9D', '#A78BFA', '#4ADE80', '#F97316', '#22D3EE', '#F472B6', '#FACC15'];

/** 教务作息接口拿不到时的兜底时间表（大节 → [开始, 结束]） */
const FALLBACK_PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '09:35'],
  2: ['09:50', '11:25'],
  3: ['14:00', '15:35'],
  4: ['15:50', '17:25'],
  5: ['18:30', '20:05'],
  6: ['20:10', '21:45'],
};

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 规整到「所在周的周一 0 点」 */
function normalizeToMonday(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=周日
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getTime();
}

export function importCurriculum(db: Database, items: ParsedClassItem[], opts: ImportOptions): ImportSummary {
  const warnings: string[] = [];

  // 同名课程合并为一门课
  const groups = new Map<string, ParsedClassItem[]>();
  for (const it of items) {
    const arr = groups.get(it.className);
    if (arr) arr.push(it);
    else groups.set(it.className, [it]);
  }

  const periodMap = new Map<number, ByytPeriod>();
  for (const p of opts.periods) periodMap.set(p.majorId, p);

  const monday0 = normalizeToMonday(opts.semesterStart);
  const semester = `${opts.xn}-${opts.xq}`;
  const termLabel = `${opts.xn}学年${opts.xq === '2' ? '春' : '秋'}学期`;

  const insertCourse = db.prepare(
    `INSERT INTO courses (name, code, instructor, semester, color, description, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (title, start_at, end_at, location, recurrence, course_id, color, notes, all_day, type)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, 'class')`
  );
  const setSetting = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  );
  const deleteCourseCascade = (id: number) => {
    db.prepare('DELETE FROM events WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_requirements WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_notes WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_miniprograms WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  };

  const courseIds: number[] = [];
  let eventCount = 0;

  const run = db.transaction(() => {
    // 清除上一次贝壳课表导入的数据
    const prev = db.prepare("SELECT value FROM settings WHERE key='ustb_imported_courses'").get() as
      | { value: string }
      | undefined;
    if (prev) {
      try {
        for (const id of JSON.parse(prev.value) as number[]) deleteCourseCascade(id);
      } catch {
        /* 忽略损坏的记录 */
      }
    }

    for (const [name, its] of groups) {
      const color = PALETTE[hashString(name) % PALETTE.length];
      const teachers = [...new Set(its.map((i) => i.teacher).filter(Boolean))].join('、');
      const info = insertCourse.run(
        name,
        null,
        teachers || null,
        semester,
        color,
        `贝壳课表导入 · ${termLabel}`,
        JSON.stringify(['贝壳课表']),
        Date.now()
      );
      const courseId = Number(info.lastInsertRowid);
      courseIds.push(courseId);

      for (const it of its) {
        const period = periodMap.get(it.period);
        const fallback = FALLBACK_PERIODS[it.period] ?? ['08:00', '09:35'];
        const startStr = period?.start ?? fallback[0];
        const endStr = period?.end ?? fallback[1];
        if (!period) warnings.push(`第${it.period}大节无官方作息时间，按默认 ${startStr}-${endStr} 处理`);

        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        const weeks = it.weeks.length ? it.weeks : Array.from({ length: 18 }, (_, i) => i + 1);
        if (!it.weeks.length) warnings.push(`「${name}」周次「${it.weeksText || '空'}」解析失败，按 1-18 周导入`);

        for (const w of weeks) {
          const base = new Date(monday0 + (w - 1) * 7 * DAY + (it.day - 1) * DAY);
          const startAt = base.setHours(sh, sm, 0, 0);
          const endAt = base.setHours(eh, em, 0, 0);
          const notes = [it.periodName, it.weeksText, it.teacher].filter(Boolean).join(' · ') || null;
          insertEvent.run(name, startAt, endAt, it.location || null, courseId, color, notes);
          eventCount++;
        }
      }
    }

    setSetting.run('ustb_imported_courses', JSON.stringify(courseIds));
    setSetting.run('ustb_last_sync', String(Date.now()));
    setSetting.run('ustb_term', JSON.stringify({ xn: opts.xn, xq: opts.xq }));
    // 写入开学日（第 1 周周一）：让课表/日历能显示「第 N 周」
    setSetting.run('semester_start', String(monday0));
    setSetting.run('semester', semester);
  });
  run();
  // v1.1.7：导入完刷新课程通用固定 ID（courseKey，作业同步挂载依据）
  refreshCourseKeys(db);

  return {
    courses: groups.size,
    events: eventCount,
    items: items.length,
    courseIds,
    warnings: [...new Set(warnings)],
  };
}
