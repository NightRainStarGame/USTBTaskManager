/**
 * 贝壳课表：USTB SSO 扫码登录 + BYYT 教务课表一键导入
 * （原在小程序中心，v1.2.3 迁到课程页；小程序中心同步移除）
 */
import { useEffect, useRef, useState } from 'react';
import { Shell, QrCode, RefreshCw, LogOut, Eye } from 'lucide-react';
import dayjs from 'dayjs';
import { useStore } from '@/store';
import Modal from '@/components/Modal';

interface UstbItem {
  day: number;
  period: number;
  className: string;
  teacher: string;
  weeksText: string;
  location: string;
  periodName: string;
}

const USTB_TERMS = [
  { value: '2026-2027-1', label: '2026-2027 秋学期', xn: '2026-2027', xq: '1' },
  { value: '2026-2027-2', label: '2026-2027 春学期', xn: '2026-2027', xq: '2' },
  { value: '2025-2026-2', label: '2025-2026 春学期', xn: '2025-2026', xq: '2' },
  { value: '2025-2026-1', label: '2025-2026 秋学期', xn: '2025-2026', xq: '1' },
];

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function BeikeTimetable() {
  const refreshAll = useStore((s) => s.refreshAll);
  const settings = useStore((s) => s.settings);
  const [status, setStatus] = useState<{ loggedIn: boolean; user: { name: string; school: string; userId: string } | null; lastSync: number | null; importedCount: number } | null>(null);
  const [term, setTerm] = useState('2026-2027-1');
  const [semStart, setSemStart] = useState(dayjs().format('YYYY-MM-DD'));
  const [qr, setQr] = useState<{ sessionId: string; image: string } | null>(null);
  const [qrState, setQrState] = useState<'loading' | 'waiting' | 'scanned' | 'expired' | 'error'>('loading');
  const [qrError, setQrError] = useState('');
  const [items, setItems] = useState<UstbItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = async () => setStatus(await window.taskAPI.ustb.status());

  useEffect(() => {
    loadStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 学期起始日默认取设置里的开学日
  useEffect(() => {
    if (settings.semester_start) {
      setSemStart(dayjs(Number(settings.semester_start)).format('YYYY-MM-DD'));
    }
  }, [settings.semester_start]);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startQr = async () => {
    setQrError('');
    setQrState('loading');
    setMsg(null);
    try {
      const r = await window.taskAPI.ustb.qrStart();
      setQr({ sessionId: r.sessionId, image: r.qrImage });
      setQrState('waiting');
      stopPoll();
      pollRef.current = setInterval(async () => {
        try {
          const p = await window.taskAPI.ustb.qrPoll(r.sessionId);
          if (p.status === 'waiting') setQrState('waiting');
          else if (p.status === 'scanned') setQrState('scanned');
          else if (p.status === 'expired') {
            setQrState('expired');
            stopPoll();
          } else if (p.status === 'error') {
            setQrState('error');
            setQrError(p.message ?? '轮询出错');
            stopPoll();
          } else if (p.status === 'success') {
            stopPoll();
            setQr(null);
            await loadStatus();
            setMsg({ kind: 'ok', text: `登录成功：${p.user?.name ?? ''}${p.user?.school ? ` · ${p.user.school}` : ''}` });
          }
        } catch (err: any) {
          setQrState('error');
          setQrError(err?.message ?? String(err));
          stopPoll();
        }
      }, 2000);
    } catch (err: any) {
      setQrState('error');
      setQrError(err?.message ?? String(err));
    }
  };

  const closeQr = () => {
    if (qr) window.taskAPI.ustb.qrCancel(qr.sessionId).catch(() => {});
    stopPoll();
    setQr(null);
  };

  const termInfo = () => USTB_TERMS.find((t) => t.value === term)!;

  const doPreview = async () => {
    const t = termInfo();
    setBusy('preview');
    setMsg(null);
    try {
      const r = await window.taskAPI.ustb.preview({ xn: t.xn, xq: t.xq });
      setItems(r.items);
      setMsg({ kind: 'ok', text: `已获取 ${r.items.length} 条课程记录（${r.user?.name ?? ''}）` });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? String(e) });
    }
    setBusy(null);
  };

  const doSync = async () => {
    const t = termInfo();
    if (!semStart) {
      setMsg({ kind: 'err', text: '请先设置第 1 周周一的日期' });
      return;
    }
    if (!confirm(`同步 ${t.label} 课表？\n\n· 之前导入的贝壳课表数据会被替换\n· 手动添加的课程和日程不受影响`)) return;
    setBusy('sync');
    setMsg(null);
    try {
      const r = await window.taskAPI.ustb.import({ xn: t.xn, xq: t.xq, semesterStart: dayjs(semStart).valueOf() });
      await refreshAll();
      setItems(null);
      await loadStatus();
      setMsg({
        kind: 'ok',
        text: `同步完成：${r.courses} 门课程 · ${r.events} 个上课时间${r.warnings?.length ? `（注意：${r.warnings[0]}）` : ''}`,
      });
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message ?? String(e) });
    }
    setBusy(null);
  };

  const doLogout = async () => {
    if (!confirm('退出贝壳课表登录？\n（已导入的课表数据会保留）')) return;
    await window.taskAPI.ustb.logout();
    setItems(null);
    setMsg(null);
    await loadStatus();
  };

  return (
    <div>
      <div className="flex items-center gap-2 pb-3 border-b border-neon-green/10">
        <Shell size={16} className="text-neon-green" />
        <h3 className="label-tag">贝壳课表 · USTB 教务同步</h3>
        <span className="ml-auto text-[10px] font-mono text-text-dim">
          {status?.loggedIn
            ? `已登录${status.user?.name ? ` · ${status.user.name}` : ''}${status.lastSync ? ` · 上次同步 ${dayjs(status.lastSync).format('MM-DD HH:mm')}` : ''}`
            : '未登录'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3 items-end">
        <div>
          <label className="text-[10px] font-mono text-text-dim">学期</label>
          <select value={term} onChange={(e) => setTerm(e.target.value)} className="input-neon text-xs py-1.5 w-full">
            {USTB_TERMS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-text-dim">第 1 周周一</label>
          <input type="date" value={semStart} onChange={(e) => setSemStart(e.target.value)} className="input-neon text-xs py-1.5 w-full" />
        </div>
        <div className="flex gap-2">
          {!status?.loggedIn ? (
            <button onClick={startQr} disabled={busy === 'sync'} className="btn-neon text-xs py-1.5 flex-1 flex items-center justify-center gap-1 disabled:opacity-40">
              <QrCode size={14} /> 扫码登录
            </button>
          ) : (
            <>
              <button onClick={doPreview} disabled={!!busy} className="btn-ghost text-xs py-1.5 flex items-center gap-1 disabled:opacity-40">
                <Eye size={14} /> 预览
              </button>
              <button onClick={doSync} disabled={!!busy} className="btn-neon text-xs py-1.5 flex-1 flex items-center justify-center gap-1 disabled:opacity-40">
                <RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} /> 同步课表
              </button>
            </>
          )}
        </div>
        {status?.loggedIn && (
          <button onClick={doLogout} className="btn-ghost text-xs py-1.5 text-text-dim hover:text-neon-danger flex items-center justify-center gap-1">
            <LogOut size={12} /> 退出登录
          </button>
        )}
      </div>

      {msg && (
        <div className={`mt-3 text-xs font-mono px-3 py-2 rounded border ${msg.kind === 'ok' ? 'border-neon-green/30 text-neon-green bg-neon-green/5' : 'border-neon-danger/40 text-neon-danger bg-neon-danger/5'}`}>
          {msg.text}
        </div>
      )}

      {items && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-text-dim text-[10px] border-b border-neon-green/10">
                <th className="text-left py-1.5 pr-3">课程</th>
                <th className="text-left py-1.5 pr-3">教师</th>
                <th className="text-left py-1.5 pr-3">时间</th>
                <th className="text-left py-1.5 pr-3">周次</th>
                <th className="text-left py-1.5">地点</th>
              </tr>
            </thead>
            <tbody>
              {[...items]
                .sort((a, b) => a.day - b.day || a.period - b.period)
                .map((it, i) => (
                  <tr key={i} className="border-b border-neon-green/5 hover:bg-neon-green/5">
                    <td className="py-1.5 pr-3 text-text-primary font-bold">{it.className.replace(/\n/g, ' ')}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{it.teacher || '-'}</td>
                    <td className="py-1.5 pr-3 text-neon-green">{WEEKDAY_NAMES[it.day - 1] ?? it.day} · {it.periodName || `第${it.period}大节`}</td>
                    <td className="py-1.5 pr-3 text-neon-yellow">{it.weeksText || '-'}</td>
                    <td className="py-1.5 text-text-secondary">{it.location || '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {!status?.loggedIn && !msg && (
        <p className="mt-3 text-[10px] font-mono text-text-dim">
          使用北科大统一身份认证微信扫码登录，自动拉取教务课表并生成课程卡片 + 日历上课时间。需在校园网环境下使用。
        </p>
      )}

      {/* 扫码登录弹窗 */}
      {qr && (
        <Modal title="微信扫码登录 · 北科大统一身份认证" onClose={closeQr}>
          <div className="flex flex-col items-center gap-4">
            <div className="p-3 bg-white rounded-lg">
              <img src={qr.image} alt="登录二维码" className="w-56 h-56" />
            </div>
            <div className="text-xs font-mono text-center">
              {qrState === 'loading' && <span className="text-text-dim">正在生成二维码…</span>}
              {qrState === 'waiting' && <span className="text-neon-green">请使用微信扫描二维码</span>}
              {qrState === 'scanned' && <span className="text-neon-yellow">已扫码，请在手机上确认登录</span>}
              {qrState === 'expired' && <span className="text-neon-danger">二维码已过期</span>}
              {qrState === 'error' && <span className="text-neon-danger">{qrError || '出错了'}</span>}
            </div>
            {(qrState === 'expired' || qrState === 'error') && (
              <button onClick={startQr} className="btn-neon text-xs py-1.5 flex items-center gap-1">
                <RefreshCw size={12} /> 刷新二维码
              </button>
            )}
            <p className="text-[10px] font-mono text-text-dim text-center">
              扫码确认后 TaskManager 会自动完成登录并保存登录态（仅存本机），下次同步无需重复扫码。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
