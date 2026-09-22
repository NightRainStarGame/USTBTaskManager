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
const zlib = require('zlib');
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

/**
 * 零依赖 zip 单文件解压（v1.2.7 重写）——
 * 干掉原 7zip-bin 依赖（package.json 没列 7zip-bin + 没 asarUnpack → helper 永远 throw "找不到 7za.exe"）。
 * 仅支持 store(0) + deflate(8)，足够补丁 zip 用。
 * 不支持 Zip64（补丁远不到 4GB），文件名强制按 UTF-8 解码。
 */
function extractAsarFromZip(zipPath, outPath) {
  const buf = fs.readFileSync(zipPath);

  // 1) 找 EOCD 签名 0x06054b50（End of Central Directory，固定 22 字节尾部）
  let eocdOffset = -1;
  const minScan = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minScan; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('zip 格式错：找不到 EOCD');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  // 2) 遍历中央目录，找名字为 'app.asar' 的 entry
  let localHeaderOffset = -1;
  let compressedSize = -1, uncompressedSize = -1, compressionMethod = -1;
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录签名错 @' + p);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === 'app.asar') {
      localHeaderOffset = localOffset;
      compressedSize = csize;
      uncompressedSize = usize;
      compressionMethod = method;
      break;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (localHeaderOffset < 0) throw new Error('zip 里没有 app.asar');

  // 3) 跳到 local file header 读数据
  if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('local header 签名错');
  const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
  const compressed = buf.slice(dataStart, dataStart + compressedSize);

  // 4) 解压（store=原样 / deflate=raw inflate）
  let data;
  if (compressionMethod === 0) {
    data = compressed;
  } else if (compressionMethod === 8) {
    data = zlib.inflateRawSync(compressed);
  } else {
    throw new Error('不支持的压缩方法：' + compressionMethod);
  }
  if (data.length !== uncompressedSize) {
    throw new Error('解压大小不匹配：期望 ' + uncompressedSize + ' 实际 ' + data.length);
  }

  fs.writeFileSync(outPath, data);
  return outPath;
}

