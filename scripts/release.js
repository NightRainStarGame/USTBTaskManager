#!/usr/bin/env node
/**
 * 一键生成「服务器更新源」所需文件
 *
 * 用法示例：
 *   node scripts/release.js --base-url https://dl.example.com/taskmanager
 *   node scripts/release.js --base-url https://dl.example.com/taskmanager --notes "修复了XXX"
 *   node scripts/release.js --base-url https://dl.example.com/taskmanager --notes-file RELEASE_NOTES.md --copy
 *   node scripts/release.js --verify https://dl.example.com/taskmanager/latest.json
 *
 * 产物（默认输出到 release-manifest/）：
 *   latest.json                  ← 固定地址，每次发版覆盖它即可，老用户靠它感知更新
 *   releases/<version>.json      ← 历史版本清单归档（回滚用）
 *   SHA256SUMS.txt               ← 校验和清单
 *   UPLOAD-<version>.md          ← 上传清单与命令
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

// ============ 参数解析 ============
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

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const productName = (pkg.build && pkg.build.productName) || pkg.name;
const version = String(args.version || pkg.version).replace(/^v/i, '');
const outDir = path.resolve(ROOT, args.out || 'release-manifest');
const filesSub = String(args['files-dir'] || 'files').replace(/^\/+|\/+$/g, '');

// ============ 校验模式：直接检查线上地址是否可用 ============
if (args.verify) {
  verifyLive(String(args.verify)).catch((e) => {
    console.error(`✗ 校验过程出错：${e && e.message ? e.message : e}`);
    process.exit(1);
  });
} else {
  main();
}

// ============ 主流程 ============
function main() {
  const file = resolveInstaller();
  if (!file) {
    console.error('\n✗ 找不到安装包。请先执行打包：');
    console.error('    npx electron-builder --win nsis --x64 --config.directories.output=release-' + version);
    console.error('  或用 --file 指定安装包路径。\n');
    process.exit(1);
  }

  const fileName = path.basename(file);
  const size = fs.statSync(file).size;
  const sha256 = hashFile(file);

  const baseUrl = String(args['base-url'] || '').replace(/\/+$/, '');
  const downloadUrl = baseUrl
    ? `${baseUrl}/${filesSub}/${encodeURIComponent(fileName)}`
    : `${filesSub}/${fileName}`;
  const pageUrl = args.page ? String(args.page) : '';

  let notes = '';
  if (args['notes-file']) notes = fs.readFileSync(path.resolve(ROOT, String(args['notes-file'])), 'utf8').trim();
  else if (args.notes && args.notes !== true) notes = String(args.notes).replace(/\\n/g, '\n').trim();

  const manifest = {
    version,
    notes: notes || `TaskManager v${version}`,
    url: downloadUrl,
    sha256,
    size,
    fileName,
    releasedAt: new Date().toISOString(),
  };
  if (pageUrl) manifest.page = pageUrl;
  if (args.force) manifest.force = true;
  if (args['min-version']) manifest.minVersion = String(args['min-version']);

  // 写出产物
  fs.mkdirSync(path.join(outDir, 'releases'), { recursive: true });
  write(path.join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  write(path.join(outDir, 'releases', `${version}.json`), JSON.stringify(manifest, null, 2) + '\n');
  appendLine(path.join(outDir, 'SHA256SUMS.txt'), `${sha256}  ${fileName}`);
  if (args.copy) {
    fs.mkdirSync(path.join(outDir, filesSub), { recursive: true });
    fs.copyFileSync(file, path.join(outDir, filesSub, fileName));
  }

  const updateUrl = baseUrl ? `${baseUrl}/latest.json` : 'latest.json（相对路径）';
  write(path.join(outDir, `UPLOAD-${version}.md`), uploadChecklist({ fileName, size, sha256, baseUrl, filesSub, updateUrl, outDir, copied: !!args.copy, manifest }));

  if (args['apply-default']) {
    applyDefaultSource(updateUrl.startsWith('http') ? updateUrl : '');
  }

  // 自校验：用与 App 相同的规则复解析一遍
  const selfCheck = selfVerify(manifest, version);

  printSummary({ file, fileName, size, sha256, outDir, updateUrl, downloadUrl, notes: !!notes, selfCheck, copied: !!args.copy });
  if (!selfCheck.ok) process.exit(1);
}

// ============ 定位安装包 ============
function resolveInstaller() {
  if (args.file && args.file !== true) {
    const p = path.resolve(ROOT, String(args.file));
    return fs.existsSync(p) ? p : null;
  }
  const expected = path.join(ROOT, `release-${version}`, `${productName} Setup ${version}.exe`);
  if (fs.existsSync(expected)) return expected;

  // 兜底：在同版本目录里找任意 .exe
  const dir = path.join(ROOT, `release-${version}`);
  if (fs.existsSync(dir)) {
    const hit = fs.readdirSync(dir).filter((f) => /\.exe$/i.test(f) && !/unpacked/i.test(f));
    if (hit.length) return path.join(dir, hit[0]);
  }
  // 再兜底：release*/ 里最新的 Setup exe
  const candidates = fs.readdirSync(ROOT)
    .filter((d) => /^release/i.test(d) && fs.statSync(path.join(ROOT, d)).isDirectory())
    .map((d) => path.join(ROOT, d))
    .flatMap((d) => fs.readdirSync(d).filter((f) => /Setup.*\.exe$/i.test(f)).map((f) => path.join(d, f)))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

