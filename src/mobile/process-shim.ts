/**
 * Node 全局 shim —— 必须是 mobile bundle 里最先执行 的模块。
 *
 * WebView 里没有任何 Node 全局，但被复用的 electron/* 主进程逻辑依赖它们：
 *  - Buffer：base64 解码 / hash / 二进制读写
 *    ⚠️ electron/class/storage.ts 在**模块顶层**就 `Buffer.from(token, 'base64')`
 *    解码内置公共令牌，缺 Buffer 会在模块求值阶段抛 ReferenceError，
 *    React 根本没机会挂载 —— 表现为启动白屏（v1.2.9 首版 APK 的 bug）
 *  - process.versions / process.env：updater、版本判断
 *  - global / setImmediate：Node 生态惯例
 *
 * 顺序保证：bootstrap.ts 第一行 `import './process-shim'`，Rollup 按依赖顺序求值。
 */
import { Buffer as BufferPolyfill } from 'buffer';

(function installNodeGlobals() {
  const g = globalThis as any;

  // —— Buffer（缺失即白屏）——
  if (!g.Buffer) g.Buffer = BufferPolyfill;

  // —— Node 生态常写 `global.xxx`，给个别名 ——
  if (!g.global) g.global = g;

  // —— setImmediate / clearImmediate（Node 专有）——
  if (typeof g.setImmediate !== 'function') {
    g.setImmediate = (fn: (...a: any[]) => void, ...args: any[]) =>
      setTimeout(() => fn(...args), 0);
  }
  if (typeof g.clearImmediate !== 'function') {
    g.clearImmediate = (id: any) => clearTimeout(id);
  }

  // —— process ——
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
