// 测试 helper 的零依赖 zip reader
const h = require('../electron/resources/patch-helper.cjs');
const fs = require('fs');
const path = require('path');

const zipPath = path.resolve(process.cwd(), 'leastversion/patches/TaskManager-Patch-1.2.4-to-1.2.6.zip');
const outDir = path.join(require('os').tmpdir(), 'taskmgr-helper-test');
const outPath = path.join(outDir, 'app.asar');

if (!fs.existsSync(zipPath)) { console.error('ZIP 不存在：' + zipPath); process.exit(1); }
if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

try {
  h.extractAsarFromZip(zipPath, outPath);
  const size = fs.statSync(outPath).size;
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  console.log('✅ extract OK');
  console.log('  size:', size, 'bytes');
  console.log('  sha256:', sha);
  console.log('  expected sha256 (latest.json):', '5c67ca37ee8ba3d5ce37a5fb82ead983ab91520a0e373c7784357bbc789cf67e');
  console.log('  match:', sha === '5c67ca37ee8ba3d5ce37a5fb82ead983ab91520a0e373c7784357bbc789cf67e' ? '✅' : '❌');
} catch (e) {
  console.error('❌ FAIL:', e.message);
  console.error(e.stack);
  process.exit(2);
}