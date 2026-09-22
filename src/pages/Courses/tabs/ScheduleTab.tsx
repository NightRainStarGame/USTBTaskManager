/**
 * v1.2.8 块 K：ScheduleTab — 课程的每周上课时段管理
 *  - 时间网格点击添加/编辑
 *  - 已配置时段列表
 *  - 教务课表导入的安排汇总（按 weekday + time 聚合）
 */
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useStore } from '@/store';
import { getSemesterWeek } from '@/utils/lunar';
import type { CalendarEvent, Course } from '@/types';
import { compressWeeks, HOURS, WEEKDAYS } from '../constants';
import { ScheduleSlotModal } from '../ScheduleSlotModal';

interface Props { course: Course }

const WDAY_LONG = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function ScheduleTab({ course }: Props) {
  const events = useStore((s) => s.events);
  const settings = useStore((s) => s.settings);
  const refreshAll = useStore((s) => s.refreshAll);
  const [slotModal, setSlotModal] = useState<CalendarEvent | null | 'new'>(null);

  const semesterStart = settings.semester_start ? Number(settings.semester_start) : null;

  const courseSlots = useMemo(() =>
    events.filter((e) => e.course_id === course.id && e.recurrence === 'WEEKLY')
      .sort((a, b) => a.start_at - b.start_at),
    [events, course.id]
  );

  const importedSchedule = useMemo(() => {
    const rows = events.filter((e) => e.course_id === course.id && e.type === 'class');
    const map = new Map<string, { weekday: number; start: string; end: string; location: string; notes: string; weeks: number[] }>();
    rows.forEach((e) => {
      const s = dayjs(e.start_at);
      const en = e.end_at ? dayjs(e.end_at) : null;
      const wd = s.day();
      const key = `${wd}|${s.format('HH:mm')}|${en ? en.format('HH:mm') : ''}|${e.location || ''}`;
      const week = getSemesterWeek(s.toDate(), semesterStart) ?? 0;
      const cur = map.get(key);
      if (cur) { if (week) cur.weeks.push(week); }
      else map.set(key, { weekday: wd, start: s.format('HH:mm'), end: en ? en.format('HH:mm') : '', location: e.location || '', notes: e.notes || '', weeks: week ? [week] : [] });
    });
    return [...map.values()].map((r) => ({ ...r, weeks: [...new Set(r.weeks)].sort((a, b) => a - b) }))
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  }, [events, course.id, semesterStart]);

  const slotGrid = useMemo(() => {
    const grid: Record<number, Record<number, CalendarEvent[]>> = {};
    courseSlots.forEach((s) => {
      const wd = dayjs(s.start_at).day();
      const idx = wd === 0 ? 6 : wd - 1;
      const h = dayjs(s.start_at).hour();
      if (!grid[idx]) grid[idx] = {};
      if (!grid[idx][h]) grid[idx][h] = [];
      grid[idx][h].push(s);
    });
    return grid;
  }, [courseSlots]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-secondary">点击网格添加或查看时间段（每周重复）</p>
        <button onClick={() => setSlotModal('new')} className="btn-neon btn-neon-yellow py-1 px-2 text-xs">
          <Plus size={12} /> 新增时段
        </button>
      </div>

      <div className="border border-neon-green/15 rounded-lg overflow-hidden bg-ink-base/40">
        <div className="grid grid-cols-8 text-[10px] font-mono text-text-dim border-b border-neon-green/10">
          <div className="p-2 border-r border-neon-green/10">时间</div>
          {WEEKDAYS.map((d) => <div key={d} className="p-2 text-center">{d}</div>)}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {HOURS.map((h) => (
            <div key={h} className="grid grid-cols-8 border-b border-neon-green/5 last:border-b-0">
              <div className="p-2 text-[10px] font-mono text-text-dim border-r border-neon-green/10">{String(h).padStart(2, '0')}:00</div>
              {WEEKDAYS.map((_, wd) => {
                const slots = slotGrid[wd]?.[h] || [];
                return (
                  <div key={wd} className="min-h-[48px] border-r border-neon-green/5 last:border-r-0 p-1 relative">
                    {slots.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setSlotModal(s)}
                        className="w-full text-left px-1.5 py-1 rounded text-[10px] truncate border"
                        style={{ background: `${course.color}22`, borderColor: `${course.color}55`, color: course.color }}
                      >
                        {dayjs(s.start_at).format('HH:mm')}-{dayjs(s.end_at).format('HH:mm')}
                        {s.location && <span className="block text-[9px] opacity-80 truncate">{s.location}</span>}
                      </button>
                    ))}
                    {slots.length === 0 && (
                      <button
                        onClick={() => setSlotModal('new')}
                        className="w-full h-full opacity-0 hover:opacity-100 flex items-center justify-center text-neon-green/60"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="label-tag">已配置时段</h4>
        {courseSlots.length === 0 ? (
          <div className="py-4 text-center text-text-dim font-mono text-xs">[ ∅ ] 暂无上课时间段</div>
        ) : (
          courseSlots.map((s) => {
            const wd = dayjs(s.start_at).day();
            const wdName = WDAY_LONG[wd];
            return (
              <div key={s.id} className="flex items-center gap-3 p-2 rounded-md bg-ink-base/40 border border-neon-green/10">
                <span className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ background: `${course.color}22`, color: course.color, border: `1px solid ${course.color}55` }}>{wdName}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs">{dayjs(s.start_at).format('HH:mm')} - {dayjs(s.end_at).format('HH:mm')}</div>
                  {s.location && <div className="font-mono text-[10px] text-text-dim">📍 {s.location}</div>}
                </div>
                <button onClick={() => setSlotModal(s)} className="btn-ghost p-1" aria-label="编辑"><Pencil size={12} /></button>
                <button
                  onClick={async () => { if (confirm('删除该上课时间段？')) { await window.taskAPI.db.events.delete(s.id); await refreshAll(); } }}
                  className="btn-ghost p-1 text-neon-danger"
                  aria-label="删除"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {importedSchedule.length > 0 && (
        <div className="space-y-2">
          <h4 className="label-tag">教务课表安排（导入的原始周次）</h4>
          {importedSchedule.map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-ink-base/40 border border-neon-green/10">
              <span className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ background: `${course.color}22`, color: course.color, border: `1px solid ${course.color}55` }}>
                {WDAY_LONG[r.weekday]}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs">{r.start}{r.end ? ` - ${r.end}` : ''}</div>
                <div className="font-mono text-[10px] text-text-dim truncate">
                  {r.location && <span>📍 {r.location} </span>}
                  {r.weeks.length > 0 && <span className="text-neon-green/80">· 第 {compressWeeks(r.weeks)} 周</span>}
                </div>
              </div>
            </div>
          ))}
          <p className="font-mono text-[10px] text-text-dim">
            以上来自教务课表导入。若想让它每周固定出现在课表里，可在上方「新增时段」补一条每周重复时段。
          </p>
        </div>
      )}

      {slotModal && (
        <ScheduleSlotModal
          course={course}
          slot={slotModal === 'new' ? null : slotModal}
          onClose={() => setSlotModal(null)}
          onSaved={async () => { setSlotModal(null); await refreshAll(); }}
        />
      )}
    </div>
  );
}