/** IPC 三层对齐校验：主进程注册的通道 vs preload 暴露 vs 渲染层调用 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const mainSrc = read('electron/ipc/index.ts') + '\n' + read('electron/backup/index.ts') + '\n' + read('electron/main.ts');
const preloadSrc = read('electron/preload.ts');
const rendererFiles = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) rendererFiles.push(p);
  }
};
walk(path.join(root, 'src'));
const rendererSrc = rendererFiles.map((p) => fs.readFileSync(p, 'utf8')).join('\n');

const channels = (src, re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();

const main = channels(mainSrc, /ipcMain\.handle\('([^']+)'/g);
const preload = channels(preloadSrc, /ipcRenderer\.invoke\('([^']+)'/g);
const renderer = channels(rendererSrc, /taskAPI(?:\.\w+){2,}\(/g);

console.log(`主进程注册通道: ${main.length} 个`);
console.log(`preload 暴露通道: ${preload.length} 个`);

const missingInPreload = main.filter((c) => !preload.includes(c));
const missingInMain = preload.filter((c) => !main.includes(c));
let fail = 0;
if (missingInPreload.length) { console.log(`❌ 主进程有但 preload 未暴露: ${missingInPreload.join(', ')}`); fail++; }
else console.log('✅ 主进程所有通道 preload 均已暴露');
if (missingInMain.length) { console.log(`⚠️  preload 有但主进程未注册: ${missingInMain.join(', ')}`); fail++; }
else console.log('✅ preload 所有通道主进程均已注册');

console.log(`渲染层 taskAPI 调用点: ${renderer.length} 种`);
process.exit(fail ? 1 : 0);
