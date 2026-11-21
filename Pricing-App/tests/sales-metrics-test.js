/* SALES METRICS — golden tests (21 Nov 2026): every sales / ads / stock number worked out by the CURRENT code on small fixtures, the
 * places where one number is worked out twice, and the Numbers Check (src/app/sales/sales-check.js) itself.
 *   node tests/sales-metrics-test.js
 * Nothing here changes a formula: an expected value below is what the code gives TODAY (worked out by hand). A test that fails means a
 * number moved — on purpose or not — and docs/sales-metrics.md (and the Numbers Check rule book) must say so.
 * Covers:
 *   1. the backend rules (read from Pricing-API, never changed): which Orders rows count (cancelled, MCF, another marketplace, Pending,
 *      a refunded order), the US Pacific day of an order near midnight, a month boundary, orders vs lines; Shopify (voided, refunded,
 *      the store's own date)
 *   2. Sales Dashboard: Today, Yesterday, Last 7 days, MTD, YTD, LY and %Δ, Expected — month, the period and monthly tables, the Custom
 *      Range (Sales, Quantity, Order items, Avg $ / item), Seller Central's totals laid over the workbook days, the near-midnight PT day
 *   3. Dashboard = Sales Dashboard (MTD, YTD, both brands, Both ≠ All by Shopify)
 *   4. PPC & Organic: latest-week card (Ad spend, TACoS, ACoS, Organic share, Sessions, CVR), the grid metrics, Dashboard = the card
 *   5. Overview: TACOS, ACOS, Organic, Organic %, ROAS, CPC, CTR, CVR (T_ROWS)
 *   6. Profit & Margin: Fees (est.), COGS, Profit, Margin, ROI, per unit, TACoS; the partly-costed parent (as it is today)
 *   7. Inventory Age: Aged 181+ units, Storage $ — the screen's way = the Dashboard tile
 *   8. Numbers Check: every check's verdict on the fixtures; it reads only caches / Firestore, never writes, never asks Amazon
 *   9. the rule book: every metric named in docs/sales-metrics.md */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const near = (name, got, want, eps) => ok(name, typeof got === 'number' && Math.abs(got - want) <= (eps == null ? 1e-6 : eps), `got ${got}, want ${want}`);
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'src', 'app');
const API = path.join(ROOT, '..', 'Pricing-API');
const read = p => fs.readFileSync(p, 'utf8');

// A fixed clock inside a sandbox: new Date() and Date.now() read ctx.__now.
const CLOCK = `(() => { const RD = Date; class FD extends RD { constructor(...a) { if (a.length) super(...a); else super(globalThis.__now); }
  static now() { return globalThis.__now; } } globalThis.Date = FD; })();`;

/* =============================== 1. THE BACKEND RULES (Pricing-API, read only) =============================== */
// One top-level function's source out of an Apps Script file.
function gsFn(file, name) {
  const src = read(path.join(API, file));
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(name + ' not in ' + file);
  // match the braces (strings and comments skipped)
  let i = src.indexOf('{', at), depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}
// Utilities.formatDate for the zones the backend uses.
function formatDate(d, tz, fmt) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz === 'UTC' ? 'UTC' : tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
}
function backend(nowIso, sheetRows, shopOrders) {
  const ctx = vm.createContext({ __now: Date.parse(nowIso), Intl, console, encodeURIComponent, Math, Number, String, Object, JSON, isNaN });
  vm.runInContext(CLOCK, ctx);
  ctx.Utilities = { formatDate };
  ctx.Session = { getScriptTimeZone: () => 'Asia/Kolkata' };
  ctx.bookOpen_ = () => ({ getSheetByName: t => (t === 'Orders' ? {
    getLastRow: () => sheetRows.length + 1,
    getRange: (r, c, n, w) => ({ getValues: () => sheetRows.slice(r - 2, r - 2 + n).map(row => row.slice(c - 1, c - 1 + w)) }) } : null) });
  ctx.shopifyGet_ = () => ({ json: { orders: shopOrders || [] }, link: '' });
  ctx.shopifyNextPageInfo_ = () => null;
  const src = ['var ORDERS_DATA_IDS = ["book0", "book1"]; var SALES30_CHUNK = 20000; var ORDERS_PT = "America/Los_Angeles"; var ORDERS_CHANNELS = ["amazon.com"]; var INV = { pt: "America/Los_Angeles" };',
    gsFn('Code.gs', 'chanOk_'), gsFn('Research.gs', 'toMs_'), gsFn('SpApi.gs', 'num_'), gsFn('WeeklyPpc.gs', 'dailySalesChunk_'), gsFn('InvSync.gs', 'invOrdParse_'),
    gsFn('Shopify.gs', 'shopWindow_'), 'function shopDayOf_(o) { return String((o && o.created_at) || "").slice(0, 10); }', gsFn('Shopify.gs', 'shopInWindow_'),
    gsFn('Shopify.gs', 'shopifyDaily_')].join('\n');
  vm.runInContext(src, ctx);
  return ctx;
}
console.log('== 1. which orders count, and on which day (backend rules, Pricing-API — read only) ==');
{
  // [Order ID, Purchase Date/Time, Date (PT), SKU, ASIN, Units, Revenue, Order Status, Sales Channel, MCF]
  const rows = [
    ['111-1', '2026-10-31T10:00:00-07:00', '2026-10-31', 'S1', 'A1', 2, 40, 'Shipped', 'Amazon.com', 'Amazon'],     // an order of two lines
    ['111-1', '2026-10-31T10:00:00-07:00', '2026-10-31', 'S2', 'A2', 1, 20, 'Shipped', 'Amazon.com', 'Amazon'],
    ['111-2', '2026-10-31T11:00:00-07:00', '2026-10-31', 'S1', 'A1', 1, 25, 'Cancelled', 'Amazon.com', 'Amazon'],   // cancelled
    ['111-3', '2026-10-31T12:00:00-07:00', '2026-10-31', 'S1', 'A1', 1, 30, 'Shipped', 'Non-Amazon', 'MCF'],         // MCF (a Shopify parcel)
    ['111-4', '2026-10-31T13:00:00-07:00', '2026-10-31', 'S1', 'A1', 1, 500, 'Shipped', 'Amazon.com.mx', 'Amazon'],  // another marketplace (pesos)
    ['111-5', '2026-10-31T23:50:00-07:00', '2026-10-31', 'S3', 'A3', 1, 15, 'Pending', 'Amazon.com', 'Amazon'],      // 23:50 PT — Nov 1 in India
    ['111-6', '2026-11-01T00:10:00-07:00', '2026-11-01', 'S3', 'A3', 1, 18, 'Shipped', 'Amazon.com', 'Amazon'],      // after midnight PT: November
    ['111-7', '2026-10-31T14:00:00-07:00', '2026-10-31', 'S2', 'A2', 1, 22, 'Shipped', 'Amazon.com', 'Amazon'],      // refunded later
  ];
  const B = backend('2026-11-02T12:00:00Z', rows);
  const res = B.dailySalesChunk_(0, 2, 100, 400);
  eq('31 Oct: sales 40 + 20 + 15 + 22 = 97, units 5, orders 3 (a two-line order is ONE order) — cancelled, MCF and pesos left out; Pending and the refunded order IN', res.dates['2026-10-31'], [97, 5, 3]);
  eq('1 Nov: the order placed 00:10 PT starts November', res.dates['2026-11-01'], [18, 1, 1]);
  const tsv = ['amazon-order-id\tpurchase-date\tsku\tasin\tquantity\titem-price\torder-status\tsales-channel',
    '111-5\t2026-11-01T06:50:00+00:00\tS3\tA3\t1\t15.00\tPending\tAmazon.com',
    '111-8\t2026-11-01T08:10:00+00:00\tS3\tA3\t1\t15.00\tShipped\tAmazon.com',
    '111-9\t2026-11-01T06:50:00+00:00\tS3\tA3\t1\t30.00\tShipped\tNon-Amazon'].join('\n');
  const parsed = B.invOrdParse_(tsv);
  eq('an order at 06:50 UTC on 1 Nov (23:50 PT) is dated 31 Oct — the US portal day', parsed[0][2], '2026-10-31');
  eq('…08:10 UTC (01:10 PT) is 1 Nov', parsed[1][2], '2026-11-01');
  eq('a Non-Amazon sales channel is marked MCF (1)', parsed[2][9], 1);

  const shop = [
    { id: 1, created_at: '2026-10-31T21:30:00+05:30', financial_status: 'paid', line_items: [{ price: '10.00', quantity: 2 }] },
    { id: 2, created_at: '2026-10-31T22:00:00+05:30', financial_status: 'voided', line_items: [{ price: '99.00', quantity: 1 }] },
    { id: 3, created_at: '2026-10-31T23:00:00+05:30', financial_status: 'refunded', line_items: [{ price: '15.00', quantity: 1 }] },
    { id: 4, created_at: '2026-11-01T00:30:00+05:30', financial_status: 'paid', line_items: [{ price: '12.50', quantity: 1 }] },
  ];
  const S = backend('2026-11-02T12:00:00Z', [], shop).shopifyDaily_('2026-10-31', '2026-11-01');
  eq('Shopify 31 Oct: $20 + the REFUNDED $15 = $35, 3 units, 2 orders — only "voided" is left out (today\'s behaviour)', S.dates['2026-10-31'], [35, 3, 2]);
  eq('Shopify day = the store\'s own date: 00:30 store time on 1 Nov counts on 1 Nov (it was still 31 Oct in PT)', S.dates['2026-11-01'], [12.5, 1, 1]);
}

