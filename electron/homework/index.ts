/**
 * 作业发布 / 同步模块（主进程）
 *
 * 用 GitHub 仓库的一个专用文件夹（homework/）当「作业公告板」：
 *
 *   发布（需密码 + GitHub 令牌）
 *     课程页 → 发布作业 → 验证密码 → 选课程 → 选上课日期 → 书写作业
 *     → GitHub Contents API 写入 homework/<课程slug>.json
 *
 *   同步（免密码、匿名可读）
 *     课程页 → 同步作业 → 拉取 homework/ 目录下所有 JSON
 *     → 按课程名匹配（缺失则自动建课）→ 按 remote_id 去重写入作业列表
 *
 * 数据格式（homework/<slug>.json）：
 *   { "courseName": "高等数学A(1)",
 *     "updatedAt": 1760000000000,
 *     "entries": [ { id, courseName, sessionDate, sessionTime, title, content,
 *                   type, dueDate, publisher, publishedAt, updatedAt } ] }
 *
 * 安全说明：
 *   - 密码只是 UI 门槛；真正的写权限由 GitHub 令牌控制（只存在发布者本机 settings 表）。
 *   - 令牌建议用「fine-grained PAT，仅本仓库，仅 Contents 读写」。
 */
import { net, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/index';

// ==================== 配置 ====================
export const HOMEWORK_REPO_OWNER = 'NightRainStarGame';
export const HOMEWORK_REPO_NAME = 'USTBTaskManager';
export const HOMEWORK_BRANCH = 'main';
export const HOMEWORK_DIR = 'homework';

/** 发布作业的固定密码（用户指定的班级共享口令） */
export const HOMEWORK_PUBLISH_PASSWORD = 'kechuang26';

const API = `https://api.github.com/repos/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}`;
const REPO_URL = `https://github.com/${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}/tree/${HOMEWORK_BRANCH}/${HOMEWORK_DIR}`;

const SETTING_TOKEN = 'homework_github_token';
const SETTING_PUBLISHER = 'homework_publisher';
const SETTING_LAST_SYNC = 'homework_last_sync';

const FETCH_TIMEOUT_MS = 20000;

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
  courseName: string;
  updatedAt: number;
  entries: HomeworkEntry[];
}

export interface PublishPayload {
  password: string;
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
  files: number;
  entries: number;
  created: number;
  updated: number;
  coursesTouched: number;
  coursesCreated: string[];
  items: Array<{ courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
  syncedAt: number;
}

// ==================== settings 读写 ====================
function getSetting(db: DB, key: string): string {
  return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? '';
}
function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

// ==================== 工具 ====================
/** 课程名 → 文件名 slug（保留中文，去掉文件系统/Git 不友好的字符） */
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
  if (status === 401) return 'GitHub 令牌无效或已过期，请重新填写（Settings → 发布令牌）';
  if (status === 403) return /rate limit/i.test(detail) ? 'GitHub API 速率限制（匿名每小时 60 次），稍后再试或在发布设置里填令牌' : `没有权限（${detail || status}）。令牌需要对 ${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME} 的 Contents 读写权限`;
  if (status === 404) return '仓库或文件不存在（检查仓库是否公开、文件夹路径是否正确）';
  if (status === 409) return '文件已被其他人更新（写入冲突），请重试一次';
  return `GitHub 返回 ${status}${detail ? '：' + detail : ''}`;
}

// ==================== 发布 ====================
/**
 * 发布一条作业到 GitHub homework/<slug>.json。
 * 幂等：同一课程同一上课日期 + 同标题 → 覆盖更新远端已有条目（保留其 id，同步端无感）。
 */
