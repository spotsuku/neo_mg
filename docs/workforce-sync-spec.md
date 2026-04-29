# 工数管理データ連携仕様書

NEO福岡 経営管理ダッシュボード (`neo-mg.vercel.app`) の **工数管理タブ** のデータを、
他のダッシュボード/アプリからリアルタイムで読み取るための仕様書。

このファイル1つで外部統合が可能です。

---

## 1. 接続情報（要共有）

neo_mg の Supabase プロジェクト情報。**フロント側で使う場合は anon key で十分**です（service role は絶対に共有しない）。

```
SUPABASE_URL      = https://xxxxxxxxxxxx.supabase.co     ← Vercel の env var から取得
SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiI...               ← 公開可
```

確認方法: `https://neo-mg.vercel.app/api/config` を GET → `{supabaseUrl, anonKey}` が返る。

---

## 2. テーブル: `workforce_versions`

工数管理のスナップショットを保存する唯一のテーブル。

```sql
CREATE TABLE workforce_versions (
  id          BIGSERIAL PRIMARY KEY,
  version_id  BIGINT NOT NULL UNIQUE,    -- 識別子 (Date.now() で生成)
  name        TEXT NOT NULL,             -- バージョン名
  memo        TEXT,
  is_current  BOOLEAN DEFAULT FALSE,     -- 「採用中」フラグ (常に1件のみ)
  snapshot    JSONB NOT NULL,            -- 全データのスナップショット
  saved_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

RLS: `allow_all` (anon でも読み書き可)。

### 重要な行の使い分け

| 行 | 用途 |
|---|---|
| `version_id = 0` (`name = '__autosave__'`) | **下書き / 自動保存スロット**。常に最新の編集状態が入る。**外部同期はこの行を購読するのが推奨。** |
| `is_current = true` の行 | 「採用中」とマークされた**正式版**。チームで合意した現行配置。 |
| その他の行 | 過去の名前付きスナップショット（履歴） |

---

## 3. snapshot JSONB の構造

```ts
type Snapshot = {
  members: Member[],
  businesses: string[],         // 事業名の配列 (例: ['NEOアカデミア','イベント','研修','事業開発','NEO基金'])
  bizShort: { [biz]: string },  // 事業名→略称マップ (UI表示用)
  bizPrograms: { [biz]: { name: string; amount: number }[] },  // プログラム別売上 (円)
  bizCosts:    { [biz]: { name: string; amount: number }[] },  // 事業別原価 (円)
  sgaItems:    { name: string; amount: number }[],             // 本部費用 (円・4事業均等按分)
  roleWeights: { [biz]: { [role]: number } },                  // 役割ウェイト (%、合計100)
  requiredFTE: { [biz]: { [role]: number } },                  // 必要月工数 (人月)
};

type Member = {
  name: string,
  role: string,                    // 役職 (例: '代表', '営業マネージャー')
  cost: number,                    // 年額人件費 (円)
  ability: number,                 // 能力係数 (標準1.0、範囲0.1〜5.0)
  costMonthly: number[12],         // 月別人件費 (千円・4月から3月)
  allocMatrix: {                   // 配分マトリクス (各セル 0〜100%)
    [biz]: { [role]: number }
  },
};

// role は次の6つ (固定):
// '営業' | '運営' | 'CS' | '企画' | '総務' | 'PR'
```

### 計算で使う関数（参考実装）

```js
// メンバー個人の投入FTE (役割×事業)
const memberAllocFTE = (m, biz, role) =>
  (m.allocMatrix[biz][role] || 0) / 100 * (m.ability || 1.0);

// 事業×役割の総投入FTE (人月)
const investedFTE = (members, biz, role) =>
  members.reduce((s, m) => s + memberAllocFTE(m, biz, role), 0);

// 充足度 (1.0 を超えたら過剰)
const fulfillment = (members, biz, role, requiredFTE) => {
  const req = requiredFTE[biz][role];
  if (!req) return null;          // 必要0なら 不要 (= 売上配分から除外)
  return investedFTE(members, biz, role) / req;
};

