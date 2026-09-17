const { spawn } = require('child_process');
const http = require('http');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn('E:/University/TaskManager/release-0.2.1/win-unpacked/TaskManager.exe', ['--remote-debugging-port=9337'], { env, stdio: 'ignore' });
const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    try { const l = await get('http://127.0.0.1:9337/json'); const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (p && p.title) { wsUrl = p.webSocketDebuggerUrl; break; } if (p) wsUrl = p.webSocketDebuggerUrl; } catch (e) {}
    await sleep(500);
  }
  await sleep(3000); // 等待页面完全加载
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result); } };
  const send = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error('timeout ' + method)), 15000); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Runtime.enable');
  const evalJs = (expression) => send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result.value);
  console.log('hash before:', await evalJs('location.hash'));
  await evalJs(`window.location.hash='#/settings'; 'ok'`);
  await sleep(2500);
  console.log('hash after:', await evalJs('location.hash'));
  console.log('buttons:', await evalJs(`JSON.stringify([...document.querySelectorAll('button')].map(b=>b.textContent.trim()))`));
  console.log('body has 设置:', await evalJs(`document.body.textContent.includes('SETTINGS')`));
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})().catch((e) => { console.log('E:', e.message); spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); process.exit(1); });
