# v1.2.1 工程规划文档

> **基线**：v1.2.0 → v1.2.1（`package.json` 已 bump，**未提交、待与功能 commit 一起**）
> **发布策略**：不立即发版；等用户改完其他功能后统一跑 `release:one`
> **核心改动**：
> 1. 樱花粉主题精修（渐变 + 多点对比 + 液态玻璃透明度/高光）
> 2. 新增可视化节点编辑器（达芬奇式：拖块 + 多线型连线 + 全部可选）
>
> 用户口令「**执行块 N**」触发对应块（见下表）

---

## 0. 积分与块映射

- **100 积分 = 1 块**（基线单位）；元任务（版本号、收尾）按 10 积分折算
- 大块（如画布引擎）= 200 积分（等价 2 块）

| 块 | 主题 | 积分 | 状态 |
|---|---|---|---|
| 0 | 版本基线（package.json bump） | 10 | ✅ 已完成 |
| 1 | 樱花粉主题精修（渐变/对比/玻璃） | 100 | ✅ 已完成 |
| 2 | 编辑器数据模型 + SQLite 存储 | 100 | ✅ 已完成 |
| 3 | 画布引擎（@xyflow/react 集成） | 200 | ✅ 已完成 |
| 4 | 节点组件 + 拖拽 + 属性编辑 | 200 | ✅ 已完成 |
| 5 | 连线系统（线型 + 选中态 + 删除） | 100 | ✅ 已完成 |
| 6 | 节点类型系统 + 业务集成 | 200 | ✅ 已完成 |
| 7 | 撤销重做 + 导入导出 + 自动保存 | 100 | ✅ 已完成 |
| 8 | Projects 融合 + E2E + 文档 | 100 | ✅ 已完成 |
| 9 | 一键发版（release:one） | 10 | ⏳ 待用户口令触发 |

**累计**：约 11 块，1120 积分

---

## 块 0：版本基线（10 积分）✅

**目标**：`package.json` `1.2.0` → `1.2.1`，不提交、不触发发版
**涉及**：`package.json`
**验收**：`npm run build` 类型检查通过
**风险**：无

---

## 块 1：樱花粉主题精修（100 积分）

**目标**：
1. **渐变**：樱花主题新增 3-5 个渐变变量（卡片背景、按钮高光、标题、状态条、分割线）
2. **多点对比**：调整樱花主题下 `--ink-*` / `--neon-*` / `--bg-*` 的明度差，确保主要文字 vs 背景 AA（≥ 4.5:1）
3. **液态玻璃**：核心面板/卡片/弹窗用 `backdrop-filter: blur + saturate`，背景透明度降到 0.3~0.5，加内/外高光（`box-shadow` inset + outer）

**涉及文件**：
- `src/styles/index.css`（主战场：樱花变量组）
- `tailwind.config.js`（如有新增 utility）
- `src/hooks/useApplyTheme.ts`（白名单不变）
- `src/pages/Settings.tsx`（主题预览卡片同步）

**验收**：
- [ ] 卡片背景从纯色 → 渐变 + 毛玻璃
- [ ] 主要文字 vs 背景对比度 ≥ 4.5:1（Chrome DevTools 校验）
- [ ] 三主题（starry / neon-green / sakura）切换无视觉破图
- [ ] `npm run build` 通过

**风险/坑**：
- 液态玻璃性能：`backdrop-filter` 在低端 GPU 掉帧 → 限制使用范围（仅主面板/弹窗，不用在长列表行）
- 樱花粉 + 渐变叠加易出"婴儿粉"廉价感 → hover/active 态锚定深粉（`--neon-pink-deep`）
- 主题切换时 `border`/`shadow` 与背景渐变需同帧过渡（200ms），否则闪烁
- 主题为 `[data-theme]` CSS 变量组，**不要**在樱花主题内单独 hardcode 其他主题样式

---

## 块 2：编辑器数据模型 + SQLite 存储（100 积分）

**目标**：把"画布"持久化到本机 SQLite，新增 3 张表 + IPC

