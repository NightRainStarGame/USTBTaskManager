/**
 * v1.2.3 WebDAV 云同步：把全量备份推到坚果云等 WebDAV 服务，随时跨设备恢复。
 * 远端固定单文件 taskmanager-backup.json（覆盖式），本地另有自动滚动备份兜底。
 * 纯标准 HTTP（PUT/GET/DELETE + Basic Auth），不引入额外依赖。
 */
import type { DB } from './db/index';
import { ipcMain } from 'electron';
import { buildPayload, validatePayload, restorePayload } from './backup/core';
import { safetyBackup } from './backup/index';

const SETTING_URL = 'webdav_url';
const SETTING_USER = 'webdav_user';
const SETTING_PASS = 'webdav_pass';
const REMOTE_FILE = 'taskmanager-backup.json';
const PROBE_FILE = 'taskmanager-probe.txt';
const TIMEOUT_MS = 30000;

interface WebdavConfig {
  url: string;
  user: string;
  pass: string;
}

function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setSetting(db: DB, key: string, value: string) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

function readConfig(db: DB): WebdavConfig | null {
  const url = getSetting(db, SETTING_URL);
  const user = getSetting(db, SETTING_USER);
  const pass = getSetting(db, SETTING_PASS);
  if (!url || !pass) return null;
  return { url: url.trim(), user: user || '', pass };
}

/** URL 规范化：去尾部斜杠，拼远端文件名 */
function fileUrl(base: string, name: string): string {
  return `${base.replace(/\/+$/, '')}/${name}`;
}

function authHeaders(cfg: WebdavConfig): Record<string, string> {
  return {
    Authorization: 'Basic ' + Buffer.from(`${cfg.user}:${cfg.pass}`).toString('base64'),
  };
}

async function webdavFetch(url: string, cfg: WebdavConfig, init: { method?: string; body?: string; contentType?: string } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init.method || 'GET',
      headers: {
        ...authHeaders(cfg),
        ...(init.body ? { 'Content-Type': init.contentType || 'application/octet-stream' } : {}),
      },
      body: init.body,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function describeWebdavError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/abort|timeout/i.test(msg)) return `请求超时（超过 ${TIMEOUT_MS / 1000} 秒无响应）`;
  if (/ENOTFOUND|NAME_NOT_RESOLVED/i.test(msg)) return '无法解析服务器地址，请检查 URL';
  if (/Failed to fetch|ECONNREFUSED|ECONNRESET/i.test(msg)) return '连接服务器失败，请检查网络与地址';
  return msg || '未知错误';
}

