/* =====================================================================
 * js/reading.js — 読み推定（kuromoji.js の遅延読込とフォールバック）
 * ---------------------------------------------------------------------
 *   WAKA.reading.estimate(text) -> Promise<string>  ひらがなの読み
 *       仮名だけなら即座にひらがなへ揃えて返す。
 *       漢字があれば kuromoji を初回だけ CDN から読み込んで推定する。
 *       http(s) では Web Worker（js/reading-worker.js）で辞書の読み込み・展開と解析をする
 *       （主スレッドを止めない）。file:// や Worker が動かないときは主スレッドで動かす。
 *       読込失敗・10 秒タイムアウト時は reject（画面は手入力に切り替える）。
 *   WAKA.reading.state   'idle' | 'loading' | 'ready' | 'failed'
 *   WAKA.reading.preload()  先読み（失敗しても何もしない）
 *   WAKA.reading.preloadIdle()  アイドル時に先読みを始める（requestIdleCallback、無ければ setTimeout）。
 *       じっくり・自分の言葉で書く・現代語で一言 の画面が開いたときに呼ぶ（DESIGN 12-8）
 *   WAKA.reading.tokenize(text) -> Promise<token[]>  kuromoji の形態素
 *       （かんたんモードの「現代語で一言」用。使えなければ reject）
 * 読みの優先順位（形態素の頭から最長一致で辞書を引く）:
 *   (a) data/readings.js の WAKA.readings（歌読み優先の小辞書）
 *   (b) data/words.js / makura.js の word → kana
 *   (c) kuromoji の読み（現代読み）
 * 辞書語は形態素の境目で終わるか、語が送り仮名（仮名）で終わり残りが仮名のとき
 * だけ採る（「上る」を「うへる」にしないため）。kuromoji が使えないときも、
 * 辞書と仮名だけで読み切れる句はその読みを返す。読み欄は常に手で直せる。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var BASE = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/';
  var TIMEOUT_MS = 10000;
  // Worker のスクリプト（reading.js と同じ場所・同じ ?v=）
  var cur = typeof document !== 'undefined' && document.currentScript;
  var WORKER_URL = cur && cur.src ? cur.src.replace(/reading\.js(\?|$)/, 'reading-worker.js$1') : 'js/reading-worker.js';

  var R = { state: 'idle' };
  var tokenizerPromise = null;

  // script タグで kuromoji 本体を読み込む（fetch は使わない）
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.kuromoji) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { window.kuromoji ? resolve() : reject(new Error('kuromoji が見つかりません')); };
      s.onerror = function () { reject(new Error('kuromoji を読み込めません')); };
      document.head.appendChild(s);
    });
  }

  // 主スレッドで kuromoji を動かす（file:// など Worker が使えないとき）。辞書の展開中は画面が止まる
  function mainTokenizer() {
    return loadScript(BASE + 'build/kuromoji.js').then(function () {
      return new Promise(function (resolve, reject) {
        window.kuromoji.builder({ dicPath: BASE + 'dict/' }).build(function (err, tk) {
          if (err || !tk) reject(err || new Error('辞書を読み込めません'));
          else resolve({ tokenize: function (s) { return Promise.resolve(tk.tokenize(s)); } });
        });
      });
    });
  }

  // Web Worker で kuromoji を動かす（http(s) のとき。辞書の読み込み・展開で主スレッドを止めない）
  function workerTokenizer() {
    return new Promise(function (resolve, reject) {
      var w;
      try { w = new Worker(WORKER_URL); } catch (e) { reject(e); return; }
      var seq = 0, waiting = {}, ready = false;
      function fail(msg) {
        Object.keys(waiting).forEach(function (k) { waiting[k].reject(new Error(msg)); });
        waiting = {};
        try { w.terminate(); } catch (e) { /* 無視 */ }
        if (!ready) reject(new Error(msg));
      }
      w.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === 'ready') {
          ready = true;
          resolve({
            tokenize: function (s) {
              return new Promise(function (res, rej) {
                var id = ++seq;
                waiting[id] = { resolve: res, reject: rej };
                w.postMessage({ id: id, text: s });
              });
            }
          });
          return;
        }
        if (m.type === 'error') { fail(m.message || '辞書を読み込めません'); return; }
        var p = waiting[m.id];
        if (!p) return;
        delete waiting[m.id];
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.tokens || []);
      };
      w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();   // コンソールに出さない（呼び出し側で扱う）
        fail('Worker で読み推定を動かせません');
      };
      w.postMessage({ base: BASE });
    });
  }

  function canUseWorker() {
    return typeof window.Worker === 'function' && /^https?:$/.test(location.protocol);
  }

  function getTokenizer() {
    if (tokenizerPromise) return tokenizerPromise;
    R.state = 'loading';
    // Worker が動かなければ主スレッドで読み直す
    var work = canUseWorker() ? workerTokenizer().catch(function () { return mainTokenizer(); }) : mainTokenizer();
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, TIMEOUT_MS);
    });
    tokenizerPromise = Promise.race([work, timeout]).then(function (tk) {
      R.state = 'ready';
      return tk;
    }, function (e) {
      R.state = 'failed';
      throw e;
    });
    return tokenizerPromise;
  }

  /* ---------- 歌読み辞書 ---------- */
  var KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;
  var dict = null, maxLen = 0;

  // (a) readings を優先し、(b) words / makura で足りない語を補う。漢字を含む語だけ
  function buildDict() {
    if (dict) return dict;
    dict = Object.create(null);
    function add(word, kana, force) {
      word = String(word || '').trim(); kana = String(kana || '').trim();
      if (!word || !kana || !KANJI.test(word)) return;
      if (!force && dict[word]) return;
      dict[word] = W.mora.toHira(kana);
      if (word.length > maxLen) maxLen = word.length;
    }
    var rd = W.readings || {};
    Object.keys(rd).forEach(function (k) { add(k, rd[k], true); });
    (W.words || []).forEach(function (w) { add(w.word, w.kana); });
    (W.makura || []).forEach(function (m) { add(m.word, m.kana); });
    return dict;
  }

  // s の pos から始まる最長の辞書語。ok(end, key) が false の候補は飛ばす
  function longest(s, pos, ok) {
    var d = buildDict();
    for (var n = Math.min(maxLen, s.length - pos); n > 0; n--) {
      var key = s.substr(pos, n);
      if (d[key] && ok(pos + n, key)) return key;
    }
    return null;
  }

  function isKanaStr(x) { return x === '' || W.mora.isKanaOnly(x); }
  function lastIsKana(key) { return !KANJI.test(key.charAt(key.length - 1)); }

  // kuromoji の形態素列に辞書を当てて読みを組み立てる
  function readTokens(tokens) {
    var s = '', starts = [], ends = {};
    tokens.forEach(function (t) { starts.push(s.length); s += t.surface_form; ends[s.length] = true; });
    var out = '', i = 0;
    while (i < tokens.length) {
      var pos = starts[i];
      var key = longest(s, pos, function (end, k) {
        if (ends[end]) return true;                    // 形態素の境目で終わる
        if (!lastIsKana(k)) return false;              // 漢字で終わる語は境目必須
        // 語尾が送り仮名なら、その形態素の残りが仮名だけのときに限る
        var j = i; while (j + 1 < tokens.length && starts[j + 1] < end) j++;
        var tEnd = starts[j] + tokens[j].surface_form.length;
        return isKanaStr(s.slice(end, tEnd));
      });
      if (key) {
        var end = pos + key.length;
        out += dict[key];
        while (i < tokens.length && starts[i] + tokens[i].surface_form.length <= end) i++;
        if (i < tokens.length && starts[i] < end) {   // 形態素の途中で終わった：残りの仮名を足す
          out += W.mora.toHira(s.slice(end, starts[i] + tokens[i].surface_form.length));
          i++;
        }
        continue;
      }
      var t = tokens[i];
      var r = t.reading && t.reading !== '*' ? t.reading : t.surface_form;
      out += W.mora.toHira(r);
      i++;
    }
    return out.replace(/\s+/g, '');
  }

  // kuromoji なしで：辞書語と仮名だけで読み切れれば返す（無理なら null）
  function readByDict(src) {
    var out = '', pos = 0;
    while (pos < src.length) {
      var key = longest(src, pos, function () { return true; });
      if (key) { out += dict[key]; pos += key.length; continue; }
      var ch = src.charAt(pos);
      if (KANJI.test(ch)) return null;
      out += W.mora.toHira(ch); pos++;
    }
    out = out.replace(/\s+/g, '');
    return W.mora.isKanaOnly(out) ? out : null;
  }

  R.estimate = function (text) {
    var mora = W.mora;
    var src = String(text == null ? '' : text).trim();
    if (!src) return Promise.resolve('');
    if (mora.isKanaOnly(src)) return Promise.resolve(mora.toHira(src).replace(/\s+/g, ''));
    function fallback(e) {
      var r = readByDict(src);
      if (r != null) return r;
      throw e || new Error('読み推定は使えません');
    }
    if (R.state === 'failed') {
      try { return Promise.resolve(fallback()); } catch (e) { return Promise.reject(e); }
    }
    return getTokenizer().then(function (tk) { return tk.tokenize(src); }).then(readTokens, fallback);
  };

  // テスト用：形態素列（{surface_form, reading}）から読みを組み立てる
  R._readTokens = readTokens;
  R._readByDict = readByDict;

  // 形態素に分ける（{surface_form, basic_form, pos, reading, ...}）。失敗時は reject
  R.tokenize = function (text) {
    var src = String(text == null ? '' : text);
    if (R.state === 'failed') return Promise.reject(new Error('読み推定は使えません'));
    return getTokenizer().then(function (tk) { return tk.tokenize(src); });
  };

  R.preload = function () {
    getTokenizer().catch(function () { /* 失敗は estimate 側で扱う */ });
  };

  var idleQueued = false;
  R.preloadIdle = function () {
    if (R.state !== 'idle' || idleQueued) return;
    idleQueued = true;
    var go = function () { if (R.state === 'idle') R.preload(); };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1200);
  };

  W.reading = R;
})();
