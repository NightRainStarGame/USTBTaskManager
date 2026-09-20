/**
 * v1.1.6 增量更新 lib —— asar 哈希 + 补丁 zip 打包工具
 *
 * 设计原则（块 4a）：
 * - 补丁包内容 = 完整新 app.asar（deflate 压缩）+ manifest.json。
 *   文件级 diff 在 v1.1.6 暂不实施：完整 asar 通常也能压缩到 25~35MB；
 *   客户端只需做 rename + 落新 asar 两步（最稳，不动 asar 文件结构）。
 * - baseAsarSha256 = 「应用补丁前」客户端 app.asar 的预期 sha256。这是
 *   客户端校验基线漂移的关键 —— 任意字节不同都触发回退全量。
 * - 历史 asar 缓存：本机 `scripts/.asar-cache/<version>.asar` + 配套 `.json`
 *   （sha256/size）。clean-release.js 不动这个目录，确保跨发版都有源。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, 'scripts', '.asar-cache');
/** 7-Zip standalone（node_modules/7zip-bin/win/<arch>/7za.exe）—— 解 NSIS 安装包用 */
function sevenZipBin() {
  const candidates = [
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'ia32', '7za.exe'),
  ].filter((p) => fs.existsSync(p));
  return candidates[0] || null;
}

function ensureCache() { fs.mkdirSync(CACHE_DIR, { recursive: true }); }

function sha256File(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 把 release-v<version>/win-unpacked/resources/app.asar 拷到缓存；同时写一份 .json 信息 */
function stashAsar(version, asarPath) {
  ensureCache();
  const info = {
    version,
    sha256: sha256File(asarPath),
    size: fs.statSync(asarPath).size,
    capturedAt: Date.now(),
  };
  const dst = path.join(CACHE_DIR, `${version}.asar`);
  fs.copyFileSync(asarPath, dst);
  fs.writeFileSync(path.join(CACHE_DIR, `${version}.json`), JSON.stringify(info, null, 2));
  return info;
}

/** 读取历史 asar 信息；不存在返回 null */
function readAsarInfo(version) {
  const fp = path.join(CACHE_DIR, `${version}.json`);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
}

/**
 * 从 NSIS 安装包里抽出 resources/app.asar 并写到缓存（带 info）。
 * 用途：本机的 release-v* 目录被清空后，仍能从 leastversion/*.exe 恢复。
 *
 * @returns { info, asarPath } 或 null（无 7z / NSIS 找不到 app.asar 时）
 */
function extractAsarFromNsis(version, nsisPath) {
  if (!nsisPath || !fs.existsSync(nsisPath)) {
    console.log(`    [!] extractAsarFromNsis: NSIS 不存在 ${nsisPath}`);
    return null;
  }
  const sevenZip = sevenZipBin();
  if (!sevenZip) {
    console.log('    [!] extractAsarFromNsis: 未找到 7zip-bin/win/x64/7za.exe，无法抽 asar');
    return null;
  }
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), `taskmgr-extract-${Date.now()}-`));
  try {
    const r = spawnSync(sevenZip, ['x', '-y', `-o${tmp}`, nsisPath, 'resources/app.asar'], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`    [!] 7za 抽 asar 失败 (exit=${r.status}): ${(r.stderr || r.stdout || '').slice(0, 200)}`);
      return null;
    }
    const extracted = path.join(tmp, 'resources', 'app.asar');
    if (!fs.existsSync(extracted)) {
      console.log('    [!] 7za 抽完没找到 resources/app.asar —— NSIS 包格式可能变了');
      return null;
    }
    const info = stashAsar(version, extracted);
    return { info, asarPath: path.join(CACHE_DIR, `${version}.asar`) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp 残留可接受 */ }
  }
}

/** 列出缓存里所有 version（升序） */
function listCachedVersions() {
  ensureCache();
  return fs.readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.split('.').map(Number).reduce((acc, n, i) => acc * 1000 + n, 0)
      - b.split('.').map(Number).reduce((acc, n, i) => acc * 1000 + n, 0));
}

/**
 * 生成补丁 zip（只含完整新 asar + manifest）
 *
 * @param opts.fromVersion  起点版本（客户端当前的版本）
 * @param opts.fromInfo     起点 asar 信息（{ sha256, size }）；stale 时不传
 * @param opts.toVersion    终点版本
 * @param opts.toAsarPath   新 app.asar 路径
 * @param opts.outDir       输出目录（应指向 leastversion/patches/）
 * @returns patch zip 路径 + meta { sha256, size, appAsarSha256, appAsarSize }
 */
function buildPatchZip(opts) {
  const { fromVersion, fromInfo, toVersion, toAsarPath, outDir } = opts;
  if (!fromVersion || !fromInfo) throw new Error('fromVersion + fromInfo 必填（用作 baseAsarSha256）');
  if (!toVersion || !toAsarPath || !fs.existsSync(toAsarPath)) throw new Error('toVersion + toAsarPath 必填且文件存在');
  fs.mkdirSync(outDir, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), `taskmgr-patch-${Date.now()}-`));
  try {
    // 拷贝新 asar
    const asarInZip = path.join(tmpDir, 'app.asar');
    fs.copyFileSync(toAsarPath, asarInZip);

    // 计算 to 信息
    const toInfo = { sha256: sha256File(toAsarPath), size: fs.statSync(toAsarPath).size };
    const manifest = {
      schema: 'taskmanager-patch-v1',
      fromVersion,
      toVersion,
      baseAsarSha256: fromInfo.sha256,
      baseAsarSize: fromInfo.size,
      appAsarSha256: toInfo.sha256,
      appAsarSize: toInfo.size,
      createdAt: Date.now(),
      createdIso: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 输出 zip（v1.1.7 命名范式：TaskManager-Patch-<from>-to-<to>.zip）
    const zipPath = path.join(outDir, `TaskManager-Patch-${fromVersion}-to-${toVersion}.zip`);
    // Windows 自带 PowerShell Compress-Archive（5.1 是只 zip 不能选等级，但够用）
    const psCmd = `Compress-Archive -Path '${asarInZip}','${path.join(tmpDir, 'manifest.json').replace(/'/g, "''")}' -DestinationPath '${zipPath}' -CompressionLevel Fastest -Force`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`PowerShell Compress-Archive 失败: ${r.stderr || r.stdout}`);
    if (!fs.existsSync(zipPath)) throw new Error('zip 未生成');

    const zipBuf = fs.readFileSync(zipPath);
    const zipSha = crypto.createHash('sha256').update(zipBuf).digest('hex');
    return {
      path: zipPath,
      relPath: path.relative(ROOT, zipPath),
      sha256: zipSha,
      size: zipBuf.length,
      manifest,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* tmp 残留可接受 */ }
  }
}

/** 解析补丁 zip + 校验 manifest */
function verifyPatch(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const zipSha = crypto.createHash('sha256').update(buf).digest('hex');
  // 解压用 PowerShell Expand-Archive
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'taskmgr-patch-verify-'));
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force`], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('解压失败');
    const manifest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf8'));
    const asarPath = path.join(tmpDir, 'app.asar');
    if (!fs.existsSync(asarPath)) throw new Error('zip 缺少 app.asar');
    const asarSha = sha256File(asarPath);
    const asarSize = fs.statSync(asarPath).size;
    return {
      zipSha256: zipSha,
      zipSize: buf.length,
      manifest,
      asarSha256: asarSha,
      asarSize,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = {
  CACHE_DIR,
  sha256File,
  stashAsar,
  readAsarInfo,
  listCachedVersions,
  extractAsarFromNsis,
  buildPatchZip,
  verifyPatch,
};
