/**
 * v1.2.7：输入失灵诊断面板（独立组件，原 Settings.tsx:2209-2303）
 *
 * 数据源：window.taskAPI.diag.peek / .export（主进程读 %TMP% 下文件）
 * 探测器：window.__inputDiagHandle.flush（renderer 侧 v1.1.6 起埋的输入失灵自检器）
 *
 * 用途：用户报告「输入框偶尔失灵」时，一键导出诊断日志给开发者排查。
 */
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

export default function DiagPanel() {
  const [peek, setPeek] = useState<{
    path: string; byteCount: number; recent: Array<{ ts: number; iso: string; reason: string; focusedTag: string; stallCount: number; msSinceLastKeydown: number; appVersion: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await window.taskAPI.diag.peek();
      if (r.ok) {
        setPeek({ path: r.path, byteCount: r.byteCount, recent: r.recent as any });
      } else {
        setMsg('读取失败：' + (r.error || 'unknown'));
      }
    } catch (e: any) {
      setMsg(e?.message || String(e));
    }
  };

  useEffect(() => { void refresh(); }, []);

  const onExport = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await window.taskAPI.diag.export();
      if (r.canceled) { setMsg('已取消'); return; }
      if (!r.ok) { setMsg('导出失败：' + (r.error || 'unknown')); return; }
      setMsg(`已导出：${r.path}（${(r.byteCount || 0) / 1024 < 0.1 ? '空' : ((r.byteCount || 0) / 1024).toFixed(1) + ' KB'}）`);
      void refresh();
    } finally { setBusy(false); }
  };

  const onSelfTest = () => {
    try {
      const h = (window as any).__inputDiagHandle;
      if (h && typeof h.flush === 'function') {
        h.flush();
        setMsg('已触发一次测试快照（如果窗口有焦点中的输入元素，会立即落盘；否则忽略）');
      } else {
        setMsg('探测器未安装（可能不是 Electron 环境）');
      }
    } catch (e: any) {
      setMsg(String(e));
    }
  };

  const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`;
  const fmtAge = (ts: number) => {
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec} 秒前`;
    if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
    return `${Math.round(sec / 3600)} 小时前`;
  };

  return (
    <div data-input-diag-host className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={refresh} className="btn-ghost text-xs py-1.5">刷新</button>
        <button onClick={onExport} disabled={busy} className="btn-neon">
          <Download size={14} /> {busy ? '导出中…' : '导出日志'}
        </button>
        <button onClick={onSelfTest} className="btn-ghost text-xs py-1.5" title="强制探测器立即上报一次（即使没到 8 秒）">手动触发一次</button>
        {peek && (
          <span className="font-mono text-[10px] text-text-dim">
            日志文件 <code>{peek.path}</code> · 当前大小 {fmtSize(peek.byteCount)} · 最近 {peek.recent.length} 条记录
          </span>
        )}
      </div>
      {msg && (
        <div className="p-2 rounded font-mono text-[11px] border border-neon-green/20 bg-ink-base/40 break-all whitespace-pre-wrap">
          {msg}
        </div>
      )}
      {peek && peek.recent.length > 0 && (
        <div className="rounded-md border border-neon-green/15 bg-ink-base/40 p-3 font-mono text-[11px] space-y-1.5">
          <div className="text-text-dim uppercase text-[10px]">最近失灵快照（最多 5 条）</div>
          {peek.recent.map((r, i) => (
            <div key={i} className="flex justify-between gap-3 border-t border-neon-green/10 pt-1.5 first:border-t-0 first:pt-0">
              <span className="text-text-secondary">{fmtAge(r.ts)} · {r.reason === 'input_focus_no_composition_end' ? 'IME 候选中' : '无 keydown'} · 焦点 {r.focusedTag}</span>
              <span className="text-text-dim shrink-0">空载 {(r.msSinceLastKeydown / 1000).toFixed(1)}s · app v{r.appVersion}</span>
            </div>
          ))}
        </div>
      )}
      {peek && peek.recent.length === 0 && (
        <div className="text-text-dim font-mono text-[11px]">
          {peek.byteCount > 0 ? '日志存在但没有可解析的最近记录（可能格式较旧）。直接导出查看。' : '尚未捕获到失灵快照 —— 说明输入一直工作正常。'}
        </div>
      )}
    </div>
  );
}