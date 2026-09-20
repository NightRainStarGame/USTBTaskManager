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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

/** v1.1.5 debug: asFetch 失败时把原始 error 写到独立日志（packaged 模式 stdout 被吞） */
const AS_DEBUG_LOG = path.join(os.tmpdir(), 'taskmanager-anyshare.log');
function asDebug(msg: string) {
  try { fs.appendFileSync(AS_DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
}

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

/**
 * v1.1.5 重写：用 Node 原生 `https.request` / `http.request`，彻底绕开 Electron 的
 * Chromium net 层。
 *
 * 背景：Electron 33 在 Windows 主进程下，**`net.fetch` 和 `net.request` 都对 3xx
 * 响应抛 `Redirect was cancelled`**（实测 POST /link → 302 必触发）。这条
 * Chromium net::URLRequest 的 bug 在 Windows 上特别顽固，跟 `redirect: 'manual'`
 * 还是 `'follow'` 无关 —— 它发生在 Chromium 内部 redirect 处理阶段。
 *
 * Node 的 http/https 模块走的是另一套 socket，不走 Chromium net stack，redirect
 * 完全由调用方控制。AnyShare 接口都是 https，redirect 都是 302，目标是拿到
 * Set-Cookie 里的 link_token；用 Node 直接读 response.statusCode 和
 * response.headers['set-cookie'] 即可。
 *
 * 行为与 `net.fetch` 兼容：传入同样的 {method, headers, body, timeoutMs}，
 * 返回 {status, ok, text, getSetCookie()}。timeout 用 setTimeout + req.destroy 兜底。
 */
async function asFetch(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number } = {}
): Promise<AsFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch (e: any) {
      return reject(new Error(`北科云盘 URL 解析失败：${e?.message || e}`));
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    const reqOpts: https.RequestOptions = {
      method: opts.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      headers,
    };
    const req = lib.request(reqOpts, (res) => {
      const status = res.statusCode || 0;
      const setCookieRaw = res.headers['set-cookie'];
      const setCookie: string[] = Array.isArray(setCookieRaw)
        ? setCookieRaw as string[]
        : (setCookieRaw ? [setCookieRaw as string] : []);
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: Buffer.concat(chunks).toString('utf8'),
          getSetCookie: () => setCookie,
        });
      });
      res.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const msg = String((err as any)?.message || err || '');
        const raw = { msg, name: (err as any)?.name, code: (err as any)?.code };
        console.error('[anyshare asFetch] response error:', raw);
        asDebug(`asFetch ${opts.method || 'GET'} ${url} → response error ${JSON.stringify(raw)}`);
        reject(Object.assign(
          new Error(`北科云盘不可达（${/NAME|ENETUNREACH|ETIMEDOUT|ECONN|Redirect/i.test(msg) ? '请确认在北科校园网内' : msg}）`),
          { anyshareRaw: raw }
        ));
      });
    });
    let settled = false;
    const timer = setTimeout(() => {
      try { req.destroy(new Error('timeout')); } catch { /* ignore */ }
      if (settled) return;
      settled = true;
      reject(new Error(`北科云盘请求超时（${timeoutMs / 1000} 秒）`));
    }, timeoutMs);
    req.on('error', (e: any) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const msg = String(e?.message || e || '');
      const raw = { msg, name: e?.name, code: e?.code, cause: e?.cause?.message || String(e?.cause || '') };
      console.error('[anyshare asFetch]', opts.method || 'GET', url, '→ request error:', raw);
      asDebug(`asFetch ${opts.method || 'GET'} ${url} → request error ${JSON.stringify(raw)}`);
      reject(Object.assign(
        new Error(`北科云盘不可达（${/NAME|ENETUNREACH|ETIMEDOUT|ECONN|Redirect/i.test(msg) ? '请确认在北科校园网内' : msg}）`),
        { anyshareRaw: raw }
      ));
    });
    try {
      if (opts.body !== undefined && opts.body !== null) {
        if (Buffer.isBuffer(opts.body) || opts.body instanceof Uint8Array) {
          req.write(opts.body);
        } else if (typeof opts.body === 'string') {
          req.write(opts.body);
        } else {
          req.write(JSON.stringify(opts.body));
        }
      }
      req.end();
    } catch (e: any) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const msg = String(e?.message || e || '');
      reject(Object.assign(
        new Error(`北科云盘不可达（${/NAME|ENETUNREACH|ETIMEDOUT|ECONN|Redirect/i.test(msg) ? '请确认在北科校园网内' : msg}）`),
        { anyshareRaw: { msg, name: e?.name, code: e?.code, where: 'req.end' } }
      ));
    }
  });
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

/**
 * v1.1.7：在指定目录里列文件（homework/<publishCode>/ 子文件夹场景）。
 * 返回该目录的 { dirs, files }。
 */
