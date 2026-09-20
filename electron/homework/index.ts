/**
 * 作业发布 / 接收模块（主进程，码制协议 v2）
 *
 * 「作业包」= 一个课程的整套作业（含多节课条目），由一对随机码标识：
 *
 *   同步作业码（syncCode）—— 分享码，8 位，公开。
 *     接收方输入此码 → 从 GitHub（或云盘镜像）拉取 homework/<syncCode>.json
 *     → 按课程名匹配本地课程（缺失自动建课）→ 按 remote_id 去重导入。
 *
 *   作业发布码（publishCode）—— 密钥，12 位 = 同步码(8位) + 校验位(4位)，
 *     由 syncCode 经 HMAC-SHA256 派生校验位。发布方只需输入这一个码：
 *     App 本地解析出 syncCode 并校验（无需联网、无需服务端）
 *     → 凭 GitHub 令牌把包写入 homework/<syncCode>.json。
 *
 * 码可由 App 内生成（homework:generateCodes），也可由配套网站生成——
 * 网站端只要用同样的 SECRET + 派生算法即可产出一致的码对（见 docs/HOMEWORK-CODES.md）。
 *
 * 存储布局：
 *   GitHub: homework/<syncCode>.json   （读走 raw CDN 无限速；写走 Contents API 需令牌）
 *   北科云盘: <syncCode>-<时间戳>.json （v1.1.4，AnyShare 外链 + 提取码，需校园网；
 *             匿名可传不可覆盖，接收方按前缀取最新一份）
 *
 * 安全说明：
 *   - publishCode 只是 UI / 协议层门槛；真正的写权限由 GitHub 令牌控制
 *     （只存在发布者本机 settings 表，建议 fine-grained PAT 仅本仓库 Contents 读写）。
 *   - 派生算法内置在客户端，防君子不防逆向；对班级作业场景足够。
 */
import { net, ipcMain } from 'electron';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import type { DB } from '../db/index';
import {
  parseAnyShareUrl, findLatestByPrefix, getFileDownloadUrl, uploadTextFile,
  type AnyShareConfig,
} from '../anyshare';

// ==================== 配置 ====================
export const HOMEWORK_REPO_OWNER = 'NightRainStarGame';
export const HOMEWORK_REPO_NAME = 'USTBTaskManager';
export const HOMEWORK_BRANCH = 'main';
export const HOMEWORK_DIR = 'homework';

/**
 * 码对派生密钥（网站端生成码时必须使用同一字符串，见 docs/HOMEWORK-CODES.md）。
 * 改动此值会使所有已分发的发布码失效。
 */
export const CODE_SECRET = 'StarOS-Homework-Code-v1';

/** 码字符表：31 个字符，去掉 0/O/1/I/L 等易混淆字符 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const SYNC_CODE_LEN = 8;
const PUBLISH_CODE_LEN = 12;

const API = `https://api.github.com/repos/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}`;
const REPO_URL = `https://github.com/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}/tree/${HOMEWORK_BRANCH}/${HOMEWORK_DIR}`;

const SETTING_TOKEN = 'homework_github_token';
const SETTING_PUBLISHER = 'homework_publisher';
const SETTING_LAST_SYNC = 'homework_last_sync';
/** 每门课程对应的同步作业码：key 形如 homework_sync_<courseId>，value 是 8 位 syncCode */
const SETTING_COURSE_SYNC_PREFIX = 'homework_sync_';
/** 北科云盘（AnyShare）作业同步源配置（JSON：baseUrl/linkId/password/enabled） */
const SETTING_CLOUD = 'homework_anyshare';

/**
 * 北科云盘默认外链（v1.1.4）。该网盘通常仅在北京科技大学校园网内可达。
 * 用户可在设置里改外链 / 提取码 / 关闭。
 */
export const DEFAULT_ANYSHARE_CONFIG: AnyShareConfig & { enabled: boolean } = {
  baseUrl: 'https://yunpan.ustb.edu.cn',
  linkId: 'AADAAEA94FBE6B4435B8D14A236FAC6469',
  password: 'kc26',
  enabled: true,
};

function getAnyShareConfig(db: DB): (AnyShareConfig & { enabled: boolean }) | null {
  const raw = getSetting(db, SETTING_CLOUD);
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && j.linkId) {
        return {
          baseUrl: String(j.baseUrl || DEFAULT_ANYSHARE_CONFIG.baseUrl),
          linkId: String(j.linkId),
          password: String(j.password || ''),
          enabled: j.enabled !== false,
        };
      }
    } catch { /* fallthrough */ }
  }
  return { ...DEFAULT_ANYSHARE_CONFIG };
}

