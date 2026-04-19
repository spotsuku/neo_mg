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
  const url = new URL(MF_API_BASE + path);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  if (!res.ok) { const text = await res.text(); throw new Error('MF API error ' + res.status + ': ' + text.slice(0, 300)); }
  return res.json();
}

// ══════════════════════════════════════════
//  月インデックス（4月〜3月）
// ══════════════════════════════════════════
function buildMonthIndex(fiscalYear) {
  const fy = parseInt(fiscalYear);
  const months = [];
  for (let m = 4; m <= 12; m++) months.push({ year: fy, month: m });
  for (let m = 1; m <= 3; m++) months.push({ year: fy + 1, month: m });
  return months;
}

// 会計期間 start/end を /offices から解決
async function resolveFiscalPeriod(token, fiscalYear) {
  try {
    const data = await mfFetch(token, '/offices');
    const periods = data?.accounting_periods || [];
    const fy = parseInt(fiscalYear);
    // fy年の4月〜6月開始の期間を優先
    let target = periods.find(p => {
      const s = new Date(p.start_date || '');
      return !isNaN(s) && s.getFullYear() === fy && s.getMonth() >= 3 && s.getMonth() <= 6;
    });
    if (!target) target = periods.find(p => {
      const s = new Date(p.start_date || '');
      return !isNaN(s) && s.getFullYear() === fy;
    });
    if (!target) target = periods[0];
    return {
      start: target?.start_date || `${fy}-04-01`,
      end: target?.end_date || `${fy + 1}-03-31`,
    };
  } catch (e) {
    return { start: `${fiscalYear}-04-01`, end: `${parseInt(fiscalYear) + 1}-03-31` };
  }
}

// ══════════════════════════════════════════
//  勘定科目マスタ取得 + カテゴリマッピング構築
// ══════════════════════════════════════════

// PL科目マッピング（勘定科目名 → ダッシュボードキー）
// 厳密版: MFの損益計算書「売上高合計」と一致させるため、売上高のみを rev にマッピング
// 会費収入・協賛金収入等は rev_other（未分類）として扱い、デフォルトでは合算しない
const PL_ACCT_MAP = {
  // 売上（MFの「売上高」セクションと一致）
  '売上高':'rev','売上':'rev',
  // 人件費（MFの給与系科目と一致）
  '役員報酬':'labor','給与手当':'labor','給料手当':'labor','給料賃金':'labor',
  '賞与':'labor','法定福利費':'labor','福利厚生費':'labor','退職金':'labor',
  // 業務委託
  '業務委託費':'outsource','業務委託料':'outsource','業務委託':'outsource',
  // 広告販促
  '広告宣伝費':'adv','販売促進費':'adv',
  // 外注費
  '外注費':'gaichu','外注加工費':'gaichu','支払報酬':'gaichu',
  // 売上原価
  '仕入高':'cogs','原価':'cogs','会場費':'cogs',
  // ── その他販管費（上記以外）を 'other' にまとめる ──
  '旅費交通費':'other','通信費':'other','水道光熱費':'other','消耗品費':'other',
  '備品・消耗品費':'other','地代家賃':'other','租税公課':'other','支払手数料':'other',
  'システム利用料':'other','接待交際費':'other','会議費':'other','研修採用費':'other',
  '採用費':'other','保険料':'other','新聞図書費':'other','諸会費':'other',
  '荷造運賃':'other','雑費':'other','減価償却費':'other','リース料':'other',
  // 収益（会費等）は売上ではなく 'rev_other' として分離
  '会費収入':'rev_other','協賛金収入':'rev_other','入会金収入':'rev_other',
  '営業代行収入':'rev_other','受取手数料':'rev_other','雑収入':'rev_other',
  '売上値引・割戻':'rev_other',
};

