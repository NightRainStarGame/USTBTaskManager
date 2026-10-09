/**
 * 发版脚本的 SSIO 客户端 —— 单个出口。
 *
 * v1.2.17：以前 publish-release-ssio.js / publish-manifest-kv.js 各自重写了
 * 「读 .env.local + 手搓 node:http 请求 + 默认地址/键名」三件套，migrate 脚本还用了第三份
 * （global fetch）。改动默认服务器地址要改 2~3 处，加个 header 改 2 处。
 * 现在所有脚本 import 这一个模块：请求原语、凭据加载、地址默认值各只有一份实现。
 *
 * ⚠️ 凭据只能来自环境变量 / 仓库根 .env.local（两者都已 gitignore）。本仓库公开，
 *    曾经把带 release:write 的 Key 硬编码进源码（等于任何人都能推更新包），已吊销。
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

/** 默认服务器。nrsc.games 域名被 DNSPod 拦截（未备案），先用 IP 直连。 */
const DEFAULT_BASE = 'http://120.53.9.81:8100';

/**
 * SSIO KV 键名表 —— **与客户端必须保持一致**。
 *
 * 客户端那份在 electron/cloud/ssioClient.ts 的 SSIO_KEYS。
 * v1.2.16 的教训：脚本写 `taskmgr/latest.json`、移动端却读裸键 `latest.json`，
 * APK 更新静默断了好几个版本都没人发现（键名错本身不报错，只是永远读不到）。
 * 两边改任一个，请同步另一个。
 */
const SSIO_KEYS = {
  /** 完整更新清单（latest.json 原文，含 patches / urlMirrors / asarSha256） */
  manifest: 'taskmgr/latest.json',
  /** 关于页文案 */
  about: 'taskmgr/about.txt',
};

/**
 * 内置客户端 Key：release:read + storage:read/write，**无 release:write**。
 * 与 electron/cloud/ssioClient.ts 的 SSIO_BUILTIN_KEY 同值 —— 它编译进客户端分发，
 * 等同公开，所以只够用来写 KV（同步清单），发 release 必须用更高权限的环境变量凭据。
 */
const SSIO_BUILTIN_KEY = 'ssio_live_OiTftLzMkgh21475jUXmWP';

/** 从仓库根的 .env.local / .env 补环境变量；不覆盖显式传入的值。 */
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  }
}

class HttpError extends Error {
  constructor(status, text, urlStr, method) {
    super(`HTTP ${status} ${method} ${urlStr}: ${text.slice(0, 300)}`);
    this.status = status;
  }
}

/**
 * 建一个会发请求的 SSIO 客户端。
 *
 * @param opts.allowBuiltinKey  允许退回内置只读 Key（只有写 KV 的权限）。
 *                              发布 release **必须显式传 false**，缺凭据就直接失败，
 *                              不能静默降级 —— 降级会发出「看起来成功但没有更新」的假发版。
 * @param opts.requireKey       true 时缺凭据直接 exit(1) 并打印指引（发布脚本用）。
 */
function createSsioClient({ allowBuiltinKey = false, requireKey = false } = {}) {
  loadEnvLocal();
  const base = String(process.env.SSIO_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const key = process.env.SSIO_KEY || process.env.SSIO_PUBLISH_KEY || (allowBuiltinKey ? SSIO_BUILTIN_KEY : '');

  if (requireKey && !key) {
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

  /**
   * 发一个请求。**非 2xx 一律抛错** —— 写 KV / 发 release 都是「必须真的成功」的操作，
   * 静默吞掉状态码会得到「看起来发完了、用户却收不到更新」的假成功。
   * @returns {Promise<{status:number, text:string, json:any}>}
   */
  function request(method, urlStr, { headers = {}, body = null, timeout = 600000 } = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const opts = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: { accept: 'application/json', 'X-API-Key': key, ...headers },
      };
      if (body) {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
        opts.headers['content-length'] = buf.length;
        opts.headers['content-type'] = Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json';
        opts.body = buf;
      }
      const r = mod.request(opts, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            let json = null;
            try {
              json = d ? JSON.parse(d) : null;
            } catch {
              json = null; // 非 JSON 响应：调用方自己用 text
            }
            resolve({ status: res.statusCode, text: d, json });
          } else {
            reject(new HttpError(res.statusCode, d, urlStr, method));
          }
        });
      });
      r.on('error', reject);
      r.setTimeout(timeout, () => r.destroy(new Error('请求超时')));
      if (opts.body) r.write(opts.body);
      r.end();
    });
  }

  return {
    base,
    key,
    kvKeys: SSIO_KEYS,
    request,
    get: (urlStr, opts) => request('GET', urlStr, opts),
    /** 写一条 KV（value 必须是字符串：服务端按文本存，客户端按 JSON 解） */
    putKv: (key2, value) => request('PUT', `${base}/v1/kv?key=${encodeURIComponent(key2)}`, { body: { value } }),
    getKv: (key2) => request('GET', `${base}/v1/kv?key=${encodeURIComponent(key2)}`),
  };
}

module.exports = { createSsioClient, loadEnvLocal, SSIO_KEYS, DEFAULT_BASE, SSIO_BUILTIN_KEY, HttpError, ROOT };
