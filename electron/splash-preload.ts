/**
 * v1.1.6：splash 启动画面的专用 preload。
 * 主进程把真实启动里程碑（db ready / 窗口创建 / 渲染层就绪）推给 splash 页面，
 * 页面据此更新进度条与文案——动画不再是假定时器。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splashAPI', {
  /** 订阅主进程的进度事件；data = { pct: 0-100, text: 阶段文案 } */
  onProgress: (cb: (data: { pct: number; text: string }) => void) => {
    ipcRenderer.on('splash:progress', (_e, data: { pct: number; text: string }) => cb(data));
  },
});
