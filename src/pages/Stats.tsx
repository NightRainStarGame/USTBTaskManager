/**
 * v1.2.3 统计页：周报 / 月报（待办完成趋势 · 课程分布 · 习惯打卡 · 出勤汇总）
 */
import { useEffect, useMemo, useState } from 'react';
import dayjs, { Dayjs } from 'dayjs';
import clsx from '../utils/clsx';
import {
  BarChart3, ChevronLeft, ChevronRight, CheckCircle2, Flame, UserCheck,
  TrendingUp, CalendarCheck, Timer,
} from 'lucide-react';

type Mode = 'week' | 'month';

/** 周一为一周起点（dayjs 默认周日） */
const mondayOf = (d: Dayjs): Dayjs => d.subtract((d.day() + 6) % 7, 'day').startOf('day');

type Report = {
  reqDoneByDay: Array<{ day: string; n: number }>;
  reqDoneByCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; n: number }>;
  habitCheckinsByDay: Array<{ day: string; n: number }>;
  attendanceSummary: Record<string, number>;
  range: { from: number; to: number };
};

export default function StatsPage() {
  const [mode, setMode] = useState<Mode>('week');
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [pomo, setPomo] = useState<{
    byDay: Array<{ day: string; minutes: number; sessions: number }>;
    byCourse: Array<{ courseId: number; courseName: string | null; courseColor: string | null; minutes: number; sessions: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const { from, to, label } = useMemo(() => {
    const base = mode === 'week' ? mondayOf(dayjs()).add(offset, 'week') : dayjs().startOf('month').add(offset, 'month');
    return {
      from: base,
      to: base.add(1, mode === 'week' ? 'week' : 'month'),
      label: mode === 'week' ? `${base.format('MM-DD')} ~ ${base.add(6, 'day').format('MM-DD')}` : base.format('YYYY-MM'),
    };
  }, [mode, offset]);

  useEffect(() => { setOffset(0); }, [mode]);

  useEffect(() => {
    setLoading(true);
    const f = from.valueOf(), t = to.valueOf();
    Promise.all([
      window.taskAPI.db.stats.report(f, t),
      window.taskAPI.db.pomodoro.stats(f, t),
    ])
      .then(([r, p]) => { setReport(r); setPomo(p); })
      .finally(() => setLoading(false));
  }, [from.valueOf(), to.valueOf()]);

  const days = useMemo(() => {
    const list: string[] = [];
    for (let d = from; d.isBefore(to); d = d.add(1, 'day')) list.push(d.format('YYYY-MM-DD'));
    return list;
  }, [from.valueOf(), to.valueOf()]);

  const byDay = (arr: Array<{ day: string; n: number }>) => new Map(arr.map(r => [r.day, r.n]));

  const reqMap = byDay(report?.reqDoneByDay || []);
  const habitMap = byDay(report?.habitCheckinsByDay || []);
  const pomoDayMap = new Map((pomo?.byDay || []).map(r => [r.day, r.minutes]));
  const totalReq = (report?.reqDoneByDay || []).reduce((s, r) => s + r.n, 0);
  const totalHabit = (report?.habitCheckinsByDay || []).reduce((s, r) => s + r.n, 0);
  const totalPomoMin = (pomo?.byDay || []).reduce((s, r) => s + r.minutes, 0);
  const att = report?.attendanceSummary || { present: 0, late: 0, absent: 0, leave: 0 };
  const attTotal = att.present + att.late + att.absent + att.leave;
  const attRate = attTotal ? Math.round(((att.present + att.late) / attTotal) * 100) : null;
  const maxCourseN = Math.max(1, ...(report?.reqDoneByCourse || []).map(c => c.n));
  const maxPomoCourse = Math.max(1, ...(pomo?.byCourse || []).map(c => c.minutes));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <BarChart3 className="text-neon-green" size={24} />
            统计 <span className="font-mono text-xs text-text-dim">STATS</span>
          </h1>
          <p className="text-sm text-text-dim mt-1">周报 · 月报，学习产出一目了然</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex">
            {([['week', '周报'], ['month', '月报']] as Array<[Mode, string]>).map(([k, text]) => (
              <button
                key={k}
                onClick={() => setMode(k)}
                className={clsx(
                  'px-4 py-2 font-mono text-xs uppercase tracking-wider transition-all rounded-l-md rounded-r-none border',
                  mode === k
                    ? 'bg-neon-green/10 text-neon-green border-neon-green/40'
                    : 'text-text-secondary border-neon-green/10 hover:text-neon-green hover:border-neon-green/30 bg-ink-900/40',
                  k === 'month' && 'rounded-l-none rounded-r-md border-l-0'
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <button onClick={() => setOffset(o => o - 1)} className="btn-ghost p-2" title="上一期"><ChevronLeft size={16} /></button>
          <span className="font-mono text-sm text-text-secondary tabular-nums min-w-[110px] text-center">{label}</span>
          <button onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} className="btn-ghost p-2 disabled:opacity-30" title="下一期"><ChevronRight size={16} /></button>
        </div>
      </header>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="完成待办" value={String(totalReq)} color="green" icon={<CheckCircle2 size={12} />} />
        <StatCard label="日均完成" value={(totalReq / days.length).toFixed(1)} color="blue" icon={<TrendingUp size={12} />} />
        <StatCard label="专注时长" value={totalPomoMin ? `${(totalPomoMin / 60).toFixed(1)}h` : '0h'} color="blue" icon={<Timer size={12} />} />
        <StatCard label="习惯打卡" value={String(totalHabit)} color="yellow" icon={<Flame size={12} />} />
        <StatCard label="出勤率" value={attRate != null ? `${attRate}%` : '—'} color={attRate != null && attRate < 80 ? 'danger' : 'green'} icon={<UserCheck size={12} />} />
      </div>

      {loading && <div className="text-center text-text-dim text-sm py-4">统计中…</div>}

      {!loading && (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* 每日待办完成趋势 */}
          <ChartCard title="每日待办完成" total={totalReq} icon={<CheckCircle2 size={13} />}>
            <BarChart days={days} data={reqMap} color="#00FF88" mode={mode} />
          </ChartCard>

          {/* 每日习惯打卡 */}
          <ChartCard title="每日习惯打卡" total={totalHabit} icon={<Flame size={13} />}>
            <BarChart days={days} data={habitMap} color="#FFC857" mode={mode} />
          </ChartCard>

          {/* 每日专注时长 */}
          <ChartCard title="每日专注时长（分钟）" total={totalPomoMin} icon={<Timer size={13} />}>
            <BarChart days={days} data={pomoDayMap} color="#38BDF8" mode={mode} unit=" 分钟" />
          </ChartCard>

          {/* 课程分布 */}
          <ChartCard title="待办完成 · 按课程" total={report?.reqDoneByCourse.length || 0} icon={<CalendarCheck size={13} />}>
            <div className="space-y-2.5">
              {(report?.reqDoneByCourse || []).map(c => (
                <div key={c.courseId} className="flex items-center gap-3 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.courseColor || '#00FF88' }} />
                  <span className="w-28 truncate text-text-secondary">{c.courseName || `课程#${c.courseId}`}</span>
                  <div className="flex-1 h-2 rounded bg-ink-900/80 overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${(c.n / maxCourseN) * 100}%`, background: c.courseColor || '#00FF88', opacity: 0.75 }}
                    />
                  </div>
                  <span className="w-6 text-right font-mono tabular-nums text-text-primary">{c.n}</span>
                </div>
              ))}
              {(!report || report.reqDoneByCourse.length === 0) && <Empty />}
            </div>
          </ChartCard>

          {/* 各科专注时长 */}
          <ChartCard title="专注时长 · 按课程" total={pomo?.byCourse.length || 0} icon={<Timer size={13} />}>
            <div className="space-y-2.5">
              {(pomo?.byCourse || []).map(c => (
                <div key={c.courseId} className="flex items-center gap-3 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.courseColor || '#38BDF8' }} />
                  <span className="w-28 truncate text-text-secondary">{c.courseName || '未绑定课程'}</span>
                  <div className="flex-1 h-2 rounded bg-ink-900/80 overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${(c.minutes / maxPomoCourse) * 100}%`, background: c.courseColor || '#38BDF8', opacity: 0.75 }}
                    />
                  </div>
                  <span className="w-10 text-right font-mono tabular-nums text-text-primary">
                    {c.minutes >= 60 ? `${(c.minutes / 60).toFixed(1)}h` : `${c.minutes}m`}
                  </span>
                </div>
              ))}
              {(!pomo || pomo.byCourse.length === 0) && <Empty text="本期没有专注记录" />}
            </div>
          </ChartCard>

          {/* 出勤汇总 */}
          <ChartCard title="出勤汇总" total={attTotal} icon={<UserCheck size={13} />}>
            <div className="space-y-2.5">
              {([
                ['present', '出勤', 'bg-neon-green'],
                ['late', '迟到', 'bg-neon-yellow'],
                ['absent', '缺勤', 'bg-neon-danger'],
                ['leave', '请假', 'bg-sky-400'],
              ] as Array<[string, string, string]>).map(([k, text, barColor]) => {
                const n = att[k] || 0;
                const pct = attTotal ? (n / attTotal) * 100 : 0;
                return (
                  <div key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-8 text-text-secondary">{text}</span>
                    <div className="flex-1 h-2 rounded bg-ink-900/80 overflow-hidden">
                      <div className={clsx('h-full rounded transition-all', barColor)} style={{ width: `${pct}%`, opacity: 0.75 }} />
                    </div>
                    <span className="w-10 text-right font-mono tabular-nums text-text-secondary">{n} · {pct.toFixed(0)}%</span>
                  </div>
                );
              })}
              {attTotal === 0 && <Empty text="本期没有出勤记录" />}
            </div>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

// ══════════════════ 汇总卡片（与 Academic 页同款） ══════════════════
function StatCard({ label, value, color, icon }: { label: string; value: string; color: 'green' | 'yellow' | 'danger' | 'blue'; icon?: React.ReactNode }) {
  const colors = {
    green: 'text-neon-green border-neon-green/25',
    yellow: 'text-neon-yellow border-neon-yellow/25',
    danger: 'text-neon-danger border-neon-danger/40',
    blue: 'text-sky-400 border-sky-400/25',
  }[color];
  return (
    <div className={clsx('glass-panel p-4 border', colors)}>
      <div className="flex items-center gap-1.5 text-text-dim text-xs">
        {icon}<span>{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function ChartCard({ title, total, icon, children }: {
  title: string; total: number; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-text-dim mb-4">
        {icon}<span className="text-text-secondary">{title}</span>
        <span className="ml-auto text-neon-green">{total}</span>
      </div>
      {children}
    </div>
  );
}

/** CSS 垂直条形图：按天聚合 */
function BarChart({ days, data, color, mode, unit = '' }: {
  days: string[]; data: Map<string, number>; color: string; mode: Mode; unit?: string;
}) {
  const max = Math.max(1, ...days.map(d => data.get(d) || 0));
  const totalN = days.reduce((s, d) => s + (data.get(d) || 0), 0);
  if (totalN === 0) return <Empty />;
  return (
    <div className="flex items-end gap-[3px] h-40">
      {days.map(d => {
        const n = data.get(d) || 0;
        const h = (n / max) * 100;
        const isToday = d === dayjs().format('YYYY-MM-DD');
        const showLabel = mode === 'week' || dayjs(d).date() % 5 === 1 || dayjs(d).date() === 1;
        return (
          <div key={d} className="flex-1 flex flex-col items-center gap-1 group relative min-w-0" title={`${d}：${n}${unit}`}>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t transition-all group-hover:opacity-100"
                style={{ height: `${Math.max(h, n > 0 ? 6 : 2)}%`, background: color, opacity: n > 0 ? (isToday ? 1 : 0.65) : 0.12 }}
              />
            </div>
            <span className={clsx('font-mono text-[9px] tabular-nums', isToday ? 'text-neon-green' : 'text-text-dim', showLabel ? '' : 'opacity-0')}>
              {mode === 'week' ? dayjs(d).format('dd') : dayjs(d).date()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ text = '暂无数据' }: { text?: string }) {
  return <div className="text-center text-xs text-text-dim py-10">{text}</div>;
}
