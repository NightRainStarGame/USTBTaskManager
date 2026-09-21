import { useState, useEffect } from 'react';
import { X, Trash2, ExternalLink } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import type { CanvasNodeType, CanvasEdgeType } from '@/types';
import { useStore } from '@/store';
import { EDGE_TYPE_META } from './edges';
import { NODE_REGISTRY, getEntityOpenPath } from './nodeRegistry';

const TYPE_LABELS: Record<CanvasNodeType, string> = {
  task: '任务',
  course: '课程',
  homework: '作业',
  event: '日程',
  note: '便签',
  group: '分组',
  custom: '自定义',
};

const COLORS = ['#00FF88', '#00D4FF', '#FF3366', '#F98FC2', '#FFEA00', '#A78BFA', '#9CA3AF'];

type NodeData = { title: string; color?: string; notes?: string; nodeType?: CanvasNodeType; entity_id?: number | null };
type EdgeData = { edgeType?: CanvasEdgeType };

type Selection =
  | { kind: 'node'; node: Node }
  | { kind: 'edge'; edge: Edge };

export default function PropertiesPanel(props: {
  selection: Selection;
  onClose: () => void;
  onUpdateNode: (id: number, patch: { title?: string; color?: string; notes?: string; node_type?: CanvasNodeType; entity_id?: number | null }) => Promise<void>;
  onUpdateEdge: (id: number, patch: { edge_type?: CanvasEdgeType; label?: string | null }) => Promise<void>;
  onDeleteNode: (id: number) => Promise<void>;
  onDeleteEdge: (id: number) => Promise<void>;
}) {
  const { selection, onClose, onUpdateNode, onUpdateEdge, onDeleteNode, onDeleteEdge } = props;

  if (selection.kind === 'node') {
    return <NodePanel
      node={selection.node}
      onClose={onClose}
      onUpdate={(patch) => onUpdateNode(Number(selection.node.id), patch)}
      onDelete={() => onDeleteNode(Number(selection.node.id))}
    />;
  }
  return <EdgePanel
    edge={selection.edge}
    onClose={onClose}
    onUpdate={(patch) => onUpdateEdge(Number(selection.edge.id), patch)}
    onDelete={() => onDeleteEdge(Number(selection.edge.id))}
  />;
}

