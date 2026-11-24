/* ================= SALES · SALES ALERTS: real drops only, ranked by money (Sales card #3, 24 Nov 2026) =================
 * Screens: Sales → Check & alerts → "Sales Alerts" (tab 'salert', #paneSalert / #alPane); ONE card on the Dashboard (core/dashboard.js
 *          slot tAl: "3 need attention · $4,200/week at risk", the top three, Open →); a slim "Needs attention" strip on the Sales
 *          Dashboard (#alStrip, painted from sales/sales-charts.js sdcRender for the brand on view).
 * Does — EXPECTED SALES per product (parent level, its children inside), from the nightly per-product days (dailyAsin, US Pacific days):
 *   baseline   per weekday: the MEDIAN of that weekday over the 4 finished weeks before the last 14 days (one spike never moves it)
 *   season     ONLY EVER CALMS (24 Nov 2026, real data): the brand's last year for the same days (the 14 days 364 days back ÷ the 4
 *              baseline weeks 364 days back, the Sales Dashboard's 800-day history, capped 0.7–1.5) may lower what a drop is judged
 *              against (× min(1, f)) and raise what a win is judged against (× max(1, f)) — never the other way: one category's November
 *              must not make every product look down. Only the product's OWN last year (alOwnSeason, the weekly store — 26 weeks today,
 *              so never yet) may move it both ways. Applied to the 14 judged days only, never to the baseline weeks.
 *   self-check more than 30 % (AL_BASE_OUT) of the product's own normal days outside its own range → too irregular: not judged
 *              (listed under Not judged, logged in the console), never an alert or a win
 *   band       the normal range = baseline ± 1.5 × MAD (median absolute deviation of those 4 weeks) — but never narrower than
 *              ± AL_BAND_MIN (10 %) of the baseline: a steady product's 4 weeks are nearly equal (MAD ≈ 0), and a line instead of
 *              a range would call every ordinary day "low" — × the same season factor
 *   AN ALERT only when ALL hold (every threshold is a setting, AL_DEF): a SUSTAINED drop — the longest stretch ending on the last finished
 *   day (never today) in which MOST days are below the band (more than half, at least 3), its total ≥ 25 % under expected, and not
 *   back inside the band on the last 2 days (24 Nov 2026: was "3 days in a row", which one normal day reset) — normal sales ≥ $500 a
 *   week (small products never alert); a day without a sale is a $0 day. 1–2 low days, or the nightly not in yet for
 *   yesterday → "Waiting for data", never an alert. If the brand's same days LAST YEAR fell by a similar share → "Seasonal dip" (Watch).
 *   $ AT RISK = (expected − actual) per low day × 7 = $/week; it ranks everything. SEVERITY: Critical ≥ $2,000/week or 7+ low days,
 *   Important ≥ $500/week, Watch the rest. LIFE CYCLE from the data itself: New (3rd low day today) → Ongoing (day N) → Recovered (back
 *   inside the band 2 days, shown this week) → gone. Dismiss / Snooze 7 days are kept with who and when (history/salesalerts).
 *   ROOT CAUSE, only what the data shows, top one first (else "No clear cause — check listing / Buy Box"): out of stock (FBA 0, or
 *   under 3 days of cover — stock/{brand}, as of its date) · a Deal Calendar deal ended · price moved ≥ 8 % (like for like: each
 *   child's sales ÷ units against its own normal price — a sold-out dear size never reads as a price cut) · ads cut ≥ 40 % with ad sales down (adsAsinDay) · traffic down ≥ 20 % with conversion normal · conversion down ≥ 20 %
 *   with sessions normal (weekly traffic report: only finished weeks — otherwise "sessions not in yet") · ad spend up ≥ 30 % while sales
 *   fell. Children of one parent are grouped by their own cause (out of stock / price per child).
 *   WINS: 3+ days above the band by ≥ 25 % (with the reason the data shows) and this week's recoveries.
 * READS ONLY, through the existing read-only loaders: viLoad (dailyAsin, stock/{brand}, PPC & Organic's store, Listing Health's parents),
 *   the nightly cache adsAsinDay (baCall cache read, as PPC & Organic reads it), the Sales Dashboard's history (SD / sdDays, as Numbers
 *   Check reads it), the Deal Calendar's document (audit/deals: its plan only). WRITES only Dismiss / Snooze / the settings, to
 *   history/salesalerts (else this browser). Never an Amazon refresh, never a number on another screen.
 * Main functions: alCompute (pure: everything above), alCauses, alLoad, alFor, alRender, alDashOf, alStripPaint. Every name starts with
 *   al / AL. Tests: tests/sales-alerts-test.js. */

const AL_DEF = { days: 3, drop: 25, minWeek: 500, critUsd: 2000, critDays: 7, impUsd: 500, recover: 2, season: 60,
  oosCover: 3, price: 8, traffic: 20, conv: 20, adsCut: 40, adsUp: 30 };
// The settings box: label and one line each (shown in "How we decide").
const AL_SET = [
  ['days', 'Low days (at least)', 'finished days below the normal range — and more than half the days of the drop'],
  ['drop', 'Drop at least (%)', 'against expected sales, over those days'],
  ['minWeek', 'Normal sales at least ($/week)', 'smaller products never alert'],
  ['critUsd', 'Critical from ($/week at risk)', 'or the low days below'],
  ['critDays', 'Critical from (low days)', 'a drop this long is Critical whatever its size'],
  ['impUsd', 'Important from ($/week at risk)', 'below this it is Watch'],
  ['recover', 'Recovered after (days)', 'days back inside the range'],
  ['season', 'Seasonal when last year fell (% of the drop)', 'the same days last year fell this share of the drop or more'],
  ['oosCover', 'Out of stock under (days of cover)', 'FBA units ÷ normal units a day'],
  ['price', 'Price change (%)', 'average selling price against the normal weeks'],
  ['traffic', 'Traffic change (%)', 'sessions, finished weeks'],
  ['conv', 'Conversion change (%)', 'units ÷ sessions, finished weeks'],
  ['adsCut', 'Ads cut (%)', 'ad spend a day against the normal weeks'],
  ['adsUp', 'Ads up (%)', 'ad spend a day against the normal weeks'],
];
const AL_DOC = ['history', 'salesalerts'];                  // dismiss / snooze / settings, shared (rules: history/{doc} — every Sales account)
const AL_LS = 'salesAlerts.v1';                             // this browser's copy, when the shared one cannot be written
const AL_SNOOZE_DAYS = 7;
const AL_BAND_MIN = 0.1;                                    // the normal range is at least ± 10 % of the usual sales (see the header)
const AL_BASE_OUT = 0.3;                                    // the self-check: more of the product's own normal days than this outside its range → not judged
const AL = { v: 0, busy: null, data: null, res: {}, brand: 'SP', filter: '', cause: '', store: { marks: {}, settings: {} }, storeNote: '',
  charts: {}, tw: [], msg: '', at: 0, started: false };
const AL_BRAND_NAME = { SP: 'Ridhi', CPC: 'CPC', ALL: 'Ridhi + CPC' };
const AL_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AL_NF = new Intl.NumberFormat('en-US');

