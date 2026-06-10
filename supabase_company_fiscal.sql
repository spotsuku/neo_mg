-- ── 会社別財務データ対応: fiscal_data テーブルに company_id カラムを追加 ──
-- Supabase Dashboard の SQL Editor で実行してください

-- 1. company_id カラムを追加（NULL許容 = 後方互換性確保）
ALTER TABLE fiscal_data
  ADD COLUMN IF NOT EXISTS company_id TEXT;

-- 2. 旧データ（company_id IS NULL）は「株式会社NEO（NEO福岡）」として扱う
-- ※ 後方互換のため NULL のまま残す

-- 3. 新しい一意制約: (company_id, fiscal_year) のペアでユニーク
-- ただし company_id が NULL の旧データは fiscal_year のみでユニーク
-- PostgreSQL では NULL != NULL なので UNIQUE制約は自動的に区別される
ALTER TABLE fiscal_data
  DROP CONSTRAINT IF EXISTS fiscal_data_fiscal_year_key;

-- 4. 複合ユニーク制約を追加
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_data_company_year_unique
  ON fiscal_data (company_id, fiscal_year);

-- 5. RLS ポリシー確認（既存のものを踏襲）
-- 既存の RLS が allow_all なら変更不要

-- 確認クエリ
-- SELECT * FROM fiscal_data ORDER BY company_id NULLS FIRST, fiscal_year;