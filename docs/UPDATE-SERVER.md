# 服务器更新源搭建指南

> 目标：在服务器上准备一个**永远不变的地址**，App 从它读取版本信息，从而实现「老版本用户自动收到更新」。

---

## 0. 原理（一句话）

App 不关心你的服务器是什么技术，它只做一件事：**GET 一个固定 URL，期待返回一段版本清单文本**。

```
App 启动 / 点击「检查更新」
   │
   ├─ GET  https://你的域名/taskmanager/latest.json     ← 这个地址永远不变
   │
   ├─ 返回 {"version":"0.3.1", "url":"...exe", "sha256":"...", "notes":"..."}
   │
   ├─ 比较 version 与本地版本 → 有新版则提示
   ├─ 从 url 下载安装包 → 校验 sha256
   └─ 启动安装包并退出当前应用
```

所以服务器上**只需要静态文件托管，不需要写任何后端代码**。

每次发版你要做的只有两件事：

1. 把新安装包传上去（放哪个路径都行，只要清单里的 `url` 指对了）
2. 用新的内容**覆盖**那个固定地址的 `latest.json`

---

## 1. 服务器目录结构（推荐）

```
<网站根目录>/taskmanager/
├── latest.json                                   ← 固定地址，每次发版覆盖它
├── releases/
│   ├── 0.3.0.json                                ← 历史清单归档（可选，便于回滚）
│   └── 0.3.1.json
└── files/
    ├── TaskManager Setup 0.3.0.exe               ← 旧版安装包建议保留
    └── TaskManager Setup 0.3.1.exe
```

对应的更新源地址就是：

```
https://你的域名/taskmanager/latest.json
```

> **核心原则**：`latest.json` 的 URL 一旦发布给用户，就**永远不要改**。改路径 = 所有老版本 App 集体失联。

---

## 2. 清单文件格式（latest.json）

