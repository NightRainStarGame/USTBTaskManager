# 更新源协议与自建指南

App 启动后（或点「检查更新」）会从所有启用的源并行查版本，取**最高版本**升级，单个源失败不影响其他源。

App 内置默认两个公开源：

| 源 | 清单地址 | 备注 |
|---|---|---|
| **GitHub / leastversion**（主源） | `https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json` | raw.githubusercontent.com 国内偶尔慢 |
| **北科云盘**（AnyShare，需校园网） | `https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469` + 提取码 `kc26` | 校园网内速度最快 |

> 想换源 / 加源：**设置 → 软件更新 → 更新源**，可增删源、切换主源。
> 默认源地址写在 `electron/updater/index.ts` 的 `DEFAULT_UPDATE_SOURCES`，新装用户首次启动自动并入。

---

## 1. 协议（latest.json）

App 不关心服务器技术栈，只 GET 一个**永久不变**的 URL，期待返回版本清单文本。

最小清单：

```json
{
  "version": "1.1.7",
  "notes": "更新说明…",
  "url": "https://…/TaskManager-Setup-1.1.7.exe",
  "sha256": "…64位十六进制…",
  "size": 97393759
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `version` | ✅ | 必须大于用户本地版本才会提示更新 |
| `notes` | 建议 | 多行文本，App 原样展示 |
| `url` | 建议 | 直链；下载完验 SHA-256，不匹配拒绝安装 |
| `sha256` | 建议 | 64 位十六进制 |
| `size` | 建议 | 安装包字节数 |
| `page` | 可选 | 网盘分享页等手动下载入口 |
| `force` | 可选 | true 时标为强制更新 |
| `patches[]` | 否 | 增量补丁（详见 §4） |
| `asarSha256` / `asarSize` | 建议 | 配合 `patches[]` 让客户端核对基线 |

**字段别名**（写错也能识别）：`latest`/`ver`/`tag` → `version`，`changelog`/`body` → `notes`，`download`/`installer` → `url`，`share`/`website` → `page`，`hash`/`checksum` → `sha256`。

也支持**纯文本清单**（网盘直链里放一个 `latest.txt`）：任意位置出现 `x.y.z` 作为版本号；`http` 开头的行当作下载地址；64 位十六进制当作 sha256。

服务器上**只需要静态文件托管**，不需要任何后端代码。

---

## 2. 命名范式（v1.1.7 起全源统一）

清单文件 `latest.json` 是「哪个需要更新」的**唯一指路文件**。命名约定如下：

### GitHub 源（仓库内，永久固定名）

| 文件 | 命名 |
|---|---|
| 清单 | `latest.json`（仓库根） |
| 整装包 | `leastversion/TaskManager-Setup-<v>.exe` |
| 回退包 | `oldversion/TaskManager-Setup-<prev>.exe`（保留一个回退位） |
| 增量补丁 | `leastversion/patches/TaskManager-Patch-<from>-to-<to>.zip` |
| 关于文本 | `about.txt`（仓库根，常驻） |

### 北科云盘源（匿名不能覆盖 → 一律 `<固定名>-<unix_ts>.<ext>` 时间戳版）

| 文件 | 命名 | App 端查找方式 |
|---|---|---|
| 清单 | `latest-<ts>.json` | `findLatestByPrefix('latest', '.json')` 取最新 |
| 整装包 | `TaskManager Setup <v>-<ts>.exe` | 清单 `url` 填 basename；`resolveDownloadUrl` 按前缀取最新换签名直链 |
| 增量补丁 | `TaskManager-Patch-<from>-to-<to>-<ts>.zip` | `patches[].url` 填 basename；同上前缀解析 |
| 关于文本 | `about-<ts>.txt` | `findLatestByPrefix('about', '.txt')` 取最新 |

清单的差别**只有一处**：`url` / `patches[].url` 是云盘 basename 还是 http 直链，其他字段通用。

---

## 3. 自建源（可选）

> 下面是为「想自己搭服务器 / CDN」的人准备的通用方案。多数用户用 GitHub + 北科云盘两个默认源就够。

### 推荐目录结构

```
<网站根>/taskmanager/
├── latest.json
├── files/
│   └── TaskManager Setup 1.1.7.exe
└── releases/
    └── 1.1.7.json              ← 历史清单归档（可选）
