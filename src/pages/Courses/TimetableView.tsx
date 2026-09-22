/**
 * v1.2.8 块 K：Courses 拆分 — 课表日历视图（所有课程的上课时间汇总）
 *
 * 数据来源两类：
 *  1) WEEKLY 重复时段（手动配置） → 每周显示
 *  2) type='class' 的教务导入事件（按周次展开） → 只在所属周显示
 */
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useStore } from '@/store';
import type { Course, CalendarEvent } from '@/types';
import { getSemesterWeek } from '@/utils/lunar';
import { WEEKDAYS, HOURS } from './constants';
import type { DrawerTab } from './constants';

interface TimetableViewProps {
  activeCourseId: number | null;
  onOpenCourse: (c: Course, tab?: DrawerTab) => void;
}

type Cell = { ev: CalendarEvent; course: Course; kind: 'slot' | 'class' | 'single' };

export function TimetableView({ activeCourseId, onOpenCourse }: TimetableViewProps) {
  const courses = useStore((s) => s.courses);
  const events = useStore((s) => s.events);
  const settings = useStore((s) => s.settings);
  const [weekOffset, setWeekOffset] = useState(0);

  const semesterStart = settings.semester_start ? Number(settings.semester_start) : null;

  const monday = useMemo(() => {
    const base = dayjs().startOf('day');
    const dow = base.day();
    const m = dow === 0 ? base.subtract(6, 'day') : base.subtract(dow - 1, 'day');
    return m.add(weekOffset, 'week');
  }, [weekOffset]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => monday.add(i, 'day')), [monday]);
  const weekNo = getSemesterWeek(monday.toDate(), semesterStart);
  const isCurrentWeek = weekOffset === 0;

  const courseById = useMemo(() => {
    const m = new Map<number, Course>();
    courses.forEach((c) => m.set(c.id, c));
    return m;
  }, [courses]);

  const weeklySlots = useMemo(
    () => events.filter((e) => e.recurrence === 'WEEKLY' && e.course_id && courseById.has(e.course_id)),
    [events, courseById]
  );

  const weekEvents = useMemo(() => {
    const start = monday.valueOf();
    const end = monday.add(7, 'day').valueOf();
    return events.filter(
      (e) => e.course_id && e.recurrence !== 'WEEKLY' && e.start_at >= start && e.start_at < end
    );
  }, [events, monday]);

  const { grid, weekSessions, todaySessions } = useMemo(() => {
    const g: Record<number, Record<number, Cell[]>> = {};
    const push = (dayIdx: number, hour: number, item: Cell) => {
      if (!g[dayIdx]) g[dayIdx] = {};
      if (!g[dayIdx][hour]) g[dayIdx][hour] = [];
      g[dayIdx][hour].push(item);
    };
    weeklySlots.forEach((ev) => {
      const dow = dayjs(ev.start_at).day();
      const idx = dow === 0 ? 6 : dow - 1;
      const course = courseById.get(ev.course_id as number);
      if (course) push(idx, dayjs(ev.start_at).hour(), { ev, course, kind: 'slot' });
    });
    weekEvents.forEach((ev) => {
      const d = dayjs(ev.start_at);
      const idx = days.findIndex((x) => x.isSame(d, 'day'));
      if (idx < 0) return;
      const course = courseById.get(ev.course_id as number);
      if (!course) return;
      push(idx, d.hour(), { ev, course, kind: ev.type === 'class' ? 'class' : 'single' });
    });
    let total = 0;
    Object.values(g).forEach((hours) => Object.values(hours).forEach((arr) => { total += arr.length; }));
    const todayIdx = days.findIndex((d) => d.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD'));
    let today = 0;
    if (todayIdx >= 0 && g[todayIdx]) Object.values(g[todayIdx]).forEach((arr) => { today += arr.length; });
    return { grid: g, weekSessions: total, todaySessions: today };
  }, [weeklySlots, weekEvents, courseById, days]);

  const todayStr = dayjs().format('YYYY-MM-DD');
  const weekStart = monday.format('MM-DD');
  const weekEnd = monday.add(6, 'day').format('MM-DD');

  const perCourseCount = useMemo(() => {
    const m = new Map<number, number>();
    weeklySlots.forEach((e) => m.set(e.course_id as number, (m.get(e.course_id as number) || 0) + 1));
    weekEvents.forEach((e) => m.set(e.course_id as number, (m.get(e.course_id as number) || 0) + 1));
    return m;
  }, [weeklySlots, weekEvents]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((w) => w - 1)} className="btn-ghost p-2" title="上一周">
            <ChevronLeftIcon />
          </button>
          <div className="px-3 py-1.5 rounded-md border border-neon-green/20 bg-ink-900/40 text-center min-w-[210px]">
            <div className="font-mono text-sm text-neon-green">
              {weekNo ? `第 ${weekNo} 周` : '周次未标定'}
            </div>
            <div className="font-mono text-[10px] text-text-dim">{monday.format('YYYY')} · {weekStart} ~ {weekEnd}{isCurrentWeek ? ' · 本周' : ''}</div>
          </div>
          <button onClick={() => setWeekOffset((w) => w + 1)} className="btn-ghost p-2" title="下一周">
            <ChevronRightIcon />
          </button>
          {!isCurrentWeek && (
            <button onClick={() => setWeekOffset(0)} className="btn-ghost text-xs px-2 py-1">回到本周</button>
          )}
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] text-text-dim">
          <span className="flex items-center gap-1"><Clock size={12} /> 本周 {weekSessions} 节</span>
          <span className="flex items-center gap-1"><CalendarDays size={12} /> 今天 {todaySessions} 节</span>
          <span>共 {courses.length} 门课</span>
        </div>
      </div>

      {!semesterStart && (
        <div className="px-3 py-2 rounded-md bg-ink-900/40 border border-neon-yellow/30 text-[10px] font-mono text-text-secondary">
          提示：还没设置「开学日」，无法显示第几周。到 设置 → 外观 → 开学日 填一下（或从教务课表导入一次，会自动写入）。
        </div>
      )}

      {courses.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {courses.map((c) => {
            const n = perCourseCount.get(c.id) || 0;
            return (
              <button
                key={c.id}
                onClick={() => onOpenCourse(c, 'schedule')}
                className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${activeCourseId === c.id ? 'bg-neon-green/10' : 'hover:bg-ink-900/60'}`}
                style={{ borderColor: `${c.color}66`, color: c.color }}
                title={`${c.name} · 本周 ${n} 节`}
              >
                ● {c.name}{n > 0 ? ` · ${n}节` : ' · 本周无课'}
              </button>
            );
          })}
        </div>
      )}

      <div className="glass-panel border border-neon-green/15 rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-8 text-[10px] font-mono text-text-dim border-b border-neon-green/10 shrink-0">
          <div className="p-2 border-r border-neon-green/10">时间</div>
          {days.map((d, i) => {
            const isToday = d.format('YYYY-MM-DD') === todayStr;
            return (
              <div key={i} className={`p-2 text-center border-r border-neon-green/5 last:border-r-0 ${isToday ? 'bg-neon-green/10 text-neon-green' : ''}`}>
                <div className="font-bold">{WEEKDAYS[i]}</div>
                <div className="text-[9px] opacity-70">{d.format('MM-DD')}</div>
              </div>
            );
          })}
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">
          {HOURS.map((h) => (
            <div key={h} className="grid grid-cols-8 border-b border-neon-green/5 last:border-b-0">
              <div className="p-2 text-[10px] font-mono text-text-dim border-r border-neon-green/10">{String(h).padStart(2, '0')}:00</div>
              {days.map((d, wd) => {
                const cells = (grid[wd] && grid[wd][h]) || [];
                const isToday = d.format('YYYY-MM-DD') === todayStr;
                return (
                  <div key={wd} className={`min-h-[56px] border-r border-neon-green/5 last:border-r-0 p-1 space-y-1 ${isToday ? 'bg-neon-green/[0.03]' : ''}`}>
                    {cells.map((cell) => {
                      const s = dayjs(cell.ev.start_at);
                      const e = cell.ev.end_at ? dayjs(cell.ev.end_at) : null;
                      return (
                        <button
                          key={`${cell.ev.id}-${cell.kind}`}
                          onClick={() => onOpenCourse(cell.course, 'schedule')}
                          className="w-full text-left px-1.5 py-1 rounded text-[10px] border hover:brightness-125 transition-all"
                          style={{ background: `${cell.course.color}22`, borderColor: `${cell.course.color}55` }}
                          title={`${cell.course.name} ${s.format('HH:mm')}${e ? '-' + e.format('HH:mm') : ''}${cell.ev.location ? ' @ ' + cell.ev.location : ''}${cell.ev.notes ? '\n' + cell.ev.notes : ''}`}
                        >
                          <div className="font-bold truncate" style={{ color: cell.course.color }}>{cell.course.name}</div>
                          <div className="font-mono text-[9px] text-text-secondary truncate">
                            {s.format('HH:mm')}{e ? `-${e.format('HH:mm')}` : ''}
                            {cell.kind === 'single' && <span className="text-neon-yellow"> · 单次</span>}
                          </div>
                          {cell.ev.location && <div className="font-mono text-[9px] text-text-dim truncate">📍 {cell.ev.location.replace('【校本部】', '')}</div>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {courses.length > 0 && weekSessions === 0 && (
        <div className="p-3 rounded-md bg-ink-900/40 border border-neon-yellow/30 text-xs font-mono text-text-secondary">
          ⚠ 这一周没有课。若整学期都为空：点上方课程图例 → 在「上课时间」里添加每周时段，或到「小程序」页从教务课表导入。
        </div>
      )}
      {courses.length === 0 && (
        <div className="p-3 rounded-md bg-ink-900/40 border border-neon-green/15 text-xs font-mono text-text-dim">
          [ ∅ ] 还没有课程，先新建课程并在「上课时间」里排课。
        </div>
      )}
    </div>
  );
}

// 避免每处都 lucide import：内联两个箭头 SVG
function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
  );
}

// 显式 import lucide 用于本文件
import { Clock, CalendarDays } from 'lucide-react';