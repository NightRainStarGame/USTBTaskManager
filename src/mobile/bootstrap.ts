/**
 * 移动端（Capacitor / Android）启动引导。
 *
 * 时序（必须在 React mount 之前完成）：
 *  1. initSqlJsRuntime()  —— 加载 WASM SQLite
 *  2. hydrateMemFsFromIdb() —— IndexedDB 快照灌回内存 FS（同步可见）
 *  3. initDatabase()      —— 建库/迁移/种子（electron/db 原逻辑，零改动）
 *  4. registerAllIpc(db)  —— 全部 IPC handler 注册进 shim 的 Map
 *  5. window.taskAPI = buildAPI(...) —— 渲染层 API（与桌面 preload 同一工厂）
 *  6. 补注册 window:* / 兜底 channel（桌面在 main.ts 里注册的部分）
 *  7. 动态 import('../main') —— 渲染层应用启动
 */
import './process-shim'; // 必须最先执行：装 process 全局
import { initSqlJsRuntime, hydrateMemFsFromIdb, flushNow } from './sqlite3-adapter';
import { initDatabase, getDb } from '../../electron/db/index';
import { registerAllIpc } from '../../electron/ipc/index';
import { buildAPI } from '../../electron/api-factory';
import { ipcMain, ipcRenderer } from './electron-shim';

async function boot() {
  // 版本号（vite.mobile.config.ts 的 define 注入）
  (globalThis as any).__TASKMANAGER_VERSION__ = __TASKMANAGER_VERSION__;

  await initSqlJsRuntime();
  const restored = await hydrateMemFsFromIdb();

  const db = initDatabase();
  registerAllIpc(db);

  // 桌面 main.ts 里注册的窗口控制（移动端语义：close=无操作，maximize=无操作）
  ipcMain.handle('window:minimize', () => undefined);
  ipcMain.handle('window:maximize', () => false);
  ipcMain.handle('window:close', () => undefined);
  ipcMain.handle('window:isMaximized', () => false);

  const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);
  const send = (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args);
  const subscribe = (channel: string, cb: (payload: any) => void) => {
    const handler = (_e: unknown, payload: any) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.off(channel, handler); };
  };

  (window as any).taskAPI = buildAPI(invoke, send, subscribe);
  (window as any).__MOBILE__ = true;
  console.info(`[mobile] 主进程逻辑已就绪（数据库快照${restored > 0 ? '已恢复' : '为空，全新启动'}）version=${__TASKMANAGER_VERSION__}`);

  // webview 可能随时被系统回收：切后台/关闭前把脏数据落盘
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });

  // 渲染层启动（main.tsx 检测到 window.taskAPI 已存在，不会注入浏览器 Mock）
  await import('../main');
}

boot().catch((err) => {
  console.error('[mobile] 启动失败:', err);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding:32px;font-family:monospace;color:#ff6b6b;background:#0a0a0a;min-height:100vh">
        <h2 style="color:#fff">启动失败</h2>
        <pre style="white-space:pre-wrap;font-size:12px">${String(err?.stack || err)}</pre>
      </div>`;
  }
});