```

### nginx

```nginx
server {
    listen 80;
    server_name dl.example.com;

    location = /taskmanager/latest.json {
        root /var/www;
        default_type application/json;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location /taskmanager/ {
        root /var/www;
        default_type application/octet-stream;
    }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d dl.example.com   # 强烈建议 HTTPS
```

要点：
- `latest.json` 必须 `no-store` —— 否则中间任何一层缓存都会让用户看不到新版
- `.exe` 必须 `application/octet-stream`（或任意非 `text/html`）—— App 会拒绝 `text/html` 响应
- 临时测试：`python3 -m http.server 8080` 即可

### 云对象存储（腾讯云 COS / 阿里云 OSS）

1. 创建存储桶，权限设**公有读、私有写**
2. 上传到 `/taskmanager/latest.json` 和 `/taskmanager/files/...`
3. **必做**：`latest.json` 加 HTTP 头 `Cache-Control: no-cache`（控制台 → 对象 → 自定义头部）
4. `.exe` 缓存时间可以设长，文件名带版本号不会冲突

### GitHub Releases

适合开源项目：

- 安装包上传到 Release 资产 → 直链形如
  `https://github.com/<user>/<repo>/releases/download/v1.1.7/TaskManager-Setup-1.1.7.exe`
- `latest.json` 放仓库根，用 raw 访问
- 国内访问 raw 经常超时，不建议作为国内用户的主源

### 网盘

多数网盘（百度、夸克、阿里云盘分享页）**不支持直链**，只能作为手动下载入口：清单里 `page` 填分享页地址、`url` 留空，App 检测到更新时引导用户跳浏览器手动下载。

---

## 4. 增量补丁协议

`latest.json` 扩展：

```json
{
  "version": "1.1.7",
  "url": "…/TaskManager-Setup-1.1.7.exe",
  "asarSha256": "…",
  "asarSize":   72278590,
  "patches": [
    {
      "fromVersion":     "1.1.6",
      "url":             "…/TaskManager-Patch-1.1.6-to-1.1.7.zip",
      "sha256":          "…",
      "size":            22122937,
      "baseAsarSha256":  "…1.1.6 app.asar sha256…",
      "baseAsarSize":    72253048,
      "appAsarSha256":   "…1.1.7 app.asar sha256…",
      "appAsarSize":     72278590,
      "createdAt":       "2026-09-20T07:26:36.053Z"
    }
  ]
}
```

补丁 zip 结构：
  1) `app.asar` —— electron-builder 输出的新 asar 完整副本（deflate 后一般 ≤ 25 MB）
  2) `manifest.json` —— `{ schema, fromVersion, toVersion, baseAsarSha256, baseAsarSize, appAsarSha256, appAsarSize, createdAt }`

客户端应用流程（`scripts/release-one-click.js` + `electron/updater/patchApply.ts`）：
1. 找 `patches[]` 里有 `fromVersion == app.getVersion()` 的补丁
2. 下载 zip + 验 sha256
3. helper 进程比对 `baseAsarSha256` ↔ 当前 `app.asar` sha256（不匹配 → 回退全量）
4. helper 解压 `app.asar`、自检 `appAsarSha256`、rename 旧 asar、落新 asar
5. 校验通过 → 主进程重启

任意一步失败 → 自动回退全量 Setup 安装。

发版约定：
- `scripts/release-one-click.js` 已集成（一键：build → 滚动 → 补丁 → latest.json → commit → push → Release 附件 → 云盘）
- 历史 asar 缓存在 `scripts/.asar-cache/`，不提交仓库
- `scripts/verify-patch-build.js` 自检补丁链可生成 + 可解压

---

## 5. about.txt 多源分发

「关于」页面文本也走相同的两个源协议（与补丁原理一致）：App 启动后从所有启用源并行 GET `about.txt`，按 sha256 选最新一份缓存到 `%APPDATA%/task-manager/about.txt`。

文件命名见 §2（GitHub 仓库根 `about.txt`；云盘 `about-<ts>.txt`）。

UI：
- 关于页面提供「立即拉取最新」「编辑本地」「锁定本地」「打开缓存目录」
- 锁定本地后，云端下次启动不再覆盖（本地编辑优先）

发布 about：
1. 编辑仓库根 `about.txt` → `git commit && git push` → 所有用户下次启动自动拉到
2. （可选）传到云盘：`about-<unix_ts>.txt` —— 走 `npm run about:push`

---

## 6. 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 「尚未配置更新源地址」 | 地址为空 | 检查设置页；或确认打包时 `DEFAULT_UPDATE_SOURCES` 已填 |
| 「域名无法解析」 | DNS 未生效 / 拼写错误 | `nslookup 域名` 确认 |
| 「HTTP 404」 | 文件没上传，或路径大小写不一致 | Linux 区分大小写 |
| 「更新源内容无法识别为版本清单」 | 返回的是 HTML（错误页 / 网盘分享页） | 确认是 JSON 直链 |
| 检测到新版本但下载提示「返回的是网页/接口数据」 | `url` 指向分享页而非文件直链 | 换成真实文件地址 |
| 服务器上明明有新版本，App 却说「已是最新」 | 清单被缓存 | 给 `latest.json` 加 `Cache-Control: no-store` |
| 「安装包校验失败（SHA-256 不匹配）」 | 上传不完整 / 重新生成过 | 重跑发版脚本并重传两者 |
| 「该端口被浏览器安全策略禁止」 | 用了 1 / 7 / 9 等不安全端口 | 改用 80 / 443 / 8080 |
| 「HTTPS 证书校验失败」 | 自签证书 | 用合法证书，或先用 http 测试 |

常用自检：

```bash
curl -sI https://你的域名/taskmanager/latest.json
curl -sI "https://你的域名/taskmanager/files/TaskManager%20Setup%201.1.7.exe"
```

---

## 7. 已知限制

- **不支持自动降级**：清单版本号必须大于本地版本才会提示。回滚只能手动分发旧安装包。
- **不静默安装**：App 只下载并拉起安装包，安装过程仍由用户在 NSIS 向导里确认。
- **无灰度 / 下载统计**：纯静态方案，需要的话在服务器加一层简单接口即可，App 侧只需改地址。