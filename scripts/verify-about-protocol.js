/**
 * about.txt 多源拉取协议自检（v1.1.7+）
 *
 * 不依赖外网 / 不打云盘，验证：
 *  - aboutUrlForSource 把 raw.githubusercontent.com 上的 latest.json → about.txt
 *  - 自建站点 latest.json?token → about.txt?token（保留 query string）
 *  - getAboutCache 返回默认内容（无缓存时）
 *  - saveAboutLocal 写入 + 读出 + 元数据更新
 *  - setAboutPinned 后 getAboutCache.pinned = true
 *
 * 多源 refresh 测试需要真源，本脚本不覆盖（运行时手动测：
 *   npm run release:one -- 1.1.8 --resume --execute  # 发版时自动推 about.txt
 *   启动 App 看关于页能否拉到新版）
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'about-test-'));
process.env.APPDATA = tmp;

const electronStub = {
  app: { getPath: () => tmp, isPackaged: false },
  ipcMain: { handle: () => {} },
  shell: { showItemInFolder: () => {} },
};
require.cache[require.resolve('electron')] = { exports: electronStub };

// 内存 db（用 node:sqlite，避免依赖 Electron ABI 的 better-sqlite3）
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");

const projRoot = path.resolve(__dirname, '..');
execSync(
  'npx tsc electron/about/index.ts --outDir .test-build --module commonjs --target es2022 --esModuleInterop --skipLibCheck',
  { stdio: 'pipe', cwd: projRoot }
);
const about = require(path.resolve(projRoot, '.test-build/about/index.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 1. URL 转换
ok('gh raw -> about.txt',
  about.aboutUrlForSource({ url: 'https://raw.githubusercontent.com/foo/bar/main/latest.json' }) === 'https://raw.githubusercontent.com/foo/bar/main/about.txt');
ok('gh raw (no main) -> about.txt',
  about.aboutUrlForSource({ url: 'https://raw.githubusercontent.com/foo/bar/main/latest.json?cache=1' }) === 'https://raw.githubusercontent.com/foo/bar/main/about.txt?cache=1');
ok('self latest.json -> about.txt',
  about.aboutUrlForSource({ url: 'https://nrsc.games/downloads/taskmanager/latest.json' }) === 'https://nrsc.games/downloads/taskmanager/about.txt');
ok('self latest.json?token -> about.txt?token（保留 query）',
  about.aboutUrlForSource({ url: 'https://nrsc.games/downloads/taskmanager/latest.json?token=1' }) === 'https://nrsc.games/downloads/taskmanager/about.txt?token=1');
ok('anyshare url 保持不变（云盘走前缀解析）',
  about.aboutUrlForSource({ url: 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469' }) === 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469');

// 2. 默认内容
const c1 = about.getAboutCache(db);
ok('empty returns default text', typeof c1.text === 'string' && c1.text.includes('TaskManager'));
ok('empty pinned=false', c1.pinned === false);
ok('empty source undefined', c1.source === undefined);

// 3. saveAboutLocal
const sample = '# Test\n\nuser edited content';
const r1 = about.saveAboutLocal(db, sample);
ok('saveAboutLocal ok', r1.ok === true);
ok('sha256 returned', typeof r1.sha256 === 'string' && r1.sha256.length === 64);
const c2 = about.getAboutCache(db);
ok('cache text matches', c2.text === sample);
ok('source = 本地编辑', c2.source === '本地编辑');
ok('pulledAt 更新', typeof c2.pulledAt === 'number' && c2.pulledAt > 0);

// 4. setAboutPinned
about.setAboutPinned(db, true);
const c3 = about.getAboutCache(db);
ok('setAboutPinned(1) -> pinned=true', c3.pinned === true);
about.setAboutPinned(db, false);
const c4 = about.getAboutCache(db);
ok('setAboutPinned(0) -> pinned=false', c4.pinned === false);

// 5. 缓存路径
const cachePath = about.aboutCachePath();
ok('cachePath under tmp', cachePath.startsWith(tmp));

// 6. 写一个内容进缓存后从文件读出确认
const sample2 = '# Title\n\n- item 1\n- item 2\n';
fs.writeFileSync(cachePath, sample2, 'utf8');
const c5 = about.getAboutCache(db);
ok('直接从文件读', c5.text === sample2);
ok('mtimeMs > 0', typeof c5.mtimeMs === 'number' && c5.mtimeMs > 0);

// 7. 超大内容拒绝
const big = 'x'.repeat(600 * 1024);
const r2 = about.saveAboutLocal(db, big);
ok('saveAboutLocal 600KB 拒绝', r2.ok === false && /512KB/.test(r2.error || ''));

// 总结
console.log(`\n[about-test] ${pass} passed, ${fail} failed`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
try { fs.rmSync(path.resolve(projRoot, '.test-build'), { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);