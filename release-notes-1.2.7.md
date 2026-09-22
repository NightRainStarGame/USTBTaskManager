# v1.2.7 更新说明

> **班级系统 P2P 复活 + 创建付费化 + 补丁流程修复 + Setup 优化**
>
> v1.2.6 把班级系统全删了（依赖 VPS），本次用 **GitHub raw + 北科云盘** 双源做去中心化班级，**完全不需要 VPS**；
> 同时把「创建班级」改为月卡独占功能（同学加入仍免费）；顺手修了几个更新链路的 bug。

## 🆕 新功能

### 1. P2P 班级（GitHub raw 主源 + 北科云盘备源）

v1.2.5 的班级系统需要服务端（VPS）做成员管理 / 公告推送 / 权限校验，v1.2.6 砍掉后用户再无班级功能。v1.2.7 重新实现，**完全去中心化**：

- **班级文件协议**：`class/<inviteCode>/manifest.json`（成员 + last_ann_id/last_task_id）+ `announcements/<annId>.json` + `tasks/<taskId>.json`
- **主源（写）**：GitHub raw（开发者公共仓库 `NightRainStarGame/USTBTaskManager`，需要用户填 PAT 才能写入；不填也能拉取只读模式）
- **备源（写）**：北科云盘 AnyShare（用户自己的共享链，自动双写兜底）
- **成员验证**：HMAC-SHA256 签名嵌入 manifest（密钥嵌入 build），**任何人能验证成员身份真实性**，不需要中心服务器

### 2. 创建班级要月卡（v1.2.7 付费门槛）

「创建班级」是稀缺资源（要发布公告、推送给所有成员），按 v1.2.5 的产品逻辑把它划给月卡用户：

- **创建班级**：需月卡有效（`monthly_subscriptions.expires_at > now`），否则弹付费引导 modal
- **加入班级**：任何用户都能加入，**完全免费**
- 未付费点创建 → 弹「⭐ 创建班级需要月卡」引导 → 一键跳「设置 → 月卡与付费」

```
月卡用户：可创建多个班级，同学免费加入
免费用户：可加入任意班级，但不能创建
```

### 3. UI：班级列表 + 详情

新增侧边栏 **「班级」** 入口（`/class`、`/class/:id`）：

- **班级列表页**（`/class`）：本机加入的所有班级卡片，显示成员数 / 我的角色 / 邀请码 / 上次同步时间
- **班级详情页**（`/class/:id`）：三 tab 切换
  - **公告**：标题 + 正文 + 已读标记（点一下变已读），未读高亮
  - **作业**：标题 + 截止时间 + 完成状态切换（done / cancelled / 重开）
  - **成员**：alias + 角色（owner/admin/member）+ 加入时间
- **顶部操作**：同步（拉远端最新）/ 发布公告（owner）/ 发布作业（owner）
- **预览限制**：浏览器模式（`npm run dev:vite`）只走 mock，无法访问真实 GitHub / AnyShare

### 4. 创建 / 加入 / 配置

- **创建班级**：填名称 + 简介 + 本机 alias → 生成 12 位邀请码（8 位 classCode + 4 位 HMAC 校验位）→ 自动上传 manifest 到 GitHub + AnyShare
- **加入班级**：填 12 位邀请码 + alias → 解析 HMAC 校验 → 拉远端 manifest → 验证成员签名 → 写本地
- **配置弹窗**：GitHub PAT / AnyShare 链接 / 本机默认昵称，独立于作业系统的 AnyShare 设置

## 🐛 Bug 修复

### 1. 增量补丁下载后无法正常更新（**用户报告**）

**根因**：`patch-helper.cjs` 用 `7zip-bin` 的 `7za.exe` 抽补丁 zip 里的 `app.asar`，但：
- `package.json` 没列 `7zip-bin` 依赖
- `asarUnpack` 没解包 `7za.exe`
- `extraResources` 没复制 `7za.exe`
→ helper 一调用 `extractAsarToTmp` 就 throw「helper: 找不到 7za.exe」
→ 补丁永远 apply 失败，但下载流程正常完成 → 用户看到的现象就是「下载后无法正常更新」

