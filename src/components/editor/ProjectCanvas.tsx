import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2, Upload, Workflow as WorkflowIcon } from 'lucide-react';
import type { Project, Canvas, CanvasNode as DbCanvasNode, CanvasEdge as DbCanvasEdge, CanvasNodeType, CanvasEdgeType } from '@/types';
import NodeToolbox from './NodeToolbox';
import PropertiesPanel from './PropertiesPanel';
import EdgeContextMenu from './EdgeContextMenu';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { detectCycle } from './cycleDetect';
import { getEntityOpenPath } from './nodeRegistry';
import { History, reconcileToSnapshot, type ExportPayload } from './history';
import { ExportButton, ImportModal } from './ImportExport';

const TYPE_META: Record<CanvasNodeType, { label: string; color: string }> = {
  task:     { label: '任务',   color: '#00FF88' },
  course:   { label: '课程',   color: '#00D4FF' },
  homework: { label: '作业',   color: '#FF3366' },
  event:    { label: '日程',   color: '#F98FC2' },
  note:     { label: '便签',   color: '#FFEA00' },
  group:    { label: '分组',   color: '#A78BFA' },
  custom:   { label: '自定义', color: '#9CA3AF' },
};

function dbToFlowNodes(dbNodes: DbCanvasNode[]): Node[] {
  return dbNodes.map((n) => {
    let extra: Record<string, any> = {};
    try { extra = JSON.parse(n.data_json || '{}'); } catch { /* ignore */ }
    const meta = TYPE_META[n.node_type];
    return {
      id: String(n.id),
      type: n.node_type,
      position: { x: n.pos_x, y: n.pos_y },
      width: n.width,
      height: n.height,
      data: {
        title: extra.title || n.title,
        dbId: n.id,
        nodeType: n.node_type,
        color: extra.color || meta.color,
        notes: extra.notes || '',
        entity_id: n.entity_id ?? null,
      },
    };
  });
}

function dbToFlowEdges(dbEdges: DbCanvasEdge[]): Edge[] {
  return dbEdges.map((e) => ({
    id: String(e.id),
    source: String(e.source_node_id),
    target: String(e.target_node_id),
    type: e.edge_type,
    label: e.label || undefined,
    data: { edgeType: e.edge_type, dbId: e.id, hovered: false },
  }));
}

type Selection =
  | { kind: 'node'; node: Node }
  | { kind: 'edge'; edge: Edge };

