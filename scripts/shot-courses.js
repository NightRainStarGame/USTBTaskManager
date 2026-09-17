// 截图验证：课表日历视图 + 课程详情作业概览
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const electronBin = path.join(projectRoot, 'node_modules/electron/dist/electron.exe');
const outDir = path.join(projectRoot, '.screenshots');
const PORT = 9343;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_ENV;
  const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: projectRoot, env, stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJSON(`http://127.0.0.1:${PORT}/json`);
        const ready = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.title);
        if (ready) { wsUrl = ready.webSocketDebuggerUrl; break; }
      } catch {}
      await sleep(500);
    }
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result); } };
    const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = (expression, awaitPromise = false) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }).then((r) => r && r.result && r.result.value);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
    await send('Runtime.enable');
    await send('Page.enable');

    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('saved', name);
    };

    // 1) 课表日历
    await evalJs(`window.location.hash='#/courses?view=timetable'; 'ok'`);
    await sleep(3000);
    await shot('timetable');

    // 2) 课程卡片视图
    await evalJs(`window.location.hash='#/'; 'ok'`);
    await sleep(1000);
    await evalJs(`window.location.hash='#/courses'; 'ok'`);
    await sleep(2500);
    await shot('courses-cards');

    // 3) 点开课程 → 基本信息（含作业概览）
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('div[role="button"]')].find(e => e.textContent.includes('微积分I'));
      if (el) el.click();
      return 'ok';
    })()`, false);
    await sleep(1500);
    await shot('course-drawer-info');

    // 4) 作业 tab
    const tab = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('作业/要求'));
      if (b) { b.click(); return 'clicked'; }
      return 'notfound';
    })()`);
    console.log('作业 tab:', tab);
    await sleep(1200);
    await shot('course-drawer-homework');

    // 5) 上课时间 tab（看导入的课表安排）
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('上课时间'));
      if (b) b.click();
      return 'ok';
    })()`);
    await sleep(1200);
    await shot('course-drawer-schedule');

    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    process.exit(0);
  } catch (e) {
    console.log('E:', e.message);
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    process.exit(1);
  }
})();
