/**
 * v1.2.11：Android APK 自更新。
 *
 * 以前移动端「设置 → 软件更新」只有一行字：不支持应用内更新，自己去 GitHub 下。
 * 于是手机上的 APK 永远停在装的那一天，桌面修的 bug 一个都到不了手机上 ——
 * 这次的 v1.2.10 白屏事故，移动端用户就完全拿不到修复。
 *
 * 现在的链路（v1.2.15 起只有 SSIO 一个源）：
 *   从 SSIO KV 读 latest.json 的 android 字段
 *   → versionCode 与 native BuildConfig 比对
 *   → android.url 是 ssio:release:<id> 引用，安装前现换签名地址
 *   → ApkInstallerPlugin 下载到本地私有目录 + sha256 校验
 *   → FileProvider content:// Uri + ACTION_VIEW 拉起系统安装器
 *
 * 与桌面更新完全隔离：不碰 electron child_process / patch 那套，
 * 因此不会出现「下载进 IndexedDB、安装时抛 spawn 未定义」的经典翻车。
 */

import { kvGetJson, SSIO_DEFAULT_BASE, SSIO_BUILTIN_KEY } from '../../electron/cloud/ssioClient';

export interface AndroidUpdateInfo {
  version: string;
  versionCode: number;
  url: string;
  mirrors?: string[];
  sha256?: string;
  size?: number;
  fileName?: string;
  page?: string;
  notes?: string;
  /** 命中的清单来源 URL，便于排障 */
  source?: string;
}

export interface ApkUpdateCheck {
  ok: boolean;
  hasUpdate: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latest?: AndroidUpdateInfo | null;
  error?: string;
}

/** v1.2.12：SSIO 主源。服务端 KV 里镜像了一份 latest.json（发版时同步上去），
 *  国内外都能取到，且不受 GitHub raw 缓存影响。 */
const SSIO_LATEST_KEY = 'latest.json';

// v1.2.15：删掉 GitHub raw / jsDelivr 备源 —— 前者在国内被 DNS 投毒（实测解析成
// 0.0.0.0），后者镜像的仓库 latest.json 已不再更新，拉到只会是一个更旧的
// versionCode。备源非但帮不上忙，还可能把用户锁在旧版本上。
const FETCH_TIMEOUT_MS = 12000;

function pick(name: string): any {
  const g = globalThis as any;
  const p = g.Capacitor?.Plugins?.[name] ?? g[name];
  return p && typeof p === 'object' ? p : null;
}

function currentVersionName(): string {
  return String((globalThis as any).__TASKMANAGER_VERSION__ || '0.0.0');
}

