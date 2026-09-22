#!/usr/bin/env node
/**
 * v1.2.9 R9：把 fine-grained PAT 编码成拆段 base64，填进 electron/class/storage.ts
 * 的 FALLBACK_TOKEN_B64 数组（内置公共写入令牌）。
 *
 * 用法：node scripts/encode-class-token.cjs github_pat_xxxxxxxx
 * 输出：直接可粘贴的 TS 数组片段 + 验证解码。
 */
const raw = process.argv[2];
if (!raw || !/^github_pat_[A-Za-z0-9_]+$/.test(raw)) {
  console.error('用法: node scripts/encode-class-token.cjs github_pat_XXXX  （必须是 fine-grained PAT）');
  process.exit(1);
}
// 按 4 段切（段长均衡即可，无安全含义——防的是 grep 整串直提）
const N = 4;
const size = Math.ceil(raw.length / N);
const parts = [];
for (let i = 0; i < N; i++) parts.push(raw.slice(i * size, (i + 1) * size));
const b64 = parts.map((p) => Buffer.from(p, 'utf8').toString('base64'));
// 验证
const decoded = b64.map((p) => Buffer.from(p, 'base64').toString('utf8')).join('');
if (decoded !== raw) { console.error('!! 编码验证失败'); process.exit(1); }
console.log('把下面数组粘贴进 electron/class/storage.ts 的 FALLBACK_TOKEN_B64：\n');
console.log('const FALLBACK_TOKEN_B64: string[] = [');
for (const b of b64) console.log(`  '${b}',`);
console.log('];');
console.log(`\n已验证：解码 == 原令牌（${raw.length} 字符，${N} 段）`);
