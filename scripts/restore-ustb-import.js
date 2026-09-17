#!/usr/bin/env node
/**
 * restore-ustb-import.js —— 用已保存的 ustb cookie 重新导入课表（数据恢复）
 * 通过 CDP 驱动打包后的真实 App 调用 window.taskAPI.ustb.import()
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9411;
const EXE = path.resolve(ROOT, 'release-v1.1.1-3/win-unpacked/TaskManager.exe');

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
    } catch { /* not yet */ }
    await sleep(500);
  }
  throw new Error('CDP timeout');
}

function makeEvaluator(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return function evaluate(expression) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + expression.slice(0, 60))); } }, 90000);
    });
  };
}

async function main() {
  if (!fs.existsSync(EXE)) { console.error('找不到 App: ' + EXE); process.exit(1); }
  console.log('启动 App（真实数据目录）...');
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    cwd: path.dirname(EXE), stdio: 'ignore', detached: false, env: cleanEnv(),
  });

  let ws;
  try {
    const page = await waitForPage();
    console.log('已连接 CDP:', page.title || page.url);
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const evaluate = makeEvaluator(ws);
    await evaluate('1');

    const st = (await evaluate('window.taskAPI.ustb.status()')).result;
    console.log('ustb status:', JSON.stringify(st.value || st));

    console.log('执行课表导入 (2026-2027 / 1) ...');
    const raw = await evaluate(`window.taskAPI.ustb.import({ xn: '2026-2027', xq: '1', semesterStart: 1788710400000 })`);
    console.log('RAW:', JSON.stringify(raw));
    const res = raw && raw.result;
    const val = res && (res.value !== undefined ? res.value : res);
    console.log('import result:', JSON.stringify(val, null, 2));

    const dbCount = await evaluate('window.taskAPI.db.courses.list()');
    const arr = (dbCount.result && (dbCount.result.value || dbCount.result)) || [];
    console.log('当前课程数:', Array.isArray(arr) ? arr.length : JSON.stringify(arr).slice(0, 200));
    if (Array.isArray(arr)) console.log('课程:', arr.map((c) => c.name).join('、'));
  } catch (e) {
    console.error('恢复失败:', e && e.message ? e.message : e);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch {}
    try { child.kill(); } catch {}
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
}
main();
