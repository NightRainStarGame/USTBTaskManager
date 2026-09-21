import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2, Workflow as WorkflowIcon, ArrowLeft, Undo2, Redo2, Upload } from 'lucide-react';
import type { Canvas, CanvasNode as DbCanvasNode, CanvasEdge as DbCanvasEdge, CanvasNodeType, CanvasEdgeType } from '@/types';
import NodeToolbox from '@/components/editor/NodeToolbox';
import PropertiesPanel from '@/components/editor/PropertiesPanel';
import EdgeContextMenu from '@/components/editor/EdgeContextMenu';
import { nodeTypes } from '@/components/editor/nodes';
import { edgeTypes } from '@/components/editor/edges';
import { detectCycle } from '@/components/editor/cycleDetect';
import { getEntityOpenPath } from '@/components/editor/nodeRegistry';
import { History, reconcileToSnapshot, type ExportPayload } from '@/components/editor/history';
import { ExportButton, ImportModal } from '@/components/editor/ImportExport';

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
        /** v1.2.1 块 6：关联业务实体 */
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
    /** xyflow edge.type === edge.edge_type（让 ReactFlow 选对应的自定义 edge 组件） */
    type: e.edge_type,
    label: e.label || undefined,
    data: { edgeType: e.edge_type, dbId: e.id, hovered: false },
  }));
}

type Selection =
  | { kind: 'node'; node: Node }
  | { kind: 'edge'; edge: Edge };

