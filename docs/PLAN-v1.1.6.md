# v1.1.6 工程分块计划（额度受限版）

> **背景**：剩余额度约 100+ 积分，不足以一次完成全部 8 项需求。本文档把 v1.1.6 拆成
> 每块约 100 积分的独立工作包，用户按块下令执行，每块一个会话完成。
> **本版只改本地，不上传**；发版时用一键脚本（见块 0）。

---

## 根因侦查结果（已完成，执行块时无需重新摸底）

| # | 需求 | 根因 / 落点 | 涉及文件 |
|---|------|------------|---------|
| 1 | 作业同步挂错课 | `electron/homework/index.ts:630` 纯同名匹配 `WHERE TRIM(name)=? LIMIT 1`，同名课程必挂第一个 | `electron/homework/index.ts`、`src/pages/Courses.tsx`（接收弹窗） |
| 2 | 启动动画是"预加载" | `electron/main.ts:63-96` splash 只是 `hide()→show()` 占位窗，无动画内容；用户期望：**独立可见的动画窗口**（logo 动效 + 进度），主窗就绪后交叉淡出 | `electron/main.ts`、`electron/splash.html`（或新 `splash/` 目录） |
| 3 | 更新应打补丁而非整装 | 当前 updater 只会下载整个 Setup exe（`electron/updater/index.ts` 的 `downloadUpdate`） | `electron/updater/index.ts`、`scripts/release-one-click.js`、manifest 协议 |
| 4 | 输入框用久失灵 | 未定位。嫌疑：Electron 33 IME composition bug / 焦点被劫持 / 全局事件吞 keydown | 需先埋点（见块 3） |
| 5 | 粉色萌系主题 | 主题系统已是 `data-theme` + CSS 变量（`src/styles/index.css`，现有 `starry` / `neon-green` 两套），加第三套 `sakura` 即可 | `src/styles/index.css`、`src/hooks/useApplyTheme.ts:9`（白名单）、`src/pages/Settings.tsx`（选择器） |
| 6 | 一键上传 GitHub 脚本 | **已随本文档完成**：`scripts/release-one-click.js` | — |
| 7 | 工程分块文档 | 本文档 | — |
| 8 | 同步作业详情看不到内容 | 数据其实**已经写进** `course_requirements.description`（`index.ts:650-663`），但 UI 从不渲染：`RequirementRow`（`Courses.tsx:955-979`）只显示标题+元信息；`ReqInlineEditor`（:981+）只编辑 `notes` 不碰 `description`。**另注意**：编辑器保存时 spread `req` 全字段，若列表 SELECT 没查 `description` 列，保存同步作业会把内容置 null（叠加 bug） | `src/pages/Courses.tsx`、requirements 查询 IPC |

---

## 分块计划

### 块 0 —— 本轮已完成（文档 + 脚本）✅
- `docs/PLAN-v1.1.6.md`（本文档）
- `scripts/release-one-click.js`（一键发版：改版本号 → build → 校验 → leastversion/oldversion 滚动 → latest.json → push → 可选 GitHub Release 页。默认 dry-run 预览，`--execute` 才真跑）
- npm script：`npm run release:one -- 1.1.6 --notes-file xxx.md --execute`

---

### 块 1 —— 作业同步双修复（需求 1 + 8）｜预估 60~100 积分
**触发口令**：「执行块 1」

