/**
 * v1.2.1 块 6：循环依赖检测 —— 经典 DFS 三色标记（白/灰/黑）
 * 输入：当前所有 nodes + 候选新边 / 候选新增节点
 * 输出：true = 检测到环，false = 无环
 *
 * 算法：
 * - WHITE (0) 未访问
 * - GRAY  (1) 递归栈中（正在访问）
 * - BLACK (2) 完成
 *
 * 复杂度 O(V+E)，一次建图一次 DFS，对千节点 + 千边场景 < 1ms
 */
export type AdjList = Map<string | number, Array<string | number>>;

export function detectCycle(
  nodes: Array<{ id: string | number }>,
  edges: Array<{ source: string | number; target: string | number }>,
  /** 候选变更：可选，若提供则先尝试应用后再检测（不会改原数组） */
  candidate?: { source: string | number; target: string | number },
): { hasCycle: boolean; cyclePath?: Array<string | number> } {
  // 构建邻接表
  const adj: AdjList = new Map();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  // 候选变更临时加入
  if (candidate) {
    if (!adj.has(candidate.source)) adj.set(candidate.source, []);
    adj.get(candidate.source)!.push(candidate.target);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string | number, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  /** 父链记录（用于环路径还原） */
  const parent = new Map<string | number, string | number | null>();

  function dfs(u: string | number): { found: boolean; at?: string | number } {
    color.set(u, GRAY);
    for (const v of adj.get(u) || []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) return { found: true, at: v };
      if (c === WHITE) {
        parent.set(v, u);
        const r = dfs(v);
        if (r.found) return r;
      }
    }
    color.set(u, BLACK);
    return { found: false };
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) {
      parent.set(n.id, null);
      const r = dfs(n.id);
      if (r.found && r.at !== undefined) {
        // 还原环：r.at 是灰色节点，从 r.at 沿父链走回 r.at 即可
        const path: Array<string | number> = [r.at];
        let cur: string | number | null = parent.get(r.at) ?? null;
        while (cur !== null && cur !== undefined && cur !== r.at) {
          path.push(cur);
          cur = parent.get(cur) ?? null;
        }
        return { hasCycle: true, cyclePath: path.reverse() };
      }
    }
  }
  return { hasCycle: false };
}