/* =============================== the app files, in a sandbox =============================== */
const FILES = ['inventory/inventory-age.js', 'sales/sales-dashboard.js', 'ads/account-trends.js', 'ads/ppc-organic.js', 'sales/profit-margin.js',
  'sales/sales-check.js', 'core/dashboard.js'];
const SRC = FILES.map(f => `/* ${f} */\n` + read(path.join(APP, f))).join('\n;\n');
function makeEl(id, vals) {
  const cls = new Set();
  const el = {
    id, value: vals[id] != null ? vals[id] : '', checked: false, innerHTML: '', textContent: '', hidden: false, title: '', dataset: {}, style: {}, disabled: false,
    options: [], listeners: {}, className: '',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], focus() {}, closest: () => null, insertAdjacentHTML() {}, appendChild() {}, scrollIntoView() {},
  };
  return el;
}
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : stub()), apply: () => stub() });
let STUBS = [];
// Load the files into a fresh sandbox at the clock given; extra = globals to provide (fixtures, spies). Missing globals become inert stubs.
function app(nowIso, extra) {
  for (let tries = 0; tries < 300; tries++) {
    const els = {};
    const vals = Object.assign({ pfWeeks: '4', pfBrand: 'ALL', pfFilter: '', pfView: 'asin', pfHave: 'all', wWeeks: '13', wBrand: 'ALL', wView: 'asin', wFilter: '', wMetric: 'sales', ageBrandView: 'ALL', ageFilter: '' }, (extra && extra.vals) || {});
    const $ = id => els[id] || (els[id] = makeEl(id, vals));
    const store = {};
    const base = {
      __now: Date.parse(nowIso), $, els, console: { log() {}, table() {}, warn() {}, error() {} }, Intl, Math, JSON, Promise, Set, Map, Number, String, Object, Array, isFinite, isNaN, parseFloat, parseInt, Symbol, Proxy, Error, RegExp,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, visibilityState: 'visible', createElement: () => makeEl('x', {}) },
      window: { addEventListener() {} }, TAB_OK: () => true, PNAME: {}, HEALTH: { SP: { rows: [] }, CPC: { rows: [] } }, H_LOADED: true,
      AUDIT_MANUAL: {}, ME: { email: 'x@example.com', admin: true, tabs: [], brands: [] },
    };
    STUBS.forEach(n => { if (!(n in base)) base[n] = stub(); });
    Object.assign(base, extra && extra.ctx);
    const ctx = vm.createContext(base);
    vm.runInContext(CLOCK, ctx);
    try {
      vm.runInContext(SRC, ctx, { filename: 'app.js' });
      ctx.run = code => vm.runInContext(code, ctx);
      return ctx;
    } catch (e) {
      const m = /^(\w+) is not defined/.exec(e.message);
      if (e instanceof ctx.ReferenceError || (m && e.name === 'ReferenceError')) { if (m && !STUBS.includes(m[1])) { STUBS.push(m[1]); continue; } }
      throw e;
    }
  }
  throw new Error('sandbox: too many missing globals');
}

/* --- the fixture: two brands + Shopify, a month boundary, last year --- */
const SDD = {
  SP: { '2025-01-10': [500, 10, 9], '2025-10-25': [100, 2, 2], '2025-10-31': [150, 3, 3], '2025-11-01': [80, 2, 2],
    '2026-01-10': [600, 12, 11], '2026-10-25': [120, 3, 3], '2026-10-30': [100, 2, 2], '2026-10-31': [200.55, 4, 3], '2026-11-01': [50, 1, 1] },
  CPC: { '2025-10-31': [40, 1, 1], '2026-10-31': [60, 2, 2], '2026-11-01': [10, 1, 1] },
  SHOP: { '2026-10-31': [30, 1, 1], '2026-11-01': [25, 1, 1] },
};
const NOW_A = '2026-11-01T18:00:00Z';   // 10:00 PT on Sun 1 Nov 2026 (23:30 in India)
const NOW_B = '2026-11-01T06:30:00Z';   // 23:30 PT on Sat 31 Oct — already 1 Nov (12:00) in India
const withSales = (C, ch) => { C.run(`SD = ${JSON.stringify({ at: '2026-11-01 05:47', d: SDD })}; SD_CH = ${JSON.stringify(ch || 'SP')};`); };
const T = (C, id) => strip(C.$(id).innerHTML || C.$(id).textContent);

