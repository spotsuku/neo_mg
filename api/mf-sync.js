import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const MF_API_BASE = 'https://api-accounting.moneyforward.com/api/v3';
async function getAccessToken() {
  const { data, error } = await supabase.from('mf_tokens').select('access_token,refresh_token,expires_at').eq('id','default').maybeSingle();
  if (error || !data) throw new Error('マネフォ未連携です。先に認証してください。');
  const expiresSoon = new Date(data.expires_at) < new Date(Date.now() + 5*60*1000);
  if (expiresSoon) {
    const res = await fetch('https://neo-mg.vercel.app/api/mf-auth?action=refresh', {method:'POST'});
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
function buildMonthIndex(fiscalYear) {
  const fy = parseInt(fiscalYear);
  const months = [];
  for (let m=7; m<=12; m++) months.push({year:fy, month:m});
  const endMonth = (fy===2025) ? 3 : 6;
  for (let m=1; m<=endMonth; m++) months.push({year:fy+1, month:m});
  return months;
}
const ACCT_MAP = {
  '売上高':'rev','売上':'rev','会費収入':'rev','協賛金収入':'rev','入会金収入':'rev','営業代行収入':'rev','受取手数料':'rev','雑収入':'rev',
  '役員報酬':'labor','給与手当':'labor','給料手当':'labor','賞与':'labor','法定福利費':'labor','福利厚生費':'labor','退職金':'labor',
  '業務委袗費':'outsource','業務委袗':'outsource',
  '広告宣伝費':'adv','販売促進費':'adv',
  '外注費':'gaichu','外注加工費':'gaichu',
  '仕入高':'cogs','原価':'cogs','会場費':'cogs',
};
function convertPl(plRaw, fiscalYear) {
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;
  const PL_KEYS = ['rev','labor','outsource','adv','gaichu','other','cogs'];
  const result = {};
  PL_KEYS.forEach(k => { result[k] = {actual: new Array(n).fill(0)}; });
  const balances = plRaw?.balances || plRaw?.account_item_balances || plRaw?.items || [];
  balances.forEach(item => {
    const name = item.account_item_name || item.name || '';
    const dbKey = ACCT_MAP[name] || 'other';
    const monthly = item.monthly_closing_balances || item.month_balances || item.monthly || [];
    monthly.forEach(mb => {
      const yr = mb.year || mb.fiscal_year;
      const mo = mb.month;
      const idx = monthIdx.findIndex(m => m.year===yr && m.month===mo);
      if (idx >= 0) {
        const val = Math.round(Math.abs(mb.closing_balance||mb.amount||0)/1000);
        result[dbKey].actual[idx] += val;
      }
    });
  });
  return result;
}
function convertBs(bsRaw) {
  const result = {cash:0, receivable:0, payable:0, assets:{}, liabilities:{}, equity:{}};
  const balances = bsRaw?.balances || bsRaw?.account_item_balances || bsRaw?.items || [];
  balances.forEach(item => {
    const name = item.account_item_name || item.name || '';
    const closing = Math.round(Math.abs(item.closing_balance||0)/1000);
    const cat = item.account_category_name || item.category || '';
    if (/現金|普通預金|当座預金/.test(name)) result.cash += closing;
    if (/売掛金|未収/.test(name)) result.receivable += closing;
    if (/買掛金|未払/.test(name)) result.payable += closing;
    if (/資産/.test(cat)) result.assets[name] = closing;
    else if (/負債/.test(cat)) result.liabilities[name] = closing;
    else if (/純資産|資本/.test(cat)) result.equity[name] = closing;
  });
  result.totalAssets = Object.values(result.assets).reduce((s,v)=>s+v,0);
  result.totalLiabilities = Object.values(result.liabilities).reduce((s,v)=>s+v,0);
  result.totalEquity = Object.values(result.equity).reduce((s,v)=>s+v,0);
  return result;
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
const PERIODS = {
  2025:{start:'2025-07-01',end:'2026-03-31'},
  2024:{start:'2024-07-01',end:'2025-06-30'},
  2023:{start:'2023-07-01',end:'2024-06-30'},
  2026:{start:'2026-07-01',end:'2027-06-30'},
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
      const eps=['/offices','/accounts','/partners','/sections','/items',
        '/trial_pl','/trial_bs','/trial_pl_three_years','/trial_bs_three_years',
        '/trial_pl_sections','/reports/trial_pl','/reports/trial_bs'];
      for (const ep of eps) {
        try { const d=await mfFetch(token,ep); results[ep]={ok:true,keys:Object.keys(d||{})}; }
        catch(e){ results[ep]={ok:false,error:e.message.slice(0,120)}; }
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
    const PL_ENDPOINTS = ['/trial_pl_three_years','/trial_pl','/trial_pl_sections','/reports/trial_pl_three_years','/reports/trial_pl'];
    const BS_ENDPOINTS = ['/trial_bs_three_years','/trial_bs','/reports/trial_bs_three_years','/reports/trial_bs'];
    if (action==='trial_pl') {
      const p={}; if(office_id)p.office_id=office_id; if(fiscal_year)p.fiscal_year=fiscal_year;
      let data, lastErr, usedEp;
      for (const ep of PL_ENDPOINTS) {
        try { data=await mfFetch(token,ep,p); usedEp=ep; break; } catch(e){ lastErr=e; }
      }
      if (!data) throw lastErr;
      return res.status(200).json({ok:true,endpoint:usedEp,data});
    }
    if (action==='trial_bs') {
      const p={}; if(office_id)p.office_id=office_id; if(fiscal_year)p.fiscal_year=fiscal_year;
      let data, lastErr, usedEp;
      for (const ep of BS_ENDPOINTS) {
        try { data=await mfFetch(token,ep,p); usedEp=ep; break; } catch(e){ lastErr=e; }
      }
      if (!data) throw lastErr;
      return res.status(200).json({ok:true,endpoint:usedEp,data});
    }
    if (action==='pl_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const p={fiscal_year}; if(office_id)p.office_id=office_id;
      let raw, lastErr, usedEp;
      for (const ep of PL_ENDPOINTS) {
        try { raw=await mfFetch(token,ep,p); usedEp=ep; break; } catch(e){ lastErr=e; }
      }
      if (!raw) return res.status(404).json({error:'PLデータ取得失敗: '+(lastErr?.message||'')});
      return res.status(200).json({ok:true, fiscal_year, endpoint:usedEp, converted:convertPl(raw,fiscal_year), raw});
    }
    if (action==='bs_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const p={fiscal_year}; if(office_id)p.office_id=office_id;
      let raw, lastErr, usedEp;
      for (const ep of BS_ENDPOINTS) {
        try { raw=await mfFetch(token,ep,p); usedEp=ep; break; } catch(e){ lastErr=e; }
      }
      if (!raw) return res.status(404).json({error:'BSデータ取得失敗: '+(lastErr?.message||'')});
      return res.status(200).json({ok:true, fiscal_year, endpoint:usedEp, converted:convertBs(raw), raw});
    }
    if (action==='cf_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({error:'fiscal_year が必要です'});
      const fy=parseInt(fiscal_year);
      const period=PERIODS[fy]||{start:fy+'-07-01',end:(fy+1)+'-03-31'};
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
