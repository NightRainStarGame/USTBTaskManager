// 临时验证脚本：通过 CDP 对打包应用做一次 SQLite 写入测试
const url = process.argv[2];
const ws = new WebSocket(url);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m.result); };
ws.onopen = async () => {
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', {
    expression: '(async () => { const api = window.taskAPI.db; await api.courses.create({ name: "打包验证课程", code: "PKG-001", semester: "2025-2026-2" }); const cs = await api.courses.list(); const c = cs.find(x => x.code === "PKG-001"); await api.courses.delete(c.id); const after = await api.courses.list(); return JSON.stringify({ created: !!c, deleted: after.length === 0, remaining: after.length }); })()',
    awaitPromise: true, returnByValue: true,
  });
  console.log('SQLite 写入/删除测试:', r.result.value);
  process.exit(0);
};
ws.onerror = () => { console.log('WS ERROR'); process.exit(1); };
