import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';

/** v1.2.1 关键路径（critical）：外发光（drop-shadow）+ 内粗实线 */
export default function CriticalEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style, markerEnd, selected, label, data,
}: EdgeProps) {
  const hovered = (data as any)?.hovered;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  });
  const strokeW = selected ? 4 : hovered ? 3.5 : 3;

  return (
    <>
      {/* 外发光（粗透明 stroke，drop-shadow 让它真正发光） */}
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          stroke: 'rgba(255,51,102,0.35)',
          strokeWidth: strokeW + 6,
          filter: 'drop-shadow(0 0 6px #FF3366)',
          fill: 'none',
          ...style,
        }}
      />
      {/* 内实线（主色） */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: '#FF3366',
          strokeWidth: strokeW,
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
              background: 'rgba(0,0,0,0.9)',
              padding: '1px 6px',
              borderRadius: 4,
              fontSize: 10,
              color: '#FFE0E6',
              border: '1px solid #FF3366',
              boxShadow: '0 0 6px rgba(255,51,102,0.6)',
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