/* ================= LISTING · BSR AUDIT — THE DECISION PAGE (28 Nov 2026) =================
 * Screen: Listing → BSR Audit. How are we doing → what needs action → why → what to do, for people who decide:
 *   a sticky toolbar (period, brand, search, CSV, "Full history"), one plain-English line, five number cards (filters), two decision
 *   columns (🔴 Act now · 🟢 Winning, three families each), filter chips, one table line per family (sortable, ↑↓ + Enter), a side panel
 *   per family (chart, why it moved, what to do, its sizes). "Full history" opens the existing view (bsr-audit.js renderBsrHistory),
 *   where "Take snapshot" stays.
 * THE MATHS UNDERNEATH IS bsr-audit.js, unchanged: the rows come from bsrBuildRows (the rank used — sub-category, else main —, the noise
 *   filter, the move, the facts from bsrFacts, the decision, the category trend, the money at stake, the action follow-up, the daily
 *   7-day average). This file only adds what a period of SALES says beside it, and draws the page.
 * ORDERS AND REVENUE — the same rows Sales Alerts and the Forecast read (VI.data from sales/sales-insight.js viLoad):
 *   the nightly per-product days (dailyAsin: [units, sales] per ASIN per US Pacific day, 45 days) for the days they hold; before them,
 *   PPC & Organic's weekly store (WEEKLY rows[asin].weeks[Sunday] u / rev, 26 weeks): a week wholly before the per-day data is taken
 *   whole, the part of a week before it = the week's total − its days in the per-day data; a part-week that cannot be split is taken
 *   pro rata and the page says so ("≈"). "Orders" are units ordered (per product Amazon's data counts units — as Sales Alerts and the
 *   Forecast). The last day = the last finished day the per-day data holds (never today), as Sales Alerts.
 * PERIODS (US Pacific days): This week vs last = Sunday → the last day, against the same days a week before · Last 2 / 4 weeks = the 2 / 4
 *   finished Sunday–Saturday weeks against the 2 / 4 before · This month vs last month = the 1st → the last day, against the same days
 *   of last month. RANKS: the newest stored week (week A) against the stored week 1 / 2 / 4 weeks before it (month: the newest week of
 *   last month) — the existing comparison, per brand.
 * VERDICT per family (bsxVerdict): too few orders (< 10 in both periods) · category changed · rank better + revenue up = 🟢 Growing ·
 *   rank better + revenue flat / down = 🟡 Check price / conversion · rank worse + revenue down = 🔴 Needs action · rank worse + revenue
 *   up / flat = ⚪ Category busier (OK) · rank held: revenue up = Growing, down = Check, flat = Steady. Revenue moves when ≥ 10 %.
 * READ-ONLY: no Amazon call, no backend change — reads what the other screens read; "+ Task" is the Action Tracker's own button.
 * Main functions: bsxPeriodDates, bsxWeeksFor, bsxSum, bsxVerdict, bsxRankParts, bsxAction, bsxCompute (pure), bsxStory, bsxRender,
 *   bsxPaint, bsxPanelOpen / bsxPanelDraw, bsxCsv, bsxMode, bsxOpen. Names bsx / BSX. Tests: tests/bsr-decide-test.js. */

const BSX_PERIODS = [
  { k: 'week', t: 'This week vs last', word: 'this week', n: 1 },
  { k: '2w', t: 'Last 2 weeks vs 2 before', word: 'over the last 2 weeks', n: 2 },
  { k: '4w', t: 'Last 4 weeks vs 4 before', word: 'over the last 4 weeks', n: 4 },
  { k: 'month', t: 'This month vs last month', word: 'this month', n: 0 },
];
const BSX_M = { lowOrders: 10, revMove: 0.10, page: 25, top: 20 };
const BSX_V = {
  act: { e: '🔴', t: 'Needs action', cls: 'bad', o: 0 },
  check: { e: '🟡', t: 'Check price / conversion', cls: 'warn', o: 1 },
  cat: { e: '🟠', t: 'Category changed', cls: 'amber', o: 2 },
  busy: { e: '⚪', t: 'Category busier', cls: 'off', o: 3 },
  grow: { e: '🟢', t: 'Growing', cls: 'ok', o: 4 },
  steady: { e: '', t: 'Steady', cls: 'off', o: 5 },
  low: { e: '', t: 'Too few orders to judge', cls: 'off', o: 6 },
  norank: { e: '', t: 'No rank to compare', cls: 'off', o: 7 },
};
const BSX_CHIPS = [['', 'All'], ['grow', '🟢 Growing'], ['check', '🟡 Check'], ['act', '🔴 Needs action'], ['busy', '⚪ Busier'], ['top', 'Top 20 sellers']];
const bsxLs = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* this visit */ } } };
const BSX = { period: 'week', brand: ['SP', 'CPC', 'ALL'].includes(bsxLs.get('bsxBrand')) ? bsxLs.get('bsxBrand') : 'ALL', f: '', q: '', sort: { k: 'default', dir: 1 },
  limit: BSX_M.page, res: null, tok: 0, panel: '', counted: false, shell: false, err: '', chart: null, vi: null };
const bsxEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const BSX_NUM = new Intl.NumberFormat('en-US');
const bsxNf = v => BSX_NUM.format(Math.round(Number(v || 0)));
const bsxMoney = v => (v < 0 ? '−' : '') + '$' + BSX_NUM.format(Math.round(Math.abs(Number(v || 0))));
const bsxPrice = v => (v > 0 ? '$' + Number(v).toFixed(2) : '—');
const BSX_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bsxAdd = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const bsxSun = k => bsxAdd(k, -new Date(k + 'T00:00:00Z').getUTCDay());
const bsxDay = k => (k ? `${+k.slice(8, 10)} ${BSX_MON[+k.slice(5, 7) - 1]}` : '—');
const bsxSpan = (f, t) => (f.slice(0, 7) === t.slice(0, 7) ? (f === t ? bsxDay(t) : `${+f.slice(8, 10)}–${bsxDay(t)}`) : `${bsxDay(f)}–${bsxDay(t)}`);
const bsxToday = () => (typeof sdToday === 'function' ? sdToday() : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
const bsxName = b => ({ SP: 'Ridhi', CPC: 'CPC' })[b] || b;
const bsxPctTxt = p => (p == null || !isFinite(p) ? '' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.round(Math.abs(p) * 100)}%`);

/* ----- the periods (pure) ----- */
/** The two periods of a view: { a: [from, to], b: [from, to], label } — `last` = the last finished US Pacific day. */
function bsxPeriodDates(kind, last) {
  if (kind === 'month') {
    const a0 = last.slice(0, 8) + '01';
    const y = +last.slice(0, 4), m = +last.slice(5, 7);
    const p0 = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1)).toISOString().slice(0, 10);
    const pEnd = bsxAdd(a0, -1);
    const b1 = [bsxAdd(p0, +last.slice(8, 10) - 1), pEnd].sort()[0];
    return { a: [a0, last], b: [p0, b1], label: `${bsxSpan(a0, last)} vs ${bsxSpan(p0, b1)}` };
  }
  if (kind === 'week') {
    const s = bsxSun(last);
    return { a: [s, last], b: [bsxAdd(s, -7), bsxAdd(last, -7)], label: `${bsxSpan(s, last)} vs ${bsxSpan(bsxAdd(s, -7), bsxAdd(last, -7))}` };
  }
  const n = kind === '4w' ? 4 : 2;
  const e = new Date(last + 'T00:00:00Z').getUTCDay() === 6 ? last : bsxAdd(bsxSun(last), -1);   // the last finished Saturday
  const a = [bsxAdd(e, -7 * n + 1), e], b = [bsxAdd(e, -14 * n + 1), bsxAdd(e, -7 * n)];
  return { a, b, label: `${bsxSpan(a[0], a[1])} vs ${bsxSpan(b[0], b[1])}` };
}
/** The two stored weeks a brand's ranks are compared on: the newest, and the one 1 / 2 / 4 weeks before (month: last month's newest). */
function bsxWeeksFor(weeks, kind) {
  const ws = (weeks || []).slice().sort();
  if (!ws.length) return { a: '', b: '' };
  const a = ws[ws.length - 1];
  const mon = bsrMonday(a);
  let b = '';
  if (kind === 'month') {
    const first = Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), 1);
    b = ws.filter(w => bsrMonday(w) && bsrMonday(w).getTime() < first).pop() || '';
  } else {
    const n = (BSX_PERIODS.find(p => p.k === kind) || BSX_PERIODS[0]).n;
    const target = mon.getTime() - n * 7 * 864e5;
    b = ws.filter(w => w !== a && bsrMonday(w) && bsrMonday(w).getTime() <= target).pop() || '';
  }
  return { a, b };
}

/* ----- orders and revenue (pure): the same rows as Sales Alerts and the Forecast ----- */
/** Units and sales of some ASINs over [from, to] (US Pacific days). src = { days (VI.data.days), weekly (VI.data.weekly) }.
 *  → { u, s, est (days taken pro rata from a weekly total), miss (days with no figure anywhere) } */
function bsxSum(asins, from, to, src) {
  const d = (src && src.days && src.days.d) || {};
  const dFrom = (src && src.days && src.days.from) || '9999-12-31';
  const W = src && src.weekly;
  const wHas = wk => !!(W && (W.weeks || []).includes(wk));
  let u = 0, s = 0, est = 0, miss = 0;
  const day = (a, k) => { const v = (d[a] || {})[k]; return v ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0]; };
  const daily = (f, t) => { let x = 0, y = 0; for (let k = f; k <= t; k = bsxAdd(k, 1)) asins.forEach(a => { const v = day(a, k); x += v[0]; y += v[1]; }); return [x, y]; };
  if (to >= dFrom) { const v = daily(from > dFrom ? from : dFrom, to); u += v[0]; s += v[1]; }
  if (from < dFrom) {
    for (let wk = bsxSun(from); wk <= to && wk < dFrom; wk = bsxAdd(wk, 7)) {
      const wEnd = bsxAdd(wk, 6), pre = [wk, [wEnd, bsxAdd(dFrom, -1)].sort()[0]];        // this week's days before the per-day data
      const f = from > wk ? from : wk, t = [to, pre[1]].sort()[0];                       // …of them, the ones in the period
      if (f > t) continue;
      const need = Math.round((Date.parse(t) - Date.parse(f)) / 864e5) + 1, have = Math.round((Date.parse(pre[1]) - Date.parse(pre[0])) / 864e5) + 1;
      if (!wHas(wk)) { miss += need; continue; }
      let wu = 0, ws = 0;
      asins.forEach(a => { const c = W.rows && W.rows[a] && W.rows[a].weeks ? W.rows[a].weeks[wk] : null; if (c) { wu += Number(c.u) || 0; ws += Number(c.rev) || 0; } });
      const inWin = wEnd >= dFrom ? daily(dFrom, wEnd) : [0, 0];                          // the week's days the per-day data holds
      const ru = Math.max(0, wu - inWin[0]), rs = Math.max(0, ws - inWin[1]);
      if (need === have) { u += ru; s += rs; } else { u += ru * need / have; s += rs * need / have; est += need; }
    }
  }
  return { u: Math.round(u * 100) / 100, s: Math.round(s * 100) / 100, est, miss };
}

/* ----- the verdict, the rank as Amazon writes it, the action (pure) ----- */
/** x = { move ('better' | 'worse' | 'stable' | null), catChanged, uA, uB, sA, sB } → a key of BSX_V. */
function bsxVerdict(x) {
  if ((x.uA || 0) < BSX_M.lowOrders && (x.uB || 0) < BSX_M.lowOrders) return 'low';
  if (x.catChanged) return 'cat';
  const rev = x.sB > 0 ? (x.sA - x.sB) / x.sB : x.sA > 0 ? 1 : 0;
  const up = rev >= BSX_M.revMove, down = rev <= -BSX_M.revMove;
  if (!x.move) return 'norank';
  if (x.move === 'better') return up ? 'grow' : 'check';
  if (x.move === 'worse') return down ? 'act' : 'busy';
  return up ? 'grow' : down ? 'check' : 'steady';
}
/** The rank as Amazon writes it, and its change: { now: '#3,100', cat, ch: '▲ 2,100 (▲40%) · from #5,200', cls: up | down | flat | amber | '' }.
 *  LOWER IS BETTER: a lower number is ▲ (green). */
function bsxRankParts(a, b, cat, move, catChanged) {
  const now = a > 0 ? '#' + bsxNf(a) : 'no rank';
  if (catChanged) return { now, cat, ch: 'category changed', cls: 'amber' };
  if (!(a > 0) || !(b > 0)) return { now, cat, ch: a > 0 ? 'no rank before' : b > 0 ? `was #${bsxNf(b)}` : '', cls: '' };
  if (a === b) return { now, cat, ch: '—', cls: 'flat' };
  const d = Math.abs(a - b), p = Math.round(d / b * 100), up = a < b, ar = up ? '▲' : '▼';
  return { now, cat, ch: `${ar} ${bsxNf(d)} (${ar}${p}%) · from #${bsxNf(b)}`, cls: move === 'stable' ? 'flat' : up ? 'up' : 'down' };
}
// The existing decision's action in a decision maker's words (Restock / Check price / Restore ads / Fix listing / Check Buy Box).
function bsxActOf(action, leadK) {
  if (action === 'Restock first') return 'Restock';
  if (action === 'Fix the listing' || action === 'Check our change') return 'Fix listing';
  if (action === 'Deal / price check') return leadK === 'bb' ? 'Check Buy Box' : 'Check price';
  if (action === 'Review PPC') return 'Restore ads';
  if (action === 'Check category') return 'Check category';
  if (action === 'Watch') return 'Watch';
  return '';
}
/** One family's suggestion: { act, why } — the strongest fact (bsrFactList via bsrDecide), never a guess. */
function bsxAction(r, verdict, uA) {
  const facts = (r && r.decision && r.decision.facts) || [];
  if (verdict === 'grow') {
    const f = (r && r.facts) || {};
    const lead = facts.find(x => ['dealstart', 'adsup', 'pricedown', 'ours'].includes(x.k));
    const wk = f.units && f.units.a > 0 ? f.units.a : null;
    const act = f.qty != null && wk && f.qty < wk * 4 ? 'Reorder in time' : lead && lead.k === 'adsup' ? 'Raise budget' : 'Keep going';
    return { act, why: lead ? lead.txt : 'Rank and revenue both up' };
  }
  const lead = facts.find(x => x.act);
  const act = r ? bsxActOf(r.action, lead && lead.k) || (verdict === 'act' ? 'Restore ads' : '') : '';
  const why = lead ? lead.txt : (facts.find(x => x.k !== 'units') || {}).txt || (r && r.short) || '';
  return { act, why };
}

/* ----- one view's numbers (pure) ----- */
/** o = { rows (bsrBuildRows' rows of the view's brands), fams: [{ key, brand, parent, name, asins, sizes }], src, per (bsxPeriodDates) }
 *  → { rows: [family], kpi, act3, win3 }. A family: its rank (the bsr row), units / revenue in both periods, its verdict and suggestion. */
