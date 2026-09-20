/**
 * 块 2 验收脚本：启动应用（生产模式），CDP 切换 sakura 主题，对 Dashboard/Courses/Settings 截图。
 * 用法：node scripts/verify-sakura-theme.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 19222;
const OUT_DIR = path.join(__dirname, '..', '.theme-shots');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  const child = spawn(require('electron'), ['.', `--remote-debugging-port=${PORT}`], {
    env, cwd: path.join(__dirname, '..'), stdio: 'ignore',
  });
  console.log('electron pid:', child.pid);

  try {
    // 等 CDP 端口
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json`);
        const list = await res.json();
        const page = list.find(t => t.type === 'page' && /index\.html|localhost/.test(t.url));
        if (page) { targets = page; break; }
      } catch { /* retry */ }
    }
    if (!targets) throw new Error('CDP page target not found');
    console.log('CDP target:', targets.url);

    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let msgId = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.result && r.result.result.value;
    };

    await sleep(2500); // 等 React 挂载完

    // 切到 sakura 主题
    await evalJs(`document.documentElement.dataset.theme = 'sakura'; 'ok'`);
    await sleep(800);

    const pages = [
      { name: 'dashboard', nav: `document.querySelector('a[href="/"]') || document.querySelectorAll('nav a')[0]` },
      { name: 'courses', nav: `document.querySelector('a[href="/courses"]') || document.querySelectorAll('nav a')[1]` },
      { name: 'settings', nav: `document.querySelector('a[href="/settings"]') || Array.from(document.querySelectorAll('nav a')).pop()` },
    ];
    for (const p of pages) {
      await evalJs(`(${p.nav}) && (${p.nav}).click(); 'nav'`);
      await sleep(900);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(shot.result.data, 'base64');
      const file = path.join(OUT_DIR, `sakura-${p.name}.png`);
      fs.writeFileSync(file, buf);
      console.log('saved', file, buf.length, 'bytes');
    }

    // 顺便截一张 neon-green 对照
    await evalJs(`document.documentElement.dataset.theme = 'neon-green'; 'ok'`);
    await evalJs(`(document.querySelector('a[href="/"]') || document.querySelectorAll('nav a')[0]).click(); 'nav'`);
    await sleep(800);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT_DIR, 'neon-green-dashboard.png'), Buffer.from(shot.result.data, 'base64'));
    console.log('saved neon-green-dashboard.png');

    ws.close();
  } finally {
    try { process.kill(child.pid); } catch {}
    setTimeout(() => process.exit(0), 400);
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
