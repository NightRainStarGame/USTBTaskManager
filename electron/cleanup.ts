/**
 * v1.1.9 自动清理系统（全方位删除）
 *
 * 生命周期规则（Settings 可调）：
 *  - 完成的作业（status='done'）N 天后进回收站（默认 1 天）
 *  - 完成的任务（project_tasks status='done'）N 天后进回收站（默认 1 天）
 *  - 过期的日程（events，结束时间超过 N 天前；重复系列跳过防误删未来实例）默认 7 天
 *  - 完结的项目（status done/completed）N 天后连带任务进回收站（默认 7 天）
 *  - 上传的作业（云端共享 json）publishedAt 超过 N 天 → GitHub 条目级真删 / 云盘重写过滤快照
 *    （云盘匿名无法删文件，靠接收端 TTL 过滤统一执行，等效删除）默认 7 天
 *  - 回收站快照保留 N 天后真删（默认 30 天）
 *
 * 手动删除（UI 里的删除按钮）同样先入回收站，统一可恢复。
 */
import { ipcMain } from 'electron';
import type { DB } from './db';
import {
  ghFetch, HOMEWORK_DIR, HOMEWORK_BRANCH, mergeBundleFiles, derivePublishCode,
  getAnyShareConfig, normalizeSyncCode, type HomeworkFile,
} from './homework';
import {
  getShareRoot, ensureShareDir, listDir, downloadTextFile, uploadTextFileToDir,
} from './anyshare';

const DAY = 86400000;

export interface CleanupRules {
  enabled: boolean;
  reqDays: number;
  taskDays: number;
  eventDays: number;
  projectDays: number;
  homeworkDays: number;
  binDays: number;
}

const DEFAULT_RULES: CleanupRules = {
  enabled: true, reqDays: 1, taskDays: 1, eventDays: 7, projectDays: 7, homeworkDays: 7, binDays: 30,
};

const K = {
  enabled: 'cleanup_enabled',
  req: 'cleanup_req_days',
  task: 'cleanup_task_days',
  event: 'cleanup_event_days',
  project: 'cleanup_project_days',
  hw: 'cleanup_homework_days',
  bin: 'cleanup_bin_days',
  lastCloud: 'cleanup_last_cloud',
};

