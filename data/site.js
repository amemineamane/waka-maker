// サイト設定。DESIGN.md 4.1。
window.WAKA = window.WAKA || {};
window.WAKA.site = {
  name: '和歌メイカー',
  url: 'https://amemineamane.github.io/waka-maker/',
  description: '質問に答えるだけで和歌（五・七・五・七・七）が一首できる無料サイト。句ごとの言いかえ、音数の自動カウント、短冊・色紙の縦書き画像で X に共有できます',
  hashtags: ['和歌メイカー'],
  author: {
    name: '雨峰あまね',
    role: 'ほんのり古典系 VTuber',
    x: 'https://x.com/AmemineAmane',
    youtube: 'https://www.youtube.com/@AmemineAmane',
    booth: 'https://amemineamane.booth.pm/'
  },
  analytics: { ga4: '' },
  // みんなの和歌（DESIGN 14）。GAS ウェブアプリの /exec の URL。空ならタブも投稿ボタンも出さない
  minna: { api: 'https://script.google.com/macros/s/AKfycbwywXrzL0Su4vKJ9mSL37v0rtIPIyXMkZf2Hn7BCCwpetve-UtU1kN_bNasrsgcO2X5Pg/exec' }
};
