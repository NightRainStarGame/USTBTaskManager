import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/** v1.2.1 关联（relation）：双线 —— 上下两条平行 bezier 路径 */
export default function RelationEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, markerEnd, selected, label, data,
}: EdgeProps) {
  const hovered = (data as any)?.hovered;
  const offset = 4;
  // 上下两条平行线（源/目标点分别垂直偏移 ±offset）
  const [pathTop] = getBezierPath({
    sourceX, sourceY: sourceY - offset, sourcePosition,
    targetX, targetY: targetY - offset, targetPosition,
  });
  const [pathBottom] = getBezierPath({
    sourceX, sourceY: sourceY + offset, sourcePosition,
    targetX, targetY: targetY + offset, targetPosition,
  });
  const [_, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  const strokeW = selected ? 3 : hovered ? 2.5 : 2;

  return (
    <>
      {/* 透明命中区（用于点击/选中，整条线都响应） */}
      <BaseEdge
        id={`${id}-hit`}
        path={pathTop}
        style={{ stroke: 'transparent', strokeWidth: 14, fill: 'none', ...style }}
      />
      {/* 上线 */}
      <BaseEdge
        id={`${id}-top`}
        path={pathTop}
        markerEnd={markerEnd}
        style={{
          stroke: '#A78BFA',
          strokeWidth: strokeW,
          fill: 'none',
          transition: 'stroke-width 120ms ease',
          ...style,
        }}
      />
      {/* 下线 */}
      <BaseEdge
        id={`${id}-bottom`}
        path={pathBottom}
        style={{
          stroke: '#A78BFA',
          strokeWidth: strokeW,
          fill: 'none',
          transition: 'stroke-width 120ms ease',
          ...style,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'rgba(0,0,0,0.85)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
              color: '#E8DDFF',
              border: '1px solid #A78BFA66',
              pointerEvents: 'all',
            }}
            className="nodrag nopan font-mono"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}