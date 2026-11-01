# 和歌メーカー

誰でも気軽に和歌（五・七・五・七・七）を作って、縦書きの画像にして、X で共有できる Web サイト。
制作: 雨峰あまね。素の HTML/CSS/JS だけで、ビルドもサーバーも不要です。

- 今日のお題 … かんたんの最初に、その日の「題材 × 気持ち」（日本時間の日付で決まり、誰でも同じ）。タップでそのお題の候補へ。X 共有で `#和歌メーカー_今日のお題` を付けられる
- かんたん（`#/easy`、最初の画面）… 「いつ？ → 何を見た？ → どんな気持ち？」を 1 画面 1 問のステップで選ぶだけで候補の歌が 3 首できる
  （スマホは横スワイプで見くらべ）。題材はグループ折りたたみ＋検索。「穴埋め」「ふだんの言葉から」は最初の質問の上のリンクから。
  句をタップして「ほかの言い方」（意味つき）に替えたり、「自分の言葉で書く」で書きかえたりして仕上げる。候補と仕上げには句の意味をつないだ「大意」が付く。
  初回だけ 3 行の案内を出す。スマホでは各画面の主ボタン（一首つくる・これにする・できた！など）が下タブの直上に固定
- シャッフル（`#/mix`、旧 組み合わせ）… 用意された句パーツをシャッフルして一首に（大意つき）
- じっくり（`#/compose`、旧 手作り）… 5 句を入れると読みを推定して音数を数える。歌ことば辞典・お手本つき
- 作品帳（`#/gallery`）… 端末内（localStorage）に保存（意味・ひとことも）。JSON で書き出し／読み込み
- できた！ … プレビューの直下に「画像を保存」「X で共有」。画像を保存すると作品帳にも自動で入る（同じ歌は二重に保存しない）。短冊・色紙・横長カード、本文コピー。「意味・ひとこと」を書きかえられ、本文コピーには意味も付く（X の文面には入れない）。
  「画像に意味を入れる」をオンにすると色紙・横長カードの下部に小さく入る（短冊には入らない）。
  画像の書体は 明朝 / 古風な明朝 / 行書風 から（選んだときに Google Fonts を読む。読めなければ明朝）。雅号の下に朱の落款（雅号の先頭 1〜2 字）を押せる（既定オン）
- みんなの和歌（`#/minna`）… 完成画面の「みんなの和歌に投稿」で歌を公開し、みんなの歌を縦書きカードで新着順に見られる（画像にする・なぞる・自分の投稿は取り下げ）。
  受け口は Google スプレッドシート + Apps Script（`gas/Code.gs`）。設置手順は [docs/minna-setup.md](docs/minna-setup.md)、できた URL を `data/site.js` の `minna.api` に入れる（空のあいだはタブも投稿ボタンも出ない）
- 使い方（`#/help`）… 作り方のほか「和歌の基礎」（句切れ・枕詞・掛詞・本歌取り・字余り、古歌の例つき）
- ホーム画面に追加（PWA）… http(s) で開くと Service Worker（ネット優先、オフラインのときだけキャッシュ）が入り、一度開いたページはオフラインでも開ける
- キーボードだけでも操作できる（Tab で全部の操作に届く、タブ・切替・候補は ←→、モーダルは Esc で閉じる）。保存できない環境（プライベートモード等）では最初に案内を出し、その場では動く

設計の正は [DESIGN.md](DESIGN.md)。

## ローカルで動かす

いちばん簡単なのは `index.html` をダブルクリック（`file://` でも動きます）。

ローカルサーバーで確認したいとき（Node.js が必要）:

```powershell
# PowerShell で
.\start.ps1                    # サーバーを起動して http://localhost:5530/ を開く
# または
node tools/serve.mjs           # ポート 5530（node tools/serve.mjs 8080 で変更可）
```

外部通信は Google Fonts と kuromoji.js（読み推定、jsDelivr）だけ。どちらも無くても動きます
（読みは手入力、書体は OS の明朝になります）。

Service Worker（`sw.js`）は http(s) のときだけ登録されます。`file://` では登録しません（そのままで動きます）。
ローカルサーバーで確認したあと古い表示が残るときは、DevTools → Application → Service Workers で Unregister するか、
`node tools/bump-version.mjs` で版を上げてください（sw.js は network-first なので、通信できれば常に新しいファイルが出ます）。

## ファイル