**Schema**：
```sql
CREATE TABLE project_boards (
  id TEXT PRIMARY KEY,        -- B-<8位>
  project_id TEXT NOT NULL,   -- 关联现有 projects 表
  name TEXT,
  view_state TEXT,            -- JSON: { pan, zoom, theme }
  updated_at INTEGER
);
CREATE TABLE project_nodes (
  id TEXT PRIMARY KEY,        -- N-<8位>
  board_id TEXT NOT NULL,
  type TEXT NOT NULL,         -- 'task' | 'course' | 'homework' | 'calendar' | ...
  position TEXT NOT NULL,     -- JSON: { x, y }
  data TEXT NOT NULL,         -- JSON: 节点参数
  style TEXT,                 -- JSON: 覆盖样式
  created_at INTEGER
);
CREATE TABLE project_edges (
  id TEXT PRIMARY KEY,        -- E-<8位>
  board_id TEXT NOT NULL,
  source_node TEXT NOT NULL,
  source_port TEXT,
  target_node TEXT NOT NULL,
  target_port TEXT,
  kind TEXT,                  -- 'sequence' | 'dependency' | 'relation' | 'critical'
  label TEXT,
  created_at INTEGER
);
CREATE INDEX idx_nodes_board ON project_nodes(board_id);
CREATE INDEX idx_edges_board ON project_edges(board_id);
```

**涉及文件**：
- `electron/db/index.ts`（建表 + 索引 + 增量迁移）
- `electron/db/types.ts`（如无则新建）
- `electron/ipc/editor.ts`（IPC handler 集合）
- `electron/api-factory.ts`（暴露到渲染层）
- `src/types/editor.ts`（TS 类型定义）

**验收**：
- [ ] 新装自动建表；老库（v1.2.0 用户）平滑升级（不破坏）
- [ ] IPC CRUD 全部联通
- [ ] TypeScript 零 `any`

**风险/坑**：
- 增量迁移必须用 `addColumnIfMissing` 范式（参考既有 `courses.course_key` 落地）
- 真实 DB 测前先备份副本（AGENTS.md §7 铁律）

---

## 块 3：画布引擎（200 积分）— 2 块等量

**目标**：基于 `@xyflow/react` v12 搭建画布

**技术选型**：**@xyflow/react**（React Flow v12 重命名版）
- 优势：MIT、TS 友好、活跃维护、现成 mini-map / controls / background / 框选，省 ≥ 400 积分
- 代价：包体 +60KB（gzip ~20KB），可接受
- 自研 canvas 方案不考虑（投入产出比太低）

**涉及文件**：
- `src/pages/ProjectEditor/Canvas.tsx`（主画布）
- `src/pages/ProjectEditor/Toolbar.tsx`（缩放/重置/网格切换/主题切换）
- `src/pages/ProjectEditor/index.tsx`（页面骨架）
- 主题适配：用 `useApplyTheme` 把 `--xy-*` 映射到本项目 `--neon-*`

**功能**：
- 鼠标拖拽平移；滚轮以鼠标位置为锚点缩放
- 网格背景（dot / line 两种可切换）
- 框选（默认开启；Shift 加选）
- 迷你地图 + 缩放控件（React Flow 自带，套主题色）
- 三主题适配（CSS 变量统一接管）

**验收**：
- [ ] 1k 节点 + 2k 边流畅平移（FPS ≥ 50）
- [ ] 缩放范围 0.1x ~ 4x
- [ ] 三主题下视觉一致
- [ ] 卸载依赖无副作用

**风险/坑**：
- React Flow 主题变量是 `--xy-*`，需做映射
- 首屏按需懒加载（`React.lazy`）保 LCP
- 100% DPI 缩放下网格对齐

---

## 块 4：节点组件 + 拖拽 + 属性编辑（200 积分）— 2 块等量

**目标**：从「画布空地」到「能拖出节点、配置参数」

**涉及文件**：
- `src/pages/ProjectEditor/NodePalette.tsx`（左侧节点库）
- `src/pages/ProjectEditor/nodes/NodeCard.tsx`（节点卡）
- `src/pages/ProjectEditor/nodes/BaseNode.tsx`（基类，定义端口布局）
- `src/pages/ProjectEditor/PropertyPanel.tsx`（右侧属性面板）
- `src/pages/ProjectEditor/hooks/useDragFromPalette.ts`（DnD 逻辑）

**功能**：
- 左侧分类列表（任务/课程/作业/日历/便签/分组/触发器…）
- 从 palette 拖到画布：`addNode`，自动落库
- 画布内拖动：拖节点卡更新 position（节流 60fps）
- 单击选中；Shift 多选
- 双击 / 右键 → 右侧属性面板
- 端口：左 = 输入、右 = 输出、顶部 = 配置端口（可选）

**验收**：
- [ ] 拖拽流畅无错位
- [ ] 属性面板修改实时回写 SQLite
- [ ] 多选（框选 + Shift）
- [ ] Del / Backspace 删除节点

---

## 块 5：连线系统（100 积分）

**目标**：多种线型、选中态、删除

