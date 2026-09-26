/**
 * v1.2.8 块 L：db.courses / db.requirements / db.events / db.categories mock
 */
import { delay, nextId, withCourseInfo, type MockData } from './data';
import type { Course, Requirement, Category } from '@/types';

export function createCoursesApi(data: MockData) {
  const wrapList = <T extends { course_id?: number | null }>(rows: T[]) =>
    rows.map((r) => withCourseInfo(r, data));

  return {
    courses: {
      list: async () => { await delay(); return [...data.courses]; },
      get: async (id: number) => { await delay(); return data.courses.find((c) => c.id === id) ?? null; },
      create: async (payload: Partial<Course>) => {
        await delay();
        const c: Course = { id: nextId(), created_at: Date.now(), color: payload.color ?? '#00FF88', ...payload } as Course;
        data.courses = [...data.courses, c];
        return c;
      },
      update: async (id: number, payload: Partial<Course>) => {
        await delay();
        data.courses = data.courses.map((c) => (c.id === id ? { ...c, ...payload } : c));
        return data.courses.find((c) => c.id === id);
      },
      delete: async (id: number) => {
        await delay();
        data.courses = data.courses.filter((c) => c.id !== id);
        data.requirements = data.requirements.filter((r) => r.course_id !== id);
        data.events = data.events.filter((e: any) => e.course_id !== id);
        data.courseNotes = data.courseNotes.filter((n) => n.course_id !== id);

        return { ok: true };
      },
    },
    requirements: {
      list: async (filter?: { course_id?: number; status?: string }) => {
        await delay();
        let rows = wrapList(data.requirements);
        if (filter?.course_id) rows = rows.filter((r) => r.course_id === filter.course_id);
        if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
        return rows;
      },
      create: async (payload: Partial<Requirement>) => {
        await delay();
        const r = { id: nextId(), created_at: Date.now(), priority: 2, status: 'pending', ...payload } as Requirement;
        data.requirements = [...data.requirements, r];
        return withCourseInfo(r, data);
      },
      update: async (id: number, payload: Partial<Requirement>) => {
        await delay();
        data.requirements = data.requirements.map((r) => (r.id === id ? { ...r, ...payload } : r));
        return withCourseInfo(data.requirements.find((r) => r.id === id)!, data);
      },
      delete: async (id: number) => { await delay(); data.requirements = data.requirements.filter((r) => r.id !== id); return { ok: true }; },
    },
    events: {
      list: async (filter?: { from?: number; to?: number }) => {
        await delay();
        let rows = wrapList(data.events);
        if (filter?.from || filter?.to) {
          rows = rows.filter((e) =>
            (!filter.from || e.start_at >= filter.from) && (!filter.to || e.start_at <= filter.to)
          );
        }
        return rows;
      },
      create: async (payload: any) => {
        await delay();
        const e: any = { id: nextId(), all_day: 0, type: 'event', ...payload };
        if (e.all_day) e.all_day = 1;
        data.events = [...data.events, e];
        return withCourseInfo(e, data);
      },
      update: async (id: number, payload: any) => {
        await delay();
        data.events = data.events.map((e) => (e.id === id ? { ...e, ...payload, all_day: payload.all_day ? 1 : 0 } : e));
        return withCourseInfo(data.events.find((e) => e.id === id)!, data);
      },
      delete: async (id: number) => { await delay(); data.events = data.events.filter((e) => e.id !== id); return { ok: true }; },
    },
    categories: {
      list: async () => { await delay(); return [...data.categories]; },
      create: async (payload: Partial<Category>) => {
        await delay();
        const c = { id: nextId(), created_at: Date.now(), color: payload.color ?? '#00FF88', ...payload } as Category;
        data.categories = [...data.categories, c];
        return c;
      },
      update: async (id: number, payload: Partial<Category>) => {
        await delay();
        data.categories = data.categories.map((c) => (c.id === id ? { ...c, ...payload } : c));
        return data.categories.find((c) => c.id === id);
      },
      delete: async (id: number) => { await delay(); data.categories = data.categories.filter((c) => c.id !== id); return { ok: true }; },
    },
  };
}