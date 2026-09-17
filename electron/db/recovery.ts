/**
 * 数据库损坏自动恢复（纯逻辑，不依赖 Electron，可独立测试）。
 *
 * 策略：
 *  1. 正常打开 → PRAGMA quick_check 健康探测 → 成功即用
 *  2. 打开/探测失败 → 把损坏文件（含 -wal/-shm）改名隔离为 .corrupt-<时间戳>
 *  3. 依次尝试 backups 目录里最新的备份（auto-* / pre-import-*），
 *     找到第一个能通过健康探测的 → 复制回原路径
 *  4. 全部失败 → 新建空库（应用仍可启动，数据从空开始）
 */
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RecoveryOutcome = 'normal' | 'restored' | 'fresh';

export interface RecoveryResult {
  db: Database.Database;
  outcome: RecoveryOutcome;
  /** 被隔离的损坏文件路径（若有） */
  quarantined?: string;
  /** 恢复时使用的备份文件路径（若有） */
  usedBackup?: string;
  /** 恢复过程中产生的错误信息（诊断用） */
  error?: string;
}

/** 健康探测：quick_check 比 integrity_check 快得多，适合启动期 */
export function probeHealthy(db: Database.Database): boolean {
  try {
    const rows = db.pragma('quick_check') as Array<{ quick_check: string }>;
    return rows.length > 0 && rows[0].quick_check === 'ok';
  } catch {
    return false;
  }
}

/** 尝试打开并校验一个数据库文件；任何一步失败都返回 null（不抛出） */
function tryOpen(dbPath: string): Database.Database | null {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath);
    // 必须先能设置 WAL，否则后续写入会出问题
    db.pragma('journal_mode = WAL');
    if (!probeHealthy(db)) throw new Error('quick_check failed');
    return db;
  } catch {
    try { db?.close(); } catch { /* ignore */ }
    return null;
  }
}

/** 把损坏文件改名隔离（不删除，便于用户事后找回数据） */
function quarantine(dbPath: string): string | null {
  const stamp = Date.now();
  const moved: string[] = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const from = dbPath + suffix;
    if (!fs.existsSync(from)) continue;
    const to = `${dbPath}.corrupt-${stamp}${suffix}`;
    try {
      fs.renameSync(from, to);
      moved.push(to);
    } catch { /* ignore */ }
  }
  return moved.length ? moved[0] : null;
}

/** 备份目录里按新→旧排序的候选备份文件 */
export function listBackupCandidates(backupsDir: string): string[] {
  try {
    return fs.readdirSync(backupsDir)
      .filter((f) => (f.startsWith('auto-') || f.startsWith('pre-import-')) && f.endsWith('.db'))
      .sort()
      .reverse()
      .map((f) => path.join(backupsDir, f));
  } catch {
    return [];
  }
}

/** 强制放弃当前文件，新建空库（迁移失败等场景的最后兜底） */
export function reopenFresh(dbPath: string): RecoveryResult {
  const quarantined = quarantine(dbPath);
  const db = new Database(dbPath);
  return { db, outcome: 'fresh', quarantined: quarantined ?? undefined };
}

/**
 * 打开数据库；文件损坏时自动：隔离 → 从备份恢复 → 或新建空库。
 * 该函数保证返回一个可用的 Database（除非磁盘本身不可写，此时抛出）。
 */
export function openWithRecovery(dbPath: string, backupsDir: string | null): RecoveryResult {
  // 1) 正常路径
  const direct = tryOpen(dbPath);
  if (direct) return { db: direct, outcome: 'normal' };

  const firstError = `主数据库文件无法打开或校验失败: ${dbPath}`;

  // 2) 隔离损坏文件
  const quarantined = quarantine(dbPath);

  // 3) 尝试从备份恢复
  if (backupsDir) {
    for (const candidate of listBackupCandidates(backupsDir)) {
      // 备份文件是完整 SQLite 快照（backup API 产出，无 WAL 依赖），直接复制
      try {
        fs.copyFileSync(candidate, dbPath);
        const restored = tryOpen(dbPath);
        if (restored) {
          return { db: restored, outcome: 'restored', quarantined: quarantined ?? undefined, usedBackup: candidate };
        }
        // 复制出来的也打不开 → 清掉试下一个
        try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
      } catch { /* ignore，试下一个备份 */ }
    }
  }

  // 4) 最后兜底：全新空库
  const db = new Database(dbPath);
  return { db, outcome: 'fresh', quarantined: quarantined ?? undefined, error: firstError };
}
