/**
 * v1.2.8 块 K：ScheduleSlotModal — 新增/编辑每周重复上课时段
 */
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { X } from 'lucide-react';
import type { CalendarEvent, Course } from '@/types';
import { Field } from './Field';

interface Props {
  course: Course;
  slot: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

const WDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function ScheduleSlotModal({ course, slot, onClose, onSaved }: Props) {
  const initialStart = slot ? dayjs(slot.start_at) : dayjs().day(1).hour(8).minute(0).second(0);
  const initialEnd = slot?.end_at ? dayjs(slot.end_at) : initialStart.add(90, 'minute');
  const [weekday, setWeekday] = useState<number>(initialStart.day() as number);
  const [start, setStart] = useState(initialStart.format('HH:mm'));
  const [end, setEnd] = useState(initialEnd.format('HH:mm'));
  const [location, setLocation] = useState(slot?.location || '');
  const [notes, setNotes] = useState(slot?.notes || '');
  const [submitting, setSubmitting] = useState(false);

  // 重新定位到本周 weekday
  useEffect(() => {
    if (slot) return;
    const now = dayjs();
    let next = now.day(weekday);
    if (next.isBefore(now)) next = next.add(7, 'day');
    setStart(next.format('HH:mm'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekday]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 用本周 X 作为锚点（随便，start_at 仅作 weekday 提取用）
      const anchor = dayjs().day(weekday);
      const start_at = anchor.hour(Number(start.split(':')[0])).minute(Number(start.split(':')[1])).valueOf();
      const end_at = anchor.hour(Number(end.split(':')[0])).minute(Number(end.split(':')[1])).valueOf();
      const payload = {
        title: course.name,
        start_at, end_at,
        location: location.trim() || null,
        notes: notes.trim() || null,
        recurrence: 'WEEKLY' as const,
        recurrence_end: null,
        course_id: course.id,
        color: course.color,
        all_day: 0,
        type: 'event',
        reminder_minutes: null,
        category_id: null,
      };
      if (slot?.id) await window.taskAPI.db.events.update(slot.id, payload);
      else await window.taskAPI.db.events.create(payload);
      await onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-base/70 backdrop-blur-sm flex items-center justify-center p-4 animate-toast-in" onClick={onClose}>
      <div className="bg-ink-900/95 border border-neon-green/30 rounded-lg p-4 max-w-sm w-full space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-neon-green">{slot ? '编辑' : '新增'}上课时段</h3>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="关闭"><X size={14} /></button>
        </div>
        <Field label="周几">
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value) as number)} className="input-neon">
            {WDAY_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="开始">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="input-neon" />
          </Field>
          <Field label="结束">
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="input-neon" />
          </Field>
        </div>
        <Field label="教室/地点">
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="例如：理教 302" className="input-neon" />
        </Field>
        <Field label="备注">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-neon" placeholder="教师、教学班等" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={submit} disabled={submitting} className="btn-neon">{submitting ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}