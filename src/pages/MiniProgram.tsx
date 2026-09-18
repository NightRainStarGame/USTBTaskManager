import { useEffect, useRef, useState } from 'react';
import { AppWindow, X, Plus, Play, Settings, BookOpen, Clock, Calculator, FileText, Shell, QrCode, RefreshCw, LogOut, Eye } from 'lucide-react';
import { useStore } from '@/store';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Course, CourseMiniProgram } from '@/types';
import Modal from '@/components/Modal';

const APP_TYPES = [
  { id: 'timetable', name: '课程表', icon: BookOpen, desc: '可编辑、可导入的课表' },
  { id: 'timer', name: '番茄钟', icon: Clock, desc: '专注计时与统计' },
  { id: 'calculator', name: '绩点计算器', icon: Calculator, desc: '成绩与学分计算' },
  { id: 'notes', name: '课程笔记', icon: FileText, desc: '快速记录课堂要点' },
];

export default function MiniProgramPage() {
  const navigate = useNavigate();
  const courses = useStore(s => s.courses);
  const [miniPrograms, setMiniPrograms] = useState<CourseMiniProgram[]>([]);
  const [activeApps, setActiveApps] = useState<CourseMiniProgram[]>([]);
  const [selected, setSelected] = useState<CourseMiniProgram | null>(null);

  useEffect(() => {
    loadMiniPrograms();
  }, [courses]);

  const loadMiniPrograms = async () => {
    const list = await window.taskAPI.db.miniPrograms.list();
    setMiniPrograms(list);
    setActiveApps(list.filter((m: CourseMiniProgram) => m.active));
  };

  const openApp = (mp: CourseMiniProgram) => {
    if (!activeApps.find(a => a.id === mp.id)) {
      setActiveApps([...activeApps, mp]);
    }
    setSelected(mp);
  };

  const closeApp = (id: number) => {
    const next = activeApps.filter(a => a.id !== id);
    setActiveApps(next);
    if (selected?.id === id) setSelected(next[0] || null);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6 h-full flex flex-col">
      <div>
        <p className="label-tag">MINI·PROGRAM·CENTER</p>
        <h2 className="text-2xl font-bold mt-1">小程序中心 <span className="text-neon-green text-glow-green">·</span> <span className="text-text-dim font-mono text-base">课程级学习工具</span></h2>
      </div>

      {/* 贝壳课表：USTB 扫码登录 + 教务课表一键导入 */}
      <BeikeTimetable />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* 左侧：课程列表 + 已挂载小程序 */}
        <div className="glass-panel p-4 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2 pb-2 border-b border-neon-green/10">
            <AppWindow size={14} className="text-neon-green" />
            <h3 className="label-tag">已挂载工具</h3>
          </div>

          {courses.length === 0 ? (
            <div className="text-text-dim font-mono text-xs py-4 text-center">暂无课程</div>
          ) : (
            <div className="space-y-3">
              {courses.map(c => {
                const mp = miniPrograms.find(m => m.course_id === c.id);
                const type = APP_TYPES.find(t => t.id === mp?.app_type) || APP_TYPES[0];
                const Icon = type.icon;
                return (
                  <div key={c.id} className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 hover:border-neon-green/30 transition-colors">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: `${c.color}22`, color: c.color }}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">{c.name}</div>
                        <div className="text-[10px] text-text-dim font-mono">{mp ? type.name : '未挂载'}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => mp && openApp(mp)} disabled={!mp} className="flex-1 btn-neon text-xs py-1 disabled:opacity-40"><Play size={12} /> 打开</button>
                      <button onClick={() => navigate(`/courses?course=${c.id}&tab=miniprogram`)} className="flex-1 btn-ghost text-xs py-1"><Settings size={12} /> 配置</button>
                      {mp && (
                        <button
                          onClick={async () => {
                            if (!confirm(`卸载「${c.name}」的小程序（${type.name}）？`)) return;
                            await window.taskAPI.db.miniPrograms.delete(mp.id);
                            loadMiniPrograms();
                          }}
                          className="btn-ghost text-xs py-1 text-text-dim hover:text-neon-danger"
                          title="卸载小程序"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 右侧：运行中的小程序窗口 */}
        <div className="lg:col-span-2 glass-panel p-4 flex flex-col min-h-0">
          {selected ? (
            <MiniAppRunner mp={selected} course={courses.find(c => c.id === selected.course_id)!} onClose={() => closeApp(selected.id)} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-text-dim font-mono">
              <AppWindow size={64} className="mb-4 text-neon-green/30" />
              <p className="text-lg">选择左侧小程序打开</p>
              <p className="text-xs mt-2">支持同时打开多个小程序窗口</p>
            </div>
          )}

          {/* 底部标签栏 */}
          {activeApps.length > 0 && (
            <div className="mt-4 pt-3 border-t border-neon-green/10 flex gap-2 overflow-x-auto">
              {activeApps.map(mp => {
                const c = courses.find(c => c.id === mp.course_id);
                const type = APP_TYPES.find(t => t.id === mp.app_type) || APP_TYPES[0];
                const Icon = type.icon;
                return (
                  <button
                    key={mp.id}
                    onClick={() => setSelected(mp)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs border transition-colors ${selected?.id === mp.id ? 'border-neon-green bg-neon-green/10 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
                  >
                    <Icon size={12} /> {c?.name} · {type.name}
                    <span onClick={(e) => { e.stopPropagation(); closeApp(mp.id); }} className="ml-1 hover:text-neon-danger"><X size={10} /></span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniAppRunner({ mp, course, onClose }: { mp: CourseMiniProgram; course: Course; onClose: () => void }) {
  const type = APP_TYPES.find(t => t.id === mp.app_type) || APP_TYPES[0];
  const Icon = type.icon;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-neon-green/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center" style={{ background: `${course.color}22`, color: course.color }}>
            <Icon size={16} />
          </div>
          <div>
            <div className="font-bold text-sm">{course.name} · {type.name}</div>
            <div className="text-[10px] text-text-dim font-mono">{type.desc}</div>
          </div>
        </div>
        <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto bg-ink-base/40 rounded-lg border border-neon-green/10 p-4">
        {mp.app_type === 'timetable' && <TimetableApp course={course} />}
        {mp.app_type === 'timer' && <TimerApp course={course} />}
        {mp.app_type === 'calculator' && <CalculatorApp course={course} />}
        {mp.app_type === 'notes' && <NotesApp course={course} />}
      </div>
    </div>
  );
}

// ===== 贝壳课表：USTB SSO 扫码登录 + BYYT 教务课表导入 =====
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

function BeikeTimetable() {
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
    <div className="glass-panel p-4">
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

// ===== 自制小程序：课程表 =====
function TimetableApp({ course }: { course: Course }) {
  const events = useStore(s => s.events);
  const refreshAll = useStore(s => s.refreshAll);
  const slots = events.filter(e => e.course_id === course.id && e.recurrence === 'WEEKLY').sort((a, b) => a.start_at - b.start_at);
  const [newSlot, setNewSlot] = useState({ weekday: 1, start: '08:00', end: '09:30', location: '' });

  const saveSlot = async () => {
    const monday = dayjs().day() === 0 ? dayjs().subtract(6, 'day') : dayjs().subtract(dayjs().day() - 1, 'day');
    const target = monday.add(newSlot.weekday === 0 ? 6 : newSlot.weekday - 1, 'day');
    const [sh, sm] = newSlot.start.split(':').map(Number);
    const [eh, em] = newSlot.end.split(':').map(Number);
    const startAt = target.hour(sh).minute(sm).valueOf();
    const endAt = target.hour(eh).minute(em).valueOf();
    await window.taskAPI.db.events.create({
      title: course.name, start_at: startAt, end_at: endAt, location: newSlot.location,
      course_id: course.id, color: course.color, recurrence: 'WEEKLY'
    });
    await refreshAll();
    setNewSlot({ weekday: 1, start: '08:00', end: '09:30', location: '' });
  };

  const delSlot = async (id: number) => {
    await window.taskAPI.db.events.delete(id);
    await refreshAll();
  };

  return (
    <div className="space-y-4">
      <h4 className="label-tag">本周课表</h4>
      {slots.length === 0 ? <div className="text-text-dim font-mono text-xs">暂无时间段</div> : (
        <div className="space-y-2">
          {slots.map(s => {
            const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(s.start_at).day()];
            return (
              <div key={s.id} className="flex items-center gap-3 p-2 rounded border border-neon-green/10">
                <span className="text-xs font-bold" style={{ color: course.color }}>{wd}</span>
                <span className="text-xs font-mono">{dayjs(s.start_at).format('HH:mm')}-{dayjs(s.end_at).format('HH:mm')}</span>
                <span className="text-xs text-text-secondary flex-1">{s.location}</span>
                <button onClick={() => delSlot(s.id)} className="text-neon-danger hover:opacity-70"><X size={12} /></button>
              </div>
            );
          })}
        </div>
      )}
      <div className="p-3 rounded border border-neon-green/20 space-y-2">
        <div className="text-xs text-neon-green font-bold">+ 添加时段</div>
        <div className="grid grid-cols-4 gap-2">
          <select value={newSlot.weekday} onChange={(e) => setNewSlot({ ...newSlot, weekday: Number(e.target.value) })} className="input-neon text-xs py-1">
            {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          </select>
          <input type="time" value={newSlot.start} onChange={(e) => setNewSlot({ ...newSlot, start: e.target.value })} className="input-neon text-xs py-1" />
          <input type="time" value={newSlot.end} onChange={(e) => setNewSlot({ ...newSlot, end: e.target.value })} className="input-neon text-xs py-1" />
          <input value={newSlot.location} onChange={(e) => setNewSlot({ ...newSlot, location: e.target.value })} placeholder="地点" className="input-neon text-xs py-1" />
        </div>
        <button onClick={saveSlot} className="btn-neon text-xs py-1 w-full">保存</button>
      </div>
    </div>
  );
}

// ===== 自制小程序：番茄钟 =====
function TimerApp({ course }: { course: Course }) {
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'work' | 'break'>('work');

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds(s => s > 0 ? s - 1 : 0), 1000);
    return () => clearInterval(t);
  }, [running]);

  const reset = (m: 'work' | 'break') => {
    setMode(m);
    setSeconds(m === 'work' ? 25 * 60 : 5 * 60);
    setRunning(false);
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-4">
      <div className="text-5xl font-mono font-bold" style={{ color: course.color }}>{fmt(seconds)}</div>
      <div className="flex gap-2">
        <button onClick={() => setRunning(!running)} className="btn-neon px-6">{running ? '暂停' : '开始'}</button>
        <button onClick={() => reset(mode)} className="btn-ghost">重置</button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => reset('work')} className={`text-xs px-3 py-1 rounded border ${mode === 'work' ? 'border-neon-green text-neon-green' : 'border-text-dim/30 text-text-secondary'}`}>专注 25m</button>
        <button onClick={() => reset('break')} className={`text-xs px-3 py-1 rounded border ${mode === 'break' ? 'border-neon-yellow text-neon-yellow' : 'border-text-dim/30 text-text-secondary'}`}>休息 5m</button>
      </div>
      <p className="text-xs text-text-dim font-mono">当前课程：{course.name}</p>
    </div>
  );
}

// ===== 自制小程序：绩点计算器 =====
function CalculatorApp({ course }: { course: Course }) {
  const [items, setItems] = useState<{ name: string; credit: string; score: string }[]>([{ name: course.name, credit: '3', score: '85' }]);

  const gpa = (score: number) => {
    if (score >= 90) return 4.0;
    if (score >= 85) return 3.7;
    if (score >= 82) return 3.3;
    if (score >= 78) return 3.0;
    if (score >= 75) return 2.7;
    if (score >= 72) return 2.3;
    if (score >= 68) return 2.0;
    if (score >= 64) return 1.5;
    if (score >= 60) return 1.0;
    return 0;
  };

  const totalCredit = items.reduce((sum, it) => sum + (Number(it.credit) || 0), 0);
  const weightedGpa = totalCredit > 0 ? items.reduce((sum, it) => sum + gpa(Number(it.score) || 0) * (Number(it.credit) || 0), 0) / totalCredit : 0;
  const avgScore = totalCredit > 0 ? items.reduce((sum, it) => sum + (Number(it.score) || 0) * (Number(it.credit) || 0), 0) / totalCredit : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded border border-neon-green/20 text-center"><div className="text-xs text-text-dim">总学分</div><div className="text-xl font-bold text-neon-green">{totalCredit}</div></div>
        <div className="p-3 rounded border border-neon-yellow/20 text-center"><div className="text-xs text-text-dim">平均绩点</div><div className="text-xl font-bold text-neon-yellow">{weightedGpa.toFixed(2)}</div></div>
        <div className="p-3 rounded border border-neon-green/20 text-center"><div className="text-xs text-text-dim">加权平均分</div><div className="text-xl font-bold text-neon-green">{avgScore.toFixed(1)}</div></div>
      </div>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-4 gap-2">
          <input value={it.name} onChange={(e) => { const next = [...items]; next[idx].name = e.target.value; setItems(next); }} className="input-neon text-xs py-1" placeholder="课程" />
          <input value={it.credit} onChange={(e) => { const next = [...items]; next[idx].credit = e.target.value; setItems(next); }} className="input-neon text-xs py-1" placeholder="学分" />
          <input value={it.score} onChange={(e) => { const next = [...items]; next[idx].score = e.target.value; setItems(next); }} className="input-neon text-xs py-1" placeholder="成绩" />
          <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="btn-ghost text-neon-danger text-xs">删除</button>
        </div>
      ))}
      <button onClick={() => setItems([...items, { name: '', credit: '', score: '' }])} className="btn-neon btn-neon-yellow text-xs w-full">+ 添加课程</button>
    </div>
  );
}

// ===== 自制小程序：课程笔记 =====
function NotesApp({ course }: { course: Course }) {
  const [notes, setNotes] = useState<{ id?: number; content: string; created_at?: number }[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    window.taskAPI.db.courseNotes.list(course.id).then(setNotes);
  }, [course.id]);

  const add = async () => {
    if (!input.trim()) return;
    await window.taskAPI.db.courseNotes.create({ course_id: course.id, content: input });
    setInput('');
    window.taskAPI.db.courseNotes.list(course.id).then(setNotes);
  };

  const del = async (id: number) => {
    await window.taskAPI.db.courseNotes.delete(id);
    window.taskAPI.db.courseNotes.list(course.id).then(setNotes);
  };

  return (
    <div className="space-y-3 h-full flex flex-col">
      <div className="flex gap-2">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="快速记录课堂要点…" rows={2} className="input-neon flex-1" />
        <button onClick={add} className="btn-neon px-3"><Plus size={16} /></button>
      </div>
      <div className="space-y-2 overflow-y-auto flex-1">
        {notes.length === 0 ? <div className="text-text-dim font-mono text-xs text-center py-8">暂无笔记</div> : notes.map(n => (
          <div key={n.id} className="p-2 rounded border border-neon-green/10 text-sm text-text-secondary flex justify-between gap-2">
            <span className="flex-1 whitespace-pre-wrap">{n.content}</span>
            <button onClick={() => n.id && del(n.id)} className="text-neon-danger hover:opacity-70"><X size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
