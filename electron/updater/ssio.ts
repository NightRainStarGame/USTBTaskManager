import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SSIO 更新源适配层（P9）。
 *
 * 设计取舍：TaskManager 的更新系统围绕 `latest.json` 清单工作（多源测速、增量补丁、
 * 备源镜像、跳过版本都建在这份清单上）。SSIO 是 API 服务，没有清单文件。
 *
 * 与其在检查流程里到处加 if，不如**在这里把 API 响应合成成一份 latest.json 文本** ——
 * 下游的 parseManifest / 测速 / 下载 / 补丁选择一行都不用改。
 *
 * 使用方式：在「设置 → 更新源」里添加一个自定义源
 *   URL:      ssio+http://<你的 SSIO 地址>:8100
 *   提取码:   <APIKey>（需要 release:read scope）
 * `ssio+` 前缀是本模块的识别标记，其余字段复用既有结构（password 存 APIKey）。
 */

export const SSIO_PREFIX = 'ssio+';

const TIMEOUT_MS = 15_000;

export interface SsioSourceLike {
  url?: string;
  password?: string;
}

export function isSsioSource(src: SsioSourceLike | null | undefined): boolean {
  return typeof src?.url === 'string' && src.url.toLowerCase().startsWith(SSIO_PREFIX);
}

/** 去掉 `ssio+` 前缀，得到真实的 API 基地址。 */
export function ssioBaseUrl(src: SsioSourceLike): string {
  return String(src.url ?? '').slice(SSIO_PREFIX.length).replace(/\/+$/, '');
}

/** SSIO 的 platform 枚举是 win|linux|android|any，不是 Electron 的 win32/darwin。 */
function ssioPlatform(): string {
  switch (process.platform) {
    case 'win32':
      return 'win';
    case 'linux':
      return 'linux';
    case 'darwin':
      // SSIO 目前没有 macos 枚举；用 any 让服务端只匹配 arch=any 的版本，
      // 拿不到也不影响其它源 —— 这个源失败会被更新系统的多源回退兜住
      return 'any';
    default:
      return 'any';
  }
}

/**
 * 灰度分桶标识：装一次生成一个，之后不变。
 * 放在 userData 下（不是 asar 里），升级不会被覆盖。
 */
function clientId(): string {
  try {
    const file = path.join(app.getPath('userData'), 'ssio-client-id.txt');
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
    const fresh = `tm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    fs.writeFileSync(file, fresh, 'utf8');
    return fresh;
  } catch {
    // 读不到就用个不稳定的兜底值：最坏情况是灰度分桶每次都变，不影响正确性
    return 'tm-fallback';
  }
}

interface SsioLatestResponse {
  hasUpdate?: boolean;
  version?: string;
  url?: string | null;
  sha256?: string | null;
  size?: number | null;
  notes?: string | null;
  mandatory?: boolean;
}

/**
 * 拉取 SSIO 的 latest，返回**清单格式**的文本（交给既有的 parseManifest）。
 * 无可用更新时返回当前版本号的清单，让下游自己判定「已是最新」。
 */
export async function fetchSsioManifestText(src: SsioSourceLike): Promise<string> {
  const base = ssioBaseUrl(src);
  const current = app.getVersion();
  const qs = new URLSearchParams({
    platform: ssioPlatform(),
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    channel: 'stable',
    current,
    clientId: clientId(),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let text: string;
  try {
    const res = await net.fetch(`${base}/v1/releases/latest?${qs.toString()}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        // APIKey 走 password 字段（与云盘提取码复用同一个位置）
        ...(src.password ? { 'X-API-Key': src.password } : {}),
      },
      signal: ctrl.signal,
    } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const data = JSON.parse(text) as SsioLatestResponse;
  if (!data?.hasUpdate || !data.version) {
    // 没有更新：返回与当前版本一致的清单，下游会判定 ok + hasUpdate=false
    return JSON.stringify({ version: current, notes: null, url: null, sha256: null, patches: [] });
  }

  return JSON.stringify({
    version: String(data.version),
    notes: data.notes ?? null,
    url: data.url ?? null,
    sha256: data.sha256 ?? null,
    size: data.size ?? null,
    // SSIO 的 mandatory 对应 latest.json 的 force
    force: data.mandatory === true,
    // SSIO 不做增量补丁：留空，更新系统自然走整包
    patches: [],
  });
}
