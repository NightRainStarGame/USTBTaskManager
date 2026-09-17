// 旧构建输入测试：+ → 新建课程 → 课程页「新建课程」按钮 → 抽屉输入框 → 真实点击打字
const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');

const APP = 'E:/University/TaskManager/release-nsis2/win-unpacked/TaskManager.exe';
const USER_DATA = 'E:/University/TaskManager/scripts/.input-test-old2';
const PORT = 9233;
const PS_CLICK = 'E:/University/TaskManager/scripts/.real-click.ps1';
const PS_TYPE = 'E:/University/TaskManager/scripts/.real-type.ps1';
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
  fs.writeFileSync(PS_CLICK, `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint data,UIntPtr extra);}'
[M]::SetProcessDPIAware()
[M]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 250
[M]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 100
[M]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Write-Output "ok"
`);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_CLICK}"`, { stdio: 'pipe' });
}
function realType(text) {
  fs.writeFileSync(PS_TYPE, `
$sh = New-Object -ComObject WScript.Shell
$null = $sh.AppActivate('TaskManager')
Start-Sleep -Milliseconds 300
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${text}')
Write-Output "ok"
`);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_TYPE}"`, { stdio: 'pipe' });
}

async function main() {
  const child = spawn(APP, [`--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  });
  console.log('旧构建 pid=', child.pid);
  try {
    const wsUrl = await waitCdp(20000);
    await sleep(3000);
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    const send = (m, p) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m.result); };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await send('Runtime.enable');

    const getCoord = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result.value ? JSON.parse(r.result.value) : null;
    };
    const coordExpr = (sel) => `(() => {
      const el = ${sel};
      if (!el) return null;
      const rr = el.getBoundingClientRect();
      const off = window.outerHeight - window.innerHeight;
      return JSON.stringify({ x: Math.round((window.screenX + rr.x + rr.width/2) * window.devicePixelRatio), y: Math.round((window.screenY + off + rr.y + rr.height/2) * window.devicePixelRatio) });
    })()`;

    // 直接导航到课程页
    await send('Runtime.evaluate', { expression: "window.location.hash = '#/courses'; 'ok'" });
    await sleep(2000);

    // 点击课程页的「新建课程」按钮
    let btn = await getCoord(coordExpr(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('新建课程'))`));
    console.log('课程页「新建课程」按钮:', btn);
    if (!btn) throw new Error('找不到新建课程按钮');
    realClick(btn.x, btn.y);
    await sleep(1500);

    // 找抽屉里的名称输入框
    let nameInput = null;
    for (let i = 0; i < 10; i++) {
      nameInput = await getCoord(coordExpr(`[...document.querySelectorAll('input')].find(inp => { const ph = inp.placeholder || ''; const lbl = inp.parentElement?.previousElementSibling?.textContent || inp.closest('label')?.textContent || ''; return ph.includes('名称') || lbl.includes('名称') || ph.includes('课程'); })`));
      if (nameInput) break;
      await sleep(500);
    }
    console.log('名称输入框坐标:', nameInput);
    if (!nameInput) throw new Error('找不到名称输入框（抽屉未打开？）');

    // 真实点击 + 真实打字
    realClick(nameInput.x, nameInput.y);
    await sleep(600);
    realType('OLDCOURSE');
    await sleep(1000);

    const val = await send('Runtime.evaluate', {
      expression: `(() => {
        const inp = [...document.querySelectorAll('input')].find(i => { const ph = i.placeholder || ''; const lbl = i.parentElement?.previousElementSibling?.textContent || i.closest('label')?.textContent || ''; return ph.includes('名称') || lbl.includes('名称') || ph.includes('课程'); });
        return JSON.stringify({ value: inp ? inp.value : 'no-input', focused: document.activeElement === inp, tag: document.activeElement.tagName });
      })()`,
      returnByValue: true,
    });
    console.log('真实打字后:', val.result.value);
    const r = JSON.parse(val.result.value);
    console.log('\n===== 结论 =====');
    if (r.value && r.value.includes('OLDCOURSE')) console.log('✅ 旧构建输入也正常 —— 输入问题与构建版本无关');
    else console.log('❌ 旧构建输入失败！focused:', r.focused, 'tag:', r.tag, '—— 找到用户问题的根源');
  } finally {
    try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {}
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR:', e.message); try { execSync('taskkill /IM TaskManager.exe /F', { stdio: 'ignore' }); } catch {} process.exit(1); });
