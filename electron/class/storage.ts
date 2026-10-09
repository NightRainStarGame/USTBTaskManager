/**
 * 班级系统存储适配器（v1.2.7 P2P 班级 → v1.2.15 全量 SSIO 化）。
 *
 * v1.2.15 之前这里同时挂着三条路：GitHub 独立数据仓库（写）+ raw CDN（读）、
 * 北科云盘 AnyShare 备源，以及后来加进来的 SSIO。维护多个后端要处理双写、回退、
 * 配额与「两边数据不一致」，实际收益却为负 —— GitHub 在国内常被 DNS 投毒，
 * 云盘只有校园网可达。现在**只保留 SSIO**，代码量与出错面同时收敛。
 *
 * 设计：
 *   云端 = SSIO KV（内置 Key 即可读写，用户不需要再配置任何令牌）
 *   本机缓存 = SQLite classes / class_announcements / class_chains / class_polls 表
 *
 * 文件协议（与旧版完全一致，所以从 GitHub 迁移过来不需要任何字段转换）：
 *   class/<inviteCode>/
 *     ├── manifest.json           班级核心：成员列表 + 显式条目索引 + sig
 *     ├── announcements/<annId>.json   单条公告（含 body + sig）
 *     ├── tasks/<taskId>.json         单条班级作业
 *     ├── chains/<chainId>.json       接龙（items 多端 union）
 *     └── polls/<pollId>.json         投票（votes 多端 union）
 */
import { createHmac } from 'node:crypto';
import { CLASS_SECRET } from './crypto';
import { kvGetJson, kvPut, kvDelete } from '../cloud/ssioClient';

/** KV 里的班级根目录。路径协议维持原样（class/<邀请码>/…），只是后端从 GitHub 换成了 SSIO。 */
export const CLASS_DIR = 'class';

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

/** v1.2.12：SSIO KV 的键。路径协议与 GitHub 完全一致，只是换了后端。 */
function ssioFilePath(inviteCode: string, ...parts: string[]): string {
  return [CLASS_DIR, inviteCode, ...parts].join('/');
}



// ============================================================
// 读：manifest.json
// ============================================================

/** 读班级 manifest。班级不存在时返回 null（已解散 / 邀请码无效 / 网络不通）。 */
export async function fetchManifest(inviteCode: string): Promise<ClassManifest | null> {
  try {
    const m = await kvGetJson<ClassManifest>(ssioFilePath(inviteCode, 'manifest.json'));
    if (m && m.classCode && m.inviteCode) return m;
  } catch (e) {
    console.warn('[class] SSIO 读取 manifest 失败:', e);
  }
  return null;
}

/** 拉取一条公告 */
export async function fetchAnnouncement(inviteCode: string, annId: number): Promise<AnnouncementEntry | null> {
  try {
    const e = await kvGetJson<AnnouncementEntry>(ssioFilePath(inviteCode, 'announcements', `${annId}.json`));
    if (e && e.id === annId) return e;
  } catch (e) {
    console.warn('[class] SSIO 读取公告失败:', e);
  }
  return null;
}

/** 拉取一条班级作业 */
export async function fetchClassTask(inviteCode: string, taskId: number): Promise<ClassTaskEntry | null> {
  try {
    const e = await kvGetJson<ClassTaskEntry>(ssioFilePath(inviteCode, 'tasks', `${taskId}.json`));
    if (e && e.id === taskId) return e;
  } catch (e) {
    console.warn('[class] SSIO 读取班级作业失败:', e);
  }
  return null;
}

/** 拉取一条接龙（v1.2.9 R4；items 多端 union） */
export async function fetchChain(inviteCode: string, chainId: number): Promise<ChainEntry | null> {
  try {
    const e = await kvGetJson<ChainEntry>(ssioFilePath(inviteCode, 'chains', `${chainId}.json`));
    if (e && e.id === chainId) return e;
  } catch (e) {
    console.warn('[class] SSIO 读取接龙失败:', e);
  }
  return null;
}

/** 拉取一条投票（v1.2.9 R5；votes 多端 union） */
export async function fetchPoll(inviteCode: string, pollId: number): Promise<PollEntry | null> {
  try {
    const e = await kvGetJson<PollEntry>(ssioFilePath(inviteCode, 'polls', `${pollId}.json`));
    if (e && e.id === pollId) return e;
  } catch (e) {
    console.warn('[class] SSIO 读取投票失败:', e);
  }
  return null;
}

