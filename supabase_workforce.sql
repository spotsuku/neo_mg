-- ================================================================
-- NEO福岡 経営ダッシュボード - 工数配分シミュレーター 追加スキーマ
-- Supabase Dashboard > SQL Editor で全文貼り付けて「Run」
-- ================================================================
-- 設計方針：
--   - 既存 app_versions と同じパターン（JSONB スナップショット）
--   - 4テーブル正規化ではなく、1テーブル + JSONB に集約
--     → snapshot.takeSnapshot() / restoreSnapshot() のラウンドトリップが
--        単純で、フロントの計算ロジックを変更不要
--   - RLS は既存パターン（allow_all）を踏襲
-- ================================================================

CREATE TABLE IF NOT EXISTS workforce_versions (
  id          BIGSERIAL PRIMARY KEY,
  version_id  BIGINT NOT NULL UNIQUE,    -- Date.now() で生成
  name        TEXT NOT NULL,
  memo        TEXT,
  is_current  BOOLEAN DEFAULT FALSE,
  snapshot    JSONB NOT NULL,            -- members / bizPrograms / bizCosts / sgaItems / roleWeights / requiredFTE
  saved_at    TIMESTAMPTZ DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wfv_saved   ON workforce_versions(saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_wfv_vid     ON workforce_versions(version_id DESC);
CREATE INDEX IF NOT EXISTS idx_wfv_current ON workforce_versions(is_current) WHERE is_current = TRUE;

-- ── RLS（既存パターン: allow_all）──
ALTER TABLE workforce_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON workforce_versions;
CREATE POLICY "allow_all" ON workforce_versions FOR ALL USING (true) WITH CHECK (true);

-- ── is_current は最大1件しか許可しない（部分一意インデックス）──
CREATE UNIQUE INDEX IF NOT EXISTS uq_wfv_one_current
  ON workforce_versions ((true)) WHERE is_current = TRUE;

-- ================================================================
-- 注: snapshot の構造（参考）
-- {
--   "members":      [ { name, role, cost, ability, allocMatrix: { biz: { role: pct } } }, ... ],
--   "bizPrograms":  { biz: [ { name, amount }, ... ] },
--   "bizCosts":     { biz: [ { name, amount }, ... ] },
--   "sgaItems":     [ { name, amount }, ... ],
--   "roleWeights":  { biz: { role: pct } },
--   "requiredFTE":  { biz: { role: fte } }
-- }
-- ================================================================
