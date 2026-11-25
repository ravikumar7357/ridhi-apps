/* ================= SALES · FORECAST: how many units each family will sell, and when its stock runs out (Sales card #5, 25 Nov 2026) =================
 * Screen: Sales → Check & alerts → "Forecast" (tab 'fcast', #paneFcast / #foPane, the drawer #foDr). Not on the Dashboard.
 * Does — per family (parent, its children inside — the SAME grouping as Sales Alerts: alGroupAdd) and per child (its SKUs):
 *   history   units per finished Sunday–Saturday week (US Pacific), 26 weeks: the nightly per-product days (dailyAsin, 45 days) for the
 *             weeks they hold whole, PPC & Organic's weekly store (the nightly "weekly" cache) before that — the numbers Numbers Check checks.
 *   skipped   out-of-stock / suppressed time is NOT low demand: in the daily weeks a run of zero days that a product selling λ a day would
 *             almost never have (≥ max(3, 3.9 ÷ λ) days, P < 2 %), or the last zero days when stock is 0 now, is taken out and the week's
 *             rate worked from its other days (3+ live days, else the week is skipped); an older week under 25 % of the product's usual
 *             week (usual ≥ 3 units) is skipped; a week the brand holds no figure for at all is missing, not zero. A family adds its
 *             children's rates, a child's skipped week counted at that child's usual rate.
 *   base      the last 8 weeks (skipped ones left out; 12 weeks back at most to find 4), weighted 8, 7, … 1 — last week counts most;
 *             a one-off spike above 2 × the usual week counts as 2 ×.
 *   season    the brand's own last year (the Sales Dashboard's 800-day history — Sellora keeps no per-product last year): the same week
 *             364 days back (3 weeks smoothed) ÷ last year's base weeks (same weights), capped 0.5×–2×, only when last year's base
 *             weeks sold ≥ 50 units a week; used for a product ONLY when it did not make its own blind test worse (≤ 1.15 × the error).
 *   trend     newest half of the base against the older half (season taken out), halved, capped ± 4 %/week, damped × 0.8 each week
 *             ahead — at most + 16 % ever, so the 90 days never run away.
 *   range     from the product's own BLIND TEST: the same model run from 8 weeks ago (data up to then only), the 8 weeks it did not see
 *             compared: 7 days = the weekly error (Σ|actual − forecast| ÷ Σ actual), 30 days = the 4-week blocks' error, 90 days = the
 *             larger of that and the whole 8 weeks' error × 1.25 (beyond what the test saw); never under 10 % nor under the counting
 *             noise of small numbers (1.28 ÷ √units). LOW–HIGH = likely × (1 ∓ error).
 *   gate      a forecast only with ≥ 8 weeks since the first sale AND ≥ 3 units a week — else "Not enough history". Confidence High
 *             ≤ 20 % (30-day error), Medium ≤ 40 %, Low above. A child with too few sales of its own takes its family's error (Low).
 *   children  add up to the family: each child's own forecast (or its usual rate in its family's shape), scaled week by week to the family's.
 *   reorder   stock = FBA units now (stock/{brand}, as Sales Alerts reads it; else the Inventory Age snapshot), missing = "No stock
 *             data", never a guess. Used up day by day from the stock's date at the HIGH end of the range (worst case: it sells fast);
 *             days of cover counted from today. ⛔ stock 0 and sold in the last 8 weeks · 🔴 cover < lead time · 🟡 < lead time + 30 ·
 *             🟢 OK · "Not selling" stock > 0 and ≤ 2 units in 8 weeks · hidden: stock 0 and no sale in 8 weeks (inactive). Lead time per
 *             brand, 60 days unless changed in ⚙ Settings (history/forecast, shared). A family wears its worst child's status, and its
 *             cover / runs out are that child's.
 * READS ONLY, through the existing read-only loaders (viLoad, alSdLoad, loadAgeCache, Sales Alerts' alLoad for its link): never an Amazon
 *   call, never a number on another screen. WRITES only the ⚙ settings (history/forecast, else this browser).
 * Main functions: foCompute (pure), foModel, foBacktest, foLoad, foFor, foRender, foDrawerOpen, forecastCheck (console). Every name
 *   starts with fo / FO. Tests: tests/forecast-test.js. */

const FO_M = { base: 8, minBase: 4, back: 12, spike: 2, oosWeek: 0.25, oosMinWeek: 3, deadP: 3.9, deadMin: 3, seasonLo: 0.5, seasonHi: 2,
  seasonMinWeek: 50, seasonWorse: 1.15, trendShrink: 0.5, trendCap: 0.04, damp: 0.8, gateWeeks: 8, gateUnits: 3, test: 8, floor: 0.1,
  far: 1.25, z: 1.28, high: 0.2, med: 0.4, notSelling: 2, hist: 26, ahead: 26, chartAhead: 13 };
const FO_DEF = { leadSP: 60, leadCPC: 60, soon: 30 };
const FO_SET = [
  ['leadSP', 'Ridhi lead time (days)', 'from ordering to stock selling at Amazon'],
  ['leadCPC', 'CPC lead time (days)', 'from ordering to stock selling at Amazon'],
  ['soon', 'Reorder soon window (days)', '🟡 when stock lasts under lead time + this'],
];
const FO_DOC = ['history', 'forecast'];                    // the ⚙ settings, shared (rules: history/{doc} — every Sales account)
const FO_LS = 'forecast.v1';                               // this browser's copy, when the shared one cannot be written
const FO_PAGE = 25;
const FO = { v: 0, busy: null, data: null, res: {}, brand: 'SP', q: '', chip: '', sort: { k: 'status', dir: 1 }, open: {}, shown: FO_PAGE, stockOnly: false,
  inactive: false, setOpen: false, dr: null, drFrom: null, drLy: true, chart: null, store: { settings: {} }, storeNote: '', msg: '', at: 0, started: false, counted: '', grown: '' };
const FO_BRAND = { SP: 'Ridhi', CPC: 'CPC', ALL: 'Both' };
// The statuses, most urgent first (rank = the order). Only these carry red / amber / green.
const FO_ST = {
  oos: { r: 0, i: '⛔', t: 'Out of stock — reorder now', c: 'Out of stock' },
  red: { r: 1, i: '🔴', t: 'Reorder now', c: 'Reorder now' },
  amber: { r: 2, i: '🟡', t: 'Reorder soon', c: 'Reorder soon' },
  green: { r: 3, i: '🟢', t: 'OK', c: 'OK' },
  nostock: { r: 4, i: '', t: 'No stock data', c: 'No stock data' },
  nohist: { r: 5, i: '⚪', t: 'Not enough history', c: 'Not enough history' },
  notsell: { r: 6, i: '', t: 'Not selling', c: 'Not selling' },
  inactive: { r: 7, i: '', t: 'Inactive', c: 'Inactive' },
};
const FO_CHIPS = ['oos', 'red', 'amber', 'green', 'nohist', 'notsell', 'nostock'];
const FO_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ----- small helpers (dates: US Pacific yyyy-MM-dd, the Sales Alerts helpers) ----- */
const foN = v => (v == null || !isFinite(v) ? '—' : AL_NF.format(Math.round(v)));
const foRng = (lo, hi) => `${foN(lo)}–${foN(hi)}`;
const foAvg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const foClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const foDiff = (a, b) => Math.round((alD(a) - alD(b)) / 864e5);           // days from b to a
const foPct = v => '±' + Math.round(v * 100) + '%';

/* ----- the brand's last year: units a week 364 days back, 3 weeks smoothed (null when last year is not held for it) ----- */
function foLyIndex(ly) {
  const memo = {};
  const week = wk => {
    if (!ly) return null;
    let s = 0;
    for (let i = 0; i < 7; i++) { const v = ly[alAdd(wk, i - 364)]; if (!v) return null; s += Number(v[1]) || 0; }
    return s;
  };
  return wk => {
    if (wk in memo) return memo[wk];
    const vs = [week(alAdd(wk, -7)), week(wk), week(alAdd(wk, 7))].filter(v => v != null);
    return (memo[wk] = vs.length >= 2 ? foAvg(vs) : null);
  };
}

/* ----- THE MODEL: s = weeks oldest → newest { wk, u (units), r (rate used), skip }, end = the last week it may see ----- */
function foModel(s, end, H, sIdx) {
  const M = FO_M;
  const cand = [];
  for (let i = end; i >= 0 && i > end - M.back; i--) if (!s[i].skip) cand.push(i);
  let use = cand.filter(i => i > end - M.base);
  if (use.length < M.minBase) use = cand.slice(0, M.minBase);
  if (use.length < M.minBase) return null;
  const med = alMedian(use.map(i => s[i].r));
  const rOf = i => (med > 0 ? Math.min(s[i].r, M.spike * med) : s[i].r);
  const wOf = i => Math.max(1, M.base - (end - i));
  const W = use.reduce((t, i) => t + wOf(i), 0);
  const level = use.reduce((t, i) => t + wOf(i) * rOf(i), 0) / W;
  // the season: last year's same weeks against last year's base weeks (same weights), only with enough sales last year
  const sw = sIdx ? use.map(i => sIdx(s[i].wk)) : [];
  const sBase = sIdx && sw.every(v => v != null) ? use.reduce((t, i, k) => t + wOf(i) * sw[k], 0) / W : null;
  const seasonOk = sBase != null && sBase >= M.seasonMinWeek;
  // the trend: the newest half against the older half, season taken out — halved, capped, damped
  const ds = use.map((i, k) => rOf(i) / (seasonOk ? sw[k] / sBase : 1));
  const half = Math.floor(use.length / 2);
  const nAge = foAvg(use.slice(0, half).map(i => end - i)), oAge = foAvg(use.slice(half).map(i => end - i));
  const rN = foAvg(ds.slice(0, half)), rO = foAvg(ds.slice(half));
  const gap = oAge - nAge;
  const gRaw = rN > 0 && rO > 0 && gap > 0 ? Math.pow(rN / rO, 1 / gap) - 1 : 0;
  const g = foClamp(M.trendShrink * gRaw, -M.trendCap, M.trendCap);
  const out = [];
  let cum = 0;
  for (let h = 1; h <= H; h++) {
    const wk = alAdd(s[end].wk, 7 * h);
    cum += g * Math.pow(M.damp, h);
    let f = 1, raw = null;
    if (seasonOk) { const v = sIdx(wk); if (v != null) { raw = v / sBase; f = foClamp(raw, M.seasonLo, M.seasonHi); } }
    out.push({ wk, f, raw, tr: 1 + cum, u: Math.max(0, level * f * (1 + cum)) });
  }
  return { level, med, use, weights: use.map(wOf), sBase, seasonOk, g, gRaw, out };
}
/** The blind test: the model from n weeks ago (n = 8, fewer with a short history, at least 4), against the n weeks it did not see. */
function foBacktest(s, hist, sIdx) {
  const end = s.length - 1, n = Math.min(FO_M.test, hist - FO_M.minBase);
  if (n < FO_M.minBase) return null;
  const o = end - n;
  const m = foModel(s, o, n, sIdx);
  if (!m) return null;
  const rows = m.out.map((f, h) => { const x = s[o + 1 + h]; return { wk: x.wk, f: f.u, a: x.skip ? null : x.r, skip: x.skip || '' }; });
  const ok = rows.filter(r => r.a != null);
  if (ok.length < 3) return null;
  const sumA = ok.reduce((t, r) => t + r.a, 0), sumF = ok.reduce((t, r) => t + r.f, 0);
  const rel = (a, f) => (a > 0 ? Math.abs(a - f) / a : f > 0 ? 1 : 0);
  const e7 = sumA > 0 ? ok.reduce((t, r) => t + Math.abs(r.a - r.f), 0) / sumA : sumF > 0 ? 1 : 0;
  const blocks = [];
  for (let j = 0; j + 4 <= rows.length; j++) {
    const b = rows.slice(j, j + 4).filter(r => r.a != null);
    if (b.length >= 3) blocks.push(rel(b.reduce((t, r) => t + r.a, 0), b.reduce((t, r) => t + r.f, 0)));
  }
  const e30 = blocks.length ? foAvg(blocks) : e7 / 2;
  const eTot = rel(sumA, sumF);
  return { n, from: rows[0].wk, rows, e7, e30, eTot, e90: Math.max(e30, eTot) * FO_M.far, bias: sumA > 0 ? sumF / sumA - 1 : 0, sumA, sumF };
}

