# v1.2.8 — 全面 Bug 修复 + 模块化重构

> 一句话：**v1.2.8 把 1.2.7 之后积攒的隐患全部修掉，并把几个核心模块拆好（动画/滚轮/自动合并/规范）**。

---

## 🐛 关键 Bug 修复

### Pomodoro 番茄钟
- **C-1 修复 finishPhase 双触发**：React 18 strict mode 下 setInterval 跑两次导致计时快1倍、落库双倍统计；现在用 `finishedThisTickRef` 守卫 + setTimeout cleanup
- **H-1 修复 FAB 拖出屏**：拖动不再累加到 view 之外（viewport clamp）
- **H-2 修复 todayMinutes 重复加载**：依赖只挂 `[open]`，phase 切换不重置 setInterval
- **H-3 修复 setTimeout 泄漏**：finishPhase 的 pending callback 会被组件卸载清理

### 主进程 / 更新通道
- **H-4 修复 splash setTimeout 链不可中断**：fadeStep 现在持有 timer id，destroy 前清理；hideSplashAndShowMain 重入安全
- **H-5 清理 @ts-ignore**：patchApply.ts 改用 `(res.body as unknown as ReadableStream).getReader()` 类型守卫
- **H-9 ipcSafe 包装器**：5 个 `ipcMain.handle` 之前直接强转 `db as DB`，db 为 null 时 NPE → 渲染进程 IPC 永久 pending；现在统一包一层 `ipcSafe(fn)`，异常返回 `{ok:false,error}` + 写 `taskmanager-ipc-error.log`

### 其他
- 增量补丁重启不生效（块 I，1.2.7 → 1.2.8 必装）
- 100MB 安装包风险预案（GitHub Releases 主源 + jsDelivr 备援）

---

## 🆕 新功能

### 番茄钟（Pomodoro）滚轮调时间
- 鼠标悬浮在 mm/ss 上，**滚轮上下滑动**就能调整时间
  - mm：±1 分钟，范围 1~120
  - ss：±5 秒（步长 5），范围 0~55
- 键鼠双控：键盘 ↑/↓/Home/End 也能调
- 仅 idle 阶段可调（work/break 锁定避免误改）
- 改动自动持久化到 settings.pomodoro_work
- 数字 bounce 动画 + ↑↗/↓↘ 浮标反馈

### 班级 P2P 增强（块 O）
- **30s 后台轮询**：所有未解散班级自动 sync（教室下课前常常实时发布作业，及时同步比手动点 sync 体验好）
- **自动合并**：远端修改能传到本地（之前 sync 只 INSERT 新的，已存在的即使云端改了也不更新本地）
  - 例外：本地 `is_read` / `status` 永远以本地为准（不被云端覆盖）
- **图片附件**：班级公告 / 作业发布支持附加图片 URL（最多 9 张，API 已就位）
- **admin promote**：owner 可调整成员角色（admin / member），API 已就位，UI 留作 v1.2.9

---

## 🎨 动画 / UI 升级（块 P）

不引入 framer-motion（避免 50KB 依赖），统一 CSS / Tailwind 工具类：

- **panel-spring**：面板展开 `cubic-bezier(0.22, 1, 0.36, 1)` 240ms
- **digit-bounce**：调整数字时 220ms scale + translateY 回弹
- **ease-spring**：FAB transition timing-function 统一
- **progress ring**：stroke-dashoffset 1s linear → 800ms cubic-bezier
- **FAB 拖动**：拖动时禁用 transition，松手 200ms 回弹

---

## 🏗️ 架构重构（块 K / L / N）

### 模块化拆分
- **Pomodoro**（src/features/pomodoro/）：332 行 → 10 文件
  - types / useDragPosition（通用）/ usePomodoro（reducer）/ TimerRing / TimeDigits / TaskPicker / PomodoroPanel / PomodoroFab / PomodoroWidget / index
  - 抽出来的 `useDragPosition` 可复用于 PatchPanel / PlusMenu 等可拖动浮窗
- **Courses**（src/pages/Courses/）：1397 行 → 13 文件
  - TimetableView（独立可复用）/ CourseDrawer / 各 Tab / 通用 Field / 常量
- **browserApi**（src/mocks/browserApi/）：781 行 → 6 文件（共享 data 容器 + 5 个 db domain 拆）
- **src/mocks/classMock.ts**（块 L）：班级 mock 独立

### 规范化
- 全局 Toast 系统（13 处 console.error → toast）
- `useLocalStorage` 通用 hook（跨标签页同步 + SSR 安全 + 自动 try/catch）
- `useReducer` 替代 Pomodoro `useState × 9`
- magic number 全部提取到 `constants.ts` / `types.ts`

### 向后兼容
- `src/components/Pomodoro.tsx` / `src/pages/Courses.tsx` 变成 re-export 壳，import 路径零迁移

---

## 📊 改动量

| 维度 | 数据 |
|---|---|
| 新增 commit | 12 |
| 新增文件 | 33（features/pomodoro + pages/Courses + mocks/browserApi） |
| 移除行数 | ~1700（Pomodoro 旧版 + Courses 旧版 + browserApi 旧版） |
| 新增行数 | ~2400 |
| Bug 修复 | 11（C-1 / H-1~9 / 块 I） |
| 体验升级 | 5（滚轮 / 自动合并 / 后台轮询 / 动画 / admin） |

---

## ⚠️ 升级注意

- **从 1.2.7 升级必装**：块 I 修复增量补丁重启不生效
- **DB 路径无变化**：`%APPDATA%\task-manager\task-manager.db` 直接迁移
- **设置项无变化**：pomodoro_work / pomodoro_break 在 Settings 主题里仍可手动改

---

## 🔮 v1.2.9 路线（未做项）

- admin 角色 UI（API 已就位）
- 班级图片附件 UI（API 已就位）
- store 拆 slice（settingsSlice / dataSlice / uiSlice + `useShallow` 优化）
- 班主任禁言 / 退出班级 等班级治理 UI