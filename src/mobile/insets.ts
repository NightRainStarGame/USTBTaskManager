/**
 * v1.2.11 rev2：把 Android 系统栏/手势条的安全区可靠地送到 CSS。
 *
 * 上一版为什么失败：只在启动时读一次插件。但 `getRootWindowInsets()` 在
 * Activity 刚起来时常常返回 null，于是拿到全 0；之后又没有任何事件会触发刷新
 * （resize / orientationchange 都不发生）→ --sat 永远停在 0 → 抽屉照旧顶到
 * 状态栏底下。真机上表现就是「菜单和状态栏重叠」。
 *
 * 这一版四条路同时走，任何一条通了就行：
 *   1. localStorage 缓存：上次成功的真值先写进去，首帧就不重叠
 *   2. 多轮探测：0/150/400/800/1200/2000ms 反复问插件，拿到非零即停
 *   3. 原生主动推送：InsetsPlugin 监听 OnApplyWindowInsetsListener，
 *      一有变化就 evaluateJavascript 调 window.__TASKMGR_APPLY_INSETS__
 *   4. 兜底经验值：2s 后仍全 0（说明读取链路挂了）就用 28/24dp 顶上，
 *      宁可多留白也不能让按钮被状态栏吃掉；真值到了再自动修正
 *
 * 另外 CSS 侧还有一层 env(safe-area-inset-*) 兜底（见 index.css 的 max()）。
 * 桌面端无插件 → 恒为 0，布局零回归。
 */
export interface SystemInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: SystemInsets = { top: 0, bottom: 0, left: 0, right: 0 };
/** 读取链路彻底挂掉时的经验值：多数 Android 状态栏 24~32dp、手势条 24dp */
const FALLBACK: SystemInsets = { top: 28, bottom: 24, left: 0, right: 0 };
const CACHE_KEY = 'taskmgr.insets.v1';

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

function isUsable(ins: SystemInsets): boolean {
  // 只要有一个方向非零就认为是真值（横屏时顶部可能为 0 但侧边非零）
  return ins.top > 0 || ins.bottom > 0 || ins.left > 0 || ins.right > 0;
}

/** 写进 CSS。注意写的是 --sat-js，--sat 由 CSS 的 max() 合成。 */
function write(ins: SystemInsets): void {
  const root = document.documentElement;
  root.style.setProperty('--sat-js', `${ins.top}px`);
  root.style.setProperty('--sab-js', `${ins.bottom}px`);
  root.style.setProperty('--sal-js', `${ins.left}px`);
  root.style.setProperty('--sar-js', `${ins.right}px`);
  (globalThis as any).__TASKMGR_INSETS__ = ins;
}

function readCache(): SystemInsets | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return null;
    const ins = { top: num(o.top), bottom: num(o.bottom), left: num(o.left), right: num(o.right) };
    return isUsable(ins) ? ins : null;
  } catch {
    return null;
  }
}

function saveCache(ins: SystemInsets): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(ins));
  } catch {
    /* 隐私模式下写不进去也不影响 */
  }
}

/** 询问原生一次；取不到（桌面 / 插件缺失 / 异常）返回 ZERO。 */
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
    console.warn('[mobile] 读取安全区失败:', e);
    return { ...ZERO };
  }
}

let applied = false;

/** 应用一次并缓存；只有拿到更“真”的值才覆盖。 */
async function probeOnce(): Promise<boolean> {
  const ins = await readSystemInsets();
  if (!isUsable(ins)) return false;
  write(ins);
  saveCache(ins);
  applied = true;
  return true;
}

/** 供原生 evaluateJavascript 调用（InsetsPlugin 的 inset 变化推送入口）。 */
function registerNativeHook(): void {
  (globalThis as any).__TASKMGR_APPLY_INSETS__ = (top: number, bottom: number, left: number, right: number) => {
    const ins = { top: num(top), bottom: num(bottom), left: num(left), right: num(right) };
    if (!isUsable(ins)) return;
    write(ins);
    saveCache(ins);
    applied = true;
  };
}

/**
 * 安装安全区：bootstrap 里 await 一次（第一轮同步完成），
 * 后续探测与事件监听在后台继续。
 */
export async function installSystemInsets(): Promise<void> {
  // 1) 缓存先行 —— 第二次启动起首帧就是对的
  const cached = readCache();
  if (cached) write(cached);

  // 2) 原生推送入口（越早注册越好，原生可能在页面任何时刻推）
  registerNativeHook();

  // 3) 第一轮同步探测
  await probeOnce();

  // 4) 后续多轮：起机早期 getRootWindowInsets 常为 null，得多问几次
  const delays = [150, 400, 800, 1200, 2000, 3500];
  delays.forEach((d) => {
    setTimeout(() => {
      if (applied) return;
      void probeOnce();
    }, d);
  });

  // 5) 兜底：3.5s 后仍全是 0，说明读取链路在这台机器上不工作 → 用经验值顶上，
  //    之后任何时候拿到真值（原生推送 / 后续探测）都会自动修正。
  setTimeout(() => {
    if (applied) return;
    if (!hasInsetsPlugin()) return; // 桌面端不需要兜底
    console.warn('[mobile] 安全区读取始终为 0，启用经验值兜底', FALLBACK);
    write(FALLBACK);
  }, 3600);

  // 6) 横竖屏 / 分屏 / 折叠屏 / 键盘：inset 会变，稳定后重读
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void probeOnce(), 220);
  };
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  if (typeof window.visualViewport !== 'undefined' && window.visualViewport) {
    window.visualViewport.addEventListener('resize', refresh);
  }
  // 回到前台时系统栏状态可能已变（如手势/三键切换）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
}
