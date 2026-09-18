/**
 * 北科云盘（爱数 AnyShare）匿名分享链接客户端（主进程）
 *
 * 2026-09 v1.1.4 实测（yunpan.ustb.edu.cn）逆向出的公开流程，全部走「外链 + 提取码」
 * 匿名权限，**不需要任何账号登录**：
 *
 *   1) POST /link  表单（id=外链ID, type=anonymous, password=提取码 …）
 *      → 302，Set-Cookie: link_token:<外链ID>=ory_at_xxx（Ory Hydra OAuth 令牌）
 *   2) 后续 API 一律带 Authorization: Bearer <token>：
 *      - GET  /api/efast/v1/entry-item          → 分享根目录 {id: "gns://<库>/<doc>", name}
 *      - POST /api/efast/v1/dir/list {docid}    → {dirs:[], files:[{docid,name,rev,size,…}]}
 *      - POST /api/open-doc/v1/file-download {doc:[{id,version}]} → {items:[{url}]} 签名直链
 *      - POST /api/efast/v1/file/osbeginupload  → S3 风格签名 POST 策略（匿名可传！）
 *        → multipart POST 到 /bucket/… → POST /api/efast/v1/file/osendupload {docid,rev}
 *
 * 限制（实测）：
 *   - 匿名**不能**删除/改名/覆盖（file/delete 返回 subject.type must be "user"），
 *     同名上传会被自动改名为 "xxx (2)"。因此作业包用「码-时间戳.json」文件名，
 *     接收方按前缀匹配取修改时间最新的一份。
 *   - 该服务通常仅在**北京科技大学校园网**内可达（UI 上要标注）。
 *   - link_token 有效期未知（观察约小时级），本模块带缓存并在 401 时自动重取。
 */
import { net } from 'electron';

export interface AnyShareConfig {
  /** 站点根，如 https://yunpan.ustb.edu.cn */
  baseUrl: string;
  /** 外链 ID：https://yunpan.ustb.edu.cn/link/<linkId> */
  linkId: string;
  /** 提取码 */
  password: string;
}

/** 从一个完整外链地址解析 {baseUrl, linkId}；不是 AnyShare 外链返回 null */
export function parseAnyShareUrl(raw: string): { baseUrl: string; linkId: string } | null {
  try {
    const u = new URL(raw.trim());
    const m = u.pathname.match(/^\/link\/([A-Za-z0-9]{16,64})\/?$/);
    if (!m) return null;
    return { baseUrl: `${u.protocol}//${u.host}`, linkId: m[1] };
  } catch {
    return null;
  }
}