/* ----- one child's weeks: units, the rate used, and what was skipped ----- */
function foStockOf(asin, b, o) {
  const s = o.stock && o.stock[b];
  if (s && s.m && s.skuOf && (s.skuOf[asin] || []).some(k => k in s.m)) {
    let n = 0; (s.skuOf[asin] || []).forEach(k => { if (k in s.m) n += Number(s.m[k]) || 0; });
    return { n, at: String(s.at || '').slice(0, 10), src: 'FBA stock' };
  }
  const a = o.age && o.age[b];
  const rows = a && a.rows ? a.rows.filter(r => String(r.asin || '').toUpperCase() === asin) : [];
  if (rows.length) return { n: rows.reduce((t, r) => t + (Number(r.available) || 0), 0), at: a.at ? String(a.at).slice(0, 10) : '', src: 'Inventory Age' };
  return null;
}
function foKid(asin, b, o, ctx) {
  const { weeks } = ctx;
  const row = o.weekly && o.weekly.rows ? o.weekly.rows[asin] : null;
  const byDay = o.days && o.days.d ? o.days.d[asin] : null;
  const dU = d => ((byDay && byDay[d]) || [0])[0] || 0;
  const inDaily = wk => !!byDay && ctx.dFrom && wk >= ctx.dFrom && alAdd(wk, 6) <= ctx.dUpTo;
  const s = weeks.map(wk => {
    if (inDaily(wk)) { let u = 0; for (let i = 0; i < 7; i++) u += dU(alAdd(wk, i)); return { wk, u, r: u, src: 'day', skip: '', dead: 0 }; }
    const c = row && row.weeks ? row.weeks[wk] : null;
    const u = c && c.u != null ? Number(c.u) || 0 : 0;
    return { wk, u, r: u, src: 'week', skip: '', dead: 0 };
  });
  const first = s.findIndex(x => x.u > 0);
  const hist = first < 0 ? 0 : s.length - first;
  const st = foStockOf(asin, b, o);
  const info = (o.kidInfo && o.kidInfo(asin, b)) || {};
  const skus = (info.skus || []).length ? info.skus : st && o.stock && o.stock[b] && o.stock[b].skuOf ? o.stock[b].skuOf[asin] || [] : [];
  // units in the last 8 finished weeks and the days after them (the "sold recently" test)
  let after = 0;
  if (byDay) for (let d = alAdd(weeks[weeks.length - 1], 7); d <= ctx.last; d = alAdd(d, 1)) after += dU(d);
  const u8 = s.slice(-8).reduce((t, x) => t + x.u, 0) + after;
  const k = { asin, brand: b, s, first, hist, u8, after, stock: st ? st.n : null, stockAt: st ? st.at : '', stockSrc: st ? st.src : '', skus, title: info.title || '' };
  if (first < 0) { s.forEach(x => { x.skip = 'pre'; }); return k; }
  const medAll = alMedian(s.slice(first).filter(x => ctx.held(b, x.wk)).map(x => x.u));
  const lam = alMedian(s.slice(Math.max(first, s.length - FO_M.back)).map(x => x.u)) / 7;
  // the dead days in the daily weeks: zero runs too long for this product's rate, and the last zero days when its stock is 0 now
  const dead = new Set();
  if (byDay && lam > 0) {
    const need = Math.max(FO_M.deadMin, Math.ceil(FO_M.deadP / lam));
    const from = ctx.dFrom > weeks[first] ? ctx.dFrom : weeks[first];
    let run = [];
    const flush = isEnd => { if (run.length >= need || (isEnd && st && st.n === 0 && run.length >= 2)) run.forEach(d => dead.add(d)); run = []; };
    for (let d = from; d <= ctx.dUpTo; d = alAdd(d, 1)) { if (dU(d) > 0) flush(false); else run.push(d); }
    flush(true);
  }
  k.deadDays = dead.size;
  s.forEach((x, i) => {
    if (i < first) { x.skip = 'pre'; return; }
    if (!ctx.held(b, x.wk)) { x.skip = 'missing'; return; }
    if (x.src === 'day') {
      let n = 0; for (let j = 0; j < 7; j++) if (dead.has(alAdd(x.wk, j))) n++;
      x.dead = n;
      if (n && 7 - n >= 3) x.r = x.u / (7 - n) * 7;
      else if (n) x.skip = 'oos';
      return;
    }
    if (medAll >= FO_M.oosMinWeek && x.u < FO_M.oosWeek * medAll) x.skip = 'oos';
  });
  return k;
}

/* ----- one forecast: the model now, its blind test (with and without the season), ranges, confidence ----- */
function foFit(s, hist, sIdx) {
  const M = FO_M;
  const pre = foModel(s, s.length - 1, 1, null);
  const level = pre ? pre.level : 0;
  if (hist < M.gateWeeks) return { ok: false, why: 'hist', level };
  if (level < M.gateUnits) return { ok: false, why: 'units', level };
  const btOn = sIdx ? foBacktest(s, hist, sIdx) : null, btOff = foBacktest(s, hist, null);
  const mOn = sIdx ? foModel(s, s.length - 1, M.ahead, sIdx) : null;
  // the season is used only when last year is held and it did not make this product's own blind test worse
  const tried = !!(mOn && mOn.seasonOk);
  const useSeason = tried && (!btOn || !btOff || btOn.e30 <= btOff.e30 * M.seasonWorse + 0.02);
  const m = useSeason ? mOn : foModel(s, s.length - 1, M.ahead, null);
  const bt = useSeason ? btOn : btOff;
  return { ok: true, level: m.level, m, bt, tried, useSeason, btOn, btOff };
}
/** Daily rate on a date from weekly forecasts that start the week after `L`. */
const foRateOn = (out, L, d) => { const h = Math.max(1, Math.round(foDiff(alSun(d), L) / 7)); const x = out[Math.min(h, out.length) - 1]; return x ? x.u / 7 : 0; };
function foSumDays(out, L, from, n) { let t = 0; for (let i = 0; i < n; i++) t += foRateOn(out, L, alAdd(from, i)); return t; }
// the error at a horizon (days), between the 7 / 30 / 90-day ones
function foErrAt(e, days) {
  if (days <= 7) return e[7];
  if (days <= 30) return e[7] + (e[30] - e[7]) * (days - 7) / 23;
  if (days <= 90) return e[30] + (e[90] - e[30]) * (days - 30) / 60;
  return e[90];
}
/** The 7 / 30 / 90-day numbers and the errors used for them (raw = the blind test's own, before the floors). */
function foRanges(out, L, today, bt, inherit) {
  const mid = {}, e = {}, r = {};
  [7, 30, 90].forEach(n => { mid[n] = foSumDays(out, L, today, n); });
  const raw = bt ? { 7: bt.e7, 30: bt.e30, 90: bt.e90 } : inherit ? { 7: inherit[7], 30: inherit[30], 90: inherit[90] } : { 7: 0.5, 30: 0.5, 90: 0.6 };
  const noise = n => (mid[n] > 0 ? FO_M.z / Math.sqrt(mid[n]) : 1);
  e[30] = Math.min(0.9, Math.max(raw[30], FO_M.floor, noise(30)));
  e[7] = Math.min(0.9, Math.max(raw[7], e[30], noise(7)));
  e[90] = Math.min(0.9, Math.max(raw[90], e[30], noise(90)));
  [7, 30, 90].forEach(n => { r[n] = { lo: mid[n] * (1 - e[n]), mid: mid[n], hi: mid[n] * (1 + e[n]) }; });
  return { r, e, raw };
}
const foConf = e30 => (e30 <= FO_M.high ? 'High' : e30 <= FO_M.med ? 'Medium' : 'Low');
/** Stock used up day by day from its date: { likely, high } = the days it lasts from today (null = beyond the half year), and the dates. */
function foCover(stock, stockAt, out, L, today, e) {
  if (stock == null) return null;
  const from = stockAt && stockAt <= today ? stockAt : today;
  const span = foDiff(alAdd(L, 7 * out.length + 6), from);
  let cum = 0, likely = null, high = null;
  if (stock <= 0) likely = high = 0;
  else for (let k = 1; k <= span; k++) {
    cum += foRateOn(out, L, alAdd(from, k - 1));
    if (high == null && cum * (1 + foErrAt(e, k)) >= stock) high = k;
    if (likely == null && cum >= stock) { likely = k; break; }
  }
  const left = k => (k == null ? null : Math.max(0, foDiff(alAdd(from, k), today)));
  const cv = { likely: left(likely), high: left(high), from };
  cv.outHigh = cv.high == null ? '' : alAdd(today, cv.high);
  cv.outLikely = cv.likely == null ? '' : alAdd(today, cv.likely);
  if (cv.high == null && cv.likely != null) { cv.high = cv.likely; cv.outHigh = cv.outLikely; }
  return cv;
}

/* ----- THE ENGINE (pure: everything comes in through o) ----- */
/** o = { weekly: {rows: asin→{brand, weeks: wk→{u}}}, days: {d: asin→day→[units, sales], brand: asin→b, from, upTo, at}, today (PT),
 *        brand 'SP'|'CPC'|'ALL', parentOf(asin, b), nameOf(parent, asin, b), stock: {b: {m: sku→units, at, skuOf: asin→[sku]}},
 *        age: {b: {rows: [{sku, asin, available}], at}}, kidInfo(asin, b) → {skus, title}, lyDaily: {b: day→[sales, units, orders]},
 *        settings: {leadSP, leadCPC, soon}, now }. */
