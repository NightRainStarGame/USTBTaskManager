import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDatabase, getDb, getStartupRecovery } from './db/index';
import { registerAllIpc } from './ipc/index';
import { autoCheckUpdate } from './updater/index';

const isDev = process.env.NODE_ENV === 'development';

// ====== 启动期错误落盘（打包后无控制台，便于排查）======
const LOG_FILE = path.join(os.tmpdir(), 'taskmanager-boot.log');
function bootLog(msg: string) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}
bootLog(`--- boot start, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, resourcesPath=${process.resourcesPath}`);
process.on('uncaughtException', (err) => {
  bootLog('UNCAUGHT: ' + (err?.stack || String(err)));
});
process.on('unhandledRejection', (err) => {
  bootLog('UNHANDLED: ' + ((err as any)?.stack || String(err)));
});

// ====== GPU 兼容性 ======
// 虚拟机 / 远程桌面 / 无显卡驱动的环境里 Chromium 的 GPU 进程可能启动失败，
// 会导致 Electron 直接 FATAL 退出（"GPU process isn't usable. Goodbye."）。
// 这里放宽 GPU 沙箱；若仍无法启动，可用命令行参数 `--disable-gpu` 以软件渲染运行。
app.commandLine.appendSwitch('disable-gpu-sandbox');
// Windows 输入失效修复：Chromium 的原生窗口遮挡计算在部分场景会把正常窗口误判为"被遮挡"，
// 导致窗口看似正常但收不到键盘/鼠标输入（Electron issue #25506）。禁用该特性。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (process.argv.includes('--disable-gpu') || process.env.TASKMGR_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  bootLog('software rendering enabled');
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashHidden = false;
let splashShownAt = 0;          // splash 真正可见的时刻（用于最短展示时长）
let splashLoaded = false;       // splash 页面 did-finish-load（此后才能收 IPC）
let splashLastMsg: { pct: number; text: string } | null = null;

/** splash 最短展示时长：保证动画被看见（用户核心诉求 #2：启动动画要像真窗口，不是闪一下的预载） */
const SPLASH_MIN_MS = 1500;
/** splash 淡出时长 */
const SPLASH_FADE_MS = 320;

/** 把真实启动里程碑推给 splash 页面（驱动进度条与文案）；页面未加载完时缓存，加载完补发 */
function splashProgress(pct: number, text: string) {
  splashLastMsg = { pct, text };
  if (splashWindow && !splashWindow.isDestroyed() && splashLoaded) {
    try { splashWindow.webContents.send('splash:progress', splashLastMsg); } catch { /* 忽略：页面可能正在销毁 */ }
  }
}

/** 关掉 splash、显示主窗口；幂等，多次调用安全。
 *  v1.1.6：主窗先 show，splash 同步 opacity 淡出，形成交叉过渡；并保证 splash 至少可见 SPLASH_MIN_MS。 */
