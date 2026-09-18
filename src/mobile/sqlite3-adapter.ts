/**
 * better-sqlite3 兼容适配器（底层 sql.js / WASM SQLite）。
 *
 * 用途：Electron 主进程的 db/ipc 逻辑原封不动跑在移动端 webview 里。
 * vite.mobile.config.ts 把 `import Database from 'better-sqlite3'` alias 到本文件。
 *
 * 兼容面（按 electron/db/** 与 electron/ipc/** 的实际用法裁剪）：
 * - new Database(path)          —— 从内存 FS 加载（无则新建）
 * - db.prepare(sql).run(...)    —— 变长位置参数 → { changes, lastInsertRowid }
 * - db.prepare(sql).get(...)    —— 首行对象 | undefined
 * - db.prepare(sql).all(...)    —— 全部行对象
 * - db.exec(sql)                —— 多语句（DDL/迁移）
 * - db.pragma(str)              —— 含 '=' 视为设置（no-op），否则查询返回行
 * - db.close()
 *
 * 持久化：任何写操作把路径标脏 → 防抖 400ms → db.export() 写回内存 FS +
 * IndexedDB。启动时由 bootstrap 预先把 IndexedDB 快照灌进内存 FS。
 */
import initSqlJs from 'sql.js';
// @ts-ignore —— vite ?url 导入 wasm 资源
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import fs, { registerFile, writeFileSync } from './shims/fs';
import { idbGet, idbSet } from './persistence';

type SqlJsDb = any;
type SqlJsStmt = any;

let SQL_LIB: any = null;

/** 初始化 WASM SQLite 运行时（必须在 new Database 之前 await） */
export async function initSqlJsRuntime(): Promise<void> {
  if (SQL_LIB) return;
  SQL_LIB = await initSqlJs({ locateFile: () => sqlWasmUrl as string });
}

// —— 写穿调度（微任务级即时落盘） ——
// 教训：曾用 400ms 防抖 + pagehide 兜底，但页面销毁会杀掉进行中的
// IndexedDB 事务，导致「写完立刻刷新」丢数据。改为每次写后微任务落盘：
// 同一宏任务内的批量写（如导入 187 条事件）自动合并为一次 export。
const dirtyPaths = new Set<string>();
let flushScheduled = false;
const databasesByPath = new Map<string, Set<Database>>();

function markDirty(path: string) {
  dirtyPaths.add(path);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flushDirty();
  });
}

function flushDirty() {
  for (const path of dirtyPaths) {
    const set = databasesByPath.get(path);
    if (!set) continue;
    for (const db of set) {
      if (db.closed) continue;
      try {
        const bytes = db.db.export() as Uint8Array;
        writeFileSync(path, bytes);
        idbSet(`tmfile:${path}`, bytes.slice());
      } catch (e) {
        console.warn('[mobile] 数据库快照写盘失败:', e);
      }
    }
  }
  dirtyPaths.clear();
}

/** 页面隐藏/关闭前强制落盘（移动端 webview 可能随时被杀） */
export function flushNow(): void {
  flushDirty();
}

function toSqlParams(params: any[]): any[] {
  // better-sqlite3 语义：唯一参数是数组 → 视为位置参数列表展开；
  // 唯一参数是普通对象 → 命名参数（sql.js 原生支持）；其余按变长处理
  if (params.length === 1 && Array.isArray(params[0])) params = params[0];
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

class Statement {
  constructor(private owner: Database, private sql: string) {}

  private makeStmt(): SqlJsStmt {
    const stmt = this.owner.db.prepare(this.sql);
    if (!stmt) throw new Error(`sqlite: 无法 prepare: ${this.sql.slice(0, 80)}`);
    return stmt;
  }

  /** 执行写语句，返回 better-sqlite3 风格 info */
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.makeStmt();
    try {
      stmt.run(toSqlParams(params));
      const changes = this.owner.db.getRowsModified() as number;
      const rowid = this.owner.lastInsertRowid();
      this.owner.markDirty();
      return { changes, lastInsertRowid: rowid };
    } finally {
      stmt.free();
    }
  }

  /** 首行；无行返回 undefined（better-sqlite3 语义） */
  get(...params: any[]): Record<string, any> | undefined {
    const stmt = this.makeStmt();
    try {
      stmt.bind(toSqlParams(params));
      if (!stmt.step()) return undefined;
      return stmt.getAsObject() as Record<string, any>;
    } finally {
      stmt.free();
    }
  }

  /** 全部行 */
  all(...params: any[]): Array<Record<string, any>> {
    const stmt = this.makeStmt();
    try {
      stmt.bind(toSqlParams(params));
      const rows: Array<Record<string, any>> = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, any>);
      return rows;
    } finally {
      stmt.free();
    }
  }
}

export class Database {
  /** @internal sql.js 实例（Statement 需要访问） */
  db: SqlJsDb;
  private path: string;
  closed = false;

  constructor(path: string) {
    if (!SQL_LIB) throw new Error('sql.js 未初始化：先 await initSqlJsRuntime()');
    this.path = path;
    const existing = fs.existsSync(path) ? fs.readFileSync(path) : null;
    this.db = existing ? new SQL_LIB.Database(existing) : new SQL_LIB.Database();
    let set = databasesByPath.get(path);
    if (!set) { set = new Set(); databasesByPath.set(path, set); }
    set.add(this);
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.markDirty();
  }

  /** better-sqlite3 的 pragma()：含 '=' 视为设置（内存库 no-op），否则查询 */
  pragma(str: string): any {
    if (str.includes('=')) {
      // journal_mode / synchronous / busy_timeout 等对内存库无意义，静默接受
      return [];
    }
    return new Statement(this, `PRAGMA ${str}`).all();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      const bytes = this.db.export() as Uint8Array;
      writeFileSync(this.path, bytes);
      idbSet(`tmfile:${this.path}`, bytes.slice());
    } catch { /* ignore */ }
    const set = databasesByPath.get(this.path);
    set?.delete(this);
    this.db.close();
  }

  markDirty(): void {
    markDirty(this.path);
  }

  lastInsertRowid(): number {
    const res = this.db.exec('SELECT last_insert_rowid()') as Array<{ values: any[][] }>;
    return Number(res[0]?.values?.[0]?.[0] ?? 0);
  }
}

/** bootstrap 用：把 IndexedDB 里的快照灌回内存 FS（同步可见） */
export async function hydrateMemFsFromIdb(): Promise<number> {
  // 只认已知的 db 命名；future：遍历所有 tmfile: 键
  const candidates = ['/mobile/task-manager.db'];
  let count = 0;
  for (const p of candidates) {
    const bytes = await idbGet(`tmfile:${p}`);
    if (bytes && bytes.length > 0) {
      registerFile(p, bytes);
      count++;
    }
  }
  return count;
}

export default Database;
