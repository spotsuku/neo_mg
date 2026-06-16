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
- [2026-06-09] 経営状況の見せ方は「対象切替（連結/HD単独/子会社）」で、置き場所はHD管理の外＝新トップレベルタブ `#sec-gsummary`(window.GSUMMARY)。子会社単独は既存サマリー(NEO福岡=DB)を流用。連結は HD単独(HDSOLO)+NEO福岡(DB)+各社財務(HD)−内部取引 の簡易管理連結を「高位集計(売上/原価/販管費/営業利益/現金/純資産)」で metric 合算。重要: DB・HDSOLO・各社財務は全て千円単位(既存KPIの fmt万 が"千円単位"コメントで確認)なので桁変換不要。各モジュールは metric getter (HDSOLO.summary / HD.consolidatedMetrics) を window 公開し、GSUMMARY が optional check で集約。Chart.js は window.Chart を共有しつつ GSUMMARY 専用インスタンスを destroy→再生成で管理。既存サマリー/KPIカードは読み取りのみで一切変更しない。
- [2026-06-09] HD単体の科目カスタマイズは「グループ固定・科目のみ可変」のスキーマ駆動に。集計グループ(原価/販管費/入金/固定費/変動費/事業投資/財務収支/資産/負債/純資産)は固定配列、その中の科目を {id,label,sign?,hidden?} 配列で定義。科目は内部 id で管理し、入力値(data[year][stmt][mode][id])と id でひも付け→リネームしても値を保持、削除時のみ全年度の値を削除。財務収支は項目ごと sign(±1) で符号集計、非表示科目は集計から除外。スキーマは全年度共通で `holdings_solo` の特殊行 id='__schema__'(data=schema) に保存(別テーブル不要)。loadRemote で年度行とスキーマ行を id で振り分ける。

- [2026-06-12] ページ全体を「対象(エンティティ)」で切替える2階層ナビを導入。最上位=対象バー(`.entity-bar`: HD連結/HD単独/子会社NEO福岡)、第2階層=既存タブ。各 `.tab` に `data-ent`(空白区切りで複数可)と `data-tab` を付与し、`setEntity(ent)` が data-ent で表示タブをフィルタ→対象の先頭タブへ。現アクティブタブが対象内なら維持(neoのタブ復元を壊さない)。対象は `localStorage 'neo_entity'`(既定 group)で復元、タブ復元の後に適用して対象が支配する。gsummaryのスコープは対象バーが駆動(`GSUMMARY.setScope`、内部 `#gs-scope` トグルは非表示化)、HDサブタブは `HD.applyEntity(ent)` で出し分け(group=連結/会社/内部取引、solo=HD単体)。重要: 既存9タブ(月次財務/工数/人件費/経費/MF/シミュ等)はNEOのグローバルデータ(DB/WF/PAYROLL/EXPENSE)直結なので、HD単独に同粒度の運用タブを持たせるにはデータ層のエンティティ・スコープ化(大規模)が必要→段階導入(フェーズ1=ナビ土台、既存NEOは無改変)。

- [2026-06-13] AI経営相談(対話型)は独立IIFE `window.AICHAT`(フローティングチャット)で実装。`/api/chat`(Anthropic Claude, claude-sonnet-4-6)をマルチターンで利用。コンテキストは Anthropic の `system` で渡す→`api/chat.js` に `system` パススルーを追加(後方互換)。状況はDOM由来でスクレイプ(現在の対象=currentEntityに応じて neo は kpi-*/exec-*、group/solo は gs-kpi/gs-health/gs-alert)し、WF/EXPENSE はオプショナルに注入。setEntity が GSUMMARY.setScope→render を呼ぶため対象切替後は gs-* が埋まっている。メッセージは textContent で描画(XSS回避)。既存 genAI(ワンショット)とは別系統で非干渉。

