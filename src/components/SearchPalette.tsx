import { useEffect, useMemo, useState } from 'react';
import { Search, X, BookOpen, Calendar, FileText, FolderKanban } from 'lucide-react';
import { useStore } from '@/store';
import { useNavigate } from 'react-router-dom';

interface Props { onClose: () => void }

export default function SearchPalette({ onClose }: Props) {
  const [q, setQ] = useState('');
  const courses = useStore(s => s.courses);
  const requirements = useStore(s => s.requirements);
  const events = useStore(s => s.events);
  const projects = useStore(s => s.projects);
  const nav = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return [];
    const match = (s: string) => (s || '').toLowerCase().includes(k);
    return [
      ...courses.filter(c => match(c.name) || match(c.code || '') || match(c.instructor || ''))
        .slice(0, 5)
        .map(c => ({ type: 'course' as const, id: c.id, title: c.name, subtitle: c.code || c.instructor || '', color: c.color, action: () => nav('/courses') })),
      ...requirements.filter(r => match(r.title) || match(r.description || '') || match(r.course_name || ''))
        .slice(0, 8)
        .map(r => ({ type: 'requirement' as const, id: r.id, title: r.title, subtitle: `${r.course_name} · ${new Date(r.due_date).toLocaleDateString()}`, color: r.course_color, action: () => nav('/courses') })),
      ...events.filter(e => match(e.title) || match(e.location || '') || match(e.course_name || ''))
        .slice(0, 5)
        .map(e => ({ type: 'event' as const, id: e.id, title: e.title, subtitle: `${new Date(e.start_at).toLocaleString()} · ${e.location || ''}`, color: e.course_color, action: () => nav('/calendar') })),
      ...projects.filter(p => match(p.name) || match(p.description || ''))
        .slice(0, 5)
        .map(p => ({ type: 'project' as const, id: p.id, title: p.name, subtitle: p.description || '', color: '#00FF88', action: () => nav('/projects') })),
    ];
  }, [q, courses, requirements, events, projects, nav]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[600px] glass-panel overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-neon-green/15">
          <Search size={16} className="text-neon-green" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索课程、作业、事件、项目……"
            className="flex-1 bg-transparent outline-none text-sm font-mono text-text-primary placeholder-text-dim"
          />
          <span className="font-mono text-[10px] text-text-dim px-1.5 py-0.5 border border-text-dim/30 rounded">ESC</span>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {q && results.length === 0 && (
            <div className="px-4 py-10 text-center text-text-dim font-mono text-sm">
              <span className="opacity-60">▌</span> 没有匹配结果
            </div>
          )}
          {results.map((r, idx) => (
            <button
              key={`${r.type}-${r.id}-${idx}`}
              onClick={() => { r.action(); onClose(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neon-green/5 text-left border-b border-neon-green/5 last:border-b-0"
            >
              <span className="w-1 h-8 rounded" style={{ background: r.color, boxShadow: `0 0 6px ${r.color}` }} />
              <ResultIcon type={r.type} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{r.title}</div>
                <div className="font-mono text-[11px] text-text-dim truncate">{r.subtitle}</div>
              </div>
              <span className="font-mono text-[10px] uppercase text-neon-green/70">{r.type}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ResultIcon({ type }: { type: string }) {
  const map: any = { course: BookOpen, requirement: FileText, event: Calendar, project: FolderKanban };
  const Icon = map[type];
  return Icon ? <Icon size={16} className="text-neon-green shrink-0" /> : null;
}