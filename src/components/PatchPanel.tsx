/**
 * v1.2.7：增量补丁面板（独立组件，原 Settings.tsx:2062-2206）
 *
 * 含三个子组件：
 *   PatchUpdateButton —— 「检查更新」后自动浮现的「下载补丁」按钮
 *   PatchCacheCard    —— 持久缓存（zip+manifest）的「应用/清除」卡
 *   PatchStateCard    —— 上次补丁的结果（applied / pendingSidecar / failed） + 立即重试
 *
 * 调用方：Settings.tsx 渲染位置 + 透传 onMessage / onProgress 回调
 */
import { useEffect, useState } from 'react';
import { Package, Trash2, AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';

export function PatchUpdateButton({
  aggregate, appVersion, onMessage, onProgress,
}: {
  aggregate: any;
  appVersion: string;
  onMessage: (m: string) => void;
  onProgress: (p: any) => void;
}) {
  const [preview, setPreview] = useState<{
    available: boolean;
    reason?: string;
    patch?: any;
    sizeMB?: number;
    fullSizeMB?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    if (!aggregate?.winner) { setPreview(null); return; }
    const winner = aggregate.winner;
    if (!winner.hasUpdate) { setPreview(null); return; }
    void (async () => {
      try {
        const r = await window.taskAPI.updater.patchPreview({
          version: winner.latestVersion,
          patches: winner.patches || [],
          size: winner.size || winner.asarSize || 90_000_000,
        }, appVersion);
        setPreview(r as any);
        // 该补丁是否已在缓存中（上次下载过）
        const st = await window.taskAPI.updater.patchCacheState();
        setCached(!!(st?.exists && st?.info && st.info.toVersion === winner.latestVersion));
      } catch { /* ignore */ }
    })();
  }, [aggregate?.winner?.latestVersion, aggregate?.checkedAt, appVersion]);

  if (!preview || preview.available === false) return null;
  if (cached) return null; // 已在缓存 → 由 PatchCacheCard 接管

  const download = async () => {
    if (!preview.patch) return;
    setBusy(true);
    try {
      onProgress({ running: true, percent: 0, received: 0, total: preview.patch.size || 0 });
      const off = window.taskAPI.updater.onProgress((p: any) => {
        if (p.phase === 'progress' && String(p.fileName || '').startsWith('patch-')) {
          onProgress({ running: true, percent: p.percent || 0, received: p.received || 0, total: p.total || 0 });
        }
      });
      const r = await window.taskAPI.updater.patchDownload(preview.patch);
      off?.();
      onProgress(null);
      if (!r.ok) {
        onMessage('补丁下载失败：' + (r.error || 'unknown'));
        return;
      }
      setCached(true);
      onMessage(`✓ 增量补丁 v${preview.patch.fromVersion} → v${r.state?.info?.toVersion || ''} 已下载到本地缓存（zip + manifest）。点击下方「应用补丁」立即升级。`);
    } catch (e: any) {
      onMessage(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button onClick={download} disabled={busy} className="btn-neon" title={`下载补丁 ${preview.sizeMB?.toFixed(1)} MB（整装 ${preview.fullSizeMB?.toFixed(0)} MB）`}>
      <Package size={14} /> {busy ? '下载补丁中…' : `增量补丁 ${preview.sizeMB?.toFixed(1)} MB`}
    </button>
  );
}

export function PatchCacheCard({ appVersion, onMessage }: { appVersion: string; onMessage: (m: string) => void }) {
  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setState(await window.taskAPI.updater.patchCacheState()); } catch { /* ignore */ }
  };
  useEffect(() => { void refresh(); }, []);

  if (!state?.exists || !state?.info) return null;
  const info = state.info;
  const fromMe = info.fromVersion === appVersion;

  const apply = async () => {
    if (!confirm(
      `应用增量补丁 v${info.fromVersion} → v${info.toVersion}（${(info.size / 1048576).toFixed(1)} MB）？\n\n` +
      `⚠ 应用时 App 会自动退出并重启，未保存的数据会丢失。`
    )) return;
    setBusy(true);
    try {
      const r = await window.taskAPI.updater.patchApplyCached();
      if (!r.ok) {
        onMessage('应用失败：' + (r.error || 'unknown'));
        setBusy(false);
        return;
      }
      onMessage('补丁已启动（helper 进程接管），App 即将退出并重启…');
    } catch (e: any) {
      onMessage(String(e?.message || e));
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm('删除已缓存的补丁（zip + manifest）？')) return;
    await window.taskAPI.updater.patchClearCache();
    onMessage('已清除补丁缓存');
    void refresh();
  };

  return (
    <div className="mt-3 p-3 rounded-lg border border-neon-green/30 bg-neon-green/5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Package size={14} className="text-neon-green" />
          <span className="text-neon-green">已下载的增量更新</span>
          <span className="text-text-dim">v{info.fromVersion} → v{info.toVersion} · {(info.size / 1048576).toFixed(1)} MB</span>
        </div>
        <span className="font-mono text-[10px] text-text-dim">{new Date(info.downloadedAt).toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {state.zipOk === false && (
          <span className="font-mono text-[10px] text-neon-danger bg-neon-danger/5 border border-neon-danger/30 rounded px-2 py-1">
            ✗ zip 校验失败，请清除后重新下载
          </span>
        )}
        {state.zipOk !== false && !fromMe && (
          <span className="font-mono text-[10px] text-neon-yellow bg-neon-yellow/5 border border-neon-yellow/30 rounded px-2 py-1">
            当前 v{appVersion} 与补丁起点 v{info.fromVersion} 不一致，应用会被拒绝
          </span>
        )}
        <div className="flex-1" />
        <button onClick={apply} disabled={busy || state.zipOk === false || !fromMe} className="btn-neon text-xs py-1">
          {busy ? '应用中…' : '应用补丁并重启'}
        </button>
        <button onClick={clear} className="btn-ghost text-xs py-1 text-text-dim">
          <Trash2 size={12} /> 清除缓存
        </button>
      </div>
    </div>
  );
}

/** v1.2.7：上次补丁状态卡（applied / pendingSidecar / failed）—— 让用户看到上次重启后
 *  补丁到底成功了没，如果 .new 旁路残留还能一键重试 */
export function PatchStateCard({ onMessage }: { onMessage: (m: string) => void }) {
  const [st, setSt] = useState<{
    applied?: boolean; failed?: boolean; pendingSidecar?: boolean;
    baseline?: { expected: string; actual: string }; message?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    try { setSt(await window.taskAPI.updater.patchState()); } catch { /* ignore */ }
  };
  useEffect(() => { void refresh(); }, []);

  if (!st || (!st.applied && !st.failed && !st.pendingSidecar)) return null;

  const retry = async () => {
    setBusy(true);
    try {
      if (st.pendingSidecar) {
        // v1.2.7：spawn helper with mode='takeover-sidecar'，helper 接管 + relaunch
        const r = await window.taskAPI.updater.patchTakeoverSidecar();
        if (!r.ok) {
          onMessage('接管 .new 失败：' + (r.error || 'unknown'));
          setBusy(false);
          return;
        }
        onMessage('已启动 helper 接管 .new 旁路；App 即将退出并重启为新版本');
      } else {
        // failed = 重新走缓存式补丁流程（如果缓存还在就直接 apply，否则重新下载）
        const r = await window.taskAPI.updater.patchApplyCached();
        if (!r.ok) onMessage('立即重试失败：' + (r.error || 'unknown'));
        else onMessage('补丁已启动；App 即将退出并重启');
      }
    } catch (e: any) {
      onMessage(String(e?.message || e));
      setBusy(false);
    }
  };

  const color = st.applied ? 'neon-green' : st.pendingSidecar ? 'neon-yellow' : 'neon-danger';
  const Icon = st.applied ? CheckCircle2 : AlertTriangle;
  const title = st.applied ? '✓ 上次补丁已成功应用' :
                st.pendingSidecar ? '⚠ 补丁有 .new 旁路残留（未接管）' :
                '✗ 上次补丁应用失败';
  return (
    <div className={`mt-3 p-3 rounded-lg border border-${color}/30 bg-${color}/5 space-y-2`}>
      <div className="flex items-center gap-2 font-mono text-xs">
        <Icon size={14} className={`text-${color}`} />
        <span className={`text-${color}`}>{title}</span>
      </div>
      {st.message && (
        <div className={`font-mono text-[10px] text-${color}/80 break-all bg-ink-base/40 rounded p-2 border border-${color}/10`}>
          {st.message}
        </div>
      )}
      {st.baseline && !st.applied && (
        <div className="font-mono text-[10px] text-text-dim">
          期望基线 <code>{st.baseline.expected.slice(0, 16)}…</code> · 实际 <code>{st.baseline.actual.slice(0, 16)}…</code>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1" />
        {!st.applied && (
          <button onClick={retry} disabled={busy} className={`btn-neon text-xs py-1`}>
            <RotateCcw size={12} /> {busy ? '处理中…' : st.pendingSidecar ? '重启 App 并接管' : '立即重试'}
          </button>
        )}
        <button onClick={refresh} className="btn-ghost text-xs py-1 text-text-dim">
          刷新状态
        </button>
      </div>
    </div>
  );
}