/* ================= ADS · PPC & ORGANIC · NEW: the redesigned PPC & Organic page (test) =================
 * Screens: PPC & Organic · New (tab 'ppcn', pane panePpcn — an empty div this file fills; core/nav.js calls
 * ensurePpcn). Everything on it is drawn by pxRender: the toolbar (Range report / Columns by date, brand,
 * Parent / Child, search, Columns, Download), the quick-filter chips and column sets, the five period cards, the
 * totals strip, the date chips or the column set-up bar, and the table. The three pop-ups (dates, columns, show
 * columns) are drawn inside it. One set of delegated listeners (pxWire) handles every click, key and change.
 * Does: keeps NO store of its own — it reads WEEKLY and WDAY (filled by loadWeekly / wNightly in
 * ads/ppc-organic.js) plus the second worker's caches for orders and ad units (pxExtra → PXN). pxPlan decides
 * which store answers a date range (per-day from WDAY.from, whole weeks before, else nothing); pxSumAsin and
 * pxStats add an ASIN or a list of ASINs up over a plan (memoised per render) and pxDerive works the ratios out
 * from the totals; pxEntities builds the parents or children in view; pxCtx works out everything one render
 * needs; pxRangeTable and pxColTable draw the two table shapes; pxCsv downloads what is on screen. The user's
 * choices (never dates) are remembered in localStorage (PX_KEY, pxSave).
 * Main functions: pxSave, pxFmtRange, pxColLabel, pxRange, pxDefEnd, pxCols, pxColsDesc, pxSaleWeeks, pxPlan,
 * pxExtra, pxAcctOrders, pxSessions, pxSumAsin, pxDerive, pxStats, pxLookup, pxImages, pxPic, pxEntities, pxCtx,
 * pxVal, pxChange, pxSorted, pxDelta, pxProd, pxRangeCells, pxKids, pxKidBar, pxRangeTable, pxColTable, pxDatePop,
 * pxColsPop, pxShowPop, pxCards, pxChartBuckets, pxSeries, pxChartSvg, pxChartTip, pxChartCard, pxWeekCell,
 * pxAlertRows, pxAlertsCard, pxRender, pxStick, pxCsv, pxWire, ensurePpcn.
 * 12 Nov 2026 (UI pass, after the Ad Console): the trend chart (organic / ad sales, ad spend, TACoS), change pills on
 * the strip and the period cards, ROAS / CPC / Unit session % beside "Ad CVR" (renamed from "Conv. rate" — it is
 * ad orders ÷ clicks, not the old tab's units ÷ sessions), Last week / Last 4 weeks chips and 13 / 26 week column
 * set-ups (the ranges that carry sessions), when each part of the nightly landed, and "What moved" — the old tab's
 * alerts (W_ALERT). Second pass, same day: renamed Product Performance; "Why did it move?" (ads/product-why.js — the
 * side panel, opened from any product's name and the "Why?" on rows that fell 30%+), whose six-way split also names the
 * main cause in What moved; sparklines on the strip, day bars on the period cards, the 8-week trend column, and the
 * biggest falls and gains.
 * 13 Nov 2026 (Vishesh): the top of the page is the PPC & Organic · New layout again — the five period cards and
 * the six totals, plain, only bigger and coloured, the date row Today … Last month · Custom (Last week / Last 4
 * weeks are quick picks inside Custom), 14 days by default and the original table columns (the 8-week trend,
 * Unit session %, ROAS and CPC are still in Columns). New above the period cards: one card per brand with its
 * parents and child ASINs (pxBrandCards — the same count as the table's All row), how many of them sold in the
 * dates, and how many Listing Health holds. The chart, the trend lines and What moved moved to the end of the
 * page, under the table ("Trends & what moved").
 * Second pass, 13 Nov: an (i) on every block and graph (pxI / pxInfoShow — what it shows, what it compares, against which
 * dates, worked out for what is on screen; pxCmp gives the words), captions over the brand and period cards, the Custom
 * dates pop-up with the whole-week picks as cards and a live "you will see / compared with" (pxDateLiveHtml), and
 * "Why did it move?" inside the page instead of a panel over it (pxWhyRow; see ads/product-why.js). */

/* ================= PPC & ORGANIC · NEW (test) =================
 * The redesigned PPC & Organic, BESIDE the old tab rather than over it (Ravi, 2026-10-29): one toolbar
 * row, date chips above the products, columns built as N × X days, a picture on every row.
 *
 * READS ONLY WHAT THE OLD TAB READS, and keeps no store of its own. WEEKLY and WDAY are filled by the
 * same loadWeekly + wNightly the old tab uses — same ten-minute throttle — so the two tabs can never
 * disagree, and opening this one costs nothing the old one does not.
 *
 * Who sees it: everyone who holds PPC & Organic (TAB_INHERIT in nav.js). The Firestore rules gate
 * these documents on `weekly`, so granting this tab on its own would only ever open an empty screen.
 *
 * Which store answers a date range — decided by the dates, exactly as wRangePlan decides it:
 *   · on or after WDAY.from          → the per-day store (sales, units, ad spend, ad sales)
 *   · whole Sunday→Saturday weeks     → the weekly store
 *   · anything else                   → nothing, and the screen says why instead of guessing
 */
// localStorage key of the remembered choices, and how many rows one "Show more" adds.
/* 'pxState2' (13 Nov): the page went back to the PPC & Organic · New layout (Vishesh) with the extras moved to the
 * end and four columns hidden by default — a new key, so everybody starts from those defaults rather than a
 * remembered "show every column" from the busier version. */
const PX_KEY = 'pxState2';
const PX_PAGE = 100;
// The page's state. mode: range / cols; level: parent / child; dkey: the date chip ('custom' = lo..hi); pc: the
// column set-up; hide: hidden columns; q: the search; chip: the quick filter; sk / sd: sort key and direction;
// open: opened parents; kidN: sizes shown per parent; pop: the open pop-up; draft: the pop-up's unsaved values.
// cgran: the trend chart's bars ('auto' / 'day' / 'week'); chart: the chart is open; alertWk: which finished week
// the "What moved" card reads (0 = the last one); alertAll: that card shows every row, not the first few.
let PX = {
  mode: 'range', level: 'parent', brand: 'ALL', metric: 'rev', dkey: 'd14', lo: '', hi: '',
  pc: { n: 4, len: 7, end: '', preset: null }, hide: ['tr', 'usp', 'roas', 'cpc'], q: '', recOpen: false, recF: new Set(), recAll: new Set(), chip: 'all', sk: 'rev', sd: -1,
  open: new Set(), kidN: {}, pop: null, draft: null, show: PX_PAGE, msg: '', loading: false, anim: false,
  cgran: 'auto', chart: true, alertWk: 0, alertAll: false,
  // why: the "Why did it move?" panel when open — { key, n (weeks compared), end (the last week's Sunday), fit }
  why: null, whyAnim: false,
};
/* An opened parent shows its biggest sizes first and only this many — a 246-size tablecloth opened in
 * full buries every other product under it. Per parent; 0 means all. (b20ba1a, 29 Oct; restored 2 Nov.) */
const PX_KID_STEPS = [10, 20, 50, 100, 0];
const pxKidLimit = key => (PX.kidN[key] != null ? PX.kidN[key] : 10);
// Only the choices are remembered, never dates: a remembered "12–26 Oct" would be stale by Monday.
// PX_SAVED_KNOWN: the range-report columns that existed when the choices were saved (see pxSaveKnown below).
let PX_SAVED_KNOWN = null;
try {
  const s = JSON.parse(localStorage.getItem(PX_KEY) || '{}');
  ['mode', 'level', 'metric', 'dkey', 'hide', 'cgran', 'chart'].forEach(k => {
    if (s[k] != null) PX[k] = s[k];
  });
  if (s.pc) PX.pc = { n: s.pc.n || 4, len: s.pc.len || 7, end: '', preset: s.pc.preset || null };
  // "Last 3 months" (3 × 30 days) could only ever fill its newest column — older days exist only as whole
  // Sunday–Saturday weeks — so a remembered one becomes the 13 weeks it was trying to show (12 Nov).
  if (PX.pc.preset === 'm3') PX.pc = { n: 13, len: 7, end: '', preset: 'w13' };
  if (Array.isArray(s.known)) PX_SAVED_KNOWN = s.known;
  if (PX.dkey === 'custom') PX.dkey = 'd14';
} catch (e) { /* storage off — defaults */ }
// A remembered choice this version no longer has would break every render — fall back to the defaults.
if (!['range', 'cols'].includes(PX.mode)) PX.mode = 'range';
if (!['parent', 'child'].includes(PX.level)) PX.level = 'parent';
if (!Array.isArray(PX.hide)) PX.hide = [];
if (!['auto', 'day', 'week'].includes(PX.cgran)) PX.cgran = 'auto';
PX.chart = PX.chart !== false;
// Remember the choices (mode, level, metric, date chip, hidden columns, column set-up, chart) in localStorage.
function pxSave() {
  try {
    localStorage.setItem(PX_KEY, JSON.stringify({
      mode: PX.mode, level: PX.level, metric: PX.metric, cgran: PX.cgran, chart: PX.chart,
      dkey: PX.dkey, hide: PX.hide, known: PX_RCOLS.map(x => x[0]),
      pc: { n: PX.pc.n, len: PX.pc.len, preset: PX.pc.preset } }));
  } catch (e) { /* fine */ }
}

/* ---------- formatting ---------- */
// HTML-escape; money to whole dollars; percent to one decimal; signed percent; short money ($1.2k); days in a range.
const pxEsc = s => String(s == null ? '' : s)
  .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const pxMoney = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
