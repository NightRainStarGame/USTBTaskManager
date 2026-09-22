/**
 * 发版辅助：把 latest.json + 安装包 + 补丁 + about.txt 上传到北科云盘（AnyShare）
 * 供「北科云盘更新源」的校内用户升级。
 *
 * 用法：
 *   node scripts/upload-release-to-ustbcloud.js <exe路径> [latest.json路径]
 *   node scripts/upload-release-to-ustbcloud.js --only-about    # 只推 about.txt
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const LINK_URL = 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469';
const PASSWORD = 'kc26';
const BASE = 'https://yunpan.ustb.edu.cn';
const LINK_ID = LINK_URL.split('/').pop();

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

(async () => {
  const args = process.argv.slice(2);
  const ONLY_ABOUT = args.includes('--only-about');
  const ONLY_PATCHES = args.includes('--only-patches');
  const exePath = ONLY_PATCHES ? null : args.find((a) => !a.startsWith('--'));
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

  if (!ONLY_PATCHES && (!exePath || !fs.existsSync(exePath))) { console.error('用法: node upload-release-to-ustbcloud.js <exe路径> [latest.json] [--only-about] [--only-patches]'); process.exit(1); }
  console.log('[cloud] 分享根 docid:', root.slice(0, 20) + '…');

  const before = await listFiles(root);
  console.log('[cloud] 当前文件:', before.map((f) => f.name).join(', ') || '(空)');

  const ts = Date.now();
  const jsonRaw = fs.readFileSync(jsonPath, 'utf8');
  const jsonObj = JSON.parse(jsonRaw);
  // 匿名不能覆盖：安装包按 "<basename>-<ts>.exe" 上传，latest.json 里 url 改成 basename（不带 ts），
  // App 端 resolveDownloadUrl 按 base 前缀找最新一份换签名直链
  // （--only-patches 时不重传 exe，basename 从现有 manifest url 提取）
  const exeUrlBase = exePath ? path.basename(exePath) : path.basename(String(jsonObj.url || jsonObj.fileName || ''));
  const baseExeName = exeUrlBase.replace(/\.exe$/i, '') + '.exe';
  jsonObj.url = baseExeName;
  jsonObj.fileName = baseExeName;
  if (!jsonObj.page) jsonObj.page = 'https://github.com/NightRainStarGame/USTBTaskManager/releases';

  // 增量补丁：raw 绝对链 → 云盘 basename；命名范式 TaskManager-Patch-<from>-to-<to>.zip
  const patchUploads = [];
  if (Array.isArray(jsonObj.patches)) {
    for (const p of jsonObj.patches) {
      if (!p || typeof p.url !== 'string' || /^https?:\/\//i.test(p.url) !== true) continue;
      // rel 提取：raw URL 按 /main/ 分隔；GitHub Release URL（v1.2.7+ 主源）则依次回退
      // urlMirrors 里的 raw 条目 → 约定路径 leastversion/patches/<basename>
      const branch = process.env.PATCH_REPO_BRANCH || 'main';
      const candidates = [p.url, ...(Array.isArray(p.urlMirrors) ? p.urlMirrors : [])];
      let rel = null;
      for (const u of candidates) {
        if (typeof u !== 'string') continue;
        const r = u.split(`/${branch}/`)[1];
        if (r) { rel = r; break; }
      }
      let local = rel ? path.join(projectRoot, rel) : null;
      if (!local || !fs.existsSync(local)) {
        const guess = path.join(projectRoot, 'leastversion', 'patches', path.basename(p.url));
        if (fs.existsSync(guess)) { local = guess; rel = path.relative(projectRoot, guess); }
      }
      if (!local || !fs.existsSync(local)) { console.log(`[cloud] 补丁本地不存在，跳过: ${rel || p.url}`); continue; }
      const baseName = path.basename(local);
      patchUploads.push({ local, baseName, entry: p });
    }
  }
  for (const u of patchUploads) u.entry.url = u.baseName;
  const jsonBuf2 = Buffer.from(JSON.stringify(jsonObj, null, 2) + '\n', 'utf8');
  await upload(root, `latest-${ts}.json`, jsonBuf2);
  console.log(`[cloud] ✓ latest-${ts}.json (${jsonBuf2.length} B, patches=${(jsonObj.patches || []).length})`);

  const exeName = exePath ? path.basename(exePath) : null;
  if (exePath) {
    const exeBuf = fs.readFileSync(exePath);
    const cloudExeName = exeName.replace(/\.exe$/i, '') + `-${ts}.exe`;
    console.log(`[cloud] 上传安装包 ${cloudExeName}（${(exeBuf.length / 1024 / 1024).toFixed(1)} MB）…`);
    await upload(root, cloudExeName, exeBuf);
    console.log(`[cloud] ✓ ${cloudExeName}`);
  } else {
    console.log('[cloud] --only-patches：跳过安装包（云盘已有同版本安装包）');
  }

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