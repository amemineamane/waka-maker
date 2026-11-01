/* =====================================================================
 * js/view-minna.js — みんなの和歌（#/minna、DESIGN 14）
 * ---------------------------------------------------------------------
 * 【W.minna】 投稿の受け口（Google Apps Script のウェブアプリ、data/site.js の minna.api）との通信。
 *   1 章の「外部通信は Google Fonts と kuromoji だけ」の例外で、この機能だけが fetch を使う。
 *   minna.api が空なら enabled() は false（タブ・投稿ボタンを出さない。file:// でも壊れない）。
 *   応答は常に HTTP 200 の JSON。失敗は Error に kind を付けて reject する:
 *     'network'（通信できない）/ 'timeout'（15 秒）/ 'parse'（JSON でない応答）/ 'api'（ok:false、code = error）
 *   POST はプリフライトを避けるため Content-Type: text/plain（GAS は 302 で googleusercontent へ飛ぶ）。
 * 【保存キー】（すべて store.raw 経由）
 *   waka.minna.cache   最後に取れた一覧 { v:1, at, items:[…最大 60] }（次回はこれを先に出してから更新）
 *   waka.minna.mine    自分の投稿 [{ id, deleteToken, postedAt, savedId, ku }]（取り下げ・投稿済みの判定）
 *   waka.minna.client  端末ごとの識別子（英数 16 文字。連投の制限に使う）
 *   waka.prefs.minnaAgreed  投稿の確認に同意した（2 回目から確認を省く）
 * 【画面】 縦書きカードを新着順。「今日のお題だけ」「更新」「もっと見る」（before で 30 件ずつ）。
 *   カードのタップ・「画像にする」で ui.finish の閲覧モード、「なぞる」でじっくりへ、自分の投稿は「取り下げる」。
 *   表示中は 60 秒ごとに 1 ページ目を読み直し、新着だけを先頭に足す（配信の OBS ブラウザソース向け）。
 *   #/minna/odai で開くと「今日のお題だけ」から始まる。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;

  var KEY_CACHE = 'waka.minna.cache', KEY_MINE = 'waka.minna.mine', KEY_CLIENT = 'waka.minna.client';
  var PAGE = 30, CACHE_MAX = 60;
  var KANA_RE = /^[ぁ-ゖァ-ヺー]+$/;

  var M = {
    timeoutMs: 15000,   // 応答を待つ上限
    autoMs: 60000       // 一覧の自動更新の間隔
  };

  function api() {
    var m = W.site && W.site.minna;
    return m && typeof m.api === 'string' ? m.api.trim() : '';
  }
  M.enabled = function () { return !!api(); };

  function raw() { return W.store.raw; }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function five(a) { var o = []; for (var i = 0; i < 5; i++) o.push(String(a && a[i] != null ? a[i] : '')); return o; }
  function kuKey(ku) { return five(ku).map(trim).join('|'); }
  // 文字数はコードポイントで数える（GAS 側の Array.from と同じ）
  function len(s) { return Array.from(String(s)).length; }
  function cut(s, n) { return Array.from(String(s)).slice(0, n).join(''); }
  function today() {
    if (W.easyGen && typeof W.easyGen.jstDate === 'function') return W.easyGen.jstDate();
    var d = new Date(Date.now() + 9 * 3600e3);
    return d.toISOString().slice(0, 10);
  }
  function track(name, params) { if (window.gtag) try { window.gtag('event', name, params || {}); } catch (e) {} }

  /* ---------- 通信 ---------- */
  function apiError(kind, code) {
    var e = new Error('minna ' + kind + (code ? ':' + code : ''));
    e.kind = kind; e.code = code || '';
    return e;
  }

  // method 'GET'（query をクエリに）/ 'POST'（body を JSON の text/plain で）
  function request(method, query, body) {
    var url = api();
    if (!url) return Promise.reject(apiError('disabled'));
    if (typeof fetch !== 'function') return Promise.reject(apiError('network'));
    if (query) {
      var qs = Object.keys(query).filter(function (k) { return query[k] != null && query[k] !== ''; })
        .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); }).join('&');
      if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    }
    var init = { method: method, redirect: 'follow', credentials: 'omit', cache: 'no-store' };
    if (body) { init.headers = { 'Content-Type': 'text/plain' }; init.body = JSON.stringify(body); }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    if (ctrl) init.signal = ctrl.signal;
    return new Promise(function (resolve, reject) {
      var done = false;
      // AbortController が無い環境でも、時間が来たらこちらで諦める
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctrl) try { ctrl.abort(); } catch (e) {}
        reject(apiError('timeout'));
      }, M.timeoutMs);
      var p;
      try { p = fetch(url, init); } catch (e) { p = Promise.reject(e); }
      p.then(function (res) { return res.text(); }).then(function (text) {
        if (done) return;
        done = true; clearTimeout(timer);
        var j;
        try { j = JSON.parse(text); } catch (e) { reject(apiError('parse')); return; }
        if (!j || typeof j !== 'object') { reject(apiError('parse')); return; }
        if (j.ok !== true) { reject(apiError('api', String(j.error || 'server'))); return; }
        resolve(j);
      }, function () {
        if (done) return;
        done = true; clearTimeout(timer);
        reject(apiError('network'));
      });
    });
  }

  function normItem(it) {
    if (!it || typeof it !== 'object' || !it.id || !Array.isArray(it.ku)) return null;
    var t = Number(it.createdAt);
    if (!isFinite(t) || !t) t = Date.parse(it.createdAt) || 0;
    var odai = String(it.odai || '');
    return {
      id: String(it.id), ku: five(it.ku), kana: five(it.kana),
      author: String(it.author || ''), meaning: String(it.meaning || ''),
      odai: /^\d{4}-\d{2}-\d{2}$/.test(odai) ? odai : '', createdAt: t
    };
  }
  function normList(arr) { return (Array.isArray(arr) ? arr : []).map(normItem).filter(Boolean); }

  // { limit, odai, before } → { items, more }
  M.list = function (q) {
    q = q || {};
    return request('GET', { action: 'list', limit: q.limit || PAGE, odai: q.odai || '', before: q.before || '' }).then(function (j) {
      return { items: normList(j.items), more: !!j.more };
    });
  };

  /* ---------- 端末の記録 ---------- */
  function clientId() {
    var c = raw().get(KEY_CLIENT, '');
    if (typeof c === 'string' && /^[A-Za-z0-9]{8,64}$/.test(c)) return c;
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = '', buf = null;
    try { buf = window.crypto.getRandomValues(new Uint8Array(16)); } catch (e) {}
    for (var i = 0; i < 16; i++) out += chars.charAt((buf ? buf[i] : Math.floor(Math.random() * 256)) % chars.length);
    raw().set(KEY_CLIENT, out);
    return out;
  }
  function mine() { var m = raw().get(KEY_MINE, []); return Array.isArray(m) ? m.filter(function (x) { return x && x.id; }) : []; }
  M.mine = mine;
  M.mineOf = function (id) { return mine().filter(function (x) { return x.id === id; })[0] || null; };
  // 同じ歌を投稿済みか（作品帳の id が同じ、または 5 句が同じ）
  M.isPosted = function (p) {
    var k = kuKey(p.ku);
    return mine().some(function (x) { return (p.savedId && x.savedId === p.savedId) || (x.ku && kuKey(x.ku) === k); });
  };

  function readCache() {
    var c = raw().get(KEY_CACHE, null);
    return c && Array.isArray(c.items) ? normList(c.items) : [];
  }
  function writeCache(items) { raw().set(KEY_CACHE, { v: 1, at: Date.now(), items: items.slice(0, CACHE_MAX) }); }
  function dropFromCache(id) {
    var items = readCache();
    if (items.some(function (x) { return x.id === id; })) writeCache(items.filter(function (x) { return x.id !== id; }));
  }

  /* ---------- 投稿・取り下げ ---------- */
  // 送る前の形の確認（NG ワードはサーバー側だけで見る）。問題があれば案内の文、無ければ ''
  M.checkPoem = function (p) {
    var ku = five(p.ku).map(trim);
    if (ku.some(function (s) { return !s; })) return '5 句すべて入れてから投稿してください';
    if (ku.some(function (s) { return len(s) > 15; })) return '投稿できるのは 1 句 15 文字までです';
    var all = ku.join('') + String(p.author || '') + String(p.meaning || '');
    if (/http/i.test(all) || all.indexOf('://') >= 0 || /[\r\n]/.test(ku.join('') + String(p.author || ''))) return 'URL（http）や改行は投稿できません';
    return '';
  };

  M.post = function (p) {
    var body = {
      action: 'post',
      ku: five(p.ku).map(trim),
      // 読みは仮名だけ（漢字などが残っている句は空で送る）
      kana: five(p.kana).map(function (k) { k = String(k || '').replace(/\s+/g, ''); return KANA_RE.test(k) && len(k) <= 20 ? k : ''; }),
      author: cut(trim(p.author), 20),
      meaning: cut(trim(p.meaning), 200),
      odai: /^\d{4}-\d{2}-\d{2}$/.test(String(p.odai || '')) ? String(p.odai) : '',
      client: clientId()
    };
    return request('POST', null, body).then(function (j) {
      if (!j.id || !j.deleteToken) throw apiError('parse');
      var list = mine();
      list.push({ id: String(j.id), deleteToken: String(j.deleteToken), postedAt: Date.now(), savedId: p.savedId || null, ku: body.ku });
      raw().set(KEY_MINE, list);
      // 一覧を開いたときにすぐ見えるよう、控えの先頭にも入れておく
      writeCache([normItem({ id: j.id, ku: body.ku, kana: body.kana, author: body.author, meaning: body.meaning, odai: body.odai, createdAt: Date.now() })].concat(readCache()));
      track('minna_post', { odai: body.odai ? 1 : 0 });
      return j;
    });
  };

  // 取り下げ。成功・見つからない（もう無い）のときは記録と控えから消す
  M.remove = function (id) {
    var m = M.mineOf(id);
    if (!m || !m.deleteToken) return Promise.reject(apiError('api', 'forbidden'));
    function forget() {
      raw().set(KEY_MINE, mine().filter(function (x) { return x.id !== id; }));
      dropFromCache(id);
    }
    return request('POST', null, { action: 'delete', id: id, deleteToken: m.deleteToken }).then(function (j) {
      forget();
      track('minna_delete');
      return j;
    }, function (err) {
      if (err.kind === 'api' && err.code === 'notfound') forget();
      throw err;
    });
  };

  // 失敗の案内（what: 'post' | 'delete' | 'list'）
  M.errorText = function (err, what) {
    var base = what === 'post' ? '投稿できませんでした' : what === 'delete' ? '取り下げできませんでした' : '読み込めませんでした';
    var kind = err && err.kind, code = err && err.code;
    if (kind === 'network') return base + '（通信できません。電波のよいところでもう一度）';
    if (kind === 'timeout') return base + '（時間がかかりすぎました。もう一度）';
    if (kind === 'parse') return base + '（受け口から正しい返事がありません。時間をおいてもう一度）';
    if (kind === 'disabled') return 'みんなの和歌は準備中です';
    if (kind === 'api') {
      if (code === 'ng') return '使えない言葉が含まれています';
      if (code === 'rate') return '少し待ってからもう一度投稿してください';
      if (code === 'dup') return '同じ歌がすでにあります';
      if (code === 'notfound') return 'その投稿は見つかりませんでした（取り下げ済みかもしれません）';
      if (code === 'forbidden') return 'この端末から投稿した歌ではないので、取り下げできません';
      if (code === 'invalid' && what === 'post') return '投稿できない形です（各句 15 文字まで・URL は入れられません）';
    }
    return base;
  };

  // 投稿の確認（DESIGN 14.2）。毎回出す。名前（任意）を入れられる。「投稿する」で onOk(name)
  //   opts = { author: いまの雅号（名前欄の初期値） }
  M.confirm = function (opts, onOk) {
    if (typeof opts === 'function') { onOk = opts; opts = {}; }
    opts = opts || {};
    var okBtn = el('button', { type: 'button', class: 'btn btn-primary minna-ok', text: '投稿する' });
    var noBtn = el('button', { type: 'button', class: 'btn minna-cancel', text: 'やめる' });
    var name = el('input', {
      type: 'text', class: 'author-input minna-name', value: String(opts.author || ''), maxlength: '20',
      placeholder: '空なら「詠み人知らず」', autocomplete: 'off', 'aria-describedby': 'minna-name-note'
    });
    var h = ui.modal('みんなの和歌に投稿', [
      el('div', { class: 'minna-confirm' }, [
        el('label', { class: 'minna-name-label' }, [el('span', { class: 'minna-name-title', text: '名前（任意・20 文字まで）' }), name]),
        el('p', { class: 'small', id: 'minna-name-note', text: '名前は歌と一緒に表示され、画像の雅号にもなります。名前以外の個人情報は送りません・集めません。' }),
        el('p', { text: '投稿した歌は、みんなの和歌のページで誰でも見られます（大意も一緒に出ます）。あとで取り下げられます。不適切な投稿は運営が非表示にします。' }),
        el('p', { class: 'small' }, [el('a', { href: '#/terms', text: '利用規約' }), '（みんなの和歌への投稿）']),
        el('div', { class: 'btn-row' }, [okBtn, noBtn])
      ])
    ], { onClose: null });
    var ok = function () { h.close(); onOk(cut(trim(name.value), 20)); };
    okBtn.addEventListener('click', ok);
    name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    noBtn.addEventListener('click', function () { h.close(); });
    try { name.focus({ preventScroll: true }); } catch (e) {}
    return h;
  };

  W.minna = M;

  /* =====================================================================
   * 画面
   * ===================================================================== */
  var V = { root: null, items: [], more: false, odaiOnly: false, loading: false, appending: false,
    failed: '', fromCache: false, seq: 0, timer: null };

  function attached() { return !!(V.list && document.contains(V.list)); }

  function md(odai) { var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(odai || ''); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  function dateText(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // カードの「なぞる」/ 閲覧モードの「なぞる」: じっくりへ下書きとして渡す（雅号は自分の prefs.author、意味は空）
  function trace(it, fromFinish) {
    var cur = W.store.draft.load();
    var d = W.store.draft.empty();
    d.ku = it.ku.slice(); d.kana = it.kana.slice();
    d.manual = it.kana.map(function (k) { return !!trim(k); });
    d.meaning = '';
    if (fromFinish && !W.store.draft.isEmpty(cur)) ui.toast('書きかけの下書きは、この歌で置きかえられました');
    if (W.store.draft.save(d)) location.hash = '#/compose';
  }

  // 画像にする: 完成画面の閲覧モード（雅号・落款は投稿者のもの）
  function openImage(it) {
    ui.finish({ ku: it.ku.slice(), kana: it.kana.slice(), author: it.author, meaning: it.meaning }, {
      readOnly: true, title: 'みんなの和歌',
      onTrace: function () { trace(it, true); }
    });
  }

  function withdraw(it, btn) {
    btn.disabled = true;
    btn.textContent = '取り下げています…';
    M.remove(it.id).then(function () {
      removeItem(it.id);
      ui.toast('取り下げました', 'ok');
    }, function (err) {
      if (err.kind === 'api' && err.code === 'notfound') { removeItem(it.id); ui.toast(M.errorText(err, 'delete')); return; }
      btn.disabled = false;
      btn.textContent = '取り下げる';
      ui.toast(M.errorText(err, 'delete'), 'error');
    });
  }
  function removeItem(id) {
    V.items = V.items.filter(function (x) { return x.id !== id; });
    if (!attached()) return;
    paintList();
    try { V.refreshBtn.focus({ preventScroll: true }); } catch (e) {}
  }

  function card(it) {
    var my = !!M.mineOf(it.id);
    var poem = ui.tatePoem(it.ku, 'mn-poem');
    // カードのタップで画像に（キーボードは下の「画像にする」ボタン）
    poem.addEventListener('click', function () { openImage(it); });
    var who = it.author || '詠み人知らず';
    var imgBtn = el('button', { type: 'button', class: 'btn mn-act mn-img', text: '画像にする' });
    imgBtn.addEventListener('click', function () { openImage(it); });
    var traceBtn = ui.twoStep('なぞる', '下書きを置きかえます。もう一度押す', function () { trace(it, false); },
      { class: 'btn mn-act mn-trace', skipIf: function () { return W.store.draft.isEmpty(); } });
    var delBtn = null;
    if (my) {
      delBtn = ui.twoStep('取り下げる', 'もう一度押すと取り下げ', function () { withdraw(it, delBtn); }, { class: 'btn mn-act mn-withdraw' });
    }
    return el('article', { class: 'mn-card' + (my ? ' is-mine' : ''), 'data-id': it.id, 'aria-label': who + 'の歌' }, [
      el('div', { class: 'mn-poem-wrap' }, poem),
      el('p', { class: 'mn-meta' }, [
        el('span', { class: 'mn-author', text: who }),
        el('span', { class: 'mn-date', text: dateText(it.createdAt) }),
        it.odai ? el('span', { class: 'mn-odai', text: '今日のお題 ' + md(it.odai) }) : null,
        my ? el('span', { class: 'mn-mine', text: 'あなたの投稿' }) : null
      ]),
      it.meaning ? el('details', { class: 'mn-mean' }, [
        el('summary', { text: '大意' }),
        el('p', { text: it.meaning })
      ]) : null,
      el('div', { class: 'mn-actions' }, [imgBtn, traceBtn, delBtn])
    ]);
  }

  function skeleton() {
    var out = [];
    for (var i = 0; i < 6; i++) {
      out.push(el('div', { class: 'mn-card mn-skel', 'aria-hidden': 'true' }, [
        el('div', { class: 'mn-skel-poem' }, [el('i'), el('i'), el('i'), el('i'), el('i')]),
        el('div', { class: 'mn-skel-line' })
      ]));
    }
    return out;
  }

  function paintList() {
    var list = V.list;
    list.innerHTML = '';
    list.setAttribute('aria-busy', String(V.loading && !V.items.length));
    if (!V.items.length) {
      if (V.loading) { skeleton().forEach(function (n) { list.appendChild(n); }); return; }
      if (V.failed) return;
      list.appendChild(el('div', { class: 'empty mn-empty' }, [
        el('p', { text: V.odaiOnly ? '今日のお題の投稿はまだありません。' : 'まだ投稿はありません。' }),
        el('p', { class: 'muted', text: '「できた！」の画面の「みんなの和歌に投稿」から載せられます。' }),
        el('a', { class: 'btn btn-primary', href: '#/easy', text: '一首詠んでみる' })
      ]));
      return;
    }
    V.items.forEach(function (it) { list.appendChild(card(it)); });
  }

  function paintStatus() {
    var s = V.status;
    s.innerHTML = '';
    V.refreshBtn.disabled = V.loading;
    V.toggle.disabled = V.loading;
    if (V.failed) {
      var again = el('button', { type: 'button', class: 'btn mn-retry', text: 'もう一度' });
      again.addEventListener('click', function () { load(V.retryAppend); });
      s.appendChild(el('div', { class: 'mn-error' }, [
        el('p', { text: V.failed + (V.items.length && !V.retryAppend ? '　前に読んだ一覧を出しています。' : '') }),
        again
      ]));
    } else if (V.loading) {
      s.appendChild(el('p', { class: 'mn-loading small muted', text: V.items.length ? '新しい歌を読み込んでいます…' : '読み込んでいます…' }));
    }
    // もっと見る
    V.moreBox.innerHTML = '';
    if (V.more && V.items.length && !(V.failed && V.retryAppend)) {
      var b = el('button', { type: 'button', class: 'btn mn-more', text: V.appending ? '読み込んでいます…' : 'もっと見る', disabled: V.loading });
      b.addEventListener('click', function () { load(true); });
      V.moreBox.appendChild(b);
    }
  }

  function load(append) {
    var seq = ++V.seq;
    V.loading = true; V.appending = !!append; V.failed = ''; V.retryAppend = !!append;
    paintStatus();
    var q = { limit: PAGE };
    if (V.odaiOnly) q.odai = today();
    if (append && V.items.length) q.before = V.items[V.items.length - 1].createdAt;
    var before = V.items.length;
    M.list(q).then(function (r) {
      if (seq !== V.seq || !attached()) return;
      V.loading = false; V.appending = false; V.fromCache = false;
      if (append) {
        var seen = {};
        V.items.forEach(function (x) { seen[x.id] = 1; });
        V.items = V.items.concat(r.items.filter(function (x) { return !seen[x.id]; }));
      } else V.items = r.items;
      V.more = r.more;
      if (!V.odaiOnly) writeCache(V.items);
      paintList(); paintStatus();
      // もっと見るのあとは、足した最初のカードへ
      if (append) {
        var first = V.list.children[before];
        var btn = first && first.querySelector('.mn-img');
        if (btn) try { btn.focus({ preventScroll: true }); } catch (e) {}
      }
    }, function (err) {
      if (seq !== V.seq || !attached()) return;
      V.loading = false; V.appending = false;
      V.failed = M.errorText(err, 'list');
      if (!append) paintList();
      paintStatus();
    });
  }

  // 自動更新: 1 ページ目を読み直して、新着だけを先頭に足す（読んでいる場所・フォーカスは動かさない）
  function autoTick() {
    if (!attached()) { stopAuto(); return; }
    if (document.hidden || V.loading || document.querySelector('.modal')) return;
    var seq = V.seq;
    M.list({ limit: PAGE, odai: V.odaiOnly ? today() : '' }).then(function (r) {
      if (seq !== V.seq || !attached() || V.loading) return;
      var seen = {};
      V.items.forEach(function (x) { seen[x.id] = 1; });
      var fresh = r.items.filter(function (x) { return !seen[x.id]; });
      if (!fresh.length) return;
      var wasEmpty = !V.items.length;
      V.items = fresh.concat(V.items);
      if (!V.odaiOnly) writeCache(V.items);
      if (wasEmpty) { V.more = r.more; paintList(); paintStatus(); return; }
      var head = V.list.firstChild;
      fresh.forEach(function (it) { V.list.insertBefore(card(it), head); });
    }, function () { /* 自動更新の失敗は黙って次を待つ */ });
  }
  function startAuto() { stopAuto(); if (M.autoMs > 0) V.timer = setInterval(autoTick, M.autoMs); }
  function stopAuto() { if (V.timer) clearInterval(V.timer); V.timer = null; }

  // 一覧を最初から（控えがあれば先に出してから読み直す）
  function start() {
    var cached = readCache();
    if (V.odaiOnly) { var t = today(); cached = cached.filter(function (x) { return x.odai === t; }); }
    V.items = cached; V.more = false; V.fromCache = cached.length > 0; V.failed = '';
    V.loading = true;
    V.toggle.setAttribute('aria-pressed', String(V.odaiOnly));
    paintList();
    load(false);
  }

  function render(container) {
    V.root = container;
    container.innerHTML = '';
    stopAuto();
    V.seq++;
    var head = el('div', { class: 'view-head' }, [
      el('h1', { class: 'view-title', text: 'みんなの和歌' }),
      el('p', { class: 'lead', text: api() ? 'みんなが詠んだ和歌が新しい順に並びます。「できた！」の画面から投稿できます。' : '' })
    ]);
    if (!api()) {
      V.list = null;
      container.appendChild(el('section', { class: 'view view-minna' }, [
        head,
        el('div', { class: 'notice mn-soon' }, [
          el('p', { class: 'mn-soon-title', text: '準備中です' }),
          el('p', { class: 'muted', text: 'みんなの和歌はただいま準備中です。公開までもう少しお待ちください。' }),
          el('a', { class: 'btn btn-primary', href: '#/easy', text: '一首詠んでみる' })
        ])
      ]));
      return;
    }
    if (/^#\/minna\/odai\b/.test(location.hash || '')) V.odaiOnly = true;

    V.toggle = el('button', { type: 'button', class: 'btn mn-toggle', 'aria-pressed': String(V.odaiOnly) }, [
      el('span', { class: 'mn-toggle-box', 'aria-hidden': 'true' }), '今日のお題だけ（' + md(today()) + '）'
    ]);
    V.toggle.addEventListener('click', function () { V.odaiOnly = !V.odaiOnly; start(); });
    V.refreshBtn = el('button', { type: 'button', class: 'btn mn-refresh', text: '更新' });
    V.refreshBtn.addEventListener('click', function () { load(false); });
    V.status = el('div', { class: 'mn-status', role: 'status', 'aria-live': 'polite' });
    V.list = el('div', { class: 'mn-list', 'aria-label': 'みんなの和歌の一覧' });
    V.moreBox = el('div', { class: 'mn-more-box' });

    container.appendChild(el('section', { class: 'view view-minna' }, [
      head,
      el('div', { class: 'mn-toolbar' }, [V.toggle, V.refreshBtn]),
      V.status,
      V.list,
      V.moreBox
    ]));
    start();
    startAuto();
  }

  function leave() { stopAuto(); V.seq++; }

  W.views = W.views || {};
  W.views.minna = { title: 'みんなの和歌', render: render, leave: leave };
})();