const FETCH_TIMEOUT_MS = 20000;

// ==================== 码制 ====================
/** 在字母表上生成 n 位随机码 */
function randomCode(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** 把字节串映射到字母表 */
function bytesToCode(buf: Buffer, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

/** 生成一对码：随机 syncCode + 自包含校验的 publishCode */
export function generateCodePair(): { syncCode: string; publishCode: string } {
  const syncCode = randomCode(SYNC_CODE_LEN);
  return { syncCode, publishCode: derivePublishCode(syncCode) };
}

/**
 * publishCode = syncCode(8位) + 校验位(4位)。
 * 前缀直接携带 syncCode（发布作业只需输入这一个码），后 4 位由
 * HMAC-SHA256(SECRET, 'publish:' + syncCode) 映射到字母表，防止随手编造。
 */
export function derivePublishCode(syncCode: string): string {
  const s = (syncCode || '').trim().toUpperCase();
  const mac = createHmac('sha256', CODE_SECRET).update(`publish:${s}`).digest();
  return s + bytesToCode(mac, PUBLISH_CODE_LEN - SYNC_CODE_LEN);
}

/**
 * 从发布码解析出同步码（发布码自包含：前 8 位即同步码，后 4 位校验）。
 * 非法/编造的码返回 null。这就是「发布作业只输发布码」的验证入口。
 */
export function parsePublishCode(raw: string): string | null {
  const p = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== PUBLISH_CODE_LEN) return null;
  if (![...p].every((c) => CODE_ALPHABET.includes(c))) return null;
  const syncCode = p.slice(0, SYNC_CODE_LEN);
  if (derivePublishCode(syncCode) !== p) return null;
  return syncCode;
}

/** 校验码对是否匹配（兼容旧调用：两码都在手上时使用） */
export function verifyCodePair(syncCode: string, publishCode: string): boolean {
  const s = normalizeSyncCode(syncCode);
  if (!s) return false;
  return parsePublishCode(publishCode) === s;
}

/** 规范化 syncCode（去分隔符、大写、校验长度与字符表） */
function normalizeSyncCode(raw: string): string | null {
  const s = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== SYNC_CODE_LEN) return null;
  if (![...s].every((c) => CODE_ALPHABET.includes(c))) return null;
  return s;
}

// ==================== 类型 ====================
export type HomeworkType = 'homework' | 'exam' | 'project' | 'reading' | 'other';

export interface HomeworkEntry {
  /** 稳定 ID（uuid，同步去重键） */
  id: string;
  courseName: string;
  /** 上课日期 YYYY-MM-DD（每节课作业可能不同） */
  sessionDate: string;
  /** 上课时段，如 "08:00-09:35"（可选） */
  sessionTime?: string | null;
  title: string;
  content: string;
  type: HomeworkType;
  /** 截止时间 ms（可选，缺省用上课日 23:59） */
  dueDate?: number | null;
  publisher: string;
  publishedAt: number;
  updatedAt: number;
}

interface HomeworkFile {
  syncCode: string;
  courseName: string;
  /** v1.1.6：发布方课程的 guid（接收端优先按它精确挂载，避开同名歧义；老包没有） */
  courseGuid?: string;
  createdAt: number;
  updatedAt: number;
  entries: HomeworkEntry[];
}

export interface CodePair {
  syncCode: string;
  publishCode: string;
}

export interface PublishPayload {
  /** 可不传；传了必须与发布码前缀一致（发布码自包含同步码） */
  syncCode?: string;
  /** 可不传：仅在发布方想加一道「只有自己知道密钥」时输入；留空 = 任何人凭 syncCode + GitHub PAT 即可发布 */
  publishCode?: string;
  /** v1.1.4：发布目标。github（默认，需令牌）| cloud（北科云盘，需校园网） */
  target?: 'github' | 'cloud';
  /** v1.1.6：发布课程本地 ID（主进程据此查/生成 guid 写进包里，接收端精确挂载） */
  courseId?: number;
  courseName: string;
  sessionDate: string;
  sessionTime?: string | null;
  title: string;
  content: string;
  type?: HomeworkType;
  dueDate?: number | null;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  /** 命中的源名（github / cloud） */
  source?: string;
  syncCode?: string;
  courseName?: string;
  entries: number;
  created: number;
  updated: number;
  coursesTouched: number;
  coursesCreated: string[];
  items: Array<{ courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
  syncedAt: number;
  /** v1.1.3 起：远端 bundle 引用了一个本地没有的课程，让前端弹窗询问是否新建 */
  courseNotFound?: boolean;
  /** v1.1.6：本地存在多门同名课程且包里无 guid 可辨 → 返回候选让前端弹窗手选 */
  courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
}

// ==================== settings 读写 ====================
function getSetting(db: DB, key: string): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
}
function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

