import { dialog, ipcMain } from 'electron';
import type { Database } from 'better-sqlite3';
import * as XLSX from 'xlsx';
import type { ParsedClassItem } from '../ustb/api';
import { safetyBackup } from '../backup';
import { refreshCourseKeys } from '../db/index';
import { detectProfile, getProfile, listProfiles } from './profiles';
import { autoMapping, parseRecords, toRecords } from './profiles/generic';
import { FALLBACK_PERIODS } from './profiles/shared';
import type { FieldMapping, ProfileInfo } from './profiles/types';

const DAY = 86400000;

export interface ParseResult {
  sheetName: string;
  /** 用了哪个学校档案（UI 回显；用户可以在下拉框里改） */
  profile: ProfileInfo;
  /** 猜测的档案与置信度（>=85 才算「像」；否则提示用户手选） */
  detected: { id: string; confidence: number };
  /** 格子表档案不需要列映射向导 */
  needMapping: boolean;
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  mapping: FieldMapping;
  preview: ParsedClassItem[];
  items: ParsedClassItem[];
  warnings: string[];
  stats: { parsed: number; skipped: number };
  /** 解析过程中遇到的异常条目（前 5 条） */
  badRows: { row: number; reason: string }[];
  /** 从文件里读出的学期信息（学年/学期/开学日/总周数）—— 导入向导据此预填 */
  term?: { xn: string; xq: '1' | '2'; semesterStart?: number; totalWeeks?: number };
}

export interface ImportOptions {
  xn: string;          // 学年，如 "2025-2026"
  xq: '1' | '2';       // 学期
  semesterStart: number; // 第 1 周周一毫秒
  /** 替换之前任何类型的「自动导入」课表（USTB / XLS），默认 true */
  replaceExisting: boolean;
}

export interface ImportSummary {
  courses: number;
  events: number;
  items: number;
  courseIds: number[];
  warnings: string[];
}

