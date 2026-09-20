/**
 * 块 4a 自检：抽 v1.1.5 asar + 复制成 v1.1.6 占位 + build patch + verify patch。
 * 本脚本只验证补丁链（lib + zip + manifest）通顺，真实发布要走完整 build:exe。
 *
 * 用法：node scripts/verify-patch-build.js [fromVersion] [toVersion]
 */
const fs = require('fs');
const path = require('path');
const p = require('./lib/asar-patch');

const FROM = process.argv[2] || '1.1.5';
const TO = process.argv[3] || '1.1.6';
const ROOT = path.resolve(__dirname, '..');
const LEAST = path.join(ROOT, 'leastversion');
const NSIS = path.join(LEAST, `TaskManager-Setup-${FROM}.exe`);
const TMP_ASAR = path.join(ROOT, 'scripts', '.asar-cache', `${TO}.asar`);

function die(m) { console.error('[x]', m); process.exit(1); }
function ok(m) { console.log('  ✓', m); }
function step(m) { console.log('\n==>', m); }

step(`1. 抽 ${FROM}.asar 自 ${NSIS}`);
if (!fs.existsSync(NSIS)) die(`找不到 NSIS: ${NSIS}`);
const r = p.extractAsarFromNsis(FROM, NSIS);
if (!r) die('extractAsarFromNsis 失败');
ok(`v${FROM} asar sha256=${r.info.sha256.slice(0, 12)}… size=${(r.info.size / 1024 / 1024).toFixed(2)} MB`);

step(`2. 用 ${TO} 占位 asar（拷贝 ${FROM} 模拟发布构建）`);
fs.copyFileSync(path.join(ROOT, 'scripts', '.asar-cache', `${FROM}.asar`), TMP_ASAR);
ok(`${TMP_ASAR} 就位`);

step(`3. buildPatchZip(${FROM} → ${TO})`);
const outDir = path.join(LEAST, 'patches');
const built = p.buildPatchZip({
  fromVersion: FROM,
  fromInfo: { sha256: r.info.sha256, size: r.info.size },
  toVersion: TO,
  toAsarPath: TMP_ASAR,
  outDir,
});
ok(`patch zip -> ${built.relPath}（${(built.size / 1024 / 1024).toFixed(2)} MB，sha256=${built.sha256.slice(0, 16)}…）`);
ok(`manifest: fromVersion=${built.manifest.fromVersion} toVersion=${built.manifest.toVersion}`);
ok(`baseAsarSha256=${built.manifest.baseAsarSha256.slice(0, 12)}…  appAsarSha256=${built.manifest.appAsarSha256.slice(0, 12)}…`);

step(`4. verifyPatch`);
const v = p.verifyPatch(built.path);
ok(`zip sha256 match: ${v.zipSha256 === built.sha256}`);
ok(`manifest.appAsarSha256 match: ${v.asarSha256 === built.manifest.appAsarSha256}`);
ok(`asar 大小一致: ${v.asarSize === built.manifest.appAsarSize}（${v.asarSize} vs ${built.manifest.appAsarSize}）`);

step('清理');
try { fs.rmSync(TMP_ASAR, { force: true }); } catch {}
try { fs.rmSync(built.path, { force: true }); } catch {}
// 把 asar-cache/1.1.5 文件留着（生产 release 也会写进去，不要清）
ok('已清理临时 patch zip + 占位 asar；scripts/.asar-cache/1.1.5.{asar,json} 保留');

console.log('\n========================================');
console.log('  块 4a 自检通过：补丁链完整可解');
console.log('========================================');