// 実現売上 (充足度Capあり)
//   = 事業売上 × 役割ウェイト × MIN(充足度, 100%)
//   ※ 必要月工数=0 の役割は全体ウェイトから除外して再配分
```

---

## 4. リアルタイム購読の実装例

### Supabase JS クライアント (推奨)

```js
import { createClient } from '@supabase/supabase-js';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 初回読み込み: 採用中バージョン
const { data: cur } = await sb
  .from('workforce_versions')
  .select('snapshot, saved_at')
  .eq('is_current', true)
  .maybeSingle();

if (cur) applySnapshot(cur.snapshot);

// または最新の自動保存(下書き)を読む場合:
const { data: draft } = await sb
  .from('workforce_versions')
  .select('snapshot, saved_at')
  .eq('version_id', 0)
  .maybeSingle();

// リアルタイム購読 (下書きの変更を監視)
sb.channel('workforce_sync')
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'workforce_versions',
    filter: 'version_id=eq.0',                  // 自動保存スロットのみ
  }, (payload) => {
    if (payload.new && payload.new.snapshot){
      applySnapshot(payload.new.snapshot);
      console.log('[sync] updated at', payload.new.saved_at);
    }
  })
  .subscribe();
```

### サーバ経由 (Vercel API ラッパー)

`/api/db?action=load_workforce_versions` を GET で叩けば JSON 配列で返ります。
ポーリング (60秒など) でも十分なケースはこちら。

```js
const r = await fetch('https://neo-mg.vercel.app/api/db?action=load_workforce_versions');
const { data } = await r.json();
const current = data.find(v => v.is_current);
const draft   = data.find(v => v.version_id === 0);
```

---

## 5. 主要 KPI 派生値の計算（必要なら）

外部ダッシュボードで再計算したい場合の定番指標：

| 指標 | 式 |
|---|---|
| 総人件費（年額） | `Σ member.cost` |
| 総売上目標 | `Σ Σ bizPrograms[biz].amount` |
| 実現売上 | `Σ biz × Σ role ( bizRevenue × effectiveWeight × min(fulfillment, 1.0) )` |
| 人件費生産性 | 実現売上 ÷ 総人件費 |
| 営業利益（事業別） | 実現売上 − 原価 − 配分人件費 − 販管費按分 |

詳細式は本リポの `public/index.html` 内の `bizRealizedRev`, `bizOperatingProfit`, `memberRevenue` 関数を参照。

---

## 6. 連携シナリオ別の推奨方法

| シナリオ | 推奨方式 |
|---|---|
| 別ダッシュボード（同 Supabase 内） | 直接 `from('workforce_versions').select()` + Realtime 購読 |
| 別 Supabase プロジェクト | サーバ関数経由で service_role で読み取り → 集計済みJSONを返す（neobudget連携と同じパターン） |
| 外部システム（Slack 通知等） | Supabase Webhook → 変更検知時に POST |
| BI ツール (Looker等) | Supabase の Direct Query / Foreign Data Wrapper |

---

## 7. 参考: neo_mg 内のソース箇所

| ファイル | 役割 |
|---|---|
| `supabase_workforce.sql` | テーブル定義 (このファイルを実行すれば再現可) |
| `api/db.js` (case 'load_workforce_versions') | サーバ経由の読み取り API |
| `public/index.html` (`window.WF` IIFE) | フロント実装の本体・計算関数群 |
| `public/index.html` `setupRealtimeSync()` | Realtime 購読の参考コード |

---

## 8. 留意点

- **`snapshot` は丸ごと上書き**される。差分更新ではない。
- 自動保存は **1.5秒 debounce** + **3秒 echo 防止**（同じクライアントの保存を再適用しない）
- 旧データの **`'納品'` ロール** は読み取り時に **`'運営'`** に自動変換（仕様書3章のとおり 6 ロール）
- BIZ は動的（事業の追加/削除/改名が可能）、ROLES は固定 6 つ
- service_role キーは絶対にフロントに置かない（書き込みも anon で OK な RLS）
