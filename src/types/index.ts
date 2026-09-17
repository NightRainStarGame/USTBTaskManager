// 复用数据库返回的类型
export interface Course {
  id: number;
  name: string;
  code?: string | null;
  instructor?: string | null;
  semester?: string | null;
  color: string;
  description?: string | null;
  tags?: string;
  created_at: number;
}

export interface CourseNote {
  id: number;
  course_id: number;
  content: string;
  created_at: number;
}

export interface UserProfile {
  id: number;
  username?: string | null;
  password_hash?: string | null;
  wx_openid?: string | null;
  wx_nickname?: string | null;
  wx_avatar?: string | null;
  student_id?: string | null;
  real_name?: string | null;
  school?: string | null;
  college?: string | null;
  major?: string | null;
  class_name?: string | null;
  enroll_year?: number | null;
  graduate_year?: number | null;
  program?: string | null;
  degree_level?: string | null;
  custom_fields?: string;
  encrypted_fields?: string | null;
  privacy_mode?: number;
  is_active?: number;
  created_at: number;
  updated_at: number;
}

export interface CourseMiniProgram {
  id: number;
  course_id: number;
  app_type: string;
  config_json: string;
  active?: number;
  created_at: number;
  updated_at: number;
}

export interface Requirement {
  id: number;
  course_id: number;
  title: string;
  type: 'homework' | 'exam' | 'project' | 'reading' | 'other';
  description?: string | null;
  due_date: number;
  priority: 1 | 2 | 3;
  status: 'pending' | 'in_progress' | 'done' | 'overdue';
  estimated_hours?: number | null;
  actual_hours?: number | null;
  notes?: string | null;
  created_at: number;
  course_name?: string;
  course_color?: string;
  /** 'local' 本地手建 | 'github' 从 GitHub 同步 */
  source?: 'local' | 'github' | null;
  /** GitHub 同步条目的稳定 ID（去重键） */
  remote_id?: string | null;
  /** 对应的上课日期 YYYY-MM-DD（每节课作业可能不同） */
  session_date?: string | null;
  /** 发布人（同步作业携带） */
  publisher?: string | null;
}

export interface CalendarEvent {
  id: number;
  title: string;
  start_at: number;
  end_at?: number | null;
  location?: string | null;
  recurrence?: string | null;
  recurrence_end?: number | null;
  course_id?: number | null;
  color?: string | null;
  notes?: string | null;
  all_day?: number;
  reminder_minutes?: number | null;
  category_id?: number | null;
  type?: 'event' | 'countdown' | 'birthday' | 'class';
  course_name?: string;
  course_color?: string;
  category_name?: string;
  category_color?: string;
  category_emoji?: string | null;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  emoji?: string | null;
  created_at: number;
}

export interface Project {
  id: number;
  name: string;
  description?: string | null;
  status: 'active' | 'completed' | 'archived';
  start_date?: number | null;
  due_date?: number | null;
  progress: number;
  created_at: number;
}

export interface ProjectTask {
  id: number;
  project_id: number;
  course_id?: number | null;
  title: string;
  status: 'todo' | 'doing' | 'blocked' | 'done';
  assignee?: string | null;
  due_date?: number | null;
  order_index: number;
  project_name?: string;
}

export interface DashboardStats {
  totalReq: number;
  pendingReq: number;
  overdueReq: number;
  dueTodayReq: number;
  dueWeekReq: number;
  totalCourses: number;
  activeProjects: number;
  todayEvents: number;
}
// ===== 软件更新 =====
export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  platform: string;
  packaged: boolean;
}

export interface UpdateConfig {
  defaultSource: string;
  source: string;
  autoCheck: boolean;
  skippedVersion: string | null;
}

export interface UpdateCheckResult {
  ok: boolean;
  /** not_configured | network | parse | unknown */
  reason?: string;
  message?: string;
  configured: boolean;
  currentVersion: string;
  latestVersion?: string | null;
  hasUpdate?: boolean;
  notes?: string | null;
  downloadUrl?: string | null;
  pageUrl?: string | null;
  sha256?: string | null;
  forced?: boolean;
  skipped?: boolean;
  source?: string;
  checkedAt?: number;
}

export interface UpdateProgress {
  phase: 'start' | 'progress' | 'done';
  received?: number;
  total?: number;
  percent?: number;
  fileName?: string;
  path?: string;
  sha256?: string;
}
