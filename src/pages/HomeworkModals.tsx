/**
 * v1.2.7 块 K：从 src/pages/Courses.tsx 拆出（原 1395-2131 行）
 *
 * 内容：
 *  - copyText                            工具（剪贴板，fail-safe）
 *  - MyHomeworkCode                      已生成作业码历史记录类型
 *  - GenerateCodesModal                  生成一对作业码（发布码 + 同步码）+ 历史回看
 *  - PublishHomeworkModal                发布作业弹窗（同节课批量发布多条作业）
 *  - EntryEditor                         单条作业条目编辑器（批量发布弹窗用）
 *  - ReceiveHomeworkModal                接收作业弹窗（输入同步码 → 远端拉取 → 自动挂载）
 *
 * 依赖：
 *  - Courses.tsx 必须导出 Field（避免重复实现 + 保持视觉一致）
 *  - Modal 来自 @/components/Modal
 *  - useStore 来自 @/store（zustand）
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  KeyRound,
  Plus,
  RefreshCw,
  X,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useStore } from '@/store';
import Modal from '@/components/Modal';
import { Field } from './Courses';

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
}

/** 一条可回看的作业码记录（v1.2.2） */
type MyHomeworkCode = { syncCode: string; publishCode: string; createdAt: number; source: 'generated' | 'course'; courseName?: string };

