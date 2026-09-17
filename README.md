# TaskManager · 课程·项目·可视化工作流

霓虹荧光科技风（OKX 风格）的桌面应用，用 **Electron + React + TypeScript + better-sqlite3 + TailwindCSS** 构建。

## 功能模块

- 📅 **日历** 月/周/日三视图 · 课程时段可视化 · 新建事件
- 📚 **课程** 课程卡片网格 · 要求管理 · 完成度追踪
- 📂 **项目** 看板 / 列表 / 时间线三种视图 · 拖拽切换状态
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
├─ src/
│  ├─ components/ # 通用组件
│  ├─ pages/      # 四大模块
│  ├─ store/      # Zustand
│  ├─ hooks/      # 自定义 hooks
│  ├─ types/      # 类型定义
│  └─ styles/     # 全局样式
├─ dist/          # Vite 产物
├─ dist-electron/ # 主进程产物
└─ release/       # electron-builder 打包输出
```