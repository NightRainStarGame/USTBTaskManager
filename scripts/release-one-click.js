#!/usr/bin/env node
/**
 * 一键发版
 *
 * 用法：
 *   node scripts/release-one-click.js <X.Y.Z> --notes-file <path> [--execute] [--skip-build] [--resume]
 *   npm run release:one -- 1.1.7 --notes-file notes.md --execute
 *
 * 默认 dry-run。加 --execute 才真跑。
 *
 * 步骤：
 *   1. 校验版本号 + git 工作区干净
 *   2. package.json version → <X.Y.Z>
 *   3. npm run build:exe（输出 release-v<版本号>/）
 *   4. 校验 Setup exe（MZ 头 + Nullsoft + 体积 60~200MB）
 *   5. 滚动 leastversion/oldversion；写入新包
 *   5b. asar 哈希 + 增量补丁 zip（首版或缓存缺失则跳过）
 *   6. 重写 latest.json（version/sha256/url/notes/asarSha256/patches）
 *   7. git commit + push
 *   8. 创建/补全 GitHub Release + 上传 Setup exe 和 patch zip（幂等）
 *   9. 上传到北科云盘（需校园网；失败不影响主流程）
 *
 * --resume 自动跳过 build；产物 sha256 与 latest.json 对齐时跳过写盘。
 * 续跑幂等：commit / Release / 附件 / 云盘 --all 全部可重入。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const asarPatch = require('./lib/asar-patch');

const ROOT = path.resolve(__dirname, '..');
const REPO_RAW = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main';
const REPO_API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager';
const DIST_NAME = (v) => `TaskManager-Setup-${v}.exe`;
// RELEASE_SUFFIX 让 buildDir 和 ASAR_PATH 同时偏移（绕开 safe-delete 卡死的旧产物）
const REL_SUFFIX = process.env.RELEASE_SUFFIX || '';
const ASAR_PATH = (v) => path.join(ROOT, `release-v${v}${REL_SUFFIX}`, 'win-unpacked', 'resources', 'app.asar');

const argv = process.argv.slice(2);
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const EXECUTE = argv.includes('--execute');
let SKIP_BUILD = argv.includes('--skip-build');
const NO_RELEASE_PAGE = argv.includes('--no-release-page');
const NO_CLOUD = argv.includes('--no-cloud');
const RESUME = argv.includes('--resume');
const notesFileIdx = argv.indexOf('--notes-file');
const notesFile = notesFileIdx >= 0 ? argv[notesFileIdx + 1] : null;
const notesInlineIdx = argv.indexOf('--notes');
const notesInline = notesInlineIdx >= 0 ? argv[notesInlineIdx + 1] : null;

function die(msg) { console.error(`\n[x] ${msg}`); process.exit(1); }
function step(msg) { console.log(`\n==> ${msg}`); }
function ok(msg) { console.log(`    ✓ ${msg}`); }

if (!version) {
  console.log('用法: node scripts/release-one-click.js <X.Y.Z> --notes-file <path> [--execute] [--skip-build] [--no-release-page] [--no-cloud] [--resume]');
  die('缺少版本号参数');
}

const notes = notesInline || (notesFile && fs.existsSync(path.resolve(ROOT, notesFile))
  ? fs.readFileSync(path.resolve(ROOT, notesFile), 'utf8').trim()
  : null);
if (!notes && EXECUTE) die('缺少更新说明：用 --notes-file <path> 或 --notes "文本"');

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const latestPath = path.join(ROOT, 'latest.json');
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const leastDir = path.join(ROOT, 'leastversion');
const oldDir = path.join(ROOT, 'oldversion');
const buildDir = path.join(ROOT, `release-v${version}${REL_SUFFIX}`);
const artifact = path.join(buildDir, `TaskManager Setup ${version}.exe`);

step(`计划：发布 v${version}${EXECUTE ? '（--execute）' : '（dry-run）'}`);
console.log(`    当前版本: ${pkg.version}  最新 manifest: ${latest.version}`);
console.log(`    构建输出: release-v${version}/TaskManager Setup ${version}.exe`);
console.log(`    分发目标: leastversion/${DIST_NAME(version)}`);
console.log(`    更新说明: ${notes ? (notesFile || '内联') + `（${notes.length} 字）` : '未提供'}`);
const dryPrevInLeast = fs.existsSync(leastDir) ? fs.readdirSync(leastDir).filter((f) => f.endsWith('.exe')) : [];
let dryPrevVersion = null;
if (dryPrevInLeast.length) {
  const m = dryPrevInLeast[0].match(/(\d+\.\d+\.\d+)\.exe$/);
  if (m) dryPrevVersion = m[1];
}
console.log(`    增量补丁：${dryPrevVersion
  ? (asarPatch.readAsarInfo(dryPrevVersion)
    ? `从 ${dryPrevVersion} 生成 ${dryPrevVersion}-to-${version}.zip`
    : `起点版本 ${dryPrevVersion} 缓存缺失，需先 stashAsar`)
  : '首版发布'}`);
if (latest.version !== pkg.version) console.log(`    ⚠ latest.json(${latest.version}) 与 package.json(${pkg.version}) 不同步`);
if (!EXECUTE) { console.log('\n(dry-run 结束。加 --execute 真正发版。)'); process.exit(0); }

step('前置校验');
if (version !== pkg.version) { console.log(`  (pkg.version=${pkg.version} -> ${version})`); }
const gitStatus = run('git', ['status', '--porcelain']).trim();
if (gitStatus) {
  console.log('    工作区未提交变更:\n' + gitStatus.split('\n').slice(0, 10).map((l) => '      ' + l).join('\n'));
  die('请先提交或暂存本地变更');
}
ok('git 工作区干净');

step(`package.json ${pkg.version} -> ${version}`);
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
ok('已写入');

let exePath = null;
// --resume 一律跳过 build：leastversion/ 已有目标 exe 就复用；否则用 release-v<v>/ 里的产物
if (RESUME && !SKIP_BUILD) {
  SKIP_BUILD = true;
  const leastExe = path.join(leastDir, DIST_NAME(version));
  if (fs.existsSync(leastExe)) {
    console.log(`    [resume] leastversion/ 已有 ${DIST_NAME(version)}，复用`);
  } else {
    console.log(`    [resume] 复用 release-v${version}/ 里的现成产物`);
  }
}
if (SKIP_BUILD) {
  step('--skip-build：复用现成产物');
  const cand = [artifact, path.join(buildDir, DIST_NAME(version))];
  exePath = cand.find((p) => fs.existsSync(p));
  if (!exePath) die(`release-v${version}/ 里没有现成 Setup exe`);
  ok(`复用 ${path.relative(ROOT, exePath)}`);
} else {
  step('npm run build:exe（预计 3~6 分钟）');
  const r = spawnSync('npm', ['run', 'build:exe'], { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) die('构建失败（输出目录被旧进程占用 → 换目录；429 → 稍后重试）');
  exePath = fs.existsSync(artifact) ? artifact : path.join(buildDir, DIST_NAME(version));
  if (!fs.existsSync(exePath)) die(`构建完成但找不到 ${artifact}`);
  ok(`产物 ${path.relative(ROOT, exePath)}`);
}

step('校验 Setup exe');
const buf = fs.readFileSync(exePath);
if (buf[0] !== 0x4d || buf[1] !== 0x5a) die('MZ 头缺失，产物损坏');
if (!buf.slice(0, 4 * 1024 * 1024).includes(Buffer.from('Nullsoft'))) die('未找到 Nullsoft 签名，可能不是 NSIS 安装包');
const sizeMB = buf.length / 1024 / 1024;
if (sizeMB < 60 || sizeMB > 200) die(`体积异常：${sizeMB.toFixed(1)}MB`);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
ok(`MZ + Nullsoft + ${sizeMB.toFixed(1)}MB，sha256=${sha256.slice(0, 12)}…`);

step('分发目录滚动（保留最新两版）');
fs.mkdirSync(leastDir, { recursive: true });
fs.mkdirSync(oldDir, { recursive: true });
const prevInLeast = fs.readdirSync(leastDir).filter((f) => f.endsWith('.exe'));
let prevDistVersion = null;
// safe-delete 容错：host shim 可能拦 rm，失败仅 warn 不致命（新包已就位，leastversion 直链可用）
function safeRemove(p, label) {
  try { fs.rmSync(p, { force: true }); }
  catch (e) { console.log(`    [!] ${label || path.basename(p)} 清理失败：${e.message.split('\n')[0]}`); }
}
if (prevInLeast.length) {
  for (const f of fs.readdirSync(oldDir)) {
    console.log(`    移除旧回退包 ${f}`);
    safeRemove(path.join(oldDir, f), `oldversion/${f}`);
  }
  for (const f of prevInLeast) {
    const m = f.match(/(\d+\.\d+\.\d+)\.exe$/);
    if (m) prevDistVersion = m[1];
    console.log(`    ${f}: leastversion/ -> oldversion/`);
    fs.copyFileSync(path.join(leastDir, f), path.join(oldDir, f));
    safeRemove(path.join(leastDir, f), `leastversion/${f}`);
  }
} else {
  console.log('    leastversion/ 为空（首版发布）');
}
fs.copyFileSync(exePath, path.join(leastDir, DIST_NAME(version)));
ok(`leastversion/${DIST_NAME(version)} 就位`);

let newAsarInfo = null;
let patchInfo = null;
try {
  step('增量更新：asar 哈希 + 补丁 zip');
  if (!fs.existsSync(ASAR_PATH(version))) {
    throw new Error(`找不到 ${ASAR_PATH(version)}`);
  }
  // v1.2.3 重发支持：stash 前把已有同版本缓存备份为 <version>-pre（作为「旧version → 新version」补丁基线）
  {
    const cacheAsar = path.join(asarPatch.CACHE_DIR, `${version}.asar`);
    const cacheJson = path.join(asarPatch.CACHE_DIR, `${version}.json`);
    if (fs.existsSync(cacheAsar)) {
      fs.copyFileSync(cacheAsar, path.join(asarPatch.CACHE_DIR, `${version}-pre.asar`));
      if (fs.existsSync(cacheJson)) {
        fs.copyFileSync(cacheJson, path.join(asarPatch.CACHE_DIR, `${version}-pre.json`));
      }
      console.log(`    已备份旧缓存 → ${version}-pre.asar（重发基线，保留回退）`);
    }
  }
  newAsarInfo = asarPatch.stashAsar(version, ASAR_PATH(version));
  ok(`app.asar sha256=${newAsarInfo.sha256.slice(0, 16)}…`);

  // 防自指：prevDistVersion 来自 leastversion/，跳过 prevDistVersion === version
  if (prevDistVersion && prevDistVersion !== version) {
    let fromInfo = asarPatch.readAsarInfo(prevDistVersion);
    if (!fromInfo) {
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
      ok(`补丁 zip -> ${built.relPath}`);
    } else {
      console.log(`    [!] 历史 asar 信息缺失且无法从 NSIS 抽出，跳过补丁`);
    }
  } else if (prevDistVersion === version) {
    // v1.2.3 重发场景：同版本号重打包 —— 用重发前备份（<version>-pre）作基线生成补丁。
    // updater 已支持「同版本号但 asar 哈希不同 → 有更新」（d28d1eb），fromVersion 允许等于 version。
    const preInfo = asarPatch.readAsarInfo(`${version}-pre`);
    if (preInfo && fs.existsSync(path.join(asarPatch.CACHE_DIR, `${version}-pre.asar`))) {
      const patchesDir = path.join(leastDir, 'patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      const built = asarPatch.buildPatchZip({
        fromVersion: version, // 旧 version（pre 基线）
        fromInfo: preInfo,
        toVersion: version,   // 新 version（刚 stash 的）
        toAsarPath: ASAR_PATH(version),
        outDir: patchesDir,
      });
      patchInfo = {
        fromVersion: version,
        path: built.relPath,
        sha256: built.sha256,
        size: built.size,
        manifest: built.manifest,
      };
      ok(`重发补丁 zip -> ${built.relPath}`);
    } else {
      console.log(`    [!] prevDistVersion === version 且无 ${version}-pre 备份，跳过自指补丁`);
    }
  } else {
    console.log('    无前一版本（first release），跳过补丁');
  }
} catch (e) {
  console.log(`    [!] 增量更新失败：${e.message}（不影响整装发版）`);
  newAsarInfo = null;
  patchInfo = null;
}

step('更新 latest.json');
const prevPatches = Array.isArray(latest.patches) ? latest.patches : [];
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
const newLatestContent = JSON.stringify(latest, null, 2) + '\n';
const oldLatestContent = fs.readFileSync(latestPath, 'utf8');
if (newLatestContent === oldLatestContent) {
  console.log('    latest.json 内容未变（--resume 跳过写盘）');
} else {
  fs.writeFileSync(latestPath, newLatestContent);
}
ok(`version=${version} url=${latest.url} patches=${newPatches.length}`);

step('git 提交推送');
run('git', ['add', '-A']);
run('git', ['commit', '-m', `release: v${version}\n\n${notes.split('\n')[0]}`]);
const pushOut = run('git', ['push', 'origin', 'main']);
ok(`push 完成${pushOut.includes('up to date') ? '（无变更）' : ''}`);

if (!NO_RELEASE_PAGE) {
  step('创建 GitHub Release + 上传附件');
  try {
    const token = getToken();
    const tag = `v${version}`;
    let releaseId = null;
    const exists = JSON.parse(curlJson(token, `${REPO_API}/releases/tags/${tag}`, 'GET'));
    if (exists && exists.id) {
      releaseId = exists.id;
      console.log(`    Release ${tag} 已存在（id=${releaseId}），补附件`);
    } else {
      const createBody = JSON.stringify({
        tag_name: tag, name: `TaskManager v${version}`, body: notes,
        draft: false, prerelease: false,
      });
      fs.writeFileSync(path.join(ROOT, '_rel-body.tmp.json'), createBody);
      const created = JSON.parse(curlJson(token, REPO_API + '/releases', 'POST', path.join(ROOT, '_rel-body.tmp.json')));
      if (!created.id) throw new Error(created.message || 'create failed');
      releaseId = created.id;
      console.log(`    Release id=${releaseId}`);
    }

    let existingNames = new Set();
    try {
      const assetsJson = curlJson(token, `${REPO_API}/releases/${releaseId}/assets?per_page=100`, 'GET');
      const arr = JSON.parse(assetsJson);
      if (Array.isArray(arr)) existingNames = new Set(arr.map((a) => a.name));
      if (existingNames.size) console.log(`    已有附件 ${existingNames.size} 个：${[...existingNames].join(', ')}`);
    } catch (e) {
      console.log(`    [!] 拉取附件列表失败：${e.message}`);
    }

    const assetsToUpload = [
      { path: path.join(leastDir, DIST_NAME(version)), name: DIST_NAME(version), type: 'application/octet-stream' },
    ];
    if (patchInfo) {
      assetsToUpload.push({
        path: path.join(ROOT, patchInfo.path),
        name: path.basename(patchInfo.path),
        type: 'application/zip',
      });
    }
    for (const a of assetsToUpload) {
      if (!fs.existsSync(a.path)) {
        console.log(`    [!] 附件不存在，跳过 ${a.name}`);
        continue;
      }
      if (existingNames.has(a.name)) {
        // v1.2.3 重发支持：删除同名旧附件后重传（否则 Release 页会一直挂着旧文件）
        try {
          const assetsArr = JSON.parse(curlJson(token, `${REPO_API}/releases/${releaseId}/assets?per_page=100`, 'GET'));
          const oldAsset = Array.isArray(assetsArr) && assetsArr.find((x) => x.name === a.name);
          if (oldAsset) {
            curlJson(token, `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/releases/assets/${oldAsset.id}`, 'DELETE');
            console.log(`    附件 ${a.name} 已存在 → 已删除旧附件（id=${oldAsset.id}），重新上传`);
          }
        } catch (e) {
          console.log(`    [!] 删除旧附件失败：${e.message}，跳过上传`);
          continue;
        }
      }
      const sizeMB = fs.statSync(a.path).size / 1024 / 1024;
      console.log(`    上传 ${a.name}（${sizeMB.toFixed(1)} MB）…`);
      const uploadUrl = `https://uploads.github.com/repos/NightRainStarGame/USTBTaskManager/releases/${releaseId}/assets?name=${encodeURIComponent(a.name)}`;
      const args = ['-sS', '-X', 'POST',
        '-H', `Authorization: Bearer ${token}`,
        '-H', 'Content-Type: ' + a.type,
        '--data-binary', `@${a.path}`,
        uploadUrl];
      const out = run('curl', args);
      try {
        const j = JSON.parse(out);
        if (j.id) console.log(`      ✓ asset id=${j.id} → ${j.browser_download_url}`);
        else throw new Error(j.message || 'no id in response');
      } catch (e) {
        throw new Error(`上传 ${a.name} 失败：${e.message}`);
      }
    }
    ok('Release 页 + 附件就绪');
  } catch (e) {
    console.log(`    [!] Release 页/附件失败：${e.message}（不影响 leastversion 直链 + App 更新）`);
  } finally {
    try { fs.rmSync(path.join(ROOT, '_rel-body.tmp.json'), { force: true }); } catch {}
  }
}

if (!NO_CLOUD) {
  step('上传到北科云盘（AnyShare 校园网内最快；失败不影响主流程）');
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
    console.log(`    [!] 云盘上传失败：${e.message}`);
  }
}

console.log(`\n========================================\n  v${version} 发版完成\n  更新源: ${latest.url}\n  sha256: ${sha256}\n========================================`);

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