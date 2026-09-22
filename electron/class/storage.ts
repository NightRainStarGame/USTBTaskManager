/**
 * 班级系统存储适配器（v1.2.7 P2P 班级）
 *
 * 设计：
 *   主源 = GitHub Contents API（开发者公共仓库，可写可读）
 *   备源 = 北科云盘（AnyShare）匿名分享（写权限受限于 link 设置）
 *   本机缓存 = SQLite classes/class_announcements/class_tasks 表（最终一致性兜底）
 *
 * 文件协议：
 *   class/<inviteCode>/
 *     ├── manifest.json           班级核心：成员列表 + last_ann_id + last_task_id + sig
 *     ├── announcements/<annId>.json   单条公告（含 body + sig）
 *     └── tasks/<taskId>.json         单条班级作业（含 body + sig）
 *
 * 为什么用 inviteCode 而不是 classCode 作为路径前缀：
 *   · inviteCode 12 位自带 HMAC 校验位，普通用户手抄不易出错
 *   · 与作业同步的 syncCode 8 位兼容 → 复用 randomCode 字符表
 *   · 安全上等价（HMAC 是公开的，但路径前缀不影响保密）
 *
 * GitHub 写入需要 PAT（设置 → 班级 → GitHub 令牌），没有 PAT 也能拉取（只读模式）。
 */
import { net } from 'electron';
import { createHmac } from 'node:crypto';
import {
  ensureShareDir, listDir,
  uploadTextFileToDir, getFileDownloadUrl,
  type AnyShareConfig, type AnyShareFile,
} from '../anyshare';
import { CLASS_SECRET } from './crypto';

export const CLASS_REPO_OWNER = 'NightRainStarGame';
export const CLASS_REPO_NAME = 'USTBTaskManager';
export const CLASS_BRANCH = 'main';
export const CLASS_DIR = 'class';

/** 默认 AnyShare 配置：班级系统共享（与 homework 独立，避免互相干扰） */
export const DEFAULT_CLASS_ANYSHARE: AnyShareConfig & { enabled: boolean } = {
  baseUrl: 'https://yunpan.ustb.edu.cn',
  linkId: 'AADAAEF94FBE6B4435B8D14A236FAC6470',  // ← 待填：班级专用共享链（部署时改）
  password: 'kc27',                                  // ← 待填：班级专用提取码
  enabled: true,
};

const API = `https://api.github.com/repos/${CLASS_REPO_OWNER}/${CLASS_REPO_NAME}`;
const RAW_BASE = `https://raw.githubusercontent.com/${CLASS_REPO_OWNER}/${CLASS_REPO_NAME}/${CLASS_BRANCH}/${CLASS_DIR}`;

const FETCH_TIMEOUT_MS = 20000;

// ============================================================
// GitHub API
// ============================================================

