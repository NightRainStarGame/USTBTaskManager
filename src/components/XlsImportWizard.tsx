/**
 * 课表 Excel 导入向导（**共用组件**）。
 *
 * v1.2.17：从 Settings.tsx 里搬出来 —— 原来向导只长在设置页里，用户得先想到去设置；
 * 而「我有课表文件」这个念头出现的地方是课程页。现在课程页顶部（作业同步左边）
 * 与设置页共用这一个实现，改规则只改一处。
 *
 * v1.2.17 同时加了「学校档案」：不同学校的教务导出格式差别极大（格子表 / 记录表、
 * 列名、周次写法都不同），与其写一个谁都不像的万能解析器，不如让用户先选自己学校，
 * 再由对应档案解析。档案清单来自 electron/timetable-xls/profiles。
 */
import { useCallback, useEffect, useState } from 'react';
import { Calendar, FileSpreadsheet, GraduationCap } from 'lucide-react';
import dayjs from 'dayjs';
import Modal from '@/components/Modal';
import type { XlsFieldMapping, XlsImportSummary, XlsParseResult, XlsProfile } from '@/types';

const EMPTY_MAPPING: XlsFieldMapping = { className: -1, teacher: -1, weeks: -1, day: -1, period: -1, location: -1 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-text-secondary block mb-1">{label}</span>
      {children}
    </label>
  );
}

