// E2E：课程作业添加 + 课表日历 + DB 迁移自检（针对源码构建的 Electron，加载 dist/）
// 用法：node e2e-course-test.js
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const providedExe = process.argv[2];
const electronBin = path.join(projectRoot, 'node_modules/electron/dist/electron.exe');
const PORT = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_ENV; // 非 dev：加载 dist/index.html（与打包版行为一致）
  const isPackaged = providedExe && providedExe.endsWith('.exe');
  const cwd = isPackaged ? path.dirname(path.resolve(projectRoot, providedExe)) : projectRoot;
  const args = isPackaged ? [`--remote-debugging-port=${PORT}`] : ['.', `--remote-debugging-port=${PORT}`];
  const bin = isPackaged ? path.resolve(projectRoot, providedExe) : electronBin;
  console.log('启动:', bin);
  const child = spawn(bin, args, { cwd, env, stdio: 'ignore' });

  let done = false;
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
    if (!wsUrl) throw new Error('CDP 未就绪');
    console.log('CDP 已连接');

    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m.result); } };
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 20000);
    });
    const evalJs = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r && r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300));
      return r ? r.result.value : undefined;
    };
    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(300);
    };
    const typeText = async (text) => {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
        await sleep(35);
      }
      await sleep(150);
    };
    const centerOfLabel = (txt) => evalJs(`(() => {
      const lb = [...document.querySelectorAll('label')].find(l => l.textContent.includes(${JSON.stringify(txt)}));
      const inp = (lb && lb.querySelector('input,textarea')) || (lb && lb.parentElement.querySelector('input,textarea'));
      if (!inp) return null; const r = inp.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    const centerOfBtn = (txt, exact = false) => evalJs(`(() => {
      const bs = [...document.querySelectorAll('button')];
      const b = bs.find(x => ${exact ? `x.textContent.trim() === ${JSON.stringify(txt)}` : `x.textContent.includes(${JSON.stringify(txt)})`});
      if (!b) return null; const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); setTimeout(() => rej(new Error('WS timeout')), 10000); });
    await send('Runtime.enable');
    await send('Input.enable');
    await evalJs(`window.__alerts=[]; window.alert=(m)=>{window.__alerts.push(String(m))}; window.confirm=()=>true; 'ok'`);

    // ===== 0. DB 迁移自检：requirements.create 带 notes 是否可用 =====
    const courses = await evalJs('window.taskAPI.db.courses.list()', true);
    if (!courses || !courses.length) throw new Error('库中没有课程，无法测试');
    const testCourse = courses.find((c) => c.name.includes('微积分')) || courses[0];
    console.log('测试课程:', testCourse.id, testCourse.name);

    const probe = await evalJs(`window.taskAPI.db.requirements.create({ course_id: ${testCourse.id}, title: '__迁移自检__', type: 'homework', due_date: Date.now(), priority: 2, status: 'pending', notes: '自检备注' })`, true);
    const notesOk = probe && Object.prototype.hasOwnProperty.call(probe, 'notes');
    report('DB 迁移：course_requirements 已有 notes 列', notesOk, notesOk ? `notes=${JSON.stringify(probe.notes)}` : '返回行不含 notes 字段');
    if (probe && probe.id) await evalJs(`window.taskAPI.db.requirements.delete(${probe.id})`, true);

    const semStart = await evalJs(`window.taskAPI.db.settings.getAll()`, true);
    report('DB 迁移：开学日 semester_start 已自动写入', !!(semStart && semStart.semester_start), semStart && semStart.semester_start ? new Date(Number(semStart.semester_start)).toISOString().slice(0, 10) : '未写入');

    // ===== 1. 课程页：点击课程 → 基本信息 tab 出现作业概览 =====
    await evalJs(`window.location.hash='#/courses'; 'ok'`);
    await sleep(2500);
    // 点击课程卡片（按课程名找 card）
    const cardCenter = await evalJs(`(() => {
      const els = [...document.querySelectorAll('div[role="button"]')];
      const el = els.find(e => e.textContent.includes(${JSON.stringify(testCourse.name)}));
      if (!el) return null; const r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + 40 });
    })()`);
    if (!cardCenter) throw new Error('找不到课程卡片');
    await clickAt(...Object.values(JSON.parse(cardCenter)));
    await sleep(800);
    const hasOverview = await evalJs(`document.body.textContent.includes('作业 / 要求')`);
    report('点击课程 → 基本信息内显示作业概览', hasOverview);

    // ===== 2. 通过 UI 添加作业（真实鼠标+键盘）=====
    await evalJs(`window.__alerts=[]; 'ok'`);
    let c = await centerOfBtn('添加作业');
    if (!c) throw new Error('找不到「添加作业」按钮');
    await clickAt(...Object.values(JSON.parse(c)));
    await sleep(700);
    const modalTitle = await evalJs(`document.body.textContent.includes('添加作业') && !!document.querySelector('input.input-neon')`);
    report('打开「添加作业」弹窗', modalTitle);

    const TITLE = 'E2E测试作业A';
    let loc = await centerOfLabel('作业标题');
    if (!loc) throw new Error('找不到标题输入框');
    await clickAt(...Object.values(JSON.parse(loc)));
    await typeText(TITLE);
    // 截止时间已默认填充，直接保存
    c = await centerOfBtn('保存', true);
    if (!c) throw new Error('找不到保存按钮');
    await clickAt(...Object.values(JSON.parse(c)));
    await sleep(1500);

    const alerts = JSON.parse(await evalJs('JSON.stringify(window.__alerts)'));
    const created = await evalJs(`window.taskAPI.db.requirements.list({})`, true);
    const row = (created || []).find((r) => r.title === TITLE);
    report('UI 添加作业成功并落库', !!row, row ? `id=${row.id}, notes=${JSON.stringify(row.notes)}, course_id=${row.course_id}` : 'DB 中未找到，alerts=' + JSON.stringify(alerts));
    const listShown = await evalJs(`document.body.textContent.includes(${JSON.stringify(TITLE)})`);
    report('作业列表/概览中可见新作业', listShown);

    // ===== 3. 修改作业（编辑）=====
    if (row) {
      const editOk = await evalJs(`window.taskAPI.db.requirements.update(${row.id}, { title: ${JSON.stringify(TITLE + '-改')}, type: 'homework', due_date: ${row.due_date}, priority: 3, status: 'in_progress', estimated_hours: 2.5, actual_hours: 1, notes: '改后备注' })`, true);
      const check = editOk && editOk.title === TITLE + '-改' && editOk.status === 'in_progress' && editOk.notes === '改后备注';
      report('作业更新（状态/工时/备注）落库', check, check ? '' : JSON.stringify(editOk));
    }

    // ===== 4. 课表日历视图 =====
    // 先离开课程页（重置抽屉状态），再用深链进入课表视图
    await evalJs(`window.location.hash='#/'; 'ok'`);
    await sleep(1200);
    await evalJs(`window.location.hash='#/courses?view=timetable'; 'ok'`);
    await sleep(2000);
    const inTimetable = await evalJs(`document.body.textContent.includes('课表日历')`);
    report('进入课表日历视图', inTimetable);
    const cells = await evalJs(`document.querySelectorAll('[class*="brightness-125"]').length`);
    report('课表日历渲染出课程格子', cells > 0, `本周格子数=${cells}`);
    const weekText = await evalJs(`(() => { const el = [...document.querySelectorAll('div')].find(d => /第 \\d+ 周/.test(d.textContent) && d.textContent.length < 40); return el ? el.textContent.trim() : null; })()`);
    report('显示「第 N 周」', !!weekText && /第 \d+ 周/.test(weekText), weekText || '未找到');
    const headerHasDate = await evalJs(`/\\d{2}-\\d{2} ~ \\d{2}-\\d{2}/.test(document.body.textContent)`);
    report('显示周日期范围', headerHasDate);
    // 周切换
    const nextBtn = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.getAttribute('title') === '下一周');
      if (!b) return null; const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    if (nextBtn) {
      await clickAt(...Object.values(JSON.parse(nextBtn)));
      await sleep(1000);
      const cells2 = await evalJs(`document.querySelectorAll('[class*="brightness-125"]').length`);
      const backBtn = await evalJs(`[...document.querySelectorAll('button')].some(x => x.textContent.includes('回到本周'))`);
      report('切换到下一周（含回到本周按钮）', backBtn, `下周格子数=${cells2}`);
    } else {
      report('周切换按钮', false, '找不到下一周按钮');
    }
    // 图例
    const legendOk = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('●'));
      return btns.length;
    })()`);
    report('课程图例渲染', legendOk > 0, `图例数=${legendOk}`);

    // ===== 5. 清理测试数据 =====
    await evalJs(`window.taskAPI.db.requirements.list({}).then(rs => Promise.all(rs.filter(r => String(r.title).startsWith('E2E测试作业A')).map(r => window.taskAPI.db.requirements.delete(r.id))))`, true);
    const left = await evalJs(`window.taskAPI.db.requirements.list({})`, true);
    report('清理测试数据', !(left || []).some((r) => String(r.title).startsWith('E2E测试作业A')), `剩余 ${(left || []).length} 条作业`);

    done = true;
  } catch (e) {
    console.log('❌ 测试中断:', e.message);
  } finally {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    await sleep(800);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(done && pass === results.length ? 0 : 1);
}

main().catch((e) => { console.log('FATAL:', e.message); process.exit(1); });