**修法**：用 **Node 内置 `zlib.inflateRawSync` 手写 zip 单文件解压**（store + deflate），零依赖、零包大小开销。验证：解压 `TaskManager-Patch-1.2.4-to-1.2.6.zip` 得 75 MB app.asar，sha256 `5c67ca37…` 完全匹配 latest.json。

新增 `scripts/test-helper-extract.js` 作为回归测试（CI 可调用）。

### 2. NSIS 升级残留补丁文件

**根因**：上次补丁若异常中断（断电 / AV 杀进程），`patch-helper.cjs` 会留下 `app.asar.bak` / `app.asar.new` 旁路文件，下次 NSIS 升级不会清，下下次启动还会被误判。

**修法**：`installer.nsh` 的 `cleanStaleAppFiles` 宏增加清理 `.bak` / `.new` 旁路文件 + `userData/patch-state.json`（避免下次启动误判上次补丁失败）。

## 🔧 优化

### 1. NSIS 安装器

- **磁盘空间预检查**：非静默模式下，`< 300 MB 自由` → MessageBox 警告但允许继续
  - 阈值：Setup 93 MB 解压后约 250 MB + userData 备份 50 MB buffer = 300 MB
  - 静默安装跳过（强制模式，磁盘真不够会自然失败）
- **补丁残余清理**：`app.asar.bak` / `app.asar.new` / `patch-state.json`
- **重复宏合并**：原本 `customInit` 宏定义了两遍（一个是静默检测、一个是磁盘检查），现在合并成一份，避免重复定义警告

### 2. Settings.tsx 拆分（深度优化）

Settings.tsx 从 **2306 行 → 2057 行（-249 行）**：

- **抽出 `src/components/DiagPanel.tsx`**：v1.1.6 输入失灵诊断面板（独立无 props）
- **抽出 `src/components/PatchPanel.tsx`**：含 `PatchUpdateButton` + `PatchCacheCard`（独立打包）
- 后续可独立升级这两个组件而不用动 Settings 主体

## 🛠 技术细节

### P2P 班级密码学（同源密钥策略）

| 用途 | 算法 | 说明 |
|---|---|---|
| `classCode` | `randomBytes(8) → base32` | 8 位班级 ID，公开 |
| `inviteCode` | `classCode + HMAC(CLASS_SECRET, classCode).slice(0, 4)` | 12 位邀请码，自包含校验位 |
| `member sig` | `HMAC(CLASS_SECRET, alias\|classCode\|role).slice(0, 16)` | 成员身份签名，防中间人 |
| `entry sig` | `HMAC(CLASS_SECRET, entry:classCode\|kind\|id\|body).slice(0, 16)` | 单条公告/作业内容签名 |
| `manifest sig` | `HMAC(CLASS_SECRET, manifest:classCode\|name\|ownerAlias\|lastAnn\|lastTask\|updatedAt).slice(0, 16)` | manifest 整体签名 |

**CLASS_SECRET** 嵌入 build（与 `MONTHLY_SECRET` 同源），所有客户端持有相同密钥 → 任何人能验证其他人签名的真实性 → **不需要中心服务器**。

### P2P 班级文件协议（共享云盘）

```
GitHub raw:  https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/class/<inviteCode>/
             ├── manifest.json
             ├── announcements/<annId>.json
             └── tasks/<taskId>.json

AnyShare:    <user share root>/
             └── class-manifests/
                 └── <inviteCode>/
                     ├── manifest.json
                     ├── announcements/<annId>.json
                     └── tasks/<taskId>.json
```

### 零依赖 zip reader（patch-helper.cjs 重写）

```
原版：spawn(7za.exe, ['x', '-y', '-o<dir>', zip, 'app.asar'])  // 7za.exe 找不到 → throw
新版：手写 zip 中央目录解析（locate EOCD → traverse CD entries → 找到 app.asar → read local header） +
     zlib.inflateRawSync 解压（store = 直接 copy / deflate = raw inflate）
```

