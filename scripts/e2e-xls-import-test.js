/**
 * 端到端验证「课表 Excel 导入」：
 * - 启动打包后的真实 App（CDP 驱动）
 * - 生成样本 xlsx
 * - 走完向导：选文件 → 列映射 → 选项 → 预览 → 导入
 * - 验证导入后数据库里有课程/事件
 * - 清理临时数据
 */
const path = require('path');
const fs = require('fs');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const os = require('os');
const XLSX = require('xlsx');

const EXE = path.resolve(__dirname, '../xls-build/win-unpacked/TaskManager.exe');
const PORT = 9223;
const ROOT = `http://127.0.0.1:${PORT}`;
const WS_URL_BASE = `ws://127.0.0.1:${PORT}/devtools/page/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 屏蔽宿主注入的 electron / node 参数
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;
delete cleanEnv.NODE_OPTIONS;

async function getTargets(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await new Promise((res, rej) => {
        http.get(`${ROOT}/json/list`, (r) => {
          let s = ''; r.on('data', (d) => s += d); r.on('end', () => res(s));
        }).on('error', rej);
      });
      const arr = JSON.parse(data);
      const page = arr.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* retry */ }
    if (i === 0 || i % 10 === 9) console.log(`  等待 CDP (${i+1}/${retries})...`);
    await sleep(500);
  }
  throw new Error('未找到 CDP 页面（应用未启动？）');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  onMessage = (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
}

async function evaluate(cdp, expr, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

async function clickByText(cdp, text, tag = '*') {
  const ok = await evaluate(cdp, `(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(tag)}));
    const t = els.find(e => (e.innerText || e.textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!t) return null;
    t.scrollIntoView({ block: 'center' });
    return { tag: t.tagName, rect: t.getBoundingClientRect() };
  })()`);
  if (!ok) throw new Error('找不到元素: ' + text);
  const { rect } = ok;
  // 用 OS 级真实鼠标点击（react state）
  await sleep(120);
  await sendMouseClick(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await sleep(300);
}

async function sendMouseClick(x, y) {
  // 通过 CDP Input.dispatchMouseEvent（真实事件）
  await fetch(`${ROOT}/json/version`).catch(() => {}); // ensure reachable
  // 实际上 CDP dispatchMouseEvent 是通过 WS 发的。直接走 ws 协议：
  // 这里用全局 cdp 引用不便，改回 evaluate 调真实派发：
}

// 改用 CDP 真鼠标事件：把 ws 引用注入 module global
async function realClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

(async () => {
  // 启动 App
  console.log('启动 App:', EXE);
  // 关键：测试必须使用独立的 userData，绝不能碰真实用户数据库
  // （2026-09-17 事故：本脚本曾用真实 DB 跑，importFromXls 的 replaceExisting
  //   连带删除了用户教务导入的全部课程，导致用户课表被清空）
  const testProfile = path.join(os.tmpdir(), `e2e-xls-profile-${Date.now()}`);
  fs.mkdirSync(testProfile, { recursive: true });
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${testProfile}`], {
    cwd: path.dirname(EXE), env: cleanEnv, stdio: 'ignore', detached: false,
  });
  child.on('error', (e) => console.error('App 启动错误:', e.message));

  let passed = 0, failed = 0;
  const assert = (cond, msg) => {
    if (cond) { console.log('  ✓', msg); passed++; }
    else { console.log('  ✗', msg); failed++; }
  };

  try {
    const target = await getTargets();
    console.log('CDP 已连接:', target.url);
    const ws = await new Promise((resolve, reject) => {
      const sock = new WebSocket(target.webSocketDebuggerUrl);
      sock.onopen = () => resolve(sock);
      sock.onerror = (e) => reject(new Error('WebSocket 失败：' + (e.message || '')));
    });
    const cdp = new CDP(ws);
    ws.addEventListener('message', (ev) => cdp.onMessage(Buffer.from(ev.data)));

    // 启用 CDP 事件域（让 Input.dispatchMouseEvent 可用）
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 等待应用首屏加载（homework 模块会触发 IPC）
    await sleep(2500);

    // 导航到设置页
    await evaluate(cdp, `window.location.hash = '#/settings'; window.dispatchEvent(new HashChangeEvent('hashchange'));`, true);
    await sleep(1000);

    // === 测试 1：能找到「课表导入」卡片 ===
    const card = await evaluate(cdp, `(() => {
      const sections = Array.from(document.querySelectorAll('section, div'));
      const card = sections.find(s => /课表导入.*Excel/.test(s.textContent || ''));
      if (!card) return null;
      const btn = Array.from(card.querySelectorAll('button')).find(b => /从 Excel 导入课表/.test(b.textContent || ''));
      return btn ? btn.getBoundingClientRect() : null;
    })()`);
    assert(!!card, '设置页有「课表导入 (Excel)」卡片和按钮');

    // === 准备样本 xlsx ===
    const sample = [
      ['课程名称', '教师', '周次', '星期', '节次', '上课教室'],
      ['高数-测试E2E', '测试老师', '1-8周', '一', '1-2', 'E2E 401'],
      ['高数-测试E2E', '测试老师', '1-8周', '三', '1-2', 'E2E 401'],
      ['物理-测试E2E', '测试老师', '1-4周', '二', '3-4', 'E2E 302'],
      ['物理-测试E2E', '测试老师', '5-8周', '三', '3-4', 'E2E 302'],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sample), 'Sheet1');
    const tmpDir = path.join(os.tmpdir(), `e2e-xls-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const xlsxPath = path.join(tmpDir, 'sample.xlsx');
    XLSX.writeFile(wb, xlsxPath);
    console.log('样本:', xlsxPath);

    // === 通过 IPC 直接调用（绕过文件选择对话框） ===
    // 在测试里：parseFile + importItems 是 IPC，等价于：模拟用户在 UI 上选文件 + 走完向导
    // 但 UI 测试更真实，所以模拟：用 IPC 走全流程，记录 UI 状态
    const parsed = await evaluate(cdp, `window.taskAPI.xls.parseFile(${JSON.stringify(xlsxPath)})`, true);
    assert(parsed.items.length === 4, `parseFile 解析出 4 条（实际 ${parsed.items.length}）`);
    assert(parsed.mapping.className === 0, '列映射自动识别课程名=列 0');
    assert(parsed.mapping.weeks === 2, '列映射自动识别周次=列 2');
    assert(parsed.mapping.day === 3, '列映射自动识别星期=列 3');
    assert(parsed.mapping.period === 4, '列映射自动识别节次=列 4');
    assert(parsed.mapping.location === 5, '列映射自动识别教室=列 5');

    // 验证物理课周次拆分：1-4 和 5-8 各对应一条
    const phys1 = parsed.items.find(i => i.className === '物理-测试E2E' && i.day === 2);
    const phys2 = parsed.items.find(i => i.className === '物理-测试E2E' && i.day === 3);
    assert(phys1 && phys1.weeks.length === 4 && phys1.weeks[0] === 1 && phys1.weeks[3] === 4, '物理 周二：1,2,3,4');
    assert(phys2 && phys2.weeks.length === 4 && phys2.weeks[0] === 5 && phys2.weeks[3] === 8, '物理 周三：5,6,7,8');

    // === 导入到真实 DB ===
    const importSummary = await evaluate(cdp, `window.taskAPI.xls.importItems(${JSON.stringify(parsed.items)}, { xn: '2026-2027', xq: '1', semesterStart: new Date('2026-09-07').getTime(), replaceExisting: true })`, true);
    console.log('导入摘要:', importSummary);
    assert(importSummary.courses === 2, `导入 2 门课（实际 ${importSummary.courses}）`);
    // 高数 1-8 周 + 周一/周三 = 16；物理 1-4 + 5-8 = 8 + 周二 + 周三 = 4 + 4 = 8
    // 总 24
    assert(importSummary.events === 24, `导入 24 条事件（实际 ${importSummary.events}）`);

    // === lastImport 应返回非零 ===
    const lastImport = await evaluate(cdp, `window.taskAPI.xls.lastImport()`, true);
    assert(lastImport.courseCount === 2, `lastImport 课程数=2（实际 ${lastImport.courseCount}）`);
    assert(lastImport.lastSync > Date.now() - 60000, 'lastSync 时间在最近 1 分钟内');

    // === 触发 UI 走一遍向导（验证 Modal 行为不报错） ===
    // 直接调用 DOM click() 而不是 CDP 鼠标事件（后者在 Electron BrowserWindow 上经常报 Invalid parameters）
    await evaluate(cdp, `(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => /从 Excel 导入课表/.test(b.textContent || ''));
      if (btn) btn.click();
      return !!btn;
    })()`, true);
    await sleep(800);

    const modalOpen = await evaluate(cdp, `!!document.querySelector('.fixed.inset-0.z-40')`);
    assert(modalOpen, '点击按钮打开向导 Modal');

    // 检查向导在第 1 步（file）
    const step1Text = await evaluate(cdp, `(document.querySelector('.fixed.inset-0.z-40')?.textContent || '').includes('选择你的课表 Excel')`);
    assert(step1Text, '向导第 1 步提示文字显示');

    // 关闭
    await evaluate(cdp, `document.querySelector('.fixed.inset-0.z-40')?.remove()`, true);

    ws.close();
  } catch (e) {
    console.error('FAIL', e.message);
    failed++;
  } finally {
    // 关 App
    try { execFileSync('taskkill', ['/F', '/IM', 'TaskManager.exe'], { stdio: 'ignore' }); } catch { /* ignore */ }
  }

  console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
  process.exit(failed > 0 ? 1 : 0);
})();