/* ----- small helpers (dates are US Pacific yyyy-MM-dd strings, compared as text) ----- */
const alD = k => new Date(k + 'T00:00:00Z');
const alAdd = (k, n) => new Date(alD(k).getTime() + n * 864e5).toISOString().slice(0, 10);
const alDow = k => alD(k).getUTCDay();
const alSun = k => alAdd(k, -alDow(k));
const alRange = (a, b) => { const out = []; for (let d = a; d <= b; d = alAdd(d, 1)) out.push(d); return out; };
const alDay = k => (k ? `${+k.slice(8, 10)} ${AL_MON[+k.slice(5, 7) - 1]}` : '—');                 // '2026-11-20' → '20 Nov'
const alMoney = v => (v < 0 ? '−$' : '$') + AL_NF.format(Math.round(Math.abs(v)));
const alMoney2 = v => '$' + (Math.round(v * 100) / 100).toFixed(2);
const alPctTxt = (v, signed) => (signed ? (v > 0 ? '+' : v < 0 ? '−' : '') : '') + Math.round(Math.abs(v)) + '%';
const alEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
function alMedian(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
const alMad = (a, m) => alMedian(a.map(x => Math.abs(x - m)));
const alSum = (days, f) => days.reduce((s, d) => s + (f(d) || 0), 0);

/* ----- THE ENGINE (pure: everything comes in through o) ----- */
/** o = { days: {d: asin→day→[units, sales], brand: asin→'SP'|'CPC', from, upTo, at}, today (PT), brand 'SP'|'CPC'|'ALL', parentOf(asin, b),
 *        nameOf(parent, asin, b), stock: {b: {m: sku→units, at, skuOf: asin→[sku]}}, weekly: {rows: asin→{brand, weeks: wk→{u, sessions}}, at},
 *        adsDay: {d: b→asin→day→[impr, clicks, spend, orders, sales], upTo, at}, plan: 'PARENT|week'→{t, v, s, d}, lyDaily: b→day→[sales…],
 *        settings, marks, now (ms) }. */
function alCompute(o) {
  const S = Object.assign({}, AL_DEF, o.settings || {});
  const days = o.days;
  if (!days || !days.d) return { ok: false, why: 'The nightly per-product days are not read yet.' };
  const yest = alAdd(o.today, -1);
  const last = days.upTo && days.upTo < yest ? days.upTo : yest;          // never today
  const missing = days.upTo ? alRange(alAdd(last, 1), yest) : [];
  const W0 = alAdd(last, -13);                                             // the last 14 finished days: where drops are looked for
  let weeks = 4;
  while (weeks > 1 && days.from && days.from > alAdd(W0, -7 * weeks)) weeks--;
  if (weeks < 2) return { ok: false, why: `The per-product days start ${alDay(days.from)} — at least two normal weeks before the last 14 days are needed.` };
  const B0 = alAdd(W0, -7 * weeks), B1 = alAdd(W0, -1);
  const base = alRange(B0, B1), win = alRange(W0, last), chart = alRange(alAdd(last, -27), last);
  const brands = o.brand === 'ALL' ? ['SP', 'CPC'] : [o.brand];
  // --- the groups: one per parent, its children inside ---
  const G = {};
  Object.entries(days.d).forEach(([asin, byDay]) => {
    const b = (days.brand && days.brand[asin]) || '';
    if (!brands.includes(b)) return;
    const parent = (o.parentOf && o.parentOf(asin, b)) || asin;
    const key = b + '|' + parent;
    const g = G[key] || (G[key] = { key, brand: b, parent, kids: {}, name: '' });
    g.kids[asin] = byDay || {};
    if (!g.name && o.nameOf) g.name = o.nameOf(parent, asin, b) || '';
  });
  // --- the season, per brand: last year's same days against last year's normal weeks (whole brand) ---
  const lyMean = (b, list) => {
    const m = o.lyDaily && o.lyDaily[b];
    if (!m) return null;
    let s = 0;
    for (const d of list) { const v = m[alAdd(d, -364)]; if (!v) return null; s += Number(v[0]) || 0; }
    return s / list.length;
  };
  const season = {};
  brands.forEach(b => {
    const lb = lyMean(b, base), lw = lyMean(b, win);
    season[b] = lb && lw != null ? { f: Math.min(1.5, Math.max(0.7, lw / lb)), raw: lw / lb, lb } : { f: 1, raw: null, lb: null };
  });
  const ctx = { o, S, last, base, win, chart, W0, B0, weeks, season, lyMean, now: o.now || Date.now() };
  if (o.trace != null) {                          // salesAlertsReport ('' = every product): every number used, for the products asked about
    const q = String(o.trace).toLowerCase();
    ctx.traced = [];
    ctx.trace = (g, t) => { if (!(g.name + ' ' + g.parent).toLowerCase().includes(q)) return; ctx.traced.push(alTraceOf(g, t, ctx)); };
  }
  const out = { alerts: [], waiting: [], recovered: [], wins: [], hidden: [], skipped: [], review: [] };
  Object.values(G).forEach(g => {
    if (!g.name) g.name = g.parent;
    const r = alEval(g, ctx);
    g.ev = alEvidence(g, ctx);
    if (r && (r.list === 'alerts' || r.list === 'wins')) {
      r.check = alVerify(r, g.ev, ctx);
      if (!r.check.ok) { r.kind = r.list; r.list = 'review'; }
    }
    g.res = r;
    if (r) out[r.list].push(r);
  });
  // dismissed / snoozed alerts step aside (shown on request), with who and when
  const marks = o.marks || {};
  out.alerts = out.alerts.filter(a => {
    const m = marks[a.id];
    const off = m && (m.a === 'dismiss' || (m.a === 'snooze' && m.until > ctx.now));
    if (off) { a.mark = m; out.hidden.push(a); }
    return !off;
  });
  const byMoney = (a, b) => b.atRisk - a.atRisk || a.name.localeCompare(b.name);
  out.alerts.sort(byMoney); out.waiting.sort(byMoney); out.hidden.sort(byMoney);
  out.wins.sort((a, b) => b.extra - a.extra); out.recovered.sort((a, b) => b.normalWeek - a.normalWeek);
  const n = sev => out.alerts.filter(a => a.sev === sev).length;
  const adsUpTo = o.adsDay && o.adsDay.upTo || '';
  out.skipped.sort((a, b) => b.normalWeek - a.normalWeek);
  out.review.sort((a, b) => (b.atRisk || b.extra || 0) - (a.atRisk || a.extra || 0));
  // the full check, one row per product (the CSV in "How we decide")
  out.rows = Object.values(G).map(g => alCheckRow(g, ctx)).sort((a, b) => a.order - b.order || b.normal - a.normal);
  return Object.assign(out, { ok: true, brand: o.brand, settings: S, last, missing, traced: ctx.traced || null, base: { from: B0, to: B1, weeks }, window: { from: W0, to: last },
    checked: Object.keys(G).length,
    counts: { critical: n('critical'), important: n('important'), watch: n('watch'), waiting: out.waiting.length, recovered: out.recovered.length, review: out.review.length },
    atRisk: out.alerts.reduce((s, a) => s + a.atRisk, 0),
    asOf: { sales: last, run: days.at || '', ads: adsUpTo, sessions: alSessionsUpTo(o.weekly, last), stock: brands.map(b => o.stock && o.stock[b] && o.stock[b].at).filter(Boolean).sort()[0] || '' },
    season: brands.map(b => season[b].raw == null ? null : season[b].f), seasonHeld: brands.some(b => season[b].raw != null) });
}
/** The product's OWN season, from its own last year in the weekly store (PPC & Organic's weeks, 364 days back): the judged weeks
 *  against its 4 normal weeks, capped 0.7–1.5 — or null when the store does not hold them (it keeps 26 weeks today, so: null). */
function alOwnSeason(g, ctx) {
  const W = ctx.o.weekly && ctx.o.weekly.rows;
  if (!W) return null;
  const wk0 = alSun(ctx.W0);
  const rev = k => { let s = null; Object.keys(g.kids).forEach(a => { const c = ((W[a] || {}).weeks || {})[k]; if (c && c.rev != null) s = (s || 0) + (Number(c.rev) || 0); }); return s; };
  const judged = [0, 7].map(i => rev(alAdd(wk0, i - 364))), normal = [7, 14, 21, 28].map(i => rev(alAdd(wk0, -i - 364)));
  if (judged.concat(normal).some(v => v == null)) return null;
  const nb = normal.reduce((s, v) => s + v, 0) / 4, jb = (judged[0] + judged[1]) / 2;
  return nb > 0 ? Math.min(1.5, Math.max(0.7, jb / nb)) : null;
}
// What salesAlertsReport prints for one product: its own weekly sales (the trust check's weeks: 7-day blocks ending on the last finished
// day — the normal weeks, then the 2 judged weeks), its normal per day, the expected used, the season factors, and how many of its
// normal days fall outside its range.
function alTraceOf(g, t, ctx) {
  const ev = alEvidence(g, ctx);
  const own = ev.N.concat([ev.J1, ev.J2]), br = ev.bN.concat([ev.bJ1, ev.bJ2]);
  const weeks = own.map((s, i) => ({ week: ev.labels[i], sales: Math.round(s), part: i < ev.N.length ? 'normal week' : 'judged week',
    brand: br[i] == null ? null : Math.round(br[i]) }));
  const normalDay = t.m.reduce((s, v) => s + v, 0) / 7;
  return { product: g.name, parent: g.parent, brand: g.brand, children: Object.keys(g.kids).length, normalPerDay: Math.round(normalDay),
    expectedUsedPerDay: Math.round(normalDay * t.fDown), brandSeason: ctx.season[g.brand].raw == null ? null : Math.round(ctx.season[g.brand].raw * 1000) / 1000,
    seasonUsedForDrops: Math.round(t.fDown * 1000) / 1000, seasonUsedForWins: Math.round(t.fUp * 1000) / 1000, ownLastYear: t.own, baselineDaysOutsideRange: Math.round(t.baseOut * 100) + '%', weeks };
}
/** One product's line in the full check: its weeks, the checks and its verdict. */
function alCheckRow(g, ctx) {
  const r = g.res, ev = g.ev, nAvg = alAvg(ev.N);
  const pct = v => (nAvg && v != null ? Math.round((v / nAvg - 1) * 100) : null);
  const bAvg = ev.bN.every(v => v != null) ? alAvg(ev.bN) : null;
  const bp = v => (bAvg && v != null ? Math.round((v / bAvg - 1) * 100) : null);
  const verdicts = {
    alerts: ['Confirmed drop', 1], wins: ['Confirmed win', 3], review: [r && r.kind === 'wins' ? 'Needs a look (win)' : 'Needs a look (drop)', 2], hidden: ['Confirmed drop — dismissed / snoozed', 1],
    waiting: ['Waiting for data', 4], recovered: ['Recovered', 5], skipped: ['Not judged', 6] };
  const v = r ? verdicts[r.list] : nAvg < ctx.S.minWeek ? ['Small — under ' + alMoney(ctx.S.minWeek) + '/week', 8] : ['No alert — inside its range', 7];
  const steady = ev.N.length && nAvg ? ev.N.every(x => Math.abs(x / nAvg - 1) * 100 <= AL_CHK.steady) : false;
  return { order: v[1], brand: AL_BRAND_NAME[g.brand], parent: g.parent, product: g.name, children: Object.keys(g.kids).length,
    weeks: ev.N.concat([ev.J1, ev.J2]).map(x => Math.round(x || 0)), labels: ev.labels, normal: Math.round(nAvg), j1: pct(ev.J1), j2: pct(ev.J2), brandJ1: bp(ev.bJ1), brandJ2: bp(ev.bJ2),
    steady: steady ? 'yes' : 'no', outside: r && r.baseOut != null ? Math.round(r.baseOut * 100) : null, season: r && r.fDown != null ? Math.round((r.list === 'wins' || r.kind === 'wins' ? r.fUp : r.fDown) * 1000) / 1000 : null,
    verdict: v[0], reason: r ? (r.check ? r.check.proof : r.why || r.head || '') : '', money: r ? Math.round(r.atRisk ? -r.atRisk : r.extra || 0) : 0, days: r ? (r.lows || r.highs || r.days || 0) : 0 };
}
// The last finished week (Sunday key) the weekly traffic report holds sessions for, up to `last`.
function alSessionsUpTo(weekly, last) {
  let best = '';
  Object.values((weekly && weekly.rows) || {}).forEach(r => Object.entries((r && r.weeks) || {}).forEach(([wk, c]) => {
    if (c && c.sessions != null && alAdd(wk, 6) <= last && wk > best) best = wk;
  }));
  return best ? alAdd(best, 6) : '';
}

/** One parent: an alert, waiting, recovered, a win — or nothing (null). */
function alEval(g, ctx) {
  const { o, S, last, base, win, chart, season } = ctx;
  const kids = Object.keys(g.kids);
  const sales = d => kids.reduce((s, a) => s + ((g.kids[a][d] || [])[1] || 0), 0);
  const units = d => kids.reduce((s, a) => s + ((g.kids[a][d] || [])[0] || 0), 0);
  // the normal range per weekday: median ± 1.5 × MAD of the baseline weeks, at least ± AL_BAND_MIN of the median
  const m = [], mad = [];
  const cover = [];                                // the distance that holds all but one of the weekday's normal values (3 of 4)
  for (let w = 0; w < 7; w++) {
    const vals = base.filter(d => alDow(d) === w).map(sales);
    m[w] = alMedian(vals); mad[w] = alMad(vals, m[w]);
    const dev = vals.map(v => Math.abs(v - m[w])).sort((x, y) => x - y);
    cover[w] = dev.length > 1 ? dev[dev.length - 2] : 0;
  }
  const normalWeek = m.reduce((s, v) => s + v, 0);
  if (normalWeek < S.minWeek) return null;                                       // small products never alert
  // BY CONSTRUCTION the range holds all but one of each weekday's normal values (24 Nov 2026: a Napkin whose normal weeks swing ±33 %
  // — steady by the trust check — had 36 % of its normal days outside a 1.5 × MAD range and was "not judged")
  const half = w => Math.max(1.5 * mad[w], AL_BAND_MIN * m[w], cover[w]);
  // THE SEASON ONLY CALMS (24 Nov 2026, found on real data): the brand's last year (a whole-brand shape — November's tablecloths)
  // may LOWER what a drop is judged against and RAISE what a win is judged against, never the other way round; only the product's
  // OWN last year (alOwnSeason) may move it either way. And only on the 14 judged days — the baseline weeks keep their own range.
  const own = alOwnSeason(g, ctx);
  const fb = season[g.brand].f;
  const fDown = own != null ? own : Math.min(1, fb), fUp = own != null ? own : Math.max(1, fb);
  const inWin = d => d >= ctx.W0;
  const exp = d => m[alDow(d)] * (inWin(d) ? fDown : 1);
  const expUp = d => m[alDow(d)] * (inWin(d) ? fUp : 1);
  const lo = d => Math.max(0, m[alDow(d)] - half(alDow(d))) * (inWin(d) ? fDown : 1);
  const hi = d => (m[alDow(d)] + half(alDow(d))) * (inWin(d) ? fUp : 1);
  const low = d => sales(d) < lo(d) - 0.005;
  const high = d => sales(d) > hi(d) + 0.005;
  const trail = test => { let n = 0; for (let i = win.length - 1; i >= 0 && test(win[i]); i--) n++; return win.slice(win.length - n); };
  const shape = { sales, units, exp, lo, hi, m, mad, f: fDown };
  const seriesOf = (flag, up) => chart.map(d => ({ d, v: d < (o.days.from || '') ? null : Math.round(sales(d) * 100) / 100, e: up ? expUp(d) : exp(d), lo: lo(d), hi: hi(d), red: !!(flag && flag.includes(d)) }));
  const baseG = { key: g.key, brand: g.brand, parent: g.parent, name: g.name, kids, normalWeek, baseWeeks: ctx.weeks, fDown, fUp, fBrand: season[g.brand].raw, fOwn: own };
  // THE SELF-CHECK: the range must hold most of the product's own normal days. When more than AL_BASE_OUT of them fall outside it,
  // its normal weeks are too irregular to judge a drop against — no alert, no win; listed (and logged) as "not judged".
  const outN = base.filter(d => { const v = sales(d), w = alDow(d); return v < Math.max(0, m[w] - half(w)) - 0.005 || v > m[w] + half(w) + 0.005; }).length;
  baseG.baseOut = outN / base.length;
  if (ctx.trace) ctx.trace(g, { m, mad, fDown, fUp, own, baseOut: baseG.baseOut, sales });
  if (baseG.baseOut > AL_BASE_OUT) return Object.assign(baseG, { list: 'skipped', sev: 'skipped', id: g.key + '|irregular', atRisk: 0, from: base[0], to: last, series: seriesOf(null),
    why: `${Math.round(baseG.baseOut * 100)}% of its own normal days fall outside its normal range (more than ${Math.round(AL_BASE_OUT * 100)}%) — too irregular to judge` });
  // --- a drop now ---
  // THE SUSTAINED DROP (24 Nov 2026, real data — a Pillow Insert low on 12 of the last 14 days showed "waiting: 1 low day so far",
  // because the old rule wanted S.days low days IN A ROW ending on the last day, and one normal day reset it): the LONGEST stretch,
  // ending on the list's last day and starting on a low day, in which MOST days are below the range (more than half, and at least
  // S.days of them) and whose TOTAL is S.drop % or more under expected. A fresh drop still alerts on its S.days-th low day; a drop
  // with a normal day in it keeps alerting, over all its days. Zero-sale days are $0 days (sales() sums what the day holds: nothing).
  // o.rule === 'run' is the old rule — only for salesAlertsReport's "before → after".
  const legacy = o.rule === 'run';
  const sustained = list => {
    if (legacy) {
      let n = 0; for (let i = list.length - 1; i >= 0 && low(list[i]); i--) n++;
      const part = list.slice(list.length - n), act = alSum(part, sales), ex = alSum(part, exp);
      return n >= S.days && ex && (1 - act / ex) * 100 >= S.drop ? { days: part, lows: n, act, ex } : null;
    }
    for (let L = list.length; L >= S.days; L--) {
      let i = list.length - L;
      while (i < list.length && !low(list[i])) i++;
      const part = list.slice(i);
      if (part.length < S.days) continue;
      const lows = part.filter(low).length;
      if (lows < S.days || lows * 2 <= part.length) continue;
      const act = alSum(part, sales), ex = alSum(part, exp);
      if (ex && (1 - act / ex) * 100 >= S.drop) return { days: part, lows, act, ex };   // longest first (L counts down)
    }
    return null;
  };
  const back = trail(d => !low(d));                // the last days back inside the range: S.recover of them → recovering, not a drop now
  const cur = back.length < S.recover ? sustained(win) : null;
  if (!cur) {
    // waiting: low on the last day(s), but not yet S.days low days — never an alert
    const run = trail(low);
    const act = alSum(run, sales), ex = alSum(run, exp);
    if (run.length && run.length < S.days && ex && (1 - act / ex) * 100 >= S.drop) {
      const need = S.days - run.length;
      return Object.assign(baseG, { run, from: run[0], to: run[run.length - 1], days: run.length, lows: run.length, drop: (1 - act / ex) * 100, act, exp: ex,
        atRisk: (ex - act) / run.length * 7, series: seriesOf(run), list: 'waiting', sev: 'waiting', id: g.key + '|' + run[0],
        why: ctx.o.days.upTo && ctx.o.days.upTo < alAdd(o.today, -1)
          ? `${run.length} low day${run.length === 1 ? '' : 's'} so far — the nightly days for ${alDay(alAdd(ctx.o.days.upTo, 1))} are not in yet`
          : `${run.length} low day${run.length === 1 ? '' : 's'} so far — an alert needs ${S.days} finished days (${need} more)` });
    }
  }
  if (cur) {
    const run = cur.days, act = cur.act, ex = cur.ex, lowDays = run.filter(low);
    const drop = (1 - act / ex) * 100;
    {
      const atRisk = (ex - act) / run.length * 7;
      const item = Object.assign(baseG, { run, lowDays, lows: cur.lows, from: run[0], to: run[run.length - 1], days: run.length, drop, act, exp: ex, atRisk, series: seriesOf(lowDays) });
      // seasonal? the brand's same days last year against its normal weeks last year
      const lyRun = season[g.brand].lb ? ctx.lyMean(g.brand, run) : null;
      const lyChange = lyRun != null ? (lyRun / season[g.brand].lb - 1) * 100 : null;
      const rawEx = run.reduce((s, d) => s + m[alDow(d)], 0);
      const rawDrop = rawEx ? (1 - act / rawEx) * 100 : 0;
      const seasonal = lyChange != null && lyChange <= -15 && -lyChange >= S.season / 100 * rawDrop;
      const causes = alCauses(g, item, shape, ctx);
      if (seasonal) causes.unshift({ k: 'season', conf: 'High', t: 'Seasonal dip', ev: `the same days last year fell ${alPctTxt(lyChange)} (${AL_BRAND_NAME[g.brand]} total)` });
      if (!causes.length) causes.push({ k: 'none', conf: '', t: 'No clear cause', ev: 'check listing / Buy Box' });
      const sev = seasonal ? 'watch' : atRisk >= S.critUsd || cur.lows >= S.critDays ? 'critical' : atRisk >= S.impUsd ? 'important' : 'watch';
      const fresh = !sustained(win.slice(0, -1));   // the last day made it an alert
      const span = cur.lows === run.length ? `for ${run.length} days` : `over ${run.length} days (${cur.lows} below normal)`;
      return Object.assign(item, { list: 'alerts', sev, causes, cause: causes[0], groups: alKidGroups(g, item, shape, ctx, causes[0]), rawExp: rawEx,
        state: fresh ? 'New' : `Day ${run.length}`, id: g.key + '|' + run[0], lyChange,
        head: `${alShort(g.name)} sales down ${Math.round(drop)}% ${span} — ${AL_HEAD[causes[0].k]}`, next: alNext(causes[0], item) });
    }
  }
  // --- recovered this week: an earlier drop (the same sustained rule), now back inside the range S.recover days or more ---
  const tail = back;
  if (tail.length >= S.recover && tail.length < win.length) {
    const end = alAdd(tail[0], -1);
    const was = sustained(win.filter(d => d <= end));
    const recAt = alAdd(end, S.recover);
    if (was && recAt >= alAdd(last, -6)) {
      const drop = (1 - was.act / was.ex) * 100;
      return Object.assign(baseG, { list: 'recovered', sev: 'recovered', from: was.days[0], to: end, days: was.days.length, lows: was.lows, drop, back: tail.length, recAt,
        atRisk: 0, series: seriesOf(was.days.filter(low)), head: `${alShort(g.name)} is back to normal — ${tail.length} days inside its range after ${was.lows} low days`, id: g.key + '|' + was.days[0] });
    }
  }
  // --- a win: the drop rule mirrored (24 Nov 2026 — a Napkin at +69 % / +150 % showed nothing: wins still wanted S.days high days IN
  //     A ROW): the longest stretch ending on the last day, starting on a high day, MOST days above the range (more than half, at least
  //     S.days), its total S.drop % or more above expected (expUp: the season never makes a win), not back inside the range on the
  //     last S.recover days ---
  const sustainedUp = list => {
    if (legacy) {
      let n = 0; for (let i = list.length - 1; i >= 0 && high(list[i]); i--) n++;
      const part = list.slice(list.length - n), act = alSum(part, sales), ex = alSum(part, expUp);
      return n >= S.days && ex && (act / ex - 1) * 100 >= S.drop ? { days: part, highs: n, act, ex } : null;
    }
    for (let L = list.length; L >= S.days; L--) {
      let i = list.length - L;
      while (i < list.length && !high(list[i])) i++;
      const part = list.slice(i);
      if (part.length < S.days) continue;
      const highs = part.filter(high).length;
      if (highs < S.days || highs * 2 <= part.length) continue;
      const act = alSum(part, sales), ex = alSum(part, expUp);
      if (ex && (act / ex - 1) * 100 >= S.drop) return { days: part, highs, act, ex };
    }
    return null;
  };
  const upBack = trail(d => !high(d));
  const w = upBack.length < S.recover ? sustainedUp(win) : null;
  if (w) {
    const gain = (w.act / w.ex - 1) * 100;
    const why = alWinWhy(g, w.days, shape, ctx);
    return Object.assign(baseG, { list: 'wins', sev: 'win', run: w.days, highDays: w.days.filter(high), highs: w.highs, from: w.days[0], to: w.days[w.days.length - 1], days: w.days.length,
      gain, act: w.act, exp: w.ex, rawExp: w.days.reduce((s, d) => s + m[alDow(d)], 0), extra: (w.act - w.ex) / w.days.length * 7, why, series: seriesOf(null, true),
      head: `${alShort(g.name)} +${Math.round(gain)}% above expected${why ? ' — ' + why : ''}`, id: g.key + '|' + w.days[0] });
  }
  return null;
}

/* ----- THE TRUST CHECK (24 Nov 2026): every alert and win is checked against simple, independent evidence before it is shown —
 *  the checks a person would do by hand. Weeks here are 7-day blocks ending on the last finished day: the 4 normal weeks (exactly the
 *  baseline) and the 2 judged weeks (exactly the 14 days). ✅ Confirmed: every check passes → "Fix these first" / Wins, the hero, the
 *  Dashboard. ⚠️ Needs a look: any check fails → its own collapsed group, with the failed check — never in the hero or the Dashboard. */
const AL_CHK = { week: 20, steady: 35, brand: 10 };
/** A product's own weekly sales (and its brand's, for the same weeks): N = the normal weeks (oldest first), J1, J2 = the judged weeks. */
function alEvidence(g, ctx) {
  const { o, last, weeks } = ctx;
  const kids = Object.keys(g.kids);
  const sales = d => kids.reduce((s, a) => s + ((g.kids[a][d] || [])[1] || 0), 0);
  const ends = [];                                                     // block end days, oldest first: N1..Nw, J1, J2
  for (let i = weeks + 1; i >= 0; i--) ends.push(alAdd(last, -7 * i));
  const block = (end, f) => { let s = 0; for (let k = 0; k < 7; k++) { const v = f(alAdd(end, -k)); if (v == null) return null; s += v; } return s; };
  const bd = (o.brandDaily || o.lyDaily || {})[g.brand];
  const bsum = d => (bd && bd[d] ? Number(bd[d][0]) || 0 : null);
  const own = ends.map(e => block(e, sales)), brand = ends.map(e => (bd ? block(e, bsum) : null));
  return { N: own.slice(0, weeks), J1: own[weeks], J2: own[weeks + 1], bN: brand.slice(0, weeks), bJ1: brand[weeks], bJ2: brand[weeks + 1],
    labels: ends.map(e => `${alDay(alAdd(e, -6))}–${alDay(e)}`), complete: !o.days.from || o.days.from <= alAdd(ends[0], -6) };
}
const alK = v => (Math.abs(v) >= 1000 ? (v < 0 ? '−$' : '$') + (Math.abs(v) / 1000).toFixed(1) + 'k' : alMoney(v));
const alAvg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
/** The five checks for one alert or win: { ok, checks: [{k, ok, t}], failed: [k], proof (one line, plain English), nAvg, prod, brand }. */
function alVerify(a, ev, ctx) {
  const up = a.list === 'wins';
  const S = ctx.S;
  // the judged weeks this move covers: the last one always; the one before when the move holds 4 or more of its days
  const useJ1 = (a.run || []).filter(d => d <= alAdd(ctx.last, -7)).length >= 4;
  const used = useJ1 ? [ev.J1, ev.J2] : [ev.J2];
  const nAvg = alAvg(ev.N);
  const ch = used.map(v => (nAvg ? (v / nAvg - 1) * 100 : 0));
  const prod = nAvg ? (alAvg(used) / nAvg - 1) * 100 : 0;
  const bUsed = useJ1 ? [ev.bJ1, ev.bJ2] : [ev.bJ2];
  const brand = ev.bN.every(v => v != null) && bUsed.every(v => v != null) && alAvg(ev.bN) ? (alAvg(bUsed) / alAvg(ev.bN) - 1) * 100 : null;
  const dir = up ? 'above' : 'below';
  const weeksTxt = `own weeks ${alK(nAvg)} → ${used.map(alK).join(' / ')} (${alPctTxt(prod, true)})`;
  const lo = Math.min(...ev.N), hi = Math.max(...ev.N);
  const checks = [
    { k: 'weekly', ok: ch.every(c => (up ? c >= AL_CHK.week : c <= -AL_CHK.week)),
      t: `${weeksTxt} — ${used.length === 2 ? 'both judged weeks' : 'the last week'} should be ${AL_CHK.week}%+ ${dir} the normal average (${ch.map(c => alPctTxt(c, true)).join(' / ')})` },
    { k: 'steady', ok: ev.N.every(v => nAvg && Math.abs(v / nAvg - 1) * 100 <= AL_CHK.steady),
      t: `baseline too uneven — normal weeks ${alK(lo)}–${alK(hi)}, not all within ±${AL_CHK.steady}% of their average ${alK(nAvg)}` },
    { k: 'brand', ok: brand == null || Math.abs(prod - brand) > AL_CHK.brand,
      t: `moves with the brand — product ${alPctTxt(prod, true)}, ${AL_BRAND_NAME[a.brand]} ${brand == null ? '—' : alPctTxt(brand, true)} the same weeks (within ${AL_CHK.brand} points)` },
    { k: 'volume', ok: nAvg >= S.minWeek && ev.complete,
      t: nAvg < S.minWeek ? `too small — normal ${alK(nAvg)}/week, under ${alMoney(S.minWeek)}` : 'the per-product days do not cover all six weeks' },
    { k: 'season', ok: a.rawExp == null || (up ? a.exp >= a.rawExp - 0.5 : a.exp <= a.rawExp + 0.5),
      t: `expected was moved ${up ? 'below' : 'above'} its own normal weeks` },
  ];
  const failed = checks.filter(c => !c.ok).map(c => c.k);
  const steadyTxt = ev.N.length < 4 ? `steady baseline (${ev.N.length} weeks)` : 'steady baseline';
  const proof = failed.length ? 'Needs a look — ' + checks.filter(c => !c.ok).map(c => c.t).join(' · ')
    : `Checked ✓ — ${weeksTxt}, ${brand == null ? 'brand not held for these weeks' : `${AL_BRAND_NAME[a.brand]} ${alPctTxt(brand, true)} same weeks`}, ${steadyTxt}.`;
  return { ok: !failed.length, checks, failed, proof, nAvg, prod, brand, used, ch };
}
const alShort = name => { const s = String(name || '').replace(/^~\s*/, ''); return s.length > 48 ? s.slice(0, 46).trim() + '…' : s; };
const AL_HEAD = { season: 'a seasonal dip', oos: 'likely out of stock', deal: 'a deal ended', price: 'likely the price change', adsCut: 'ads were cut',
  traffic: 'traffic is down', conv: 'conversion is down', adsUp: 'ads up, sales down', none: 'no clear cause yet' };
/** The one next step (rule-based). */
function alNext(c, item) {
  switch (c.k) {
    case 'oos': return 'Check replenishment / send inbound';
    case 'price': return `Review the price change on ${alDay(c.since || item.from)}`;
    case 'traffic': return 'Check BSR / ads / search rank';
    case 'conv': return 'Check listing, reviews, Buy Box';
    case 'adsCut': return 'Check campaign status / budget';
    case 'adsUp': return 'Check search terms and bids — the spend is not selling';
    case 'deal': return 'Normal after a deal — watch 7 days';
    case 'season': return 'Same as last year — watch, no action needed yet';
    default: return 'Check listing / Buy Box';
  }
}

/* ----- the causes: only what the data shows, strongest first ----- */
// FBA units now for one ASIN's SKUs: n, or null when none of its SKUs is in the stock document.
function alStockOf(asin, b, stock) {
  const s = stock && stock[b];
  if (!s || !s.m || !s.skuOf) return null;
  let n = 0, seen = 0;
  (s.skuOf[asin] || []).forEach(sku => { if (sku in s.m) { seen++; n += Number(s.m[sku]) || 0; } });
  return seen ? n : null;
}
// Per child: its own expected and actual over the run (same baseline rule, same season factor), its stock and cover.
function alKids(g, item, shape, ctx) {
  const { base } = ctx;
  return Object.keys(g.kids).map(a => {
    const k = g.kids[a];
    const s = d => (k[d] || [])[1] || 0, u = d => (k[d] || [])[0] || 0;
    const med = []; for (let w = 0; w < 7; w++) med[w] = alMedian(base.filter(d => alDow(d) === w).map(s));
    const ex = item.run.reduce((t, d) => t + med[alDow(d)] * shape.f, 0), act = alSum(item.run, s);
    const upd = alSum(base, u) / base.length;
    const n = alStockOf(a, g.brand, ctx.o.stock);
    let lastSale = ''; for (const d of ctx.win) if (u(d) > 0) lastSale = d;
    const bu = alSum(base, u), bs = alSum(base, s), ru = alSum(item.run, u), rs = alSum(item.run, s);
    return { asin: a, loss: Math.max(0, ex - act), upd, n, cover: n != null && upd > 0 ? n / upd : null, lastSale, bu, bs,
      price: bu && ru ? (rs / ru) / (bs / bu) - 1 : null };
  });
}
function alCauses(g, item, shape, ctx) {
  const { o, S, base, last } = ctx;
  const found = [];
  const K = alKids(g, item, shape, ctx);
  item.kidsInfo = K;
  const loss = K.reduce((s, k) => s + k.loss, 0) || 1;
  // 1. out of stock: the children at 0 FBA units, or under S.oosCover days of cover, carry half the loss or more
  const oos = K.filter(k => k.n != null && (k.n === 0 || (k.cover != null && k.cover < S.oosCover)));
  if (oos.length && oos.reduce((s, k) => s + k.loss, 0) >= 0.5 * loss) {
    const zero = oos.filter(k => k.n === 0);
    const ls = oos.map(k => k.lastSale).filter(Boolean).sort().pop();
    const at = o.stock && o.stock[g.brand] && o.stock[g.brand].at;
    const units = oos.reduce((s, k) => s + k.n, 0), upd = oos.reduce((s, k) => s + k.upd, 0);
    found.push({ k: 'oos', conf: 'High', t: 'Out of stock',
      ev: (zero.length === oos.length ? `FBA 0${oos.length < K.length ? ` for ${oos.length} of ${K.length} children` : ''}` : `FBA ${AL_NF.format(units)} units ≈ ${(upd ? units / upd : 0).toFixed(1)} days of cover`)
        + (ls && ls < last ? ` · no sale since ${alDay(alAdd(ls, 1))}` : '') + (at ? ` · stock as of ${alDay(String(at).slice(0, 10))}` : ''), asins: oos.map(k => k.asin) });
  }
  // 2. a deal ended: a Deal Calendar entry for this parent ended in the 7 days before the drop or during it
  const P = String(g.parent).toUpperCase();
  Object.entries(o.plan || {}).forEach(([key, p]) => {
    if (!p || !p.t) return;
    const at = key.lastIndexOf('|');
    if (at < 0 || key.slice(0, at).toUpperCase() !== P) return;
    const start = p.s || key.slice(at + 1), end = alAdd(start, Math.max(1, Number(p.d) || 7) - 1);
    if (end < alAdd(item.from, -7) || end > last || end >= item.to) return;
    const type = String(p.t).charAt(0) + String(p.t).slice(1).toLowerCase();
    const inBase = end >= base[0] && start <= base[base.length - 1];
    if (!found.some(c => c.k === 'deal')) found.push({ k: 'deal', conf: inBase ? 'High' : 'Medium', t: 'Deal ended', ev: `${type}${p.v ? ' ' + p.v + '%' : ''} ended ${alDay(end)}${inBase ? ' — the normal weeks had the deal in them' : ''}`, since: end });
  });
  // 3. price: LIKE FOR LIKE — each child's selling price (sales ÷ units) against its own normal price, weighted by the units sold.
  //    Never the parent's plain average: when a dear size sells out and a cheap one sells on, that average falls with no price change.
  const bp = {};
  K.forEach(k => { if (k.bu) bp[k.asin] = k.bs / k.bu; });
  const priceOn = list => {                                       // { was, now } over these days, or null when no child sold in both
    let u = 0, s = 0, w = 0;
    list.forEach(d => Object.keys(bp).forEach(a => { const c = g.kids[a][d]; if (c && c[0]) { u += c[0]; s += c[1] || 0; w += c[0] * bp[a]; } }));
    return u && w ? { was: w / u, now: s / u } : null;
  };
  let price = null;
  const pr = priceOn(item.run);
  if (pr) {
    const was = pr.was, now = pr.now, ch = (now / was - 1) * 100;
    if (Math.abs(ch) >= S.price) {
      const dir = Math.sign(ch);
      let since = '';
      for (const d of ctx.win) { const p = priceOn([d]); if (!p) continue; const c = (p.now / p.was - 1) * 100; if (Math.sign(c) === dir && Math.abs(c) >= S.price) { if (!since) since = d; } else if (d < item.from) since = ''; }
      price = { k: 'price', conf: ch > 0 ? (ch >= 15 ? 'High' : 'Medium') : 'Low', t: 'Price change', ev: `${alMoney2(was)} → ${alMoney2(now)} (${alPctTxt(ch, true)})${since ? ' since ' + alDay(since) : ''}`, since: since || item.from, up: ch > 0 };
      if (ch > 0) found.push(price);
    }
  }
  // 4. ads: Sponsored Products spend a day (adsAsinDay) on the low days the ad report holds, against the normal weeks
  const ads = o.adsDay && o.adsDay.d && o.adsDay.d[g.brand];
  let adsNote = '';
  if (ads) {
    const kids = Object.keys(g.kids);
    const f = (d, i) => kids.reduce((s, a) => s + (((ads[a] || {})[d] || [])[i] || 0), 0);
    const held = item.run.filter(d => !o.adsDay.upTo || d <= o.adsDay.upTo);
    const bSpend = alSum(base, d => f(d, 2)) / base.length, bSales = alSum(base, d => f(d, 4)) / base.length;
    if (!held.length) adsNote = `ad figures for ${alDay(item.from)}–${alDay(item.to)} not in yet`;
    else if (bSpend >= 5) {
      const rSpend = alSum(held, d => f(d, 2)) / held.length, rSales = alSum(held, d => f(d, 4)) / held.length;
      const ch = (rSpend / bSpend - 1) * 100;
      if (ch <= -S.adsCut && rSales < bSales) found.push({ k: 'adsCut', conf: 'Medium', t: 'Ads cut', ev: `ad spend ${alMoney(bSpend)}/day → ${alMoney(rSpend)}/day (${alPctTxt(ch, true)}), ad sales down` });
      else if (ch >= S.adsUp) found.push({ k: 'adsUp', conf: 'Medium', t: 'Ads up, no sales', ev: `ad spend ${alMoney(bSpend)}/day → ${alMoney(rSpend)}/day (${alPctTxt(ch, true)}) while sales fell — wasted spend` });
    }
  }
  // 5. traffic / conversion: the weekly traffic report, finished weeks only — the latest one that overlaps the low days
  const W = o.weekly && o.weekly.rows;
  let sessNote = '';
  if (W) {
    const wk = alAdd(alSun(last), alAdd(alSun(last), 6) <= last ? 0 : -7);
    const cell = (k, f) => { let s = null; Object.keys(g.kids).forEach(a => { const c = ((W[a] || {}).weeks || {})[k]; if (c && c[f] != null) s = (s || 0) + (Number(c[f]) || 0); }); return s; };
    const sNow = cell(wk, 'sessions');
    if (alAdd(wk, 6) < item.from || sNow == null) sessNote = `sessions for ${alDay(item.from)}–${alDay(item.to)} not in yet (weekly report)`;
    else {
      const prev = [1, 2, 3, 4].map(i => alAdd(wk, -7 * i)).map(k => ({ s: cell(k, 'sessions'), u: cell(k, 'u') })).filter(x => x.s);
      const sb = prev.reduce((t, x) => t + x.s, 0) / (prev.length || 1), ub = prev.reduce((t, x) => t + (x.u || 0), 0) / (prev.length || 1);
      const uNow = cell(wk, 'u') || 0;
      if (prev.length && sb >= 50) {
        const tr = (sNow / sb - 1) * 100;
        const cv = ub && sNow ? ((uNow / sNow) / (ub / sb) - 1) * 100 : null;
        const lbl = `week of ${alDay(wk)}`;
        if (tr <= -S.traffic && (cv == null || cv > -S.conv)) found.push({ k: 'traffic', conf: 'Medium', t: 'Traffic down', ev: `sessions ${AL_NF.format(Math.round(sb))} → ${AL_NF.format(sNow)} a week (${alPctTxt(tr, true)}), conversion normal · ${lbl}` });
        else if (cv != null && cv <= -S.conv && Math.abs(tr) < S.traffic) found.push({ k: 'conv', conf: 'Medium', t: 'Conversion down', ev: `${(ub / sb * 100).toFixed(1)}% → ${(uNow / sNow * 100).toFixed(1)}% of sessions buy (${alPctTxt(cv, true)}), traffic normal · ${lbl} — possible listing / review / Buy Box issue` });
      }
    }
  }
  if (price && !price.up) found.push(price);
  const ORDER = ['oos', 'deal', 'price', 'adsCut', 'traffic', 'conv', 'adsUp'];
  found.sort((a, b) => (a.k === 'price' && !a.up ? 9 : ORDER.indexOf(a.k)) - (b.k === 'price' && !b.up ? 9 : ORDER.indexOf(b.k)));
  item.notes = [sessNote, adsNote].filter(Boolean);
  return found;
}
// Siblings with the same cause, grouped under the parent: out of stock and price are per child; the rest are the parent's.
function alKidGroups(g, item, shape, ctx, top) {
  const K = item.kidsInfo || alKids(g, item, shape, ctx);
  const S = ctx.S, groups = {};
  K.filter(k => k.loss >= 1).forEach(k => {
    const c = k.n != null && (k.n === 0 || (k.cover != null && k.cover < S.oosCover)) ? 'oos'
      : k.price != null && Math.abs(k.price * 100) >= S.price ? 'price' : top.k === 'oos' || top.k === 'price' ? 'none' : top.k;
    (groups[c] || (groups[c] = { k: c, asins: [], loss: 0 })).asins.push(k.asin);
    groups[c].loss += k.loss / item.run.length * 7;
  });
  return Object.values(groups).sort((a, b) => b.loss - a.loss);
}
// Why a product is above its range (only what the data shows).
function alWinWhy(g, up, shape, ctx) {
  const { o, S, base } = ctx;
  const ads = o.adsDay && o.adsDay.d && o.adsDay.d[g.brand];
  if (ads) {
    const kids = Object.keys(g.kids);
    const f = d => kids.reduce((s, a) => s + (((ads[a] || {})[d] || [])[2] || 0), 0);
    const held = up.filter(d => !o.adsDay.upTo || d <= o.adsDay.upTo);
    const b = alSum(base, f) / base.length;
    if (held.length && b >= 5 && (alSum(held, f) / held.length / b - 1) * 100 >= S.adsUp) return 'ads push working';
  }
  const P = String(g.parent).toUpperCase();
  const deal = Object.entries(o.plan || {}).some(([key, p]) => {
    const at = key.lastIndexOf('|');
    if (!p || !p.t || at < 0 || key.slice(0, at).toUpperCase() !== P) return false;
    const start = p.s || key.slice(at + 1), end = alAdd(start, Math.max(1, Number(p.d) || 7) - 1);
    return start <= up[up.length - 1] && end >= up[0];
  });
  if (deal) return 'deal running';
  const bu = alSum(base, shape.units), ru = alSum(up, shape.units);
  if (bu && ru && ((alSum(up, shape.sales) / ru) / (alSum(base, shape.sales) / bu) - 1) * 100 <= -S.price) return 'price cut';
  return '';
}

/* ----- loading (read-only) and the shared marks / settings ----- */
const alMay = t => (typeof TAB_OK === 'function' ? !!TAB_OK(t) : typeof ME !== 'undefined' && !!ME && (ME.admin || (ME.tabs || []).includes(t)));
function alLsGet() { try { return JSON.parse(localStorage.getItem(AL_LS) || 'null') || null; } catch (e) { return null; } }
function alLsSet(v) { try { localStorage.setItem(AL_LS, JSON.stringify(v)); } catch (e) { /* this visit only */ } }
// Sign-in reads the backend's address (config/api) a moment after the page opens: wait for it, as the Dashboard does.
async function alApiReady() {
  for (let i = 0; i < 300 && !(typeof API !== 'undefined' && API && API.url); i++) await new Promise(r => setTimeout(r, 50));
}
async function alStoreLoad() {
  const local = alLsGet() || { marks: {}, settings: {} };
  try {
    const snap = await getDoc(doc(db, AL_DOC[0], AL_DOC[1]));
    const s = snap.exists() ? snap.data() : {};
    AL.store = { marks: Object.assign({}, local.marks, s.marks || {}), settings: Object.assign({}, local.settings, s.settings || {}), setBy: s.setBy || '', setAt: s.setAt || 0 };
  } catch (e) { AL.store = Object.assign({ marks: {}, settings: {} }, local); AL.storeNote = 'Saved in this browser only (the shared copy could not be read).'; }
}
/** Save a change (marks or settings), shared when allowed, else in this browser — and say which. */
async function alStoreSave(patch) {
  const local = alLsGet() || { marks: {}, settings: {} };
  if (patch.marks) Object.assign(local.marks, patch.marks);
  if (patch.settings) local.settings = patch.settings;
  alLsSet(local);
  try { await setDoc(doc(db, AL_DOC[0], AL_DOC[1]), patch, { merge: true }); AL.storeNote = ''; }
  catch (e) { AL.storeNote = 'Saved in this browser only — the shared copy could not be written (' + ((e && e.code) || 'no access') + ').'; }
}
const alWho = () => (typeof ME !== 'undefined' && ME && ME.email) || 'this browser';
/** Load once per visit (force: Refresh). */
function alLoad(force) {
  if (AL.busy) return AL.busy;
  if (AL.data && !force) return Promise.resolve(AL.data);
  AL.busy = (async () => {
    const data = { adsDay: null, plan: null, err: '' };
    const jobs = [];
    jobs.push((async () => { if (typeof viLoad === 'function') await viLoad(force); })().catch(e => { data.err = String((e && e.message) || e); }));
    jobs.push((async () => {                         // the Sales Dashboard's history: last year for the season (as Numbers Check reads it)
      if (typeof SD_BUSY !== 'undefined' && SD_BUSY) { try { await SD_BUSY; } catch (e) { /* the saved copy stays */ } }
      if (!SD.at && !sdLoadLocal()) { await alApiReady(); const r = await baCall({ cache: 'daily' }); if (!SD.at && r && r.data && r.data.at) SD = { at: r.data.at, d: r.data.d || {} }; }
      if (typeof tMatchEnsure === 'function') await tMatchEnsure();
    })().catch(() => {}));
    jobs.push((async () => {                         // ad spend per ASIN per day, as the nightly cached it
      await alApiReady();
      const r = await baCall({ cache: 'adsAsinDay' });
      const d = (r && r.data && r.data.d) || {};
      let up = '';
      Object.values(d).forEach(byA => Object.values(byA || {}).forEach(byDay => Object.keys(byDay || {}).forEach(k => { if (k > up) up = k; })));
      data.adsDay = { d, upTo: up, at: (r && r.data && r.data.at) || '' };
    })().catch(() => { data.adsDay = null; }));
    jobs.push((async () => {                         // the Deal Calendar's plan: in memory, else its one document (read only)
      if (typeof D_PLAN !== 'undefined' && D_PLAN && Object.keys(D_PLAN).length) { data.plan = D_PLAN; return; }
      if (!alMay('deals')) return;
      const snap = await getDoc(doc(db, 'audit', 'deals'));
      data.plan = snap.exists() ? (snap.data().plan || {}) : {};
    })().catch(() => {}));
    jobs.push(alStoreLoad());
    await Promise.all(jobs);
    AL.data = data;
    AL.res = {};
    AL.at = Date.now();
    AL.v++;
    return data;
  })().finally(() => { AL.busy = null; });
  return AL.busy;
}
/** The alerts for one view (SP, CPC or ALL), worked out once per data version. */
function alFor(brand) {
  if (!AL.data || typeof VI === 'undefined' || !VI.data) return null;
  const k = [brand, AL.v, VI.v, sdToday(), JSON.stringify(AL.store.settings || {}), JSON.stringify(AL.store.marks || {})].join('@');
  if (AL.res[brand] && AL.res[brand].k === k) return AL.res[brand].r;
  let r;
  try {
    r = alCompute({ days: VI.data.days, today: sdToday(), brand, parentOf: typeof wParentOf === 'function' ? a => wParentOf(a) : null,
      nameOf: typeof viNameOf === 'function' ? viNameOf : null, stock: VI.data.stock, weekly: VI.data.weekly, adsDay: AL.data.adsDay, plan: AL.data.plan,
      lyDaily: SD && SD.d && typeof sdDays === 'function' ? { SP: sdDays('SP'), CPC: sdDays('CPC') } : null, settings: AL.store.settings, marks: AL.store.marks, now: Date.now() });
  } catch (e) { r = { ok: false, why: 'Sales Alerts could not be worked out: ' + ((e && e.message) || e) }; }
  AL.res[brand] = { k, r };
  // the self-check, logged: products whose own normal weeks are too irregular to judge (never an alert, never a win)
  if (r.ok && r.skipped.length && typeof console !== 'undefined') console.info(`[Sales Alerts] ${AL_BRAND_NAME[brand]}: ${r.skipped.length} product(s) not judged — over ${Math.round(AL_BASE_OUT * 100)}% of their normal days outside their range:`, r.skipped.map(a => `${a.name} (${a.parent}) ${Math.round(a.baseOut * 100)}%`));
  return r;
}

/* ----- THE PAGE ----- */
const AL_SEV = { critical: ['🔴', 'Critical'], important: ['🟠', 'Important'], watch: ['🟡', 'Watch'], waiting: ['⏳', 'Waiting for data'], recovered: ['✅', 'Recovered this week'] };
const alMotion = () => (typeof sdcFxSaved === 'function' ? sdcFxSaved() : true) && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
function alHeroHtml(r) {
  const n = r.alerts.length;
  const sent = n ? `<span class="al-cu" data-to="${n}">${n}</span> product${n === 1 ? ' needs' : 's need'} attention · <span class="al-cu al-risk" data-to="${Math.round(r.atRisk)}" data-money="1">${alMoney(r.atRisk)}</span>/week at risk`
    : 'All good — no real drops this week ✅';
  const chip = k => `<button type="button" class="al-chip is-${k}" data-al-filter="${k}" aria-pressed="${AL.filter === k}"><span aria-hidden="true">${AL_SEV[k][0]}</span> ${AL_SEV[k][1]} <b>${r.counts[k]}</b></button>`;
  return `<section class="al-hero"><h2 class="al-hl">${sent}</h2><div class="al-chips" role="group" aria-label="Filter">${['critical', 'important', 'watch', 'waiting', 'recovered'].map(chip).join('')}</div>`
    + `<p class="al-sub">${AL_BRAND_NAME[r.brand]} · finished days up to <b>${alDay(r.last)}</b> (US Pacific) against the normal ${r.base.weeks} weeks ${alDay(r.base.from)}–${alDay(r.base.to)}`
    + `${r.missing.length ? ` · the nightly days for ${alDay(r.missing[r.missing.length - 1])} are not in yet` : ''}</p>`
    + `<p class="al-sum">Sellora checked <b>${AL_NF.format(r.checked)}</b> products · <b>${r.alerts.length}</b> confirmed drop${r.alerts.length === 1 ? '' : 's'} · <b>${r.wins.length}</b> confirmed win${r.wins.length === 1 ? '' : 's'}`
    + ` · <b>${r.review.length}</b> need${r.review.length === 1 ? 's' : ''} a look · <b>${r.skipped.length}</b> not judged${r.hidden.length ? ` · ${r.hidden.length} dismissed or snoozed` : ''}</p></section>`;
}
/** The trust check's one line, on every card: "Checked ✓ — own weeks $14.8k → $10.7k / $11.0k (−26%), Ridhi +35% same weeks, steady baseline." */
const alProofHtml = a => (a.check ? `<p class="al-proof ${a.check.ok ? 'is-ok' : 'is-look'}">${alEsc(a.check.proof)}</p>` : '');
const alPill = c => (c ? `<span class="al-pill is-${c.k}" title="${alEsc(c.t + ' · ' + c.ev + (c.conf ? ' · ' + c.conf + ' confidence' : ''))}"><b>${alEsc(c.t)}</b> · ${alEsc(c.ev)}${c.conf ? ` · <i>${c.conf} confidence</i>` : ''}</span>` : '');
const AL_KID_T = { oos: 'Out of stock', price: 'Price changed', deal: 'Deal ended', adsCut: 'Ads cut', traffic: 'Traffic down', conv: 'Conversion down', adsUp: 'Ads up, no sales', season: 'Seasonal dip', none: 'No clear cause' };
function alDetailHtml(a, big) {
  const pills = (a.causes || []).slice(0, 2).map(alPill).join('');
  const groups = a.groups && a.groups.length > 1 || (a.groups && a.groups[0] && a.kids.length > 1)
    ? `<div class="al-kids"><b>Children</b>${a.groups.map(gr => `<div class="al-kid"><span>${alEsc(AL_KID_T[gr.k] || gr.k)} · ${gr.asins.length} of ${a.kids.length}</span><span class="num" title="Each child against its own normal days">≈ ${alMoney(-gr.loss)}/wk</span><small>${gr.asins.map(alEsc).join(', ')}</small></div>`).join('')}</div>` : '';
  const notes = (a.notes || []).length ? `<p class="al-note">⏳ ${a.notes.map(alEsc).join(' · ')}</p>` : '';
  const top = (a.kids || []).slice().sort((x, y) => ((a.kidsInfo || []).find(k => k.asin === y) || {}).loss - ((a.kidsInfo || []).find(k => k.asin === x) || {}).loss)[0] || a.parent;
  return `<div class="al-chart${big ? '' : ' is-row'}" data-al-chart="${alEsc(a.id)}" role="img" aria-label="Last 28 days: actual sales against the normal range"></div>`
    + (pills ? `<div class="al-pills">${pills}</div>` : '')
    + `<p class="al-do"><b>What to do</b> ${alEsc(a.next || '')}</p>${groups}${notes}`
    + `<div class="al-btns"><a class="al-btn" href="https://www.amazon.com/dp/${alEsc(top)}" target="_blank" rel="noopener">Open product ↗</a>`
    + `<button type="button" class="al-btn" data-al-act="snooze" data-al-id="${alEsc(a.id)}">Snooze ${AL_SNOOZE_DAYS} days</button>`
    + `<button type="button" class="al-btn" data-al-act="dismiss" data-al-id="${alEsc(a.id)}">Dismiss</button>`
    + `<button type="button" class="al-btn" disabled title="Coming soon — with the Action Tracker">Create task</button></div>`
    + alProofHtml(a)
    + alNormHtml(a)
    + `<p class="al-asof">Sales ${alDay(a.from)}–${alDay(a.to)} · expected ${alMoney(a.exp)}, actual ${alMoney(a.act)} · normal ${alMoney(a.normalWeek)}/week</p>`;
}
/** "Normal (own 4 weeks): $X/day · Expected used: $Y/day" over the low days — any season adjustment shows as the gap between them. */
function alNormHtml(a) {
  if (!a.days || a.rawExp == null) return '';
  const own = a.rawExp / a.days, used = a.exp / a.days;
  const why = Math.abs(used - own) < 0.5 ? '' : a.fOwn != null ? ` (×${a.fOwn.toFixed(2)}: its own last year)` : ` (×${a.fDown.toFixed(2)}: the ${AL_BRAND_NAME[a.brand]} total fell last year on these days)`;
  return `<p class="al-norm">Normal (own ${a.baseWeeks || 4} weeks): <b class="num">${alMoney(own)}/day</b> · Expected used: <b class="num">${alMoney(used)}/day</b>${alEsc(why)}</p>`;
}
function alCardHtml(a) {
  return `<article class="al-card is-${a.sev}" data-al-card="${alEsc(a.id)}"><div class="al-card-h"><span class="al-sev is-${a.sev}">${AL_SEV[a.sev][0]} ${AL_SEV[a.sev][1]}</span><span class="al-state">${alEsc(a.state)} · ${AL_BRAND_NAME[a.brand]}</span></div>`
    + `<h4 class="al-head">${alEsc(a.head)}</h4><div class="al-big num">${alMoney(-a.atRisk)}<small> / week</small></div>${alDetailHtml(a, true)}</article>`;
}
function alRowHtml(a, open) {
  const isWin = a.list === 'wins' || a.kind === 'wins';
  const pct = isWin ? `+${Math.round(a.gain)}%` : a.list === 'recovered' ? 'back' : a.list === 'skipped' ? '—' : `−${Math.round(a.drop)}%`;
  const money = isWin ? '+' + alMoney(a.extra) + '/wk' : a.list === 'recovered' ? `${a.back} days in range` : a.list === 'skipped' ? 'not judged' : alMoney(-a.atRisk) + '/wk';
  const cause = a.cause ? AL_KID_T[a.cause.k] : a.why || '';
  // a dismissed / snoozed alert says by whom and when, with Undo, in place of its own buttons
  const markLine = a.mark ? `<p class="al-asof">${a.mark.a === 'snooze' ? 'Snoozed until ' + alDay(new Date(a.mark.until).toISOString().slice(0, 10)) : 'Dismissed'} by ${alEsc(a.mark.by)} on ${alDay(new Date(a.mark.at).toISOString().slice(0, 10))} `
    + `<button type="button" class="al-btn" data-al-act="undo" data-al-id="${alEsc(a.id)}">Undo</button></p>` : '';
  // an alert that needs a look shows its detail without the Snooze / Dismiss buttons (it is not on the list those act on)
  const body = a.list === 'alerts' || (a.list === 'review' && a.kind === 'alerts')
    ? (a.mark || a.list === 'review' ? alDetailHtml(a, false).replace(/<div class="al-btns">[\s\S]*?<\/div>/, '') : alDetailHtml(a, false)) + markLine
    : `<div class="al-chart is-row" data-al-chart="${alEsc(a.id)}" role="img" aria-label="Last 28 days: actual sales against the normal range"></div>${alProofHtml(a)}<p class="al-asof">${alEsc(a.why || a.head)} · ${alDay(a.from)}–${alDay(a.to)}</p>`;
  return `<details class="al-row is-${a.sev}" data-al-row="${alEsc(a.id)}"${open ? ' open' : ''}><summary><i class="al-dot is-${a.sev}" aria-hidden="true"></i>`
    + `<span class="al-row-n">${alEsc(alShort(a.name))}<small>${alEsc(a.head)}</small></span><span class="al-row-c">${alEsc(cause)}</span>`
    + `<span class="al-row-p num">${pct}</span><span class="al-row-m num">${money}</span><span class="al-row-s">${alEsc(a.state || (a.days ? a.days + ' days' : ''))}</span></summary><div class="al-det">${body}</div></details>`;
}
function alListHtml(r) {
  const f = AL.filter;
  let rows, title;
  if (f === 'waiting') { rows = r.waiting; title = 'Waiting for data'; }
  else if (f === 'recovered') { rows = r.recovered; title = 'Recovered this week'; }
  else { rows = r.alerts.filter(a => (!f || a.sev === f) && (!AL.cause || a.cause.k === AL.cause)); title = f ? AL_SEV[f][1] + ' alerts' : 'All alerts'; }
  const causes = [...new Set(r.alerts.map(a => a.cause.k))];
  const sel = `<label class="al-sel">Cause <select data-al-cause><option value="">All causes</option>${causes.map(k => `<option value="${k}"${AL.cause === k ? ' selected' : ''}>${AL_KID_T[k]}</option>`).join('')}</select></label>`
    + (f ? `<button type="button" class="al-btn" data-al-filter="">Show all</button>` : '');
  const lookGroup = !f && r.review.length ? `<details class="al-wait al-look"><summary>⚠️ Needs a look · ${r.review.length} — a drop or a win the trust check could not confirm (not in the numbers above)</summary>${r.review.map(a => alRowHtml(a)).join('')}</details>` : '';
  const waitGroup = lookGroup + (!f && r.waiting.length ? `<details class="al-wait"><summary>⏳ Waiting for data · ${r.waiting.length} — low, not confirmed yet (never an alert)</summary>${r.waiting.map(a => alRowHtml(a)).join('')}</details>` : '');
  const hidden = (r.hidden.length ? `<details class="al-wait"><summary>Dismissed or snoozed · ${r.hidden.length}</summary>${r.hidden.map(a => alRowHtml(a)).join('')}</details>` : '')
    + (!f && r.skipped.length ? `<details class="al-wait"><summary>Not judged · ${r.skipped.length} — their own normal weeks are too irregular (more than ${Math.round(AL_BASE_OUT * 100)}% of the days outside their range)</summary>${r.skipped.map(a => alRowHtml(a)).join('')}</details>` : '');
  return `<section class="al-sec" id="alList"><div class="al-sec-h"><h3>${alEsc(title)} <span class="muted">${rows.length}</span></h3><div class="al-filters">${sel}</div></div>`
    + (rows.length ? `<div class="al-rows">${rows.map(a => alRowHtml(a)).join('')}</div>` : `<p class="muted al-empty">${f === 'waiting' ? 'Nothing waiting for data.' : f === 'recovered' ? 'Nothing recovered this week.' : 'No alerts here.'}</p>`)
    + waitGroup + hidden + '</section>';
}
function alWinsHtml(r) {
  const list = r.wins.slice(0, 6), rec = r.recovered.slice(0, 6);
  if (!list.length && !rec.length) return '';
  const card = a => `<li class="al-win"><span class="al-win-n">${alEsc(a.head)}${a.check ? `<small>${alEsc(a.check.proof)}</small>` : ''}</span><span class="num">${a.list === 'wins' ? '+' + alMoney(a.extra) + '/wk' : 'recovered ' + alDay(a.recAt)}</span></li>`;
  return `<section class="al-sec al-wins"><div class="al-sec-h"><h3>Wins this week ✅</h3></div><ul>${list.concat(rec).map(card).join('')}</ul></section>`;
}
function alHowHtml(r) {
  const S = r.settings;
  const rows = AL_SET.map(([k, t, h]) => `<label class="al-set"><span>${alEsc(t)}<small>${alEsc(h)}</small></span><input type="number" min="0" step="any" data-al-set="${k}" value="${S[k]}"></label>`).join('');
  const by = AL.store.setBy ? ` Last changed by ${alEsc(AL.store.setBy)} on ${alDay(new Date(AL.store.setAt).toISOString().slice(0, 10))}.` : '';
  return `<details class="al-how"><summary>ⓘ How we decide</summary><div class="al-how-b">`
    + `<p><b>Expected sales</b> = what this product usually sells on the same weekday: the middle value (median) of the last ${r.base.weeks} normal weeks, so one big day never moves it — the season can only make it calmer: when the brand's own last year fell on these days, expected is lowered to match; it is never raised above the product's own normal weeks (Sellora holds no per-product last year${r.seasonHeld ? '' : '; the brand\'s last year is not held for these days either'}). Each alert shows both: <i>Normal (own weeks)</i> and <i>Expected used</i>. A product whose own normal weeks are too irregular (more than ${Math.round(AL_BASE_OUT * 100)}% of its days outside its range) is not judged. The normal range is that ± 1.5 × the usual spread, and never narrower than ± ${Math.round(AL_BAND_MIN * 100)}%.</p>`
    + `<p><b>An alert</b> only for a lasting drop: most of the recent days below the normal range (at least ${S.days} finished days, more than half of them — one normal day in between does not hide it), together ${S.drop}% or more under expected, and not back to normal on the last ${S.recover} days; on a product that normally sells ${alMoney(S.minWeek)}/week or more, with complete data — never today. If the same days last year fell as much, it is a <b>seasonal dip</b> (Watch), not a problem. <b>$ at risk</b> = the missing sales a day × 7.</p>`
    + `<p><b>Severity</b>: Critical from ${alMoney(S.critUsd)}/week or ${S.critDays}+ days · Important from ${alMoney(S.impUsd)}/week · Watch the rest. <b>Causes</b> come only from Sellora's own data: stock, Deal Calendar, price (sales ÷ units), ad spend, sessions and conversion (finished weeks).</p>`
    + `<p><b>The trust check</b> — every drop and win is checked before it is shown, the way a person would by hand, on its own weekly sales (7-day weeks ending ${alDay(r.last)}): `
    + `① both judged weeks ${AL_CHK.week}%+ below (a win: above) the average of its ${r.base.weeks} normal weeks — a drop of under 4 days in the first judged week is checked on the last week; `
    + `② its normal weeks steady, each within ±${AL_CHK.steady}% of their average; ③ not just the whole brand moving the same way (more than ${AL_CHK.brand} points apart); `
    + `④ enough volume (${alMoney(S.minWeek)}/week) and complete days; ⑤ expected never moved above (a win: below) its own normal weeks. All pass → <b>Confirmed</b>; any fails → <b>Needs a look</b>, never in the numbers at the top or on the Dashboard.</p>`
    + `<div class="al-btns"><button type="button" class="al-btn" data-al-act="csv">Download full check (CSV)</button><span class="muted">one row per product: its weeks, the checks and the verdict</span></div>`
    + `<div class="al-sets">${rows}</div><div class="al-btns"><button type="button" class="al-btn is-main" data-al-act="save-set">Save settings</button><button type="button" class="al-btn" data-al-act="reset-set">Back to defaults</button></div>`
    + `<p class="al-asof">Settings are shared with everyone who opens Sales Alerts.${by}${AL.storeNote ? ' ' + alEsc(AL.storeNote) : ''}</p></div></details>`;
}
function alFootHtml(r) {
  const t = new Date(AL.at || Date.now());
  const hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  return `<footer class="al-foot">Checked ${hm} · sales data up to ${alDay(r.asOf.sales)}${r.asOf.run ? ' (nightly run ' + alEsc(r.asOf.run) + ')' : ''} · sessions up to ${r.asOf.sessions ? alDay(r.asOf.sessions) : '—'} · ads up to ${r.asOf.ads ? alDay(r.asOf.ads) : '—'}${r.asOf.stock ? ' · stock as of ' + alDay(String(r.asOf.stock).slice(0, 10)) : ''} · Shopify has no per-product days, so it is not in Sales Alerts</footer>`;
}
function alBarHtml() {
  const b = (v, t) => `<button type="button" data-al-brand="${v}" aria-pressed="${AL.brand === v}">${t}</button>`;
  return `<header class="al-bar"><div class="al-seg" role="group" aria-label="Brand">${b('SP', 'Ridhi')}${b('CPC', 'CPC')}${b('ALL', 'All')}</div>`
    + `<span id="alMsg" class="muted">${alEsc(AL.msg)}</span><button type="button" class="al-btn" data-al-act="refresh"${AL.busy ? ' disabled' : ''}>${AL.busy ? 'Reading…' : 'Refresh'}</button></header>`;
}
/** Draw the page. */
function alRender() {
  const root = typeof document !== 'undefined' && document.getElementById ? document.getElementById('alPane') : null;
  if (!root) return;
  alStart();
  alKillMotion();
  Object.values(AL.charts).forEach(c => { try { c.dispose(); } catch (e) { /* gone */ } });
  AL.charts = {};
  const r = alFor(AL.brand);
  if (!r) { root.innerHTML = `<div class="al">${alBarHtml()}<section class="al-hero"><h2 class="al-hl">${AL.busy ? 'Reading the per-product days…' : 'Not read yet.'}</h2></section></div>`; return; }
  if (!r.ok) { root.innerHTML = `<div class="al">${alBarHtml()}<section class="al-hero"><h2 class="al-hl">${alEsc(r.why)}</h2></section></div>`; return; }
  const top = AL.filter ? [] : r.alerts.slice(0, 3);
  root.innerHTML = `<div class="al">${alBarHtml()}${alHeroHtml(r)}`
    + (top.length ? `<section class="al-sec"><div class="al-sec-h"><h3>Fix these first</h3><span class="muted">biggest money first</span></div><div class="al-top">${top.map(alCardHtml).join('')}</div></section>` : '')
    + alListHtml(r) + (AL.filter ? '' : alWinsHtml(r)) + alHowHtml(r) + alFootHtml(r) + '</div>';
  alAnimate(root, r);
}

/* ----- the mini charts (ECharts, the Sales Dashboard's loader) ----- */
const alCss = n => { const p = document.getElementById('paneSalert') || document.documentElement; return getComputedStyle(p).getPropertyValue(n).trim(); };
function alItem(id) {
  const r = alFor(AL.brand);
  return r && r.ok ? [].concat(r.alerts, r.waiting, r.recovered, r.wins, r.hidden).find(a => a.id === id) : null;
}
function alChart(el) {
  const a = alItem(el.dataset.alChart);
  if (!a || !window.echarts || !el.isConnected) return;
  const c = { ink: alCss('--al-ink'), muted: alCss('--al-muted'), line: alCss('--al-line'), blue: alCss('--al-blue'), band: alCss('--al-band'), red: alCss('--al-red'), card: alCss('--al-card'), green: alCss('--al-green') };
  const s = a.series || [];
  const days = s.map(p => p.d), anim = alMotion();
  const lo = s.map(p => Math.round(p.lo)), width = s.map(p => Math.max(0, Math.round(p.hi - p.lo)));
  const ch = AL.charts[a.id] || (AL.charts[a.id] = window.echarts.init(el, null, { renderer: 'svg' }));
  ch.setOption({
    animation: anim, grid: { left: 44, right: 8, top: 8, bottom: 22 },
    tooltip: { trigger: 'axis', backgroundColor: c.card, borderColor: c.line, textStyle: { color: c.ink, fontSize: 12 },
      formatter: ps => { const p = s[ps[0].dataIndex]; return `<b>${alDay(p.d)}</b><br>Actual <b>${p.v == null ? '—' : alMoney(p.v)}</b><br>Expected ${alMoney(p.e)} (normal ${alMoney(p.lo)}–${alMoney(p.hi)})`; } },
    xAxis: { type: 'category', data: days, boundaryGap: false, axisLabel: { color: c.muted, fontSize: 10, formatter: alDay, hideOverlap: true }, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false } },
    yAxis: { type: 'value', splitNumber: 3, axisLabel: { color: c.muted, fontSize: 10, formatter: v => (v >= 1000 ? '$' + Math.round(v / 100) / 10 + 'k' : '$' + v) }, splitLine: { lineStyle: { color: c.line } } },
    series: [
      { type: 'line', data: lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, animationDuration: 500 },
      { type: 'line', data: width, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: c.band }, silent: true, animationDuration: 600 },
      { type: 'line', data: s.map(p => p.v), symbol: 'none', smooth: 0.25, lineStyle: { color: a.list === 'wins' || a.list === 'recovered' ? c.green : c.blue, width: 2 }, z: 3,
        animationDelay: anim ? 500 : 0, animationDuration: 900 },
      { type: 'scatter', data: s.map(p => (p.red ? p.v : null)), symbolSize: 7, itemStyle: { color: c.red }, z: 4, animationDelay: anim ? 1200 : 0 },
    ],
  }, true);
}
function alChartsIn(root) {
  const els = [...root.querySelectorAll('[data-al-chart]')].filter(el => el.offsetParent !== null);
  if (!els.length) return;
  const go = () => els.forEach(alChart);
  if (window.echarts) go();
  else if (typeof sdcLoadCharts === 'function') sdcLoadCharts().then(ok => { if (ok) go(); else els.forEach(el => { el.innerHTML = '<p class="muted al-empty">The chart library did not load — the numbers are still right.</p>'; }); });
}

