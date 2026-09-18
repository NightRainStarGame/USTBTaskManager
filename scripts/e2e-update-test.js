// E2E：软件更新模块（本地模拟更新源 + 真实 Electron 应用 + CDP 真实交互）
// 用法：node e2e-update-test.js [可选 exe 路径，默认用源码构建加载 dist/]
//
// ⚠️ 2026-09-18（v1.1.4）标记为**过时**：本脚本针对 v1.1.0 单源 UI
//   （placeholder「留空 = 未配置」+「保存地址」按钮），v1.1.1 起多源化后这两个
//   UI 元素已不存在，B-H 用例必然失败（A0 仍可用）。
//   更新链路的现行覆盖：scripts/e2e-cloud-source-test.js（多源 checkAll）+
//   scripts/verify-live-update.js（真实远端 latest.json）。
//   待需要时按新多源 UI 重写（点开「源管理」编辑器 → 填「版本清单 JSON 直链」placeholder）。
//
// 覆盖：
//   A 未配置更新源 → 明确提示
//   B 保存更新源地址 → 落库
//   C 检查更新 → 发现新版本 + 更新说明
//   D 下载更新 → 进度 → 文件落地 + SHA-256 校验
//   E 忽略版本 → 记录 skipped
//   F 更新源是网盘分享页（HTML）→ 退化为「打开发布页」
//   G 更新源不可达 → 友好网络错误
//   H 数据清理（还原设置、删除下载的安装包）
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const providedExe = process.argv[2];
const electronBin = path.join(projectRoot, 'node_modules/electron/dist/electron.exe');
const APP_PORT = 9431;
const SRV_PORT = 9432;
const NEW_VERSION = '0.3.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------- 模拟更新源 ----------
const DUMMY = Buffer.alloc(3 * 1024 * 1024);
for (let i = 0; i < DUMMY.length; i++) DUMMY[i] = (i * 31 + 7) % 256;
const DUMMY_SHA = crypto.createHash('sha256').update(DUMMY).digest('hex');

function startMockServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/latest.json') {
      const manifest = {
        version: NEW_VERSION,
        notes: '· 新增「软件更新」功能：设置页可检查更新、下载并一键安装\n· 修复课表日历周次显示\n· 优化编辑框输入体验',
        url: `http://127.0.0.1:${SRV_PORT}/files/TaskManager%20Setup%20${NEW_VERSION}.exe`,
        page: `http://127.0.0.1:${SRV_PORT}/page`,
        sha256: DUMMY_SHA,
      };
      const body = Buffer.from(JSON.stringify(manifest, null, 2));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length });
      res.end(body);
      return;
    }
    if (url.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': DUMMY.length });
      res.end(DUMMY);
      return;
    }
    if (url === '/page') {
      // 模拟网盘分享页：HTML，且不含任何 x.y.z 版本号
      const html = '<!doctype html><html><head><title>网盘分享</title></head><body><h1>TaskManager 安装包分享</h1><p>请输入提取码后下载</p></body></html>';
      const body = Buffer.from(html);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(SRV_PORT, '127.0.0.1', () => resolve(server)));
}

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

