/**
 * v1.2.8 块 L：db.canvases / db.canvasNodes / db.canvasEdges mock
 */
import { delay, nextId, type MockData } from './data';
import type { Canvas, CanvasNode, CanvasEdge } from '@/types';

export function createCanvasApi(data: MockData) {
  return {
    canvases: {
      list: async () => { await delay(); return [...data.canvases]; },
      get: async (id: number) => { await delay(); return data.canvases.find((c) => c.id === id) ?? null; },
      getByProject: async (projectId: number) => {
        await delay();
        return data.canvases.find((c) => c.project_id === projectId) ?? null;
      },
      create: async (payload: Partial<Canvas>) => {
        await delay();
        const c = {
          id: nextId(), created_at: Date.now(), updated_at: Date.now(),
          name: '画布', description: null, viewport_x: 0, viewport_y: 0, viewport_zoom: 1,
          ...payload
        } as Canvas;
        data.canvases = [...data.canvases, c];
        return c;
      },
      update: async (id: number, payload: Partial<Canvas>) => {
        await delay();
        data.canvases = data.canvases.map((c) => (c.id === id ? { ...c, ...payload, updated_at: Date.now() } : c));
        return data.canvases.find((c) => c.id === id) ?? null;
      },
      delete: async (id: number) => {
        await delay();
        data.canvases = data.canvases.filter((c) => c.id !== id);
        data.canvasNodes = data.canvasNodes.filter((n) => n.canvas_id !== id);
        data.canvasEdges = data.canvasEdges.filter((e) => e.canvas_id !== id);
        return { ok: true };
      },
    },
    canvasNodes: {
      listByCanvas: async (canvasId: number) => {
        await delay();
        return data.canvasNodes.filter((n) => n.canvas_id === canvasId);
      },
      create: async (payload: Partial<CanvasNode>) => {
        await delay();
        const n = { id: nextId(), ...payload } as CanvasNode;
        data.canvasNodes = [...data.canvasNodes, n];
        return n;
      },
      update: async (id: number, payload: Partial<CanvasNode>) => {
        await delay();
        data.canvasNodes = data.canvasNodes.map((n) => (n.id === id ? { ...n, ...payload } : n));
        return data.canvasNodes.find((n) => n.id === id) ?? null;
      },
      updatePositions: async (rows: Array<{ id: number; pos_x: number; pos_y: number }>) => {
        await delay();
        for (const r of rows || []) {
          data.canvasNodes = data.canvasNodes.map((n) => (n.id === r.id ? { ...n, pos_x: r.pos_x, pos_y: r.pos_y } : n));
        }
        return { ok: true };
      },
      delete: async (id: number) => {
        await delay();
        data.canvasNodes = data.canvasNodes.filter((n) => n.id !== id);
        data.canvasEdges = data.canvasEdges.filter((e) => e.source_node_id !== id && e.target_node_id !== id);
        return { ok: true };
      },
    },
    canvasEdges: {
      listByCanvas: async (canvasId: number) => {
        await delay();
        return data.canvasEdges.filter((e) => e.canvas_id === canvasId);
      },
      create: async (payload: Partial<CanvasEdge>) => {
        await delay();
        const e = { id: nextId(), ...payload } as CanvasEdge;
        data.canvasEdges = [...data.canvasEdges, e];
        return e;
      },
      update: async (id: number, payload: Partial<CanvasEdge>) => {
        await delay();
        data.canvasEdges = data.canvasEdges.map((e) => (e.id === id ? { ...e, ...payload } : e));
        return data.canvasEdges.find((e) => e.id === id) ?? null;
      },
      delete: async (id: number) => {
        await delay();
        data.canvasEdges = data.canvasEdges.filter((e) => e.id !== id);
        return { ok: true };
      },
    },
  };
}