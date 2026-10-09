/** 通用档案：一行一节课的记录表，靠表头关键词映射列（兜底档案）。 */
import type { SchoolProfile, ProfileParseResult, FieldMapping } from './types';
import { cellToString, normalizeAoa, parseDay, parsePeriodList } from './shared';
import type { ParsedClassItem } from '../../ustb/api';
import { parseWeeksText } from '../../ustb/api';

const FIELD_PATTERNS: Record<keyof FieldMapping, RegExp[]> = {
  className: [/^课程名称?$/, /课程名/, /^课名$/, /课程/, /class ?name/i, /course/i],
  teacher: [/^(任课|主讲)?教师(姓名)?$/, /老师/, /讲师/, /^teacher$/i, /instructor/i],
  weeks: [/^周次(范围)?$/, /^上课周次$/, /^开课周次$/, /周次$/, /weeks?/i],
  day: [/^星期[一二三四五六天日\d]?$/, /^周[一二三四五六日天]$/, /^上课星期$/, /^星期$/, /weekday/i, /^day$/i],
  period: [/^节次$/, /^上课节次$/, /^节$/, /^节数$/, /^大节$/, /period/i, /section/i],
  location: [/^上课(地点|教室)$/, /^教室$/, /^地点$/, /^上课位置$/, /^classroom$/i, /^location$/i, /^room$/i],
};

/** 表头关键词 → 列下标；越靠前的 pattern 越准 */
export function autoMapping(headers: string[]): FieldMapping {
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

/** 表 → 每行的字段值（跳过表头行） */
export function toRecords(aoa: unknown[][]): { headers: string[]; rows: Record<string, string>[] } {
  const matrix = aoa.map((r) => (r || []).map(cellToString));
  const headerRow = (matrix[0] || []).map((h, i) => h || `列${i + 1}`);
  const rows = matrix.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    r.forEach((v, i) => { if (i < headerRow.length) obj[headerRow[i]] = v; });
    return obj;
  });
  return { headers: headerRow, rows };
}

/** 取一行的指定列 */
function col(row: Record<string, string>, headers: string[], idx: number): string {
  if (idx < 0 || idx >= headers.length) return '';
  return cellToString(row[headers[idx]]);
}

/** 行 → 课程条目（按映射取列；week/period 支持多值） */
export function parseRecords(
  headers: string[],
  rows: Record<string, string>[],
  mapping: FieldMapping,
): { items: ParsedClassItem[]; warnings: string[]; badRows: { row: number; reason: string }[] } {
  const items: ParsedClassItem[] = [];
  const warnings: string[] = [];
  const badRows: { row: number; reason: string }[] = [];

  rows.forEach((row, i) => {
    const className = col(row, headers, mapping.className);
    if (!className) { badRows.push({ row: i + 2, reason: '课程名为空' }); return; }

    const teacher = col(row, headers, mapping.teacher);
    const weeksText = col(row, headers, mapping.weeks);
    const dayText = col(row, headers, mapping.day);
    const periodText = col(row, headers, mapping.period);
    const location = col(row, headers, mapping.location);

    const day = parseDay(dayText);
    if (!day) { badRows.push({ row: i + 2, reason: `星期解析失败：「${dayText}」` }); return; }

    const weeks = parseWeeksText(weeksText || '');
    if (!weeks.length) { badRows.push({ row: i + 2, reason: `周次解析失败：「${weeksText}」` }); return; }

    const { items: periods } = parsePeriodList(periodText);
    if (!periods.length) { badRows.push({ row: i + 2, reason: `节次解析失败：「${periodText}」` }); return; }

    for (const p of periods) {
      items.push({ day, period: p.period, className, teacher, weeksText, weeks, location, periodName: p.periodName });
    }
  });

  if (!items.length && rows.length) warnings.push('未解析出任何课程，请检查列映射是否正确');
  return { items, warnings, badRows };
}

export const genericProfile: SchoolProfile = {
  id: 'generic',
  name: '通用（一行一节课）',
  layout: 'records',
  note: '任何学校都能用：表格每行一节课，含「课程名称/教师/周次/星期/节次/教室」等列，识别错的可在向导里手动指定',

  detect(aoaRaw: unknown[][]): number {
    const aoa = normalizeAoa(aoaRaw);
    if (aoa.length < 2) return 0;
    const m = autoMapping((aoa[0] || []).map(cellToString));
    const hits = Object.values(m).filter((v) => v >= 0).length;
    return hits >= 3 ? Math.min(40 + hits * 10, 90) : 0;
  },

  parse(aoaRaw: unknown[][]): ProfileParseResult {
    const aoa = normalizeAoa(aoaRaw);
    const { headers, rows } = toRecords(aoa);
    if (aoa.length < 2) {
      return { needMapping: true, headers, rows, mapping: autoMapping(headers), items: [], badRows: [], warnings: ['文件少于 2 行，无法识别表头'] };
    }
    const mapping = autoMapping((aoa[0] || []).map(cellToString));
    const { items, warnings, badRows } = parseRecords(headers, rows, mapping);

    const missing: string[] = [];
    if (mapping.className < 0) missing.push('课程名称');
    if (mapping.weeks < 0) missing.push('周次');
    if (mapping.day < 0) missing.push('星期');
    if (mapping.period < 0) missing.push('节次/时间');
    if (missing.length) warnings.push(`自动识别失败：未找到「${missing.join('、')}」列，请在向导里手动指定`);

    return { needMapping: true, headers, rows, mapping, items, warnings, badRows };
  },
};