// BS科目マッピング
const BS_ACCT_MAP = {
  '現金':'cash','小口現金':'cash','普通預金':'cash','当座預金':'cash','定期預金':'cash',
  '現金及び預金':'cash','現金・預金':'cash',
  '売掛金':'receivable','完成工事未収入金':'receivable','未収入金':'other_ca',
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

// CF科目分類（仕訳の勘定科目名からCFカテゴリを推定）
function categorizeCf(acctName, isIn) {
  const d = (acctName || '').replace(/\s|　/g, '');
  if (isIn) {
    if (/会費|membership|入会金/.test(d)) return 'cfInFee';
    if (/研修|training|セミナー/.test(d)) return 'cfInTraining';
    if (/借入|融資/.test(d)) return 'loanIn';
    if (/資本金|払込|出資/.test(d)) return 'capitalIn';
    return 'cfInOther';
  } else {
    if (/役員報酬|給与|給料|賞与|法定福利|社会保険/.test(d)) return 'salaryPay';
    if (/業務委託/.test(d)) return 'bizComPay';
    if (/顧問|弁護士|税理士|社労士/.test(d)) return 'expertPay';
    if (/家賃|地代|賃料/.test(d)) return 'rentPay';
    if (/通信|電話|インターネット/.test(d)) return 'telPay';
    if (/交際|接待|会議/.test(d)) return 'entertainPay';
    if (/租税|税金|印紙|国税|都税/.test(d)) return 'taxPay';
    if (/消耗|備品/.test(d)) return 'suppliesPay';
    if (/広告|宣伝|販促/.test(d)) return 'adSportsPay';
    if (/イベント|会場/.test(d)) return 'eventCostPay';
    if (/採用|求人/.test(d)) return 'recruitPay';
    if (/借入返済|返済/.test(d)) return 'loanOut';
    if (/設備|投資|固定資産/.test(d)) return 'investPay';
    return 'salesOtherPay';
  }
}

// ══════════════════════════════════════════
//  仕訳から PL / BS / CF を一括計算
// ══════════════════════════════════════════
async function fetchAllJournals(token, startDate, endDate) {
  const allJournals = [];
  const perPage = 500; // MF APIの最大値
  for (let page = 1; page <= 100; page++) {
    const params = { start_date: startDate, end_date: endDate, page, per_page: perPage };
    const data = await mfFetch(token, '/journals', params);
    const journals = data.journals || data.data || [];
    allJournals.push(...journals);

    // ページネーション終了判定（複数の形式に対応）
    const totalPages = data.metadata?.total_pages || data.total_pages || null;
    const totalCount = data.metadata?.total_count || data.total_count || data.total_entries || null;

    console.log(`[mf-sync] journals page ${page}: got ${journals.length}, total so far: ${allJournals.length}, totalPages=${totalPages}, totalCount=${totalCount}`);

    // 終了条件: 空ページ / 最終ページ / 件数到達
    if (journals.length === 0) break;
    if (totalPages && page >= totalPages) break;
    if (totalCount && allJournals.length >= totalCount) break;
    if (journals.length < perPage) break; // 取得件数がper_page未満 → 最終ページ
  }
  return allJournals;
}

function buildFromJournals(journals, fiscalYear) {
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;

  // ── PL: 月次損益（借方・貸方の純額を計算） ──
  const PL_KEYS = ['rev', 'rev_other', 'labor', 'outsource', 'adv', 'gaichu', 'other', 'cogs'];
  const pl = {};
  PL_KEYS.forEach(k => { pl[k] = { actual: new Array(n).fill(0) }; });
  // 借方・貸方を別々に集計（純額計算用）
  const plDebit  = {}; const plCredit = {};
  PL_KEYS.forEach(k => { plDebit[k] = new Array(n).fill(0); plCredit[k] = new Array(n).fill(0); });

  // ── BS: 月次残高 ──
  const BS_KEYS = ['cash', 'receivable', 'other_ca', 'fixed', 'payable', 'borrowing', 'other_cl', 'capital', 'retained'];
  const bsMonthly = {};
  BS_KEYS.forEach(k => { bsMonthly[k] = new Array(n).fill(0); });
  const bsSummary = {};
  BS_KEYS.forEach(k => { bsSummary[k] = 0; });
  // BS累計トラッカー（各科目の期中増減を月ごとに追跡）
  const bsDelta = {};
  BS_KEYS.forEach(k => { bsDelta[k] = new Array(n).fill(0); });

  // ── CF: 月次キャッシュフロー ──
  const CF_KEYS = ['cfIn', 'cfInFee', 'cfInTraining', 'cfInOther', 'loanIn', 'capitalIn',
    'salaryPay', 'bizComPay', 'expertPay', 'rentPay', 'telPay', 'entertainPay', 'taxPay',
    'toolsPay', 'suppliesPay', 'adSportsPay', 'eventCostPay', 'recruitPay', 'annualFeePay',
    'investPay', 'loanOut', 'salesOtherPay', 'expensePay'];
  const cfMonthly = {};
  CF_KEYS.forEach(k => { cfMonthly[k] = new Array(n).fill(0); });
  const cashIn = new Array(n).fill(0);
  const cashOut = new Array(n).fill(0);
  const cashNames = ['普通預金', '当座預金', '現金', '小口現金', '定期預金'];

  // サンプル仕訳（プレビュー用）
  const samples = [];

  // ── 勘定科目別の集計内訳（MF推移表との突合用） ──
  const acctBreakdown = {}; // { 勘定科目名: { debit合計, credit合計, 純額, 分類先 } }

  journals.forEach(j => {
    const txDate = new Date(j.transaction_date || j.date || j.posted_at || '');
    if (isNaN(txDate)) return;
    const idx = monthIdx.findIndex(m => m.year === txDate.getFullYear() && m.month === txDate.getMonth() + 1);
    if (idx < 0) return;

    const branches = j.branches || j.entries || j.details || [];
    branches.forEach(b => {
      const debitAcct = b.debitor?.account_name || b.debit_account_name || b.debit?.account_name || '';
      const creditAcct = b.creditor?.account_name || b.credit_account_name || b.credit?.account_name || '';
      const amount = Math.round((b.debitor?.value || b.debit_amount || b.amount || b.creditor?.value || 0) / 1000);
      if (amount === 0) return;

      const desc = j.remark || j.description || j.memo || j.summary || '';

      // ── 勘定科目別集計（内訳） ──
      if (debitAcct) {
        if (!acctBreakdown[debitAcct]) acctBreakdown[debitAcct] = { debit: 0, credit: 0, category: PL_ACCT_MAP[debitAcct] || BS_ACCT_MAP[debitAcct] || null };
        acctBreakdown[debitAcct].debit += amount;
      }
      if (creditAcct) {
        if (!acctBreakdown[creditAcct]) acctBreakdown[creditAcct] = { debit: 0, credit: 0, category: PL_ACCT_MAP[creditAcct] || BS_ACCT_MAP[creditAcct] || null };
        acctBreakdown[creditAcct].credit += amount;
      }

      // ── PL計算: 借方・貸方を別々に追跡して純額を計算 ──
      const plKeyDebit = PL_ACCT_MAP[debitAcct];
      const plKeyCredit = PL_ACCT_MAP[creditAcct];
      if (plKeyDebit) plDebit[plKeyDebit][idx] += amount;
      if (plKeyCredit) plCredit[plKeyCredit][idx] += amount;

      // ── BS計算: 借方増 / 貸方増 をトラッキング ──
      const bsKeyDebit = BS_ACCT_MAP[debitAcct];
      const bsKeyCredit = BS_ACCT_MAP[creditAcct];
      if (bsKeyDebit) bsDelta[bsKeyDebit][idx] += amount;  // 借方 → 資産増 / 負債減
      if (bsKeyCredit) bsDelta[bsKeyCredit][idx] -= amount; // 貸方 → 資産減 / 負債増

      // ── CF計算: 現預金の借方=入金、貸方=出金 ──
      const isDebitCash = cashNames.some(c => debitAcct.includes(c));
      const isCreditCash = cashNames.some(c => creditAcct.includes(c));

      if (isDebitCash) {
        cashIn[idx] += amount;
        cfMonthly.cfIn[idx] += amount;
        const cat = categorizeCf(creditAcct || desc, true);
        cfMonthly[cat][idx] += amount;
      }
      if (isCreditCash) {
        cashOut[idx] += amount;
        const cat = categorizeCf(debitAcct || desc, false);
        cfMonthly[cat][idx] += amount;
      }

      if (samples.length < 100) {
        samples.push({
          date: j.transaction_date || '',
          debit: debitAcct,
          credit: creditAcct,
          val: amount,
          desc,
          dir: isDebitCash ? 'in' : isCreditCash ? 'out' : '-',
          cat: isDebitCash ? categorizeCf(creditAcct || desc, true) : isCreditCash ? categorizeCf(debitAcct || desc, false) : '-',
        });
      }
    });
  });

  // ── PL 純額計算 ──
  // 収益(rev/rev_other): 貸方 − 借方（返品・値引は借方で相殺）
  // 費用(labor/outsource/adv/gaichu/other/cogs): 借方 − 貸方（戻し処理は貸方で相殺）
  PL_KEYS.forEach(k => {
    const isRev = (k === 'rev' || k === 'rev_other');
    for (let i = 0; i < n; i++) {
      pl[k].actual[i] = isRev
        ? (plCredit[k][i] - plDebit[k][i])
        : (plDebit[k][i] - plCredit[k][i]);
    }
  });

  // BS: 借方-貸方の純額を残高として扱う
  // 資産は借方増で正、負債・純資産は貸方増で正
  BS_KEYS.forEach(k => {
    const isLiabOrEq = ['payable', 'borrowing', 'other_cl', 'capital', 'retained'].includes(k);
    for (let i = 0; i < n; i++) {
      bsMonthly[k][i] = isLiabOrEq ? -bsDelta[k][i] : bsDelta[k][i];
    }
    // 全期間合計をサマリーに
    bsSummary[k] = bsMonthly[k].reduce((t, v) => t + v, 0);
  });

  // 勘定科目別内訳（上位30件、金額降順）
  const breakdown = Object.entries(acctBreakdown)
    .map(([name, v]) => ({ name, debit: v.debit, credit: v.credit, net: v.debit - v.credit, category: v.category }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 50);

  return {
    pl,
    bs: { monthly: bsMonthly, summary: bsSummary },
    cf: { cashIn, cashOut, net: cashIn.map((v, i) => v - cashOut[i]), monthly: cfMonthly, samples },
    journalCount: journals.length,
    breakdown,
  };
}

// ══════════════════════════════════════════
//  APIハンドラー
// ══════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, fiscal_year } = req.query;

  try {
    const token = await getAccessToken();

    // ── 事業者情報 ──
    if (action === 'offices') {
      return res.status(200).json({ ok: true, data: await mfFetch(token, '/offices') });
    }

    // ── 勘定科目一覧 ──
    if (action === 'accounts') {
      return res.status(200).json({ ok: true, data: await mfFetch(token, '/accounts') });
    }

    // ── 診断（動作するエンドポイントの確認） ──
    if (action === 'debug') {
      const results = {};
      for (const ep of ['/offices', '/accounts', '/journals', '/items', '/sections', '/partners']) {
        try {
          const d = await mfFetch(token, ep, ep === '/journals' ? { limit: 1 } : {});
          results[ep] = { ok: true, keys: Object.keys(d).slice(0, 10) };
        } catch (e) {
          results[ep] = { ok: false, error: e.message.slice(0, 200) };
        }
      }
      // 会計期間情報
      try {
        const off = await mfFetch(token, '/offices');
        results._accounting_periods = (off?.accounting_periods || []).map(p => ({
          start_date: p.start_date, end_date: p.end_date, keys: Object.keys(p),
        }));
      } catch (e) { results._accounting_periods_err = e.message.slice(0, 100); }
      return res.status(200).json({ ok: true, results });
    }

    // ── 全データ取得（仕訳ベース: PL + BS + CF を一括計算） ──
    if (action === 'all_for_dashboard' || action === 'pl_for_dashboard' || action === 'bs_for_dashboard' || action === 'cf_for_dashboard') {
      if (!fiscal_year) return res.status(400).json({ error: 'fiscal_year が必要です' });

      const period = await resolveFiscalPeriod(token, fiscal_year);
      const journals = await fetchAllJournals(token, period.start, period.end);
      const result = buildFromJournals(journals, fiscal_year);

      // action に応じて必要な部分だけ返す
      const response = {
        ok: true,
        fiscal_year,
        period,
        journal_count: result.journalCount,
        method: 'journals',
      };

      if (action === 'all_for_dashboard' || action === 'pl_for_dashboard') {
        response.pl = result.pl;
      }
      if (action === 'all_for_dashboard' || action === 'bs_for_dashboard') {
        response.bs = result.bs;
      }
      if (action === 'all_for_dashboard' || action === 'cf_for_dashboard') {
        response.cf = result.cf;
      }

      return res.status(200).json(response);
    }

    // ── /offices 生レスポンス ──
    if (action === 'raw_offices') {
      return res.status(200).json({ ok: true, data: await mfFetch(token, '/offices') });
    }

    // ── /journals 生レスポンス（先頭3件のみ、フィールド構造確認用） ──
    if (action === 'raw_journals') {
      const period = await resolveFiscalPeriod(token, fiscal_year || '2025');
      const data = await mfFetch(token, '/journals', {
        start_date: period.start, end_date: period.end, page: 1, per_page: 3
      });
      return res.status(200).json({
        ok: true, period,
        metadata: data.metadata || data.total_pages || data.total_count,
        sample: (data.journals || data.data || []).slice(0, 3),
        top_keys: Object.keys(data).slice(0, 20),
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error('[mf-sync]', err);
    return res.status(500).json({ error: err.message });
  }
}
