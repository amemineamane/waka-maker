// gas/Code.gs のロジックをモックで確かめる。実行: node _dev/test-gas.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, '..', 'gas', 'Code.gs'), 'utf8');

// ---- モック ----
function makeSheet(name) {
  const rows = [];
  const sh = {
    name,
    getName: () => name,
    setFrozenRows() {},
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    appendRow: r => { rows.push(r.slice()); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        setValues(v) { for (let i = 0; i < v.length; i++) { rows[r - 1 + i] = rows[r - 1 + i] || []; for (let j = 0; j < v[i].length; j++) rows[r - 1 + i][c - 1 + j] = v[i][j]; } },
        setValue(v) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
        setNumberFormat() {},
      };
    },
  };
  return { sh, rows };
}
function makeEnv() {
  const sheets = {};
  const cacheStore = new Map();
  const ss = {
    getSheetByName: n => (sheets[n] ? sheets[n].sh : null),
    insertSheet: n => { sheets[n] = makeSheet(n); return sheets[n].sh; },
  };
  return {
    sheets,
    cacheStore,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => ({
      get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
      put: (k, v) => { cacheStore.set(k, v); },
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      formatDate: (d) => d.toISOString().slice(0, 10),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => ({ text: s, setMimeType() { return this; }, getContent() { return this.text; } }),
    },
  };
}

const env = makeEnv();
const names = Object.keys(env).filter(k => /^[A-Z]/.test(k));
const body = src + '\nreturn { doGet, doPost, ensureSheets };';
const api = new Function(...names, body)(...names.map(n => env[n]));

const get = p => JSON.parse(api.doGet({ parameter: p }).getContent());
const post = o => JSON.parse(api.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).getContent());

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('NG:', m); } };

const mk = (i, extra = {}) => ({
  action: 'post',
  ku: [`古池や${i}`, '蛙飛び込む', '水の音', 'ひとつ', 'ふたつ'],
  kana: ['ふるいけや', 'かわずとびこむ', 'みずのおと', '', 'ふたつ'],
  author: '雨峰', meaning: '静けさ', odai: '2026-11-01', client: 'client' + String(i).padStart(4, '0') + 'abcd',
  ...extra,
});

// ping (シート自動作成)
let r = get({ action: 'ping' });
ok(r.ok && r.version === 1 && r.count === 0, 'ping 初回');
ok(env.sheets.posts && env.sheets.ng, 'シート作成');
ok(env.sheets.posts.rows[0].length === 18 && env.sheets.posts.rows[0][17] === 'deleteHash', '見出し');

// post
r = post(mk(1));
ok(r.ok && r.id && /^[0-9a-f]{32}$/.test(r.deleteToken), 'post 成功');
const tok1 = r.deleteToken, id1 = r.id;
const stored = env.sheets.posts.rows[1];
ok(stored[17] === crypto.createHash('sha256').update(tok1).digest('hex'), 'SHA-256 hex を保存');
ok(!stored.includes(tok1), 'トークン平文は保存しない');

// list
r = get({ action: 'list', limit: '30' });
ok(r.ok && r.items.length === 1 && r.items[0].id === id1 && r.items[0].ku.length === 5 && r.more === false, 'list 1 件');
ok(!('client' in r.items[0]) && !('deleteHash' in r.items[0]), 'list に内部列を出さない');

// 追加 (別 client) と odai / 降順 / more / before
const realNow = Date.now; let t = realNow();
Date.now = () => (t += 10);
post(mk(2, { odai: '2026-10-31' }));
post(mk(3));
Date.now = realNow;
r = get({ action: 'list', limit: '2' });
ok(r.items.length === 2 && r.more === true && r.items[0].createdAt > r.items[1].createdAt, 'limit・more・降順');
const r2 = get({ action: 'list', limit: '2', before: String(r.items[1].createdAt) });
ok(r2.items.length === 1 && r2.more === false && r2.items[0].id === id1, 'before ページング');
r = get({ action: 'list', limit: '50', odai: '2026-11-01' });
ok(r.items.length === 2 && r.items.every(i => i.odai === '2026-11-01'), 'odai 絞り込み');
ok(get({ action: 'list', odai: 'bad' }).error === 'invalid', 'odai 不正');
ok(get({ action: 'list', limit: '999' }).items.length === 3, 'limit 上限は丸める');

// dup
ok(post(mk(4, { ku: mk(1).ku })).error === 'dup', 'dup');

