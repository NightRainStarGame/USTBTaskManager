#!/usr/bin/env node
/**
 * v1.2.9 R9：班级独立仓库（USTBTaskManager-Class）写→读→删全链路验证。
 * 在内置公共令牌填入前后都可跑（拿本机 git credential 的 token 验证管道）。
 * 用法：node scripts/test-class-repo-pipeline.cjs
 */
const { execFileSync } = require('child_process');

function getToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('git credential 里没有 GitHub token');
  return m[1].trim();
}

const tok = getToken();
const API = 'https://api.github.com/repos/NightRainStarGame/USTBTaskManager-Class';
const RAW = 'https://raw.githubusercontent.com/NightRainStarGame/USTBTaskManager-Class/main';
const PATH = 'class/SMOKETEST123/manifest.json';
const content = JSON.stringify({ smoke: true, ts: Date.now(), note: 'v1.2.9 R9 管道验证，可删' });

function curl(method, url, body) {
  const args = ['-s', '-X', method, '-H', 'Authorization: Bearer ' + tok,
    '-H', 'Accept: application/vnd.github+json', '-w', '\n__ST__%{http_code}'];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  args.push(url);
  return execFileSync('curl', args, { encoding: 'utf8' });
}
const st = (o) => parseInt((o.match(/__ST__(\d+)/) || [])[1] || '0', 10);
const body = (o) => o.replace(/__ST__\d+\s*$/, '');

let r = curl('PUT', `${API}/contents/${PATH}`, {
  message: 'smoke: v1.2.9 R9 管道验证', branch: 'main',
  content: Buffer.from(content, 'utf8').toString('base64'),
});
console.log('1. PUT   -> ' + st(r));
if (st(r) !== 201) { console.log(body(r).slice(0, 300)); process.exit(1); }
const sha = JSON.parse(body(r)).content?.sha;

r = curl('GET', `${RAW}/${PATH}?t=${Date.now()}`);
const rawOk = st(r) === 200 && body(r).includes('"smoke":true');
console.log('2. RAW   -> ' + st(r) + (rawOk ? ' (内容一致)' : ' !! 不一致: ' + body(r).slice(0, 100)));

r = curl('GET', `${API}/contents/${PATH}?ref=main`);
console.log('3. GET   -> ' + st(r) + ' sha=' + (JSON.parse(body(r)).sha || '').slice(0, 8) + '…');

r = curl('PUT', `${API}/contents/${PATH}`, {
  message: 'smoke: update', branch: 'main',
  content: Buffer.from(content.replace('true', 'false'), 'utf8').toString('base64'), sha,
});
console.log('4. PUT2  -> ' + st(r) + ' (sha 冲突检测链路)');
const sha2 = st(r) === 200 ? JSON.parse(body(r)).content?.sha : sha;

r = curl('DELETE', `${API}/contents/${PATH}`, {
  message: 'smoke: cleanup', branch: 'main', sha: sha2,
});
console.log('5. DEL   -> ' + st(r) + ' (公告撤回链路)');

r = curl('GET', `${RAW}/${PATH}?t=${Date.now()}`);
console.log('6. RAW2  -> ' + st(r) + (st(r) === 404 ? ' (已删净)' : ' !! 残留'));
console.log(rawOk && st(r) === 404 ? '\nALL_OK 全链路通' : '\nCHECK_FAILED');
