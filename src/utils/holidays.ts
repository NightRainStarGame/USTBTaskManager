/**
 * 中国法定节假日（手动维护，因为 lunar-javascript 1.6.12 内置节假日数据
 * 截至 2025 年底，2026+ 需要补充）。
 *
 * 字段：
 *  - date: 'YYYY-MM-DD'
 *  - name: 中文节假日名
 *  - type: 'legal' 法定节假日 / 'work' 调休补班
 *
 * 数据来源：每年国务院办公厅发布的放假通知。
 */

export interface HolidayEntry {
  date: string;
  name: string;
  type: 'legal' | 'work';
}

export const HOLIDAYS: HolidayEntry[] = [
  // ====== 2026 年 ======
  // 元旦：1月1日-1月3日放假，共3天（1/4 上班）
  { date: '2026-01-01', name: '元旦', type: 'legal' },
  { date: '2026-01-02', name: '元旦', type: 'legal' },
  { date: '2026-01-03', name: '元旦', type: 'legal' },
  { date: '2026-01-04', name: '补班', type: 'work' },
  // 春节：2月17日(除夕)-2月23日放假，共7天；2/14、2/28 补班
  { date: '2026-02-14', name: '补班', type: 'work' },
  { date: '2026-02-17', name: '春节', type: 'legal' },
  { date: '2026-02-18', name: '春节', type: 'legal' },
  { date: '2026-02-19', name: '春节', type: 'legal' },
  { date: '2026-02-20', name: '春节', type: 'legal' },
  { date: '2026-02-21', name: '春节', type: 'legal' },
  { date: '2026-02-22', name: '春节', type: 'legal' },
  { date: '2026-02-23', name: '春节', type: 'legal' },
  { date: '2026-02-28', name: '补班', type: 'work' },
  // 清明：4月4日-4月6日放假，共3天
  { date: '2026-04-04', name: '清明节', type: 'legal' },
  { date: '2026-04-05', name: '清明节', type: 'legal' },
  { date: '2026-04-06', name: '清明节', type: 'legal' },
  // 劳动节：5月1日-5月3日放假，共3天
  { date: '2026-05-01', name: '劳动节', type: 'legal' },
  { date: '2026-05-02', name: '劳动节', type: 'legal' },
  { date: '2026-05-03', name: '劳动节', type: 'legal' },
  // 端午：6月19日-6月21日放假，共3天
  { date: '2026-06-19', name: '端午节', type: 'legal' },
  { date: '2026-06-20', name: '端午节', type: 'legal' },
  { date: '2026-06-21', name: '端午节', type: 'legal' },
  // 中秋：9月25日-9月27日放假，共3天
  { date: '2026-09-25', name: '中秋节', type: 'legal' },
  { date: '2026-09-26', name: '中秋节', type: 'legal' },
  { date: '2026-09-27', name: '中秋节', type: 'legal' },
  // 国庆：10月1日-10月7日放假，共7天；9/27、10/10 补班
  { date: '2026-09-27', name: '补班', type: 'work' },
  { date: '2026-10-01', name: '国庆节', type: 'legal' },
  { date: '2026-10-02', name: '国庆节', type: 'legal' },
  { date: '2026-10-03', name: '国庆节', type: 'legal' },
  { date: '2026-10-04', name: '国庆节', type: 'legal' },
  { date: '2026-10-05', name: '国庆节', type: 'legal' },
  { date: '2026-10-06', name: '国庆节', type: 'legal' },
  { date: '2026-10-07', name: '国庆节', type: 'legal' },
  { date: '2026-10-10', name: '补班', type: 'work' },

  // ====== 2027 年（预估；待官方发布） ======
  { date: '2027-01-01', name: '元旦', type: 'legal' },
  { date: '2027-01-02', name: '元旦', type: 'legal' },
  { date: '2027-01-03', name: '元旦', type: 'legal' },
  { date: '2027-02-06', name: '春节', type: 'legal' },
  { date: '2027-02-07', name: '春节', type: 'legal' },
  { date: '2027-02-08', name: '春节', type: 'legal' },
  { date: '2027-02-09', name: '春节', type: 'legal' },
  { date: '2027-02-10', name: '春节', type: 'legal' },
  { date: '2027-02-11', name: '春节', type: 'legal' },
  { date: '2027-02-12', name: '春节', type: 'legal' },
  { date: '2027-04-04', name: '清明节', type: 'legal' },
  { date: '2027-04-05', name: '清明节', type: 'legal' },
  { date: '2027-04-06', name: '清明节', type: 'legal' },
  { date: '2027-05-01', name: '劳动节', type: 'legal' },
  { date: '2027-05-02', name: '劳动节', type: 'legal' },
  { date: '2027-05-03', name: '劳动节', type: 'legal' },
  { date: '2027-06-09', name: '端午节', type: 'legal' },
  { date: '2027-06-10', name: '端午节', type: 'legal' },
  { date: '2027-06-11', name: '端午节', type: 'legal' },
  { date: '2027-09-15', name: '中秋节', type: 'legal' },
  { date: '2027-09-16', name: '中秋节', type: 'legal' },
  { date: '2027-09-17', name: '中秋节', type: 'legal' },
  { date: '2027-10-01', name: '国庆节', type: 'legal' },
  { date: '2027-10-02', name: '国庆节', type: 'legal' },
  { date: '2027-10-03', name: '国庆节', type: 'legal' },
  { date: '2027-10-04', name: '国庆节', type: 'legal' },
  { date: '2027-10-05', name: '国庆节', type: 'legal' },
  { date: '2027-10-06', name: '国庆节', type: 'legal' },
  { date: '2027-10-07', name: '国庆节', type: 'legal' },
];

const holidayMap = new Map<string, HolidayEntry>();
for (const h of HOLIDAYS) holidayMap.set(h.date, h);

export function getHoliday(date: string): HolidayEntry | undefined {
  return holidayMap.get(date);
}