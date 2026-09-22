/**
 * v1.2.8 块 P：向后兼容壳
 * 原 src/components/Pomodoro.tsx 已重构为 src/features/pomodoro/ 模块
 * 这里是 re-export 壳，保持旧 `import PomodoroWidget from './Pomodoro'` 的代码无须迁移
 */
export { default } from '../features/pomodoro/PomodoroWidget';
export { default as PomodoroWidget } from '../features/pomodoro/PomodoroWidget';