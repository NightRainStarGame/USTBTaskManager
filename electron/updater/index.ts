/**
 * 软件更新模块（主进程）
 *
 * 设计目标：不依赖任何特定平台/服务（GitHub Release / 自建 / 网盘分享页均可），
 * 只要提供一个「更新源地址」即可工作。地址可以是：
 *
 *   1) 版本清单 JSON（推荐，可直连下载）
 *      {
 *        "version": "0.3.1",
 *        "notes": "本次更新内容…",
 *        "url": "https://example.com/TaskManager Setup 0.3.1.exe",
 *        "page": "https://pan.xxx.com/s/abcd",      // 可选：发布页/网盘分享页
 *        "sha256": "…",                              // 可选：安装包校验和
 *        "force": false                              // 可选：强制更新
 *      }
 *
 *      兼容字段别名：latest/ver → version，changelog/description → notes，
 *      download/installer → url，pageUrl/website/share → page，hash → sha256
 *
 *   2) 纯文本清单（例如网盘直链里放一个 latest.txt）
 *      第一行或任意位置出现 x.y.z 作为版本号；其余行里以 http 开头的当作下载/发布地址；
 *      剩余文本作为更新说明。
 *
 *   3) 直接给网盘分享页链接 —— 无法自动解析版本时，界面会退化为「打开发布页」按钮，
 *      由用户在浏览器里下载安装包。
 *
 * 更新源地址优先级：设置项 update_source > 代码里的 DEFAULT_UPDATE_SOURCE。
 */
import { app, net, shell, ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DB } from '../db/index';

/**
 * ⬇️⬇️⬇️ 默认更新源地址（发布新版本时填在这里，留空 = 未配置）⬇️⬇️⬇️
 *
 * 当前指向 GitHub 仓库中的版本清单 latest.json（固定地址，每次发版覆盖它即可）：
 *   https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json
 *
 * 安装包本体托管在 GitHub Release 上，由 latest.json 里的 url 字段给出。
 * 若该域名在你的网络环境下不可达，可在「设置 → 软件更新 → 更新源地址」里改成镜像地址
 * （例如 https://cdn.jsdelivr.net/gh/NightRainStarGame/USTBTaskManager@main/latest.json）。
 */
export const DEFAULT_UPDATE_SOURCE =
  'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json';

const FETCH_TIMEOUT_MS = 15000;
const MAX_MANIFEST_BYTES = 1024 * 512; // 清单最大 512KB
const SETTING_SOURCE = 'update_source';
const SETTING_AUTO = 'update_auto_check';
const SETTING_SKIPPED = 'update_skipped_version';

export interface UpdateManifest {
  version: string;
  notes?: string | null;
  url?: string | null;
  page?: string | null;
  sha256?: string | null;
  force?: boolean;
  minVersion?: string | null;
}

export interface UpdateCheckResult {
  ok: boolean;
  /** not_configured | network | parse | unknown */
  reason?: string;
  message?: string;
  configured: boolean;
  currentVersion: string;
  latestVersion?: string | null;
  hasUpdate?: boolean;
  notes?: string | null;
  downloadUrl?: string | null;
  pageUrl?: string | null;
  sha256?: string | null;
  forced?: boolean;
  /** 用户此前选择「忽略此版本」 */
  skipped?: boolean;
  source?: string;
  checkedAt?: number;
}

// ===================== 版本号比较 =====================
function parseVersion(v: string): { nums: number[]; pre: string } | null {
  const m = String(v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([\w.-]+))?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || '' };
}

