#!/usr/bin/env node
/**
 * publish-github.js —— 把当前版本一键发布到 GitHub
 *
 * 做四件事：
 *   1. 定位安装包并计算 SHA-256
 *   2. 在 GitHub 上创建/更新 Release（tag 形如 v0.3.0），上传安装包作为附件
 *   3. 生成仓库根目录的 latest.json（App 的「固定更新源地址」就是它）
 *   4. 提交并推送 latest.json 到仓库
 *
 * 用法：
 *   node scripts/publish-github.js                          # 完整发布
 *   node scripts/publish-github.js --notes "修复了 XXX"
 *   node scripts/publish-github.js --notes-file RELEASE_NOTES.md
 *   node scripts/publish-github.js --draft                  # 存为草稿，不公开
 *   node scripts/publish-github.js --no-push                # 只写本地 latest.json，不推送
 *   node scripts/publish-github.js --dry-run                # 只打印计划，不产生任何改动
 *
 * 前置条件：
 *   - 已登录 GitHub（凭据存于系统凭据管理器；本脚本用 `git credential fill` 读取，不落盘）
 *   - 安装包已打包（npm run build:exe），或通过 --file 指定路径
 *
 * 注意：GitHub 单文件上限 100 MB，超出会被拒绝。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// ==================== 参数解析 ====================
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2);
    const eq = key.indexOf('=');
    if (eq >= 0) { o[key.slice(0, eq)] = key.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { o[key] = next; i++; }
    else o[key] = true;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const DRY = !!args['dry-run'];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const productName = (pkg.build && pkg.build.productName) || pkg.name;
const version = String(args.version || pkg.version).replace(/^v/i, '');
const tag = `v${version}`;

// ==================== 小工具 ====================
function log(msg) { console.log(msg); }
function step(msg) { console.log(`\n▶ ${msg}`); }
function fail(msg) { console.error(`\n✗ ${msg}`); process.exit(1); }

function git(gitArgs, opts = {}) {
  return execFileSync('git', gitArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: opts.stdio || ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

/** 从系统凭据管理器取 GitHub token（不写入任何文件） */
function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  let out = '';
  try {
    out = execFileSync('git', ['credential', 'fill'], {
      cwd: ROOT,
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch {
    fail('读取 GitHub 凭据失败。请先执行一次 `git push` 完成登录（或设置 GITHUB_TOKEN 环境变量）。');
  }
  const m = out.match(/^password=(.+)$/m);
  if (!m) fail('凭据管理器里没有 github.com 的密码/token，请先完成一次 git push 登录。');
  return m[1].trim();
}

function repoSlug() {
  try {
    const url = git(['remote', 'get-url', 'origin']);
    const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?$/i);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* ignore */ }
  return 'NightRainStarGame/USTBTaskManager';
}

function currentBranch() {
  try { return git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return 'main'; }
}

function hashFile(file) {
  const h = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(1 << 20);
  const fd = fs.openSync(file, 'r');
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

// ==================== 定位安装包 ====================
function resolveInstaller() {
  if (args.file && args.file !== true) {
    const p = path.resolve(ROOT, String(args.file));
    return fs.existsSync(p) ? p : null;
  }
  const candidates = [
    path.join(ROOT, `release-build`, `${productName} Setup ${version}.exe`),
    path.join(ROOT, `release-${version}`, `${productName} Setup ${version}.exe`),
    path.join(ROOT, `release`, `${productName} Setup ${version}.exe`),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;

  // 兜底：任意 release* 目录里最新的同版本 Setup exe
  const hits = fs.readdirSync(ROOT)
    .filter((d) => /^release/i.test(d) && fs.statSync(path.join(ROOT, d)).isDirectory())
    .flatMap((d) => {
      const dir = path.join(ROOT, d);
      return fs.readdirSync(dir)
        .filter((f) => new RegExp(`Setup ${version.replace(/\./g, '\\.')}\\.exe$`, 'i').test(f))
        .map((f) => path.join(dir, f));
    })
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || null;
}

// ==================== GitHub API ====================
/** 需要区分 404 / 200 —— 用带状态码的方式请求 */
function apiWithStatus(token, method, apiPath, body) {
  const url = `https://api.github.com${apiPath}`;
  const curlArgs = [
    '-sS', '-w', '\\n%{http_code}',
    '-X', method,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: publish-github',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '--max-time', '120',
  ];
  let tmp = null;
  if (body !== undefined) {
    tmp = path.join(require('node:os').tmpdir(), `gh-body-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    curlArgs.push('-H', 'Content-Type: application/json', '--data-binary', `@${tmp}`);
  }
  curlArgs.push(url);
  let raw = '';
  try {
    raw = execFileSync('curl', curlArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    fail(`请求 GitHub API 失败（${method} ${apiPath}）：${e.message}`);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  }
  const idx = raw.lastIndexOf('\n');
  const status = parseInt(raw.slice(idx + 1).trim(), 10);
  const text = raw.slice(0, idx);
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status, json, text };
}

// ==================== 主流程 ====================
async function main() {
  log('══════════════════════════════════════════════');
  log(`  发布 TaskManager ${version} 到 GitHub`);
  log('══════════════════════════════════════════════');

  const repo = repoSlug();
  const branch = currentBranch();
  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;

  step('1/5 定位安装包');
  const file = resolveInstaller();
  if (!file) {
    fail(`找不到 v${version} 的安装包。请先执行：\n    npm run build:exe\n  或用 --file 指定安装包路径。`);
  }
  const size = fs.statSync(file).size;
  const assetName = `${productName}-Setup-${version}.exe`;
  log(`  安装包：${path.relative(ROOT, file)}`);
  log(`  体积  ：${fmtSize(size)}（${size} 字节）`);
  if (size > 100 * 1024 * 1024) {
    fail(`安装包 ${fmtSize(size)} 超过 GitHub 单文件 100 MB 上限，无法作为 Release 附件上传。`);
  }

  step('2/5 计算 SHA-256');
  const sha256 = hashFile(file);
  log(`  ${sha256}`);

  const notes = args['notes-file']
    ? fs.readFileSync(path.resolve(ROOT, String(args['notes-file'])), 'utf8').trim()
    : (args.notes && args.notes !== true ? String(args.notes).replace(/\\n/g, '\n').trim() : `TaskManager v${version}`);

  const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${assetName}`;
  const pageUrl = `https://github.com/${repo}/releases/tag/${tag}`;

  const manifest = {
    version,
    notes,
    url: downloadUrl,
    page: pageUrl,
    sha256,
    size,
    fileName: assetName,
    releasedAt: new Date().toISOString(),
  };

  log(`\n  仓库    ：${repo}（分支 ${branch}）`);
  log(`  tag     ：${tag}`);
  log(`  附件名  ：${assetName}`);
  log(`  下载地址：${downloadUrl}`);
  log(`  清单地址：${rawBase}/latest.json`);

  if (DRY) {
    log('\n[dry-run] 未做任何改动。');
    return;
  }

  const token = getToken();

  step('3/5 创建 / 更新 GitHub Release');
  let release = null;
  const found = apiWithStatus(token, 'GET', `/repos/${repo}/releases/tags/${tag}`);
  if (found.status === 200 && found.json && found.json.id) {
    release = found.json;
    log(`  已存在 Release ${tag}（id=${release.id}），将复用并更新说明`);
    apiWithStatus(token, 'PATCH', `/repos/${repo}/releases/${release.id}`, {
      name: `${productName} ${version}`,
      body: notes,
      draft: !!args.draft,
      prerelease: false,
    });
  } else {
    const created = apiWithStatus(token, 'POST', `/repos/${repo}/releases`, {
      tag_name: tag,
      name: `${productName} ${version}`,
      body: notes,
      draft: !!args.draft,
      prerelease: false,
      target_commitish: branch,
    });
    if (!created.json || !created.json.id) {
      fail(`创建 Release 失败（HTTP ${created.status}）：${created.text.slice(0, 400)}`);
    }
    release = created.json;
    log(`  已创建 Release ${tag}（id=${release.id}）`);
  }

  step('4/5 上传安装包附件');
  const assets = release.assets || [];
  const dup = assets.find((a) => a.name === assetName);
  if (dup) {
    log(`  已存在同名附件，先删除旧的（id=${dup.id}）`);
    apiWithStatus(token, 'DELETE', `/repos/${repo}/releases/assets/${dup.id}`);
  }
  log(`  正在上传 ${fmtSize(size)} ……`);
  const uploadArgs = [
    '-sS', '-X', 'POST',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'Content-Type: application/octet-stream',
    '-H', 'User-Agent: publish-github',
    '--max-time', '1800',
    '--data-binary', `@${file}`,
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
  ];
  let upRaw = '';
  try {
    upRaw = execFileSync('curl', uploadArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    fail(`上传失败：${e.message}`);
  }
  let upJson = null;
  try { upJson = JSON.parse(upRaw); } catch { /* ignore */ }
  if (!upJson || !upJson.browser_download_url) {
    fail(`上传返回异常：${upRaw.slice(0, 400)}`);
  }
  log(`  ✓ 上传成功：${upJson.browser_download_url}`);

  step('5/5 写入并推送 latest.json');
  const latestPath = path.join(ROOT, 'latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(manifest, null, 2) + '\n');
  log(`  已写入 ${path.relative(ROOT, latestPath)}`);
  log('  ' + JSON.stringify(manifest, null, 2).split('\n').join('\n  '));

  if (args['no-push']) {
    log('\n[--no-push] 已跳过 git 提交与推送。');
  } else {
    try {
      git(['add', 'latest.json']);
      const changed = git(['status', '--porcelain', 'latest.json']);
      if (!changed) {
        log('  latest.json 无变化，跳过提交');
      } else {
        git(['commit', '-m', `chore(release): 发布 v${version}，更新 latest.json`]);
        git(['push', 'origin', branch], { stdio: ['pipe', 'pipe', 'pipe'] });
        log(`  ✓ 已提交并推送到 ${branch}`);
      }
    } catch (e) {
      log(`  ! git 提交/推送失败：${e.message}`);
      log('    请手动执行：git add latest.json && git commit -m "chore(release)" && git push');
    }
  }

  log('\n══════════════════════════════════════════════');
  log(`  ✓ v${version} 发布完成`);
  log('══════════════════════════════════════════════');
  log(`  Release 页：${pageUrl}`);
  log(`  更新清单  ：${rawBase}/latest.json`);
  log(`  SHA-256   ：${sha256}`);
  log('');
  log('  提示：raw.githubusercontent.com 有约 5 分钟 CDN 缓存，稍等片刻再检查更新。');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