/* ----- motion: the hero counts up, the top cards rise; never hidden (a 1 s / 3 s safety net), ✨ off = instant ----- */
function alKillMotion() {
  AL.tw.forEach(t => { try { t.kill(); } catch (e) { /* gone */ } });
  AL.tw = [];
  document.querySelectorAll('#alPane .al-card, #alPane .al-hl').forEach(el => ['opacity', 'transform', 'translate', 'visibility'].forEach(p => el.style.removeProperty(p)));
  document.querySelectorAll('#alPane .al-cu').forEach(el => { if (el._alFinal) el.textContent = el._alFinal; });
}
function alAnimate(root, r) {
  alChartsIn(root);
  if (!alMotion()) return;
  const run = () => {
    const g = window.gsap;
    if (!g || !document.getElementById('alPane').contains(root.firstElementChild)) return;
    try {
      if (g.globalTimeline.paused()) g.globalTimeline.resume();
      const cards = root.querySelectorAll('.al-card');
      if (cards.length) AL.tw.push(g.from(cards, { y: 36, opacity: 0, duration: 0.8, stagger: 0.12, ease: 'power3.out' }));
      root.querySelectorAll('.al-cu').forEach(el => {
        const to = Number(el.dataset.to) || 0, money = el.dataset.money === '1', o = { v: 0 };
        el._alFinal = el.textContent;
        AL.tw.push(g.to(o, { v: to, duration: 1.2, ease: 'power3.out', onUpdate: () => { el.textContent = money ? alMoney(o.v) : String(Math.round(o.v)); }, onComplete: () => { el.textContent = el._alFinal; } }));
      });
      // the safety net: an entrance that has not started within 1 s (a paused clock) or not finished 3 s later is shown at once
      const tws = AL.tw.slice();
      const net = (test, ms) => setTimeout(() => { if (tws.some(test)) { tws.forEach(t => { try { t.progress(1); t.kill(); } catch (e) { /* gone */ } }); alKillMotion(); } }, ms);
      net(t => { try { return t.progress() === 0; } catch (e) { return true; } }, 1000);
      net(t => { try { return t.progress() < 1; } catch (e) { return true; } }, 3000);
    } catch (e) { alKillMotion(); }                    // the motion threw: everything shown at once
  };
  if (window.gsap) run();
  else if (typeof sdcLoadMotion === 'function') Promise.race([sdcLoadMotion(), new Promise(res => setTimeout(res, 300))]).then(() => { if (window.gsap) run(); });
}