function EditorInner() {
  const { canvasId: canvasIdParam } = useParams();
  const navigate = useNavigate();
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [currentCanvas, setCurrentCanvas] = useState<Canvas | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; edgeId: string } | null>(null);
  const [loading, setLoading] = useState(false);
  /** 用于拖拽节流：拖动中只更内存坐标，松手时落库 */
  const dragRef = useRef<Array<{ id: number; pos_x: number; pos_y: number }>>([]);
  /** v1.2.1 块 7：撤销重做栈 */
  const historyRef = useRef(new History());
  /** 强制刷新，让 Undo/Redo 按钮 enabled 状态正确 */
  const [, forceUpdate] = useState({});
  const [importOpen, setImportOpen] = useState(false);
  const bumpHistory = () => forceUpdate({});

  // 加载画布列表
  useEffect(() => {
    (async () => {
      try {
        const list = (await window.taskAPI.db.canvases.list()) || [];
        setCanvases(list);
        if (canvasIdParam) {
          const c = list.find((x: Canvas) => String(x.id) === canvasIdParam);
          if (c) setCurrentCanvas(c);
        } else if (list.length > 0) {
          setCurrentCanvas(list[0]);
          navigate(`/editor/${list[0].id}`, { replace: true });
        }
      } catch (e) {
        console.error('canvases.list failed:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载节点 + 边
  useEffect(() => {
    if (!currentCanvas) {
      setNodes([]);
      setEdges([]);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [ns, es] = await Promise.all([
          window.taskAPI.db.canvasNodes.listByCanvas(currentCanvas.id),
          window.taskAPI.db.canvasEdges.listByCanvas(currentCanvas.id),
        ]);
        setNodes(dbToFlowNodes(ns || []));
        setEdges(dbToFlowEdges(es || []));
        // v1.2.1 块 7：切换画布清空历史
        historyRef.current.clear();
        bumpHistory();
      } catch (e) {
        console.error('load nodes/edges failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentCanvas?.id]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // v1.2.1 块 7：删除节点是可撤销操作，删除前记录快照
    const isRemove = changes.some((c) => c.type === 'remove');
    if (isRemove) {
      historyRef.current.push({ nodes, edges });
      bumpHistory();
    }
    setNodes((prev) => applyNodeChanges(changes, prev));
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        if (c.dragging) {
          // 拖动中：缓存，松手时批量落库（一次 IPC 多条）
          const existing = dragRef.current.find((x) => x.id === Number(c.id));
          if (existing) {
            existing.pos_x = c.position.x;
            existing.pos_y = c.position.y;
          } else {
            dragRef.current.push({ id: Number(c.id), pos_x: c.position.x, pos_y: c.position.y });
          }
        } else {
          // 拖完：立即落库 + 清缓存
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
    // v1.2.1 块 7：删除连线是可撤销操作
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
      // v1.2.1 块 6：保存前检测循环依赖（DFS 3-coloring）
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
      // v1.2.1 块 7：创建连线前记录快照
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
      // v1.2.1 块 7：新建节点前记录快照
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
    [currentCanvas],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  /* === 选中态 === */
  const onNodeClick = useCallback((_: any, node: Node) => setSelection({ kind: 'node', node }), []);
  const onEdgeClick = useCallback((_: any, edge: Edge) => setSelection({ kind: 'edge', edge }), []);
  const onPaneClick = useCallback(() => setSelection(null), []);

  /* === hover 高亮相关连线 === */
  const onNodeMouseEnter = useCallback((_: any, node: Node) => setHoveredNodeId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);

  /** 给每条边注入 hovered 标记：hover 节点 / 选中节点关联的边为 true */
  const decoratedEdges = useMemo(() => {
    const targetId = hoveredNodeId ?? (selection?.kind === 'node' ? selection.node.id : null);
    if (!targetId) return edges;
    return edges.map((e) => ({
      ...e,
      data: { ...e.data, hovered: e.source === targetId || e.target === targetId },
    }));
  }, [edges, hoveredNodeId, selection]);

  /* === 右键菜单 === */
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setSelection({ kind: 'edge', edge });
    setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const changeEdgeType = useCallback(
    async (edgeId: string, newType: CanvasEdgeType) => {
      if (!currentCanvas) return;
      // v1.2.1 块 7：改线型前记录快照
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;
      // 乐观更新内存 + 落库
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
      // v1.2.1 块 7：删连线前记录快照
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

  /* v1.2.1 块 6：节点右上角 ExternalLink → 跳转到 Courses/Calendar/Projects 详情 */
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

  /* v1.2.1 块 7：Ctrl+Z / Ctrl+Y 全局快捷键 */
  const performUndo = useCallback(async () => {
    if (!currentCanvas) return;
    const snap = historyRef.current.undo({ nodes, edges });
    if (!snap) return;
    setNodes(snap.nodes);
    setEdges(snap.edges);
    bumpHistory();
    // 同步 DB：删除当前所有 → 按快照重新插入
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
      // 在输入框内不拦截
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

  /** v1.2.1 块 7：导入 JSON — replace=true 则清空当前画布重建 */
  const handleImport = useCallback(
    async (payload: ExportPayload, replace: boolean) => {
      if (!currentCanvas) return;
      try {
        if (replace) {
          // 清空现有节点/边
          const [curN, curE] = await Promise.all([
            window.taskAPI.db.canvasNodes.listByCanvas(currentCanvas.id),
            window.taskAPI.db.canvasEdges.listByCanvas(currentCanvas.id),
          ]);
          for (const n of curN) await window.taskAPI.db.canvasNodes.delete(n.id);
          for (const e of curE) await window.taskAPI.db.canvasEdges.delete(e.id);
        }
        // 记录快照（导入前）
        historyRef.current.push({ nodes, edges });
        bumpHistory();
        // 按顺序插入
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
        // 重新拉取
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

  const createCanvas = async () => {
    const name = window.prompt('新画布名称', '未命名画布');
    if (!name || !name.trim()) return;
    try {
      const c = await window.taskAPI.db.canvases.create({ name: name.trim() });
      setCanvases((prev) => [c, ...prev]);
      setCurrentCanvas(c);
      navigate(`/editor/${c.id}`, { replace: true });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteCanvas = async () => {
    if (!currentCanvas) return;
    if (!window.confirm(`删除画布「${currentCanvas.name}」？所有节点和连线将一并删除。`)) return;
    try {
      await window.taskAPI.db.canvases.delete(currentCanvas.id);
      setCanvases((prev) => prev.filter((x) => x.id !== currentCanvas.id));
      setCurrentCanvas(null);
      navigate('/editor', { replace: true });
    } catch (e) {
      console.error(e);
    }
  };

  const updateNode = useCallback(
    async (
      id: number,
      patch: { title?: string; color?: string; notes?: string; node_type?: CanvasNodeType; entity_id?: number | null },
    ) => {
      // v1.2.1 块 7：属性修改前记录快照（注意：频繁输入框 onChange 也会触发；UI 层 PropertiesPanel 已 onBlur 节流）
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
      // v1.2.1 块 7：属性修改前记录快照
      historyRef.current.push({ nodes, edges });
      bumpHistory();
      const edge = edges.find((e) => e.id === String(id));
      if (!edge || !currentCanvas) return;
      // 乐观更新
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
    // v1.2.1 块 7：删除节点前记录快照
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
      <div className="h-12 px-3 flex items-center gap-2 border-b border-neon-green/15 bg-ink-900/60 backdrop-blur shrink-0">
        <button
          onClick={() => navigate('/projects')}
          className="btn-ghost text-xs"
          title="返回项目"
        >
          <ArrowLeft size={14} />
        </button>
        <WorkflowIcon size={16} className="text-neon-green" />
        <span className="text-xs font-mono uppercase tracking-wider text-text-secondary">画布编辑器</span>
        <select
          value={currentCanvas?.id ? String(currentCanvas.id) : ''}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) {
              setCurrentCanvas(null);
              navigate('/editor', { replace: true });
              return;
            }
            const c = canvases.find((x) => String(x.id) === id);
            setCurrentCanvas(c || null);
            navigate(`/editor/${id}`, { replace: true });
          }}
          className="input-neon w-64 text-xs"
        >
          <option value="">— 选择画布 —</option>
          {canvases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={createCanvas} className="btn-neon text-xs">
          <Plus size={12} /> 新建画布
        </button>
        {currentCanvas && (
          <>
            {/* v1.2.1 块 7：撤销 / 重做 */}
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
              canvasName={currentCanvas.name}
              canvasDescription={currentCanvas.description}
              viewport={{ x: currentCanvas.viewport_x, y: currentCanvas.viewport_y, zoom: currentCanvas.viewport_zoom }}
              nodes={nodes}
              edges={edges}
            />
            <button
              onClick={deleteCanvas}
              className="btn-ghost text-xs"
              style={{ color: '#FF3366' }}
              title="删除当前画布"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
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
              <WorkflowIcon size={56} className="opacity-30" />
              <div className="text-sm font-mono">还没有画布</div>
              <button onClick={createCanvas} className="btn-neon text-xs">
                <Plus size={12} /> 新建画布
              </button>
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

/** v1.2.1 画布编辑器：ReactFlowProvider 包外层，避免 hooks 在 Router context 外 */
export default function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}