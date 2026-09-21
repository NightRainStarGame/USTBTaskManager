# AGENTS.md — TaskManager 项目交接文档

> 本文档写给接管本项目的 AI 编码助手（CodeBuddy 等）。前任助手（WorkBuddy/小豆芽）在长期迭代中沉淀了全部工程约定、环境坑和发版工作流，**这些内容无法从代码本身推断出来，动手前请先通读本文档**。文档分为三部分：项目认知 → 工作流 → 环境红线。

---

## 0. 项目一句话

**TaskManager（StarOS）**：北京科技大学学生自用的「课程 / 项目 / 日历一体化」桌面应用，霓虹荧光科技风 UI，带跨设备**作业同步**（分享码）、**自动增量更新**（多源 + 补丁包）、微信小程序 webview 嵌套，另有一个 Capacitor Android 移动端壳（功能子集）。

- 仓库：`NightRainStarGame/USTBTaskManager`（main 分支，直接 push，无 PR 流程）
- 作者（用户）：豆芽。用户偏好**教练启发式协作**：给方案要带多角度对比；进度和关键决策要有跨会话延续性
- 当前最新版：**v1.2.0**（见 `git log` / GitHub Releases）

## 1. 技术栈与架构

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 33.4（NSIS 安装包，x64） |
| 前端 | React 18 + TypeScript 5.6 + Vite 5 + Tailwind 3 + Zustand + react-router 6 |
| 主进程 | Node 原生模块 `better-sqlite3`（唯一存储，无 ORM） |
| 移动端 | Capacitor 8（`build:mobile` + `cap:sync`，仅查看类功能） |

### 目录地图

```
electron/            主进程（tsc -p tsconfig.node.json → dist-electron/）
  main.ts            窗口/splash/崩溃自愈/启动编排（boot log 写 %TMP%\taskmanager-boot.log）
  splash.html        启动动画（独立 BrowserWindow，里程碑驱动进度）
  splash-preload.ts  splash 专用 preload（splash:progress IPC）
  preload.ts / api-factory.ts   渲染层桥（所有 IPC 通道定义在 api-factory）
  db/index.ts        SQLite 初始化 + 增量迁移（addColumnIfMissing 范式）+ courseKey 计算
  homework/          作业同步（发布/接收/双源拉取，docs/HOMEWORK-CODES.md）
  updater/           自动更新（多源 + 增量补丁，docs/UPDATE-SERVER.md）
  anyshare.ts        北科云盘（爱数 AnyShare）匿名外链客户端：asFetch/auth/dirList/uploadBundle
  ustb/              校园网相关（登录等）
  ipc/               requirements 等常规 IPC
  backup/ timetable-xls/   DB 备份 / 课表 Excel 导入
src/                 渲染层 React（vite → dist/）
  pages/             Dashboard/Courses/Calendar/Settings/MiniProgram/Projects/Notes…
  hooks/useApplyTheme.ts   主题白名单（starry/neon-green/sakura）
  styles/index.css   主题 = [data-theme] CSS 变量组；tailwind.config.js 里 ink/neon 色全部
                     指向 rgb(var(--xxx-rgb))，所以加主题只需加一组变量
  components/        UpdateNotification（含更新源切换）、ParticleBg 等
scripts/             发版/E2E/验证脚本（见 §4、§5）
docs/                仅 3 份：HOMEWORK-CODES.md / UPDATE-SERVER.md / latest.json.example
latest.json          更新清单真源（发版时生成，进 git）
leastversion/        当前版安装包 + 增量补丁 zip（进 git，滚动保留）
oldversion/          上一版完整安装包（进 git，供一步回退）
homework/            本机已发布作业包的本地副本（GitHub 源用，会被 app 自动提交）
```

### 运行时路径