console.log('== 2. Sales Dashboard: the cards, tables and range on the fixture (1 Nov, 10:00 PT) ==');
{
  const C = app(NOW_A);
  withSales(C, 'SP');
  eq('today is the US portal day 2026-11-01', C.run('sdToday()'), '2026-11-01');
  C.$('sdFrom').value = '2026-10-30'; C.$('sdTo').value = '2026-11-01';
  C.run('renderSales()');
  eq('Today = $50', T(C, 'sdToday'), '$50');
  eq('Yesterday (31 Oct, incl. the 23:50 PT order) = $201 (200.55 shown whole)', T(C, 'sdYest'), '$201');
  eq('Last 7 days (25–31 Oct) = $421', T(C, 'sd7'), '$421');
  ok('Last 7 days vs LY: 420.55 vs 250 = ▲68.2% · 25 Oct–31 Oct', /▲68\.2% vs LY · 25 Oct–31 Oct/.test(T(C, 'sd7p')), T(C, 'sd7p'));
  eq('MTD on the 1st = today only = $50', T(C, 'sdMtd'), '$50');
  eq('MTD %Δ on the 1st: no complete day either year → "—"', T(C, 'sdMtdp'), '—');
  eq('YTD = 600 + 120 + 100 + 200.55 + 50 = $1,071', T(C, 'sdYtd'), '$1,071');
  ok('YTD %Δ on complete days: 1,020.55 vs 750 = ▲36.1%', /▲36\.1% vs LY · complete days/.test(T(C, 'sdYtdp')), T(C, 'sdYtdp'));
  eq('Expected — month on the 1st: 420.55 ÷ 7 × 30 = $1,802', T(C, 'sdProj'), '$1,802');
  ok('…vs the whole of October ($420.55): ▲328.6% vs Oct', /▲328\.6% vs Oct/.test(T(C, 'sdProjp')), T(C, 'sdProjp'));
  const period = T(C, 'sdPeriodBody');
  ok('period table, Sales: 50 · 201 · 421 · LY 250 ▲68.2% · MTD 50 · LY $0 — · YTD 1,071 · LY 750', /^Sales \$50 \$201 \$421 \$250 ▲68\.2% \$50 \$0 — \$1,071 \$750 ▲42\.7%/.test(period), period);
  ok('…its YTD %Δ is ▲42.7% (YTD INCLUDING today vs LY to yesterday) while the card says ▲36.1% — documented, not fixed', /\$1,071 \$750 ▲42\.7%/.test(period));
  ok('period table, Quantity: 1 · 4 · 9 · LY 5 · MTD 1 · YTD 22 · LY 15', /Quantity 1 4 9 5 ▲80\.0% 1 0 — 22 15 ▲46\.7%/.test(period), period);
  ok('period table, Order items: 1 · 3 · 8 · LY 5 · YTD 20 · LY 14', /Order items 1 3 8 5 ▲60\.0% 1 0 — 20 14 ▲42\.9%/.test(period), period);
  const monthly = T(C, 'sdMonthlyBody');
  ok('monthly: Jan $600 vs $500 ▲20.0%', /Jan \$600 \$500 ▲20\.0%/.test(monthly), monthly);
  ok('monthly: Oct $421 vs $250 ▲68.2%', /Oct \$421 \$250 ▲68\.2%/.test(monthly), monthly);
  ok('monthly: Nov $50 vs $80 ▼37.5% (a part month against a whole one)', /Nov \$50 \$80 ▼37\.5%/.test(monthly), monthly);
  eq('Custom Range 30 Oct–1 Nov: Sales $351', T(C, 'sdrSales'), '$351');
  eq('…Quantity 7', T(C, 'sdrQty'), '7');
  eq('…Order items 6', T(C, 'sdrItems'), '6');
  eq('…Avg $ / item = 350.55 ÷ 7 UNITS = $50.08', T(C, 'sdrAvg'), '$50.08');
  C.run("SD_CH = 'ALL'"); C.run('renderSales()');
  eq('All channels MTD = Ridhi 50 + CPC 10 + Shopify 25 = $85', T(C, 'sdMtd'), '$85');
  C.run("SD_CH = 'SHOP'"); C.run('renderSales()');
  eq('Shopify Yesterday = $30', T(C, 'sdYest'), '$30');

  console.log('== 2b. Seller Central\'s own totals laid over the Ridhi / CPC days ==');
  C.run(`T_MATCH.biz = { at: '2026-11-01 04:00', d: { SP: { '2026-10-30': [110, 3, 2, 500], '2026-11-01': [0, 0, 0, 0], '2026-10-20': [0, 0, 0, 0] } } }; SD_CH = 'SP';`);
  eq('30 Oct–1 Nov = Seller Central 110 (not the workbook\'s 100) + 200.55 + 50 = 360.55; units 3 + 4 + 1', C.run("sdSum('2026-10-30', '2026-11-01')"), [360.55, 8, 6]);
  eq('a zero day inside the last 3 days is "not published yet": the workbook\'s $50 stays', C.run("sdSum('2026-11-01', '2026-11-01')"), [50, 1, 1]);
  eq('a zero day OLDER than 3 days is a real zero (it replaces the day)', C.run("sdDays('SP')['2026-10-20']"), [0, 0, 0]);
  eq('Shopify is never overlaid', C.run("sdDays('SHOP') === SD.d.SHOP"), true);
}
console.log('== 2c. near midnight PT: 23:30 on 31 Oct (already 1 Nov in India) ==');
{
  const C = app(NOW_B);
  withSales(C, 'SP');
  C.$('sdFrom').value = '2026-10-01'; C.$('sdTo').value = '2026-10-31';
  C.run('renderSales()');
  eq('today is still 2026-10-31 (US portal day)', C.run('sdToday()'), '2026-10-31');
  eq('Today = $201', T(C, 'sdToday'), '$201');
  eq('MTD = October so far = $421', T(C, 'sdMtd'), '$421');
  ok('MTD %Δ on complete days: 1–30 Oct 220 vs 100 = ▲120.0%', /▲120\.0% vs LY/.test(T(C, 'sdMtdp')), T(C, 'sdMtdp'));
}

console.log('== 3. the Dashboard\'s sales = the Sales Dashboard\'s (worked out in two places) ==');
{
  const C = app(NOW_A);
  withSales(C, 'SP');
  const d = C.run('DASH_CALC.sales()');
  ['SP', 'CPC'].forEach(b => {
    C.run(`SD_CH = '${b}'`);
    eq(`${b}: Dashboard MTD = Sales Dashboard MTD`, d[b].mtd, C.run("sdSum(sdToday().slice(0, 8) + '01', sdToday())[0]"));
    eq(`${b}: Dashboard YTD = Sales Dashboard YTD`, d[b].ytd, C.run("sdSum(sdToday().slice(0, 4) + '-01-01', sdToday())[0]"));
  });
  near('Both: MTD = Ridhi + CPC = 60 (no Shopify)', d.ALL.mtd, 60);
  near('Both: YTD = 1,070.55 + 70 = 1,140.55', d.ALL.ytd, 1140.55, 1e-9);
  C.run("SD_CH = 'ALL'");
  near('…while the Sales Dashboard "All" MTD is 85 (with Shopify 25)', C.run("sdSum('2026-11-01', '2026-11-01')[0]"), 85);
  eq('the Dashboard puts the channel back (SD_CH unchanged)', C.run('SD_CH'), 'ALL');
}

/* --- PPC & Organic, Overview, Inventory Age fixtures --- */
const WK = { weeks: ['2026-10-11', '2026-10-18', '2026-10-25'], at: '2026-11-01 05:10', adAt: '2026-11-01 07:40',
  rows: {
    A1: { brand: 'SP', weeks: { '2026-10-11': { u: 0, rev: 0, spend: 25, adSales: 0 }, '2026-10-18': { u: 0, rev: 0, spend: 26, adSales: 0 }, '2026-10-25': { u: 10, rev: 420.55, spend: 30, adSales: 120, sessions: 200 } } },
    C1: { brand: 'CPC', weeks: { '2026-10-11': { rev: 0, spend: 10, adSales: 0 }, '2026-10-18': { rev: 0, spend: 10, adSales: 0 }, '2026-10-25': { u: 5, rev: 61, spend: 20, adSales: 40, sessions: 100 } } },
    X1: { brand: '', weeks: { '2026-10-25': { u: 1, rev: 10, spend: 5 } } },
  } };
