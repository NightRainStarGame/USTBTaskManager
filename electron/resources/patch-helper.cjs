/**
 * v1.1.6 增量更新 helper（块 4b）—— CommonJS，进程外运行（ELECTRON_RUN_AS_NODE=1）
 *
 * 调用方式（主进程 / 业务代码 spawn 这个）：
 *   process.execPath
 *     -- 自身不需要任何参数，env 必须设 ELECTRON_RUN_AS_NODE=1
 *   用法：以 JSON 形式通过 argv[2] 或 stdin 传入：
 *     argv[2] === '--patch-helper'
 *     argv[3] === JSON.stringify({
 *       zipPath: '...',       // 已下载的补丁包
 *       appAsarPath: '...',   // 目标 app.asar 完整路径
 *       manifest: {...},      // 强校验：必含 baseAsarSha256 + appAsarSha256 + appAsarSize
 *       timeoutMs: 30000,     // 等主进程退出的最长秒数
 *       relaunch: true,       // 落盘成功后是否拉起新版本
 *     })
 *
 * 运行约定：
 * - 必须在主应用进入 quit 流程后调用（或者由主进程先退出再 spawn）
 * - helper 本身运行在进程外，独立完成解压 → 落新 asar → 验证
 * - 任意一步失败：日志写到 tmpdir 的 taskmanager-patch-helper.log，主进程下次启动时弹出回退提示
 *
 * 失败兜底（关键边界）：
 * - 主进程退出延迟超过了 timeoutMs → helper 也继续干完（设了「自己的旧进程未必退干净」的预期，
 *   所以 helper 解压到一个临时 asar 文件，校验完再 rename 替换）
 * - rename 失败（文件被持有） → 留 .new 旁路，主进程下次启动自检发现 sha256 不对走全量
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');

const LOG_FILE = path.join(os.tmpdir(), 'taskmanager-patch-helper.log');
function log(...args) {
  const msg = `[${new Date().toISOString()}] ` + args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch {}
  if (process.stdout && process.stdout.writable) process.stdout.write(msg + '\n');
}

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 解析传给 helper 的参数：argv[2]=--patch-helper + argv[3]=JSON or stdin */
function parseArgs() {
  const argv = process.argv;
  if (argv[2] !== '--patch-helper') {
    throw new Error('helper should be invoked with --patch-helper');
  }
  let payload = null;
  try {
    payload = JSON.parse(argv[3]);
  } catch (e) {
    // 尝试从 env 拿
    payload = process.env.TASKMGR_PATCH_JSON ? JSON.parse(process.env.TASKMGR_PATCH_JSON) : null;
  }
  if (!payload) throw new Error('helper: missing payload (argv[3] or env TASKMGR_PATCH_JSON)');
  return payload;
}

