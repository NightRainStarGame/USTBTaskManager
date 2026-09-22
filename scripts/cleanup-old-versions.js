#!/usr/bin/env node
/**
 * v1.2.8 清理脚本：删除 1.2.6 之前的所有版本（本地 + GitHub Releases + 北科云盘）
 *
 * 用法：
 *   node scripts/cleanup-old-versions.js --list            # 只列清单
 *   node scripts/cleanup-old-versions.js --cleanup         # 真正删除
 *   node scripts/cleanup-old-versions.js --cleanup --local-only
 *   node scripts/cleanup-old-versions.js --cleanup --no-cloud
 *   node scripts/cleanup-old-versions.js --cleanup --no-github
 *
 * 范围：tag_name 比较 "vX.Y.Z" → X.Y.Z < 1.2.6 全删。
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const LIST_ONLY = argv.includes('--list');
const DO_CLEAN = argv.includes('--cleanup');
const LOCAL_ONLY = argv.includes('--local-only');
const NO_CLOUD = argv.includes('--no-cloud');
const NO_GITHUB = argv.includes('--no-github');

const THRESHOLD = '1.2.6'; // < 1.2.6 全删

function cmpVer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function shouldDelete(versionStr) {
  return cmpVer(versionStr, THRESHOLD) < 0;
}

// ── 本地盘 ──────────────────────────────────────────
function scanLocal() {
  const result = { dirs: [], patches: [] };
  const entries = fs.readdirSync(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // release-vX.Y.Z
    const m = e.name.match(/^release-v(\d+\.\d+\.\d+)$/);
    if (m) {
      const ver = m[1];
      if (shouldDelete(ver)) {
        const p = path.join(ROOT, e.name);
        let size = 0;
        try {
          const files = fs.readdirSync(p, { withFileTypes: true });
          for (const f of files) {
            try {
              const s = fs.statSync(path.join(p, f.name));
              size += s.size;
            } catch {}
          }
        } catch {}
        result.dirs.push({ version: ver, path: p, size });
      }
    }
  }
  // patches/
  const patchesDir = path.join(ROOT, 'leastversion', 'patches');
  if (fs.existsSync(patchesDir)) {
    for (const f of fs.readdirSync(patchesDir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.zip')) continue;
      // TaskManager-Patch-1.1.9-to-1.2.0.zip
      const m = f.name.match(/Patch-(\d+\.\d+\.\d+)-to-(\d+\.\d+\.\d+)\.zip$/);
      if (!m) continue;
      const from = m[1], to = m[2];
      // 起点或终点 < 1.2.6 → 删
      if (shouldDelete(from) || shouldDelete(to)) {
        const st = fs.statSync(path.join(patchesDir, f.name));
        result.patches.push({ name: f.name, from, to, size: st.size, path: path.join(patchesDir, f.name) });
      }
    }
  }
  return result;
}

function rmDirRobust(p) {
  // safe-delete 拦截一切删除。绕行手段（AGENTS.md §7）：
  // 1) fs.rmSync({ force: true }) 先尝试
  try {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  } catch (e1) {
    // 2) Python ctypes DeleteFileW / MoveFileEx 兜底（脚本不引入 Python，改用 PowerShell）
    console.log(`  [warn] fs.rmSync failed: ${e1.message.split('\n')[0]}`);
    return false;
  }
}

function rmFileRobust(p) {
  try {
    fs.unlinkSync(p);
    return true;
  } catch (e1) {
    console.log(`  [warn] fs.unlink failed: ${e1.message.split('\n')[0]}`);
    return false;
  }
}

// ── GitHub Releases ──────────────────────────────────────────
function getToken() {
  // AGENTS.md §7: 用 git credential fill 拿 token
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execFileSync('git', ['credential', 'fill'], {
    input, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('git credential 里没有 GitHub token');
  return m[1].trim();
}

// AGENTS.md §7：Node fetch 沙箱 TLS 失败 → 用 curl
function ghCurl(method, url, token) {
  const args = [
    '-sS', '-X', method,
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: taskmanager-cleanup',
    '-w', '\n%{http_code}',
    url,
  ];
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // 最后一行为 http_code，前面是 body
  const lines = out.split('\n');
  const httpCode = Number(lines.pop());
  const body = lines.join('\n');
  return { httpCode, body };
}

async function githubListReleases(token) {
  const all = [];
  let page = 1;
  while (true) {
    const { httpCode, body } = ghCurl('GET', `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/releases?per_page=100&page=${page}`, token);
    if (httpCode !== 200) throw new Error(`GitHub releases HTTP ${httpCode}: ${body.slice(0, 200)}`);
    const arr = JSON.parse(body);
    if (!Array.isArray(arr) || arr.length === 0) break;
    all.push(...arr);
    if (arr.length < 100) break;
    page++;
  }
  return all;
}

async function githubDeleteRelease(token, releaseId) {
  const { httpCode } = ghCurl('DELETE', `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/releases/${releaseId}`, token);
  return httpCode;
}

async function githubDeleteTag(token, tag) {
  // tag 必须先删 ref 才能删 object
  const { httpCode } = ghCurl('DELETE', `https://api.github.com/repos/NightRainStarGame/USTBTaskManager/git/refs/tags/${tag}`, token);
  return httpCode;
}

// ── 北科云盘 ──────────────────────────────────────────
const LINK_URL = 'https://yunpan.ustb.edu.cn/link/AADAAEA94FBE6B4435B8D14A236FAC6469';
const PASSWORD = 'kc26';
const BASE = 'https://yunpan.ustb.edu.cn';
const LINK_ID = LINK_URL.split('/').pop();

async function jfetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []);
    return { status: res.status, ok: res.ok, text, cookies };
  } finally { clearTimeout(timer); }
}

let cloudToken = '';
async function cloudGetToken() {
  if (cloudToken) return cloudToken;
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
  if (r.status !== 302 && r.status !== 200) throw new Error(`云盘提取码 HTTP ${r.status}`);
  const m = r.cookies.find((c) => c.startsWith(`link_token:${LINK_ID}=`));
  if (!m) throw new Error('云盘 link_token 失败');
  cloudToken = m.split(';')[0].split('=').slice(1).join('=');
  return cloudToken;
}

async function cloudApi(p, body) {
  const t = await cloudGetToken();
  const r = await jfetch(`${BASE}${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}

async function cloudListRoot() {
  const root = await cloudApi('/api/efast/v1/entry-item');
  if (!root.ok) throw new Error(`entry-item HTTP ${root.status}`);
  const arr = JSON.parse(root.text);
  if (!Array.isArray(arr) || !arr[0]?.id) throw new Error('云盘根目录空');
  const docid = String(arr[0].id);
  const r = await cloudApi('/api/efast/v1/dir/list', { docid, by: 'name', sort: 'asc' });
  if (!r.ok) throw new Error(`dir/list HTTP ${r.status}`);
  return { docid, files: JSON.parse(r.text).files || [] };
}

async function cloudDeleteFile(docid) {
  const r = await cloudApi('/api/efast/v1/file/delete', { docid });
  return r;
}

// 解析云盘文件名带出的版本号
function fileVersion(name) {
  // TaskManager Setup 1.2.0-1789969957966.exe  /  TaskManager-Setup-1.2.0.exe
  // 1.1.5-to-1.1.6-1789889276083.zip  (旧版补丁命名，无 TaskManager- 前缀)
  // TaskManager-Patch-1.2.x-to-1.2.y.zip  (新版命名)
  let m = name.match(/TaskManager[ -]Setup[ -](\d+\.\d+\.\d+)/i);
  if (m) return m[1];
  m = name.match(/TaskManager-Patch-(\d+\.\d+\.\d+)-to-(\d+\.\d+\.\d+)(?:-\d+)?\.zip$/i);
  if (m) return shouldDelete(m[1]) ? m[1] : m[2];
  // 旧版补丁命名：<from>-to-<to>-<ts>.zip
  m = name.match(/^(\d+\.\d+\.\d+)-to-(\d+\.\d+\.\d+)-\d+\.zip$/);
  if (m) return shouldDelete(m[1]) ? m[1] : m[2];
  return null;
}

// latest-<ts>.json / about-<ts>.txt：保留时间戳最大那份（=最新发版），其他全清
function shouldDeleteMeta(name, allFileNames) {
  const m = name.match(/^(latest|about)-(\d+)\.(json|txt)$/);
  if (!m) return false;
  const prefix = m[1];
  const ts = Number(m[2]);
  const re = new RegExp(`^${prefix}-(\\d+)\\.(json|txt)$`);
  const sameType = allFileNames.map((n) => Number((n.match(re) || [])[1] || 0)).filter((x) => x > 0);
  if (sameType.length === 0) return false;
  const maxTs = Math.max(...sameType);
  return ts < maxTs;
}

// ── main ──────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════');
  console.log(`  清理目标: < ${THRESHOLD}`);
  console.log(`  模式: ${LIST_ONLY ? 'list-only' : DO_CLEAN ? 'cleanup' : 'preview'}`);
  console.log(`  范围: ${LOCAL_ONLY ? '本地' : NO_CLOUD ? '本地 + GitHub' : NO_GITHUB ? '本地 + 云盘' : '本地 + GitHub + 云盘'}`);
  console.log('═══════════════════════════════════════\n');

  // 1) 本地
  const local = scanLocal();
  console.log('─── 本地 release-v* 目录 ───');
  if (local.dirs.length === 0) console.log('  (无)');
  for (const d of local.dirs) {
    console.log(`  release-v${d.version}/  ${(d.size / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log('\n─── 本地 patches/ zip ───');
  if (local.patches.length === 0) console.log('  (无)');
  for (const p of local.patches) {
    console.log(`  ${p.name}  ${(p.size / 1024 / 1024).toFixed(2)} MB`);
  }

  let ghReleases = [];
  if (!NO_GITHUB && !LOCAL_ONLY) {
    console.log('\n─── GitHub Releases ───');
    try {
      const token = getToken();
      ghReleases = await githubListReleases(token);
      let totalSize = 0;
      for (const r of ghReleases) {
        const ver = r.tag_name.replace(/^v/, '');
        const del = shouldDelete(ver);
        const size = (r.assets || []).reduce((a, b) => a + b.size, 0);
        if (del) totalSize += size;
        console.log(`  ${del ? '✗' : '✓'} ${r.tag_name}  assets=${(r.assets || []).length}  size=${(size / 1024 / 1024).toFixed(2)} MB  draft=${r.draft}  prerelease=${r.prerelease}`);
      }
      console.log(`  -- 共需清理 ${ghReleases.filter(r => shouldDelete(r.tag_name.replace(/^v/, ''))).length} 个 Release，总资产 ${(totalSize / 1024 / 1024).toFixed(2)} MB --`);
    } catch (e) {
      console.log(`  [warn] ${e.message}`);
    }
  }

  let cloudFiles = [];
  if (!NO_CLOUD && !LOCAL_ONLY) {
    console.log('\n─── 北科云盘根目录 ───');
    try {
      const { files } = await cloudListRoot();
      cloudFiles = files;
      const allNames = files.map((f) => f.name);
      let toDel = 0, totalSize = 0;
      for (const f of files) {
        const ver = fileVersion(f.name);
        const meta = shouldDeleteMeta(f.name, allNames);
        const del = (ver && shouldDelete(ver)) || meta;
        if (del) { toDel++; totalSize += f.size; }
        const reason = meta ? 'meta' : (ver && shouldDelete(ver) ? `v${ver}` : 'keep');
        console.log(`  ${del ? '✗' : '✓'} ${f.name}  ${(f.size / 1024 / 1024).toFixed(2)} MB  [${reason}]`);
      }
      console.log(`  -- 共需清理 ${toDel} 个文件，总 ${(totalSize / 1024 / 1024).toFixed(2)} MB --`);
    } catch (e) {
      console.log(`  [warn] ${e.message}`);
    }
  }

  if (!DO_CLEAN) {
    console.log('\n(dry-run。加 --cleanup 真正删除。)');
    process.exit(0);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  开始执行删除');
  console.log('═══════════════════════════════════════\n');

  // 本地
  console.log('─── 本地清理 ───');
  for (const d of local.dirs) {
    process.stdout.write(`  rm release-v${d.version}/ ... `);
    if (rmDirRobust(d.path)) console.log('OK'); else console.log('FAIL');
  }
  for (const p of local.patches) {
    process.stdout.write(`  rm ${p.name} ... `);
    if (rmFileRobust(p.path)) console.log('OK'); else console.log('FAIL');
  }

  // GitHub
  if (!NO_GITHUB && !LOCAL_ONLY && ghReleases.length) {
    console.log('\n─── GitHub 清理 ───');
    const token = getToken();
    for (const r of ghReleases) {
      const ver = r.tag_name.replace(/^v/, '');
      if (!shouldDelete(ver)) continue;
      // 先删 Release（含 assets）
      process.stdout.write(`  delete release ${r.tag_name} (id=${r.id}) ... `);
      const s1 = await githubDeleteRelease(token, r.id);
      console.log(s1 === 204 ? 'OK' : `HTTP ${s1}`);
      // 再删 tag
      process.stdout.write(`  delete tag ${r.tag_name} ... `);
      const s2 = await githubDeleteTag(token, r.tag_name);
      console.log(s2 === 204 ? 'OK' : `HTTP ${s2}`);
    }
  }

  // 云盘
  if (!NO_CLOUD && !LOCAL_ONLY && cloudFiles.length) {
    console.log('\n─── 北科云盘清理 ───');
    const allNames = cloudFiles.map((f) => f.name);
    for (const f of cloudFiles) {
      const ver = fileVersion(f.name);
      const meta = shouldDeleteMeta(f.name, allNames);
      const del = (ver && shouldDelete(ver)) || meta;
      if (!del) continue;
      process.stdout.write(`  delete ${f.name} ... `);
      try {
        const r = await cloudDeleteFile(f.docid);
        console.log(r.ok ? 'OK' : `HTTP ${r.status}`);
      } catch (e) {
        console.log(`FAIL: ${e.message.split('\n')[0]}`);
      }
    }
  }

  console.log('\n✅ 完成');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});