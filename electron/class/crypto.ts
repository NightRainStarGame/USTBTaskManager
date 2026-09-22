/**
 * 班级系统密码学工具（v1.2.7 起，P2P 班级）
 *
 * 双码制（key derivation）：
 *   - classCode (8 位)：班级 ID，公开
 *   - inviteCode (12 位)：classCode + HMAC(CLASS_SECRET, classCode) 前 4 位校验
 *     任何客户端拿到 inviteCode → 校验 HMAC 通过 → classCode 自包含
 *
 * 成员签名（去中心化身份验证）：
 *   sig = HMAC(CLASS_SECRET, alias|classCode|role).slice(0, 16)
 *   任何人持 SECRET → 都能验证成员签名真实性 → 没有中心服务器也能识别
 *
 * 暴力枚举成本（同码制分析）：
 *   · classCode 字符表 31 个 → 31^8 ≈ 8.5e11 ≈ 8500 亿
 *   · 但 HMAC 4 位校验让"看似合法"的码通过率 = 1/31^4 ≈ 1/92万
 *   · 即暴力枚举也得走完整 SECRET 计算，CPU 拒服务不划算
 */
import { createHmac, randomBytes } from 'node:crypto';

export const CLASS_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CLASS_CODE_LEN = 8;
const INVITE_CODE_LEN = 12;

/** 班级系统 HMAC 密钥（与 MONTHLY_SECRET 同源策略：嵌入 build，不进 git） */
export const CLASS_SECRET = 'StarOS-Class-P2P-v1';

function bytesToCode(buf: Buffer, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CLASS_CODE_ALPHABET[buf[i] % CLASS_CODE_ALPHABET.length];
  return s;
}

/** 生成新的 classCode（8 位） */
export function generateClassCode(): string {
  return bytesToCode(randomBytes(CLASS_CODE_LEN), CLASS_CODE_LEN);
}

/** 生成 ownerToken（32 字节 base64url，HMAC 签名权限凭证） */
export function generateOwnerToken(): string {
  return randomBytes(32).toString('base64url');
}

/** inviteCode = classCode + HMAC 前 4 位 */
export function deriveInviteCode(classCode: string): string {
  const s = (classCode || '').trim().toUpperCase();
  if (s.length !== CLASS_CODE_LEN) throw new Error('classCode 长度必须为 8');
  const mac = createHmac('sha256', CLASS_SECRET).update(`invite:${s}`).digest();
  return s + bytesToCode(mac, INVITE_CODE_LEN - CLASS_CODE_LEN);
}

/** 校验 inviteCode 并提取 classCode；非法返回 null */
export function parseInviteCode(raw: string): string | null {
  const p = (raw || '').trim().toUpperCase();
  if (p.length !== INVITE_CODE_LEN) return null;
  const code = p.slice(0, CLASS_CODE_LEN);
  if (deriveInviteCode(code) !== p) return null;
  return code;
}

/** 格式化输入（用户可能加空格/小写/中文逗号） */
export function normalizeInviteCode(raw: string): string | null {
  return parseInviteCode(String(raw || '').replace(/[\s,，]/g, ''));
}

/** 成员签名（防止云盘文件被中间人篡改） */
export function signMember(alias: string, classCode: string, role: string): string {
  const a = (alias || '').trim();
  if (!a) throw new Error('alias 不能为空');
  return createHmac('sha256', CLASS_SECRET)
    .update(`member:${classCode}|${a}|${role}`)
    .digest('base64url')
    .slice(0, 16);
}

/** 校验成员签名 */
export function verifyMember(alias: string, classCode: string, role: string, sig: string): boolean {
  try {
    const expect = signMember(alias, classCode, role);
    return expect === (sig || '').trim();
  } catch {
    return false;
  }
}

/** 公告 / 作业条目的内容签名（防篡改） */
export function signEntry(classCode: string, kind: 'announcement' | 'task', id: number | string, body: string): string {
  return createHmac('sha256', CLASS_SECRET)
    .update(`entry:${classCode}|${kind}|${id}|${body}`)
    .digest('base64url')
    .slice(0, 16);
}

/** 校验条目签名 */
export function verifyEntry(classCode: string, kind: 'announcement' | 'task', id: number | string, body: string, sig: string): boolean {
  try {
    return signEntry(classCode, kind, id, body) === (sig || '').trim();
  } catch {
    return false;
  }
}

/** 把签名抹掉用于日志展示（owner_token 等敏感字段不外泄） */
export function maskCode(code: string): string {
  const s = (code || '').trim().toUpperCase();
  if (s.length !== INVITE_CODE_LEN) return '****-****-****';
  return `${s.slice(0, 4)}-****-${s.slice(-4)}`;
}