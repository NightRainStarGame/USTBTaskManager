/**
 * 发版辅助：把 latest.json + 安装包上传到北科云盘（AnyShare）分享根目录
 * 供「北科云盘更新源」的校内用户升级。
 *
 * 用法：node scripts/upload-release-to-ustbcloud.js <exe路径> [latest.json路径]
 */
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
// 直接复用主进程的 AnyShare 客户端（编译产物，不依赖 electron API —— asFetch 用的是 net.fetch，
// 但脚本环境没有 electron；这里做一个轻量 polyfill：用 Node 原生 fetch + 手动 redirect 处理）
const fs = require('fs');

const LINK_URL = 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469';
const PASSWORD = 'kc26';
const BASE = 'https://yunpan.ustb.edu.cn';
const LINK_ID = LINK_URL.split('/').pop();

// ===== AnyShare 极简客户端（Node 版，独立于 electron/anyshare.ts）=====
async function jfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 120000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []);
    return { status: res.status, ok: res.ok, text, cookies };
  } finally { clearTimeout(timer); }
}

let token = '';
async function getToken() {
  if (token) return token;
  const form = new URLSearchParams({
    id: LINK_ID, type: 'anonymous', password: PASSWORD, password_required: 'true',
    verify_mobile: 'false', submit_type: '', vcode_id: '', verifying_tel: '',
    title: 'Homework', item_type: 'folder', belongs_to: 'document',
  });
  const r = await jfetch(`${BASE}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (r.status !== 302 && r.status !== 200) throw new Error(`提取码验证失败 HTTP ${r.status}`);
  const m = r.cookies.find((c) => c.startsWith(`link_token:${LINK_ID}=`));
  if (!m) throw new Error('未拿到 link_token（外链失效或密码错）');
  token = m.split(';')[0].split('=').slice(1).join('=');
  return token;
}

async function api(p, body) {
  const t = await getToken();
  const r = await jfetch(`${BASE}${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}

async function getRoot() {
  const r = await api('/api/efast/v1/entry-item');
  if (!r.ok) throw new Error(`entry-item HTTP ${r.status}`);
  const arr = JSON.parse(r.text);
  if (!Array.isArray(arr) || !arr[0]?.id) throw new Error('分享根目录为空');
  return String(arr[0].id);
}

async function listFiles(root) {
  const r = await api('/api/efast/v1/dir/list', { docid: root, by: 'name', sort: 'asc' });
  if (!r.ok) throw new Error(`dir/list HTTP ${r.status}`);
  return JSON.parse(r.text).files || [];
}

async function upload(root, name, buf) {
  const begin = await api('/api/efast/v1/file/osbeginupload', {
    client_mtime: Math.floor(Date.now() / 1000),
    docid: root, length: buf.length, name, ondup: 1, reqmethod: 'POST',
  });
  if (!begin.ok) throw new Error(`osbeginupload HTTP ${begin.status}: ${begin.text.slice(0, 200)}`);
  const info = JSON.parse(begin.text);
  if (!info?.authrequest) throw new Error('无上传凭证');
  const [method, uploadUrl, ...pairs] = info.authrequest;
  const fields = {};
  for (const p of pairs) { const i = p.indexOf(':'); fields[p.slice(0, i)] = p.slice(i + 2); }

  const boundary = `----TaskManager${Date.now()}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(buf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  const up = await jfetch(uploadUrl, {
    method,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    timeoutMs: 30 * 60 * 1000,
  });
  if (up.status !== 204 && !up.ok) throw new Error(`直传 HTTP ${up.status}`);

  const end = await api('/api/efast/v1/file/osendupload', { docid: info.docid, rev: info.rev });
  if (!end.ok) throw new Error(`osendupload HTTP ${end.status}`);
  return true;
}

// ===== 主流程 =====
(async () => {
  // --only-about：单独推送 about.txt（不传 exe / latest.json / 补丁），用户改了关于文本后快速推
  const args = process.argv.slice(2);
  const ONLY_ABOUT = args.includes('--only-about');
  const exePath = args.find((a) => !a.startsWith('--'));
  const jsonPath = args.find((a) => a.endsWith('.json') && !a.startsWith('--')) || path.join(projectRoot, 'latest.json');

  console.log('[cloud] 登录北科云盘…');
  await getToken();
  const root = await getRoot();

  if (ONLY_ABOUT) {
    const aboutLocal = path.join(projectRoot, 'about.txt');
    if (!fs.existsSync(aboutLocal)) { console.error('[cloud] about.txt 不存在:', aboutLocal); process.exit(1); }
    const ts = Date.now();
    const buf = fs.readFileSync(aboutLocal);
    await upload(root, `about-${ts}.txt`, buf);
    console.log(`[cloud] ✓ about-${ts}.txt (${buf.length} B)`);
    process.exit(0);
  }

  if (!exePath || !fs.existsSync(exePath)) { console.error('用法: node upload-release-to-ustbcloud.js <exe路径> [latest.json] [--only-about]'); process.exit(1); }
  console.log('[cloud] 分享根 docid:', root.slice(0, 20) + '…');

  const before = await listFiles(root);
  console.log('[cloud] 当前文件:', before.map((f) => f.name).join(', ') || '(空)');

  // latest.json：匿名不能覆盖，用时间戳版本名
  const ts = Date.now();
// v1.1.6：anonymous 分享里安装包按 "<basename>-<ts>.exe" 命名（不能覆盖）。
  // 同步给云盘的 latest.json 里 url 字段要写成 basename（不带 ts），App 端
  // resolveDownloadUrl 按 base 前缀找最新一份换签名直链。
  const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
  const jsonObj = JSON.parse(jsonRaw);
  const baseExeName = path.basename(exePath).replace(/\.exe$/i, '') + '.exe';
  jsonObj.url = baseExeName;
  jsonObj.fileName = baseExeName;
  if (!jsonObj.page) jsonObj.page = 'https://github.com/NightRainStarGame/USTBTaskManager/releases';

  // v1.1.7：增量补丁同步上传（命名范式 TaskManager-Patch-<from>-to-<to>.zip）。
  // patches[].url 在 GitHub 版 latest.json 里是 raw 绝对链；云盘版改写成云盘内
  // 的 basename（App 端 resolveDownloadUrl 按前缀找最新一份换签名直链）。
  const patchUploads = [];
  if (Array.isArray(jsonObj.patches)) {
    for (const p of jsonObj.patches) {
      if (!p || typeof p.url !== 'string' || /^https?:\/\//i.test(p.url) !== true) continue;
      const rel = p.url.split(`/${process.env.PATCH_REPO_BRANCH || 'main'}/`)[1];
      if (!rel) continue;
      const local = path.join(projectRoot, rel);
      if (!fs.existsSync(local)) { console.log(`[cloud] 补丁本地不存在，跳过: ${rel}`); continue; }
      const baseName = path.basename(local);
      patchUploads.push({ local, baseName, entry: p });
    }
  }

  // patches[].url 改写成云盘 basename 后再上传清单
  for (const u of patchUploads) u.entry.url = u.baseName;
  const jsonBuf2 = Buffer.from(JSON.stringify(jsonObj, null, 2) + '\n', 'utf8');
  await upload(root, `latest-${ts}.json`, jsonBuf2);
  console.log(`[cloud] ✓ latest-${ts}.json (${jsonBuf2.length} B, patches=${(jsonObj.patches || []).length})`);

  // 安装包：<版本>-<时间戳>.exe（App 端按文件名前缀取最新）
  const exeName = path.basename(exePath);
  const exeBuf = fs.readFileSync(exePath);
  const cloudExeName = exeName.replace(/\.exe$/i, '') + `-${ts}.exe`;
  console.log(`[cloud] 上传安装包 ${cloudExeName}（${(exeBuf.length / 1024 / 1024).toFixed(1)} MB）…`);
  await upload(root, cloudExeName, exeBuf);
  console.log(`[cloud] ✓ ${cloudExeName}`);

  // about.txt（v1.1.7）：仓库根常驻，云盘也同步一份 about-<ts>.txt
  const aboutLocal = path.join(projectRoot, 'about.txt');
  if (fs.existsSync(aboutLocal)) {
    const buf = fs.readFileSync(aboutLocal);
    const cloudAboutName = `about-${ts}.txt`;
    console.log(`[cloud] 上传关于文本 ${cloudAboutName}（${buf.length} B）…`);
    await upload(root, cloudAboutName, buf);
    console.log(`[cloud] ✓ ${cloudAboutName}`);
  } else {
    console.log('[cloud] about.txt 不存在，跳过');
  }

  // 补丁包：<basename>-<时间戳>.zip（App 端 resolveDownloadUrl 按前缀取最新）
  for (const u of patchUploads) {
    const buf = fs.readFileSync(u.local);
    const cloudName = u.baseName.replace(/\.zip$/i, '') + `-${ts}.zip`;
    console.log(`[cloud] 上传补丁 ${cloudName}（${(buf.length / 1024 / 1024).toFixed(1)} MB）…`);
    await upload(root, cloudName, buf);
    console.log(`[cloud] ✓ ${cloudName}`);
  }

  const after = await listFiles(root);
  console.log('[cloud] 上传后文件清单:');
  for (const f of after) console.log(`   ${f.name}  (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
  console.log('[cloud] 完成');
})().catch((e) => { console.error('[cloud] 失败:', e.message); process.exit(1); });
