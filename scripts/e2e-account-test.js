// E2E 端到端测试（release-0.2.1 / win-unpacked）
// 覆盖：设置账号密码 → 修改密码（错误原密码被拒 + 正确修改）→ 清除密码 → 还原数据 → 输入链路验证
// 用法：node e2e-account-test.js [exePath]
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const exe = process.argv[2] || path.resolve(__dirname, '../release-0.2.1/win-unpacked/TaskManager.exe');
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

async function findPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJSON(`http://127.0.0.1:${PORT}/json`);
      // 优先返回标题非空（已加载完成）的页面
      const ready = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.title);
      if (ready) return ready.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('CDP 未就绪');
}

async function main() {
  console.log('启动应用:', exe);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // 关键：测试必须使用独立的 userData，绝不能碰真实用户数据库
  const os = require('os');
  const fs = require('fs');
  const userData = path.join(os.tmpdir(), `e2e-account-profile-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore', detached: false });
  let done = false;
  try {
    const wsUrl = await findPageWs();
    console.log('CDP 已连接');
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const res = pending.get(m.id); pending.delete(m.id); res(m.result); } };
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 15000);
    });
    const evalJs = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      return r.result ? r.result.value : undefined;
    };
    const clickAt = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(250);
    };
    const typeText = async (text) => {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
        await sleep(40);
      }
      await sleep(150);
    };
    // 页面内查找辅助：按 label 文本找输入框中心、按文本精确/模糊找按钮中心
    const centerOfLabel = (txt) => evalJs(`(() => {
      const lb = [...document.querySelectorAll('label')].find(l => l.textContent.includes('${txt}'));
      const inp = (lb && lb.querySelector('input')) || (lb && lb.parentElement.querySelector('input')) || (lb && lb.nextElementSibling);
      if (!inp) return null; const r = inp.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    const centerOfBtn = (txt, exact = false) => evalJs(`(() => {
      const bs = [...document.querySelectorAll('button')];
      const b = bs.find(x => ${exact ? `x.textContent.trim() === ${JSON.stringify(txt)}` : `x.textContent.includes(${JSON.stringify(txt)})`});
      if (!b) return null; const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    const dbProfiles = () => evalJs('window.taskAPI.db.userProfiles.list()', true);

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('WS error')); setTimeout(() => rej(new Error('WS timeout')), 10000); });
    await send('Runtime.enable');
    await send('Input.enable');

    // 拦截 alert/confirm
    await evalJs(`window.__alerts=[]; window.alert=(m)=>{window.__alerts.push(String(m))}; window.confirm=()=>true; 'ok'`);
    // 跳到设置页
    await evalJs(`window.location.hash='#/settings'; 'ok'`);
    await sleep(2500);

    // ===== 读取初始账户状态（用于测试后还原）=====
    let profiles = await dbProfiles();
    const activeBefore = (profiles || []).find((p) => p.is_active) || null;
    const orig = activeBefore ? { id: activeBefore.id, username: activeBefore.username || '', password_hash: activeBefore.password_hash || '' } : null;
    console.log('初始账户状态:', JSON.stringify(orig));

    // ===== TEST A：设置账号密码（create 模式）=====
    let c = await centerOfBtn('设置账号密码') || await centerOfBtn('设置密码');
    if (!c) { report('A-打开设置账号密码弹窗', false, '找不到入口按钮'); throw new Error('abort'); }
    await clickAt(...(Object.values(JSON.parse(c))));
    await sleep(500);
    let hasNameField = await evalJs(`!![...document.querySelectorAll('label')].find(l => l.textContent.includes('账号名'))`);
    if (hasNameField) {
      // 无账号：create 流程
      c = await centerOfLabel('账号名'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('e2etest'); }
      c = await centerOfLabel('密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('test1234'); }
      c = await centerOfLabel('确认密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('test1234'); }
    } else if (orig && orig.password_hash) {
      // 已有密码：先验证错误原密码，再统一走 password 流程（在 TEST B 处理），这里跳过 A
      report('A-设置账号密码（已有账号密码，create 流程跳过）', true, '转入 B/C/D 流程');
    } else {
      // 有账号无密码：设置密码（password 模式无原密码框）
      c = await centerOfLabel('密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('test1234'); }
      c = await centerOfLabel('确认密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('test1234'); }
    }
    if (hasNameField || !(orig && orig.password_hash)) {
      c = await centerOfBtn('保存', true);
      if (!c) { report('A-保存', false, '找不到保存按钮'); throw new Error('abort'); }
      await clickAt(...(Object.values(JSON.parse(c))));
      await sleep(1200);
      profiles = await dbProfiles();
      const act = (profiles || []).find((p) => p.is_active);
      const okA = act && (act.username === 'e2etest' || (orig && act.id === orig.id)) && act.password_hash && /^[0-9a-f]{64}$/.test(act.password_hash);
      report('A-设置账号密码并落库（SHA-256）', !!okA, JSON.stringify({ username: act && act.username, hash: act && (act.password_hash || '').slice(0, 12) + '…' }));
      const cardOk = await evalJs(`document.body.textContent.includes('密码已设置')`);
      report('A-账户卡显示「密码已设置」', !!cardOk);
    }

    // ===== TEST B：修改密码 — 错误原密码必须被拒 =====
    c = await centerOfBtn('修改密码') || await centerOfBtn('设置密码');
    if (c) {
      await clickAt(...(Object.values(JSON.parse(c))));
      await sleep(500);
      c = await centerOfLabel('原密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('wrongpwd'); }
      c = await centerOfLabel('新密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('newpass99'); }
      c = await centerOfLabel('确认密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('newpass99'); }
      c = await centerOfBtn('保存', true); if (c) await clickAt(...(Object.values(JSON.parse(c))));
      await sleep(800);
      const alerts = await evalJs('JSON.stringify(window.__alerts)');
      const rejected = (await evalJs(`!![...document.querySelectorAll('label')].find(l => l.textContent.includes('原密码'))`)) || JSON.parse(alerts).includes('原密码不正确');
      report('B-错误原密码被拒绝', JSON.parse(alerts).includes('原密码不正确') || rejected, 'alerts=' + alerts);
      // 关闭弹窗
      c = await centerOfBtn('取消', true); if (c) await clickAt(...(Object.values(JSON.parse(c))));
      await sleep(300);

      // ===== TEST C：修改密码 — 正确原密码 =====
      await evalJs(`window.__alerts=[]; 'ok'`);
      const beforeHash = ((await dbProfiles()) || []).find((p) => p.is_active).password_hash;
      c = await centerOfBtn('修改密码');
      if (c) {
        await clickAt(...(Object.values(JSON.parse(c))));
        await sleep(500);
        c = await centerOfLabel('原密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('test1234'); }
        c = await centerOfLabel('新密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('abcd5678'); }
        c = await centerOfLabel('确认密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('abcd5678'); }
        c = await centerOfBtn('保存', true); if (c) await clickAt(...(Object.values(JSON.parse(c))));
        await sleep(1200);
        const afterHash = ((await dbProfiles()) || []).find((p) => p.is_active).password_hash;
        report('C-正确原密码修改成功（哈希已变化）', !!afterHash && afterHash !== beforeHash && /^[0-9a-f]{64}$/.test(afterHash));
      } else {
        report('C-修改密码', false, '找不到修改密码按钮');
      }

      // ===== TEST D：清除密码（留空 = 清除）=====
      await evalJs(`window.__alerts=[]; 'ok'`);
      c = await centerOfBtn('修改密码');
      if (c) {
        await clickAt(...(Object.values(JSON.parse(c))));
        await sleep(500);
        c = await centerOfLabel('原密码'); if (c) { await clickAt(...(Object.values(JSON.parse(c)))); await typeText('abcd5678'); }
        c = await centerOfBtn('保存', true); if (c) await clickAt(...(Object.values(JSON.parse(c))));
        await sleep(1200);
        const act = ((await dbProfiles()) || []).find((p) => p.is_active);
        report('D-留空新密码 = 清除密码', act && !act.password_hash, 'hash=' + JSON.stringify(act && act.password_hash));
        const cardOk = await evalJs(`document.body.textContent.includes('未设置密码')`);
        report('D-账户卡显示「未设置密码」', !!cardOk);
      }
    } else {
      report('B/C/D-密码流程', false, '找不到修改密码入口');
    }

    // ===== TEST E：编辑框真实键盘输入链路 =====
    await evalJs(`window.__alerts=[]; 'ok'`);
    c = await centerOfLabel('姓名');
    if (!c) {
      const diag = await evalJs(`JSON.stringify({
        labels: [...document.querySelectorAll('label')].map(l => l.textContent.trim().slice(0, 12)),
        hash: location.hash,
      })`);
      console.log('诊断:', diag);
    }
    if (c) {
      await clickAt(...(Object.values(JSON.parse(c))));
      await typeText('DOUYA');
      const v = await evalJs(`(() => {
        const lb = [...document.querySelectorAll('label')].find(l => l.textContent.includes('姓名'));
        const inp = (lb && lb.querySelector('input')) || (lb && lb.parentElement.querySelector('input')) || (lb && lb.nextElementSibling);
        return JSON.stringify({ value: inp ? inp.value : null, focused: document.activeElement === inp });
      })()`);
      const parsed = JSON.parse(v);
      report('E-编辑框真实键盘输入', parsed.value === 'DOUYA' && parsed.focused, v);
    }

    // ===== 还原数据库到测试前状态 =====
    try {
      profiles = await dbProfiles();
      if (orig) {
        // 还原 username 和 password_hash（null → ''，即清除）
        await evalJs(`window.taskAPI.db.userProfiles.update(${orig.id}, { username: ${JSON.stringify(orig.username || '')}, password_hash: ${JSON.stringify(orig.password_hash || '')} })`, true);
        // 注意：'' 会清除密码。若原始就有密码，还原为 '' 不等价 —— 原始哈希无法从 renderer 重新生成，但 IPC 不接受明文。
        // 因此：若原始有密码，此处保留 test 密码状态会污染 —— 检查 orig.password_hash 是否非空
        if (orig.password_hash) {
          console.log('⚠️ 原账户本有密码，已将其还原为无密码状态（原哈希无法重建）');
        }
      } else {
        // 测试前无账户：删除测试创建的
        for (const p of profiles || []) {
          if (p.username === 'e2etest') await evalJs(`window.taskAPI.db.userProfiles.delete(${p.id})`, true);
        }
      }
      console.log('✅ 数据已还原');
    } catch (e) {
      console.log('⚠️ 还原失败:', e.message);
    }
    done = true;
  } catch (e) {
    console.log('❌ 测试中断:', e.message);
  } finally {
    try { if (process.platform === 'win32') { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } else { child.kill(); } } catch {}
    await sleep(800);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果: ${pass}/${results.length} 通过 =====`);
  process.exit(done && pass === results.length ? 0 : 1);
}

main().catch((e) => { console.log('FATAL:', e.message); process.exit(1); });