// ============ 工具函数 ============
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

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function appendLine(p, line) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, line + '\n');
}

function fmtSize(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

/** 用与 App 主进程 parseManifest 一致的规则复解析，确保 App 能识别 */
function selfVerify(manifest, ver) {
  const text = JSON.stringify(manifest);
  const problems = [];
  let parsed = null;
  try {
    const j = JSON.parse(text);
    const obj = Array.isArray(j) ? j[0] : j;
    const pick = (keys) => {
      for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
      return null;
    };
    const v = pick(['version', 'latest', 'ver', 'tag', 'tag_name']);
    if (v) {
      parsed = {
        version: String(v).replace(/^v/i, '').trim(),
        url: pick(['url', 'download', 'downloadUrl', 'installer', 'file']),
        page: pick(['page', 'pageUrl', 'website', 'share', 'link', 'html_url']),
        sha256: pick(['sha256', 'hash', 'checksum']),
      };
    }
  } catch (e) {
    problems.push('JSON 解析失败：' + e.message);
  }
  if (!parsed) problems.push('无法解析出版本号');
  if (parsed) {
    if (!/^\d+\.\d+\.\d+/.test(parsed.version)) problems.push(`版本号 "${parsed.version}" 不符合 x.y.z 格式`);
    if (parsed.version !== ver) problems.push(`清单版本 ${parsed.version} 与预期 ${ver} 不一致`);
    if (!parsed.sha256 || !/^[a-f0-9]{64}$/i.test(parsed.sha256)) problems.push('SHA-256 缺失或格式不正确（应为 64 位十六进制）');
  }
  return { ok: problems.length === 0, problems, parsed };
}

/** 把默认更新源写入 electron/updater/index.ts */
function applyDefaultSource(url) {
  const file = path.join(ROOT, 'electron', 'updater', 'index.ts');
  if (!fs.existsSync(file)) { console.error('! 找不到 electron/updater/index.ts，跳过 --apply-default'); return; }
  const src = fs.readFileSync(file, 'utf8');
  const re = /export const DEFAULT_UPDATE_SOURCE = '[^']*';/;
  if (!re.test(src)) { console.error('! 未找到 DEFAULT_UPDATE_SOURCE 常量，跳过'); return; }
  fs.writeFileSync(file, src.replace(re, `export const DEFAULT_UPDATE_SOURCE = '${url}';`));
  console.log(`✓ 已写入默认更新源：electron/updater/index.ts → ${url}`);
  console.log('  注意：这需要重新 build + 打包才会在新安装包中生效。\n');
}

