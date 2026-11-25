/* Forecast (src/app/sales/forecast.js, Sales card #5): the weeks (daily cache + weekly store), stock-out / suppressed weeks skipped, the
 * base (8 weeks, recent first, spikes capped), the season (brand last year, capped 0.5–2×, only with enough sales, only when the blind
 * test is not worse), the damped trend, the blind test → range width and confidence, the gate (8 weeks, 3 units/week), reorder by the
 * HIGH-demand cover against the lead time (⛔ 🔴 🟡 🟢, Not selling, No stock data, inactive), children adding up to the family, the
 * Ridhi / CPC / Both views, the page (chips filter, Stock > 0 only, hidden inactive, ✨ off / reduced motion), the drawer, the CSV,
 * forecastCheck's trace, and the wiring (tab, menu, pane, ORDER, styles scoped to the page).
 *   node tests/forecast-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 600) : '')); } };
const SRC = p => fs.readFileSync(path.join(__dirname, '..', 'src', p), 'utf8');
const AL_SRC = SRC('app/sales/sales-alerts.js'), FO_SRC = SRC('app/sales/forecast.js');

/* ---- a small fake page: enough for foRender (it writes HTML strings) and the drawer (open / close) ---- */
function fakeDom() {
  const els = {};
  const doc = { activeElement: null };
  class El {
    constructor(id) {
      this.id = id; this.innerHTML = ''; this.hidden = false; this.tabIndex = 0; this.dataset = {}; this.attrs = {}; this.isConnected = true; this.kids = [];
      const set = new Set();
      this.classList = { toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, contains: c => set.has(c), add: c => set.add(c), remove: c => set.delete(c) };
      const st = {};
      this.style = { setProperty: (k, v) => { st[k] = v; }, removeProperty: k => { delete st[k]; }, get: k => st[k] };
    }
    set className(v) { v.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c)); }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(c) { this.kids.push(c); if (c.id) els[c.id] = c; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains() { return false; }
    focus() { doc.activeElement = this; }
  }
  Object.assign(doc, { getElementById: id => els[id] || null, createElement: () => new El(''), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: new El('html') });
  els.paneFcast = new El('paneFcast'); els.foPane = new El('foPane');
  return { doc, els };
}
function load(opt) {
  opt = opt || {};
  const store = {};
  const dom = fakeDom();
  const ctx = vm.createContext(Object.assign({
    console, Intl, Math, JSON, Number, String, Object, Array, Set, Map, WeakMap, Promise, Date, isFinite, setTimeout, clearTimeout,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    ME: { admin: true, tabs: [], email: 'test@example.com' }, SD: { at: '', d: {} }, SD_CH: 'SP',
    document: dom.doc, addEventListener() {}, getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }), CSS: { escape: s => s },
    matchMedia: () => ({ matches: !!opt.reduce }), sdcFxSaved: () => opt.fx !== false,
  }, opt.extra || {}));
  vm.runInContext(AL_SRC + '\n' + FO_SRC + `
;this.__x = { FO, FO_M, FO_DEF, FO_ST, foCompute, foModel, foBacktest, foLyIndex, foKid, foFor, foRender, foShownFams, foChipsHtml, foTableHtml, foActHtml, foHeroHtml,
  AL, foDrawerOpen, foDrawerClose, foDrawerHtml, foFind, foStory, foTrace, foCsvText, foVisibleKids, alGroupAdd, alAdd, alCompute };`, ctx);
  return Object.assign(ctx.__x, { ctx, store, dom });
}
const X = load();
const { alAdd } = X;