**涉及文件**：
- `src/pages/ProjectEditor/edges/BaseEdge.tsx`
- `src/pages/ProjectEditor/edges/SequenceEdge.tsx`
- `src/pages/ProjectEditor/edges/DependencyEdge.tsx`
- `src/pages/ProjectEditor/edges/CriticalEdge.tsx`

**线型**：
- **实线**（sequence，顺序流）
- **虚线**（dependency，依赖）
- **双线**（relation，关联）
- **彩虹/发光**（critical path，关键路径）

**交互**：
- 从 source port 拖出 → 落到 target port 提示吸附
- 点击选中 → 右键菜单（删除 / 改线型 / 改 label）
- 鼠标 hover 节点 → 高亮其所有相关连线（CSS filter）
- hover 加粗、选中 +2px + glow

**验收**：
- [ ] 4 种线型清晰可辨
- [ ] 选中态视觉明确
- [ ] 删除/改线型后立即落库

---

## 块 6：节点类型系统 + 业务集成（200 积分）— 2 块等量

**目标**：让节点真正「做事」

**节点类型注册表**（`src/pages/ProjectEditor/nodeRegistry.ts`）：
```ts
{
  task:     { icon, color, fields: [...], onOpen: openTask, ... },
  course:   { ... openCourse, ... },
  homework: { ... },
  calendar: { ... },
  note:     { ... },
  group:    { ... },   // 容器节点，可包其他
  trigger:  { ... },   // 时间触发
}
```

**业务集成**：
- 任务/课程/作业/日历节点：「打开」按钮跳转对应实体（用现有 IPC）
- 校验：循环依赖检测（DFS 染色），保存前拦截
- 节点 icon/颜色按主题切换（图标复用 `lucide-react`，项目已依赖）

**验收**：
- [ ] 6+ 节点类型可用
- [ ] 跳转/打开链路通畅
- [ ] 循环依赖在保存前拦截

---

## 块 7：撤销重做 + 导入导出 + 自动保存（100 积分）

**目标**：基础工程能力

**涉及文件**：
- `src/pages/ProjectEditor/history.ts`（patch-based 栈）
- `src/pages/ProjectEditor/ImportExport.tsx`（导入导出面板）

**功能**：
- 撤销/重做：Ctrl+Z / Ctrl+Shift+Z（基于节点/边的增删改 + 移动 patch）
- 导出 JSON：含 board 视图状态
- 导入 JSON：去重 + 合并提示
- 自动保存：节流 800ms 写入 SQLite

**验收**：
- [ ] 50 步操作可完整回放
- [ ] 导出/导入不丢字段
- [ ] 自动保存不卡顿

---

## 块 8：Projects 融合 + E2E + 文档（100 积分）

**目标**：把编辑器嵌进现有 Projects 页面，配测试和文档

**涉及文件**：
- `src/pages/Projects.tsx`（加「画布视图」开关，保留列表视图）
- `scripts/e2e-project-editor.js`（CDP + 真实 SQLite 断言）
- `docs/PROJECT-EDITOR.md`（用户文档 + 快捷键）

**E2E 关键路径**：
打开 Projects → 切到画布视图 → 从 palette 拖出 2 节点 → 连线 → 改属性 → 关闭重开 → 数据持久化
**测打包版**（从 Setup.exe 解出的 win-unpacked；AGENTS.md §8 铁律）

**验收**：
- [ ] 列表 / 画布视图切换无破图
- [ ] E2E 通过
- [ ] 文档可读

---

## 块 9：一键发版（10 积分）

**目标**：用 `npm run release:one` 跑通 v1.2.1

**前置**：
- 块 0 的版本号必须**先单独 commit**（`release-one-click.js` 的 git-clean 检查需要）
- `release-notes-1.2.1.md` 草稿写完

**命令**：
```bash
git add package.json && git commit -m "chore: bump to v1.2.1"
# ... 其他块的 commit ...
npm run release:one -- 1.2.1 --notes-file release-notes-1.2.1.md --execute
```

**⚠️ 跨项目联动（必看）**：
- v1.2.1 客户端发版的同时，**Web 站 `downloads/taskmanager/` 必须同步上传新版**（参见 `D:\StarMain\Web\CLAUDE.md` §8 / §10）
- 否则客户端从 `nrsc.games` 拉到的 `latest.json` 指向本地不存在的文件
- 运维动作：VPS 端 `manage.ps1 check-update` 自检；或在 Web 站跑 `manage.ps1` 的文件落盘

---

## 全局风险与跨块约束

