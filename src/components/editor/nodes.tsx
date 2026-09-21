import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import { ExternalLink } from 'lucide-react';
import { NODE_REGISTRY } from './nodeRegistry';

/** v1.2.1 块 6 节点 data 公共类型（所有类型都满足） */
type BaseData = {
  title: string;
  color?: string;
  notes?: string;
  /** v1.2.1 块 6：关联业务实体 id */
  entity_id?: number | null;
  nodeType?: string;
  dbId?: number;
};

/** 节点外壳：渐变黑底 + 主题色描边 + 4 向 handle + 右上角「打开实体」图标（仅绑定后） */
function NodeShell({
  selected, color, Icon, label, notes, entity_id, nodeType,
}: {
  selected?: boolean;
  color: string;
  Icon: LucideIcon;
  label: string;
  notes?: string;
  entity_id?: number | null;
  nodeType: string;
}) {
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 backdrop-blur-md min-w-[180px] max-w-[260px] transition-all relative ${
        selected ? 'shadow-neon-green-strong' : ''
      }`}
      style={{
        background: 'linear-gradient(135deg, rgba(0,0,0,0.82), rgba(0,0,0,0.62))',
        borderColor: selected ? color : `${color}55`,
        color: '#E8FFEE',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: `1px solid ${color}` }} />
      <Handle type="target" position={Position.Left} style={{ background: color, border: `1px solid ${color}` }} />
      <div className="flex items-center gap-2">
        <Icon size={14} style={{ color }} className="shrink-0" />
        <span className="font-mono text-xs text-text-primary truncate flex-1">{label}</span>
        {entity_id != null && (
          <button
            title="打开关联实体"
            onClick={(e) => {
              e.stopPropagation();
              /** 冒泡到 Editor 外层订阅（携带 nodeType 用于路由） */
              window.dispatchEvent(
                new CustomEvent('canvas:openEntity', { detail: { nodeType, entity_id } }),
              );
            }}
            className="shrink-0 p-0.5 rounded transition-colors"
            onMouseEnter={(e) => (e.currentTarget.style.background = `${color}33`)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <ExternalLink size={11} style={{ color }} />
          </button>
        )}
      </div>
      {notes && (
        <div className="text-[10px] text-text-dim mt-1 truncate font-mono" title={notes}>
          {notes}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color, border: `1px solid ${color}` }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: `1px solid ${color}` }} />
    </div>
  );
}

/* === 6 种业务节点 + custom fallback === */

function makeNode(defaultColor: string, Icon: LucideIcon, nodeType: string) {
  return function NodeImpl({ data, selected }: NodeProps) {
    const d = data as BaseData;
    return <NodeShell
      selected={selected}
      color={d.color || defaultColor}
      Icon={Icon}
      label={d.title}
      notes={d.notes}
      entity_id={d.entity_id}
      nodeType={nodeType}
    />;
  };
}

export const TaskNode     = makeNode(NODE_REGISTRY.task.color,     NODE_REGISTRY.task.Icon,     'task');
export const CourseNode   = makeNode(NODE_REGISTRY.course.color,   NODE_REGISTRY.course.Icon,   'course');
export const HomeworkNode = makeNode(NODE_REGISTRY.homework.color, NODE_REGISTRY.homework.Icon, 'homework');
export const EventNode    = makeNode(NODE_REGISTRY.event.color,    NODE_REGISTRY.event.Icon,    'event');
export const NoteNode     = makeNode(NODE_REGISTRY.note.color,     NODE_REGISTRY.note.Icon,     'note');
export const CustomNode   = makeNode(NODE_REGISTRY.custom.color,   NODE_REGISTRY.custom.Icon,   'custom');

/** 分组节点：虚线边框 + 条纹底（视觉上明显区别于普通节点） */
export function GroupNode({ data, selected }: NodeProps) {
  const d = data as BaseData;
  const color = d.color || NODE_REGISTRY.group.color;
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 backdrop-blur-md min-w-[240px] min-h-[80px] ${
        selected ? 'shadow-neon-green-strong' : ''
      }`}
      style={{
        background:
          'repeating-linear-gradient(45deg, rgba(167,139,250,0.10) 0 8px, transparent 8px 16px), rgba(0,0,0,0.55)',
        borderColor: selected ? color : `${color}55`,
        borderStyle: 'dashed',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: `1px solid ${color}` }} />
      <Handle type="target" position={Position.Left} style={{ background: color, border: `1px solid ${color}` }} />
      <div className="flex items-center gap-2">
        <NODE_REGISTRY.group.Icon size={14} style={{ color }} className="shrink-0" />
        <span className="font-mono text-xs text-text-primary truncate flex-1">{d.title}</span>
        {d.entity_id != null && (
          <button
            title="打开关联实体"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent('canvas:openEntity', { detail: { nodeType: 'group', entity_id: d.entity_id } }),
              );
            }}
            className="shrink-0 p-0.5 rounded"
          >
            <ExternalLink size={11} style={{ color }} />
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: color, border: `1px solid ${color}` }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: `1px solid ${color}` }} />
    </div>
  );
}

/** 给 ReactFlow 的 nodeTypes 映射 */
export const nodeTypes = {
  task: TaskNode,
  course: CourseNode,
  homework: HomeworkNode,
  event: EventNode,
  note: NoteNode,
  group: GroupNode,
  custom: CustomNode,
};