function hideSplashAndShowMain() {
  if (splashHidden) return;
  splashHidden = true;

  const doTransition = () => {
    // 先亮主窗，再淡出 splash —— 交叉过渡
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      const start = Date.now();
      const fadeStep = () => {
        if (!splashWindow || splashWindow.isDestroyed()) return;
        const t = (Date.now() - start) / SPLASH_FADE_MS;
        if (t >= 1) {
          splashWindow.destroy();
          splashWindow = null;
        } else {
          try { splashWindow.setOpacity(1 - t); } catch { /* 已销毁 */ }
          setTimeout(fadeStep, 16);
        }
      };
      fadeStep();
    }
    bootLog('splash fading out, main shown');
  };

  // 最短展示时长：动画刚起就被关掉等于没有动画
  const elapsed = splashShownAt ? Date.now() - splashShownAt : SPLASH_MIN_MS;
  const remain = Math.max(0, SPLASH_MIN_MS - elapsed);
  if (remain > 0) setTimeout(doTransition, remain);
  else doTransition();
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,           // 不出现在任务栏
    show: false,
    paintWhenInitiallyHidden: true, // 即使 hidden 也要 paint，否则 CSS 动画不会跑
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'splash-preload.js'), // v1.1.6：进度事件桥
    },
  });
  // 页面加载完成后才可能收 IPC；把缓存里最后一条里程碑补发过去
  splashWindow.webContents.once('did-finish-load', () => {
    splashLoaded = true;
    if (splashLastMsg) {
      try { splashWindow?.webContents.send('splash:progress', splashLastMsg); } catch { /* ignore */ }
    }
  });
  // 先挂事件，再 loadFile（避免错过 ready-to-show）
  splashWindow.once('ready-to-show', () => {
    if (splashHidden) return; // 主窗已就绪、过渡已开始：不再显示 splash
    splashWindow?.show();
    splashShownAt = Date.now();
    bootLog('splash shown (ready-to-show)');
  });
  // v1.1.6 保险丝：实测（boot log 无 'splash shown'）ready-to-show 在部分环境下不触发，
  // splash 永远 hidden 直到被销毁——用户从来看不到启动画面。300ms 没显示就强制 show。
  // （300ms 的取舍：比绝大多数启动里程碑早，动画能看到；只有主窗 300ms 内就绪的极速启动才跳过）
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed() && !splashHidden && !splashShownAt) {
      try { splashWindow.show(); } catch { /* ignore */ }
      splashShownAt = Date.now();
      bootLog('splash shown (fuse timer, ready-to-show missed)');
    }
  }, 300);
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  // 防呆：若主窗口长时间未 ready（5 秒还没关 splash），强制兜底
  setTimeout(() => {
    if (!splashHidden) {
      bootLog('splash fallback: force-hide after 5s timeout');
      hideSplashAndShowMain();
    }
  }, 5000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // 关键：允许 webview，用于微信小程序嵌套
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => { /* 等待渲染层 app:ready-to-show IPC 统一收尾 */ });

  // ====== 渲染进程崩溃自愈 ======
  // Chromium 渲染进程崩溃（GPU/内存/OOM）时自动重载；连续崩溃超过 3 次则提示用户
  let renderCrashCount = 0;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    renderCrashCount += 1;
    bootLog(`RENDER-GONE #${renderCrashCount}: reason=${details.reason}, exitCode=${details.exitCode}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (renderCrashCount <= 3) {
      bootLog('reloading renderer after crash');
      mainWindow.reload();
    } else {
      dialog.showErrorBox(
        '渲染进程持续崩溃',
        `页面渲染进程已连续崩溃 ${renderCrashCount} 次。\n` +
        `原因：${details.reason}\n\n` +
        '可尝试：1) 重启应用并加参数 --disable-gpu 以软件渲染运行；2) 重启电脑。'
      );
    }
  });

  // 页面无响应（事件循环卡死）时记录，便于排查
  mainWindow.on('unresponsive', () => bootLog('WINDOW-UNRESPONSIVE'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ====== 自定义窗口控制 IPC ======
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

// 渲染层完成 React mount + store.refreshAll() 后通过这个 channel 通知主进程"可以显示了"
ipcMain.on('app:ready-to-show', () => {
  bootLog('renderer reports ready-to-show');
  splashProgress(100, '就绪');
  hideSplashAndShowMain();
});

app.whenReady().then(() => {
  bootLog('app ready');

  // v1.1.6 块 4b：检查上次补丁是否应用成功，并把结果广播给渲染层（弹一条 toast）
  try {
    const patchApply = require('./updater/patchApply');
    const state = patchApply.checkPatchStateOnBoot();
    if (state.applied) {
      bootLog('patch state: APPLIED');
    } else if (state.failed) {
      const b = state.baseline || { expected: '?', actual: '?' };
      bootLog(`patch state: FAILED expected=${b.expected} actual=${b.actual}`);
    }
  } catch (e: any) {
    bootLog('patch state check failed: ' + (e?.message || e));
  }

  // v1.1.5：先把 splash 挂出来占住屏幕，避免「点击图标后空窗期」
  try {
    createSplash();
    splashProgress(12, '正在唤醒小豆芽…');
    bootLog('splash created');
  } catch (e: any) {
    bootLog('SPLASH CREATE FAILED (继续启动主窗口): ' + (e?.stack || String(e)));
  }

  let dbReady = false;
  try {
    initDatabase();
    dbReady = true;
    bootLog('db initialized');
    splashProgress(45, '正在加载课程数据…');

    // 数据库发生过损坏恢复时，明确告知用户（而不是默默换了一个空库）
    const rec = getStartupRecovery();
    if (rec && rec.outcome !== 'normal') {
      bootLog(`DB RECOVERY: outcome=${rec.outcome}, quarantined=${rec.quarantined ?? '-'}, usedBackup=${rec.usedBackup ?? '-'}`);
      const msg = rec.outcome === 'restored'
        ? `检测到数据库文件损坏，已自动从最近备份恢复。\n\n备份来源：${rec.usedBackup}\n损坏的原文件已隔离保存为：${rec.quarantined ?? '（未记录）'}`
        : `检测到数据库文件损坏，且没有可用的备份。\n\n已新建空数据库以保证应用可用。损坏的原文件已隔离保存为：${rec.quarantined ?? '（未记录）'}`;
      dialog.showErrorBox('数据库已自动恢复', msg);
    }

    registerAllIpc(getDb());
    bootLog('ipc registered');
    splashProgress(55, '正在连接模块…');
  } catch (e: any) {
    bootLog('DB SETUP FAILED (window will still open): ' + (e?.stack || String(e)));
    dialog.showErrorBox(
      '数据库初始化失败',
      `数据库无法初始化，应用将以只读界面启动，数据功能不可用。\n\n${e?.message || e}\n\n详细信息见：${LOG_FILE}`
    );
  }

  // 窗口无论如何都创建：DB 失败不该让应用变成无窗口僵尸进程
  try {
    createWindow();
    bootLog(`window created (dbReady=${dbReady})`);
    splashProgress(72, '正在绘制界面…');

    // 启动后静默检查更新（仅当用户配置了更新源；失败不打扰）
    setTimeout(() => {
      let dbRef = null as ReturnType<typeof getDb> | null;
      try { dbRef = getDb(); } catch { /* DB 不可用时跳过 */ }
      autoCheckUpdate(dbRef, mainWindow).catch(() => { /* ignore */ });
    }, 6000);
  } catch (e: any) {
    bootLog('WINDOW CREATE FAILED: ' + (e?.stack || String(e)));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});