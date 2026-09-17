(async () => {
  const api = window.taskAPI.db;
  const out = [];
  const t = (tag, fn) => fn().then(() => out.push(tag)).catch((e) => out.push(tag + ':ERR:' + e.message));
  await t('c1', () => api.courses.create({ name: '高等数学A(二)', code: 'MATH-102', instructor: '王教授', semester: '2025-2026-2', color: '#00FF88', description: '微积分与级数' }));
  await t('c2', () => api.courses.create({ name: '数据结构与算法', code: 'CS-202', instructor: '李教授', semester: '2025-2026-2', color: '#00E5FF', description: '链表/树/图' }));
  await t('c3', () => api.courses.create({ name: '大学英语(四)', code: 'ENG-104', instructor: '赵老师', semester: '2025-2026-2', color: '#FFB800', description: '学术英语写作' }));
  const cs = await api.courses.list();
  const c1 = cs.find((c) => c.code === 'MATH-102');
  const c2 = cs.find((c) => c.code === 'CS-202');
  const day = 86400000;
  const base = Date.now();
  await t('e1', () => api.events.create({ title: '高等数学A(二)', start_at: base + day, end_at: base + day + 7200000, location: '逸夫楼 201', recurrence: 'WEEKLY', type: 'class', course_id: c1 && c1.id, color: '#00FF88' }));
  await t('e2', () => api.events.create({ title: '数据结构与算法', start_at: base + 2 * day, end_at: base + 2 * day + 7200000, location: '机电楼 305', recurrence: 'WEEKLY', type: 'class', course_id: c2 && c2.id, color: '#00E5FF' }));
  await t('e3', () => api.events.create({ title: '期中考试·数据结构', start_at: base + 9 * day, end_at: base + 9 * day + 5400000, location: '教学楼 B101', type: 'exam', course_id: c2 && c2.id, color: '#FF6B6B' }));
  await t('p1', () => api.projects.create({ name: '数据库课程设计', description: '图书管理系统', status: 'active', start_date: base, due_date: base + 30 * day, progress: 35 }));
  const ps = await api.projects.list();
  const p = ps[0];
  if (p) {
    await t('t1', () => api.tasks.create({ project_id: p.id, title: '需求分析与ER图', status: 'done', due_date: base + 7 * day }));
    await t('t2', () => api.tasks.create({ project_id: p.id, title: '建表与SQL脚本', status: 'doing', due_date: base + 14 * day }));
    await t('t3', () => api.tasks.create({ project_id: p.id, title: '前端界面开发', status: 'todo', due_date: base + 25 * day }));
  }
  if (c1) await t('r1', () => api.requirements.create({ course_id: c1.id, title: '第3章习题', type: 'homework', due_date: base + 3 * day, priority: 3, status: 'pending' }));
  if (c2) await t('r2', () => api.requirements.create({ course_id: c2.id, title: '实验报告·二叉树', type: 'homework', due_date: base + 5 * day, priority: 2, status: 'pending' }));
  return out.join(' | ');
})().then(String).catch(String)
