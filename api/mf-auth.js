import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

const MF_CLIENT_ID     = process.env.MF_CLIENT_ID;
const MF_CLIENT_SECRET = process.env.MF_CLIENT_SECRET;
const MF_REDIRECT_URI  = process.env.MF_REDIRECT_URI || 'https://neo-mg.vercel.app/mf-callback';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── 1. 認可URLを生成してリダイレクト ──
  if (action === 'login') {
        const scope = [
                'mfc/accounting/offices.read',
                'mfc/accounting/journal.read',
                'mfc/accounting/partner.read',
                'mfc/accounting/account_item.read',
                'mfc/accounting/section.read',
                'mfc/accounting/trial_balance.read',
              ].join(' ');

      const params = new URLSearchParams({
              client_id:     MF_CLIENT_ID,
              redirect_uri:  MF_REDIRECT_URI,
              response_type: 'code',
              scope,
      });

      const authUrl = `https://api.biz.moneyforward.com/authorize?${params}`;
        return res.redirect(302, authUrl);
  }

  // ── 2. 認可コード → アクセストークン交換 ──
  if (action === 'callback') {
        const { code, error: oauthError } = req.query;

      if (oauthError) {
              return res.redirect(302, `/?mf_error=${oauthError}`);
      }
        if (!code) {
                return res.status(400).json({ error: 'No code provided' });
        }

      try {
              const tokenRes = await fetch('https://api.biz.moneyforward.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                                    grant_type:    'authorization_code',
                                    client_id:     MF_CLIENT_ID,
                                    client_secret: MF_CLIENT_SECRET,
                                    redirect_uri:  MF_REDIRECT_URI,
                                    code,
                        }),
              });

          if (!tokenRes.ok) {
                    const errText = await tokenRes.text();
                    console.error('[mf-auth] token error:', errText);
                    return res.redirect(302, `/?mf_error=token_failed`);
          }

          const tokenData = await tokenRes.json();

          const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
              const { error: dbErr } = await supabase
                .from('mf_tokens')
                .upsert({
                            id:            'default',
                            access_token:  tokenData.access_token,
                            refresh_token: tokenData.refresh_token,
                            expires_at:    expiresAt,
                            updated_at:    new Date().toISOString(),
                }, { onConflict: 'id' });

          if (dbErr) {
                    console.error('[mf-auth] supabase error:', dbErr);
                    return res.redirect(302, `/?mf_error=db_failed`);
          }

          return res.redirect(302, '/?mf_connected=1');

      } catch (err) {
              console.error('[mf-auth] error:', err);
              return res.redirect(302, `/?mf_error=unknown`);
      }
  }

  // ── 3. トークン状態確認 ──
  if (action === 'status') {
        const { data, error } = await supabase
          .from('mf_tokens')
          .select('expires_at, updated_at')
          .eq('id', 'default')
          .maybeSingle();

      if (error || !data) {
              return res.status(200).json({ connected: false });
      }

      const isExpired = new Date(data.expires_at) < new Date();
        return res.status(200).json({
                connected:  true,
                expired:    isExpired,
                expires_at: data.expires_at,
                updated_at: data.updated_at,
        });
  }

  // ── 4. トークンリフレッシュ ──
  if (action === 'refresh') {
        const { data: tokenRow, error: fetchErr } = await supabase
          .from('mf_tokens')
          .select('refresh_token')
          .eq('id', 'default')
          .maybeSingle();

      if (fetchErr || !tokenRow) {
              return res.status(401).json({ error: 'No token found. Please reconnect.' });
      }

      try {
              const refreshRes = await fetch('https://api.biz.moneyforward.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                                    grant_type:    'refresh_token',
                                    client_id:     MF_CLIENT_ID,
                                    client_secret: MF_CLIENT_SECRET,
                                    refresh_token: tokenRow.refresh_token,
                        }),
              });

          if (!refreshRes.ok) {
                    return res.status(401).json({ error: 'Refresh failed. Please reconnect.' });
          }

          const newToken = await refreshRes.json();
              const expiresAt = new Date(Date.now() + newToken.expires_in * 1000).toISOString();

          await supabase.from('mf_tokens').upsert({
                    id:            'default',
                    access_token:  newToken.access_token,
                    refresh_token: newToken.refresh_token || tokenRow.refresh_token,
                    expires_at:    expiresAt,
                    updated_at:    new Date().toISOString(),
          }, { onConflict: 'id' });

          return res.status(200).json({ ok: true, expires_at: expiresAt });

      } catch (err) {
              console.error('[mf-auth] refresh error:', err);
              return res.status(500).json({ error: err.message });
      }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
