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

## 功能模块

- 📅 **日历** 月/周/日三视图 · 课程时段可视化 · 农历与节假日 · 新建事件
- 📚 **课程** 课程卡片网格 · 课表日历视图 · 作业（课程要求）管理与完成度追踪
- 🏫 **教务导入** 北京科技大学课表导入（按周展开为具名事件）
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
