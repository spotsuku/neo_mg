-- ================================================================
-- BSデータ永続化のためのカラム追加
-- ================================================================
-- 背景: fiscal_data テーブルには pl/cf 列はあるが bs 列が無く、
-- MF連携で取り込んだBSデータが Supabase に保存されていなかった。
-- localStorage に依存していたため、別ブラウザ/別端末/キャッシュクリアで
-- BSデータが消えるバグがあった。
--
-- 実行: Supabase Dashboard > SQL Editor で全文貼り付けて「Run」
-- ================================================================

ALTER TABLE fiscal_data
  ADD COLUMN IF NOT EXISTS bs JSONB DEFAULT NULL;

-- 確認: 列が追加されたかチェック
-- SELECT fiscal_year, jsonb_typeof(bs) FROM fiscal_data ORDER BY fiscal_year;
