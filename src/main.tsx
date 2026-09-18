import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/index.css';
import { createBrowserApi } from './mocks/browserApi';

// 浏览器预览模式：无 Electron preload 桥时注入内存 Mock（演示数据）
if (!(window as any).taskAPI) {
  (window as any).taskAPI = createBrowserApi();
  console.info('[TaskManager] 浏览器预览模式：使用内存演示数据');
}

// IPC / 异步错误兜底：只记录，不白屏（页面各自决定如何提示）
window.addEventListener('unhandledrejection', (e) => {
  console.warn('[TaskManager] 未处理的异步错误:', e.reason);
});

// v1.1.5：splash 兜底——如果 App 在 3 秒内未调用 ready()，强制通知主进程关 splash
// 避免渲染层 JS 抛错时 splash 一直转（主进程另有 5s 兜底）
setTimeout(() => {
  try { (window.taskAPI as any).app?.ready?.(); } catch { /* ignore */ }
}, 3000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
