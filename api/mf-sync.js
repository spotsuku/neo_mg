import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

// クラウド会計APIのベースURL（正しいエンドポイント）
const MF_API_BASE = 'https://api-accounting.moneyforward.com/api/v3';

// ── アクセストークン取得（有効期限チェック付き） ──
async function getAccessToken() {
    const { data, error } = await supabase
      .from('mf_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('id', 'default')
      .maybeSingle();

  if (error || !data) throw new Error('マネフォ未連携です。先に認証してください。');

  const expiresSoon = new Date(data.expires_at) < new Date(Date.now() + 5 * 60 * 1000);
    if (expiresSoon) {
          const res = await fetch(`https://neo-mg.vercel.app/api/mf-auth?action=refresh`, {
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

  const { action, office_id, fiscal_year, from_date, to_date } = req.query;

  try {
        const token = await getAccessToken();

      // ── 事業者一覧取得 ──
      if (action === 'offices') {
              const data = await mfFetch(token, '/offices');
              return res.status(200).json({ ok: true, data: data.offices || [] });
      }

      if (!office_id) {
              return res.status(400).json({ error: 'office_id が必要です' });
      }

      // ── 仕訳一覧取得 ──
      if (action === 'journals') {
              const params = { office_id, per_page: 100 };
              if (from_date) params.start_date = from_date;
              if (to_date)   params.end_date   = to_date;

          const data = await mfFetch(token, '/journals', params);
              return res.status(200).json({ ok: true, data: data.journals || [] });
      }

      // ── 月次PL試算表取得 ──
      if (action === 'trial_pl') {
              const params = { office_id };
              if (fiscal_year) params.fiscal_year = fiscal_year;
              const data = await mfFetch(token, '/reports/trial_pl_three_years', params);
              return res.status(200).json({ ok: true, data });
      }

      // ── BS取得 ──
      if (action === 'trial_bs') {
              const params = { office_id };
              if (fiscal_year) params.fiscal_year = fiscal_year;
              const data = await mfFetch(token, '/reports/trial_bs_three_years', params);
              return res.status(200).json({ ok: true, data });
      }

      // ── 勘定科目一覧 ──
      if (action === 'accounts') {
              const data = await mfFetch(token, '/accounts', { office_id });
              return res.status(200).json({ ok: true, data: data.accounts || [] });
      }

      // ── 月次PLをSupabaseに保存 ──
      if (action === 'sync_to_dashboard') {
              if (!fiscal_year) return res.status(400).json({ error: 'fiscal_year が必要です' });

          const plData = await mfFetch(token, '/reports/trial_pl_three_years', {
                    office_id,
                    fiscal_year,
          });

          await supabase.from('mf_sync_logs').insert({
                    fiscal_year: parseInt(fiscal_year),
                    company_id:  office_id,
                    action:      'sync_to_dashboard',
                    raw_data:    plData,
                    synced_at:   new Date().toISOString(),
          });

          return res.status(200).json({
                    ok: true,
                    message: `${fiscal_year}年度のPLデータを取得しました`,
                    raw: plData,
          });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
        console.error('[mf-sync] error:', err);
        return res.status(500).json({ error: err.message });
  }
}