/* ---- the fixture: today Wed 25 Nov 2026 (PT) → last finished day Tue 24 Nov; the last finished week 15–21 Nov; 26 weeks from 24 May ---- */
const TODAY = '2026-11-25', LAST = '2026-11-24', L = '2026-11-15', D_FROM = '2026-10-11', W0 = alAdd(L, -7 * 25);
const dayList = (a, b) => { const o = []; for (let d = a; d <= b; d = alAdd(d, 1)) o.push(d); return o; };
const ALLDAYS = dayList(W0, LAST);
const weekOf = d => alAdd(d, -new Date(d + 'T00:00:00Z').getUTCDay());
const widx = d => Math.round((new Date(weekOf(d)) - new Date(W0)) / 864e5 / 7);
/** A fixture world: products added with add(); build() gives the engine's inputs. */
function world() {
  const rows = {}, d = {}, brand = {}, stock = { SP: { m: {}, at: '2026-11-24T05:00:00.000Z', skuOf: {} }, CPC: { m: {}, at: '2026-11-24T05:00:00.000Z', skuOf: {} } }, parent = {}, names = {}, info = {};
  /** perDay(day, weekIndex) → expected units that day (0 = out of stock); units are spread by error diffusion, so a week adds up exactly. */
  function add(asin, b, par, perDay, st, opt) {
    opt = opt || {};
    rows[asin] = { brand: b, weeks: {} }; d[asin] = {}; brand[asin] = b; parent[asin] = par;
    names[par] = names[par] || opt.name || 'Family ' + par;
    info[b + '|' + asin] = { skus: [asin + '-SKU'], title: (opt.name || 'Product') + ' ' + asin };
    let acc = 0;
    ALLDAYS.forEach(day => {
      const v = Math.max(0, perDay(day, widx(day)));
      acc += v; const u = Math.floor(acc + 1e-9); acc -= u;
      if (!u) return;
      const wk = weekOf(day);
      const c = rows[asin].weeks[wk] || (rows[asin].weeks[wk] = { u: 0 });
      if (wk <= L) c.u += u;                                   // the weekly store: finished weeks
      if (day >= D_FROM) d[asin][day] = [u, u * 20];
    });
    if (st !== undefined && st !== null) { stock[b].m[asin + '-SKU'] = st; stock[b].skuOf[asin] = [asin + '-SKU']; }
  }
  const ly = (sp, cpc) => {
    const out = { SP: {}, CPC: {} };
    dayList('2025-04-01', '2026-07-31').forEach(day => { out.SP[day] = [0, sp(day), 0]; out.CPC[day] = [0, cpc(day), 0]; });
    return out;
  };
  return { add, rows, d, brand, stock, parent, names, info, ly,
    input: (b, extra) => Object.assign({ weekly: { rows, at: '2026-11-25 05:42' }, days: { d, brand, from: D_FROM, upTo: LAST, at: '2026-11-25 05:42' }, today: TODAY, brand: b,
      parentOf: a => parent[a] || a, nameOf: p => names[p] || '', stock, age: null, kidInfo: (a, bb) => info[bb + '|' + a] || null,
      lyDaily: ly(day => (day >= '2025-12-01' && day <= '2025-12-24' ? 2500 : 1000), () => 1000), settings: {}, now: Date.parse(TODAY + 'T12:00:00Z') }, extra || {}) };
}
// a deterministic wobble per product (±amp), the same every run
const wob = (seed, amp) => (day, i) => 1 + amp * Math.sin(seed * 12.9898 + i * 78.233 + (seed % 7));
const W = world();
// STEADY (CPC): 10 a day, 26 weeks, three stock levels → 🔴 / 🟡 / 🟢 against the 60-day lead time
W.add('C1', 'CPC', 'PC1', () => 10, 300, { name: 'Steady Red Napkin' });
W.add('C2', 'CPC', 'PC2', () => 10, 800, { name: 'Steady Amber Napkin' });
W.add('C3', 'CPC', 'PC3', () => 10, 3000, { name: 'Steady Green Napkin' });
// STOCK-OUTS (CPC): 10 a day; weeks 8–10 out (the weekly store: 0); 9 zero days 20–28 Oct (the daily cache)
W.add('S1', 'CPC', 'PS1', (day, i) => ((i >= 8 && i <= 10) || (day >= '2026-10-20' && day <= '2026-10-28') ? 0 : 10), 2000, { name: 'Stockout Placemat' });
// NOISY (CPC): the same 10 a day on average, every week ×0.3–1.7 → a wider range than STEADY
const noisy = [1.6, 1.5, 1.4, 0.4, 0.3, 0.5, 1.7, 1.3, 0.4, 0.5, 1.6, 1.2, 0.3, 0.6, 1.5, 1.4, 0.4, 0.3, 1.6, 1.5, 0.5, 0.4, 1.7, 1.2, 0.35, 0.5, 1.5];
W.add('N1', 'CPC', 'PN1', (day, i) => 10 * noisy[i], 3000, { name: 'Noisy Runner' });
// DRIFTING (CPC): a month at 16 a day, a month at 5 — the 30-day total itself is hard to call → not High
W.add('D1', 'CPC', 'PD1', (day, i) => (Math.floor(i / 4) % 2 ? 5 : 16), 3000, { name: 'Drifting Throw' });
// NO STOCK DATA (CPC): sells, not in the stock document
W.add('Q1', 'CPC', 'PQ1', () => 8, null, { name: 'Unknown Stock Coaster' });
// SEASONAL (Ridhi): 10 a day; Ridhi's last December ×2.5 → lifted, capped at 2×
W.add('R1', 'SP', 'PR1', () => 10, 5000, { name: 'Ridhi Block Print Pillow Cover' });
// NEW (Ridhi): first sale 5 weeks ago (week 21) → Not enough history
W.add('R2', 'SP', 'PR2', (day, i) => (i >= 21 ? 12 : 0), 400, { name: 'New Table Runner' });
// FAMILY (Ridhi): K1 runs out soon, K2 plenty, K3 too few sales of its own (2 a week) — the family wears K1's 🔴
W.add('K1', 'SP', 'PK', () => 10, 100, { name: 'Whimsical Corner Pillow Insert' });
W.add('K2', 'SP', 'PK', () => 5, 4000);
W.add('K3', 'SP', 'PK', () => 0.3, 500);
// ⛔ OUT OF STOCK (Ridhi): 10 a day until 17 Nov, nothing since, stock 0
W.add('O1', 'SP', 'PO1', day => (day > '2026-11-17' ? 0 : 10), 0, { name: 'Sold Out Quilt' });
// NOT SELLING (Ridhi): stock 50, 1 unit in the last 8 weeks
W.add('Z1', 'SP', 'PZ1', (day, i) => (i < 16 ? 4 : day === '2026-11-02' ? 1 : 0), 50, { name: 'Old Tablecloth' });
// INACTIVE (Ridhi): stock 0, last sale 20 weeks ago
W.add('I1', 'SP', 'PI1', (day, i) => (i < 6 ? 5 : 0), 0, { name: 'Gone Apron' });
// SLOW (Ridhi): 1 a week for 26 weeks, stock 30 → too few sales to forecast
W.add('W1', 'SP', 'PW1', () => 1 / 7, 30, { name: 'Slow Bag' });
// SPIKE (CPC): 70 a week with one 400 week (a deal) → that week counts as 2× the usual
W.add('P1', 'CPC', 'PP1', (day, i) => (i === 24 ? 400 / 7 : 10), 3000, { name: 'Spike Runner' });
// TREND (CPC): +10 % a week for the last 10 weeks → the trend is capped and damped
W.add('T1', 'CPC', 'PT1', (day, i) => (i < 16 ? 10 : 10 * Math.pow(1.1, i - 15)), 6000, { name: 'Growing Mat' });
// RED (Ridhi): one size, 200 units at 10 a day → the family itself is 🔴
W.add('F1', 'SP', 'PF', () => 10, 200, { name: 'Faded Red Runner' });
// BIG FAMILY (Ridhi): 7 sizes at 5 a day — four with 2,000 each, two at 0 (the stock data says 0), one missing from the stock data
['B1', 'B2', 'B3', 'B4'].forEach(a => W.add(a, 'SP', 'PB', () => 5, 2000, { name: 'Big Block Print Tablecloth' }));
W.add('B5', 'SP', 'PB', () => 5, 0); W.add('B6', 'SP', 'PB', () => 5, 0); W.add('B7', 'SP', 'PB', () => 5, null);

const rCPC = X.foCompute(W.input('CPC')), rSP = X.foCompute(W.input('SP')), rALL = X.foCompute(W.input('ALL'));
const fam = (r, p) => r.fams.find(f => f.parent === p);
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log('== 1. steady: a sensible range ==');
{
  const f = fam(rCPC, 'PC1');
  ok('the engine ran', rCPC.ok && rSP.ok && rALL.ok, rCPC.why || rSP.why);
  ok('the last finished week is 15–21 Nov, 26 weeks from 24 May', rCPC.L === L && rCPC.weeks.length === 26 && rCPC.weeks[0] === W0, rCPC.L + ' ' + rCPC.weeks[0]);
  ok('usual week = 70 (10 a day)', near(f.m.level, 70, 0.01), f.m.level);
  ok('next 30 days ≈ 300, 7 days ≈ 70, 90 days ≈ 900 (no season: CPC last year is flat)', near(f.r[30].mid, 300, 0.02) && near(f.r[7].mid, 70, 0.02) && near(f.r[90].mid, 900, 0.03), [f.r[7].mid, f.r[30].mid, f.r[90].mid].join(' '));
  ok('the range holds the likely and is never under ±10 %', f.r[30].lo < f.r[30].mid && f.r[30].hi > f.r[30].mid && f.e[30] >= 0.1 - 1e-9 && f.e[30] <= 0.2, f.e[30]);
  ok('a perfect blind test → High confidence', f.conf === 'High' && f.bt && f.bt.n === 8 && f.bt.e30 < 0.02, f.conf + ' ' + (f.bt && f.bt.e30));
  ok('no trend on a flat product', Math.abs(f.m.g) < 1e-9);
}

