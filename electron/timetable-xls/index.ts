import { dialog, ipcMain } from 'electron';
import type { Database } from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { parseWeeksText, type ParsedClassItem } from '../ustb/api';

const DAY = 86400000;

/** 与教务导入完全相同的兜底时间表 */
const FALLBACK_PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['14:00', '15:35'],
  4: ['15:50', '17:25'], 5: ['18:30', '20:05'], 6: ['20:10', '21:45'],
};

/** 周次关键字识别表（覆盖大多数教务系统/超级课程表导出） */
const FIELD_PATTERNS: Record<keyof FieldMapping, RegExp[]> = {
  className: [/^课程名称?$/, /课程名/, /^课名$/, /课程/, /class ?name/i, /course/i],
  teacher:   [/^(任课|主讲)?教师(姓名)?$/, /老师/, /讲师/, /^teacher$/i, /instructor/i],
  weeks:     [/^周次(范围)?$/, /^上课周次$/, /^开课周次$/, /周次$/, /weeks?/i],
  day:       [/^星期[一二三四五六天日\d]?$/, /^周[一二三四五六日天]$/, /^上课星期$/, /^星期$/, /weekday/i, /^day$/i],
  period:    [/^节次$/, /^上课节次$/, /^节$/, /^节数$/, /^大节$/, /period/i, /section/i],
  location:  [/^上课(地点|教室)$/, /^教室$/, /^地点$/, /^上课位置$/, /^classroom$/i, /^location$/i, /^room$/i],
};

export interface FieldMapping {
  className: number; // -1 表示未映射
  teacher:   number;
  weeks:     number;
  day:       number;
  period:    number;
  location:  number;
}

export interface ParseResult {
  sheetName: string;
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

/** ========== 列头识别 ========== */
function autoMapping(headers: string[]): FieldMapping {
  const m: FieldMapping = { className: -1, teacher: -1, weeks: -1, day: -1, period: -1, location: -1 };
  for (const key of Object.keys(FIELD_PATTERNS) as (keyof FieldMapping)[]) {
    const patterns = FIELD_PATTERNS[key];
    let bestIdx = -1;
    let bestScore = 0;
    headers.forEach((h, idx) => {
      if (!h) return;
      const s = String(h).trim();
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(s)) {
          // 越靠前的 pattern 越准
          const score = 100 - i * 10 + (s === patterns[0].source ? 50 : 0);
          if (score > bestScore) { bestScore = score; bestIdx = idx; }
          break;
        }
      }
    });
    m[key] = bestIdx;
  }
  return m;
}

/** ========== 解析单元格值 ========== */
function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

/** 周日/周X → 1-7 */
function parseDay(s: string): number | null {
  const t = s.trim();
  const map: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
  for (const k of Object.keys(map)) if (t.includes(k)) return map[k];
  if (/^周[一二三四五六日天]$/.test(t)) return map[t[1]];
  if (/^星期[一二三四五六日天]$/.test(t)) return map[t[2]];
  // 数字范围
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 7) return n;
  return null;
}

/**
 * 从节次字符串里取出一组节次（用于事件展开）。
 * - "1-2" / "1~2" → 1 个 item，period=1，periodName="1-2"（一节课连续上 1-2 节）
 * - "1,3,5" → 3 个 item（少见，但保留扩展能力）
 * - "08:00-09:35" → 1 个 item，period 反查大节表
 */
