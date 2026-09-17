/**
 * 生成样本课表 xlsx，验证 parseFile/reparse 的列映射与解析逻辑。
 * DB 写入验证在真实 App（CDP E2E）里跑，避免 better-sqlite3 ABI 问题。
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const XLSX = require('xlsx');

// 在 require dist-electron 之前注入 electron stub，避免它去找 electron 二进制
const realResolve = Module._resolveFilename;
const stubPath = path.resolve(__dirname, '../.probe/fake-electron.js');
fs.mkdirSync(path.dirname(stubPath), { recursive: true });
fs.writeFileSync(stubPath, 'module.exports = { dialog:{}, ipcMain:{handle(){} }, app:{}, BrowserWindow:class{}, shell:{} };');
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return stubPath;
  return realResolve.call(this, request, parent, ...rest);
};

const sample = [
  ['课程名称', '教师', '周次', '星期', '节次', '上课教室'],
  ['高等数学', '张老师', '1-16周', '一', '1-2', '教 401'],
  ['高等数学', '张老师', '1-16周', '三', '1-2', '教 401'],
  ['大学物理', '李老师', '1-8,10-16周(单)', '二', '3-4', '教 302'],
  ['大学物理', '李老师', '1-8,10-16周(单)', '四', '3-4', '教 302'],
  ['英语', '王老师', '1-16周', '五', '5-6', '语 201'],
  ['计算机组成原理', '陈老师', '5-12周', '二', '1-2', '机 501'],
  ['计算机组成原理', '陈老师', '5-12周', '四', '1-2', '机 501'],
  ['体育', '赵老师', '1-16周', '三', '5-6', '操场'],
  ['马克思主义原理', '孙老师', '9-16周', '一', '5-6', '教 203'],
  ['大学生职业规划', '周老师', '1-2周', '五', '3-4', '教 105'],
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample), 'Sheet1');
const out = path.resolve(__dirname, '../.probe/sample-curriculum.xlsx');
XLSX.writeFile(wb, out);
console.log('样本 xlsx:', out);

// 临时在 dist-electron/timetable-xls/index.js 末尾追加 parseFile / reparse 导出用于测试
const compiled = path.resolve(__dirname, '../dist-electron/timetable-xls/index.js');
const originalCode = fs.readFileSync(compiled, 'utf8');
if (!originalCode.includes('// TEST_EXPORT')) {
  fs.writeFileSync(compiled, originalCode + '\n// TEST_EXPORT\nexports.parseFile = parseFile;\nexports.reparse = reparse;\n');
}
delete require.cache[require.resolve(compiled)];
const mod = require(compiled);

(async () => {
  const parsed = await mod.parseFile(out);
  console.log('\n=== 解析结果 ===');
  console.log('表名:', parsed.sheetName);
  console.log('总行数:', parsed.totalRows);
  console.log('表头:', parsed.headers);
  console.log('列映射:', parsed.mapping);
  console.log('items 总数:', parsed.items.length, '  预览:', parsed.preview.length);

  const classNames = [...new Set(parsed.items.map(i => i.className))];
  console.log('识别到课程:', classNames);

  let failures = [];
  if (classNames.length !== 7) failures.push('课程数应为 7，实际 ' + classNames.length);
  if (parsed.mapping.className < 0) failures.push('未识别课程名列');
  if (parsed.mapping.weeks < 0) failures.push('未识别周次列');
  if (parsed.mapping.day < 0) failures.push('未识别星期列');
  if (parsed.mapping.period < 0) failures.push('未识别节次列');
  if (parsed.items.some(i => !i.className || !i.weeks.length || i.day < 1 || i.day > 7 || i.period < 1)) {
    failures.push('存在解析不完整的条目');
  }
  // 每行解析为 1 个 item（periodName 含完整范围如 "1-2"）
  // 7 门课共 10 个 items；展开后 events = 106（高数 32 + 物理 16 + 英语 16 + 计算机 16 + 体育 16 + 马原 8 + 职业 2）
  if (parsed.items.length !== 10) failures.push('items 总数应为 10，实际 ' + parsed.items.length);
  if (!parsed.items[0].periodName.includes('-')) failures.push('periodName 未保留节次范围');
  // 周次解析：物理应为 1,3,5,7,11,13,15（单周, 1-8 → 4 个，10-16 → 3 个）
  const physWeeks = parsed.items.find(i => i.className === '大学物理' && i.day === 2)?.weeks;
  const expectedPhys = [1,3,5,7,11,13,15];
  if (!physWeeks || physWeeks.length !== expectedPhys.length ||
      !expectedPhys.every((w, i) => physWeeks[i] === w)) {
    failures.push('物理周次解析错误：期望 ' + JSON.stringify(expectedPhys) + ' 实际 ' + JSON.stringify(physWeeks));
  }

  // 重新解析：移除 location 列映射 → items 应不变
  const rep = await mod.reparse(parsed, { ...parsed.mapping, location: -1 });
  if (rep.items.length !== parsed.items.length) failures.push('移除 location 后 items 数变化');

  // 移除课程名 → items 应空
  const bad = await mod.reparse(parsed, { ...parsed.mapping, className: -1 });
  if (bad.items.length !== 0) failures.push('移除课程名后 items 应为 0，实际 ' + bad.items.length);

  // 错误周次 → badRows 应记录
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([
    ['课程名称', '周次', '星期', '节次'],
    ['坏数据课程', '乱码周次', '一', '1'],
    ['空字段课程', '1-8周', '', '1'],
  ]), 'Sheet1');
  const badFile = path.resolve(__dirname, '../.probe/bad-curriculum.xlsx');
  XLSX.writeFile(wb2, badFile);
  const badParsed = await mod.parseFile(badFile);
  if (badParsed.badRows.length !== 2) failures.push('坏行数应为 2，实际 ' + badParsed.badRows.length);
  if (badParsed.items.length !== 0) failures.push('坏行解析后 items 应为 0，实际 ' + badParsed.items.length);

  console.log('\n=== 结论 ===');
  if (failures.length === 0) {
    console.log('✓ 全部通过（' + parsed.items.length + ' 条 / ' + classNames.length + ' 门课 / 列映射 100% 识别 / 坏行被跳过）');
  } else {
    console.log('✗ ' + failures.length + ' 项失败:');
    failures.forEach(f => console.log('  - ' + f));
    process.exitCode = 1;
  }

  // 还原编译产物；.probe 文件交给 safe-delete 拦截（不删也不影响）
  fs.writeFileSync(compiled, originalCode);
  console.log('清理完成（编译产物已还原）');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
