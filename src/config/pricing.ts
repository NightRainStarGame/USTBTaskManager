/**
 * 定价与配额常量（v1.2.5 班级服务）
 *
 * 改这里一处 → UI 文案、配额阈值、月卡状态展示全部联动。
 *
 * ⚠️ 服务端 `server/src/lib/voucher.ts` 也有同源常量（expDays = 30），
 *    改价 / 改时长时两端必须同步。
 */

export const PRICING = {
  /** 月卡 SKU */
  MONTHLY: {
    /** 单价（元） */
    priceYuan: 6.6,
    /** 有效期（自然日） */
    days: 30,
    /** 可开班级数 */
    classesLimit: 1,
    /** 月付单图上传上限（MB） */
    imageSizeMB: 100,
  },
  /** 免费版 */
  FREE: {
    /** 免费单图上传上限（MB） */
    imageSizeMB: 10,
  },
  /** 到期前 N 天顶部黄/红警示条触发 */
  EXPIRY_WARN_DAYS: 3,
} as const;

/** 旧 SKU 兼容：基础码（预留，单 SKU 时不渲染） */
export const HAS_BASIC_PLAN = false;