import type { Node, Edge } from '@xyflow/react';
import type { CanvasNodeType, CanvasEdgeType } from '@/types';

/**
 * v1.2.1 块 7：基于快照的撤销重做栈（patch-based 简化版）。
 *
 * 决策：选用「全状态快照」而非操作日志。理由：
 * - 单 canvas 节点/边规模通常 < 200，JSON 序列化开销 < 5ms
 * - 无需考虑复杂操作的合并（如拖拽中途 undo）
 * - DB 同步逻辑简单（删除旧 + 插入新）
 *
 * 代价：内存占用约 (节点+边) × 50 步上限 ≈ 50KB/canvas，无忧
 *
 * 设计要点：
 * - 每次「用户级操作」执行前调用 `push()` 记录当前状态
 * - undo() 返回前一个快照，调用方负责 setState + DB reconcile
 * - redo() 同理
 * - 切换画布、首次加载（load 完成后）应清空历史，避免跨画布污染
 */

export type Snapshot = {
  nodes: Node[];
  edges: Edge[];
};

const MAX_HISTORY = 50;

export class History {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];

  /** 当前状态推入历史（在用户操作之前调用）。 */
  push(current: { nodes: Node[]; edges: Edge[] }): void {
    this.past.push(deepCopy(current));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = []; // 任何新操作都清空 redo 栈
  }

  /** 撤销：返回上一个快照；将当前状态压入 future。返回 null 表示已无可撤销。 */
  undo(current: { nodes: Node[]; edges: Edge[] }): Snapshot | null {
    if (this.past.length === 0) return null;
    const snap = this.past.pop()!;
    this.future.push(deepCopy(current));
    return snap;
  }

  /** 重做：返回下一个快照；将当前状态压入 past。 */
  redo(current: { nodes: Node[]; edges: Edge[] }): Snapshot | null {
    if (this.future.length === 0) return null;
    const snap = this.future.pop()!;
    this.past.push(deepCopy(current));
    return snap;
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

function deepCopy<T>(o: T): T {
  return JSON.parse(JSON.stringify(o));
}

/**
 * v1.2.1 块 7：DB 同步 —— 把 UI 状态「拉成"权威态"。
 *
 * 由于节点/边 ID 是 DB 自增主键，撤销重做过程中会丢失 ID 连续性。
 * 这里采用「全删全插」策略，简单可靠，适合 200 节点以下的画布。
 *
 * 流程：
 * 1. 读当前 DB 中所有 nodes + edges
 * 2. 全部 delete
 * 3. 按 snapshot 顺序 create
 *
 * 副作用：snapshot 里的临时 ID（未落库的）会丢失，但 `push()` 在操作前调用保证了
 * snapshot 中的所有节点都已落库。
 */
export async function reconcileToSnapshot(
  canvasId: number,
  snapshot: Snapshot,
): Promise<{ nodesCreated: number; edgesCreated: number }> {
  const dbNodes = (await window.taskAPI.db.canvasNodes.listByCanvas(canvasId)) || [];
  const dbEdges = (await window.taskAPI.db.canvasEdges.listByCanvas(canvasId)) || [];

  // 1. 全部删除
  for (const n of dbNodes) await window.taskAPI.db.canvasNodes.delete(n.id);
  for (const e of dbEdges) await window.taskAPI.db.canvasEdges.delete(e.id);

  // 2. 按顺序重建
  let nodesCreated = 0, edgesCreated = 0;
  for (const n of snapshot.nodes) {
    const data = n.data as { title: string; color?: string; notes?: string; entity_id?: number | null };
    await window.taskAPI.db.canvasNodes.create({
      canvas_id: canvasId,
      node_type: (n.type || 'custom') as CanvasNodeType,
      title: data.title || '未命名',
      pos_x: n.position.x,
      pos_y: n.position.y,
      entity_id: data.entity_id ?? null,
      data: { color: data.color, notes: data.notes },
    });
    nodesCreated++;
  }
  for (const e of snapshot.edges) {
    await window.taskAPI.db.canvasEdges.create({
      canvas_id: canvasId,
      source_node_id: Number(e.source),
      target_node_id: Number(e.target),
      edge_type: (e.type || 'sequence') as CanvasEdgeType,
      label: (e.label as string) || null,
      data: (e.data as any) || {},
    });
    edgesCreated++;
  }
  return { nodesCreated, edgesCreated };
}

/* ========== 导入导出格式 ========== */

export type ExportPayload = {
  /** schema 版本号（用于导入端校验兼容性） */
  schema: 'taskmanager.canvas.v1';
  /** 导出时间（ISO） */
  exportedAt: string;
  /** 画布元信息 */
  canvas: { name: string; description?: string };
  viewport: { x: number; y: number; zoom: number };
  nodes: Array<{
    /** 导出时使用 db.id（用户重导入后会重新分配，保持一致性能避免外部引用失效） */
    id: number;
    type: string;
    position: { x: number; y: number };
    data: Record<string, any>;
  }>;
  edges: Array<{
    id: number;
    source: number;
    target: number;
    type: string;
    label?: string | null;
    data?: Record<string, any>;
  }>;
};

export function buildExportPayload(
  canvasName: string,
  canvasDescription: string | null | undefined,
  viewport: { x: number; y: number; zoom: number },
  nodes: Node[],
  edges: Edge[],
): ExportPayload {
  return {
    schema: 'taskmanager.canvas.v1',
    exportedAt: new Date().toISOString(),
    canvas: { name: canvasName, description: canvasDescription || undefined },
    viewport,
    nodes: nodes.map((n) => ({
      id: Number(n.id),
      type: n.type || 'custom',
      position: { x: n.position.x, y: n.position.y },
      data: (n.data as Record<string, any>) || {},
    })),
    edges: edges.map((e) => ({
      id: Number(e.id),
      source: Number(e.source),
      target: Number(e.target),
      type: e.type || 'sequence',
      label: (e.label as string) || null,
      data: (e.data as Record<string, any>) || {},
    })),
  };
}

/** 解析 JSON + 校验 schema 版本（失败抛错） */
export function parseImportPayload(raw: string): ExportPayload {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error('JSON 解析失败：' + (e as Error).message);
  }
  if (!obj?.schema || obj.schema !== 'taskmanager.canvas.v1') {
    throw new Error('不兼容的 schema 版本：' + obj?.schema);
  }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error('nodes/edges 字段缺失或格式错误');
  }
  return obj as ExportPayload;
}