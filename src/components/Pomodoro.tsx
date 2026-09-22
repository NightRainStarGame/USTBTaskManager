/**
 * v1.2.3 全局番茄钟：悬浮右下角（所有页面可用），绑定任务专注 + 落库统计。
 * 工作时段结束自动记录 pomodoro_sessions，休息后自动回到就绪态。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { Timer, Play, Pause, RotateCcw, X, Coffee, ListTodo } from 'lucide-react';
import clsx from '../utils/clsx';
import { useStore } from '@/store';
import type { Requirement } from '@/types';

type Phase = 'idle' | 'work' | 'break';

const DEFAULT_WORK = 25;
const DEFAULT_BREAK = 5;

export default function PomodoroWidget() {
  const requirements = useStore(s => s.requirements);
  const settings = useStore(s => s.settings);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [remaining, setRemaining] = useState(DEFAULT_WORK * 60);
  const [totalSecs, setTotalSecs] = useState(DEFAULT_WORK * 60);
  const [paused, setPaused] = useState(false);
  const [refReqId, setRefReqId] = useState<number | null>(null);
  const [todayMinutes, setTodayMinutes] = useState(0);
  const [flash, setFlash] = useState(false);
  const startedAtRef = useRef<number>(0);
  const notifiedRef = useRef(false);

  const workMin = Number(settings.pomodoro_work) || DEFAULT_WORK;
  const breakMin = Number(settings.pomodoro_break) || DEFAULT_BREAK;

  const pendingReqs: Requirement[] = useMemo(
    () => requirements.filter(r => r.status !== 'done').slice(0, 30),
    [requirements]
  );
  const boundReq = pendingReqs.find(r => r.id === refReqId) || null;

  // 今日专注时长（面板打开时刷新）
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const dayStart = dayjs().startOf('day').valueOf();
        const stats = await window.taskAPI.db.pomodoro.stats(dayStart, Date.now());
        const m = stats.byDay.find(d => d.day === dayjs().format('YYYY-MM-DD'));
        setTodayMinutes(m?.minutes ?? 0);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [open, phase]);

  // 计时（finishPhase 经 ref 调用，避免 interval 闭包捕获旧 phase）
  useEffect(() => {
    if (phase === 'idle' || paused) return;
    const t = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          setTimeout(() => finishPhaseRef.current(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, paused]);

  const startWork = () => {
    setPhase('work');
    setPaused(false);
    notifiedRef.current = false;
    setTotalSecs(workMin * 60);
    setRemaining(workMin * 60);
    startedAtRef.current = Date.now();
  };

  const finishPhase = () => {
    if (phase === 'work') {
      // 落库
      const minutes = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
      window.taskAPI.db.pomodoro.create({
        course_id: boundReq?.course_id ?? null,
        ref_type: boundReq ? 'requirement' : null,
        ref_id: boundReq?.id ?? null,
        label: boundReq ? `${boundReq.course_name || ''} · ${boundReq.title}` : '自由专注',
        started_at: startedAtRef.current,
        ended_at: Date.now(),
        minutes,
        mode: 'work',
      }).catch(() => { /* ignore */ });
      setTodayMinutes(m => m + minutes);
      // 通知
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        try { new Notification('[StarOS] 番茄钟完成 🍅', { body: `专注 ${minutes} 分钟${boundReq ? ` · ${boundReq.title}` : ''}，休息一下吧` }); } catch { /* ignore */ }
      }
      setFlash(true);
      setTimeout(() => setFlash(false), 4000);
      // 进入休息
      setPhase('break');
      setPaused(false);
      setTotalSecs(breakMin * 60);
      setRemaining(breakMin * 60);
    } else if (phase === 'break') {
      try { new Notification('[StarOS] 休息结束', { body: '回到专注，开始下一个番茄！' }); } catch { /* ignore */ }
      setPhase('idle');
      setRemaining(workMin * 60);
    }
  };

  // finishPhase 在 interval 闭包里调用会拿到旧 phase —— 用 ref 同步最新实现
  const finishPhaseRef = useRef<() => void>(() => {});
  useEffect(() => { finishPhaseRef.current = finishPhase; });

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const progress = totalSecs > 0 ? 1 - remaining / totalSecs : 0;

  const phaseColor = phase === 'work' ? 'text-neon-green' : phase === 'break' ? 'text-neon-yellow' : 'text-text-secondary';
  const ringColor = phase === 'work' ? '#00FF88' : '#FFC53D';

  return (
    <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3">
      {/* 展开面板 */}
      {open && (
        <div className={clsx(
          'w-72 rounded-xl glass-panel p-4 space-y-3 shadow-neon-green/30',
          flash && 'animate-pulse-glow border-neon-green'
        )}>
          {/* 环形计时 */}
          <div className="flex flex-col items-center gap-2">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="6" />
                <circle
                  cx="50" cy="50" r="45" fill="none" stroke={ringColor} strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 45}`}
                  strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress)}`}
                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={clsx('font-mono text-2xl font-bold tabular-nums', phaseColor)}>{mm}:{ss}</span>
                <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim mt-0.5">
                  {phase === 'idle' ? 'READY' : phase === 'work' ? 'FOCUS' : 'BREAK'}
                </span>
              </div>
            </div>
            {/* 绑定任务 */}
            <div className="w-full">
              <div className="flex items-center gap-1.5 text-text-dim font-mono text-[10px] uppercase tracking-wider mb-1">
                <ListTodo size={11} /> 绑定任务（可选）
              </div>
              <select
                value={refReqId ?? ''}
                onChange={(e) => setRefReqId(e.target.value ? Number(e.target.value) : null)}
                disabled={phase !== 'idle'}
                className="w-full bg-ink-900 border border-neon-green/20 rounded px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-neon-green disabled:opacity-50"
              >
                <option value="">自由专注</option>
                {pendingReqs.map(r => (
                  <option key={r.id} value={r.id}>{r.course_name} · {r.title}</option>
                ))}
              </select>
            </div>
          </div>
          {/* 控制条 */}
          <div className="flex items-center justify-center gap-2">
            {phase === 'idle' ? (
              <button onClick={startWork} className="btn-neon px-4 py-1.5 text-xs font-mono flex items-center gap-1.5">
                <Play size={13} /> 开始专注 {workMin}′
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setPaused(p => !p); }}
                  className="btn-ghost px-3 py-1.5 text-xs font-mono flex items-center gap-1"
                >
                  {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? '继续' : '暂停'}
                </button>
                <button
                  onClick={() => { setPhase('idle'); setRemaining(workMin * 60); setPaused(false); }}
                  className="btn-ghost px-3 py-1.5 text-xs font-mono flex items-center gap-1"
                >
                  <RotateCcw size={13} /> 重置
                </button>
              </>
            )}
          </div>
          {/* 今日统计 */}
          <div className="flex items-center justify-between font-mono text-[10px] text-text-dim pt-1 border-t border-neon-green/10">
            <span className="flex items-center gap-1"><Coffee size={11} /> 今日专注 {todayMinutes} 分钟</span>
            {phase === 'break' && <span className="text-neon-yellow">休息中…</span>}
          </div>
        </div>
      )}

      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'w-14 h-14 rounded-full glass-panel flex items-center justify-center transition-all',
          'shadow-neon-green hover:shadow-[0_0_18px_rgba(0,255,136,0.5)]',
          phase !== 'idle' && 'animate-pulse-glow',
          flash && 'ring-2 ring-neon-green'
        )}
        title="番茄钟 · 专注计时"
      >
        {open ? <X size={20} className="text-text-secondary" /> : (
          <div className="flex flex-col items-center leading-none">
            <Timer size={18} className={phase === 'work' ? 'text-neon-green' : phase === 'break' ? 'text-neon-yellow' : 'text-text-secondary'} />
            {phase !== 'idle' && (
              <span className="font-mono text-[10px] font-bold mt-0.5 tabular-nums text-text-primary">{mm}:{ss}</span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}
