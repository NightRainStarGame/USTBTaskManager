import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { CalendarDays, BookOpen, FolderKanban, AlertTriangle, CheckCircle2, Clock, Sparkles, Zap, Timer, Flame, GraduationCap } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import QuickAdd from '@/components/QuickAdd';
import clsx from '../utils/clsx';
import type { Exam, Habit } from '@/types';

export default function Dashboard() {
  const stats = useStore(s => s.stats);
  const requirements = useStore(s => s.requirements);
  const events = useStore(s => s.events);
  const courses = useStore(s => s.courses);
  const projects = useStore(s => s.projects);
  const tasks = useStore(s => s.tasks);
  const userProfile = useStore(s => s.userProfile);
  const nav = useNavigate();

  // v1.2.3：考试横幅 / 习惯打卡行 / 今日专注
  const [exams, setExams] = useState<Exam[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayPomoMin, setTodayPomoMin] = useState(0);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [tick, setTick] = useState(0); // 分钟级时钟（下节课倒计时用）

  useEffect(() => {
    (async () => {
      try { setExams(await window.taskAPI.db.exams.list({ status: 'upcoming' })); } catch { /* mock */ }
      try { setHabits(await window.taskAPI.db.habits.list()); } catch { /* mock */ }
      try {
        const st = await window.taskAPI.db.pomodoro.stats(dayjs().startOf('day').valueOf(), Date.now());
        setTodayPomoMin(st.byDay.find(d => d.day === dayjs().format('YYYY-MM-DD'))?.minutes ?? 0);
      } catch { /* mock */ }
    })();
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const now = useMemo(() => dayjs(), [tick]);
  const today = dayjs().format('YYYY-MM-DD');

  const upcoming = requirements
    .filter(r => r.status !== 'done' && r.due_date >= now.startOf('day').valueOf())
    .sort((a, b) => a.due_date - b.due_date)
    .slice(0, 6);

  const todayEvents = events.filter(e => {
    const d = dayjs(e.start_at);
    return d.isSame(now, 'day');
  }).sort((a, b) => a.start_at - b.start_at);

  // v1.2.3：进行中 / 下一节课
  const currentClass = todayEvents.find(e => e.start_at <= now.valueOf() && (e.end_at ?? e.start_at + 45 * 60000) > now.valueOf()) || null;
  const nextClass = todayEvents.find(e => e.start_at > now.valueOf()) || null;

  const activeProjects = projects.filter(p => p.status === 'active').slice(0, 4);

  // v1.2.3：最近一场考试
  const nextExam = exams
    .filter(e => e.status === 'upcoming' && e.exam_date > now.valueOf())
    .sort((a, b) => a.exam_date - b.exam_date)[0] || null;

  const todayHabits = habits.filter(h => !h.checkinDates?.includes(today));
  const doneHabits = habits.length - todayHabits.length;

  const toggleHabit = async (id: number) => {
    await window.taskAPI.db.habits.toggleCheckin(id, today);
    setHabits(await window.taskAPI.db.habits.list());
  };

  return (
    <div className="p-6 space-y-6">
      {/* 顶部欢迎 / 时间 */}
      <div className="flex items-end justify-between">
        <div>
          <p className="label-tag">SYSTEM·OVERVIEW</p>
          <h1 className="text-3xl font-bold mt-1">
            <span className="text-text-primary">你好，</span>
            <span className="text-neon-green text-glow-green">{userProfile?.real_name || userProfile?.wx_nickname || '同学'}</span>
            <span className="text-text-primary">。</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            {now.format('YYYY年M月D日 dddd')} · {getTimeGreeting(now.hour())}
          </p>
        </div>
        <div className="font-mono text-[10px] text-text-dim uppercase tracking-widest text-right">
          <div>STATUS <span className="text-neon-green">▌ ONLINE</span></div>
          <div>SESSION #{now.format('YYYYMMDD-HHmmss')}</div>
        </div>
      </div>

      {/* v1.2.3：快捷添加（自然语言） */}
      <button
        onClick={() => setQuickAddOpen(true)}
        className="w-full glass-panel p-3 flex items-center gap-3 text-left hover:border-neon-green/40 transition-all group"
      >
        <Zap size={16} className="text-neon-green shrink-0" />
        <span className="text-sm text-text-dim group-hover:text-text-secondary transition-colors">
          快速添加：试试「周五交高数作业」「明天14:30复习数据结构」…
        </span>
        <span className="ml-auto font-mono text-[10px] text-text-dim border border-neon-green/20 rounded px-1.5 py-0.5 shrink-0">
          CTRL+SHIFT+A
        </span>
      </button>

      {/* v1.2.3：考试倒计时横幅 */}
      {nextExam && (
        <div
          onClick={() => nav('/academic')}
          className={clsx(
            'glass-panel p-4 flex items-center gap-4 cursor-pointer hover:border-neon-yellow/50 transition-all',
            nextExam.exam_date - now.valueOf() < 3 * 86400000 ? 'border-neon-yellow/40' : 'border-neon-green/15'
          )}
        >
          <GraduationCap size={22} className="text-neon-yellow shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary truncate">
              <span style={{ color: nextExam.course_color || '#FFC53D' }}>{nextExam.course_name || nextExam.title}</span>
              <span className="text-text-dim"> · {dayjs(nextExam.exam_date).format('MM-DD HH:mm')}</span>
              {nextExam.location && <span className="text-text-dim"> · {nextExam.location}</span>}
            </div>
            <div className="font-mono text-[10px] text-text-dim mt-0.5">EXAM MODE · 点击查看考试安排 / 生成复习任务</div>
          </div>
          <div className="text-right shrink-0">
            <div className={clsx('font-mono text-2xl font-bold tabular-nums', nextExam.exam_date - now.valueOf() < 86400000 ? 'text-neon-danger' : 'text-neon-yellow')}>
              {Math.ceil((nextExam.exam_date - now.valueOf()) / 86400000)}
            </div>
            <div className="font-mono text-[9px] text-text-dim uppercase">days left</div>
          </div>
        </div>
      )}

      {/* v1.2.3：下节课 / 进行中 横幅 */}
      {(currentClass || nextClass) && (
        <div className="glass-panel p-4 flex items-center gap-4 border-neon-green/25">
          <Clock size={22} className={clsx('shrink-0', currentClass ? 'text-neon-green animate-pulse' : 'text-neon-green')} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary truncate">
              {currentClass ? (
                <>上课中：<span className="text-neon-green">{currentClass.title}</span>{currentClass.location ? ` @ ${currentClass.location}` : ''}（至 {dayjs(currentClass.end_at ?? currentClass.start_at + 45 * 60000).format('HH:mm')}）</>
              ) : (
                <>下节课：<span className="text-neon-green">{nextClass!.title}</span> {dayjs(nextClass!.start_at).format('HH:mm')}{nextClass!.location ? ` @ ${nextClass!.location}` : ''}</>
              )}
            </div>
            <div className="font-mono text-[10px] text-text-dim mt-0.5">
              {currentClass ? 'FOCUS · 时间正在流逝' : `还有 ${Math.max(1, Math.round((nextClass!.start_at - now.valueOf()) / 60000))} 分钟开始`}
            </div>
          </div>
        </div>
      )}

      {/* 数据卡片矩阵 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={<CalendarDays size={18} />} label="今日截止" value={stats?.dueTodayReq ?? 0} accent="green" sub="截止时间在今天" />
        <StatCard icon={<AlertTriangle size={18} />} label="逾期任务" value={stats?.overdueReq ?? 0} accent="danger" sub="需要立即处理" />
        <StatCard icon={<Timer size={18} />} label="今日专注" value={todayPomoMin} accent="yellow" sub="番茄钟 · 分钟" />
        <StatCard icon={<Flame size={18} />} label="习惯打卡" value={`${doneHabits}/${habits.length || 0}`} accent="yellow" sub="今天已完成" />
        <StatCard icon={<FolderKanban size={18} />} label="活跃项目" value={stats?.activeProjects ?? 0} accent="green" sub="进行中" />
      </div>

      {/* v1.2.3：今日习惯打卡行 */}
      {habits.length > 0 && (
        <div className="glass-panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame size={14} className="text-neon-yellow" />
            <span className="label-tag">今日打卡 · {doneHabits}/{habits.length}</span>
            <button onClick={() => nav('/habits')} className="ml-auto font-mono text-[10px] text-text-dim hover:text-neon-green">MORE →</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {habits.map(h => {
              const done = h.checkinDates?.includes(today);
              return (
                <button
                  key={h.id}
                  onClick={() => toggleHabit(h.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-mono text-xs transition-all',
                    done ? 'text-ink-base border-transparent' : 'text-text-secondary border-neon-green/15 hover:border-neon-green/40 hover:text-neon-green'
                  )}
                  style={done ? { background: h.color } : undefined}
                >
                  <span>{h.emoji}</span> {h.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 即将到来（v1.2.3：倒计时进度条） */}
        <Panel title="即将到期" icon={<Clock size={14} />} className="lg:col-span-2">
          {upcoming.length === 0 ? (
            <EmptyState text="当前没有待办，享受片刻宁静 ✨" />
          ) : (
            <ul className="space-y-2">
              {upcoming.map(r => {
                const due = dayjs(r.due_date);
                const isToday = due.isSame(now, 'day');
                // v1.2.3：时间消耗进度（创建 → 截止）
                const span = r.due_date - (r.created_at || r.due_date);
                const used = span > 0 ? Math.min(100, Math.max(0, ((now.valueOf() - (r.created_at || r.due_date)) / span) * 100)) : 100;
                const urgent = used >= 80;
                return (
                  <li
                    key={r.id}
                    onClick={() => nav('/courses')}
                    className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 hover:border-neon-green/40 hover:bg-ink-base/60 cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className="status-dot" style={{ background: r.course_color, boxShadow: `0 0 6px ${r.course_color}` }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary truncate">{r.title}</div>
                        <div className="font-mono text-[11px] text-text-dim">
                          {r.course_name} · {due.format('MM-DD ddd HH:mm')}
                        </div>
                      </div>
                      <DueTag overdue={false} today={isToday} days={due.diff(now.startOf('day'), 'day')} />
                    </div>
                    {/* 倒计时进度条 */}
                    {span > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1 bg-ink-900/80 rounded-full overflow-hidden border border-neon-green/5">
                          <div
                            className="h-full transition-all"
                            style={{
                              width: `${used}%`,
                              background: urgent ? 'linear-gradient(90deg,#FFC53D99,#FF3355)' : 'linear-gradient(90deg,#00FF8844,#00FF88AA)',
                            }}
                          />
                        </div>
                        <span className={clsx('font-mono text-[9px] tabular-nums', urgent ? 'text-neon-danger' : 'text-text-dim')}>
                          {Math.round(used)}%
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* 今日课程 */}
        <Panel title="今日时间表" icon={<CalendarDays size={14} />}>
          {todayEvents.length === 0 ? (
            <EmptyState text="今天没有安排" />
          ) : (
            <ul className="space-y-2">
              {todayEvents.map(e => {
                const isCurrent = currentClass?.id === e.id;
                const isNext = nextClass?.id === e.id;
                return (
                  <li key={e.id} className={clsx(
                    'flex items-start gap-3 p-2 rounded-md',
                    isCurrent ? 'bg-neon-green/10 border border-neon-green/30' : isNext ? 'bg-neon-green/5 border border-neon-green/15' : 'hover:bg-ink-base/40 border border-transparent'
                  )}>
                    <div className="font-mono text-[11px] text-text-secondary w-12 shrink-0">
                      {dayjs(e.start_at).format('HH:mm')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{e.title}</div>
                      <div className="font-mono text-[10px] text-text-dim truncate">
                        {e.location}{isCurrent && <span className="text-neon-green"> · 进行中</span>}
                      </div>
                    </div>
                    {(isCurrent || isNext) && <span className="text-neon-green text-[9px] font-mono shrink-0 mt-1">{isCurrent ? 'NOW' : 'NEXT'}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* 项目进度 */}
      <Panel title="项目进行中" icon={<Sparkles size={14} />}>
        {activeProjects.length === 0 ? (
          <EmptyState text="暂无进行中的项目" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {activeProjects.map(p => {
              const projectTasks = tasks.filter(t => t.project_id === p.id);
              const done = projectTasks.filter(t => t.status === 'done').length;
              const total = projectTasks.length;
              const realProgress = total > 0 ? Math.round((done / total) * 100) : p.progress;
              return (
                <div
                  key={p.id}
                  onClick={() => nav('/projects')}
                  className="p-4 rounded-lg bg-ink-base/40 border border-neon-green/10 hover:border-neon-green/40 cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="font-mono text-xs text-neon-green">{realProgress}%</span>
                  </div>
                  <p className="text-xs text-text-dim line-clamp-2 mb-3">{p.description}</p>
                  <div className="progress-bar"><div style={{ width: `${realProgress}%` }} /></div>
                  <div className="flex items-center justify-between mt-2 font-mono text-[10px] text-text-dim">
                    <span>{done}/{total} 任务完成</span>
                    {p.due_date && <span>DUE {dayjs(p.due_date).format('MM-DD')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {quickAddOpen && <QuickAdd onClose={() => setQuickAddOpen(false)} />}
    </div>
  );
}

function StatCard({ icon, label, value, accent, sub }: any) {
  const colors = {
    green: 'border-neon-green/30 hover:border-neon-green hover:shadow-neon-green text-neon-green',
    yellow: 'border-neon-yellow/30 hover:border-neon-yellow hover:shadow-neon-yellow text-neon-yellow',
    danger: 'border-neon-danger/40 hover:border-neon-danger hover:shadow-[0_0_12px_rgba(255,51,102,0.6)] text-neon-danger',
  };
  return (
    <div className={`p-4 rounded-lg bg-ink-900/60 border ${colors[accent as keyof typeof colors]} transition-all group`}>
      <div className="flex items-center justify-between mb-2">
        <span className="label-tag text-current opacity-80">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-bold font-mono">{value}</div>
      <div className="text-[11px] text-text-dim mt-1 font-mono">{sub}</div>
    </div>
  );
}

function Panel({ title, icon, children, className = '' }: any) {
  return (
    <div className={`glass-panel p-5 ${className}`}>
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-neon-green/10">
        <span className="text-neon-green">{icon}</span>
        <h3 className="label-tag">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 text-center text-text-dim font-mono text-sm">
      <div className="opacity-50 mb-1">[ ∅ ]</div>
      {text}
    </div>
  );
}

function DueTag({ overdue, today, days }: { overdue: boolean; today: boolean; days: number }) {
  if (overdue) return <span className="data-pill border-neon-danger/50 text-neon-danger">逾期</span>;
  if (today) return <span className="data-pill border-neon-yellow/50 text-neon-yellow">今日</span>;
  if (days <= 3) return <span className="data-pill border-neon-yellow/40 text-neon-yellow/90">{days} 天后</span>;
  return <span className="data-pill">{days} 天后</span>;
}

function getTimeGreeting(h: number) {
  if (h < 6) return '深夜了，记得早点休息';
  if (h < 12) return '早安，新的一天开始了';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好，继续加油';
  if (h < 22) return '晚上好';
  return '夜深了';
}
