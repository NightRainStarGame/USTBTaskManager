/**
 * 学校档案共用的小工具（**不 import electron**，以便单测直接跑）。
 */
import type { ParsedClassItem } from '../../ustb/api';

/**
 * 大节 → 上课时间。与教务导入用的是同一张表（v1.1.x 起一直没变过）。
 * 没有它就只能把时间留空 —— 而课表视图按时间画的，没有时间等于没导入。
 */
export const FALLBACK_PERIODS: Record<number, [string, string]> = {
  1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['14:00', '15:35'],
  4: ['15:50', '17:25'], 5: ['18:30', '20:05'], 6: ['20:10', '21:45'],
};

/** 每半天 2 个小节 → 大节号 = ceil(首节 / 2)。1-2→1、3-4→2、5-6→3… */
export const PERIODS_PER_BIG_SESSION = 2;

export function bigSessionOf(firstPeriod: number): number {
  if (!Number.isFinite(firstPeriod) || firstPeriod <= 0) return 0;
  return Math.ceil(firstPeriod / PERIODS_PER_BIG_SESSION);
}

/** 单元格 → 去空白的字符串 */
export function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

/** 整表规整成 string[][]（顺手砍掉全空的尾行） */
export function normalizeAoa(aoa: unknown[][]): string[][] {
  const rows = aoa.map((r) => (r || []).map(cellToString));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

/** 周日/周X/数字 → 1-7（周一=1，周日=7） */
export function parseDay(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const map: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  for (const k of Object.keys(map)) if (t.includes(k)) return map[k];
  const n = parseInt(t, 10);
  if (n >= 1 && n <= 7) return n;
  return null;
}

/** "08:00-09:35" → [{start,end,period}]；不是时间段则返回空数组 */
export function parseTimeRange(s: string): { start: string; end: string; period: number }[] {
  const m = s.match(/(\d{1,2}:\d{2})\s*[~\-～—]\s*(\d{1,2}:\d{2})/);
  if (!m) return [];
  const start = m[1].length === 4 ? '0' + m[1] : m[1];
  const end = m[2].length === 4 ? '0' + m[2] : m[2];
  let period = 0;
  for (const [k, v] of Object.entries(FALLBACK_PERIODS)) {
    if (v[0] === start && v[1] === end) { period = +k; break; }
  }
  return [{ start, end, period: period || 0 }];
}

/**
 * 从节次字段里取出一组节次。
 * - "1-2" / "1~2" → 一项，period=1（大节），periodName="1-2"
 * - "1,3,5"       → 三项（少见，保留扩展能力）
 * - "08:00-09:35" → 一项（时间段反查大节）
 */
export function parsePeriodList(s: string): { items: { period: number; periodName: string }[] } {
  const t = s.replace(/[（()）]/g, '').replace(/第/g, '').trim();
  if (!t) return { items: [] };

  const tr = parseTimeRange(t);
  if (tr.length) return { items: tr.map((x) => ({ period: x.period, periodName: t })) };

  const out: { period: number; periodName: string }[] = [];
  for (const part of t.split(/[,，、\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*[~\-～]\s*(\d+)$/);
    if (m) {
      const a = +m[1], b = +m[2];
      const [lo, hi] = a < b ? [a, b] : [b, a];
      out.push({ period: lo, periodName: `${lo}-${hi}` });
    } else if (/^\d+$/.test(part)) {
      out.push({ period: +part, periodName: String(+part) });
    }
  }
  return { items: out };
}
