/* =====================================================================
 * js/reading-worker.js — kuromoji を Web Worker で動かす（js/reading.js から使う）
 * ---------------------------------------------------------------------
 * 辞書の読み込み（XHR → gunzip → 配列化）は数秒かかり、主スレッドでやると
 * 画面が固まるので、ここ（別スレッド）で行う。http(s) のときだけ使われる。
 *   受け取る: { base }               … 最初に 1 回。kuromoji を読み込み辞書を作る
 *             { id, text }           … 形態素に分ける
 *   返す:     { type: 'ready' } / { type: 'error', message }
 *             { id, tokens } / { id, error }
 * ===================================================================== */
'use strict';

var tokenizer = null;

self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.base) {
    try {
      importScripts(m.base + 'build/kuromoji.js');
    } catch (e) {
      self.postMessage({ type: 'error', message: 'kuromoji を読み込めません' });
      return;
    }
    self.kuromoji.builder({ dicPath: m.base + 'dict/' }).build(function (err, tk) {
      if (err || !tk) { self.postMessage({ type: 'error', message: String(err || '辞書を読み込めません') }); return; }
      tokenizer = tk;
      self.postMessage({ type: 'ready' });
    });
    return;
  }
  if (m.id != null) {
    if (!tokenizer) { self.postMessage({ id: m.id, error: 'まだ準備中です' }); return; }
    try {
      self.postMessage({ id: m.id, tokens: tokenizer.tokenize(String(m.text || '')) });
    } catch (e) {
      self.postMessage({ id: m.id, error: String(e && e.message || e) });
    }
  }
};
