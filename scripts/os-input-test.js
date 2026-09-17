// OS 级真实键盘链路测试：
// CDP 焦点一个输入框 → 调 PowerShell SendKeys 发真实按键 → CDP 读回值
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');

const APP = 'E:/University/TaskManager/release-final/win-unpacked/TaskManager.exe';
const USER_DATA = 'E:/University/TaskManager/scripts/.input-test4';
const PORT = 9228;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, timeout: 3000 }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
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
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 超时');
}

async function main() {
  const child = spawn(APP, [`--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  console.log('应用 pid=', child.pid);
  try {
    const wsUrl = await waitCdp(20000);
    await sleep(3000);
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m.result); };

    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await send('Runtime.enable');

    // 导航到设置页并让「姓名」输入框获得焦点
    await send('Runtime.evaluate', { expression: "window.location.hash = '#/settings'; 'ok'" });
    let focused = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const labels = [...document.querySelectorAll('label')];
          const lb = labels.find(l => l.textContent.includes('姓名'));
          const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
          if (!inp) return false;
          inp.focus(); inp.scrollIntoView({ block: 'center' });
          return document.activeElement === inp;
        })()`,
        returnByValue: true,
      });
      if (r.result.value === true) { focused = true; break; }
    }
    console.log('输入框已通过 JS 聚焦:', focused);
    if (!focused) throw new Error('无法聚焦输入框');

    // ===== OS 级真实键盘输入 =====
    // 1. 激活窗口（真实 SetForegroundWindow）
    execSync(`powershell -NoProfile -Command "$sh = New-Object -ComObject WScript.Shell; $sh.AppActivate('TaskManager')"`, { stdio: 'ignore' });
    await sleep(600);
    // 2. 发送真实按键（经过 Windows 消息队列 → Chromium 窗口过程 → 渲染器）
    execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('OSREAL')"`, { stdio: 'ignore' });
    console.log('已发送 OS 级按键: OSREAL');
    await sleep(1000);

    // 3. 读回输入框的值和焦点状态
    const val = await send('Runtime.evaluate', {
      expression: `(() => {
        const labels = [...document.querySelectorAll('label')];
        const lb = labels.find(l => l.textContent.includes('姓名'));
        const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
        return JSON.stringify({ value: inp ? inp.value : 'no-input', focused: document.activeElement === inp, activeTag: document.activeElement.tagName });
      })()`,
      returnByValue: true,
    });
    console.log('OS 按键后:', val.result.value);
    const r = JSON.parse(val.result.value);
    console.log('\n===== 结论 =====');
    if (r.value && r.value.includes('OSREAL')) console.log('✅ OS 级真实键盘输入正常 —— 物理键盘打字应无问题');
    else if (!r.focused) console.log('❌ 焦点丢失（发送按键时窗口未激活或焦点被抢）—— activeElement:', r.activeTag);
    else console.log('❌ OS 级键盘输入失败：按键没有到达输入框（窗口消息层被拦截）');
  } finally {
    try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {}
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {} process.exit(1); });
