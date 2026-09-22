/**
 * v1.2.8 块 P：番茄钟 mm:ss 数字 + 滚轮调整 + 数字 bounce
 * - 仅 idle 阶段可调（work / break 中锁定，避免误改）
 * - 悬浮 mm / ss 时：
 *   - cursor: ns-resize
 *   - 数字 cursor-pointer
 *   - 出现 ↑/↓ 浮标提示「±1 分 / ±5 秒」
 * - 滚轮 / ↑↓ 键 / 双击：调整对应单位
 * - 调整后立即同步 settings.pomodoro_work / pomodoro_break 持久化
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from '../../utils/clsx';
import {
  SS_OFFSETS, WORK_MIN_MAX, WORK_MIN_MIN, WHEEL_STEP_MIN, WHEEL_STEP_SEC,
} from './types';

interface TimeDigitsProps {
  /** 当前分钟数（受控） */
  minutes: number;
  /** 当前秒数偏移（受控；0/5/10.../55） */
  secondsOffset: number;
  /** 仅 idle 时允许调整 */
  locked: boolean;
  /** 调整后回调（持久化到 settings） */
  onChange: (next: { minutes: number; secondsOffset: number }) => void;
  /** 当前显示的 mm */
  mm: string;
  /** 当前显示的 ss */
  ss: string;
  /** 数字颜色类（来自 phase） */
  colorClass: string;
}

export function TimeDigits({ minutes, secondsOffset, locked, onChange, mm, ss, colorClass }: TimeDigitsProps) {
  const [hoverUnit, setHoverUnit] = useState<'mm' | 'ss' | null>(null);
  /** 用于触发 bounce 动画的递增 key（每次调整 +1） */
  const [bounceKey, setBounceKey] = useState({ mm: 0, ss: 0 });
  /** 用于显示 ↑/↓ 浮标的最近一次调整反馈 */
  const [feedback, setFeedback] = useState<{ unit: 'mm' | 'ss'; delta: number } | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
  }, []);

  const bump = useCallback((unit: 'mm' | 'ss', delta: number) => {
    if (locked) return;
    if (unit === 'mm') {
      const next = Math.min(WORK_MIN_MAX, Math.max(WORK_MIN_MIN, minutes + delta));
      if (next === minutes) return;
      setBounceKey(k => ({ ...k, mm: k.mm + 1 }));
      onChange({ minutes: next, secondsOffset });
    } else {
      const idx = SS_OFFSETS.indexOf(secondsOffset);
      const nextIdx = idx + (delta > 0 ? 1 : -1);
      if (nextIdx < 0 || nextIdx >= SS_OFFSETS.length) return;
      const next = SS_OFFSETS[nextIdx];
      setBounceKey(k => ({ ...k, ss: k.ss + 1 }));
      onChange({ minutes, secondsOffset: next });
    }
    setFeedback({ unit, delta });
    if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 900);
  }, [locked, minutes, secondsOffset, onChange]);

  const onWheel = useCallback((e: React.WheelEvent, unit: 'mm' | 'ss') => {
    if (locked) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -1 : 1;
    bump(unit, unit === 'mm' ? delta * WHEEL_STEP_MIN : delta * WHEEL_STEP_SEC / 5);
    // ss 步长是 5，调一次是 5 秒
  }, [locked, bump]);

  const onKey = useCallback((e: React.KeyboardEvent, unit: 'mm' | 'ss') => {
    if (locked) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      bump(unit, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      bump(unit, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (unit === 'mm') onChange({ minutes: WORK_MIN_MIN, secondsOffset });
      else onChange({ minutes, secondsOffset: 0 });
      setBounceKey(k => ({ ...k, [unit]: k[unit] + 1 }));
    } else if (e.key === 'End') {
      e.preventDefault();
      if (unit === 'mm') onChange({ minutes: WORK_MIN_MAX, secondsOffset });
      else onChange({ minutes, secondsOffset: SS_OFFSETS[SS_OFFSETS.length - 1] });
      setBounceKey(k => ({ ...k, [unit]: k[unit] + 1 }));
    }
  }, [locked, bump, onChange, minutes, secondsOffset]);

  const digitCls = (unit: 'mm' | 'ss', key: number) => clsx(
    'inline-block px-1 rounded transition-colors',
    colorClass,
    hoverUnit === unit && !locked && 'bg-neon-green/15',
    !locked && 'cursor-ns-resize hover:bg-neon-green/10',
    key > 0 && 'animate-digit-bounce',
  );

  return (
    <span
      className="relative inline-flex items-baseline tabular-nums select-none"
      onMouseLeave={() => setHoverUnit(null)}
    >
      <span
        key={`mm-${bounceKey.mm}`}
        className={digitCls('mm', bounceKey.mm)}
        onMouseEnter={() => !locked && setHoverUnit('mm')}
        onWheel={(e) => onWheel(e, 'mm')}
        onKeyDown={(e) => onKey(e, 'mm')}
        tabIndex={locked ? -1 : 0}
        role={locked ? undefined : 'spinbutton'}
        aria-label="专注分钟数（可滚轮调整）"
        aria-valuenow={minutes}
        aria-valuemin={WORK_MIN_MIN}
        aria-valuemax={WORK_MIN_MAX}
        title={locked ? '运行中不可调整' : '滚轮/↑↓ 调整分钟（1~120）'}
      >
        {mm}
      </span>
      <span className={clsx(colorClass, 'mx-0')}>:</span>
      <span
        key={`ss-${bounceKey.ss}`}
        className={digitCls('ss', bounceKey.ss)}
        onMouseEnter={() => !locked && setHoverUnit('ss')}
        onWheel={(e) => onWheel(e, 'ss')}
        onKeyDown={(e) => onKey(e, 'ss')}
        tabIndex={locked ? -1 : 0}
        role={locked ? undefined : 'spinbutton'}
        aria-label="秒数偏移（可滚轮调整，步长 5 秒）"
        aria-valuenow={secondsOffset}
        aria-valuemin={0}
        aria-valuemax={55}
        title={locked ? '运行中不可调整' : '滚轮/↑↓ 调整秒数（0~55，步长 5）'}
      >
        {ss}
      </span>
      {/* ↑/↓ 浮标 */}
      {!locked && feedback && (
        <span
          className={clsx(
            'absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-mono pointer-events-none',
            'animate-toast-in whitespace-nowrap',
            feedback.delta > 0 ? 'text-neon-green' : 'text-red-300',
          )}
        >
          {feedback.delta > 0 ? '⌃' : '⌄'} {feedback.unit === 'mm'
            ? `${feedback.delta > 0 ? '+' : ''}${feedback.delta} 分`
            : `${feedback.delta > 0 ? '+' : ''}${feedback.delta * 5} 秒`}
        </span>
      )}
    </span>
  );
}