- [2026-06-14] 工数管理(WF)/人件費(PAYROLL)/経費申請(EXPENSE)を会社別に分離。基本会社(NEO)は company_id='' (空文字, DEFAULT)で扱う(fiscal_data の NULL とは別運用)。workforce_versions は version_id UNIQUE → (company_id,version_id) UNIQUE へ、is_current の部分一意は会社ごとに変更(supabase_company_scope.sql)。api/db.js の load/save/delete/set_workforce_current・load/create_expense_request に company_id を追加。フロントは wfCompany()/expCompany()=currentCompanyId||'' で全API呼び出し・localStorage draftKey() を会社別に。WFは状態が常駐するため switchCompany→WF.reloadForCompany()(初期スナップショット_wfDefaultSnapshotで一旦リセット→対象会社で再init、データ無ければ既定値でbleed防止)。EXPENSE/PAYROLLはstate差し替えなのでrefresh/renderAllで足りる。移行SQL未実行だとSupabase同期のみ劣化しlocalStorageで動作。

- [2026-06-16] 商品別売上進捗ページを新規タブ `#sec-products`(window.PRODUCTS, IIFE)で追加。商品=会費(cfInFee+後方互換cfInMembership)/研修(cfInTraining)/イベント・その他(cfInEvent)。進捗は「年間目標(reportData.salesTargets に保存→saveDBでSupabase往復+localStorage即時)」と「月次予算(cf.budget)累積比」の両建て。DB[year].cfは読み取り専用で流用し既存KPI/CF/月次財務は無改変。タブ追加の定石: ①タブボタン(data-ent="neo solo" data-tab, onclick sw())②`<div class="sec" id="sec-xxx">`③sw()に描画フック④tabOrder配列に追加(DOMの.tab順と一致必須=index復元のため)⑤スピナー除去CSS `#sec-xxx input[type=number]`。Chartは _chart を destroy→再生成、色はCSS変数不可なのでgetComputedStyleで解決した値を渡す。年間目標は onchange(blur)で保存→render再描画(inputフォーカス喪失回避)。
- [2026-06-16] 月次財務(DB)・シミュレーション・工数管理(WF)で販管費科目がバラバラだったため正準12項目(人件費社保込み/業務委託費/支払い報酬/外注費/採用研修費/広告販促費/旅費交通費/通信費/会議交際費/賃料本社のみ/消耗品減価償却費/その他)に統一(方針A)。設計: ①単一の真実源 `const PL_OPEX_DEFS=[{key,label,group:'fixed'|'var'}]`(top-level, line~2362) + `PL_OPEX_KEYS`/`sumPLOpex(src,i)` を定義し、DB側の販管費合計/KPI(cumOpex,budOpex)/年間PL(renderAnnualPL)/科目別アラート/内訳チャート/営業損益行/PLチャート/別PLビュー(buildMetrics)/gsummary連結 を全てこの定数に集約。②MF会計取込ドメインは従来5キー(labor/outsource/adv/gaichu/other)のまま不変(逆算 other=CSV販管費合計−4科目、マッピング表、プレビュー trial_pl、PL_KEYS_SET、commit)→新7キーは手入力・既定0。③新7キー(reward/recruit/travel/comm/entertain/rent/supplies)を makeEmptyYearStruct と loadDB の REQUIRED_PL_KEYS、万円→千円移行 PL_KEYS に追加。DB PL の Cells read/write は key.split('.') の汎用パスなので新キーも編集・enqueueCell永続化が自動で効く。④SIMは既存のカスタム明細機構(PL_ROWS_BASE/getPLRows/recalcSimPL の topOpexKeys 動的合計)に乗るので PL_ROWS_BASE の販管費を12行へ再構成+PARENT_OPTIONS_COST追加、ハードコード集計(予算履歴snapshot/AIプロンプト)は simOpexTotalAt(i) へ。SIMは独立(MF無)なので getSimVal/setSimVal がキー非依存で新キー永続化OK。⑤WFは自由項目なので DEFAULT_SGA_ITEMS を12項目(amount:0)に差し替え。学び: 多ビューで共通概念(科目セット)を持つ場合は早期に単一定数へ集約する。取込ドメイン(MF)と表示/集計ドメインは別物として境界を引き、片側だけ拡張する設計で回帰を抑える。簡易シミュレータ(QSスライダー qs-*)とHD連結(window.HD の sga)は別系統なので今回スコープ外(必要なら別途)。

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
