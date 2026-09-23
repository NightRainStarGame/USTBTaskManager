/**
 * Android 图标 / 启动图生成器（需在 Electron 下运行）：
 *   npx electron scripts/make-android-icons.cjs
 *
 * 逐张渲染（每次 executeJavaScript 只画一张，避免一次性返回 14 张大 dataURL 挂起渲染进程）。
 * 日志：scripts/make-android-icons.log
 *
 * 产出：mipmap 各密度 ic_launcher / ic_launcher_round / ic_launcher_foreground 共 15 张、
 *       drawable 各方向尺寸 splash 共 11 张、
 *       build/icon-2048.png 高清母版
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const LOG_FILE = path.join(__dirname, 'make-android-icons.log');
const PAINT_SRC = fs.readFileSync(path.join(__dirname, 'make-android-icons-paint.js'), 'utf8');

const LAUNCHER = [['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96], ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]];
const FOREGROUND = [['mipmap-mdpi', 108], ['mipmap-hdpi', 162], ['mipmap-xhdpi', 216], ['mipmap-xxhdpi', 324], ['mipmap-xxxhdpi', 432]];
const SPLASH = [
  ['drawable', 480, 320],
  ['drawable-port-mdpi', 320, 480], ['drawable-port-hdpi', 480, 800], ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600], ['drawable-port-xxxhdpi', 1280, 1920],
  ['drawable-land-mdpi', 480, 320], ['drawable-land-hdpi', 800, 480], ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960], ['drawable-land-xxxhdpi', 1920, 1280],
];

const log = [];
const logLine = (s) => { log.push(s); try { console.log(s); } catch {} };
const savePng = (dataUrl, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const kill = setTimeout(() => { logLine('!! 60s 超时强退'); fs.writeFileSync(LOG_FILE, log.join('\n')); app.exit(1); }, 60000);
  let failed = false;
  try {
    const win = new BrowserWindow({ show: false, width: 2200, height: 1400, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html,<html><body></body></html>');

    async function renderOne(w, h, mode) {
      const job = win.webContents.executeJavaScript(
        `(function(){ ${PAINT_SRC}
          var c=document.createElement('canvas');c.width=${w};c.height=${h};
          window.__paint(c.getContext('2d'),2048,'${mode}');
          return c.toDataURL('image/png'); })()`,
      );
      return await Promise.race([
        job,
        new Promise((_, rej) => setTimeout(() => rej(new Error('render timeout: ' + mode + ' ' + w + 'x' + h)), 20000)),
      ]);
    }

    const squareUrl = await renderOne(2048, 2048, 'square');
    logLine('square 2048 ✓');
    const roundUrl = await renderOne(2048, 2048, 'round');
    logLine('round 2048 ✓');
    const fgUrl = await renderOne(2048, 2048, 'fg');
    logLine('fg 2048 ✓');

    savePng(squareUrl, path.join(ROOT, 'build', 'icon-2048.png'));
    const imgSquare = nativeImage.createFromBuffer(Buffer.from(squareUrl.split(',')[1], 'base64'));
    const imgRound = nativeImage.createFromBuffer(Buffer.from(roundUrl.split(',')[1], 'base64'));
    const imgFg = nativeImage.createFromBuffer(Buffer.from(fgUrl.split(',')[1], 'base64'));

    for (const [dir, size] of LAUNCHER) {
      const f = path.join(RES, dir, 'ic_launcher.png');
      fs.writeFileSync(f, imgSquare.resize({ width: size, height: size, quality: 'best' }).toPNG());
      logLine('  ' + path.relative(ROOT, f));
      const fr = path.join(RES, dir, 'ic_launcher_round.png');
      fs.writeFileSync(fr, imgRound.resize({ width: size, height: size, quality: 'best' }).toPNG());
      const ff = path.join(RES, dir, 'ic_launcher_foreground.png');
      fs.writeFileSync(ff, imgFg.resize({ width: size, height: size, quality: 'best' }).toPNG());
    }

    for (const [dir, w, h] of SPLASH) {
      const url = await renderOne(w, h, 'splash');
      const f = path.join(RES, dir, 'splash.png');
      savePng(url, f);
      logLine('  ' + path.relative(ROOT, f) + ' ' + w + 'x' + h);
    }

    logLine('✓ 全部生成完成');
  } catch (e) {
    failed = true;
    logLine('!! ERROR: ' + (e && (e.stack || e.message || String(e))));
  } finally {
    clearTimeout(kill);
    fs.writeFileSync(LOG_FILE, log.join('\n'));
    app.exit(failed ? 1 : 0);
  }
});
