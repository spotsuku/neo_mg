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

// 会計期間: MFの会計期間を取得し、御社の4月〜3月に該当する期間を特定
async function resolveFiscalPeriods(token, fiscalYear) {
  const fy = parseInt(fiscalYear);
  const ourStart = new Date(`${fy}-04-01`);
  const ourEnd   = new Date(`${fy + 1}-03-31`);

  try {
    const data = await mfFetch(token, '/offices');
    const periods = data?.accounting_periods || [];

    // MFの各会計期間のうち、御社の4月〜3月と重複するものを抽出
    const overlapping = periods.filter(p => {
      const pStart = new Date(p.start_date);
      const pEnd   = new Date(p.end_date);
      return pStart <= ourEnd && pEnd >= ourStart;
    }).map(p => ({
      start: p.start_date,
      end: p.end_date,
    }));

    if (overlapping.length > 0) {
      return {
        periods: overlapping,
        filterStart: `${fy}-04-01`,
        filterEnd: `${fy + 1}-03-31`,
      };
    }
  } catch(e) {
    console.warn('[mf-sync] resolveFiscalPeriods failed:', e.message);
  }

  // フォールバック: そのまま4月〜3月
  return {
    periods: [{ start: `${fy}-04-01`, end: `${fy + 1}-03-31` }],
    filterStart: `${fy}-04-01`,
    filterEnd: `${fy + 1}-03-31`,
  };
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
  '修繕費':'other',
  // イベント費用: 2026年度以降は cogs（resolvePlKey 内で年度判定）。
  // 2025年度以前は 'other'（販管費）として処理する。
  // 収益（会費等）は売上ではなく 'rev_other' として分離
  '会費収入':'rev_other','協賛金収入':'rev_other','入会金収入':'rev_other',
  '営業代行収入':'rev_other','受取手数料':'rev_other','雑収入':'rev_other',
  '売上値引・割戻':'rev_other',
  '受取利息':'rev_other','受取配当金':'rev_other','為替差益':'rev_other',
  // 営業外費用 / 法人税等: 'non_op'（PL内訳には出さず BS retained 計算のみで利用）
  '支払利息':'non_op','雑損失':'non_op','為替差損':'non_op',
  '法人税等':'non_op','法人税、住民税及び事業税':'non_op',
};

