const { spawn } = require('child_process');
const http = require('http');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn('E:/University/TaskManager/release-0.2.1/win-unpacked/TaskManager.exe', ['--remote-debugging-port=9336'], { env, stdio: 'ignore' });
const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});
const dump = (l) => l.map((t) => ({ type: t.type, title: t.title, url: (t.url || '').slice(0, 60), ws: !!t.webSocketDebuggerUrl }));
(async () => {
  for (let i = 0; i < 30; i++) {
    try { const l = await get('http://127.0.0.1:9336/json'); console.log('first:', JSON.stringify(dump(l), null, 1)); break; } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 5000));
  try { const l = await get('http://127.0.0.1:9336/json'); console.log('5s later:', JSON.stringify(dump(l), null, 1)); } catch (e) { console.log('err', e.message); }
  spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
})().catch((e) => { console.log('E:', e.message); spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); process.exit(1); });
