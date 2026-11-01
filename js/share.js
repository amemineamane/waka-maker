// share.js — 和歌の共有 (X 投稿・本文コピー・Web Share API で画像つき共有) (担当 C)
// 公開: WAKA.share = { text, textWithMeaning, xUrl, openX, copyText, canShareImage, shareImage }
// X の投稿文 (text) には意味 (大意) を入れない。本文コピーは textWithMeaning (1 行空けて意味)。
// URL とハッシュタグは data/site.js (WAKA.site) から取る。無ければ空で組み立てる。
// opts.hashtags (配列) を渡すと site のハッシュタグの後ろに足す (今日のお題の `和歌メイカー_今日のお題` など、DESIGN 12-2)。
(function () {
  'use strict';
  var WAKA = (window.WAKA = window.WAKA || {});

  function site() { return WAKA.site || {}; }
  function kuList(poem) {
    var ku = (poem && poem.ku) || [];
    var out = [];
    for (var i = 0; i < 5; i++) {
      var s = String(ku[i] || '').trim();
      if (s) out.push(s);
    }
    return out;
  }
  function authorLine(poem) {
    var a = String((poem && poem.author) || '').trim();
    return a ? '— ' + a : '';
  }
  function hashtags(opts) {
    var h = site().hashtags;
    var list = (Array.isArray(h) ? h : []).concat(opts && Array.isArray(opts.hashtags) ? opts.hashtags : []);
    var seen = {};
    return list.filter(Boolean).map(function (t) { return String(t).replace(/^#/, ''); })
      .filter(function (t) { if (seen[t]) return false; seen[t] = true; return true; });
  }

  // 投稿文: 5 句を全角スペース区切りで 1 行 + 改行 + 「— 雅号」
  function text(poem) {
    var t = kuList(poem).join('　');
    var a = authorLine(poem);
    return a ? t + '\n' + a : t;
  }

  function xUrl(poem, opts) {
    var q = 'text=' + encodeURIComponent(text(poem));
    var url = site().url || '';
    if (url) q += '&url=' + encodeURIComponent(url);
    var tags = hashtags(opts);
    if (tags.length) q += '&hashtags=' + encodeURIComponent(tags.join(','));
    return 'https://x.com/intent/post?' + q;
  }

  // ポップアップが塞がれたら同じタブで開く
  function openX(poem, opts) {
    var u = xUrl(poem, opts);
    var w = window.open(u, '_blank', 'noopener');
    if (!w) location.href = u;
    return true;
  }

  // 本文コピー用: 5 句を改行区切り (雅号があれば最後の行に)。意味があれば 1 行空けて付ける
  function textWithMeaning(poem) {
    var lines = kuList(poem);
    var a = authorLine(poem);
    if (a) lines.push(a);
    var m = String((poem && poem.meaning) || '').trim();
    if (m) lines.push('', m);
    return lines.join('\n');
  }

  // クリップボードへ。文字列ならそのまま、poem なら textWithMeaning(poem)
  function copyText(poem) {
    var s = typeof poem === 'string' ? poem : textWithMeaning(poem);
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(s).then(function () { return s; }, function () { return legacyCopy(s); });
    }
    return legacyCopy(s);
  }
  function legacyCopy(s) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve(s) : reject(new Error('copy failed'));
    });
  }

  // 画像ファイルを navigator.share で渡せるか
  function canShareImage() {
    try {
      if (!navigator.share || !navigator.canShare || typeof File === 'undefined') return false;
      var f = new File([new Uint8Array(1)], 'waka.png', { type: 'image/png' });
      return navigator.canShare({ files: [f] });
    } catch (e) {
      return false;
    }
  }

  // 戻り値 Promise<'shared' | 'cancel'>。その他の失敗は reject
  // canvas.__wakaBlob（描画後に用意した PNG）があれば同期的に navigator.share を呼ぶ
  // （Safari は toBlob の待ち時間でユーザー操作の判定が切れることがあるため）
  function shareImage(canvas, poem, opts) {
    return new Promise(function (resolve, reject) {
      var ready = canvas && canvas.__wakaBlob;
      if (ready) go(ready); else canvas.toBlob(go, 'image/png');
      function go(blob) {
        if (!blob) return reject(new Error('toBlob failed'));
        var name = (WAKA.render && WAKA.render.filename) ? WAKA.render.filename() : 'waka.png';
        var file = new File([blob], name, { type: 'image/png' });
        var body = text(poem);
        var url = site().url || '';
        var tags = hashtags(opts).map(function (t) { return '#' + t; }).join(' ');
        if (url) body += '\n' + url;
        if (tags) body += '\n' + tags;
        var data = { files: [file], text: body };
        if (navigator.canShare && !navigator.canShare(data)) data = { files: [file] };
        navigator.share(data).then(function () { resolve('shared'); }, function (e) {
          if (e && e.name === 'AbortError') resolve('cancel');
          else reject(e);
        });
      }
    });
  }

  WAKA.share = {
    text: text,
    textWithMeaning: textWithMeaning,
    xUrl: xUrl,
    openX: openX,
    copyText: copyText,
    canShareImage: canShareImage,
    shareImage: shareImage
  };
})();
