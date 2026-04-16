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
  const cashIn = new Array(n).fill(0);
  const cashOut = new Array(n).fill(0);
  const cashNames = ['普通預金','当座預金','現金'];
  journals.forEach(j => {
    const d = new Date(j.transaction_date);
    const idx = monthIdx.findIndex(m => m.year===d.getFullYear() && m.month===d.getMonth()+1);
    if (idx<0) return;
    (j.branches||[]).forEach(b => {
      const debit = b.debitor?.account_name||'';
      const credit = b.creditor?.account_name||'';
      const val = Math.round((b.debitor?.value||0)/1000);
      if (cashNames.some(a=>debit.includes(a))) cashIn[idx]+=val;
      if (cashNames.some(a=>credit.includes(a))) cashOut[idx]+=val;
    });
  });
  return {cashIn, cashOut, net: cashIn.map((v,i)=>v-cashOut[i])};
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
  const {action, office_id, fiscal_year, from_date, to_date} = req.query;
  try {
    const token = await getAccessToken();
    if (action==='debug') {
      const results={};
      for (const ep of ['/offices','/accounts','/partners','/sections']) {
        try { const d=await mfFetch(token,ep); results[ep]={ok:true,keys:Object.keys(d)}; }
        catch(e){ results[ep]={ok:false,error:e.message.slice(0,100)}; }
      }
      return res.status(200).json({ok:true,results});
    }
    if (action==='offices') return res.status(200).json({ok:true,data:await mfFetch(token,'/offices')});
    if (action==='accounts_nooffice') return res.status(200).json({ok:true,data:await mfFetch(token,'/accounts')});
    if (action==='accounts') return res.status(200).json({ok:true,data:await mfFetch(token,'/accounts',office_id?{office_id}:{})});
    if (action==='journals') {
      const p={};
      if (office_id) p.office_id=office_id;
      if (from_date) p.start_date=from_date;
      if (to_date) p.end_date=to_date;
      return res.status(200).json({ok:true,data:await mfFetch(token,'/journals',p)});
    }
    if (action==='trial_pl') {
      const p={}; if(office_id)p.office_id=office_id; if(fiscal_year)p.fiscal_year=fiscal_year;
      let data, lastErr;
      for (const ep of ['/reports/trial_pl_three_years','/reports/trial_pl']) {
        try { data=await mfFetch(token,ep,p); break; } catch(e){ lastErr=e; }
      }
      if (!data) throw lastErr;
      return res.status(200).json({ok:true,data});
    }
    if (action==='trial_bs') {
      const p={}; if(office_id)p.office_id=office_id; if(fiscal_year)p.fiscal_year=fiscal_year;
      let data, lastErr;
      for (const ep of ['/reports/trial_bs_three_years','/reports/trial_bs']) {
        try { data=await mfFetch(token,ep,p); break; } catch(e){ lastErr=e; }
      }
      if (!data) throw lastErr;
      return res.status(200).json({ok:true,data});
    }
    if (action==='pl_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const p={fiscal_year}; if(office_id)p.office_id=office_id;
      let raw, lastErr;
      for (const ep of ['/reports/trial_pl_three_years','/reports/trial_pl']) {
        try { raw=await mfFetch(token,ep,p); break; } catch(e){ lastErr=e; }
      }
      if (!raw) return res.status(404).json({error:'PLデータ取得失敗: '+(lastErr?.message||'')});
      return res.status(200).json({ok:true, fiscal_year, converted:convertPl(raw,fiscal_year), raw});
    }
    if (action==='bs_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const p={fiscal_year}; if(office_id)p.office_id=office_id;
      let raw, lastErr;
      for (const ep of ['/reports/trial_bs_three_years','/reports/trial_bs']) {
        try { raw=await mfFetch(token,ep,p); break; } catch(e){ lastErr=e; }
      }
      if (!raw) return res.status(404).json({error:'BSデータ取得失敗: '+(lastErr?.message||'')});
      return res.status(200).json({ok:true, fiscal_year, converted:convertBs(raw,fiscal_year), raw});
    }
    if (action==='cf_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const fy=parseInt(fiscal_year);
      const period=PERIODS[fy]||{start:fy+'-04-01',end:(fy+1)+'-03-31'};
      const p={start_date:period.start,end_date:period.end};
      if(office_id)p.office_id=office_id;
      let allJournals=[];
      for(let page=1;page<=20;page++){
        p.page=page;
        const data=await mfFetch(token,'/journals',p);
        allJournals=allJournals.concat(data.journals||[]);
        if(page>=(data.metadata?.total_pages||1))break;
      }
      return res.status(200).json({ok:true,fiscal_year,total_journals:allJournals.length,converted:convertCf(allJournals,fiscal_year)});
    }
    return res.status(400).json({error:'Unknown action: '+action});
  } catch(err) {
    console.error('[mf-sync]', err);
    return res.status(500).json({error:err.message});
  }
}