console.log('== 2. stock-out weeks are skipped, never low demand ==');
{
  const f = fam(rCPC, 'PS1'), k = f.kids[0];
  ok('the weekly store\'s out weeks (8–10) are skipped as stock-out', [8, 9, 10].every(i => k.s[i].skip === 'oos'), k.s.slice(7, 12).map(x => x.u + ':' + x.skip).join(' '));
  const wkA = rCPC.weeks.indexOf('2026-10-18'), wkB = rCPC.weeks.indexOf('2026-10-25');
  ok('a daily week with 5 zero days of 7 → skipped; with 4 of 7 → its 3 live days give 70 a week', k.s[wkA].skip === 'oos' && !k.s[wkB].skip && near(k.s[wkB].r, 70, 0.02),
    `${k.s[wkA].u}/${k.s[wkA].dead}/${k.s[wkA].skip} ${k.s[wkB].u}/${k.s[wkB].dead}/${k.s[wkB].r}`);
  ok('…so the usual week stays 70 (a plain average would say less)', near(f.m.level, 70, 0.02), f.m.level);
  ok('the drawer counts the skipped weeks', f.skippedWeeks >= 2, f.skippedWeeks);
  const W2 = world();
  W2.add('M1', 'CPC', 'PM1', () => 10, 2000); W2.add('M2', 'CPC', 'PM2', () => 6, 2000);
  Object.values(W2.rows).forEach(r => { delete r.weeks[alAdd(W0, 21)]; });   // nobody in the brand has week 3: a missing week
  const r = X.foCompute(W2.input('CPC'));
  ok('a week the whole brand has no figure for is MISSING (not zero)', fam(r, 'PM1').kids[0].s[3].skip === 'missing' && near(fam(r, 'PM1').m.level, 70, 0.01));
}

console.log('== 3. the season: lifted, capped, only with enough sales, only when not worse ==');
{
  const f = fam(rSP, 'PR1');
  const capped = f.m.out.find(o => o.raw > 2);
  ok('Ridhi\'s last December (×2.5) is used, capped at 2×', f.m.seasonOk && capped && capped.f === 2, f.m.out.slice(0, 6).map(o => o.raw && o.raw.toFixed(2)).join(' '));
  ok('next 30 days lifted above the plain 300 but at most 2×', f.r[30].mid > 360 && f.r[30].mid <= 600, f.r[30].mid);
  ok('the blind test (Sep–Nov, flat last year) was not worse → used', f.fit.useSeason && f.fit.tried);
  ok('nothing is ever under ½×', f.m.out.every(o => o.f >= 0.5 && o.f <= 2));
  const little = X.foCompute(W.input('SP', { lyDaily: W.ly(() => 5, () => 5) }));
  ok('last year with too few sales (35 a week) → no season', !fam(little, 'PR1').m.seasonOk && near(fam(little, 'PR1').r[30].mid, 300, 0.02), fam(little, 'PR1').r[30].mid);
  const none = X.foCompute(W.input('SP', { lyDaily: null }));
  ok('no last year at all → no season, still a forecast', fam(none, 'PR1').fc && !fam(none, 'PR1').m.seasonOk && none.seasonHeld === false);
  // a last year that would have made the blind test worse (its Sep–Nov swing ×2 / ×0.5 every other week) is not used
  const bad = X.foCompute(W.input('CPC', { lyDaily: W.ly(() => 1000, day => (Math.floor((Date.parse(day) - Date.parse('2025-09-14')) / 864e5 / 21) % 2 ? 300 : 2000)) }));
  ok('a season that makes the product\'s own blind test worse is not used', !fam(bad, 'PC1').fit.useSeason && fam(bad, 'PC1').fit.tried && near(fam(bad, 'PC1').r[30].mid, 300, 0.02),
    JSON.stringify({ on: fam(bad, 'PC1').fit.btOn && fam(bad, 'PC1').fit.btOn.e30, off: fam(bad, 'PC1').fit.btOff && fam(bad, 'PC1').fit.btOff.e30 }));
}

console.log('== 4. the gate: new product → Not enough history; too few sales ==');
{
  const f = fam(rSP, 'PR2');
  ok('first sale 5 weeks ago → Not enough history (5 weeks)', !f.fc && f.status === 'nohist' && f.hist === 5 && /Not enough history \(5 weeks\)/.test(X.foTableHtml(rSP, X.foShownFams(rSP))), f.status + ' ' + f.hist);
  const w = fam(rSP, 'PW1');
  ok('1 unit a week for 26 weeks → "Too few sales to forecast", grey ⚪', !w.fc && w.status === 'nohist' && /Too few sales to forecast \(1\/week\)/.test(X.foTableHtml(rSP, X.foShownFams(rSP))), w.status);
}

console.log('== 5. no stock data → never guessed ==');
{
  const f = fam(rCPC, 'PQ1');
  ok('not in the stock document → stock null, status "No stock data", the forecast still shown', f.stock === null && f.status === 'nostock' && f.fc && f.kids[0].cover === null, f.status);
  const html = X.foTableHtml(rCPC, X.foShownFams(rCPC));
  ok('the row says "No stock data" in the Stock column', /data-fo-row="CPC\|PQ1"[\s\S]*?No stock data/.test(html));
  const age = X.foCompute(W.input('CPC', { age: { CPC: { rows: [{ sku: 'Q1-SKU', asin: 'Q1', available: 120 }], at: '2026-11-23T00:00:00Z' } } }));
  ok('…the Inventory Age snapshot fills it when it has the SKU', fam(age, 'PQ1').stock === 120 && fam(age, 'PQ1').kids[0].stockSrc === 'Inventory Age' && fam(age, 'PQ1').status !== 'nostock');
}

console.log('== 6. reorder now / soon / OK by the lead time, at the HIGH end ==');
{
  const red = fam(rCPC, 'PC1'), amber = fam(rCPC, 'PC2'), green = fam(rCPC, 'PC3');
  ok('300 units at 10 a day → 🔴 (stock lasts 27–29 days, under 60)', red.status === 'red' && red.cover.high === 27 && red.cover.likely === 29, JSON.stringify(red.cover));
  ok('the HIGH-demand cover is the shorter one, and decides', red.cover.high < red.cover.likely && amber.cover.high < amber.cover.likely);
  ok('800 units → 🟡 (between 60 and 90 days at the high end)', amber.status === 'amber' && amber.cover.high >= 60 && amber.cover.high < 90, JSON.stringify(amber.cover));
  ok('3,000 units → 🟢 (beyond the half year: "180+")', green.status === 'green' && green.cover.high === null, JSON.stringify(green.cover));
  ok('runs out ~22 Dec at the high end (27 days from today)', red.cover.outHigh === '2026-12-22', red.cover.outHigh);
  const short = X.foCompute(W.input('CPC', { settings: { leadCPC: 20 } }));
  ok('lead time 20 days (⚙ Settings) → the same stock is 🟡, not 🔴', fam(short, 'PC1').status === 'amber' && fam(short, 'PC1').lead === 20);
  const far = X.foCompute(W.input('CPC', { settings: { leadCPC: 20, soon: 0 } }));
  ok('…and with no "soon" window it is 🟢', fam(far, 'PC1').status === 'green');
  const o = fam(rSP, 'PO1');
  ok('stock 0 and sold in the last 8 weeks → ⛔ Out of stock, losing this week\'s forecast (usual 70 × Ridhi\'s season)', o.status === 'oos' && near(o.kids[0].fit.m.level, 70, 0.02) && near(o.weekLoss, o.kids[0].out[0].u, 1e-9) && o.weekLoss >= 70, o.status + ' ' + o.weekLoss);
  ok('its last zero days (stock 0 now) are stock-out days, not demand', o.kids[0].s[25].dead === 4 && near(o.kids[0].s[25].r, 70, 0.02), o.kids[0].s[25].dead + ' ' + o.kids[0].s[25].r);
  ok('⛔ sorts above 🔴', X.foShownFams(rSP).length && (() => { X.FO.sort = { k: 'status', dir: 1 }; const html = X.foTableHtml(rSP, X.foShownFams(rSP)); return html.indexOf('SP|PO1') < html.indexOf('SP|PK'); })());
  ok('stock > 0, 1 unit in 8 weeks → Not selling', fam(rSP, 'PZ1').status === 'notsell');
  const i = fam(rSP, 'PI1');
  ok('stock 0, no sale for 20 weeks → inactive, hidden by default', i.status === 'inactive' && !i.active && !X.foShownFams(rSP).includes(i));
  ok('"Hidden: 1 inactive" — shown on request', /Hidden: 1 inactive/.test(X.foTableHtml(rSP, X.foShownFams(rSP))) && (X.FO.inactive = true, X.foShownFams(rSP).includes(i)));
  X.FO.inactive = false;
}

