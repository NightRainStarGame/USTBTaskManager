/**
 * 更新源、清单解析、下载、补丁下发
 *
 * v1.2.15 起**只有 SSIO 一种源**：url 带 `ssio+` 前缀的 SSIO 发行服务。
 * 曾经的 GitHub raw / jsDelivr / 北科云盘外链全部下线 —— GitHub 在国内常被 DNS 投毒
 * （本机实测把 raw.githubusercontent.com 解析成 0.0.0.0）、云盘只有校园网可达，
 * 它们不仅帮不上忙，还会让每次「检查更新」白等一个 15s 超时。
 *
 * App 启动或点「检查更新」时并行查所有启用源，挑版本号最高的升级；任一源失败不影响其他源。
 */
import { app, net, shell, ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DB } from '../db/index';
// v1.2.9：改成静态 import。
// 原先用 CJS `require('./patchApply')` 懒加载，在浏览器/WebView（移动端 bundle）里
// 直接抛 `ReferenceError: require is not defined`，阻断移动端启动。
// patchApply 不反向依赖本模块，无循环依赖；其顶层只有定义无副作用，静态引入安全。
import * as patchApply from './patchApply';
import { fetchSsioManifestText, fetchSsioDownloadUrl, isSsioSource, SSIO_PREFIX } from './ssio';
import { SSIO_DEFAULT_BASE, SSIO_BUILTIN_KEY } from '../cloud/ssioClient';

/**
 * 内置更新源。
 *
 * v1.2.15：只剩 SSIO 一个源。
 * 以前挂着 GitHub raw / jsDelivr / 北科云盘做备源，实际收益是负的：
 *   · 它们托管的是**仓库里的静态 latest.json**，而最新数据只在 SSIO 上了 ——
 *     备源即使连上也只会报一个过期的版本号（甚至反过来把用户锁旧版本）；
 *   · 每次检查都要原地等它们超时，表现就是「点检查更新转半天」。
 * 自建 SSIO 国内外都通、还能同一个接口覆盖桌面包与 APK，没必要再留多重镜像。
 */
export const DEFAULT_UPDATE_SOURCES: UpdateSource[] = [
  {
    // SSIO 主源。`ssio+` 前缀由 updater/ssio.ts 识别，
    // password 位置放 APIKey（只有 release:read，没有写权限，泄露也发不了恶意包）。
    name: 'SSIO 官方源',
    url: `${SSIO_PREFIX}${SSIO_DEFAULT_BASE}`,
    password: SSIO_BUILTIN_KEY,
    type: 'ssio',
    enabled: true,
    primary: true,
  },
];
export const DEFAULT_UPDATE_SOURCE = DEFAULT_UPDATE_SOURCES[0]?.url || '';

const FETCH_TIMEOUT_MS = 15000;
const MAX_MANIFEST_BYTES = 1024 * 512;
const SETTING_SOURCES = 'update_sources';
const SETTING_ACTIVE_INDEX = 'update_active_index';
const SETTING_SOURCES_LEGACY = 'update_source';
const SETTING_AUTO = 'update_auto_check';
const SETTING_SKIPPED = 'update_skipped_version';
const SETTING_LAST_CHECK = 'update_last_check';

export interface UpdateSource {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
  /**
   * 'ssio'   = 自建 SSIO 发行源（url 带 `ssio+` 前缀）
   * 'http'   = 直链 GET 一份 latest.json（自建镜像/内网用）
   * v1.2.15：去掉 'anyshare'（北科云盘）—— 只有校园网可达，且它托管的清单早已过时。
   */
  type?: 'http' | 'ssio';
  password?: string;
}

export interface UpdateManifest {
  version: string;
  notes?: string | null;
  url?: string | null;
  /**
   * v1.2.15：SSIO 发行记录 id。有它就能在下载前重新签一条新地址，
   * 清单里的 url 字段可能是引用形式（`ssio:release:<id>`），两者经常成对出现。
   */
  releaseId?: string | null;
  /** v1.2.7 100MB 风险预案：备援下载链接数组（主源挂了 → 依次试下面的镜像） */
  urlMirrors?: string[] | null;
  page?: string | null;
  sha256?: string | null;
  force?: boolean;
  minVersion?: string | null;
  /** v1.3.0：latest.json 的增量补丁清单原样透传 */
  patches?: any[] | null;
  /** v1.3.0：全量包体积（字节） */
  asarSize?: number | null;
  size?: number | null;
  /** v1.2.1 重发场景：app.asar sha256，用于比对当前 asar 哈希判断是否需要重新部署 */
  asarSha256?: string | null;
}

