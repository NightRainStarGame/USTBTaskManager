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
import { ipcMain } from 'electron';
import type { DB } from '../db/index';
import {
  generateClassCode, generateOwnerToken, deriveInviteCode,
  signMember, verifyMember, signEntry, verifyEntry, normalizeInviteCode,
} from './crypto';
import {
  ghFetch, ghPut, ghGetSha,
  asPut,
  fetchClassSnapshot,
  githubSource, anyshareSource,
  signManifest,
  CLASS_REPO_OWNER, CLASS_REPO_NAME, CLASS_BRANCH,
  DEFAULT_CLASS_ANYSHARE,
  type ClassManifest, type MemberEntry, type AnnouncementEntry, type ClassTaskEntry,
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
         last_announcement_id, last_task_id, members_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', ?, 1, 0, ?, ?, 0, 0, 0, ?)`
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
         last_announcement_id, last_task_id, members_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'member', ?, ?, 1, ?, ?, 0, 0, 0, ?)`
    ).run(
      manifest.classCode, inviteCode, inviteCode,
      manifest.name, manifest.description,
      null, manifest.ownerAlias,  // 普通成员没有 owner_token
      alias, manifest.members.length, now, now,
      JSON.stringify(manifest.members)
    );
    const classId = Number(info.lastInsertRowid);

    return {
      ok: true, source,
      classId, className: manifest.name, role: 'member' as const,
      memberCount: manifest.members.length,
    };
  });

  // ----------------- 离开 -----------------

  ipcMain.handle('class:leave', (_e, classId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    return { ok: true };
  });

  // ----------------- 公告 / 作业 列表 -----------------

  ipcMain.handle('class:listAnnouncements', (_e, classId: number) => {
    const rows = db.prepare(
      'SELECT * FROM class_announcements WHERE class_id = ? ORDER BY created_at DESC'
    ).all(classId) as Array<{
      id: number; title: string; body: string; images_json: string;
      pinned: number; is_read: number; created_at: number; author_alias?: string;
    }>;
    return {
      ok: true,
      announcements: rows.map(r => ({
        id: r.id, title: r.title, body: r.body,
        images: safeParseArr(r.images_json), pinned: !!r.pinned,
        isRead: !!r.is_read, createdAt: r.created_at,
        authorAlias: (r as any).author_alias || '',
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

  ipcMain.handle('class:publishAnnouncement', async (_e, classId: number, payload: { title: string; body: string }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner') return { ok: false, error: '仅 owner 可发布公告', errorCode: 'NOT_OWNER' };

    const title = String(payload?.title || '').trim().slice(0, 80);
    const body = String(payload?.body || '').slice(0, 4000);
    if (!title) return { ok: false, error: '请输入公告标题' };

    const alias = String(row.owner_alias || getLocalAlias(db));
    const now = Date.now();
    const annId = now;
    const sig = signEntry(row.code, 'announcement', annId, body);

    const entry: AnnouncementEntry = {
      id: annId, authorAlias: alias, title, body, images: [], pinned: false,
      createdAt: now, sig,
    };

    // 写本地
    db.prepare(
      `INSERT INTO class_announcements (class_id, title, body, images_json, pinned, is_read, created_at)
       VALUES (?, ?, ?, '[]', 0, 1, ?)`
    ).run(classId, title, body, now);

    // 写远端：先 put announcement，再 update manifest（含新 lastAnnouncementId）
    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['announcements', annId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        // 拿现有 manifest，更新 lastAnnouncementId
        const cur = await githubSource.fetchManifest(row.invite_code);
        if (cur) {
          cur.lastAnnouncementId = annId;
          cur.updatedAt = now;
          cur.sig = signManifest(cur);
          const sha = await ghGetSha(row.invite_code, ['manifest.json']);
          await ghPut(row.invite_code, ['manifest.json'], JSON.stringify(cur, null, 2), ghToken, sha || undefined, `发布公告 ${title}`);
          const newSha = await ghGetSha(row.invite_code, ['manifest.json']);
          db.prepare('UPDATE classes SET last_announcement_id = ?, manifest_sha = ? WHERE id = ?').run(annId, newSha, classId);
        }
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
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

  ipcMain.handle('class:publishTask', async (_e, classId: number, payload: { title: string; body?: string; dueAt?: number }) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };
    if (row.role !== 'owner') return { ok: false, error: '仅 owner 可发布作业', errorCode: 'NOT_OWNER' };

    const title = String(payload?.title || '').trim().slice(0, 80);
    const body = String(payload?.body || '').slice(0, 4000);
    if (!title) return { ok: false, error: '请输入作业标题' };

    const alias = String(row.owner_alias || getLocalAlias(db));
    const now = Date.now();
    const taskId = now;
    const sig = signEntry(row.code, 'task', taskId, body + (payload?.dueAt || 0));

    const entry: ClassTaskEntry = {
      id: taskId, authorAlias: alias, title, body,
      dueAt: payload?.dueAt || null, status: 'open',
      createdAt: now, sig,
    };

    db.prepare(
      `INSERT INTO class_tasks (class_id, title, body, images_json, due_at, status, created_at)
       VALUES (?, ?, ?, '[]', ?, 'open', ?)`
    ).run(classId, title, body, entry.dueAt, now);

    const ghToken = getGitHubToken(db);
    const errors: string[] = [];
    if (ghToken) {
      try {
        await ghPut(row.invite_code, ['tasks', taskId + '.json'], JSON.stringify(entry, null, 2), ghToken);
        const cur = await githubSource.fetchManifest(row.invite_code);
        if (cur) {
          cur.lastTaskId = taskId;
          cur.updatedAt = now;
          cur.sig = signManifest(cur);
          const sha = await ghGetSha(row.invite_code, ['manifest.json']);
          await ghPut(row.invite_code, ['manifest.json'], JSON.stringify(cur, null, 2), ghToken, sha || undefined, `发布作业 ${title}`);
          const newSha = await ghGetSha(row.invite_code, ['manifest.json']);
          db.prepare('UPDATE classes SET last_task_id = ?, manifest_sha = ? WHERE id = ?').run(taskId, newSha, classId);
        }
      } catch (e: any) {
        errors.push(`GitHub 发布失败：${e?.message || e}`);
      }
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

  // ----------------- 同步（拉取最新） -----------------

  ipcMain.handle('class:sync', async (_e, classId: number) => {
    const row = fetchClassRow(classId);
    if (!row) return { ok: false, error: '班级不存在' };

    let lastError = '';
    try {
      const snap = await fetchClassSnapshot(
        row.invite_code,
        { lastAnnId: row.last_announcement_id || 0, lastTaskId: row.last_task_id || 0 },
        'github',
      );
      if (!snap) {
        lastError = 'GitHub 拉取返回 null';
      } else {
        // 校验 manifest
        if (snap.manifest.sig !== signManifest(snap.manifest)) {
          return { ok: false, error: 'manifest 签名校验失败（文件损坏或被篡改）' };
        }
        // 写新公告
        let newAnn = 0;
        for (const e of snap.announcements) {
          if (!verifyEntry(row.code, 'announcement', e.id, e.body, e.sig)) continue;  // 跳过坏的
          const exist = db.prepare('SELECT id FROM class_announcements WHERE class_id = ? AND id = ?').get(classId, e.id);
          if (!exist) {
            db.prepare(
              `INSERT INTO class_announcements (class_id, title, body, images_json, pinned, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)`
            ).run(classId, e.title, e.body, JSON.stringify(e.images), e.pinned ? 1 : 0, e.createdAt);
            newAnn++;
          }
        }
        // 写新作业
        let newTask = 0;
        for (const e of snap.tasks) {
          if (!verifyEntry(row.code, 'task', e.id, e.body + (e.dueAt || 0), e.sig)) continue;
          const exist = db.prepare('SELECT id FROM class_tasks WHERE class_id = ? AND id = ?').get(classId, e.id);
          if (!exist) {
            db.prepare(
              `INSERT INTO class_tasks (class_id, title, body, images_json, due_at, status, created_at)
               VALUES (?, ?, ?, '[]', ?, 'open', ?)`
            ).run(classId, e.title, e.body, e.dueAt, e.createdAt);
            newTask++;
          }
        }
        // 更新成员列表 + last IDs
        updateMembersCache(classId, snap.manifest.members);
        updateLastIds(classId, snap.manifest.lastAnnouncementId, snap.manifest.lastTaskId);
        setSetting(db, SETTING_LAST_SYNC_PREFIX + classId, String(Date.now()));
        return { ok: true, source: snap.source, newAnnouncements: newAnn, newTasks: newTask, manifest: snap.manifest };
      }
    } catch (e: any) {
      lastError = `GitHub 同步失败：${e?.message || e}`;
    }
    // 降级到 AnyShare
    try {
      const snap = await fetchClassSnapshot(
        row.invite_code,
        { lastAnnId: row.last_announcement_id || 0, lastTaskId: row.last_task_id || 0 },
        'anyshare',
      );
      if (snap) {
        if (snap.manifest.sig !== signManifest(snap.manifest)) {
          return { ok: false, error: 'AnyShare manifest 签名校验失败' };
        }
        let newAnn = 0, newTask = 0;
        for (const e of snap.announcements) {
          if (!verifyEntry(row.code, 'announcement', e.id, e.body, e.sig)) continue;
          const exist = db.prepare('SELECT id FROM class_announcements WHERE class_id = ? AND id = ?').get(classId, e.id);
          if (!exist) {
            db.prepare(
              `INSERT INTO class_announcements (class_id, title, body, images_json, pinned, is_read, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?)`
            ).run(classId, e.title, e.body, JSON.stringify(e.images), e.pinned ? 1 : 0, e.createdAt);
            newAnn++;
          }
        }
        for (const e of snap.tasks) {
          if (!verifyEntry(row.code, 'task', e.id, e.body + (e.dueAt || 0), e.sig)) continue;
          const exist = db.prepare('SELECT id FROM class_tasks WHERE class_id = ? AND id = ?').get(classId, e.id);
          if (!exist) {
            db.prepare(
              `INSERT INTO class_tasks (class_id, title, body, images_json, due_at, status, created_at)
               VALUES (?, ?, ?, '[]', ?, 'open', ?)`
            ).run(classId, e.title, e.body, e.dueAt, e.createdAt);
            newTask++;
          }
        }
        updateMembersCache(classId, snap.manifest.members);
        updateLastIds(classId, snap.manifest.lastAnnouncementId, snap.manifest.lastTaskId);
        setSetting(db, SETTING_LAST_SYNC_PREFIX + classId, String(Date.now()));
        return { ok: true, source: 'anyshare', newAnnouncements: newAnn, newTasks: newTask, manifest: snap.manifest };
      }
    } catch (e: any) {
      return { ok: false, error: `${lastError}；AnyShare 兜底也失败：${e?.message || e}` };
    }
    return { ok: false, error: lastError || '两源都拉不到 manifest' };
  });
}

function safeParseArr(s: string | null | undefined): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}