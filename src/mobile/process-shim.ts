/**
 * 进程全局 shim —— 必须是 mobile bundle 里最先执行 的模块。
 *
 * 主进程逻辑（updater 的 app:info 等）会读 process.versions / process.env；
 * webview 里没有这些全局，vite 也只替换 process.env.NODE_ENV 字面量。
 * 在任何 electron/* 模块加载前装一个最小 process。
 */
(function installProcess() {
  const g = globalThis as any;
  if (g.process && g.process.versions) return;

  g.process = {
    env: { NODE_ENV: 'production', ...(g.process?.env || {}) },
    versions: {
      node: '22.0.0-mobile',
      electron: 'mobile-webview',
      chrome: (globalThis as any).chrome?.runtime ? '' : '',
    },
    platform: 'android',
    arch: 'arm64',
    argv: [],
    pid: 0,
    cwd: () => '/',
    nextTick: (fn: (...a: any[]) => void, ...args: any[]) => Promise.resolve().then(() => fn(...args)),
    on: () => {},
    once: () => {},
    off: () => {},
  };
})();
