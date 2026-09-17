#!/usr/bin/env node
/**
 * publish-vps.js —— 把当前版本发布到 StarOS 自建更新站（nrsc.games）
 *
 * 做的事（等价于站点 deploy/README.md「发布新版本」那一节，只是全自动了）：
 *   1. 定位安装包 → 算 SHA-256 / 字节数 → 重命名为 TaskManager-Setup-<version>.exe
 *   2. 把 leastversion/ 里的旧版滚进 oldversion/，新包放进 leastversion/
 *   3. 重写 latest.json              ← 客户端读它感知更新（固定地址，永不变）
 *   4. 重写 oldversion/versions.json ← 站点「历史版本」区块读它
 *   5. 重写 SHA256SUMS.txt
 *
 * 用法：
 *   node scripts/publish-vps.js                          # 用 package.json 的版本号发布
 *   node scripts/publish-vps.js --notes "修复了 XXX"
 *   node scripts/publish-vps.js --notes-file RELEASE_NOTES.md
 *   node scripts/publish-vps.js --file "release-v1.2/TaskManager Setup 1.2.0.exe"
 *   node scripts/publish-vps.js --site D:\StarMain\Web   # 指定站点目录
 *   node scripts/publish-vps.js --keep 1                 # 历史版本只留 1 个（默认 2）
 *   node scripts/publish-vps.js --dry-run                # 只打印计划，不动文件
 *   node scripts/publish-vps.js --verify                 # 只检查线上清单是否正常
 *
 * 站点目录查找顺序：--site > 环境变量 STARMAIN_DIR / STAROS_SITE_DIR > D:\StarMain\Web
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// ==================== 参数解析（与 release.js 同一套写法） ====================
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

/** 站点仓库目录（下载站在其中的 <SUB>/ 下） */
const SITE_DIR = path.resolve(String(
  args.site || process.env.STARMAIN_DIR || process.env.STAROS_SITE_DIR || 'D:\\StarMain\\Web'
));
/** 下载站在站点里的相对路径 */
const SUB = String(args.sub || 'downloads/taskmanager').replace(/^\/+|\/+$/g, '');
/** 站点对外域名（只用来拼清单地址，不影响写入内容） */
const BASE_URL = String(
  args['base-url'] || process.env.PUBLIC_BASE_URL || 'https://nrsc.games'
).replace(/\/+$/, '');
/** oldversion/ 保留几个历史版本 */
const KEEP_OLD = Math.max(0, Number.isFinite(+args.keep) && args.keep !== true ? +args.keep : 2);

const DL_DIR = path.join(SITE_DIR, SUB);
const LATEST_DIR = path.join(DL_DIR, 'leastversion');
const OLD_DIR = path.join(DL_DIR, 'oldversion');
const LATEST_JSON = path.join(DL_DIR, 'latest.json');
const VERSIONS_JSON = path.join(OLD_DIR, 'versions.json');
const SUMS_TXT = path.join(DL_DIR, 'SHA256SUMS.txt');

const NEW_NAME = `${productName}-Setup-${version}.exe`;
const MANIFEST_URL = `${BASE_URL}/${SUB}/latest.json`;

// ==================== 入口 ====================
if (args.verify) {
  verifyLive(typeof args.verify === 'string' ? args.verify : MANIFEST_URL).catch((e) => {
    console.error(`✗ 校验过程出错：${e && e.message ? e.message : e}`);
    process.exit(1);
  });
} else {
  main();
}

