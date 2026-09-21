import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Save, Download, Upload, Database, Palette, Info, Cpu, User, CheckCircle2, GraduationCap, Tags, Plus, Trash2, Pencil, Lock, Users, Shield, RefreshCw, ExternalLink, AlertCircle, Sparkles, FileSpreadsheet, Calendar, CloudUpload, Bug, Package } from 'lucide-react';
import Modal from '@/components/Modal';
import AboutPanel from '@/components/AboutPanel';
import dayjs from 'dayjs';
import type { UserProfile, XlsParseResult, XlsFieldMapping, XlsImportSummary } from '@/types';

interface UpdateSource {
  name: string;
  url: string;
  enabled: boolean;
  primary: boolean;
  /** v1.1.4：'anyshare' = 北科云盘外链源 */
  type?: 'anyshare' | 'http';
  /** anyshare 源的提取码 */
  password?: string;
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
    /** 拉清单耗时（毫秒） */
    latencyMs?: number;
    sourceIndex?: number;
    sourceName?: string;
  };
}

/** 延迟格式化：<1s 显示 ms，≥1s 显示 x.xs */
function fmtLatency(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** 延迟分级配色：绿 <800ms / 黄 <3s / 红 ≥3s */
function latencyClass(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return 'text-text-dim';
  if (ms < 800) return 'text-neon-green';
  if (ms < 3000) return 'text-neon-yellow';
  return 'text-neon-danger';
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
  const [theme, setTheme] = useState('aurora');
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
      sourceIndex?: number;
    } | null;
    perSource: Array<{ source: UpdateSource; result: any }>;
    checkedAt: number;
  } | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [dl, setDl] = useState<{ running: boolean; percent: number; received: number; total: number } | null>(null);
  const [dlPath, setDlPath] = useState<string | null>(null);
  const [updateAuto, setUpdateAuto] = useState(true);
  const [showSrcEditor, setShowSrcEditor] = useState(false);

  // ===== 作业同步（v1.1.4：GitHub 令牌 + 北科云盘源） =====
  const [hwToken, setHwToken] = useState('');
  const [hwPublisher, setHwPublisher] = useState('');
  const [hwTokenSet, setHwTokenSet] = useState(false);
  const [hwAuthSaved, setHwAuthSaved] = useState(false);
  const [hwCloud, setHwCloud] = useState<{ url: string; password: string; enabled: boolean }>({ url: '', password: '', enabled: true });
  const [hwCloudSaved, setHwCloudSaved] = useState(false);
  const [hwCloudErr, setHwCloudErr] = useState('');

  // ===== 自动清理 & 回收站（v1.1.9） =====
  const [cleanRules, setCleanRules] = useState<{
    enabled: boolean; reqDays: number; taskDays: number; eventDays: number;
    projectDays: number; homeworkDays: number; binDays: number;
  } | null>(null);
  const [binItems, setBinItems] = useState<Array<{
    id: number; kind: string; title: string; reason: string | null;
    deleted_at: number; purge_at: number;
  }>>([]);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [showBin, setShowBin] = useState(false);

  const refreshBin = async () => {
    try { setBinItems(await window.taskAPI.cleanup.bin({ limit: 50 })); } catch { /* ignore */ }
  };

  const patchCleanRule = async (patch: Partial<{ enabled: boolean; reqDays: number; taskDays: number; eventDays: number; projectDays: number; homeworkDays: number; binDays: number }>) => {
    try { setCleanRules(await window.taskAPI.cleanup.setRules(patch)); } catch { /* ignore */ }
  };

  const runCleanup = async () => {
    setCleanBusy(true); setCleanMsg(null);
    try {
      const r = await window.taskAPI.cleanup.run();
      const b = r.local.binned;
      const lines = [`本地：作业 ${b.requirements} · 任务 ${b.tasks} · 日程 ${b.events} · 项目 ${b.projects} 项移入回收站；回收站过期清除 ${r.local.purgedBin} 项`];
      if (r.cloud.codes.length) {
        const gh = r.cloud.github, cl = r.cloud.cloud;
        lines.push(`云端（${r.cloud.codes.join('、')}）：GitHub 重写 ${gh.rewritten} 个文件 / 清理 ${gh.removedEntries} 条${gh.deleted ? ` / 删空文件 ${gh.deleted} 个` : ''}；云盘快照重写 ${cl.rewritten} 个 / 清理 ${cl.removedEntries} 条`);
        const errs = [...gh.errors, ...cl.errors];
        if (errs.length) lines.push('部分错误：' + errs.slice(0, 3).join('；'));
      } else {
        lines.push('云端：本轮未执行（每天最多一次，或未配置发布码）');
      }
      setCleanMsg(lines.join('\n'));
      await refreshBin();
    } catch (e: any) {
      setCleanMsg('清理失败：' + (e?.message || e));
    } finally { setCleanBusy(false); }
  };

  const restoreBinItem = async (id: number) => {
    const r = await window.taskAPI.cleanup.restore(id);
    if (!r.ok) { alert('恢复失败：' + (r.error || '未知错误')); return; }
    await refreshBin();
  };

  const purgeBinItem = async (id: number) => {
    if (!confirm('彻底删除后无法恢复，确定？')) return;
    await window.taskAPI.cleanup.purge(id);
    await refreshBin();
  };

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
      try {
        const hw = await window.taskAPI.homework.config();
        setHwTokenSet(!!hw.tokenSet);
        setHwPublisher(hw.publisher || '');
        if (hw.cloud) {
          setHwCloud({
            url: `${hw.cloud.baseUrl}/link/${hw.cloud.linkId}`,
            password: hw.cloud.password || '',
            enabled: hw.cloud.enabled !== false,
          });
        }
      } catch { /* 忽略 */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try { setCleanRules(await window.taskAPI.cleanup.rules()); } catch { /* ignore */ }
      void refreshBin();
    })();
  }, []);

  /** 保存 GitHub 发布令牌 + 发布人昵称 */
  const saveHwAuth = async () => {
    const r = await window.taskAPI.homework.saveAuth(hwToken.trim(), hwPublisher.trim());
    if (!r.ok) { alert(r.error || '保存失败'); return; }
    setHwTokenSet(!!r.tokenSet);
    setHwToken('');
    setHwAuthSaved(true);
    setTimeout(() => setHwAuthSaved(false), 1800);
  };

  /** 保存北科云盘作业同步源 */
  const saveHwCloud = async () => {
    setHwCloudErr('');
    const r = await window.taskAPI.homework.saveCloud({
      url: hwCloud.url.trim(),
      password: hwCloud.password.trim(),
      enabled: hwCloud.enabled,
    });
    if (!r.ok) { setHwCloudErr(r.error || '保存失败'); return; }
    setHwCloudSaved(true);
    setTimeout(() => setHwCloudSaved(false), 1800);
  };

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
          type: source.type,
          password: source.password,
          sourceIndex: result.sourceIndex,
          ok: result.ok,
          latestVersion: result.latestVersion,
          reason: result.reason,
          message: result.message,
          latencyMs: result.latencyMs,
          downloadUrl: result.downloadUrl,
          sha256: result.sha256,
          pageUrl: result.pageUrl,
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

  /** 同版本多源可用时，手动选择从哪个源下载更新 */
  const pickSource = (i: number) => {
    setAggregate((a) => {
      if (!a) return a;
      const entry = a.perSource[i];
      if (!entry?.result?.ok || !entry.result.downloadUrl) return a;
      return { ...a, winner: entry.result };
    });
  };

  const startDownload = async () => {
    const w = aggregate?.winner;
    if (!w?.downloadUrl) return;
    setUpdateMsg(null);
    setDl({ running: true, percent: 0, received: 0, total: 0 });
    try {
      // 北科云盘源的 downloadUrl 是云盘里的文件名，后端要靠 source（提取码）换签名直链
      const src = w.sourceIndex != null ? aggregate?.perSource?.[w.sourceIndex]?.source : null;
      const r = await window.taskAPI.updater.download({
        url: w.downloadUrl,
        version: w.latestVersion || 'latest',
        sha256: w.sha256 || null,
        source: src || null,
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

  // 只在挂载时从 store 拉一次用户资料到本地编辑态；之后由用户编辑 + 保存驱动，
  // 避免 settings / userProfile 任意更新（updater 推送、refreshAll 等）反向覆盖正在编辑的内容。
  useEffect(() => {
    if (settings.theme) setTheme(settings.theme);
    if (settings.semester) setSemester(settings.semester);
    if (settings.semester_start) {
      const d = new Date(Number(settings.semester_start));
      setSemesterStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只在「profile.id 从无到有」或切换到另一个 profile 时同步，避免 store 重复推送覆盖输入
  const profileIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!userProfile) return;
    if (profileIdRef.current === userProfile.id) return; // 同一个 profile 的后续更新不再覆盖
    profileIdRef.current = userProfile.id;
    setProfile({ ...userProfile });
    setPrivacyMode(!!userProfile.privacy_mode);
    try {
      const cf = JSON.parse(userProfile.custom_fields || '[]');
      setCustomFields(Array.isArray(cf) ? cf : []);
    } catch { setCustomFields([]); }
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
          <div className="space-y-3 w-full">
            <select value={theme} onChange={(e) => setTheme(e.target.value)} className="input-neon w-48">
              <option value="aurora">🌌 极光（默认 · 新）</option>
              <option value="starry">✦ 星辉（青蓝荧光）</option>
              <option value="neon-green">◇ 霓虹绿（经典）</option>
              <option value="sakura">🌸 樱花粉（萌系）</option>
              <option value="glass-light">🪟 玻璃 · 浅色（Win11 液态玻璃）</option>
              <option value="glass-dark">🪟 玻璃 · 深色（Win11 液态玻璃）</option>
            </select>
            {/* v1.2.1 主题预览卡片：实时反映当前主题的渐变 / 玻璃 / 对比 */}
            <div className="mt-1 p-3 rounded-lg border border-neon-green/15 bg-ink-base/40 max-w-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="label-tag">PREVIEW · {theme}</span>
                <div className="flex-1 h-px bg-gradient-to-r from-neon-green/30 to-transparent" />
              </div>
              <div className="glass-panel p-3">
                <div className="text-grad-sakura font-mono text-base font-bold mb-2">
                  {theme === 'aurora' ? '🌌 极光主题' : theme === 'sakura' ? '🌸 樱花粉主题' : theme === 'starry' ? '✦ 星辉主题' : theme === 'glass-light' ? '🪟 玻璃 · 浅色主题' : theme === 'glass-dark' ? '🪟 玻璃 · 深色主题' : '◇ 霓虹绿主题'}
                </div>
                <div className="text-xs text-text-secondary mb-2">
                  渐变标题 + 玻璃面板 + <span className="data-pill">数据胶囊</span>
                </div>
                <div className="flex gap-2 mb-2">
                  <button type="button" className="btn-neon text-xs">主要按钮</button>
                  <button type="button" className="btn-ghost text-xs">次要</button>
                </div>
                <div className="status-bar-sakura text-xs text-text-primary">
                  📌 状态条：左侧高光锚点
                </div>
              </div>
              <hr className="divider-grad-sakura" />
              <div className="text-[10px] text-text-dim font-mono">
                预览随主题切换实时刷新 · 樱花粉下透明度 / 高光 / 对比最强
              </div>
            </div>
          </div>
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

      {/* 自动清理 & 回收站（v1.1.9） */}
      <Section icon={<Trash2 size={14} />} title="自动清理 & 回收站">
        <div className="p-3 rounded-md bg-ink-base/40 border border-neon-green/10 text-xs text-text-secondary space-y-1 mb-3">
          <div>· 完成的作业/任务、过期日程、完结项目到期后自动移入<strong className="text-neon-green">回收站</strong>，回收站到期后彻底删除</div>
          <div>· 上传到 GitHub/云盘的共享作业超过保留天数后云端同步清理（云盘为写过滤快照，旧客户端也不再挂载过期条目）</div>
          <div>· 手动删除的数据同样先进回收站，可随时恢复</div>
        </div>
        {cleanRules ? (
          <>
            <Row label="自动清理">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={cleanRules.enabled}
                  onChange={(e) => patchCleanRule({ enabled: e.target.checked })}
                  className="accent-[#00FF88]"
                />
                <span className="font-mono text-[10px] text-text-dim">{cleanRules.enabled ? '每小时后台检查' : '已关闭'}</span>
              </div>
            </Row>
            <Row label="完成的作业">
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={365} value={cleanRules.reqDays}
                  onChange={(e) => patchCleanRule({ reqDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="完成的任务">
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={365} value={cleanRules.taskDays}
                  onChange={(e) => patchCleanRule({ taskDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="过期的日程">
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={365} value={cleanRules.eventDays}
                  onChange={(e) => patchCleanRule({ eventDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="完结的项目">
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={365} value={cleanRules.projectDays}
                  onChange={(e) => patchCleanRule({ projectDays: Math.max(0, Number(e.target.value) || 0) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后移入回收站</span>
              </div>
            </Row>
            <Row label="上传的作业（云端）">
              <div className="flex items-center gap-1">
                <input type="number" min={1} max={365} value={cleanRules.homeworkDays}
                  onChange={(e) => patchCleanRule({ homeworkDays: Math.max(1, Number(e.target.value) || 1) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后云端清理</span>
              </div>
            </Row>
            <Row label="回收站保留">
              <div className="flex items-center gap-1">
                <input type="number" min={1} max={365} value={cleanRules.binDays}
                  onChange={(e) => patchCleanRule({ binDays: Math.max(1, Number(e.target.value) || 1) })}
                  className="input-neon w-16 py-0.5 px-2 text-xs text-right" />
                <span className="text-xs text-text-dim">天后彻底删除</span>
              </div>
            </Row>
          </>
        ) : (
          <div className="font-mono text-[10px] text-text-dim">规则加载中…</div>
        )}
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={runCleanup} disabled={cleanBusy} className="btn-neon">
            {cleanBusy ? '清理中…' : '立即清理'}
          </button>
          <button onClick={() => { setShowBin((v) => !v); void refreshBin(); }} className="btn-ghost">
            回收站（{binItems.length}）
          </button>
        </div>
        {cleanMsg && (
          <div className="mt-3 p-3 rounded-md border border-neon-green/40 text-neon-green bg-neon-green/5 font-mono text-xs whitespace-pre-wrap">
            {cleanMsg}
          </div>
        )}
        {showBin && (
          <div className="mt-3 rounded-md border border-neon-green/15 bg-ink-base/40 p-2 space-y-1 max-h-64 overflow-y-auto">
            {binItems.length === 0 ? (
              <div className="font-mono text-[10px] text-text-dim p-1">回收站是空的</div>
            ) : binItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2 font-mono text-[10px] p-1.5 rounded border border-neon-green/10 bg-ink-base/30">
                <span className="px-1.5 py-0.5 rounded text-[9px] border border-text-dim/30 text-text-dim shrink-0">
                  {{ requirement: '作业', task: '任务', event: '日程', project: '项目' }[it.kind] || it.kind}
                </span>
                <span className="text-text-secondary truncate flex-1" title={it.title}>{it.title}</span>
                <span className="text-text-dim shrink-0">{dayjs(it.deleted_at).format('MM-DD HH:mm')} 删</span>
                <span className="text-text-dim shrink-0">{dayjs(it.purge_at).format('MM-DD')} 清除</span>
                <button onClick={() => restoreBinItem(it.id)} className="px-1.5 py-0.5 rounded text-[9px] border border-neon-green/40 text-neon-green hover:bg-neon-green/10 shrink-0">恢复</button>
                <button onClick={() => purgeBinItem(it.id)} className="px-1.5 py-0.5 rounded text-[9px] border border-neon-danger/40 text-neon-danger hover:bg-neon-danger/10 shrink-0">彻底删</button>
              </div>
            ))}
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
                  {s.type === 'anyshare' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-neon-yellow/15 text-neon-yellow border border-neon-yellow/40 shrink-0" title="北科云盘外链源（需北京科技大学校园网）">云盘</span>
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
                  {s.type === 'anyshare' && (
                    <input
                      value={s.password || ''}
                      onChange={(e) => updateSourceLocal(i, { password: e.target.value })}
                      placeholder="提取码"
                      className="input-neon w-20 py-0.5 px-2 text-xs"
                      title="北科云盘提取码"
                    />
                  )}
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
                onClick={() => {
                  if (sources.some((s) => s.type === 'anyshare' || /\/link\//.test(s.url))) {
                    alert('已存在北科云盘源');
                    return;
                  }
                  setSources([...sources, {
                    name: '北科云盘（需校园网）',
                    url: 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469',
                    password: 'kc26',
                    type: 'anyshare',
                    enabled: true,
                    primary: false,
                  }]);
                  setShowSrcEditor(true);
                }}
                className="btn-ghost text-xs py-1"
                title="添加北科云盘更新源（需要北京科技大学校园网）"
              >
                <Plus size={12} /> 北科云盘源
              </button>
              <button
                onClick={() => saveSources(sources, activeIndex)}
                disabled={!sources.length}
                className="btn-neon text-xs py-1"
              >
                {srcSaved ? <><CheckCircle2 size={12} className="text-neon-green" /> 已保存</> : <><Save size={12} /> 保存源</>}
              </button>
              <span className="font-mono text-[10px] text-text-dim">
                内置三个源：<strong className="text-neon-green">StarOS（nrsc.games）</strong>为主源，
                <strong className="text-neon-green">GitHub leastversion</strong>与
                <strong className="text-neon-yellow">北科云盘（需校园网）</strong>为备用镜像；
                检查更新时会一起查，取版本最高的那个升级。
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
              开启后每次启动会<strong className="text-neon-yellow">检查所有启用的更新源</strong>，发现新版本会<strong className="text-neon-yellow">在右下角弹窗告知</strong>；左侧「设置」也会有 NEW 标记。
            </span>
          </label>
        </Row>

        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={checkUpdate} disabled={updateChecking} className="btn-neon">
            <RefreshCw size={14} className={updateChecking ? 'animate-spin' : ''} /> {updateChecking ? '检查中…' : '检查更新'}
          </button>
          <PatchUpdateButton aggregate={aggregate} appVersion={appInfo?.version || ''} onMessage={setUpdateMsg} onProgress={setDl} />
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

        {/* v1.3.0：已下载的增量补丁（zip + manifest 缓存，随时应用） */}
        <PatchCacheCard appVersion={appInfo?.version || ''} onMessage={setUpdateMsg} />

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

        {/* 多源结果汇总（含测速延迟 + 手动选源下载） */}
        {aggregate && aggregate.perSource.length > 0 && !updateMsg && (
          <div className="mt-1 p-3 rounded-md border border-neon-green/15 bg-ink-base/40 space-y-1">
            <div className="font-mono text-[10px] text-text-dim mb-1">
              {aggregate.checkedAt ? `检查时间：${dayjs(aggregate.checkedAt).format('YYYY-MM-DD HH:mm:ss')}` : '本次检查结果'}
              {' · '}
              {aggregate.perSource.filter((p) => p.result.ok).length}/{aggregate.perSource.length} 源连通
            </div>
            {aggregate.perSource.map(({ source, result }, i) => {
              const isWinner = aggregate.winner?.sourceIndex === result.sourceIndex && !!aggregate.winner;
              const canPick = result.ok && !!result.downloadUrl && result.hasUpdate &&
                result.latestVersion === aggregate.winner?.latestVersion;
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 font-mono text-[10px] rounded px-1.5 py-1 border ${
                    isWinner ? 'border-neon-green/40 bg-neon-green/5' : 'border-transparent'
                  }`}
                >
                  <span className="text-text-secondary truncate pr-1 flex items-center gap-1.5">
                    {source.name}{source.primary ? ' (主)' : ''}
                    {result.ok && result.latencyMs != null && (
                      <span className={`px-1 rounded bg-ink-base/60 border border-current/20 ${latencyClass(result.latencyMs)}`} title="拉取该源清单的耗时">
                        {fmtLatency(result.latencyMs)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className={result.ok ? 'text-neon-green' : 'text-neon-danger'}>
                      {result.ok
                        ? `v${result.latestVersion}${result.hasUpdate ? ' · 有更新' : ' · 已是最新'}`
                        : (result.reason === 'network' ? '连不上' : (result.reason || '失败')) + (result.message ? ` · ${result.message}` : '')}
                    </span>
                    {canPick && !isWinner && (
                      <button
                        onClick={() => pickSource(i)}
                        className="px-1.5 py-0.5 rounded text-[9px] border border-neon-yellow/40 text-neon-yellow hover:bg-neon-yellow/10"
                        title="从该源下载更新（版本相同，速度可能不同）"
                      >
                        用此源下载
                      </button>
                    )}
                    {isWinner && result.hasUpdate && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-neon-green/10 border border-neon-green/40 text-neon-green">下载源</span>
                    )}
                  </span>
                </div>
              );
            })}
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

      {/* 作业同步（v1.1.4） */}
      <Section icon={<CloudUpload size={14} />} title="作业同步">
        <Row label="GitHub 发布令牌">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={hwToken}
                onChange={(e) => setHwToken(e.target.value)}
                placeholder={hwTokenSet ? '已配置（留空不修改）' : 'ghp_… / github_pat_…'}
                className="input-neon flex-1"
              />
              <button onClick={saveHwAuth} className="btn-neon text-xs py-1.5 shrink-0">
                {hwAuthSaved ? <><CheckCircle2 size={12} className="text-neon-green" /> 已保存</> : '保存'}
              </button>
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              发布作业到 GitHub 时需要（fine-grained PAT，勾选本仓库 Contents 读写）。接收作业<strong className="text-neon-green">不需要令牌</strong>（v1.1.4 起读走 raw CDN，不受 API 每小时 60 次限制）。
            </div>
          </div>
        </Row>

        <Row label="发布人昵称">
          <input
            value={hwPublisher}
            onChange={(e) => setHwPublisher(e.target.value)}
            placeholder="接收方看到的发布人名字（如：豆芽）"
            className="input-neon"
          />
        </Row>

        <Row label="北科云盘同步源">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hwCloud.enabled}
                onChange={(e) => setHwCloud({ ...hwCloud, enabled: e.target.checked })}
                className="accent-[#00FF88]"
              />
              <span className="text-xs text-text-secondary">
                启用后「接收作业」除 GitHub 外也会查北科云盘；「发布作业」可选发布到云盘。
                <strong className="text-neon-yellow">需要北京科技大学校园网</strong>。
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                value={hwCloud.url}
                onChange={(e) => setHwCloud({ ...hwCloud, url: e.target.value })}
                placeholder="https://yunpan.ustb.edu.cn/link/XXXX…"
                className="input-neon flex-1 font-mono text-xs"
              />
              <input
                value={hwCloud.password}
                onChange={(e) => setHwCloud({ ...hwCloud, password: e.target.value })}
                placeholder="提取码"
                className="input-neon w-24 font-mono text-xs"
              />
              <button onClick={saveHwCloud} className="btn-neon text-xs py-1.5 shrink-0">
                {hwCloudSaved ? <><CheckCircle2 size={12} className="text-neon-green" /> 已保存</> : '保存'}
              </button>
            </div>
            {hwCloudErr && (
              <div className="font-mono text-[10px] text-neon-danger">✗ {hwCloudErr}</div>
            )}
            <div className="font-mono text-[10px] text-text-dim">
              作业包存在云盘分享根目录（文件名 <code>&lt;同步码&gt;-&lt;时间戳&gt;.json</code>），接收方按前缀取最新一份。云盘里旧文件不会自动清理，可偶尔登录云盘手动删。
            </div>
          </div>
        </Row>
      </Section>

      {/* v1.1.6：输入框失灵诊断（块 3 埋点 + 导出） */}
      <Section icon={<Bug size={14} />} title="输入诊断">
        <div className="text-[11px] text-text-dim font-mono mb-2 space-y-1">
          <div>· 当焦点在输入框但 8 秒没收到 keydown，<strong className="text-neon-yellow">自动落盘最近 50 条键盘 / IME / 焦点事件</strong>到 <code>%TMP%/taskmanager-input-diag.log</code></div>
          <div>· 再次遭遇 → 反馈时把下面导出的日志附上即可定位是 IME 卡住、还是焦点被劫持、还是 IPC 阻塞</div>
          <div>· 不会记录任何按键字符内容，只记事件序列（保护隐私）</div>
        </div>
        <DiagPanel />
      </Section>

      {/* 关于：about.txt 多源聚合 + 本地缓存（v1.1.7+） */}
      <Section icon={<Info size={14} />} title="关于">
        <AboutPanel appVersion={appInfo?.version || ''} />
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

/** v1.3.0 缓存式增量更新按钮：
 *  - winner 现在直接携带 patches（主进程透传）
 *  - preview 可用 →「下载增量补丁」→ zip+json 落 userData/update-cache（不退出应用）
 *  - 应用动作统一走 PatchCacheCard（独立于检查更新，随时可应用已缓存补丁）
 */
function PatchUpdateButton({
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

/** v1.3.0 补丁缓存卡片：独立于「检查更新」，只要 update-cache 里有 zip+json 就能一键应用/清除 */
function PatchCacheCard({ appVersion, onMessage }: { appVersion: string; onMessage: (m: string) => void }) {
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

/** v1.1.6 输入诊断面板（块 3）—— 直接调 taskAPI.diag，不必走 settings 保存 */
function DiagPanel() {
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
    // 强制探测器立刻上报一次（调试用）—— 当前实现通过 window.__inputDiagHandle.flush
    // 没有 IPC 暴露，但用户在 devtools 里也能调
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
