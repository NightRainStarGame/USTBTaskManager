/** node:os shim —— 移动端 webview 里只提供路径占位与平台信息 */
export function tmpdir(): string { return '/tmp'; }
export function homedir(): string { return '/mobile'; }
export function platform(): NodeJS.Platform { return 'android' as unknown as NodeJS.Platform; }
export function hostname(): string { return 'localhost'; }
export function freemem(): number { return 512 * 1024 * 1024; }
export function totalmem(): number { return 4 * 1024 * 1024 * 1024; }
export const EOL = '\n';
export default { tmpdir, homedir, platform, hostname, freemem, totalmem, EOL };
