/**
 * v1.2.8 块 L：db.settings / db.userProfiles / db.courseNotes mock（v1.2.10 移除 miniPrograms）
 */
import { delay, nextId, type MockData } from './data';
import type { UserProfile, CourseNote } from '@/types';

export function createSettingsApi(data: MockData) {
  return {
    settings: {
      getAll: async () => { await delay(); return { ...data.settings }; },
      set: async (key: string, value: string) => {
        await delay();
        data.settings = { ...data.settings, [key]: value };
        return { ok: true };
      },
    },
    userProfiles: {
      list: async () => { await delay(); return [...data.userProfiles]; },
      getActive: async () => { await delay(); return data.userProfiles.find((p) => p.is_active) ?? null; },
      getByOpenid: async (openid: string) => {
        await delay();
        return data.userProfiles.find((p) => p.wx_openid === openid) ?? null;
      },
      create: async (payload: Partial<UserProfile>) => {
        await delay();
        const p = { id: nextId(), created_at: Date.now(), updated_at: Date.now(), ...payload } as UserProfile;
        data.userProfiles = [...data.userProfiles, p];
        return p;
      },
      update: async (id: number, payload: Partial<UserProfile>) => {
        await delay();
        data.userProfiles = data.userProfiles.map((p) => (p.id === id ? { ...p, ...payload, updated_at: Date.now() } : p));
        return data.userProfiles.find((p) => p.id === id) ?? null;
      },
      delete: async (id: number) => { await delay(); data.userProfiles = data.userProfiles.filter((p) => p.id !== id); return { ok: true }; },
      setActive: async (id: number) => {
        await delay();
        data.userProfiles = data.userProfiles.map((p) => ({ ...p, is_active: p.id === id ? 1 : 0 }));
        return data.userProfiles.find((p) => p.id === id) ?? null;
      },
    },
    courseNotes: {
      list: async (courseId: number) => {
        await delay();
        return data.courseNotes
          .filter((n) => n.course_id === courseId)
          .sort((a, b) => b.created_at - a.created_at);
      },
      create: async (payload: Partial<CourseNote>) => {
        await delay();
        const n = { id: nextId(), created_at: Date.now(), ...payload } as CourseNote;
        data.courseNotes = [...data.courseNotes, n];
        return n;
      },
      update: async (id: number, payload: Partial<CourseNote>) => {
        await delay();
        data.courseNotes = data.courseNotes.map((n) => (n.id === id ? { ...n, ...payload } : n));
        return data.courseNotes.find((n) => n.id === id) ?? null;
      },
      delete: async (id: number) => { await delay(); data.courseNotes = data.courseNotes.filter((n) => n.id !== id); return { ok: true }; },
    },
  };
}