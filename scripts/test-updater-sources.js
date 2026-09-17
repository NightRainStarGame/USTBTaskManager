/**
 * test-updater-sources.js —— 更新模块「多源聚合」的快速回归测试
 *
 * 用 stub 顶替 electron 与 net.fetch，直接跑编译产物 dist-electron/updater/index.js，
 * 验证「双源」这套逻辑真的能查、能排序、能兜底 —— 不需要启动 Electron。
 *
 * 跑法（会先重新编译主进程）：
 *   npm run test:updater
 *   或手动：tsc -p tsconfig.node.json && node scripts/test-updater-sources.js
 *
 * 覆盖场景：
 *   0 默认源定义（主源 = StarOS 自建站，GitHub 为备用）
 *   1 两源都通 → winner 取**版本号最高**的（不是「领先当前版本最多」的那个）
 *   2 主源挂掉 → 备用源仍能兜底升级
 *   3 两源全挂 → winner=null，且不误报「尚未配置更新源」
 *   4 已是最新 → 不提示
 *   5 用户在设置里禁用了备用源 → 只查启用的源
 *   6 用户自定义单源 → 覆盖默认
 */
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '..');

const NRSC = 'https://nrsc.games/downloads/taskmanager/latest.json';
const GH = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/latest.json';

let appVersion = '1.1.0';

/** 各 URL 假装返回的清单 */
const MANIFESTS = {
  [NRSC]: {
    version: '1.2.0',
    notes: '自建源 1.2.0',
    url: 'https://nrsc.games/downloads/taskmanager/leastversion/TaskManager-Setup-1.2.0.exe',
    sha256: 'a'.repeat(64),
  },
  [GH]: {
    version: '1.1.5',
    notes: 'GitHub 源 1.1.5（落后于自建源）',
    url: 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager/main/leastversion/TaskManager-Setup-1.1.5.exe',
  },
};

let down = new Set();
let fetched = [];

