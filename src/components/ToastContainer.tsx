/**
 * 全局 Toast 渲染容器（v1.2.8 块 N）。
 * - 在 App.tsx 挂载一次，createPortal 到 body
 * - 订阅 useToastStore，自动渲染 + 自动消失 + 手动关闭
 * - 入场动画用 CSS（animate-fade-in / animate-slide-in-right），无需 framer-motion
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import clsx from '../utils/clsx';
import { useToastStore, type ToastItem, type ToastKind } from '../utils/toast';

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastKind, string> = {
  success: 'border-neon-green/40 text-neon-green',
  error: 'border-red-400/50 text-red-300',
  warn: 'border-yellow-400/50 text-yellow-200',
  info: 'border-cyan-400/50 text-cyan-200',
};

const ICON_BG: Record<ToastKind, string> = {
  success: 'text-neon-green',
  error: 'text-red-400',
  warn: 'text-yellow-300',
  info: 'text-cyan-300',
};

export function ToastContainer() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  // 每个 item 单独计时器：避免 items 数组变化时清掉所有计时器
  useEffect(() => {
    if (items.length === 0) return;
    const timers: number[] = [];
    for (const it of items) {
      if (it.duration <= 0) continue;
      const tid = window.setTimeout(() => dismiss(it.id), it.duration);
      timers.push(tid);
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
      role="region"
      aria-label="通知"
    >
      {items.map((it: ToastItem) => {
        const Icon = ICONS[it.kind];
        return (
          <div
            key={it.id}
            role="alert"
            className={clsx(
              'glass-panel pointer-events-auto pl-3 pr-2 py-2 rounded-lg flex items-start gap-2 shadow-lg',
              'border bg-ink-900/80 backdrop-blur-md',
              'animate-toast-in transition-all',
              STYLES[it.kind]
            )}
          >
            <Icon size={14} className={clsx('shrink-0 mt-0.5', ICON_BG[it.kind])} />
            <div className="flex-1 text-xs leading-relaxed break-words text-text-primary font-sans">
              {it.message}
            </div>
            <button
              onClick={() => dismiss(it.id)}
              className="text-text-dim hover:text-text-primary shrink-0 p-0.5 -mt-0.5 -mr-0.5 rounded transition-colors"
              aria-label="关闭通知"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}