/**
 * v1.2.3 小组共享清单：小组共用一份待办（分工 / 认领 / 状态同步）。
 *
 * 存储布局：GitHub grouplists/<groupCode>.json（复用作业同步的仓库与令牌）。
 * 策略：远端为真源；「发布」整包覆盖远端，「拉取」整包覆盖本地。
 * 条目用 remote_key（UUID）对齐，本地修改后需发布，拉取会覆盖未发布的本地改动。
 */
import { ipcMain } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DB } from './db/index';
import { ghFetch, HOMEWORK_REPO_OWNER, HOMEWORK_REPO_NAME, HOMEWORK_BRANCH, CODE_ALPHABET } from './homework/index';

const GROUPS_DIR = 'grouplists';
const SETTING_TOKEN = 'homework_github_token';
const SETTING_PUBLISHER = 'homework_publisher';
const GROUP_CODE_LEN = 8;

function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function randomGroupCode(): string {
  const bytes = randomBytes(GROUP_CODE_LEN);
  let out = '';
  for (let i = 0; i < GROUP_CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `GL-${out}`;
}

interface RemoteItem {
  key: string;
  title: string;
  assignee?: string | null;
  status: string;
  dueDate?: number | null;
  updatedBy?: string | null;
  updatedAt: number;
}

interface RemoteGroupFile {
  format: 'taskmanager-group-list';
  version: number;
  code: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  items: RemoteItem[];
}

function decodeBase64Utf8(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

/** GET 远端清单文件：404 → null */
async function fetchGroup(code: string, token: string): Promise<RemoteGroupFile | null> {
  const path = `${GROUPS_DIR}/${code}.json`;
  const r = await ghFetch(`/contents/${path}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub 返回 ${r.status}`);
  const meta = JSON.parse(r.text);
  const file = JSON.parse(decodeBase64Utf8(meta.content || '')) as RemoteGroupFile;
  if (!file || file.format !== 'taskmanager-group-list' || !Array.isArray(file.items)) {
    throw new Error('远端清单格式不正确');
  }
  return file;
}

/** PUT 远端清单文件（自动处理 sha：已存在则带上） */
async function putGroup(code: string, content: RemoteGroupFile, token: string): Promise<void> {
  const path = `${GROUPS_DIR}/${code}.json`;
  const body: Record<string, any> = {
    message: `group-list: ${content.name} update ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(content, null, 2), 'utf8').toString('base64'),
    branch: HOMEWORK_BRANCH,
  };
  // 先查 sha（已存在需要带，否则 409）
  const head = await ghFetch(`/contents/${path}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token });
  if (head.status === 200) {
    const meta = JSON.parse(head.text);
    if (meta.sha) body.sha = meta.sha;
  } else if (head.status !== 404) {
    throw new Error(`GitHub 返回 ${head.status}`);
  }
  const put = await ghFetch(`/contents/${path}`, { method: 'PUT', token, body });
  if (!put.ok) {
    const detail = (() => { try { return JSON.parse(put.text)?.message || ''; } catch { return ''; } })();
    throw new Error(`写入失败（HTTP ${put.status}${detail ? '：' + detail : ''}）`);
  }
}

/** 本地 group_list_items 全量镜像远端 items（保留 remote_key 对齐） */
function mirrorItems(db: DB, listId: number, items: RemoteItem[]) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM group_list_items WHERE list_id = ?').run(listId);
    const ins = db.prepare(
      `INSERT INTO group_list_items (list_id, remote_key, title, assignee, status, due_date, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    items.forEach((it, idx) => {
      ins.run(listId, it.key, it.title, it.assignee ?? null, it.status ?? 'todo', it.dueDate ?? null, idx, it.updatedAt || Date.now());
    });
  });
  tx();
}

export function registerGroupSync(db: DB) {
  const requireToken = (): string | null => getSetting(db, SETTING_TOKEN);

  // 创建小组（成为首个成员）：生成组码 → 建远端文件 → 本地登记
  ipcMain.handle('groups:create', async (_e, name: string) => {
    const token = requireToken();
    if (!token) return { ok: false, error: '请先在「设置 → 作业同步」填写 GitHub 令牌（小组清单共用该令牌）' };
    const trimmed = (name || '').trim();
    if (!trimmed) return { ok: false, error: '请填写小组名称' };
    const code = randomGroupCode();
    const file: RemoteGroupFile = {
      format: 'taskmanager-group-list', version: 1,
      code, name: trimmed, createdAt: Date.now(), updatedAt: Date.now(), items: [],
    };
    try {
      await putGroup(code, file, token);
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    const info = db.prepare(
      `INSERT INTO group_lists (group_code, name, owner_name, last_synced_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(code, trimmed, getSetting(db, SETTING_PUBLISHER) || '我', Date.now(), Date.now());
    return { ok: true, id: Number(info.lastInsertRowid), code, name: trimmed };
  });

  // 加入小组：拉远端 → 本地登记 + 条目镜像
  ipcMain.handle('groups:join', async (_e, rawCode: string) => {
    const token = requireToken();
    if (!token) return { ok: false, error: '请先在「设置 → 作业同步」填写 GitHub 令牌（小组清单共用该令牌）' };
    const code = (rawCode || '').trim().toUpperCase().replace(/^GL-/, '');
    if (code.length !== GROUP_CODE_LEN) return { ok: false, error: `组码格式不对（GL- + ${GROUP_CODE_LEN} 位）` };
    let file: RemoteGroupFile;
    try {
      file = (await fetchGroup(code, token))!;
      if (!file) return { ok: false, error: '小组不存在（核对组码）' };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    const exists = db.prepare('SELECT id FROM group_lists WHERE group_code = ?').get(`GL-${code}`) as any;
    if (exists) return { ok: false, error: '已经加入这个小组了' };
    const info = db.prepare(
      `INSERT INTO group_lists (group_code, name, owner_name, last_synced_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(`GL-${code}`, file.name, getSetting(db, SETTING_PUBLISHER) || '我', Date.now(), Date.now());
    mirrorItems(db, Number(info.lastInsertRowid), file.items);
    return { ok: true, id: Number(info.lastInsertRowid), code: `GL-${code}`, name: file.name, items: file.items.length };
  });

  // 拉取：远端整包覆盖本地条目
  ipcMain.handle('groups:pull', async (_e, listId: number) => {
    const token = requireToken();
    if (!token) return { ok: false, error: '未配置 GitHub 令牌' };
    const list = db.prepare('SELECT * FROM group_lists WHERE id = ?').get(listId) as any;
    if (!list) return { ok: false, error: '小组不存在' };
    let file: RemoteGroupFile;
    try {
      file = (await fetchGroup(list.group_code.replace(/^GL-/, ''), token))!;
      if (!file) return { ok: false, error: '远端清单已被删除' };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    mirrorItems(db, listId, file.items);
    db.prepare('UPDATE group_lists SET name = ?, last_synced_at = ? WHERE id = ?').run(file.name, Date.now(), listId);
    return { ok: true, items: file.items.length, updatedAt: file.updatedAt };
  });

  // 发布：本地条目整包推远端
  ipcMain.handle('groups:publish', async (_e, listId: number) => {
    const token = requireToken();
    if (!token) return { ok: false, error: '未配置 GitHub 令牌' };
    const list = db.prepare('SELECT * FROM group_lists WHERE id = ?').get(listId) as any;
    if (!list) return { ok: false, error: '小组不存在' };
    const rows = db.prepare('SELECT * FROM group_list_items WHERE list_id = ? ORDER BY sort_order ASC, id ASC').all(listId) as any[];
    const updatedBy = getSetting(db, SETTING_PUBLISHER) || '成员';
    const now = Date.now();
    const items: RemoteItem[] = rows.map((r) => ({
      key: r.remote_key || randomUUID(),
      title: r.title,
      assignee: r.assignee,
      status: r.status || 'todo',
      dueDate: r.due_date ?? null,
      updatedBy,
      updatedAt: r.updated_at || now,
    }));
    // 本地行缺 remote_key 的补上（下次发布对齐）
    {
      const upd = db.prepare('UPDATE group_list_items SET remote_key = ? WHERE id = ?');
      rows.forEach((r, i) => { if (!r.remote_key) upd.run(items[i].key, r.id); });
    }
    let file: RemoteGroupFile;
    try {
      file = (await fetchGroup(list.group_code.replace(/^GL-/, ''), token)) || {
        format: 'taskmanager-group-list', version: 1,
        code: list.group_code, name: list.name, createdAt: now, updatedAt: now, items: [],
      };
    } catch {
      file = {
        format: 'taskmanager-group-list', version: 1,
        code: list.group_code, name: list.name, createdAt: now, updatedAt: now, items: [],
      };
    }
    file.name = list.name;
    file.items = items;
    file.updatedAt = now;
    try {
      await putGroup(list.group_code.replace(/^GL-/, ''), file, token);
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
    db.prepare('UPDATE group_lists SET last_synced_at = ? WHERE id = ?').run(now, listId);
    return { ok: true, items: items.length };
  });

  // 退出小组：只删本地（远端由组长在 GitHub 网页删除）
  ipcMain.handle('groups:leave', (_e, listId: number) => {
    db.prepare('DELETE FROM group_list_items WHERE list_id = ?').run(listId);
    db.prepare('DELETE FROM group_lists WHERE id = ?').run(listId);
    return { ok: true };
  });
}
