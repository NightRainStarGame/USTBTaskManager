#!/usr/bin/env node
/**
 * e2e-homework-test.js —— 班级作业发布 / 同步 端到端验证（真实 App + 真实 GitHub）
 *
 * 覆盖：
 *   A. 主进程 API 层
 *     1. homework.config：令牌已预填、仓库指向正确
 *     2. 密码验证：错误密码拒绝 / kechuang26 通过
 *     3. publish：错误密码直接被拒；正确密码发布成功（真实写 GitHub）
 *     4. remoteEntries：能读到刚发布的条目
 *     5. sync：拉取并写入本地课程；再 sync 一遍不重复（remote_id 去重）
 *   B. UI 层（CDP 真实点击/输入）
 *     6. 课程页右下角面板存在
 *     7. 发布弹窗：错误密码 → 错误提示；正确密码 → 进入表单
 *   C. 数据清理
 *     - 删除本地测试课程（级联删作业）
 *     - 远端 homework/<测试课程>.json 由脚本结尾提示用 curl 删除（见输出）
 *
 * 用法：
 *   node scripts/e2e-homework-test.js
 *   node scripts/e2e-homework-test.js --exe "release-v1/win-unpacked/TaskManager.exe"
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const eq = k.indexOf('=');
    if (eq >= 0) { o[k.slice(0, eq)] = k.slice(eq + 1); continue; }
    o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 9337);
const EXE = path.resolve(ROOT, String(args.exe || 'release-v1/win-unpacked/TaskManager.exe'));

const TEST_COURSE = 'E2E作业同步测试';
const TEST_TITLE = 'E2E 测试作业（可删除）';
const SESSION_DATE = new Date().toISOString().slice(0, 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  return env;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitForPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error(`等待 CDP 端点超时（127.0.0.1:${PORT}）`);
}

function makeEvaluator(ws) {
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  return function evaluate(expression) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error('求值超时：' + expression.slice(0, 60))); }
      }, 60000);
    });
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败：' + (e.message || '')));
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  班级作业发布 / 同步 E2E（真实 App + 真实 GitHub）');
  console.log('══════════════════════════════════════════════');

  if (!fs.existsSync(EXE)) {
    console.error(`✗ 找不到 App：${EXE}`);
    process.exit(1);
  }
  console.log(`  App：${path.relative(ROOT, EXE)}\n`);

  // 关键：测试必须使用独立的 userData，绝不能碰真实用户数据库
  const os = require('os');
  const testProfile = path.join(os.tmpdir(), `e2e-homework-profile-${Date.now()}`);
  fs.mkdirSync(testProfile, { recursive: true });

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${testProfile}`], {
    cwd: path.dirname(EXE),
    stdio: 'ignore',
    detached: false,
    env: cleanEnv(),
  });

  let ws = null;
  let failed = false;
  let testCourseId = null;
  let remoteEntryId = null;

  try {
    const page = await waitForPage();
    ws = await connect(page.webSocketDebuggerUrl);
    const evaluate = makeEvaluator(ws);
    await evaluate('1');
    const R = (x) => (x && x.result && 'value' in x.result ? x.result.value : x && x.result !== undefined ? x.result : x);

    // ============ A. API 层 ============
    console.log('▶ A1. homework.config');
    const cfg = R(await evaluate('window.taskAPI.homework.config()'));
    check('仓库指向 USTBTaskManager', cfg.repo === 'NightRainStarGame/USTBTaskManager', cfg.repo);
    check('同步目录为 homework/', cfg.dir === 'homework', cfg.dir);
    check('发布令牌已预填（tokenSet）', cfg.tokenSet === true);

    console.log('\n▶ A2. 密码验证');
    const badPw = R(await evaluate(`window.taskAPI.homework.verifyPassword('wrong-password')`));
    check('错误密码被拒绝', badPw.ok === false);
    const goodPw = R(await evaluate(`window.taskAPI.homework.verifyPassword('kechuang26')`));
    check('正确密码 kechuang26 通过', goodPw.ok === true);

    // 建测试课程
    const course = R(await evaluate(`window.taskAPI.db.courses.create(${JSON.stringify({ name: TEST_COURSE, color: '#00FF88' })})`));
    testCourseId = course.id;
    console.log(`\n▶ 已创建测试课程「${TEST_COURSE}」 id=${testCourseId}`);

    console.log('\n▶ A3. 发布（真实写 GitHub）');
    const badPub = R(await evaluate(`window.taskAPI.homework.publish(${JSON.stringify({
      password: 'wrong-password', courseName: TEST_COURSE, sessionDate: SESSION_DATE, title: TEST_TITLE, content: '不该出现',
    })})`));
    check('错误密码发布被拒', badPub.ok === false, badPub.error);

    const pub = R(await evaluate(`window.taskAPI.homework.publish(${JSON.stringify({
      password: 'kechuang26',
      courseName: TEST_COURSE,
      sessionDate: SESSION_DATE,
      sessionTime: '10:00-11:35',
      title: TEST_TITLE,
      content: '这是 E2E 测试发布的作业内容，验证后会被删除。',
      type: 'homework',
    })})`));
    check('发布成功（ok=true）', pub.ok === true, pub.error || '');
    remoteEntryId = pub.entry && pub.entry.id;
    check('拿到稳定条目 ID（uuid）', typeof remoteEntryId === 'string' && remoteEntryId.length >= 32, String(remoteEntryId || '').slice(0, 8) + '…');
    check('拿到仓库文件地址', typeof pub.fileUrl === 'string' && pub.fileUrl.includes('github.com'), pub.fileUrl || '');

    console.log('\n▶ A4. remoteEntries');
    const re = R(await evaluate(`window.taskAPI.homework.remoteEntries(${JSON.stringify(TEST_COURSE)})`));
    check('能读到刚发布的条目', re.ok === true && re.entries.some((e) => e.id === remoteEntryId), `远端共 ${re.entries.length} 条`);
    const reHit = re.entries.find((e) => e.id === remoteEntryId);
    check('远端条目内容完整（标题/日期/内容）', !!reHit && reHit.title === TEST_TITLE && reHit.sessionDate === SESSION_DATE && reHit.content.includes('E2E'), reHit ? `${reHit.title} @ ${reHit.sessionDate}` : '');

    console.log('\n▶ A5. 同步到本地');
    const sync1 = R(await evaluate('window.taskAPI.homework.sync()'));
    check('同步成功（ok=true）', sync1.ok === true, sync1.error || '');
    check('拉到 1 个课程文件', sync1.files === 1, `files=${sync1.files}`);
    check('新增 1 条作业', sync1.created === 1, `created=${sync1.created}`);
    check('涉及课程数 ≥ 1', sync1.coursesTouched >= 1, String(sync1.coursesTouched));

    // DB 断言（渲染进程读列表）
    const reqs = R(await evaluate(`window.taskAPI.db.requirements.list({ courseId: ${testCourseId} })`));
    const hit = reqs.find((r) => r.remote_id === remoteEntryId);
    check('作业已写入测试课程', !!hit, hit ? `「${hit.title}」` : '未找到');
    if (hit) {
      check('source 标记为 github', hit.source === 'github', String(hit.source));
      check('session_date 正确', hit.session_date === SESSION_DATE, String(hit.session_date));
      check('due_date 缺省为上课日 23:59', new Date(hit.due_date).getHours() === 23, new Date(hit.due_date).toLocaleString());
    }

    console.log('\n▶ A6. 重复同步不产生重复（remote_id 去重）');
    const sync2 = R(await evaluate('window.taskAPI.homework.sync()'));
    check('第二次同步 created=0', sync2.ok === true && sync2.created === 0, `created=${sync2.created}`);
    const reqs2 = R(await evaluate(`window.taskAPI.db.requirements.list({ courseId: ${testCourseId} })`));
    const dup = reqs2.filter((r) => r.remote_id === remoteEntryId);
    check('本地该条目仍只有 1 份', dup.length === 1, `count=${dup.length}`);

    // ============ B. UI 层 ============
    console.log('\n▶ B1. 课程页右下角面板');
    await evaluate(`location.hash = '#/courses'`);
    await sleep(800);
    const panelOk = R(await evaluate(`(function(){
      const btns = [...document.querySelectorAll('button')];
      return {
        publish: btns.some(b => b.textContent.includes('发布作业')),
        sync: btns.some(b => b.textContent.includes('同步作业')),
      };
    })()`));
    check('右下角有「发布作业」按钮', panelOk.publish === true);
    check('右下角有「同步作业」按钮', panelOk.sync === true);

    console.log('\n▶ B2. 发布弹窗：密码门槛');
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('发布作业')).click()`);
    await sleep(400);
    const modalShown = R(await evaluate(`!!document.querySelector('.fixed.inset-0') && [...document.querySelectorAll('*')].some(el => el.textContent === '发布密码 *')`));
    check('发布弹窗弹出并停在密码步骤', modalShown === true);

    // 输入错误密码（React 受控输入需走原生 setter）
    await evaluate(`(function(){
      const input = [...document.querySelectorAll('input[type=password]')][0];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'wrong-password');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(150);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('验证密码')).click()`);
    await sleep(600);
    const pwErr = R(await evaluate(`document.body.textContent.includes('密码不正确')`));
    check('错误密码显示「密码不正确」', pwErr === true);

    // 正确密码 → 进入表单
    await evaluate(`(function(){
      const input = [...document.querySelectorAll('input[type=password]')][0];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'kechuang26');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(150);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('验证密码')).click()`);
    await sleep(800);
    const formShown = R(await evaluate(`document.body.textContent.includes('作业标题') && document.body.textContent.includes('上课日期')`));
    check('正确密码后进入作业表单（选课程/日期/书写）', formShown === true);

    const remoteListShown = R(await evaluate(`document.body.textContent.includes('该课程已发布')`));
    check('表单里展示该课程远端已发布列表', remoteListShown === true);

    // 同步弹窗
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '取消').click()`);
    await sleep(300);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('同步作业')).click()`);
    await sleep(400);
    const syncModal = R(await evaluate(`document.body.textContent.includes('从 GitHub 拉取')`));
    check('同步弹窗弹出', syncModal === true);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('立即同步')).click()`);
    await sleep(3000);
    const syncDone = R(await evaluate(`document.body.textContent.includes('同步完成')`));
    check('点击立即同步后显示「同步完成」', syncDone === true);
    const syncSummary = R(await evaluate(`(function(){
      const m = document.body.textContent.match(/新增 (\\d+) 条 · 更新 (\\d+) 条/);
      return m ? m[1] + '/' + m[2] : null;
    })()`));
    check('同步结果统计展示', syncSummary !== null, `新增/更新 = ${syncSummary}`);
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '关闭').click()`);
    await sleep(300);

    // 同步标记（badge）出现在作业列表里：打开测试课程抽屉
    await evaluate(`(function(){
      const card = [...document.querySelectorAll('h3')].find(h => h.textContent === ${JSON.stringify(TEST_COURSE)});
      if (card) card.closest('[role=button]').click();
    })()`);
    await sleep(600);
    const badge = R(await evaluate(`document.body.textContent.includes('同步')`));
    check('同步作业带「同步」标记展示', badge === true);

    failed = results.some((x) => !x.ok);
  } catch (e) {
    console.error('\n✗ 验证过程出错：' + (e && e.message ? e.message : e));
    failed = true;
  } finally {
    // ============ C. 清理本地（无论成败） ============
    try {
      if (ws) {
        if (testCourseId != null) {
          await evaluateSafe(ws, `window.taskAPI.db.courses.delete(${testCourseId})`);
          console.log(`\n🧹 已删除本地测试课程「${TEST_COURSE}」（id=${testCourseId}）`);
        }
        ws.close();
      }
    } catch (e) { console.log('清理时出错：' + e.message); }
    try { child.kill(); } catch { /* ignore */ }
  }

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  结果：${pass}/${results.length} 项通过`);
  if (remoteEntryId) {
    console.log(`\n  ⚠ 远端 GitHub 还留着测试文件 homework/E2E作业同步测试.json`);
    console.log(`    本地已清理；远端请用 cleanup 输出的 curl 命令删除（或在仓库网页删除）。`);
  }
  console.log('══════════════════════════════════════════════');
  process.exit(failed ? 1 : 0);
}

function evaluateSafe(ws, expression) {
  return new Promise((resolve) => {
    let seq = Math.floor(Math.random() * 100000);
    ws.send(JSON.stringify({ id: seq, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    const timer = setTimeout(() => resolve(null), 10000);
    const onMsg = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.id === seq) { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(msg.result); }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', onMsg);
  });
}

main();
