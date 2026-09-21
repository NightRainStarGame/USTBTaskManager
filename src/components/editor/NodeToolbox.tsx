import {
  CheckSquare, BookOpen, ClipboardList, Calendar, StickyNote, Folder,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CanvasNodeType } from '@/types';

const TOOLS: Array<{
  type: CanvasNodeType;
  label: string;
  color: string;
  Icon: LucideIcon;
}> = [
  { type: 'task',     label: '任务',   color: '#00FF88', Icon: CheckSquare },
  { type: 'course',   label: '课程',   color: '#00D4FF', Icon: BookOpen },
  { type: 'homework', label: '作业',   color: '#FF3366', Icon: ClipboardList },
  { type: 'event',    label: '日程',   color: '#F98FC2', Icon: Calendar },
  { type: 'note',     label: '便签',   color: '#FFEA00', Icon: StickyNote },
  { type: 'group',    label: '分组',   color: '#A78BFA', Icon: Folder },
];

/** v1.2.1 画布编辑器：左侧节点工具箱（6 种可拖拽节点） */
export default function NodeToolbox() {
  return (
    <div className="w-44 shrink-0 border-r border-neon-green/15 bg-ink-900/40 backdrop-blur p-2 space-y-1.5 overflow-y-auto">
      <div className="label-tag px-1 mb-2">节点工具箱</div>
      {TOOLS.map(({ type, label, color, Icon }) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/canvas-node-type', type);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          className="flex items-center gap-2 px-2 py-2 rounded border border-neon-green/15 bg-ink-900/60 cursor-grab active:cursor-grabbing hover:border-neon-green/40 hover:bg-ink-800/60 transition-colors select-none"
        >
          <div
            className="w-7 h-7 rounded flex items-center justify-center shrink-0"
            style={{ background: `${color}22`, border: `1px solid ${color}66` }}
          >
            <Icon size={14} style={{ color }} />
          </div>
          <div className="text-xs font-mono text-text-primary">{label}</div>
        </div>
      ))}
      <div className="text-[10px] text-text-dim font-mono mt-3 leading-relaxed px-1 pt-2 border-t border-neon-green/10">
        拖拽卡片到画布<br/>即可创建节点<br/>
        <span className="text-text-secondary">• 拖拽节点移动位置</span><br/>
        <span className="text-text-secondary">• 节点悬停圆点拖出连线</span><br/>
        <span className="text-text-secondary">• 选中节点编辑属性</span><br/>
        <span className="text-text-secondary">• Delete / Backspace 删除</span>
      </div>
    </div>
  );
}