/* =====================================================================
 * js/store.js — localStorage の読み書き
 * ---------------------------------------------------------------------
 * 【保存キー】
 *   waka.draft   手作りモードの下書き
 *                { ku:[5], kana:[5], manual:[5], author, editingId, meaning }
 *                meaning = 意味・ひとこと（作品帳の編集・かんたんから渡されたもの。完成画面の初期値）
 *                manual[i] = 読みを手で直した（本文を変えるまで自動推定しない）
 *   waka.gallery 作品帳 { v:1, items:[ {id, ku, kana, author, meaning, createdAt, updatedAt, layout, palette} ] }
 *   waka.prefs   設定 { author, layout, palette, meaningInImage, introSeen }
 *                introSeen = かんたんの「はじめての案内」を閉じた
 *                font = 画像の書体（render.fonts の id）、seal = 落款を押す（既定 true）
 *                minnaAgreed = みんなの和歌への投稿の確認に同意した（2 回目から確認を省く、DESIGN 14.2）
 * 保存失敗（容量超過・プライベートモード）は false を返し、トーストで知らせる。
 * localStorage がそもそも使えない環境（Safari のプライベート・保存を禁止した設定など）では、
 * ページを開いている間だけメモリに置き、最初の 1 回だけ「この環境では保存できません」と出す（DESIGN 12-9）。
 * 他の画面（view-easy の waka.easy など）も store.raw 経由で読み書きする。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var S = {};

  // localStorage が使えるか（1 回だけ試す）。アクセスしただけで例外になる環境もある
  var usable = null, warned = false;
  function storage() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function probe() {
    if (usable !== null) return usable;
    try {
      var ls = storage();
      ls.setItem('waka.__probe', '1');
      ls.removeItem('waka.__probe');
      usable = true;
    } catch (e) { usable = false; }
    return usable;
  }
  // 使えない環境の案内（1 回だけ）。トーストの部品がまだ無ければ後で出す
  function warnUnusable() {
    if (warned) return;
    if (!W.ui || !document.getElementById('toast')) return;
    warned = true;
    W.ui.toast('この環境では保存できません（作品帳・下書きは残りません）', 'error');
  }

  // 使えないときはページを開いている間だけメモリに置く（はじめての案内・設定などが画面内で効くように）
  var memory = {};

  function read(key, fallback) {
    if (!probe()) {
      warnUnusable();
      try { return key in memory ? JSON.parse(memory[key]) : fallback; } catch (e) { return fallback; }
    }
    try {
      var raw = storage().getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    if (!probe()) { warnUnusable(); memory[key] = JSON.stringify(value); return true; }
    try {
      storage().setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (W.ui) W.ui.toast('端末に保存できませんでした（容量がいっぱいか、保存が許可されていません）', 'error');
      return false;
    }
  }

  function remove(key) {
    if (!probe()) { delete memory[key]; return; }
    try { storage().removeItem(key); } catch (e) {}
  }

  // 生の読み書き（JSON）。失敗しても例外を出さない
  S.available = function () { return probe(); };
  S.warnIfUnavailable = function () { if (!probe()) warnUnusable(); };
  S.raw = { get: read, set: write, remove: remove };

  function five(arr, fill) {
    var out = [];
    for (var i = 0; i < 5; i++) out.push(arr && arr[i] != null ? arr[i] : fill);
    return out;
  }

  /* ---------- 設定 ---------- */
  S.prefs = {
    get: function () {
      var p = read('waka.prefs', {}) || {};
      return { author: p.author || '', layout: p.layout || 'tanzaku', palette: p.palette || 'washi', meaningInImage: p.meaningInImage === true,
        introSeen: p.introSeen === true, font: p.font || 'shippori', seal: p.seal !== false, minnaAgreed: p.minnaAgreed === true };
    },
    set: function (patch) {
      var p = S.prefs.get();
      Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
      return write('waka.prefs', p);
    }
  };

  /* ---------- 下書き ---------- */
  S.draft = {
    empty: function () {
      return { ku: five(null, ''), kana: five(null, ''), manual: five(null, false), author: S.prefs.get().author, editingId: null, meaning: '' };
    },
    load: function () {
      var d = read('waka.draft', null);
      if (!d) return S.draft.empty();
      return {
        ku: five(d.ku, ''), kana: five(d.kana, ''), manual: five(d.manual, false),
        author: d.author != null ? d.author : S.prefs.get().author,
        editingId: d.editingId || null,
        meaning: typeof d.meaning === 'string' ? d.meaning : ''
      };
    },
    save: function (d) { return write('waka.draft', d); },
    clear: function () { remove('waka.draft'); },
    // 句が 1 つも入っていなければ空とみなす
    isEmpty: function (d) {
      d = d || S.draft.load();
      return d.ku.every(function (s) { return !String(s || '').trim(); });
    }
  };

  /* ---------- 作品帳 ---------- */
  function loadGallery() {
    var g = read('waka.gallery', null);
    if (!g || !Array.isArray(g.items)) return { v: 1, items: [] };
    return g;
  }

  function newId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function sanitize(it) {
    return {
      id: String(it.id || newId()),
      ku: five(it.ku, '').map(String),
      kana: five(it.kana, '').map(String),
      author: String(it.author || ''),
      meaning: String(it.meaning || ''),
      createdAt: it.createdAt || new Date().toISOString(),
      updatedAt: it.updatedAt || it.createdAt || new Date().toISOString(),
      layout: it.layout || 'tanzaku',
      palette: it.palette || 'washi'
    };
  }

  S.gallery = {
    // 新しい順
    list: function () {
      return loadGallery().items.slice().sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      });
    },
    get: function (id) {
      return loadGallery().items.filter(function (it) { return it.id === id; })[0] || null;
    },
    // 本文・読み・雅号が同じ歌（重複保存を防ぐ）。無ければ null
    findSame: function (poem) {
      var key = function (p) { return [five(p.ku, '').join('|'), five(p.kana, '').join('|'), String(p.author || '')].join('#'); };
      var k = key(poem);
      return loadGallery().items.filter(function (it) { return key(it) === k; })[0] || null;
    },
    // id があれば上書き、無ければ追加。保存した item を返す（失敗時 null）
    save: function (poem) {
      var g = loadGallery();
      var now = new Date().toISOString();
      var idx = -1;
      if (poem.id) g.items.forEach(function (it, i) { if (it.id === poem.id) idx = i; });
      var item;
      if (idx >= 0) {
        item = sanitize(Object.assign({}, g.items[idx], poem, { updatedAt: now }));
        g.items[idx] = item;
      } else {
        item = sanitize(Object.assign({}, poem, { id: newId(), createdAt: now, updatedAt: now }));
        g.items.push(item);
      }
      return write('waka.gallery', g) ? item : null;
    },
    remove: function (id) {
      var g = loadGallery();
      g.items = g.items.filter(function (it) { return it.id !== id; });
      return write('waka.gallery', g);
    },
    exportJSON: function () {
      return JSON.stringify(loadGallery(), null, 2);
    },
    // 同じ id は updatedAt が新しい方を残す。{added, updated, skipped} を返す。形式違いは throw
    importJSON: function (text) {
      var data = JSON.parse(text);
      var items = Array.isArray(data) ? data : data && data.items;
      if (!Array.isArray(items)) throw new Error('作品帳の形式ではありません');
      var g = loadGallery();
      var res = { added: 0, updated: 0, skipped: 0 };
      items.forEach(function (raw) {
        if (!raw || !Array.isArray(raw.ku)) { res.skipped++; return; }
        var it = sanitize(raw);
        var idx = -1;
        g.items.forEach(function (x, i) { if (x.id === it.id) idx = i; });
        if (idx < 0) { g.items.push(it); res.added++; }
        else if (String(it.updatedAt) > String(g.items[idx].updatedAt)) { g.items[idx] = it; res.updated++; }
        else res.skipped++;
      });
      if (!write('waka.gallery', g)) throw new Error('保存できませんでした');
      return res;
    }
  };

  W.store = S;
})();
