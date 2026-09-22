/**
 * v1.2.8 块 P：番茄钟容器组件
 * - 编排 FAB + Panel
 * - 状态机走 usePomodoro (reducer)
 * - 拖动走 useDragPosition
 * - 落库 + 通知走 onWorkFinish 回调
 * - mm/ss 取自 state.remaining；rollover 时通过设置触发动画
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import clsx from '../../utils/clsx';
import { useStore } from '@/store';
import type { Requirement } from '@/types';
import {
  DEFAULT_POS, DEFAULT_WORK_MIN, DEFAULT_BREAK_MIN, POS_STORAGE_KEY,
} from './types';
import { useDragPosition } from './useDragPosition';
import { usePomodoro } from './usePomodoro';
import { PomodoroFab } from './PomodoroFab';
import { PomodoroPanel } from './PomodoroPanel';
import { toast } from '../../utils/toast';

const SS_STORAGE_KEY = 'pomodoro_widget_secs';

function loadSecondsOffset(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const v = Number(localStorage.getItem(SS_STORAGE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

export default function PomodoroWidget() {
  const requirements = useStore((s) => s.requirements);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const workMinBase = Number(settings.pomodoro_work) || DEFAULT_WORK_MIN;
  const breakMinBase = Number(settings.pomodoro_break) || DEFAULT_BREAK_MIN;

  // 秒偏移本地 ref（避免每滚一下都更新全局 store）
  const secondsOffsetRef = useRef<number>(loadSecondsOffset());
  const workMinRef = useRef<number>(workMinBase);
  workMinRef.current = workMinBase;
  const breakMinRef = useRef<number>(breakMinBase);
  breakMinRef.current = breakMinBase;

  const boundReq = useMemo<Requirement | null>(() => {
    if (!requirements.length) return null;
    return requirements.find((r) => r.status !== 'done') || null;
  }, [requirements]);

  /** 落库 + 通知 callback */
  const onWorkFinish = useCallback(({ minutes }: { minutes: number }) => {
    const req = boundReq;
    try {
      window.taskAPI.db.pomodoro.create({
        course_id: req?.course_id ?? null,
        ref_type: req ? 'requirement' : null,
        ref_id: req?.id ?? null,
        label: req ? `${req.course_name || ''} · ${req.title}` : '自由专注',
        started_at: Date.now() - minutes * 60000,
        ended_at: Date.now(),
        minutes,
        mode: 'work',
      }).catch(() => { /* 落库失败不阻断流程 */ });
    } catch { /* ignore */ }
    try {
      new Notification('[StarOS] 番茄钟完成 🍅', {
        body: `专注 ${minutes} 分钟${req ? ` · ${req.title}` : ''}，休息一下吧`,
      });
    } catch { /* ignore */ }
  }, [boundReq]);

  const onBreakFinish = useCallback(() => {
    try {
      new Notification('[StarOS] 休息结束', {
        body: '回到专注，开始下一个番茄！',
      });
    } catch { /* ignore */ }
  }, []);

  const { state, dispatch } = usePomodoro({
    workMin: workMinRef.current,
    breakMin: breakMinRef.current,
    onWorkFinish,
    onBreakFinish,
  });

  // 拖动（FAB）
  const drag = useDragPosition({
    storageKey: POS_STORAGE_KEY,
    defaultPos: DEFAULT_POS,
  });

  const pendingReqs = useMemo<Requirement[]>(
    () => requirements.filter((r) => r.status !== 'done').slice(0, 30),
    [requirements],
  );

  // workMin 改变时立即写 settings + 重置 idle 显示
  const onWorkMinChange = useCallback((next: number) => {
    workMinRef.current = next;
    try {
      void window.taskAPI.db.settings.set?.('pomodoro_work', String(next));
    } catch { /* ignore */ }
    setSettings({ ...settings, pomodoro_work: String(next) });
    if (state.phase === 'idle') {
      dispatch({ type: 'reset', workMin: next });
    }
  }, [settings, setSettings, state.phase, dispatch]);

  // secondsOffset 是「时长预览偏移」，仅影响显示和下次启动后的 initial remaining 公式
  const onSecondsOffsetChange = useCallback((next: number) => {
    secondsOffsetRef.current = next;
    try { localStorage.setItem(SS_STORAGE_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const handleFabClick = useCallback(() => {
    if (drag.didDragRef.current) return;
    dispatch({ type: 'toggle' });
  }, [dispatch, drag.didDragRef]);

  const handleFabDoubleClick = useCallback(() => {
    drag.reset();
    toast.info('浮动按钮位置已重置', 2000);
  }, [drag]);

  const onReset = useCallback(() => {
    dispatch({ type: 'reset', workMin: workMinRef.current });
  }, [dispatch]);

  const mm = String(Math.floor(state.remaining / 60)).padStart(2, '0');
  const ss = String(state.remaining % 60).padStart(2, '0');
  const ssTotal = workMinRef.current * 60 + secondsOffsetRef.current;

  // 首次启动计时（提供 UI 反馈）
  useEffect(() => {
    if (state.phase === 'work' && state.remaining === workMinRef.current * 60) {
      // no-op，只为初始化提示
    }
  }, [state.phase, state.remaining]);

  return (
    <div
      style={{ transform: `translate(${drag.pos.x}px, ${drag.pos.y}px)` }}
      className={clsx(
        'fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3 ease-spring',
        drag.dragging && 'cursor-grabbing select-none',
      )}
    >
      {state.open && (
        <PomodoroPanel
          state={state}
          dispatch={dispatch}
          workMin={workMinRef.current}
          breakMin={breakMinRef.current}
          secondsOffset={secondsOffsetRef.current}
          ssTotal={ssTotal}
          onSecondsOffsetChange={onSecondsOffsetChange}
          onWorkMinChange={onWorkMinChange}
          pendingReqs={pendingReqs}
          onReset={onReset}
        />
      )}
      <PomodoroFab
        pos={drag.pos}
        dragging={drag.dragging}
        didDragRef={drag.didDragRef}
        startDrag={drag.startDrag}
        onClick={handleFabClick}
        onDoubleClick={handleFabDoubleClick}
        phase={state.phase}
        paused={state.paused}
        mm={mm}
        ss={ss}
        open={state.open}
        flash={state.flash}
      />
    </div>
  );
}