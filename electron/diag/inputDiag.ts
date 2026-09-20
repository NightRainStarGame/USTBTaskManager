/**
 * v1.1.6 输入诊断日志 — 主进程落盘（块 3：输入框失灵埋点）
 *
 * 背景：用户在某些场景下出现「光标在 input 里但敲键盘无反应」。
 * 嫌疑：Electron 33 Chromium IME composition 残留、窗口焦点被劫持、慢 IPC
 *        等。本模块接收渲染层探测器发来的快照，追加到
 *        `%TMP%/taskmanager-input-diag.log`，供反馈时回传定位。
 *
 * 设计取舍：
 * - 不在这里实时监控（无键盘事件）；只在渲染层检测到「input focus + N ms
 *   无 keydown」的失灵特征时上报一次，避免日志被噪声淹没
 * - 日志格式：每条记录是 JSON Lines（.jsonl），便于脚本解析统计
 * - 失败兜底：写到 tmpdir 失败时不抛（埋点不能反过来阻塞主进程）
 */
import { app, ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_FILE = path.join(os.tmpdir(), 'taskmanager-input-diag.log');
/** 单个文件最大体积（2 MB），写超过就轮转一份 .1 备份。埋点是低频事件，正常用不到。 */
const LOG_MAX_BYTES = 2 * 1024 * 1024;
/** 主进程侧自动 logger 给 boot log 加一行，方便确认诊断路径走通 */
const BOOT_LOG = path.join(os.tmpdir(), 'taskmanager-boot.log');

function bootTrace(msg: string) {
  try {
    fs.appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] [input-diag] ${msg}\n`);
  } catch { /* ignore */ }
}

function safeSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function rotateIfNeeded(): void {
  if (safeSize(LOG_FILE) <= LOG_MAX_BYTES) return;
  try {
    const backup = `${LOG_FILE}.1`;
    fs.renameSync(LOG_FILE, backup);
    bootTrace(`rotated to ${backup} (was ${(safeSize(backup) / 1024).toFixed(1)} KB)`);
  } catch (e: any) {
    bootTrace(`rotate failed: ${e?.message || e}`);
  }
}

/** 追加一条诊断快照；snapshot 由渲染层探测器序列化为普通对象 */
export function appendDiag(snapshot: any): void {
  rotateIfNeeded();
  try {
    const line = JSON.stringify({
      ts: Date.now(),
      iso: new Date().toISOString(),
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      ...snapshot,
    });
    fs.appendFileSync(LOG_FILE, line + '\n');
    bootTrace(`captured snapshot, log now ${(safeSize(LOG_FILE) / 1024).toFixed(1)} KB`);
  } catch (e: any) {
    bootTrace(`append failed: ${e?.message || e}`);
  }
}

/** 把诊断日志复制到用户选择的位置；返回最终保存到的路径，canceled=true 表示取消 */
export async function exportDiag(): Promise<{
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
  byteCount?: number;
}> {
  if (!fs.existsSync(LOG_FILE)) {
    return { ok: true, path: LOG_FILE, byteCount: 0 };
  }
  const dlg = await dialog.showSaveDialog({
    title: '导出输入诊断日志',
    defaultPath: `taskmanager-input-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
    filters: [{ name: '日志文件', extensions: ['log', 'jsonl', 'txt'] }, { name: '全部', extensions: ['*'] }],
  });
  if (dlg.canceled || !dlg.filePath) return { ok: false, canceled: true };
  try {
    fs.copyFileSync(LOG_FILE, dlg.filePath);
    const stat = fs.statSync(dlg.filePath);
    return { ok: true, path: dlg.filePath, byteCount: stat.size };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 注册 IPC 处理器（由 ipc/index.ts 统一调用） */
export function registerInputDiagIpc() {
  ipcMain.on('input:diag:append', (_e, snapshot: any) => {
    appendDiag(snapshot);
  });
  ipcMain.handle('input:diag:export', async () => {
    return exportDiag();
  });
  ipcMain.handle('input:diag:peek', async () => {
    if (!fs.existsSync(LOG_FILE)) return { ok: true, path: LOG_FILE, byteCount: 0, recent: [] };
    try {
      const stat = fs.statSync(LOG_FILE);
      const text = fs.readFileSync(LOG_FILE, 'utf8');
      const lines = text.split('\n').filter((l) => l.trim()).slice(-5);
      const recent = lines.map((l) => {
        try { return JSON.parse(l); } catch { return { _raw: l }; }
      });
      return { ok: true, path: LOG_FILE, byteCount: stat.size, recent };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
  bootTrace(`registered input:diag handlers, log=${LOG_FILE}`);
}
