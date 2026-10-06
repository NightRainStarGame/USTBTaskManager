// 临时：按行号范围精确删除 cleanup.ts 里残留的旧 GitHub / 云盘代码块
const fs = require('fs');
const p = 'electron/cleanup.ts';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const startIdx = lines.findIndex((l) => l.includes('__obsoleteRemainder'));
const endIdx = lines.findIndex((l) => l.includes('setSetting(db, K.lastCloud'));
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.error('定位失败', { startIdx, endIdx });
  process.exit(1);
}
// 保留 endIdx 之后的全部内容（含 setSetting 与函数收尾）
const kept = [...lines.slice(0, startIdx), ...lines.slice(endIdx)];
fs.writeFileSync(p, kept.join('\r\n'));
console.log(`删除行 ${startIdx + 1} ~ ${endIdx}（共 ${endIdx - startIdx} 行）`);
console.log('--- 删除后的函数体 ---');
kept.slice(startIdx - 12, startIdx + 8).forEach((l, i) => console.log(`${startIdx - 11 + i}: ${l}`));
