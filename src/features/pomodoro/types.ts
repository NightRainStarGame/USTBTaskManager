/**
 * v1.2.8 块 P：Pomodoro 模块化 — 类型 + 常量集中
 * - 所有 magic number / storage key / size 常量在此处统一
 * - Phase / PomodoroState / Action 集中在 reducer + 组件之间共享
 */

export type Phase = 'idle' | 'work' | 'break';

/** 番茄钟工作阶段默认时长（分钟） */
export const DEFAULT_WORK_MIN = 25;
/** 番茄钟休息阶段默认时长（分钟） */
export const DEFAULT_BREAK_MIN = 5;
/** 滚轮调整 workMin 时 ±1 分钟；调整 ss 时 ±5 秒 */
export const WHEEL_STEP_MIN = 1;
export const WHEEL_STEP_SEC = 5;
/** workMin 取值范围 */
export const WORK_MIN_MIN = 1;
export const WORK_MIN_MAX = 120;
/** ss 部分（起步秒数偏移）允许的取值集合：[0, 5, 10, ..., 55] */
export const SS_OFFSETS: readonly number[] = Array.from({ length: 12 }, (_, i) => i * 5);

/** FAB 在屏幕上的偏移锚点（bottom-6 right-6 = 24px） */
export const FAB_ANCHOR_PX = 24;
/** FAB 按钮直径 48px */
export const FAB_SIZE_PX = 48;
/** FAB 拖动时距屏幕边缘最小间距 */
export const FAB_EDGE_MARGIN = 8;
/** FAB 拖动阈值（避免误判点击） */
export const DRAG_THRESHOLD_PX = 3;

/** FAB 位置持久化键 */
export const POS_STORAGE_KEY = 'pomodoro_widget_pos';

/** FAB 默认位置（锚点偏移） */
export const DEFAULT_POS: { x: number; y: number } = { x: 0, y: 0 };

/** 状态机 */
export interface PomodoroState {
  open: boolean;
  phase: Phase;
  /** 当前阶段总时长（秒） */
  totalSecs: number;
  /** 剩余时长（秒） */
  remaining: number;
  paused: boolean;
  /** 绑定的 requirement id（可选） */
  refReqId: number | null;
  /** 今日专注分钟数（DB 统计缓存） */
  todayMinutes: number;
  /** 完成瞬间的视觉高亮（4s 渐隐） */
  flash: boolean;
}

export type PomodoroAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'startWork'; workMin: number; breakMin: number }
  | { type: 'finishWork'; workMin: number; breakMin: number; minutes: number }
  | { type: 'finishBreak'; workMin: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset'; workMin: number }
  | { type: 'tick' }
  | { type: 'setRefReq'; refReqId: number | null }
  | { type: 'setTodayMinutes'; minutes: number }
  | { type: 'flash' }
  | { type: 'flashOff' };

export const initialPomodoroState = (workMin: number): PomodoroState => ({
  open: false,
  phase: 'idle',
  totalSecs: workMin * 60,
  remaining: workMin * 60,
  paused: false,
  refReqId: null,
  todayMinutes: 0,
  flash: false,
});

/** 红ucer：纯函数，便于测试与时间旅行 */
export function pomodoroReducer(state: PomodoroState, action: PomodoroAction): PomodoroState {
  switch (action.type) {
    case 'open': return { ...state, open: true };
    case 'close': return { ...state, open: false };
    case 'toggle': return { ...state, open: !state.open };
    case 'startWork': {
      const total = action.workMin * 60;
      return { ...state, phase: 'work', paused: false, totalSecs: total, remaining: total, flash: false };
    }
    case 'finishWork': {
      const total = action.breakMin * 60;
      return { ...state, phase: 'break', paused: false, totalSecs: total, remaining: total, todayMinutes: state.todayMinutes + action.minutes, flash: true };
    }
    case 'finishBreak':
      return { ...state, phase: 'idle', remaining: action.workMin * 60, totalSecs: action.workMin * 60, paused: false };
    case 'pause': return { ...state, paused: true };
    case 'resume': return { ...state, paused: false };
    case 'reset':
      return { ...state, phase: 'idle', remaining: action.workMin * 60, totalSecs: action.workMin * 60, paused: false, flash: false };
    case 'tick': return { ...state, remaining: Math.max(0, state.remaining - 1) };
    case 'setRefReq': return { ...state, refReqId: action.refReqId };
    case 'setTodayMinutes': return { ...state, todayMinutes: action.minutes };
    case 'flash': return { ...state, flash: true };
    case 'flashOff': return { ...state, flash: false };
    default: return state;
  }
}