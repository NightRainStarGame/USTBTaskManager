/**
 * v1.2.8 块 K：Courses 拆分 — CoursesPage 主组件（薄编排）
 *  - 调度 TimetableView + CourseDrawer
 *  - 管理 active course + active tab + refresh
 *  - 各 tab 渲染通过 CourseDrawer 的 children prop 传入
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, BookOpen } from 'lucide-react';
import { useStore } from '@/store';
import type { Course } from '@/types';
import { toast } from '@/utils/toast';
import { TimetableView } from './TimetableView';
import { CourseDrawer } from './CourseDrawer';
import { InfoTab } from './tabs/InfoTab';
import { ScheduleTab } from './tabs/ScheduleTab';
import { ReqsTab } from './tabs/ReqsTab';
import { NotesTab } from './tabs/NotesTab';
import { MiniProgramTab } from './tabs/MiniProgramTab';
import type { DrawerTab } from './constants';

export function CoursesPage() {
  const courses = useStore((s) => s.courses);
  const refreshAll = useStore((s) => s.refreshAll);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('info');

  const activeCourseObj = useMemo(
    () => courses.find((c) => c.id === activeCourseId) ?? null,
    [courses, activeCourseId]
  );

  // 首次挂载 / 课程列表变化时自动选第一门课
  useEffect(() => {
    if (activeCourseId == null && courses.length > 0) {
      setActiveCourseId(courses[0].id);
      setDrawerTab('info');
    }
    if (activeCourseId != null && !courses.find((c) => c.id === activeCourseId)) {
      setActiveCourseId(courses[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.length]);

  const openCourse = useCallback((c: Course, tab: DrawerTab = 'info') => {
    setActiveCourseId(c.id);
    setDrawerTab(tab);
  }, []);
  const closeDrawer = useCallback(() => setActiveCourseId(null), []);

  const createCourse = async () => {
    try {
      const created = await window.taskAPI.db.courses.create({
        name: '新课程', color: '#00FF88', code: '', instructor: '',
        semester: '2026-Fall', description: '', tags: [],
      });
      await refreshAll();
      openCourse(created as Course, 'info');
    } catch (e) {
      toast.exception(e, '创建课程失败');
    }
  };

  const onSaved = async () => { await refreshAll(); };

  // 顶部空状态：让用户先建课程
  if (courses.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <BookOpen size={48} className="text-neon-green/60" />
        <p className="text-text-secondary font-mono text-sm">还没有课程。先建一门课，让时间表有东西可排。</p>
        <button onClick={createCourse} className="btn-neon">
          <Plus size={14} /> 新建第一门课
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-mono text-sm text-neon-green tracking-wider">COURSE TIMETABLE</h2>
          <span className="font-mono text-[10px] text-text-dim">{courses.length} 门课程</span>
        </div>
        <button onClick={createCourse} className="btn-neon btn-neon-yellow">
          <Plus size={14} /> 新建课程
        </button>
      </div>

      <TimetableView activeCourseId={activeCourseId} onOpenCourse={openCourse} />

      {activeCourseObj && (
        <CourseDrawer
          course={activeCourseObj}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={closeDrawer}
          hasMiniProgram={false}
          InfoTab={<InfoTab course={activeCourseObj} onSaved={onSaved} onClose={closeDrawer} onGoTab={setDrawerTab} />}
          ScheduleTab={<ScheduleTab course={activeCourseObj} />}
          ReqsTab={<ReqsTab course={activeCourseObj} />}
          NotesTab={<NotesTab course={activeCourseObj} />}
          MiniProgramTab={<MiniProgramTab course={activeCourseObj} />}
        />
      )}
    </div>
  );
}

export default CoursesPage;