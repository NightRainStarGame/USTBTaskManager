/**
 * v1.2.3 学业页：成绩管理（GPA/挂科预警/趋势条形）· 考试周模式（倒计时+复习任务生成）· 出勤打卡（按课程按天）
 */
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import clsx from '../utils/clsx';
import Modal from '../components/Modal';
import { useStore } from '@/store';
import type { Grade, Exam } from '@/types';
import {
  GraduationCap, Plus, Pencil, Trash2, Trophy, AlertTriangle, CalendarClock,
  MapPin, Clock, CheckCircle2, ChevronDown, ChevronRight, UserCheck,
  Undo2, BookOpen, Zap,
} from 'lucide-react';

type Tab = 'grades' | 'exams' | 'attendance';

const COMPONENT_LABELS: Record<string, string> = {
  total: '总评', regular: '平时', midterm: '期中', final: '期末', other: '其他',
};

/** 4.0 制绩点映射（与小程序·绩点计算器一致） */
const gpaOf = (score: number): number => {
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

export default function AcademicPage() {
  const [tab, setTab] = useState<Tab>('grades');

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <GraduationCap className="text-neon-green" size={24} />
            学业 <span className="font-mono text-xs text-text-dim">ACADEMIC</span>
          </h1>
          <p className="text-sm text-text-dim mt-1">成绩 · 考试 · 出勤 一屏掌握</p>
        </div>
      </header>

      {/* Tab 切换 */}
      <div className="flex gap-2">
        {([
          ['grades', '成绩'], ['exams', '考试'], ['attendance', '出勤'],
        ] as Array<[Tab, string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              'px-4 py-2 rounded-md font-mono text-xs uppercase tracking-wider transition-all',
              tab === k
                ? 'bg-neon-green/10 text-neon-green border border-neon-green/40 shadow-neon-green'
                : 'text-text-secondary border border-neon-green/10 hover:text-neon-green hover:border-neon-green/30 bg-ink-900/40'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'grades' && <GradesTab />}
      {tab === 'exams' && <ExamsTab />}
      {tab === 'attendance' && <AttendanceTab />}
    </div>
  );
}

// ══════════════════ 成绩 Tab ══════════════════
function GradesTab() {
  const courses = useStore(s => s.courses);
  const refreshAll = useStore(s => s.refreshAll);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [semesterFilter, setSemesterFilter] = useState<string>('all');
  const [editing, setEditing] = useState<Grade | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => setGrades(await window.taskAPI.db.grades.list());
  useEffect(() => { load(); }, []);

  const semesters = useMemo(() => {
    const set = new Set<string>();
    grades.forEach(g => g.semester && set.add(g.semester));
    return Array.from(set).sort().reverse();
  }, [grades]);

  const visible = useMemo(
    () => semesterFilter === 'all' ? grades : grades.filter(g => g.semester === semesterFilter),
    [grades, semesterFilter]
  );

  // 统计：按课程取「总评」或最高分作代表 → 加权 GPA / 均分 / 挂科
  const perCourse = useMemo(() => {
    const byCourse = new Map<number, Grade[]>();
    visible.forEach(g => {
      if (!byCourse.has(g.course_id)) byCourse.set(g.course_id, []);
      byCourse.get(g.course_id)!.push(g);
    });
    return Array.from(byCourse.entries()).map(([cid, list]) => {
      const total = list.find(g => g.component === 'total' && g.score != null)
        || list.filter(g => g.score != null).sort((a, b) => (b.score || 0) - (a.score || 0))[0]
        || null;
      const course = courses.find(c => c.id === cid);
      return {
        courseId: cid,
        courseName: course?.name || `课程#${cid}`,
        courseColor: course?.color || '#00FF88',
        score: total?.score ?? null,
        credit: total?.credit || list.reduce((s, g) => s + (g.credit || 0), 0),
        grade: total,
        parts: list.filter(g => g !== total),
      };
    }).sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  }, [visible, courses]);

  const scored = perCourse.filter(p => p.score != null);
  const totalCredit = scored.reduce((s, p) => s + (p.credit || 0), 0);
  const weightedGpa = totalCredit > 0
    ? scored.reduce((s, p) => s + gpaOf(p.score!) * (p.credit || 0), 0) / totalCredit : 0;
  const avgScore = totalCredit > 0
    ? scored.reduce((s, p) => s + p.score! * (p.credit || 0), 0) / totalCredit : 0;
  const failed = scored.filter(p => p.score! < 60);

  return (
    <div className="space-y-6">
      {/* GPA 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="加权绩点 GPA" value={weightedGpa.toFixed(2)} color="yellow" icon={<Trophy size={16} />} />
        <StatCard label="加权平均分" value={avgScore.toFixed(1)} color="green" />
        <StatCard label="已修学分（有成绩）" value={String(totalCredit)} color="blue" />
        <StatCard
          label="挂科预警" value={`${failed.length} 门`} color={failed.length ? 'danger' : 'green'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* 挂科横幅 */}
      {failed.length > 0 && (
        <div className="glass-panel border-neon-danger/40 p-3 flex items-center gap-2 text-sm text-neon-danger">
          <AlertTriangle size={16} className="shrink-0" />
          <span>挂科预警：{failed.map(f => f.courseName).join('、')} —— 补考/重修安排上了吗？</span>
        </div>
      )}

      {/* 操作行 */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setCreating(true)} className="btn-neon px-3 py-2 text-xs font-mono flex items-center gap-1.5">
          <Plus size={14} /> 录入成绩
        </button>
        <select
          value={semesterFilter}
          onChange={e => setSemesterFilter(e.target.value)}
          className="input-neon text-xs py-2"
        >
          <option value="all">全部学期</option>
          {semesters.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="font-mono text-[10px] text-text-dim">{visible.length} 条记录</span>
      </div>

      {/* 成绩条形图（各课程代表分） */}
      {scored.length > 0 && (
        <div className="glass-panel p-4 space-y-3">
          <p className="label-tag">成绩分布</p>
          <div className="space-y-2">
            {perCourse.filter(p => p.score != null).map(p => (
              <div key={p.courseId} className="flex items-center gap-3">
                <span className="w-28 text-xs text-text-secondary truncate shrink-0" title={p.courseName}>{p.courseName}</span>
                <div className="flex-1 h-4 bg-ink-900/70 rounded overflow-hidden relative border border-neon-green/10">
                  <div
                    className="h-full rounded transition-all"
                    style={{
                      width: `${Math.min(100, (p.score! / 100) * 100)}%`,
                      background: p.score! < 60
                        ? 'linear-gradient(90deg,#FF6B81CC,#FF3355)'
                        : `linear-gradient(90deg,${p.courseColor}55,${p.courseColor}DD)`,
                    }}
                  />
                  {/* 及格线 60% */}
                  <div className="absolute top-0 bottom-0 w-px bg-neon-yellow/50" style={{ left: '60%' }} />
                </div>
                <span className={clsx('font-mono text-xs w-12 text-right tabular-nums', p.score! < 60 ? 'text-neon-danger' : 'text-text-primary')}>
                  {p.score!.toFixed(0)}
                </span>
                <span className="font-mono text-[10px] text-text-dim w-10 shrink-0">{p.credit || '-'}学分</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 成绩明细表 */}
      <div className="glass-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neon-green/15 text-left font-mono text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-4 py-2.5">课程</th>
              <th className="px-4 py-2.5">学期</th>
              <th className="px-4 py-2.5">组成部分</th>
              <th className="px-4 py-2.5">分数</th>
              <th className="px-4 py-2.5">学分</th>
              <th className="px-4 py-2.5 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(g => (
              <tr key={g.id} className="border-b border-neon-green/5 hover:bg-neon-green/3">
                <td className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: g.course_color || '#00FF88' }} />
                    {g.course_name || `课程#${g.course_id}`}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-text-secondary text-xs">{g.semester || '—'}</td>
                <td className="px-4 py-2.5">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neon-green/10 text-neon-green border border-neon-green/20">
                    {COMPONENT_LABELS[g.component] || g.component}
                  </span>
                </td>
                <td className={clsx('px-4 py-2.5 font-mono tabular-nums', g.score != null && g.score < 60 ? 'text-neon-danger font-bold' : 'text-text-primary')}>
                  {g.score != null ? g.score : '—'}
                  <span className="text-text-dim text-xs">/{g.full_score}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{g.credit}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(g)} className="btn-ghost p-1.5" title="编辑"><Pencil size={12} /></button>
                    <button
                      onClick={async () => { await window.taskAPI.db.grades.delete(g.id); load(); }}
                      className="btn-ghost p-1.5 text-neon-danger" title="删除"
                    ><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-dim text-sm">暂无成绩 —— 点「录入成绩」开始</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <GradeForm
          grade={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); refreshAll(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: string; color: 'green' | 'yellow' | 'danger' | 'blue'; icon?: React.ReactNode }) {
  const colors = {
    green: 'text-neon-green border-neon-green/25',
    yellow: 'text-neon-yellow border-neon-yellow/25',
    danger: 'text-neon-danger border-neon-danger/40',
    blue: 'text-sky-400 border-sky-400/25',
  }[color];
  return (
    <div className={clsx('glass-panel p-4 border', colors)}>
      <div className="flex items-center gap-1.5 text-text-dim text-xs">
        {icon}<span>{label}</span>
      </div>
      <div className={clsx('text-2xl font-bold font-mono mt-1 tabular-nums')}>{value}</div>
    </div>
  );
}

function GradeForm({ grade, onClose, onSaved }: { grade: Grade | null; onClose: () => void; onSaved: () => void }) {
  const courses = useStore(s => s.courses);
  const [form, setForm] = useState({
    course_id: grade?.course_id ?? courses[0]?.id ?? 0,
    semester: grade?.semester ?? `${dayjs().year()}-${dayjs().month() >= 7 ? '秋' : '春'}`,
    component: grade?.component ?? 'total',
    score: grade?.score != null ? String(grade.score) : '',
    credit: grade?.credit != null ? String(grade.credit) : '3',
    full_score: grade?.full_score ?? 100,
    notes: grade?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.course_id) return;
    setSaving(true);
    const data = {
      ...form,
      score: form.score === '' ? null : Number(form.score),
      credit: Number(form.credit) || 0,
      full_score: Number(form.full_score) || 100,
    };
    if (grade) await window.taskAPI.db.grades.update(grade.id, data);
    else await window.taskAPI.db.grades.create(data);
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title={grade ? '编辑成绩' : '录入成绩'} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="课程">
            <select value={form.course_id} onChange={e => setForm({ ...form, course_id: Number(e.target.value) })} className="input-neon text-sm">
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="学期（如 2026-春）">
            <input value={form.semester} onChange={e => setForm({ ...form, semester: e.target.value })} className="input-neon text-sm" placeholder="2026-春" />
          </Field>
          <Field label="组成部分">
            <select value={form.component} onChange={e => setForm({ ...form, component: e.target.value as Grade['component'] })} className="input-neon text-sm">
              {Object.entries(COMPONENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="分数">
            <input type="number" value={form.score} onChange={e => setForm({ ...form, score: e.target.value })} className="input-neon text-sm" placeholder="85" />
          </Field>
          <Field label="学分">
            <input type="number" step="0.5" value={form.credit} onChange={e => setForm({ ...form, credit: e.target.value })} className="input-neon text-sm" placeholder="3" />
          </Field>
          <Field label="满分">
            <input type="number" value={form.full_score} onChange={e => setForm({ ...form, full_score: Number(e.target.value) })} className="input-neon text-sm" />
          </Field>
        </div>
        <Field label="备注">
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-neon text-sm" placeholder="（可选）" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm font-mono">取消</button>
          <button onClick={submit} disabled={saving || !form.course_id} className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50">
            {saving ? 'SAVING…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="label-tag">{label}</div>
      {children}
    </div>
  );
}

// ══════════════════ 考试 Tab ══════════════════
function ExamsTab() {
  const refreshAll = useStore(s => s.refreshAll);
  const [exams, setExams] = useState<Exam[]>([]);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const load = async () => setExams(await window.taskAPI.db.exams.list());
  useEffect(() => { load(); }, []);

  const now = Date.now();
  const upcoming = exams.filter(e => e.status === 'upcoming' && e.exam_date >= now).sort((a, b) => a.exam_date - b.exam_date);
  const doneOrPast = exams.filter(e => !(e.status === 'upcoming' && e.exam_date >= now));

  /** 按考试生成复习任务：每科一条，截止=考前一天 22:00，去重 */
  const genReviewTasks = async (exam: Exam) => {
    setBusy(exam.id); setMsg('');
    try {
      const existing = await window.taskAPI.db.requirements.list({ courseId: exam.course_id || undefined });
      const due = exam.exam_date - 86400000 - 2 * 3600000; // 考前一天 22:00
      const title = `复习：${exam.course_name || exam.title}`;
      if (existing.some((r: any) => r.title === title && r.status !== 'done')) {
        setMsg(`「${title}」已存在复习任务`);
      } else {
        await window.taskAPI.db.requirements.create({
          course_id: exam.course_id,
          title,
          type: 'reading',
          due_date: due,
          priority: 1,
          status: 'pending',
          notes: `自动生成：${dayjs(exam.exam_date).format('MM-DD HH:mm')} 考试`,
        });
        setMsg(`已生成「${title}」（${dayjs(due).format('MM-DD')} 截止）`);
        refreshAll();
      }
    } finally {
      setBusy(null);
      setTimeout(() => setMsg(''), 4000);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => setCreating(true)} className="btn-neon px-3 py-2 text-xs font-mono flex items-center gap-1.5">
          <Plus size={14} /> 添加考试
        </button>
        {msg && <span className="text-xs text-neon-green font-mono">{msg}</span>}
      </div>

      {/* 即将到来的考试卡片 */}
      {upcoming.length === 0 && (
        <div className="glass-panel p-10 text-center text-text-dim text-sm">暂无即将到来的考试 —— 添加后可一键生成复习任务</div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {upcoming.map(e => {
          const days = Math.ceil((e.exam_date - now) / 86400000);
          const urgent = days <= 3;
          return (
            <div
              key={e.id}
              className={clsx(
                'glass-panel p-4 space-y-3 relative overflow-hidden',
                urgent && 'border-neon-yellow/40 shadow-[0_0_12px_rgba(255,197,61,0.15)]'
              )}
            >
              {/* 倒计时角标 */}
              <div className={clsx(
                'absolute top-3 right-3 font-mono text-2xl font-bold tabular-nums',
                days <= 1 ? 'text-neon-danger' : days <= 3 ? 'text-neon-yellow' : 'text-neon-green'
              )}>
                {days > 0 ? `${days}天` : '今天'}
              </div>
              <div className="flex items-center gap-2 pr-16">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.course_color || '#00FF88' }} />
                <span className="font-medium text-text-primary truncate">{e.course_name || e.title}</span>
              </div>
              <div className="space-y-1.5 text-xs text-text-secondary">
                <div className="flex items-center gap-1.5"><CalendarClock size={12} className="text-neon-green" /> {dayjs(e.exam_date).format('YYYY-MM-DD dddd HH:mm')}</div>
                {e.location && <div className="flex items-center gap-1.5"><MapPin size={12} className="text-neon-green" /> {e.location}</div>}
                {e.duration_minutes && <div className="flex items-center gap-1.5"><Clock size={12} className="text-neon-green" /> {e.duration_minutes} 分钟</div>}
                {e.notes && <div className="text-text-dim truncate" title={e.notes}>{e.notes}</div>}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => genReviewTasks(e)}
                  disabled={busy === e.id || !e.course_id}
                  className="btn-neon px-2.5 py-1.5 text-[11px] font-mono flex items-center gap-1 disabled:opacity-40"
                  title={e.course_id ? '生成考前一天截止的复习任务' : '未关联课程，无法生成'}
                >
                  <Zap size={11} /> {busy === e.id ? '生成中…' : '生成复习任务'}
                </button>
                <button onClick={() => setEditing(e)} className="btn-ghost px-2 py-1.5"><Pencil size={12} /></button>
                <button
                  onClick={async () => {
                    await window.taskAPI.db.exams.update(e.id, { ...e, status: 'done' });
                    load();
                  }}
                  className="btn-ghost px-2 py-1.5 text-neon-green" title="标记已考完"
                ><CheckCircle2 size={12} /></button>
                <button
                  onClick={async () => { await window.taskAPI.db.exams.delete(e.id); load(); }}
                  className="btn-ghost px-2 py-1.5 text-neon-danger"
                ><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 已结束/已过期 */}
      {doneOrPast.length > 0 && (
        <div>
          <button onClick={() => setShowDone(s => !s)} className="flex items-center gap-1.5 text-xs text-text-dim hover:text-neon-green font-mono mb-2">
            {showDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            已结束 / 已过期（{doneOrPast.length}）
          </button>
          {showDone && (
            <div className="glass-panel divide-y divide-neon-green/5">
              {doneOrPast.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.course_color || '#666' }} />
                  <span className="text-text-secondary truncate">{e.course_name || e.title}</span>
                  <span className="font-mono text-xs text-text-dim">{dayjs(e.exam_date).format('YYYY-MM-DD HH:mm')}</span>
                  <span className="text-xs text-text-dim">{e.status === 'done' ? '已考完' : '已过期'}</span>
                  <div className="ml-auto flex gap-1">
                    <button onClick={() => setEditing(e)} className="btn-ghost p-1.5"><Pencil size={11} /></button>
                    <button
                      onClick={async () => { await window.taskAPI.db.exams.update(e.id, { ...e, status: 'upcoming', exam_date: Date.now() + 7 * 86400000 }); load(); }}
                      className="btn-ghost p-1.5 text-neon-yellow" title="改期到下周"
                    ><Undo2 size={11} /></button>
                    <button onClick={async () => { await window.taskAPI.db.exams.delete(e.id); load(); }} className="btn-ghost p-1.5 text-neon-danger"><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(creating || editing) && (
        <ExamForm
          exam={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function ExamForm({ exam, onClose, onSaved }: { exam: Exam | null; onClose: () => void; onSaved: () => void }) {
  const courses = useStore(s => s.courses);
  const [form, setForm] = useState<{
    course_id: number | null; title: string; exam_date: string;
    location: string; duration_minutes: number | null; notes: string;
  }>({
    course_id: exam?.course_id ?? (courses[0]?.id ?? null),
    title: exam?.title ?? '期末考试',
    exam_date: dayjs(exam?.exam_date || Date.now() + 7 * 86400000).format('YYYY-MM-DDTHH:mm'),
    location: exam?.location ?? '',
    duration_minutes: exam?.duration_minutes ?? 120,
    notes: exam?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const data = {
      ...form,
      title: form.title || '考试',
      exam_date: dayjs(form.exam_date).valueOf(),
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
    };
    if (exam) await window.taskAPI.db.exams.update(exam.id, data);
    else await window.taskAPI.db.exams.create(data);
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title={exam ? '编辑考试' : '添加考试'} onClose={onClose} width="max-w-lg">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="课程">
            <select value={form.course_id ?? ''} onChange={e => setForm({ ...form, course_id: e.target.value ? Number(e.target.value) : null })} className="input-neon text-sm">
              <option value="">（不关联）</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="考试名">
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="input-neon text-sm" placeholder="期末考试" />
          </Field>
          <Field label="时间">
            <input type="datetime-local" value={form.exam_date} onChange={e => setForm({ ...form, exam_date: e.target.value })} className="input-neon text-sm" />
          </Field>
          <Field label="地点">
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} className="input-neon text-sm" placeholder="教三-401" />
          </Field>
          <Field label="时长（分钟）">
            <input type="number" value={form.duration_minutes ?? ''} onChange={e => setForm({ ...form, duration_minutes: Number(e.target.value) })} className="input-neon text-sm" placeholder="120" />
          </Field>
        </div>
        <Field label="备注">
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-neon text-sm" placeholder="可带计算器 / A4 纸质资料…" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm font-mono">取消</button>
          <button onClick={submit} disabled={saving} className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50">
            {saving ? 'SAVING…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════ 出勤 Tab ══════════════════
const ATT_STATUS = [
  { key: 'present', label: '出勤', color: 'text-neon-green border-neon-green/30' },
  { key: 'late', label: '迟到', color: 'text-neon-yellow border-neon-yellow/30' },
  { key: 'absent', label: '缺勤', color: 'text-neon-danger border-neon-danger/30' },
  { key: 'leave', label: '请假', color: 'text-sky-400 border-sky-400/30' },
] as const;

function AttendanceTab() {
  const courses = useStore(s => s.courses);
  const [records, setRecords] = useState<Array<{ id: number; course_id: number; date: string; status: string; note?: string | null; course_name?: string; course_color?: string }>>([]);
  const [todayCourse, setTodayCourse] = useState<number>(courses[0]?.id ?? 0);
  const today = dayjs().format('YYYY-MM-DD');

  const load = async () => setRecords(await window.taskAPI.db.attendance.list());
  useEffect(() => { load(); }, []);

  /** 各课程出勤统计 */
  const perCourse = useMemo(() => courses.map(c => {
    const list = records.filter(r => r.course_id === c.id);
    const cnt = { present: 0, late: 0, absent: 0, leave: 0 };
    list.forEach(r => { if (r.status in cnt) (cnt as any)[r.status]++; });
    const held = cnt.present + cnt.late + cnt.absent; // 请假不算课时
    const rate = held > 0 ? (cnt.present + cnt.late) / held : null;
    return { course: c, cnt, rate, total: list.length };
  }), [courses, records]);

  const quickMark = async (status: string) => {
    if (!todayCourse) return;
    await window.taskAPI.db.attendance.upsert({ course_id: todayCourse, date: today, status });
    load();
  };

  const todayMarked = new Set(records.filter(r => r.date === today).map(r => r.course_id));

  return (
    <div className="space-y-5">
      {/* 快速打卡（今天） */}
      <div className="glass-panel p-4 space-y-3">
        <p className="label-tag flex items-center gap-1.5"><UserCheck size={13} /> 今日打卡 · {today}</p>
        <div className="flex flex-wrap items-center gap-3">
          <select value={todayCourse} onChange={e => setTodayCourse(Number(e.target.value))} className="input-neon text-sm">
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="flex gap-2">
            {ATT_STATUS.map(s => (
              <button
                key={s.key}
                onClick={() => quickMark(s.key)}
                className={clsx('px-3 py-2 rounded text-xs font-mono border bg-ink-900/50 transition-all', s.color)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {todayCourse > 0 && todayMarked.has(todayCourse) && (
            <span className="text-xs text-neon-green font-mono">✓ 已记录</span>
          )}
        </div>
      </div>

      {/* 各课出勤率 */}
      <div className="grid gap-3 md:grid-cols-2">
        {perCourse.map(({ course, cnt, rate, total }) => (
          <div key={course.id} className="glass-panel p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: course.color || '#00FF88' }} />
                <span className="text-sm text-text-primary">{course.name}</span>
              </div>
              <span className={clsx('font-mono text-sm tabular-nums', rate == null ? 'text-text-dim' : rate >= 0.9 ? 'text-neon-green' : rate >= 0.75 ? 'text-neon-yellow' : 'text-neon-danger')}>
                {rate == null ? '—' : `${(rate * 100).toFixed(0)}%`}
              </span>
            </div>
            <div className="h-2 bg-ink-900/70 rounded-full overflow-hidden flex border border-neon-green/10">
              <div className="bg-neon-green/80" style={{ width: `${(cnt.present / Math.max(1, total)) * 100}%` }} />
              <div className="bg-neon-yellow/80" style={{ width: `${(cnt.late / Math.max(1, total)) * 100}%` }} />
              <div className="bg-neon-danger/80" style={{ width: `${(cnt.absent / Math.max(1, total)) * 100}%` }} />
              <div className="bg-sky-400/60" style={{ width: `${(cnt.leave / Math.max(1, total)) * 100}%` }} />
            </div>
            <div className="flex gap-3 font-mono text-[10px] text-text-dim">
              <span className="text-neon-green">✓{cnt.present}</span>
              <span>迟{cnt.late}</span>
              <span>缺{cnt.absent}</span>
              <span>假{cnt.leave}</span>
              <span className="ml-auto">共{total}次</span>
            </div>
          </div>
        ))}
        {perCourse.length === 0 && (
          <div className="glass-panel p-8 text-center text-text-dim text-sm col-span-2">还没有课程 —— 先去「课程」页添加</div>
        )}
      </div>

      {/* 近期记录 */}
      {records.length > 0 && (
        <div className="glass-panel divide-y divide-neon-green/5">
          {records.slice(0, 30).map(r => {
            const st = ATT_STATUS.find(s => s.key === r.status);
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.course_color || '#666' }} />
                <span className="text-text-secondary truncate w-32">{r.course_name}</span>
                <span className="font-mono text-xs text-text-dim">{r.date}</span>
                <span className={clsx('text-xs font-mono', st?.color.split(' ')[0])}>{st?.label}</span>
                <button
                  onClick={async () => {
                    // 快捷循环：出勤→迟到→缺勤→请假→出勤
                    const order = ATT_STATUS.map(s => s.key);
                    const next = order[(order.indexOf(r.status as any) + 1) % order.length];
                    await window.taskAPI.db.attendance.upsert({ course_id: r.course_id, date: r.date, status: next });
                    load();
                  }}
                  className="btn-ghost p-1 ml-auto" title="切换状态"
                ><Pencil size={11} /></button>
                <button
                  onClick={async () => {
                    await window.taskAPI.db.attendance.upsert({ course_id: r.course_id, date: r.date, status: r.status === 'present' ? 'absent' : 'present' });
                    load();
                  }}
                  className="btn-ghost p-1 text-neon-danger" title="改为缺勤/出勤"
                ><Trash2 size={11} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
