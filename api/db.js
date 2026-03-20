import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    switch (action) {

      // ── 財務データ 読込 ──
      case 'load_fiscal': {
        const { data, error } = await supabase
          .from('fiscal_data')
          .select('*')
          .order('fiscal_year', { ascending: true });
        if (error) throw error;

        // { '2025': {...}, '2026': {...} } の形に変換
        const result = {};
        for (const row of data) {
          result[row.fiscal_year] = {
            months: row.months,
            pl: row.pl,
            cf: row.cf,
            reportData: row.report_data || {}
          };
        }
        return res.status(200).json({ ok: true, data: result });
      }

      // ── 財務データ 保存（年度ごと upsert）──
      case 'save_fiscal': {
        const { fiscal_year, months, pl, cf, reportData } = req.body;
        const { error } = await supabase
          .from('fiscal_data')
          .upsert({
            fiscal_year,
            months,
            pl,
            cf,
            report_data: reportData,
            updated_at: new Date().toISOString()
          }, { onConflict: 'fiscal_year' });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // ── シミュレーションデータ 読込 ──
      case 'load_sim': {
        const { data, error } = await supabase
          .from('sim_data')
          .select('*')
          .order('fiscal_year', { ascending: true });
        if (error) throw error;

        const result = {};
        for (const row of data) {
          result[row.fiscal_year] = row.data;
        }
        return res.status(200).json({ ok: true, data: result });
      }

      // ── シミュレーションデータ 保存 ──
      case 'save_sim': {
        const { fiscal_year, data } = req.body;
        const { error } = await supabase
          .from('sim_data')
          .upsert({
            fiscal_year,
            data,
            updated_at: new Date().toISOString()
          }, { onConflict: 'fiscal_year' });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // ── 予算変更履歴 読込 ──
      case 'load_history': {
        const { data, error } = await supabase
          .from('budget_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        return res.status(200).json({ ok: true, data });
      }

      // ── 予算変更履歴 追加 ──
      case 'add_history': {
        const { fiscal_year, author, reason, snapshot } = req.body;
        const { error } = await supabase
          .from('budget_history')
          .insert({
            fiscal_year,
            author,
            reason,
            snapshot,
            created_at: new Date().toISOString()
          });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[db]', err);
    return res.status(500).json({ error: err.message });
  }
}
