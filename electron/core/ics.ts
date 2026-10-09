/**
 * ICS（iCalendar）导出 —— **纯计算，不 import electron 也不碰 Node 内置模块**。
 *
 * v1.2.17：这些函数以前写在 electron/ipc/index.ts 里，位置决定了它们的命运 ——
 * 那个文件顶层 `import { dialog } from 'electron'`，于是想验证一句转义是否写对，
 * 唯一的办法是把整个 Electron 主进程跑起来、点导出、再拿日历 App 打开看。
 * 结果就是：escapeIcs 这种「看起来简单、写错必然出问题」的逻辑，从来没有被验证过。
 *
 * 抽到这里之后，scripts/test-core.js 可以直接 require 编译产物去断言它们 ——
 * 「抽出来即得验证面」，这就是抽的必要前提。没测试的话，抽出只是搬了个地方。
 *
 * 抽的过程中暴露的一个真 bug：结束重复用的 UNTIL 以前被单独写成一行
 * `UNTIL=…`，而它是 RRULE 的参数（必须 `RRULE:FREQ=WEEKLY;UNTIL=…`），
 * 日历 App 会忽略那一行 → 设了「重复到某天」的日程会永远重复下去。已修。
 */

/** 两位补零。 */
export function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * ICS 时间格式。
 * 全天事件用 `VALUE=DATE` 的短式（YYYYMMDD），带时间的用 UTC 短式（…T…Z）。
 * 一律用 UTC 取值，避免「本机时区改了导出的日程也跟着挪」。
 */
export function toIcsDate(ts: number, allDay: boolean): string {
  const d = new Date(ts);
  if (allDay) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * ICS 文本转义：反斜杠、分号、逗号要加反斜杠，换行要写成字面的 `\n`。
 * 逗号必须转义 —— 不转义的话 Outlook 会把 LOCATION 里第一个逗号之后的内容
 * 当成下一个字段（"北京, 教室301" 会变成 LOCATION:北京 + 一堆乱码）。
 */
export function escapeIcs(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** 日程行的数据结构（与 db.events 的行同形，只挑导出要用的字段）。 */
export interface IcsEvent {
  id: number | string;
  title?: string | null;
  location?: string | null;
  notes?: string | null;
  start_at: number;
  end_at?: number | null;
  all_day?: number | boolean | null;
  recurrence?: string | null;
  recurrence_end?: number | null;
}

/** 支持的重复规则 → RRULE。不认识的 recurrence 一律忽略（宁可不重发，不要发出错的重复）。 */
const RRULE: Record<string, string> = {
  WEEKLY: 'FREQ=WEEKLY',
  DAILY: 'FREQ=DAILY',
  MONTHLY: 'FREQ=MONTHLY',
  YEARLY: 'FREQ=YEARLY',
};

export function buildIcs(events: IcsEvent[], now = Date.now()): string {
  const stamp = toIcsDate(now, false);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TaskManager//CN//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:TaskManager 日历',
  ];
  for (const e of events || []) {
    if (!e || e.start_at == null) continue;
    const allDay = !!e.all_day;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@taskmanager`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${toIcsDate(e.start_at, allDay)}`);
    if (e.end_at) lines.push(`DTEND:${toIcsDate(e.end_at, allDay)}`);
    lines.push(`SUMMARY:${escapeIcs(e.title || '')}`);
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${escapeIcs(e.notes)}`);
    const rule = e.recurrence ? RRULE[e.recurrence] : null;
    if (rule) {
      // UNTIL 是 RRULE 的**组成部分**（分号连接），不是独立行。
      // 以前这里单独 push 了一行 `UNTIL=…`，日历 App 会直接忽略它 → 重复日程永不停。
      lines.push(e.recurrence_end ? `RRULE:${rule};UNTIL=${toIcsDate(e.recurrence_end, false)}` : `RRULE:${rule}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