// ==================== 工具 ====================
/** 课程名兜底展示（旧协议按课程 slug 存文件，这里仅用于展示） */
export function courseSlug(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'course';
}

function decodeBase64Utf8(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** 统一网络请求（带超时 + 令牌） */
async function ghFetch(path: string, opts: { method?: string; token?: string; body?: any; raw?: boolean } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'User-Agent': 'TaskManager-Homework',
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await net.fetch(url, { method: opts.method || 'GET', headers, body, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 把网络/HTTP 异常翻译成人话 */
function describeError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/abort|timeout/i.test(msg)) return `请求超时（超过 ${FETCH_TIMEOUT_MS / 1000} 秒无响应），GitHub 可能暂时不可达`;
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) return '无法解析 api.github.com，请检查网络（无法连接 GitHub 可点设置页里的解决教程）';
  if (/ERR_CONNECTION|ECONNRESET|ETIMED_OUT|Failed to fetch/i.test(msg)) return '连接 GitHub 失败，网络不可达（无法连接 GitHub 可点设置页里的解决教程）';
  return msg || '未知错误';
}

function describeStatus(status: number, text: string): string {
  let detail = '';
  try { detail = JSON.parse(text)?.message || ''; } catch { /* ignore */ }
  if (status === 401) return 'GitHub 令牌无效或已过期，请重新填写（发布时的令牌设置）';
  if (status === 403) return /rate limit/i.test(detail) ? 'GitHub API 速率限制（匿名每小时 60 次），稍后再试或配置发布令牌' : `没有权限（${detail || status}）。令牌需要对 ${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME} 的 Contents 读写权限`;
  if (status === 404) return '作业包不存在（检查同步作业码是否输对，或发布者是否已发布）';
  if (status === 409) return '文件已被其他人更新（写入冲突），请重试一次';
  return `GitHub 返回 ${status}${detail ? '：' + detail : ''}`;
}

// ==================== 源适配器 ====================
/**
 * 作业包数据源接口。v1.1.4 起有两个实现：
 *   - GitHub（读走 raw.githubusercontent.com CDN，**不受 API 60 次/小时限制**；写走 Contents API）
 *   - 北科云盘（AnyShare 外链 + 提取码，需校园网；匿名可传、不可覆盖/删除）
 */
export interface HomeworkSource {
  name: string;
  /** 按 syncCode 拉取作业包；返回 null = 该源没有这个包 */
  fetchBundle(syncCode: string, token?: string): Promise<{ file: HomeworkFile } | null>;
}

const RAW_BASE = `https://raw.githubusercontent.com/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}/${HOMEWORK_BRANCH}`;

/** GitHub 源：优先 raw CDN（无限速），失败再回退 Contents API */
const githubSource: HomeworkSource = {
  name: 'github',
  async fetchBundle(syncCode) {
    const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;
    // 1) raw CDN —— 接收方高频路径，不走 API 配额。
    //    但 raw.githubusercontent.com 有 1-5 分钟级 CDN 缓存，发布后立刻读取可能拿到旧/空文件。
    //    发现 syncCode 不一致或 entries 缺失就回退 Contents API 拿实时数据。
    try {
      const r = await ghFetch(`${RAW_BASE}/${filePath}?t=${Date.now()}`, { raw: true });
      if (r.ok) {
        try {
          const file = JSON.parse(r.text) as HomeworkFile;
          if (file && Array.isArray(file.entries) && file.syncCode === syncCode) return { file };
          // 文件存在但 syncCode 不对 = CDN stale 给到同名旧文件 → 继续回退
        } catch { /* 解析失败也回退 */ }
      } else if (r.status !== 404) {
        // 非 404 错误（5xx、解析失败）→ 留给 API 兜底
      }
    } catch { /* raw 不可达：继续试 API，别把网络错误直接抛出去 */ }
    // 2) Contents API 回退（匿名每小时 60 次，仅兜底；保证 publish 后实时可读）
    const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(describeStatus(r.status, r.text));
    const meta = JSON.parse(r.text);
    const file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
    if (!file || !Array.isArray(file.entries)) throw new Error('远端作业包损坏（entries 缺失）');
    return { file };
  },
};

/**
 * 北科云盘源（v1.1.4）：分享根目录下的作业包文件名为 `<syncCode>-<时间戳>.json`
 * （匿名无法覆盖同名文件，每次发布写一个新文件）。接收时按前缀取修改时间最新的一份。
 */
const anyshareSource: HomeworkSource = {
  name: 'ustb-cloud',
  async fetchBundle(syncCode) {
    const cfg = anyshareCtx();
    if (!cfg || !cfg.enabled) return null;
    const latest = await findLatestByPrefix(cfg, `${syncCode}-`);
    if (!latest) return null;
    const url = await getFileDownloadUrl(cfg, latest);
    const r = await ghFetch(url, { raw: true });
    if (!r.ok) throw new Error(`北科云盘下载作业包失败（HTTP ${r.status}）`);
    const file = JSON.parse(r.text) as HomeworkFile;
    if (!file || !Array.isArray(file.entries)) throw new Error('北科云盘作业包损坏（entries 缺失）');
    return { file };
  },
};

/** 当前 DB 的云盘配置（注册 IPC 时注入，模块级函数用） */
let _db: DB | null = null;
function anyshareCtx(): (AnyShareConfig & { enabled: boolean }) | null {
  if (!_db) return null;
  try { return getAnyShareConfig(_db); } catch { return null; }
}

/** 按优先级依次尝试各源，返回第一个命中的包 */
async function fetchBundleFromAnySource(syncCode: string, token?: string): Promise<{ source: string; file: HomeworkFile } | null> {
  const errors: string[] = [];
  let confirmedMissing = false;
  const sources: HomeworkSource[] = [githubSource, anyshareSource];
  for (const src of sources) {
    try {
      const hit = await src.fetchBundle(syncCode, token);
      if (hit) return { source: src.name, file: hit.file };
      // 该源**确认**没有这个码（GitHub 404 / 云盘目录里没有前缀文件）
      confirmedMissing = true;
    } catch (e: any) {
      errors.push(`${src.name}: ${e?.message || e}`);
    }
  }
  // 任一源明确「没有这个码」时按不存在处理：
  // 其余源可能只是网络不可达（典型：不在校园网时云盘源必失败），不应遮蔽「码不存在」语义
  if (confirmedMissing) return null;
  if (errors.length) throw new Error(errors.join('；'));
  return null;
}

// ==================== 发布 ====================
/** 取/生成某课程对应的同步作业码（首次为该课程发布时落地） */
function getOrCreateCourseSyncCode(db: DB, courseId: number | null | undefined): string {
  if (!courseId) return generateCodePair().syncCode;
  const key = SETTING_COURSE_SYNC_PREFIX + courseId;
  const existing = normalizeSyncCode(getSetting(db, key));
  if (existing) return existing;
  const fresh = generateCodePair().syncCode;
  setSetting(db, key, fresh);
  return fresh;
}

/** 取某课程的同步作业码（没存过就返回空，不落地） */
function getCourseSyncCode(db: DB, courseId: number | null | undefined): string {
  if (!courseId) return '';
  return normalizeSyncCode(getSetting(db, SETTING_COURSE_SYNC_PREFIX + courseId)) || '';
}

/** v1.1.6：取课程 guid（db 迁移会给所有课程回填；这里兜底自生成一次） */
function getOrCreateCourseGuid(db: DB, courseId: number | null | undefined): string {
  if (!courseId) return '';
  const row = db.prepare('SELECT guid FROM courses WHERE id = ?').get(courseId) as { guid?: string | null } | undefined;
  const g = (row?.guid || '').trim();
  if (g) return g;
  let fresh = 'C-';
  for (let i = 0; i < 8; i++) fresh += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  db.prepare('UPDATE courses SET guid = ? WHERE id = ?').run(fresh, courseId);
  return fresh;
}

/**
 * 发布/更新一条作业到 homework/<syncCode>.json。
 * 幂等：同一课程同一上课日期 + 同标题 → 覆盖更新远端已有条目（保留其 id，接收端无感）。
 * - publishCode 可选：填了 = 校验 HMAC；空 = 仅依赖 GitHub PAT
 * - syncCode 可选：填了直接用；空且 courseId 给了 → 用该课程持久化的（首次自动生成）；
 *   都没有 → 返回错误
 */
export async function publishHomework(db: DB, payload: PublishPayload): Promise<{ ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string; syncCode?: string; bundleCreated?: boolean; anyshareRaw?: string }> {
  // 1) 发布码验证（可选；填了就要通过 HMAC）
  let syncCode: string | undefined;
  if (payload.publishCode && payload.publishCode.trim()) {
    const decoded = parsePublishCode(payload.publishCode);
    if (!decoded) return { ok: false, error: `作业发布码格式不对（${PUBLISH_CODE_LEN} 位，字母数字，不含 0/O/1/I/L）` };
    syncCode = decoded;
    if (payload.syncCode && normalizeSyncCode(payload.syncCode) !== syncCode) {
      return { ok: false, error: '作业发布码与同步作业码不匹配' };
    }
  } else if (payload.syncCode) {
    const normalized = normalizeSyncCode(payload.syncCode);
    if (!normalized) return { ok: false, error: `同步作业码格式不对（${SYNC_CODE_LEN} 位）` };
    syncCode = normalized;
  } else if ((payload as any).courseId) {
    syncCode = getOrCreateCourseSyncCode(db, (payload as any).courseId);
  } else {
    return { ok: false, error: '缺少同步作业码：要么填入「作业发布码」或「同步作业码」，要么在「课程」下选择一个具体课程（首次发布会自动生成）' };
  }

  const courseName = (payload.courseName || '').trim();
  const title = (payload.title || '').trim();
  const sessionDate = (payload.sessionDate || '').trim();
  if (!courseName) return { ok: false, error: '请选择课程' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { ok: false, error: '请选择上课日期' };
  if (!title) return { ok: false, error: '请填写作业标题' };

  const target = payload.target === 'cloud' ? 'cloud' : 'github';
  const publisher = getSetting(db, SETTING_PUBLISHER).trim() || '佚名';
  const courseGuid = getOrCreateCourseGuid(db, payload.courseId ?? (payload as any).courseId);

  const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;

  // ===== 云盘（北科云盘）目标 =====
  if (target === 'cloud') {
    const cfg = getAnyShareConfig(db);
    if (!cfg || !cfg.enabled) return { ok: false, error: '北科云盘同步源未启用（设置 → 作业同步）' };
    // 读云盘现有包（没有 = 首次发布）
    let file: HomeworkFile = { syncCode, courseName, createdAt: Date.now(), updatedAt: 0, entries: [] };
    try {
      const latest = await findLatestByPrefix(cfg, `${syncCode}-`);
      if (latest) {
        const url = await getFileDownloadUrl(cfg, latest);
        const r = await ghFetch(url, { raw: true });
        if (r.ok) {
          const remote = JSON.parse(r.text) as HomeworkFile;
          if (remote && Array.isArray(remote.entries)) file = remote;
        }
      }
    } catch { /* 云盘读失败按首次发布处理 */ }
    const merged = mergeEntry(file, { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid });
    // 匿名无法覆盖同名 → 每次发布写一个新文件 <syncCode>-<时间戳>.json
    const cloudName = `${syncCode}-${Date.now()}.json`;
    try {
      await uploadTextFile(cfg, cloudName, JSON.stringify(merged.file, null, 2));
    } catch (e: any) {
      // v1.1.5: 把 asFetch 透传的 anyshareRaw 一并回给前端，方便排障
      const raw = (e as any)?.anyshareRaw;
      return {
        ok: false,
        error: `上传北科云盘失败：${e?.message || e}`,
        anyshareRaw: raw ? JSON.stringify(raw) : undefined,
      };
    }
    return {
      ok: true,
      entry: merged.entry,
      fileUrl: `${cfg.baseUrl}/link/${cfg.linkId}`,
      syncCode,
      bundleCreated: !merged.existing,
    };
  }

  // ===== GitHub 目标 =====
  const token = getSetting(db, SETTING_TOKEN).trim();
  if (!token) return { ok: false, error: '尚未配置 GitHub 发布令牌（第一次发布时填写，保存在本机）' };

  // 2) 读取远端现有包（404 = 首次发布）
  let file: HomeworkFile;
  let sha: string | undefined;
  {
    const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token });
    if (r.status === 404) {
      file = { syncCode, courseName, createdAt: Date.now(), updatedAt: 0, entries: [] };
    } else if (!r.ok) {
      return { ok: false, error: describeStatus(r.status, r.text) };
    } else {
      try {
        const meta = JSON.parse(r.text);
        sha = meta.sha;
        file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
        if (!Array.isArray(file.entries)) file.entries = [];
        // 包已存在但课程名不同：以最新发布为准（一个包一个课程）
        file.courseName = courseName;
      } catch {
        return { ok: false, error: '远端作业包损坏（JSON 解析失败），可到仓库里手动修正后重试' };
      }
    }
  }

  const { file: mergedFile, entry, existing } = mergeEntry(file, { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid });

  // 4) 写回（一次 409 冲突重试）
  const put = async (currentSha?: string) => {
    const body = {
      message: `homework: ${existing ? '更新' : '发布'} [${syncCode}] ${courseName} ${sessionDate} ${title}`,
      content: Buffer.from(JSON.stringify(mergedFile, null, 2), 'utf8').toString('base64'),
      branch: HOMEWORK_BRANCH,
      ...(currentSha ? { sha: currentSha } : {}),
    };
    return ghFetch(`/contents/${filePath}`, { method: 'PUT', token, body });
  };
  let r = await put(sha);
  if (r.status === 409 || r.status === 422) {
    const g = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token });
    if (g.ok) { try { sha = JSON.parse(g.text).sha; } catch { /* ignore */ } }
    r = await put(sha);
  }
  if (!r.ok) return { ok: false, error: describeStatus(r.status, r.text) };

  return {
    ok: true,
    entry,
    fileUrl: `${REPO_URL}/${syncCode}.json`,
    syncCode,
    bundleCreated: !existing,
  };
}

