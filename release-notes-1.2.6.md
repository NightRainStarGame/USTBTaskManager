# v1.2.6 更新说明

> 本次为「付费体系纯本地化」发版。把 v1.2.5 依赖 VPS 服务端的班级/月卡验证，**彻底改为离线模式**：
> 收款码 + 加客服微信拿码 + 本地 HMAC 校验，不再需要服务端。

## 🆕 新功能

### 1. 纯本地月卡（扫码 → 加微信 → 拿码 → 激活）

v1.2.6 起，月卡激活**完全在本机进行**，无任何云端通信：

- **流程**：扫码付款 → 点「我已付款」→ 弹窗显示客服微信 `NRSG-Power` → 加微信发送付款截图 → 客服核对后发送 **16 位月卡开通码**（`XXXX-XXXX-XXXX-XXXX` 格式）
- **本地校验**：客户端 HMAC-SHA256 校验通过即激活，立即开通 **30 天月卡**
- **安全强化**（**新增 UNIQUE 防重放**）：
  - 数据库层加 `UNIQUE INDEX` 约束 `voucher_code`，**一个码只能在本机激活一次**
  - 第二次输入同码 → 明确弹错「❌ 该月卡码已在本机使用过（YYYY-MM-DD 激活 → YYYY-MM-DD 到期）」
  - 并发/竞态攻击也无效（SQLite 引擎兜底，不依赖应用层 SELECT 判断）

### 2. 激活记录（用户自查）

设置 → 月卡与付费 → **新增「激活记录」行**，显示最近 5 条已激活月卡码：

```
S8DB-****-****-44A5  ·  激活 2026-09-22  →  到期 2026-10-22
85WD-****-****-P7CT  ·  激活 2026-09-22  →  到期 2026-10-22
```

格式：`首段-****-****-尾段`（保留首尾两段方便用户识别自己用过的码）。**若出现非本人激活记录，说明码已泄漏，请立即联系客服。**

### 3. 收款码 + 客服微信 modal

设置 → 月卡与付费 → 点「✓ 我已付款」→ 弹出客服微信号 `NRSG-Power` + 5 步操作指引（扫码 → 加微信 → 发截图 → 拿码 → 粘贴激活），点击微信号自动复制到剪贴板。

## 🗑️ 移除（彻底删除 VPS 付费链路）

v1.2.5 引入的 VPS 付费验证链路**全部下线**（v1.2.6 起不需要任何服务端）：

- **删** `electron/serverClient.ts`（服务端 HTTP 客户端）
- **删** `electron/classes.ts`（班级系统，远端依赖）
- **删** `src/pages/Classes.tsx`（班级页面）
- **删** `src/pages/Groups.tsx`（v1.2.5 已删的旧小组清单）
- **删** `server/` 整个目录（Fastify + better-sqlite3 服务端代码 + VPS 安装脚本）
- **删** Sidebar 班级入口 + App.tsx `/classes` 路由 + 相关 IPC handlers
- **删** `electron/classes.ts` / `electron/serverClient.ts` 在 `api-factory.ts` / `ipc/index.ts` 的注册
- **删** `src/components/PremiumBanner.tsx`（付费入口组件，改用设置页内联）

**保留的兼容占位**（仅 IPC 入口不再生成新内容）：
- `billing:redeemVoucher` → 返回「v1.2.6 起仅支持月卡码」
- `billing:syncVouchers` → 返回 `ok: true, activated: 0`
- DB 表 `monthly_subscriptions / voucher_purchases / device_profile / classes / class_members / class_tasks / announcements / read_logs / tasks` 全部保留（老用户的本地数据不丢，但不再使用）

## 🛠 技术细节

### 月卡码生成 + 校验（本地 HMAC）

- **码生成器** `scripts/build-voucher-codes.mjs`：用 `crypto.randomBytes` 生成 100 个 16 位 base32 码（去易混字符 0/O/I/L/1），HMAC-SHA256 摘要写 `data/voucher-codes.sig.txt`（仅开发者核对用）
- **码清单** `data/voucher-codes.txt`：100 个码 + 注释（含生成时间、用途警告），**手工交付给客服**
- **客户端校验**：`MONTHLY_SECRET` 嵌入 build（硬编码，与生成器同一份），校验后格式串 + HMAC 即可
- **暴力枚举不可行**：16 位去易混字符 ≈ 32^16 ≈ 1.2e24 种可能

### 防重放机制

- **`db/index.ts`** 加 `CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_subscriptions_voucher ON monthly_subscriptions(voucher_code)`
- **`billing:redeemMonthly`** 直接 INSERT 撞 UNIQUE，捕获 `SQLITE_CONSTRAINT_UNIQUE` 错误 → 返回 `errorCode: 'ALREADY_ACTIVATED'` + 激活时间
- **优势**：原子化（并发安全）、DB 层兜底（即使应用层有 bug 也防得住）、用户体验清晰（明确告知已被使用）

### 离线模式的天花板

⚠️ **跨机防重放做不到**：同一个码发给用户 A，用户 A 截图转发给同学 C，C 拿到后在自己的机器能正常激活（因为 C 的本地 DB 无此码的激活记录）。这是离线月卡的固有限制（Steam gift card 同理）。
**客服发码规范**：每个码只发 1 个人，**不截图发群**（OCR 库会自动收集）。若用户举报「码没用就提示已激活」，客服可核对 `data/voucher-codes.txt` 看是否发重。

## 🛠 升级说明

- 已装 v1.2.5 的用户：自动应用增量补丁 ~2MB，无需重装
- 新装用户：下载完整安装包 ~97MB
- **数据库自动迁移**：新增 UNIQUE 索引，老库的重复码（如有）会被自动去重保护
- 数据无损保留，无需迁移
- **完全离线**：v1.2.6 起无需任何网络通信（月卡激活、班级功能全部下线）

## 📂 给客服的资料

```
data/voucher-codes.txt        ← 100 个有效月卡码
data/voucher-codes.sig.txt    ← HMAC 摘要（开发者核对用，不发放）
```

## 📋 文件清单

**新增**：
- `data/voucher-codes.txt`（100 个码，本地，**不进 git**）
- `data/voucher-codes.sig.txt`（HMAC 摘要，**不进 git**）
- `scripts/build-voucher-codes.mjs`（码生成器）

**删除**：
- `electron/serverClient.ts`
- `electron/classes.ts`
- `src/pages/Classes.tsx`
- `src/pages/Groups.tsx`（上次已删）
- `src/components/PremiumBanner.tsx`
- `server/`（整个目录）

**改动**：
- `package.json`（bump 1.2.6）
- `electron/db/index.ts`（UNIQUE 索引）
- `electron/billing.ts`（INSERT 撞 UNIQUE + 返回 recentlyActivatedCodes）
- `electron/api-factory.ts`（类型对齐）
- `src/pages/Settings.tsx`（新增 ActivatedCodesRow + 「我已付款」modal）
- `src/mocks/browserApi.ts`（mock 对齐 DEMO 码防重放）