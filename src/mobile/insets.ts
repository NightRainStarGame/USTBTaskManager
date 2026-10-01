/**
 * v1.2.11：把 Android 系统栏/手势条的安全区透传给 CSS。
 *
 * 背景：为了让背景能铺满整屏更好看，MainActivity 打开了 edge-to-edge
 * （WindowCompat.setDecorFitsSystemWindows(window, false)），原生层不再给内容
 * 留位置，改由 Web 层自己避让。于是必须拿到权威的 inset 值。
 *
 * 为什么不直接写 env(safe-area-inset-*)：
 *   Android WebView 对它支持不一致（部分机型恒为 0），一旦为 0，顶栏就被状态栏
 *   压住、悬浮球就被手势条压住 —— 这正是之前「UI 重叠」的来源。这里统一由
 *   InsetsPlugin（WindowInsetsCompat）给值，所有机型表现一致。
 *
 * 桌面端没有该插件 → 全部 0 → 布局与今天分毫不差，零回归风险。
 */
export interface SystemInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: SystemInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/** 与 nativeHttp 同款探测法：零 npm 依赖，插件不在就自动退化。 */
function pickPlugin(): any {
  const g = globalThis as any;
  const p = g.Capacitor?.Plugins?.Insets ?? g.Insets;
  return p && typeof p.get === 'function' ? p : null;
}

let cachedPlugin: any;
export function hasInsetsPlugin(): boolean {
  if (cachedPlugin === undefined) cachedPlugin = pickPlugin();
  return !!cachedPlugin;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** 读取一次原生安全区；取不到（桌面 / 插件缺失 / 异常）一律返回 0。 */
export async function readSystemInsets(): Promise<SystemInsets> {
  if (!hasInsetsPlugin() || !cachedPlugin) return { ...ZERO };
  try {
    const r = await cachedPlugin.get();
    if (!r || typeof r !== 'object') return { ...ZERO };
    return {
      top: num(r.top),
      bottom: num(r.bottom),
      left: num(r.left),
      right: num(r.right),
    };
  } catch (e) {
    console.warn('[mobile] 读取安全区失败，按 0 处理:', e);
    return { ...ZERO };
  }
}

/** 写入 CSS 变量，供 tailwind 的 pt-[var(--sat)] / pb-[var(--sab)] 使用。 */
export async function applySystemInsets(): Promise<SystemInsets> {
  const ins = await readSystemInsets();
  const root = document.documentElement;
  root.style.setProperty('--sat', `${ins.top}px`);
  root.style.setProperty('--sab', `${ins.bottom}px`);
  root.style.setProperty('--sal', `${ins.left}px`);
  root.style.setProperty('--sar', `${ins.right}px`);
  (globalThis as any).__TASKMGR_INSETS__ = ins;
  return ins;
}

/**
 * 安装自动刷新：横竖屏切换、折叠屏展开、分屏、键盘收起后 inset 都会变，
 * 不刷新就会出现「转个屏顶栏又陷进去了」。
 */
export function installSystemInsets(): void {
  void applySystemInsets();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    // 系统等 insets 稳定后再读，提前读会拿到切换过程中的中间值
    timer = setTimeout(() => void applySystemInsets(), 220);
  };

  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  if (typeof window.visualViewport !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', refresh);
  }
}
