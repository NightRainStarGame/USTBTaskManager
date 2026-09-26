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
  parseAnyShareUrl, getFileDownloadUrl,
  getShareRoot, ensureShareDir, listDir, listShareFiles, uploadTextFileToDir,
  type AnyShareConfig, type AnyShareFile,
} from '../anyshare';
// v1.2.10：复用班级那张 fine-grained PAT 作为作业同步的内置令牌（同仓库、同权限）
import { CLASS_FALLBACK_TOKEN } from '../class/storage';

export const HOMEWORK_REPO_OWNER = 'NightRainStarGame';
/**
 * v1.2.10：作业数据迁到独立数据仓 USTBTaskManager-Class（与班级模块共用）。
 *
 * 为什么迁：主仓库 USTBTaskManager 里放着源码 + latest.json 更新清单，作业这种
 * 用户数据混在里面的代价是——作业同步必须依赖一张「对主仓库有 Contents 写权限」
 * 的 PAT，而这个令牌是要内置在客户端里开箱即用的，等于把源码写权限塞给每个用户。
 * 迁走之后和班级共用同一张 fine-grained PAT：它只对 Class 仓库有读写授权，
 * 泄露的爆炸半径锁在数据仓（主仓库写入实测 403），源码和更新清单改不动。
 *
 * 存储布局保持不变：`homework/<syncCode>.json`，只是换了仓库。
 */
export const HOMEWORK_REPO_NAME = 'USTBTaskManager-Class';
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
/** v1.2.2：手动生成过的码对历史（JSON 数组，仅记 syncCode + 时间，publishCode 可 HMAC 派生） */
const SETTING_MY_CODES = 'homework_my_codes';

/**
 * v1.2.10：令牌优先级 = 用户自己的 PAT > 内置公共令牌（与班级共用同一张，见 CLASS_FALLBACK_TOKEN）。
 * 以前没个人令牌发布就硬失败，等于人人都得去 GitHub 开 PAT 才能用作业同步；
 * 现在内置令牌兜底 → 开箱即用，想用自己的 PAT 仍可在设置里覆盖。
 */
function resolveToken(db: DB): string {
  return resolveToken(db) || CLASS_FALLBACK_TOKEN || '';
}

/** v1.2.10 迁移兜底：老作业包还躺在主仓库 homework/ 下，只读不写 */
const LEGACY_RAW_BASE = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main';

/** 北科云盘默认外链。仅在北京科技大学校园网内可达；用户可在设置里改/关 */
export const DEFAULT_ANYSHARE_CONFIG: AnyShareConfig & { enabled: boolean } = {
  baseUrl: 'https://yunpan.ustb.edu.cn',
  linkId: 'AADAAEA94FBE6B4435B8D14A236FAC6469',
  password: 'kc26',
  enabled: true,
};

