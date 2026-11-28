/* BSR Audit — the decision page (src/app/listing/bsr-decide.js, 28 Nov 2026) over the real bsr-audit.js, in a stub page.
 *   node tests/bsr-decide-test.js
 * Amazon-style ranks (lower = better = green ▲) · orders / revenue = the same per-day and weekly rows Sales Alerts and Numbers Check read ·
 * each period · the verdict rules (low volume, category change) · the story line and the cards · Act now / Winning · chips, sort,
 * search · the panel opens and closes (✕ visible) · ✨ off · the CSV · read-only · the existing engine (bsrBuildRows) unchanged. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + String(extra).slice(0, 700) : '')); } };
const SRC = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const add = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* ---- the fixture: SP, weeks W44–W48 (Mondays 26 Oct … 23 Nov 2026); the per-day data 13 Oct … 26 Nov; today 28 Nov (PT) ---- */
const WEEKS = ['2026-W44', '2026-W45', '2026-W46', '2026-W47', '2026-W48'];
const DFROM = '2026-10-13', UPTO = '2026-11-26';
const A = ['2026-11-22', '2026-11-26'], B = ['2026-11-15', '2026-11-19'];        // This week vs last (last = Thu 26 Nov)
const inR = (d, r) => d >= r[0] && d <= r[1];
// [parent, name, sizes, price, units this week (A), units last week (B), rank before → now (sub), sub-cat now/before, extra]
const FAM = [
  ['P1', 'Stripe Tablecloth', 2, 20, 130, 100, [5200, 3100], ['Tablecloths', 'Tablecloths'], {}],            // growing
  ['P2', 'Pillow Insert', 1, 20, 80, 120, [6100, 8900], ['Bed Pillows', 'Bed Pillows'], { q: 0 }],           // needs action: out of stock
  ['P3', 'Napkins Set', 1, 20, 95, 100, [4000, 3000], ['Cloth Napkins', 'Cloth Napkins'], {}],              // check price / conversion
  ['P4', 'Table Runner', 1, 20, 105, 100, [3000, 4000], ['Table Runners', 'Table Runners'], {}],            // category busier
  ['P5', 'Tiny Apron', 1, 20, 5, 5, [9000, 14000], ['Aprons', 'Aprons'], {}],                                 // too few orders
  ['P6', 'Moved Quilt', 1, 20, 50, 100, [2000, 4000], ['Dining Linens', 'Quilts'], {}],                        // category changed
  ['P7', 'Steady Placemats', 1, 20, 100, 100, [2000, 2050], ['Place Mats', 'Place Mats'], {}],               // steady
  ['P8', 'Big Tablecloth', 1, 20, 120, 200, [7000, 9800], ['Tablecloths', 'Tablecloths'], { q: 40 }],         // needs action, more money
];
function fixture() {
  const HEALTH = { SP: { rows: [] }, CPC: { rows: [] } };
  const BSR = { SP: {}, CPC: {} };
  WEEKS.forEach(w => { BSR.SP[w] = {}; });
  const d = {}, brand = {}, W = { weeks: [], rows: {} };
  for (let w = add('2026-11-22', -25 * 7); w <= '2026-11-22'; w = add(w, 7)) W.weeks.push(w);
  FAM.forEach(([p, name, sizes, price, uA, uB, rk, cats, extra]) => {
    const kids = [];
    for (let j = 0; j < sizes; j++) {
      const asin = `B0${p}KID${j}`.padEnd(10, 'X').slice(0, 10);
      kids.push(asin);
      HEALTH.SP.rows.push({ brand: 'SP', parent: 'B0' + p + 'PARENT'.slice(0, 8 - p.length), asin, sku: `${p}-S${j}`, title: name, size: j ? '60x120' : '60x90', color: 'Blue', price, qty: extra.q != null ? extra.q : 30 });
      brand[asin] = 'SP';
      const share = sizes === 1 ? 1 : j ? 0.4 : 0.6;
      const per = (u, days) => u * share / days;
      d[asin] = {};
      for (let day = DFROM; day <= UPTO; day = add(day, 1)) {
        const u = inR(day, A) ? per(uA, 5) : inR(day, B) ? per(uB, 5) : 10 * share;
        d[asin][day] = [u, Math.round(u * price * 100) / 100];
      }
      W.rows[asin] = { weeks: {} };
      W.weeks.forEach(wk => {
        let u = 0;
        for (let k = 0; k < 7; k++) { const day = add(wk, k); u += day < DFROM ? 10 * share : (d[asin][day] || [0])[0]; }
        W.rows[asin].weeks[wk] = { u, rev: Math.round(u * price * 100) / 100 };
      });
    }
    const parent = 'B0' + p + 'PARENT'.slice(0, 8 - p.length);
    WEEKS.forEach((w, i) => {
      const sub = i === WEEKS.length - 1 ? rk[1] : rk[0];
      const k = {};
      kids.forEach((a, j) => { k[a] = [sub * 15 + j * 100, sub + j * 50]; });
      BSR.SP[w][parent] = { rank: sub * 15, cat: 'Home & Kitchen', sub, subCat: i === WEEKS.length - 1 ? cats[0] : cats[1], n: sizes, k, p: price, q: i === WEEKS.length - 1 && extra.q != null ? extra.q : 30 };
    });
  });
  return { HEALTH, BSR, days: { d, brand, from: DFROM, upTo: UPTO, at: '2026-11-27 06:10' }, weekly: W };
}