function foCompute(o) {
  const S = Object.assign({}, FO_DEF, o.settings || {});
  const today = o.today, yest = alAdd(today, -1);
  const days = o.days || null;
  const W = o.weekly && o.weekly.rows;
  if (!W && !(days && days.d)) return { ok: false, why: 'The weekly sales per product are not read yet.' };
  const last = days && days.upTo && days.upTo < yest ? days.upTo : yest;
  const L = alDow(last) === 6 ? alSun(last) : alAdd(alSun(last), -7);       // the last finished Sunday week
  const weeks = []; for (let i = FO_M.hist - 1; i >= 0; i--) weeks.push(alAdd(L, -7 * i));
  const brands = o.brand === 'ALL' ? ['SP', 'CPC'] : [o.brand];
  // the weeks each brand holds any figure for: a week no product of the brand has is MISSING (not zero)
  const heldWk = { SP: new Set(), CPC: new Set() };
  const brandOf = {};
  Object.entries(W || {}).forEach(([a, r]) => { const b = (r && r.brand) || ''; if (!heldWk[b]) return; brandOf[a] = b; Object.entries((r && r.weeks) || {}).forEach(([wk, c]) => { if (c && Number(c.u) > 0) heldWk[b].add(wk); }); });
  if (days && days.d) Object.entries(days.d).forEach(([a, byDay]) => {
    const b = (days.brand && days.brand[a]) || brandOf[a] || '';
    if (!heldWk[b]) return;
    brandOf[a] = brandOf[a] || b;
    Object.entries(byDay || {}).forEach(([d, v]) => { if (v && Number(v[0]) > 0) heldWk[b].add(alSun(d)); });
  });
  const ctx = { weeks, last, L, today, dFrom: days && days.from ? days.from : '', dUpTo: days && days.upTo ? days.upTo : '', held: (b, wk) => heldWk[b].has(wk) };
  const lyIdx = { SP: o.lyDaily && o.lyDaily.SP ? foLyIndex(o.lyDaily.SP) : null, CPC: o.lyDaily && o.lyDaily.CPC ? foLyIndex(o.lyDaily.CPC) : null };
  // --- the families (the Sales Alerts grouping) ---
  const G = {};
  Object.keys(brandOf).forEach(a => {
    const b = brandOf[a];
    if (!brands.includes(b)) return;
    alGroupAdd(G, a, b, o).kids[a] = true;
  });
  const lead = b => Number(b === 'CPC' ? S.leadCPC : S.leadSP) || 60;
  const fams = Object.values(G).map(g => foFamily(g, o, ctx, lyIdx[g.brand], { lead: lead(g.brand), soon: Number(S.soon) || 0 }));
  // the whole view's blind test (families tested over 8 weeks): the headline's range and the page's accuracy
  const agg = {};
  fams.forEach(f => { if (f.fc && f.bt && f.bt.n === FO_M.test) f.bt.rows.forEach(r => { if (r.a == null) return; const x = agg[r.wk] || (agg[r.wk] = { a: 0, f: 0 }); x.a += r.a; x.f += r.f; }); });
  const aw = Object.keys(agg).sort().map(k => agg[k]);
  const blocks = []; for (let j = 0; j + 4 <= aw.length; j++) { const b = aw.slice(j, j + 4); const A = b.reduce((t, x) => t + x.a, 0), F = b.reduce((t, x) => t + x.f, 0); if (A > 0) blocks.push(Math.abs(A - F) / A); }
  const withFc = fams.filter(f => f.fc && f.active);
  const mid30 = withFc.reduce((t, f) => t + f.r[30].mid, 0);
  const eAgg = Math.max(blocks.length ? foAvg(blocks) : 0.15, 0.05);
  const accW = withFc.filter(f => f.bt).reduce((t, f) => t + f.r[30].mid, 0);
  const acc = accW ? withFc.filter(f => f.bt).reduce((t, f) => t + f.r[30].mid * f.bt.e30, 0) / accW : null;
  const stockAt = brands.map(b => (o.stock && o.stock[b] && String(o.stock[b].at || '').slice(0, 10)) || (o.age && o.age[b] && o.age[b].at ? String(o.age[b].at).slice(0, 10) : '')).filter(Boolean).sort()[0] || '';
  return { ok: true, brand: o.brand, settings: S, today, last, L, weeks, fams,
    head: { mid: mid30, lo: mid30 * (1 - eAgg), hi: mid30 * (1 + eAgg), e: eAgg, n: withFc.length, blocks: blocks.length },
    acc, asOf: { sales: last, run: (days && days.at) || (o.weekly && o.weekly.at) || '', stock: stockAt },
    seasonHeld: brands.some(b => !!lyIdx[b]) };
}
/** One family: its children's weeks added up, its forecast, then each child's share, stock, cover and status. */
function foFamily(g, o, ctx, sIdx, rule) {
  const kids = Object.keys(g.kids).map(a => foKid(a, g.brand, o, ctx));
  // a child's usual rate (its skipped weeks are counted at this in the family's weeks)
  kids.forEach(k => { const m = foModel(k.s, k.s.length - 1, 1, null); k.usual = m ? m.level : alMedian(k.s.filter(x => !x.skip).map(x => x.r)); });
  const s = ctx.weeks.map((wk, i) => {
    let u = 0, r = 0, live = 0, skipped = 0, part = 0, missing = 0;
    kids.forEach(k => {
      const x = k.s[i];
      u += x.u;
      if (x.skip === 'pre') return;
      if (x.skip === 'missing') { missing++; return; }
      if (x.skip === 'oos') { skipped++; r += k.usual || 0; return; }
      live++; r += x.r;
      if (x.dead) part++;
    });
    // kidsSkipped: children out the whole week (counted at their usual rate); kidsPart: children with stock-out days taken out
    return { wk, u, r, skip: !live ? (missing ? 'missing' : skipped ? 'oos' : 'pre') : '', kidsSkipped: live ? skipped : 0, kidsPart: part };
  });
  const first = s.findIndex(x => x.u > 0);
  const hist = first < 0 ? 0 : s.length - first;
  const fit = foFit(s, hist, sIdx);
  const f = { key: g.key, brand: g.brand, parent: g.parent, name: g.name || g.parent, kids, s, hist, fit, lead: rule.lead, soon: rule.soon, level: fit.level,
    skippedWeeks: s.filter((x, i) => i >= s.length - 16 && (x.skip === 'oos' || x.kidsSkipped || x.kidsPart)).length };
  f.fc = fit.ok;
  if (fit.ok) {
    f.m = fit.m; f.bt = fit.bt;
    const rg = foRanges(fit.m.out, ctx.L, ctx.today, fit.bt, null);
    f.r = rg.r; f.e = rg.e; f.eRaw = rg.raw; f.conf = foConf(rg.e[30]);
  }
  // --- the children: their own forecast where they have one, else their usual rate in the family's shape; then scaled to the family ---
  const shape = fit.ok ? fit.m.out.map(x => (fit.m.level > 0 ? x.u / fit.m.level : 1)) : null;
  kids.forEach(k => {
    k.fit = foFit(k.s, k.hist, sIdx);
    k.raw = shape ? (k.fit.ok ? k.fit.m.out.map(x => x.u) : shape.map(x => x * (k.usual || 0))) : null;
  });
  if (fit.ok) fit.m.out.forEach((x, h) => {
    const sum = kids.reduce((t, k) => t + k.raw[h], 0);
    const scale = sum > 0 ? x.u / sum : 0;
    kids.forEach(k => { (k.out || (k.out = []))[h] = { wk: x.wk, u: k.raw[h] * scale, f: x.f, tr: x.tr }; });
  });
  kids.forEach(k => {
    k.key = g.key + '#' + k.asin;
    k.label = k.skus[0] || k.asin;
    k.active = (k.stock != null && k.stock > 0) || k.u8 > 0;
    if (k.out) {
      const own = k.fit.ok && k.fit.bt;
      const rg = foRanges(k.out, ctx.L, ctx.today, own ? k.fit.bt : null, own ? null : f.eRaw);
      k.r = rg.r; k.e = rg.e; k.eRaw = rg.raw; k.conf = own ? foConf(rg.e[30]) : 'Low'; k.fromFam = !own;
      k.cover = foCover(k.stock, k.stockAt, k.out, ctx.L, ctx.today, k.e);
    }
    k.weekLoss = k.out ? k.out[0].u : k.usual || 0;
    k.status = foStatusOf(k, rule);
  });
  // --- the family: its worst child's status; its cover and run-out are that child's ---
  const act = kids.filter(k => k.active);
  f.active = act.length > 0;
  const known = kids.filter(k => k.stock != null);
  f.stock = known.length ? known.reduce((t, k) => t + k.stock, 0) : null;
  f.stockAt = known.map(k => k.stockAt).filter(Boolean).sort()[0] || '';
  f.stockPart = known.length && known.length < kids.length;
  const pool = act.length ? act : kids;
  const worst = pool.slice().sort((a, b) => FO_ST[a.status].r - FO_ST[b.status].r || foCovKey(a) - foCovKey(b))[0];
  f.status = f.active ? worst.status : 'inactive';
  if (f.status === 'nohist' && !fit.ok && fit.why === 'units' && f.stock > 0 && kids.every(k => k.u8 <= FO_M.notSelling)) f.status = 'notsell';
  f.first = ['red', 'amber', 'green', 'oos'].includes(worst.status) ? worst : null;
  f.cover = f.first && f.first.cover ? f.first.cover : f.first && f.first.status === 'oos' ? { likely: 0, high: 0, outHigh: ctx.today, outLikely: ctx.today } : null;
  f.oosKids = act.filter(k => k.status === 'oos');
  f.weekLoss = f.oosKids.reduce((t, k) => t + k.weekLoss, 0);
  f.counts = {};
  act.forEach(k => { f.counts[k.status] = (f.counts[k.status] || 0) + 1; });
  return f;
}
const foCovKey = k => (k.cover && k.cover.high != null ? k.cover.high : 1e9);
/** One child's status: ⛔ / 🔴 / 🟡 / 🟢 / No stock data / Not enough history / Not selling / inactive. */
function foStatusOf(k, rule) {
  if (!k.active) return 'inactive';
  if (k.stock === 0) return 'oos';
  if (k.stock != null && k.u8 <= FO_M.notSelling) return 'notsell';
  if (k.hist < FO_M.gateWeeks || !k.out) return 'nohist';
  if (k.stock == null) return 'nostock';
  const c = k.cover && k.cover.high;
  if (c != null && c < rule.lead) return 'red';
  if (c != null && c < rule.lead + rule.soon) return 'amber';
  return 'green';
}
/** The words for "not enough history". */
function foWhyNot(x) {
  const fit = x.fit || {};
  if (x.hist < FO_M.gateWeeks) return `Not enough history (${x.hist} week${x.hist === 1 ? '' : 's'})`;
  if (fit.why === 'units') return `Too few sales to forecast (${(Math.round((fit.level || 0) * 10) / 10)}/week)`;
  return 'Not enough history';
}

/* ----- loading (read-only) and the shared settings ----- */
const foMay = t => (typeof alMay === 'function' ? alMay(t) : true);
function foLsGet() { try { return JSON.parse(localStorage.getItem(FO_LS) || 'null') || null; } catch (e) { return null; } }
function foLsSet(v) { try { localStorage.setItem(FO_LS, JSON.stringify(v)); } catch (e) { /* this visit only */ } }
async function foStoreLoad() {
  const local = foLsGet() || { settings: {} };
  try {
    const snap = await getDoc(doc(db, FO_DOC[0], FO_DOC[1]));
    const s = snap.exists() ? snap.data() : {};
    FO.store = { settings: Object.assign({}, local.settings, s.settings || {}), setBy: s.setBy || '', setAt: s.setAt || 0 };
  } catch (e) { FO.store = Object.assign({ settings: {} }, local); FO.storeNote = 'Saved in this browser only (the shared copy could not be read).'; }
}
async function foStoreSave(patch) {
  foLsSet({ settings: patch.settings || {} });
  try { await setDoc(doc(db, FO_DOC[0], FO_DOC[1]), patch, { merge: true }); FO.storeNote = ''; }
  catch (e) { FO.storeNote = 'Saved in this browser only — the shared copy could not be written (' + ((e && e.code) || 'no access') + ').'; }
}
/** Load once per visit (force: Refresh): the per-product weeks and days and the stock (viLoad), last year (alSdLoad), the Inventory Age
 *  snapshot (a fallback for stock), the settings. */
function foLoad(force) {
  if (FO.busy) return FO.busy;
  if (FO.data && !force) return Promise.resolve(FO.data);
  FO.busy = (async () => {
    const data = { err: '' };
    const jobs = [];
    jobs.push((async () => { if (typeof viLoad === 'function') await viLoad(force); })().catch(e => { data.err = String((e && e.message) || e); }));
    jobs.push((typeof alSdLoad === 'function' ? alSdLoad() : Promise.resolve()).catch(() => {}));
    jobs.push((async () => { if (typeof AGE_LOADED !== 'undefined' && !AGE_LOADED && foMay('age') && typeof loadAgeCache === 'function') await loadAgeCache(); })().catch(() => {}));
    jobs.push(foStoreLoad());
    await Promise.all(jobs);
    FO.data = data;
    FO.res = {};
    FO.at = Date.now();
    FO.v++;
    return data;
  })().finally(() => { FO.busy = null; });
  return FO.busy;
}
// SKUs and a title per child ASIN: Listing Health's rows, else the Inventory Age snapshot.
function foKidInfoMaker() {
  const m = {};
  ['SP', 'CPC'].forEach(b => {
    const add = (asin, sku, title) => { const a = String(asin || '').toUpperCase(); if (!a || !sku) return; const x = m[b + '|' + a] || (m[b + '|' + a] = { skus: [], title: '' }); if (!x.skus.includes(sku)) x.skus.push(sku); if (!x.title && title) x.title = title; };
    ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(r => add(r.asin, r.sku, r.title));
    ((typeof AGE !== 'undefined' && AGE[b] && AGE[b].rows) || []).forEach(r => add(r.asin, r.sku, r.product));
  });
  return (asin, b) => m[b + '|' + asin] || null;
}
const foId = o => (typeof alId === 'function' ? alId(o) : String(o));
/** THE ONE RESULT for a view (SP, CPC, ALL): the page, the drawer, the CSV and forecastCheck all read this object. */
function foFor(brand) {
  if (!FO.data || typeof VI === 'undefined' || !VI.data) return null;
  const k = [brand, FO.v, VI.v, sdToday(), foId(VI.data), foId(VI.data.days), foId(VI.data.stock), foId(VI.data.weekly), typeof SD !== 'undefined' && SD ? SD.at + '|' + foId(SD.d) : '',
    typeof T_MATCH !== 'undefined' && T_MATCH ? foId(T_MATCH.biz) : '', typeof AGE !== 'undefined' ? foId(AGE.SP) + '|' + foId(AGE.CPC) : '', JSON.stringify(FO.store.settings || {})].join('@');
  if (FO.res[brand] && FO.res[brand].k === k) return FO.res[brand].r;
  let r;
  try {
    r = foCompute({ weekly: VI.data.weekly, days: VI.data.days, today: sdToday(), brand, parentOf: typeof wParentOf === 'function' ? a => wParentOf(a) : null,
      nameOf: typeof viNameOf === 'function' ? viNameOf : null, stock: VI.data.stock, age: typeof AGE !== 'undefined' ? AGE : null, kidInfo: foKidInfoMaker(),
      lyDaily: typeof SD !== 'undefined' && SD && SD.d && typeof sdDays === 'function' ? { SP: sdDays('SP'), CPC: sdDays('CPC') } : null, settings: FO.store.settings, now: Date.now() });
  } catch (e) { r = { ok: false, why: 'The forecast could not be worked out: ' + ((e && e.message) || e) }; }
  FO.res[brand] = { k, r };
  return r;
}

