/**
 * lunar-javascript 的简易类型声明（v1.6.12）。
 * 仅覆盖本项目用到的 Solar / Lunar / HolidayUtil。
 */
declare module 'lunar-javascript' {
  export class Solar {
    static fromDate(d: Date): Solar;
    static fromYmd(y: number, m: number, d: number): Solar;
    toString(): string;
    /** 转农历对象 */
    getLunar(): Lunar;
    /** 阳历节日（如元旦、国庆） */
    getFestivals(): string[];
    /** 阳历其他节日（如母亲节、感恩节） */
    getOtherFestivals(): string[];
  }

  export class Lunar {
    /** 干支纪年的中文（如"二〇二六"） */
    getYearInChinese(): string;
    /** 月份的中文（"正", "二", ..., "腊"，闰月带 "闰" 前缀） */
    getMonthInChinese(): string;
    /** 日子（"初一", "初二", ..., "廿八", "三十"） */
    getDayInChinese(): string;
    /** 月份数字（闰月返回负数） */
    getMonth(): number;
    /** 农历节日（春节、中秋等） */
    getFestivals(): string[];
    /** 节气名（如"立春"，没有则为空串） */
    getJieQi(): string;
    toString(): string;
  }

  export const HolidayUtil: {
    /** 获取 yyyy-MM-dd 的法定节假日/调休（库内 2001-2025 数据） */
    getHoliday(yyyyMmDd: string): {
      getDay(): string;
      getName(): string;
      isWork(): boolean;
      getTarget(): string;
      toString(): string;
    } | null;
  };
}