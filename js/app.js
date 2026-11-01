/* =====================================================================
 * js/app.js — 起動・ルーティング・画面切替
 * ---------------------------------------------------------------------
 * すべての script の最後に読む。ハッシュ（#/easy #/mix #/compose #/gallery
 * #/help #/terms）で WAKA.views の画面を切り替える。既定は #/easy（かんたん）。
 * data/site.js に GA4 の ID があるときだけ gtag を読み込む。
 * http(s) で開いたときだけ Service Worker（sw.js、network-first）を登録する。file:// では登録しない。
 * localStorage が使えない環境では最初に 1 度だけ「この環境では保存できません」と出す（store.js）。
 * ヘッダーのロゴ（.brand）は、どの画面からでも かんたんの最初の質問（1/4）へもどる（DESIGN 13.4）。
 * かんたんタブも、すでに #/easy のときは同じ扱い（ほかの画面からタブで来たときは続きの段階から）。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ROUTES = ['easy', 'compose', 'mix', 'gallery', 'help', 'terms'];
  var current = null;
  // トップの <title>（index.html の <title> と同じ文面）
  var TOP_TITLE = document.title || '和歌メイカー';

  function fatal(msg) {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'notice error';
    box.innerHTML = '<h2>読み込みに失敗しました</h2><p></p><p class="muted">index.html の &lt;script&gt; の順序を確認してください。</p>';
    box.querySelector('p').textContent = msg;
    app.appendChild(box);
  }

  function routeName() {
    var m = /^#\/([a-z]+)/.exec(location.hash || '');
    return m && ROUTES.indexOf(m[1]) >= 0 ? m[1] : 'easy';
  }

  function show() {
    var name = routeName();
    var view = W.views[name];
    if (current && current.leave) try { current.leave(); } catch (e) {}
    var app = document.getElementById('app');
    try {
      view.render(app);
    } catch (e) {
      fatal('画面を表示できませんでした：' + e.message);
      if (window.console) console.error(e);
    }
    current = view;
    // タブの選択状態
    [].forEach.call(document.querySelectorAll('[data-route]'), function (a) {
      var on = a.getAttribute('data-route') === name;
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      if (a.getAttribute('role') === 'tab') a.setAttribute('aria-selected', String(on));
    });
    var site = (W.site && W.site.name) || '和歌メイカー';
    document.title = name === 'easy' ? TOP_TITLE : view.title + '｜' + site;
    window.scrollTo(0, 0);
    if (window.gtag) window.gtag('event', 'page_view', { page_path: '/' + name, page_title: document.title });
  }

  // ホーム: かんたんの 1/4 へ（選択・作りかけは残す。view-easy の home()）
  function goHome(e) {
    if (e) e.preventDefault();
    var easy = W.views && W.views.easy;
    if (easy && typeof easy.home === 'function') try { easy.home(); } catch (err) { if (window.console) console.error(err); }
    if (routeName() !== 'easy') location.hash = '#/easy';
    else show();
  }
  function bindHome() {
    [].forEach.call(document.querySelectorAll('.brand'), function (a) { a.addEventListener('click', goHome); });
    [].forEach.call(document.querySelectorAll('[data-route="easy"]'), function (a) {
      a.addEventListener('click', function (e) { if (routeName() === 'easy') goHome(e); });
    });
  }

  function loadAnalytics() {
    var id = W.site && W.site.analytics && W.site.analytics.ga4;
    if (!id) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: false });
  }

  // Service Worker（ホーム画面に追加・オフライン）。http(s) のときだけ
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      if (window.console) console.info('Service Worker を登録できませんでした:', err && err.message);
    });
  }

  function init() {
    if (!W.mora || !W.store || !W.ui || !W.reading) { fatal('js/ の部品（mora / store / components / reading）が読み込まれていません。'); return; }
    if (!W.views || ROUTES.some(function (r) { return !W.views[r]; })) { fatal('js/view-*.js が読み込まれていません。'); return; }
    if (!W.site) W.site = { name: '和歌メイカー', hashtags: [], author: {}, analytics: {} };

    // ヘッダー・フッターのサイト名
    [].forEach.call(document.querySelectorAll('[data-site-name]'), function (n) { n.textContent = W.site.name; });
    var credit = document.getElementById('footer-credit');
    if (credit && W.site.author && W.site.author.name) credit.textContent = '© ' + W.site.author.name;

    // file:// でも動くように、画像・共有の部品が無いことだけ知らせる
    if (!W.render || !W.share) {
      if (window.console) console.warn('WAKA.render / WAKA.share が見つかりません。画像・共有ボタンは無効になります。');
    }

    loadAnalytics();
    if (W.store.warnIfUnavailable) W.store.warnIfUnavailable();
    if (document.readyState === 'complete') registerServiceWorker();
    else window.addEventListener('load', registerServiceWorker);
    window.addEventListener('hashchange', show);
    bindHome();
    window.addEventListener('pagehide', function () { if (current && current.leave) current.leave(); });
    show();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
