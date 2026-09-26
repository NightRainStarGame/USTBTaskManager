/**
 * v1.2.8 块 K：Courses 拆分 — CoursesPage 主组件（薄编排）
 *  - 调度 TimetableView + CourseDrawer
 *  - 管理 active course + active tab + refresh
 *  - 各 tab 渲染通过 CourseDrawer 的 children prop 传入
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, BookOpen, RefreshCw, KeyRound, CloudUpload, CloudDownload, Shell } from 'lucide-react';
import { useStore } from '@/store';
import type { Course } from '@/types';
import { toast } from '@/utils/toast';
import Modal from '@/components/Modal';
import BeikeTimetable from '@/components/BeikeTimetable';
import { GenerateCodesModal, PublishHomeworkModal, ReceiveHomeworkModal } from '../HomeworkModals';
import { TimetableView } from './TimetableView';
import { CourseDrawer } from './CourseDrawer';
import { InfoTab } from './tabs/InfoTab';
import { ScheduleTab } from './tabs/ScheduleTab';
import { ReqsTab } from './tabs/ReqsTab';
import { NotesTab } from './tabs/NotesTab';

import type { DrawerTab } from './constants';

/**
 * v1.2.10 修正：APK 的主进程逻辑跑在同一个 webview 里（src/mobile/bootstrap.ts 会
 * registerAllIpc），homework:* handler 全部就位，且 GitHub API 支持 CORS ——
 * 作业同步在手机上本来就能用，之前隐藏它是误判（当时以为 APK 走的是浏览器 Mock）。
 * 贝壳课表（USTB 教务）不发 CORS 头，要等原生 HTTP 通道就绪才放开。
 */
const IS_MOBILE = typeof window !== 'undefined' && !!(window as any).__MOBILE__;
/** 作业同步入口是否可见（保留成常量是为了让移动端/桌面端的差异点一目了然） */
const SHOW_HOMEWORK = true;

export function CoursesPage() {
  const courses = useStore((s) => s.courses);
  const refreshAll = useStore((s) => s.refreshAll);
  const [activeCourseId, setActiveCourseId] = useState<number | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('info');
  // 作业同步（码制：生成作业码 / 发布作业 / 接收作业）— 恢复块 K 拆分时丢失的入口
  const [hwMenuOpen, setHwMenuOpen] = useState(false);
  const [genCodesOpen, setGenCodesOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  // 贝壳课表：USTB 教务同步（v1.2.3 从小程序中心迁入）— 同上恢复
  const [beikeOpen, setBeikeOpen] = useState(false);

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
        <div className="flex items-center gap-2 flex-wrap">
          {SHOW_HOMEWORK && (
            <div className="relative">
              <button
                onClick={() => setHwMenuOpen(v => !v)}
                className={`btn-ghost ${hwMenuOpen ? 'text-neon-green border-neon-green/60 bg-neon-green/10' : ''}`}
                title="生成作业码 / 发布 / 接收作业"
              >
                <RefreshCw size={14} /> 作业同步
              </button>
              {hwMenuOpen && (
                <div className="absolute right-0 top-full mt-2 z-30 glass-panel rounded-lg p-1.5 border border-neon-green/20 shadow-neon-green flex flex-col gap-1.5 animate-in min-w-[140px]">
                  <button
                    onClick={() => { setHwMenuOpen(false); setGenCodesOpen(true); }}
                    className="btn-neon text-xs whitespace-nowrap justify-start"
                  >
                    <KeyRound size={13} /> 生成作业码
                  </button>
                  <button
                    onClick={() => { setHwMenuOpen(false); setPublishOpen(true); }}
                    className="btn-neon btn-neon-yellow text-xs whitespace-nowrap justify-start"
                  >
                    <CloudUpload size={13} /> 发布作业
                  </button>
                  <button
                    onClick={() => { setHwMenuOpen(false); setReceiveOpen(true); }}
                    className="btn-neon text-xs whitespace-nowrap justify-start"
                  >
                    <CloudDownload size={13} /> 接收作业
                  </button>
                </div>
              )}
            </div>
          )}
          {!IS_MOBILE && (
            <button
              onClick={() => setBeikeOpen(true)}
              className="btn-ghost"
              title="USTB 统一身份认证扫码登录，一键导入教务课表"
            >
              <Shell size={14} /> 贝壳课表
            </button>
          )}
          <button onClick={createCourse} className="btn-neon btn-neon-yellow">
            <Plus size={14} /> 新建课程
          </button>
        </div>
      </div>

      <TimetableView activeCourseId={activeCourseId} onOpenCourse={openCourse} />

      {activeCourseObj && (
        <CourseDrawer
          course={activeCourseObj}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={closeDrawer}
          InfoTab={<InfoTab course={activeCourseObj} onSaved={onSaved} onClose={closeDrawer} onGoTab={setDrawerTab} />}
          ScheduleTab={<ScheduleTab course={activeCourseObj} />}
          ReqsTab={<ReqsTab course={activeCourseObj} />}
          NotesTab={<NotesTab course={activeCourseObj} />}
        />
      )}

      {/* 贝壳课表：USTB 教务同步弹窗 */}
      {beikeOpen && (
        <Modal title="贝壳课表 · USTB 教务同步" onClose={() => setBeikeOpen(false)} width="max-w-3xl">
          <BeikeTimetable />
        </Modal>
      )}

      {/* 作业同步入口在顶部（v1.2.5 起，避免与右下 Pomodoro 重叠） */}
      {genCodesOpen && (
        <GenerateCodesModal onClose={() => setGenCodesOpen(false)} />
      )}
      {publishOpen && (
        <PublishHomeworkModal
          onClose={() => setPublishOpen(false)}
          onChanged={async () => { await refreshAll(); }}
        />
      )}
      {receiveOpen && (
        <ReceiveHomeworkModal
          onClose={() => setReceiveOpen(false)}
          onSynced={async () => { await refreshAll(); }}
        />
      )}
    </div>
  );
}

export default CoursesPage;