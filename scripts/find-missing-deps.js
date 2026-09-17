// 按 package-lock.json 检测缺失的依赖目录，输出可安装列表
const fs = require('fs');
const path = require('path');

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const pkgs = lock.packages || {};
const missing = [];

function nameFromKey(key) {
  // "node_modules/@scope/pkg" / "node_modules/a/node_modules/@scope/pkg"
  const parts = key.split('node_modules/');
  const last = parts[parts.length - 1].replace(/\/$/, '');
  return last;
}

for (const [key, val] of Object.entries(pkgs)) {
  if (!key) continue;              // 根 package
  if (val.link) continue;          // 符号链接
  if (!val.version) continue;      // 无版本（本地）
  const dir = path.join(process.cwd(), key);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    const name = nameFromKey(key);
    missing.push({ key, spec: `${name}@${val.version}`, optional: !!val.optional, dev: !!val.dev });
  }
}

// 输出：必装 + 可选
const required = missing.filter(m => !m.optional);
const optional = missing.filter(m => m.optional);

console.log('=== REQUIRED ===');
console.log(required.map(m => m.spec).join('\n'));
console.log('=== OPTIONAL ===');
console.log(optional.map(m => m.spec).join('\n'));
console.error(`REQUIRED_COUNT=${required.length} OPTIONAL_COUNT=${optional.length}`);
