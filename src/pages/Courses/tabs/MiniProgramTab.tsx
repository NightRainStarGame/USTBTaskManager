/**
 * v1.2.8 块 K：MiniProgramTab — 课程的小程序挂载/卸载
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Course, CourseMiniProgram } from '@/types';
import { MINI_APP_TYPES } from '../constants';

interface Props { course: Course }

export function MiniProgramTab({ course }: Props) {
  const [miniProgram, setMiniProgram] = useState<CourseMiniProgram | null>(null);
  const [selectedType, setSelectedType] = useState('timetable');

  const load = async () => {
    const m = await window.taskAPI.db.miniPrograms.getByCourse(course.id);
    setMiniProgram(m ?? null);
  };

  useEffect(() => {
    if (course?.id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  const mount = async () => {
    await window.taskAPI.db.miniPrograms.createOrUpdate({
      course_id: course.id,
      app_type: selectedType,
      active: 1,
      config_json: '{}',
    });
    await load();
  };

  const unmount = async () => {
    if (!miniProgram) return;
    if (!confirm(`确定卸载「${MINI_APP_TYPES.find((t) => t.id === miniProgram.app_type)?.name || miniProgram.app_type}」？`)) return;
    await window.taskAPI.db.miniPrograms.delete(miniProgram.id);
    await load();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        把常用工具挂载到这门课，可以从小程序中心一键打开。每个课程只能挂一个工具。
      </p>
      {!miniProgram ? (
        <div className="space-y-3">
          <h4 className="label-tag">选择要挂载的工具</h4>
          <div className="grid grid-cols-2 gap-3">
            {MINI_APP_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedType(t.id)}
                className={`p-3 rounded-md border text-left transition-colors ${selectedType === t.id ? 'border-neon-green bg-neon-green/10' : 'border-neon-green/10 hover:border-neon-green/30'}`}
              >
                <div className="font-bold text-sm text-text-primary">{t.name}</div>
                <div className="text-[10px] text-text-dim mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
          <button onClick={mount} className="btn-neon w-full"><Plus size={14} /> 挂载到「{course.name}」</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md bg-neon-green/5 border border-neon-green/20">
            <div>
              <div className="font-bold text-neon-green">
                {MINI_APP_TYPES.find((t) => t.id === miniProgram.app_type)?.name || miniProgram.app_type}
              </div>
              <div className="text-[10px] text-text-dim font-mono">已挂载 · 可在小程序中心打开</div>
            </div>
            <button onClick={unmount} className="btn-ghost text-neon-danger text-xs">
              <Trash2 size={12} /> 卸载
            </button>
          </div>
          <p className="text-xs text-text-secondary">切换工具类型：先卸载再重新挂载即可。</p>
        </div>
      )}
    </div>
  );
}