/**
 * v1.2.8 块 P：Pomodoro 状态机 hook
 * - reducer 集中管理所有状态变更（替代 useState × 9）
 * - 内置计时循环（基于 effect + reducer 派生）
 * - 完成时通知 + 落库（落库由 hook 调用方传入，因为落库需要 boundReq）
 * - todayMinutes 加载与定时刷新
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import dayjs from 'dayjs';
import {
  initialPomodoroState,
  pomodoroReducer,
  type PomodoroAction,
  type PomodoroState,
} from './types';

export interface UsePomodoroOptions {
  /** settings.pomodoro_work 分钟数 */
  workMin: number;
  /** settings.pomodoro_break 分钟数 */
  breakMin: number;
  /** 计时器精度（毫秒），默认 1000 */
  tickMs?: number;
  /** 阶段完成时通知回调（已落库 + 弹通知） */
  onWorkFinish?: (info: { minutes: number }) => void;
  onBreakFinish?: () => void;
}

export interface UsePomodoroReturn {
  state: PomodoroState;
  dispatch: (action: PomodoroAction) => void;
  /** 当前 derived minutes 数（绑定 requirement 的查表需要外部传入） */
  minutesSinceStart: () => number;
  /** 启动工作（外部调用） */
  start: () => void;
  /** 完成当前阶段（外部调用，interval 闭包用） */
  finishCurrent: () => void;
}

export function usePomodoro(opts: UsePomodoroOptions): UsePomodoroReturn {
  const { workMin, breakMin, tickMs = 1000, onWorkFinish, onBreakFinish } = opts;

  const [state, dispatch] = useReducer(pomodoroReducer, workMin, initialPomodoroState);

  // 计时：仅 work / break 阶段 + 未暂停时启动
  const startedAtRef = useRef(0);
  const finishedThisTickRef = useRef(false);

  useEffect(() => {
    if (state.phase === 'idle' || state.paused) {
      finishedThisTickRef.current = false;
      return;
    }
    const t = window.setInterval(() => {
      if (state.remaining <= 1) {
        if (!finishedThisTickRef.current) {
          finishedThisTickRef.current = true;
          // 同步 dispatch finish（避免在 reducer 外 state 不一致）
          if (state.phase === 'work') {
            const minutes = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
            dispatch({ type: 'finishWork', workMin, breakMin, minutes });
            try { onWorkFinish?.({ minutes }); } catch { /* ignore */ }
          } else if (state.phase === 'break') {
            dispatch({ type: 'finishBreak', workMin });
            try { onBreakFinish?.(); } catch { /* ignore */ }
          }
        }
        return;
      }
      dispatch({ type: 'tick' });
    }, tickMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.paused, state.remaining <= 0, workMin, breakMin]);

  // flash 自动关闭：4s
  useEffect(() => {
    if (!state.flash) return;
    const t = window.setTimeout(() => dispatch({ type: 'flashOff' }), 4000);
    return () => clearTimeout(t);
  }, [state.flash]);

  // todayMinutes 加载（open 时）
  const refreshToday = useRef<() => Promise<void>>(async () => {});
  refreshToday.current = async () => {
    try {
      const dayStart = dayjs().startOf('day').valueOf();
      const stats = await window.taskAPI.db.pomodoro.stats(dayStart, Date.now());
      const m = stats.byDay.find((d: { day: string; minutes: number }) => d.day === dayjs().format('YYYY-MM-DD'));
      dispatch({ type: 'setTodayMinutes', minutes: m?.minutes ?? 0 });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!state.open) return;
    refreshToday.current();
    const t = window.setInterval(() => refreshToday.current(), 30_000);
    return () => clearInterval(t);
  }, [state.open]);

  // phase 切换后立即刷新一次
  useEffect(() => {
    if (state.open) refreshToday.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Esc 关闭面板
  useEffect(() => {
    if (!state.open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch({ type: 'close' }); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [state.open]);

  const start = useCallback(() => {
    startedAtRef.current = Date.now();
    dispatch({ type: 'startWork', workMin, breakMin });
  }, [workMin, breakMin]);

  const minutesSinceStart = useCallback(() => {
    if (!startedAtRef.current) return 0;
    return Math.max(1, Math.round((Date.now() - startedAtRef.current) / 60000));
  }, []);

  // finishCurrent 暴露给 interval 闭包用（同 dispatch，但保留 API 对外语义）
  const finishCurrent = useCallback(() => {
    if (state.phase === 'work') {
      const minutes = minutesSinceStart();
      dispatch({ type: 'finishWork', workMin, breakMin, minutes });
      try { onWorkFinish?.({ minutes }); } catch { /* ignore */ }
    } else if (state.phase === 'break') {
      dispatch({ type: 'finishBreak', workMin });
      try { onBreakFinish?.(); } catch { /* ignore */ }
    }
  }, [state.phase, workMin, breakMin, minutesSinceStart, onWorkFinish, onBreakFinish]);

  return { state, dispatch, minutesSinceStart, start, finishCurrent };
}