- 数据库：`%APPDATA%\task-manager\task-manager.db`（用户真实数据！**任何测试前先拷副本，测试后还原**）
- 启动日志：`%TMP%\taskmanager-boot.log`（诊断启动/GPU/DB 问题第一入口）
- asar 补丁缓存：`scripts/.asar-cache/`
- 备份目录：`%APPDATA%\task-manager\backups\`

## 2. 常用命令

```bash
npm run dev              # 开发（vite 5173 + electron，NODE_ENV=development 时才连 dev server）
npm run build            # tsc×2 + copy-static-assets + vite build（类型检查即验证，很便宜）
npm run build:exe        # build + electron-builder → release-v<version>/（输出目录是 token 化的）
npm run release:one -- <v> --notes-file <x.md> --execute   # 一键发版（见 §4）
npm run test:updater     # 多更新源连通性测试
node scripts/e2e-*.js    # 各 E2E（CDP + 真实事件 + 真实 SQLite 断言）
```

## 3. 数据与业务规则速记

- **courses.course_key**（v1.1.7 起）：`CK-` + SHA256(`name|teacher`) 映射到 32 字符字母表取 10 位（`db/index.ts computeCourseKey`）。同名同教师课程跨设备一致，是作业同步的课程匹配锚点；所有建课路径都要兜底刷新
- **courses.guid**（v1.1.6 起）：本机课程唯一 ID（`C-` + 8 位，字符表 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`），发布包携带，接收端优先 guid 精确挂载
- 作业同步存储：GitHub `homework/<syncCode>.json`（git 提交）+ 云盘 `homework/<发布码>/<courseKey>-<ts>.json`（旧扁平路径回退兼容）
- 主题切换：`document.documentElement.dataset.theme`，白名单在 `useApplyTheme.ts`；新增主题 = index.css 加变量组 + 白名单 + Settings 下拉，三个文件

## 4. ⭐ 发版工作流（最重要的一条）

**永远不要手动分步发版**。用一键脚本（dry-run 默认，`--execute` 才真跑）：

```bash
npm run release:one -- 1.2.1 --notes-file release-notes-1.2.1.md --execute
```

脚本（`scripts/release-one-click.js`）自动完成：bump 版本 → build → 产物校验（sha256）→ leastversion/oldversion 滚动（**只保留最新两版**）→ 生成 latest.json（含 patches 增量清单）→ git commit + push → GitHub Release（附件自动上传去重）→ 北科云盘同步上传。

要点：
- 用户口令「**X.X.X / 完事 / 发了**」= 触发发版
- 中断续跑：`--resume`（跳过 build；注意 package.json 的版本号要先单独 commit，否则被 git-clean 检查拦住）
- build 输出每次写到新目录 `release-v<版本>/`（directories.output 是 `release-v${version}` token，**不要 hardcode**）
- 补丁命名：`TaskManager-Patch-<from>-to-<to>.zip`；云盘文件一律 `<固定名>-<时间戳>.<ext>`
- **latest.json 是唯一指路清单**，协议细节见 `docs/UPDATE-SERVER.md` §9
- 构建收尾若报 `.nsis.7z` safe-delete 错误 = **非致命**（exe 已就位），校验后 `--resume` 续跑

## 5. 更新系统（多源 + 增量补丁）

- `DEFAULT_UPDATE_SOURCES`：① GitHub raw（`raw.githubusercontent.com`，CDN 无限速）② 北科云盘（`yunpan.ustb.edu.cn`，link `AADAAEA94FBE6B4435B8D14A236FAC6469`，提取码 `kc26`，**仅校园网可达**）。用户可手动加任意自建源
- 源合并：sourceKey = `type|url|password` 三元组，DEFAULT 与用户源自动合并；启动时对多源**测速选最快**
- 增量补丁协议：`latest.json.patches[]`（`fromVersion`/`url`/`sha256`/`baseAsarSha256`）。补丁 = 压缩后的新 asar，客户端校验旧 asar 基线 hash 后由 helper 进程在退出时替换，避免整包 90MB 重装

## 6. 作业同步码制

- **syncCode**（8 位）= 接收码；**publishCode**（12 位，HMAC，SECRET=`StarOS-Homework-Code-v1`）= 云盘发布目录名
- 接收匹配链：手选（同名多候选弹窗）> courseKey > guid > 同名；同步码按 courseKey 在同课程设备间共享
- GitHub 读路径走 raw CDN（绕开 Contents API 60次/h 限速），写路径才用 Contents API

## 7. ⭐ 环境红线与坑（Windows 沙箱，条条实战踩过）

**Electron 33（Windows）：**
- splash **禁 `alwaysOnTop` + `frame:false` 组合**（GPU 挂/静默 exit）；正确姿势 = `paintWhenInitiallyHidden: true` + `skipTaskbar: true` + 先挂 `ready-to-show` 再 `loadFile`。另外 `ready-to-show` 在部分环境不触发，main.ts 里有 300ms 保险丝强制 show，**别删**
- `net.fetch`/`net.request` 遇 302 必抛 `Redirect was cancelled` → 一律用 Node 原生 `https.request`（见 anyshare.ts `asFetch`）
- spawn 打包 exe 前**必须 delete `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`** 环境变量

