/**
 * 和歌メイカー「みんなの和歌」API (Google Apps Script ウェブアプリ)
 *
 * 何をするか:
 *   スプレッドシートを置き場にして、和歌の投稿 (post)・一覧 (list)・取り下げ (delete)・
 *   設置確認 (ping) を JSON で返す。サイト (GitHub Pages) の minna.api にこのウェブアプリの
 *   /exec URL を設定して使う。仕様は DESIGN.md 14.1。
 *   - シート posts: 投稿 (id, createdAt, ku1..5, kana1..5, author, meaning, odai, hidden, client, deleteHash)
 *   - シート ng   : A 列に NG ワード (1 行 1 語、部分一致。1 行目は見出しなので無視)
 *   - 管理は posts の hidden 列に 1 を書くと非表示になる (行は消さない)
 *   - IP やアカウントは記録しない
 *
 * 設置のしかた: docs/minna-setup.md
 */

var VERSION = 1;
var SHEET_POSTS = 'posts';
var SHEET_NG = 'ng';
var POST_HEADER = ['id', 'createdAt', 'ku1', 'ku2', 'ku3', 'ku4', 'ku5',
  'kana1', 'kana2', 'kana3', 'kana4', 'kana5',
  'author', 'meaning', 'odai', 'hidden', 'client', 'deleteHash'];
var COL = { id: 0, createdAt: 1, ku: 2, kana: 7, author: 12, meaning: 13, odai: 14, hidden: 15, client: 16, hash: 17 };
var DUP_WINDOW = 300;      // 重複を調べる直近行数
var LIST_CACHE_SEC = 20;   // list キャッシュ秒
var RATE_CLIENT_SEC = 20;  // 端末ごとの連投間隔
var RATE_ALL_MAX = 30;     // 全体 1 分あたりの上限

// ---------- 入口 ----------

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'ping') return out_(ping_());
    if (p.action === 'list') return out_(list_(p));
    return out_({ ok: false, error: 'invalid' });
  } catch (err) {
    return out_({ ok: false, error: 'server' });
  }
}

function doPost(e) {
  try {
    var req;
    try {
      req = JSON.parse((e && e.postData && e.postData.contents) || '');
    } catch (x) {
      return out_({ ok: false, error: 'invalid' });
    }
    if (!req || typeof req !== 'object') return out_({ ok: false, error: 'invalid' });
    if (req.action === 'post') return out_(withLock_(function () { return post_(req); }));
    if (req.action === 'delete') return out_(withLock_(function () { return delete_(req); }));
    return out_({ ok: false, error: 'invalid' });
  } catch (err) {
    return out_({ ok: false, error: 'server' });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'server' };
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- シート ----------

/** posts / ng シートが無ければ作る。posts シートを返す。 */
function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_POSTS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_POSTS);
    sh.getRange(1, 1, 1, POST_HEADER.length).setValues([POST_HEADER]);
    // 本文列を書式なしテキストにして、日付や数式に化けるのを防ぐ (ku1〜odai)
    sh.getRange(2, COL.ku + 1, 1000, COL.odai - COL.ku + 1).setNumberFormat('@');
    if (sh.setFrozenRows) sh.setFrozenRows(1);
  }
  var ng = ss.getSheetByName(SHEET_NG);
  if (!ng) {
    ng = ss.insertSheet(SHEET_NG);
    ng.getRange(1, 1, 1, 1).setValues([['NGワード (1行に1語・部分一致・この行は見出し)']]);
  }
  return sh;
}

function cell_(v) { return v === null || v === undefined ? '' : String(v); }

function isHidden_(v) { return String(v) === '1' || v === true; }

/** 日付セルが Date に化けていても YYYY-MM-DD に戻す */
function odaiOf_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return cell_(v);
}

function rowToItem_(r) {
  var ku = [], kana = [];
  for (var i = 0; i < 5; i++) { ku.push(cell_(r[COL.ku + i])); kana.push(cell_(r[COL.kana + i])); }
  return {
    id: cell_(r[COL.id]), ku: ku, kana: kana,
    author: cell_(r[COL.author]), meaning: cell_(r[COL.meaning]),
    odai: odaiOf_(r[COL.odai]), createdAt: Number(r[COL.createdAt]) || 0
  };
}

// ---------- ping / list ----------

function ping_() {
  var rows = ensureSheets().getDataRange().getValues();
  var n = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][COL.id] !== '' && !isHidden_(rows[i][COL.hidden])) n++;
  }
  return { ok: true, version: VERSION, count: n };
}

function listVersion_() {
  return CacheService.getScriptCache().get('lv') || '0';
}

function bumpListCache_() {
  CacheService.getScriptCache().put('lv', Utilities.getUuid(), 21600);
}

function list_(p) {
  var limit = parseInt(p.limit, 10);
  if (!(limit >= 1)) limit = 30;
  if (limit > 50) limit = 50;
  var odai = p.odai ? String(p.odai) : '';
  if (odai && !/^\d{4}-\d{2}-\d{2}$/.test(odai)) return { ok: false, error: 'invalid' };
  var before = p.before ? Number(p.before) : 0;
  if (p.before && !(before > 0)) return { ok: false, error: 'invalid' };

  var cache = CacheService.getScriptCache();
  var key = 'ls:' + listVersion_() + ':' + limit + ':' + odai + ':' + before;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var rows = ensureSheets().getDataRange().getValues();
  var items = [], more = false;
  // createdAt 降順 = 末尾から。limit+1 件取れたら打ち切る
  for (var i = rows.length - 1; i >= 1; i--) {
    var r = rows[i];
    if (r[COL.id] === '' || isHidden_(r[COL.hidden])) continue;
    var created = Number(r[COL.createdAt]) || 0;
    if (before && created >= before) continue;
    if (odai && odaiOf_(r[COL.odai]) !== odai) continue;
    if (items.length >= limit) { more = true; break; }
    items.push(rowToItem_(r));
  }
  var res = { ok: true, items: items, more: more };
  cache.put(key, JSON.stringify(res), LIST_CACHE_SEC);
  return res;
}

