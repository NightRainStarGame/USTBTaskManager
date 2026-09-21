/**
 * 浏览器模式下的 taskAPI 内存 Mock。
 * Electron 环境使用 preload 注入的真实 IPC 桥；
 * 纯浏览器（vite dev 预览）环境下注入此 Mock，便于 UI 预览与调试。
 */
import type {
  Course, Requirement, CalendarEvent, Project, ProjectTask, DashboardStats, UserProfile, CourseMiniProgram, CourseNote,
} from '@/types';

export interface Category {
  id: number;
  name: string;
  color: string;
  emoji?: string | null;
  created_at: number;
}

const DAY = 86400000;
/** 浏览器预览用的模拟版本号（与 package.json 保持一致即可，仅展示用） */
const MOCK_APP_VERSION = '0.3.0';

/**
 * 浏览器预览时的默认更新源，需与 electron/updater/index.ts 的
 * DEFAULT_UPDATE_SOURCES 保持一致（主源 = StarOS 自建站，GitHub 为备用镜像）。
 */
const MOCK_DEFAULT_SOURCES: Array<{ name: string; url: string; enabled: boolean; primary: boolean }> = [
  { name: 'StarOS / nrsc.games', url: 'https://nrsc.games/downloads/taskmanager/latest.json', enabled: true, primary: true },
  { name: 'GitHub / leastversion', url: 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json', enabled: true, primary: false },
];

const MOCK_DEFAULT_SOURCE = MOCK_DEFAULT_SOURCES[0].url;
const today = new Date();
today.setHours(0, 0, 0, 0);
const T0 = today.getTime();

// ---------- 内存数据（默认为空，全部由用户自行创建） ----------
let courses: Course[] = [];
let requirements: Requirement[] = [];
let events: any[] = [];
let categories: Category[] = [];
let projects: Project[] = [];
let tasks: ProjectTask[] = [];
// v1.3.0 画布内存存根
let canvases: any[] = [];
let canvasNodes: any[] = [];
let canvasEdges: any[] = [];

let settings: Record<string, any> = {
  theme: 'green',
  semester: '2026-Fall',
  semester_start: String(T0),
};

let userProfiles: UserProfile[] = [];
let courseNotes: CourseNote[] = [];
let miniPrograms: CourseMiniProgram[] = [];

// ---------- 贝壳课表（USTB）Mock 状态 ----------
const ustbMock = {
  pollCount: 0,
  loggedIn: false,
  user: null as { name: string; school: string; userId: string } | null,
  term: null as { xn: string; xq: string } | null,
  lastSync: null as number | null,
  importedCourseIds: [] as number[],
};

/** 生成一个二维码风格的占位 SVG（浏览器预览用） */
function fakeQrSvg(): string {
  const size = 25;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let cells = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder = (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
      if (!inFinder && rnd() > 0.52) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
    }
  }
  const finder = (fx: number, fy: number) => {
    cells += `<rect x="${fx}" y="${fy}" width="7" height="7" fill="#000"/><rect x="${fx + 1}" y="${fy + 1}" width="5" height="5" fill="#fff"/><rect x="${fx + 2}" y="${fy + 2}" width="3" height="3" fill="#000"/>`;
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/>${cells}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

/** 演示课表（模拟 BYYT 解析结果） */
const USTB_DEMO_ITEMS = [
  { day: 1, period: 1, className: '高等代数(II)', teacher: '李明', weeksText: '1-16周', weeks: [] as number[], location: '理化楼401', periodName: '第1,2节' },
  { day: 1, period: 3, className: '数据结构', teacher: '王芳', weeksText: '1-16周', weeks: [], location: '机电楼320', periodName: '第5,6节' },
  { day: 2, period: 2, className: '大学英语(IV)', teacher: '张莉', weeksText: '1-16周(单)', weeks: [1, 3, 5, 7, 9, 11, 13, 15], location: '外语楼205', periodName: '第3,4节' },
  { day: 3, period: 1, className: '高等代数(II)', teacher: '李明', weeksText: '1-16周', weeks: [], location: '理化楼401', periodName: '第1,2节' },
  { day: 3, period: 4, className: '概率论与数理统计', teacher: '赵强', weeksText: '1-16周', weeks: [], location: '逸夫楼502', periodName: '第7,8节' },
  { day: 4, period: 2, className: '数据结构', teacher: '王芳', weeksText: '1-8周', weeks: [1, 2, 3, 4, 5, 6, 7, 8], location: '机电楼320', periodName: '第3,4节' },
  { day: 5, period: 1, className: '中国近现代史纲要', teacher: '陈华', weeksText: '1-16周(双)', weeks: [2, 4, 6, 8, 10, 12, 14, 16], location: '文法楼108', periodName: '第1,2节' },
] as Array<{ day: number; period: number; className: string; teacher: string; weeksText: string; weeks: number[]; location: string; periodName: string }>;


// ---------- 工具 ----------
const delay = (ms = 60) => new Promise((r) => setTimeout(r, ms));
let autoId = 100;
const nextId = () => ++autoId;

function computeStats(): DashboardStats {
  const pending = requirements.filter((r) => r.status === 'pending' || r.status === 'in_progress');
  return {
    totalReq: requirements.length,
    pendingReq: pending.length,
    overdueReq: requirements.filter((r) => r.status === 'overdue').length,
    dueTodayReq: requirements.filter((r) => r.due_date >= T0 && r.due_date < T0 + DAY && r.status !== 'done').length,
    dueWeekReq: requirements.filter((r) => r.due_date >= T0 && r.due_date < T0 + 7 * DAY && r.status !== 'done').length,
    totalCourses: courses.length,
    activeProjects: projects.filter((p) => p.status === 'active').length,
    todayEvents: events.filter((e) => e.start_at >= T0 && e.start_at < T0 + DAY).length,
  };
}

function withCourseInfo<T extends { course_id?: number | null }>(row: T): T & { course_name?: string; course_color?: string; category_name?: string; category_color?: string; category_emoji?: string } {
  const c = courses.find((x) => x.id === row.course_id);
  const cat = categories.find((x) => x.id === (row as any).category_id);
  return {
    ...row,
    course_name: c?.name,
    course_color: c?.color,
    category_name: cat?.name,
    category_color: cat?.color,
    category_emoji: cat?.emoji,
  } as T & { course_name?: string; course_color?: string; category_name?: string; category_color?: string; category_emoji?: string };
}

// ---------- Mock API ----------
export function createBrowserApi() {
  const wrapList = <T extends { course_id?: number | null }>(rows: T[]) => rows.map(withCourseInfo);

  return {
    window: {
      minimize: async () => {},
      maximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
    },
    db: {
      courses: {
        list: async () => { await delay(); return [...courses]; },
        get: async (id: number) => { await delay(); return courses.find((c) => c.id === id) ?? null; },
        create: async (data: any) => { await delay(); const c: Course = { id: nextId(), created_at: Date.now(), color: data.color ?? '#00FF88', ...data }; courses = [...courses, c]; return c; },
        update: async (id: number, data: any) => { await delay(); courses = courses.map((c) => (c.id === id ? { ...c, ...data } : c)); return courses.find((c) => c.id === id); },
        delete: async (id: number) => { await delay(); courses = courses.filter((c) => c.id !== id); requirements = requirements.filter((r) => r.course_id !== id); events = events.filter((e: any) => e.course_id !== id); courseNotes = courseNotes.filter((n) => n.course_id !== id); miniPrograms = miniPrograms.filter((m) => m.course_id !== id); return { ok: true }; },
      },
      requirements: {
        list: async (filter?: any) => {
          await delay();
          let rows = wrapList(requirements);
          if (filter?.course_id) rows = rows.filter((r) => r.course_id === filter.course_id);
          if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
          return rows;
        },
        create: async (data: any) => { await delay(); const r: Requirement = { id: nextId(), created_at: Date.now(), priority: 2, status: 'pending', ...data }; requirements = [...requirements, r]; return withCourseInfo(r); },
        update: async (id: number, data: any) => { await delay(); requirements = requirements.map((r) => (r.id === id ? { ...r, ...data } : r)); return withCourseInfo(requirements.find((r) => r.id === id)!); },
        delete: async (id: number) => { await delay(); requirements = requirements.filter((r) => r.id !== id); return { ok: true }; },
      },
      events: {
        list: async (filter?: any) => {
          await delay();
          let rows = wrapList(events);
          if (filter?.from || filter?.to) {
            rows = rows.filter((e) => (!filter.from || e.start_at >= filter.from) && (!filter.to || e.start_at <= filter.to));
          }
          return rows;
        },
        create: async (data: any) => {
          await delay();
          const e: any = { id: nextId(), all_day: 0, type: 'event', ...data };
          if (e.all_day) e.all_day = 1;
          events = [...events, e];
          return withCourseInfo(e);
        },
        update: async (id: number, data: any) => {
          await delay();
          events = events.map((e) => (e.id === id ? { ...e, ...data, all_day: data.all_day ? 1 : 0 } : e));
          return withCourseInfo(events.find((e) => e.id === id)!);
        },
        delete: async (id: number) => { await delay(); events = events.filter((e) => e.id !== id); return { ok: true }; },
      },
      categories: {
        list: async () => { await delay(); return [...categories]; },
        create: async (data: any) => { await delay(); const c: Category = { id: nextId(), created_at: Date.now(), color: data.color ?? '#00FF88', ...data }; categories = [...categories, c]; return c; },
        update: async (id: number, data: any) => { await delay(); categories = categories.map((c) => (c.id === id ? { ...c, ...data } : c)); return categories.find((c) => c.id === id); },
        delete: async (id: number) => { await delay(); categories = categories.filter((c) => c.id !== id); return { ok: true }; },
      },
      projects: {
        list: async () => { await delay(); return [...projects]; },
        get: async (id: number) => { await delay(); return projects.find((p) => p.id === id) ?? null; },
        create: async (data: any) => { await delay(); const p: Project = { id: nextId(), created_at: Date.now(), status: 'active', progress: 0, ...data }; projects = [...projects, p]; return p; },
        update: async (id: number, data: any) => { await delay(); projects = projects.map((p) => (p.id === id ? { ...p, ...data } : p)); return projects.find((p) => p.id === id); },
        delete: async (id: number) => { await delay(); projects = projects.filter((p) => p.id !== id); tasks = tasks.filter((t) => t.project_id !== id); return { ok: true }; },
      },
      // v1.3.0 画布预览：内存存根（v1.3.0 一项目一画布）
      canvases: {
        list: async () => { await delay(); return [...canvases]; },
        get: async (id: number) => { await delay(); return canvases.find((c) => c.id === id) ?? null; },
        getByProject: async (projectId: number) => { await delay(); return canvases.find((c) => c.project_id === projectId) ?? null; },
        create: async (data: any) => { await delay(); const c = { id: nextId(), created_at: Date.now(), updated_at: Date.now(), name: '画布', description: null, viewport_x: 0, viewport_y: 0, viewport_zoom: 1, ...data }; canvases = [...canvases, c]; return c; },
        update: async (id: number, data: any) => { await delay(); canvases = canvases.map((c) => (c.id === id ? { ...c, ...data, updated_at: Date.now() } : c)); return canvases.find((c) => c.id === id) ?? null; },
        delete: async (id: number) => { await delay(); canvases = canvases.filter((c) => c.id !== id); canvasNodes = canvasNodes.filter((n) => n.canvas_id !== id); canvasEdges = canvasEdges.filter((e) => e.canvas_id !== id); return { ok: true }; },
      },
      canvasNodes: {
        listByCanvas: async (canvasId: number) => { await delay(); return canvasNodes.filter((n) => n.canvas_id === canvasId); },
        create: async (data: any) => { await delay(); const n = { id: nextId(), ...data }; canvasNodes = [...canvasNodes, n]; return n; },
        update: async (id: number, data: any) => { await delay(); canvasNodes = canvasNodes.map((n) => (n.id === id ? { ...n, ...data } : n)); return canvasNodes.find((n) => n.id === id) ?? null; },
        updatePositions: async (rows: any[]) => { await delay(); for (const r of rows || []) { canvasNodes = canvasNodes.map((n) => (n.id === r.id ? { ...n, pos_x: r.pos_x, pos_y: r.pos_y } : n)); } return { ok: true }; },
        delete: async (id: number) => { await delay(); canvasNodes = canvasNodes.filter((n) => n.id !== id); canvasEdges = canvasEdges.filter((e) => e.source_node_id !== id && e.target_node_id !== id); return { ok: true }; },
      },
      canvasEdges: {
        listByCanvas: async (canvasId: number) => { await delay(); return canvasEdges.filter((e) => e.canvas_id === canvasId); },
        create: async (data: any) => { await delay(); const e = { id: nextId(), ...data }; canvasEdges = [...canvasEdges, e]; return e; },
        update: async (id: number, data: any) => { await delay(); canvasEdges = canvasEdges.map((e) => (e.id === id ? { ...e, ...data } : e)); return canvasEdges.find((e) => e.id === id) ?? null; },
        delete: async (id: number) => { await delay(); canvasEdges = canvasEdges.filter((e) => e.id !== id); return { ok: true }; },
      },
      tasks: {
        list: async (filter?: any) => {
          await delay();
          let rows = tasks.map((t) => ({ ...t, project_name: projects.find((p) => p.id === t.project_id)?.name }));
          if (filter?.project_id) rows = rows.filter((t) => t.project_id === filter.project_id);
          return rows;
        },
        create: async (data: any) => { await delay(); const t: ProjectTask = { id: nextId(), order_index: 0, status: 'todo', ...data }; tasks = [...tasks, t]; return t; },
        update: async (id: number, data: any) => { await delay(); tasks = tasks.map((t) => (t.id === id ? { ...t, ...data } : t)); return tasks.find((t) => t.id === id); },
        delete: async (id: number) => { await delay(); tasks = tasks.filter((t) => t.id !== id); return { ok: true }; },
      },
      settings: {
        getAll: async () => { await delay(); return { ...settings }; },
        set: async (key: string, value: string) => { await delay(); settings = { ...settings, [key]: value }; return { ok: true }; },
      },
      userProfiles: {
        list: async () => { await delay(); return [...userProfiles]; },
        getActive: async () => { await delay(); return userProfiles.find((p) => p.is_active) ?? null; },
        getByOpenid: async (openid: string) => { await delay(); return userProfiles.find((p) => p.wx_openid === openid) ?? null; },
        create: async (data: any) => { await delay(); const p: UserProfile = { id: nextId(), created_at: Date.now(), updated_at: Date.now(), ...data }; userProfiles = [...userProfiles, p]; return p; },
        update: async (id: number, data: any) => { await delay(); userProfiles = userProfiles.map((p) => (p.id === id ? { ...p, ...data, updated_at: Date.now() } : p)); return userProfiles.find((p) => p.id === id) ?? null; },
        delete: async (id: number) => { await delay(); userProfiles = userProfiles.filter((p) => p.id !== id); return { ok: true }; },
        setActive: async (id: number) => { await delay(); userProfiles = userProfiles.map((p) => ({ ...p, is_active: p.id === id ? 1 : 0 })); return userProfiles.find((p) => p.id === id) ?? null; },
      },
      courseNotes: {
        list: async (courseId: number) => { await delay(); return courseNotes.filter((n) => n.course_id === courseId).sort((a, b) => b.created_at - a.created_at); },
        create: async (data: any) => { await delay(); const n: CourseNote = { id: nextId(), created_at: Date.now(), ...data }; courseNotes = [...courseNotes, n]; return n; },
        update: async (id: number, data: any) => { await delay(); courseNotes = courseNotes.map((n) => (n.id === id ? { ...n, ...data } : n)); return courseNotes.find((n) => n.id === id) ?? null; },
        delete: async (id: number) => { await delay(); courseNotes = courseNotes.filter((n) => n.id !== id); return { ok: true }; },
      },
      miniPrograms: {
        list: async () => { await delay(); return [...miniPrograms]; },
        getByCourse: async (courseId: number) => { await delay(); return miniPrograms.find((m) => m.course_id === courseId) ?? null; },
        getActive: async () => { await delay(); return miniPrograms.find((m) => m.active) ?? null; },
        createOrUpdate: async (data: any) => { await delay();
          const idx = miniPrograms.findIndex((m) => m.course_id === data.course_id);
          if (idx >= 0) {
            const updated = { ...miniPrograms[idx], ...data, updated_at: Date.now() };
            miniPrograms = [...miniPrograms.slice(0, idx), updated, ...miniPrograms.slice(idx + 1)];
            return updated;
          }
          const m: CourseMiniProgram = { id: nextId(), created_at: Date.now(), updated_at: Date.now(), active: 0, ...data };
          miniPrograms = [...miniPrograms, m];
          return m;
        },
        setActive: async (id: number) => { await delay(); miniPrograms = miniPrograms.map((m) => ({ ...m, active: m.id === id ? 1 : 0 })); return miniPrograms.find((m) => m.id === id) ?? null; },
        delete: async (id: number) => { await delay(); miniPrograms = miniPrograms.filter((m) => m.id !== id); return { ok: true }; },
      },
      stats: {
        dashboard: async () => { await delay(); return computeStats(); },
      },
    },
    // 微信小程序（浏览器模式占位）
    miniprogram: {
      open: async (appId: string) => ({ ok: false, reason: 'browser-preview', appId }),
      isReady: async () => false,
      config: {
        get: async () => ({ enabled: false, apps: [] }),
        set: async (cfg: any) => ({ ok: false, reason: 'browser-preview', cfg }),
      },
    },
    // 贝壳课表（浏览器预览：模拟 USTB 扫码登录 + BYYT 课表导入流程）
    ustb: {
      status: async () => {
        await delay();
        return {
          loggedIn: ustbMock.loggedIn,
          user: ustbMock.user,
          term: ustbMock.term,
          lastSync: ustbMock.lastSync,
          importedCount: ustbMock.importedCourseIds.length,
        };
      },
      qrStart: async () => {
        await delay(400);
        ustbMock.pollCount = 0;
        return { sessionId: 'mock-session', qrImage: fakeQrSvg() };
      },
      qrPoll: async () => {
        await delay(120);
        ustbMock.pollCount++;
        if (ustbMock.pollCount >= 5) {
          ustbMock.loggedIn = true;
          ustbMock.user = { name: '豆芽（演示）', school: '北京科技大学', userId: '4230xxxx' };
          return { status: 'success', user: ustbMock.user };
        }
        if (ustbMock.pollCount >= 2) return { status: 'scanned' };
        return { status: 'waiting' };
      },
      qrCancel: async () => ({ ok: true }),
      preview: async () => {
        if (!ustbMock.loggedIn) throw new Error('尚未登录，请先扫码');
        await delay(300);
        return { user: ustbMock.user, items: USTB_DEMO_ITEMS, periods: [], count: USTB_DEMO_ITEMS.length };
      },
      import: async (opts: any) => {
        if (!ustbMock.loggedIn) throw new Error('尚未登录，请先扫码');
        await delay(500);
        // 清除上一次导入
        for (const id of ustbMock.importedCourseIds) {
          courses = courses.filter((c) => c.id !== id);
          events = events.filter((e: any) => e.course_id !== id);
        }
        const created: number[] = [];
        let eventCount = 0;
        // 第 1 周周一规整
        const dt = new Date(opts.semesterStart);
        dt.setHours(0, 0, 0, 0);
        dt.setDate(dt.getDate() + (dt.getDay() === 0 ? -6 : 1 - dt.getDay()));
        const monday0 = dt.getTime();
        const periods: Record<number, [string, string]> = {
          1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['14:00', '15:35'],
          4: ['15:50', '17:25'], 5: ['18:30', '20:05'], 6: ['20:10', '21:45'],
        };
        const palette = ['#00FF88', '#00D4FF', '#FFD166', '#FF6B9D', '#A78BFA', '#4ADE80', '#F97316', '#22D3EE', '#F472B6', '#FACC15'];
        const groups = new Map<string, typeof USTB_DEMO_ITEMS>();
        for (const it of USTB_DEMO_ITEMS) {
          const a = groups.get(it.className);
          if (a) a.push(it);
          else groups.set(it.className, [it]);
        }
        let pi = 0;
        groups.forEach((its, name) => {
          const color = palette[pi++ % palette.length];
          const teachers = [...new Set(its.map((i) => i.teacher).filter(Boolean))].join('、');
          const c: Course = {
            id: nextId(), name, code: null, instructor: teachers || null,
            semester: `${opts.xn}-${opts.xq}`, color,
            description: `贝壳课表导入（浏览器演示）`, tags: '["贝壳课表"]', created_at: Date.now(),
          };
          courses = [...courses, c];
          created.push(c.id);
          for (const it of its) {
            const [sh, sm] = (periods[it.period] ?? periods[1])[0].split(':').map(Number);
            const [eh, em] = (periods[it.period] ?? periods[1])[1].split(':').map(Number);
            const weeks = it.weeks.length ? it.weeks : Array.from({ length: 16 }, (_, i) => i + 1);
            for (const w of weeks) {
              const base = new Date(monday0 + (w - 1) * 7 * 86400000 + (it.day - 1) * 86400000);
              const start_at = base.setHours(sh, sm, 0, 0);
              const end_at = base.setHours(eh, em, 0, 0);
              events = [...events, {
                id: nextId(), title: name, start_at, end_at, location: it.location,
                recurrence: null, recurrence_end: null, course_id: c.id, color: c.color,
                notes: `${it.periodName} · ${it.weeksText}`, all_day: 0, reminder_minutes: null,
                category_id: null, type: 'class',
              }];
              eventCount++;
            }
          }
        });
        ustbMock.importedCourseIds = created;
        ustbMock.lastSync = Date.now();
        ustbMock.term = { xn: opts.xn, xq: String(opts.xq) };
        return { courses: groups.size, events: eventCount, items: USTB_DEMO_ITEMS.length, courseIds: created, warnings: [] };
      },
      logout: async () => {
        ustbMock.loggedIn = false;
        ustbMock.user = null;
        return { ok: true };
      },
    },
    // ICS 导出（浏览器模式：触发本地下载）
    ics: {
      export: async (events: any[]) => {
        const pad = (n: number) => n.toString().padStart(2, '0');
        const fmt = (ts: number, allDay: boolean) => {
          const d = new Date(ts);
          if (allDay) return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
          return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
        };
        const esc = (s: string) => s.replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
        const lines = [
          'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TaskManager//CN//', 'CALSCALE:GREGORIAN',
          'METHOD:PUBLISH', 'X-WR-CALNAME:TaskManager 日历',
        ];
        const now = fmt(Date.now(), false);
        for (const e of events) {
          const allDay = !!e.all_day;
          lines.push('BEGIN:VEVENT', `UID:${e.id}@taskmanager`, `DTSTAMP:${now}`, `DTSTART:${fmt(e.start_at, allDay)}`);
          if (e.end_at) lines.push(`DTEND:${fmt(e.end_at, allDay)}`);
          lines.push(`SUMMARY:${esc(e.title || '')}`);
          if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
          if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
          const r = e.recurrence;
          if (r === 'WEEKLY') lines.push('RRULE:FREQ=WEEKLY');
          else if (r === 'DAILY') lines.push('RRULE:FREQ=DAILY');
          else if (r === 'MONTHLY') lines.push('RRULE:FREQ=MONTHLY');
          else if (r === 'YEARLY') lines.push('RRULE:FREQ=YEARLY');
          if (e.recurrence_end) lines.push(`UNTIL=${fmt(e.recurrence_end, false)}`);
          lines.push('END:VEVENT');
        }
        lines.push('END:VCALENDAR');
        const content = lines.join('\r\n');
        const blob = new Blob([content], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `TaskManager-日历-${new Date().toISOString().slice(0, 10)}.ics`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { ok: true, path: a.download, count: events.length };
      },
    },

    // 全量备份 / 恢复（浏览器模式：JSON 下载 + <input type=file> 读取）
    backup: {
      export: async () => {
        const tables: Record<string, any[]> = {
          courses: [...courses],
          categories: [...categories],
          course_requirements: [...requirements],
          course_notes: [...courseNotes],
          course_miniprograms: [...miniPrograms],
          events: [...events],
          projects: [...projects],
          project_tasks: [...tasks],
          user_profiles: [...userProfiles],
          settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
        };
        const checksum = await mockSha256(JSON.stringify(tables));
        const payload = {
          format: 'taskmanager-backup', version: 1, appVersion: '0.2.0-browser-mock',
          exportedAt: Date.now(), tables,
          counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
          checksum,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taskmanager-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { ok: true, path: a.download, counts: payload.counts };
      },
      import: async (_opts?: { skipSafetyBackup?: boolean }) => {
        // 用隐藏 file input 选择备份文件
        const file = await pickBackupFile();
        if (!file) return { ok: false, canceled: true };
        const text = await file.text();
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { return { ok: false, error: '文件不是有效的 JSON' }; }
        if (parsed?.format !== 'taskmanager-backup') return { ok: false, error: '文件格式不匹配（不是 TaskManager 备份）' };
        if (typeof parsed?.checksum !== 'string') return { ok: false, error: '备份缺少校验和' };
        const actual = await mockSha256(JSON.stringify(parsed.tables));
        if (actual !== parsed.checksum) return { ok: false, error: '校验和不匹配：文件被篡改或损坏' };

        const t = parsed.tables;
        courses = (t.courses ?? []) as any;
        categories = (t.categories ?? []) as any;
        requirements = (t.course_requirements ?? []) as any;
        courseNotes = (t.course_notes ?? []) as any;
        miniPrograms = (t.course_miniprograms ?? []) as any;
        events = (t.events ?? []) as any;
        projects = (t.projects ?? []) as any;
        tasks = (t.project_tasks ?? []) as any;
        userProfiles = (t.user_profiles ?? []) as any;
        settings = Object.fromEntries((t.settings ?? []).map((r: any) => [r.key, r.value]));

        const restored: Record<string, number> = {};
        for (const [k, v] of Object.entries(t)) restored[k] = Array.isArray(v) ? v.length : 0;
        return { ok: true, restored, safetyBackupPath: '(浏览器模式不落地)', source: file.name };
      },
      status: async () => {
        return {
          integrity: 'ok',
          foreignKeyViolations: 0,
          journalMode: 'wal',
          tables: {
            courses: courses.length,
            categories: categories.length,
            course_requirements: requirements.length,
            course_notes: courseNotes.length,
            course_miniprograms: miniPrograms.length,
            events: events.length,
            projects: projects.length,
            project_tasks: tasks.length,
            user_profiles: userProfiles.length,
            settings: Object.keys(settings).length,
          },
          dbSizeBytes: JSON.stringify({ courses, events, projects, tasks, requirements }).length,
          lastAutoBackup: null,
        };
      },
      makeSafety: async () => ({ ok: true, path: '(浏览器模式不落地)' }),
    },

    // 应用信息（浏览器预览）
    app: {
      info: async () => ({
        name: 'TaskManager',
        version: MOCK_APP_VERSION,
        electron: 'browser-preview',
        platform: 'web',
        packaged: false,
      }),
    },

    // 软件更新（浏览器预览：模拟检查结果，不做真实下载）
    updater: {
      config: async () => {
        const sources = Array.isArray(settings.update_sources) ? settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const activeIndex = finalSources.findIndex((s: any) => s.primary);
        return {
          defaultSources: finalSources,
          sources: finalSources,
          activeIndex: activeIndex >= 0 ? activeIndex : 0,
          source: finalSources[activeIndex >= 0 ? activeIndex : 0]?.url || '',
          defaultSource: MOCK_DEFAULT_SOURCE,
          autoCheck: settings.update_auto_check !== '0',
          skippedVersion: settings.update_skipped_version || null,
          lastCheckAt: Number(settings.update_last_check) || 0,
        };
      },
      check: async (opts: any) => {
        await delay();
        const sources = Array.isArray(settings.update_sources) ? settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const activeIndex = finalSources.findIndex((s: any) => s.primary);
        const idx = opts?.sourceIndex ?? (activeIndex >= 0 ? activeIndex : 0);
        const source = (finalSources[idx]?.url || '').trim();
        if (!source) {
          return {
            ok: false, reason: 'not_configured', configured: false,
            currentVersion: MOCK_APP_VERSION,
            message: '尚未配置更新源地址。填写后即可检查更新（可填版本清单 JSON 直链或网盘分享页）。',
          };
        }
        return {
          ok: true, configured: true,
          currentVersion: MOCK_APP_VERSION,
          latestVersion: '0.3.1',
          hasUpdate: true,
          notes: '· 新增课表日历视图\n· 修复课程无法添加作业\n· 优化编辑框输入体验',
          downloadUrl: `${source.replace(/\/[^/]*$/, '')}/TaskManager Setup 0.3.1.exe`,
          pageUrl: source,
          sha256: null,
          source,
          sourceIndex: idx,
          sourceName: finalSources[idx]?.name,
          checkedAt: Date.now(),
          skipped: false,
          forced: false,
        };
      },
      checkAll: async () => {
        await delay();
        const sources = Array.isArray(settings.update_sources) ? settings.update_sources : [];
        const finalSources = sources.length ? sources : MOCK_DEFAULT_SOURCES.map((s) => ({ ...s }));
        const perSource = finalSources.map((s: any, i: number) => ({
          source: s,
          result: {
            ok: true, configured: true,
            currentVersion: MOCK_APP_VERSION,
            latestVersion: '0.3.1',
            hasUpdate: true,
            notes: '· 新增课表日历视图',
            downloadUrl: `${(s.url || '').replace(/\/[^/]*$/, '')}/TaskManager Setup 0.3.1.exe`,
            pageUrl: s.url,
            sourceIndex: i,
            sourceName: s.name,
            source: s.url,
            checkedAt: Date.now(),
            skipped: false,
            forced: false,
          },
        }));
        return { currentVersion: MOCK_APP_VERSION, ok: true, anyConfigured: true, winner: perSource[0].result, perSource, checkedAt: Date.now() };
      },
      download: async () => ({ ok: false, error: '(浏览器预览模式不支持下载安装包，请在桌面应用中使用)' }),
      cancel: async () => ({ ok: true }),
      install: async () => ({ ok: false, error: '(浏览器预览模式不支持安装，请在桌面应用中使用)' }),
      // v1.3.0 补丁式更新预览存根：浏览器下都返回"不可用"，避免误触发
      patchPreview: async () => ({ available: false, reason: 'browser_mock' }),
      patchDownload: async () => ({ ok: false, error: '(浏览器预览模式不支持下载补丁)' }),
      patchCacheState: async () => ({ exists: false, info: null, zipOk: false }),
      patchApplyCached: async () => ({ ok: false, error: '(浏览器预览模式不支持应用补丁)' }),
      patchClearCache: async () => ({ ok: true }),
      openExternal: async (url: string) => { window.open(url, '_blank', 'noopener'); return { ok: true }; },
      skipVersion: async (v: string) => { settings.update_skipped_version = v; return { ok: true }; },
      setSource: async (s: string) => {
        settings.update_source = s;
        settings.update_sources = [{ name: '自定义源', url: s, enabled: true, primary: true }];
        return { ok: true, source: s, sources: settings.update_sources as any };
      },
      setSources: async (payload: any) => {
        settings.update_sources = (payload?.sources || []).map((s: any) => ({ ...s }));
        settings.update_active_index = String(payload?.activeIndex ?? 0);
        return { ok: true, sources: settings.update_sources as any, activeIndex: payload?.activeIndex ?? 0 };
      },
      setActiveSource: async (index: number) => {
        const arr: any[] = Array.isArray(settings.update_sources) ? settings.update_sources : [];
        const safe = Math.max(0, Math.min(index, arr.length - 1));
        settings.update_sources = arr.map((s, i) => ({ ...s, primary: i === safe }));
        settings.update_active_index = String(safe);
        return { ok: true, activeIndex: safe, sources: settings.update_sources as any };
      },
      setAutoCheck: async (enabled: boolean) => { settings.update_auto_check = enabled ? '1' : '0'; return { ok: true, enabled }; },
      onProgress: () => () => { /* noop */ },
      onAvailable: () => () => { /* noop */ },
    },

    /** v1.1.9：自动清理 & 回收站（浏览器预览 mock） */
    cleanup: {
      rules: async () => ({ enabled: true, reqDays: 1, taskDays: 1, eventDays: 7, projectDays: 7, homeworkDays: 7, binDays: 30 }),
      setRules: async (patch: any) => ({ enabled: true, reqDays: 1, taskDays: 1, eventDays: 7, projectDays: 7, homeworkDays: 7, binDays: 30, ...patch }),
      run: async () => ({
        local: { ranAt: Date.now(), enabled: true, binned: { requirements: 0, tasks: 0, events: 0, projects: 0 }, purgedBin: 0 },
        cloud: { ranAt: Date.now(), codes: [], github: { checked: 0, rewritten: 0, deleted: 0, removedEntries: 0, errors: [] }, cloud: { checked: 0, rewritten: 0, removedEntries: 0, errors: [] } },
      }),
      bin: async () => [] as any[],
      restore: async () => ({ ok: false, error: '(浏览器预览模式不支持恢复，请在桌面应用中使用)' }),
      purge: async () => ({ purged: 0 }),
    },
  };
}

/** 浏览器端 SHA-256（不可用时退化为提示错误的哈希，校验会失败并提示） */
async function mockSha256(data: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unavailable';
  }
}

/** 弹出文件选择框读取备份 JSON */
function pickBackupFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 用户取消时 change 不触发，用 window focus 兜底检查
    window.addEventListener('focus', () => setTimeout(() => {
      if (!input.files?.length) resolve(null);
    }, 500), { once: true });
    input.click();
  });
}
