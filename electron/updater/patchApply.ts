/**
 * v1.1.6 增量更新：客户端应用补丁（块 4b）
 *
 * 流程：
 * 1. `selectPatch(manifest, currentVersion)` —— 从 winner.patches 里找匹配 fromVersion 的补丁
 *    （找不到 / baseAsarSha256 没对齐 → fall back 全量）
 * 2. `downloadPatch(zip)` —— 走与 downloadUpdate 同款 net.fetch 流式下载 + sha256 校验
 * 3. `applyPatch(zipPath, opts)` —— spawn helper + 等主进程退出 → 落新 asar
 *
 * 设计要点：
 * - 落盘由 helper 在「主进程外」完成（ELECTRON_RUN_AS_NODE=1），所以 patch
 *   开始前会做两件事：① 写状态标记文件 `taskmanager-patch-state.json` 供
 *   下次启动自检；② 通知用户弹「立即重启并应用补丁」确认窗（不等用户也行，
 *   强制重启更稳）。
 * - 任意失败 → 自动回退全量 Setup，UI 显示「无法补丁，已为您下载整装」
 */
import { app, net, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';

/** 补丁就绪后写一份持久化状态，主进程下次启动 / app.isReady 时自检：是否被补丁应用成功 */
const STATE_FILE = () => path.join(app.getPath('userData'), 'patch-state.json');

/** manifest.patches[] 元素类型 */
export interface PatchEntry {
  fromVersion: string;
  url: string;
  sha256: string;
  size: number;
  baseAsarSha256: string;
  baseAsarSize?: number;
  appAsarSha256: string;
  appAsarSize?: number;
  createdAt?: string;
}

/** 与 main 进程的 UpdateManifest 对齐（这里只关心 patch 字段） */
export interface ManifestLite {
  version: string;
  url?: string | null;
  sha256?: string | null;
  size?: number | null;
  page?: string | null;
  notes?: string | null;
  /** v1.1.6 起的增量补丁清单（同 fromVersion 多次发版保留最新一份） */
  patches?: PatchEntry[];
  /** v1.1.6 起最新 app.asar 的哈希，App 启动自检用 */
  asarSha256?: string | null;
  asarSize?: number | null;
}

/** 当前 app.asar 的完整路径（packaged 后位于 resources/app.asar） */
export function currentAsarPath(): string {
  // 开发模式 process.resourcesPath 不存在 → fallback 到 dist-electron
  // dist-electron 目录没有 app.asar（asar 是打包产物的概念）。开发模式下不走补丁路径
  if (!app.isPackaged) return path.join(app.getAppPath(), 'dev-not-patchable.asar');
  return path.join(process.resourcesPath, 'app.asar');
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 找匹配 fromVersion 的补丁；返回 null 表示没有可用补丁 */
export function selectPatch(manifest: ManifestLite | null | undefined, currentVersion: string): PatchEntry | null {
  if (!manifest || !Array.isArray(manifest.patches)) return null;
  for (const p of manifest.patches) {
    if (p && p.fromVersion === currentVersion) return p;
  }
  return null;
}

/** 当前 asar 的 sha256（异步读取；packaged 后才是真实 asar） */
export async function currentAsarSha256(): Promise<string | null> {
  const p = currentAsarPath();
  if (!fs.existsSync(p)) return null;
  try {
    const buf = await fs.promises.readFile(p);
    return sha256Hex(buf);
  } catch { return null; }
}

/** 下载补丁 zip + sha256 校验；进度通过 onProgress 回调上报 */
export async function downloadPatchZip(
  patch: PatchEntry,
  onProgress?: (p: { received: number; total: number; percent: number }) => void,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const dir = path.join(os.tmpdir(), 'taskmgr-patch');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const filename = `${patch.fromVersion}-to-${(patch as any).toVersion || 'next'}.zip`;
  const dest = path.join(dir, filename);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);

  try {
    const res = await net.fetch(patch.url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'TaskManager-Updater', Accept: 'application/zip,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0) || patch.size;
    if (!res.body) throw new Error('下载响应为空');

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    // @ts-ignore
    const reader = res.body.getReader();
    let received = 0;
    let lastTick = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()));
      const now = Date.now();
      if (now - lastTick > 250) {
        lastTick = now;
        onProgress?.({ received, total, percent: total > 0 ? Math.round((received / total) * 100) : 0 });
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e: Error | null) => (e ? reject(e) : resolve())));
    const actual = hash.digest('hex');
    if (actual !== patch.sha256.toLowerCase()) {
      try { fs.unlinkSync(dest); } catch {}
      throw new Error(`补丁包 sha256 不匹配：期望 ${patch.sha256.slice(0, 16)}… 实际 ${actual.slice(0, 16)}…`);
    }
    onProgress?.({ received, total, percent: 100 });
    return { ok: true, path: dest };
  } catch (e: any) {
    const aborted = /abort/i.test(String(e?.message || ''));
    return { ok: false, canceled: aborted, error: aborted ? '下载超时或已取消' : (e?.message || String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

/** helper 脚本路径（packaged 后位于 resources/patch-helper.cjs，dev 时从仓库源拷贝） */
function helperScriptPath(): { path: string; isPackaged: boolean } {
  if (app.isPackaged) {
    return { path: path.join(process.resourcesPath, 'patch-helper.cjs'), isPackaged: true };
  }
  // dev 模式：从仓库源取（仅供本地联调用）
  const repoPath = path.resolve(__dirname, '..', 'resources', 'patch-helper.cjs');
  return { path: repoPath, isPackaged: false };
}

/**
 * 启动 helper 进程（落盘 asar 的实际活由它做）
 * - ELECTRON_RUN_AS_NODE=1 让 Electron 32+ 可执行纯 Node 脚本
 * - detached: true 让 helper 独立运行，不被主进程退出连坐
 */
export function spawnPatchHelper(zipPath: string, manifest: PatchEntry, opts?: { relaunch?: boolean }): { ok: boolean; pid?: number; error?: string } {
  const helper = helperScriptPath();
  if (!fs.existsSync(helper.path)) {
    return { ok: false, error: `helper 脚本不存在：${helper.path}（dev 模式请从 electron/resources/patch-helper.cjs 拷贝，packaged 模式由 extraResources 配置自动复制）` };
  }
  const payload = JSON.stringify({
    zipPath,
    appAsarPath: currentAsarPath(),
    manifest,
    mainPid: process.pid,
    timeoutMs: 30_000,
    relaunch: opts?.relaunch !== false,
  });
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TASKMGR_PATCH_JSON: payload,
    };
    delete env.ELECTRON_RUN_AS_NODE; // 上一行已设了，但要确保不会被子进程继承其他模式
    env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(process.execPath, [helper.path, '--patch-helper', payload], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true,
    });
    child.unref();
    // 落状态文件：让下次启动自检
    try {
      fs.writeFileSync(STATE_FILE(), JSON.stringify({
        zipPath,
        manifest,
        startedAt: Date.now(),
        helperPid: child.pid,
        expectedToSha: manifest.appAsarSha256,
      }, null, 2));
    } catch { /* ignore */ }
    return { ok: true, pid: child.pid };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** 下次启动自检：如果检测到 patch 状态文件 + 当前 asar 哈希未对齐，清掉状态走全量 */
export function checkPatchStateOnBoot(): {
  applied?: boolean;
  failed?: boolean;
  baseline?: { expected: string; actual: string } | null;
} {
  const f = STATE_FILE();
  if (!fs.existsSync(f)) return {};
  let state: any = null;
  try { state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (!state) { try { fs.unlinkSync(f); } catch {}; return {}; }
  const cur = (() => {
    try {
      const p = currentAsarPath();
      if (!fs.existsSync(p)) return null;
      return sha256Hex(fs.readFileSync(p));
    } catch { return null; }
  })();
  if (!cur) return {};
  const expected = (state.expectedToSha || '').toLowerCase();
  if (expected && cur === expected) {
    // 成功：删状态
    try { fs.unlinkSync(f); } catch {}
    return { applied: true };
  }
  return {
    failed: true,
    baseline: { expected: expected || '?', actual: cur || '?' },
  };
}

/** 强制走「补丁通道」的入口（含 UI 确认 + 自动重启） */
export async function startPatchUpdate(
  manifest: ManifestLite,
  currentVersion: string,
  mainWindow: BrowserWindow | null,
): Promise<{
  stage: 'no-patch' | 'downloading' | 'ready-to-apply' | 'fallback-full';
  message: string;
  patch?: PatchEntry;
  sizeMB?: number;
}> {
  const patch = selectPatch(manifest, currentVersion);
  if (!patch) return { stage: 'no-patch', message: '无可用增量补丁，将走整装' };

  const cur = await currentAsarSha256();
  if (cur && cur !== patch.baseAsarSha256.toLowerCase()) {
    return { stage: 'fallback-full', message: `基线不对（${cur.slice(0, 8)}… vs ${patch.baseAsarSha256.slice(0, 8)}…），自动回退整装安装`, patch };
  }
  return {
    stage: 'ready-to-apply',
    message: `已选择增量补丁：${(patch.size / 1024 / 1024).toFixed(1)} MB（vs 全量 ~90 MB）`,
    patch,
    sizeMB: patch.size / 1024 / 1024,
  };
}
