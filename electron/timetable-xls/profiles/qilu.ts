/**
 * 齐鲁理工大学 —— 课表导出解析档案（格子表）。
 *
 * 样本：2026级医学影像技术3班。表结构：
 *   第 1 行 标题（合并）：「2026-2027年第1学期」「2026级医学影像技术3班课表」
 *   第 2 行 表头：`节次 | (空) | 星期一 … 星期日`
 *   之后每行 = 一个时段：列 0 = 上午/下午/晚上，列 1 = 大节序号（一…七），其余列 = 星期一…日
 *   表尾 `本学期2026-09-07正式上课至2026-12-27结束，共16周` ← 直接当开学日用
 */
import type { SchoolProfile, ProfileParseResult } from './types';
import { normalizeAoa } from './shared';
import { QILU_DAY_NAMES, isFooterRow, parseQiluCell } from './qiluCell';

/** 找到「星期一…星期日」所在行；返回该行与各星期所在的列下标 */
function findHeaderRow(aoa: string[][]): { row: number; cols: number[] } | null {
  const limit = Math.min(aoa.length, 8);
  for (let r = 0; r < limit; r++) {
    const cols: number[] = [];
    QILU_DAY_NAMES.forEach((name, i) => {
      const idx = aoa[r].findIndex((c) => c.replace(/\s/g, '') === name);
      if (idx >= 0) cols[i] = idx;
    });
    if (cols.filter((c) => c !== undefined).length >= 4) return { row: r, cols };
  }
  return null;
}

/** 大节序号「一…七」或「1…7」→ 1-7 */
function bigSessionNo(s: string): number {
  const t = (s || '').trim();
  if (/^[一二三四五六七]$/.test(t)) return '一二三四五六七'.indexOf(t) + 1;
  const n = parseInt(t, 10);
  return n >= 1 && n <= 9 ? n : 0;
}

/** 对齐到当周周一（学期第 1 周必须是周一） */
function mondayOf(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getTime();
}

/** 从表尾/标题里挖学期信息：学年、学期、开学日、总周数 */
function readTerm(aoa: string[][]): ProfileParseResult['term'] {
  const all = aoa.map((r) => r.join(' ')).join(' ');
  const title = aoa.slice(0, 3).map((r) => r.join(' ')).join(' ');
  const tm = title.match(/(\d{4})\s*[-~]\s*(\d{4})\s*年\s*第\s*([12])\s*学期/);
  const term: NonNullable<ProfileParseResult['term']> | undefined = tm
    ? { xn: `${tm[1]}-${tm[2]}`, xq: (tm[3] === '2' ? '2' : '1') as '1' | '2', semesterStart: undefined, totalWeeks: undefined }
    : undefined;
  const sm = all.match(/本学期\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})\s*日?\s*正式上课/);
  // 总周数必须跟「正式上课…结束」在同一句里取 —— 否则会先撞上「实践课程…(共1周)」
  // 这种括号里的共X周，把 16 周读成 1 周（这是实测踩到的）。
  const wm = all.match(/正式上课至\s*[\d-/年]+\s*日?\s*结束[，,]?\s*共\s*(\d+)\s*周/);
  if (term && sm) {
    term.semesterStart = mondayOf(new Date(Number(sm[1]), Number(sm[2]) - 1, Number(sm[3]), 0, 0, 0, 0).getTime());
  }
  if (term && wm) term.totalWeeks = Number(wm[1]);
  return term;
}

/** 「实践课程：」「其他课程：」这两行只有周次、没有星期节次 → 统计出来告知用户 */
function readSkipped(aoa: string[][]): string[] {
  const out: string[] = [];
  aoa.forEach((row) => {
    const m = (row[0] || '').trim().match(/^(实践课程|其他课程)[：:](.*)/);
    if (!m) return;
    const n = m[2].split(/[;；]/).filter((s) => s.trim()).length;
    if (n) out.push(`${m[1]} ${n} 门`);
  });
  return out;
}

export const qiluProfile: SchoolProfile = {
  id: 'qilu',
  name: '齐鲁理工大学',
  layout: 'grid',
  note: '教务「课表」页导出的格子表（行=节次、列=星期，一格里可能有多门课）',

  detect(aoaRaw: unknown[][]): number {
    const aoa = normalizeAoa(aoaRaw);
    if (!findHeaderRow(aoa)) return 0;
    let score = 60;
    // 格子里有「(1-2节)9-16周」这种锚点
    if (aoa.some((r) => r.some((c) => /\d+\s*[-~～]\s*\d+\s*节\s*[)）]/.test(c)))) score += 25;
    // 表尾那行自带字段顺序说明 / 开学日 —— 这是齐鲁理工导出的强特征
    if (aoa.some((r) => r.some((c) => /内容顺序为|正式上课|选课人数/.test(c)))) score += 15;
    return Math.min(score, 100);
  },

  parse(aoaRaw: unknown[][]): ProfileParseResult {
    const aoa = normalizeAoa(aoaRaw);
    const warnings: string[] = [];
    const badRows: { row: number; reason: string }[] = [];
    const items: ReturnType<typeof parseQiluCell>['items'] = [];

    const header = findHeaderRow(aoa);
    if (!header) {
      return {
        needMapping: false, items, badRows,
        warnings: ['没找到「星期一…星期日」这一行 —— 这份文件不是齐鲁理工的课表导出格式，请换一个学校档案试试'],
      };
    }

    // 大节列：在最左边那列星期之前，找形如「一…七」且命中 ≥2 行的列
    const dayCols = header.cols.filter((c) => c !== undefined).sort((a, b) => a - b);
    const firstDayCol = dayCols[0];
    let sessionCol = -1;
    for (let c = 0; c < firstDayCol; c++) {
      const hits = aoa.slice(header.row + 1).filter((r) => !isFooterRow(r))
        .filter((r) => bigSessionNo(r[c] || '') > 0).length;
      if (hits >= 2) { sessionCol = c; break; }
    }
    if (sessionCol < 0) warnings.push('没找到节次列（上午/下午 那一列），时间可能按默认大节填');

    for (let r = header.row + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (isFooterRow(row)) break;
      const rowSession = sessionCol >= 0 ? bigSessionNo(row[sessionCol] || '') : 0;
      header.cols.forEach((col, dayIdx) => {
        if (col === undefined) return;
        const { items: got, bad } = parseQiluCell(row[col] || '', dayIdx + 1, rowSession, r + 1);
        items.push(...got);
        bad.forEach((reason) => badRows.push({ row: r + 1, reason }));
      });
    }

    const term = readTerm(aoa);
    if (!term) warnings.push('文件里没读到「学年 / 第几学期」，请在校验页手动填');
    else if (!term.semesterStart) warnings.push('文件里没读到开学日（「本学期…正式上课」），请手动填开学日');
    else warnings.push(`已从文件读出：${term.xn} 学年 第 ${term.xq} 学期 · 开学 ${new Date(term.semesterStart).toLocaleDateString('zh-CN')}${term.totalWeeks ? ` · 共 ${term.totalWeeks} 周` : ''}`);

    const skipped = readSkipped(aoa);
    if (skipped.length) {
      warnings.push(`以下内容没有星期/节次，未导入：${skipped.join('、')}（可在教务系统单独查看）`);
    }
    if (!items.length) warnings.push('一格课程都没解析出来，请确认选对了学校档案');

    return { needMapping: false, items, warnings, badRows, term };
  },
};