// ==================== 主流程 ====================
function main() {
  log('');
  log('══════════════════════════════════════════════');
  log(`  发布 TaskManager v${version} 到自建更新站`);
  log('══════════════════════════════════════════════');

  step('1/5 检查站点目录');
  if (!fs.existsSync(SITE_DIR)) {
    fail(`站点目录不存在：${SITE_DIR}\n` +
      '  用 --site <目录> 指定，或设环境变量 STARMAIN_DIR。\n' +
      '  本项目默认站点是 D:\\StarMain\\Web（nrsc.games 的源码目录）。');
  }
  log(`  站点    ：${SITE_DIR}`);
  log(`  下载站  ：${SUB}/`);
  log(`  对外地址：${BASE_URL}/${SUB}/latest.json`);

  step('2/5 定位安装包');
  const src = resolveInstaller();
  if (!src) {
    fail(`找不到 v${version} 的安装包。请先打包：\n` +
      '    npm run build:exe\n' +
      '  或用 --file 指定安装包路径。');
  }
  const size = fs.statSync(src).size;
  const sha256 = hashFile(src);
  log(`  安装包  ：${path.relative(ROOT, src)}`);
  log(`  发布为  ：leastversion/${NEW_NAME}`);
  log(`  体积    ：${fmtSize(size)}（${size} 字节）`);
  log(`  SHA-256 ：${sha256}`);

  step('3/5 规划目录滚动');
  const prevManifest = readJson(LATEST_JSON);
  const prevVersions = readJson(VERSIONS_JSON);
  const plan = planRoll();
  if (plan.roll.length) log(`  滚入历史：${plan.roll.join(', ')}`);
  else log('  滚入历史：（无，leastversion/ 本来就是空的）');
  if (plan.drop.length) log(`  清理删除：${plan.drop.join(', ')}（超出 --keep ${KEEP_OLD} 个）`);
  else log('  清理删除：（无）');

  const notes = resolveNotes(prevManifest);
  const releasedAt = new Date().toISOString();

  const manifest = {
    version,
    notes,
    url: `__BASE__/${SUB}/leastversion/${encodeURIComponent(NEW_NAME)}`,
    page: '__BASE__/apps/taskmanager',
    sha256,
    size,
    fileName: NEW_NAME,
    releasedAt,
  };

  if (DRY) {
    log('');
    log('[dry-run] 未做任何改动。将要写出的 latest.json：');
    log(JSON.stringify(manifest, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
    log('');
    return;
  }

  step('4/5 搬运文件');
  fs.mkdirSync(LATEST_DIR, { recursive: true });
  fs.mkdirSync(OLD_DIR, { recursive: true });

  for (const f of plan.roll) {
    moveFile(path.join(LATEST_DIR, f), path.join(OLD_DIR, f));
    log(`  → oldversion/${f}`);
  }
  for (const f of plan.drop) {
    fs.unlinkSync(path.join(OLD_DIR, f));
    log(`  ✗ 删除 oldversion/${f}`);
  }
  fs.copyFileSync(src, path.join(LATEST_DIR, NEW_NAME));
  log(`  ✓ leastversion/${NEW_NAME}`);

  step('5/5 写入清单');
  writeJson(LATEST_JSON, manifest);
  log(`  ✓ ${path.relative(SITE_DIR, LATEST_JSON)}`);

  const versionsDoc = buildVersionsDoc(manifest, plan, prevVersions);
  writeJson(VERSIONS_JSON, versionsDoc);
  log(`  ✓ ${path.relative(SITE_DIR, VERSIONS_JSON)}`);

  fs.writeFileSync(SUMS_TXT, buildSums(versionsDoc));
  log(`  ✓ ${path.relative(SITE_DIR, SUMS_TXT)}`);

  printSummary({ manifest, plan });
}

// ==================== 定位安装包 ====================
function resolveInstaller() {
  if (args.file && args.file !== true) {
    const p = path.resolve(ROOT, String(args.file));
    return fs.existsSync(p) ? p : null;
  }
  const exact = [
    path.join(ROOT, `release-${version}`, `${productName} Setup ${version}.exe`),
    path.join(ROOT, `release-v${version}`, `${productName} Setup ${version}.exe`),
    path.join(ROOT, `release`, `${productName} Setup ${version}.exe`),
  ];
  for (const c of exact) if (fs.existsSync(c)) return c;

  // 兜底：任意 release*/ 目录里同版本的 Setup exe，取最新的那个
  const verRe = new RegExp(`Setup ${version.replace(/\./g, '\\.')}\\.exe$`, 'i');
  const hits = fs.readdirSync(ROOT)
    .filter((d) => /^release/i.test(d) && safeIsDir(path.join(ROOT, d)))
    .flatMap((d) => fs.readdirSync(path.join(ROOT, d))
      .filter((f) => verRe.test(f) && !/unpacked/i.test(f))
      .map((f) => path.join(ROOT, d, f)))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits[0] || null;
}

// ==================== 滚动规划 ====================
/**
 * 决定哪些文件从 leastversion/ 滚进 oldversion/、哪些历史版本该删。
 * 注意：与新版**同名**的文件视为重复发布，直接覆盖，不参与滚动。
 */
function planRoll() {
  const roll = listExe(LATEST_DIR).filter((f) => f !== NEW_NAME);
  const oldExisting = listExe(OLD_DIR).filter((f) => f !== NEW_NAME);
  // 滚动过来的会覆盖 oldversion/ 里的同名文件 → 先按名字去重
  const merged = [...new Set([...roll, ...oldExisting])];
  merged.sort((a, b) => cmpVersion(versionOf(b), versionOf(a)) || a.localeCompare(b));
  return { roll, keep: merged.slice(0, KEEP_OLD), drop: merged.slice(KEEP_OLD) };
}

/** 拼 oldversion/versions.json（站点「历史版本」区块的数据源） */
function buildVersionsDoc(manifest, plan, prev) {
  const prevEntries = Array.isArray(prev && prev.versions) ? prev.versions : [];
  // 按文件名认旧条目：文件会在 leastversion/ 与 oldversion/ 之间滚动，
  // 用 dir 匹配会失配，导致每次都重算 85MB 的哈希、还会丢掉真实的 releasedAt。
  const findPrev = (fileName) =>
    prevEntries.find((e) => e && e.fileName === fileName) || null;

  const entries = [{
    version,
    dir: 'leastversion',
    fileName: NEW_NAME,
    url: `__BASE__/${SUB}/leastversion/${encodeURIComponent(NEW_NAME)}`,
    sha256: manifest.sha256,
    size: manifest.size,
    releasedAt: manifest.releasedAt,
    current: true,
  }];

  for (const f of plan.keep) {
    const p = path.join(OLD_DIR, f);
    const cached = findPrev(f);
    const st = fs.statSync(p);
    entries.push({
      version: versionOf(f) || (cached && cached.version) || 'unknown',
      dir: 'oldversion',
      fileName: f,
      url: `__BASE__/${SUB}/oldversion/${encodeURIComponent(f)}`,
      sha256: (cached && cached.sha256) || hashFile(p),
      size: (cached && cached.size) || st.size,
      releasedAt: (cached && cached.releasedAt) || st.mtime.toISOString(),
      current: false,
    });
  }

  return {
    latest: version,
    updatedAt: new Date().toISOString(),
    dirs: {
      leastversion: '最新版目录（当前版本指向这里）',
      oldversion: '历史版本目录（用于手动回退）',
    },
    versions: entries,
  };
}

function buildSums(versionsDoc) {
  return versionsDoc.versions
    .map((e) => `${e.sha256}  ${e.dir}/${e.fileName}`)
    .join('\n') + '\n';
}

function resolveNotes(prevManifest) {
  if (args['notes-file'] && args['notes-file'] !== true) {
    return fs.readFileSync(path.resolve(ROOT, String(args['notes-file'])), 'utf8').trim();
  }
  if (args.notes && args.notes !== true) {
    return String(args.notes).replace(/\\n/g, '\n').trim();
  }
  // 同版本重发时沿用已有说明，避免手滑把 notes 清空
  if (prevManifest && String(prevManifest.version) === version && prevManifest.notes) {
    return String(prevManifest.notes);
  }
  return `TaskManager v${version}`;
}

// ==================== 工具 ====================
function log(msg) { console.log(msg); }
function step(msg) { console.log(`\n▶ ${msg}`); }
function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function listExe(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
  } catch { return []; }
}

/** TaskManager-Setup-1.2.0.exe → 1.2.0 */
function versionOf(fileName) {
  const m = String(fileName).match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)\.exe$/i);
  return m ? m[1] : '';
}

