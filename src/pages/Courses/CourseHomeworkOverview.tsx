/**
 * v1.2.8 块 K：CourseHomeworkOverview — InfoTab 顶部展示该课程的作业概览
 * - 显示待办 / 已完成 / 即将到期（7 天内）三个分类
 * - 点击条目 → 切到 reqs tab 并滚动到该行
 */
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';
import { useStore } from '@/store';
import type { Course, Requirement } from '@/types';
import type { DrawerTab } from './constants';

interface Props {
  course: Course;
  onGoTab: (tab: DrawerTab) => void;
}

export function CourseHomeworkOverview({ course, onGoTab }: Props) {
  const requirements = useStore((s) => s.requirements);
  const all: Requirement[] = requirements.filter((r) => r.course_id === course.id);
  const pending = all.filter((r) => r.status !== 'done');
  const done = all.filter((r) => r.status === 'done');
  const soonDue = pending.filter((r) => {
    const t = (r as any).due_at as number | null;
    return t && t > Date.now() && t - Date.now() < 7 * 86400000;
  });

  if (all.length === 0) return null;

  return (
    <div className="rounded-md border border-neon-green/20 bg-neon-green/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-[10px] uppercase tracking-wider text-neon-green">作业概览</h4>
        <button
          onClick={() => onGoTab('reqs')}
          className="text-[10px] font-mono text-text-dim hover:text-neon-green flex items-center gap-1"
        >查看全部 <ArrowRight size={10} /></button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatBox icon={<Circle size={11} />} label="待办" value={pending.length} color="text-neon-yellow" />
        <StatBox icon={<CheckCircle2 size={11} />} label="完成" value={done.length} color="text-neon-green" />
        <StatBox icon={<Clock size={11} />} label="7天内到期" value={soonDue.length} color={soonDue.length > 0 ? 'text-neon-danger' : 'text-text-dim'} />
      </div>
      {pending.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-neon-green/10">
          <div className="font-mono text-[9px] uppercase text-text-dim">最近的待办</div>
          {pending.slice(0, 3).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs">
              <span className="truncate">{r.title}</span>
              {(r as any).due_at && (
                <span className="font-mono text-[10px] text-text-dim">
                  {dayjs((r as any).due_at).format('MM-DD')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded bg-ink-900/40">
      <span className={color}>{icon}</span>
      <div className="flex-1">
        <div className="text-[9px] font-mono text-text-dim uppercase">{label}</div>
        <div className={`font-bold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

import { Clock } from 'lucide-react';