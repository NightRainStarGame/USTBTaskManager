/**
 * E2E：v1.1.4 新功能 — 北科云盘（AnyShare）+ GitHub raw 读 + target=cloud 发布
 *
 * 真实启动打包后的 win-unpacked/TaskManager.exe（隔离 --user-data-dir），
 * 用 CDP 直接调 IPC，**不**真实往云盘上传（用真实匿名云盘太重），
 * 但会跑真实链路：
 *   1) update:config / homework:config 应返回 anyshare 字段
 *   2) update:setSources 接受 anyshare 源（含 password）
 *   3) update:checkAll 失败时返回 friendly 错误（不在校园网）
 *   4) homework:saveCloud / homework:config 回写一致
 *
 * 用法：node scripts/e2e-cloud-source-test.js [exe 路径]
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const projectRoot = path.resolve(__dirname, '..');
const EXE = process.argv[2] || path.join(projectRoot, 'release-v1.1.4/win-unpacked/TaskManager.exe');
const CDP_PORT = 9374;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passCount = 0, failCount = 0;
function check(name, cond, extra = '') {
  if (cond) { passCount++; console.log(`  ✓ ${name}`); }
  else { failCount++; console.log(`  ✗ ${name} ${extra}`); }
}

async function findPage() {
  for (let i = 0; i < 60; i++) {
    await wait(1000);
    try {
      const j = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
      const page = j.find((x) => x.type === 'page' && x.url.includes('index.html'));
      if (page) return page;
    } catch { /* not ready */ }
  }
  throw new Error('60 秒内未找到 CDP page');
}

async function evaluate(page, expr) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener('open', res, { once: true }));
  const id = Math.floor(Math.random() * 1e9);
  const r = await new Promise((res, rej) => {
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
  return r.result?.value;
}

(async () => {
  console.log('[e2e-cloud] start');
  if (!fs.existsSync(EXE)) { console.error(`[e2e-cloud] EXE 不存在: ${EXE}`); process.exit(1); }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  const userData = path.join(os.tmpdir(), `e2e-cloud-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  const child = spawn(EXE, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore' });
  console.log(`[e2e-cloud] spawned ${EXE} (pid ${child.pid})`);

  let cleanup = () => {};
  try {
    const page = await findPage();
    cleanup = () => child.kill();
    console.log(`[e2e-cloud] CDP page: ${page.url}`);

    // 1) homework:config 应包含 cloud 字段（北科云盘默认配置）
    {
      const hw = await evaluate(page, 'window.taskAPI.homework.config()');
      check('homework:config.cloud 非空（默认 AnyShare）', !!hw?.cloud, `cloud=${JSON.stringify(hw?.cloud)}`);
      check('homework:config.cloud.enabled = true', hw?.cloud?.enabled === true);
      check('homework:config.cloud.linkId 16+ 位', typeof hw?.cloud?.linkId === 'string' && hw.cloud.linkId.length >= 16);
      check('homework:config.cloud.password = "kc26"', hw?.cloud?.password === 'kc26');
    }

    // 2) homework:saveCloud 接受新外链
    {
      const r = await evaluate(page, `window.taskAPI.homework.saveCloud({
        url: 'https://yunpan.ustb.edu.cn/link/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        password: 'test123',
        enabled: false,
      })`);
      check('saveCloud 解析 url 成功', r?.ok === true, r?.error);
      check('saveCloud 保存后 enabled=false', r?.cloud?.enabled === false);
      check('saveCloud 保存后 password=test123', r?.cloud?.password === 'test123');
      // 再读回来
      const hw = await evaluate(page, 'window.taskAPI.homework.config()');
      check('homework:config 读到新 linkId', hw?.cloud?.linkId === 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
      // 还原默认
      await evaluate(page, `window.taskAPI.homework.saveCloud({
        url: 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469',
        password: 'kc26',
        enabled: true,
      })`);
    }

    // 3) homework:saveCloud 拒绝非 yunpan 链接
    {
      const r = await evaluate(page, `window.taskAPI.homework.saveCloud({
        url: 'https://example.com/foo',
        password: 'test',
        enabled: true,
      })`);
      check('saveCloud 拒绝非外链格式', r?.ok === false && /不像北科云盘/.test(r?.error || ''), r?.error);
    }

    // 4) update:config 默认三个源（含北科云盘）
    {
      const cfg = await evaluate(page, 'window.taskAPI.updater.config()');
      check('update:config.defaultSources.length === 3', cfg?.defaultSources?.length === 3, `got ${cfg?.defaultSources?.length}`);
      const any = cfg?.defaultSources?.find((s) => s.type === 'anyshare');
      check('默认含 anyshare 源', !!any);
      check('anyshare 源有 password', !!any?.password, `password=${any?.password}`);
      check('anyshare 源 url 以 /link/ 结尾', /\/link\/[A-Z0-9]+$/.test(any?.url || ''), `url=${any?.url}`);
    }

    // 5) update:setSources 接受 anyshare 类型
    {
      const r = await evaluate(page, `window.taskAPI.updater.setSources({
        sources: [
          { name: 'GitHub', url: 'https://raw.githubusercontent.com/foo/bar/main/latest.json', enabled: true, primary: true, type: 'http' },
          { name: '北科云盘', url: 'https://yunpan.ustb.edu.cn/link/AAAAAAAAAAAAAAAAAAAAAA', password: 'pw', enabled: true, primary: false, type: 'anyshare' },
        ],
        activeIndex: 0,
      })`);
      check('setSources 返回 ok', r?.ok === true);
      const any = r?.sources?.find((s) => s.type === 'anyshare');
      check('setSources 保留 anyshare 字段', !!any && any.password === 'pw', JSON.stringify(any));
    }

    // 6) update:checkAll —— 在外网环境，云盘源应该 fail-friendly，不影响其他源
    {
      const r = await evaluate(page, 'window.taskAPI.updater.checkAll()');
      check('updater.checkAll 返回 perSource', Array.isArray(r?.perSource), `keys=${Object.keys(r || {})}`);
      const cloud = r?.perSource?.find((p) => p.source.type === 'anyshare');
      check('云盘源出现在 perSource', !!cloud);
      check('云盘源失败（有 reason=network 或 not_configured 或 parse）', !!cloud?.result?.reason, `reason=${cloud?.result?.reason} msg=${cloud?.result?.message}`);
    }

    console.log(`\n[e2e-cloud] ${passCount} passed, ${failCount} failed`);
    cleanup = () => child.kill();
    process.exit(failCount > 0 ? 1 : 0);
  } catch (e) {
    console.error('[e2e-cloud] error:', e?.message);
    process.exit(2);
  } finally {
    try { cleanup(); } catch { /* ignore */ }
  }
})();