| パス | 役割 |
|---|---|
| `index.html` | 1 ページ構成。`<script src>` を data → js の順に読む |
| `css/app.css` | 見た目 |
| `js/mora.js` | 音数カウント（純関数、Node からも読める） |
| `js/reading.js` | 読み推定（kuromoji の遅延読込とフォールバック） |
| `js/store.js` | localStorage（`waka.draft` / `waka.gallery` / `waka.prefs`。かんたんモードは `waka.easy`） |
| `js/easy-gen.js` | かんたんモードの歌の生成（純関数、Node からも読める） |
| `js/components.js` | トースト・2 段階ボタン・モーダル・音数メーター・1 句の入力行（`ui.kuRow`）・完成画面 |
| `js/render.js` / `js/share.js` | 画像生成 / 共有 |
| `js/view-*.js` | 各画面 |
| `js/app.js` | 起動とハッシュルーティング |
| `data/*.js` | サイト情報・歌ことば・枕詞・句パーツ・お手本・かんたんモード（`data/easy.js`） |
| `data/readings.js` | 歌読み優先の小辞書（「夜=よ」「今日=けふ」など。読み推定が kuromoji より先に引く） |
| `assets/og.png` | OGP 画像（1200×630） |
| `assets/icon-192.png` / `icon-512.png` / `apple-touch-icon.png` | ホーム画面用アイコン（朱の短冊マーク） |
| `manifest.webmanifest` / `sw.js` | PWA（ホーム画面に追加・オフライン）。sw.js は network-first |
| `robots.txt` / `sitemap.xml` | 検索エンジン向け（URL は `data/site.js` と同じ） |
| `tools/validate.mjs` | データ検査（`node tools/validate.mjs`） |
| `_dev/test-easy-gen.mjs` | かんたんモードの生成と大意の組み立ての単体テスト（`node _dev/test-easy-gen.mjs`） |
| `tools/serve.mjs` | ローカル確認用サーバー |
| `tools/bump-version.mjs` | `index.html` の `?v=N` を一括で +1、`sw.js` の `CACHE_VERSION` も同じ数に（`--dry` で確認だけ） |

## データの足し方

`data/*.js` は `window.WAKA.xxx = [...]` の形です（fetch を使わないため）。スキーマは DESIGN.md 4 章。

- 歌ことば `data/words.js` … 末尾に追加し、`id` は連番で既存の番号を変えない。`mora` は `kana` の音数。
- 枕詞 `data/makura.js` / 句パーツ `data/parts.js` / お手本 `data/samples.js` も同様。
- 句（`data/easy.js` の phrases・`data/parts.js`）には意味の断片 `m`（現代語 5〜15 字、末尾に句読点なし）を必ず付ける。順に「、」でつないで大意になる（DESIGN 10.1）。
- 読みの補正 `data/readings.js` … `'表層形': 'よみ'` を足す。漢字 1 字で終わる語は形態素の境目でしか効かないので、送り仮名つきの形（`'思ふ'`、`'惜し'`）で書くと確実。
- 追加したら `node tools/validate.mjs` で音数・重複・件数を確認する。

## 公開（GitHub Pages）

リポジトリ `amemineamane/waka-maker`、main ブランチのルートをそのまま配信します（ビルドなし）。

初回だけ:

```powershell
cd D:\waka_maker
git init -b main
git config user.name  "amemineamane"
git config user.email "197556632+amemineamane@users.noreply.github.com"
git add -A
git commit -m "和歌メーカー 初版"
git remote add origin https://github.com/amemineamane/waka-maker.git
git push -u origin main
```

GitHub の Settings → Pages で「Deploy from a branch」→ `main` / `/ (root)` を選ぶ。
数分後に https://amemineamane.github.io/waka-maker/ で公開されます。
ルートの空ファイル `.nojekyll` は消さないでください（Jekyll を通さずそのまま配信するため）。

更新のたびに:

```powershell
node tools/validate.mjs        # データを触ったとき
node _dev/test-easy-gen.mjs    # data/easy.js や js/easy-gen.js を触ったとき
node tools/bump-version.mjs    # ?v=N を +1（ブラウザ・Pages のキャッシュを切る）
git add -A
git commit -m "変更の内容"
git push
```

- OGP（`index.html` の meta）は `data/site.js` の値を直書きしています。サイト名・説明・URL を変えたら両方を直す。
- OGP 画像 `assets/og.png` は 1200×630。差し替えても URL が同じだと X 側のキャッシュが残るので、必要ならファイル名を変えて meta も直す。
- `_dev/`（確認用スクショ・テストページ）と `tools/` は置いても害はありません（sw.js の precache には入れていません）。
- **Service Worker の注意**: 公開後に js / css / data を直したら、必ず `node tools/bump-version.mjs` を実行してから push する（`?v=N` と `sw.js` の `CACHE_VERSION` が上がり、古いキャッシュが消える）。
  新しいファイルを足したときは `sw.js` の `PRECACHE` にも足す（足さなくても動くが、一度開くまではオフラインで使えない）。
  sw.js を消したいときは、中身を空にせず「install で skipWaiting・activate で自分のキャッシュを消して `self.registration.unregister()`」する版を一度配信してから消す（ファイルだけ消すと古い SW が残る）。
- 検索エンジン向けに `robots.txt` と `sitemap.xml` を置いています。URL を変えたら `data/site.js`・`index.html` の meta / canonical / JSON-LD・`robots.txt`・`sitemap.xml` をまとめて直す。
- **みんなの和歌**: 設置は [docs/minna-setup.md](docs/minna-setup.md)。`data/site.js` の `minna: { api: '' }` に GAS の /exec の URL を入れて `bump-version` → push。
  投稿の管理はスプレッドシートの `hidden` 列に 1 を書くだけ（20 秒ほどで一覧から消える）。
  **配信での使い方**: `https://amemineamane.github.io/waka-maker/#/minna` を OBS のブラウザソースで開けば、視聴者の投稿がそのまま映る（表示中は 60 秒ごとに新着を先頭に足す）。
  今日のお題の歌だけを映すときは `#/minna/odai`（または画面の「今日のお題だけ」）。
- アクセス解析を使うときは `data/site.js` の `analytics.ga4` に ID を入れる（空なら読み込まない）。
