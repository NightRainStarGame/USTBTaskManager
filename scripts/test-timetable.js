#!/usr/bin/env node
/**
 * test-timetable.js —— 课表导入解析器的单元测试（无 Electron、无新依赖）
 *
 * 跑法：npm run test:timetable（会先 tsc -p tsconfig.node.json）
 *
 * 为什么要有这个：课表解析以前埋在 electron/timetable-xls/index.ts 里，唯一的验证方式是
 * 「跑起 App → 导入 → 看课表对不对」。而这类解析天生是**静默出错**的：少解析一格、
 * 周次少一段，页面都不报错，只是课程凭空少几节 —— 没人会发现。
 *
 * fixture 复刻的是真实样本（齐鲁理工 2026级医学影像技术3班）里**每一个坑**：
 *   ① 一格里多门课，且上一门课的「选课人数」粘着下一门课的课程名
 *   ② 周次写成「6周,14-16周」（中间隔了个「周」，直接丢给通用周次解析会被截断）
 *   ③ 单周课「9-13周(单)」
 *   ④ 表尾有「本学期…正式上课至…结束，共16周」和「实践课程/其他课程」两行
 *   ⑤ 表头行上方有合并的标题行（学年学期/班级/专业）
 *
 * 加新学校档案时，把它的真实坑也做成一条用例 —— 这个文件就是「各校格式的说明书」。
 */
