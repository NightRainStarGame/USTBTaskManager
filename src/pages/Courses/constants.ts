/**
 * v1.2.8 块 K：Courses 拆分 — 共享常量 + 类型 + 工具
 */

export type DrawerTab = 'info' | 'schedule' | 'reqs' | 'notes' | 'miniprogram';

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 时间表显示时间范围：08:00 - 21:00 */
export const HOURS = Array.from({ length: 14 }, (_, i) => i + 8);

export const TAG_PRESETS = ['考研重点', '选修', '待补修', '核心课', '实验课', '双语'];

export const MINI_APP_TYPES = [
  { id: 'timetable', name: '课程表', desc: '可编辑、可导入的课表' },
  { id: 'timer', name: '番茄钟', desc: '专注计时与统计' },
  { id: 'calculator', name: '绩点计算器', desc: '成绩与学分计算' },
  { id: 'notes', name: '课程笔记', desc: '快速记录课堂要点' },
];

/** 把后端存的 tags JSON 字符串还原成数组 */
export function parseTags(tags?: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/** 把 [1,2,3,5,6,8] 压成 "1-3, 5-6, 8" */
export function compressWeeks(weeks: number[]): string {
  if (!weeks.length) return '';
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const parts: string[] = [];
  if (sorted.length === 0) return '';
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur !== prev + 1) {
      parts.push(start === prev ? String(start) : `${start}-${prev}`);
      start = cur;
    }
    prev = cur;
  }
  return parts.join(', ');
}