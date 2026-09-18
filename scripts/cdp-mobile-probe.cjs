/* CDP 探针：加载页面 → 收集 console/error/异常 → 输出 root 文本与状态 */
const fs = require('fs');

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:4175/index-mobile.html';
  const res = await fetch('http://127.0.0.1:9333/json/version').catch(() => null);
  void res;
  // spawn chrome with CDP
  const { spawn } = require('child_process');
  const CHROME = 'C:/Users/NRSG-/.agent-browser/browsers/chrome-153.0.8010.47/chrome.exe';
  const userDataDir = 'E:/University/TaskManager/.cdp-profile-mobile';
  const port = 9333;
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,1000',
  ], { stdio: 'ignore', detached: false });
  console.log('chrome pid:', child.pid);

  // wait for CDP
  let version = null;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await r.json();
      break;
    } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!version) { console.log('CDP FAILED'); child.kill(); process.exit(1); }

  // open new target
  const targetRes = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const target = await targetRes.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  let seq = 0; const calls = new Map(); const events = [];
  ws.addEventListener('message', (e) => {
    const j = JSON.parse(e.data);
    if (j.id && calls.has(j.id)) { calls.get(j.id)(j); calls.delete(j.id); return; }
    if (j.method === 'Runtime.consoleAPICalled') {
      const args = (j.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      events.push(`[console.${j.params.type}] ${args}`);
    }
    if (j.method === 'Runtime.exceptionThrown') {
      const d = j.params.exceptionDetails;
      events.push(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`);
    }
    if (j.method === 'Log.entryAdded') {
      const d = j.params.entry;
      events.push(`[log.${d.level}] ${d.source}: ${d.text} ${d.url || ''}`);
    }
  });
  function call(method, params = {}) {
    return new Promise(r => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); calls.set(id, r); });
  }
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  // 注入拦截（页面脚本执行前）
  await call('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errors = [];
      window.addEventListener('error', e => window.__errors.push('ERROR: ' + (e.message || '') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')));
      window.addEventListener('unhandledrejection', e => window.__errors.push('REJECTION: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
      window.__origError = console.error;
      console.error = (...a) => { window.__errors.push('CONSOLE.ERROR: ' + a.map(x => x && (x.stack || x.message) || String(x)).join(' ')); window.__origError(...a); };
    `,
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Log.enable');
  await call('Page.navigate', { url });
  await new Promise(r => setTimeout(r, 9000));

  const state = await call('Runtime.evaluate', {
    expression: `JSON.stringify({
      mobile: window.__MOBILE__ === true,
      hasTaskAPI: typeof window.taskAPI === 'object',
      errors: window.__errors || [],
      rootText: (document.getElementById('root')?.innerText || '').slice(0, 300),
      rootChildren: document.getElementById('root')?.children.length ?? -1,
      theme: document.documentElement.dataset.theme,
      channels: (window.__MOBILE__ ? 'n/a' : 'n/a'),
    })`,
    returnByValue: true,
  });
  console.log('STATE:', state.result?.result?.value);

  const idb = await call('Runtime.evaluate', {
    expression: `(async () => {
      const dbs = await indexedDB.databases();
      return JSON.stringify(dbs.map(d => d.name));
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  console.log('IDB:', idb.result?.result?.value);

  console.log('--- 页面事件 ---');
  for (const ev of events.slice(0, 40)) console.log(ev);

  ws.close();
  child.kill();
  setTimeout(() => process.exit(0), 500);
}
main().catch(e => { console.error('PROBE ERR', e); process.exit(1); });
