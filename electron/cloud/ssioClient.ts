/**
 * v1.2.12：TaskManager 统一云后端客户端（SSIO）。
 *
 * 背景：v1.2.11 及以前，班级走 GitHub API、作业同步走 GitHub 数据仓 + 北科云盘、
 * 更新走 GitHub raw + 云盘。三套后端各有各的坑：
 *   · GitHub：国内访问不稳定（豆芽机器上 hosts 被劫持时直接连不上）、
 *     Contents API 匿名 60 次/h 限速、内置 PAT 有泄漏爆炸半径
 *   · 北科云盘：仅校园网可达，匿名外链还删不掉旧文件
 *   · 移动端：AnyShare 走 node:https（shim 抛错）根本不可用
 *
 * SSIO 是自托管 BaaS，一个后端覆盖「对象存储 + 发行 + KV」，国内外都能连，
 * 且移动端 WebView 用 fetch 就能直连。所以 v1.2.12 把它立为**所有云能力的主源**，
 * GitHub / 云盘降为备源。
 *
 * 数据模型：KV（key → JSON 文本，带 version 乐观锁）。
 * 班级 / 作业的文件路径协议（class/<code>/manifest.json、homework/<code>.json）
 * 原样保留，只是把「读写哪个后端」换掉 —— 上层逻辑几乎不用改。
 *
 * ⚠️⚠️ 内置 APIKey 的风险边界（2026-10-03 复核）：
 *    这张 Key 编译进客户端，而仓库是公开的 → **必须当作「已公开」来对待**。
 *    因此它的 scope 只有 release:read + storage:read/write，**绝不能有 release:write** ——
 *    否则任何人都能发恶意更新包，存量客户端自动更新会直接中招。
 *    （历史上确有另一张带 release:write 的 Key 被硬编码进 scripts/ 并推到公开仓库，
 *     已于 2026-10-03 吊销；发版凭据现在只走环境变量 SSIO_PUBLISH_KEY / 仓库根 .env.local。）
 *
 *    为什么还留 storage:write：班级 / 作业的云同步要用 KV 写入（kvPut）。
 *    这是"客户端直连 BaaS"架构的固有代价 —— 拿到这张 Key 的人能写 KV，
 *    但**改不了发行版本**，危害被限制在数据层而非代码执行层。
 *
 *    🔧 长期方案（等有空再做）：云同步改为「客户端拿用户 JWT → 站点/SSIO 按用户身份鉴权」，
 *    客户端就不再持有任何写权限的共享凭据了。在那之前，别动这张 Key：
 *    吊销它 = 所有已发布客户端立刻查不到更新 + 班级/作业同步失效。
 */

const TIMEOUT_MS = 15_000;

/** 默认服务器。nrsc.games 域名被 DNSPod 拦截（未备案），先用 IP 直连。 */
export const SSIO_DEFAULT_BASE = 'http://120.53.9.81:8100';
/**
 * 内置客户端 Key：release:read + storage:read/write，**无 release:write**。
 * ⚠️ 此值随客户端分发，等同公开。改动或吊销前务必先看文件头的「风险边界」注释。
 */
export const SSIO_BUILTIN_KEY = 'ssio_live_OiTftLzMkgh21475jUXmWP';

export interface SsioConfig {
  baseUrl: string;
  apiKey: string;
}

let runtimeCfg: SsioConfig | null = null;

/** 设置里可覆盖（自建 SSIO / 换 Key）；不设就用内置默认值，开箱即用。 */
export function setSsioConfig(cfg: Partial<SsioConfig> | null): void {
  runtimeCfg = cfg ? { ...getSsioConfig(), ...cfg } : null;
}

export function getSsioConfig(): SsioConfig {
  return runtimeCfg ?? { baseUrl: SSIO_DEFAULT_BASE, apiKey: SSIO_BUILTIN_KEY };
}

/**
 * 取 fetch：移动端（Capacitor WebView）和 Electron 主进程都有全局 fetch；
 * 万一没有（老 Electron）就退回 electron 的 net.fetch。
 * 注意必须**调用时**才取，不能在模块顶层捕获（移动端 bootstrap 的注入顺序
 * 可能早于某些 shim 就位，顶层捕获会永远拿到错的那个）。
 */
function pickFetch(): typeof fetch {
  const g = globalThis as any;
  if (typeof g.__TASKMGR_FETCH__ === 'function') return g.__TASKMGR_FETCH__;
  if (typeof g.fetch === 'function') return g.fetch.bind(g);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { net } = require('electron');
    if (net?.fetch) return net.fetch.bind(net);
  } catch {
    /* 非 Electron 环境 */
  }
  throw new Error('当前环境没有可用的 fetch，无法访问 SSIO');
}

async function api(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const { baseUrl, apiKey } = getSsioConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await pickFetch()(`${baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) {
      let detail = '';
      try {
        detail = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || '';
      } catch {
        /* 非 JSON 响应 */
      }
      throw new Error(`SSIO ${res.status}${detail ? '：' + detail : ''}`);
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

export interface KvEntry {
  key: string;
  value: string;
  version: number;
  sizeBytes: number;
  updatedAt: number;
}

/** 读一条；不存在返回 null。 */
export async function kvGet(key: string): Promise<KvEntry | null> {
  return api(`/v1/kv?key=${encodeURIComponent(key)}`, { method: 'GET' });
}

/** 读一条并解析成 JSON；不存在 / 解析失败返回 null。 */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  const e = await kvGet(key);
  if (!e) return null;
  try {
    return JSON.parse(e.value) as T;
  } catch {
    return null;
  }
}

/** 写一条（upsert）。expectedVersion 用于乐观锁，冲突会抛错。 */
export async function kvPut(key: string, value: string, expectedVersion?: number): Promise<{ version: number } | null> {
  return api(`/v1/kv?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: expectedVersion != null ? { value, expectedVersion } : { value },
  });
}

export async function kvPutJson(key: string, obj: unknown, expectedVersion?: number): Promise<{ version: number } | null> {
  return kvPut(key, JSON.stringify(obj), expectedVersion);
}

export async function kvDelete(key: string): Promise<void> {
  await api(`/v1/kv?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/** 按前缀列举（不返回 value，只给元信息）。 */
export async function kvList(prefix: string, limit = 200): Promise<Array<{ key: string; version: number; sizeBytes: number; updatedAt: number }>> {
  const r = await api(`/v1/kv/list?prefix=${encodeURIComponent(prefix)}&limit=${limit}`);
  return r?.items ?? [];
}

/** 连通性自检（设置页展示用）。 */
export async function ssioPing(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { baseUrl } = getSsioConfig();
    const res = await pickFetch()(`${baseUrl}/v1/healthz`, { method: 'GET' });
    return { ok: res.ok, detail: res.ok ? 'SSIO 服务可达' : `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) };
  }
}