function ProjectCanvasInner({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [currentCanvas, setCurrentCanvas] = useState<Canvas | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const dragRef = useRef<Array<{ id: number; pos_x: number; pos_y: number }>>([]);
  const historyRef = useRef(new History());
  const [, forceUpdate] = useState({});
  const [importOpen, setImportOpen] = useState(false);
  const bumpHistory = () => forceUpdate({});

  // v1.3.0：一项目一画布 —— 取该项目的画布，没有则自动创建（自动命名，不走 window.prompt —— Electron 下 prompt 不可用）
  useEffect(() => {
    let alive = true;
    (async () => {
      setCurrentCanvas(null);
      setNodes([]);
      setEdges([]);
      setSelection(null);
      historyRef.current.clear();
      try {
        let c = (await window.taskAPI.db.canvases.getByProject(project.id)) as Canvas | null;
        if (!alive) return;
        if (!c) {
          c = (await window.taskAPI.db.canvases.create({
            name: `${project.name} · 画布`,
            project_id: project.id,
          })) as Canvas;
        }
        if (!alive) return;
        setCurrentCanvas(c);
        const [ns, es] = await Promise.all([
          window.taskAPI.db.canvasNodes.listByCanvas(c.id),
          window.taskAPI.db.canvasEdges.listByCanvas(c.id),
        ]);
        if (!alive) return;
        setNodes(dbToFlowNodes(ns || []));
        setEdges(dbToFlowEdges(es || []));
      } catch (e) {
        console.error('project canvas load failed:', e);
      }
    })();
    return () => { alive = false; };
  }, [project.id]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const isRemove = changes.some((c) => c.type === 'remove');
    if (isRemove) {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
    }
    setNodes((prev) => applyNodeChanges(changes, prev));
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        if (c.dragging) {
          const existing = dragRef.current.find((x) => x.id === Number(c.id));
          if (existing) {
            existing.pos_x = c.position.x;
            existing.pos_y = c.position.y;
          } else {
            dragRef.current.push({ id: Number(c.id), pos_x: c.position.x, pos_y: c.position.y });
          }
        } else {
          window.taskAPI.db.canvasNodes.updatePositions([{ id: Number(c.id), pos_x: c.position.x, pos_y: c.position.y }]);
          dragRef.current = dragRef.current.filter((x) => x.id !== Number(c.id));
        }
      }
      if (c.type === 'remove') {
        window.taskAPI.db.canvasNodes.delete(Number(c.id));
      }
    }
  }, [nodes, edges]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const isRemove = changes.some((c) => c.type === 'remove');
    if (isRemove) {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
    }
    setEdges((prev) => applyEdgeChanges(changes, prev));
    for (const c of changes) {
      if (c.type === 'remove') {
        window.taskAPI.db.canvasEdges.delete(Number(c.id));
      }
    }
  }, [nodes, edges]);

  const onConnect = useCallback(
    async (conn: Connection) => {
      if (!currentCanvas || !conn.source || !conn.target) return;
      const cycle = detectCycle(
        nodes.map((n) => ({ id: n.id })),
        edges.map((e) => ({ source: e.source, target: e.target })),
        { source: conn.source, target: conn.target },
      );
      if (cycle.hasCycle) {
        const path = (cycle.cyclePath ?? []).join(' → ');
        window.alert(`该连线会形成循环依赖：\n${path}\n\n请先断开环路中的一条连线。`);
        return;
      }
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      try {
        const created = await window.taskAPI.db.canvasEdges.create({
          canvas_id: currentCanvas.id,
          source_node_id: Number(conn.source),
          target_node_id: Number(conn.target),
          edge_type: 'sequence',
        });
        setEdges((prev) =>
          addEdge(
            {
              ...conn,
              id: String(created.id),
              type: 'sequence',
              data: { edgeType: 'sequence', dbId: created.id, hovered: false },
            },
            prev,
          ),
        );
      } catch (e) {
        console.error('connect failed:', e);
      }
    },
    [currentCanvas, nodes, edges],
  );

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/canvas-node-type') as CanvasNodeType;
      const entityIdStr = event.dataTransfer.getData('application/canvas-entity-id');
      const entityId = entityIdStr ? Number(entityIdStr) : null;
      if (!type || !currentCanvas) return;
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const position = {
        x: event.clientX - rect.left - 100,
        y: event.clientY - rect.top - 40,
      };
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      try {
        const created = await window.taskAPI.db.canvasNodes.create({
          canvas_id: currentCanvas.id,
          node_type: type,
          title: TYPE_META[type].label,
          pos_x: position.x,
          pos_y: position.y,
          entity_id: entityId,
          data: { color: TYPE_META[type].color },
        });
        setNodes((prev) => [
          ...prev,
          {
            id: String(created.id),
            type,
            position,
            data: {
              title: created.title,
              dbId: created.id,
              nodeType: type,
              color: TYPE_META[type].color,
              notes: '',
              entity_id: created.entity_id ?? null,
            },
          },
        ]);
      } catch (e) {
        console.error('drop create failed:', e);
      }
    },
    [currentCanvas, nodes, edges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onNodeClick = useCallback((_: any, node: Node) => setSelection({ kind: 'node', node }), []);
  const onEdgeClick = useCallback((_: any, edge: Edge) => setSelection({ kind: 'edge', edge }), []);
  const onPaneClick = useCallback(() => setSelection(null), []);
  const onNodeMouseEnter = useCallback((_: any, node: Node) => setHoveredNodeId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);

  const decoratedEdges = useMemo(() => {
    const targetId = hoveredNodeId ?? (selection?.kind === 'node' ? selection.node.id : null);
    if (!targetId) return edges;
    return edges.map((e) => ({
      ...e,
      data: { ...e.data, hovered: e.source === targetId || e.target === targetId },
    }));
  }, [edges, hoveredNodeId, selection]);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setSelection({ kind: 'edge', edge });
    setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const changeEdgeType = useCallback(
    async (edgeId: string, newType: CanvasEdgeType) => {
      if (!currentCanvas) return;
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;
      setEdges((prev) =>
        prev.map((e) => (e.id === edgeId ? { ...e, type: newType, data: { ...e.data, edgeType: newType } } : e)),
      );
      try {
        await window.taskAPI.db.canvasEdges.update(Number(edgeId), {
          canvas_id: currentCanvas.id,
          edge_type: newType,
          label: (edge.label as string) ?? null,
          data: (edge.data as any) ?? {},
        });
      } catch (e) {
        console.error('change edge type failed:', e);
      }
      setContextMenu(null);
    },
    [nodes, edges, currentCanvas],
  );

  const deleteEdge = useCallback(
    async (edgeId: string) => {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      try {
        await window.taskAPI.db.canvasEdges.delete(Number(edgeId));
      } catch (e) {
        console.error('delete edge failed:', e);
      }
      setContextMenu(null);
      setSelection(null);
    },
    [nodes, edges],
  );

  /* 节点右上角 ExternalLink → 跳转业务实体页 */
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { nodeType: CanvasNodeType; entity_id: number };
      if (!detail?.entity_id) return;
      const path = getEntityOpenPath(detail.nodeType, detail.entity_id);
      if (path) navigate(path.url);
    };
    window.addEventListener('canvas:openEntity', handler);
    return () => window.removeEventListener('canvas:openEntity', handler);
  }, [navigate]);

  const performUndo = useCallback(async () => {
    if (!currentCanvas) return;
    const snap = historyRef.current.undo({ nodes, edges });
    if (!snap) return;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    bumpHistory();
    setLoading(true);
    try {
      await reconcileToSnapshot(currentCanvas.id, snap);
    } catch (e) {
      console.error('undo reconcile failed:', e);
    } finally {
      setLoading(false);
    }
  }, [nodes, edges, currentCanvas]);

  const performRedo = useCallback(async () => {
    if (!currentCanvas) return;
    const snap = historyRef.current.redo({ nodes, edges });
    if (!snap) return;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    bumpHistory();
    setLoading(true);
    try {
      await reconcileToSnapshot(currentCanvas.id, snap);
    } catch (e) {
      console.error('redo reconcile failed:', e);
    } finally {
      setLoading(false);
    }
  }, [nodes, edges, currentCanvas]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inField) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        performUndo();
      } else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        performRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [performUndo, performRedo]);

  const handleImport = useCallback(
    async (payload: ExportPayload, replace: boolean) => {
      if (!currentCanvas) return;
      try {
        if (replace) {
          const [curN, curE] = await Promise.all([
            window.taskAPI.db.canvasNodes.listByCanvas(currentCanvas.id),
            window.taskAPI.db.canvasEdges.listByCanvas(currentCanvas.id),
          ]);
          for (const n of curN) await window.taskAPI.db.canvasNodes.delete(n.id);
          for (const e of curE) await window.taskAPI.db.canvasEdges.delete(e.id);
        }
        historyRef.current.push({ nodes, edges });
        bumpHistory();
        for (const n of payload.nodes) {
          await window.taskAPI.db.canvasNodes.create({
            canvas_id: currentCanvas.id,
            node_type: (n.type as CanvasNodeType) || 'custom',
            title: (n.data as any).title || '未命名',
            pos_x: n.position.x,
            pos_y: n.position.y,
            entity_id: (n.data as any).entity_id ?? null,
            data: { color: (n.data as any).color, notes: (n.data as any).notes },
          });
        }
        for (const e of payload.edges) {
          await window.taskAPI.db.canvasEdges.create({
            canvas_id: currentCanvas.id,
            source_node_id: e.source,
            target_node_id: e.target,
            edge_type: (e.type as CanvasEdgeType) || 'sequence',
            label: e.label ?? null,
            data: e.data || {},
          });
        }
        const [ns, es] = await Promise.all([
          window.taskAPI.db.canvasNodes.listByCanvas(currentCanvas.id),
          window.taskAPI.db.canvasEdges.listByCanvas(currentCanvas.id),
        ]);
        setNodes(dbToFlowNodes(ns || []));
        setEdges(dbToFlowEdges(es || []));
      } catch (e) {
        console.error('import failed:', e);
        window.alert('导入失败：' + (e as Error).message);
      }
    },
    [currentCanvas, nodes, edges],
  );

  const updateNode = useCallback(
    async (
      id: number,
      patch: { title?: string; color?: string; notes?: string; node_type?: CanvasNodeType; entity_id?: number | null },
    ) => {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      setNodes((prev) =>
        prev.map((n) => (n.id === String(id) ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
      if (!currentCanvas) return;
      const node = nodes.find((n) => n.id === String(id));
      if (!node) return;
      const data = node.data as {
        title: string; color?: string; notes?: string;
        nodeType?: CanvasNodeType; entity_id?: number | null;
      };
      try {
        await window.taskAPI.db.canvasNodes.update(id, {
          canvas_id: currentCanvas.id,
          node_type: patch.node_type ?? data.nodeType ?? 'task',
          entity_id: patch.entity_id !== undefined ? patch.entity_id : data.entity_id ?? null,
          title: patch.title ?? data.title,
          data: {
            title: patch.title ?? data.title,
            color: patch.color ?? data.color,
            notes: patch.notes ?? data.notes,
          },
        });
      } catch (e) {
        console.error(e);
      }
    },
    [nodes, currentCanvas],
  );

  const updateEdge = useCallback(
    async (
      id: number,
      patch: { edge_type?: CanvasEdgeType; label?: string | null },
    ) => {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      const edge = edges.find((e) => e.id === String(id));
      if (!edge || !currentCanvas) return;
      const nextType = patch.edge_type ?? (edge.type as CanvasEdgeType) ?? 'sequence';
      const nextLabel = patch.label === undefined ? edge.label : patch.label;
      setEdges((prev) =>
        prev.map((e) =>
          e.id === String(id)
            ? { ...e, type: nextType, label: nextLabel ?? undefined, data: { ...e.data, edgeType: nextType } }
            : e,
        ),
      );
      try {
        await window.taskAPI.db.canvasEdges.update(id, {
          canvas_id: currentCanvas.id,
          edge_type: nextType,
          label: nextLabel ?? null,
          data: (edge.data as any) ?? {},
        });
      } catch (e) {
        console.error('update edge failed:', e);
      }
    },
    [nodes, edges, currentCanvas],
  );

  const deleteNode = useCallback(async (id: number) => {
    historyRef.current.push({ nodes, edges });
    bumpHistory();
    try {
      await window.taskAPI.db.canvasNodes.delete(id);
      setNodes((prev) => prev.filter((n) => n.id !== String(id)));
      setEdges((prev) => prev.filter((e) => e.source !== String(id) && e.target !== String(id)));
      setSelection(null);
    } catch (e) {
      console.error(e);
    }
  }, [nodes, edges]);

  return (
    <div className="h-full flex flex-col">
      {/* 轻量顶栏：项目画布标识 + 撤销/重做 + 导入导出 + 统计 */}
      <div className="h-10 px-3 flex items-center gap-2 border-b border-neon-green/15 bg-ink-900/60 backdrop-blur shrink-0">
        <WorkflowIcon size={14} className="text-neon-green" />
        <span className="text-xs font-mono uppercase tracking-wider text-text-secondary truncate max-w-[200px]" title={project.name}>
          {project.name} · 画布
        </span>
        <div className="flex bg-ink-base/60 rounded border border-neon-green/20 overflow-hidden ml-1">
          <button
            onClick={performUndo}
            disabled={!historyRef.current.canUndo()}
            className="px-2 py-1 font-mono text-xs text-text-secondary hover:text-neon-green hover:bg-neon-green/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="撤销 (Ctrl+Z)"
          >
            <Undo2 size={11} />
          </button>
          <button
            onClick={performRedo}
            disabled={!historyRef.current.canRedo()}
            className="px-2 py-1 font-mono text-xs text-text-secondary hover:text-neon-green hover:bg-neon-green/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-l border-neon-green/20"
            title="重做 (Ctrl+Y)"
          >
            <Redo2 size={11} />
          </button>
        </div>
        <button onClick={() => setImportOpen(true)} className="btn-ghost text-xs" title="从 JSON 导入">
          <Upload size={12} />
        </button>
        <ExportButton
          canvasName={currentCanvas?.name || `${project.name} · 画布`}
          canvasDescription={currentCanvas?.description}
          viewport={currentCanvas ? { x: currentCanvas.viewport_x, y: currentCanvas.viewport_y, zoom: currentCanvas.viewport_zoom } : { x: 0, y: 0, zoom: 1 }}
          nodes={nodes}
          edges={edges}
        />
        <div className="flex-1" />
        <span className="text-[10px] text-text-dim font-mono">
          {nodes.length} 节点 · {edges.length} 连线
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        <NodeToolbox />
        <div className="flex-1 relative min-w-0" onDrop={onDrop} onDragOver={onDragOver}>
          {currentCanvas ? (
            <ReactFlow
              nodes={nodes}
              edges={decoratedEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onEdgeClick={onEdgeClick}
              onEdgeContextMenu={onEdgeContextMenu}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              deleteKeyCode={['Delete', 'Backspace']}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} color="rgba(0,255,136,0.15)" />
              <Controls className="!bg-ink-900/80 !border !border-neon-green/30" />
              <MiniMap
                className="!bg-ink-900/80 !border !border-neon-green/30"
                maskColor="rgba(0,0,0,0.6)"
                nodeColor={(n) => ((n.data as any)?.color as string) || '#00FF88'}
              />
              {loading && (
                <Panel
                  position="top-center"
                  className="!bg-ink-900/80 !border !border-neon-green/30 px-3 py-1 rounded text-xs font-mono"
                >
                  加载中…
                </Panel>
              )}
            </ReactFlow>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-text-dim gap-3">
              <WorkflowIcon size={48} className="opacity-30" />
              <div className="text-sm font-mono">画布加载中…</div>
            </div>
          )}
        </div>
        {selection && currentCanvas && (
          <PropertiesPanel
            selection={selection}
            onClose={() => setSelection(null)}
            onUpdateNode={updateNode}
            onUpdateEdge={updateEdge}
            onDeleteNode={deleteNode}
            onDeleteEdge={(id) => deleteEdge(String(id))}
          />
        )}
      </div>

      {contextMenu && currentCanvas && (
        <EdgeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          currentType={
            (edges.find((e) => e.id === contextMenu.edgeId)?.type as CanvasEdgeType) || 'sequence'
          }
          onChangeType={(t) => changeEdgeType(contextMenu.edgeId, t)}
          onDelete={() => deleteEdge(contextMenu.edgeId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {importOpen && currentCanvas && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}

/** v1.3.0 项目画布：每个项目自带一张画布（canvases.project_id 绑定），嵌入 Projects 页 */
export default function ProjectCanvas(props: { project: Project }) {
  return (
    <ReactFlowProvider>
      <ProjectCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
