/**
 * 北科大统一身份认证（SSO）微信扫码登录 + 本研一体教务系统（BYYT）课表接口。
 * 协议细节参考开源实现 isHarryh/USTB-SSO（MIT）与 isHarryh/The-Beike。
 */
import { CookieJar, request } from './http';

// ===== 应用参数（BYYT 本研一体教务系统 2025 版，来源 isHarryh/USTB-SSO _prefabs.py） =====
export const BYYT_APP = {
  entityId: 'YW2025006',
  redirectUri: 'https://byyt.ustb.edu.cn/oauth/login/code',
  state: 'null',
} as const;

const SSO_AUTH_ENTRY = 'https://sso.ustb.edu.cn/idp/authCenter/authenticate';
const SSO_QUERY_AUTH_METHODS = 'https://sso.ustb.edu.cn/idp/authn/queryAuthMethods';
const SSO_QR_INFO = 'https://sso.ustb.edu.cn/idp/authn/getMicroQr';
const SIS_QR_PAGE = 'https://sis.ustb.edu.cn/connect/qrpage';
const SIS_QR_IMG = 'https://sis.ustb.edu.cn/connect/qrimg';
const SIS_QR_STATE = 'https://sis.ustb.edu.cn/connect/state';
export const BYYT_BASE = 'https://byyt.ustb.edu.cn';

export interface UstbContext {
  jar: CookieJar;
  entityId: string;
  redirectUri: string;
  state: string;
  lck?: string;
  appId?: string;
  returnUrl?: string;
  randomToken?: string;
  sid?: string;
}

