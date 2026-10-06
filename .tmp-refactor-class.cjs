// 临时：class/index.ts 第四轮 —— 去掉残留的 gh/GitHub 命名
const fs = require('fs');
const p = 'electron/class/index.ts';
let s = fs.readFileSync(p, 'utf8');
const counts = {};
function sub(name, re, to) {
  const hits = (s.match(re) || []).length;
  s = s.replace(re, to);
  counts[name] = hits;
}

sub('获取凭据处', /const ghToken = getGitHubToken\(db\);/g, 'const cloudWritable = cloudCredential(db);');
sub('凭据分支', /if \(ghToken\) \{/g, 'if (cloudWritable) {');
sub('函数改名', /function getGitHubToken\(_db: DB\): string \{/g, 'function cloudCredential(_db: DB): string {');

fs.writeFileSync(p, s);
console.log(JSON.stringify(counts, null, 2));