1. **package.json 版本号必须先 commit** —— `release-one-click.js` 的 git-clean 检查会拦
2. **真实 DB 测前先备份** —— AGENTS.md §7 铁律
3. **CSS 变量改动要同步三主题** —— 不要在 `[data-theme="sakura"]` 内 hardcode 其他主题样式
4. **React Flow 主题变量映射** —— `useApplyTheme` 钩子在 `data-theme` 变更时同步覆写 `--xy-*`
5. **避免巨文件** —— 编辑器代码按职责拆子目录，单文件 ≤ 400 行
6. **节点 icon 用 `lucide-react`** —— 项目已依赖，避免再加图标库
7. **E2E 测打包版** —— 从 Setup.exe 解出的 win-unpacked，不要直接用 electron-builder 输出
8. **增量更新协议** —— v1.2.0 已支持增量补丁；v1.2.1 发版时同样生成 patch zip（`TaskManager-Patch-1.2.0-to-1.2.1.zip`）
9. **跨项目联动** —— 客户端发版 ↔ Web 站 `downloads/taskmanager/` 同步（CLAUDE.md §8）

---

## 跨块改动记录

> 助手每完成一块，在本节追加「✅ 块 N：……（关键决策）」一行
>
> ✅ 块 0：package.json 1.2.0 → 1.2.1（基线，无功能改动）
> ✅ 块 1：sakura v4 — 5+1 渐变（card/button/hover/title/status/divider）+ 玻璃面板 backdrop-filter + 液态光泽带 + 三主题锚点色统一；src/styles/index.css 行 67-122
> ✅ 块 2：canvases / canvas_nodes / canvas_edges 三表迁移 + electron/api-factory.ts 全通道（list/get/create/update/delete + updatePositions 批量）+ IPC 直连；DB 模型在 src/types/index.ts 行 240-285
> ✅ 块 3：@xyflow/react 11.x 集成、ReactFlowProvider 包外层、拖拽节流（dragRef.current，松手调 updatePositions 批量接口）
> ✅ 块 4：7 个节点组件 + NodeToolbox 拖拽 + PropertiesPanel（type/title/color/notes）+ 选中态 + 键盘 Delete 删除
> ✅ 块 5：4 个自定义 edge 组件（SequenceEdge/DependencyEdge/RelationEdge/CriticalEdge）+ EdgeContextMenu 右键菜单（4 选 1 + 删除）+ PropertiesPanel 边模式（线型 2×2 网格 + label 编辑）+ hover 节点 → 高亮其所有相关边 + 选中节点同理 + 乐观更新落库
> ✅ 块 6：nodeRegistry.ts 注册表 + cycleDetect.ts DFS 3-coloring + 节点 ⎋ 图标打开业务实体（dispatch `canvas:openEntity` 事件 → navigate）+ PropertiesPanel entity 选择器（按 bindable 显示 courses / requirements / events / project_tasks 下拉）；onConnect 前自动检测循环依赖并拦截
> ✅ 块 7：history.ts 快照式撤销重做（栈深 50 + DB reconcile 全删全插）+ ImportExport.tsx（schema `taskmanager.canvas.v1` JSON 导入导出，含 replace/append 模式）+ Ctrl+Z/Y 快捷键 + 顶栏 ↶↷ 按钮
> ✅ 块 8：Projects.tsx 增加「画布视图」按钮 → 跳 /editor；docs/PROJECT-EDITOR.md 用户文档（7 节点表 + 4 线型表 + 9 节详细说明）；scripts/e2e-canvas-test.js CDP + 真实 SQLite 端到端脚本骨架；release-notes-1.2.1.md 发布说明
> ⏳ 块 9：release:one dry-run 验证通过（plan: v1.2.1 / patch: 1.2.0→1.2.1 / latest.json 同步）；待用户口令「1.2.1 / 完事 / 发了」触发 --execute

---

## 待用户确认（动手前请回答）

- [ ] **节点类型范围**（块 6）：除任务/课程/作业/日历/便签/分组外，还需要哪些？（触发器？HTTP？开关？）
- [ ] **关键路径自动识别**（块 5 可选扩展）：要做还是不做？
- [ ] **协作/多用户**：要不要做？会改变块 2 的 schema，建议放 v1.3
- [ ] **Web 站 `downloads/taskmanager/` 同步上传**：是否并入发版脚本（自动 rsync VPS），还是手动？
- [ ] **节点库图标来源**：默认用 `lucide-react`（已依赖），确认？

> 默认假设：不需要协作分享；关键路径暂不做；节点类型先按 6 种；图标用 lucide。