# 自律開発プロトコル

あなたは自律的に開発サイクルを回すエンジニアです。以下のループを厳守してください。

## 基本サイクル（PDCA）

### 1. PLAN（計画）
- タスクを受けたら、まず実装前に計画を立てる
- 影響範囲、変更ファイル、想定リスクを箇条書きで提示
- 不明点が3つ以上ある場合のみ質問。それ未満は自分で判断して進める
- 計画は最大10行以内に収める

### 2. DO（実装）
- 計画に従って一気に実装する
- 単一HTMLファイル構成（Supabase + Vercel）の規約を守る
- 変更後は必ず以下を実行：
  - `node --check <file>` で構文確認（HTMLは inline JS を抽出して検査）
  - 既存機能の回帰がないかgrepで確認
- 実装中に計画外の変更が必要になったら、その場で計画を更新して継続

### 3. CHECK（検証）
- 実装後、自分で以下をセルフレビュー：
  - [ ] 構文エラーなし
  - [ ] 既存のデータフロー（KPIカード等）を壊していない
  - [ ] Supabase RLS / 認証フローに影響なし
  - [ ] コンソールエラーが出ない想定か
- 問題があれば自動で修正してから報告

### 4. ACT（学習）
- ミスをしたら、即座にこのファイル（CLAUDE.md）の「失敗ログ」セクションに追記
- 形式：`- [日付] <何をやろうとして> <何を間違えた> → <次回の対策>`
- ユーザーから指摘された規約・好みも同様に追記

## 停止条件（ここでだけユーザーに確認する）

以下の場合のみループを止めて確認：
1. データベーススキーマの破壊的変更
2. 本番デプロイ（`vercel --prod`）
3. 既存ユーザーデータに影響する処理
4. 3回試して同じエラーが解決しない
5. APIキー等のシークレット操作

## 報告フォーマット

各サイクル終了時に以下を出力：
- ✅ 完了したこと（1-3行）
- 📝 CLAUDE.md に追記した学習（あれば）
- ⚠️ 残課題 / 次にやるべきこと
- 🔄 続行可否（「次のタスクに進めます」or「確認待ちです」）

## 禁止事項

- 「実装しました」だけで検証をスキップしない
- 計画なしでいきなりコードを書かない
- 同じエラーを2回以上繰り返さない（必ず学習を残す）
- ユーザーに過度に確認を求めない（停止条件以外は自走）

---

# 失敗ログ（自動追記される）

