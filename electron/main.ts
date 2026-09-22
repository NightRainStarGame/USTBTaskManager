import { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { initDatabase, getDb, getStartupRecovery } from './db/index';
import { registerAllIpc } from './ipc/index';
import { autoCheckUpdate } from './updater/index';
import { refreshAbout } from './about/index';
import { scheduleAutoCleanup } from './cleanup';
import { initTray, destroyTray } from './tray';
import { startNotificationScheduler } from './notify';

const isDev = process.env.NODE_ENV === 'development';

const LOG_FILE = path.join(os.tmpdir(), 'taskmanager-boot.log');
function bootLog(msg: string) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}
bootLog(`--- boot start, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}`);
process.on('uncaughtException', (err) => {
  bootLog('UNCAUGHT: ' + (err?.stack || String(err)));
});
process.on('unhandledRejection', (err) => {
  bootLog('UNHANDLED: ' + ((err as any)?.stack || String(err)));
});

app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (process.argv.includes('--disable-gpu') || process.env.TASKMGR_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  bootLog('software rendering enabled');
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let splashHidden = false;
let splashShownAt = 0;
let splashLoaded = false;
let splashLastMsg: { pct: number; text: string } | null = null;

const SPLASH_MIN_MS = 1500;
const SPLASH_FADE_MS = 320;

function splashProgress(pct: number, text: string) {
  splashLastMsg = { pct, text };
  if (splashWindow && !splashWindow.isDestroyed() && splashLoaded) {
    try { splashWindow.webContents.send('splash:progress', splashLastMsg); } catch {}
  }
}

/** splash 淡出计时器持有，destroy 前清理避免泄漏 */
let splashFadeTimer: NodeJS.Timeout | null = null;
let splashMinTimer: NodeJS.Timeout | null = null;

function hideSplashAndShowMain() {
  if (splashHidden) return;
  splashHidden = true;
  if (splashMinTimer) { clearTimeout(splashMinTimer); splashMinTimer = null; }

  const doTransition = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      const start = Date.now();
      const fadeStep = () => {
        if (!splashWindow || splashWindow.isDestroyed()) {
          splashFadeTimer = null;
          return;
        }
        const t = (Date.now() - start) / SPLASH_FADE_MS;
        if (t >= 1) {
          splashWindow.destroy();
          splashWindow = null;
          splashFadeTimer = null;
        } else {
          try { splashWindow.setOpacity(1 - t); } catch {}
          splashFadeTimer = setTimeout(fadeStep, 16);
        }
      };
      splashFadeTimer = setTimeout(fadeStep, 0);
    }
    bootLog('splash fading out, main shown');
  };

  const elapsed = splashShownAt ? Date.now() - splashShownAt : SPLASH_MIN_MS;
  const remain = Math.max(0, SPLASH_MIN_MS - elapsed);
  if (remain > 0) splashMinTimer = setTimeout(doTransition, remain);
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
    skipTaskbar: true,
    // 立即 show：配合 paintWhenInitiallyHidden 让 OS 先画好首帧，避免主线程被
    // DB init / IPC 注册 / 主窗口创建等同步操作阻塞时出现「黑屏等 splash」的卡顿感
    show: true,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
  });
  splashShownAt = Date.now();
  bootLog('splash shown (immediate)');
  splashWindow.webContents.once('did-finish-load', () => {
    splashLoaded = true;
    if (splashLastMsg) {
      try { splashWindow?.webContents.send('splash:progress', splashLastMsg); } catch {}
    }
  });
  // 保险丝——立即可见下正常 300ms 内必然 ready，保留只为 setVisible 标志兜底
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed() && !splashHidden && !splashShownAt) {
      try { splashWindow.show(); } catch {}
      splashShownAt = Date.now();
      bootLog('splash shown (fuse timer)');
    }
  }, 300);
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  setTimeout(() => {
    if (!splashHidden) {
      bootLog('splash fallback: force-hide after 5s');
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
      webviewTag: true,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {});

  let renderCrashCount = 0;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    renderCrashCount += 1;
    bootLog(`RENDER-GONE #${renderCrashCount}: reason=${details.reason}`);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (renderCrashCount <= 3) {
      mainWindow.reload();
    } else {
      dialog.showErrorBox(
        '渲染进程持续崩溃',
        `页面渲染进程已连续崩溃 ${renderCrashCount} 次。\n` +
        `原因：${details.reason}\n\n` +
        '可尝试：1) 加参数 --disable-gpu 启动；2) 重启电脑。'
      );
    }
  });

  mainWindow.on('unresponsive', () => bootLog('WINDOW-UNRESPONSIVE'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

// ── v1.2.3 托盘常驻：关窗可从托盘唤回 ──────────────────────────
let trayActive = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    mainWindow?.once('ready-to-show', () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

ipcMain.on('app:ready-to-show', () => {
  bootLog('renderer reports ready-to-show');
  splashProgress(100, '就绪');
  hideSplashAndShowMain();
});

app.whenReady().then(() => {
  bootLog('app ready');

  try {
    const patchApply = require('./updater/patchApply');
    const state = patchApply.checkPatchStateOnBoot();
    if (state.applied) bootLog('patch state: APPLIED');
    else if (state.failed) {
      const b = state.baseline || { expected: '?', actual: '?' };
      bootLog(`patch state: FAILED expected=${b.expected} actual=${b.actual}`);
    }
  } catch (e: any) {
    bootLog('patch state check failed: ' + (e?.message || e));
  }

  try {
    createSplash();
    splashProgress(12, '正在唤醒…');
    bootLog('splash created');
  } catch (e: any) {
    bootLog('SPLASH CREATE FAILED: ' + (e?.stack || String(e)));
  }

  let dbReady = false;
  try {
    initDatabase();
    dbReady = true;
    bootLog('db initialized');
    splashProgress(45, '正在加载课程数据…');

    const rec = getStartupRecovery();
    if (rec && rec.outcome !== 'normal') {
      bootLog(`DB RECOVERY: outcome=${rec.outcome}`);
      const msg = rec.outcome === 'restored'
        ? `检测到数据库文件损坏，已自动从最近备份恢复。\n\n备份来源：${rec.usedBackup}\n损坏的原文件已隔离保存为：${rec.quarantined ?? '（未记录）'}`
        : `检测到数据库文件损坏，且没有可用的备份。\n\n已新建空数据库以保证应用可用。损坏的原文件已隔离保存为：${rec.quarantined ?? '（未记录）'}`;
      dialog.showErrorBox('数据库已自动恢复', msg);
    }

    registerAllIpc(getDb());
    bootLog('ipc registered');
    splashProgress(55, '正在连接模块…');

    // v1.1.9 自动清理：启动 45s 后首跑 + 每小时一次（本地必跑；云端每天最多一次）
    try {
      scheduleAutoCleanup(getDb());
    } catch (e: any) {
      bootLog('CLEANUP SCHEDULE FAILED: ' + (e?.message || e));
    }
  } catch (e: any) {
    bootLog('DB SETUP FAILED: ' + (e?.stack || String(e)));
    dialog.showErrorBox(
      '数据库初始化失败',
      `数据库无法初始化，应用将以只读界面启动。\n\n${e?.message || e}\n\n日志：${LOG_FILE}`
    );
  }

  try {
    createWindow();
    bootLog(`window created (dbReady=${dbReady})`);
    splashProgress(72, '正在绘制界面…');

    // v1.2.3：托盘 + 系统通知 + 全局快捷键（Ctrl+Shift+A 快速添加）
    try {
      trayActive = initTray(showMainWindow, () => app.quit());
      bootLog(`tray initialized (active=${trayActive})`);
    } catch (e: any) {
      bootLog('TRAY INIT FAILED: ' + (e?.message || e));
    }
    if (dbReady) {
      try {
        startNotificationScheduler(getDb(), () => mainWindow);
        bootLog('notification scheduler started');
      } catch (e: any) {
        bootLog('NOTIFY SCHEDULER FAILED: ' + (e?.message || e));
      }
    }
    try {
      const registered = globalShortcut.register('Control+Shift+A', () => {
        showMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('app:quickadd');
        }
      });
      if (!registered) bootLog('global shortcut Ctrl+Shift+A NOT registered (conflict?)');
    } catch (e: any) {
      bootLog('GLOBAL SHORTCUT FAILED: ' + (e?.message || e));
    }

    setTimeout(() => {
      let dbRef = null as ReturnType<typeof getDb> | null;
      try { dbRef = getDb(); } catch {}
      autoCheckUpdate(dbRef, mainWindow).catch(() => {});
      refreshAbout(dbRef).catch(() => {});
    }, 8000);
  } catch (e: any) {
    bootLog('WINDOW CREATE FAILED: ' + (e?.stack || String(e)));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // v1.2.3：托盘常驻——关窗不退出（点托盘「显示主窗口」可回来）；托盘不可用时维持旧行为
  if (process.platform !== 'darwin' && !trayActive) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyTray();
});