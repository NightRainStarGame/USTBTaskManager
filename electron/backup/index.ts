/**
 * Electron 侧的备份能力：文件对话框、IPC、自动滚动备份、安全备份。
 * 纯逻辑（序列化/校验/恢复/完整性检查）在 ./core.ts，可脱离 Electron 测试。
 */
import type { Database } from 'better-sqlite3';
import { app, dialog, BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BACKUP_TABLES,
  buildPayload,
  validatePayload,
  restorePayload,
  checkIntegrity,
  atomicWrite,
} from './core';

export * from './core';

// ===== 备份目录 =====

export function backupsDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 启动时的自动滚动备份：每天最多一份，保留最近 7 份。
 * 使用 better-sqlite3 的 backup API（在线备份，WAL 下安全）。
 */
export async function autoRollingBackup(db: Database, keep = 7): Promise<string | null> {
  const dir = backupsDir();
  const today = new Date().toISOString().slice(0, 10);
  const existing = fs.readdirSync(dir).filter((f) => f.startsWith('auto-') && f.endsWith('.db'));
  if (existing.some((f) => f.includes(today))) return null; // 今天已备份

  const target = path.join(dir, `auto-${today}-${Date.now()}.db`);
  await db.backup(target);

  // 只保留最近 keep 份
  const all = fs.readdirSync(dir)
    .filter((f) => f.startsWith('auto-') && f.endsWith('.db'))
    .sort();
  while (all.length > keep) {
    const oldest = all.shift()!;
    try { fs.unlinkSync(path.join(dir, oldest)); } catch { /* ignore */ }
  }
  return target;
}

/** 导入前的强制安全备份（命名带 pre-import，不参与滚动清理） */
export async function safetyBackup(db: Database): Promise<string> {
  const dir = backupsDir();
  const target = path.join(dir, `pre-import-${Date.now()}.db`);
  await db.backup(target);
  return target;
}

// ===== IPC 注册 =====

export function registerBackup(db: Database, dbPath: string) {
  ipcMain.handle('backup:export', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const result = await dialog.showSaveDialog(win!, {
      title: '导出全量备份',
      defaultPath: `taskmanager-backup-${stamp}.json`,
      filters: [{ name: 'TaskManager 备份', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const payload = buildPayload(db, app.getVersion());
    atomicWrite(result.filePath, JSON.stringify(payload, null, 2));
    return { ok: true, path: result.filePath, counts: payload.counts };
  });

  ipcMain.handle('backup:import', async (_e, opts?: { skipSafetyBackup?: boolean }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win!, {
      title: '从备份文件恢复',
      properties: ['openFile'],
      filters: [{ name: 'TaskManager 备份', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: '文件不是有效的 JSON' };
    }

    const v = validatePayload(parsed);
    if (!v.ok) return { ok: false, error: v.error };

    // 导入前安全备份（可用 opts.skipSafetyBackup 跳过，如磁盘已满时）
    let safetyPath = '';
    if (!opts?.skipSafetyBackup) {
      safetyPath = await safetyBackup(db);
    }

    try {
      const restored = restorePayload(db, v.payload!);
      return { ok: true, restored, safetyBackupPath: safetyPath, source: result.filePaths[0] };
    } catch (err: any) {
      return { ok: false, error: `恢复失败（数据库未改动，事务已回滚）：${err?.message || err}` };
    }
  });

  ipcMain.handle('backup:status', () => {
    const stats = checkIntegrity(db, dbPath);
    let lastAutoBackup: string | null = null;
    try {
      const dir = backupsDir();
      const autos = fs.readdirSync(dir).filter((f) => f.startsWith('auto-') && f.endsWith('.db')).sort();
      lastAutoBackup = autos.length ? autos[autos.length - 1] : null;
    } catch { /* ignore */ }
    return { ...stats, lastAutoBackup };
  });

  ipcMain.handle('backup:makeSafety', async () => {
    const p = await safetyBackup(db);
    return { ok: true, path: p };
  });
}

// 保留引用，防止 tree-shake 误删（BACKUP_TABLES 主要在 core 内使用）
void BACKUP_TABLES;
