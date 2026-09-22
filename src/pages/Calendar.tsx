import { useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import { ChevronLeft, ChevronRight, Plus, Download, Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import Modal from '@/components/Modal';
import type { CalendarEvent } from '@/types';
import { getDateMeta, getSemesterWeek, ymdString } from '@/utils/lunar';

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarPage() {
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState<Dayjs>(dayjs());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [defaultModalDate, setDefaultModalDate] = useState<Dayjs | null>(null);
  const courses = useStore((s) => s.courses);
  const settings = useStore((s) => s.settings);
  const refreshAll = useStore((s) => s.refreshAll);

  useEffect(() => {
    load();
  }, [cursor, view]);

  const load = async () => {
    let from: number, to: number;
    if (view === 'month') {
      from = cursor.startOf('month').startOf('week').valueOf();
      to = cursor.endOf('month').endOf('week').valueOf();
    } else if (view === 'week') {
      from = cursor.startOf('week').valueOf();
      to = cursor.endOf('week').valueOf();
    } else {
      from = cursor.startOf('day').valueOf();
      to = cursor.endOf('day').valueOf();
    }
    const list = await window.taskAPI.db.events.list({ from, to });
    setEvents(list);
  };

  const go = (delta: number) => {
    if (view === 'month') setCursor((c) => c.add(delta, 'month'));
    else if (view === 'week') setCursor((c) => c.add(delta, 'week'));
    else setCursor((c) => c.add(delta, 'day'));
  };

  const today = () => setCursor(dayjs());

  const semesterStart = settings.semester_start ? Number(settings.semester_start) : null;
  const currentWeek = getSemesterWeek(cursor.toDate(), semesterStart);

  // 倒数日 / 纪念日（type=countdown 或 type=event 且 category=纪念日 且 all_day=1）
  const countdownEvents = useMemo(() => {
    const now = dayjs().startOf('day').valueOf();
    return events
      .filter((e) => {
        if (e.type === 'countdown') return true;
        if (e.category_id && e.all_day) return true;
        return false;
      })
      .filter((e) => e.start_at >= now - 86400000) // 含今天和未来
      .sort((a, b) => a.start_at - b.start_at)
      .slice(0, 5);
  }, [events]);

  // 课程"开课日"生日：每个课程取最早的事件日期作为"开课纪念日"
  const courseBirthdays = useMemo(() => {
    const out: Array<{ courseName: string; color: string; daysAgo: number }> = [];
    const now = dayjs().startOf('day').valueOf();
    courses.forEach((c) => {
      const firstEvent = events
        .filter((e) => e.course_id === c.id)
        .reduce<number | null>((min, e) => (min === null || e.start_at < min ? e.start_at : min), null);
      if (firstEvent) {
        const days = Math.round((now - firstEvent) / 86400000);
        if (days >= 0) out.push({ courseName: c.name, color: c.color, daysAgo: days });
      }
    });
    return out.slice(0, 4);
  }, [courses, events]);

  const openCreate = (date?: Dayjs) => {
    setEditing(null);
    setDefaultModalDate(date ?? cursor);
    setModalOpen(true);
  };

  const openEdit = (e: CalendarEvent) => {
    setEditing(e);
    setDefaultModalDate(null);
    setModalOpen(true);
  };

  const exportIcs = async () => {
    const all = await window.taskAPI.db.events.list({});
    const r = await window.taskAPI.ics.export(all);
    if (r.ok) {
      alert(`已导出 ${r.count} 条日程到：\n${r.path}`);
    } else if (!r.canceled) {
      alert('导出失败');
    }
  };

  return (
    <div className="p-6 space-y-4 relative pb-24">
      {/* 顶部倒数日/纪念日/课程开课日 横条 */}
      {(countdownEvents.length > 0 || courseBirthdays.length > 0) && (
        <div className="glass-panel p-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2 text-neon-yellow">
            <Sparkles size={14} />
            <span className="label-tag">倒数日 / 纪念日</span>
          </div>
          {countdownEvents.length === 0 && courseBirthdays.length === 0 && (
            <span className="text-text-dim font-mono text-xs">暂无</span>
          )}
          {countdownEvents.map((e) => {
            const days = Math.max(0, Math.round((e.start_at - dayjs().startOf('day').valueOf()) / 86400000));
            const color = e.category_color || e.color || '#FFE066';
            return (
              <div
                key={`c-${e.id}`}
                className="flex items-center gap-1.5 font-mono text-xs cursor-pointer hover:brightness-150"
                onClick={() => openEdit(e)}
              >
                <span className="status-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                <span className="text-text-primary">{e.title}</span>
                <span className="text-text-dim">·</span>
                <span className="text-neon-yellow font-bold">还有 {days} 天</span>
                <span className="text-text-dim">({dayjs(e.start_at).format('M月D日')})</span>
              </div>
            );
          })}
          {courseBirthdays.map((b, i) => (
            <div
              key={`b-${i}`}
              className="flex items-center gap-1.5 font-mono text-xs"
            >
              <span className="status-dot" style={{ background: b.color, boxShadow: `0 0 6px ${b.color}` }} />
              <span className="text-text-secondary">{b.courseName}</span>
              <span className="text-text-dim">·</span>
              <span className="text-neon-green">开课 {b.daysAgo} 天</span>
            </div>
          ))}
        </div>
      )}

      {/* 顶部控制 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => go(-1)} className="btn-neon py-1.5 px-2">
            <ChevronLeft size={16} />
          </button>
          <button onClick={today} className="btn-ghost font-mono text-xs">
            今日
          </button>
          <button onClick={() => go(1)} className="btn-neon py-1.5 px-2">
            <ChevronRight size={16} />
          </button>
          <h2 className="ml-3 text-xl font-bold font-mono text-neon-green text-glow-green">
            {view === 'day' ? cursor.format('YYYY年M月D日 dddd') : cursor.format('YYYY年M月')}
            {currentWeek && (
              <span className="ml-3 text-sm text-neon-yellow text-glow-yellow font-normal">
                · 第 {currentWeek} 周
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportIcs} className="btn-ghost font-mono text-xs" title="导出日程到系统日历 (.ics)">
            <Download size={14} /> ICS
          </button>
          <div className="flex bg-ink-base/60 rounded-md border border-neon-green/20 overflow-hidden">
            {(['month', 'week', 'day'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 font-mono text-xs uppercase transition-colors
                  ${view === v ? 'bg-neon-green/15 text-neon-green' : 'text-text-secondary hover:text-neon-green'}`}
              >
                {v === 'month' ? '月' : v === 'week' ? '周' : '日'}
              </button>
            ))}
          </div>
          <button onClick={() => openCreate()} className="btn-neon btn-neon-yellow">
            <Plus size={14} /> 新建事件
          </button>
        </div>
      </div>

      {/* 视图 */}
      {view === 'month' && (
        <MonthView
          cursor={cursor}
          events={events}
          onPickDate={(d) => openCreate(d)}
          onPickEvent={openEdit}
          semesterStart={semesterStart}
        />
      )}
      {view === 'week' && (
        <WeekView cursor={cursor} events={events} onPickEvent={openEdit} />
      )}
      {view === 'day' && (
        <DayView cursor={cursor} events={events} onPickEvent={openEdit} />
      )}

      {/* 图例 */}
      <div className="flex items-center gap-4 text-xs text-text-dim font-mono flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="status-dot bg-neon-green shadow-neon-green" /> 课程时段
        </span>
        <span className="flex items-center gap-1.5">
          <span className="status-dot bg-neon-yellow shadow-neon-yellow" /> 重要事项
        </span>
        <span className="flex items-center gap-1.5">
          <span className="status-dot bg-neon-green-bright" /> 提醒
        </span>
        <span className="text-text-dim">·</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-0.5 bg-orange-400 inline-block" style={{ background: '#FF8C00' }} /> 今日
        </span>
      </div>

      {/* v1.2.5: 右下浮动「+」按钮移除——与右下 Pomodoro widget 重叠；新建事件已在顶部工具栏（185 行） */}

      {modalOpen && (
        <EventModal
          event={editing}
          defaultDate={defaultModalDate ?? cursor}
          onClose={() => setModalOpen(false)}
          onSaved={async () => {
            await load();
            await refreshAll();
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// 月视图
// ============================================================
function MonthView({
  cursor,
  events,
  onPickDate,
  onPickEvent,
  semesterStart,
}: {
  cursor: Dayjs;
  events: CalendarEvent[];
  onPickDate: (d: Dayjs) => void;
  onPickEvent: (e: CalendarEvent) => void;
  semesterStart: number | null;
}) {
  const start = cursor.startOf('month').startOf('week');
  const days: Dayjs[] = [];
  for (let i = 0; i < 42; i++) days.push(start.add(i, 'day'));

  const eventsByDay: Record<string, CalendarEvent[]> = {};
  events.forEach((e) => {
    const k = dayjs(e.start_at).format('YYYY-MM-DD');
    (eventsByDay[k] ||= []).push(e);
  });

  // 月视图行号（每行 7 天）→ 计算该行第一天的周次
  const weekNumberByRow: Record<number, number | null> = {};
  for (let row = 0; row < 6; row++) {
    const firstDayInRow = days[row * 7];
    weekNumberByRow[row] = getSemesterWeek(firstDayInRow.toDate(), semesterStart);
  }

  const today = dayjs();

  return (
    <div className="glass-panel p-2">
      {/* 表头 */}
      <div className="grid grid-cols-[auto_repeat(7,1fr)] mb-2">
        <div className="w-10" />
        {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => {
          const sample = cursor.startOf('month').startOf('week').add(i, 'day');
          const wn = getSemesterWeek(sample.toDate(), semesterStart);
          return (
            <div key={d} className="text-center py-2">
              <div className="font-mono text-[10px] text-text-dim uppercase tracking-widest">{d}</div>
              {wn && (
                <div className="font-mono text-[9px] text-neon-yellow/60 mt-0.5">W{wn}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="grid grid-cols-[auto_repeat(7,1fr)] gap-1">
            <div className="w-10 flex items-start justify-end pr-2 pt-1">
              <span className="font-mono text-[10px] text-neon-yellow/70">
                {weekNumberByRow[row] ? `第${weekNumberByRow[row]}周` : ''}
              </span>
            </div>
            {days.slice(row * 7, row * 7 + 7).map((d) => {
              const inMonth = d.month() === cursor.month();
              const isToday = d.isSame(today, 'day');
              const key = d.format('YYYY-MM-DD');
              const dayEvents = (eventsByDay[key] || []).sort((a, b) => a.start_at - b.start_at);
              const meta = getDateMeta(d.toDate());
              const dim = !inMonth;
              const isWeekend = d.day() === 0 || d.day() === 6;
              // 密度自适应：
              //   ≤3 条：显示横条 + 时间
              //   4-6 条：显示圆点
              //   >6 条：圆点 + 数字
              const showBars = dayEvents.length <= 3;
              const showDots = dayEvents.length > 3 && dayEvents.length <= 6;
              const showCount = dayEvents.length > 6;

              return (
                <button
                  key={key}
                  onClick={() => onPickDate(d)}
                  className={`min-h-[92px] text-left p-1.5 rounded border transition-all relative overflow-hidden
                    ${inMonth ? 'bg-ink-base/40 border-neon-green/10 hover:border-neon-green/40' : 'bg-ink-base/10 border-transparent text-text-dim'}
                    ${isToday ? 'border-neon-green shadow-neon-green' : ''}`}
                >
                  {/* 今日橙色横条 */}
                  {isToday && (
                    <>
                      <div className="absolute left-0 right-0 top-0 h-[2px]" style={{ background: '#FF8C00', boxShadow: '0 0 6px #FF8C00' }} />
                      <div className="absolute left-0 right-0 bottom-0 h-[2px]" style={{ background: '#FF8C00', boxShadow: '0 0 6px #FF8C00' }} />
                    </>
                  )}

                  <div className="flex items-start justify-between gap-1">
                    <div className={`font-mono text-xs font-bold leading-tight
                      ${isToday ? 'text-neon-green' : dim ? 'text-text-dim' : isWeekend ? 'text-neon-yellow' : 'text-text-primary'}`}>
                      {d.date()}
                    </div>
                    <div className="flex flex-col items-end leading-tight">
                      {/* 农历日（初一/廿八 等） */}
                      {!dim && (
                        <div className={`font-mono text-[10px] ${meta.lunarDay === '初一' ? 'text-neon-yellow' : 'text-text-dim/70'}`}>
                          {meta.lunarDay === '初一' ? meta.lunarMonth + '月' : meta.lunarDay}
                        </div>
                      )}
                      {/* 节气 */}
                      {!dim && meta.jieQi && (
                        <div className="font-mono text-[9px] text-neon-green/70">节气·{meta.jieQi}</div>
                      )}
                    </div>
                  </div>

                  {/* 法定节假日 / 节日 */}
                  {(meta.legalHoliday || meta.festivals.length > 0) && (
                    <div className={`mt-0.5 truncate font-mono text-[10px]
                      ${meta.legalHoliday ? 'text-neon-yellow font-bold' : 'text-neon-green/80'}`}>
                      {meta.legalHoliday || meta.festivals[0]}
                    </div>
                  )}

                  {/* 课程时段 */}
                  <div className="mt-1 space-y-0.5">
                    {showBars && dayEvents.slice(0, 3).map((e) => {
                      const color = e.color || e.course_color || '#00FF88';
                      const isAllDay = e.all_day;
                      return (
                        <div
                          key={e.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onPickEvent(e);
                          }}
                          className="text-[10px] truncate px-1.5 py-0.5 rounded font-mono cursor-pointer hover:brightness-150"
                          style={{
                            background: `${color}22`,
                            color,
                            borderLeft: `2px solid ${color}`,
                          }}
                          title={e.title}
                        >
                          {!isAllDay && (
                            <span className="text-text-dim mr-1">{dayjs(e.start_at).format('HH:mm')}</span>
                          )}
                          {e.title}
                          {e.recurrence === 'WEEKLY' && <span className="ml-1 text-text-dim">↻</span>}
                        </div>
                      );
                    })}
                    {showDots && (
                      <div className="flex flex-wrap gap-1 px-1.5 mt-1">
                        {dayEvents.slice(0, 6).map((e) => (
                          <div
                            key={e.id}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onPickEvent(e);
                            }}
                            className="w-1.5 h-1.5 rounded-full cursor-pointer"
                            style={{
                              background: e.color || e.course_color || '#00FF88',
                              boxShadow: `0 0 4px ${e.color || e.course_color || '#00FF88'}`,
                            }}
                            title={e.title}
                          />
                        ))}
                      </div>
                    )}
                    {showCount && (
                      <div className="flex items-center gap-1 px-1.5 mt-1">
                        <div className="flex flex-wrap gap-1">
                          {dayEvents.slice(0, 4).map((e) => (
                            <div
                              key={e.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onPickEvent(e);
                              }}
                              className="w-1.5 h-1.5 rounded-full cursor-pointer"
                              style={{ background: e.color || e.course_color || '#00FF88' }}
                              title={e.title}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] text-text-dim font-mono">+{dayEvents.length - 4}</span>
                      </div>
                    )}
                    {dayEvents.length === 0 && !dim && meta.legalHoliday === null && meta.festivals.length === 0 && (
                      <div className="text-[10px] text-text-dim/40 font-mono">&nbsp;</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 周视图
// ============================================================
function WeekView({
  cursor,
  events,
  onPickEvent,
}: {
  cursor: Dayjs;
  events: CalendarEvent[];
  onPickEvent: (e: CalendarEvent) => void;
}) {
  const start = cursor.startOf('week');
  const days = Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
  const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6:00 - 23:00

  const eventsByDayHour: Record<string, CalendarEvent[]> = {};
  events.forEach((e) => {
    const d = dayjs(e.start_at);
    const k = `${d.format('YYYY-MM-DD')}-${d.hour()}`;
    (eventsByDayHour[k] ||= []).push(e);
  });

  return (
    <div className="glass-panel p-3 overflow-auto">
      <div className="grid grid-cols-8 gap-1 min-w-[800px]">
        <div />
        {days.map((d) => (
          <div key={d.format()} className="text-center font-mono text-xs pb-2 border-b border-neon-green/10">
            <div className="text-text-dim">{d.format('ddd')}</div>
            <div className={`${d.isSame(dayjs(), 'day') ? 'text-neon-green text-glow-green font-bold' : 'text-text-primary'}`}>
              {d.format('M/D')}
            </div>
          </div>
        ))}
        {hours.map((h) => (
          <FragmentRow key={h} hour={h} days={days} eventsByDayHour={eventsByDayHour} onPickEvent={onPickEvent} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ hour, days, eventsByDayHour, onPickEvent }: any) {
  return (
    <>
      <div className="font-mono text-[10px] text-text-dim text-right pr-2 pt-1">{hour}:00</div>
      {days.map((d: Dayjs) => {
        const k = `${d.format('YYYY-MM-DD')}-${hour}`;
        const evs = eventsByDayHour[k] || [];
        return (
          <div key={k} className="border-t border-neon-green/5 min-h-[44px] p-1 hover:bg-neon-green/5 transition-colors">
            {evs.map((e: CalendarEvent) => (
              <div
                key={e.id}
                onClick={() => onPickEvent(e)}
                className="text-[10px] px-1.5 py-1 rounded font-mono truncate cursor-pointer hover:brightness-150"
                style={{
                  background: `${e.color || e.course_color || '#00FF88'}22`,
                  color: e.color || e.course_color || '#00FF88',
                  borderLeft: `2px solid ${e.color || e.course_color || '#00FF88'}`,
                }}
              >
                {e.title}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ============================================================
// 日视图（每小时 80px，舒适模式）
// ============================================================
function DayView({
  cursor,
  events,
  onPickEvent,
}: {
  cursor: Dayjs;
  events: CalendarEvent[];
  onPickEvent: (e: CalendarEvent) => void;
}) {
  const HOUR_PX = 80;
  const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6:00 - 23:00
  const dayEvents = events
    .filter((e) => dayjs(e.start_at).isSame(cursor, 'day'))
    .sort((a, b) => a.start_at - b.start_at);

  return (
    <div className="glass-panel p-4">
      <div className="space-y-0">
        {hours.map((h) => {
          const hourEvents = dayEvents.filter((e) => dayjs(e.start_at).hour() === h);
          return (
            <div
              key={h}
              className="flex gap-3 border-t border-neon-green/5 pt-2"
              style={{ minHeight: HOUR_PX }}
            >
              <div className="font-mono text-xs text-text-dim w-14 pt-0">
                {h.toString().padStart(2, '0')}:00
              </div>
              <div className="flex-1 space-y-1">
                {hourEvents.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => onPickEvent(e)}
                    className="p-3 rounded-md border-l-2 bg-ink-base/60 hover:bg-ink-base/80 cursor-pointer transition-all hover:scale-[1.01]"
                    style={{
                      borderColor: e.color || e.course_color || '#00FF88',
                      boxShadow: `inset 0 0 12px ${e.color || e.course_color || '#00FF88'}11`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{e.title}</span>
                      <span className="font-mono text-xs text-text-secondary">
                        {dayjs(e.start_at).format('HH:mm')} - {e.end_at ? dayjs(e.end_at).format('HH:mm') : '?'}
                      </span>
                    </div>
                    {e.location && (
                      <div className="font-mono text-xs text-text-dim mt-1">📍 {e.location}</div>
                    )}
                    {e.notes && (
                      <div className="font-mono text-xs text-text-secondary mt-1 line-clamp-2">{e.notes}</div>
                    )}
                    {e.recurrence === 'WEEKLY' && (
                      <div className="font-mono text-[10px] text-neon-yellow mt-1">↻ 每周重复</div>
                    )}
                    {e.category_name && (
                      <span
                        className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded font-mono text-[10px]"
                        style={{
                          background: `${e.category_color || '#00FF88'}22`,
                          color: e.category_color || '#00FF88',
                        }}
                      >
                        {e.category_emoji} {e.category_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 事件弹窗（带全部字段）
// ============================================================
function EventModal({ event, defaultDate, onClose, onSaved }: any) {
  const courses = useStore((s) => s.courses);
  const categories = useStore((s) => s.categories);
  const [title, setTitle] = useState(event?.title || '');
  const [allDay, setAllDay] = useState(!!event?.all_day);
  const [start, setStart] = useState(
    event
      ? dayjs(event.start_at).format('YYYY-MM-DDTHH:mm')
      : defaultDate.format('YYYY-MM-DDTHH:mm')
  );
  const [end, setEnd] = useState(
    event?.end_at
      ? dayjs(event.end_at).format('YYYY-MM-DDTHH:mm')
      : defaultDate.add(1, 'hour').format('YYYY-MM-DDTHH:mm')
  );
  const [location, setLocation] = useState(event?.location || '');
  const [courseId, setCourseId] = useState<number | ''>(event?.course_id || '');
  const [categoryId, setCategoryId] = useState<number | ''>(event?.category_id || '');
  const [color, setColor] = useState(event?.color || '#00FF88');
  const [recurrence, setRecurrence] = useState(event?.recurrence || '');
  const [recurrenceEnd, setRecurrenceEnd] = useState(
    event?.recurrence_end ? dayjs(event.recurrence_end).format('YYYY-MM-DD') : ''
  );
  const [reminder, setReminder] = useState<number | ''>(event?.reminder_minutes || '');
  const [notes, setNotes] = useState(event?.notes || '');
  const [type, setType] = useState(event?.type || 'event');

  // 选课程时自动套用课程色
  const onPickCourse = (v: string) => {
    const id = v ? Number(v) : '';
    setCourseId(id);
    if (id) {
      const c = courses.find((x) => x.id === id);
      if (c) {
        setColor(c.color);
        if (!title) setTitle(c.name);
      }
    }
  };

  // 选分类时自动套用分类色
  const onPickCategory = (v: string) => {
    const id = v ? Number(v) : '';
    setCategoryId(id);
    if (id) {
      const cat = categories.find((x) => x.id === id);
      if (cat && !title) {
        setColor(cat.color);
      }
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      alert('请输入标题');
      return;
    }
    const startTs = allDay ? dayjs(start).startOf('day').valueOf() : dayjs(start).valueOf();
    const endTs = allDay ? dayjs(end).endOf('day').valueOf() : dayjs(end).valueOf();

    const payload: any = {
      title,
      start_at: startTs,
      end_at: endTs,
      location,
      course_id: courseId || null,
      category_id: categoryId || null,
      color,
      recurrence: recurrence || null,
      recurrence_end: recurrence && recurrenceEnd ? dayjs(recurrenceEnd).endOf('day').valueOf() : null,
      reminder_minutes: reminder || null,
      notes,
      all_day: allDay,
      type,
    };
    if (event?.id) await window.taskAPI.db.events.update(event.id, payload);
    else await window.taskAPI.db.events.create(payload);
    onSaved();
  };

  const del = async () => {
    if (!event?.id) return;
    const msg =
      event.type === 'countdown'
        ? '这是一个倒数日。\n确定删除？'
        : event.recurrence === 'WEEKLY'
          ? '这是一个每周重复的课程时段。\n确定删除该日程（仅删除本条记录）？'
          : '确定删除该事件？';
    if (!confirm(msg)) return;
    await window.taskAPI.db.events.delete(event.id);
    onSaved();
  };

  return (
    <Modal
      title={
        event
          ? event.type === 'countdown'
            ? '编辑倒数日'
            : event.recurrence === 'WEEKLY'
              ? '编辑课程时段'
              : '编辑事件'
          : type === 'countdown'
            ? '新建倒数日'
            : '新建事件'
      }
      onClose={onClose}
      footer={
        <>
          {event?.id && (
            <button onClick={del} className="btn-ghost text-neon-danger mr-auto">
              删除
            </button>
          )}
          <button onClick={onClose} className="btn-ghost">
            取消
          </button>
          <button onClick={submit} className="btn-neon">
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {/* 类型：事件 / 倒数日 */}
        <Field label="类型">
          <div className="flex gap-2">
            {(['event', 'countdown'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 px-3 py-1.5 rounded font-mono text-xs border transition-all
                  ${type === t
                    ? 'border-neon-green bg-neon-green/10 text-neon-green'
                    : 'border-neon-green/20 text-text-secondary hover:border-neon-green/40'}`}
              >
                {t === 'event' ? '📅 事件' : '⏳ 倒数日'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="标题 *">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-neon"
            placeholder="如：数据结构与算法 / 距离高考"
          />
        </Field>

        {/* 全天开关 */}
        <Field label="">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 accent-neon-green"
            />
            <span className="font-mono text-xs text-text-secondary">全天</span>
          </label>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="开始时间 *">
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? dayjs(start).format('YYYY-MM-DD') : start}
              onChange={(e) => setStart(e.target.value)}
              className="input-neon"
            />
          </Field>
          <Field label="结束时间">
            <input
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? dayjs(end).format('YYYY-MM-DD') : end}
              onChange={(e) => setEnd(e.target.value)}
              className="input-neon"
            />
          </Field>
        </div>

        <Field label="地点">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="input-neon"
            placeholder="如：教三-301"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="关联课程">
            <select
              value={courseId}
              onChange={(e) => onPickCourse(e.target.value)}
              className="input-neon"
            >
              <option value="">无（独立事件）</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="分类">
            <select
              value={categoryId}
              onChange={(e) => onPickCategory(e.target.value)}
              className="input-neon"
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="主题色">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="input-neon h-10 p-1"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="重复">
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              className="input-neon"
            >
              <option value="">不重复（仅此一次）</option>
              <option value="DAILY">每天重复</option>
              <option value="WEEKLY">每周重复（上课时间段）</option>
              <option value="MONTHLY">每月重复</option>
              <option value="YEARLY">每年重复（纪念日）</option>
            </select>
          </Field>
          <Field label="提醒">
            <select
              value={reminder}
              onChange={(e) => setReminder(e.target.value ? Number(e.target.value) : '')}
              className="input-neon"
            >
              <option value="">不提醒</option>
              <option value="5">提前 5 分钟</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
              <option value="60">提前 1 小时</option>
              <option value="1440">提前 1 天</option>
            </select>
          </Field>
        </div>

        {recurrence && recurrence !== '' && (
          <Field label="重复截止（可选）">
            <input
              type="date"
              value={recurrenceEnd}
              onChange={(e) => setRecurrenceEnd(e.target.value)}
              className="input-neon"
            />
          </Field>
        )}

        <Field label="备注">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="input-neon"
            placeholder="如：理实一体化、考前辅导…"
          />
        </Field>

        {recurrence === 'WEEKLY' && (
          <p className="text-[10px] text-neon-yellow font-mono">
            ↻ 已选为每周重复。日历上每周同时段显示。
          </p>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      {label && <span className="label-tag block mb-1">{label}</span>}
      {children}
    </label>
  );
}