function bsxCompute(o) {
  const byKey = new Map((o.rows || []).map(r => [r.brand + '|' + r.parent, r]));
  const out = [];
  (o.fams || []).forEach(f => {
    const r = byKey.get(f.key) || null;
    const A = bsxSum(f.asins, o.per.a[0], o.per.a[1], o.src), B = bsxSum(f.asins, o.per.b[0], o.per.b[1], o.src);
    if (!r && !A.u && !B.u && !A.s && !B.s) return;
    const move = r && r.a && r.b && !r.catChanged ? r.move : null;
    const v = bsxVerdict({ move, catChanged: !!(r && r.catChanged), uA: A.u, uB: B.u, sA: A.s, sB: B.s });
    const sug = bsxAction(r, v, A.u);
    const rank = r ? bsxRankParts(r.a, r.b, r.cat, r.move, r.catChanged) : bsxRankParts(0, 0, '', null, false);
    out.push({ key: f.key, brand: f.brand, parent: f.parent, name: f.name || f.parent, sizes: f.sizes, asins: f.asins, r, rank, kind: r ? r.kind : '', main: r ? r.main : 0,
      mainCat: r ? r.mainCat : '', move, uA: A.u, uB: B.u, sA: A.s, sB: B.s, est: A.est + B.est, miss: A.miss + B.miss,
      dU: A.u - B.u, dS: A.s - B.s, pU: B.u > 0 ? (A.u - B.u) / B.u : null, pS: B.s > 0 ? (A.s - B.s) / B.s : null, price: A.u > 0 ? A.s / A.u : null,
      verdict: v, act: sug.act, why: sug.why, risk: v === 'act' ? Math.max(0, B.s - A.s) : 0, gain: Math.max(0, A.s - B.s) });
  });
  const sum = k => out.reduce((t, x) => t + (x[k] || 0), 0);
  const kpi = { sA: sum('sA'), sB: sum('sB'), uA: sum('uA'), uB: sum('uB'), better: out.filter(x => x.move === 'better').length, worse: out.filter(x => x.move === 'worse').length,
    act: out.filter(x => x.verdict === 'act').length, n: out.length, est: out.some(x => x.est), miss: out.some(x => x.miss) };
  const act3 = out.filter(x => x.verdict === 'act').sort((a, b) => b.risk - a.risk || a.sA - b.sA).slice(0, 3);
  const win3 = out.filter(x => x.verdict === 'grow' && x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  const top = new Set(out.slice().sort((a, b) => b.sA - a.sA).slice(0, BSX_M.top).filter(x => x.sA > 0).map(x => x.key));
  out.forEach(x => { x.top = top.has(x.key); });
  return { rows: out, kpi, act3, win3 };
}
/** The one plain line: "Revenue up 12% this week. 34 families ranking better, 12 worse. Biggest win: … (+$1,300). Act on: … (−$1,000)." */
function bsxStory(res, word) {
  const k = res.kpi;
  if (!res.rows.length) return 'No sales or ranks for this view yet.';
  const p = k.sB > 0 ? (k.sA - k.sB) / k.sB : null;
  const s1 = p == null ? `Revenue ${bsxMoney(k.sA)} ${word}.` : Math.abs(p) < 0.005 ? `Revenue flat ${word}.` : `Revenue ${p > 0 ? 'up' : 'down'} ${Math.round(Math.abs(p) * 100)}% ${word}.`;
  const fam = n => `${bsxNf(n)} famil${n === 1 ? 'y' : 'ies'}`;
  const s2 = `${fam(k.better)} ranking better, ${bsxNf(k.worse)} worse.`;
  const w = res.win3[0], a = res.act3[0];
  return [s1, s2, w ? `Biggest win: ${w.name} (+${bsxMoney(w.gain)}).` : '', a ? `Act on: ${a.name} (−${bsxMoney(a.risk)}).` : 'Nothing needs action.'].filter(Boolean).join(' ');
}

/* ----- the data of a view (reads only) ----- */
// The families of the brands on view: Listing Health's parents (their ASINs and sizes), and any parent only the snapshots hold.
function bsxFamilies(brands, rows) {
  const m = new Map();
  brands.forEach(b => ((typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].rows) || []).forEach(row => {
    const parent = row.parent || row.asin;
    if (!parent) return;
    const key = b + '|' + parent;
    const f = m.get(key) || (m.set(key, { key, brand: b, parent, name: '', asinSet: new Set(), kids: [] }), m.get(key));
    const a = String(row.asin || '').toUpperCase();
    if (a && !f.asinSet.has(a)) { f.asinSet.add(a); f.kids.push(row); }
  }));
  (rows || []).forEach(r => { const key = r.brand + '|' + r.parent; if (!m.has(key) && brands.includes(r.brand)) m.set(key, { key, brand: r.brand, parent: r.parent, name: '', asinSet: new Set(), kids: [] }); });
  return [...m.values()].map(f => Object.assign(f, { asins: [...f.asinSet], sizes: f.asinSet.size,
    name: (typeof parentName === 'function' ? parentName(f.brand, f.parent, '') : '') || (f.kids[0] && f.kids[0].title) || f.parent }));
}
const bsxSrc = () => {
  const d = typeof VI !== 'undefined' && VI && VI.data ? VI.data : null;
  return { days: d ? d.days : null, weekly: d && d.weekly ? d.weekly : (typeof WEEKLY !== 'undefined' && WEEKLY.weeks && WEEKLY.weeks.length ? WEEKLY : null) };
};
// The last finished US Pacific day the per-day data holds (never today) — as Sales Alerts.
function bsxLast(src) {
  const yest = bsxAdd(bsxToday(), -1);
  const up = src.days && src.days.upTo;
  return up && up < yest ? up : yest;
}
/** Everything a view needs, worked out (the weeks must be in memory). */
function bsxComputeView() {
  const brands = BSX.brand === 'ALL' ? ['SP', 'CPC'] : [BSX.brand];
  const src = bsxSrc();
  const last = bsxLast(src);
  const per = bsxPeriodDates(BSX.period, last);
  // the ranks: each brand on its own newest week against the week the period asks for (brands with the same two weeks together, as before)
  const pairs = new Map();
  brands.forEach(b => { const w = bsxWeeksFor(BSR_WEEKS[b], BSX.period); const k = w.a + '|' + w.b; (pairs.get(k) || (pairs.set(k, { w, brands: [] }), pairs.get(k))).brands.push(b); });
  let rows = [];
  const weeks = {};
  pairs.forEach(({ w, brands: bs }) => { if (w.a) rows = rows.concat(bsrBuildRows(bs, w.a, w.b).all); bs.forEach(b => { weeks[b] = w; }); });
  const fams = bsxFamilies(brands, rows);
  const res = bsxCompute({ rows, fams, src, per });
  return Object.assign(res, { per, last, weeks, brands, src, at: src.days && src.days.at ? src.days.at : '' });
}
async function bsxEnsureWeeks() {
  const brands = BSX.brand === 'ALL' ? ['SP', 'CPC'] : [BSX.brand];
  for (const b of brands) {
    const w = bsxWeeksFor(BSR_WEEKS[b], BSX.period);
    for (const wk of [w.a, w.b].filter(Boolean)) { if (BSR_WEEKS[b].includes(wk)) await loadBsrWeek(b, wk); await bsrLoadDays(b, wk); }
  }
}