/** 语义化版本比较：1.2.11 > 1.2.10，2.0 > 1.99。 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isNewer(latest: AndroidUpdateInfo, currentVersionCode: number): boolean {
  // 优先用 versionCode（整数，唯一可靠），拿不到才退回字符串
  if (Number.isFinite(latest.versionCode) && latest.versionCode > 0) {
    return latest.versionCode > currentVersionCode;
  }
  return compareVersion(latest.version, currentVersionName()) > 0;
}

/** 本机 APK 的 versionCode / versionName（来自 native BuildConfig）。 */
export async function getCurrentVersion(): Promise<{ versionCode: number; versionName: string }> {
  const fallbackName = currentVersionName();
  const plugin = pick('ApkInstaller');
  if (plugin && typeof plugin.currentVersion === 'function') {
    try {
      const r = await plugin.currentVersion();
      if (r && typeof r === 'object') {
        const code = Number(r.versionCode);
        return {
          versionCode: Number.isFinite(code) ? code : 0,
          versionName: String(r.versionName || fallbackName),
        };
      }
    } catch (e) {
      console.warn('[mobile] 读取 native versionCode 失败:', e);
    }
  }
  return { versionCode: 0, versionName: fallbackName };
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把 ssio:release:<id> / ssio:file:<id> 引用换成**新鲜**下载地址。
 *
 * SSIO 的下载链接是 5 分钟过期的签名 URL —— 清单是拉取时缓存的，用户点「安装」
 * 可能晚了好几分钟，直接用清单里的旧地址必 404。所以这一步必须在下载前一刻做。
 *
 * 服务端能拿到签名地址的入口只有两个：
 *   · release → `GET /v1/releases/latest`（每次请求重新签名；**没有**
 *     /v1/releases/:id/download 端点，v1.2.15 曾接错导致下载 404，v1.2.16 修复）
 *   · file    → `GET /v1/storage/files/:id/download`
 */
async function resolveSsioRef(ref: string, expectVersion?: string): Promise<string> {
  const m = ref.match(/^ssio:(release|file):([A-Za-z0-9_-]+)$/i);
  if (!m) throw new Error(`SSIO 引用格式无效：${ref}`);
  const kind = m[1].toLowerCase();
  const apiPath =
    kind === 'release'
      ? '/v1/releases/latest?platform=android&arch=arm64&channel=stable&current=0.0.1&clientId=taskmgr-apk-dl'
      : `/v1/storage/files/${m[2]}/download`;
  const j = await fetchJson(`${SSIO_DEFAULT_BASE}${apiPath}`, {
    accept: 'application/json',
    'X-API-Key': SSIO_BUILTIN_KEY,
  });
  if (kind === 'release' && expectVersion && String(j.version || '') !== String(expectVersion)) {
    throw new Error(`SSIO 最新发行是 ${j.version || '?'}，与清单 ${expectVersion} 不一致（可能被回滚）`);
  }
  if (!j?.url) throw new Error('SSIO 没返回下载地址');
  return String(j.url);
}

/** v1.2.15：清单里的地址既可以是 http(s) 直链，也可以是 ssio:release:<id> / ssio:file:<id> 引用 */
function isUsableUrl(u: unknown): u is string {
  return (
    typeof u === 'string' &&
    (/^https?:\/\//i.test(u) || /^ssio:(release|file):[A-Za-z0-9_-]+$/i.test(u))
  );
}

function parseAndroid(obj: any, source: string): AndroidUpdateInfo | null {
  const a = obj?.android;
  if (!a || typeof a !== 'object') return null;
  const url = isUsableUrl(a.url) ? a.url : null;
  if (!url) return null;
  return {
    version: String(a.version || obj.version || '').replace(/^v/i, ''),
    versionCode: Number(a.versionCode) || 0,
    url,
    mirrors: Array.isArray(a.mirrors) ? a.mirrors.filter((u: any) => isUsableUrl(u)) : undefined,
    sha256: typeof a.sha256 === 'string' ? a.sha256 : undefined,
    size: typeof a.size === 'number' ? a.size : undefined,
    fileName: typeof a.fileName === 'string' ? a.fileName : undefined,
    page: typeof a.page === 'string' ? a.page : undefined,
    notes: typeof a.notes === 'string' ? a.notes : undefined,
    source,
  };
}

export async function fetchAndroidUpdate(): Promise<AndroidUpdateInfo | null> {
  // v1.2.15：只剩 SSIO 一个源（备源的下场见上方 LATEST_SOURCES 注释）
  try {
    const obj = await kvGetJson<any>(SSIO_LATEST_KEY);
    return parseAndroid(obj, 'ssio');
  } catch (e) {
    console.warn('[apk] SSIO 更新清单读取失败:', e);
    return null;
  }
}

export async function checkAndroidUpdate(): Promise<ApkUpdateCheck> {
  const cur = await getCurrentVersion();
  try {
    const latest = await fetchAndroidUpdate();
    if (!latest) {
      return {
        ok: false,
        hasUpdate: false,
        currentVersion: cur.versionName,
        currentVersionCode: cur.versionCode,
        error: '清单里没有 android 安装包信息',
      };
    }
    return {
      ok: true,
      hasUpdate: isNewer(latest, cur.versionCode),
      currentVersion: cur.versionName,
      currentVersionCode: cur.versionCode,
      latest,
    };
  } catch (e) {
    return {
      ok: false,
      hasUpdate: false,
      currentVersion: cur.versionName,
      currentVersionCode: cur.versionCode,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type InstallResult =
  | { ok: true }
  | { ok: false; reason: 'NEED_INSTALL_PERMISSION' | 'NO_PLUGIN' | string };

/**
 * 下载并安装（原生侧负责下载 + sha256 校验 + 拉起安装界面）。
 *
 * v1.2.15：清单里的地址多是 ssio: 引用 —— 安装前先现签一条新鲜 URL
 * （签名 5 分钟过期，见 resolveSsioRef）。多个候选依次尝试。
 */
export async function installAndroidApk(info: AndroidUpdateInfo): Promise<InstallResult> {
  const plugin = pick('ApkInstaller');
  if (!plugin || typeof plugin.installApk !== 'function') {
    return { ok: false, reason: 'NO_PLUGIN' };
  }

  const candidates = [info.url, ...(info.mirrors || [])].filter(Boolean);
  let lastReason = 'UNKNOWN';

  for (const raw of candidates) {
    try {
      const url = /^ssio:/i.test(raw) ? await resolveSsioRef(raw, info.version) : raw;
      const r = await plugin.installApk({ url, sha256: info.sha256 || '' });
      if (r && r.ok === true) return { ok: true };
      lastReason = String(r?.reason || 'UNKNOWN');
      // 需要用户授权时就不必再换源重试了
      if (lastReason === 'NEED_INSTALL_PERMISSION') return { ok: false, reason: lastReason };
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
    }
  }

  return { ok: false, reason: lastReason };
}

/** 是否已获得「安装未知应用」授权。 */
export async function canInstallPackages(): Promise<boolean> {
  const plugin = pick('ApkInstaller');
  if (!plugin || typeof plugin.canRequestInstalls !== 'function') return false;
  try {
    const r = await plugin.canRequestInstalls();
    return r?.allowed === true;
  } catch {
    return false;
  }
}

/** 跳到系统的「允许安装未知应用」开关页。 */
export async function openInstallPermissionSettings(): Promise<void> {
  const plugin = pick('ApkInstaller');
  if (!plugin || typeof plugin.openInstallSettings !== 'function') return;
  try {
    await plugin.openInstallSettings();
  } catch (e) {
    console.warn('[mobile] 打开安装授权设置页失败:', e);
  }
}
