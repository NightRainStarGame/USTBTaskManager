/**
 * 作业发布 / 接收模块（主进程，码制协议 v2）
 *
 * 「作业包」= 一个课程的整套作业（含多节课条目），由一对随机码标识：
 *
 *   同步作业码（syncCode）—— 分享码，8 位，公开。
 *     接收方输入此码 → 从 GitHub（或云盘镜像）拉取 homework/<syncCode>.json
 *     → 按课程名匹配本地课程（缺失自动建课）→ 按 remote_id 去重导入。
 *
 *   作业发布码（publishCode）—— 密钥，12 位，由 syncCode 经 HMAC-SHA256 单向派生。
 *     发布方输入此码 → App 本地重算派生比对（验证无需联网、无需服务端）
 *     → 凭 GitHub 令牌把包写入 homework/<syncCode>.json。
 *
 * 码可由 App 内生成（homework:generateCodes），也可由配套网站生成——
 * 网站端只要用同样的 SECRET + 派生算法即可产出一致的码对（见 docs/HOMEWORK-CODES.md）。
 *
 * 存储布局：
 *   GitHub: homework/<syncCode>.json   （Contents API，匿名可读、令牌可写）
 *   云盘：  <syncCode>/homework.json   （第二源，SourceAdapter 占位，网站做好后接入）
 *
 * 安全说明：
 *   - publishCode 只是 UI / 协议层门槛；真正的写权限由 GitHub 令牌控制
 *     （只存在发布者本机 settings 表，建议 fine-grained PAT 仅本仓库 Contents 读写）。
 *   - 派生算法内置在客户端，防君子不防逆向；对班级作业场景足够。
 */
import { net, ipcMain } from 'electron';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import type { DB } from '../db/index';

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

/** 生成一对码：随机 syncCode + 由其 HMAC 派生的 publishCode */
export function generateCodePair(): { syncCode: string; publishCode: string } {
  const syncCode = randomCode(SYNC_CODE_LEN);
  return { syncCode, publishCode: derivePublishCode(syncCode) };
}

/** publishCode = 字母表映射(HMAC-SHA256(SECRET, 'publish:' + syncCode)).slice(0, 12) */
export function derivePublishCode(syncCode: string): string {
  const mac = createHmac('sha256', CODE_SECRET).update(`publish:${syncCode}`).digest();
  return bytesToCode(mac, PUBLISH_CODE_LEN);
}