export function createContext(jar?: CookieJar): UstbContext {
  return {
    jar: jar ?? new CookieJar(),
    entityId: BYYT_APP.entityId,
    redirectUri: BYYT_APP.redirectUri,
    state: BYYT_APP.state,
  };
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ==================== SSO 微信扫码登录 ====================

/** 第 1-4 步：打开认证入口 → 查询认证方式 → 拿微信认证参数 → 拿二维码 sid */
export async function startQrLogin(ctx: UstbContext): Promise<void> {
  // 1) 打开认证入口（不跟随重定向，从 Location 里提取 lck）
  const entry = new URL(SSO_AUTH_ENTRY);
  entry.searchParams.set('client_id', ctx.entityId);
  entry.searchParams.set('redirect_uri', ctx.redirectUri);
  entry.searchParams.set('login_return', 'true');
  entry.searchParams.set('state', ctx.state);
  entry.searchParams.set('response_type', 'code');
  const entryRes = await request(ctx.jar, entry.toString(), { followRedirect: false });
  if (Math.floor(entryRes.status / 100) !== 3) {
    throw new Error(`认证入口异常（HTTP ${entryRes.status}），请确认校园网可以访问 sso.ustb.edu.cn`);
  }
  const location = entryRes.headers.get('location') ?? '';
  const lck = new URL(location.replace('/#/', '/')).searchParams.get('lck');
  if (!lck) throw new Error('未能获取登录上下文（lck）');
  ctx.lck = lck;

  // 2) 查询可用认证方式（建立 SSO 会话）
  const methodsRes = await request(ctx.jar, SSO_QUERY_AUTH_METHODS, {
    method: 'POST',
    json: { lck, entityId: ctx.entityId },
  });
  const methods = await readJson(methodsRes);
  if (!methods || methods.code !== 200) {
    throw new Error(`查询认证方式失败：${methods?.message ?? `HTTP ${methodsRes.status}`}`);
  }

  // 3) 获取微信扫码认证信息（appId / returnUrl / randomToken）
  const qrRes = await request(ctx.jar, SSO_QR_INFO, {
    method: 'POST',
    json: { entityId: ctx.entityId, lck },
  });
  const qrInfo = await readJson(qrRes);
  if (!qrInfo || String(qrInfo.code) !== '200') {
    throw new Error(`获取二维码信息失败：${qrInfo?.message ?? `HTTP ${qrRes.status}`}`);
  }
  ctx.appId = qrInfo.data.appId;
  ctx.returnUrl = qrInfo.data.returnUrl;
  ctx.randomToken = qrInfo.data.randomToken;

  // 4) 打开二维码页面，从 HTML 里提取 sid
  const pageRes = await request(ctx.jar, `${SIS_QR_PAGE}?appid=${encodeURIComponent(ctx.appId!)}&return_url=${encodeURIComponent(ctx.returnUrl!)}&rand_token=${encodeURIComponent(ctx.randomToken!)}&embed_flag=1`);
  if (pageRes.status !== 200) throw new Error(`二维码页面异常（HTTP ${pageRes.status}）`);
  const html = await pageRes.text();
  const m = /sid\s?=\s?(\w{32})/.exec(html);
  if (!m) throw new Error('二维码页面解析失败（未找到 sid）');
  ctx.sid = m[1];
}

/** 下载二维码图片，返回 data URL（base64 PNG） */
export async function getQrImage(ctx: UstbContext): Promise<string> {
  const res = await request(ctx.jar, `${SIS_QR_IMG}?sid=${ctx.sid}`);
  if (res.status !== 200) throw new Error(`获取二维码失败（HTTP ${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

export type QrPollStatus = 'waiting' | 'scanned' | 'success' | 'expired' | 'error';

/** 轮询扫码状态（单次）：code 1=成功 2=已扫码 3/202=过期 4=等待 101/102=异常 */
export async function pollQrStatus(ctx: UstbContext): Promise<{
  status: QrPollStatus;
  passcode?: string;
  message?: string;
}> {
  const res = await request(ctx.jar, `${SIS_QR_STATE}?sid=${ctx.sid}`, { timeoutMs: 16000 });
  const data = await readJson(res);
  if (!data) return { status: 'error', message: '轮询响应解析失败' };
  const code = Number(data.code);
  if (code === 1) return { status: 'success', passcode: String(data.data ?? '') };
  if (code === 2) return { status: 'scanned' };
  if (code === 3 || code === 202) return { status: 'expired', message: '二维码已过期，请点击刷新' };
  if (code === 4) return { status: 'waiting' };
  return { status: 'error', message: data.message ? String(data.message) : `状态码 ${code}` };
}

function decodeLocationValue(v: string): string {
  let s = v;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* 保留原值 */
  }
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 扫码确认后：用 passcode 完成认证 → 跳转 BYYT 落 cookie → 验证用户信息 */
export async function completeQrLogin(ctx: UstbContext, passcode: string): Promise<UstbUserInfo> {
  const u = new URL(ctx.returnUrl!);
  u.searchParams.set('appid', ctx.appId!);
  u.searchParams.set('auth_code', passcode);
  u.searchParams.set('rand_token', ctx.randomToken!);
  const res = await request(ctx.jar, u.toString());
  const text = await res.text();
  const actionType = /var actionType\s*=\s*"([^"]+)"/.exec(text);
  const locationValue = /var locationValue\s*=\s*"([^"]+)"/.exec(text);
  if (actionType && locationValue) {
    if (actionType[1].toUpperCase() !== 'GET') {
      throw new Error(`不支持的认证跳转方式：${actionType[1]}`);
    }
    await request(ctx.jar, decodeLocationValue(locationValue[1]));
  }
  return getByytUserInfo(ctx);
}

// ==================== BYYT 教务系统接口 ====================

export interface UstbUserInfo {
  name: string;
  school: string;
  userId: string;
}

export async function getByytUserInfo(ctx: UstbContext): Promise<UstbUserInfo> {
  const res = await request(ctx.jar, `${BYYT_BASE}/user/me`, { method: 'POST' });
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新扫码');
  const data = await readJson(res);
  if (!data) throw new Error(`用户信息响应异常（HTTP ${res.status}）`);
  const d = data.xm !== undefined ? data : data.data ?? {};
  if (d.xm === undefined) throw new Error(`获取用户信息失败：${data.msg ?? data.message ?? res.status}`);
  return { name: String(d.xm ?? ''), school: String(d.bmmc ?? ''), userId: String(d.yhdm ?? '') };
}

export interface ByytRawItem {
  key?: string;
  kbxx?: string;
}

/** 课表：POST /Xskbcx/queryXskbcxList，body { bs: '2', xn, xq } */
export async function fetchCurriculum(ctx: UstbContext, xn: string, xq: string): Promise<ByytRawItem[]> {
  const res = await request(ctx.jar, `${BYYT_BASE}/Xskbcx/queryXskbcxList`, {
    method: 'POST',
    form: { bs: '2', xn, xq },
  });
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新扫码');
  const data = await readJson(res);
  if (data === null) {
    if (res.status === 200) throw new Error('登录已失效，请重新扫码');
    throw new Error(`课表响应异常（HTTP ${res.status}）`);
  }
  if (Array.isArray(data)) return data;
  if (typeof data === 'object') {
    if (data.code !== 200) throw new Error(`课表接口错误：${data.msg ?? data.code}`);
    return Array.isArray(data.content) ? data.content : [];
  }
  return [];
}

export interface ByytPeriod {
  majorId: number; // 大节编号
  start: string;   // HH:mm
  end: string;     // HH:mm
  label: string;
}

/** 节次作息：POST /component/queryKbjg，body { xn, xq, nodataqx: '1' } */
export async function fetchPeriods(ctx: UstbContext, xn: string, xq: string): Promise<ByytPeriod[]> {
  const res = await request(ctx.jar, `${BYYT_BASE}/component/queryKbjg`, {
    method: 'POST',
    form: { xn, xq, nodataqx: '1' },
  });
  const data = await readJson(res);
  if (!data || data.code !== 200 || !Array.isArray(data.content)) return [];
  const byMajor = new Map<number, { start?: string; end?: string; label: string; minors: Array<[string, string]> }>();
  for (const it of data.content) {
    const majorId = Number(it.dj);
    if (!Number.isFinite(majorId) || majorId <= 0) continue;
    const e = byMajor.get(majorId) ?? { label: '', minors: [] };
    if (!e.label && it.djms) e.label = String(it.djms);
    if (it.kskssj) e.start = String(it.kskssj);
    if (it.ksjssj) e.end = String(it.ksjssj);
    if (it.kssj && it.jssj) e.minors.push([String(it.kssj), String(it.jssj)]);
    byMajor.set(majorId, e);
  }
  const out: ByytPeriod[] = [];
  for (const [majorId, e] of byMajor) {
    const minors = e.minors.sort();
    const start = e.start ?? minors[0]?.[0];
    const end = e.end ?? minors[minors.length - 1]?.[1];
    if (start && end) out.push({ majorId, start, end, label: e.label });
  }
  return out.sort((a, b) => a.majorId - b.majorId);
}

// ==================== 课表解析（kbxx 多行文本协议） ====================

export interface ParsedClassItem {
  day: number; // 1=周一 … 7=周日
  period: number; // 大节
  className: string;
  teacher: string;
  weeksText: string;
  weeks: number[];
  location: string;
  periodName: string;
}

/** "1-16周" / "1-16周(单)" / "1-8,10-16周" → 周次数组 */
export function parseWeeksText(text: string): number[] {
  const single = text.includes('单');
  const double = text.includes('双');
  const m = /([0-9][0-9,\-]*)/.exec(text.replace(/第/g, ''));
  if (!m) return [];
  const weeks: number[] = [];
  for (const part of m[1].split(',')) {
    const seg = part.split('-').map((n) => Number(n));
    const from = seg[0];
    if (!Number.isFinite(from) || from <= 0) continue;
    const to = Number.isFinite(seg[1]) ? seg[1] : from;
    for (let w = from; w <= to && w <= 40; w++) weeks.push(w);
  }
  if (single) return weeks.filter((w) => w % 2 === 1);
  if (double) return weeks.filter((w) => w % 2 === 0);
  return weeks;
}

/**
 * 解析单条课表：key 形如 "xq1_jc2"（星期1_大节2），kbxx 按行存
 * 课程名/教师/周次/地点/节次（行数不同含义不同，规则与 The-Beike convert.dart 一致）。
 */
export function parseClassItem(raw: ByytRawItem): ParsedClassItem | null {
  const key = raw.key ?? '';
  const kbxx = raw.kbxx ?? '';
  if (!key || !kbxx || key === 'bz') return null;
  const km = /xq(\d+)_jc(\d+)/.exec(key);
  if (!km) return null;

  const lines = kbxx.split('\n');
  let className = '';
  let teacher = '';
  let weeksText = '';
  let location = '';
  let periodName = '';
  if (lines.length >= 3 && lines.length <= 4) {
    [className, teacher, weeksText] = lines;
  } else if (lines.length === 5) {
    [className, teacher, weeksText, location, periodName] = lines;
  } else if (lines.length >= 6) {
    className = `${lines[0]}\n${lines[1]}`;
    teacher = lines[2];
    weeksText = lines[3];
    location = lines[4] ?? '';
    periodName = lines[5] ?? '';
  } else {
    return null;
  }

  return {
    day: Number(km[1]),
    period: Number(km[2]),
    className: className.trim(),
    teacher: (teacher ?? '').trim(),
    weeksText: (weeksText ?? '').trim(),
    weeks: parseWeeksText(weeksText ?? ''),
    location: (location ?? '').trim(),
    periodName: (periodName ?? '').trim(),
  };
}

export function parseCurriculum(raw: ByytRawItem[]): ParsedClassItem[] {
  const out: ParsedClassItem[] = [];
  for (const r of raw) {
    const item = parseClassItem(r);
    if (item && item.className) out.push(item);
  }
  return out;
}