export async function listDir(cfg: AnyShareConfig, dirDocid: string): Promise<{ dirs: AnyShareFile[]; files: AnyShareFile[] }> {
  const token = await getLinkToken(cfg);
  const ls = async (t: string) => asFetch(`${cfg.baseUrl}/api/efast/v1/dir/list`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docid: dirDocid, by: 'time', sort: 'desc' }),
  });
  let r = await ls(token);
  if (r.status === 401) {
    tokenCache.delete(cfg.linkId);
    const t2 = await getLinkToken(cfg, true);
    r = await ls(t2);
  }
  if (!r.ok) throw new Error(`列北科云盘目录失败（HTTP ${r.status}）`);
  const j = JSON.parse(r.text) || {};
  return { dirs: (j.dirs || []) as AnyShareFile[], files: (j.files || []) as AnyShareFile[] };
}

/**
 * v1.1.7：幂等建子目录（父 docid + 名字），返回 { docid, name }。
 * 匿名权限实测可建目录（POST /api/efast/v1/dir/create，2026-09-20 验证）。
 * 已存在时靠先列 dirs 找到再返回，避免依赖 create 的报错语义。
 */
export async function ensureShareDir(cfg: AnyShareConfig, parentDocid: string, name: string): Promise<{ docid: string; name: string }> {
  const { dirs } = await listDir(cfg, parentDocid);
  const hit = dirs.find((d) => d.name === name);
  if (hit?.docid) return { docid: hit.docid, name: hit.name };
  const token = await getLinkToken(cfg);
  const create = async (t: string) => asFetch(`${cfg.baseUrl}/api/efast/v1/dir/create`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docid: parentDocid, name }),
  });
  let r = await create(token);
  if (r.status === 401) {
    tokenCache.delete(cfg.linkId);
    const t2 = await getLinkToken(cfg, true);
    r = await create(t2);
  }
  if (!r.ok) throw new Error(`北科云盘创建文件夹 ${name} 失败（HTTP ${r.status}）`);
  const j = JSON.parse(r.text) || {};
  if (!j.docid) throw new Error(`北科云盘创建文件夹 ${name} 未返回 docid：${r.text.slice(0, 120)}`);
  return { docid: String(j.docid), name: String(j.name || name) };
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
/**
 * v1.1.6 起：调用方可直接传 AnyShareFile（已由 findLatestByPrefix 等前缀查询得到），
 * 也可传 name 走原精确查找。匿名云盘 uploader 会传成 "<base>-<ts>.<ext>" 前缀+时间戳，
 * 直接按精确名匹配会找不到。
 */
export async function downloadTextFile(cfg: AnyShareConfig, nameOrFile: string | AnyShareFile, maxBytes = 1024 * 1024): Promise<string> {
  const file = typeof nameOrFile === 'string' ? await findShareFile(cfg, nameOrFile) : nameOrFile;
  if (!file) throw new Error(`北科云盘分享里没有文件 ${typeof nameOrFile === 'string' ? nameOrFile : nameOrFile.name}`);
  const url = await getFileDownloadUrl(cfg, file);
  const r = await asFetch(url, { timeoutMs: 30000 });
  if (!r.ok) throw new Error(`下载 ${file.name} 失败（HTTP ${r.status}）`);
  return r.text.slice(0, maxBytes);
}

/**
 * v1.1.7：向指定目录（而非分享根）上传文本文件。命名与幂等语义同 uploadTextFile。
 */
export async function uploadTextFileToDir(cfg: AnyShareConfig, dirDocid: string, name: string, content: string): Promise<{ ok: boolean; name: string }> {
  const token = await getLinkToken(cfg);
  const buf = Buffer.from(content, 'utf8');

  const begin = async (t: string) => asFetch(`${cfg.baseUrl}/api/efast/v1/file/osbeginupload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_mtime: Math.floor(Date.now() / 1000),
      docid: dirDocid,
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
    timeoutMs: 10 * 60 * 1000,
  });
  if (up.status !== 204 && !up.ok) throw new Error(`北科云盘直传失败（HTTP ${up.status}）`);

  const end = await asFetch(`${cfg.baseUrl}/api/efast/v1/file/osendupload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docid: info.docid, rev: info.rev }),
  });
  if (!end.ok) throw new Error(`北科云盘上传收尾失败（HTTP ${end.status}）`);
  return { ok: true, name };
}

/** v1.1.7：在指定目录里按前缀找修改时间最新的一份 */
export async function findLatestByPrefixIn(cfg: AnyShareConfig, dirDocid: string, prefix: string, suffix = '.json'): Promise<AnyShareFile | null> {
  const { files } = await listDir(cfg, dirDocid);
  const cands = files.filter((f) => f.name.startsWith(prefix) && f.name.endsWith(suffix));
  if (!cands.length) return null;
  cands.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  return cands[0];
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