/** 校验码对是否匹配（本地重算派生即可，无需联网） */
export function verifyCodePair(syncCode: string, publishCode: string): boolean {
  const s = (syncCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = (publishCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== SYNC_CODE_LEN || p.length !== PUBLISH_CODE_LEN) return false;
  if (![...s].every((c) => CODE_ALPHABET.includes(c))) return false;
  return derivePublishCode(s) === p;
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
  createdAt: number;
  updatedAt: number;
  entries: HomeworkEntry[];
}

export interface CodePair {
  syncCode: string;
  publishCode: string;
}

export interface PublishPayload {
  syncCode: string;
  publishCode: string;
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
 * 作业包数据源接口。GitHub 是第一实现；「网站云盘」为第二源，
 * 网站做好后在 CLOUD_SOURCE 里填 URL 规则即可（见 docs/HOMEWORK-CODES.md）。
 */
export interface HomeworkSource {
  name: string;
  /** 按 syncCode 拉取作业包；返回 null = 该源没有这个包 */
  fetchBundle(syncCode: string, token?: string): Promise<{ file: HomeworkFile } | null>;
}

/** GitHub 源：读 homework/<syncCode>.json（公开仓库匿名可读） */
const githubSource: HomeworkSource = {
  name: 'github',
  async fetchBundle(syncCode, token) {
    const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;
    const r = await ghFetch(`/contents/${filePath}?ref=${HOMEWORK_BRANCH}&t=${Date.now()}`, { token: token || undefined });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(describeStatus(r.status, r.text));
    const meta = JSON.parse(r.text);
    const file = JSON.parse(decodeBase64Utf8(meta.content || '')) as HomeworkFile;
    if (!file || !Array.isArray(file.entries)) throw new Error('远端作业包损坏（entries 缺失）');
    return { file };
  },
};

/**
 * 云盘源占位：网站上线后把 CLOUD_SOURCE_BASE 填上（例如
 * `https://example.com/homework`，fetch 地址即 `${base}/<syncCode>/homework.json`），
 * 并按网站实际返回格式调整解析。当前为 null = 未启用。
 */
const CLOUD_SOURCE_BASE: string | null = null;

const cloudSource: HomeworkSource = {
  name: 'cloud',
  async fetchBundle(syncCode) {
    if (!CLOUD_SOURCE_BASE) return null; // 未配置 = 跳过该源
    const url = `${CLOUD_SOURCE_BASE}/${syncCode}/homework.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await net.fetch(url, { signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`云盘源返回 ${res.status}`);
      const file = await res.json() as HomeworkFile;
      if (!file || !Array.isArray(file.entries)) throw new Error('云盘作业包损坏（entries 缺失）');
      return { file };
    } finally {
      clearTimeout(timer);
    }
  },
};

/** 按优先级依次尝试各源，返回第一个命中的包 */
async function fetchBundleFromAnySource(syncCode: string, token?: string): Promise<{ source: string; file: HomeworkFile } | null> {
  const errors: string[] = [];
  for (const src of [githubSource, cloudSource]) {
    try {
      const hit = await src.fetchBundle(syncCode, token);
      if (hit) return { source: src.name, file: hit.file };
    } catch (e: any) {
      errors.push(`${src.name}: ${e?.message || e}`);
    }
  }
  if (errors.length) throw new Error(errors.join('；'));
  return null;
}

// ==================== 发布 ====================
/**
 * 发布/更新一条作业到 homework/<syncCode>.json。
 * 幂等：同一课程同一上课日期 + 同标题 → 覆盖更新远端已有条目（保留其 id，接收端无感）。
 */
export async function publishHomework(db: DB, payload: PublishPayload): Promise<{ ok: boolean; error?: string; entry?: HomeworkEntry; fileUrl?: string }> {
  // 1) 码对验证（本地 HMAC 派生比对）
  const syncCode = normalizeSyncCode(payload.syncCode);
  if (!syncCode) return { ok: false, error: `同步作业码格式不对（${SYNC_CODE_LEN} 位，字母数字，不含 0/O/1/I/L）` };
  if (!verifyCodePair(syncCode, payload.publishCode)) {
    return { ok: false, error: '作业发布码与同步作业码不匹配（两码需成对使用）' };
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

  const filePath = `${HOMEWORK_DIR}/${syncCode}.json`;

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

  // 3) 组装条目（同日期 + 同标题 → 覆盖）
  const now = Date.now();
  const existing = file.entries.find(
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
  file.entries = existing
    ? file.entries.map((e) => (e.id === entry.id ? entry : e))
    : [...file.entries, entry];
  file.syncCode = syncCode;
  file.courseName = courseName;
  file.updatedAt = now;
  file.entries.sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));

  // 4) 写回（一次 409 冲突重试）
  const put = async (currentSha?: string) => {
    const body = {
      message: `homework: ${existing ? '更新' : '发布'} [${syncCode}] ${courseName} ${sessionDate} ${title}`,
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
    fileUrl: `${REPO_URL}/${syncCode}.json`,
  };
}

function randomUUIDSafe(): string {
  try { return randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
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
/** 按同步作业码拉取一个作业包并写入本地课程（按课程名匹配，缺失自动建课） */
export async function receiveHomework(db: DB, rawSyncCode: string): Promise<SyncResult> {
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

  // 课程匹配：先找同名本地课程，没有则自动新建
  let courseId: number;
  const hitCourse = db.prepare('SELECT id FROM courses WHERE TRIM(name) = ? LIMIT 1').get(courseName) as { id: number } | undefined;
  if (hitCourse) {
    courseId = hitCourse.id;
  } else {
    const info = db.prepare(
      `INSERT INTO courses (name, code, instructor, semester, color, description, tags, created_at)
       VALUES (?, NULL, NULL, NULL, '#00FF88', '由作业接收自动创建', '[]', ?)`
    ).run(courseName, Date.now());
    courseId = Number(info.lastInsertRowid);
    result.coursesCreated.push(courseName);
  }
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
        `来源：${source === 'cloud' ? '云盘' : 'GitHub'} 接收 · 码 ${syncCode} · 发布人 ${e.publisher || '佚名'} · ${e.sessionDate || ''}${e.sessionTime ? ' ' + e.sessionTime : ''}`,
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
  ipcMain.handle('homework:config', () => ({
    repo: `${HOMEWORK_REPO_OWNER}/${HOMEWORK_REPO_NAME}`,
    branch: HOMEWORK_BRANCH,
    dir: HOMEWORK_DIR,
    repoUrl: REPO_URL,
    tokenSet: !!getSetting(db, SETTING_TOKEN).trim(),
    publisher: getSetting(db, SETTING_PUBLISHER),
    lastSync: Number(getSetting(db, SETTING_LAST_SYNC)) || null,
    cloudSourceEnabled: !!CLOUD_SOURCE_BASE,
  }));

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

  /** 校验码对（本地 HMAC 比对，无需联网） */
  ipcMain.handle('homework:verifyCodes', (_e, syncCode: string, publishCode: string) => ({
    ok: verifyCodePair(syncCode, publishCode),
  }));

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

  ipcMain.handle('homework:receive', async (_e, syncCode: string) => {
    try {
      return await receiveHomework(db, syncCode);
    } catch (e: any) {
      return { ok: false, error: describeError(e), entries: 0, created: 0, updated: 0, coursesTouched: 0, coursesCreated: [], items: [], syncedAt: Date.now() } as SyncResult;
    }
  });
}