export async function ghFetch(path: string, opts: {
  method?: string; token?: string; body?: any; raw?: boolean;
  ifNoneMatch?: string;
} = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'User-Agent': 'TaskManager-Class-P2P',
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

function encodeUtf8Base64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function decodeBase64Utf8(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

// ============================================================
// 类型：manifest / announcement / task
// ============================================================

export interface MemberEntry {
  alias: string;          // 用户显示名（在这个班级里的昵称）
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  sig: string;            // HMAC(CLASS_SECRET, alias|classCode|role) 前 16
}

export interface ClassManifest {
  classCode: string;       // 8 位班级 ID
  inviteCode: string;      // 12 位邀请码（含 HMAC 校验位）
  name: string;
  description: string;
  ownerAlias: string;      // 创建者本机显示名
  createdAt: number;
  members: MemberEntry[];
  lastAnnouncementId: number;     // 最近的公告时间戳 ID（用于增量）
  lastTaskId: number;             // 最近的班级作业 ID
  updatedAt: number;
  /** 整体签名 = HMAC(CLASS_SECRET, classCode|name|ownerAlias|lastAnn|lastTask|updatedAt) */
  sig: string;
}

export interface AnnouncementEntry {
  id: number;               // 时间戳 ID
  authorAlias: string;
  title: string;
  body: string;
  images: string[];         // 本地图片路径（暂不上传图片，仅文本）
  pinned: boolean;
  createdAt: number;
  /** sig = HMAC(CLASS_SECRET, entry:classCode|announcement|id|body) */
  sig: string;
}

export interface ClassTaskEntry {
  id: number;
  authorAlias: string;
  title: string;
  body: string;
  /** v1.2.8 块 O：图片附件 URL 列表（最多 9 张，与 AnnouncementEntry.images 同语义） */
  images?: string[];
  dueAt: number | null;     // 截止时间（null = 无）
  status: 'open' | 'done' | 'cancelled';
  createdAt: number;
  sig: string;
}

// ============================================================
// 文件路径助手
// ============================================================

function ghFilePath(inviteCode: string, ...parts: string[]): string {
  return [CLASS_DIR, inviteCode, ...parts].join('/');
}
function ghRawUrl(inviteCode: string, ...parts: string[]): string {
  return [RAW_BASE, inviteCode, ...parts].join('/');
}
function asFilePath(inviteCode: string, ...parts: string[]): string[] {
  return [inviteCode, ...parts];  // AnyShare 内部路径，相对根目录
}

// ============================================================
// 读：manifest.json
// ============================================================

export interface ClassSource {
  name: 'github' | 'anyshare';
  fetchManifest(inviteCode: string): Promise<ClassManifest | null>;
}

export const githubSource: ClassSource = {
  name: 'github',
  async fetchManifest(inviteCode) {
    const filePath = `${ghFilePath(inviteCode, 'manifest.json')}`;
    let lastErr: any = null;
    // 先试 Contents API（拿 etag，下次 If-None-Match 可省流量）
    try {
      const r = await ghFetch(`/contents/${filePath}?ref=${CLASS_BRANCH}&t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      if (r.status === 404) return null;
      if (r.ok) {
        try {
          const meta = JSON.parse(r.text);
          const m = JSON.parse(decodeBase64Utf8(meta.content || '')) as ClassManifest;
          if (m && m.classCode && m.inviteCode) return m;
        } catch {}
      }
      lastErr = new Error(`GitHub Contents 返回 ${r.status}`);
    } catch (e: any) { lastErr = e; }
    // 降级 raw CDN
    try {
      const r = await ghFetch(`${ghRawUrl(inviteCode, 'manifest.json')}`, { raw: true });
      if (r.ok) {
        const m = JSON.parse(r.text) as ClassManifest;
        if (m && m.classCode && m.inviteCode) return m;
      }
    } catch {}
    throw lastErr || new Error('GitHub 班级 manifest 拉取失败');
  },
};

export const anyshareSource: ClassSource = {
  name: 'anyshare',
  async fetchManifest(inviteCode) {
    // 路径：class-manifests/<inviteCode>/manifest.json
    const cfg = DEFAULT_CLASS_ANYSHARE;
    if (!cfg?.enabled) return null;
    const root = await getRootDocid(cfg);
    const classDir = await ensureShareDir(cfg, root.docid, 'class-manifests');
    const classDir2 = await ensureShareDir(cfg, classDir.docid, inviteCode);
    const manifestDir = classDir2.docid;
    const file = await findShareFile(cfg, manifestDir, 'manifest.json');
    if (!file) return null;
    const url = await getFileDownloadUrl(cfg, file);
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`下载 manifest 失败 (${res.status})`);
    const m = JSON.parse(await res.text()) as ClassManifest;
    if (m && m.classCode && m.inviteCode) return m;
    return null;
  },
};

/** 拉取一条公告 */
export async function fetchAnnouncement(inviteCode: string, annId: number, source: 'github' | 'anyshare' = 'github'): Promise<AnnouncementEntry | null> {
  if (source === 'github') {
    const r = await ghFetch(`${ghRawUrl(inviteCode, 'announcements', annId + '.json')}?t=${Date.now()}`);
    if (r.ok) {
      try {
        const e = JSON.parse(r.text) as AnnouncementEntry;
        if (e && e.id === annId) return e;
      } catch {}
    }
    return null;
  }
  // AnyShare
  const cfg = DEFAULT_CLASS_ANYSHARE;
  if (!cfg?.enabled) return null;
  try {
    const root = await getRootDocid(cfg);
    const classDir = await ensureShareDir(cfg, root.docid, 'class-manifests');
    const classDir2 = await ensureShareDir(cfg, classDir.docid, inviteCode);
    const annDir = await ensureShareDir(cfg, classDir2.docid, 'announcements');
    const file = await findShareFile(cfg, annDir.docid, annId + '.json');
    if (!file) return null;
    const url = await getFileDownloadUrl(cfg, file);
    const res = await net.fetch(url);
    if (!res.ok) return null;
    return JSON.parse(await res.text()) as AnnouncementEntry;
  } catch { return null; }
}

/** 拉取一条班级作业 */
export async function fetchClassTask(inviteCode: string, taskId: number, source: 'github' | 'anyshare' = 'github'): Promise<ClassTaskEntry | null> {
  if (source === 'github') {
    const r = await ghFetch(`${ghRawUrl(inviteCode, 'tasks', taskId + '.json')}?t=${Date.now()}`);
    if (r.ok) {
      try {
        const e = JSON.parse(r.text) as ClassTaskEntry;
        if (e && e.id === taskId) return e;
      } catch {}
    }
    return null;
  }
  const cfg = DEFAULT_CLASS_ANYSHARE;
  if (!cfg?.enabled) return null;
  try {
    const root = await getRootDocid(cfg);
    const classDir = await ensureShareDir(cfg, root.docid, 'class-manifests');
    const classDir2 = await ensureShareDir(cfg, classDir.docid, inviteCode);
    const taskDir = await ensureShareDir(cfg, classDir2.docid, 'tasks');
    const file = await findShareFile(cfg, taskDir.docid, taskId + '.json');
    if (!file) return null;
    const url = await getFileDownloadUrl(cfg, file);
    const res = await net.fetch(url);
    if (!res.ok) return null;
    return JSON.parse(await res.text()) as ClassTaskEntry;
  } catch { return null; }
}

/** 拉取一份完整的班级快照（manifest + 所有未缓存的公告/作业） */
export interface ClassSnapshot {
  source: 'github' | 'anyshare';
  manifest: ClassManifest;
  announcements: AnnouncementEntry[];
  tasks: ClassTaskEntry[];
  /** 拉取时间戳 */
  fetchedAt: number;
}

/** 从 manifest 推测完整快照（拉每个新条目） */
export async function fetchClassSnapshot(
  inviteCode: string,
  known: { lastAnnId: number; lastTaskId: number },
  preferredSource: 'github' | 'anyshare' = 'github',
): Promise<ClassSnapshot | null> {
  const src = preferredSource === 'github' ? githubSource : anyshareSource;
  const manifest = await src.fetchManifest(inviteCode);
  if (!manifest) return null;

  // 拉所有 lastAnnId 之间的公告
  const anns: AnnouncementEntry[] = [];
  // 倒序从最新到最旧，逐个拉，失败忽略（不破坏整体）
  const annStart = manifest.lastAnnouncementId;
  for (let id = annStart; id > Math.max(annStart - 100, known.lastAnnId); id--) {
    try {
      const e = await fetchAnnouncement(inviteCode, id, preferredSource);
      if (e) anns.push(e);
    } catch { /* 单条失败不影响整体 */ }
    if (id <= known.lastAnnId + 1) break;  // 增量拉取：超过本机已知就停
  }

  const tasks: ClassTaskEntry[] = [];
  const taskStart = manifest.lastTaskId;
  for (let id = taskStart; id > Math.max(taskStart - 100, known.lastTaskId); id--) {
    try {
      const e = await fetchClassTask(inviteCode, id, preferredSource);
      if (e) tasks.push(e);
    } catch {}
    if (id <= known.lastTaskId + 1) break;
  }

  return {
    source: preferredSource,
    manifest,
    announcements: anns.reverse(),
    tasks: tasks.reverse(),
    fetchedAt: Date.now(),
  };
}

// ============================================================
// 写：发布（GitHub + AnyShare 双写）
// ============================================================

/** GitHub 发布一条公告（或更新 manifest 时调用） */
export async function ghPut(inviteCode: string, relPath: string[], content: string, token: string, sha?: string, message?: string): Promise<void> {
  if (!token) throw new Error('GitHub 写入需要令牌（设置 → 班级 → GitHub PAT）');
  const filePath = ghFilePath(inviteCode, ...relPath);
  const body: any = {
    message: message || `Update class/${inviteCode}/${relPath.join('/')}`,
    branch: CLASS_BRANCH,
    content: encodeUtf8Base64(content),
  };
  if (sha) body.sha = sha;
  const r = await ghFetch(`/contents/${filePath}`, { method: 'PUT', token, body });
  if (!r.ok) {
    let detail = '';
    try { detail = JSON.parse(r.text)?.message || ''; } catch {}
    throw new Error(`发布 ${relPath.join('/')} 失败（HTTP ${r.status}${detail ? '：' + detail : ''}）`);
  }
}

/** GitHub 读取 sha（用于更新时避开 409 冲突） */
export async function ghGetSha(inviteCode: string, relPath: string[]): Promise<string | null> {
  try {
    const filePath = ghFilePath(inviteCode, ...relPath);
    const r = await ghFetch(`/contents/${filePath}?ref=${CLASS_BRANCH}`);
    if (r.status === 404) return null;
    if (r.ok) {
      const m = JSON.parse(r.text);
      return m.sha || null;
    }
  } catch {}
  return null;
}

/** AnyShare 发布一条公告/任务/manifest */
export async function asPut(inviteCode: string, relPath: string[], content: string): Promise<void> {
  const cfg = DEFAULT_CLASS_ANYSHARE;
  if (!cfg?.enabled) throw new Error('AnyShare 未启用');
  const root = await getRootDocid(cfg);
  const classDir = await ensureShareDir(cfg, root.docid, 'class-manifests');
  const classDir2 = await ensureShareDir(cfg, classDir.docid, inviteCode);
  // 逐级 ensure 子目录
  let parentDocid = classDir2.docid;
  for (let i = 0; i < relPath.length - 1; i++) {
    const sub = await ensureShareDir(cfg, parentDocid, relPath[i]);
    parentDocid = sub.docid;
  }
  const name = relPath[relPath.length - 1];
  await uploadTextFileToDir(cfg, parentDocid, name, content);
}

/** 计算 manifest 整体签名 */
export function signManifest(m: ClassManifest): string {
  return createHmac('sha256', CLASS_SECRET)
    .update(`manifest:${m.classCode}|${m.name}|${m.ownerAlias}|${m.lastAnnouncementId}|${m.lastTaskId}|${m.updatedAt}`)
    .digest('base64url').slice(0, 16);
}

// ============================================================
// AnyShare 助手（root docid 缓存）
// ============================================================

const asRootCache = new Map<string, { docid: string; name: string }>();

async function getRootDocid(cfg: AnyShareConfig): Promise<{ docid: string; name: string }> {
  if (asRootCache.has(cfg.linkId)) return asRootCache.get(cfg.linkId)!;
  // 走 link-token 拿到 root
  const { getShareRoot } = await import('../anyshare');
  const root = await getShareRoot(cfg);
  asRootCache.set(cfg.linkId, root);
  return root;
}

// ============================================================
// 找文件助手（按名字 + 父 docid）
// ============================================================

async function findShareFile(cfg: AnyShareConfig, parentDocid: string, name: string): Promise<AnyShareFile | null> {
  try {
    const { dirs, files } = await listDir(cfg, parentDocid);
    const inSub = dirs.find((d) => d.name === name);
    if (inSub) return inSub;
    return files.find((f) => f.name === name) || null;
  } catch { return null; }
}