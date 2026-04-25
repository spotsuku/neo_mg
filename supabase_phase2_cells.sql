-- ================================================================
-- Phase 2: セル正規化スキーマ
-- 1セル=1行 で保存し、差分書き込み・即時同期を可能にする。
-- 既存 fiscal_data / sim_data の JSONB カラムは当面残し、両方併存。
-- Supabase Dashboard > SQL Editor で実行。
-- ================================================================

-- ── セル値テーブル（中心テーブル）──
-- sheet 種別:
--   'sim_pl'              SIM_DATA[year].pl[key][idx]
--   'sim_cf'              SIM_DATA[year].cf[key][idx]
--                         （cfOpenFirst スカラーは row_key='cfOpenFirst', month_idx=-1）
--   'fiscal_pl_budget'    DB[year].pl.budget[key][idx]
--   'fiscal_pl_actual'    DB[year].pl.actual[key][idx]
--   'fiscal_cf_budget'    DB[year].cf.budget[key][idx]
--   'fiscal_cf_actual'    DB[year].cf.actual[key][idx]
CREATE TABLE IF NOT EXISTS cells (
  fiscal_year  TEXT     NOT NULL,
  sheet        TEXT     NOT NULL,
  row_key      TEXT     NOT NULL,
  month_idx    SMALLINT NOT NULL CHECK (month_idx BETWEEN -1 AND 11),
  value        NUMERIC,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fiscal_year, sheet, row_key, month_idx)
);
CREATE INDEX IF NOT EXISTS idx_cells_year_sheet ON cells(fiscal_year, sheet);
CREATE INDEX IF NOT EXISTS idx_cells_updated   ON cells(updated_at DESC);

-- ── ユーザ追加カスタム行 ──
-- SIM_DATA[year].customRows / cfCustomRows をここに移行
CREATE TABLE IF NOT EXISTS custom_rows (
  fiscal_year  TEXT NOT NULL,
  sheet        TEXT NOT NULL,             -- 'sim_pl' or 'sim_cf'
  row_key      TEXT NOT NULL,
  label        TEXT NOT NULL,
  attrs        JSONB NOT NULL DEFAULT '{}',  -- {isRev,isCost,parentKey,...}
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fiscal_year, sheet, row_key)
);

-- ── 年度メタ（月配列・レポートデータ等の非セル値）──
CREATE TABLE IF NOT EXISTS fiscal_meta (
  fiscal_year  TEXT PRIMARY KEY,
  months       JSONB,
  report_data  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS（Phase 5 で auth.role()='authenticated' へ置換予定）──
ALTER TABLE cells       ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON cells;
DROP POLICY IF EXISTS "allow_all" ON custom_rows;
DROP POLICY IF EXISTS "allow_all" ON fiscal_meta;
CREATE POLICY "allow_all" ON cells       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON custom_rows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON fiscal_meta FOR ALL USING (true) WITH CHECK (true);
