/* =====================================================================
 * js/view-terms.js — 利用規約・プライバシー（#/terms）
 * ---------------------------------------------------------------------
 * 作った和歌の権利はユーザー、データは端末内保存のみ、
 * GA（data/site.js に ID があるときだけ）の説明。制定日 2026-10-31。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;

  function sec(title, paras) {
    return el('section', { class: 'doc-sec' }, [el('h2', { class: 'doc-h', text: title })].concat(paras.map(function (t) {
      return el('p', { text: t });
    })));
  }

  function render(container) {
    var site = W.site || {};
    var name = site.name || '和歌メイカー';
    var owner = (site.author && site.author.name) || '制作者';
    var ga = site.analytics && site.analytics.ga4;
    container.innerHTML = '';
    container.appendChild(el('section', { class: 'view view-doc' }, [
      el('div', { class: 'view-head' }, [el('h1', { class: 'view-title', text: '利用規約・プライバシー' })]),
      sec('作った和歌について', [
        'このサイトで作った和歌と画像の権利は、作ったあなたにあります。SNS への投稿、配信、印刷など自由に使ってください。',
        '画像の下に入る小さなサイト名はクレジットとして残しています。お手本の古歌は著作権の切れた古典作品です。',
        '他人の作品をそのまま自作として発表したり、他人を傷つける内容に使ったりしないでください。'
      ]),
      sec('データの保存', [
        '作品帳・下書き・設定は、お使いの端末のブラウザ（localStorage）の中にだけ保存されます。' + owner + 'のサーバーへ送られることはありません。',
        'ブラウザのデータを消去すると作品帳も消えます。必要なら「書き出し (JSON)」で控えを取ってください。'
      ]),
      sec('外部への通信', [
        '見た目のために Google Fonts から書体を、読みの推定のために jsDelivr から kuromoji.js（辞書を含む）を読み込みます。入力した文章はあなたの端末の中で処理され、外へは送りません。',
        'X で共有するときは、共有する文章を X の投稿画面に渡します。投稿するかどうかはあなたが X の画面で決めます。'
      ]),
      sec('アクセス解析', [
        ga
          ? 'サイトの改善のため Google アナリティクス（GA4）でアクセス数などを集計しています。Cookie を使いますが、個人を特定する情報や入力した和歌は送りません。ブラウザの設定や拡張機能で無効にできます。'
          : '現在、アクセス解析は使っていません。今後使う場合は、この欄でお知らせします。'
      ]),
      sec('免責', [
        '音数の判定や読みの推定は目安です。正確さは保証しません。このサイトの利用によって生じた損害について、' + owner + 'は責任を負いません。',
        '内容は予告なく変更することがあります。'
      ]),
      el('p', { class: 'small muted', text: name + '　制定 2026-10-31' })
    ]));
  }

  W.views = W.views || {};
  W.views.terms = { title: '利用規約', render: render };
})();
