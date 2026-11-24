/* DASHBOARD — the executive redesign (24 Nov 2026): core/dashboard.js + listing/new-listings.js, in a sandbox on fixtures.
 *   node tests/dashboard-test.js
 * Covers:
 *   1. the one line (dashSummaryText): up · level · down (with Sales Alerts' products to watch) · no last year · the 1st of the month
 *   2. the four KPI cards = the Sales Dashboard (renderSales' own cards, all three views) and PPC & Organic's latest week; the chart's
 *      last year = the same weekday 364 days back; a day nobody holds is missing, never $0
 *   3. New listings (nlCompute): the first-listed date and its source (Amazon create / open date in PT, Listing History's Create Listing,
 *      "after" the snapshot, unknown), the relisting rule (sold before, the same ASIN listed earlier, a History send before), the status
 *      split, the 7 / 30-day windows, the weekly bars, the weekly-store fallback, Listing Health's "New" rows and their "needs help"
 *   4. the cards: New listings (numbers, empty state), Wins, skeletons in the cards' shapes, a kept copy shown amber "as of"
 *   5. NO ERROR COUNTS anywhere on the Dashboard; the page's order; nothing of the old page left */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const APP = path.join(__dirname, '..', 'src', 'app');
const read = p => fs.readFileSync(p, 'utf8');
const CLOCK = `(() => { const RD = Date; class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(globalThis.__now); }
  static now() { return globalThis.__now; } } globalThis.Date = FD; })();`;
const FILES = ['sales/sales-dashboard.js', 'ads/account-trends.js', 'ads/ppc-organic.js', 'listing/new-listings.js', 'core/dashboard.js'];
const SRC = FILES.map(f => `/* ${f} */\n` + read(path.join(APP, f))).join('\n;\n');
function makeEl(id, vals) {
  const cls = new Set();
  return {
    id, value: vals[id] != null ? vals[id] : '', checked: false, innerHTML: '', textContent: '', hidden: false, title: '', dataset: {}, style: {}, disabled: false,
    options: [], listeners: {}, className: '',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], focus() {}, closest: () => null, insertAdjacentHTML() {}, appendChild() {}, scrollIntoView() {},
  };
}
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub() });
let STUBS = [];
function app(nowIso) {
  for (let tries = 0; tries < 300; tries++) {
    const els = {};
    const vals = { wWeeks: '13', wBrand: 'ALL', wView: 'asin', wFilter: '', wMetric: 'sales' };
    const $ = id => els[id] || (els[id] = makeEl(id, vals));
    const store = {};
    const base = {
      __now: Date.parse(nowIso), $, els, console: { log() {}, table() {}, warn() {}, error() {}, info() {} }, Intl, Math, JSON, Promise, Set, Map, WeakMap, Number, String, Object, Array,
      isFinite, isNaN, parseFloat, parseInt, Symbol, Proxy, Error, RegExp,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, store,
      document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, visibilityState: 'visible', createElement: () => makeEl('x', {}), head: makeEl('head', {}) },
      window: { addEventListener() {} }, TAB_OK: () => true, PNAME: {}, HEALTH: { SP: { rows: [] }, CPC: { rows: [] } }, H_LOADED: true,
      ME: { email: 'x@example.com', admin: true, tabs: [], brands: [] }, MutationObserver: function () { this.observe = () => {}; },
    };
    STUBS.forEach(n => { if (!(n in base)) base[n] = stub(); });
    const ctx = vm.createContext(base);
    vm.runInContext(CLOCK, ctx);
    try {
      vm.runInContext(SRC, ctx, { filename: 'app.js' });
      ctx.run = code => vm.runInContext(code, ctx);
      return ctx;
    } catch (e) {
      const m = /^(\w+) is not defined/.exec(e.message);
      if (m && !STUBS.includes(m[1])) { STUBS.push(m[1]); continue; }
      throw e;
    }
  }
  throw new Error('sandbox: too many missing globals');
}

const NOW = '2026-11-24T18:00:00Z';                          // 10:00 PT, Tue 24 Nov 2026
const day = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Sales fixture: every day from 1 Oct 2025 to today, both brands; last year lower; Jan of both years; one missing day this year (12 Nov, CPC + SP).
function salesFixture() {
  const d = { SP: {}, CPC: {} };
  for (let x = '2025-01-01'; x <= '2026-11-24'; x = day(x, 1)) {
    if (x > '2025-01-31' && x < '2025-10-01') continue;
    if (x > '2026-01-31' && x < '2026-10-01') continue;
    if (x === '2026-11-12') continue;
    const dow = new Date(x + 'T00:00:00Z').getUTCDay(), ty = x >= '2026-01-01';
    d.SP[x] = [Math.round(((ty ? 1500 : 900) + dow * 37 + Number(x.slice(8)) * 3.25) * 100) / 100, 20, 18];
    d.CPC[x] = [Math.round(((ty ? 300 : 260) + dow * 11) * 100) / 100, 6, 5];
  }
  d.SP['2026-11-24'] = [410.5, 5, 5];                        // today: a few hours of trading
  d.CPC['2026-11-24'] = [88, 1, 1];
  return { at: '2026-11-24 04:10', d };
}
const T = (C, id) => strip(C.$(id).innerHTML || C.$(id).textContent);

