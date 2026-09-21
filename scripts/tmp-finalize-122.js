// v1.2.2 发版收尾（一次性）：恢复 oldversion + 创建 Release + 附件 + 云盘 + commit/push
// 背景：release:one 两次死在 git push（网络 curl 55），resume 二次滚动把 oldversion 错填成 1.2.2
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = 'e:/University/TaskManager';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
}

// ---- 1. 恢复 oldversion = 1.2.1 安装包（一步回退能力；blob 已在远端，push 不重传）----
console.log('[1/5] 恢复 oldversion 为 1.2.1 安装包');
run('git', ['checkout', '8d0a5d2', '--', 'oldversion']);
console.log('    oldversion:', fs.readdirSync(path.join(ROOT, 'oldversion')).join(', '));

// ---- 2. GitHub Release v1.2.2 + 附件 ----
console.log('[2/5] GitHub Release v1.2.2 + 附件');
const token = run('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).match(/password=(.+)/)[1].trim();
const REPO_API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager';
const TAG = 'v1.2.2';
function curlJson(url, method, bodyFile) {
  const args = ['-sS', '-X', method, '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/vnd.github+json', url];
  if (bodyFile) args.push('-d', '@' + bodyFile);
  return run('curl', args);
}
let releaseId = null;
const exists = JSON.parse(curlJson(`${REPO_API}/releases/tags/${TAG}`, 'GET'));
if (exists && exists.id) { releaseId = exists.id; console.log('    Release 已存在 id=' + releaseId); }
else {
  const notes = fs.readFileSync(path.join(ROOT, 'release-notes-1.2.2.md'), 'utf8');
  const bodyFile = path.join(ROOT, '_rel-body.tmp.json');
  fs.writeFileSync(bodyFile, JSON.stringify({ tag_name: TAG, name: `TaskManager v1.2.2`, body: notes, draft: false, prerelease: false }));
  const created = JSON.parse(curlJson(REPO_API + '/releases', 'POST', bodyFile));
  if (!created.id) throw new Error('create release failed: ' + (created.message || ''));
  releaseId = created.id;
  console.log('    Release id=' + releaseId);
}
let existingNames = new Set();
try {
  const arr = JSON.parse(curlJson(`${REPO_API}/releases/${releaseId}/assets?per_page=100`, 'GET'));
  if (Array.isArray(arr)) existingNames = new Set(arr.map(a => a.name));
} catch {}
console.log('    已有附件: ' + ([...existingNames].join(', ') || '无'));
const assets = [
  { p: 'leastversion/TaskManager-Setup-1.2.2.exe', type: 'application/octet-stream' },
  { p: 'leastversion/patches/TaskManager-Patch-1.2.1-to-1.2.2.zip', type: 'application/zip' },
];
for (const a of assets) {
  const name = path.basename(a.p);
  if (existingNames.has(name)) { console.log('    附件已存在，跳过 ' + name); continue; }
  if (!fs.existsSync(path.join(ROOT, a.p))) { console.log('    [!] 缺文件，跳过 ' + name); continue; }
  const url = `https://uploads.github.com/repos/NightRainStarGame/USTBTaskManager/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
  const out = run('curl', ['-sS', '-X', 'POST', '-H', `Authorization: Bearer ${token}`, '-H', 'Content-Type: ' + a.type, '--data-binary', '@' + path.join(ROOT, a.p), url]);
  const j = JSON.parse(out);
  if (j.id) console.log(`    ✓ ${name} (${(fs.statSync(path.join(ROOT, a.p)).size / 1048576).toFixed(1)}MB) → ${j.browser_download_url}`);
  else throw new Error(name + ' 上传失败: ' + (j.message || JSON.stringify(j).slice(0, 120)));
}

// ---- 3. 北科云盘上传 ----
console.log('[3/5] 上传北科云盘（校园网内最快）');
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/upload-release-to-ustbcloud.js'), path.join(ROOT, 'leastversion/TaskManager-Setup-1.2.2.exe'), path.join(ROOT, 'latest.json')], { cwd: ROOT, stdio: 'inherit' });
console.log('    云盘 exit=' + r.status + (r.status === 0 ? '（成功）' : '（失败，不阻塞）'));

// ---- 4. commit + push（网络抖动，重试 5 次）----
console.log('[4/5] git 提交推送（page 修正 + oldversion 恢复）');
run('git', ['add', '-A']);
try { run('git', ['commit', '-m', 'fix(v1.2.2): oldversion 恢复 1.2.1 回退包（resume 二次滚动修正）']); } catch { console.log('    无需提交'); }
let pushed = false;
for (let i = 1; i <= 5 && !pushed; i++) {
  try { run('git', ['push', 'origin', 'main']); pushed = true; console.log('    push ok'); }
  catch { console.log(`    push 第 ${i} 次失败，重试…`); }
}

// ---- 5. 校验 ----
console.log('[5/5] 远端校验');
console.log('    远端 main:', run('git', ['ls-remote', 'origin', 'main']).trim().slice(0, 7));
try { fs.rmSync(path.join(ROOT, '_rel-body.tmp.json'), { force: true }); } catch {}
console.log(pushed ? '\n=== v1.2.2 收尾全部完成 ===' : '\n[!] push 未成功，需手动重试 git push');
