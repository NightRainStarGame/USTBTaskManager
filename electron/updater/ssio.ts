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

/**
 * 用 SSIO 资源引用换一条**新鲜**下载地址。
 *
 * 服务端只有两个能拿到「带时效签名 URL」的入口（签名 5 分钟过期，只能现取现用）：
 *   · 整包（release）：`GET /v1/releases/latest` —— 它**每次请求都对文件重新签名**。
 *     注意服务端**没有** `/v1/releases/:id/download` 端点（v1.2.15 曾因此接错，
 *     下载必 404，v1.2.16 修复）。所以 release 引用走 latest，并校验返回的
 *     version 与清单一致，防止渠道被回滚时下错包。
 *   · 补丁（file）：`GET /v1/storage/files/:id/download`。
 * 需要的 scope（release:read / storage:read）内置 Key 都具备。
 */
export async function fetchSsioDownloadUrl(
  src: SsioSourceLike,
  kind: 'release' | 'file',
  id: string,
  expectVersion?: string,
): Promise<string> {
  const base = ssioBaseUrl(src);
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(src.password ? { 'X-API-Key': src.password } : {}),
  };

  let apiPath: string;
  if (kind === 'release') {
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux';
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    // current 传一个必然落后的版本，确保拿到本渠道当前已发布的最新记录
    apiPath = `/v1/releases/latest?platform=${platform}&arch=${arch}&channel=stable&current=0.0.1&clientId=taskmgr-dl`;
  } else {
    apiPath = `/v1/storage/files/${encodeURIComponent(id)}/download`;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(`${base}${apiPath}`, {
      method: 'GET',
      headers,
      signal: ctrl.signal,
    } as RequestInit);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
    const text = await res.text();
    const j = JSON.parse(text) as { url?: string; version?: string };
    if (kind === 'release' && expectVersion && String(j.version || '') !== String(expectVersion)) {
      throw new Error(`SSIO 最新发行是 ${j.version || '?'}，与清单 ${expectVersion} 不一致（可能被回滚），拒绝下载`);
    }
    if (!j?.url) throw new Error('SSIO 没返回下载地址（该版本可能没有挂文件）');
    return j.url;
  } finally {
    clearTimeout(timer);
  }
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

/**
 * v1.2.13：TaskManager 完整更新清单在 SSIO KV 里的键名。
 *
 * SSIO 的 `/v1/releases/latest` 只认识「一个整包」，不认识增量补丁 —— v1.2.12 把
 * 更新主源切到 SSIO 后，这里只能合成出 `patches: []`，于是设置页的「增量补丁」
 * 板块整个消失（PatchPanel 靠 manifest.patches 渲染），所有人都得下载 93MB 整包。
 *
 * 解法：发版时把 latest.json 原文同步进 KV，客户端在这里取回 patches / 镜像链 /
 * asar 基线哈希；整包下载地址仍然用 SSIO 的（国内快），补丁 zip 走镜像链。
 */
const MANIFEST_KV_KEY = 'taskmgr/latest.json';

interface SsioLatestResponse {
  hasUpdate?: boolean;
  version?: string;
  /** 发行记录 id。下载前要用它换一次签名 URL，见下方 SsioRelease 注释。 */
  releaseId?: string | null;
  url?: string | null;
  sha256?: string | null;
  size?: number | null;
  notes?: string | null;
  mandatory?: boolean;
}

/**
 * v1.2.15：releaseId 为什么要往清单里塞？
 *
 * SSIO 的下载地址是**签名 URL，5 分钟过期**（服务端 DEFAULT_TTL_SEC）。
 * 而更新流程的真实节奏是：早上弹通知 → 用户晚上才点「立即更新」，
 * 中间可能隔几小时 —— 直接拿 `releases/latest` 返回的 url 去下载，
 * 到点时必然 404/401，表现为「更新到一半失败，重试也一样」。
 *
 * 所以清单里只记 releaseId，真正下载前再调一次 `/v1/releases/:id/download`
 * 换一张新鲜签名。这一条同时也是 SSIO 官方文档里反复强调的红线。
 */