export function getAnyShareConfig(db: DB): (AnyShareConfig & { enabled: boolean }) | null {
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

export function normalizeSyncCode(raw: string): string | null {
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

export interface HomeworkFile {
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

export interface PublishEntry {
  title: string;
  content: string;
  type?: HomeworkType;
  /** 单条可独立指定上课日期；缺省用外层 sessionDate */
  sessionDate?: string;
  sessionTime?: string | null;
  dueDate?: number | null;
}

export interface PublishPayload {
  syncCode?: string;
  publishCode?: string;
  targets?: ('github' | 'cloud')[];
  /** @deprecated v1.1.6 起改用 targets */
  target?: 'github' | 'cloud';
  courseId?: number;
  courseName: string;
  /** 默认上课日期；entries 里没指定 sessionDate 的条目用这个 */
  sessionDate: string;
  sessionTime?: string | null;
  title: string;
  content: string;
  type?: HomeworkType;
  dueDate?: number | null;
  /** v1.1.8+：批量发布条目。存在时 title/content/type/dueDate 被忽略，每个条目独立 */
  entries?: PublishEntry[];
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
  /** v1.1.8+：按 courseId 分组的挂载明细（精确到每个课程每条作业的 created/updated） */
  perCourse?: Array<{ courseId: number; courseName: string; entries: number; created: number; updated: number }>;
  items: Array<{ courseId: number; courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
  syncedAt: number;
  courseNotFound?: boolean;
  courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
  /** v1.1.9+：跨课程混包中没找到目标课程而跳过的条目（课程级挂载精度提示） */
  skipped?: Array<{ title: string; courseName: string; reason: string }>;
  /** v1.2.0+：接收时自动合并掉的本地重复条目数（同课程+同上课日+同标题的同步作业） */
  deduped?: number;
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

export async function ghFetch(path: string, opts: { method?: string; token?: string; body?: any; raw?: boolean; ifNoneMatch?: string } = {}) {  const url = path.startsWith('http') ? path : `${API}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'User-Agent': 'TaskManager-Homework',
      // GitHub Contents API 默认 max-age=60，库里的 cache-Control=public 会让浏览器/中间 CDN 命中 60s 内返回旧值
      // 发 no-store 强制每次回源（多发连点「再发一条」能拿到最新 sha，不会 409 死循环）
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    const res = await net.fetch(url, { method: opts.method || 'GET', headers, body, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text, etag: res.headers.get('etag') || '' };
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

/** v1.2.10 迁移兼容：新仓在读不到时才去主仓库找历史作业包（只读，新发布一律写数据仓） */
async function fetchLegacyBundle(syncCode: string): Promise<HomeworkFile | null> {
  try {
    const r = await ghFetch(`${LEGACY_RAW_BASE}/${HOMEWORK_DIR}/${syncCode}.json`, { raw: true });
    if (!r.ok) return null;
    const file = JSON.parse(r.text) as HomeworkFile;
    if (file && Array.isArray(file.entries) && file.syncCode === syncCode) return file;
  } catch { /* 主仓库不可达当作没有，不能把网络错误伪装成「码不存在」以外的东西 */ }
  return null;
}

const githubSource: HomeworkSource = {
  name: 'github',
  async fetchBundle(syncCode, token) {
    const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;
    // Contents API（no-store）优先：raw CDN 的缓存键忽略 query string，?t= 绕不过
    // 它最长 5 分钟的缓存——发布第二条后立刻接收会拿到只剩第一条的旧包（v1.1.8 实测根因）。
    // raw 降级为 Contents API 网络失败时的兜底（有缓存总比拿不到强）。
    let lastErr: any = null;
    try {
      const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, { token });
      if (r.status === 404) {
        // v1.2.10：数据仓里没有 → 回退主仓库找历史包，保证迁移前发出去的老同步码继续可用
        const legacy = await fetchLegacyBundle(syncCode);
        return legacy ? { file: legacy } : null;
      }
      if (r.ok) {
        try {
          const meta = JSON.parse(r.text);
          const file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
          if (file && Array.isArray(file.entries)) return { file };
          lastErr = new Error('远端作业包损坏（entries 缺失）');
        } catch {
          lastErr = new Error('远端作业包损坏（JSON 解析失败）');
        }
      } else {
        lastErr = new Error(describeStatus(r.status, r.text));
      }
    } catch (e: any) {
      lastErr = e;
    }
    try {
      const r = await ghFetch(`${RAW_BASE}/${filePath}`, { raw: true });
      if (r.ok) {
        try {
          const file = JSON.parse(r.text) as HomeworkFile;
          if (file && Array.isArray(file.entries) && file.syncCode === syncCode) return { file };
        } catch {}
      }
    } catch {}
    throw lastErr || new Error('GitHub 作业包拉取失败');
  },
};

/**
 * 北科云盘源（v1.1.4 起；v1.1.7 目录转接范式；v1.1.9 全量合并）：
 *   新结构 homework/<publishCode>/<courseKey>-<时间戳>.json
 *   旧结构 <syncCode>-<时间戳>.json（扁平）
 * 同一个码包目录下可能有多个文件（每次发布写一个、跨课程各写各的 courseKey 前缀），
 * 只取「最新一个」会丢其余文件的条目——v1.1.9 起全部下载后条目级合并。
 */
const anyshareSource: HomeworkSource = {
  name: 'ustb-cloud',
  async fetchBundle(syncCode) {
    const cfg = anyshareCtx();
    if (!cfg || !cfg.enabled) return null;
    const candidates: AnyShareFile[] = [];
    let usedLegacy = false;
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
          candidates.push(...files.filter((f) => f.name.endsWith('.json')));
        }
      }
    } catch {}
    if (!candidates.length) {
      // 旧扁平结构：同码所有历史文件全并（不只是 prefix 命中的第一个）
      try {
        const files = await listShareFiles(cfg);
        candidates.push(...files.filter((f) => f.name.startsWith(`${syncCode}-`) && f.name.endsWith('.json')));
        usedLegacy = candidates.length > 0;
      } catch {}
    }
    if (!candidates.length) return null;
    const bundles: HomeworkFile[] = [];
    for (const f of candidates) {
      try {
        bundles.push(await downloadBundleFile(cfg, f));
      } catch { /* 单个文件损坏不拖累整个码包 */ }
    }
    if (!bundles.length) return null;
    return { file: mergeBundleFiles(bundles, syncCode, usedLegacy) };
  },
};

/** 多份历史快照合并成一份（条目级去重：id 命中或 课程名+日期+标题 命中 → 后写的覆盖） */
export function mergeBundleFiles(bundles: HomeworkFile[], syncCode: string, preferFileMetaOfLast = true): HomeworkFile {
  const byId = new Map<string, HomeworkEntry>();
  const idOfKey = new Map<string, string>();
  for (const f of bundles) {
    for (const e of f.entries || []) {
      if (!e || !e.title) continue;
      const courseName = e.courseName || f.courseName || '';
      const key = `${courseName}|${e.sessionDate || ''}|${e.title}`;
      const id = e.id || key;
      // v1.2.0：同键不同 id（两份快照各生成过一条，如单侧发布失败后重发）
      // → 旧的让位、只留最新一份，否则接收端会出现两条重复
      const priorId = idOfKey.get(key);
      if (priorId && priorId !== id) byId.delete(priorId);
      byId.set(id, { ...e, id, courseName });
      idOfKey.set(key, id);
    }
  }
  const meta = preferFileMetaOfLast ? bundles[bundles.length - 1] : bundles[0];
  const merged: HomeworkFile = {
    ...(meta || { entries: [] }),
    syncCode,
    entries: Array.from(byId.values()).sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0)),
  };
  return merged;
}

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

/** v1.1.9：作业云端 TTL（settings.cleanup_homework_days，默认 7 天；0 = 永久保留）。
 *  过期条目不再参与接收挂载——所有新版客户端统一执行，等效于从云端删除（云盘匿名删不了文件）。 */
export function homeworkTtlMs(): number {
  if (!_db) return 7 * 86400000;
  try {
    const v = parseInt(getSetting(_db, 'cleanup_homework_days'), 10);
    if (Number.isFinite(v) && v >= 0) return v * 86400000;
  } catch {}
  return 7 * 86400000;
}

function applyHomeworkTtl(hit: { source: string; file: HomeworkFile }): { source: string; file: HomeworkFile } {
  const ttl = homeworkTtlMs();
  if (ttl <= 0) return hit;
  const cutoff = Date.now() - ttl;
  const entries = (hit.file.entries || []).filter((e) => (e.publishedAt || 0) >= cutoff);
  return { source: hit.source, file: { ...hit.file, entries } };
}

/** 多源全试、命中全并：GitHub / 云盘各自可能有对方没有的条目（比如某次发布单侧失败），
 *  合并后返回；所有源都确认「码不存在」才返回 null，网络错误不被遮蔽 */
async function fetchBundleFromAnySource(syncCode: string, token?: string): Promise<{ source: string; file: HomeworkFile } | null> {
  const errors: string[] = [];
  let confirmedMissing = false;
  const hits: Array<{ source: string; file: HomeworkFile }> = [];
  const sources: HomeworkSource[] = [githubSource, anyshareSource];
  for (const src of sources) {
    try {
      const hit = await src.fetchBundle(syncCode, token);
      if (hit) hits.push({ source: src.name, file: hit.file });
      else confirmedMissing = true;
    } catch (e: any) {
      errors.push(`${src.name}: ${e?.message || e}`);
    }
  }
  if (hits.length === 1) return applyHomeworkTtl(hits[0]);
  if (hits.length > 1) {
    // 多源合并：条目级去重（id / 课程名+日期+标题），任一侧多出的条目都保留
    return applyHomeworkTtl({
      source: hits.map((h) => h.source).join('+'),
      file: mergeBundleFiles(hits.map((h) => h.file), syncCode),
    });
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
  entriesCount?: number;
  perTarget?: Array<{ target: 'github' | 'cloud'; ok: boolean; error?: string; fileUrl?: string; anyshareRaw?: string; entriesCount?: number }>;
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

  const perTarget: Array<{ target: 'github' | 'cloud'; ok: boolean; error?: string; fileUrl?: string; anyshareRaw?: string; entriesCount?: number }> = [];
  let lastOk: any = null;
  let firstErr: string | undefined;
  let firstAny: string | undefined;
  for (const t of targets) {
    const r: any = await publishHomework(db, { ...payload, target: t, targets: undefined });
    perTarget.push({ target: t, ok: !!r.ok, error: r.error, fileUrl: r.fileUrl, anyshareRaw: r.anyshareRaw, entriesCount: r.entriesCount });
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
    entriesCount: lastOk?.entriesCount,
    anyshareRaw: firstAny,
    targets,
    perTarget,
  };
}

export async function publishHomework(db: DB, payload: PublishPayload): Promise<{ ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string; syncCode?: string; bundleCreated?: boolean; anyshareRaw?: string; entriesCount?: number; entriesPublished?: number }> {
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
  const sessionDate = (payload.sessionDate || '').trim();
  if (!courseName) return { ok: false, error: '请选择课程' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { ok: false, error: '请选择上课日期' };

  // v1.1.8+：批量条目。entries 缺省时按外层单条字段包成一个 entries
  const rawEntries: PublishEntry[] = (Array.isArray(payload.entries) && payload.entries.length)
    ? payload.entries
    : [{
        title: payload.title,
        content: payload.content,
        type: payload.type,
        sessionDate: payload.sessionDate,
        sessionTime: payload.sessionTime,
        dueDate: payload.dueDate,
      }];
  // 归一化 + 校验
  const normalizedEntries: PublishEntry[] = [];
  for (const e of rawEntries) {
    const t = (e.title || '').trim();
    if (!t) continue; // 跳过空标题（用户可能加了一行没填就提交）
    const d = (e.sessionDate || sessionDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { ok: false, error: `作业「${t}」的上课日期无效（需 YYYY-MM-DD）` };
    }
    normalizedEntries.push({
      title: t,
      content: (e.content || '').trim(),
      type: e.type || payload.type || 'homework',
      sessionDate: d,
      sessionTime: e.sessionTime ?? null,
      dueDate: e.dueDate ?? null,
    });
  }
  if (!normalizedEntries.length) return { ok: false, error: '请至少填写一条作业（标题必填）' };

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
      // v1.1.9：目录里所有 json 全下载合并（每个都是历史快照；跨课程同码发布时
      // 各条目会写到不同 courseKey 前缀的文件里，只按本次前缀找 base 会丢其他课程的条目）
      const { files } = await listDir(cfg, pubDir.docid);
      const bundles: HomeworkFile[] = [];
      for (const f of files.filter((x) => x.name.endsWith('.json'))) {
        try {
          bundles.push(await downloadBundleFile(cfg, f));
        } catch { /* 单个损坏文件跳过 */ }
      }
      if (bundles.length) {
        file = mergeBundleFiles(bundles, syncCode);
        // 元信息以「包含本次 courseKey 的那份」优先（保留包级 courseKey 匹配能力）
        const withKey = bundles.find((b) => b.courseKey === courseKey);
        if (withKey) {
          file.courseKey = withKey.courseKey;
          file.courseGuid = withKey.courseGuid || file.courseGuid;
          if (withKey.courseName) file.courseName = withKey.courseName;
        }
      }
    } catch {}

    // 批量合并（按 sessionDate+title 去重 + 追加）
    let lastEntry: HomeworkEntry | undefined;
    let hasNew = false;
    for (const e of normalizedEntries) {
      const r = mergeEntry(file, {
        syncCode, courseName, sessionDate: e.sessionDate!, title: e.title,
        payload: { ...payload, title: e.title, content: e.content, sessionDate: e.sessionDate!, type: e.type, dueDate: e.dueDate, sessionTime: e.sessionTime },
        publisher, courseGuid, courseKey,
      });
      file = r.file;
      lastEntry = r.entry;
      if (!r.existing) hasNew = true;
    }
    // 匿名无法覆盖同名 → 每次发布写一个新文件 <courseKey>-<时间戳>.json
    // 时间戳用真实单调的 Date.now()，并在末尾加毫秒+随机后缀保证唯一（同一毫秒内多次上传也能区分）
    const tsNow = Date.now();
    const cloudName = `${courseKey || syncCode}-${tsNow}.json`;
    try {
      await uploadTextFileToDir(cfg, pubDir.docid, cloudName, JSON.stringify(file, null, 2));
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
      entry: lastEntry,
      fileUrl: `${cfg.baseUrl}/link/${cfg.linkId}`,
      syncCode,
      bundleCreated: hasNew,
      entriesCount: file.entries.length,
      entriesPublished: normalizedEntries.length,
    };
  }

  // GitHub 目标
  const token = resolveToken(db);
  if (!token) return { ok: false, error: '未找到 GitHub 发布令牌（内置令牌不可用，请在「设置 → 作业同步」填一张 PAT）' };

  let file: HomeworkFile;
  let sha: string | undefined;
  // 最多两次 GET（一次主、一次 409 重试）。每次都发 no-store 头防 CDN 60s 缓存命中旧 sha
  const fetchFile = async () => ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, { token });
  let r = await fetchFile();
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
      // v1.2.0：包内自愈——历史重复条目（同课程+同日期+同标题但 id 不同）收敛为一条
      file = mergeBundleFiles([file], syncCode);
      file.courseName = courseName;
      if (courseKey && !file.courseKey) file.courseKey = courseKey;
      if (courseGuid && !file.courseGuid) file.courseGuid = courseGuid;
    } catch {
      return { ok: false, error: '远端作业包损坏（JSON 解析失败），可到仓库里手动修正后重试' };
    }
  }

  // 批量合并到内存 file，最后一次性 PUT（避免 N 次远端 IO）
  let lastEntry: HomeworkEntry | undefined;
  let lastExisting: HomeworkEntry | undefined;
  let hasNew = false;
  for (const e of normalizedEntries) {
    const r = mergeEntry(file, {
      syncCode, courseName, sessionDate: e.sessionDate!, title: e.title,
      payload: { ...payload, title: e.title, content: e.content, sessionDate: e.sessionDate!, type: e.type, dueDate: e.dueDate, sessionTime: e.sessionTime },
      publisher, courseGuid,
    });
    file = r.file;
    lastEntry = r.entry;
    lastExisting = r.existing;
    if (!r.existing) hasNew = true;
  }
  const mergedFile = file;

  // 一次 409/422 冲突重试；重试时也用 no-store 重新拿最新 sha
  const put = async (currentSha?: string) => {
    const firstEntry = normalizedEntries[0];
    const msg = normalizedEntries.length === 1
      ? `homework: ${lastExisting ? '更新' : '发布'} [${syncCode}] ${courseName} ${firstEntry.sessionDate} ${firstEntry.title}`
      : `homework: 批量发布 ×${normalizedEntries.length} [${syncCode}] ${courseName}（${firstEntry.sessionDate} 起）`;
    const body = {
      message: msg,
      content: Buffer.from(JSON.stringify(mergedFile, null, 2), 'utf8').toString('base64'),
      branch: HOMEWORK_BRANCH,
      ...(currentSha ? { sha: currentSha } : {}),
    };
    return ghFetch(`/contents/${filePath}`, { method: 'PUT', token, body });
  };
  let putRes = await put(sha);
  if (putRes.status === 409 || putRes.status === 422) {
    // 真冲突：别人改了 → 重新 GET 拿最新内容 + sha，再合并本次所有新条目（避免覆盖别人的提交）
    const g = await fetchFile();
    if (g.ok) {
      try {
        const meta = JSON.parse(g.text);
        sha = meta.sha;
        const fresh = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
        if (Array.isArray(fresh.entries)) {
          // v1.2.0：先自愈历史重复条目，再合并本次条目
          fresh.entries = mergeBundleFiles([fresh], syncCode).entries;
          // 在最新的远端包基础上把所有本次条目再合并一次
          for (const e of normalizedEntries) {
            const rebased = mergeEntry(fresh, {
              syncCode, courseName, sessionDate: e.sessionDate!, title: e.title,
              payload: { ...payload, title: e.title, content: e.content, sessionDate: e.sessionDate!, type: e.type, dueDate: e.dueDate, sessionTime: e.sessionTime },
              publisher, courseGuid,
            });
            fresh.entries = rebased.file.entries;
            fresh.updatedAt = rebased.file.updatedAt;
          }
          // 替换 mergedFile 用最新的合并产物
          mergedFile.entries = fresh.entries;
          mergedFile.updatedAt = fresh.updatedAt;
        }
      } catch { /* fall through 保留原 mergedFile */ }
    }
    putRes = await put(sha);
  }
  if (!putRes.ok) return { ok: false, error: describeStatus(putRes.status, putRes.text) };

  return {
    ok: true,
    entry: lastEntry,
    fileUrl: `${REPO_URL}/${syncCode}.json`,
    syncCode,
    bundleCreated: hasNew,
    entriesCount: mergedFile.entries.length,
    entriesPublished: normalizedEntries.length,
  };
}

function randomUUIDSafe(): string {
  try { return randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/** 组装/合并一条作业到包里（同课程+同日期+同标题 → 覆盖；跨课程同名不互相覆盖；幂等） */
function mergeEntry(
  base: HomeworkFile,
  ctx: {
    syncCode: string; courseName: string; sessionDate: string; title: string;
    payload: PublishPayload; publisher: string; courseGuid: string; courseKey?: string;
  }
): { file: HomeworkFile; entry: HomeworkEntry; existing: HomeworkEntry | undefined } {
  const { syncCode, courseName, sessionDate, title, payload, publisher, courseGuid, courseKey } = ctx;
  const now = Date.now();
  // 去重键 = 课程名+日期+标题（v1.1.9：跨课程同日同名不再互相覆盖）
  const existing = base.entries.find(
    (e) => (e.courseName || base.courseName) === courseName && e.sessionDate === sessionDate && e.title === title
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
  const token = resolveToken(db);
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

  const token = resolveToken(db);
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

  const { source, file: rawFile } = hit;
  // v1.2.0：包内自愈——单侧快照里历史遗留的「同课程+同日期+同标题但 id 不同」重复条目收敛为一条
  const file = mergeBundleFiles([rawFile], syncCode);
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

  // entries = 远端作业条目数（去重，不随课程数膨胀）；perCourse[].entries 同义
  // created/updated = 实际 INSERT/UPDATE 数（多平行班时按课程×条目累加，UI 反映真实挂载动作）
  const uniqueEntries = file.entries.filter((e) => e && e.id && e.title);
  result.entries = uniqueEntries.length;

  // v1.1.9 挂载精度核心：条目按「自己的课程名」找家。
  // 一个码包可能混装多门课的作业（跨课程同码发布）；包级匹配链（courseKey/guid/同名）
  // 只适用于「与包级课程同名」或「没带课程名」的条目，其余条目独立解析目标课程。
  type CourseIds = number[] | 'candidates' | 'none';
  const resolveByName = (name: string): CourseIds => {
    const rows = db.prepare('SELECT id FROM courses WHERE TRIM(name) = ?').all(name) as Array<{ id: number }>;
    if (rows.length === 1) return [rows[0].id];
    if (rows.length > 1) return 'candidates';
    return 'none';
  };
  interface MountPlan { courseId: number; courseName: string; entry: HomeworkEntry; }
  const plans: MountPlan[] = [];
  const skipped: Array<{ title: string; courseName: string; reason: string }> = [];
  const bundleResolved = hitCourseIds.length > 0;
  for (const e of uniqueEntries) {
    const eCourseName = ((e.courseName || '').trim() || courseName);
    let targets: number[];
    if (chooseCourseId || !eCourseName || eCourseName === courseName) {
      targets = hitCourseIds;
    } else {
      const r = resolveByName(eCourseName);
      if (r === 'none') {
        skipped.push({ title: e.title, courseName: eCourseName, reason: '本地没有该课程（可在「课程」页新建后再接收）' });
        continue;
      }
      if (r === 'candidates') {
        skipped.push({ title: e.title, courseName: eCourseName, reason: '本地有多门同名课程，无法辨别（暂跳过）' });
        continue;
      }
      targets = r;
    }
    if (!targets.length) continue;
    for (const cid of targets) plans.push({ courseId: cid, courseName: eCourseName, entry: e });
  }
  if (skipped.length) result.skipped = skipped;

  if (!bundleResolved && !plans.length && !chooseCourseId) {
    result.courseName = courseName;
    result.courseNotFound = true;
    result.error = `本地没有课程「${courseName}」，请先在「课程」页新建/同步该课程，再点接收`;
    return result;
  }

  const touchedCourseIds = Array.from(new Set(plans.map((p) => p.courseId)));
  result.coursesTouched = touchedCourseIds.length;
  const perCourseMap = new Map<number, { courseId: number; courseName: string; entries: number; created: number; updated: number }>();

  for (const { courseId, courseName: eCourseName, entry: e } of plans) {
    const row = db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId) as { name: string } | undefined;
    const cName = row?.name || eCourseName;
    const multiCourse = touchedCourseIds.length > 1;
    const stat = perCourseMap.get(courseId) || { courseId, courseName: cName, entries: 0, created: 0, updated: 0 };
    stat.entries++;
    const due = e.dueDate && Number.isFinite(e.dueDate)
      ? e.dueDate
      : new Date(`${e.sessionDate || '1970-01-01'}T23:59:00`).getTime();
    const rid = multiCourse ? `${e.id}#c${courseId}` : e.id;
    const ridAlt = multiCourse ? e.id : `${e.id}#c${courseId}`;
    // v1.2.0：remote_id 新旧格式（带/不带 #c 后缀）都认，且限定本课程，防止格式漂移导致重复插入
    let local = db.prepare(
      'SELECT id, remote_id FROM course_requirements WHERE course_id = ? AND remote_id IN (?, ?)'
    ).get(courseId, rid, ridAlt) as { id: number; remote_id: string } | undefined;
    if (!local) {
      // 兜底：同课程+同上课日+同标题的同步条目（远端条目 id 重建、历史重复都能收敛到一条）
      local = db.prepare(
        `SELECT id, remote_id FROM course_requirements
         WHERE course_id = ? AND session_date IS ? AND TRIM(title) = TRIM(?) AND source != 'local'
         ORDER BY id LIMIT 1`
      ).get(courseId, e.sessionDate || null, e.title) as { id: number; remote_id: string } | undefined;
    }
    if (local) {
      // 愈合历史重复：同键多余的同步行直接删掉（用户已见「出现两次」的场景）
      const dupes = (db.prepare(
        `SELECT id FROM course_requirements
         WHERE course_id = ? AND session_date IS ? AND TRIM(title) = TRIM(?) AND source != 'local' AND id != ?`
      ).all(courseId, e.sessionDate || null, e.title, local.id) as Array<{ id: number }>);
      if (dupes.length) {
        db.prepare(`DELETE FROM course_requirements WHERE id IN (${dupes.map((d) => d.id).join(',')})`).run();
        result.deduped = (result.deduped || 0) + dupes.length;
      }
      if (local.remote_id !== rid) {
        db.prepare('UPDATE course_requirements SET remote_id = ? WHERE id = ?').run(rid, local.id);
      }
      db.prepare(
        `UPDATE course_requirements SET title=?, type=?, description=?, due_date=?, session_date=?, publisher=?
         WHERE id=?`
      ).run(
        e.title, (e.type || 'homework'), e.content || '', due, e.sessionDate || null,
        e.publisher || null, local.id
      );
      stat.updated++;
      result.updated++;
      result.items.push({ courseId, courseName: cName, title: e.title, sessionDate: e.sessionDate || '', action: 'updated' });
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
      stat.created++;
      result.created++;
      result.items.push({ courseId, courseName: cName, title: e.title, sessionDate: e.sessionDate || '', action: 'created' });
    }
    perCourseMap.set(courseId, stat);
  }
  result.perCourse = Array.from(perCourseMap.values());

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
      tokenSet: !!resolveToken(db),
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
    return { ok: true, tokenSet: !!resolveToken(db) };
  });

  ipcMain.handle('homework:generateCodes', () => {
    const pair = generateCodePair();
    // v1.2.2：生成历史落盘（上限 100 条），供「回看已生成的作业码」
    try {
      let arr: Array<{ syncCode: string; createdAt: number }> = [];
      try { const raw = getSetting(db, SETTING_MY_CODES); if (raw) arr = JSON.parse(raw); } catch {}
      if (!Array.isArray(arr)) arr = [];
      arr.unshift({ syncCode: pair.syncCode, createdAt: Date.now() });
      setSetting(db, SETTING_MY_CODES, JSON.stringify(arr.slice(0, 100)));
    } catch {}
    return { ok: true, ...pair };
  });

  // v1.2.2：回看已生成的作业码 = 手动生成历史 + 课程绑定码（homework_sync_ck_* 新格式 / homework_sync_<id> 旧格式），同码去重
  ipcMain.handle('homework:listMyCodes', () => {
    try {
      const map = new Map<string, { syncCode: string; createdAt: number; courseName?: string }>();
      try {
        const raw = getSetting(db, SETTING_MY_CODES);
        if (raw) for (const it of JSON.parse(raw) || []) {
          if (it?.syncCode && !map.has(it.syncCode)) map.set(it.syncCode, { syncCode: it.syncCode, createdAt: Number(it.createdAt) || 0 });
        }
      } catch {}
      const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'homework_sync_%'`).all() as Array<{ key: string; value: string }>;
      const courseByKey = db.prepare('SELECT name FROM courses WHERE course_key = ?');
      const courseById = db.prepare('SELECT name FROM courses WHERE id = ?');
      for (const r of rows) {
        const sc = normalizeSyncCode(r.value);
        if (!sc) continue;
        let courseName: string | undefined;
        if (r.key.startsWith('homework_sync_ck_')) {
          const c = courseByKey.get(r.key.slice('homework_sync_ck_'.length)) as { name?: string } | undefined;
          courseName = c?.name;
        } else {
          const id = Number(r.key.slice('homework_sync_'.length));
          if (Number.isFinite(id) && id > 0) {
            const c = courseById.get(id) as { name?: string } | undefined;
            courseName = c?.name;
          }
        }
        const existing = map.get(sc);
        if (existing) { if (courseName && !existing.courseName) existing.courseName = courseName; }
        else map.set(sc, { syncCode: sc, createdAt: 0, courseName });
      }
      const codes = Array.from(map.values())
        .map((m) => ({ ...m, publishCode: derivePublishCode(m.syncCode), source: m.courseName ? ('course' as const) : ('generated' as const) }))
        .sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, codes };
    } catch (e: any) {
      return { ok: false, codes: [], error: describeError(e) };
    }
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