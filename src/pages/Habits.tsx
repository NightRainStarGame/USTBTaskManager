/**
 * v1.2.3 习惯打卡：长期追踪 + 连击统计 + 近 8 周热力图。
 */
import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import clsx from '../utils/clsx';
import Modal from '../components/Modal';
import { useStore } from '@/store';
import type { Habit } from '@/types';
import { Flame, Plus, Pencil, Trash2, Check, RotateCcw } from 'lucide-react';

const EMOJIS = ['🔥', '📚', '🏃', '💧', '🧘', '🌅', '💪', '🎯', '✍️', '🥗', '😴', '🎸'];
const COLORS = ['#00FF88', '#FFC53D', '#5B8DEF', '#FF6B81', '#B57BFF', '#3DD6C3'];

/** 连击：从今天（未打则从昨天）往前数连续打卡天数 */
function calcStreak(dates: Set<string>): number {
  const today = dayjs().format('YYYY-MM-DD');
  let cursor = dates.has(today) ? dayjs() : dayjs().subtract(1, 'day');
  // 今天没打且昨天也没打 → 连击 0
  if (!dates.has(cursor.format('YYYY-MM-DD'))) return 0;
  let streak = 0;
  while (dates.has(cursor.format('YYYY-MM-DD'))) {
    streak++;
    cursor = cursor.subtract(1, 'day');
  }
  return streak;
}

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);
  const today = dayjs().format('YYYY-MM-DD');
  const todayObj = dayjs();

  const load = async () => setHabits(await window.taskAPI.db.habits.list());
  useEffect(() => { load(); }, []);

  const toggle = async (habitId: number) => {
    await window.taskAPI.db.habits.toggleCheckin(habitId, today);
    load();
  };

  const todayDone = habits.filter(h => h.checkinDates.includes(today)).length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Flame className="text-neon-green" size={24} />
            习惯 <span className="font-mono text-xs text-text-dim">HABITS</span>
          </h1>
          <p className="text-sm text-text-dim mt-1">
            今天 {todayDone}/{habits.length} 个习惯 · {todayObj.format('YYYY-MM-DD dddd')}
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-neon px-3 py-2 text-xs font-mono flex items-center gap-1.5">
          <Plus size={14} /> 新建习惯
        </button>
      </header>

      {/* 今日打卡总览条 */}
      {habits.length > 0 && (
        <div className="glass-panel p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="label-tag">今日进度</p>
            <span className="font-mono text-xs text-text-dim">{todayDone}/{habits.length}</span>
          </div>
          <div className="h-2 bg-ink-900/70 rounded-full overflow-hidden border border-neon-green/10">
            <div
              className="h-full bg-gradient-to-r from-neon-green/60 to-neon-green transition-all"
              style={{ width: `${habits.length ? (todayDone / habits.length) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* 习惯卡片 */}
      {habits.length === 0 ? (
        <div className="glass-panel p-12 text-center text-text-dim space-y-2">
          <Flame size={32} className="mx-auto text-neon-green/30" />
          <p className="text-sm">还没有习惯 —— 早起、背单词、健身，从一个小火苗开始 🔥</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {habits.map(h => (
            <HabitCard key={h.id} habit={h} today={today} onToggle={() => toggle(h.id)} onEdit={() => setEditing(h)} onDelete={async () => { await window.taskAPI.db.habits.delete(h.id); load(); }} />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <HabitForm
          habit={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function HabitCard({ habit, today, onToggle, onEdit, onDelete }: {
  habit: Habit; today: string; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const dates = useMemo(() => new Set(habit.checkinDates), [habit.checkinDates]);
  const streak = calcStreak(dates);
  const checkedToday = dates.has(today);

  // 本周次数
  const weekStart = dayjs().startOf('week');
  const thisWeek = habit.checkinDates.filter(d => dayjs(d).isAfter(weekStart)).length;
  const weeklyTarget = habit.frequency === 'weekly' ? (habit.target_per_week || 7) : null;

  // 近 8 周热力格
  const weeks = 8;
  const cells = useMemo(() => {
    const out: Array<{ date: string; on: boolean }> = [];
    const end = dayjs().endOf('week');
    for (let w = weeks - 1; w >= 0; w--) {
      for (let d = 0; d < 7; d++) {
        const day = end.subtract(w, 'week').startOf('week').add(d, 'day');
        if (day.isAfter(dayjs(), 'day')) continue;
        const ds = day.format('YYYY-MM-DD');
        out.push({ date: ds, on: dates.has(ds) });
      }
    }
    return out;
  }, [dates]);

  return (
    <div className="glass-panel p-4 space-y-3 group">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-2xl shrink-0" role="img" aria-label={habit.name}>{habit.emoji}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">{habit.name}</div>
            <div className="font-mono text-[10px] text-text-dim">
              {habit.frequency === 'daily' ? '每天' : `每周 ${habit.target_per_week || '?'} 次`}
              {weeklyTarget != null && ` · 本周 ${thisWeek}/${weeklyTarget}`}
            </div>
          </div>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil size={12} /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 text-neon-danger"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* 连击 */}
      <div className="flex items-center gap-3">
        <div className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono text-xs',
          streak > 0 ? 'text-neon-yellow border-neon-yellow/40 bg-neon-yellow/5' : 'text-text-dim border-neon-green/10'
        )}>
          <Flame size={12} /> 连击 {streak} 天
        </div>
        <span className="font-mono text-[10px] text-text-dim">累计 {habit.checkinDates.length} 次</span>
      </div>

      {/* 热力格 */}
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
        {cells.map(c => (
          <div
            key={c.date}
            title={c.date}
            className="w-2 h-2 rounded-[2px]"
            style={{ background: c.on ? habit.color : 'rgba(255,255,255,0.05)' }}
          />
        ))}
      </div>

      {/* 打卡按钮 */}
      <button
        onClick={onToggle}
        className={clsx(
          'w-full py-2 rounded font-mono text-xs flex items-center justify-center gap-1.5 transition-all border',
          checkedToday
            ? 'text-ink-base border-transparent'
            : 'text-neon-green border-neon-green/30 bg-neon-green/5 hover:bg-neon-green/10'
        )}
        style={checkedToday ? { background: habit.color } : undefined}
      >
        {checkedToday ? <><Check size={13} /> 今日已打卡</> : <><RotateCcw size={13} /> 打卡</>}
      </button>
    </div>
  );
}

function HabitForm({ habit, onClose, onSaved }: { habit: Habit | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: habit?.name ?? '',
    emoji: habit?.emoji ?? '🔥',
    color: habit?.color ?? '#00FF88',
    frequency: habit?.frequency ?? 'daily',
    target_per_week: habit?.target_per_week ?? 5,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const data = {
      ...form,
      name: form.name.trim(),
      target_per_week: form.frequency === 'weekly' ? Number(form.target_per_week) || 5 : null,
    };
    if (habit) await window.taskAPI.db.habits.update(habit.id, { ...habit, ...data });
    else await window.taskAPI.db.habits.create(data);
    setSaving(false);
    onSaved();
  };

  return (
    <Modal title={habit ? '编辑习惯' : '新建习惯'} onClose={onClose} width="max-w-md">
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="label-tag">名称</div>
          <input
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && form.name.trim()) submit(); }}
            className="input-neon text-sm" placeholder="早起 / 背单词 / 健身…" autoFocus
          />
        </div>
        <div className="space-y-1">
          <div className="label-tag">图标</div>
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setForm({ ...form, emoji: e })}
                className={clsx('w-9 h-9 rounded text-lg border', form.emoji === e ? 'border-neon-green bg-neon-green/10' : 'border-neon-green/10 hover:border-neon-green/30')}
              >{e}</button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="label-tag">颜色</div>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={clsx('w-7 h-7 rounded-full border-2', form.color === c ? 'border-white' : 'border-transparent')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="label-tag">频率</div>
          <div className="flex gap-2">
            <button
              onClick={() => setForm({ ...form, frequency: 'daily' })}
              className={clsx('px-3 py-1.5 rounded text-xs font-mono border', form.frequency === 'daily' ? 'text-neon-green border-neon-green/40 bg-neon-green/5' : 'text-text-secondary border-neon-green/10')}
            >每天</button>
            <button
              onClick={() => setForm({ ...form, frequency: 'weekly' })}
              className={clsx('px-3 py-1.5 rounded text-xs font-mono border', form.frequency === 'weekly' ? 'text-neon-green border-neon-green/40 bg-neon-green/5' : 'text-text-secondary border-neon-green/10')}
            >每周几次</button>
            {form.frequency === 'weekly' && (
              <select
                value={form.target_per_week}
                onChange={e => setForm({ ...form, target_per_week: Number(e.target.value) })}
                className="input-neon text-xs py-1.5 w-20"
              >
                {[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n}次</option>)}
              </select>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm font-mono">取消</button>
          <button onClick={submit} disabled={saving || !form.name.trim()} className="btn-neon px-4 py-2 text-sm font-mono disabled:opacity-50">
            {saving ? 'SAVING…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
