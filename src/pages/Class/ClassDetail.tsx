/**
 * 班级详情页（P2P 班级 v1.2.7）
 * - tab 切换：公告 / 作业 / 成员
 * - owner 视角：发布按钮 + 同步按钮
 * - 拉取最新（GitHub 优先 → AnyShare 兜底）
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Megaphone, ListTodo, Users, RefreshCw, Plus,
  CheckCircle2, Circle, Clock, Crown, Shield, User as UserIcon,
} from 'lucide-react';
import Modal from '@/components/Modal';

type Tab = 'announcements' | 'tasks' | 'members';

export default function ClassDetailPage() {
  const { id } = useParams();
  const classId = Number(id);
  const nav = useNavigate();
  const [info, setInfo] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('announcements');
  const [anns, setAnns] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showPublishAnn, setShowAnn] = useState(false);
  const [showPublishTask, setShowTask] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r1 = await window.taskAPI.class.info(classId);
      if (r1.ok) setInfo(r1);
      const r2 = await window.taskAPI.class.listAnnouncements(classId);
      if (r2.ok) setAnns(r2.announcements);
      const r3 = await window.taskAPI.class.listTasks(classId);
      if (r3.ok) setTasks(r3.tasks);
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [classId]);

  const sync = async () => {
    setSyncing(true); setMsg(null);
    try {
      const r = await window.taskAPI.class.sync(classId);
      if (r.ok) {
        setMsg(`✅ 同步完成 · ${r.source || 'github'} · 新增 ${r.newAnnouncements || 0} 条公告 / ${r.newTasks || 0} 条作业`);
        await refresh();
      } else {
        setMsg(`❌ 同步失败：${r.error}`);
      }
    } catch (e: any) { setMsg(`❌ 同步异常：${e?.message || e}`); }
    finally { setSyncing(false); }
  };

  const markRead = async (annId: number) => {
    await window.taskAPI.class.markAnnouncementRead(classId, annId);
    refresh();
  };

  const completeTask = async (taskId: number, status: 'open' | 'done' | 'cancelled') => {
    await window.taskAPI.class.completeTask(classId, taskId, status);
    refresh();
  };

  if (!info) {
    return (
      <div className="p-6">
        <button onClick={() => nav('/class')} className="btn-ghost text-xs mb-4">
          <ArrowLeft size={14} /> 返回班级列表
        </button>
        <div className="text-text-dim font-mono text-xs text-center py-8">{loading ? '加载中…' : '班级不存在'}</div>
      </div>
    );
  }

  const isOwner = info.role === 'owner';

  return (
    <div className="p-6 space-y-4">
      {/* 顶部 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/class" className="text-text-dim hover:text-neon-green font-mono text-xs flex items-center gap-1 mb-2">
            <ArrowLeft size={12} /> 返回班级列表
          </Link>
          <h1 className="text-2xl font-bold text-neon-green text-glow-green">{info.name}</h1>
          {info.description && (
            <p className="text-text-dim font-mono text-xs mt-1">{info.description}</p>
          )}
          <div className="flex items-center gap-3 text-text-dim font-mono text-[11px] mt-2">
            <span>{info.memberCount}/{info.maxMembers} 成员</span>
            <span>·</span>
            <span>我：<strong className="text-neon-green">{info.myAlias}</strong></span>
            <span>·</span>
            <span className={isOwner ? 'text-neon-yellow' : 'text-text-secondary'}>{info.role}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} disabled={syncing} className="btn-ghost text-xs px-3 py-2">
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            同步
          </button>
          {isOwner && (
            <>
              <button onClick={() => setShowAnn(true)} className="btn-ghost text-xs px-3 py-1.5">
                <Plus size={14} /> 公告
              </button>
              <button onClick={() => setShowTask(true)} className="btn-neon text-xs px-3 py-1.5">
                <Plus size={14} /> 作业
              </button>
            </>
          )}
        </div>
      </div>

      {msg && (
        <div className="bg-ink-base/60 border border-neon-green/20 rounded p-2 text-xs font-mono">
          {msg}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-1 border-b border-neon-green/15">
        <TabButton active={tab === 'announcements'} onClick={() => setTab('announcements')} icon={<Megaphone size={14} />} label="公告" badge={anns.filter(a => !a.isRead).length} />
        <TabButton active={tab === 'tasks'} onClick={() => setTab('tasks')} icon={<ListTodo size={14} />} label="作业" badge={tasks.filter(t => t.status === 'open').length} />
        <TabButton active={tab === 'members'} onClick={() => setTab('members')} icon={<Users size={14} />} label="成员" badge={info.memberCount} />
      </div>

      {/* Tab 内容 */}
      {tab === 'announcements' && (
        <div className="space-y-2">
          {loading ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">加载中…</div>
          ) : anns.length === 0 ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">还没有公告</div>
          ) : anns.map((a: any) => (
            <div
              key={a.id}
              className={`glass-panel p-4 cursor-pointer ${a.isRead ? 'opacity-70' : 'border-neon-green/40'}`}
              onClick={() => !a.isRead && markRead(a.id)}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  {a.isRead ? <Circle size={12} className="text-text-dim" /> : <CheckCircle2 size={12} className="text-neon-green" />}
                  <span className={`font-bold ${a.isRead ? 'text-text-primary' : 'text-neon-green'}`}>{a.title}</span>
                  {a.pinned && <span className="text-[10px] text-neon-yellow">📌 置顶</span>}
                </div>
                <span className="text-text-dim font-mono text-[10px]">
                  {new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </div>
              <div className="text-text-secondary text-sm whitespace-pre-wrap ml-5">{a.body}</div>
              <div className="text-text-dim font-mono text-[10px] mt-1 ml-5">—— {a.authorAlias}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="space-y-2">
          {loading ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">加载中…</div>
          ) : tasks.length === 0 ? (
            <div className="text-text-dim font-mono text-xs text-center py-4">还没有作业</div>
          ) : tasks.map((t: any) => (
            <div key={t.id} className={`glass-panel p-4 ${t.status === 'done' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  {t.status === 'done' ? <CheckCircle2 size={14} className="text-neon-green" /> : t.status === 'cancelled' ? <Circle size={14} className="text-text-dim line-through" /> : <Clock size={14} className="text-neon-yellow" />}
                  <span className={`font-bold ${t.status === 'done' ? 'line-through text-text-secondary' : 'text-text-primary'}`}>{t.title}</span>
                </div>
                {t.dueAt && (
                  <span className="text-text-dim font-mono text-[10px]">
                    截止 {new Date(t.dueAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                )}
              </div>
              {t.body && <div className="text-text-secondary text-sm whitespace-pre-wrap ml-6">{t.body}</div>}
              <div className="flex items-center justify-between mt-2 ml-6">
                <span className="text-text-dim font-mono text-[10px]">—— {new Date(t.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
                <div className="flex gap-1">
                  {t.status !== 'done' && (
                    <button onClick={() => completeTask(t.id, 'done')} className="btn-ghost text-[10px] px-2 py-0.5">
                      ✓ 完成
                    </button>
                  )}
                  {t.status === 'done' && (
                    <button onClick={() => completeTask(t.id, 'open')} className="btn-ghost text-[10px] px-2 py-0.5">
                      ↻ 重新打开
                    </button>
                  )}
                  {t.status !== 'cancelled' && (
                    <button onClick={() => completeTask(t.id, 'cancelled')} className="btn-ghost text-[10px] px-2 py-0.5 text-text-dim">
                      ✕ 取消
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'members' && (
        <div className="glass-panel p-4 space-y-1">
          {(info.members || []).map((m: any, i: number) => {
            const Icon = m.role === 'owner' ? Crown : m.role === 'admin' ? Shield : UserIcon;
            const color = m.role === 'owner' ? 'text-neon-yellow' : m.role === 'admin' ? 'text-neon-cyan' : 'text-text-secondary';
            return (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-neon-green/5 last:border-b-0">
                <Icon size={14} className={color} />
                <span className={`font-mono text-sm ${color}`}>{m.alias}</span>
                <span className="text-text-dim font-mono text-[11px]">{m.role}</span>
                <span className="text-text-dim font-mono text-[10px] ml-auto">
                  加入于 {new Date(m.joinedAt).toISOString().slice(0, 10)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 发布 modal */}
      {showPublishAnn && (
        <PublishAnnouncementModal classId={classId} classCode={info.classCode} onClose={() => setShowAnn(false)} onPublished={() => { setShowAnn(false); refresh(); }} />
      )}
      {showPublishTask && (
        <PublishTaskModal classId={classId} classCode={info.classCode} onClose={() => setShowTask(false)} onPublished={() => { setShowTask(false); refresh(); }} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label, badge }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 font-mono text-xs flex items-center gap-2 border-b-2 transition-colors ${
        active ? 'border-neon-green text-neon-green' : 'border-transparent text-text-dim hover:text-text-secondary'
      }`}
    >
      {icon} {label}
      {badge > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-neon-green/20' : 'bg-neon-green/10'}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================
// 发布公告
// ============================================================

function PublishAnnouncementModal({ classId, classCode, onClose, onPublished }: any) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = async () => {
    if (!title.trim()) { setErr('请输入标题'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.publishAnnouncement(classId, { title: title.trim(), body: body.trim() });
      if (r.ok) { setWarnings(r.warnings || []); onPublished(); }
      else setErr(r.error || '发布失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="发布公告" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '发布中…' : '发布'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" autoFocus maxLength={80} />
        </div>
        <div>
          <span className="label-tag block mb-1">正文</span>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            className="input-neon min-h-[160px] resize-y"
            maxLength={4000}
          />
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
        {warnings.length > 0 && (
          <div className="bg-neon-yellow/10 border border-neon-yellow/30 rounded p-2 text-xs font-mono">
            <div className="text-neon-yellow mb-1">⚠ 部分源发布失败：</div>
            <ul className="list-disc list-inside space-y-1 text-text-secondary">
              {warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PublishTaskModal({ classId, classCode, onClose, onPublished }: any) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = async () => {
    if (!title.trim()) { setErr('请输入标题'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.publishTask(classId, {
        title: title.trim(),
        body: body.trim(),
        dueAt: dueAt ? new Date(dueAt).getTime() : undefined,
      });
      if (r.ok) { setWarnings(r.warnings || []); onPublished(); }
      else setErr(r.error || '发布失败');
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="发布作业" onClose={onClose} footer={(
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '发布中…' : '发布'}</button>
      </>
    )}>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">标题 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-neon" autoFocus maxLength={80} />
        </div>
        <div>
          <span className="label-tag block mb-1">截止时间（可选）</span>
          <input
            type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
            className="input-neon font-mono text-xs"
          />
        </div>
        <div>
          <span className="label-tag block mb-1">作业说明</span>
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)}
            className="input-neon min-h-[120px] resize-y"
            maxLength={4000}
          />
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
      </div>
    </Modal>
  );
}