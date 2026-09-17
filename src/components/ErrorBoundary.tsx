import React from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props { children: React.ReactNode }
interface State { error: Error | null }

/**
 * 全局错误边界：任何组件渲染期异常不再导致整页白屏，
 * 而是显示可操作的恢复界面（重载 / 回首页）。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[TaskManager] 渲染崩溃已被 ErrorBoundary 捕获:', error, info.componentStack);
    try {
      const key = 'tm_crash_log';
      const prev = JSON.parse(localStorage.getItem(key) || '[]');
      prev.push({ at: Date.now(), message: error.message, stack: error.stack?.slice(0, 2000) });
      localStorage.setItem(key, JSON.stringify(prev.slice(-10))); // 只留最近 10 条
    } catch { /* ignore */ }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-ink-base flex items-center justify-center p-8">
        <div className="max-w-xl w-full border border-neon-green/30 bg-ink-card rounded-lg p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full border border-red-500/40 bg-red-500/10 flex items-center justify-center mb-4">
            <AlertTriangle size={26} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-red-400 mb-2">界面渲染出现异常</h1>
          <p className="text-sm text-text-dim mb-1">页面组件崩溃了，但你的数据是安全的（存储在本地数据库中）。</p>
          <p className="text-xs text-text-dim/60 font-mono mb-6 break-all">{this.state.error.message}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="btn-neon inline-flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> 重新加载
            </button>
            <button
              onClick={() => { window.location.hash = '#/'; window.location.reload(); }}
              className="btn-neon btn-neon-yellow inline-flex items-center gap-1.5"
            >
              <Home size={14} /> 回到首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
