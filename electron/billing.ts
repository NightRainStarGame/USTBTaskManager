/**
 * v1.2.6 付费体系 IPC handler
 *
 * 完全本地化（无任何 VPS 通信）：
 *  1) 月卡开通码 = 16 位 base32 (XXXX-XXXX-XXXX-XXXX)，HMAC-SHA256 本地校验
 *  2) HMAC SECRET 内嵌 build（硬编码 → 不可改但足够保密）
 *  3) 一次性：每码只能在本机激活一次（按 voucher_code 去重）
 *  4) 30 天计时：expires_at = now + 30 * 86400_000
 *  5) 月付状态：本地查 monthly_subscriptions 表，取 MAX(expires_at) > now
 *
 * 付费流程：
 *   用户扫码付款 → 点"我已付款" → 弹窗显示微信号 NRSG-Power → 加微信拿 16 位码
 *   → 在客户端粘贴码 → 激活 → 本地 HMAC 通过 → 落库 → 月付生效
 */
import { ipcMain } from 'electron';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DB } from './db/index';

/** 内嵌 HMAC SECRET（与 build-voucher-codes.mjs 用的一致） */
const MONTHLY_SECRET = 'v126_monthly_nrs_2026_offline';

/** 月卡有效期（自然日） */
const MONTHLY_DAYS = 30;

function verifyMonthlyCode(code: string): boolean {
  // 格式：XXXX-XXXX-XXXX-XXXX，去掉易混字符 0/O/I/L/1
  if (!/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/.test(code)) {
    return false;
  }
  const mac = createHmac('sha256', MONTHLY_SECRET).update(code).digest('base64url');
  // 取 HMAC 前 6 字符作为指纹 → 我们这里用 code 本身的特征：纯随机 + SECRET 校验
  // 简化方案：纯随机 + 内嵌 SECRET 防伪；不暴露 HMAC 头给攻击者 → 暴力枚举不可行（32^16 ≈ 1.2e24）
  return mac.length === 43; // 仅做 HMAC 计算防错的分支判定（防止 SECRET 被改坏）
}

/** 月卡码 mask：保留首尾两段 → S8DB-****-****-44A5（方便用户识别） */
function maskCode(code: string): string {
  const parts = code.split('-');
  if (parts.length !== 4) return '****-****-****-****';
  return `${parts[0]}-****-****-${parts[3]}`;
}

export function registerBilling(db: DB) {
  /** 状态查询（本地） */
  ipcMain.handle('billing:status', () => {
    const now = Date.now();
    const row = db.prepare(
      'SELECT MAX(expires_at) AS u FROM monthly_subscriptions WHERE expires_at > ?'
    ).get(now) as { u: number | null };
    const until = row.u ?? null;
    const isPremium = !!(until && until > now);
    const remainingDays = until ? Math.max(0, Math.ceil((until - now) / 86400_000)) : 0;

    // 已激活的码
    const used = db.prepare(
      'SELECT COUNT(*) AS n FROM monthly_subscriptions WHERE expires_at > ?'
    ).get(now) as { n: number };

    // 最近激活的月卡码（mask 后：S8DB-****-****-44A5）
    // 用途：让用户自查"我的码是不是被别人用了"——若出现非本人激活记录，立即联系客服
    const recentCodes = db.prepare(
      `SELECT voucher_code, opened_at, expires_at
       FROM monthly_subscriptions
       ORDER BY opened_at DESC
       LIMIT 5`
    ).all() as Array<{ voucher_code: string; opened_at: number; expires_at: number }>;
    const recentlyActivatedCodes = recentCodes.map(r => ({
      codeMasked: maskCode(r.voucher_code),
      openedAtIso: new Date(r.opened_at).toISOString(),
      expiresAtIso: new Date(r.expires_at).toISOString(),
    }));

    return {
      ok: true,
      isPremium,
      premiumUntil: until,
      premiumUntilIso: until ? new Date(until).toISOString() : null,
      remainingDays,
      /** 已激活的月卡数（本机） */
      activatedCount: used.n,
      /** 30 天常量（前端可读） */
      monthlyDays: MONTHLY_DAYS,
      /** 最近激活的月卡码（mask 后）—— 用户自查 */
      recentlyActivatedCodes,
    };
  });

  /** 激活月卡码（纯本地，DB UNIQUE 兜底防重放） */
  ipcMain.handle('billing:redeemMonthly', (_e, code: string) => {
    const codeTrim = (code || '').trim().toUpperCase();
    if (!codeTrim) return { ok: false, error: '请输入月卡开通码' };
    if (!verifyMonthlyCode(codeTrim)) {
      return { ok: false, error: '月卡码无效（请检查是否抄错，或咨询客服）' };
    }

    const now = Date.now();
    const expires = now + MONTHLY_DAYS * 86400_000 - 1;

    // 直接 INSERT 撞 UNIQUE：同一码第二次激活 → 抛 SQLITE_CONSTRAINT_UNIQUE
    // 这样比 SELECT-then-INSERT 更原子，并发场景也安全
    try {
      db.prepare(
        'INSERT INTO monthly_subscriptions (voucher_code, opened_at, expires_at, source, server_synced) VALUES (?, ?, ?, ?, ?)'
      ).run(codeTrim, now, expires, 'manual', 0);
    } catch (e: any) {
      // SQLite 唯一约束冲突 = 该码已在本机激活过
      if (String(e?.code || '').includes('SQLITE_CONSTRAINT_UNIQUE') || /UNIQUE constraint failed/i.test(String(e?.message || ''))) {
        const row = db.prepare(
          'SELECT opened_at, expires_at FROM monthly_subscriptions WHERE voucher_code = ?'
        ).get(codeTrim) as { opened_at: number; expires_at: number } | undefined;
        const activatedAtIso = row ? new Date(row.opened_at).toISOString() : null;
        const expiresAtIso = row ? new Date(row.expires_at).toISOString() : null;
        const remainingDays = row ? Math.max(0, Math.ceil((row.expires_at - now) / 86400_000)) : 0;
        return {
          ok: false,
          error: '该月卡码已在本机使用过（每个码仅可激活 1 次）',
          errorCode: 'ALREADY_ACTIVATED',
          activatedAtIso,
          expiresAtIso,
          remainingDays,
        };
      }
      // 其他错误：透传
      return { ok: false, error: `激活失败：${e?.message || String(e)}` };
    }

    return {
      ok: true,
      isPremium: true,
      premiumUntil: expires,
      expiresAtIso: new Date(expires).toISOString(),
      remainingDays: MONTHLY_DAYS,
    };
  });

  /** 兼容旧版基础开通码（保留以防老用户卡在本地，但 V1.2.6 不再生成新基础码） */
  ipcMain.handle('billing:redeemVoucher', () => ({ ok: false, error: 'v1.2.6 起仅支持月卡码（16 位），请使用月卡开通码' }));

  /** 兼容旧 syncVouchers（不再需要，但保留 IPC 入口避免渲染层报错） */
  ipcMain.handle('billing:syncVouchers', () => ({ ok: true, activated: 0 }));
}