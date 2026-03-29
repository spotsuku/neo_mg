-- ================================================================
-- NEO福岡 経営ダッシュボード - Supabase スキーマ（最新版）
-- Supabase Dashboard > SQL Editor で全文貼り付けて「Run」
-- ================================================================

-- ── 1. 財務データ ──
CREATE TABLE IF NOT EXISTS fiscal_data (
  id          BIGSERIAL PRIMARY KEY,
  fiscal_year TEXT NOT NULL UNIQUE,
  months      JSONB NOT NULL,
  pl          JSONB NOT NULL,
  cf          JSONB NOT NULL,
  report_data JSONB DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. シミュレーションデータ ──
CREATE TABLE IF NOT EXISTS sim_data (
  id          BIGSERIAL PRIMARY KEY,
  fiscal_year TEXT NOT NULL UNIQUE,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. 予算変更履歴 ──
CREATE TABLE IF NOT EXISTS budget_history (
  id          BIGSERIAL PRIMARY KEY,
  fiscal_year TEXT NOT NULL,
  author      TEXT,
  reason      TEXT NOT NULL,
  snapshot    JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bh_year ON budget_history(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_bh_date ON budget_history(created_at DESC);

-- ── RLS（全アクセス許可）──
ALTER TABLE fiscal_data    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_data       ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON fiscal_data    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON sim_data       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON budget_history FOR ALL USING (true) WITH CHECK (true);

-- ================================================================
-- 初期データ（2025年度）
-- ================================================================
INSERT INTO fiscal_data (fiscal_year, months, pl, cf, report_data) VALUES (
  '2025',
  '["2504","2505","2506","2507","2508","2509","2510","2511","2512","2601","2602","2603"]',
  '{"budget":{"rev":[625,625,625,625,625,625,625,625,625,625,625,625],"labor":[250,250,250,250,250,250,250,250,250,250,250,250],"outsource":[400,400,400,400,400,400,400,400,400,400,400,400],"adv":[167,167,167,167,167,167,167,167,167,167,167,167],"gaichu":[200,200,200,200,200,200,200,200,200,200,200,200],"other":[117,117,117,117,117,117,117,117,117,117,117,117]},"actual":{"rev":[1203,1257,3015,1,605,3,771,29,82,322,450,0],"labor":[141,141,140,498,153,138,183,263,263,308,302,0],"outsource":[156,767,450,475,391,512,414,349,502,160,87,0],"adv":[116,71,194,63,51,17,220,27,216,248,365,0],"gaichu":[110,192,175,359,228,629,343,517,366,134,214,0],"other":[110,192,174,359,227,628,342,516,366,133,214,0]}}',
  '{"budget":{"open":[15863,7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706],"cfIn":[6250,13750,16625,9875,6625,13200,8500,500,875,3500,16500,10000],"cfInFee":[4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000,4000],"cfInTraining":[2000,9500,12375,5625,2375,9000,4250,0,0,0,12250,5750],"cfInEvent":[0,0,0,0,0,0,0,0,0,0,0,0],"cfInOther":[250,250,250,250,250,200,250,500,875,3500,250,250],"salaryPay":[2500,2500,2500,2500,2500,2500,2500,2500,2500,2500,2500,2500],"devOutPay":[0,0,0,0,0,0,0,0,0,0,0,0],"bizComPay":[3500,3500,3500,3500,3500,3500,3500,3500,3500,3500,3500,3500],"incentivePay":[500,500,500,500,500,500,500,500,500,500,500,500],"expertPay":[0,0,0,0,0,0,0,0,0,0,0,0],"rentPay":[900,900,900,900,900,900,900,900,900,900,900,900],"expensePay":[300,300,300,300,300,300,300,300,300,300,300,300],"telPay":[50,50,50,50,50,50,50,50,50,50,50,50],"entertainPay":[100,100,100,100,100,100,100,100,100,100,100,100],"taxPay":[0,0,200,0,0,0,0,0,0,100,0,0],"toolsPay":[200,200,200,200,200,200,200,200,200,200,200,200],"suppliesPay":[50,50,50,50,50,50,50,50,50,50,50,50],"adSportsPay":[835,835,835,835,835,835,835,835,835,835,835,835],"eventCostPay":[835,835,835,835,835,835,835,835,835,835,835,835],"recruitPay":[0,0,200,0,0,100,0,0,0,0,0,0],"annualFeePay":[0,0,0,0,100,0,0,0,0,0,0,0],"salesOtherPay":[130,130,130,130,130,130,130,130,130,130,130,130],"investPay":[0,0,0,0,0,0,0,0,0,0,0,0],"loanIn":[0,0,0,0,0,0,0,0,0,15000,0,0],"loanOut":[0,0,0,0,0,0,0,0,0,0,0,0],"capitalIn":[0,0,0,0,0,0,0,0,0,0,0,0],"warrantPay":[0,0,0,0,0,0,0,0,0,0,0,0],"finOtherPay":[0,0,0,0,0,0,0,0,0,0,0,0],"funding":[0,0,0,0,0,0,0,0,0,15000,0,0]},"actual":{"open":[15863,7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706],"cfIn":[3322,13791,16656,9901,6650,13212,8479,504,877,3539,48674,0],"cfClose":[7107,14147,15292,8979,4125,25856,36972,25547,13778,16415,53706,0],"cfInFee":[0,0,0,0,0,0,0,0,0,0,0,0],"cfInTraining":[0,0,0,0,0,0,0,0,0,0,0,0],"cfInEvent":[0,0,0,0,0,0,0,0,0,0,0,0],"cfInOther":[0,0,0,0,0,0,0,0,0,0,0,0],"salaryPay":[1523,1289,1788,5007,1551,1651,1412,1431,2593,2880,3185,0],"devOutPay":[0,0,0,0,0,0,0,0,0,0,0,0],"bizComPay":[3500,1500,6000,5000,4500,4000,4000,4000,3500,2800,3000,0],"incentivePay":[500,200,500,500,500,500,500,500,500,500,500,0],"expertPay":[0,0,0,0,0,0,0,0,0,0,0,0],"rentPay":[249,249,887,249,1380,904,1627,1165,1409,1132,883,0],"expensePay":[300,300,500,300,400,200,200,100,200,300,200,0],"telPay":[50,50,50,50,50,50,50,50,50,50,50,0],"entertainPay":[100,150,200,100,150,100,100,50,100,150,100,0],"taxPay":[0,0,200,0,100,0,0,0,0,100,0,0],"toolsPay":[200,200,300,200,300,200,200,100,200,300,200,0],"suppliesPay":[50,50,50,50,50,50,50,50,50,50,50,0],"adSportsPay":[101,200,0,500,200,0,800,1000,500,2000,500,0],"eventCostPay":[0,167,0,504,135,0,1637,2304,411,2026,373,0],"recruitPay":[0,0,300,0,0,100,0,0,0,0,0,0],"annualFeePay":[0,0,0,0,100,0,0,0,0,0,0,0],"salesOtherPay":[230,179,585,110,321,249,183,177,143,135,105,0],"investPay":[0,0,0,0,0,0,0,0,0,0,0,0],"loanIn":[0,0,0,0,0,0,0,0,0,15000,0,0],"loanOut":[0,0,0,0,0,0,0,0,0,0,0,0],"capitalIn":[0,0,0,0,0,0,0,0,0,0,0,0],"warrantPay":[0,0,0,0,0,0,0,0,0,0,0,0],"finOtherPay":[0,0,0,0,0,0,0,0,0,0,0,0],"funding":[0,0,0,0,0,0,0,0,0,15000,0,0]}}',
  '{}'
) ON CONFLICT (fiscal_year) DO NOTHING;

-- 2026年度（空）
INSERT INTO fiscal_data (fiscal_year, months, pl, cf, report_data) VALUES (
  '2026',
  '["2604","2605","2606","2607","2608","2609","2610","2611","2612","2701","2702","2703"]',
  '{"budget":{"rev":[],"labor":[],"outsource":[],"adv":[],"gaichu":[],"other":[]},"actual":{"rev":[],"labor":[],"outsource":[],"adv":[],"gaichu":[],"other":[]}}',
  '{"budget":{"open":[],"cfIn":[],"cfInFee":[],"cfInTraining":[],"cfInEvent":[],"cfInOther":[],"salaryPay":[],"devOutPay":[],"bizComPay":[],"incentivePay":[],"expertPay":[],"rentPay":[],"expensePay":[],"telPay":[],"entertainPay":[],"taxPay":[],"toolsPay":[],"suppliesPay":[],"adSportsPay":[],"eventCostPay":[],"recruitPay":[],"annualFeePay":[],"salesOtherPay":[],"investPay":[],"loanIn":[],"loanOut":[],"capitalIn":[],"warrantPay":[],"finOtherPay":[],"funding":[]},"actual":{"open":[],"cfIn":[],"cfClose":[],"cfInFee":[],"cfInTraining":[],"cfInEvent":[],"cfInOther":[],"salaryPay":[],"devOutPay":[],"bizComPay":[],"incentivePay":[],"expertPay":[],"rentPay":[],"expensePay":[],"telPay":[],"entertainPay":[],"taxPay":[],"toolsPay":[],"suppliesPay":[],"adSportsPay":[],"eventCostPay":[],"recruitPay":[],"annualFeePay":[],"salesOtherPay":[],"investPay":[],"loanIn":[],"loanOut":[],"capitalIn":[],"warrantPay":[],"finOtherPay":[],"funding":[]}}',
  '{}'
) ON CONFLICT (fiscal_year) DO NOTHING;
