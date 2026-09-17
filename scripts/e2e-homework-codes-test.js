/**
 * E2E：码制作业同步（v1.1.1）
 *
 * 流程（对打包后的 win-unpacked/TaskManager.exe 用 CDP）：
 *   1. 生成一对码（homework:generateCodes）
 *   2. 验证码对匹配（homework:verifyCodes）✓；错误发布码 ✗
 *   3. 用 git credential 的 GitHub token 保存发布凭据（homework:saveAuth）
 *   4. 发布一条作业（homework:publish）→ 远端 homework/<syncCode>.json
 *   5. 接收（homework:receive）→ 本地课程出现该作业（远程拉取 + DB 断言）
 *   6. 再接收一次 → created=0 updated=1（幂等去重）
 *   7. 清理：删除远端文件 + 还原 DB
 *
 * 运行：node scripts/e2e-homework-codes-test.js <TaskManager.exe 路径>
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXE = process.argv[2] || path.resolve(__dirname, '../release-v1.1.1/win-unpacked/TaskManager.exe');
const CDP_PORT = 9371;
const DB_PATH = path.join(os.tmpdir(), `e2e-hw-codes-${Date.now()}`, 'task-manager.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

(async () => {
  // ---------- 启动 App ----------
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const userData = path.join(os.tmpdir(), `e2e-hw-codes-profile-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  const child = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore' });
  console.log(`[e2e] spawned ${EXE} (pid ${child.pid})`);

  let page = null;
  for (let i = 0; i < 40; i++) {
    await wait(1000);
    try {
      const j = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
      page = j.find((x) => x.type === 'page' && x.url.includes('index.html'));
      if (page) break;
    } catch { /* not ready */ }
  }
  if (!page) { console.error('CDP not ready'); child.kill(); process.exit(1); }
  console.log('[e2e] CDP ready');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const cbs = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && cbs.has(m.id)) { cbs.get(m.id)(m); cbs.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => { const _id = ++id; cbs.set(_id, r); ws.send(JSON.stringify({ id: _id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await wait(2500);
  console.log('[e2e] WS ready, page loaded');

  // ---------- 1. 生成码对 ----------
  console.log('\n== 1. 生成码对 ==');
  const pair = await evaluate(`window.taskAPI.homework.generateCodes()`);
  check('generateCodes 返回 syncCode(8)', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(pair.syncCode), `got ${pair.syncCode}`);
  check('generateCodes 返回 publishCode(12)', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/.test(pair.publishCode), `got ${pair.publishCode}`);

  // ---------- 2. 验证发布码（自包含：前 8 位即同步码） ----------
  console.log('\n== 2. 验证发布码 ==');
  check('publishCode 前 8 位 = syncCode', pair.publishCode.slice(0, 8) === pair.syncCode, `${pair.publishCode} vs ${pair.syncCode}`);
  const okPair = await evaluate(`window.taskAPI.homework.verifyCodes(${JSON.stringify(pair.publishCode)})`);
  check('正确发布码 → ok + 解析出 syncCode', okPair.ok === true && okPair.syncCode === pair.syncCode, JSON.stringify(okPair));
  const badPair = await evaluate(`window.taskAPI.homework.verifyCodes("AAAAAAAAAAAA")`);
  check('编造发布码 → 拒绝', badPair.ok === false);
  const lcPair = await evaluate(`window.taskAPI.homework.verifyCodes(${JSON.stringify(pair.publishCode.toLowerCase())})`);
  check('小写输入 → 规范化后仍通过', lcPair.ok === true);

  // ---------- 3. 保存发布凭据（用 git credential 的 token） ----------
  console.log('\n== 3. 保存发布凭据 ==');
  let token = '';
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
    });
    token = (out.match(/^password=(.+)$/m) || [])[1]?.trim() || '';
  } catch (e) { console.log('  (git credential 不可用：' + e.message.slice(0, 80) + ')'); }
  if (token) {
    const r = await evaluate(`window.taskAPI.homework.saveAuth(${JSON.stringify(token)}, 'e2e-测试员')`);
    check('saveAuth 保存令牌', r.ok === true && r.tokenSet === true);
  } else {
    console.log('  ! 无 token，跳过发布/接收网络用例（仅本地用例）');
  }

  // ---------- 4. 发布（v1.1.3 新接口：publishCode 可选，courseId 自动找/生成 syncCode） ----------
  console.log('\n== 4. 发布作业 ==');
  let published = false;
  if (token) {
    // 先建个空课程拿 courseId，验证 courseSyncCode 自动生成
    const courseName = '[E2E]码制测试课程' + Date.now();
    const createR = await evaluate(`window.taskAPI.db.courses.create({ name: ${JSON.stringify(courseName)}, description: 'e2e temp' })`);
    const courseId = createR?.id;
    const syncR = await evaluate(`window.taskAPI.homework.courseSyncCode(${courseId})`);
    check('courseSyncCode 首次自动生成 8 位码', syncR.ok === true && /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/.test(syncR.syncCode), JSON.stringify(syncR));
    const generatedSyncCode = syncR.syncCode;

    const r = await evaluate(`window.taskAPI.homework.publish({
      courseId: ${courseId},
      courseName: ${JSON.stringify(courseName)},
      sessionDate: '2026-09-17',
      sessionTime: '08:00-09:35',
      title: '[E2E] 第三章习题 1-10',
      content: 'E2E 测试内容：周一交，写全过程',
      type: 'homework',
      dueDate: null
    })`);
    check('publish → ok（无 publishCode）', r.ok === true, r.error || '');
    check('publish 返回的 syncCode = courseSyncCode', r.syncCode === generatedSyncCode, `got ${r.syncCode}`);
    published = r.ok;
    if (!r.ok) console.log('    error: ' + r.error);

    // 把 syncCode 暴露给后续步骤
    pair.syncCode = r.syncCode || pair.syncCode;
    pair.courseId = courseId;
    pair.e2eCourseName = courseName;
  }

  // ---------- 5. 接收 ----------
  console.log('\n== 5. 接收作业 ==');
  if (published) {
    const r = await evaluate(`window.taskAPI.homework.receive(${JSON.stringify(pair.syncCode)})`);
    check('receive → ok', r.ok === true, r.error || '');
    check('课程名匹配', /码制测试课程/.test(r.courseName || ''), `got ${r.courseName}`);
    check('来源 = github', r.source === 'github', `got ${r.source}`);
    check('新增 1 条', r.created === 1, `created=${r.created}`);

    // 幂等：再接收一次 → created=0 updated=1
    const r2 = await evaluate(`window.taskAPI.homework.receive(${JSON.stringify(pair.syncCode)})`);
    check('二次接收幂等（created=0, updated=1）', r2.ok === true && r2.created === 0 && r2.updated === 1, `created=${r2.created} updated=${r2.updated}`);
  } else {
    console.log('  (跳过：未发布)');
  }

  // ---------- 6. 接收不存在 / 课程缺失（v1.1.3 新分支） ----------
  console.log('\n== 6. 接收失败场景 ==');
  const r404 = await evaluate(`window.taskAPI.homework.receive("ZZZZ9999")`);
  check('不存在码 → 报错不崩溃', r404.ok === false && /没有找到|不存在/.test(r404.error || ''), r404.error || '');

  // 新增：先用一个全新 syncCode 发布到不存在的课程名 → 接收时本地无该课程 → 应返回 courseNotFound=true
  if (token) {
    const ghost = await evaluate(`window.taskAPI.homework.generateCodes()`);
    const ghostCourseName = '[E2E-Ghost]' + Date.now();
    const pubR = await evaluate(`window.taskAPI.homework.publish({
      syncCode: ${JSON.stringify(ghost.syncCode)},
      publishCode: ${JSON.stringify(ghost.publishCode)},
      courseName: ${JSON.stringify(ghostCourseName)},
      sessionDate: '2026-09-17',
      title: '[E2E-Ghost] 不存在的课程',
      content: '用于触发 courseNotFound 分支',
      type: 'homework',
      dueDate: null
    })`);
    if (pubR.ok) {
      const recR = await evaluate(`window.taskAPI.homework.receive(${JSON.stringify(ghost.syncCode)})`);
      check('课程缺失 → courseNotFound=true', recR.ok === false && recR.courseNotFound === true && recR.courseName === ghostCourseName, JSON.stringify({ ok: recR.ok, courseNotFound: recR.courseNotFound, courseName: recR.courseName }));
      // 清理远端 ghost 文件
      try {
        const meta = require('child_process').execFileSync('curl', ['-sS', '-H', `Authorization: Bearer ${token}`, `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/contents/homework/${ghost.syncCode}.json?ref=main`], { encoding: 'utf8' });
        const sha = JSON.parse(meta)?.sha;
        if (sha) {
          require('child_process').execFileSync('curl', ['-sS', '-X', 'DELETE', '-H', `Authorization: Bearer ${token}`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ message: `chore: e2e cleanup ghost ${ghost.syncCode}`, sha, branch: 'main' }), `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/contents/homework/${ghost.syncCode}.json`]);
        }
      } catch { /* ignore */ }
    }
  }

  // ---------- 7. UI：入口按钮（先导航到课程页） ----------
  console.log('\n== 7. UI 入口 ==');
  await evaluate(`(function(){
    const link = document.querySelector('a[href="/courses"]') ||
      Array.from(document.querySelectorAll('a,button')).find(el => /课程/.test(el.textContent || ''));
    if (link) link.click();
  })()`);
  await wait(1000);
  const ui = await evaluate(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const entry = btns.find(b => /作业同步/.test(b.textContent || ''));
    if (!entry) return { entry: false };
    entry.click();
    return { entry: true };
  })()`);
  check('右下角「作业同步」入口按钮存在', ui.entry === true);
  if (ui.entry) {
    await wait(400);
    const menu = await evaluate(`(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      return {
        gen: !!btns.find(b => /生成作业码/.test(b.textContent || '')),
        publish: !!btns.find(b => /发布作业/.test(b.textContent || '')),
        receive: !!btns.find(b => /接收作业/.test(b.textContent || '')),
      };
    })()`);
    check('点开出现「生成作业码」子按钮', menu.gen === true);
    check('点开出现「发布作业」子按钮', menu.publish === true);
    check('点开出现「接收作业」子按钮', menu.receive === true);
  }

  // ---------- 8. 清理：删远端文件 ----------
  console.log('\n== 8. 清理 ==');
  if (token && published) {
    // 删 homework/<syncCode>.json（需要 sha）
    const del = await evaluate(`(async function(){
      const token = await window.taskAPI.homework.config();
      return { repo: token.repo };
    })()`);
    // 用主进程 fetch 删除不方便，改用 node 里 curl
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileP = promisify(execFile);
    try {
      // 取 sha
      const meta = await execFileP('curl', ['-sS',
        `-H`, `Authorization: Bearer ${token}`,
        `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/contents/homework/${pair.syncCode}.json?ref=main`]);
      const sha = JSON.parse(meta.stdout)?.sha;
      if (sha) {
        await execFileP('curl', ['-sS', '-X', 'DELETE',
          '-H', `Authorization: Bearer ${token}`,
          '-H', `Content-Type: application/json`,
          '-d', JSON.stringify({ message: `chore: e2e cleanup ${pair.syncCode}`, sha, branch: 'main' }),
          `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/contents/homework/${pair.syncCode}.json`]);
        console.log(`  ✓ 远端 homework/${pair.syncCode}.json 已删除`);
      }
    } catch (e) {
      console.log('  ! 远端清理失败（不影响测试结论，可手动删 homework/' + pair.syncCode + '.json）：' + e.message.slice(0, 120));
    }
  }

  // ---------- 收尾 ----------
  ws.close();
  child.kill();
  await wait(800);
  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E FATAL:', e); process.exit(1); });
