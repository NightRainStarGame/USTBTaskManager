#!/usr/bin/env node
/**
 * 一键发版脚本（v1.1.6 起）
 *
 * 用法：
 *   node scripts/release-one-click.js <版本号> --notes-file <path> [--execute] [--skip-build] [--no-release-page]
 *   npm run release:one -- 1.1.6 --notes-file release-notes.md --execute
 *
 * 默认 dry-run（只预览计划，不改任何东西）；加 --execute 才真正执行。
 *
 * 步骤：
 *   1. 校验版本号 + git 工作区干净
 *   2. package.json version 改为 <版本号>
 *   3. npm run build:exe（输出自动进 release-v<版本号>/，见 package.json directories.output）
 *   4. 校验 Setup exe（MZ 头 + Nullsoft 签名 + 体积 60~200MB）
 *   5. 分发目录滚动：leastversion 旧包 → oldversion（oldversion 只留这一个），新包 → leastversion/
 *   6. 更新 latest.json（version / sha256 / size / url / fileName / notes / releaseDate）
 *   7. git add -A + commit + push origin main
 *   8. （可选）创建 GitHub Release 并上传附件（--no-release-page 跳过）
 *
 * 环境要求：git 凭据里存有 GitHub token（git credential fill 可取到，repo scope）。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const asarPatch = require('./lib/asar-patch'); // v1.1.6 增量更新（块 4a）

const ROOT = path.resolve(__dirname, '..');
const REPO_RAW = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main';
const REPO_API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager';
const DIST_NAME = (v) => `TaskManager-Setup-${v}.exe`; // 仓库分发名（连字符）
const ASAR_PATH = (v) => path.join(ROOT, `release-v${v}`, 'win-unpacked', 'resources', 'app.asar');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const EXECUTE = argv.includes('--execute');
const SKIP_BUILD = argv.includes('--skip-build');
const NO_RELEASE_PAGE = argv.includes('--no-release-page');
const NO_CLOUD = argv.includes('--no-cloud');
const notesFileIdx = argv.indexOf('--notes-file');
const notesFile = notesFileIdx >= 0 ? argv[notesFileIdx + 1] : null;
const notesInlineIdx = argv.indexOf('--notes');
const notesInline = notesInlineIdx >= 0 ? argv[notesInlineIdx + 1] : null;

function die(msg) { console.error(`\n[x] ${msg}`); process.exit(1); }
function step(msg) { console.log(`\n==> ${msg}`); }
function ok(msg) { console.log(`    ✓ ${msg}`); }

if (!version) {
  console.log('用法: node scripts/release-one-click.js <X.Y.Z> --notes-file <path> [--execute] [--skip-build] [--no-release-page]');
  console.log('      npm run release:one -- 1.1.6 --notes-file notes.md --execute');
  die('缺少版本号参数（形如 1.1.6）');
}

const notes = notesInline || (notesFile && fs.existsSync(path.resolve(ROOT, notesFile))
  ? fs.readFileSync(path.resolve(ROOT, notesFile), 'utf8').trim()
  : null);
if (!notes && EXECUTE) die('缺少更新说明：用 --notes-file <path> 或 --notes "文本" 提供');

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const latestPath = path.join(ROOT, 'latest.json');
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const leastDir = path.join(ROOT, 'leastversion');
const oldDir = path.join(ROOT, 'oldversion');
const buildDir = path.join(ROOT, `release-v${version}`); // electron-builder 输出（directories.output: release-v${version}）
const artifact = path.join(buildDir, `TaskManager Setup ${version}.exe`); // builder artifactName 带空格

// ---------- dry-run 预览 ----------
step(`计划：发布 v${version}${EXECUTE ? '（--execute，真跑）' : '（dry-run 预览，不会改任何文件）'}`);
console.log(`    当前版本: ${pkg.version}  最新 manifest: ${latest.version}`);
console.log(`    构建输出: release-v${version}/TaskManager Setup ${version}.exe`);
console.log(`    分发目标: leastversion/${DIST_NAME(version)}`);
console.log(`    更新说明: ${notes ? (notesFile || '内联') + `（${notes.length} 字）` : '未提供（execute 时必填）'}`);
const dryPrevInLeast = fs.existsSync(leastDir) ? fs.readdirSync(leastDir).filter((f) => f.endsWith('.exe')) : [];
let dryPrevVersion = null;
if (dryPrevInLeast.length) {
  const m = dryPrevInLeast[0].match(/(\d+\.\d+\.\d+)\.exe$/);
  if (m) dryPrevVersion = m[1];
}
console.log(`    增量补丁（v1.1.6 块 4a）：${dryPrevVersion
  ? (asarPatch.readAsarInfo(dryPrevVersion)
    ? `将从 ${dryPrevVersion} 生成 ${dryPrevVersion}-to-${version}.zip（baseAsarSha256 已就绪）`
    : `起点版本 ${dryPrevVersion} 缓存缺失，需先 stashAsar 才能生成补丁`)
  : '首版发布，无需补丁'}`);
if (latest.version !== pkg.version) console.log(`    ⚠ latest.json(${latest.version}) 与 package.json(${pkg.version}) 不同步`);
if (!EXECUTE) { console.log('\n(dry-run 结束。确认无误后加 --execute 真正发版。)'); process.exit(0); }

// ---------- 1. 前置校验 ----------
step('前置校验');
if (version === pkg.version) die(`package.json 已经是 ${version}，是否已发过？`);
const gitStatus = run('git', ['status', '--porcelain']).trim();
if (gitStatus) {
  console.log('    工作区未提交变更:\n' + gitStatus.split('\n').slice(0, 10).map((l) => '      ' + l).join('\n'));
  die('请先提交或暂存（git stash）本地变更，保证发版提交只含发版内容');
}
ok('git 工作区干净');

// ---------- 2. bump version ----------
step(`package.json ${pkg.version} -> ${version}`);
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
ok('已写入');

// ---------- 3. build ----------
let exePath = null;
if (SKIP_BUILD) {
  step('--skip-build：跳过构建，直接找现成产物');
  const cand = [artifact, path.join(buildDir, DIST_NAME(version))];
  exePath = cand.find((p) => fs.existsSync(p));
  if (!exePath) die(`release-v${version}/ 里没有现成 Setup exe（找了 ${cand.join(' / ')}）`);
  ok(`复用 ${path.relative(ROOT, exePath)}`);
} else {
  step('npm run build:exe（预计 3~6 分钟，输出 release-v' + version + '/）');
  const r = spawnSync('npm', ['run', 'build:exe'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) die('构建失败（常见：输出目录被旧进程占用 → 换目录；429 → 稍后重试）');
  exePath = fs.existsSync(artifact) ? artifact : path.join(buildDir, DIST_NAME(version));
  if (!fs.existsSync(exePath)) die(`构建完成但找不到 ${artifact}`);
  ok(`产物 ${path.relative(ROOT, exePath)}`);
}

// ---------- 4. 校验产物 ----------
step('校验 Setup exe');
const buf = fs.readFileSync(exePath);
if (buf[0] !== 0x4d || buf[1] !== 0x5a) die('MZ 头缺失，产物损坏');
if (!buf.slice(0, 4 * 1024 * 1024).includes(Buffer.from('Nullsoft'))) die('未找到 Nullsoft 签名，可能不是 NSIS 安装包');
const sizeMB = buf.length / 1024 / 1024;
if (sizeMB < 60 || sizeMB > 200) die(`体积异常：${sizeMB.toFixed(1)}MB（预期 60~200MB）`);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
ok(`MZ + Nullsoft + ${sizeMB.toFixed(1)}MB，sha256=${sha256.slice(0, 12)}…`);

// ---------- 5. 分发目录滚动 ----------
step('分发目录滚动（保留最新两版）');
fs.mkdirSync(leastDir, { recursive: true });
fs.mkdirSync(oldDir, { recursive: true });
const prevInLeast = fs.readdirSync(leastDir).filter((f) => f.endsWith('.exe'));
let prevDistVersion = null; // 用于块 4a 补丁生成
if (prevInLeast.length) {
  // leastversion 现有包 → oldversion（oldversion 旧内容先移除，只留一个回退位）
  for (const f of fs.readdirSync(oldDir)) {
    const old = path.join(oldDir, f);
    console.log(`    移除旧回退包 ${f}`);
    fs.rmSync(old, { force: true });
  }
  for (const f of prevInLeast) {
    // 推断旧版本号（"TaskManager-Setup-1.1.5.exe" → "1.1.5"）
    const m = f.match(/(\d+\.\d+\.\d+)\.exe$/);
    if (m) prevDistVersion = m[1];
    console.log(`    ${f}: leastversion/ -> oldversion/`);
    fs.copyFileSync(path.join(leastDir, f), path.join(oldDir, f));
    fs.rmSync(path.join(leastDir, f), { force: true });
  }
} else {
  console.log('    leastversion/ 为空（首版发布）');
}
fs.copyFileSync(exePath, path.join(leastDir, DIST_NAME(version)));
ok(`leastversion/${DIST_NAME(version)} 就位`);

// ---------- 5b. v1.1.6 增量更新：asar 哈希 + 补丁 zip（块 4a） ----------
let newAsarInfo = null;
let patchInfo = null;
try {
  step('增量更新：asar 哈希 + 补丁 zip（块 4a）');
  if (!fs.existsSync(ASAR_PATH(version))) {
    throw new Error(`找不到 ${ASAR_PATH(version)}（electron-builder 输出目录变了？）`);
  }
  newAsarInfo = asarPatch.stashAsar(version, ASAR_PATH(version));
  ok(`app.asar sha256=${newAsarInfo.sha256.slice(0, 16)}… size=${(newAsarInfo.size / 1024 / 1024).toFixed(2)} MB`);

  if (prevDistVersion) {
    let fromInfo = asarPatch.readAsarInfo(prevDistVersion);
    if (!fromInfo) {
      // 缓存丢失：从旧 NSIS 包（leastversion 已滚走 → 去 oldversion/ 找）抽
      const candidates = [
        path.join(oldDir, `TaskManager-Setup-${prevDistVersion}.exe`),
        path.join(leastDir, `TaskManager-Setup-${prevDistVersion}.exe`),
      ];
      const oldNsis = candidates.find((p) => fs.existsSync(p));
      if (oldNsis) {
        console.log(`    缓存缺失，从 ${path.relative(ROOT, oldNsis)} 抽 ${prevDistVersion}.asar`);
        const r = asarPatch.extractAsarFromNsis(prevDistVersion, oldNsis);
        if (r) fromInfo = r.info;
      }
    }
    if (fromInfo) {
      const patchesDir = path.join(leastDir, 'patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      const built = asarPatch.buildPatchZip({
        fromVersion: prevDistVersion,
        fromInfo,
        toVersion: version,
        toAsarPath: ASAR_PATH(version),
        outDir: patchesDir,
      });
      patchInfo = {
        fromVersion: prevDistVersion,
        path: built.relPath,
        sha256: built.sha256,
        size: built.size,
        manifest: built.manifest,
      };
      ok(`补丁 zip -> ${built.relPath}（${(built.size / 1024 / 1024).toFixed(2)} MB，baseAsarSha256=${built.manifest.baseAsarSha256.slice(0, 12)}…）`);
    } else {
      console.log(`    [!] 历史 asar 信息缺失且无法从 NSIS 抽出，跳过补丁生成`);
    }
  } else {
    console.log('    无前一版本（first release），跳过补丁');
  }
} catch (e) {
  console.log(`    [!] 增量更新环节失败：${e.message}（不影响整装发版，App 端会回退到全量 Setup）`);
  newAsarInfo = null;
  patchInfo = null;
}

// ---------- 6. latest.json ----------
step('更新 latest.json');
const prevPatches = Array.isArray(latest.patches) ? latest.patches : [];
// 新补丁覆盖相同 fromVersion 的旧条目（一条 fromVersion 只留一个补丁）
const newPatches = patchInfo
  ? [
      ...prevPatches.filter((p) => p && p.fromVersion !== patchInfo.fromVersion),
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
      },
    ]
  : prevPatches;

latest.version = version;
latest.fileName = DIST_NAME(version);
latest.url = `${REPO_RAW}/leastversion/${DIST_NAME(version)}`;
latest.sha256 = sha256;
latest.size = buf.length;
latest.notes = notes;
latest.releaseDate = new Date().toISOString();
if (newAsarInfo) {
  latest.asarSha256 = newAsarInfo.sha256;
  latest.asarSize = newAsarInfo.size;
}
latest.patches = newPatches;
fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2) + '\n');
ok(`version=${version} url=${latest.url} patches=${newPatches.length}`);

// ---------- 7. git 提交推送 ----------
step('git 提交推送');
run('git', ['add', '-A']);
run('git', ['commit', '-m', `release: v${version}\n\n${notes.split('\n')[0]}`]);
const pushOut = run('git', ['push', 'origin', 'main']);
ok(`push 完成${pushOut.includes('up to date') ? '（无变更）' : ''}`);

// ---------- 8. GitHub Release 页（可选） ----------
if (!NO_RELEASE_PAGE) {
  step('创建 GitHub Release（失败不影响发版，可手动补）');
  try {
    const token = getToken();
    const tag = `v${version}`;
    const exists = JSON.parse(curlJson(token, `${REPO_API}/releases/tags/${tag}`, 'GET'));
    if (exists && exists.id) {
      console.log(`    Release ${tag} 已存在（id=${exists.id}），只补附件`);
    } else {
      const createBody = JSON.stringify({
        tag_name: tag, name: `TaskManager v${version}`, body: notes,
        draft: false, prerelease: false,
      });
      fs.writeFileSync(path.join(ROOT, '_rel-body.tmp.json'), createBody);
      const created = JSON.parse(curlJson(token, REPO_API + '/releases', 'POST', path.join(ROOT, '_rel-body.tmp.json')));
      if (!created.id) throw new Error(created.message || 'create failed');
      console.log(`    Release id=${created.id}`);
    }
    ok('Release 页就绪（附件上传如需，用 gh 或手动；本脚本不阻塞在此）');
  } catch (e) {
    console.log(`    [!] Release 页创建失败：${e.message}（leastversion 直链 + latest.json 已可用，不影响 App 更新）`);
  } finally {
    try { fs.rmSync(path.join(ROOT, '_rel-body.tmp.json'), { force: true }); } catch {}
  }
}

// ---------- 9. 上传到北科云盘（AnyShare 校园网内最快；可选） ----------
if (!NO_CLOUD) {
  step('上传到北科云盘（AnyShare 校园网内最快；失败不影响主流程，校园网外会超时）');
  try {
    const uploader = path.join(ROOT, 'scripts', 'upload-release-to-ustbcloud.js');
    const r = spawnSync(process.execPath, [uploader, exePath, latestPath], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    if (r.status !== 0) throw new Error(`upload-release-to-ustbcloud.js exit ${r.status}`);
    ok('北科云盘已上传 latest-<ts>.json + 安装包 <basename>-<ts>.exe');
  } catch (e) {
    console.log(`    [!] 云盘上传失败：${e.message}（GitHub + leastversion 主流程不受影响）`);
  }
}

console.log(`\n========================================\n  v${version} 发版完成\n  更新源: ${latest.url}\n  sha256: ${sha256}\n========================================`);

// ---------- helpers ----------
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}
function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execFileSync('git', ['credential', 'fill'], { input, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const m = out.match(/password=(.+)/);
  if (!m) throw new Error('git credential 里没有 GitHub token');
  return m[1].trim();
}
function curlJson(token, url, method, bodyFile) {
  const args = ['-sS', '-X', method, '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json', url];
  if (bodyFile) args.push('-d', '@' + bodyFile);
  return run('curl', args);
}
