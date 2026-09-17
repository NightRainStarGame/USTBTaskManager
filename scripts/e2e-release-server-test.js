// E2E：真实「服务器更新源」布局验证
// 用法：node e2e-release-server-test.js [可选 exe 路径，默认 release-0.3.0/win-unpacked/TaskManager.exe]
//
// 与 e2e-update-test.js 的区别：那个用 mock 服务器返回固定 JSON；
// 这个走**真实流程** —— 用 scripts/release.js 生成清单，放到一个按 nginx 规则
// （MIME + latest.json no-store）提供服务的真实静态目录里，再用打包后的 App 走完更新。
//
// 覆盖：
//   A release.js 生成清单（SHA-256 与独立计算一致、URL 编码正确、自检通过）
//   B release.js --verify 校验线上地址
//   C 静态服务器按推荐配置返回正确的 Content-Type / Cache-Control
//   D App 检查更新 → 发现新版本 + 更新说明
//   E App 下载真实 83MB 安装包 → 落地且 SHA-256 与服务器一致
//   F 校验和错误 → 拒绝安装
//   G url 指向网页/接口 → 拒绝下载并给出网盘提示
//   H 清理
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const projectRoot = path.resolve(__dirname, '..');
const nodeBin = process.execPath;
const providedExe = process.argv[2];
const NEW_VERSION = '0.3.1';
const BAD_SHA_VERSION = '0.3.2';
const HTML_URL_VERSION = '0.3.3';
const APP_PORT = 9441;
const SRV_PORT = 9442;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const SERVER_DIR = path.join(os.tmpdir(), 'tm-release-server');
const DL_DIR = path.join(os.tmpdir(), 'taskmanager-update');
const BASE_URL = `http://127.0.0.1:${SRV_PORT}`;
const MANIFEST_PATH = path.join(SERVER_DIR, 'latest.json');

