/**
 * 作业发布 / 接收模块（码制协议 v2）
 *
 * 作业包 = 一个课程的整套作业（多节课条目）。由 syncCode（8位分享码）+ publishCode（12位密钥）标识：
 *   - publishCode 自包含：前 8 位即 syncCode，后 4 位 HMAC 校验位，发布作业只输一个码
 *   - 接收方凭 syncCode 拉包 → 按 courseKey（CK- + 哈希(课程名|老师)）匹配课程 → remote_id 去重导入
 *
 * 存储布局：
 *   GitHub:   homework/<syncCode>.json
 *   北科云盘: homework/<publishCode>/<courseKey>-<时间戳>.json（旧扁平 <syncCode>-<ts> 自动兼容）
 *
 * 详见 docs/HOMEWORK-CODES.md。
 */
import { net, ipcMain } from 'electron';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import type { DB } from '../db/index';
import { computeCourseKey } from '../db/index';
import {
  parseAnyShareUrl, findLatestByPrefix, getFileDownloadUrl,
  getShareRoot, ensureShareDir, listDir, findLatestByPrefixIn, uploadTextFileToDir,
  type AnyShareConfig, type AnyShareFile,
} from '../anyshare';

export const HOMEWORK_REPO_OWNER = 'NightRainStarGame';
export const HOMEWORK_REPO_NAME = 'USTBTaskManager';
export const HOMEWORK_BRANCH = 'main';
export const HOMEWORK_DIR = 'homework';

/** 码对派生密钥（网站端生成码时必须使用同一字符串，改动会使已分发的发布码失效） */
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
const SETTING_COURSE_SYNC_PREFIX = 'homework_sync_';
const SETTING_CLOUD = 'homework_anyshare';

/** 北科云盘默认外链。仅在北京科技大学校园网内可达；用户可在设置里改/关 */
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
    } catch {}
  }
  return { ...DEFAULT_ANYSHARE_CONFIG };
}

const FETCH_TIMEOUT_MS = 20000;

function randomCode(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function bytesToCode(buf: Buffer, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

export function generateCodePair(): { syncCode: string; publishCode: string } {
  const syncCode = randomCode(SYNC_CODE_LEN);
  return { syncCode, publishCode: derivePublishCode(syncCode) };
}

/** publishCode = syncCode(8位) + HMAC-SHA256 校验位(4位) */
export function derivePublishCode(syncCode: string): string {
  const s = (syncCode || '').trim().toUpperCase();
  const mac = createHmac('sha256', CODE_SECRET).update(`publish:${s}`).digest();
  return s + bytesToCode(mac, PUBLISH_CODE_LEN - SYNC_CODE_LEN);
}

/** 校验发布码并提取 syncCode；非法返回 null（这是「只输发布码就能发布」的本地验证入口） */
export function parsePublishCode(raw: string): string | null {
  const p = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (p.length !== PUBLISH_CODE_LEN) return null;
  if (![...p].every((c) => CODE_ALPHABET.includes(c))) return null;
  const syncCode = p.slice(0, SYNC_CODE_LEN);
  if (derivePublishCode(syncCode) !== p) return null;
  return syncCode;
}

export function verifyCodePair(syncCode: string, publishCode: string): boolean {
  const s = normalizeSyncCode(syncCode);
  if (!s) return false;
  return parsePublishCode(publishCode) === s;
}

function normalizeSyncCode(raw: string): string | null {
  const s = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== SYNC_CODE_LEN) return null;
  if (![...s].every((c) => CODE_ALPHABET.includes(c))) return null;
  return s;
}

export type HomeworkType = 'homework' | 'exam' | 'project' | 'reading' | 'other';

export interface HomeworkEntry {
  id: string;
  courseName: string;
  sessionDate: string;
  sessionTime?: string | null;
  title: string;
  content: string;
  type: HomeworkType;
  dueDate?: number | null;
  publisher: string;
  publishedAt: number;
  updatedAt: number;
}

interface HomeworkFile {
  syncCode: string;
  courseName: string;
  courseGuid?: string;
  courseKey?: string;
  createdAt: number;
  updatedAt: number;
  entries: HomeworkEntry[];
}

export interface CodePair {
  syncCode: string;
  publishCode: string;
}

export interface PublishPayload {
  syncCode?: string;
  publishCode?: string;
  targets?: ('github' | 'cloud')[];
  /** @deprecated v1.1.6 起改用 targets */
  target?: 'github' | 'cloud';
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
  courseNotFound?: boolean;
  courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
}

function getSetting(db: DB, key: string): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
}
function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

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

