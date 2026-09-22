/**
 * v1.2.8 块 K：Courses 拆分 — 课程详情侧栏壳（包含 tab 切换 + 关闭）
 */
import { X } from 'lucide-react';
import type { Course } from '@/types';
import type { DrawerTab } from './constants';

interface CourseDrawerProps {
  course: Course;
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  onClose: () => void;
  /** 已挂载的工具名（用于 tab 禁用状态） */
  hasMiniProgram: boolean;
  /** tab 内容渲染（业务方负责渲染具体 tab） */
  InfoTab: React.ReactNode;
  ScheduleTab: React.ReactNode;
  ReqsTab: React.ReactNode;
  NotesTab: React.ReactNode;
  MiniProgramTab: React.ReactNode;
}

const TABS: Array<{ id: DrawerTab; label: string; miniproOnly?: boolean }> = [
  { id: 'info', label: '信息' },
  { id: 'schedule', label: '上课时间' },
  { id: 'reqs', label: '作业' },
  { id: 'notes', label: '笔记' },
  { id: 'miniprogram', label: '小程序' },
];

export function CourseDrawer({
  course, activeTab, onTabChange, onClose, hasMiniProgram,
  InfoTab, ScheduleTab, ReqsTab, NotesTab, MiniProgramTab,
}: CourseDrawerProps) {
  return (
    <div
      className="fixed inset-y-0 right-0 w-full max-w-md z-40 bg-ink-950/95 backdrop-blur-md border-l border-neon-green/15 shadow-2xl flex flex-col animate-panel-spring"
      role="dialog"
      aria-label="课程详情"
    >
      <div className="flex items-center justify-between p-4 border-b border-neon-green/15 shrink-0">
        <div>
          <div className="font-bold text-base" style={{ color: course.color }}>{course.name}</div>
          {course.instructor && <div className="text-[10px] font-mono text-text-dim mt-1">教师：{course.instructor}</div>}
        </div>
        <button onClick={onClose} className="btn-ghost p-2" aria-label="关闭课程详情">
          <X size={16} />
        </button>
      </div>
      <div className="flex border-b border-neon-green/10 shrink-0">
        {TABS.map((t) => {
          const disabled = t.miniproOnly && !hasMiniProgram;
          return (
            <button
              key={t.id}
              onClick={() => !disabled && onTabChange(t.id)}
              className={`flex-1 py-2 text-xs font-mono transition-colors ${activeTab === t.id ? 'text-neon-green border-b-2 border-neon-green' : 'text-text-dim hover:text-text-secondary'} ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
              disabled={disabled}
              title={disabled ? '先在「小程序」tab 挂载' : undefined}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {activeTab === 'info' && InfoTab}
        {activeTab === 'schedule' && ScheduleTab}
        {activeTab === 'reqs' && ReqsTab}
        {activeTab === 'notes' && NotesTab}
        {activeTab === 'miniprogram' && MiniProgramTab}
      </div>
    </div>
  );
}