console.log('== 7. the blind test sets the range width ==');
{
  const s = fam(rCPC, 'PC1'), n = fam(rCPC, 'PN1');
  ok('the noisy product\'s weekly error is bigger', n.bt.e7 > 0.3 && n.bt.e7 > s.bt.e7 * 5, n.bt.e7);
  ok('…so its ranges are wider: 7 days and 30 days', n.e[7] > s.e[7] && (n.r[30].hi - n.r[30].lo) / n.r[30].mid > (s.r[30].hi - s.r[30].lo) / s.r[30].mid, `${n.e[30]} vs ${s.e[30]}`);
  ok('…and its 30-day error is bigger too', n.bt.e30 > s.bt.e30 + 0.1, n.bt.e30);
  const dr = fam(rCPC, 'PD1');
  ok('a product whose level shifts month to month → its 30-day error decides: not High', dr.bt.e30 > 0.2 && dr.conf !== 'High' && dr.e[30] > n.e[30], dr.conf + ' ' + dr.bt.e30);
  ok('the blind test forecasts weeks it never saw: 8 weeks from 27 Sep', n.bt.n === 8 && n.bt.from === '2026-09-27' && n.bt.rows.length === 8, n.bt.from);
  const p = fam(rCPC, 'PP1');
  ok('a one-off 400 week counts as 2× the usual (140), not 400', p.m.level < 70 * 1.25 && p.m.level > 70, p.m.level);
  const t = fam(rCPC, 'PT1');
  ok('a fast-growing product: the trend is capped at +4 %/week (halved, damped)', t.m.g <= 0.04 + 1e-9 && t.m.gRaw > 0.08, t.m.g + ' raw ' + t.m.gRaw);
  ok('…and the 90 days never run away (≤ the usual × 90/7 × 1.17)', t.r[90].mid <= t.m.level * 90 / 7 * 1.17, t.r[90].mid + ' vs ' + t.m.level);
}

console.log('== 8. families: the Sales Alerts grouping, children add up, the worst child decides ==');
{
  const f = fam(rSP, 'PK');
  ok('one family, three children (the parent ASIN groups them, as in Sales Alerts)', f.kids.length === 3 && f.key === 'SP|PK' && f.name === 'Whimsical Corner Pillow Insert');
  const sum = f.kids.reduce((t, k) => t + k.r[30].mid, 0);
  ok('the children\'s next 30 days add up to the family\'s', near(sum, f.r[30].mid, 0.005), sum + ' vs ' + f.r[30].mid);
  const k1 = f.kids.find(k => k.asin === 'K1'), k3 = f.kids.find(k => k.asin === 'K3');
  ok('K1 (100 units, 10 a day) is 🔴 itself — the FAMILY is judged on its total (4,600 units) → 🟢, with a "🔴 1 size needs reorder" badge', k1.status === 'red' && f.status === 'green' && f.cover !== k1.cover && f.redKids.length === 1
    && /data-fo-sizes="SP\|PK\|red"[^>]*>🔴 1 size needs reorder</.test(X.foTableHtml(rSP, X.foShownFams(rSP))), f.status);
  ok('the family\'s stock is all its SKUs', f.stock === 4600);
  ok('K3 (2 a week) has no blind test of its own → the family\'s error, "Low" confidence, numbers still shown', k3.r && k3.fromFam && k3.conf === 'Low' && !k3.fit.ok);
  ok('the same keys as alGroupAdd gives (one shared grouping)', /alGroupAdd\(G, a, b, o\)/.test(FO_SRC) && /alGroupAdd\(G, asin, b, o\)\.kids\[asin\]/.test(AL_SRC));
  const al = X.alCompute({ days: W.input('SP').days, today: TODAY, brand: 'SP', parentOf: W.input('SP').parentOf, nameOf: W.input('SP').nameOf, settings: {}, marks: {} });
  const alKeys = new Set((al.rows || []).map(r => 'SP|' + r.parent));
  ok('…the families Sales Alerts checks are families here too', alKeys.size > 0 && [...alKeys].every(k => rSP.fams.some(f2 => f2.key === k)), [...alKeys].join(' '));
}

console.log('== 9. Ridhi / CPC / Both ==');
{
  ok('Ridhi only Ridhi, CPC only CPC', rSP.fams.every(f => f.brand === 'SP') && rCPC.fams.every(f => f.brand === 'CPC'));
  ok('Both = every family of both, each once', rALL.fams.length === rSP.fams.length + rCPC.fams.length && new Set(rALL.fams.map(f => f.key)).size === rALL.fams.length);
  ok('Both uses each brand\'s own lead time', (() => { const r = X.foCompute(W.input('ALL', { settings: { leadSP: 10 } })); return fam(r, 'PC1').lead === 60 && fam(r, 'PK').lead === 10; })());
  ok('the headline = the families with a forecast, its range from the brand\'s own blind test', near(rCPC.head.mid, rCPC.fams.filter(f => f.fc && f.active).reduce((t, f) => t + f.r[30].mid, 0), 1e-9) && rCPC.head.lo < rCPC.head.mid && rCPC.head.hi > rCPC.head.mid);
  ok('the accuracy is a weighted 30-day error', rCPC.acc != null && rCPC.acc >= 0 && rCPC.acc < 1, rCPC.acc);
}