function getSetting(db: DB, key: string): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined)?.value ?? '';
}
function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}
function getNum(db: DB, key: string, def: number): number {
  const v = parseInt(getSetting(db, key), 10);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

export function getCleanupRules(db: DB): CleanupRules {
  return {
    enabled: getSetting(db, K.enabled) !== '0',
    reqDays: getNum(db, K.req, DEFAULT_RULES.reqDays),
    taskDays: getNum(db, K.task, DEFAULT_RULES.taskDays),
    eventDays: getNum(db, K.event, DEFAULT_RULES.eventDays),
    projectDays: getNum(db, K.project, DEFAULT_RULES.projectDays),
    homeworkDays: getNum(db, K.hw, DEFAULT_RULES.homeworkDays),
    binDays: getNum(db, K.bin, DEFAULT_RULES.binDays),
  };
}

export function setCleanupRules(db: DB, patch: Partial<CleanupRules>): CleanupRules {
  const cur = getCleanupRules(db);
  const next: CleanupRules = { ...cur, ...patch };
  setSetting(db, K.enabled, next.enabled ? '1' : '0');
  for (const [key, val] of [
    [K.req, next.reqDays], [K.task, next.taskDays], [K.event, next.eventDays],
    [K.project, next.projectDays], [K.hw, next.homeworkDays], [K.bin, next.binDays],
  ] as const) {
    const n = Math.max(0, Math.min(3650, Math.round(Number(val) || 0)));
    setSetting(db, key, String(n));
  }
  return getCleanupRules(db);
}

// ─────────────────────────── 回收站 ───────────────────────────

/** 手动删除入口：行快照进回收站（reason='manual'），由调用方再执行原表 DELETE */
export function binInsert(db: DB, kind: string, rows: Array<Record<string, any>>, reason: string, extra?: unknown) {
  if (!rows.length) return;
  const rules = getCleanupRules(db);
  const purgeAt = Date.now() + rules.binDays * DAY;
  const ins = db.prepare(
    `INSERT INTO recycle_bin (kind, entity_id, snapshot, extra, reason, deleted_at, purge_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((list: Array<Record<string, any>>) => {
    for (const r of list) {
      ins.run(kind, r.id ?? null, JSON.stringify(r), extra ? JSON.stringify(extra) : null, reason, Date.now(), purgeAt);
    }
  });
  tx(rows);
}

/** 手动删除单行（进回收站 + 删原表），供 ipc delete handler 用 */
export function softDeleteRow(db: DB, kind: 'requirement' | 'task' | 'event' | 'project', id: number): boolean {
  const table = { requirement: 'course_requirements', task: 'project_tasks', event: 'events', project: 'projects' }[kind];
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, any> | undefined;
  if (!row) return false;
  let extra: unknown;
  const delTasks = db.prepare('DELETE FROM project_tasks WHERE project_id = ?');
  db.transaction(() => {
    if (kind === 'project') {
      const tasks = db.prepare('SELECT * FROM project_tasks WHERE project_id = ?').all(id);
      if (tasks.length) binInsert(db, 'task', tasks as Array<Record<string, any>>, 'manual:project');
      extra = tasks;
    }
    binInsert(db, kind, [row], 'manual');
    if (kind === 'project') delTasks.run(id);
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  })();
  return true;
}

export interface BinItem {
  id: number;
  kind: string;
  entity_id: number | null;
  title: string;
  reason: string | null;
  deleted_at: number;
  purge_at: number;
}

export function listBin(db: DB, opts?: { kind?: string; limit?: number }): Array<BinItem & { snapshot: Record<string, any> }> {
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 200));
  const rows = (opts?.kind
    ? db.prepare(`SELECT * FROM recycle_bin WHERE kind = ? ORDER BY deleted_at DESC LIMIT ?`).all(opts.kind, limit)
    : db.prepare(`SELECT * FROM recycle_bin ORDER BY deleted_at DESC LIMIT ?`).all(limit)
  ) as Array<{ id: number; kind: string; entity_id: number | null; snapshot: string; reason: string | null; deleted_at: number; purge_at: number }>;
  return rows.map((r) => {
    let snap: Record<string, any> = {};
    try { snap = JSON.parse(r.snapshot); } catch { /* 损坏快照按空处理 */ }
    return {
      id: r.id, kind: r.kind, entity_id: r.entity_id, reason: r.reason,
      deleted_at: r.deleted_at, purge_at: r.purge_at, snapshot: snap,
      title: snap.title || snap.name || `${r.kind} #${r.entity_id ?? '?'}`,
    };
  });
}

const RESTORE_COLS: Record<string, string[]> = {
  requirement: ['course_id', 'title', 'type', 'description', 'due_date', 'priority', 'status', 'estimated_hours', 'actual_hours', 'notes', 'created_at', 'source', 'remote_id', 'session_date', 'publisher', 'completed_at'],
  task: ['project_id', 'course_id', 'title', 'status', 'assignee', 'due_date', 'order_index', 'done_at'],
  event: ['title', 'start_at', 'end_at', 'location', 'recurrence', 'recurrence_end', 'course_id', 'color', 'notes', 'all_day', 'reminder_minutes', 'category_id', 'type'],
  project: ['name', 'description', 'status', 'start_date', 'due_date', 'progress', 'created_at', 'completed_at'],
};

