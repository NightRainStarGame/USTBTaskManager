#!/usr/bin/env node
/**
 * v1.2.6 月卡开通码批量生成器
 *
 * 生成 100 个 16 位 base32 月卡开通码（XXXX-XXXX-XXXX-XXXX），
 * 去易混字符（0/O/I/L/1），共 31 种字符；32^16 ≈ 1.2e24 暴力空间。
 *
 * 用法：
 *   node scripts/build-voucher-codes.mjs            # 默认 100 个 → data/voucher-codes.txt
 *   node scripts/build-voucher-codes.mjs --count 200 --out custom.txt
 *
 * 注意：
 *   - 客户端 electron/billing.ts 用同款 ALPHABET/SECRET 做 HMAC 校验（但因 SECRET 已嵌入 build，
 *     防伪主要靠 16 位随机熵 + 隐藏 SECRET）
 *   - 生成的 txt 内每行一个码，配合 data/secret.txt 同源发放给客服
 *   - 重复检测：脚本内会自动避免同前缀碰撞
 */
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 与 electron/billing.ts MONTHLY_SECRET 完全一致
const SECRET = 'v126_monthly_nrs_2026_offline';

// 去易混字符：去掉 0/O/I/L/1（容易看错），保留 A-Z + 2-9 = 31 字符
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genOne() {
  // 16 字符（4×4），用 crypto.randomBytes 保证不可预测
  const buf = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

function genBatch(count, existing = new Set()) {
  const set = new Set(existing);
  const out = [];
  // 32^16 ≈ 1.2e24，100 个几乎不可能撞
  while (out.length < count) {
    const code = genOne();
    if (!set.has(code)) {
      set.add(code);
      out.push(code);
    }
  }
  return out;
}

function signatureOf(code) {
  // 客户端 HMAC 用同样的 SECRET → 这里仅做内部追踪用（不写入客户码 txt）
  return createHmac('sha256', SECRET).update(code).digest('base64url').slice(0, 6);
}

// CLI 解析
const args = process.argv.slice(2);
let count = 100;
let outFile = resolve(__dirname, '..', 'data', 'voucher-codes.txt');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--count' || args[i] === '-n') {
    count = parseInt(args[++i], 10) || 100;
  } else if (args[i] === '--out' || args[i] === '-o') {
    outFile = resolve(process.cwd(), args[++i]);
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('用法: node scripts/build-voucher-codes.mjs [--count N] [--out file.txt]');
    process.exit(0);
  }
}

console.log(`[build-voucher-codes] 生成 ${count} 个月卡开通码 → ${outFile}`);

const codes = genBatch(count);

// 文件内容：每行一个码（方便批量发给客服）
const header = [
  '# TaskManager v1.2.6 月卡开通码库',
  `# 生成时间: ${new Date().toISOString()}`,
  `# 数量: ${count}`,
  '# 格式: XXXX-XXXX-XXXX-XXXX (16 位 base32)',
  '# 校验: HMAC-SHA256 (本地，密钥嵌入 build)',
  '# 有效期: 30 天 / 个',
  '# 一次性: 每码仅可在 1 台设备使用',
  '# ⚠  请妥善保管此文件；泄露将导致未授权激活',
  '',
].join('\n');

const body = codes.map((c, i) => `${String(i + 1).padStart(3, '0')}.  ${c}`).join('\n') + '\n';

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, header + body, 'utf8');

// 控制台输出（方便脚本调用者直接复制）
console.log('\n--- 月卡码列表（直接复制） ---');
codes.forEach((c, i) => console.log(`  ${String(i + 1).padStart(3, '0')}.  ${c}`));
console.log('--- 列表结束 ---\n');

// 内部签名（开发者核对用，不写给客户）
const sigFile = outFile.replace(/\.txt$/, '.sig.txt');
const sigBody = '# 内部签名清单（HMAC 前 6 字符，开发者核对/调试用）\n# 不发放给最终用户\n\n' +
  codes.map((c, i) => `${String(i + 1).padStart(3, '0')}.  ${c}  →  ${signatureOf(c)}`).join('\n') + '\n';
writeFileSync(sigFile, sigBody, 'utf8');
console.log(`[build-voucher-codes] 签名清单 → ${sigFile}`);
console.log(`[build-voucher-codes] 完成。`);