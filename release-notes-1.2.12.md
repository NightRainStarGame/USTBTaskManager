# TaskManager v1.2.12

> 本次主题：**所有云能力的主源切换到自建 SSIO 服务器**，顺带把移动端（Android）的 UI 重叠 / 按钮点不上彻底根治。

## 一、云服务主源统一为 SSIO

以前三套后端各用各的：班级走 GitHub API、作业同步走 GitHub 数据仓 + 北科云盘、更新走 GitHub raw + 云盘。痛点很集中：GitHub 国内可达性差（还常被 DNS 劫持）、匿名 Contents API 只有 60 次/h、内置 PAT 有泄漏爆炸半径，北科云盘仅校园网可达且在移动端直接不可用。

v1.2.12 把 **SSIO（自建 BaaS）立为所有云能力的主源**，GitHub / 北科云盘降级为备源（SSIO 不可达时自动回退）：

| 能力 | v1.2.11 及以前 | v1.2.12 |
|---|---|---|
| 自动更新 | GitHub raw（主） | **SSIO（主）** → GitHub raw → 北科云盘 |
| 班级（公告 / 接龙 / 投票 / 成员） | GitHub API + 内置 PAT | **SSIO KV（主）** → GitHub → 云盘 |
| 作业同步 | GitHub 数据仓 + 云盘 | **SSIO（主）** → GitHub 镜像 |

- **不再需要用户自己申请 GitHub 令牌**：SSIO 用内置客户端 Key，开箱即用。想用自己的 PAT 仍然可以，只是变成备源。
- **强一致**：GitHub raw 有最长 5 分钟的 CDN 缓存（v1.1.8 就栽在「发布后立刻接收拿到旧包」），SSIO 是读写直通，发布完对方立刻能收到。
- **移动端可用**：SSIO 支持 CORS，Android WebView 用 fetch 直连即可；北科云盘在移动端因为依赖 Node 的 https 模块，依然不可用。
- **安全边界**：内置的客户端 Key 只有 `release:read` + `storage:read/write`，**没有 `release:write`** —— 源码公开也不可能被用来推送恶意更新包。发版走 Master Key，只存在本机脚本里。

### 服务端为此新增了 KV 模块
SSIO 原本只有对象存储（上传后只能凭 fileId 取回、且没有列举接口），跨设备无法发现对方写的文件，做不了「多端共享同一份结构化数据」。为此给 SSIO 增加了 `/v1/kv`（按 key 存 JSON，带 version 乐观锁）：

- `GET /v1/kv?key=` / `PUT /v1/kv?key=`（支持 expectedVersion 乐观锁）/ `DELETE` / `GET /v1/kv/list?prefix=`
- 鉴权复用 `storage:read` / `storage:write`，已有业务 Key 直接可用
- 班级与作业的文件路径协议（`class/<code>/manifest.json`、`homework/<code>.json`）原样保留，只是换了后端

## 二、班级：修掉「成员一个都看不到」

两个真因，都在写入侧：

1. **创建班级时，只有用户配了 GitHub PAT 才写云端**（`if (ghToken)`，没配就整段跳过）→ 班级只躺在本机 → 别人按邀请码加入时远端根本没有 manifest。
2. **加入班级时同理**：没配 PAT 就不把自己写进云端成员表 → 加入者永远不出现在其他人的成员列表里。

现在写入不再受「有没有令牌」影响（SSIO 内置 Key 永远可写），失败才记 warning 而不是静默跳过。

## 三、Android 版重做（APK）

上一版（1.2.11 rev1/2）反馈「菜单和信息栏重叠、许多按钮点不上」，这次定位到两个真因并根治：

1. **页面动画劫持了 `fixed` 定位** —— 页面切换动画 `pageIn/panelIn` 的终态写的是 `translate3d(0,0,0)`，而 `animation-fill-mode: both` 会永久保留终态。任何非 `none` 的 transform 都会让该元素变成后代 `position:fixed` 的包含块，并被 `overflow` 裁剪 → 设置页保存条、课程抽屉、弹窗、右键菜单全部脱离视口，点不到。终态改成 `transform: none` 后全部恢复。
2. **安全区值永远读到 0** —— 只在启动时读一次插件，但 Activity 早期 `getRootWindowInsets()` 常返回 null，之后又没有事件触发重读。改为：原生 `OnApplyWindowInsetsListener` 主动推送 + Web 多轮探测 + 本地缓存 + 3.6s 后的兜底值，并叠加 CSS `env(safe-area-inset-*)` 双层取大。

另外：Toast 层级从 `z-60` 降到 `z-45`（原来正好压住抽屉右上角关闭按钮）、崩溃页与项目画布补安全区、页面底部给悬浮球留出空间（列表最后几项不再被盖住）。

versionCode 提升到 **9**，装了旧包的机器可正常覆盖升级。

## 四、其它

- 更新源列表新增「SSIO 官方源」并设为默认主源；老用户升级后自动切换（本机已存的源不再挡住新默认源）
- 桌面端回归验证通过（动画 keyframes 与安全区变量是桌面/移动共用，已确认桌面布局零回归）
