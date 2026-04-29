-- ================================================================
-- NEO福岡 経営ダッシュボード - 経費申請ワークフロー (Phase 5)
-- Supabase Dashboard > SQL Editor で全文貼り付けて「Run」
-- ================================================================
-- 設計方針：
--   - 軽量な申請→承認→PL反映フロー
--   - RLS は既存パターン (allow_all) を踏襲。承認者の認可は名前/メール記録のみ
--   - PL 反映は申請が approved になったとき手動 or バッチで行う想定
--     (本テーブルには status を持つだけで、fiscal_data の更新は別経路)
-- ================================================================

CREATE TABLE IF NOT EXISTS expense_requests (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL UNIQUE,    -- Date.now() で生成
  requester_name  TEXT NOT NULL,
  requester_email TEXT,
  category        TEXT NOT NULL,             -- 例: '販管費/旅費交通費' '原価/外注費' など自由
  amount          BIGINT NOT NULL,           -- 円単位
  description     TEXT,                      -- 用途・備考
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  approved_by     TEXT,                      -- 承認/却下した人の名前 or メール
  approved_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  receipt_url     TEXT,                      -- 領収書画像/PDFのURL (任意)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_er_status  ON expense_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_er_request ON expense_requests(request_id DESC);
CREATE INDEX IF NOT EXISTS idx_er_created ON expense_requests(created_at DESC);

-- ── RLS (allow_all 既存パターン) ──
ALTER TABLE expense_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all" ON expense_requests;
CREATE POLICY "allow_all" ON expense_requests FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- 注: ステータス遷移
--   pending → approved (承認: approved_by + approved_at セット)
--   pending → rejected (却下: approved_by + approved_at + reject_reason セット)
--   approved/rejected は基本的に終端 (再申請は新規 request_id を発行)
-- ================================================================
