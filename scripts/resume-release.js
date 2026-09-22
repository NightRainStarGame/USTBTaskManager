#!/usr/bin/env node
/**
 * 发版恢复脚本：release-one-click.js 在 git push 阶段断网后，
 * 已有产物（leastversion/*.exe + patches/*.zip + latest.json 已就位 + commit 已就），
 * 仅补跑：
 *   - 创建/补全 GitHub Release v<ver> + 上传 Setup exe + 补丁 zip
 *   - 上传到北科云盘
 * 不动滚动、latest.json、git。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO_RAW = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main';
const REPO_API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager';
const DIST_NAME = (v) => `TaskManager-Setup-${v}.exe`;

const argv = process.argv.slice(2);
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const SKIP_CLOUD = argv.includes('--no-cloud');
const SKIP_RELEASE = argv.includes('--no-release-page');
const notesFileIdx = argv.indexOf('--notes-file');
const notesFile = notesFileIdx >= 0 ? argv[notesFileIdx + 1] : null;

if (!version) { console.error('用法: node scripts/resume-release.js <X.Y.Z> [--notes-file <path>] [--no-release-page] [--no-cloud]'); process.exit(1); }

const EXECUTE = true;
const leastDir = path.join(ROOT, 'leastversion');
const oldDir = path.join(ROOT, 'oldversion');
const buildDir = path.join(ROOT, `release-v${version}`);
const artifact = path.join(buildDir, `TaskManager Setup ${version}.exe`);
const leastExe = path.join(leastDir, DIST_NAME(version));
const notesContent = notesFile
  ? fs.readFileSync(path.resolve(ROOT, notesFile), 'utf8').trim()
  : null;

function step(m) { console.log(`\n==> ${m}`); }
function ok(m) { console.log(`    ✓ ${m}`); }
function die(m) { console.error(`\n[x] ${m}`); process.exit(1); }

step(`前置校验 v${version}`);
if (!fs.existsSync(leastExe)) die(`缺少 ${path.relative(ROOT, leastExe)}（--skip-build 模式必须已就位）`);
if (!notesContent) die('缺少 --notes-file');
ok(`leastversion/${DIST_NAME(version)} 已就位 · notes=${notesFile}（${notesContent.length} 字）`);

// 找最新补丁 zip（只关心 patches/ 下 to-${version}）
const patchesDir = path.join(leastDir, 'patches');
const targetPatch = fs.existsSync(patchesDir)
  ? fs.readdirSync(patchesDir).filter((f) => f.endsWith(`-to-${version}.zip`)).map((f) => path.join(patchesDir, f))
  : [];
if (targetPatch.length) console.log(`    补丁 zip：${targetPatch.map((p) => path.relative(ROOT, p)).join(', ')}`);
else console.log('    无补丁 zip（只发整装）');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}
function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execFileSync('git', ['credential', 'fill'], {
    input, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
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

if (!SKIP_RELEASE) {
  step('创建 GitHub Release + 上传附件');
  try {
    const token = getToken();
    const tag = `v${version}`;
    const exists = JSON.parse(curlJson(token, `${REPO_API}/releases/tags/${tag}`, 'GET'));
    let releaseId;
    if (exists && exists.id) {
      releaseId = exists.id;
      console.log(`    Release ${tag} 已存在（id=${releaseId}），补附件`);
    } else {
      const createBody = JSON.stringify({
        tag_name: tag, name: `TaskManager v${version}`, body: notesContent,
        draft: false, prerelease: false,
      });
      const tmp = path.join(ROOT, '_rel-body.tmp.json');
      fs.writeFileSync(tmp, createBody);
      const created = JSON.parse(curlJson(token, REPO_API + '/releases', 'POST', tmp));
      if (!created.id) throw new Error(created.message || 'create failed');
      releaseId = created.id;
      console.log(`    Release id=${releaseId}`);
    }

    let existingNames = new Set();
    try {
      const arr = JSON.parse(curlJson(token, `${REPO_API}/releases/${releaseId}/assets?per_page=100`, 'GET'));
      if (Array.isArray(arr)) existingNames = new Set(arr.map((a) => a.name));
      if (existingNames.size) console.log(`    已有附件 ${existingNames.size} 个：${[...existingNames].join(', ')}`);
    } catch (e) {
      console.log(`    [!] 拉取附件列表失败：${e.message}`);
    }

    const toUpload = [
      { path: leastExe, name: DIST_NAME(version), type: 'application/octet-stream' },
      ...targetPatch.map((p) => ({ path: p, name: path.basename(p), type: 'application/zip' })),
    ];

    for (const a of toUpload) {
      if (existingNames.has(a.name)) {
        // 同名覆盖：删旧传新
        try {
          const arr = JSON.parse(curlJson(token, `${REPO_API}/releases/${releaseId}/assets?per_page=100`, 'GET'));
          const old = Array.isArray(arr) && arr.find((x) => x.name === a.name);
          if (old) {
            curlJson(token, `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/releases/assets/${old.id}`, 'DELETE');
            console.log(`    ${a.name} 已存在 → 已删除旧附件（id=${old.id}），重新上传`);
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
    console.log(`    [!] Release 页/附件失败：${e.message}（不影响 leastversion 直链）`);
  } finally {
    try { fs.rmSync(path.join(ROOT, '_rel-body.tmp.json'), { force: true }); } catch {}
  }
}

if (!SKIP_CLOUD) {
  step('上传到北科云盘（AnyShare 校园网内最快；失败不影响主流程）');
  try {
    const uploader = path.join(ROOT, 'scripts', 'upload-release-to-ustbcloud.js');
    const r = spawnSync(process.execPath, [uploader, leastExe, path.join(ROOT, 'latest.json')], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env },
    });
    if (r.status !== 0) throw new Error(`upload-release-to-ustbcloud.js exit ${r.status}`);
    ok('北科云盘已上传');
  } catch (e) {
    console.log(`    [!] 云盘上传失败：${e.message}`);
  }
}

console.log(`\n========================================\n  v${version} 发布恢复完成\n========================================`);