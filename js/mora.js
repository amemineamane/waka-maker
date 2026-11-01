/* =====================================================================
 * js/mora.js — 音数カウント（純関数）
 * ---------------------------------------------------------------------
 *   WAKA.mora.count(reading)       読み（ひらがな/カタカナ）の音数。仮名以外が残れば NaN
 *   WAKA.mora.judge(count, target) 目標音数との比較 → { status, diff }
 *                                  status: ok / jiamari1 / over / under / unknown
 *   WAKA.mora.toHira(text)         カタカナ → ひらがな
 *   WAKA.mora.isKanaOnly(text)     仮名と記号だけでできているか
 * ルールは DESIGN.md 3.3。DOM に触らないので Node からも使える
 * （tools/validate.mjs が sandbox で読み込む）。
 * ===================================================================== */
(function (root) {
  'use strict';

  // 0 音として数える小書き仮名（直前の文字と合わせて 1 音）
  var SMALL = 'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ';
  // 無視する文字：空白・句読点・記号（Unicode の P / S / Z / 制御文字）
  var IGNORE = /[\s\p{P}\p{S}\p{Z}\p{Cc}]/u;

  // 1 文字が 1 音の仮名か（ひらがな・カタカナ・ー・ゝゞヽヾ・ゐゑヰヱを含む）
  function isKanaChar(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 0x3041 && c <= 0x3096) return true;   // ぁ〜ゖ
    if (c >= 0x309D && c <= 0x309E) return true;   // ゝ ゞ
    if (c >= 0x30A1 && c <= 0x30FA) return true;   // ァ〜ヺ
    if (c >= 0x30FC && c <= 0x30FE) return true;   // ー ヽ ヾ
    return false;
  }

  function normalize(text) {
    // 半角カナなどを全角に揃える
    return String(text == null ? '' : text).normalize('NFKC');
  }

  function count(reading) {
    var s = normalize(reading);
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (SMALL.indexOf(ch) >= 0) continue;
      if (isKanaChar(ch)) { n++; continue; }
      if (IGNORE.test(ch)) continue;
      // 結合用の濁点・半濁点（゙ ゚）は数えない
      if (ch === '゙' || ch === '゚') continue;
      return NaN;   // 漢字・英数字などが残っている
    }
    return n;
  }

  function judge(n, target) {
    if (typeof n !== 'number' || isNaN(n)) return { status: 'unknown', diff: NaN };
    var diff = n - target;
    var status = diff === 0 ? 'ok' : diff === 1 ? 'jiamari1' : diff > 1 ? 'over' : 'under';
    return { status: status, diff: diff };
  }

  function toHira(text) {
    return normalize(text).replace(/[ァ-ヶヽヾ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0x60);
    });
  }

  function isKanaOnly(text) {
    return !isNaN(count(text));
  }

  var api = { count: count, judge: judge, toHira: toHira, isKanaOnly: isKanaOnly };

  if (root) {
    root.WAKA = root.WAKA || {};
    root.WAKA.mora = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