```json
{
  "version": "0.3.1",
  "notes": "· 新增设置页软件更新功能\n· 修复课程无法添加作业",
  "url": "https://dl.example.com/taskmanager/files/TaskManager%20Setup%200.3.1.exe",
  "sha256": "b92a254f273bb210fe253f143f50b84fa1770e88cdc4bf344cd8dca87b7cad50",
  "page": "https://pan.example.com/s/abcd",
  "force": false
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | ✅ | 形如 `0.3.1`，必须比用户本地版本大才会提示更新 |
| `notes` | 建议 | 更新说明，App 里原样多行展示 |
| `url` | 强烈建议 | 安装包**直链**。留空时 App 只能引导用户手动打开 `page` |
| `sha256` | 建议 | 64 位十六进制；有值时下载完自动校验，不匹配会拒绝安装 |
| `page` | 可选 | 发布页 / 网盘分享页，给用户手动下载的入口 |
| `force` | 可选 | `true` 时 App 界面标为强制更新（不提供「忽略」） |
| `minVersion` | 可选 | 预留字段，当前仅解析 |

**字段别名**（写错也能识别）：`latest`/`ver`/`tag` → `version`，`changelog`/`body` → `notes`，`download`/`installer`/`file` → `url`，`share`/`website`/`html_url` → `page`，`hash`/`checksum` → `sha256`。

> 也支持**纯文本清单**：只要文本里出现 `x.y.z` 形式的版本号，App 会自行抽出版本号、`http` 开头的下载地址、以及 64 位十六进制校验和。

---

## 3. 四种托管方式

### 方式 A：自建服务器（nginx）— 最推荐，完全可控

假设网站根目录是 `/var/www`，把文件放到 `/var/www/taskmanager/`：

```nginx
server {
    listen 80;
    server_name dl.example.com;

    # 1) 版本清单：固定地址，必须禁用缓存，否则用户拿到旧版本号
    location = /taskmanager/latest.json {
        root /var/www;
        default_type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    # 2) 安装包与归档：以二进制流返回，避免被当成网页
    location /taskmanager/ {
        root /var/www;
        default_type application/octet-stream;
    }
}
```

```bash
# 重载配置
nginx -t && systemctl reload nginx
# 加 HTTPS（强烈建议，否则部分网络环境会拦截）
certbot --nginx -d dl.example.com
```

**关键点**
- `latest.json` 必须走 `no-store`，否则中间任何一层缓存都会让用户看不到新版
- `.exe` 必须以 `application/octet-stream`（或任意非 `text/html`）返回，App 会拒绝下载 `text/html` 响应
- 目录要有读权限：`chmod -R 755 /var/www/taskmanager`

**临时快速测试**（不装 nginx）：

```bash
cd /var/www/taskmanager && python3 -m http.server 8080
```

Caddy 极简写法：

```
dl.example.com {
    root * /var/www
    file_server
    header /taskmanager/latest.json Cache-Control "no-store"
}
```

---

### 方式 B：云对象存储（腾讯云 COS / 阿里云 OSS）

最适合「不想运维服务器」的场景。

1. 创建存储桶（地域选离你近的，如 `ap-beijing`）
2. 权限设为 **公有读、私有写**
3. 上传到 `/taskmanager/latest.json`、`/taskmanager/files/...`
4. 拿到访问地址：

```
https://<bucket>-<appid>.cos.ap-beijing.myqcloud.com/taskmanager/latest.json
```

**必做设置（最容易踩的坑）**
- 给 `latest.json` 单独设置 HTTP 头部 `Cache-Control: no-cache`（COS 控制台 → 对象 → 自定义头部）
- 或者给它绑定一条 CDN 刷新规则 / 短缓存策略
- 其余 `.exe` 文件缓存时间可以设长（如 30 天），文件名带版本号不会冲突

**上传命令**

```bash
pip install coscmd
coscmd config -a <SecretId> -s <SecretKey> -b <bucket> -r ap-beijing
coscmd upload -r release-manifest/ /taskmanager/
coscmd upload "release-0.3.1/TaskManager Setup 0.3.1.exe" /taskmanager/files/
```

> 有自定义域名的话可以绑到存储桶上，地址更好看：`https://dl.example.com/taskmanager/latest.json`

---

### 方式 C：GitHub / Gitee Releases

适合开源项目。

- 安装包上传到 Release 资产 → 直链形如
  `https://github.com/<user>/<repo>/releases/download/v0.3.1/TaskManager.Setup.0.3.1.exe`
- `latest.json` 放在仓库里，用 raw 地址访问：
  `https://raw.githubusercontent.com/<user>/<repo>/main/latest.json`
  或开 GitHub Pages：`https://<user>.github.io/<repo>/latest.json`

**注意**
- App 下载时已开启重定向跟随，GitHub 的 302 跳转没问题
- 国内网络访问 `raw.githubusercontent.com` / `objects.githubusercontent.com` 经常超时 → 不建议作为国内用户的主更新源
- 更稳的做法：GitHub 仅作为归档，更新源放在你自己的服务器或对象存储

---

### 方式 D：网盘

**结论先说**：绝大多数网盘（百度网盘、夸克、阿里云盘分享页）**不支持直链下载**，无法作为自动更新源。

可行的两种用法：

| 用法 | 配置 | 效果 |
|---|---|---|
| **分享页 + 手动下载**（推荐） | `page` 填分享页地址，`url` 留空 | 检查更新能提示新版本，点「打开发布页」跳浏览器，用户手动下载 |
| **直链**（需自行解析） | `url` 填解析出的直链 | 需要满足：链接长期有效、无防盗链 UA 校验、Content-Type 非 HTML |

即使有直链，也要注意：
- 直链**不能过期**（很多网盘直链几小时就失效 → 用户第二天点下载就 403）
- 部分网盘按 UA 防盗链 → App 已伪装成浏览器 UA，但仍可能被拦
- 建议：网盘作为**备份通道**，正式更新走静态托管

---

## 4. 发版流程

```bash
# 1) 改版本号（package.json 的 version）
#    Settings 页显示的版本号自动读主进程，无需手改

# 2) 打包
npx electron-builder --win nsis --x64 --config.directories.output=release-0.3.1

# 3) 生成服务器所需文件（自动算 SHA-256 + 写清单 + 出自检）
node scripts/release.js --base-url https://dl.example.com/taskmanager \
  --notes-file RELEASE_NOTES.md --copy

# 4) 上传 release-manifest/ 整个目录 + 安装包到服务器

# 5) 自检线上地址
node scripts/release.js --verify https://dl.example.com/taskmanager/latest.json
```

### `release.js` 参数

| 参数 | 说明 |
|---|---|
| `--base-url <url>` | **必填**，服务器上 taskmanager 目录的公开地址，用于拼出下载链接 |
| `--file <path>` | 指定安装包；默认自动找 `release-<版本>/TaskManager Setup <版本>.exe` |
| `--version <v>` | 覆盖版本号；默认读 `package.json` |
| `--notes <文本>` | 更新说明；`\n` 会被转成换行 |
| `--notes-file <路径>` | 从文件读更新说明（**多行说明推荐这个**） |
| `--page <url>` | 填发布页 / 网盘分享页地址 |
| `--sha256 <hash>` | 手填校验和（默认自动计算） |
| `--force` | 标记为强制更新 |
| `--min-version <v>` | 最低可升级版本 |
| `--out <dir>` | 输出目录，默认 `release-manifest/` |
| `--files-dir <name>` | 安装包子目录名，默认 `files` |
| `--copy` | 把安装包复制进输出目录，方便整目录一次上传 |
| `--apply-default` | 把更新地址直接写进 `electron/updater/index.ts` 的默认常量 |
| `--verify <url>` | **校验模式**：拉取线上清单，检查连通性、版本号、下载地址、Content-Type |

产物：

```
release-manifest/
├── latest.json              上传到  <base>/latest.json
├── releases/0.3.1.json      上传到  <base>/releases/0.3.1.json（归档）
├── SHA256SUMS.txt           校验和清单
└── UPLOAD-0.3.1.md          本次上传清单与命令
```

---

## 5. 把地址告诉 App

有两个位置，优先级：**设置页手填 > 代码默认值**。

### 方式 1（推荐）：写进代码默认值，所有用户自动生效

```ts
// electron/updater/index.ts
export const DEFAULT_UPDATE_SOURCE = 'https://dl.example.com/taskmanager/latest.json';
```

改完必须**重新 build + 打包**，之后分发出的安装包自带更新源，用户什么都不用填。

也可以直接由脚本写入：

```bash
node scripts/release.js --base-url https://dl.example.com/taskmanager --apply-default
```

### 方式 2：用户自己填

设置 → 软件更新 → 更新源地址 → 粘贴 → 保存地址。

> ⚠️ 注意时序：**已经分发出去的安装包**，如果里面 `DEFAULT_UPDATE_SOURCE` 是空的，那用户必须手动填一次地址才能收到更新。所以第一次带更新功能的版本，最好就把默认地址填好再打包。

---

## 6. 排查对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| 「尚未配置更新源地址」 | 地址为空 | 检查设置页，或确认打包时 `DEFAULT_UPDATE_SOURCE` 已填 |
| 「域名无法解析」 | DNS 未生效 / 地址拼写错误 | `nslookup 域名` 确认 |
| 「连接失败：目标拒绝连接」 | 服务未启动 / 端口不对 | 浏览器直接访问该 URL 试 |
| 「HTTP 404」 | 文件没上传，或路径大小写不一致 | 用 `--verify` 定位；Linux 区分大小写 |
| 「更新源内容无法识别为版本清单」 | 返回的是 HTML（错误页 / 网盘分享页） | 确认是 JSON 直链，不是分享页 |
| 检查到新版本但下载失败，提示「返回的是网页/接口数据」 | `url` 指向分享页而非文件直链 | 换成真实文件地址 |
| 服务器上明明有新版本，App 却说「已是最新」 | 清单被缓存 | 给 `latest.json` 加 `Cache-Control: no-store` |
| 「安装包校验失败（SHA-256 不匹配）」 | 上传不完整 / 打包后又重新生成过 | 重新跑 `release.js` 并重新上传两者 |
| 「该端口被浏览器安全策略禁止」 | 用了 1 / 7 / 9 等不安全端口 | 改用 80 / 443 / 8080 |
| 「HTTPS 证书校验失败」 | 自签证书 | 用合法证书，或先用 http 测试 |

### 常用自检命令

```bash
# 清单能不能拿到、是不是 JSON
curl -sI https://dl.example.com/taskmanager/latest.json

# 安装包直链是否存在、Content-Type 对不对
curl -sI "https://dl.example.com/taskmanager/files/TaskManager%20Setup%200.3.1.exe"
# 期望： 200，Content-Type 不是 text/html

# 完整校验（推荐）
node scripts/release.js --verify https://dl.example.com/taskmanager/latest.json
```

---

## 7. 已知限制

- **不支持自动降级**：只有当清单里的版本号大于用户本地版本时才会提示。想回滚，只能手动分发旧安装包（或临时把 `latest.json` 指到一个更高版本号 + 旧安装包，不推荐）。
- **不做增量更新**：每次都是完整安装包（约 84 MB）。网速慢的用户会有等待。
- **不静默安装**：App 只负责下载并拉起安装包，安装过程仍由用户确认（NSIS 向导）。
- **无灰度 / 无下载统计**：当前是纯静态方案。如需按用户分批放量或统计下载量，需要在服务器上加一层简单的接口（可以以后再加，App 侧只需改地址）。
