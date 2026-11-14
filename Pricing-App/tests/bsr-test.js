/* BSR Audit (src/app/listing/bsr-audit.js) — the real file in a stub page.
 *   node tests/bsr-test.js
 * The sub-category rank decides · the noise band never says Deal · priority by money at stake · the root cause picks the action
 * from each fact · the category trend · unknown data is never used · the facts from the other screens' data (units, price, deals,
 * ad spend, Buy Box, stock, status, our changes) · the table, the cards, Export · daily snapshots + the 7-day average · the
 * action follow-up · the child view and the chart · the snapshot keeps children, price and stock. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'bsr-audit.js'), 'utf8');
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function load(opts) {
  const o = opts || {};
  const els = {};
  const cl = init => { const s = new Set(init || []); return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => ((on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c)) }; };
  const $ = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', hidden: false, className: '', dataset: {}, style: { setProperty() {} }, classList: cl(),
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, closest: () => ({ classList: cl() }), setAttribute() {} });
  const docs = Object.assign({}, o.docs || {});
  const writes = [];
  const ctx = {
    $, document: { querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => ({ click() {} }) }, window: undefined,
    CSS: { escape: s => s }, getComputedStyle: () => ({ position: 'static' }), Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, H_PAGE: 300, H_SWEEP_PAR: 3, H_LOADED: true, HEALTH: o.HEALTH || { SP: { rows: [] }, CPC: { rows: [] } },
    baCall: o.baCall || (async () => ({ map: {} })), db: {}, doc: (d, c, id) => ({ path: c + '/' + id }), serverTimestamp: () => 'ts',
    getDoc: async ref => ({ exists: () => ref.path in docs, data: () => docs[ref.path] }), setDoc: async (ref, data, opt) => { writes.push({ path: ref.path, data, opt }); docs[ref.path] = opt && opt.merge ? Object.assign({}, docs[ref.path] || {}, data) : data; },
    loadParentNames: async () => {}, loadHealthCache: async () => {}, hCtx: () => ({}),
    lrPictures: (row) => (o.gaps && o.gaps.includes(row.sku) ? { main: '' } : { main: 'x' }), lrAplus: () => ({ v: true }),
    parentName: (b, a) => 'Name of ' + a, parentNameCell: (b, a, t) => `<span data-pname="${b}|${a}">${t}</span>`, wireParentNameCells() {},
    WEEKLY: o.WEEKLY || { rows: {} }, loadWeekly: async () => {}, D_HDA: o.D_HDA || [], D_PLAN: o.D_PLAN || {}, dPlanSpan: (w, p) => ({ start: (p && p.s) || w, end: o.planEnd || w }),
    loadDeals: async () => {}, AMZ: { map: o.AMZ || new Map() }, amzEnsure: async () => {}, LH: { rows: o.LH || [], err: '', f: {} }, lhLoad: async () => o.LH || [],
    lhWhat: row => row.field || 'Title', showTab() {}, ME: { email: 'v@x.com', tabs: ['bsr'] }, API: { url: 'x' },
    setInterval: () => 0, clearInterval() {}, setTimeout: (fn) => 0, clearTimeout() {},
  };
  const names = ['bsrUsed', 'bsrMove', 'bsrNoise', 'bsrDecide', 'bsrAtRisk', 'bsrPriority', 'bsrCatTrend', 'bsrSortRisk', 'bsrFactList', 'bsrFacts', 'bsrUnknown', 'bsrSalesWeek',
    'bsrMonday', 'bsrWeeksApart', 'bsrBest', 'bsrCollect', 'bsrDailyDue', 'bsrAvgEntry', 'bsrWeekEntries', 'bsrFollow', 'bsrActsRemember', 'bsrChartSvg', 'bsrKids', 'renderBsr',
    'bsrPanelOpen', 'bsrPanelDraw', 'isoWeek', 'bsrLoadSources', 'renderBsrHistory'];
  const tail = '\n;return {' + names.join(',') + ', BSR, BSR_WEEKS, BSR_SRC, BSR_DAYDOC, setDays: d => { BSR_DAYS = d; }, getRender: () => BSR_RENDER, setActs: a => { BSR_ACTS = a; }, getActs: () => BSR_ACTS, setCard: c => { BSR_CARD = c; }, setHistKind: k => { BSR_HIST_KIND = k; } };';
  const api = new Function(...Object.keys(ctx), SRC + tail)(...Object.values(ctx));
  return Object.assign(api, { $, docs, writes, ctx });
}

(async () => {
  const B = load();
  console.log('== 1. the SUB-CATEGORY rank decides; main is a reference ==');
  {
    const u = B.bsrUsed({ rank: 5000, cat: 'Home', sub: 1020, subCat: 'Bath Towels' }, { rank: 4000, cat: 'Home', sub: 1000, subCat: 'Bath Towels' });
    ok('both weeks have a sub rank → it is used (1,000 → 1,020, Bath Towels)', u.kind === 'sub' && u.a === 1020 && u.b === 1000 && u.cat === 'Bath Towels');
    const d = B.bsrDecide({ a: 1020, b: 1000, kind: 'sub', main: 5000, sub: 1020, facts: {} });
    ok('main moved +25% but the sub rank only +2% → Stable (decided on the sub rank)', d.action === 'Stable', d.action);
    const m = B.bsrUsed({ rank: 9000, cat: 'Home', sub: 0 }, { rank: 6000, cat: 'Home', sub: 0 });
    ok('no sub-category rank → the main rank is used (and the kind says "main")', m.kind === 'main' && m.a === 9000 && m.cat === 'Home');
    const c = B.bsrDecide({ a: 1500, b: 1000, kind: 'sub', catChanged: true, facts: {} });
    ok('category changed between the weeks → "Check category"', c.action === 'Check category');
  }

  console.log('== 2. noise filter ==');
  {
    ok('a move needs BOTH 10% and a real distance: 30 → 40 in a sub-category (+33%, 10 places) is Stable', B.bsrMove(40, 30, 'sub') === 'stable' && B.bsrMove(600, 500, 'sub') === 'worse' && B.bsrMove(540, 500, 'sub') === 'stable');
    const d = B.bsrDecide({ a: 30000, b: 21000, kind: 'sub', main: 450000, sub: 30000, facts: { price: { a: 20, b: 15 }, deal: { ended: ['PED 20%'], started: [] } } });
    ok('low seller (main 450,000 / sub 30,000) with price up and a deal ended → "Watch", never "Deal / price check"', d.action === 'Watch' && d.noise === true && /Low seller/.test(d.short), d.action);
    const oos = B.bsrDecide({ a: 30000, b: 21000, kind: 'sub', main: 450000, sub: 30000, facts: { qty: 0 } });
    ok('…but out of stock still says "Restock first"', oos.action === 'Restock first');
  }

  console.log('== 4. the root cause: the action from the strongest fact ==');
  {
    const r = facts => B.bsrDecide({ a: 1300, b: 1000, kind: 'sub', main: 9000, sub: 1300, facts });
    const cases = [
      [{ qty: 0, ads: { a: 10, b: 50 } }, 'Restock first'],
      [{ status: { sup: 2, nobuy: false, n: 6 } }, 'Fix the listing'],
      [{ status: { sup: 0, nobuy: true, n: 6 } }, 'Fix the listing'],
      [{ deal: { ended: ['PED 20% (to 2026-11-02)'], started: [] } }, 'Deal / price check'],
      [{ price: { a: 24.99, b: 19.99 } }, 'Deal / price check'],
      [{ buybox: { a: 60, b: 98, lost: true } }, 'Deal / price check'],
      [{ ads: { a: 30, b: 100 } }, 'Review PPC'],
      [{ changes: [{ at: Date.UTC(2026, 10, 8), who: 'Vansh', what: 'title changed', sku: 'S1' }] }, 'Check our change'],
      [{ gaps: 2 }, 'Fix the listing'],
    ];
    cases.forEach(([f, want]) => { const d = r(f); ok(`${Object.keys(f).join('+')} → "${want}" (${d.short})`, d.action === want, d.action); });
    ok('ad spend down: the reason names the numbers ("Ad spend fell 70% ($100 → $30)")', /Ad spend fell 70% \(\$100 → \$30\)/.test(r({ ads: { a: 30, b: 100 } }).short));
    ok('our change: "title changed 8 Nov by Vansh"', /title changed 8 Nov by Vansh/.test(r({ changes: [{ at: Date.UTC(2026, 10, 8, 12), who: 'Vansh', what: 'title changed', sku: 'S1' }] }).short));
    ok('nothing known, gradual 20% → "Review PPC"; nothing known, sharp 50% → "Watch"', B.bsrDecide({ a: 1200, b: 1000, kind: 'sub', facts: {} }).action === 'Review PPC'
      && B.bsrDecide({ a: 1500, b: 1000, kind: 'sub', facts: {} }).action === 'Watch');
    ok('better by 20% → "Working — hold"; a price DROP is not a reason for a deal', B.bsrDecide({ a: 800, b: 1000, kind: 'sub', facts: {} }).action === 'Working — hold'
      && r({ price: { a: 15, b: 20 } }).action === 'Review PPC');
  }

  console.log('== unknown data is never used ==');
  {
    const d = B.bsrDecide({ a: 1300, b: 1000, kind: 'sub', facts: { qty: null, status: null, deal: null, price: { a: null, b: 19.99 }, ads: null, units: null } });
    ok('stock / status / deals / ads not known, price known for one week only → none of them is a reason ("Review PPC" from the shape only)', d.action === 'Review PPC' && d.facts.length === 0);
    ok('money at stake with units not known → null (not 0)', B.bsrAtRisk({ move: 'worse', pct: 0.3, facts: { units: null, price: { a: 20, b: 20 } } }) === null);
    ok('the panel lists what is not known', B.bsrUnknown({ units: null, price: null, deal: null, ads: null, qty: null, status: null, buybox: null, changes: null }).join() === 'Units sold,Price change,Deals / coupons,Ad spend,Stock,Suppressed / not buyable,Buy Box,Rating / reviews,Our listing changes');
  }

  console.log('== 3. priority = money at stake ==');
  {
    const row = (id, units, price, pct, extra) => Object.assign({ id, move: 'worse', pct, action: 'Review PPC', noise: false, facts: { units: units == null ? null : { a: units, b: units }, price: price == null ? null : { a: price, b: price } } }, extra || {});
    const rows = [row('a', 10, 20, 0.5), row('b', 100, 25, 0.2), row('c', null, null, 0.9), row('d', null, null, 0.3), row('e', 2, 10, 0.15)];
    rows.forEach(r => { r.risk = B.bsrAtRisk(r); r.prio = B.bsrPriority(r); });
    rows.sort(B.bsrSortRisk);
    ok('order: b ($500 at stake) · a ($100) · e ($3) · then unknown units by %: c (90%) · d (30%)', rows.map(r => r.id).join('') === 'baecd', rows.map(r => r.id + ':' + r.risk).join(' '));
    ok('priority: b High ($500), a High ($100), e Low ($3); unknown sales by %: c High, d High (by %)', rows.map(r => r.prio.p).join() === 'High,High,Low,High,High' && rows[3].prio.by === 'pct');
  }

  console.log('== 5. category trend ==');
  {
    const mk = (id, move, cat) => ({ id, kind: 'sub', cat, move, pct: 0.3, action: 'Review PPC', noise: false, risk: 200, facts: {} });
    const rows = [mk(1, 'worse', 'Bath Towels'), mk(2, 'worse', 'Bath Towels'), mk(3, 'worse', 'Bath Towels'), mk(4, 'stable', 'Bath Towels'), mk(5, 'worse', 'Napkins'), mk(6, 'better', 'Napkins'), mk(7, 'stable', 'Napkins')];
    B.bsrCatTrend(rows);
    ok('3 of 4 Bath Towels parents worse (75%) → marked "whole category moved"; Napkins (1 of 3) not', rows.slice(0, 3).every(r => r.catMoved === 'worse') && !rows[3].catMoved && !rows[4].catMoved);
    rows.forEach(r => { r.prio = B.bsrPriority(r); });
    ok('…their priority is one step lower (High → Medium)', rows[0].prio.p === 'Medium' && rows[4].prio.p === 'High');
  }

  console.log('== the facts from the other screens\' data ==');
  {
    ok('ISO 2026-W45 (Mon 2 Nov) is matched with the sales week starting Sun 1 Nov', B.bsrSalesWeek('2026-W45') === '2026-11-01' && B.isoWeek(new Date(2026, 10, 2)) === '2026-W45');
    const HEALTH = { SP: { rows: [{ sku: 'S1', asin: 'C1', parent: 'P1', qty: 0, price: 20 }, { sku: 'S2', asin: 'C2', parent: 'P1', qty: 0, price: 22 }] }, CPC: { rows: [] } };
    const WEEKLY = { rows: { C1: { weeks: { '2026-11-01': { u: 40, rev: 800, spend: 30, bbv: 60, pv: 100 }, '2026-10-25': { u: 60, rev: 1200, spend: 100, bbv: 98, pv: 100 } } },
      C2: { weeks: { '2026-11-01': { u: 10, rev: 220, spend: 0 }, '2026-10-25': { u: 10, rev: 220, spend: 0 } } } } };
    const LH = [{ sku: 'S1', at: Date.UTC(2026, 10, 3), name: 'Vansh', field: 'Title', result: 'accepted' }, { sku: 'S1', at: Date.UTC(2026, 9, 1), name: 'X', field: 'Title', result: 'accepted' },
      { sku: 'S2', at: Date.UTC(2026, 10, 4), name: 'Y', field: 'Bullets', result: 'rejected' }];
    const D_HDA = [{ asin: 'C2', t: 'PED', v: 20, s: '2026-10-26', e: '2026-11-01' }];
    const AMZ = new Map([['SP|S1', { st: 'BUYABLE,DISCOVERABLE' }], ['SP|S2', { st: 'BUYABLE,DISCOVERABLE' }]]);
    const F = load({ HEALTH, WEEKLY, LH, D_HDA, AMZ });
    Object.assign(F.BSR_SRC, { weekly: 'ok', deals: 'ok', amz: 'ok', lh: 'ok' });
    const f = F.bsrFacts('SP', 'P1', '2026-W45', '2026-W44', { entryA: null, entryB: null, latest: true, gaps: 0 });
    ok('units: 70 → 50 (summed over the children, sales weeks 25 Oct and 1 Nov)', f.units && f.units.b === 70 && f.units.a === 50, JSON.stringify(f.units));
    ok('price: the average selling price that week ($20.29 → $20.40)', f.price && f.price.b === 20.29 && f.price.a === 20.4, JSON.stringify(f.price));
    ok('ad spend: $100 → $30; Buy Box share of page views 98% → 60% = lost', f.ads.b === 100 && f.ads.a === 30 && f.buybox.lost && f.buybox.a === 60 && f.buybox.b === 98);
    ok('deal: PED 20% covered week W44 (26 Oct – 1 Nov) and not W45 → "ended"', f.deal.ended.length === 1 && /PED 20%/.test(f.deal.ended[0]) && !f.deal.started.length);
    ok('stock: 0 now (week A is the latest snapshot) — status buyable', f.qty === 0 && f.status && !f.status.sup && !f.status.nobuy);
    ok('our changes: the title sent 3 Nov (a rejected one and one from October are not counted)', f.changes.length === 1 && /title changed/.test(f.changes[0].what) && f.changes[0].who === 'Vansh');
    const old = F.bsrFacts('SP', 'P1', '2026-W45', '2026-W44', { entryA: null, entryB: null, latest: false, gaps: 3 });
    ok('week A is NOT the latest snapshot → stock, status and content gaps are not known (the "now" values are not used for the past)', old.qty === null && old.status === null && old.gaps === null);
    const snapQ = F.bsrFacts('SP', 'P1', '2026-W45', '2026-W44', { entryA: { q: 25 }, entryB: null, latest: false });
    ok('…but a snapshot that kept its own stock (q) is used', snapQ.qty === 25);
    Object.assign(F.BSR_SRC, { weekly: 'no', deals: 'no', amz: 'no', lh: 'no' });
    const none = F.bsrFacts('SP', 'P1', '2026-W45', '2026-W44', { latest: true });
    ok('a source that could not be read → not known (units, price, ads, Buy Box, deals, status, changes all null)', !none.units && !none.price && !none.ads && !none.buybox && !none.deal && !none.status && !none.changes);
  }

  console.log('== the screen: cards, table, Export ==');
  {
    const HEALTH = { SP: { rows: [{ sku: 'A1', asin: 'CA1', parent: 'PA', qty: 5 }, { sku: 'A2', asin: 'CA2', parent: 'PA', qty: 3 }, { sku: 'B1', asin: 'CB1', parent: 'PB', qty: 0 },
      { sku: 'N1', asin: 'CN1', parent: 'PN', qty: 9 }] }, CPC: { rows: [] } };
    const R = load({ HEALTH, WEEKLY: { rows: { CA1: { weeks: { '2026-11-01': { u: 30, rev: 600 }, '2026-10-25': { u: 40, rev: 800 } } } } } });
    Object.assign(R.BSR_SRC, { weekly: 'ok', deals: 'no', amz: 'no', lh: 'no' });
    R.BSR_WEEKS.SP = ['2026-W44', '2026-W45'];
    R.BSR.SP['2026-W44'] = { PA: { rank: 9000, cat: 'Home', sub: 1000, subCat: 'Bath Towels', n: 2, k: { CA1: [9000, 1000], CA2: [12000, 1400] } }, PB: { rank: 8000, cat: 'Home', sub: 900, subCat: 'Bath Towels' },
      PN: { rank: 400000, cat: 'Home', sub: 25000, subCat: 'Napkins' } };
    R.BSR.SP['2026-W45'] = { PA: { rank: 9100, cat: 'Home', sub: 1300, subCat: 'Bath Towels', n: 2, k: { CA1: [9100, 1300], CA2: [12100, 1450] } }, PB: { rank: 9000, cat: 'Home', sub: 1200, subCat: 'Bath Towels' },
      PN: { rank: 600000, cat: 'Home', sub: 40000, subCat: 'Napkins' } };
    R.$('bBrandView').value = 'SP'; R.$('bWeekA').value = '2026-W45'; R.$('bWeekB').value = '2026-W44'; R.$('bMoveView').value = 'ALL'; R.$('bFilter').value = '';
    R.setActs({ SP: {}, CPC: {} });
    R.renderBsr();
    const t = R.$('bTable').innerHTML;
    const k = R.$('bKpis').innerHTML;
    ok('6 number cards: Got worse · Improved · Need action · Low seller (noise) · Category moved · Stable', (k.match(/data-bs-card="(\w+)"/g) || []).map(s => s.slice(14, -1)).join() === 'worse,better,action,noise,cat,stable');
    ok('columns: Parent · Name · Sub cat. · Rank W44 → W45 · Change · % · Main rank · Priority · Suggested action', strip(t.match(/<thead>.*<\/thead>/s)[0]).replace(/ [↓↑]/g, '') === 'Parent Name Sub cat. Rank 2026-W44 → 2026-W45 Change % Main rank Priority Suggested action', strip(t.match(/<thead>.*<\/thead>/s)[0]));
    const rows = R.getRender().rows;
    ok('PA: sub 1,000 → 1,300 (+30%) — money known (30 × $20 × 30% = $180) → High, first', rows[0].parent === 'PA' && rows[0].prio.p === 'High' && Math.round(rows[0].risk) === 180, rows.map(r => r.parent + ':' + r.risk).join(' '));
    ok('PB: out of stock now → "Restock first"; PN: low seller → "Watch", its % greyed, priority Low, sorted after the real drops', rows.find(r => r.parent === 'PB').action === 'Restock first' && rows.find(r => r.parent === 'PN').action === 'Watch'
      && /data-bs-key="SP\|PN".*?color:var\(--faint\)">\+60%/s.test(t) && rows.find(r => r.parent === 'PN').prio.p === 'Low' && rows[rows.length - 1].parent === 'PN', rows.map(r => r.parent + ':' + r.prio.p).join(' '));
    ok('main rank shown grey, for reference only', /class="bs-grey"[^>]*>#9,100/.test(t));
    const exp = R.getRender().defs.map(d => d.t);
    ok('Export has the new columns: Priority, Suggested action, Why (facts), Money at stake, Main cat., Last action', ['Priority', 'Suggested action', 'Why (facts)', 'Money at stake a week', 'Main cat.', 'Last action'].every(x => exp.includes(x)));
    ok('…Why (facts) for PA names the numbers ("Units sold 40 → 30 (−25%)")', R.getRender().defs.find(d => d.k === 'why').text(rows[0]).includes('Units sold 40 → 30 (−25%)'));
    R.setCard('noise');
    R.renderBsr();
    ok('the "Low seller (noise)" card filters the table to PN only', R.getRender().rows.map(r => r.parent).join() === 'PN');
    R.setCard('');
    ok('this week\'s actions are remembered for the follow-up (PA: Restock / PPC etc., with the rank)', R.getActs().SP.PA && R.getActs().SP.PA[0].w === '2026-W45' && R.getActs().SP.PA[0].v === 1300);
    // the side panel
    R.renderBsr();
    await R.bsrPanelOpen('SP', 'PA');
    const p = R.$('bPanel').innerHTML;
    ok('side panel: every child\'s rank W44 → W45, the falling one first (CA1 1,000 → 1,300)', /bs-kids/.test(p) && p.indexOf('A1') < p.indexOf('A2') && /#1,000.*#1,300/s.test(p));
    ok('…the facts and what is not known (Deals / coupons: not known), links to Workspace / Image Manager / Listing Errors / Listing History', /Units sold 40 → 30/.test(p) && /Deals \/ coupons: not known/.test(p)
      && ['ws', 'img', 'lerr', 'lhist'].every(x => p.includes(`data-bs="${x}"`)));
  }

  console.log('== 6. the chart, the child view ==');
  {
    const svg = B.bsrChartSvg([{ w: 'W40', v: 500 }, { w: 'W41', v: 800 }, { w: 'W42', v: null }, { w: 'W43', v: 300 }], 'sub-category rank');
    const ys = [...svg.matchAll(/<circle class="pt" cx="[\d.]+" cy="([\d.]+)"/g)].map(m => +m[1]);
    ok('lower rank = better is at the TOP (rank 300 drawn above 500, 500 above 800); a week with no snapshot is a gap', ys[2] < ys[0] && ys[0] < ys[1] && /better \(lower rank\)/.test(svg) && ((svg.match(/d="([^"]*)"/) || ['', ''])[1].match(/M/g) || []).length === 2);
    ok('fewer than 2 weeks → says so instead of a line', /Not enough weeks/.test(B.bsrChartSvg([{ w: 'W1', v: 5 }], 'x')));
  }

  console.log('== 8. daily snapshot + 7-day average ==');
  {
    const today = '2026-11-14';
    ok('due when today is missing for a brand and no other browser holds a fresh lock', B.bsrDailyDue({ SP: [], CPC: [] }, today, 1e12, 'me') === true);
    ok('…not when both brands have today', B.bsrDailyDue({ SP: [today], CPC: [today] }, today, 1e12, 'me') === false);
    ok('…not when another browser locked it 5 minutes ago; yes when that lock is 20 minutes old', B.bsrDailyDue({ SP: [], CPC: [], lock: { day: today, by: 'other', at: 1e12 - 5 * 60000 } }, today, 1e12, 'me') === false
      && B.bsrDailyDue({ SP: [], CPC: [], lock: { day: today, by: 'other', at: 1e12 - 20 * 60000 } }, today, 1e12, 'me') === true);
    const D = load();
    D.setDays({ SP: ['2026-11-02', '2026-11-03', '2026-11-04'], CPC: [] });
    D.BSR_DAYDOC['SP__2026-11-02'] = { P: { rank: 1000, sub: 100, cat: 'H', subCat: 'T' } };
    D.BSR_DAYDOC['SP__2026-11-03'] = { P: { rank: 2000, sub: 200, cat: 'H', subCat: 'T' } };
    D.BSR_DAYDOC['SP__2026-11-04'] = { P: { rank: 3000, sub: 300, cat: 'H', subCat: 'T' } };
    D.BSR.SP['2026-W45'] = { P: { rank: 9999, sub: 999 } };
    const w = D.bsrWeekEntries('SP', '2026-W45');
    ok('3 daily snapshots in W45 → the week is judged on their average (rank 2,000, sub 200), not the weekly 9,999', w.days === 3 && w.r.P.rank === 2000 && w.r.P.sub === 200 && w.r.P.avg === 3);
    D.setDays({ SP: ['2026-11-02', '2026-11-03'], CPC: [] });
    ok('…only 2 days → the weekly snapshot', D.bsrWeekEntries('SP', '2026-W45').r.P.rank === 9999);
  }

  console.log('== 9. action follow-up ==');
  {
    const list = [{ w: '2026-W43', a: 'Deal / price check', v: 2000, kind: 'sub' }];
    ok('2 weeks later, 2,000 → 1,300: "Deal / price check (W43) → rank recovered 35%"', JSON.stringify(B.bsrFollow(list, '2026-W45', 1300, 'sub')) === JSON.stringify({ a: 'Deal / price check', w: 'W43', res: 'rank recovered 35%' }));
    ok('…2,000 → 2,050: "no change"; only 1 week later: nothing yet', B.bsrFollow(list, '2026-W45', 2050, 'sub').res === 'no change' && B.bsrFollow(list, '2026-W44', 1300, 'sub') === null);
  }

  console.log('== the snapshot keeps every child, the price and the stock ==');
  {
    const rows = [{ asin: 'C1', parent: 'P', price: 20, qty: 4 }, { asin: 'C2', parent: 'P', price: 30, qty: null }, { asin: 'C3', parent: 'P', price: 0, qty: 2 }];
    const best = B.bsrBest(rows, { C1: { rank: 5000, cat: 'Home', sub: 300, subCat: 'Towels' }, C2: { rank: 4000, cat: 'Home', sub: 250, subCat: 'Towels' } });
    ok('best child by main rank (C2 4,000, its sub 250 with it); every ranked child kept; avg price $25; stock 6 (unknown not counted)', best.P.rank === 4000 && best.P.sub === 250
      && JSON.stringify(best.P.k) === '{"C1":[5000,300],"C2":[4000,250]}' && best.P.p === 25 && best.P.q === 6 && best.P.n === 2);
  }

  console.log('== Full history: the sub-category rank by default, Main category on the toggle ==');
  {
    const Hs = load({ HEALTH: { SP: { rows: [] }, CPC: { rows: [] } } });
    Hs.BSR_WEEKS.SP = ['2026-W43', '2026-W44', '2026-W45'];
    Hs.BSR.SP['2026-W43'] = { PA: { rank: 9000, cat: 'Home', sub: 1000, subCat: 'Bath Towels' }, PB: { rank: 50000, cat: 'Home' } };
    Hs.BSR.SP['2026-W44'] = { PA: { rank: 9500, cat: 'Home', sub: 0 }, PB: { rank: 52000, cat: 'Home' } };
    Hs.BSR.SP['2026-W45'] = { PA: { rank: 9900, cat: 'Home', sub: 1300, subCat: 'Bath Towels' }, PB: { rank: 48000, cat: 'Home' } };
    Hs.$('bBrandView').value = 'SP'; Hs.$('bHistWeeks').value = '6'; Hs.$('bFilter').value = '';
    await Hs.renderBsrHistory();
    const t = Hs.$('bTable').innerHTML;
    const r = Hs.getRender();
    const pa = r.rows.find(x => x.parent === 'PA');
    const pb = r.rows.find(x => x.parent === 'PB');
    ok('default = sub-category rank: PA 1,000 · — · 1,300 (the week without a sub rank is "—", never the main 9,500)', pa.kind === 'sub' && pa.ranks['2026-W43'] === 1000 && !pa.ranks['2026-W44'] && pa.ranks['2026-W45'] === 1300
      && /Bath Towels/.test(t) && !/9,500/.test(t));
    ok('…Δ over the window on the sub rank: +300', pa.trend === 300);
    ok('PB has no sub-category rank → its main rank, tagged "main"', pb.kind === 'main' && pb.ranks['2026-W45'] === 48000 && /data-pname="SP\|PB".*?bs-tag[^>]*>main</s.test(t));
    ok('…Export says it: "Home (main — no sub-category rank)"', r.val(pb, r.defs.find(d => d.k === 'catShown')) === 'Home (main — no sub-category rank)' && r.val(pa, r.defs.find(d => d.k === 'w_2026-W45')) === 1300);
    ok('the card says which rank: "· sub-category rank"', /sub-category rank<\/span>/.test(Hs.$('bKpis').innerHTML));
    Hs.setHistKind('main');
    await Hs.renderBsrHistory();
    const m = Hs.getRender().rows.find(x => x.parent === 'PA');
    ok('toggle Main category: PA 9,000 · 9,500 · 9,900, column "Main cat."', m.kind === 'main' && m.ranks['2026-W44'] === 9500 && /Main cat\./.test(Hs.$('bTable').innerHTML) && /main-category rank/.test(Hs.$('bKpis').innerHTML));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
