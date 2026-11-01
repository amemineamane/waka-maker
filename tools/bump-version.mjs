// tools/bump-version.mjs — index.html の `?v=N` を一括で +1 する（GitHub Pages のキャッシュ対策）
// sw.js の `const CACHE_VERSION = 'N';` も同じ N にそろえる（古い Service Worker のキャッシュを捨てるため）。
// 使い方: node tools/bump-version.mjs        … すべての ?v=N を「いちばん大きい N + 1」にそろえる
//         node tools/bump-version.mjs --dry  … 書き換えずに結果だけ表示
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'index.html');
const swFile = path.join(root, 'sw.js');
const dry = process.argv.includes('--dry');

const src = fs.readFileSync(file, 'utf8');
const re = /(\.(?:js|css)\?v=)(\d+)/g;
const nums = [...src.matchAll(re)].map(m => Number(m[2]));
if (!nums.length) { console.error('?v=N が見つかりません'); process.exit(1); }
const next = Math.max(...nums) + 1;
const out = src.replace(re, (_, head) => head + next);
if (!dry) fs.writeFileSync(file, out, 'utf8');
console.log(`${nums.length} か所の ?v= を ${next} にしました${dry ? '（--dry: 書き換えなし）' : ''}`);

// sw.js の CACHE_VERSION
if (fs.existsSync(swFile)) {
  const sw = fs.readFileSync(swFile, 'utf8');
  const swRe = /(const CACHE_VERSION = ')([^']*)(';)/;
  if (!swRe.test(sw)) {
    console.error('sw.js に const CACHE_VERSION = \'…\'; の行が見つかりません');
    process.exit(1);
  }
  const before = sw.match(swRe)[2];
  if (!dry) fs.writeFileSync(swFile, sw.replace(swRe, `$1${next}$3`), 'utf8');
  console.log(`sw.js の CACHE_VERSION を ${before} → ${next} にしました${dry ? '（--dry: 書き換えなし）' : ''}`);
}
