/**
 * 全局 Toast 系统（v1.2.8 块 N 配套）：
 * - API：toast.success / error / warn / info / exception
 * - 后端：zustand 单例 store（避免引入新依赖）
 * - 渲染：ToastContainer 组件 createPortal 到 body，App.tsx 挂载一次
 * - 自动消失 + 手动关闭 + 4 种类型 + 异常对象转换
 *
 * 用法：
 *   import { toast } from '@/utils/toast';
 *   try { ... } catch (e) { toast.exception(e, '保存失败'); }
 */
import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'warn' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** 毫秒；<=0 表示不自动消失（用户手动关闭） */
  duration: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (kind: ToastKind, message: string, duration?: number) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (kind, message, duration) => {
    counter += 1;
    const id = counter;
    const dur = duration ?? (kind === 'error' ? 6000 : kind === 'warn' ? 5000 : 3500);
    set((s) => ({ items: [...s.items, { id, kind, message, duration: dur }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
}));

/** 非 hook 入口（业务代码里直接 toast.error('xxx')） */
const _push = (k: ToastKind, m: string, d?: number) => useToastStore.getState().push(k, m, d);

export const toast = {
  success: (m: string, d?: number) => _push('success', m, d),
  error: (m: string, d?: number) => _push('error', m, d),
  warn: (m: string, d?: number) => _push('warn', m, d),
  info: (m: string, d?: number) => _push('info', m, d),
  /** 把 unknown 异常转成 error toast；带可选前缀 */
  exception: (e: unknown, prefix = '') => {
    const msg = e instanceof Error ? (e.message || String(e)) : String(e);
    _push('error', prefix ? `${prefix}：${msg}` : msg, 8000);
  },
  /** 静默吞掉异常的快捷方式（替代 catch 块省略号），仍会记一行 warn 日志便于排查 */
  silent: (e: unknown, fallbackMsg = '') => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[silent]', fallbackMsg, e);
    }
  },
};