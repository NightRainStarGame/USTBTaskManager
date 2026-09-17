import { useEffect, useState } from 'react';
import { Plus, Search, Minus, Square, X, Maximize2 } from 'lucide-react';
import { useStore } from '@/store';
import dayjs from 'dayjs';

interface Props {
  onPlus: () => void;
  onSearch: () => void;
}

export default function TopBar({ onPlus, onSearch }: Props) {
  const stats = useStore(s => s.stats);
  const [now, setNow] = useState(dayjs());
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.taskAPI.window.isMaximized().then(setMaximized);
  }, []);

  const handleMax = async () => {
    await window.taskAPI.window.maximize();
    setMaximized(await window.taskAPI.window.isMaximized());
  };

  return (
    <header
      className="relative h-14 flex items-center gap-3 px-4 bg-ink-900/60 backdrop-blur-md border-b border-neon-green/15 select-none"
    >
      {/* 左侧：加号 + 搜索（可交互，非拖拽区） */}
      <div className="flex items-center gap-2">
        <button onClick={onPlus} className="btn-neon py-1.5 px-3" title="新建 (Ctrl+N)">
          <Plus size={16} />
        </button>
        <button onClick={onSearch} className="btn-ghost" title="全局搜索 (Ctrl+K)">
          <Search size={15} />
          <span className="hidden md:inline">搜索</span>
          <span className="font-mono text-[10px] text-text-dim ml-1 px-1.5 py-0.5 rounded border border-text-dim/30">⌘K</span>
        </button>
      </div>

      {/* 拖拽区：仅空白间隔（避免 app-region:drag 干扰子元素事件/输入法） */}
      <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as any} />

      {/* 中部：实时统计胶囊 */}
      {stats && (
        <div className="hidden lg:flex items-center gap-2">
          <StatPill label="今日" value={stats.dueTodayReq} accent="green" />
          <StatPill label="逾期" value={stats.overdueReq} accent="danger" />
          <StatPill label="课程" value={stats.totalCourses} accent="yellow" />
          <StatPill label="项目" value={stats.activeProjects} accent="green" />
        </div>
      )}

      <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as any} />

      {/* 右侧：时钟 + 窗口控制（可交互） */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end leading-none font-mono">
          <span className="text-sm text-neon-green text-glow-green tracking-widest">
            {now.format('HH:mm:ss')}
          </span>
          <span className="text-[10px] text-text-dim mt-0.5">{now.format('YYYY-MM-DD ddd')}</span>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <WindowBtn onClick={() => window.taskAPI.window.minimize()} title="最小化">
            <Minus size={14} />
          </WindowBtn>
          <WindowBtn onClick={handleMax} title={maximized ? '还原' : '最大化'}>
            {maximized ? <Square size={12} /> : <Maximize2 size={12} />}
          </WindowBtn>
          <WindowBtn onClick={() => window.taskAPI.window.close()} title="关闭" danger>
            <X size={14} />
          </WindowBtn>
        </div>
      </div>
    </header>
  );
}

function StatPill({ label, value, accent }: { label: string; value: number; accent: 'green' | 'yellow' | 'danger' }) {
  const colorMap = {
    green: 'text-neon-green border-neon-green/40',
    yellow: 'text-neon-yellow border-neon-yellow/40',
    danger: 'text-neon-danger border-neon-danger/50',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border bg-ink-base/50 ${colorMap[accent]}`}>
      <span className="font-mono text-[10px] uppercase opacity-80">{label}</span>
      <span className="font-mono text-sm font-bold">{value}</span>
    </div>
  );
}

function WindowBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded flex items-center justify-center transition-colors
        ${danger ? 'hover:bg-neon-danger/20 hover:text-neon-danger text-text-secondary' : 'hover:bg-neon-green/10 hover:text-neon-green text-text-secondary'}`}
    >
      {children}
    </button>
  );
}