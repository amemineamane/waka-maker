/* =====================================================================
 * sw.js — Service Worker（ホーム画面に追加＋オフライン、DESIGN 12-5）
 * ---------------------------------------------------------------------
 * 【方針：network-first（ネット優先・失敗したらキャッシュ）】
 *   毎回ネットを先に見に行き、取れたらそれを返しつつキャッシュを更新する。
 *   オフラインのときだけキャッシュを返す。データや画面を直したときに
 *   古いキャッシュが出続ける事故を避けるため（kobun_app と同じ方針）。
 * 【バージョン】
 *   CACHE_VERSION は index.html の ?v=N と同じ数。`node tools/bump-version.mjs` が一緒に書き換える。
 *   変わると古いキャッシュは activate で消える。network-first なので新しい SW はすぐ交代してよい
 *   （skipWaiting。読んでいる途中の画面の中身が入れ替わることはない）。
 * 【対象】
 *   同じオリジンの GET だけ。Google Fonts・kuromoji（jsDelivr、辞書が大きい）・解析は素通し。
 *   みんなの和歌の受け口（script.google.com → script.googleusercontent.com、DESIGN 14）も
 *   キャッシュせずそのまま通す（一覧は常に新しいものを、投稿の POST はもともと対象外）。
 * 【file:// では動かない】
 *   Service Worker は http/https でしか登録できない。js/app.js が protocol を見て登録しない。
 * ===================================================================== */
'use strict';

/* tools/bump-version.mjs が書き換える行（形を変えないこと） */
const CACHE_VERSION = '10';
const CACHE_NAME = 'waka-maker-v' + CACHE_VERSION;

/* インストール時に取っておくファイル（?v= は付けない。照合は ignoreSearch）。ファイルを足したらここにも足す */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './data/site.js',
  './data/words.js',
  './data/makura.js',
  './data/parts.js',
  './data/samples.js',
  './data/readings.js',
  './data/easy.js',
  './data/easy-modern.js',
  './js/mora.js',
  './js/reading.js',
  './js/store.js',
  './js/components.js',
  './js/render.js',
  './js/share.js',
  './js/easy-gen.js',
  './js/view-easy.js',
  './js/view-compose.js',
  './js/view-mix.js',
  './js/view-gallery.js',
  './js/view-minna.js',
  './js/view-help.js',
  './js/view-terms.js',
  './js/app.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE_NAME);
    // 1 件ずつ入れる（1 つ失敗しても全体を止めない）
    await Promise.allSettled(PRECACHE.map(function (url) {
      return cache.add(new Request(url, { cache: 'reload' }));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (key) {
      // このアプリの古い版だけ消す
      if (key.indexOf('waka-maker-') === 0 && key !== CACHE_NAME) return caches.delete(key);
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (/(^|\.)script\.google(usercontent)?\.com$/.test(url.hostname)) return;   // みんなの和歌の API は素通し
  if (url.origin !== self.location.origin) return;   // 外部（フォント・kuromoji・解析）は素通し
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch(function () { /* 容量不足などは無視 */ });
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // ハッシュルーティングなので、どの画面も実体は index.html
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html', { ignoreSearch: true });
      if (index) return index;
    }
    throw err;
  }
}
