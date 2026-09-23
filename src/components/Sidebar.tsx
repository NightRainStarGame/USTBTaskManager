import { NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  LayoutDashboard, Calendar, BookOpen, FolderKanban, Settings, AppWindow, User,
  GraduationCap, Flame, BarChart3, Users, X,
} from 'lucide-react';
import clsx from '../utils/clsx';
import { useStore } from '@/store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import serverIcon from '../assets/server-icon.png';

const items = [
  { to: '/', label: '总览', icon: LayoutDashboard, key: 'dashboard' },
  { to: '/calendar', label: '日历', icon: Calendar, key: 'calendar' },
  { to: '/courses', label: '课程', icon: BookOpen, key: 'courses' },
  { to: '/academic', label: '学业', icon: GraduationCap, key: 'academic' },
  { to: '/habits', label: '习惯', icon: Flame, key: 'habits' },
  { to: '/projects', label: '项目', icon: FolderKanban, key: 'projects' },
  { to: '/stats', label: '统计', icon: BarChart3, key: 'stats' },
  { to: '/miniprogram', label: '小程序', icon: AppWindow, key: 'miniprogram' },
  { to: '/class', label: '班级', icon: Users, key: 'class' },
  { to: '/settings', label: '设置', icon: Settings, key: 'settings' },
];

interface Props {
  /** 手机抽屉开合（<768px 生效；≥768 由 CSS 断点自适应） */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/** 侧栏内容。md:lg 区间为图标窄栏（平板），≥lg 还原全宽；手机抽屉则始终全宽。 */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const loc = useLocation();
  const userProfile = useStore(s => s.userProfile);
  const appInfo = useStore(s => s.appInfo);
  const updateInfo = useStore(s => s.updateInfo);
  const hasUpdate = !!updateInfo?.hasUpdate;
  return (
    <>
      {/* Logo（v1.1.7：换成 StarMain server-icon）。平板窄栏只留图标 */}
      <div className="h-14 shrink-0 flex items-center gap-2.5 px-4 border-b border-neon-green/15 md:justify-center md:px-0 lg:justify-start lg:px-4">
        <img
          src={serverIcon}
          alt="StarOS"
          className="w-9 h-9 rounded-lg shadow-neon-green shrink-0"
          style={{ imageRendering: 'auto' }}
          draggable={false}
        />
        <div className="flex flex-col leading-tight flex-1 min-w-0 md:hidden lg:flex">
          <span className="font-mono text-base font-bold text-neon-green text-glow-green">StarOS</span>
          <span className="font-mono text-[10px] text-text-dim uppercase tracking-widest mt-0.5">v{appInfo?.version || '—'}</span>
          <span className="font-mono text-[8px] text-text-dim/70 tracking-wider mt-0.5">made by Lasarac</span>
        </div>
        {onNavigate && (
          <button
            onClick={onNavigate}
            aria-label="关闭菜单"
            className="md:hidden ml-auto w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:text-neon-green hover:bg-neon-green/10 transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* 菜单 */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto md:px-1.5 lg:px-2">
        {items.map(({ to, label, icon: Icon, key }) => {
          const active = to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to);
          return (
            <NavLink
              key={key}
              to={to}
              onClick={onNavigate}
              title={label}
              className={clsx(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-md',
                'md:justify-center md:gap-0 md:px-0 lg:justify-start lg:gap-3 lg:px-3',
                'font-mono text-sm uppercase tracking-wider transition-all duration-200',
                active
                  ? 'bg-neon-green/10 text-neon-green shadow-neon-green'
                  : 'text-text-secondary hover:text-neon-green hover:bg-neon-green/5'
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-neon-green rounded-r shadow-neon-green" />
              )}
              <Icon size={16} className="shrink-0" />
              <span className="md:hidden lg:inline">{label}</span>
              {key === 'settings' && hasUpdate && (
                <span
                  className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-mono bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/40 animate-pulse-glow md:hidden lg:inline-flex"
                  title={`发现新版本 v${updateInfo?.latestVersion}`}
                >
                  NEW
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* 底部状态条。平板窄栏只留头像圆 */}
      <div className="p-3 border-t border-neon-green/15 md:p-2 lg:p-3">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          title="设置"
          className="flex items-center gap-2.5 px-2 py-2 rounded-md bg-ink-base/60 hover:bg-neon-green/10 transition-colors group md:justify-center lg:justify-start"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-yellow to-neon-yellow-dim flex items-center justify-center shrink-0">
            <User size={14} className="text-ink-base" />
          </div>
          <div className="flex flex-col leading-tight min-w-0 flex-1 md:hidden lg:flex">
            <span className="text-xs font-medium text-text-primary truncate group-hover:text-neon-green transition-colors">
              {userProfile?.real_name || userProfile?.username || '未设置账号'}
            </span>
            <span className="font-mono text-[10px] text-text-dim truncate">
              {userProfile?.student_id || 'SYSTEM·ONLINE'}
            </span>
          </div>
          <span className="status-dot bg-neon-green animate-pulse-glow md:hidden lg:inline" />
        </NavLink>
      </div>
    </>
  );
}

export default function Sidebar({ mobileOpen = false, onMobileClose }: Props) {
  const isMobile = useIsMobile();
  const loc = useLocation();

  // 路由切换自动收起手机抽屉
  useEffect(() => { onMobileClose?.(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isMobile) {
    // 平板（md）图标窄栏 → 桌面（lg）还原全宽
    return (
      <aside className="relative z-20 w-60 md:w-16 lg:w-60 shrink-0 flex flex-col bg-ink-900/80 backdrop-blur-md border-r border-neon-green/15">
        <SidebarContent />
      </aside>
    );
  }

  // 手机：遮罩 + 抽屉
  return (
    <>
      <div
        className={clsx(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        onClick={onMobileClose}
      />
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] flex flex-col bg-ink-900/95 backdrop-blur-md border-r border-neon-green/15',
          'transition-transform duration-300 ease-out will-change-transform',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarContent onNavigate={onMobileClose} />
      </aside>
    </>
  );
}