/* ----- the controls ----- */
function alStart() {
  if (AL.started || typeof document === 'undefined' || !document.addEventListener) return;
  AL.started = true;
  try { const b = localStorage.getItem('alBrand'); if (b === 'SP' || b === 'CPC' || b === 'ALL') AL.brand = b; } catch (e) { /* Ridhi */ }
  document.addEventListener('click', async e => {
    const t = e.target && e.target.closest ? e.target.closest('#alPane [data-al-brand], #alPane [data-al-filter], #alPane [data-al-act], #alStrip [data-al-open]') : null;
    if (!t || t.disabled) return;
    if (t.dataset.alOpen != null) { if (typeof showTab === 'function') { AL.brand = t.dataset.alOpen || AL.brand; showTab('salert'); } return; }
    if (t.dataset.alBrand) { AL.brand = t.dataset.alBrand; try { localStorage.setItem('alBrand', AL.brand); } catch (err) { /* this visit */ } alRender(); return; }
    if (t.dataset.alFilter != null) { AL.filter = AL.filter === t.dataset.alFilter ? '' : t.dataset.alFilter; alRender(); const l = document.getElementById('alList'); if (l && AL.filter && l.scrollIntoView) l.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const act = t.dataset.alAct, id = t.dataset.alId;
    if (act === 'refresh') { AL.msg = ''; const p = alLoad(true); alRender(); await p; alRender(); alRepaintElsewhere(); return; }
    if (act === 'snooze' || act === 'dismiss' || act === 'undo') {
      const mark = act === 'undo' ? null : { a: act, by: alWho(), at: Date.now(), until: act === 'snooze' ? Date.now() + AL_SNOOZE_DAYS * 864e5 : 0 };
      AL.store.marks = Object.assign({}, AL.store.marks, { [id]: mark });
      alRender();
      await alStoreSave({ marks: { [id]: mark } });
      AL.msg = AL.storeNote || (act === 'undo' ? 'Back on the list.' : act === 'snooze' ? `Snoozed for ${AL_SNOOZE_DAYS} days.` : 'Dismissed.');
      alRender(); alRepaintElsewhere();
      return;
    }
    if (act === 'csv') { alCsvDownload(alFor(AL.brand)); return; }
    if (act === 'save-set' || act === 'reset-set') {
      const s = {};
      if (act === 'save-set') document.querySelectorAll('#alPane [data-al-set]').forEach(inp => { const v = Number(inp.value); if (isFinite(v) && v >= 0 && v !== AL_DEF[inp.dataset.alSet]) s[inp.dataset.alSet] = v; });
      AL.store.settings = s; AL.store.setBy = alWho(); AL.store.setAt = Date.now();
      await alStoreSave({ settings: s, setBy: AL.store.setBy, setAt: AL.store.setAt });
      AL.msg = AL.storeNote || 'Settings saved.';
      alRender(); alRepaintElsewhere();
    }
  });
  document.addEventListener('change', e => { const s = e.target && e.target.closest && e.target.closest('#alPane [data-al-cause]'); if (s) { AL.cause = s.value; alRender(); } });
  // a row opened: its chart is drawn now (it had no size while closed)
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('#alPane details[open]')) alChartsIn(d); }, true);
  // light / dark: the charts take the new colours
  if (typeof MutationObserver === 'function') new MutationObserver(() => { if (Object.keys(AL.charts).length) setTimeout(() => Object.keys(AL.charts).forEach(id => { const el = document.querySelector(`#alPane [data-al-chart="${CSS.escape(id)}"]`); if (el) alChart(el); }), 30); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rT = 0;
  addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => Object.values(AL.charts).forEach(c => { try { c.resize(); } catch (e) { /* gone */ } }), 150); });
  // the app's ✨ (core/dashboard.js keeps the choice): the page is drawn again, still or moving
  document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('#fxBtn') && alShown()) setTimeout(alRender, 0); });
}
const alShown = () => { const p = typeof document !== 'undefined' && document.getElementById ? document.getElementById('paneSalert') : null; return !!p && !p.classList.contains('hide'); };
function alRepaintElsewhere() {
  alStripPaint();
  if (typeof dashChanged === 'function' && typeof DASH !== 'undefined' && DASH.st && DASH.st.al) { try { dashChanged('al'); } catch (e) { /* the Dashboard catches up */ } }
}
/** The tab opened (core/nav.js showTab). */
async function ensureSalert() {
  alRender();
  await alLoad();
  if (alShown()) alRender();
  alRepaintElsewhere();
}

