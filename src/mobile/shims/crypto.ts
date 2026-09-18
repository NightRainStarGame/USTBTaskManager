/**
 * node:crypto shim —— 同步摘要走纯 JS 实现（见 ../sha256.ts），
 * 随机数走 WebCrypto。与桌面端 Node crypto 行为对齐（仅覆盖本项目用到的 API）。
 */
import {
  createHash, createHmac, randomBytes, randomUUID,
} from '../sha256';

export { createHash, createHmac, randomBytes, randomUUID };
export default { createHash, createHmac, randomBytes, randomUUID };
