-- ════════════════════════════════════════════════════════════════
--  工数管理(workforce_versions) / 経費申請(expense_requests) の会社別分離
--  会社ID(company_id) で会社別にデータを保持する。
--  基本会社(NEO福岡)は company_id = '' （空文字 / DEFAULT）として扱う。
--  Supabase Dashboard > SQL Editor で全文貼り付けて Run。
-- ════════════════════════════════════════════════════════════════

-- ── 工数管理: workforce_versions ──────────────────────────────
-- company_id 追加（既存行は '' = 基本会社/NEO に移行）
ALTER TABLE workforce_versions
  ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';

-- version_id の一意性を「会社×version_id」へ変更
ALTER TABLE workforce_versions
  DROP CONSTRAINT IF EXISTS workforce_versions_version_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wfv_company_vid
  ON workforce_versions (company_id, version_id);

-- 「現在採用中(is_current)」は会社ごとに最大1件
DROP INDEX IF EXISTS uq_wfv_one_current;
CREATE UNIQUE INDEX IF NOT EXISTS uq_wfv_one_current_per_company
  ON workforce_versions (company_id) WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_wfv_company
  ON workforce_versions (company_id, saved_at DESC);

-- ── 経費申請: expense_requests ────────────────────────────────
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS company_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_expreq_company
  ON expense_requests (company_id, status, created_at DESC);

-- 確認:
-- SELECT company_id, count(*) FROM workforce_versions GROUP BY company_id;
-- SELECT company_id, count(*) FROM expense_requests GROUP BY company_id;
