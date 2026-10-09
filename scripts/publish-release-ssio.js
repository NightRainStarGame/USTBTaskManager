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
const path = require('path');
const crypto = require('crypto');
// v1.2.17：凭据加载 / HTTP 原语 / 默认地址都从这里来，本文件只留下发布流程本身
const { createSsioClient } = require('./lib/ssioHttp');

const ssio = createSsioClient({ requireKey: true });
const BASE = ssio.base;

async function ping() {
  const apps = (await ssio.get(`${BASE}/v1/releases?limit=1`)).json;
  const n = Array.isArray(apps) ? apps.length : (apps && apps.items ? apps.items.length : '?');
  console.log(`✓ 凭据可用：${BASE}  已有 release 记录 ${n} 条（抽样 1 条）`);
}

async function main() {
  // 自检模式：不通网络凭据就别等到传完 90MB 才失败
  if (process.argv[2] === '--ping') return ping();

  // ── v1.2.15 纯存储模式：只传文件拿 fileId，不建 release ──
  // 用途：增量补丁 zip（latest.json 里记 ssio:file:<id>）。
  // 用法: node scripts/publish-release-ssio.js --storage <对象名> <文件路径>
  if (process.argv[2] === '--storage') {
    const key = process.argv[3];
    const file = process.argv[4];
    if (!key || !file || !fs.existsSync(file)) {
      console.error('用法: node scripts/publish-release-ssio.js --storage <对象名> <文件路径>');
      process.exit(1);
    }
    const buf = fs.readFileSync(file);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    console.log(`上传到 SSIO storage：${key}  ${(buf.length / 1048576).toFixed(2)} MB  sha256=${sha256.slice(0, 16)}…`);
    const init = (await ssio.request('POST', `${BASE}/v1/storage/uploads`, {
      body: { filename: path.basename(key), totalSize: buf.length, mime: 'application/zip' },
    })).json;
    for (let i = 0; i < init.totalChunks; i++) {
      const start = i * init.chunkSize;
      const chunk = buf.slice(start, Math.min(start + init.chunkSize, buf.length));
      await ssio.request('PUT', `${BASE}/v1/storage/uploads/${init.uploadId}/chunks/${i}`, { body: chunk });
      process.stdout.write(`  上传 ${i + 1}/${init.totalChunks}\r`);
    }
    console.log('');
    const done = (await ssio.request('POST', `${BASE}/v1/storage/uploads/${init.uploadId}/complete`, { body: { sha256 } })).json;
    // 把 fileId 落盘给 release-one-click.js 读（比解析 stdout 稳）
    fs.writeFileSync(path.join(process.cwd(), '.ssio-last-storage.json'), JSON.stringify({ fileId: done.fileId, key, sha256 }));
    console.log(`  ✓ 存储就位：fileId=${done.fileId}  dedup=${done.dedup}`);
    return;
  }

  // ── release 模式（默认）：传文件 + 建 release 记录 ──
  const exePath = process.argv[2];
  const version = process.argv[3];
  const notesFile = process.argv[4];
  const platform = process.argv.includes('--platform') ? process.argv[process.argv.indexOf('--platform') + 1] : 'win';
  const arch = process.argv.includes('--arch') ? process.argv[process.argv.indexOf('--arch') + 1] : 'x64';
  if (!exePath || !version) {
    console.error('用法: node scripts/publish-release-ssio.js <exe 路径> <版本> [notes 文件] [--platform win|android] [--arch x64|arm64]');
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
  const init = (await ssio.request('POST', `${BASE}/v1/storage/uploads`, {
    body: { filename, totalSize: buf.length, mime: 'application/octet-stream' },
  })).json;
  console.log(`  分片：${init.totalChunks} × ${(init.chunkSize / 1048576).toFixed(1)} MB`);

  // 2) 逐片上传
  for (let i = 0; i < init.totalChunks; i++) {
    const start = i * init.chunkSize;
    const chunk = buf.slice(start, Math.min(start + init.chunkSize, buf.length));
    await ssio.request('PUT', `${BASE}/v1/storage/uploads/${init.uploadId}/chunks/${i}`, { body: chunk });
    process.stdout.write(`  上传 ${i + 1}/${init.totalChunks}\r`);
  }
  console.log('');

  // 3) 完成
  const done = (await ssio.request('POST', `${BASE}/v1/storage/uploads/${init.uploadId}/complete`, { body: { sha256 } })).json;
  console.log(`  文件就位：fileId=${done.fileId}  dedup=${done.dedup}`);

  // 4) 建 release
  const notesMd = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : null;
  const rel = (await ssio.request('POST', `${BASE}/v1/releases`, {
    body: {
      channel: 'stable',
      platform,
      arch,
      version,
      fileId: done.fileId,
      notesMd,
      published: true,
    },
  })).json;
  console.log(`  ✓ release 建立：v${rel.version} ${rel.platform}/${rel.arch}  ${(rel.sizeBytes / 1048576).toFixed(2)} MB`);
  // v1.2.15：releaseId 落盘给清单脚本读（latest.json 记 ssio:release:<id>）。
  // 按 platform 分开落盘：一次发版会先传桌面包再传 APK，同一个标记文件会互相覆盖。
  const marker = platform === 'android' ? '.ssio-last-release-android.json' : '.ssio-last-release.json';
  fs.writeFileSync(
    path.join(process.cwd(), marker),
    JSON.stringify({ releaseId: rel.id || rel.releaseId, platform, arch, version }),
  );

  // 5) 回读验证：current 用一个必然落后的版本 —— 服务端在 hasUpdate=false 时
  // 只返回 { hasUpdate: false }（不带 version），拿刚发的版本号当 current 会
  // 让「回读版本不一致」的告警恒误报（v1.2.15/1.2.16 发版日志里那句 [!] 就是它）。
  const probe = (await ssio.get(
    `${BASE}/v1/releases/latest?platform=${platform}&arch=${arch}&channel=stable&current=0.0.1&clientId=publish-probe`,
  )).json;
  console.log(`  回读 latest（platform=${platform}）：hasUpdate=${probe.hasUpdate} version=${probe.version || '-'}`);
  if (probe.version !== version) console.log('  [!] 回读版本不一致，请检查服务端记录');
}

main().catch((e) => {
  console.error('SSIO 发布失败：' + (e && e.message ? e.message : e));
  process.exit(1);
});
