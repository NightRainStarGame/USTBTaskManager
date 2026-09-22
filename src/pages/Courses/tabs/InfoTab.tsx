/**
 * v1.2.8 块 K：InfoTab — 课程信息编辑 + 顶部作业概览
 */
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { Course } from '@/types';
import { Field } from '../Field';
import { parseTags, TAG_PRESETS, type DrawerTab } from '../constants';
import { CourseHomeworkOverview } from '../CourseHomeworkOverview';

interface Props {
  course: Course | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onGoTab: (tab: DrawerTab) => void;
}

export function InfoTab({ course, onSaved, onClose, onGoTab }: Props) {
  const [name, setName] = useState(course?.name || '');
  const [code, setCode] = useState(course?.code || '');
  const [instructor, setInstructor] = useState(course?.instructor || '');
  const [semester, setSemester] = useState(course?.semester || '2026-Fall');
  const [color, setColor] = useState(course?.color || '#00FF88');
  const [description, setDescription] = useState(course?.description || '');
  const [tags, setTags] = useState<string[]>(parseTags(course?.tags));
  const [tagInput, setTagInput] = useState('');

  const addTag = (t: string) => {
    const v = t.trim();
    if (v && !tags.includes(v)) setTags([...tags, v]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const submit = async () => {
    const payload = { name, code, instructor, semester, color, description, tags };
    if (course?.id) await window.taskAPI.db.courses.update(course.id, payload);
    else await window.taskAPI.db.courses.create(payload);
    await onSaved();
    onClose();
  };

  return (
    <div className="space-y-4">
      {course?.id && <CourseHomeworkOverview course={course} onGoTab={onGoTab} />}

      <Field label="课程名称 *">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input-neon" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="课程编号">
          <input value={code} onChange={(e) => setCode(e.target.value)} className="input-neon" />
        </Field>
        <Field label="授课老师">
          <input value={instructor} onChange={(e) => setInstructor(e.target.value)} className="input-neon" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="学期">
          <input value={semester} onChange={(e) => setSemester(e.target.value)} className="input-neon" />
        </Field>
        <Field label="主题色">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="input-neon h-10 p-1" />
        </Field>
      </div>
      <Field label="描述">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="input-neon" />
      </Field>
      <div>
        <span className="label-tag block mb-2">标签</span>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-neon-green/40 text-neon-green">
              {t} <button onClick={() => removeTag(t)} className="hover:text-neon-danger"><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mb-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag(tagInput)}
            placeholder="输入标签回车"
            className="input-neon flex-1"
          />
          <button onClick={() => addTag(tagInput)} className="btn-neon px-3"><Plus size={14} /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TAG_PRESETS.map((t) => (
            <button
              key={t}
              onClick={() => addTag(t)}
              className="px-2 py-1 rounded text-[10px] border border-text-dim/30 text-text-secondary hover:border-neon-green hover:text-neon-green"
            >+ {t}</button>
          ))}
        </div>
      </div>
      <div className="pt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">取消</button>
        <button onClick={submit} className="btn-neon">保存课程</button>
      </div>
    </div>
  );
}