async function main() {
  const server = await startMockServer();
  console.log(`模拟更新源已启动: http://127.0.0.1:${SRV_PORT}/latest.json`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_ENV;
  const isPackaged = providedExe && providedExe.endsWith('.exe');
  const cwd = isPackaged ? path.dirname(path.resolve(projectRoot, providedExe)) : projectRoot;
  // 关键：测试必须使用独立的 userData，绝不能碰真实用户数据库（含 settings 还原逻辑）
  const testProfile = path.join(os.tmpdir(), `e2e-update-profile-${Date.now()}`);
  fs.mkdirSync(testProfile, { recursive: true });
  const args = isPackaged
    ? [`--remote-debugging-port=${APP_PORT}`, `--user-data-dir=${testProfile}`]
    : ['.', `--remote-debugging-port=${APP_PORT}`, `--user-data-dir=${testProfile}`];
  const bin = isPackaged ? path.resolve(projectRoot, providedExe) : electronBin;
  console.log('启动应用:', bin, '（隔离 profile:', testProfile, '）');
  const child = spawn(bin, args, { cwd, env, stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJSON(`http://127.0.0.1:${APP_PORT}/json`);
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
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 30000);
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
    // 注意：设置页很长，目标元素可能在折叠区外 → 点击前必须先滚动到可见区域
    const rectOfExpr = (findExpr, label) => evalJs(`(() => {
      const el = (${findExpr});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), txt: (el.textContent || '').trim().slice(0, 24) });
    })()`);
    const centerOfBtn = (txt, exact = false) => rectOfExpr(
      `[...document.querySelectorAll('button')].find(x => ${exact ? `(x.textContent||'').trim() === ${JSON.stringify(txt)}` : `(x.textContent||'').includes(${JSON.stringify(txt)})`})`,
      txt
    );
    const clickBtn = async (txt, exact = false) => {
      const c = await centerOfBtn(txt, exact);
      if (!c) return false;
      const { x, y } = JSON.parse(c);
      await clickAt(x, y);
      return true;
    };
    const typeText = async (text) => {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
        await sleep(12);
      }
      await sleep(150);
    };
    const centerOfInputByPlaceholder = (frag) => rectOfExpr(
      `[...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes(${JSON.stringify(frag)}))`,
      frag
    );
    const inputValue = () => evalJs(`(() => {
      const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
      return i ? i.value : null;
    })()`);
    const setSource = async (url) => {
      const info = await centerOfInputByPlaceholder('留空 = 未配置');
      if (!info) throw new Error('找不到更新源输入框');
      const { x, y } = JSON.parse(info);
      await clickAt(x, y);
      // 全选 + 删除
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      await sleep(200);
      if (url) await typeText(url);
      await sleep(200);
      const typed = await inputValue();
      if (typed !== url) {
        // 兜底：React 受控输入用原生 setter + input 事件注入，确保状态同步
        await evalJs(`(() => {
          const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(i, ${JSON.stringify(url)});
          i.dispatchEvent(new Event('input', { bubbles: true }));
          return i.value;
        })()`);
        await sleep(300);
      }
      const saved = await clickBtn('保存地址');
      if (!saved) throw new Error('找不到「保存地址」按钮');
      await sleep(700);
    };
    const bodyText = () => evalJs('document.body.innerText');
    const waitForText = async (frag, timeout = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const t = await bodyText();
        if (t.includes(frag)) return true;
        await sleep(300);
      }
      return false;
    };
    const waitForRegex = async (re, timeout = 30000) => {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < timeout) {
        const t = await bodyText();
        last = t;
        const m = t.match(re);
        if (m) return m[0];
        await sleep(400);
      }
      const errLine = (last.match(/✗[^\n]*/) || ['', ''])[0];
      return errLine || null;
    };

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); setTimeout(() => rej(new Error('WS timeout')), 10000); });
    await send('Runtime.enable');
    await send('Input.enable');
    await evalJs(`window.alert=(m)=>{window.__lastAlert=String(m)}; window.confirm=()=>true; 'ok'`);

    // ===== 进入设置页 =====
    await evalJs(`window.location.hash='#/settings'; 'ok'`);
    await sleep(2500);

    const appInfo = await evalJs('window.taskAPI.app.info()', true);
    report('A0 应用信息接口可用', !!appInfo && !!appInfo.version, appInfo ? `当前版本 v${appInfo.version}` : '无返回');

    // ===== A 未配置更新源 =====
    await setSource('');
    await clickBtn('检查更新');
    await sleep(1500);
    const t1 = await bodyText();
    report('A 未配置更新源时给出明确提示', t1.includes('尚未配置更新源地址'), t1.match(/尚未配置[^\n]{0,40}/)?.[0] || '');

    // ===== B 保存更新源 =====
    const srcUrl = `http://127.0.0.1:${SRV_PORT}/latest.json`;
    await setSource(srcUrl);
    const allSettings = await evalJs('window.taskAPI.db.settings.getAll()', true);
    report('B 更新源地址保存到数据库', allSettings.update_source === srcUrl, `update_source=${allSettings.update_source}`);

    // ===== C 检查更新 =====
    await clickBtn('检查更新');
    const found = await waitForText(`发现新版本 v${NEW_VERSION}`, 25000);
    const t2 = await bodyText();
    report('C 检查到新版本并显示版本号', found, found ? `发现新版本 v${NEW_VERSION}` : '未出现');
    report('C2 显示更新说明（notes）', t2.includes('新增「软件更新」功能') || t2.includes('软件更新') , '');
    report('C3 显示「下载更新」按钮', !!(await centerOfBtn('下载更新')), '');

    // ===== D 下载更新 =====
    const downloaded = await clickBtn('下载更新');
    report('D0 点击「下载更新」', downloaded, '');
    const done = await waitForText('安装包已下载', 90000);
    await sleep(800);
    const t3 = await bodyText();
    const pathMatch = t3.match(/安装包已下载：(.+)/);
    const dlPath = pathMatch ? pathMatch[1].trim() : path.join(os.tmpdir(), 'taskmanager-update', `TaskManager Setup ${NEW_VERSION}.exe`);
    const exists = fs.existsSync(dlPath);
    let hashOk = false;
    let size = 0;
    if (exists) {
      const buf = fs.readFileSync(dlPath);
      size = buf.length;
      hashOk = crypto.createHash('sha256').update(buf).digest('hex') === DUMMY_SHA;
    }
    report('D 安装包下载完成并落地', done && exists, `${dlPath} (${(size / 1048576).toFixed(1)} MB)`);
    report('D2 SHA-256 校验通过', hashOk, hashOk ? '与更新源声明一致' : '不匹配');
    report('D3 显示「立即安装并重启」按钮', !!(await centerOfBtn('立即安装并重启')), '');

    // ===== E 忽略此版本 =====
    const ignored = await clickBtn(`忽略 v${NEW_VERSION}`);
    await sleep(800);
    const s2 = await evalJs('window.taskAPI.db.settings.getAll()', true);
    const t4 = await bodyText();
    report('E 忽略版本已记录', s2.update_skipped_version === NEW_VERSION, `update_skipped_version=${s2.update_skipped_version}`);
    report('E2 提示已忽略', t4.includes('已忽略'), '');

    // 忽略后再检查（非强制）不应再提示为「新版本可用」
    const silent = await evalJs('window.taskAPI.updater.check()', true);
    report('E3 非强制检查会跳过已忽略版本', silent && silent.skipped === true, `skipped=${silent && silent.skipped}`);

    // ===== F 网盘分享页（HTML）→ 退化为打开发布页 =====
    await setSource(`http://127.0.0.1:${SRV_PORT}/page`);
    await clickBtn('检查更新');
    await sleep(2500);
    const t5 = await bodyText();
    report('F 识别为网盘分享页并给出提示', t5.includes('无法识别为版本清单'), t5.match(/更新源内容[^\n]{0,30}/)?.[0] || '');
    report('F2 提供「打开发布页」按钮', !!(await centerOfBtn('打开发布页')), '');

    // ===== G 不可达地址 =====
    await setSource('http://127.0.0.1:59999/nope.json');
    await clickBtn('检查更新');
    const gMsg = await waitForRegex(/(连接失败|网络不可达|请求超时|拒绝连接|HTTP 4\d\d|ERR_[A-Z_]+)/, 30000);
    report('G 更新源不可达时给出网络错误提示', !!gMsg, gMsg ? gMsg.slice(0, 60) : '未在 30 秒内出现错误提示');

    // ===== H 清理 =====
    await setSource('');
    await evalJs(`window.taskAPI.updater.skipVersion('')`, true);
    const s3 = await evalJs('window.taskAPI.db.settings.getAll()', true);
    try { if (exists) fs.unlinkSync(dlPath); } catch {}
    const leftover = fs.existsSync(dlPath);
    report('H 设置已还原且测试文件已清理', s3.update_source === '' && s3.update_skipped_version === '' && !leftover,
      `update_source='${s3.update_source}' skipped='${s3.update_skipped_version}' 文件残留=${leftover}`);

  } catch (e) {
    report('执行异常', false, e.message);
  } finally {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    server.close();
    await sleep(1200);
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n===== 结果: ${passed}/${results.length} 通过 =====`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log('失败项:');
      failed.forEach((f) => console.log('  - ' + f.name));
      process.exitCode = 1;
    }
  }
}

main();
