/**
 * USTB SSO / BYYT 教务系统 HTTP 客户端。
 * 手动管理 Cookie + 手动跟随重定向（Node fetch 原生不支持跨请求 Cookie）。
 */

export interface CookieEntry {
  domain: string;
  path: string;
  cookies: Record<string, string>;
}

export class CookieJar {
  private store = new Map<string, Record<string, string>>();

  /** 从 settings 里存的 JSON 恢复 */
  static fromJSON(json: string | undefined | null): CookieJar {
    const jar = new CookieJar();
    if (!json) return jar;
    try {
      const arr = JSON.parse(json) as CookieEntry[];
      for (const e of arr) {
        if (e && typeof e.domain === 'string' && e.cookies && typeof e.cookies === 'object') {
          jar.store.set(`${e.domain}|${e.path ?? '/'}`, { ...e.cookies });
        }
      }
    } catch {
      /* 损坏的存储按空处理 */
    }
    return jar;
  }

  toJSON(): string {
    const arr: CookieEntry[] = [];
    for (const [key, cookies] of this.store) {
      const [domain, path] = key.split('|');
      if (Object.keys(cookies).length) arr.push({ domain, path, cookies });
    }
    return JSON.stringify(arr);
  }

  /** 吸收响应里的 Set-Cookie */
  absorb(url: URL, res: Response): void {
    const rawList: string[] = (res.headers as any).getSetCookie?.() ?? [];
    for (const raw of rawList) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = url.hostname;
      let path = '/';
      for (const attr of attrs) {
        const [k, ...rest] = attr.split('=');
        const v = rest.join('=').trim();
        const key = k.trim().toLowerCase();
        if (key === 'domain' && v) domain = v.replace(/^\./, '');
        if (key === 'path' && v) path = v;
      }
      const bucketKey = `${domain}|${path}`;
      const bucket = this.store.get(bucketKey) ?? {};
      if (value === '') delete bucket[name];
      else bucket[name] = value;
      this.store.set(bucketKey, bucket);
    }
  }

  /** 生成请求 Cookie 头 */
  header(url: URL): string | undefined {
    const host = url.hostname;
    const parts: string[] = [];
    for (const [key, bucket] of this.store) {
      const [domain, path] = key.split('|');
      if (host !== domain && !host.endsWith('.' + domain)) continue;
      if (path !== '/' && !url.pathname.startsWith(path)) continue;
      for (const [n, v] of Object.entries(bucket)) parts.push(`${n}=${v}`);
    }
    return parts.length ? parts.join('; ') : undefined;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  /** JSON 请求体（自动设 Content-Type: application/json） */
  json?: unknown;
  /** 表单请求体（自动设 Content-Type: application/x-www-form-urlencoded） */
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** false = 不跟随 3xx（返回原始响应）；默认跟随 */
  followRedirect?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * 发起请求：每跳吸收 Cookie；3xx 手动跟随（POST 之后的跳转一律转 GET）。
 */
export async function request(jar: CookieJar, url: string, opts: RequestOptions = {}): Promise<Response> {
  let current = url;
  const hops = opts.followRedirect === false ? 1 : opts.maxRedirects ?? 8;
  let res!: Response;
  for (let hop = 0; hop < hops; hop++) {
    const u = new URL(current);
    const headers: Record<string, string> = { 'User-Agent': UA, ...(opts.headers ?? {}) };
    const cookie = jar.header(u);
    if (cookie) headers.Cookie = cookie;
    let body: string | undefined;
    if (hop === 0) {
      if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      } else if (opts.form !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(opts.form).toString();
      }
    }
    res = await fetch(current, {
      method: hop === 0 ? opts.method ?? 'GET' : 'GET',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
    jar.absorb(u, res);
    const s = res.status;
    if (s === 301 || s === 302 || s === 303 || s === 307 || s === 308) {
      const loc = res.headers.get('location');
      if (!loc) break;
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }
  return res;
}
