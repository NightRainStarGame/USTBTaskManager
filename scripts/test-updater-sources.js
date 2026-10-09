#!/usr/bin/env node
/**
 * test-updater-sources.js —— 更新链路的快速回归测试（无 Electron）
 *
 * 用 stub 顶替 electron 与 net.fetch，直接跑编译产物 dist-electron 下的模块，
 * 验证「SSIO 单源 + 用户自建镜像」这套逻辑真的能查、能兜底 —— 不需要启动 Electron。
 *
 * 跑法（会先重新编译主进程）：
 *   npm run test:updater
 *   或手动：tsc -p tsconfig.node.json && node scripts/test-updater-sources.js
 *
 * v1.2.17 重写：
 *   上一版断言的是「默认两个源：nrsc.games 主源 + GitHub raw 备源」，而这两个源在
 *   v1.2.15 就随云通道下线删掉了 —— 也就是说 `npm run test:updater` 从此一直跑 scenarios
 *   0 就失败（DEFAULT_UPDATE_SOURCES 只有 1 项，且 URL 全不是那两个），
 *   一个红了两三个版本的测试等于没有测试。
 *   现在测的是**今天真实存在的行为**，并顺手把两个曾经断裂过的地方钉住：
 *     · SSIO KV 键名必须三方一致（v1.2.16 的移动端读错键事故）
 *     · 「引用 → 签名 URL」的现签 protocol（桌面与移动共用同一个函数）
 *
 * 覆盖场景：
 *   0 默认源定义：只有 SSIO 一个，且 URL 带 ssio+ 前缀
 *   1 SSIO 源有更新 → winner 拿到服务端版本，下载地址是 ssio:release:<id> 引用
 *   2 服务端说已是最新 → winner=null，不打扰用户
 *   3 SSIO 不可达 → 安静失败，不误报「尚未配置更新源」
 *   4 用户自建 http 镜像仍然可用（慢重发通道，别删）
 *   5 KV 键名一致性：脚本写、桌面读、移动读，必须是同一个键
 *   6 引用现签：release 走 latest、file 走 files/:id、版本不符要拒绝
 */
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');

/** SSIO 的默认基地址 —— 与 electron/cloud/ssioClient.ts 的 SSIO_DEFAULT_BASE 一致 */
const SSIO_BASE = 'http://120.53.9.81:8100';
/** 默认源的 URL 形式：`ssio+` + 基地址 */
const SSIO_SRC = `ssio+${SSIO_BASE}`;
/** 用户自建 http 镜像（latest.json 直链），默认源之外的第二种形态，仍要能用 */
const MIRROR = 'https://mirror.example.com/taskmanager/latest.json';

let appVersion = '1.2.10';

/** SSIO /v1/releases/latest 的应答（用例可改） */
let ssioRelease = null;
/** SSIO KV 里 taskmgr/latest.json 的字符串值（用例可改） */
let ssioKvRaw = null;
/** 各 http 直链假装返回的清单文本 */
const HTTP_MANIFESTS = {
  [MIRROR]: JSON.stringify({ version: '1.3.0', notes: '自建镜像（比 SSIO 更新）', url: 'https://mirror.example.com/x.exe' }),
};
/** 假装网络不可达的 URL 集合 */
let down = new Set();
/** 本次 fetch 过的 URL，用于断言「查了哪些源」 */
let fetched = [];

function ok200(obj) {
  return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(obj) };
}