export interface UpdateCheckResult {
  ok: boolean;
  reason?: string;
  message?: string;
  configured: boolean;
  currentVersion: string;
  latestVersion?: string | null;
  hasUpdate?: boolean;
  notes?: string | null;
  downloadUrl?: string | null;
  /** v1.2.7：备援下载链接（按顺序：GitHub Releases → GitHub raw → jsdelivr） */
  downloadUrlMirrors?: string[] | null;
  pageUrl?: string | null;
  sha256?: string | null;
  forced?: boolean;
  skipped?: boolean;
  source?: string;
  sourceIndex?: number;
  sourceName?: string;
  checkedAt?: number;
  /** 拉取该源清单的耗时（毫秒），用于测速展示与同版本择优 */
  latencyMs?: number;
  /** v1.3.0：增量补丁清单透传（UI 据此优先走补丁更新） */
  patches?: any[] | null;
  /** v1.3.0：全量安装包体积（字节） */
  asarSize?: number | null;
  size?: number | null;
  /** v1.2.1 重发场景：透传 app.asar sha256，便于 UI 展示诊断信息 */
  asarSha256?: string | null;
}

export interface UpdateAggregate {
  currentVersion: string;
  ok: boolean;
  anyConfigured: boolean;
  winner: UpdateCheckResult | null;
  perSource: Array<{ source: UpdateSource; result: UpdateCheckResult }>;
  checkedAt: number;
}

function parseVersion(v: string): { nums: number[]; pre: string } | null {
  const m = String(v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([\w.-]+))?$/);
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || '' };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  return pa.pre.localeCompare(pb.pre);
}

function pick(obj: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

export function parseManifest(text: string, sourceUrl: string): UpdateManifest | null {
  const raw = text.replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

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
            releaseId: typeof obj.releaseId === 'string' ? obj.releaseId : null,
            // 镜像既可以是 http 直链，也可以是 ssio:release:<id> / ssio:file:<id> 引用
            urlMirrors: Array.isArray(obj.urlMirrors)
              ? obj.urlMirrors.filter((u: any) => typeof u === 'string' && (/^https?:\/\//i.test(u) || /^ssio:(release|file):/i.test(u)))
              : null,
            page: pick(obj, ['page', 'pageUrl', 'website', 'share', 'link', 'html_url']),
            sha256: pick(obj, ['sha256', 'hash', 'checksum']),
            force: obj.force === true || obj.force === 1 || obj.force === 'true',
            minVersion: pick(obj, ['minVersion', 'min_version']),
            patches: Array.isArray(obj.patches) ? obj.patches : null,
            asarSize: typeof obj.asarSize === 'number' ? obj.asarSize : null,
            size: typeof obj.size === 'number' ? obj.size : null,
          };
        }
      }
    } catch {}
  }

  // 纯文本清单：抽出版本号 / 链接 / 说明
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

function normalizeSource(s: any, i: number): UpdateSource {
  const url = String(s?.url || '').trim().slice(0, 2048);
  return {
    name: String(s?.name || `源 ${i + 1}`).slice(0, 40),
    url,
    enabled: s?.enabled !== false,
    primary: s?.primary === true,
    // v1.2.15：type 只剩 ssio / http。以前还会顺手把 URL 解析成北科云盘外链，
    // 那个分支随云盘一起下线；password 以前只在云盘源上保留，现在 SSIO 也要用它放 APIKey。
    type: s?.type === 'ssio' ? 'ssio' : 'http',
    ...(s?.password ? { password: String(s.password).trim().slice(0, 64) } : {}),
  };
}

/**
 * v1.2.15：判断一个源是否指向**已下线的老通道**（GitHub raw / jsDelivr / 北科云盘）。
 * 它们托管的静态 latest.json 早已不再更新，留着只会白等超时、还把源列表塞得全是死源。
 */
function isObsoleteSource(s: UpdateSource): boolean {
  return /^https?:\/\/(raw\.githubusercontent\.com|github\.com|cdn\.jsdelivr\.net|fastly\.jsdelivr\.net|gcore\.jsdelivr\.net|yunpan\.ustb\.edu\.cn|pan\.ustb\.edu\.cn)/i.test(s.url || '');
}

/**
 * 归一化的源比较键。
 *
 * v1.2.15 修复「更新源里 SSIO 重复一堆」：旧 sourceKey 把 type、url 原文都算差异，
 * 而 type 与 `ssio+` 前缀是后来才引入的 —— 同一个 SSIO 源在存量设置里是
 * `http|http://120.53.9.81:8100|…`，默认源是 `ssio|ssio+http://120.53.9.81:8100|…`，
 * 键不等 → 合并时又追加一份；几轮版本下来重复越积越多。
 * 现在只比「剥掉前缀的 base + 凭据」，同一后端就是同一个源。
 */