export interface AnyShareFile {
  docid: string;      // gns://库/文档
  name: string;
  rev: string;
  size: number;
  type?: string;
  modified?: number;  // 微秒时间戳（AnyShare 返回 16 位微秒）
  create_time?: number;
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 令牌缓存 10 分钟，401 时立刻刷新

interface TokenEntry {
  token: string;
  at: number;
}

/** 每个外链 ID 一份令牌缓存 */
const tokenCache = new Map<string, TokenEntry>();

/** 根目录 gns 缓存（外链 ID → docid），外链不变则不变 */
const rootCache = new Map<string, { docid: string; name: string }>();

interface AsFetchResult {
  status: number;
  ok: boolean;
  text: string;
  getSetCookie(): string[];
}

async function asFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number } = {}
): Promise<AsFetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    let res;
    try {
      res = await net.fetch(url, {
        method: opts.method || 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal: ctrl.signal,
      });
    } catch (e: any) {
      // 外网访问北科云盘时 fetch 经常会以 "Redirect was cancelled" / "ERR_NAME_NOT_RESOLVED" / "ENETUNREACH" 失败
      // —— 这些都不是真正的业务错误，而是「不在校园网」的网络层表现，翻译成人话
      const msg = String(e?.message || e || '');
      const raw = { msg, name: e?.name, code: e?.code, cause: e?.cause?.message || String(e?.cause || '') };
      console.error('[anyshare asFetch]', opts.method || 'GET', url, '→ net.fetch threw:', raw);
      // 透传原始消息供上层判定：到底是网络层还是其它
      const tagged = new Error(`北科云盘不可达（${msg.includes('Redirect') || /NAME|ENETUNREACH|ETIMEDOUT|ECONN/i.test(msg) ? '请确认在北科校园网内' : msg}）`);
      (tagged as any).anyshareRaw = raw;
      throw tagged;
    }
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      text,
      getSetCookie: () => {
        const anyRes = res as any;
        if (typeof anyRes.headers?.getSetCookie === 'function') return anyRes.headers.getSetCookie() as string[];
        const single = res.headers.get('set-cookie');
        return single ? [single] : [];
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 提取码登录：拿 link_token（带缓存） */
export async function getLinkToken(cfg: AnyShareConfig, forceRefresh = false): Promise<string> {
  const cached = tokenCache.get(cfg.linkId);
  if (!forceRefresh && cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;

  const form = new URLSearchParams({
    id: cfg.linkId,
    type: 'anonymous',
    password: cfg.password || '',
    password_required: 'true',
    verify_mobile: 'false',
    submit_type: '',
    vcode_id: '',
    verifying_tel: '',
    title: '',
    item_type: 'folder',
    belongs_to: 'document',
  });
  const r = await asFetch(`${cfg.baseUrl}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (r.status !== 302 && r.status !== 200) {
    throw new Error(`北科云盘提取码验证失败（HTTP ${r.status}），请检查提取码 / 是否在校园网内`);
  }
  // link_token 在 302 的 Set-Cookie 里（名字是 "link_token:<外链ID>"）
  let token = '';
  for (const c of r.getSetCookie()) {
    const m = c.match(new RegExp(`^link_token:${cfg.linkId}=([^;\\s]+)`));
    if (m) { token = m[1]; break; }
  }
  if (!token) {
    throw new Error('北科云盘没有返回访问令牌（提取码不对，或外链已失效 / 需要手机验证）');
  }
  tokenCache.set(cfg.linkId, { token, at: Date.now() });
  return token;
}

/** 分享根目录（gns://…） */
export async function getShareRoot(cfg: AnyShareConfig, token?: string): Promise<{ docid: string; name: string }> {
  const cached = rootCache.get(cfg.linkId);
  if (cached) return cached;
  const t = token || (await getLinkToken(cfg));
  const r = await asFetch(`${cfg.baseUrl}/api/efast/v1/entry-item`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!r.ok) throw new Error(`读取北科云盘分享根目录失败（HTTP ${r.status}）`);
  const arr = JSON.parse(r.text);
  const root = Array.isArray(arr) && arr[0];
  if (!root?.id) throw new Error('北科云盘分享根目录为空（外链可能已失效）');
  const entry = { docid: String(root.id), name: String(root.name || '') };
  rootCache.set(cfg.linkId, entry);
  return entry;
}

/** 列目录（只列根分享目录一层，够用） */
export async function listShareFiles(cfg: AnyShareConfig): Promise<AnyShareFile[]> {
  const token = await getLinkToken(cfg);
  const root = await getShareRoot(cfg, token);
  const r = await asFetch(`${cfg.baseUrl}/api/efast/v1/dir/list`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docid: root.docid, by: 'time', sort: 'desc' }),
  });
  if (r.status === 401) {
    // 令牌过期：刷新一次重试
    tokenCache.delete(cfg.linkId);
    const t2 = await getLinkToken(cfg, true);
    const r2 = await asFetch(`${cfg.baseUrl}/api/efast/v1/dir/list`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ docid: root.docid, by: 'time', sort: 'desc' }),
    });
    if (!r2.ok) throw new Error(`列北科云盘目录失败（HTTP ${r2.status}）`);
    return (JSON.parse(r2.text).files || []) as AnyShareFile[];
  }
  if (!r.ok) throw new Error(`列北科云盘目录失败（HTTP ${r.status}）`);
  return (JSON.parse(r.text).files || []) as AnyShareFile[];
}

/** 取某文件的签名下载直链（直链本身无需鉴权，可交给任意下载器） */
export async function getFileDownloadUrl(cfg: AnyShareConfig, file: AnyShareFile): Promise<string> {
  const token = await getLinkToken(cfg);
  const r = await asFetch(`${cfg.baseUrl}/api/open-doc/v1/file-download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: [{ id: file.docid, version: file.rev }] }),
  });
  if (!r.ok) throw new Error(`获取北科云盘下载链接失败（HTTP ${r.status}）`);
  const data = JSON.parse(r.text);
  const item = data?.items?.[0];
  if (!item?.url) throw new Error('北科云盘没有返回下载链接');
  return item.url as string;
}

