/**
 * v1.2.8 块 K：ReqRow — 单条作业行（含状态循环 / 展开内容 / 进度条 / 标签 / 删除）
 */
import { useState } from 'react';
import dayjs from 'dayjs';
import { ChevronDown, CloudDownload, Pencil, Trash2 } from 'lucide-react';
import type { Requirement } from '@/types';
import { toast } from '@/utils/toast';

interface Props {
  req: Requirement;
  onEdit: () => void;
  onUpdate: () => Promise<void> | void;
}

const TYPE_ICONS: Record<string, string> = {
  homework: '📝', exam: '📚', project: '🛠', reading: '📖', other: '📌',
};

export function ReqRow({ req, onEdit, onUpdate }: Props) {
  const due = dayjs(req.due_date);
  const overdue = due.isBefore(dayjs(), 'day') && req.status !== 'done';
  const typeIcon = TYPE_ICONS[req.type] || '📌';
  const [expanded, setExpanded] = useState(false);
  const hasContent = !!(req.description || '').trim();

  const cycle = async () => {
    const next: Requirement['status'] = req.status === 'pending' ? 'in_progress' : req.status === 'in_progress' ? 'done' : 'pending';
    try {
      await window.taskAPI.db.requirements.update(req.id, { ...req, status: next });
      await onUpdate();
    } catch (e) {
      toast.exception(e, '更新状态失败');
    }
  };

  const del = async () => {
    if (!confirm(`删除作业「${req.title}」？`)) return;
    try {
      await window.taskAPI.db.requirements.delete(req.id);
      await onUpdate();
    } catch (e) {
      toast.exception(e, '删除失败');
    }
  };

  return (
    <div className={`rounded-md bg-ink-base/40 border hover:border-neon-green/30 transition-colors ${overdue ? 'border-neon-danger/40' : 'border-neon-green/10'}`}>
      <div className="flex items-center gap-3 p-3">
        <button onClick={cycle} className="shrink-0" aria-label="切换状态">
          {req.status === 'done' ? (
            <div className="w-5 h-5 rounded border-2 border-neon-green bg-neon-green/30 flex items-center justify-center shadow-neon-green">
              <span className="text-neon-green text-xs">✓</span>
            </div>
          ) : (
            <div className="w-5 h-5 rounded border-2 border-text-dim hover:border-neon-green" />
          )}
        </button>
        <span className="text-lg">{typeIcon}</span>
        {hasContent && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 btn-ghost p-0.5 text-text-dim hover:text-neon-green"
            title={expanded ? '收起作业内容' : '展开作业内容'}
            aria-label={expanded ? '收起作业内容' : '展开作业内容'}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
          </button>
        )}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => hasContent && setExpanded((v) => !v)}>
          <div className={`text-sm truncate ${req.status === 'done' ? 'line-through text-text-dim' : ''}`}>
            {req.source === 'github' && (
              <span
                className="inline-flex items-center gap-0.5 mr-1 px-1 py-px rounded text-[9px] font-mono border border-neon-green/40 text-neon-green align-middle"
                title={`来自 GitHub 同步${req.publisher ? ' · 发布人 ' + req.publisher : ''}${req.session_date ? ' · 上课 ' + req.session_date : ''}`}
              >
                <CloudDownload size={9} /> 同步
              </span>
            )}
            {req.recurrence && (
              <span
                className="inline-flex items-center mr-1 px-1 py-px rounded text-[9px] font-mono border border-sky-400/40 text-sky-400 align-middle"
                title={`周期任务：${req.recurrence === 'daily' ? '每天' : req.recurrence === 'biweekly' ? '每两周' : '每周'}，完成自动生成下一轮`}
              >
                🔁 {req.recurrence === 'daily' ? '日' : req.recurrence === 'biweekly' ? '双周' : '周'}
              </span>
            )}
            {req.title}
          </div>
          <div className="font-mono text-[10px] text-text-dim mt-0.5">
            {due.format('MM-DD ddd HH:mm')}{req.session_date ? ` · 该节 ${req.session_date.slice(5)}` : ''} · 预计 {req.estimated_hours || '?'}h · 实际 {req.actual_hours || '0'}h · 优先级 {req.priority}
          </div>
          {req.status !== 'done' && (() => {
            const span = req.due_date - (req.created_at || req.due_date);
            if (span <= 0) return null;
            const used = Math.min(100, Math.max(0, ((Date.now() - (req.created_at || req.due_date)) / span) * 100));
            const urgent = used >= 80;
            return (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 bg-ink-900/80 rounded-full overflow-hidden border border-neon-green/5">
                  <div className="h-full transition-all" style={{ width: `${used}%`, background: urgent ? 'linear-gradient(90deg,#FFC53D99,#FF3355)' : 'linear-gradient(90deg,#00FF8844,#00FF88AA)' }} />
                </div>
                <span className={`font-mono text-[9px] tabular-nums ${urgent ? 'text-neon-danger' : 'text-text-dim'}`}>{Math.round(used)}%</span>
              </div>
            );
          })()}
        </div>
        <span className={`data-pill ${req.status === 'done' ? 'border-neon-green/40 text-neon-green' : req.status === 'in_progress' ? 'border-neon-yellow/40 text-neon-yellow' : overdue ? 'border-neon-danger/50 text-neon-danger' : 'border-text-dim/40 text-text-secondary'}`}>
          {req.status === 'done' ? '已完成' : req.status === 'in_progress' ? '进行中' : overdue ? '已逾期' : '待办'}
        </span>
        <button onClick={onEdit} className="btn-ghost p-1" aria-label="编辑作业"><Pencil size={12} /></button>
        <button onClick={del} className="btn-ghost p-1 text-neon-danger" aria-label="删除作业"><Trash2 size={12} /></button>
      </div>
      {expanded && hasContent && (
        <div className="px-3 pb-3 pt-1 border-t border-neon-green/10">
          <div className="font-mono text-[9px] text-text-dim mb-1">
            作业内容{req.publisher ? ` · 发布人 ${req.publisher}` : ''}{req.session_date ? ` · 上课 ${req.session_date}` : ''}
          </div>
          <div className="text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed">{req.description}</div>
        </div>
      )}
    </div>
  );
}