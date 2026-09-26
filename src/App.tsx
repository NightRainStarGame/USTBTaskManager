import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, lazy, Suspense } from 'react';
import Layout from './components/Layout';
// 首页（Dashboard）保持静态：它是冷启动首屏，不能被 Suspense 挂起来
import Dashboard from './pages/Dashboard';
import UpdateNotification from './components/UpdateNotification';
import { ToastContainer } from './components/ToastContainer';
import { useStore } from './store';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useInputDiag } from './hooks/useInputDiag';

/**
 * v1.2.10：其余页面改为按需加载。
 * 以前全部静态 import，Settings(108KB) / ClassDetail(39KB) / HomeworkModals(39KB)
 * 等全部打进首包 —— 它们直接决定了 renderer ready 的那 1.5 秒白屏。
 * 现在首包只剩 Dashboard + Layout + 公共组件。
 */
const ClassListPage = lazy(() => import('./pages/Class'));
const ClassDetailPage = lazy(() => import('./pages/Class/ClassDetail'));
const CalendarPage = lazy(() => import('./pages/Calendar'));
const CoursesPage = lazy(() => import('./pages/Courses'));
const ProjectsPage = lazy(() => import('./pages/Projects'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const AcademicPage = lazy(() => import('./pages/Academic'));
const HabitsPage = lazy(() => import('./pages/Habits'));
const StatsPage = lazy(() => import('./pages/Stats'));

/** 切页时的骨架占位（避免路由切换那一瞬的空白闪一下） */
function PageLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3 animate-page-in">
        <div className="w-6 h-6 border-2 border-neon-green/25 border-t-neon-green rounded-full animate-spin" />
        <p className="font-mono text-xs text-text-dim">加载中…</p>
      </div>
    </div>
  );
}

export default function App() {
  const refreshAll = useStore((s) => s.refreshAll);
  const updateInfo = useStore((s) => s.updateInfo);
  const { pathname } = useLocation();
  const readySignaledRef = useRef(false);

  // v1.1.5：把 settings.theme 应用到 <html data-theme="...">
  useApplyTheme();
  // v1.1.6：装输入框失灵探测器（块 3 埋点）
  useInputDiag();

  useEffect(() => {
    refreshAll();
    // v1.1.5：首次 refreshAll 完成后通知主进程关 splash、显示主窗口
    if (!readySignaledRef.current) {
      readySignaledRef.current = true;
      try {
        (window.taskAPI as any).app?.ready?.();
      } catch { /* 浏览器预览模式无 IPC，忽略 */ }
    }
  }, [refreshAll, pathname]);

  return (
    <>
      {/* v1.2.10：Suspense 兜住按需加载的页面，避免切页时白屏 */}
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/academic" element={<AcademicPage />} />
            <Route path="/habits" element={<HabitsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/class" element={<ClassListPage />} />
            <Route path="/class/:id" element={<ClassDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
      {/* 全局启动时更新通知（监听主进程推送 + 渲染层 store） */}
      <UpdateNotification externalTrigger={updateInfo} />
      {/* v1.2.8 块 N：全局 Toast 通知（替代 console.error） */}
      <ToastContainer />
    </>
  );
}