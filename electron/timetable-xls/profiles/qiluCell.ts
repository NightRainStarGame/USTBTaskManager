/**
 * 齐鲁理工大学课表：**一个格子里**的解析（格子表档案的单元格级部分）。
 *
 * 格子长这样（同一格可能有多门课，字段用 `/` 分隔）：
 *   医学影像技术专业导论/22093413/(1-2节)9-16周/ JA210/崔志洁/(2026-2027-1)-22093413-01/2026级…1班;…/94 系统解剖学实验/22093415/(1-2节)6周,14-16周/ 解剖学实验室（2）/苏梦宇/…
 *
 *   1 课程名 / 2 课程号 / 3 (节次)周次 / 4 地点 / 5 教师 / 6 教学班 / 7 教学班组成 / 8 选课人数
 *
 * 麻烦在第 8 段：一格多课时「选课人数」会粘着下一门课的课程名，变成 `93 系统解剖学实验`
 * 这样一个 `/` 段 —— 所以**不能**按「每 8 段一组」切分。
 *
 * 解法：拿第 3 段（`(x-y节)周次`）当锚点（它是全表格式最稳定的一段），从它前后数：
 * 课程名 = 锚点-2，课程号 = 锚点-1；地点/教师取「锚点 → 下一个锚点」之间的段。
 * 课程号本应用用不到（作业同步靠 courseKey），丢弃。
 */
import { parseWeeksText, type ParsedClassItem } from '../../ustb/api';
import { bigSessionOf } from './shared';

export const QILU_DAY_NAMES = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

/** 「(1-2节)9-16周」「(3-4节)6周,14-16周」「(1-2节)9-13周(单)」—— 锚点判定 */
export function isAnchor(seg: string): boolean {
  return /节\s*[)）]/.test(seg) || /\d+\s*[-~～]\s*\d+\s*节/.test(seg);
}

/** 表尾说明行（不是课格）：注-- / 本学期… / 实践课程： / 其他课程： / 打印时间 */
export function isFooterRow(row: string[]): boolean {
  const head = `${row[0] || ''}${row[1] || ''}`;
  return /^注/.test(head) || /^本学期/.test(head)
    || /^(实践课程|其他课程)/.test(head) || /打印时间/.test(head);
}

export interface CellParseResult {
  items: ParsedClassItem[];
  bad: string[];
}

/**
 * 拆一个格子。
 * @param cell        格子原文
 * @param day         星期（1=周一 … 7=周日）
 * @param rowSession  行上标注的大节号（格子文本没写节次时的兜底）
 * @param rowNo       行号（1 起，报错时告诉用户是哪一格）
 */
export function parseQiluCell(cell: string, day: number, rowSession: number, rowNo: number): CellParseResult {
  const items: ParsedClassItem[] = [];
  const bad: string[] = [];
  const text = (cell || '').trim();
  if (!text) return { items, bad };

  const segs = text.split('/').map((s) => s.trim());
  const anchors: number[] = [];
  segs.forEach((s, i) => { if (isAnchor(s)) anchors.push(i); });

  if (!anchors.length) {
    bad.push(`第 ${rowNo} 行 ${QILU_DAY_NAMES[day - 1]}：格子内容看不出字段顺序（${text.slice(0, 40)}…）`);
    return { items, bad };
  }

  for (const a of anchors) {
    // 课程名前可能粘着上一门课的选课人数：`93 系统解剖学实验`
    const className = (segs[a - 2] ?? '').replace(/^\d+\s+/, '').trim();
    if (!className) {
      bad.push(`第 ${rowNo} 行 ${QILU_DAY_NAMES[day - 1]}：课程名解析失败`);
      continue;
    }

    const seg = segs[a];
    // 节次：优先信格子自带的「(1-2节)」，它比行上的大节号更细
    const pm = seg.match(/(\d+)\s*[-~～]\s*(\d+)\s*节/);
    const periodName = pm ? `${+pm[1]}-${+pm[2]}` : '';
    const session = pm ? bigSessionOf(+pm[1]) : rowSession;

    // 周次：取「节」括号之后那段，如 "9-16周" / "6周,14-16周" / "9-13周(单)"
    const cut = seg.search(/节\s*[)）]/);
    let weeksText = cut >= 0 ? seg.slice(cut + 1) : seg.replace(/^.*?节/, '');
    weeksText = weeksText.replace(/^[)）]/, '').trim() || seg.trim();
    // 去掉「周」再交给 parseWeeksText：它只认「数字,数字-数字」这种连续写法，
    // 而学校常写成「6周,14-16周」—— 中间隔着「周」会被截成只剩 6（实测踩到）。
    const weeks = parseWeeksText(weeksText.replace(/周/g, ''));
    if (!weeks.length) {
      bad.push(`第 ${rowNo} 行 ${QILU_DAY_NAMES[day - 1]}「${className}」：周次解析失败（${weeksText}）`);
      continue;
    }

    // 锚点之后到下一个锚点之间：地点 / 教师 /（教学班 / 教学班组成 / 选课人数，本应用不用）
    const nextA = anchors.find((x) => x > a);
    const rest = segs.slice(a + 1, nextA === undefined ? segs.length : nextA);
    const location = (rest[0] ?? '').trim();
    const teacher = (rest[1] ?? '').replace(/^\d+\s+/, '').trim();

    items.push({ day, period: session, className, teacher, weeksText, weeks, location, periodName });
  }

  return { items, bad };
}
