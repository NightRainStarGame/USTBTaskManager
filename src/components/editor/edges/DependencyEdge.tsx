import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/** v1.2.1 依赖（dependency）：虚线（动画间隔 6-4） */
export default function DependencyEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, markerEnd, selected, label, data,
}: EdgeProps) {
  const hovered = (data as any)?.hovered;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: '#00D4FF',
          strokeWidth: selected ? 3.5 : hovered ? 3 : 2,
          strokeDasharray: '6 4',
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
              color: '#D4F6FF',
              border: '1px solid #00D4FF66',
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