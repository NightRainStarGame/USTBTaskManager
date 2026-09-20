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
 * 更新源地址优先级：设置项 update_sources（用户在设置页维护的多源列表）
 *                    > 旧版单源设置 update_source > 代码里的 DEFAULT_UPDATE_SOURCES。
 */
import { app, net, shell, ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { DB } from '../db/index';
import {
  parseAnyShareUrl, downloadTextFile, findShareFile, findLatestByPrefix, getFileDownloadUrl,
  type AnyShareConfig,
} from '../anyshare';

/**
 * ⬇️⬇️⬇️ 默认更新源地址（发布新版本时维护这里）⬇️⬇️⬇️
 *
 * 内置两个源。App 启动 / 点「检查更新」时会**同时查所有启用的源**，
 * 取版本号最高的那个来升级，单个源挂掉不影响另一个 —— 相当于双通道备份。
 *
 *   1) StarOS 自建源（nrsc.games）—— 默认主源
 *      清单：https://nrsc.games/downloads/taskmanager/latest.json
 *      安装包与清单托管在同一站点，国内访问稳定，没有 GitHub 的限速 / 断连问题。
 *
 *   2) GitHub / leastversion —— 备用镜像源
 *      清单：https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json
 *      自建站故障时仍能升级；因国内访问 raw.githubusercontent.com 常超时，不作主源。
 *
 * 两个源分别由 scripts/publish-vps.js 与 scripts/publish-github.js 维护，版本号保持一致。
 * 若某个源落后于另一个也不影响升级（聚合时取最高版本）。
 * 用户也可在「设置 → 软件更新 → 更新源」里增删源、切换主源或换成第三方镜像。
 */
/**
 * v1.1.4 起新增第 3 个内置源：
 *
 *   3) 北科云盘（AnyShare 外链 + 提取码）—— 校园网内速度最快
 *      ⚠️ 仅在北京科技大学校园网内可达；不在校园网时该源会超时失败，
 *         不影响其他源（多源并行、取版本最高）。
 *      清单是云盘分享里的 latest.json；清单里 url 字段填**安装包在云盘里的文件名**
 *      （下载时 App 会自动换签成名直链）。
 */
export const DEFAULT_UPDATE_SOURCES: UpdateSource[] = [
  {
    name: 'StarOS / nrsc.games',
    url: 'https://nrsc.games/downloads/taskmanager/latest.json',
    enabled: true,
    primary: true,
  },
  {
    name: 'GitHub / leastversion',
    url: 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json',
    enabled: true,
    primary: false,
  },
  {
    name: '北科云盘（需校园网）',
    url: 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469',
    password: 'kc26',
    type: 'anyshare',
    enabled: true,
    primary: false,
  },
];
export const DEFAULT_UPDATE_SOURCE = DEFAULT_UPDATE_SOURCES[0]?.url || '';

const FETCH_TIMEOUT_MS = 15000;
const MAX_MANIFEST_BYTES = 1024 * 512; // 清单最大 512KB
const SETTING_SOURCES = 'update_sources';          // JSON 数组字符串
const SETTING_ACTIVE_INDEX = 'update_active_index'; // '0' / '1' / '2'…
const SETTING_SOURCES_LEGACY = 'update_source';    // 旧版单字符串，兼容老库
const SETTING_AUTO = 'update_auto_check';
const SETTING_SKIPPED = 'update_skipped_version';
const SETTING_LAST_CHECK = 'update_last_check';

export interface UpdateSource {
  name: string;       // 显示名（如「StarOS / nrsc.games」「北科云盘（需校园网）」）
  url: string;        // 清单地址（latest.json 直链；anyshare 型为外链地址）
  enabled: boolean;   // 是否启用
  primary: boolean;   // 是否为主源（UI 里标"主"）
  /** v1.1.4：'anyshare' = 北科云盘外链（url 为分享链接 + password 提取码）；缺省 'http' */
  type?: 'anyshare' | 'http';
  /** anyshare 型源的提取码 */
  password?: string;
}

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
  /** 单源时是源地址；多源合并时是 `GitHub · 云盘` 之类 */
  source?: string;
  /** 多源模式下：命中的源 index，便于 UI 展示 */
  sourceIndex?: number;
  /** 多源模式下：命中的源 name */
  sourceName?: string;
  checkedAt?: number;
}

