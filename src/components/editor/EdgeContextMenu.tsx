import { Trash2 } from 'lucide-react';
import { EDGE_TYPE_META } from './edges';
import type { CanvasEdgeType } from '@/types';

/** v1.2.1 连线右键菜单：改线型 / 改 label / 删除（label 编辑在 PropertiesPanel） */
export default function EdgeContextMenu({
  x, y, onChangeType, onDelete, onClose,
}: {
  x: number;
  y: number;
  currentType: CanvasEdgeType;
  onChangeType: (type: CanvasEdgeType) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* 全屏透明遮罩，点击关闭 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-48 rounded-lg p-1.5 space-y-0.5"
        style={{
          top: y, left: x,
          background: 'linear-gradient(135deg, rgba(0,0,0,0.92), rgba(0,0,0,0.82))',
          backdropFilter: 'blur(12px) saturate(1.4)',
          border: '1px solid rgba(0,255,136,0.25)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 16px rgba(0,255,136,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="label-tag px-2 mb-1">连线操作</div>
        {(Object.entries(EDGE_TYPE_META) as Array<[CanvasEdgeType, typeof EDGE_TYPE_META['sequence']]>).map(
          ([type, meta]) => (
            <button
              key={type}
              onClick={() => onChangeType(type)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-text-primary hover:bg-neon-green/10 hover:text-neon-green transition-colors"
            >
              <span
                className="w-4 h-4 flex items-center justify-center shrink-0 font-bold"
                style={{ color: meta.color }}
                title={meta.label}
              >
                {meta.icon}
              </span>
              <span className="flex-1 text-left">改为{meta.label}线</span>
            </button>
          ),
        )}
        <div className="h-px bg-neon-green/10 my-1" />
        <button
          onClick={onDelete}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono transition-colors hover:bg-[#FF3366]/15"
          style={{ color: '#FF3366' }}
        >
          <Trash2 size={12} />
          <span className="flex-1 text-left">删除连线</span>
        </button>
      </div>
    </>
  );
}