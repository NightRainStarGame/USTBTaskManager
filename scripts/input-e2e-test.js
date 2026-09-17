// 一体化输入测试：启动打包版 → CDP 真实鼠标点击 + 键盘输入 → 报告结果
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');

const APP = 'E:/University/TaskManager/release-final/win-unpacked/TaskManager.exe';
const USER_DATA = 'E:/University/TaskManager/scripts/.input-test2';
const PORT = 9226;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, timeout: 3000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitCdp(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const pages = await getJson('/json/list');
      const page = pages.find(p => p.type === 'page' && p.title.includes('TaskManager'));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP 超时');
}

async function main() {
  const child = spawn(APP, [`--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${PORT}`], {
    detached: false, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  console.log('应用已启动 pid=', child.pid);

  try {
    const wsUrl = await waitCdp(20000);
    console.log('CDP 就绪');
    await sleep(3000); // 等页面完全渲染

    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) => new Promise(res => {
      const i = ++id; pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
    };

    const result = await new Promise((resolve) => {
      ws.onopen = async () => {
        try {
          await send('Runtime.enable');
          await send('Input.enable');

          // 跳到设置页（用 React Router 导航，不刷新页面）
          await send('Runtime.evaluate', { expression: "window.location.hash = '#/settings'; 'ok'" });
          // 轮询等待设置页渲染（最长 10 秒）
          let box = null;
          for (let i = 0; i < 20; i++) {
            await sleep(500);
            const r = await send('Runtime.evaluate', {
              expression: `(() => {
                const labels = [...document.querySelectorAll('label')];
                const lb = labels.find(l => l.textContent.includes('姓名'));
                const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
                if (!inp) return 'NOT_FOUND';
                const rr = inp.getBoundingClientRect();
                return JSON.stringify({ x: Math.round(rr.x + rr.width/2), y: Math.round(rr.y + rr.height/2) });
              })()`,
              returnByValue: true,
            });
            if (r.result.value !== 'NOT_FOUND') { box = r.result.value; break; }
          }
          if (!box) {
            const dbg = await send('Runtime.evaluate', {
              expression: `JSON.stringify({ hash: location.hash, inputs: document.querySelectorAll('input').length, text: (document.body.innerText||'').slice(0,150) })`,
              returnByValue: true,
            });
            return resolve({ error: '找不到输入框: ' + dbg.result.value });
          }
          const { x, y } = JSON.parse(box);
          console.log('输入框坐标:', x, y);

          // 真实鼠标点击
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          await sleep(400);

          const focus = await send('Runtime.evaluate', {
            expression: `JSON.stringify({ tag: document.activeElement.tagName, isInput: document.activeElement.tagName === 'INPUT' })`,
            returnByValue: true,
          });
          console.log('点击后焦点:', focus.result.value);

          // 真实键盘事件逐字输入
          for (const ch of ['T', 'E', 'S', 'T']) {
            await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
            await sleep(100);
          }
          // IME 式整段插入
          await send('Input.insertText', { text: '你好' });
          await sleep(500);

          const val = await send('Runtime.evaluate', {
            expression: `(() => {
              const labels = [...document.querySelectorAll('label')];
              const lb = labels.find(l => l.textContent.includes('姓名'));
              const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
              return JSON.stringify({ value: inp ? inp.value : 'no-input', focused: document.activeElement === inp });
            })()`,
            returnByValue: true,
          });
          console.log('输入后数值:', val.result.value);
          resolve(JSON.parse(val.result.value));
        } catch (e) {
          resolve({ error: String(e) });
        }
      };
      ws.onerror = () => resolve({ error: 'WS_ERROR' });
    });

    console.log('\n===== 结论 =====');
    if (result.error) console.log('❌ 测试出错:', result.error);
    else if (result.value && result.value.includes('TEST') && result.value.includes('你好')) console.log('✅ 打包版输入完全正常（键盘事件 + IME 插入都生效）');
    else if (result.focused === false) console.log('❌ 点击后输入框未获得焦点 —— 指针层问题');
    else console.log('❌ 输入失败: value=', JSON.stringify(result.value), ' focused=', result.focused);
  } finally {
    try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {}
  }
  process.exit(0);
}

main().catch(e => { console.error(e); try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {} process.exit(1); });