const pxPct = v => (v == null ? '—' : v.toFixed(1) + '%');
const pxSgn = v => (v == null ? '—' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');
const pxShort = v => (v == null ? '—'
  : v >= 10000 ? '$' + (v / 1000).toFixed(0) + 'k'
  : v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k'
  : '$' + Math.round(v));
const pxLen = (lo, hi) => Math.round((Date.parse(hi) - Date.parse(lo)) / 86400000) + 1;
// "3 Aug" and "Aug 3" from an ISO date.
function pxDM(iso) {
  const d = wDate(iso);
  return d.getUTCDate() + ' ' + W_MON[d.getUTCMonth()];
}
function pxMD(iso) {
  const d = wDate(iso);
  return W_MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
// A date range for reading: "3–9 Aug 2026", "28 Jul – 3 Aug 2026", or one day.
function pxFmtRange(lo, hi) {
  if (!lo || !hi) return '—';
  const y = ' ' + hi.slice(0, 4);
  if (lo === hi) return pxDM(lo) + y;
  return lo.slice(0, 7) === hi.slice(0, 7)
    ? wDate(lo).getUTCDate() + '–' + pxDM(hi) + y
    : pxDM(lo) + ' – ' + pxDM(hi) + y;
}
// A column header's dates: "Aug 3–9", "Jul 28 – Aug 3", or one day.
function pxColLabel(lo, hi) {
  if (lo === hi) return pxMD(lo);
  return lo.slice(0, 7) === hi.slice(0, 7)
    ? pxMD(lo) + '–' + wDate(hi).getUTCDate()
    : pxMD(lo) + ' – ' + pxMD(hi);
}

/* ---------- dates ---------- */
// PT, the marketplace's day — sdToday() is what every other date on this app is measured against.
/* pxToday: sdToday(), asked at most once a second. sdToday converts the clock to Pacific time through toLocaleString,
 * which is slow, and one render asked it once per product (pxStats' "is this period finished?") — 3,700 times at child
 * level, the biggest single cost of a redraw (12 Nov profile). The day cannot change between two calls a second apart
 * in any way that matters to one render. */
let PX_TD = { at: 0, v: '' };
function pxToday() {
  const n = Date.now();
  if (n - PX_TD.at > 1000 || !PX_TD.v) PX_TD = { at: n, v: sdToday() };
  return PX_TD.v;
}
// The date chips: key → [label, today → [lo, hi]].
const PX_DATES = {
  today:  ['Today', t => [t, t]],
  yest:   ['Yesterday', t => [sdShift(t, -1), sdShift(t, -1)]],
  d7:     ['7 days', t => [sdShift(t, -7), sdShift(t, -1)]],
  d14:    ['14 days', t => [sdShift(t, -14), sdShift(t, -1)]],
  d30:    ['30 days', t => [sdShift(t, -30), sdShift(t, -1)]],
  // WHOLE Sunday–Saturday weeks (12 Nov). Amazon's sessions come one report per brand per such week, so these
  // are the ranges where Sessions and Unit session % fill in — every other chip shows "—" there.
  lwk:    ['Last week', t => [sdShift(wKeyOfDate(t), -7), sdShift(wKeyOfDate(t), -1)]],
  w4:     ['Last 4 weeks', t => [sdShift(wKeyOfDate(t), -28), sdShift(wKeyOfDate(t), -1)]],
  month:  ['This month', t => [t.slice(0, 8) + '01', t]],
  lmonth: ['Last month', t => {
    const e = sdShift(t.slice(0, 8) + '01', -1);
    return [e.slice(0, 8) + '01', e];
  }],
};
// The [lo, hi] of the chosen date chip, or the custom dates.
function pxRange() {
  return PX.dkey === 'custom' ? [PX.lo, PX.hi] : (PX_DATES[PX.dkey] || PX_DATES.d7)[1](pxToday());
}

// Column set-ups. A month splits into weeks of that month (1–7, 8–14 …); the rest are N × X days. 'sat' = the
// columns are whole Sunday–Saturday weeks ending last Saturday — the old tab's week grid, with sessions in it.
// (12 Nov: "Last 3 months" as 3 × 30 days is gone: before the per-day window only whole weeks can be answered, so
// two of its three columns always said "no data". 13 and 26 weeks replace it.)
const PX_COLP = [
  ['d7x1', 'Last 7 days, day by day', 7, 1],
  ['month', 'This month'],
  ['lmonth', 'Last month'],
  ['w13', 'Last 13 weeks', 13, 7, 'sat'],
  ['w26', 'Last 26 weeks', 26, 7, 'sat']];
// The default last day of a column set-up: last Saturday for the week presets, else yesterday.
function pxDefEnd(pc) {
  const p = PX_COLP.find(x => x[0] === pc.preset), t = pxToday();
  return p && p[4] === 'sat' ? sdShift(wKeyOfDate(t), -1) : sdShift(t, -1);
}
// The [lo, hi] of each column for a column set-up: the weeks of a month, or n columns of len days ending on end.
function pxCols(pc) {
  const t = pxToday();
  if (pc.preset === 'month' || pc.preset === 'lmonth') {
    const [lo, hi] = PX_DATES[pc.preset][1](t), out = [];
    for (let a = lo; a <= hi; a = sdShift(a, 7)) {
      const b = sdShift(a, 6);
      out.push([a, b < hi ? b : hi]);
    }
    return out;
  }
  const end = pc.end || pxDefEnd(pc), out = [];
  for (let k = pc.n - 1; k >= 0; k--) {
    const hi = sdShift(end, -k * pc.len);
    out.push([sdShift(hi, -(pc.len - 1)), hi]);
  }
  return out;
}
// Words for a column set-up: "This month · week by week", "Last 13 weeks · Sun–Sat" or "4 columns × 7 days".
function pxColsDesc(pc) {
  const p = PX_COLP.find(x => x[0] === pc.preset);
  if (pc.preset === 'month' || pc.preset === 'lmonth') return p[1] + ' · week by week';
  if (p && p[4] === 'sat') return p[1] + ' · Sun–Sat';
  return pc.n + ' columns × ' + pc.len + (pc.len === 1 ? ' day' : ' days');
}

/* ---------- which store answers a range ---------- */
let PX_SALEWK = null;                          // 'brand|week' → that brand has sales figures for that week
// The set of 'brand|week' with sales figures in WEEKLY, built once per render.
function pxSaleWeeks() {
  if (PX_SALEWK) return PX_SALEWK;
  PX_SALEWK = new Set();
  Object.values(WEEKLY.rows).forEach(r => Object.entries(r.weeks || {}).forEach(([w, c]) => {
    if (c && (c.rev || c.u) && r.brand) PX_SALEWK.add(r.brand + '|' + w);
  }));
  return PX_SALEWK;
}
// The oldest week that EVERY brand in view has sales figures for ('' when none).
const pxOldestSaleWeek = () => {
  const bs = PX.brand === 'ALL' ? adBrands() : [PX.brand];
  // the oldest week EVERY brand in view has, since a range needs them all
  return bs.map(b => [...pxSaleWeeks()].filter(k => k.startsWith(b + '|')).map(k => k.slice(b.length + 1)).sort()[0] || '')
    .sort().reverse()[0] || '';
};
// The plan for a date range: { src: 'day' | 'week' | 'none', keys, lo, hi, id } — which store answers it, and with which keys.
function pxPlan(lo, hi) {
  if (!lo || !hi || lo > hi) return { src: 'none', lo, hi, id: 'x' };
  if (WDAY.from && lo >= WDAY.from) return { src: 'day', keys: wDaysBetween(lo, hi), lo, hi, id: 'd' + lo + hi };
  const after = sdShift(hi, 1);
  if (wKeyOfDate(lo) === lo && wKeyOfDate(after) === after) {
    const keys = [];
    for (let w = lo; w <= hi; w = sdShift(w, 7)) keys.push(w);
    // Only weeks that have SALES figures, for every brand in view: an older week can still hold a stray cell
    // from an earlier pull (sessions, ads) with no sales in it, which added up to Units "0" beside real orders
    // (2 Nov, April). Judged by the figures, not by "26 weeks from today": the stored weeks reach back past that.
    const have = pxSaleWeeks(), bs = PX.brand === 'ALL' ? adBrands() : [PX.brand];
    if (keys.some(k => bs.some(b => !have.has(b + '|' + k))))
      return { src: 'none', why: 'old', lo, hi, id: 'o' + lo + hi };
    return { src: 'week', keys, lo, hi, id: 'w' + lo + hi };
  }
  return { src: 'none', lo, hi, id: 'n' + lo + hi };
}
// The plan for the same number of days just before a plan.
const pxPrevPlan = p => {
  const L = pxLen(p.lo, p.hi);
  return pxPlan(sdShift(p.lo, -L), sdShift(p.lo, -1));
};

/* ---------- orders and ad units: figures the old tab never carried ----------
 * Written by the SECOND worker (V2Nightly.gs) into its own caches, so the main nightly and every old page
 * are untouched: orders per ASIN at [2] of 'v2_weekly' / 'v2_dailyAsin', ad units at [5] of 'v2_adsAsin' /
 * 'v2_adsAsinDay'. The account's UNIQUE orders come from [2] of the main 'daily' cache, as before.
 * A cache that is missing or lacks the position stores nothing, and the page shows "—", never 0. */
// wk / day: asin → key → [orders, ad units]; acct: brand → day → unique orders; miss: ad windows Amazon did not
// deliver; cov: the first date each figure exists for; run: when this was last read.
let PXN = { wk: {}, day: {}, acct: {}, miss: [], cov: { oWk: '', oDay: '', ad: '' }, run: 0 };
// Read the second worker's caches (and the main daily cache) into PXN, all at the same time.
async function pxExtra() {
  const brands = adBrands(), wk = {}, day = {}, acct = {}, miss = [];
  // --- helpers ---
  const put = (store, a, key, i, v) => {
    if (v == null) return;
    const r = store[a] || (store[a] = {}), c = r[key] || (r[key] = [null, null]);
    c[i] = v;
  };
  const read = async (name, fn) => {
    try {
      const r = await baCall({ cache: name });
      fn(r.data || {});
    } catch (e) { /* that piece shows "—" */ }
  };
  const each = (src, fn) => brands.forEach(b => Object.entries(src[b] || {}).forEach(([a, byK]) =>
    Object.entries(byK || {}).forEach(([k, v]) => fn(a, k, v || [], b))));
  // A window Amazon would not deliver (`missing`, per brand) gives that brand NO ad units on those dates —
  // a week touching it included — so the page shows "—" there rather than a total that is quietly short.
  const gap = (d, b, lo, hi) => (d.missing || []).some(m => m.brand === b && lo <= m.end && hi >= m.start);
  const wkEnd = k => new Date(Date.parse(k + 'T00:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
  // COVERAGE: the first date each figure exists for. A range starting earlier would add up only the part
  // inside, so it gets no figure at all ("—"): orders begin at the oldest week / day the worker keeps, ad units
  // at the ~93 days Amazon keeps (counted from the day the ad cache was written).
  const cov = { oWk: '', oDay: '', ad: '' };
  const minKey = src => {
    let m = '';
    brands.forEach(b => Object.values(src[b] || {}).forEach(byK => Object.keys(byK || {}).forEach(k => {
      if (!m || k < m) m = k;
    })));
    return m;
  };
  // --- load data: the five caches at once ---
  await Promise.all([
    read('v2_weekly', d => {
      cov.oWk = minKey(d.rows || {});
      each(d.rows || {}, (a, k, v) => put(wk, a, k, 0, v[2]));
    }),
    read('v2_dailyAsin', d => {
      cov.oDay = d.from || minKey(d.d || {});
      each(d.d || {}, (a, k, v) => put(day, a, k, 0, v[2]));
    }),
    read('v2_adsAsin', d => {
      const at = String(d.at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(at)) cov.ad = sdShift(at, -92);
      miss.push(...(d.missing || []));
      each(d.d || {}, (a, k, v, b) => { if (!gap(d, b, k, wkEnd(k))) put(wk, a, k, 1, v[5]); });
    }),
    read('v2_adsAsinDay', d => {
      miss.push(...(d.missing || []));
      each(d.d || {}, (a, k, v, b) => { if (!gap(d, b, k, k)) put(day, a, k, 1, v[5]); });
    }),
    read('daily', d => brands.forEach(b => {
      const o = acct[b] = {};
      Object.entries((d.d || {})[b] || {}).forEach(([k, v]) => { if (v && v[2] != null) o[k] = v[2]; });
    })),
  ]);
  PXN = { wk, day, acct, miss, cov, run: Date.now() };
}
/* The account's UNIQUE orders over a plan — never ASIN orders added up (an order holding two sizes is
 * one order). Only for whole brands: a searched list has no unique count to give, so "—". */
// The account's unique orders over a plan for the brands in view, or null when any day is missing.
function pxAcctOrders(p) {
  if (!p || p.src === 'none' || PX.q.trim()) return null;
  const bs = PX.brand === 'ALL' ? adBrands() : [PX.brand];
  let n = 0;
  // EVERY day of the range for every brand, or no figure: a day the nightly has not written yet (or one
  // before its window) would otherwise be silently left out. Today is the exception — it is still running,
  // and whatever the nightly has for it is all there is.
  const today = pxToday();
  let any = false;
  for (const d of wDaysBetween(p.lo, p.hi)) {
    for (const b of bs) {
      const v = (PXN.acct[b] || {})[d];
      if (v == null) {
        if (d >= today) continue;
        return null;
      }
      n += v;
      any = true;
    }
  }
  return any ? n : null;                       // nothing written yet (today, first thing) is "—", not 0
}

// pxSumAsin's results for this render ('asin|plan id' → totals), and the fields that simply add up.
let PX_MEMO = new Map();
const PX_ADD = ['o', 'adO', 'adU', 'cl', 'se'];
/* Sessions come from Amazon's Sales & Traffic report: ONE report per brand per whole Sunday–Saturday week —
 * there is no per-day figure. So a range has sessions only when it is made of whole weeks, and only when the
 * brand's report for EVERY one of those weeks has arrived; otherwise "—", never a part-total.
 * Within a week whose report did arrive, a size with no row in it simply had no sessions recorded and counts
 * 0 (2 Nov: treating that as "unknown" blanked 528 of 713 parents, a 374-size parent being bound to have one). */
// Is a plan made of whole Sunday–Saturday weeks?
// Worked out once per plan and kept on it: pxSessions asks it for every ASIN.
const pxWholeWeeks = p => (p._ww != null ? p._ww : (p._ww = p.src !== 'none' && wKeyOfDate(p.lo) === p.lo
  && wKeyOfDate(sdShift(p.hi, 1)) === sdShift(p.hi, 1)));
let PX_SESS = null;                            // 'brand|week' → the brand's traffic report for that week is in
// The set of 'brand|week' whose traffic report (sessions) is in WEEKLY, built once per render.
function pxSessWeeks() {
  if (PX_SESS) return PX_SESS;
  PX_SESS = new Set();
  Object.values(WEEKLY.rows).forEach(r => Object.entries(r.weeks || {}).forEach(([w, c]) => {
    if (c && c.sessions != null && r.brand) PX_SESS.add(r.brand + '|' + w);
  }));
  return PX_SESS;
}
// One ASIN's sessions over a whole-weeks plan, or null when any week's report for its brand is not in.
function pxSessions(a, p) {
  if (!pxWholeWeeks(p)) return null;
  const r = WEEKLY.rows[a] || {}, b = r.brand || (pxLookup()[a] || {}).brand,
    wks = r.weeks || {}, have = pxSessWeeks();
  let n = 0;
  for (let w = p.lo; w <= p.hi; w = sdShift(w, 7)) {
    if (!have.has(b + '|' + w)) return null;                 // that brand's report for that week is not in
    n += (wks[w] && wks[w].sessions) || 0;
  }
  return n;
}
// One ASIN's totals over a plan — units, sales, ad spend, ad sales, orders, ad orders, ad units, clicks,
// sessions — from the store the plan names, memoised for the render.
/* ---------- how far the ad report reaches ----------
 * The nightly brings sales up to yesterday but the ad report a day behind (13 Nov: sales to 12 Nov, ads to 11 Nov).
 * Adding ad spend over the days it exists and sales over every day made TACoS, organic sales and organic share wrong
 * for any dates ending yesterday — so those three are worked out over the days the ad report covers ONLY, and the
 * page says "ads to …". PX_ADEND: brand → the last day any of its ASINs has an ad figure ('' = none); worked out once
 * per render from the per-day store. */
let PX_ADEND = null;
function pxAdEnd(b) {
  if (!PX_ADEND) {
    PX_ADEND = {};
    const look = pxLookup();
    Object.keys(WDAY.rows).forEach(a => {
      const br = (WEEKLY.rows[a] && WEEKLY.rows[a].brand) || (look[a] && look[a].brand) || '';
      const days = WDAY.rows[a].days || {};
      Object.keys(days).forEach(d => {
        const c = days[d];
        if (c && (c.spend != null || c.adSales != null) && d > (PX_ADEND[br] || '')) PX_ADEND[br] = d;
      });
    });
  }
  return PX_ADEND[b] || '';
}
// The last day with ad figures for every brand in view (the earliest of them), or '' when there is no per-day store.
function pxAdEndView() {
  const bs = PX.brand === 'ALL' ? adBrands() : [PX.brand];
  const ends = bs.map(pxAdEnd).filter(Boolean);
  return ends.length ? ends.sort()[0] : '';
}
function pxSumAsin(a, p) {
  const k = a + '|' + p.id;
  if (PX_MEMO.has(k)) return PX_MEMO.get(k);
  const o = { u: 0, rev: 0, spend: null, adSales: null, o: null, adO: null, adU: null, cl: null, se: null,
    has: false, revA: 0, uA: 0, adTo: '' };
  if (p.src !== 'none') {
    // --- add the days or weeks up ---
    const store = p.src === 'day' ? (WDAY.rows[a] || {}).days : (WEEKLY.rows[a] || {}).weeks;
    const xs = (p.src === 'day' ? PXN.day : PXN.wk)[a] || {};
    // The days the ad report covers for this ASIN's brand: sales on them (revA, uA) are what the ad ratios use.
    const br = (WEEKLY.rows[a] || {}).brand || (pxLookup()[a] || {}).brand;
    const end = pxAdEnd(br);
    const covered = key => !end || (p.src === 'day' ? key <= end : sdShift(key, 6) <= end);
    if (end && p.hi > end) o.adTo = end;
    if (store) p.keys.forEach(key => {
      const c = store[key];
      if (!c) return;
      o.has = true;
      o.u += c.u || 0;
      o.rev += c.rev || 0;
      if (covered(key)) {
        o.revA += c.rev || 0;
        o.uA += c.u || 0;
      }
      if (c.spend != null) o.spend = (o.spend || 0) + c.spend;
      if (c.adSales != null) o.adSales = (o.adSales || 0) + c.adSales;
      if (c.adOrders != null) o.adO = (o.adO || 0) + c.adOrders;
      if (c.clicks != null) o.cl = (o.cl || 0) + c.clicks;
      const x = xs[key];
      if (x && x[0] != null) o.o = (o.o || 0) + x[0];
      if (x && x[1] != null) o.adU = (o.adU || 0) + x[1];
    });
    // --- blank what cannot be a whole figure ---
    // Any part of these dates inside a window Amazon did not deliver for this ASIN's brand: the total
    // would be short, so there is no ad-units figure for the range at all — and the flag carries that to
    // every total this ASIN is part of (a parent, "Both" brands), which would otherwise add up the rest.
    const b = (WEEKLY.rows[a] || {}).brand || (pxLookup()[a] || {}).brand;
    if (PXN.miss.some(m => m.brand === b && p.lo <= m.end && p.hi >= m.start)) {
      o.adU = null;
      o.adGap = true;
    }
    // Dates before the new figures begin: no part-totals (see `cov` in pxExtra).
    const oStart = p.src === 'day' ? PXN.cov.oDay : PXN.cov.oWk;
    if (!oStart || p.lo < oStart) o.o = null;
    if (!PXN.cov.ad || p.lo < PXN.cov.ad) {
      o.adU = null;
      o.adGap = true;
    }
    o.se = pxSessions(a, p);
  }
  PX_MEMO.set(k, o);
  return o;
}
// Summed field by field, ratios worked out afterwards from the totals — never an average of ratios.
// Add the ratios to a totals object: conversion rate, organic sales / units / share, ACoS, TACoS.
function pxDerive(o) {
  if (!o.has) {
    return Object.assign(o, { os: null, op: null, acos: null, tacos: null, ou: null, cr: null, roas: null, cpc: null,
      usp: null });
  }
  // AD CVR: ad orders ÷ clicks — the share of ad clicks that became an order. The Ad Console's "CVR" is this
  // same sum. The OLD PPC tab's "CVR" is a different one, units ÷ sessions, which is `usp` below; the two were
  // both called conversion rate and read 4.0% against 2.5% for the same fortnight (12 Nov).
  o.cr = o.cl == null || !o.cl || o.adO == null ? null : o.adO / o.cl * 100;
  // Unit session % — Seller Central's name for units ÷ sessions; only where sessions are known (whole weeks).
  o.usp = o.se == null || !o.se ? null : o.u / o.se * 100;
  // ROAS and CPC, as the Ad Console works them out: ad sales ÷ spend, spend ÷ clicks.
  o.roas = o.spend == null || !o.spend || o.adSales == null ? null : o.adSales / o.spend;
  o.cpc = o.spend == null || o.cl == null || !o.cl ? null : o.spend / o.cl;
  // Organic and TACoS set ad figures against sales over the SAME days: the days the ad report covers (revA / uA,
  // pxAdEnd). Where every day is covered they are simply the sales and units.
  const rA = o.revA != null ? o.revA : o.rev, uA = o.uA != null ? o.uA : o.u;
  o.os = o.adSales == null ? null : Math.max(0, rA - o.adSales);
  o.ou = o.adU == null ? null : Math.max(0, uA - o.adU);
  o.op = o.os == null || !rA ? null : o.os / rA * 100;
  o.acos = o.spend == null || !o.adSales ? null : o.spend / o.adSales * 100;
  o.tacos = o.spend == null || !rA ? null : o.spend / rA * 100;
  return o;
}
// The totals of a list of ASINs over a plan, with the ratios, and (withPrev) the change in sales against the
// same number of days before.
function pxStats(asins, p, withPrev) {
  const o = { u: 0, rev: 0, spend: null, adSales: null, o: null, adO: null, adU: null, cl: null, se: null,
    has: false, revA: 0, uA: 0, adTo: '' };
  let seGap = false, adGap = false;
  // --- add the ASINs up ---
  asins.forEach(a => {
    const s = pxSumAsin(a, p);
    // Sessions and the gap flags count even for a size with no sales in the range: it can still have had
    // visitors (and its brand's missing ad report still makes the total short).
    if (s.se != null) o.se = (o.se || 0) + s.se;
    else if (pxWholeWeeks(p)) seGap = true;
    if (s.adGap) adGap = true;
    if (s.adTo && (!o.adTo || s.adTo < o.adTo)) o.adTo = s.adTo;
    if (!s.has) return;
    o.has = true;
    o.u += s.u;
    o.rev += s.rev;
    o.revA += s.revA;
    o.uA += s.uA;
    if (s.spend != null) o.spend = (o.spend || 0) + s.spend;
    if (s.adSales != null) o.adSales = (o.adSales || 0) + s.adSales;
    PX_ADD.forEach(k => { if (k !== 'se' && s[k] != null) o[k] = (o[k] || 0) + s[k]; });
  });
  if (seGap) o.se = null;                      // one brand's weekly report missing: no part-total
  if (adGap) o.adU = null;                     // one brand's ad report missing, or dates before ~93 days
  pxDerive(o);
  // --- vs prev ---
  // "vs prev" only for finished periods: today or this month so far, set beside a whole period before
  // them, reads as a collapse (and fills the "Falling" chip) when nothing has fallen.
  if (withPrev) {
    const q = p.hi >= pxToday() ? null : pxStats(asins, pxPrevPlan(p), false);
    o.vp = q && o.has && q.has && q.rev ? (o.rev - q.rev) / q.rev * 100 : null;
  }
  return o;
}

/* ---------- products: parents, children, names, SKUs, pictures ---------- */
let PX_LOOK = null;          // asin → { brand, sku } from the Listing Health snapshot
// asin → { brand, sku } over both brands' Listing Health rows, built once (reset when health reloads).
function pxLookup() {
  if (PX_LOOK) return PX_LOOK;
  PX_LOOK = {};
  ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
    const a = String(r.asin || '').trim().toUpperCase();
    if (a && !PX_LOOK[a]) PX_LOOK[a] = { brand: b, sku: r.sku || '' };
  }));
  return PX_LOOK;
}
/* Pictures come from Image Manager's snapshot, which the rules open only to Image Manager and Listing
 * Errors. Anyone else gets a lettered tile — never an error, since a missing picture loses nothing. */
let PX_IMG = null;
// Load the pictures (asin → { u: url, c: colour, z: size }) from Image Manager's lists when allowed, then redraw.
async function pxImages() {
  if (PX_IMG) return;
  PX_IMG = {};
  if (!(ME.admin || ME.tabs.includes('img') || ME.tabs.includes('lerr'))) return;
  for (const b of adBrands()) {
    try {
      if (!(b in IML)) await imListLoad(b);
      (IML[b]?.items || []).forEach(x => {
        const a = String(x.asin || '').trim().toUpperCase();
        if (!a || PX_IMG[a]) return;
        PX_IMG[a] = { u: (x.live || {}).MAIN || (x.img || {}).MAIN || '', c: x.c || '', z: x.z || '' };
      });
    } catch (e) { /* no pictures for that brand — tiles instead */ }
  }
  if (TAB_NOW === 'ppcn') pxRender();
}
// The picture tile for a product: the first ASIN with a picture, else a lettered tile.
function pxPic(asins, label, small) {
  const hit = asins.map(a => PX_IMG && PX_IMG[a]).find(x => x && x.u);
  const cls = 'px-pic' + (small ? ' px-sm' : '');
  if (hit) return `<span class="${cls}"><img src="${pxEsc(imThumb(hit.u))}" alt="" loading="lazy" decoding="async"></span>`;
  return `<span class="${cls} px-noimg" aria-hidden="true">${pxEsc((label || '?').replace(/^~\s*/, '').charAt(0).toUpperCase())}</span>`;
}
// "colour · size" of one ASIN from the pictures snapshot, or ''.
function pxSize(a) {
  const x = PX_IMG && PX_IMG[a];
  return x ? [x.c, x.z].filter(Boolean).join(' · ') : '';
}

// The key of the row that gathers a brand's ASINs whose parent nobody knows ('OLD:' + brand).
const PX_OLD = 'OLD:';

/* ---------- each ASIN's parent: Listing Health first, then Amazon's catalogue ----------
 * 13 Nov (Vishesh, with Updated_Parent_Ridhi_CPC_Nov.xlsx): Listing Health keeps FBA listings only (scope.kept 2,431
 * of 2,668 Ridhi, 1,385 of 1,589 CPC), so merchant-fulfilled families such as Small Lamp Shade, Big Lamp Shade and
 * Hanging Ornaments were missing, and 13 Taffy Pink tablecloth sizes carry the parent "N/A". Every ASIN Listing Health
 * does not place under a parent is now asked of Amazon's catalogue through the backend's `parents=` route (Research.gs
 * catParents_, the same call the Master Database fills its Parent ASIN column from), 20 a call, and the answers kept
 * in this browser for a week (PX_AMZ_KEY). Only what Amazon cannot answer either (a deleted ASIN) stays "parent not
 * known". PX_AMZP: asin → parent ASIN, '' = Amazon lists it with no parent (it is its own), null = not found. */
const PX_AMZ_KEY = 'pxAmzParents', PX_AMZ_TTL = 7 * 864e5;
let PX_AMZP = (() => {
  try {
    const x = JSON.parse(localStorage.getItem(PX_AMZ_KEY) || 'null');
    return x && x.at && Date.now() - x.at < PX_AMZ_TTL && x.v ? x.v : {};
  } catch (e) { return {}; }
})();
let PX_AMZ_BUSY = false;
// An ASIN's parent. AMAZON FIRST: Listing Health's parents come from the Catalog sheet, not from Amazon, and on
// 13 Nov 246 ASINs disagreed with Amazon's catalogue (e.g. the rectangle scalloped placemat sizes filed under the
// Round parent — Amazon lists them under B0HL97V2WT, checked with the children= route). Then Listing Health's, for an
// ASIN not asked yet. '' from Amazon = it has no parent, so it is its own; null = nobody knows (deleted on Amazon).
function pxParentOf(a) {
  const look = pxLookup(), lh = look[a] ? wParentOf(a) : '';
  const lhOk = lh && lh !== a && !pxNoParent(lh);
  if (a in PX_AMZP) {
    if (PX_AMZP[a]) return PX_AMZP[a];
    if (PX_AMZP[a] === '') return a;
    return lhOk ? lh : null;                       // Amazon does not know it: Listing Health's, if it has one
  }
  if (lhOk) return lh;
  return look[a] && !pxNoParent(lh) ? a : null;
}
/* DISCONTINUED (13 Nov, Vishesh): products the team has stopped. Their whole Amazon family (the parent of any ASIN here,
 * and every size under it) is shown last, tagged "Discontinued", and counted apart — never as a parent and never in the
 * recommendations. Their sales stay in every total. Add an ASIN (any size, or the parent) to retire its family. */
const PX_DISC = new Set([
  'B0D9BRTJCN', 'B0D9BS7TMB', 'B0D79C95TR',      // Fabricrush summer dresses (Tulip Pink, Steel Blue, Floral maxi)
]);
// Every ASIN of the allowed brands: its parent (parOf) and what it is (kind: 'fam' = in a family, 'solo' = a current
// stand-alone listing, 'disc' = discontinued, 'old' = inactive or deleted). Worked out once per render, for the brand
// cards and the rows alike.
let PX_KIND = null;
function pxClassify() {
  if (PX_KIND) return PX_KIND;
  const look = pxLookup(), allowed = adBrands();
  const brandOf = a => (WEEKLY.rows[a] && WEEKLY.rows[a].brand) || (look[a] && look[a].brand) || '';
  const parOf = {}, fam = {}, brand = {};
  new Set([...Object.keys(WEEKLY.rows), ...Object.keys(WDAY.rows)]).forEach(a => {
    const b = brandOf(a);
    if (!allowed.includes(b)) return;
    brand[a] = b;
    const p = pxParentOf(a);
    parOf[a] = p;
    if (p && p !== a) fam[b + '|' + p] = true;
  });
  // A discontinued ASIN retires its whole family: its parent, and every ASIN under that parent.
  const discPar = new Set();
  PX_DISC.forEach(a => {
    discPar.add(a);
    if (parOf[a]) discPar.add(parOf[a]);
  });
  const kinds = {};
  Object.keys(parOf).forEach(a => {
    const p = parOf[a], b = brand[a];
    kinds[a] = PX_DISC.has(a) || discPar.has(a) || (p && discPar.has(p)) ? 'disc'
      : p && fam[b + '|' + p] ? 'fam' : p && (look[a] || pxActive30(a)) ? 'solo' : 'old';
  });
  PX_KIND = { parOf, brand, kinds, kind: a => kinds[a] || 'old' };
  return PX_KIND;
}
// Sold or advertised in the last 30 days, from the per-day store: what keeps a stand-alone listing on its own row.
function pxActive30(a) {
  const days = (WDAY.rows[a] || {}).days;
  if (!days) return false;
  const lo = sdShift(pxToday(), -30);
  return Object.keys(days).some(d => d >= lo && ((days[d].rev || 0) > 0 || (days[d].spend || 0) > 0));
}
// Ask Amazon for the parent of every ASIN in the stores that Listing Health does not place under one (and that was
// not asked this week), then redraw. Runs in the background; the page shows them as "parent not known" meanwhile.
async function pxAmzFill() {
  if (PX_AMZ_BUSY || !API || !API.url) return;
  const look = pxLookup(), want = { SP: [], CPC: [] };
  new Set([...Object.keys(WEEKLY.rows), ...Object.keys(WDAY.rows)]).forEach(a => {
    if (!/^[A-Z0-9]{10}$/.test(a) || a in PX_AMZP) return;
    const b = (WEEKLY.rows[a] && WEEKLY.rows[a].brand) || (look[a] && look[a].brand) || '';
    if (want[b]) want[b].push(a);
  });
  const jobs = [];
  Object.entries(want).forEach(([b, as]) => { for (let i = 0; i < as.length; i += 20) jobs.push([b, as.slice(i, i + 20)]); });
  if (!jobs.length) return;
  PX_AMZ_BUSY = true;
  let i = 0, done = 0;
  const say = () => {
    PX.msg = `Checking each ASIN's parent on Amazon (${Object.values(want).reduce((n, x) => n + x.length, 0).toLocaleString('en-US')} ASINs, once a week)… ${Math.round(done / jobs.length * 100)}%`;
    const f = document.querySelector('#panePpcn .px-fresh');
    if (f) f.textContent = PX.msg;
  };
  say();
  const worker = async () => {
    while (i < jobs.length) {
      const [b, as] = jobs[i++];
      try {
        const d = await tCall({ parents: as.join(','), brand: b });
        Object.entries(d.parents || {}).forEach(([a, p]) => { PX_AMZP[a] = String(p).toUpperCase(); });
        (d.single || []).forEach(a => { PX_AMZP[a] = ''; });
        (d.notFound || []).forEach(a => { PX_AMZP[a] = null; });
      } catch (e) { /* asked again next time */ }
      done++;
      say();
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
    try { localStorage.setItem(PX_AMZ_KEY, JSON.stringify({ at: Date.now(), v: PX_AMZP })); } catch (e) { /* this visit only */ }
  } finally {
    PX_AMZ_BUSY = false;
    PX.msg = '';
    if (TAB_NOW === 'ppcn') pxRender();
  }
}
// A parent written as a placeholder in Listing Health ("N/A" on 13 Taffy Pink tablecloth sizes, 13 Nov) is no parent.
const pxNoParent = p => /^(N\/?A|NONE|NULL|-+|0)$/i.test(String(p || '').trim());
// The rows in view before filtering: one per child ASIN, or one per parent with its ASINs, for the brand(s) chosen.
function pxEntities() {
  const look = pxLookup(), allowed = adBrands();
  const brandOf = a => (WEEKLY.rows[a] && WEEKLY.rows[a].brand) || (look[a] && look[a].brand) || '';
  // --- every ASIN of the brands in view ---
  const all = new Set([...Object.keys(WEEKLY.rows), ...Object.keys(WDAY.rows)]);
  const keep = [];
  all.forEach(a => {
    const b = brandOf(a);
    if (!allowed.includes(b) || (PX.brand !== 'ALL' && b !== PX.brand)) return;
    keep.push([a, b]);
  });
  // --- every ASIN's parent, and which parents are families (a parent with at least one other ASIN under it) ---
  // 13 Nov (Vishesh: "767 parents"; his sheet has 50 Ridhi / 42 CPC): a PARENT is a family. An ASIN Amazon lists with
  // no parent is a STAND-ALONE listing: its own row when it is in Listing Health or sold / was advertised in the last
  // 30 days, otherwise it goes — with ASINs Amazon no longer knows — into one "inactive or deleted listings" row per
  // brand. Their sales are real and stay in every total; they are never counted as parents.
  const { parOf, kind } = pxClassify();
  // --- child level: one row each ---
  if (PX.level === 'child') {
    return keep.map(([a, b]) => {
      const k = kind(a, b);
      return { key: a, brand: b, asins: [a], title: wTitle(a) || '', sku: (look[a] || {}).sku || '',
        size: pxSize(a), parent: k === 'fam' || k === 'disc' ? parOf[a] || '' : '', old: k === 'old', solo: k === 'solo', disc: k === 'disc' };
    });
  }
  // --- parent level: grouped, with the hand-corrected name when there is one ---
  const g = {};
  keep.forEach(([a, b]) => {
    const k = kind(a, b);
    if (k === 'old') {
      const key = PX_OLD + b;
      const o = g[key] || (g[key] = { key, brand: b, asins: [], old: true, find: ' inactive deleted stand-alone',
        title: `${BRAND_NAME[b] || b} · inactive or deleted listings` });
      o.asins.push(a);
      o.find += ' ' + a;
      return;
    }
    const p = parOf[a] || a;
    const o = g[p] || (g[p] = { key: p, brand: b, asins: [], title: '', find: '', solo: k === 'solo', disc: k === 'disc' });
    o.asins.push(a);
    o.find += ' ' + a + ' ' + ((look[a] || {}).sku || '');    // a size's ASIN or SKU finds its parent
    if (!o.title) {
      const own = PNAME[b]?.[p]?.v || HEALTH[b]?.parentNames?.[p] || '';
      o.title = own || (wTitle(a) ? '~ ' + wTitle(a) : '');
    }
  });
  return Object.values(g);
}

/* ---------- filters, columns, sort ---------- */
// The quick-filter chips: key → [label, test on a row's totals].
const PX_FILTERS = {
  all:  ['All', () => true],
  cut:  ['ACoS 55%+', o => o.acos != null && o.acos >= 55],
  tac:  ['TACoS 30%+', o => o.tacos != null && o.tacos >= 30],
  org:  ['Organic 70%+', o => o.op != null && o.op >= 70],
  fall: ['Falling 30%+', o => o.vp != null && o.vp <= -30],
  grow: ['Growing', o => o.vp != null && o.vp > 0],
};
// The range report's columns, in order: [key, title].
const PX_RCOLS = [['tr', '8-week trend'], ['se', 'Sessions'], ['usp', 'Unit session %'], ['o', 'Total orders'], ['u', 'Units'], ['rev', 'Sales'],
  ['spend', 'Ad spend'], ['adSales', 'Ad sales'], ['roas', 'ROAS'], ['adO', 'Ad orders'], ['adU', 'Ad units'],
  ['cl', 'Clicks'], ['cpc', 'CPC'], ['cr', 'Conv. rate'],
  ['acos', 'ACoS'], ['tacos', 'TACoS'],
  ['ou', 'Organic units'], ['os', 'Organic sales'], ['op', 'Organic share'], ['vp', 'vs prev']];
// What each column is, on hover over its header — the sums, so nobody has to guess which "conversion" this is.
const PX_TIPS = {
  tr: 'Weekly sales over the last 8 finished Sunday–Saturday weeks; the last bar is red when it fell 30%+ below the 7 before it, green when 10%+ above',
  se: 'Sessions — Amazon\'s Sales & Traffic report. One report per brand per whole Sunday–Saturday week, so only whole-week ranges have them.',
  usp: 'Unit session % = units ÷ sessions (what the old PPC tab called CVR). Whole weeks only.',
  o: 'Orders. The All row counts unique orders: an order holding two sizes is one order.',
  u: 'Units ordered, all channels on Amazon (MCF excluded)', rev: 'Total sales',
  spend: 'Sponsored Products spend', adSales: 'Sales Amazon attributes to an ad click',
  roas: 'ROAS = ad sales ÷ ad spend', adO: 'Orders attributed to an ad click', adU: 'Units attributed to an ad click',
  cl: 'Ad clicks', cpc: 'CPC = ad spend ÷ clicks',
  cr: 'Conv. rate = ad orders ÷ clicks — the share of ad clicks that became an order (the Ad Console\'s CVR). Units ÷ sessions is Unit session %, in Columns', acos: 'ACoS = ad spend ÷ ad sales',
  tacos: 'TACoS = ad spend ÷ total sales', ou: 'Organic units = units − ad units',
  os: 'Organic sales = sales − ad sales (never below 0)', op: 'Organic share = organic sales ÷ sales',
  vp: 'Sales against the same number of days just before',
};
// The header groups over those columns, as in the design (Traffic · Ads · Organic).
const PX_GROUPS = [
  ['', ['tr']],
  ['Traffic', ['se', 'usp', 'o', 'u', 'rev']],
  ['Ads', ['spend', 'adSales', 'roas', 'adO', 'adU', 'cl', 'cpc', 'cr', 'acos', 'tacos']],
  ['Organic', ['ou', 'os', 'op']],
  ['', ['vp']]];
// Ready-made column sets, as in the design. 'all' shows everything; the others are what each view is for.
// 'all' is the PPC & Organic · New table (13 Nov): the 8-week trend, Unit session %, ROAS and CPC are extras a
// person turns on in Columns — they are never part of a ready-made set, so a set looks exactly as it always did.
const PX_SETS = [
  ['all', 'All', ['se', 'o', 'u', 'rev', 'spend', 'adSales', 'adO', 'adU', 'cl', 'cr', 'acos', 'tacos', 'ou', 'os', 'op', 'vp']],
  ['overview', 'Overview', ['u', 'rev', 'spend', 'acos', 'tacos', 'op', 'vp']],
  ['ads', 'Ads', ['spend', 'adSales', 'adO', 'adU', 'cl', 'cr', 'acos', 'tacos']],
  ['organic', 'Organic', ['se', 'o', 'u', 'ou', 'os', 'op', 'vp']]];
// Columns added since the choices were saved: somebody who had picked their columns gets them hidden, so a
// chosen set stays as it was; somebody showing everything just sees them.
(() => {
  if (!PX.hide.length) return;
  const known = PX_SAVED_KNOWN || ['se', 'o', 'u', 'rev', 'spend', 'adSales', 'adO', 'adU', 'cl', 'cr', 'acos', 'tacos',
    'ou', 'os', 'op', 'vp'];
  PX_RCOLS.forEach(([k]) => { if (!known.includes(k) && !PX.hide.includes(k)) PX.hide.push(k); });
})();
// Which column set the visible columns amount to ('custom' when none).
const pxSetNow = () => {
  const on = PX_RCOLS.map(x => x[0]).filter(k => !PX.hide.includes(k)).join();
  const s = PX_SETS.find(([, , ks]) => (ks
    ? PX_RCOLS.map(x => x[0]).filter(k => ks.includes(k)).join()
    : PX_RCOLS.map(x => x[0]).join()) === on);
  return s ? s[0] : 'custom';
};
// The metrics a column can show in Columns by date, and how each kind is formatted.
// Sessions and Unit session % fill only columns that are whole Sunday–Saturday weeks (the 13 / 26 week set-ups).
const PX_METRICS = { rev: 'Sales', u: 'Units', o: 'Orders', se: 'Sessions', usp: 'Unit session %', adU: 'Ad units',
  ou: 'Organic units', spend: 'Ad spend', roas: 'ROAS', cl: 'Clicks', cr: 'Conv. rate', op: 'Organic %', acos: 'ACoS',
  tacos: 'TACoS' };
const pxIsPct = m => m === 'op' || m === 'acos' || m === 'tacos' || m === 'cr' || m === 'usp';
const pxIsCount = m => m === 'u' || m === 'o' || m === 'adO' || m === 'adU' || m === 'ou' || m === 'cl'
  || m === 'se';
const pxLowGood = m => m === 'acos' || m === 'tacos' || m === 'cpc';
const pxN = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const pxX = v => (v == null ? '—' : v.toFixed(2));                       // ROAS: "3.48"
const pxC2 = v => (v == null ? '—' : '$' + v.toFixed(2));                // CPC: "$0.83"
const pxFmtM = (m, v) => (v == null ? '—'
  : m === 'roas' ? pxX(v)
  : pxIsPct(m) ? v.toFixed(1) + '%'
  : pxIsCount(m) ? pxN(v)
  : pxShort(v));
/* A change, as a small pill: ▲ / ▼ and the size. kind 'pt' = percentage points (for a ratio), else per cent.
 * good: 'up' (a rise is good), 'down' (a fall is good) or '' (neither — spend going up is a choice, not a
 * result). Empty when either side is unknown: no pill says more than a made-up one. */
function pxDelta(a, b, kind, good) {
  if (a == null || b == null) return '';
  let v;
  if (kind === 'pt') v = a - b;
  else {
    if (!b) return '';
    v = (a - b) / b * 100;
  }
  const txt = Math.abs(v).toFixed(1) + (kind === 'pt' ? ' pt' : '%');
  if (Math.abs(v) < 0.05) return `<span class="px-dl px-dl-0">${txt}</span>`;
  const cls = !good ? 'px-dl-0' : (good === 'up') === (v > 0) ? 'px-dl-up' : 'px-dl-dn';
  return `<span class="px-dl ${cls}">${v > 0 ? '▲' : '▼'} ${txt}</span>`;
}

/* ---------- little pictures: sparklines and mini bars (12 Nov) ---------- */
// A sparkline of vals (a null breaks the line), coloured by cls through currentColor; the last point is marked.
function pxSpark(vals, cls, w = 112, h = 30) {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return '';
  const mx = Math.max(...v), mn = Math.min(...v), rg = mx - mn || 1;
  const X = i => (i / (vals.length - 1) * (w - 6) + 3).toFixed(1), Y = x => (h - 4 - (x - mn) / rg * (h - 8)).toFixed(1);
  let d = '', on = false;
  vals.forEach((x, i) => {
    if (x == null) {
      on = false;
      return;
    }
    d += (on ? 'L' : 'M') + X(i) + ' ' + Y(x);
    on = true;
  });
  const first = vals.findIndex(x => x != null), li = vals.length - 1 - [...vals].reverse().findIndex(x => x != null);
  const area = vals.some(x => x == null) ? '' : `<path class="px-sp-a" d="${d}L${X(li)} ${h}L${X(first)} ${h}Z"/>`;
  return `<svg class="px-sp ${cls || ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${area}<path class="px-sp-l" d="${d}"/><circle cx="${X(li)}" cy="${Y(vals[li])}" r="2.6"/></svg>`;
}
// Mini bars for vals; on(i) marks the bars that are the period itself (the rest are context, faded).
function pxBars(vals, on, cls, h = 26) {
  const n = vals.length, mx = Math.max(1, ...vals.filter(x => x != null)), bw = 100 / n;
  return `<svg class="px-mb ${cls || ''}" viewBox="0 0 100 ${h}" preserveAspectRatio="none" height="${h}" aria-hidden="true">`
    + vals.map((v, i) => (v == null ? '' : `<rect class="${on(i) ? 'on' : ''}" x="${(i * bw + bw * 0.14).toFixed(2)}" y="${(h - Math.max(1.5, v / mx * h)).toFixed(2)}" width="${(bw * 0.72).toFixed(2)}" height="${Math.max(1.5, v / mx * h).toFixed(2)}" rx="0.8"/>`)).join('')
    + '</svg>';
}
// The last 8 FINISHED Sunday weeks, oldest first.
const pxLast8 = () => {
  const e = sdShift(wKeyOfDate(pxToday()), -7);
  return Array.from({ length: 8 }, (_, i) => sdShift(e, -7 * (7 - i)));
};
// The 8-week trend cell: weekly sales of a list of ASINs as eight bars, the last one coloured by how it compares.
function pxTrend8(asins) {
  const wks = pxLast8();
  const v = wks.map(k => {
    let s = 0;
    asins.forEach(a => {
      const c = ((WEEKLY.rows[a] || {}).weeks || {})[k];
      if (c && c.rev) s += c.rev;
    });
    return s;
  });
  const avg = v.slice(0, 7).reduce((a, b) => a + b, 0) / 7, last = v[7];
  const cls = !avg && !last ? 'px-tr-0' : last < avg * 0.7 ? 'px-tr-dn' : last > avg * 1.1 ? 'px-tr-up' : '';
  const tip = `Weekly sales, ${pxColLabel(wks[0], sdShift(wks[0], 6))} to ${pxColLabel(wks[7], sdShift(wks[7], 6))}: last week ${pxMoney(last)} against ${pxMoney(avg)} a week before it`;
  return `<span class="px-tr ${cls}" title="${pxEsc(tip)}">${pxBars(v, i => i === 7, '', 22)}</span>`;
}
const pxShown = k => !PX.hide.includes(k);

/* ---------- render ---------- */
// The two toolbar icons (calendar, columns).
const PX_IC_RANGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
  + '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const PX_IC_COLS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
  + '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/></svg>';

// Everything one render needs: the rows (ents), the ones matching the search (found, each with its totals in
// st), the span the filters judge by, and the column plans in Columns by date.
function pxCtx() {
  // Everything one render needs, worked out once.
  const ents = pxEntities();
  const q = PX.q.trim().toLowerCase();
  const found = q
    ? ents.filter(e => (e.title + ' ' + e.key + ' ' + (e.sku || '') + ' ' + (e.size || '') + (e.find || '')).toLowerCase().includes(q))
    : ents;
  let span, cols = null;
  if (PX.mode === 'cols') {
    cols = pxCols(PX.pc).map(([lo, hi]) => pxPlan(lo, hi));
    span = pxPlan(cols[0].lo, cols[cols.length - 1].hi);
    if (span.src === 'none') span = cols[cols.length - 1];     // filters fall back to the newest column
  } else {
    const [lo, hi] = pxRange();
    span = pxPlan(lo, hi);
  }
  found.forEach(e => { e.st = pxStats(e.asins, span, true); });
  return { ents, found, span, cols };
}
// A row's value for a sort key: title, SKU, one column's metric ('c:n'), the change ('chg'), or a totals field.
function pxVal(e, k, ctx) {
  if (k === 't') return e.title || e.key;
  if (k === 'sku') return e.sku || '';
  if (k.startsWith('c:')) return pxStats(e.asins, ctx.cols[+k.slice(2)])[PX.metric];
  if (k === 'chg') {
    const c = pxChange(e, ctx);
    return c ? c.v : null;
  }
  return e.st[k];
}
/* The last FINISHED column against the one before it. A column still running today is skipped, as
 * wWeekDone skips a running week on the old tab: two days set beside seven reads as a collapse. */
// { v: change, pt: true for percentage points } between the last two finished columns, or null.
function pxChange(e, ctx) {
  const cs = ctx.cols || [], today = pxToday();
  let i = cs.length - 1;
  while (i >= 0 && cs[i].hi >= today) i--;
  if (i < 1) return null;
  const val = c => (e.total && PX.metric === 'o' ? pxAcctOrders(c) : pxStats(e.asins, c)[PX.metric]);
  const a = val(cs[i]), b = val(cs[i - 1]);
  if (a == null || b == null) return null;
  return pxIsPct(PX.metric) ? { v: a - b, pt: true } : b ? { v: (a - b) / b * 100 } : null;
}
// Each row's sort value is worked out ONCE, not on every comparison: in columns mode at child level that
// was ~6,000 rows × log n comparisons × two pxStats each.
// The rows sorted by PX.sk in direction PX.sd; blanks last.
function pxSorted(list, ctx) {
  return list.map(e => ({ e, v: pxVal(e, PX.sk, ctx) })).sort((x, y) => {
    // Discontinued products always at the end, then the "inactive or deleted" rows; the sort applies within each.
    const rank = o => (o.e.old ? 2 : o.e.disc ? 1 : 0);
    if (rank(x) !== rank(y)) return rank(x) - rank(y);
    const a = x.v, b = y.v;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
    return c * PX.sd;
  }).map(x => x.e);
}

// A sortable header cell; an ACoS value as a coloured pill; an organic-share bar; the TACoS colour class.
/* ---------- the (i) notes (13 Nov, Vishesh) ----------
 * Every block and every graph carries an (i): what it shows, what it compares, and against which dates — worked out
 * for what is on screen now, not a fixed help text. pxI draws the button and files its note in PX_INFO; the open
 * note (PX.info) is one card drawn over the page by pxInfoShow, so no card's rounded clip cuts it off. */
let PX_INFO = {};
function pxI(id, title, html) {
  PX_INFO[id] = [title, html];
  return `<button type="button" class="px-i" data-pxinfo="${id}" aria-expanded="${PX.info === id}" aria-label="About: ${pxEsc(title)}" title="What is this?">`
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/></svg></button>';
}
// Show (or move) the open note under its button, kept inside the page's width; take it away when none is open.
function pxInfoShow() {
  const pane = $('panePpcn'), main = pane && pane.querySelector('.px-main');
  if (!main) return;
  main.querySelectorAll('.px-ipop').forEach(x => x.remove());
  pane.querySelectorAll('.px-i[aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
  const id = PX.info, note = id && PX_INFO[id];
  const btn = note && pane.querySelector(`.px-i[data-pxinfo="${id}"]`);
  if (!btn) {
    PX.info = null;
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  const pop = document.createElement('div');
  pop.className = 'px-ipop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', note[0]);
  pop.innerHTML = `<div class="px-ipop-h"><span class="px-ipop-ic">i</span><b>${pxEsc(note[0])}</b><button type="button" class="px-ipop-x" data-pxinfo="${id}" aria-label="Close">✕</button></div><div class="px-ipop-b">${note[1]}</div>`;
  main.appendChild(pop);
  const r = btn.getBoundingClientRect(), m = main.getBoundingClientRect(), w = pop.offsetWidth;
  const left = Math.max(4, Math.min(r.left - m.left - 24, m.width - w - 4));
  pop.style.left = left + 'px';
  pop.style.top = (r.bottom - m.top + 10) + 'px';
  pop.style.setProperty('--px-arrow', Math.max(14, Math.min(w - 20, r.left - m.left - left + r.width / 2 - 6)) + 'px');
}
const pxTh = (label, k, cls, sub, tip, extra) => `<th class="px-th ${cls || ''}" tabindex="0" data-pxsort="${k}"${tip ? ` title="${pxEsc(tip)}"` : ''}${PX.sk === k ? ` data-dir="${PX.sd > 0 ? 'asc' : 'desc'}"` : ''}>${label}${extra || ''}${sub ? `<small>${sub}</small>` : ''}</th>`;
const pxAcos = v => (v == null ? '<span class="px-dim">—</span>'
  : v >= 55 ? `<span class="px-pill px-bad">${pxPct(v)}</span>`
  : v <= 30 ? `<span class="px-pill px-ok">${pxPct(v)}</span>`
  : pxPct(v));
const pxObar = v => (v == null ? '<span class="px-dim">—</span>'
  : `<span class="px-obar"><span>${pxPct(v)}</span><i style="--p:${Math.max(0, Math.min(100, v)).toFixed(0)}%"></i></span>`);
const pxTacC = v => (v == null ? 'px-dim' : v >= 30 ? 'px-neg' : v <= 15 ? 'px-pos' : '');

// The Product cell: picture, name and ASIN; a child row shows its size; a parent with several sizes gets the button.
function pxProd(e, kid, bare) {
  if (kid) {
    const label = pxSize(e.key) || e.title || e.key;
    return `<div class="px-prod">${pxPic([e.key], label, true)}<div><b class="px-name" data-pxwhy="${pxEsc(e.key)}" title="Why did it move?">${pxEsc(label)}</b><small>${pxEsc(e.key)}</small></div></div>`;
  }
  const oldTag = e.disc ? '<span class="px-oldtag px-disctag" title="Discontinued by the team: shown last, not counted as a parent, left out of the recommendations. Its sales stay in the totals.">Discontinued</span>'
    : e.solo ? '<span class="px-oldtag px-solotag" title="Amazon lists this ASIN with no parent: a stand-alone listing, not counted as a parent.">stand-alone</span>'
    : '<span class="px-oldtag" title="In no family, and with no sales or ads in 30 days (or no longer on Amazon). Its figures are real and are in every total.">inactive or deleted</span>';
  if (PX.level === 'child') {
    return `<div class="px-prod">${pxPic([e.key], e.title)}<div><b><span class="px-name" data-pxwhy="${pxEsc(e.key)}" title="Why did it move?">${pxEsc(e.title || e.key)}</span>${e.size ? `<span class="px-var">${pxEsc(e.size)}</span>` : ''}${e.old || e.solo || e.disc ? oldTag : ''}</b>`
      + `<small>${pxEsc(e.key)}${e.parent && e.parent !== e.key ? ' · parent ' + pxEsc(e.parent) : ''}</small></div></div>`;
  }
  const n = e.asins.length;
  if (e.old) {
    // The gathered old ASINs: their count, opened like a parent's sizes; no "Why?" — they are not one product.
    const t = bare ? `<span class="px-sizes px-sizes-q">${n} ASINs</span>`
      : `<button class="px-sizes" data-pxopen="${pxEsc(e.key)}" aria-expanded="${PX.open.has(e.key)}">${n} ASINs <i>▸</i></button>`;
    return `<div class="px-prod px-oldrow" title="ASINs in no family: stand-alone listings with no sales or ads in 30 days that are not in Listing Health, and ASINs Amazon no longer knows. Their sales are real and in every total; they are not counted as parents."><span class="px-pic px-noimg" aria-hidden="true">?</span><div><b><span>${pxEsc(e.title)}</span>${t}</b><small>${PX_AMZ_BUSY ? 'checking parents on Amazon…' : 'no family, no sales or ads in 30 days'} · in the totals, not counted as parents</small></div></div>`;
  }
  // bare (the "What moved" card): the count only — its sizes open in the table, not there.
  const tag = n > 1 ? (bare ? `<span class="px-sizes px-sizes-q">${n} sizes</span>`
    : `<button class="px-sizes" data-pxopen="${pxEsc(e.key)}" aria-expanded="${PX.open.has(e.key)}">${n} sizes <i>▸</i></button>`) : '';
  return `<div class="px-prod">${pxPic([e.key].concat(e.asins), e.title)}<div><b><span class="px-name" data-pxwhy="${pxEsc(e.key)}" title="Why did it move?">${pxEsc(e.title || e.key)}</span>${tag}${e.solo || e.disc ? oldTag : ''}</b><small>${pxEsc(e.key)}</small></div></div>`;
}
// The range report's figure cells for one totals object, visible columns only; tot = the All row.
// e (optional): the row's product — for its 8-week trend and its "Why?" button.
function pxRangeCells(o, tot, e) {
  const cnt = v => (v == null ? '<span class="px-dim">—</span>' : pxN(v));
  const pct = v => (v == null ? '<span class="px-dim">—</span>' : pxPct(v));
  // A row that fell 30%+ carries its "Why?" — the breakdown of the fall, one click away (12 Nov).
  const why = !tot && e && !e.old && !e.disc && o.vp != null && o.vp <= -30
    ? ` <button class="px-why" data-pxwhy="${pxEsc(e.key)}" title="Why did it fall? Traffic, conversion, price, ad spend, stock or Buy Box">Why?</button>` : '';
  const c = {
    tr: `<td class="px-trc">${pxShown('tr') && e ? pxTrend8(e.asins) : ''}</td>`,
    o: `<td>${cnt(o.o)}</td>`,
    se: `<td>${cnt(o.se)}</td>`,
    usp: `<td>${pct(o.usp)}</td>`,
    roas: `<td class="${tot || o.roas == null ? '' : o.roas >= 4 ? 'px-pos' : o.roas < 2 ? 'px-neg' : ''}">${o.roas == null ? '<span class="px-dim">—</span>' : pxX(o.roas)}</td>`,
    cpc: `<td class="px-dim">${pxC2(o.cpc)}</td>`,
    cl: `<td class="px-dim">${cnt(o.cl)}</td>`,
    cr: `<td>${pct(o.cr)}</td>`,
    adO: `<td class="px-dim">${cnt(o.adO)}</td>`,
    adU: `<td>${cnt(o.adU)}</td>`,
    ou: `<td>${cnt(o.ou)}</td>`,
    u: `<td>${o.has ? Math.round(o.u).toLocaleString('en-US') : '—'}</td>`,
    rev: `<td>${o.has ? (tot ? pxMoney(o.rev) : '<b>' + pxMoney(o.rev) + '</b>') : '<span class="px-dim">—</span>'}</td>`,
    spend: `<td>${pxMoney(o.spend)}</td>`,
    adSales: `<td class="px-dim">${pxMoney(o.adSales)}</td>`,
    os: `<td>${pxMoney(o.os)}</td>`,
    op: `<td>${pxObar(o.op)}</td>`,
    acos: `<td>${tot ? pxPct(o.acos) : pxAcos(o.acos)}</td>`,
    tacos: `<td class="${tot ? '' : pxTacC(o.tacos)}">${pxPct(o.tacos)}</td>`,
    vp: `<td class="${tot ? '' : o.vp == null ? 'px-dim' : o.vp < 0 ? 'px-neg' : 'px-pos'}">${o.vp == null ? '—' : (o.vp < 0 ? '▼ ' : '▲ ') + Math.abs(o.vp).toFixed(1) + '%'}${why}</td>`,
  };
  return PX_RCOLS.filter(x => pxShown(x[0])).map(x => c[x[0]]).join('');
}
/** The children of an opened parent: biggest sellers in the shown dates first, cut to the chosen count. */
// { kids, total } for an opened parent.
function pxKids(e, ctx) {
  const all = e.asins.map(a => ({ key: a, asins: [a], title: wTitle(a) }))
    .filter(k => k.key !== e.key || e.asins.length > 1)
    .map(k => Object.assign(k, { st: pxStats(k.asins, ctx.span, true) }))
    .sort((a, b) => (b.st.rev || 0) - (a.st.rev || 0));
  const n = pxKidLimit(e.key);
  return { kids: n ? all.slice(0, n) : all, total: all.length };
}
/** The "showing 10 of 246 sizes · 10 20 50 100 All" line under an opened parent. */
// That line as a table row, or '' when every size fits.
function pxKidBar(e, total) {
  if (total <= PX_KID_STEPS[0]) return '';
  const n = pxKidLimit(e.key), shown = n ? Math.min(n, total) : total;
  return `<tr class="px-kidbar"><td colspan="99"><div class="px-kidbar-in"><span>Showing <b>${shown}</b> of ${total} sizes, best sellers first</span>`
    + '<div class="px-seg px-segsm" role="group" aria-label="How many sizes">'
    + PX_KID_STEPS.filter(s => !s || s < total)
      .map(s => `<button data-pxkn="${pxEsc(e.key)}|${s}" aria-pressed="${n === s}">${s || 'All'}</button>`).join('')
    + '</div></div></td></tr>';
}
// The Range report table: group header, column header, the All row, then the rows (opened parents with their sizes).
// "Why did it move?" under its product's row: one cell across the table, its content held to the visible width.
function pxWhyRow(e, ctx) {
  if (!PX.why || PX.why.at !== 'table' || PX.why.anchor !== e.key) return '';
  return `<tr class="pw-row"><td colspan="99" class="l"><div class="pw-stick">${pwDrawer(ctx)}</div></td></tr>`;
}
// The All row's words: the parents (or child ASINs) of today's catalogue, then the old ASINs not in Listing Health.
function pxAllLabel(ctx) {
  const real = ctx.found.filter(e => !e.old && !e.solo && !e.disc).length, solo = ctx.found.filter(e => e.solo).length;
  const old = ctx.found.filter(e => e.old).reduce((n, e) => n + e.asins.length, 0);
  const disc = ctx.found.filter(e => e.disc).length;
  const extra = [solo ? `${solo.toLocaleString('en-US')} stand-alone` : '', disc ? `${disc.toLocaleString('en-US')} discontinued` : '',
    old ? `${old.toLocaleString('en-US')} inactive or deleted` : '']
    .filter(Boolean).join(' · ');
  return `All ${real.toLocaleString('en-US')} ${PX.level === 'child' ? 'child ASINs' : 'parents'}`
    + (extra ? ` <small class="px-allold">+ ${extra}</small>` : '');
}
function pxRangeTable(rows, ctx, tot) {
  const sku = PX.level === 'child', vis = PX_RCOLS.filter(x => pxShown(x[0]));
  // --- build table: header ---
  // Group labels over the visible columns only; PX_RCOLS is already in group order, so spans line up.
  const grp = '<tr class="px-grp"><th class="l stick"></th>' + (sku ? '<th></th>' : '')
    + PX_GROUPS.map(([g, ks]) => {
      const n = ks.filter(pxShown).length;
      return n ? `<th colspan="${n}" class="px-g-${(g || 'none').toLowerCase()}">${g ? `<span>${g}</span>` : ''}</th>` : '';
    }).join('') + '</tr>';
  // Sessions say WHY they are empty, under their own header, instead of a column of dashes nobody can explain.
  const whole = pxWholeWeeks(ctx.span);
  const head = grp + '<tr>' + pxTh('Product', 't', 'l stick', '', '', pxI('table', 'The table', pxTableInfo(ctx))) + (sku ? pxTh('SKU', 'sku', 'l') : '')
    + vis.map(x => (x[0] === 'tr' ? `<th class="px-th-tr" title="${pxEsc(PX_TIPS.tr)}">8-week trend</th>`
      : pxTh(x[1], x[0], '', !whole && (x[0] === 'se' || x[0] === 'usp') ? 'whole weeks only' : '', PX_TIPS[x[0]]))).join('')
    + '</tr>';
  // --- build table: the All row and the body ---
  const totRow = `<tr class="px-total"><td class="l stick">${pxAllLabel(ctx)}</td>${sku ? '<td></td>' : ''}${pxRangeCells(tot, true, { asins: ctx.found.flatMap(x => x.asins) })}</tr>`;
  const body = rows.map(e => {
    const fall = !e.disc && !e.old && e.st.vp != null && e.st.vp <= -30;
    const cls = [fall ? 'px-fall' : '', e.disc ? 'px-discrow' : ''].filter(Boolean).join(' ');
    let h = `<tr${cls ? ` class="${cls}"` : ''}><td class="l stick">${pxProd(e)}</td>${sku ? `<td class="l px-sku">${pxEsc(e.sku)}</td>` : ''}${pxRangeCells(e.st, false, e)}</tr>`;
    if (!sku && PX.open.has(e.key) && e.asins.length > 1) {
      const { kids, total } = pxKids(e, ctx);
      h += kids.map(k => `<tr class="px-child"><td class="l stick">${pxProd(k, true)}</td>${pxRangeCells(k.st, false, k)}</tr>`).join('')
        + pxKidBar(e, total);
    }
    return h + pxWhyRow(e, ctx);
  }).join('');
  return `<table class="px-tbl"><thead>${head}</thead><tbody>${totRow}${body || `<tr><td class="l px-dim" colspan="99">Nothing matches.</td></tr>`}</tbody></table>`;
}
// The Columns by date table: one column per date range showing the chosen metric as a figure and a bar, plus the change.
function pxColTable(rows, ctx) {
  const sku = PX.level === 'child', cs = ctx.cols, m = PX.metric, today = pxToday();
  const hue = m === 'tacos' || m === 'acos' ? 'var(--bad)'
    : m === 'spend' ? 'var(--px-ads)'
    : m === 'op' || m === 'ou' ? 'var(--px-org)'
    : 'var(--brand)';
  // --- build table: header ---
  const head = '<tr>' + pxTh('Product', 't', 'l stick', '', '', pxI('table', 'The table', pxTableInfo(ctx))) + (sku ? pxTh('SKU', 'sku', 'l') : '')
    + cs.map((c, k) => {
      const live = c.hi >= today, d = pxLen(c.lo, c.hi);
      return pxTh(pxColLabel(c.lo, c.hi), 'c:' + k, live ? 'px-part' : '',
        c.src === 'none' ? 'no data' : live ? 'so far' : d === 1 ? '1 day' : d + ' days');
    }).join('')
    + (cs.length > 1 ? pxTh('vs column before', 'chg', '', 'last full column') : '') + '</tr>';
  // --- one row: the figures, their bars, and the change ---
  const row = (e, cls, kid) => {
    // The total row's orders are the account's UNIQUE orders, never its products' orders added up.
    const vals = cs.map(c => (e.total && m === 'o' ? pxAcctOrders(c) : pxStats(e.asins, c)[m]));
    const mx = Math.max(0, ...vals.filter(v => v != null));
    const cells = vals.map((v, k) => {
      const w = v == null ? 0
        : pxIsPct(m) ? (m === 'tacos' ? Math.min(v, 50) * 2 : Math.min(v, 100))
        : mx ? v / mx * 100 : 0;
      return `<td class="px-wk${cs[k].hi >= today ? ' px-part' : ''}${PX.anim ? ' px-cin" style="animation-delay:' + k * 26 + 'ms"' : '"'}>`
        + `<div class="px-cb"><span>${pxFmtM(m, v)}</span><i style="background:${hue};width:${(Math.max(w, 3) * 0.56).toFixed(1)}px"></i></div></td>`;
    }).join('');
    let chg = '';
    if (cs.length > 1) {
      const c = pxChange(e, ctx);
      chg = '<td>' + (c ? `<span class="px-chg ${Math.abs(c.v) < 0.05 ? 'px-dim' : (pxLowGood(m) ? c.v < 0 : c.v > 0) ? 'px-pos' : 'px-neg'}">${c.v > 0 ? '▲ ' : '▼ '}${Math.abs(c.v).toFixed(1)}${c.pt ? ' pt' : '%'}</span>` : '<span class="px-dim">—</span>') + '</td>';
    }
    const first = cls === 'px-total'
      ? pxAllLabel(ctx)
      : pxProd(e, kid);
    return `<tr${cls ? ` class="${cls}"` : ''}><td class="l stick">${first}</td>${sku ? `<td class="l px-sku">${cls === 'px-total' ? '' : pxEsc(e.sku || '')}</td>` : ''}${cells}${chg}</tr>`;
  };
  // --- the All row and the body ---
  const allAsins = ctx.found.flatMap(e => e.asins);
  const body = rows.map(e => {
    let h = row(e);
    if (!sku && PX.open.has(e.key) && e.asins.length > 1) {
      const { kids, total } = pxKids(e, ctx);
      h += kids.map(k => row(k, 'px-child', true)).join('') + pxKidBar(e, total);
    }
    return h + pxWhyRow(e, ctx);
  }).join('');
  return `<table class="px-tbl"><thead>${head}</thead><tbody>${row({ asins: allAsins, total: true }, 'px-total')}${body || `<tr><td class="l px-dim" colspan="99">Nothing matches.</td></tr>`}</tbody></table>`;
}

// The Pick dates pop-up (From / To, Apply), drawn from PX.draft.
// The date chips that live inside Custom rather than on the date row (13 Nov: the row is the original eight).
const PX_WEEKPICKS = ['lwk', 'w4'];
function pxDatePop() {
  // No lower limit: older dates work as whole Sunday–Saturday weeks, and the page says so when they are not.
  const d = PX.draft, max = pxToday(), t = pxToday();
  // Quick picks: whole Sunday–Saturday weeks — the ranges where Sessions and Unit session % fill in.
  const picks = PX_WEEKPICKS.map(k => {
    const [lo, hi] = PX_DATES[k][1](t);
    return `<button class="px-preset px-qp" data-pxdk="${k}" aria-pressed="${PX.dkey === k}"><b>${PX_DATES[k][0]}</b><small>${pxEsc(pxFmtRange(lo, hi))}</small><em>with sessions</em></button>`;
  }).join('');
  return '<div class="px-pop px-dpop" style="left:16px" role="dialog" aria-label="Pick dates">'
    + `<div class="px-pop-h"><b>Pick dates</b><span>${WDAY.from ? 'Any day from ' + pxEsc(pxDM(WDAY.from)) + ', whole weeks before' : ''}</span></div>`
    + '<div class="px-dsec">Whole weeks</div>'
    + `<div class="px-presets px-qps">${picks}</div>`
    + '<div class="px-dsec">Your own dates</div>'
    + `<div class="px-drow"><label><span>From</span><input class="px-inp" type="date" id="pxFrom" max="${max}" value="${d.lo}"></label>`
    + `<span class="px-darr" aria-hidden="true">→</span><label><span>To</span><input class="px-inp" type="date" id="pxTo" max="${max}" value="${d.hi}"></label></div>`
    + `<div class="px-dcmp" aria-live="polite">${pxDateLiveHtml(d.lo, d.hi)}</div>`
    + '<div class="px-pop-f"><button class="px-btn" data-px="cancel">Cancel</button><button class="px-btn px-dark" data-px="applydate">Apply</button></div></div>';
}
// What the dates being typed will show and what they will be compared with — redrawn as From / To change.
function pxDateLiveHtml(a, b) {
  if (!a || !b) return '<span class="px-dim">Pick a From and a To date.</span>';
  const lo = a <= b ? a : b, hi = a <= b ? b : a, n = pxLen(lo, hi), t = pxToday();
  const plo = sdShift(lo, -n), phi = sdShift(lo, -1);
  const whole = wKeyOfDate(lo) === lo && wKeyOfDate(sdShift(hi, 1)) === sdShift(hi, 1) && hi < t;
  const old = WDAY.from && lo < WDAY.from;
  const row = (k, v) => `<span><small>${k}</small><b>${v}</b></span>`;
  return row('You will see', `${pxEsc(pxFmtRange(lo, hi))} · ${n} day${n === 1 ? '' : 's'}`)
    + row('Compared with', hi >= t ? 'nothing until today is over' : `${pxEsc(pxFmtRange(plo, phi))} · the same ${n} day${n === 1 ? '' : 's'} just before`)
    + `<span class="px-dnote">${whole ? '✓ Whole Sunday–Saturday weeks: Sessions and Unit session % fill in.' : 'Sessions and Unit session % stay empty — they exist only for whole Sunday–Saturday weeks.'}`
    + (old ? ` Before ${pxEsc(pxDM(WDAY.from))} only whole weeks can be shown.` : '') + '</span>';
}
function pxDateLive() {
  const el = document.querySelector('#panePpcn .px-dcmp');
  if (el) el.innerHTML = pxDateLiveHtml(PX.draft.lo, PX.draft.hi);
}
// The Set up columns pop-up (presets, number of columns, days in each, last column's end, Apply), drawn from PX.draft.
function pxColsPop() {
  const d = PX.draft;
  return '<div class="px-pop" style="left:16px" role="dialog" aria-label="Set up columns">'
    + '<div class="px-pop-h"><b>Set up columns</b><span>Each column adds up its days</span></div>'
    + '<div class="px-presets">'
    + PX_COLP.map(p => `<button class="px-preset" data-pxcp="${p[0]}" aria-pressed="${d.preset === p[0]}">${p[1]}</button>`).join('') + '</div>'
    + `<div class="px-frow"><span>Number of columns</span><div class="px-step"><button data-pxdn="-1" aria-label="Fewer columns">−</button><b>${d.n}</b><button data-pxdn="1" aria-label="More columns">+</button></div></div>`
    + '<div class="px-frow"><span>Days in each column</span><div class="px-tb"><div class="px-seg px-segsm">'
    + [1, 7, 14, 30].map(n => `<button data-pxdl="${n}" aria-pressed="${!(d.preset === 'month' || d.preset === 'lmonth') && d.len === n}">${n}</button>`).join('')
    + `</div><input class="px-inp px-num" type="number" id="pxLenIn" min="1" max="90" value="${d.len}" aria-label="Days in each column"></div></div>`
    + `<div class="px-frow"><span>Last column ends on</span><input class="px-inp" type="date" id="pxEndIn" max="${pxToday()}" value="${d.end || pxDefEnd(d)}"></div>`
    + '<div class="px-note">Whole Sunday–Saturday weeks (13 / 26 weeks) also fill Sessions and Unit session %.</div>'
    + '<div class="px-pop-f"><button class="px-btn" data-px="cancel">Cancel</button><button class="px-btn px-dark" data-px="applycols">Apply</button></div></div>';
}
// The Show columns pop-up: one checkbox per range-report column, Show all, Done.
function pxShowPop() {
  return '<div class="px-pop" style="right:16px" role="dialog" aria-label="Show columns">'
    + '<div class="px-pop-h"><b>Show columns</b><span>Product is always shown</span></div>'
    + '<div class="px-colgrid">'
    + PX_RCOLS.map(x => `<label class="px-chk"><input type="checkbox" data-pxhide="${x[0]}"${pxShown(x[0]) ? ' checked' : ''}> ${x[1]}</label>`).join('') + '</div>'
    + '<div class="px-pop-f"><button class="px-btn" data-px="showall">Show all</button>'
    + '<button class="px-btn px-dark" data-px="cancel">Done</button></div></div>';
}

/* The five period cards (Today · Yesterday · 7 · 14 · 30 days), as in the design. They follow the brand
 * and search like the strip below. P&L, refunds, ROI and margin wait for the Finances job, so they are
 * left off rather than shown as made-up numbers. */
const PX_PCARDS = ['today', 'yest', 'd7', 'd14', 'd30'];
// Day → sales of the ASINs in view over the last 31 days, from the per-day store; built once per render.
let PX_DAYS = null;
function pxDayRev(asins) {
  if (PX_DAYS) return PX_DAYS;
  const t = pxToday(), ks = wDaysBetween(sdShift(t, -30), t), m = {};
  ks.forEach(d => { m[d] = WDAY.from && d >= WDAY.from ? 0 : null; });
  asins.forEach(a => {
    const days = (WDAY.rows[a] || {}).days;
    if (days) ks.forEach(d => { if (days[d] && m[d] != null) m[d] += days[d].rev || 0; });
  });
  PX_DAYS = m;
  return m;
}
// Total sales of a list of ASINs over a plan, read straight off the store the plan names; null when there are none.
function pxQuickRev(asins, p) {
  if (!p || p.src === 'none') return null;
  let rev = 0, has = false;
  asins.forEach(a => {
    const st = p.src === 'day' ? (WDAY.rows[a] || {}).days : (WEEKLY.rows[a] || {}).weeks;
    if (st) p.keys.forEach(k => {
      if (st[k]) {
        has = true;
        rev += st[k].rev || 0;
      }
    });
  });
  return has && rev ? rev : null;
}
// The five period cards for the ASINs in view; the card matching the date chip is pressed. As in PPC & Organic ·
// New: the period and its dates, the sales, then three lines — nothing else, each card in its own colour (px-c0…4).
function pxCards(asins) {
  const t = pxToday();
  return '<div class="px-pcards" role="group" aria-label="Periods">' + PX_PCARDS.map((k, i) => {
    const [lo, hi] = PX_DATES[k][1](t), p = pxPlan(lo, hi), o = pxStats(asins, p);
    o.o = pxAcctOrders(p);
    const on = PX.mode === 'range' && PX.dkey === k;
    const line = (l, v) => `<span class="px-pc-l"><small>${l}</small><b>${v}</b></span>`;
    // Today: Amazon's day runs on Pacific time and its orders land through the day, its ads with tonight's run —
    // so an empty Today says that, rather than five dashes that read like "nothing sold".
    const live = hi >= t;
    // No ad figure at all in the period: today, or days the ad report has not reached yet (it runs a day behind).
    const adsLater = o.spend == null && o.adO == null && (live || (o.adTo && lo > o.adTo));
    const later = live ? 'with tonight’s run' : `ad report reaches ${pxEsc(pxDM(o.adTo))} — ${pxEsc(pxDM(lo))} comes with tonight’s run`;
    const big = o.has ? pxMoney(o.rev) : '—';
    return `<button class="px-pcard px-c${i}" data-pxcard="${k}" aria-pressed="${on}">`
      + `<span class="px-pc-h"><b>${PX_DATES[k][0]}</b><small>${pxFmtRange(lo, hi)}</small></span>`
      + `<span class="px-pc-big">${big}</span>`
      + (live && !o.has
        ? '<span class="px-pc-wait">No orders in yet — Amazon’s day runs on Pacific time, so it fills in through the day.</span>'
        : line('Orders / Units', pxN(o.o) + ' / ' + (o.has ? pxN(o.u) : '—'))
          + (adsLater
            ? `<span class="px-pc-l px-pc-soon"><small>PPC Orders, ACoS · TACoS</small><b>${later}</b></span>`
            : line('PPC Orders / PPC Units', pxN(o.adO) + ' / ' + pxN(o.adU))
              + line('ACoS · TACoS', pxPct(o.acos) + ' · ' + pxPct(o.tacos))
              + (o.adTo ? `<span class="px-pc-adto" title="The ad report runs a day behind. PPC figures stop at ${pxEsc(pxDM(o.adTo))}, and TACoS sets them against sales up to ${pxEsc(pxDM(o.adTo))} only — never against days with no ad figures yet.">ads to ${pxEsc(pxDM(o.adTo))}</span>` : '')))
      + '</button>';
  }).join('') + '</div>';
}

/* ---------- the brand cards: how many parents and child ASINs each brand has ----------
 * One card per brand (Both first when there are two). "On this page" is counted exactly the way the table builds
 * its rows (pxEntities: every ASIN of the brand in the stored figures, grouped by its Listing Health parent), so a
 * card's numbers are the table's "All N parents" / "All N child ASINs" for that brand with nothing searched. "Sold"
 * is how many of those had a unit in the dates chosen; "Listing Health" is what that brand's catalogue holds — the
 * gap between the two is products with no stored figures (never advertised, never sold since the figures start).
 * Both counts a parent shared by two brands once, so Ridhi + CPC can be one more than Both. */
// Units of one ASIN over a plan, straight off the store the plan names.
function pxQuickU(a, p) {
  if (!p || p.src === 'none') return 0;
  const st = p.src === 'day' ? (WDAY.rows[a] || {}).days : (WEEKLY.rows[a] || {}).weeks;
  if (!st) return 0;
  let u = 0;
  p.keys.forEach(k => { if (st[k]) u += st[k].u || 0; });
  return u;
}
// { brand: { par, kid, parSold, kidSold, lhPar, lhKid } } for every brand allowed, plus ALL.
function pxBrandCounts(span) {
  const allowed = adBrands(), K = pxClassify();
  const c = {}, mk = () => ({ par: new Set(), kid: 0, parSold: new Set(), kidSold: 0, lhPar: 0, lhKid: 0, lhAct: 0,
    solo: 0, soloSold: 0, old: 0, oldSold: 0, disc: 0 });
  ['ALL'].concat(allowed).forEach(b => { c[b] = mk(); });
  Object.keys(K.kinds).forEach(a => {
    const b = K.brand[a], k = K.kinds[a], sold = pxQuickU(a, span) > 0;
    [c[b], c.ALL].forEach(x => {
      if (k === 'old') {
        x.old++;
        if (sold) x.oldSold++;
      } else if (k === 'disc') {
        x.disc++;
      } else if (k === 'solo') {
        x.solo++;
        if (sold) x.soloSold++;
      } else {
        x.par.add(b + '|' + K.parOf[a]);
        x.kid++;
        if (sold) {
          x.parSold.add(b + '|' + K.parOf[a]);
          x.kidSold++;
        }
      }
    });
  });
  // Listing Health: a parent is every distinct parent ASIN (a listing with none is its own); a child is every ASIN
  // that is not the parent of others — the parent's own row is not a size anybody can buy.
  const lhAll = { par: new Set(), kid: new Set(), act: new Set() };
  allowed.forEach(b => {
    const rows = HEALTH[b]?.rows || [], kids = new Set(), pars = new Set(), hasKids = new Set(), act = new Set();
    rows.forEach(r => {
      const a = String(r.asin || '').trim().toUpperCase(), p = String(r.parent || '').trim().toUpperCase();
      if (a && p && p !== a && !pxNoParent(p)) hasKids.add(p);
    });
    rows.forEach(r => {
      const a = String(r.asin || '').trim().toUpperCase(), p = String(r.parent || '').trim().toUpperCase();
      if (!a) return;
      if (!pxNoParent(p)) pars.add(p || a);
      if (!hasKids.has(a)) {
        kids.add(a);
        if (/^active$/i.test(String(r.status || ''))) act.add(a);
      }
    });
    // Families, as on the page: parents with sizes under them (a stand-alone listing is not a parent).
    c[b].lhPar = hasKids.size;
    c[b].lhKid = kids.size;
    c[b].lhAct = act.size;
    hasKids.forEach(x => lhAll.par.add(b + '|' + x));
    kids.forEach(x => lhAll.kid.add(x));
    act.forEach(x => lhAll.act.add(x));
  });
  c.ALL.lhPar = lhAll.par.size;
  c.ALL.lhKid = lhAll.kid.size;
  c.ALL.lhAct = lhAll.act.size;
  Object.values(c).forEach(x => {
    x.par = x.par.size;
    x.parSold = x.parSold.size;
  });
  return c;
}
// The row of brand cards; clicking one picks that brand. The dates' label says what "sold" covers.
function pxBrandCards(span, dates) {
  const allowed = adBrands(), c = pxBrandCounts(span);
  const keys = (allowed.length > 1 ? ['ALL'] : []).concat(allowed);
  const pc = (n, d) => (d ? Math.round(n / d * 100) : 0);
  return '<div class="px-bcards" role="group" aria-label="Brands">' + keys.map((b, i) => {
    const x = c[b], name = b === 'ALL' ? 'Both brands' : BRAND_NAME[b] || b;
    const on = PX.brand === b || (allowed.length === 1);
    const meter = (n, d, l) => `<span class="px-bc-m" title="${n.toLocaleString('en-US')} of ${d.toLocaleString('en-US')} ${l} sold in ${pxEsc(dates)}"><i style="width:${pc(n, d)}%"></i></span>`;
    return `<button class="px-bcard px-b${b === 'ALL' ? 'all' : i}" data-pxbrand="${b}" aria-pressed="${on}">`
      + `<span class="px-bc-h"><b>${pxEsc(name)}</b><small>${on ? 'showing' : 'click to show'}</small></span>`
      + '<span class="px-bc-body"><span class="px-bc-nums">'
      + `<span><b>${x.par.toLocaleString('en-US')}</b><small>parents</small></span>`
      + `<span><b>${x.kid.toLocaleString('en-US')}</b><small>child ASINs</small></span></span><span class="px-bc-side">`
      + `<span class="px-bc-l"><small>Sold · ${pxEsc(dates)}</small><b>${x.parSold.toLocaleString('en-US')} parents · ${x.kidSold.toLocaleString('en-US')} children</b></span>`
      + `<span class="px-bc-ms">${meter(x.parSold, x.par, 'parents')}${meter(x.kidSold, x.kid, 'child ASINs')}</span>`
      + `<span class="px-bc-l px-bc-lh" title="Parents and sizes in this brand’s Listing Health catalogue (active = Amazon lists it as Active). Products there but not here have no stored sales or ad figures.">`
        + `<small>In Listing Health</small><b>${x.lhPar.toLocaleString('en-US')} parents · ${x.lhKid.toLocaleString('en-US')} children (${x.lhAct.toLocaleString('en-US')} active)</b></span>`
      + (x.solo ? `<span class="px-bc-l" title="ASINs Amazon lists with no parent (no sizes) that are in Listing Health or sold / were advertised in the last 30 days. Each has its own row; they are not counted as parents.">`
        + `<small>Stand-alone listings</small><b>${x.solo.toLocaleString('en-US')} · ${x.soloSold.toLocaleString('en-US')} sold</b></span>` : '')
      + (x.disc ? `<span class="px-bc-l px-bc-old" title="Products the team has discontinued (PX_DISC in ads/ppc-new.js): shown last in the table, never counted as parents; their sales stay in the totals."><small>Discontinued</small><b>${x.disc.toLocaleString('en-US')} ASINs</b></span>` : '')
      + (x.old ? `<span class="px-bc-l px-bc-old" title="ASINs with stored figures that are in no family: stand-alone listings with no sales or ads in 30 days and not in Listing Health, or ASINs Amazon no longer knows. Their sales are in every total; they are not counted as parents or children.">`
        + `<small>Inactive or deleted listings</small><b>${x.old.toLocaleString('en-US')} ASINs · ${x.oldSold.toLocaleString('en-US')} sold</b></span>` : '')
      + '</span></span></button>';
  }).join('') + '</div>';
}

/* ---------- the trend chart: the Ad Console's chart, for the products in view ----------
 * Same look as the Ad Console (placement.js tChart) and the same classes, so the two read as one family: ad spend
 * as a bar in the accent, TACoS as the orange line on its own % scale. What this page adds is the split: each
 * sales bar is organic sales (green, bottom) under ad sales (amber, top) — the one question this page exists
 * for. A bar whose ad report is not in yet (today) stays one plain grey bar rather than a guessed split. */
let PX_CH = { key: '', s: null, g: '' };     // the series drawn last, kept while nothing it depends on changes
// The bars for this view: { g: 'day' | 'week' | 'cols' | 'none', b: [{ lo, hi, plan, on }] } — on = inside
// the dates chosen; the others are context, drawn faded.
function pxChartBuckets(ctx) {
  if (PX.mode === 'cols') return { g: 'cols', b: ctx.cols.map(c => ({ lo: c.lo, hi: c.hi, plan: c, on: true })) };
  const sp = ctx.span, t = pxToday();
  if (sp.src === 'none') return { g: 'none', b: [] };
  const L = pxLen(sp.lo, sp.hi);
  // Days need the per-day store and stay readable up to about two months of bars; weeks otherwise.
  const dayOk = sp.src === 'day' && L <= 62;
  const g = PX.cgran === 'week' || !dayOk ? 'week' : PX.cgran === 'day' ? 'day' : (L <= 45 ? 'day' : 'week');
  const out = [];
  if (g === 'day') {
    // A short range gets the fortnight before it as context, so "Yesterday" is one bar among fourteen.
    let lo = L < 14 ? sdShift(sp.hi, -13) : sp.lo;
    if (WDAY.from && lo < WDAY.from) lo = WDAY.from;
    for (let d = lo; d <= sp.hi; d = sdShift(d, 1)) out.push({ lo: d, hi: d, plan: pxPlan(d, d), on: d >= sp.lo });
  } else {
    // Whole Sunday–Saturday weeks (the running one up to today), at least eight, never past the 26 stored.
    const last = wKeyOfDate(sp.hi), n = Math.min(26, Math.max(8, Math.round(pxLen(wKeyOfDate(sp.lo), sp.hi) / 7)));
    for (let k = n - 1; k >= 0; k--) {
      const lo = sdShift(last, -7 * k), hi0 = sdShift(lo, 6), hi = hi0 < t ? hi0 : t;
      out.push({ lo, hi, plan: pxPlan(lo, hi), on: hi >= sp.lo && lo <= sp.hi });
    }
  }
  return { g, b: out };
}
// The chart's series for the ASINs in view: one entry per bar, with sales, ad sales, organic, spend and TACoS.
function pxSeries(asins, ctx) {
  const { g, b } = pxChartBuckets(ctx);
  const key = [g, PX.mode, PX.brand, PX.level, PX.q, PX.dkey, PX.lo, PX.hi, JSON.stringify(PX.pc), asins.length,
    WDAY.at, WEEKLY.at, WEEKLY.adAt, PXN.run, pxAdEndView(), b.map(x => x.lo + x.hi + (x.on ? 1 : 0)).join()].join('|');
  if (PX_CH.key === key) return PX_CH;
  const today = pxToday();
  /* ONE PASS over the stores, not pxStats per bar: 30 bars × 3,700 sizes through pxSumAsin tripled the time of a
   * redraw. The chart needs only sales, spend and ad sales, which simply add up — the orders / ad-units / sessions
   * gap rules pxSumAsin applies are about figures the chart never draws. Same store per bar as pxPlan picks. */
  const acc = b.map(() => ({ u: 0, rev: 0, spend: null, adSales: null, cl: null, adO: null, has: false, revA: 0, uA: 0 }));
  // cov: this day / week is inside what the ad report covers for the ASIN's brand (organic and TACoS use only those).
  const add = (o, c, cov) => {
    o.has = true;
    o.u += c.u || 0;
    o.rev += c.rev || 0;
    if (cov) {
      o.revA += c.rev || 0;
      o.uA += c.u || 0;
    }
    if (c.spend != null) o.spend = (o.spend || 0) + c.spend;
    if (c.adSales != null) o.adSales = (o.adSales || 0) + c.adSales;
  };
  const look = pxLookup(), endV = pxAdEndView();
  asins.forEach(a => {
    const days = (WDAY.rows[a] || {}).days, weeks = (WEEKLY.rows[a] || {}).weeks;
    const end = pxAdEnd((WEEKLY.rows[a] || {}).brand || (look[a] || {}).brand);
    b.forEach((x, i) => {
      const p = x.plan;
      if (p.src === 'day' && days) p.keys.forEach(k => { if (days[k]) add(acc[i], days[k], !end || k <= end); });
      else if (p.src === 'week' && weeks) p.keys.forEach(k => { if (weeks[k]) add(acc[i], weeks[k], !end || sdShift(k, 6) <= end); });
    });
  });
  const s = b.map((x, i) => {
    const o = pxDerive(acc[i]);
    return { lo: x.lo, hi: x.hi, on: x.on, part: x.hi >= today, adTo: endV && x.hi > endV && x.lo <= endV ? endV : '', none: x.plan.src === 'none',
      rev: o.has ? o.rev : null, adSales: o.has ? o.adSales : null, os: o.has ? o.os : null, op: o.has ? o.op : null,
      spend: o.has ? o.spend : null, tacos: o.has ? o.tacos : null, acos: o.has ? o.acos : null,
      roas: o.has ? o.roas : null, u: o.has ? o.u : null };
  });
  PX_CH = { key, s, g };
  return PX_CH;
}
// The label of one bar: "Nov 3" for a day, "Nov 1–7" for a week or a column.
const pxBarLabel = (x, g) => (g === 'day' ? pxMD(x.lo) : pxColLabel(x.lo, x.hi));
// The chart's SVG, sized to the pane: stacked organic / ad sales, ad spend beside it, TACoS line, two axes.
function pxChartSvg(ch, width) {
  const s = ch.s, g = ch.g, n = s.length;
  if (!n) return '';
  const W = Math.max(560, Math.round(width)), H = 236, padL = 64, padR = 50, padT = 16, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  // A round step on the money scale (15k, 20k, 100k …), so the four grid lines land on readable figures.
  const raw = Math.max(1, ...s.map(x => Math.max(x.rev || 0, x.spend || 0))) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const maxM = 4 * mag * [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(f => f * mag >= raw);
  const maxP = Math.max(10, Math.ceil(Math.max(0, ...s.map(x => x.tacos || 0)) / 5) * 5);
  const sw = iw / n, bw = Math.min(30, Math.max(3, sw * 0.42)), sbw = Math.max(2, bw * 0.55);
  const cx = i => padL + (i + 0.5) * sw;
  const yM = v => padT + ih - (v / maxM) * ih, yP = v => padT + ih - (v / maxP) * ih;
  const money = v => (v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(v));
  let h = '';
  // --- grid and the two axes ---
  for (let i = 0; i <= 4; i++) {
    const y = padT + ih - (i / 4) * ih;
    h += `<line class="ad-ch-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>`
      + `<text class="ad-ch-axis" x="${padL - 10}" y="${y + 4}" text-anchor="end">${money(maxM * i / 4)}</text>`
      + `<text class="ad-ch-pct" x="${W - padR + 10}" y="${y + 4}">${(maxP * i / 4).toFixed(0)}%</text>`;
  }
  // --- the bars: organic under ad sales (or one grey bar when the split is not known), spend beside ---
  s.forEach((x, i) => {
    const op = x.on ? '' : ' px-ch-ctx', base = padT + ih;
    const left = cx(i) - (bw + sbw + 2) / 2;
    if (x.rev != null) {
      if (x.adSales != null) {
        const ad = Math.min(x.adSales, x.rev), org = Math.max(0, x.rev - ad);
        h += `<rect class="px-ch-org${op}" x="${left}" y="${yM(org)}" width="${bw}" height="${Math.max(0, base - yM(org))}" rx="2"/>`
          + `<rect class="px-ch-ad${op}" x="${left}" y="${yM(org + ad)}" width="${bw}" height="${Math.max(0, yM(org) - yM(org + ad))}" rx="2"/>`;
      } else {
        h += `<rect class="ad-ch-sales${op}${x.part ? ' px-ch-part' : ''}" x="${left}" y="${yM(x.rev)}" width="${bw}" height="${Math.max(0, base - yM(x.rev))}" rx="2"/>`;
      }
    }
    if (x.spend != null) {
      h += `<rect class="ad-ch-spend${op}" x="${left + bw + 2}" y="${yM(x.spend)}" width="${sbw}" height="${Math.max(0, base - yM(x.spend))}" rx="1.5"/>`;
    }
  });
  // --- TACoS: a line that breaks over a gap rather than diving to zero ---
  let path = '', on = false;
  s.forEach((x, i) => {
    if (x.tacos == null) {
      on = false;
      return;
    }
    path += (on ? ' L' : ' M') + cx(i).toFixed(1) + ' ' + yP(x.tacos).toFixed(1);
    on = true;
  });
  h += `<path class="ad-ch-tacos" d="${path}" fill="none" stroke-width="2"/>`;
  s.forEach((x, i) => {
    if (x.tacos != null) h += `<circle class="ad-ch-dot${x.on ? '' : ' px-ch-ctx'}" cx="${cx(i)}" cy="${yP(x.tacos)}" r="${n > 40 ? 2 : 3}"/>`;
  });
  // --- labels, thinned so they never overlap; the hover targets, one per bar ---
  const step = Math.max(1, Math.ceil(n / Math.floor(iw / (g === 'day' ? 52 : 84))));
  s.forEach((x, i) => {
    if ((n - 1 - i) % step === 0) {
      h += `<text class="ad-ch-label${x.on ? ' px-ch-lon' : ''}" x="${cx(i)}" y="${H - 9}" text-anchor="middle">${pxEsc(pxBarLabel(x, g))}</text>`;
    }
    h += `<rect class="px-ch-hit" data-pxpt="${i}" x="${padL + i * sw}" y="${padT}" width="${sw}" height="${ih}"/>`;
  });
  return `<svg class="px-ch-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Sales split into organic and ad sales, ad spend and TACoS">${h}</svg>`;
}
// The hover card for bar i of the chart drawn last.
function pxChartTip(i) {
  const x = PX_CH.s && PX_CH.s[i];
  if (!x) return '';
  const when = x.lo === x.hi ? new Date(x.lo + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) + ' ' + pxFmtRange(x.lo, x.hi) : pxFmtRange(x.lo, x.hi);
  const row = (k, l, v) => `<div class="px-tip-r"><span><i class="px-key ${k}"></i>${l}</span><b>${v}</b></div>`;
  if (x.none || x.rev == null) return `<b>${pxEsc(when)}</b><div class="px-tip-n">No figures stored for these dates.</div>`;
  return `<b>${pxEsc(when)}${x.part ? ' <em>so far</em>' : ''}</b>`
    + row('', 'Sales', pxMoney(x.rev))
    + (x.adSales != null
      ? row('px-key-org', 'Organic', pxMoney(x.os) + (x.op != null ? ' · ' + pxPct(x.op) : ''))
        + row('px-key-ad', 'Ad sales', pxMoney(x.adSales))
      : '<div class="px-tip-n">Ad report not in yet — the split arrives with tonight’s run.</div>')
    + (x.spend != null ? row('ad-key-spend', 'Ad spend', pxMoney(x.spend)) : '')
    + (x.tacos != null ? row('ad-key-tacos', 'TACoS · ACoS', pxPct(x.tacos) + ' · ' + pxPct(x.acos)) : '')
    + (x.roas != null ? row('', 'ROAS', pxX(x.roas)) : '')
    + (x.adTo ? `<div class="px-tip-n">Ads to ${pxEsc(pxDM(x.adTo))}: organic and TACoS use only the days with ads.</div>` : '');
}
// The chart card: heading, Day / Week, Hide, the chart and its key — or one slim line when it is hidden.
function pxChartCard(asins, ctx, label) {
  if (!PX.chart) {
    return '<div class="px-chart px-chart-off"><span class="px-chart-t">Trend</span>'
      + '<span class="px-note">Sales split into organic and ad sales, with ad spend and TACoS</span>'
      + '<span class="px-grow"></span><button class="px-btn" data-px="chart">Show chart</button></div>';
  }
  const ch = pxSeries(asins, ctx);
  const pane = $('panePpcn'), width = (pane && pane.clientWidth ? pane.clientWidth : 1200) - 34;
  const gseg = ch.g === 'cols' ? '<span class="px-lbl">One bar per column</span>'
    : '<div class="px-seg px-segsm" role="group" aria-label="Bars">'
      + [['day', 'Day'], ['week', 'Week']].map(([k, l]) => {
        const dis = k === 'day' && !(ctx.span.src === 'day' && pxLen(ctx.span.lo, ctx.span.hi) <= 62);
        return `<button data-pxgran="${k}" aria-pressed="${ch.g === k}"${dis ? ' disabled title="Day bars need dates inside the last 45 days"' : ''}>${l}</button>`;
      }).join('') + '</div>';
  const any = ch.s.some(x => x.rev != null);
  const sub = ch.g === 'week' ? 'Whole Sunday–Saturday weeks; the weeks you picked are solid, the rest faded'
    : ch.g === 'day' ? 'Day by day; the days you picked are solid, the fortnight before them faded'
    : 'One bar per column of the table';
  const c = pxCmp(ctx), bars = ch.s || [];
  const solid = bars.filter(x => x.on), faded = bars.filter(x => !x.on);
  const rng = xs => (xs.length ? pxFmtRange(xs[0].lo, xs[xs.length - 1].hi) : '');
  const note = `<p>Sales of ${pxWhoTxt(ctx)}, ${ch.g === 'day' ? 'one bar per day' : ch.g === 'week' ? 'one bar per Sunday–Saturday week' : 'one bar per column of the table'}.</p><ul>`
    + '<li><b>Green</b> (bottom) — organic sales, with no ad click.</li><li><b>Amber</b> (on top) — ad sales, credited to an ad click. Green + amber = all sales.</li>'
    + '<li><b>Grey</b> — sales whose ad split is not in yet (today: ads arrive with tonight\'s run).</li><li><b>Blue</b> — ad spend, beside each sales bar, same $ scale (left).</li>'
    + '<li><b>Orange line</b> — TACoS = ad spend ÷ all sales, on the % scale on the right.</li></ul>'
    + (ch.g === 'cols' ? '' : `<p><b>Solid</b> bars are the dates you picked${solid.length ? ' (' + pxEsc(rng(solid)) + ')' : ''}; <b>faded</b> bars${faded.length ? ' (' + pxEsc(rng(faded)) + ')' : ''} are the time before them, drawn for context only. The chart does not compare two periods — it shows the shape; the % comparisons (${c.p ? 'against ' + pxEsc(c.p) : 'none now'}) are in the totals and the table.</p>`)
    + '<p>Hover a bar for its exact figures. Day / Week changes the bars; Hide folds the chart away.</p>';
  return `<div class="px-chart"><div class="px-chart-h"><div><span class="px-chart-t">Trend${pxI('chart', 'The trend chart', note)}</span>`
    + `<span class="px-note">${pxEsc(label)} · ${sub}</span></div>`
    + `<div class="px-tb">${gseg}<button class="px-btn px-btn-q" data-px="chart" title="Hide the chart">Hide</button></div></div>`
    + (any ? `<div class="px-ch-wrap">${pxChartSvg(ch, width)}<div class="px-ch-tip" hidden></div></div>`
      : '<div class="px-empty">No figures for these dates.</div>')
    + '<div class="px-ch-key"><span><i class="px-key px-key-org"></i>Organic sales</span><span><i class="px-key px-key-ad"></i>Ad sales</span>'
    + '<span><i class="px-key ad-key-sales"></i>Sales, ad split not in yet</span><span><i class="px-key ad-key-spend"></i>Ad spend</span>'
    + '<span><i class="px-key ad-key-tacos"></i>TACoS (right scale)</span></div></div>';
}

/* ---------- what moved: the old tab's alerts, for the level, brand and search in view ----------
 * The same tests (W_ALERT) as the old tab's "Alerts — what moved against you last week", read from the same weekly
 * store — but for ONE finished week against the week before it, picked from the last four, rather than every pair of
 * weeks in the grid at once. The main cause comes from "Why did it move?" (pwMain), not the old wCause. */
// The last four FINISHED Sunday weeks, newest first.
const pxAlertWeeks = () => [1, 2, 3, 4].map(i => sdShift(wKeyOfDate(pxToday()), -7 * i));
// The stored figures of a list of ASINs for one week, added up; null when none of them has a cell that week.
function pxWeekCell(asins, wk) {
  const c = {};
  let any = false;
  asins.forEach(a => {
    const x = ((WEEKLY.rows[a] || {}).weeks || {})[wk];
    if (x) {
      wAddCell(c, x);
      any = true;
    }
  });
  return any ? c : null;
}
// The alert rows for one week: every product in view whose week fell enough to look at, worst first.
function pxAlertRows(ents, wk) {
  const pw = sdShift(wk, -7), drop = (now, was) => (was > 0 ? Math.round((now - was) / was * 100) : null);
  const out = [];
  ents.forEach(e => {
    const c = pxWeekCell(e.asins, wk), p = pxWeekCell(e.asins, pw);
    if (!c || !p) return;
    const flags = [];
    const dSales = drop(c.rev || 0, p.rev || 0);
    if ((p.rev || 0) > 0 && !(c.rev > 0)) flags.push('SALES ZERO');
    else if (dSales != null && dSales <= -W_ALERT.drop) flags.push('SALES ▼' + Math.abs(dSales) + '%');
    const dSpend = drop(c.spend || 0, p.spend || 0);
    if (dSpend != null && dSpend <= -W_ALERT.drop) flags.push('SPEND ▼' + Math.abs(dSpend) + '%');
    const cOrg = wOrganic(c), pOrg = wOrganic(p), dOrg = cOrg != null && pOrg != null ? drop(cOrg, pOrg) : null;
    if (dOrg != null && dOrg <= -W_ALERT.organic) flags.push('ORGANIC ▼' + Math.abs(dOrg) + '%');
    const dSess = c.sessions != null && p.sessions != null ? drop(c.sessions, p.sessions) : null;
    if (dSess != null && dSess <= -W_ALERT.sessions) flags.push('SESSIONS ▼' + Math.abs(dSess) + '%');
    const acos = c.spend != null && c.adSales ? Math.round(c.spend / c.adSales * 100) : null;
    if (acos != null && acos >= W_ALERT.acos) flags.push('ACoS ' + acos + '%');
    if (!flags.length) return;
    out.push({ e, wk, c, p, flags, dSales: dSales == null ? 0 : dSales, dSpend, dOrg, dSess, acos });
  });
  return out.sort((a, b) => (a.dSales - b.dSales) || (b.p.rev || 0) - (a.p.rev || 0));
}
// The "What moved" card.
function pxAlertsCard(ctx) {
  const wks = pxAlertWeeks(), wk = wks[Math.min(PX.alertWk, wks.length - 1)];
  const live = ctx.found.filter(e => !e.old && !e.disc);         // What moved leaves out discontinued and inactive
  const rows = pxAlertRows(live, wk), shown = PX.alertAll ? rows : rows.slice(0, 8);
  const d = v => (v == null ? '<span class="px-dim">—</span>'
    : `<span class="${v < 0 ? 'px-neg' : 'px-pos'}">${v < 0 ? '▼' : '▲'} ${Math.abs(v)}%</span>`);
  const body = shown.map(x => {
    // The cause from the same six-way split as "Why did it move?", so the two can never disagree (12 Nov — the old
    // wCause knew nothing of Buy Box or stock and called the Reversible Quilt's lost Buy Box "conversion").
    const cz = pwMain(x.e.asins, wk);
    const org = wOrganic(x.c), op = org != null && x.c.rev ? Math.round(org / x.c.rev * 100) : null;
    return `<tr><td class="l stick">${pxProd(x.e, false, true)}</td>`
      + `<td><span class="px-dim">${pxMoney(x.p.rev)} →</span> <b>${pxMoney(x.c.rev)}</b></td><td>${d(x.dSales)}</td>`
      + `<td>${x.c.spend == null ? '<span class="px-dim">—</span>' : pxMoney(x.c.spend)} <small class="px-sm2">${x.dSpend == null ? '' : d(x.dSpend)}</small></td>`
      + `<td>${org == null ? '<span class="px-dim">—</span>' : pxMoney(org)}${op == null ? '' : ` <small class="px-dim">${op}%</small>`} <small class="px-sm2">${x.dOrg == null ? '' : d(x.dOrg)}</small></td>`
      + `<td>${x.c.sessions == null ? '<span class="px-dim">—</span>' : pxN(x.c.sessions)} <small class="px-sm2">${x.dSess == null ? '' : d(x.dSess)}</small></td>`
      + `<td>${x.acos == null ? '<span class="px-dim">—</span>' : pxAcos(x.acos)}</td>`
      + `<td class="l">${cz ? `<span class="pw-mix-c pw-k-${cz.main}">${PW_IC[cz.main]}${PW_META[cz.main].t} <b>${Math.round(Math.abs(cz.share) * 100)}%</b></span>` : '<span class="px-dim">—</span>'} <button class="px-why" data-pxwhy="${pxEsc(x.e.key)}">Why?</button></td>`
      + `<td class="l">${x.flags.map(f => `<span class="px-flag${/ZERO|ACoS/.test(f) ? ' px-flag-bad' : ''}">${pxEsc(f)}</span>`).join('')}</td></tr>`;
  }).join('');
  const chips = wks.map((w, i) => `<button data-pxaw="${i}" aria-pressed="${w === wk}">${pxEsc(pxColLabel(w, sdShift(w, 6)))}</button>`).join('');
  /* BIGGEST FALLS AND GAINS (12 Nov): the week against the one before, in dollars, as bars that grow from the middle —
   * the products that moved the total most, whatever their percentage. Each opens "Why did it move?". */
  const mv = live.map(e => {
    const c = pxWeekCell(e.asins, wk), p = pxWeekCell(e.asins, sdShift(wk, -7));
    const a = (c && c.rev) || 0, b = (p && p.rev) || 0;
    return { e, d: a - b, pc: b ? (a - b) / b * 100 : null };
  }).filter(x => Math.abs(x.d) >= 1);
  const falls = mv.filter(x => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 6);
  const gains = mv.filter(x => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 6);
  const big = Math.max(1, ...falls.concat(gains).map(x => Math.abs(x.d)));
  const mvRow = x => `<button class="px-mv${x.d < 0 ? ' px-mv-dn' : ' px-mv-up'}" data-pxwhy="${pxEsc(x.e.key)}" title="Why did it move?">`
    + `${pxPic([x.e.key].concat(x.e.asins), x.e.title, true)}<span class="px-mv-n">${pxEsc(String(x.e.title || x.e.key).replace(/^~\s*/, ''))}</span>`
    + `<span class="px-mv-bar"><i style="--w:${(Math.abs(x.d) / big * 100).toFixed(1)}%"></i></span>`
    + `<b>${x.d < 0 ? '−' : '+'}${pxShort(Math.abs(x.d))}</b><small>${x.pc == null ? 'new' : (x.pc < 0 ? '▼ ' : '▲ ') + Math.abs(x.pc).toFixed(0) + '%'}</small></button>`;
  const movers = falls.length || gains.length
    ? `<div class="px-movers"><div><h4><i class="px-dot px-dot-dn"></i>Biggest falls</h4>${falls.map(mvRow).join('') || '<div class="px-dim">None</div>'}</div>`
      + `<div><h4><i class="px-dot px-dot-up"></i>Biggest gains</h4>${gains.map(mvRow).join('') || '<div class="px-dim">None</div>'}</div></div>` : '';
  const more = rows.length > 8
    ? `<div class="px-foot"><span>${shown.length} of ${rows.length} shown</span><button class="px-btn" data-px="alertall">${PX.alertAll ? 'Show fewer' : 'Show all ' + rows.length}</button></div>` : '';
  const wkTxt = pxFmtRange(wk, sdShift(wk, 6)), pwTxt = pxFmtRange(sdShift(wk, -7), sdShift(wk, -1));
  const note = `<p>Compares one finished Sunday–Saturday week, <b>${pxEsc(wkTxt)}</b>, with the week before it, <b>${pxEsc(pwTxt)}</b> — pick another of the last four weeks with the chips. Whole weeks, so sessions are in.</p>`
    + `<p><b>Biggest falls / gains</b>: the ${PX.level === 'child' ? 'child ASINs' : 'products'} whose weekly sales changed most in dollars, longest bar = biggest move; the % is the same change against the week before.</p>`
    + `<p><b>The list</b>: every one whose sales, ad spend, organic sales or sessions fell ${W_ALERT.drop}% or more, or whose ACoS was ${W_ALERT.acos}%+ — worst fall first. Each column is “week before → week”. <b>Main cause</b> is the biggest of the six causes in Why did it move?, with its share of the move.</p>`
    + '<p>Click any product for its breakdown, right here under this card.</p>';
  const whyHere = PX.why && PX.why.at === 'moved' ? `<div class="pw-solo pw-solo-m">${pwDrawer(ctx)}</div>` : '';
  return `<div class="px-card px-flush px-alerts"><div class="px-hbar"><div><span class="px-chart-t">What moved${pxI('moved', 'What moved', note)}</span>`
    + `<span class="px-note">The week against the one before · ${rows.length ? `<b>${rows.length}</b> ${PX.level === 'child' ? 'child ASIN' : 'product'}${rows.length === 1 ? '' : 's'} fell 30%+ or ran ACoS 60%+` : 'nothing fell 30%+ and no ACoS ran 60%+'} · click any product for Why did it move?</span></div>`
    + `<div class="px-seg px-segsm" role="group" aria-label="Week">${chips}</div></div>${movers}`
    + whyHere
    + (rows.length ? `<div class="px-tw px-tw-s"><table class="px-tbl px-atbl"><thead><tr><th class="l stick">Product</th><th>Sales (week before → week)</th><th>Change</th><th>Ad spend</th><th>Organic</th><th>Sessions</th><th>ACoS</th><th class="l">Main cause</th><th class="l">Flags</th></tr></thead><tbody>${body}</tbody></table></div>${more}` : '')
    + '</div>';
}

/* ---------- the notes behind the (i) buttons ----------
 * Each is worked out for what is on screen: the dates, the dates they are compared with, the brand and search. */
// The words for the dates in view and the dates they are compared with: { d, p, n, why } — p is null when there is
// nothing to compare with (today is in the dates, or nothing is stored before them).
function pxCmp(ctx) {
  const sp = ctx.span, t = pxToday();
  const d = sp && sp.lo ? pxFmtRange(sp.lo, sp.hi) : '—', n = sp && sp.lo ? pxLen(sp.lo, sp.hi) : 0;
  const pp = sp && sp.src !== 'none' && sp.hi < t ? pxPrevPlan(sp) : null;
  const p = pp && pp.src !== 'none' ? pxFmtRange(pp.lo, pp.hi) : null;
  const why = sp && sp.hi >= t ? 'the dates include today, which is not finished, so nothing is compared until it is'
    : 'nothing is stored for the days just before these, so there is nothing to compare with';
  return { d, p, n, why, days: n === 1 ? '1 day' : n + ' days' };
}
// "compared with …" in a sentence, or why nothing is.
const pxCmpTxt = c => (c.p ? `compared with <b>${pxEsc(c.p)}</b> — the same ${c.days} just before` : `not compared: ${c.why}`);
// Who is in view, in words.
const pxWhoTxt = ctx => (PX.brand === 'ALL' ? 'both brands' : pxEsc(BRAND_NAME[PX.brand] || PX.brand))
  + (PX.q.trim() ? `, only products matching “${pxEsc(PX.q.trim())}”` : '')
  + ` — ${ctx.found.filter(e => !e.old && !e.solo && !e.disc).length.toLocaleString('en-US')} ${PX.level === 'child' ? 'child ASINs' : 'parents'}`;
// True when the dates in view run past the ad report.
const cmpI2 = ctx => !!(ctx.span && ctx.span.hi && pxAdEndView() && ctx.span.hi > pxAdEndView());
// The table's note.
function pxTableInfo(ctx) {
  const c = pxCmp(ctx), cm = PX.mode === 'cols';
  return `<p>One row per ${PX.level === 'child' ? 'child ASIN (one size or colour)' : 'parent product, its sizes added together'}, for ${pxWhoTxt(ctx)}. The blue <b>All</b> row is everything in view added up (orders there are unique orders, so an order of two sizes counts once).</p>`
    + (cm ? `<p>Each column is one stretch of dates (${pxEsc(pxColsDesc(PX.pc))}), showing the figure chosen in “Each column shows”. The bar in each cell is that figure against the row's biggest. <b>vs column before</b> compares the last full column with the one before it. Striped columns include today, so they are not finished.</p>`
      : `<p>Every figure is for <b>${pxEsc(c.d)}</b>. <b>vs prev</b> is sales ${pxCmpTxt(c)}. A red stripe on the left marks a product whose sales fell 30% or more.</p>`)
    + '<p>A parent is an Amazon family (a parent with sizes), from Amazon\'s catalogue. Stand-alone listings have their own rows, tagged; inactive or deleted listings are gathered in one row per brand. Both are in the totals and neither is counted as a parent.</p>'
    + (pxAdEndView() && cmpI2(ctx) ? `<p>The ad report runs a day behind sales: it reaches <b>${pxEsc(pxDM(pxAdEndView()))}</b>. Ad figures stop there, and organic and TACoS are worked out on sales up to that day only.</p>` : '')
    + '<p>Colours: ACoS green at 30% or less, red at 55% or more; TACoS green at 15% or less, red at 30% or more. The bar beside Organic share fills with the organic part of sales. Sessions and Unit session % exist only for whole Sunday–Saturday weeks.</p>'
    + `<p>Click a column's title to sort by it (again to reverse); hover it for the sum behind it. Click <b>sizes ▸</b> to open a parent's sizes, and a product's name for <b>Why did it move?</b> right under its row.</p>`;
}
// The note of one trend line (the tiles at the end of the page).
function pxTrendNote(label, ctx) {
  const c = pxCmp(ctx), g = pxChartBuckets(ctx).g;
  const per = g === 'day' ? 'one point per day' : g === 'week' ? 'one point per Sunday–Saturday week' : g === 'cols' ? 'one point per column of the table' : 'no points for these dates';
  const what = {
    'Sales': 'total sales', 'Orders / Units': 'units sold', 'Ad spend': 'Sponsored Products spend (ROAS = ad sales ÷ ad spend under it)',
    'ACoS': 'ACoS = ad spend ÷ ad sales (CPC = spend ÷ clicks under it)', 'TACoS': 'TACoS = ad spend ÷ all sales',
    'Organic share': 'organic sales ÷ all sales', 'Sessions': 'Amazon sessions (product page visits)',
  }[label] || label;
  const low = label === 'ACoS' || label === 'TACoS';
  const pts = label === 'ACoS' || label === 'TACoS' || label === 'Organic share';
  if (label === 'Sessions') {
    return `<p>Sessions are visits to the product pages, from Amazon's Sales &amp; Traffic report — one report per brand per whole Sunday–Saturday week, so they exist only for whole weeks. Unit session % (under it) = units ÷ sessions.</p>`
      + '<p>The line is the last 8 finished weeks, whatever dates you picked. The figure fills in only when the dates are whole weeks — pick <b>Custom ▾ → Last week</b> or <b>Last 4 weeks</b>.</p>';
  }
  return `<p>The figure is ${what} for <b>${pxEsc(c.d)}</b>. The coloured pill beside it is the change ${c.p ? 'against <b>' + pxEsc(c.p) + '</b>, the same ' + c.days + ' just before' : '— none now: ' + c.why}${pts ? ', in percentage points' : ''}: green is good, red is bad (${low ? 'down is good here' : 'up is good here'}).</p>`
    + `<p>The small line under it is the same figure drawn over the chart's bars — ${per}; the last point is the newest. It shows the shape, not a comparison.</p>`;
}
// The note of the date row and the custom dates.
function pxDatesNote(ctx) {
  const c = pxCmp(ctx);
  return `<p>The dates drive everything between the toolbar and the end of the table: the totals, the table, the brand cards' “sold” and the chart. Now: <b>${pxEsc(c.d)}</b>${c.n ? ` (${c.days})` : ''}.</p>`
    + `<p>They are ${pxCmpTxt(c)}. That is what “vs prev”, the Sales % and Falling / Growing use.</p>`
    + '<ul><li><b>Today</b> — so far, never compared until it is over.</li><li><b>Yesterday, 7 / 14 / 30 days</b> — ending yesterday.</li><li><b>This month</b> — the 1st to today; <b>Last month</b> — the whole of it.</li>'
    + `<li><b>Custom ▾</b> — any From / To, plus <b>Last week</b> and <b>Last 4 weeks</b>: whole Sunday–Saturday weeks, the only dates with Sessions and Unit session %.</li></ul>`
    + `<p>Day-by-day figures start on <b>${WDAY.from ? pxEsc(pxFmtRange(WDAY.from, WDAY.from)) : '—'}</b>; before that only whole weeks can be shown. <b>Split into columns</b> puts the same kind of dates side by side.</p>`;
}
// Hold the in-table breakdown to the table's visible width, so it never scrolls sideways with the columns.
function pxWhyFit() {
  const pane = $('panePpcn');
  if (!pane) return;
  pane.querySelectorAll('.px-tw').forEach(tw => {
    if (tw.querySelector('.pw-stick')) tw.style.setProperty('--pxtw', (tw.clientWidth - 2) + 'px');
  });
}
/* ---------- RECOMMENDATIONS: product by product, in the Ad Console's own style ----------
 * 13 Nov (Vishesh: "add a recommendations tab just like ads console — basic product-wise recommendations"). The same bar
 * as the Ad Console's Recommendation (ads/ads-health.js, its adh-* look): closed, it shows the most urgent suggestion;
 * open, three figures, the top suggestion, then one row per check that found something, each opening to its products.
 * Nine checks over the parents and stand-alone listings in view (never discontinued or inactive ones), on the dates in
 * view when they are 7+ finished days, else the last 14 days; stock is Listing Health's FBA stock now. Every suggestion
 * is polite — never an order — and says how it was worked out. READ-ONLY: nothing is changed anywhere. */
const PX_SEV = {
  crit: { t: 'Critical', r: 0, tip: 'Sales have stopped.' },
  high: { t: 'High', r: 1, tip: 'Money is going out with little coming back, or stock has run out.' },
  med: { t: 'Medium', r: 2, tip: 'Worth a look soon.' },
  low: { t: 'Low', r: 3, tip: 'An opportunity.' },
};
const PX_BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';
const PX_CHEV = '<svg class="adh-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const PX_TRI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
const pxPill = sev => `<span class="adh-pill adh-${sev}">${sev === 'crit' || sev === 'high' ? PX_TRI : ''}${PX_SEV[sev].t}</span>`;
// The products' stock picture: per product, the sizes that sold in the last 30 days, how many are at 0 FBA stock now,
// and the days of stock left at the 30-day pace (null when Listing Health has no FBA stock for them — e.g. MFN).
// A size counts as OUT only at 0 FBA stock AND with no unit sold in the last 5 days: Listing Health knows FBA stock only,
// so a size still selling at 0 FBA stock is being sent some other way (merchant-fulfilled) and is not out.
function pxStockOf(e) {
  const t = pxToday(), p30 = pxPlan(sdShift(t, -30), sdShift(t, -1)), p5 = pxPlan(sdShift(t, -5), sdShift(t, -1));
  let sold = 0, out = 0, qty = 0, u30 = 0, known = false;
  e.asins.forEach(a => {
    const u = pxQuickU(a, p30), q = pwQty(a);
    if (u <= 0) return;
    sold++;
    u30 += u;
    if (q == null) return;
    known = true;
    qty += q;
    if (q === 0 && pxQuickU(a, p5) === 0) out++;
  });
  return { sold, out, qty, u30, cover: known && u30 > 0 ? qty / (u30 / 30) : null, known };
}
// The checks: [{ id, sev, title, cat, act, why, how, money: { v, l, kind }, cols, rows: [{ e, cells }] }], found only.
function pxRecs(ctx) {
  const t = pxToday();
  const sp = ctx.span, ok = sp && sp.src !== 'none' && sp.hi < t && pxLen(sp.lo, sp.hi) >= 7 && PX.mode === 'range';
  const plan = ok ? sp : pxPlan(sdShift(t, -14), sdShift(t, -1));
  const prev = pxPrevPlan(plan);
  const dTxt = pxFmtRange(plan.lo, plan.hi), pTxt = pxFmtRange(prev.lo, prev.hi);
  const live = ctx.found.filter(e => !e.old && !e.disc);
  const S = new Map(live.map(e => [e, pxStats(e.asins, plan, true)]));
  const K = new Map();
  const stock = e => (K.has(e) ? K.get(e) : (K.set(e, pxStockOf(e)), K.get(e)));
  const name = e => String(e.title || e.key).replace(/^~\s*/, '');
  const prod = e => `<button type="button" class="px-recp" data-pxwhy="${pxEsc(e.key)}" title="Why did it move? — opens under the table">${pxPic([e.key].concat(e.asins), name(e), true)}<span>${pxEsc(name(e))}</span></button>`;
  const M = v => pxMoney(v), P = v => pxPct(v);
  const out = [];
  const add = (f, list, cells, money) => {
    if (!list.length) return;
    f.rows = list.map(e => ({ e, cells: cells(e) }));
    f.money = money;
    f.n = list.length;
    out.push(f);
  };
  // 1. Sales stopped
  const stopped = live.filter(e => { const o = S.get(e), q = o.vp; return o.has === false || (o.rev === 0 && q != null); })
    .map(e => ({ e, q: pxStats(e.asins, prev).rev || 0 })).filter(x => x.q >= 150).sort((a, b) => b.q - a.q);
  add({ id: 'stop', sev: 'crit', cat: 'Sales', title: `${stopped.length} product${stopped.length === 1 ? '' : 's'} stopped selling`,
    act: 'Check each listing on Amazon now — suppressed, out of stock, or lost the Buy Box.',
    why: `They sold in ${pTxt} and nothing in ${dTxt}.`,
    how: `Sales of ${pTxt} of at least $150, and $0 in ${dTxt}.`,
    cols: ['Product', 'Sales before', 'Sales now', 'FBA stock now'] }, stopped.map(x => x.e),
  e => { const st = stock(e); return [prod(e), M(stopped.find(x => x.e === e).q), M(0), st.known ? pxN(st.qty) : '—']; },
  { v: stopped.reduce((s, x) => s + x.q, 0), l: 'sales before', kind: 'loss' });
  // 2. Out of stock on sizes that sell
  const oos = live.filter(e => stock(e).out > 0 && (S.get(e).rev || 0) > 0).sort((a, b) => stock(b).out - stock(a).out);
  add({ id: 'oos', sev: 'high', cat: 'Stock', title: `${oos.length} product${oos.length === 1 ? ' has' : 's have'} selling sizes out of stock`,
    act: 'Send FBA stock for the sizes at 0 — every day out of stock is sales and ranking lost.',
    why: 'These sizes sold in the last 30 days, have 0 FBA stock now, and have sold nothing for 5 days.',
    how: 'Sizes with a unit sold in the last 30 days, 0 FBA stock in Listing Health’s snapshot, and no unit sold in the last 5 days (a size still selling at 0 FBA stock is being sent another way, so it is not counted).',
    cols: ['Product', 'Sizes at 0', 'Sizes selling', 'Units, 30 days'] }, oos,
  e => { const st = stock(e); return [prod(e), `<b class="ui-neg">${st.out}</b>`, pxN(st.sold), pxN(st.u30)]; },
  { v: oos.reduce((s, e) => s + stock(e).out, 0), l: 'sizes at 0', kind: 'count' });
  // 3. ACoS too high
  const hiAcos = live.filter(e => { const o = S.get(e); return o.spend >= 50 && o.acos != null && o.acos >= 55; })
    .sort((a, b) => (S.get(b).spend - S.get(b).adSales * 0.35) - (S.get(a).spend - S.get(a).adSales * 0.35));
  add({ id: 'acos', sev: 'high', cat: 'Ads', title: `${hiAcos.length} product${hiAcos.length === 1 ? '' : 's'} spending too much per sale (ACoS 55%+)`,
    act: 'Lower bids on these products’ campaigns, or pause the keywords that spend without selling (Ad Console → Search Terms).',
    why: `Ad spend is 55% or more of the ad sales it brought, ${dTxt}.`,
    how: 'Ad spend of at least $50, ACoS = ad spend ÷ ad sales of 55% or more. "Over target" is the spend above a 35% ACoS.',
    cols: ['Product', 'Ad spend', 'Ad sales', 'ACoS', 'Over target'] }, hiAcos,
  e => { const o = S.get(e); return [prod(e), M(o.spend), M(o.adSales), `<b class="ui-neg">${P(o.acos)}</b>`, M(Math.max(0, o.spend - o.adSales * 0.35))]; },
  { v: hiAcos.reduce((s, e) => s + Math.max(0, S.get(e).spend - S.get(e).adSales * 0.35), 0), l: 'over a 35% ACoS', kind: 'loss' });
  // 4. Spend with no ad sales
  const noSale = live.filter(e => { const o = S.get(e); return o.spend >= 25 && !(o.adSales > 0); }).sort((a, b) => S.get(b).spend - S.get(a).spend);
  add({ id: 'nosale', sev: 'high', cat: 'Ads', title: `${noSale.length} product${noSale.length === 1 ? '' : 's'} with ad spend and no ad sales`,
    act: 'Pause or rework these ads — the clicks are not turning into orders.',
    why: `Ads spent money and Amazon credits no sale to them, ${dTxt}.`,
    how: 'Ad spend of at least $25 and $0 ad sales.',
    cols: ['Product', 'Ad spend', 'Clicks', 'Sales (all)'] }, noSale,
  e => { const o = S.get(e); return [prod(e), `<b class="ui-neg">${M(o.spend)}</b>`, pxN(o.cl), M(o.rev)]; },
  { v: noSale.reduce((s, e) => s + S.get(e).spend, 0), l: 'spent, no ad sale', kind: 'loss' });
  // 5. Falling 30%+
  const falling = live.filter(e => { const o = S.get(e); return o.vp != null && o.vp <= -30 && o.rev > 0; })
    .map(e => ({ e, q: pxStats(e.asins, prev).rev || 0 })).filter(x => x.q >= 200)
    .sort((a, b) => (S.get(a.e).rev - a.q) - (S.get(b.e).rev - b.q)).map(x => x.e);
  add({ id: 'fall', sev: 'med', cat: 'Sales', title: `${falling.length} product${falling.length === 1 ? '' : 's'} fell 30% or more`,
    act: 'Open each one’s “Why did it move?” — it splits the fall into traffic, ad spend, conversion, Buy Box, stock and price.',
    why: `${dTxt} against ${pTxt}.`,
    how: 'Sales down 30%+ against the same number of days just before, from at least $200.',
    cols: ['Product', 'Sales before', 'Sales now', 'Change'] }, falling,
  e => { const o = S.get(e), q = o.rev / (1 + o.vp / 100); return [prod(e), M(q), M(o.rev), `<b class="ui-neg">▼ ${Math.abs(o.vp).toFixed(0)}%</b>`]; },
  { v: falling.reduce((s, e) => { const o = S.get(e); return s + (o.rev / (1 + o.vp / 100) - o.rev); }, 0), l: 'sales lost', kind: 'loss' });
  // 6. Running low on stock
  const low = live.filter(e => { const st = stock(e); return st.cover != null && st.cover > 0 && st.cover < 14 && !st.out; })
    .sort((a, b) => stock(a).cover - stock(b).cover);
  add({ id: 'low', sev: 'med', cat: 'Stock', title: `${low.length} product${low.length === 1 ? '' : 's'} with under 2 weeks of stock`,
    act: 'Plan an FBA shipment now — at today’s pace these run out within 14 days.',
    why: 'FBA stock now ÷ the units a day they sold over the last 30 days.',
    how: 'Days of stock = FBA stock now ÷ (units sold in the last 30 days ÷ 30), on the sizes that sold.',
    cols: ['Product', 'FBA stock', 'Units / day', 'Days left'] }, low,
  e => { const st = stock(e); return [prod(e), pxN(st.qty), (st.u30 / 30).toFixed(1), `<b class="ui-neg">${Math.floor(st.cover)}</b>`]; },
  { v: low.length, l: low.length === 1 ? 'product' : 'products', kind: 'count' });
  // 7. Clicks that do not convert
  // Judged against the account's own rate over the same dates (13 Nov: 4.1%), not a fixed figure: under 60% of it.
  const acct = pxStats(live.flatMap(e => e.asins), plan), crBar = acct.cr != null ? acct.cr * 0.6 : 3;
  const lowCr = live.filter(e => { const o = S.get(e); return o.cl >= 300 && o.cr != null && o.cr < crBar; }).sort((a, b) => S.get(b).spend - S.get(a).spend);
  add({ id: 'cvr', sev: 'med', cat: 'Listing', title: `${lowCr.length} product${lowCr.length === 1 ? ' gets' : 's get'} ad clicks that rarely turn into orders`,
    act: 'Look at the listing these clicks land on — main image, price against similar products, reviews, sizes in stock.',
    why: `Their Conv. rate is under ${crBar.toFixed(1)}% — less than 60% of the account's ${acct.cr != null ? acct.cr.toFixed(1) + '%' : ''}, ${dTxt}.`,
    how: `At least 300 ad clicks, and Conv. rate = ad orders ÷ clicks under 60% of the account's own rate over the same dates (${crBar.toFixed(1)}%).`,
    cols: ['Product', 'Clicks', 'Conv. rate', 'Ad spend'] }, lowCr,
  e => { const o = S.get(e); return [prod(e), pxN(o.cl), `<b class="ui-neg">${P(o.cr)}</b>`, M(o.spend)]; },
  { v: lowCr.reduce((s, e) => s + S.get(e).spend, 0), l: 'ad spend on them', kind: 'info' });
  // 8. Room to grow
  const grow = live.filter(e => { const o = S.get(e), st = stock(e); return o.acos != null && o.acos <= 20 && (o.adO || 0) >= 10 && !(st.cover != null && st.cover < 30) && !st.out; })
    .sort((a, b) => S.get(b).adSales - S.get(a).adSales);
  add({ id: 'grow', sev: 'low', cat: 'Ads', title: `${grow.length} product${grow.length === 1 ? '' : 's'} could take more ad spend`,
    act: 'Raise bids 10–15% on these — they sell cheaply through ads and have stock to back it.',
    why: `ACoS of 20% or less on at least 10 ad orders, ${dTxt}, and at least 30 days of stock (or stock not tracked).`,
    how: 'ACoS ≤ 20%, 10+ ad orders, no selling size at 0, and 30+ days of FBA stock where Listing Health has it.',
    cols: ['Product', 'Ad sales', 'ACoS', 'Ad orders'] }, grow,
  e => { const o = S.get(e); return [prod(e), M(o.adSales), `<b class="adh-pos">${P(o.acos)}</b>`, pxN(o.adO)]; },
  { v: grow.reduce((s, e) => s + S.get(e).adSales, 0), l: 'ad sales now', kind: 'gain' });
  // 9. Selling on their own
  const organic = live.filter(e => { const o = S.get(e); return o.rev >= 1000 && o.op != null && o.op >= 80; }).sort((a, b) => S.get(b).rev - S.get(a).rev);
  add({ id: 'org', sev: 'low', cat: 'Organic', title: `${organic.length} product${organic.length === 1 ? ' sells' : 's sell'} mostly on ${organic.length === 1 ? 'its' : 'their'} own`,
    act: 'Keep them in stock and protect the listing — ads add little here; spend where it moves sales.',
    why: `80%+ of their sales came without an ad click, ${dTxt}.`,
    how: 'Sales of at least $1,000 and organic share (sales − ad sales) ÷ sales of 80% or more.',
    cols: ['Product', 'Sales', 'Organic share', 'Ad spend'] }, organic,
  e => { const o = S.get(e); return [prod(e), M(o.rev), `<b class="adh-pos">${P(o.op)}</b>`, M(o.spend)]; },
  { v: organic.reduce((s, e) => s + S.get(e).rev, 0), l: 'sales', kind: 'gain' });
  out.sort((a, b) => PX_SEV[a.sev].r - PX_SEV[b.sev].r || Math.abs(b.money.v || 0) - Math.abs(a.money.v || 0));
  return { found: out, checks: 9, plan, dTxt, pTxt, fellBack: !ok, live: live.length };
}
// The bar.
function pxRecsCard(ctx) {
  const R = pxRecs(ctx), f0 = R.found[0], n = { crit: 0, high: 0, med: 0, low: 0 };
  R.found.forEach(f => { n[f.sev]++; });
  // Every figure is a positive amount; a loss is red, a gain green, a count plain.
  const money = m => (m.kind === 'count' ? `<b>${pxN(m.v)}</b>` : `<b class="${m.kind === 'loss' ? 'ui-neg' : m.kind === 'gain' ? 'adh-pos' : ''}">${pxMoney(Math.abs(m.v))}</b>`) + `<small>${pxEsc(m.l)}</small>`;
  const brandTxt = PX.brand === 'ALL' ? 'Both brands' : BRAND_NAME[PX.brand] || PX.brand;
  const sub = `${pxEsc(R.dTxt)}${R.fellBack ? ' (the last 14 days — the dates in view are not 7+ finished days)' : ''} · ${pxEsc(brandTxt)} · ${R.live} products · ${R.found.length} suggestion${R.found.length === 1 ? '' : 's'} from ${R.checks} checks`;
  const chips = R.found.length ? Object.keys(PX_SEV).filter(k => n[k]).map(k => `<span class="adh-chip adh-${k}"><i class="adh-dot"></i>${n[k]} ${PX_SEV[k].t}</span>`).join('')
    : '<span class="adh-chip adh-ok"><i class="adh-dot"></i>All clear</span>';
  const urg = f0 ? `<span class="adh-urg adh-${f0.sev}"><span class="adh-urgl">Top suggestion</span><span class="adh-urga">${pxEsc(f0.title)} — ${pxEsc(f0.act)}</span></span>`
    : '<span class="adh-urg adh-ok"><span class="adh-urgl">All clear</span><span class="adh-urga">Nothing to suggest for these products and dates.</span></span>';
  const sum = `<summary class="adh-sum"><span class="adh-ico">${PX_BULB}</span><span class="adh-tt"><b>Recommendations${pxI('recs', 'Recommendations', `<p>Nine checks, product by product, over the parents and stand-alone listings in view (${pxEsc(brandTxt)}${PX.q.trim() ? ', searched' : ''}) — never discontinued or inactive ones.</p><p>Figures are for <b>${pxEsc(R.dTxt)}</b>${R.fellBack ? ' — the last 14 finished days, because the dates in view are not 7 or more finished days' : ', the dates in view'}; “before” means <b>${pxEsc(R.pTxt)}</b>, the same number of days just before. Stock is Listing Health’s FBA stock now, against the units sold in the last 30 days.</p><ul><li><b>Critical</b> — sales stopped.</li><li><b>High</b> — stock out on selling sizes, ACoS 55%+, ad spend with no ad sales.</li><li><b>Medium</b> — falling 30%+, under 2 weeks of stock, clicks that rarely convert.</li><li><b>Low</b> — room to grow through ads, products selling on their own.</li></ul><p>Each one opens to its products; click a product for its “Why did it move?”. Nothing here changes anything — they are suggestions.</p>`)}</b><small>${sub}</small></span>`
    + `<span class="adh-chips" title="${pxEsc(Object.values(PX_SEV).map(s => s.t + ': ' + s.tip).join('\n'))}">${chips}</span><span class="adh-chevw">${PX_CHEV}</span>${urg}</summary>`;
  // --- inside: three figures and the top suggestion, then the list ---
  const lossV = R.found.filter(f => f.money.kind === 'loss').reduce((s, f) => s + Math.abs(f.money.v), 0);
  const oosF = R.found.find(f => f.id === 'oos');
  const tiles = `<div class="adh-stats px-rstats">`
    + `<div class="adh-stat"><div class="adh-sl"><span class="adh-ic">${PX_BULB}</span>Suggestions</div><b>${R.found.length}</b>`
    + `<div class="adh-bar adh-sevbar">${Object.keys(PX_SEV).filter(k => n[k]).map(k => `<i class="adh-${k}" style="flex:${n[k]}"></i>`).join('')}</div>`
    + `<div class="adh-sevs">${Object.keys(PX_SEV).filter(k => n[k]).map(k => `<span><i class="adh-dot adh-${k}"></i>${n[k]} ${PX_SEV[k].t.toLowerCase()}</span>`).join('') || '<span>nothing to suggest</span>'}</div></div>`
    + `<div class="adh-stat adh-crit"><div class="adh-sl">Money at stake</div><b>${pxMoney(lossV)}</b><div class="adh-sn">sales lost or stopped, ad spend over a 35% ACoS, and ad spend with no ad sale</div></div>`
    + `<div class="adh-stat ${oosF ? 'adh-high' : 'adh-ok'}"><div class="adh-sl">Sizes out of stock</div><b>${oosF ? pxN(oosF.money.v) : 0}</b><div class="adh-sn">selling sizes at 0 FBA stock now</div></div></div>`;
  const top = f0 ? `<div class="adh-urgent adh-${f0.sev}"><div class="adh-ul">${pxPill(f0.sev)}<span>Top suggestion · ${pxEsc(f0.cat)}</span></div><div class="adh-ua">${pxEsc(f0.act)}</div><div class="adh-uw">${pxEsc(f0.title)}. ${pxEsc(f0.why)}</div></div>` : '';
  const list = R.found.map((f, i) => {
    const rows = f.rows.slice(0, PX.recAll.has(f.id) ? 200 : 6);
    const tbl = `<table class="adh-t px-rt"><thead><tr>${f.cols.map((c, j) => `<th${j ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>`
      + rows.map(r => `<tr>${r.cells.map((c, j) => `<td${j ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>'
      + (f.rows.length > 6 ? `<button type="button" class="ghost px-recmore" data-pxrecall="${f.id}">${PX.recAll.has(f.id) ? 'Show fewer' : `Show all ${f.rows.length}`}</button>` : '');
    return `<details class="adh-f adh-${f.sev}" data-pxrecf="${f.id}" style="--i:${i}"${PX.recF.has(f.id) ? ' open' : ''}><summary>${pxPill(f.sev)}`
      + `<span class="adh-ft"><b>${pxEsc(f.title)}</b><small>${pxEsc(f.cat)}</small></span><span class="adh-fm">${money(f.money)}</span>${PX_CHEV}</summary>`
      + `<div class="adh-fb"><p class="adh-do"><b>Suggestion:</b> ${pxEsc(f.act)}</p><p class="adh-why">${pxEsc(f.why)}</p>${tbl}`
      + `<div class="adh-how"><p><b>How it was checked:</b> ${pxEsc(f.how)}</p></div></div></details>`;
  }).join('');
  const body = `<div class="adh-body"><div class="adh-top">${tiles}${top}</div>${list ? `<div class="adh-list">${list}</div>` : ''}</div>`;
  return `<div class="card adh px-recs"><details class="adh-dd px-recdd"${PX.recOpen ? ' open' : ''}>${sum}${body}</details></div>`;
}
// Draw the whole page into panePpcn from PX and the stores; focusSel = a selector to focus afterwards (the search box).
function pxRender(focusSel) {
  const pane = $('panePpcn');
  if (!pane) return;
  // --- what to show ---
  PX_MEMO = new Map();
  PX_DAYS = null;
  PX_ADEND = null;
  PX_KIND = null;
  PX_SESS = null;
  PX_SALEWK = null;   // WEEKLY may have been refreshed since the last render
  PX_INFO = {};
  const old = pane.querySelector('.px-tw'), sc = old ? [old.scrollLeft, old.scrollTop] : null;
  const cm = PX.mode === 'cols';
  const empty = !Object.keys(WEEKLY.rows).length && !Object.keys(WDAY.rows).length;
  const ctx = pxCtx();
  // Every chip but All keeps to the live products: discontinued and inactive rows only ever show under All.
  const filtered = ctx.found.filter(e => (PX.chip === 'all' || (!e.old && !e.disc)) && PX_FILTERS[PX.chip][1](e.st));
  const sorted = pxSorted(filtered, ctx);
  const shown = sorted.slice(0, PX.show);
  const allAsins = ctx.found.flatMap(e => e.asins);
  const tot = pxStats(allAsins, ctx.span);
  tot.o = pxAcctOrders(ctx.span);                  // unique order ids, not the rows added up
  // The same figures over the same number of days just before — for a finished period only, exactly as "vs prev"
  // is judged everywhere on this page — so every tile in the strip can say which way it moved.
  const pp = ctx.span.src !== 'none' && ctx.span.hi < pxToday() ? pxPrevPlan(ctx.span) : null;
  const prv = pp && pp.src !== 'none' ? pxStats(allAsins, pp) : null;
  if (prv) prv.o = pxAcctOrders(pp);
  tot.vp = prv && prv.has && tot.has && prv.rev ? (tot.rev - prv.rev) / prv.rev * 100 : null;
  const P = k => (prv && prv.has ? prv[k] : null);

  // --- the toolbar ---
  const allowed = adBrands();
  const brandSeg = allowed.length > 1
    ? '<div class="px-seg" role="group" aria-label="Brand">'
      + [['ALL', 'Both']].concat(allowed.map(b => [b, BRAND_NAME[b] || b]))
      .map(([k, l]) => `<button data-pxbrand="${k}" aria-pressed="${PX.brand === k}">${pxEsc(l)}</button>`).join('') + '</div>'
    : `<span class="px-lock">${pxEsc(BRAND_NAME[allowed[0]] || allowed[0] || '')}</span>`;
  const viewSeg = `<div class="px-seg px-view" role="group" aria-label="View"><button data-pxmode="range" aria-pressed="${!cm}">${PX_IC_RANGE}Range report</button><button data-pxmode="cols" aria-pressed="${cm}">${PX_IC_COLS}Columns by date</button></div>`;
  const lvl = `<div class="px-seg" role="group" aria-label="Parent or child"><button data-pxlevel="parent" aria-pressed="${PX.level === 'parent'}">Parent</button><button data-pxlevel="child" aria-pressed="${PX.level === 'child'}">Child</button></div>`;
  const search = '<label class="px-search px-grow"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="pxQ" placeholder="Search product, ASIN or SKU" autocomplete="off"></label>';
  const setNow = pxSetNow(), ownCols = setNow === 'custom';
  const showBtn = cm ? '' : `<button class="px-btn${ownCols ? ' px-on' : ''}" data-px="pop-show" aria-expanded="${PX.pop === 'show'}">${PX_IC_COLS}Columns${ownCols ? ' · ' + (PX_RCOLS.length - PX.hide.length) : ''}</button>`;
  const sets = cm ? ''
    : '<span class="px-grow"></span><span class="px-lbl">Show</span><div class="px-seg px-segsm" role="group" aria-label="Column set">'
    + PX_SETS.map(([k, l]) => `<button data-pxset="${k}" aria-pressed="${setNow === k}">${l}</button>`).join('') + '</div>';
  const cmpI = pxCmp(ctx);
  const chips = '<span class="px-lbl">Quick filters</span>' + pxI('filters', 'Quick filters and Show', `<p>Each chip keeps only the rows that pass one test, judged on <b>${pxEsc(cmpI.d)}</b>; the small number is how many pass.</p><ul>`
    + '<li><b>ACoS 55%+</b> — ad spend is 55% or more of ad sales: ads that cost more than they should.</li>'
    + '<li><b>TACoS 30%+</b> — ad spend is 30% or more of ALL sales.</li>'
    + '<li><b>Organic 70%+</b> — 70% or more of sales came without an ad click.</li>'
    + `<li><b>Falling 30%+</b> — sales at least 30% below ${cmpI.p ? '<b>' + pxEsc(cmpI.p) + '</b> (the same ' + cmpI.days + ' just before)' : 'the days just before (none to compare with now: ' + cmpI.why + ')'}.</li>`
    + `<li><b>Growing</b> — sales above ${cmpI.p ? pxEsc(cmpI.p) : 'the days just before'}.</li></ul>`
    + '<p><b>Show</b> picks a ready-made set of columns: All, Overview (the money), Ads, Organic. <b>Columns</b> lets you pick them one by one, including the extras (8-week trend, Unit session %, ROAS, CPC).</p>')
    + Object.entries(PX_FILTERS).map(([k, v]) =>
    (k === 'all'
      // "All": the parents, as on the brand cards and the All row, with the stand-alone listings beside them.
      ? `<button class="px-chipf" data-pxchip="all" aria-pressed="${PX.chip === 'all'}" title="Parents (Amazon families), plus stand-alone listings">All <b>${ctx.found.filter(e => !e.old && !e.solo && !e.disc).length}</b>${ctx.found.some(e => e.solo) ? ` <small>+${ctx.found.filter(e => e.solo).length}</small>` : ''}</button>`
      : `<button class="px-chipf" data-pxchip="${k}" aria-pressed="${PX.chip === k}">${v[0]} <b>${ctx.found.filter(e => !e.old && !e.disc && v[1](e.st)).length}</b></button>`)).join('') + sets;

  // --- the period cards and the totals strip ---
  // Each tile: the figure, which way it moved against the period before (green when that is good), and the sum
  // or the figure behind it. ACoS / TACoS / organic share move in points, the rest in per cent.
  // Each tile also draws its own line: the chart's bars (the days or weeks around the dates) for the money and the
  // ratios, the last 8 finished weeks for sessions.
  const tile = (label, big, sub, dl, tip, sp) => `<div><small>${label}${pxI('tr-' + label, label + ' — its line', pxTrendNote(label, ctx))}</small>`
    + `<span class="px-st-big"><b>${big}</b>${dl}</span><em class="px-dim">${sub}</em>${sp || ''}</div>`;
  const whole = pxWholeWeeks(ctx.span);
  const ser = empty ? [] : pxSeries(allAsins, ctx).s, sv = f => ser.map(x => (x.none ? null : f(x)));
  const sessWk = (() => {
    const have = pxSessWeeks(), bs = PX.brand === 'ALL' ? adBrands() : [PX.brand];
    return pxLast8().map(k => {
      if (bs.some(b => !have.has(b + '|' + k))) return null;
      let n = 0;
      allAsins.forEach(a => { n += (((WEEKLY.rows[a] || {}).weeks || {})[k] || {}).sessions || 0; });
      return n;
    });
  })();
  const salesSub = prv ? 'vs ' + pxFmtRange(pp.lo, pp.hi)
    : ctx.span.hi >= pxToday() ? 'so far · compared once finished' : 'nothing stored before to compare';
  // The totals strip: the six tiles of PPC & Organic · New, as they were — the figure and the line under it, and the
  // sales tile's change against the period before.
  const c6 = pxCmp(ctx), forTxt = `for <b>${pxEsc(c6.d)}</b>, ${pxWhoTxt(ctx)}`;
  const adToTxt = tot.adTo ? `<p><b>The ad report reaches ${pxEsc(pxDM(tot.adTo))}</b> (it runs a day behind sales). So this is worked out on sales up to ${pxEsc(pxDM(tot.adTo))} only (${pxMoney(tot.revA)}), never against days that have no ad figures yet.</p>` : '';
  const tile6 = (label, big, sub, tip, note) => `<div><small>${label}${note ? pxI('t-' + label, label, note) : ''}</small><b>${big}</b>${sub}</div>`;
  const vpCls = tot.vp == null ? 'px-dim' : tot.vp < 0 ? 'px-neg' : 'px-pos';
  const strip = `<div class="px-card px-clip"><div class="px-strip px-strip6">`
    + tile6('Sales', tot.has ? pxMoney(tot.rev) : '—', `<em class="${vpCls}">${tot.vp == null ? (ctx.span.hi >= pxToday() ? 'so far · compared once finished' : '— vs prev') : pxSgn(tot.vp) + ' vs prev'}</em>`, '',
      `<p>Total sales ${forTxt} — every order on Amazon, paid and organic (MCF orders excluded).</p><p>The % under it is ${pxCmpTxt(c6)}${prv && prv.has ? `, when sales were <b>${pxMoney(prv.rev)}</b>` : ''}. Green means up, red means down.</p>`)
    + tile6('Orders / Units', `${pxN(tot.o)} / ${tot.has ? pxN(tot.u) : '—'}`, `<em class="px-dim">ad units ${pxN(tot.adU)} · organic ${pxN(tot.ou)}</em>`, '',
      `<p>Orders and units ${forTxt}. Orders are unique order numbers, so one order with two sizes is one order; units are the pieces sold.</p><p>Under it: <b>ad units</b> are units Amazon credits to an ad click, <b>organic</b> = units − ad units. Nothing is compared here.</p>`)
    + tile6('Ad spend', pxMoney(tot.spend), `<em class="px-dim">ad sales ${pxMoney(tot.adSales)}${tot.adTo ? ` · <span class="px-adto">ads to ${pxEsc(pxDM(tot.adTo))}</span>` : ''}</em>`, '',
      `<p>What Sponsored Products ads cost ${forTxt}.</p>${tot.adTo ? `<p><b>Ads to ${pxEsc(pxDM(tot.adTo))}</b>: the ad report runs a day behind sales; the days after it come with tonight's run.</p>` : ''}<p><b>Ad sales</b> are the sales Amazon credits to an ad click. ${tot.spend && tot.adSales ? `Every $1 of ads brought back <b>$${(tot.adSales / tot.spend).toFixed(2)}</b> (ROAS).` : ''} Today's ad figures arrive with tonight's run.</p>`)
    + tile6('Organic share', pxPct(tot.op), `<em class="px-dim">${pxMoney(tot.os)} organic</em>`, '',
      `<p>The part of sales that came WITHOUT an ad click: organic sales ÷ all sales, ${forTxt}.</p><p>Organic sales = sales − ad sales = <b>${pxMoney(tot.os)}</b>. Higher is better: the product sells on its own ranking.</p>${adToTxt}`)
    + tile6('ACoS', pxPct(tot.acos), '<em class="px-dim">spend ÷ ad sales</em>', '',
      `<p>Advertising cost of sales = ad spend ÷ ad sales, ${forTxt}: ${pxMoney(tot.spend)} ÷ ${pxMoney(tot.adSales)}.</p><p>Lower is better — how many cents of ads each dollar of ad sales cost. In the table, 30% or less is green and 55% or more red.</p>`)
    + tile6('TACoS', pxPct(tot.tacos), '<em class="px-dim">spend ÷ all sales</em>', '',
      `<p>Total advertising cost of sales = ad spend ÷ ALL sales (paid and organic), ${forTxt}: ${pxMoney(tot.spend)} ÷ ${tot.has ? pxMoney(tot.revA != null ? tot.revA : tot.rev) : '—'}.</p>${adToTxt}<p>Lower is better — the share of all revenue spent on ads. In the table, 15% or less is green and 30% or more red.</p>`)
    + '</div></div>';
  // The trend lines, at the end of the page: each figure, which way it moved, and its line over the chart's bars
  // (the last 8 finished weeks for sessions).
  const trends = `<div class="px-card px-clip"><div class="px-strip px-trends">`
    + tile('Sales', tot.has ? pxMoney(tot.rev) : '—', salesSub, pxDelta(tot.has ? tot.rev : null, P('rev'), '', 'up'), '',
      pxSpark(sv(x => x.rev), 'px-sp-brand'))
    + tile('Orders / Units', `${pxN(tot.o)} / ${tot.has ? pxN(tot.u) : '—'}`, `ad units ${pxN(tot.adU)} · organic ${pxN(tot.ou)}`,
      pxDelta(tot.o, P('o'), '', 'up'), PX_TIPS.o, pxSpark(sv(x => x.u), 'px-sp-brand'))
    + tile('Ad spend', pxMoney(tot.spend), `ad sales ${pxMoney(tot.adSales)} · ROAS ${pxX(tot.roas)}`,
      pxDelta(tot.spend, P('spend'), '', ''), PX_TIPS.roas, pxSpark(sv(x => x.spend), 'px-sp-ads'))
    + tile('ACoS', pxPct(tot.acos), `CPC ${pxC2(tot.cpc)}`, pxDelta(tot.acos, P('acos'), 'pt', 'down'), PX_TIPS.acos,
      pxSpark(sv(x => x.acos), 'px-sp-act'))
    + tile('TACoS', pxPct(tot.tacos), 'spend ÷ all sales', pxDelta(tot.tacos, P('tacos'), 'pt', 'down'), PX_TIPS.tacos,
      pxSpark(sv(x => x.tacos), 'px-sp-act'))
    + tile('Organic share', pxPct(tot.op), `${pxMoney(tot.os)} organic`, pxDelta(tot.op, P('op'), 'pt', 'up'), PX_TIPS.op,
      pxSpark(sv(x => x.op), 'px-sp-org'))
    + tile('Sessions', whole ? pxN(tot.se) : '—',
      whole ? `unit session % ${pxPct(tot.usp)}` : cm ? 'whole Sun–Sat weeks only' : 'Custom ▾ → Last week or Last 4 weeks',
      whole ? pxDelta(tot.se, P('se'), '', 'up') : '', PX_TIPS.se, pxSpark(sessWk, 'px-sp-brand'))
    + '</div></div>';

  // --- the bar over the table: date chips (range) or the column set-up (cols), with its pop-up ---
  let hbar;
  if (!cm) {
    const [lo, hi] = pxRange(), L = lo && hi ? pxLen(lo, hi) : 0;
    const prev = L ? pxFmtRange(sdShift(lo, -L), sdShift(lo, -1)) : '—';
    hbar = '<div class="px-hbar"><div class="px-dchips" role="group" aria-label="Dates">'
      + Object.entries(PX_DATES).filter(([k]) => !PX_WEEKPICKS.includes(k))
        .map(([k, v]) => `<button class="px-dchip" data-pxdk="${k}" aria-pressed="${PX.dkey === k}">${v[0]}</button>`).join('')
      + `<button class="px-dchip" data-px="pop-date" aria-pressed="${PX.dkey === 'custom' || PX_WEEKPICKS.includes(PX.dkey)}" aria-expanded="${PX.pop === 'date'}">${PX.dkey === 'custom' ? pxFmtRange(lo, hi) + ' ▾' : PX_WEEKPICKS.includes(PX.dkey) ? PX_DATES[PX.dkey][0] + ' ▾' : 'Custom ▾'}</button>${pxI('dates', 'Dates and what they are compared with', pxDatesNote(ctx))}</div>`
      + `<div class="px-tb"><span class="px-rlabel"><b>${pxFmtRange(lo, hi)}${hi >= pxToday() ? ' (today so far)' : ''}</b> · vs ${prev}${tot.adTo ? ` · <span class="px-adto" title="The ad report runs a day behind sales: ad figures, organic and TACoS stop at ${pxEsc(pxDM(tot.adTo))}.">ads to ${pxEsc(pxDM(tot.adTo))}</span>` : ''}</span>`
      + `<button class="px-colsum" data-px="split">${PX_IC_COLS}Split into columns <span class="px-ed">＋</span></button></div>`
      + (PX.pop === 'date' ? pxDatePop() : '') + '</div>';
  } else {
    const cs = ctx.cols;
    hbar = `<div class="px-hbar"><button class="px-colsum" data-px="pop-cols" aria-expanded="${PX.pop === 'cols'}">${PX_IC_COLS}${pxEsc(pxColsDesc(PX.pc))} <small>${pxFmtRange(cs[0].lo, cs[cs.length - 1].hi)}</small><span class="px-ed">Edit</span></button>`
      + '<div class="px-tb"><span class="px-lbl">Each column shows</span><div class="px-seg px-segsm" role="group" aria-label="Each column shows">'
      + Object.entries(PX_METRICS).map(([k, v]) => `<button data-pxm="${k}" aria-pressed="${PX.metric === k}">${v}</button>`).join('') + '</div></div>'
      + (PX.pop === 'cols' ? pxColsPop() : '') + '</div>';
  }
  // --- the warning when the dates cannot be answered ---
  // Say plainly when the dates cannot be answered, rather than showing a column of dashes.
  let warn = '';
  const nonePlans = cm
    ? ctx.cols.filter(c => c.src === 'none')
    : (ctx.span.src === 'none' ? [ctx.span] : []);
  if (!empty && nonePlans.length) {
    const old = nonePlans.some(c => c.why === 'old'), first = pxOldestSaleWeek();
    warn = `<div class="px-warn">${cm ? nonePlans.length + ' column' + (nonePlans.length === 1 ? '' : 's') + ' fall' + (nonePlans.length === 1 ? 's' : '') : 'These dates fall'} `
      + (old ? `on weeks with no stored sales figures${first ? ' — the oldest week there are figures for is <b>' + pxEsc(pxFmtRange(first, sdShift(first, 6))) + '</b>' : ''}.`
        : `before ${WDAY.from ? '<b>' + pxEsc(pxFmtRange(WDAY.from, WDAY.from)) + '</b>, where the day-by-day figures start' : 'the day-by-day figures'}. Earlier dates can only be shown as whole Sunday–Saturday weeks.`)
      + '</div>';
  }
  // --- the table, its footer and the freshness line ---
  const n = filtered.length;
  const more = n > shown.length ? `<button class="px-btn" data-px="more">Show ${Math.min(PX_PAGE, n - shown.length)} more</button>` : '';
  const foot = `<div class="px-foot"><span>${shown.length.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} ${PX.level === 'child' ? 'child ASINs' : 'parents'} shown${!cm && PX.level === 'parent' ? ' · click “sizes” to open a parent' : ''}${cm ? ' · striped columns include today, so they are not complete yet' : ''}</span>${more}</div>`;
  /* WHEN EACH PART OF LAST NIGHT'S RUN LANDED — sales, ads, sessions — the way the Ad Console says "sales as at
   * … · ads cover …". The three are separate phases of the nightly; one from an older day than the others is
   * marked, so a night whose ad phase never finished shows up here rather than as quietly old ad figures. */
  const nAt = WEEKLY.nAt || {}, isAt = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
  const parts = [['sales', WDAY.at || nAt.weekly || WEEKLY.at], ['ads', nAt.adsAsin || WEEKLY.adAt],
    ['sessions', nAt.sessions]].filter(x => isAt(x[1]));
  const newest = parts.map(x => String(x[1]).slice(0, 10)).sort().pop() || '';
  const behind = parts.filter(x => String(x[1]).slice(0, 10) < newest);
  const fresh = PX.msg ? `<span class="px-fresh px-busy">${pxEsc(PX.msg)}</span>`
    // The original pill — "Up to date · nightly run …" — with each part's time on hover; a part from an older night
    // turns it amber and is named, so a run whose ad phase never finished still shows.
    : parts.length ? (() => {
      const last = parts.map(x => String(x[1])).sort().pop();
      const each = parts.map(([l, s]) => l + ' ' + pxDM(String(s).slice(0, 10)) + ' ' + String(s).slice(11, 16)).join(' · ');
      return `<span class="px-fresh${behind.length ? ' px-stale' : ''}" title="When last night’s run wrote each part (IST): ${pxEsc(each)}">`
        + `${behind.length ? pxEsc(behind.map(x => x[0]).join(' and ')) + ' behind' : 'Up to date'} · nightly run ${pxEsc(pxDM(last.slice(0, 10)) + ' ' + last.slice(11, 16))}</span>`;
    })()
    : '';

  // "Why did it move?" lives in the page: under its row when the row is on screen, else at the top of the table.
  const whyT = PX.why && PX.why.at === 'table';
  const whyIn = whyT && shown.some(e => e.key === PX.why.anchor);
  const whySolo = whyT && !whyIn && !empty ? `<div class="pw-solo">${pwDrawer(ctx)}</div>` : '';
  const table = empty
    ? `<div class="px-empty">${PX.loading ? 'Loading the PPC figures…' : 'No PPC figures stored yet. Open the old view (link at the top right) and press Refresh, or wait for tonight’s run.'}</div>`
    : `${whySolo}<div class="px-tw${PX.anim ? ' px-swap' : ''}${whyIn ? ' px-tw-open' : ''}">${cm ? pxColTable(shown, ctx) : pxRangeTable(shown, ctx, tot)}</div>${foot}`;
  // The trend chart sits between the dates and the table it summarises: pick the dates, see the shape, read the rows.
  const inView = (PX.q.trim() ? `“${PX.q.trim()}” · ` : '') + (PX.brand === 'ALL' ? 'Both brands' : BRAND_NAME[PX.brand] || PX.brand)
    + ' · ' + ctx.found.filter(e => !e.old && !e.solo && !e.disc).length.toLocaleString('en-US') + (PX.level === 'child' ? ' child ASINs' : ' parents');
  const chart = empty ? '' : pxChartCard(allAsins, ctx, inView);
  // The brand cards: "sold" covers the dates chosen (or every column, side by side).
  const bdates = cm ? pxColsDesc(PX.pc).toLowerCase() : PX.dkey === 'custom' ? pxFmtRange(ctx.span.lo, ctx.span.hi) : PX_DATES[PX.dkey][0].toLowerCase();
  const bcards = empty ? '' : `<div class="px-cap"><b>By brand</b><span>parents and child ASINs on this page · how many sold in ${pxEsc(bdates)}</span>`
    + pxI('brands', 'By brand', `<p>How many products each brand has on this page, split into <b>parents</b> (a product, all its sizes together — its Listing Health parent; a listing with none is its own parent) and <b>child ASINs</b> (each size or colour you can buy).</p>`
      + `<p>These are the same numbers as the table's “All N parents” / “All N child ASINs” row for that brand, with nothing searched. Both counts a parent shared by two brands once.</p>`
      + `<p><b>Sold</b>: how many of them sold at least one unit in <b>${pxEsc(cmpI.d)}</b> — the two bars fill with that share (parents, then children).</p>`
      + '<p><b>In Listing Health</b>: what the brand\'s catalogue holds (active = Amazon lists the size as Active). More there than here means products with no stored sales or ad figures.</p>'
      + '<p><b>Where a parent comes from</b>: Amazon\'s catalogue — the page asks it for every ASIN once a week (remembered in this browser). Until it has answered, Listing Health\'s parent is used; that one comes from the Catalog sheet and disagreed with Amazon on 246 ASINs on 13 Nov.</p>'
      + '<p><b>A parent is a family</b>: an Amazon parent with sizes under it. <b>Stand-alone listings</b> (Amazon gives them no parent) get their own row when they are in Listing Health or sold / were advertised in the last 30 days, and are counted apart. <b>Inactive or deleted listings</b>: every other ASIN with stored figures — dormant stand-alone listings and ASINs Amazon no longer knows. Neither is counted as a parent; their sales stay in every total (they were real orders).</p><p>Nothing is compared. Click a card to show only that brand.</p>')
    + `</div>${pxBrandCards(ctx.span, bdates)}`;
  const t0 = pxToday();
  const pcap = `<div class="px-cap"><b>Periods</b><span>fixed windows · click one to load its dates below</span>`
    + pxI('periods', 'The five period cards', '<p>Five fixed windows, always for the products in view (brand and search):</p><ul>'
      + PX_PCARDS.map(k => { const [a, b] = PX_DATES[k][1](t0); return `<li><b>${PX_DATES[k][0]}</b> — ${pxEsc(pxFmtRange(a, b))}${k === 'today' ? ', so far' : ''}</li>`; }).join('')
      + '</ul><p>Each shows sales; orders / units; PPC orders / PPC units (credited to an ad click); ACoS (ad spend ÷ ad sales) · TACoS (ad spend ÷ all sales).</p>'
      + '<p>They are not compared with anything — they are there to read side by side. Amazon\'s day runs on Pacific time (it starts at 1:30 pm IST in winter, 12:30 pm in summer), so <b>Today</b> fills in through the day, and its ad figures come with tonight\'s run.</p>'
      + '<p>Click a card and the totals, the table and the chart switch to its dates.</p>')
    + '</div>';
  // The end of the page: the chart, the trend lines, then What moved.
  const endSec = empty ? '' : `<section class="px-end" aria-label="Trends and what moved"><div class="px-sech"><b>Trends &amp; what moved</b><span>${pxEsc(inView)}</span>`
    + pxI('end', 'Trends & what moved', `<p>Three ways to see how things are moving for ${pxWhoTxt(ctx)}:</p><ul><li><b>Trend</b> — the chart: sales split into organic and ad sales, with ad spend and TACoS, around <b>${pxEsc(cmpI.d)}</b>.</li><li><b>The lines</b> — each total with its change ${cmpI.p ? 'against <b>' + pxEsc(cmpI.p) + '</b>' : '(nothing to compare with now)'} and its shape over the chart's bars.</li><li><b>What moved</b> — one finished week against the week before: the biggest falls and gains in dollars, and every product that fell 30%+ or ran ACoS 60%+.</li></ul><p>Each has its own (i).</p>`)
    + '</div>'
    + `<div class="px-card px-flush px-chartcard">${chart}</div>${trends}${pxAlertsCard(ctx)}</section>`;
  // With "Falling 30%+" on, say what to do with the list: every row's name and "Why?" open the breakdown.
  const hint = PX.chip === 'fall' && !empty ? `<div class="px-hint">${PW_IC.spark}<span><b>${filtered.length} product${filtered.length === 1 ? '' : 's'} fell 30%+.</b> Click a name or <b>Why?</b> to split the fall into traffic, conversion, price, ad spend, stock and Buy Box.</span></div>` : '';

  // --- draw ---
  pane.innerHTML = `<div class="px-main">
    <div class="px-ph"><div class="px-tb">${fresh}</div><span class="px-note">Click a product’s name for <b>Why did it move?</b> · press <kbd>/</kbd> to search · <button class="px-link" data-px="old" title="The retired PPC &amp; Organic screen, kept for the change-over">old view</button></span></div>
    <div class="px-card px-toolbar"><div class="px-tb">${viewSeg}<span class="px-vsep"></span>${brandSeg}${lvl}${search}${showBtn}<button class="px-btn" data-px="csv">Download</button></div>
      <div class="px-row2">${chips}</div>${PX.pop === 'show' ? pxShowPop() : ''}</div>
    ${bcards}${empty ? '' : pcap}${pxCards(allAsins)}${strip}${empty ? '' : pxRecsCard(ctx)}
    <div class="px-card px-flush">${hbar}${warn}${hint}${table}</div>
    ${endSec}</div>`;

  // --- restore the search text, the scroll position and the focus ---
  const q = $('pxQ');
  if (q) q.value = PX.q;
  if (sc && !PX.anim) {
    const t = pane.querySelector('.px-tw');
    if (t) {
      t.scrollLeft = sc[0];
      t.scrollTop = sc[1];
    }
  }
  PX.anim = false;
  pxWhyFit();
  const inl = pane.querySelector('.pw-inl');
  if (PX.whyAnim && inl) {
    // Bring the breakdown into view under the sticky toolbar, and put the keyboard on its close button.
    const bar = pane.querySelector('.px-toolbar'), top = (bar ? bar.getBoundingClientRect().height : 0) + 70;
    const r = inl.getBoundingClientRect();
    if (r.top < top || r.top > window.innerHeight - 160) window.scrollTo({ top: window.scrollY + r.top - top, behavior: 'smooth' });
    const x = inl.querySelector('.pw-x');
    if (x) x.focus({ preventScroll: true });
  }
  PX.whyAnim = false;
  pxInfoShow();
  pxSave();
  if (focusSel) {
    const el = pane.querySelector(focusSel);
    if (el) {
      el.focus();
      if (el.id === 'pxQ') el.setSelectionRange(el.value.length, el.value.length);
    }
  }
  pxStick();
}

/* The toolbar sticks under Sellora's menu bar. The bar's height is measured, not assumed: it wraps onto a
 * second line on narrower screens, and on phones it is a drawer (not sticky), so the toolbar goes to 0. */
// Set the toolbar's sticky offset to the menu bar's height, and mark it when it is stuck.
function pxStick() {
  const pane = $('panePpcn');
  if (!pane) return;
  const side = document.querySelector('.side');
  const top = side && getComputedStyle(side).position === 'sticky'
    ? Math.round(side.getBoundingClientRect().height) : 0;
  pane.style.setProperty('--px-top', top + 'px');
  const bar = pane.querySelector('.px-toolbar');
  if (bar) bar.classList.toggle('px-stuck',
    Math.round(bar.getBoundingClientRect().top) <= top + 1 && window.scrollY > 0);
}

/* ---------- download ---------- */
// Download: the rows on screen (search, filter and sort applied) as a CSV, in the shape of the current view.
function pxCsv() {
  const ctx = pxCtx();
  const list = pxSorted(ctx.found.filter(e => PX_FILTERS[PX.chip][1](e.st)), ctx);
  // A cell starting with = + - @ would be run as a formula by Excel / Sheets; a leading ' keeps it text.
  // Numbers are left alone (a negative "vs prev" is a number, not a formula).
  const sku = PX.level === 'child', q = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s) && isNaN(+s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const num = (v, d) => (v == null ? '' : (+v).toFixed(d));
  // --- header and rows, per view ---
  let head, rows;
  if (PX.mode === 'cols') {
    head = ['ASIN', 'Title'].concat(sku ? ['SKU'] : [])
      .concat(ctx.cols.map(c => PX_METRICS[PX.metric] + ' ' + c.lo + '..' + c.hi));
    rows = list.map(e => [e.key, e.title].concat(sku ? [e.sku] : [])
      .concat(ctx.cols.map(c => num(pxStats(e.asins, c)[PX.metric], 2))));
  } else {
    head = ['ASIN', 'Title'].concat(sku ? ['SKU'] : []).concat(['Sessions', 'Unit session %', 'Total orders', 'Units',
      'Sales', 'Ad spend', 'Ad sales', 'ROAS', 'Ad orders', 'Ad units',
      'Clicks', 'CPC', 'Conv. rate %', 'Organic units', 'Organic sales', 'Organic %', 'ACoS %', 'TACoS %', 'vs prev %']);
    rows = list.map(e => {
      const s = e.st;
      return [e.key, e.title].concat(sku ? [e.sku] : [])
        .concat([num(s.se, 0), num(s.usp, 1), num(s.o, 0), num(s.u, 0), num(s.rev, 2), num(s.spend, 2),
          num(s.adSales, 2), num(s.roas, 2), num(s.adO, 0), num(s.adU, 0),
          num(s.cl, 0), num(s.cpc, 2), num(s.cr, 1), num(s.ou, 0), num(s.os, 2), num(s.op, 1), num(s.acos, 1),
          num(s.tacos, 1), num(s.vp, 1)]);
    });
  }
  // --- download ---
  const csv = [head].concat(rows).map(r => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const [lo, hi] = PX.mode === 'cols' ? [ctx.cols[0].lo, ctx.cols[ctx.cols.length - 1].hi] : [ctx.span.lo, ctx.span.hi];
  a.download = `ppc-organic-${PX.level}-${lo}_${hi}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- wiring: one set of delegated listeners, attached once ---------- */
// Attach the page's listeners once: clicks (every button and sort header), keys, changes in the pop-ups, the
// search box, closing a pop-up from outside, and keeping the toolbar stuck.
function pxWire() {
  const pane = $('panePpcn');
  if (!pane || pane.dataset.wired) return;
  pane.dataset.wired = '1';
  const go = (anim, focus) => {
    if (anim) PX.anim = true;
    pxRender(focus);
  };
  // --- events: clicks ---
  pane.addEventListener('click', e => {
    const t = e.target.closest('button,[data-pxsort],[data-pxwhy],[data-pwclose],[data-pwback],[data-pxinfo]');
    if (!t || !pane.contains(t)) return;
    const d = t.dataset;
    // "Why did it move?": open on a product, close, or compare a different number of weeks
    // an (i): open its note, or close it when it is the one open
    if (d.pxinfo) {
      PX.info = PX.info === d.pxinfo ? null : d.pxinfo;
      return pxInfoShow();
    }
    if (d.pxwhy) {
      pwOpen(d.pxwhy, d.pxat || (t.closest('.px-alerts') ? 'moved' : 'table'));
      return go();
    }
    // Recommendations: one check's whole list, or back to its first six
    if (d.pxrecall) {
      PX.recAll.has(d.pxrecall) ? PX.recAll.delete(d.pxrecall) : PX.recAll.add(d.pxrecall);
      return go();
    }
    if (d.pwclose) {
      PX.why = null;
      return go();
    }
    if (d.pwback) {
      PX.why = Object.assign({}, PX.why, { key: PX.why.back, solo: PX.why.backSolo, back: null, backSolo: false });
      return go();
    }
    if (d.pwn) {
      PX.why.n = +d.pwn;
      PX.why.fit = false;
      return go();
    }
    // the toolbar, chips and cards
    if (d.pxmode) {
      if (d.pxmode !== PX.mode) {
        PX.mode = d.pxmode;
        PX.pop = null;
        PX.show = PX_PAGE;
        if (PX.sk.startsWith('c:') || PX.sk === 'chg') PX.sk = 'rev';
        go(true);
      }
      return;
    }
    if (d.pxbrand) {
      PX.brand = d.pxbrand;
      PX.show = PX_PAGE;
      return go();
    }
    if (d.pxlevel) {
      PX.level = d.pxlevel;
      PX.show = PX_PAGE;
      if (PX.sk === 'sku' && PX.level === 'parent') PX.sk = 'rev';
      return go(true);
    }
    if (d.pxdk) {
      PX.dkey = d.pxdk;
      PX.pop = null;
      return go(true);
    }
    if (d.pxcard) {
      PX.mode = 'range';
      PX.dkey = d.pxcard;
      PX.pop = null;
      if (PX.sk.startsWith('c:') || PX.sk === 'chg') PX.sk = 'rev';
      return go(true);
    }
    if (d.pxchip) {
      PX.chip = d.pxchip;
      PX.show = PX_PAGE;
      return go();
    }
    if (d.pxopen) {
      const k = d.pxopen;
      PX.open.has(k) ? PX.open.delete(k) : PX.open.add(k);
      return go();
    }
    if (d.pxset) {
      const s = PX_SETS.find(x => x[0] === d.pxset);
      PX.hide = s && s[2] ? PX_RCOLS.map(x => x[0]).filter(k => !s[2].includes(k)) : [];
      PX.pop = null;
      return go(true);
    }
    if (d.pxkn) {
      const cut = d.pxkn.lastIndexOf('|');
      PX.kidN[d.pxkn.slice(0, cut)] = +d.pxkn.slice(cut + 1);
      return go();
    }
    if (d.pxm) {
      PX.metric = d.pxm;
      if (PX.sk.startsWith('c:') || PX.sk === 'chg') PX.sk = 'rev';
      return go(true);
    }
    // the chart's Day / Week, and the "What moved" card's week
    if (d.pxgran) {
      PX.cgran = d.pxgran;
      return go();
    }
    if (d.pxaw) {
      PX.alertWk = +d.pxaw;
      PX.alertAll = false;
      return go();
    }
    if (d.pxsort) {
      const k = d.pxsort;
      if (PX.sk === k) PX.sd = -PX.sd;
      else {
        PX.sk = k;
        PX.sd = (k === 't' || k === 'sku') ? 1 : -1;
      }
      return go();
    }
    // the column builder's draft
    if (d.pxcp) {
      const p = PX_COLP.find(x => x[0] === d.pxcp);
      if (p[2]) Object.assign(PX.draft, { n: p[2], len: p[3], end: '', preset: p[0] });
      else {
        const cs = pxCols({ preset: p[0] });
        Object.assign(PX.draft, { n: cs.length, len: 7, end: cs[cs.length - 1][1], preset: p[0] });
      }
      return go();
    }
    if (d.pxdn) {
      PX.draft.n = Math.max(1, Math.min(12, PX.draft.n + +d.pxdn));
      PX.draft.preset = null;
      return go();
    }
    if (d.pxdl) {
      PX.draft.len = +d.pxdl;
      PX.draft.preset = null;
      return go();
    }
    // the pop-ups and the plain buttons
    switch (d.px) {
      case 'pop-date':
      case 'pop-cols':
      case 'pop-show': {
        const w = d.px.slice(4);
        if (PX.pop === w) {
          PX.pop = null;
          return go();
        }
        PX.pop = w;
        if (w === 'date') {
          const [lo, hi] = pxRange();
          PX.draft = { lo, hi };
        }
        if (w === 'cols') PX.draft = Object.assign({}, PX.pc);
        return go();
      }
      case 'split':
        PX.mode = 'cols';
        PX.pop = 'cols';
        PX.draft = Object.assign({}, PX.pc);
        if (PX.sk === 'vp') PX.sk = 'rev';
        return go(true);
      case 'cancel':
        PX.pop = null;
        return go();
      case 'applydate': {
        const a = PX.draft.lo, b = PX.draft.hi;
        if (a && b) {
          PX.lo = a <= b ? a : b;
          PX.hi = a <= b ? b : a;
          PX.dkey = 'custom';
        }
        PX.pop = null;
        return go(true);
      }
      case 'applycols':
        PX.pc = Object.assign({}, PX.draft);
        PX.pop = null;
        if (PX.sk.startsWith('c:')) PX.sk = 'rev';
        return go(true);
      case 'showall':
        PX.hide = [];
        return go();
      case 'more':
        PX.show += PX_PAGE;
        return go();
      case 'csv': return pxCsv();
      case 'chart':
        PX.chart = !PX.chart;
        return go();
      case 'alertall':
        PX.alertAll = !PX.alertAll;
        return go();
      case 'old': return showTab('weekly');
    }
  });
  // --- events: the Recommendations bar and its checks remember being open (toggle does not bubble: capture it) ---
  pane.addEventListener('toggle', e => {
    const el = e.target;
    if (!el || !el.classList) return;
    if (el.classList.contains('px-recdd')) PX.recOpen = el.open;
    else if (el.dataset && el.dataset.pxrecf) {
      if (el.open) PX.recF.add(el.dataset.pxrecf);
      else PX.recF.delete(el.dataset.pxrecf);
    }
  }, true);
  // --- events: the chart's hover card ---
  // One card, moved to whichever bar the mouse is over; the bars' own figures come from PX_CH (pxChartTip).
  pane.addEventListener('mouseover', e => {
    const hit = e.target.closest('[data-pxpt]'), wrap = hit && hit.closest('.px-ch-wrap');
    if (!wrap) return;
    const tip = wrap.querySelector('.px-ch-tip');
    pane.querySelectorAll('.px-ch-hit.on').forEach(x => x.classList.remove('on'));
    hit.classList.add('on');
    tip.innerHTML = pxChartTip(+hit.dataset.pxpt);
    tip.hidden = false;
    const r = hit.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const left = r.left - w.left + wrap.scrollLeft + r.width / 2;
    const flip = left + tip.offsetWidth + 24 > wrap.scrollLeft + wrap.clientWidth;
    tip.style.left = (flip ? left - tip.offsetWidth - 14 : left + 14) + 'px';
  });
  pane.addEventListener('mouseout', e => {
    const wrap = e.target.closest && e.target.closest('.px-ch-wrap');
    if (!wrap || wrap.contains(e.relatedTarget)) return;
    const tip = wrap.querySelector('.px-ch-tip');
    if (tip) tip.hidden = true;
    pane.querySelectorAll('.px-ch-hit.on').forEach(x => x.classList.remove('on'));
  });
  // --- events: keyboard on a sort header ---
  pane.addEventListener('keydown', e => {
    const t = e.target.closest('[data-pxsort]');
    if (t && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      t.click();
    }
  });
  // --- events: the pop-ups' inputs and checkboxes ---
  pane.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'pxFrom' && t.value) PX.draft.lo = t.value;
    if (t.id === 'pxTo' && t.value) PX.draft.hi = t.value;
    if (t.id === 'pxFrom' || t.id === 'pxTo') pxDateLive();
    // Draft only — no re-render here. Typing a number and then clicking Apply fires this change on blur, and a
    // re-render at that moment replaced the Apply button under the mouse, so the click was lost.
    if (t.id === 'pxLenIn') {
      PX.draft.len = Math.max(1, Math.min(90, Math.round(+t.value || 1)));
      PX.draft.preset = null;
    }
    if (t.id === 'pxEndIn' && t.value) {
      PX.draft.end = t.value;
      PX.draft.preset = null;
    }
    if (t.dataset.pxhide) {
      const k = t.dataset.pxhide;
      PX.hide = t.checked ? PX.hide.filter(x => x !== k) : PX.hide.concat(k);
      if (PX.hide.length >= PX_RCOLS.length) PX.hide = PX.hide.slice(1);   // never hide every column
      go();
    }
  });
  // --- events: the search box, after a short pause ---
  let qt = null;
  pane.addEventListener('input', e => {
    const id = e.target.id;
    if ((id === 'pxFrom' || id === 'pxTo') && e.target.value) {
      PX.draft[id === 'pxFrom' ? 'lo' : 'hi'] = e.target.value;
      return pxDateLive();
    }
    if (id !== 'pxQ') return;
    clearTimeout(qt);
    qt = setTimeout(() => {
      PX.q = e.target.value;
      PX.show = PX_PAGE;
      pxRender('#pxQ');
    }, 200);
  });
  // --- events: closing a pop-up from outside ---
  // A panel closes on a click outside it, or on Escape — it hangs over the work, so it does not linger.
  // Only the panel is taken away — no re-render: redrawing the pane on mousedown replaced whatever was under
  // the mouse (a sort header, Download), so the click that closed the panel never reached it.
  document.addEventListener('mousedown', e => {
    // an open (i) note goes on any click outside it (its own button toggles it in the click handler)
    if (PX.info && TAB_NOW === 'ppcn' && !e.target.closest('.px-ipop,.px-i,.px-ipop-x')) {
      PX.info = null;
      pxInfoShow();
    }
    if (!PX.pop || TAB_NOW !== 'ppcn') return;
    if (e.target.closest('.px-pop,[data-px^="pop-"],[data-px="split"]')) return;
    PX.pop = null;
    pane.querySelectorAll('.px-pop').forEach(el => el.remove());
    pane.querySelectorAll('[data-px^="pop-"][aria-expanded="true"]').forEach(el => el.setAttribute('aria-expanded', 'false'));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && PX.info && TAB_NOW === 'ppcn') {
      const id = PX.info;
      PX.info = null;
      pxInfoShow();
      const b = $('panePpcn').querySelector(`.px-i[data-pxinfo="${id}"]`);
      if (b) b.focus();
    } else if (e.key === 'Escape' && PX.pop && TAB_NOW === 'ppcn') {
      PX.pop = null;
      pxRender();
    } else if (e.key === 'Escape' && PX.why && TAB_NOW === 'ppcn') {
      PX.why = null;
      pxRender();
    }
    // "/" jumps to the search box, as in most tools with one — unless somebody is already typing somewhere.
    if (e.key === '/' && TAB_NOW === 'ppcn' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      const q = $('pxQ');
      if (q) {
        e.preventDefault();
        q.focus();
        q.select();
      }
    }
  });
  // --- events: keeping the toolbar stuck ---
  // The menu bar can change height (window resized, rotated) and the shadow follows scrolling.
  let st = 0;
  const restick = () => {
    if (TAB_NOW === 'ppcn' && !st) st = requestAnimationFrame(() => {
      st = 0;
      pxStick();
    });
  };
  window.addEventListener('resize', restick);
  window.addEventListener('resize', () => {
    if (TAB_NOW !== 'ppcn') return;
    pxWhyFit();
    if (PX.info) pxInfoShow();
  });
  window.addEventListener('scroll', restick, { passive: true });
}

// Called when the tab opens: wire once, draw, load Listing Health and the weekly store, read the orders and ad
// units caches (ten-minute throttle), draw again, start the pictures, then fold in last night's run.
async function ensurePpcn() {
  pxWire();
  PX.loading = true;
  pxRender();
  // --- load data ---
  if (!H_LOADED) await loadHealthCache();          // ASIN → brand, title, parent and SKU come from here
  PX_LOOK = null;
  PW_QTY = null;                                   // stock now, from the same Listing Health snapshot
  if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) await loadWeekly();
  // Orders and ad units: their own read of the nightly caches, same ten-minute throttle as wNightly.
  if (Date.now() - PXN.run > 600000) {
    try { await pxExtra(); } catch (e) { /* "—" until the next open */ }
  }
  PX.loading = false;
  pxRender();
  pxImages();                                       // pictures fill in when they arrive
  pxAmzFill();                                      // parents Listing Health does not know, from Amazon
  // --- last night's run ---
  // The day-by-day store lives in memory only and is filled by the nightly merge — the same call, and
  // the same ten-minute throttle, as the old tab, so opening both costs one merge, not two.
  if (!W_BUSY && Date.now() - W_NIGHT_RUN > 600000) {
    PX.msg = 'Bringing in last night’s figures…';
    pxRender();
    let from = '';
    try { from = await wNightly(); } catch (e) { /* whatever is stored stays on screen */ }
    PX.msg = '';
    if (TAB_NOW === 'ppcn') pxRender();          // (the old tab's WEEKLY.at is its own; not written here)
    pxAmzFill();                                  // ASINs the night added, if Listing Health does not know them
  }
}