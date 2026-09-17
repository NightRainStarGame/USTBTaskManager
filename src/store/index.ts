import { create } from 'zustand';
import type { Course, Requirement, CalendarEvent, Category, Project, ProjectTask, DashboardStats, UserProfile, CourseMiniProgram, AppInfo, UpdateCheckResult } from '@/types';

interface AppState {
  // 数据
  courses: Course[];
  requirements: Requirement[];
  events: CalendarEvent[];
  categories: Category[];
  projects: Project[];
  tasks: ProjectTask[];
  stats: DashboardStats | null;
  settings: Record<string, string>;
  userProfile: UserProfile | null;
  activeMiniProgram: CourseMiniProgram | null;

  // 应用信息 / 更新
  appInfo: AppInfo | null;
  updateInfo: UpdateCheckResult | null;

  // 加载与刷新
  loading: boolean;
  refreshAll: () => Promise<void>;

  // Setters
  setCourses: (d: Course[]) => void;
  setRequirements: (d: Requirement[]) => void;
  setEvents: (d: CalendarEvent[]) => void;
  setCategories: (d: Category[]) => void;
  setProjects: (d: Project[]) => void;
  setTasks: (d: ProjectTask[]) => void;
  setStats: (d: DashboardStats) => void;
  setSettings: (d: Record<string, string>) => void;
  setUserProfile: (d: UserProfile | null) => void;
  setActiveMiniProgram: (d: CourseMiniProgram | null) => void;
  setAppInfo: (d: AppInfo | null) => void;
  setUpdateInfo: (d: UpdateCheckResult | null) => void;
}

export const useStore = create<AppState>((set) => ({
  courses: [],
  requirements: [],
  events: [],
  categories: [],
  projects: [],
  tasks: [],
  stats: null,
  settings: {},
  userProfile: null,
  activeMiniProgram: null,
  appInfo: null,
  updateInfo: null,
  loading: false,

  refreshAll: async () => {
    set({ loading: true });
    try {
      const [courses, requirements, projects, tasks, settings, stats, categories, userProfile, activeMiniProgram] = await Promise.all([
        window.taskAPI.db.courses.list(),
        window.taskAPI.db.requirements.list({}),
        window.taskAPI.db.projects.list(),
        window.taskAPI.db.tasks.list({}),
        window.taskAPI.db.settings.getAll(),
        window.taskAPI.db.stats.dashboard(),
        window.taskAPI.db.categories.list(),
        window.taskAPI.db.userProfiles.getActive().catch(() => null),
        window.taskAPI.db.miniPrograms.getActive().catch(() => null),
      ]);
      // events 拉全量（一年的窗口），供课程/项目用
      const events = await window.taskAPI.db.events.list({});
      set({ courses, requirements, projects, tasks, events, categories, settings, stats, userProfile, activeMiniProgram });
    } finally {
      set({ loading: false });
    }
  },

  setCourses: (d) => set({ courses: d }),
  setRequirements: (d) => set({ requirements: d }),
  setEvents: (d) => set({ events: d }),
  setCategories: (d) => set({ categories: d }),
  setProjects: (d) => set({ projects: d }),
  setTasks: (d) => set({ tasks: d }),
  setStats: (d) => set({ stats: d }),
  setSettings: (d) => set({ settings: d }),
  setUserProfile: (d) => set({ userProfile: d }),
  setActiveMiniProgram: (d) => set({ activeMiniProgram: d }),
  setAppInfo: (d) => set({ appInfo: d }),
  setUpdateInfo: (d) => set({ updateInfo: d }),
}));