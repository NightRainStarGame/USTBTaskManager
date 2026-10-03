/**
 * 把 latest.json 同步到 SSIO KV（key: taskmgr/latest.json）。
 *
 * 为什么需要：v1.2.12 起桌面端更新主源是 SSIO，但 SSIO 的
 * /v1/releases/latest 只认识整包、不认识增量补丁。electron/updater/ssio.ts
 * 会从 KV 里取回完整的清单（patches / urlMirrors / asarSha256），
 * 所以每次发版（或手工补补丁后）都必须把清单同步一次，否则补丁板块不显示。
 *
 * 用法：
 *   node scripts/publish-manifest-kv.js              # 用内置 SSIO 地址与 Key
 *   SSIO_BASE=... SSIO_KEY=... node scripts/publish-manifest-kv.js
 *
 * 凭据：优先读环境变量 SSIO_KEY，其次 SSIO_PUBLISH_KEY，再其次仓库根 .env.local。
 * 兜底用的是**客户端内置那张** Key（release:read + storage:read/write）——
 * 它本来就编译进客户端公开发布，所以写在这里不算新增泄露面；
 * 但仍建议用环境变量覆盖成一张独立的 Key，便于单独吊销。
 * ⚠️ 注意：这张 Key **没有 release:write**，只能写 KV，不能建版本 —— 发版用
 *    publish-release-ssio.js（那边的凭据必须来自环境变量）。
 *
 * 发版脚本（release-one-click.js）会在写盘 latest.json 之后自动调用本脚本。
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KV_KEY = 'taskmgr/latest.json';

/** 从仓库根 .env.local / .env 补齐缺失的环境变量（两者都已 gitignore）。 */
function loadEnvLocal() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const rawLine of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  }
}
loadEnvLocal();

const BASE = process.env.SSIO_BASE || 'http://120.53.9.81:8100';
const KEY = process.env.SSIO_KEY || process.env.SSIO_PUBLISH_KEY || 'ssio_live_OiTftLzMkgh21475jUXmWP';

function put(urlStr, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
          'X-API-Key': KEY,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, body: data });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.write(payload);
    req.end();
  });
}

function get(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { accept: 'application/json', 'X-API-Key': KEY },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('请求超时')));
    req.end();
  });
}

async function main() {
  const latestPath = path.join(ROOT, 'latest.json');
  const value = fs.readFileSync(latestPath, 'utf8');
  const manifest = JSON.parse(value);

  console.log(`同步清单到 SSIO KV：${BASE}  key=${KV_KEY}`);
  console.log(`  本地 latest.json：v${manifest.version}  patches=${(manifest.patches || []).length} 条`);

  const res = await put(`${BASE}/v1/kv?key=${encodeURIComponent(KV_KEY)}`, { value });
  console.log(`  写入：HTTP ${res.status} ${res.body.slice(0, 120)}`);

  // 回读校验：确认服务端存的就是这份（版本 + 补丁条数必须对得上）
  const back = JSON.parse(await get(`${BASE}/v1/kv?key=${encodeURIComponent(KV_KEY)}`));
  const remote = JSON.parse(back.value);
  const okVersion = String(remote.version) === String(manifest.version);
  const okPatches = (remote.patches || []).length === (manifest.patches || []).length;
  console.log(`  回读：v${remote.version}  patches=${(remote.patches || []).length} 条`);
  if (!okVersion || !okPatches) {
    console.error('  ✗ 回读与本地不一致，KV 同步失败');
    process.exit(1);
  }
  console.log('  ✓ KV 清单已同步');
}

main().catch((e) => {
  console.error('KV 同步失败：' + (e && e.message ? e.message : e));
  // 清单同步失败不应阻断发版（整包更新仍可用），只警告
  console.error('（整包更新不受影响，仅增量补丁不可用）');
  process.exit(0);
});
