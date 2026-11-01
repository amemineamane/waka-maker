/* =====================================================================
 * js/view-easy.js — かんたんモード（#/easy、既定の画面。DESIGN 9）
 * ---------------------------------------------------------------------
 * 3 つの入り口から「候補 3 首 → 仕上げ → できた！」に合流する。
 *   1. 質問に答える … 1 画面 1 問のステップ（いつ？ → 何を見た？ → どんな気持ち？ → どんなことばで？、
 *                     DESIGN 11.1・13.1）。季節・題材・ことばは選ぶと自動で次へ（ことばの次は生成）。
 *                     上の進捗をタップすると選び直せる。題材はグループ折りたたみ＋検索。
 *   2. 穴埋め       … 型をえらび、空欄を候補か自分の言葉でうめる（候補 3 首は飛ばす）
 *   3. 現代語で一言 … kuromoji の基本形を WAKA.easy.synonyms で題材・気持ちに写す
 *                     （使えなければ文字列の部分一致。長い語から）
 * 仕上げ：句をタップ →「ほかの言い方」（同じ役割・同じ条件の句）／
 *         「自分の言葉で書く」（components.js の ui.kuRow。読み推定と音数判定）。
 * 入り口の既定は「質問に答える」。穴埋め・現代語は「ほかの作り方」のリンクから。
 * 候補 3 首はスマホでは横スワイプ（CSS scroll-snap）。各画面の主ボタンは下の .cta-bar（スマホは sticky）。
 * 初回だけ「はじめての案内」を出す（waka.prefs.introSeen）。
 * 質問の 1/4 の先頭に「今日のお題」（日本時間の日付でシードした 題材 × 気持ち。easyGen.todayTheme）。
 *   タップで Q1〜Q3 を埋めて候補へ（ことばは st.words のまま）。そこから作った歌は完成画面で「今日のお題として投稿」を選べる（st.odai）。
 * 「自分の言葉で書く」「ふだんの言葉から」を開いたら kuromoji をアイドル時に先読みする（reading.preloadIdle）。
 * ことば（DESIGN 13.1）: 'classic'（古風、既定）| 'modern'（現代のことばも混ぜる）。easyGen.make / alternatives の words。
 *   候補画面の 2 択（古風 / 現代も）で切り替えると同じ条件で作り直す。
 * ホーム（DESIGN 13.4）: W.views.easy.home() で質問の 1/4 へ（選択・候補・作りかけは残す）。
 *   ヘッダーのロゴ・かんたんタブの再タップから app.js が呼ぶ。1/4 に cands か work が残っていれば「つづきから」カード。
 * 選択条件と作りかけは waka.easy に保存し、再訪時に復元する。
 *   waka.easy = { v, entry, step: 1|2|3|4, season, subject, mood, words, free, freeHit, fillId, fill,
 *                 stage: 'input'|'cands'|'finish', cands, odai, work }
 *   odai = 候補を今日のお題から作ったときの日付（'YYYY-MM-DD'）。work.odai に引き継ぐ
 *   cands[].words = その候補を作ったときのことば
 *   work = { source: 'gen'|'fill', subject, mood, season, words, templateId, fillId, savedId, meaningOwn?,
 *            lines: [{text, kana, manual, m?, slot?, key?, fill?, choice?, own?}] }
 * 大意（DESIGN 10.2）: 句の意味 m を「、」でつなぐ（WAKA.easyGen.joinMeaning）。
 *   生成した句は phrase.m、穴埋めは型の ku.m の【】に選んだ語の意味を差し込む。
 *   「自分の言葉で書く」で書いた句は m を空にして「…」。候補カード・仕上げのプレビュー下に出し、
 *   完成画面の「意味・ひとこと」の初期値にする。完成画面で書きかえた文は meaningOwn に覚え、
 *   その後に句を替えて大意が変わったら自動の大意にもどす。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;
  var TARGET = [5, 7, 5, 7, 7];
  var NUM = ['①', '②', '③', '④', '⑤'];
  var SEASONS = ['春', '夏', '秋', '冬'];
  var KEY = 'waka.easy';
  var BLANK = '【　】';
  var ENTRIES = [
    { id: 'ask', label: '質問に答える' },
    { id: 'fill', label: '穴埋め' },
    { id: 'free', label: 'ふだんの言葉から' }
  ];
  var STEP_NAMES = ['いつ', '題材', '気持ち', 'ことば'];
  var STEPS = 4;
  // 質問 4「ことば」（DESIGN 13.1）。short はステッパー・候補画面の切替の表示名
  var WORDS = [
    { id: 'classic', label: '古風なことばで', short: '古風', desc: '「かをり」「けり」など、むかしの和歌のことば' },
    { id: 'modern', label: '現代のことばも混ぜて', short: '現代も', desc: 'ふだんの言いまわしの句も入ります。読みは現代かなづかい' }
  ];
  // 題材のグループの並び（データに無いグループは後ろに足す）
  var GROUP_ORDER = ['花・草木', '空・天気', '月・星', '水・山', '生きもの', '人・暮らし'];
  // 題材の名前と読みが合わないものは、穴埋めでは歌の言葉に置きかえる
  var SUBJECT_WORD = { mushi: '虫', akatsuki: '暁', fumi: '文' };
  var WORD_TABS = ['すべて', '春', '夏', '秋', '冬', '恋', '雑'];
  var LEAD = {
    input: 'いくつかえらぶだけで一首できます。',
    fill: '型の空欄に言葉を入れて一首にします。',
    free: 'ふだんの言葉から、歌の材料を探します。',
    cands: '気に入った一首をえらんでください。あとで句ごとに直せます。',
    finish: '句をタップすると、ほかの言い方に替えたり、自分の言葉で書いたりできます。'
  };

  var st, root, saveTimer;
  var token = 0;                // 画面を描き直すたびに増やす（非同期の結果が古い画面に書かないように）
  var openGroups = null, subjQuery = '', candIndex = 0, ctaNode = null;
  var openLine = -1, lineTab = 'alt', openBlank = -1, wordsTab = 'すべて';
  var freeBusy = false, askMsg = '';
  var ownRow = null;            // 開いている「自分の言葉で書く」の行（タイマー停止用）
  var previewBox = null, linesBox = null, fillBox = null;

  /* ---------- データ ---------- */
  function E() {
    return W.easy || { subjects: [], moods: [], phrases: [], templates: [], fillTemplates: [], synonyms: {} };
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function subjectById(id) { return id ? byId(E().subjects, id) : null; }
  function moodById(id) { return id ? byId(E().moods, id) : null; }
  function fillTplById(id) { return id ? byId(E().fillTemplates || [], id) : null; }
  function genSeason() { return SEASONS.indexOf(st.season) >= 0 ? st.season : null; }
  function count(kana) { return W.mora.count(kana); }
  function normWords(w) { return w === 'modern' ? 'modern' : 'classic'; }
  function wordsShort(w) { return byId(WORDS, normWords(w)).short; }
  // 候補を作ったときのことば（古い候補は classic）
  function candsWords() { return normWords(st.cands && st.cands[0] && st.cands[0].words); }

  /* ---------- 大意 ---------- */
  var mIndex = null, mIndexSrc = null;
  // 句の本文と読みから phrase.m を引く（古い保存データ・候補の復元用）
  function mOf(text, kana) {
    var ph = E().phrases || [];
    if (mIndexSrc !== ph) {
      mIndex = {}; mIndexSrc = ph;
      ph.forEach(function (p) { var k = p.text + '|' + p.kana; if (!(k in mIndex)) mIndex[k] = p.m || ''; });
    }
    return mIndex[text + '|' + kana] || '';
  }
  function joinM(ms) { return W.easyGen && W.easyGen.joinMeaning ? W.easyGen.joinMeaning(ms) : ''; }
  // 辞書の意味（「。」までの 1 文、末尾の句読点なし）を句の意味の断片に
  function shortM(s) { return String(s || '').split('。')[0].trim().replace(/[、，,\s]+$/, ''); }
  function candMeaning(p) {
    if (typeof p.meaning === 'string' && p.meaning) return p.meaning;
    return joinM(p.ku.map(function (t, k) { return mOf(t, p.kana[k]); }));
  }
  // 穴埋めの句の意味: 型の m の【】に、選んだ語の意味（無ければ語そのもの）を入れる
  function fillM(k, choice) {
    var m = String((k && k.m) || '');
    if (!m) return '';
    if (!k.blank) return m;
    var w = '';
    if (choice) w = choice.own ? choice.text : (shortM(choice.m) || choiceM(k.blank, choice.text) || choice.text);
    return m.replace('【】', w || '…');
  }
  function choiceM(b, text) {
    var hit = blankCandidates(b).filter(function (c) { return c.text === text; })[0];
    return hit ? shortM(hit.m) : '';
  }
  function lineM(i) {
    var w = st.work, ln = w.lines[i];
    if (ln.own) return '';
    if (w.source === 'fill') {
      var tpl = fillTplById(w.fillId);
      var k = tpl && tpl.ku[i];
      return k ? fillM(k, ln.choice) : '';
    }
    return typeof ln.m === 'string' && ln.m ? ln.m : mOf(ln.text, ln.kana);
  }
  function workMeaning() { return joinM([0, 1, 2, 3, 4].map(lineM)); }
  // 完成画面に渡す意味（自分で書きかえた文は、大意が変わっていなければそちら）
  function finishMeaning() {
    var auto = workMeaning(), own = st.work.meaningOwn;
    return own && own.auto === auto ? own.text : auto;
  }
  function meanEl(text, cls) {
    if (!text) return null;
    return el('p', { class: 'poem-mean' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'mean-label', text: '大意' }), el('span', { class: 'mean-text', text: text })
    ]);
  }
  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- 保存 ---------- */
  function fresh() {
    return { v: 1, entry: 'ask', step: 1, season: null, subject: null, mood: null, words: 'classic', free: '', freeHit: null,
      fillId: null, fill: {}, stage: 'input', cands: null, odai: null, work: null };
  }
  function validWork(w) {
    return !!w && Array.isArray(w.lines) && w.lines.length === 5 &&
      w.lines.every(function (l) { return l && typeof l.text === 'string' && typeof l.kana === 'string'; });
  }
  function load() {
    var d = null, s = fresh();
    d = W.store.raw ? W.store.raw.get(KEY, null) : null;
    if (d && typeof d === 'object') Object.keys(s).forEach(function (k) { if (d[k] !== undefined) s[k] = d[k]; });
    if (!byId(ENTRIES, s.entry)) s.entry = 'ask';
    if ([1, 2, 3, 4].indexOf(s.step) < 0) s.step = 1;
    s.words = normWords(s.words);
    if (s.season !== 'any' && SEASONS.indexOf(s.season) < 0) s.season = null;
    if (!subjectById(s.subject)) s.subject = null;
    if (!moodById(s.mood)) s.mood = null;
    if (!s.fill || typeof s.fill !== 'object') s.fill = {};
    if (!fillTplById(s.fillId)) { s.fillId = null; s.fill = {}; }
    if (!Array.isArray(s.cands) || !s.cands.length || !s.cands.every(function (p) { return p && Array.isArray(p.ku) && p.ku.length === 5; })) s.cands = null;
    if (!validWork(s.work)) s.work = null;
    else s.work.words = normWords(s.work.words);   // 古い保存データ（words なし）は classic
    if (typeof s.odai !== 'string') s.odai = null;
    if (s.stage === 'cands' && !s.cands) s.stage = 'input';
    if (s.stage === 'finish' && !s.work) s.stage = 'input';
    if (['input', 'cands', 'finish'].indexOf(s.stage) < 0) s.stage = 'input';
    return s;
  }
  function save() {
    clearTimeout(saveTimer);
    if (W.store.raw) W.store.raw.set(KEY, st);   // 保存できなくても画面は続ける
  }
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); }

  /* ---------- 共通の部品 ---------- */
  function button(label, onClick, cls, attrs) {
    var a = { type: 'button', class: cls || 'btn' };
    if (attrs) Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
    var b = el('button', a, label);
    b.addEventListener('click', onClick);
    return b;
  }

  // CSS 縦書きの一首（候補カード・仕上げのプレビュー）。みんなの和歌と共用の ui.tatePoem
  function tatePoem(ku, cls) { return ui.tatePoem(ku, cls); }

  function condText(subject, mood, season, words) {
    var s = subjectById(subject), m = moodById(mood);
    var out = [s ? s.label : '題材おまかせ', m ? m.label : '気持ちおまかせ',
      season === 'any' || !season ? '季節は問わない' : season];
    if (normWords(words) === 'modern') out.push('現代のことばも');
    return out.join(' × ');
  }

  function goStage(stage) {
    st.stage = stage;
    openLine = -1; openBlank = -1;
    save(); draw();
    window.scrollTo(0, 0);
  }
  function goStep(n) {
    st.step = n; st.entry = 'ask';
    if (n !== 2) subjQuery = '';
    save(); draw();
    window.scrollTo(0, 0);
  }
  function setEntry(id) {
    st.entry = id; askMsg = '';
    save(); draw();
    window.scrollTo(0, 0);
  }

  // 画面の主ボタン（スマホでは下タブの直上に sticky。DESIGN 11.1-6）
  function cta(label, onClick, cls) {
    return el('div', { class: 'cta-bar' + (cls ? ' ' + cls : '') }, [
      button(label, onClick, 'btn btn-primary btn-big cta-main')
    ]);
  }
  function needIntro() { return st.stage === 'input' && st.entry === 'ask' && !W.store.prefs.get().introSeen; }

  /* ---------- 画面 ---------- */
  function draw() {
    token++;
    ctaNode = null; candList = null; candDots = null;
    if (ownRow) { ownRow.stop(); ownRow = null; }
    root.innerHTML = '';
    var view = el('section', { class: 'view view-easy' }, [
      el('div', { class: 'view-head' }, [
        el('h1', { class: 'view-title', text: 'かんたんに詠む' }),
        el('p', { class: 'lead', text: st.stage === 'input' ? LEAD[st.entry === 'ask' ? 'input' : st.entry] : LEAD[st.stage] })
      ])
    ]);
    if (!W.easy || !W.easyGen) {
      view.appendChild(el('p', { class: 'notice error', text: 'かんたんモードの部品（data/easy.js・js/easy-gen.js）が読み込まれていません。' }));
    } else if (st.stage === 'cands') view.appendChild(candsStage());
    else if (st.stage === 'finish') view.appendChild(finishStage());
    else view.appendChild(st.entry === 'fill' ? fillPanel() : st.entry === 'free' ? freePanel() : askPanel());
    if (ctaNode) { view.appendChild(ctaNode); view.classList.add('has-cta'); }
    root.appendChild(view);
    if (st.stage === 'cands') syncCarousel();
  }

  // 「ほかの作り方：穴埋め ／ ふだんの言葉から」（いまの入り口以外）
  function otherEntries() {
    var links = [];
    ENTRIES.forEach(function (en) {
      if (en.id === st.entry) return;
      if (links.length) links.push(el('span', { class: 'sep', 'aria-hidden': 'true', text: '／' }));
      links.push(button(en.label, function () { setEntry(en.id); }, 'link-btn entry-link', { 'data-entry': en.id }));
    });
    return el('p', { class: 'other-entries' }, [el('span', { class: 'other-label', text: 'ほかの作り方：' })].concat(links));
  }

  /* ---------- はじめての案内（初回だけ） ---------- */
  function introCard() {
    ctaNode = cta('はじめる', function () {
      W.store.prefs.set({ introSeen: true });
      st.step = 1;
      save(); draw();
      window.scrollTo(0, 0);
    }, 'intro-cta');
    return el('div', { class: 'intro-card' }, [
      el('h2', { class: 'intro-title', text: 'はじめての方へ' }),
      el('ol', { class: 'intro-list' }, [
        el('li', { text: '質問に答えるだけで一首できます' }),
        el('li', { text: 'できた歌は句ごとに直せます' }),
        el('li', { text: '画像にして X に貼れます' })
      ])
    ]);
  }

  /* ---------- 1. 質問に答える（1 画面 1 問） ---------- */
  /* ---------- 今日のお題（質問の 1/3 の先頭） ---------- */
  function todayTheme() {
    if (!W.easyGen || typeof W.easyGen.todayTheme !== 'function') return null;
    try { return W.easyGen.todayTheme(W.easyGen.jstDate()); } catch (e) { return null; }
  }
  function odaiCard() {
    var t = todayTheme();
    var s = t && subjectById(t.subject), m = t && moodById(t.mood);
    if (!s || !m) return null;
    var d = t.date.split('-');
    return button([
      el('span', { class: 'odai-label' }, [el('span', { class: 'odai-mark', 'aria-hidden': 'true' }), '今日のお題', el('span', { class: 'odai-date', text: Number(d[1]) + '月' + Number(d[2]) + '日' })]),
      el('span', { class: 'odai-theme' }, [el('span', { class: 'odai-word', text: s.label }), el('span', { class: 'odai-x', 'aria-hidden': 'true', text: '×' }), el('span', { class: 'odai-word', text: m.label })]),
      el('span', { class: 'odai-go', text: 'このお題で詠む →' })
    ], function () {
      st.season = t.season; st.subject = t.subject; st.mood = t.mood; st.step = STEPS; askMsg = '';
      openGroups = null; subjQuery = '';
      generate(t.date);
    }, 'odai-card', { 'aria-label': '今日のお題「' + s.label + '」×「' + m.label + '」で詠む（' + (t.season === 'any' ? '季節は問わない' : t.season) + '）' });
  }

  function askPanel() {
    if (needIntro()) return introCard();
    var step = st.step;
    var body = step === 1 ? qSeason() : step === 2 ? qSubject() : step === 3 ? qMood() : qWords();
    var label = step === 1 ? (st.season ? '次へ' : 'えらばずに次へ')
      : step === 2 ? (st.subject ? '次へ' : 'おまかせで次へ') : step === 3 ? '次へ' : '一首つくる';
    ctaNode = cta(label, step === STEPS ? function () { generate(null); } : function () { goStep(step + 1); }, 'ask-cta');
    return el('div', { class: 'ask', 'data-step': String(step) }, [
      step === 1 ? odaiCard() : null,
      step === 1 ? resumeCard() : null,
      step === 1 ? otherEntries() : null,
      askMsg && step === 1 ? el('p', { class: 'banner', text: askMsg }) : null,
      stepper(step),
      body
    ]);
  }

  function stepVal(n) {
    if (n === 1) return st.season === 'any' ? '問わない' : st.season || '—';
    if (n === 4) return wordsShort(st.words);
    var x = n === 2 ? subjectById(st.subject) : moodById(st.mood);
    return x ? x.label : 'おまかせ';
  }

  // 進捗（1 / 4）・もどる・各ステップへのタップ
  function stepper(step) {
    return el('div', { class: 'stepper' }, [
      el('div', { class: 'stepper-top' }, [
        step > 1 ? button('← もどる', function () { goStep(step - 1); }, 'link-btn step-back') : el('span'),
        el('p', { class: 'step-count', text: step + ' / ' + STEPS })
      ]),
      el('ol', { class: 'step-list' }, [1, 2, 3, 4].map(function (n) {
        return el('li', {}, button([
          el('span', { class: 'step-no', text: String(n) }),
          el('span', { class: 'step-name', text: STEP_NAMES[n - 1] }),
          el('span', { class: 'step-val', text: stepVal(n) })
        ], function () { goStep(n); }, 'step-btn' + (n < step ? ' done' : ''),
        { 'aria-current': n === step ? 'step' : null, 'aria-label': n + '. ' + STEP_NAMES[n - 1] + '：' + stepVal(n) }));
      }))
    ]);
  }

  function qHead(no, title, sub) {
    return el('h2', { class: 'q-title' }, [el('span', { class: 'q-no', text: no }), title, sub ? el('span', { class: 'q-sub', text: sub }) : null]);
  }

  function qSeason() {
    var list = SEASONS.map(function (s) { return { v: s, label: s }; }).concat([{ v: 'any', label: '季節は問わない' }]);
    var grid = el('div', { class: 'q-grid season-grid' }, list.map(function (it) {
      return button(it.label, function () {
        if (st.season !== it.v) { openGroups = null; subjQuery = ''; }
        st.season = it.v; askMsg = '';
        goStep(2);
      }, 'q-btn' + (it.v === 'any' ? ' wide' : ''), { 'aria-pressed': String(st.season === it.v) });
    }));
    return el('div', { class: 'q' }, [qHead('Q1', 'いつ？'), grid]);
  }

  /* 題材：検索＋グループ折りたたみ（季節に合うグループ・題材を先頭に） */
  // ひらがなにそろえ、歴史的仮名の一部を現代仮名に寄せる（「ふじ」で「ふぢ」に当たるように）
  function norm(t) {
    var h = W.mora.toHira(String(t || '')).toLowerCase();
    return h.replace(/ぢ/g, 'じ').replace(/づ/g, 'ず').replace(/ゐ/g, 'い').replace(/ゑ/g, 'え').replace(/\s+/g, '');
  }
  // 題材名・読み・synonyms（現代語）の部分一致。ひらがな 1 文字のときは synonyms を引かない（当たりすぎるため）
  function searchSubjects(q) {
    var n = norm(q), syn = E().synonyms || {}, ids = {};
    if (!n) return [];
    if (n.length >= 2 || !/^[ぁ-ゖー]$/.test(n)) {
      Object.keys(syn).forEach(function (k) { if (norm(k).indexOf(n) >= 0) ids[syn[k]] = true; });
    }
    return E().subjects.filter(function (s) {
      return norm(s.label).indexOf(n) >= 0 || norm(s.kana).indexOf(n) >= 0 || ids[s.id];
    });
  }
  function subjectGroups() {
    var season = genSeason(), map = {}, order = GROUP_ORDER.slice();
    E().subjects.forEach(function (s) {
      var g = s.group || 'そのほか';
      if (order.indexOf(g) < 0) order.push(g);
      (map[g] = map[g] || []).push(s);
    });
    var groups = order.filter(function (g) { return map[g]; }).map(function (g, i) {
      var items = map[g];
      var inS = season ? items.filter(function (s) { return s.season.indexOf(season) >= 0; }) : [];
      var gen = items.filter(function (s) { return !s.season.length; });
      var rest = items.filter(function (s) { return inS.indexOf(s) < 0 && gen.indexOf(s) < 0; });
      return { name: g, items: inS.concat(gen, rest), inSeason: inS, i: i };
    });
    // 季節に合う題材があるグループを先に（それ以外は元の順）
    return groups.sort(function (a, b) {
      return (b.inSeason.length > 0) - (a.inSeason.length > 0) || a.i - b.i;
    });
  }
  // 季節に合う題材には小さく季節の印（「秋」など）を付ける
  function subjectChip(s, inSeason) {
    // 印は CSS の ::after（data-season）で描く。本文のテキストは題材名だけにしておく
    var season = genSeason();
    return button(s.label, function () {
      st.subject = s.id;
      goStep(3);
    }, 'chip' + (inSeason ? ' in-season' : ''), {
      'aria-pressed': String(st.subject === s.id),
      'data-season': inSeason && season ? season : null,
      'aria-label': inSeason && season ? s.label + '（' + season + 'に合う題材）' : null
    });
  }
  function paintSubjects(box) {
    var season = genSeason();
    box.innerHTML = '';
    var q = subjQuery.trim();
    if (q) {
      var hits = searchSubjects(q);
      if (hits.length) {
        box.appendChild(el('p', { class: 'q-hint subj-count', text: hits.length + ' 件' }));
        box.appendChild(el('div', { class: 'chips subj-hits' }, hits.map(function (s) { return subjectChip(s, !!season && s.season.indexOf(season) >= 0); })));
        return;
      }
      box.appendChild(el('p', { class: 'q-hint subj-none', text: '「' + q + '」に合う題材は見つかりませんでした。下のグループからえらべます。' }));
    }
    var cur = subjectById(st.subject);
    subjectGroups().forEach(function (g, gi) {
      var def = season ? g.inSeason.length > 0 : gi === 0;
      if (cur && g.items.indexOf(cur) >= 0) def = true;
      var open = openGroups && Object.prototype.hasOwnProperty.call(openGroups, g.name) ? openGroups[g.name] : def;
      var head = button([
        el('span', { class: 'grp-mark', 'aria-hidden': 'true', text: open ? '－' : '＋' }),
        el('span', { class: 'grp-name', text: g.name }),
        g.inSeason.length ? el('span', { class: 'grp-badge', text: season + 'の題材 ' + g.inSeason.length }) : null,
        el('span', { class: 'grp-count', text: g.items.length + ' 件' })
      ], function () {
        openGroups = openGroups || {};
        openGroups[g.name] = !open;
        paintSubjects(box);
      }, 'grp-head', { 'aria-expanded': String(open), 'data-group': g.name });
      box.appendChild(el('section', { class: 'grp' + (g.inSeason.length ? ' in-season' : '') + (open ? ' open' : '') }, [
        head,
        open ? el('div', { class: 'chips grp-chips' }, g.items.map(function (s) { return subjectChip(s, g.inSeason.indexOf(s) >= 0); })) : null
      ]));
    });
  }
  function qSubject() {
    var season = genSeason();
    var box = el('div', { class: 'subj-box' });
    var search = el('input', {
      type: 'search', class: 'subj-search', value: subjQuery, placeholder: 'さがす（例：さくら・月・雨）',
      'aria-label': '題材をさがす', enterkeyhint: 'search', autocomplete: 'off'
    });
    search.addEventListener('input', function () { subjQuery = search.value; paintSubjects(box); });
    paintSubjects(box);
    return el('div', { class: 'q' }, [
      qHead('Q2', '何を見た・思った？', season ? season + 'の題材を先頭に' : null),
      // 印の意味（季節を選んだときだけ）
      season ? el('p', { class: 'q-note' }, [
        el('span', { class: 'chip-season chip-season-inline', 'aria-hidden': 'true', text: season }),
        'の印がついた題材が' + season + 'に合います。ほかの題材もえらべます。'
      ]) : null,
      search, box,
      el('p', { class: 'q-hint', text: 'えらばなければ、おまかせで選びます。' })
    ]);
  }

  function qMood() {
    var grid = el('div', { class: 'mood-grid' }, E().moods.map(function (m) {
      return button([el('span', { class: 'mood-label', text: m.label }), el('span', { class: 'mood-hint', text: m.hint || '' })], function () {
        st.mood = m.id;
        save(); draw();
      }, 'mood-btn', { 'aria-pressed': String(st.mood === m.id) });
    }));
    grid.appendChild(button([el('span', { class: 'mood-label', text: 'おまかせ' }), el('span', { class: 'mood-hint', text: '題材に合わせて選びます' })], function () {
      st.mood = null; save(); draw();
    }, 'mood-btn mood-any', { 'aria-pressed': String(!st.mood) }));
    return el('div', { class: 'q' }, [
      qHead('Q3', 'どんな気持ち？'), grid,
      el('p', { class: 'q-hint', text: 'えらんだら「次へ」を押してください。' })
    ]);
  }

  // Q4 ことば: 選ぶとそのまま候補へ（DESIGN 13.1）
  function qWords() {
    var grid = el('div', { class: 'q-grid words-grid' }, WORDS.map(function (it) {
      return button([el('span', { class: 'words-label', text: it.label }), el('span', { class: 'words-desc', text: it.desc })], function () {
        st.words = it.id;
        generate(null);
      }, 'q-btn words-btn', { 'aria-pressed': String(st.words === it.id), 'data-words': it.id });
    }));
    return el('div', { class: 'q' }, [
      qHead('Q4', 'どんなことばで？'), grid,
      el('p', { class: 'q-hint', text: 'えらぶと、すぐに候補を作ります。' })
    ]);
  }

  // odaiDate: 今日のお題のカードから作ったときの日付（それ以外は null）
  function generate(odaiDate) {
    var res;
    st.words = normWords(st.words);
    try { res = W.easyGen.make({ season: genSeason(), subject: st.subject, mood: st.mood, words: st.words, count: 3 }); }
    catch (e) { res = []; if (window.console) console.error(e); }
    if (!res.length) { ui.toast('候補を作れませんでした', 'error'); return; }
    candIndex = 0;
    st.odai = typeof odaiDate === 'string' ? odaiDate : null;
    st.cands = res.map(function (p) {
      return { ku: p.ku, kana: p.kana, roles: p.roles, slots: p.slots, keys: p.keys, ms: p.ms, meaning: p.meaning || '',
        templateId: p.templateId, subject: p.subject, mood: p.mood, season: p.season, words: normWords(p.words || st.words) };
    });
    goStage('cands');
  }

  /* ---------- 候補 3 首（スマホは横スワイプのカルーセル、PC は 3 枚横並び） ---------- */
  var candList = null, candDots = null, candTimer = null;
  function candsStage() {
    if (candIndex >= st.cands.length) candIndex = 0;
    var n = st.cands.length;
    candList = el('div', { class: 'cand-list', tabindex: '0', role: 'region', 'aria-roledescription': 'カルーセル',
      'aria-label': '候補 ' + n + ' 首（←→ キーかスワイプで切り替え）' }, st.cands.map(function (p, i) {
      var s = subjectById(p.subject), m = moodById(p.mood);
      return el('div', { class: 'cand', 'data-i': String(i), role: 'group', 'aria-roledescription': 'スライド', 'aria-label': '候補 ' + (i + 1) + ' / ' + n }, [
        el('p', { class: 'cand-no', text: '候補 ' + (i + 1) + ' / ' + n }),
        tatePoem(p.ku, 'cand-poem'),
        meanEl(candMeaning(p), 'cand-mean'),
        el('p', { class: 'cand-meta', text: (s ? s.label : '') + (s && m ? '・' : '') + (m ? m.label : '') }),
        button('これにする', function () { choose(i); }, 'btn btn-primary cand-pick')
      ]);
    }));
    candDots = el('div', { class: 'cand-dots' }, st.cands.map(function (p, i) {
      return button(el('i'), function () { scrollToCand(i); }, 'cand-dot', { 'aria-label': '候補 ' + (i + 1) + ' を見る', 'aria-current': i === candIndex ? 'true' : 'false' });
    }));
    candList.addEventListener('scroll', function () {
      clearTimeout(candTimer);
      candTimer = setTimeout(readCarousel, 50);
    }, { passive: true });
    candList.addEventListener('keydown', function (e) {
      if (e.target !== candList && e.target.tagName === 'INPUT') return;
      var to = -1;
      if (e.key === 'ArrowRight') to = Math.min(candIndex + 1, n - 1);
      if (e.key === 'ArrowLeft') to = Math.max(candIndex - 1, 0);
      if (to < 0) return;
      e.preventDefault();
      scrollToCand(to);
      // PC（3 枚横並び）ではその候補の「これにする」へフォーカスを移す
      if (!isCarousel() && e.target !== candList) { var b = candList.children[to].querySelector('.cand-pick'); if (b) b.focus(); }
    });
    // スマホは「これにする」を下の主ボタンに（いま見ている候補をえらぶ）。PC はカードのボタン
    ctaNode = cta('これにする', function () { choose(candIndex); }, 'cands-cta');
    return el('div', { class: 'cands' }, [
      st.odai ? el('p', { class: 'odai-badge', text: '今日のお題' }) : null,
      el('p', { class: 'cond-line', text: condText(st.subject, st.mood, st.season, candsWords()) }),
      candList, candDots,
      el('p', { class: 'swipe-hint', text: '左右にスワイプして見くらべられます' }),
      el('div', { class: 'cand-actions' }, [
        button([ui.icon('shuffle'), 'ほかの候補'], function () { generate(st.odai); }, 'btn btn-again'),
        button('条件を変える', function () { st.entry = 'ask'; st.step = STEPS; goStage('input'); }, 'btn cond-btn')
      ]),
      wordsSwitch()
    ]);
  }
  // 候補画面の ことば の 2 択。切り替えたら同じ条件で作り直す（今日のお題は保持）
  function wordsSwitch() {
    var cur = candsWords();
    return el('div', { class: 'words-switch' }, [
      el('span', { class: 'words-switch-label', id: 'words-switch-label', text: 'ことば' }),
      el('div', { class: 'seg words-seg', role: 'radiogroup', 'aria-labelledby': 'words-switch-label' }, WORDS.map(function (it) {
        return button(it.short, function () {
          if (it.id === candsWords()) return;
          st.words = it.id;
          generate(st.odai);
        }, 'seg-btn words-opt', { role: 'radio', 'aria-checked': String(cur === it.id), 'data-words': it.id });
      }))
    ]);
  }
  function cardStep() {
    var cards = candList ? candList.children : [];
    return cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : (candList ? candList.clientWidth : 1);
  }
  // 3 枚横並び（PC）のときはカルーセルとして扱わない
  function isCarousel() { return !!candList && candList.scrollWidth > candList.clientWidth + 4; }
  function readCarousel() {
    if (!candList || !isCarousel()) return;
    var i = Math.round(candList.scrollLeft / Math.max(1, cardStep()));
    setCandIndex(Math.max(0, Math.min(st.cands.length - 1, i)));
  }
  function setCandIndex(i) {
    candIndex = i;
    if (candDots) [].forEach.call(candDots.children, function (d, k) { d.setAttribute('aria-current', String(k === i)); });
  }
  function scrollToCand(i) {
    setCandIndex(i);
    if (!candList || !isCarousel()) return;
    var left = i * cardStep();
    try { candList.scrollTo({ left: left, behavior: 'smooth' }); } catch (e) { candList.scrollLeft = left; }
  }
  // 描き直したあと、見ていた候補の位置へもどす
  function syncCarousel() {
    if (!candList) return;
    if (candIndex && isCarousel()) candList.scrollLeft = candIndex * cardStep();
    setCandIndex(candIndex);
  }

  function choose(i) {
    var p = st.cands[i];
    st.work = {
      source: 'gen', subject: p.subject, mood: p.mood, season: p.season, words: normWords(p.words), templateId: p.templateId, savedId: null, odai: st.odai || null,
      lines: p.ku.map(function (t, k) {
        return { text: t, kana: p.kana[k], manual: true, slot: p.slots[k], key: p.keys[k], m: p.ms ? (p.ms[k] || '') : mOf(t, p.kana[k]) };
      })
    };
    goStage('finish');
  }

  /* ---------- 仕上げ ---------- */
  function finishStage() {
    var w = st.work;
    var touched = function () { return w.lines.some(function (l) { return l.own; }); };
    var backLabel = w.source === 'fill' ? '← 穴埋めにもどる' : st.cands ? '← 候補にもどる' : '← 条件を変える';
    var back = ui.twoStep(backLabel, '書きかえた句が消えます。もう一度押す', function () {
      if (w.source === 'fill') { st.entry = 'fill'; goStage('input'); }
      else goStage(st.cands ? 'cands' : 'input');
    }, { class: 'link-btn', skipIf: function () { return !touched(); } });

    previewBox = el('div', { class: 'finish-mini' });
    paintPreview();
    linesBox = el('div', { class: 'line-list' });
    paintLines();

    var author = el('input', { type: 'text', class: 'author-input', value: W.store.prefs.get().author, placeholder: '雅号（なくてもよい）', maxlength: '20', 'aria-label': '雅号（作者名）' });
    author.addEventListener('input', function () { W.store.prefs.set({ author: author.value }); });

    var doneFn = function () {
      if (w.lines.every(function (l) { return !l.text.trim(); })) { ui.toast('句を入れてから押してください'); return; }
      save();
      var auto = workMeaning();
      ui.finish({ ku: w.lines.map(function (l) { return l.text; }), kana: w.lines.map(function (l) { return l.kana; }), author: author.value, meaning: finishMeaning() }, {
        mode: 'new', editingId: w.savedId || null,
        odai: !!w.odai && !!W.easyGen.jstDate && w.odai === W.easyGen.jstDate(),
        odaiDate: w.odai || null,   // みんなの和歌への投稿の odai（今日のときだけ使われる）
        onMeaning: function (v) { w.meaningOwn = { auto: auto, text: v }; saveSoon(); },
        onSaved: function (item) { w.savedId = item.id; save(); }
      });
    };
    ctaNode = cta('できた！', doneFn, 'finish-cta');

    var toCompose = ui.twoStep('じっくりモードで続きを書く', '書きかけの下書きを置きかえます。もう一度押す', function () {
      var d = W.store.draft.empty();
      d.ku = w.lines.map(function (l) { return l.text; });
      d.kana = w.lines.map(function (l) { return l.kana; });
      d.manual = w.lines.map(function (l) { return !!l.kana.trim(); });
      d.author = author.value;
      d.editingId = w.savedId || null;
      d.meaning = finishMeaning();
      if (W.store.draft.save(d)) location.hash = '#/compose';
    }, { class: 'btn', skipIf: function () { return W.store.draft.isEmpty(); } });

    var restart = ui.twoStep('はじめから作る', '作りかけの歌を消します。もう一度押す', function () {
      st.work = null; st.cands = null; st.entry = 'ask'; st.step = 1; st.fillId = null; st.fill = {};
      goStage('input');
    }, { class: 'btn btn-ghost' });

    return el('div', { class: 'finish-stage' }, [
      el('div', { class: 'stage-nav' }, [back]),
      el('div', { class: 'finish-grid' }, [
        previewBox,
        el('div', { class: 'finish-main' }, [
          linesBox,
          el('label', { class: 'author-row' }, [el('span', { class: 'author-label', text: '雅号' }), author]),
          el('div', { class: 'easy-actions' }, [el('div', { class: 'btn-row' }, [toCompose, restart])])
        ])
      ])
    ]);
  }

  function paintPreview() {
    previewBox.innerHTML = '';
    previewBox.appendChild(tatePoem(st.work.lines.map(function (l) { return l.text; }), 'mini-poem'));
    var m = workMeaning();
    if (m) previewBox.appendChild(meanEl(m, 'finish-mean'));
  }

  function paintLines() {
    if (ownRow) { ownRow.stop(); ownRow = null; }
    linesBox.innerHTML = '';
    for (var i = 0; i < 5; i++) linesBox.appendChild(lineCard(i));
  }

  function lineCard(i) {
    var ln = st.work.lines[i];
    var isOpen = openLine === i;
    var head = el('button', { type: 'button', class: 'line-head', 'aria-expanded': String(isOpen) });
    function paintHead() {
      var empty = !ln.text.trim() && !ln.kana.trim();
      var n = count(ln.kana);
      head.innerHTML = '';
      head.appendChild(el('span', { class: 'ku-no', text: NUM[i] }));
      head.appendChild(el('span', { class: 'line-body' }, [
        el('span', { class: 'line-text', text: ln.text.trim() || '（まだありません）' }),
        el('span', { class: 'line-kana', text: ln.kana })
      ]));
      head.appendChild(el('span', { class: 'line-side' }, [
        ui.moraMeter(empty ? 0 : (ln.kana.trim() ? n : NaN), TARGET[i], { empty: empty }),
        el('span', { class: 'line-edit', text: isOpen ? '閉じる' : '変える' })
      ]));
    }
    paintHead();
    head.addEventListener('click', function () {
      openLine = isOpen ? -1 : i;
      lineTab = 'alt';
      paintLines();
      var card = linesBox.children[i];
      if (openLine === i && card && card.scrollIntoView) try { card.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    });
    var card = el('div', { class: 'line-card' + (isOpen ? ' open' : '') }, [head]);
    if (isOpen) card.appendChild(linePanel(i, function () { paintHead(); paintPreview(); }));
    return card;
  }

  // その句に「ほかの言い方」があるか（生成した句・穴埋めの空欄のある句）
  function hasAlt(ln) {
    if (st.work.source === 'fill') {
      var tpl = fillTplById(st.work.fillId);
      return !!(tpl && ln.fill != null && tpl.ku[ln.fill] && tpl.ku[ln.fill].blank);
    }
    return !!ln.slot;
  }

  function linePanel(i, onChange) {
    var ln = st.work.lines[i];
    var alt = hasAlt(ln);
    var tab = alt && lineTab === 'alt' ? 'alt' : 'own';
    var tabs = el('div', { class: 'line-tabs', role: 'tablist', 'aria-label': NUM[i] + ' の直し方' });
    var body = el('div', { class: 'line-panel-body' });
    function show(t) {
      lineTab = t;
      if (ownRow) { ownRow.stop(); ownRow = null; }
      [].forEach.call(tabs.children, function (c) { c.setAttribute('aria-selected', String(c.getAttribute('data-tab') === t)); });
      body.innerHTML = '';
      body.appendChild(t === 'alt' ? altBox(i, onChange) : ownBox(i, onChange));
    }
    if (alt) tabs.appendChild(button('ほかの言い方', function () { show('alt'); }, 'line-tab', { role: 'tab', 'data-tab': 'alt', 'aria-selected': 'false' }));
    tabs.appendChild(button('自分の言葉で書く', function () { show('own'); }, 'line-tab', { role: 'tab', 'data-tab': 'own', 'aria-selected': 'false' }));
    show(tab);
    return el('div', { class: 'line-panel' }, [
      tabs, body,
      alt ? null : el('p', { class: 'q-hint', text: 'この句は型の言葉です。自分の言葉に書きかえられます。' })
    ]);
  }

  function alternativesFor(i) {
    var w = st.work, ln = w.lines[i];
    if (w.source === 'fill') {
      var k = fillTplById(w.fillId).ku[ln.fill];
      return shuffle(blankCandidates(k.blank).filter(function (c) { return !ln.choice || c.text !== ln.choice.text; }))
        .slice(0, 6).map(function (c) { var x = composeLine(k, c); x.choice = c; x.mShow = fillM(k, c); return x; });
    }
    var keys = w.lines.map(function (l, k) { return k === i ? null : l.key; });
    return W.easyGen.alternatives({
      slot: ln.slot, subject: w.subject, mood: w.mood, season: w.season, words: normWords(w.words),
      excludeKeys: keys, excludeTexts: [ln.text], count: 6
    }).map(function (p) { return { text: p.text, kana: p.kana, key: p.key, m: p.m || '', modern: p.modern === true }; });
  }

  function altBox(i, onChange) {
    var ln = st.work.lines[i];
    var list = alternativesFor(i);
    var box = el('div', { class: 'alt-box' });
    var chips = el('div', { class: 'alt-list' });
    list.forEach(function (a) {
      var mm = a.mShow != null ? a.mShow : a.m;
      var b = button([
        el('span', { class: 'alt-text', text: a.text }), el('span', { class: 'alt-kana', text: a.kana }),
        mm ? el('span', { class: 'alt-m', text: mm }) : null
      ], function () {
        ln.text = a.text; ln.kana = a.kana; ln.manual = true; ln.own = false;
        if (a.key !== undefined) ln.key = a.key;
        if (a.m !== undefined) ln.m = a.m;
        if (a.choice) ln.choice = a.choice;
        [].forEach.call(chips.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        save(); onChange();
      }, 'alt-chip', { 'aria-pressed': 'false' });
      chips.appendChild(b);
    });
    box.appendChild(list.length ? chips : el('p', { class: 'q-hint', text: 'ほかの言い方が見つかりませんでした。' }));
    box.appendChild(button([ui.icon('shuffle'), 'べつの言い方を見る'], function () {
      var parent = box.parentNode;
      if (parent) parent.replaceChild(altBox(i, onChange), box);
    }, 'btn btn-small alt-more'));
    return box;
  }

  function ownBox(i, onChange) {
    var ln = st.work.lines[i];
    if (W.reading && W.reading.preloadIdle) W.reading.preloadIdle();
    ownRow = ui.kuRow({
      no: '', target: TARGET[i], label: NUM[i] + ' 自分の言葉', class: 'own-row',
      text: ln.text, kana: ln.kana, manual: ln.manual,
      onChange: function (s) {
        ln.text = s.text; ln.kana = s.kana; ln.manual = s.manual; ln.own = true; ln.key = null; ln.m = '';
        onChange(); saveSoon();
      }
    });
    return el('div', { class: 'own-box' }, [
      ownRow.row,
      el('p', { class: 'q-hint', text: '本文を書くと、読みと音数を自動で数えます。読みが違っていたら直してください。' })
    ]);
  }

  /* ---------- 2. 穴埋め ---------- */
  function blankCandidates(b) {
    var m = b.mora, c = b.candidates, list;
    if (c === 'subject') {
      list = E().subjects.map(function (s) { return { text: SUBJECT_WORD[s.id] || s.label, kana: s.kana, m: s.meaning || '' }; });
    } else if (c === 'words') {
      list = (W.words || []).filter(function (w) { return !b.kind || b.kind.indexOf(w.kind) >= 0; })
        .map(function (w) { return { text: w.word, kana: w.kana, season: w.season, m: w.meaning || '' }; });
    } else if (c === 'makura') {
      list = (W.makura || []).map(function (x) { return { text: x.word, kana: x.kana, m: x.meaning || '' }; });
    } else if (Array.isArray(c)) {
      list = c.map(function (x) { return { text: x.text, kana: x.kana, m: x.m || '' }; });
    } else list = [];
    var hit = list.filter(function (x) { return count(x.kana) === m; });
    // 同じ語は 1 つだけ
    var seen = {};
    return (hit.length ? hit : list).filter(function (x) { if (seen[x.text]) return false; seen[x.text] = true; return true; });
  }

  // 空欄に choice を入れた句の本文と読み
  function composeLine(k, choice) {
    var idx = k.text.indexOf(BLANK);
    if (idx < 0) return { text: k.text, kana: k.kana };
    var pre = k.text.slice(0, idx), post = k.text.slice(idx + BLANK.length);
    var text = pre + choice.text + post, kana;
    if (!pre) kana = choice.kana + k.kana;
    else if (!post) kana = k.kana + choice.kana;
    else {
      // 途中の空欄：前の部分が仮名だけなら、その長さで読みを分ける
      var preK = W.mora.isKanaOnly(pre) ? W.mora.toHira(pre) : null;
      kana = preK && k.kana.indexOf(preK) === 0 ? preK + choice.kana + k.kana.slice(preK.length) : k.kana + choice.kana;
    }
    return { text: text, kana: kana };
  }

  function sampleText(t) {
    return t.ku.map(function (k) {
      return k.blank ? k.text.replace(BLANK, '【' + new Array(k.blank.mora + 1).join('○') + '】') : k.text;
    }).join('　');
  }

  function missingBlanks(tpl) {
    var out = [];
    tpl.ku.forEach(function (k, i) { if (k.blank && !(st.fill[i] && String(st.fill[i].text || '').trim())) out.push(i); });
    return out;
  }

  function fillPanel() {
    var tpl = fillTplById(st.fillId);
    if (!tpl) {
      return el('div', { class: 'fill-choose' }, [
        otherEntries(),
        el('h2', { class: 'q-title', text: '型をえらぶ' }),
        el('p', { class: 'q-hint', text: '【○○】が空欄です。○ の数が音の数。空欄に言葉を入れると一首になります。' }),
        el('div', { class: 'tpl-list' }, (E().fillTemplates || []).map(function (t) {
          return button([el('span', { class: 'tpl-label', text: t.label }), el('span', { class: 'tpl-sample', text: sampleText(t) })], function () {
            st.fillId = t.id; st.fill = {};
            openBlank = missingBlanks(t)[0];
            save(); draw();
          }, 'tpl-card');
        }))
      ]);
    }
    fillBox = el('div', { class: 'fill-rows' });
    paintFill();
    var left = missingBlanks(tpl).length;
    ctaNode = cta('この一首で仕上げる', finishFromFill, 'fill-cta');
    return el('div', { class: 'fill' }, [
      otherEntries(),
      el('div', { class: 'stage-nav' }, [
        button('← 型をえらびなおす', function () { st.fillId = null; st.fill = {}; openBlank = -1; save(); draw(); }, 'link-btn'),
        el('p', { class: 'cond-line', text: tpl.label })
      ]),
      el('p', { class: 'q-hint', text: '空欄をタップして、言葉をえらぶか自分で書いてください。' }),
      fillBox,
      el('div', { class: 'easy-actions' }, [
        el('div', { class: 'btn-row' }, [
          button([ui.icon('dice'), left ? 'おまかせで埋める' : 'おまかせで入れかえる'], autoFill, 'btn')
        ])
      ])
    ]);
  }

  function paintFill() {
    var tpl = fillTplById(st.fillId);
    fillBox.innerHTML = '';
    if (ownRow) { ownRow.stop(); ownRow = null; }
    tpl.ku.forEach(function (k, i) { fillBox.appendChild(fillRow(tpl, i)); });
  }

  function fillRow(tpl, i) {
    var k = tpl.ku[i];
    if (!k.blank) {
      return el('div', { class: 'fill-row fixed' }, [
        el('div', { class: 'fill-head' }, [
          el('span', { class: 'ku-no', text: NUM[i] }),
          el('span', { class: 'fill-text', text: k.text }),
          ui.moraMeter(count(k.kana), TARGET[i])
        ])
      ]);
    }
    var isOpen = openBlank === i;
    var head = el('button', { type: 'button', class: 'fill-head', 'aria-expanded': String(isOpen), 'aria-label': NUM[i] + ' の空欄（' + k.blank.mora + '音）' });
    function paintHead() {
      var f = st.fill[i], has = f && String(f.text || '').trim();
      var idx = k.text.indexOf(BLANK);
      var line = has ? composeLine(k, f) : null;
      head.innerHTML = '';
      head.appendChild(el('span', { class: 'ku-no', text: NUM[i] }));
      head.appendChild(el('span', { class: 'fill-text' }, [
        k.text.slice(0, idx),
        el('span', { class: 'blank' + (has ? ' filled' : ''), text: has ? f.text : new Array(k.blank.mora + 1).join('○') }),
        k.text.slice(idx + BLANK.length)
      ]));
      head.appendChild(has ? ui.moraMeter(count(line.kana), TARGET[i]) : ui.moraMeter(0, TARGET[i], { empty: true }));
    }
    paintHead();
    head.addEventListener('click', function () {
      openBlank = isOpen ? -1 : i;
      paintFill();
    });
    var row = el('div', { class: 'fill-row' + (isOpen ? ' open' : '') }, [head]);
    if (isOpen) row.appendChild(blankPanel(tpl, i, paintHead));
    return row;
  }

  function blankPanel(tpl, i, repaint) {
    var b = tpl.ku[i].blank;
    var all = blankCandidates(b);
    var isWords = b.candidates === 'words';
    var list = el('div', { class: 'chips blank-chips' });
    function paintChips() {
      list.innerHTML = '';
      var cur = st.fill[i];
      all.filter(function (c) { return !isWords || wordsTab === 'すべて' || c.season === wordsTab; }).forEach(function (c) {
        list.appendChild(button([c.text, el('span', { class: 'chip-kana', text: c.kana })], function () {
          st.fill[i] = { text: c.text, kana: c.kana, m: c.m || '' };
          var next = missingBlanks(tpl).filter(function (x) { return x !== i; })[0];
          openBlank = next != null ? next : -1;
          save(); paintFill();
          if (next == null) ui.toast('空欄がぜんぶうまりました。下の「この一首で仕上げる」へ');
        }, 'chip', { 'aria-pressed': String(!!cur && !cur.own && cur.text === c.text) }));
      });
      if (!list.children.length) list.appendChild(el('p', { class: 'q-hint', text: 'この分類の言葉はありません。' }));
    }
    paintChips();
    var tabs = null;
    if (isWords) {
      tabs = el('div', { class: 'tabs word-tabs', role: 'tablist', 'aria-label': '言葉の分類' }, WORD_TABS.map(function (t) {
        return button(t, function () {
          wordsTab = t;
          [].forEach.call(tabs.children, function (c) { c.setAttribute('aria-selected', String(c.textContent === t)); });
          paintChips();
        }, 'tab', { role: 'tab', 'aria-selected': String(wordsTab === t) });
      }));
    }
    var f = st.fill[i];
    ownRow = ui.kuRow({
      no: '', target: b.mora, label: '空欄に入れる言葉', class: 'own-row blank-own',
      text: f && f.own ? f.text : '', kana: f && f.own ? f.kana : '', manual: !!(f && f.own),
      onChange: function (s) {
        if (s.text.trim()) st.fill[i] = { text: s.text, kana: s.kana, own: true };
        else delete st.fill[i];
        [].forEach.call(list.querySelectorAll('[aria-pressed]'), function (c) { c.setAttribute('aria-pressed', 'false'); });
        repaint(); saveSoon();
      }
    });
    return el('div', { class: 'blank-panel' }, [
      el('p', { class: 'blank-title', text: b.mora + '音の言葉をえらぶ（' + all.length + '）' }),
      tabs, list,
      el('p', { class: 'blank-title', text: '自分で書く（' + b.mora + '音）' }),
      ownRow.row
    ]);
  }

  function autoFill() {
    var tpl = fillTplById(st.fillId);
    var miss = missingBlanks(tpl);
    var targets = miss.length ? miss : tpl.ku.map(function (k, i) { return k.blank ? i : -1; }).filter(function (i) { return i >= 0; });
    targets.forEach(function (i) {
      var c = shuffle(blankCandidates(tpl.ku[i].blank))[0];
      if (c) st.fill[i] = { text: c.text, kana: c.kana, m: c.m || '' };
    });
    openBlank = -1;
    save(); draw();
  }

  function finishFromFill() {
    var tpl = fillTplById(st.fillId);
    var miss = missingBlanks(tpl);
    if (miss.length) {
      ui.toast('空欄があと ' + miss.length + ' か所あります');
      openBlank = miss[0]; paintFill();
      return;
    }
    st.work = {
      source: 'fill', fillId: tpl.id, savedId: null,
      lines: tpl.ku.map(function (k, i) {
        if (!k.blank) return { text: k.text, kana: k.kana, manual: true };
        var line = composeLine(k, st.fill[i]);
        var f = st.fill[i];
        return { text: line.text, kana: line.kana, manual: !!line.kana.trim(), fill: i, choice: { text: f.text, kana: f.kana, m: f.m || '', own: !!f.own } };
      })
    };
    goStage('finish');
  }

  /* ---------- 3. 現代語で一言 ---------- */
  var CONTENT = /^(名詞|動詞|形容詞|副詞|感動詞)$/;
  var synKeys = null;

  function lookup(w) {
    var syn = E().synonyms || {};
    if (!w) return null;
    if (Object.prototype.hasOwnProperty.call(syn, w)) return { id: syn[w], word: w };
    var h = W.mora.toHira(w);
    if (h !== w && Object.prototype.hasOwnProperty.call(syn, h)) return { id: syn[h], word: w };
    return null;
  }

  // kuromoji の形態素から（2〜4 形態素の複合語 → 1 形態素の基本形 の順）
  function byTokens(tokens) {
    var hits = [], i = 0;
    while (i < tokens.length) {
      var found = null;
      for (var n = Math.min(4, tokens.length - i); n >= 2 && !found; n--) {
        var part = tokens.slice(i, i + n);
        var sur = part.map(function (t) { return t.surface_form; }).join('');
        var last = part[n - 1];
        var base = sur.slice(0, sur.length - last.surface_form.length) + (last.basic_form && last.basic_form !== '*' ? last.basic_form : last.surface_form);
        var h = lookup(sur) || lookup(base);
        if (h) found = { id: h.id, word: h.word, n: n };
      }
      if (!found) {
        var t = tokens[i];
        if (CONTENT.test(t.pos)) {
          var b = t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;
          var h1 = lookup(b) || lookup(t.surface_form);
          if (h1) found = { id: h1.id, word: h1.word, n: 1 };
        }
      }
      if (found) { hits.push(found); i += found.n; } else i++;
    }
    return hits;
  }

  // kuromoji が使えないとき：文字列の部分一致（長い語から）
  function bySubstr(text) {
    var syn = E().synonyms || {};
    if (!synKeys) synKeys = Object.keys(syn).sort(function (a, b) { return b.length - a.length; });
    var hits = [], pos = 0;
    while (pos < text.length) {
      var key = null;
      for (var k = 0; k < synKeys.length; k++) if (text.substr(pos, synKeys[k].length) === synKeys[k]) { key = synKeys[k]; break; }
      if (key) { hits.push({ id: syn[key], word: key }); pos += key.length; } else pos++;
    }
    return hits;
  }

  function summarize(text, hits) {
    var subj = null, mood = null;
    hits.forEach(function (h) {
      if (!subj && subjectById(h.id)) subj = h.id;
      if (moodById(h.id)) mood = h.id;   // 気持ちは最後に出てきたもの（文末ほど本音）
    });
    var m = /[春夏秋冬]/.exec(text);
    var s = subjectById(subj);
    var season = m ? m[0] : s && s.season.length === 1 ? s.season[0] : null;
    return { subject: subj, mood: mood, season: season, words: hits.map(function (h) { return h.word; }) };
  }

  function analyze(text) {
    var R = W.reading;
    if (!R || typeof R.tokenize !== 'function' || R.state === 'failed') return Promise.resolve(summarize(text, bySubstr(text)));
    return R.tokenize(text).then(function (tokens) {
      var hits = byTokens(tokens);
      return summarize(text, hits.length ? hits : bySubstr(text));
    }, function () { return summarize(text, bySubstr(text)); });
  }

  function runFree() {
    var text = String(st.free || '').trim();
    if (!text) { ui.toast('一言を入れてください'); return; }
    if (freeBusy) return;
    freeBusy = true; st.freeHit = null;
    draw();
    var my = token;
    analyze(text).then(function (res) {
      freeBusy = false;
      if (my !== token || !root || !root.querySelector('.view-easy')) return;   // ほかの画面に移った
      if (!res.subject && !res.mood) {
        st.entry = 'ask'; st.step = 1;
        askMsg = '言葉が見つかりませんでした。下から選んでください';
        save(); draw();
        return;
      }
      st.subject = res.subject; st.mood = res.mood; st.season = res.season || 'any';
      st.freeHit = { text: text, words: res.words };
      save(); draw();
    });
  }

  function freePanel() {
    if (W.reading && W.reading.preloadIdle) W.reading.preloadIdle();
    var input = el('input', { type: 'text', class: 'free-input', value: st.free || '', placeholder: '例：桜がきれいだけど散るのがさみしい', maxlength: '80', 'aria-label': 'いまの気持ちや見たものを一言で', enterkeyhint: 'search' });
    input.addEventListener('input', function () { st.free = input.value; saveSoon(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runFree(); } });
    var go = button(freeBusy ? 'ことばを調べています…' : 'ことばを探す', runFree, 'btn btn-primary free-go', { disabled: freeBusy });
    var wrap = el('div', { class: 'free' }, [
      otherEntries(),
      el('h2', { class: 'q-title', text: '見たもの・感じたことを、ふだんの言葉で一言' }),
      el('div', { class: 'free-row' }, [input, go]),
      el('p', { class: 'q-hint', text: '言葉から題材と気持ちを探して、歌の材料にします。' })
    ]);
    var hit = st.freeHit;
    if (hit && !freeBusy) {
      wrap.appendChild(el('div', { class: 'free-hit' }, [
        el('p', { class: 'free-q' }, ['「' + condText(st.subject, st.mood, st.season, st.words).split(' × ').join('」×「') + '」でよいですか？']),
        hit.words && hit.words.length ? el('p', { class: 'q-hint', text: '見つけた言葉：' + hit.words.join('・') + '　違っていたら「条件を直す」から直せます。' }) : null,
        button('条件を直す', function () { st.step = 1; setEntry('ask'); }, 'btn btn-small fix-cond')
      ]));
      ctaNode = cta('この条件で一首つくる', function () { generate(null); }, 'free-cta');
    }
    return wrap;
  }

  /* ---------- 入口 ---------- */
  function render(container) {
    root = container;
    st = load();
    openLine = -1; openBlank = -1; askMsg = ''; freeBusy = false; openGroups = null; subjQuery = ''; candIndex = 0;
    draw();
  }

  /* ---------- ホーム（DESIGN 13.4） ---------- */
  // 1/4 に作りかけ（work）か候補（cands）が残っていれば「つづきから」
  function resumeCard() {
    if (!st.work && !st.cands) return null;
    return button([
      el('span', { class: 'resume-text', text: '作りかけの一首があります' }),
      el('span', { class: 'resume-go', text: 'つづきから →' })
    ], function () { goStage(st.work ? 'finish' : 'cands'); }, 'resume-card',
    { 'aria-label': '作りかけの一首のつづきから（' + (st.work ? '仕上げ' : '候補') + 'へ）' });
  }
  // 質問の 1/4 へもどる。選択・候補・作りかけは残す
  function home() {
    var drawn = !!(root && st && root.querySelector('.view-easy'));
    if (!drawn) st = load();
    st.stage = 'input'; st.entry = 'ask'; st.step = 1;
    askMsg = ''; subjQuery = ''; freeBusy = false; openLine = -1; openBlank = -1; candIndex = 0;
    save();
    if (drawn) { draw(); window.scrollTo(0, 0); }
  }

  function leave() {
    token++;
    if (ownRow) { ownRow.stop(); ownRow = null; }
    if (st) save();
  }

  W.views = W.views || {};
  W.views.easy = { title: 'かんたん', render: render, leave: leave, home: home };
})();