/** ========== 文件选择 ========== */
async function pickFile(): Promise<string | null> {
  const r = await dialog.showOpenDialog({
    title: '选择课表 Excel 文件',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm', 'csv'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
}

/** ========== IPC：解析文件（按学校档案分发） ========== */
async function parseFile(filePath: string, profileId?: string): Promise<ParseResult> {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel 文件没有可用的工作表');
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) as unknown[][];

  const detected = detectProfile(aoa);
  const id = profileId || detected.id;
  const profile = getProfile(id) || getProfile('generic');
  if (!profile) throw new Error(`未知的课表档案：${id}`);

  const out = profile.parse(aoa);
  const headers = out.headers || [];
  const rows = out.rows || [];
  return {
    sheetName,
    profile: { id: profile.id, name: profile.name, layout: profile.layout, note: profile.note },
    detected,
    needMapping: out.needMapping,
    headers,
    rows,
    totalRows: rows.length,
    mapping: out.mapping || autoMapping(headers),
    preview: out.items.slice(0, 12),
    items: out.items,
    warnings: out.warnings,
    stats: { parsed: out.items.length, skipped: out.badRows.length },
    badRows: out.badRows.slice(0, 5),
    term: out.term,
  };
}

/** 重新解析（用户在向导里改了列映射后）—— 只有记录表档案需要 */
function reparse(parsed: ParseResult, mapping: FieldMapping): ParseResult {
  if (!parsed.needMapping) return parsed;
  const { items, warnings, badRows } = parseRecords(parsed.headers, parsed.rows, mapping);
  return {
    ...parsed,
    mapping,
    preview: items.slice(0, 12),
    items,
    warnings,
    badRows: badRows.slice(0, 5),
    stats: { parsed: items.length, skipped: badRows.length },
  };
}

/** ========== 写入数据库（仿 importCurriculum） ========== */
const PALETTE = ['#00FF88', '#00D4FF', '#FFD166', '#FF6B9D', '#A78BFA', '#4ADE80', '#F97316', '#22D3EE', '#F472B6', '#FACC15'];

function normalizeToMonday(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getTime();
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function importFromXls(db: Database, items: ParsedClassItem[], opts: ImportOptions): ImportSummary {
  const warnings: string[] = [];
  if (items.length === 0) throw new Error('没有可导入的课程数据');

  const groups = new Map<string, ParsedClassItem[]>();
  for (const it of items) {
    const arr = groups.get(it.className);
    if (arr) arr.push(it); else groups.set(it.className, [it]);
  }

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

    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  };

  const courseIds: number[] = [];
  let eventCount = 0;

  const run = db.transaction(() => {
    // 替换旧导入：先清掉 XLS 自身的上次记录（按 xls_imported_courses）
    if (opts.replaceExisting !== false) {
      const prevXls = db.prepare("SELECT value FROM settings WHERE key='xls_imported_courses'").get() as { value: string } | undefined;
      if (prevXls) {
        try {
          for (const id of JSON.parse(prevXls.value) as number[]) deleteCourseCascade(id);
        } catch { /* ignore */ }
      }
      // 同时清掉 USTB 导入，避免两套课表并存
      const prevUst = db.prepare("SELECT value FROM settings WHERE key='ustb_imported_courses'").get() as { value: string } | undefined;
      if (prevUst) {
        try {
          for (const id of JSON.parse(prevUst.value) as number[]) deleteCourseCascade(id);
        } catch { /* ignore */ }
      }
    }

    for (const [name, its] of groups) {
      const color = PALETTE[hashString(name) % PALETTE.length];
      const teachers = [...new Set(its.map(i => i.teacher).filter(Boolean))].join('、');
      const info = insertCourse.run(
        name, null, teachers || null, semester, color,
        `Excel 课表导入 · ${termLabel}`,
        JSON.stringify(['Excel课表']),
        Date.now()
      );
      const courseId = Number(info.lastInsertRowid);
      courseIds.push(courseId);

      for (const it of its) {
        const fallback = FALLBACK_PERIODS[it.period] ?? ['08:00', '09:35'];
        const [sh, sm] = fallback[0].split(':').map(Number);
        const [eh, em] = fallback[1].split(':').map(Number);
        if (!FALLBACK_PERIODS[it.period]) warnings.push(`第${it.period}大节无对照表，按默认 ${fallback[0]}-${fallback[1]} 处理`);

        for (const w of it.weeks) {
          const base = new Date(monday0 + (w - 1) * 7 * DAY + (it.day - 1) * DAY);
          const startAt = base.setHours(sh, sm, 0, 0);
          const endAt = base.setHours(eh, em, 0, 0);
          const notes = [it.periodName, it.weeksText, it.teacher].filter(Boolean).join(' · ') || null;
          insertEvent.run(name, startAt, endAt, it.location || null, courseId, color, notes);
          eventCount++;
        }
      }
    }

    setSetting.run('xls_imported_courses', JSON.stringify(courseIds));
    setSetting.run('xls_last_sync', String(Date.now()));
    setSetting.run('xls_term', JSON.stringify({ xn: opts.xn, xq: opts.xq }));
    setSetting.run('semester_start', String(monday0));
    setSetting.run('semester', semester);
  });
  run();
  // v1.1.7：导入完刷新课程通用固定 ID（courseKey，作业同步挂载依据）
  refreshCourseKeys(db);

  return { courses: groups.size, events: eventCount, items: items.length, courseIds, warnings: [...new Set(warnings)] };
}

/** ========== IPC 注册 ========== */
export function registerXlsImport(db: Database) {
  ipcMain.handle('xls:pickFile', () => pickFile());
  /** 渲染层渲染学校下拉框用；用户选定后把 profileId 传给 parseFile */
  ipcMain.handle('xls:listProfiles', () => listProfiles());
  ipcMain.handle('xls:parseFile', (_e, filePath: string, profileId?: string) => parseFile(filePath, profileId));
  ipcMain.handle('xls:reparse', (_e, parsed: ParseResult, mapping: FieldMapping) => reparse(parsed, mapping));
  // 导入会按 replaceExisting 连带删除已有 XLS/教务课表 —— 执行前先做安全备份（backups/pre-import-*.db），
  // 一旦导入结果不符合预期，用户可从备份找回（2026-09-17 课表丢失事故的教训）。
  ipcMain.handle('xls:importItems', async (_e, items: ParsedClassItem[], opts: ImportOptions) => {
    try { await safetyBackup(db); } catch { /* 备份失败不阻断导入，但一般不会失败 */ }
    return importFromXls(db, items, opts);
  });
  ipcMain.handle('xls:lastImport', () => {
    const r = db.prepare("SELECT value FROM settings WHERE key='xls_last_sync'").get() as { value: string } | undefined;
    const c = db.prepare("SELECT value FROM settings WHERE key='xls_imported_courses'").get() as { value: string } | undefined;
    let count = 0;
    if (c?.value) { try { count = (JSON.parse(c.value) as number[]).length; } catch { /* ignore */ } }
    return { lastSync: r ? Number(r.value) : 0, courseCount: count };
  });
}