/* ----- THE PAGE ----- */
const foMotion = () => (typeof sdcFxSaved === 'function' ? sdcFxSaved() : true) && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const foIST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
/** "24 Nov 05:42 IST": the nightly run's own stamp (written in IST), else when the page read it. */
function foWhen(stamp, at) {
  const m = String(stamp || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${+m[3]} ${AL_MON[+m[2] - 1]} ${m[4]}:${m[5]} IST`;
  try { return foIST.format(new Date(at || Date.now())).replace(',', '') + ' IST'; } catch (e) { return ''; }
}
function foVisibleKids(f) {
  return f.kids.filter(k => (FO.inactive || k.active) && (!FO.stockOnly || (k.stock != null && k.stock > 0)));
}
function foShownFams(r) {
  const q = FO.q.trim().toLowerCase();
  return r.fams.filter(f => (FO.inactive || f.active) && (!FO.stockOnly || f.kids.some(k => k.stock != null && k.stock > 0))
    && (!q || (f.name + ' ' + f.parent + ' ' + f.kids.map(k => k.asin + ' ' + k.skus.join(' ') + ' ' + k.title).join(' ')).toLowerCase().includes(q)));
}
// sort keys (bigger = later); status: rank, then the soonest run-out
const FO_SORT = {
  status: x => FO_ST[x.status].r * 1e6 + (x.cover && x.cover.high != null ? x.cover.high : 9e5) - (x.status === 'oos' ? Math.min(9e5, x.weekLoss || 0) : 0),
  name: x => String(x.name || x.label || '').toLowerCase(),
  f30: x => (x.r ? -x.r[30].mid : 1), f7: x => (x.r ? -x.r[7].mid : 1), f90: x => (x.r ? -x.r[90].mid : 1),
  stock: x => (x.stock == null ? 1 : -x.stock), cover: x => (x.cover && x.cover.high != null ? x.cover.high : 9e5),
  out: x => (x.cover && x.cover.outHigh ? x.cover.outHigh : '9999'), conf: x => ({ High: 0, Medium: 1, Low: 2 }[x.conf] == null ? 3 : { High: 0, Medium: 1, Low: 2 }[x.conf]),
};
function foSorted(list) {
  const f = FO_SORT[FO.sort.k] || FO_SORT.status, d = FO.sort.dir;
  return list.slice().sort((a, b) => { const x = f(a), y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * d || FO_SORT.status(a) - FO_SORT.status(b) || String(a.name || '').localeCompare(String(b.name || '')); });
}
function foBarHtml() {
  const b = (v, t) => `<button type="button" data-fo-brand="${v}" aria-pressed="${FO.brand === v}">${t}</button>`;
  return `<header class="fo-bar"><h2 class="fo-title">Forecast</h2><div class="fo-seg" role="group" aria-label="Brand">${b('SP', 'Ridhi')}${b('CPC', 'CPC')}${b('ALL', 'Both')}</div>`
    + `<label class="fo-tog"><input type="checkbox" data-fo-stock${FO.stockOnly ? ' checked' : ''}> Stock &gt; 0 only</label>`
    + `<input type="search" class="fo-q" data-fo-q placeholder="Search family, SKU or ASIN" aria-label="Search family, SKU or ASIN" value="${alEsc(FO.q)}">`
    + `<span id="foMsg" class="muted" role="status">${alEsc(FO.msg)}</span>`
    + `<div class="fo-bar-r"><button type="button" class="fo-btn" data-fo-act="settings" aria-expanded="${FO.setOpen}" aria-controls="foSet">⚙ Settings</button>`
    + `<button type="button" class="fo-btn" data-fo-act="csv"${FO.data ? '' : ' disabled'}>⬇ CSV</button>`
    + `<button type="button" class="fo-btn" data-fo-act="refresh"${FO.busy ? ' disabled' : ''}>${FO.busy ? 'Reading…' : 'Refresh'}</button></div></header>`;
}
function foSetHtml(r) {
  const S = Object.assign({}, FO_DEF, FO.store.settings || {});
  const by = FO.store.setBy ? ` Last changed by ${alEsc(FO.store.setBy)} on ${alDay(new Date(FO.store.setAt).toISOString().slice(0, 10))}.` : '';
  return `<section class="fo-set" id="foSet"${FO.setOpen ? '' : ' hidden'} aria-label="Settings"><div class="fo-sets">${FO_SET.map(([k, t, h]) => `<label class="fo-setl"><span>${alEsc(t)}<small>${alEsc(h)}</small></span><input type="number" min="0" max="365" step="1" data-fo-set="${k}" value="${S[k]}"></label>`).join('')}</div>`
    + `<div class="fo-btns"><button type="button" class="fo-btn is-main" data-fo-act="save-set">Save</button><button type="button" class="fo-btn" data-fo-act="reset-set">Back to defaults</button></div>`
    + `<p class="fo-asof">Shared with everyone who opens Forecast.${by}${FO.storeNote ? ' ' + alEsc(FO.storeNote) : ''}</p></section>`;
}
function foHeroHtml(r) {
  const h = r.head;
  const when = foWhen(r.asOf.run, FO.at);
  return `<section class="fo-hero"><h2 class="fo-hl">Next 30 days: <span class="fo-cu" data-to="${Math.round(h.mid)}">~${foN(h.mid)}</span> units <span class="fo-hl-r">(${foRng(h.lo, h.hi)})</span></h2>`
    + `<p class="fo-sub">updated ${alEsc(when)} · Amazon data is 1–2 days late · sales up to ${alDay(r.last)} (US Pacific)${r.asOf.stock ? ' · stock as of ' + alDay(r.asOf.stock) : ' · no stock data'} · ${AL_NF.format(h.n)} famil${h.n === 1 ? 'y' : 'ies'} with enough history</p></section>`;
}
const foDot = st => `<i class="fo-dot st-${st}" aria-hidden="true"></i>`;
function foChipsHtml(r, shown) {
  const n = {}; shown.forEach(f => { n[f.status] = (n[f.status] || 0) + 1; });
  return `<div class="fo-chips" role="group" aria-label="Filter by status">${FO_CHIPS.filter(k => k !== 'nostock' || n.nostock).map(k => `<button type="button" class="fo-chip st-${k}" data-fo-chip="${k}" aria-pressed="${FO.chip === k}">`
    + `${FO_ST[k].i ? `<span aria-hidden="true">${FO_ST[k].i}</span>` : foDot(k)} ${FO_ST[k].c} <b class="num">${AL_NF.format(n[k] || 0)}</b></button>`).join('')}</div>`;
}
/** A small sparkline: the last 12 weeks (solid) and the next 8 forecast (dotted). */
function foSparkSvg(x, w, h) {
  const past = x.s.slice(-12).map(p => p.u), fut = x.m ? x.m.out.slice(0, 8).map(p => p.u) : x.out ? x.out.slice(0, 8).map(p => p.u) : [];
  const all = past.concat(fut), max = Math.max(1, ...all);
  const X = i => (i / (all.length - 1 || 1)) * (w - 4) + 2, Y = v => h - 3 - (v / max) * (h - 6);
  const line = (arr, off) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i + off).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  return `<svg class="fo-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path class="fo-sp-a" d="${line(past, 0)}"/>`
    + (fut.length ? `<path class="fo-sp-f" d="${line([past[past.length - 1]].concat(fut), past.length - 1)}"/>` : '') + '</svg>';
}
function foActHtml(r, shown) {
  const top = foSorted(shown.filter(f => f.status === 'oos' || f.status === 'red')).slice(0, 3);
  if (!top.length) return `<section class="fo-sec fo-act"><p class="fo-allok">✅ Nothing needs reordering now</p></section>`;
  const card = f => {
    const c = f.cover;
    const line = f.status === 'oos' ? 'Out of stock now'
      : `Runs out ~${alDay(c.outHigh)}`;
    const sub = f.status === 'oos' ? `${f.oosKids.length > 1 ? f.oosKids.length + ' SKUs' : f.oosKids[0] ? alEsc(f.oosKids[0].label) : ''} · losing ~${foN(f.weekLoss)} units/week · new stock takes ${f.lead} days`
      : `${foN(c.high)} days of stock vs ${f.lead}-day lead time${f.first && f.kids.length > 1 ? ` · first: ${alEsc(f.first.label)}` : ''}`;
    return `<article class="fo-card st-${f.status}"><div class="fo-card-h"><span class="fo-sev st-${f.status}">${FO_ST[f.status].i} ${FO_ST[f.status].t}</span><span class="muted">${FO_BRAND[f.brand]}</span></div>`
      + `<h4 class="fo-card-n">${alEsc(alShort(f.name))}</h4><div class="fo-card-big">${line}</div><p class="fo-card-s">${sub}</p>`
      + `<div class="fo-card-f">${f.m ? foSparkSvg(f, 140, 36) : ''}<button type="button" class="fo-btn" data-fo-view="${alEsc(f.key)}" aria-label="View ${alEsc(f.name)}">View</button></div></article>`;
  };
  return `<section class="fo-sec fo-act"><div class="fo-sec-h"><h3>Act first</h3><span class="muted">soonest to run out</span></div><div class="fo-cards">${top.map(card).join('')}</div></section>`;
}
/** The range bar: a thin bar LOW–HIGH with a dot at the most likely, and the numbers. */
function foRangeHtml(x, n) {
  const v = x.r[n], max = v.hi * 1.15 || 1;
  const pc = t => (Math.max(0, Math.min(1, t / max)) * 100).toFixed(1);
  return `<div class="fo-rb${x.conf === 'Low' ? ' is-low' : ''}" role="img" aria-label="Next ${n} days: likely ${foN(v.mid)}, between ${foN(v.lo)} and ${foN(v.hi)}">`
    + `<span class="fo-rb-t"><span class="fo-rb-b" style="left:${pc(v.lo)}%;width:${(pc(v.hi) - pc(v.lo)).toFixed(1)}%"></span><span class="fo-rb-d" style="left:${pc(v.mid)}%"></span></span>`
    + `<span class="fo-rb-n num"><b>${foN(v.mid)}</b><small>${foRng(v.lo, v.hi)}</small></span></div>`;
}
const foCoverTxt = c => (!c || c.high == null ? (c ? '180+' : '—') : `${foN(c.high)}${c.likely != null && c.likely !== c.high ? `<small>likely ${foN(c.likely)}</small>` : c.likely == null ? '<small>likely 180+</small>' : ''}`);
function foRowHtml(x, isKid, fam) {
  const st = x.status, key = isKid ? x.key : x.key;
  const has = !!x.r;
  const open = !isKid && !!FO.open[x.key];
  const vk = isKid ? [] : foVisibleKids(x);
  const nameCell = isKid
    ? `<span class="fo-nm">${alEsc(x.label)}</span><small>${alEsc(x.asin)}${x.skus.length > 1 ? ' · +' + (x.skus.length - 1) + ' SKU' : ''}${x.title ? ' · ' + alEsc(alShort(x.title)) : ''}</small>`
    : `<span class="fo-nm">${alEsc(alShort(x.name))}</span><small>${alEsc(x.parent)} · ${x.kids.length === 1 ? alEsc(x.kids[0].label) : x.kids.length + ' SKUs'}${x.first && x.kids.length > 1 && ['oos', 'red', 'amber'].includes(st) ? ` · ${st === 'oos' ? 'out' : 'first'}: ` + alEsc(st === 'oos' && x.oosKids.length > 1 ? x.oosKids.length + ' SKUs' : x.first.label) : ''}${FO.brand === 'ALL' ? ' · ' + FO_BRAND[x.brand] : ''}</small>`;
  const nohist = !has && st !== 'oos' && st !== 'notsell' && st !== 'inactive';
  const mid = has ? `<td class="fo-c-r" data-l="Next 30 days">${foRangeHtml(x, 30)}</td><td class="num" data-l="7 days">${foN(x.r[7].mid)}<small>${foRng(x.r[7].lo, x.r[7].hi)}</small></td><td class="num" data-l="90 days">${foN(x.r[90].mid)}<small>${foRng(x.r[90].lo, x.r[90].hi)}</small></td>`
    : `<td class="fo-c-r fo-why" data-l="Next 30 days" colspan="3">${st === 'oos' ? `Out of stock — losing ~${foN(x.weekLoss)} units/week` : st === 'notsell' ? 'Not selling — stock but almost no sales in 8 weeks' : st === 'inactive' ? 'Inactive — no stock, no sale in 8 weeks' : alEsc(foWhyNot(x))}</td>`;
  const cov = x.cover;
  const stock = x.stock == null ? '<span class="muted">No stock data</span>' : foN(x.stock) + (x.stockPart ? '<small>some SKUs unknown</small>' : '');
  return `<tr class="fo-r ${isKid ? 'is-kid' : 'is-fam'} st-${st}${nohist ? ' is-grey' : ''}${has && x.conf === 'Low' ? ' is-low' : ''}" data-fo-row="${alEsc(key)}" tabindex="0"${isKid ? '' : ` aria-expanded="${open}"`}>`
    + `<td class="fo-c-x">${!isKid && vk.length > 1 ? `<button type="button" class="fo-x" data-fo-exp="${alEsc(x.key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${vk.length} SKU${vk.length === 1 ? '' : 's'}">${open ? '▾' : '▸'}</button>` : ''}</td>`
    + `<td class="fo-c-n" data-l="">${nameCell}</td>${mid}`
    + `<td class="num" data-l="Stock">${stock}</td><td class="num" data-l="Cover (days)"${cov && cov.high != null ? ` title="Stock lasts ${foN(cov.high)}–${cov.likely == null ? '180+' : foN(cov.likely)} days (${foN(cov.high)} if sales are high)"` : ''}>${has || st === 'oos' ? foCoverTxt(cov) : '—'}</td>`
    + `<td data-l="Runs out"${cov && cov.outLikely && cov.outLikely !== cov.outHigh ? ` title="~${alDay(cov.outHigh)} if sales are high, ~${alDay(cov.outLikely)} most likely"` : ''}>${cov && cov.outHigh ? (st === 'oos' ? 'Now' : '~' + alDay(cov.outHigh)) : cov && cov.high == null ? 'after ' + alDay(alAdd(sdTodaySafe(), 180)) : '—'}</td>`
    + `<td class="fo-c-s" data-l="Status">${foDot(st)}<span>${alEsc(FO_ST[st].c)}</span></td>`
    + `<td data-l="Confidence">${has ? `<span class="fo-pill is-${x.conf}">${x.conf}${x.conf === 'Low' ? ' confidence' : ''}</span>${isKid && x.fromFam ? '<small>from family</small>' : ''}` : '—'}</td></tr>`;
}
const sdTodaySafe = () => (typeof sdToday === 'function' ? sdToday() : new Date().toISOString().slice(0, 10));
function foTableHtml(r, shown) {
  const list = foSorted(FO.chip ? shown.filter(f => f.status === FO.chip) : shown);
  const cols = [['', '', ''], ['name', 'Family', ''], ['f30', 'Next 30 days', ''], ['f7', '7 days', 'num'], ['f90', '90 days', 'num'], ['stock', 'Stock', 'num'], ['cover', 'Cover (days)', 'num'], ['out', 'Runs out', ''], ['status', 'Status', ''], ['conf', 'Confidence', '']];
  const th = ([k, t, c]) => (!k ? '<th class="fo-c-x" scope="col"><span class="fo-sr">Expand</span></th>'
    : `<th scope="col" class="${c}" aria-sort="${FO.sort.k === k ? (FO.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-fo-sort="${k}">${t}${FO.sort.k === k ? (FO.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`);
  const rows = list.slice(0, FO.shown).map(f => foRowHtml(f, false) + (FO.open[f.key] ? foSorted(foVisibleKids(f).map(k => Object.assign(k, { name: k.label }))).map(k => foRowHtml(k, true, f)).join('') : '')).join('');
  const hidden = r.fams.filter(f => !f.active).length;
  const more = list.length > FO.shown ? `<button type="button" class="fo-btn" data-fo-act="more">Show more (${AL_NF.format(list.length - FO.shown)} more)</button>` : '';
  const title = FO.chip ? `${FO_ST[FO.chip].c}` : 'All families';
  return `<section class="fo-sec" id="foList"><div class="fo-sec-h"><h3>${alEsc(title)} <span class="muted num">${AL_NF.format(list.length)}</span></h3>`
    + `<div class="fo-filters">${FO.chip ? '<button type="button" class="fo-btn" data-fo-chip="">Show all</button>' : ''}${hidden ? `<button type="button" class="fo-link" data-fo-act="inactive" aria-pressed="${FO.inactive}">${FO.inactive ? 'Hide' : 'Hidden:'} ${AL_NF.format(hidden)} inactive</button>` : ''}</div></div>`
    + (list.length ? `<div class="fo-tw"><table class="fo-tbl"><thead><tr>${cols.map(th).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="muted fo-empty">${FO.q ? `No family matches “${alEsc(FO.q)}”.` : FO.chip ? `No family is “${FO_ST[FO.chip].c}”.` : 'No families to show.'}</p>`)
    + (more ? `<div class="fo-more">${more}</div>` : '') + '</section>';
}
function foTrustHtml(r) {
  return `<footer class="fo-trust"><h3>How this forecast works</h3><ol>`
    + `<li>Each family's usual week = its last 8 weeks, the newest counting most — weeks it was out of stock or suppressed are skipped, so a stock-out never reads as low demand.</li>`
    + `<li>Last year's same weeks for the brand lift or lower it (never more than 2× or under ½×), plus a small, damped trend; every product is first tested blind on its last 8 weeks, and that test sets how wide its range is.</li>`
    + `<li>Stock is used up at the HIGH end of the range: 🔴 when it lasts less than the lead time (Ridhi ${Number(r.settings.leadSP)} days, CPC ${Number(r.settings.leadCPC)} days), 🟡 within ${Number(r.settings.soon)} days after.</li></ol>`
    + `<p class="fo-acc">Accuracy last 8 weeks: <b class="num">${r.acc == null ? '—' : foPct(r.acc)}</b> <span class="muted">(a family's 30-day total against what it really sold, tested blind)${r.head.blocks ? ` · whole ${FO_BRAND[r.brand]} ${foPct(r.head.e)}` : ''}</span></p>`
    + `<p class="fo-asof">Sales up to ${alDay(r.last)} · weekly history ${alDay(r.weeks[0])}–${alDay(alAdd(r.L, 6))}${r.seasonHeld ? '' : ' · last year not held: no season'} · Shopify is not in the forecast · forecastCheck('name') in the console shows every number</p></footer>`;
}
function foSkelHtml() {
  const rows = Array.from({ length: 8 }, () => '<div class="fo-sk fo-sk-row"></div>').join('');
  return `<section class="fo-hero" aria-busy="true"><div class="fo-sk fo-sk-hl"></div><div class="fo-sk fo-sk-sub"></div></section><div class="fo-chips">${Array.from({ length: 5 }, () => '<span class="fo-sk fo-sk-chip"></span>').join('')}</div>`
    + `<section class="fo-sec"><div class="fo-cards">${Array.from({ length: 3 }, () => '<div class="fo-sk fo-sk-card"></div>').join('')}</div></section><section class="fo-sec"><div class="fo-sk-tbl">${rows}</div></section><p class="fo-sr" role="status">Reading the weekly sales and stock…</p>`;
}
/** Draw the page. */
function foRender() {
  const root = typeof document !== 'undefined' && document.getElementById ? document.getElementById('foPane') : null;
  if (!root) return;
  foStart();
  const motion = foMotion();
  const r = foFor(FO.brand);
  let body;
  if (!r) body = FO.busy || !FO.data ? foSkelHtml() : `<section class="fo-hero"><h2 class="fo-hl">The sales history could not be read.</h2><p class="fo-sub">${alEsc((FO.data && FO.data.err) || 'Try Refresh.')}</p></section>`;
  else if (!r.ok) body = `<section class="fo-hero"><h2 class="fo-hl">${alEsc(r.why)}</h2><p class="fo-sub">Try Refresh — nothing on the page is a guess.</p></section>`;
  else {
    const shown = foShownFams(r);
    body = foHeroHtml(r) + foChipsHtml(r, shown) + foActHtml(r, shown) + foTableHtml(r, shown) + foTrustHtml(r);
  }
  const first = r && r.ok && FO.grown !== FO.v + '|' + FO.brand;
  root.innerHTML = `<div class="fo${motion && first ? ' fo-mo' : ''}">${foBarHtml()}${foSetHtml(r)}${body}</div>`;
  if (first) FO.grown = FO.v + '|' + FO.brand;
  foStick();
  foCountUp(root, motion);
  if (FO.dr) foDrawerPaint();
}
// The bar sticks under the app's menu bar (when that one is sticky), the table head under the bar.
function foStick() {
  const pane = document.getElementById('paneFcast');
  if (!pane || !pane.style || typeof getComputedStyle !== 'function') return;
  const side = document.querySelector('.side'), bar = pane.querySelector('.fo-bar');
  const top = side && getComputedStyle(side).position === 'sticky' ? side.offsetHeight : 0;
  pane.style.setProperty('--fo-top', top + 'px');
  if (bar && bar.offsetHeight) pane.style.setProperty('--fo-bar', bar.offsetHeight + 'px');
}
// The headline counts up once per data version (✨ on, no reduced motion); the final number is always set (1.5 s safety net).
function foCountUp(root, motion) {
  const el = root.querySelector('.fo-cu');
  if (!el) return;
  const to = Number(el.dataset.to) || 0, fin = '~' + foN(to), tag = FO.v + '|' + FO.brand;
  if (!motion || FO.counted === tag || typeof requestAnimationFrame !== 'function') { el.textContent = fin; FO.counted = tag; return; }
  FO.counted = tag;
  const t0 = Date.now(), dur = 900;
  const step = () => { if (!el.isConnected) return; const p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = '~' + foN(to * e); if (p < 1) requestAnimationFrame(step); else el.textContent = fin; };
  el.textContent = '~0';
  requestAnimationFrame(step);
  setTimeout(() => { el.textContent = fin; }, 1500);
}

/* ----- the drawer (a bottom sheet on a phone) ----- */
function foFind(key) {
  const r = foFor(FO.brand);
  if (!r || !r.ok) return null;
  const [fk, asin] = String(key).split('#');
  const f = r.fams.find(x => x.key === fk);
  if (!f) return null;
  return asin ? { x: f.kids.find(k => k.asin === asin) || null, fam: f, r } : { x: f, fam: f, r };
}
/** The story, from the numbers only: usual week, season, stock against the lead time. */
function foStory(x, fam) {
  const out = [];
  const m = fam.m;
  if (x.r) out.push(`Usually sells ~${foN((x.m ? x.m.level : x.r[30].mid / 30 * 7))}/week.`);
  if (m) {
    const ahead = m.out.slice(0, FO_M.chartAhead);
    const peak = ahead.reduce((a, b) => (b.f > a.f ? b : a), ahead[0]), low = ahead.reduce((a, b) => (b.f < a.f ? b : a), ahead[0]);
    const mon = wk => { const d = alD(alAdd(wk, 3)); return d.getUTCMonth() === 11 && d.getUTCDate() <= 26 ? 'Christmas' : d.getUTCMonth() === 10 && d.getUTCDate() >= 20 ? 'Black Friday week' : 'mid-' + FO_MON[d.getUTCMonth()]; };
    if (!m.seasonOk) out.push(fam.fit.tried ? 'Last year\'s pattern made this family\'s blind test worse, so no season is used.' : 'No season used — last year is not held for these weeks.');
    else if (peak.f >= 1.15) out.push(`${mon(peak.wk)[0].toUpperCase() + mon(peak.wk).slice(1)} usually lifts ${FO_BRAND[fam.brand]} ~${peak.f.toFixed(1)}× (last year's brand pattern).`);
    else if (low.f <= 0.85) out.push(`Sales usually ease to ~${low.f.toFixed(1)}× in ${mon(low.wk)} (last year's brand pattern).`);
    else out.push('No big seasonal swing in the next 13 weeks.');
    if (Math.abs(m.g) >= 0.01) out.push(`Recent weeks lean ${m.g > 0 ? 'up' : 'down'} (${m.g > 0 ? '+' : '−'}${Math.round(Math.abs(m.g) * 100)}%/week, fading).`);
  }
  const c = x.cover;
  if (x.status === 'oos') out.push(`Out of stock now — losing ~${foN(x.weekLoss)} units/week; new stock takes ${fam.lead} days → reorder now.`);
  else if (c && c.high != null) out.push(`${x === fam && fam.kids.length > 1 && x.first ? `${x.first.label} runs out first: its stock` : 'Stock'} lasts ~${foN(c.high)} days, ${x.status === 'green' ? 'and' : 'but'} new stock takes ${fam.lead} → ${x.status === 'red' ? 'reorder now' : x.status === 'amber' ? 'reorder soon' : 'fine for now'}.`);
  else if (c) out.push(`Stock lasts beyond half a year at this pace — fine for now.`);
  else if (x.stock == null) out.push('No stock data for it — Sellora does not guess.');
  return out.join(' ');
}
function foTile(t, v, sub) { return `<div class="fo-tile"><span>${t}</span><b class="num">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`; }
function foAlertOf(fam) {
  try {
    if (typeof alFor !== 'function' || typeof AL === 'undefined' || !AL.data || !foMay('salert')) return null;
    const r = alFor(fam.brand);
    if (!r || !r.ok) return null;
    return [].concat(r.alerts, r.review, r.waiting).find(a => a.key === fam.key) || null;
  } catch (e) { return null; }
}
function foDrawerHtml(h) {
  const { x, fam } = h, isKid = x !== fam;
  const name = isKid ? `${x.label}` : x.name;
  const pill = x.r ? `<span class="fo-pill is-${x.conf}">${x.conf} confidence</span>` : '';
  const c = x.cover;
  const tiles = x.r ? [7, 30, 90].map(n => foTile(`${n} days`, foN(x.r[n].mid), foRng(x.r[n].lo, x.r[n].hi))).join('') : '';
  const coverT = x.status === 'oos' ? foTile('Cover', '0 days', isKid ? 'out of stock now' : `${alEsc(x.oosKids.length > 1 ? x.oosKids.length + ' SKUs' : (x.first || {}).label || '')} out of stock`) : c ? (c.high == null ? foTile('Cover', '180+ days', 'more than half a year') : foTile('Cover', `${foN(c.high)}–${c.likely == null ? '180+' : foN(c.likely)} days`, `${foN(c.high)} if sales are high`)) : foTile('Cover', '—', x.stock == null ? 'no stock data' : '');
  const outT = c && c.outHigh ? foTile('Runs out', x.status === 'oos' ? 'Now' : '~' + alDay(c.outHigh), c.outLikely && c.outLikely !== c.outHigh ? `~${alDay(c.outLikely)} most likely` : '') : foTile('Runs out', c ? 'after ' + alDay(alAdd(sdTodaySafe(), 180)) : '—', '');
  const stockT = foTile('Stock', x.stock == null ? 'No data' : foN(x.stock), x.stock == null ? 'never guessed' : `${alEsc(isKid ? x.stockSrc : 'all SKUs')}${x.stockAt ? ' · ' + alDay(x.stockAt) : ''}`);
  const bt = isKid ? (x.fit && x.fit.bt) : fam.bt;
  const skipped = isKid ? x.s.slice(-16).filter(w => w.skip === 'oos' || w.dead).length : fam.skippedWeeks;
  const why = x.r ? `<ul class="fo-why-l"><li>History: <b>${x.hist >= FO_M.hist ? FO_M.hist + '+' : x.hist} weeks</b> since the first sale (${FO_M.gateWeeks} needed)</li>`
    + (bt ? `<li>Blind test (${bt.n} weeks from ${alDay(bt.from)}): 30-day error <b>${foPct(bt.e30)}</b>, weekly ${foPct(bt.e7)}, it ${bt.bias >= 0 ? 'over' : 'under'}-forecast by ${Math.round(Math.abs(bt.bias) * 100)}% in total</li>`
      : `<li>Too few sales of its own for a blind test — the family's error is used (${foPct(fam.e[30])})</li>`)
    + `<li>Range used: ${foPct(x.e[7])} (7 d) · ${foPct(x.e[30])} (30 d) · ${foPct(x.e[90])} (90 d) — never under ${Math.round(FO_M.floor * 100)}% nor the counting noise of small numbers</li>`
    + `<li>Stock-out or suppressed weeks skipped (last 16 weeks): <b>${skipped}</b></li>`
    + `<li>Season: ${fam.m && fam.m.seasonOk ? 'used (the brand\'s last year)' : fam.fit.tried ? 'not used — it made the blind test worse' : 'not held'} · trend ${fam.m ? (fam.m.g >= 0 ? '+' : '−') + (Math.round(Math.abs((isKid && x.fit.ok ? x.fit.m.g : fam.m.g)) * 1000) / 10) + '%/week, damped' : '—'}</li></ul>`
    : `<p class="fo-note">${alEsc(x.status === 'oos' ? `Out of stock — losing ~${foN(x.weekLoss)} units/week` : foWhyNot(x))}. A forecast needs ${FO_M.gateWeeks} weeks since the first sale and ${FO_M.gateUnits}+ units a week.</p>`;
  const kids = !isKid ? `<section class="fo-dr-sec"><h4>SKUs <span class="muted">${fam.kids.length}</span></h4><ul class="fo-kids">${foSorted(fam.kids.filter(k => FO.inactive || k.active).map(k => Object.assign(k, { name: k.label }))).map(k => `<li><button type="button" data-fo-view="${alEsc(k.key)}">${foDot(k.status)}<span class="fo-kn">${alEsc(k.label)}<small>${alEsc(FO_ST[k.status].c)}${k.cover && k.cover.outHigh && k.status !== 'oos' ? ' · runs out ~' + alDay(k.cover.outHigh) : ''}</small></span><span class="num">${k.r ? foN(k.r[30].mid) + '<small>30 d</small>' : '—'}</span></button></li>`).join('')}</ul></section>` : '';
  const al = foAlertOf(fam);
  const alLink = al ? `<p class="fo-al">Sales Alerts flags it too: <b>${alEsc(al.head || '')}</b> <button type="button" class="fo-btn" data-fo-act="salert" data-fo-b="${fam.brand}">Open in Sales Alerts →</button></p>` : '';
  const back = isKid ? `<button type="button" class="fo-btn fo-back" data-fo-view="${alEsc(fam.key)}">← ${alEsc(alShort(fam.name))}</button>` : '';
  return `<div class="fo-dr-grip" aria-hidden="true"></div><header class="fo-dr-h">${back}<div class="fo-dr-t"><h3 id="foDrTitle">${alEsc(name)}</h3>`
    + `<p class="muted">${isKid ? alEsc(x.asin) + ' · ' : ''}${FO_BRAND[fam.brand]} · ${alEsc(fam.parent)}</p><div class="fo-dr-pills"><span class="fo-sev st-${x.status}">${FO_ST[x.status].i ? FO_ST[x.status].i + ' ' : foDot(x.status)}${FO_ST[x.status].t}</span>${pill}</div></div>`
    + `<button type="button" class="fo-x-close" data-fo-act="close" aria-label="Close">×</button></header>`
    + `<div class="fo-dr-b">${x.r ? `<div class="fo-dr-chart" id="foChart" role="img" aria-label="Units a week: the last 26 weeks, the next 13 forecast with its range${fam.m && fam.m.seasonOk ? ', and last year\'s pattern' : ''}"></div>`
      + `<label class="fo-tog fo-ly"><input type="checkbox" data-fo-ly${FO.drLy ? ' checked' : ''}${fam.m && fam.m.seasonOk ? '' : ' disabled'}> Last year's pattern (brand)</label>` : ''}`
    + `<p class="fo-story">${alEsc(foStory(x, fam))}</p>`
    + `<div class="fo-tiles">${tiles}${stockT}${coverT}${outT}</div>`
    + (c && c.high != null && c.likely !== c.high ? `<p class="fo-note">Stock lasts ${foN(c.high)}–${c.likely == null ? '180+' : foN(c.likely)} days (${foN(c.high)} if sales are high) · lead time ${fam.lead} days${fam.soon ? `, “soon” ${fam.soon} days after` : ''}.</p>` : '')
    + `<section class="fo-dr-sec"><h4>Why this confidence</h4>${why}</section>${kids}${alLink}</div>`;
}
function foDrawerEl() {
  let el = document.getElementById('foDr');
  if (!el) {
    const pane = document.getElementById('paneFcast');
    if (!pane) return null;
    const bg = document.createElement('div'); bg.className = 'fo-dr-bg'; bg.id = 'foDrBg'; bg.hidden = true; bg.setAttribute('data-fo-act', 'close');
    el = document.createElement('aside'); el.className = 'fo-dr'; el.id = 'foDr'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'foDrTitle'); el.tabIndex = -1;
    pane.appendChild(bg); pane.appendChild(el);
  }
  return el;
}
function foDrawerOpen(key) {
  const h = foFind(key);
  if (!h || !h.x) return;
  if (!FO.dr) FO.drFrom = document.activeElement;
  FO.dr = key;
  foDrawerPaint();
  const el = document.getElementById('foDr');
  const cl = el && el.querySelector('.fo-x-close');
  if (cl) cl.focus();
}
function foDrawerPaint() {
  const el = foDrawerEl();
  if (!el) return;
  const h = FO.dr ? foFind(FO.dr) : null;
  if (!h || !h.x) { foDrawerClose(); return; }
  if (FO.chart) { try { FO.chart.dispose(); } catch (e) { /* gone */ } FO.chart = null; }
  el.innerHTML = foDrawerHtml(h);
  el.hidden = false; document.getElementById('foDrBg').hidden = false;
  el.style.removeProperty('transform');
  el.classList.toggle('fo-mo', foMotion());
  const box = el.querySelector('#foChart');
  if (box) foChartDraw(box, h);
}
function foDrawerClose() {
  const el = document.getElementById('foDr'), bg = document.getElementById('foDrBg');
  if (FO.chart) { try { FO.chart.dispose(); } catch (e) { /* gone */ } FO.chart = null; }
  FO.dr = null;
  if (el) { el.hidden = true; el.innerHTML = ''; el.style.removeProperty('transform'); }
  if (bg) bg.hidden = true;
  const back = FO.drFrom; FO.drFrom = null;
  if (back && back.isConnected && back.focus) back.focus();
  else { const row = document.querySelector('#foPane [data-fo-row]'); if (row) row.focus(); }
}
const foCss = n => { const p = document.getElementById('paneFcast') || document.documentElement; return getComputedStyle(p).getPropertyValue(n).trim(); };
/** The chart's numbers: 26 weeks back, 13 ahead, the band, last year's pattern, today and the run-out. */
function foChartData(h) {
  const { x, fam } = h;
  const past = x.s.slice(-26), ahead = (x.m ? x.m.out : x.out || []).slice(0, FO_M.chartAhead);
  const n = past.length;
  const wks = past.map(p => p.wk).concat(ahead.map(p => p.wk));
  const ew = k => Math.min(0.9, x.e[7] * (1 + 0.5 * (k - 1) / (FO_M.chartAhead - 1)));
  const act = past.map(p => p.u).concat(ahead.map(() => null));
  const mid = past.map((p, i) => (i === n - 1 ? p.u : null)).concat(ahead.map(p => p.u));
  const lo = past.map((p, i) => (i === n - 1 ? p.u : null)).concat(ahead.map((p, k) => p.u * (1 - ew(k + 1))));
  const hi = past.map((p, i) => (i === n - 1 ? p.u : null)).concat(ahead.map((p, k) => p.u * (1 + ew(k + 1))));
  const fm = fam.m;
  let ly = null;
  if (fm && fm.seasonOk && FO.drLy) {
    const idx = typeof SD !== 'undefined' && SD && SD.d && typeof sdDays === 'function' ? foLyIndex(sdDays(fam.brand)) : null;
    const lvl = x.m ? x.m.level : x.r[30].mid / 30 * 7;
    if (idx) ly = wks.map(wk => { const v = idx(wk); return v == null ? null : v / fm.sBase * lvl; });
  }
  const skip = past.map(p => !!(p.skip === 'oos' || p.dead || p.kidsSkipped || p.kidsPart)).concat(ahead.map(() => false));
  const c = x.cover;
  const outIx = c && c.outHigh && x.status !== 'oos' ? wks.findIndex(wk => c.outHigh >= wk && c.outHigh <= alAdd(wk, 6)) : -1;
  return { wks, act, mid, lo, hi, ly, skip, today: n, outIx, out: c && c.outHigh };
}
function foChartDraw(box, h) {
  const d = foChartData(h);
  const draw = () => {
    if (!box.isConnected) return;
    if (!window.echarts) { box.innerHTML = foChartSvg(d); return; }
    const c = { ink: foCss('--fo-ink'), muted: foCss('--fo-muted'), line: foCss('--fo-line'), band: foCss('--fo-band'), card: foCss('--fo-card'), red: foCss('--fo-red'), fc: foCss('--fo-fc'), ly: foCss('--fo-muted') };
    const anim = foMotion();
    const ch = FO.chart = window.echarts.init(box, null, { renderer: 'svg' });
    const band = d.hi.map((v, i) => (v == null || d.lo[i] == null ? null : Math.max(0, v - d.lo[i])));
    const marks = [{ xAxis: d.today, label: { formatter: 'Today', color: c.muted, fontSize: 10, align: 'right', padding: [0, 4, 0, 0] }, lineStyle: { color: c.muted, type: 'solid', width: 1 } }];
    if (d.outIx >= 0) marks.push({ xAxis: d.outIx, label: { formatter: 'Runs out ~' + alDay(d.out), color: c.red, fontSize: 10, align: 'left', padding: [0, 0, 0, 4] }, lineStyle: { color: c.red, type: 'dashed', width: 1.5 } });
    ch.setOption({
      animation: anim, grid: { left: 40, right: 12, top: 26, bottom: 24 },
      tooltip: { trigger: 'axis', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 },
        formatter: ps => { const i = ps[0].dataIndex; const lines = [`<b>Week of ${alDay(d.wks[i])}</b>`];
          if (d.act[i] != null) lines.push(`Sold <b>${foN(d.act[i])}</b>${d.skip[i] ? ' · stock-out / suppressed (skipped)' : ''}`);
          if (i >= d.today) lines.push(`Forecast <b>${foN(d.mid[i])}</b> (${foRng(d.lo[i], d.hi[i])})`);
          if (d.ly && d.ly[i] != null) lines.push(`Last year's pattern ${foN(d.ly[i])}`);
          return lines.join('<br>'); } },
      xAxis: { type: 'category', data: d.wks, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 10, formatter: alDay, hideOverlap: true }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { color: c.muted, fontSize: 10, formatter: v => (v >= 1000 ? Math.round(v / 100) / 10 + 'k' : v) }, splitLine: { lineStyle: { color: c.line } } },
      series: [
        { type: 'line', data: d.lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, connectNulls: false },
        { type: 'line', data: band, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: c.band }, silent: true },
        { type: 'line', data: d.act, symbol: 'none', smooth: 0.2, lineStyle: { color: c.ink, width: 2 }, z: 3, markLine: { symbol: 'none', silent: true, data: marks } },
        { type: 'scatter', data: d.act.map((v, i) => (d.skip[i] ? v : null)), symbolSize: 7, itemStyle: { color: c.card, borderColor: c.muted, borderWidth: 1.5 }, z: 4 },
        { type: 'line', data: d.mid, symbol: 'none', lineStyle: { color: c.fc, width: 2, type: 'dashed' }, z: 3 },
      ].concat(d.ly ? [{ type: 'line', data: d.ly, symbol: 'none', lineStyle: { color: c.ly, width: 1.5, type: 'dotted' }, z: 2 }] : []),
    }, true);
  };
  if (window.echarts) draw();
  else {
    box.innerHTML = foChartSvg(d);                                         // the plain chart at once; ECharts takes over when it arrives
    if (typeof sdcLoadCharts === 'function') sdcLoadCharts().then(ok => { if (ok && box.isConnected) { box.innerHTML = ''; draw(); } }).catch(() => {});
  }
}
/** The same chart as plain SVG (no library): actual solid, forecast dashed in its band, last year dotted, today and the run-out. */
function foChartSvg(d) {
  const W = 520, H = 220, l = 34, rgt = 8, t = 16, b = 20, n = d.wks.length;
  const vals = [].concat(d.act, d.hi, d.ly || []).filter(v => v != null);
  const max = Math.max(1, ...vals);
  const X = i => l + (i / (n - 1 || 1)) * (W - l - rgt), Y = v => H - b - (v / max) * (H - t - b);
  const path = arr => { let s = '', on = false; arr.forEach((v, i) => { if (v == null) { on = false; return; } s += (on ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); on = true; }); return s; };
  const idx = d.mid.map((v, i) => i).filter(i => d.mid[i] != null);
  const area = idx.length ? 'M' + idx.map(i => X(i).toFixed(1) + ',' + Y(d.hi[i]).toFixed(1)).join('L') + 'L' + idx.slice().reverse().map(i => X(i).toFixed(1) + ',' + Y(d.lo[i]).toFixed(1)).join('L') + 'Z' : '';
  const tick = [0, Math.round(n / 3), Math.round(2 * n / 3), n - 1].map(i => `<text x="${X(i).toFixed(1)}" y="${H - 4}" class="fo-cx">${alDay(d.wks[i])}</text>`).join('');
  return `<svg class="fo-svgc" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><text x="2" y="${t}" class="fo-cx">${foN(max)}</text><line x1="${l}" x2="${W - rgt}" y1="${H - b}" y2="${H - b}" class="fo-cg"/>`
    + `<path d="${area}" class="fo-cb"/>${d.ly ? `<path d="${path(d.ly)}" class="fo-cl"/>` : ''}<path d="${path(d.act)}" class="fo-ca"/><path d="${path(d.mid)}" class="fo-cf"/>`
    + `<line x1="${X(d.today).toFixed(1)}" x2="${X(d.today).toFixed(1)}" y1="${t}" y2="${H - b}" class="fo-ct"/>`
    + (d.outIx >= 0 ? `<line x1="${X(d.outIx).toFixed(1)}" x2="${X(d.outIx).toFixed(1)}" y1="${t}" y2="${H - b}" class="fo-co"/>` : '') + tick + '</svg>';
}