/** 多源合并后的统一结果（取所有源中版本最高的那一条） */
export interface UpdateAggregate {
  currentVersion: string;
  ok: boolean;
  /** 是否至少有一个「已启用且填了地址」的源（用来区分「没配源」和「源全都连不上」） */
  anyConfigured: boolean;
  /** 命中的最佳版本（null = 当前就是最新 / 全部失败） */
  winner: UpdateCheckResult | null;
  /** 每个源独立结果（顺序与 sources 一致） */
  perSource: Array<{
    source: UpdateSource;
    result: UpdateCheckResult;
  }>;
  checkedAt: number;
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

/** 把源的 url/type 归一化：能被 parseAnyShareUrl 识别的一律标记为 anyshare 型 */
function normalizeSource(s: any, i: number): UpdateSource {
  const url = String(s?.url || '').trim().slice(0, 2048);
  const asUrl = url ? parseAnyShareUrl(url) : null;
  return {
    name: String(s?.name || `源 ${i + 1}`).slice(0, 40),
    url,
    enabled: s?.enabled !== false,
    primary: s?.primary === true,
    type: asUrl ? 'anyshare' : (s?.type === 'anyshare' ? 'anyshare' : 'http'),
    ...(asUrl || s?.type === 'anyshare' ? { password: String(s?.password || '').trim().slice(0, 64) } : {}),
  };
}

/**
 * v1.1.6 起：把用户的 update_sources 与 DEFAULT_UPDATE_SOURCES 合并
 * - 用户已有源不动
 * - 默认源里 (type, url, password) 三元组**没出现在用户列表里**的新源追加到末尾
 * - 新版加了新默认源 / 改了某个默认源的 url 或 password 时，老用户会自动跟上
 * - 合并后会写回 settings（首启动一次后下次不再写）
 */
function sourceKey(s: UpdateSource): string {
  return `${s.type || 'http'}|${s.url}|${s.password || ''}`;
}

/** 把用户归并/补全的源：第一个 primary = 主源；至少保留 DEFAULT_UPDATE_SOURCES[0] */
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
    } catch { /* fallthrough */ }
  }

  if (!userSources.length) {
    // 兼容旧库：把 update_source（单字符串）当成唯一的一个自定义源
    const legacy = (getSetting(db, SETTING_SOURCES_LEGACY) || '').trim();
    if (legacy) {
      userSources = [normalizeSource({ name: '自定义源（旧版设置）', url: legacy, enabled: true, primary: true }, 0)];
    }
  }

  // 合并：把默认源里新出现的三元组追加到用户列表末尾（用户手动加的源不动）
  if (userSources.length) {
    const userKeys = new Set(userSources.map(sourceKey));
    const toAdd = DEFAULT_UPDATE_SOURCES.filter((s) => !userKeys.has(sourceKey(s)));
    if (toAdd.length) {
      const merged = [
        ...userSources,
        ...toAdd.map((s) => ({ ...s, primary: false })),
      ];
      // 至少有一个 primary
      if (!merged.some((s) => s.primary)) merged[0] = { ...merged[0], primary: true };
      if (db) setSetting(db, SETTING_SOURCES, JSON.stringify(merged));
      return merged;
    }
    return userSources;
  }

  return DEFAULT_UPDATE_SOURCES.map((s) => ({ ...s }));
}

export function setSources(db: DB | null, sources: UpdateSource[]): UpdateSource[] {
  // 归一化：清洗字段；保留 url 为空的草稿（避免被静默吞掉导致 UI 看起来要"重启"）；
  // 仅在所有源 url 都空时回退到默认源；填了 url 的源靠前参与实际拉取。
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

/** 当前激活的主源 index（用户在 Settings 里切换） */
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
  // 切 active 也意味着只有这个标 primary
  const updated = sources.map((s, i) => ({ ...s, primary: i === safe }));
  setSources(db, updated);
  if (db) setSetting(db, SETTING_ACTIVE_INDEX, String(safe));
  return safe;
}

