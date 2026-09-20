// 手跑发版剩余步骤：step 5+（滚动已手动完成）
// usage: node scripts/_run_release_remainder.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const version = '1.1.6';
const DIST_NAME = (v) => `TaskManager-Setup-${v}.exe`;
const REPO_RAW = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main';
const REPO_API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager';

const asarPatch = require('./lib/asar-patch');

const leastDir = path.join(ROOT, 'leastversion');
const oldDir = path.join(ROOT, 'oldversion');
const buildDir = path.join(ROOT, `release-v${version}`);
const artifact = path.join(buildDir, `TaskManager Setup ${version}.exe`);
const leastExe = path.join(leastDir, DIST_NAME(version));
const oldExe = path.join(oldDir, DIST_NAME('1.1.5'));

if (!fs.existsSync(leastExe)) {
  console.error(`[x] ${leastExe} 不存在`);
  process.exit(1);
}
if (!fs.existsSync(oldExe)) {
  console.warn(`[!] ${oldExe} 不存在，跳过 patch 生成`);
}

// ============ 生成增量补丁 ============
let patchInfo = null;
let newAsarInfo = null;
const asarPath = path.join(buildDir, 'win-unpacked', 'resources', 'app.asar');
if (fs.existsSync(asarPath) && fs.existsSync(oldExe)) {
  console.log('==> 生成增量补丁 1.1.5 -> 1.1.6');
  let fromInfo = asarPatch.readAsarInfo('1.1.5');
  if (!fromInfo) {
    // 从旧 NSIS 抽
    const r = asarPatch.extractAsarFromNsis('1.1.5', oldExe);
    if (r) fromInfo = r.info;
  }
  // lib 没提供 computeAsarInfo；用 sha256File + fs.statSync 替代
  const newAsarSha = asarPatch.sha256File(asarPath);
  newAsarInfo = { sha256: newAsarSha, size: fs.statSync(asarPath).size };
  if (fromInfo && newAsarInfo) {
    const patchesDir = path.join(leastDir, 'patches');
    fs.mkdirSync(patchesDir, { recursive: true });
    const built = asarPatch.buildPatchZip({
      fromVersion: '1.1.5',
      fromInfo,
      toVersion: version,
      toAsarPath: asarPath,
      outDir: patchesDir,
    });
    patchInfo = {
      fromVersion: '1.1.5',
      path: built.relPath,
      sha256: built.sha256,
      size: built.size,
      manifest: built.manifest,
    };
    console.log(`    ✓ patch zip -> ${built.relPath}（${(built.size / 1024 / 1024).toFixed(2)} MB）`);
  }
}

// ============ 写 latest.json ============
console.log('==> 写 latest.json');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(leastExe)).digest('hex');
const size = fs.statSync(leastExe).size;
const notes = fs.readFileSync(path.join(ROOT, 'RELEASE-NOTES-1.1.6.md'), 'utf8').trim();
const latestPath = path.join(ROOT, 'latest.json');
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const prevPatches = Array.isArray(latest.patches) ? latest.patches : [];
const newPatches = patchInfo
  ? [...prevPatches.filter((p) => p && p.fromVersion !== patchInfo.fromVersion),
     {
       fromVersion: patchInfo.fromVersion,
       url: `${REPO_RAW}/${patchInfo.path.replace(/\\/g, '/')}`,
       sha256: patchInfo.sha256,
       size: patchInfo.size,
       baseAsarSha256: patchInfo.manifest.baseAsarSha256,
       baseAsarSize: patchInfo.manifest.baseAsarSize,
       appAsarSha256: patchInfo.manifest.appAsarSha256,
       appAsarSize: patchInfo.manifest.appAsarSize,
       createdAt: patchInfo.manifest.createdIso,
     }]
  : prevPatches;
latest.version = version;
latest.fileName = DIST_NAME(version);
latest.url = `${REPO_RAW}/leastversion/${DIST_NAME(version)}`;
latest.sha256 = sha256;
latest.size = size;
latest.notes = notes;
latest.releaseDate = new Date().toISOString();
if (newAsarInfo) {
  latest.asarSha256 = newAsarInfo.sha256;
  latest.asarSize = newAsarInfo.size;
}
latest.patches = newPatches;
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
console.log(`    ✓ version=${version} url=${latest.url} sha256=${sha256.slice(0, 16)}… patches=${newPatches.length}`);

// ============ git commit + push ============
console.log('==> git commit + push');
function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
}
run('git', ['add', '-A']);
run('git', ['commit', '-m', `release: v${version}\n\n${notes.split('\n')[0]}`]);
const pushOut = run('git', ['push', 'origin', 'main']);
console.log(`    ✓ push 完成${pushOut.includes('up to date') ? '（无变更）' : ''}`);

// ============ GitHub Release ============
console.log('==> GitHub Release');
function getToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const m = out.match(/password=(.+)/);
  if (!m) throw new Error('git credential 没有 GitHub token');
  return m[1].trim();
}
function curlJson(token, url, method, bodyFile) {
  const args = ['-sS', '-X', method, '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json', url];
  if (bodyFile) args.push('-d', '@' + bodyFile);
  return run('curl', args);
}
try {
  const token = getToken();
  const tag = `v${version}`;
  const exists = JSON.parse(curlJson(token, `${REPO_API}/releases/tags/${tag}`, 'GET'));
  if (exists && exists.id) {
    console.log(`    Release ${tag} 已存在（id=${exists.id}），跳过`);
  } else {
    const body = JSON.stringify({
      tag_name: tag, name: `TaskManager v${version}`, body: notes,
      draft: false, prerelease: false,
    });
    const bodyFile = path.join(ROOT, '_rel-body.tmp.json');
    fs.writeFileSync(bodyFile, body);
    const created = JSON.parse(curlJson(token, REPO_API + '/releases', 'POST', bodyFile));
    if (!created.id) throw new Error(created.message || 'create failed');
    console.log(`    ✓ Release id=${created.id}（用 gh release upload 或 Releases 页面手动补附件）`);
  }
} catch (e) {
  console.log(`    [!] Release 页失败：${e.message}`);
} finally {
  try { fs.rmSync(path.join(ROOT, '_rel-body.tmp.json'), { force: true }); } catch {}
}

// ============ 北科云盘上传 ============
console.log('==> 北科云盘上传');
const uploaderScript = path.join(ROOT, 'scripts', 'upload-release-to-ustbcloud.js');
const r = spawnSync(process.execPath, [uploaderScript, leastExe, latestPath], {
  cwd: ROOT, stdio: 'inherit',
});
if (r.status !== 0) console.log(`    [!] 云盘上传 exit ${r.status}（不影响其他源）`);

console.log(`\n========================================\n  v${version} 发版完成\n  更新源: ${latest.url}\n  sha256: ${sha256}\n========================================`);