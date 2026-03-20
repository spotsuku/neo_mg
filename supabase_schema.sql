-- ================================================================
-- NEO福岡 経営ダッシュボード - Supabase スキーマ
-- Supabase Dashboard > SQL Editor で実行してください
-- ================================================================

-- ── 1. 財務データ（PL / CF 予算・実績）──
CREATE TABLE IF NOT EXISTS fiscal_data (
  id            BIGSERIAL PRIMARY KEY,
  fiscal_year   TEXT NOT NULL UNIQUE,   -- '2025' or '2026'
  months        JSONB NOT NULL,          -- ['2504','2505',...]
  pl            JSONB NOT NULL,          -- { budget:{rev,labor,...}, actual:{rev,labor,...} }
  cf            JSONB NOT NULL,          -- { budget:{open,cfIn}, actual:{open,cfIn,cfClose} }
  report_data   JSONB DEFAULT '{}',      -- { '2601':{okr,priority,...}, ... }
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. シミュレーションデータ ──
CREATE TABLE IF NOT EXISTS sim_data (
  id            BIGSERIAL PRIMARY KEY,
  fiscal_year   TEXT NOT NULL UNIQUE,   -- '2025' or '2026'
  data          JSONB NOT NULL,          -- { pl:{fee,training,...}, cf:{cfIn,laborPay,...} }
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. 予算変更履歴 ──
CREATE TABLE IF NOT EXISTS budget_history (
  id            BIGSERIAL PRIMARY KEY,
  fiscal_year   TEXT NOT NULL,
  author        TEXT,
  reason        TEXT NOT NULL,
  snapshot      JSONB NOT NULL,          -- { rev:[], cost:[] }
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── インデックス ──
CREATE INDEX IF NOT EXISTS idx_budget_history_fiscal_year ON budget_history(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_budget_history_created_at  ON budget_history(created_at DESC);

-- ── Row Level Security (RLS) ──
-- 今は全アクセス許可（本番では認証を追加推奨）
ALTER TABLE fiscal_data    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_data       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_fiscal"    ON fiscal_data    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sim"       ON sim_data       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_history"   ON budget_history FOR ALL USING (true) WITH CHECK (true);

-- ── 初期データ投入（2025年度）──
INSERT INTO fiscal_data (fiscal_year, months, pl, cf, report_data)
VALUES (
  '2025',
  '["2504","2505","2506","2507","2508","2509","2510","2511","2512","2601","2602","2603"]',
  '{
    "budget": {
      "rev":      [625,625,625,625,625,625,625,625,625,625,625,625],
      "labor":    [250,250,250,250,250,250,250,250,250,250,250,250],
      "outsource":[400,400,400,400,400,400,400,400,400,400,400,400],
      "adv":      [167,167,167,167,167,167,167,167,167,167,167,167],
      "gaichu":   [200,200,200,200,200,200,200,200,200,200,200,200],
      "other":    [117,117,117,117,117,117,117,117,117,117,117,117]
    },
    "actual": {
      "rev":      [1203,1257,3015,1,605,3,771,29,82,322,450,0],
      "labor":    [141,141,140,498,153,138,183,263,263,308,302,0],
      "outsource":[156,767,450,475,391,512,414,349,502,160,87,0],
      "adv":      [116,71,194,63,51,17,220,27,216,248,365,0],
      "gaichu":   [110,192,175,359,228,629,343,517,366,134,214,0],
      "other":    [110,192,174,359,227,628,342,516,366,133,214,0]
    }
  }',
  '{
    "budget": {
      "open":  [15863,7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706],
      "cfIn":  [3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000,3000]
    },
    "actual": {
      "open":    [15863,7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706],
      "cfIn":    [3322,13791,16656,9901,6650,13212,8479,504,877,3539,48674,39164],
      "cfClose": [7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706,76195]
    }
  }',
  '{}'
)
ON CONFLICT (fiscal_year) DO NOTHING;

-- 2026年度（空）
INSERT INTO fiscal_data (fiscal_year, months, pl, cf, report_data)
VALUES (
  '2026',
  '["2604","2605","2606","2607","2608","2609","2610","2611","2612","2701","2702","2703"]',
  '{"budget":{"rev":[],"labor":[],"outsource":[],"adv":[],"gaichu":[],"other":[]},"actual":{"rev":[],"labor":[],"outsource":[],"adv":[],"gaichu":[],"other":[]}}',
  '{"budget":{"open":[],"cfIn":[]},"actual":{"open":[],"cfIn":[],"cfClose":[]}}',
  '{}'
)
ON CONFLICT (fiscal_year) DO NOTHING;
