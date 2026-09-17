// 自动修复：按 package-lock.json 校验每个依赖，损坏的从 registry 重新解压
// 用法: node scripts/repair-deps.js [--dry]
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const DRY = process.argv.includes('--dry');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const pkgs = lock.packages || {};
const root = process.cwd();
const tmpDir = path.join(root, '.restore');
fs.mkdirSync(tmpDir, { recursive: true });

function resolveEntry(dir, target) {
  const candidates = [
    target,
    target + '.js',
    target + '.json',
    target + '.node',
    path.join(target, 'index.js'),
    path.join(target, 'index.json'),
  ];
  return candidates.some(c => fs.existsSync(path.join(dir, c)));
}

function entryOk(key, val) {
  if (!key || val.link || !val.version) return true;
  const dir = path.join(root, key);
  const pjPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pjPath)) return false;
  let pj;
  try { pj = JSON.parse(fs.readFileSync(pjPath, 'utf8')); } catch { return false; }
  if (pj.version !== val.version) return false;
  // 检查 main / module 入口是否存在（按 Node 解析规则）
  for (const field of ['main', 'module']) {
    if (pj[field] && !resolveEntry(dir, pj[field])) return false;
  }
  return true;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { file.close(); reject(e); });
  });
}

(async () => {
  const broken = [];
  for (const [key, val] of Object.entries(pkgs)) {
    if (!entryOk(key, val)) broken.push({ key, val });
  }

  console.log('BROKEN_COUNT=' + broken.length);
  broken.slice(0, 60).forEach(b => console.log(' -', b.key, '@', b.val.version));

  if (DRY || broken.length === 0) return;

  for (const { key, val } of broken) {
    const resolved = val.resolved
      || `https://registry.npmjs.org/${key.replace(/^.*node_modules\//, '')}/-/${key.replace(/^.*node_modules\//, '').split('/').pop()}-${val.version}.tgz`;
    const tgz = path.join(tmpDir, 'pkg-' + Math.random().toString(36).slice(2) + '.tgz');
    const targetDir = path.join(root, key);
    try {
      await download(resolved, tgz);
      fs.mkdirSync(targetDir, { recursive: true });
      execFileSync('tar', ['-xzf', tgz, '--strip-components=1', '-C', targetDir], { stdio: 'ignore' });
      console.log('  ✓ restored', key);
    } catch (e) {
      console.log('  ✗ failed', key, String(e.message).slice(0, 80));
    }
  }
})();
