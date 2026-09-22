/**
 * v1.2.8 块 K：ReqsTab — 课程作业列表（三段分区：进行中 / 逾期 / 已完成）
 */
import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { ChevronDown, Plus } from 'lucide-react';
import { useStore } from '@/store';
import type { Course, Requirement as Req } from '@/types';
import { ReqRow } from '../ReqRow';
import { ReqInlineEditor } from '../ReqInlineEditor';

interface Props { course: Course }

export function ReqsTab({ course }: Props) {
  const requirements = useStore((s) => s.requirements);
  const refreshAll = useStore((s) => s.refreshAll);
  const courseReqs = useMemo(
    () => requirements.filter((r) => r.course_id === course.id).sort((a, b) => a.due_date - b.due_date),
    [requirements, course.id]
  );
  const [editing, setEditing] = useState<Req | null>(null);
  const [showOverdue, setShowOverdue] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const pending = courseReqs.filter((r) => r.status !== 'done').length;
  const done = courseReqs.filter((r) => r.status === 'done').length;
  const activeReqs = courseReqs.filter((r) => r.status !== 'done' && !dayjs(r.due_date).isBefore(dayjs(), 'day'));
  const overdueReqs = courseReqs.filter((r) => r.status !== 'done' && dayjs(r.due_date).isBefore(dayjs(), 'day'));
  const doneReqs = courseReqs.filter((r) => r.status === 'done');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] text-text-dim">
          <span>共 {courseReqs.length} 项</span>
          <span className="px-1.5 py-0.5 rounded border border-neon-yellow/40 text-neon-yellow">待完成 {pending}</span>
          {overdueReqs.length > 0 && <span className="px-1.5 py-0.5 rounded border border-neon-danger/50 text-neon-danger">逾期 {overdueReqs.length}</span>}
          <span className="px-1.5 py-0.5 rounded border border-neon-green/40 text-neon-green">已完成 {done}</span>
        </div>
        <button
          onClick={() => setEditing({
            id: 0, course_id: course.id, title: '', type: 'homework',
            due_date: Date.now(), priority: 2, status: 'pending', created_at: Date.now(),
          } as Req)}
          className="btn-neon btn-neon-yellow"
        >
          <Plus size={14} /> 添加作业
        </button>
      </div>
      {courseReqs.length === 0 ? (
        <div className="py-8 text-center text-text-dim font-mono text-sm">
          [ ∅ ] 暂无作业<br />
          <span className="text-xs">点击右上角「添加作业」创建第一条</span>
        </div>
      ) : (
        <>
          {activeReqs.map((r) => (
            <ReqRow key={r.id} req={r} onEdit={() => setEditing(r)} onUpdate={refreshAll} />
          ))}
          {overdueReqs.length > 0 && (
            <div className="rounded-md border border-neon-danger/30 bg-neon-danger/3 overflow-hidden">
              <button onClick={() => setShowOverdue((s) => !s)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neon-danger/5">
                <ChevronDown size={12} className={`text-neon-danger transition-transform ${showOverdue ? '' : '-rotate-90'}`} />
                <span className="font-mono text-[10px] text-neon-danger">已逾期未完成 · {overdueReqs.length}</span>
              </button>
              {showOverdue && (
                <div className="px-2 pb-2 space-y-2">
                  {overdueReqs.map((r) => (
                    <ReqRow key={r.id} req={r} onEdit={() => setEditing(r)} onUpdate={refreshAll} />
                  ))}
                </div>
              )}
            </div>
          )}
          {doneReqs.length > 0 && (
            <div className="rounded-md border border-neon-green/10 overflow-hidden">
              <button onClick={() => setShowDone((s) => !s)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neon-green/5">
                <ChevronDown size={12} className={`text-neon-green transition-transform ${showDone ? '' : '-rotate-90'}`} />
                <span className="font-mono text-[10px] text-text-dim">已完成 · {doneReqs.length}</span>
              </button>
              {showDone && (
                <div className="px-2 pb-2 space-y-2">
                  {doneReqs.map((r) => (
                    <ReqRow key={r.id} req={r} onEdit={() => setEditing(r)} onUpdate={refreshAll} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {editing && (
        <ReqInlineEditor req={editing} courseId={course.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refreshAll(); }} />
      )}
    </div>
  );
}