/** node:path shim —— 只实现项目用到的子集（POSIX 语义） */

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

export function join(...parts: string[]): string {
  const filtered = parts.filter((p) => p !== '' && p !== undefined && p !== null);
  return normalize(filtered.join('/')).replace(/\/+/g, '/').replace(/\/$/, (m, off, s) => (s === '/' ? '/' : ''));
}

export function dirname(p: string): string {
  const np = normalize(p);
  const i = np.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return np.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const np = normalize(p);
  const base = np.slice(np.lastIndexOf('/') + 1);
  if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}

export function extname(p: string): string {
  const base = basename(normalize(p));
  const i = base.lastIndexOf('.');
  if (i <= 0) return '';
  return base.slice(i);
}

export function resolve(...parts: string[]): string {
  let out = '';
  for (const part of parts) {
    const np = normalize(part);
    if (np.startsWith('/')) out = np;
    else out = out ? `${out}/${np}` : np;
  }
  return out.replace(/\/+/g, '/');
}

export const sep = '/';
export const posix = { join, dirname, basename, extname, resolve, sep };
export default { join, dirname, basename, extname, resolve, sep, posix };
