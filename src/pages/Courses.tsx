/**
 * v1.2.8 块 K：Courses 模块向后兼容壳
 * 原 src/pages/Courses.tsx 已重构为 src/pages/Courses/ 模块（13 个文件）
 * 这里是 re-export 壳，保持旧 `import CoursesPage from './Courses'` 的代码无须迁移
 */
export { default } from './Courses/CoursesPage';
export * from './Courses/index';
export { Field } from './Courses/Field';