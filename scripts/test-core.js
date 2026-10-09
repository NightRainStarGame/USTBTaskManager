#!/usr/bin/env node
/**
 * test-core.js —— electron/core 下纯计算的单元测试（无 Electron、无新依赖）
 *
 * 跑法：
 *   npm run test:core
 *   或手动：tsc -p tsconfig.node.json && node scripts/test-core.js
 *
 * 为什么长这样：这些模块被刻意写成「不 import electron 也不碰 Node 内置模块」，
 * 所以能直接 require 编译产物、用纯 Node 断言 —— 不需要 vitest/jest，也不需要启动 App。
 * 这是全仓第一个真正的单元测试面；被测的逻辑以前藏在 ipc/index.ts 里，
 * 唯一的验证方式是「把 App 跑起来、点导出、用日历 App 打开看」，实际上从没验证过。
 *
 * 加新用例的规矩：被测的东西必须在 electron/core/ 下，且不得 import electron ——
 * 一旦依赖了环境，就再也跑不起来了。（这也是 core/ 这个目录存在的理由。）
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ics = require(path.join(ROOT, 'dist-electron', 'core', 'ics.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `   → ${extra}` : ''}`); }
}

// ── pad
console.log('\n【pad】');
check('单位数补零', ics.pad(7) === '07');
check('两位数不变', ics.pad(12) === '12');

// ── toIcsDate
console.log('\n【toIcsDate】');
// UTC 2026-03-05 09:08:07 —— 固定 ts 保证断言不受本机时区影响
const TS = Date.UTC(2026, 2, 5, 9, 8, 7);
check('带时间的事件 → UTC 短式', ics.toIcsDate(TS, false) === '20260305T090807Z', ics.toIcsDate(TS, false));
check('全天事件 → 只有日期', ics.toIcsDate(TS, true) === '20260305', ics.toIcsDate(TS, true));
check('个位月份/日期要补零', ics.toIcsDate(Date.UTC(2026, 0, 2, 3, 4, 5), false) === '20260102T030405Z',
  ics.toIcsDate(Date.UTC(2026, 0, 2, 3, 4, 5), false));

// ── escapeIcs
console.log('\n【escapeIcs】');
check('逗号转义（不转义 Outlook 会把后半截当字段）', ics.escapeIcs('北京, 教室301') === '北京\\, 教室301', ics.escapeIcs('北京, 教室301'));
check('分号转义', ics.escapeIcs('a;b') === 'a\\;b', ics.escapeIcs('a;b'));
check('换行变成字面 \\n', ics.escapeIcs('a\nb') === 'a\\nb', ics.escapeIcs('a\nb'));
check('CRLF 也收敛成一个 \\n', ics.escapeIcs('a\r\nb') === 'a\\nb', ics.escapeIcs('a\r\nb'));
check('反斜杠先转义（否则后面的转义会被二次吞掉）', ics.escapeIcs('a\\b') === 'a\\\\b', ics.escapeIcs('a\\b'));
check('空值不炸', ics.escapeIcs(null) === '' && ics.escapeIcs(undefined) === '');

// ── buildIcs
console.log('\n【buildIcs】');
const NOW = Date.UTC(2026, 2, 5, 9, 8, 7);
const out = ics.buildIcs(
  [
    {
      id: 42, title: '数据结构作业, 第3次', location: '教学楼A;301', notes: '带\n电脑',
      start_at: Date.UTC(2026, 2, 6, 8, 0, 0), end_at: Date.UTC(2026, 2, 6, 9, 40, 0),
    },
    { id: 43, title: '运动会', start_at: Date.UTC(2026, 2, 8, 0, 0, 0), all_day: 1 },
  ],
  NOW,
);
const lines = out.split('\r\n');
const has = (s) => lines.includes(s);
check('VCALENDAR 头尾齐全', lines[0] === 'BEGIN:VCALENDAR' && lines[lines.length - 1] === 'END:VCALENDAR');
check('行分隔符是 CRLF（RFC 5545 要求）', out.includes('\r\n'));
check('UID 带 @taskmanager 后缀', has('UID:42@taskmanager'));
check('DTSTAMP 用传入的 now', has('DTSTAMP:20260305T090807Z'));
check('DTSTART / DTEND 成对出现',
  has('DTSTART:20260306T080000Z') && has('DTEND:20260306T094000Z'));
check('全天事件只有日期段', has('DTSTART:20260308') && !lines.some((l) => l.startsWith('DTEND:20260308T')));
check('SUMMARY 里的逗号被转义', has('SUMMARY:数据结构作业\\, 第3次'));
check('LOCATION 里的分号被转义', has('LOCATION:教学楼A\\;301'));
check('DESCRIPTION 里的换行变成字面 \\n', has('DESCRIPTION:带\\n电脑'));
check('两个事件各一组 VEVENT', lines.filter((l) => l === 'BEGIN:VEVENT').length === 2);

console.log('\n【buildIcs · 重复规则】');
const weekly = ics.buildIcs(
  [{ id: 1, title: '例会', start_at: TS, recurrence: 'WEEKLY', recurrence_end: Date.UTC(2026, 5, 1, 0, 0, 0) }],
  NOW,
).split('\r\n');
check('RRULE 与 UNTIL 在同一行（分开写日历会忽略 → 重复永不停）',
  weekly.includes('RRULE:FREQ=WEEKLY;UNTIL=20260601T000000Z'),
  weekly.find((l) => l.startsWith('RRULE') || l.startsWith('UNTIL')) || '（没有 RRULE 行）');
const weeklyNoEnd = ics.buildIcs([{ id: 1, title: '例会', start_at: TS, recurrence: 'WEEKLY' }], NOW).split('\r\n');
check('没有截止日时不带 UNTIL', weeklyNoEnd.includes('RRULE:FREQ=WEEKLY'));
const badRec = ics.buildIcs([{ id: 1, title: 'x', start_at: TS, recurrence: '莫名其妙' }], NOW).split('\r\n');
check('不认识的 recurrence 直接忽略（宁可不重复）', !badRec.some((l) => l.startsWith('RRULE')));

console.log('\n【buildIcs · 边界】');
check('空列表也能产出合法日历', ics.buildIcs([], NOW).startsWith('BEGIN:VCALENDAR'));
check('缺 start_at 的事件被跳过，不产出 Invalid Date',
  !ics.buildIcs([{ id: 1, title: '坏数据' }], NOW).includes('NaN'));
check('undefined 入参不炸', ics.buildIcs(undefined, NOW).startsWith('BEGIN:VCALENDAR'));

console.log('\n' + '─'.repeat(56));
console.log(`  结果：${pass} 通过，${fail} 失败`);
console.log('─'.repeat(56) + '\n');
process.exit(fail ? 1 : 0);
