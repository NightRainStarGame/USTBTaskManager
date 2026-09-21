import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/store';
import { Plus, FolderKanban, ListChecks, LayoutGrid, GanttChart, Pencil, Trash2, Workflow, Flag } from 'lucide-react';
import Modal from '@/components/Modal';
import dayjs from 'dayjs';
import type { Project, ProjectTask } from '@/types';
import ProjectCanvas from '@/components/editor/ProjectCanvas';

type ViewMode = 'kanban' | 'list' | 'timeline' | 'canvas';

/** v1.3.0：优先级元信息（0 低 / 1 中 / 2 高 / 3 紧急） */
const PRIORITY_META: Record<number, { label: string; color: string }> = {
  0: { label: '低', color: '#8FA89B' },
  1: { label: '中', color: '#00D4FF' },
  2: { label: '高', color: '#FFA500' },
  3: { label: '紧急', color: '#FF3366' },
};

export default function ProjectsPage() {
  const projects = useStore(s => s.projects);
  const tasks = useStore(s => s.tasks);
  const refreshAll = useStore(s => s.refreshAll);
  const [view, setView] = useState<ViewMode>('list');
  const [modalOpen, setModalOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);

  useEffect(() => {
    if (projects.length && !activeProject) setActiveProject(projects[0]);
  }, [projects, activeProject]);

  const projectTasks = useMemo(() => activeProject ? tasks.filter(t => t.project_id === activeProject.id) : [], [activeProject, tasks]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="label-tag">PROJECTS·跨课程协作</p>
          <h2 className="text-2xl font-bold mt-1">项目 <span className="text-neon-green text-glow-green">·</span> <span className="text-text-dim font-mono text-base">{projects.length} 个</span></h2>
        </div>
        <div className="flex items-center gap-2">
          {/* v1.3.0：四视图切换 —— 看板 / 列表 / 时间线 / 画布（画布与项目一体） */}
          <div className="flex bg-ink-base/60 rounded-md border border-neon-green/20 overflow-hidden">
            {([['kanban', LayoutGrid, '看板'], ['list', ListChecks, '列表'], ['timeline', GanttChart, '时间线'], ['canvas', Workflow, '画布']] as const).map(([k, Icon, label]) => (
              <button
                key={k}
                onClick={() => setView(k as ViewMode)}
                className={`px-3 py-1.5 flex items-center gap-1.5 font-mono text-xs uppercase transition-colors
                  ${view === k ? 'bg-neon-green/15 text-neon-green' : 'text-text-secondary hover:text-neon-green'}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="btn-neon">
            <Plus size={14} /> 新建项目
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* 项目列表 */}
        <div className="space-y-2">
          {projects.map(p => {
            const pts = tasks.filter(t => t.project_id === p.id);
            const done = pts.filter(t => t.status === 'done').length;
            const prog = pts.length > 0 ? Math.round(done / pts.length * 100) : 0;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveProject(p)}
                onKeyDown={(e) => { if (e.key === 'Enter') setActiveProject(p); }}
                className={`w-full text-left p-3 rounded-md border transition-all cursor-pointer
                  ${activeProject?.id === p.id
                    ? 'bg-ink-900/80 border-neon-green shadow-neon-green'
                    : 'bg-ink-900/40 border-neon-green/10 hover:border-neon-green/40'}`}
              >
                <div className="flex items-center justify-between mb-1 gap-1">
                  <span className="font-medium text-sm truncate flex-1">{p.name}</span>
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0
                    ${p.status === 'active' ? 'bg-neon-green/15 text-neon-green' : 'bg-ink-700 text-text-dim'}`}>
                    {p.status}
                  </span>
                  <button
                    title="删除项目"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`删除项目「${p.name}」？\n其下所有任务也会一并删除。`)) return;
                      await window.taskAPI.db.projects.delete(p.id);
                      if (activeProject?.id === p.id) setActiveProject(null);
                      await refreshAll();
                    }}
                    className="btn-ghost p-1 text-text-dim hover:text-neon-danger shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <p className="text-[11px] text-text-dim line-clamp-2 mb-2">{p.description}</p>
                <div className="progress-bar"><div style={{ width: `${prog}%` }} /></div>
                <div className="flex items-center justify-between mt-1.5 font-mono text-[10px] text-text-dim">
                  <span>{done}/{pts.length} 任务</span>
                  {p.due_date && <span>DUE {dayjs(p.due_date).format('MM-DD')}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* 项目详情：画布模式占满剩余高度，其余模式走玻璃面板 */}
        <div className="lg:col-span-3 min-w-0">
          {activeProject ? (
            view === 'canvas' ? (
              <div className="h-[calc(100vh-150px)] min-h-[480px] rounded-lg border border-neon-green/15 overflow-hidden">
                <ProjectCanvas project={activeProject} />
              </div>
            ) : (
              <div className="glass-panel p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-xl font-bold">{activeProject.name}</h3>
                    <p className="text-text-secondary text-sm mt-1">{activeProject.description}</p>
                    <div className="flex items-center gap-4 mt-2 font-mono text-[11px] text-text-dim">
                      {activeProject.start_date && <span>开始 {dayjs(activeProject.start_date).format('YYYY-MM-DD')}</span>}
                      {activeProject.due_date && <span className="text-neon-yellow">截止 {dayjs(activeProject.due_date).format('YYYY-MM-DD')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditing(activeProject); setModalOpen(true); }} className="btn-ghost"><Pencil size={14} /></button>
                    <button onClick={async () => {
                      if (!confirm(`删除项目「${activeProject.name}」？`)) return;
                      await window.taskAPI.db.projects.delete(activeProject.id);
                      setActiveProject(null);
                      await refreshAll();
                    }} className="btn-ghost text-neon-danger"><Trash2 size={14} /></button>
                    <button onClick={() => setTaskModalOpen(true)} className="btn-neon btn-neon-yellow">
                      <Plus size={14} /> 新任务
                    </button>
                  </div>
                </div>

                {view === 'kanban' && <KanbanView project={activeProject} tasks={projectTasks} onChange={refreshAll} />}
                {view === 'list' && <ListView project={activeProject} tasks={projectTasks} onChange={refreshAll} />}
                {view === 'timeline' && <TimelineView project={activeProject} tasks={projectTasks} onChange={refreshAll} />}
              </div>
            )
          ) : (
            <div className="glass-panel p-10 text-center text-text-dim font-mono">
              [ ∅ ] 请选择或新建一个项目
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <ProjectModal
          project={editing}
          onClose={() => setModalOpen(false)}
          onSaved={async () => { setModalOpen(false); await refreshAll(); }}
        />
      )}
      {taskModalOpen && activeProject && (
        <TaskModal
          projectId={activeProject.id}
          task={null}
          onClose={() => setTaskModalOpen(false)}
          onSaved={async () => { setTaskModalOpen(false); await refreshAll(); }}
        />
      )}
    </div>
  );
}

