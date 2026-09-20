# TaskManager · 课程·项目·可视化工作流

霓虹荧光科技风（OKX 风格）的桌面应用，用 **Electron + React + TypeScript + better-sqlite3 + TailwindCSS** 构建。

## 下载安装

最新版 raw：`https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/leastversion/TaskManager-Setup-1.1.7.exe`

[Releases](https://github.com/NightRainStarGame/USTBTaskManager/releases/latest) 页面也能下载。

> 国内访问 GitHub raw 偶尔慢，可加 jsDelivr 镜像作为兜底：
> `https://cdn.jsdelivr.net/gh/NightRainStarGame/USTBTaskManager@main/leastversion/TaskManager-Setup-1.1.7.exe`

安装向导支持**自定义安装目录**，无需管理员权限（按当前用户安装）。

## 自动更新

应用内置更新模块，启动后（或手动点「检查更新」）会**同时检查所有启用的源**，取版本号最高的那个升级；
一个源连不上不影响其他源。

App 自带默认两个源：

| 源 | 清单地址 | 说明 |
|---|---|---|
| **GitHub / leastversion**（主源） | `https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json` | 与仓库发布动作同步，国内偶尔慢 |
| **北科云盘**（AnyShare，需校园网） | `https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469` + 提取码 `kc26` | 校园网内速度最快，非校园网会超时失败 |

> 应用启动时会**合并**内置源与本地已有源（按 URL + 密码三元组比对），新增的源自动并入、用户手动加的源不动。

清单里的 `url` 指向该源自己的安装包，下载后校验 SHA-256，**不匹配会拒绝安装**。

> 想换源 / 加源：**设置 → 软件更新 → 更新源**，可以增删源、切换主源。

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
4. 选择**发布目标**（默认同时勾上 GitHub + 北科云盘，双通道发布；只勾一个也行）
5. 写作业标题和具体内容，点「发布」

> **双源发布** —— 一次填写会同时推到 GitHub 仓库和北科云盘（任一失败不影响另一个）。
> 设置 → 作业同步里也能改默认发布目标，持久化到本机。

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

1. 点「**检查更新**」，会同时查所有启用源，有新版本时显示版本号和更新说明
2. 下载完成后显示**SHA-256 校验值**，点「**立即安装并重启**」完成升级
3. 网络不好可点「**打开发布页**」到浏览器手动下载
4. 不想被打扰可以关掉「自动检查」，或对某个版本点「忽略此版本」
5. 下方「更新源」可以增删源、切换主源（改了记得点「保存源」）

## 功能模块

- 📅 **日历** 月/周/日三视图 · 课程时段可视化 · 农历与节假日 · 新建事件
- 📚 **课程** 课程卡片网格 · 课表日历视图 · 作业（课程要求）管理与完成度追踪
- 🏫 **教务导入** 北京科技大学课表导入（按周展开为具名事件）
- 📡 **班级作业同步** 密码发布作业到 GitHub 公告板，全班一键同步（按上课日期区分每节课）
- 📂 **项目** 看板 / 列表 / 时间线三种视图 · 拖拽切换状态
- 💾 **数据安全** 一键备份 / 恢复 · 数据库自检与修复
- 🔐 **本地账号** 账号 + 密码（SHA-256 哈希存储，仅保存在本机）
- 🔄 **软件更新** 多源（GitHub + 北科云盘）聚合检查 / 下载 / SHA-256 校验 / 静默安装；增量补丁协议（典型更新 12% 体积）；输入框失灵自检与补焦
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

输出在 `release-v<版本>/` 目录，NSIS 安装包约 85MB。

## 发布新版本

改完 `package.json` 里的 `version` 后：

```bash
npm run release:one -- 1.1.7 --notes-file RELEASE-NOTES.md        # 一键：build + 双源分发 + commit + push + Release 附件
# 或手动分步：
npm run build:exe          # 打包
npm run publish:github     # ① 同步一份到 GitHub（含 Release 附件）
npm run publish:ustbcloud  # ② 上传到北科云盘（需校园网；校园网外会超时失败，不阻塞主流程）
```

> **推荐用 `release:one`（一键脚本）**：自动完成打包 → 校验 → 分发目录滚动 → latest.json 写入 →
> 增量补丁生成 → GitHub leastversion 推送 → GitHub Release 创建 → 草稿附件上传 → 云盘同步上传。
> `--execute` 才会真正改动文件；默认 dry-run 只预览计划。

### 双源清单内容差异

GitHub 源 `url` 字段是 raw 绝对链接；北科云盘源上传时会把 `url` 改写为**云盘内 basename**
（匿名不能覆盖同名，安装包按 `<basename>-<ts>.exe` 上传）。App 端 `resolveDownloadUrl`
按 basename 前缀找修改时间最新的一份再换签名直链下载。

`patches[]` 同样规则：GitHub 版是 raw 绝对链，云盘版改写成云盘内 basename。

### 自建源（可选）

如需额外搭建自建更新源（VPS / CDN），脚本 `scripts/publish-vps.js` 会把 `leastversion/` 的安装包
和 `latest.json` 拷到站点目录（默认 `D:\StarMain\Web\downloads\taskmanager\`），再由站点部署到线上：

```bash
node scripts/publish-vps.js                # 发布当前版本
node scripts/publish-vps.js --dry-run      # 只预览计划，不动文件
node scripts/publish-vps.js --notes-file RELEASE-NOTES.md
node scripts/publish-vps.js --site D:\StarMain\Web   # 换站点目录
node scripts/publish-vps.js --keep 1       # 历史版本只留 1 个（默认 2）
npm run verify:vps                         # 自检线上清单是否正常
```

> **更新源地址写在哪？** 内置默认值是 `electron/updater/index.ts` 的 `DEFAULT_UPDATE_SOURCES`
> （**重新打包后才对新装用户生效**）；已安装用户的值存在本机 SQLite 的 `update_sources` 设置里，
> 在「设置 → 软件更新 → 更新源」改，不用重新打包。

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