/**
 * 把桌面安装包发布到 SSIO（上传 + 建 release）。
 *
 * 为什么必须有这一步：v1.2.12 起桌面端更新**主源**是 SSIO
 * （electron/updater/ssio.ts 走 /v1/releases/latest）。只发 GitHub / 云盘的话，
 * SSIO 上根本没有这个版本，主源查询返回 hasUpdate=false —— 用户收不到更新。
 * v1.2.13 才发现这个洞（发版脚本此前只推 GitHub + 云盘）。
 *
 * 用法：
 *   node scripts/publish-release-ssio.js <exe 路径> <版本> [notes 文件]
 *   node scripts/publish-release-ssio.js --ping      # 只自检凭据与连通性，不发布
 *
 * 环境变量：SSIO_BASE（默认 http://120.53.9.81:8100）、SSIO_PUBLISH_KEY。
 * 需要 storage:write + release:write scope。
 * 发版脚本（release-one-click.js）会自动调用，失败只告警不阻断。
 *
 * ⚠️ 凭据只能从环境变量 / 仓库根 .env.local 读，绝不能写死在源码里 ——
 * 本仓库是公开的，曾经把带 release:write 的 Key 硬编码进来（等于任何人都能推更新包）。
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.SSIO_BASE || 'http://120.53.9.81:8100';

/**
 * 从仓库根的 .env.local / .env 里补环境变量（两者都已进 .gitignore）。
 * 只补当前进程里缺失的键，不覆盖显式传入的环境变量。
 */
function loadEnvLocal() {
  const root = path.resolve(__dirname, '..');
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const rawLine of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  }
}

loadEnvLocal();
const KEY = process.env.SSIO_PUBLISH_KEY || '';

function requireKey() {
  if (KEY) return;
  console.error(
    [
      '缺少 SSIO 发布凭据：环境变量 SSIO_PUBLISH_KEY 未设置。',
      '',
      '请二选一：',
      '  1) 仓库根建 .env.local（已在 .gitignore 里），写一行：',
      '       SSIO_PUBLISH_KEY=你的Key',
      '  2) 或当前终端先 export SSIO_PUBLISH_KEY=你的Key',
      '',
      '需要 storage:write + release:write scope 的 Key。',
      '⚠️ 不要把 Key 提交进仓库 —— 本仓库是公开的。',
    ].join('\n'),
  );
  process.exit(1);
}

function req(method, urlStr, { headers = {}, body = null, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { accept: 'application/json', 'X-API-Key': KEY, ...headers },
    };
    if (body) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
      opts.headers['content-length'] = buf.length;
      if (!Buffer.isBuffer(body)) opts.headers['content-type'] = 'application/json';
      else opts.headers['content-type'] = 'application/octet-stream';
      opts.body = buf;
    }
    const r = mod.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(d));
          } catch {
            resolve(d);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${method} ${urlStr}: ${d.slice(0, 300)}`));
        }
      });
    });
    r.on('error', reject);
    r.setTimeout(timeout, () => r.destroy(new Error('请求超时')));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function ping() {
  requireKey();
  const apps = await req('GET', `${BASE}/v1/releases?limit=1`);
  const n = Array.isArray(apps) ? apps.length : (apps && apps.items ? apps.items.length : '?');
  console.log(`✓ 凭据可用：${BASE}  已有 release 记录 ${n} 条（抽样 1 条）`);
}

async function main() {
  // 自检模式：不通网络凭据就别等到传完 90MB 才失败
  if (process.argv[2] === '--ping') return ping();

  requireKey();
  const exePath = process.argv[2];
  const version = process.argv[3];
  const notesFile = process.argv[4];
  if (!exePath || !version) {
    console.error('用法: node scripts/publish-release-ssio.js <exe 路径> <版本> [notes 文件]');
    process.exit(1);
  }
  if (!fs.existsSync(exePath)) {
    console.error('找不到安装包：' + exePath);
    process.exit(1);
  }

  const buf = fs.readFileSync(exePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const filename = path.basename(exePath);
  console.log(`发布到 SSIO：${filename}  ${(buf.length / 1048576).toFixed(2)} MB  sha256=${sha256.slice(0, 16)}…`);

  // 1) 初始化分片上传
  const init = await req('POST', `${BASE}/v1/storage/uploads`, {
    body: { filename, totalSize: buf.length, mime: 'application/octet-stream' },
  });
  console.log(`  分片：${init.totalChunks} × ${(init.chunkSize / 1048576).toFixed(1)} MB`);

  // 2) 逐片上传
  for (let i = 0; i < init.totalChunks; i++) {
    const start = i * init.chunkSize;
    const chunk = buf.slice(start, Math.min(start + init.chunkSize, buf.length));
    await req('PUT', `${BASE}/v1/storage/uploads/${init.uploadId}/chunks/${i}`, { body: chunk });
    process.stdout.write(`  上传 ${i + 1}/${init.totalChunks}\r`);
  }
  console.log('');

  // 3) 完成
  const done = await req('POST', `${BASE}/v1/storage/uploads/${init.uploadId}/complete`, { body: { sha256 } });
  console.log(`  文件就位：fileId=${done.fileId}  dedup=${done.dedup}`);

  // 4) 建 release
  const notesMd = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : null;
  const rel = await req('POST', `${BASE}/v1/releases`, {
    body: {
      channel: 'stable',
      platform: 'win',
      arch: 'x64',
      version,
      fileId: done.fileId,
      notesMd,
      published: true,
    },
  });
  console.log(`  ✓ release 建立：v${rel.version} ${rel.platform}/${rel.arch}  ${(rel.sizeBytes / 1048576).toFixed(2)} MB`);

  // 5) 回读验证：以「上一版」的身份查一次，确认客户端能拿到更新
  const probe = await req(
    'GET',
    `${BASE}/v1/releases/latest?platform=win&arch=x64&channel=stable&current=1.2.12&clientId=publish-probe`,
  );
  console.log(`  回读 latest（current=1.2.12）：hasUpdate=${probe.hasUpdate} version=${probe.version || '-'}`);
  if (!probe.hasUpdate) console.log('  [!] 服务端没给出更新，请检查 published / channel / rollout');
}

main().catch((e) => {
  console.error('SSIO 发布失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