**方案（#1 课程精确挂载）**
1. `courses` 表加 `guid` 列（`addColumnIfMissing` 迁移，`electron/db/index.ts`），建课时自动生成 8 位短 ID（复用作业码字符表 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`，避免与 UI 冲突可加前缀 `C-`）
2. 发布时 `HomeworkFile` 增加 `courseGuid` 字段（courseName 保留用于展示）
3. 接收端匹配链（`homework/index.ts` receive 逻辑）：
   `courseGuid 精确命中` → `同名唯一` → `同名多个：返回 candidates 列表给前端弹窗让用户手选`（前端已有 `courseNotFound` 弹窗模式可扩展）
4. 老作业包（无 guid）自动降级为现行为 + 同名多课时弹窗

**方案（#8 作业内容展示）**
1. requirements 列表查询确认 SELECT 含 `description`
2. `RequirementRow`：有 description 的条目加展开箭头，点击展开显示内容区（发布人 / 上课日期 / 内容全文）
3. `ReqInlineEditor` 加「作业内容」只读 textarea（同步作业内容不允许本地改，防止下次同步被覆盖时产生困惑；本地新建作业则可编辑）
4. 保存 payload 显式带上 `description`，防置 null

**验收**
- E2E：本地建两门同名课程 → 发布带 guid 的包 → 接收必须挂到 guid 对应的那门
- E2E：老格式包（无 guid）+ 同名多课 → 弹窗出现且手选生效
- 手测：接收的作业在详情里能看到完整内容；编辑该作业再保存，内容不丢

---

### 块 2 —— 启动动画 + 粉色主题（需求 2 + 5）｜预估 60~100 积分
**触发口令**：「执行块 2」

**方案（#2 真·启动动画）**
- splash 保持独立 `BrowserWindow`（frameless、transparent 可选），但内容升级为动画：StarOS logo 缩放渐入 → 进度点动画 / 加载文案轮播（「正在唤醒小豆芽…」「正在加载课程数据…」）
- 主窗 `ready-to-show` 后：splash 先 `opacity` 淡出（`electron/main.ts` 用 `setOpacity` 或 CSS transition + `destroy` 延时）再销毁，形成交叉过渡
- **v1.1.5 踩坑红线（必须遵守）**：禁 `alwaysOnTop`；禁 `setMenuBarVisibility`；保留 `paintWhenInitiallyHidden: true` + `skipTaskbar: true`；先挂 `ready-to-show` 再 `loadFile`
- 动画分阶段进度：真实里程碑（db ready / 主窗 dom-ready）驱动进度条，而不是假定时器

**方案（#5 樱花粉主题）**
- `src/styles/index.css` 加 `[data-theme="sakura"]` 变量组：粉白底、玫瑰粉强调色、加大圆角、柔光阴影
- `useApplyTheme.ts:9` 白名单加 `'sakura'`
- Settings 主题选择器加第三项「🌸 樱花粉（萌系）」
- 图表/状态色（红涨绿跌约定不涉及；但 done/in_progress/overdue 状态色需要粉系协调重调）

**验收**
- 打包版（非 dev）启动录屏确认动画 + 无 GPU 崩溃（boot log 有 `window created (dbReady=true)`）
- 三主题切换截图对比，粉色下所有页面文字可读（重点 Settings / Courses / Calendar）

---

### 块 3 —— 输入框失灵：埋点 + 修复（需求 4）｜预估 60~100 积分（视日志可能滚入下一块）
**触发口令**：「执行块 3」

**第一步：诊断埋点（小改动，若块 2 有富余可并入块 2 尾部）**
- 渲染层全局监听：`compositionstart/compositionend`、`keydown`（记录最近 50 条到环形缓冲）、`window blur/focus`
- 失灵特征检测：input focus 状态下 keydown 停止到达 → 自动抓取环形缓冲 + focus 状态 + 最近 IPC 调用耗时写入 `%TMP%\taskmanager-input-diag.log`
- Settings 加「导出诊断日志」按钮（读取该文件展示/复制）

**第二步：等用户复现一次，回传日志，再定位修复**
- 常见嫌疑排序：① Electron 33 / Chromium 已知 IME bug（compositionend 后编辑器失焦但焦点态残留）→ workaround：compositionend 后强制 `blur()+focus()` 或升级 Electron patch 版；② 某全局组件（如 UpdateNotification 浮窗）挂载时抢焦点；③ 慢 IPC 阻塞主线程导致事件丢弃
- 不可控性高：若一轮埋点定位不到，修复动作滚入块 4a 会话继续

---

### 块 4a —— 增量更新：协议 + 发版侧（需求 3 前半）｜预估 60~100 积分
**触发口令**：「执行块 4a」

**协议设计（manifest 扩展，向后兼容）**
- `latest.json` 增加 `patches` 字段：
  ```json
  "patches": [
    { "fromVersion": "1.1.5", "url": ".../patches/1.1.5-to-1.1.6.zip",
      "sha256": "...", "size": 1234567,
      "baseAsarSha256": "旧版 app.asar 的期望 hash（校验基线）" }
  ]
  ```
- **方案 A（推荐，先做）：文件级差分 zip** —— 解包新旧 app.asar → 对比文件 hash → 补丁 zip 只含「变更 + 新增」文件 + 一个 `manifest.json`（含删除清单 + 各文件 hash）
  - 优点：纯 Node 可实现（asar 解包用现成 `asar` 包或 electron-builder 自带能力），无原生依赖；补丁体积 ≈ 实际改动（通常 < 2MB vs 全量 90MB）
- 方案 B（备选）：bsdiff 二进制补丁整个 app.asar —— 补丁更小但需原生模块 + 基线 hash 必须严格匹配，容错差。**仅当 A 的补丁体积不可接受时再上**
- `release-one-click.js` 扩展：发版时自动对 oldversion 里的上一版生成补丁 zip + 填 patches 字段 + 提交

**验收**：本地用 1.1.5 安装目录 + 1.1.6 补丁 zip 手动模拟应用，产物与 1.1.6 全量安装的 app 目录逐文件 hash 一致

---

### 块 4b —— 增量更新：客户端应用（需求 3 后半）｜预估 60~100 积分
**触发口令**：「执行块 4b」

**方案**
- `electron/updater/index.ts`：检测到新版本时，若 manifest 有「fromVersion == 当前版本」的补丁 → 走补丁通道；否则回退全量 Setup
- 应用流程（**运行中不能替换自己的 asar**）：
  1. 下载补丁 zip + sha256 校验 + 校验当前 app.asar hash == baseAsarSha256（防基线漂移）
  2. 解压补丁到临时目录，预检所有文件 hash
  3. 弹窗提示「重启完成更新」→ 用户确认后 `app.relaunch()` 前先 spawn 一个独立 helper 进程（小 node 脚本或用 `app.asar` 外置的 update-helper.exe？—— 实现时定为：spawn `process.execPath` 以 `ELECTRON_RUN_AS_NODE=1` 跑内置 helper 脚本）
  4. helper 等主进程退出 → 备份旧 asar → 写新 asar（直接重组？**注意方案 A 是文件级替换，asar 是单文件**：helper 需要把补丁文件写进 asar —— 简化实现：补丁包直接携带**重组好的新 asar**（zip 压缩后体积可控）→ helper 只做「rename 旧 + 落新」两步，最稳）
     - ⚠️ 块 4a 实现时按此修正：补丁 zip 内含完整新 app.asar（deflate 压缩），体积仍远小于 90MB Setup
  5. 任何一步失败 → 自动回退全量 Setup 下载，绝不留半更新状态
- 安装器升级（NSIS 整装）仍保留，作为大版本 / 补丁链断裂时的兜底
- Settings「软件更新」区显示本次更新方式（补丁 X MB / 全量 Y MB）

**验收**
- E2E：装 1.1.6-a（模拟旧）→ 检测到补丁 → 应用 → 重启后版本号与功能 = 1.1.6-b；全程 DB 数据不丢
- 故障注入：补丁 sha256 错 / 基线 hash 不符 → 都回退全量且提示正确

---

## 依赖与推荐顺序

```
块 1（作业同步，最痛点）
  → 块 2（动画 + 主题，可顺带埋输入框诊断）
    → 块 3（等复现日志后修复输入框）
      → 块 4a（补丁协议 + 发版侧）
        → 块 4b（客户端应用补丁）
```

- 块 1、2 无相互依赖，顺序可换；块 4a/4b 必须先后；块 3 的埋点越早越好（复现窗口长）
- **每块结束时**：本地构建 + E2E 通过即可，不推送；全部块完成后用 `npm run release:one` 一次发版

## 额度控制纪律（每块会话的 agent 必读）
1. 摸底已完成（见根因表），**不要重新全量读文件**，按行号定位
2. 每块只 build 一次（`npm run build:exe` 输出自动进 `release-v<版本>/`，勿重复跑）
3. E2E 优先复用 `scripts/e2e-homework-codes-test.js` / `e2e-cloud-source-test.js` 的骨架
4. 禁止 rebase/pull；push 被拒走 plumbing 重建（MEMORY 里有完整套路）
5. 涉及删除走 `robocopy /MIR 空目录` 或 `truncateSync`，别硬刚 safe-delete
