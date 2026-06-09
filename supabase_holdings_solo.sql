-- ════════════════════════════════════════════════════════════════
--  HD単体（持株会社単体の財務三表）用テーブル
--  月次財務と同一粒度の PL/CF（12ヶ月×予算/実績）+ BS（予算/実績スナップ）を
--  年度ごとに JSONB ブロブで保持。フロントは sbClient で year 単位 upsert/select。
--  Supabase 未設定時はブラウザ localStorage のみで動作します。
--  RLS は既存方針に合わせ allow_all。
--  実行: Supabase Dashboard > SQL Editor で全文貼り付けて Run。
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS holdings_solo (
  id          TEXT PRIMARY KEY,          -- 会計年度（例: '2025'）
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { pl:{budget,actual}, cf:{budget,actual}, bs:{budget,actual} }
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE holdings_solo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all ON holdings_solo;
CREATE POLICY allow_all ON holdings_solo FOR ALL USING (true) WITH CHECK (true);