/** 兼容旧 API：返回当前主源 URL */
export function getEffectiveSource(db: DB | null): string {
  const idx = getActiveSourceIndex(db);
  return getSources(db)[idx]?.url || DEFAULT_UPDATE_SOURCES[0]?.url || '';
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

// ===================== 北科云盘源支持（v1.1.4） =====================
/** 源 → AnyShare 配置（url 是外链且填了提取码才可用） */
function anyshareCfgFromSource(src: UpdateSource | undefined | null): AnyShareConfig | null {
  if (!src?.url) return null;
  const parsed = parseAnyShareUrl(src.url);
  if (!parsed) return null;
  if (!src.password) return null;
  return { ...parsed, password: src.password };
}

/** 拉取某源的清单文本：http 型直接 GET；anyshare 型从云盘里下载 latest.json */
/**
 * v1.1.6 起：匿名云盘不能覆盖，uploader 把 latest.json 上传成 "latest-<ts>.json"，
 * 把安装包上传成 "<basename>-<ts>.exe"（末尾段随 ts 变）。App 端先按前缀找修改时间最新的一份，
 * 找不到再回退精确名（兼容老格式 / 用户自己手动传的 latest.json）。
 */
async function fetchManifestText(src: UpdateSource): Promise<string> {
  const cfg = anyshareCfgFromSource(src);
  if (!cfg) return fetchText(src.url);
  const file =
    (await findLatestByPrefix(cfg, 'latest', '.json')) ??
    (await findShareFile(cfg, 'latest.json'));
  if (!file) throw new Error('北科云盘分享里没有 latest.json（请确认发布者已上传）');
  return downloadTextFile(cfg, file, MAX_MANIFEST_BYTES);
}

/**
 * 解析安装包下载地址。清单 url 是 http(s) 直链则原样返回；
 * 是文件名（anyshare 源：清单里 url 填云盘内的文件名）则按前缀找最新一份换签名直链。
 */
async function resolveDownloadUrl(url: string, source?: UpdateSource | null): Promise<string> {
  if (/^https?:\/\//i.test(url)) return url;
  const cfg = anyshareCfgFromSource(source);
  if (!cfg) throw new Error('下载地址无效（需以 http/https 开头，或该源为北科云盘且 url 填文件名）');
  // 安装包：把 url 当 base，按 "<base>-<ts>.<ext>" 前缀找最新；找不到再回退精确名
  const m = url.match(/^(.+?)(\.[^.]+)$/);
  if (m) {
    const base = m[1];
    const ext = m[2];
    const file = (await findLatestByPrefix(cfg, base, ext)) ?? (await findShareFile(cfg, url));
    if (!file) throw new Error(`北科云盘分享里没有安装包「${url}」（也没找到 ${base}-<ts>${ext}），请等发布者上传后再试`);
    return getFileDownloadUrl(cfg, file);
  }
  // 兜底：精确匹配
  const f = await findShareFile(cfg, url);
  if (!f) throw new Error(`北科云盘分享里没有「${url}」，请等发布者上传后再试`);
  return getFileDownloadUrl(cfg, f);
}

// ===================== 检查更新（单源） =====================
/**
 * 检查单个源的更新。
 * opts.sourceIndex 省略则用当前激活源。
 */
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
    return {
      ...base,
      reason: 'not_configured',
      message: '尚未配置更新源地址。',
    };
  }

  let text: string;
  try {
    text = await fetchManifestText(src);
  } catch (e: any) {
    const cfg = anyshareCfgFromSource(src);
    const hint = cfg ? '（北科云盘源：请确认在校园网内、提取码正确、分享里有 latest.json）' : '';
    return { ...base, reason: 'network', message: describeError(e) + hint };
  }

  const manifest = parseManifest(text, src.url);
  if (!manifest) {
    // 能连上但内容不像清单 → 大概率是网盘分享页，退化为「打开发布页」
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
    pageUrl: manifest.page || src.url,
    sha256: manifest.sha256,
    forced: hasUpdate && !!manifest.force,
  };
}

// ===================== 检查更新（多源聚合） =====================
/**
 * 查所有启用的源，挑**版本最高**的更新；任一源失败不影响其他源。
 * 若全部失败，winner = null + perSource 都标记网络/解析错误。
 */