function parsePeriodList(s: string): { items: { period: number; periodName: string }[] } {
  const t = s.replace(/[（()）]/g, '').replace(/第/g, '').trim();
  if (!t) return { items: [] };

  // 时间段 "HH:MM-HH:MM"
  const tr = parseTimeRange(t);
  if (tr.length) return { items: tr.map(x => ({ period: x.period, periodName: t })) };

  const out: { period: number; periodName: string }[] = [];
  for (const part of t.split(/[,，、\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[~\-～]\s*(\d+)$/);
    if (m) {
      // 连续节次：一节课（一项），取首节做 period，全串做 periodName
      const a = +m[1], b = +m[2];
      const [lo, hi] = a < b ? [a, b] : [b, a];
      out.push({ period: lo, periodName: `${lo}-${hi}` });
    } else if (/^\d+$/.test(part)) {
      out.push({ period: +part, periodName: String(+part) });
    }
  }
  return { items: out };
}

/** "08:00-09:09" → [{start,end,period}] */
function parseTimeRange(s: string): { start: string; end: string; period: number }[] {
  const m = s.match(/(\d{1,2}:\d{2})\s*[~\-～—]\s*(\d{1,2}:\d{2})/);
  if (!m) return [];
  const start = m[1].length === 4 ? '0' + m[1] : m[1];
  const end = m[2].length === 4 ? '0' + m[2] : m[2];
  // 从时间段反查大节
  let period = 0;
  for (const [k, v] of Object.entries(FALLBACK_PERIODS)) {
    if (v[0] === start && v[1] === end) { period = +k; break; }
  }
  return [{ start, end, period: period || 0 }];
}

/** 取一行的指定列 */
function col(row: Record<string, string>, headers: string[], idx: number): string {
  if (idx < 0 || idx >= headers.length) return '';
  return cellToString(row[headers[idx]]);
}

/** ========== 解析整张表 → ParsedClassItem[] ========== */
function parseRows(headers: string[], rows: Record<string, string>[], mapping: FieldMapping): {
  items: ParsedClassItem[];
  warnings: string[];
  badRows: { row: number; reason: string }[];
} {
  const items: ParsedClassItem[] = [];
  const warnings: string[] = [];
  const badRows: { row: number; reason: string }[] = [];

  rows.forEach((row, i) => {
    const className = col(row, headers, mapping.className);
    if (!className) {
      badRows.push({ row: i + 2, reason: '课程名为空' });
      return;
    }
    const teacher = col(row, headers, mapping.teacher);
    const weeksText = col(row, headers, mapping.weeks);
    const dayText = col(row, headers, mapping.day);
    const periodText = col(row, headers, mapping.period);
    const location = col(row, headers, mapping.location);

    const day = parseDay(dayText);
    if (!day) { badRows.push({ row: i + 2, reason: `星期解析失败：「${dayText}」` }); return; }

    const weeks = parseWeeksText(weeksText || '');
    if (weeks.length === 0) { badRows.push({ row: i + 2, reason: `周次解析失败：「${weeksText}」` }); return; }

    // period 字段：可能是节次列表、时间段、或 "第1-2节"
    const { items: periods } = parsePeriodList(periodText);
    if (periods.length === 0) {
      badRows.push({ row: i + 2, reason: `节次解析失败：「${periodText}」` });
      return;
    }

    for (const p of periods) {
      items.push({
        day,
        period: p.period,
        className,
        teacher,
        weeksText,
        weeks,
        location,
        periodName: p.periodName,
      });
    }
  });

  if (items.length === 0 && rows.length > 0) {
    warnings.push('未解析出任何课程，请检查列映射是否正确');
  }
  return { items, warnings, badRows };
}

/** ========== IPC：解析文件 ========== */
async function parseFile(filePath: string): Promise<ParseResult> {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Excel 文件没有可用的工作表');
  const sheet = wb.Sheets[sheetName];

  // 把第一行当作表头，剩下的是数据
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
  if (aoa.length < 2) throw new Error('文件少于 2 行，无法识别表头');

  const headerRow = (aoa[0] as unknown[]).map(v => cellToString(v));
  const headers = headerRow.map((h, i) => h || `列${i + 1}`);
  const rows = aoa.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    (r as unknown[]).forEach((v, i) => {
      if (i < headers.length) obj[headers[i]] = cellToString(v);
    });
    return obj;
  });

  const mapping = autoMapping(headerRow);
  const { items, warnings, badRows } = parseRows(headers, rows, mapping);
  const preview = items.slice(0, 12);

  if (mapping.className < 0) warnings.push('⚠ 自动识别失败：未找到「课程名称」列，请在向导里手动指定');
  if (mapping.weeks < 0) warnings.push('⚠ 自动识别失败：未找到「周次」列，请在向导里手动指定');
  if (mapping.day < 0) warnings.push('⚠ 自动识别失败：未找到「星期」列，请在向导里手动指定');
  if (mapping.period < 0) warnings.push('⚠ 自动识别失败：未找到「节次/时间」列，请在向导里手动指定');

  return {
    sheetName,
    headers,
    rows,
    totalRows: rows.length,
    mapping,
    preview,
    items,
    warnings,
    stats: { parsed: items.length, skipped: badRows.length },
    badRows,
  };
}

/** ========== 重新解析（用新映射） ========== */
function reparse(parsed: ParseResult, mapping: FieldMapping): ParseResult {
  const { items, warnings, badRows } = parseRows(parsed.headers, parsed.rows, mapping);
  return { ...parsed, mapping, preview: items.slice(0, 12), items, warnings, badRows, stats: { parsed: items.length, skipped: badRows.length } };
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
    db.prepare('DELETE FROM course_miniprograms WHERE course_id = ?').run(id);
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

  return { courses: groups.size, events: eventCount, items: items.length, courseIds, warnings: [...new Set(warnings)] };
}

/** ========== IPC 注册 ========== */
export function registerXlsImport(db: Database) {
  ipcMain.handle('xls:pickFile', () => pickFile());
  ipcMain.handle('xls:parseFile', (_e, filePath: string) => parseFile(filePath));
  ipcMain.handle('xls:reparse', (_e, parsed: ParseResult, mapping: FieldMapping) => reparse(parsed, mapping));
  ipcMain.handle('xls:importItems', (_e, items: ParsedClassItem[], opts: ImportOptions) => importFromXls(db, items, opts));
  ipcMain.handle('xls:lastImport', () => {
    const r = db.prepare("SELECT value FROM settings WHERE key='xls_last_sync'").get() as { value: string } | undefined;
    const c = db.prepare("SELECT value FROM settings WHERE key='xls_imported_courses'").get() as { value: string } | undefined;
    let count = 0;
    if (c?.value) { try { count = (JSON.parse(c.value) as number[]).length; } catch { /* ignore */ } }
    return { lastSync: r ? Number(r.value) : 0, courseCount: count };
  });
}