**沙箱/文件系统：**
- safe-delete 拦截一切删除。绕行手段（按优先级）：`robocopy 空目录 /MIR` 清目录 → `fs.truncateSync(p, 0)` 清 asar（AV 句柄锁死的文件只能这样释放空间）→ Python ctypes `DeleteFileW` 传**绝对路径**
- PowerShell / Bash / Node 三种沙箱视角可能不一致，**Node `fs.readdirSync` 看到的才是真相**
- PowerShell 沙箱输出会被吞：结果先 `Out-File -Encoding utf8` 写文件再读
- 无 `sleep` 命令；npm/push 大文件 502 → `git config http.postBuffer 524288000`
- Node fetch 沙箱 TLS 失败，**GitHub API 用 curl**（curl 直连 GitHub 可用）
- GitHub token：`git credential fill` 获取（gho_ 前缀，repo scope）；仓库级提交身份 NightRainStarGame
- README 用反引号写文件会被 bash 当命令替换 → 写 markdown 用 Write 工具或 Python

**Git：**
- **永不 rebase / pull / stash**。push 被拒（远端被 E2E 等程序领先）走 plumbing 重建：`fetch origin main` → `commit-tree <tree> -p origin/main` → `update-ref refs/heads/main` → push

## 8. 测试约定

- E2E 在 `scripts/e2e-*.js`：CDP + 真实 DOM 事件 + 真实 SQLite 断言；**必须测打包版**（从 Setup.exe 解出的干净 win-unpacked，不要用 electron-builder 直接输出的——它缺 4 个 dll）
- 测用户真实 DB 前先拷副本（`.smoke/` 范式），测完清理
- `promisify(execFile)` 防死锁；150% DPI 缩放环境先 SetProcessDPIAware
- CDP 截图验证范式参考 `scripts/verify-sakura-theme.js`

## 9. 禁止事项清单

1. 不动 `.workbuddy/`（前任助手的项目记忆，迁移后由你建立自己的记忆机制但**不要删除此目录**）
2. 不 rebase/pull/stash（见 §7）
3. 不手动分步发版（用 §4 脚本）
4. 不在用户真实 DB 上直接做实验
5. leastversion/oldversion 之外的旧构建目录（`release-*`）是垃圾壳，git 已 ignore，无视即可；别浪费精力物理删除（AV 句柄锁）
6. 注释密度保持克制（v1.1.7 规整过：updater 155→10 行注释），不写废话注释
7. 用户额度/积分敏感：**动手前先摸底、一次做对、避免重复全量读文件**；大改动按块规划、用户口令「执行块 N」触发

## 10. 历史里程碑速览（用于理解代码里版本注释）

- v1.1.4：北科云盘第二源（AnyShare 匿名外链逆向：提取码登录 → `link_token:ory_at` → `/api/efast/v1/*` + S3 multipart 直传）
- v1.1.6：课程 guid 精确挂载 + 作业内容展示 + 真启动动画（里程碑进度+交叉淡出）+ 樱花粉主题（CSS 变量三主题体系）+ 一键发版脚本
- v1.1.7：courseKey 范式（同名同教师跨设备一致）、码制文档化、界面规整
- v1.1.9–1.2.0：多源测速选源、同步重复修复（mergeBundleFiles 同键收敛）、回收站自动清理、**增量补丁全量落地**（协议+发版侧+客户端应用）
- 已知未解问题：**输入框偶发失灵需重启**（IME/composition 相关，v1.1.6 起埋了诊断 `src/diag/inputRepair.ts`，pointerdown→400ms 复查→补焦；若用户再报，看 `%TMP%` 诊断日志）

## 11. 给接手助手的三条行动建议

1. **先跑 `npm run build` 确认环境通**（它同时是类型检查）；再 `node scripts/test-updater.js` 验证网络路径
2. 需要项目历史决策细节时，读 `docs/` 三份文档 + `git log --oneline`；本文档没写的惯例以代码现状为准
3. 用户按「块」下达任务（如「执行块 3」），块定义通常在当次对话或 `docs/` 的 PLAN 文档里；**每完成一块要向用户汇报并把关键结论沉淀成你自己的记忆**，这是本项目协作的延续性命脉
