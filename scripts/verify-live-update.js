#!/usr/bin/env node
/**
 * verify-live-update.js —— 用「打包后的真实 App」验证线上更新链路
 *
 * 做的事：
 *   1. 启动 release-build/win-unpacked/TaskManager.exe（带 CDP 远程调试）
 *   2. 通过 DevTools 协议调用渲染进程里的 window.taskAPI.updater.config() / check()
 *   3. 断言：更新源地址已配置、能连上、能解析出版本号
 *   4. 关闭 App
 *
 * 为什么必须用真实 App 而不是 curl：
 *   Electron 用的是 Chromium 网络栈（net.fetch），与 curl 走的路径不同，
 *   代理 / 证书 / DNS 表现可能不一致，只有真跑一遍才算验证。
 *
 * 用法：
 *   node scripts/verify-live-update.js
 *   node scripts/verify-live-update.js --exe "release-build/win-unpacked/TaskManager.exe"
 *   node scripts/verify-live-update.js --expect 0.3.1     # 期望线上是某个版本（可选）
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
const PORT = Number(args.port || 9333);
const EXE = path.resolve(ROOT, String(args.exe || 'release-build/win-unpacked/TaskManager.exe'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 剥掉会让 Electron 退化成 Node 的环境变量 */
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

/** 在页面里执行表达式并取回结果（支持 Promise） */
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
      }, 40000);
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
  console.log('  线上更新链路验证（真实 App）');
  console.log('══════════════════════════════════════════════');

  if (!fs.existsSync(EXE)) {
    console.error(`✗ 找不到 App：${EXE}\n  请先执行 npm run build:exe`);
    process.exit(1);
  }
  console.log(`  App：${path.relative(ROOT, EXE)}\n`);

  // 关键：宿主环境可能带着 ELECTRON_RUN_AS_NODE / NODE_OPTIONS，
  // 会让 Electron 应用退化成纯 Node 进程（报 "bad option: --remote-debugging-port"）。
  // 另外必须使用独立的 userData——更新链路验证不需要真实数据，
  // 且曾因使用真实 DB 导致测试后数据被连带清理（2026-09-17 课表丢失事故）。
  const testProfile = path.join(require('node:os').tmpdir(), `verify-update-profile-${Date.now()}`);
  fs.mkdirSync(testProfile, { recursive: true });

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${testProfile}`], {
    cwd: path.dirname(EXE),
    stdio: 'ignore',
    detached: false,
    env: cleanEnv(),
  });

  let ws = null;
  let failed = false;
  try {
    const page = await waitForPage();
    console.log(`  已连接 CDP：${page.title || page.url}\n`);
    ws = await connect(page.webSocketDebuggerUrl);
    const evaluate = makeEvaluator(ws);
    await evaluate('1'); // 探活

    // ---- 1. 配置 ----
    const cfg = (await evaluate(`window.taskAPI.updater.config()`)).result;
    console.log('▶ 更新源配置');
    console.log(`  defaultSource : ${cfg.value ? cfg.value.defaultSource : cfg.defaultSource}`);
    console.log(`  source（生效）: ${cfg.value ? cfg.value.source : cfg.source}`);
    console.log(`  autoCheck     : ${cfg.value ? cfg.value.autoCheck : cfg.autoCheck}\n`);

    const conf = cfg.value || cfg;
    check('更新源已配置（非空）', !!(conf.defaultSource || conf.source), conf.source || '(空)');
    check(
      '默认地址指向 GitHub 仓库',
      /github(usercontent)?\.com/i.test(conf.defaultSource || ''),
      conf.defaultSource
    );

    // ---- 2. 检查更新 ----
    console.log('\n▶ 执行更新检查（真实网络请求）');
    const res = (await evaluate(`window.taskAPI.updater.check({ force: true })`)).result;
    const r = res.value || res;
    console.log('  原始返回：' + JSON.stringify(r, null, 2).split('\n').join('\n  ') + '\n');

    check('网络请求成功（ok=true）', r.ok === true, r.reason ? `reason=${r.reason}` : '');
    check('配置被识别', r.configured === true);
    check('解析出线上版本号', !!r.latestVersion, String(r.latestVersion));
    check('拿到安装包直链', !!r.downloadUrl, String(r.downloadUrl || ''));
    check('拿到 SHA-256', /^[a-f0-9]{64}$/i.test(r.sha256 || ''), String(r.sha256 || '').slice(0, 16) + '…');
    check('能算出是否有新版本', typeof r.hasUpdate === 'boolean',
      `当前 ${r.currentVersion} → 线上 ${r.latestVersion}，hasUpdate=${r.hasUpdate}`);

    if (args.expect) {
      check(`线上版本等于 ${args.expect}`, r.latestVersion === String(args.expect), String(r.latestVersion));
    }

    failed = results.some((x) => !x.ok);
  } catch (e) {
    console.error('\n✗ 验证过程出错：' + (e && e.message ? e.message : e));
    failed = true;
  } finally {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
  }

  const pass = results.filter((x) => x.ok).length;
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  结果：${pass}/${results.length} 项通过`);
  console.log('══════════════════════════════════════════════');
  process.exit(failed ? 1 : 0);
}

main();
