/**
 * v1.2.8 块 K：NotesTab — 课程笔记列表 + 新建 + 删除
 */
import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import dayjs from 'dayjs';
import type { Course, CourseNote } from '@/types';

interface Props { course: Course }

export function NotesTab({ course }: Props) {
  const [list, setList] = useState<CourseNote[]>([]);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const load = async () => {
    const rows = await window.taskAPI.db.courseNotes.list(course.id);
    setList(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => {
    if (course?.id) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  const create = async () => {
    if (!content.trim()) return;
    await window.taskAPI.db.courseNotes.create({ course_id: course.id, content: content.trim() });
    setContent('');
    await load();
  };

  const remove = async (id: number) => {
    if (!confirm('删除这条笔记？')) return;
    await window.taskAPI.db.courseNotes.delete(id);
    await load();
  };

  const saveEdit = async () => {
    if (editing == null) return;
    await window.taskAPI.db.courseNotes.update(editing, { content: editContent });
    setEditing(null);
    setEditContent('');
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="rounded border border-neon-green/15 bg-ink-900/40 p-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="把今天课堂要点记下来..."
          className="input-neon w-full"
          rows={3}
        />
        <div className="flex justify-end mt-2">
          <button onClick={create} className="btn-neon px-3 py-1.5 text-xs flex items-center gap-1">
            <Plus size={12} /> 新建笔记
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="p-3 rounded-md bg-ink-900/40 border border-neon-green/15 text-xs font-mono text-text-dim text-center">
          这门课还没有笔记，记第一条吧。
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((n) => (
            <div key={n.id} className="rounded border border-neon-green/10 bg-ink-900/30 p-3 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-text-dim">
                <span>{dayjs(n.created_at).format('YYYY-MM-DD HH:mm')}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setEditing(n.id); setEditContent(n.content); }}
                    className="p-1 rounded hover:bg-ink-900/60 text-text-secondary"
                    title="编辑"
                  >✎</button>
                  <button
                    onClick={() => remove(n.id)}
                    className="p-1 rounded hover:bg-neon-danger/10 text-neon-danger"
                    title="删除"
                    aria-label="删除笔记"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              {editing === n.id ? (
                <>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="input-neon w-full"
                    rows={3}
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setEditing(null); setEditContent(''); }} className="btn-ghost text-xs">取消</button>
                    <button onClick={saveEdit} className="btn-neon text-xs">保存</button>
                  </div>
                </>
              ) : (
                <pre className="text-xs text-text-primary whitespace-pre-wrap font-sans">{n.content}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}