export function registerWebdav(db: DB) {
  // 配置读取（密码不回传，只回 hasPass）
  ipcMain.handle('webdav:config', () => {
    const url = getSetting(db, SETTING_URL);
    const user = getSetting(db, SETTING_USER);
    const pass = getSetting(db, SETTING_PASS);
    return { url: url || '', user: user || '', hasPass: !!pass, configured: !!(url && pass) };
  });

  ipcMain.handle('webdav:save', (_e, cfg: { url?: string; user?: string; pass?: string; clearPass?: boolean }) => {
    if (cfg.url !== undefined) setSetting(db, SETTING_URL, cfg.url.trim());
    if (cfg.user !== undefined) setSetting(db, SETTING_USER, (cfg.user || '').trim());
    if (cfg.clearPass) setSetting(db, SETTING_PASS, '');
    else if (cfg.pass) setSetting(db, SETTING_PASS, cfg.pass);
    return { ok: true };
  });

  // 连接测试：PUT 探针 → 立即删除
  ipcMain.handle('webdav:test', async () => {
    const cfg = readConfig(db);
    if (!cfg) return { ok: false, error: '请先填写服务器地址和应用密码' };
    try {
      const put = await webdavFetch(fileUrl(cfg.url, PROBE_FILE), cfg, {
        method: 'PUT',
        body: `taskmanager webdav probe ${Date.now()}`,
        contentType: 'text/plain',
      });
      if (!put.ok) {
        const detail = put.status === 401 || put.status === 403 ? '认证失败：请核对账号与应用密码（坚果云需用「应用密码」而非登录密码）'
          : put.status === 404 || put.status === 405 ? '服务器拒绝写入该路径（目录不存在或不含 /dav/）'
          : `服务器返回 ${put.status}`;
        return { ok: false, error: detail };
      }
      const del = await webdavFetch(fileUrl(cfg.url, PROBE_FILE), cfg, { method: 'DELETE' });
      if (!del.ok && del.status !== 404) {
        // 探针没删掉不算致命（目录里多一个小文件），但提醒用户
        return { ok: true, warning: `连接成功，但清理测试文件失败（HTTP ${del.status}），稍后可手动删除 ${PROBE_FILE}` };
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: describeWebdavError(e) };
    }
  });

  // 推送：全量备份 payload → PUT 固定文件
  ipcMain.handle('webdav:push', async () => {
    const cfg = readConfig(db);
    if (!cfg) return { ok: false, error: '请先配置 WebDAV' };
    try {
      const { app } = require('electron');
      const payload = buildPayload(db, app.getVersion());
      const text = JSON.stringify(payload);
      const put = await webdavFetch(fileUrl(cfg.url, REMOTE_FILE), cfg, {
        method: 'PUT',
        body: text,
        contentType: 'application/json',
      });
      if (!put.ok) {
        const detail = put.status === 401 || put.status === 403 ? '认证失败（核对账号/应用密码）' : `服务器返回 ${put.status}`;
        return { ok: false, error: `上传失败：${detail}` };
      }
      return { ok: true, size: text.length, counts: payload.counts, exportedAt: payload.exportedAt };
    } catch (e: any) {
      return { ok: false, error: describeWebdavError(e) };
    }
  });

  // 远端信息（不恢复）：看云端备份的时间/版本/规模
  ipcMain.handle('webdav:remoteInfo', async () => {
    const cfg = readConfig(db);
    if (!cfg) return { ok: false, error: '请先配置 WebDAV' };
    try {
      const res = await webdavFetch(fileUrl(cfg.url, REMOTE_FILE), cfg);
      if (res.status === 404) return { ok: true, exists: false };
      if (!res.ok) return { ok: false, error: `服务器返回 ${res.status}` };
      const text = await res.text();
      const v = validatePayload(JSON.parse(text));
      if (!v.ok) return { ok: false, error: `云端备份无效：${v.error}` };
      const p = v.payload!;
      return {
        ok: true, exists: true,
        exportedAt: p.exportedAt, appVersion: p.appVersion, counts: p.counts,
      };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/JSON/i.test(msg)) return { ok: false, error: '云端文件不是有效 JSON' };
      return { ok: false, error: describeWebdavError(e) };
    }
  });

  // 拉取恢复：GET → 校验 → 安全备份 → 事务恢复
  ipcMain.handle('webdav:pull', async () => {
    const cfg = readConfig(db);
    if (!cfg) return { ok: false, error: '请先配置 WebDAV' };
    try {
      const res = await webdavFetch(fileUrl(cfg.url, REMOTE_FILE), cfg);
      if (res.status === 404) return { ok: false, error: '云端还没有备份（先在旧设备上传一次）' };
      if (!res.ok) return { ok: false, error: `下载失败：服务器返回 ${res.status}` };
      const text = await res.text();
      const v = validatePayload(JSON.parse(text));
      if (!v.ok) return { ok: false, error: `云端备份无效：${v.error}` };
      const safetyPath = await safetyBackup(db);
      try {
        const restored = restorePayload(db, v.payload!);
        return { ok: true, restored, safetyBackupPath: safetyPath, exportedAt: v.payload!.exportedAt };
      } catch (err: any) {
        return { ok: false, error: `恢复失败（本地数据库未改动）：${err?.message || err}` };
      }
    } catch (e: any) {
      return { ok: false, error: describeWebdavError(e) };
    }
  });
}
