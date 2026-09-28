import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, Suspense } from 'react';
import Layout from './components/Layout';
// 首页（Dashboard）保持静态：它是冷启动首屏，不能被 Suspense 挂起来
import Dashboard from './pages/Dashboard';
import UpdateNotification from './components/UpdateNotification';
import { ToastContainer } from './components/ToastContainer';
import { useStore } from './store';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useInputDiag } from './hooks/useInputDiag';

/**
 * v1.2.11：所有路由回到静态 import —— **请不要再把这里改回 React.lazy**。
 *
 * 教训（v1.2.10 翻车实录）：懒加载会让 Vite 产出 9 个独立 chunk，靠运行时
 * `import()` 拉取。开发模式下是 http://localhost:5173，一切正常；但打包成
 * Electron 安装版后，主窗口是 loadFile() 加载 app.asar 里的 index.html，
 * **协议是 file://**。file:// 下模块脚本的源是 opaque（null origin），页面里
 * 发出的 dynamic import 会被 Chromium 拒掉，报：
 *   Failed to fetch dynamically imported module:
 *   file:///D:/Appdata/Taskmanager/resources/app.asar/dist/assets/Calendar.js
 * 表现是：Dashboard 能进（静态打进首包），其余功能页点一个崩一个。
 *
 * 将来若真要恢复按需加载，前提是先把生产环境从 file:// 换成自定义协议
 * （在 main.ts 里 protocol.handle('app', …) 托管 dist/），并且 index.html 的
 * base 相对路径仍要能正确解析 —— 只把 lazy 改回来必然会再次复发。
 */
import ClassListPage from './pages/Class';
import ClassDetailPage from './pages/Class/ClassDetail';
import CalendarPage from './pages/Calendar';
import CoursesPage from './pages/Courses';
import ProjectsPage from './pages/Projects';
import SettingsPage from './pages/Settings';
import AcademicPage from './pages/Academic';
import HabitsPage from './pages/Habits';
import StatsPage from './pages/Stats';

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