/** 拉取一份完整的班级快照（manifest + 所有未缓存的公告/作业/接龙/投票）
 *  v1.2.9 R1 重写：manifest 带 announcementIds/taskIds/chainIds/pollIds 显式索引时，
 *  按索引逐条拉本机没有的（取代旧的「时间戳逐毫秒倒数扫描」——那只能覆盖最新 100ms 窗口，
 *  第二条公告永远同步不到）。旧 manifest 无索引 → fallback 老扫描逻辑（兼容 v1.2.7/8 数据）。 */
export interface ClassSnapshot {
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
): Promise<ClassSnapshot | null> {
  const manifest = await fetchManifest(inviteCode);
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
        const e = await fetchAnnouncement(inviteCode, id);
        if (e) anns.push(e);
      } catch { /* 单条失败不影响整体 */ }
    }
  } else {
    // 旧协议 fallback：毫秒扫描（只对「本机 0 缓存 + 仅一条公告」的场景有效）
    const annStart = manifest.lastAnnouncementId;
    for (let id = annStart; id > Math.max(annStart - 100, known.lastAnnId); id--) {
      try {
        const e = await fetchAnnouncement(inviteCode, id);
        if (e) anns.push(e);
      } catch { /* 单条失败不影响整体 */ }
      if (id <= known.lastAnnId + 1) break;
    }
  }

  if (Array.isArray(manifest.taskIds)) {
    for (const id of manifest.taskIds) {
      if (knownTask.has(id)) continue;
      try {
        const e = await fetchClassTask(inviteCode, id);
        if (e) tasks.push(e);
      } catch {}
    }
  } else {
    const taskStart = manifest.lastTaskId;
    for (let id = taskStart; id > Math.max(taskStart - 100, known.lastTaskId); id--) {
      try {
        const e = await fetchClassTask(inviteCode, id);
        if (e) tasks.push(e);
      } catch {}
      if (id <= known.lastTaskId + 1) break;
    }
  }

  // 注意：chains/polls 是可变内容（items/votes 随时追加），不能按 knownIds 跳过——
  // 每次全量重拉（≤50 条上限），upsert 端 union 合并幂等。班级规模下开销可接受。
  if (Array.isArray(manifest.chainIds)) {
    for (const id of manifest.chainIds.slice(-50)) {
      try {
        const e = await fetchChain(inviteCode, id);
        if (e) chains.push(e);
      } catch {}
    }
  }
  if (Array.isArray(manifest.pollIds)) {
    for (const id of manifest.pollIds.slice(-50)) {
      try {
        const e = await fetchPoll(inviteCode, id);
        if (e) polls.push(e);
      } catch {}
    }
  }

  return {
    manifest,
    announcements: anns,
    tasks: tasks,
    chains,
    polls,
    fetchedAt: Date.now(),
  };
}

// ============================================================
// 写：发布（SSIO KV；v1.2.15 前这里是 GitHub + AnyShare 双写）
// ============================================================

/**
 * 写一个班级文件（manifest / 公告 / 作业 / 接龙 / 投票）。
 * KV 是 upsert —— 不像 GitHub Contents API 那样必须先 GET 拿到 sha 再 PUT，
 * 也因此不存在 409 冲突，写路径不必再重试。
 */
export async function putClassFile(inviteCode: string, relPath: string[], content: string): Promise<void> {
  await kvPut(ssioFilePath(inviteCode, ...relPath), content);
}

/** 删一个班级文件（v1.2.9 R2：公告撤回）。KV 删除幂等，key 不存在也算成功。 */
export async function deleteClassFile(inviteCode: string, relPath: string[]): Promise<void> {
  await kvDelete(ssioFilePath(inviteCode, ...relPath));
}

/** 计算 manifest 整体签名 */
export function signManifest(m: ClassManifest): string {
  return createHmac('sha256', CLASS_SECRET)
    .update(`manifest:${m.classCode}|${m.name}|${m.ownerAlias}|${m.lastAnnouncementId}|${m.lastTaskId}|${m.updatedAt}`)
    .digest('base64url').slice(0, 16);
}