function randomUUIDSafe(): string {
  try { return randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/** 组装/合并一条作业到包里（同日期 + 同标题 → 覆盖；幂等，返回新 file 与条目） */
function mergeEntry(
  base: HomeworkFile,
  ctx: {
    syncCode: string; courseName: string; sessionDate: string; title: string;
    payload: PublishPayload; publisher: string; courseGuid: string;
  }
): { file: HomeworkFile; entry: HomeworkEntry; existing: HomeworkEntry | undefined } {
  const { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid } = ctx;
  const now = Date.now();
  const existing = base.entries.find(
    (e) => e.sessionDate === sessionDate && e.title === title
  );
  const entry: HomeworkEntry = {
    id: existing?.id || randomUUIDSafe(),
    courseName,
    sessionDate,
    sessionTime: payload.sessionTime || existing?.sessionTime || null,
    title,
    content: (payload.content || '').trim(),
    type: payload.type || 'homework',
    dueDate: payload.dueDate ?? existing?.dueDate ?? null,
    publisher,
    publishedAt: existing?.publishedAt || now,
    updatedAt: now,
  };
  const file: HomeworkFile = { ...base };
  file.entries = existing
    ? base.entries.map((e) => (e.id === entry.id ? entry : e))
    : [...base.entries, entry];
  file.syncCode = syncCode;
  // v1.1.6：以最新发布为准更新包级 guid（老包第一次被新版发布后就有 guid 了）
  if (courseGuid) file.courseGuid = courseGuid;
  file.courseName = courseName;
  file.updatedAt = now;
  file.entries.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
  return { file, entry, existing };
}

/** 拉取某码包的远端已发布作业（发布对话框里展示，避免重复发布） */
export async function fetchRemoteEntries(db: DB, syncCode: string): Promise<{ ok: boolean; error?: string; entries: HomeworkEntry[]; courseName?: string }> {
  const code = normalizeSyncCode(syncCode);
  if (!code) return { ok: false, error: '同步作业码格式不对', entries: [] };
  const token = getSetting(db, SETTING_TOKEN).trim();
  try {
    const hit = await fetchBundleFromAnySource(code, token || undefined);
    if (!hit) return { ok: true, entries: [], courseName: undefined };
    return { ok: true, entries: hit.file.entries, courseName: hit.file.courseName };
  } catch (e: any) {
    return { ok: false, error: e?.message || '拉取失败', entries: [] };
  }
}

// ==================== 接收 ====================
/**
 * 按同步作业码拉取一个作业包并写入本地课程。
 * v1.1.6 课程匹配链：用户手选 courseId > 包内 courseGuid 精确命中 > 同名唯一 > 同名多个（返回候选让前端弹窗）> 无同名（courseNotFound）。
 */
export async function receiveHomework(db: DB, rawSyncCode: string, chooseCourseId?: number | null): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false, entries: 0, created: 0, updated: 0,
    coursesTouched: 0, coursesCreated: [], items: [], syncedAt: Date.now(),
  };
  const syncCode = normalizeSyncCode(rawSyncCode);
  if (!syncCode) {
    result.error = `同步作业码格式不对（${SYNC_CODE_LEN} 位，字母数字，不含 0/O/1/I/L）`;
    return result;
  }
  result.syncCode = syncCode;

  const token = getSetting(db, SETTING_TOKEN).trim();
  let hit: { source: string; file: HomeworkFile } | null;
  try {
    hit = await fetchBundleFromAnySource(syncCode, token || undefined);
  } catch (e: any) {
    result.error = e?.message || describeError(e);
    return result;
  }
  if (!hit) {
    result.error = `没有找到同步作业码 ${syncCode} 对应的作业包（GitHub / 云盘均无此码，请确认码是否输对）`;
    return result;
  }

  const { source, file } = hit;
  result.source = source;
  result.courseName = file.courseName;

  const courseName = (file.courseName || '').trim();
  if (!courseName) {
    result.error = '作业包缺少课程名，无法导入';
    return result;
  }

  // ===== v1.1.6 课程匹配链 =====
  // 1) 用户在前端弹窗里手选了课程（同名多课时前端传回 chooseCourseId）→ 直接用
  let hitCourse: { id: number } | undefined;
  if (chooseCourseId) {
    hitCourse = db.prepare('SELECT id FROM courses WHERE id = ?').get(chooseCourseId) as { id: number } | undefined;
    if (!hitCourse) {
      result.error = '所选课程不存在（可能刚被删除），请重试';
      return result;
    }
  } else {
    // 2) 包内 guid 精确命中（v1.1.6 起发布包都带；同名课程靠它区分）
    const courseGuid = (file.courseGuid || '').trim();
    if (courseGuid) {
      hitCourse = db.prepare('SELECT id FROM courses WHERE guid = ?').get(courseGuid) as { id: number } | undefined;
    }
    // 3) guid 没命中（老包 / 接收方没同步过这门课）→ 按课程名兜底
    if (!hitCourse) {
      const sameName = db.prepare('SELECT id, name, code, instructor FROM courses WHERE TRIM(name) = ?').all(courseName) as Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
      if (sameName.length === 1) {
        hitCourse = sameName[0];
      } else if (sameName.length > 1) {
        // 同名多门且无法辨别 → 让前端弹窗手选，绝不静默挂到第一门
        result.courseCandidates = sameName;
        result.error = `本地有 ${sameName.length} 门同名课程「${courseName}」，且作业包无法辨别是哪一门，请选择挂载目标`;
        return result;
      }
    }
  }
  // 4) 没有任何匹配 → 前端弹窗询问是否新建（避免误建空课）
  if (!hitCourse) {
    result.courseName = courseName;
    result.courseNotFound = true;
    result.error = `本地没有课程「${courseName}」，请先在「课程」页新建/同步该课程，再点接收`;
    return result;
  }
  const courseId = hitCourse.id;
  result.coursesTouched = 1;

  // 条目写入：remote_id 去重；已存在则只更新内容字段，不动本地完成状态
  for (const e of file.entries) {
    if (!e || !e.id || !e.title) continue;
    result.entries++;
    const due = e.dueDate && Number.isFinite(e.dueDate)
      ? e.dueDate
      : new Date(`${e.sessionDate || '1970-01-01'}T23:59:00`).getTime();
    const local = db.prepare('SELECT id FROM course_requirements WHERE remote_id = ?').get(e.id) as { id: number } | undefined;
    if (local) {
      db.prepare(
        `UPDATE course_requirements SET title=?, type=?, description=?, due_date=?, session_date=?, publisher=?
         WHERE id=?`
      ).run(
        e.title, (e.type || 'homework'), e.content || '', due, e.sessionDate || null,
        e.publisher || null, local.id
      );
      result.updated++;
    } else {
      db.prepare(
        `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status,
           estimated_hours, actual_hours, notes, created_at, source, remote_id, session_date, publisher)
         VALUES (?, ?, ?, ?, ?, 2, 'pending', NULL, NULL, ?, ?, 'github', ?, ?, ?)`
      ).run(
        courseId, e.title, (e.type || 'homework'), e.content || '', due,
        `来源：${source === 'ustb-cloud' ? '北科云盘' : 'GitHub'} 接收 · 码 ${syncCode} · 发布人 ${e.publisher || '佚名'} · ${e.sessionDate || ''}${e.sessionTime ? ' ' + e.sessionTime : ''}`,
        Date.now(), e.id, e.sessionDate || null, e.publisher || null
      );
      result.created++;
    }
    result.items.push({ courseName, title: e.title, sessionDate: e.sessionDate || '', action: local ? 'updated' : 'created' });
  }

  result.ok = true;
  setSetting(db, SETTING_LAST_SYNC, String(Date.now()));
  return result;
}

