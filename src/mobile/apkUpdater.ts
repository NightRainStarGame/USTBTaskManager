/**
 * v1.2.11：Android APK 自更新。
 *
 * 以前移动端「设置 → 软件更新」只有一行字：不支持应用内更新，自己去 GitHub 下。
 * 于是手机上的 APK 永远停在装的那一天，桌面修的 bug 一个都到不了手机上 ——
 * 这次的 v1.2.10 白屏事故，移动端用户就完全拿不到修复。
 *
 * 现在的链路：
 *   读 latest.json 的 android 字段（GitHub raw → jsDelivr 备援）
 *   → versionCode 与 native BuildConfig 比对
 *   → ApkInstallerPlugin 下载到本地私有目录 + sha256 校验
 *   → FileProvider content:// Uri + ACTION_VIEW 拉起系统安装器
 *
 * 与桌面更新完全隔离：不碰 electron child_process / patch 那套，
 * 因此不会出现「下载进 IndexedDB、安装时抛 spawn 未定义」的经典翻车。
 */
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

const LATEST_SOURCES = [
  'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json',
  'https://cdn.jsdelivr.net/gh/NightRainStarGame/USTBTaskManager@main/latest.json',
];
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

async function fetchJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseAndroid(obj: any, source: string): AndroidUpdateInfo | null {
  const a = obj?.android;
  if (!a || typeof a !== 'object') return null;
  const url = typeof a.url === 'string' && /^https?:\/\//i.test(a.url) ? a.url : null;
  if (!url) return null;
  return {
    version: String(a.version || obj.version || '').replace(/^v/i, ''),
    versionCode: Number(a.versionCode) || 0,
    url,
    mirrors: Array.isArray(a.mirrors) ? a.mirrors.filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u)) : undefined,
    sha256: typeof a.sha256 === 'string' ? a.sha256 : undefined,
    size: typeof a.size === 'number' ? a.size : undefined,
    fileName: typeof a.fileName === 'string' ? a.fileName : undefined,
    page: typeof a.page === 'string' ? a.page : undefined,
    notes: typeof a.notes === 'string' ? a.notes : undefined,
    source,
  };
}

/** 从所有可用源里挑 android.versionCode 最高的那份。 */
export async function fetchAndroidUpdate(): Promise<AndroidUpdateInfo | null> {
  const results = await Promise.allSettled(LATEST_SOURCES.map((u) => fetchJson(u)));
  let best: AndroidUpdateInfo | null = null;

  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const info = parseAndroid(r.value, LATEST_SOURCES[i]);
    if (!info) return;
    if (!best || (info.versionCode || 0) > (best.versionCode || 0)) best = info;
  });

  return best;
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
 * 主地址失败会自动依次尝试 mirrors —— raw.githubusercontent 在某些网络下抽风，
 * 以前这种「下载失败就永远装不上」正是移动端卡在旧版本的主因。
 */
export async function installAndroidApk(info: AndroidUpdateInfo): Promise<InstallResult> {
  const plugin = pick('ApkInstaller');
  if (!plugin || typeof plugin.installApk !== 'function') {
    return { ok: false, reason: 'NO_PLUGIN' };
  }

  const candidates = [info.url, ...(info.mirrors || [])].filter(Boolean);
  let lastReason = 'UNKNOWN';

  for (const url of candidates) {
    try {
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
