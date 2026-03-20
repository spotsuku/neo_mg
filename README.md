# NEO福岡 経営ダッシュボード

## セットアップ手順

### Step 1：Supabaseのセットアップ

1. [supabase.com](https://supabase.com) でプロジェクトを作成
2. **SQL Editor** を開き、`supabase_schema.sql` の内容を全てコピーして実行
   → テーブル3つ（`fiscal_data`, `sim_data`, `budget_history`）と初期データが作成されます
3. **Project Settings → API** から以下をメモ：
   - `Project URL`（例：`https://xxxx.supabase.co`）
   - `service_role` キー（secretキー）

### Step 2：GitHubにpush

```bash
git init
git add .
git commit -m "初期デプロイ"
git remote add origin https://github.com/あなたのID/neo-dashboard.git
git push -u origin main
```

### Step 3：Vercelでプロジェクト作成

1. https://vercel.com にログイン → 「Add New → Project」
2. GitHubリポジトリを選択
3. **Environment Variables** に以下を設定：

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...`（Anthropicコンソールで発行） |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...`（service_roleキー） |

4. 「Deploy」ボタンを押す

### Step 4：動作確認

デプロイ後 `https://neo-dashboard-xxx.vercel.app` にアクセスして：
- データが表示される（Supabaseの初期データが読み込まれる）
- AI機能ボタンが動作する
- データを変更して保存すると永続化される

---

## ファイル構成

```
neo-vercel/
├── api/
│   ├── chat.js            # Anthropic AIプロキシ
│   └── db.js              # Supabase CRUDエンドポイント
├── public/
│   └── index.html         # ダッシュボード本体
├── supabase_schema.sql    # ← Supabase SQL Editorで実行
├── package.json           # @supabase/supabase-js
├── vercel.json            # ルーティング設定
└── .gitignore
```

## データ構成（Supabaseテーブル）

| テーブル | 内容 |
|---------|------|
| `fiscal_data` | PL/CF の月次予算・実績（年度別） |
| `sim_data` | シミュレーション入力値（年度別） |
| `budget_history` | 予算変更履歴（日時・理由・スナップショット） |

## APIキー取得先

- Anthropic: https://console.anthropic.com → API Keys
- Supabase: プロジェクト → Settings → API
