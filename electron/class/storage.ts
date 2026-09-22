/**
 * 班级系统存储适配器（v1.2.7 P2P 班级；v1.2.9 R9 改独立仓库 + 内置公共写入令牌）
 *
 * 设计：
 *   主源 = GitHub（**独立数据仓库 USTBTaskManager-Class**，与主仓库隔离）
 *          读走 raw CDN（免鉴权、无限速）；写走 Contents API
 *          写令牌优先级：用户个人 PAT → 内置公共令牌（开箱即用）
 *   备源 = 北科云盘（AnyShare）匿名分享（可选，用户自行配置；仅校园网可达）
 *   本机缓存 = SQLite classes/class_announcements/class_chains/class_polls 表
 *
 * 为什么独立仓库（v1.2.9 R9）：
 *   · 内置公共令牌可能被提取（源码公开 + asar 可逆）——fine-grained PAT 只授权
 *     本仓库 Contents 读写，泄露的爆炸半径 = 班级数据被污染（git 可回滚），
 *     动不了主仓库的 latest.json / homework（否则可推送恶意更新，不可接受）
 *   · 班级高频写入（接龙/投票）不再污染主仓库提交历史
 *
 * 文件协议：
 *   class/<inviteCode>/
 *     ├── manifest.json           班级核心：成员列表 + 显式条目索引 + sig
 *     ├── announcements/<annId>.json   单条公告（含 body + sig）
 *     ├── tasks/<taskId>.json         单条班级作业（v1.2.9 保留 API 兼容）
 *     ├── chains/<chainId>.json       接龙（items 多端 union）
 *     └── polls/<pollId>.json         投票（votes 多端 union）
 *
 * GitHub 写入令牌（设置 → 班级 → GitHub 令牌）：
 *   个人 PAT 优先（独立配额）；未配置时用内置公共令牌（共享配额，写频率低足够用）。
 *   读路径全部走 raw CDN，不消耗 Contents API 配额（公共令牌 5000 req/h 全留给写）。
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
export const CLASS_REPO_NAME = 'USTBTaskManager-Class';
export const CLASS_BRANCH = 'main';
export const CLASS_DIR = 'class';

// ── v1.2.9 R9：内置公共写入令牌（fine-grained PAT，仅本仓库 Contents 读写）──
// 拆段 base64 只为防 grep/OCR 直提；源码公开的前提下防不住有心人，安全边界
// 靠 fine-grained PAT 的仓库级授权（泄露 SOP：GitHub 吊销 → 换新段 → 发版）。
// 创建步骤见 docs/CLASS-P2P.md「内置公共写入令牌」节。
const FALLBACK_TOKEN_B64: string[] = [
  // 豆芽 2026-09-22 创建的 fine-grained PAT（仅本仓库 Contents rw，有效期 1 年）
  // 已验证：class 仓库写/删 OK；主仓库写入 403 被拒（爆炸半径隔离成立）
  'Z2l0aHViX3BhdF8xMUNLWEZPVkEwM2pt',
  'SFBySHdoa2x6X21pY241Ym1hZk1CTjVW',
  'b0U2MlN1SzdRb3dFaHZJbWVWWENIWnZh',
  'bUlOeGtOTU9KRk9OMm91dzZmOFZF',
];
export const CLASS_FALLBACK_TOKEN: string =
  FALLBACK_TOKEN_B64.map((p) => Buffer.from(p, 'base64').toString('utf8')).join('');

/** AnyShare 备源默认配置（v1.2.9 R9：不再内置假占位链——之前那个 linkId 从未在
 *  云盘上创建过，导致「北科云盘也不好使」；现在默认关闭，用户自己配置才启用） */
export const DEFAULT_CLASS_ANYSHARE: AnyShareConfig & { enabled: boolean } = {
  baseUrl: 'https://yunpan.ustb.edu.cn',
  linkId: '',
  password: '',
  enabled: false,
};

