/**
 * 班级系统主入口（v1.2.7 P2P 班级）
 *
 * 流程：
 *   1. 创建：class:create → 生成 classCode + inviteCode → owner_token + 本地 alias →
 *      写本地 classes 表 → 上传 manifest.json 到 GitHub + AnyShare
 *   2. 加入：class:join → 解析 inviteCode → 拉 manifest.json → 写本地 classes 表（role=member）
 *   3. 同步：class:sync → 拉新 manifest → 拉新公告/作业条目 → 写本地缓存
 *   4. 发布：class:publishAnnouncement / class:publishTask → 写条目文件 →
 *       update manifest（含新 lastAnnouncementId/lastTaskId）→ 写回 GitHub + AnyShare
 *
 * 权限模型：
 *   - 创建者持有 owner_token，本机用 HMAC 计算签名 → 写操作必须验签
 *   - 普通成员只能 read + 标记本地已读
 *   - owner 离开 → 班级解散（manifest.members 删除该 alias）
 *   - member 离开 → 本地删除，云端不动（其他成员仍能看到成员列表）
 *
 * 错误码（errorCode 字段）：
 *   - INVALID_INVITE_CODE  邀请码格式错或 HMAC 校验失败
 *   - NETWORK_ERR          拉取远端失败
 *   - NOT_FOUND            云端没有此班级
 *   - ALREADY_JOINED       本机已加入过此班级（按 inviteCode 去重）
 *   - NOT_OWNER            非 owner 试图发布
 *   - TOKEN_REQUIRED       GitHub 写入需要 PAT
 */
import { ipcMain, app } from 'electron';
import type { DB } from '../db/index';
import {
  generateClassCode, generateOwnerToken, deriveInviteCode,
  signMember, verifyMember, signEntry, verifyEntry, normalizeInviteCode,
} from './crypto';
import {
  ghFetch, ghPut, ghGetSha, ghDelete,
  asPut,
  fetchClassSnapshot, fetchChain, fetchPoll,
  githubSource, anyshareSource,
  signManifest,
  CLASS_REPO_OWNER, CLASS_REPO_NAME, CLASS_BRANCH,
  DEFAULT_CLASS_ANYSHARE,
  type ClassManifest, type MemberEntry, type AnnouncementEntry, type ClassTaskEntry,
  type ChainEntry, type ChainItem, type PollEntry, type PollVote,
} from './storage';
import { parseAnyShareUrl } from '../anyshare';

// ============================================================
// Settings 助手（GitHub PAT / AnyShare 单独存）
// ============================================================
const SETTING_GH_TOKEN = 'class_github_token';
const SETTING_AS_CONFIG = 'class_anyshare';   // JSON: { baseUrl, linkId, password, enabled }
const SETTING_LAST_SYNC_PREFIX = 'class_last_sync_';
const SETTING_LOCAL_ALIAS = 'class_local_alias';  // 用户在本机所有班级的默认昵称

function getSetting(db: DB, key: string): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
}
function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

function getGitHubToken(db: DB): string {
  return getSetting(db, SETTING_GH_TOKEN).trim();
}

function getClassAnyShareConfig(db: DB): { baseUrl: string; linkId: string; password: string; enabled: boolean } {
  const raw = getSetting(db, SETTING_AS_CONFIG);
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j?.linkId) return {
        baseUrl: String(j.baseUrl || DEFAULT_CLASS_ANYSHARE.baseUrl),
        linkId: String(j.linkId),
        password: String(j.password || ''),
        enabled: j.enabled !== false,
      };
    } catch {}
  }
  return { ...DEFAULT_CLASS_ANYSHARE };
}

function getLocalAlias(db: DB): string {
  return getSetting(db, SETTING_LOCAL_ALIAS).trim() || '我';
}

// ============================================================
// DB 行 ↔ TypeScript 类型转换
// ============================================================

interface ClassRow {
  id: number; code: string; share_code: string; name: string; description: string | null;
  owner_token: string | null; role: string; member_count: number; max_members: number;
  cloud_synced: number; last_synced_at: number | null; joined_at: number; dissolved: number;
  alias: string; invite_code: string; owner_alias: string;
  last_announcement_id: number; last_task_id: number; manifest_sha: string | null;
  members_json: string;
  /** v1.2.9 R3：本机昵称是否已写入云端 manifest.members（被移除检测的前提） */
  member_synced?: number;
}

function rowToClass(row: ClassRow) {
  let members: MemberEntry[] = [];
  try { members = JSON.parse(row.members_json || '[]'); } catch {}
  return {
    id: row.id,
    classCode: row.code,
    inviteCode: row.invite_code || row.share_code,
    name: row.name,
    description: row.description || '',
    ownerAlias: row.owner_alias || '',
    myAlias: row.alias || getLocalAlias(_db!),
    role: (row.role || 'member') as 'owner' | 'admin' | 'member',
    memberCount: row.member_count || 1,
    maxMembers: row.max_members || 50,
    cloudSynced: !!row.cloud_synced,
    lastSyncedAt: row.last_synced_at || null,
    joinedAt: row.joined_at,
    dissolved: !!row.dissolved,
    members,
    lastAnnouncementId: row.last_announcement_id || 0,
    lastTaskId: row.last_task_id || 0,
    manifestSha: row.manifest_sha || null,
  };
}

function fetchClassRow(id: number): ClassRow | undefined {
  return _db!.prepare('SELECT * FROM classes WHERE id = ?').get(id) as ClassRow | undefined;
}

function fetchClassByCode(code: string): ClassRow | undefined {
  return _db!.prepare('SELECT * FROM classes WHERE code = ?').get(code) as ClassRow | undefined;
}

function updateMembersCache(classId: number, members: MemberEntry[]) {
  _db!.prepare('UPDATE classes SET members_json = ? WHERE id = ?').run(JSON.stringify(members), classId);
}

function updateLastIds(classId: number, lastAnn: number, lastTask: number) {
  _db!.prepare('UPDATE classes SET last_announcement_id = MAX(last_announcement_id, ?), last_task_id = MAX(last_task_id, ?), last_synced_at = ? WHERE id = ?')
    .run(lastAnn, lastTask, Date.now(), classId);
}

// ============================================================
// module-level db reference
// ============================================================
let _db: DB | null = null;
const asRootCache = new Map<string, { docid: string; name: string }>();

async function getAsRoot(cfg: { baseUrl: string; linkId: string; password: string; enabled: boolean }) {
  if (asRootCache.has(cfg.linkId)) return asRootCache.get(cfg.linkId)!;
  const { getShareRoot } = await import('../anyshare');
  const r = await getShareRoot(cfg);
  asRootCache.set(cfg.linkId, r);
  return r;
}

