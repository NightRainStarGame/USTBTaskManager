/**
 * v1.2.8 块 P：番茄钟任务绑定下拉
 */
import { ListTodo } from 'lucide-react';
import type { Requirement } from '@/types';

interface TaskPickerProps {
  requirements: Requirement[];
  /** 取已过滤、未完成的待办（至多 N 条） */
  pendingReqs: Requirement[];
  value: number | null;
  onChange: (id: number | null) => void;
  disabled: boolean;
}

export function TaskPicker({ pendingReqs, value, onChange, disabled }: TaskPickerProps) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 text-text-dim font-mono text-[10px] uppercase tracking-wider mb-1">
        <ListTodo size={11} /> 绑定任务（可选）
      </div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled}
        className="w-full bg-ink-900 border border-neon-green/20 rounded px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-neon-green disabled:opacity-50 transition-colors"
      >
        <option value="">自由专注</option>
        {pendingReqs.map((r) => (
          <option key={r.id} value={r.id}>{r.course_name} · {r.title}</option>
        ))}
      </select>
    </div>
  );
}