// ---------- post ----------

function len_(s) { return Array.from(s).length; }

function str_(v) {
  return typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '') : null;
}

function validate_(req) {
  var ku = req.ku, kana = req.kana;
  if (!Array.isArray(ku) || ku.length !== 5) return null;
  if (!Array.isArray(kana) || kana.length !== 5) return null;
  var k = [], n = [], i, s;
  for (i = 0; i < 5; i++) {
    s = str_(ku[i]);
    if (s === null) return null;
    if (len_(s) < 1 || len_(s) > 15) return null;
    if (/[\r\n]/.test(s) || /http/i.test(s) || s.indexOf('://') >= 0) return null;
    k.push(s);
    s = str_(kana[i]);
    if (s === null) return null;
    if (s !== '') {
      if (len_(s) > 20) return null;
      if (!/^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/.test(s)) return null;
    }
    n.push(s);
  }
  var author = req.author === undefined || req.author === null ? '' : str_(req.author);
  var meaning = req.meaning === undefined || req.meaning === null ? '' : str_(req.meaning);
  var odai = req.odai === undefined || req.odai === null ? '' : str_(req.odai);
  var client = str_(req.client);
  if (author === null || meaning === null || odai === null || client === null) return null;
  if (len_(author) > 20 || len_(meaning) > 200) return null;
  // 雅号は改行不可。雅号・大意とも URL は通さない
  if (/[\r\n]/.test(author)) return null;
  if (/http/i.test(author + meaning) || (author + meaning).indexOf('://') >= 0) return null;
  if (odai !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(odai)) return null;
  if (!/^[A-Za-z0-9]{8,64}$/.test(client)) return null;
  return { ku: k, kana: n, author: author, meaning: meaning, odai: odai, client: client };
}

function hasNg_(v) {
  var ng = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NG);
  if (!ng) return false;
  var rows = ng.getDataRange().getValues();
  var text = (v.ku.join('') + '\n' + v.ku.join(' ') + '\n' + v.author + '\n' + v.meaning).toLowerCase();
  for (var i = 1; i < rows.length; i++) {
    var w = cell_(rows[i][0]).replace(/^\s+|\s+$/g, '').toLowerCase();
    if (w && text.indexOf(w) >= 0) return true;
  }
  return false;
}

function rateLimited_(client) {
  var cache = CacheService.getScriptCache();
  if (cache.get('rl:' + client)) return true;
  var all = parseInt(cache.get('rl:all') || '0', 10);
  if (all >= RATE_ALL_MAX) return true;
  cache.put('rl:' + client, '1', RATE_CLIENT_SEC);
  cache.put('rl:all', String(all + 1), 60);
  return false;
}

function isDup_(rows, v) {
  var joined = v.ku.join('');
  var stop = Math.max(1, rows.length - DUP_WINDOW);
  for (var i = rows.length - 1; i >= stop; i--) {
    var r = rows[i];
    if (r[COL.id] === '') continue;
    var j = '';
    for (var c = 0; c < 5; c++) j += cell_(r[COL.ku + c]);
    if (j === joined) return true;
  }
  return false;
}

function sha256Hex_(s) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var h = '';
  for (var i = 0; i < d.length; i++) {
    var b = d[i] < 0 ? d[i] + 256 : d[i];
    h += (b < 16 ? '0' : '') + b.toString(16);
  }
  return h;
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 32);
}

function post_(req) {
  var v = validate_(req);
  if (!v) return { ok: false, error: 'invalid' };
  var sh = ensureSheets();
  if (hasNg_(v)) return { ok: false, error: 'ng' };
  if (rateLimited_(v.client)) return { ok: false, error: 'rate' };
  var rows = sh.getDataRange().getValues();
  if (isDup_(rows, v)) return { ok: false, error: 'dup' };

  var id = Utilities.getUuid();
  var token = newToken_();
  var row = [id, Date.now()].concat(v.ku, v.kana, [v.author, v.meaning, v.odai, '', v.client, sha256Hex_(token)]);
  sh.appendRow(row);
  bumpListCache_();
  return { ok: true, id: id, deleteToken: token };
}

// ---------- delete ----------

function delete_(req) {
  var id = typeof req.id === 'string' ? req.id : '';
  var token = typeof req.deleteToken === 'string' ? req.deleteToken : '';
  if (!id || !token) return { ok: false, error: 'invalid' };
  var sh = ensureSheets();
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (cell_(rows[i][COL.id]) !== id) continue;
    if (cell_(rows[i][COL.hash]) !== sha256Hex_(token)) return { ok: false, error: 'forbidden' };
    sh.getRange(i + 1, COL.hidden + 1).setValue(1);
    bumpListCache_();
    return { ok: true };
  }
  return { ok: false, error: 'notfound' };
}