console.log('== 1. the one line: written from the numbers, positive / neutral tone ==');
{
  const C = app(NOW);
  const S = o => C.run(`dashSummaryText(${JSON.stringify(Object.assign({ month: 'November', doneDays: 23, rate7: 12000 }, o))}, ${JSON.stringify(o.al || null)})`);
  eq('up: "November is going well: $560k so far, +70% vs last year, on track for ~$827k."',
    S({ mtd: 560000, mc: 545000, ml: 320588, proj: 827000 }), { tone: 'up', text: 'November is going well: $560k so far, +70% vs last year, on track for ~$827k.' });
  eq('down, with Sales Alerts: "November: $41.2k so far, −12% vs last year, on track for ~$58k — 2 products to watch."',
    S({ mtd: 41200, mc: 39600, ml: 45000, proj: 58000, al: { n: 2 } }), { tone: 'down', text: 'November: $41.2k so far, −12% vs last year, on track for ~$58k — 2 products to watch.' });
  eq('down, nothing confirmed to watch: no "products" clause', S({ mtd: 41200, mc: 39600, ml: 45000, proj: 58000, al: { n: 0 } }).text, 'November: $41.2k so far, −12% vs last year, on track for ~$58k.');
  eq('down, one product: singular', S({ mtd: 9100, mc: 9000, ml: 9500, proj: 12000, al: { n: 1 } }).text, 'November: $9,100 so far, −5.3% vs last year, on track for ~$12k — 1 product to watch.');
  eq('level (within ±2 %): neutral words', S({ mtd: 300000, mc: 290000, ml: 286000, proj: 410000 }), { tone: 'level', text: 'November is level with last year: $300k so far (+1.4%), on track for ~$410k.' });
  eq('no last-year data: says so, no %', S({ mtd: 1234567, mc: 1200000, ml: 0, proj: 1.6e6 }), { tone: 'neutral', text: 'November so far: $1.23M, on track for ~$1.6M. No last-year figures to compare with yet.' });
  eq('the 1st of the month: no comparison yet', S({ doneDays: 0, mtd: 950, mc: 0, ml: 0, proj: 300000 }).text, 'November has just begun: $950 so far today, on track for ~$300k.');
  eq('no rate yet (no sales in the last 7 days): no projection', S({ rate7: 0, mtd: 5000, mc: 5000, ml: 4000, proj: 5000 }).text, 'November is going well: $5,000 so far, +25% vs last year.');
  eq('money words: $8,450 · $56.3k · $560k · $1.24M', ['8450', '56320', '560400', '1239000'].map(v => C.run(`dashCompact(${v})`)), ['$8,450', '$56.3k', '$560k', '$1.24M']);
}

