// ==================================================================
// /api/budget-dash.js
// neobudget-liard.vercel.app の Supabase から dashboard_data を取得し、
// プログラム別の予算/見積/実績を集計して返す。
// ==================================================================
// 必要な Vercel 環境変数:
//   NEOBUDGET_SUPABASE_URL
//   NEOBUDGET_SERVICE_ROLE_KEY
// ==================================================================

import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEOBUDGET_SUPABASE_URL;
const KEY = process.env.NEOBUDGET_SERVICE_ROLE_KEY;
const sb  = (URL && KEY) ? createClient(URL, KEY) : null;

const PROG_LABELS = {
  ko:'キックオフ', aw:'アワード', ye:'イヤーエンド', tour:'ツアー',
  cityfes:'シティフェス', md:'マッチデイ', sd:'スペシャルデイズ',
  cf3:'イベント3', cf4:'イベント4',
  hm:'ホームルーム', gk:'評議会', oe:'応援カイギ',
  annual:'年間共通', other:'その他', marketing:'マーケ関連',
};
const CITYFES_TABS = ['md','sd','cf3','cf4'];

const n  = (v) => Number(v) || 0;
const sum = (arr, f) => (arr||[]).reduce((s,x) => s + n(x[f]), 0);

function calcAggregates(S){
  if (!S) return null;
  const result = { programs: [], totalBudget: 0, totalEstimate: 0, totalActual: 0, totalRevenue: 0 };

  const evtSum  = (key, f) => sum(S.events?.[key]?.items, f);
  const sessSum = (key, f) => (S.sessions?.[key] || []).reduce((t, s) => t + sum(s.items, f), 0);
  const estSum  = (key, f) => sum(S.estimates?.[key], f);
  const revFor  = (progName) => (S.revenues || [])
    .filter(r => r.prog && (r.prog === progName || r.prog.includes(progName) || progName.includes(r.prog)))
    .reduce((t, r) => t + n(r.amount), 0);

  // 単発イベント (ko/aw/ye/tour)
  ['ko','aw','ye','tour'].forEach(key => {
    const budget    = evtSum(key,'budget');
    const estItems  = S.estimates?.[key] || [];
    const estimate  = estItems.length ? sum(estItems,'estimate') : evtSum(key,'estimate');
    const actual    = estItems.length ? sum(estItems,'actual')   : evtSum(key,'actual');
    const revenue   = revFor(PROG_LABELS[key]);
    if (budget || estimate || actual || revenue) {
      result.programs.push({ id: key, name: PROG_LABELS[key], budget, estimate, actual, revenue });
    }
  });

  // シティフェス (4タブ合算)
  let cfBudget = 0, cfEst = 0, cfAct = 0;
  CITYFES_TABS.forEach(k => {
    cfBudget += evtSum(k,'budget');
    const est = S.estimates?.[k] || [];
    cfEst    += est.length ? sum(est,'estimate') : evtSum(k,'estimate');
    cfAct    += est.length ? sum(est,'actual')   : evtSum(k,'actual');
  });
  const cfRev = revFor('シティフェス') ||
    CITYFES_TABS.reduce((t, k) => t + revFor(PROG_LABELS[k]), 0);
  if (cfBudget || cfEst || cfAct || cfRev) {
    result.programs.push({ id:'cityfes', name:'シティフェス', budget: cfBudget, estimate: cfEst, actual: cfAct, revenue: cfRev });
  }

  // シリーズ (hm/gk/oe)
  ['hm','gk','oe'].forEach(key => {
    const budget   = sessSum(key,'budget');
    const estimate = sessSum(key,'estimate');
    const actual   = sessSum(key,'actual');
    const revenue  = revFor(PROG_LABELS[key]);
    if (budget || estimate || actual || revenue) {
      result.programs.push({ id: key, name: PROG_LABELS[key], budget, estimate, actual, revenue });
    }
  });

  // 製作物 (年間共通) — prodItems/prodBudgets
  const prodB = S.prodBudgets || {};
  const prodCats = ['グッズ（外販）','グッズ（内部向け）','イベント装飾','年間共通ツール','年間共通デザイン','マーケ','その他'];
  const prodBudget = prodCats.reduce((t,c) => t + n(prodB[c]), 0);
  const prodEst    = sum(S.prodItems,'estimate');
  const prodAct    = sum(S.prodItems,'actual');
  if (prodBudget || prodEst || prodAct) {
    result.programs.push({ id:'annual', name:'年間共通（製作物）', budget: prodBudget, estimate: prodEst, actual: prodAct, revenue: 0 });
  }

  // 合計
  result.programs.forEach(p => {
    result.totalBudget   += p.budget;
    result.totalEstimate += p.estimate;
    result.totalActual   += p.actual;
    result.totalRevenue  += p.revenue;
  });

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=40');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!sb) {
    return res.status(500).json({
      error: 'NEOBUDGET_SUPABASE_URL / NEOBUDGET_SERVICE_ROLE_KEY が未設定です',
      hint: 'Vercel Dashboard で env var を追加してください',
    });
  }

  // 年度: ?year=2025 → id=1, year=2026 → id=2
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const dbId = year - 2024;

  try {
    const { data, error } = await sb
      .from('dashboard_data')
      .select('id, data, updated_at')
      .eq('id', dbId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(200).json({ ok: true, year, empty: true });

    const aggregates = calcAggregates(data.data);
    return res.status(200).json({
      ok: true,
      year,
      updatedAt: data.updated_at,
      ...aggregates,
    });
  } catch (e) {
    console.error('[budget-dash]', e);
    return res.status(500).json({ error: e.message || 'fetch failed' });
  }
}