// BS科目マッピング
const BS_ACCT_MAP = {
  '現金':'cash','小口現金':'cash','普通預金':'cash','当座預金':'cash','定期預金':'cash',
  '現金及び預金':'cash','現金・預金':'cash',
  '売掛金':'receivable','完成工事未収入金':'receivable','未収入金':'other_ca',
  '前払費用':'other_ca','仮払金':'other_ca','立替金':'other_ca','短期貸付金':'other_ca',
  '繰延税金資産':'other_ca','商品':'other_ca','貯蔵品':'other_ca',
  '仮払消費税':'other_ca','仮払消費税等':'other_ca',
  '建物':'fixed','建物附属設備':'fixed','構築物':'fixed','車両運搬具':'fixed',
  '工具器具備品':'fixed','土地':'fixed','ソフトウェア':'fixed','のれん':'fixed',
  '投資有価証券':'fixed','出資金':'fixed','保証金':'fixed','敷金':'fixed',
  '差入保証金':'fixed','長期前払費用':'fixed',
  '買掛金':'payable','未払金':'payable','未払費用':'payable',
  '未払法人税等':'payable','未払消費税等':'payable','前受金':'payable','預り金':'payable',
  '短期借入金':'borrowing_short',
  '1年内返済予定の長期借入金':'borrowing_short','1年以内返済予定の長期借入金':'borrowing_short',
  '長期借入金':'borrowing',
  '仮受金':'other_cl','前受収益':'other_cl','賞与引当金':'other_cl',
  '仮受消費税':'other_cl','仮受消費税等':'other_cl',
  '資本金':'capital','資本準備金':'capital','その他資本剰余金':'capital',
  '利益準備金':'retained','繰越利益剰余金':'retained','別途積立金':'retained',
  'その他利益剰余金':'retained',
  '新株予約権':'warrant',
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
async function fetchAllJournals(token, periodsInfo, options = {}) {
  const { includeUnrealized = false } = options;
  const allJournals = [];
  const perPage = 500;

  // MFの各会計期間ごとに仕訳を取得
  for (const period of periodsInfo.periods) {
    console.log(`[mf-sync] fetching journals for period ${period.start} ~ ${period.end}`);
    for (let page = 1; page <= 100; page++) {
      const params = { start_date: period.start, end_date: period.end, page, per_page: perPage };
      const data = await mfFetch(token, '/journals', params);
      const journals = data.journals || data.data || [];
      allJournals.push(...journals);

      const totalPages = data.metadata?.total_pages || data.total_pages || null;
      const totalCount = data.metadata?.total_count || data.total_count || null;

      console.log(`[mf-sync] page ${page}: got ${journals.length}, total so far: ${allJournals.length}`);

      if (journals.length === 0) break;
      if (totalPages && page >= totalPages) break;
      if (totalCount && allJournals.length >= totalCount) break;
      if (journals.length < perPage) break;
    }
  }

  // 御社の4月〜3月でフィルター（MF期間が広い場合に必要）
  const filterStart = periodsInfo.filterStart;
  const filterEnd = periodsInfo.filterEnd;
  let filtered = allJournals;
  if (filterStart && filterEnd) {
    filtered = allJournals.filter(j => {
      const d = j.transaction_date || '';
      return d >= filterStart && d <= filterEnd;
    });
    console.log(`[mf-sync] date filter ${filterStart}~${filterEnd}: ${allJournals.length} → ${filtered.length}`);
  }

  // 未実現仕訳を除外
  if (!includeUnrealized) {
    const beforeCount = filtered.length;
    filtered = filtered.filter(j => j.is_realized !== false);
    console.log(`[mf-sync] realized filter: ${beforeCount} → ${filtered.length} (excluded ${beforeCount - filtered.length} unrealized)`);
    return { journals: filtered, totalFetched: allJournals.length, excludedUnrealized: beforeCount - filtered.length };
  }
  return { journals: filtered, totalFetched: allJournals.length, excludedUnrealized: 0 };
}

function buildFromJournals(journals, fiscalYear, options = {}) {
  const { cfCategoryOverrides = {}, plCategoryOverrides = {}, bsCategoryOverrides = {} } = options;
  const fyNum = parseInt(fiscalYear);
  // ユーザー上書きが最優先、次に静的マップ
  // 年度依存マッピング:
  //   - イベント費用: 2026年度以降は 'cogs'（原価）、2025年度以前は 'other'（販管費）
  //     2025年度11月までは業務委託費に混ざっており税理士の振替が困難なため、
  //     2026年4月から正しく原価分類に切り替える運用ルール。
  const resolvePlKey = (name) => {
    if (plCategoryOverrides[name] !== undefined) return plCategoryOverrides[name] || null;
    if (name === 'イベント費用') return fyNum >= 2026 ? 'cogs' : 'other';
    return PL_ACCT_MAP[name] || null;
  };
  const resolveBsKey = (name) => bsCategoryOverrides[name] !== undefined
    ? bsCategoryOverrides[name] || null
    : (BS_ACCT_MAP[name] || null);
  const monthIdx = buildMonthIndex(fiscalYear);
  const n = monthIdx.length;

  // ── PL: 月次損益（借方・貸方の純額を計算） ──
  // 'non_op' は営業外費用・法人税等（PL preview には出さず BS retained 計算でのみ使用）
  const PL_KEYS = ['rev', 'rev_other', 'labor', 'outsource', 'adv', 'gaichu', 'other', 'cogs', 'non_op'];
  const pl = {};
  PL_KEYS.forEach(k => { pl[k] = { actual: new Array(n).fill(0) }; });
  // 借方・貸方を別々に集計（純額計算用）
  const plDebit  = {}; const plCredit = {};
  PL_KEYS.forEach(k => { plDebit[k] = new Array(n).fill(0); plCredit[k] = new Array(n).fill(0); });

  // ── BS: 月次残高 ──
  const BS_KEYS = ['cash', 'receivable', 'other_ca', 'fixed', 'payable', 'borrowing_short', 'borrowing', 'other_cl', 'capital', 'retained', 'warrant'];
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

  // ── CF仕分けマップ（相手方科目名 → CFカテゴリ） ──
  // 現預金との仕訳で使われた相手方科目を記録（編集・記憶用）
  const cfAccountMap = {}; // { 勘定科目名: { direction: 'in'|'out', category, count, total, overridden: bool } }

  // カテゴリ解決関数: overrides が最優先、次にルールベース
  const resolveCfCategory = (acctName, isIn) => {
    if (!acctName) return null;
    if (cfCategoryOverrides[acctName]) return cfCategoryOverrides[acctName];
    return categorizeCf(acctName, isIn);
  };

  journals.forEach(j => {
    const txDate = new Date(j.transaction_date || j.date || j.posted_at || '');
    if (isNaN(txDate)) return;
    const idx = monthIdx.findIndex(m => m.year === txDate.getFullYear() && m.month === txDate.getMonth() + 1);
    if (idx < 0) return;

    const branches = j.branches || j.entries || j.details || [];
    branches.forEach(b => {
      const debitAcct = b.debitor?.account_name || b.debit_account_name || b.debit?.account_name || '';
      const creditAcct = b.creditor?.account_name || b.credit_account_name || b.credit?.account_name || '';
      // MF仕訳の value は税抜処理の場合「既に税抜金額」
      // tax_value は上乗せ分の消費税額（value に含まれていない）
      // 丸め誤差を避けるため、集計は円単位で行い、最後に千円に丸める
      const debitYen  = Number(b.debitor?.value || b.debit_amount || 0);
      const creditYen = Number(b.creditor?.value || 0);
      const debitAmount  = debitYen / 1000;  // 千円（小数含む）
      const creditAmount = creditYen / 1000;
      if (debitAmount === 0 && creditAmount === 0) return;

      const desc = j.remark || j.description || j.memo || j.summary || '';

      // ── 勘定科目別集計（内訳） ──
      if (debitAcct && debitAmount > 0) {
        if (!acctBreakdown[debitAcct]) acctBreakdown[debitAcct] = { debit: 0, credit: 0, category: resolvePlKey(debitAcct) || resolveBsKey(debitAcct) || null };
        acctBreakdown[debitAcct].debit += debitAmount;
      }
      if (creditAcct && creditAmount > 0) {
        if (!acctBreakdown[creditAcct]) acctBreakdown[creditAcct] = { debit: 0, credit: 0, category: resolvePlKey(creditAcct) || resolveBsKey(creditAcct) || null };
        acctBreakdown[creditAcct].credit += creditAmount;
      }

      // ── PL計算: 借方は debitAmount、貸方は creditAmount で集計 ──
      const plKeyDebit = resolvePlKey(debitAcct);
      const plKeyCredit = resolvePlKey(creditAcct);
      if (plKeyDebit && pl[plKeyDebit]) plDebit[plKeyDebit][idx] += debitAmount;
      if (plKeyCredit && pl[plKeyCredit]) plCredit[plKeyCredit][idx] += creditAmount;

      // ── BS計算: 借方増 / 貸方増 ──
      const bsKeyDebit = resolveBsKey(debitAcct);
      const bsKeyCredit = resolveBsKey(creditAcct);
      if (bsKeyDebit && bsDelta[bsKeyDebit]) bsDelta[bsKeyDebit][idx] += debitAmount;
      if (bsKeyCredit && bsDelta[bsKeyCredit]) bsDelta[bsKeyCredit][idx] -= creditAmount;

      // ── 消費税の取り込み（MF推移表は仕訳の tax_value から仮払/仮受消費税を集計）──
      // value (税抜本体) とは別に MF API は branches[].debitor.tax_value / creditor.tax_value
      // に消費税額を持つ。これを 仮払消費税(other_ca) / 仮受消費税(other_cl) に振り分ける。
      const debitTaxYen  = Number(b.debitor?.tax_value  || 0);
      const creditTaxYen = Number(b.creditor?.tax_value || 0);
      if (debitTaxYen > 0)  bsDelta['other_ca'][idx] += debitTaxYen  / 1000; // 仮払消費税: 資産増加
      if (creditTaxYen > 0) bsDelta['other_cl'][idx] -= creditTaxYen / 1000; // 仮受消費税: 負債増加（負債は -bsDelta が増加方向）

      // ── CF計算: 現預金の借方=入金、貸方=出金 ──
      const isDebitCash = cashNames.some(c => debitAcct.includes(c));
      const isCreditCash = cashNames.some(c => creditAcct.includes(c));

      // 預金間振替（両側が現預金）は CF 集計から除外
      const isCashToCash = isDebitCash && isCreditCash;

      // 補助科目・取引先を使ってより詳細な識別子を作る
      const debitSub  = b.debitor?.sub_account_name || '';
      const creditSub = b.creditor?.sub_account_name || '';
      const debitPartner  = b.debitor?.trade_partner_name || '';
      const creditPartner = b.creditor?.trade_partner_name || '';
      // 識別子: 勘定科目 / 補助科目（あれば） / 取引先（あれば）
      const makeIdent = (acct, sub, partner) => {
        const parts = [acct];
        if (sub) parts.push(sub);
        else if (partner) parts.push(partner);
        return parts.join(' / ');
      };

      if (isDebitCash && !isCashToCash) {
        cashIn[idx] += debitAmount;
        // ※ cfIn 親キーへの直接書き込みは廃止（合計は明細から数式で導出するため）
        // 相手方は creditor 側
        const counterpartIdent = makeIdent(creditAcct || '(摘要)', creditSub, creditPartner);
        const counterpartKey = creditAcct; // ルール判定は勘定科目名で
        const cat = resolveCfCategory(counterpartIdent, true) || resolveCfCategory(counterpartKey, true);
        cfMonthly[cat][idx] += debitAmount;
        if (!cfAccountMap[counterpartIdent]) {
          cfAccountMap[counterpartIdent] = {
            direction: 'in', category: cat, count: 0, total: 0,
            overridden: !!cfCategoryOverrides[counterpartIdent],
            accountName: creditAcct, subName: creditSub, partnerName: creditPartner,
            samples: [],
          };
        }
        cfAccountMap[counterpartIdent].count++;
        cfAccountMap[counterpartIdent].total += debitAmount;
        // 摘要サンプル（最大3件）
        if (cfAccountMap[counterpartIdent].samples.length < 3 && desc) {
          cfAccountMap[counterpartIdent].samples.push(desc.slice(0, 60));
        }
      }
      if (isCreditCash && !isCashToCash) {
        cashOut[idx] += creditAmount;
        const counterpartIdent = makeIdent(debitAcct || '(摘要)', debitSub, debitPartner);
        const counterpartKey = debitAcct;
        const cat = resolveCfCategory(counterpartIdent, false) || resolveCfCategory(counterpartKey, false);
        cfMonthly[cat][idx] += creditAmount;
        if (!cfAccountMap[counterpartIdent]) {
          cfAccountMap[counterpartIdent] = {
            direction: 'out', category: cat, count: 0, total: 0,
            overridden: !!cfCategoryOverrides[counterpartIdent],
            accountName: debitAcct, subName: debitSub, partnerName: debitPartner,
            samples: [],
          };
        }
        cfAccountMap[counterpartIdent].count++;
        cfAccountMap[counterpartIdent].total += creditAmount;
        if (cfAccountMap[counterpartIdent].samples.length < 3 && desc) {
          cfAccountMap[counterpartIdent].samples.push(desc.slice(0, 60));
        }
      }

      if (samples.length < 100) {
        samples.push({
          date: j.transaction_date || '',
          debit: debitAcct,
          credit: creditAcct,
          val: debitAmount || creditAmount,
          desc,
          dir: isDebitCash ? 'in' : isCreditCash ? 'out' : '-',
          cat: isDebitCash ? resolveCfCategory(creditAcct || desc, true) : isCreditCash ? resolveCfCategory(debitAcct || desc, false) : '-',
        });
      }
    });
  });

  // ── PL 純額計算（円単位の小数から千円に最終丸め） ──
  // 収益(rev/rev_other): 貸方 − 借方（返品・値引は借方で相殺）
  // 費用(labor/outsource/adv/gaichu/other/cogs): 借方 − 貸方（戻し処理は貸方で相殺）
  PL_KEYS.forEach(k => {
    const isRev = (k === 'rev' || k === 'rev_other');
    for (let i = 0; i < n; i++) {
      const net = isRev
        ? (plCredit[k][i] - plDebit[k][i])
        : (plDebit[k][i] - plCredit[k][i]);
      pl[k].actual[i] = Math.round(net); // 集計後に千円に丸める
    }
  });

  // BS: 借方-貸方の純額を月次デルタとして算出し、累計して期中残高を作る
  // 資産: 借方+貸方− / 負債・純資産: 貸方+借方−
  // 期首残高は仕訳からは取得できないため期首=0 起点の累計残高として表示
  // ※ 丸めは最後にまとめて行う（途中で千円丸めすると累計時に円単位の誤差が累積するため）
  BS_KEYS.forEach(k => {
    const isLiabOrEq = ['payable', 'borrowing', 'borrowing_short', 'other_cl', 'capital', 'retained', 'warrant'].includes(k);
    let running = 0;
    for (let i = 0; i < n; i++) {
      const monthlyDelta = isLiabOrEq ? -bsDelta[k][i] : bsDelta[k][i];
      running += monthlyDelta;
      bsMonthly[k][i] = running; // 千円(小数含む) - 後で一括 round
    }
  });

  // 当期純利益累計を 利益剰余金 (retained) に加算する
  // MF推移表は「繰越利益剰余金 + 当期純利益」を BS の利益剰余金として表示する仕様。
  // ※ 丸め前の plCredit/plDebit から直接計算し円単位の精度を保つ。
  //    pl[k].actual は各月で千円丸め済なので使わない。
  let cumNetIncome = 0;
  for (let i = 0; i < n; i++) {
    const rev = (plCredit.rev[i]       - plDebit.rev[i]) +
                (plCredit.rev_other[i] - plDebit.rev_other[i]);
    const expKeys = ['cogs','labor','outsource','adv','gaichu','other','non_op'];
    const exp = expKeys.reduce((t, k) => t + (plDebit[k][i] - plCredit[k][i]), 0);
    cumNetIncome += rev - exp;
    bsMonthly['retained'][i] += cumNetIncome;
  }

  // 全 BS 値を最後に千円に丸める（累計後の値で一回だけ round → 累積誤差ゼロ）
  BS_KEYS.forEach(k => {
    for (let i = 0; i < n; i++) bsMonthly[k][i] = Math.round(bsMonthly[k][i]);
    bsSummary[k] = bsMonthly[k][n - 1] || 0;
  });

  // 勘定科目別内訳（累積円→千円に最終丸め）
  const breakdown = Object.entries(acctBreakdown)
    .map(([name, v]) => ({
      name,
      debit: Math.round(v.debit),
      credit: Math.round(v.credit),
      net: Math.round(v.debit - v.credit),
      category: v.category
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 50);

  // CF最終丸め
  const cashInRounded = cashIn.map(v => Math.round(v));
  const cashOutRounded = cashOut.map(v => Math.round(v));
  const cfMonthlyRounded = {};
  Object.keys(cfMonthly).forEach(k => {
    cfMonthlyRounded[k] = cfMonthly[k].map(v => Math.round(v));
  });

  // CF仕分けマップ（千円単位に丸めて返却）
  const cfAccountMapRounded = {};
  Object.keys(cfAccountMap).forEach(k => {
    cfAccountMapRounded[k] = {
      ...cfAccountMap[k],
      total: Math.round(cfAccountMap[k].total),
    };
  });

  return {
    pl,
    bs: { monthly: bsMonthly, summary: bsSummary },
    cf: {
      cashIn: cashInRounded,
      cashOut: cashOutRounded,
      net: cashInRounded.map((v, i) => v - cashOutRounded[i]),
      monthly: cfMonthlyRounded,
      samples,
      accountMap: cfAccountMapRounded,
    },
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
      // 基本エンドポイント
      for (const ep of ['/offices', '/accounts']) {
        try {
          const d = await mfFetch(token, ep);
          results[ep] = { ok: true, keys: Object.keys(d).slice(0, 10) };
        } catch (e) {
          results[ep] = { ok: false, error: e.message.slice(0, 200) };
        }
      }
      // /journals は日付必須のためMFの最新期間で確認
      try {
        const pi = await resolveFiscalPeriods(token, fiscal_year || '2025');
        const lastPeriod = pi.periods[pi.periods.length - 1] || { start: '2025-07-01', end: '2026-03-31' };
        const d = await mfFetch(token, '/journals', { start_date: lastPeriod.start, end_date: lastPeriod.end, per_page: 1 });
        results['/journals'] = { ok: true, keys: Object.keys(d).slice(0, 10), periods_used: pi.periods.length };
      } catch (e) {
        results['/journals'] = { ok: false, error: e.message.slice(0, 200) };
      }
      // 通帳データ系エンドポイントを試行
      for (const ep of ['/walletables', '/wallet_txns', '/deals', '/transactions', '/bank_txns', '/account_transactions', '/bank_account_transactions', '/wallet_transactions']) {
        try {
          const d = await mfFetch(token, ep, { per_page: 1 });
          results[ep] = { ok: true, keys: Object.keys(d).slice(0, 10) };
        } catch (e) {
          results[ep] = { ok: false, error: e.message.slice(0, 150) };
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

      const includeUnrealized = req.query.include_unrealized === 'true';
      // 科目分類の上書き: フロントエンドから localStorage の内容を送信
      let cfCategoryOverrides = {}, plCategoryOverrides = {}, bsCategoryOverrides = {};
      if (req.query.cf_overrides) {
        try { cfCategoryOverrides = JSON.parse(req.query.cf_overrides); }
        catch (e) { console.warn('[mf-sync] cf_overrides parse failed:', e.message); }
      }
      if (req.query.pl_overrides) {
        try { plCategoryOverrides = JSON.parse(req.query.pl_overrides); }
        catch (e) { console.warn('[mf-sync] pl_overrides parse failed:', e.message); }
      }
      if (req.query.bs_overrides) {
        try { bsCategoryOverrides = JSON.parse(req.query.bs_overrides); }
        catch (e) { console.warn('[mf-sync] bs_overrides parse failed:', e.message); }
      }

      const periodsInfo = await resolveFiscalPeriods(token, fiscal_year);
      const fetchResult = await fetchAllJournals(token, periodsInfo, { includeUnrealized });
      const result = buildFromJournals(fetchResult.journals, fiscal_year,
        { cfCategoryOverrides, plCategoryOverrides, bsCategoryOverrides });

      // action に応じて必要な部分だけ返す
      const response = {
        ok: true,
        fiscal_year,
        period: periodsInfo,
        journal_count: result.journalCount,
        total_fetched: fetchResult.totalFetched,
        excluded_unrealized: fetchResult.excludedUnrealized,
        method: 'journals',
        breakdown: result.breakdown,
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

    // ── 通帳データ取得（税理士仕訳前の生データ） ──
    // MF APIの複数候補を試し、動作するエンドポイントから取得
    if (action === 'bank_transactions' || action === 'raw_bank') {
      const pi = await resolveFiscalPeriods(token, fiscal_year || '2025');
      const filterStart = pi.filterStart;
      const filterEnd = pi.filterEnd;

      // 候補エンドポイント（優先順）
      const endpoints = [
        { path: '/wallet_txns', txKey: 'wallet_txns' },
        { path: '/walletables', txKey: 'walletables' },
        { path: '/deals', txKey: 'deals' },
        { path: '/transactions', txKey: 'transactions' },
        { path: '/bank_txns', txKey: 'bank_txns' },
        { path: '/account_transactions', txKey: 'account_transactions' },
      ];

      let found = null;
      const attempts = [];

      for (const { path, txKey } of endpoints) {
        // 各MF期間ごとに取得
        const allTxns = [];
        let epOk = false;
        try {
          for (const period of pi.periods) {
            for (let page = 1; page <= 50; page++) {
              const params = { start_date: period.start, end_date: period.end, page, per_page: 500 };
              const d = await mfFetch(token, path, params);
              const list = d[txKey] || d.data || d.transactions || (Array.isArray(d) ? d : []);
              if (!Array.isArray(list)) break;
              allTxns.push(...list);
              const totalPages = d.metadata?.total_pages || d.total_pages || null;
              if (list.length === 0) break;
              if (totalPages && page >= totalPages) break;
              if (list.length < 500) break;
            }
          }
          epOk = allTxns.length > 0;
          attempts.push({ endpoint: path, ok: true, count: allTxns.length });
          if (epOk) { found = { path, txns: allTxns }; break; }
        } catch (e) {
          attempts.push({ endpoint: path, ok: false, error: e.message.slice(0, 120) });
        }
      }

      if (!found) {
        return res.status(404).json({
          error: '通帳データAPIが見つかりませんでした。アクセス権限を確認してください。',
          attempts,
        });
      }

      // フィルタリング（御社の4月〜3月）
      let filtered = found.txns;
      if (filterStart && filterEnd) {
        filtered = filtered.filter(t => {
          const d = t.transaction_date || t.date || t.updated_date || '';
          return d >= filterStart && d <= filterEnd;
        });
      }

      return res.status(200).json({
        ok: true,
        fiscal_year,
        period: pi,
        endpoint_used: found.path,
        total_fetched: found.txns.length,
        after_filter: filtered.length,
        transactions: filtered,
        attempts,
      });
    }

    // ── /journals 生レスポンス（先頭3件のみ、フィールド構造確認用） ──
    if (action === 'raw_journals') {
      const pi = await resolveFiscalPeriods(token, fiscal_year || '2025');
      const lastPeriod = pi.periods[pi.periods.length - 1] || { start: '2025-07-01', end: '2026-03-31' };
      const data = await mfFetch(token, '/journals', {
        start_date: lastPeriod.start, end_date: lastPeriod.end, page: 1, per_page: 3
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
