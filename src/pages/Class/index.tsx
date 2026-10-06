/**
 * 班级列表页（P2P 班级 v1.2.7）
 * - 列出本机加入的所有班级
 * - 提供「创建班级」「加入班级」按钮
 * - 每张卡片显示班级名 / 成员数 / 我的角色 / 邀请码（owner 视角）
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Plus, LogIn, Copy, CheckCircle2, RefreshCw,
  Crown, Shield, User as UserIcon, Trash2, Settings as SettingsIcon,
} from 'lucide-react';
import Modal from '@/components/Modal';
import { toast } from '@/utils/toast';

export default function ClassListPage() {
  const nav = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [cfg, setCfg] = useState<any>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.taskAPI.class.list();
      if (r.ok) setList(r.classes);
    } catch (e) {
      toast.exception(e, '班级列表加载失败');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    refresh();
    window.taskAPI.class.config().then(setCfg);
  }, []);

  const leave = async (id: number) => {
    if (!confirm('确定离开此班级？云端数据不会删除，你仍可通过邀请码重新加入。')) return;
    await window.taskAPI.class.leave(id);
    refresh();
  };

  return (
    <div className="p-6 space-y-4">
      {/* 顶部操作区 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neon-green text-glow-green flex items-center gap-2">
            <Users size={22} />
            班级
          </h1>
          <p className="text-text-dim font-mono text-xs mt-1">
            班级数据实时同步到 SSIO 云服务器（GitHub 仓库作为备源）
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="btn-ghost text-xs px-3 py-2" title="刷新列表">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowConfig(true)} className="btn-ghost text-xs px-3 py-2" title="配置云盘/令牌">
            <SettingsIcon size={14} />
          </button>
          <button onClick={() => setShowJoin(true)} className="btn-ghost text-xs px-3 py-1.5">
            <LogIn size={14} /> 加入班级
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-neon text-xs px-3 py-1.5">
            <Plus size={14} /> 创建班级
          </button>
        </div>
      </div>

      {/* 班级列表 */}
      {loading ? (
        <div className="text-text-dim font-mono text-xs text-center py-8">加载中…</div>
      ) : list.length === 0 ? (
        <div className="glass-panel p-8 text-center">
          <Users size={32} className="mx-auto text-text-dim mb-2" />
          <div className="text-text-secondary font-mono text-sm mb-1">还没有加入任何班级</div>
          <div className="text-text-dim font-mono text-xs">
            {/* v1.2.13：SSIO 是内置主源，开箱即用，不需要先配令牌 —— 别再提示「先去配置 GitHub PAT」 */}
            点击右上角「<strong className="text-neon-green">创建班级</strong>」开始，或用邀请码「<strong className="text-neon-yellow">加入班级</strong>」
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((c: any) => (
            <ClassCard
              key={c.id}
              cls={c}
              onOpen={() => nav(`/class/${c.id}`)}
              onLeave={() => leave(c.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateClassModal
          cfg={cfg}
          onClose={() => setShowCreate(false)}
          onCreated={(c: any) => { refresh(); setShowCreate(false); nav(`/class/${c.id}`); }}
          onJumpToPay={() => nav('/settings', { state: { scrollTo: 'monthly' } })}
        />
      )}
      {showJoin && (
        <JoinClassModal
          cfg={cfg}
          onClose={() => setShowJoin(false)}
          onJoined={(c: any) => { refresh(); setShowJoin(false); nav(`/class/${c.id}`); }}
        />
      )}
      {showConfig && (
        <ClassConfigModal
          cfg={cfg}
          onClose={() => setShowConfig(false)}
          onSaved={(c: any) => { setCfg(c); setShowConfig(false); }}
        />
      )}
    </div>
  );
}

// ============================================================
// ClassCard
// ============================================================

function ClassCard({ cls, onOpen, onLeave }: { cls: any; onOpen: () => void; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const RoleIcon = cls.role === 'owner' ? Crown : cls.role === 'admin' ? Shield : UserIcon;
  const roleColor = cls.role === 'owner' ? 'text-neon-yellow' : cls.role === 'admin' ? 'text-neon-cyan' : 'text-text-secondary';
  const copyInvite = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(cls.inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className="glass-panel p-4 hover:border-neon-green/40 transition-all cursor-pointer group relative"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-text-primary text-base truncate" title={cls.name}>
            {cls.name}
          </div>
          {cls.description && (
            <div className="text-text-dim font-mono text-[11px] mt-0.5 line-clamp-1">
              {cls.description}
            </div>
          )}
        </div>
        <span className={`flex items-center gap-1 font-mono text-[11px] ml-2 ${roleColor}`}>
          <RoleIcon size={12} />
          {cls.role}
        </span>
      </div>

      <div className="flex items-center gap-3 text-text-dim font-mono text-[11px] mt-2">
        <span className="flex items-center gap-1">
          <Users size={11} /> {cls.memberCount}/{cls.maxMembers}
        </span>
        <span>·</span>
        <span>{cls.cloudSynced ? '🟢 已同步' : '🟡 本地'}</span>
        {cls.lastSyncedAt && (
          <>
            <span>·</span>
            <span>{dayAgo(cls.lastSyncedAt)}</span>
          </>
        )}
      </div>

      {cls.inviteCode && (
        <div className="mt-3 flex items-center gap-2 bg-ink-base/60 rounded px-2 py-1.5 border border-neon-green/10">
          <span className="font-mono text-xs text-neon-green select-all flex-1 truncate">
            {cls.inviteCode}
          </span>
          <button
            onClick={copyInvite}
            className="text-text-dim hover:text-neon-green p-1"
            title="复制邀请码"
          >
            {copied ? <CheckCircle2 size={12} className="text-neon-green" /> : <Copy size={12} />}
          </button>
        </div>
      )}

      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onLeave(); }}
          className="text-text-dim hover:text-red-400 p-1"
          title="离开班级"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function dayAgo(ts: number): string {
  const d = Math.floor((Date.now() - ts) / 86400_000);
  if (d === 0) return '今天同步';
  if (d === 1) return '昨天同步';
  if (d < 30) return `${d} 天前同步`;
  return new Date(ts).toISOString().slice(0, 10);
}

// ============================================================
// CreateClassModal
// ============================================================

function CreateClassModal({ cfg, onClose, onCreated, onJumpToPay }: any) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [alias, setAlias] = useState(cfg?.localAlias || '我');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [needPremium, setNeedPremium] = useState(false);

  const submit = async () => {
    if (!name.trim()) { setErr('请输入班级名称'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.create({ name: name.trim(), description: desc.trim(), alias: alias.trim() });
      if (r.ok) {
        setResult(r);
        setWarnings(r.warnings || []);
      } else if (r.errorCode === 'PREMIUM_REQUIRED') {
        // v1.2.7：创建要付费，弹付费引导
        setNeedPremium(true);
      } else {
        setErr(r.error || '创建失败');
      }
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  if (needPremium) {
    return (
      <Modal title="⭐ 创建班级需要月卡" onClose={() => { setNeedPremium(false); onClose(); }} footer={
        <>
          <button onClick={() => { setNeedPremium(false); onClose(); }} className="btn-ghost mr-auto">取消</button>
          <button
            onClick={() => { setNeedPremium(false); onClose(); if (onJumpToPay) onJumpToPay(); }}
            className="btn-neon text-xs"
          >
            去激活月卡
          </button>
        </>
      }>
        <div className="space-y-3">
          <div className="bg-gradient-to-br from-neon-yellow/10 to-neon-green/10 border border-neon-yellow/30 rounded-lg p-4">
            <div className="text-sm font-mono text-neon-yellow mb-2">
              🌟 创建班级是稀缺资源，需要月卡
            </div>
            <div className="text-xs font-mono text-text-secondary space-y-1">
              <div>· <strong className="text-text-primary">月卡用户</strong>：可创建多个班级，同学<strong>免费</strong>加入</div>
              <div>· <strong className="text-text-primary">免费用户</strong>：可加入任意班级，但<strong>不能创建</strong></div>
              <div>· 月卡 30 元/月，付款完全本地校验，无需联网</div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-text-dim bg-ink-900/50 rounded p-2 border border-neon-green/10">
            · 点「去激活月卡」会跳转到「设置 → 月卡与付费」
            <br />· 客服微信：<strong className="text-neon-green">NRSG-Power</strong>
            <br />· 激活后回到班级页面刷新即可继续创建
          </div>
        </div>
      </Modal>
    );
  }

  if (result) {
    return (
      <Modal title="✅ 班级已创建" onClose={() => onCreated(result)} footer={
        <button onClick={() => onCreated(result)} className="btn-neon text-xs">进入班级</button>
      }>
        <div className="space-y-3">
          <div className="bg-gradient-to-br from-neon-green/10 to-neon-yellow/10 border border-neon-green/30 rounded-lg p-4">
            <div className="text-[11px] font-mono text-text-dim mb-1">邀请码（发给同学加入用）</div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold font-mono text-neon-green tracking-wider select-all flex-1">
                {result.inviteCode}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(result.inviteCode)}
                className="btn-ghost text-xs px-2 py-1"
              >
                <Copy size={12} /> 复制
              </button>
            </div>
          </div>
          {warnings.length > 0 && (
            <div className="bg-neon-yellow/10 border border-neon-yellow/30 rounded p-3 text-xs font-mono">
              <div className="text-neon-yellow mb-1">⚠ 警告：</div>
              <ul className="list-disc list-inside space-y-1 text-text-secondary">
                {warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div className="text-[11px] font-mono text-text-dim">
            · 把邀请码发给同学 → 他们在「加入班级」里粘贴即可
            <br />· owner_token 仅在本机保存，不要外传
            <br />· 你发布的公告/作业会实时同步到 SSIO 云服务器（同学无需同网）
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="创建班级" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '创建中…' : '创建'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">班级名称 *</span>
          <input
            value={name} onChange={(e) => setName(e.target.value)}
            className="input-neon" placeholder="如：计科 21-1 班 / 高数同步小组"
            autoFocus maxLength={50}
          />
        </div>
        <div>
          <span className="label-tag block mb-1">班级简介</span>
          <input
            value={desc} onChange={(e) => setDesc(e.target.value)}
            className="input-neon" placeholder="可选 · 50 字以内"
            maxLength={50}
          />
        </div>
        <div>
          <span className="label-tag block mb-1">你在班级的昵称 *</span>
          <input
            value={alias} onChange={(e) => setAlias(e.target.value)}
            className="input-neon" placeholder="如：豆芽 / 学号 / 昵称"
            maxLength={20}
          />
          <div className="text-[10px] font-mono text-text-dim mt-1">
            其他同学看到这个昵称。修改后只影响本机显示，不会改云端 owner 记录
          </div>
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
        {/* v1.2.13：删掉「没配 GitHub PAT 就只存本机」的警告 —— SSIO 内置主源永远可写，
            这条警告在 SSIO 时代是纯误导（配不配令牌同学都能看到） */}
      </div>
    </Modal>
  );
}

// ============================================================
// JoinClassModal
// ============================================================

function JoinClassModal({ cfg, onClose, onJoined }: any) {
  const [invite, setInvite] = useState('');
  const [alias, setAlias] = useState(cfg?.localAlias || '我');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!invite.trim()) { setErr('请输入邀请码'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await window.taskAPI.class.join({ inviteCode: invite.trim(), alias: alias.trim() });
      if (r.ok) {
        onJoined(r);
      } else {
        setErr(r.error || '加入失败');
      }
    } catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="加入班级" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">取消</button>
        <button onClick={submit} disabled={busy} className="btn-neon text-xs">{busy ? '拉取中…' : '加入'}</button>
      </>
    }>
      <div className="space-y-3 text-left">
        <div>
          <span className="label-tag block mb-1">邀请码 *</span>
          <input
            value={invite} onChange={(e) => setInvite(e.target.value.toUpperCase())}
            className="input-neon font-mono tracking-widest text-lg"
            placeholder="12 位字符"
            autoFocus maxLength={14}
          />
          <div className="text-[10px] font-mono text-text-dim mt-1">
            形如 <code className="text-neon-green">ABCD-EFGH-JKLM</code>，owner 会发给你
          </div>
        </div>
        <div>
          <span className="label-tag block mb-1">你在班级的昵称 *</span>
          <input
            value={alias} onChange={(e) => setAlias(e.target.value)}
            className="input-neon" placeholder="如：豆芽 / 学号 / 昵称"
            maxLength={20}
          />
        </div>
        {err && <div className="text-red-400 font-mono text-xs">❌ {err}</div>}
      </div>
    </Modal>
  );
}

// ============================================================
// ClassConfigModal
// ============================================================

function ClassConfigModal({ cfg, onClose, onSaved }: any) {
  // v1.2.15：后端只剩 SSIO —— GitHub 令牌 / 云盘外链的配置项随通道一起下线，
  // 弹窗里只剩昵称。cfg 参数保留（调用方还在传），多余字段自然被忽略。
  const [alias, setAlias] = useState(cfg?.localAlias || '我');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await window.taskAPI.class.saveLocalAlias(alias.trim());
      const newCfg = await window.taskAPI.class.config();
      onSaved(newCfg);
    } catch (e: any) {
      setMsg(e?.message || '保存失败');
    } finally { setBusy(false); }
  };

  return (
    <Modal title="班级配置" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-ghost mr-auto">关闭</button>
        <button onClick={save} disabled={busy} className="btn-neon text-xs">{busy ? '保存中…' : '保存'}</button>
      </>
    }>
      <div className="space-y-4 text-left">
        {/* v1.2.15：后端只剩 SSIO —— 令牌/云盘配置区随通道下线 */}
        <div className="border border-neon-green/15 rounded p-3">
          <div className="font-mono text-xs text-neon-green mb-2">☁️ SSIO 云同步（唯一后端 · 已启用）</div>
          <div className="bg-neon-green/10 border border-neon-green/30 rounded p-2 text-[11px] font-mono text-neon-green">
            ✅ 班级数据全部读写 SSIO 云服务器（强一致、国内外可达），无需任何配置
          </div>
        </div>

        {/* 本机昵称 */}
        <div className="border border-neon-green/15 rounded p-3">
          <div className="font-mono text-xs text-neon-green mb-2">👤 本机默认昵称</div>
          <input
            value={alias} onChange={(e) => setAlias(e.target.value)}
            className="input-neon text-xs" placeholder="如：豆芽 / 学号 / 昵称"
            maxLength={20}
          />
          <div className="text-[10px] font-mono text-text-dim mt-1">
            用于创建/加入班级时的默认 alias
          </div>
        </div>

        {msg && <div className="text-red-400 font-mono text-xs">❌ {msg}</div>}
      </div>
    </Modal>
  );
}