import { contextBridge, ipcRenderer } from 'electron';
import { buildAPI } from './api-factory';

// 桌面端：IPC 桥到主进程
const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);
const send = (channel: string, ...args: any[]) => { ipcRenderer.send(channel, ...args); };
const subscribe = (channel: string, cb: (payload: any) => void) => {
  const handler = (_e: unknown, payload: any) => cb(payload);
  ipcRenderer.on(channel, handler as any);
  return () => { ipcRenderer.off(channel, handler as any); };
};

const api = buildAPI(invoke, send, subscribe);

contextBridge.exposeInMainWorld('taskAPI', api);

export type TaskAPI = typeof api;