function KanbanView({ project, tasks, onChange }: any) {
  const cols = [
    { key: 'todo', label: '待办', color: 'text-text-secondary border-text-dim/30' },
    { key: 'doing', label: '进行中', color: 'text-neon-yellow border-neon-yellow/40' },
    { key: 'blocked', label: '阻塞', color: 'text-neon-danger border-neon-danger/40' },
    { key: 'done', label: '已完成', color: 'text-neon-green border-neon-green/40' },
  ];
  const [drag, setDrag] = useState<ProjectTask | null>(null);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);

  const move = async (t: ProjectTask, status: string) => {
    await window.taskAPI.db.tasks.update(t.id, { ...t, status });
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-3">
        {cols.map(c => {
          const items = tasks.filter((t: ProjectTask) => t.status === c.key);
          return (
            <div
              key={c.key}
              className="bg-ink-base/40 border border-neon-green/10 rounded-lg p-3 min-h-[300px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag) move(drag, c.key); setDrag(null); }}
            >
              <div className={`flex items-center justify-between mb-3 pb-2 border-b ${c.color}`}>
                <span className="font-mono text-xs uppercase tracking-widest">{c.label}</span>
                <span className="font-mono text-[10px] text-text-dim">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((t: ProjectTask) => {
                  const pr = PRIORITY_META[t.priority ?? 1];
                  const overdue = t.due_date && t.status !== 'done' && dayjs(t.due_date).isBefore(dayjs(), 'day');
                  return (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={() => setDrag(t)}
                      className="p-2.5 rounded-md bg-ink-900/60 border border-neon-green/10 hover:border-neon-green/40 cursor-grab active:cursor-grabbing group"
                    >
                      <div className="flex items-start gap-1.5">
                        {/* v1.3.0：优先级旗标 */}
                        <span
                          className="shrink-0 mt-0.5 w-2 h-2 rounded-full"
                          style={{ background: pr.color, boxShadow: `0 0 6px ${pr.color}88` }}
                          title={`优先级：${pr.label}`}
                        />
                        <div className="text-sm flex-1 cursor-pointer hover:text-neon-green transition-colors" onClick={() => setEditingTask(t)} title="点击编辑">
                          {t.title}
                        </div>
                        <button
                          title="删除任务"
                          onClick={async () => {
                            if (!confirm(`删除任务「${t.title}」？`)) return;
                            await window.taskAPI.db.tasks.delete(t.id);
                            onChange();
                          }}
                          className="btn-ghost p-0.5 text-text-dim hover:text-neon-danger opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {(t.description || t.priority === 3) && (
                        <p className="text-[10px] text-text-dim line-clamp-1 ml-3.5 mt-0.5">
                          {t.priority === 3 ? <span className="text-neon-danger font-mono mr-1">[紧急]</span> : null}
                          {t.description}
                        </p>
                      )}
                      <div className="font-mono text-[10px] text-text-dim mt-1 flex items-center justify-between ml-3.5">
                        <span>{t.assignee || '未指派'}</span>
                        {t.due_date && <span className={overdue ? 'text-neon-danger' : ''}>{dayjs(t.due_date).format('MM-DD')}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {editingTask && (
        <TaskModal
          projectId={project.id}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={async () => { setEditingTask(null); await onChange(); }}
        />
      )}
    </div>
  );
}

/** v1.3.0 增强列表视图：统计条 + 过滤器 + 行内快速添加 + 优先级 + 点击编辑 */
function ListView({ project, tasks, onChange }: any) {
  const [filter, setFilter] = useState<'all' | 'todo' | 'doing' | 'blocked' | 'done' | 'overdue'>('all');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickPriority, setQuickPriority] = useState(1);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);

  const isOverdue = (t: ProjectTask) =>
    !!t.due_date && t.status !== 'done' && dayjs(t.due_date).isBefore(dayjs(), 'day');

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t: ProjectTask) => t.status === 'done').length;
    const doing = tasks.filter((t: ProjectTask) => t.status === 'doing').length;
    const overdue = tasks.filter(isOverdue).length;
    return { total, done, doing, overdue, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [tasks]);

  const filtered = useMemo(() => {
    const arr = tasks.filter((t: ProjectTask) => {
      if (filter === 'all') return true;
      if (filter === 'overdue') return isOverdue(t);
      return t.status === filter;
    });
    // 排序：优先级降序 → 截止日升序（无截止最后）→ order_index
    return [...arr].sort((a: ProjectTask, b: ProjectTask) => {
      const pa = a.priority ?? 1, pb = b.priority ?? 1;
      if (pa !== pb) return pb - pa;
      if (a.due_date && b.due_date) return a.due_date - b.due_date;
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return (a.order_index ?? 0) - (b.order_index ?? 0);
    });
  }, [tasks, filter]);

  const toggle = async (t: ProjectTask) => {
    const next = t.status === 'done' ? 'todo' : 'done';
    await window.taskAPI.db.tasks.update(t.id, { ...t, status: next });
    onChange();
  };

  const quickAdd = async () => {
    const title = quickTitle.trim();
    if (!title) return;
    await window.taskAPI.db.tasks.create({
      project_id: project.id,
      title,
      status: 'todo',
      priority: quickPriority,
    });
    setQuickTitle('');
    onChange();
  };

  const filterTabs = [
    ['all', `全部 ${stats.total}`],
    ['todo', '待办'],
    ['doing', `进行中 ${stats.doing}`],
    ['blocked', '阻塞'],
    ['overdue', `逾期 ${stats.overdue}`],
    ['done', `完成 ${stats.done}`],
  ] as const;

  return (
    <div className="space-y-3">
      {/* 统计条 */}
      <div className="flex items-center gap-4 p-3 rounded-md bg-ink-base/40 border border-neon-green/10 font-mono text-[11px]">
        <span className="text-text-dim">TOTAL <span className="text-text-primary">{stats.total}</span></span>
        <span className="text-neon-yellow">DOING {stats.doing}</span>
        <span className={stats.overdue ? 'text-neon-danger' : 'text-text-dim'}>OVERDUE {stats.overdue}</span>
        <span className="text-neon-green">DONE {stats.pct}%</span>
        <div className="flex-1 h-1.5 bg-ink-700 rounded overflow-hidden min-w-[80px]">
          <div className="h-full bg-neon-green transition-all" style={{ width: `${stats.pct}%`, boxShadow: '0 0 6px #00FF88' }} />
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex items-center gap-1 flex-wrap">
        {filterTabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k as typeof filter)}
            className={`px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider border transition-colors
              ${filter === k
                ? 'bg-neon-green/15 text-neon-green border-neon-green/40'
                : 'text-text-dim border-transparent hover:text-text-secondary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 行内快速添加 */}
      <div className="flex items-center gap-2">
        <input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(); }}
          placeholder="输入任务标题，回车快速添加…"
          className="input-neon flex-1 text-sm"
        />
        <select
          value={quickPriority}
          onChange={(e) => setQuickPriority(Number(e.target.value))}
          className="input-neon w-24 text-xs"
          title="优先级"
        >
          <option value={0}>低</option>
          <option value={1}>中</option>
          <option value={2}>高</option>
          <option value={3}>紧急</option>
        </select>
        <button onClick={quickAdd} className="btn-neon btn-neon-yellow text-xs shrink-0">
          <Plus size={12} /> 添加
        </button>
      </div>

      {/* 任务行 */}
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <div className="text-center text-text-dim font-mono text-xs py-8">[ ∅ ] 当前过滤条件下没有任务</div>
        )}
        {filtered.map((t: ProjectTask) => {
          const pr = PRIORITY_META[t.priority ?? 1];
          const overdue = isOverdue(t);
          return (
            <div
              key={t.id}
              className="flex items-center gap-3 p-2.5 rounded-md bg-ink-base/40 border border-neon-green/10 hover:border-neon-green/30 group transition-colors"
            >
              <button onClick={() => toggle(t)} className="shrink-0" title={t.status === 'done' ? '标记为待办' : '标记完成'}>
                {t.status === 'done' ? (
                  <div className="w-5 h-5 rounded border-2 border-neon-green bg-neon-green/30 flex items-center justify-center">
                    <span className="text-neon-green text-xs">✓</span>
                  </div>
                ) : (
                  <div className="w-5 h-5 rounded border-2 border-text-dim hover:border-neon-green" />
                )}
              </button>
              {/* 优先级旗标 */}
              <span
                className="shrink-0 flex items-center gap-0.5 font-mono text-[10px]"
                style={{ color: pr.color }}
                title={`优先级：${pr.label}`}
              >
                <Flag size={11} fill={t.priority === 3 ? pr.color : 'none'} />
              </span>
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingTask(t)} title="点击编辑任务">
                <div className={`text-sm truncate ${t.status === 'done' ? 'line-through text-text-dim' : 'hover:text-neon-green'} transition-colors`}>
                  {t.title}
                </div>
                {t.description && <div className="text-[10px] text-text-dim truncate mt-0.5">{t.description}</div>}
              </div>
              {/* 状态 pill（非列表过滤时一眼可辨） */}
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded shrink-0
                ${t.status === 'doing' ? 'bg-neon-yellow/15 text-neon-yellow'
                  : t.status === 'blocked' ? 'bg-neon-danger/15 text-neon-danger'
                  : t.status === 'done' ? 'bg-neon-green/15 text-neon-green'
                  : 'bg-ink-700 text-text-dim'}`}>
                {t.status === 'doing' ? '进行中' : t.status === 'blocked' ? '阻塞' : t.status === 'done' ? '完成' : '待办'}
              </span>
              <span className="font-mono text-[10px] text-text-dim shrink-0 hidden md:inline">{t.assignee || '未指派'}</span>
              {t.due_date && (
                <span className={`data-pill shrink-0 ${overdue ? 'border-neon-danger/50 text-neon-danger' : ''}`}>
                  {dayjs(t.due_date).format('MM-DD')}
                </span>
              )}
              <button
                title="编辑任务"
                onClick={() => setEditingTask(t)}
                className="btn-ghost p-1 text-text-dim hover:text-neon-green opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <Pencil size={12} />
              </button>
              <button
                title="删除任务"
                onClick={async () => {
                  if (!confirm(`删除任务「${t.title}」？`)) return;
                  await window.taskAPI.db.tasks.delete(t.id);
                  onChange();
                }}
                className="btn-ghost p-1 text-text-dim hover:text-neon-danger opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {editingTask && (
        <TaskModal
          projectId={project.id}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSaved={async () => { setEditingTask(null); await onChange(); }}
        />
      )}
    </div>
  );
}

