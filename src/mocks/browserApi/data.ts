/**
 * v1.2.8 块 L：mocks/browserApi 拆分 — 共享数据 + 工具
 *
 * 设计原则：
 * - MockData 是一个可变容器，所有 domain creator 接收同一个引用，跨域修改无需 import side-effect
 * - nextId / delay / withCourseInfo / computeStats 集中在此，避免散落到多个文件
 * - Type-only imports 提到顶部（防止循环依赖）
 */
import type {
  Course, Requirement, Category, CourseNote,
  UserProfile, Project, ProjectTask, Canvas, CanvasNode, CanvasEdge,
  Grade, Exam, PomodoroSession, Habit, Attendance,
} from '@/types';

/** v1.2.8 块 L：HabitCheckin 还没在 @/types 暴露，用 inline 定义（与后端 DDL 对齐） */
export interface HabitCheckin {
  habit_id: number;
  date: string; // YYYY-MM-DD
  created_at: number;
}

export interface USTBMock {
  loggedIn: boolean;
  user: { name: string; school: string; userId: string } | null;
  term: { xn: string; xq: string } | null;
  lastSync: number | null;
  pollCount: number;
  importedCourseIds: number[];
}

export interface MockData {
  courses: Course[];
  requirements: Requirement[];
  events: any[];
  categories: Category[];
  projects: Project[];
  tasks: ProjectTask[];
  canvases: Canvas[];
  canvasNodes: CanvasNode[];
  canvasEdges: CanvasEdge[];
  settings: Record<string, any>;
  userProfiles: UserProfile[];
  courseNotes: CourseNote[];

  grades: Grade[];
  exams: Exam[];
  pomodoros: PomodoroSession[];
  habits: Habit[];
  habitCheckins: HabitCheckin[];
  attendances: Attendance[];
  ustb: USTBMock;
  /** 浏览器模式激活码容器（v1.2.6 月卡） */
  billedCodes: Map<string, { openedAt: number; expiresAt: number }>;
}

let idCounter = 1000;
export function nextId(): number {
  idCounter += 1;
  return idCounter;
}

/** 模拟 IPC 延迟（浏览器预览），让 loading 态可见 */
export function delay(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 把 requirement/event/project_task 等带 course_id 的行关联上课程名/颜色 */
export function withCourseInfo<T extends { course_id?: number | null }>(row: T, data: MockData): T & {
  course_name: string | null;
  course_color: string | null;
} {
  const c = row.course_id ? data.courses.find((x) => x.id === row.course_id) : null;
  return {
    ...row,
    course_name: c?.name ?? null,
    course_color: c?.color ?? null,
  } as any;
}

/** 仪表板聚合统计 */
export function computeStats(data: MockData) {
  const today = new Date().toDateString();
  return {
    courses: data.courses.length,
    requirements: {
      total: data.requirements.length,
      done: data.requirements.filter((r) => r.status === 'done').length,
      overdue: data.requirements.filter((r) => r.status !== 'done' && (r as any).due_at && (r as any).due_at < Date.now()).length,
    },
    eventsToday: data.events.filter((e: any) => new Date(e.start_at).toDateString() === today).length,
    projects: data.projects.length,
    pomodoroMinutes: data.pomodoros.reduce((s, p) => s + (p.minutes || 0), 0),
  };
}

/** 创建一份空 mock data 容器（每次 createBrowserApi 调用都生成新实例，互不污染） */
export function createMockData(): MockData {
  return {
    courses: [],
    requirements: [],
    events: [],
    categories: [],
    projects: [],
    tasks: [],
    canvases: [],
    canvasNodes: [],
    canvasEdges: [],
    settings: {},
    userProfiles: [],
    courseNotes: [],

    grades: [],
    exams: [],
    pomodoros: [],
    habits: [],
    habitCheckins: [],
    attendances: [],
    ustb: {
      loggedIn: false,
      user: null,
      term: null,
      lastSync: null,
      pollCount: 0,
      importedCourseIds: [],
    },
    billedCodes: new Map(),
  };
}