/**
 * v1.2.8 块 L：db.projects / db.tasks mock
 */
import { delay, nextId, type MockData } from './data';
import type { Project, ProjectTask } from '@/types';

export function createProjectsApi(data: MockData) {
  return {
    projects: {
      list: async () => { await delay(); return [...data.projects]; },
      get: async (id: number) => { await delay(); return data.projects.find((p) => p.id === id) ?? null; },
      create: async (payload: Partial<Project>) => {
        await delay();
        const p = { id: nextId(), created_at: Date.now(), status: 'active', progress: 0, ...payload } as Project;
        data.projects = [...data.projects, p];
        return p;
      },
      update: async (id: number, payload: Partial<Project>) => {
        await delay();
        data.projects = data.projects.map((p) => (p.id === id ? { ...p, ...payload } : p));
        return data.projects.find((p) => p.id === id);
      },
      delete: async (id: number) => {
        await delay();
        data.projects = data.projects.filter((p) => p.id !== id);
        data.tasks = data.tasks.filter((t) => t.project_id !== id);
        return { ok: true };
      },
    },
    tasks: {
      list: async (filter?: { project_id?: number }) => {
        await delay();
        let rows = data.tasks.map((t) => ({
          ...t,
          project_name: data.projects.find((p) => p.id === t.project_id)?.name,
        }));
        if (filter?.project_id) rows = rows.filter((t) => t.project_id === filter.project_id);
        return rows;
      },
      create: async (payload: Partial<ProjectTask>) => {
        await delay();
        const t = { id: nextId(), order_index: 0, status: 'todo', ...payload } as ProjectTask;
        data.tasks = [...data.tasks, t];
        return t;
      },
      update: async (id: number, payload: Partial<ProjectTask>) => {
        await delay();
        data.tasks = data.tasks.map((t) => (t.id === id ? { ...t, ...payload } : t));
        return data.tasks.find((t) => t.id === id);
      },
      delete: async (id: number) => { await delay(); data.tasks = data.tasks.filter((t) => t.id !== id); return { ok: true }; },
    },
  };
}