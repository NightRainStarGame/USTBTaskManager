import { useStore } from '@/store';
import { CalendarDays, BookOpen, FolderKanban, AlertTriangle, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const stats = useStore(s => s.stats);
  const requirements = useStore(s => s.requirements);
  const events = useStore(s => s.events);
  const courses = useStore(s => s.courses);
  const projects = useStore(s => s.projects);
  const tasks = useStore(s => s.tasks);
  const userProfile = useStore(s => s.userProfile);
  const nav = useNavigate();

  const now = dayjs();
  const upcoming = requirements
    .filter(r => r.status !== 'done' && r.due_date >= now.startOf('day').valueOf())
    .sort((a, b) => a.due_date - b.due_date)
    .slice(0, 6);

  const todayEvents = events.filter(e => {
    const d = dayjs(e.start_at);
    return d.isSame(now, 'day');
  }).sort((a, b) => a.start_at - b.start_at);

  const activeProjects = projects.filter(p => p.status === 'active').slice(0, 4);

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

      {/* 数据卡片矩阵 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<CalendarDays size={18} />} label="今日截止" value={stats?.dueTodayReq ?? 0} accent="green" sub="截止时间在今天" />
        <StatCard icon={<AlertTriangle size={18} />} label="逾期任务" value={stats?.overdueReq ?? 0} accent="danger" sub="需要立即处理" />
        <StatCard icon={<BookOpen size={18} />} label="在读课程" value={stats?.totalCourses ?? 0} accent="yellow" sub="当前学期" />
        <StatCard icon={<FolderKanban size={18} />} label="活跃项目" value={stats?.activeProjects ?? 0} accent="green" sub="进行中" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 即将到来 */}
        <Panel title="即将到期" icon={<Clock size={14} />} className="lg:col-span-2">
          {upcoming.length === 0 ? (
            <EmptyState text="当前没有待办，享受片刻宁静 ✨" />
          ) : (
            <ul className="space-y-2">
              {upcoming.map(r => {
                const due = dayjs(r.due_date);
                const isOverdue = due.isBefore(now, 'day');
                const isToday = due.isSame(now, 'day');
                return (
                  <li
                    key={r.id}
                    onClick={() => nav('/courses')}
                    className="flex items-center gap-3 p-3 rounded-md bg-ink-base/40 border border-neon-green/10 hover:border-neon-green/40 hover:bg-ink-base/60 cursor-pointer transition-all"
                  >
                    <span className="status-dot" style={{ background: r.course_color, boxShadow: `0 0 6px ${r.course_color}` }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{r.title}</div>
                      <div className="font-mono text-[11px] text-text-dim">
                        {r.course_name} · {due.format('MM-DD ddd HH:mm')}
                      </div>
                    </div>
                    <DueTag overdue={isOverdue} today={isToday} days={due.diff(now.startOf('day'), 'day')} />
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
              {todayEvents.map(e => (
                <li key={e.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-ink-base/40">
                  <div className="font-mono text-[11px] text-text-secondary w-12 shrink-0">
                    {dayjs(e.start_at).format('HH:mm')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{e.title}</div>
                    <div className="font-mono text-[10px] text-text-dim truncate">{e.location}</div>
                  </div>
                </li>
              ))}
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