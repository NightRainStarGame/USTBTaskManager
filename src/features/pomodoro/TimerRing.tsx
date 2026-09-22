/**
 * v1.2.8 块 P：番茄钟环形计时 SVG
 * - 入场 panel-spring 动画
 * - 进度环 stroke-dashoffset 缓动（ease-out 800ms，最后冲刺更顺）
 * - 阶段颜色由 phase 决定（work=green / break=yellow / idle=secondary）
 */
import clsx from '../../utils/clsx';
import type { Phase } from './types';

interface TimerRingProps {
  phase: Phase;
  /** 0..1 */
  progress: number;
  /** 剩余秒数（用于中心数字） */
  remaining: number;
  /** 当前阶段总秒数（用于显示 READY/FOCUS/BREAK 标签下方的次要信息，可选） */
  totalSecs: number;
  /** 中心数字 mm:ss */
  mm: string;
  ss: string;
}

const RING_R = 45;
const RING_C = 2 * Math.PI * RING_R;

export function TimerRing({ phase, progress, mm, ss }: TimerRingProps) {
  const ringColor = phase === 'break' ? '#FFC53D' : '#00FF88';
  const phaseColor =
    phase === 'work' ? 'text-neon-green' :
    phase === 'break' ? 'text-neon-yellow' :
    'text-text-secondary';
  const phaseLabel = phase === 'idle' ? 'READY' : phase === 'work' ? 'FOCUS' : 'BREAK';

  return (
    <div className="relative w-32 h-32 animate-panel-spring">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={RING_R} fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="6" />
        <circle
          cx="50" cy="50" r={RING_R}
          fill="none"
          stroke={ringColor}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${RING_C}`}
          strokeDashoffset={`${RING_C * (1 - progress)}`}
          style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {phase !== 'idle' && (
          <span className={clsx('font-mono text-2xl font-bold tabular-nums', phaseColor)}>{mm}:{ss}</span>
        )}
        <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim mt-0.5">
          {phaseLabel}
        </span>
      </div>
    </div>
  );
}