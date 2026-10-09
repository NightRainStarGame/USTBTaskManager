/**
 * 退出意图的单一真相源（v1.2.17 新增）。
 *
 * `app.exit(0)` **不会触发** `before-quit` / `will-quit`（Electron 文档明确写了：
 * "the before-quit and will-quit events will not be emitted"）。而 main.ts 的关窗
 * 拦截器是靠 `isQuitting` 标志放行的：
 *
 *     mainWindow.on('close') → if (isQuitting) return;  否则 preventDefault + 弹框/最小化
 *
 * 于是补丁更新那条路径（updater/index.ts 的 `setTimeout(() => app.exit(0), 600)`）
 * 退出时 `isQuitting` 永远是 false → 关窗拦截器照常生效：
 *   · 关闭行为 =「最小化到托盘」→ 应用根本不走，静默变成后台运行，补丁不生效；
 *   · 默认「每次询问」→ 弹模态框问「最小化还是退出」，用户看到的就是「没反应」。
 * 这正是「增量更新退出后就没反应」的根因。
 *
 * 修法：凡是要**强制**退出的地方（补丁应用 / 整包更新 / sidecar 接管）先调
 * `markApplyingUpdate()`，由本模块统一持有标志，main.ts 的 close 拦截器读同一份 ——
 * 不再依赖某个生命周期事件「恰好会来」。
 */
let quitting = false;

/** 补丁 / 整包更新正在退出流程中：关窗拦截器必须无条件放行 */
let applyingUpdate = false;

export function isQuitting(): boolean {
  return quitting;
}

export function markQuitting(): void {
  quitting = true;
}

/** 补丁更新专用：既标记退出也标记「正在更新」，让关窗逻辑与启动日志都能识别 */
export function markApplyingUpdate(): void {
  applyingUpdate = true;
  quitting = true;
}

export function isApplyingUpdate(): boolean {
  return applyingUpdate;
}