/** 生成作业码弹窗：一键生成一对码（发布码 = 密钥，同步码 = 分享码），抄存/复制；下方回看已生成的码 */
export function GenerateCodesModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<{ syncCode: string; publishCode: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [history, setHistory] = useState<MyHomeworkCode[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const r = await window.taskAPI.homework.listMyCodes();
      if (r.ok) setHistory(r.codes || []);
    } finally {
      setHistLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const generatePair = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.taskAPI.homework.generateCodes();
      setGenerated({ syncCode: r.syncCode, publishCode: r.publishCode });
      setCopied(null);
      loadHistory();
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async (key: string, text: string) => {
    await copyText(text);
    setCopied(key);
    setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1500);
  };

  return (
    <Modal
      title="生成作业码"
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-ghost">关闭</button>
        <button onClick={generatePair} disabled={busy} className="btn-neon"><KeyRound size={14} /> {busy ? '生成中…' : (generated ? '再生成一对' : '生成新码对')}</button>
      </>}
    >
      <div className="space-y-3">
        <div className="p-2.5 rounded-md border border-neon-green/20 bg-neon-green/5 text-[11px] text-text-secondary leading-relaxed">
          一对码对应一个课程的整套作业包：
          <span className="text-neon-yellow font-mono"> 作业发布码 </span>= 密钥（自己留存，点「发布作业」时输入），
          <span className="text-neon-green font-mono"> 同步作业码 </span>= 分享码（发给同学，点「接收作业」时输入）。
        </div>

        {!generated && (
          <div className="py-6 text-center font-mono text-xs text-text-dim">
            [ ∅ ] 还没有生成码对，点右下角「生成新码对」
          </div>
        )}

        {generated && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="font-mono text-[11px] text-neon-yellow font-bold">✦ 新码对已生成，请抄存两码</div>
            <div className="font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="text-text-dim w-20 shrink-0">作业发布码</span>
                <span className="text-neon-yellow font-bold tracking-widest">{generated.publishCode}</span>
                <button onClick={() => doCopy('publish', generated.publishCode)} className="btn-ghost p-1 text-[9px]">
                  {copied === 'publish' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-text-dim w-20 shrink-0">同步作业码</span>
                <span className="text-neon-green font-bold tracking-widest">{generated.syncCode}</span>
                <button onClick={() => doCopy('sync', generated.syncCode)} className="btn-ghost p-1 text-[9px]">
                  {copied === 'sync' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              作业发布码自己留存（继续发布/更新这个包）；同步作业码发给同学（接收作业用）。
              也可以使用网站申请的码对，效果相同。
            </div>
          </div>
        )}

        {/* v1.2.2：回看已生成的作业码（手动生成历史 + 课程绑定码） */}
        <div className="rounded-md border border-white/10">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/10">
            <span className="font-mono text-[10px] text-text-dim tracking-widest">回看已生成的作业码（{history.length}）</span>
            <button onClick={loadHistory} className="btn-ghost p-1 text-[9px]">
              <RefreshCw size={11} className={histLoading ? 'animate-spin' : ''} /> 刷新
            </button>
          </div>
          <div className="max-h-44 overflow-y-auto divide-y divide-white/5">
            {histLoading && !history.length && (
              <div className="py-4 text-center font-mono text-[10px] text-text-dim">读取中…</div>
            )}
            {!histLoading && !history.length && (
              <div className="py-4 text-center font-mono text-[10px] text-text-dim leading-relaxed">
                [ ∅ ] 还没有生成记录<br />点「生成新码对」，或在发布作业时自动为课程绑定同步码
              </div>
            )}
            {history.map((c) => (
              <div key={c.syncCode} className="px-2.5 py-2 space-y-1">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-text-dim w-14 shrink-0">发布码</span>
                  <span className="text-neon-yellow font-bold tracking-widest">{c.publishCode}</span>
                  <button onClick={() => doCopy(`pub:${c.syncCode}`, c.publishCode)} className="btn-ghost p-1 text-[9px]">
                    {copied === `pub:${c.syncCode}` ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                  </button>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-text-dim w-14 shrink-0">同步码</span>
                  <span className="text-neon-green font-bold tracking-widest">{c.syncCode}</span>
                  <button onClick={() => doCopy(`sync:${c.syncCode}`, c.syncCode)} className="btn-ghost p-1 text-[9px]">
                    {copied === `sync:${c.syncCode}` ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                  </button>
                </div>
                <div className="font-mono text-[9px] text-text-dim">
                  {c.courseName ? `课程绑定 · ${c.courseName}` : '手动生成'}
                  {c.createdAt ? ` · ${dayjs(c.createdAt).format('YYYY-MM-DD HH:mm')}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** 发布作业弹窗（v1.1.8）：同节课可一次性发多条作业条目。
 *  - 顶部：课程 + 上课日期（共享）+ 发布目标 + secret edit（这些是码包级配置）
 *  - 中间：作业条目列表（每条独立标题/内容/类型/截止），"+ 添加作业条目" 按钮加行，× 删除单条
 *  - 提交：把有效条目（标题非空）一次传给后端 → 后端逐条 merge 到同一个码包
 *  - 自动 receive 让刚发布的作业落到本地（用新 entriesPublished 统计）
 */
export function PublishHomeworkModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const courses = useStore(s => s.courses);
  const events = useStore(s => s.events);

  type EntryDraft = { type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string };
  const blankEntry = (): EntryDraft => ({ type: 'homework', title: '', content: '', dueDate: '' });

  const [busy, setBusy] = useState(false);
  // 码包级字段
  const [courseId, setCourseId] = useState<number | null>(null);
  const [sessionDate, setSessionDate] = useState(dayjs().format('YYYY-MM-DD'));
  // 批量条目（默认一条空条目）
  const [items, setItems] = useState<EntryDraft[]>([blankEntry()]);
  // 可选 secret edit
  const [secretMode, setSecretMode] = useState(false);
  const [publishCode, setPublishCode] = useState('');
  // 发布目标列表（默认两个都勾）
  const [targets, setTargets] = useState<{ github: boolean; cloud: boolean }>({ github: true, cloud: true });

  const [error, setError] = useState('');
  const [published, setPublished] = useState<{
    entriesPublished: number;
    sessionDate: string;
    syncCode?: string; bundleCreated?: boolean; fileUrl?: string;
    entriesCount?: number;
    perTarget?: Array<{ target: 'github' | 'cloud'; ok: boolean; entriesCount?: number; error?: string }>;
  } | null>(null);
  const [copied, setCopied] = useState<'sync' | null>(null);

  const course = courses.find(c => c.id === courseId) ?? null;

  // 默认选中第一门课
  useEffect(() => {
    if (courses.length && courseId === null) setCourseId(courses[0].id);
  }, [courses, courseId]);

  // 该课程近期上课日期候选
  const sessionOptions = useMemo(() => {
    if (!course) return [] as Array<{ date: string; time: string }>;
    const map = new Map<string, string>();
    events.filter(e => e.course_id === course.id).forEach(e => {
      const s = dayjs(e.start_at);
      const time = s.format('HH:mm') + (e.end_at ? `-${dayjs(e.end_at).format('HH:mm')}` : '');
      if (e.type === 'class') {
        map.set(s.format('YYYY-MM-DD'), time);
      } else if (e.recurrence === 'WEEKLY') {
        const dow = s.day();
        const base = dayjs().startOf('day');
        const thisMonday = dow === 0 ? base.subtract(6, 'day') : base.subtract(dow - 1, 'day');
        const thisDow = dow === 0 ? 6 : dow - 1;
        [-1, 0, 1, 2].forEach(off => {
          const d = thisMonday.add(off * 7 + thisDow, 'day');
          map.set(d.format('YYYY-MM-DD'), time);
        });
      }
    });
    const today = dayjs().startOf('day').valueOf();
    return [...map.entries()]
      .map(([date, time]) => ({ date, time, ts: dayjs(date).valueOf() }))
      .sort((a, b) => Math.abs(a.ts - today) - Math.abs(b.ts - today))
      .slice(0, 12)
      .sort((a, b) => a.ts - b.ts);
  }, [course, events]);

  const validItems = items.filter((it) => it.title.trim());
  const canSubmit = !!course && validItems.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    if (secretMode && publishCode && publishCode.length !== 12) { setError('作业发布码需为 12 位（不填则关闭 secret edit 模式）'); return; }
    setBusy(true); setError('');
    try {
      const r = await window.taskAPI.homework.publish({
        publishCode: secretMode && publishCode ? publishCode : undefined,
        targets: (Object.entries(targets).filter(([, on]) => on).map(([k]) => k) as ('github' | 'cloud')[]),
        courseId: course.id,
        courseName: course.name,
        sessionDate,
        // 批量条目（每条独立标题/内容/类型/截止；sessionDate 用码包级）
        entries: validItems.map((it) => ({
          title: it.title.trim(),
          content: it.content.trim(),
          type: it.type,
          sessionDate,
          dueDate: it.dueDate ? new Date(it.dueDate).getTime() : null,
        })),
      });
      if (!r.ok) { setError(r.error || '发布失败'); if ((r as any).anyshareRaw) setError(prev => prev + `\n[debug] ${(r as any).anyshareRaw}`); return; }
      setPublished({
        entriesPublished: r.entriesPublished ?? validItems.length,
        sessionDate,
        syncCode: r.syncCode,
        bundleCreated: r.bundleCreated,
        fileUrl: r.fileUrl,
        entriesCount: r.entriesCount,
        perTarget: r.perTarget,
      });
      // 自动把刚发布的作业落到本地课程（与远端 ID 对齐）
      if (r.syncCode) await window.taskAPI.homework.receive(r.syncCode);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async (which: 'sync') => {
    if (!published?.syncCode) return;
    await copyText(published.syncCode);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const addItem = () => setItems((arr) => [...arr, blankEntry()]);
  const removeItem = (idx: number) => setItems((arr) => (arr.length > 1 ? arr.filter((_, i) => i !== idx) : arr));
  const updateItem = (idx: number, patch: Partial<EntryDraft>) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const footer = (() => {
    if (published) {
      return <>
        <button onClick={() => { setPublished(null); setItems([blankEntry()]); }} className="btn-ghost">再发一组</button>
        <button onClick={onClose} className="btn-neon">完成</button>
      </>;
    }
    const btnLabel = busy ? '上传中…' : (
      targets.cloud && targets.github ? `上传 ${validItems.length || ''} 条到 GitHub + 云盘`
      : targets.cloud ? `上传 ${validItems.length || ''} 条到北科云盘`
      : `上传 ${validItems.length || ''} 条到 GitHub`
    );
    return <>
      <button onClick={onClose} className="btn-ghost">取消</button>
      <button onClick={submit} disabled={!canSubmit} className="btn-neon btn-neon-yellow">
        <CloudUpload size={14} /> {btnLabel}
      </button>
    </>;
  })();

  return (
    <Modal title="发布作业" onClose={onClose} footer={footer}>
      <div className="space-y-3">
        {published ? (
          <div className="space-y-3">
            <div className="p-3 rounded-md border border-neon-green/40 bg-neon-green/5 space-y-2">
              <div className="flex items-center gap-2 text-neon-green font-bold text-sm"><CheckCircle2 size={16} /> 发布成功，已落到本地</div>
              <div className="font-mono text-xs text-text-secondary">
                本次发布 <span className="text-neon-green font-bold">{published.entriesPublished}</span> 条作业 · 上课 {published.sessionDate}
              </div>
              <div className="font-mono text-[10px] text-text-dim leading-relaxed">
                {published.bundleCreated
                  ? '✦ 首次发布 — 新建了一个码包'
                  : <>本码包现在共 <span className="text-neon-green font-bold">{published.entriesCount ?? '?'}</span> 条作业</>}
                。把下面这个 8 位「同步作业码」发给同学，同学点「接收作业」即可一次导入全部 {published.entriesCount ?? ''} 条：
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-text-dim text-xs shrink-0 w-20">同步作业码</span>
                <span className="text-neon-green tracking-widest font-bold text-base">{published.syncCode}</span>
                <button onClick={() => doCopy('sync')} className="btn-ghost p-1 text-[9px]">
                  {copied === 'sync' ? <CheckCircle2 size={13} className="text-neon-green" /> : '复制'}
                </button>
              </div>
              {published.perTarget && published.perTarget.length > 1 && (
                <div className="font-mono text-[10px] text-text-dim border-t border-neon-green/15 pt-1">
                  {published.perTarget.map((t) => (
                    <span key={t.target} className={`mr-2 ${t.ok ? 'text-neon-green' : 'text-neon-danger'}`}>
                      {t.target === 'github' ? 'GitHub' : '北科云盘'}{t.ok ? ` ✓ ${t.entriesCount ?? 0} 条` : ` ✗ ${t.error || '失败'}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {published.fileUrl && (
              <button onClick={() => window.taskAPI.updater.openExternal(published.fileUrl!)} className="btn-ghost text-xs">
                <ExternalLink size={12} /> 在浏览器查看仓库里的作业文件
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 说明 */}
            <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10 text-[11px] font-mono text-text-dim leading-relaxed">
              同节课可一次性发布多条作业（每条独立标题/截止），共享同一个同步作业码。接收方输入这个码能一次拿到全部条目。
            </div>

            {/* 发布目标 */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-dim shrink-0">发布到</span>
              {([['github', 'GitHub'], ['cloud', '北科云盘（需校园网）']] as const).map(([v, label]) => (
                <label
                  key={v}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono border cursor-pointer transition-colors ${targets[v] ? 'border-neon-green bg-neon-green/15 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={targets[v]}
                    onChange={(e) => setTargets({ ...targets, [v]: e.target.checked })}
                    className="w-3 h-3 accent-neon-green"
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* 课程 + 上课日期（共享给所有条目） */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="课程 *">
                <select
                  value={courseId ?? ''}
                  onChange={(e: any) => setCourseId(Number(e.target.value))}
                  className="input-neon"
                >
                  {courses.length === 0 && <option value="">（暂无课程，请先在「课程」页新建）</option>}
                  {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="上课日期 *（本节作业日期）">
                <input type="date" value={sessionDate} onChange={(e: any) => setSessionDate(e.target.value)} className="input-neon" />
              </Field>
            </div>
            {sessionOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {sessionOptions.map(o => {
                  const active = o.date === sessionDate;
                  return (
                    <button
                      key={o.date}
                      onClick={() => setSessionDate(o.date)}
                      className={`px-2 py-1 rounded text-[10px] font-mono border transition-colors ${active ? 'border-neon-green bg-neon-green/15 text-neon-green' : 'border-neon-green/20 text-text-secondary hover:border-neon-green/50'}`}
                    >
                      {o.date.slice(5)} {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(o.date).day()]} {o.time}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 作业条目列表（v1.1.8+ 批量发布） */}
            <div className="rounded-md border border-neon-green/20 bg-ink-base/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="label-tag text-[11px]">本节作业 · {items.length} 条 · {validItems.length} 已填</span>
                <button
                  onClick={addItem}
                  className="px-2 py-0.5 rounded text-[10px] font-mono border border-neon-green/40 bg-neon-green/10 text-neon-green hover:bg-neon-green/20 transition-colors"
                >
                  <Plus size={11} className="inline -mt-0.5" /> 添加作业条目
                </button>
              </div>
              {items.map((it, idx) => (
                <EntryEditor
                  key={idx}
                  item={it}
                  canRemove={items.length > 1}
                  autoFocus={idx === items.length - 1}
                  onChange={(patch) => updateItem(idx, patch)}
                  onRemove={() => removeItem(idx)}
                />
              ))}
            </div>

            {/* secret edit（可选） */}
            <div className="p-2 rounded-md border border-neon-yellow/20 bg-neon-yellow/5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={secretMode} onChange={(e) => setSecretMode(e.target.checked)} className="accent-[#FFCC00]" />
                <span className="font-mono text-[11px] text-text-secondary">
                  <strong className="text-neon-yellow">secret edit（可选）</strong>：开启后只有输入「作业发布码」才能改这个码包。
                  默认关闭——只要有 GitHub 令牌就能改（一般场景够用；想限制修改权限再勾）。
                </span>
              </label>
              {secretMode && (
                <div className="mt-2">
                  <input
                    value={publishCode}
                    onChange={(e: any) => {
                      // IME 合成中保留原文，避免打断中文输入；合成结束再 toUpperCase
                      const v = e.target.value;
                      setPublishCode(e.nativeEvent?.isComposing ? v : v.toUpperCase());
                    }}
                    className="input-neon font-mono tracking-widest text-xs"
                    placeholder="12 位发布码（如 7KQ2M4XPT9F3）"
                    maxLength={12}
                  />
                </div>
              )}
            </div>

            {error && <div className="p-2 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs">✗ {error}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}

/** 单条作业条目编辑器（用于批量发布弹窗内的列表项） */
function EntryEditor({
  item, onChange, onRemove, canRemove, autoFocus,
}: {
  item: { type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string };
  onChange: (patch: Partial<{ type: 'homework' | 'exam' | 'project' | 'reading' | 'other'; title: string; content: string; dueDate: string }>) => void;
  onRemove: () => void;
  canRemove: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="rounded border border-neon-green/15 bg-ink-base/30 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={item.type}
          onChange={(e: any) => onChange({ type: e.target.value })}
          className="input-neon text-[11px] px-1.5 py-0.5"
          style={{ width: '78px' }}
        >
          <option value="homework">作业</option>
          <option value="exam">考试</option>
          <option value="project">项目</option>
          <option value="reading">阅读</option>
          <option value="other">其他</option>
        </select>
        <input
          value={item.title}
          onChange={(e: any) => onChange({ title: e.target.value })}
          className="input-neon text-xs flex-1"
          placeholder="如：第三章习题 1-10"
          autoFocus={autoFocus}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded text-neon-danger/70 hover:text-neon-danger hover:bg-neon-danger/10 transition-colors"
            title="删除这条"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <textarea
        value={item.content}
        onChange={(e: any) => onChange({ content: e.target.value })}
        rows={2}
        className="input-neon text-xs w-full"
        placeholder="具体要求（可选）"
      />
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-text-dim shrink-0 font-mono">截止</span>
        <input
          type="datetime-local"
          value={item.dueDate}
          onChange={(e: any) => onChange({ dueDate: e.target.value })}
          className="input-neon text-[11px] py-0.5"
          style={{ width: 'auto' }}
        />
        <span className="text-text-dim font-mono">（默认上课日 23:59）</span>
      </div>
    </div>
  );
}

/** 接收作业弹窗：输入同步作业码 → 从 GitHub 拉取这个包 → 匹配本地课程 → 自动挂载。
 *  v1.1.3：远端 bundle 引用的本地课程缺失时不再自动建课，而是弹窗告知让用户主动同步课程。
 */
export function ReceiveHomeworkModal({ onClose, onSynced }: { onClose: () => void; onSynced: () => Promise<void> }) {
  const [syncCode, setSyncCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean; error?: string; source?: string; courseName?: string; courseNotFound?: boolean;
    syncCode?: string;
    courseCandidates?: Array<{ id: number; name: string; code?: string | null; instructor?: string | null }>;
    entries: number; created: number; updated: number;
    coursesTouched: number; coursesCreated: string[];
    /** v1.1.8+：按课程分组的精确挂载计数（多平行班时分别列出） */
    perCourse?: Array<{ courseId: number; courseName: string; entries: number; created: number; updated: number }>;
    items: Array<{ courseId: number; courseName: string; title: string; sessionDate: string; action: 'created' | 'updated' }>;
    /** v1.1.9+：跨课程混包中缺课程而跳过的条目 */
    skipped?: Array<{ title: string; courseName: string; reason: string }>;
    /** v1.2.0+：接收时自动合并掉的本地重复条目数 */
    deduped?: number;
  } | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [creatingCourse, setCreatingCourse] = useState(false);

  useEffect(() => {
    window.taskAPI.homework.config().then(cfg => setLastSync(cfg.lastSync));
  }, []);

  const run = async (overrideCode?: string, chooseCourseId?: number) => {
    const code = (overrideCode ?? syncCode).trim();
    if (busy || !code) return;
    setBusy(true); setResult(null);
    try {
      // v1.1.6：chooseCourseId = 同名多课时用户手选的课程；首次接收不传，由后端按 guid/课程名匹配
      const r = await window.taskAPI.homework.receive(code, chooseCourseId);
      setResult(r);
      if (r.ok) {
        setLastSync(r.syncedAt);
        await onSynced();
      }
    } finally {
      setBusy(false);
    }
  };

  /** 在本地新建缺失的课程，然后再次接收把作业挂上去 */
  const createMissingCourseAndReceive = async () => {
    if (!result?.courseName || busy || creatingCourse) return;
    setCreatingCourse(true);
    try {
      const created = await window.taskAPI.db.courses.create({
        name: result.courseName,
        description: '由作业接收自动创建（请补全课程信息）',
      });
      // 新课程建好后再次接收，把作业挂到新课程上
      setSyncCode(result.syncCode || syncCode);
      setResult(null);
      await run(result.syncCode || syncCode);
      // 让父组件刷新（onSynced 已在 run 里调过）
      await onSynced();
    } catch (e: any) {
      setResult({
        ok: false, error: '新建课程失败：' + (e?.message || e),
        entries: 0, created: 0, updated: 0, coursesTouched: 0, coursesCreated: [], items: [],
      });
    } finally {
      setCreatingCourse(false);
    }
  };

  return (
    <Modal
      title="接收作业"
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-ghost">关闭</button>
        <button onClick={() => run()} disabled={busy || !syncCode.trim()} className="btn-neon">
          <CloudDownload size={14} className={busy ? 'animate-bounce' : ''} /> {busy ? '接收中…' : '接收作业'}
        </button>
      </>}
    >
      <div className="space-y-3">
        <div className="p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10 text-[11px] font-mono text-text-dim">
          输入发布者分享的同步作业码，从 GitHub 拉取对应课程作业包，自动挂到本地同名课程。
          {lastSync ? <span className="block mt-1">上次接收：{dayjs(lastSync).format('YYYY-MM-DD HH:mm')}</span> : <span className="block mt-1">还没接收过</span>}
        </div>

        <Field label="同步作业码 *">
          <input
            value={syncCode}
            autoFocus
            onChange={(e: any) => {
              // IME 合成中保留原文，避免打断中文输入
              const v = e.target.value;
              setSyncCode(e.nativeEvent?.isComposing ? v : v.toUpperCase());
              setResult(null);
            }}
            onKeyDown={(e: any) => e.key === 'Enter' && run()}
            className="input-neon font-mono tracking-widest"
            placeholder="8 位，如 7KQ2M4XP"
            maxLength={8}
          />
        </Field>

        {/* 同名多门课程：弹窗手选挂载目标（v1.1.6） */}
        {result && !result.ok && (result.courseCandidates?.length ?? 0) > 0 && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="flex items-center gap-2 text-neon-yellow font-bold text-sm">
              <AlertCircle size={15} /> 同名课程 · 请选择挂载目标
            </div>
            <div className="font-mono text-xs text-text-secondary">
              本地有 {result.courseCandidates!.length} 门「<span className="text-neon-yellow font-bold">{result.courseName}</span>」，这个作业包没有可辨别的课程标识（老格式包），不会自动乱挂。
            </div>
            <div className="space-y-1">
              {result.courseCandidates!.map(c => (
                <button
                  key={c.id}
                  onClick={() => run(result.syncCode || syncCode, c.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded border border-neon-green/20 hover:border-neon-green/60 bg-ink-base/40 text-left transition-colors"
                >
                  <span className="text-sm text-text-secondary truncate">{c.name}</span>
                  {c.code && <span className="font-mono text-[10px] text-text-dim shrink-0">{c.code}</span>}
                  {c.instructor && <span className="font-mono text-[10px] text-text-dim shrink-0">· {c.instructor}</span>}
                  <span className="ml-auto font-mono text-[9px] text-neon-green shrink-0">选它 →</span>
                </button>
              ))}
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              提示：让发布方用 v1.1.6+ 重新发布一次，包里会带课程标识，以后就能自动精确挂载。
            </div>
          </div>
        )}

        {/* 课程缺失：弹窗告知 */}
        {result && !result.ok && result.courseNotFound && (
          <div className="p-3 rounded-md border border-neon-yellow/40 bg-neon-yellow/5 space-y-2">
            <div className="flex items-center gap-2 text-neon-yellow font-bold text-sm">
              <AlertCircle size={15} /> 本地没有同名课程
            </div>
            <div className="font-mono text-xs text-text-secondary">
              远端作业包引用了课程「<span className="text-neon-yellow font-bold">{result.courseName}</span>」，但你本地还没有这门课。
            </div>
            <div className="font-mono text-[10px] text-text-dim">
              接收作业要求「本地已存在同名课程」（避免被远端包任意新建空课）。两种处理：
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={createMissingCourseAndReceive}
                disabled={creatingCourse}
                className="btn-neon btn-neon-yellow text-xs"
              >
                <Plus size={12} /> {creatingCourse ? '建课中…' : '新建该课程并接收'}
              </button>
              <button onClick={onClose} className="btn-ghost text-xs">
                我先去手动添加课程
              </button>
            </div>
          </div>
        )}

        {/* 接收成功 */}
        {result?.ok && (
          <div className="space-y-2">
            <div className="p-3 rounded-md border border-neon-green/40 bg-neon-green/5">
              <div className="flex items-center gap-2 text-neon-green font-bold text-sm"><CheckCircle2 size={16} /> 接收成功</div>
              <div className="font-mono text-xs text-text-secondary mt-2">
                课程「{result.courseName}」· 来源 {result.source === 'cloud' ? '云盘' : 'GitHub'} ·
                远端共 <span className="text-text-secondary font-bold">{result.entries}</span> 条作业
                {result.coursesTouched > 1 && <> · 命中 <span className="text-neon-green font-bold">{result.coursesTouched}</span> 门课程</>}
              </div>
              {/* 多课程时按课程分组展示精确挂载数（v1.1.8+） */}
              {result.perCourse && result.perCourse.length > 1 ? (
                <div className="mt-2 space-y-1">
                  {result.perCourse.map((pc) => (
                    <div key={pc.courseId} className="flex items-center gap-2 px-2 py-1 rounded bg-ink-base/40 border border-neon-green/15 text-[11px] font-mono">
                      <span className="text-text-secondary truncate">{pc.courseName}</span>
                      <span className="ml-auto text-text-dim text-[10px] shrink-0">{pc.entries} 条</span>
                      <span className="text-neon-green shrink-0">新增 {pc.created}</span>
                      <span className="text-neon-yellow shrink-0">更新 {pc.updated}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="font-mono text-[10px] text-text-secondary mt-1">
                  新增 <span className="text-neon-green font-bold">{result.created}</span> 条 · 更新 <span className="text-neon-yellow font-bold">{result.updated}</span> 条
                </div>
              )}
              {result.coursesCreated.length > 0 && (
                <div className="font-mono text-[10px] text-neon-yellow mt-1">本次新建课程：{result.coursesCreated.join('、')}</div>
              )}
              {(result.deduped ?? 0) > 0 && (
                <div className="font-mono text-[10px] text-neon-yellow mt-1">已自动合并 {result.deduped} 条重复作业（历史同步产生的重复已清理）</div>
              )}
            </div>
            {result.items.length > 0 && (
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {result.items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-ink-base/40 border border-neon-green/10 text-[11px]">
                    <span className={`px-1 rounded text-[9px] font-mono shrink-0 ${it.action === 'created' ? 'border border-neon-green/40 text-neon-green' : 'border border-neon-yellow/40 text-neon-yellow'}`}>
                      {it.action === 'created' ? '新增' : '更新'}
                    </span>
                    <span className="text-text-secondary truncate">{it.courseName}</span>
                    <span className="flex-1 min-w-0 truncate text-text-secondary">· {it.title}</span>
                    <span className="font-mono text-[9px] text-text-dim shrink-0">{it.sessionDate?.slice(5) || ''}</span>
                  </div>
                ))}
              </div>
            )}
            {result.entries === 0 && (
              <div className="py-2 text-center font-mono text-xs text-text-dim">这个码包里还没有作业条目</div>
            )}
            {(result.skipped?.length ?? 0) > 0 && (
              <div className="p-2 rounded-md border border-neon-yellow/30 bg-neon-yellow/5 space-y-1">
                <div className="flex items-center gap-1.5 text-neon-yellow text-[11px] font-bold">
                  <AlertCircle size={12} /> 有 {result.skipped!.length} 条作业没挂上（本地缺对应课程）
                </div>
                {result.skipped!.map((s, i) => (
                  <div key={i} className="font-mono text-[10px] text-text-secondary">
                    「{s.courseName}」{s.title} · {s.reason}
                  </div>
                ))}
                <div className="font-mono text-[10px] text-text-dim">在「课程」页新建对应课程后再接收一次即可挂上。</div>
              </div>
            )}
          </div>
        )}

        {/* 其它失败 */}
        {result && !result.ok && !result.courseNotFound && (result.courseCandidates?.length ?? 0) === 0 && (
          <div className="p-2 rounded-md border border-neon-danger/50 text-neon-danger bg-neon-danger/5 font-mono text-xs whitespace-pre-wrap">✗ {result.error || '接收失败'}</div>
        )}
      </div>
    </Modal>
  );
}