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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