/* ========== 节点属性 ========== */
function NodePanel({
  node, onUpdate, onClose, onDelete,
}: {
  node: Node;
  onUpdate: (patch: { title?: string; color?: string; notes?: string; node_type?: CanvasNodeType; entity_id?: number | null }) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const data = node.data as NodeData;
  const [title, setTitle] = useState(data.title);
  const [color, setColor] = useState(data.color || '#00FF88');
  const [notes, setNotes] = useState(data.notes || '');
  const [nodeType, setNodeType] = useState<CanvasNodeType>(data.nodeType || 'task');
  const [entityId, setEntityId] = useState<number | null>(data.entity_id ?? null);

  // v1.2.1 块 6：从 store 取实体列表用于选择器
  const courses = useStore((s) => s.courses);
  const requirements = useStore((s) => s.requirements);
  const events = useStore((s) => s.events);
  const projects = useStore((s) => s.projects);
  const tasks = useStore((s) => s.tasks);

  useEffect(() => {
    setTitle(data.title);
    setColor(data.color || '#00FF88');
    setNotes(data.notes || '');
    setNodeType(data.nodeType || 'task');
    setEntityId(data.entity_id ?? null);
  }, [node.id]);

  const meta = NODE_REGISTRY[nodeType];
  const openPath = entityId != null ? getEntityOpenPath(nodeType, entityId) : null;

  return (
    <div className="w-72 shrink-0 border-l border-neon-green/15 bg-ink-900/40 backdrop-blur p-3 flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="label-tag">节点属性</div>
        <button onClick={onClose} className="btn-ghost p-1" title="关闭"><X size={14} /></button>
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">类型</div>
        <select
          value={nodeType}
          onChange={(e) => {
            const v = e.target.value as CanvasNodeType;
            setNodeType(v);
            onUpdate({ node_type: v });
          }}
          className="input-neon w-full text-xs"
        >
          {(Object.entries(TYPE_LABELS) as Array<[CanvasNodeType, string]>).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">标题</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onUpdate({ title })}
          className="input-neon w-full text-xs"
        />
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">颜色</div>
        <div className="flex gap-1.5 flex-wrap">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                setColor(c);
                onUpdate({ color: c });
              }}
              className={`w-7 h-7 rounded border-2 transition-all ${
                color === c
                  ? 'border-text-primary scale-110 shadow-neon-green'
                  : 'border-transparent hover:border-text-dim'
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">备注</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => onUpdate({ notes })}
          className="input-neon w-full text-xs"
          rows={3}
          placeholder="附加说明…"
        />
      </div>

      {/* v1.2.1 块 6：关联业务实体选择（仅当 nodeType.bindable !== 'none'） */}
      {meta.bindable !== 'none' && (
        <div>
          <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">
            关联{meta.label}实体
          </div>
          <div className="flex gap-1.5">
            <select
              value={entityId ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                setEntityId(v);
                onUpdate({ entity_id: v });
              }}
              className="input-neon flex-1 text-xs"
            >
              <option value="">— 不关联 —</option>
              {meta.bindable === 'course' &&
                courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {meta.bindable === 'requirement' &&
                requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.type}] {r.title} {r.course_name ? `· ${r.course_name}` : ''}
                  </option>
                ))}
              {meta.bindable === 'event' &&
                events.map((ev) => (
                  <option key={ev.id} value={ev.id}>{ev.title}</option>
                ))}
              {meta.bindable === 'project_task' &&
                projects.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {tasks.filter((t) => t.project_id === p.id).map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </optgroup>
                ))}
            </select>
            {openPath && (
              <button
                title="打开关联实体"
                onClick={() => window.location.assign(openPath.url)}
                className="btn-neon shrink-0 px-2"
                style={{ color: meta.color, borderColor: `${meta.color}55` }}
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-text-dim font-mono mt-2 space-y-0.5">
        <div>ID: #{node.id}</div>
        <div>X: {Math.round(node.position.x)}, Y: {Math.round(node.position.y)}</div>
      </div>

      <div className="mt-auto pt-3 border-t border-neon-green/15">
        <button
          onClick={() => {
            if (window.confirm('删除此节点？关联的连线也会一并删除。')) onDelete();
          }}
          className="btn-neon w-full text-xs"
          style={{ color: '#FF3366', borderColor: 'rgba(255,51,102,0.4)' }}
        >
          <Trash2 size={12} /> 删除节点
        </button>
      </div>
    </div>
  );
}

/* ========== 边属性 ========== */
function EdgePanel({
  edge, onUpdate, onClose, onDelete,
}: {
  edge: Edge;
  onUpdate: (patch: { edge_type?: CanvasEdgeType; label?: string | null }) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const data = edge.data as EdgeData;
  const currentType: CanvasEdgeType = (edge.type as CanvasEdgeType) || data.edgeType || 'sequence';
  const [label, setLabel] = useState(edge.label as string || '');

  useEffect(() => {
    setLabel((edge.label as string) || '');
  }, [edge.id]);

  const meta = EDGE_TYPE_META[currentType];

  return (
    <div className="w-72 shrink-0 border-l border-neon-green/15 bg-ink-900/40 backdrop-blur p-3 flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="label-tag" style={{ color: meta.color }}>连线属性</div>
        <button onClick={onClose} className="btn-ghost p-1" title="关闭"><X size={14} /></button>
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">线型</div>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(EDGE_TYPE_META) as Array<[CanvasEdgeType, typeof EDGE_TYPE_META['sequence']]>).map(
            ([type, m]) => (
              <button
                key={type}
                onClick={() => onUpdate({ edge_type: type })}
                className={`px-2 py-1.5 rounded border-2 text-xs font-mono transition-all ${
                  currentType === type
                    ? 'border-neon-green bg-neon-green/10 shadow-neon-green'
                    : 'border-neon-green/15 bg-ink-900/60 hover:border-neon-green/40'
                }`}
              >
                <span className="font-bold mr-1" style={{ color: m.color }}>{m.icon}</span>
                <span className="text-text-primary">{m.label}</span>
              </button>
            ),
          )}
        </div>
      </div>

      <div>
        <div className="text-[10px] text-text-dim mb-1 font-mono uppercase tracking-wider">标签（可选）</div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => onUpdate({ label: label.trim() || null })}
          placeholder="例如：前置 / 后续 / 阻塞…"
          className="input-neon w-full text-xs"
        />
      </div>

      <div className="text-[10px] text-text-dim font-mono mt-2 space-y-0.5">
        <div>ID: #{edge.id}</div>
        <div>{edge.source} → {edge.target}</div>
      </div>

      <div className="mt-auto pt-3 border-t border-neon-green/15">
        <button
          onClick={() => {
            if (window.confirm('删除此连线？')) onDelete();
          }}
          className="btn-neon w-full text-xs"
          style={{ color: '#FF3366', borderColor: 'rgba(255,51,102,0.4)' }}
        >
          <Trash2 size={12} /> 删除连线
        </button>
      </div>
    </div>
  );
}