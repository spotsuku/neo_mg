import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

const MF_API_BASE = 'https://api-accounting.moneyforward.com/api/v3';

async function getAccessToken() {
      const { data, error } = await supabase
        .from('mf_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('id', 'default')
        .maybeSingle();
      if (error || !data) throw new Error('マネフォ未連携です。先に認証してください。');
      const expiresSoon = new Date(data.expires_at) < new Date(Date.now() + 5 * 60 * 1000);
      if (expiresSoon) {
              const res = await fetch(`https://neo-mg.vercel.app/api/mf-auth?action=refresh`, { method: 'POST' });
              if (!res.ok) throw new Error('リフレッシュ失敗。再認証してください。');
              const refreshed = await supabase.from('mf_tokens').select('access_token').eq('id', 'default').maybeSingle();
              return refreshed.data?.access_token;
      }
      return data.access_token;
}

async function mfFetch(token, path, params = {}) {
      const url = new URL(`${MF_API_BASE}${path}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url.toString(), {
              headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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

        // ── デバッグ：office_idなしで全エンドポイントを試す ──
        if (action === 'debug') {
                  const results = {};
                  const endpoints = ['/offices', '/accounts', '/partners', '/sections'];
                  for (const ep of endpoints) {
                              try {
                                            const d = await mfFetch(token, ep);
                                            results[ep] = { ok: true, keys: Object.keys(d) };
                              } catch (e) {
                                            results[ep] = { ok: false, error: e.message.slice(0, 100) };
                              }
                  }
                  return res.status(200).json({ ok: true, results });
        }

        // ── 事業者一覧 ──
        if (action === 'offices') {
                  const data = await mfFetch(token, '/offices');
                  return res.status(200).json({ ok: true, data });
        }

        // ── 勘定科目（office_idなし）──
        if (action === 'accounts_nooffice') {
                  const data = await mfFetch(token, '/accounts');
                  return res.status(200).json({ ok: true, data });
        }

        // ── 勘定科目（office_id付き）──
        if (action === 'accounts') {
                  const params = office_id ? { office_id } : {};
                  const data = await mfFetch(token, '/accounts', params);
                  return res.status(200).json({ ok: true, data });
        }

        // ── 仕訳一覧 ──
        if (action === 'journals') {
                  const params = {};
                  if (office_id) params.office_id = office_id;
                  if (from_date) params.start_date = from_date;
                  if (to_date)   params.end_date   = to_date;
                  const data = await mfFetch(token, '/journals', params);
                  return res.status(200).json({ ok: true, data });
        }

        // ── 月次PL試算表 ──
        if (action === 'trial_pl') {
                  const params = {};
                  if (office_id)   params.office_id   = office_id;
                  if (fiscal_year) params.fiscal_year = fiscal_year;
                  const data = await mfFetch(token, '/reports/trial_pl_three_years', params);
                  return res.status(200).json({ ok: true, data });
        }

        // ── Supabaseに保存 ──
        if (action === 'sync_to_dashboard') {
                  if (!fiscal_year) return res.status(400).json({ error: 'fiscal_year が必要です' });
                  const params = { fiscal_year };
                  if (office_id) params.office_id = office_id;
                  const plData = await mfFetch(token, '/reports/trial_pl_three_years', params);
                  await supabase.from('mf_sync_logs').insert({
                              fiscal_year: parseInt(fiscal_year),
                              company_id:  office_id || 'default',
                              action:      'sync_to_dashboard',
                              raw_data:    plData,
                              synced_at:   new Date().toISOString(),
                  });
                  return res.status(200).json({ ok: true, message: `${fiscal_year}年度PLデータ取得`, raw: plData });
        }

        return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
          console.error('[mf-sync]', err);
          return res.status(500).json({ error: err.message });
  }
}