function uploadChecklist(o) {
  const sitePath = (() => {
    if (!o.baseUrl) return '/taskmanager';
    try { return new URL(o.baseUrl).pathname.replace(/\/+$/, '') || '/'; } catch { return '/taskmanager'; }
  })();
  const updateUrlText = o.updateUrl.startsWith('http') ? o.updateUrl : 'https://<你的域名>/taskmanager/latest.json';
  return `# TaskManager v${o.manifest.version} 发布清单

## 1. 需要上传到服务器的文件

| 本地文件 | 服务器路径 | 说明 |
|---|---|---|
| \`release-manifest/latest.json\` | \`${sitePath}/latest.json\` | **固定地址，每次发版覆盖** |
| \`${o.fileName}\` | \`${sitePath}/${o.filesSub}/${o.fileName}\` | 本次安装包 |
| \`release-manifest/releases/${o.manifest.version}.json\` | \`${sitePath}/releases/${o.manifest.version}.json\` | 归档（可选） |

安装包信息：
- 大小：${fmtSize(o.size)}（${o.size} 字节）
- SHA-256：\`${o.sha256}\`

## 2. 服务器目录结构（推荐）

\`\`\`
<网站根目录>${sitePath === '/' ? '' : sitePath}/
├── latest.json                                   ← App 读取的固定地址
├── releases/
│   ├── ${o.manifest.version}.json
│   └── <旧版本>.json
└── ${o.filesSub}/
    ├── ${o.fileName}
    └── <旧版本安装包>                            ← 保留，方便回滚
\`\`\`

App 里要填的**更新源地址**（固定不变）：

\`\`\`
${updateUrlText}
\`\`\`

## 3. 上传命令参考

scp / rsync（把 \`/var/www/taskmanager\` 换成你服务器上的实际目录）：

\`\`\`bash
scp "release-manifest/latest.json"                user@server:/var/www/taskmanager/latest.json
scp "${o.fileName}"                               "user@server:/var/www/taskmanager/${o.filesSub}/"
scp "release-manifest/releases/${o.manifest.version}.json" user@server:/var/www/taskmanager/releases/
\`\`\`

\`\`\`bash
rsync -av --progress "${o.fileName}" "user@server:/var/www/taskmanager/${o.filesSub}/"
rsync -av "release-manifest/latest.json" "user@server:/var/www/taskmanager/"
\`\`\`

腾讯云 COS / 阿里云 OSS（记得把 \`latest.json\` 的缓存时间设为 0 或 60 秒，否则用户拿到旧清单）：

\`\`\`bash
coscmd upload -r release-manifest/ /taskmanager/
coscmd upload "${o.fileName}" /taskmanager/${o.filesSub}/
\`\`\`

## 4. 发布后自检

\`\`\`bash
node scripts/release.js --verify ${updateUrlText}
\`\`\`

该命令会把线上清单拉下来，用与 App 相同的规则解析，确认版本号、下载地址、SHA-256 都正常。

## 5. 关键提醒

- \`latest.json\` 的 URL **永远不要变**，变的只是里面的内容；否则老版本 App 找不到更新。
- 更新说明里的换行会被 App 原样展示，请用真实换行（\`--notes-file\` 最省事）。
- 如果网盘不支持直链下载，就不要写 \`url\` 字段（或用 \`--page\` 填分享页地址），App 会退化成「打开发布页」引导手动下载。
- 安装包文件名带空格没问题，清单里的地址已做 URL 编码。
- ${o.copied ? '本次已用 `--copy` 把安装包复制到 release-manifest/，可整目录上传。' : '本次未复制安装包；如需整目录上传，加 `--copy` 参数重跑。'}
`;
}

function printSummary(o) {
  const line = (s) => console.log(s);
  line('');
  line('════════════════════════════════════════════════════════════');
  line(`  TaskManager v${version} 发布清单已生成`);
  line('════════════════════════════════════════════════════════════');
  line(`  安装包   ${o.fileName}`);
  line(`  大小     ${fmtSize(o.size)}`);
  line(`  SHA-256  ${o.sha256}`);
  line(`  下载地址 ${o.downloadUrl}`);
  line(`  更新地址 ${o.updateUrl}`);
  line(`  说明     ${o.notes ? '已包含' : '未填写（建议用 --notes 补充）'}`);
  line(`  输出目录 ${path.relative(ROOT, outDir) || outDir}`);
  line('────────────────────────────────────────────────────────────');
  line('  自检：' + (o.selfCheck.ok ? '✓ 通过，App 可正常识别该清单' : '✗ 失败'));
  if (!o.selfCheck.ok) o.selfCheck.problems.forEach((p) => line('    - ' + p));
  line('────────────────────────────────────────────────────────────');
  if (!String(args['base-url'] || '')) {
    line('  ⚠ 未提供 --base-url，清单里的下载地址是相对路径。');
    line('     App 需要绝对 http(s) 地址，请重新执行：');
    line(`     node scripts/release.js --base-url https://<你的域名>/taskmanager`);
    line('────────────────────────────────────────────────────────────');
  }
  line('  下一步：');
  line(`   1. 查看上传清单：release-manifest/UPLOAD-${version}.md`);
  line('   2. 上传 latest.json + 安装包到服务器');
  line('   3. 把更新地址填进 App（设置 → 软件更新 → 更新源地址）');
  line('   4. 自检：node scripts/release.js --verify <更新地址>');
  line('════════════════════════════════════════════════════════════');
  line('');
}

