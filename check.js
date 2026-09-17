const fs = require('fs');
const ts = fs.readFileSync('electron/preload.ts', 'utf8');
const idx = ts.indexOf('categories:');
console.log('idx:', idx);
console.log('snippet:', ts.substring(idx, idx + 250));
console.log('total length:', ts.length);