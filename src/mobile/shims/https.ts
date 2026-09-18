/**
 * node:https / node:http shim —— 移动端不支持 Node 原生 http 栈。
 *
 * 项目里唯一用 node:https 的是 AnyShare（北科云盘）客户端
 * （桌面版为绕开 Electron net stack 的 302 bug 特意用 Node https）。
 * webview 里没有这个模块；云盘相关调用会在这里明确失败，
 * 由各 handler 的 try/catch 转成用户可见的错误信息。
 */

function notSupported(moduleName: string): never {
  throw new Error(`移动端不支持 ${moduleName}（北科云盘同步仅在桌面版可用）`);
}

export function request(..._args: any[]): never {
  notSupported('node:https.request');
}
export function get(..._args: any[]): never {
  notSupported('node:https.get');
}
export const Agent = class { constructor(..._a: any[]) { notSupported('https.Agent'); } };
export default { request, get, Agent };