/* ----- the Sales Dashboard's slim "Needs attention" strip (the brand on view; hidden when nothing needs attention) ----- */
function alStripPaint() {
  const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('alStrip') : null;
  if (!el) return;
  const brand = typeof SD_CH !== 'undefined' && (SD_CH === 'SP' || SD_CH === 'CPC' || SD_CH === 'ALL') ? SD_CH : null;
  if (!brand || !alMay('salert')) { el.hidden = true; return; }
  const r = alFor(brand);
  if (!r) { el.hidden = true; if (!AL.busy && !AL.data) alLoad().then(alStripPaint).catch(() => {}); return; }
  if (!r.ok || !r.alerts.length) { el.hidden = true; return; }
  const a = r.alerts[0];
  el.hidden = false;
  el.innerHTML = `<span class="al-strip-h">Needs attention</span><span class="al-strip-t"><b>${r.alerts.length} product${r.alerts.length === 1 ? '' : 's'} · ${alMoney(r.atRisk)}/week at risk</b>`
    + ` — ${alEsc(alShort(a.name))} ${alMoney(-a.atRisk)}/wk (${alEsc(AL_HEAD[a.cause.k])}) · up to ${alDay(r.last)}</span><button type="button" class="al-strip-go" data-al-open="${brand}">Open Sales Alerts →</button>`;
  if (typeof sdcRefresh === 'function') sdcRefresh();                    // the chapters below moved down: ScrollTrigger measures again
}

