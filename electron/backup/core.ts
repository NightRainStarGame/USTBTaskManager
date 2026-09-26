/**
 * 备份核心逻辑（纯函数，不依赖 Electron）——便于用 Node 直接做单元/端到端测试。
 * Electron 相关（对话框、IPC、自动备份目录）在 ./index.ts。
 */
import type { Database } from 'better-sqlite3';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

export const BACKUP_FORMAT = 'taskmanager-backup';
export const BACKUP_VERSION = 1;

/** 备份包含的表，按「依赖在前」的恢复顺序排列 */
export const BACKUP_TABLES = [
  'courses',
  'categories',
  'course_requirements',
  'course_notes',
  // v1.2.10：course_miniprograms 随小程序模块移除，不再参与备份/恢复

  'events',
  'projects',
  'project_tasks',
  'user_profiles',
  // v1.2.3 新模块（依赖 courses / 自身层级）
  'grades',
  'exams',
  'pomodoro_sessions',
  'habits',
  'habit_checkins',
  'attendance',
  'group_lists',
  'group_list_items',
  'settings',
] as const;

export interface BackupPayload {
  format: string;
  version: number;
  appVersion: string;
  exportedAt: number;
  tables: Record<string, Record<string, any>[]>;
  counts: Record<string, number>;
  checksum: string;
}

export interface BackupTableStats {
  integrity: string;
  foreignKeyViolations: number;
  journalMode: string;
  tables: Record<string, number>;
  dbSizeBytes: number;
}

// ===== 基础工具 =====

export function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

/** 读取表的真实列名（白名单，用于过滤备份文件里的非法列） */
export function tableColumns(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 读取表的全部行 */
export function readTable(db: Database, table: string): Record<string, any>[] {
  return db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, any>[];
}

// ===== 导出 =====

/** 序列化整个数据库（用户表 + 设置）为备份 payload */
export function buildPayload(db: Database, appVersion: string): BackupPayload {
  const tables: Record<string, Record<string, any>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = readTable(db, t);
    counts[t] = tables[t].length;
  }
  const checksum = sha256(JSON.stringify(tables));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion,
    exportedAt: Date.now(),
    tables,
    counts,
    checksum,
  };
}

/** 原子写：先写临时文件再改名，避免写一半断电产生截断文件 */
export function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// ===== 校验 =====

export interface ValidateResult {
  ok: boolean;
  error?: string;
  payload?: BackupPayload;
}

/** 校验备份文件内容：格式 / 版本 / 表结构 / 校验和 */
export function validatePayload(raw: any): ValidateResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: '文件不是有效的 JSON 对象' };
  if (raw.format !== BACKUP_FORMAT) return { ok: false, error: `文件格式不匹配（期望 ${BACKUP_FORMAT}）` };
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本过高（v${raw.version}），当前应用仅支持 v${BACKUP_VERSION}，请先升级应用` };
  }
  if (!raw.tables || typeof raw.tables !== 'object') return { ok: false, error: '备份缺少 tables 数据' };
  if (typeof raw.checksum !== 'string') return { ok: false, error: '备份缺少校验和' };

  // 表白名单检查（多余表报错，防篡改）
  for (const key of Object.keys(raw.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(key)) {
      return { ok: false, error: `备份中包含未知表「${key}」，文件可能被篡改` };
    }
    if (!Array.isArray(raw.tables[key])) {
      return { ok: false, error: `表「${key}」数据损坏（不是数组）` };
    }
  }
  if (!raw.tables.courses) return { ok: false, error: '备份缺少核心表 courses' };

  // 行结构检查：每行必须是 plain object
  for (const t of BACKUP_TABLES) {
    if (!raw.tables[t]) continue;
    for (const row of raw.tables[t]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, error: `表「${t}」中存在损坏的行` };
      }
    }
  }

  // 校验和检查（防篡改 / 防截断）
  const actual = sha256(JSON.stringify(raw.tables));
  if (actual !== raw.checksum) {
    return { ok: false, error: '校验和不匹配：文件被篡改或在传输中损坏' };
  }

  return { ok: true, payload: raw as BackupPayload };
}

// ===== 恢复 =====

/**
 * 在单个事务内恢复备份：
 * 1. 先删现有数据（子表在前，避免 FK 约束失败）
 * 2. 按依赖顺序插回（父表在前）
 * 3. 校正 sqlite_sequence，保证新数据自增 id 不冲突
 * 任何一步失败整体回滚。
 */
export function restorePayload(db: Database, payload: BackupPayload): Record<string, number> {
  const restored: Record<string, number> = {};

  // 预编译各表的列白名单
  const colWhitelist = new Map<string, string[]>();
  for (const t of BACKUP_TABLES) colWhitelist.set(t, tableColumns(db, t));

  db.transaction(() => {
    // 1. 清空（反依赖顺序）
    const deleteOrder = [...BACKUP_TABLES].reverse();
    for (const t of deleteOrder) {
      db.prepare(`DELETE FROM "${t}"`).run();
    }

    // 2. 插回（依赖顺序）
    for (const t of BACKUP_TABLES) {
      const rows = payload.tables[t];
      if (!rows || rows.length === 0) { restored[t] = 0; continue; }
      const cols = colWhitelist.get(t)!;
      let count = 0;
      for (const row of rows) {
        // 只取真实存在的列，防止恶意列名注入
        const useCols: string[] = [];
        const useVals: any[] = [];
        for (const c of cols) {
          if (c in row) { useCols.push(c); useVals.push(row[c]); }
        }
        if (useCols.length === 0) continue;
        const placeholders = useCols.map(() => '?').join(', ');
        const colSql = useCols.map((c) => `"${c}"`).join(', ');
        db.prepare(`INSERT INTO "${t}" (${colSql}) VALUES (${placeholders})`).run(...useVals);
        count++;
      }
      restored[t] = count;
    }

    // 3. 校正自增序列（保留原 id 的同时让后续插入不冲突）
    for (const t of BACKUP_TABLES) {
      if (t === 'settings') continue; // TEXT 主键，无自增
      const cols = colWhitelist.get(t)!;
      if (!cols.includes('id')) continue;
      const max = (db.prepare(`SELECT MAX(id) AS m FROM "${t}"`).get() as any).m;
      db.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(t);
      if (max != null) {
        db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`).run(t, max);
      }
    }
  })();

  return restored;
}

// ===== 完整性检查 =====

export function checkIntegrity(db: Database, dbPath?: string): BackupTableStats {
  const integrity = (db.pragma('integrity_check') as Array<{ integrity_check: string }>)[0]?.integrity_check ?? 'unknown';
  const fk = db.pragma('foreign_key_check') as any[];
  // journal_mode 读取时返回 [{ journal_mode: 'wal' }] 形式
  const jm: any = db.pragma('journal_mode');
  const journal = Array.isArray(jm) ? String(jm[0]?.journal_mode ?? 'unknown') : String(jm || 'unknown');
  const tables: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as any).c;
  }
  let dbSizeBytes = 0;
  if (dbPath) {
    try { dbSizeBytes = fs.statSync(dbPath).size; } catch { /* ignore */ }
  }
  return { integrity, foreignKeyViolations: fk.length, journalMode: journal, tables, dbSizeBytes };
}
