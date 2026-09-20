import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { useSearchParams } from 'react-router-dom';
import { Plus, BookOpen, Pencil, Trash2, FileText, Grid3X3, ListTodo, StickyNote, X, AppWindow, CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Clock, Layers, CloudUpload, CloudDownload, KeyRound, ExternalLink, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import Modal from '@/components/Modal';
import dayjs from 'dayjs';
import { getSemesterWeek } from '@/utils/lunar';
import type { Course, Requirement, CalendarEvent, CourseNote } from '@/types';

type DrawerTab = 'info' | 'schedule' | 'reqs' | 'notes' | 'miniprogram';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 - 21:00
const TAG_PRESETS = ['考研重点', '选修', '待补修', '核心课', '实验课', '双语'];

export default function CoursesPage() {
  const courses = useStore(s => s.courses);
  const requirements = useStore(s => s.requirements);
  const refreshAll = useStore(s => s.refreshAll);
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('info');
  const [activeCourse, setActiveCourse] = useState<Course | null>(null);
  const [view, setView] = useState<'cards' | 'timetable'>('cards');
  // 作业同步（码制：生成作业码 / 发布作业 / 接收作业）
  const [hwMenuOpen, setHwMenuOpen] = useState(false);
  const [genCodesOpen, setGenCodesOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // 处理 URL 参数
  useEffect(() => {
    const action = searchParams.get('action');
    const courseId = searchParams.get('course');
    const tab = searchParams.get('tab') as DrawerTab | null;
    const v = searchParams.get('view');

    if (v === 'timetable' || v === 'cards') setView(v);

    if (courseId) {
      const c = courses.find(x => String(x.id) === courseId);
      if (c) {
        setActiveCourse(c);
        setDrawerTab(tab || 'info');
        setDrawerOpen(true);
      }
    } else if (action === 'new') {
      setActiveCourse(null);
      setDrawerTab('info');
      setDrawerOpen(true);
    } else if (action === 'req' && courses.length) {
      setActiveCourse(courses[0]);
      setDrawerTab('reqs');
      setDrawerOpen(true);
    }

    // 消费掉 action / view 参数，避免刷新后重复触发
    if (action || v) {
      searchParams.delete('action');
      searchParams.delete('view');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, courses, setSearchParams]);

  useEffect(() => {
    if (courses.length && !activeCourse) setActiveCourse(courses[0]);
  }, [courses, activeCourse]);

  const openDrawer = (c: Course | null, tab: DrawerTab = 'info') => {
    setActiveCourse(c);
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  const totalHomework = requirements.length;
  const pendingHomework = requirements.filter(r => r.status !== 'done').length;

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="label-tag">COURSES·学期管理</p>
          <h2 className="text-2xl font-bold mt-1">
            课程 <span className="text-neon-green text-glow-green">·</span>{' '}
            <span className="text-text-dim font-mono text-base">{courses.length} 门</span>
            <span className="text-text-dim font-mono text-base"> · </span>
            <span className="text-neon-yellow font-mono text-base">待完成作业 {pendingHomework}/{totalHomework}</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-neon-green/20 overflow-hidden">
            <button
              onClick={() => setView('cards')}
              className={`px-3 py-2 text-xs font-mono flex items-center gap-1.5 transition-colors ${view === 'cards' ? 'bg-neon-green/15 text-neon-green' : 'text-text-dim hover:text-text-secondary'}`}
            >
              <Layers size={13} /> 课程卡片
            </button>
            <button
              onClick={() => setView('timetable')}
              className={`px-3 py-2 text-xs font-mono flex items-center gap-1.5 border-l border-neon-green/20 transition-colors ${view === 'timetable' ? 'bg-neon-green/15 text-neon-green' : 'text-text-dim hover:text-text-secondary'}`}
            >
              <CalendarDays size={13} /> 课表日历
            </button>
          </div>
          <button onClick={() => openDrawer(null, 'info')} className="btn-neon">
            <Plus size={14} /> 新建课程
          </button>
        </div>
      </div>

      {view === 'timetable' ? (
        <TimetableView
          activeCourseId={drawerOpen ? activeCourse?.id ?? null : null}
          onOpenCourse={(c, tab) => openDrawer(c, tab || 'schedule')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          {/* 左侧课程卡片 */}
          <div className="space-y-3 overflow-y-auto pr-1">
            {courses.length === 0 && (
              <div className="glass-panel p-6 text-center text-text-dim font-mono text-xs">
                [ ∅ ] 还没有课程<br />点击右上角「新建课程」开始
              </div>
            )}
            {courses.map(c => {
              const reqs = requirements.filter(r => r.course_id === c.id);
              const done = reqs.filter(r => r.status === 'done').length;
              const pending = reqs.filter(r => r.status !== 'done').length;
              const overdue = reqs.filter(r => r.status !== 'done' && dayjs(r.due_date).isBefore(dayjs(), 'day')).length;
              const progress = reqs.length > 0 ? Math.round(done / reqs.length * 100) : 0;
              const next = reqs.filter(r => r.status !== 'done').sort((a, b) => a.due_date - b.due_date)[0];
              const tags = parseTags(c.tags);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrawer(c, 'info')}
                  onKeyDown={(e) => { if (e.key === 'Enter') openDrawer(c, 'info'); }}
                  className={`w-full text-left p-4 rounded-lg border transition-all relative overflow-hidden cursor-pointer
                    ${activeCourse?.id === c.id && drawerOpen
                      ? 'bg-ink-900/80 shadow-neon-green'
                      : 'bg-ink-900/40 hover:bg-ink-900/60 border-neon-green/10 hover:border-neon-green/30'}
                    border`}
                  style={{ borderColor: activeCourse?.id === c.id && drawerOpen ? c.color : undefined }}
                >
                  <div className="absolute top-0 left-0 w-1 h-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                  <div className="flex items-start justify-between mb-2 pl-2">
                    <div>
                      <h3 className="font-bold text-sm">{c.name}</h3>
                      <p className="font-mono text-[10px] text-text-dim mt-0.5">{c.code} · {c.instructor}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-[10px] text-text-dim">{c.semester}</span>
                      <button
                        title="删除课程"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`删除课程「${c.name}」？\n其上课时间段、作业、备注、小程序配置也会一并删除。`)) return;
                          await window.taskAPI.db.courses.delete(c.id);
                          if (activeCourse?.id === c.id) setDrawerOpen(false);
                          await refreshAll();
                        }}
                        className="btn-ghost p-1 text-text-dim hover:text-neon-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  {tags.length > 0 && (
                    <div className="pl-2 mb-2 flex flex-wrap gap-1">
                      {tags.map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded text-[10px] border border-neon-green/30 text-text-secondary">{t}</span>
                      ))}
                    </div>
                  )}

                  {/* 作业概览：待完成 / 逾期 / 已完成 */}
                  <div className="pl-2 flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-yellow/40 text-neon-yellow">待完成 {pending}</span>
                    {overdue > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-danger/50 text-neon-danger">逾期 {overdue}</span>}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-green/40 text-neon-green">已完成 {done}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); openDrawer(c, 'reqs'); }}
                      className="ml-auto px-2 py-0.5 rounded text-[10px] font-mono border border-neon-green/30 text-text-secondary hover:border-neon-green hover:text-neon-green flex items-center gap-1"
                    >
                      <ListTodo size={10} /> 作业详情
                    </button>
                  </div>

                  <div className="pl-2 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[10px] text-text-dim">完成度</span>
                      <span className="font-mono text-xs" style={{ color: c.color }}>{progress}%</span>
                    </div>
                    <div className="progress-bar">
                      <div style={{ width: `${progress}%`, background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
                    </div>
                  </div>
                  {next && (
                    <div className="mt-3 pl-2 pt-2 border-t border-neon-green/10 font-mono text-[10px] text-text-dim truncate">
                      NEXT → {next.title} · {dayjs(next.due_date).format('MM-DD')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 右侧占位 / 提示 */}
          <div className="lg:col-span-2 glass-panel p-10 flex flex-col items-center justify-center text-center text-text-dim font-mono">
            <BookOpen size={48} className="mb-4 text-neon-green/40" />
            <p className="text-lg">点击左侧课程卡片查看详情</p>
            <p className="text-xs mt-2">抽屉含：基本信息（含作业概览） / 上课时间 / 作业 / 备注 / 小程序</p>
            <button
              onClick={() => setView('timetable')}
              className="mt-6 btn-ghost text-xs flex items-center gap-2"
            >
              <CalendarDays size={14} /> 切换到课表日历视图
            </button>
          </div>
        </div>
      )}

      {/* 课程编辑抽屉 */}
      {drawerOpen && (
        <CourseDrawer
          course={activeCourse}
          onClose={() => setDrawerOpen(false)}
          onSaved={async () => { await refreshAll(); }}
          defaultTab={drawerTab}
        />
      )}

      {/* 右下角：作业同步入口（点开 → 生成作业码 / 发布作业 / 接收作业） */}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-2">
        {hwMenuOpen && (
          <div className="glass-panel rounded-lg p-1.5 border border-neon-green/20 shadow-neon-green flex flex-col gap-1.5 animate-in">
            <button
              onClick={() => { setHwMenuOpen(false); setGenCodesOpen(true); }}
              className="btn-neon text-xs whitespace-nowrap"
            >
              <KeyRound size={13} /> 生成作业码
            </button>
            <button
              onClick={() => { setHwMenuOpen(false); setPublishOpen(true); }}
              className="btn-neon btn-neon-yellow text-xs whitespace-nowrap"
            >
              <CloudUpload size={13} /> 发布作业
            </button>
            <button
              onClick={() => { setHwMenuOpen(false); setReceiveOpen(true); }}
              className="btn-neon text-xs whitespace-nowrap"
            >
              <CloudDownload size={13} /> 接收作业
            </button>
          </div>
        )}
        <button
          onClick={() => setHwMenuOpen(v => !v)}
          className={`glass-panel rounded-lg px-4 py-2.5 border shadow-neon-green flex items-center gap-2 font-mono text-xs transition-all ${hwMenuOpen ? 'border-neon-green bg-neon-green/10 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
        >
          <RefreshCw size={14} /> 作业同步
        </button>
      </div>

      {genCodesOpen && (
        <GenerateCodesModal onClose={() => setGenCodesOpen(false)} />
      )}
      {publishOpen && (
        <PublishHomeworkModal
          onClose={() => setPublishOpen(false)}
          onChanged={async () => { await refreshAll(); }}
        />
      )}
      {receiveOpen && (
        <ReceiveHomeworkModal
          onClose={() => setReceiveOpen(false)}
          onSynced={async () => { await refreshAll(); }}
        />
      )}
    </div>
  );
}

function parseTags(tags?: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// ===== 课表日历：全局周课表（所有课程的上课时间汇总）=====
// 数据来源有两类：
//  1) 手动在「上课时间」里配置的每周重复时段（recurrence='WEEKLY'）→ 每周都显示
//  2) 教务课表导入的课程事件（type='class'，按周次展开成具体日期）→ 只在所属周显示，单双周/跳周都能对齐
function TimetableView({ activeCourseId, onOpenCourse }: { activeCourseId: number | null; onOpenCourse: (c: Course, tab?: DrawerTab) => void }) {
  const courses = useStore(s => s.courses);
  const events = useStore(s => s.events);
  const settings = useStore(s => s.settings);
  const [weekOffset, setWeekOffset] = useState(0);

  const semesterStart = settings.semester_start ? Number(settings.semester_start) : null;

  // 当前显示周的周一
  const monday = useMemo(() => {
    const base = dayjs().startOf('day');
    const dow = base.day(); // 0 = 周日
    const m = dow === 0 ? base.subtract(6, 'day') : base.subtract(dow - 1, 'day');
    return m.add(weekOffset, 'week');
  }, [weekOffset]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => monday.add(i, 'day')), [monday]);
  const weekNo = getSemesterWeek(monday.toDate(), semesterStart);
  const isCurrentWeek = weekOffset === 0;

  const courseById = useMemo(() => {
    const m = new Map<number, Course>();
    courses.forEach(c => m.set(c.id, c));
    return m;
  }, [courses]);

  // 每周固定课（上课时间 tab 配置的 WEEKLY 时段）
  const weeklySlots = useMemo(
    () => events.filter(e => e.recurrence === 'WEEKLY' && e.course_id && courseById.has(e.course_id)),
    [events, courseById]
  );

  // 本周实际发生的课程事件（教务导入的 type='class' + 普通单次事件）
  const weekEvents = useMemo(() => {
    const start = monday.valueOf();
    const end = monday.add(7, 'day').valueOf();
    return events.filter(e => e.course_id && e.recurrence !== 'WEEKLY' && e.start_at >= start && e.start_at < end);
  }, [events, monday]);

  type Cell = { ev: CalendarEvent; course: Course; kind: 'slot' | 'class' | 'single' };
  const { grid, weekSessions, todaySessions } = useMemo(() => {
    const g: Record<number, Record<number, Cell[]>> = {};
    const push = (dayIdx: number, hour: number, item: Cell) => {
      if (!g[dayIdx]) g[dayIdx] = {};
      if (!g[dayIdx][hour]) g[dayIdx][hour] = [];
      g[dayIdx][hour].push(item);
    };
    weeklySlots.forEach(ev => {
      const dow = dayjs(ev.start_at).day();
      const idx = dow === 0 ? 6 : dow - 1;
      const course = courseById.get(ev.course_id as number);
      if (course) push(idx, dayjs(ev.start_at).hour(), { ev, course, kind: 'slot' });
    });
    weekEvents.forEach(ev => {
      const d = dayjs(ev.start_at);
      const idx = days.findIndex(x => x.isSame(d, 'day'));
      if (idx < 0) return;
      const course = courseById.get(ev.course_id as number);
      if (!course) return;
      push(idx, d.hour(), { ev, course, kind: ev.type === 'class' ? 'class' : 'single' });
    });
    let total = 0;
    Object.values(g).forEach(hours => Object.values(hours).forEach(arr => { total += arr.length; }));
    const todayIdx = days.findIndex(d => d.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD'));
    let today = 0;
    if (todayIdx >= 0 && g[todayIdx]) Object.values(g[todayIdx]).forEach(arr => { today += arr.length; });
    return { grid: g, weekSessions: total, todaySessions: today };
  }, [weeklySlots, weekEvents, courseById, days]);

  const todayStr = dayjs().format('YYYY-MM-DD');
  const weekStart = monday.format('MM-DD');
  const weekEnd = monday.add(6, 'day').format('MM-DD');

  // 图例：统计每门课本周的节数（每周固定课 + 本周实际课程事件）
  const perCourseCount = useMemo(() => {
    const m = new Map<number, number>();
    weeklySlots.forEach(e => m.set(e.course_id as number, (m.get(e.course_id as number) || 0) + 1));
    weekEvents.forEach(e => m.set(e.course_id as number, (m.get(e.course_id as number) || 0) + 1));
    return m;
  }, [weeklySlots, weekEvents]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {/* 工具栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="btn-ghost p-2" title="上一周"><ChevronLeft size={16} /></button>
          <div className="px-3 py-1.5 rounded-md border border-neon-green/20 bg-ink-900/40 text-center min-w-[210px]">
            <div className="font-mono text-sm text-neon-green">
              {weekNo ? `第 ${weekNo} 周` : '周次未标定'}
            </div>
            <div className="font-mono text-[10px] text-text-dim">{monday.format('YYYY')} · {weekStart} ~ {weekEnd}{isCurrentWeek ? ' · 本周' : ''}</div>
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="btn-ghost p-2" title="下一周"><ChevronRight size={16} /></button>
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

      {/* 课程图例 */}
      {courses.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {courses.map(c => {
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

      {/* 周课表网格 */}
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
          {HOURS.map(h => (
            <div key={h} className="grid grid-cols-8 border-b border-neon-green/5 last:border-b-0">
              <div className="p-2 text-[10px] font-mono text-text-dim border-r border-neon-green/10">{String(h).padStart(2, '0')}:00</div>
              {days.map((d, wd) => {
                const cells = (grid[wd] && grid[wd][h]) || [];
                const isToday = d.format('YYYY-MM-DD') === todayStr;
                return (
                  <div key={wd} className={`min-h-[56px] border-r border-neon-green/5 last:border-r-0 p-1 space-y-1 ${isToday ? 'bg-neon-green/[0.03]' : ''}`}>
                    {cells.map(cell => {
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

      {/* 空态提示 */}
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

function CourseDrawer({ course, onClose, onSaved, defaultTab }: { course: Course | null; onClose: () => void; onSaved: () => Promise<void>; defaultTab: DrawerTab }) {
  const [tab, setTab] = useState(defaultTab);
  const isNew = !course;

  // 确保 tab 合法（新建时只有 info）
  useEffect(() => {
    if (isNew && tab !== 'info') setTab('info');
  }, [isNew, tab]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl h-full bg-ink-900/95 backdrop-blur-xl border-l border-neon-green/20 shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-neon-green/15">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">{isNew ? '新建课程' : course!.name}</h3>
            {!isNew && <span className="font-mono text-[10px] text-text-dim">{course!.code}</span>}
          </div>
          <div className="flex items-center gap-1">
            {!isNew && (
              <button
                title="删除课程"
                onClick={async () => {
                  if (!confirm(`删除课程「${course!.name}」？\n其上课时间段、作业、备注、小程序配置也会一并删除。`)) return;
                  await window.taskAPI.db.courses.delete(course!.id);
                  onClose();
                  await onSaved();
                }}
                className="btn-ghost p-1 text-text-dim hover:text-neon-danger"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={onClose} className="btn-ghost p-1"><X size={18} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neon-green/10">
          {[
            { key: 'info', label: '基本信息', icon: FileText },
            { key: 'schedule', label: '上课时间', icon: Grid3X3 },
            { key: 'reqs', label: '作业/要求', icon: ListTodo },
            { key: 'notes', label: '备注', icon: StickyNote },
            { key: 'miniprogram', label: '小程序', icon: AppWindow },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key as any)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 font-mono text-xs uppercase tracking-widest transition-colors
                ${tab === key ? 'text-neon-green bg-neon-green/5 border-b-2 border-neon-green' : 'text-text-dim hover:text-text-secondary'}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'info' && <InfoTab course={course} onSaved={onSaved} onClose={onClose} onGoTab={(t) => setTab(t)} />}
          {tab === 'schedule' && !isNew && <ScheduleTab course={course!} />}
          {tab === 'reqs' && !isNew && <ReqsTab course={course!} />}
          {tab === 'notes' && !isNew && <NotesTab course={course!} />}
          {tab === 'miniprogram' && !isNew && <MiniProgramTab course={course!} />}
          {isNew && tab !== 'info' && (
            <div className="h-full flex items-center justify-center text-text-dim font-mono">请先保存课程基本信息</div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTab({ course, onSaved, onClose, onGoTab }: { course: Course | null; onSaved: () => Promise<void>; onClose: () => void; onGoTab: (t: DrawerTab) => void }) {
  const [name, setName] = useState(course?.name || '');
  const [code, setCode] = useState(course?.code || '');
  const [instructor, setInstructor] = useState(course?.instructor || '');
  const [semester, setSemester] = useState(course?.semester || '2026-Fall');
  const [color, setColor] = useState(course?.color || '#00FF88');
  const [description, setDescription] = useState(course?.description || '');
  const [tags, setTags] = useState<string[]>(parseTags(course?.tags));
  const [tagInput, setTagInput] = useState('');

  const addTag = (t: string) => { if (t && !tags.includes(t)) setTags([...tags, t]); setTagInput(''); };
  const removeTag = (t: string) => setTags(tags.filter(x => x !== t));

  const submit = async () => {
    const payload = { name, code, instructor, semester, color, description, tags };
    if (course?.id) await window.taskAPI.db.courses.update(course.id, payload);
    else await window.taskAPI.db.courses.create(payload);
    await onSaved();
    onClose();
  };

  return (
    <div className="space-y-4">
      {/* 作业概览：点击课程后立刻能看到该课程有哪些作业 */}
      {course?.id && <CourseHomeworkOverview course={course} onGoTab={onGoTab} />}

      <Field label="课程名称 *"><input value={name} onChange={(e) => setName(e.target.value)} className="input-neon" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="课程编号"><input value={code} onChange={(e) => setCode(e.target.value)} className="input-neon" /></Field>
        <Field label="授课老师"><input value={instructor} onChange={(e) => setInstructor(e.target.value)} className="input-neon" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="学期"><input value={semester} onChange={(e) => setSemester(e.target.value)} className="input-neon" /></Field>
        <Field label="主题色"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="input-neon h-10 p-1" /></Field>
      </div>
      <Field label="描述"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-neon" /></Field>
      <div>
        <span className="label-tag block mb-2">标签</span>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-neon-green/40 text-neon-green">
              {t} <button onClick={() => removeTag(t)} className="hover:text-neon-danger"><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag(tagInput)} placeholder="输入标签回车" className="input-neon flex-1" />
          <button onClick={() => addTag(tagInput)} className="btn-neon px-3"><Plus size={14} /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PRESETS.map(t => (
            <button key={t} onClick={() => addTag(t)} className="px-2 py-1 rounded text-[10px] border border-text-dim/30 text-text-secondary hover:border-neon-green hover:text-neon-green">+ {t}</button>
          ))}
        </div>
      </div>
      <div className="pt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">取消</button>
        <button onClick={submit} className="btn-neon">保存课程</button>
      </div>
    </div>
  );
}

function ScheduleTab({ course }: { course: Course }) {
  const events = useStore(s => s.events);
  const settings = useStore(s => s.settings);
  const refreshAll = useStore(s => s.refreshAll);
  const [slotModal, setSlotModal] = useState<CalendarEvent | null | 'new'>(null);

  const semesterStart = settings.semester_start ? Number(settings.semester_start) : null;

  const courseSlots = useMemo(() =>
    events.filter(e => e.course_id === course.id && e.recurrence === 'WEEKLY')
      .sort((a, b) => a.start_at - b.start_at),
    [events, course.id]
  );

  // 教务课表导入的课程事件（type='class'，按周次展开）→ 归并成「周几 + 时间 + 地点 + 周次」的可读安排
  const importedSchedule = useMemo(() => {
    const rows = events.filter(e => e.course_id === course.id && e.type === 'class');
    const map = new Map<string, { weekday: number; start: string; end: string; location: string; notes: string; weeks: number[] }>();
    rows.forEach(e => {
      const s = dayjs(e.start_at);
      const en = e.end_at ? dayjs(e.end_at) : null;
      const wd = s.day();
      const key = `${wd}|${s.format('HH:mm')}|${en ? en.format('HH:mm') : ''}|${e.location || ''}`;
      const week = getSemesterWeek(s.toDate(), semesterStart) ?? 0;
      const cur = map.get(key);
      if (cur) { if (week) cur.weeks.push(week); }
      else map.set(key, {
        weekday: wd,
        start: s.format('HH:mm'),
        end: en ? en.format('HH:mm') : '',
        location: e.location || '',
        notes: e.notes || '',
        weeks: week ? [week] : [],
      });
    });
    return [...map.values()].map(r => ({ ...r, weeks: [...new Set(r.weeks)].sort((a, b) => a - b) }))
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  }, [events, course.id, semesterStart]);

  const slotGrid = useMemo(() => {
    const grid: Record<number, Record<number, CalendarEvent[]>> = {};
    courseSlots.forEach(s => {
      const wd = dayjs(s.start_at).day(); // 0=周日
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
        <button onClick={() => setSlotModal('new')} className="btn-neon btn-neon-yellow py-1 px-2 text-xs"><Plus size={12} /> 新增时段</button>
      </div>

      {/* 时间网格 */}
      <div className="border border-neon-green/15 rounded-lg overflow-hidden bg-ink-base/40">
        <div className="grid grid-cols-8 text-[10px] font-mono text-text-dim border-b border-neon-green/10">
          <div className="p-2 border-r border-neon-green/10">时间</div>
          {WEEKDAYS.map(d => <div key={d} className="p-2 text-center">{d}</div>)}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {HOURS.map(h => (
            <div key={h} className="grid grid-cols-8 border-b border-neon-green/5 last:border-b-0">
              <div className="p-2 text-[10px] font-mono text-text-dim border-r border-neon-green/10">{String(h).padStart(2, '0')}:00</div>
              {WEEKDAYS.map((_, wd) => {
                const slots = slotGrid[wd]?.[h] || [];
                return (
                  <div key={wd} className="min-h-[48px] border-r border-neon-green/5 last:border-r-0 p-1 relative">
                    {slots.map(s => (
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
                      <button onClick={() => setSlotModal('new')} className="w-full h-full opacity-0 hover:opacity-100 flex items-center justify-center text-neon-green/60">
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

      {/* 列表摘要 */}
      <div className="space-y-2">
        <h4 className="label-tag">已配置时段</h4>
        {courseSlots.length === 0 ? (
          <div className="py-4 text-center text-text-dim font-mono text-xs">[ ∅ ] 暂无上课时间段</div>
        ) : (
          courseSlots.map(s => {
            const wd = dayjs(s.start_at).day();
            const wdName = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][wd];
            return (
              <div key={s.id} className="flex items-center gap-3 p-2 rounded-md bg-ink-base/40 border border-neon-green/10">
                <span className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ background: `${course.color}22`, color: course.color, border: `1px solid ${course.color}55` }}>{wdName}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs">{dayjs(s.start_at).format('HH:mm')} - {dayjs(s.end_at).format('HH:mm')}</div>
                  {s.location && <div className="font-mono text-[10px] text-text-dim">📍 {s.location}</div>}
                </div>
                <button onClick={() => setSlotModal(s)} className="btn-ghost p-1"><Pencil size={12} /></button>
                <button onClick={async () => { if (confirm('删除该上课时间段？')) { await window.taskAPI.db.events.delete(s.id); await refreshAll(); } }} className="btn-ghost p-1 text-neon-danger"><Trash2 size={12} /></button>
              </div>
            );
          })
        )}
      </div>

      {/* 教务导入的课程安排 */}
      {importedSchedule.length > 0 && (
        <div className="space-y-2">
          <h4 className="label-tag">教务课表安排（导入的原始周次）</h4>
          {importedSchedule.map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-ink-base/40 border border-neon-green/10">
              <span className="px-2 py-1 rounded font-mono text-[10px] font-bold" style={{ background: `${course.color}22`, color: course.color, border: `1px solid ${course.color}55` }}>
                {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][r.weekday]}
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

/** 把 [1,2,3,5,6,8] 压成 "1-3, 5-6, 8" */
function compressWeeks(weeks: number[]): string {
  if (!weeks.length) return '';
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const parts: string[] = [];
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

// ===== 课程作业概览（基本信息 tab 顶部，点开课程即可看到作业）=====
function CourseHomeworkOverview({ course, onGoTab }: { course: Course; onGoTab: (t: DrawerTab) => void }) {
  const requirements = useStore(s => s.requirements);
  const refreshAll = useStore(s => s.refreshAll);
  const [quickAdd, setQuickAdd] = useState(false);

  const reqs = useMemo(
    () => requirements.filter(r => r.course_id === course.id).sort((a, b) => a.due_date - b.due_date),
    [requirements, course.id]
  );
  const pending = reqs.filter(r => r.status !== 'done');
  const done = reqs.filter(r => r.status === 'done');
  const overdue = pending.filter(r => dayjs(r.due_date).isBefore(dayjs(), 'day'));
  const shown = [...pending, ...done].slice(0, 6);

  return (
    <div className="rounded-lg border border-neon-green/15 bg-ink-base/40 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neon-green/10">
        <div className="flex items-center gap-2">
          <ListTodo size={14} className="text-neon-green" />
          <span className="label-tag">作业 / 要求</span>
          <span className="font-mono text-[10px] text-text-dim">共 {reqs.length} 项</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-yellow/40 text-neon-yellow">待完成 {pending.length}</span>
          {overdue.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-danger/50 text-neon-danger">逾期 {overdue.length}</span>}
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neon-green/40 text-neon-green">已完成 {done.length}</span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {reqs.length === 0 ? (
          <div className="py-4 text-center text-text-dim font-mono text-xs">[ ∅ ] 该课程暂无作业，点右侧「添加作业」</div>
        ) : (
          shown.map(r => {
            const due = dayjs(r.due_date);
            const isOverdue = r.status !== 'done' && due.isBefore(dayjs(), 'day');
            const typeIcon = { homework: '📝', exam: '📚', project: '🛠', reading: '📖', other: '📌' }[r.type] || '📌';
            return (
              <button
                key={r.id}
                onClick={() => onGoTab('reqs')}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded border border-transparent hover:border-neon-green/30 hover:bg-ink-900/50 transition-colors"
              >
                <span className="text-sm shrink-0">{r.status === 'done' ? '✅' : typeIcon}</span>
                <span className={`flex-1 min-w-0 truncate text-xs ${r.status === 'done' ? 'line-through text-text-dim' : 'text-text-secondary'}`}>
                  {r.source === 'github' && <span className="inline-flex items-center mr-1 px-1 py-px rounded text-[9px] font-mono border border-neon-green/40 text-neon-green align-middle" title={`来自 GitHub 同步${r.publisher ? ' · 发布人 ' + r.publisher : ''}${r.session_date ? ' · 上课 ' + r.session_date : ''}`}><CloudDownload size={9} /> 同步</span>}
                  {r.title}
                </span>
                <span className={`font-mono text-[10px] shrink-0 ${isOverdue ? 'text-neon-danger' : 'text-text-dim'}`}>{due.format('MM-DD HH:mm')}</span>
                <span className={`data-pill shrink-0 ${r.status === 'done' ? 'border-neon-green/40 text-neon-green' : r.status === 'in_progress' ? 'border-neon-yellow/40 text-neon-yellow' : isOverdue ? 'border-neon-danger/50 text-neon-danger' : 'border-text-dim/40 text-text-secondary'}`}>
                  {r.status === 'done' ? '已完成' : r.status === 'in_progress' ? '进行中' : isOverdue ? '已逾期' : '待办'}
                </span>
              </button>
            );
          })
        )}
        {reqs.length > shown.length && (
          <div className="text-center font-mono text-[10px] text-text-dim">还有 {reqs.length - shown.length} 项…</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={() => setQuickAdd(true)} className="btn-neon btn-neon-yellow text-xs px-2 py-1"><Plus size={12} /> 添加作业</button>
          {reqs.length > 0 && (
            <button onClick={() => onGoTab('reqs')} className="btn-ghost text-xs px-2 py-1">查看全部 / 管理 →</button>
          )}
        </div>
      </div>

      {quickAdd && (
        <ReqInlineEditor
          req={{ id: 0, course_id: course.id, title: '', type: 'homework', due_date: Date.now(), priority: 2, status: 'pending', created_at: Date.now() } as Requirement}
          courseId={course.id}
          onClose={() => setQuickAdd(false)}
          onSaved={async () => { setQuickAdd(false); await refreshAll(); }}
        />
      )}
    </div>
  );
}

function ReqsTab({ course }: { course: Course }) {
  const requirements = useStore(s => s.requirements);
  const refreshAll = useStore(s => s.refreshAll);
  const courseReqs = useMemo(() => requirements.filter(r => r.course_id === course.id).sort((a, b) => a.due_date - b.due_date), [requirements, course.id]);
  const [editing, setEditing] = useState<Requirement | null>(null);

  const pending = courseReqs.filter(r => r.status !== 'done').length;
  const done = courseReqs.filter(r => r.status === 'done').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] text-text-dim">
          <span>共 {courseReqs.length} 项</span>
          <span className="px-1.5 py-0.5 rounded border border-neon-yellow/40 text-neon-yellow">待完成 {pending}</span>
          <span className="px-1.5 py-0.5 rounded border border-neon-green/40 text-neon-green">已完成 {done}</span>
        </div>
        <button onClick={() => setEditing({ id: 0, course_id: course.id, title: '', type: 'homework', due_date: Date.now(), priority: 2, status: 'pending', created_at: Date.now() } as Requirement)} className="btn-neon btn-neon-yellow">
          <Plus size={14} /> 添加作业
        </button>
      </div>
      {courseReqs.length === 0 ? (
        <div className="py-8 text-center text-text-dim font-mono text-sm">[ ∅ ] 暂无作业<br /><span className="text-xs">点击右上角「添加作业」创建第一条</span></div>
      ) : (
        courseReqs.map(r => (
          <ReqRow key={r.id} req={r} onEdit={() => setEditing(r)} onUpdate={refreshAll} />
        ))
      )}
      {editing && (
        <ReqInlineEditor req={editing} courseId={course.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshAll(); }} />
      )}
    </div>
  );
}

function ReqRow({ req, onEdit, onUpdate }: { req: Requirement; onEdit: () => void; onUpdate: () => void }) {
  const due = dayjs(req.due_date);
  const overdue = due.isBefore(dayjs(), 'day') && req.status !== 'done';
  const typeIcon = { homework: '📝', exam: '📚', project: '🛠', reading: '📖', other: '📌' }[req.type] || '📌';
  // v1.1.6：作业内容可展开查看（同步下来的作业内容存在 description 列，此前 UI 从不渲染）
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(req.description || '').trim();

  const cycle = async () => {
    const next = req.status === 'pending' ? 'in_progress' : req.status === 'in_progress' ? 'done' : 'pending';
    try {
      await window.taskAPI.db.requirements.update(req.id, { ...req, status: next });
      onUpdate();
    } catch (e: any) {
      alert('更新状态失败：' + (e?.message || e));
    }
  };

  const del = async () => {
    if (!confirm(`删除作业「${req.title}」？`)) return;
    try {
      await window.taskAPI.db.requirements.delete(req.id);
      onUpdate();
    } catch (e: any) {
      alert('删除失败：' + (e?.message || e));
    }
  };

  return (
    <div className={`rounded-md bg-ink-base/40 border hover:border-neon-green/30 transition-colors ${overdue ? 'border-neon-danger/40' : 'border-neon-green/10'}`}>
      <div className="flex items-center gap-3 p-3">
      <button onClick={cycle} className="shrink-0">
        {req.status === 'done' ? (
          <div className="w-5 h-5 rounded border-2 border-neon-green bg-neon-green/30 flex items-center justify-center shadow-neon-green"><span className="text-neon-green text-xs">✓</span></div>
        ) : (
          <div className="w-5 h-5 rounded border-2 border-text-dim hover:border-neon-green" />
        )}
      </button>
      <span className="text-lg">{typeIcon}</span>
      {hasContent && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 btn-ghost p-0.5 text-text-dim hover:text-neon-green"
          title={expanded ? '收起作业内容' : '展开作业内容'}
        >
          <ChevronDown size={12} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </button>
      )}
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => hasContent && setExpanded(v => !v)}>
        <div className={`text-sm truncate ${req.status === 'done' ? 'line-through text-text-dim' : ''}`}>
          {req.source === 'github' && (
            <span className="inline-flex items-center gap-0.5 mr-1 px-1 py-px rounded text-[9px] font-mono border border-neon-green/40 text-neon-green align-middle" title={`来自 GitHub 同步${req.publisher ? ' · 发布人 ' + req.publisher : ''}${req.session_date ? ' · 上课 ' + req.session_date : ''}`}>
              <CloudDownload size={9} /> 同步
            </span>
          )}
          {req.title}
        </div>
        <div className="font-mono text-[10px] text-text-dim mt-0.5">
          {due.format('MM-DD ddd HH:mm')}{req.session_date ? ` · 该节 ${req.session_date.slice(5)}` : ''} · 预计 {req.estimated_hours || '?'}h · 实际 {req.actual_hours || '0'}h · 优先级 {req.priority}
        </div>
      </div>
      <span className={`data-pill ${req.status === 'done' ? 'border-neon-green/40 text-neon-green' : req.status === 'in_progress' ? 'border-neon-yellow/40 text-neon-yellow' : overdue ? 'border-neon-danger/50 text-neon-danger' : 'border-text-dim/40 text-text-secondary'}`}>
        {req.status === 'done' ? '已完成' : req.status === 'in_progress' ? '进行中' : overdue ? '已逾期' : '待办'}
      </span>
      <button onClick={onEdit} className="btn-ghost p-1"><Pencil size={12} /></button>
      <button onClick={del} className="btn-ghost p-1 text-neon-danger"><Trash2 size={12} /></button>
      </div>
      {expanded && hasContent && (
        <div className="px-3 pb-3 pt-1 border-t border-neon-green/10">
          <div className="font-mono text-[9px] text-text-dim mb-1">
            作业内容{req.publisher ? ` · 发布人 ${req.publisher}` : ''}{req.session_date ? ` · 上课 ${req.session_date}` : ''}
          </div>
          <div className="text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed">{req.description}</div>
        </div>
      )}
    </div>
  );
}

function ReqInlineEditor({ req, courseId, onClose, onSaved }: { req: Requirement; courseId: number; onClose: () => void; onSaved: () => Promise<void> }) {
  const isNew = req.id === 0;
  // v1.1.6：作业内容（description）。同步条目（source='github'）只读——本地改动会在下次接收时被远端覆盖
  const isSynced = req.source === 'github';
  const [title, setTitle] = useState(req.title || '');
  const [description, setDescription] = useState(req.description || '');
  const [type, setType] = useState(req.type || 'homework');
  const [dueDate, setDueDate] = useState(dayjs(req.due_date || Date.now()).format('YYYY-MM-DDTHH:mm'));
  const [priority, setPriority] = useState(req.priority || 2);
  const [status, setStatus] = useState(req.status || 'pending');
  const [estimatedHours, setEstimatedHours] = useState(req.estimated_hours || '');
  const [actualHours, setActualHours] = useState(req.actual_hours || '');
  const [notes, setNotes] = useState(req.notes || '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) { alert('请填写作业标题'); return; }
    const dueMs = dueDate ? new Date(dueDate).getTime() : NaN;
    if (!Number.isFinite(dueMs)) { alert('请选择有效的截止时间'); return; }
    setBusy(true);
    try {
      const payload: Partial<Requirement> = {
        course_id: courseId, title: title.trim(), type,
        description: description.trim() || null,
        due_date: dueMs,
        priority, status,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
        actual_hours: actualHours ? Number(actualHours) : null,
        notes: notes.trim() || null,
      };
      if (isNew) {
        await window.taskAPI.db.requirements.create(payload);
      } else {
        const { course_name, course_color, ...rest } = req as any;
        await window.taskAPI.db.requirements.update(req.id, { ...rest, ...payload });
      }
      await onSaved();
    } catch (e: any) {
      alert('保存作业失败：' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? '添加作业' : '编辑作业'} onClose={onClose} footer={<><button onClick={onClose} className="btn-ghost">取消</button><button onClick={submit} disabled={busy} className="btn-neon btn-neon-yellow">{busy ? '保存中…' : '保存'}</button></>}>
      <div className="space-y-3">
        <Field label="作业标题 *"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" placeholder="如：第三章习题 1-10" /></Field>
        <Field label={isSynced ? '作业内容（来自同步 · 只读）' : '作业内容'}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={isSynced}
            rows={4}
            className="input-neon text-xs leading-relaxed"
            placeholder={isSynced ? '这条作业来自同步，内容由发布方维护（展开作业条目也能直接查看）' : '作业的具体内容、要求、页码等（选填；接收方能完整看到）'}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="input-neon">
              <option value="homework">作业</option>
              <option value="exam">考试</option>
              <option value="project">项目</option>
              <option value="reading">阅读</option>
              <option value="other">其他</option>
            </select>
          </Field>
          <Field label="优先级">
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)} className="input-neon">
              <option value={1}>低</option>
              <option value={2}>中</option>
              <option value={3}>高</option>
            </select>
          </Field>
        </div>
        <Field label="截止时间 *"><input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-neon" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="状态">
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input-neon">
              <option value="pending">待办</option>
              <option value="in_progress">进行中</option>
              <option value="done">已完成</option>
            </select>
          </Field>
          <Field label="预计工时(h)"><input type="number" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="input-neon" /></Field>
          <Field label="实际耗时(h)"><input type="number" step="0.5" value={actualHours} onChange={(e) => setActualHours(e.target.value)} className="input-neon" /></Field>
        </div>
        <Field label="备注"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-neon" /></Field>
      </div>
    </Modal>
  );
}

function NotesTab({ course }: { course: Course }) {
  const refreshAll = useStore(s => s.refreshAll);
  const [notes, setNotes] = useState<CourseNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [editing, setEditing] = useState<CourseNote | null>(null);

  useEffect(() => {
    window.taskAPI.db.courseNotes.list(course.id).then(setNotes);
  }, [course.id]);

  const add = async () => {
    if (!newNote.trim()) return;
    await window.taskAPI.db.courseNotes.create({ course_id: course.id, content: newNote });
    setNewNote('');
    const list = await window.taskAPI.db.courseNotes.list(course.id);
    setNotes(list);
    await refreshAll();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await window.taskAPI.db.courseNotes.update(editing.id, { content: editing.content });
    setEditing(null);
    const list = await window.taskAPI.db.courseNotes.list(course.id);
    setNotes(list);
  };

  const del = async (id: number) => {
    if (!confirm('删除这条备注？')) return;
    await window.taskAPI.db.courseNotes.delete(id);
    const list = await window.taskAPI.db.courseNotes.list(course.id);
    setNotes(list);
    await refreshAll();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="添加课程备注（支持 Markdown 风格）…" rows={2} className="input-neon flex-1" />
        <button onClick={add} className="btn-neon px-3"><Plus size={16} /></button>
      </div>
      <div className="space-y-2">
        {notes.length === 0 ? (
          <div className="py-8 text-center text-text-dim font-mono text-sm">[ ∅ ] 暂无备注</div>
        ) : (
          notes.map(n => (
            <div key={n.id} className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10">
              {editing?.id === n.id ? (
                <div className="space-y-2">
                  <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={2} className="input-neon w-full" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditing(null)} className="btn-ghost text-xs">取消</button>
                    <button onClick={saveEdit} className="btn-neon text-xs">保存</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-sm text-text-secondary whitespace-pre-wrap">{n.content}</div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-neon-green/10">
                    <span className="font-mono text-[10px] text-text-dim">{dayjs(n.created_at).format('YYYY-MM-DD HH:mm')}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setEditing(n)} className="btn-ghost p-1"><Pencil size={12} /></button>
                      <button onClick={() => del(n.id)} className="btn-ghost p-1 text-neon-danger"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ScheduleSlotModal({ course, slot, onClose, onSaved }: { course: Course; slot: CalendarEvent | null; onClose: () => void; onSaved: () => void }) {
  const base = slot ? dayjs(slot.start_at) : dayjs();
  const [weekday, setWeekday] = useState<number>(slot ? dayjs(slot.start_at).day() : 1);
  const [startTime, setStartTime] = useState(slot ? dayjs(slot.start_at).format('HH:mm') : '08:00');
  const [endTime, setEndTime] = useState(slot && slot.end_at ? dayjs(slot.end_at).format('HH:mm') : '09:30');
  const [location, setLocation] = useState(slot?.location || '');
  const [notes, setNotes] = useState(slot?.notes || '');

  const submit = async () => {
    const monday = dayjs().day() === 0 ? dayjs().subtract(6, 'day') : dayjs().subtract(dayjs().day() - 1, 'day');
    const targetDate = monday.add(weekday === 0 ? 6 : weekday - 1, 'day');
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startAt = targetDate.hour(sh).minute(sm).valueOf();
    const endAt = targetDate.hour(eh).minute(em).valueOf();
    const payload = { title: course.name, start_at: startAt, end_at: endAt, location, course_id: course.id, color: course.color, recurrence: 'WEEKLY', notes };
    if (slot?.id) await window.taskAPI.db.events.update(slot.id, payload);
    else await window.taskAPI.db.events.create(payload);
    await onSaved();
  };

  return (
    <Modal title={slot ? '编辑上课时间段' : '新增上课时间段'} onClose={onClose} footer={<><button onClick={onClose} className="btn-ghost">取消</button><button onClick={submit} className="btn-neon">保存</button></>}>
      <div className="space-y-3">
        <div className="p-2 rounded bg-ink-base/40 border border-neon-green/10 text-xs font-mono text-text-secondary">↻ 该时段为<strong className="text-neon-yellow">每周重复</strong>事件</div>
        <Field label="周几">
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="input-neon">
            <option value={1}>周一</option>
            <option value={2}>周二</option>
            <option value={3}>周三</option>
            <option value={4}>周四</option>
            <option value={5}>周五</option>
            <option value={6}>周六</option>
            <option value={0}>周日</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始时间"><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="input-neon" /></Field>
          <Field label="结束时间"><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input-neon" /></Field>
        </div>
        <Field label="地点"><input value={location} onChange={(e) => setLocation(e.target.value)} className="input-neon" placeholder="如：教三-301" /></Field>
        <Field label="备注"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-neon" placeholder="如：理实一体化、考前辅导…" /></Field>
      </div>
    </Modal>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="label-tag block mb-1">{label}</span>
      {children}
    </label>
  );
}

// ===== 课程内嵌小程序配置 tab =====
const MINI_APP_TYPES = [
  { id: 'timetable', name: '课程表', desc: '可编辑、可导入的课表' },
  { id: 'timer', name: '番茄钟', desc: '专注计时与统计' },
  { id: 'calculator', name: '绩点计算器', desc: '成绩与学分计算' },
  { id: 'notes', name: '课程笔记', desc: '快速记录课堂要点' },
];

function MiniProgramTab({ course }: { course: Course }) {
  const refreshAll = useStore(s => s.refreshAll);
  const [miniProgram, setMiniProgram] = useState<any>(null);
  const [selectedType, setSelectedType] = useState('timetable');

  useEffect(() => {
    window.taskAPI.db.miniPrograms.getByCourse(course.id).then(setMiniProgram);
  }, [course.id]);

  const mount = async () => {
    await window.taskAPI.db.miniPrograms.createOrUpdate({
      course_id: course.id, app_type: selectedType, config_json: {}, active: 1,
    });
    await refreshAll();
    const mp = await window.taskAPI.db.miniPrograms.getByCourse(course.id);
    setMiniProgram(mp);
  };

  const unmount = async () => {
    if (!miniProgram) return;
    await window.taskAPI.db.miniPrograms.delete(miniProgram.id);
    await refreshAll();
    setMiniProgram(null);
  };

  return (
    <div className="space-y-4">
      <div className="p-3 rounded bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary">
        <strong className="text-neon-yellow">说明：</strong>每个课程可挂载一个自制学习小工具，数据保存在本地 SQLite。
      </div>

      {!miniProgram ? (
        <div className="space-y-3">
          <h4 className="label-tag">选择要挂载的工具</h4>
          <div className="grid grid-cols-2 gap-3">
            {MINI_APP_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className={`p-3 rounded-md border text-left transition-colors ${selectedType === t.id ? 'border-neon-green bg-neon-green/10' : 'border-neon-green/10 hover:border-neon-green/30'}`}
              >
                <div className="font-bold text-sm text-text-primary">{t.name}</div>
                <div className="text-[10px] text-text-dim mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
          <button onClick={mount} className="btn-neon w-full"><Plus size={14} /> 挂载到「{course.name}」</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md bg-neon-green/5 border border-neon-green/20">
            <div>
              <div className="font-bold text-neon-green">{MINI_APP_TYPES.find(t => t.id === miniProgram.app_type)?.name || miniProgram.app_type}</div>
              <div className="text-[10px] text-text-dim font-mono">已挂载 · 可在小程序中心打开</div>
            </div>
            <button onClick={unmount} className="btn-ghost text-neon-danger text-xs"><Trash2 size={12} /> 卸载</button>
          </div>
          <p className="text-xs text-text-secondary">切换工具类型：先卸载再重新挂载即可。</p>
        </div>
      )}
    </div>
  );
}

// ==================================================================
// ===== 作业同步（码制协议：homework/<syncCode>.json） =====
// ==================================================================

/** 复制文本到剪贴板（失败静默） */
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
}

/** 生成作业码弹窗：一键生成一对码（发布码 = 密钥，同步码 = 分享码），抄存/复制 */
function GenerateCodesModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<{ syncCode: string; publishCode: string } | null>(null);
  const [copied, setCopied] = useState<'sync' | 'publish' | null>(null);

  const generatePair = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.taskAPI.homework.generateCodes();
      setGenerated({ syncCode: r.syncCode, publishCode: r.publishCode });
      setCopied(null);
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async (which: 'sync' | 'publish') => {
    if (!generated) return;
    await copyText(which === 'sync' ? generated.syncCode : generated.publishCode);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Modal
      title="生成作业码"
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-ghost">关闭</button>
        <button onClick={generatePair} disabled={busy} className="btn-neon"><KeyRound size={14} /> {busy ? '生成中…' : (generated ? '再生成一对' : '生成新码对')}</button>
      </>}
    >
      <div className="space-y-3">
        <div className="p-2.5 rounded-md border border-neon-green/20 bg-neon-green/5 text-[11px] text-text-secondary leading-relaxed">
          一对码对应一个课程的整套作业包：
          <span className="text-neon-yellow font-mono"> 作业发布码 </span>= 密钥（自己留存，点「发布作业」时输入），
          <span className="text-neon-green font-mono"> 同步作业码 </span>= 分享码（发给同学，点「接收作业」时输入）。
        </div>

        {!generated && (
          <div className="py-6 text-center font-mono text-xs text-text-dim">
            [ ∅ ] 还没有生成码对，点右下角「生成新码对」
          </div>
        )}

        {generated && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="font-mono text-[11px] text-neon-yellow font-bold">✦ 新码对已生成，请抄存两码</div>
            <div className="font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="text-text-dim w-20 shrink-0">作业发布码</span>
                <span className="text-neon-yellow font-bold tracking-widest">{generated.publishCode}</span>
                <button onClick={() => doCopy('publish')} className="btn-ghost p-1 text-[9px]">
                  {copied === 'publish' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-text-dim w-20 shrink-0">同步作业码</span>
                <span className="text-neon-green font-bold tracking-widest">{generated.syncCode}</span>
                <button onClick={() => doCopy('sync')} className="btn-ghost p-1 text-[9px]">
                  {copied === 'sync' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              作业发布码自己留存（继续发布/更新这个包）；同步作业码发给同学（接收作业用）。
              也可以使用网站申请的码对，效果相同。
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 发布作业弹窗（v1.1.8）：同节课可一次性发多条作业条目。
 *  - 顶部：课程 + 上课日期（共享）+ 发布目标 + secret edit（这些是码包级配置）
 *  - 中间：作业条目列表（每条独立标题/内容/类型/截止），"+ 添加作业条目" 按钮加行，× 删除单条
 *  - 提交：把有效条目（标题非空）一次传给后端 → 后端逐条 merge 到同一个码包
 *  - 自动 receive 让刚发布的作业落到本地（用新 entriesPublished 统计）
 */
function PublishHomeworkModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const courses = useStore(s => s.courses);
  const events = useStore(s => s.events);

  type EntryDraft = { type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string };
  const blankEntry = (): EntryDraft => ({ type: 'homework', title: '', content: '', dueDate: '' });

  const [busy, setBusy] = useState(false);
  // 码包级字段
  const [courseId, setCourseId] = useState<number | null>(null);
  const [sessionDate, setSessionDate] = useState(dayjs().format('YYYY-MM-DD'));
  // 批量条目（默认一条空条目）
  const [items, setItems] = useState<EntryDraft[]>([blankEntry()]);
  // 可选 secret edit
  const [secretMode, setSecretMode] = useState(false);
  const [publishCode, setPublishCode] = useState('');
  // 发布目标列表（默认两个都勾）
  const [targets, setTargets] = useState<{ github: boolean; cloud: boolean }>({ github: true, cloud: true });

  const [error, setError] = useState('');
  const [published, setPublished] = useState<{
    entriesPublished: number;
    sessionDate: string;
    syncCode?: string; bundleCreated?: boolean; fileUrl?: string;
    entriesCount?: number;
    perTarget?: Array<{ target: 'github' | 'cloud'; ok: boolean; entriesCount?: number; error?: string }>;
  } | null>(null);
  const [copied, setCopied] = useState<'sync' | null>(null);

  const course = courses.find(c => c.id === courseId) ?? null;

  // 默认选中第一门课
  useEffect(() => {
    if (courses.length && courseId === null) setCourseId(courses[0].id);
  }, [courses, courseId]);

  // 该课程近期上课日期候选
  const sessionOptions = useMemo(() => {
    if (!course) return [] as Array<{ date: string; time: string }>;
    const map = new Map<string, string>();
    events.filter(e => e.course_id === course.id).forEach(e => {
      const s = dayjs(e.start_at);
      const time = s.format('HH:mm') + (e.end_at ? `-${dayjs(e.end_at).format('HH:mm')}` : '');
      if (e.type === 'class') {
        map.set(s.format('YYYY-MM-DD'), time);
      } else if (e.recurrence === 'WEEKLY') {
        const dow = s.day();
        const base = dayjs().startOf('day');
        const thisMonday = dow === 0 ? base.subtract(6, 'day') : base.subtract(dow - 1, 'day');
        const thisDow = dow === 0 ? 6 : dow - 1;
        [-1, 0, 1, 2].forEach(off => {
          const d = thisMonday.add(off * 7 + thisDow, 'day');
          map.set(d.format('YYYY-MM-DD'), time);
        });
      }
    });
    const today = dayjs().startOf('day').valueOf();
    return [...map.entries()]
      .map(([date, time]) => ({ date, time, ts: dayjs(date).valueOf() }))
      .sort((a, b) => Math.abs(a.ts - today) - Math.abs(b.ts - today))
      .slice(0, 12)
      .sort((a, b) => a.ts - b.ts);
  }, [course, events]);

  const validItems = items.filter((it) => it.title.trim());
  const canSubmit = !!course && validItems.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    if (secretMode && publishCode && publishCode.length !== 12) { setError('作业发布码需为 12 位（不填则关闭 secret edit 模式）'); return; }
    setBusy(true); setError('');
    try {
      const r = await window.taskAPI.homework.publish({
        publishCode: secretMode && publishCode ? publishCode : undefined,
        targets: (Object.entries(targets).filter(([, on]) => on).map(([k]) => k) as ('github' | 'cloud')[]),
        courseId: course.id,
        courseName: course.name,
        sessionDate,
        // 批量条目（每条独立标题/内容/类型/截止；sessionDate 用码包级）
        entries: validItems.map((it) => ({
          title: it.title.trim(),
          content: it.content.trim(),
          type: it.type,
          sessionDate,
          dueDate: it.dueDate ? new Date(it.dueDate).getTime() : null,
        })),
      });
      if (!r.ok) { setError(r.error || '发布失败'); if ((r as any).anyshareRaw) setError(prev => prev + `\n[debug] ${(r as any).anyshareRaw}`); return; }
      setPublished({
        entriesPublished: r.entriesPublished ?? validItems.length,
        sessionDate,
        syncCode: r.syncCode,
        bundleCreated: r.bundleCreated,
        fileUrl: r.fileUrl,
        entriesCount: r.entriesCount,
        perTarget: r.perTarget,
      });
      // 自动把刚发布的作业落到本地课程（与远端 ID 对齐）
      if (r.syncCode) await window.taskAPI.homework.receive(r.syncCode);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async (which: 'sync') => {
    if (!published?.syncCode) return;
    await copyText(published.syncCode);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const addItem = () => setItems((arr) => [...arr, blankEntry()]);
  const removeItem = (idx: number) => setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  const updateItem = (idx: number, patch: Partial<EntryDraft>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const footer = (() => {
    if (published) {
      return <>
        <button onClick={() => { setPublished(null); setItems([blankEntry()]); }} className="btn-ghost">再发一组</button>
        <button onClick={onClose} className="btn-neon">完成</button>
      </>;
    }
    const btnLabel = busy ? '上传中…' : (
      targets.cloud && targets.github ? `上传 ${validItems.length || ''} 条到 GitHub + 云盘`
      : targets.cloud ? `上传 ${validItems.length || ''} 条到北科云盘`
      : `上传 ${validItems.length || ''} 条到 GitHub`
    );
    return <>
      <button onClick={onClose} className="btn-ghost">取消</button>
      <button onClick={submit} disabled={!canSubmit} className="btn-neon btn-neon-yellow">
        <CloudUpload size={14} /> {btnLabel}
      </button>
    </>;
  })();

  return (
    <Modal title="发布作业" onClose={onClose} footer={footer}>
      <div className="space-y-3">
        {published ? (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-neon-green/40 bg-neon-green/5 space-y-2">
              <div className="flex items-center gap-2 text-neon-green font-bold text-sm"><CheckCircle2 size={16} /> 发布成功，已落到本地</div>
              <div className="font-mono text-xs text-text-secondary">
                本次发布 <span className="text-neon-green font-bold">{published.entriesPublished}</span> 条作业 · 上课 {published.sessionDate}
              </div>
              <div className="font-mono text-[10px] text-text-dim leading-relaxed">
                {published.bundleCreated
                  ? '✦ 首次发布 — 新建了一个码包'
                  : <>本码包现在共 <span className="text-neon-green font-bold">{published.entriesCount ?? '?'}</span> 条作业</>}
                。把下面这个 8 位「同步作业码」发给同学，同学点「接收作业」即可一次导入全部 {published.entriesCount ?? ''} 条：
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-text-dim text-xs shrink-0 w-20">同步作业码</span>
                <span className="text-neon-green tracking-widest font-bold text-base">{published.syncCode}</span>
                <button onClick={() => doCopy('sync')} className="btn-ghost p-1 text-[9px]">
                  {copied === 'sync' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
              {published.perTarget && published.perTarget.length > 1 && (
                <div className="font-mono text-[10px] text-text-dim border-t border-neon-green/15 pt-1">
                  {published.perTarget.map((t) => (
                    <span key={t.target} className={`mr-2 ${t.ok ? 'text-neon-green' : 'text-neon-danger'}`}>
                      {t.target === 'github' ? 'GitHub' : '北科云盘'}{t.ok ? ` ✓ ${t.entriesCount ?? 0} 条` : ` ✗ ${t.error || '失败'}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {published.fileUrl && (
              <button onClick={() => window.taskAPI.updater.openExternal(published.fileUrl!)} className="btn-ghost text-xs">
                <ExternalLink size={12} /> 在浏览器查看仓库里的作业文件
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 说明 */}
            <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10 text-[11px] font-mono text-text-dim leading-relaxed">
              同节课可一次性发布多条作业（每条独立标题/截止），共享同一个同步作业码。接收方输入这个码能一次拿到全部条目。
            </div>

            {/* 发布目标 */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-dim shrink-0">发布到</span>
              {([['github', 'GitHub'], ['cloud', '北科云盘（需校园网）']] as const).map(([v, label]) => (
                <label
                  key={v}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border cursor-pointer transition-colors ${targets[v] ? 'border-neon-green bg-neon-green/15 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={targets[v]}
                    onChange={(e) => setTargets({ ...targets, [v]: e.target.checked })}
                    className="w-3 h-3 accent-neon-green"
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* 课程 + 上课日期（共享给所有条目） */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="课程 *">
                <select
                  value={courseId ?? ''}
                  onChange={(e: any) => setCourseId(Number(e.target.value))}
                  className="input-neon"
                >
                  {courses.length === 0 && <option value="">（暂无课程，请先在「课程」页新建）</option>}
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="上课日期 *（本节作业日期）">
                <input type="date" value={sessionDate} onChange={(e: any) => setSessionDate(e.target.value)} className="input-neon" />
              </Field>
            </div>
            {sessionOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sessionOptions.map(o => {
                  const active = o.date === sessionDate;
                  return (
                    <button
                      key={o.date}
                      onClick={() => setSessionDate(o.date)}
                      className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${active ? 'border-neon-green bg-neon-green/15 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
                    >
                      {o.date.slice(5)} {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(o.date).day()]} {o.time}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 作业条目列表（v1.1.8+ 批量发布） */}
            <div className="rounded-md border border-neon-green/20 bg-ink-base/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="label-tag text-[11px]">本节作业 · {items.length} 条 · {validItems.length} 已填</span>
                <button
                  onClick={addItem}
                  className="px-2 py-0.5 rounded text-[10px] font-mono border border-neon-green/40 bg-neon-green/10 text-neon-green hover:bg-neon-green/20 transition-colors"
                >
                  <Plus size={11} className="inline -mt-0.5" /> 添加作业条目
                </button>
              </div>
              {items.map((it, idx) => (
                <EntryEditor
                  key={idx}
                  item={it}
                  canRemove={items.length > 1}
                  autoFocus={idx === items.length - 1}
                  onChange={(patch) => updateItem(idx, patch)}
                  onRemove={() => removeItem(idx)}
                />
              ))}
            </div>

            {/* secret edit（可选） */}
            <div className="p-2 rounded-md border border-neon-yellow/20 bg-neon-yellow/5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={secretMode} onChange={(e) => setSecretMode(e.target.checked)} className="accent-[#FFCC00]" />
                <span className="font-mono text-[11px] text-text-secondary">
                  <strong className="text-neon-yellow">secret edit（可选）</strong>：开启后只有输入「作业发布码」才能改这个码包。
                  默认关闭——只要有 GitHub 令牌就能改（一般场景够用；想限制修改权限再勾）。
                </span>
              </label>
              {secretMode && (
                <div className="mt-2">
                  <input
                    value={publishCode}
                    onChange={(e: any) => {
                      // IME 合成中保留原文，避免打断中文输入；合成结束再 toUpperCase
                      const v = e.target.value;
                      setPublishCode(e.nativeEvent?.isComposing ? v : v.toUpperCase());
                    }}
                    className="input-neon font-mono tracking-widest text-xs"
                    placeholder="12 位发布码（如 7KQ2M4XPT9F3）"
                    maxLength={12}
                  />
                </div>
              )}
            </div>

            {error && <div className="p-2 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs">✗ {error}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

/** 单条作业条目编辑器（用于批量发布弹窗内的列表项） */
function EntryEditor({
  item, onChange, onRemove, canRemove, autoFocus,
}: {
  item: { type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string };
  onChange: (patch: Partial<{ type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string }>) => void;
  onRemove: () => void;
  canRemove: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="rounded border border-neon-green/15 bg-ink-base/30 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={item.type}
          onChange={(e: any) => onChange({ type: e.target.value })}
          className="input-neon text-[11px] px-1.5 py-0.5"
          style={{ width: '78px' }}
        >
          <option value="homework">作业</option>
          <option value="exam">考试</option>
          <option value="project">项目</option>
          <option value="reading">阅读</option>
          <option value="other">其他</option>
        </select>
        <input
          value={item.title}
          onChange={(e: any) => onChange({ title: e.target.value })}
          className="input-neon text-xs flex-1"
          placeholder="如：第三章习题 1-10"
          autoFocus={autoFocus}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded text-neon-danger/70 hover:text-neon-danger hover:bg-neon-danger/10 transition-colors"
            title="删除这条"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <textarea
        value={item.content}
        onChange={(e: any) => onChange({ content: e.target.value })}
        rows={2}
        className="input-neon text-xs w-full"
        placeholder="具体要求（可选）"
      />
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-text-dim shrink-0 font-mono">截止</span>
        <input
          type="datetime-local"
          value={item.dueDate}
          onChange={(e: any) => onChange({ dueDate: e.target.value })}
          className="input-neon text-[11px] py-0.5"
          style={{ width: 'auto' }}
        />
        <span className="text-text-dim font-mono">（默认上课日 23:59）</span>
      </div>
    </div>
  );
}

/** 接收作业弹窗：输入同步作业码 → 从 GitHub 拉取这个包 → 匹配本地课程 → 自动挂载。
 *  v1.1.3：远端 bundle 引用的本地课程缺失时不再自动建课，而是弹窗告知让用户主动同步课程。
 */
function ReceiveHomeworkModal({ onClose, onSynced }: { onClose: () => void; onSynced: () => Promise<void> }) {
  const [syncCode, setSyncCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean; error?: string; source?: string; courseName?: string; courseNotFound?: boolean;
    syncCode?: string;
    courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
    entries: number; created: number; updated: number;
    coursesTouched: number; coursesCreated: string[];
    /** v1.1.8+：按课程分组的精确挂载计数（多平行班时分别列出） */
    perCourse?: Array<{ courseId: number; courseName: string; entries: number; created: number; updated: number }>;
    items: Array<{ courseId: number; courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
    /** v1.1.9+：跨课程混包中缺课程而跳过的条目 */
    skipped?: Array<{ title: string; courseName: string; reason: string }>;
    /** v1.2.0+：接收时自动合并掉的本地重复条目数 */
    deduped?: number;
  } | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [creatingCourse, setCreatingCourse] = useState(false);

  useEffect(() => {
    window.taskAPI.homework.config().then(cfg => setLastSync(cfg.lastSync));
  }, []);

  const run = async (overrideCode?: string, chooseCourseId?: number) => {
    const code = (overrideCode ?? syncCode).trim();
    if (busy || !code) return;
    setBusy(true); setResult(null);
    try {
      // v1.1.6：chooseCourseId = 同名多课时用户手选的课程；首次接收不传，由后端按 guid/课程名匹配
      const r = await window.taskAPI.homework.receive(code, chooseCourseId);
      setResult(r);
      if (r.ok) {
        setLastSync(r.syncedAt);
        await onSynced();
      }
    } finally {
      setBusy(false);
    }
  };

  /** 在本地新建缺失的课程，然后再次接收把作业挂上去 */
  const createMissingCourseAndReceive = async () => {
    if (!result?.courseName || busy || creatingCourse) return;
    setCreatingCourse(true);
    try {
      const created = await window.taskAPI.db.courses.create({
        name: result.courseName,
        description: '由作业接收自动创建（请补全课程信息）',
      });
      // 新课程建好后再次接收，把作业挂到新课程上
      setSyncCode(result.syncCode || syncCode);
      setResult(null);
      await run(result.syncCode || syncCode);
      // 让父组件刷新（onSynced 已在 run 里调过）
      await onSynced();
    } catch (e: any) {
      setResult({
        ok: false, error: '新建课程失败：' + (e?.message || e),
        entries: 0, created: 0, updated: 0, coursesTouched: 0, coursesCreated: [], items: [],
      });
    } finally {
      setCreatingCourse(false);
    }
  };

  return (
    <Modal
      title="接收作业"
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-ghost">关闭</button>
        <button onClick={() => run()} disabled={busy || !syncCode.trim()} className="btn-neon">
          <CloudDownload size={14} className={busy ? 'animate-bounce' : ''} /> {busy ? '接收中…' : '接收作业'}
        </button>
      </>}
    >
      <div className="space-y-3">
        <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10 text-[11px] font-mono text-text-dim">
          输入发布者分享的同步作业码，从 GitHub 拉取对应课程作业包，自动挂到本地同名课程。
          {lastSync ? <span className="block mt-1">上次接收：{dayjs(lastSync).format('YYYY-MM-DD HH:mm')}</span> : <span className="block mt-1">还没接收过</span>}
        </div>

        <Field label="同步作业码 *">
          <input
            value={syncCode}
            autoFocus
            onChange={(e: any) => {
              // IME 合成中保留原文，避免打断中文输入
              const v = e.target.value;
              setSyncCode(e.nativeEvent?.isComposing ? v : v.toUpperCase());
              setResult(null);
            }}
            onKeyDown={(e: any) => e.key === 'Enter' && run()}
            className="input-neon font-mono tracking-widest"
            placeholder="8 位，如 7KQ2M4XP"
            maxLength={8}
          />
        </Field>

        {/* 同名多门课程：弹窗手选挂载目标（v1.1.6） */}
        {result && !result.ok && (result.courseCandidates?.length ?? 0) > 0 && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="flex items-center gap-2 text-neon-yellow font-bold text-sm">
              <AlertCircle size={15} /> 同名课程 · 请选择挂载目标
            </div>
            <div className="font-mono text-xs text-text-secondary">
              本地有 {result.courseCandidates!.length} 门「<span className="text-neon-yellow font-bold">{result.courseName}</span>」，这个作业包没有可辨别的课程标识（老格式包），不会自动乱挂。
            </div>
            <div className="space-y-1">
              {result.courseCandidates!.map(c => (
                <button
                  key={c.id}
                  onClick={() => run(result.syncCode || syncCode, c.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-neon-green/20 hover:border-neon-green/60 bg-ink-base/40 text-left transition-colors"
                >
                  <span className="text-sm text-text-secondary truncate">{c.name}</span>
                  {c.code && <span className="font-mono text-[10px] text-text-dim shrink-0">{c.code}</span>}
                  {c.instructor && <span className="font-mono text-[10px] text-text-dim shrink-0">· {c.instructor}</span>}
                  <span className="ml-auto font-mono text-[9px] text-neon-green shrink-0">选它 →</span>
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              提示：让发布方用 v1.1.6+ 重新发布一次，包里会带课程标识，以后就能自动精确挂载。
            </div>
          </div>
        )}

        {/* 课程缺失：弹窗告知 */}
        {result && !result.ok && result.courseNotFound && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="flex items-center gap-2 text-neon-yellow font-bold text-sm">
              <AlertCircle size={15} /> 本地没有同名课程
            </div>
            <div className="font-mono text-xs text-text-secondary">
              远端作业包引用了课程「<span className="text-neon-yellow font-bold">{result.courseName}</span>」，但你本地还没有这门课。
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              接收作业要求「本地已存在同名课程」（避免被远端包任意新建空课）。两种处理：
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={createMissingCourseAndReceive}
                disabled={creatingCourse}
                className="btn-neon btn-neon-yellow text-xs"
              >
                <Plus size={12} /> {creatingCourse ? '建课中…' : '新建该课程并接收'}
              </button>
              <button onClick={onClose} className="btn-ghost text-xs">
                我先去手动添加课程
              </button>
            </div>
          </div>
        )}

        {/* 接收成功 */}
        {result?.ok && (
          <div className="space-y-2">
            <div className="p-3 rounded-md border border-neon-green/40 bg-neon-green/5">
              <div className="flex items-center gap-2 text-neon-green font-bold text-sm"><CheckCircle2 size={16} /> 接收成功</div>
              <div className="font-mono text-xs text-text-secondary mt-2">
                课程「{result.courseName}」· 来源 {result.source === 'cloud' ? '云盘' : 'GitHub'} ·
                远端共 <span className="text-text-secondary font-bold">{result.entries}</span> 条作业
                {result.coursesTouched > 1 && <> · 命中 <span className="text-neon-green font-bold">{result.coursesTouched}</span> 门课程</>}
              </div>
              {/* 多课程时按课程分组展示精确挂载数（v1.1.8+） */}
              {result.perCourse && result.perCourse.length > 1 ? (
                <div className="mt-2 space-y-1">
                  {result.perCourse.map((pc) => (
                    <div key={pc.courseId} className="flex items-center gap-2 px-2 py-1 rounded bg-ink-base/40 border border-neon-green/15 text-[11px] font-mono">
                      <span className="text-text-secondary truncate">{pc.courseName}</span>
                      <span className="ml-auto text-text-dim text-[10px] shrink-0">{pc.entries} 条</span>
                      <span className="text-neon-green shrink-0">新增 {pc.created}</span>
                      <span className="text-neon-yellow shrink-0">更新 {pc.updated}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[10px] text-text-secondary mt-1">
                  新增 <span className="text-neon-green font-bold">{result.created}</span> 条 · 更新 <span className="text-neon-yellow font-bold">{result.updated}</span> 条
                </div>
              )}
              {result.coursesCreated.length > 0 && (
                <div className="font-mono text-[10px] text-neon-yellow mt-1">本次新建课程：{result.coursesCreated.join('、')}</div>
              )}
              {(result.deduped ?? 0) > 0 && (
                <div className="font-mono text-[10px] text-neon-yellow mt-1">已自动合并 {result.deduped} 条重复作业（历史同步产生的重复已清理）</div>
              )}
            </div>
            {result.items.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {result.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-ink-base/40 border border-neon-green/10 text-[11px]">
                    <span className={`px-1 rounded text-[9px] font-mono shrink-0 ${it.action === 'created' ? 'border border-neon-green/40 text-neon-green' : 'border border-neon-yellow/40 text-neon-yellow'}`}>
                      {it.action === 'created' ? '新增' : '更新'}
                    </span>
                    <span className="text-text-secondary truncate">{it.courseName}</span>
                    <span className="flex-1 min-w-0 truncate text-text-secondary">· {it.title}</span>
                    <span className="font-mono text-[9px] text-text-dim shrink-0">{it.sessionDate?.slice(5) || ''}</span>
                  </div>
                ))}
              </div>
            )}
            {result.entries === 0 && (
              <div className="py-2 text-center font-mono text-xs text-text-dim">这个码包里还没有作业条目</div>
            )}
            {(result.skipped?.length ?? 0) > 0 && (
              <div className="p-2 rounded-md border border-neon-yellow/30 bg-neon-yellow/5 space-y-1">
                <div className="flex items-center gap-1.5 text-neon-yellow text-[11px] font-bold">
                  <AlertCircle size={12} /> 有 {result.skipped!.length} 条作业没挂上（本地缺对应课程）
                </div>
                {result.skipped!.map((s, i) => (
                  <div key={i} className="font-mono text-[10px] text-text-secondary">
                    「{s.courseName}」{s.title} · {s.reason}
                  </div>
                ))}
                <div className="font-mono text-[10px] text-text-dim">在「课程」页新建对应课程后再接收一次即可挂上。</div>
              </div>
            )}
          </div>
        )}

        {/* 其它失败 */}
        {result && !result.ok && !result.courseNotFound && (result.courseCandidates?.length ?? 0) === 0 && (
          <div className="p-2 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs whitespace-pre-wrap">✗ {result.error || '接收失败'}</div>
        )}
      </div>
    </Modal>
  );
}