function sourceKey(s: UpdateSource): string {
  const base = String(s.url || '')
    .replace(/^ssio\+/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${base}|${(s.password || '').trim()}`;
}

export function getSources(db: DB | null): UpdateSource[] {
  let userSources: UpdateSource[] = [];
  const raw = getSetting(db, SETTING_SOURCES);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) {
        userSources = arr
          .filter((s: any) => s && typeof s.url === 'string' && s.url.trim())
          .map((s: any, i: number) => normalizeSource(s, i));
      }
    } catch {}
  }

  if (!userSources.length) {
    const legacy = (getSetting(db, SETTING_SOURCES_LEGACY) || '').trim();
    if (legacy) {
      userSources = [normalizeSource({ name: '自定义源（旧版设置）', url: legacy, enabled: true, primary: true }, 0)];
    }
  }

  if (userSources.length) {
    // 1) 清退已下线通道的存量源
    const alive = userSources.filter((s) => !isObsoleteSource(s));
    // 2) 按 base+凭据去重；重复时保留「带 ssio+ 前缀 / 启用 / primary」的那份形态
    const deduped: UpdateSource[] = [];
    for (const s of alive) {
      const dup = deduped.find((x) => sourceKey(x) === sourceKey(s));
      if (!dup) {
        deduped.push(s);
      } else {
        if (isSsioSource(s) && !isSsioSource(dup)) {
          deduped[deduped.indexOf(dup)] = { ...s, enabled: dup.enabled || s.enabled, primary: dup.primary || s.primary };
        } else {
          dup.enabled = dup.enabled || s.enabled;
          dup.primary = dup.primary || s.primary;
        }
      }
    }
    // 3) 默认源补充（真正的新后端才会加进来）
    const toAdd = DEFAULT_UPDATE_SOURCES.filter((s) => !deduped.some((x) => sourceKey(x) === sourceKey(s)));
    const merged = [...deduped, ...toAdd.map((s) => ({ ...s, primary: false }))];
    // SSIO 接管 primary（有 SSIO 源就让它当主源）
    const ssioIdx = merged.findIndex((s) => isSsioSource(s));
    if (ssioIdx >= 0) {
      for (let i = 0; i < merged.length; i++) merged[i].primary = i === ssioIdx;
    } else if (!merged.some((s) => s.primary) && merged.length) {
      merged[0].primary = true;
    }
    // 清退/去重真的产生了变化才回写，避免每次读都写
    if (db && (merged.length !== userSources.length || JSON.stringify(merged) !== JSON.stringify(userSources))) {
      setSetting(db, SETTING_SOURCES, JSON.stringify(merged));
    }
    return merged;
  }

  return DEFAULT_UPDATE_SOURCES.map((s) => ({ ...s }));
}

export function setSources(db: DB | null, sources: UpdateSource[]): UpdateSource[] {
  const cleaned = (sources || [])
    .filter((s) => s && typeof s === 'object')
    .map((s: any, i: number) => normalizeSource(s, i));
  const filled = cleaned.filter((s) => s.url);
  const drafts = cleaned.filter((s) => !s.url);
  const ordered = [...filled, ...drafts];
  const final = ordered.length ? ordered : [DEFAULT_UPDATE_SOURCES[0]];
  const hasPrimary = final.some((s) => s.primary);
  if (!hasPrimary) final[0].primary = true;
  if (db) setSetting(db, SETTING_SOURCES, JSON.stringify(final));
  return final;
}

export function getActiveSourceIndex(db: DB | null): number {
  const raw = parseInt(getSetting(db, SETTING_ACTIVE_INDEX), 10);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  const sources = getSources(db);
  const idx = sources.findIndex((s) => s.primary);
  return idx >= 0 ? idx : 0;
}

export function setActiveSourceIndex(db: DB | null, index: number): number {
  const sources = getSources(db);
  const safe = Math.max(0, Math.min(index, sources.length - 1));
  const updated = sources.map((s, i) => ({ ...s, primary: i === safe }));
  setSources(db, updated);
  if (db) setSetting(db, SETTING_ACTIVE_INDEX, String(safe));
  return safe;
}

export function getEffectiveSource(db: DB | null): string {
  const idx = getActiveSourceIndex(db);
  return getSources(db)[idx]?.url || DEFAULT_UPDATE_SOURCES[0]?.url || '';
}

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

/** 拉取某源清单：ssio 型调 API 合成清单（见 updater/ssio.ts）；其余按直链 GET latest.json。 */
async function fetchManifestText(src: UpdateSource): Promise<string> {
  if (isSsioSource(src)) return fetchSsioManifestText(src);
  return fetchText(src.url);
}

/** 挑一个可用的 SSIO 源：优先当前活动源，其次任意启用中的 SSIO 源。 */
  function pickSsioSource(sources: UpdateSource[], preferredIndex: number): UpdateSource | null {
    const ordered: UpdateSource[] = [];
    if (sources[preferredIndex]) ordered.push(sources[preferredIndex]);
    for (let i = 0; i < sources.length; i++) {
      if (i !== preferredIndex && sources[i]?.enabled !== false) ordered.push(sources[i]);
    }
    return ordered.find((s) => isSsioSource(s)) ?? null;
  }

  /**
   * 解析下载地址。
   *
   * v1.2.15：清单里不再直接塞长效 URL，而是记 SSIO 的 id 引用 —— SSIO 的下载链接是
   * **5 分钟过期的签名 URL**（见 updater/ssio.ts），而「早上弹更新、晚上才点安装」
   * 是常态，那时候 URL 早就失效了，表现为「下载失败，重试还是失败」。
   * 所以真正下载前才把引用换成新鲜地址：
   *   https?://…          直链，原样返回（自建 http 镜像仍可用）
   *   ssio:release:<id>  → GET /v1/releases/:id/download（整包）
   *   ssio:file:<id>     → GET /v1/storage/files/:id/download（增量补丁 zip）
   */
  async function resolveDownloadUrl(
    url: string,
    sources: UpdateSource[],
    preferredIndex: number,
  ): Promise<string> {
    const raw = String(url || '').trim();
    if (/^https?:\/\//i.test(raw)) return raw;

    const ref = raw.match(/^ssio:(release|file):([A-Za-z0-9_-]+)$/i);
    if (ref) {
      const picked = pickSsioSource(sources, preferredIndex);
      if (!picked) throw new Error('清单引用了 SSIO 资源，但当前没有可用的 SSIO 更新源');
      return fetchSsioDownloadUrl(picked, ref[1].toLowerCase() === 'release' ? 'release' : 'file', ref[2]);
    }

    const sourceSummary = sources
      .map((s, i) => `${i}:${s?.name || '?'}(type=${s?.type || '?'},enabled=${s?.enabled !== false})`)
      .join(', ');
    // 写诊断日志到临时目录（packaged 模式 stdout 被吞），便于排查清单里的 url 来源
    try {
      const debugLog = path.join(app.getPath('temp'), 'taskmanager-updater-debug.log');
      fs.appendFileSync(
        debugLog,
        `[${new Date().toISOString()}] resolveDownloadUrl 失败 url=${JSON.stringify(raw)} sources=[${sourceSummary}]\n`,
      );
    } catch {}
    throw new Error('下载地址无效（需以 http/https 开头，或写成 ssio:release:<id> / ssio:file:<id>）');
  }

export async function checkForUpdate(
  db: DB | null,
  opts?: { force?: boolean; sourceIndex?: number }
): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  const sources = getSources(db);
  const idx = opts?.sourceIndex ?? getActiveSourceIndex(db);
  const src = sources[idx];
  const base: UpdateCheckResult = {
    ok: false,
    configured: !!src?.url,
    currentVersion,
    source: src?.url,
    sourceIndex: idx,
    sourceName: src?.name,
    checkedAt: Date.now(),
  };

  if (!src?.url) {
    return { ...base, reason: 'not_configured', message: '尚未配置更新源地址。' };
  }

  let text: string;
  const t0 = Date.now();
  try {
    text = await fetchManifestText(src);
  } catch (e: any) {
    return { ...base, reason: 'network', message: describeError(e), latencyMs: Date.now() - t0 };
  }
  const latencyMs = Date.now() - t0;

  const manifest = parseManifest(text, src.url);
  if (!manifest) {
    return {
      ...base,
      ok: true,
      reason: 'parse',
      message: '更新源内容无法识别为版本清单（可能是网盘分享页），可点「打开发布页」在浏览器中查看。',
      latestVersion: null,
      hasUpdate: false,
      pageUrl: src.url,
      notes: text.slice(0, 400),
    };
  }

  const skipped = getSetting(db, SETTING_SKIPPED).trim() === manifest.version && !opts?.force;
  let hasUpdate = compareVersions(manifest.version, currentVersion) > 0;
  // v1.2.1 重发场景：同版本号但 asar 内容不同 → 视为有更新（走 1.2.1→1.2.1 补丁）
  if (!hasUpdate && manifest.version === currentVersion && manifest.asarSha256 && !skipped) {
    const cur = await patchApply.currentAsarSha256();
    if (cur && cur !== manifest.asarSha256.toLowerCase()) {
      hasUpdate = true;
    }
  }

  return {
    ...base,
    ok: true,
    configured: true,
    latestVersion: manifest.version,
    hasUpdate,
    skipped,
    notes: manifest.notes,
    // 清单只给了 releaseId（比如自建 http 镜像同步 SSIO 的 KV 清单）时，
    // 拼成引用交给 resolveDownloadUrl，下载前自然会换成新签名地址
    downloadUrl: manifest.url ?? (manifest.releaseId ? `ssio:release:${manifest.releaseId}` : null),
    downloadUrlMirrors: manifest.urlMirrors ?? null,
    pageUrl: manifest.page || src.url,
    sha256: manifest.sha256,
    forced: hasUpdate && (!!manifest.force || (manifest.version === currentVersion && !!manifest.asarSha256)),
    latencyMs,
    patches: manifest.patches ?? null,
    asarSize: manifest.asarSize ?? null,
    asarSha256: manifest.asarSha256 ?? null,
    size: manifest.size ?? null,
  };
}

/** 查所有启用源，挑版本号最高的更新（同版本取延迟最低的源）；任一源失败不影响其他源 */
export async function checkAllSources(db: DB | null): Promise<UpdateAggregate> {
  const currentVersion = app.getVersion();
  const all = getSources(db);
  const targets = all
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.enabled);

  const checkedAt = Date.now();
  if (db) setSetting(db, SETTING_LAST_CHECK, String(checkedAt));

  // 按下标落位：Promise.all 完成顺序不定，直接 push 会让 UI 顺序乱跳
  const slots: Array<{ source: UpdateSource; result: UpdateCheckResult } | undefined> = new Array(all.length);
  await Promise.all(targets.map(async ({ source, index }) => {
    const result = await checkForUpdate(db, { sourceIndex: index });
    slots[index] = { source, result };
  }));
  const perSource = slots.filter(
    (e): e is { source: UpdateSource; result: UpdateCheckResult } => !!e
  );

  const winner = perSource
    .filter(({ result }) =>
      result.ok &&
      !result.skipped &&
      !!result.latestVersion &&
      compareVersions(result.latestVersion, currentVersion) > 0
    )
    .map(({ result }) => result)
    // 版本号最高者优先；同版本时延迟低（速度更快）的源胜出
    .sort((a, b) =>
      compareVersions(b.latestVersion!, a.latestVersion!) ||
      (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER)
    )[0] ?? null;

  const anyConfigured = all.some((s) => s.enabled && !!s.url);
  return { currentVersion, ok: anyConfigured, anyConfigured, winner, perSource, checkedAt };
}

function pickFileName(url: string, version: string): string {
  if (!/^https?:\/\//i.test(url) && /\.(exe|msi|zip|7z)$/i.test(url)) return url;
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (/\.(exe|msi|zip|7z)$/i.test(base)) return base;
  } catch {}
  return `TaskManager Setup ${version}.exe`;
}

function cleanStaleDownloads(): void {
  const dir = path.join(app.getPath('temp'), 'taskmanager-update');
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  } catch {}
}

export interface DownloadResult {
  ok: boolean;
  path?: string;
  size?: number;
  error?: string;
  canceled?: boolean;
  /** v1.2.7：fallback 链中试过的镜像 URL（用于 UI 展示「已尝试 N 个镜像」） */
  triedMirrors?: string[];
}

let downloadAbort: AbortController | null = null;

/**
 * v1.2.8 块 Q8：ipcSafe — 把所有 ipcMain.handle 包一层 Promise.then().catch()
 * - 任何 handler 抛出的异常都会被捕获，返回统一 {ok:false, error}
 * - 避免渲染进程一侧 IPC 永久 pending（IPC 异常不会触发渲染侧 catch）
 * - 落盘到 LOG_FILE 便于诊断
 */
function ipcSafe<T>(fn: () => Promise<T> | T): Promise<T | { ok: false; error: string }> {
  return Promise.resolve()
    .then(fn)
    .catch((e: any) => {
      try {
        const debugLog = path.join(app.getPath('temp'), 'taskmanager-ipc-error.log');
        fs.appendFileSync(
          debugLog,
          `[${new Date().toISOString()}] ${e?.stack || String(e)}\n`,
        );
      } catch {}
      return { ok: false, error: e?.message || String(e) };
    });
}

async function downloadUpdate(
  url: string,
  version: string,
  sha256?: string | null,
  source?: UpdateSource | null,
  sources?: UpdateSource[],
  preferredIndex?: number,
  mirrors?: string[] | null,
): Promise<DownloadResult> {
  cleanStaleDownloads();

  const allSources = sources && sources.length ? sources : (source ? [source] : []);
  // v1.2.7 100MB 风险预案：按 url → mirrors[0] → mirrors[1] ... 顺序试，任一成功就停
  const candidates = [url, ...((mirrors || []).filter((u) => typeof u === 'string' && u && u !== url))];
  const tried: string[] = [];
  let lastErr = '';
  for (const candidateUrl of candidates) {
    let realUrl: string;
    try {
      realUrl = await resolveDownloadUrl(candidateUrl, allSources, preferredIndex ?? 0);
    } catch (e: any) {
      tried.push(candidateUrl);
      lastErr = e?.message || String(e);
      continue;
    }
    const r = await tryDownloadOnce(realUrl, version, sha256);
    if (r.ok) {
      if (tried.length) r.triedMirrors = tried;
      return r;
    }
    tried.push(candidateUrl);
    lastErr = r.error || '下载失败';
    // 用户主动取消 → 不再 fallback
    if (r.canceled) return r;
  }
  return {
    ok: false,
    error: tried.length > 1
      ? `${lastErr}（已尝试 ${tried.length} 个镜像：${tried.map((u) => new URL(u).hostname).join(' → ')}）`
      : (lastErr || '下载失败'),
    triedMirrors: tried,
  };
}

async function tryDownloadOnce(realUrl: string, version: string, sha256?: string | null): Promise<DownloadResult & { triedMirrors?: string[] }> {
  const dir = path.join(app.getPath('temp'), 'taskmanager-update');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const dest = path.join(dir, pickFileName(realUrl, version));

  const ctrl = new AbortController();
  downloadAbort = ctrl;
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);

  const broadcast = (payload: Record<string, unknown>) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', payload);
    }
  };

  try {
    const res = await net.fetch(realUrl, {
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
      try { fs.unlinkSync(dest); } catch {}
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

export function registerUpdater(db: DB | null) {
  ipcMain.handle('app:info', () => ({
    name: 'TaskManager',
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('update:config', () => {
    const sources = getSources(db);
    const activeIndex = getActiveSourceIndex(db);
    return {
      defaultSources: DEFAULT_UPDATE_SOURCES.map((s) => ({ ...s })),
      sources,
      activeIndex,
      source: sources[activeIndex]?.url || '',
      defaultSource: DEFAULT_UPDATE_SOURCES[0]?.url || '',
      autoCheck: getSetting(db, SETTING_AUTO) !== '0',
      skippedVersion: getSetting(db, SETTING_SKIPPED) || null,
      lastCheckAt: Number(getSetting(db, SETTING_LAST_CHECK)) || 0,
    };
  });

  ipcMain.handle('update:check', (_e, opts?: { force?: boolean; sourceIndex?: number }) =>
    checkForUpdate(db, opts)
  );

  ipcMain.handle('update:checkAll', () => checkAllSources(db));

  ipcMain.handle('update:download', (_e, opts: { url: string; version: string; sha256?: string | null; source?: { type?: string; url?: string; password?: string } | null; mirrors?: string[] | null }) =>
    downloadUpdate(opts.url, opts.version, opts.sha256, opts.source as UpdateSource | null | undefined, getSources(db), getActiveSourceIndex(db), opts.mirrors)
  );

  ipcMain.handle('update:cancel', () => {
    downloadAbort?.abort();
    return { ok: true };
  });

  ipcMain.handle('update:install', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '安装包不存在，请重新下载' };

    // NSIS 静默安装：/S = 无 UI 无交互（不弹目录选择、不点 Install）。
    // 安装路径沿用上一次安装（NSIS 从注册表读 InstallLocation）。
    // detached+unref 让 NSIS 完全独立运行，主进程退出不影响它。
    const { spawn } = await import('node:child_process');
    try {
      const child = spawn(filePath, ['/S'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } catch (e: any) {
      return { ok: false, error: '启动安装包失败：' + (e?.message || e) };
    }

    // NSIS 完成后由 installer.nsh 的 .onInstSuccess 自动拉起新版本 TaskManager.exe
    // 这里把主进程退掉，把 $INSTDIR 留给 NSIS 写新文件
    setTimeout(() => {
      try { app.exit(0); } catch {}
    }, 300);
    return { ok: true, silent: true };
  });

  ipcMain.handle('update:openExternal', async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '地址无效' };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle('update:skipVersion', (_e, version: string) =>
    ipcSafe(() => {
      if (!db) return { ok: false, error: '数据库未初始化' };
      setSetting(db, SETTING_SKIPPED, version || '');
      return { ok: true };
    })
  );

  ipcMain.handle('update:setSource', (_e, source: string) =>
    ipcSafe(() => {
      if (!db) return { ok: false, error: '数据库未初始化' };
      const s = String(source || '').trim();
      const sources = setSources(db, [{ name: '自定义源', url: s, enabled: true, primary: true }]);
      setSetting(db, SETTING_ACTIVE_INDEX, '0');
      return { ok: true, source: s, sources };
    })
  );

  ipcMain.handle('update:setSources', (_e, payload: { sources: UpdateSource[]; activeIndex: number }) =>
    ipcSafe(() => {
      if (!db) return { ok: false, error: '数据库未初始化' };
      const cleaned = setSources(db, payload?.sources || []);
      const safe = Math.max(0, Math.min(payload?.activeIndex ?? 0, cleaned.length - 1));
      setSetting(db, SETTING_ACTIVE_INDEX, String(safe));
      return { ok: true, sources: cleaned, activeIndex: safe };
    })
  );

  ipcMain.handle('update:setActiveSource', (_e, index: number) =>
    ipcSafe(() => {
      if (!db) return { ok: false, error: '数据库未初始化' };
      const safe = setActiveSourceIndex(db, typeof index === 'number' ? index : 0);
      return { ok: true, activeIndex: safe, sources: getSources(db) };
    })
  );

  ipcMain.handle('update:setAutoCheck', (_e, enabled: boolean) =>
    ipcSafe(() => {
      if (!db) return { ok: false, error: '数据库未初始化' };
      setSetting(db, SETTING_AUTO, enabled ? '1' : '0');
      return { ok: true, enabled };
    })
  );

  ipcMain.handle('update:patch:preview', async (_e, manifest: any, currentVersion: string) => {
    const m: import('./patchApply').ManifestLite = manifest && typeof manifest === 'object' ? manifest : {};
    const patch = patchApply.selectPatch(m, currentVersion);
    if (!patch) return { available: false, reason: '当前版本没有可用的增量补丁（请走整装安装）' };
    const cur = await patchApply.currentAsarSha256();
    if (cur && cur !== patch.baseAsarSha256.toLowerCase()) {
      return {
        available: false,
        reason: `基线不对：当前 app.asar sha256=${cur.slice(0, 8)}… 不匹配补丁期望 ${patch.baseAsarSha256.slice(0, 8)}…（可能跨版本跳过了）`,
      };
    }
    return {
      available: true,
      patch: {
        fromVersion: patch.fromVersion,
        toVersion: m.version || '',
        url: patch.url,
        // v1.2.10：把镜像一并返回（前端会原样传回 apply/download）
        urlMirrors: patch.urlMirrors || [],
        sha256: patch.sha256,
        size: patch.size,
        baseAsarSha256: patch.baseAsarSha256,
        appAsarSha256: patch.appAsarSha256,
      },
      sizeMB: +(patch.size / 1024 / 1024).toFixed(2),
      fullSizeMB: +(Number(m.size || 90000000) / 1024 / 1024).toFixed(1),
    };
  });

  ipcMain.handle('update:patch:apply', async (_e, patch: any) => {
    if (!patch || typeof patch.url !== 'string') return { ok: false, error: '补丁参数缺失' };
    // 补丁 url 非 http(s) = 云盘内的概念名 → 按前缀找最新一份换签名直链
    let patchUrl = patch.url;
    if (!/^https?:\/\//i.test(patchUrl)) {
      try {
        const sources = getSources(db);
        patchUrl = await resolveDownloadUrl(patch.url, sources, getActiveSourceIndex(db));
      } catch (e: any) {
        return { ok: false, error: `解析补丁下载地址失败：${e?.message || e}` };
      }
    }
    const entry: import('./patchApply').PatchEntry = {
      fromVersion: patch.fromVersion,
      url: patchUrl,
      urlMirrors: Array.isArray(patch.urlMirrors) ? patch.urlMirrors : [],
      sha256: (patch.sha256 || '').toLowerCase(),
      size: patch.size || 0,
      baseAsarSha256: (patch.baseAsarSha256 || '').toLowerCase(),
      appAsarSha256: (patch.appAsarSha256 || '').toLowerCase(),
      createdAt: new Date().toISOString(),
    };
    const dl = await patchApply.downloadPatchZip(entry, (p) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'progress', fileName: `${entry.fromVersion}-patch.zip`, ...p });
      }
    });
    if (!dl.ok) {
      // v1.2.10：所有源都挂了 → 告诉前端可以改走整装（以前只丢一句「下载补丁失败」）
      return { ok: false, error: dl.error || '下载补丁失败', fallback: dl.fallback, noPatchAvailable: dl.fallback === 'full' };
    }
    const spawned = patchApply.spawnPatchHelper(dl.path!, entry, { relaunch: true });
    if (!spawned.ok) {
      try { fs.unlinkSync(dl.path!); } catch {}
      return { ok: false, error: `helper 启动失败：${spawned.error}` };
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'done', fileName: `${entry.fromVersion}-patch.zip`, percent: 100, note: '补丁已落盘，主进程即将退出' });
    }
    setTimeout(() => {
      try { app.exit(0); } catch {}
    }, 600);
    return { ok: true, helperPid: spawned.pid };
  });

  /* ===== v1.3.0 缓存式补丁更新（zip+json 落 userData/update-cache，设置内一键应用） ===== */

  // 只下载补丁到持久缓存，不退出应用
  ipcMain.handle('update:patch:download', async (_e, patch: any) => {
    if (!patch || typeof patch.url !== 'string') return { ok: false, error: '补丁参数缺失' };
    let patchUrl = patch.url;
    if (!/^https?:\/\//i.test(patchUrl)) {
      try {
        const sources = getSources(db);
        patchUrl = await resolveDownloadUrl(patch.url, sources, getActiveSourceIndex(db));
      } catch (e: any) {
        return { ok: false, error: `解析补丁下载地址失败：${e?.message || e}` };
      }
    }
    const entry: import('./patchApply').PatchEntry = {
      fromVersion: patch.fromVersion,
      url: patchUrl,
      urlMirrors: Array.isArray(patch.urlMirrors) ? patch.urlMirrors : [],
      sha256: (patch.sha256 || '').toLowerCase(),
      size: patch.size || 0,
      baseAsarSha256: (patch.baseAsarSha256 || '').toLowerCase(),
      appAsarSha256: (patch.appAsarSha256 || '').toLowerCase(),
      createdAt: new Date().toISOString(),
    };
    const r = await patchApply.downloadPatchToCache({ ...entry, toVersion: patch.toVersion || '' }, (p) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'progress', fileName: `patch-${entry.fromVersion}-to-${patch.toVersion || 'next'}.zip`, ...p });
      }
    });
    if (!r.ok) return { ok: false, error: r.error || '下载失败' };
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'done', fileName: `patch-${entry.fromVersion}-to-${patch.toVersion || 'next'}.zip`, percent: 100, note: '补丁已下载到本地缓存，可在 设置 → 软件更新 中应用' });
    }
    return { ok: true, state: r.state };
  });

  // 查询补丁缓存状态（设置页展示"已下载的更新"）
  ipcMain.handle('update:patch:cacheState', () => patchApply.readPatchCache());

  // 应用缓存补丁：校验 → helper → relaunch
  ipcMain.handle('update:patch:applyCached', async () => {
    const r = await patchApply.applyCachedPatch();
    if (!r.ok) return r;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'done', fileName: 'patch-cache', percent: 100, note: '补丁已就绪，应用并重启…' });
    }
    setTimeout(() => {
      try { app.exit(0); } catch {}
    }, 600);
    return { ok: true, helperPid: r.helperPid };
  });

  // 清空补丁缓存
  ipcMain.handle('update:patch:clearCache', () => patchApply.clearPatchCache());

  // v1.2.7：用户主动接管 .new 旁路（PatchStateCard 重试按钮触发）
  ipcMain.handle('update:patch:takeoverSidecar', () => {
    const r = patchApply.takeoverSidecarPatch();
    if (!r.ok) return r;
    // 600ms 后主进程退出，让 helper 完成接管
    setTimeout(() => {
      try { app.exit(0); } catch {}
    }, 600);
    return { ok: true, helperPid: r.helperPid };
  });

  ipcMain.handle('update:patch:state', () => {
    const r = patchApply.checkPatchStateOnBoot();
    let message: string | undefined;
    if (r.applied) message = '上次补丁已成功应用';
    else if (r.pendingSidecar) message = r.error
      ? `补丁已留在旁路待接管：${r.error}（重启或点「立即重试补丁」即可完成）`
      : '上次补丁有 .new 旁路残留（helper 启动时会自动接管），如未生效可点「立即重试补丁」';
    // v1.2.10：helper 现在会把真实原因写回状态文件，直接呈现给用户（以前只能看到一句糊涂账）
    else if (r.failed) message = r.error
      ? `上次补丁没装上（${r.reason || 'unknown'}）：${r.error}`
      : `上次补丁未应用：基线或落盘失败（期望 ${r.baseline?.expected.slice(0, 8)}…，实际 ${r.baseline?.actual.slice(0, 8)}…），下次检查更新会走整装`;
    return { ...r, message };
  });
}

/** 启动后静默检查：查所有源，挑版本最高，命中时推送给渲染进程 */
export async function autoCheckUpdate(db: DB | null, win: BrowserWindow | null) {
  try {
    if (getSetting(db, SETTING_AUTO) === '0') return;
    const sources = getSources(db).filter((s) => s.enabled);
    if (!sources.length) return;

    const agg = await checkAllSources(db);
    if (agg.winner) {
      const perSource = agg.perSource.map(({ source, result }) => ({
        name: source.name,
        url: source.url,
        type: source.type,
        password: source.password,
        sourceIndex: result.sourceIndex,
        ok: result.ok,
        latestVersion: result.latestVersion,
        reason: result.reason,
        message: result.message,
        latencyMs: result.latencyMs,
        downloadUrl: result.downloadUrl,
        sha256: result.sha256,
        pageUrl: result.pageUrl,
      }));
      const payload = { ...agg.winner, perSource };
      if (win && !win.isDestroyed()) win.webContents.send('update:available', payload);
    }
  } catch {}
}