- [2026-04-28] 工数管理タブの `wf-panel-main` を表示しようとして `.wf-panel{display:none}` + `.wf-panel.active{display:block}` のクラス制御CSSを書いた / 一方で `switchSubtab()` は `style.display` を直接操作しており、初期表示時に `.active` クラスが一度も付かないため永久に非表示になった → CSSとJSで同じ要素の表示制御方式を混在させない。inline style で制御するなら CSS では `display:none` を強制しない。
- [2026-04-28] IIFE 内で `function renderAll()` を定義し直前で `WF.init = ...` などの代入を試した / `const WF = {...}` 宣言が後ろにあり一時的デッドゾーンで ReferenceError → const は宣言前に参照不可。先に const で WF を完全な形で宣言してから、それを直接 export する。後付けで属性を生やさない。
- [2026-04-28] index.html へ大規模なコード追加をしてコミット → push してから「動かない」とユーザー報告 / ブラウザでの動作確認を経ずに「実装完了」と報告した → 大規模な UI 追加時は最低限「DOMが描画される / 主要要素が見える / コンソールにエラーが出ない」を確認するまで「完了」と言わない。
- [2026-04-28] 工数管理セクションで `<input type="number">` を多用し、ネイティブの上下スピナーが目障りという指摘を受けた → 表組セルに数値入力を埋め込む際は `::-webkit-{outer,inner}-spin-button{appearance:none}` と `-moz-appearance:textfield` をスコープして必ず外す。
- [2026-04-29] 工数管理の人件費を年額1値で持っていたが、月次変動を捉えられない指摘 → 月次変動するデータは最初から月別配列で持つ。`cost`(年額) は `costMonthly[12]` から自動算出する派生値とし、UI も読み取り専用にして編集経路を一本化する。
- [2026-04-29] localStorage だけだと「複数デバイスで使ったら同期されない」要件を満たせない → 永続化は3層 (localStorage / BroadcastChannel / Supabase Realtime) を組み合わせる。同一ブラウザ別タブは BroadcastChannel、別デバイスは Supabase Realtime + 自動保存で対応。echo 防止のため自分の最近の保存(3秒以内)はスキップ。
- [2026-04-29] サマリーKPIカードを更新したくなったが、ユーザーは現状の財務数値表示を強く維持したかった → 既存KPIカードは絶対に置き換えず、新しい指標は「上または下に追加ブロック」として乗せる。先頭に乗せる場合は背景色を変えてセクションを分離する。
- [2026-04-29] 既存ダッシュボードの AI ブリーフィングが古いハードコード値で生成されていた → window.WF / window.EXPENSE などのオプショナルなモジュールから動的に指標を読み出し、prompt に注入する。各モジュールは window 直下に公開し、未読込時は graceful に空文字列でフォールバックする。
- [2026-04-29] モーダル要素を sec-workforce 内に配置 → 別タブから開けない（親が display:none だと子要素も全て非表示になる） → 全タブから開くべきモーダルやオーバーレイは必ずセクション外（body 直下相当）に配置し、CSS スコープも `#sec-xxx` ではなく素のクラスに統一する。
- [2026-04-29] BIZ × ROLES のグリッドで `colspan="4"` をハードコードしていたため、ROLES 数を 4→6 に増やしたら列ズレが発生 → 多次元の配列・行列を生成する箇所では `array.length` を必ず使い、固定値を埋め込まない。同種の cells/rows/cols/colspan/rowspan は全て array length 由来にする。
- [2026-04-29] チャット入出力時に `obj.prop.deep` のようなドット連鎖が markdown 自動リンク化で `[obj.prop.deep](http://obj.prop.deep)` に変換され構文エラーになる事案 → JS コードを Edit で書き込む際は `String(obj.prop)` などラップする / または変数に分割代入する形で出力し、自動リンク化を回避する。書込み後は必ず `node --check` で検出。
- [2026-06-09] HD管理を追加する際、仕様書には「Next.js/TypeScript/Tailwind/Recharts・src/utils・app/page.tsx」とあったが実態は単一HTML+バニラJS構成だった → 仕様のスタック記述を鵜呑みにせず、着手前に必ず package.json と find で実在を確認する。汎用テンプレ前提の指示はこのリポジトリの実態（public/index.html 単一ファイル）に翻訳して実装する。
- [2026-06-09] HDモジュールから `sbClient` / `_sbReady` / `currentYear` を参照する必要があった → 別 `<script>` ブロックでも classic script の top-level let/const はグローバル字句環境を共有するため参照可能。ただし定義順・未定義に備えて必ず `typeof X !== 'undefined' && X` でガードしてから使う（モジュール非依存・graceful フォールバック）。
- [2026-06-09] サブタブの表示制御で `.hd-panel{display:none}` + `.hd-panel.on{display:block}` の class 制御に統一し、JS は classList.toggle('on',...) のみで切替えた（過去の inline style と class 混在による永久非表示バグを回避）→ タブ/パネル表示は CSS class 一本化を徹底する。
- [2026-06-09] HD連結を最初「科目×金額」の単列表＋円単位＋インライン会社追加で作ったが、ユーザー要望は「科目｜会社A｜会社B｜…｜消去額｜連結合計」の会社別カラム＋千円単位＋モーダル追加だった → 財務テーブルは着手前に①単位(円/千円)②表の向き(単列集計 or 会社別カラム)③入出力UI(インライン or モーダル)を確認・確定する。連結表は会社別カラム＋消去額列＋合計列が既定と考える。
- [2026-06-09] 全タブから/特定タブからに関わらず、開閉するモーダルは `.sec` の外（body直下相当）に素クラスで配置し、`.on` で display を切替える。`.hd-modal{position:fixed;inset:0}` + `.hd-modal.on{display:flex}`。親が display:none になると子も消える問題を構造的に回避。
- [2026-06-09] HD単体（持株会社単体の財務三表）は月次財務と同一科目を独立IIFE `window.HDSOLO` で実装。多数の科目×12ヶ月×予算実績はセル単位テーブルではなく「年度ごとJSONBブロブ」(`holdings_solo` id=年度, data jsonb)で保持し year 単位 upsert/select。cells方式より実装が単純で、localStorage(全年度1ブロブ)へ即時保存しリロード耐性を確保。横長月次表は科目列を position:sticky で固定する。
- [2026-06-09] HD単体の科目カスタマイズは「グループ固定・科目のみ可変」のスキーマ駆動に。集計グループ(原価/販管費/入金/固定費/変動費/事業投資/財務収支/資産/負債/純資産)は固定配列、その中の科目を {id,label,sign?,hidden?} 配列で定義。科目は内部 id で管理し、入力値(data[year][stmt][mode][id])と id でひも付け→リネームしても値を保持、削除時のみ全年度の値を削除。財務収支は項目ごと sign(±1) で符号集計、非表示科目は集計から除外。スキーマは全年度共通で `holdings_solo` の特殊行 id='__schema__'(data=schema) に保存(別テーブル不要)。loadRemote で年度行とスキーマ行を id で振り分ける。

# プロジェクト固有ルール（neo_mg）

- 単一HTMLファイル構成（`public/index.html`）+ Vercel serverless（`api/*.js`）+ Supabase
- フロントは `@supabase/supabase-js` CDN 経由、`/api/db` がフォールバック
- 既存テーブルの RLS は `allow_all` に統一（認証フローは現状維持）
- 変更後は inline JS を抽出して `node --check` で構文確認すること
- 既存ダッシュボードの CSS 変数（`--bg`, `--text`, `--tc-green`, `--tc-red` 等）を踏襲
- 既存 UI 規約：`.card` `.dt` `.pa-toggle` `.metrics` `.btn` `.btn-p` `.btn-g` を再利用
- 既存タブ追加時は `sw()` 関数のフックと `tabOrder` 配列の更新を忘れない
- 大規模な機能追加は段階コミット（スキャフォールド → データ → 計算 → 描画 → 永続化）で進める
- ユーザーは編集が永続化されない UX を強く嫌う。主要な状態は localStorage に即時保存しリロード耐性を確保すること
- 表セル内の数値入力は必ずスプレッドシート風（スピナー除去）で統一する
- マルチデバイスを想定する機能は localStorage + BroadcastChannel + Supabase Realtime の3層で同期する
- 大型機能は main に直 push せず `feature/*` ブランチを切り、Vercel プレビューで確認後 main にマージする
- サマリーKPIカード (kpi-cash/kpi-rev/kpi-gp/kpi-opex/kpi-op/kpi-equity) は絶対に置き換えない。指標の追加は新ブロックを上または下に追加する形で行う
- 各機能モジュールは IIFE で `window.WF` `window.PAYROLL` `window.EXPENSE` `window.ExpenseSync` のように window 直下に公開し、相互参照は optional check (window.X && window.X.method) で行う
- 新規 SQL は別ファイルに分割 (`supabase_*.sql`) し、ユーザーが Dashboard で個別実行できるようにする