export async function checkAllSources(db: DB | null): Promise<UpdateAggregate> {
  const currentVersion = app.getVersion();
  // 只取一次源列表：checkForUpdate 内部也是按同一个顺序取源，因此下标必须基于这一次的结果。
  // 切勿改回 `getSources(db).indexOf(src)` —— getSources 每次调用都返回全新对象，
  // 对象身份比对恒为 -1，会让每个源都退化成「尚未配置更新源」。
  const all = getSources(db);
  const targets = all
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => source.enabled);

  const checkedAt = Date.now();
  if (db) setSetting(db, SETTING_LAST_CHECK, String(checkedAt));

  // 按下标落位：Promise.all 的完成顺序不定，直接 push 会让 UI 里各源顺序乱跳
  const slots: Array<{ source: UpdateSource; result: UpdateCheckResult } | undefined> = new Array(all.length);
  await Promise.all(targets.map(async ({ source, index }) => {
    const result = await checkForUpdate(db, { sourceIndex: index });
    slots[index] = { source, result };
  }));
  const perSource = slots.filter(
    (e): e is { source: UpdateSource; result: UpdateCheckResult } => !!e
  );

  // 选 winner：所有「有更新」的源里取**版本号最高**的那个。
  // 注意不要按「领先当前版本多少」排序 —— 那样 1.1.0→1.1.5（领先 5 个补丁）会压过
  // 1.1.0→1.2.0（领先 1 个小版本），于是用户装到更低的版本。必须直接比 latestVersion。
  const winner = perSource
    .filter(({ result }) =>
      result.ok &&
      !result.skipped &&
      !!result.latestVersion &&
      compareVersions(result.latestVersion, currentVersion) > 0
    )
    .map(({ result }) => result)
    .sort((a, b) => compareVersions(b.latestVersion!, a.latestVersion!))[0] ?? null;

  const anyConfigured = all.some((s) => s.enabled && !!s.url);
  return { currentVersion, ok: anyConfigured, anyConfigured, winner, perSource, checkedAt };
}

// ===================== 下载安装包 =====================
function pickFileName(url: string, version: string): string {
  // anyshare 源：url 直接就是云盘里的文件名
  if (!/^https?:\/\//i.test(url) && /\.(exe|msi|zip|7z)$/i.test(url)) return url;
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (/\.(exe|msi|zip|7z)$/i.test(base)) return base;
  } catch { /* ignore */ }
  return `TaskManager Setup ${version}.exe`;
}

/**
 * 清理 `%TEMP%\taskmanager-update\` 下的旧安装包，避免多次升级后多个版本堆积
 * （避免「代码堆叠 / 旧版新版混文件」体感）。
 */
