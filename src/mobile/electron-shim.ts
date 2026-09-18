/**
 * electron 模块 shim —— 移动端 webview 里跑「主进程逻辑」的胶水。
 *
 * 原理：桌面端 preload 用 ipcRenderer.invoke 把调用发给主进程；
 * 移动端主进程逻辑与渲染层同处一个 JS 上下文，ipcMain.handle 注册的
 * handler 存进 Map，ipcRenderer.invoke 直接同步查表调用（结果包 Promise）。
 * BrowserWindow.webContents.send → 事件总线 → ipcRenderer.on 回调，
 * 更新进度/更新可用推送照常工作。
 */

type Handler = (event: unknown, ...args: any[]) => any;

const invokeHandlers = new Map<string, Handler>();
const onHandlers = new Map<string, Handler[]>();

/** 渲染层事件总线（webContents.send 的落地处） */
const rendererBus = new Map<string, Set<(payload: any) => void>>();

function busEmit(channel: string, payload: any) {
  const set = rendererBus.get(channel);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { console.warn('[mobile] renderer 事件回调出错:', e); }
  }
}

export const ipcMain = {
  handle(channel: string, handler: Handler) {
    invokeHandlers.set(channel, handler);
  },
  handleOnce(channel: string, handler: Handler) {
    invokeHandlers.set(channel, (e, ...args) => {
      invokeHandlers.delete(channel);
      return handler(e, ...args);
    });
  },
  on(channel: string, handler: Handler) {
    const list = onHandlers.get(channel) ?? [];
    list.push(handler);
    onHandlers.set(channel, list);
  },
  once(channel: string, handler: Handler) {
    const wrap: Handler = (e, ...args) => {
      const list = onHandlers.get(channel) ?? [];
      onHandlers.set(channel, list.filter((h) => h !== wrap));
      return handler(e, ...args);
    };
    const list = onHandlers.get(channel) ?? [];
    list.push(wrap);
    onHandlers.set(channel, list);
  },
  removeHandler(channel: string) { invokeHandlers.delete(channel); },
  removeAllListeners(channel?: string) {
    if (channel) onHandlers.delete(channel);
    else onHandlers.clear();
  },
};

function dispatch(channel: string, ...args: any[]): any {
  const h = invokeHandlers.get(channel);
  if (!h) throw new Error(`[mobile] 没有注册的 IPC channel: ${channel}`);
  return h({ sender: null }, ...args);
}

export const ipcRenderer = {
  invoke(channel: string, ...args: any[]): Promise<any> {
    return Promise.resolve().then(() => dispatch(channel, ...args));
  },
  send(channel: string, ...args: any[]) {
    const list = onHandlers.get(channel) ?? [];
    for (const h of list) h({ sender: null }, ...args);
  },
  on(channel: string, listener: (event: unknown, payload: any) => void) {
    const set = rendererBus.get(channel) ?? new Set();
    const wrapped = (payload: any) => listener({}, payload);
    (wrapped as any).__orig = listener;
    set.add(wrapped);
    rendererBus.set(channel, set);
  },
  off(channel: string, listener: (event: unknown, payload: any) => void) {
    const set = rendererBus.get(channel);
    if (!set) return;
    for (const wrapped of Array.from(set)) {
      if ((wrapped as any).__orig === listener || wrapped === (listener as any)) set.delete(wrapped);
    }
  },
  removeListener(channel: string, listener: any) { ipcRenderer.off(channel, listener); },
  removeAllListeners(channel: string) { rendererBus.delete(channel); },
};

export const contextBridge = {
  exposeInMainWorld(key: string, api: unknown) {
    (globalThis as any)[key] = api;
  },
};

const USER_DATA = '/mobile';

export const app = {
  name: 'TaskManager',
  getVersion(): string { return (globalThis as any).__TASKMANAGER_VERSION__ ?? '1.1.5'; },
  isPackaged: true,
  getPath(name: string): string {
    switch (name) {
      case 'userData': return USER_DATA;
      case 'temp': case 'tmp': return '/tmp';
      case 'downloads': case 'home': return USER_DATA;
      default: return USER_DATA;
    }
  },
  commandLine: { appendSwitch(_: string, __?: string) { /* no-op */ } },
  disableHardwareAcceleration() { /* no-op */ },
  whenReady() { return Promise.resolve(); },
  on() { /* no-op */ },
  quit() { /* no-op */ },
};

/** 假 BrowserWindow：只为了让 updater 把进度/可用事件转发到渲染层总线 */
class WebContentsLike {
  send(channel: string, ...args: any[]) {
    // webContents.send(event, payload) → rendererBus 传 payload
    busEmit(channel, args[args.length - 1]);
  }
}

class BrowserWindowLike {
  webContents = new WebContentsLike();
  isDestroyed() { return false; }
  close() { /* no-op */ }
}

const fakeWindow = new BrowserWindowLike();

export const BrowserWindow = Object.assign(
  class BrowserWindowStub { constructor(_opts?: any) { return fakeWindow as any; } },
  {
    getAllWindows(): BrowserWindowLike[] { return [fakeWindow]; },
    getFocusedWindow(): BrowserWindowLike | null { return fakeWindow; },
    fromWebContents(_wc: any): BrowserWindowLike | null { return fakeWindow; },
    fromId(_id: number): BrowserWindowLike | null { return fakeWindow; },
  },
);

export const dialog = {
  showErrorBox(_title: string, _content: string) {
    console.warn('[mobile] dialog.showErrorBox（移动端仅打印）:', _title);
  },
  async showMessageBox(_opts: any): Promise<{ response: number }> { return { response: 0 }; },
  async showSaveDialog(_opts: any): Promise<{ canceled: boolean; filePath?: string }> {
    return { canceled: true };
  },
  async showOpenDialog(_opts: any): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
};

export const shell = {
  async openExternal(url: string) {
    try { (globalThis as any).open?.(url, '_blank'); } catch { /* ignore */ }
  },
  showItemInFolder(_p: string) { /* no-op */ },
};

export const net = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return (globalThis as any).fetch(input, init);
  },
  request(_opts: any): never {
    throw new Error('移动端不支持 net.request');
  },
};

/** 调试：当前注册的所有 IPC channel */
export function debugChannels(): string[] {
  return Array.from(invokeHandlers.keys()).sort();
}

export default { ipcMain, ipcRenderer, contextBridge, app, BrowserWindow, dialog, shell, net };
