// 精确诊断：真实点击到底有没有到达页面、落在哪个元素上
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');

const APP = 'E:/University/TaskManager/release-final/win-unpacked/TaskManager.exe';
const USER_DATA = 'E:/University/TaskManager/scripts/.input-test6';
const PORT = 9230;
const PS_FILE = 'E:/University/TaskManager/scripts/.real-click.ps1';
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
function realClick(x, y) {
  fs.writeFileSync(PS_FILE, `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint data,UIntPtr extra);public struct POINT{public int X;public int Y;}}'
[M]::SetProcessDPIAware()
$ok = [M]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 250
$p = New-Object M+POINT
[M]::GetCursorPos([ref]$p) | Out-Null
Start-Sleep -Milliseconds 100
[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Write-Output "set=$ok actual=$($p.X),$($p.Y)"
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

    // 注入捕获阶段点击监听（记录所有到达页面的真实点击）
    await send('Runtime.evaluate', {
      expression: `window.__clicks = []; ['mousedown','click'].forEach(t => document.addEventListener(t, e => window.__clicks.push({ type: t, x: Math.round(e.clientX), y: Math.round(e.clientY), target: e.target.tagName, cls: (e.target.className||'').toString().slice(0,40) }), true)); 'ok'`,
    });

    // 导航到设置页并等待渲染，然后取坐标
    await send('Runtime.evaluate', { expression: "window.location.hash = '#/settings'; 'ok'" });
    let c = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const r = await send('Runtime.evaluate', {
        expression: `(() => {
          const labels = [...document.querySelectorAll('label')];
          const lb = labels.find(l => l.textContent.includes('姓名'));
          const inp = lb ? (lb.querySelector('input') || lb.parentElement.querySelector('input')) : null;
          if (!inp) return null;
          const nav = [...document.querySelectorAll('a, button')].find(el => el.textContent.trim() === '设置');
          const rr = inp.getBoundingClientRect();
          const nr = nav.getBoundingClientRect();
          const off = window.outerHeight - window.innerHeight;
          return JSON.stringify({
            input: { sx: Math.round(window.screenX + rr.x + rr.width/2), sy: Math.round(window.screenY + off + rr.y + rr.height/2) },
            nav: { sx: Math.round(window.screenX + nr.x + nr.width/2), sy: Math.round(window.screenY + off + nr.y + nr.height/2) },
            inputRect: { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) },
            dpr: window.devicePixelRatio,
            outerH: window.outerHeight, innerH: window.innerHeight, screenX: window.screenX, screenY: window.screenY
          });
        })()`,
        returnByValue: true,
      });
      if (r.result.value) { c = JSON.parse(r.result.value); break; }
    }
    if (!c) throw new Error('找不到输入框');
    console.log('坐标信息:', JSON.stringify(c));

    // ===== 测试 1：真实点击「设置」侧边栏链接 =====
    console.log('\n[测试1] 点击物理坐标:', Math.round(c.nav.sx * c.dpr), Math.round(c.nav.sy * c.dpr), '→', realClick(Math.round(c.nav.sx * c.dpr), Math.round(c.nav.sy * c.dpr)));
    await sleep(1000);
    let clicks = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__clicks)', returnByValue: true });
    console.log('\n[测试1] 真实点击侧边栏「设置」后事件:', clicks.result.value);

    // 清空
    await send('Runtime.evaluate', { expression: 'window.__clicks = []; "ok"' });

    // ===== 测试 2：真实点击「姓名」输入框 =====
    console.log('[测试2] 点击物理坐标:', Math.round(c.input.sx * c.dpr), Math.round(c.input.sy * c.dpr), '→', realClick(Math.round(c.input.sx * c.dpr), Math.round(c.input.sy * c.dpr)));
    await sleep(1000);
    clicks = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__clicks)', returnByValue: true });
    console.log('[测试2] 真实点击「姓名」输入框后事件:', clicks.result.value);
    const focus = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ activeTag: document.activeElement.tagName, isInput: document.activeElement.tagName === 'INPUT' })`,
      returnByValue: true,
    });
    console.log('[测试2] 焦点状态:', focus.result.value);

    console.log('\n===== 结论 =====');
    const cl = JSON.parse(clicks.result.value);
    if (cl.length === 0) console.log('❌ 真实点击完全没有到达页面 —— 窗口命中测试/拖拽层问题（复现用户问题）');
    else if (cl.some(e => e.target === 'INPUT')) console.log('⚠️ 点击到达了 INPUT 但焦点没变 —— 焦点管理问题');
    else console.log('⚠️ 点击到达页面但目标是:', cl.map(e => e.target).join(','), '—— 坐标偏差或元素遮挡');
  } finally {
    try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {}
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {} process.exit(1); });