/** a > b 返回正数，a < b 返回负数，相等返回 0；无法解析时按字符串比较 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // 正式版 > 预发布版（1.0.0 > 1.0.0-beta）
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  return pa.pre.localeCompare(pb.pre);
}

// ===================== 清单解析 =====================
function pick(obj: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

export function parseManifest(text: string, sourceUrl: string): UpdateManifest | null {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

  // 1) JSON 清单
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const j = JSON.parse(raw);
      const obj = Array.isArray(j) ? j[0] : j;
      if (obj && typeof obj === 'object') {
        const version = pick(obj, ['version', 'latest', 'ver', 'tag', 'tag_name']);
        if (version) {
          return {
            version: String(version).replace(/^v/i, '').trim(),
            notes: pick(obj, ['notes', 'changelog', 'description', 'body', 'releaseNotes']),
            url: pick(obj, ['url', 'download', 'downloadUrl', 'installer', 'file']),
            page: pick(obj, ['page', 'pageUrl', 'website', 'share', 'link', 'html_url']),
            sha256: pick(obj, ['sha256', 'hash', 'checksum']),
            force: obj.force === true || obj.force === 1 || obj.force === 'true',
            minVersion: pick(obj, ['minVersion', 'min_version']),
          };
        }
      }
    } catch {
      /* 落到文本解析 */
    }
  }

  // 2) 纯文本清单：抽出版本号 / 链接 / 说明
  const verMatch = raw.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  if (!verMatch) return null;
  const urls = raw.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const downloadUrl = urls.find((u) => /\.(exe|msi|zip|7z|dmg|AppImage)(\?|$)/i.test(u)) || null;
  const otherUrl = urls.find((u) => u !== downloadUrl && u !== sourceUrl) || null;
  const notes = raw
    .split('\n')
    .filter((line) => !/^\s*(version|latest|ver)\s*[:：]/i.test(line))
    .map((line) => line.replace(/https?:\/\/[^\s"'<>)\]]+/g, '').trim())
    .filter(Boolean)
    .join('\n');

  return {
    version: verMatch[1],
    notes: notes || null,
    url: downloadUrl,
    page: otherUrl || sourceUrl,
    sha256: (raw.match(/\b[a-f0-9]{64}\b/i) || [])[0] || null,
    force: /强制更新|force\s*[:：]\s*true/i.test(raw),
    minVersion: null,
  };
}

// ===================== 设置读写 =====================
function getSetting(db: DB | null, key: string): string {
  if (!db) return '';
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value ?? '';
  } catch {
    return '';
  }
}

function setSetting(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getEffectiveSource(db: DB | null): string {
  const fromSettings = (getSetting(db, SETTING_SOURCE) || '').trim();
  return fromSettings || DEFAULT_UPDATE_SOURCE.trim();
}

// ===================== 网络请求 =====================
/** 贴近浏览器的 UA：部分网盘/防盗链服务会对非浏览器 UA 返回 403 */
function userAgent(): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) TaskManager/${app.getVersion()} Chrome/128.0.0.0 Safari/537.36`;
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': userAgent(),
        Accept: 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    const text = await res.text();
    return text.slice(0, MAX_MANIFEST_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

/** 把底层网络异常翻译成人能看懂的话 */
function describeError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/abort/i.test(msg)) return `请求超时（超过 ${Math.round(FETCH_TIMEOUT_MS / 1000)} 秒无响应）`;
  if (/ERR_UNSAFE_PORT/i.test(msg)) return '该端口被浏览器安全策略禁止，请更换端口（如 80 / 443 / 8080）';
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(msg)) return '域名无法解析，请检查更新源地址是否拼写正确';
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/i.test(msg)) return '连接失败：目标拒绝连接（服务未启动或地址/端口不对）';
  if (/ERR_CONNECTION|ECONNRESET|ETIMEDOUT|ERR_TIMED_OUT/i.test(msg)) return '连接失败，网络不可达或服务未响应';
  if (/ERR_CERT|SSL|certificate/i.test(msg)) return 'HTTPS 证书校验失败';
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i.test(msg)) return '当前没有可用的网络连接';
  if (/Failed to fetch/i.test(msg)) return '网络请求失败（地址不可达或被拦截）';
  if (/HTTP 4\d\d/.test(msg)) return `更新源返回 ${msg}（链接可能已失效或需要登录）`;
  if (/HTTP 5\d\d/.test(msg)) return `更新源服务器错误（${msg}）`;
  return msg || '未知错误';
}

// ===================== 检查更新 =====================
export async function checkForUpdate(db: DB | null, opts?: { force?: boolean }): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const source = getEffectiveSource(db);
  const base: UpdateCheckResult = {
    ok: false,
    configured: !!source,
    currentVersion,
    source,
    checkedAt: Date.now(),
  };

  if (!source) {
    return {
      ...base,
      reason: 'not_configured',
      message: '尚未配置更新源地址。填写后即可检查更新（可填版本清单 JSON 直链或网盘分享页）。',
    };
  }

  let text: string;
  try {
    text = await fetchText(source);
  } catch (e: any) {
    return { ...base, reason: 'network', message: describeError(e) };
  }

  const manifest = parseManifest(text, source);
  if (!manifest) {
    // 能连上但内容不像清单 → 大概率是网盘分享页，退化为「打开发布页」
    return {
      ...base,
      ok: true,
      reason: 'parse',
      message: '更新源内容无法识别为版本清单（可能是网盘分享页），可点「打开发布页」在浏览器中查看。',
      latestVersion: null,
      hasUpdate: false,
      pageUrl: source,
      notes: text.slice(0, 400),
    };
  }

  const skipped = getSetting(db, SETTING_SKIPPED).trim() === manifest.version && !opts?.force;
  const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;

  return {
    ...base,
    ok: true,
    configured: true,
    latestVersion: manifest.version,
    hasUpdate,
    skipped,
    notes: manifest.notes,
    downloadUrl: manifest.url,
    pageUrl: manifest.page || source,
    sha256: manifest.sha256,
    forced: hasUpdate && !!manifest.force,
  };
}

// ===================== 下载安装包 =====================
function pickFileName(url: string, version: string): string {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (/\.(exe|msi|zip|7z)$/i.test(base)) return base;
  } catch { /* ignore */ }
  return `TaskManager Setup ${version}.exe`;
}

export interface DownloadResult {
  ok: boolean;
  path?: string;
  size?: number;
  error?: string;
  canceled?: boolean;
}

let downloadAbort: AbortController | null = null;

async function downloadUpdate(
  url: string,
  version: string,
  sha256?: string | null
): Promise<DownloadResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '下载地址无效（需以 http/https 开头）' };

  const dir = path.join(app.getPath('temp'), 'taskmanager-update');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const dest = path.join(dir, pickFileName(url, version));

  const ctrl = new AbortController();
  downloadAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000); // 最长 10 分钟

  const broadcast = (payload: Record<string, unknown>) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', payload);
    }
  };

  try {
    const res = await net.fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent(), Accept: '*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (/text\/html|application\/json/.test(contentType)) {
      throw new Error('该地址返回的是网页/接口数据，不是安装包文件。网盘分享链接通常需要在浏览器中打开下载，请点「打开发布页」。');
    }

    const total = Number(res.headers.get('content-length') || 0);
    if (!res.body) throw new Error('下载响应为空');

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    const reader = (res.body as any).getReader();
    let received = 0;
    let lastTick = 0;

    broadcast({ phase: 'start', fileName: path.basename(dest), total });

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      }
      const now = Date.now();
      if (now - lastTick > 200) {
        lastTick = now;
        broadcast({
          phase: 'progress',
          received,
          total,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });

    const actual = hash.digest('hex');
    if (sha256 && sha256.toLowerCase() !== actual) {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      throw new Error(`安装包校验失败（SHA-256 不匹配）。期望 ${sha256.slice(0, 16)}…，实际 ${actual.slice(0, 16)}…`);
    }

    broadcast({ phase: 'done', received, total, percent: 100, path: dest, sha256: actual });
    return { ok: true, path: dest, size: received };
  } catch (e: any) {
    const aborted = /abort/i.test(String(e?.message || ''));
    return {
      ok: false,
      canceled: aborted,
      error: aborted ? '下载超时或已取消' : describeError(e),
    };
  } finally {
    clearTimeout(timer);
    downloadAbort = null;
  }
}

// ===================== IPC 注册 =====================
export function registerUpdater(db: DB | null) {
  ipcMain.handle('app:info', () => ({
    name: 'TaskManager',
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('update:config', () => ({
    defaultSource: DEFAULT_UPDATE_SOURCE,
    source: getEffectiveSource(db),
    autoCheck: getSetting(db, SETTING_AUTO) !== '0',
    skippedVersion: getSetting(db, SETTING_SKIPPED) || null,
  }));

  ipcMain.handle('update:check', (_e, opts?: { force?: boolean }) => checkForUpdate(db, opts));

  ipcMain.handle('update:download', (_e, opts: { url: string; version: string; sha256?: string | null }) =>
    downloadUpdate(opts.url, opts.version, opts.sha256)
  );

  ipcMain.handle('update:cancel', () => {
    downloadAbort?.abort();
    return { ok: true };
  });

  ipcMain.handle('update:install', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '安装包不存在，请重新下载' };
    const err = await shell.openPath(filePath);
    if (err) return { ok: false, error: err };
    // 安装包已启动：退出当前应用，避免文件占用导致安装失败
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  });

  ipcMain.handle('update:openExternal', async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '地址无效' };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('update:skipVersion', (_e, version: string) => {
    setSetting(db as DB, SETTING_SKIPPED, version || '');
    return { ok: true };
  });

  ipcMain.handle('update:setSource', (_e, source: string) => {
    const s = String(source || '').trim();
    setSetting(db as DB, SETTING_SOURCE, s);
    return { ok: true, source: s };
  });

  ipcMain.handle('update:setAutoCheck', (_e, enabled: boolean) => {
    setSetting(db as DB, SETTING_AUTO, enabled ? '1' : '0');
    return { ok: true, enabled };
  });
}

/** 启动后静默检查（供 main.ts 调用），有新版本时推送给渲染进程 */
export async function autoCheckUpdate(db: DB | null, win: BrowserWindow | null) {
  try {
    if (getSetting(db, SETTING_AUTO) === '0') return;
    if (!getEffectiveSource(db)) return;
    const result = await checkForUpdate(db);
    if (result.ok && result.hasUpdate && !result.skipped) {
      if (win && !win.isDestroyed()) win.webContents.send('update:available', result);
    }
  } catch {
    /* 静默失败：启动期不打扰用户 */
  }
}
