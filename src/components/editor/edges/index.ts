import SequenceEdge from './SequenceEdge';
import DependencyEdge from './DependencyEdge';
import RelationEdge from './RelationEdge';
import CriticalEdge from './CriticalEdge';

/** v1.2.1 自定义连线类型映射：edge.type === edge.edge_type */
export const edgeTypes = {
  sequence: SequenceEdge,
  dependency: DependencyEdge,
  relation: RelationEdge,
  critical: CriticalEdge,
};

/** 边视觉元信息（用于右键菜单缩略预览 + PropertiesPanel） */
export const EDGE_TYPE_META = {
  sequence:   { label: '顺序',   color: '#00FF88', icon: '─' },
  dependency: { label: '依赖',   color: '#00D4FF', icon: '┄' },
  relation:   { label: '关联',   color: '#A78BFA', icon: '═' },
  critical:   { label: '关键',   color: '#FF3366', icon: '✦' },
} as const;