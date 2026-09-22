/**
 * v1.2.8 块 P：通用拖动 hook
 * - 适用于任何「屏幕绝对定位 + 可拖动」的浮窗（Pomodoro FAB / PatchPanel / PlusMenu 等）
 * - 自动边界 clamp（不超出屏幕）
 * - 3px 阈值防误触点击
 * - 位置自动持久化到 localStorage
 * - 双击回调（用于"重置位置"等快捷动作）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAG_THRESHOLD_PX, FAB_EDGE_MARGIN, FAB_SIZE_PX } from './types';

export interface UseDragPositionOptions {
  storageKey: string;
  defaultPos: { x: number; y: number };
  /** 拖动元素尺寸（用于边界计算） */
  size?: number;
  /** 屏幕四边最小间距 */
  margin?: number;
}

export function useDragPosition(opts: UseDragPositionOptions) {
  const { storageKey, defaultPos, size = FAB_SIZE_PX, margin = FAB_EDGE_MARGIN } = opts;

  const loadPos = useCallback((): { x: number; y: number } => {
    if (typeof window === 'undefined') return defaultPos;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
      }
    } catch { /* ignore */ }
    return defaultPos;
  }, [storageKey, defaultPos]);

  const [pos, setPos] = useState(loadPos);
  const posRef = useRef(pos);
  posRef.current = pos;

  const [dragging, setDragging] = useState(false);
  const didDragRef = useRef(false);
  const dragStartRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  /** 边界 clamp：pos 是 bottom-right 锚点偏移，所以右/下需 ≤ innerWidth - size - margin*2 */
  const clamp = useCallback((next: { x: number; y: number }): { x: number; y: number } => {
    if (typeof window === 'undefined') return next;
    const limX = Math.max(0, window.innerWidth - size - margin * 2);
    const limY = Math.max(0, window.innerHeight - size - margin * 2);
    return {
      x: Math.min(limX, Math.max(-limX, next.x)),
      y: Math.min(limY, Math.max(-limY, next.y)),
    };
  }, [size, margin]);

  // 绑定拖动监听
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      if (!didDragRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) didDragRef.current = true;
      const next = clamp({
        x: dragStartRef.current.origX + dx,
        y: dragStartRef.current.origY + dy,
      });
      posRef.current = next;
      setPos(next);
    };
    const onUp = () => {
      setDragging(false);
      try { localStorage.setItem(storageKey, JSON.stringify(posRef.current)); } catch { /* ignore */ }
      dragStartRef.current = null;
      // 下一帧再清 didDragRef，让 onClick 不会误触发
      setTimeout(() => { didDragRef.current = false; }, 0);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, clamp, storageKey]);

  /** 开始拖动（绑定到 onMouseDown） */
  const startDrag = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    didDragRef.current = false;
    dragStartRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setDragging(true);
  }, [pos.x, pos.y]);

  /** 双击触发（例如：重置位置） */
  const reset = useCallback(() => {
    setPos(defaultPos);
    posRef.current = defaultPos;
    try { localStorage.setItem(storageKey, JSON.stringify(defaultPos)); } catch { /* ignore */ }
  }, [defaultPos, storageKey]);

  return { pos, dragging, didDragRef, startDrag, reset, clamp };
}