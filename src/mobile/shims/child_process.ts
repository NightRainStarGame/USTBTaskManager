/**
 * node:child_process shim —— Android WebView 无法创建子进程。
 *
 * 存在的意义：桌面端的自动更新（spawn Setup /S）与补丁 helper（spawn 独立进程
 * 改写 app.asar）在移动端本就不可用，但这些模块会被静态打包进 mobile bundle。
 * 若不做 shim，Vite 会把 node:child_process 外部化成 __vite-browser-external
 * （无任何导出），Rollup 直接报 `"spawn" is not exported`，**构建失败**。
 *
 * 真正被调用时抛明确错误，由上层 ipcSafe / try-catch 转成可读提示。
 */
const unsupported = (api: string): never => {
  throw new Error(`移动端不支持 child_process.${api}（自动更新 / 补丁仅桌面端可用）`);
};

export const spawn = (..._args: any[]): any => unsupported('spawn');
export const spawnSync = (..._args: any[]): any => unsupported('spawnSync');
export const exec = (..._args: any[]): any => unsupported('exec');
export const execFile = (..._args: any[]): any => unsupported('execFile');
export const execSync = (..._args: any[]): any => unsupported('execSync');
export const fork = (..._args: any[]): any => unsupported('fork');

export default { spawn, spawnSync, exec, execFile, execSync, fork };
