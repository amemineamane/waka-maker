// render.js — 和歌を Canvas に縦書きで描いて画像にする (担当 C)
// 公開: WAKA.render = { draw, layouts, palettes, fonts, download, openInNewTab, filename, toBlob }
// 縦書きは 1 文字ずつ fillText。外部ライブラリなし。Google Fonts が読めなくても OS の明朝で描く。
// options.meaning (意味・大意) があれば、色紙と横長カードの下部に横書きで小さく描く (短冊は描かない)。
//   本文の文字の大きさは変えず、足りないときだけ本文のまとまりを少し上へずらす。
// options.font (DESIGN 12-4): 'shippori' (既定) / 'zenold' / 'yuji'。Google Fonts の link は選ばれたときに足す。
//   読み込めなければ Shippori Mincho → OS の明朝に戻す。実際に使った書体の id を canvas.__wakaFont に置く。
// options.seal (DESIGN 12-3): true なら雅号の下に朱の角印 (落款) を押す。雅号が空なら押さない。
(function () {
  'use strict';
  var WAKA = (window.WAKA = window.WAKA || {});

  var OS_MINCHO = '"Yu Mincho", "YuMincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  // 書体の選択肢。css は Google Fonts の stylesheet (選ばれたときだけ <link> を足す)
  var fonts = [
    { id: 'shippori', name: '明朝', description: 'しっぽり明朝。すっきりした明朝体', family: 'Shippori Mincho', weight: 500,
      css: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;500;600&display=swap' },
    { id: 'zenold', name: '古風な明朝', description: 'Zen Old Mincho。昔の活字のような明朝体', family: 'Zen Old Mincho', weight: 500,
      css: 'https://fonts.googleapis.com/css2?family=Zen+Old+Mincho:wght@400;500;600&display=swap' },
    { id: 'yuji', name: '行書風', description: 'Yuji Syuku。筆で書いたような書体', family: 'Yuji Syuku', weight: 400,
      css: 'https://fonts.googleapis.com/css2?family=Yuji+Syuku&display=swap' }
  ];
  function stackOf(f) {
    return '"' + f.family + '", ' + (f.id === 'shippori' ? '' : '"Shippori Mincho", ') + OS_MINCHO;
  }
  // いま描いている書体 (draw の中で切り替える)
  var FONT_STACK = stackOf(fonts[0]);
  var BODY_WEIGHT = 500;
  var ADV = 1.08;      // 文字送り (fontSize の倍率)
  var KU_GAP = 0.35;   // 同じ行の句と句の間のアキ (em)

  // ---- 公開する選択肢 ----
  var layouts = [
    { id: 'tanzaku', name: '短冊', description: '縦長。上の句と下の句の 2 行で書く昔ながらの形', w: 600, h: 2000 },
    { id: 'shikishi', name: '色紙', description: '正方形。5 行の散らし書き', w: 1200, h: 1200 },
    { id: 'card', name: '横長カード', description: 'X に貼りやすい 1200×630。右から左へ 5 行', w: 1200, h: 630 }
  ];
  var palettes = [
    { id: 'washi', name: '和紙', description: '生成りの地に墨の文字',
      bg: ['#f8f3e8', '#efe6d4'], ink: '#2b2b2b', accent: '#a2352f', grain: 'dark' },
    { id: 'sumi', name: '墨', description: '墨黒の地に白い文字',
      bg: ['#2a2725', '#151413'], ink: '#f3eee4', accent: '#b8955a', grain: 'light' },
    { id: 'yozakura', name: '夜桜', description: '紺の地に淡い桜色の文字と花びら',
      bg: ['#24305a', '#121a36'], ink: '#f7d9e0', accent: '#e9a9b9', grain: 'none', petals: true },
    { id: 'kincho', name: '金茶', description: '金茶の地に深緋の文字',
      bg: ['#dcbd84', '#c49a5b'], ink: '#8a1f1c', accent: '#8a1f1c', grain: 'gold' }
  ];

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  // ---- 固定シードの乱数 (毎回同じ絵にする) ----
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- フォント読込待ち (最大 4 秒。失敗しても描く) ----
  // 書体の stylesheet を 1 度だけ足す。読み込み結果 (true / false) を Promise で返す
  var linkState = {};
  function ensureFontLink(f) {
    if (linkState[f.id]) return linkState[f.id];
    linkState[f.id] = new Promise(function (resolve) {
      var links = document.querySelectorAll('link[rel="stylesheet"]');
      var key = f.family.replace(/ /g, '+');
      for (var i = 0; i < links.length; i++) {
        if ((links[i].href || '').indexOf(key) >= 0) return resolve(true);
      }
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = f.css;
      l.setAttribute('data-waka-font', f.id);
      l.onload = function () { resolve(true); };
      l.onerror = function () { resolve(false); };
      document.head.appendChild(l);
      setTimeout(function () { resolve(false); }, 2500);
    });
    return linkState[f.id];
  }
  // f の書体が使えるようになれば true。日本語フォントは unicode-range で分割配信されるので、使う文字を渡して必要分を読ませる
  function loadFont(f, text) {
    if (!document.fonts || !document.fonts.load) return Promise.resolve(false);
    var work = ensureFontLink(f).then(function () {
      return Promise.all([
        document.fonts.load(f.weight + ' 64px "' + f.family + '"', text),
        document.fonts.load('400 32px "' + f.family + '"', text)
      ]).then(function (r) { return r[0].length > 0 || r[1].length > 0; }, function () { return false; });
    });
    var limit = new Promise(function (r) { setTimeout(function () { r(false); }, 4000); });
    return Promise.race([work, limit]).catch(function () { return false; });
  }
  // 選ばれた書体 → だめなら Shippori → だめなら OS の明朝。使う書体 ({font, os}) を返す
  function waitFonts(fontId, text) {
    var want = find(fonts, fontId);
    return loadFont(want, text).then(function (ok) {
      if (ok) return { font: want, os: false };
      if (want.id === 'shippori') return { font: want, os: true };
      return loadFont(fonts[0], text).then(function (ok2) { return { font: fonts[0], os: !ok2 }; });
    }).then(function (r) {
      return document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(function (x) { setTimeout(x, 1000); })]).then(function () { return r; }) : r;
    });
  }

  // ---- 文字の分類 ----
  var ROTATE = 'ー－―‐〜～…‥（）「」『』〔〕【】＜＞〈〉《》―=＝-~()[]';
  var PUNCT = '。、．，';
  var SMALL = 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ';

  // 句の文字列 → 1 文字ずつの配列 (空白は半角アキとして残す)
  function splitChars(s) {
    return Array.from(String(s || '').trim()).map(function (c) {
      return /\s/.test(c) ? ' ' : c;
    });
  }
  // 1 行ぶんの縦の長さ (em 単位)
  function columnEm(kuList) {
    var em = 0, n = 0;
    kuList.forEach(function (ku) {
      var cs = splitChars(ku);
      if (!cs.length) return;
      if (n++) em += KU_GAP;
      cs.forEach(function (c) { em += c === ' ' ? ADV * 0.5 : ADV; });
    });
    return em;
  }

  // 1 文字を縦書きのマス (中心 cx, cy) に描く
  function drawGlyph(ctx, c, cx, cy, fs) {
    if (ROTATE.indexOf(c) >= 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(c, 0, 0);
      ctx.restore();
    } else if (PUNCT.indexOf(c) >= 0) {
      ctx.fillText(c, cx + fs * 0.6, cy - fs * 0.55); // 右上寄せ
    } else if (SMALL.indexOf(c) >= 0) {
      ctx.fillText(c, cx + fs * 0.1, cy - fs * 0.1);  // 小書き仮名は右上へ少し
    } else {
      ctx.fillText(c, cx, cy);
    }
  }

  // 縦 1 行を描く。x は行の中心、y は上端。描き終えた下端の y を返す
  function drawColumn(ctx, kuList, x, y, fs, weight) {
    ctx.font = (weight || BODY_WEIGHT) + ' ' + fs + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var n = 0;
    kuList.forEach(function (ku) {
      var cs = splitChars(ku);
      if (!cs.length) return;
      if (n++) y += KU_GAP * fs;
      cs.forEach(function (c) {
        if (c === ' ') { y += ADV * 0.5 * fs; return; }
        drawGlyph(ctx, c, x, y + ADV * fs / 2, fs);
        y += ADV * fs;
      });
    });
    return y;
  }

  // ---- 背景 ----
  function drawBackground(ctx, W, H, pal, layoutId) {
    var g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, pal.bg[0]);
    g.addColorStop(1, pal.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 周辺をほんのり暗く
    var r = Math.max(W, H);
    var v = ctx.createRadialGradient(W / 2, H / 2, r * 0.25, W / 2, H / 2, r * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    var rand = rng(20261031);
    var i, n;
    if (pal.grain === 'dark' || pal.grain === 'light') {
      // 紙の質感: 小さな点と短い繊維
      var col = pal.grain === 'dark' ? '60,45,25' : '255,250,240';
      n = Math.round(W * H / 350);
      for (i = 0; i < n; i++) {
        ctx.fillStyle = 'rgba(' + col + ',' + (0.025 + rand() * 0.06).toFixed(3) + ')';
        var s = rand() < 0.85 ? 1 : 2;
        ctx.fillRect(rand() * W, rand() * H, s, s);
      }
      ctx.lineWidth = 0.8;
      n = Math.round(W * H / 9000);
      for (i = 0; i < n; i++) {
        var x = rand() * W, y = rand() * H, a = rand() * Math.PI, len = 4 + rand() * 14;
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.03 + rand() * 0.05).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * len / 2 + (rand() - 0.5) * 4, y + Math.sin(a) * len / 2,
          x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
    } else if (pal.grain === 'gold') {
      // 金砂子: 明るい粒と少し暗い粒
      n = Math.round(W * H / 500);
      for (i = 0; i < n; i++) {
        var light = rand() < 0.6;
        ctx.fillStyle = light ? 'rgba(255,245,210,' + (0.15 + rand() * 0.35).toFixed(2) + ')'
                              : 'rgba(110,70,20,' + (0.05 + rand() * 0.08).toFixed(2) + ')';
        var ss = rand() < 0.9 ? 1.2 : 2.4;
        ctx.fillRect(rand() * W, rand() * H, ss, ss);
      }
    }

    // 短冊は上下に打曇り風の帯
    if (layoutId === 'tanzaku') {
      var t = ctx.createLinearGradient(0, 0, 0, 170);
      t.addColorStop(0, hexA(pal.accent, 0.28));
      t.addColorStop(1, hexA(pal.accent, 0));
      ctx.fillStyle = t;
      ctx.fillRect(0, 0, W, 170);
      var b = ctx.createLinearGradient(0, H - 130, 0, H);
      b.addColorStop(0, hexA(pal.accent, 0));
      b.addColorStop(1, hexA(pal.accent, 0.22));
      ctx.fillStyle = b;
      ctx.fillRect(0, H - 130, W, 130);
    } else {
      // 色紙・カードは内側に細い枠
      var inset = layoutId === 'card' ? 24 : 36;
      ctx.strokeStyle = hexA(pal.accent, 0.45);
      ctx.lineWidth = 2;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexA(pal.accent, 0.25);
      ctx.strokeRect(inset + 7, inset + 7, W - (inset + 7) * 2, H - (inset + 7) * 2);
    }

    if (pal.petals) drawPetals(ctx, W, H, layoutId);
  }

  // 桜の花びら (先に切れ込みのある涙形)
  function drawPetals(ctx, W, H, layoutId) {
    var rand = rng(4417);
    var base = Math.min(W, H) * (layoutId === 'tanzaku' ? 0.05 : 0.03);
    var n = layoutId === 'tanzaku' ? 9 : 8;
    for (var i = 0; i < n; i++) {
      // 文字にかかりにくいよう端寄りに置く
      var x, y;
      if (layoutId === 'tanzaku') {
        x = rand() < 0.5 ? W * (0.03 + rand() * 0.08) : W * (0.84 + rand() * 0.12);
        y = H * (0.05 + rand() * 0.9);
      } else {
        x = rand() < 0.5 ? W * (0.03 + rand() * 0.09) : W * (0.88 + rand() * 0.09);
        y = H * (0.08 + rand() * 0.84);
        if (rand() < 0.35) {
          // 上下の余白へ。下はサイト名 (中央) を避ける
          var top = rand() < 0.5;
          x = W * (top ? 0.1 + rand() * 0.8 : (rand() < 0.5 ? 0.1 + rand() * 0.22 : 0.68 + rand() * 0.22));
          y = top ? H * 0.06 : H * 0.92;
        }
      }
      var s = base * (0.6 + rand() * 0.6);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rand() * Math.PI * 2);
      ctx.globalAlpha = 0.45 + rand() * 0.4;
      var gr = ctx.createLinearGradient(0, -s, 0, s);
      gr.addColorStop(0, '#fbe3ea');
      gr.addColorStop(1, '#eba3b6');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(0, s);                                        // 付け根
      ctx.bezierCurveTo(-s * 0.9, s * 0.3, -s * 0.7, -s * 0.8, -s * 0.18, -s); // 左の縁
      ctx.lineTo(0, -s * 0.72);                                // 切れ込み
      ctx.lineTo(s * 0.18, -s);
      ctx.bezierCurveTo(s * 0.7, -s * 0.8, s * 0.9, s * 0.3, 0, s);            // 右の縁
      ctx.fill();
      ctx.restore();
    }
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) + ',' +
      parseInt(h.substr(4, 2), 16) + ',' + a + ')';
  }

  // ---- 雅号とサイト名 ----
  // 雅号は縦書きで、下端 bottom にそろえる。落款 (sealSize > 0) があれば雅号の下に押し、雅号はその分だけ上げる
  function drawAuthor(ctx, author, x, bottom, fs, maxLen, pal, sealSize) {
    var name = String(author || '').trim();
    if (!name) return;
    var gap = sealSize ? Math.round(sealSize * 0.28) : 0;
    var nameBottom = bottom - (sealSize ? sealSize + gap : 0);
    var em = columnEm([name]);
    var f = Math.min(fs, (maxLen - (sealSize ? sealSize + gap : 0)) / em);
    ctx.fillStyle = hexA(pal.ink, 0.88);
    drawColumn(ctx, [name], x, nameBottom - em * f, f, 400);
    if (sealSize) drawSeal(ctx, name, x, bottom - sealSize, sealSize);
  }

  // 落款の大きさ (雅号の文字の大きさから。雅号が空なら 0)
  function sealSizeOf(author, aFs, on) {
    return on && sealChars(author).length ? Math.round(aFs * 1.4) : 0;
  }
  // 雅号の先頭 1〜2 字 (空白・記号は飛ばす)
  function sealChars(author) {
    return Array.from(String(author || '')).filter(function (c) { return /[^\s・.,、。!！?？\-ー－()（）「」『』]/.test(c); }).slice(0, 2);
  }

  // 朱の角印 (白抜き・縦書き)。中心 cx、上端 top、一辺 size。
  // 別の canvas に描いてから貼る (角の欠け・かすれは destination-out で地を抜く)
  var SEAL_RED = '#c43c2c';
  function drawSeal(ctx, author, cx, top, size) {
    var chars = sealChars(author);
    if (!chars.length) return;
    var k = 3;                       // 小さな印でも欠けがきれいに出るよう 3 倍で描く
    var S = Math.round(size * k);
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var rand = rng(chars.join('').charCodeAt(0) * 131 + (chars[1] ? chars[1].charCodeAt(0) : 7));
    // 地の朱。縁を少し揺らして手押しらしく
    g.fillStyle = SEAL_RED;
    g.beginPath();
    var j = function () { return (rand() - 0.5) * S * 0.025; };
    g.moveTo(j(), j());
    g.lineTo(S / 2 + j(), j());
    g.lineTo(S + j(), j());
    g.lineTo(S + j(), S / 2 + j());
    g.lineTo(S + j(), S + j());
    g.lineTo(S / 2 + j(), S + j());
    g.lineTo(j(), S + j());
    g.lineTo(j(), S / 2 + j());
    g.closePath();
    g.fill();
    // 内側の細い枠 (白抜き)
    var pad = S * 0.075;
    g.strokeStyle = '#fff6ec';
    g.lineWidth = S * 0.035;
    g.strokeRect(pad, pad, S - pad * 2, S - pad * 2);
    // 文字 (白抜き)。2 字は縦に並べる
    g.fillStyle = '#fff6ec';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var inner = S - pad * 2;
    var weight = BODY_WEIGHT >= 500 ? 700 : 400;
    if (chars.length === 1) {
      g.font = weight + ' ' + Math.round(inner * 0.74) + 'px ' + FONT_STACK;
      g.fillText(chars[0], S / 2, S / 2 + inner * 0.02);
    } else {
      var fs2 = Math.round(inner * 0.43);
      g.font = weight + ' ' + fs2 + 'px ' + FONT_STACK;
      g.fillText(chars[0], S / 2, S / 2 - inner * 0.235);
      g.fillText(chars[1], S / 2, S / 2 + inner * 0.235);
    }
    // 角の欠けとかすれ
    g.globalCompositeOperation = 'destination-out';
    var corners = [[0, 0], [S, 0], [S, S], [0, S]];
    var chip = Math.floor(rand() * 4);
    [chip, (chip + 2) % 4].forEach(function (ci, n) {
      var p = corners[ci], r = S * (n ? 0.05 : 0.085);
      g.beginPath();
      g.moveTo(p[0], p[1]);
      g.arc(p[0], p[1], r, 0, Math.PI * 2);
      g.fill();
    });
    for (var i = 0; i < 70; i++) {
      // 縁寄りに小さな点を散らす
      var edge = Math.floor(rand() * 4), t = rand() * S, d = Math.pow(rand(), 2.2) * S * 0.12;
      var x = edge === 0 ? t : edge === 1 ? S - d : edge === 2 ? t : d;
      var y = edge === 0 ? d : edge === 1 ? t : edge === 2 ? S - d : t;
      g.globalAlpha = 0.35 + rand() * 0.6;
      g.beginPath();
      g.arc(x, y, S * (0.004 + rand() * 0.012), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = 0.93;
    ctx.drawImage(c, cx - size / 2, top, size, size);
    ctx.restore();
  }
  function drawSiteName(ctx, W, y, fs, pal) {
    var name = (WAKA.site && WAKA.site.name) || '和歌メイカー';
    ctx.font = '400 ' + fs + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = hexA(pal.ink, 0.4);
    ctx.fillText(name, W / 2, y);
  }

  // ---- 意味 (横書き・小さめ) ----
  var NO_HEAD = '、。，．）」』〕】ゝゞーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ!?！？';
  // maxW に収まるよう 1 文字ずつ折り返す (行頭に句読点・小書き仮名を置かない)。maxLines を超えたら末尾を「…」
  function wrapMeaning(ctx, text, maxW, maxLines) {
    var cs = Array.from(String(text || '').replace(/\s+/g, ' ').trim());
    var lines = [], cur = '';
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      if (cur && ctx.measureText(cur + c).width > maxW && NO_HEAD.indexOf(c) < 0) {
        lines.push(cur);
        cur = c === ' ' ? '' : c;
      } else cur += c;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = Array.from(last).slice(0, -1).join('');
      lines[maxLines - 1] = last.replace(/[、。，．\s]+$/, '') + '…';
    }
    return lines;
  }
  // 意味の行を組む。戻り値 {lines, fs, lh, top} (top = 1 行目の上端)。意味が無ければ null
  function layoutMeaning(ctx, text, o) {
    text = String(text || '').trim();
    if (!text || !o.mean) return null;
    var m = o.mean;
    ctx.font = '400 ' + m.fs + 'px ' + FONT_STACK;
    var lines = wrapMeaning(ctx, text, m.fs * m.cols, m.lines);
    if (!lines.length) return null;
    var lh = m.fs * m.lh;
    return { lines: lines, fs: m.fs, lh: lh, top: m.bottom - lines.length * lh };
  }
  function drawMeaning(ctx, W, ml, pal) {
    ctx.font = '400 ' + ml.fs + 'px ' + FONT_STACK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hexA(pal.ink, 0.78);
    ml.lines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, ml.top + ml.lh * (i + 0.5));
    });
  }

  // ---- レイアウト別 ----
  function kuOf(poem) {
    var ku = (poem && poem.ku) || [];
    var kana = (poem && poem.kana) || [];
    var out = [];
    for (var i = 0; i < 5; i++) out.push(String(ku[i] || kana[i] || '').trim());
    return out;
  }

  function layoutTanzaku(ctx, W, H, ku, poem, pal, meaning, seal) {
    var top = 220, bottom = H - 210;
    var upper = ku.slice(0, 3), lower = ku.slice(3, 5);
    var drop = 2.2; // 下の句を下げる量 (em)
    var avail = bottom - top;
    var fs = Math.min(80, avail / Math.max(columnEm(upper), 1), avail / Math.max(columnEm(lower) + drop, 1));
    var xU = W * 0.69, xL = W * 0.45;
    ctx.fillStyle = pal.ink;
    drawColumn(ctx, upper, xU, top, fs);
    drawColumn(ctx, lower, xL, top + drop * fs, fs);
    drawAuthor(ctx, poem.author, W * 0.23, bottom, fs * 0.55, avail * 0.45, pal, sealSizeOf(poem.author, fs * 0.55, seal));
    drawSiteName(ctx, W, H - 48, 22, pal);
  }

  // 5 行を右から左へ。offsets は各行の下げ量 (em)
  // meaning があれば下部に横書きで置き、本文の下端が重なるときは本文を上へずらす (最大 o.mean.maxLift)
  function layoutFive(ctx, W, H, ku, poem, pal, o, meaning, seal) {
    var avail = o.bottom - o.top;
    var fs = o.base;
    ku.forEach(function (k, i) {
      var em = columnEm([k]);
      if (em) fs = Math.min(fs, avail / (em + o.offsets[i]));
    });
    var step = Math.min(o.step, fs * 1.8); // 字が小さくなったら行間も詰める
    fs = Math.min(fs, step / 1.3);
    // 各行の x (右端の行を 0 とした相対値) を決めてから全体を左右中央に置く
    var xs = [], x = 0;
    for (var i = 0; i < 5; i++) {
      xs.push(x);
      x -= step + (i === 2 ? o.breakGap : 0); // 上の句と下の句の間を少し広く
    }
    var hasAuthor = !!String(poem.author || '').trim();
    var aFs = fs * 0.55;
    var xA = xs[4] - Math.min(o.authorGap, step * 0.95);
    var sealSize = hasAuthor ? sealSizeOf(poem.author, aFs, seal) : 0;
    var left = hasAuthor ? xA - Math.max(aFs, sealSize) / 2 : xs[4] - fs / 2;
    var right = fs / 2;
    var shift = W / 2 - (left + right) / 2;
    // 意味を入れるときは、本文の実際の下端 (雅号を含む) と意味の上端が重ならないよう上へずらす
    var lift = 0;
    var ml = layoutMeaning(ctx, meaning, o);
    if (ml) {
      var bodyBottom = 0;
      ku.forEach(function (k, i) {
        var em = columnEm([k]);
        if (em) bodyBottom = Math.max(bodyBottom, o.top + (o.offsets[i] + em) * fs);
      });
      if (hasAuthor) bodyBottom = Math.max(bodyBottom, o.bottom);
      lift = Math.max(0, Math.min(o.mean.maxLift, bodyBottom + o.mean.gap - ml.top));
    }
    ctx.fillStyle = pal.ink;
    ku.forEach(function (k, i) {
      drawColumn(ctx, [k], xs[i] + shift, o.top - lift + o.offsets[i] * fs, fs);
    });
    drawAuthor(ctx, poem.author, xA + shift, o.bottom - lift, aFs, avail * 0.6, pal, sealSize);
    if (ml) drawMeaning(ctx, W, ml, pal);
    drawSiteName(ctx, W, o.siteY, o.siteFs, pal);
  }

  var LAYOUT_FN = {
    tanzaku: layoutTanzaku,
    // mean: 意味の文字 fs・1 行の字数 cols・最大行数 lines・行の高さ lh (倍率)・下端 bottom・本文とのアキ gap・本文を上げる上限 maxLift
    shikishi: function (ctx, W, H, ku, poem, pal, meaning, seal) {
      layoutFive(ctx, W, H, ku, poem, pal, {
        top: 170, bottom: 1010, base: 88, step: 150, breakGap: 10,
        authorGap: 110, offsets: [0, 1.6, 0.5, 2.2, 0.9], siteY: H - 62, siteFs: 26,
        mean: { fs: 27, cols: 30, lines: 3, lh: 1.5, bottom: H - 98, gap: 26, maxLift: 96 }
      }, meaning, seal);
    },
    card: function (ctx, W, H, ku, poem, pal, meaning, seal) {
      layoutFive(ctx, W, H, ku, poem, pal, {
        top: 78, bottom: 548, base: 62, step: 104, breakGap: 26,
        authorGap: 98, offsets: [0, 0.6, 0.2, 0.8, 0.4], siteY: H - 40, siteFs: 20,
        mean: { fs: 17, cols: 30, lines: 2, lh: 1.45, bottom: H - 66, gap: 14, maxLift: 46 }
      }, meaning, seal);
    }
  };

  // ---- 描画本体 ----
  function draw(canvas, poem, options) {
    poem = poem || {};
    options = options || {};
    var lay = find(layouts, options.layout);
    var pal = find(palettes, options.palette);
    var scale = options.scale > 0 ? options.scale : 1;
    var ku = kuOf(poem);
    var siteName = (WAKA.site && WAKA.site.name) || '和歌メイカー';
    // 短冊には意味を描かない (狭いため)
    var meaning = lay.id === 'tanzaku' ? '' : String(options.meaning || '').trim();
    var allText = ku.join('') + String(poem.author || '') + siteName + meaning + '…';

    return waitFonts(options.font, allText).then(function (used) {
      FONT_STACK = used.os ? OS_MINCHO : stackOf(used.font);
      BODY_WEIGHT = used.font.weight;
      canvas.__wakaFont = used.os ? 'os' : used.font.id;
      var W = lay.w, H = lay.h;
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawBackground(ctx, W, H, pal, lay.id);
      LAYOUT_FN[lay.id](ctx, W, H, ku, poem, pal, meaning, !!options.seal);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return canvas;
    });
  }

  // ---- 保存 ----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function filename() {
    var d = new Date();
    return 'waka_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + '.png';
  }
  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  // 新しいタブに画像を出す (長押しで保存してもらう)。ユーザー操作の中で同期的に呼ぶこと
  function openInNewTab(canvas) {
    var url;
    try { url = canvas.toDataURL('image/png'); } catch (e) { return false; }
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>和歌の画像</title><body style="margin:0;background:#f6f1e7;font-family:sans-serif;text-align:center">' +
      '<p style="margin:12px;color:#2b2b2b">画像を長押しして「写真に保存」してください</p>' +
      '<img src="' + url + '" style="max-width:100%;height:auto" alt="和歌の画像"></body>');
    w.document.close();
    return true;
  }

  // 戻り値 Promise<'download' | 'tab' | 'failed'>
  function download(canvas, name) {
    name = name || filename();
    var a = document.createElement('a');
    if (isIOS() || !('download' in a)) {
      return Promise.resolve(openInNewTab(canvas) ? 'tab' : 'failed');
    }
    return new Promise(function (resolve) {
      var done = function (href, revoke) {
        a.href = href;
        a.download = name;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
        resolve('download');
      };
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (blob) done(URL.createObjectURL(blob), true);
            else done(canvas.toDataURL('image/png'), false);
          }, 'image/png');
        } else {
          done(canvas.toDataURL('image/png'), false);
        }
      } catch (e) {
        resolve('failed');
      }
    });
  }

  WAKA.render = {
    draw: draw,
    layouts: layouts.map(pick),
    palettes: palettes.map(pick),
    fonts: fonts.map(pick),
    download: download,
    openInNewTab: openInNewTab,
    filename: filename,
    toBlob: function (canvas) {
      return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
    }
  };
  function pick(o) { return { id: o.id, name: o.name, description: o.description }; }
})();
