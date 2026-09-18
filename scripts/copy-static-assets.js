/**
 * 把 tsc 不会自动复制的「非源码静态资源」拷到 dist-electron/，
 * 跟着 electron-builder 一起进 app.asar。
 *
 * 当前只搬运：
 *   - electron/splash.html → dist-electron/splash.html
 *     （启动画面，主进程 splashWindow 直接 loadFile 这个路径）
 *
 * 后续如果要加 preload 配套 HTML、SQL 初始化脚本等，也在这里加。
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'electron');
const DST = path.join(__dirname, '..', 'dist-electron');

const FILES = [
  'splash.html',
];

if (!fs.existsSync(DST)) {
  console.warn(`[copy-static-assets] ${DST} 不存在，请先跑 tsc`);
  process.exit(0);
}

for (const f of FILES) {
  const src = path.join(SRC, f);
  const dst = path.join(DST, f);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-static-assets] 源不存在：${src}（跳过）`);
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log(`[copy-static-assets] ${src} → ${dst}`);
}
