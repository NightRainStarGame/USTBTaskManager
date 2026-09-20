/**
 * v1.1.6 输入诊断 — App 挂载钩子（块 3）
 *
 * 在 App 顶层 useEffect 调一次 installInputDiag。设置页用 diag.peek 拿到最近
 * 几次失灵快照、diag.export 让用户把日志带走反馈。
 */
import { useEffect, useRef } from 'react';
import { installInputDiag, type InputDiagHandle } from '../diag/inputDiag';
import { installInputRepair } from '../diag/inputRepair';

export interface UseInputDiagApi {
  peek: () => Promise<{ ok: boolean; path: string; byteCount: number; recent: any[]; error?: string }>;
  export: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; byteCount?: number; error?: string }>;
}

declare global {
  interface Window {
    __inputDiagHandle?: InputDiagHandle;
  }
}

export function useInputDiag() {
  const handleRef = useRef<InputDiagHandle | null>(null);

  useEffect(() => {
    if (handleRef.current) return;
    handleRef.current = installInputDiag({ ignoreInside: '[data-input-diag-host]' });
    window.__inputDiagHandle = handleRef.current;
    // v1.1.7：点击补焦兜底（输入框偶发点不上的修复）
    const stopRepair = installInputRepair();
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
      delete window.__inputDiagHandle;
      stopRepair();
    };
  }, []);
}

/** 测试/调试用：手动触发一次快照落盘（不用等到 8 秒） */
export function triggerInputDiagNow(): void {
  window.__inputDiagHandle?.flush();
}
