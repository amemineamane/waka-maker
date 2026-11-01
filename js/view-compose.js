/* =====================================================================
 * js/view-compose.js — じっくりモード（#/compose。旧 手作り）
 * ---------------------------------------------------------------------
 * 5 つの句を入れると、読みを推定して音数を数え、枡（●）で見せる。
 *   - 読みは手で直せる。手で直した句は本文を変えるまで自動推定しない（manual）。
 *   - 入力途中は waka.draft に自動保存。editingId があれば作品帳へ上書き保存。
 *   - 「歌ことば」パネル：季節タブ＋検索。語をタップで選んでいる句の末尾へ。
 *   - 「お手本を見る」：samples から 1 首。「この形をなぞる」で入力欄へ。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;
  var TARGET = [5, 7, 5, 7, 7];
  var NUM = ['①', '②', '③', '④', '⑤'];
  var PLACEHOLDER = ['春の夜の', '夢ばかりなる', '手枕に', 'かひなく立たむ', '名こそ惜しけれ'];
  var TABS = ['春', '夏', '秋', '冬', '恋', '雑', '枕詞'];

  var draft, active = 0, rows = [];
  var saveTimer = null, kotobaTab = '春', kotobaQuery = '';
  var root, bannerBox, targetLabel;

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { W.store.draft.save(draft); }, 300);
  }

  /* ---------- 1 句ぶんの行（components.js の ui.kuRow） ---------- */
  function buildRow(i) {
    var r = ui.kuRow({
      no: NUM[i], index: i, target: TARGET[i], label: NUM[i] + ' 第' + (i + 1) + '句',
      text: draft.ku[i], kana: draft.kana[i], manual: draft.manual[i], placeholder: PLACEHOLDER[i],
      onFocus: function () { setActive(i); },
      onChange: function (s) {
        draft.ku[i] = s.text; draft.kana[i] = s.kana; draft.manual[i] = s.manual;
        saveSoon();
      }
    });
    rows[i] = r;
    return r.row;
  }

  function setActive(i) {
    active = i;
    rows.forEach(function (r, k) { r.row.classList.toggle('active', k === i); });
    if (targetLabel) targetLabel.textContent = NUM[i];
  }

  /* ---------- 歌ことばパネル ---------- */
  function insertWord(word, kana) {
    var i = active;
    draft.ku[i] += word;
    draft.kana[i] += kana;
    draft.manual[i] = true;   // 辞書の読みを優先する
    rows[i].set(draft.ku[i], draft.kana[i], true);
    saveSoon();
    ui.toast(NUM[i] + ' に「' + word + '」を入れました');
  }

  function kotobaItems() {
    var q = kotobaQuery.trim();
    var words = W.words || [], makura = W.makura || [];
    function hit(x) {
      return [x.word, x.kana, x.meaning, (x.leads || []).join('')].some(function (s) { return s && String(s).indexOf(q) >= 0; });
    }
    if (q) {
      return makura.filter(hit).map(function (m) { return { m: m }; })
        .concat(words.filter(hit).map(function (w) { return { w: w }; })).slice(0, 80);
    }
    if (kotobaTab === '枕詞') return makura.map(function (m) { return { m: m }; });
    return words.filter(function (w) { return w.season === kotobaTab; }).map(function (w) { return { w: w }; });
  }

  function kotobaList(box) {
    box.innerHTML = '';
    var items = kotobaItems();
    if (!items.length) {
      box.appendChild(el('p', { class: 'muted pad', text: kotobaQuery ? '見つかりませんでした。' : 'この分類の語はまだありません。' }));
      return;
    }
    items.forEach(function (it) {
      var x = it.w || it.m;
      var mora = x.mora != null ? x.mora : W.mora.count(x.kana);
      var head = it.m
        ? [el('span', { class: 'kw', text: x.word }), el('span', { class: 'kl', text: '→ ' + (x.leads || []).join('・') })]
        : [el('span', { class: 'kw', text: x.word }), x.kind ? el('span', { class: 'tag', text: x.kind }) : null];
      var btn = el('button', { type: 'button', class: 'kotoba-item' }, [
        el('span', { class: 'k-head' }, head),
        el('span', { class: 'k-kana', text: x.kana + '・' + mora + '音' }),
        el('span', { class: 'k-mean', text: x.meaning || '' })
      ]);
      btn.addEventListener('click', function () { insertWord(x.word, x.kana); });
      box.appendChild(btn);
    });
  }

  function kotobaPanel() {
    var list = el('div', { class: 'kotoba-list' });
    var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': '歌ことばの分類' });
    TABS.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(t === kotobaTab), text: t });
      b.addEventListener('click', function () {
        kotobaTab = t;
        kotobaQuery = ''; search.value = ''; clearTimeout(searchTimer);
        [].forEach.call(tabs.children, function (c) { c.setAttribute('aria-selected', String(c === b)); });
        kotobaList(list);
      });
      tabs.appendChild(b);
    });
    var search = el('input', { type: 'search', class: 'kotoba-search', placeholder: '語・読み・意味でさがす', 'aria-label': '歌ことばを検索' });
    // 検索は打ち終わりを待って描き直す（1 文字ごとに一覧を作り直さない）
    var searchTimer = null;
    search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { kotobaQuery = search.value; kotobaList(list); }, 150);
    });
    targetLabel = el('strong', { text: NUM[active] });
    // 一覧は初めて開いたときに作る（閉じたままなら作らない）
    var built = false;
    var details = el('details', { class: 'panel kotoba' }, [
      el('summary', { class: 'panel-summary' }, [el('span', { text: '歌ことば' }), el('span', { class: 'muted small', text: '季語・歌語・枕詞から選んで入れる' })]),
      el('div', { class: 'panel-body' }, [
        tabs, search,
        el('p', { class: 'small muted' }, ['タップすると ', targetLabel, ' の句の末尾に入ります（入れる句は、句の欄をタップして選びます）']),
        list
      ])
    ]);
    details.addEventListener('toggle', function () {
      if (details.open && !built) { built = true; kotobaList(list); }
    });
    return details;
  }

  /* ---------- お手本 ---------- */
  function showSample(prevIndex) {
    var list = W.samples || [];
    if (!list.length) { ui.toast('お手本のデータがありません', 'error'); return; }
    var idx = Math.floor(Math.random() * list.length);
    if (list.length > 1 && idx === prevIndex) idx = (idx + 1) % list.length;
    var s = list[idx];
    var poem = el('div', { class: 'sample-poem' }, s.ku.map(function (k, i) {
      return el('p', { class: 'sample-ku' }, [el('span', { class: 'sk', text: k }), el('span', { class: 'sr', text: s.kana[i] })]);
    }));
    var h;
    var trace = ui.twoStep('この形をなぞる', '入力中の句を置きかえます。もう一度押す', function () {
      draft.ku = s.ku.slice(); draft.kana = s.kana.slice();
      draft.manual = [true, true, true, true, true];
      draft.editingId = null;   // お手本で置きかえた歌は作品帳の歌とは別（上書きしない）
      draft.meaning = '';
      W.store.draft.save(draft);
      h.close();
      render(root);
      ui.toast('お手本を入れました。言葉を少しずつ自分のものに変えてみましょう');
    }, { class: 'btn btn-primary', skipIf: function () { return W.store.draft.isEmpty(draft); } });
    var other = el('button', { type: 'button', class: 'btn', text: 'ほかの歌' });
    other.addEventListener('click', function () { h.close(); showSample(idx); });
    h = ui.modal('お手本', [
      poem,
      el('p', { class: 'sample-author', text: '— ' + (s.author || '詠み人知らず') + (s.source ? '（' + s.source + '）' : '') }),
      s.meaning ? el('p', { class: 'sample-mean', text: s.meaning }) : null,
      el('div', { class: 'btn-row' }, [trace, other])
    ]);
  }

  /* ---------- 編集中の表示 ---------- */
  function renderBanner() {
    bannerBox.innerHTML = '';
    if (!draft.editingId) return;
    var leave = el('button', { type: 'button', class: 'link-btn', text: '新しい歌として保存する' });
    leave.addEventListener('click', function () {
      draft.editingId = null; W.store.draft.save(draft); renderBanner();
      ui.toast('作品帳の歌とは別の、新しい歌として扱います');
    });
    bannerBox.appendChild(el('div', { class: 'banner' }, [
      el('span', { text: '作品帳の歌を直しています。「できた！」から上書き保存できます。' }), leave
    ]));
  }

  /* ---------- 画面 ---------- */
  function render(container) {
    root = container;
    draft = W.store.draft.load();
    // 読み推定（kuromoji）をアイドル時に先読みしておく（DESIGN 12-8）
    if (W.reading.preloadIdle) W.reading.preloadIdle();
    rows.forEach(function (r) { r.stop(); });
    rows = [];
    container.innerHTML = '';

    bannerBox = el('div');
    var upper = el('div', { class: 'ku-group' }, [el('h2', { class: 'ku-group-title', text: '上の句' })]);
    var lower = el('div', { class: 'ku-group' }, [el('h2', { class: 'ku-group-title', text: '下の句' })]);
    for (var i = 0; i < 5; i++) (i < 3 ? upper : lower).appendChild(buildRow(i));

    var author = el('input', { type: 'text', class: 'author-input', value: draft.author || '', placeholder: '雅号（なくてもよい）', maxlength: '20', 'aria-label': '雅号（作者名）' });
    author.addEventListener('input', function () {
      draft.author = author.value; saveSoon();
      W.store.prefs.set({ author: author.value });
    });

    var done = el('button', { type: 'button', class: 'btn btn-primary btn-big', text: 'できた！' });
    done.addEventListener('click', function () {
      if (W.store.draft.isEmpty(draft)) { ui.toast('句を入れてから押してください'); return; }
      W.store.draft.save(draft);
      // 意味・ひとことは自動の大意が無いので空から（作品帳の編集・かんたんから来たときはその値）
      ui.finish({ ku: draft.ku.slice(), kana: draft.kana.slice(), author: draft.author, meaning: draft.meaning || '' }, {
        mode: 'new', editingId: draft.editingId,
        onMeaning: function (v) { draft.meaning = v; saveSoon(); },
        onSaved: function (item) { draft.editingId = item.id; draft.meaning = item.meaning; W.store.draft.save(draft); renderBanner(); }
      });
    });
    var sample = el('button', { type: 'button', class: 'btn', text: 'お手本を見る' });
    sample.addEventListener('click', function () { showSample(-1); });
    var clear = ui.twoStep('白紙にする', 'もう一度押すと白紙に', function () {
      var a = draft.author;
      W.store.draft.clear();
      draft = W.store.draft.empty(); draft.author = a;
      W.store.draft.save(draft);
      render(root);
      ui.toast('白紙にしました');
    }, { class: 'btn btn-ghost' });

    container.appendChild(el('section', { class: 'view view-compose' }, [
      el('div', { class: 'view-head' }, [
        el('h1', { class: 'view-title', text: 'じっくり詠む' }),
        el('p', { class: 'lead', text: '五・七・五・七・七の句を入れてください。読みと音数は自動で数えます。' })
      ]),
      bannerBox,
      el('div', { class: 'ku-list' }, [upper, lower]),
      el('label', { class: 'author-row' }, [el('span', { class: 'author-label', text: '雅号' }), author]),
      el('div', { class: 'compose-actions' }, [done, el('div', { class: 'btn-row' }, [sample, clear])]),
      kotobaPanel()
    ]));
    renderBanner();
    setActive(0);

    // 漢字入りの句で読みが空なら推定し直す（mix から来た時・前回推定に失敗した時）
    for (var k = 0; k < 5; k++) if (draft.ku[k].trim() && !draft.kana[k].trim() && !draft.manual[k]) rows[k].estimate();
  }

  function leave() {
    clearTimeout(saveTimer);
    if (draft) W.store.draft.save(draft);
  }

  W.views = W.views || {};
  W.views.compose = { title: 'じっくり', render: render, leave: leave };
})();
