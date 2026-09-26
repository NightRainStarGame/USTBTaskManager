/**
 * Android 原生 HTTP 通道（v1.2.10 块 6）。
 *
 * 为什么需要：APK 的主进程逻辑跑在同一个 webview 里，fetch 受同源策略约束。
 *   · GitHub API / raw CDN 发 CORS 头 → 作业同步直接可用
 *   · USTB 教务（贝壳课表）不发 → 请求被浏览器拦掉，功能等于废的
 * 原生层没有 CORS 概念，@capacitor-community/http 的 CapacitorHttp 走 OkHttp 可绕过。
 *
 * 约束：**零 npm 依赖、零静态 import**。插件没装就自动回退 webview fetch，
 * 桌面构建和没装插件的 APK 都不受影响，装上插件后立刻生效。
 */
export interface NativeHttpResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  data?: any;
  url?: string;
}

interface CapHttpPlugin {
  request(opts: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    data?: any;
    disableRedirects?: boolean;
  }): Promise<NativeHttpResponse>;
}

function pickPlugin(): CapHttpPlugin | null {
  const g = globalThis as any;
  const cap = g.Capacitor?.Plugins?.CapacitorHttp ?? g.CapacitorHttp;
  return cap && typeof cap.request === 'function' ? (cap as CapHttpPlugin) : null;
}

let cached: CapHttpPlugin | null | undefined;

export function hasNativeHttp(): boolean {
  if (cached === undefined) cached = pickPlugin();
  return !!cached;
}

/**
 * 包成标准 Response。坑：Response 规范禁止 JS 读 Set-Cookie，而 USTB 登录全靠 Cookie
 * 串联 —— 所以转挂到自定义头 x-taskmgr-set-cookie，由 CookieJar.absorb 解出来。
 */
function toResponse(r: NativeHttpResponse): Response {
  const headers = new Headers();
  const cookies: string[] = [];
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (k.toLowerCase() === 'set-cookie') {
      if (Array.isArray(v)) cookies.push(...v.map(String));
      else cookies.push(String(v));
      continue;
    }
    try { headers.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch { /* 非法头名跳过 */ }
  }
  if (cookies.length) headers.set('x-taskmgr-set-cookie', JSON.stringify(cookies));

  const d = r.data;
  const body = typeof d === 'string' ? d : d === undefined || d === null ? null : JSON.stringify(d);
  return new Response(body, { status: r.status || 200, headers });
}

/** fetch 兼容实现：内部优先走原生插件，用于项目内的 HTTP 客户端（USTB） */
export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!hasNativeHttp() || !cached) return fetch(input as RequestInfo, init);

  let url: string;
  let baseMethod = 'GET';
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.toString();
  else { url = input.url; baseMethod = input.method || 'GET'; }

  const method = String(init?.method || baseMethod || 'GET').toUpperCase();

  const headers: Record<string, string> = {};
  const src = init?.headers ?? (typeof input !== 'string' && !(input instanceof URL) ? input.headers : undefined);
  if (src) {
    if (typeof (src as Headers).forEach === 'function') {
      (src as Headers).forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(src)) {
      for (const [k, v] of src) headers[k] = String(v);
    } else {
      for (const [k, v] of Object.entries(src as Record<string, string>)) headers[k] = String(v);
    }
  }

  const raw = init?.body;
  const data =
    raw instanceof URLSearchParams ? raw.toString()
      : typeof raw === 'string' ? raw
        : undefined;

  try {
    const res = await cached.request({
      url,
      method,
      headers,
      data,
      // 上层用 redirect:'manual' 自己跟随并吸收 Cookie，原生层必须同步<｜hy_place▁holder▁no▁813｜>行为
      disableRedirects: init?.redirect === 'manual',
    });
    return toResponse(res);
  } catch (e) {
    // 原生层出问题（插件异常/网络错误）不该让整个流程死掉，降级到 webview fetch 再试
    console.warn('[mobile] 原生 HTTP 失败，回退 fetch:', e);
    return fetch(input as RequestInfo, init);
  }
}

/** 安装到全局，供 electron/ustb/http.ts 运行时取用 */
export function installNativeHttpBridge() {
  (globalThis as any).__TASKMGR_FETCH__ = nativeFetch;
  if (hasNativeHttp()) console.info('[mobile] 原生 HTTP 通道已启用（CapacitorHttp）');
}
