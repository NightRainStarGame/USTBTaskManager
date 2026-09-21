import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, BookOpen, FolderKanban, Settings, AppWindow, User
} from 'lucide-react';
import clsx from '../utils/clsx';
import { useStore } from '@/store';
import serverIcon from '../assets/server-icon.png';

const items = [
  { to: '/', label: '总览', icon: LayoutDashboard, key: 'dashboard' },
  { to: '/calendar', label: '日历', icon: Calendar, key: 'calendar' },
  { to: '/courses', label: '课程', icon: BookOpen, key: 'courses' },
  { to: '/projects', label: '项目', icon: FolderKanban, key: 'projects' },
  { to: '/miniprogram', label: '小程序', icon: AppWindow, key: 'miniprogram' },
  { to: '/settings', label: '设置', icon: Settings, key: 'settings' },
];

export default function Sidebar() {
  const loc = useLocation();
  const userProfile = useStore(s => s.userProfile);
  const appInfo = useStore(s => s.appInfo);
  const updateInfo = useStore(s => s.updateInfo);
  const hasUpdate = !!updateInfo?.hasUpdate;
  return (
    <aside className="relative z-20 w-60 shrink-0 flex flex-col bg-ink-900/80 backdrop-blur-md border-r border-neon-green/15">
      {/* Logo（v1.1.7：换成 StarMain server-icon） */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-neon-green/15">
        <img
          src={serverIcon}
          alt="StarOS"
          className="w-9 h-9 rounded-lg shadow-neon-green shrink-0"
          style={{ imageRendering: 'auto' }}
          draggable={false}
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-base font-bold text-neon-green text-glow-green">StarOS</span>
          <span className="font-mono text-[10px] text-text-dim uppercase tracking-widest mt-0.5">v{appInfo?.version || '—'}</span>
          <span className="font-mono text-[8px] text-text-dim/70 tracking-wider mt-0.5">made by Lasarac</span>
        </div>
      </div>

      {/* 菜单 */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {items.map(({ to, label, icon: Icon, key }) => {
          const active = to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to);
          return (
            <NavLink
              key={key}
              to={to}
              className={clsx(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-md',
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
              <span>{label}</span>
              {key === 'settings' && hasUpdate && (
                <span
                  className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-mono bg-neon-yellow/20 text-neon-yellow border border-neon-yellow/40 animate-pulse-glow"
                  title={`发现新版本 v${updateInfo?.latestVersion}`}
                >
                  NEW
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* 底部状态条 */}
      <div className="p-3 border-t border-neon-green/15 space-y-2">
        <NavLink
          to="/settings"
          className="flex items-center gap-2.5 px-2 py-2 rounded-md bg-ink-base/60 hover:bg-neon-green/10 transition-colors group"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-yellow to-neon-yellow-dim flex items-center justify-center shrink-0">
            <User size={14} className="text-ink-base" />
          </div>
          <div className="flex flex-col leading-tight min-w-0 flex-1">
            <span className="text-xs font-medium text-text-primary truncate group-hover:text-neon-green transition-colors">
              {userProfile?.real_name || userProfile?.username || '未设置账号'}
            </span>
            <span className="font-mono text-[10px] text-text-dim truncate">
              {userProfile?.student_id || 'SYSTEM·ONLINE'}
            </span>
          </div>
          <span className="status-dot bg-neon-green animate-pulse-glow" />
        </NavLink>
      </div>
    </aside>
  );
}