// ==================== IPC ====================
export function registerHomework(db: DB) {
  _db = db;
  ipcMain.handle('homework:config', () => {
    const cloud = getAnyShareConfig(db);
    return {
      repo: `${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}`,
      branch: HOMEWORK_BRANCH,
      dir: HOMEWORK_DIR,
      repoUrl: REPO_URL,
      tokenSet: !!getSetting(db, SETTING_TOKEN).trim(),
      publisher: getSetting(db, SETTING_PUBLISHER),
      lastSync: Number(getSetting(db, SETTING_LAST_SYNC)) || null,
      cloudSourceEnabled: !!(cloud && cloud.enabled),
      cloud: cloud ? { baseUrl: cloud.baseUrl, linkId: cloud.linkId, password: cloud.password, enabled: cloud.enabled } : null,
    };
  });

  /** v1.1.4：保存北科云盘作业同步源配置（外链地址 + 提取码 + 启用开关） */
  ipcMain.handle('homework:saveCloud', (_e, cfg: { url?: string; password?: string; enabled?: boolean }) => {
    const current = getAnyShareConfig(db) || { ...DEFAULT_ANYSHARE_CONFIG };
    let next: AnyShareConfig & { enabled: boolean };
    if (cfg?.url && String(cfg.url).trim()) {
      const parsed = parseAnyShareUrl(String(cfg.url));
      if (!parsed) return { ok: false, error: '外链地址不像北科云盘分享链接（形如 https://yunpan.ustb.edu.cn/link/XXXX…）' };
      next = { ...parsed, password: String(cfg.password ?? current.password ?? '').trim(), enabled: cfg.enabled !== false };
    } else {
      next = { ...current, password: String(cfg?.password ?? current.password ?? '').trim(), enabled: cfg?.enabled !== false };
    }
    setSetting(db, SETTING_CLOUD, JSON.stringify(next));
    return { ok: true, cloud: next };
  });

  ipcMain.handle('homework:saveAuth', (_e, token: string, publisher: string) => {
    const t = (token || '').trim();
    if (t && !/^(gh[a-z]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$/.test(t)) {
      return { ok: false, error: '令牌格式不像 GitHub PAT（应以 ghp_ / github_pat_ 开头）' };
    }
    if (t) setSetting(db, SETTING_TOKEN, t);
    if ((publisher || '').trim()) setSetting(db, SETTING_PUBLISHER, publisher.trim());
    return { ok: true, tokenSet: !!getSetting(db, SETTING_TOKEN).trim() };
  });

  /** 生成一对新码（App 端生成；网站端生成需用相同 SECRET，见协议文档） */
  ipcMain.handle('homework:generateCodes', () => {
    const pair = generateCodePair();
    return { ok: true, ...pair };
  });

  /** 校验发布码（本地 HMAC 比对，无需联网）；通过则一并返回解析出的同步码 */
  ipcMain.handle('homework:verifyCodes', (_e, publishCode: string) => {
    const syncCode = parsePublishCode(publishCode);
    return syncCode ? { ok: true, syncCode } : { ok: false };
  });

  /** v1.1.3：取某课程已持久化的同步作业码（首次自动生成）；没指定 courseId 返回空 */
  ipcMain.handle('homework:courseSyncCode', (_e, courseId: number | null | undefined) => {
    if (!courseId) return { ok: false, syncCode: '', error: '请指定 courseId' };
    const existing = getCourseSyncCode(db, courseId);
    if (existing) return { ok: true, syncCode: existing };
    const fresh = getOrCreateCourseSyncCode(db, courseId);
    return { ok: true, syncCode: fresh };
  });

  ipcMain.handle('homework:publish', async (_e, payload: PublishPayload) => {
    try {
      return await publishHomework(db, payload);
    } catch (e: any) {
      return { ok: false, error: describeError(e) };
    }
  });

  ipcMain.handle('homework:remoteEntries', async (_e, syncCode: string) => {
    try {
      return await fetchRemoteEntries(db, syncCode);
    } catch (e: any) {
      return { ok: false, error: describeError(e), entries: [] };
    }
  });

  ipcMain.handle('homework:receive', async (_e, syncCode: string, chooseCourseId?: number | null) => {
    try {
      return await receiveHomework(db, syncCode, chooseCourseId);
    } catch (e: any) {
      return { ok: false, error: describeError(e), entries: 0, created: 0, updated: 0, coursesTouched: 0, coursesCreated: [], items: [], syncedAt: Date.now() } as SyncResult;
    }
  });
}
