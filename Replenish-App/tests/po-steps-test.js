/* PO — 10 steps (src/app/orders/po-steps.js): each step's figure per PO, the two ticks, and where a PO is stuck.
 *   node tests/po-steps-test.js */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'orders', 'po-steps.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const V = { 'SO-1|A': { given: 10, back: 6 }, 'SO-2|C': { given: 5, back: 5 } };
const Q = { 'SO-1|A': { ok: 2 }, 'SO-2|C': { ok: 5 }, 'SO-2|D': { ok: 8 } };
const G = { 'SO-2|C': { in: 5 }, 'SO-2|D': { in: 8 } };
function load(opts) {
  const els = {}, el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', className: '', addEventListener() {}, querySelector: () => null, insertBefore() {}, firstChild: null });
  const ctx = {
    $: el, document: { createElement: () => ({}) }, localStorage: { getItem: () => (opts && opts.on ? '1' : null) }, location: { hostname: 'fabricrush-replenish.web.app' },
    ordVendorOf: (o, s) => V[o + '|' + s] || null, ordQcOf: (o, s) => Q[o + '|' + s] || null, ordFgAt: (o, s) => G[o + '|' + s] || null,
    ordWaitingAt: r => r.waiting || '', ordSrcOf: no => (/^SHP/.test(no) ? 'Shopify' : 'B2B'),
    ptGet: async () => (opts && opts.ticks) || {}, ptPatch: async () => {}, ptOpenDialog: () => {}, nf: n => String(n), esc: s => String(s == null ? '' : s),
    ordLines: () => [], ordApply: x => x, ordFilters: () => ({}), ORD: {}, ORD_KPI: '', ordKpiCard: () => '', ME: { email: 't' }, dToday: () => '2026-10-10',
  };
  return new Function(...Object.keys(ctx), SRC + '\n;return { POS_ON, POS_STEPS, posLine, posRows, posKey };')(...Object.values(ctx));
}

const lines = [
  // SO-1: a printed, cut line half way; and an unprinted, uncut line not started
  { orderNo: 'SO-1', orderDate: '2026-10-01', sku: 'A', qty: 10, cutReq: true, cut: 4, issued: 3, received: 2, open: true },
  { orderNo: 'SO-1', orderDate: '2026-10-01', sku: 'B', qty: 5, cutReq: false, cut: 0, issued: 0, received: 0, open: true },
  // SO-2: everything done
  { orderNo: 'SO-2', orderDate: '2026-10-03', sku: 'C', qty: 5, cutReq: true, cut: 5, issued: 5, received: 5, open: false },
  { orderNo: 'SO-2', orderDate: '2026-10-03', sku: 'D', qty: 8, cutReq: false, cut: 0, issued: 8, received: 8, open: false },
  // SHP-9: Shopify, handed to shipping
  { orderNo: 'SHP-9', orderDate: '2026-10-05', sku: 'E', qty: 2, cutReq: false, issued: 2, received: 2, open: false, handedAt: '2026-10-06' },
  // SO-3: a line waiting at the vendor with nothing given yet still counts as printed
  { orderNo: 'SO-3', orderDate: '2026-10-07', sku: 'F', qty: 4, cutReq: true, cut: 0, issued: 0, received: 0, open: true, waiting: 'Vendor — not given yet' },
];

console.log('== off on the live app, on for a test link ==');
ok('the live host does not offer the view', load().POS_ON === false);
ok('localStorage poSteps = 1 turns it on', load({ on: true }).POS_ON === true);
ok('ten steps, in the document\'s order', load().POS_STEPS.map(s => s.k).join() === 'po,ppc,demand,vendor,fabric,cut,cutstore,raw,wip,india');

console.log('== one line ==');
const A = load();
const a = A.posLine(lines[0]);
ok('printed line: vendor 10/10, fabric back 6/10', a.vendor.need === 10 && a.vendor.done === 10 && a.fabric.done === 6);
ok('cutting 4/10, the same at cut → store', a.cut.done === 4 && a.cutstore.done === 4);
ok('raw in store = cut − issued = 1', a.raw.now === 1);
ok('WIP is done when QC has passed: 2 of 10 (issued 3, received 2)', a.wip.done === 2 && a.wip.issued === 3 && a.wip.received === 2);
const b = A.posLine(lines[1]);
ok('an unprinted, uncut line: vendor, fabric and cutting are n/a', b.vendor.need === 0 && b.fabric.need === 0 && b.cut.need === 0);
ok('a line waiting at the vendor with nothing given is still a printed line', A.posLine(lines[5]).vendor.need === 4 && A.posLine(lines[5]).vendor.done === 0);
ok('a Shopify line handed to shipping is in India stock in full', A.posLine(lines[4]).india.done === 2);
ok('figures never exceed the line (an over-recorded register is capped)', A.posLine(Object.assign({}, lines[0], { cut: 99 })).cut.done === 10);

console.log('== per PO, and where it is stuck ==');
let rows = A.posRows(lines, {});
const by = no => rows.find(o => o.orderNo === no);
ok('SO-1 adds its two lines: 15 pieces', by('SO-1').s.po.need === 15 && by('SO-1').lines === 2);
ok('SO-1 is stuck at PPC until it is ticked', A.POS_STEPS[by('SO-1').at].k === 'ppc');
ok('SO-1 demand counts as raised on its own (its only printed line is fully given)', by('SO-1').s.demand.done === 1 && by('SO-1').s.demand.auto === true);
ok('SO-3 demand is NOT raised on its own (nothing given yet)', by('SO-3').s.demand.done === 0);
rows = A.posRows(lines, { 'SO-1': { ppc: { date: '2026-10-02' } } });
ok('ticked PPC moves SO-1 on to the first real gap: fabric back 6 of 10', A.POS_STEPS[by('SO-1').at].k === 'fabric', A.POS_STEPS[by('SO-1').at] && A.POS_STEPS[by('SO-1').at].k);
rows = A.posRows(lines, { 'SO-2': { ppc: { date: 'x' } } });
ok('SO-2 with PPC ticked and everything recorded: all ten done', by('SO-2').at === A.POS_STEPS.length, String(by('SO-2').at));
ok('SO-2 India stock 13 of 13', by('SO-2').s.india.done === 13 && by('SO-2').s.india.need === 13);
ok('an order key with a dot is safe for the database', A.posKey('SO-1.2/3') === 'SO-1_2_3');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