**实现**：约 70 行 CommonJS 代码，零 npm 依赖。**不支持 Zip64**（补丁远不到 4 GB），文件名强制 UTF-8。

## 📋 文件清单

**新增**：
- `electron/class/crypto.ts`（HMAC 派生 + 签名工具）
- `electron/class/storage.ts`（GitHub raw + AnyShare 多源适配器）
- `electron/class/index.ts`（10+ IPC handlers，含付费门槛校验）
- `src/pages/Class/index.tsx`（班级列表页 + 付费引导 modal）
- `src/pages/Class/ClassDetail.tsx`（班级详情页 + 发布 modal）
- `src/components/DiagPanel.tsx`（从 Settings.tsx 抽出）
- `src/components/PatchPanel.tsx`（从 Settings.tsx 抽出，含 PatchUpdateButton + PatchCacheCard）
- `scripts/test-helper-extract.js`（zip reader 回归测试）

**改动**：
- `electron/db/index.ts`（`classes` 表加 `alias / invite_code / owner_alias / last_announcement_id / last_task_id / manifest_sha / members_json` 字段）
- `electron/resources/patch-helper.cjs`（零依赖 zip reader 重写）
- `electron/api-factory.ts`（暴露 `window.taskAPI.class.*` + `create` 返回类型加 `errorCode/hint`）
- `build/installer.nsh`（补丁残余清理 + 磁盘空间预检查 + 重复宏合并）
- `src/App.tsx`（加 `/class`、`/class/:id` 路由）
- `src/components/Sidebar.tsx`（加班级入口）
- `src/pages/Settings.tsx`（抽 DiagPanel + PatchPanel，-249 行）
- `src/mocks/browserApi.ts`（mock 对齐，识别 `DEMO` 前缀的邀请码做浏览器预览）
- `package.json`（bump 1.2.7）

## 🧪 浏览器预览

`npm run dev:vite` → `http://localhost:5173` → 侧边栏「班级」

mock 行为：
- 输入 `DEMO` 开头的邀请码 → 加入示例班级（带 3 个 mock 成员 + 几条 mock 公告/作业）
- 填班级名 → 创建本地 mock 班级（仅 in-memory）
- 创建/发布警告会显式标注「浏览器预览模式：仅本机内存生效」

## 🚀 真机使用流程

1. **设置 GitHub PAT**（可选）：班级 → 配置 → 填 GitHub Personal Access Token（需 repo Contents 读写权限）
   - 不填 → 你只能加入别人的班级，不能发布
2. **激活月卡**（创建必需）：设置 → 月卡与付费 → 加客服微信 `NRSG-Power` 拿 16 位月卡码
3. **创建班级**（月卡用户专属）：班级 → + 创建 → 拿到 12 位邀请码
4. **邀请同学**：微信发邀请码
5. **同学加入**：班级 → 加入 → 填 12 位码 + alias
6. **同步**：进班级详情页点「同步」拉取最新公告/作业
7. **owner 发布公告/作业**：自动双写 GitHub + AnyShare

## ⚠️ 已知限制

- **图片附件暂不支持**：公告/作业只存文本（manifest 含 `images: []`），图片上传协议待 v1.2.8
- **实时推送**：新公告需手动点「同步」（没有 WebSocket，也没有后台轮询；v1.2.8 加 30 秒轮询）
- **owner 转让**：当前不能直接换 owner，需要 owner 离开 → 班级解散 → 重新建（v1.2.8 用 admin promote 替代）
- **冲突合并**：两台电脑同时 publish 会撞 409，提示用户重试（v1.2.8 加自动合并）

## 💰 付费档说明

| 功能 | 月卡用户 | 免费用户 |
|---|---|---|
| 创建班级 | ✅ | ❌（弹付费引导） |
| 加入班级 | ✅ | ✅ |
| 发布公告/作业（owner 视角）| ✅ | N/A |
| 标记已读 / 完成作业 | ✅ | ✅ |
| 月卡专属功能（去水印等）| ✅ | ❌ |