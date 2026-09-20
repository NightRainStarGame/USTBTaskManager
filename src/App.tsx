import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/Calendar';
import CoursesPage from './pages/Courses';
import ProjectsPage from './pages/Projects';
import SettingsPage from './pages/Settings';
import MiniProgramPage from './pages/MiniProgram';
import UpdateNotification from './components/UpdateNotification';
import { useStore } from './store';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useInputDiag } from './hooks/useInputDiag';

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
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/miniprogram" element={<MiniProgramPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      {/* 全局启动时更新通知（监听主进程推送 + 渲染层 store） */}
      <UpdateNotification externalTrigger={updateInfo} />
    </>
  );
}