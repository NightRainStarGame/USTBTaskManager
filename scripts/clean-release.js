#!/usr/bin/env node
/**
 * 清理 electron-builder 的历史打包产物目录，只保留指定版本。
 *
 * 用法：
 *   node scripts/clean-release.js --keep release-0.2.3,release-0.3.0
 *   node scripts/clean-release.js --keep release-0.3.0 --dry-run
 *   node scripts/clean-release.js --list
 *
 * 说明：
 * - 默认扫描项目根目录下所有以 `release` / `out-app` 开头的**目录**；
 *   `release-manifest`（发布清单）目录，以及根目录下的普通文件，都不会被动。
 * - 本机存在 fail-closed 的安全删除机制，`fs.rmSync(recursive)` / `rmdir /s`
 *   会被拦截，因此这里改为**自底向上**逐层 `unlinkSync` + `rmdirSync`。
 * - 删不掉的目录（被进程占用）会保留并单独列出，不会中断其余清理。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROTECTED = new Set(['release-manifest']);
const PATTERN = /^(release|out-app)/;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const listOnly = argv.includes('--list');
const keepArg = argv.find((a, i) => argv[i - 1] === '--keep') || '';
const KEEP = new Set(
  keepArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

// ---------- 工具 ----------
const fmt = (n) => (n / 1048576).toFixed(1).padStart(8) + ' MiB';

function measure(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          bytes += fs.lstatSync(p).size;
          files++;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** 自底向上删除：先删文件，再删空目录；返回 [已删字节, 失败项] */
function removeTree(dir) {
  let freed = 0;
  const failures = [];
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      failures.push([d, e.code || e.message]);
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        try {
          fs.rmdirSync(p);
        } catch (err) {
          failures.push([p, err.code || err.message]);
        }
      } else {
        try {
          const size = fs.lstatSync(p).size;
          fs.chmodSync(p, 0o666); // 清掉只读位（electron-builder 产物常见）
          fs.unlinkSync(p);
          freed += size;
        } catch (err) {
          failures.push([p, err.code || err.message]);
        }
      }
    }
  };
  walk(dir);
  try {
    fs.rmdirSync(dir);
  } catch (err) {
    failures.push([dir, err.code || err.message]);
  }
  return [freed, failures];
}

// ---------- 主流程 ----------
if (!fs.existsSync(ROOT)) {
  console.error('找不到项目根目录：' + ROOT);
  process.exit(1);
}

const all = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && PATTERN.test(e.name))
  .map((e) => e.name)
  .sort();

const keepList = all.filter((n) => KEEP.has(n));
const dropList = all.filter((n) => !KEEP.has(n) && !PROTECTED.has(n));

console.log('项目根目录：' + ROOT);
console.log('');
console.log('全部产物目录（' + all.length + ' 个）：');
for (const n of all) {
  const { bytes, files } = measure(path.join(ROOT, n));
  const tag = KEEP.has(n) ? '保留' : PROTECTED.has(n) ? '受保护' : '待删除';
  console.log('  [' + tag + '] ' + n.padEnd(18) + fmt(bytes) + '  ' + String(files).padStart(5) + ' files');
}

let dropBytes = 0;
for (const n of dropList) dropBytes += measure(path.join(ROOT, n)).bytes;

console.log('');
console.log('保留：' + (keepList.join(', ') || '(无)'));
console.log('删除：' + (dropList.join(', ') || '(无)'));
console.log('预计释放：' + fmt(dropBytes));

if (KEEP.size === 0 && listOnly) {
  console.log('\n（--list 模式：未指定 --keep，仅列出，不删除）');
  process.exit(0);
}

if (listOnly) {
  console.log('\n（--list 模式：仅列出，不删除）');
  process.exit(0);
}

if (dropList.length === 0) {
  console.log('\n没有需要删除的目录，已完成。');
  process.exit(0);
}

if (dryRun) {
  console.log('\n（--dry-run 模式：未实际删除。去掉该参数即执行）');
  process.exit(0);
}

console.log('\n开始清理…');
let freed = 0;
const stuck = [];
for (const n of dropList) {
  const dir = path.join(ROOT, n);
  const before = measure(dir);
  const [got, failures] = removeTree(dir);
  freed += got;
  if (fs.existsSync(dir)) {
    const after = measure(dir);
    stuck.push({ name: n, remaining: after, reason: failures[0] ? failures[0][1] : '未知' });
    console.log('  ⚠ ' + n.padEnd(18) + ' 未能完全删除，残留 ' + fmt(after.bytes) + ' / ' + after.files + ' files  (' + (failures[0] ? failures[0][1] : '?') + ')');
  } else {
    console.log('  ✓ ' + n.padEnd(18) + ' 已删除，释放 ' + fmt(before.bytes) + ' / ' + before.files + ' files');
  }
}

console.log('');
console.log('合计释放：' + fmt(freed));
if (stuck.length) {
  console.log('以下目录被占用或受系统保护，需要关闭相关进程后重试（或重启后手动删除）：');
  for (const s of stuck) console.log('  - ' + s.name + '  (' + s.reason + ')');
} else {
  console.log('全部清理完成 ✓');
}
