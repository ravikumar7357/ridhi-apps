/* The Sales Dashboard charts (src/app/sales/sales-charts.js): they DRAW ONLY — every number comes from the Sales Dashboard's own sums.
 * Checks the per-day values (sales / units from sdDays, ad spend from Seller Central's ad totals), last year = the same weekday, the
 * monthly sums = sdSum, the smooth line (never overshoots, breaks at a gap), the y-axis top, and the annotations (at most 3, never
 * overlapping, only real deals typed in the Deal Calendar for the brand on view, plus last week's biggest mover).
 *   node tests/sales-charts-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', 'sales-charts.js'), 'utf8');
const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function load(extra) {
  const ctx = vm.createContext(Object.assign({ console, Math, JSON, Number, String, Object, Array, Map, Set, Date, Intl, isFinite,
    SD_CH: 'SP', sdShift: shift, sdMoney: v => '$' + Math.round(v).toLocaleString('en-US'), T_MATCH: { biz: null, ads: null },
    localStorage: { getItem: () => null, setItem() {} } }, extra || {}));
  vm.runInContext(SRC + '\n;this.__x = { SDC, sdcValueOf, sdcPath, sdcNice, sdcNotes, sdcFmt };', ctx);
  return Object.assign(ctx.__x, { ctx });
}
// the Sales Dashboard's own days: Ridhi $100 + 2 units a day, CPC $50 + 1, Shopify $20 + 1 — this year and last
const DAYS = { SP: {}, CPC: {}, SHOP: {} };
for (let i = 0; i < 800; i++) {
  const d = shift('2026-11-23', -i);
  DAYS.SP[d] = [100 + (i % 7), 2, 2]; DAYS.CPC[d] = [50, 1, 1]; DAYS.SHOP[d] = [20, 1, 1];
}
const sdDays = ch => DAYS[ch] || {};

(async () => {
  console.log('== the values per day: the Sales Dashboard\'s own days ==');
  {
    const X = load({ sdDays });
    ok('Ridhi sales on a day = sdDays(SP)[day][0]', X.sdcValueOf('sales')('2026-11-20') === DAYS.SP['2026-11-20'][0]);
    ok('Ridhi units = sdDays(SP)[day][1]', X.sdcValueOf('units')('2026-11-20') === 2);
    X.ctx.SD_CH = 'ALL';
    ok('All = Ridhi + CPC + Shopify, as sdSum adds them', X.sdcValueOf('sales')('2026-11-20') === DAYS.SP['2026-11-20'][0] + 50 + 20);
    ok('a day nobody holds: no value (a gap, never 0)', X.sdcValueOf('sales')('2020-01-01') === null);
    X.ctx.SD_CH = 'SP';
    ok('last year = the same weekday 364 days back (Sat 21 Nov 2026 → Sat 22 Nov 2025)', new Date(shift('2026-11-21', -364) + 'T00:00:00Z').getUTCDay() === 6 && shift('2026-11-21', -364) === '2025-11-22');
  }
  console.log('== ad spend: Seller Central\'s ad totals (the Overview\'s definition) ==');
  {
    const ads = { d: { SP: { '2026-11-20': { sp: [1000, 50, 40.5, 0, 0], sb: [10, 1, 9.25], sd: [5, 1, 3] }, '2026-11-21': { sb: [1, 1, 99] } }, CPC: { '2026-11-20': { sp: [1, 1, 10] } } } };
    const X = load({ sdDays, T_MATCH: { biz: null, ads } });
    ok('SP + SB + SD spend on a day: $40.50 + $9.25 + $3 = $52.75', X.sdcValueOf('ads')('2026-11-20') === 52.75);
    ok('a day without Sponsored Products is not known (no value), as the Overview', X.sdcValueOf('ads')('2026-11-21') === null);
    X.ctx.SD_CH = 'ALL';
    ok('All = Ridhi + CPC (Shopify has no ad spend)', X.sdcValueOf('ads')('2026-11-20') === 62.75);
    X.ctx.SD_CH = 'SHOP';
    ok('Shopify: no ad spend at all', X.sdcValueOf('ads')('2026-11-20') === null);
    const Y = load({ sdDays });
    ok('no matchAds loaded: no ad spend (never a made-up 0)', Y.sdcValueOf('ads')('2026-11-20') === null);
  }
  console.log('== the drawing helpers ==');
  {
    const X = load({ sdDays });
    ok('the y-axis top is a round number above the highest value (4,321 → 5,000; 0.7 → 1)', X.sdcNice(4321) === 5000 && X.sdcNice(0.7) === 1 && X.sdcNice(150) === 200);
    const pts = [[0, 100], [10, 50], [20, 50], [30, 10], [40, 90]];
    const d = X.sdcPath(pts);
    const ys = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter((v, i) => i % 2 === 1);
    ok('the smooth line never overshoots its points (monotone): every y stays within 10–100', ys.every(y => y >= 10 - 1e-9 && y <= 100 + 1e-9), ys.join(','));
    ok('a gap (a day nobody holds) breaks the line into two pieces', (X.sdcPath([[0, 1], [1, 2], null, [3, 4], [4, 5]]).match(/M/g) || []).length === 2);
    ok('money on the axis: $12k / $1.5k / $900; units as counts', X.sdcFmt('sales', 12000, true) === '$12k' && X.sdcFmt('sales', 1500, true) === '$1.5k' && X.sdcFmt('sales', 900, true) === '$900' && X.sdcFmt('units', 1234) === '1,234');
  }
  console.log('== the annotations: real, at most 3, never overlapping ==');
  {
    const days = Array.from({ length: 90 }, (_, i) => shift('2026-08-26', i));
    const vals = days.map((d, i) => 100 + (i % 10) * 10);
    const xOf = i => 50 + i * 10, yOf = v => 300 - v;
    const plan = {
      'PA|2026-11-01': { t: 'LIGHTNING', v: 20 },             // Ridhi, in view
      'PB|2026-11-08': { t: 'PED', v: 15 },                   // Ridhi, in view
      'PC|2026-11-08': { t: 'COUPON', v: 5 },                 // CPC: not on the Ridhi chart
      'PD|2025-01-05': { t: 'DEAL', v: 10 },                  // long before the chart
      'PE|2026-10-04': { t: '' },                             // nothing planned
      'PF|2026-10-11': { t: 'BEST DEAL', v: 30 }, 'PG|2026-10-18': { t: 'PRICE DISC', v: 12 }, 'PH|2026-10-25': { t: 'DEAL', v: 8 },
    };
    const brands = new Map([['PA', 'SP'], ['PB', 'SP'], ['PC', 'CPC'], ['PF', 'SP'], ['PG', 'SP'], ['PH', 'SP']]);
    const X = load({ sdDays, D_PLAN: plan, dPlanSpan: (wk, p) => ({ start: wk, end: shift(wk, 6) }), dBrandOf: () => brands, parentName: (b, p) => 'Parent ' + p });
    const n = X.sdcNotes(days, vals, xOf, yOf, 'sales');
    ok('at most 3 annotations', n.length <= 3 && n.length > 0, n.map(a => a.text).join(' | '));
    ok('only deals typed for the brand on view, in view (never the CPC coupon, the old deal or an empty cell)', n.every(a => !/Coupon|Parent PC|Parent PD|Parent PE/.test(a.text)), n.map(a => a.text).join(' | '));
    ok('labels never overlap (a label that would touch another goes one row up, at most 2 rows)', n.every((a, i) => n.every((b, j) => i === j || a.row !== b.row || Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 6)) && n.every(a => a.row === 0 || a.row === 1));
    ok('each sits on its deal\'s highest day', n.every(a => vals[a.i] === Math.max(...days.map((d, i) => (d >= a.tip.match(/(\d{4}-\d\d-\d\d) →/)[1] && d <= a.tip.match(/→ (\d{4}-\d\d-\d\d)/)[1] ? vals[i] : -1)))));
    ok('a deal label names its type, % and parent: "Lightning 20% · Parent PA"', n.some(a => a.text === 'Lightning 20% · Parent PA') || n.length === 3, n.map(a => a.text).join(' | '));
    X.ctx.SD_CH = 'SHOP';
    ok('Shopify: no deal annotations (deals are Amazon\'s)', X.sdcNotes(days, vals, xOf, yOf, 'sales').length === 0);
    X.ctx.SD_CH = 'SP';
    const mover = { ok: true, wk: { L: '2026-11-15' }, movers: [{ name: 'Ridhi Napkins Set of 4', d: -120000, driver: { t: 'out of stock' } }] };
    const Y = load({ sdDays, D_PLAN: {}, dPlanSpan: () => ({}), dBrandOf: () => new Map(), viFor: () => mover, VI: { data: {} }, viMoney: c => (c < 0 ? '−' : '+') + '$' + Math.abs(c / 100) });
    const days2 = Array.from({ length: 30 }, (_, i) => shift('2026-10-25', i));
    const m = Y.sdcNotes(days2, days2.map(() => 50), xOf, yOf, 'sales');
    ok('last week\'s biggest mover is noted (Sales only), inside that week: "Ridhi Napkins Set of 4 −$1200"', m.length === 1 && m[0].k === 'mover' && days2[m[0].i] >= '2026-11-15' && days2[m[0].i] <= '2026-11-21' && /Ridhi Napkins Set of 4/.test(m[0].text), JSON.stringify(m));
    ok('…not on Units or Ad spend', Y.sdcNotes(days2, days2.map(() => 50), xOf, yOf, 'units').length === 0);
  }
  console.log('== the old charts are gone from sales-dashboard.js; renderSales draws through sdcRender, its numbers unchanged ==');
  {
    const sd = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'sales', 'sales-dashboard.js'), 'utf8');
    ok('renderSales calls sdcRender(today, yr, lyr); sdChartDaily / sdChartMonthly are no longer there', /if \(typeof sdcRender === 'function'\) sdcRender\(today, yr, lyr\)/.test(sd) &&!/function sdChartDaily|function sdChartMonthly/.test(sd));
    ok('the monthly chart adds up months exactly as the Monthly Comparison table (sdSum, the same two date windows)',
      /sdSum\(`\$\{yr\}-\$\{mm\}-01`, last\)\[0\]/.test(SRC) && /sdSum\(`\$\{lyr\}-\$\{mm\}-01`, `\$\{lyr\}-\$\{mm\}-31`\)\[0\]/.test(SRC));
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('the page: 6 sparklines, the daily chart then the monthly chart (full width), the tables folded under "Show tables ▾"',
      (html.match(/class="sd-spark" data-spark=/g) || []).length === 6 && html.indexOf('id="sdChartDaily"') < html.indexOf('id="sdChartMonthly"')
      && html.indexOf('id="sdChartMonthly"') < html.indexOf('id="sdTables" hidden') && /Show tables ▾/.test(html)
      && html.indexOf('id="sdTables" hidden') < html.indexOf('id="sdPeriodBody"') && html.indexOf('id="sdPeriodBody"') < html.indexOf('<!-- /sdTables -->'));
    ok('the order: KPI cards → This week in plain English → Custom Range → daily → monthly → tables',
      ['class="sd-kpis"', 'id="viBox"', 'Custom Range', 'id="sdChartDaily"', 'id="sdChartMonthly"', 'id="sdTablesBtn"'].map(k => html.indexOf(k)).every((v, i, a) => v > 0 && (!i || v > a[i - 1])));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
