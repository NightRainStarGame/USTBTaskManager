# TaskManager v1.1.6 — 多源分发 + 增量补丁 + 真·启动动画 + 樱花粉主题

## 软件更新三源（首次内置三个源）

- **StarOS 自建站（主源）** `nrsc.games` + **GitHub leastversion（备）** + **北科云盘 AnyShare（校园网内最快）**
- 新装用户默认三个源都启用；老用户升级时 App 自动合并 DEFAULT_UPDATE_SOURCES 与本地已有源（URL+密码三元组比对），新源自动并入、用户手动加的源不动 —— 不会再因为历史配置只看到 1 个源而漏升
- App 端云盘查找从「精确名」改为「按前缀找修改时间最新的一份」（与作业包模式一致；匿名云盘不能覆盖同名）

## 增量补丁（块 4）

- `latest.json.patches` 字段：列出 `<fromVersion>-to-<toVersion>.zip` + sha256 + size + baseAsarSha256
- 典型更新体积 90 MB → ~11 MB（12%）；App 检测到 patch 可用时优先走补丁通道
- helper 进程（`ELECTRON_RUN_AS_NODE=1`）等主进程退出后 rename 旧 + 落新 asar；任何一步失败回退全量 Setup

## 作业同步双源发布

- 课程表新增 `guid` 列（8 位 + 唯一索引）；作业包带 `courseGuid`，同名多门课程不再乱挂
- 作业内容（`description`）终于在卡片上可展开
- UI 默认同时勾上「GitHub + 北科云盘」双通道发布；任一失败不影响另一个
- `settings.homework_default_targets` 持久化默认发布目标

## 真·启动动画

- splash 阶段：StarOS logo 缩放渐入 + 进度点 + 加载文案轮播
- 由 `dbReady` / `domReady` 里程碑驱动；守住 v1.1.5 红线（无 alwaysOnTop、paintWhenInitiallyHidden + skipTaskbar、先 ready-to-show 再 loadFile）

## 樱花粉主题 🌸

- 设置 → 主题新增「🌸 樱花粉」（粉白底 + 玫瑰粉强调）
- done / in_progress / overdue 状态色重调使其在粉系下协调

## 输入框失灵自检

- 渲染层探测器（环形缓冲 50 条），input focus 状态下 keydown 停止 > 8s 自动判定失灵
- 抓快照 + 写 `%TMP%/taskmanager-input-diag.log`（自动 2MB 轮转）
- 设置 → 高级可导出诊断日志

## 发版一键化

- `npm run release:one -- 1.1.7 --notes-file ...` 自动完成：build + patch + leastversion + GitHub Release + 北科云盘上传 + commit + push
- `--no-cloud` / `--no-release-page` 可关掉单步
- `npm run publish:ustbcloud` 单跑云盘上传

## 安装包分两个目录（仓库内固定下载）

- `leastversion/TaskManager-Setup-1.1.6.exe` —— 最新版
- `oldversion/TaskManager-Setup-1.1.5.exe` —— 上一版（保留回退）

## 从 1.1.5 升级

应用内「设置 → 软件更新 → 检查更新」直接升级（典型体积仅 ~11 MB 补丁），或到 Releases 页下载覆盖安装（数据保留）。