function cleanStaleDownloads(): void {
  const dir = path.join(app.getPath('temp'), 'taskmanager-update');
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* 占用中 / 权限不足，跳过 */ }
    }
  } catch { /* 目录不存在，忽略 */ }
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
  sha256?: string | null,
  source?: UpdateSource | null
): Promise<DownloadResult> {
  // 先清掉旧的下载文件，避免多次升级后版本堆积
  cleanStaleDownloads();

  // anyshare 源：url 是云盘里的文件名 → 先换签名直链（10 分钟内有效，够下载）
  let realUrl = url;
  try {
    realUrl = await resolveDownloadUrl(url, source);
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }

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

  ipcMain.handle('update:config', () => {
    const sources = getSources(db);
    const activeIndex = getActiveSourceIndex(db);
    return {
      defaultSources: DEFAULT_UPDATE_SOURCES.map((s) => ({ ...s })),
      sources,
      activeIndex,
      source: sources[activeIndex]?.url || '',         // 兼容旧字段
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

  ipcMain.handle('update:download', (_e, opts: { url: string; version: string; sha256?: string | null; source?: { type?: string; url?: string; password?: string } | null }) =>
    downloadUpdate(opts.url, opts.version, opts.sha256, opts.source as UpdateSource | null | undefined)
  );

  ipcMain.handle('update:cancel', () => {
    downloadAbort?.abort();
    return { ok: true };
  });

  ipcMain.handle('update:install', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: '安装包不存在，请重新下载' };
    // 启动安装程序；用 spawn + detached 确保它能脱离父进程独立运行
    const err = await shell.openPath(filePath);
    if (err) return { ok: false, error: err };
    // 防「代码堆叠 / 旧版新版混文件」：旧应用必须立即退出，让 NSIS 拿到干净的 $INSTDIR。
    // setTimeout 200ms 是给 shell.openPath 留出创建子进程的时间窗。
    // 使用 app.exit 而不是 app.quit：前者同步、强制退出；后者要等异步操作完成。
    setTimeout(() => app.exit(0), 200);
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

  /** 兼容旧 API：替换成单源（视为唯一一个源） */
  ipcMain.handle('update:setSource', (_e, source: string) => {
    const s = String(source || '').trim();
    const sources = setSources(db, [{ name: '自定义源', url: s, enabled: true, primary: true }]);
    setSetting(db as DB, SETTING_ACTIVE_INDEX, '0');
    return { ok: true, source: s, sources };
  });

  /** 新 API：整体保存多源 + 切换主源 */
  ipcMain.handle('update:setSources', (_e, payload: { sources: UpdateSource[]; activeIndex: number }) => {
    const cleaned = setSources(db, payload?.sources || []);
    const safe = Math.max(0, Math.min(payload?.activeIndex ?? 0, cleaned.length - 1));
    setSetting(db as DB, SETTING_ACTIVE_INDEX, String(safe));
    return { ok: true, sources: cleaned, activeIndex: safe };
  });

  ipcMain.handle('update:setActiveSource', (_e, index: number) => {
    const safe = setActiveSourceIndex(db, typeof index === 'number' ? index : 0);
    return { ok: true, activeIndex: safe, sources: getSources(db) };
  });

  ipcMain.handle('update:setAutoCheck', (_e, enabled: boolean) => {
    setSetting(db as DB, SETTING_AUTO, enabled ? '1' : '0');
    return { ok: true, enabled };
  });

  // ===================== v1.1.6 块 4b：增量更新 IPC =====================
  // 延迟加载 patchApply 以保持 index.ts 顶部 import 区干净；它内部有自己的依赖（os/dialog）
  const patchApply = require('./patchApply') as typeof import('./patchApply');
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
    // v1.1.7：补丁 url 兼容「云盘文件名」形态（命名范式 TaskManager-Patch-<from>-to-<to>.zip）
    // 非 http(s) 开头 = 北科云盘内的概念名 → 按前缀找最新一份换签名直链
    let patchUrl = patch.url;
    if (!/^https?:\/\//i.test(patchUrl)) {
      try {
        const sources = getSources(db);
        const src = sources[getActiveSourceIndex(db)];
        patchUrl = await resolveDownloadUrl(patch.url, src);
      } catch (e: any) {
        return { ok: false, error: `解析云盘补丁失败：${e?.message || e}` };
      }
    }
    const entry: import('./patchApply').PatchEntry = {
      fromVersion: patch.fromVersion,
      url: patchUrl,
      sha256: (patch.sha256 || '').toLowerCase(),
      size: patch.size || 0,
      baseAsarSha256: (patch.baseAsarSha256 || '').toLowerCase(),
      appAsarSha256: (patch.appAsarSha256 || '').toLowerCase(),
      createdAt: new Date().toISOString(),
    };
    // 1) 下载补丁 zip
    const dl = await patchApply.downloadPatchZip(entry, (p) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'progress', fileName: `${entry.fromVersion}-patch.zip`, ...p });
      }
    });
    if (!dl.ok) {
      return { ok: false, error: dl.error || '下载补丁失败' };
    }
    // 2) 启动 helper（落新 asar）
    const spawned = patchApply.spawnPatchHelper(dl.path!, entry, { relaunch: true });
    if (!spawned.ok) {
      // helper 启动失败，自动回退全量
      try { fs.unlinkSync(dl.path!); } catch {}
      return { ok: false, error: `helper 启动失败：${spawned.error}` };
    }
    // 3) 通知 UI 即将退出
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:progress', { phase: 'done', fileName: `${entry.fromVersion}-patch.zip`, percent: 100, note: '补丁已落盘，主进程即将退出' });
    }
    // 4) 600ms 后退出，让 UI 有时间渲染最后状态
    setTimeout(() => {
      try { app.exit(0); } catch { /* ignore */ }
    }, 600);
    return { ok: true, helperPid: spawned.pid };
  });

  ipcMain.handle('update:patch:state', () => {
    const r = patchApply.checkPatchStateOnBoot();
    let message: string | undefined;
    if (r.applied) message = '上次补丁已成功应用';
    else if (r.failed) message = `上次补丁未应用：基线或落盘失败（期望 ${r.baseline?.expected.slice(0, 8)}…，实际 ${r.baseline?.actual.slice(0, 8)}…），下次检查更新会走整装`;
    return { ...r, message };
  });
}

/** 启动后静默检查（供 main.ts 调用），查所有源，挑版本最高的，命中时推送给渲染进程 */
export async function autoCheckUpdate(db: DB | null, win: BrowserWindow | null) {
  try {
    if (getSetting(db, SETTING_AUTO) === '0') return;
    const sources = getSources(db).filter((s) => s.enabled);
    if (!sources.length) return;

    const agg = await checkAllSources(db);
    if (agg.winner) {
      // payload 里附上多源结果供 UI 展示（"X 源可用 Y 源失败"）
      // v1.1.4：带 type/password —— 北科云盘源下载安装包时渲染层要凭它换签名直链
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
      }));
      const payload = { ...agg.winner, perSource };
      if (win && !win.isDestroyed()) win.webContents.send('update:available', payload);
    }
  } catch {
    /* 静默失败：启动期不打扰用户 */
  }
}