export async function publishHomework(db: DB, payload: PublishPayload): Promise<{ ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string }> {
  // 1) 密码验证（主进程侧，UI 门槛）
  if (payload.password !== HOMEWORK_PUBLISH_PASSWORD) {
    return { ok: false, error: '密码不正确' };
  }
  const courseName = (payload.courseName || '').trim();
  const title = (payload.title || '').trim();
  const sessionDate = (payload.sessionDate || '').trim();
  if (!courseName) return { ok: false, error: '请选择课程' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { ok: false, error: '请选择上课日期' };
  if (!title) return { ok: false, error: '请填写作业标题' };

  const token = getSetting(db, SETTING_TOKEN).trim();
  if (!token) return { ok: false, error: '尚未配置 GitHub 发布令牌（第一次发布时填写，保存在本机）' };
  const publisher = getSetting(db, SETTING_PUBLISHER).trim() || '佚名';

  const slug = courseSlug(courseName);
  const filePath = `${HOMEWORK_DIR}/${encodeURIComponent(slug)}.json`;

  // 2) 读取远端现有文件（404 = 首次发布）
  let file: HomeworkFile = { courseName, updatedAt: 0, entries: [] };
  let sha: string | undefined;
  {
    const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token });
    if (r.status === 404) {
      /* 首次发布，新建 */
    } else if (!r.ok) {
      return { ok: false, error: describeStatus(r.status, r.text) };
    } else {
      try {
        const meta = JSON.parse(r.text);
        sha = meta.sha;
        file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
        if (!Array.isArray(file.entries)) file.entries = [];
      } catch {
        return { ok: false, error: '远端作业文件损坏（JSON 解析失败），可到仓库里手动修正后重试' };
      }
    }
  }

  // 3) 组装条目（同课程 + 同日期 + 同标题 → 覆盖）
  const now = Date.now();
  const existing = file.entries.find(
    (e) => e.sessionDate === sessionDate && e.title === title
  );
  const entry: HomeworkEntry = {
    id: existing?.id || randomUUID(),
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
  file.entries = existing
    ? file.entries.map((e) => (e.id === entry.id ? entry : e))
    : [...file.entries, entry];
  file.courseName = courseName;
  file.updatedAt = now;
  file.entries.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));

  // 4) 写回（一次 409 冲突重试）
  const put = async (currentSha?: string) => {
    const body = {
      message: `homework: ${existing ? '更新' : '发布'} ${courseName} ${sessionDate} ${title}`,
      content: Buffer.from(JSON.stringify(file, null, 2), 'utf8').toString('base64'),
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
    fileUrl: `${REPO_URL}/${encodeURIComponent(slug)}.json`,
  };
}

/** 拉取某门课的远端已发布作业（发布对话框里展示，避免重复发布） */
export async function fetchRemoteEntries(db: DB, courseName: string): Promise<{ ok: boolean; error?: string; entries: HomeworkEntry[] }> {
  const token = getSetting(db, SETTING_TOKEN).trim();
  const slug = courseSlug(courseName);
  const filePath = `${HOMEWORK_DIR}/${encodeURIComponent(slug)}.json`;
  const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token: token || undefined });
  if (r.status === 404) return { ok: true, entries: [] };
  if (!r.ok) return { ok: false, error: describeStatus(r.status, r.text), entries: [] };
  try {
    const meta = JSON.parse(r.text);
    const file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
    return { ok: true, entries: Array.isArray(file.entries) ? file.entries : [] };
  } catch {
    return { ok: false, error: '远端文件解析失败', entries: [] };
  }
}

