/* =====================================================================
 * js/view-mix.js — シャッフルモード（#/mix。旧 組み合わせ）
 * ---------------------------------------------------------------------
 * data/parts.js の句パーツを 5 つ並べて一首にする。
 *   - 各スロット：◁ ▷ で前後、サイコロでそのスロットだけシャッフル、鍵で固定。
 *   - テーマで候補を絞る（タグ無しの汎用パーツは常に含める）。
 *   - 句をタップすると候補一覧から選べる。
 *   - 「じっくりモードで仕上げる」→ waka.draft に書いて #/compose へ。
 *   - 句の下に「大意」（各パーツの m をつないだもの、DESIGN 10.2）。完成画面の意味の初期値にもなる。
 * 並びはこのページを開いている間だけ覚える（保存はしない）。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;
  var TARGET = [5, 7, 5, 7, 7];
  var NUM = ['①', '②', '③', '④', '⑤'];
  var THEMES = ['なんでも', '春', '夏', '秋', '冬', '恋', '旅'];

  // pick[i] = 選んでいるパーツ（オブジェクト）。locked[i] = 固定
  var st = { theme: 'なんでも', pick: [null, null, null, null, null], locked: [false, false, false, false, false] };
  var slotsBox, meanBox;

  function all(i) { return (W.parts && W.parts[i + 1]) || []; }

  function candidates(i) {
    var list = all(i);
    if (st.theme === 'なんでも') return list;
    return list.filter(function (p) { return !p.tags || !p.tags.length || p.tags.indexOf(st.theme) >= 0; });
  }

  function rand(list, avoid) {
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var p;
    do { p = list[Math.floor(Math.random() * list.length)]; } while (p === avoid);
    return p;
  }

  function shuffle(i) {
    if (st.locked[i]) return;
    st.pick[i] = rand(candidates(i), st.pick[i]);
  }

  function step(i, d) {
    var list = candidates(i);
    if (!list.length) return;
    var at = list.indexOf(st.pick[i]);
    st.pick[i] = list[(at + d + list.length) % list.length];
  }

  /* ---------- 1 スロット ---------- */
  function slot(i) {
    var p = st.pick[i];
    var n = p ? W.mora.count(p.kana) : NaN;
    function iconBtn(name, label, onClick, pressed) {
      var b = el('button', { type: 'button', class: 'btn-icon', 'aria-label': label, title: label, 'aria-pressed': pressed == null ? null : String(pressed) }, ui.icon(name));
      b.addEventListener('click', onClick);
      return b;
    }
    var main = el('button', { type: 'button', class: 'slot-main', 'aria-label': NUM[i] + ' の候補一覧を開く' }, [
      el('span', { class: 'slot-text', text: p ? p.text : '（パーツがありません）' }),
      el('span', { class: 'slot-kana', text: p ? p.kana : '' })
    ]);
    main.addEventListener('click', function () { chooser(i); });
    return el('div', { class: 'slot' + (st.locked[i] ? ' locked' : '') }, [
      el('div', { class: 'slot-head' }, [
        el('span', { class: 'ku-no', text: NUM[i] }),
        ui.moraMeter(n, TARGET[i], { empty: !p }),
        el('div', { class: 'slot-tools' }, [
          iconBtn('dice', 'この句だけシャッフル', function () {
            if (st.locked[i]) { ui.toast('固定中です。鍵を外すと変えられます'); return; }
            shuffle(i); draw();
          }),
          iconBtn(st.locked[i] ? 'lock' : 'unlock', st.locked[i] ? '固定を外す' : 'この句を固定', function () {
            st.locked[i] = !st.locked[i]; draw();
          }, st.locked[i])
        ])
      ]),
      el('div', { class: 'slot-body' }, [
        iconBtn('prev', '前のパーツ', function () { if (!st.locked[i]) { step(i, -1); draw(); } }),
        main,
        iconBtn('next', '次のパーツ', function () { if (!st.locked[i]) { step(i, 1); draw(); } })
      ])
    ]);
  }

  // 候補一覧から選ぶ
  function chooser(i) {
    var list = candidates(i);
    var h;
    var box = el('div', { class: 'choice-list' }, list.map(function (p) {
      var b = el('button', { type: 'button', class: 'choice' + (p === st.pick[i] ? ' current' : ''), 'aria-pressed': String(p === st.pick[i]) }, [
        el('span', { class: 'kw', text: p.text }),
        el('span', { class: 'k-kana', text: p.kana + '・' + W.mora.count(p.kana) + '音' }),
        p.m ? el('span', { class: 'k-mean', text: p.m }) : null
      ]);
      b.addEventListener('click', function () { st.pick[i] = p; h.close(); draw(); });
      return b;
    }));
    h = ui.modal(NUM[i] + ' を選ぶ（' + list.length + '）', [box]);
  }

  // 大意（m の無いパーツは「…」）
  function meaning() {
    var ms = st.pick.map(function (p) { return p ? p.m : ''; });
    if (W.easyGen && W.easyGen.joinMeaning) return W.easyGen.joinMeaning(ms);
    return '';
  }

  function draw() {
    slotsBox.innerHTML = '';
    for (var i = 0; i < 5; i++) slotsBox.appendChild(slot(i));
    var m = meaning();
    meanBox.innerHTML = '';
    meanBox.hidden = !m;
    if (m) {
      meanBox.appendChild(el('span', { class: 'mean-label', text: '大意' }));
      meanBox.appendChild(el('span', { class: 'mean-text', text: m }));
    }
  }

  function poem() {
    return {
      ku: st.pick.map(function (p) { return p ? p.text : ''; }),
      kana: st.pick.map(function (p) { return p ? p.kana : ''; }),
      author: W.store.prefs.get().author,
      meaning: meaning()
    };
  }

  /* ---------- 画面 ---------- */
  function render(container) {
    container.innerHTML = '';
    // 初回、またはテーマのデータが変わって選択が消えていたら埋める
    for (var i = 0; i < 5; i++) if (!st.pick[i] || all(i).indexOf(st.pick[i]) < 0) { st.locked[i] = false; shuffle(i); }

    var themes = el('div', { class: 'tabs theme-tabs', role: 'radiogroup', 'aria-label': 'テーマ' });
    THEMES.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'tab', role: 'radio', 'aria-checked': String(t === st.theme), text: t });
      b.addEventListener('click', function () {
        st.theme = t;
        [].forEach.call(themes.children, function (c) { c.setAttribute('aria-checked', String(c === b)); });
        // テーマに合わない句は入れかえる（固定した句はそのまま）
        for (var k = 0; k < 5; k++) if (candidates(k).indexOf(st.pick[k]) < 0) shuffle(k);
        draw();
      });
      themes.appendChild(b);
    });

    slotsBox = el('div', { class: 'slots' });
    meanBox = el('p', { class: 'poem-mean mix-mean', 'aria-live': 'polite' });

    var all5 = el('button', { type: 'button', class: 'btn btn-big btn-shuffle' }, [ui.icon('shuffle'), 'ぜんぶシャッフル']);
    all5.addEventListener('click', function () {
      for (var k = 0; k < 5; k++) shuffle(k);
      draw();
    });
    var done = el('button', { type: 'button', class: 'btn btn-primary btn-big', text: 'できた！' });
    done.addEventListener('click', function () { ui.finish(poem(), { mode: 'new' }); });
    var toCompose = ui.twoStep('じっくりモードで仕上げる', '書きかけの下書きを置きかえます。もう一度押す', function () {
      var p = poem();
      var d = W.store.draft.empty();
      d.ku = p.ku; d.kana = p.kana; d.manual = [true, true, true, true, true];
      d.author = W.store.draft.load().author || p.author;
      d.meaning = p.meaning;
      if (W.store.draft.save(d)) location.hash = '#/compose';
    }, { class: 'btn', skipIf: function () { return W.store.draft.isEmpty(); } });

    container.appendChild(el('section', { class: 'view view-mix' }, [
      el('div', { class: 'view-head' }, [
        el('h1', { class: 'view-title', text: 'シャッフルで詠む' }),
        el('p', { class: 'lead', text: '用意された句を組み合わせて一首に。気に入るまでシャッフルしてみましょう。' })
      ]),
      themes,
      slotsBox,
      meanBox,
      el('div', { class: 'mix-actions' }, [all5, done, toCompose])
    ]));
    draw();
  }

  W.views = W.views || {};
  W.views.mix = { title: 'シャッフル', render: render };
})();