const XLSX = require('xlsx');
const path = require('path');
const { detectProfile, getProfile, listProfiles } = require('../dist-electron/timetable-xls/profiles');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `   → ${extra}` : ''}`); }
}

/** 复刻齐鲁理工导出格式的格子表（列：节次标签 | 大节 | 星期一…星期日） */
function qiluFixture() {
  return [
    ['2026-2027年第1学期', '2026-2027年第1学期', '2026级医学影像技术3班课表', '', '', '专业：医学影像技术'],
    ['节次', '', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
    // 大节一：一格两门课（人数粘着下一门课名），周五一格三门
    ['上午', '一',
      '医学影像技术专业导论/22093413/(1-2节)9-16周/ JA210/崔志洁/(2026-2027-1)-22093413-01/2026级1班;2班/94',
      '中华民族共同体概论/22223005/(1-2节)5-8周/ JA202/周文利/TB/1班;2班/93 系统解剖学/22093414/(1-2节)9-16周/ JB508/唐天宇/TB2/1班;2班/95',
      '', '军事理论/22231002/(1-2节)9-13周(单)/ JB108/赵锦铎/TB3/1班/139', '', '', ''],
    ['上午', '二', '',
      '大学生健康教育/22091001/(3-4节)13-16周/ JA412/刘冰清/TB4/1班;2班/139',
      '形势与政策/22221005/(3-4节)12-14周/ JB208/隋辰南/TB5/1班/70',
      '公共体育1/22211101/(3-4节)3-16周/ 操场4/刘先义,庄元/公体1-济南10/1班;2班/93',
      '系统解剖学实验/22093415/(3-4节)6周,14-16周/ 解剖学实验室（2）/苏梦宇/TB6/3班/46', '', ''],
    ['下午', '四', '', '', '', '',
      '系统解剖学实验/22093415/(7-8节)7-8周/ 解剖学实验室（2）/苏梦宇/TB6/3班/46', '', ''],
    ['晚上', '六', '', '', '', '', '', '', ''],
    ['实践课程：专业认知见习●杨晓倩,邢宪明(共1周)/16周;', '', '', '', '', '', '', '', ''],
    ['其他课程：军事技能●董硕(共3周)/1-3周;', '', '', '', '', '', '', '', ''],
    ['注--内容顺序为：课程<>课程号<>周次<>地点<>教师<>教学班<>教学班组成<>选课人数 本学期2026-09-07正式上课至2026-12-27结束，共16周. 打印时间：2026-09-21', '', '', '', '', '', '', '', ''],
  ];
}

/** 一行一节课的记录表（通用档案 / 超级课程表导出） */
function genericFixture() {
  return [
    ['课程名称', '教师', '周次', '星期', '节次', '教室'],
    ['高等数学', '李四', '1-16周', '周一', '1-2', 'JA101'],
    ['大学英语', '王五', '1-8周', '周三', '3-4', 'JA102'],
  ];
}

const aoaQilu = qiluFixture();
const qilu = getProfile('qilu');
const generic = getProfile('generic');

console.log('\n【档案注册表】');
check('档案列表至少含齐鲁理工 + 通用', listProfiles().length >= 2, JSON.stringify(listProfiles().map((p) => p.id)));
check('按 id 能取到档案', !!qilu && !!generic);

console.log('\n【自动识别】');
const det = detectProfile(aoaQilu);
check('格子表被认成齐鲁理工', det.id === 'qilu', det.id);
check('置信度达到自动选中门槛（>=85）', det.confidence >= 85, String(det.confidence));
check('记录表落到通用档案', detectProfile(genericFixture()).id === 'generic');

console.log('\n【齐鲁理工 · 格子表解析】');
const r = qilu.parse(aoaQilu);
check('不需要列映射向导', r.needMapping === false);
check('解析出 9 门课（4 + 4 + 1）', r.items.length === 9, String(r.items.length));
check('没有解析失败的行', r.badRows.length === 0, JSON.stringify(r.badRows.slice(0, 2)));

const find = (name, day) => r.items.find((i) => i.className === name && i.day === day);
const intro = find('医学影像技术专业导论', 1);
check('课程名正确', !!intro, '周一第1节');
check('教师正确', intro && intro.teacher === '崔志洁', intro && intro.teacher);
check('地点正确', intro && intro.location === 'JA210', intro && intro.location);
check('节次 → 大节换算正确（1-2 节 = 大节 1）', intro && intro.period === 1, intro && String(intro.period));
check('周次 9-16 周展开成 8 周', intro && intro.weeks.join(',') === '9,10,11,12,13,14,15,16', intro && intro.weeks.join(','));

// ① 一格两门课：人数「93」粘着下一门课名
const zhonghua = find('中华民族共同体概论', 2);
const jiepo = find('系统解剖学', 2);
check('一格两门课都被拆出来', !!zhonghua && !!jiepo);
check('第二门课名没被上一门的选课人数污染', !!jiepo && jiepo.className === '系统解剖学', jiepo && jiepo.className);
check('第二门课的教师正确', !!jiepo && jiepo.teacher === '唐天宇', jiepo && jiepo.teacher);

// ② 「6周,14-16周」不能被截断成 1 周
const exp = find('系统解剖学实验', 5);
check('「6周,14-16周」解析成 4 周', !!exp && exp.weeks.join(',') === '6,14,15,16', exp && exp.weeks.join(','));

// ③ 单周课
const military = find('军事理论', 4);
check('「9-13周(单)」只取奇数周', !!military && military.weeks.join(',') === '9,11,13', military && military.weeks.join(','));

// 大节换算：3-4 节 = 大节 2
const peiyu = r.items.find((i) => i.className === '大学生健康教育');
check('3-4 节 → 大节 2', peiyu && peiyu.period === 2, peiyu && String(peiyu.period));

console.log('\n【齐鲁理工 · 学期信息】');
check('学年读成 2026-2027', r.term && r.term.xn === '2026-2027', r.term && r.term.xn);
check('学期读成第 1 学期', r.term && r.term.xq === '1');
check('开学日读成 2026-09-07（周一）',
  r.term && new Date(r.term.semesterStart).getFullYear() === 2026
  && new Date(r.term.semesterStart).getMonth() === 8
  && new Date(r.term.semesterStart).getDate() === 7
  && new Date(r.term.semesterStart).getDay() === 1,
  r.term && new Date(r.term.semesterStart).toString());
// ④ 总周数必须取「正式上课…结束，共N周」，不能被「(共1周)」抢先匹配
check('总周数读成 16（不是「实践课程(共1周)」的 1）', r.term && r.term.totalWeeks === 16, r.term && String(r.term.totalWeeks));

console.log('\n【齐鲁理工 · 跳过项要告知用户】');
check('提示了实践/其他课程未导入', r.warnings.some((w) => w.includes('未导入')), r.warnings.join(' | '));

console.log('\n【通用 · 记录表解析】');
const g = generic.parse(genericFixture());
check('需要列映射向导', g.needMapping === true);
check('解析出 2 条', g.items.length === 2, String(g.items.length));
check('周次 1-16 展开', g.items[0] && g.items[0].weeks.length === 16);
check('节次 1-2 → 大节 1', g.items[0] && g.items[0].period === 1, g.items[0] && String(g.items[0].period));
check('映射到正确的列', g.mapping && g.mapping.className === 0 && g.mapping.teacher === 1, JSON.stringify(g.mapping));

console.log('\n【通用 · 不误伤格子表】');
const gOnQilu = generic.parse(aoaQilu);
check('把格子表喂给通用档案 → 解析不出课（而不是乱解析）', gOnQilu.items.length === 0, String(gOnQilu.items.length));

console.log('\n' + '─'.repeat(56));
console.log(`  结果：${pass} 通过，${fail} 失败`);
console.log('─'.repeat(56) + '\n');
process.exit(fail ? 1 : 0);