export default function XlsImportWizard({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** 导入成功后回调（让课程页刷新列表） */
  onImported?: () => void;
}) {
  const [step, setStep] = useState<'file' | 'mapping' | 'options' | 'preview' | 'done'>('file');
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<XlsProfile[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<XlsParseResult | null>(null);
  const [mapping, setMapping] = useState<XlsFieldMapping>(EMPTY_MAPPING);
  const [xn, setXn] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);
  const [xq, setXq] = useState<'1' | '2'>((new Date().getMonth() + 1) >= 8 || (new Date().getMonth() + 1) <= 1 ? '1' : '2');
  const [start, setStart] = useState(dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD'));
  const [replace, setReplace] = useState(true);
  const [summary, setSummary] = useState<XlsImportSummary | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = useCallback(async () => {
    setStep('file'); setBusy(false); setFile(null); setParsed(null);
    setMapping(EMPTY_MAPPING); setSummary(null); setMsg(null);
    try {
      const list = await window.taskAPI.xls.listProfiles();
      setProfiles(list);
      setProfileId(list[0]?.id || '');
    } catch { setProfiles([]); }
  }, []);

  useEffect(() => { if (open) void reset(); }, [open, reset]);

  /** 选文件 + 解析；解析结果里的学期信息回填到表单（用户仍可改） */
  const pick = async () => {
    setBusy(true); setMsg(null);
    try {
      const fp = await window.taskAPI.xls.pickFile();
      if (!fp) return;
      const r = await window.taskAPI.xls.parseFile(fp, profileId || undefined);
      setFile(fp); setParsed(r); setMapping(r.mapping);
      if (r.profile?.id && r.profile.id !== profileId) setProfileId(r.profile.id);
      if (r.term?.xn) setXn(r.term.xn);
      if (r.term?.xq) setXq(r.term.xq);
      if (r.term?.semesterStart) setStart(dayjs(r.term.semesterStart).format('YYYY-MM-DD'));
      setStep(r.needMapping ? 'mapping' : 'options');
    } catch (e: any) { setMsg({ ok: false, text: e?.message || '解析失败' }); }
    finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true); setMsg(null);
    try {
      const s = await window.taskAPI.xls.importItems(parsed.items, {
        xn, xq, semesterStart: dayjs(start).startOf('day').valueOf(), replaceExisting: replace,
      });
      setSummary(s); setStep('done');
      onImported?.();
    } catch (e: any) { setMsg({ ok: false, text: e?.message || '导入失败' }); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  const activeProfile = profiles.find((p) => p.id === profileId);
  const detectedOther = parsed && parsed.detected.confidence >= 85 && parsed.detected.id !== profileId;

  return (
    <Modal
      title={`从 Excel 导入课表${parsed ? ` · ${parsed.sheetName}` : ''}`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        step === 'done' ? (
          <button onClick={onClose} className="btn-neon">完成</button>
        ) : (
          <>
            <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
            {step === 'file' && (
              <button onClick={pick} disabled={busy || !profiles.length} className="btn-neon">
                <FileSpreadsheet size={14} /> {busy ? '解析中…' : '选择文件并解析'}
              </button>
            )}
            {step === 'mapping' && (
              <>
                <button onClick={() => { setParsed(null); setFile(null); setStep('file'); }} className="btn-ghost">重选文件</button>
                <button onClick={async () => {
                  if (!parsed) return;
                  setBusy(true); setMsg(null);
                  try {
                    const rep = await window.taskAPI.xls.reparse(parsed, mapping);
                    setParsed(rep);
                    if (rep.mapping.className < 0 || rep.mapping.weeks < 0 || rep.mapping.day < 0 || rep.mapping.period < 0) {
                      setMsg({ ok: false, text: '必填字段（课程名/周次/星期/节次）必须全部指定列' });
                      return;
                    }
                    setStep('options');
                  } catch (e: any) { setMsg({ ok: false, text: e?.message || '解析失败' }); }
                  finally { setBusy(false); }
                }} disabled={busy} className="btn-neon">下一步</button>
              </>
            )}
            {step === 'options' && <button onClick={() => setStep('preview')} className="btn-neon">下一步：预览</button>}
            {step === 'preview' && (
              <button onClick={doImport} disabled={busy || !parsed} className="btn-neon btn-neon-yellow">
                <Calendar size={14} /> {busy ? '导入中…' : '确认导入'}
              </button>
            )}
          </>
        )
      }
    >
      <div className="space-y-3">
        {step === 'file' && (
          <div className="text-sm text-text-secondary space-y-3">
            <Field label="你的学校（决定用哪个解析器）">
              <select className="input-neon" value={profileId} onChange={(e) => { setProfileId(e.target.value); setParsed(null); }}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            {activeProfile?.note && (
              <p className="text-[11px] text-text-dim font-mono">· {activeProfile.note}</p>
            )}
            <p className="text-text-dim text-xs">
              在教务系统里导出课表（教学管理系统 → 我的课表 → 导出 Excel），选好学校后点下面按钮选文件。
              识别到的学期/开学日会从文件里直接读出来，不用手填。
            </p>
          </div>
        )}

        {step === 'mapping' && parsed && (
          <div className="space-y-3">
            <div className="text-xs text-text-dim font-mono">
              已读取 <strong className="text-neon-green">{parsed.totalRows}</strong> 行 · 表头 <strong>{parsed.headers.length}</strong> 列 · 解析出 <strong className="text-neon-green">{parsed.items.length}</strong> 条 · 跳过 {parsed.badRows.length} 条
            </div>
            {(['className','teacher','weeks','day','period','location'] as const).map((key) => (
              <Field key={key} label={
                key === 'className' ? '课程名称 *' :
                key === 'teacher' ? '教师' :
                key === 'weeks' ? '周次 *' :
                key === 'day' ? '星期 *' :
                key === 'period' ? '节次/时间 *' : '教室/地点'
              }>
                <select className="input-neon" value={mapping[key]} onChange={async (e) => {
                  const v = parseInt(e.target.value, 10);
                  const next = { ...mapping, [key]: v };
                  setMapping(next);
                  try { setParsed(await window.taskAPI.xls.reparse(parsed, next)); } catch { /* ignore */ }
                }}>
                  <option value={-1}>— 不映射 —</option>
                  {parsed.headers.map((h, i) => <option key={i} value={i}>{i + 1}. {h || `列${i + 1}`}</option>)}
                </select>
              </Field>
            ))}
          </div>
        )}

        {/* 警告 / 坏行：mapping、options、preview 三步共用一份展示 */}
        {(step === 'mapping' || step === 'preview' || step === 'options') && parsed && (
          <>
            {detectedOther && (
              <div className="p-2 rounded bg-neon-yellow/10 border border-neon-yellow/30 text-xs text-neon-yellow">
                · 这份文件看起来更像「{profiles.find((p) => p.id === parsed.detected.id)?.name || parsed.detected.id}」导出的，
                可以回到上一步换成它再解析一次。
              </div>
            )}
            {parsed.warnings.length > 0 && (
              <div className="p-2 rounded bg-neon-yellow/10 border border-neon-yellow/30 text-xs text-neon-yellow space-y-1">
                {parsed.warnings.map((w, i) => <div key={i}>· {w}</div>)}
              </div>
            )}
            {parsed.badRows.length > 0 && (
              <details className="text-xs text-text-dim font-mono">
                <summary className="cursor-pointer">跳过的行（{parsed.badRows.length}）</summary>
                <div className="mt-1 max-h-32 overflow-y-auto p-2 rounded bg-ink-base/40 border border-neon-green/10">
                  {parsed.badRows.map((b, i) => <div key={i}>第 {b.row} 行：{b.reason}</div>)}
                </div>
              </details>
            )}
          </>
        )}

        {step === 'options' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="学年">
                <input value={xn} onChange={(e) => setXn(e.target.value)} className="input-neon" placeholder="2026-2027" />
              </Field>
              <Field label="学期">
                <select className="input-neon" value={xq} onChange={(e) => setXq(e.target.value as '1' | '2')}>
                  <option value="1">秋季学期（1）</option>
                  <option value="2">春季学期（2）</option>
                </select>
              </Field>
            </div>
            <Field label="开学日（第 1 周周一）">
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-neon" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="accent-neon-green" />
              <span>替换之前的课表导入（教务 / Excel）</span>
            </label>
            <div className="text-[10px] text-text-dim font-mono p-2 rounded bg-ink-base/40 border border-neon-green/10">
              取消勾选则与已有导入并存（不推荐：会重复显示同一门课）。手动添加的课程/作业完全不受影响。
            </div>
          </div>
        )}

        {step === 'preview' && parsed && (
          <div className="space-y-2">
            <div className="text-xs text-text-dim font-mono">
              解析 <strong className="text-neon-green">{parsed.items.length}</strong> 条（预览前 {parsed.preview.length} 条）· 跳过 {parsed.badRows.length} 条
            </div>
            <div className="max-h-72 overflow-y-auto rounded border border-neon-green/15">
              <table className="w-full text-xs font-mono">
                <thead className="bg-neon-green/10 text-neon-green">
                  <tr><th className="p-1.5 text-left">星期</th><th className="p-1.5 text-left">节次</th><th className="p-1.5 text-left">课程</th><th className="p-1.5 text-left">教师</th><th className="p-1.5 text-left">周次</th><th className="p-1.5 text-left">教室</th></tr>
                </thead>
                <tbody>
                  {parsed.preview.map((it, i) => (
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
            {parsed.items.length > parsed.preview.length && (
              <div className="text-[10px] text-text-dim font-mono">仅预览前 {parsed.preview.length} 条，导入会写入全部 {parsed.items.length} 条。</div>
            )}
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-3">
            <div className="p-4 rounded-md bg-neon-green/5 border border-neon-green/30 text-sm space-y-1">
              <div className="font-bold text-neon-green text-base">✓ 导入成功</div>
              <div className="font-mono text-xs space-y-0.5">
                <div>课程：<strong className="text-neon-green">{summary.courses}</strong> 门</div>
                <div>课表事件：<strong className="text-neon-green">{summary.events}</strong> 条（按周展开后）</div>
                <div>原始记录：{summary.items} 条</div>
              </div>
            </div>
            {summary.warnings.length > 0 && (
              <div className="p-2 rounded bg-neon-yellow/10 border border-neon-yellow/30 text-xs text-neon-yellow space-y-1">
                {summary.warnings.map((w, i) => <div key={i}>· {w}</div>)}
              </div>
            )}
            <div className="text-xs text-text-dim font-mono">
              提示：到「课程 → 课表日历」或「课程 → 课程卡片」即可看到导入的课程。点课程卡片可以添加每节课的作业。
            </div>
          </div>
        )}

        {msg && (
          <div className={`p-2 rounded text-xs font-mono whitespace-pre-wrap break-all ${msg.ok ? 'bg-neon-green/10 border border-neon-green/30 text-neon-green' : 'bg-neon-danger/10 border border-neon-danger/30 text-neon-danger'}`}>
            {msg.ok ? '✓ ' : '✗ '}{msg.text}
          </div>
        )}
      </div>
    </Modal>
  );
}

