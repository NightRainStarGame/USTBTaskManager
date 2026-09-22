/**
 * v1.2.3 小组页：共享清单（GitHub 远端真源 grouplists/<code>.json，本地镜像 CRUD，创建/加入/拉取/发布/退出）
 */
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import clsx from '../utils/clsx';
import Modal from '../components/Modal';
import type { GroupList, GroupListItem } from '@/types';
import {
  Users, Plus, Trash2, Copy, RefreshCw, CloudUpload, LogOut, CheckCircle2,
  Circle, CircleDot, Calendar,
} from 'lucide-react';

const STATUS_FLOW: Array<GroupListItem['status']> = ['todo', 'doing', 'done'];
const nextStatus = (s: GroupListItem['status']): GroupListItem['status'] =>
  STATUS_FLOW[(STATUS_FLOW.indexOf(s) + 1) % STATUS_FLOW.length];

export default function GroupsPage() {
  const [lists, setLists] = useState<GroupList[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const notify = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), 6000);
  };

  const load = async (preferId?: number) => {
    const ls: GroupList[] = await window.taskAPI.db.groupLists.list();
    setLists(ls);
    setSelectedId(cur => {
      if (preferId != null && ls.some(l => l.id === preferId)) return preferId;
      if (cur != null && ls.some(l => l.id === cur)) return cur;
      return ls[0]?.id ?? null;
    });
  };
  useEffect(() => { load(); }, []);

  const selected = useMemo(() => lists.find(l => l.id === selectedId) || null, [lists, selectedId]);

  const createGroup = async (name: string) => {
    setBusy('create');
    try {
      const r = await window.taskAPI.groups.create(name);
      if (r.ok && r.id) { await load(r.id); notify(true, `小组已创建 · 分享码 ${r.code}`); }
      else notify(false, r.error || '创建失败');
    } finally { setBusy(''); }
  };

  const joinGroup = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoining(true);
    try {
      const r = await window.taskAPI.groups.join(code);
      if (r.ok && r.id) { await load(r.id); setJoinCode(''); notify(true, `已加入「${r.name}」（${r.items ?? 0} 条）`); }
      else notify(false, r.error || '加入失败');
    } finally { setJoining(false); }
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Users className="text-neon-green" size={24} />
            小组 <span className="font-mono text-xs text-text-dim">GROUPS</span>
          </h1>
          <p className="text-sm text-text-dim mt-1">小组作业 · 分工 · 共享清单，一个分享码全员同步</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && joinGroup()}
            placeholder="输入分享码加入…"
            className="input-neon text-sm w-44"
          />
          <button onClick={joinGroup} disabled={joining || !joinCode.trim()} className="btn-ghost px-3 py-2 text-sm font-mono disabled:opacity-50">
            加入
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-neon px-3 py-2 text-sm font-mono">
            <Plus size={14} /> 新建小组
          </button>
        </div>
      </header>

      {flash && (
        <div className={clsx('glass-panel px-4 py-2 text-sm border', flash.ok ? 'border-neon-green/40 text-neon-green' : 'border-neon-danger/40 text-neon-danger')}>
          {flash.text}
        </div>
      )}

      {lists.length === 0 && !selected && (
        <div className="glass-panel p-10 text-center space-y-3">
          <Users size={40} className="mx-auto text-text-dim" />
          <div className="text-text-secondary">还没有加入任何小组</div>
          <div className="text-xs text-text-dim">
            「新建小组」生成分享码发给组员；或输入组员给你的分享码加入
          </div>
        </div>
      )}

      {lists.length > 0 && (
        <>
          {/* 小组切换 chips */}
          <div className="flex flex-wrap gap-2">
            {lists.map(l => (
              <button
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={clsx(
                  'px-4 py-2 rounded-md font-mono text-xs uppercase tracking-wider transition-all',
                  l.id === selectedId
                    ? 'bg-neon-green/10 text-neon-green border border-neon-green/40 shadow-neon-green'
                    : 'text-text-secondary border border-neon-green/10 hover:text-neon-green hover:border-neon-green/30 bg-ink-900/40'
                )}
              >
                {l.name}
              </button>
            ))}
          </div>

          {selected && <GroupPanel key={selected.id} list={selected} onLeft={() => load()} onFlash={notify} />}
        </>
      )}

      {showCreate && (
        <CreateModal
          busy={busy === 'create'}
          onClose={() => setShowCreate(false)}
          onCreate={async name => { await createGroup(name); setShowCreate(false); }}
        />
      )}
    </div>
  );
}

