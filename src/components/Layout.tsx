import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ParticleBg from './ParticleBg';
import PlusMenu from './PlusMenu';
import SearchPalette from './SearchPalette';
import PomodoroWidget from './Pomodoro';
import QuickAdd from './QuickAdd';
import useShortcuts from '@/hooks/useShortcuts';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';

export default function Layout() {
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const setAppInfo = useStore(s => s.setAppInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);
  useShortcuts(() => setPlusOpen(true), () => setSearchOpen(true));

  // v1.2.3：主进程全局快捷键（Ctrl+Shift+A）→ 呼出快速添加（应用外也能唤起主窗口）
  useEffect(() => {
    const off = window.taskAPI.system?.onQuickAdd?.(() => setQuickAddOpen(true));
    return () => off?.();
  }, []);

  // 应用信息 + 启动静默检查更新
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await window.taskAPI.app.info();
        if (alive) setAppInfo(info);
      } catch { /* 浏览器 mock 不可用时忽略 */ }

      // 移动端无更新通道（安装包制 + child_process 不可用），
      // 跳过检查：避免无意义的跨域请求与「检查到更新却装不了」的误导
      if ((window as any).__MOBILE__) return;

      try {
        const cfg = await window.taskAPI.updater.config();
        if (!cfg.source) return;
        const r = await window.taskAPI.updater.check();
        if (alive && r?.hasUpdate && !r?.skipped) setUpdateInfo(r);
      } catch { /* 静默 */ }
    })();

    const off = window.taskAPI.updater?.onAvailable?.((r) => setUpdateInfo(r));
    return () => { alive = false; off?.(); };
  }, [setAppInfo, setUpdateInfo]);

  return (
    <div className="relative h-screen w-screen flex overflow-hidden bg-ink-base">
      {/* 动态背景 */}
      <div className="absolute inset-0 z-0">
        <ParticleBg density={50} />
        {/* 扫描线 */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(180deg, transparent 0%, rgba(0,255,136,0.025) 50%, transparent 100%)',
            backgroundSize: '100% 3px',
          }}
        />
      </div>

      {/* 侧边栏（手机=抽屉 / 平板=图标窄栏 / 桌面=全宽） */}
      <Sidebar mobileOpen={menuOpen} onMobileClose={() => setMenuOpen(false)} />

      {/* 主区域 */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <TopBar
          onPlus={() => setPlusOpen(true)}
          onSearch={() => setSearchOpen(true)}
          onMenu={() => setMenuOpen(true)}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* 全局弹层 */}
      {plusOpen && <PlusMenu onClose={() => setPlusOpen(false)} />}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {/* v1.2.3：全局番茄钟 + 自然语言快速添加 */}
      <PomodoroWidget />
      {quickAddOpen && <QuickAdd onClose={() => setQuickAddOpen(false)} />}
    </div>
  );
}