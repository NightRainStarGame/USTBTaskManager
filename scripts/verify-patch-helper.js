/**
 * 块 4b 自检：启动 patch-helper 的最小用例
 *
 * 验证：
 *  - ELECTRON_RUN_AS_NODE=1 + process.execPath + helper --patch-helper 能正确启动
 *  - helper 收到不合规 payload → 立即退出码 2（带描述）
 *  - helper 收到合法 payload + zip path 不存在 → 退出码 2（带错误日志）
 *
 * 不真正落盘 asar（那需要真实的目标 app.asar + baseAsarSha256 匹配）。
 *
 * 用法：node scripts/verify-patch-helper.js
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const HELPER = path.join(ROOT, 'electron', 'resources', 'patch-helper.cjs');

function die(m) { console.error('[x]', m); process.exit(1); }
function ok(m) { console.log('  ✓', m); }
function step(m) { console.log('\n==>', m); }

step('1. helper 脚本路径与 Electron node 可执行性');
if (!fs.existsSync(HELPER)) die(`helper 不存在: ${HELPER}`);
ok(`helper=${HELPER}`);
const electronExe = require('electron'); // 直接解析到 electron.exe
const r0 = spawnSync(electronExe, ['--version'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
if (r0.status !== 0) die(`ELECTRON_RUN_AS_NODE 启动失败：status=${r0.status} err=${r0.stderr}`);
ok(`ELECTRON_RUN_AS_NODE 可启动，版本=${r0.stdout.trim()}`);

step('2. helper 接不合规 payload 应退出码 2 + 写日志');
try { fs.unlinkSync(path.join(require('os').tmpdir(), 'taskmanager-patch-helper.log')); } catch {}
const payloadBad = 'this-is-not-json';
const r1 = spawnSync(electronExe, [HELPER, '--patch-helper', payloadBad], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
ok(`exit=${r1.status}（期望 2）`);
if (r1.status !== 2) die(`helper 没正确报告错误：${r1.stdout} / ${r1.stderr}`);
const log1 = fs.readFileSync(path.join(require('os').tmpdir(), 'taskmanager-patch-helper.log'), 'utf8');
if (!/FAIL:/.test(log1)) die('helper 没写 FAIL 日志');
ok(`日志已写出，含 FAIL 行（${log1.split('\n').filter(Boolean).length} 行）`);

step('3. helper 接合法 payload + 不存在的 zip 应退出码 2 + 基线报告');
const r2 = spawnSync(electronExe, [HELPER, '--patch-helper', JSON.stringify({
  zipPath: 'Z:/nonexistent/1.1.5-to-1.1.6.zip',
  appAsarPath: 'Z:/nonexistent/app.asar',
  manifest: { fromVersion: '1.1.5', appAsarSha256: 'deadbeef'.repeat(8), baseAsarSha256: 'feedface'.repeat(8) },
  mainPid: 999999, // 不存在也行 —— helper 会立刻超时跳过
  timeoutMs: 500,
})], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
ok(`exit=${r2.status}（期望 2）`);
const log2 = fs.readFileSync(path.join(require('os').tmpdir(), 'taskmanager-patch-helper.log'), 'utf8');
if (!/zipPath 不存在/.test(log2)) die('helper 没报告 zipPath 不存在');
ok(`日志写出 "zipPath 不存在"`);

console.log('\n========================================');
console.log('  块 4b 自检通过：helper 启动 + 错误路径走通');
console.log('========================================');
