/* =====================================================================
 * js/view-gallery.js — 作品帳（#/gallery）
 * ---------------------------------------------------------------------
 * 作品帳（waka.gallery）を新しい順に並べる。タップで完成画面
 * （画像保存・共有・編集・削除）。書き出し／読み込み（JSON）で
 * 端末間の持ち運びができる（ファイルは FileReader で読む）。
 * ===================================================================== */
(function () {
  'use strict';

  var W = window.WAKA = window.WAKA || {};
  var ui = W.ui, el = ui.el;
  var root;

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // 作品帳の歌を手作りモードに読み込む（editingId つき）
  function edit(item) {
    var d = W.store.draft.empty();
    d.ku = item.ku.slice(); d.kana = item.kana.slice();
    d.manual = [true, true, true, true, true];
    d.author = item.author; d.editingId = item.id;
    d.meaning = item.meaning || '';   // じっくり側の完成画面で初期値になる
    if (W.store.draft.save(d)) location.hash = '#/compose';
  }

  function open(item) {
    var before = item.meaning || '';
    ui.finish(item, {
      // 詳細で意味を書きかえたら一覧も描き直す
      onClose: function () {
        var now = W.store.gallery.get(item.id);
        if (now && (now.meaning || '') !== before && root && root.querySelector('.view-gallery')) render(root);
      },
      mode: 'gallery', title: '作品帳の歌',
      onEdit: function () {
        var cur = W.store.draft.load();
        if (!W.store.draft.isEmpty(cur) && cur.editingId !== item.id) {
          ui.toast('書きかけの下書きは、この歌で置きかえられました');
        }
        edit(item);
      },
      onDelete: function () {
        if (W.store.gallery.remove(item.id)) { ui.toast('削除しました'); render(root); }
      }
    });
  }

  function card(item) {
    var b = el('button', { type: 'button', class: 'g-card' }, [
      el('span', { class: 'g-poem', text: ui.poemLine(item) }),
      item.meaning ? el('span', { class: 'g-mean', text: item.meaning }) : null,
      el('span', { class: 'g-meta' }, [
        item.author ? el('span', { class: 'g-author', text: item.author }) : null,
        el('span', { class: 'g-date', text: fmtDate(item.createdAt) })
      ])
    ]);
    b.addEventListener('click', function () { open(item); });
    return b;
  }

  function exportFile() {
    var json = W.store.gallery.exportJSON();
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var a = el('a', { href: url, download: 'waka_gallery_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    ui.toast('作品帳を書き出しました', 'ok');
  }

  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var r = W.store.gallery.importJSON(String(fr.result));
        ui.toast('読み込みました（新しく ' + r.added + ' 首・更新 ' + r.updated + ' 首）', 'ok');
        render(root);
      } catch (e) {
        ui.toast('読み込めませんでした：' + e.message, 'error');
      }
    };
    fr.onerror = function () { ui.toast('ファイルを読めませんでした', 'error'); };
    fr.readAsText(file);
  }

  function render(container) {
    root = container;
    container.innerHTML = '';
    var items = W.store.gallery.list();

    var list;
    if (!items.length) {
      list = el('div', { class: 'empty' }, [
        el('p', { text: 'まだ作品はありません。' }),
        el('p', { class: 'muted', text: '「できた！」の画面で「作品帳に保存」を押すと、ここに並びます。' }),
        el('a', { class: 'btn btn-primary', href: '#/compose', text: '一首詠んでみる' })
      ]);
    } else {
      list = el('div', { class: 'g-list' }, items.map(card));
    }

    var picker = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', function () {
      if (picker.files && picker.files[0]) importFile(picker.files[0]);
      picker.value = '';
    });
    var exp = el('button', { type: 'button', class: 'btn', text: '書き出し (JSON)', disabled: !items.length });
    exp.addEventListener('click', exportFile);
    var imp = el('button', { type: 'button', class: 'btn', text: '読み込み (JSON)' });
    imp.addEventListener('click', function () { picker.click(); });

    container.appendChild(el('section', { class: 'view view-gallery' }, [
      el('div', { class: 'view-head' }, [
        el('h1', { class: 'view-title', text: '作品帳' }),
        el('p', { class: 'lead', text: items.length ? items.length + ' 首。この端末のブラウザの中にだけ保存されています。' : 'この端末のブラウザの中にだけ保存されます。' })
      ]),
      list,
      el('div', { class: 'panel io-panel' }, [
        el('h2', { class: 'panel-title', text: '持ち運び' }),
        el('p', { class: 'small muted', text: '別の端末やブラウザへ移すときは、書き出したファイルを向こうで読み込んでください。同じ歌は新しい方が残ります。' }),
        el('div', { class: 'btn-row' }, [exp, imp, picker])
      ])
    ]));
  }

  W.views = W.views || {};
  W.views.gallery = { title: '作品帳', render: render };
})();
