/** 通过 CDP 检查运行中的 Electron 渲染页面是否正常渲染、IPC 是否可用 */
const WS_URL = process.argv[2];
const ws = new WebSocket(WS_URL);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
};
ws.onopen = async () => {
  await send('Runtime.enable');
  const expr = `(async () => {
    const els = document.querySelectorAll('button, a, h1, h2').length;
    const txt = (document.body.innerText || '').length;
    const hasApi = !!(window.taskAPI && window.taskAPI.db);
    let courses = 'N/A', settings = 'N/A';
    try { courses = (await window.taskAPI.db.courses.list()).length; } catch (e) { courses = 'ERR:' + e.message; }
    try { settings = JSON.stringify(await window.taskAPI.db.settings.all()).slice(0, 80); } catch (e) { settings = 'ERR:' + e.message; }
    return JSON.stringify({ interactiveEls: els, textLength: txt, taskAPI: hasApi, coursesViaIPC: courses, settingsViaIPC: settings });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log('页面状态:', r.result.value);
  process.exit(0);
};
ws.onerror = () => { console.log('WS 连接失败'); process.exit(1); };
setTimeout(() => { console.log('超时'); process.exit(1); }, 15000);