/* ----- the controls ----- */
function foStart() {
  if (FO.started || typeof document === 'undefined' || !document.addEventListener) return;
  FO.started = true;
  try { const b = localStorage.getItem('foBrand'); if (b === 'SP' || b === 'CPC' || b === 'ALL') FO.brand = b; FO.stockOnly = localStorage.getItem('foStock') === '1'; } catch (e) { /* Ridhi, all stock */ }
  const inPane = e => e.target && e.target.closest && e.target.closest('#paneFcast');
  document.addEventListener('click', async e => {
    if (!inPane(e)) return;
    const t = e.target.closest('[data-fo-brand], [data-fo-chip], [data-fo-act], [data-fo-sort], [data-fo-exp], [data-fo-view], [data-fo-row]');
    if (!t || t.disabled) return;
    if (t.dataset.foBrand) { FO.brand = t.dataset.foBrand; FO.shown = FO_PAGE; FO.open = {}; try { localStorage.setItem('foBrand', FO.brand); } catch (err) { /* this visit */ } foDrawerClose(); foRender(); return; }
    if (t.dataset.foChip != null) { FO.chip = FO.chip === t.dataset.foChip ? '' : t.dataset.foChip; FO.shown = FO_PAGE; foRender(); const b = document.querySelector(`#foPane [data-fo-chip="${FO.chip}"]`); if (b && FO.chip) b.focus(); return; }
    if (t.dataset.foSort) { const k = t.dataset.foSort; FO.sort = FO.sort.k === k ? { k, dir: -FO.sort.dir } : { k, dir: 1 }; foRender(); const b = document.querySelector(`#foPane [data-fo-sort="${k}"]`); if (b) b.focus(); return; }
    if (t.dataset.foExp) { foToggle(t.dataset.foExp); return; }
    if (t.dataset.foView) { foDrawerOpen(t.dataset.foView); return; }
    if (t.dataset.foRow) { foDrawerOpen(t.dataset.foRow); return; }
    const act = t.dataset.foAct;
    if (act === 'close') { foDrawerClose(); return; }
    if (act === 'refresh') { FO.msg = ''; const p = foLoad(true); foRender(); await p; foRender(); return; }
    if (act === 'more') { FO.shown += FO_PAGE * 2; foRender(); return; }
    if (act === 'inactive') { FO.inactive = !FO.inactive; foRender(); return; }
    if (act === 'settings') { FO.setOpen = !FO.setOpen; foRender(); const i = document.querySelector('#foPane [data-fo-set]'); if (FO.setOpen && i) i.focus(); return; }
    if (act === 'csv') { foCsvDownload(foFor(FO.brand)); return; }
    if (act === 'salert') { if (typeof AL !== 'undefined') { AL.brand = t.dataset.foB || AL.brand; try { localStorage.setItem('alBrand', AL.brand); } catch (err) { /* this visit */ } } foDrawerClose(); if (typeof showTab === 'function') showTab('salert'); return; }
    if (act === 'save-set' || act === 'reset-set') {
      const s = {};
      if (act === 'save-set') document.querySelectorAll('#foPane [data-fo-set]').forEach(inp => { const v = Math.round(Number(inp.value)); if (isFinite(v) && v >= 0 && v <= 365 && v !== FO_DEF[inp.dataset.foSet]) s[inp.dataset.foSet] = v; });
      FO.store.settings = s; FO.store.setBy = typeof alWho === 'function' ? alWho() : ''; FO.store.setAt = Date.now();
      await foStoreSave({ settings: s, setBy: FO.store.setBy, setAt: FO.store.setAt });
      FO.msg = FO.storeNote || (act === 'save-set' ? 'Lead times saved.' : 'Back to 60 days.');
      foRender();
    }
  });
  document.addEventListener('input', e => {
    const q = e.target && e.target.closest && e.target.closest('#foPane [data-fo-q]');
    if (!q) return;
    FO.q = q.value; FO.shown = FO_PAGE;
    clearTimeout(FO.qT);
    FO.qT = setTimeout(() => { const pos = q.selectionStart; foRender(); const n = document.querySelector('#foPane [data-fo-q]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (err) { /* fine */ } } }, 120);
  });
  document.addEventListener('change', e => {
    const s = e.target && e.target.closest && e.target.closest('#paneFcast [data-fo-stock], #paneFcast [data-fo-ly]');
    if (!s) return;
    if (s.matches('[data-fo-stock]')) { FO.stockOnly = s.checked; try { localStorage.setItem('foStock', s.checked ? '1' : '0'); } catch (err) { /* this visit */ } foRender(); const n = document.querySelector('#foPane [data-fo-stock]'); if (n) n.focus(); }
    else { FO.drLy = s.checked; foDrawerPaint(); const n = document.querySelector('#foDr [data-fo-ly]'); if (n) n.focus(); }
  });
  document.addEventListener('keydown', e => {
    if (!foShown()) return;
    if (e.key === 'Escape' && FO.dr) { e.preventDefault(); foDrawerClose(); return; }
    if (FO.dr && e.key === 'Tab') {                                       // focus stays inside the drawer while it is open
      const el = document.getElementById('foDr'), f = el ? [...el.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]')] : [];
      if (f.length && !el.contains(document.activeElement)) { e.preventDefault(); f[0].focus(); }
      else if (f.length && e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (f.length && !e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      return;
    }
    const row = e.target && e.target.closest && e.target.closest('#foPane tr[data-fo-row]');
    if (!row || e.target !== row) return;
    const rows = [...document.querySelectorAll('#foPane tr[data-fo-row]')], i = rows.indexOf(row);
    if (e.key === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); rows[i + 1].focus(); }
    else if (e.key === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); rows[i - 1].focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); foDrawerOpen(row.dataset.foRow); }
    else if ((e.key === 'ArrowRight' && !FO.open[row.dataset.foRow]) || (e.key === 'ArrowLeft' && FO.open[row.dataset.foRow])) { if (row.classList.contains('is-fam')) { e.preventDefault(); foToggle(row.dataset.foRow, true); } }
  });
  // the phone's bottom sheet: swipe it down to close
  let y0 = null, dy = 0;
  document.addEventListener('touchstart', e => { const h = e.target && e.target.closest && e.target.closest('#foDr .fo-dr-grip, #foDr .fo-dr-h'); y0 = h && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  document.addEventListener('touchmove', e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); const el = document.getElementById('foDr'); if (el) el.style.transform = `translateY(${dy}px)`; }, { passive: true });
  document.addEventListener('touchend', () => { if (y0 == null) return; y0 = null; const el = document.getElementById('foDr'); if (dy > 90) foDrawerClose(); else if (el) el.style.removeProperty('transform'); });
  // light / dark: the chart takes the new colours; ✨: the page is drawn again, still or moving
  if (typeof MutationObserver === 'function') new MutationObserver(() => { if (FO.dr && foShown()) setTimeout(foDrawerPaint, 30); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('#fxBtn') && foShown()) setTimeout(foRender, 0); });
  let rT = 0;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (foShown()) foStick(); if (FO.chart) try { FO.chart.resize(); } catch (e) { /* gone */ } }, 150); });
}
function foToggle(key, keepFocus) {
  FO.open[key] = !FO.open[key];
  foRender();
  const sel = keepFocus ? `#foPane tr[data-fo-row="${CSS.escape(key)}"]` : `#foPane [data-fo-exp="${CSS.escape(key)}"]`;
  const n = document.querySelector(sel); if (n) n.focus();
}
const foShown = () => { const p = typeof document !== 'undefined' && document.getElementById ? document.getElementById('paneFcast') : null; return !!p && !p.classList.contains('hide'); };
/** The tab opened (core/nav.js showTab). */
async function ensureFcast() {
  if (FO.dr) foDrawerClose();
  foRender();
  await foLoad();
  if (foShown()) foRender();
  // Sales Alerts' own result, for the drawer's "Open in Sales Alerts" (its cached reads only, after the page is up)
  if (typeof alLoad === 'function' && foMay('salert') && typeof AL !== 'undefined' && !AL.data && !AL.busy) setTimeout(() => { alLoad().then(() => { if (FO.dr && foShown()) foDrawerPaint(); }).catch(() => {}); }, 400);
}

