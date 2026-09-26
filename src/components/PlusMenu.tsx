import { useNavigate } from 'react-router-dom';
import { BookOpen, Calendar, FolderKanban, FileText, X, AppWindow } from 'lucide-react';
import { useState } from 'react';

interface Props { onClose: () => void }

export default function PlusMenu({ onClose }: Props) {
  const nav = useNavigate();
  const [tab, setTab] = useState<'quick' | 'forms'>('quick');

  const go = (path: string) => {
    onClose();
    nav(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[480px] glass-panel overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neon-green/15">
          <div className="flex items-center gap-2">
            <span className="label-tag">QUICK·CREATE</span>
            <span className="text-xs text-text-dim font-mono">/ 新建资源</span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <div className="flex border-b border-neon-green/10">
          {(['quick', 'forms'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 font-mono text-xs uppercase tracking-widest transition-colors
                ${tab === t ? 'text-neon-green bg-neon-green/5 border-b-2 border-neon-green' : 'text-text-dim hover:text-text-secondary'}`}
            >
              {t === 'quick' ? '快捷入口' : '表单页'}
            </button>
          ))}
        </div>

        <div className="p-4 grid grid-cols-2 gap-3">
          <QuickCard
            icon={<BookOpen size={20} />}
            title="新建课程"
            desc="添加一门课程并初始化要求"
            onClick={() => go('/courses?action=new')}
            accent="green"
          />
          <QuickCard
            icon={<Calendar size={20} />}
            title="新建日历事件"
            desc="上课/会议/自习安排"
            onClick={() => go('/calendar?action=new')}
            accent="yellow"
          />
          <QuickCard
            icon={<FolderKanban size={20} />}
            title="新建项目"
            desc="创建一个跨课程项目"
            onClick={() => go('/projects?action=new')}
            accent="green"
          />
          <QuickCard
            icon={<FileText size={20} />}
            title="新建作业/考试"
            desc="为已有课程添加要求"
            onClick={() => go('/courses?action=req')}
            accent="yellow"
          />
        </div>

        <div className="px-4 py-3 border-t border-neon-green/10 flex items-center justify-between">
          <span className="font-mono text-[10px] text-text-dim">提示：表单页面可直接填写详细信息</span>
          <span className="font-mono text-[10px] text-text-dim">ESC 关闭</span>
        </div>
      </div>
    </div>
  );
}

function QuickCard({ icon, title, desc, onClick, accent }: any) {
  const a = accent === 'green'
    ? 'border-neon-green/30 hover:border-neon-green hover:shadow-neon-green text-neon-green'
    : 'border-neon-yellow/30 hover:border-neon-yellow hover:shadow-neon-yellow text-neon-yellow';
  return (
    <button
      onClick={onClick}
      className={`text-left p-3 rounded-lg bg-ink-base/60 border ${a} transition-all group`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {icon}
        <span className="font-mono text-sm font-bold">{title}</span>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{desc}</p>
    </button>
  );
}