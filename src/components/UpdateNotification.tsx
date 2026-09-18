import { useEffect, useState } from 'react';
import { Sparkles, Download, X, ExternalLink, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';

interface UpdatePayload {
  ok?: boolean;
  reason?: string;
  message?: string;
  currentVersion?: string;
  latestVersion?: string | null;
  hasUpdate?: boolean;
  notes?: string | null;
  downloadUrl?: string | null;
  pageUrl?: string | null;
  sha256?: string | null;
  forced?: boolean;
  skipped?: boolean;
  source?: string;
  sourceIndex?: number;
  sourceName?: string;
  /** 多源聚合结果：每个源的独立结果（type/password 供北科云盘源换签名直链） */
  perSource?: Array<{
    name: string; url: string; ok: boolean; latestVersion: string | null;
    reason?: string; message?: string;
    type?: 'anyshare' | 'http'; password?: string; sourceIndex?: number;
  }>;
}

interface DownloadState {
  running: boolean;
  percent: number;
  received: number;
  total: number;
}

interface Props {
  /** 持久化的 updateInfo（来自 store，启动期填充） */
  externalTrigger?: UpdatePayload | null;
}

/**
 * 全局更新通知组件
 * - 监听 IPC 'update:available'（主进程启动自动检查推送）
 * - 右下角 Toast 弹窗（不阻塞）
 * - 用户操作：下载 / 立即安装 / 忽略本次 / 打开发布页 / 展开多源详情
 */
export default function UpdateNotification({ externalTrigger }: Props) {
  const [payload, setPayload] = useState<UpdatePayload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dl, setDl] = useState<DownloadState | null>(null);
  const [dlPath, setDlPath] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 监听主进程推送（启动自动检查）
  useEffect(() => {
    const off = window.taskAPI.updater.onAvailable((r: UpdatePayload) => {
      if (r?.hasUpdate && !r?.skipped) setPayload(r);
    });
    return off;
  }, []);

  // Settings 页手动触发也展示
  useEffect(() => {
    if (externalTrigger && externalTrigger.hasUpdate && !externalTrigger.skipped) {
      setPayload(externalTrigger);
    }
  }, [externalTrigger]);

  // 监听下载进度
  useEffect(() => {
    const off = window.taskAPI.updater.onProgress((p: any) => {
      if (p.phase === 'start') {
        setDl({ running: true, percent: 0, received: 0, total: p.total || 0 });
        setErr(null);
        setDlPath(null);
      } else if (p.phase === 'progress') {
        setDl({ running: true, percent: p.percent || 0, received: p.received || 0, total: p.total || 0 });
      } else if (p.phase === 'done') {
        setDl({ running: false, percent: 100, received: p.received || 0, total: p.total || 0 });
        setDlPath(p.path || null);
      }
    });
    return off;
  }, []);

  if (!payload || !payload.hasUpdate) return null;

  const close = () => setPayload(null);
  const ignore = async () => {
    if (payload.latestVersion) await window.taskAPI.updater.skipVersion(payload.latestVersion);
    setPayload(null);
  };
  const startDownload = async () => {
    if (!payload.downloadUrl || !payload.latestVersion) {
      setErr('该源未提供下载直链，请使用「打开发布页」');
      return;
    }
    setDl({ running: true, percent: 0, received: 0, total: 0 });
    setErr(null);
    setDlPath(null);
    // 北科云盘源：downloadUrl 是云盘里的文件名，需带上源信息（提取码）让主进程换签名直链
    const ps = payload.sourceIndex != null
      ? payload.perSource?.find((p) => p.sourceIndex === payload.sourceIndex)
      : undefined;
    const r = await window.taskAPI.updater.download({
      url: payload.downloadUrl,
      version: payload.latestVersion,
      sha256: payload.sha256,
      source: ps ? { name: ps.name, url: ps.url, enabled: true, primary: false, type: ps.type, password: ps.password } : null,
    });
    if (!r.ok) setErr(r.error || '下载失败');
    setDl(null);
    if (r.path) setDlPath(r.path);
  };
  const install = async () => {
    if (!dlPath) return;
    const r = await window.taskAPI.updater.install(dlPath);
    if (!r.ok) setErr(r.error || '启动安装包失败');
  };
  const openPage = async () => {
    const url = payload.pageUrl || payload.source || '';
    if (url) await window.taskAPI.updater.openExternal(url);
  };

  return (
    <div
      // v1.1.5: 外层 pointer-events-none 避免挡住右下角其他按钮（保存设置、Calendar + 按钮）；
      // 内部按钮 / 链接 pointer-events-auto 让 toast 自己仍可点击
      className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[92vw] rounded-lg border border-neon-yellow/50 bg-ink-900/95 backdrop-blur-md shadow-2xl overflow-hidden pointer-events-none"
      style={{ boxShadow: '0 0 24px rgba(255, 214, 10, 0.25)' }}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 bg-neon-yellow/10 border-b border-neon-yellow/30">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-neon-yellow" />
          <span className="font-mono text-xs font-bold text-neon-yellow">
            发现新版本 v{payload.latestVersion}
          </span>
          {payload.forced && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-neon-danger/20 text-neon-danger border border-neon-danger/40">
              强制
            </span>
          )}
        </div>
        <button onClick={close} className="text-text-secondary hover:text-text-primary pointer-events-auto">
          <X size={14} />
        </button>
      </div>

      {/* 内容 */}
      <div className="px-3 py-3 space-y-2">
        <div className="font-mono text-[10px] text-text-dim">
          当前 v{payload.currentVersion} · 来自 {payload.sourceName || '主源'}
          {payload.perSource && payload.perSource.length > 1 && (
            <span className="ml-1">
              （{payload.perSource.filter((p) => p.ok).length}/{payload.perSource.length} 源可用）
            </span>
          )}
        </div>

        {payload.notes && (
          <div className="text-xs text-text-secondary whitespace-pre-wrap max-h-32 overflow-y-auto font-mono leading-relaxed bg-ink-base/40 rounded p-2 border border-neon-green/10">
            {payload.notes}
          </div>
        )}

        {/* 多源详情（可折叠） */}
        {payload.perSource && payload.perSource.length > 1 && (
          <div>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="font-mono text-[10px] text-text-dim hover:text-neon-green flex items-center gap-1"
            >
              {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              查看 {payload.perSource.length} 个源的检查结果
            </button>
            {expanded && (
              <div className="mt-1 space-y-1">
                {payload.perSource.map((s, i) => (
                  <div key={i} className="font-mono text-[10px] text-text-secondary bg-ink-base/40 rounded px-2 py-1 border border-neon-green/10 flex justify-between">
                    <span className="truncate">{s.name}</span>
                    <span className={s.ok ? 'text-neon-green' : 'text-neon-danger'}>
                      {s.ok ? `v${s.latestVersion}` : (s.reason || '失败')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 下载进度 */}
        {dl && (
          <div className="space-y-1">
            <div className="progress-bar">
              <div style={{ width: `${dl.percent}%`, background: '#FFD60A', boxShadow: '0 0 6px #FFD60A' }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-text-dim">
              <span>{dl.running ? '下载中' : '下载完成'}</span>
              <span>
                {dl.percent}%
                {dl.total ? ` · ${(dl.received / 1048576).toFixed(1)}/${(dl.total / 1048576).toFixed(1)} MB` : ''}
              </span>
            </div>
          </div>
        )}

        {err && (
          <div className="font-mono text-[10px] text-neon-danger bg-neon-danger/5 border border-neon-danger/30 rounded px-2 py-1">
            ✗ {err}
          </div>
        )}

        {dlPath && !dl && (
          <div className="font-mono text-[10px] text-neon-green bg-neon-green/5 border border-neon-green/30 rounded px-2 py-1 break-all">
            ✓ 已下载到 {dlPath}
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-t border-neon-green/15 bg-ink-base/60 pointer-events-auto">
        {dlPath && (
          <button onClick={install} className="btn-neon btn-neon-yellow text-xs py-1">
            <Sparkles size={12} /> 立即安装并重启
          </button>
        )}
        {!dlPath && !dl && payload.downloadUrl && (
          <button onClick={startDownload} className="btn-neon btn-neon-yellow text-xs py-1">
            <Download size={12} /> 下载更新
          </button>
        )}
        {dl && (
          <button
            onClick={async () => {
              await window.taskAPI.updater.cancel();
              setDl(null);
            }}
            className="btn-ghost text-xs py-1"
          >
            取消下载
          </button>
        )}
        {(payload.pageUrl || payload.source) && (
          <button onClick={openPage} className="btn-ghost text-xs py-1">
            <ExternalLink size={12} /> 打开发布页
          </button>
        )}
        <button onClick={ignore} className="btn-ghost text-text-dim text-xs py-1 ml-auto">
          忽略此版本
        </button>
      </div>

      {/* 强制更新警告 */}
      {payload.forced && (
        <div className="px-3 py-1.5 bg-neon-danger/10 border-t border-neon-danger/30 flex items-center gap-1.5 font-mono text-[10px] text-neon-danger">
          <AlertCircle size={11} /> 此版本含重要修复，建议尽快更新
        </div>
      )}
    </div>
  );
}