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
const path = require('path');
// v1.2.17：HTTP 原语、凭据加载、默认地址、KV 键名都从 shared 出来，本文件只剩同步流程
const { createSsioClient, SSIO_KEYS, ROOT } = require('./lib/ssioHttp');

const ssio = createSsioClient({ allowBuiltinKey: true });
const BASE = ssio.base;

async function main() {
  const latestPath = path.join(ROOT, 'latest.json');
  const value = fs.readFileSync(latestPath, 'utf8');
  const manifest = JSON.parse(value);

  console.log(`同步清单到 SSIO KV：${BASE}  key=${SSIO_KEYS.manifest}`);
  console.log(`  本地 latest.json：v${manifest.version}  patches=${(manifest.patches || []).length} 条`);

  const res = await ssio.putKv(SSIO_KEYS.manifest, value);
  console.log(`  写入：HTTP ${res.status} ${res.text.slice(0, 120)}`);

  // 回读校验：确认服务端存的就是这份（版本 + 补丁条数必须对得上）
  const back = (await ssio.getKv(SSIO_KEYS.manifest)).json;
  const remote = JSON.parse(back.value);
  const okVersion = String(remote.version) === String(manifest.version);
  const okPatches = (remote.patches || []).length === (manifest.patches || []).length;
  console.log(`  回读：v${remote.version}  patches=${(remote.patches || []).length} 条`);
  if (!okVersion || !okPatches) {
    console.error('  ✗ 回读与本地不一致，KV 同步失败');
    process.exit(1);
  }
  console.log('  ✓ KV 清单已同步');

  // v1.2.15：顺带同步 about.txt。客户端 electron/about/index.ts 已改从 KV 取
  // （SSIO_KEYS.about），不再依赖 GitHub raw / 云盘 —— 不同步这里，关于页就
  // 只能显示本地内置版。失败只警告，不阻断发版。
  const aboutPath = path.join(ROOT, 'about.txt');
  if (fs.existsSync(aboutPath)) {
    try {
      const about = fs.readFileSync(aboutPath, 'utf8');
      await ssio.putKv(SSIO_KEYS.about, about);
      console.log(`  ✓ about.txt 已同步（${about.length} 字符）`);
    } catch (e) {
      console.log(`  [!] about.txt 同步失败：${e && e.message ? e.message : e}`);
    }
  } else {
    console.log('  [i] 仓库根没有 about.txt，跳过（关于页将用本地兜底）');
  }
}

main().catch((e) => {
  console.error('KV 同步失败：' + (e && e.message ? e.message : e));
  // 清单同步失败不应阻断发版（整包更新仍可用），只警告
  console.error('（整包更新不受影响，仅增量补丁不可用）');
  process.exit(0);
});