// ============================================================
// 主入口
// ============================================================
export function registerClass(db: DB) {
  _db = db;

  // v1.2.8 块 O：UPSERT helper（自动合并：已存在的条目更新 content，保留本地 status / is_read）
  // v1.2.9 R1 修复：INSERT 显式写云端时间戳 id + author_alias（之前自增 id 与云端 id 对不上 → sync 重复插入 + 作者恒空）
  function upsertAnnouncement(classId: number, e: AnnouncementEntry): 'new' | 'updated' {
    const exist = db.prepare('SELECT id FROM class_announcements WHERE class_id = ? AND id = ?').get(classId, e.id);
    if (exist) {
      db.prepare(
        `UPDATE class_announcements
         SET title = ?, body = ?, images_json = ?, pinned = ?, author_alias = ?
         WHERE class_id = ? AND id = ?`
      ).run(e.title, e.body, JSON.stringify(e.images), e.pinned ? 1 : 0, e.authorAlias || '', classId, e.id);
      return 'updated';
    }
    db.prepare(
      `INSERT INTO class_announcements (id, class_id, author_alias, title, body, images_json, pinned, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(e.id, classId, e.authorAlias || '', e.title, e.body, JSON.stringify(e.images), e.pinned ? 1 : 0, e.createdAt);
    return 'new';
  }
  function upsertTask(classId: number, e: ClassTaskEntry): 'new' | 'updated' {
    const exist = db.prepare('SELECT id FROM class_tasks WHERE class_id = ? AND id = ?').get(classId, e.id);
    if (exist) {
      db.prepare(
        `UPDATE class_tasks
         SET title = ?, body = ?, images_json = ?, due_at = ?, author_alias = ?
         WHERE class_id = ? AND id = ?`
      ).run(e.title, e.body, JSON.stringify(e.images || []), e.dueAt, e.authorAlias || '', classId, e.id);
      return 'updated';
    }
    db.prepare(
      `INSERT INTO class_tasks (id, class_id, author_alias, title, body, images_json, due_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(e.id, classId, e.authorAlias || '', e.title, e.body, JSON.stringify(e.images || []), e.dueAt, e.createdAt);
    return 'updated';
  }
  // v1.2.9 R4：接龙 upsert（items 多端 union 合并）
  function upsertChain(classId: number, e: ChainEntry): 'new' | 'updated' {
    const exist = db.prepare('SELECT items_json FROM class_chains WHERE class_id = ? AND id = ?')
      .get(classId, e.id) as { items_json: string } | undefined;
    if (exist) {
      const localItems: ChainItem[] = safeParseArr(exist.items_json) as unknown as ChainItem[];
      const merged = mergeChainItems(localItems, e.items || []);
      db.prepare(
        `UPDATE class_chains SET title = ?, body = ?, items_json = ?, closed = ?, updated_at = ? WHERE class_id = ? AND id = ?`
      ).run(e.title, e.body, JSON.stringify(merged), e.closed ? 1 : 0, e.updatedAt, classId, e.id);
      return 'updated';
    }
    db.prepare(
      `INSERT INTO class_chains (id, class_id, author_alias, title, body, items_json, closed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, classId, e.authorAlias || '', e.title, e.body, JSON.stringify(e.items || []), e.closed ? 1 : 0, e.createdAt, e.updatedAt);
    return 'new';
  }
  // v1.2.9 R5：投票 upsert（votes 多端 union，同 alias 取 ts 大者）
  function upsertPoll(classId: number, e: PollEntry): 'new' | 'updated' {
    const exist = db.prepare('SELECT votes_json FROM class_polls WHERE class_id = ? AND id = ?')
      .get(classId, e.id) as { votes_json: string } | undefined;
    if (exist) {
      const localVotes: Record<string, PollVote> = safeParseObj(exist.votes_json);
      const merged = mergePollVotes(localVotes, e.votes || {});
      db.prepare(
        `UPDATE class_polls SET question = ?, description = ?, options_json = ?, votes_json = ?, multi = ?, closed = ?, deadline_at = ?, updated_at = ? WHERE class_id = ? AND id = ?`
      ).run(e.question, e.description, JSON.stringify(e.options || []), JSON.stringify(merged), e.multi ? 1 : 0, e.closed ? 1 : 0, e.deadlineAt || null, e.updatedAt, classId, e.id);
      return 'updated';
    }
    db.prepare(
      `INSERT INTO class_polls (id, class_id, author_alias, question, description, options_json, votes_json, multi, closed, deadline_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.id, classId, e.authorAlias || '', e.question, e.description, JSON.stringify(e.options || []), JSON.stringify(e.votes || {}), e.multi ? 1 : 0, e.closed ? 1 : 0, e.deadlineAt || null, e.createdAt, e.updatedAt);
    return 'new';
  }
  // 暴露给 sync handler 复用（避免 4 处重复 INSERT/UPDATE）
  (db as any).__classUpsertAnnouncement = upsertAnnouncement;
  (db as any).__classUpsertTask = upsertTask;

  // v1.2.9 R1：远端 manifest 原子更新（fetch → mutate → 重签 → PUT sha；409 冲突重拉重试 2 次）
  async function mutateManifestRemote(inviteCode: string, token: string, message: string, mutate: (m: ClassManifest) => void): Promise<ClassManifest | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await githubSource.fetchManifest(inviteCode);
      if (!cur) throw new Error('云端 manifest 拉取失败');
      mutate(cur);
      cur.updatedAt = Date.now();
      cur.sig = signManifest(cur);
      const sha = await ghGetSha(inviteCode, ['manifest.json']);
      try {
        await ghPut(inviteCode, ['manifest.json'], JSON.stringify(cur, null, 2), token, sha || undefined, message);
        return cur;
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (attempt < 2 && /409/i.test(msg)) continue;  // sha 过期冲突 → 重拉重试
        throw e;
      }
    }
    return null;
  }

  // v1.2.8 块 O：30s 后台轮询（所有 class 自动 sync）
  // - 教室下课前常常实时发布作业，及时同步比手动点 sync 体验好
  // - 关闭 app 时清理定时器，避免泄漏
  const bgTimer = setInterval(async () => {
    if (!db) return;
    try {
      const rows = db.prepare('SELECT id, last_sync_at FROM classes WHERE dissolved = 0').all() as Array<{ id: number; last_sync_at: number | null }>;
      for (const r of rows) {
        // 60s 内同步过的跳过（避免与前台 sync 重复）
        if (r.last_sync_at && Date.now() - r.last_sync_at < 60_000) continue;
        try { await syncClassCore(r.id); }
        catch { /* 单个班级失败不影响其他班级 */ }
      }
    } catch { /* 静默 */ }
  }, 30_000);
  bgTimer.unref?.();
  // 退出清理
  app.on('will-quit', () => clearInterval(bgTimer));

  /** 同步核心：拉取云端 manifest + 公告/作业/接龙/投票，自动合并到本地。
   *  sync IPC 和 30s 后台轮询 都调它。
   *  v1.2.9 R1：改用 manifest 显式索引增量拉取；R2 应用删除 tombstone；R3 检测「我被移除」。 */
  async function syncClassCore(classId: number): Promise<{ ok: boolean; error?: string; errorCode?: string; source?: string; newAnnouncements?: number; updatedAnnouncements?: number; newTasks?: number; updatedTasks?: number; newChains?: number; newPolls?: number; kicked?: boolean; manifest?: any }> {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };

    // 本机已知条目 id（增量跳过；接龙/投票是可变内容，每次全量重拉后 union 合并）
    const localAnnIds = (db.prepare('SELECT id FROM class_announcements WHERE class_id = ?').all(classId) as Array<{ id: number }>).map(r => r.id);
    const localTaskIds = (db.prepare('SELECT id FROM class_tasks WHERE class_id = ?').all(classId) as Array<{ id: number }>).map(r => r.id);

    type SyncResult = { ok: boolean; error?: string; errorCode?: string; source?: string; newAnnouncements?: number; updatedAnnouncements?: number; newTasks?: number; updatedTasks?: number; newChains?: number; newPolls?: number; kicked?: boolean; manifest?: any };
    const applySnapshot = (snap: { source: string; manifest: ClassManifest; announcements: AnnouncementEntry[]; tasks: ClassTaskEntry[]; chains: ChainEntry[]; polls: PollEntry[] }): SyncResult => {
      const m = snap.manifest;
      // R3：被移除检测——本机昵称不在云端成员列表（且本机确认曾写入过云端）→ 本地下线
      const myAlias = row.alias || getLocalAlias(db);
      const wasMemberSynced = !!row.member_synced;
      if (wasMemberSynced && row.role !== 'owner' && Array.isArray(m.members) && !m.members.some((x) => x.alias === myAlias)) {
        db.prepare('UPDATE classes SET dissolved = 1 WHERE id = ?').run(classId);
        return { ok: false, errorCode: 'KICKED', error: '你已被移出该班级', kicked: true };
      }

      let newAnn = 0, updatedAnn = 0;
      for (const e of snap.announcements) {
        if (!verifyEntry(row.code, 'announcement', e.id, e.body, e.sig)) continue;
        const r = upsertAnnouncement(classId, e);
        if (r === 'new') newAnn++; else updatedAnn++;
      }
      let newTask = 0, updatedTask = 0;
      for (const e of snap.tasks) {
        if (!verifyEntry(row.code, 'task', e.id, e.body + (e.dueAt || 0), e.sig)) continue;
        const r = upsertTask(classId, e);
        if (r === 'new') newTask++; else updatedTask++;
      }
      let newChain = 0;
      for (const e of snap.chains) {
        if (!verifyEntry(row.code, 'chain', e.id, e.title + '|' + e.body, e.sig)) continue;
        const r = upsertChain(classId, e);
        if (r === 'new') newChain++;
      }
      let newPoll = 0;
      for (const e of snap.polls) {
        if (!verifyEntry(row.code, 'poll', e.id, e.question + '|' + e.description + '|' + (e.options || []).map(o => o.text).join('||'), e.sig)) continue;
        const r = upsertPoll(classId, e);
        if (r === 'new') newPoll++;
      }
      // R2：应用删除 tombstone（云端已删的公告，本地同步删掉）
      if (Array.isArray(m.deletedAnnouncementIds)) {
        for (const id of m.deletedAnnouncementIds) {
          db.prepare('DELETE FROM class_announcements WHERE class_id = ? AND id = ?').run(classId, id);
        }
      }
      updateMembersCache(classId, m.members);
      updateLastIds(classId, m.lastAnnouncementId, m.lastTaskId);
      setSetting(db, SETTING_LAST_SYNC_PREFIX + classId, String(Date.now()));
      return {
        ok: true, source: snap.source as any,
        newAnnouncements: newAnn, updatedAnnouncements: updatedAnn,
        newTasks: newTask, updatedTasks: updatedTask,
        newChains: newChain, newPolls: newPoll,
        manifest: m,
      };
    };

    let lastError = '';
    try {
      const snap = await fetchClassSnapshot(
        row.invite_code,
        { lastAnnId: row.last_announcement_id || 0, lastTaskId: row.last_task_id || 0, annIds: localAnnIds, taskIds: localTaskIds },
        'github',
      );
      if (!snap) {
        lastError = 'GitHub 拉取返回 null';
      } else {
        if (snap.manifest.sig !== signManifest(snap.manifest)) {
          return { ok: false, error: 'manifest 签名校验失败（文件损坏或被篡改）' };
        }
        return applySnapshot(snap);
      }
    } catch (e: any) {
      lastError = `GitHub 同步失败：${e?.message || e}`;
    }
    // 降级到 AnyShare（接龙/投票仅 GitHub 源，降级时自然为空）
    try {
      const snap = await fetchClassSnapshot(
        row.invite_code,
        { lastAnnId: row.last_announcement_id || 0, lastTaskId: row.last_task_id || 0, annIds: localAnnIds, taskIds: localTaskIds },
        'anyshare',
      );
      if (snap) {
        if (snap.manifest.sig !== signManifest(snap.manifest)) {
          return { ok: false, error: 'AnyShare manifest 签名校验失败' };
        }
        return applySnapshot(snap);
      }
    } catch (e: any) {
      return { ok: false, error: `${lastError}；AnyShare 兜底也失败：${e?.message || e}` };
    }
    return { ok: false, error: lastError || '两源都拉不到 manifest' };
  }
  // 给 IPC handler 用，避免重复实现
  (db as any).__classSyncCore = syncClassCore;

  // ----------------- 配置类 -----------------

  ipcMain.handle('class:config', () => {
    const token = getGitHubToken(db);
    const cloud = getClassAnyShareConfig(db);
    return {
      ok: true,
      repo: `${CLASS_REPO_OWNER}/${CLASS_REPO_NAME}`,
      branch: CLASS_BRANCH,
      repoUrl: `https://github.com/${CLASS_REPO_OWNER}/${CLASS_REPO_NAME}/tree/${CLASS_BRANCH}/class`,
      tokenSet: !!token,
      cloudSourceEnabled: !!cloud.enabled,
      cloud: cloud ? { baseUrl: cloud.baseUrl, linkId: cloud.linkId, password: cloud.password, enabled: cloud.enabled } : null,
      localAlias: getLocalAlias(db),
    };
  });

  ipcMain.handle('class:saveAuth', (_e, token: string) => {
    const t = (token || '').trim();
    if (t && !/^(gh[a-z]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$/.test(t)) {
      return { ok: false, error: '令牌格式不像 GitHub PAT（应以 ghp_ / github_pat_ 开头）' };
    }
    if (t) setSetting(db, SETTING_GH_TOKEN, t);
    return { ok: true, tokenSet: !!getGitHubToken(db) };
  });

  ipcMain.handle('class:saveCloud', (_e, cfg: { url?: string; password?: string; enabled?: boolean }) => {
    const current = getClassAnyShareConfig(db);
    let next: { baseUrl: string; linkId: string; password: string; enabled: boolean };
    if (cfg?.url && String(cfg.url).trim()) {
      const parsed = parseAnyShareUrl(String(cfg.url));
      if (!parsed) return { ok: false, error: '外链地址不像北科云盘分享链接' };
      next = { ...parsed, password: String(cfg.password ?? current.password ?? '').trim(), enabled: cfg.enabled !== false };
    } else {
      next = { ...current, password: String(cfg?.password ?? current.password ?? '').trim(), enabled: cfg?.enabled !== false };
    }
    asRootCache.delete(next.linkId);
    setSetting(db, SETTING_AS_CONFIG, JSON.stringify(next));
    return { ok: true, cloud: next };
  });

  ipcMain.handle('class:saveLocalAlias', (_e, alias: string) => {
    const a = String(alias || '').trim().slice(0, 20);
    if (!a) return { ok: false, error: '昵称不能为空' };
    setSetting(db, SETTING_LOCAL_ALIAS, a);
    return { ok: true, localAlias: a };
  });

  // ----------------- 列表 / 详情 -----------------

  ipcMain.handle('class:list', () => {
    const rows = db.prepare('SELECT * FROM classes WHERE dissolved = 0 ORDER BY joined_at DESC').all() as ClassRow[];
    return { ok: true, classes: rows.map(rowToClass) };
  });

  ipcMain.handle('class:info', (_e, classId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在', errorCode: 'NOT_FOUND' };
    return { ok: true, ...rowToClass(row) };
  });

  // ----------------- 创建 -----------------

  ipcMain.handle('class:create', async (_e, payload: { name: string; description?: string; alias?: string }) => {
    const name = String(payload?.name || '').trim().slice(0, 50);
    if (!name) return { ok: false, error: '请输入班级名称' };

    // v1.2.7：创建班级要月卡（创建是稀缺资源，同学加入仍免费）
    const now0 = Date.now();
    const premRow = db.prepare(
      'SELECT MAX(expires_at) AS u FROM monthly_subscriptions WHERE expires_at > ?'
    ).get(now0) as { u: number | null };
    if (!premRow.u) {
      return {
        ok: false,
        error: '创建班级需要月卡（同学加入仍免费）',
        errorCode: 'PREMIUM_REQUIRED',
        hint: '去「设置 → 月卡与付费」激活月卡后即可创建',
      };
    }

    const alias = String(payload?.alias || '').trim().slice(0, 20) || getLocalAlias(db);

    const classCode = generateClassCode();
    const inviteCode = deriveInviteCode(classCode);
    const ownerToken = generateOwnerToken();
    const ownerSig = signMember(alias, classCode, 'owner');
    const now = Date.now();

    // 写本地
    const info = db.prepare(
      `INSERT INTO classes
        (code, share_code, invite_code, name, description, owner_token, owner_alias, role,
         alias, member_count, cloud_synced, last_synced_at, joined_at, dissolved,
         last_announcement_id, last_task_id, members_json, member_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', ?, 1, 0, ?, ?, 0, 0, 0, ?, 1)`
    ).run(
      classCode, inviteCode, inviteCode, name, String(payload?.description || '').slice(0, 500),
      ownerToken, alias, alias, now, now,
      JSON.stringify([{ alias, role: 'owner', joinedAt: now, sig: ownerSig }] as MemberEntry[])
    );
    const classId = Number(info.lastInsertRowid);

    // 写远端 manifest（GitHub 优先，AnyShare 失败不致命）
    const manifest: ClassManifest = {
      classCode, inviteCode,
      name, description: String(payload?.description || '').slice(0, 500),
      ownerAlias: alias,
      createdAt: now,
      members: [{ alias, role: 'owner', joinedAt: now, sig: ownerSig }],
      lastAnnouncementId: 0, lastTaskId: 0,
      updatedAt: now,
      sig: '',
    };
    manifest.sig = signManifest(manifest);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(inviteCode, ['manifest.json'], JSON.stringify(manifest, null, 2), ghToken, undefined, `创建班级 ${name}`);
        const sha = await ghGetSha(inviteCode, ['manifest.json']);
        if (sha) db.prepare('UPDATE classes SET cloud_synced = 1, manifest_sha = ? WHERE id = ?').run(sha, classId);
      } catch (e: any) {
        errors.push(`GitHub 同步失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub PAT，云端仅本地缓存（其他成员无法看到）');
    }

    // AnyShare 双写（可选）
    const cloud = getClassAnyShareConfig(db);
    if (cloud.enabled) {
      try {
        await asPut(inviteCode, ['manifest.json'], JSON.stringify(manifest, null, 2));
      } catch (e: any) {
        errors.push(`AnyShare 同步失败：${e?.message || e}`);
      }
    }

    const row = fetchClassRow(classId)!;
    return {
      ok: true,
      warnings: errors,
      ...rowToClass(row),
      inviteCode,
      ownerToken,
    };
  });

  // ----------------- 加入 -----------------

  ipcMain.handle('class:join', async (_e, payload: { inviteCode: string; alias?: string }) => {
    const classCode = normalizeInviteCode(String(payload?.inviteCode || ''));
    if (!classCode) return { ok: false, error: '邀请码无效（检查是否抄错）', errorCode: 'INVALID_INVITE_CODE' };
    const inviteCode = deriveInviteCode(classCode);
    const alias = String(payload?.alias || '').trim().slice(0, 20) || getLocalAlias(db);

    // 本机去重
    const exist = db.prepare('SELECT id FROM classes WHERE code = ?').get(classCode) as { id: number } | undefined;
    if (exist) return { ok: false, error: '本机已加入此班级', errorCode: 'ALREADY_JOINED', classId: exist.id };

    // 拉远端 manifest（GitHub 优先 → AnyShare 兜底）
    let manifest: ClassManifest | null = null;
    let source: 'github' | 'anyshare' | null = null;
    try {
      manifest = await githubSource.fetchManifest(inviteCode);
      if (manifest) source = 'github';
    } catch {}
    if (!manifest) {
      try {
        manifest = await anyshareSource.fetchManifest(inviteCode);
        if (manifest) source = 'anyshare';
      } catch {}
    }
    if (!manifest) return { ok: false, error: '远端找不到该班级（GitHub + AnyShare 都未命中）', errorCode: 'NOT_FOUND' };

    // 验证每个成员签名（防云端被中间人篡改）
    for (const m of manifest.members) {
      if (!verifyMember(m.alias, manifest.classCode, m.role, m.sig)) {
        return { ok: false, error: `成员 ${m.alias} 签名校验失败，manifest 可能被篡改，拒绝加入`, errorCode: 'INVALID_INVITE_CODE' };
      }
    }

    // 验证 manifest 自身签名
    const expectedSig = signManifest(manifest);
    if (manifest.sig !== expectedSig) {
      return { ok: false, error: 'manifest 整体签名校验失败，文件可能被篡改', errorCode: 'INVALID_INVITE_CODE' };
    }

    // 写本地
    const now = Date.now();
    const info = db.prepare(
      `INSERT INTO classes
        (code, share_code, invite_code, name, description, owner_token, owner_alias, role,
         alias, member_count, cloud_synced, last_synced_at, joined_at, dissolved,
         last_announcement_id, last_task_id, members_json, member_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, 1, ?, ?, 0, 0, 0, ?, 0)`
    ).run(
      manifest.classCode, inviteCode, inviteCode,
      manifest.name, manifest.description,
      null, manifest.ownerAlias,  // 普通成员没有 owner_token
      alias, manifest.members.length, now, now,
      JSON.stringify(manifest.members)
    );
    const classId = Number(info.lastInsertRowid);

    // v1.2.9 R1：把自己写进云端 manifest.members（之前 join 从不更新云端 → 成员列表永远只有 owner）
    const warnings: string[] = [];
    const ghToken = getGitHubToken(db);
    if (ghToken) {
      try {
        const updated = await mutateManifestRemote(inviteCode, ghToken, `成员 ${alias} 加入班级`, (m) => {
          if (!m.members.some((x) => x.alias === alias)) {
            m.members.push({ alias, role: 'member', joinedAt: now, sig: signMember(alias, m.classCode, 'member') });
          }
        });
        if (updated) {
          db.prepare('UPDATE classes SET members_json = ?, member_synced = 1, member_count = ? WHERE id = ?')
            .run(JSON.stringify(updated.members), updated.members.length, classId);
        }
      } catch (e: any) {
        warnings.push(`成员列表未更新到云端：${e?.message || e}`);
      }
    } else {
      warnings.push('未配置 GitHub 令牌：你的昵称不会出现在云端成员列表（其他成员看不到你，也不影响收公告）');
    }

    return {
      ok: true, source,
      classId, className: manifest.name, role: 'member' as const,
      memberCount: manifest.members.length + (warnings.length === 0 ? 1 : 0),
      warnings,
    };
  });

  // ----------------- 离开 -----------------

  ipcMain.handle('class:leave', (_e, classId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    return { ok: true };
  });

  // v1.2.9 R3：成员角色管理（重写——v1.2.8 版查询的 class_members 表根本不存在，必炸 no such table）
  // 数据真源 = 云端 manifest.members + 本地 members_json 镜像。owner 可将 member ↔ admin。
  ipcMain.handle('class:promoteMember', async (_e, classId: number, payload: { alias: string; role: 'admin' | 'member' }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner') return { ok: false, error: '仅 owner 可调整成员角色', errorCode: 'NOT_OWNER' };
    const alias = String(payload?.alias || '').trim();
    if (!alias) return { ok: false, error: '请指定成员昵称' };
    const target = payload.role;
    if (target !== 'admin' && target !== 'member') return { ok: false, error: '仅支持设为管理员 / 撤销管理员' };

    let members: MemberEntry[] = [];
    try { members = JSON.parse(row.members_json || '[]'); } catch {}
    const m = members.find((x) => x.alias === alias);
    if (!m) return { ok: false, error: `成员 ${alias} 不在成员列表（可能未同步到云端）`, errorCode: 'NOT_FOUND' };
    if (m.role === 'owner') return { ok: false, error: '不能调整 owner 本人' };
    if (m.role === target) return { ok: true, role: target, warnings: [] };

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        // 云端原子更新：改角色 + 重算该成员 sig + manifest 重签
        const updated = await mutateManifestRemote(row.invite_code, ghToken, `${alias} ${target === 'admin' ? '设为管理员' : '撤销管理员'}`, (mm) => {
          const t = mm.members.find((x) => x.alias === alias);
          if (t) {
            t.role = target;
            t.sig = signMember(alias, mm.classCode, target);
          }
        });
        if (updated) {
          db.prepare('UPDATE classes SET members_json = ? WHERE id = ?').run(JSON.stringify(updated.members), classId);
        }
      } catch (e: any) {
        errors.push(`云端更新失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：角色变更仅本机生效，其他成员看不到');
    }
    // 本机镜像也更新（即使云端失败，本地 UI 一致）
    m.role = target;
    m.sig = signMember(alias, row.code, target);
    db.prepare('UPDATE classes SET members_json = ? WHERE id = ?').run(JSON.stringify(members), classId);
    if (alias === (row.alias || getLocalAlias(db))) {
      db.prepare('UPDATE classes SET role = ? WHERE id = ?').run(target, classId);
    }
    return { ok: errors.length === 0, warnings: errors, role: target };
  });

  // v1.2.9 R3：移除成员（owner 可移除任何人除 owner；admin 只能移除 member）
  // 被移除者下次 sync 时检测到自己在 members 列表消失 → 本地自动下线（KICKED）
  ipcMain.handle('class:removeMember', async (_e, classId: number, payload: { alias: string }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner' && row.role !== 'admin') return { ok: false, error: '仅 owner / admin 可移除成员', errorCode: 'NOT_ALLOWED' };
    const alias = String(payload?.alias || '').trim();
    if (!alias) return { ok: false, error: '请指定成员昵称' };
    if (alias === row.owner_alias) return { ok: false, error: '不能移除 owner（解散班级请用「离开班级」）' };

    let members: MemberEntry[] = [];
    try { members = JSON.parse(row.members_json || '[]'); } catch {}
    const m = members.find((x) => x.alias === alias);
    if (!m) return { ok: false, error: `成员 ${alias} 不在成员列表`, errorCode: 'NOT_FOUND' };
    if (row.role === 'admin' && m.role !== 'member') return { ok: false, error: 'admin 只能移除普通成员', errorCode: 'NOT_ALLOWED' };

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        const updated = await mutateManifestRemote(row.invite_code, ghToken, `移除成员 ${alias}`, (mm) => {
          mm.members = mm.members.filter((x) => x.alias !== alias);
        });
        if (updated) {
          db.prepare('UPDATE classes SET members_json = ?, member_count = ? WHERE id = ?')
            .run(JSON.stringify(updated.members), updated.members.length, classId);
          return { ok: errors.length === 0, warnings: errors };
        }
      } catch (e: any) {
        errors.push(`云端更新失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：移除仅本机生效，被移除者不会收到通知');
    }
    // 本地镜像兜底
    const rest = members.filter((x) => x.alias !== alias);
    db.prepare('UPDATE classes SET members_json = ?, member_count = ? WHERE id = ?').run(JSON.stringify(rest), rest.length, classId);
    return { ok: errors.length === 0, warnings: errors };
  });

  // v1.2.9 R2：删除公告（撤回）。本地删 + 云端文件删 + manifest tombstone（其他端 sync 时删本地）
  ipcMain.handle('class:deleteAnnouncement', async (_e, classId: number, annId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner' && row.role !== 'admin') return { ok: false, error: '仅 owner / admin 可删除公告', errorCode: 'NOT_ALLOWED' };
    const annIdNum = Number(annId);
    if (!annIdNum || annIdNum < 1) return { ok: false, error: '公告 id 无效' };

    // 本地删除
    const r = db.prepare('DELETE FROM class_announcements WHERE class_id = ? AND id = ?').run(classId, annIdNum);
    if ((r.changes || 0) === 0) return { ok: false, error: '公告不存在（可能已删除）' };

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        // 云端条目文件删除（Contents DELETE 需 sha）
        const sha = await ghGetSha(row.invite_code, ['announcements', annIdNum + '.json']);
        if (sha) {
          await ghDelete(row.invite_code, ['announcements', annIdNum + '.json'], ghToken, sha, `删除公告 #${annIdNum}`);
        }
        // manifest：索引移除 + tombstone 记录
        await mutateManifestRemote(row.invite_code, ghToken, `删除公告 #${annIdNum}`, (m) => {
          if (Array.isArray(m.announcementIds)) m.announcementIds = m.announcementIds.filter((x) => x !== annIdNum);
          if (!Array.isArray(m.deletedAnnouncementIds)) m.deletedAnnouncementIds = [];
          if (!m.deletedAnnouncementIds.includes(annIdNum)) m.deletedAnnouncementIds.push(annIdNum);
        });
      } catch (e: any) {
        errors.push(`云端删除失败：${e?.message || e}（本地已删除，其他成员同步后仍会看到）`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：仅本机删除，其他成员仍会看到这条公告');
    }
    return { ok: errors.length === 0, warnings: errors };
  });

  // ----------------- 公告 / 作业 列表 -----------------

  ipcMain.handle('class:listAnnouncements', (_e, classId: number) => {
    const rows = db.prepare(
      'SELECT * FROM class_announcements WHERE class_id = ? ORDER BY created_at DESC'
    ).all(classId) as Array<{
      id: number; title: string; body: string; images_json: string;
      pinned: number; is_read: number; created_at: number; author_alias: string;
    }>;
    return {
      ok: true,
      announcements: rows.map(r => ({
        id: r.id, title: r.title, body: r.body,
        images: safeParseArr(r.images_json), pinned: !!r.pinned,
        isRead: !!r.is_read, createdAt: r.created_at,
        authorAlias: r.author_alias || '',
      })),
    };
  });

  ipcMain.handle('class:listTasks', (_e, classId: number) => {
    const rows = db.prepare(
      'SELECT * FROM class_tasks WHERE class_id = ? ORDER BY created_at DESC'
    ).all(classId) as Array<{
      id: number; title: string; body: string; due_at: number | null;
      status: string; created_at: number;
    }>;
    return {
      ok: true,
      tasks: rows.map(r => ({
        id: r.id, title: r.title, body: r.body,
        dueAt: r.due_at, status: r.status, createdAt: r.created_at,
      })),
    };
  });

  // ----------------- 发布 -----------------

  ipcMain.handle('class:publishAnnouncement', async (_e, classId: number, payload: { title: string; body: string; images?: string[] }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    // v1.2.9 R3：admin 也可发布（原来仅 owner）
    if (row.role !== 'owner' && row.role !== 'admin') return { ok: false, error: '仅 owner / admin 可发布公告', errorCode: 'NOT_ALLOWED' };

    const title = String(payload?.title || '').trim().slice(0, 80);
    const body = String(payload?.body || '').slice(0, 4000);
    if (!title) return { ok: false, error: '请输入公告标题' };
    const images = Array.isArray(payload?.images) ? payload.images.filter((u) => typeof u === 'string' && u.trim()).slice(0, 9) : [];

    const alias = String(row.alias || row.owner_alias || getLocalAlias(db));
    const now = Date.now();
    const annId = now;
    const sig = signEntry(row.code, 'announcement', annId, body);

    const entry: AnnouncementEntry = {
      id: annId, authorAlias: alias, title, body, images, pinned: false,
      createdAt: now, sig,
    };

    // 写本地（v1.2.9 R1：显式时间戳 id + author_alias，与云端对齐，避免 sync 重复插入）
    upsertAnnouncement(classId, entry);

    // 写远端：先 put announcement，再 update manifest（索引 + lastAnnouncementId）
    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['announcements', annId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        await mutateManifestRemote(row.invite_code, ghToken, `发布公告 ${title}`, (m) => {
          m.lastAnnouncementId = Math.max(m.lastAnnouncementId || 0, annId);
          if (!Array.isArray(m.announcementIds)) m.announcementIds = [];
          if (!m.announcementIds.includes(annId)) m.announcementIds.push(annId);
          if (Array.isArray(m.deletedAnnouncementIds)) m.deletedAnnouncementIds = m.deletedAnnouncementIds.filter((x) => x !== annId);
        });
        db.prepare('UPDATE classes SET last_announcement_id = ? WHERE id = ?').run(annId, classId);
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
    } else {
      // v1.2.9 R1：之前没 PAT 时静默「成功」，用户以为发了但云端什么都没有
      errors.push('未配置 GitHub 令牌：公告仅保存在本机，其他成员看不到（设置 → 班级 → 配置 → GitHub 令牌）');
    }
    const cloud = getClassAnyShareConfig(db);
    if (cloud.enabled) {
      try {
        await asPut(row.invite_code, ['announcements', annId + '.json'], JSON.stringify(entry, null, 2));
      } catch (e: any) {
        errors.push(`AnyShare 发布失败：${e?.message || e}`);
      }
    }

    return { ok: errors.length === 0, warnings: errors, annId };
  });

  ipcMain.handle('class:publishTask', async (_e, classId: number, payload: { title: string; body?: string; dueAt?: number; images?: string[] }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner' && row.role !== 'admin') return { ok: false, error: '仅 owner / admin 可发布作业', errorCode: 'NOT_ALLOWED' };

    const title = String(payload?.title || '').trim().slice(0, 80);
    const body = String(payload?.body || '').slice(0, 4000);
    if (!title) return { ok: false, error: '请输入作业标题' };
    const images = Array.isArray(payload?.images) ? payload.images.filter((u) => typeof u === 'string' && u.trim()).slice(0, 9) : [];

    const alias = String(row.alias || row.owner_alias || getLocalAlias(db));
    const now = Date.now();
    const taskId = now;
    const sig = signEntry(row.code, 'task', taskId, body + (payload?.dueAt || 0));

    const entry: ClassTaskEntry = {
      id: taskId, authorAlias: alias, title, body, images,
      dueAt: payload?.dueAt || null, status: 'open',
      createdAt: now, sig,
    };

    // v1.2.9 R1：显式 id + author_alias（v1.2.9 起 UI 移除作业 tab，此 IPC 保留 API 兼容）
    upsertTask(classId, entry);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['tasks', taskId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        await mutateManifestRemote(row.invite_code, ghToken, `发布作业 ${title}`, (m) => {
          m.lastTaskId = Math.max(m.lastTaskId || 0, taskId);
          if (!Array.isArray(m.taskIds)) m.taskIds = [];
          if (!m.taskIds.includes(taskId)) m.taskIds.push(taskId);
        });
        db.prepare('UPDATE classes SET last_task_id = ? WHERE id = ?').run(taskId, classId);
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：作业仅保存在本机，其他成员看不到');
    }
    const cloud = getClassAnyShareConfig(db);
    if (cloud.enabled) {
      try {
        await asPut(row.invite_code, ['tasks', taskId + '.json'], JSON.stringify(entry, null, 2));
      } catch (e: any) {
        errors.push(`AnyShare 发布失败：${e?.message || e}`);
      }
    }

    return { ok: errors.length === 0, warnings: errors, taskId };
  });

  // ----------------- 本地操作（不同步云端） -----------------

  ipcMain.handle('class:markAnnouncementRead', (_e, classId: number, annId: number) => {
    db.prepare('UPDATE class_announcements SET is_read = 1 WHERE class_id = ? AND id = ?').run(classId, annId);
    return { ok: true };
  });

  ipcMain.handle('class:completeTask', (_e, classId: number, taskId: number, status: 'open' | 'done' | 'cancelled') => {
    db.prepare('UPDATE class_tasks SET status = ? WHERE class_id = ? AND id = ?').run(status, classId, taskId);
    return { ok: true };
  });

  // ----------------- v1.2.9 R4：接龙 -----------------

  ipcMain.handle('class:listChains', (_e, classId: number) => {
    const rows = db.prepare('SELECT * FROM class_chains WHERE class_id = ? ORDER BY created_at DESC').all(classId) as Array<{
      id: number; author_alias: string; title: string; body: string;
      items_json: string; closed: number; created_at: number; updated_at: number | null;
    }>;
    return {
      ok: true,
      chains: rows.map(r => ({
        id: r.id, authorAlias: r.author_alias, title: r.title, body: r.body,
        items: safeParseArr(r.items_json), closed: !!r.closed,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    };
  });

  ipcMain.handle('class:createChain', async (_e, classId: number, payload: { title: string; body?: string }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const title = String(payload?.title || '').trim().slice(0, 80);
    const body = String(payload?.body || '').slice(0, 2000);
    if (!title) return { ok: false, error: '请输入接龙标题' };

    const alias = String(row.alias || getLocalAlias(db));
    const now = Date.now();
    const chainId = now;
    const sig = signEntry(row.code, 'chain', chainId, title + '|' + body);
    const entry: ChainEntry = {
      id: chainId, authorAlias: alias, title, body,
      items: [], closed: false, createdAt: now, updatedAt: now, sig,
    };
    upsertChain(classId, entry);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['chains', chainId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        await mutateManifestRemote(row.invite_code, ghToken, `发起接龙 ${title}`, (m) => {
          if (!Array.isArray(m.chainIds)) m.chainIds = [];
          if (!m.chainIds.includes(chainId)) m.chainIds.push(chainId);
        });
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：接龙仅保存在本机，其他成员看不到');
    }
    return { ok: errors.length === 0, warnings: errors, chainId };
  });

  ipcMain.handle('class:joinChain', async (_e, classId: number, chainId: number, content: string) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const c = String(content || '').trim().slice(0, 200);
    if (!c) return { ok: false, error: '请输入接龙内容' };

    const local = db.prepare('SELECT * FROM class_chains WHERE class_id = ? AND id = ?')
      .get(classId, chainId) as { items_json: string; closed: number } | undefined;
    if (!local) return { ok: false, error: '接龙不存在（先点同步）', errorCode: 'NOT_FOUND' };
    if (local.closed) return { ok: false, error: '接龙已结束' };

    const alias = String(row.alias || getLocalAlias(db));
    const item: ChainItem = { alias, content: c, ts: Date.now() };
    const items = mergeChainItems(safeParseArr(local.items_json) as unknown as ChainItem[], [item]);
    db.prepare('UPDATE class_chains SET items_json = ?, updated_at = ? WHERE class_id = ? AND id = ?')
      .run(JSON.stringify(items), item.ts, classId, chainId);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await fetchChain(row.invite_code, chainId);
          if (!remote) throw new Error('云端接龙条目不存在');
          if (remote.closed) return { ok: false, error: '接龙已被发起人结束' };
          remote.items = mergeChainItems(remote.items || [], [item]);
          remote.updatedAt = Date.now();
          const sha = await ghGetSha(row.invite_code, ['chains', chainId + '.json']);
          try {
            await ghPut(row.invite_code, ['chains', chainId + '.json'], JSON.stringify(remote, null, 2), ghToken, sha || undefined, `${alias} 参与接龙`);
            break;
          } catch (e: any) {
            if (attempt < 2 && /409/i.test(String(e?.message || e))) continue;  // 他人同时接龙 → 重拉合并重试
            throw e;
          }
        }
      } catch (e: any) {
        errors.push(`云端参与失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：参与记录仅保存在本机');
    }
    return { ok: errors.length === 0, warnings: errors };
  });

  ipcMain.handle('class:closeChain', async (_e, classId: number, chainId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const local = db.prepare('SELECT * FROM class_chains WHERE class_id = ? AND id = ?')
      .get(classId, chainId) as { author_alias: string } | undefined;
    if (!local) return { ok: false, error: '接龙不存在' };
    const alias = String(row.alias || getLocalAlias(db));
    if (row.role !== 'owner' && row.role !== 'admin' && local.author_alias !== alias) {
      return { ok: false, error: '仅发起人或管理员可结束接龙', errorCode: 'NOT_ALLOWED' };
    }
    db.prepare('UPDATE class_chains SET closed = 1, updated_at = ? WHERE class_id = ? AND id = ?').run(Date.now(), classId, chainId);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        const remote = await fetchChain(row.invite_code, chainId);
        if (remote) {
          remote.closed = true;
          remote.updatedAt = Date.now();
          const sha = await ghGetSha(row.invite_code, ['chains', chainId + '.json']);
          await ghPut(row.invite_code, ['chains', chainId + '.json'], JSON.stringify(remote, null, 2), ghToken, sha || undefined, `结束接龙 #${chainId}`);
        }
      } catch (e: any) {
        errors.push(`云端结束失败：${e?.message || e}`);
      }
    }
    return { ok: errors.length === 0, warnings: errors };
  });

  // ----------------- v1.2.9 R5：投票 -----------------

  ipcMain.handle('class:listPolls', (_e, classId: number) => {
    const rows = db.prepare('SELECT * FROM class_polls WHERE class_id = ? ORDER BY created_at DESC').all(classId) as Array<{
      id: number; author_alias: string; question: string; description: string;
      options_json: string; votes_json: string; multi: number; closed: number;
      deadline_at: number | null; created_at: number; updated_at: number | null;
    }>;
    return {
      ok: true,
      polls: rows.map(r => ({
        id: r.id, authorAlias: r.author_alias, question: r.question, description: r.description,
        options: safeParseArr(r.options_json), votes: safeParseObj(r.votes_json),
        multi: !!r.multi, closed: !!r.closed, deadlineAt: r.deadline_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    };
  });

  ipcMain.handle('class:createPoll', async (_e, classId: number, payload: { question: string; description?: string; options: string[]; multi?: boolean; deadlineAt?: number }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const question = String(payload?.question || '').trim().slice(0, 120);
    const description = String(payload?.description || '').slice(0, 2000);
    const options = (Array.isArray(payload?.options) ? payload.options : [])
      .map((o) => String(o || '').trim().slice(0, 60))
      .filter(Boolean);
    if (!question) return { ok: false, error: '请输入投票问题' };
    if (options.length < 2) return { ok: false, error: '至少需要 2 个选项' };
    if (options.length > 8) return { ok: false, error: '选项最多 8 个' };

    const alias = String(row.alias || getLocalAlias(db));
    const now = Date.now();
    const pollId = now;
    const sig = signEntry(row.code, 'poll', pollId, question + '|' + description + '|' + options.join('||'));
    const entry: PollEntry = {
      id: pollId, authorAlias: alias, question, description,
      options: options.map((text) => ({ text })),
      votes: {}, multi: !!payload?.multi, closed: false,
      deadlineAt: payload?.deadlineAt || null,
      createdAt: now, updatedAt: now, sig,
    };
    upsertPoll(classId, entry);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['polls', pollId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        await mutateManifestRemote(row.invite_code, ghToken, `发起投票 ${question}`, (m) => {
          if (!Array.isArray(m.pollIds)) m.pollIds = [];
          if (!m.pollIds.includes(pollId)) m.pollIds.push(pollId);
        });
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：投票仅保存在本机，其他成员看不到');
    }
    return { ok: errors.length === 0, warnings: errors, pollId };
  });

  ipcMain.handle('class:votePoll', async (_e, classId: number, pollId: number, choices: number[]) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const local = db.prepare('SELECT * FROM class_polls WHERE class_id = ? AND id = ?')
      .get(classId, pollId) as { options_json: string; votes_json: string; multi: number; closed: number; deadline_at: number | null } | undefined;
    if (!local) return { ok: false, error: '投票不存在（先点同步）', errorCode: 'NOT_FOUND' };
    if (local.closed) return { ok: false, error: '投票已结束' };
    if (local.deadline_at && Date.now() > local.deadline_at) return { ok: false, error: '投票已过截止时间' };

    const opts = safeParseArr(local.options_json);
    const picked = [...new Set((Array.isArray(choices) ? choices : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < opts.length))];
    if (picked.length === 0) return { ok: false, error: '请选择选项' };
    if (!local.multi && picked.length > 1) return { ok: false, error: '这是单选投票，只能选 1 项' };

    const alias = String(row.alias || getLocalAlias(db));
    const vote: PollVote = { choices: picked, ts: Date.now() };
    const votes = { ...safeParseObj(local.votes_json), [alias]: vote };
    db.prepare('UPDATE class_polls SET votes_json = ?, updated_at = ? WHERE class_id = ? AND id = ?')
      .run(JSON.stringify(votes), vote.ts, classId, pollId);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await fetchPoll(row.invite_code, pollId);
          if (!remote) throw new Error('云端投票条目不存在');
          if (remote.closed) return { ok: false, error: '投票已被结束' };
          remote.votes = { ...(remote.votes || {}), [alias]: vote };
          remote.updatedAt = Date.now();
          const sha = await ghGetSha(row.invite_code, ['polls', pollId + '.json']);
          try {
            await ghPut(row.invite_code, ['polls', pollId + '.json'], JSON.stringify(remote, null, 2), ghToken, sha || undefined, `${alias} 投票`);
            break;
          } catch (e: any) {
            if (attempt < 2 && /409/i.test(String(e?.message || e))) continue;  // 他人同时投票 → 重拉覆盖重试（同 alias 幂等）
            throw e;
          }
        }
      } catch (e: any) {
        errors.push(`云端投票失败：${e?.message || e}`);
      }
    } else {
      errors.push('未配置 GitHub 令牌：投票仅保存在本机');
    }
    return { ok: errors.length === 0, warnings: errors };
  });

  ipcMain.handle('class:closePoll', async (_e, classId: number, pollId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    const local = db.prepare('SELECT * FROM class_polls WHERE class_id = ? AND id = ?')
      .get(classId, pollId) as { author_alias: string } | undefined;
    if (!local) return { ok: false, error: '投票不存在' };
    const alias = String(row.alias || getLocalAlias(db));
    if (row.role !== 'owner' && row.role !== 'admin' && local.author_alias !== alias) {
      return { ok: false, error: '仅发起人或管理员可结束投票', errorCode: 'NOT_ALLOWED' };
    }
    db.prepare('UPDATE class_polls SET closed = 1, updated_at = ? WHERE class_id = ? AND id = ?').run(Date.now(), classId, pollId);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        const remote = await fetchPoll(row.invite_code, pollId);
        if (remote) {
          remote.closed = true;
          remote.updatedAt = Date.now();
          const sha = await ghGetSha(row.invite_code, ['polls', pollId + '.json']);
          await ghPut(row.invite_code, ['polls', pollId + '.json'], JSON.stringify(remote, null, 2), ghToken, sha || undefined, `结束投票 #${pollId}`);
        }
      } catch (e: any) {
        errors.push(`云端结束失败：${e?.message || e}`);
      }
    }
    return { ok: errors.length === 0, warnings: errors };
  });

  // ----------------- 同步（拉取最新） -----------------

  ipcMain.handle('class:sync', async (_e, classId: number) => syncClassCore(classId));
}

function safeParseArr(s: string | null | undefined): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function safeParseObj(s: string | null | undefined): Record<string, any> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** v1.2.9 R4：接龙条目多端 union 合并（按 alias|ts 去重，按 ts 升序稳定输出） */
function mergeChainItems(a: ChainItem[], b: ChainItem[]): ChainItem[] {
  const map = new Map<string, ChainItem>();
  for (const it of [...(a || []), ...(b || [])]) {
    if (!it || typeof it.alias !== 'string') continue;
    map.set(`${it.alias}|${it.ts}`, it);
  }
  return [...map.values()].sort((x, y) => x.ts - y.ts);
}

/** v1.2.9 R5：投票多端 union 合并（同 alias 取 ts 大者） */
function mergePollVotes(a: Record<string, PollVote>, b: Record<string, PollVote>): Record<string, PollVote> {
  const out: Record<string, PollVote> = { ...(a || {}) };
  for (const [alias, v] of Object.entries(b || {})) {
    const cur = out[alias];
    if (!cur || (v && v.ts >= cur.ts)) out[alias] = v;
  }
  return out;
}