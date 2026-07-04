-- ════════════════════════════════════════════════════════════════
--  HD管理（ホールディングス連結）用テーブル
--  Supabase Dashboard の SQL Editor で個別実行してください。
--  RLS は既存方針に合わせ allow_all に統一（認証フローは現状維持）。
--  フロントは @supabase/supabase-js 経由で直接 upsert / select します。
--  Supabase 未設定時はブラウザ localStorage のみで動作します。
-- ════════════════════════════════════════════════════════════════

-- 会社マスタ ------------------------------------------------------
CREATE TABLE IF NOT EXISTS holdings_companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('parent', 'subsidiary', 'affiliate')),
  ownership_ratio NUMERIC(5,2) DEFAULT 100,
  fiscal_month    INTEGER DEFAULT 3,          -- 決算月 (1-12)
  consolidate     BOOLEAN DEFAULT true,       -- 連結対象に含めるか
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 各社財務データ（勘定科目ごとの単月額）-------------------------------
CREATE TABLE IF NOT EXISTS holdings_financials (
  id           TEXT PRIMARY KEY,            -- `${company_id}|${fiscal_year}|${fiscal_month}|${account_code}`
  company_id   TEXT REFERENCES holdings_companies(id) ON DELETE CASCADE,
  fiscal_year  INTEGER NOT NULL,
  fiscal_month INTEGER NOT NULL,
  account_code TEXT NOT NULL,               -- 例: cash / receivable / sales / cogs ...
  amount       NUMERIC(15,0) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hd_fin_period
  ON holdings_financials (fiscal_year, fiscal_month);

-- 内部取引（連結相殺対象）-------------------------------------------
CREATE TABLE IF NOT EXISTS intercompany_transactions (
  id               TEXT PRIMARY KEY,
  fiscal_year      INTEGER NOT NULL,
  fiscal_month     INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sales', 'purchase', 'loan', 'dividend', 'other')),
  from_company_id  TEXT REFERENCES holdings_companies(id) ON DELETE CASCADE,
  to_company_id    TEXT REFERENCES holdings_companies(id) ON DELETE CASCADE,
  amount           NUMERIC(15,0) NOT NULL DEFAULT 0,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hd_ic_period
  ON intercompany_transactions (fiscal_year, fiscal_month);

-- RLS: allow_all（既存テーブルと統一）------------------------------
ALTER TABLE holdings_companies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings_financials         ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_transactions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all ON holdings_companies;
DROP POLICY IF EXISTS allow_all ON holdings_financials;
DROP POLICY IF EXISTS allow_all ON intercompany_transactions;

CREATE POLICY allow_all ON holdings_companies        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON holdings_financials       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON intercompany_transactions FOR ALL USING (true) WITH CHECK (true);
