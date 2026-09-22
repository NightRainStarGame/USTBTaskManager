/**
 * v1.2.3 自然语言快速添加：Ctrl+Shift+A / 托盘呼出。
 * 例：「周五交高数作业」「明天 14:30 复习数据结构」「后天交英语作文」
 * 解析：日期 + 时间 + 课程名 + 类型 + 剩余文本作标题 → 建作业条目。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import dayjs from 'dayjs';
import { Zap, CalendarClock, BookOpen, Tag, AlertCircle } from 'lucide-react';
import { useStore } from '@/store';

interface Parsed {
  courseId: number | null;
  courseName: string | null;
  dueDate: number | null;
  dateHint: string | null;
  type: string;
  title: string;
}

const TYPE_KEYWORDS: Array<[RegExp, string]> = [
  [/考试|测验|模考/, 'exam'],
  [/复习/, 'reading'],
  [/阅读|看书/, 'reading'],
  [/项目|大作业|课程设计/, 'project'],
  [/作业|习题|练习|交|提交|写|做/, 'homework'],
];

const WEEK_CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 } as const;

function parseQuickAdd(raw: string, courses: Array<{ id: number; name: string }>): Parsed {
  const now = dayjs();
  let text = raw.trim();
  const type = TYPE_KEYWORDS.find(([re]) => re.test(text))?.[1] ?? 'other';
  let dateHint: string | null = null;
  let target: dayjs.Dayjs | null = null;

  // 相对日
  if (/^.*今天/.test(text) || /今天/.test(text)) { target = now; dateHint = '今天'; text = text.replace(/今天/g, ''); }
  else if (/明天/.test(text)) { target = now.add(1, 'day'); dateHint = '明天'; text = text.replace(/明天/g, ''); }
  else if (/大后天/.test(text)) { target = now.add(3, 'day'); dateHint = '大后天'; text = text.replace(/大后天/g, ''); }
  else if (/后天/.test(text)) { target = now.add(2, 'day'); dateHint = '后天'; text = text.replace(/后天/g, ''); }
  else {
    // 周X / 星期X / 礼拜X（可带「下周」前缀）
    const m = text.match(/(下\s*周|下周|星期|礼拜|周)\s*([一二三四五六日天])/);
    if (m) {
      const wantDow = WEEK_CN[m[2] as keyof typeof WEEK_CN];
      const isNextWeek = /下周/.test(m[1]);
      // 本周的该天（周日算一周开始？按 dayjs 默认周日=0；这里以周一为一周开始更像学生习惯）
      const curDow = (now.day() + 6) % 7; // 周一=0 … 周日=6
      const wantDowM = (wantDow + 6) % 7;
      let diff = wantDowM - curDow;
      if (isNextWeek) diff += 7;
      else if (diff < 0) diff += 7; // 本周已过 → 下周
      target = now.add(diff, 'day');
      dateHint = (isNextWeek ? '下周' : '周') + m[2];
      text = text.replace(m[0], '');
    }
  }
  // X月X日 / X月X号 / X号
  if (!target) {
    const m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      let d = now.month(Number(m[1]) - 1).date(Number(m[2]));
      if (d.isBefore(now, 'day')) d = d.add(1, 'year');
      target = d; dateHint = `${m[1]}月${m[2]}日`;
      text = text.replace(m[0], '');
    } else {
      const m2 = text.match(/(\d{1,2})\s*[日号]/);
      if (m2 && Number(m2[1]) >= 1 && Number(m2[1]) <= 31) {
        let d = now.date(Number(m2[1]));
        if (d.isBefore(now, 'day')) d = d.add(1, 'month');
        target = d; dateHint = `${m2[1]}号`;
        text = text.replace(m2[0], '');
      }
    }
  }

  // 时间（可选）
  let hour = 23, minute = 59;
  {
    const m = text.match(/(\d{1,2})\s*[点时:：]\s*(\d{2})?/);
    if (m) {
      const h = Number(m[1]);
      if (h >= 0 && h <= 23) {
        hour = h;
        minute = m[2] ? Number(m[2]) : 0;
        text = text.replace(m[0], '');
      }
    }
  }

  // 课程匹配（最长名字优先，避免「数据结构」匹配到「数据」）
  let courseId: number | null = null;
  let courseName: string | null = null;
  const sorted = [...courses].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    if (c.name && text.includes(c.name)) {
      courseId = c.id; courseName = c.name;
      text = text.split(c.name).join(' ');
      break;
    }
  }

  // 清理标题
  const title = text
    .replace(/(考试|测验|模考|复习|阅读|看书|作业|习题|练习|大作业|课程设计|交|提交|写|做|完成|的|一个?)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '新任务';

  const dueDate = target ? target.hour(hour).minute(minute).second(0).millisecond(0).valueOf() : null;
  return { courseId, courseName, dueDate, dateHint, type, title };
}

const TYPE_LABELS: Record<string, string> = {
  homework: '作业', exam: '考试', project: '项目', reading: '复习/阅读', other: '其他',
};

export default function QuickAdd({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const courses = useStore(s => s.courses);
  const refreshAll = useStore(s => s.refreshAll);
  const [text, setText] = useState(initial || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [overrideCourse, setOverrideCourse] = useState<number | 'auto'>('auto');
  const [overrideType, setOverrideType] = useState<string>('auto');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const parsed = useMemo(() => parseQuickAdd(text, courses), [text, courses]);
  const finalCourseId = overrideCourse === 'auto' ? parsed.courseId : overrideCourse;
  const finalType = overrideType === 'auto' ? parsed.type : overrideType;

  const submit = async () => {
    setError('');
    if (!text.trim()) { setError('先输入点什么，比如「周五交高数作业」'); return; }
    const cid = finalCourseId ?? courses[0]?.id ?? null;
    if (!cid) { setError('还没有课程——先去「课程」页建一门课'); return; }
    if (!parsed.dueDate) { setError('没识别到日期，试试「明天」「周五」「10月8日」'); return; }
    setSaving(true);
    try {
      await window.taskAPI.db.requirements.create({
        course_id: cid,
        title: parsed.title,
        type: finalType,
        due_date: parsed.dueDate,
        priority: 2,
        status: 'pending',
      });
      await refreshAll();
      onClose();
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="⚡ 快速添加 · Natural Language" onClose={onClose} width="max-w-xl">
      <div className="space-y-4">
        {/* 输入 */}
        <div className="flex items-center gap-3 rounded-lg border border-neon-green/30 bg-ink-900/60 px-4 py-3 focus-within:border-neon-green shadow-neon-green/20">
          <Zap size={18} className="text-neon-green shrink-0" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); }}
            placeholder="周五交高数作业 · 明天14:30复习数据结构 · 10月8日考试"
            className="flex-1 bg-transparent outline-none text-text-primary placeholder:text-text-dim/60 text-sm"
          />
        </div>

        {/* 解析预览 */}
        {text.trim() && (
          <div className="rounded-lg border border-neon-green/15 bg-ink-base/50 p-4 space-y-3">
            <p className="label-tag">解析结果</p>
            <div className="grid grid-cols-2 gap-3">
              <PreviewRow icon={<CalendarClock size={14} />} label="截止" value={parsed.dueDate ? `${parsed.dateHint || ''} ${dayjs(parsed.dueDate).format('YYYY-MM-DD HH:mm')}` : '未识别（默认今天 23:59）'} accent={parsed.dueDate ? 'green' : 'yellow'} />
              <PreviewRow icon={<BookOpen size={14} />} label="课程" value={courses.find(c => c.id === finalCourseId)?.name || '未识别'} accent={parsed.courseId ? 'green' : 'yellow'} />
              <PreviewRow icon={<Tag size={14} />} label="类型" value={TYPE_LABELS[finalType] || finalType} accent="green" />
              <PreviewRow icon={<Zap size={14} />} label="标题" value={parsed.title} accent="green" />
            </div>
            {/* 手动修正 */}
            <div className="flex flex-wrap gap-2 pt-1">
              <select
                value={overrideCourse}
                onChange={(e) => setOverrideCourse(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}
                className="bg-ink-900 border border-neon-green/20 rounded px-2 py-1 text-xs text-text-secondary outline-none focus:border-neon-green"
              >
                <option value="auto">课程：{parsed.courseName || '自动识别'}</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select
                value={overrideType}
                onChange={(e) => setOverrideType(e.target.value)}
                className="bg-ink-900 border border-neon-green/20 rounded px-2 py-1 text-xs text-text-secondary outline-none focus:border-neon-green"
              >
                <option value="auto">类型：{TYPE_LABELS[parsed.type] || '自动'}</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-neon-danger border border-neon-danger/30 rounded px-3 py-2 bg-neon-danger/5">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-dim">
            Ctrl+Shift+A 全局呼出 · Enter 保存
          </span>
          <button
            onClick={submit}
            disabled={saving}
            className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50"
          >
            {saving ? 'SAVING…' : '保存 [ENTER]'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: 'green' | 'yellow' }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className={accent === 'green' ? 'text-neon-green' : 'text-neon-yellow'}>{icon}</span>
      <div className="min-w-0">
        <div className="font-mono text-[10px] text-text-dim uppercase tracking-wider">{label}</div>
        <div className={`text-sm truncate ${accent === 'green' ? 'text-text-primary' : 'text-neon-yellow'}`}>{value}</div>
      </div>
    </div>
  );
}