function describeError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/abort|timeout/i.test(msg)) return `请求超时（超过 ${FETCH_TIMEOUT_MS / 1000} 秒无响应），GitHub 可能暂时不可达`;
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) return '无法解析 api.github.com，请检查网络';
  if (/ERR_CONNECTION|ECONNRESET|ETIMED_OUT|Failed to fetch/i.test(msg)) return '连接 GitHub 失败，网络不可达';
  return msg || '未知错误';
}

function describeStatus(status: number, text: string): string {
  let detail = '';
  try { detail = JSON.parse(text)?.message || ''; } catch {}
  if (status === 401) return 'GitHub 令牌无效或已过期，请重新填写';
  if (status === 403) return /rate limit/i.test(detail) ? 'GitHub API 速率限制（匿名每小时 60 次），稍后再试或配置发布令牌' : `没有权限（${detail || status}）。令牌需要对 ${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME} 的 Contents 读写权限`;
  if (status === 404) return '作业包不存在（检查同步作业码是否输对）';
  if (status === 409) return '文件已被其他人更新（写入冲突），请重试一次';
  return `GitHub 返回 ${status}${detail ? '：' + detail : ''}`;
}

export interface HomeworkSource {
  name: string;
  fetchBundle(syncCode: string, token?: string): Promise<{ file: HomeworkFile } | null>;
}

const RAW_BASE = `https://raw.githubusercontent.com/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}/${HOMEWORK_BRANCH}`;

