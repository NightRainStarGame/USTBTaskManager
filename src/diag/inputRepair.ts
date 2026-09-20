/**
 * v1.1.7 输入点击兜底修复（input repair）
 *
 * 症状：输入框偶尔「点不上」——鼠标点进去了，焦点却没落在输入框上
 *（activeElement 停在 body / 别的元素），继续点击也无效，像整个输入区被冻住。
 *
 * 已知诱因（本机环境）：150% 缩放 + GPU 负载波动时 Chromium 命中测试/焦点
 * 转移偶发丢失；backdrop-blur 层叠时点击穿透焦点偶发不生效。
 * 本模块不猜唯一根因，做**兜底修复**：
 *
 *  1) pointerdown 在可编辑元素上时记下目标；
 *  2) 400ms 后复查：目标还在文档里、焦点没落在任何地方（activeElement 是 body）
 *     → 强制 focus() 补救；
 *  3) 窗口重新获得焦点（alt-tab 回来）时若还有未消化的 pending → 同样补焦；
 *  4) 每次补救记入 ring buffer（window.__inputRepairs，最近 20 条），供诊断。
 */

interface RepairRecord {
  ms: number;
  tag: string;
  id?: string;
  name?: string;
  cls?: string;
  where: 'click' | 'window-focus';
}

const CHECK_DELAY_MS = 400;

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable;
}

function describeEl(el: HTMLElement): Pick<RepairRecord, 'tag' | 'id' | 'name' | 'cls'> {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    name: (el as HTMLInputElement).name || undefined,
    cls: typeof el.className === 'string' ? el.className.slice(0, 60) : undefined,
  };
}

export function installInputRepair(): () => void {
  const repairs: RepairRecord[] = [];
  (window as any).__inputRepairs = repairs;

  let pending: { el: HTMLElement; via: 'click' | 'window-focus' } | null = null;

  const tryRepair = () => {
    const item = pending;
    pending = null;
    if (!item) return;
    const { el, via } = item;
    // 元素已被 React 重挂载/移除 → 无从修复
    if (!el.isConnected) return;
    if (document.activeElement === el) return; // 焦点正常，不用修
    // 用户已经把焦点点去了别处 → 不抢
    if (document.activeElement && document.activeElement !== document.body) return;
    try {
      el.focus({ preventScroll: true });
      const rec: RepairRecord = { ms: Date.now(), where: via, ...describeEl(el) };
      repairs.push(rec);
      if (repairs.length > 20) repairs.shift();
      console.warn('[input-repair] 焦点未落在输入框，已强制补焦:', rec);
    } catch { /* ignore */ }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!isEditable(e.target)) return;
    pending = { el: e.target, via: 'click' };
    setTimeout(tryRepair, CHECK_DELAY_MS);
  };

  const onWindowFocus = () => {
    if (pending) {
      const via = pending.via === 'click' ? 'click' : 'window-focus';
      setTimeout(() => { if (pending) { pending.via = via; tryRepair(); } }, CHECK_DELAY_MS);
    }
  };

  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('focus', onWindowFocus, true);

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
    window.removeEventListener('focus', onWindowFocus, true);
    delete (window as any).__inputRepairs;
  };
}