console.log('== 2. the KPI cards = the Sales Dashboard, every view; the chart ==');
{
  const C = app(NOW);
  C.run(`SD = ${JSON.stringify(salesFixture())}; SD_CH = 'SP';`);
  const d = C.run('DASH_CALC.sales()');
  [['SP', 'SP'], ['CPC', 'CPC'], ['ALL', 'ALL']].forEach(([view, ch]) => {
    C.run(`SD_CH = '${ch}'; renderSales();`);
    const v = d[view];
    const money = x => C.run(`DASH_FMT.money(${x})`);
    eq(`${view}: Sales this month = the Sales Dashboard's MTD card`, money(v.mtd), T(C, 'sdMtd'));
    eq(`${view}: Yesterday = its Yesterday card`, money(v.yest), T(C, 'sdYest'));
    eq(`${view}: year to date $ = its YTD card`, money(v.ytd), T(C, 'sdYtd'));
    eq(`${view}: MTD ▲ % = its MTD % (complete days)`, '▲' + ((v.mc - v.ml) / v.ml * 100).toFixed(1) + '%', (T(C, 'sdMtdp').match(/[▲▼][\d.]+%/) || [''])[0]);
    eq(`${view}: YTD % = its YTD % (complete days)`, '▲' + ((v.yc - v.yl) / v.yl * 100).toFixed(1) + '%', (T(C, 'sdYtdp').match(/[▲▼][\d.]+%/) || [''])[0]);
    eq(`${view}: "on track for" = its Expected — month`, money(v.proj), T(C, 'sdProj'));
  });
  eq('the Dashboard put the channel back (SD_CH unchanged)', C.run('SD_CH'), 'ALL');
  C.run("TAB_OK = () => true; DASH.st.sales = { s: 'ok' }; DASH.brand = 'SP'; DASH.memo = {};");
  const k = strip(C.run('DASH_PAINT.kMtd()'));
  C.run("SD_CH = 'SP'; renderSales();");
  ok('the card shows that very MTD text, its ▲ % vs last year and an "as of"', k.includes(T(C, 'sdMtd')) && /▲ [\d.]+% vs last year/.test(k) && /as of nightly run 2026-11-24 04:10/.test(k), k);
  const y = strip(C.run('DASH_PAINT.kYest()'));
  ok('Yesterday card: vs the same weekday last year (Mon 24 Nov 2025 = 364 days back)', y.includes(T(C, 'sdYest')) && /vs Mon 24 Nov last year/.test(y), y);
  const ytd = strip(C.run('DASH_PAINT.kYtd()'));
  ok('YTD card: the % big, the Sales Dashboard\'s YTD $ under it', /^Year to date vs last year i .*\+[\d.]+%/.test(ytd) && ytd.includes(T(C, 'sdYtd') + ' so far this year'), ytd);
  const sum = strip(C.run('DASH_PAINT.summary()'));
  ok('the line on the real numbers: "November is going well: $… so far, +…% vs last year, on track for ~$…." + its as-of', /^November is going well: \$[\d.]+k so far, \+\d+% vs last year, on track for ~\$[\d.]+k\. Sales Dashboard figures · nightly run/.test(sum), sum);
  // the chart
  const days = d.SP.days;
  eq('chart: 30 days, the last is today', [days.length, days[29].d], [30, '2026-11-24']);
  const p = days.find(x => x.d === '2026-11-20');
  eq('chart: last year = the same weekday 364 days back (Fri 20 Nov 2026 ↔ Fri 21 Nov 2025)', p.ly, salesFixture().d.SP['2025-11-21'][0]);
  eq('chart: 12 Nov held by no brand → missing (null), never $0', days.find(x => x.d === '2026-11-12').v, null);
  const html = C.run("DASH_PAINT.chart()");
  ok('chart: today dashed apart, last year dashed, one blue line with a soft fill; keyboard + a spoken summary', /class="dash-today"/.test(html) && /class="dash-ly"/.test(html) && /class="dash-ty"/.test(html)
    && /class="dash-area"/.test(html) && /tabindex="0" role="img" aria-label="Daily sales, the last 30 days\. On the 28 complete days both years hold: \$[\d,]+ this year against \$[\d,]+/.test(html), html.slice(0, 400));
  ok('chart: no legend box, no zoom', !/legend|zoom/i.test(html));
  // ads
  C.run(`DASH.weekly = { weeks: ['2026-11-08', '2026-11-15', '2026-11-22'], at: '2026-11-24 05:10', adAt: '2026-11-24 07:40', rows: {
    A1: { brand: 'SP', weeks: { '2026-11-08': { rev: 1000, spend: 120 }, '2026-11-15': { rev: 1000, spend: 100 }, '2026-11-22': { rev: 500, spend: 40 } } } } };
    adBrands = () => ['SP', 'CPC']; DASH.st.ads = { s: 'ok' }; DASH.memo = {};`);
  const a = strip(C.run('DASH_PAINT.kAds()'));
  ok('Ad spend this week: $40, TACoS 8% — ▼ 2 pt vs the week before (lower = green), the running week\'s days', /^Ad spend this week i .*\$40 TACoS 8% ▼ 2 pt vs Nov 15-21 Nov 22-28 · \d\/7 days/.test(a), a);
  ok('…TACoS down is green (is-up)', /dash-chg is-up/.test(C.run('DASH_PAINT.kAds()')));
}

console.log('== 3. New listings: the date, its source, the relisting rule, the status split ==');
const LMX = {
  'SP|SP-N1': { cr: '2026-11-20T03:00:00Z', as: 'BUYABLE,DISCOVERABLE' },        // 19 Nov in PT
  'SP|SP-N3': { cr: '2026-11-01T12:00:00Z', as: 'BUYABLE' },                     // the report's open date (30 Oct) is earlier
  'CPC|CPC-N1': { cr: '', as: 'DISCOVERABLE' },                                   // not buyable
};
const ROWS = {
  SP: [
    { sku: 'SP-N1', asin: 'B0N1', parent: 'P1', title: 'Ridhi Block Print Napkin Set of 4', qty: 10, status: 'Active', opened: '' },
    { sku: 'SP-N2', asin: 'B0N2', parent: 'P2', title: 'Ridhi Table Runner', qty: 5, status: 'Active', opened: '2026-11-10' },
    { sku: 'SP-N3', asin: 'B0N3', parent: 'P3', title: 'Ridhi Quilt', qty: 0, status: 'Active', opened: '2026-10-30' },
    { sku: 'SP-R1', asin: 'B0R1', title: 'sold before', qty: 3, status: 'Active', opened: '2026-11-15' },
    { sku: 'SP-OLD', asin: 'B0OLD', title: 'old one', qty: 3, status: 'Active', opened: '2024-05-01' },
    { sku: 'SP-R2-NEW', asin: 'B0OLD', title: 'a new SKU on an old product', qty: 3, status: 'Active', opened: '2026-11-18' },
    { sku: 'SP-R3', asin: 'B0R3', title: 'weekly sold before', qty: 3, status: 'Active', opened: '2026-11-12' },
    { sku: 'SP-R4', asin: 'B0R4', title: 'sent before', qty: 3, status: 'Active', opened: '2026-11-16' },
    { sku: 'SP-L1', asin: 'B0L1', title: 'Made in Create Listing', qty: null, status: '', opened: '', lmAdded: true },
    { sku: 'SP-S1', asin: 'B0S1', title: 'Seen after the snapshot', qty: 2, status: 'Active', opened: '', lmAdded: true },
    { sku: 'SP-U1', asin: 'B0U1', title: 'no date anywhere', qty: 2, status: 'Active', opened: '' },
  ],
  CPC: [{ sku: 'CPC-N1', asin: 'B0C1', title: 'CPC Pillow Cover', qty: 4, status: 'Active', opened: '2026-11-23' }],
};
const DAILY = { d: { B0N1: { '2026-11-21': [3, 89.97] }, B0R1: { '2026-10-20': [1, 20] }, B0S1: { '2026-11-23': [1, 15] }, B0N2: { '2026-11-22': [0, 0] } }, from: '2026-10-11', upTo: '2026-11-23' };
const WEEKLY_ROWS = { B0R3: { brand: 'SP', weeks: { '2026-09-27': { u: 2, rev: 40 } } }, B0N2: { brand: 'SP', weeks: { '2026-11-08': { u: 2, rev: 50 } } } };
const LHR = [
  { brand: 'SP', sku: 'SP-R4', at: Date.parse('2026-11-02T20:00:00Z'), screen: 'Listing Health', result: 'accepted' },
  { brand: 'SP', sku: 'SP-L1', at: Date.parse('2026-11-22T20:00:00Z'), screen: 'Create Listing', result: 'accepted' },
];
const inputJs = (o = {}) => `({ today: '2026-11-24', brands: ['SP', 'CPC'], rows: ${JSON.stringify(ROWS)}, snapAt: { SP: Date.parse('2026-11-21T20:00:00Z'), CPC: null },
  lm: (b, sku) => (${JSON.stringify(LMX)})[b + '|' + sku] || null, lh: ${JSON.stringify(LHR)},
  daily: ${JSON.stringify(o.daily === undefined ? DAILY : o.daily)}, weekly: { rows: ${JSON.stringify(WEEKLY_ROWS)}, at: '2026-11-24 05:10' } })`;
{
  const C = app(NOW);
  const res = C.run(`nlCompute(${inputJs()})`);
  const by = Object.fromEntries(res.items.map(it => [it.sku, it]));
  eq('the new ones: SP-L1, SP-S1, CPC-N1, SP-N1, SP-N2, SP-N3 (newest first; the "after" one by its bound)', res.items.map(it => it.sku), ['CPC-N1', 'SP-L1', 'SP-S1', 'SP-N1', 'SP-N2', 'SP-N3']);
  eq('Amazon\'s createdDate is a UTC time → the PT day (20 Nov 03:00 UTC = 19 Nov)', [by['SP-N1'].date, by['SP-N1'].srcText], ['2026-11-19', 'Amazon create date']);
  eq('both Amazon dates held → the earlier (the report\'s open date 30 Oct)', [by['SP-N3'].date, by['SP-N3'].srcText], ['2026-10-30', 'Amazon open date']);
  eq('no Amazon date, a Create Listing send in Listing History → that day', [by['SP-L1'].date, by['SP-L1'].src], ['2026-11-22', 'lh']);
  eq('no Amazon date, no History: added after the 21 Nov snapshot → "after 21 Nov", a bound (≤ 2 days), never a guessed day',
    [by['SP-S1'].date, by['SP-S1'].after, by['SP-S1'].approx, by['SP-S1'].maxDays, by['SP-S1'].src], ['', '2026-11-21', true, 2, 'snapshot']);
  eq('no date anywhere → not counted (1 undated)', [!by['SP-U1'], res.undated], [true, 1]);
  eq('sources used: Amazon 4 · snapshot 1 · Listing History 1', res.src, { amazon: 4, snapshot: 1, lh: 1 });
  const rel = Object.fromEntries(res.relisted.map(r => [r.sku, r.why]));
  eq('relistings, not new: SP-R1, SP-R2-NEW, SP-R3, SP-R4', Object.keys(rel).sort(), ['SP-R1', 'SP-R2-NEW', 'SP-R3', 'SP-R4']);
  ok('…SP-R1: its ASIN sold on 20 Oct, before its 15 Nov date (the per-day cache)', /sold on 20 Oct/.test(rel['SP-R1']), rel['SP-R1']);
  ok('…SP-R2-NEW: the same product was listed earlier as SP-OLD', /same product \(B0OLD\) was listed earlier as SP-OLD/.test(rel['SP-R2-NEW']), rel['SP-R2-NEW']);
  ok('…SP-R3: sold in the week of 27 Sep (the weekly store)', /week of 27 Sep/.test(rel['SP-R3']), rel['SP-R3']);
  ok('…SP-R4: a Listing History send on 2 Nov, before its 16 Nov date', /Listing History has a send for it on 2 Nov/.test(rel['SP-R4']), rel['SP-R4']);
  ok('the old SKU itself (2024) is not looked at', !by['SP-OLD'] && !rel['SP-OLD']);
  eq('status: N1 selling (3 units, $89.97 since listed)', [by['SP-N1'].state, by['SP-N1'].units, by['SP-N1'].rev, by['SP-N1'].salesSrc], ['selling', 3, 89.97, 'daily']);
  eq('status: N2 live (Active + stock, no cache read), 0 units → live, no sale yet', [by['SP-N2'].state, by['SP-N2'].live], ['nosale', true]);
  eq('status: N3 stock 0 → not live yet', [by['SP-N3'].state, by['SP-N3'].live], ['notlive', false]);
  eq('status: CPC-N1 Amazon says DISCOVERABLE, not BUYABLE → not live yet', by['CPC-N1'].state, 'notlive');
  eq('status: S1 (after the snapshot) sold 1 on 23 Nov → selling', by['SP-S1'].state, 'selling');
  eq('days since listed: N1 5, N2 14, N3 25, CPC-N1 1', ['SP-N1', 'SP-N2', 'SP-N3', 'CPC-N1'].map(s => by[s].days), [5, 14, 25, 1]);
  const s30 = C.run(`nlSummary(nlCompute(${inputJs()}), ['SP', 'CPC'], 30)`), s7 = C.run(`nlSummary(nlCompute(${inputJs()}), ['SP', 'CPC'], 7)`);
  eq('All, 30 days: 6 new · 2 selling · 1 live, no sale yet · 3 not live yet', [s30.n, s30.selling, s30.nosale, s30.notlive, s30.nodata], [6, 2, 1, 3, 0]);
  eq('All, 7 days: 4 (N1 5 days, L1 2, S1 ≤2, CPC-N1 1)', s7.n, 4);
  eq('top new listing: the Napkin Set, 3 units', [s30.top.name, s30.top.units], ['Ridhi Block Print Napkin Set of 4', 3]);
  eq('bars, 8 weeks (Sun 4 Oct … Sun 22 Nov): 0 0 0 1 0 1 1 2 (the "after" one has no day of its own)', s30.bars.map(b => b.n), [0, 0, 0, 1, 0, 1, 1, 2]);
  const sp = C.run(`nlSummary(nlCompute(${inputJs()}), ['SP'], 30)`), cpc = C.run(`nlSummary(nlCompute(${inputJs()}), ['CPC'], 30)`);
  eq('Ridhi 5 + CPC 1 = All 6; relisted counted per brand (4 · 0)', [sp.n, cpc.n, sp.relisted, cpc.relisted], [5, 1, 4, 0]);
  // the weekly store when the per-day cache does not reach back to the listed day
  const w = C.run(`nlCompute(${inputJs({ daily: Object.assign({}, DAILY, { from: '2026-11-15' }) })}).items.find(it => it.sku === 'SP-N2')`);
  eq('per-day cache starts 15 Nov, N2 listed 10 Nov → the weekly store (week of 8 Nov: 2 units, $50) → selling', [w.salesSrc, w.units, w.rev, w.state], ['weekly', 2, 50, 'selling']);
  const none = C.run(`nlCompute(Object.assign(${inputJs({ daily: null })}, { weekly: null })).items.find(it => it.sku === 'SP-N2')`);
  eq('no sales store at all → units unknown ("no sales data"), never "no sale"', [none.units, none.state], [null, 'nodata']);
}

console.log('== 4. the cards: New listings, Wins, skeletons, the kept copy ==');
function withNl(C, rows) {
  C.run(`HEALTH = { SP: { rows: ${JSON.stringify((rows || ROWS).SP)}, at: new Date(Date.parse('2026-11-21T20:00:00Z')) }, CPC: { rows: ${JSON.stringify((rows || ROWS).CPC)}, at: null } };
    H_LOADED = true; lmGet = (sku, b) => (${JSON.stringify(LMX)})[b + '|' + sku] || null; lmVersion = () => 1; LM = { ov: 0, busy: null };
    VI = { v: 1, data: { days: ${JSON.stringify(DAILY)}, weekly: null } }; LH = { rows: ${JSON.stringify(LHR)}, loading: false, err: '' };
    DASH.weekly = { weeks: [], rows: ${JSON.stringify(WEEKLY_ROWS)}, at: '2026-11-24 05:10' }; lmDataLabel = () => null;
    NL.memo = null; DASH.memo = {}; DASH.st.nl = { s: 'ok' }; DASH.brand = 'ALL'; DASH.nlDays = 30; TAB_OK = () => true;`);
}
{
  const C = app(NOW);
  withNl(C);
  const html = C.run('DASH_PAINT.cNew()'), t = strip(html);
  ok('New listings, 30 days: "6 new listings · 2 selling · 1 live, no sale yet · 3 not live yet · Top: … · 3 units"',
    /New listings 7 days 30 days Open → 6 new listings 2 selling · 1 live, no sale yet · 3 not live yet Top: Ridhi Block Print Napkin Set of 4 · 3 units/.test(t), t);
  ok('…says which first-listed date it used, and the relistings it left out', /First-listed date: Amazon's create \/ open date · Listing History \(Create Listing\) · first Sellora snapshot · 4 relisted SKUs not counted/.test(t), t);
  ok('…the 8 weekly bars, with a spoken summary', (html.match(/class="dash-bar/g) || []).length === 8 && /aria-label="New listings per week, the last 8 weeks: 0, 0, 0, 1, 0, 1, 1, 2 \(5 in all\)"/.test(html));
  ok('…Open → Listing Health "New (30 days)"', /data-dash-open="health" data-dash-level="new30"/.test(html));
  ok('…the 7 / 30 toggle, 30 pressed', /data-dash-nl="30" aria-pressed="true"/.test(html) && /data-dash-nl="7" aria-pressed="false"/.test(html));
  C.run('DASH.nlDays = 7;');
  ok('7 days: 4 new listings, Open → "New (7 days)"', /4 new listings/.test(strip(C.run('DASH_PAINT.cNew()'))) && /data-dash-level="new7"/.test(C.run('DASH_PAINT.cNew()')));
  C.run("DASH.brand = 'CPC'; DASH.nlDays = 30;");
  ok('CPC: 1 new listing (singular)', /1 new listing 0 selling · 0 live, no sale yet · 1 not live yet/.test(strip(C.run('DASH_PAINT.cNew()'))), strip(C.run('DASH_PAINT.cNew()')));
  // empty: only old listings
  withNl(C, { SP: [ROWS.SP[4]], CPC: [] });
  const e = strip(C.run('DASH_PAINT.cNew()'));
  ok('empty: "No new listings in the last 30 days." — friendly, no error word', /No new listings in the last 30 days\./.test(e) && !/error|couldn't|fail/i.test(e), e);
  // Listing Health's "New" rows and what needs help
  withNl(C);
  const pick = (sku, view, h) => C.run(`(() => { const r = Object.assign({}, HEALTH.SP.rows.concat(HEALTH.CPC.rows).find(x => x.sku === '${sku}'), { brand: '${sku}'.startsWith('CPC') ? 'CPC' : 'SP', _h: ${JSON.stringify(h || {})} });
    return { on: nlHealthPick(r, '${view}'), help: r._nlHelp || [] }; })()`);
  eq('Listing Health "New (30 days)": N2 in it — no sale after 14 days, 4 images', pick('SP-N2', 'new30', { pics: { main: true, n: 4 } }), { on: true, help: ['no sale after 14 days', 'fewer than 6 images (4)'] });
  eq('…N3: not live after 7 days, no main image (0)', pick('SP-N3', 'new30', { pics: { main: false, n: 0 } }), { on: true, help: ['not live after 7 days', 'no sale after 14 days', 'fewer than 6 images (0)'] });
  eq('…N1 (selling, 7 images): nothing to help', pick('SP-N1', 'new30', { pics: { main: true, n: 7 } }), { on: true, help: [] });
  eq('"New (7 days)": N3 (25 days) is not in it', pick('SP-N3', 'new7').on, false);
  eq('a relisting is never in it', pick('SP-R1', 'new30').on, false);
  const defs = C.run('nlHealthDefs(true).map(d => d.t)');
  eq('the table: SKU, ASIN, brand, parent, title, date listed, days, status, stock, units & $ since listed, images, A+, errors, needs help', defs,
    ['SKU', 'ASIN', 'Brand', 'Parent', 'Title', 'Date listed', 'Days', 'Status', 'Stock', 'Units since listed', '$ since listed', 'Images', 'A+', 'Errors', 'Needs help']);
  // Wins: only when there is one
  C.run("DASH.memo.al = { ALL: { n: 2, usd: 900, wins: [{ name: 'Block Print Pillow Cover', pct: 24, usd: 310 }, { name: 'Napkin Set', pct: 18, usd: 120 }], winN: 3, when: 'finished days up to 23 Nov' } }; DASH.st.al = { s: 'ok' }; DASH.sigUsed.al = null; DASH.brand = 'ALL';");
  const wins = strip(C.run('DASH_PAINT.cWins()'));
  ok('Wins this week: the top 2, green, +% and +$/wk', /^Wins this week Open → Block Print Pillow Cover \+24% · \+\$310\/wk Napkin Set \+18% · \+\$120\/wk as of finished days up to 23 Nov$/.test(wins), wins);
  C.run("DASH.memo.al = { ALL: { n: 0, usd: 0, wins: [], winN: 0, when: 'x' } };");
  eq('…no win → no card at all', C.run('DASH_PAINT.cWins()'), '');
  // skeletons and the kept copy
  const C2 = app(NOW);
  C2.run("TAB_OK = () => true; DASH.st.sales = { s: 'loading' }; DASH.brand = 'SP';");
  const sk = C2.run('DASH_PAINT.kMtd()');
  ok('loading: a skeleton in the card\'s own shape (label, number, change, line, as-of)', /dash-kpi-h/.test(sk) && /class="dash-num"><span class="dash-sk" style="width:62%;height:34px"/.test(sk)
    && /class="dash-delta"><span class="dash-sk"/.test(sk) && /height:36px/.test(sk) && /loading…/.test(sk), sk);
  C2.run(`localStorage.setItem('selloraDash.v4', JSON.stringify({ sales: { SP: Object.assign(${JSON.stringify({ mtd: 1234, mc: 1000, ml: 900, yc: 1, yl: 1, ytd: 1, yest: 50, yestLy: 40, yestLyDay: '2025-11-24',
    rate7: 10, proj: 2000, doneDays: 23, month: 'November', spark: { mtd: [1, 2], yest: [1, 2], ytd: [1, 2] }, days: [], when: 'nightly run x' })}, { at: Date.parse('2026-11-24T08:00:00Z') }) } }));`);
  const kept = C2.run('DASH_PAINT.kMtd()');
  ok('a kept copy shows at once, in amber "as of <time> · updating…"', /\$1,234/.test(kept) && /dash-asof is-old/.test(kept) && /as of 24 Nov, \d\d:\d\d · updating…/.test(strip(kept)), strip(kept));
  ok('…and the line too', /November is going well: \$1,234 so far, \+11% vs last year, on track for ~\$2,000\./.test(strip(C2.run('DASH_PAINT.summary()'))) && /is-old/.test(C2.run('DASH_PAINT.summary()')));
}

console.log('== 5. no error counts anywhere on the Dashboard; the page ==');
{
  const C = app(NOW);
  // listings full of problems: the Dashboard must not count them
  C.run(`SD = ${JSON.stringify(salesFixture())}; SD_CH = 'SP';`);
  withNl(C);
  C.$('dashRoot');
  C.run('dashRender()');                                   // the page (it starts its numbers over: the memos below come after it)
  C.run(`DASH.st.sales = { s: 'ok' }; DASH.st.vi = { s: 'ok' }; DASH.st.ads = { s: 'ok' }; adBrands = () => ['SP', 'CPC'];
    DASH.memo.vi = { ALL: { head: 'Revenue rose $1,200 last week', pct: 4.2, up: true, text: 'Pillow covers led the rise.', when: 'Nov 15-21' } };
    DASH.memo.al = { ALL: { n: 3, usd: 4200, crit: 2, top: [], wins: [{ name: 'Napkin', pct: 20, usd: 99 }], winN: 1, when: 'x' } }; DASH.st.al = { s: 'ok' };
    DASH.weekly.weeks = ['2026-11-15', '2026-11-22']; DASH.weekly.rows.A1 = { brand: 'SP', weeks: { '2026-11-15': { rev: 900, spend: 90 }, '2026-11-22': { rev: 300, spend: 33 } } };
    HEALTH.SP.rows.forEach(r => { r.issues = ['Critical']; });`);
  const page = C.run("dashHeadHtml() + DASH_SLOTS.map(id => DASH_PAINT[id]()).join('')");
  const text = strip(page);
  ok('every card drew (summary, 4 KPIs, chart, This week, New listings, Wins)', DASH_SLOTS_ALL(C).every(id => C.run(`DASH_PAINT.${id}()`).length > 0), DASH_SLOTS_ALL(C).filter(id => !C.run(`DASH_PAINT.${id}()`).length));
  ok('no error words or counts: Critical, Needs action / review, Healthy, Monitor, errors, Need pictures, BSR, Aged 181+, Listing flow, Listing Health counts',
    !/\b(critical|needs? action|needs? review|healthy|monitor|errors?|need pictures|bsr|aged|181|listing flow|needs attention)\b/i.test(text), (text.match(/\b(critical|needs? action|needs? review|healthy|monitor|errors?|need pictures|bsr|aged|181|listing flow|needs attention)\b/ig) || []).join(', '));
  ok('no red error badges or old pieces (ticker, flow, donuts, tiles, confetti, dots)', !/dash-(ticker|flow|donut|tile|party|dots|aurora|bad|step|pipe)|is-c"|data-dash-level="(critical|action|review)"/.test(page));
  ok('the header: greeting, date, brand switch Ridhi / CPC / All, "Updated"', /^Good (morning|afternoon|evening)/.test(strip(C.run('dashHeadHtml()'))) && /data-dash-brand="SP"[^>]*>Ridhi<.*data-dash-brand="CPC"[^>]*>CPC<.*data-dash-brand="ALL"[^>]*>All</.test(C.run('dashHeadHtml()'))
    && /dash-upd/.test(C.run('dashHeadHtml()')));
  const root = C.$('dashRoot').innerHTML;
  const order = ['dash-head', 'dash-summary', 'dash-kMtd', 'dash-kYest', 'dash-kAds', 'dash-kYtd', 'dash-chart', 'dash-cVi', 'dash-cNew', 'dash-cWins'].map(k => root.indexOf(k));
  ok('the page, top to bottom: header · line · Sales this month · Yesterday · Ad spend · Year to date · chart · This week · New listings · Wins', order.every((x, i) => x >= 0 && (!i || x > order[i - 1])), order);
  ok('every card has its "as of"', ['kMtd', 'kYest', 'kAds', 'kYtd', 'chart', 'cVi', 'cNew', 'cWins'].every(id => /dash-asof/.test(C.run(`DASH_PAINT.${id}()`))) && /Sales Dashboard figures · nightly run/.test(strip(C.run('DASH_PAINT.summary()'))));
  ok('every KPI has its definition (ⓘ, a tooltip reachable by keyboard)', ['kMtd', 'kYest', 'kAds', 'kYtd'].every(id => /<button type="button" class="dash-i" aria-label="What[^"]+" aria-describedby="dashTip-\w+">/.test(C.run(`DASH_PAINT.${id}()`)) && /role="tooltip"/.test(C.run(`DASH_PAINT.${id}()`))));
  const src = read(path.join(APP, 'core', 'dashboard.js'));
  ok('the file no longer reads Listing Health\'s judgement, Image Manager, Listing Errors, BSR or Inventory Age for the page',
    !/hHealthKept|dashHealthCounts|imProblems|IM_NEEDS|loadBsrCache|bsrMove|loadAgeCache|DASH_BUCKETS/.test(src));
  ok('Numbers Check still has DASH_CALC.sales / ads / age', ['sales', 'ads', 'age'].every(k => C.run(`typeof DASH_CALC.${k}`) === 'function'));
  const css = read(path.join(__dirname, '..', 'src', 'styles.css'));
  const block = css.slice(css.indexOf('/* --- THE PAGE (24 Nov 2026 redesign)'), css.indexOf('/* Listing Health "New (30 days)"'));
  ok('CSS: one font size set — KPI 32px/600, labels 13px, the line 21px, 16px corners, tabular numbers, max width 1200px',
    /\.dash-num\{[^}]*font-size:32px;font-weight:600/.test(block) && /\.dash-lbl\{[^}]*font-size:13px/.test(block) && /\.dash-sum\{[^}]*font-size:21px/.test(block)
    && /border-radius:16px/.test(block) && /tabular-nums/.test(block) && /max-width:1200px/.test(block));
  ok('CSS: dark mode drops the shadow; phone = KPIs 2 × 2, small cards stacked; reduced motion = still', /data-theme="dark"\] #paneDash\{--d-sh:none\}/.test(block)
    && /max-width:1000px\)\{\s*#paneDash \.dash-kpis\{grid-template-columns:repeat\(2/.test(block) && /max-width:700px\)[\s\S]*\.dash-smalls,#paneDash \.dash-smalls\[data-n\]\{grid-template-columns:minmax\(0,1fr\)/.test(block)
    && /prefers-reduced-motion:reduce\)\{ #paneDash \*/.test(block));
  ok('CSS: no red anywhere in the block except the ▼ colour token', !/--bad(?!-ink)\b|#e5484d|#dc2626|\bred\b/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--d-dn:var\(--bad-ink\)/, '')));
}
function DASH_SLOTS_ALL(C) { return C.run('DASH_SLOTS'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
