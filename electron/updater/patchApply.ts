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
  destDir?: string,
): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const dir = destDir ?? path.join(os.tmpdir(), 'taskmgr-patch');
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
    // Electron net.fetch 返回的 body 类型未声明 getReader（实际是 ReadableStream）
    const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
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
    const child = spawn(process.execPath, [helper.path, '--patch-helper', payload], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true,
      // v1.2.7：helper 进程需要 cwd = app 所在目录，否则 relaunch 时 spawn 找不到资源路径
      cwd: app.isPackaged ? path.dirname(process.execPath) : undefined,
    });
    child.unref();
    // 落状态文件：让下次启动自检（v1.2.7 加 phase 字段：pending → applied/failed）
    try {
      fs.writeFileSync(STATE_FILE(), JSON.stringify({
        zipPath,
        manifest,
        phase: 'pending',
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

/** 下次启动自检：如果检测到 patch 状态文件 + 当前 asar 哈希未对齐，清掉状态走全量
 *  v1.2.7：同时探测 app.asar.new 残留（helper rename 失败时写的旁路）—— helper 启动时
 *  会自动接管，但为了 UX，把 .new 残留信息也透传给 UI 提示用户 */
export function checkPatchStateOnBoot(): {
  applied?: boolean;
  failed?: boolean;
  baseline?: { expected: string; actual: string } | null;
  /** v1.2.7：helper 已成功落 .new 旁路但没接管（罕见的 AV 锁文件场景），下次启动 helper 会自动接管 */
  pendingSidecar?: boolean;
  /** v1.2.7：.new 残留的 sha（如果存在），用于 UI 调试展示 */
  sidecarSha?: string;
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
  // v1.2.7：检测 app.asar.new 残留
  const sidecarPath = currentAsarPath() + '.new';
  let sidecarSha: string | undefined;
  if (fs.existsSync(sidecarPath)) {
    try { sidecarSha = sha256Hex(fs.readFileSync(sidecarPath)); } catch {}
  }
  if (expected && cur === expected) {
    // 成功：删状态
    try { fs.unlinkSync(f); } catch {}
    return { applied: true };
  }
  if (sidecarSha && state.phase === 'pending') {
    // .new 残留说明上次 rename 失败，helper 启动后会自己接管，主进程不需要做任何事
    return {
      failed: false,
      pendingSidecar: true,
      baseline: { expected: expected || '?', actual: cur || '?' },
      sidecarSha,
    };
  }
  return {
    failed: true,
    baseline: { expected: expected || '?', actual: cur || '?' },
  };
}

/** v1.2.7：仅接管 .new 旁路（用于用户在 Settings → PatchStateCard 里看到 pendingSidecar 时点重试）
 *  不依赖 patch-info.json，直接 spawn helper with mode='takeover-sidecar' payload */
export function takeoverSidecarPatch(): { ok: boolean; error?: string; helperPid?: number } {
  const sidecar = currentAsarPath() + '.new';
  if (!fs.existsSync(sidecar)) return { ok: false, error: '没有 .new 旁路残留' };
  const helper = helperScriptPath();
  if (!fs.existsSync(helper.path)) {
    return { ok: false, error: `helper 脚本不存在：${helper.path}` };
  }
  let sidecarSha = '';
  try { sidecarSha = sha256Hex(fs.readFileSync(sidecar)); } catch {}
  const payload = JSON.stringify({
    mode: 'takeover-sidecar',
    appAsarPath: currentAsarPath(),
    sidecarSha,
    relaunch: true,
    mainPid: process.pid,
    timeoutMs: 30_000,
  });
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TASKMGR_PATCH_JSON: payload,
    };
    const child = spawn(process.execPath, [helper.path, '--patch-helper', payload], {
      detached: true,
      stdio: 'ignore',
      env,
      windowsHide: true,
      cwd: app.isPackaged ? path.dirname(process.execPath) : undefined,
    });
    child.unref();
    // 更新 patch-state.json 标记为 takeover 模式
    try {
      const f = STATE_FILE();
      let prev: any = {};
      try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      prev.phase = 'pending';
      prev.takenoverByUser = Date.now();
      prev.expectedToSha = sidecarSha || prev.expectedToSha;
      fs.writeFileSync(f, JSON.stringify(prev, null, 2));
    } catch {}
    return { ok: true, helperPid: child.pid };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
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

/* ========== v1.3.0 补丁持久缓存（zip + json，设置内一键应用） ========== */

/** 缓存目录：userData/update-cache（跨重启保留，区别于 tmp） */
export function patchCacheDir(): string {
  return path.join(app.getPath('userData'), 'update-cache');
}

export interface PatchCacheState {
  exists: boolean;
  /** patch-info.json 内容（补丁元数据 + 下载时间） */
  info?: {
    fromVersion: string;
    toVersion: string;
    sha256: string;
    size: number;
    baseAsarSha256: string;
    appAsarSha256: string;
    downloadedAt: number;
    zipPath: string;
  };
  /** zip 实际 sha256 校验是否通过（null = zip 文件缺失） */
  zipOk?: boolean | null;
  /** 基线（当前 asar 是否匹配补丁起点） */
  baselineOk?: boolean;
}

/** 下载补丁到持久缓存（不退出应用）；zip + patch-info.json 一起落盘 */
export async function downloadPatchToCache(
  patch: PatchEntry & { toVersion?: string },
  onProgress?: (p: { received: number; total: number; percent: number }) => void,
): Promise<{ ok: boolean; error?: string; state?: PatchCacheState }> {
  const dir = patchCacheDir();
  const r = await downloadPatchZip(patch, onProgress, dir);
  if (!r.ok) return { ok: false, error: r.error || '下载失败' };
  const info = {
    fromVersion: patch.fromVersion,
    toVersion: (patch as any).toVersion || '',
    sha256: patch.sha256,
    size: patch.size,
    baseAsarSha256: patch.baseAsarSha256,
    appAsarSha256: patch.appAsarSha256,
    downloadedAt: Date.now(),
    zipPath: r.path!,
  };
  try {
    fs.writeFileSync(path.join(dir, 'patch-info.json'), JSON.stringify(info, null, 2));
  } catch (e: any) {
    return { ok: false, error: '写补丁元数据失败：' + (e?.message || e) };
  }
  return { ok: true, state: readPatchCache() };
}

/** 读取缓存状态：info + zip sha256 复核 + 当前 asar 基线核对 */
export function readPatchCache(): PatchCacheState {
  const dir = patchCacheDir();
  const infoPath = path.join(dir, 'patch-info.json');
  if (!fs.existsSync(infoPath)) return { exists: false };
  let info: PatchCacheState['info'];
  try {
    info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    return { exists: false };
  }
  if (!info?.zipPath || !fs.existsSync(info.zipPath)) {
    return { exists: true, info, zipOk: null };
  }
  let zipOk = false;
  try {
    zipOk = sha256Hex(fs.readFileSync(info.zipPath)) === info.sha256.toLowerCase();
  } catch { zipOk = false; }
  return { exists: true, info, zipOk };
}

/** 应用缓存里的补丁：校验 zip → 基线核对 → spawn helper（不在此退出，由调用方决定） */
export async function applyCachedPatch(): Promise<{ ok: boolean; error?: string; state?: PatchCacheState; helperPid?: number }> {
  const dir = patchCacheDir();
  const infoPath = path.join(dir, 'patch-info.json');
  if (!fs.existsSync(infoPath)) return { ok: false, error: '没有已下载的补丁' };
  let info: NonNullable<PatchCacheState['info']>;
  try {
    info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    return { ok: false, error: '补丁元数据损坏，请重新下载' };
  }
  if (!fs.existsSync(info.zipPath)) {
    return { ok: false, error: '补丁 zip 缺失，请重新下载' };
  }
  const actual = sha256Hex(fs.readFileSync(info.zipPath));
  if (actual !== info.sha256.toLowerCase()) {
    return { ok: false, error: `补丁 zip 校验失败（期望 ${info.sha256.slice(0, 8)}… 实际 ${actual.slice(0, 8)}…），请重新下载` };
  }
  const cur = await currentAsarSha256();
  if (cur && cur !== info.baseAsarSha256.toLowerCase()) {
    return {
      ok: false,
      error: `当前版本基线不匹配（${cur.slice(0, 8)}… vs 补丁起点 ${info.baseAsarSha256.slice(0, 8)}…），补丁已过期，请走完整安装`,
      state: readPatchCache(),
    };
  }
  const entry: PatchEntry = {
    fromVersion: info.fromVersion,
    url: info.zipPath,
    sha256: info.sha256,
    size: info.size,
    baseAsarSha256: info.baseAsarSha256,
    appAsarSha256: info.appAsarSha256,
  };
  const spawned = spawnPatchHelper(info.zipPath, entry, { relaunch: true });
  if (!spawned.ok) return { ok: false, error: 'helper 启动失败：' + (spawned.error || '') };
  return { ok: true, helperPid: spawned.pid };
}

/** 清空补丁缓存 */
export function clearPatchCache(): { ok: boolean } {
  const dir = patchCacheDir();
  try {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch { /* ignore */ }
  return { ok: true };
}