// ==================== 同步 ====================
/** 从 GitHub 拉全部作业并写入本地课程（按课程名匹配，缺失自动建课） */
export async function syncHomework(db: DB): Promise<SyncResult> {
  const result: SyncResult = {
    ok: false, files: 0, entries: 0, created: 0, updated: 0,
    coursesTouched: 0, coursesCreated: [], items: [], syncedAt: Date.now(),
  };
  const token = getSetting(db, SETTING_TOKEN).trim();

  // 1) 列出 homework/ 目录（公开仓库匿名可读；≤1MB 的文件列表自带 base64 内容）
  let list: any[];
  {
    const r = await ghFetch(`/contents/${HOMEWORK_DIR}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token: token || undefined });
    if (r.status === 404) {
      result.ok = true;
      return result; // 还没人发布过
    }
    if (!r.ok) { result.error = describeStatus(r.status, r.text); return result; }
    try { list = JSON.parse(r.text); } catch { result.error = '目录列表解析失败'; return result; }
  }

  const files = (Array.isArray(list) ? list : []).filter((f) => f.type === 'file' && /\.json$/i.test(f.name || ''));
  result.files = files.length;

  const courseByName = new Map<string, number>();
  const touchCourses = new Set<number>();
  let currentCourseId = -1;

  for (const f of files) {
    let hf: HomeworkFile;
    try {
      // 列表接口对 ≤1MB 文件直接给 content；拿不到再单独拉 raw
      if (f.content) {
        hf = JSON.parse(decodeBase64Utf8(f.content.replace(/\n/g, '')));
      } else {
        const g = await ghFetch(f.url, { token: token || undefined });
        if (!g.ok) continue;
        hf = JSON.parse(decodeBase64Utf8(JSON.parse(g.text).content || ''));
      }
    } catch { continue; }
    if (!hf || !Array.isArray(hf.entries)) continue;

    const courseName = (hf.courseName || '').trim();
    if (!courseName) continue;

    // 2) 课程匹配：先找同名本地课程，没有则自动新建
    let courseId = courseByName.get(courseName);
    if (courseId === undefined) {
      const hit = db.prepare('SELECT id FROM courses WHERE TRIM(name) = ? LIMIT 1').get(courseName) as { id: number } | undefined;
      if (hit) {
        courseId = hit.id;
      } else {
        const info = db.prepare(
          `INSERT INTO courses (name, code, instructor, semester, color, description, tags, created_at)
           VALUES (?, NULL, NULL, NULL, '#00FF88', '由作业同步自动创建', '[]', ?)`
        ).run(courseName, Date.now());
        courseId = Number(info.lastInsertRowid);
        result.coursesCreated.push(courseName);
      }
      courseByName.set(courseName, courseId);
    }

    // 3) 条目写入：remote_id 去重；已存在则只更新内容字段，不动本地完成状态
    for (const e of hf.entries) {
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
          `来源：GitHub 同步 · 发布人 ${e.publisher || '佚名'} · ${e.sessionDate || ''}${e.sessionTime ? ' ' + e.sessionTime : ''}`,
          Date.now(), e.id, e.sessionDate || null, e.publisher || null
        );
        result.created++;
      }
      result.items.push({ courseName, title: e.title, sessionDate: e.sessionDate || '', action: local ? 'updated' : 'created' });
      if (currentCourseId !== courseId) { touchCourses.add(courseId); currentCourseId = courseId; }
    }
  }

  result.coursesTouched = touchCourses.size;
  result.ok = true;
  setSetting(db, SETTING_LAST_SYNC, String(Date.now()));
  return result;
}

// ==================== IPC ====================
export function registerHomework(db: DB) {
  ipcMain.handle('homework:config', () => ({
    repo: `${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}`,
    branch: HOMEWORK_BRANCH,
    dir: HOMEWORK_DIR,
    repoUrl: REPO_URL,
    tokenSet: !!getSetting(db, SETTING_TOKEN).trim(),
    publisher: getSetting(db, SETTING_PUBLISHER),
    lastSync: Number(getSetting(db, SETTING_LAST_SYNC)) || null,
  }));

  ipcMain.handle('homework:saveAuth', (_e, token: string, publisher: string) => {
    const t = (token || '').trim();
    if (t && !/^(gh[ps]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)$/.test(t)) {
      return { ok: false, error: '令牌格式不像 GitHub PAT（应以 ghp_ / github_pat_ 开头）' };
    }
    if (t) setSetting(db, SETTING_TOKEN, t);
    if ((publisher || '').trim()) setSetting(db, SETTING_PUBLISHER, publisher.trim());
    return { ok: true, tokenSet: !!getSetting(db, SETTING_TOKEN).trim() };
  });

  ipcMain.handle('homework:verifyPassword', (_e, password: string) => ({
    ok: password === HOMEWORK_PUBLISH_PASSWORD,
  }));

  ipcMain.handle('homework:publish', async (_e, payload: PublishPayload) => {
    try {
      return await publishHomework(db, payload);
    } catch (e: any) {
      return { ok: false, error: describeError(e) };
    }
  });
  ipcMain.handle('homework:remoteEntries', async (_e, courseName: string) => {
    try {
      return await fetchRemoteEntries(db, courseName);
    } catch (e: any) {
      return { ok: false, error: describeError(e), entries: [] };
    }
  });
  ipcMain.handle('homework:sync', async () => {
    try {
      return await syncHomework(db);
    } catch (e: any) {
      return { ok: false, error: describeError(e), files: 0, entries: 0, created: 0, updated: 0, coursesTouched: 0, coursesCreated: [], items: [], syncedAt: Date.now() } as SyncResult;
    }
  });
}
