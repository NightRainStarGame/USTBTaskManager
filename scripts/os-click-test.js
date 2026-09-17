// OS 级真实鼠标点击测试：
// CDP 计算输入框的屏幕绝对坐标 → user32 SetCursorPos + mouse_event 真实点击 → CDP 检查焦点
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');

const APP = 'E:/University/TaskManager/release-final/win-unpacked/TaskManager.exe';
const USER_DATA = 'E:/University/TaskManager/scripts/.input-test5';
const PORT = 9229;
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

// PowerShell：真实鼠标移动+点击（user32）—— 写入 .ps1 文件避免引号转义问题
const fs = require('node:fs');
const PS_FILE = 'E:/University/TaskManager/scripts/.real-click.ps1';
function realClick(x, y) {
  fs.writeFileSync(PS_FILE, `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint data,UIntPtr extra);}'
[M]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 200
[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Write-Output "clicked ${x},${y}"
`);
  return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_FILE}"`, { stdio: 'pipe' }).toString().trim();
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

    // 导航到设置页
    await send('Runtime.evaluate', { expression: "window.location.hash = '#/settings'; 'ok'" });
    let coords = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const r = await send('Runtime.evaluate', {
        // 计算输入框中心的「屏幕绝对坐标」（window.screenX/screenY 是视口原点的屏幕坐标）
        expression: `(() => {
          const labels = [...document.querySelectorAll('label')];
          const lb = labels.find(l => l.textContent.includes('姓名'));
          const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
          if (!inp) return null;
          const rr = inp.getBoundingClientRect();
          return JSON.stringify({
            screenX: Math.round(window.screenX + rr.x + rr.width/2),
            screenY: Math.round(window.screenY + rr.y + rr.height/2 + (window.outerHeight - window.innerHeight)),
            dpr: window.devicePixelRatio
          });
        })()`,
        returnByValue: true,
      });
      if (r.result.value) { coords = JSON.parse(r.result.value); break; }
    }
    if (!coords) throw new Error('找不到输入框');
    console.log('输入框屏幕坐标(CSS px):', coords);
    const px = Math.round(coords.screenX * coords.dpr);
    const py = Math.round(coords.screenY * coords.dpr);
    console.log('物理像素坐标:', px, py);

    // ===== 真实 OS 鼠标点击 =====
    realClick(px, py);
    await sleep(800);

    // 检查焦点
    const focus = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ activeTag: document.activeElement.tagName, isInput: document.activeElement.tagName === 'INPUT' })`,
      returnByValue: true,
    });
    console.log('真实点击后焦点:', focus.result.value);

    // 再用真实键盘打字
    execSync(`powershell -NoProfile -Command "$sh = New-Object -ComObject WScript.Shell; $null = $sh.AppActivate('TaskManager'); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('CLICKTYPE')"`, { stdio: 'pipe' });
    await sleep(800);

    const val = await send('Runtime.evaluate', {
      expression: `(() => {
        const labels = [...document.querySelectorAll('label')];
        const lb = labels.find(l => l.textContent.includes('姓名'));
        const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
        return JSON.stringify({ value: inp ? inp.value : 'no-input', focused: document.activeElement === inp });
      })()`,
      returnByValue: true,
    });
    console.log('真实点击+打字后:', val.result.value);
    const r = JSON.parse(val.result.value);
    console.log('\n===== 结论 =====');
    if (r.value && r.value.includes('CLICKTYPE')) console.log('✅ OS 级真实鼠标点击 + 键盘输入全链路正常');
    else console.log('❌ 真实点击未能聚焦/输入 —— 复现用户问题！点击被当作拖拽或其他命中测试问题');
  } finally {
    try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {}
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {} process.exit(1); });