// v1.2.9 R9：运行时生效的 AnyShare 配置（registerClass / saveCloud 时从 settings 注入）
// 之前 storage 层所有函数硬编码读 DEFAULT_CLASS_ANYSHARE，用户在设置里配的链接被无视——
// 这是「云盘配置了也不通」的第二个根因。
let activeAnyShareCfg: AnyShareConfig & { enabled: boolean } = { ...DEFAULT_CLASS_ANYSHARE };

export function setClassAnyShareConfig(cfg: AnyShareConfig & { enabled: boolean }) {
  activeAnyShareCfg = { ...cfg };
  asRootCache.clear();
}

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
  // ── v1.2.9 R1：显式条目索引（修复「逐毫秒倒数扫描只能覆盖 100ms 窗口」的致命 bug）──
  // 设计：这些字段**不参与 manifest 签名**（signManifest 输入串不变）：
  //   · 旧班级（v1.2.7/8 发布的 manifest）验签不破坏，新客户端能读旧文件
  //   · 索引被篡改的后果 = 多拉/漏拉条目，条目本身有 verifyEntry 兜底
  announcementIds?: number[];         // 全部公告 id（发布时 push）
  taskIds?: number[];                 // 全部作业 id
  deletedAnnouncementIds?: number[];  // 已删除公告 tombstone（sync 据此删本地）
  // ── v1.2.9 R4/R5：接龙 / 投票索引 ──
  chainIds?: number[];                // 全部接龙 id
  pollIds?: number[];                 // 全部投票 id
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

/** v1.2.9 R4：接龙条目（items 多端 union 合并，任何人可追加） */
export interface ChainItem {
  alias: string;
  content: string;
  ts: number;
}

export interface ChainEntry {
  id: number;               // 时间戳 ID
  authorAlias: string;      // 发起人
  title: string;
  body: string;             // 规则说明（如「报名周六团建，格式：姓名+电话」）
  items: ChainItem[];       // 参与记录（按 alias+ts 去重 union）
  closed: boolean;          // 关闭后不可再接
  createdAt: number;
  updatedAt: number;
  /** sig 只覆盖 title|body（发起时固定）；items 任何人可追加不参与签名 */
  sig: string;
}

/** v1.2.9 R5：投票条目（votes 多端 union，同 alias 取 ts 大者；options 创建时固定） */
export interface PollVote {
  choices: number[];        // 选项下标（单选长度 1）
  ts: number;
}