function TimelineView({ project, tasks, onChange }: any) {
  const start = project.start_date ? dayjs(project.start_date) : (tasks[0]?.due_date ? dayjs(tasks[0].due_date).subtract(7, 'day') : dayjs());
  const end = project.due_date ? dayjs(project.due_date) : (tasks.length ? dayjs(Math.max(...tasks.map((t: ProjectTask) => t.due_date || 0))) : dayjs().add(30, 'day'));
  const totalDays = Math.max(end.diff(start, 'day'), 1);

  return (
    <div className="space-y-2 overflow-x-auto">
      <div className="font-mono text-[10px] text-text-dim uppercase mb-2">TIMELINE · {start.format('MM/DD')} → {end.format('MM/DD')}</div>
      {tasks.map((t: ProjectTask) => {
        if (!t.due_date) return null;
        const due = dayjs(t.due_date);
        const offset = Math.max(due.diff(start, 'day'), 0);
        const left = (offset / totalDays) * 100;
        const width = Math.max(4, 100 / totalDays);
        const colorMap: any = { todo: '#8FA89B', doing: '#FFEA00', blocked: '#FF3366', done: '#00FF88' };
        return (
          <div key={t.id} className="relative h-7 bg-ink-base/40 border border-neon-green/10 rounded group">
            <div className="absolute inset-y-0 left-0 w-full flex items-center px-2">
              <div className="w-32 truncate text-xs text-text-secondary">{t.title}</div>
            </div>
            <button
              title="删除任务"
              onClick={async () => {
                if (!confirm(`删除任务「${t.title}」？`)) return;
                await window.taskAPI.db.tasks.delete(t.id);
                onChange();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10 btn-ghost p-0.5 text-text-dim hover:text-neon-danger opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 size={12} />
            </button>
            <div
              className="absolute top-1 bottom-1 rounded shadow-sm flex items-center justify-end pr-2 font-mono text-[10px]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                minWidth: '40px',
                background: colorMap[t.status] + '33',
                borderLeft: `3px solid ${colorMap[t.status]}`,
                boxShadow: `0 0 8px ${colorMap[t.status]}55`,
                color: colorMap[t.status],
              }}
            >
              {due.format('MM/DD')}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectModal({ project, onClose, onSaved }: any) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [status, setStatus] = useState(project?.status || 'active');
  const [startDate, setStartDate] = useState(project?.start_date ? dayjs(project.start_date).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'));
  const [dueDate, setDueDate] = useState(project?.due_date ? dayjs(project.due_date).format('YYYY-MM-DD') : dayjs().add(14, 'day').format('YYYY-MM-DD'));
  const [progress, setProgress] = useState(project?.progress || 0);

  const submit = async () => {
    const payload = {
      name, description, status,
      start_date: startDate ? new Date(startDate).getTime() : null,
      due_date: dueDate ? new Date(dueDate).getTime() : null,
      progress,
    };
    if (project?.id) await window.taskAPI.db.projects.update(project.id, payload);
    else await window.taskAPI.db.projects.create(payload);
    await onSaved();
  };

  return (
    <Modal
      title={project ? '编辑项目' : '新建项目'}
      onClose={onClose}
      footer={<><button onClick={onClose} className="btn-ghost">取消</button><button onClick={submit} className="btn-neon">保存</button></>}
    >
      <div className="space-y-3">
        <Field label="项目名称 *"><input value={name} onChange={(e) => setName(e.target.value)} className="input-neon" /></Field>
        <Field label="描述"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-neon" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="状态">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-neon">
              <option value="active">进行中</option>
              <option value="completed">已完成</option>
              <option value="archived">归档</option>
            </select>
          </Field>
          <Field label="开始日期"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-neon" /></Field>
          <Field label="截止日期"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-neon" /></Field>
        </div>
        <Field label={`进度 ${progress}%`}>
          <input type="range" min={0} max={100} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-neon-green" />
        </Field>
      </div>
    </Modal>
  );
}

function TaskModal({ projectId, task, onClose, onSaved }: any) {
  const courses = useStore(s => s.courses);
  const [title, setTitle] = useState(task?.title || '');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [assignee, setAssignee] = useState(task?.assignee || '');
  const [courseId, setCourseId] = useState<number | ''>(task?.course_id || '');
  const [dueDate, setDueDate] = useState(task?.due_date ? dayjs(task.due_date).format('YYYY-MM-DD') : '');
  // v1.3.0：优先级 + 描述
  const [priority, setPriority] = useState<number>(task?.priority ?? 1);
  const [description, setDescription] = useState(task?.description || '');

  const submit = async () => {
    const payload = {
      project_id: projectId, title, status, assignee,
      course_id: courseId || null,
      due_date: dueDate ? new Date(dueDate).getTime() : null,
      priority,
      description: description || null,
    };
    if (task?.id) await window.taskAPI.db.tasks.update(task.id, { ...task, ...payload });
    else await window.taskAPI.db.tasks.create(payload);
    await onSaved();
  };

  return (
    <Modal
      title={task ? '编辑任务' : '新建任务'}
      onClose={onClose}
      footer={<><button onClick={onClose} className="btn-ghost">取消</button><button onClick={submit} className="btn-neon btn-neon-yellow">保存</button></>}
    >
      <div className="space-y-3">
        <Field label="标题 *"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" /></Field>
        <Field label="描述 / 备注">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-neon" placeholder="任务细节、验收标准…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="状态">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-neon">
              <option value="todo">待办</option>
              <option value="doing">进行中</option>
              <option value="blocked">阻塞</option>
              <option value="done">已完成</option>
            </select>
          </Field>
          {/* v1.3.0：优先级选择 */}
          <Field label="优先级">
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="input-neon">
              <option value={0}>低</option>
              <option value={1}>中</option>
              <option value={2}>高</option>
              <option value={3}>紧急</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="截止日期"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-neon" /></Field>
          <Field label="负责人"><input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input-neon" /></Field>
          <Field label="关联课程">
            <select value={courseId} onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : '')} className="input-neon">
              <option value="">无</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: any) {
  return (
    <label className="block">
      <span className="label-tag block mb-1">{label}</span>
      {children}
    </label>
  );
}