/** 拉 SSIO KV 里的权威清单；拿不到（未同步 / 无权限 / 超时）返回 null，由调用方退化。 */
async function fetchKvManifest(
  base: string,
  headers: Record<string, string>,
): Promise<Record<string, any> | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let text: string;
    try {
      const res = await net.fetch(
        `${base}/v1/kv?key=${encodeURIComponent(MANIFEST_KV_KEY)}`,
        { method: 'GET', headers, signal: ctrl.signal } as RequestInit,
      );
      if (!res.ok) return null;
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const row = JSON.parse(text) as { value?: string } | null;
    if (!row || typeof row.value !== 'string') return null;
    const parsed = JSON.parse(row.value) as Record<string, any> | null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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

  const headers: Record<string, string> = {
    accept: 'application/json',
    // APIKey 走 password 字段（与云盘提取码复用同一个位置）
    ...(src.password ? { 'X-API-Key': src.password } : {}),
  };

  // 两个请求并发：整包信息来自 releases/latest（SSIO 自己的下载端点，国内快），
  // 补丁清单来自 KV（发版时同步的完整 latest.json）。任一失败都不影响另一路。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let text: string;
  let kvManifest: Record<string, any> | null = null;
  try {
    const [releaseRes, kv] = await Promise.all([
      net.fetch(`${base}/v1/releases/latest?${qs.toString()}`, {
        method: 'GET',
        headers,
        signal: ctrl.signal,
      } as RequestInit),
      fetchKvManifest(base, headers),
    ]);
    kvManifest = kv;
    if (!releaseRes.ok) throw new Error(`HTTP ${releaseRes.status} ${releaseRes.statusText || ''}`.trim());
    text = await releaseRes.text();
  } finally {
    clearTimeout(timer);
  }

  const data = JSON.parse(text) as SsioLatestResponse;
  if (!data?.hasUpdate || !data.version) {
    // 没有更新：返回与当前版本一致的清单，下游会判定 ok + hasUpdate=false
    return JSON.stringify({ version: current, notes: null, url: null, sha256: null, patches: [] });
  }

  const version = String(data.version);
  // 只有 KV 清单与 SSIO 发行版本一致时才敢用它的补丁：版本对不上说明两边没同步，
  // 这时下发补丁会让客户端拿错基线（baseAsarSha256 不匹配必然应用失败）。
  const synced = kvManifest && String(kvManifest.version) === version ? kvManifest : null;
  // 二次过滤：只保留「应用后正好是本次目标版本」的补丁。
  // 清单里可能残留上一版留下的补丁（例如 1.2.11→1.2.12 混在 1.2.13 的清单里），
  // 而 selectPatch 只按 fromVersion + baseAsarSha256 匹配，不校验产物版本 ——
  // 误选会让 1.2.11 用户升完停在 1.2.12，得再重启升一次。这里直接挡掉。
  const targetAsar = typeof synced?.asarSha256 === 'string' ? String(synced.asarSha256).toLowerCase() : '';
  const patches = synced && Array.isArray(synced.patches)
    ? synced.patches.filter(
        (p: any) =>
          p &&
          (!targetAsar ||
            typeof p.appAsarSha256 !== 'string' ||
            String(p.appAsarSha256).toLowerCase() === targetAsar),
      )
    : [];

  return JSON.stringify({
    version,
    notes: data.notes ?? synced?.notes ?? null,
    // 有 releaseId 就记引用而不是现成的 url：后者是 5 分钟过期的签名地址，
    // 「早上检查更新、晚上才点安装」的场景下必然失效。下载前会按引用重新签一次。
    url: data.releaseId ? `ssio:release:${data.releaseId}` : (data.url ?? null),
    releaseId: data.releaseId ?? null,
    sha256: data.sha256 ?? null,
    size: data.size ?? null,
    // SSIO 的 mandatory 对应 latest.json 的 force
    force: data.mandatory === true,
    // 基线哈希用于补丁校验；KV 没同步时留空，下游自动走整包
    asarSha256: synced?.asarSha256 ?? null,
    asarSize: synced?.asarSize ?? null,
    urlMirrors: Array.isArray(synced?.urlMirrors) ? synced.urlMirrors : [],
    patches,
  });
}
