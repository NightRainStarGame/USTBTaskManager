/* CDP 端到端：创建课程 → 刷新页面 → 验证课程还在（IndexedDB 持久化） */
const { spawn } = require('child_process');

async function main() {
  const url = 'http://127.0.0.1:4175/index-mobile.html';
  const port = 9334;
  const CHROME = 'C:/Users/NRSG-/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe';
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    '--user-data-dir=E:/University/TaskManager/.cdp-profile-mobile2',
    '--window-size=1440,1000',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`); break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }

  const t1 = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t1.webSocketDebuggerUrl);
  let seq = 0; const calls = new Map();
  ws.addEventListener('message', e => {
    const j = JSON.parse(e.data);
    if (j.id && calls.has(j.id)) { calls.get(j.id)(j); calls.delete(j.id); }
  });
  const call = (method, params = {}) => new Promise(r => {
    const id = ++seq; ws.send(JSON.stringify({ id, method, params })); calls.set(id, r);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 8000));

  // 1) 建课
  const created = await call('Runtime.evaluate', {
    expression: `(async () => {
      const c = await window.taskAPI.db.courses.create({
        name: '移动端测试课程', code: 'MOBILE-101', instructor: '豆芽',
        semester: '2026-Fall', color: '#00FF88', description: 'Capacitor E2E',
      });
      return JSON.stringify(c);
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('CREATE:', created.result?.result?.value);

  // 2) 建作业（带中文/IME 场景字段）
  const courseId = JSON.parse(created.result.result.value).id;
  const req = await call('Runtime.evaluate', {
    expression: `(async () => {
      const r = await window.taskAPI.db.requirements.create({
        course_id: ${courseId}, title: '移动端作业：中文标题测试', type: 'homework',
        due_date: Date.now() + 86400000, priority: 1,
      });
      return JSON.stringify(r);
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('REQ:', req.result?.result?.value);

  // 3) 设置主题 = starry
  await call('Runtime.evaluate', {
    expression: `(async () => { await window.taskAPI.db.settings.set('theme', 'starry'); return 'ok'; })()`,
    awaitPromise: true, returnByValue: true,
  });

  // 4) 刷新页面
  await call('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 8000));

  const after = await call('Runtime.evaluate', {
    expression: `(async () => {
      const courses = await window.taskAPI.db.courses.list();
      const reqs = await window.taskAPI.db.requirements.list();
      const settings = await window.taskAPI.db.settings.getAll();
      return JSON.stringify({
        courseCount: courses.length,
        courseNames: courses.map(c => c.name),
        reqCount: reqs.length,
        reqTitles: reqs.map(r => r.title),
        themeSetting: settings.filter(s => s.key === 'theme'),
        docTheme: document.documentElement.dataset.theme,
      });
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('AFTER RELOAD:', after.result?.result?.value);

  // 5) 统计页
  const dash = await call('Runtime.evaluate', {
    expression: `(async () => JSON.stringify(await window.taskAPI.db.stats.dashboard()))()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('DASHBOARD:', dash.result?.result?.value);

  // 6) 作业码（本地 HMAC 派生，验证 crypto shim 端到端）
  const codes = await call('Runtime.evaluate', {
    expression: `(async () => JSON.stringify(await window.taskAPI.homework.generateCodes()))()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('HOMEWORK CODES:', codes.result?.result?.value);

  ws.close(); child.kill();
  setTimeout(() => process.exit(0), 500);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