// ============ 线上地址校验 ============
async function verifyLive(url) {
  console.log(`\n检查更新源：${url}\n`);
  let text;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'application/json, text/plain, */*', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    text = await res.text();
    console.log(`✓ 连通正常（HTTP ${res.status}，Content-Type: ${res.headers.get('content-type') || '未声明'}）`);
  } catch (e) {
    console.error(`✗ 无法访问：${e.message}`);
    console.error('  请检查：地址拼写 / 服务器是否运行 / 是否公网可达 / 是否被 CDN 缓存了旧内容。\n');
    process.exit(1);
  }

  let manifest = {};
  try {
    manifest = JSON.parse(text);
  } catch {
    console.error('✗ 返回内容不是合法 JSON（可能是网盘分享页 HTML）。');
    console.error('  App 会退化为「打开发布页」模式，无法自动下载安装。');
    console.error('  返回内容开头：' + text.slice(0, 120).replace(/\s+/g, ' ') + '\n');
    process.exit(1);
  }
  if (!manifest.version) {
    console.error('✗ 返回内容不是版本清单 JSON（可能是网盘分享页 HTML）。');
    console.error('  App 会退化为「打开发布页」模式，无法自动下载安装。\n');
    process.exit(1);
  }

  const cur = pkg.version;
  const cmp = compareVersions(manifest.version, cur);
  console.log(`  线上版本   v${manifest.version}`);
  console.log(`  本地版本   v${cur}`);
  console.log(`  判断       ${cmp > 0 ? '有新版本，App 会提示更新 ✓' : cmp === 0 ? '已是最新（App 不会提示）' : '线上版本更低，请确认是否上传错误'}`);
  console.log(`  更新说明   ${manifest.notes ? String(manifest.notes).split('\n')[0].slice(0, 60) : '（无）'}`);
  console.log(`  下载地址   ${manifest.url || '（无，将只能打开发布页）'}`);

  if (manifest.url) {
    try {
      const head = await fetch(manifest.url, { method: 'HEAD', redirect: 'follow' });
      const ct = (head.headers.get('content-type') || '').toLowerCase();
      const size = Number(head.headers.get('content-length') || 0);
      console.log(`  下载可用   HTTP ${head.status}${size ? `，${fmtSize(size)}` : ''}`);
      if (/text\/html|application\/json/.test(ct)) console.log(`  ⚠ Content-Type 是 ${ct}，App 会拒绝下载（疑似分享页而非文件直链）`);
      if (head.status !== 200) console.log('  ⚠ 直接下载返回非 200，App 下载可能失败');
    } catch (e) {
      console.log(`  ⚠ 下载地址 HEAD 请求失败：${e.message}`);
    }
  } else {
    console.log('  ⚠ 清单没有 url 字段，App 只能「打开发布页」手动下载');
  }

  if (manifest.sha256 && !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    console.log('  ⚠ sha256 字段格式不正确（应为 64 位十六进制），App 会跳过校验');
  } else if (manifest.sha256) {
    console.log(`  校验和     ${manifest.sha256.slice(0, 16)}…（已提供，下载后自动校验）`);
  } else {
    console.log('  校验和     未提供（App 跳过完整性校验）');
  }
  console.log('');
}

function compareVersions(a, b) {
  const p = (v) => { const m = String(v).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const pa = p(a), pb = p(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