// invalid
ok(post(mk(5, { ku: ['あ', 'い', 'う', 'え'] })).error === 'invalid', 'ku 4 本');
ok(post(mk(5, { ku: ['あ', 'い', 'う', 'え', '十六文字十六文字十六文字十六文字'] })).error === 'invalid', 'ku 長すぎ');
ok(post(mk(5, { ku: ['あ', 'い', 'う', 'え', 'http://x'] })).error === 'invalid', 'ku に http');
ok(post(mk(5, { ku: ['あ', 'い', 'う', 'え', 'a\nb'] })).error === 'invalid', 'ku 改行');
ok(post(mk(5, { kana: ['ふるいけや', 'かわず', 'abc', '', ''] })).error === 'invalid', 'kana に英字');
ok(post(mk(5, { kana: ['ゝゞヽヾー', 'カタカナ', '', '', ''] })).ok === true, 'kana 踊り字・カタカナ可');
ok(post(mk(6, { odai: '11/01' })).error === 'invalid', 'odai 形式');
ok(post(mk(7, { client: 'abc' })).error === 'invalid', 'client 短い');
ok(post(mk(7, { meaning: 'x'.repeat(201) })).error === 'invalid', 'meaning 長い');
ok(post('{broken').error === 'invalid', 'JSON 壊れ');
ok(post({ action: 'zzz' }).error === 'invalid', '未知 action (post)');
ok(get({ action: 'zzz' }).error === 'invalid', '未知 action (get)');
ok(get({}).error === 'invalid', 'action なし');

// 空白トリム
r = post(mk(8, { ku: ['  トリム ', 'い', 'う', 'え', 'お'], kana: ['', '', '', '', ''], author: '', meaning: '', odai: '' }));
ok(r.ok, 'トリム投稿');
ok(env.sheets.posts.rows.at(-1)[2] === 'トリム', '前後空白を落とす');

// ng
env.sheets.ng.rows.push(['禁止語']);
ok(post(mk(9, { meaning: 'これは禁止語です' })).error === 'ng', 'ng meaning');
ok(post(mk(10, { author: '禁止語さん' })).error === 'ng', 'ng author');
ok(post(mk(11, { ku: ['あ', 'い', 'う', 'え', '禁止語'] })).error === 'ng', 'ng ku');

// rate (同一 client 連投)
const rc = 'sameclient01';
ok(post(mk(20, { client: rc })).ok, 'rate 1 回目');
ok(post(mk(21, { client: rc })).error === 'rate', 'rate 2 回目');
env.cacheStore.delete('rl:' + rc);
ok(post(mk(21, { client: rc })).ok, 'rate キャッシュ切れで復帰');
// 全体 30/分
env.cacheStore.set('rl:all', '30');
ok(post(mk(30)).error === 'rate', '全体 rate');
env.cacheStore.delete('rl:all');

// list キャッシュ: 投稿で破棄される
const before = get({ action: 'list', limit: '50' }).items.length;
ok(post(mk(40)).ok, 'キャッシュ破棄用の投稿');
ok(get({ action: 'list', limit: '50' }).items.length === before + 1, '投稿後すぐ list に出る');

// delete
const cnt0 = get({ action: 'ping' }).count;
ok(post({ action: 'delete', id: id1, deleteToken: 'wrong' }).error === 'forbidden', 'delete forbidden');
ok(post({ action: 'delete', id: 'nonexistent', deleteToken: tok1 }).error === 'notfound', 'delete notfound');
ok(post({ action: 'delete', id: id1 }).error === 'invalid', 'delete token なし');
ok(post({ action: 'delete', id: id1, deleteToken: tok1 }).ok === true, 'delete 成功');
const row = env.sheets.posts.rows.find(x => x[0] === id1);
ok(row && String(row[15]) === '1', '行は残り hidden=1');
ok(!get({ action: 'list', limit: '50' }).items.some(i => i.id === id1), 'hidden は list に出ない');
ok(get({ action: 'ping' }).count === cnt0 - 1, 'ping count が減る');

// 手動で hidden を付けても除外
const manual = env.sheets.posts.rows.at(-1);
manual[15] = 1;
env.cacheStore.clear();
ok(!get({ action: 'list', limit: '50' }).items.some(i => i.id === manual[0]), '手動 hidden 除外');

// ping 形
r = get({ action: 'ping' });
ok(r.ok === true && r.version === 1 && typeof r.count === 'number', 'ping 形');

console.log(fail ? `失敗 ${fail} / ${n}` : `合格 ${n} / ${n}`);
process.exit(fail ? 1 : 0);