const githubSource: HomeworkSource = {
  name: 'github',
  async fetchBundle(syncCode) {
    const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;
    // raw CDN 无限速但有 1-5 分钟缓存；CDN 给空或 syncCode 不一致就回退 Contents API
    try {
      const r = await ghFetch(`${RAW_BASE}/${filePath}?t=${Date.now()}`, { raw: true });
      if (r.ok) {
        try {
          const file = JSON.parse(r.text) as HomeworkFile;
          if (file && Array.isArray(file.entries) && file.syncCode === syncCode) return { file };
        } catch {}
      }
    } catch {}
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
 * 北科云盘源（v1.1.4 起；v1.1.7 升级为目录转接范式）：
 *   新结构 homework/<publishCode>/<courseKey>-<时间戳>.json
 *   旧结构 <syncCode>-<时间戳>.json（扁平，按前缀取最新）
 */
const anyshareSource: HomeworkSource = {
  name: 'ustb-cloud',
  async fetchBundle(syncCode) {
    const cfg = anyshareCtx();
    if (!cfg || !cfg.enabled) return null;
    try {
      const publishCode = derivePublishCode(syncCode);
      const root = await getShareRoot(cfg);
      const { dirs } = await listDir(cfg, root.docid);
      const hwDir = dirs.find((d) => d.name === 'homework');
      if (hwDir?.docid) {
        const { dirs: subs } = await listDir(cfg, hwDir.docid);
        const pubDir = subs.find((d) => d.name === publishCode);
        if (pubDir?.docid) {
          const { files } = await listDir(cfg, pubDir.docid);
          const jsons = files
            .filter((f) => f.name.endsWith('.json'))
            .sort((a, b) => (b.modified || 0) - (a.modified || 0));
          if (jsons[0]) return { file: await downloadBundleFile(cfg, jsons[0]) };
        }
      }
    } catch {}
    const latest = await findLatestByPrefix(cfg, `${syncCode}-`);
    if (!latest) return null;
    return { file: await downloadBundleFile(cfg, latest) };
  },
};

async function downloadBundleFile(cfg: AnyShareConfig, file: AnyShareFile): Promise<HomeworkFile> {
  const url = await getFileDownloadUrl(cfg, file);
  const r = await ghFetch(url, { raw: true });
  if (!r.ok) throw new Error(`北科云盘下载作业包失败（HTTP ${r.status}）`);
  const parsed = JSON.parse(r.text) as HomeworkFile;
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('北科云盘作业包损坏（entries 缺失）');
  return parsed;
}

let _db: DB | null = null;
function anyshareCtx(): (AnyShareConfig & { enabled: boolean }) | null {
  if (!_db) return null;
  try { return getAnyShareConfig(_db); } catch { return null; }
}

/** 任一源返回包即用；GitHub 404/云盘目录里没前缀文件 = 确认「码不存在」，不被其他源的网络错误遮蔽 */
async function fetchBundleFromAnySource(syncCode: string, token?: string): Promise<{ source: string; file: HomeworkFile } | null> {
  const errors: string[] = [];
  let confirmedMissing = false;
  const sources: HomeworkSource[] = [githubSource, anyshareSource];
  for (const src of sources) {
    try {
      const hit = await src.fetchBundle(syncCode, token);
      if (hit) return { source: src.name, file: hit.file };
      confirmedMissing = true;
    } catch (e: any) {
      errors.push(`${src.name}: ${e?.message || e}`);
    }
  }
  if (confirmedMissing) return null;
  if (errors.length) throw new Error(errors.join('；'));
  return null;
}

/** 取/生成某课程同步作业码（按 courseKey 共享：同名同老师 = 同一份作业包） */
function getOrCreateCourseSyncCode(db: DB, courseId: number | null | undefined): string {
  if (!courseId) return generateCodePair().syncCode;
  const row = db.prepare('SELECT name, instructor FROM courses WHERE id = ?').get(courseId) as { name: string; instructor?: string | null } | undefined;
  if (row) {
    const ck = computeCourseKey(row.name, row.instructor);
    const ckKey = 'homework_sync_ck_' + ck;
    const existingCk = normalizeSyncCode(getSetting(db, ckKey));
    if (existingCk) return existingCk;
    const legacy = normalizeSyncCode(getSetting(db, SETTING_COURSE_SYNC_PREFIX + courseId));
    const fresh = legacy || generateCodePair().syncCode;
    setSetting(db, ckKey, fresh);
    return fresh;
  }
  const key = SETTING_COURSE_SYNC_PREFIX + courseId;
  const existing = normalizeSyncCode(getSetting(db, key));
  if (existing) return existing;
  const fresh = generateCodePair().syncCode;
  setSetting(db, key, fresh);
  return fresh;
}

function getCourseSyncCode(db: DB, courseId: number | null | undefined): string {
  if (!courseId) return '';
  const row = db.prepare('SELECT name, instructor FROM courses WHERE id = ?').get(courseId) as { name: string; instructor?: string | null } | undefined;
  if (row) {
    const ck = computeCourseKey(row.name, row.instructor);
    const byKey = normalizeSyncCode(getSetting(db, 'homework_sync_ck_' + ck));
    if (byKey) return byKey;
  }
  return normalizeSyncCode(getSetting(db, SETTING_COURSE_SYNC_PREFIX + courseId)) || '';
}

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

/** 双源发布 wrapper：解析 payload.targets / settings 持久化默认，对每个目标分别调底层 publishHomework */
export async function publishHomeworkMulti(db: DB, payload: PublishPayload): Promise<{
  ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string; syncCode?: string; bundleCreated?: boolean; anyshareRaw?: string;
  targets?: ('github' | 'cloud')[];
  perTarget?: Array<{ target: 'github' | 'cloud'; ok: boolean; error?: string; fileUrl?: string; anyshareRaw?: string }>;
}> {
  const def = (getSetting(db, 'homework_default_targets') || '').trim();
  let targets: ('github' | 'cloud')[] = [];
  if (Array.isArray(payload.targets) && payload.targets.length) {
    targets = payload.targets.filter((t) => t === 'github' || t === 'cloud');
  } else if (payload.target === 'cloud' || payload.target === 'github') {
    targets = [payload.target];
  } else if (def === 'github' || def === 'cloud') {
    targets = [def];
  } else if (def && /^\[[^\]]+\]$/.test(def)) {
    try {
      const arr = JSON.parse(def);
      if (Array.isArray(arr) && arr.length) targets = arr.filter((t: any) => t === 'github' || t === 'cloud');
    } catch {}
  }
  if (!targets.length) targets = ['github'];

  const perTarget: Array<{ target: 'github' | 'cloud'; ok: boolean; error?: string; fileUrl?: string; anyshareRaw?: string }> = [];
  let lastOk: any = null;
  let firstErr: string | undefined;
  let firstAny: string | undefined;
  for (const t of targets) {
    const r: any = await publishHomework(db, { ...payload, target: t, targets: undefined });
    perTarget.push({ target: t, ok: !!r.ok, error: r.error, fileUrl: r.fileUrl, anyshareRaw: r.anyshareRaw });
    if (r.ok) lastOk = r;
    else { if (!firstErr) firstErr = r.error; if (!firstAny && r.anyshareRaw) firstAny = r.anyshareRaw; }
  }
  const ok = perTarget.some((p) => p.ok);
  return {
    ok,
    error: firstErr,
    entry: lastOk?.entry,
    fileUrl: lastOk?.fileUrl,
    syncCode: lastOk?.syncCode,
    bundleCreated: lastOk?.bundleCreated,
    anyshareRaw: firstAny,
    targets,
    perTarget,
  };
}

export async function publishHomework(db: DB, payload: PublishPayload): Promise<{ ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string; syncCode?: string; bundleCreated?: boolean; anyshareRaw?: string }> {
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

  let courseKey = '';
  {
    const cid = payload.courseId ?? (payload as any).courseId;
    if (cid) {
      const row = db.prepare('SELECT name, instructor, course_key FROM courses WHERE id = ?').get(cid) as { name: string; instructor?: string | null; course_key?: string | null } | undefined;
      if (row) {
        courseKey = (row.course_key || '').trim() || computeCourseKey(row.name, row.instructor);
        if (!(row.course_key || '').trim()) {
          db.prepare('UPDATE courses SET course_key = ? WHERE id = ?').run(courseKey, cid);
        }
      }
    }
  }

  const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;

  if (target === 'cloud') {
    const cfg = getAnyShareConfig(db);
    if (!cfg || !cfg.enabled) return { ok: false, error: '北科云盘同步源未启用（设置 → 作业同步）' };

    const publishCode = derivePublishCode(syncCode);
    let pubDir: { docid: string; name: string } | null = null;
    try {
      const root = await getShareRoot(cfg);
      const hwDir = await ensureShareDir(cfg, root.docid, 'homework');
      pubDir = await ensureShareDir(cfg, hwDir.docid, publishCode);
    } catch (e: any) {
      return { ok: false, error: `创建云盘作业目录失败：${e?.message || e}` };
    }

    let file: HomeworkFile = { syncCode, courseName, createdAt: Date.now(), updatedAt: 0, entries: [] };
    try {
      let latest = courseKey
        ? await findLatestByPrefixIn(cfg, pubDir.docid, `${courseKey}-`)
        : null;
      if (!latest) {
        const { files } = await listDir(cfg, pubDir.docid);
        const jsons = files.filter((f) => f.name.endsWith('.json')).sort((a, b) => (b.modified || 0) - (a.modified || 0));
        latest = jsons[0] || null;
      }
      if (!latest) latest = await findLatestByPrefix(cfg, `${syncCode}-`);
      if (latest) {
        const url = await getFileDownloadUrl(cfg, latest);
        const r = await ghFetch(url, { raw: true });
        if (r.ok) {
          const remote = JSON.parse(r.text) as HomeworkFile;
          if (remote && Array.isArray(remote.entries)) file = remote;
        }
      }
    } catch {}

    const merged = mergeEntry(file, { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid, courseKey });
    // 匿名无法覆盖同名 → 每次发布写一个新文件 <courseKey>-<时间戳>.json
    const cloudName = `${courseKey || syncCode}-${Date.now()}.json`;
    try {
      await uploadTextFileToDir(cfg, pubDir.docid, cloudName, JSON.stringify(merged.file, null, 2));
    } catch (e: any) {
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

  // GitHub 目标
  const token = getSetting(db, SETTING_TOKEN).trim();
  if (!token) return { ok: false, error: '尚未配置 GitHub 发布令牌（第一次发布时填写，保存在本机）' };

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
        file.courseName = courseName;
      } catch {
        return { ok: false, error: '远端作业包损坏（JSON 解析失败），可到仓库里手动修正后重试' };
      }
    }
  }

  const { file: mergedFile, entry, existing } = mergeEntry(file, { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid });

  // 一次 409/422 冲突重试
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
    if (g.ok) { try { sha = JSON.parse(g.text).sha; } catch {} }
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

/** 组装/合并一条作业到包里（同日期+同标题 → 覆盖；幂等） */
function mergeEntry(
  base: HomeworkFile,
  ctx: {
    syncCode: string; courseName: string; sessionDate: string; title: string;
    payload: PublishPayload; publisher: string; courseGuid: string; courseKey?: string;
  }
): { file: HomeworkFile; entry: HomeworkEntry; existing: HomeworkEntry | undefined } {
  const { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid, courseKey } = ctx;
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
  if (courseGuid) file.courseGuid = courseGuid;
  if (courseKey) file.courseKey = courseKey;
  file.courseName = courseName;
  file.updatedAt = now;
  file.entries.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
  return { file, entry, existing };
}

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

/** 按同步作业码拉取一个作业包并写入本地课程。
 * 课程匹配链：用户手选 > 包内 courseKey（命中所有平行班）> 包内 courseGuid > 同名唯一 > 同名多个（让前端弹窗手选）> 无（courseNotFound）。 */
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

  let hitCourseIds: number[] = [];
  if (chooseCourseId) {
    const c = db.prepare('SELECT id FROM courses WHERE id = ?').get(chooseCourseId) as { id: number } | undefined;
    if (!c) {
      result.error = '所选课程不存在（可能刚被删除），请重试';
      return result;
    }
    hitCourseIds = [c.id];
  } else {
    const courseKey = (file.courseKey || '').trim();
    if (courseKey) {
      hitCourseIds = (db.prepare('SELECT id FROM courses WHERE course_key = ?').all(courseKey) as Array<{ id: number }>).map((r) => r.id);
    }
    if (!hitCourseIds.length) {
      const courseGuid = (file.courseGuid || '').trim();
      if (courseGuid) {
        const g = db.prepare('SELECT id FROM courses WHERE guid = ?').get(courseGuid) as { id: number } | undefined;
        if (g) hitCourseIds = [g.id];
      }
    }
    if (!hitCourseIds.length) {
      const sameName = db.prepare('SELECT id, name, code, instructor FROM courses WHERE TRIM(name) = ?').all(courseName) as Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
      if (sameName.length === 1) {
        hitCourseIds = [sameName[0].id];
      } else if (sameName.length > 1) {
        result.courseCandidates = sameName;
        result.error = `本地有 ${sameName.length} 门同名课程「${courseName}」，且作业包无法辨别是哪一门，请选择挂载目标`;
        return result;
      }
    }
  }
  if (!hitCourseIds.length) {
    result.courseName = courseName;
    result.courseNotFound = true;
    result.error = `本地没有课程「${courseName}」，请先在「课程」页新建/同步该课程，再点接收`;
    return result;
  }
  result.coursesTouched = hitCourseIds.length;

  for (const courseId of hitCourseIds) {
    for (const e of file.entries) {
      if (!e || !e.id || !e.title) continue;
      if (courseId === hitCourseIds[0]) result.entries++;
      const due = e.dueDate && Number.isFinite(e.dueDate)
        ? e.dueDate
        : new Date(`${e.sessionDate || '1970-01-01'}T23:59:00`).getTime();
      const rid = hitCourseIds.length > 1 ? `${e.id}#c${courseId}` : e.id;
      const local = db.prepare('SELECT id FROM course_requirements WHERE remote_id = ?').get(rid) as { id: number } | undefined;
      if (local) {
        db.prepare(
          `UPDATE course_requirements SET title=?, type=?, description=?, due_date=?, session_date=?, publisher=?
           WHERE id=?`
        ).run(
          e.title, (e.type || 'homework'), e.content || '', due, e.sessionDate || null,
          e.publisher || null, local.id
        );
        if (courseId === hitCourseIds[0]) result.updated++;
      } else {
        db.prepare(
          `INSERT INTO course_requirements (course_id, title, type, description, due_date, priority, status,
             estimated_hours, actual_hours, notes, created_at, source, remote_id, session_date, publisher)
           VALUES (?, ?, ?, ?, ?, 2, 'pending', NULL, NULL, ?, ?, 'github', ?, ?, ?)`
        ).run(
          courseId, e.title, (e.type || 'homework'), e.content || '', due,
          `来源：${source === 'ustb-cloud' ? '北科云盘' : 'GitHub'} 接收 · 码 ${syncCode} · 发布人 ${e.publisher || '佚名'} · ${e.sessionDate || ''}${e.sessionTime ? ' ' + e.sessionTime : ''}`,
          Date.now(), rid, e.sessionDate || null, e.publisher || null
        );
        if (courseId === hitCourseIds[0]) result.created++;
      }
      if (courseId === hitCourseIds[0]) {
        result.items.push({ courseName, title: e.title, sessionDate: e.sessionDate || '', action: local ? 'updated' : 'created' });
      }
    }
  }

  result.ok = true;
  setSetting(db, SETTING_LAST_SYNC, String(Date.now()));
  return result;
}

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

  ipcMain.handle('homework:generateCodes', () => {
    const pair = generateCodePair();
    return { ok: true, ...pair };
  });

  ipcMain.handle('homework:verifyCodes', (_e, publishCode: string) => {
    const syncCode = parsePublishCode(publishCode);
    return syncCode ? { ok: true, syncCode } : { ok: false };
  });

  ipcMain.handle('homework:courseSyncCode', (_e, courseId: number | null | undefined) => {
    if (!courseId) return { ok: false, syncCode: '', error: '请指定 courseId' };
    const existing = getCourseSyncCode(db, courseId);
    if (existing) return { ok: true, syncCode: existing };
    const fresh = getOrCreateCourseSyncCode(db, courseId);
    return { ok: true, syncCode: fresh };
  });

  ipcMain.handle('homework:publish', async (_e, payload: PublishPayload) => {
    try {
      return await publishHomeworkMulti(db, payload);
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