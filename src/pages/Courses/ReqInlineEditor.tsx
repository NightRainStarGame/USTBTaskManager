/**
 * v1.2.8 块 K：ReqInlineEditor — 作业新增/编辑 Modal 内容
 */
import { useState } from 'react';
import dayjs from 'dayjs';
import Modal from '@/components/Modal';
import type { Requirement } from '@/types';
import { Field } from './Field';
import { toast } from '@/utils/toast';

interface Props {
  req: Requirement;
  courseId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ReqInlineEditor({ req, courseId, onClose, onSaved }: Props) {
  const isNew = req.id === 0;
  const isSynced = req.source === 'github';
  const [title, setTitle] = useState(req.title || '');
  const [description, setDescription] = useState(req.description || '');
  const [type, setType] = useState(req.type || 'homework');
  const [dueDate, setDueDate] = useState(dayjs(req.due_date || Date.now()).format('YYYY-MM-DDTHH:mm'));
  const [priority, setPriority] = useState(req.priority || 2);
  const [status, setStatus] = useState(req.status || 'pending');
  const [estimatedHours, setEstimatedHours] = useState(req.estimated_hours || '');
  const [actualHours, setActualHours] = useState(req.actual_hours || '');
  const [notes, setNotes] = useState(req.notes || '');
  const [recurrence, setRecurrence] = useState<string>(req.recurrence || '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!title.trim()) { toast.warn('请填写作业标题'); return; }
    const dueMs = dueDate ? new Date(dueDate).getTime() : NaN;
    if (!Number.isFinite(dueMs)) { toast.warn('请选择有效的截止时间'); return; }
    setBusy(true);
    try {
      const payload: Partial<Requirement> = {
        course_id: courseId,
        title: title.trim(),
        type,
        description: description.trim() || null,
        due_date: dueMs,
        priority, status,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
        actual_hours: actualHours ? Number(actualHours) : null,
        notes: notes.trim() || null,
        recurrence: (recurrence || null) as Requirement['recurrence'],
      };
      if (isNew) {
        await window.taskAPI.db.requirements.create(payload);
      } else {
        const { course_name, course_color, ...rest } = req as any;
        await window.taskAPI.db.requirements.update(req.id, { ...rest, ...payload });
      }
      await onSaved();
    } catch (e) {
      toast.exception(e, '保存作业失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? '添加作业' : '编辑作业'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">取消</button>
          <button onClick={submit} disabled={busy} className="btn-neon btn-neon-yellow">
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="作业标题 *">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" placeholder="如：第三章习题 1-10" />
        </Field>
        <Field label={isSynced ? '作业内容（来自同步 · 只读）' : '作业内容'}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            readOnly={isSynced}
            rows={4}
            className="input-neon text-xs leading-relaxed"
            placeholder={isSynced ? '这条作业来自同步，内容由发布方维护（展开作业条目也能直接查看）' : '作业的具体内容、要求、页码等（选填；接收方能完整看到）'}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="input-neon">
              <option value="homework">作业</option>
              <option value="exam">考试</option>
              <option value="project">项目</option>
              <option value="reading">阅读</option>
              <option value="other">其他</option>
            </select>
          </Field>
          <Field label="优先级">
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)} className="input-neon">
              <option value={1}>低</option>
              <option value={2}>中</option>
              <option value={3}>高</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="截止时间 *">
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-neon" />
          </Field>
          <Field label="重复（完成自动生成下一轮）">
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="input-neon">
              <option value="">一次性</option>
              <option value="daily">每天</option>
              <option value="weekly">每周</option>
              <option value="biweekly">每两周</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="状态">
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="input-neon">
              <option value="pending">待办</option>
              <option value="in_progress">进行中</option>
              <option value="done">已完成</option>
            </select>
          </Field>
          <Field label="预计工时(h)">
            <input type="number" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} className="input-neon" />
          </Field>
          <Field label="实际耗时(h)">
            <input type="number" step="0.5" value={actualHours} onChange={(e) => setActualHours(e.target.value)} className="input-neon" />
          </Field>
        </div>
        <Field label="备注">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-neon" />
        </Field>
      </div>
    </Modal>
  );
}