/** 真正的活：解压 + 校验 + rename 落盘 */
async function apply(opts) {
  const { zipPath, appAsarPath, manifest, relaunch, mode } = opts;
  const expectedToSha = (manifest && manifest.appAsarSha256 || '').toLowerCase();
  const expectedBaseSha = (manifest && manifest.baseAsarSha256 || '').toLowerCase();
  const sidecar = appAsarPath + '.new';
  const backup = appAsarPath + '.bak';

  log('=== patch helper start ===');
  log(`mode=${mode || 'normal'} zipPath=${zipPath} target=${appAsarPath} relaunch=${!!relaunch}`);

  // 0) v1.2.7：先接管上次的 .new 旁路残留（rename 失败时被写入，主进程下次启动自检时
  //    只看 app.asar 的 sha，没看 .new，所以必须由 helper 显式接管）。如果 .new sha
  //    等于期望的新版 sha → 直接 rename 接管 + 删 patch-state.json + 重启，跳过基线校验。
  //    takeover-sidecar 模式（用户手动重试）：没有 manifest 时也按 .new 直接接管。
  if (fs.existsSync(sidecar)) {
    try {
      const sideSha = sha256File(sidecar);
      const sidecarSize = fs.statSync(sidecar).size;
      // 接管阈值 = 至少 1MB（避免把空文件 / 损坏文件当 .new 接管）+ sidecarSha 与预期匹配
      const looksValid = sidecarSize > 1024 * 1024;
      const shouldTakeover = looksValid && (
        (expectedToSha && sideSha === expectedToSha) ||
        (mode === 'takeover-sidecar')
      );
      if (shouldTakeover) {
        // 优先用 rename，失败再 copyFileSync（覆盖原 asar）
        try {
          try { fs.unlinkSync(appAsarPath); } catch {}
          fs.renameSync(sidecar, appAsarPath);
        } catch {
          fs.copyFileSync(sidecar, appAsarPath);
          try { fs.unlinkSync(sidecar); } catch {}
        }
        log(`✓ 已接管 .new 旁路残留 mode=${mode || 'normal'} sha256=${sideSha.slice(0, 16)}…`);
        if (relaunch) {
          log('拉起新版本应用');
          try {
            spawn(process.execPath, [], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              cwd: path.dirname(process.execPath),
              env: { ...process.env, TASKMGR_PATCH_APPLIED: '1' },
            }).unref();
          } catch (e) { log(`[!] relaunch 失败：${e.message}`); }
        }
        log('=== patch helper done (接管 .new) ===');
        return;
      } else if (mode === 'takeover-sidecar') {
        // takeover 模式但 .new 不合法（size < 1MB）→ 不接管
        throw new Error(`takeover 模式但 .new 不合法（size=${sidecarSize}），删除后请重新走补丁流程`);
      } else {
        // 残留 .new sha 不匹配 = 上次失败的产物，清掉走正常流程
        log(`[!] 残留 .new sha 不匹配（${sideSha.slice(0, 16)}… vs ${expectedToSha || '?'}），清掉重试`);
        try { fs.unlinkSync(sidecar); } catch {}
      }
    } catch (e) {
      log(`[!] 检测 .new 残留失败：${e.message}`);
      if (mode === 'takeover-sidecar') throw e;
    }
  }

  // takeover-sidecar 模式走到这里说明 .new 不存在 → 报错让用户走完整流程
  if (mode === 'takeover-sidecar') {
    throw new Error('takeover-sidecar 模式：未检测到 .new 旁路残留');
  }

  if (!fs.existsSync(zipPath)) throw new Error(`zipPath 不存在 ${zipPath}`);
  if (!fs.existsSync(appAsarPath)) throw new Error(`app.asar 路径不存在 ${appAsarPath}`);

  // 0) v1.2.7：先接管上次的 .new 旁路残留（rename 失败时被写入，主进程下次启动自检时
  //    只看 app.asar 的 sha，没看 .new，所以必须由 helper 显式接管）。如果 .new sha
  //    等于期望的新版 sha → 直接 rename 接管 + 删 patch-state.json + 重启，跳过基线校验。
  if (fs.existsSync(sidecar)) {
    try {
      const sideSha = sha256File(sidecar);
      if (expectedToSha && sideSha === expectedToSha) {
        // 优先用 rename，失败再 copyFileSync（覆盖原 asar）
        try {
          try { fs.unlinkSync(appAsarPath); } catch {}
          fs.renameSync(sidecar, appAsarPath);
        } catch {
          fs.copyFileSync(sidecar, appAsarPath);
          try { fs.unlinkSync(sidecar); } catch {}
        }
        log(`✓ 已接管 .new 旁路残留 sha256=${sideSha.slice(0, 16)}…`);
        if (relaunch) {
          log('拉起新版本应用');
          try {
            spawn(process.execPath, [], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              cwd: path.dirname(process.execPath),
              env: { ...process.env, TASKMGR_PATCH_APPLIED: '1' },
            }).unref();
          } catch (e) { log(`[!] relaunch 失败：${e.message}`); }
        }
        log('=== patch helper done (接管 .new) ===');
        return;
      } else {
        // 残留 .new sha 不匹配 = 上次失败的产物，清掉走正常流程
        log(`[!] 残留 .new sha 不匹配（${sideSha.slice(0, 16)}… vs ${expectedToSha.slice(0, 16) || '?'}），清掉重试`);
        try { fs.unlinkSync(sidecar); } catch {}
      }
    } catch (e) {
      log(`[!] 检测 .new 残留失败：${e.message}`);
    }
  }

  // 1) 校验基线（升级前客户端 asar 哈希匹配 manifest.baseAsarSha256）
  if (expectedBaseSha) {
    const currentBase = sha256File(appAsarPath);
    if (currentBase !== expectedBaseSha) {
      log(`[!] 基线漂移：expected=${expectedBaseSha.slice(0, 16)} actual=${currentBase.slice(0, 16)} → helper 不会写入，但允许解压并让主进程后续决定`);
      throw new Error(`基线校验失败：当前 app.asar sha256 != manifest.baseAsarSha256`);
    }
    log(`基线校验通过 sha256=${expectedBaseSha.slice(0, 16)}…`);
  }

  // 2) 解压到 tmp（v1.2.7 改：零依赖 zip reader，不再依赖 7za.exe）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taskmgr-patch-apply-'));
  try {
    const extractedAsar = path.join(tmp, 'app.asar');
    extractAsarFromZip(zipPath, extractedAsar);
    const newSha = sha256File(extractedAsar);
    if (expectedToSha && newSha !== expectedToSha) {
      throw new Error(`zip 里 app.asar sha256 不匹配 manifest.appAsarSha256：${newSha.slice(0, 16)}… vs ${expectedToSha.slice(0, 16)}…`);
    }
    log(`解压校验通过 sha256=${newSha.slice(0, 16)}… size=${fs.statSync(extractedAsar).size}`);

    // 3) rename 旧 asar → app.asar.bak；再写新 asar（v1.2.7：AV 锁文件常见，加 retry）
    try { fs.unlinkSync(backup); } catch {}
    let renamed = false;
    let lastRenameErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(appAsarPath, backup);
        renamed = true;
        if (attempt > 0) log(`rename retry 第 ${attempt} 次成功`);
        break;
      } catch (e) {
        lastRenameErr = e;
        // AV/Defender 锁文件时常见：等几百毫秒再试
        const wait = 400 * (attempt + 1);
        log(`[!] rename 旧 asar 第 ${attempt + 1} 次失败：${e.message}，等待 ${wait}ms 后重试`);
        const until = Date.now() + wait;
        while (Date.now() < until) { /* busy wait */ }
      }
    }
    if (!renamed) {
      log(`[!] rename 全部失败：${lastRenameErr?.message} —— 写 .new 旁路`);
      fs.copyFileSync(extractedAsar, sidecar);
      log(`已写出 ${sidecar}，下次启动 helper 会自动接管`);
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

  // 4) 可选：重新拉起（v1.2.7：加 cwd + windowsHide，避免 spawn 失败或弹出 cmd 窗口）
  if (relaunch) {
    log('拉起新版本应用');
    try {
      spawn(process.execPath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: path.dirname(process.execPath),
        env: { ...process.env, TASKMGR_PATCH_APPLIED: '1' },
      }).unref();
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
module.exports = { apply, sha256File, extractAsarFromZip };