/** 从回收站恢复一条到原表（新 id；remote_id 冲突时忽略插入防 UNIQUE 报错） */
export function restoreFromBin(db: DB, binId: number): { ok: boolean; error?: string; newId?: number } {
  const row = db.prepare('SELECT * FROM recycle_bin WHERE id = ?').get(binId) as
    { id: number; kind: string; snapshot: string; extra?: string | null } | undefined;
  if (!row) return { ok: false, error: '回收站里没有这一条' };
  const table = { requirement: 'course_requirements', task: 'project_tasks', event: 'events', project: 'projects' }[row.kind];
  if (!table) return { ok: false, error: `未知类型 ${row.kind}` };
  const cols = RESTORE_COLS[row.kind];
  if (!cols) return { ok: false, error: `未知类型 ${row.kind}` };
  let snap: Record<string, any> = {};
  try { snap = JSON.parse(row.snapshot); } catch { return { ok: false, error: '快照损坏，无法恢复' }; }

  try {
    const newId = db.transaction(() => {
      // project 先恢复本体拿新 id，extra 里的任务挂到新 project 下
      if (row.kind === 'project') {
        const pCols = RESTORE_COLS.project;
        const pHolder = pCols.map(() => '?').join(', ');
        const pInfo = db.prepare(`INSERT OR IGNORE INTO projects (${pCols.join(', ')}) VALUES (${pHolder})`)
          .run(...pCols.map((c) => snap[c] ?? null));
        const pid = Number(pInfo.lastInsertRowid);
        let extraTasks: Array<Record<string, any>> = [];
        try { extraTasks = row.extra ? JSON.parse(row.extra) : []; } catch { /* 无任务 */ }
        const tCols = RESTORE_COLS.task;
        const tHolder = tCols.map(() => '?').join(', ');
        for (const t of extraTasks) {
          db.prepare(`INSERT OR IGNORE INTO project_tasks (${tCols.join(', ')}) VALUES (${tHolder})`)
            .run(...tCols.map((c) => (c === 'project_id' ? pid : (t[c] ?? null))));
          // 随项目一起删的任务条目一并清出回收站
          if (t.id) db.prepare(`DELETE FROM recycle_bin WHERE kind = 'task' AND entity_id = ?`).run(t.id);
        }
        db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(binId);
        return pid;
      }
      const holder = cols.map(() => '?').join(', ');
      const info = db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${holder})`)
        .run(...cols.map((c) => snap[c] ?? null));
      db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(binId);
      return Number(info.lastInsertRowid);
    })();
    return { ok: true, newId };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 彻底删除回收站条目（单条或全部） */
export function purgeBin(db: DB, binId?: number | null): number {
  if (binId != null) {
    const info = db.prepare('DELETE FROM recycle_bin WHERE id = ?').run(binId);
    return info.changes;
  }
  const info = db.prepare('DELETE FROM recycle_bin').run();
  return info.changes;
}

// ─────────────────────────── 本地自动清理 ───────────────────────────

export interface CleanupReport {
  ranAt: number;
  enabled: boolean;
  skipped?: boolean;
  binned: { requirements: number; tasks: number; events: number; projects: number };
  purgedBin: number;
}

/** 跑一轮本地清理：各类完成/过期数据 → 回收站；回收站到期 → 真删 */
export function runLocalCleanup(db: DB, opts?: { force?: boolean }): CleanupReport {
  const rules = getCleanupRules(db);
  const now = Date.now();
  const report: CleanupReport = {
    ranAt: now, enabled: rules.enabled,
    binned: { requirements: 0, tasks: 0, events: 0, projects: 0 }, purgedBin: 0,
  };
  if (!rules.enabled && !opts?.force) {
    report.skipped = true;
    return report;
  }

  // 完成的作业 → 回收站
  if (rules.reqDays > 0) {
    const cutoff = now - rules.reqDays * DAY;
    const rows = db.prepare(
      `SELECT * FROM course_requirements WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at <= ?`
    ).all(cutoff) as Array<Record<string, any>>;
    if (rows.length) {
      db.transaction(() => {
        binInsert(db, 'requirement', rows, 'auto:completed');
        db.prepare(`DELETE FROM course_requirements WHERE id IN (${rows.map((r) => r.id).join(',')})`).run();
      })();
      report.binned.requirements = rows.length;
    }
  }

  // 完成的任务 → 回收站
  if (rules.taskDays > 0) {
    const cutoff = now - rules.taskDays * DAY;
    const rows = db.prepare(
      `SELECT * FROM project_tasks WHERE status = 'done' AND done_at IS NOT NULL AND done_at <= ?`
    ).all(cutoff) as Array<Record<string, any>>;
    if (rows.length) {
      db.transaction(() => {
        binInsert(db, 'task', rows, 'auto:completed');
        db.prepare(`DELETE FROM project_tasks WHERE id IN (${rows.map((r) => r.id).join(',')})`).run();
      })();
      report.binned.tasks = rows.length;
    }
  }

  // 过期的日程 → 回收站（重复系列跳过：删了会连带未来实例，宁可留着；
  // 教务导入的课表事件 type='class' 跳过：删了会破坏历史周课表展示）
  if (rules.eventDays > 0) {
    const cutoff = now - rules.eventDays * DAY;
    const rows = db.prepare(
      `SELECT * FROM events
       WHERE (recurrence IS NULL OR recurrence = '')
         AND (type IS NULL OR type = '' OR type = 'event')
         AND COALESCE(end_at, start_at) <= ?`
    ).all(cutoff) as Array<Record<string, any>>;
    if (rows.length) {
      db.transaction(() => {
        binInsert(db, 'event', rows, 'auto:expired');
        db.prepare(`DELETE FROM events WHERE id IN (${rows.map((r) => r.id).join(',')})`).run();
      })();
      report.binned.events = rows.length;
    }
  }

  // 完结的项目（连带任务）→ 回收站
  if (rules.projectDays > 0) {
    const cutoff = now - rules.projectDays * DAY;
    const projs = db.prepare(
      `SELECT * FROM projects WHERE status IN ('done','completed') AND completed_at IS NOT NULL AND completed_at <= ?`
    ).all(cutoff) as Array<Record<string, any>>;
    for (const p of projs) {
      const tasks = db.prepare('SELECT * FROM project_tasks WHERE project_id = ?').all(p.id) as Array<Record<string, any>>;
      db.transaction(() => {
        if (tasks.length) binInsert(db, 'task', tasks, 'auto:project');
        binInsert(db, 'project', [p], 'auto:completed', tasks);
        db.prepare('DELETE FROM project_tasks WHERE project_id = ?').run(p.id);
        db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
      })();
      report.binned.projects++;
      report.binned.tasks += tasks.length;
    }
  }

  // 回收站到期 → 真删
  report.purgedBin = (db.prepare('DELETE FROM recycle_bin WHERE purge_at <= ?').run(now) as any).changes;

  return report;
}

// ─────────────────────────── 云端作业清理 ───────────────────────────

export interface CloudCleanupReport {
  ranAt: number;
  codes: string[];
  github: { checked: number; rewritten: number; deleted: number; removedEntries: number; errors: string[] };
  cloud: { checked: number; rewritten: number; removedEntries: number; errors: string[] };
}

/** 收集本机用过的所有同步作业码（settings homework_sync_*） */
function collectSyncCodes(db: DB): string[] {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'homework_sync_%'`).all() as Array<{ key: string; value: string }>;
  const set = new Set<string>();
  for (const r of rows) {
    const c = normalizeSyncCode(r.value || '');
    if (c) set.add(c);
  }
  return Array.from(set);
}

/** 上传的作业云端清理：publishedAt 超过 TTL 的条目从云端移除。
 *  GitHub：GET → 过滤 → PUT 回写；条目删空 → DELETE 文件。
 *  云盘：匿名删不了文件 → 下载合并 → 过滤 → 上传一份新快照（旧快照沉底，接收端 TTL 兜底）。 */
export async function runCloudHomeworkCleanup(db: DB): Promise<CloudCleanupReport> {
  const rules = getCleanupRules(db);
  const cutoff = Date.now() - rules.homeworkDays * DAY;
  const codes = collectSyncCodes(db);
  const report: CloudCleanupReport = {
    ranAt: Date.now(), codes,
    github: { checked: 0, rewritten: 0, deleted: 0, removedEntries: 0, errors: [] },
    cloud: { checked: 0, rewritten: 0, removedEntries: 0, errors: [] },
  };
  if (rules.homeworkDays <= 0 || !codes.length) return report;

  // ── GitHub ──
  let token = '';
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'homework_github_token'").get() as { value?: string } | undefined;
    token = (row?.value || '').trim();
  } catch { /* 无 token 跳过 GitHub */ }

  for (const code of codes) {
    if (!token) break;
    const filePath = `${HOMEWORK_DIR}/${code}.json`;
    try {
      const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, { token });
      report.github.checked++;
      if (r.status === 404) continue;
      if (!r.ok) {
        report.github.errors.push(`${code}: HTTP ${r.status}`);
        continue;
      }
      const meta = JSON.parse(r.text);
      const file = JSON.parse(Buffer.from(meta.content || '', 'base64').toString('utf8')) as HomeworkFile;
      if (!Array.isArray(file.entries)) continue;
      const keep = file.entries.filter((e) => (e?.publishedAt || 0) >= cutoff);
      const removed = file.entries.length - keep.length;
      if (!removed) continue;
      report.github.removedEntries += removed;
      if (keep.length) {
        const putRes = await ghFetch(`/contents/${filePath}`, {
          method: 'PUT', token,
          body: {
            message: `homework-cleanup: [${code}] 移除 ${removed} 条过期条目（TTL ${rules.homeworkDays} 天）`,
            content: Buffer.from(JSON.stringify({ ...file, entries: keep, updatedAt: Date.now() }, null, 2), 'utf8').toString('base64'),
            branch: HOMEWORK_BRANCH,
            sha: meta.sha,
          },
        });
        if (putRes.ok) report.github.rewritten++;
        else report.github.errors.push(`${code}: 回写失败 HTTP ${putRes.status}`);
      } else {
        const delRes = await ghFetch(`/contents/${filePath}`, {
          method: 'DELETE', token,
          body: {
            message: `homework-cleanup: [${code}] 全部条目过期，删除作业包`,
            sha: meta.sha,
            branch: HOMEWORK_BRANCH,
          },
        });
        if (delRes.ok) report.github.deleted++;
        else report.github.errors.push(`${code}: 删除失败 HTTP ${delRes.status}`);
      }
    } catch (e: any) {
      report.github.errors.push(`${code}: ${e?.message || e}`);
    }
  }

  // ── 北科云盘 ──
  const cfg = (() => { try { return getAnyShareConfig(db); } catch { return null; } })();
  if (cfg && cfg.enabled) {
    for (const code of codes) {
      try {
        const root = await getShareRoot(cfg);
        const hwDir = await ensureShareDir(cfg, root.docid, 'homework');
        const pubDir = await ensureShareDir(cfg, hwDir.docid, derivePublishCode(code));
        const { files } = await listDir(cfg, pubDir.docid);
        const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
        if (!jsonFiles.length) continue;
        report.cloud.checked++;
        const bundles: HomeworkFile[] = [];
        for (const f of jsonFiles) {
          try {
            const text = await downloadTextFile(cfg, f, 1024 * 1024);
            const parsed = JSON.parse(text) as HomeworkFile;
            if (parsed && Array.isArray(parsed.entries)) bundles.push(parsed);
          } catch { /* 单文件损坏跳过 */ }
        }
        if (!bundles.length) continue;
        const merged = mergeBundleFiles(bundles, code);
        const keep = (merged.entries || []).filter((e) => (e?.publishedAt || 0) >= cutoff);
        const removed = (merged.entries || []).length - keep.length;
        if (!removed) continue;
        report.cloud.removedEntries += removed;
        // 匿名无法覆盖/删除旧文件 → 写一份过滤后的新快照（接收端 mergeBundleFiles 按 id/三元组去重，
        // 旧快照里的过期条目已被本端 TTL 过滤，不会再回到任何新版客户端）
        const courseKey = (merged.courseKey || code).replace(/[\\/:*?"<>|#%&{}$!'@+`=\s]+/g, '-');
        const newName = `${courseKey}-${Date.now()}.json`;
        const fresh: HomeworkFile = { ...merged, entries: keep, updatedAt: Date.now() };
        await uploadTextFileToDir(cfg, pubDir.docid, newName, JSON.stringify(fresh, null, 2));
        report.cloud.rewritten++;
      } catch (e: any) {
        report.cloud.errors.push(`${code}: ${e?.message || e}`);
      }
    }
  }

  setSetting(db, K.lastCloud, String(Date.now()));
  return report;
}

/** 云端清理自动跑的门限：每天最多一次 */
export function shouldRunCloudCleanup(db: DB): boolean {
  const last = parseInt(getSetting(db, K.lastCloud), 10);
  return !Number.isFinite(last) || Date.now() - last > DAY;
}

// ─────────────────────────── IPC ───────────────────────────

export function registerCleanup(db: DB) {
  ipcMain.handle('cleanup:rules', () => getCleanupRules(db));
  ipcMain.handle('cleanup:setRules', (_e, patch: Partial<CleanupRules>) => setCleanupRules(db, patch || {}));
  ipcMain.handle('cleanup:run', async () => {
    const local = runLocalCleanup(db, { force: true });
    const cloud = await runCloudHomeworkCleanup(db);
    return { local, cloud };
  });
  ipcMain.handle('cleanup:bin', (_e, opts?: { kind?: string; limit?: number }) => listBin(db, opts));
  ipcMain.handle('cleanup:bin:restore', (_e, id: number) => restoreFromBin(db, id));
  ipcMain.handle('cleanup:bin:purge', (_e, id?: number | null) => ({ purged: purgeBin(db, id ?? null) }));
}

/** 启动期 + 每小时定时：本地清理必跑；云端清理每天最多一次 */
export function scheduleAutoCleanup(db: DB) {
  const run = async () => {
    try {
      runLocalCleanup(db);
      if (shouldRunCloudCleanup(db)) {
        await runCloudHomeworkCleanup(db).catch(() => { /* 云端失败不影响本地 */ });
      }
    } catch { /* 清理失败静默，下次再试 */ }
  };
  setTimeout(run, 45 * 1000).unref?.();
  setInterval(run, 60 * 60 * 1000).unref?.();
}
