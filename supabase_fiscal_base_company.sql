-- ════════════════════════════════════════════════════════════════
--  fiscal_data: 基本会社(NEO福岡)の company_id を '' に統一
--  背景: supabase_company_fiscal.sql で fiscal_year の一意制約を外し
--        (company_id, fiscal_year) の一意インデックスへ変更した。
--        基本会社の行が company_id = NULL のままだと、
--        ① upsert の ON CONFLICT (company_id,fiscal_year) でNULL同士が
--           区別され重複が発生 / ② 旧 onConflict 'fiscal_year' は一致する
--           制約が無く 500 (there is no unique or exclusion constraint…)
--        となる。基本会社を '' に揃えて一意制約を効かせる。
--  Supabase Dashboard > SQL Editor で実行。冪等。
-- ════════════════════════════════════════════════════════════════

-- 1. 既存の NULL 行（＝基本会社/NEO）を '' に移行
UPDATE fiscal_data SET company_id = '' WHERE company_id IS NULL;

-- 2. 既定値 '' / NOT NULL 化
ALTER TABLE fiscal_data ALTER COLUMN company_id SET DEFAULT '';
ALTER TABLE fiscal_data ALTER COLUMN company_id SET NOT NULL;

-- 3. (company_id, fiscal_year) の一意インデックスを保証
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_data_company_year_unique
  ON fiscal_data (company_id, fiscal_year);

-- 確認:
-- SELECT company_id, fiscal_year FROM fiscal_data ORDER BY company_id, fiscal_year;
