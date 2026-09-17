# TaskManager · 课程·项目·可视化工作流

霓虹荧光科技风（OKX 风格）的桌面应用，用 **Electron + React + TypeScript + better-sqlite3 + TailwindCSS** 构建。

## 下载安装

前往 [Releases](https://github.com/NightRainStarGame/USTBTaskManager/releases/latest) 下载最新版安装包：

```
TaskManager-Setup-x.y.z.exe
```

安装向导支持**自定义安装目录**，无需管理员权限（按当前用户安装）。

## 自动更新

应用内置更新模块，启动后（或手动点「检查更新」）会去读取固定地址的版本清单：

```
https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json
```

清单里的 `url` 指向 GitHub Release 上的安装包，下载后会校验 SHA-256 再安装。

> 若该地址在你的网络环境下不可达，可在「设置 → 软件更新 → 更新源地址」里填写镜像地址，例如：
> `https://cdn.jsdelivr.net/gh/NightRainStarGame/USTBTaskManager@main/latest.json`

## 使用指南

应用共六个页面：**总览 · 日历 · 课程 · 项目 · 小程序 · 设置**。所有数据都存在本机 SQLite 数据库里，不联网上传。

### 1. 总览（仪表盘）

打开应用看到的第一个页面，汇总当天要处理的事：

- **今日待办 / 今日截止**：今天到期、需要完成的作业与任务
- **今日课程 / 今日时间表**：今天有哪些课、几点上
- **进度概览**：各课程、项目的整体完成度

建议每天打开应用先看这一页，再决定先做什么。

### 2. 课程与作业

课程页有两种视图，右上角切换：

- **课程卡片**：网格展示所有课程，卡片上直接显示**作业数量**和完成度
- **课表日历**：按周展示的课程表，可用「上一周 / 下一周 / 本周」切换

日常操作：

1. **新建课程**：点「新建课程」，填课程名、教师、学分等基本信息
2. **添加上课时间**：点开课程 → 「上课时间」标签页，添加每周固定时段
3. **添加作业**：点开课程 → 「作业概览」标签页 → 「添加作业」，填标题、截止时间、备注
4. **标记完成**：在作业列表里勾选即可，完成度会自动统计

> 课表日历里显示「第 N 周」需要先在 **设置 → 学期** 里填好学期开始日期。

### 3. 课表导入（Excel / 教务）

把课表 xlsx 丢进来就行，不用再一行一行录：

1. **设置 → 课表导入 (Excel)** → 「从 Excel 导入课表」按钮
2. 选择你的 xlsx 文件 → 向导自动识别列头（课程名称 / 教师 / 周次 / 星期 / 节次 / 教室）
3. 识别错的列可以在第二步手动指定；不想导入某列就选「不映射」
4. 第三步填学年/开学日（第一周周一日期）→ 第四步预览前 12 条
5. 点「确认导入」→ 课程按周展开成带日期的日历事件，课表日历和总览里都会自动出现

支持格式：教务系统导出的「每行一节课」表格、超级课程表 App 导出的 xlsx、自制表格。
导入会**替换之前的课表导入**（教务 / Excel）；手动添加的课程和作业完全不受影响。

### 4. 班级作业发布 / 同步

课程页**右下角**有一组「班级作业」按钮，用 GitHub 仓库的 `homework/` 文件夹当全班作业公告板：

**发布作业**（课代表 / 知道密码的人用）：

1. 点「发布作业」→ 输入**发布密码**（班级共享口令）
2. 首次发布会要求填一个 GitHub 令牌（对仓库有写权限即可，只存在本机，填一次）
3. 选择**课程**和**上课日期**（会自动列出这门课近期的上课日期，每节课的作业可以不一样）
4. 写作业标题和具体内容，点「发布到 GitHub」

**同步作业**（全班都能用，无需密码）：

1. 点「同步作业」→「立即同步」
2. 发布过的作业会自动写进对应课程的作业列表（带「同步」标记），没有的课程会自动创建
3. 重复同步不会产生重复条目；你在本地勾选的完成状态不会被覆盖

### 5. 日历

- **月 / 周 / 日**三种视图，任意视图下都能「新建事件」
- 显示**农历**与法定节假日
- 教务导入的课程按时段块显示，和普通事件区分开

### 6. 项目与任务

适合管理大作业、比赛、科研等周期较长的工作：

- **看板 / 列表 / 时间线**三种视图，卡片可直接**拖拽**切换状态
- 任务支持多级拆分和进度统计

### 7. 数据安全

**设置 → 数据管理**：

- **导出全量备份**：把所有数据打包成一个 JSON 文件（建议定期导出）
- **备份导入**：从备份文件恢复。注意会**覆盖**当前全部数据，导入前会自动再备份一份当前数据
- **数据库自检修复**：怀疑数据异常时点一下，会检查并修复数据库完整性

数据库文件本体在 `%APPDATA%/TaskManager/task-manager.db`，直接拷贝这个文件也等于备份。

### 8. 软件更新

**设置 → 软件更新**：

1. 点「**检查更新**」，有新版本时会显示版本号和更新说明
2. 下载完成后显示 **SHA-256 校验值**，点「**立即安装并重启**」完成升级
3. 网络不好可点「**打开发布页**」到浏览器手动下载
4. 不想被打扰可以关掉「自动检查」，或对某个版本点「忽略此版本」

## 功能模块

- 📅 **日历** 月/周/日三视图 · 课程时段可视化 · 农历与节假日 · 新建事件
- 📚 **课程** 课程卡片网格 · 课表日历视图 · 作业（课程要求）管理与完成度追踪
- 🏫 **教务导入** 北京科技大学课表导入（按周展开为具名事件）
- 📡 **班级作业同步** 密码发布作业到 GitHub 公告板，全班一键同步（按上课日期区分每节课）
- 📂 **项目** 看板 / 列表 / 时间线三种视图 · 拖拽切换状态
- 💾 **数据安全** 一键备份 / 恢复 · 数据库自检与修复
- 🔐 **本地账号** 账号 + 密码（SHA-256 哈希存储，仅保存在本机）
- 🔄 **软件更新** 检查 / 下载 / 校验 / 静默安装并重启
- ⚙️ **设置** 主题 / 学期 / 数据导出 / 小程序配置
- 🪟 **小程序** 微信小程序 PC 端嵌套（架构预留，当前占位）


## 快速开始（开发）

```bash
npm install
npm run dev
```

会自动启动 Vite (http://localhost:5173) + Electron 窗口。

## 打包成 exe

```bash
npm run build:exe
```

输出在 `release/` 目录，NSIS 安装包约 80MB。

## 发布新版本

改完 `package.json` 里的 `version` 后：

```bash
npm run build:exe        # 打包
npm run publish:github   # 创建 Release + 上传安装包 + 更新 latest.json
```

`scripts/publish-github.js` 会自动创建 tag `vX.Y.Z` 的 Release、把安装包重命名为
`TaskManager-Setup-X.Y.Z.exe` 上传，并生成/推送仓库根目录的 `latest.json`。
可用 `--notes` / `--notes-file` 写更新说明，`--dry-run` 只预览不发布。

> GitHub 单文件上限 100 MB，所以安装包走 Release 附件，不要提交进 Git 仓库。

## 清理历史打包产物

多次打包后本地会积累几个 GB 的 `release-*` 目录，可用脚本只保留指定版本：

```bash
node scripts/clean-release.js --list                          # 只看有哪些产物目录
node scripts/clean-release.js --keep release-0.3.0 --dry-run  # 预览将删除的内容
node scripts/clean-release.js --keep release-0.2.3,release-0.3.0   # 执行清理
```

会删除项目根目录下所有以 `release` / `out-app` 开头、且不在 `--keep` 名单里的目录。
被进程占用的文件会跳过并单独提示，不影响其余清理。

## UI 设计

- 主色：霓虹绿 `#00FF88` + 霓虹黄 `#FFEA00`
- 背景：纯黑 + Canvas 粒子动态背景 + 网格 + 鼠标光晕
- 字体：JetBrains Mono（数据感）+ Inter（正文）
- 元素：玻璃拟态 · 荧光边框 · 扫描线 · 状态指示灯
- 灵感：OKX 行情面板 · 区块链终端

## 数据存储

SQLite 数据库存放在系统用户目录：
- Windows: `%APPDATA%/TaskManager/task-manager.db`
- macOS: `~/Library/Application Support/TaskManager/task-manager.db`
- Linux: `~/.config/TaskManager/task-manager.db`

首次启动自动写入示例数据（3 门课程、5 个要求、3 个日历事件、1 个项目）。

## 快捷键

- `Ctrl/⌘ + K` 全局搜索
- `Ctrl/⌘ + N` 新建资源菜单
- `Esc` 关闭弹层

## 微信小程序嵌套接入

本应用已预留完整接口（`window.taskAPI.miniprogram.*`）。详见 `src/pages/MiniProgram.tsx` 与 `electron/ipc/index.ts`。

真实接入步骤：
1. 小程序后台「设置 → 关联设置」关联公众号
2. 配置「业务域名」白名单
3. 用 Electron `<webview>` 替换占位组件，或集成 WMPF PC 框架

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Electron 33 |
| 前端 | React 18 + TypeScript + Vite 5 |
| 数据库 | better-sqlite3 |
| 样式 | TailwindCSS 3 |
| 状态 | Zustand |
| 路由 | React Router 6 |
| 图标 | Lucide React |
| 日期 | Day.js |
| 打包 | electron-builder |

## 目录

```
TaskManager/
├─ electron/      # 主进程 + 数据库 + IPC
│  ├─ db/         # SQLite schema / 迁移 / 自检修复
│  ├─ ipc/        # 渲染进程 IPC 接口
│  ├─ backup/     # 备份与恢复
│  ├─ updater/    # 软件更新（检查 / 下载 / 校验 / 安装）
│  └─ ustb/       # 教务课表导入
├─ src/
│  ├─ components/ # 通用组件
│  ├─ pages/      # 六大模块
│  ├─ store/      # Zustand
│  ├─ hooks/      # 自定义 hooks
│  ├─ types/      # 类型定义
│  └─ styles/     # 全局样式
├─ scripts/       # 发布脚本 + 端到端测试脚本
├─ docs/          # 设计问答与部署文档
├─ build/         # 应用图标（electron-builder 资源）
├─ latest.json    # 自动更新清单（固定地址，App 读取它）
├─ dist/          # Vite 产物
├─ dist-electron/ # 主进程产物
└─ release/       # electron-builder 打包输出（不入库）
```
