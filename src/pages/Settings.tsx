import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { Save, Download, Upload, Database, Palette, Info, Cpu, User, CheckCircle2, GraduationCap, Tags, Plus, Trash2, Pencil, Lock, Users, Shield, RefreshCw, ExternalLink, AlertCircle, Sparkles, FileSpreadsheet, Calendar } from 'lucide-react';
import Modal from '@/components/Modal';
import dayjs from 'dayjs';
import type { UserProfile, XlsParseResult, XlsFieldMapping, XlsImportSummary } from '@/types';

interface UpdateSource {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
}

interface PerSourceResult {
  source: UpdateSource;
  result: {
    ok: boolean;
    latestVersion: string | null;
    hasUpdate: boolean;
    reason?: string;
    message?: string;
    downloadUrl?: string | null;
    pageUrl?: string | null;
    sha256?: string | null;
    notes?: string | null;
    forced?: boolean;
  };
}

const PROFILE_FIELDS: { key: keyof UserProfile; label: string; placeholder?: string; type?: string }[] = [
  { key: 'student_id', label: '学号', placeholder: '如：202310030101' },
  { key: 'real_name', label: '姓名', placeholder: '如：张三' },
  { key: 'school', label: '学校', placeholder: '如：中国科学技术大学' },
  { key: 'college', label: '学院', placeholder: '如：信息科学技术学院' },
  { key: 'major', label: '专业', placeholder: '如：计算机科学与技术' },
  { key: 'class_name', label: '班级', placeholder: '如：计科 23-3 班' },
  { key: 'enroll_year', label: '入学年份', type: 'number', placeholder: '如：2023' },
  { key: 'graduate_year', label: '毕业年份', type: 'number', placeholder: '如：2027' },
  { key: 'program', label: '学制', placeholder: '本科 4 年 / 硕士 2 年 / 博士 3 年' },
  { key: 'degree_level', label: '培养层次', placeholder: '本科 / 硕士 / 博士' },
];

// SHA-256 哈希（本地账号密码存储用；file:// 与 localhost 均为安全上下文）
async function sha256(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // 极端环境兜底（理论上不会走到）
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return 'fb_' + h.toString(16) + '_' + text.length;
}

