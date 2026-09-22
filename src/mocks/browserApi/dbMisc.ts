/**
 * v1.2.8 块 L：db.stats / db.grades / db.exams / db.pomodoro / db.habits / db.attendance mock
 */
import { delay, nextId, withCourseInfo, computeStats, type MockData } from './data';
import type { Grade, Exam, PomodoroSession, Habit, Attendance } from '@/types';
import type { HabitCheckin } from './data';

export function createMiscApi(data: MockData) {
  return {
    stats: {
      dashboard: async () => { await delay(); return computeStats(data); },
      report: async (from: number, to: number) => {
        await delay();
        return {
          reqDoneByDay: [] as Array<{ day: string; n: number }>,
          reqDoneByCourse: [] as Array<{ courseId: number; courseName: string | null; courseColor: string | null; n: number }>,
          habitCheckinsByDay: [] as Array<{ day: string; n: number }>,
          attendanceSummary: { present: 0, late: 0, absent: 0, leave: 0 },
          range: { from, to },
        };
      },
    },
    grades: {
      list: async () => { await delay(); return data.grades.map((g) => withCourseInfo(g, data)); },
      create: async (payload: Partial<Grade>) => {
        await delay();
        const g = { id: nextId(), created_at: Date.now(), updated_at: Date.now(), ...payload } as Grade;
        data.grades.push(g);
        return g;
      },
      update: async (id: number, payload: Partial<Grade>) => {
        await delay();
        const i = data.grades.findIndex((g) => g.id === id);
        if (i >= 0) data.grades[i] = { ...data.grades[i], ...payload, updated_at: Date.now() };
        return data.grades[i];
      },
      delete: async (id: number) => { await delay(); data.grades = data.grades.filter((g) => g.id !== id); return { ok: true }; },
    },
    exams: {
      list: async () => {
        await delay();
        return data.exams.map((e) => withCourseInfo(e, data)).filter((e: any) => e.status !== 'cancelled');
      },
      create: async (payload: Partial<Exam>) => {
        await delay();
        const e = { id: nextId(), created_at: Date.now(), status: 'upcoming', ...payload } as Exam;
        data.exams.push(e);
        return e;
      },
      update: async (id: number, payload: Partial<Exam>) => {
        await delay();
        const i = data.exams.findIndex((e) => e.id === id);
        if (i >= 0) data.exams[i] = { ...data.exams[i], ...payload };
        return data.exams[i];
      },
      delete: async (id: number) => { await delay(); data.exams = data.exams.filter((e) => e.id !== id); return { ok: true }; },
    },
    pomodoro: {
      list: async () => { await delay(); return [...data.pomodoros].map((p) => withCourseInfo(p, data)); },
      create: async (payload: Partial<PomodoroSession>) => {
        await delay();
        const p = { id: nextId(), created_at: Date.now(), mode: 'work', ...payload } as PomodoroSession;
        data.pomodoros.push(p);
        return p;
      },
      stop: async (id: number, minutes: number) => {
        await delay();
        const i = data.pomodoros.findIndex((p) => p.id === id);
        if (i >= 0) data.pomodoros[i] = { ...data.pomodoros[i], ended_at: Date.now(), minutes };
        return data.pomodoros[i];
      },
      stats: async () => { await delay(); return { byDay: [], byCourse: [] }; },
    },
    habits: {
      list: async () => {
        await delay();
        return data.habits.map((h) => ({
          ...h,
          checkinDates: data.habitCheckins.filter((c) => c.habit_id === h.id).map((c) => c.date),
        }));
      },
      create: async (payload: Partial<Habit>) => {
        await delay();
        const h = {
          id: nextId(), created_at: Date.now(), emoji: '🔥', color: '#00FF88',
          frequency: 'daily', target_per_week: null, archived: 0, sort_order: 0,
          ...payload
        } as Habit;
        data.habits.push(h);
        return h;
      },
      update: async (id: number, payload: Partial<Habit>) => {
        await delay();
        const i = data.habits.findIndex((h) => h.id === id);
        if (i >= 0) data.habits[i] = { ...data.habits[i], ...payload };
        return data.habits[i];
      },
      delete: async (id: number) => {
        await delay();
        data.habits = data.habits.filter((h) => h.id !== id);
        data.habitCheckins = data.habitCheckins.filter((c) => c.habit_id !== id);
        return { ok: true };
      },
      toggleCheckin: async (habitId: number, date: string) => {
        await delay();
        const i = data.habitCheckins.findIndex((c) => c.habit_id === habitId && c.date === date);
        if (i >= 0) {
          data.habitCheckins.splice(i, 1);
          return { ok: true, checked: false };
        }
        const entry = { habit_id: habitId, date, created_at: Date.now() } as HabitCheckin;
        data.habitCheckins.push(entry);
        return { ok: true, checked: true };
      },
    },
    attendance: {
      list: async () => { await delay(); return data.attendances.map((a) => withCourseInfo(a, data)); },
      upsert: async (payload: Partial<Attendance>) => {
        await delay();
        const i = data.attendances.findIndex((a) => a.course_id === payload.course_id && a.date === payload.date);
        if (i >= 0) data.attendances[i] = { ...data.attendances[i], ...payload };
        else data.attendances.push({ id: nextId(), created_at: Date.now(), ...payload } as Attendance);
        return data.attendances.find((a) => a.course_id === payload.course_id && a.date === payload.date);
      },
      stats: async () => { await delay(); return { present: 0, late: 0, absent: 0, leave: 0 }; },
    },
  };
}