/* ----- the Dashboard card (core/dashboard.js slot tAl) ----- */
async function alDashLoad() { await alLoad(); }

/* ----- the full check as a CSV (How we decide → Download full check): one row per product, every number above and its verdict ----- */
function alCsvText(r) {
  if (!r || !r.ok || !r.rows) return '';
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const L = (r.rows[0] && r.rows[0].labels) || [];
  const nW = L.length - 2;
  const head = ['Brand', 'Parent ASIN', 'Product', 'Children'].concat(L.map((l, i) => (i < nW ? `Normal week ${i + 1} (${l}) $` : `Judged week ${i - nW + 1} (${l}) $`)),
    ['Normal average $/week', 'Judged week 1 vs normal %', 'Judged week 2 vs normal %', 'Brand judged week 1 %', 'Brand judged week 2 %', 'Steady baseline',
      'Normal days outside range %', 'Season factor used', 'Verdict', 'Proof / reason', '$/week at risk (−) or gain (+)', 'Low / high days']);
  const lines = [head.map(q).join(',')];
  r.rows.forEach(x => lines.push([x.brand, x.parent, x.product, x.children].concat(x.weeks, [x.normal, x.j1, x.j2, x.brandJ1, x.brandJ2, x.steady, x.outside, x.season, x.verdict, x.reason, x.money, x.days]).map(q).join(',')));
  return lines.join('\r\n');
}
function alCsvDownload(r) {
  const text = alCsvText(r);
  if (!text) return;
  try {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `sales-alerts-check_${r.brand}_${r.last}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { AL.msg = 'The download did not start: ' + ((e && e.message) || e); alRender(); }
}

/* ----- the console: salesAlertsReport('pillow') — every number used for the products whose name or parent ASIN matches ----- */
async function salesAlertsReport(query, brand) {
  await alLoad();
  const out = [], moved = [];
  const verdictOf = (r, t) => {
    const a = [].concat(r.alerts, r.waiting, r.recovered, r.wins, r.hidden, r.skipped).find(x => x.parent === t.parent && x.brand === t.brand);
    return { list: a ? a.list : 'none', text: !a ? 'no alert (inside its range)' : a.list === 'alerts' ? `CONFIRMED ${a.sev}: ${a.head} · −$${Math.round(a.atRisk)}/wk · ${a.check ? a.check.proof : ''}`
      : a.list === 'wins' ? `CONFIRMED win: ${a.head} · ${a.check ? a.check.proof : ''}` : a.list === 'review' ? `NEEDS A LOOK (${a.kind === 'wins' ? 'win' : 'drop'}): ${a.head} · ${a.check.proof}`
      : a.list + (a.why ? ': ' + a.why : a.head ? ': ' + a.head : '') };
  };
  (brand ? [brand] : ['SP', 'CPC']).forEach(b => {
    const opt = rule => ({ days: VI.data.days, today: sdToday(), brand: b, parentOf: typeof wParentOf === 'function' ? a => wParentOf(a) : null,
      nameOf: typeof viNameOf === 'function' ? viNameOf : null, stock: VI.data.stock, weekly: VI.data.weekly, adsDay: AL.data.adsDay, plan: AL.data.plan,
      lyDaily: SD && SD.d && typeof sdDays === 'function' ? { SP: sdDays('SP'), CPC: sdDays('CPC') } : null, settings: AL.store.settings, marks: AL.store.marks, now: Date.now(), trace: query == null ? '' : String(query), rule });
    const r = alCompute(opt('')), was = alCompute(opt('run'));       // now · before (the old "S.days low days in a row" rule)
    if (!r.ok) { console.warn(r.why); return; }
    (r.traced || []).forEach(t => {
      const now = verdictOf(r, t), before = verdictOf(was, t);
      t.verdict = now.text; t.before = before.text;
      if ((now.list === 'alerts') !== (before.list === 'alerts')) moved.push({ product: t.product, brand: AL_BRAND_NAME[t.brand], before: before.text, now: now.text });
      console.log(`%c${t.product} (${t.parent}, ${AL_BRAND_NAME[t.brand]})`, 'font-weight:bold', '\nnow:    ' + t.verdict, '\nbefore: ' + t.before,
        `\nnormal (own weeks) $${t.normalPerDay}/day · expected used $${t.expectedUsedPerDay}/day · brand last year ×${t.brandSeason} → used for drops ×${t.seasonUsedForDrops}, for wins ×${t.seasonUsedForWins}`
        + ` · own last year ${t.ownLastYear == null ? 'not held' : '×' + t.ownLastYear} · own normal days outside its range ${t.baselineDaysOutsideRange}`);
      console.table(t.weeks);
      out.push(t);
    });
  });
  if (!out.length) console.log('No product matches "' + query + '".');
  else {
    console.log(`%cBefore → after: ${moved.length} change${moved.length === 1 ? '' : 's'} (alerts that appear or disappear with the sustained-drop rule)`, 'font-weight:bold');
    if (moved.length) console.table(moved);
  }
  out.changes = moved;
  return out;
}
if (typeof window !== 'undefined') window.salesAlertsReport = salesAlertsReport;
/** One Dashboard view (ALL = Both, SP, CPC): { n, usd, top: [{name, usd, why}], when } or { empty: true }. */
function alDashOf(view) {
  const r = alFor(view === 'ALL' ? 'ALL' : view);
  if (!r || !r.ok) return { empty: true, why: r ? r.why : '' };
  return { n: r.alerts.length, usd: Math.round(r.atRisk), crit: r.counts.critical,
    top: r.alerts.slice(0, 3).map(a => ({ name: alShort(a.name), usd: Math.round(a.atRisk), why: AL_HEAD[a.cause.k], sev: a.sev, pct: Math.round(a.drop) })),
    when: `finished days up to ${alDay(r.last)}` };
}