export default function SettingsPage() {
  const settings = useStore(s => s.settings);
  const setSettings = useStore(s => s.setSettings);
  const stats = useStore(s => s.stats);
  const categories = useStore(s => s.categories);
  const userProfile = useStore(s => s.userProfile);
  const refreshAll = useStore(s => s.refreshAll);
  const [theme, setTheme] = useState('neon-green');
  const [semester, setSemester] = useState('2026-Fall');
  const [semesterStart, setSemesterStart] = useState('');

  // 账户资料本地编辑态
  const [profile, setProfile] = useState<Partial<UserProfile>>({});
  const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>([]);
  const [privacyMode, setPrivacyMode] = useState(false);

  // 本地账号（账号名 + 密码）
  const [acctModalOpen, setAcctModalOpen] = useState(false);
  const [acctMode, setAcctMode] = useState<'create' | 'password'>('create');
  const [acctUsername, setAcctUsername] = useState('');
  const [acctOldPwd, setAcctOldPwd] = useState('');
  const [acctPwd, setAcctPwd] = useState('');
  const [acctPwd2, setAcctPwd2] = useState('');
  const [acctBusy, setAcctBusy] = useState(false);

  // UI 状态
  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([]);

  // ===== 软件更新 =====
  const appInfo = useStore(s => s.appInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);
  const [sources, setSources] = useState<UpdateSource[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [srcSaved, setSrcSaved] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [aggregate, setAggregate] = useState<{
    winner: {
      currentVersion: string;
      latestVersion: string | null;
      hasUpdate: boolean;
      downloadUrl?: string | null;
      pageUrl?: string | null;
      sha256?: string | null;
      notes?: string | null;
      forced?: boolean;
      sourceName?: string;
      source?: string;
    } | null;
    perSource: Array<{ source: UpdateSource; result: any }>;
    checkedAt: number;
  } | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [dl, setDl] = useState<{ running: boolean; percent: number; received: number; total: number } | null>(null);
  const [dlPath, setDlPath] = useState<string | null>(null);
  const [updateAuto, setUpdateAuto] = useState(true);
  const [showSrcEditor, setShowSrcEditor] = useState(false);

  // ===== 课表 Excel 导入 =====
  const [xlsOpen, setXlsOpen] = useState(false);
  const [xlsStep, setXlsStep] = useState<'file' | 'mapping' | 'options' | 'preview' | 'done'>('file');
  const [xlsBusy, setXlsBusy] = useState(false);
  const [xlsFile, setXlsFile] = useState<string | null>(null);
  const [xlsParsed, setXlsParsed] = useState<XlsParseResult | null>(null);
  const [xlsMapping, setXlsMapping] = useState<XlsFieldMapping>({ className: -1, teacher: -1, weeks: -1, day: -1, period: -1, location: -1 });
  const [xlsXn, setXlsXn] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);
  const [xlsXq, setXlsXq] = useState<'1' | '2'>(((new Date().getMonth() + 1) >= 8 || (new Date().getMonth() + 1) <= 1) ? '1' : '2');
  const [xlsStart, setXlsStart] = useState(dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD')); // 本周一
  const [xlsReplace, setXlsReplace] = useState(true);
  const [xlsSummary, setXlsSummary] = useState<XlsImportSummary | null>(null);
  const [xlsMsg, setXlsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [xlsLastSync, setXlsLastSync] = useState<{ lastSync: number; courseCount: number } | null>(null);

  const resetXlsWizard = async () => {
    setXlsStep('file'); setXlsBusy(false); setXlsFile(null); setXlsParsed(null);
    setXlsMapping({ className: -1, teacher: -1, weeks: -1, day: -1, period: -1, location: -1 });
    setXlsSummary(null); setXlsMsg(null);
    try { setXlsLastSync(await window.taskAPI.xls.lastImport()); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (xlsOpen) void resetXlsWizard();
  }, [xlsOpen]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.taskAPI.updater.config();
        setSources(cfg.sources || []);
        setActiveIndex(cfg.activeIndex ?? 0);
        setUpdateAuto(cfg.autoCheck);
      } catch { /* 忽略 */ }
    })();
  }, []);

  // 下载进度订阅
  useEffect(() => {
    const off = window.taskAPI.updater.onProgress((p) => {
      if (p.phase === 'start') setDl({ running: true, percent: 0, received: 0, total: p.total || 0 });
      else if (p.phase === 'progress') setDl({ running: true, percent: p.percent || 0, received: p.received || 0, total: p.total || 0 });
      else if (p.phase === 'done') {
        setDl({ running: false, percent: 100, received: p.received || 0, total: p.total || 0 });
        setDlPath(p.path || null);
      }
    });
    return () => { off?.(); };
  }, []);

  const saveSources = async (next: UpdateSource[], nextActive: number) => {
    try {
      const r = await window.taskAPI.updater.setSources({ sources: next, activeIndex: nextActive });
      setSources(r.sources);
      setActiveIndex(r.activeIndex);
      setSrcSaved(true);
      setTimeout(() => setSrcSaved(false), 1800);
      setUpdateMsg(null);
    } catch (e: any) {
      setUpdateMsg(e?.message || '保存失败');
    }
  };

  const addSource = () => {
    const blank: UpdateSource = { name: `源 ${sources.length + 1}`, url: '', enabled: true, primary: false };
    setSources([...sources, blank]);
    setShowSrcEditor(true);
  };
  const updateSourceLocal = (idx: number, patch: Partial<UpdateSource>) => {
    setSources((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeSource = (idx: number) => {
    if (!confirm(`删除源「${sources[idx]?.name || '源 ' + (idx + 1)}」？`)) return;
    const next = sources.filter((_, i) => i !== idx);
    const safe = Math.max(0, Math.min(activeIndex, next.length - 1));
    void saveSources(next, safe);
  };
  const setAsPrimary = async (idx: number) => {
    await saveSources(sources.map((s, i) => ({ ...s, primary: i === idx })), idx);
  };
  const toggleEnabled = async (idx: number) => {
    const next = sources.map((s, i) => (i === idx ? { ...s, enabled: !s.enabled } : s));
    if (next.every((s) => !s.enabled)) {
      alert('至少保留一个启用的源');
      return;
    }
    await saveSources(next, activeIndex);
  };

  const toggleAutoCheck = async (v: boolean) => {
    setUpdateAuto(v);
    try { await window.taskAPI.updater.setAutoCheck(v); } catch { /* 忽略 */ }
  };

  const checkUpdate = async () => {
    setUpdateChecking(true);
    setUpdateMsg(null);
    setDl(null);
    setDlPath(null);
    try {
      const r = await window.taskAPI.updater.checkAll();
      setAggregate(r);
      // 把 winner 推给全局 UpdateNotification
      if (r.winner) {
        const perSource = r.perSource.map(({ source, result }) => ({
          name: source.name,
          url: source.url,
          ok: result.ok,
          latestVersion: result.latestVersion,
          reason: result.reason,
          message: result.message,
        }));
        setUpdateInfo({ ...r.winner, perSource } as any);
      } else {
        setUpdateInfo(null);
      }
      const failed = r.perSource.filter((p) => !p.result.ok && p.result.message).map((p) => `${p.source.name}: ${p.result.message}`);
      if (!r.winner && failed.length) setUpdateMsg(failed.join('\n'));
    } catch (e: any) {
      setUpdateMsg(e?.message || '检查更新失败');
    } finally {
      setUpdateChecking(false);
    }
  };

  const startDownload = async () => {
    const w = aggregate?.winner;
    if (!w?.downloadUrl) return;
    setUpdateMsg(null);
    setDl({ running: true, percent: 0, received: 0, total: 0 });
    try {
      const r = await window.taskAPI.updater.download({
        url: w.downloadUrl,
        version: w.latestVersion || 'latest',
        sha256: w.sha256 || null,
      });
      if (!r.ok) {
        setDl(null);
        setUpdateMsg(r.error || '下载失败');
      } else {
        setDlPath(r.path || null);
      }
    } catch (e: any) {
      setDl(null);
      setUpdateMsg(e?.message || '下载失败');
    }
  };

  const runInstaller = async () => {
    if (!dlPath) return;
    const r = await window.taskAPI.updater.install(dlPath);
    if (!r.ok) setUpdateMsg(r.error || '启动安装包失败');
  };

  const openReleasePage = async (url?: string | null) => {
    const u = url || aggregate?.winner?.pageUrl || sources[activeIndex]?.url || '';
    if (!u) return;
    const r = await window.taskAPI.updater.openExternal(u);
    if (!r.ok) setUpdateMsg(r.error || '打开链接失败');
  };

  /** GitHub 连不上时的解决教程（dogfight360 hosts 修复） */
  const openGithubFix = async () => {
    const r = await window.taskAPI.updater.openExternal('https://www.dogfight360.com/blog/18682/');
    if (!r.ok) setUpdateMsg(r.error || '打开链接失败');
  };

  const ignoreVersion = async () => {
    const w = aggregate?.winner;
    if (!w?.latestVersion) return;
    await window.taskAPI.updater.skipVersion(w.latestVersion);
    setAggregate((a) => (a && a.winner ? { ...a, winner: { ...a.winner } as any } : a));
  };

  useEffect(() => {
    if (settings.theme) setTheme(settings.theme);
    if (settings.semester) setSemester(settings.semester);
    if (settings.semester_start) {
      const d = new Date(Number(settings.semester_start));
      setSemesterStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  }, [settings]);

  useEffect(() => {
    if (userProfile) {
      setProfile({ ...userProfile });
      setPrivacyMode(!!userProfile.privacy_mode);
      try {
        const cf = JSON.parse(userProfile.custom_fields || '[]');
        setCustomFields(Array.isArray(cf) ? cf : []);
      } catch { setCustomFields([]); }
    }
  }, [userProfile]);

  const save = async () => {
    const updates: [string, string][] = [
      ['theme', theme],
      ['semester', semester],
      ['semester_start', semesterStart ? String(new Date(semesterStart).getTime()) : ''],
    ];
    await Promise.all(updates.map(([k, v]) => window.taskAPI.db.settings.set(k, v)));
    const semesterStartMs = semesterStart ? new Date(semesterStart).getTime() : 0;
    setSettings({ ...settings, theme, semester, semester_start: String(semesterStartMs) });

    // 保存用户资料（不动账号密码字段）
    const { username, password_hash, ...profileFields } = profile as Partial<UserProfile>;
    const payload: Partial<UserProfile> = {
      ...profileFields,
      username: userProfile?.username ?? null,
      custom_fields: JSON.stringify(customFields),
      privacy_mode: privacyMode ? 1 : 0,
    };
    if (userProfile?.id) {
      await window.taskAPI.db.userProfiles.update(userProfile.id, payload);
    } else {
      await window.taskAPI.db.userProfiles.create({ ...payload, is_active: 1 });
    }
    await refreshAll();
    alert('设置已保存');
  };

  // ===== 本地账号：设置 / 修改密码 =====
  const openAcctModal = (mode: 'create' | 'password') => {
    setAcctMode(mode);
    setAcctUsername(userProfile?.username || '');
    setAcctOldPwd('');
    setAcctPwd('');
    setAcctPwd2('');
    setAcctModalOpen(true);
  };

  const saveAccount = async () => {
    if (acctBusy) return;
    setAcctBusy(true);
    try {
      if (acctMode === 'create') {
        if (!acctUsername.trim()) { alert('请输入账号名'); return; }
        if (acctPwd.length < 4) { alert('密码至少 4 位'); return; }
        if (acctPwd !== acctPwd2) { alert('两次输入的密码不一致'); return; }
        const hash = await sha256(acctPwd);
        if (userProfile?.id) {
          await window.taskAPI.db.userProfiles.update(userProfile.id, { ...userProfile, username: acctUsername.trim(), password_hash: hash });
        } else {
          await window.taskAPI.db.userProfiles.create({ username: acctUsername.trim(), password_hash: hash, is_active: 1, custom_fields: [] });
        }
      } else {
        // 修改 / 设置 / 清除密码
        if (userProfile?.password_hash) {
          const oldHash = await sha256(acctOldPwd);
          if (oldHash !== userProfile.password_hash) { alert('原密码不正确'); return; }
        }
        if (acctPwd !== acctPwd2) { alert('两次输入的新密码不一致'); return; }
        if (acctPwd && acctPwd.length < 4) { alert('新密码至少 4 位'); return; }
        const hash = acctPwd ? await sha256(acctPwd) : ''; // 留空 = 清除密码
        await window.taskAPI.db.userProfiles.update(userProfile!.id, { ...userProfile, password_hash: hash });
      }
      await refreshAll();
      setAcctModalOpen(false);
    } catch (e: any) {
      alert('保存失败：' + (e?.message || e));
    } finally {
      setAcctBusy(false);
    }
  };

  // ===== 数据管理：全量备份 / 恢复 / 完整性检查 =====
  const [backupStatus, setBackupStatus] = useState<{
    integrity: string; foreignKeyViolations: number; journalMode: string;
    tables: Record<string, number>; dbSizeBytes: number; lastAutoBackup: string | null;
  } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const exportBackup = async () => {
    setBackupBusy(true); setBackupMsg(null);
    try {
      const r = await window.taskAPI.backup.export();
      if (r.ok) {
        const total = Object.values(r.counts || {}).reduce((a, b) => a + Number(b), 0);
        setBackupMsg({ ok: true, text: `备份已导出：${r.path}（共 ${total} 条记录）` });
      } else if (!r.canceled) {
        setBackupMsg({ ok: false, text: '导出失败' });
      }
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `导出失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  const importBackup = async () => {
    if (!confirm(
      '从备份导入将【覆盖】当前所有数据（课程、日历、项目、账户、设置）。\n\n' +
      '· 导入前会自动创建安全备份（pre-import-*.db），失败可手动恢复\n' +
      '· 导入在事务内执行，任何异常都会整体回滚\n\n确定继续？'
    )) return;
    setBackupBusy(true); setBackupMsg(null);
    try {
      const r = await window.taskAPI.backup.import();
      if (r.ok) {
        const total = Object.values(r.restored || {}).reduce((a, b) => a + Number(b), 0);
        setBackupMsg({ ok: true, text: `已恢复 ${total} 条记录（安全备份：${r.safetyBackupPath || '已跳过'}）` });
        await refreshAll();
      } else if (!r.canceled) {
        setBackupMsg({ ok: false, text: `导入失败：${r.error}` });
      }
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `导入失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  const checkIntegrity = async () => {
    setBackupBusy(true); setBackupMsg(null);
    try {
      const s = await window.taskAPI.backup.status();
      setBackupStatus(s);
      const ok = s.integrity === 'ok' && s.foreignKeyViolations === 0;
      setBackupMsg({
        ok,
        text: ok
          ? `数据库完整性正常（${s.journalMode.toUpperCase()} 模式，外键零违规）`
          : `发现问题：完整性=${s.integrity}，外键违规=${s.foreignKeyViolations}，请立即导出备份并联系开发者`,
      });
    } catch (e: any) {
      setBackupMsg({ ok: false, text: `检查失败：${e?.message || e}` });
    } finally { setBackupBusy(false); }
  };

  const switchProfile = async (id: number) => {
    await window.taskAPI.db.userProfiles.setActive(id);
    await refreshAll();
    setSwitchModalOpen(false);
  };

  const createNewProfile = async () => {
    const name = prompt('新账户姓名（可选）：') || '新用户';
    const p = await window.taskAPI.db.userProfiles.create({ real_name: name, is_active: 1 });
    await window.taskAPI.db.userProfiles.setActive((p as UserProfile).id);
    await refreshAll();
    setSwitchModalOpen(false);
  };

  // 分类编辑
  const [catModal, setCatModal] = useState<{ open: boolean; id: number | null; name: string; color: string; emoji: string }>({ open: false, id: null, name: '', color: '#00FF88', emoji: '' });
  const editCategory = (c: any) => {
    setCatModal(c ? { open: true, id: c.id, name: c.name, color: c.color, emoji: c.emoji || '' } : { open: true, id: null, name: '', color: '#00FF88', emoji: '' });
  };
  const saveCategory = async () => {
    if (!catModal.name.trim()) { alert('请输入分类名'); return; }
    if (catModal.id) {
      await window.taskAPI.db.categories.update(catModal.id, { name: catModal.name, color: catModal.color, emoji: catModal.emoji || null });
    } else {
      await window.taskAPI.db.categories.create({ name: catModal.name, color: catModal.color, emoji: catModal.emoji || null });
    }
    await refreshAll();
    setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' });
  };
  const deleteCategory = async (id: number) => {
    if (!confirm('删除该分类？关联事件会保留但失去分类。')) return;
    await window.taskAPI.db.categories.delete(id);
    await refreshAll();
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 pb-24">
      <div>
        <p className="label-tag">SETTINGS·系统配置</p>
        <h2 className="text-2xl font-bold mt-1">设置</h2>
      </div>

      {/* 账户 */}
      <Section icon={<User size={14} />} title="账户">
        <div className="flex items-center gap-4 p-3 rounded-md bg-ink-base/40 border border-neon-green/15">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold font-mono shrink-0"
            style={{
              background: userProfile?.username ? 'linear-gradient(135deg, #00FF88, #00FFC8)' : '#0A0F0D',
              color: userProfile?.username ? '#000' : '#4A5C52',
              boxShadow: userProfile?.username ? '0 0 16px #00FF8866' : 'none',
              border: userProfile?.username ? 'none' : '1px solid #4A5C5255',
            }}
          >
            {userProfile?.username ? userProfile.username[0].toUpperCase() : '?'}
          </div>
          <div className="flex-1 min-w-0">
            {userProfile?.username ? (
              <>
                <div className="font-bold text-neon-green flex items-center gap-2">
                  {userProfile.username}
                  <CheckCircle2 size={14} className="text-neon-green" />
                </div>
                <div className="font-mono text-[10px] text-text-dim mt-0.5">
                  {userProfile.password_hash ? '本地账号 · 密码已设置' : '本地账号 · 未设置密码'}
                </div>
              </>
            ) : (
              <>
                <div className="text-text-secondary">未设置账号</div>
                <div className="font-mono text-[10px] text-text-dim mt-0.5">设置账号名和密码，学籍信息保存在本机</div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {userProfile?.username ? (
              <button onClick={() => openAcctModal('password')} className="btn-ghost"><Lock size={14} /> {userProfile.password_hash ? '修改密码' : '设置密码'}</button>
            ) : (
              <button onClick={() => openAcctModal('create')} className="btn-neon"><Lock size={14} /> 设置账号密码</button>
            )}
            <button onClick={async () => { const list = await window.taskAPI.db.userProfiles.list(); setAllProfiles(list); setSwitchModalOpen(true); }} className="btn-ghost"><Users size={14} /> 切换账户</button>
            {userProfile && (
              <button
                onClick={async () => {
                  if (!confirm(`删除当前账户「${userProfile.username || userProfile.real_name || '未命名'}」？\n学籍信息将被清除。`)) return;
                  await window.taskAPI.db.userProfiles.delete(userProfile.id);
                  const rest = await window.taskAPI.db.userProfiles.list();
                  if (rest.length) await window.taskAPI.db.userProfiles.setActive((rest[0] as UserProfile).id);
                  await refreshAll();
                }}
                className="btn-ghost text-neon-danger"
                title="删除当前账户资料"
              >
                <Trash2 size={14} /> 删除账户
              </button>
            )}
          </div>
        </div>

        <div className="pt-4 border-t border-neon-green/10">
          <div className="flex items-center gap-2 mb-3">
            <GraduationCap size={14} className="text-neon-green" />
            <span className="label-tag">学籍信息</span>
            <span className="text-[10px] text-text-dim font-mono ml-2">填完之后侧边栏会显示「姓名 · 学号」</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {PROFILE_FIELDS.map(f => (
              <div key={f.key}>
                <label className="text-xs text-text-secondary block mb-1">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={profile[f.key] || ''}
                  onChange={(e) => setProfile({ ...profile, [f.key]: f.type === 'number' && e.target.value ? Number(e.target.value) : e.target.value })}
                  placeholder={f.placeholder}
                  className="input-neon w-full"
                />
              </div>
            ))}
          </div>

          {/* 自定义字段 */}
          <div className="mt-4">
            <span className="label-tag block mb-2">自定义字段</span>
            {customFields.map((cf, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input value={cf.key} onChange={(e) => {
                  const next = [...customFields]; next[idx].key = e.target.value; setCustomFields(next);
                }} placeholder="字段名" className="input-neon flex-1" />
                <input value={cf.value} onChange={(e) => {
                  const next = [...customFields]; next[idx].value = e.target.value; setCustomFields(next);
                }} placeholder="字段值" className="input-neon flex-1" />
                <button onClick={() => setCustomFields(customFields.filter((_, i) => i !== idx))} className="btn-ghost text-neon-danger"><Trash2 size={14} /></button>
              </div>
            ))}
            <button onClick={() => setCustomFields([...customFields, { key: '', value: '' }])} className="btn-neon btn-neon-yellow text-xs"><Plus size={12} /> 添加字段</button>
          </div>

          {/* 隐私模式 */}
          <div className="mt-4 flex items-center gap-3 p-3 rounded-md bg-ink-base/40 border border-neon-green/10">
            <Shield size={16} className={privacyMode ? 'text-neon-green' : 'text-text-dim'} />
            <div className="flex-1">
              <div className="text-sm text-text-secondary">隐私模式</div>
              <div className="text-[10px] text-text-dim font-mono">开启后敏感字段将标记为加密存储（当前为演示标记）</div>
            </div>
            <input type="checkbox" checked={privacyMode} onChange={(e) => setPrivacyMode(e.target.checked)} className="w-5 h-5 accent-neon-green" />
          </div>
        </div>
      </Section>

      {/* 主题 */}
      <Section icon={<Palette size={14} />} title="外观">
        <Row label="主题预设">
          <select value={theme} onChange={(e) => setTheme(e.target.value)} className="input-neon w-48">
            <option value="neon-green">霓虹绿（默认）</option>
            <option value="neon-yellow">霓虹黄</option>
            <option value="mixed">绿黄混合</option>
          </select>
        </Row>
        <Row label="当前学期">
          <input value={semester} onChange={(e) => setSemester(e.target.value)} className="input-neon w-48" />
        </Row>
        <Row label="开学日（用于周次计算）">
          <input type="date" value={semesterStart} onChange={(e) => setSemesterStart(e.target.value)} className="input-neon w-48" />
          <span className="text-[10px] text-text-dim font-mono ml-2">月视图头部显示「第 X 周」</span>
        </Row>
      </Section>

      {/* 日程分类 */}
      <Section icon={<Tags size={14} />} title="日程分类">
        <div className="space-y-1.5">
          {categories.length === 0 && <div className="text-text-dim font-mono text-xs py-4 text-center">暂无分类，点击下方添加</div>}
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-md bg-ink-base/40 border border-neon-green/15 hover:border-neon-green/40 transition-colors">
              <div className="w-4 h-4 rounded shrink-0" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm text-text-primary">{c.emoji && <span className="mr-1">{c.emoji}</span>}{c.name}</div>
                <div className="font-mono text-[10px] text-text-dim">{c.color}</div>
              </div>
              <button onClick={() => editCategory(c)} className="btn-ghost text-xs" title="编辑"><Pencil size={12} /></button>
              <button onClick={() => deleteCategory(c.id)} className="btn-ghost text-xs text-neon-danger" title="删除"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-neon-green/10">
          <button onClick={() => editCategory(null)} className="btn-neon btn-neon-yellow"><Plus size={14} /> 新建分类</button>
        </div>
      </Section>

      {/* 微信小程序嵌套 */}
      <Section icon={<Cpu size={14} />} title="微信小程序嵌套">
        <div className="p-3 rounded-md bg-neon-yellow/5 border border-neon-yellow/20 text-xs text-text-secondary">
          <strong className="text-neon-yellow">说明：</strong>
          当前采用「自制小程序 UI」方案（课程级课表工具），不依赖微信客户端。
        </div>
        <Row label="小程序配置入口">
          <span className="text-sm text-text-secondary">前往「课程详情 → 上课时间」右侧的小程序抽屉</span>
        </Row>
      </Section>

      {/* 数据 */}
      <Section icon={<Database size={14} />} title="数据管理">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="课程" value={stats?.totalCourses || 0} />
          <Stat label="要求" value={stats?.totalReq || 0} />
          <Stat label="项目" value={stats?.activeProjects || 0} />
        </div>
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 备份为单个 JSON 文件，包含<strong className="text-neon-green">全部 10 张表</strong>（课程/作业/日历/项目/账户/备注/小程序/设置），带 SHA-256 校验和，可跨设备迁移</div>
          <div>· 每天首次启动自动滚动备份（保留最近 7 份）；导入前会再强制安全备份一份</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportBackup} disabled={backupBusy} className="btn-neon"><Download size={14} /> 导出全量备份</button>
          <button onClick={importBackup} disabled={backupBusy} className="btn-neon btn-neon-yellow"><Upload size={14} /> 从备份导入</button>
          <button onClick={checkIntegrity} disabled={backupBusy} className="btn-ghost"><Shield size={14} /> 完整性检查</button>
        </div>
        {backupMsg && (
          <div className={`mt-3 p-3 rounded-md border font-mono text-xs whitespace-pre-wrap break-all ${backupMsg.ok ? 'border-neon-green/40 text-neon-green bg-neon-green/5' : 'border-neon-danger/50 text-neon-danger bg-neon-danger/5'}`}>
            {backupMsg.ok ? '✓ ' : '✗ '}{backupMsg.text}
          </div>
        )}
        {backupStatus && (
          <div className="mt-3 rounded-md border border-neon-green/15 bg-ink-base/40 p-3 font-mono text-[11px] space-y-2">
            <div className="flex justify-between"><span className="text-text-dim">完整性检查</span><span className={backupStatus.integrity === 'ok' ? 'text-neon-green' : 'text-neon-danger'}>{backupStatus.integrity}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">外键违规</span><span className={backupStatus.foreignKeyViolations === 0 ? 'text-neon-green' : 'text-neon-danger'}>{backupStatus.foreignKeyViolations}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">日志模式</span><span className="text-text-secondary">{String(backupStatus.journalMode).toUpperCase()}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">数据库大小</span><span className="text-text-secondary">{(backupStatus.dbSizeBytes / 1024).toFixed(1)} KB</span></div>
            <div className="flex justify-between"><span className="text-text-dim">最近自动备份</span><span className="text-text-secondary">{backupStatus.lastAutoBackup || '—'}</span></div>
            <div className="pt-2 border-t border-neon-green/10 grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(backupStatus.tables).map(([t, c]) => (
                <div key={t} className="flex justify-between"><span className="text-text-dim">{t}</span><span className="text-text-secondary">{c}</span></div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* 课表 Excel 导入 */}
      <Section icon={<FileSpreadsheet size={14} />} title="课表导入 (Excel)">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 支持 <strong className="text-neon-green">.xlsx / .xls / .csv</strong>；每行一节课，含「课程名称/教师/周次/星期/节次/教室」列</div>
          <div>· 多数教务系统导出与「超级课程表」导出的 xlsx 都能直接识别列头；识别错的可在向导里手动指定</div>
          <div>· 导入会<strong className="text-neon-yellow">替换之前的课表导入</strong>（教务 / Excel）；手动添加的课程/作业不受影响</div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setXlsOpen(true)} className="btn-neon"><FileSpreadsheet size={14} /> 从 Excel 导入课表</button>
          {xlsLastSync && xlsLastSync.courseCount > 0 ? (
            <span className="font-mono text-[10px] text-text-dim">
              上次导入 {xlsLastSync.courseCount} 门课 · {xlsLastSync.lastSync ? dayjs(xlsLastSync.lastSync).format('YYYY-MM-DD HH:mm') : '—'}
            </span>
          ) : (
            <span className="font-mono text-[10px] text-text-dim">尚未导入</span>
          )}
        </div>
      </Section>

      {/* 软件更新 */}
      <Section icon={<RefreshCw size={14} />} title="软件更新">
        <Row label="当前版本">
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-neon-green">v{appInfo?.version || '—'}</span>
            {aggregate?.winner?.hasUpdate && (
              <span className="px-2 py-0.5 rounded text-[10px] bg-neon-yellow/15 text-neon-yellow border border-neon-yellow/40">
                新版本 v{aggregate.winner.latestVersion} 可用
              </span>
            )}
          </div>
        </Row>

        <Row label="更新源">
          <div className="space-y-2">
            {/* 源列表（紧凑） */}
            <div className="space-y-1">
              {sources.length === 0 ? (
                <div className="font-mono text-[10px] text-text-dim">尚未配置更新源，点下方「+ 添加源」新增。</div>
              ) : sources.map((s, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[11px] p-2 rounded border border-neon-green/15 bg-ink-base/40">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={() => toggleEnabled(i)}
                    className="accent-[#00FF88]"
                    title={s.enabled ? '已启用' : '已禁用'}
                  />
                  {s.primary ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-neon-green/15 text-neon-green border border-neon-green/40">主</span>
                  ) : (
                    <button onClick={() => setAsPrimary(i)} className="px-1.5 py-0.5 rounded text-[9px] border border-text-dim/30 text-text-dim hover:border-neon-green hover:text-neon-green" title="设为主源">置主</button>
                  )}
                  <input
                    value={s.name}
                    onChange={(e) => updateSourceLocal(i, { name: e.target.value })}
                    placeholder="源名称"
                    className="input-neon w-32 py-0.5 px-2 text-xs"
                  />
                  <input
                    value={s.url}
                    onChange={(e) => updateSourceLocal(i, { url: e.target.value })}
                    placeholder="版本清单 JSON 直链 / 网盘分享页"
                    className="input-neon flex-1 py-0.5 px-2 text-xs"
                  />
                  <button onClick={() => removeSource(i)} className="btn-ghost text-neon-danger p-1" title="删除该源">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={addSource} className="btn-ghost text-xs py-1">
                <Plus size={12} /> 添加源
              </button>
              <button
                onClick={() => saveSources(sources, activeIndex)}
                disabled={!sources.length}
                className="btn-neon text-xs py-1"
              >
                {srcSaved ? <><CheckCircle2 size={12} className="text-neon-green" /> 已保存</> : <><Save size={12} /> 保存源</>}
              </button>
              <span className="font-mono text-[10px] text-text-dim">
                内置两个源：<strong className="text-neon-green">StarOS（nrsc.games）</strong>为主源，
                <strong className="text-neon-green">GitHub leastversion</strong>为备用镜像；
                检查更新时会两个一起查，取版本最高的那个升级。
              </span>
            </div>

            <details className="font-mono text-[10px] text-text-dim">
              <summary className="cursor-pointer hover:text-neon-green">支持的清单格式（参考）</summary>
              <pre className="mt-1 p-2 rounded bg-ink-base/60 border border-neon-green/10 whitespace-pre-wrap">
{`{
  "version": "1.2.0",
  "notes": "更新说明",
  "url": "安装包直链（application/octet-stream）",
  "page": "网盘分享页（兜底入口）",
  "sha256": "可选校验和"
}`}
              </pre>
            </details>
          </div>
        </Row>

        <Row label="启动时自动检查">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={updateAuto} onChange={(e) => toggleAutoCheck(e.target.checked)} className="accent-[#00FF88]" />
            <span className="text-xs text-text-secondary">
              开启后每次启动会<strong className="text-neon-yellow">查所有启用的源</strong>，发现新版本会<strong className="text-neon-yellow">在右下角弹窗告知</strong>；左侧「设置」也会有 NEW 标记。
            </span>
          </label>
        </Row>

        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={checkUpdate} disabled={updateChecking} className="btn-neon">
            <RefreshCw size={14} className={updateChecking ? 'animate-spin' : ''} /> {updateChecking ? '检查中…' : '检查所有源'}
          </button>
          {aggregate?.winner?.hasUpdate && aggregate.winner.downloadUrl && !dlPath && (
            <button onClick={startDownload} disabled={!!dl?.running} className="btn-neon btn-neon-yellow">
              <Download size={14} /> {dl?.running ? '下载中…' : `下载 v${aggregate.winner.latestVersion}`}
            </button>
          )}
          {aggregate?.winner && (aggregate.winner.pageUrl || aggregate.winner.source) && (
            <button onClick={() => openReleasePage(aggregate?.winner?.pageUrl)} className="btn-ghost">
              <ExternalLink size={14} /> 打开发布页
            </button>
          )}
          {!!dlPath && (
            <button onClick={runInstaller} className="btn-neon btn-neon-yellow">
              <Sparkles size={14} /> 立即安装并重启
            </button>
          )}
          {aggregate?.winner?.hasUpdate && (
            <button onClick={ignoreVersion} className="btn-ghost text-text-dim">忽略 v{aggregate.winner.latestVersion}</button>
          )}
          <button onClick={openGithubFix} className="btn-ghost text-text-dim" title="GitHub 源打不开 / 下载慢的解决教程（主源 nrsc.games 不受影响）">
            <ExternalLink size={14} /> GitHub 源打不开？点这
          </button>
        </div>

        {/* 下载进度 */}
        {dl && (
          <div className="mt-1 space-y-1">
            <div className="progress-bar">
              <div style={{ width: `${dl.running || dl.percent < 100 ? dl.percent : 100}%`, background: '#FFD60A', boxShadow: '0 0 6px #FFD60A' }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-text-dim">
              <span>{dl.running ? '下载中' : '下载完成'}</span>
              <span>
                {dl.percent}%{dl.total ? ` · ${(dl.received / 1048576).toFixed(1)} / ${(dl.total / 1048576).toFixed(1)} MB` : dl.received ? ` · ${(dl.received / 1048576).toFixed(1)} MB` : ''}
              </span>
            </div>
          </div>
        )}

        {/* 多源结果汇总 */}
        {aggregate && aggregate.perSource.length > 0 && !updateMsg && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/15 bg-ink-base/40 space-y-1">
            <div className="font-mono text-[10px] text-text-dim mb-1">
              {aggregate.checkedAt ? `检查时间：${dayjs(aggregate.checkedAt).format('YYYY-MM-DD HH:mm:ss')}` : '本次检查结果'}
            </div>
            {aggregate.perSource.map(({ source, result }, i) => (
              <div key={i} className="flex justify-between font-mono text-[10px]">
                <span className="text-text-secondary truncate pr-2">{source.name}{source.primary ? ' (主)' : ''}</span>
                <span className={result.ok ? 'text-neon-green' : 'text-neon-danger'}>
                  {result.ok
                    ? `v${result.latestVersion}${result.hasUpdate ? ' · 有更新' : ' · 已是最新'}`
                    : (result.reason || '失败') + (result.message ? ` · ${result.message}` : '')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 错误 */}
        {updateMsg && (
          <div className="mt-1 p-3 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs whitespace-pre-wrap break-all">
            <div>✗ {updateMsg}</div>
            <button onClick={openGithubFix} className="mt-2 underline underline-offset-2 hover:opacity-80">
              GitHub 源连不上？点这（解决教程）
            </button>
          </div>
        )}

        {/* 已是最新 */}
        {aggregate && !aggregate.winner && !updateMsg && aggregate.perSource.some((p) => p.result.ok) && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/40 bg-neon-green/5 font-mono text-xs text-neon-green flex items-center gap-2">
            <CheckCircle2 size={14} /> 已是最新版本（v{appInfo?.version || '—'}）
          </div>
        )}

        {dlPath && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/40 bg-neon-green/5 font-mono text-[11px] text-neon-green break-all">
            ✓ 安装包已下载：{dlPath}
          </div>
        )}
      </Section>

      {/* 关于 */}
      <Section icon={<Info size={14} />} title="关于">
        <div className="space-y-1 text-sm font-mono">
          <div className="flex"><span className="w-28 text-text-dim">应用名称</span><span className="text-neon-green">TaskManager</span></div>
          <div className="flex"><span className="w-28 text-text-dim">版本</span><span>v{appInfo?.version || '—'}</span></div>
          <div className="flex"><span className="w-28 text-text-dim">技术栈</span><span>Electron · React · TS · better-sqlite3 · Tailwind</span></div>
          <div className="flex"><span className="w-28 text-text-dim">UI 设计</span><span>Neon · OKX-inspired · Glassmorphism</span></div>
          <div className="flex"><span className="w-28 text-text-dim">开发者</span><span>豆芽</span></div>
        </div>
      </Section>

      <div className="fixed bottom-0 right-0 left-60 bg-ink-base/80 backdrop-blur p-3 border-t border-neon-green/15 flex justify-end">
        <button onClick={save} className="btn-neon"><Save size={14} /> 保存所有设置</button>
      </div>

      {/* 账号密码弹窗 */}
      {acctModalOpen && (
        <Modal
          title={acctMode === 'create' ? '设置账号密码' : userProfile?.password_hash ? '修改密码' : '设置密码'}
          onClose={() => setAcctModalOpen(false)}
          footer={<>
            <button onClick={() => setAcctModalOpen(false)} className="btn-ghost mr-auto">取消</button>
            <button onClick={saveAccount} disabled={acctBusy} className="btn-neon">{acctBusy ? '保存中…' : '保存'}</button>
          </>}
        >
          <div className="space-y-3 text-left">
            {acctMode === 'create' && (
              <Field label="账号名 *">
                <input value={acctUsername} onChange={(e) => setAcctUsername(e.target.value)} className="input-neon" placeholder="如：douya / 学号 / 昵称" autoFocus />
              </Field>
            )}
            {acctMode === 'password' && userProfile?.password_hash && (
              <Field label="原密码 *">
                <input type="password" value={acctOldPwd} onChange={(e) => setAcctOldPwd(e.target.value)} className="input-neon" placeholder="输入当前密码" autoFocus />
              </Field>
            )}
            <Field label={acctMode === 'password' && userProfile?.password_hash ? '新密码（留空 = 清除密码）' : '密码 *'}>
              <input type="password" value={acctPwd} onChange={(e) => setAcctPwd(e.target.value)} className="input-neon" placeholder="至少 4 位" />
            </Field>
            <Field label="确认密码">
              <input type="password" value={acctPwd2} onChange={(e) => setAcctPwd2(e.target.value)} className="input-neon" placeholder="再输入一次" />
            </Field>
            <p className="text-[10px] text-text-dim font-mono pt-1">账号和密码仅保存在本机数据库（密码以 SHA-256 哈希存储），不上传任何服务器。</p>
          </div>
        </Modal>
      )}

      {/* 切换账户弹窗 */}
      {switchModalOpen && (
        <Modal title="切换账户" onClose={() => setSwitchModalOpen(false)} footer={<button onClick={() => setSwitchModalOpen(false)} className="btn-ghost">关闭</button>}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {allProfiles.map(p => (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-md border ${p.is_active ? 'border-neon-green bg-neon-green/5' : 'border-neon-green/10 bg-ink-base/40'}`}>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-green to-neon-green-deep flex items-center justify-center text-ink-base font-bold">{p.real_name?.[0] || '?'}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{p.real_name || '未命名用户'}</div>
                  <div className="font-mono text-[10px] text-text-dim">{p.student_id || '无学号'} · {p.school || '未填写学校'}</div>
                </div>
                {p.is_active ? <span className="text-neon-green text-xs font-mono">当前</span> : <button onClick={() => switchProfile(p.id)} className="btn-neon text-xs">切换</button>}
              </div>
            ))}
            <button onClick={createNewProfile} className="w-full py-2 border border-dashed border-neon-green/30 rounded-md text-neon-green text-sm hover:bg-neon-green/5"><Plus size={14} className="inline mr-1" /> 新建本地账户</button>
          </div>
        </Modal>
      )}

      {/* 分类编辑弹窗 */}
      {catModal.open && (
        <Modal title={catModal.id ? '编辑分类' : '新建分类'} onClose={() => setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' })} footer={<><button onClick={() => setCatModal({ open: false, id: null, name: '', color: '#00FF88', emoji: '' })} className="btn-ghost mr-auto">取消</button><button onClick={saveCategory} className="btn-neon">保存</button></>}>
          <div className="space-y-3">
            <div><span className="label-tag block mb-1">名称 *</span><input value={catModal.name} onChange={(e) => setCatModal({ ...catModal, name: e.target.value })} className="input-neon" placeholder="如：作业 / 会议 / 倒数日" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><span className="label-tag block mb-1">Emoji</span><input value={catModal.emoji} onChange={(e) => setCatModal({ ...catModal, emoji: e.target.value })} className="input-neon" placeholder="📚 / ⭐" /></div>
              <div><span className="label-tag block mb-1">颜色</span><input type="color" value={catModal.color} onChange={(e) => setCatModal({ ...catModal, color: e.target.value })} className="input-neon h-10 p-1" /></div>
            </div>
          </div>
        </Modal>
      )}

      {/* 课表 Excel 导入向导 */}
      {xlsOpen && (
        <Modal
          title={`从 Excel 导入课表${xlsParsed ? ` · ${xlsParsed.sheetName}` : ''}`}
          onClose={() => setXlsOpen(false)}
          width="max-w-3xl"
          footer={
            xlsStep === 'done' ? (
              <button onClick={() => setXlsOpen(false)} className="btn-neon">完成</button>
            ) : (
              <>
                <button onClick={() => setXlsOpen(false)} className="btn-ghost mr-auto">取消</button>
                {xlsStep === 'file' && <button onClick={async () => {
                  setXlsBusy(true); setXlsMsg(null);
                  try {
                    const fp = await window.taskAPI.xls.pickFile();
                    if (!fp) { setXlsBusy(false); return; }
                    const parsed = await window.taskAPI.xls.parseFile(fp);
                    setXlsFile(fp); setXlsParsed(parsed); setXlsMapping(parsed.mapping);
                    setXlsStep('mapping');
                  } catch (e: any) { setXlsMsg({ ok: false, text: e?.message || '解析失败' }); }
                  finally { setXlsBusy(false); }
                }} disabled={xlsBusy} className="btn-neon"><FileSpreadsheet size={14} /> {xlsBusy ? '解析中…' : '选择文件并解析'}</button>}
                {xlsStep === 'mapping' && <>
                  <button onClick={() => { setXlsParsed(null); setXlsFile(null); setXlsStep('file'); }} className="btn-ghost">重选文件</button>
                  <button onClick={async () => {
                    if (!xlsParsed) return;
                    setXlsBusy(true); setXlsMsg(null);
                    try {
                      const rep = await window.taskAPI.xls.reparse(xlsParsed, xlsMapping);
                      setXlsParsed(rep);
                      if (rep.mapping.className < 0 || rep.mapping.weeks < 0 || rep.mapping.day < 0 || rep.mapping.period < 0) {
                        setXlsMsg({ ok: false, text: '必填字段（课程名/周次/星期/节次）必须全部指定列' });
                        return;
                      }
                      setXlsStep('options');
                    } catch (e: any) { setXlsMsg({ ok: false, text: e?.message || '解析失败' }); }
                    finally { setXlsBusy(false); }
                  }} disabled={xlsBusy} className="btn-neon">下一步</button>
                </>}
                {xlsStep === 'options' && <button onClick={() => setXlsStep('preview')} className="btn-neon">下一步：预览</button>}
                {xlsStep === 'preview' && <button onClick={async () => {
                  if (!xlsParsed) return;
                  setXlsBusy(true); setXlsMsg(null);
                  try {
                    const startTs = dayjs(xlsStart).startOf('day').valueOf();
                    const summary = await window.taskAPI.xls.importItems(xlsParsed.items, {
                      xn: xlsXn, xq: xlsXq, semesterStart: startTs, replaceExisting: xlsReplace,
                    });
                    setXlsSummary(summary); setXlsStep('done');
                    setXlsLastSync(await window.taskAPI.xls.lastImport());
                  } catch (e: any) { setXlsMsg({ ok: false, text: e?.message || '导入失败' }); }
                  finally { setXlsBusy(false); }
                }} disabled={xlsBusy || !xlsParsed} className="btn-neon btn-neon-yellow"><Calendar size={14} /> {xlsBusy ? '导入中…' : '确认导入'}</button>}
              </>
            )
          }
        >
          <div className="space-y-3">
            {xlsStep === 'file' && (
              <div className="text-sm text-text-secondary space-y-3">
                <p>选择你的课表 Excel 文件，向导会自动识别表头与课程行。常见来源：</p>
                <ul className="list-disc list-inside text-text-dim font-mono text-xs space-y-1">
                  <li>教务系统导出（教学管理系统 → 我的课表 → 导出 Excel）</li>
                  <li>超级课程表 App 导出</li>
                  <li>其他任何「每行一节课」的表格</li>
                </ul>
                <p className="text-text-dim text-xs">需要的列：<strong className="text-neon-green">课程名称、教师、周次、星期、节次</strong>（可选：教室/地点）。识别错的列可以在下一步手动指定。</p>
              </div>
            )}

            {xlsStep === 'mapping' && xlsParsed && (
              <div className="space-y-3">
                <div className="text-xs text-text-dim font-mono">
                  已读取 <strong className="text-neon-green">{xlsParsed.totalRows}</strong> 行 · 表头 <strong>{xlsParsed.headers.length}</strong> 列 · 解析出 <strong className="text-neon-green">{xlsParsed.preview.length}</strong> 条（前 12 条预览） · 跳过 {xlsParsed.badRows.length} 条
                </div>
                {(['className','teacher','weeks','day','period','location'] as const).map(key => (
                  <Field key={key} label={
                    key === 'className' ? '课程名称 *' :
                    key === 'teacher' ? '教师' :
                    key === 'weeks' ? '周次 *' :
                    key === 'day' ? '星期 *' :
                    key === 'period' ? '节次/时间 *' :
                    '教室/地点'
                  }>
                    <select
                      className="input-neon"
                      value={xlsMapping[key]}
                      onChange={async (e) => {
                        const v = parseInt(e.target.value, 10);
                        const newMap = { ...xlsMapping, [key]: v };
                        setXlsMapping(newMap);
                        if (xlsParsed) {
                          try { setXlsParsed(await window.taskAPI.xls.reparse(xlsParsed, newMap)); } catch { /* ignore */ }
                        }
                      }}
                    >
                      <option value={-1}>— 不映射 —</option>
                      {xlsParsed.headers.map((h, i) => (
                        <option key={i} value={i}>{i + 1}. {h || `列${i + 1}`}</option>
                      ))}
                    </select>
                  </Field>
                ))}
                {xlsParsed.warnings.length > 0 && (
                  <div className="p-2 rounded bg-neon-yellow/10 border border-neon-yellow/30 text-xs text-neon-yellow space-y-1">
                    {xlsParsed.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                  </div>
                )}
                {xlsParsed.badRows.length > 0 && (
                  <details className="text-xs text-text-dim font-mono">
                    <summary className="cursor-pointer">跳过的行（{xlsParsed.badRows.length}）</summary>
                    <div className="mt-1 max-h-32 overflow-y-auto p-2 rounded bg-ink-base/40 border border-neon-green/10">
                      {xlsParsed.badRows.slice(0, 30).map((b, i) => <div key={i}>第 {b.row} 行：{b.reason}</div>)}
                    </div>
                  </details>
                )}
              </div>
            )}

            {xlsStep === 'options' && xlsParsed && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="学年">
                    <input
                      value={xlsXn}
                      onChange={(e) => setXlsXn(e.target.value)}
                      className="input-neon"
                      placeholder="2025-2026"
                    />
                  </Field>
                  <Field label="学期">
                    <select className="input-neon" value={xlsXq} onChange={(e) => setXlsXq(e.target.value as '1' | '2')}>
                      <option value="1">秋季学期（1）</option>
                      <option value="2">春季学期（2）</option>
                    </select>
                  </Field>
                </div>
                <Field label="开学日（第 1 周周一）">
                  <input type="date" value={xlsStart} onChange={(e) => setXlsStart(e.target.value)} className="input-neon" />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={xlsReplace} onChange={(e) => setXlsReplace(e.target.checked)} className="accent-neon-green" />
                  <span>替换之前的课表导入（教务 / Excel）</span>
                </label>
                <div className="text-[10px] text-text-dim font-mono p-2 rounded bg-ink-base/40 border border-neon-green/10">
                  取消勾选则与已有导入并存（不推荐：会重复显示同一门课）。手动添加的课程/作业完全不受影响。
                </div>
              </div>
            )}

            {xlsStep === 'preview' && xlsParsed && (
              <div className="space-y-2">
                <div className="text-xs text-text-dim font-mono">
                  解析 <strong className="text-neon-green">{xlsParsed.preview.length}</strong> 条 · 跳过 {xlsParsed.badRows.length} 条 · 共 {xlsParsed.totalRows} 行
                </div>
                <div className="max-h-72 overflow-y-auto rounded border border-neon-green/15">
                  <table className="w-full text-xs font-mono">
                    <thead className="bg-neon-green/10 text-neon-green">
                      <tr><th className="p-1.5 text-left">星期</th><th className="p-1.5 text-left">节次</th><th className="p-1.5 text-left">课程</th><th className="p-1.5 text-left">教师</th><th className="p-1.5 text-left">周次</th><th className="p-1.5 text-left">教室</th></tr>
                    </thead>
                    <tbody>
                      {xlsParsed.preview.map((it, i) => (
                        <tr key={i} className="border-t border-neon-green/10">
                          <td className="p-1.5">周{['日','一','二','三','四','五','六'][it.day]}</td>
                          <td className="p-1.5">第{it.periodName}</td>
                          <td className="p-1.5 text-neon-green">{it.className}</td>
                          <td className="p-1.5">{it.teacher || '—'}</td>
                          <td className="p-1.5">{it.weeksText}</td>
                          <td className="p-1.5">{it.location || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {xlsStep === 'done' && xlsSummary && (
              <div className="space-y-3">
                <div className="p-4 rounded-md bg-neon-green/5 border border-neon-green/30 text-sm space-y-1">
                  <div className="font-bold text-neon-green text-base">✓ 导入成功</div>
                  <div className="font-mono text-xs space-y-0.5">
                    <div>课程：<strong className="text-neon-green">{xlsSummary.courses}</strong> 门</div>
                    <div>课表事件：<strong className="text-neon-green">{xlsSummary.events}</strong> 条（按周展开后）</div>
                    <div>原始记录：{xlsSummary.items} 条</div>
                  </div>
                </div>
                {xlsSummary.warnings.length > 0 && (
                  <div className="p-2 rounded bg-neon-yellow/10 border border-neon-yellow/30 text-xs text-neon-yellow space-y-1">
                    {xlsSummary.warnings.map((w, i) => <div key={i}>· {w}</div>)}
                  </div>
                )}
                <div className="text-xs text-text-dim font-mono">
                  提示：到「课程 → 课表日历」或「课程 → 课程卡片」即可看到导入的课程。点课程卡片可以添加每节课的作业。
                </div>
              </div>
            )}

            {xlsMsg && (
              <div className={`p-2 rounded text-xs font-mono whitespace-pre-wrap break-all ${xlsMsg.ok ? 'bg-neon-green/10 border border-neon-green/30 text-neon-green' : 'bg-neon-danger/10 border border-neon-danger/30 text-neon-danger'}`}>
                {xlsMsg.ok ? '✓ ' : '✗ '}{xlsMsg.text}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Section({ icon, title, children }: any) {
  return (
    <div className="glass-panel p-5 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-neon-green/10">
        <span className="text-neon-green">{icon}</span>
        <h3 className="label-tag">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: any) {
  return (
    <div className="flex items-center gap-4 py-2 border-b border-neon-green/5 last:border-b-0">
      <span className="text-sm text-text-secondary w-32 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Stat({ label, value }: any) {
  return (
    <div className="p-3 rounded-md bg-ink-base/60 border border-neon-green/20">
      <div className="font-mono text-[10px] text-text-dim uppercase">{label}</div>
      <div className="text-xl font-bold text-neon-green font-mono mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="label-tag block mb-1">{label}</span>
      {children}
    </label>
  );
}
