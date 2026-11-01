/* =====================================================================
 * js/components.js — 画面をまたいで使う部品
 * ---------------------------------------------------------------------
 *   ui.el(tag, attrs, children)   DOM を組み立てる小さなヘルパー
 *   ui.icon(name)                 inline SVG のアイコン
 *   ui.toast(msg, kind)           画面下に数秒だけ出る通知（kind: ok / error）
 *   ui.twoStep(label, confirmLabel, onConfirm, opts)
 *                                 2 段階ボタン（1 回目で確認表示、もう一度で実行）
 *   ui.modal(title, body, opts)   モーダル。{ close } を返す
 *   ui.moraMeter(count, target)   音数の枡（●）と判定ラベル
 *   ui.kuRow(opts)                1 句の入力行（本文・読み・枡）。手作り・かんたんで共用
 *   ui.finish(poem, opts)         完成画面（プレビュー直下に 画像を保存・X で共有、その下にコピー・作品帳・意味・画像設定）
 *   ui.poemLine(poem)             5 句を全角スペースで 1 行に
 *   ui.tatePoem(ku, cls)          CSS 縦書きの一首（かんたんの候補・仕上げ、みんなの和歌の一覧で共用）
 * 画像と共有は WAKA.render / WAKA.share（別担当）を呼ぶ。無ければボタンを無効化する。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = {};

  /* ---------- DOM ヘルパー ---------- */
  ui.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    [].concat(children == null ? [] : children).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  };
  var el = ui.el;

  /* ---------- アイコン（inline SVG、線画） ---------- */
  var ICONS = {
    prev: '<path d="M15 5l-7 7 7 7"/>',
    next: '<path d="M9 5l7 7-7 7"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    brush: '<path d="M4 20c3 0 5-1 6-4l8-11-2-1-10 9c-2 2-1 5-2 7z"/>',
    shuffle: '<path d="M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M4 17h3c1.5 0 2.5-1 3.5-2.5M13.5 9.5C14.5 8 15.5 7 17 7h3M17 4l3 3-3 3"/>',
    book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><circle cx="12" cy="17" r=".8" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  ui.icon = function (name) {
    var span = el('span', { class: 'icon', 'aria-hidden': 'true' });
    span.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  };

  /* ---------- トースト ---------- */
  var toastTimer = null;
  ui.toast = function (msg, kind) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = msg;
    box.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 2800);
  };

  /* ---------- 2 段階ボタン ---------- */
  // opts.skipIf(): true を返せば確認なしで実行（例: 下書きが空）
  ui.twoStep = function (label, confirmLabel, onConfirm, opts) {
    opts = opts || {};
    var armed = false, timer = null;
    var btn = el('button', { type: 'button', class: opts.class || 'btn' }, label);
    function reset() { armed = false; btn.textContent = label; btn.classList.remove('armed'); }
    btn.addEventListener('click', function () {
      if (!armed && opts.skipIf && opts.skipIf()) { onConfirm(); return; }
      if (!armed) {
        armed = true;
        btn.textContent = confirmLabel;
        btn.classList.add('armed');
        clearTimeout(timer);
        timer = setTimeout(reset, 4000);
        return;
      }
      clearTimeout(timer);
      reset();
      onConfirm();
    });
    return btn;
  };

  /* ---------- モーダル ---------- */
  // role=dialog・aria-modal。Tab / Shift+Tab はモーダルの中だけを回る（フォーカストラップ）。Esc で閉じる
  var modalSeq = 0;
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  ui.modal = function (title, body, opts) {
    opts = opts || {};
    var prevFocus = document.activeElement;
    var titleId = 'modal-title-' + (++modalSeq);
    var closeBtn = el('button', { type: 'button', class: 'btn-icon modal-close', 'aria-label': '閉じる' }, ui.icon('close'));
    var panel = el('div', { class: 'modal-panel' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, [
      el('div', { class: 'modal-head' }, [el('h2', { class: 'modal-title', id: titleId, text: title }), closeBtn]),
      el('div', { class: 'modal-body' }, body)
    ]);
    var overlay = el('div', { class: 'modal' }, panel);
    function close() {
      if (!overlay.parentNode) return;
      overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', close);
      if (!document.querySelector('.modal')) document.body.classList.remove('modal-open');
      if (opts.onClose) opts.onClose();
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    function onKey(e) {
      // いちばん上のモーダルだけが受ける
      var all = document.querySelectorAll('.modal');
      if (all[all.length - 1] !== overlay) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var list = [].filter.call(panel.querySelectorAll(FOCUSABLE), function (n) { return n.getClientRects().length > 0; });
      if (!list.length) { e.preventDefault(); return; }
      var first = list[0], last = list[list.length - 1], a = document.activeElement;
      if (!panel.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && (a === first || a === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', close);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');
    try { closeBtn.focus({ preventScroll: true }); } catch (e) {}
    return { close: close, panel: panel };
  };

  /* ---------- タブ・ラジオの矢印キー ---------- */
  // role=tablist の role=tab、role=radiogroup の role=radio で ←→（↑↓）・Home・End を使えるようにする。
  // 移った先にフォーカスして押す（タブは選ぶと中身が替わる、ラジオは選ぶ）
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var role = t.getAttribute('role');
    if (role !== 'tab' && role !== 'radio') return;
    var group = t.closest(role === 'tab' ? '[role="tablist"]' : '[role="radiogroup"]');
    if (!group) return;
    var items = [].filter.call(group.querySelectorAll('[role="' + role + '"]'), function (n) { return !n.disabled && n.getClientRects().length > 0; });
    var i = items.indexOf(t), n = items.length, j = -1;
    if (i < 0 || n < 2) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j < 0) return;
    e.preventDefault();
    var target = items[j];
    var label = target.textContent;
    target.focus();
    target.click();
    // クリックで描き直されたときは、同じ名前の新しい要素にフォーカスをもどす
    if (!document.contains(target)) {
      var again = [].filter.call(document.querySelectorAll('[role="' + role + '"]'), function (x) { return x.textContent === label; })[0];
      if (again) again.focus();
    }
  });

  /* ---------- 音数メーター ---------- */
  // 目標数ぶんの枡を描いて塗る。字余りは枡の外にはみ出させる。
  // opts.empty: 未入力（判定を出さず「5音」とだけ見せる）/ opts.pending: 推定中
  ui.moraMeter = function (count, target, opts) {
    opts = opts || {};
    var j = W.mora.judge(count, target);
    var dots = el('span', { class: 'dots', 'aria-hidden': 'true' });
    var known = !opts.empty && !isNaN(count);
    var filled = known ? Math.min(count, target) : 0;
    for (var i = 0; i < target; i++) dots.appendChild(el('i', { class: i < filled ? 'on' : null }));
    if (known && count > target) {
      for (var k = 0; k < Math.min(count - target, 4); k++) dots.appendChild(el('i', { class: 'on extra' }));
    }
    var label, cls;
    if (opts.empty) { label = target + '音'; cls = 'idle'; }
    else if (opts.pending || j.status === 'unknown') { label = '？'; cls = 'unknown'; }
    else if (j.status === 'ok') { label = 'よし'; cls = 'ok'; }
    else if (j.status === 'jiamari1') { label = '字余り (+1)'; cls = 'warn'; }
    else if (j.status === 'over') { label = '字余り (+' + j.diff + ')'; cls = 'bad'; }
    else { label = '字足らず (−' + (-j.diff) + ')'; cls = 'bad'; }
    var countText = known && !opts.pending ? count + '/' + target : '';
    return el('span', { class: 'meter ' + cls }, [
      dots,
      el('span', { class: 'meter-label' }, [countText ? el('span', { class: 'meter-count', text: countText }) : null, label])
    ]);
  };

  /* ---------- 1 句の入力行（本文・読み・枡） ---------- */
  // 本文を入れると読みを推定して読み欄に入れ、読みから音数を数えて枡に出す。
  // 読みを手で直した句（manual）は、本文を変えるまで自動推定で上書きしない。
  // o = { no:'①', index, target, text, kana, manual, placeholder, label, class,
  //       onChange(state), onFocus() }   state = {text, kana, manual, pending, failed}
  // 戻り値 { row, text, kana, meter, note, state, update(), estimate(), set(text, kana, manual), stop() }
  ui.kuRow = function (o) {
    o = o || {};
    var st = { text: o.text || '', kana: o.kana || '', manual: !!o.manual, pending: false, failed: false };
    var timer = null;
    var text = el('input', {
      type: 'text', class: 'ku-text', value: st.text, placeholder: o.placeholder || '',
      'aria-label': (o.label || o.no || '句') + '（' + o.target + '音）', autocomplete: 'off', maxlength: '40'
    });
    var kana = el('input', {
      type: 'text', class: 'ku-kana', value: st.kana, placeholder: 'よみ（ひらがな）',
      'aria-label': (o.no || '句') + ' の読み', autocomplete: 'off', maxlength: '60', lang: 'ja'
    });
    var meter = el('span', { class: 'ku-meter' });
    var note = el('p', { class: 'ku-note', 'aria-live': 'polite' });
    var row = el('div', { class: 'ku-row' + (o.class ? ' ' + o.class : ''), 'data-i': o.index != null ? String(o.index) : null }, [
      el('div', { class: 'ku-head' }, [o.no ? el('span', { class: 'ku-no', text: o.no }) : el('span'), meter]),
      el('div', { class: 'ku-fields' }, [
        text,
        el('label', { class: 'ku-reading' }, [el('span', { class: 'ku-reading-label', text: '読み' }), kana])
      ]),
      note
    ]);

    function changed() { if (o.onChange) o.onChange(st); }

    if (o.onFocus) {
      text.addEventListener('focus', o.onFocus);
      kana.addEventListener('focus', o.onFocus);
      row.addEventListener('click', o.onFocus);
    }
    text.addEventListener('input', function () {
      st.text = text.value;
      st.manual = false;   // 本文を変えたら自動推定に戻す
      changed();
      estimate();
    });
    kana.addEventListener('input', function () {
      st.kana = kana.value;
      st.manual = true;
      st.pending = false;
      clearTimeout(timer);
      changed();
      update();
    });

    // 読みを推定して読み欄に入れる（手で直した句は触らない）
    function estimate() {
      clearTimeout(timer);
      var src = st.text;
      if (!src.trim()) {
        st.kana = ''; st.pending = false; st.failed = false;
        kana.value = ''; update(); changed();
        return;
      }
      var kanaOnly = W.mora.isKanaOnly(src);
      st.pending = !kanaOnly;
      update();
      timer = setTimeout(function () {
        W.reading.estimate(src).then(function (r) {
          if (st.text !== src || st.manual) return;
          st.kana = r; st.pending = false; st.failed = false;
          kana.value = r;
          update(); changed();
        }, function () {
          if (st.text !== src || st.manual) return;
          // 推定できない：読み欄を空にして手入力を案内
          st.kana = ''; st.pending = false; st.failed = true;
          kana.value = '';
          update(); changed();
        });
      }, kanaOnly ? 0 : 350);
    }

    function update() {
      var k = st.kana;
      var empty = !st.text.trim() && !k.trim();
      var n = W.mora.count(k);
      meter.innerHTML = '';
      meter.appendChild(ui.moraMeter(empty ? 0 : (k.trim() ? n : NaN), o.target, { empty: empty, pending: st.pending }));
      var msg = '';
      if (st.pending && W.reading.state !== 'ready') msg = '読みを調べています…';
      else if (st.failed && !k.trim()) msg = '読みをひらがなで入れてください（自動の読み取りが使えません）';
      else if (k.trim() && isNaN(n)) msg = '読みに漢字などが残っています。ひらがなで直してください';
      note.textContent = msg;
      row.classList.toggle('has-note', !!msg);
    }

    update();
    return {
      row: row, text: text, kana: kana, meter: meter, note: note, state: st,
      update: update, estimate: estimate,
      stop: function () { clearTimeout(timer); },
      // 外から値を入れる（onChange は呼ばない）
      set: function (t, k, manual) {
        clearTimeout(timer);
        st.text = t || ''; st.kana = k || ''; st.manual = !!manual; st.pending = false; st.failed = false;
        text.value = st.text; kana.value = st.kana;
        update();
      }
    };
  };

  ui.poemLine = function (poem) {
    return poem.ku.map(function (s) { return String(s || '').trim(); }).filter(Boolean).join('　');
  };

  // CSS 縦書きの一首（散らし書き風。2・4 句目を少し下げる）。空の句は全角空白で場所だけ取る
  ui.tatePoem = function (ku, cls) {
    return el('div', { class: 'tate-poem' + (cls ? ' ' + cls : ''), lang: 'ja' }, ku.map(function (s, i) {
      return el('p', { class: 'tate-line l' + (i + 1), text: String(s || '').trim() || '　' });
    }));
  };

  /* ---------- 画像・共有 API（別担当）の窓口 ---------- */
  // 使う API（js/render.js・js/share.js、DESIGN 3.5/3.6）:
  //   render.draw(canvas, poem, opts) -> Promise / render.download(canvas) -> Promise<'download'|'tab'|'failed'>
  //   render.layouts / render.palettes = [{id, name}]
  //   share.openX(poem) / share.copyText(poem) -> Promise / share.canShareImage() / share.shareImage(canvas, poem) -> Promise<'shared'|'cancel'>
  function has(obj, name) { return !!obj && typeof obj[name] === 'function'; }

  // render.js が無いときの選択肢（ボタンは無効表示）
  var FALLBACK_LAYOUTS = [
    { id: 'tanzaku', name: '短冊' }, { id: 'shikishi', name: '色紙' }, { id: 'card', name: '横長' }
  ];
  var FALLBACK_PALETTES = [
    { id: 'washi', name: '和紙' }, { id: 'sumi', name: '墨' },
    { id: 'yozakura', name: '夜桜' }, { id: 'kincho', name: '金茶' }
  ];
  function choices(key, fallback) {
    var t = W.render && W.render[key];
    return Array.isArray(t) && t.length ? t : fallback;
  }

  var ODAI_TAG = '和歌メイカー_今日のお題';
  ui.ODAI_TAG = ODAI_TAG;

  /* ---------- 完成画面 ---------- */
  // poem = {ku, kana, author, meaning?, layout?, palette?, id?}
  // opts.mode = 'new'（手作り・組み合わせから）| 'gallery'（作品帳から）
  // opts.editingId: 上書き保存先 / opts.onSaved(item) / opts.onEdit() / opts.onDelete()
  // opts.onMeaning(text): 意味・ひとことを書きかえたとき / opts.onClose(): 閉じたとき
  // opts.odai: 今日のお題から作った歌（X 共有の下に「今日のお題として投稿」チェック、既定オン）
  // opts.odaiDate: そのお題の日付（'YYYY-MM-DD'。みんなの和歌への投稿の odai に使う。無ければ今日）
  // opts.readOnly: 閲覧モード（みんなの和歌の歌、DESIGN 14.2）。画像保存・X 共有・本文コピーと
  //   「自分の作品帳に写す」だけ。自動保存しない・意味は読むだけ・投稿ボタンは出さない。雅号と落款は poem.author（投稿者）
  // opts.onTrace(): 閲覧モードの「なぞる（じっくりで書く）」
  // みんなの和歌への投稿（W.minna が有効なときだけ、閲覧モード以外）: 主ボタンの下・「そのほかの操作」の上
  // 書体（waka.prefs.font）は「そのほかの操作」の中、落款（waka.prefs.seal、既定オン）は かたち・いろ の下
  // 意味・ひとこと（DESIGN 10.2）: 初期値は poem.meaning（かんたん・シャッフルは自動の大意、じっくりは空）。
  //   「画像に意味を入れる」（waka.prefs.meaningInImage、既定オフ）なら render に meaning を渡す（短冊は描かない）。
  //   本文コピーには付け、X の投稿文には入れない。作品帳の歌は書きかえるとその場で保存する。
  ui.finish = function (poem, opts) {
    opts = opts || {};
    var prefs = W.store.prefs.get();
    var state = { layout: poem.layout || prefs.layout, palette: poem.palette || prefs.palette, meaningInImage: !!prefs.meaningInImage,
      font: prefs.font || 'shippori', seal: prefs.seal !== false };
    var fontWarned = false;
    var savedId = opts.editingId || (opts.mode === 'gallery' ? poem.id : null);
    var R = W.render, Sh = W.share;
    var canDraw = has(R, 'draw');
    var drawing = null;   // 描画中の Promise（描き終わる前の保存を防ぐ）
    var canShareImg = canDraw && has(Sh, 'shareImage') && has(Sh, 'canShareImage') && Sh.canShareImage();
    var data = { ku: poem.ku.slice(), kana: poem.kana.slice(), author: poem.author || '', meaning: String(poem.meaning || '') };

    var preview = el('div', { class: 'finish-preview' });
    var canvas = el('canvas', { class: 'finish-canvas', 'aria-label': '和歌の画像プレビュー' });

    // render.js が無いときは CSS の縦書きで代わりに見せる
    function htmlPreview() {
      var box = el('div', { class: 'tate-preview' }, data.ku.map(function (s, i) {
        return el('p', { class: 'tate-ku k' + (i + 1), text: s });
      }));
      if (data.author) box.appendChild(el('p', { class: 'tate-author', text: data.author }));
      return box;
    }

    function redraw() {
      preview.setAttribute('data-layout', state.layout);
      if (!canDraw) return;
      canvas.__wakaBlob = null;
      try {
        var dopt = { layout: state.layout, palette: state.palette, scale: 1, font: state.font, seal: state.seal };
        if (state.meaningInImage && data.meaning.trim()) dopt.meaning = data.meaning.trim();
        var r = Promise.resolve(R.draw(canvas, data, dopt));
        drawing = r;
        r.then(function () {
          if (drawing !== r) return;
          drawing = null;
          // 選んだ書体を読み込めなかったとき（明朝・OS の明朝で描いた）
          var used = canvas.__wakaFont;
          if (used && used !== state.font && state.font !== 'shippori' && !fontWarned) {
            fontWarned = true;
            ui.toast('書体を読み込めなかったので、明朝で描きました');
          }
          // 画像つき共有は click 内で同期的に navigator.share を呼べるよう PNG を先に作っておく
          if (canShareImg && has(R, 'toBlob')) R.toBlob(canvas).then(function (b) { if (!drawing && b) canvas.__wakaBlob = b; });
        },
          function () { if (drawing === r) drawing = null; ui.toast('画像を描けませんでした', 'error'); });
      } catch (e) { drawing = null; ui.toast('画像を描けませんでした', 'error'); }
    }

    preview.appendChild(canDraw ? canvas : htmlPreview());

    function seg(list, key, label) {
      var wrap = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': label || null, 'data-key': key });
      list.forEach(function (it) {
        var b = el('button', { type: 'button', class: 'seg-btn', role: 'radio', 'aria-checked': String(state[key] === it.id), text: it.name, disabled: !canDraw });
        b.addEventListener('click', function () {
          state[key] = it.id;
          [].forEach.call(wrap.children, function (c) { c.setAttribute('aria-checked', String(c === b)); });
          var patch = {}; patch[key] = it.id;
          W.store.prefs.set(patch);
          paintMeanNote();
          redraw();
          // 作品帳の歌は見た目の変更も記録しておく
          if (opts.mode === 'gallery' && savedId && key !== 'font') W.store.gallery.save({ id: savedId, layout: state.layout, palette: state.palette });
        });
        wrap.appendChild(b);
      });
      return wrap;
    }

    var MISSING = 'は準備中です（画像・共有の部品が読み込まれていません）';

    // 別担当の関数を呼ぶ。例外・reject はトーストにする。onOk(結果) で成功時の案内
    function call(what, f, onOk) {
      try {
        Promise.resolve(f()).then(function (v) { if (onOk) onOk(v); },
          function (e) { if (!e || e.name !== 'AbortError') ui.toast(what + 'に失敗しました', 'error'); });
      } catch (e) { ui.toast(what + 'に失敗しました', 'error'); }
    }

    // 主ボタン（画像を保存・X で共有）はプレビューの直下、その他の操作は下にまとめる（DESIGN 11.1-8）
    var mainActions = el('div', { class: 'finish-main-actions' });
    var actions = el('div', { class: 'finish-actions' });
    function addBtn(label, onClick, cls, enabled, box) {
      var b = el('button', { type: 'button', class: 'btn ' + (cls || ''), text: label });
      if (enabled === false) {
        b.classList.add('is-disabled');
        b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', function () { ui.toast('「' + label + '」' + MISSING, 'error'); });
      } else b.addEventListener('click', onClick);
      (box || actions).appendChild(b);
      return b;
    }

    // 作品帳に保存（同じ歌は上書き。savedId が無くても本文・読み・雅号が同じ歌があればそれを上書き）
    var saveBtn = null;
    function persist() {
      var id = savedId;
      if (!id && has(W.store.gallery, 'findSame')) { var same = W.store.gallery.findSame(data); if (same) id = same.id; }
      var item = W.store.gallery.save({ id: id, ku: data.ku, kana: data.kana, author: data.author, meaning: data.meaning.trim(), layout: state.layout, palette: state.palette });
      if (!item) return null;
      var res = { item: item, was: !!id };
      savedId = item.id;
      if (saveBtn && !opts.readOnly) saveBtn.textContent = '作品帳に上書き保存';
      if (opts.onSaved) opts.onSaved(item);
      return res;
    }
    // 画像を保存・画像つき共有のあとに作品帳へ自動で入れる（新しく作った歌だけ）
    function autoSave() {
      if (opts.mode === 'gallery' || opts.readOnly) return '';
      var r = persist();
      return r && !r.was ? '。作品帳にも入れました' : '';
    }

    addBtn('画像を保存', function () {
      if (drawing) { ui.toast('画像を描いています。少し待ってからもう一度押してください'); return; }
      call('画像の保存', function () { return R.download(canvas); }, function (v) {
        if (v === 'failed') { ui.toast('画像を保存できませんでした', 'error'); return; }
        var more = autoSave();
        if (v === 'tab') ui.toast('開いた画像を長押しして保存してください' + more);
        else ui.toast('画像を保存しました' + more, 'ok');
      });
    }, 'btn-primary btn-main', canDraw && has(R, 'download'), mainActions);
    // 今日のお題（opts.odai）から作った歌は「今日のお題として投稿」（既定オン）でハッシュタグを足す（DESIGN 12-2）
    var odaiCheck = null, odaiRow = null;
    function shareOpts() { return odaiCheck && odaiCheck.checked ? { hashtags: [ODAI_TAG] } : undefined; }
    addBtn('X で共有', function () { call('X での共有', function () { return Sh.openX(data, shareOpts()); }); }, 'btn-main btn-outline', has(Sh, 'openX'), mainActions);
    if (opts.odai) {
      odaiCheck = el('input', { type: 'checkbox', class: 'odai-check', checked: true });
      odaiRow = el('label', { class: 'check-row odai-row' }, [odaiCheck, el('span', { text: '今日のお題として投稿（#' + ODAI_TAG + '）' })]);
    }
    if (canShareImg) {
      addBtn('画像つきで共有', function () {
        if (drawing) { ui.toast('画像を描いています。少し待ってからもう一度押してください'); return; }
        call('共有', function () { return Sh.shareImage(canvas, data, shareOpts()); }, function (v) {
          if (v === 'shared') { var more = autoSave(); if (more) ui.toast('作品帳にも入れました', 'ok'); }
        });
      });
    }
    addBtn('本文をコピー', function () {
      call('コピー', function () { return Sh.copyText(has(Sh, 'textWithMeaning') ? Sh.textWithMeaning(data) : data); }, function () { ui.toast('本文をコピーしました', 'ok'); });
    }, '', has(Sh, 'copyText'));

    var handle;
    if (opts.readOnly) {
      // みんなの和歌の歌を自分の作品帳へ（同じ本文・読み・雅号の歌があればそれを更新）
      saveBtn = addBtn('自分の作品帳に写す', function () {
        var r = persist();
        if (r) ui.toast(r.was ? '作品帳の同じ歌を更新しました' : '作品帳に写しました', 'ok');
      }, 'btn-save');
      if (opts.onTrace) addBtn('なぞる（じっくりで書く）', function () { handle.close(); opts.onTrace(); }, 'btn-ghost btn-trace');
    } else if (opts.mode === 'gallery') {
      addBtn('編集する', function () { handle.close(); if (opts.onEdit) opts.onEdit(); });
      actions.appendChild(ui.twoStep('削除', 'もう一度押すと削除', function () {
        handle.close(); if (opts.onDelete) opts.onDelete();
      }, { class: 'btn btn-danger' }));
    } else {
      saveBtn = addBtn(savedId ? '作品帳に上書き保存' : '作品帳に保存', function () {
        var r = persist();
        if (r) ui.toast(r.was ? '作品帳を更新しました' : '作品帳に保存しました', 'ok');
      }, 'btn-save');
      addBtn('続けて直す', function () { handle.close(); }, 'btn-ghost');
    }

    /* 書体（そのほかの操作の中。DESIGN 12-4） */
    var fontList = W.render && Array.isArray(W.render.fonts) && W.render.fonts.length ? W.render.fonts : null;
    var fontRow = fontList ? el('div', { class: 'opt-row font-row' }, [el('span', { class: 'opt-label', text: '書体' }), seg(fontList, 'font', '画像の書体')]) : null;

    /* 落款（雅号の下の朱の印。DESIGN 12-3） */
    var sealCheck = el('input', { type: 'checkbox', class: 'seal-check', checked: state.seal, disabled: !canDraw });
    var sealNote = el('span', { class: 'small muted seal-note' });
    function paintSealNote() { sealNote.textContent = state.seal && !String(data.author || '').trim() ? '（雅号が空のときは押しません）' : ''; }
    sealCheck.addEventListener('change', function () {
      state.seal = sealCheck.checked;
      W.store.prefs.set({ seal: state.seal });
      paintSealNote();
      redraw();
    });
    paintSealNote();
    var sealRow = el('label', { class: 'check-row seal-row' }, [sealCheck, el('span', { text: '落款（雅号の印）を押す' }), sealNote]);

    /* 意味・ひとこと */
    var meanTimer = null, saveMeanTimer = null;
    var meanInput = el('textarea', {
      class: 'meaning-input', rows: '2', maxlength: '200', placeholder: 'どんな歌か、ひとこと（なくてもよい）',
      'aria-label': '意味・ひとこと'
    });
    meanInput.value = data.meaning;
    if (opts.readOnly) { meanInput.readOnly = true; meanInput.placeholder = '（なし）'; }
    var meanNote = el('p', { class: 'meaning-note small muted' });
    function paintMeanNote() {
      meanNote.textContent = state.meaningInImage && state.layout === 'tanzaku' ? '短冊の画像には意味は入りません（色紙・横長で入ります）' : '';
    }
    meanInput.addEventListener('input', function () {
      data.meaning = meanInput.value;
      if (opts.onMeaning) opts.onMeaning(data.meaning);
      if (state.meaningInImage && state.layout !== 'tanzaku') { clearTimeout(meanTimer); meanTimer = setTimeout(redraw, 400); }
      if (opts.mode === 'gallery' && savedId) {
        clearTimeout(saveMeanTimer);
        saveMeanTimer = setTimeout(function () { saveMeanTimer = null; W.store.gallery.save({ id: savedId, meaning: data.meaning.trim() }); }, 400);
      }
    });
    var meanCheck = el('input', { type: 'checkbox', class: 'meaning-check', checked: state.meaningInImage, disabled: !canDraw });
    meanCheck.addEventListener('change', function () {
      state.meaningInImage = meanCheck.checked;
      W.store.prefs.set({ meaningInImage: state.meaningInImage });
      paintMeanNote();
      redraw();
    });
    var meanBox = el('div', { class: 'meaning-box' }, [
      el('label', { class: 'meaning-label' }, [el('span', { class: 'opt-label-text', text: '意味・ひとこと' }), meanInput]),
      el('label', { class: 'check-row' }, [meanCheck, el('span', { text: '画像に意味を入れる' })]),
      meanNote
    ]);
    paintMeanNote();

    /* みんなの和歌に投稿（DESIGN 14.2）。送信・確認・記録は W.minna（js/view-minna.js） */
    var M = W.minna;
    var minnaBox = null;
    if (!opts.readOnly && M && typeof M.enabled === 'function' && M.enabled()) {
      var sending = false;
      var postBtn = el('button', { type: 'button', class: 'btn minna-post' });
      var seeLink = el('a', { class: 'minna-see', href: '#/minna', text: 'みんなの和歌を見る' });
      var paintPost = function () {
        var posted = M.isPosted({ ku: data.ku, savedId: savedId });
        postBtn.disabled = sending || posted;
        postBtn.textContent = sending ? '投稿しています…' : posted ? '投稿済み' : 'みんなの和歌に投稿';
        seeLink.hidden = !posted;
      };
      var send = function () {
        var odai = '';
        if (opts.odai && (!odaiCheck || odaiCheck.checked)) odai = opts.odaiDate || (W.easyGen && W.easyGen.jstDate ? W.easyGen.jstDate() : '');
        sending = true; paintPost();
        M.post({ ku: data.ku, kana: data.kana, author: data.author, meaning: data.meaning.trim(), odai: odai, savedId: savedId }).then(function () {
          sending = false; paintPost();
          ui.toast('投稿しました', 'ok');
          try { seeLink.focus({ preventScroll: true }); } catch (e) {}
        }, function (err) {
          sending = false; paintPost();
          ui.toast(M.errorText(err, 'post'), 'error');
          try { postBtn.focus({ preventScroll: true }); } catch (e) {}
        });
      };
      postBtn.addEventListener('click', function () {
        if (sending) return;
        var problem = M.checkPoem(data);
        if (problem) { ui.toast(problem, 'error'); return; }
        if (W.store.prefs.get().minnaAgreed) send();
        else M.confirm(function () { W.store.prefs.set({ minnaAgreed: true }); send(); });
      });
      paintPost();
      minnaBox = el('div', { class: 'finish-minna' }, [postBtn, seeLink]);
    }

    var body = el('div', { class: 'finish' }, [
      preview,
      el('div', { class: 'finish-side' }, [
        canDraw ? null : el('p', { class: 'note center', text: '画像の部品が読み込まれていないため、簡易表示です。' }),
        mainActions,
        odaiRow,
        minnaBox,
        el('p', { class: 'finish-sub-title', text: 'そのほかの操作' }),
        actions,
        fontRow,
        el('div', { class: 'finish-opts' }, [
          el('div', { class: 'opt-row' }, [el('span', { class: 'opt-label', text: 'かたち' }), seg(choices('layouts', FALLBACK_LAYOUTS), 'layout', '画像のかたち')]),
          el('div', { class: 'opt-row' }, [el('span', { class: 'opt-label', text: 'いろ' }), seg(choices('palettes', FALLBACK_PALETTES), 'palette', '画像のいろ')]),
          sealRow
        ]),
        meanBox
      ])
    ]);
    handle = ui.modal(opts.title || 'できあがり', body, {
      wide: true,
      onClose: function () {
        clearTimeout(meanTimer);
        // 書きかけの意味を取りこぼさない
        if (saveMeanTimer) { clearTimeout(saveMeanTimer); W.store.gallery.save({ id: savedId, meaning: data.meaning.trim() }); }
        if (opts.onClose) opts.onClose();
      }
    });
    redraw();
    return handle;
  };

  W.ui = ui;
})();
