/**
 * v1.2.11：移动端（Android）APK 自更新面板。
 *
 * 以前设置页这里只有一句话「移动端不支持应用内更新，自己去 GitHub 下」。
 * 结果手机上的 APK 永远停在装的那天：桌面端修的动态 import 白屏，移动端
 * 用户一个都拿不到修复。现在改成完整链路：检查 → 下载 → 校验 → 拉起安装。
 *
 * 全程走 @/mobile/apkUpdater（Capacitor 自定义插件），与桌面 electron 的
 * child_process / patch 体系完全隔离 —— 不会出现「下载到 IndexedDB 然后
 * spawn 抛错」这类经典翻车。
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Download, ExternalLink, ShieldCheck, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import {
  checkAndroidUpdate,
  installAndroidApk,
  openInstallPermissionSettings,
  type ApkUpdateCheck,
  type AndroidUpdateInfo,
} from '@/mobile/apkUpdater';

const RELEASE_PAGE = 'https://github.com/NightRainStarGame/USTBTaskManager/releases';

export default function MobileUpdatePanel() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [check, setCheck] = useState<ApkUpdateCheck | null>(null);
  const [note, setNote] = useState<string>('');
  const [error, setError] = useState<string>('');

  const runCheck = useCallback(async (silent = false) => {
    setChecking(true);
    if (!silent) setNote('');
    setError('');
    try {
      const r = await checkAndroidUpdate();
      setCheck(r);
      if (!r.ok && !silent) setError(r.error || '检查失败');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }, []);

  // 进设置页静默查一次：不用点就知道有没有新版
  useEffect(() => { void runCheck(true); }, [runCheck]);

  const doInstall = async (info: AndroidUpdateInfo) => {
    setInstalling(true);
    setNote('');
    setError('');
    try {
      const r = await installAndroidApk(info);
      if (r.ok) {
        setNote('已下载完成并拉起安装界面，按系统提示确认即可完成升级。');
      } else if (r.reason === 'NEED_INSTALL_PERMISSION') {
        setError('需要「允许安装未知应用」授权，已为你打开授权页，回来后重试即可。');
        await openInstallPermissionSettings();
      } else if (r.reason === 'NO_PLUGIN') {
        setError('本包未内置安装插件，请到「打开发布页」手动下载 APK。');
      } else {
        setError(`安装未完成（${r.reason}），可稍后重试或到发布页手动下载。`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  const latest = check?.latest;
  const hasUpdate = !!check?.hasUpdate && !!latest;

  return (
    <div className="space-y-2 p-3 rounded-md border border-neon-green/15 bg-ink-base/40">
      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-secondary">
        <span className="flex items-center gap-1.5">
          <Smartphone size={13} className="text-neon-green" />
          当前版本 v{check?.currentVersion || '—'}
          {!!check?.currentVersionCode && (
            <span className="text-text-dim">(versionCode {check.currentVersionCode})</span>
          )}
        </span>
        <button
          onClick={() => void runCheck(false)}
          disabled={checking || installing}
          className="btn-ghost px-2 py-1 text-[11px]"
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
          {checking ? '检查中…' : '检查更新'}
        </button>
      </div>

      {!check && checking && (
        <div className="font-mono text-[11px] text-text-dim">正在获取更新清单…</div>
      )}

      {check && !hasUpdate && check.ok && (
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-neon-green">
          <CheckCircle2 size={13} /> 已是最新版本
        </div>
      )}

      {hasUpdate && latest && (
        <div className="space-y-2">
          <div className="font-mono text-[11px] text-neon-yellow">
            发现新版本 v{latest.version}
            {!!latest.versionCode && ` (versionCode ${latest.versionCode})`}
            {!!latest.size && ` · ${(latest.size / 1048576).toFixed(1)} MB`}
          </div>
          {latest.notes && (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-text-secondary border border-neon-green/10 rounded p-2 bg-ink-base/50">
              {latest.notes}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void doInstall(latest)}
              disabled={installing}
              className="btn-neon btn-neon-yellow"
            >
              <Download size={14} /> {installing ? '下载并安装中…' : `下载并安装 v${latest.version}`}
            </button>
            <button
              onClick={() => { try { window.open(latest.page || RELEASE_PAGE, '_blank'); } catch { /* ignore */ } }}
              className="btn-ghost"
            >
              <ExternalLink size={13} /> 发布页
            </button>
          </div>
        </div>
      )}

      {!!note && (
        <div className="flex items-start gap-1.5 font-mono text-[11px] text-neon-green">
          <ShieldCheck size={13} className="shrink-0 mt-0.5" />
          <span>{note}</span>
        </div>
      )}

      {!!error && (
        <div className="flex items-start gap-1.5 font-mono text-[11px] text-neon-yellow">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