function cmpVersion(a, b) {
  const p = (v) => {
    const m = String(v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };
  const pa = p(a), pb = p(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
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

/** 跨盘符 rename 会抛 EXDEV，退化成 copy + unlink */
function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) fs.unlinkSync(to);
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.unlinkSync(from);
  }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

// ==================== 结果输出 ====================
function printSummary(o) {
  const line = (s) => console.log(s);
  line('');
  line('════════════════════════════════════════════════════════════');
  line(`  ✓ TaskManager v${o.manifest.version} 已写入自建更新站`);
  line('════════════════════════════════════════════════════════════');
  line(`  站点目录   ${DL_DIR}`);
  line(`  更新源     ${MANIFEST_URL}（固定不变，客户端读它）`);
  line(`  安装包     leastversion/${o.manifest.fileName}`);
  line(`  SHA-256    ${o.manifest.sha256}`);
  line(`  历史版本   ${o.plan.keep.length ? o.plan.keep.join(', ') : '（无）'}`);
  line('────────────────────────────────────────────────────────────');
  line('  下一步：');
  line('   1. 把下载站同步到 VPS（安装包约 85MB，rsync 支持断点续传）：');
  line(`      rsync -av --progress "${toPosix(DL_DIR)}/" root@<VPS IP>:/opt/starmain/${SUB}/`);
  line(`      # 或整站同步：rsync -av --exclude node_modules "${toPosix(SITE_DIR)}/" root@<VPS IP>:/root/starmain-src/`);
  line('   2. 不用重启服务 —— 清单每次请求都读盘；页面会自动显示新版本号');
  line('   3. 自检线上清单：');
  line(`      node scripts/publish-vps.js --verify${BASE_URL.includes('nrsc.games') ? '' : ` ${MANIFEST_URL}`}`);
  line('   4. 建议再同步发一份到 GitHub 备用源（App 会自动择高版本）：');
  line('      npm run publish:github');
  line('   5. 重新打包一次 TaskManager，把「文档里的更新源示例」换成自建站（可选）：');
  line(`      node scripts/release.js --base-url ${BASE_URL}/${SUB} --apply-default`);
  line('════════════════════════════════════════════════════════════');
  line('');
}

function toPosix(p) { return String(p).replace(/\\/g, '/'); }

// ==================== 线上校验 ====================
/**
 * 发一个请求拿响应。优先用系统 curl —— 它和 App（Chromium net 栈）一样走**操作系统证书库**；
 * node 自带的 CA 包在装了 HTTPS 中间盒 / 企业根证书的机器上会 `unable to verify the first
 * certificate` 而误报「无法访问」。没有 curl 时才退回 node fetch。
 */
async function request(url, method = 'GET') {
  const tmp = path.join(os.tmpdir(), `pvps-${process.pid}-${Date.now()}.txt`);
  try {
    const out = spawnSync('curl', [
      '-sS', '-L', '-m', '30',
      ...(method === 'HEAD' ? ['-I'] : ['-X', method]),
      '-H', 'User-Agent: TaskManager-update-check',
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Cache-Control: no-cache',
      '-o', tmp, '-w', '%{http_code}',
      url,
    ], { encoding: 'utf8' });
    if (out.error || out.status === null) {
      if (out.error && out.error.code === 'ENOENT') return fetchViaNode(url, method);
      return { status: 0, error: String((out.stderr || out.error && out.error.message || '')).trim() };
    }
    if (out.status !== 0) {
      return { status: 0, error: String(out.stderr || `curl 退出码 ${out.status}`).trim() };
    }
    const status = Number(String(out.stdout).trim()) || 0;
    return { status, text: fs.existsSync(tmp) ? fs.readFileSync(tmp, 'utf8') : '' };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function fetchViaNode(url, method) {
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      headers: { Accept: 'application/json, text/plain, */*', 'Cache-Control': 'no-cache' },
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, error: `${e.message}${e.cause ? `（${e.cause.message}）` : ''}` };
  }
}

async function verifyLive(url) {
  console.log(`\n检查更新源：${url}\n`);

  const res = await request(url);
  if (!res.status || res.status >= 400) {
    console.error(`✗ 无法访问：${res.error || `HTTP ${res.status}`}`);
    console.error('  逐项排查：');
    console.error('   · 域名解析          nslookup ' + (() => { try { return new URL(url).hostname; } catch { return '<域名>'; } })());
    console.error('   · nginx 是否放行    确认 server_name 与域名一致、443 已监听');
    console.error('   · 清单是否已上传    对比本机 ' + toPosix(LATEST_JSON));
    console.error('   · 是否被缓存        nginx 里 latest.json 必须 Cache-Control: no-store');
    console.error('');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(res.text);
  } catch {
    console.error('✗ 返回内容不是合法 JSON（nginx 是否把 .json 也路由给 SPA 了？）。');
    console.error('  返回内容开头：' + String(res.text).slice(0, 120).replace(/\s+/g, ' ') + '\n');
    process.exit(1);
  }
  if (!manifest.version) {
    console.error('✗ 返回内容不是版本清单 JSON。\n');
    process.exit(1);
  }

  const cmp = cmpVersion(manifest.version, version);
  console.log(`✓ 连通正常（HTTP ${res.status}）`);
  console.log(`  线上版本   v${manifest.version}`);
  console.log(`  本地版本   v${version}`);
  console.log(`  判断       ${cmp > 0 ? '线上更新（App 会提示升级 ✓）' : cmp === 0 ? '与本地一致（App 不会提示）' : '线上版本更低，请确认是否上传错文件'}`);
  console.log(`  更新说明   ${manifest.notes ? String(manifest.notes).split('\n')[0].slice(0, 60) : '（无）'}`);
  console.log(`  下载地址   ${manifest.url || '（无，客户端只能打开发布页）'}`);

  if (manifest.url) {
    // 清单里的 url 带 __BASE__ 占位符，校验时换成实际域名
    const realUrl = String(manifest.url).replace(/^__BASE__/, BASE_URL);
    if (realUrl !== manifest.url) console.log(`  （占位符已替换 → ${realUrl}）`);
    const head = await request(realUrl, 'HEAD');
    if (!head.status) {
      console.log(`  ⚠ 下载地址请求失败：${head.error}`);
    } else {
      console.log(`  下载可用   HTTP ${head.status}`);
      if (head.status !== 200) console.log('  ⚠ 直接下载返回非 200，客户端下载可能失败');
    }
  }

  if (manifest.sha256 && !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    console.log('  ⚠ sha256 格式不正确（应为 64 位十六进制），客户端会跳过校验');
  } else if (manifest.sha256) {
    console.log(`  校验和     ${manifest.sha256.slice(0, 16)}…（客户端下载后自动校验）`);
  } else {
    console.log('  ⚠ 未提供 sha256，客户端不做完整性校验');
  }
  console.log('');
}
