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

      // ── バージョン履歴 読込 ──
      case 'load_versions': {
        const { data, error } = await supabase
          .from('app_versions')
          .select('version_id, description, saved_at, fiscal_year, db_snapshot, sim_snapshot')
          .order('saved_at', { ascending: false })
          .limit(30);
        if (error) throw error;
        return res.status(200).json({ ok: true, data: data || [] });
      }

      // ── バージョン履歴 保存 ──
      case 'save_version': {
        const { version_id, description, saved_at, fiscal_year, db_snapshot, sim_snapshot } = req.body;
        const { error } = await supabase
          .from('app_versions')
          .upsert({
            version_id,
            description,
            saved_at,
            fiscal_year: fiscal_year || null,
            db_snapshot,
            sim_snapshot,
          }, { onConflict: 'version_id' });
        if (error) throw error;
        // 30件超えたら古いものを削除
        const { data: allVers } = await supabase
          .from('app_versions')
          .select('version_id')
          .order('saved_at', { ascending: false });
        if (allVers && allVers.length > 30) {
          const toDelete = allVers.slice(30).map(v => v.version_id);
          await supabase.from('app_versions').delete().in('version_id', toDelete);
        }
        return res.status(200).json({ ok: true });
      }

      // ── バージョン削除 ──
      case 'delete_version': {
        const { version_id } = req.body;
        const { error } = await supabase
          .from('app_versions')
          .delete()
          .eq('version_id', version_id);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // ── Phase 2: cells テーブル ──

      // セル群の一括 upsert（差分書き込み）
      // body: { cells: [{ fiscal_year, sheet, row_key, month_idx, value }, ...] }
      case 'bulk_save_cells': {
        const cells = Array.isArray(req.body?.cells) ? req.body.cells : [];
        if (cells.length === 0) return res.status(200).json({ ok: true, count: 0 });
        // updated_at を今で上書き
        const now = new Date().toISOString();
        const rows = cells.map(c => ({
          fiscal_year: String(c.fiscal_year),
          sheet:       String(c.sheet),
          row_key:     String(c.row_key),
          month_idx:   Number(c.month_idx),
          value:       (c.value === '' || c.value == null) ? null : Number(c.value),
          updated_at:  now,
        }));
        const { error } = await supabase
          .from('cells')
          .upsert(rows, { onConflict: 'fiscal_year,sheet,row_key,month_idx' });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: rows.length });
      }

      // セルを年度（任意でsheet）でロード
      // query: ?action=load_cells&fiscal_year=2025[&sheet=sim_cf]
      case 'load_cells': {
        const fiscal_year = req.query.fiscal_year;
        const sheet       = req.query.sheet;
        let q = supabase.from('cells').select('fiscal_year,sheet,row_key,month_idx,value,updated_at');
        if (fiscal_year) q = q.eq('fiscal_year', String(fiscal_year));
        if (sheet)       q = q.eq('sheet', String(sheet));
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ ok: true, data: data || [] });
      }

      // カスタム行 一括 upsert
      // body: { rows: [{ fiscal_year, sheet, row_key, label, attrs, position }, ...] }
      case 'bulk_save_custom_rows': {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (rows.length === 0) return res.status(200).json({ ok: true, count: 0 });
        const payload = rows.map(r => ({
          fiscal_year: String(r.fiscal_year),
          sheet:       String(r.sheet),
          row_key:     String(r.row_key),
          label:       String(r.label || ''),
          attrs:       r.attrs || {},
          position:    Number(r.position || 0),
        }));
        const { error } = await supabase
          .from('custom_rows')
          .upsert(payload, { onConflict: 'fiscal_year,sheet,row_key' });
        if (error) throw error;
        return res.status(200).json({ ok: true, count: payload.length });
      }

      // カスタム行 ロード
      case 'load_custom_rows': {
        const fiscal_year = req.query.fiscal_year;
        let q = supabase.from('custom_rows').select('*').order('position', { ascending: true });
        if (fiscal_year) q = q.eq('fiscal_year', String(fiscal_year));
        const { data, error } = await q;
        if (error) throw error;
        return res.status(200).json({ ok: true, data: data || [] });
      }

      // カスタム行 削除
      case 'delete_custom_row': {
        const { fiscal_year, sheet, row_key } = req.body;
        const { error } = await supabase
          .from('custom_rows')
          .delete()
          .eq('fiscal_year', String(fiscal_year))
          .eq('sheet', String(sheet))
          .eq('row_key', String(row_key));
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      // 年度メタ 保存（months / reportData）
      case 'save_fiscal_meta': {
        const { fiscal_year, months, report_data } = req.body;
        const { error } = await supabase
          .from('fiscal_meta')
          .upsert({
            fiscal_year: String(fiscal_year),
            months: months ?? null,
            report_data: report_data ?? {},
            updated_at: new Date().toISOString(),
          }, { onConflict: 'fiscal_year' });
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      case 'load_fiscal_meta': {
        const { data, error } = await supabase
          .from('fiscal_meta')
          .select('*')
          .order('fiscal_year', { ascending: true });
        if (error) throw error;
        return res.status(200).json({ ok: true, data: data || [] });
      }

      // ── 一回限りの移行: 既存 fiscal_data / sim_data の JSONB を cells / custom_rows / fiscal_meta に展開 ──
      // 何度実行しても upsert なので冪等。
      // 呼び出し: GET /api/db?action=migrate_to_cells
      case 'migrate_to_cells': {
        const summary = { cells: 0, custom_rows: 0, fiscal_meta: 0, errors: [] };

        // sim_data → cells (sim_pl, sim_cf) + custom_rows + fiscal_meta(.months なし)
        {
          const { data: simRows, error } = await supabase.from('sim_data').select('*');
          if (error) throw error;
          for (const row of simRows || []) {
            const fy   = row.fiscal_year;
            const data = row.data || {};
            const cells = [];

            // pl
            for (const [key, arr] of Object.entries(data.pl || {})) {
              if (!Array.isArray(arr)) continue;
              for (let i = 0; i < arr.length; i++) {
                cells.push({ fiscal_year: fy, sheet: 'sim_pl', row_key: key, month_idx: i,
                             value: arr[i] === '' || arr[i] == null ? null : Number(arr[i]) });
              }
            }
            // cf
            for (const [key, val] of Object.entries(data.cf || {})) {
              if (key === 'cfOpenFirst') {
                cells.push({ fiscal_year: fy, sheet: 'sim_cf', row_key: 'cfOpenFirst', month_idx: -1,
                             value: val === '' || val == null ? null : Number(val) });
                continue;
              }
              if (!Array.isArray(val)) continue;
              for (let i = 0; i < val.length; i++) {
                cells.push({ fiscal_year: fy, sheet: 'sim_cf', row_key: key, month_idx: i,
                             value: val[i] === '' || val[i] == null ? null : Number(val[i]) });
              }
            }
            if (cells.length) {
              const { error: e2 } = await supabase.from('cells')
                .upsert(cells, { onConflict: 'fiscal_year,sheet,row_key,month_idx' });
              if (e2) summary.errors.push(`sim ${fy} cells: ${e2.message}`);
              else summary.cells += cells.length;
            }

            // custom rows
            const customs = [];
            (data.customRows || []).forEach((r, i) => {
              if (!r || !r.key) return;
              customs.push({
                fiscal_year: fy, sheet: 'sim_pl', row_key: r.key,
                label: r.label || r.key,
                attrs: { isRev: !!r.isRev, isCost: !!r.isCost, parentKey: r.parentKey || null, indent: !!r.indent, depth: r.depth || 0 },
                position: i,
              });
            });
            (data.cfCustomRows || []).forEach((r, i) => {
              if (!r || !r.key) return;
              customs.push({
                fiscal_year: fy, sheet: 'sim_cf', row_key: r.key,
                label: r.label || r.key,
                attrs: { isIn: !!r.isIn, isOut: !!r.isOut, parentKey: r.parentKey || null, indent: !!r.indent, depth: r.depth || 0 },
                position: i,
              });
            });
            if (customs.length) {
              const { error: e3 } = await supabase.from('custom_rows')
                .upsert(customs, { onConflict: 'fiscal_year,sheet,row_key' });
              if (e3) summary.errors.push(`sim ${fy} custom_rows: ${e3.message}`);
              else summary.custom_rows += customs.length;
            }
          }
        }

        // fiscal_data → cells (fiscal_pl_budget/actual, fiscal_cf_budget/actual) + fiscal_meta
        {
          const { data: fdRows, error } = await supabase.from('fiscal_data').select('*');
          if (error) throw error;
          for (const row of fdRows || []) {
            const fy = row.fiscal_year;
            const cells = [];

            const explode = (sheetName, kvObj) => {
              for (const [key, arr] of Object.entries(kvObj || {})) {
                if (!Array.isArray(arr)) continue;
                for (let i = 0; i < arr.length; i++) {
                  cells.push({ fiscal_year: fy, sheet: sheetName, row_key: key, month_idx: i,
                               value: arr[i] === '' || arr[i] == null ? null : Number(arr[i]) });
                }
              }
            };
            explode('fiscal_pl_budget', row.pl?.budget);
            explode('fiscal_pl_actual', row.pl?.actual);
            explode('fiscal_cf_budget', row.cf?.budget);
            explode('fiscal_cf_actual', row.cf?.actual);

            if (cells.length) {
              const { error: e2 } = await supabase.from('cells')
                .upsert(cells, { onConflict: 'fiscal_year,sheet,row_key,month_idx' });
              if (e2) summary.errors.push(`fiscal ${fy} cells: ${e2.message}`);
              else summary.cells += cells.length;
            }

            // meta
            const { error: e3 } = await supabase.from('fiscal_meta').upsert({
              fiscal_year: fy,
              months: row.months || null,
              report_data: row.report_data || {},
              updated_at: new Date().toISOString(),
            }, { onConflict: 'fiscal_year' });
            if (e3) summary.errors.push(`fiscal ${fy} meta: ${e3.message}`);
            else summary.fiscal_meta += 1;
          }
        }

        return res.status(200).json({ ok: true, summary });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[db]', err);
    return res.status(500).json({ error: err.message });
  }
}