function load(o) {
  o = o || {};
  const F = fixture();
  const els = {};
  const cl = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', hidden: id === 'bsxPanel', className: '', dataset: {}, style: { setProperty() {} }, classList: cl(),
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, closest: () => ({ classList: cl() }), setAttribute() {}, focus() {}, isConnected: true });
  const store = { 'selloraDashFx': o.fx === false ? '0' : null };
  const raf = [];
  const ctx = {
    $: el, document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => ({ click() {} }) }, window: undefined,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } }, matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => { raf.push(fn); return raf.length; }, performance: { now: () => 0 },
    CSS: { escape: s => s }, getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }), Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, H_PAGE: 300, H_SWEEP_PAR: 3, H_LOADED: true, HEALTH: F.HEALTH,
    baCall: async () => ({ map: {} }), db: {}, doc: (d, c, id) => ({ path: c + '/' + id }), serverTimestamp: () => 'ts', getDoc: async () => ({ exists: () => false }), setDoc: async () => {},
    loadParentNames: async () => {}, loadHealthCache: async () => {}, hCtx: () => ({}), lrPictures: () => ({ main: 'x' }), lrAplus: () => ({ v: true }),
    parentName: (b, a) => (F.HEALTH.SP.rows.find(r => r.parent === a) || {}).title || '', parentNameCell: (b, a, t) => t, wireParentNameCells() {},
    WEEKLY: F.weekly, loadWeekly: async () => {}, D_HDA: [], D_PLAN: {}, loadDeals: async () => {}, lrShopOf: () => ({ k: 'ok' }), AMZ: { map: new Map() }, amzEnsure: async () => {},
    LH: { rows: [{ sku: 'P1-S0', at: Date.parse('2026-11-17T10:00:00Z'), name: 'Asha', field: 'Title', result: 'accepted' }], err: '', f: {} }, lhLoad: async () => [], lhWhat: r => r.field,
    showTab: t => { ctx.shown = t; }, ME: { email: 'v@x.com', tabs: ['bsr'] }, API: { url: 'x' }, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    sdToday: () => '2026-11-28', VI: { v: 1, data: { days: F.days, weekly: F.weekly, stock: {} } }, tkBtnHtml: (x, cls, label) => `<button type="button" class="tk-new ${cls}" data-tk-new='${JSON.stringify(x)}'>${label}</button>`,
    lsFirstRows: (id, n) => n, lsLaterRows() {}, AL: { brand: 'SP' }, hFocusOpen() {},
  };
  const names = ['bsxPeriodDates', 'bsxWeeksFor', 'bsxSum', 'bsxVerdict', 'bsxRankParts', 'bsxRankHtml', 'bsxAction', 'bsxCompute', 'bsxStory', 'bsxComputeView', 'bsxPaint', 'bsxShown', 'bsxSorted',
    'bsxTablePaint', 'bsxKpis', 'bsxChipsPaint', 'bsxDecision', 'bsxPanelOpen', 'bsxPanelClose', 'bsxPanelDraw', 'bsxCsv', 'bsxMode', 'bsxFx', 'bsxLine', 'bsxKids', 'bsxShell', 'BSX', 'BSX_V',
    'bsrBuildRows', 'renderBsr', 'BSR', 'BSR_WEEKS', 'BSR_SRC'];
  const src = SRC('bsr-audit.js') + '\n;' + SRC('bsr-decide.js') + '\n;return {' + names.join(',') + ', setLoaded: v => { BSR_LOADED = v; }, setMode: m => { BSR_MODE = m; } };';
  const api = new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  api.BSR_WEEKS.SP = WEEKS.slice();
  Object.assign(api.BSR.SP, F.BSR.SP);
  return Object.assign(api, { el, ctx, F, raf, store });
}

