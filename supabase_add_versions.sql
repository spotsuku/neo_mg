-- ================================================================
-- バージョン履歴テーブルを追加
-- Supabase Dashboard > SQL Editor で実行
-- ================================================================

CREATE TABLE IF NOT EXISTS app_versions (
  id          BIGSERIAL PRIMARY KEY,
  version_id  BIGINT NOT NULL UNIQUE,   -- Date.now()
  description TEXT NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL,
  fiscal_year TEXT,
  db_snapshot JSONB NOT NULL,
  sim_snapshot JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_av_saved ON app_versions(saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_av_vid ON app_versions(version_id DESC);

ALTER TABLE app_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON app_versions FOR ALL USING (true) WITH CHECK (true);

-- 予算変更履歴（既存テーブルを活用）
-- budget_history は既存なので追加不要
