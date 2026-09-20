/**
 * v1.1.6 输入诊断 — 渲染层探测器（块 3）
 *
 * 装上后：
 * - 在 window 上挂 keydown / composition* / focus / blur / visibilitychange 全局监听
 * - 维护一个 ring buffer（FIFO，容量 50）记录最近键盘 + IME + 焦点事件
 * - 周期巡检：当前活动元素是 input/textarea/contenteditable 且焦点在其中，
 *   但过去 8 秒没有 keydown 也没有 compositionend → 触发「失灵快照」
 * - 快照打完之后 60 秒冷却（同样的失灵不被重复记录）
 * - 浏览器（非 Electron）环境下 IPC 不存在，自动降级：打 console.warn 即可
 */
export interface InputDiagSnapshot {
  reason: 'input_focus_no_keydown' | 'input_focus_no_composition_end';
  focusedTag: string;
  focusedType?: string;
  focusedName?: string;
  focusedId?: string;
  focusedClass?: string;
  focusedValueLength: number;
  focusedValuePreview: string;
  focusedSelectionStart: number;
  focusedSelectionEnd: number;
  isContentEditable: boolean;
  /** 自启动以来的「失灵特征计数」（同一会话） */
  stallCount: number;
  /** 自上一次 keydown 距今的毫秒数 */
  msSinceLastKeydown: number;
  /** 自上一次 compositionend 距今的毫秒数 */
  msSinceLastCompositionEnd: number;
  /** 当前 document.activeElement 路径简写 */
  activeElementPath: string;
  /** 最近 50 条事件（FIFO），按发生顺序 */
  recent: Array<EventRecord>;
  /** 当前 composition 状态相关 */
  pendingComposition?: { dataLen: number; compositionStartAt: number } | null;
  /** 渲染层版本号 */
  appVersion: string;
  /** Electron 版本（无则 NA） */
  electronVersion: string;
  ua: string;
}

export type EventRecord =
  | { t: 'keydown'; ms: number; key: string; code: string; target: string; composed: boolean }
  | { t: 'compositionstart'; ms: number; dataLen: number; target: string }
  | { t: 'compositionupdate'; ms: number; dataLen: number; target: string }
  | { t: 'compositionend'; ms: number; dataLen: number; target: string }
  | { t: 'focus'; ms: number; target: string }
  | { t: 'blur'; ms: number; target: string; to: string }
  | { t: 'visibilitychange'; ms: number; hidden: boolean };

const BUFFER_SIZE = 50;
const STALL_MS = 8000;          // 8 秒无键盘事件视为失灵候选
const POLL_MS = 2000;           // 每 2 秒巡检一次（不打扰；焦点变化时不等巡检）
const COOLDOWN_MS = 60_000;     // 上报一次后冷却 60 秒
const MAX_VALUE_PREVIEW = 80;

function nowMs(): number {
  return Date.now();
}

