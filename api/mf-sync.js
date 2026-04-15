import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MF_API_BASE = 'https://api.biz.moneyforward.com/api/v3/companies';

// ── アクセストークン取得（有効期限チェック付き） ──
async function getAccessToken() {
  const { data, error } = await supabase
    .from('mf_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('id', 'default')
    .maybeSingle();

  if (error || !data) throw new Error('マネフォ未連携です。先に認証してください。');

  // 期限切れ or 5分以内に切れる → 自動リフレッシュ
  const expiresSoon = new Date(data.expires_at) < new Date(Date.now() + 5 * 60 * 1000);
  if (expiresSoon) {
    const res = await fetch(`${process.env.VERCEL_URL || 'https://neo-mg.vercel.app'}/api/mf-auth?action=refresh`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('トークンのリフレッシュに失敗しました。再認証してください。');
    const refreshed = await supabase
      .from('mf_tokens')
      .select('access_token')
      .eq('id', 'default')
      .maybeSingle();
    return refreshed.data?.access_token;
  }

  return data.access_token;
}

// ── マネフォAPIを叩くヘルパー ──
async function mfFetch(token, path, params = {}) {
  const url = new URL(`${MF_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MF API error ${res.status}: ${text}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, company_id, fiscal_year, from_date, to_date } = req.query;

  try {
    const token = await getAccessToken();

    // ── 事業者一覧取得 ──
    if (action === 'companies') {
      const data = await mfFetch(token, '');
      // companies配列を返す
      return res.status(200).json({ ok: true, data: data.companies || [data] });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id が必要です' });
    }

    // ── 仕訳一覧取得 ──
    if (action === 'journals') {
      const params = { per_page: 100 };
      if (from_date) params.from_issue_date = from_date;
      if (to_date)   params.to_issue_date   = to_date;

      const data = await mfFetch(token, `/${company_id}/journals`, params);
      return res.status(200).json({ ok: true, data: data.journals || [] });
    }

    // ── 月次試算表取得（PL相当） ──
    if (action === 'trial_pl') {
      const params = {};
      if (fiscal_year) params.fiscal_year = fiscal_year;

      const data = await mfFetch(token, `/${company_id}/reports/trial_pl_three_years`, params);
      return res.status(200).json({ ok: true, data });
    }

    // ── BS取得 ──
    if (action === 'trial_bs') {
      const params = {};
      if (fiscal_year) params.fiscal_year = fiscal_year;

      const data = await mfFetch(token, `/${company_id}/reports/trial_bs_three_years`, params);
      return res.status(200).json({ ok: true, data });
    }

    // ── 勘定科目一覧 ──
    if (action === 'account_items') {
      const data = await mfFetch(token, `/${company_id}/account_items`);
      return res.status(200).json({ ok: true, data: data.account_items || [] });
    }

    // ── 取引先一覧 ──
    if (action === 'partners') {
      const data = await mfFetch(token, `/${company_id}/partners`);
      return res.status(200).json({ ok: true, data: data.partners || [] });
    }

    // ── 月次PLをダッシュボード形式に変換してSupabaseに保存 ──
    if (action === 'sync_to_dashboard') {
      if (!fiscal_year) return res.status(400).json({ error: 'fiscal_year が必要です' });

      const plData = await mfFetch(token, `/${company_id}/reports/trial_pl_three_years`, { fiscal_year });

      // マネフォの月次データをダッシュボード形式（千円単位）に変換
      const months = Array.from({ length: 12 }, (_, i) => {
        const month = plData?.balances?.find(b => b.month === i + 1) || {};
        return {
          month: i + 1,
          revenue:  Math.round((month.credit_amount || 0) / 1000),
          expense:  Math.round((month.debit_amount  || 0) / 1000),
          synced_from_mf: true,
          synced_at: new Date().toISOString(),
        };
      });

      // mf_sync_logs テーブルに生データを保存
      await supabase.from('mf_sync_logs').insert({
        fiscal_year: parseInt(fiscal_year),
        company_id,
        action: 'sync_to_dashboard',
        raw_data: plData,
        synced_at: new Date().toISOString(),
      });

      return res.status(200).json({
        ok: true,
        message: `${fiscal_year}年度のデータを取得しました`,
        months,
        raw: plData,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[mf-sync] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