// ---------- 静态文件服务器（模拟文档里的 nginx 配置） ----------
function startStaticServer(rootDir, port) {
  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); res.end('bad url'); return; }
    const filePath = path.join(rootDir, urlPath);
    if (!filePath.startsWith(rootDir)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('404 not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { 'content-length': st.size };
      if (ext === '.json') headers['content-type'] = 'application/json; charset=utf-8';
      else if (ext === '.exe') headers['content-type'] = 'application/octet-stream';
      else if (ext === '.md') headers['content-type'] = 'text/markdown; charset=utf-8';
      else if (ext === '.txt') headers['content-type'] = 'text/plain; charset=utf-8';
      else headers['content-type'] = 'application/octet-stream';
      // 文档要求：latest.json 必须禁缓存
      if (path.basename(filePath) === 'latest.json') headers['cache-control'] = 'no-store, no-cache, must-revalidate';
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// 注意：必须用异步 execFile。execFileSync 会阻塞本进程事件循环，
// 导致同进程内的静态服务器无法响应子进程请求（表现为 "fetch failed"）。
async function runRelease(args) {
  const { stdout } = await execFileAsync(nodeBin, [path.join(__dirname, 'release.js'), ...args], { cwd: projectRoot });
  return stdout;
}

async function main() {
  // ---------- 准备服务器目录 ----------
  if (fs.existsSync(SERVER_DIR)) fs.rmSync(SERVER_DIR, { recursive: true, force: true });
  if (fs.existsSync(DL_DIR)) fs.rmSync(DL_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(SERVER_DIR, 'files'), { recursive: true });

  const srcExe = path.resolve(
    projectRoot,
    providedExe ? path.join(path.dirname(providedExe), '..', 'TaskManager Setup 0.3.0.exe') : 'release-0.3.0/TaskManager Setup 0.3.0.exe'
  );
  if (!fs.existsSync(srcExe)) {
    console.error('找不到源安装包：' + srcExe);
    process.exit(1);
  }
  // 模拟"新版安装包"：同一份文件改名为新版本号
  const uploadedName = `TaskManager Setup ${NEW_VERSION}.exe`;
  const uploadedPath = path.join(SERVER_DIR, 'files', uploadedName);
  fs.copyFileSync(srcExe, uploadedPath);
  const realSha = sha256File(uploadedPath);
  const realSize = fs.statSync(uploadedPath).size;
  console.log(`服务器目录: ${SERVER_DIR}`);
  console.log(`已上传安装包: files/${uploadedName} (${(realSize / 1048576).toFixed(1)} MB)\n`);

  // ---------- A: release.js 生成清单 ----------
  const notesText = '· 新增服务器更新源支持\n· 修复课程无法添加作业\n· 课表日历周次修正';
  const notesFile = path.join(SERVER_DIR, '_notes.md');
  fs.writeFileSync(notesFile, notesText);
  let out = '';
  try {
    out = await runRelease([
      '--version', NEW_VERSION,
      '--file', uploadedPath,
      '--base-url', BASE_URL,
      '--notes-file', notesFile,
      '--out', SERVER_DIR,
    ]);
  } catch (e) {
    report('A release.js 执行成功', false, String(e.message).slice(0, 200));
  }
  report('A release.js 执行成功', out.includes(`TaskManager v${NEW_VERSION} 发布清单已生成`), '');
  report('A2 自检通过', out.includes('✓ 通过'), (out.match(/自检：.*/) || [''])[0].trim());

  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* ignore */ }
  report('A3 latest.json 已生成且为合法 JSON', !!manifest && manifest.version === NEW_VERSION, manifest ? `version=${manifest.version}` : '无法解析');
  report('A4 清单 SHA-256 与独立计算一致', !!manifest && manifest.sha256 === realSha, manifest ? manifest.sha256.slice(0, 16) + '…' : '');
  const expectUrl = `${BASE_URL}/files/${encodeURIComponent(uploadedName)}`;
  report('A5 下载地址已正确 URL 编码（文件名含空格）', !!manifest && manifest.url === expectUrl, manifest ? manifest.url : '');
  report('A6 更新说明按真实换行写入', !!manifest && (manifest.notes || '').includes('\n· 修复课程'), JSON.stringify((manifest.notes || '').slice(0, 20)) + '…');
  const uploadMd = path.join(SERVER_DIR, `UPLOAD-${NEW_VERSION}.md`);
  report('A7 已生成上传清单 UPLOAD-*.md 且含固定更新地址',
    fs.existsSync(uploadMd) && fs.readFileSync(uploadMd, 'utf8').includes(`${BASE_URL}/latest.json`), '');
  report('A8 已生成归档 releases/<version>.json',
    fs.existsSync(path.join(SERVER_DIR, 'releases', `${NEW_VERSION}.json`)), '');

  // ---------- 启动静态服务器 ----------
  const server = await startStaticServer(SERVER_DIR, SRV_PORT);
  console.log(`\n静态更新源已启动: ${BASE_URL}/latest.json\n`);

  // ---------- B: release.js --verify ----------
  let vOut = '';
  try {
    vOut = await runRelease(['--verify', `${BASE_URL}/latest.json`]);
  } catch (e) {
    vOut = String(e.stdout || '') + String(e.stderr || '');
  }
  report('B --verify 能识别线上清单可用', vOut.includes('连通正常') && vOut.includes('有新版本'), (vOut.match(/判断\s+(.+)/) || [''])[0].trim());
  report('B2 --verify 报告下载地址可用', /下载可用\s+HTTP 200/.test(vOut), (vOut.match(/下载可用.*/) || [''])[0].trim());

  // ---------- C: 服务器响应头符合文档要求 ----------
  const mHead = await fetch(`${BASE_URL}/latest.json`);
  const eHead = await fetch(expectUrl, { method: 'HEAD' });
  report('C latest.json 返回 JSON + no-store',
    /application\/json/.test(mHead.headers.get('content-type') || '') && /no-store/.test(mHead.headers.get('cache-control') || ''),
    `content-type=${mHead.headers.get('content-type')} cache-control=${mHead.headers.get('cache-control')}`);
  report('C2 安装包返回二进制类型（非 text/html）',
    !/text\/html|application\/json/.test(eHead.headers.get('content-type') || ''),
    `content-type=${eHead.headers.get('content-type')} size=${eHead.headers.get('content-length')}`);

  // ---------- 启动 App ----------
  const isPackaged = providedExe && providedExe.endsWith('.exe');
  const exePath = isPackaged ? path.resolve(projectRoot, providedExe) : path.resolve(projectRoot, 'release-0.3.0/win-unpacked/TaskManager.exe');
  if (!fs.existsSync(exePath)) {
    report('启动应用', false, `找不到 ${exePath}`);
    server.close();
    summarize();
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_ENV;
  console.log('启动应用:', exePath);
  const child = spawn(exePath, [`--remote-debugging-port=${APP_PORT}`], { cwd: path.dirname(exePath), env, stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await getJSON(`http://127.0.0.1:${APP_PORT}/json`);
        const ready = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.title);
        if (ready) { wsUrl = ready.webSocketDebuggerUrl; break; }
      } catch { /* retry */ }
      await sleep(500);
    }
    if (!wsUrl) throw new Error('CDP 未就绪');
    console.log('CDP 已连接\n');

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
    const rectOfExpr = (findExpr) => evalJs(`(() => {
      const el = (${findExpr});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()`);
    const centerOfBtn = (txt, exact = false) => rectOfExpr(
      `[...document.querySelectorAll('button')].find(x => ${exact ? `(x.textContent||'').trim() === ${JSON.stringify(txt)}` : `(x.textContent||'').includes(${JSON.stringify(txt)})`})`
    );
    const clickBtn = async (txt, exact = false) => {
      const c = await centerOfBtn(txt, exact);
      if (!c) return false;
      await clickAt(...Object.values(JSON.parse(c)));
      return true;
    };
    const typeText = async (text) => {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) });
        await sleep(10);
      }
      await sleep(150);
    };
    const inputValue = () => evalJs(`(() => {
      const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
      return i ? i.value : null;
    })()`);
    const setSource = async (url) => {
      const info = await rectOfExpr(`[...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'))`);
      if (!info) throw new Error('找不到更新源输入框');
      await clickAt(...Object.values(JSON.parse(info)));
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a' });
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      await sleep(200);
      if (url) await typeText(url);
      await sleep(200);
      if ((await inputValue()) !== url) {
        await evalJs(`(() => {
          const i = [...document.querySelectorAll('input')].find(x => (x.placeholder||'').includes('留空 = 未配置'));
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(i, ${JSON.stringify(url)});
          i.dispatchEvent(new Event('input', { bubbles: true }));
          return i.value;
        })()`);
        await sleep(300);
      }
      await clickBtn('保存地址');
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
    const waitForRegex = async (re, timeout = 60000) => {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < timeout) {
        const t = await bodyText();
        last = t;
        const m = t.match(re);
        if (m) return m[0];
        await sleep(400);
      }
      return (last.match(/✗[^\n]*/) || [])[0] || null;
    };

    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS error')); setTimeout(() => rej(new Error('WS timeout')), 10000); });
    await send('Runtime.enable');
    await send('Input.enable');
    await evalJs(`window.alert=(m)=>{window.__lastAlert=String(m)}; window.confirm=()=>true; 'ok'`);

    const appInfo = await evalJs('window.taskAPI.app.info()', true);
    report('D0 App 版本与清单源包一致', !!appInfo && appInfo.version === '0.3.0', appInfo ? `v${appInfo.version}` : '无返回');

    await evalJs(`window.location.hash='#/settings'; 'ok'`);
    await sleep(2500);

    // ---------- D: 检查更新 ----------
    await setSource(`${BASE_URL}/latest.json`);
    const allSettings = await evalJs('window.taskAPI.db.settings.getAll()', true);
    report('D 更新源地址落库', allSettings.update_source === `${BASE_URL}/latest.json`, `update_source=${allSettings.update_source}`);

    await clickBtn('检查更新');
    const found = await waitForText(`发现新版本 v${NEW_VERSION}`, 30000);
    report('D2 检查到服务器上的新版本', found, found ? `发现新版本 v${NEW_VERSION}` : '未出现');
    report('D3 显示更新说明', (await bodyText()).includes('新增服务器更新源支持'), '');
    report('D4 显示「下载更新」按钮', !!(await centerOfBtn('下载更新')), '');

    // ---------- E: 下载真实安装包 ----------
    await clickBtn('下载更新');
    const done = await waitForText('安装包已下载', 180000);
    const t = await bodyText();
    const dlPath = (t.match(/安装包已下载：(.+)/) || [])[1]?.trim() || path.join(DL_DIR, uploadedName);
    const dlOk = fs.existsSync(dlPath);
    const dlSha = dlOk ? sha256File(dlPath) : '';
    const dlSize = dlOk ? fs.statSync(dlPath).size : 0;
    report('E 下载真实安装包并落地', done && dlOk, `${dlPath} (${(dlSize / 1048576).toFixed(1)} MB)`);
    report('E2 下载文件大小与服务器完全一致', dlSize === realSize, `${dlSize} vs ${realSize}`);
    report('E3 下载文件 SHA-256 与服务器真值一致', dlSha === realSha, dlSha ? dlSha.slice(0, 16) + '…' : '');
    report('E4 显示「立即安装并重启」', !!(await centerOfBtn('立即安装并重启')), '');

    // ---------- F: 校验和不匹配 → 拒绝安装 ----------
    const fakePath = path.join(SERVER_DIR, 'files', 'fake.exe');
    fs.writeFileSync(fakePath, Buffer.alloc(4096, 7));
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
      version: BAD_SHA_VERSION,
      notes: '坏校验和测试',
      url: `${BASE_URL}/files/fake.exe`,
      sha256: 'f'.repeat(64),
    }, null, 2));
    await clickBtn('检查更新');
    const foundBad = await waitForText(`发现新版本 v${BAD_SHA_VERSION}`, 30000);
    report('F 检测到带错误校验和的版本', foundBad, `v${BAD_SHA_VERSION}`);
    await clickBtn('下载更新');
    const shaErr = await waitForRegex(/校验失败|SHA-256 不匹配/, 60000);
    report('F2 校验和错误时拒绝安装并提示', !!shaErr, shaErr ? shaErr.slice(0, 60) : '未出现错误提示');
    report('F3 校验失败的文件已删除（不残留）',
      !fs.existsSync(path.join(DL_DIR, 'fake.exe')), '');

    // ---------- G: url 指向网页/接口 → 拒绝 ----------
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
      version: HTML_URL_VERSION,
      notes: '网页地址测试',
      url: `${BASE_URL}/latest.json`,
    }, null, 2));
    await clickBtn('检查更新');
    const foundHtml = await waitForText(`发现新版本 v${HTML_URL_VERSION}`, 30000);
    report('G 检测到 url 指向接口数据的版本', foundHtml, `v${HTML_URL_VERSION}`);
    await clickBtn('下载更新');
    const htmlErr = await waitForRegex(/不是安装包文件|打开发布页/, 60000);
    report('G2 拒绝把接口数据当安装包并提示网盘场景', !!htmlErr, htmlErr ? htmlErr.slice(0, 60) : '未出现错误提示');

    // ---------- H: 清理 ----------
    await setSource('');
    await evalJs(`window.taskAPI.updater.skipVersion('')`, true);
    const s3 = await evalJs('window.taskAPI.db.settings.getAll()', true);
    try { if (dlOk) fs.unlinkSync(dlPath); } catch { /* ignore */ }
    report('H 设置已还原', s3.update_source === '' && s3.update_skipped_version === '', `update_source='${s3.update_source}'`);

  } catch (e) {
    report('执行异常', false, e.message);
  } finally {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    server.close();
    await sleep(1200);
    // 清理临时目录（避免 83MB 残留）
    try { fs.rmSync(SERVER_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(DL_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    summarize();
  }
}

function summarize() {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n===== 结果: ${passed}/${results.length} 通过 =====`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('失败项:');
    failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? ` (${f.detail})` : '')));
    process.exitCode = 1;
  }
}

main();
