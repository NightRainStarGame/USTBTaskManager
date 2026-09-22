# 发码器（Issue Voucher）使用手册

> 豆芽（开发者）专用的"一键出月卡开通码 / 基础开通码"桌面工具。**不依赖 VPS**，在本机跑，自动复制到剪贴板。

## 一次性配置（约 5 分钟）

### 1. 确认 server 包已 build

```powershell
cd e:\University\TaskManager\server
npm install            # 仅首次
npm run build          # 生成 dist\cli\gen-monthly.js 等
```

### 2. 生成两个 HMAC 密钥（**绝不进 git**）

```powershell
# 月卡密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 基础码密钥
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

把两段输出**抄到密码管理器 / 微信收藏**。⚠️ 密钥丢了 = 所有已发码不可用，但已激活的用户不受影响（已写本地表 `monthly_subscriptions`）。

### 3. 填 server/.env

```powershell
cd e:\University\TaskManager\server
copy .env.example .env       # 已有 .env 可跳过
notepad .env
```

把以下三行替换为你生成的密钥（其他行不动）：

```
DEVICE_TOKEN_HMAC_SECRET=<32字节随机>
VOUCHER_HMAC_SECRET=<32字节随机>
MONTHLY_VOUCHER_HMAC_SECRET=<32字节随机>
```

### 4. 客户端 build 必须用同一个密钥（**关键**）

v1.2.5 当前实现下，客户端 `vite build` 没有把 SECRET 注入 bundle —— **这会导致用户激活时"签名无效"**。

补丁方法（暂未自动，建议作为下次发版前的 TODO）：

`vite.config.ts` 加 define：
```ts
define: {
  __VOUCHER_SECRET__: JSON.stringify(process.env.VOUCHER_HMAC_SECRET),
  __MONTHLY_SECRET__: JSON.stringify(process.env.MONTHLY_VOUCHER_HMAC_SECRET),
},
```

`electron/billing.ts` 改读编译期常量（替换 `process.env.* || '__dev_*_secret_change_me__'`）。

发码器本身**不依赖此补丁** —— 它只调 server 端的 `issueVoucher`，能正常出码。补丁影响客户端能否验证你发的码。

### 5. 桌面快捷方式（可选但强烈建议）

```powershell
powershell -ExecutionPolicy Bypass -File e:\University\TaskManager\scripts\install-issue-voucher-shortcut.ps1 -All
```

桌面会出现两个图标：
- **发码器(月卡).lnk** —— 双击出 1 张月卡码
- **发码器(基础码).lnk** —— 双击出 1 张基础码

要卸掉：
```powershell
powershell -ExecutionPolicy Bypass -File e:\University\TaskManager\scripts\install-issue-voucher-shortcut.ps1 -Uninstall
```

---

## 日常用法

### 出 1 张月卡码（最常用）

- **双击桌面「发码器(月卡).lnk」**
- 弹窗显示：`MONTHLY 码：V1-MONTHLY-AbCdEf...-XyZ` + "已复制到剪贴板"
- 切到微信 → Ctrl+V 发给用户 → 完事（≤5 秒）

### 出多张（囤码 / 备用）

```powershell
powershell -ExecutionPolicy Bypass -File e:\University\TaskManager\scripts\issue-voucher.ps1 -Count 5
```

第一张自动复制到剪贴板，其余在弹窗列出。

### 出基础开通码

```powershell
powershell -ExecutionPolicy Bypass -File e:\University\TaskManager\scripts\issue-voucher.ps1 -Basic
```

### 静默模式（不弹窗，只输出到 stdout）

```powershell
powershell -ExecutionPolicy Bypass -File e:\University\TaskManager\scripts\issue-voucher.ps1 -Count 10 -Quiet | Set-Clipboard
```

---

## 全局快捷键（可选）

**法 1：任务栏快捷键**（Win+数字）
1. 右键桌面 LNK → 固定到任务栏
2. Win+1 = 月卡，Win+2 = 基础码

**法 2：自定义组合键**
1. 右键桌面 LNK → 属性 → 「快捷键(K)」字段
2. 按 Ctrl+Alt+M（系统自动加 Ctrl+Alt）
3. 注意：Win 自带的「保留属性」快捷键会和浏览器冲突时少用

**法 3：AutoHotkey（最灵活）**
```ahk
#m::Run, C:\Users\<你的用户名>\Desktop\发码器(月卡).lnk
#b::Run, C:\Users\<你的用户名>\Desktop\发码器(基础码).lnk
```
Win+M 出月卡码，Win+B 出基础码。

---

## 故障排查

| 弹窗提示 | 原因 | 修法 |
|---|---|---|
| `找不到 server 目录` | 脚本位置错 | 把 `issue-voucher.ps1` 放回 `scripts/` |
| `找不到 dist\cli\gen-monthly.js` | server 没编译 | `cd server && npm run build` |
| `找不到 .env` | `.env` 没建 | `cd server && copy .env.example .env` |
| `MONTHLY_VOUCHER_HMAC_SECRET 仍是 __FILL_ME__` | .env 没填 | notepad .env 填密钥（见上文 §3） |
| `CLI 退出码 1` | 密钥太短 / 节点报错 | 看弹窗里的 `node` 原始输出 |
| 用户报「签名无效」 | 客户端 SECRET 没注入 build（**v1.2.5 已知 bug**） | 补丁 vite.config.ts define（见 §4） |

---

## 发码日志

所有发码动作追加到 `server\data\issue.log`（含时间 / plan / 码内容）：

```
2026-09-22 14:33:12  plan=MONTHLY count=1    codes=V1-MONTHLY-AbCdEf123-_xYz9kQ2pMnR
2026-09-22 14:35:48  plan=BASIC   count=2    codes=V1-BASIC-xxxxxx-yyyyyy,V1-BASIC-zzzzzz-wwwwww
```

用于事后追溯「这张码是几点几分发的」「这批码库存还剩多少」。

**注意**：日志里写了**完整码**，等于**明文落盘**。建议：
- 把 `server\data\issue.log` 加入 `~/.gitignore_global` 或直接 `server/.gitignore`
- 定期清理（`Get-Content issue.log | Select-String ...` 抽样后 truncate）

---

## 安全 / 合规提醒

- SECRET 是这个工具**唯一**的可信根。丢了 = 重新发版 + 全用户换 SECRET（不可平滑迁移）
- 不要把 SECRET 写进任何 `*.bat / *.ps1 / *.env.example` 里提交
- 不要把 `issue.log` 截图发群里（含完整码）
- 用户激活的月卡**无法退款 / 无法吊销**（除非服务端撤销功能启用，本工具不涉及）