# v1.2.1 画布编辑器（达芬奇式节点连线）

发布日期：2026-09-21

## 🌟 新增功能

### 画布编辑器（Canvas Editor）

> Projects 页右上角「画布视图」入口，或直接路由 `/editor`

- **7 种节点**：任务 / 课程 / 作业 / 日程 / 便签 / 分组 / 自定义
- **4 种连线**：顺序（实线）、依赖（虚线）、关联（双线）、关键（发光红）
- **关联实体**：任务节点绑定到项目任务；课程 / 作业 / 日程节点绑定到业务表
- **跳转集成**：节点右上角 ⎋ 图标 → 一键跳转到 Courses / Calendar / Projects
- **撤销 / 重做**（Ctrl+Z / Ctrl+Y），栈深 50，同步落库
- **导入 / 导出**：JSON 格式，含 schema 版本校验
- **循环依赖检测**：DFS 三色标记，环路径可视化提示
- **节点拖拽节流**：松手批量落库（避免每帧 IPC）
- **自动保存**：所有变更立即持久化

### 樱花粉主题 v4 精修

- 5 + 1 个渐变（card / button / button-hover / title / status / divider）
- 液态玻璃面板（backdrop-filter blur + saturate + 高光 inset + 外阴影）
- 三主题（starry / neon-green / sakura）锚点色统一，强白对比度

---

## 🐛 已知遗留

- 增量更新协议对画布数据无影响（data 仍为用户级 JSON）；后续若需跨设备同步，再单独设计版本合并策略
- 输入框偶发失灵需重启（IME/composition 相关，沿用 `src/diag/inputRepair.ts`，v1.1.6 起埋点）

---

## 📦 升级说明

无破坏性变更。自动增量更新支持 1.2.0 → 1.2.1 补丁包。

数据库迁移：v1.2.0 → v1.2.1 自动应用 `canvases` / `canvas_nodes` / `canvas_edges` 三张表（无感知）。