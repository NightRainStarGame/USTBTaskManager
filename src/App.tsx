import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/Calendar';
import CoursesPage from './pages/Courses';
import ProjectsPage from './pages/Projects';
import SettingsPage from './pages/Settings';
import MiniProgramPage from './pages/MiniProgram';
import { useStore } from './store';

export default function App() {
  const refreshAll = useStore((s) => s.refreshAll);
  const { pathname } = useLocation();

  useEffect(() => {
    refreshAll();
  }, [refreshAll, pathname]);

  return (
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
  );
}