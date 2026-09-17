import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ParticleBg from './ParticleBg';
import PlusMenu from './PlusMenu';
import SearchPalette from './SearchPalette';
import useShortcuts from '@/hooks/useShortcuts';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';

export default function Layout() {
  const [plusOpen, setPlusOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const setAppInfo = useStore(s => s.setAppInfo);
  const setUpdateInfo = useStore(s => s.setUpdateInfo);
  useShortcuts(() => setPlusOpen(true), () => setSearchOpen(true));

  // 应用信息 + 启动静默检查更新
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const info = await window.taskAPI.app.info();
        if (alive) setAppInfo(info);
      } catch { /* 浏览器 mock 不可用时忽略 */ }

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

      {/* 侧边栏 */}
      <Sidebar />

      {/* 主区域 */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <TopBar
          onPlus={() => setPlusOpen(true)}
          onSearch={() => setSearchOpen(true)}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* 全局弹层 */}
      {plusOpen && <PlusMenu onClose={() => setPlusOpen(false)} />}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </div>
  );
}