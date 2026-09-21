import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/** v1.2.1 顺序流（sequence）：默认线型，bezier 曲线实线 */
export default function SequenceEdge({
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
          stroke: '#00FF88',
          strokeWidth: selected ? 3.5 : hovered ? 3 : 2,
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
              color: '#E8FFEE',
              border: '1px solid #00FF8866',
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