/* ---- the page ---- */
function page(opt, brand) {
  const P = load(opt);
  P.ctx.VI = { v: 1, data: { weekly: { rows: W.rows, at: '2026-11-25 05:42' }, days: { d: W.d, brand: W.brand, from: D_FROM, upTo: LAST, at: '2026-11-25 05:42' }, stock: W.stock } };
  P.ctx.sdToday = () => TODAY;
  P.ctx.wParentOf = a => W.parent[a] || a;
  P.ctx.viNameOf = p => W.names[p] || '';
  P.ctx.SD = { at: 'x', d: W.ly(day => (day >= '2025-12-01' && day <= '2025-12-24' ? 2500 : 1000), () => 1000) };
  P.ctx.sdDays = ch => P.ctx.SD.d[ch] || {};
  P.FO.data = { err: '' }; P.FO.v = 1; P.FO.brand = brand || 'SP';
  return P;
}
console.log('== 10. the page: every part there, chips filter, toggles ==');
{
  const P = page({ fx: false });
  P.foRender();
  const html = P.dom.els.foPane.innerHTML;
  ok('✨ off: the whole page is drawn, with no motion class', /class="fo"/.test(html) && !/fo-mo/.test(html) && /class="fo-bar"/.test(html) && /class="fo-hl"/.test(html) && /class="fo-chips"/.test(html) && /Act first/.test(html) && /<table class="fo-tbl">/.test(html) && /How this forecast works/.test(html) && /Accuracy last 8 weeks/.test(html));
  ok('the headline shows its final number at once (never "0" first)', /Next 30 days: <span class="fo-cu" data-to="(\d+)">~[1-9][\d,]*<\/span> units <span class="fo-hl-r">\([\d,]+–[\d,]+\)<\/span>/.test(html), (html.match(/Next 30 days:[^<]*<span[^>]*>[^<]*/) || [''])[0]);
  ok('"updated … IST · Amazon data is 1–2 days late"', /updated 25 Nov 05:42 IST · Amazon data is 1–2 days late/.test(html));
  ok('the bar: Forecast, Ridhi | CPC | Both, Stock > 0 only, search, ⚙ Settings, ⬇ CSV', /<h2 class="fo-title">Forecast<\/h2>/.test(html) && /data-fo-brand="SP"[^>]*>Ridhi/.test(html) && /data-fo-brand="ALL"[^>]*>Both/.test(html)
    && /data-fo-stock/.test(html) && /type="search"/.test(html) && /⚙ Settings/.test(html) && /⬇ CSV/.test(html));
  ok('chips with counts: ⛔ 🔴 🟡 🟢 ⚪ Not selling', ['oos', 'red', 'amber', 'green', 'nohist', 'notsell'].every(k => new RegExp(`data-fo-chip="${k}"`).test(html)) && /⛔ <\/span>|⛔<\/span>/.test(html));
  ok('Act first: ⛔ and 🔴 families, soonest first, with Runs out and the lead time', /Out of stock now/.test(html) && /Runs out ~/.test(html) && /days of stock vs 60-day lead time/.test(html) && /<svg class="fo-spark"/.test(html));
  P.FO.chip = 'red'; P.foRender();
  const h2 = P.dom.els.foPane.innerHTML, rowsOf = h => (h.match(/<tr class="fo-r is-fam [^"]*" data-fo-row="([^"]+)"/g) || []).map(s => s.match(/data-fo-row="([^"]+)"/)[1]);
  ok('the 🔴 chip filters the table to 🔴 families, and shows as selected', rowsOf(h2).length >= 1 && rowsOf(h2).every(k => P.foFind(k).x.status === 'red') && /data-fo-chip="red" aria-pressed="true"/.test(h2), rowsOf(h2).join(' '));
  P.FO.chip = ''; P.FO.stockOnly = true; P.foRender();
  const h3 = P.dom.els.foPane.innerHTML;
  ok('Stock > 0 only hides the out-of-stock family', !rowsOf(h3).includes('SP|PO1') && rowsOf(h3).includes('SP|PK'));
  P.FO.stockOnly = false; P.FO.q = 'whimsical'; P.foRender();
  ok('search finds the family by name', rowsOf(P.dom.els.foPane.innerHTML).join() === 'SP|PK');
  P.FO.q = 'K3-SKU'; P.foRender();
  ok('…and by SKU', rowsOf(P.dom.els.foPane.innerHTML).join() === 'SP|PK');
  P.FO.q = ''; P.FO.open['SP|PK'] = true; P.foRender();
  const h4 = P.dom.els.foPane.innerHTML;
  ok('▸ opens the family into its SKUs (same columns, indented)', (h4.match(/class="fo-r is-kid/g) || []).length === 3 && /aria-expanded="true"/.test(h4));
  ok('low confidence → striped range bar and the "Low confidence" pill', /fo-rb is-low/.test(h4) && /Low confidence/.test(h4));
  ok('sortable headings say how they are sorted', /aria-sort="ascending"><button type="button" data-fo-sort="status">Status ↑/.test(h4));
  P.FO.sort = { k: 'stock', dir: 1 }; P.foRender();
  const order = rowsOf(P.dom.els.foPane.innerHTML).map(k => P.foFind(k).x.stock);
  ok('sorting by Stock: biggest first, no stock data last', order.filter(v => v != null).every((v, i, a) => !i || a[i - 1] >= v), order.join(' '));
  P.FO.sort = { k: 'status', dir: 1 };
}
console.log('== 11. motion: ✨ on adds it once; reduced motion never ==');
{
  const P = page({ fx: true });
  P.foRender();
  ok('✨ on: the page rises once (class fo-mo)', /class="fo fo-mo"/.test(P.dom.els.foPane.innerHTML));
  P.foRender();
  ok('…only the first time this data is drawn (a chip click does not replay it)', !/fo-mo/.test(P.dom.els.foPane.innerHTML));
  const R = page({ fx: true, reduce: true });
  R.foRender();
  ok('reduced motion: no motion class, everything shown', !/fo-mo/.test(R.dom.els.foPane.innerHTML) && /<table class="fo-tbl">/.test(R.dom.els.foPane.innerHTML));
  const css = SRC('styles.css');
  ok('the CSS stops every animation under reduced motion', /@media \(prefers-reduced-motion: reduce\) \{ #paneFcast \.fo-mo \*, #paneFcast \.fo-dr\.fo-mo \{ animation: none !important; \} \}/.test(css));
  const S = page({ fx: false });
  S.FO.data = null; S.FO.busy = Promise.resolve();
  S.foRender();
  ok('while loading: skeletons, never an empty page or a "0"', /fo-sk-hl/.test(S.dom.els.foPane.innerHTML) && !/Next 30 days/.test(S.dom.els.foPane.innerHTML) && /aria-busy="true"/.test(S.dom.els.foPane.innerHTML));
  S.FO.busy = null; S.FO.data = { err: 'Backend not configured' }; S.ctx.VI = { v: 1, data: null }; S.foRender();
  ok('a load that failed says so in plain words', /could not be read/.test(S.dom.els.foPane.innerHTML) && /Backend not configured/.test(S.dom.els.foPane.innerHTML));
}
console.log('== 12. the drawer opens and closes ==');
{
  const P = page({ fx: false });
  P.foRender();
  P.foDrawerOpen('SP|PK');
  const dr = P.dom.els.foDr, bg = P.dom.els.foDrBg;
  ok('a row opens the drawer: shown, with its backdrop, as a dialog', P.FO.dr === 'SP|PK' && dr && !dr.hidden && bg && !bg.hidden && dr.attrs.role === 'dialog' && dr.attrs['aria-modal'] === 'true');
  const h = dr.innerHTML;
  ok('title, brand, status and confidence', /<h3 id="foDrTitle">Whimsical Corner Pillow Insert<\/h3>/.test(h) && /Ridhi · PK/.test(h) && /fo-sev st-green">🟢 OK</.test(h) && /confidence<\/span>/.test(h) && /🔴 1 size needs reorder/.test(h));
  ok('the chart box, the last-year toggle, the story, the tiles', /id="foChart"/.test(h) && /data-fo-ly/.test(h) && /class="fo-story">Usually sells ~/.test(h) && (h.match(/class="fo-tile"/g) || []).length === 6);
  ok('why this confidence: history, blind test, skipped weeks, season', /Why this confidence/.test(h) && /History: <b>26\+ weeks/.test(h) && /Blind test \(8 weeks from 27 Sep\)/.test(h) && /Stock-out or suppressed weeks skipped/.test(h) && /Season: used/.test(h));
  ok('its SKU list, each with its own status', (h.match(/<li><button type="button" data-fo-view="SP\|PK#K\d"/g) || []).length === 3);
  ok('the story: the season, the family total, then the size that needs reorder', /Christmas usually lifts Ridhi ~2\.0×/.test(h) && /Family has 4,600 in stock \(over half a year\)\./.test(h) && /1 size needs reorder: K1-SKU \(~\d+ (Nov|Dec)\)/.test(h), (h.match(/class="fo-story">[^<]*/) || [''])[0]);
  P.foDrawerOpen('SP|PF');
  ok('a 🔴 family: "Stock lasts A–B days (A if sales are high)" and "new stock takes 60 → reorder now"', /Stock lasts \d+–\d+ days \(\d+ if sales are high\)/.test(dr.innerHTML) && /new stock takes 60 → reorder now/.test(dr.innerHTML) && /fo-sev st-red/.test(dr.innerHTML));
  P.foDrawerOpen('SP|PK#K3');
  ok('a SKU opens its own drawer, with a way back to the family', /<h3 id="foDrTitle">K3-SKU<\/h3>/.test(dr.innerHTML) && /data-fo-view="SP\|PK"/.test(dr.innerHTML) && /the family's error is used/.test(dr.innerHTML));
  P.foDrawerClose();
  ok('closing hides it and its backdrop', dr.hidden && bg.hidden && P.FO.dr === null && dr.innerHTML === '');
  P.foDrawerOpen('SP|PR2');
  ok('a family without a forecast: no chart, the reason in plain words', !/id="foChart"/.test(dr.innerHTML) && /Not enough history \(5 weeks\)/.test(dr.innerHTML));
  P.foDrawerClose();
  ok('the drawer is closed by Esc, the backdrop and swipe (wired in the source)', /e\.key === 'Escape' && FO\.dr/.test(FO_SRC) && /data-fo-act', 'close'/.test(FO_SRC) && /dy > 90\) foDrawerClose/.test(FO_SRC));
  ok('"Open in Sales Alerts" when Sales Alerts flags the family', (() => {
    const Q = page({ fx: false }); Q.foRender();
    Q.AL.data = {}; Q.ctx.alFor = () => ({ ok: true, alerts: [{ key: 'SP|PK', head: 'sales down 30% for 6 days' }], review: [], waiting: [] });
    Q.foDrawerOpen('SP|PK'); return /Open in Sales Alerts →/.test(Q.dom.els.foDr.innerHTML) && /sales down 30% for 6 days/.test(Q.dom.els.foDr.innerHTML);
  })());
}
console.log('== 13. the CSV and forecastCheck ==');
{
  const csv = X.foCsvText(rSP).split('\r\n');
  ok('⬇ CSV: one header, a line per family and per SKU shown', /^Brand,Family,Parent ASIN,Level,SKU,ASIN,Status,Confidence,Next 7 days low/.test(csv[0]) && csv.some(l => /^Ridhi,Whimsical Corner Pillow Insert,PK,Family,/.test(l)) && csv.filter(l => /,SKU,K\d-SKU,/.test(l)).length === 3, csv[1]);
  const f = fam(rSP, 'PK');
  const t = X.foTrace(f, f, rSP);
  ok('forecastCheck\'s trace: 26 weeks with what was used and its weight', t.weeks.length === 26 && t.weeks.filter(w => w.baseWeight).length === 8 && t.weeks[25].baseWeight === 8 && t.weeks[18].baseWeight === 1);
  ok('…the blind test week by week, the 13 weeks ahead with their season and trend, the story', t.blindTest && t.blindTest.rows.length === 8 && t.ahead.length === 13 && t.ahead.some(a => a.season === 2) && /1 size needs reorder/.test(t.story));
  const s = fam(rCPC, 'PS1');
  const ts = X.foTrace(s, s, rCPC);
  ok('…and says which weeks were skipped and why', ts.weeks.filter(w => w.skipped === 'stock-out / suppressed').length >= 3 && ts.weeks.some(w => /stock-out days taken out/.test(w.skipped)), ts.weeks.map(w => w.skipped).filter(Boolean).join(' | '));
  const tk = X.foTrace(s.kids[0], s, rCPC);
  ok('…the SKU trace says how many dead days came out of a week', tk.weeks.some(w => /4 dead day\(s\) taken out/.test(w.skipped)), tk.weeks.map(w => w.skipped).filter(Boolean).join(' | '));
}
console.log('== 14. the wiring: tab, menu, pane, ORDER, styles only for this page ==');
{
  const nav = SRC('app/core/nav.js'), html = SRC('index.html'), order = SRC('app/ORDER'), css = SRC('styles.css');
  ok('TABS has fcast after salert, its title, it comes with the Sales Dashboard, showTab opens it', /'salert', 'fcast', 'shop'/.test(nav) && /fcast: 'Forecast'/.test(nav) && /TAB_INHERIT = \{[^}]*fcast: 'sales'/.test(nav) && /if \(which === 'fcast'\) ensureFcast\(\);/.test(nav));
  ok('the Sales menu: "Forecast" in Check & alerts, after Sales Alerts', /<div class="navcol-h num">Check &amp; alerts<\/div>\s*<button id="tabNcheck" class="nav">Numbers Check<\/button>\s*<button id="tabSalert" class="nav">Sales Alerts<\/button>\s*<button id="tabFcast" class="nav">Forecast<\/button><\/div>/.test(html)
    && /data-tabs="sales,profit,sa,plaudit,ncheck,salert,fcast,/.test(html));
  ok('its pane, and not on the Dashboard', /<div id="paneFcast" class="hide"><div id="foPane"><\/div><\/div>/.test(html) && !/forecast|foDash|fcast/i.test(SRC('app/core/dashboard.js')));
  ok('ORDER: forecast.js right after sales-alerts.js (it uses its helpers)', /sales\/sales-alerts\.js\r?\nsales\/forecast\.js\r?\n/.test(order));
  ok('the menu icon', /#tabFcast\{--ic:url\(/.test(css));
  const a = css.indexOf('/* ================= FORECAST'), b = css.indexOf('#paneFcast .fo-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }', a);
  const block = css.slice(a, b);
  const split = sel => { const o = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const sels = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|[{}])\s*([^{}@]+?)\s*\{/g)].map(m => m[2].trim()).filter(s => s && !/^(from|to|\d)/.test(s));
  ok('every Forecast style is under #paneFcast (or the page behind it while it is open)', a > 0 && sels.length > 80 && sels.every(sel => split(sel).every(p => /#paneFcast|body:has\(#paneFcast:not\(\.hide\)\)/.test(p))), sels.filter(sel => !split(sel).every(p => /#paneFcast|body:has\(#paneFcast/.test(p))).slice(0, 3).join(' | '));
  ok('light and dark tokens, the dark ones twice (the 🌙 switch and the system)', /:root\[data-theme="dark"\] #paneFcast \{/.test(block) && /:root:not\(\[data-theme="light"\]\) #paneFcast \{/.test(block));
  ok('no library on the page itself (ECharts loads only when the drawer opens)', !/<script[^>]+echarts/i.test(html) && /sdcLoadCharts\(\)/.test(FO_SRC));
  ok('the engine never calls Amazon or writes a number: only the settings document', !/baCall\(|spCall|adsPost|saveStockDoc|saveHealthCache/.test(FO_SRC) && (FO_SRC.match(/setDoc\(/g) || []).length === 1 && /FO_DOC = \['history', 'forecast'\]/.test(FO_SRC));
  ok('docs/sales-metrics.md has the forecast rules', ['### Forecast — weeks used', '### Forecast — base', '### Forecast — season', '### Forecast — trend', '### Forecast — range and confidence', '### Days of cover and runs out', '### Reorder status'].every(s => fs.readFileSync(path.join(__dirname, '..', 'docs', 'sales-metrics.md'), 'utf8').includes(s)));
}

console.log('== 15. stock on the way (inbound) ==');
{
  // the stock data with inbound: stock/{brand}.in = { sku: [working, shipped, receiving] }; a SKU not listed has none
  const withIn = (b, inMap) => { const st = JSON.parse(JSON.stringify(W.stock)); st[b].in = inMap; return st; };
  const rIn = X.foCompute(W.input('CPC', { stock: withIn('CPC', { 'C1-SKU': [1000, 1500, 500] }) }));
  const red = fam(rCPC, 'PC1'), now = fam(rIn, 'PC1');
  ok('300 available alone is 🔴; + 3,000 on the way → 🟢', red.status === 'red' && now.status === 'green' && now.inbound === 3000 && now.kids[0].supply === 3300, red.status + ' → ' + now.status);
  ok('the cover counts available + on the way', red.cover.high === 27 && (now.cover.high === null || now.cover.high > 180), JSON.stringify(now.cover));
  const rSome = X.foCompute(W.input('CPC', { stock: withIn('CPC', { 'C1-SKU': 450 }) }));
  ok('+ 450 on the way (a total, no split) → 750 → 🟡, like 800 available', fam(rSome, 'PC1').status === 'amber' && fam(rSome, 'PC1').inbound === 450 && fam(rSome, 'PC1').inbParts === null);
  ok('a SKU the inbound list does not name has nothing on the way (known 0, not unknown)', fam(rIn, 'PC2').inbound === 0 && fam(rIn, 'PC2').status === 'amber');
  const html = X.foTableHtml(rIn, X.foShownFams(rIn));
  ok('table: "300 + 3,000 on the way", the tooltip splits working / shipped / receiving', /data-fo-row="CPC\|PC1"[\s\S]*?title="300 available at Amazon \+ 3,000 on the way \(working 1,000 · shipped 1,500 · receiving 500\)\. Days of cover count both[^"]*">300<small class="fo-inb">\+ 3,000 on the way<\/small>/.test(html));
  ok('table: "nothing on the way" when the list has none for it', /data-fo-row="CPC\|PC2"[\s\S]*?<small class="fo-inb">nothing on the way<\/small>/.test(html));
  const plain = X.foTableHtml(rCPC, X.foShownFams(rCPC));
  ok('no inbound in the stock data → "Inbound: unknown", never guessed (and the cover is the available units only)', fam(rCPC, 'PC1').inbound === null && /data-fo-row="CPC\|PC1"[\s\S]*?<small class="fo-inb is-unknown">Inbound: unknown<\/small>/.test(plain)
    && /Inbound is not in the stock data Sellora reads/.test(plain));
  const age = X.foCompute(W.input('CPC', { age: { CPC: { rows: [{ sku: 'Q1-SKU', asin: 'Q1', available: 120 }], at: '2026-11-23T00:00:00Z' } } }));
  ok('stock from the Inventory Age snapshot: inbound unknown too', fam(age, 'PQ1').stock === 120 && fam(age, 'PQ1').inbound === null);
  // ⛔ with units on the way: still first, amber, "Out of stock — 500 on the way"
  const rO = X.foCompute(W.input('SP', { stock: withIn('SP', { 'O1-SKU': [0, 500, 0] }) }));
  const o = fam(rO, 'PO1');
  ok('⛔ stock 0 + 500 on the way → "Out of stock — 500 on the way"', o.status === 'oosin' && o.kids[0].status === 'oosin' && /Out of stock — 500 on the way/.test(X.foTableHtml(rO, X.foShownFams(rO))));
  X.FO.sort = { k: 'status', dir: 1 };
  const order = (h => (h.match(/<tr class="fo-r is-fam [^"]*" data-fo-row="([^"]+)"/g) || []).map(t => t.match(/data-fo-row="([^"]+)"/)[1]))(X.foTableHtml(rO, X.foShownFams(rO)));
  ok('…still on top: above 🔴', order.indexOf('SP|PO1') >= 0 && order.indexOf('SP|PO1') < order.indexOf('SP|PK'), order.join(' '));
  ok('…amber, not red (its own status class, amber in the CSS)', /<tr class="fo-r is-fam st-oosin/.test(X.foTableHtml(rO, X.foShownFams(rO))) && /#paneFcast \.st-amber, #paneFcast \.st-oosin \{ --st: var\(--fo-amber\)/.test(SRC('styles.css')));
  ok('…counted in the ⛔ chip, and the chip filter keeps it', /data-fo-chip="oos"[^>]*>[\s\S]*?<b class="num">1<\/b>/.test(X.foChipsHtml(rO, X.foShownFams(rO))) && (X.FO.chip = 'oos', /SP\|PO1/.test(X.foTableHtml(rO, X.foShownFams(rO)))));
  X.FO.chip = '';
  ok('…Act first: "Out of stock — 500 on the way", losing sales until it arrives', /Out of stock<\/div><p class="fo-card-s"><b>500 on the way<\/b> · /.test(X.foActHtml(rO, X.foShownFams(rO))) && /until it arrives/.test(X.foActHtml(rO, X.foShownFams(rO))));
  // the drawer
  const P = page({ fx: false });
  P.ctx.VI.data.stock = withIn('CPC', { 'C1-SKU': [1000, 1500, 500] }); P.ctx.VI.v = 2; P.FO.brand = 'CPC';
  P.foRender(); P.foDrawerOpen('CPC|PC1');
  const d = P.dom.els.foDr.innerHTML;
  ok('drawer: Stock tile "300 + 3,000", "Stock 300 + 3,000 on the way" with the split', /<span>Stock<\/span><b class="num">300 \+ 3,000<\/b><small>on the way · /.test(d) && /Stock 300 \+ 3,000 on the way — 300 available at Amazon \+ 3,000 on the way \(working 1,000 · shipped 1,500 · receiving 500\)/.test(d));
  ok('drawer story counts it', /Stock \(300 \+ 3,000 on the way\) lasts|lasts beyond half a year/.test(d));
  P.ctx.VI.data.stock = W.stock; P.ctx.VI.v = 3; P.foRender(); P.foDrawerOpen('CPC|PC1');
  ok('drawer without inbound data: "Inbound: unknown"', /Inbound: unknown · all SKUs/.test(P.dom.els.foDr.innerHTML) && /<p class="fo-note fo-inb-n is-unknown">Inbound: unknown — /.test(P.dom.els.foDr.innerHTML));
  ok('CSV: on the way, its split, or "unknown"', /,Stock,On the way,On the way: working \/ shipped \/ receiving,/.test(X.foCsvText(rIn).split('\r\n')[0]) && X.foCsvText(rIn).split('\r\n').some(l => /,300,3000,1000 \/ 1500 \/ 500,/.test(l)) && X.foCsvText(rCPC).split('\r\n').some(l => /,300,unknown,,/.test(l)));
  ok('forecastCheck shows it', X.foTrace(now, now, rIn).onTheWay === 3000 && X.foTrace(now, now, rIn).onTheWaySplit.shipped === 1500 && X.foTrace(red, red, rCPC).onTheWay === 'unknown');
  ok('viLoad keeps the stock document\'s inbound (read only)', /data\.stock\[b\] = \{ m: s\.m \|\| \{\}, in: s\.in && typeof s\.in === 'object' \? s\.in : null,/.test(SRC('app/sales/sales-insight.js')));
}

console.log('== 16. the family total, sizes out, no stock data, the "on the way" note ==');
{
  const b = fam(rSP, 'PB');
  const by = a => b.kids.find(k => k.asin === a);
  ok('big family, 2 sizes at 0: the family status comes from its total (8,000 units), not from the sizes at 0', b.status === 'green' && b.stock === 8000 && b.cover && (b.cover.high === null || b.cover.high >= 90), b.status + ' ' + JSON.stringify(b.cover));
  ok('…the sizes at 0 are ⛔ themselves', by('B5').status === 'oos' && by('B6').status === 'oos');
  const html = X.foTableHtml(rSP, X.foShownFams(rSP));
  ok('…badge "⛔ 2 of 7 sizes out of stock", and "1 size: no stock data"', /data-fo-sizes="SP\|PB\|oos"[^>]*>⛔ 2 of 7 sizes out of stock</.test(html) && /data-fo-sizes="SP\|PB\|nostock"[^>]*>1 size: no stock data</.test(html));
  ok('a size missing from the stock data is "No stock data" — stock null, not 0, not ⛔', by('B7').stock === null && by('B7').status === 'nostock' && by('B7').stockSrc === '');
  ok('…and left out of the family cover on both sides (stock 8,000 from 6 sizes; demand of those 6)', b.supply === 8000 && near(b.outKnown[0].u, b.m.out[0].u * 6 / 7, 0.02), b.outKnown[0].u + ' vs ' + b.m.out[0].u);
  ok('the status chips count FAMILIES by family status; the sizes line counts sizes', /Families above · Sizes: ⛔ <b class="num">\d+<\/b> out · 🔴 <b class="num">\d+<\/b> reorder · <b class="num">1<\/b> no stock data/.test(X.foChipsHtml(rSP, X.foShownFams(rSP))));
  X.FO.open['SP|PB'] = true; X.FO.kidF['SP|PB'] = 'oos';
  const h2 = X.foTableHtml(rSP, X.foShownFams(rSP));
  ok('the ⛔ badge opens the family on its out-of-stock sizes only, with "Show all sizes"', (h2.match(/data-fo-row="SP\|PB#B\d"/g) || []).join() === 'data-fo-row="SP|PB#B5",data-fo-row="SP|PB#B6"' && /Showing 2 sizes out of stock of 7 · <button[^>]*data-fo-sizes="SP\|PB\|">Show all sizes/.test(h2), (h2.match(/data-fo-row="SP\|PB#B\d"/g) || []).join());
  X.FO.kidF['SP|PB'] = ''; X.FO.open = {};
  const tb = X.foTrace(b, b, rSP);
  ok('forecastCheck: every size with its stock source (FBA / missing)', tb.sizes.length === 7 && tb.sizes.find(z => z.asin === 'B7').stockSource === 'missing' && tb.sizes.find(z => z.asin === 'B1').stockSource === 'FBA' && tb.sizes.find(z => z.asin === 'B5').stock === 0 && tb.sizeBadges.out === 2);
  const ag = X.foCompute(W.input('CPC', { age: { CPC: { rows: [{ sku: 'Q1-SKU', asin: 'Q1', available: 120 }], at: '2026-11-23T00:00:00Z' } } }));
  ok('…Inventory Age when the stock came from it', X.foTrace(fam(ag, 'PQ1').kids[0], fam(ag, 'PQ1'), ag).stockSource === 'Inventory Age');
  ok('the drawer story: family total, then the sizes out with their best sellers', /Family has 8,000 in stock[^.]*\. But 2 sizes are out — best sellers among them: B\d-SKU \(~\d+\/week\), B\d-SKU \(~\d+\/week\)\. 1 size has no stock data/.test(X.foStory(b, b)), X.foStory(b, b));
  ok('no inbound anywhere → the amber note under the headline', rSP.inbUnknown === true && /<p class="fo-warn" role="note">Stock on the way isn't counted yet — check shipments in Seller Central before reordering\.<\/p>/.test(X.foHeroHtml(rSP)));
  const st = JSON.parse(JSON.stringify(W.stock)); st.SP.in = { 'K1-SKU': [0, 50, 0] };
  const rI = X.foCompute(W.input('SP', { stock: st }));
  ok('inbound data present → the note is gone', rI.inbUnknown === false && !/fo-warn/.test(X.foHeroHtml(rI)));
  ok('the page uses the full width; the table scrolls sideways with Family kept left only when it must', /#paneFcast \.fo \{ padding-bottom: 64px; min-width: 0; \}/.test(SRC('styles.css')) && /\.fo-tw\.is-scroll :is\(th, td\)\.fo-c-n \{ position: sticky; left: 32px;/.test(SRC('styles.css')) && /Scroll sideways for more columns →/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
