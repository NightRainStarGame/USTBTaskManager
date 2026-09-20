import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DB } from '../db/index';
import {
  parseAnyShareUrl, downloadTextFile, findShareFile, findLatestByPrefix,
  type AnyShareConfig,
} from '../anyshare';
import { getSources, type UpdateSource } from '../updater/index';

function getSetting(db: DB | null, key: string): string {
  if (!db) return '';
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value || '';
}
function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

const KEY_PULLED_AT = 'about_last_pulled_at';
const KEY_SHA = 'about_last_sha256';
const KEY_SOURCE = 'about_last_source';
const KEY_PINNED = 'about_pinned_local';

const MAX_ABOUT_BYTES = 512 * 1024;

export function aboutUrlForSource(src: UpdateSource): string {
  if (src.type === 'anyshare' || /^https?:\/\/(yunpan|anyshare|share)\./i.test(src.url) || /\/link\/[A-Z0-9]{20,}/i.test(src.url)) {
    return src.url;
  }
  if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(src.url)) {
    return src.url.replace(/\/[^/]+\.json(\?[^#]*)?$/i, '/about.txt$1');
  }
  if (/\/latest\.json(\?[^#]*)?$/i.test(src.url)) {
    return src.url.replace(/\/latest\.json(\?[^#]*)?$/i, '/about.txt$1');
  }
  return src.url.replace(/\/?$/, '/about.txt');
}

async function fetchFromHttp(url: string, timeoutMs = 8000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_ABOUT_BYTES) throw new Error('about.txt 超过 512KB 上限');
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function fetchFromCloud(src: UpdateSource): Promise<string> {
  const cfg = anyshareCfgFromSource(src);
  if (!cfg) throw new Error('云盘源配置缺失');
  const file =
    (await findLatestByPrefix(cfg, 'about', '.txt')) ??
    (await findShareFile(cfg, 'about.txt'));
  if (!file) throw new Error('云盘分享里没有 about.txt');
  return downloadTextFile(cfg, file, MAX_ABOUT_BYTES);
}

function anyshareCfgFromSource(src: UpdateSource): AnyShareConfig | null {
  if (src.type !== 'anyshare') return null;
  const parsed = parseAnyShareUrl(src.url);
  if (!parsed) return null;
  const m = src.url.match(/[?&]password=([^&]+)/);
  const urlPwd = m ? decodeURIComponent(m[1]) : '';
  return {
    baseUrl: parsed.baseUrl,
    linkId: parsed.linkId,
    password: src.password || urlPwd,
  };
}

export function aboutCachePath(): string {
  return path.join(app.getPath('userData'), 'about.txt');
}

function readCache(): { text: string; mtimeMs: number } | null {
  const p = aboutCachePath();
  try {
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    return { text: fs.readFileSync(p, 'utf8'), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function writeCache(text: string): number {
  const p = aboutCachePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
  return fs.statSync(p).mtimeMs;
}

function shortUrl(u: string): string {
  return u.length > 48 ? u.slice(0, 45) + '…' : u;
}

async function pullOne(src: UpdateSource): Promise<{ text: string; sha256: string; source: string }> {
  const text = src.type === 'anyshare'
    ? await fetchFromCloud(src)
    : await fetchFromHttp(aboutUrlForSource(src));
  const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
  return { text, sha256, source: `${src.name || src.type}（${shortUrl(src.url)}）` };
}

export async function refreshAbout(db: DB | null): Promise<{
  ok: boolean;
  source?: string;
  sha256?: string;
  size?: number;
  pulledAt?: number;
  error?: string;
  results: Array<{ source: string; ok: boolean; error?: string; sha256?: string; size?: number }>;
}> {
  const sources = getSources(db).filter((s) => s.enabled);
  const results: Array<{ source: string; ok: boolean; error?: string; sha256?: string; size?: number }> = [];
  if (!sources.length) {
    return { ok: false, error: '没有启用的更新源（设置 → 软件更新）', results };
  }
  const settled = await Promise.allSettled(sources.map(pullOne));
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const label = `${sources[i].name || sources[i].type}（${shortUrl(sources[i].url)}）`;
    if (s.status === 'fulfilled') {
      results.push({ source: label, ok: true, sha256: s.value.sha256, size: s.value.text.length });
    } else {
      results.push({ source: label, ok: false, error: String((s.reason as Error)?.message || s.reason) });
    }
  }
  const okOnes = settled.filter((s) => s.status === 'fulfilled') as PromiseFulfilledResult<{ text: string; sha256: string; source: string }>[];
  if (!okOnes.length) {
    return { ok: false, error: '所有源拉取失败（沿用本地缓存）', results };
  }
  const cached = readCache();
  const cachedSha = cached ? crypto.createHash('sha256').update(cached.text, 'utf8').digest('hex') : null;
  const newer = okOnes.find((o) => o.value.sha256 !== cachedSha);
  const chosen = newer ?? okOnes[0];

  const isPinned = db ? getSetting(db, KEY_PINNED) === '1' : false;
  if (isPinned) {
    return {
      ok: true,
      source: chosen.value.source + '（已锁定本地，未写入）',
      sha256: chosen.value.sha256,
      size: chosen.value.text.length,
      pulledAt: Date.now(),
      results,
    };
  }

  writeCache(chosen.value.text);
  if (db) {
    setSetting(db, KEY_PULLED_AT, String(Date.now()));
    setSetting(db, KEY_SHA, chosen.value.sha256);
    setSetting(db, KEY_SOURCE, chosen.value.source);
  }
  return {
    ok: true,
    source: chosen.value.source,
    sha256: chosen.value.sha256,
    size: chosen.value.text.length,
    pulledAt: Date.now(),
    results,
  };
}

export function getAboutCache(db: DB | null): {
  text: string;
  source?: string;
  sha256?: string;
  pulledAt?: number;
  pinned: boolean;
  mtimeMs?: number;
} {
  const c = readCache();
  const text = c?.text ?? defaultAboutText();
  const meta = {
    source: db ? getSetting(db, KEY_SOURCE) || undefined : undefined,
    sha256: db ? getSetting(db, KEY_SHA) || undefined : undefined,
    pulledAt: db ? Number(getSetting(db, KEY_PULLED_AT)) || undefined : undefined,
    pinned: db ? getSetting(db, KEY_PINNED) === '1' : false,
    mtimeMs: c?.mtimeMs,
  };
  return { text, ...meta };
}

export function saveAboutLocal(db: DB | null, text: string): { ok: boolean; sha256?: string; size?: number; error?: string } {
  if (text.length > MAX_ABOUT_BYTES) return { ok: false, error: '内容超过 512KB 上限' };
  try {
    writeCache(text);
    const sha256 = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (db) {
      setSetting(db, KEY_SHA, sha256);
      setSetting(db, KEY_SOURCE, '本地编辑');
      setSetting(db, KEY_PULLED_AT, String(Date.now()));
    }
    return { ok: true, sha256, size: text.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export function setAboutPinned(db: DB | null, pinned: boolean): void {
  if (!db) return;
  setSetting(db, KEY_PINNED, pinned ? '1' : '0');
}

export function defaultAboutText(): string {
  return [
    '# 关于 TaskManager',
    '',
    '一款面向学生 / 研究生的桌面端任务管理工具，把课表 / 作业 / 项目 / 日历装进同一个霓虹宇宙。',
    '',
    '## 技术栈',
    '',
    '- **渲染层**：Electron 33 · Vite 5 · React 18 · TypeScript',
    '- **数据层**：better-sqlite 11（密码哈希 / 课程 / 作业 / 设置全在本机，一行不上云）',
    '- **UI**：Tailwind + 自研霓虹主题（深空黑 / 霓虹绿 / 樱花 / 极光）',
    '- **更新**：多源并行（GitHub + 北科云盘），增量补丁协议',
    '- **作业同步**：双码制（syncCode + publishCode，HMAC-SHA256 派生）+ 同名同老师自动挂载',
    '',
    '## 开发者',
    '',
    '豆芽 · Lasarac',
    '',
    '## 关于本页',
    '',
    '这份文本会从所有启用的更新源自动同步到本地（首次启动写入 `%APPDATA%/task-manager/about.txt`），',
    '你也可以在「设置 → 关于」直接编辑保存，勾选「锁定本地」可防止下次启动被云端覆盖。',
    '',
    '要全网同步更新：编辑仓库根 `about.txt` → `git commit && git push`，',
    '所有用户下一次启动（或点「立即拉取最新」）就会生效。',
  ].join('\n');
}

export function registerAboutIpc(db: DB) {
  ipcMain.handle('about:get-cache', () => getAboutCache(db));
  ipcMain.handle('about:refresh', async () => refreshAbout(db));
  ipcMain.handle('about:save-local', (_e, text: string) => saveAboutLocal(db, text));
  ipcMain.handle('about:set-pinned', (_e, pinned: boolean) => {
    setAboutPinned(db, !!pinned);
    return { ok: true, pinned: !!pinned };
  });
  ipcMain.handle('about:cache-path', () => aboutCachePath());
  ipcMain.handle('about:open-cache', () => {
    shell.showItemInFolder(aboutCachePath());
    return { ok: true };
  });
}