const TR = { at: '2026-11-01T00:10:00Z', adAt: '2026-11-01', adFrom: '2026-08-01', adTo: '2026-10-31', pending: [], adDone: {},
  d: { SP: { '2026-10-12': [0, 0, 0, 0, 0, 25, 0, 0], '2026-10-19': [0, 0, 0, 0, 0, 26, 0, 0], '2026-10-26': [0, 0, 0, 0, 0, 35, 0, 0] },
    CPC: {} } };   // the saved Overview snapshot holds no CPC — as on real data, where the old check added that up as $0
// What the Overview lays over its snapshot when it opens (read-only here): the nightly ads cache (Sponsored Products: [impr, clicks,
// spend, ad orders, ad sales]) for 11–24 Oct, Amazon's own split totals (matchAds: sp / sb / sd, each [impr, clicks, cost, sales, orders])
// for 25–31 Oct, and the nightly daily cache (sales) — every day of the three weeks, for both brands.
const dayList = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(from + 'T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
const OVADS = { SP: {}, CPC: {} };
dayList('2026-10-11', 14).forEach(d => {
  OVADS.SP[d] = d === '2026-10-11' ? [100, 5, 25, 1, 0] : d === '2026-10-18' ? [100, 5, 26, 1, 0] : [0, 0, 0, 0, 0];
  OVADS.CPC[d] = d === '2026-10-11' || d === '2026-10-18' ? [50, 2, 10, 0, 0] : [0, 0, 0, 0, 0];
});
const MATCHADS = { at: '2026-11-01 06:00', d: { SP: {}, CPC: {} } };
dayList('2026-10-25', 7).forEach(d => {
  const z = [0, 0, 0, 0, 0];
  MATCHADS.d.SP[d] = d === '2026-10-26' ? { sp: [1000, 40, 30.2, 100, 9], sb: [200, 8, 5, 20, 2] } : d === '2026-10-27' ? { sp: z, sd: [300, 3, 2, 0, 0] } : { sp: z };
  MATCHADS.d.CPC[d] = d === '2026-10-26' ? { sp: [500, 20, 18, 40, 4] } : { sp: z };
});
const OVDAILY = { SP: {}, CPC: {} };
dayList('2026-10-11', 21).forEach(d => { OVDAILY.SP[d] = SDD.SP[d] || [0, 0, 0]; OVDAILY.CPC[d] = SDD.CPC[d] || [0, 0, 0]; });
const AGE_COLS = ['inv-age-0-to-90-days', 'inv-age-91-to-180-days', 'inv-age-181-to-270-days', 'inv-age-271-to-365-days', 'inv-age-365-plus-days',
  'inv-age-0-to-30-days', 'inv-age-31-to-60-days', 'inv-age-61-to-90-days'];
const ageRow = (sku, avail, storage, a) => ({ sku, asin: 'B' + sku, parent: 'P' + sku, product: sku, available: avail, storage, age: Object.fromEntries(AGE_COLS.map((c, i) => [c, a[i] || 0])) });
const AGEFIX = `AGE.SP = { cols: ${JSON.stringify(AGE_COLS)}, at: new Date('2026-10-30T09:00:00Z'), rows: ${JSON.stringify([ageRow('S1', 50, 1.25, [20, 10, 5, 3, 2, 8, 7, 5]), ageRow('S2', 30, 0.5, [10, 5, 0, 0, 4, 4, 3, 3])])} };
  AGE.CPC = { cols: ${JSON.stringify(AGE_COLS.slice(0, 5))}, at: new Date('2026-10-30T09:00:00Z'), rows: ${JSON.stringify([ageRow('C1', 20, 2.1, [5, 5, 6, 0, 1])])} };
  AGE_LOADED = true;`;
function fullFixture(C) {
  withSales(C, 'SP');
  C.run(`WEEKLY.weeks = ${JSON.stringify(WK.weeks)}; WEEKLY.rows = ${JSON.stringify(WK.rows)}; WEEKLY.at = '${WK.at}'; WEEKLY.adAt = '${WK.adAt}';`);
  C.run(`TREND = ${JSON.stringify(TR)}; NC.ov.ads = ${JSON.stringify(OVADS)}; NC.ov.daily = ${JSON.stringify(OVDAILY)}; T_MATCH.ads = ${JSON.stringify(MATCHADS)};`);
  C.run(AGEFIX);
}

console.log('== 4. PPC & Organic: the latest-week card, the grid, and the Dashboard\'s Ad spend card ==');
{
  const C = app(NOW_A);
  fullFixture(C);
  const rows = C.run("Object.entries(WEEKLY.rows).map(([asin, r]) => ({ asin, brand: r.brand, weeks: r.weeks }))");
  C.renderRows = rows;
  C.run('renderWeeklyKpis(renderRows, WEEKLY.weeks)');
  const card = T(C, 'wKpis');
  ok('latest week Oct 25-31, all rows: Total sales $492 (420.55 + 61 + 10)', /\$492 Total sales/.test(card), card);
  ok('TACoS = 55 ÷ 491.55 = 11 % (whole %)', /TACoS 11%/.test(card), card);
  ok('Ad spend $55, ACoS = 55 ÷ 160 = 34 %', /\$55 Ad spend ACoS 34%/.test(card), card);
  ok('Organic share = (491.55 − 160) ÷ 491.55 = 67 %', /67% Organic share/.test(card), card);
  ok('Sessions 300, CVR = 16 units ÷ 300 sessions = 5.3 %', /300 Sessions/.test(card) && /CVR 5\.3%/.test(card), card);
  const cell = { rev: 420.55, spend: 30, adSales: 120, u: 10, sessions: 200 };
  C.cell = cell;
  near('grid TACoS (cell) = 30 ÷ 420.55 × 100', C.run('W_METRIC.tacos.get(cell)'), 30 / 420.55 * 100);
  near('grid ACoS = 25', C.run('W_METRIC.acos.get(cell)'), 25);
  near('grid CVR = units ÷ sessions = 5', C.run('W_METRIC.cvr.get(cell)'), 5);
  near('grid Organic sales = 300.55', C.run('W_METRIC.organic.get(cell)'), 300.55, 1e-9);
  near('Organic floored at 0 when ad sales > sales', C.run('wOrganic({ rev: 10, adSales: 15 })'), 0);
  const d = C.run('DASH_CALC.ads()');
  eq('Dashboard Ad spend (Both) = the card\'s $55, TACoS 11', [d.ALL.last.spend, d.ALL.tacos], [55, 11]);
  eq('Dashboard Ad spend Ridhi = 30, TACoS round(30 ÷ 420.55) = 7', [d.SP.last.spend, d.SP.tacos], [30, 7]);
  eq('Dashboard Ad spend CPC = 20, TACoS round(20 ÷ 61) = 33', [d.CPC.last.spend, d.CPC.tacos], [20, 33]);
  ok('…Both (55) ≠ Ridhi + CPC (50): "All" keeps the row with no brand — documented risk', d.ALL.last.spend !== d.SP.last.spend + d.CPC.last.spend);
  // rows with no brand: listed as Unassigned, never dropped from All; no number on the card changes
  C.run('renderWeekly()');
  const note = strip(C.$('wUnassigned').innerHTML);
  ok('PPC & Organic lists the rows with no brand: "1 ASIN with no brand (Unassigned) — $5.00 ad spend and $10.00 sales … X1 ($5.00)"',
    /^1 ASIN with no brand \(Unassigned\) — \$5\.00 ad spend and \$10\.00 sales in the weeks shown\. They are in "All" but in neither Ridhi nor CPC\. X1 \(\$5\.00\)$/.test(note) && !C.$('wUnassigned').classList.contains('hide'), note);
  ok('…the grid tags X1 "Unassigned"', /X1 <span class="w-unas"[^>]*>Unassigned<\/span>/.test(C.$('wTable').innerHTML));
  ok('…and the card is unchanged (All: $492 sales, $55 ad spend, TACoS 11 %)', /\$492 Total sales/.test(T(C, 'wKpis')) && /\$55 Ad spend/.test(T(C, 'wKpis')) && /TACoS 11%/.test(T(C, 'wKpis')), T(C, 'wKpis'));
  C.run("delete WEEKLY.rows.X1; renderWeekly();");
  ok('…no unassigned rows → the note is hidden', C.$('wUnassigned').classList.contains('hide') && !C.$('wUnassigned').innerHTML);
  C.run(`WEEKLY.rows.X1 = ${JSON.stringify(WK.rows.X1)};`);
  // the running week, as it is today: missing ad figures add up as 0
  C.run("WEEKLY.weeks.push('2026-11-01'); WEEKLY.rows.A1.weeks['2026-11-01'] = { u: 1, rev: 50 };");
  C.run("renderWeeklyKpis([{ asin: 'A1', brand: 'SP', weeks: WEEKLY.rows.A1.weeks }], WEEKLY.weeks)");
  const run = T(C, 'wKpis');
  ok('running week with no ad report yet: the card shows TACoS 0% and Organic share 100% (not "—") — documented, not fixed', /TACoS 0%/.test(run) && /100% Organic share/.test(run), run);
}

console.log('== 5. Overview (Ad Console) table formulas — T_ROWS ==');
{
  const C = app(NOW_A);
  const pl = read(path.join(APP, 'ads', 'placement.js'));
  const a = pl.indexOf('const T_ROWS = ['), b = pl.indexOf('\n];', a);
  C.run(pl.slice(a, b + 3).replace('const T_ROWS', 'var T_ROWS_X'));
  C.v = [1000, 40, 35, 20000, 400, 150, 30, 600];   // sales, units, orders, impr, clicks, spend, adOrders, adSales
  const g = k => C.run(`T_ROWS_X.find(r => r.k === '${k}').get(v)`);
  near('TACOS = 150 ÷ 1000 = 15 %', g('tacos'), 15);
  near('ACOS = 150 ÷ 600 = 25 %', g('acos'), 25);
  near('Organic = 1000 − 600 = 400', g('organic'), 400);
  near('Organic % = 40 %', g('organicPct'), 40);
  near('ROAS = 600 ÷ 150 = 4', g('roas'), 4);
  near('CPC = 150 ÷ 400 = 0.375', g('cpc'), 0.375);
  near('CTR = 400 ÷ 20000 = 2 %', g('ctr'), 2);
  near('CVR (Overview) = ad orders ÷ clicks = 30 ÷ 400 = 7.5 % — not units ÷ sessions', g('cvr'), 7.5);
  C.v = [0, 0, 0, 0, 0, 0, 0, 0];
  eq('no sales / clicks / impressions → "—" (null), never 0 %', ['tacos', 'acos', 'roas', 'cpc', 'ctr', 'cvr'].map(g), [null, null, null, null, null, null]);
}

console.log('== 6. Profit & Margin (fee model ref 15 · FBA 11 · returns 10 % of COGS · overhead 10 · salary 10) ==');
{
  const C = app(NOW_A);
  const m = C.run('pfMoney({ rev: 1000, u: 50, spend: 100 }, 5)');
  eq('COGS = 5 × 50 = 250', m.cogs, 250);
  eq('Fees (est.) = referral 150 + FBA 110', [m.referral, m.fba], [150, 110]);
  eq('Other (est.) = returns 25 + overhead 100 + salary 100', [m.ret, m.oh, m.sal], [25, 100, 100]);
  eq('Profit = 1000 − 150 − 110 − 100 − 250 − 25 − 100 − 100 = 165', m.profit, 165);
  near('Margin = 16.5 %', m.margin, 16.5);
  near('ROI = 165 ÷ 250 = 66 %', m.roi, 66);
  near('Per unit = 3.30', m.perUnit, 3.3);
  near('TACoS = 10 %', m.tacos, 10);
  eq('no unit cost → no money at all (null)', C.run('pfMoney({ rev: 1000, u: 50, spend: 100 }, 0)'), null);
  // the partly-costed parent, as pfRows builds it today
  C.run(`HEALTH = { SP: { rows: [{ asin: 'K1', parent: 'PX' }, { asin: 'K2', parent: 'PX' }] }, CPC: { rows: [] } };
    WEEKLY.weeks = ['2026-10-25']; WEEKLY.rows = { K1: { brand: 'SP', weeks: { '2026-10-25': { u: 10, rev: 200, spend: 0 } } }, K2: { brand: 'SP', weeks: { '2026-10-25': { u: 10, rev: 200, spend: 0 } } } };
    COST = { K1: { c: 5 } };`);
  C.$('pfWeeks').value = '1'; C.$('pfView').value = 'parent';
  const par = C.run('pfRows()')[0];
  C.$('pfView').value = 'asin';
  const kid = C.run('pfRows()').find(r => r.asin === 'K1');
  eq('child K1 alone ($200, 10 units, cost $5): profit $53', Math.round(kid.m.profit), 53);
  eq('parent PX (K1 costed + K2 not): profit $161 — all $400 of sales against the costed units only (documented, not fixed)', Math.round(par.m.profit), 161);
  eq('…marked "partial"', par.partial, true);
}

console.log('== 7. Inventory Age: Aged 181+ and Storage — the screen = the Dashboard tile ==');
{
  const C = app(NOW_A);
  C.run(AGEFIX);
  C.run('renderAge()');
  const k = T(C, 'ageKpis');
  ok('screen (Both): Aged 181+ = Ridhi 10 + 4, CPC 7 = 21', /Aged 181\+ days 21/.test(k), k);
  const d = C.run('DASH_CALC.age()');
  eq('Dashboard tile Both: 21 units, $3.85 storage', [d.ALL.units, Math.round(d.ALL.storage * 100) / 100], [21, 3.85]);
  eq('Dashboard tile Ridhi: 14 units (the narrow 0-30/31-60/61-90 buckets are not double-counted), $1.75', [d.SP.units, d.SP.storage], [14, 1.75]);
  eq('Dashboard tile CPC: 7 units, $2.10', [d.CPC.units, d.CPC.storage], [7, 2.1]);
  ok('screen shows storage $3.85 for Both', /\$3\.85/.test(k), k);
}

console.log('== 8. Numbers Check on the fixtures ==');
let checks;
{
  const C = app(NOW_A);
  fullFixture(C);
  checks = C.run('ncRun()');
  const get = (id, view) => checks.find(r => r.id === id && r.view === view) || {};
  const st = (id, view) => get(id, view).status;
  eq('Dashboard Sales MTD = Sales Dashboard: Ridhi ✓, CPC ✓', [st('sales-mtd', 'Ridhi'), st('sales-mtd', 'CPC')], ['ok', 'ok']);
  eq('…Both: explained (Dashboard Both 60 = Sales Dashboard All 85 − Shopify 25)', [st('sales-mtd', 'Both'), get('sales-mtd', 'Both').a.v, get('sales-mtd', 'Both').b.v], ['info', 60, 85]);
  ok('…the reason names Shopify', /Shopify \(\$25\.00\)/.test(get('sales-mtd', 'Both').why), get('sales-mtd', 'Both').why);
  eq('Dashboard Sales YTD = Sales Dashboard: ✓ ✓ explained', ['Ridhi', 'CPC', 'Both'].map(v => st('sales-ytd', v)), ['ok', 'ok', 'info']);
  eq('Dashboard Ad spend = PPC & Organic latest week: ✓ for all three', ['Ridhi', 'CPC', 'Both'].map(v => st('ads-week', v)), ['ok', 'ok', 'ok']);
  eq('PPC & Organic Ad spend Both (55) ≠ Ridhi + CPC (50): ⚠ (a row with no brand)', [st('ads-both', 'Both'), get('ads-both', 'Both').diff], ['warn', 5]);
  eq('PPC weekly sales vs Sales Dashboard (Oct 25-31): Ridhi exact ✓', [st('ppc-sales', 'Ridhi'), get('ppc-sales', 'Ridhi').a.v, get('ppc-sales', 'Ridhi').b.v], ['ok', 420.55, 420.55]);
  eq('…CPC 61 vs 60 (+1.67 %) explained', [st('ppc-sales', 'CPC'), Math.round(get('ppc-sales', 'CPC').pct * 100) / 100], ['info', 1.67]);
  eq('…Both 491.55 vs 480.55 (+2.29 %) ⚠', [st('ppc-sales', 'Both'), Math.round(get('ppc-sales', 'Both').pct * 100) / 100], ['warn', 2.29]);
  const vals = (id, v) => [st(id, v), get(id, v).a && get(id, v).a.v, get(id, v).b && get(id, v).b.v];
  eq('Overview: the saved snapshot holds no CPC — CPC still comes from the caches the Overview lays over it (not $0)', vals('ovw-sp', 'CPC').slice(1), [38, 40]);
  eq('Sponsored Products: Ridhi Overview 25 + 26 + 30.20 = 81.20 vs PPC & Organic 81 (+0.25 %) ✓ within 1 %', vals('ovw-sp', 'Ridhi'), ['ok', 81.2, 81]);
  eq('…CPC 38 vs 40 (−5 %) ⚠', vals('ovw-sp', 'CPC'), ['warn', 38, 40]);
  eq('…Both 119.20 vs every PPC row incl. 1 unassigned ASIN (126) ⚠', vals('ovw-sp', 'Both'), ['warn', 119.2, 126]);
  ok('…the Both row says it includes the unassigned ASIN and its spend', /incl\. 1 unassigned ASIN \(\$5\.00\)/.test(get('ovw-sp', 'Both').b.label), get('ovw-sp', 'Both').b.label);
  ok('…the window is the 3 finished weeks both screens hold, and says so', /^Oct 11-17 → Oct 25-31 · 3 finished wk both screens hold$/.test(get('ovw-sp', 'Ridhi').sub), get('ovw-sp', 'Ridhi').sub);
  eq('Sponsored Brands (Overview only, shown): Ridhi 5 · CPC 0 · Both 5', ['Ridhi', 'CPC', 'Both'].map(v => [st('ovw-sb', v), get('ovw-sb', v).a.v]), [['note', 5], ['note', 0], ['note', 5]]);
  eq('Sponsored Display (Overview only, shown): Ridhi 2 · CPC 0 · Both 2', ['Ridhi', 'CPC', 'Both'].map(v => [st('ovw-sd', v), get('ovw-sd', v).a.v]), [['note', 2], ['note', 0], ['note', 2]]);
  eq('Total ads, all types (Overview, shown): 88.20 · 38 · 126.20', ['Ridhi', 'CPC', 'Both'].map(v => [st('ovw-total', v), get('ovw-total', v).a.v]), [['note', 88.2], ['note', 38], ['note', 126.2]]);
  eq('Organic sales: Ridhi 420.55 − 120 = 300.55 under both definitions ✓', vals('ovw-organic', 'Ridhi'), ['ok', 300.55, 300.55]);
  eq('…CPC: Overview 60 − 40 = 20 vs PPC 61 − 40 = 21 → "definition differs — needs manager decision", not ⚠', vals('ovw-organic', 'CPC'), ['defn', 20, 21]);
  eq('…with PPC on the Overview definition: 61 − 40 (all types, 7-day) = 21', get('ovw-organic', 'CPC').extra.v, 21);
  ok('…the reason shows both definitions and splits the gap (sales source $−1.00, ad-sales definition $0.00)',
    /Overview: Seller Central sales less every ad type's 7-day ad sales\. PPC & Organic: Orders-workbook sales less Sponsored Products' 30-day ad sales\. Of the −\$1\.00 gap, −\$1\.00 is the sales source .* and \$0\.00 the ad-sales definition/.test(get('ovw-organic', 'CPC').why), get('ovw-organic', 'CPC').why);
  eq('…Both 320.55 vs 331.55 (every row) → definition differs', vals('ovw-organic', 'Both'), ['defn', 320.55, 331.55]);
  eq('Overview: Both = Ridhi + CPC (126.20) ✓', vals('ovw-both', 'Both'), ['ok', 126.2, 126.2]);
  eq('PPC & Organic, same 3 weeks: Both (every row) 126 ≠ Ridhi + CPC 121 ⚠ (a row with no brand)', vals('ppc-both13', 'Both'), ['warn', 126, 121]);
  eq('Inventory Age tile = screen: units ✓ ✓ ✓', ['Ridhi', 'CPC', 'Both'].map(v => st('age-units', v)), ['ok', 'ok', 'ok']);
  eq('…storage ✓ ✓ ✓', ['Ridhi', 'CPC', 'Both'].map(v => st('age-storage', v)), ['ok', 'ok', 'ok']);
  eq('Profit & Margin sales vs Sales Dashboard (its 4-week pick = the 3 stored weeks, 11–31 Oct): ✓ explained ⚠', ['Ridhi', 'CPC', 'Both'].map(v => st('pm-sales', v)), ['ok', 'info', 'warn']);
  const n = C.run('ncCounts(ncRun())');
  eq('counts: 18 match · 4 explained · 6 differ · 9 shown only · 2 definition differs · 0 not loaded', [n.ok, n.info, n.warn, n.note, n.defn, n.skip], [18, 4, 6, 9, 2, 0]);
  // the screen and the chip
  C.run("NC.res = ncRun(); NC.at = Date.now(); $('paneNcheck'); ncRender(); ncChipPaint();");
  const page = T(C, 'ncPane');
  ok('the page: summary cards ✓ Matching 18 · ✓ Explained 4 · ⚠ Differing 6 · 9 shown only · 2 definition differs', /✓ Matching 18 .*✓ Explained 4 .*⚠ Differing 6 .*9 shown only · 2 definition differs/.test(page), page.slice(0, 400));
  ok('…the organic row is marked "definition differs — needs manager decision" and shows the third figure', /definition differs — needs manager decision/.test(page) && /\$21\.00 PPC & Organic on the Overview definition/.test(page));
  ok('…a shown-only row says "— Overview only" and "shown only"', /— Overview only — — shown only Only the Overview has Sponsored Brands/.test(page));
  ok('the page: the checks table and the rule book with its risk list', /Checks .*Value A .*Value B .*Rule book .*Worked out in more than one place/.test(page));
  eq('chip on both pages: "⚠ 6 differences", amber', [C.$('ncChipDash').textContent, C.$('ncChipSd').textContent, C.$('ncChipDash').classList.contains('is-warn'), C.$('ncChipDash').hidden], ['⚠ 6 differences', '⚠ 6 differences', true, false]);
  C.run("NC.res = NC.res.filter(r => r.status !== 'warn'); ncChipPaint();");
  ok('…all matching: "🔒 Numbers checked ✓ HH:MM", green', /^🔒 Numbers checked ✓ \d\d:\d\d$/.test(C.$('ncChipSd').textContent) && !C.$('ncChipSd').classList.contains('is-warn'), C.$('ncChipSd').textContent);
  C.run("TAB_OK = t => t !== 'ncheck'; ncChipPaint();");
  eq('…no Numbers Check in the access → no chip', C.$('ncChipDash').hidden, true);
  // access: a Sales-only account
  C.run("TAB_OK = t => ['sales', 'ncheck', 'dash'].includes(t);");
  const only = C.run('ncRun()');
  eq('a Sales-only account: only the sales checks run; the rest say "not in your access"', [...new Set(only.filter(r => r.status !== 'skip').map(r => r.id))], ['sales-mtd', 'sales-ytd']);
}

console.log('== 8d. why they differ: unassigned rows, the per-ASIN report, finished weeks only, Seller Central vs workbook by day ==');
{
  const C = app(NOW_A);
  fullFixture(C);
  // Listing Health puts the unassigned ASIN X1 under Ridhi; Amazon's per-ASIN report as cached (adsAsin: [impr, clicks, spend, orders, sales])
  // holds S9 under BOTH brands for Oct 25-31 — PPC & Organic keeps one cell for it.
  C.run(`HEALTH = { SP: { rows: [{ asin: 'X1', parent: 'PX' }] }, CPC: { rows: [] } };
    NC.ov.asin = { SP: { A1: { '2026-10-11': [0, 0, 25, 0, 0], '2026-10-18': [0, 0, 26, 0, 0], '2026-10-25': [0, 0, 30, 0, 0] }, S9: { '2026-10-25': [0, 0, 3, 0, 0] } },
      CPC: { C1: { '2026-10-11': [0, 0, 10, 0, 0], '2026-10-18': [0, 0, 10, 0, 0], '2026-10-25': [0, 0, 20, 0, 0] }, S9: { '2026-10-25': [0, 0, 2, 0, 0] } } };
    T_MATCH.biz = { at: '2026-11-01 04:00', d: { SP: { '2026-10-30': [110, 3, 2, 500] } } };`);
  const res = C.run('ncRun()');
  const get = (id, view) => res.find(r => r.id === id && r.view === view) || {};
  eq('Ridhi SP now counts the unassigned X1 (Listing Health: Ridhi): PPC 81 + 5 = 86 vs Overview 81.20', [get('ovw-sp', 'Ridhi').b.v, get('ovw-sp', 'Ridhi').a.v], [86, 81.2]);
  ok('…and says so on the row', /incl\. 1 unassigned ASIN Listing Health puts under Ridhi \(\$5\.00\)/.test(get('ovw-sp', 'Ridhi').b.label), get('ovw-sp', 'Ridhi').b.label);
  const sp = C.run('NC.diag.sp').find(x => x.view === 'Ridhi' && x.w === '2026-10-25');
  eq('week by week, Ridhi Oct 25-31: Overview 30.20 · per-ASIN report 33 · PPC brand rows 30 · unassigned 5', [sp.ov, sp.cache, sp.ppc, sp.unas], [30.2, 33, 30, 5]);
  eq('…1 ASIN in both brands\' reports, $3 of Ridhi\'s spend', [sp.shared, sp.sharedSp], [1, 3]);
  const pm = C.run('NC.diag.pm').filter(x => x.view === 'Ridhi');
  eq('Profit & Margin week by week (Ridhi): 3 finished weeks', pm.map(x => x.label), ['Oct 11-17', 'Oct 18-24', 'Oct 25-31']);
  eq('…Oct 25-31: P&M 420.55 · workbook days 420.55 · Sales Dashboard shown 430.55 (Seller Central 110 on 30 Oct)', [pm[2].pm, pm[2].wb, pm[2].sd], [420.55, 420.55, 430.55]);
  const day = C.run('NC.diag.days')[0];
  eq('the day Seller Central and the workbook differ most: Ridhi 30 Oct, 100 vs 110 (+$10, units 2 vs 3)', [day.brand, day.day, day.wb, day.sc, day.diff, day.units], ['Ridhi', '2026-10-30', 100, 110, 10, [2, 3]]);
  C.run('NC.res = ncRun(); NC.at = Date.now(); ncRender();');
  const page = strip(C.$('ncPane').innerHTML);
  ok('the page has "Why they differ" with the three tables', /Why they differ .*Sponsored Products: Overview vs PPC & Organic, week by week .*Profit & Margin vs Sales Dashboard, week by week .*Days where Seller Central and the Orders workbook differ most/.test(page));
  // Profit & Margin: finished weeks only — the running week and today are left out, and the row says which weeks
  const D = app(NOW_A);
  fullFixture(D);
  D.run("WEEKLY.weeks.push('2026-11-01'); WEEKLY.rows.A1.weeks['2026-11-01'] = { u: 1, rev: 50, spend: 1, adSales: 0 }; WEEKLY.rows.C1.weeks['2026-11-01'] = { u: 1, rev: 10, spend: 1, adSales: 0 }; $('pfWeeks').value = '4';");
  const r = D.run('ncRun()').find(x => x.id === 'pm-sales' && x.view === 'Ridhi');
  eq('Profit & Margin vs Sales Dashboard uses its FINISHED weeks only: 420.55 = 420.55 (the running week\'s $50 and today left out)', [r.status, r.a.v, r.b.v], ['ok', 420.55, 420.55]);
  eq('…and names them', r.sub, 'Oct 11-17 → Oct 25-31 · 3 finished wk (running week Nov 1-7 and today left out)');
}

console.log('== 8c. a brand not loaded (the real-data case: Overview CPC) — "— not loaded", never $0, never "differs" ==');
{
  const C = app(NOW_A);
  fullFixture(C);
  C.run('delete NC.ov.ads.CPC; delete T_MATCH.ads.d.CPC;');          // the Overview's CPC ad figures did not arrive
  let res = C.run('ncRun()');
  const get = (id, view) => res.find(r => r.id === id && r.view === view) || {};
  eq('Overview Sponsored Products, CPC: not loaded — no value, not $0', [get('ovw-sp', 'CPC').status, get('ovw-sp', 'CPC').a], ['skip', null]);
  ok('…the reason names the brand and the side', /^CPC: Overview ad figures not loaded — not \$0\.$/.test(get('ovw-sp', 'CPC').why), get('ovw-sp', 'CPC').why);
  eq('…every CPC and Both Overview row is "not loaded" (SP, SB, SD, total, organic, and Both = Ridhi + CPC on each screen)',
    ['ovw-sp', 'ovw-sb', 'ovw-sd', 'ovw-total', 'ovw-organic'].flatMap(id => ['CPC', 'Both'].map(v => get(id, v).status)).concat([get('ovw-both', 'Both').status, get('ppc-both13', 'Both').status]), Array(12).fill('skip'));
  eq('…Ridhi still checks: Sponsored Products ✓', get('ovw-sp', 'Ridhi').status, 'ok');
  ok('…no Overview row for CPC or Both says "differs"', !res.some(r => r.status === 'warn' && /^(ovw-|ppc-both13)/.test(r.id) && r.view !== 'Ridhi'));
  C.run("NC.res = ncRun(); NC.at = Date.now(); ncRender();");
  const page = strip(C.$('ncPane').innerHTML);
  const at = page.indexOf('Sponsored Products ad spend');
  ok('the page shows "— not loaded" and the reason for CPC, never $0.00', /CPC — not loaded — not loaded — — not loaded CPC: Overview ad figures not loaded — not \$0\./.test(page.slice(at, at + 1200)), page.slice(at, at + 1200));
  // the same rule on every other check: no CPC sales on the Sales Dashboard, no CPC Inventory Age snapshot
  C.run('delete SD.d.CPC; AGE.CPC = null;');
  res = C.run('ncRun()');
  eq('Sales MTD / YTD, CPC and Both: not loaded', ['sales-mtd', 'sales-ytd'].flatMap(id => ['CPC', 'Both'].map(v => get(id, v).status)), ['skip', 'skip', 'skip', 'skip']);
  ok('…"CPC sales not loaded"', /^CPC sales not loaded/.test(get('sales-mtd', 'CPC').why), get('sales-mtd', 'CPC').why);
  eq('Inventory Age, CPC and Both: not loaded (not 0 units)', ['age-units', 'age-storage'].flatMap(id => ['CPC', 'Both'].map(v => get(id, v).status)), ['skip', 'skip', 'skip', 'skip']);
  eq('…Ridhi still checks', [get('sales-mtd', 'Ridhi').status, get('age-units', 'Ridhi').status], ['ok', 'ok']);
  eq('PPC weekly sales vs Sales Dashboard, CPC: not loaded (no CPC days on the Sales Dashboard)', get('ppc-sales', 'CPC').status, 'skip');
  C.run('NC.res = ncRun(); ncChipPaint();');
  eq('the chip counts only real differences (a not-loaded row is not a difference)', C.$('ncChipDash').textContent, (n => '⚠ ' + n + ' difference' + (n === 1 ? '' : 's'))(C.run("NC.res.filter(r => r.status === 'warn').length")));
  // a running week whose ads have not landed: not loaded, not $0
  const D = app(NOW_A);
  fullFixture(D);
  D.run("WEEKLY.weeks.push('2026-11-01'); WEEKLY.rows.A1.weeks['2026-11-01'] = { u: 1, rev: 50 }; WEEKLY.rows.C1.weeks['2026-11-01'] = { u: 1, rev: 10 };");
  const r2 = D.run('ncRun()').find(r => r.id === 'ads-week' && r.view === 'Ridhi');
  ok('Dashboard Ad spend for a running week with no ad report yet: not loaded ("ads land 1–2 days late"), not "$0 = $0"', r2.status === 'skip' && /no ad figures for Nov 1-7 yet .*ads land 1–2 days late/.test(r2.why), r2.status + ' ' + r2.why);
}

console.log('== 8b. what a check reads: caches and Firestore only — no write, no Amazon, no AI ==');
{
  const calls = [], reads = [], writes = [];
  const C = app(NOW_A, { ctx: {
    baCall: async p => { calls.push(p); return { data: p.cache === 'daily' ? { at: '2026-11-01 05:47', d: SDD } : null }; },
    getDoc: async ref => { reads.push(ref.c + '/' + ref.id); return { exists: () => false, data: () => ({}) }; },
    doc: (d, c, id) => ({ c, id }), db: {},
    setDoc: async () => { writes.push('setDoc'); }, updateDoc: async () => { writes.push('updateDoc'); }, deleteDoc: async () => { writes.push('deleteDoc'); },
    runTransaction: async () => { writes.push('runTransaction'); }, addDoc: async () => { writes.push('addDoc'); },
  } });
  C.run('salesCheck({ quiet: true })');
  return Promise.resolve().then(async () => {
    for (let i = 0; i < 50; i++) await new Promise(r => setImmediate(r));
    const res = C.run('NC.res');
    eq('backend calls: only cache reads (daily, ads, adsAsin, matchBiz, matchAds)', [...new Set(calls.map(p => JSON.stringify(p)))].sort(), ['{"cache":"ads"}', '{"cache":"adsAsin"}', '{"cache":"daily"}', '{"cache":"matchAds"}', '{"cache":"matchBiz"}']);
    ok('Firestore: only reads (audit/weekly, audit/trends, age/SP, age/CPC)', ['audit/weekly', 'audit/trends', 'age/SP', 'age/CPC'].every(x => reads.includes(x)), reads.join(', '));
    eq('no write of any kind', writes, []);
    ok('…and it still checked the sales numbers from the nightly cache', res && res.some(r => r.id === 'sales-mtd' && r.status === 'ok'), res && res.map(r => r.id + ':' + r.status).join(' '));
    eq('the Sales Dashboard\'s copy in this browser was not written', C.run("localStorage.getItem('sd.daily.v1')"), null);
    finish();
  });
}

function finish() {
  console.log('== 9. the rule book: docs/sales-metrics.md names every metric of the screen ==');
  const doc = read(path.join(ROOT, 'docs', 'sales-metrics.md'));
  const C = app(NOW_A);
  const rules = C.run('NC_RULES');
  ok(`${rules.length} metrics in the rule book (at least the 25 the card asks for)`, rules.length >= 25);
  const need = ['Sales', 'Units', 'Orders', 'Avg $ / item', 'Today', 'Yesterday', 'WTD', 'MTD', 'YTD', 'LY and %Δ', 'Expected — month', 'Ad spend', 'Ad sales', 'Organic sales',
    'TACoS', 'ACoS', 'Organic share', 'Sessions', 'CVR', 'CTR', 'CPC', 'Fees (est.)', 'COGS', 'Profit', 'Margin', 'ROI', 'Aged units', 'Storage $'];
  const names = rules.map(r => r.name);
  const missing = need.filter(n => !names.some(x => x.startsWith(n)));
  eq('every metric the card names has a rule', missing, []);
  const notInDoc = names.filter(n => !doc.includes('### ' + n));
  eq('every rule has its section in docs/sales-metrics.md', notInDoc, []);
  ok('every rule has all nine fields', rules.every(r => ['line', 'screens', 'source', 'formula', 'day', 'incl', 'brand', 'round', 'fresh'].every(k => r[k] && String(r[k]).length > 2)));
  const risks = C.run('NC_RISKS');
  ok('the risk list is in the doc', risks.length >= 10 && /## Worked out in more than one place/.test(doc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