(async () => {
  console.log('== 1. ranks as Amazon writes them: lower number = better = green ▲ ==');
  {
    const X = load();
    const up = X.bsxRankParts(3100, 5200, 'Tablecloths', 'better', false);
    ok('#3,100 from #5,200: "▲ 2,100 (▲40%) · from #5,200", green', up.now === '#3,100' && up.ch === '▲ 2,100 (▲40%) · from #5,200' && up.cls === 'up', JSON.stringify(up));
    const dn = X.bsxRankParts(8900, 6100, 'Bed Pillows', 'worse', false);
    ok('#8,900 from #6,100: "▼ 2,800 (▼46%) · from #6,100", red', dn.ch === '▼ 2,800 (▼46%) · from #6,100' && dn.cls === 'down', JSON.stringify(dn));
    ok('the same number: grey "—"; a move inside the noise band: grey (no colour)', X.bsxRankParts(2000, 2000, '', 'stable', false).ch === '—' && X.bsxRankParts(2050, 2000, '', 'stable', false).cls === 'flat');
    ok('category changed: amber "category changed" — no swing shown', JSON.stringify(X.bsxRankParts(2000, 4000, 'Dining Linens', 'better', true)) === JSON.stringify({ now: '#2,000', cat: 'Dining Linens', ch: 'category changed', cls: 'amber' }));
    const res = X.bsxComputeView();
    const p1 = res.rows.find(r => r.name === 'Stripe Tablecloth');
    const h = X.bsxRankHtml(p1);
    ok('in the table: "#3,100 in Tablecloths", the main category smaller below ("#46,500 in Home & Kitchen"), tooltip "Lower rank number = better on Amazon"', /<b>#3,100<\/b> in Tablecloths/.test(h) && /<small class="bsx-main">#46,500 in Home &amp; Kitchen<\/small>/.test(h) && /title="Lower rank number = better on Amazon">▲ 2,100 \(▲40%\) · from #5,200/.test(h) && /bsx-rch is-up/.test(h), h);
  }

  console.log('== 2. orders and revenue: the same per-day and weekly rows as Sales Alerts and Numbers Check ==');
  {
    const X = load();
    const asins = X.F.HEALTH.SP.rows.filter(r => r.title === 'Stripe Tablecloth').map(r => r.asin);
    const s = X.bsxSum(asins, A[0], A[1], { days: X.F.days, weekly: X.F.weekly });
    let u = 0, rev = 0;
    for (let day = A[0]; day <= A[1]; day = add(day, 1)) asins.forEach(a => { u += X.F.days.d[a][day][0]; rev += X.F.days.d[a][day][1]; });
    ok('This week (22–26 Nov): Σ of the per-day rows (what Sales Alerts sums) — 130 orders, $2,600', Math.abs(s.u - u) < 1e-6 && Math.abs(s.s - rev) < 0.01 && s.u === 130 && s.s === 2600 && !s.est && !s.miss, JSON.stringify([s, u, rev]));
    // Last 4 weeks vs 4 before: 27 Sep – 24 Oct reaches back before the per-day data (13 Oct): whole weeks from the weekly store
    const B4 = X.bsxSum(asins, '2026-09-27', '2026-10-24', { days: X.F.days, weekly: X.F.weekly });
    const wk = ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18'].reduce((t, w) => t + asins.reduce((x, a) => x + X.F.weekly.rows[a].weeks[w].rev, 0), 0);
    ok('4 weeks reaching before the per-day data: = the weekly store\'s 4 weeks exactly (Numbers Check\'s weekly figures) — the split week 11–17 Oct = its total − its days in the per-day data', Math.abs(B4.s - wk) < 0.01 && !B4.est, JSON.stringify([B4, wk]));
    const M = X.bsxSum(asins, '2026-10-01', '2026-10-26', { days: X.F.days, weekly: X.F.weekly });
    ok('…a part-week that cannot be split (1–3 Oct of the week 27 Sep – 3 Oct) is pro rata and said: est = 3 days', M.est === 3 && M.s > 0, JSON.stringify(M));
    ok('no weekly store for a week before the per-day data: "missing" days counted, never invented', X.bsxSum(asins, '2026-01-01', '2026-01-07', { days: X.F.days, weekly: X.F.weekly }).miss === 7);
    const res = X.bsxComputeView();
    ok('the page\'s family numbers are these sums: Stripe Tablecloth 130 vs 100 orders, $2,600 vs $2,000, avg price $20', (r => r.uA === 130 && r.uB === 100 && r.sA === 2600 && r.sB === 2000 && r.price === 20)(res.rows.find(r => r.name === 'Stripe Tablecloth')));
    ok('Revenue / Orders cards = Σ of the families', Math.abs(res.kpi.sA - res.rows.reduce((t, r) => t + r.sA, 0)) < 0.01 && res.kpi.uA === res.rows.reduce((t, r) => t + r.uA, 0));
    ok('the last day = the last finished day the per-day data holds (26 Nov), never today', res.last === '2026-11-26');
  }

  console.log('== 3. each period ==');
  {
    const X = load();
    const P = k => JSON.stringify([X.bsxPeriodDates(k, '2026-11-26').a, X.bsxPeriodDates(k, '2026-11-26').b]);
    ok('This week vs last: Sun 22 → Thu 26 Nov vs 15–19 Nov (the same days)', P('week') === JSON.stringify([A, B]), P('week'));
    ok('Last 2 weeks vs 2 before: 8–21 Nov vs 25 Oct – 7 Nov (finished Sun–Sat weeks)', P('2w') === JSON.stringify([['2026-11-08', '2026-11-21'], ['2026-10-25', '2026-11-07']]), P('2w'));
    ok('Last 4 weeks vs 4 before: 25 Oct – 21 Nov vs 27 Sep – 24 Oct', P('4w') === JSON.stringify([['2026-10-25', '2026-11-21'], ['2026-09-27', '2026-10-24']]), P('4w'));
    ok('This month vs last month: 1–26 Nov vs 1–26 Oct', P('month') === JSON.stringify([['2026-11-01', '2026-11-26'], ['2026-10-01', '2026-10-26']]), P('month'));
    ok('…31 Mar against February: capped at 28 Feb', JSON.stringify(X.bsxPeriodDates('month', '2027-03-31').b) === JSON.stringify(['2027-02-01', '2027-02-28']));
    const W = k => JSON.stringify(X.bsxWeeksFor(WEEKS, k));
    ok('the rank weeks: W48 vs W47 · W46 · W44 · month: W48 vs last month\'s newest (W44, Monday 26 Oct)', W('week') === '{"a":"2026-W48","b":"2026-W47"}' && W('2w') === '{"a":"2026-W48","b":"2026-W46"}' && W('4w') === '{"a":"2026-W48","b":"2026-W44"}' && W('month') === '{"a":"2026-W48","b":"2026-W44"}', [W('week'), W('2w'), W('4w'), W('month')].join(' '));
    X.BSX.period = '4w';
    const r4 = X.bsxComputeView();
    ok('the page follows the period: 4 weeks → its dates and W48 vs W44', r4.per.label === '25 Oct–21 Nov vs 27 Sep–24 Oct' && r4.weeks.SP.b === '2026-W44', r4.per.label);
  }

  console.log('== 4. the verdict ==');
  {
    const X = load();
    const v = (move, uA, uB, sA, sB, cat) => X.bsxVerdict({ move, uA, uB, sA, sB, catChanged: cat });
    ok('rank ▲ + revenue ▲ → 🟢 Growing; rank ▲ + revenue flat / ▼ → 🟡 Check', v('better', 50, 40, 1300, 1000) === 'grow' && v('better', 50, 50, 1050, 1000) === 'check' && v('better', 50, 60, 800, 1000) === 'check');
    ok('rank ▼ + revenue ▼ → 🔴 Needs action; rank ▼ + revenue ▲ / flat → ⚪ Category busier', v('worse', 30, 50, 600, 1000) === 'act' && v('worse', 50, 50, 1050, 1000) === 'busy' && v('worse', 60, 50, 1200, 1000) === 'busy');
    ok('rank held: revenue ▲ Growing, ▼ Check, flat Steady; revenue moves at 10%', v('stable', 50, 50, 1100, 1000) === 'grow' && v('stable', 50, 50, 900, 1000) === 'check' && v('stable', 50, 50, 1090, 1000) === 'steady');
    ok('fewer than 10 orders in BOTH periods → "Too few orders to judge"; 9 and 12 → judged', v('worse', 9, 8, 90, 80) === 'low' && v('worse', 9, 12, 90, 240) === 'act');
    ok('category changed → "Category changed" (before any rank verdict); no rank in a week → "No rank to compare"', v('better', 50, 50, 2000, 1000, true) === 'cat' && v(null, 50, 50, 2000, 1000) === 'norank');
    const res = X.bsxComputeView();
    const by = n => res.rows.find(r => r.name === n).verdict;
    ok('the fixture: Stripe grow · Pillow Insert act · Napkins check · Runner busy · Tiny Apron low · Moved Quilt cat · Placemats steady · Big Tablecloth act',
      ['Stripe Tablecloth', 'Pillow Insert', 'Napkins Set', 'Table Runner', 'Tiny Apron', 'Moved Quilt', 'Steady Placemats', 'Big Tablecloth'].map(by).join() === 'grow,act,check,busy,low,cat,steady,act', res.rows.map(r => r.name + ':' + r.verdict).join(' '));
    ok('…the category-changed family shows "category changed" in amber, no fake swing', (r => r.rank.ch === 'category changed' && r.rank.cls === 'amber' && r.move === null)(res.rows.find(r => r.name === 'Moved Quilt')));
  }

  console.log('== 5. the story line, the number cards, Act now / Winning ==');
  {
    const X = load();
    const res = X.bsxComputeView();
    X.BSX.res = res;
    const story = X.bsxStory(res, 'this week');
    // revenue: $13,700 this week against $16,500 (−17%)
    ok('one plain line from the numbers: "Revenue down 17% this week. 2 families ranking better, 4 worse. Biggest win: Stripe Tablecloth (+$600). Act on: Big Tablecloth (−$1,600)."',
      story === 'Revenue down 17% this week. 2 families ranking better, 4 worse. Biggest win: Stripe Tablecloth (+$600). Act on: Big Tablecloth (−$1,600).' && res.kpi.sA === 13700 && res.kpi.sB === 16500, story);
    ok('the counts: ranking better 2 (Stripe, Napkins), worse 4 (Pillow, Runner, Big and the low seller — its rank did move; the moved category not counted), needs action 2', res.kpi.better === 2 && res.kpi.worse === 4 && res.kpi.act === 2, JSON.stringify(res.kpi));
    X.bsxKpis(res);
    const k = X.el('bsxKpis').innerHTML;
    ok('5 cards: Revenue (▼ %), Orders (▼ %), Ranking better, Ranking worse, Needs action (red) — each a filter', (k.match(/class="bsx-kpi/g) || []).length === 5 && /Revenue<\/span><b data-to="13700" data-fmt="money">\$13,700<\/b><span class="bsx-ks"><span class="bsx-kd is-down">▼ 17%<\/span>/.test(k)
      && /data-bsx-f="better"[\s\S]*?<b data-to="2"/.test(k) && /data-bsx-f="worse"[\s\S]*?<b data-to="4"/.test(k) && /class="bsx-kpi is-bad" data-bsx-f="act"[\s\S]*?<b data-to="2"/.test(k), k.slice(0, 900));
    ok('Act now: the needs-action families by money at risk — Big Tablecloth ($1,600) before Pillow Insert ($800)', res.act3.map(r => r.name).join() === 'Big Tablecloth,Pillow Insert' && res.act3[0].risk === 1600 && res.act3[1].risk === 800);
    ok('…each with ONE why from the facts and ONE action: Pillow Insert out of stock → "Restock"', (r => r.act === 'Restock' && r.why === 'Out of stock now')(res.act3[1]), JSON.stringify([res.act3[1].act, res.act3[1].why]));
    ok('Winning: the growing families by revenue gained (Stripe +$600)', res.win3.map(r => r.name).join() === 'Stripe Tablecloth' && res.win3[0].gain === 600 && ['Keep going', 'Raise budget', 'Reorder in time'].includes(res.win3[0].act));
    X.bsxDecision(res);
    const dec = X.el('bsxDec').innerHTML;
    ok('the two columns: 🔴 Act now (cards with "+ Task") and 🟢 Winning', /🔴 Act now/.test(dec) && /🟢 Winning/.test(dec) && (dec.match(/class="bsx-card is-act"/g) || []).length === 2 && /data-tk-new=/.test(dec) && /"src":"bsr"/.test(dec));
    const E = load();
    E.F.HEALTH.SP.rows = E.F.HEALTH.SP.rows.filter(r => !/Pillow Insert|Big Tablecloth/.test(r.title));
    Object.values(E.BSR.SP).forEach(wk => { Object.keys(wk).forEach(p => { if (/P2|P8/.test(p)) delete wk[p]; }); });
    const er = E.bsxComputeView();
    E.BSX.res = er;
    E.bsxDecision(er);
    ok('nothing needs action: "Nothing needs action this week ✅" and the story says so', /Nothing needs action this week ✅/.test(E.el('bsxDec').innerHTML) && /Nothing needs action\.$/.test(E.bsxStory(er, 'this week')));
  }

  console.log('== 6. chips, sort, search ==');
  {
    const X = load();
    X.BSX.res = X.bsxComputeView();
    X.bsxChipsPaint(X.BSX.res);
    const c = strip(X.el('bsxChips').innerHTML);
    ok('chips with counts: All 8 · 🟢 Growing 1 · 🟡 Check 1 · 🔴 Needs action 2 · ⚪ Busier 1 · Top 20 sellers 8', c === 'All 8 🟢 Growing 1 🟡 Check 1 🔴 Needs action 2 ⚪ Busier 1 Top 20 sellers 8', c);
    ok('default sort: Needs action first (by revenue at risk), then by revenue', X.bsxShown().slice(0, 3).map(r => r.name).join() === 'Big Tablecloth,Pillow Insert,Napkins Set' || X.bsxShown().slice(0, 2).map(r => r.name).join() === 'Big Tablecloth,Pillow Insert', X.bsxShown().map(r => r.name).join());
    X.BSX.f = 'grow';
    ok('chip 🟢 Growing: only those', X.bsxShown().every(r => r.verdict === 'grow') && X.bsxShown().length === 1);
    X.BSX.f = 'worse';
    ok('card "Ranking worse": only the families ranking worse', X.bsxShown().map(r => r.name).sort().join() === 'Big Tablecloth,Pillow Insert,Table Runner,Tiny Apron');
    X.BSX.f = ''; X.BSX.q = 'napkin';
    ok('search: "napkin" → Napkins Set', X.bsxShown().map(r => r.name).join() === 'Napkins Set');
    X.BSX.q = ''; X.BSX.sort = { k: 'revenue', dir: -1 };
    const rv = X.bsxShown().map(r => r.sA);
    ok('sort by Revenue (biggest first)', rv.every((v, i) => !i || rv[i - 1] >= v));
    X.BSX.sort = { k: 'rank', dir: 1 };
    const rk = X.bsxShown().filter(r => r.r && r.r.a > 0).map(r => r.r.a);
    ok('sort by Rank: the best (lowest number) first', rk.every((v, i) => !i || rk[i - 1] <= v));
    X.BSX.sort = { k: 'default', dir: 1 };
    X.bsxTablePaint();
    const t = X.el('bsxTable').innerHTML;
    ok('the table: Family · Rank · Orders · Revenue · Avg price · Verdict; rows focusable (↑↓ + Enter), Family pinned, numbers right-aligned', /Family.*Rank.*Orders.*Revenue.*Avg price.*Verdict/.test(strip(t.slice(0, t.indexOf('</thead>'))))
      && /<tr tabindex="0" data-bsx-row="SP\|/.test(t) && /<td class="bsx-fz">/.test(t) && /<td class="num"><b>/.test(t) && /🔴 Needs action/.test(t));
    X.BSX.limit = 3; X.bsxTablePaint();
    ok('25 rows then "Show more" (here 3: "Show more (5 left)")', /Show more \(5 left\)/.test(X.el('bsxMore').innerHTML) && (X.el('bsxTable').innerHTML.match(/data-bsx-row=/g) || []).length === 3);
  }

  console.log('== 7. the side panel ==');
  {
    const X = load();
    X.BSX.res = X.bsxComputeView();
    const key = X.BSX.res.act3[0].key;
    X.bsxPanelOpen(key);
    const p = X.el('bsxPanel');
    ok('a row opens the panel: the family, brand, verdict, rank (Amazon-style); the ✕ (Close, Esc)', !p.hidden && /Big Tablecloth/.test(p.innerHTML) && /🔴 Needs action/.test(p.innerHTML) && /<b>#9,800<\/b> in Tablecloths/.test(p.innerHTML) && /<button type="button" class="bsx-x" data-bsx-act="close" aria-label="Close \(Esc\)">✕<\/button>/.test(p.innerHTML));
    ok('…chart (rank + weekly revenue), "Why it moved", "What to do" with "+ Task", Open in Listing Health / Sales Alerts, the sizes table', /id="bsxChart"/.test(p.innerHTML) && /Why it moved/.test(p.innerHTML) && /What to do/.test(p.innerHTML) && /data-tk-new=/.test(p.innerHTML)
      && /Open in Listing Health/.test(p.innerHTML) && /Open in Sales Alerts/.test(p.innerHTML) && /<table class="bsx-kids">/.test(p.innerHTML));
    X.bsxPanelClose();
    ok('closes: hidden again, empty', p.hidden && p.innerHTML === '');
    ok('the ✕ always on screen: the header is sticky; the panel starts below the menu bar (--bsx-top); Esc and an outside click close it; a phone gets a bottom sheet',
      /#bsxPanel \.bsx-ph \{ position: sticky; top: 0;/.test(CSS) && /#bsxPanel \{ position: fixed; top: var\(--bsx-top, 0px\);/.test(CSS) && /e\.key === 'Escape' && BSX\.panel/.test(SRC('bsr-decide.js'))
      && /!on\('#bsxPanel'\)/.test(SRC('bsr-decide.js')) && /@media \(max-width: 700px\)[\s\S]*?#bsxPanel \{ top: auto; left: 0; width: 100%; max-height: 88vh;/.test(CSS));
    const P1 = load();
    P1.BSX.res = P1.bsxComputeView();
    const kids = P1.bsxKids(P1.BSX.res.rows.find(r => r.name === 'Stripe Tablecloth'));
    ok('sizes: each child\'s rank, orders, revenue, change, verdict — the best one marked', kids.length === 2 && kids[0].ra > 0 && kids[0].uA === 78 && kids.some(k => k.best), JSON.stringify(kids.map(k => [k.name, k.ra, k.uA, k.sA, k.verdict, !!k.best])));
  }

  console.log('== 8. ✨ off, the CSV, read-only, the engine underneath ==');
  {
    const X = load({ fx: false });
    X.BSX.res = X.bsxComputeView();
    X.bsxKpis(X.BSX.res);
    ok('✨ off: no count-up (no animation frame asked for) — the numbers are written once, final', X.raf.length === 0 && X.bsxFx() === false && /\$13,700/.test(X.el('bsxKpis').innerHTML));
    const Y = load();
    Y.BSX.res = Y.bsxComputeView();
    Y.bsxKpis(Y.BSX.res);
    ok('✨ on: the numbers count up once (an animation frame), the second paint does not', Y.raf.length === 1 && (Y.bsxKpis(Y.BSX.res), Y.raf.length === 1));
    const csv = Y.bsxCsv();
    const lines = csv.text.split('\r\n');
    ok('CSV: rank both periods, change, orders, revenue, changes, verdict, why, action, the periods (Excel-ready: BOM, CRLF)', /^﻿Brand,Family \(parent\),Name,Sizes,Category,Rank now,Rank before,Rank change,Rank change %,Main rank now,Main category,Orders now,Orders before,Orders change %,Revenue now,Revenue before,Revenue change,Revenue change %,Avg price,Verdict,Why,Suggested action,Period now,Period before,Rank weeks$/.test(lines[0])
      && lines.some(l => /^Ridhi,B0P8PARENT,Big Tablecloth,1,Tablecloths,9800,7000,2800,40%,147000,Home & Kitchen,120,200,-40%,2400\.00,4000\.00,-1600\.00,-40%,20\.00,Needs action,Worse by 40% — nothing known explains it,Watch,2026-11-22 to 2026-11-26,2026-11-15 to 2026-11-19,2026-W48 vs 2026-W47$/.test(l)), lines.slice(0, 3).join('\n'));
    const dec = SRC('bsr-decide.js');
    ok('read-only: the page calls no Amazon / backend / database write (no baCall, setDoc, fetch, imPost, lfix)', !/\b(baCall|setDoc|deleteDoc|fetch|imPost|lmNet)\(|lfix/.test(dec));
    // the engine: the Compare rows built by bsrBuildRows are the very rows renderBsr (the old table) shows
    const Z = load();
    Z.setMode('history');
    Z.el('bWeekA').value = '2026-W48'; Z.el('bWeekB').value = '2026-W47'; Z.el('bBrandView').value = 'SP';
    const built = Z.bsrBuildRows(['SP'], '2026-W48', '2026-W47').all;
    ok('the engine underneath is the existing one: bsrBuildRows = the rows the Compare table decided on (action, move, risk, priority) for the same weeks', built.length === 8 && built.every(r => r.decision && r.prio && 'risk' in r)
      && built.find(r => r.parent.startsWith('B0P2')).action === 'Restock first' && built.find(r => r.parent.startsWith('B0P6')).action === 'Check category');
    ok('the decision page only reads the existing decision (bsrDecide / bsrFacts are never redefined in bsr-decide.js)', !/function bsr(Decide|Facts|FactList|Move|Used|AtRisk|Priority|CatTrend)\b/.test(dec));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
