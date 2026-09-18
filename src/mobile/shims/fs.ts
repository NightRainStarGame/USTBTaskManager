/**
 * node:fs shim（移动端 webview 内运行「主进程逻辑」用）。
 *
 * 设计：一个进程内的内存文件系统（path → Uint8Array）。
 * - 数据库文件由 sql.js 适配器读写，字节落在内存 FS
 * - 持久化：bootstrap 启动时从 IndexedDB 预加载；写入防抖后回存
 *   （见 sqlite3-adapter.ts 的 markDirty 调度）
 * - backup / ics 导出等写文件操作会写进内存 FS——返回的 path 无桌面意义，
 *   Phase 2 再接 Capacitor Filesystem / 分享面板
 */

const files = new Map<string, Uint8Array>();

export function registerFile(path: string, bytes: Uint8Array) {
  files.set(path, bytes);
}

export function listFiles(): Array<[string, Uint8Array]> {
  return Array.from(files.entries());
}

function toBytes(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data === 'object' && typeof data.length === 'number') return new Uint8Array(data);
  throw new Error(`mobile fs shim: 无法写入类型 ${typeof data}`);
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

const fs = {
  existsSync(p: string): boolean {
    return files.has(normalize(p));
  },
  mkdirSync(_p: string, _opts?: any): void {
    /* 内存 FS 无目录概念 */
  },
  readdirSync(dir: string): string[] {
    const d = normalize(dir).replace(/\/$/, '') + '/';
    const names = new Set<string>();
    for (const key of files.keys()) {
      if (key.startsWith(d)) {
        const rest = key.slice(d.length);
        if (rest) names.add(rest.split('/')[0]);
      }
    }
    return Array.from(names);
  },
  readFileSync(p: string): Uint8Array {
    const b = files.get(normalize(p));
    if (!b) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
    return b;
  },
  writeFileSync(p: string, data: any): void {
    files.set(normalize(p), toBytes(data));
  },
  appendFileSync(p: string, data: any): void {
    const prev = files.get(normalize(p));
    const next = toBytes(data);
    if (!prev) { files.set(normalize(p), next); return; }
    const merged = new Uint8Array(prev.length + next.length);
    merged.set(prev); merged.set(next, prev.length);
    files.set(normalize(p), merged);
  },
  renameSync(from: string, to: string): void {
    const b = files.get(normalize(from));
    if (b) { files.set(normalize(to), b); files.delete(normalize(from)); }
  },
  copyFileSync(from: string, to: string): void {
    const b = files.get(normalize(from));
    if (!b) throw new Error(`ENOENT: no such file, copy '${from}'`);
    files.set(normalize(to), b);
  },
  unlinkSync(p: string): void {
    files.delete(normalize(p));
  },
  statSync(p: string): { size: number; isFile(): boolean; isDirectory(): boolean; mtimeMs: number } {
    const b = files.get(normalize(p));
    if (!b) throw new Error(`ENOENT: no such file, stat '${p}'`);
    return { size: b.length, isFile: () => true, isDirectory: () => false, mtimeMs: Date.now() };
  },
  rmSync(_p: string, _opts?: any): void { files.delete(normalize(_p)); },
};

export default fs;
export const {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  appendFileSync, renameSync, copyFileSync, unlinkSync, statSync, rmSync,
} = fs;