export interface PollEntry {
  id: number;
  authorAlias: string;
  question: string;
  description: string;
  options: { text: string }[];
  votes: Record<string, PollVote>;  // alias → vote
  multi: boolean;                   // true = 多选
  closed: boolean;
  deadlineAt: number | null;        // 截止时间（null = 无）
  createdAt: number;
  updatedAt: number;
  /** sig 覆盖 question|description|options 文本（创建时固定）；votes 不参与签名 */
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
    // v1.2.9 R9：raw CDN 优先（免鉴权无限速；不占共享令牌的 Contents API 配额——
    // 内置公共令牌 5000 req/h 全部留给写路径，读全走 raw）
    // ?t= 随机参数绕 CDN 缓存，保证读到刚 push 的版本
    let rawNotFound = false;
    try {
      const r = await ghFetch(`${ghRawUrl(inviteCode, 'manifest.json')}?t=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, { raw: true });
      if (r.ok) {
        try {
          const m = JSON.parse(r.text) as ClassManifest;
          if (m && m.classCode && m.inviteCode) return m;
        } catch {}
      } else if (r.status === 404) {
        // raw 说没有 → Contents API 复核一次（刚创建的班级，raw 可能有秒级传播延迟）
        rawNotFound = true;
      }
    } catch {}
    // 降级 Contents API（raw 异常时的兜底；未认证 60 req/h，仅低频命中）
    const filePath = `${ghFilePath(inviteCode, 'manifest.json')}`;
    try {
      const r = await ghFetch(`/contents/${filePath}?ref=${CLASS_BRANCH}&t=${Date.now()}`);
      if (r.status === 404) return null;
      if (r.ok) {
        try {
          const meta = JSON.parse(r.text);
          const m = JSON.parse(decodeBase64Utf8(meta.content || '')) as ClassManifest;
          if (m && m.classCode && m.inviteCode) return m;
        } catch {}
      }
    } catch {}
    if (rawNotFound) return null;  // raw 与 Contents 都确认不存在
    throw new Error('GitHub 班级 manifest 拉取失败');
  },
};

export const anyshareSource: ClassSource = {
  name: 'anyshare',
  async fetchManifest(inviteCode) {
    // 路径：class-manifests/<inviteCode>/manifest.json
    const cfg = activeAnyShareCfg;
    if (!cfg?.linkId || !cfg?.enabled) return null;
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
  const cfg = activeAnyShareCfg;
  if (!cfg?.linkId || !cfg?.enabled) return null;
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
  const cfg = activeAnyShareCfg;
  if (!cfg?.linkId || !cfg?.enabled) return null;
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

/** 拉取一条接龙（v1.2.9 R4；仅 GitHub 源——AnyShare 备源只兜公告/作业） */
export async function fetchChain(inviteCode: string, chainId: number): Promise<ChainEntry | null> {
  const r = await ghFetch(`${ghRawUrl(inviteCode, 'chains', chainId + '.json')}?t=${Date.now()}`);
  if (r.ok) {
    try {
      const e = JSON.parse(r.text) as ChainEntry;
      if (e && e.id === chainId) return e;
    } catch {}
  }
  return null;
}

/** 拉取一条投票（v1.2.9 R5；仅 GitHub 源） */
export async function fetchPoll(inviteCode: string, pollId: number): Promise<PollEntry | null> {
  const r = await ghFetch(`${ghRawUrl(inviteCode, 'polls', pollId + '.json')}?t=${Date.now()}`);
  if (r.ok) {
    try {
      const e = JSON.parse(r.text) as PollEntry;
      if (e && e.id === pollId) return e;
    } catch {}
  }
  return null;
}

/** 拉取一份完整的班级快照（manifest + 所有未缓存的公告/作业/接龙/投票）
 *  v1.2.9 R1 重写：manifest 带 announcementIds/taskIds/chainIds/pollIds 显式索引时，
 *  按索引逐条拉本机没有的（取代旧的「时间戳逐毫秒倒数扫描」——那只能覆盖最新 100ms 窗口，
 *  第二条公告永远同步不到）。旧 manifest 无索引 → fallback 老扫描逻辑（兼容 v1.2.7/8 数据）。 */
export interface ClassSnapshot {
  source: 'github' | 'anyshare';
  manifest: ClassManifest;
  announcements: AnnouncementEntry[];
  tasks: ClassTaskEntry[];
  chains: ChainEntry[];
  polls: PollEntry[];
  /** 拉取时间戳 */
  fetchedAt: number;
}

export async function fetchClassSnapshot(
  inviteCode: string,
  known: {
    lastAnnId: number; lastTaskId: number;
    /** 本机已有的条目 id 集合（增量跳过用） */
    annIds?: number[]; taskIds?: number[]; chainIds?: number[]; pollIds?: number[];
  },
  preferredSource: 'github' | 'anyshare' = 'github',
): Promise<ClassSnapshot | null> {
  const src = preferredSource === 'github' ? githubSource : anyshareSource;
  const manifest = await src.fetchManifest(inviteCode);
  if (!manifest) return null;

  const anns: AnnouncementEntry[] = [];
  const tasks: ClassTaskEntry[] = [];
  const chains: ChainEntry[] = [];
  const polls: PollEntry[] = [];
  const knownAnn = new Set(known.annIds || []);
  const knownTask = new Set(known.taskIds || []);

  if (Array.isArray(manifest.announcementIds)) {
    // 新协议：显式索引
    for (const id of manifest.announcementIds) {
      if (knownAnn.has(id)) continue;
      try {
        const e = await fetchAnnouncement(inviteCode, id, preferredSource);
        if (e) anns.push(e);
      } catch { /* 单条失败不影响整体 */ }
    }
  } else {
    // 旧协议 fallback：毫秒扫描（只对「本机 0 缓存 + 仅一条公告」的场景有效）
    const annStart = manifest.lastAnnouncementId;
    for (let id = annStart; id > Math.max(annStart - 100, known.lastAnnId); id--) {
      try {
        const e = await fetchAnnouncement(inviteCode, id, preferredSource);
        if (e) anns.push(e);
      } catch { /* 单条失败不影响整体 */ }
      if (id <= known.lastAnnId + 1) break;
    }
  }

  if (Array.isArray(manifest.taskIds)) {
    for (const id of manifest.taskIds) {
      if (knownTask.has(id)) continue;
      try {
        const e = await fetchClassTask(inviteCode, id, preferredSource);
        if (e) tasks.push(e);
      } catch {}
    }
  } else {
    const taskStart = manifest.lastTaskId;
    for (let id = taskStart; id > Math.max(taskStart - 100, known.lastTaskId); id--) {
      try {
        const e = await fetchClassTask(inviteCode, id, preferredSource);
        if (e) tasks.push(e);
      } catch {}
      if (id <= known.lastTaskId + 1) break;
    }
  }

  // 接龙 / 投票仅走 GitHub（AnyShare 匿名链只兜公告/作业，文件结构不同不双写）
  // 注意：chains/polls 是可变内容（items/votes 随时追加），不能按 knownIds 跳过——
  // 每次全量重拉（≤50 条上限），upsert 端 union 合并幂等。班级规模下开销可接受。
  if (preferredSource === 'github' && Array.isArray(manifest.chainIds)) {
    for (const id of manifest.chainIds.slice(-50)) {
      try {
        const e = await fetchChain(inviteCode, id);
        if (e) chains.push(e);
      } catch {}
    }
  }
  if (preferredSource === 'github' && Array.isArray(manifest.pollIds)) {
    for (const id of manifest.pollIds.slice(-50)) {
      try {
        const e = await fetchPoll(inviteCode, id);
        if (e) polls.push(e);
      } catch {}
    }
  }

  return {
    source: preferredSource,
    manifest,
    announcements: anns,
    tasks: tasks,
    chains,
    polls,
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

/** GitHub 读取 sha（用于更新时避开 409 冲突；带 token 走认证配额 5000/h） */
export async function ghGetSha(inviteCode: string, relPath: string[], token?: string): Promise<string | null> {
  try {
    const filePath = ghFilePath(inviteCode, ...relPath);
    const r = await ghFetch(`/contents/${filePath}?ref=${CLASS_BRANCH}`, { token });
    if (r.status === 404) return null;
    if (r.ok) {
      const m = JSON.parse(r.text);
      return m.sha || null;
    }
  } catch {}
  return null;
}

/** GitHub 删除文件（v1.2.9 R2：公告撤回。Contents API DELETE 必须带 sha） */
export async function ghDelete(inviteCode: string, relPath: string[], token: string, sha: string, message?: string): Promise<void> {
  if (!token) throw new Error('GitHub 删除需要令牌');
  const filePath = ghFilePath(inviteCode, ...relPath);
  const body = {
    message: message || `Delete class/${inviteCode}/${relPath.join('/')}`,
    branch: CLASS_BRANCH,
    sha,
  };
  const r = await ghFetch(`/contents/${filePath}`, { method: 'DELETE', token, body });
  if (!r.ok) {
    let detail = '';
    try { detail = JSON.parse(r.text)?.message || ''; } catch {}
    throw new Error(`删除 ${relPath.join('/')} 失败（HTTP ${r.status}${detail ? '：' + detail : ''}）`);
  }
}

/** AnyShare 发布一条公告/任务/manifest */
export async function asPut(inviteCode: string, relPath: string[], content: string): Promise<void> {
  const cfg = activeAnyShareCfg;
  if (!cfg?.linkId || !cfg?.enabled) throw new Error('AnyShare 备源未配置（班级 → 配置 → 云盘分享链接）');
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