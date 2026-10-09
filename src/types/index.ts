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

// v1.2.10：CourseMiniProgram 随小程序模块一并移除

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
  /**
   * 'local' 本地手建 | 'github' **作业同步接收来的条目**。
   *
   * 注意字面值是历史遗留：作业以前确实托管在 GitHub 仓库里，v1.2.15 起只存在 SSIO，
   * 但用户库里已有的行都写着这个值，重命名等于一次数据迁移。
   * 所以语义请读作「非本地」，不要拿它判断 GitHub —— 真正的常量见
   * electron/homework 的 SYNCED_SOURCE_TAG。UI 文案一律说「作业同步」。
   */
  source?: 'local' | 'github' | null;
  /** 同步条目的稳定 ID（去重键） */
  remote_id?: string | null;
  /** 对应的上课日期 YYYY-MM-DD（每节课作业可能不同） */
  session_date?: string | null;
  /** 发布人（同步作业携带） */
  publisher?: string | null;
  /** v1.2.3：周期任务（null=一次性 | daily/weekly/biweekly，完成时自动生成下一轮） */
  recurrence?: 'daily' | 'weekly' | 'biweekly' | null;
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
  /** v1.3.0：优先级 0=低 1=中 2=高 3=紧急 */
  priority?: number;
  /** v1.3.0：任务描述/备注 */
  description?: string | null;
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

// v1.2.17：课表导入的类型统一到 api-factory（preload / 移动端 shim / 渲染层三方的交汇点），
// 与 UpdateSourceDTO 同一个道理 —— 以前这里是逐字重复的一份，加字段必漏。
import type { XlsFieldMappingDTO, XlsItemDTO, XlsParseResultDTO, XlsProfileDTO } from '../../electron/api-factory';

// ===== 课表 XLS 导入 =====
// v1.2.17：这几个类型以前在 src/types 与 electron/api-factory 各写一份（逐字重复）。
// 现在统一以 api-factory 的 DTO 为准 —— 它是 preload / 移动端 shim / 渲染层三方的交汇点，
// 与 UpdateSourceDTO 同一个道理。改字段不会再漏掉某一方。
export type XlsFieldMapping = XlsFieldMappingDTO;
export type XlsPreviewItem = XlsItemDTO;
export type XlsParseResult = XlsParseResultDTO;
export type XlsProfile = XlsProfileDTO;

export interface XlsImportSummary {
  courses: number;
  events: number;
  items: number;
  courseIds: number[];
  warnings: string[];
}

// ===== v1.2.1 画布编辑器（达芬奇式节点连线） =====
export type CanvasNodeType = 'task' | 'course' | 'homework' | 'event' | 'note' | 'group' | 'custom';
export type CanvasEdgeType = 'sequence' | 'dependency' | 'relation' | 'critical';

export interface Canvas {
  id: number;
  name: string;
  description?: string | null;
  /** v1.3.0：画布归属项目（一项目一画布） */
  project_id?: number | null;
  /** 视口 X（pan） */
  viewport_x: number;
  /** 视口 Y（pan） */
  viewport_y: number;
  /** 视口缩放 */
  viewport_zoom: number;
  created_at: number;
  updated_at: number;
}

export interface CanvasNode {
  id: number;
  canvas_id: number;
  node_type: CanvasNodeType;
  /** 关联业务实体 id（如 course_id / requirement_id；custom 节点为 null） */
  entity_id?: number | null;
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  title: string;
  /** JSON 字符串：节点额外数据（icon/color/tags/fields 等） */
  data_json: string;
  created_at: number;
  updated_at: number;
}

export interface CanvasEdge {
  id: number;
  canvas_id: number;
  source_node_id: number;
  target_node_id: number;
  edge_type: CanvasEdgeType;
  label?: string | null;
  /** JSON 字符串：sourceHandle/targetHandle 等端点数据 */
  data_json: string;
  created_at: number;
}

// ===== v1.2.3 学业 / 专注 / 习惯 / 出勤 / 小组清单 =====

/** 成绩（一门课可有多条组成部分 + 一条总评） */
export interface Grade {
  id: number;
  course_id: number;
  semester?: string | null;
  /** total=总评 | regular=平时 | midterm=期中 | final=期末 | other */
  component: 'total' | 'regular' | 'midterm' | 'final' | 'other';
  score: number | null;
  credit: number;
  full_score: number;
  notes?: string | null;
  created_at: number;
  updated_at: number;
  course_name?: string;
  course_color?: string;
}

/** 考试 */
export interface Exam {
  id: number;
  course_id: number | null;
  title: string;
  exam_date: number;
  location?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  /** upcoming | done | cancelled */
  status: string;
  created_at: number;
  course_name?: string;
  course_color?: string;
}

/** 番茄钟专注记录 */
export interface PomodoroSession {
  id: number;
  course_id: number | null;
  /** requirement | task | exam | habit | null */
  ref_type?: string | null;
  ref_id?: number | null;
  label?: string | null;
  started_at: number;
  ended_at?: number | null;
  minutes: number;
  /** work | break */
  mode: string;
  created_at: number;
  course_name?: string;
  course_color?: string;
}

/** 习惯（checkinDates 由 list 接口附带） */
export interface Habit {
  id: number;
  name: string;
  emoji: string;
  color: string;
  /** 'daily' | 'weekly' */
  frequency: string;
  target_per_week: number | null;
  archived: number;
  sort_order: number;
  created_at: number;
  checkinDates: string[];
}

/** 出勤记录 */
export interface Attendance {
  id: number;
  course_id: number;
  /** YYYY-MM-DD */
  date: string;
  status: 'present' | 'late' | 'absent' | 'leave';
  note?: string | null;
  created_at: number;
  course_name?: string;
  course_color?: string;
}

/** 小组共享清单（本地镜像） */
export interface GroupList {
  id: number;
  group_code: string;
  name: string;
  owner_name?: string | null;
  last_synced_at?: number | null;
  created_at: number;
}

/** 小组清单条目 */
export interface GroupListItem {
  id: number;
  list_id: number;
  remote_key?: string | null;
  title: string;
  assignee?: string | null;
  /** todo | doing | done */
  status: 'todo' | 'doing' | 'done';
  due_date?: number | null;
  sort_order: number;
  updated_at: number;
}
