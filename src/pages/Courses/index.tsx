/**
 * v1.2.8 块 K：Courses 模块入口
 *  - 默认导出 CoursesPage（保持旧 import { default as CoursesPage } 兼容）
 *  - 同步导出子组件，便于复用（如 PatchPanel 引用 NotesTab）
 */
export { default } from './CoursesPage';
export { default as CoursesPage } from './CoursesPage';
export { TimetableView } from './TimetableView';
export { CourseDrawer } from './CourseDrawer';
export { CourseHomeworkOverview } from './CourseHomeworkOverview';
export { ReqRow } from './ReqRow';
export { ReqInlineEditor } from './ReqInlineEditor';
export { ScheduleSlotModal } from './ScheduleSlotModal';
export { Field } from './Field';
export { InfoTab } from './tabs/InfoTab';
export { ScheduleTab } from './tabs/ScheduleTab';
export { ReqsTab } from './tabs/ReqsTab';
export { NotesTab } from './tabs/NotesTab';

export * from './constants';