// ══════════════════ 单个小组面板 ══════════════════
function GroupPanel({ list, onLeft, onFlash }: {
  list: GroupList;
  onLeft: () => void;
  onFlash: (ok: boolean, text: string) => void;
}) {
  const [items, setItems] = useState<GroupListItem[]>([]);
  const [busy, setBusy] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadItems = async () => setItems(await window.taskAPI.db.groupListItems.list(list.id));
  useEffect(() => { loadItems(); }, [list.id]);

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(list.group_code); onFlash(true, '分享码已复制 ✓'); }
    catch { onFlash(false, '复制失败，请手动选择'); }
  };

  const pull = async () => {
    setBusy('pull');
    try {
      const r = await window.taskAPI.groups.pull(list.id);
      if (r.ok) { await loadItems(); onFlash(true, `已拉取 ${r.items ?? 0} 条（${dayjs(r.updatedAt).format('MM-DD HH:mm')} 更新）`); }
      else onFlash(false, r.error || '拉取失败');
    } finally { setBusy(''); }
  };

  const publish = async () => {
    setBusy('publish');
    try {
      const r = await window.taskAPI.groups.publish(list.id);
      if (r.ok) onFlash(true, `已发布 ${r.items ?? 0} 条到云端 ✓`);
      else onFlash(false, r.error || '发布失败');
    } finally { setBusy(''); }
  };

  const leave = async () => {
    if (!confirm(`退出小组「${list.name}」？本地清单会被移除（云端数据不受影响）。`)) return;
    setBusy('leave');
    try {
      await window.taskAPI.groups.leave(list.id);
      onFlash(true, '已退出小组');
      onLeft();
    } finally { setBusy(''); }
  };

  const cycleStatus = async (it: GroupListItem) => {
    const status = nextStatus(it.status);
    await window.taskAPI.db.groupListItems.update(it.id, {
      title: it.title, assignee: it.assignee, due_date: it.due_date, sort_order: it.sort_order, status,
    });
    loadItems();
  };

  const removeItem = async (it: GroupListItem) => {
    await window.taskAPI.db.groupListItems.delete(it.id);
    loadItems();
  };

  const byStatus = (s: GroupListItem['status']) => items.filter(i => i.status === s);

  return (
    <div className="space-y-4">
      {/* 小组信息 + 同步操作 */}
      <div className="glass-panel p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-text-dim text-xs">分享码</span>
          <code className="px-2 py-1 rounded font-mono text-sm bg-neon-green/10 text-neon-green border border-neon-green/30 tracking-widest">
            {list.group_code}
          </code>
          <button onClick={copyCode} className="btn-ghost p-1.5" title="复制分享码"><Copy size={13} /></button>
        </div>
        <span className="text-xs text-text-dim">
          {list.last_synced_at ? `上次同步 ${dayjs(list.last_synced_at).format('MM-DD HH:mm')}` : '尚未同步'}
          {' · '}{items.length} 条 · 完成 {byStatus('done').length}
        </span>
        <div className="flex-1" />
        <div className="flex gap-2">
          <button onClick={pull} disabled={!!busy} className="btn-ghost px-3 py-1.5 text-xs font-mono disabled:opacity-50">
            <RefreshCw size={13} className={busy === 'pull' ? 'animate-spin' : ''} /> 拉取
          </button>
          <button onClick={publish} disabled={!!busy} className="btn-neon px-3 py-1.5 text-xs font-mono disabled:opacity-50">
            <CloudUpload size={13} /> {busy === 'publish' ? '发布中…' : '发布'}
          </button>
          <button onClick={leave} disabled={!!busy} className="btn-ghost px-3 py-1.5 text-xs font-mono text-neon-danger disabled:opacity-50">
            <LogOut size={13} /> 退出
          </button>
        </div>
      </div>

      {/* 三列看板 */}
      <div className="grid md:grid-cols-3 gap-4">
        {([
          ['todo', '待办', 'text-text-secondary', Circle],
          ['doing', '进行中', 'text-neon-yellow', CircleDot],
          ['done', '已完成', 'text-neon-green', CheckCircle2],
        ] as Array<[GroupListItem['status'], string, string, typeof Circle]>).map(([status, label, color, Icon]) => (
          <div key={status} className="glass-panel p-3 min-h-[200px]">
            <div className={clsx('flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider mb-3 px-1', color)}>
              <Icon size={13} /> {label}
              <span className="text-text-dim ml-auto">{byStatus(status).length}</span>
            </div>
            <div className="space-y-2">
              {byStatus(status).map(it => (
                <div
                  key={it.id}
                  className={clsx(
                    'group bg-ink-900/60 border rounded-md p-2.5 cursor-pointer hover:border-neon-green/40 transition-all',
                    status === 'done' ? 'border-neon-green/25 opacity-70' : 'border-neon-green/10'
                  )}
                  onClick={() => cycleStatus(it)}
                  title="点击切换状态"
                >
                  <div className={clsx('text-sm leading-snug break-all', status === 'done' ? 'line-through text-text-dim' : 'text-text-primary')}>
                    {it.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-text-dim">
                    {it.assignee && <span className="px-1 py-0.5 rounded bg-neon-green/10 text-neon-green border border-neon-green/20">@{it.assignee}</span>}
                    {it.due_date != null && (
                      <span className={clsx('inline-flex items-center gap-0.5', it.due_date < Date.now() && status !== 'done' && 'text-neon-danger')}>
                        <Calendar size={9} /> {dayjs(it.due_date).format('MM-DD')}
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeItem(it); }}
                      className="ml-auto opacity-0 group-hover:opacity-100 hover:text-neon-danger transition-opacity"
                      title="删除"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))}
              {byStatus(status).length === 0 && (
                <div className="text-center text-xs text-text-dim py-6">—</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => setShowAdd(true)} className="btn-neon px-4 py-2 text-sm font-mono">
        <Plus size={14} /> 添加条目
      </button>

      {showAdd && (
        <ItemForm
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadItems(); }}
          listId={list.id}
        />
      )}
    </div>
  );
}

// ══════════════════ 新建小组 ══════════════════
function CreateModal({ busy, onClose, onCreate }: {
  busy: boolean; onClose: () => void; onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Modal title="新建小组" onClose={onClose} width="max-w-sm">
      <div className="space-y-3">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onCreate(name.trim())}
          placeholder="小组名称（如：数据库课程设计组）"
          className="input-neon text-sm"
        />
        <div className="text-xs text-text-dim">
          创建后会得到一个分享码，发给组员即可加入同一份清单
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm font-mono">取消</button>
          <button onClick={() => onCreate(name.trim())} disabled={busy || !name.trim()} className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50">
            {busy ? 'CREATING…' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ══════════════════ 添加条目 ══════════════════
function ItemForm({ listId, onClose, onSaved }: {
  listId: number; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await window.taskAPI.db.groupListItems.create({
      list_id: listId,
      title: title.trim(),
      assignee: assignee.trim() || null,
      due_date: due ? dayjs(due).valueOf() : null,
      status: 'todo',
    });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title="添加清单条目" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-text-dim mb-1">内容</label>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="如：写需求分析文档第三章"
            className="input-neon text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-dim mb-1">负责人</label>
            <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="（可选）如 豆芽" className="input-neon text-sm" />
          </div>
          <div>
            <label className="block text-xs text-text-dim mb-1">截止日期</label>
            <input type="date" value={due} onChange={e => setDue(e.target.value)} className="input-neon text-sm" />
          </div>
        </div>
        <div className="text-xs text-text-dim">本地保存后点「发布」才会上传云端同步给组员</div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm font-mono">取消</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50">
            {saving ? 'SAVING…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