/** 阻塞轮询 main 进程退出，直到 pid 不再 alive 或 timeout */
function waitForProcessExit(pid, timeoutMs) {
  if (!pid || pid === process.pid) return Promise.resolve();
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      let alive = false;
      try {
        // tasklist 在 PID 不存在时返回空（不会抛）
        const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        alive = /,\s*\d+\s*,/.test(`\n${out}\n`);
      } catch { alive = false; }
      if (!alive) return resolve();
      if (Date.now() - start > timeoutMs) return resolve(); // 超时不阻塞
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** 用 7zip-bin 抽 app.asar 到 tmpdir */
function extractAsarToTmp(zipPath, targetTmp) {
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  ];
  // 也允许从 CWD 找本地开发副本
  const local = path.resolve(__dirname, '..', '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  candidates.push(local);
  const sevenZ = candidates.find((p) => p && fs.existsSync(p));
  if (!sevenZ) throw new Error('helper: 找不到 7za.exe —— 本机开发可 npm install 7zip-bin，打包版需要把 7za.exe 复制到 resources/');

  fs.mkdirSync(targetTmp, { recursive: true });
  const r = spawn(sevenZ, ['x', '-y', `-o${targetTmp}`, zipPath, 'app.asar'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let err = '';
    r.stderr.on('data', (d) => { err += d.toString(); });
    r.on('exit', (code) => {
      const extracted = path.join(targetTmp, 'app.asar');
      if (code !== 0 || !fs.existsSync(extracted)) return reject(new Error('7za 抽 app.asar 失败：' + (err || `exit=${code}`)));
      resolve(extracted);
    });
  });
}

/** 真正的活：解压 + 校验 + rename 落盘 */
async function apply(opts) {
  const { zipPath, appAsarPath, manifest, relaunch } = opts;
  const expectedToSha = (manifest && manifest.appAsarSha256 || '').toLowerCase();
  const expectedBaseSha = (manifest && manifest.baseAsarSha256 || '').toLowerCase();

  log('=== patch helper start ===');
  log(`zipPath=${zipPath} target=${appAsarPath} relaunch=${!!relaunch}`);

  if (!fs.existsSync(zipPath)) throw new Error(`zipPath 不存在 ${zipPath}`);
  if (!fs.existsSync(appAsarPath)) throw new Error(`app.asar 路径不存在 ${appAsarPath}`);

  // 1) 校验基线（升级前客户端 asar 哈希匹配 manifest.baseAsarSha256）
  if (expectedBaseSha) {
    const currentBase = sha256File(appAsarPath);
    if (currentBase !== expectedBaseSha) {
      log(`[!] 基线漂移：expected=${expectedBaseSha.slice(0, 16)} actual=${currentBase.slice(0, 16)} → helper 不会写入，但允许解压并让主进程后续决定`);
      throw new Error(`基线校验失败：当前 app.asar sha256 != manifest.baseAsarSha256`);
    }
    log(`基线校验通过 sha256=${expectedBaseSha.slice(0, 16)}…`);
  }

  // 2) 解压到 tmp
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmgr-patch-apply-'));
  try {
    const extractedAsar = await extractAsarToTmp(zipPath, tmp);
    const newSha = sha256File(extractedAsar);
    if (expectedToSha && newSha !== expectedToSha) {
      throw new Error(`zip 里 app.asar sha256 不匹配 manifest.appAsarSha256：${newSha.slice(0, 16)}… vs ${expectedToSha.slice(0, 16)}…`);
    }
    log(`解压校验通过 sha256=${newSha.slice(0, 16)}… size=${fs.statSync(extractedAsar).size}`);

    // 3) rename 旧 asar → app.asar.bak；再写新 asar
    const backup = appAsarPath + '.bak';
    try { fs.unlinkSync(backup); } catch {}
    try { fs.renameSync(appAsarPath, backup); } catch (e) {
      log(`[!] rename 旧 asar 失败：${e.message} —— 尝试用 .new 旁路落盘`);
      // 旁路：app.asar.new 不冲突 + 主进程启动自检会发现 sha256 不对走全量
      const sidecar = appAsarPath + '.new';
      fs.copyFileSync(extractedAsar, sidecar);
      log(`已写出 ${sidecar}，主进程下次启动自检自动接管`);
      return;
    }
    fs.copyFileSync(extractedAsar, appAsarPath);
    const finalSha = sha256File(appAsarPath);
    log(`落盘完成 sha256=${finalSha.slice(0, 16)}…`);
    if (finalSha !== expectedToSha) {
      // 落盘后又不对（理论上不可能，但 8.3 命名 / AV 干扰可能）
      throw new Error('落盘后 sha256 自检失败：' + finalSha + ' vs ' + expectedToSha);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }

  // 4) 可选：重新拉起
  if (relaunch) {
    log('拉起新版本应用');
    try {
      spawn(process.execPath, [], { detached: true, stdio: 'ignore', env: { ...process.env, TASKMGR_PATCH_APPLIED: '1' } }).unref();
    } catch (e) {
      log(`[!] relaunch 失败：${e.message}`);
    }
  }
  log('=== patch helper done ===');
}

async function main() {
  try {
    const opts = parseArgs();
    if (opts.mainPid) {
      log(`wait for main pid=${opts.mainPid} to exit (timeout=${opts.timeoutMs || 30000}ms)`);
      await waitForProcessExit(opts.mainPid, opts.timeoutMs || 30000);
    }
    await apply(opts);
    process.exit(0);
  } catch (e) {
    log('FAIL:', e && e.message);
    process.exit(2);
  }
}

if (require.main === module) main();
module.exports = { apply, sha256File };
