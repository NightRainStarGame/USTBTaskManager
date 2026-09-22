# v1.2.5 更新说明

> 本次为「班级服务」正式上线的发版，把课程页里那块**临时占位**的「班级服务」升级为完整闭环：扫码购买 → 服务器发码 → 粘贴激活 → 月卡生效。

## 🆕 新功能

### 1. 班级服务（订阅化月卡）

设置 → 「班级服务」tab 现已打通完整回路，告别之前的占位提示。

- **价格透明**：页面顶部展示当前 SKU、单价（元/30天）、**官方收款码二维码**（微信支付），扫码即可付款
- **开通码激活**：付款后联系作者（豆芽）索取开通码（`XXXX-XXXX-XXXX-XXXX` 格式 + HMAC-SHA256 签名），粘贴到页面输入框 → 点激活
- **服务端校验**：激活请求打到 VPS Fastify，校验 HMAC 签名 + 设备指纹 + 月卡 SKU 状态 → 写入 `monthly_subscriptions` 表
- **实时状态卡片**：激活后顶部出现「月卡有效至 YYYY-MM-DD」绿卡，过期前 3 天自动转黄并附横幅提醒
- **设备绑定**：开通码与设备指纹绑定，复制粘贴给别人无效

### 2. 付费入口（不打扰设计）

v1.2.5 把「付费入口」从**每页顶部条**收敛到**真正需要付费的两个位置**，避免对免费用户造成视觉打扰：

- **设置 → 班级服务**：购买入口（月卡 SKU + 微信收款码 + 月卡开通码粘贴激活）
- **创建班级弹窗（v1.2.5.1）**：普通用户点击「创建班级」时，弹窗自动检测付费状态 → 免费用户先要求粘贴月卡开通码激活（30 元/30 天）→ 激活成功后切到创建表单
- **Dashboard / 其他页面**：不再显示任何付费 banner，保持沉浸

生效/即将到期状态仅在「设置 → 班级服务」页面顶部用绿/黄卡片提示，不弹全局横幅。

## 🛠 技术细节

- **服务端**（`server/`）：Fastify 5，新增路由 `GET /admin/pricing`、`POST /voucher/redeem`、`POST /admin/issue-voucher`（带 X-Admin-Token），better-sqlite3 三表：`products / voucher_purchases / monthly_subscriptions`
- **HMAC 鉴权**：`BILLING_HMAC_SECRET` 环境变量参与签名，预共享密钥不出仓库
- **离线容忍**：客户端开通码激活若首次调用失败，3 次重试 + 离线队列缓存，重启后补调；激活成功后立即生效，不依赖后续轮询
- **前端**：新增 `electron/billing.ts`（IPC + HMAC 校验）、`electron/serverClient.ts`（服务端 HTTP 客户端）、`src/components/PremiumBanner.tsx`（仅作为「设置页」状态展示组件，不挂全局）；`src/mocks/browserApi.ts` 浏览器预览模式增加 `classes.* / billing.*` mock，让预览能完整演示购买-激活-创建流程

## 🐛 同步修复

- 修复订阅状态在多窗口/重连场景下的状态不一致问题（统一走 Zustand store，不再读本地缓存）

## 🛠 升级说明

- 已装 v1.2.4 的用户：自动应用增量补丁 ~3MB，无需重装
- 新装用户：下载完整安装包 ~97MB
- 数据无损保留，无需迁移
- **首次进入新班级服务页会请求访问网络**（用于拉取定价 + 提交激活），在受限网络下用户可手动跳过，下次启动时重试

## 🗑️ 移除

### 「小组」共享清单（v1.2.3）下架

替代关系：班级服务（v1.2.5 新增）已完全覆盖「小组」的全部使用场景，且走 VPS 远端 + 设备指纹 + 月卡授权，体验更稳定。

- **删 Sidebar「小组」入口**（`src/components/Sidebar.tsx`）
- **删 App.tsx `/groups` 路由** + 整文件 `src/pages/Groups.tsx`
- **删主进程小组 IPC**：`electron/grouplists.ts`（GitHub 远端同步模块）+ `electron/ipc/index.ts` 里 `db:groupLists:*` / `db:groupListItems:*` handlers + `electron/api-factory.ts` 对应桥
- **删浏览器预览 mock**：`src/mocks/browserApi.ts` 里 `groups / groupLists / groupListItems`
- **DB 表保留**：`group_lists / group_list_items` 表不删，**已存在的本地小组数据仍在 `%APPDATA%\task-manager\task-manager.db` 里**，若想恢复可手动还原 Groups.tsx 文件（无任何迁移工具）