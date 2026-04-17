import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MF_API_BASE = 'https://api-accounting.moneyforward.com/api/v3';
async function getAccessToken() {
  const { data, error } = await supabase.from('mf_tokens').select('access_token,refresh_token,expires_at').eq('id','default').maybeSingle();
  if (error || !data) throw new Error('マネフォ未連携です。先に認証してください。');
  const expiresSoon = new Date(data.expires_at) < new Date(Date.now() + 5*60*1000);
  if (expiresSoon) {
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://neo-mg.vercel.app';
    const res = await fetch(`${baseUrl}/api/mf-auth?action=refresh`, {method:'POST'});
    if (!res.ok) throw new Error('リフレッシュ失敗。再認証してください。');
    const refreshed = await supabase.from('mf_tokens').select('access_token').eq('id','default').maybeSingle();
    return refreshed.data?.access_token;
  }
  return data.access_token;
}
async function mfFetch(token, path, params={}) {
  const url = new URL(MF_API_BASE+path);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url.toString(), {headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
  if (!res.ok) { const text = await res.text(); throw new Error('MF API error '+res.status+': '+text); }
  return res.json();
}

// ── 会計年度は4月〜3月（日本標準） ──
function buildMonthIndex(fiscalYear) {
  const fy = parseInt(fiscalYear);
  const months = [];
  for (let m = 4; m <= 12; m++) months.push({ year: fy, month: m });
  for (let m = 1; m <= 3; m++) months.push({ year: fy + 1, month: m });
  return months;
}

const ACCT_MAP = {
  '売上高':'rev','売上':'rev','会費収入':'rev','協賛金収入':'rev','入会金収入':'rev',
  '営業代行収入':'rev','受取手数料':'rev','雑収入':'rev',
  '役員報酬':'labor','給与手当':'labor','給料手当':'labor','給料賃金':'labor',
  '賞与':'labor','法定福利費':'labor','福利厚生費':'labor','退職金':'labor',
  '業務委託費':'outsource','業務委託料':'outsource','業務委託':'outsource',
  '広告宣伝費':'adv','販売促進費':'adv',
  '外注費':'gaichu','外注加工費':'gaichu','支払報酬':'gaichu',
  '仕入高':'cogs','原価':'cogs','会場費':'cogs',
};

// ── BS科目マッピング ──
const BS_ACCT_MAP = {
  '現金':'cash','小口現金':'cash','普通預金':'cash','当座預金':'cash','定期預金':'cash',
  '現金及び預金':'cash','現金・預金':'cash',
  '売掛金':'receivable','完成工事未収入金':'receivable','未収入金':'receivable',
  '前払費用':'other_ca','仮払金':'other_ca','立替金':'other_ca','短期貸付金':'other_ca',
  '繰延税金資産':'other_ca','商品':'other_ca','貯蔵品':'other_ca',
  '建物':'fixed','建物附属設備':'fixed','構築物':'fixed','車両運搬具':'fixed',
  '工具器具備品':'fixed','土地':'fixed','ソフトウェア':'fixed','のれん':'fixed',
  '投資有価証券':'fixed','出資金':'fixed','保証金':'fixed','敷金':'fixed',
  '買掛金':'payable','未払金':'payable','未払費用':'payable',
  '未払法人税等':'payable','未払消費税等':'payable','前受金':'payable','預り金':'payable',
  '短期借入金':'borrowing','長期借入金':'borrowing',
  '1年内返済予定の長期借入金':'borrowing','1年以内返済予定の長期借入金':'borrowing',
  '仮受金':'other_cl','前受収益':'other_cl','賞与引当金':'other_cl',
  '資本金':'capital','資本準備金':'capital','その他資本剰余金':'capital',
  '利益準備金':'retained','繰越利益剰余金':'retained','別途積立金':'retained',
  'その他利益剰余金':'retained',
};

function convertPl(plRaw, fiscalYear) {
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;
  const PL_KEYS = ['rev','labor','outsource','adv','gaichu','other','cogs'];
  const result = {};
  PL_KEYS.forEach(k => { result[k] = { actual: new Array(n).fill(0) }; });
  const balances = plRaw?.balances || plRaw?.account_item_balances || plRaw?.items || [];
  balances.forEach(item => {
    const name = item.account_item_name || item.name || '';
    const dbKey = ACCT_MAP[name] || 'other';
    const monthly = item.monthly_closing_balances || item.month_balances || item.monthly || [];
    monthly.forEach(mb => {
      const yr = mb.year || mb.fiscal_year;
      const mo = mb.month;
      const idx = monthIdx.findIndex(m => m.year === yr && m.month === mo);
      if (idx >= 0) {
        // 収益は正、費用は正（千円）
        const val = Math.round(Math.abs(mb.closing_balance || mb.amount || 0) / 1000);
        result[dbKey].actual[idx] += val;
      }
    });
  });
  return result;
}

function convertBs(bsRaw, fiscalYear) {
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;
  const BS_KEYS = ['cash','receivable','other_ca','fixed','payable','borrowing','other_cl','capital','retained'];
  // 月次配列
  const monthly = {};
  BS_KEYS.forEach(k => { monthly[k] = new Array(n).fill(0); });
  // サマリー（年次BS_DATA用）
  const summary = { cash:0, receivable:0, other_ca:0, fixed:0, payable:0, borrowing:0, other_cl:0, capital:0, retained:0 };

  const balances = bsRaw?.balances || bsRaw?.account_item_balances || bsRaw?.items || [];
  balances.forEach(item => {
    const name = item.account_item_name || item.name || '';
    const cat = item.account_category_name || item.category || '';
    let dbKey = BS_ACCT_MAP[name];
    // マッピングに無い場合はカテゴリから推定
    if (!dbKey) {
      if (/流動資産/.test(cat) && !/現金|預金|売掛|未収/.test(name)) dbKey = 'other_ca';
      else if (/固定資産|投資/.test(cat)) dbKey = 'fixed';
      else if (/流動負債/.test(cat)) dbKey = 'other_cl';
      else if (/固定負債/.test(cat)) dbKey = 'borrowing';
      else if (/純資産|資本/.test(cat)) {
        if (/資本金|資本準備金|資本剰余金/.test(name)) dbKey = 'capital';
        else dbKey = 'retained';
      }
    }
    if (!dbKey) return;

    // 月次データ取得
    const monthlyBal = item.monthly_closing_balances || item.month_balances || item.monthly || [];
    if (monthlyBal.length > 0) {
      monthlyBal.forEach(mb => {
        const yr = mb.year || mb.fiscal_year;
        const mo = mb.month;
        const idx = monthIdx.findIndex(m => m.year === yr && m.month === mo);
        if (idx >= 0) {
          // 資産・純資産は正、負債は正（千円）
          // 利益剰余金はマイナスの場合があるので符号を保持
          const isNegativeOk = (dbKey === 'retained' || dbKey === 'capital');
          const raw = mb.closing_balance || mb.amount || 0;
          const val = isNegativeOk ? Math.round(raw / 1000) : Math.round(Math.abs(raw) / 1000);
          monthly[dbKey][idx] += val;
        }
      });
    }

    // サマリー（最終残高）
    const closingRaw = item.closing_balance || 0;
    const isNegativeOk = (dbKey === 'retained' || dbKey === 'capital');
    const closingVal = isNegativeOk ? Math.round(closingRaw / 1000) : Math.round(Math.abs(closingRaw) / 1000);
    summary[dbKey] += closingVal;
  });

  return { monthly, summary };
}

function convertCf(journals, fiscalYear) {
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;
  // CF詳細科目ごとに月次配列を構築
  const CF_KEYS = ['cfIn','cfInFee','cfInTraining','cfInOther','loanIn','capitalIn',
    'salaryPay','bizComPay','expertPay','rentPay','telPay','entertainPay','taxPay',
    'toolsPay','suppliesPay','adSportsPay','eventCostPay','recruitPay','annualFeePay',
    'investPay','loanOut','salesOtherPay','expensePay'];
  const monthly = {};
  CF_KEYS.forEach(k => { monthly[k] = new Array(n).fill(0); });
  const cashIn = new Array(n).fill(0);
  const cashOut = new Array(n).fill(0);
  const cashNames = ['普通預金','当座預金','現金','小口現金','定期預金'];

  // カテゴリ推定（仕訳の摘要/勘定科目から判定）
  function categorize(desc, isIn) {
    const d = (desc || '').toLowerCase().replace(/\s|　/g, '');
    if (isIn) {
      if (/会費|membership|入会金/.test(d)) return 'cfInFee';
      if (/研修|training|セミナー/.test(d)) return 'cfInTraining';
      if (/借入|融資|ローン着金/.test(d)) return 'loanIn';
      if (/資本金|払込|出資/.test(d)) return 'capitalIn';
      if (/売上|入金|振込/.test(d)) return 'cfIn';
      return 'cfInOther';
    } else {
      if (/給与|給料|賞与|役員報酬|社会保険|社保|厚生年金/.test(d)) return 'salaryPay';
      if (/業務委託|外部委託|フリーランス/.test(d)) return 'bizComPay';
      if (/顧問|弁護士|税理士|社労士|報酬/.test(d)) return 'expertPay';
      if (/家賃|地代|賃料|rent/.test(d)) return 'rentPay';
      if (/ntt|softbank|ソフトバンク|docomo|kddi|通信|電話|インターネット/.test(d)) return 'telPay';
      if (/aws|azure|google|slack|zoom|notion|adobe|サブスク|クラウド/.test(d)) return 'toolsPay';
      if (/広告|facebook|meta|instagram|google ads|媒体/.test(d)) return 'adSportsPay';
      if (/indeed|wantedly|採用|求人/.test(d)) return 'recruitPay';
      if (/返済|弁済|loanout/.test(d)) return 'loanOut';
      if (/設備|投資|固定資産/.test(d)) return 'investPay';
      if (/交際|接待|会議|レストラン/.test(d)) return 'entertainPay';
      if (/税|印紙|国税|都税/.test(d)) return 'taxPay';
      if (/消耗|備品|文具|amazon|モノタロウ/.test(d)) return 'suppliesPay';
      if (/イベント|会場|設営|音響/.test(d)) return 'eventCostPay';
      return 'salesOtherPay';
    }
  }

  // サンプル仕訳（プレビュー用に上位100件のみ）
  const samples = [];

  journals.forEach(j => {
    const d = new Date(j.transaction_date);
    const idx = monthIdx.findIndex(m => m.year === d.getFullYear() && m.month === d.getMonth() + 1);
    if (idx < 0) return;
    (j.branches || []).forEach(b => {
      const debit  = b.debitor?.account_name || '';
      const credit = b.creditor?.account_name || '';
      const val = Math.round((b.debitor?.value || b.creditor?.value || 0) / 1000);
      if (val === 0) return;

      const desc = j.remark || j.description || j.memo || '';

      // 借方に現預金が来る → 入金
      if (cashNames.some(a => debit.includes(a))) {
        cashIn[idx] += val;
        // カテゴリは貸方の勘定科目名で判定、それでもだめなら摘要
        const cat = categorize(credit || desc, true);
        monthly[cat][idx] += val;
        monthly.cfIn[idx] += val;
        if (samples.length < 100) samples.push({ date: j.transaction_date, debit, credit, val, cat, dir: 'in', desc });
      }
      // 貸方に現預金が来る → 出金
      else if (cashNames.some(a => credit.includes(a))) {
        cashOut[idx] += val;
        const cat = categorize(debit || desc, false);
        monthly[cat][idx] += val;
        if (samples.length < 100) samples.push({ date: j.transaction_date, debit, credit, val, cat, dir: 'out', desc });
      }
    });
  });

  return { cashIn, cashOut, net: cashIn.map((v,i) => v - cashOut[i]), monthly, samples };
}

// ── 会計年度期間（4月〜3月） ──
const PERIODS = {
  2024: { start:'2024-04-01', end:'2025-03-31' },
  2025: { start:'2025-04-01', end:'2026-03-31' },
  2026: { start:'2026-04-01', end:'2027-03-31' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  const {action, office_id: queryOfficeId, fiscal_year, from_date, to_date} = req.query;
  try {
    const token = await getAccessToken();

    // ── office_id 自動解決（未指定時は最初の事業者を使用） ──
    async function resolveOfficeId(provided) {
      if (provided) return provided;
      try {
        const data = await mfFetch(token, '/offices');
        // 形式1: 単一オブジェクト {id, name, ...}
        if (data?.id) return String(data.id);
        if (data?.office_id) return String(data.office_id);
        // 形式A: MFクラウド会計Plus形式 → code を使用（idがない場合）
        if (data?.code) return String(data.code);
        // 形式2: 配列 [{id, name, ...}, ...]
        if (Array.isArray(data) && data.length > 0) return String(data[0].id || data[0].office_id || data[0].code);
        // 形式3: {data: [...]} or {offices: [...]}
        const list = data?.data || data?.offices;
        if (Array.isArray(list) && list.length > 0) return String(list[0].id || list[0].office_id || list[0].code);
        if (list && !Array.isArray(list) && (list.id || list.office_id || list.code)) {
          return String(list.id || list.office_id || list.code);
        }
        console.warn('[mf-sync] resolveOfficeId: unknown format, keys:', Object.keys(data));
      } catch(e) {
        console.warn('[mf-sync] resolveOfficeId failed:', e.message);
      }
      return null;
    }

    // ── accounting_period_id 自動解決（/offices の accounting_periods から） ──
    async function resolveAccountingPeriodId(fiscalYear) {
      try {
        const data = await mfFetch(token, '/offices');
        const periods = data?.accounting_periods || [];
        if (!Array.isArray(periods) || periods.length === 0) return null;
        // fiscal_year 指定あり → 期間開始月から推定
        if (fiscalYear) {
          const fy = parseInt(fiscalYear);
          // 会計期間の start_date が fy年4月〜fy年6月 の範囲にあるものを優先
          const matched = periods.find(p => {
            const start = new Date(p.start_date || p.start || '');
            if (isNaN(start)) return false;
            return start.getFullYear() === fy && start.getMonth() >= 3 && start.getMonth() <= 6;
          });
          if (matched) return String(matched.id || matched.period_id || matched.accounting_period_id);
        }
        // 最新の期間（または current フラグ付きの期間）
        const current = periods.find(p => p.is_current || p.current);
        const target = current || periods[periods.length - 1];
        return String(target.id || target.period_id || target.accounting_period_id);
      } catch(e) {
        console.warn('[mf-sync] resolveAccountingPeriodId failed:', e.message);
      }
      return null;
    }

    if (action==='debug') {
      const results = {};
      // 基本エンドポイント
      for (const ep of ['/offices','/accounts','/partners','/sections']) {
        try { const d=await mfFetch(token,ep); results[ep]={ok:true,keys:Object.keys(d)}; }
        catch(e){ results[ep]={ok:false,error:e.message.slice(0,200)}; }
      }
      // ID解決
      const oid = await resolveOfficeId(queryOfficeId);
      const apid = await resolveAccountingPeriodId(fiscal_year);
      results._resolved_office_id = oid;
      results._resolved_accounting_period_id = apid;

      // /offices の accounting_periods を取得してレスポンスに含める
      try {
        const off = await mfFetch(token, '/offices');
        results._accounting_periods = (off?.accounting_periods || []).map(p => ({
          id: p.id || p.period_id || p.accounting_period_id,
          start_date: p.start_date || p.start,
          end_date: p.end_date || p.end,
          is_current: p.is_current || p.current || false,
        }));
      } catch(e) { results._accounting_periods_err = e.message.slice(0,100); }

      const fy = fiscal_year || '2025';
      // 複数の URL パターン × パラメータ組み合わせを試す
      const paramVariants = [
        apid ? { accounting_period_id: apid } : null,
        apid && oid ? { accounting_period_id: apid, office_id: oid } : null,
        { fiscal_year: fy },
        oid ? { office_id: oid, fiscal_year: fy } : null,
      ].filter(Boolean);

      const endpointVariants = [
        '/reports/trial_pl',
        '/reports/trial_pl_three_years',
        '/reports/trial_pl_by_months',
        oid ? `/offices/${oid}/reports/trial_pl` : null,
        oid ? `/offices/${oid}/reports/trial_pl_by_months` : null,
        '/reports/trial_bs',
        '/reports/trial_bs_three_years',
        '/reports/trial_bs_by_months',
        oid ? `/offices/${oid}/reports/trial_bs` : null,
      ].filter(Boolean);

      for (const ep of endpointVariants) {
        for (let pi = 0; pi < paramVariants.length; pi++) {
          const params = paramVariants[pi];
          const key = ep + ' [' + Object.keys(params).join(',') + ']';
          try {
            const d = await mfFetch(token, ep, params);
            results[key] = { ok: true, keys: Object.keys(d).slice(0, 10) };
            break; // このエンドポイントで成功したら次へ
          } catch(e) {
            results[key] = { ok: false, error: e.message.slice(0, 150) };
          }
        }
      }
      return res.status(200).json({ok:true,results});
    }
    if (action==='offices') return res.status(200).json({ok:true,data:await mfFetch(token,'/offices')});
    if (action==='accounts_nooffice') return res.status(200).json({ok:true,data:await mfFetch(token,'/accounts')});
    if (action==='accounts') {
      const oid = await resolveOfficeId(queryOfficeId);
      return res.status(200).json({ok:true,data:await mfFetch(token,'/accounts',oid?{office_id:oid}:{})});
    }
    if (action==='journals') {
      const oid = await resolveOfficeId(queryOfficeId);
      const p = {};
      if (oid) p.office_id = oid;
      if (from_date) p.start_date = from_date;
      if (to_date) p.end_date = to_date;
      return res.status(200).json({ok:true,data:await mfFetch(token,'/journals',p)});
    }
    // ── レポート取得: 複数のURLパターン × パラメータを試行 ──
    async function fetchReportWithFallback(kind, fy) {
      const oid = await resolveOfficeId(queryOfficeId);
      const apid = await resolveAccountingPeriodId(fy);
      // パラメータの組み合わせ候補
      const paramVariants = [
        apid ? { accounting_period_id: apid } : null,
        apid && oid ? { accounting_period_id: apid, office_id: oid } : null,
        fy ? { fiscal_year: fy } : null,
        fy && oid ? { fiscal_year: fy, office_id: oid } : null,
      ].filter(Boolean);

      const base = kind === 'pl' ? 'trial_pl' : 'trial_bs';
      const endpointVariants = [
        `/reports/${base}_by_months`,
        `/reports/${base}`,
        `/reports/${base}_three_years`,
        oid ? `/offices/${oid}/reports/${base}_by_months` : null,
        oid ? `/offices/${oid}/reports/${base}` : null,
      ].filter(Boolean);

      const attempts = [];
      for (const ep of endpointVariants) {
        for (const params of paramVariants) {
          try {
            const data = await mfFetch(token, ep, params);
            return { data, usedEndpoint: ep, usedParams: params, oid, apid, attempts };
          } catch(e) {
            attempts.push(`${ep} [${Object.keys(params).join(',')}]: ${e.message.slice(0,80)}`);
          }
        }
      }
      return { error: 'all patterns failed', oid, apid, attempts };
    }

    if (action==='trial_pl') {
      const result = await fetchReportWithFallback('pl', fiscal_year);
      if (!result.data) {
        return res.status(404).json({ error: 'PL取得失敗', detail: result.attempts, office_id: result.oid, accounting_period_id: result.apid });
      }
      return res.status(200).json({ok:true, data:result.data, _endpoint:result.usedEndpoint, _params:result.usedParams});
    }
    if (action==='trial_bs') {
      const result = await fetchReportWithFallback('bs', fiscal_year);
      if (!result.data) {
        return res.status(404).json({ error: 'BS取得失敗', detail: result.attempts, office_id: result.oid, accounting_period_id: result.apid });
      }
      return res.status(200).json({ok:true, data:result.data, _endpoint:result.usedEndpoint, _params:result.usedParams});
    }
    if (action==='pl_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const result = await fetchReportWithFallback('pl', fiscal_year);
      if (!result.data) {
        return res.status(404).json({
          error: `PLデータ取得失敗 (office_id=${result.oid||'未取得'}, accounting_period_id=${result.apid||'未取得'})`,
          detail: result.attempts
        });
      }
      return res.status(200).json({
        ok: true, fiscal_year,
        office_id: result.oid, accounting_period_id: result.apid,
        _endpoint: result.usedEndpoint, _params: result.usedParams,
        converted: convertPl(result.data, fiscal_year), raw: result.data
      });
    }
    if (action==='bs_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const result = await fetchReportWithFallback('bs', fiscal_year);
      if (!result.data) {
        return res.status(404).json({
          error: `BSデータ取得失敗 (office_id=${result.oid||'未取得'}, accounting_period_id=${result.apid||'未取得'})`,
          detail: result.attempts
        });
      }
      return res.status(200).json({
        ok: true, fiscal_year,
        office_id: result.oid, accounting_period_id: result.apid,
        _endpoint: result.usedEndpoint, _params: result.usedParams,
        converted: convertBs(result.data, fiscal_year), raw: result.data
      });
    }
    if (action==='cf_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const fy = parseInt(fiscal_year);
      const period = PERIODS[fy] || { start: fy+'-04-01', end: (fy+1)+'-03-31' };
      const oid = await resolveOfficeId(queryOfficeId);
      const p = { start_date: period.start, end_date: period.end };
      if (oid) p.office_id = oid;
      let allJournals = [];
      for (let page = 1; page <= 20; page++) {
        p.page = page;
        const data = await mfFetch(token, '/journals', p);
        allJournals = allJournals.concat(data.journals || data.data || []);
        if (page >= (data.metadata?.total_pages || data.total_pages || 1)) break;
      }
      return res.status(200).json({ok:true, fiscal_year, office_id:oid, total_journals:allJournals.length, converted:convertCf(allJournals,fiscal_year)});
    }
    return res.status(400).json({error:'Unknown action: '+action});
  } catch(err) {
    console.error('[mf-sync]', err);
    return res.status(500).json({error:err.message});
  }
}
