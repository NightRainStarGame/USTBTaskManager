// 截图：设置页「软件更新」卡片（发现新版本状态）
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const APP_PORT = 9441;
const SRV_PORT = 9442;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT_DIR = path.join(projectRoot, '.screenshots');

const DUMMY = Buffer.alloc(1024 * 512);
const SHA = crypto.createHash('sha256').update(DUMMY).digest('hex');

function startServer() {
  const s = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/latest.json') {
      const body = Buffer.from(JSON.stringify({
        version: '0.3.1',
        notes: '· 新增「软件更新」功能：设置页可检查更新、下载并一键安装\n· 修复课程无法添加作业（course_requirements 缺少 notes 列）\n· 课程页新增课表日历视图（支持教务导入的按周课程）\n· 优化编辑框输入体验',
        url: `http://127.0.0.1:${SRV_PORT}/files/TaskManager%20Setup%200.3.1.exe`,
        page: 'https://pan.example.com/s/taskmanager',
        sha256: SHA,
      }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      res.end(body);
      return;
    }
    if (url.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': DUMMY.length });
      res.end(DUMMY);
      return;
    }
    res.writeHead(404); res.end('nope');
  });
  return new Promise((r) => s.listen(SRV_PORT, '127.0.0.1', () => r(s)));
}

const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_ENV;
  const child = spawn(path.join(projectRoot, 'node_modules/electron/dist/electron.exe'), ['.', `--remote-debugging-port=${APP_PORT}`], { cwd: projectRoot, env, stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJSON(`http://127.0.0.1:${APP_PORT}/json`);
        const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.title);
        if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
      } catch {}
      await sleep(500);
    }
    if (!wsUrl) throw new Error('CDP 未就绪');
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result); } };
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 60000);
    });
    const evalJs = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r && r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200));
      return r ? r.result.value : undefined;
    };
    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(300);
    };
    const clickBtn = async (txt) => {
      const c = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes(${JSON.stringify(txt)}));
        if (!b) return null; b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
      })()`);
      if (!c) return false;
      await clickAt(...Object.values(JSON.parse(c)));
      return true;
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, name);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      console.log('截图:', file);
    };

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); setTimeout(() => rej(new Error('WS timeout')), 10000); });
    await send('Runtime.enable');
    await send('Input.enable');
    await send('Page.enable');

    await evalJs(`window.location.hash='#/settings'; 'ok'`);
    await sleep(2600);

    // 未配置状态
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('*')].find(e => e.textContent && e.textContent.trim() === '软件更新');
      if (el) el.scrollIntoView({ block: 'center' });
      return 'ok';
    })()`);
    await sleep(600);
    await shot('settings-update-empty.png');

    // 配置更新源（走真实 UI：原生 setter + input 事件）
    await evalJs(`(() => {
      const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'http://127.0.0.1:${SRV_PORT}/latest.json');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return i.value;
    })()`);
    await sleep(300);
    await clickBtn('保存地址');
    await sleep(700);
    await clickBtn('检查更新');
    for (let i = 0; i < 40; i++) {
      const t = await evalJs('document.body.innerText');
      if (t.includes('发现新版本')) break;
      await sleep(500);
    }
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('span')].find(e => e.textContent && e.textContent.includes('发现新版本'));
      if (el) el.scrollIntoView({ block: 'center' });
      return 'ok';
    })()`);
    await sleep(600);
    await shot('settings-update-found.png');

    // 还原
    await evalJs(`(() => {
      const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return i.value;
    })()`);
    await clickBtn('保存地址');
    await sleep(500);
    console.log('已还原更新源设置');
  } catch (e) {
    console.log('ERROR:', e.message);
  } finally {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    server.close();
    await sleep(1000);
  }
}

main();