function elToPath(el: Element | null): string {
  if (!el) return 'null';
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 6) {
    const tag = cur.tagName ? cur.tagName.toLowerCase() : '?';
    const id = (cur as HTMLElement).id ? `#${(cur as HTMLElement).id}` : '';
    const cls = (cur as HTMLElement).className && typeof (cur as HTMLElement).className === 'string'
      ? `.${(cur as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    parts.unshift(`${tag}${id}${cls}`);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join('>');
}

function describeFocused(): {
  tag: string; type?: string; name?: string; id?: string; class?: string;
  valueLength: number; valuePreview: string;
  selectionStart: number; selectionEnd: number;
  isContentEditable: boolean;
  path: string;
} {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return { tag: 'none', valueLength: 0, valuePreview: '', selectionStart: 0, selectionEnd: 0, isContentEditable: false, path: 'null' };
  const tag = el.tagName.toLowerCase();
  const isCE = el.isContentEditable;
  let valueLen = 0;
  let valuePreview = '';
  let sStart = 0;
  let sEnd = 0;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const v = el.value || '';
    valueLen = v.length;
    valuePreview = v.slice(0, MAX_VALUE_PREVIEW);
    try { sStart = el.selectionStart ?? 0; sEnd = el.selectionEnd ?? 0; } catch { /* ignore */ }
  } else if (isCE) {
    const txt = el.textContent || '';
    valueLen = txt.length;
    valuePreview = txt.slice(0, MAX_VALUE_PREVIEW);
  }
  return {
    tag,
    type: (el as HTMLInputElement).type,
    name: (el as HTMLInputElement).name,
    id: el.id || undefined,
    class: typeof el.className === 'string' ? el.className.trim().slice(0, 60) : undefined,
    valueLength: valueLen,
    valuePreview,
    selectionStart: sStart,
    selectionEnd: sEnd,
    isContentEditable: isCE,
    path: elToPath(el),
  };
}

export interface InputDiagOptions {
  /** 不想探测的容器 CSS 选择器（命中容器内部时停止巡检） */
  ignoreInside?: string;
}

export interface InputDiagHandle {
  /** 卸载监听 + 停轮询 */
  stop: () => void;
  /** 当前快照（人工触发上报用，不限于 8s） */
  snapshot: (reason?: InputDiagSnapshot['reason']) => InputDiagSnapshot;
  /** 强制上报一次（调试用） */
  flush: () => void;
  /** 暴露原始 events 列表（调试） */
  getBuffer: () => EventRecord[];
}

interface InternalState {
  buffer: EventRecord[];
  lastKeydownMs: number;
  lastCompositionEndMs: number;
  pendingComposition: { dataLen: number; compositionStartAt: number } | null;
  stallCount: number;
  lastReportAt: number;
}

export function installInputDiag(opts: InputDiagOptions = {}): InputDiagHandle {
  const state: InternalState = {
    buffer: [],
    lastKeydownMs: nowMs(),
    lastCompositionEndMs: nowMs(),
    pendingComposition: null,
    stallCount: 0,
    lastReportAt: 0,
  };

  const pushEvent = (e: EventRecord) => {
    state.buffer.push(e);
    if (state.buffer.length > BUFFER_SIZE) state.buffer.shift();
  };

  const onKeydown = (e: KeyboardEvent) => {
    state.lastKeydownMs = nowMs();
    pushEvent({
      t: 'keydown',
      ms: state.lastKeydownMs,
      key: (e.key || '').slice(0, 32),
      code: e.code || '',
      target: elToPath(e.target as Element | null),
      composed: !!e.isComposing,
    });
  };
  const onCompositionStart = (e: CompositionEvent) => {
    state.pendingComposition = { dataLen: (e.data || '').length, compositionStartAt: nowMs() };
    pushEvent({ t: 'compositionstart', ms: nowMs(), dataLen: (e.data || '').length, target: elToPath(e.target as Element | null) });
  };
  const onCompositionUpdate = (e: CompositionEvent) => {
    if (state.pendingComposition) state.pendingComposition.dataLen = (e.data || '').length;
    pushEvent({ t: 'compositionupdate', ms: nowMs(), dataLen: (e.data || '').length, target: elToPath(e.target as Element | null) });
  };
  const onCompositionEnd = (e: CompositionEvent) => {
    state.lastCompositionEndMs = nowMs();
    state.pendingComposition = null;
    pushEvent({ t: 'compositionend', ms: nowMs(), dataLen: (e.data || '').length, target: elToPath(e.target as Element | null) });
  };
  const onFocus = (e: FocusEvent) => {
    pushEvent({ t: 'focus', ms: nowMs(), target: elToPath(e.target as Element | null) });
  };
  const onBlur = (e: FocusEvent) => {
    pushEvent({
      t: 'blur',
      ms: nowMs(),
      target: elToPath(e.target as Element | null),
      to: elToPath(e.relatedTarget as Element | null),
    });
  };
  const onVisibility = () => { pushEvent({ t: 'visibilitychange', ms: nowMs(), hidden: document.hidden }); };

  window.addEventListener('keydown', onKeydown, { passive: true });
  window.addEventListener('compositionstart', onCompositionStart);
  window.addEventListener('compositionupdate', onCompositionUpdate);
  window.addEventListener('compositionend', onCompositionEnd);
  window.addEventListener('focus', onFocus, true);
  window.addEventListener('blur', onBlur, true);
  document.addEventListener('visibilitychange', onVisibility);

  const snapshot = (reason: InputDiagSnapshot['reason'] = 'input_focus_no_keydown'): InputDiagSnapshot => {
    const focus = describeFocused();
    const now = nowMs();
    return {
      reason,
      focusedTag: focus.tag,
      focusedType: focus.type,
      focusedName: focus.name,
      focusedId: focus.id,
      focusedClass: focus.class,
      focusedValueLength: focus.valueLength,
      focusedValuePreview: focus.valuePreview,
      focusedSelectionStart: focus.selectionStart,
      focusedSelectionEnd: focus.selectionEnd,
      isContentEditable: focus.isContentEditable,
      activeElementPath: focus.path,
      stallCount: state.stallCount,
      msSinceLastKeydown: now - state.lastKeydownMs,
      msSinceLastCompositionEnd: now - state.lastCompositionEndMs,
      pendingComposition: state.pendingComposition ? { ...state.pendingComposition } : null,
      recent: state.buffer.slice(),
      appVersion: (window as any).__APP_VERSION__ || 'unknown',
      electronVersion: (process as any)?.versions?.electron || 'na',
      ua: navigator.userAgent.slice(0, 200),
    };
  };

  const sendIfPossible = (snap: InputDiagSnapshot) => {
    const api = (window as any).taskAPI;
    try {
      if (api && api.diag && typeof api.diag.append === 'function') {
        api.diag.append(snap);
      } else {
        // 浏览器预览环境：只在 console 留痕，不允许阻塞
        // eslint-disable-next-line no-console
        console.warn('[input-diag] stall detected', snap.reason, 'events:', snap.recent.length);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[input-diag] report failed', e);
    }
  };

  let pollId: number | null = null;
  let lastFocusNotified = 0;
  let lastFocusTag = '';

  const inspect = () => {
    const focus = describeFocused();
    const now = nowMs();
    const tag = `${focus.tag}#${focus.id || ''}`;
    if (tag !== lastFocusTag) {
      lastFocusTag = tag;
      lastFocusNotified = now;
    }
    // 1) 焦点在输入元素里
    const inEditable = focus.tag === 'input' || focus.tag === 'textarea' || focus.isContentEditable;
    if (!inEditable) return;
    // 2) 容器豁免（一般调试用，比如用户在看诊断页本身）
    if (opts.ignoreInside && document.querySelector(opts.ignoreInside)?.contains(document.activeElement)) return;
    // 3) 失灵判定：8 秒无 keydown
    const idle = now - state.lastKeydownMs;
    if (idle < STALL_MS) return;
    // 4) 冷却
    if (now - state.lastReportAt < COOLDOWN_MS) return;
    // 5) IME 期间不报（用户可能还在打字，composition update 不算 keydown）
    if (state.pendingComposition) return;

    state.stallCount += 1;
    state.lastReportAt = now;
    const snap = snapshot(idle > STALL_MS * 2 ? 'input_focus_no_composition_end' : 'input_focus_no_keydown');
    sendIfPossible(snap);
  };

  pollId = window.setInterval(inspect, POLL_MS);

  return {
    stop: () => {
      if (pollId != null) { clearInterval(pollId); pollId = null; }
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('compositionstart', onCompositionStart);
      window.removeEventListener('compositionupdate', onCompositionUpdate);
      window.removeEventListener('compositionend', onCompositionEnd);
      window.removeEventListener('focus', onFocus, true);
      window.removeEventListener('blur', onBlur, true);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    snapshot,
    flush: () => sendIfPossible(snapshot()),
    getBuffer: () => state.buffer.slice(),
  };
}