const electronStub = {
  app: { getVersion: () => appVersion, getPath: () => os.tmpdir() },
  net: {
    fetch: async (url) => {
      fetched.push(url);
      if (down.has(url) || down.has(SSIO_BASE)) throw new Error('net::ERR_NAME_NOT_RESOLVED');
      if (url.startsWith(`${SSIO_BASE}/v1/releases/latest`)) {
        return ssioRelease ? ok200(ssioRelease) : { ok: false, status: 404, statusText: 'Not Found' };
      }
      if (url.startsWith(`${SSIO_BASE}/v1/kv?key=`)) {
        if (!ssioKvRaw) return { ok: false, status: 404, statusText: 'Not Found' };
        return ok200({ key: 'taskmgr/latest.json', value: ssioKvRaw });
      }
      if (url.startsWith(`${SSIO_BASE}/v1/storage/files/`)) {
        if (!url.includes('/download')) return { ok: false, status: 404, statusText: 'Not Found' };
        return ok200({ url: `${SSIO_BASE}/signed/download/abc?exp=300` });
      }
      const body = HTTP_MANIFESTS[url];
      if (!body) return { ok: false, status: 404, statusText: 'Not Found' };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => body };
    },
  },
  shell: { openPath: async () => '', openExternal: async () => {} },
  ipcMain: { handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

const updater = require(path.join(ROOT, 'dist-electron', 'updater', 'index.js'));
const ssioClient = require(path.join(ROOT, 'dist-electron', 'cloud', 'ssioClient.js'));
const ssioKeys = require('./lib/ssioHttp').SSIO_KEYS;

/** 最小内存版 settings 表，够 getSetting/setSetting 用 */
function makeDb(initial = {}) {
  const store = { ...initial };
  return {
    _store: store,
    prepare() {
      return {
        get: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? { value: store[key] } : undefined),
        run: (key, value) => { store[key] = value; },
      };
    },
  };
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? `   → ${extra}` : ''}`); }
}
const brief = (agg) => agg.perSource
  .map((p) => `${p.source.name}=${p.result.ok ? 'ok' : (p.result.reason || 'fail')}${p.result.latestVersion ? ' v' + p.result.latestVersion : ''}`)
  .join('  ');

(async () => {
  // ── 0) 默认源定义
  console.log('\n【场景 0】默认源定义');
  const def = updater.DEFAULT_UPDATE_SOURCE;
  check('只有一个默认源', Array.isArray(updater.DEFAULT_UPDATE_SOURCES) === false, '数组常量应已删除');
  check('默认源是 SSIO（url 带 ssio+ 前缀）', def.url === SSIO_SRC, def.url);
  check('默认源是主源且启用', def.primary === true && def.enabled === true);
  check('type 标为 ssio', def.type === 'ssio');
  check('getSources(null) 只有 1 个源', updater.getSources(null).length === 1);
  check('getEffectiveSource(null) 回落到默认源', updater.getEffectiveSource(null) === SSIO_SRC);

  // ── 1) SSIO 有更新（含 KV 里的补丁清单）
  console.log('\n【场景 1】SSIO 源有更新');
  down = new Set(); fetched = [];
  ssioRelease = { hasUpdate: true, version: '1.2.16', releaseId: 'rel_abc123', notes: '新版本', mandatory: true, url: null };
  ssioKvRaw = JSON.stringify({
    version: '1.2.16',
    asarSha256: 'aaa',
    patches: [{ fromVersion: '1.2.15', toVersion: '1.2.16', appAsarSha256: 'aaa' }],
  });
  let agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('查了 SSIO', fetched.some((u) => u.startsWith(`${SSIO_BASE}/v1/releases/latest`)));
  check('winner 来自 SSIO，版本取服务端返回的', agg.winner && agg.winner.latestVersion === '1.2.16',
    agg.winner ? String(agg.winner.latestVersion) : 'null');
  check('下载地址是 ssio:release 引用而不是过期签名串',
    agg.winner && agg.winner.downloadUrl === 'ssio:release:rel_abc123',
    agg.winner ? String(agg.winner.downloadUrl) : 'null');
  check('KV 里的补丁清单被带出来了', agg.winner && (agg.winner.patches || []).length === 1);
  check('mandatory 映射到 force', agg.winner && agg.winner.forced === true);
  check('anyConfigured = true', agg.anyConfigured === true);

  // ── 2) 已是最新 → 不打扰
  console.log('\n【场景 2】已是最新');
  down = new Set(); fetched = [];
  appVersion = '1.2.16';
  ssioRelease = { hasUpdate: false, version: null };
  agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('winner = null（不打扰用户）', agg.winner === null);
  check('源本身仍然算成功', agg.perSource.every((p) => p.result.ok === true));
  appVersion = '1.2.10';
  ssioRelease = { hasUpdate: true, version: '1.2.16', releaseId: 'rel_abc123' };

  // ── 3) SSIO 不可达 → 安静失败，不误报
  console.log('\n【场景 3】SSIO 不可达');
  down = new Set([SSIO_BASE]);
  agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('winner = null', agg.winner === null);
  check('失败原因是 network', agg.perSource.every((p) => p.result.reason === 'network'),
    agg.perSource.map((p) => p.result.reason).join(','));
  check('没有误报「尚未配置更新源」', agg.perSource.every((p) => p.result.reason !== 'not_configured'));
  down = new Set();

  // ── 4) 用户自建 http 镜像仍然可用
  console.log('\n【场景 4】用户自建 http 镜像');
  fetched = [];
  ssioRelease = null; ssioKvRaw = null;
  const db = makeDb({
    update_sources: JSON.stringify([{ name: '我的镜像', url: MIRROR, enabled: true, primary: true, type: 'http' }]),
  });
  agg = await updater.checkAllSources(db);
  console.log(`  ${brief(agg)}`);
  const mine = agg.perSource.find((p) => p.source.name === '我的镜像');
  check('用户自定义源被保留并查成功', !!mine && mine.result.ok === true);
  check('http 型源直接 GET latest.json', fetched.includes(MIRROR));
  check('拿到镜像自己的版本号', agg.winner && agg.winner.latestVersion === '1.3.0',
    agg.winner ? String(agg.winner.latestVersion) : 'null');
  // 文档化既有行为：默认 SSIO 源会被自动补进用户源列表（不管用户自己配了什么）
  check('默认 SSIO 源仍被自动补进来（既有行为）',
    agg.perSource.some((p) => p.source.url === SSIO_SRC),
    agg.perSource.map((p) => p.source.url).join(','));

  // ── 5) KV 键名必须三方一致（v1.2.16 事故：移动端读错键，APK 更新静默断线）
  console.log('\n【场景 5】SSIO KV 键名一致性');
  check('客户端 SSIO_KEYS.manifest = taskmgr/latest.json', ssioClient.SSIO_KEYS.manifest === 'taskmgr/latest.json',
    ssioClient.SSIO_KEYS.manifest);
  check('发版脚本用的是同一个键', ssioKeys.manifest === ssioClient.SSIO_KEYS.manifest, ssioKeys.manifest);
  check('about 键同样一致', ssioKeys.about === ssioClient.SSIO_KEYS.about, ssioKeys.about);

  // ── 6) 引用 → 签名 URL（桌面与移动端共用这一份实现）
  console.log('\n【场景 6】引用现签协议');
  const fileUrl = await ssioClient.resolveDownloadRef('ssio:file:file_42', { target: 'desktop' });
  check('file 引用走 /v1/storage/files/:id/download', fileUrl.includes('/signed/download/'), fileUrl);
  let relUrl = null;
  ssioRelease = { hasUpdate: true, version: '1.2.16', url: `${SSIO_BASE}/signed/release/xyz` };
  relUrl = await ssioClient.resolveDownloadRef('ssio:release:rel_abc123', { target: 'desktop', expectVersion: '1.2.16' });
  check('release 引用走 /v1/releases/latest（服务端没有 :id/download）', relUrl.includes('/signed/release/'), relUrl);
  let rejected = false;
  try {
    await ssioClient.resolveDownloadRef('ssio:release:rel_abc123', { target: 'desktop', expectVersion: '9.9.9' });
  } catch (e) {
    rejected = /不一致|可能被回滚/.test(String(e && e.message ? e.message : e));
  }
  check('版本与清单不符 → 拒绝下载（防渠道回滚）', rejected);
  let badRef = false;
  try { await ssioClient.resolveDownloadRef('https://evil.example/a.exe', { target: 'desktop' }); } catch { badRef = true; }
  check('非法引用格式被拒绝', badRef);

  console.log('\n' + '─'.repeat(56));
  console.log(`  结果：${pass} 通过，${fail} 失败`);
  console.log('─'.repeat(56) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('✗ 测试自身异常：', e);
  process.exit(1);
});
