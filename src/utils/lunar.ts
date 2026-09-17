/**
 * 农历 / 节气 / 节日查询工具。
 * 底层依赖 lunar-javascript。
 */
import { Solar } from 'lunar-javascript';
import { getHoliday } from './holidays';

export interface DateMeta {
  lunarDay: string;
  lunarMonth: string;
  lunarFull: string;
  jieQi: string | null;
  festivals: string[];
  legalHoliday: string | null;
  isWorkDay: boolean;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getDateMeta(date: Date): DateMeta {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();

  const lunarDay = lunar.getDayInChinese();
  // getMonthInChinese 返回 "正", "二" 等；闰月会带 "闰" 字
  let lm = lunar.getMonthInChinese();
  if (lunar.getMonth() < 0) lm = '闰' + lm;
  const lunarMonth = lm;

  const festivals = [
      ...solar.getFestivals(),
      ...solar.getOtherFestivals(),
      ...lunar.getFestivals(),
    ].filter(Boolean);

  const jieQi = lunar.getJieQi() || null;

  // 法定节假日
  const dateStr = ymd(date);
  const legal = getHoliday(dateStr);
  const legalHoliday = legal && legal.type === 'legal' ? legal.name : null;
  const isWorkDay = legal?.type === 'work';

  return {
    lunarDay,
    lunarMonth,
    lunarFull: lunar.toString(),
    jieQi,
    festivals,
    legalHoliday,
    isWorkDay,
  };
}

/**
 * 计算某日期在本学期的周次（第 1 周, 第 2 周...）
 * @param date 当前日期
 * @param semesterStart 设置里的开学日（毫秒时间戳）
 * @returns 周次（1-based）；若在开学前返回 null
 */
export function getSemesterWeek(date: Date, semesterStart: number | undefined | null): number | null {
  if (!semesterStart) return null;
  const start = new Date(semesterStart);
  start.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < start.getTime()) return null;
  // 计算完整经过的天数（含起始日），周数 = floor(diffDays / 7) + 1
  const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

/**
 * 把 Date 转 YYYY-MM-DD 字符串。
 */
export function ymdString(d: Date): string {
  return ymd(d);
}