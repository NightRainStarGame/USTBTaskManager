import type { LucideIcon } from 'lucide-react';
import {
  CheckSquare, BookOpen, ClipboardList, Calendar, StickyNote, Folder, Box,
} from 'lucide-react';
import type { CanvasNodeType } from '@/types';

/** v1.2.1 块 6：节点类型注册表 —— 类型 → 图标/颜色/可关联实体类型 */
export type EntityKind = 'course' | 'requirement' | 'project_task' | 'event' | 'none';

export const NODE_REGISTRY: Record<CanvasNodeType, {
  label: string;
  color: string;
  Icon: LucideIcon;
  /** 该类型节点可绑定的业务实体类型（none = 不可绑定） */
  bindable: EntityKind;
}> = {
  task:     { label: '任务',   color: '#00FF88', Icon: CheckSquare,    bindable: 'project_task' },
  course:   { label: '课程',   color: '#00D4FF', Icon: BookOpen,       bindable: 'course' },
  homework: { label: '作业',   color: '#FF3366', Icon: ClipboardList,  bindable: 'requirement' },
  event:    { label: '日程',   color: '#F98FC2', Icon: Calendar,       bindable: 'event' },
  note:     { label: '便签',   color: '#FFEA00', Icon: StickyNote,     bindable: 'none' },
  group:    { label: '分组',   color: '#A78BFA', Icon: Folder,         bindable: 'none' },
  custom:   { label: '自定义', color: '#9CA3AF', Icon: Box,            bindable: 'none' },
};

/** v1.2.1 块 6：节点 entity_id → URL 跳转路径（带 query 参数，由接收方决定 tab 行为） */
export function getEntityOpenPath(
  type: CanvasNodeType,
  entityId: number | null | undefined,
): { url: string; needsId: boolean } | null {
  if (!entityId) return null;
  const meta = NODE_REGISTRY[type];
  if (meta.bindable === 'none') return null;
  switch (meta.bindable) {
    case 'course':        return { url: `/courses?course=${entityId}`,  needsId: true };
    case 'requirement':   return { url: `/courses?tab=reqs&course=${entityId}`, needsId: true };
    case 'project_task':  return { url: `/projects`,                     needsId: false };
    case 'event':         return { url: `/calendar?event=${entityId}`,   needsId: true };
    default:              return null;
  }
}

/** 实体类型 → 列表 label（PropertiesPanel 下拉用） */
export const ENTITY_OPTIONS: Record<EntityKind, string> = {
  course:       '关联课程',
  requirement:  '关联作业',
  project_task: '关联项目任务',
  event:        '关联日程',
  none:         '不关联',
};