/* ----- ⬇ CSV: every family and its SKUs, every number on the page ----- */
function foCsvText(r) {
  if (!r || !r.ok) return '';
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const R = v => (v == null || !isFinite(v) ? '' : Math.round(v));
  const head = ['Brand', 'Family', 'Parent ASIN', 'Level', 'SKU', 'ASIN', 'Status', 'Confidence', 'Next 7 days low', 'Next 7 days likely', 'Next 7 days high',
    'Next 30 days low', 'Next 30 days likely', 'Next 30 days high', 'Next 90 days low', 'Next 90 days likely', 'Next 90 days high', 'Usual units/week', 'Stock', 'Stock as of',
    'Cover days (sales high)', 'Cover days (likely)', 'Runs out (sales high)', 'Runs out (likely)', 'Lead time days', 'Blind test 30-day error %', 'History weeks', 'Stock-out weeks skipped (16 wk)', 'Season used', 'Trend %/week', 'Units last 8 weeks'];
  const lines = [head.map(q).join(',')];
  const line = (f, x, kid) => {
    const r3 = n => (x.r ? [R(x.r[n].lo), R(x.r[n].mid), R(x.r[n].hi)] : ['', '', '']);
    const bt = kid ? x.fit && x.fit.bt : f.bt, m = kid ? x.fit && x.fit.ok && x.fit.m : f.m;
    lines.push([FO_BRAND[f.brand], f.name, f.parent, kid ? 'SKU' : 'Family', kid ? x.skus.join(' ') : '', kid ? x.asin : '', FO_ST[x.status].c, x.conf || '']
      .concat(r3(7), r3(30), r3(90), [x.r ? Math.round((m ? m.level : x.r[30].mid / 30 * 7) * 10) / 10 : '', x.stock, x.stockAt || '', x.cover ? x.cover.high : '', x.cover ? x.cover.likely : '',
        x.cover ? x.cover.outHigh : '', x.cover ? x.cover.outLikely : '', f.lead, bt ? Math.round(bt.e30 * 100) : '', x.hist, kid ? x.s.slice(-16).filter(w => w.skip === 'oos' || w.dead).length : f.skippedWeeks,
        f.m ? (f.m.seasonOk ? 'yes' : 'no') : '', m ? Math.round(m.g * 1000) / 10 : '', x.u8]).map(q).join(','));
  };
  foSorted(foShownFams(r)).forEach(f => { line(f, f, false); foVisibleKids(f).forEach(k => line(f, k, true)); });
  return lines.join('\r\n');
}
function foCsvDownload(r) {
  const text = foCsvText(r);
  if (!text) return;
  try {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `forecast_${r.brand}_${r.today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { FO.msg = 'The download did not start: ' + ((e && e.message) || e); foRender(); }
}

/* ----- the console: forecastCheck('pillow insert') — every number used, for the families / SKUs whose name, ASIN or SKU matches ----- */
/** The trace of one family or SKU, as plain numbers (forecastCheck prints it; tests read it). */
function foTrace(x, fam, r) {
  const kid = x !== fam;
  const fit = kid ? x.fit : fam.fit, m = kid ? (fit.ok ? fit.m : null) : fam.m, bt = fit && fit.ok ? fit.bt : null;
  const used = m ? new Map(m.use.map((i, k) => [i, m.weights[k]])) : new Map();
  const end = x.s.length - 1;
  const idx = typeof SD !== 'undefined' && SD && SD.d && typeof sdDays === 'function' ? foLyIndex(sdDays(fam.brand)) : null;
  return {
    what: kid ? `${x.label} (${x.asin}) in ${fam.name}` : `${fam.name} (${fam.parent}, ${x.kids.length} SKU${x.kids.length === 1 ? '' : 's'})`, brand: FO_BRAND[fam.brand],
    status: FO_ST[x.status].t, confidence: x.conf || null, history: x.hist, unitsLast8Weeks: x.u8,
    usualPerWeek: m ? Math.round(m.level * 10) / 10 : null, spikeCap: m ? Math.round(m.med * FO_M.spike * 10) / 10 : null,
    season: m ? (m.seasonOk ? `used — last year's base ${Math.round(m.sBase)} brand units/week` : fit.tried ? 'not used: it made the blind test worse' : 'not held') : null,
    trendPerWeek: m ? `${Math.round(m.g * 1000) / 10}% (raw ${Math.round(m.gRaw * 1000) / 10}%, halved, capped ±${FO_M.trendCap * 100}%, × ${FO_M.damp} a week)` : null,
    weeks: x.s.map((w, i) => ({ week: w.wk, units: w.u, rateUsed: w.skip ? null : Math.round(w.r * 10) / 10, skipped: w.skip === 'pre' ? 'before first sale' : w.skip === 'oos' ? 'stock-out / suppressed' : w.skip === 'missing' ? 'no data for the brand' : w.dead ? `${w.dead} dead day(s) taken out` : w.kidsSkipped ? `${w.kidsSkipped} SKU(s) out all week: counted at their usual rate` : w.kidsPart ? `stock-out days taken out (${w.kidsPart} SKU)` : '',
      baseWeight: used.get(i) || null, lyBrandUnits: idx ? (v => (v == null ? null : Math.round(v)))(idx(w.wk)) : null, ago: end - i })),
    blindTest: bt ? { weeks: bt.n, from: bt.from, error7: foPct(bt.e7), error30: foPct(bt.e30), errorAll: foPct(bt.eTot), bias: Math.round(bt.bias * 100) + '%',
      rows: bt.rows.map(t => ({ week: t.wk, forecast: Math.round(t.f * 10) / 10, actual: t.a == null ? null : Math.round(t.a * 10) / 10, skipped: t.skip })) } : null,
    ahead: (m ? m.out : x.out || []).slice(0, FO_M.chartAhead).map(o => ({ week: o.wk, units: Math.round(o.u * 10) / 10, season: o.f != null ? Math.round(o.f * 100) / 100 : null, trend: o.tr != null ? Math.round(o.tr * 1000) / 1000 : null })),
    next: x.r ? { '7': `${foN(x.r[7].mid)} (${foRng(x.r[7].lo, x.r[7].hi)}, ${foPct(x.e[7])})`, '30': `${foN(x.r[30].mid)} (${foRng(x.r[30].lo, x.r[30].hi)}, ${foPct(x.e[30])})`, '90': `${foN(x.r[90].mid)} (${foRng(x.r[90].lo, x.r[90].hi)}, ${foPct(x.e[90])})` } : null,
    stock: x.stock, stockAt: x.stockAt || null, cover: x.cover ? { salesHigh: x.cover.high, likely: x.cover.likely, runsOutHigh: x.cover.outHigh, runsOutLikely: x.cover.outLikely, sku: kid ? x.label : x.first ? x.first.label : null } : null,
    leadTime: fam.lead, story: foStory(x, fam), why: x.r ? null : foWhyNot(x),
  };
}
async function forecastCheck(query, brand) {
  await foLoad();
  const q = String(query == null ? '' : query).toLowerCase().trim();
  const out = [];
  (brand ? [brand] : ['SP', 'CPC']).forEach(b => {
    const r = foFor(b);
    if (!r) { console.warn('Forecast has not loaded yet.'); return; }
    if (!r.ok) { console.warn(r.why); return; }
    r.fams.forEach(f => {
      const famHit = !q || (f.name + ' ' + f.parent).toLowerCase().includes(q);
      const kidHits = f.kids.filter(k => q && (k.asin + ' ' + k.skus.join(' ')).toLowerCase().includes(q));
      (famHit ? [f] : []).concat(kidHits).forEach(x => {
        const t = foTrace(x, f, r);
        console.log(`%c${t.what} · ${t.brand}`, 'font-weight:bold', `\n${t.status}${t.confidence ? ' · ' + t.confidence + ' confidence' : ''}`
          + (t.next ? `\nnext 7 / 30 / 90 days: ${t.next['7']} · ${t.next['30']} · ${t.next['90']}` : `\n${t.why}`)
          + `\nusual ${t.usualPerWeek == null ? '—' : t.usualPerWeek}/week (spikes capped at ${t.spikeCap == null ? '—' : t.spikeCap}) · season ${t.season || '—'} · trend ${t.trendPerWeek || '—'}`
          + `\nstock ${t.stock == null ? 'no data' : t.stock}${t.stockAt ? ' (as of ' + t.stockAt + ')' : ''} · cover ${t.cover ? `${t.cover.salesHigh == null ? '180+' : t.cover.salesHigh} days if sales are high, ${t.cover.likely == null ? '180+' : t.cover.likely} likely · runs out ${t.cover.runsOutHigh || 'after half a year'}` : '—'} · lead time ${t.leadTime} days`
          + (t.blindTest ? `\nblind test ${t.blindTest.weeks} weeks from ${t.blindTest.from}: 30-day error ${t.blindTest.error30}, weekly ${t.blindTest.error7}, total ${t.blindTest.errorAll} (bias ${t.blindTest.bias})` : '')
          + `\n${t.story}`);
        console.table(t.weeks);
        if (t.blindTest) console.table(t.blindTest.rows);
        out.push(t);
      });
    });
  });
  if (!out.length) console.log('No family or SKU matches "' + query + '".');
  return out;
}
if (typeof window !== 'undefined') window.forecastCheck = forecastCheck;
