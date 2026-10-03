#!/usr/bin/env node
/**
 * 一次性迁移脚本：把 GitHub 上的班级 / 作业数据搬到 SSIO KV。
 *
 * 背景（v1.2.15）：TaskManager 下线全部 GitHub 云通道，班级与作业只走 SSIO。
 * 但历史数据还躺在两个仓库里 —— 直接删通道会让这些班级再也读不到成员 / 接龙 / 投票。
 * 所以这一步必须在「删 GitHub 分支」之前跑。
 *
 * 为什么是同构搬运：GitHub 里的路径协议（class/<邀请码>/manifest.json、
 * homework/<同步码>.json）与 SSIO KV 的 key 完全一致（见 class/storage.ts 的
 * ssioFilePath、homework/index.ts 的 HOMEWORK_DIR），因此不需要任何字段转换，
 * 文件内容原样写入即可，客户端读起来一模一样。
 *
 * 幂等：重复跑只会覆盖写入相同内容（SSIO KV 是 upsert），可以放心重跑。
 *
 * 用法：
 *   node scripts/migrate-github-to-ssio.js            # 预演，只列文件不写
 *   node scripts/migrate-github-to-ssio.js --execute  # 真正写入 + 回读校验
 *
 * 注意：本机 DNS 常把 raw.githubusercontent.com 解析到 0.0.0.0（投毒），
 * 所以统一走 Contents API + curl --resolve 指定真实 IP。
 */
const { execFileSync } = require('node:child_process');
const dns = require('node:dns').promises;

const SSIO_BASE = process.env.SSIO_BASE || 'http://120.53.9.81:8100';
const SSIO_KEY = process.env.SSIO_PUBLISH_KEY || 'ssio_live_lT2mMap99TOmHetdrnAfqe';
const OWNER = 'NightRainStarGame';

/** 要搬的仓库与根前缀。 */
const TARGETS = [
  { repo: `${OWNER}/USTBTaskManager-Class`, root: 'class', desc: '班级数据' },
  { repo: `${OWNER}/USTBTaskManager`, root: 'homework', desc: '作业码包' },
];

const execute = process.argv.includes('--execute');

function githubToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/password=([^\r\n]+)/);
  if (!m) throw new Error('拿不到 GitHub 凭据（本机 git credential 里没有 github.com 的令牌）');
  return m[1];
}

async function callApi(token, apiIp, repo, path) {
  const out = execFileSync(
    'curl.exe',
    [
      '-s', '--max-time', '30',
      '--resolve', `api.github.com:443:${apiIp}`,
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'Accept: application/vnd.github+json',
      '-H', 'User-Agent: TaskManager-Migrator',
      `https://api.github.com/repos/${repo}/contents/${path}`,
    ],
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`Contents API 返回非 JSON（${path}）：${out.slice(0, 160)}`);
  }
}

/** 递归列出根目录下所有文件（含 base64 内容）。 */
async function collect(token, apiIp, repo, root, path = root, depth = 0, acc = []) {
  const items = await callApi(token, apiIp, repo, path);
  if (!Array.isArray(items)) {
    // 该根不存在（如主仓库没有 class 目录）属于正常情况，跳过而不是报错
    if (items?.message === 'Not Found') {
      console.log(`  · ${repo}/${path} 不存在，跳过`);
      return acc;
    }
    throw new Error(`列出 ${path} 失败：${JSON.stringify(items).slice(0, 160)}`);
  }
  console.log(`  · ${repo}/${path} → ${items.length} 项`);
  for (const it of items) {
    if (it.type === 'dir') {
      if (depth < 6) await collect(token, apiIp, repo, root, it.path, depth + 1, acc);
    } else if (it.type === 'file') {
      // 注意：GitHub 「列目录」的响应里每个条目只有 size/sha，**没有 content**，
      // 必须再按单文件路径请求一次才会带上 base64。所以这里只登记路径，
      // 内容留到第二步取（这样也顺带绕开了被 DNS 投毒的 raw.githubusercontent.com）。
      acc.push({ repo, key: it.path, bytes: it.size });
    }
  }
  return acc;
}

/** 取单个文件的原文。 */
async function fetchText(token, apiIp, repo, path) {
  const j = await callApi(token, apiIp, repo, path);
  if (typeof j?.content !== 'string') {
    throw new Error(`取 ${path} 内容失败：${JSON.stringify(j).slice(0, 160)}`);
  }
  // 服务端返回的 base64 是带换行的 RFC 4648 软换行格式，必须先剥掉空白
  return Buffer.from(j.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

async function kvPut(key, value) {
  const res = await fetch(`${SSIO_BASE}/v1/kv?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': SSIO_KEY },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`写入 ${key} 失败 HTTP ${res.status}：${(await res.text()).slice(0, 160)}`);
  return res.json().catch(() => null);
}

async function kvGetRaw(key) {
  const res = await fetch(`${SSIO_BASE}/v1/kv?key=${encodeURIComponent(key)}`, {
    headers: { 'X-API-Key': SSIO_KEY },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.value ?? null;
}

(async () => {
  const token = githubToken();
  const apiIp = (await dns.resolve4('api.github.com'))[0];
  console.log(`api.github.com -> ${apiIp}`);

  const all = [];
  for (const t of TARGETS) {
    console.log(`\n正在扫描 ${t.repo} /${t.root}（${t.desc}）…`);
    const files = await collect(token, apiIp, t.repo, t.root);
    console.log(`  找到 ${files.length} 个文件，共 ${files.reduce((a, b) => a + b.bytes, 0)} 字节`);
    files.forEach((f) => console.log(`    ${String(f.bytes).padStart(6)}  ${f.key}`));
    all.push(...files);
  }

  console.log(`\n读取文件内容…`);
  for (const f of all) {
    f.text = await fetchText(token, apiIp, f.repo, f.key);
    console.log(`  ✓ ${f.key}（${f.bytes} 字节 → ${f.text.length} 字符）`);
  }

  if (!execute) {
    console.log(`\n[预演] 共 ${all.length} 个文件待迁移。确认无误后加 --execute 真正写入。`);
    return;
  }

  console.log(`\n开始写入 SSIO（${SSIO_BASE}）…`);
  let ok = 0;
  const failed = [];
  for (const f of all) {
    try {
      await kvPut(f.key, f.text);
      console.log(`  ✓ ${f.key}`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${f.key} —— ${e.message}`);
      failed.push(f.key);
    }
  }

  console.log(`\n回读校验…`);
  let verified = 0;
  const mismatch = [];
  for (const f of all) {
    if (failed.includes(f.key)) continue;
    const got = await kvGetRaw(f.key);
    if (got === null) {
      mismatch.push(`${f.key}（读不到）`);
      continue;
    }
    // 内容比较：两边都是 JSON，规范化后比对，避免缩进差异误报
    const norm = (s) => {
      try { return JSON.stringify(JSON.parse(s)); } catch { return s.trim(); }
    };
    if (norm(got) === norm(f.text)) verified++;
    else mismatch.push(f.key);
  }

  console.log(`\n===== 迁移结果 =====`);
  console.log(`成功写入：${ok}/${all.length}`);
  console.log(`校验一致：${verified}/${ok}`);
  if (mismatch.length) console.log(`不一致：\n  ${mismatch.join('\n  ')}`);
  if (failed.length) console.log(`失败：\n  ${failed.join('\n  ')}`);
  console.log(mismatch.length || failed.length ? '存在异常，请修复后再继续删 GitHub 通道' : '全部一致，可以安全下线 GitHub 通道');
})().catch((e) => {
  console.error('迁移失败：', e.message);
  process.exit(1);
});