/** 在分享根目录里按名字精确找文件 */
export async function findShareFile(cfg: AnyShareConfig, name: string): Promise<AnyShareFile | null> {
  const files = await listShareFiles(cfg);
  return files.find((f) => f.name === name) || null;
}

/** 按前缀找修改时间最新的一份（作业包更新场景："<码>-<时间戳>.json"） */
export async function findLatestByPrefix(cfg: AnyShareConfig, prefix: string, suffix = '.json'): Promise<AnyShareFile | null> {
  const files = await listShareFiles(cfg);
  const cands = files.filter((f) => f.name.startsWith(prefix) && f.name.endsWith(suffix));
  if (!cands.length) return null;
  cands.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  return cands[0];
}

/** 下载文本文件（latest.json / 作业包 json） */
export async function downloadTextFile(cfg: AnyShareConfig, name: string, maxBytes = 1024 * 1024): Promise<string> {
  const file = await findShareFile(cfg, name);
  if (!file) throw new Error(`北科云盘分享里没有文件 ${name}`);
  const url = await getFileDownloadUrl(cfg, file);
  const r = await asFetch(url, { timeoutMs: 30000 });
  if (!r.ok) throw new Error(`下载 ${name} 失败（HTTP ${r.status}）`);
  return r.text.slice(0, maxBytes);
}

/**
 * 上传文本文件到分享根目录。匿名不能覆盖，同名会自动变成 "xxx (2)"，
 * 因此调用方应传入唯一文件名（如 `<syncCode>-<ts>.json`）。
 */
export async function uploadTextFile(cfg: AnyShareConfig, name: string, content: string): Promise<{ ok: boolean; name: string }> {
  const token = await getLinkToken(cfg);
  const root = await getShareRoot(cfg, token);
  const buf = Buffer.from(content, 'utf8');

  const begin = async (t: string) => asFetch(`${cfg.baseUrl}/api/efast/v1/file/osbeginupload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_mtime: Math.floor(Date.now() / 1000),
      docid: root.docid,
      length: buf.length,
      name,
      ondup: 1,
      reqmethod: 'POST',
    }),
  });

  let r = await begin(token);
  if (r.status === 401) {
    tokenCache.delete(cfg.linkId);
    const t2 = await getLinkToken(cfg, true);
    r = await begin(t2);
  }
  if (!r.ok) throw new Error(`北科云盘申请上传失败（HTTP ${r.status}）：${r.text.slice(0, 200)}`);
  const info = JSON.parse(r.text);
  if (!info?.authrequest) throw new Error('北科云盘没有返回上传凭证（该分享可能不允许匿名上传）');

  // multipart 直传到 /bucket/…（S3 风格签名 POST）
  const [method, uploadUrl, ...pairs] = info.authrequest as string[];
  const fields: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf(':');
    fields[p.slice(0, i)] = p.slice(i + 2);
  }
  const boundary = `----TaskManager${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(buf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const up = await asFetch(uploadUrl, {
    method,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: new Uint8Array(body),
    timeoutMs: 10 * 60 * 1000, // 安装包等大文件
  });
  if (up.status !== 204 && !up.ok) throw new Error(`北科云盘直传失败（HTTP ${up.status}）`);

  // 收尾登记
  const end = await asFetch(`${cfg.baseUrl}/api/efast/v1/file/osendupload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docid: info.docid, rev: info.rev }),
  });
  if (!end.ok) throw new Error(`北科云盘上传收尾失败（HTTP ${end.status}）`);
  return { ok: true, name };
}
