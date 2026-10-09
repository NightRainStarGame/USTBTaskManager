/**
 * 课表导入「学校档案」的公共类型。
 *
 * 为什么按学校分档案：每所学校的教务系统导出的 xls 布局都不一样 —— 有的是
 * 「一行一节课」的记录表，有的是「行=节次、列=星期」的格子表，列名、字段顺序、
 * 周次写法全不相同。与其写一个谁都不像的万能解析器，不如每所学校一个档案：
 * 解析规则集中在一个文件里，加新学校 = 加一个档案（用户之后会陆续提供样本）。
 *
 * ⚠️ 本目录下的模块**不得 import electron** —— 它们要能被 scripts/test-timetable.js
 * 直接 require 编译产物来验证（见该文件说明）。IPC 与文件选择留在 electron/timetable-xls/index.ts。
 */
import type { ParsedClassItem } from '../../ustb/api';

/** 记录表：一行一节课，靠表头映射（superTable / 通用教务导出） */
export type ProfileLayout = 'grid' | 'records';

/** 列映射：值是列下标，-1 = 未映射（沿用原有语义，UI 的向导直接编辑它） */
export interface FieldMapping {
  className: number;
  teacher: number;
  weeks: number;
  day: number;
  period: number;
  location: number;
}

export interface ProfileParseResult {
  /** 记录表：原始表头与行，供 reparse（用户改映射后重解析）使用 */
  headers?: string[];
  rows?: Record<string, string>[];
  mapping?: FieldMapping;
  /** 格子表不需要列映射向导 —— true 时 UI 直接跳到「确认导入」 */
  needMapping: boolean;
  items: ParsedClassItem[];
  warnings: string[];
  badRows: { row: number; reason: string }[];
  /**
   * 从文件里读出来的学期信息。
   * 格子表通常自带「2026-2027年第1学期」和「本学期2026-09-07正式上课…共16周」，
   * 比让用户手填准得多 —— 向导据此预填，用户仍可改。
   */
  term?: {
    xn: string;
    xq: '1' | '2';
    /** 第 1 周周一的毫秒时间戳（仅当文件里能读到开学日时存在） */
    semesterStart?: number;
    totalWeeks?: number;
  };
}

export interface SchoolProfile {
  id: string;
  name: string;
  layout: ProfileLayout;
  /** 0-100 置信度；>= 85 才允许自动选中（低于此值要求用户手选） */
  detect(aoa: unknown[][]): number;
  parse(aoa: unknown[][]): ProfileParseResult;
  /** 向导里给用户看的一句话说明：这个档案认的是什么表 */
  note?: string;
}

/** 传给渲染层的档案元信息（不含函数） */
export interface ProfileInfo {
  id: string;
  name: string;
  layout: ProfileLayout;
  note?: string;
}
