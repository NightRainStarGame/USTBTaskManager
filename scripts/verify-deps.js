// 严格校验：lock 里每个 package 目录存在、package.json 可解析、版本一致
const fs = require('fs');
const path = require('path');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const pkgs = lock.packages || {};
const problems = [];

for (const [key, val] of Object.entries(pkgs)) {
  if (!key) continue;
  if (val.link) continue;
  if (!val.version) continue;
  const pj = path.join(process.cwd(), key, 'package.json');
  if (!fs.existsSync(pj)) {
    problems.push({ key, issue: 'MISSING', want: val.version });
    continue;
  }
  let actual;
  try { actual = JSON.parse(fs.readFileSync(pj, 'utf8')).version; }
  catch (e) { problems.push({ key, issue: 'UNPARSABLE', want: val.version }); continue; }
  if (actual !== val.version) {
    problems.push({ key, issue: 'VERSION_MISMATCH', want: val.version, actual });
  }
}

const missing = problems.filter(p => p.issue !== 'VERSION_MISMATCH');
const wrong = problems.filter(p => p.issue === 'VERSION_MISMATCH');

console.log('=== MISSING ===');
missing.forEach(p => console.log(p.key, '| want', p.want));
console.log('=== VERSION_MISMATCH ===');
wrong.forEach(p => console.log(p.key, '| want', p.want, '| actual', p.actual));
console.error(`MISSING=${missing.length} MISMATCH=${wrong.length}`);
