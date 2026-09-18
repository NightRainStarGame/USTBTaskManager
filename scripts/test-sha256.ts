import { createHash } from 'node:crypto';
import { sha256, hmacSha256, createHash as mCreateHash, createHmac as mCreateHmac } from '../src/mobile/sha256';

const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

function check(name: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n  got : ${got}\n  want: ${want}`}`);
  if (!ok) process.exitCode = 1;
}

// 与 node:crypto 逐项对照
const vectors: Array<[string, string]> = [
  ['', ''],
  ['abc', 'x'],
  ['hello world 中文测试', 'x'],
  ['a'.repeat(55), 'x'],
  ['a'.repeat(56), 'x'],
  ['a'.repeat(57), 'x'],
  ['a'.repeat(63), 'x'],
  ['a'.repeat(64), 'x'],
  ['a'.repeat(65), 'x'],
  ['a'.repeat(1000), 'x'],
  [JSON.stringify({ a: 1, b: '中文' }), 'x'],
];

for (const [msg] of vectors) {
  const want = createHash('sha256').update(msg).digest('hex');
  check(`sha256(${JSON.stringify(msg).slice(0, 30)}…len=${msg.length})`, hex(sha256(msg)), want);
}

// HMAC 对照（覆盖 key <64 / =64 / >64 字节三种情况）
const hmacVectors: Array<[string, string]> = [
  ['key', 'The quick brown fox jumps over the lazy dog'],
  ['StarOS-Homework-Code-v1', 'publish:GWSVNFSX'],
  ['k'.repeat(64), 'msg-64byte-key'],
  ['k'.repeat(100), 'msg-long-key'],
  ['', 'empty-key-message'],
];
for (const [k, m] of hmacVectors) {
  const want = createHash('sha256'); // placeholder to keep import used
  void want;
  const nodeHmac = require('node:crypto').createHmac('sha256', k).update(m).digest('hex');
  check(`hmac(key.len=${k.length}, ${m.slice(0, 20)}…)`, hex(hmacSha256(k, m)), nodeHmac);
}

// 链式 API 与 digest('hex') 风格（backup/core.ts 的用法）
const chainHex = (mCreateHash('sha256').update('{"a":1}', 'utf8').digest('hex') as string);
check("createHash().update().digest('hex')", chainHex, createHash('sha256').update('{"a":1}', 'utf8').digest('hex'));

// homework 码制真实算法对照：ALPHABET[HMAC('publish:'+syncCode)[i] % 31]
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const syncCode = 'GWSVNFSX';
const nodeMac = require('node:crypto').createHmac('sha256', 'StarOS-Homework-Code-v1').update(`publish:${syncCode}`).digest() as Buffer;
const shimMac = mCreateHmac('sha256', 'StarOS-Homework-Code-v1').update(`publish:${syncCode}`).digest() as Uint8Array;
let nodeCode = '', shimCode = '';
for (let i = 0; i < 12; i++) {
  nodeCode += ALPHABET[nodeMac[i] % 31];
  shimCode += ALPHABET[shimMac[i] % 31];
}
check('publishCode 派生（node vs shim）', shimCode, nodeCode);
console.log('publishCode =', nodeCode);

console.log(process.exitCode ? '\n== 有失败 ==' : '\n== 全部通过 ==');