const electronStub = {
  app: { getVersion: () => appVersion, getPath: () => os.tmpdir() },
  net: {
    fetch: async (url) => {
      fetched.push(url);
      if (down.has(url)) throw new Error('net::ERR_NAME_NOT_RESOLVED');
      const body = MANIFESTS[url];
      if (!body) return { ok: false, status: 404, statusText: 'Not Found' };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(body),
      };
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
  if (cond) { pass++; console.log(`  \u2713 ${name}`); }
  else { fail++; console.log(`  \u2717 ${name}${extra ? `   → ${extra}` : ''}`); }
}
const names = (agg) => agg.perSource.map((p) => p.source.name).join(' | ');
const brief = (agg) => agg.perSource
  .map((p) => `${p.source.name}=${p.result.ok ? 'ok' : (p.result.reason || 'fail')}${p.result.latestVersion ? ' v' + p.result.latestVersion : ''}`)
  .join('  ');

(async () => {
  // ── 0) 默认源定义
  console.log('\n\u3010\u573a\u666f 0\u3011\u9ed8\u8ba4\u6e90\u5b9a\u4e49');
  const defs = updater.DEFAULT_UPDATE_SOURCES;
  check('共 2 个默认源', defs.length === 2, `实际 ${defs.length}`);
  check('主源是 nrsc.games', defs[0].url === NRSC && defs[0].primary === true, defs[0].url);
  check('备用源是 GitHub 且非主源', defs[1].url === GH && defs[1].primary === false && defs[1].enabled === true);
  check('DEFAULT_UPDATE_SOURCE 与主源一致', updater.DEFAULT_UPDATE_SOURCE === NRSC);
  check('getSources(null) 保持主源标记', updater.getSources(null)[0].primary === true);

  // ── 1) 两源都通，自建源版本更高
  console.log('\n\u3010\u573a\u666f 1\u3011\u4e24\u6e90\u90fd\u901a\uff0c\u81ea\u5efa\u6e90\u7248\u672c\u66f4\u9ad8');
  down = new Set(); fetched = [];
  let agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('两个源都查了', fetched.length === 2, `实际 ${fetched.length}`);
  check('两个源都成功（回归：旧写法会退化成 not_configured）',
    agg.perSource.every((p) => p.result.ok === true),
    agg.perSource.map((p) => p.result.reason).join(','));
  check('perSource 顺序与 getSources 一致（自建源在前）',
    names(agg) === 'StarOS / nrsc.games | GitHub / leastversion', names(agg));
  check('sourceIndex 落位正确（0 / 1）',
    agg.perSource[0].result.sourceIndex === 0 && agg.perSource[1].result.sourceIndex === 1);
  check('winner 取版本最高的 = 自建源 1.2.0',
    agg.winner && agg.winner.latestVersion === '1.2.0' && agg.winner.sourceName === 'StarOS / nrsc.games',
    agg.winner ? `${agg.winner.sourceName} v${agg.winner.latestVersion}` : 'null');
  check('winner 的下载地址来自自建源',
    agg.winner && agg.winner.downloadUrl === MANIFESTS[NRSC].url);
  check('备用源同样是「有更新」，但版本较低仍输给主源',
    agg.perSource[1].result.hasUpdate === true && agg.winner.latestVersion === '1.2.0');
  check('anyConfigured = true', agg.anyConfigured === true);

  // ── 2) 主源挂掉 → GitHub 兜底
  console.log('\n\u3010\u573a\u666f 2\u3011\u4e3b\u6e90\uff08nrsc.games\uff09\u6302\u6389 \u2192 GitHub \u515c\u5e95');
  down = new Set([NRSC]); fetched = [];
  agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('主源标记为网络失败', agg.perSource[0].result.ok === false && agg.perSource[0].result.reason === 'network',
    agg.perSource[0].result.reason);
  check('备用源仍然成功', agg.perSource[1].result.ok === true);
  check('winner 落到 GitHub 的 1.1.5（兜底能升级）',
    agg.winner && agg.winner.sourceName === 'GitHub / leastversion' && agg.winner.latestVersion === '1.1.5',
    agg.winner ? `${agg.winner.sourceName} v${agg.winner.latestVersion}` : 'null');
  check('winner 的下载地址来自 GitHub',
    agg.winner && agg.winner.downloadUrl === MANIFESTS[GH].url);

  // ── 3) 两源全挂 → 安静失败，不误报
  console.log('\n\u3010\u573a\u666f 3\u3011\u4e24\u6e90\u5168\u6302');
  down = new Set([NRSC, GH]);
  agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('winner = null', agg.winner === null);
  check('两个源都是 network 失败',
    agg.perSource.every((p) => p.result.ok === false && p.result.reason === 'network'));
  check('没有误报「尚未配置」', agg.perSource.every((p) => p.result.reason !== 'not_configured'));

  // ── 4) 已是最新 → 不提示
  console.log('\n\u3010\u573a\u666f 4\u3011\u5f53\u524d\u5df2\u662f\u6700\u65b0\uff08\u6bcf\u4e2a\u6e90\u90fd\u4e0d\u9ad8\u4e8e\u672c\u5730\uff09');
  down = new Set(); appVersion = '1.2.0';
  agg = await updater.checkAllSources(null);
  console.log(`  ${brief(agg)}`);
  check('winner = null（不打扰用户）', agg.winner === null);
  check('两个源仍算成功', agg.perSource.every((p) => p.result.ok === true));
  appVersion = '1.1.0';

  // ── 5) 用户禁用了 GitHub 源 → 只查一个
  console.log('\n\u3010\u573a\u666f 5\u3011\u8bbe\u7f6e\u91cc\u7981\u7528\u4e86 GitHub \u6e90');
  const db = makeDb({
    update_sources: JSON.stringify([
      { name: 'StarOS / nrsc.games', url: NRSC, enabled: true, primary: true },
      { name: 'GitHub / leastversion', url: GH, enabled: false, primary: false },
    ]),
  });
  fetched = [];
  agg = await updater.checkAllSources(db);
  console.log(`  ${brief(agg)}`);
  check('只查了 1 个源', fetched.length === 1 && fetched[0] === NRSC, fetched.join(','));
  check('perSource 只有 1 条', agg.perSource.length === 1);
  check('winner = 自建源 1.2.0', agg.winner && agg.winner.latestVersion === '1.2.0');

  // ── 6) 用户自定义单源（覆盖默认）
  console.log('\n\u3010\u573a\u666f 6\u3011\u7528\u6237\u81ea\u5b9a\u4e49\u5355\u6e90');
  const db2 = makeDb({
    update_sources: JSON.stringify([{ name: '我的镜像', url: NRSC, enabled: true, primary: true }]),
  });
  agg = await updater.checkAllSources(db2);
  console.log(`  ${brief(agg)}`);
  check('命中自定义源名称', agg.perSource.length === 1 && agg.perSource[0].source.name === '我的镜像');

  console.log('\n' + '─'.repeat(56));
  console.log(`  \u7ed3\u679c\uff1a${pass} \u901a\u8fc7\uff0c${fail} \u5931\u8d25`);
  console.log('─'.repeat(56) + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n✗ 测试自身异常：', e);
  process.exit(1);
});