/* ----- the page ----- */
const bsxFx = () => {
  let on = typeof sdcFxSaved === 'function' ? sdcFxSaved() : bsxLs.get('selloraDashFx') !== '0';
  try { if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) on = false; } catch (e) { /* motion as saved */ }
  return on;
};
const bsxEl = id => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);
// The menu bar's height (sticky on wide screens): the toolbar and the panel start below it.
function bsxTop() {
  try {
    const side = document.querySelector('.side');
    const top = side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0;
    const pane = bsxEl('paneBsr');
    if (pane) pane.style.setProperty('--bsx-top', top + 'px');
  } catch (e) { /* no layout */ }
}
/** The page's frame, drawn at once (skeletons in it until the numbers are worked out). */
function bsxShell() {
  const root = bsxEl('bsxPane');
  if (!root || BSX.shell) return;
  BSX.shell = true;
  const sk = n => Array.from({ length: n }, () => '<i class="bsx-sk"></i>').join('');
  const brandBtn = (v, t) => `<button type="button" data-bsx-brand="${v}" aria-pressed="${BSX.brand === v}">${t}</button>`;
  root.innerHTML = `<div class="bsx">
  <header class="bsx-bar" role="toolbar" aria-label="BSR Audit">
    <h1 class="bsx-h">BSR Audit</h1>
    <div class="bsx-ctl">
      <label class="bsx-sel"><span class="sr-only">Period</span><select data-bsx="period" aria-label="Period">${BSX_PERIODS.map(p => `<option value="${p.k}"${p.k === BSX.period ? ' selected' : ''}>${p.t}</option>`).join('')}</select></label>
      <div class="bsx-seg" role="group" aria-label="Brand">${brandBtn('SP', 'Ridhi')}${brandBtn('CPC', 'CPC')}${brandBtn('ALL', 'Both')}</div>
      <input type="search" data-bsx="q" placeholder="Search a family…" aria-label="Search a family" value="${bsxEsc(BSX.q)}">
      <button type="button" class="bsx-btn" data-bsx-act="csv">⬇ CSV</button>
      <button type="button" class="bsx-link" data-bsx-act="history">Full history</button>
    </div>
    <p class="bsx-asof" id="bsxAsof">Reading the ranks and the sales…</p>
  </header>
  <p class="bsx-story" id="bsxStory" aria-live="polite"><span class="bsx-sk bsx-sk-line"></span></p>
  <section class="bsx-kpis" id="bsxKpis" aria-label="Numbers — click one to filter the table">${sk(5)}</section>
  <section class="bsx-dec" id="bsxDec"><div class="bsx-col">${sk(3)}</div><div class="bsx-col">${sk(3)}</div></section>
  <div class="bsx-chips" id="bsxChips" role="group" aria-label="Filter the families"></div>
  <section class="bsx-tcard"><div class="bsx-tw"><table class="bsx-t" id="bsxTable" aria-label="Families"><tbody>${Array.from({ length: 6 }, () => '<tr class="bsx-skrow"><td colspan="6"><i class="bsx-sk"></i></td></tr>').join('')}</tbody></table></div><div class="bsx-more" id="bsxMore"></div></section>
  <p class="bsx-foot" id="bsxFoot"></p>
</div>`;
}
/** Draw (or re-work) the page: the frame at once; the numbers when the ranks and the sales are read. */
function bsxRender() {
  if (!bsxEl('bsxPane')) return;
  bsxShell();
  bsxTop();
  if (typeof BSR_LOADED === 'undefined' || !BSR_LOADED || !(typeof VI !== 'undefined' && VI && VI.data)) {
    if (!(typeof VI !== 'undefined' && VI && VI.data) && typeof viLoad === 'function' && !BSX.vi) BSX.vi = viLoad().then(() => bsxRender()).catch(() => { BSX.err = 'The sales could not be read.'; });
    return;
  }
  if (!allWeeks().length) { bsxEmpty(); return; }
  const tok = ++BSX.tok;
  (async () => {
    await bsxEnsureWeeks();
    if (tok !== BSX.tok) return;
    await new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 0)));
    if (tok !== BSX.tok) return;
    let res;
    try { res = bsxComputeView(); } catch (e) { res = null; BSX.err = 'The page could not be worked out: ' + ((e && e.message) || e); }
    if (tok !== BSX.tok) return;
    BSX.res = res;
    bsxPaint();
  })();
}
function bsxEmpty() {
  const s = bsxEl('bsxStory');
  if (s) s.textContent = 'No rank snapshots yet — open Full history and take the first snapshot (a daily one is taken by itself).';
  ['bsxKpis', 'bsxDec', 'bsxChips', 'bsxMore'].forEach(id => { const el = bsxEl(id); if (el) el.innerHTML = ''; });
  const t = bsxEl('bsxTable'); if (t) t.innerHTML = '';
}
// The rows on screen: the filter (card / chip), the search box, the sort.
function bsxShown() {
  const res = BSX.res;
  if (!res) return [];
  let rows = res.rows;
  const f = BSX.f;
  if (f === 'top') rows = rows.filter(x => x.top);
  else if (f === 'better' || f === 'worse') rows = rows.filter(x => x.move === f);
  else if (f) rows = rows.filter(x => x.verdict === f);
  const q = BSX.q.trim().toLowerCase();
  if (q) rows = rows.filter(x => (x.name + ' ' + x.parent + ' ' + bsxName(x.brand) + ' ' + (x.rank.cat || '')).toLowerCase().includes(q));
  return bsxSorted(rows, BSX.sort);
}
/** Sort: 'default' = Needs action first (by revenue at risk), then by revenue; or a column (name, rank, orders, revenue, price, verdict). */
function bsxSorted(rows, sort) {
  const k = sort.k, dir = sort.dir || 1;
  const v = x => (k === 'name' ? x.name.toLowerCase() : k === 'rank' ? (x.r && x.r.a > 0 ? x.r.a : null) : k === 'orders' ? x.uA : k === 'revenue' ? x.sA : k === 'price' ? x.price : k === 'verdict' ? BSX_V[x.verdict].o : null);
  return rows.slice().sort((a, b) => {
    if (k === 'default') return (a.verdict === 'act' ? 0 : 1) - (b.verdict === 'act' ? 0 : 1) || b.risk - a.risk || b.sA - a.sA || a.name.localeCompare(b.name);
    const x = v(a), y = v(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir;
  });
}
const bsxChange = (d, p, money) => {
  if (!d && !p) return '<span class="bsx-ch is-flat">—</span>';
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  return `<span class="bsx-ch is-${cls}">${d > 0 ? '+' : d < 0 ? '−' : ''}${money ? '$' + bsxNf(Math.abs(d)) : bsxNf(Math.abs(d))}${p != null ? ` (${bsxPctTxt(p)})` : ''}</span>`;
};
// The rank, Amazon's way: "#3,100 in Tablecloths", the main category smaller below, the change (lower number = better).
function bsxRankHtml(x, big) {
  const r = x.rank;
  if (!x.r || !(x.r.a > 0)) return `<span class="bsx-rk"><span class="muted">${x.r && x.r.b > 0 ? 'no rank this week' : 'no rank'}</span></span>${r.ch ? `<span class="bsx-rch is-${r.cls || 'flat'}">${bsxEsc(r.ch)}</span>` : ''}`;
  const main = x.kind === 'sub' && x.main > 0 && x.mainCat ? `<small class="bsx-main">#${bsxNf(x.main)} in ${bsxEsc(x.mainCat)}</small>` : '';
  return `<span class="bsx-rk${big ? ' is-big' : ''}"><b>${bsxEsc(r.now)}</b> in ${bsxEsc(r.cat || (x.kind === 'main' ? x.mainCat : '') || 'its category')}</span>${main}`
    + (r.ch ? `<span class="bsx-rch is-${r.cls || 'flat'}" title="Lower rank number = better on Amazon">${bsxEsc(r.ch)}</span>` : '');
}
const bsxPill = v => `<span class="bsx-pill is-${BSX_V[v].cls}">${BSX_V[v].e ? BSX_V[v].e + ' ' : ''}${bsxEsc(BSX_V[v].t)}</span>`;
// The verdict's plain line for one family, with its numbers.
function bsxLine(x) {
  // the rank is named only when it really moved (10% and a real distance): better = a lower number
  const rk = x.r && x.r.pct != null && (x.move === 'better' || x.move === 'worse') ? `rank ${x.move} by ${Math.round(Math.abs(x.r.pct) * 100)}%` : '';
  const rv = x.sB > 0 ? `revenue ${x.dS >= 0 ? '+' : '−'}${bsxMoney(Math.abs(x.dS))} (${bsxPctTxt(x.pS)})` : `revenue ${bsxMoney(x.sA)}`;
  switch (x.verdict) {
    case 'grow': return `Growing: ${[rk, rv].filter(Boolean).join(', ')}${rk ? '' : ', rank held'}.`;
    case 'check': return `${rk ? 'Ranking better but ' : 'Rank held but '}${rv} — check price and conversion.`;
    case 'act': return `Needs action: ${rk}, ${rv}.`;
    case 'busy': return `Rank slipped (${rk.replace(/^rank /, '')}) but ${rv} — the category is busier; OK.`;
    case 'steady': return 'Holding steady — rank and revenue within 10%.';
    case 'low': return `Too few orders to judge (${bsxNf(x.uA)} and ${bsxNf(x.uB)}).`;
    case 'cat': return 'Amazon moved it to another category — the ranks cannot be compared.';
    default: return `No rank to compare · ${rv}.`;
  }
}
function bsxPaint() {
  const res = BSX.res;
  if (!res) { const s = bsxEl('bsxStory'); if (s) s.textContent = BSX.err || 'Not read yet.'; return; }
  const p = BSX_PERIODS.find(x => x.k === BSX.period) || BSX_PERIODS[0];
  const asof = bsxEl('bsxAsof');
  const at = res.at ? `updated ${bsxDay(res.at.slice(0, 10))} ${res.at.slice(11, 16)} IST · ` : '';
  const wk = Object.entries(res.weeks).map(([b, w]) => (w.a ? `${res.brands.length > 1 ? bsxName(b) + ' ' : ''}ranks ${w.a.replace(/^\d{4}-/, '')} vs ${w.b ? w.b.replace(/^\d{4}-/, '') : '—'}` : '')).filter(Boolean).join(' · ');
  if (asof) asof.innerHTML = `${bsxEsc(at)}Amazon data 1–2 days late · <b>${bsxEsc(res.per.label)}</b>${wk ? ' · ' + bsxEsc(wk) : ''}${res.kpi.est ? ' · ≈ part of a week from the weekly totals' : ''}`;
  const story = bsxEl('bsxStory');
  if (story) story.textContent = bsxStory(res, p.word);
  bsxKpis(res);
  bsxDecision(res);
  bsxChipsPaint(res);
  bsxTablePaint();
  const foot = bsxEl('bsxFoot');
  if (foot) foot.innerHTML = `Ranks: the sub-category rank (main when there is none), the newest stored week against the one ${p.n === 1 ? 'a week' : p.n ? p.n + ' weeks' : 'a month'} before — a move counts at 10% and a real distance; low sellers are noise. `
    + `<b>Lower rank number = better.</b> Orders = units ordered; revenue = ordered sales — the same per-day figures as Sales Alerts and Numbers Check (US Pacific days). `
    + `Verdict: 🟢 rank and revenue up · 🟡 rank up, revenue flat or down · 🔴 rank and revenue down · ⚪ rank down, revenue held · fewer than ${BSX_M.lowOrders} orders in both periods: too few to judge. Revenue moves at ${Math.round(BSX_M.revMove * 100)}%.`;
  if (BSX.panel) bsxPanelDraw();
}
function bsxKpis(res) {
  const el = bsxEl('bsxKpis');
  if (!el) return;
  const k = res.kpi;
  const pct = (a, b) => (b > 0 ? (a - b) / b : null);
  const arrow = p => (p == null ? '' : `<span class="bsx-kd is-${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p) < 0.1 ? (Math.round(Math.abs(p) * 1000) / 10).toFixed(1) : Math.round(Math.abs(p) * 100)}%</span>`);
  const card = (f, t, v, sub, cls, raw) => `<button type="button" class="bsx-kpi${cls ? ' is-' + cls : ''}${BSX.f === f && f ? ' is-on' : ''}" data-bsx-f="${f}" aria-pressed="${BSX.f === f && !!f}">`
    + `<span class="bsx-kn">${t}</span><b data-to="${raw}" data-fmt="${String(v).startsWith('$') ? 'money' : 'n'}">${v}</b><span class="bsx-ks">${sub}</span></button>`;
  el.innerHTML = card('', 'Revenue', bsxMoney(k.sA), arrow(pct(k.sA, k.sB)) + ` <span class="muted">vs ${bsxMoney(k.sB)}</span>`, '', k.sA)
    + card('', 'Orders', bsxNf(k.uA), arrow(pct(k.uA, k.uB)) + ` <span class="muted">vs ${bsxNf(k.uB)}</span>`, '', k.uA)
    + card('better', 'Ranking better', bsxNf(k.better), 'families', '', k.better)
    + card('worse', 'Ranking worse', bsxNf(k.worse), 'families', '', k.worse)
    + card('act', 'Needs action', bsxNf(k.act), 'rank and revenue down', k.act ? 'bad' : '', k.act);
  if (!BSX.counted) { BSX.counted = true; bsxCount(el); }
}
// The numbers count up once from 0 to their text (✨ off or reduced motion: the text at once). Ends on the exact text.
function bsxCount(el) {
  if (!bsxFx() || typeof requestAnimationFrame !== 'function') return;
  const els = [...el.querySelectorAll('b[data-to]')];
  const t0 = performance.now(), dur = 700;
  const fin = els.map(b => b.textContent);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    els.forEach((b, i) => { if (!b.isConnected) return; const to = Number(b.dataset.to) || 0; b.textContent = k >= 1 ? fin[i] : b.dataset.fmt === 'money' ? bsxMoney(to * e) : bsxNf(to * e); });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => els.forEach((b, i) => { if (b.isConnected) b.textContent = fin[i]; }), dur + 400);   // the safety net
}
function bsxDecCard(x, win) {
  const task = typeof tkBtnHtml === 'function' && !win ? tkBtnHtml({ src: 'bsr', brand: x.brand, key: x.key, parent: x.parent, name: x.name, problem: bsxLine(x), kind: 'bsr', ref: 'bsx|' + x.key, pick: x.act }, 'bsx-btn', '+ Task') : '';
  return `<article class="bsx-card is-${win ? 'win' : 'act'}" data-bsx-open="${bsxEsc(x.key)}" tabindex="0" aria-label="${bsxEsc(x.name)} — open details">`
    + `<div class="bsx-card-h"><h3>${bsxEsc(x.name)}</h3><span class="bsx-brand">${bsxEsc(bsxName(x.brand))}</span></div>`
    + `<div class="bsx-card-r">${bsxRankHtml(x)}</div>`
    + `<div class="bsx-card-m"><span><b>${bsxMoney(x.sA)}</b> revenue ${bsxChange(x.dS, x.pS, true)}</span><span>${bsxNf(x.uA)} orders ${bsxChange(x.dU, x.pU)}</span></div>`
    + `<p class="bsx-why"><span class="muted">Why:</span> ${bsxEsc(x.why || 'nothing known explains it')}</p>`
    + `<div class="bsx-card-a"><span class="bsx-do is-${win ? 'win' : 'act'}">${bsxEsc(x.act || (win ? 'Keep going' : 'Look into it'))}</span>${task}</div></article>`;
}
function bsxDecision(res) {
  const el = bsxEl('bsxDec');
  if (!el) return;
  const word = (BSX_PERIODS.find(x => x.k === BSX.period) || BSX_PERIODS[0]).word;
  el.innerHTML = `<div class="bsx-col"><h2 class="bsx-ch2">🔴 Act now</h2>${res.act3.length ? res.act3.map(x => bsxDecCard(x, false)).join('') : `<p class="bsx-empty">Nothing needs action ${bsxEsc(word)} ✅</p>`}</div>`
    + `<div class="bsx-col"><h2 class="bsx-ch2">🟢 Winning</h2>${res.win3.length ? res.win3.map(x => bsxDecCard(x, true)).join('') : `<p class="bsx-empty">No family is ranking and selling better ${bsxEsc(word)} yet.</p>`}</div>`;
}
function bsxChipsPaint(res) {
  const el = bsxEl('bsxChips');
  if (!el) return;
  const n = f => (f === '' ? res.rows.length : f === 'top' ? res.rows.filter(x => x.top).length : res.rows.filter(x => x.verdict === f).length);
  el.innerHTML = BSX_CHIPS.map(([f, t]) => `<button type="button" class="bsx-chip${BSX.f === f ? ' is-on' : ''}" data-bsx-f="${f}" aria-pressed="${BSX.f === f}">${t} <b>${bsxNf(n(f))}</b></button>`).join('')
    + (BSX.f === 'better' || BSX.f === 'worse' ? `<span class="bsx-fnote">Showing: ranking ${BSX.f} <button type="button" class="bsx-link" data-bsx-f="">Show all</button></span>` : '');
}
const BSX_COLS = [['name', 'Family'], ['rank', 'Rank'], ['orders', 'Orders'], ['revenue', 'Revenue'], ['price', 'Avg price'], ['verdict', 'Verdict']];
function bsxTablePaint() {
  const t = bsxEl('bsxTable');
  if (!t || !BSX.res) return;
  const rows = bsxShown();
  const sh = rows.slice(0, BSX.limit);
  const head = '<thead><tr>' + BSX_COLS.map(([k, n], i) => {
    const on = BSX.sort.k === k;
    return `<th scope="col" class="${i ? (i < 5 && i > 1 ? 'num' : '') : 'bsx-fz'}" aria-sort="${on ? (BSX.sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="bsx-th" data-bsx-sort="${k}"${k === 'rank' ? ' title="Lower rank number = better on Amazon"' : ''}>${n}${on ? (BSX.sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  }).join('') + '</tr></thead>';
  const row = x => `<tr tabindex="0" data-bsx-row="${bsxEsc(x.key)}" class="${BSX.panel === x.key ? 'is-open' : ''}" aria-label="${bsxEsc(x.name)}: ${bsxEsc(BSX_V[x.verdict].t)} — Enter for details">`
    + `<td class="bsx-fz"><span class="bsx-fn">${bsxEsc(x.name)}</span><small>${bsxEsc(bsxName(x.brand))} · ${x.sizes ? bsxNf(x.sizes) + ' size' + (x.sizes === 1 ? '' : 's') : bsxEsc(x.parent)}</small></td>`
    + `<td>${bsxRankHtml(x)}</td>`
    + `<td class="num"><b>${bsxNf(x.uA)}</b>${bsxChange(x.dU, x.pU)}</td>`
    + `<td class="num"><b>${bsxMoney(x.sA)}</b>${bsxChange(x.dS, x.pS, true)}</td>`
    + `<td class="num">${bsxPrice(x.price)}</td>`
    + `<td>${bsxPill(x.verdict)}<small class="bsx-vl">${bsxEsc(bsxLine(x))}</small></td></tr>`;
  t.innerHTML = head + '<tbody>' + (sh.length ? sh.map(row).join('') : `<tr><td colspan="6" class="bsx-empty">${BSX.q || BSX.f ? 'No family matches.' : 'No families yet.'}</td></tr>`) + '</tbody>';
  const more = bsxEl('bsxMore');
  if (more) more.innerHTML = rows.length > BSX.limit ? `<button type="button" class="bsx-btn" data-bsx-act="more">Show more (${bsxNf(rows.length - BSX.limit)} left)</button>` : (rows.length ? `<span class="muted">${bsxNf(rows.length)} famil${rows.length === 1 ? 'y' : 'ies'}</span>` : '');
}

/* ----- one family: the side panel ----- */
const bsxRowOf = key => (BSX.res ? BSX.res.rows.find(x => x.key === key) : null);
function bsxPanelOpen(key) {
  if (!bsxRowOf(key)) return;
  BSX.panel = key;
  bsxTop();
  document.querySelectorAll('#bsxTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
  document.querySelectorAll(`#bsxTable tr[data-bsx-row="${CSS.escape(key)}"]`).forEach(tr => tr.classList.add('is-open'));
  bsxPanelDraw();
  const x = bsxRowOf(key);
  const need = (BSR_WEEKS[x.brand] || []).slice(-12).filter(w => !BSR[x.brand][w]);
  if (need.length) (async () => { for (const w of need) await loadBsrWeek(x.brand, w); if (BSX.panel === key) bsxPanelDraw(); })();
  const box = bsxEl('bsxPanel');
  if (box) { const c = box.querySelector('[data-bsx-act="close"]'); if (c && c.focus) c.focus(); }
}
function bsxPanelClose() {
  const was = BSX.panel;
  BSX.panel = '';
  if (BSX.chart) { try { BSX.chart.dispose(); } catch (e) { /* gone */ } BSX.chart = null; }
  const box = bsxEl('bsxPanel');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  document.querySelectorAll('#bsxTable tr.is-open').forEach(tr => tr.classList.remove('is-open'));
  const tr = was && document.querySelector(`#bsxTable tr[data-bsx-row="${CSS.escape(was)}"]`);
  if (tr && tr.focus) tr.focus();
}
/** A family's sizes: each child's rank (week A / B), orders, revenue and change, and its own verdict. */
function bsxKids(x) {
  const res = BSX.res;
  const r = x.r;
  const rows = ((typeof HEALTH !== 'undefined' && HEALTH[x.brand] && HEALTH[x.brand].rows) || []).filter(row => (row.parent || row.asin) === x.parent);
  const seen = new Set();
  const out = [];
  rows.forEach(row => {
    const a = String(row.asin || '').toUpperCase();
    if (!a || seen.has(a)) return;
    seen.add(a);
    const pick = e => { const k = e && e.k && e.k[a]; return k ? (x.kind === 'sub' ? k[1] || 0 : k[0] || 0) : 0; };
    const ra = r ? pick(r.entryA) : 0, rb = r ? pick(r.entryB) : 0;
    const A = bsxSum([a], res.per.a[0], res.per.a[1], res.src), B = bsxSum([a], res.per.b[0], res.per.b[1], res.src);
    const move = ra > 0 && rb > 0 ? bsrMove(ra, rb, x.kind || 'sub') : null;
    out.push({ asin: a, sku: row.sku, name: [row.color, row.size].filter(Boolean).join(' · ') || row.sku || a, ra, rb, rank: bsxRankParts(ra, rb, '', move, false),
      uA: A.u, uB: B.u, sA: A.s, sB: B.s, dS: A.s - B.s, pS: B.s > 0 ? (A.s - B.s) / B.s : null, verdict: bsxVerdict({ move, uA: A.u, uB: B.u, sA: A.s, sB: B.s }) });
  });
  out.sort((p, q) => q.sA - p.sA);
  if (out.length > 1) {
    const best = out.reduce((m, k) => (k.dS > m.dS ? k : m), out[0]), worst = out.reduce((m, k) => (k.dS < m.dS ? k : m), out[0]);
    if (best.dS > 0) best.best = true;
    if (worst.dS < 0 && worst !== best) worst.worst = true;
  }
  return out;
}
// The weeks of the chart: the last 12 stored weeks — the rank used, the revenue of the sales week (Sunday before the Monday), our changes.
function bsxChartData(x) {
  const res = BSX.res;
  const weeks = (BSR_WEEKS[x.brand] || []).slice(-12);
  const skus = new Set(((typeof HEALTH !== 'undefined' && HEALTH[x.brand] && HEALTH[x.brand].rows) || []).filter(row => (row.parent || row.asin) === x.parent).map(row => row.sku).filter(Boolean));
  const lh = (typeof LH !== 'undefined' && LH.rows) || [];
  return weeks.map(w => {
    const e = (BSR[x.brand][w] || {})[x.parent];
    const rank = e ? (x.kind === 'main' ? e.rank : e.sub || (x.kind ? 0 : e.rank)) || null : null;
    const sw = bsrSalesWeek(w);
    const end = [bsxAdd(sw, 6), res.last].sort()[0];
    const rev = sw && sw <= res.last ? bsxSum(x.asins, sw, end, res.src).s : null;
    const mon = bsrMonday(w), from = mon ? mon.getTime() : 0, to = from + 7 * 864e5;
    const ours = lh.filter(row => skus.has(row.sku) && row.at >= from && row.at < to && !['rejected', 'notsent'].includes(row.result))
      .map(row => (typeof lhWhat === 'function' ? lhWhat(row) : row.field || 'listing') + ' changed');
    return { w, rank, rev, ours: [...new Set(ours)] };
  });
}
function bsxPanelDraw() {
  const box = bsxEl('bsxPanel');
  const x = bsxRowOf(BSX.panel);
  if (!box || !x) return;
  const facts = (x.r && x.r.decision && x.r.decision.facts) || [];
  const why = facts.length ? facts.map(f => `<li>${bsxEsc(f.txt)}</li>`).join('') : '<li class="muted">No fact known for these weeks (units, price, deals, ads, stock, Buy Box, our changes).</li>';
  const acts = [];
  if (x.act) acts.push(x.act);
  facts.forEach(f => { const a = bsxActOf(f.act, f.k); if (a && !acts.includes(a) && x.verdict !== 'grow') acts.push(a); });
  const todo = acts.slice(0, 3).map(a => `<li><span class="bsx-do is-${x.verdict === 'grow' ? 'win' : 'act'}">${bsxEsc(a)}</span></li>`).join('') || '<li class="muted">Nothing to do — keep watching.</li>';
  const task = typeof tkBtnHtml === 'function' ? tkBtnHtml({ src: 'bsr', brand: x.brand, key: x.key, parent: x.parent, name: x.name, problem: bsxLine(x), kind: 'bsr', ref: 'bsx|' + x.key, pick: x.act }, 'bsx-btn', '+ Task') : '';
  const kids = bsxKids(x);
  const kidRows = kids.map(k => `<tr class="${k.best ? 'is-best' : k.worst ? 'is-worst' : ''}"><td><span class="bsx-fn">${bsxEsc(k.name)}</span><small>${bsxEsc(k.sku || k.asin)}${k.best ? ' · best' : k.worst ? ' · worst' : ''}</small></td>`
    + `<td>${k.ra > 0 ? '#' + bsxNf(k.ra) : '<span class="muted">—</span>'}${k.rank.ch && k.rb > 0 && k.ra > 0 ? `<span class="bsx-rch is-${k.rank.cls}">${bsxEsc(k.rank.ch)}</span>` : ''}</td>`
    + `<td class="num">${bsxNf(k.uA)}</td><td class="num"><b>${bsxMoney(k.sA)}</b>${bsxChange(k.dS, k.pS, true)}</td><td>${bsxPill(k.verdict)}</td></tr>`).join('');
  box.innerHTML = `<header class="bsx-ph"><div><h2>${bsxEsc(x.name)}</h2><p>${bsxEsc(bsxName(x.brand))} · ${bsxEsc(x.parent)} · ${bsxPill(x.verdict)}</p><div class="bsx-ph-r">${bsxRankHtml(x, true)}</div></div>`
    + `<button type="button" class="bsx-x" data-bsx-act="close" aria-label="Close (Esc)">✕</button></header>`
    + `<div class="bsx-pb"><p class="bsx-pline">${bsxEsc(bsxLine(x))}</p>`
    + `<h3 class="bsx-h3">Rank and revenue — last 12 weeks</h3><div class="bsx-chart" id="bsxChart" role="img" aria-label="Rank by week (up = better) and weekly revenue"></div>`
    + `<h3 class="bsx-h3">Why it moved</h3><ul class="bsx-facts">${why}</ul>`
    + `<h3 class="bsx-h3">What to do</h3><ul class="bsx-todo">${todo}</ul><div class="bsx-btns">${task}`
    + `<button type="button" class="bsx-btn" data-bsx-go="health">Open in Listing Health</button><button type="button" class="bsx-btn" data-bsx-go="salert">Open in Sales Alerts</button></div>`
    + `<h3 class="bsx-h3">Sizes</h3>${kids.length ? `<div class="bsx-tw"><table class="bsx-kids"><thead><tr><th scope="col">Size</th><th scope="col">Rank</th><th scope="col" class="num">Orders</th><th scope="col" class="num">Revenue</th><th scope="col">Verdict</th></tr></thead><tbody>${kidRows}</tbody></table></div>` : '<p class="muted">No sizes in Listing Health for this family.</p>'}</div>`;
  box.hidden = false;
  bsxChartDraw(x);
}
function bsxChartDraw(x) {
  const el = bsxEl('bsxChart');
  if (!el) return;
  const pts = bsxChartData(x);
  const fallback = () => { el.innerHTML = typeof bsrChartSvg === 'function' ? bsrChartSvg(pts.map(p => ({ w: p.w, v: p.rank })), 'rank') : ''; };
  const load = typeof sdcLoadCharts === 'function' ? sdcLoadCharts() : Promise.resolve(!!(typeof window !== 'undefined' && window.echarts));
  load.then(ok => {
    if (!ok || !window.echarts || !el.isConnected || BSX.panel !== x.key) { if (el.isConnected && !el.firstChild) fallback(); return; }
    if (BSX.chart) { try { BSX.chart.dispose(); } catch (e) { /* gone */ } }
    const css = n => getComputedStyle(bsxEl('bsxPanel') || document.documentElement).getPropertyValue(n).trim();
    const c = { ink: css('--bx-ink'), muted: css('--bx-muted'), line: css('--bx-line'), blue: css('--bx-blue'), bar: css('--bx-bar'), amber: css('--bx-amber'), card: css('--bx-card') };
    try {
      const ch = BSX.chart = window.echarts.init(el, null, { renderer: 'svg' });
      ch.setOption({
        animation: bsxFx(), grid: { left: 58, right: 58, top: 26, bottom: 28 },
        tooltip: { trigger: 'axis', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 },
          formatter: ps => { const p = pts[ps[0].dataIndex]; return `<b>${bsxEsc(p.w)}</b><br>Rank ${p.rank ? '#' + bsxNf(p.rank) : '—'}<br>Revenue ${p.rev == null ? '—' : bsxMoney(p.rev)}${p.ours.length ? '<br>Our change: ' + bsxEsc(p.ours.join(', ')) : ''}`; } },
        xAxis: { type: 'category', data: pts.map(p => p.w.replace(/^\d{4}-/, '')), axisLabel: { color: c.muted, fontSize: 10 }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
        yAxis: [
          { type: 'value', inverse: true, name: 'Rank (up = better)', nameLocation: 'start', nameGap: 12, nameTextStyle: { color: c.muted, fontSize: 10, align: 'left' }, scale: true, axisLabel: { color: c.muted, fontSize: 10, formatter: v => '#' + bsxNf(v) }, splitLine: { lineStyle: { color: c.line } } },
          { type: 'value', name: 'Revenue', nameTextStyle: { color: c.muted, fontSize: 10 }, axisLabel: { color: c.muted, fontSize: 10, formatter: v => bsxMoney(v) }, splitLine: { show: false } },
        ],
        series: [
          { type: 'bar', name: 'Revenue', yAxisIndex: 1, data: pts.map(p => p.rev), itemStyle: { color: c.bar, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 22 },
          { type: 'line', name: 'Rank', yAxisIndex: 0, data: pts.map(p => p.rank || null), connectNulls: false, symbolSize: 6, lineStyle: { color: c.blue, width: 2.5 }, itemStyle: { color: c.blue },
            markPoint: { symbol: 'pin', symbolSize: 26, itemStyle: { color: c.amber }, label: { show: false },
              data: pts.map((p, i) => (p.ours.length && p.rank ? { coord: [i, p.rank], name: p.ours.join(', ') } : null)).filter(Boolean) } },
        ],
      });
    } catch (e) { fallback(); }
  });
}

/* ----- the CSV: what is on screen ----- */
const BSX_CSV_COLS = ['Brand', 'Family (parent)', 'Name', 'Sizes', 'Category', 'Rank now', 'Rank before', 'Rank change', 'Rank change %', 'Main rank now', 'Main category',
  'Orders now', 'Orders before', 'Orders change %', 'Revenue now', 'Revenue before', 'Revenue change', 'Revenue change %', 'Avg price', 'Verdict', 'Why', 'Suggested action', 'Period now', 'Period before', 'Rank weeks'];
function bsxCsv() {
  const res = BSX.res;
  if (!res) return { n: 0, text: '' };
  // a cell a spreadsheet could read as a formula is quoted; a plain negative number (-40%, -1600.00) is not
  const q = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) || /^[=+@]/.test(s) || (/^-/.test(s) && !/^-[\d.]+%?$/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const p2 = v => (v == null ? '' : Math.round(v * 1000) / 10 + '%');
  const lines = bsxShown().map(x => {
    const r = x.r, w = res.weeks[x.brand] || {};
    return [bsxName(x.brand), x.parent, x.name, x.sizes, x.rank.cat || '', r && r.a ? r.a : '', r && r.b ? r.b : '', r && r.a && r.b ? r.a - r.b : '', r && r.pct != null ? p2(r.pct) : '',
      x.main || '', x.mainCat || '', Math.round(x.uA), Math.round(x.uB), p2(x.pU), (Math.round(x.sA * 100) / 100).toFixed(2), (Math.round(x.sB * 100) / 100).toFixed(2), (Math.round(x.dS * 100) / 100).toFixed(2), p2(x.pS),
      x.price ? x.price.toFixed(2) : '', BSX_V[x.verdict].t, x.why || '', x.act || '', res.per.a.join(' to '), res.per.b.join(' to '), w.a ? `${w.a} vs ${w.b || '—'}` : ''].map(q).join(',');
  });
  return { n: lines.length, text: '﻿' + [BSX_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function bsxDownload() {
  const out = bsxCsv();
  if (!out.n) return out;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-BSR-Audit-${BSX.period}-${BSX.brand}-${bsxToday()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}

/* ----- the modes: the decision page (Compare) and the existing Full history ----- */
function bsxMode(mode) {
  const on = mode !== 'history';
  const pane = bsxEl('bsxPane'), old = bsxEl('bsxOld');
  if (pane) pane.classList.toggle('hide', !on);
  if (old) old.classList.toggle('hide', on);
  if (!on) bsxPanelClose();
}
/** The tab opened (bsr-audit.js ensureBsr): the frame at once, the sales read in parallel with the ranks. */
function bsxOpen() {
  bsxMode(typeof BSR_MODE !== 'undefined' ? BSR_MODE : 'compare');
  bsxShell();
  bsxTop();
  if (!(typeof VI !== 'undefined' && VI && VI.data) && typeof viLoad === 'function' && !BSX.vi) BSX.vi = viLoad().then(() => bsxRender()).catch(() => { BSX.err = 'The sales could not be read.'; });
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const on = s => (e.target && e.target.closest ? e.target.closest(s) : null);
    const panel = bsxEl('bsxPanel');
    if (BSX.panel && panel && !panel.hidden && !on('#bsxPanel') && !on('#bsxTable tr[data-bsx-row]') && !on('[data-bsx-open]') && !on('#tkF, .tk-dlg, [data-tk-new]')) bsxPanelClose();
    if (!on('#paneBsr')) return;
    const t = on('[data-bsx-act], [data-bsx-brand], [data-bsx-f], [data-bsx-sort], [data-bsx-go], [data-bsx-open], #bsxTable tr[data-bsx-row]');
    if (!t) return;
    if (t.matches('[data-tk-new]') || on('[data-tk-new]')) return;
    const d = t.dataset;
    if (d.bsxAct === 'csv') return bsxDownload();
    if (d.bsxAct === 'history') return setBsrMode('history');
    if (d.bsxAct === 'more') { BSX.limit += BSX_M.page; return bsxTablePaint(); }
    if (d.bsxAct === 'close') return bsxPanelClose();
    if (d.bsxBrand) {
      BSX.brand = d.bsxBrand; bsxLs.set('bsxBrand', BSX.brand); BSX.limit = BSX_M.page; BSX.counted = false;
      document.querySelectorAll('#bsxPane [data-bsx-brand]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.bsxBrand === BSX.brand)));
      return bsxRender();
    }
    if (d.bsxF != null && t.matches('[data-bsx-f]')) {
      BSX.f = BSX.f === d.bsxF && t.classList.contains('bsx-kpi') ? '' : d.bsxF; BSX.limit = BSX_M.page;
      bsxKpis(BSX.res); bsxChipsPaint(BSX.res); return bsxTablePaint();
    }
    if (d.bsxSort) { BSX.sort = { k: d.bsxSort, dir: BSX.sort.k === d.bsxSort ? -BSX.sort.dir : ['name', 'rank', 'verdict'].includes(d.bsxSort) ? 1 : -1 }; return bsxTablePaint(); }
    if (d.bsxGo) {
      const x = bsxRowOf(BSX.panel);
      if (!x) return undefined;
      if (d.bsxGo === 'salert') { if (typeof AL !== 'undefined') AL.brand = x.brand; if (typeof showTab === 'function') showTab('salert'); return undefined; }
      if (typeof showTab === 'function') showTab('health');
      setTimeout(() => { if (typeof hFocusOpen === 'function') hFocusOpen(x.brand, x.parent); }, 300);
      return undefined;
    }
    const key = d.bsxOpen || d.bsxRow;
    if (key) return bsxPanelOpen(key);
    return undefined;
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (!el || !el.closest || !el.closest('#bsxPane') || !el.dataset) return;
    if (el.dataset.bsx === 'period') { BSX.period = el.value; BSX.limit = BSX_M.page; BSX.counted = false; bsxRender(); }
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el || !el.closest || !el.closest('#bsxPane') || !el.dataset || el.dataset.bsx !== 'q') return;
    BSX.q = el.value || '';
    clearTimeout(BSX.qt);
    BSX.qt = setTimeout(() => { BSX.limit = BSX_M.page; bsxTablePaint(); }, 150);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && BSX.panel) { bsxPanelClose(); return; }
    const tr = e.target && e.target.closest ? e.target.closest('#bsxTable tr[data-bsx-row], [data-bsx-open]') : null;
    if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bsxPanelOpen(tr.dataset.bsxRow || tr.dataset.bsxOpen); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tr.dataset.bsxRow) {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (n && n.focus) n.focus();
    }
  });
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (BSX.chart) { try { BSX.chart.resize(); } catch (e) { /* gone */ } } });
}
