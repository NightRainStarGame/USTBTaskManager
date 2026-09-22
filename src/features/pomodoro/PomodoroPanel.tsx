/**
 * v1.2.8 块 P：番茄钟展开面板
 * - 组合 TimerRing + TimeDigits + TaskPicker + 控制条 + 统计
 * - 接收 reducer dispatch + state.open 闭包
 */
import { Play, Pause, RotateCcw, X, Coffee } from 'lucide-react';
import clsx from '../../utils/clsx';
import type { PomodoroAction, PomodoroState } from './types';
import { TimerRing } from './TimerRing';
import { TimeDigits } from './TimeDigits';
import { TaskPicker } from './TaskPicker';
import type { Requirement } from '@/types';

interface PomodoroPanelProps {
  state: PomodoroState;
  dispatch: (action: PomodoroAction) => void;
  workMin: number;
  breakMin: number;
  secondsOffset: number;
  /** 当前显示的秒数（用于绑到 TimeDigits） */
  ssTotal: number;
  /** 秒数变化回调（写 localStorage） */
  onSecondsOffsetChange: (next: number) => void;
  /** 工作时长变化回调（写 settings） */
  onWorkMinChange: (next: number) => void;
  /** 任务下拉 */
  pendingReqs: Requirement[];
  /** 重置当前阶段 */
  onReset: () => void;
}

export function PomodoroPanel({
  state, dispatch, workMin, breakMin, secondsOffset, ssTotal,
  onSecondsOffsetChange, onWorkMinChange, pendingReqs, onReset,
}: PomodoroPanelProps) {
  const totalSecs = state.totalSecs;
  const remaining = state.remaining;
  const progress = totalSecs > 0 ? 1 - remaining / totalSecs : 0;

  // 中心显示 = 剩余秒数（mm + ss）
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const phaseColor =
    state.phase === 'work' ? 'text-neon-green' :
    state.phase === 'break' ? 'text-neon-yellow' :
    'text-text-secondary';

  const isLocked = state.phase !== 'idle';

  return (
    <div
      className={clsx(
        'w-72 rounded-xl glass-panel p-4 space-y-3 shadow-neon-green/30 animate-panel-spring',
        state.flash && 'animate-pulse-glow border-neon-green',
      )}
    >
      {/* 顶部：标题 + 关闭 */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-text-dim">FOCUS TIMER</span>
        <button
          onClick={() => dispatch({ type: 'close' })}
          className="btn-ghost p-1"
          title="关闭 (Esc)"
          aria-label="关闭面板"
        >
          <X size={14} />
        </button>
      </div>
      {/* 环形计时 + 数字（带滚轮交互） */}
      <div className="flex flex-col items-center gap-2">
        <TimerRing
          phase={state.phase}
          progress={progress}
          remaining={remaining}
          totalSecs={totalSecs}
          // 数字由 TimeDigits 渲染；TimerRing 这里通过 children 模式接收，避免两处渲染数字
          mm={mm}
          ss={ss}
        />
        {/* 悬浮可滚轮调时间的数字版本（仅 idle 时） */}
        {state.phase === 'idle' && (
          <div className="text-[10px] text-text-dim font-mono flex items-center gap-1">
            <span>时长</span>
            <TimeDigits
              minutes={workMin}
              secondsOffset={secondsOffset}
              locked={isLocked}
              mm={String(Math.floor(ssTotal / 60)).padStart(2, '0')}
              ss={String(ssTotal % 60).padStart(2, '0')}
              colorClass={phaseColor}
              onChange={({ minutes, secondsOffset: next }) => {
                if (minutes !== workMin) onWorkMinChange(minutes);
                if (next !== secondsOffset) onSecondsOffsetChange(next);
              }}
            />
          </div>
        )}
        {/* 绑定任务 */}
        <TaskPicker
          requirements={[]}
          pendingReqs={pendingReqs}
          value={state.refReqId}
          onChange={(id) => dispatch({ type: 'setRefReq', refReqId: id })}
          disabled={state.phase !== 'idle'}
        />
      </div>
      {/* 控制条 */}
      <div className="flex items-center justify-center gap-2">
        {state.phase === 'idle' ? (
          <button
            onClick={() => dispatch({ type: 'startWork', workMin, breakMin })}
            className="btn-neon px-4 py-1.5 text-xs font-mono flex items-center gap-1.5"
          >
            <Play size={13} /> 开始专注 {workMin}′
          </button>
        ) : (
          <>
            <button
              onClick={() => dispatch({ type: state.paused ? 'resume' : 'pause' })}
              className="btn-ghost px-3 py-1.5 text-xs font-mono flex items-center gap-1"
            >
              {state.paused ? <Play size={13} /> : <Pause size={13} />} {state.paused ? '继续' : '暂停'}
            </button>
            <button
              onClick={onReset}
              className="btn-ghost px-3 py-1.5 text-xs font-mono flex items-center gap-1"
              title="重置"
            >
              <RotateCcw size={13} /> 重置
            </button>
          </>
        )}
      </div>
      {/* 今日统计 */}
      <div className="flex items-center justify-between font-mono text-[10px] text-text-dim pt-1 border-t border-neon-green/10">
        <span className="flex items-center gap-1">
          <Coffee size={11} /> 今日专注 {state.todayMinutes} 分钟
        </span>
        {state.phase === 'break' && <span className="text-neon-yellow">休息中…</span>}
      </div>
      {/* 拖动提示 */}
      <div className="text-[9px] text-text-dim font-mono pt-1 border-t border-neon-green/10 text-center">
        可拖动 · 双击浮动按钮重置位置
      </div>
    </div>
  );
}