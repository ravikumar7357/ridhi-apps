/* PPC → Report, the lines report on top (src/app/core/ppc-one.js p1RepPart, with flow-report.js's flowRepDash and columns).
 * Ravi, 25 Nov, with his ppc-report-2026-11-19-to-2026-11-25.xlsx: "I want the ppc report page to be in this pattern and also I
 * want it to be acurate in its report and also make it work in such a way its really impressive and show really good way of data".
 * The page's figures come from the same lines as the Excel; these checks pin the figures, the filters and the escaping.
 *   node tests/ppc-report-page-test.js      (PPC_ONE=<file> / FLOW_REPORT=<file> to test other copies) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ONE = process.env.PPC_ONE || path.join(__dirname, '..', 'src', 'app', 'core', 'ppc-one.js');
const REP = process.env.FLOW_REPORT || path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-report.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
function load(me) {
  const ctx = { obUC, esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])), nf: v => String(v),
    flowKey: (o, s) => obUC(o) + '__' + obUC(s), ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0, dToday: () => '2026-11-25',
    FLOW: { ppc: {}, res: {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse', ME: me || { admin: true, tabs: [] }, console, setTimeout: () => 0,
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, $: () => null, SOX: { rows: [] } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(REP, 'utf8') + '\n' + fs.readFileSync(ONE, 'utf8') + '\n;this.__t = { P1, p1RepPart, FLOW_REP_PLACES, flowRepDash };', ctx);
  ctx.p1Local = () => '2026-11-25';
  return ctx;
}
/** A made-up report line: the places given, the rest 0. */
function line(o, at) {
  const C = load(), a = {}; C.__t.FLOW_REP_PLACES.forEach(([k]) => { a[k] = 0; }); Object.assign(a, at);
  return Object.assign({ planned: '2026-11-20', orderNo: 'AMZ-1', orderDate: '2026-10-16', channel: 'Amazon', sku: 'S1', category: 'Pillow Cover', subCategory: '', parent: '', colour: '', size: '', fabric: '',
    pcs: 0, printedBy: '', completion: '2026-11-29', due: '2026-12-10', delay: '', late: 0, made: false, at: a, completed: a.done, moved: { day: '', step: '' }, process: '', rfd: '', plannedLate: 0 }, o);
}
const L1 = line({ sku: 'CPCC004', pcs: 224, due: '2026-10-25', late: 31, process: 'Karigar', plannedLate: 35 }, { kar: 4, recv: 28, press: 188, done: 4 });
const L2 = line({ sku: 'CPCC002-18', pcs: 22, process: 'Completed', made: true }, { done: 22 });
const L3 = line({ orderNo: 'SHP-9', channel: 'Shopify', sku: 'TC<b>1', category: 'Tablecloth', pcs: 50, process: 'RFD', rfd: 'On RFD' }, { rfd: 44, cut: 0, toCut: 2, done: 4 });
const lines = [L1, L2, L3];
const C = load(); C.p1RepLines = () => ({ lines, from: '2026-11-19', to: '2026-11-25', on: 'planned' });
const D = C.__t.flowRepDash(lines, '2026-11-25');
ok('the headline: 296 ordered, 30 completed, 1 late line with 220 pcs, 1 planned to finish after due', D.ordered === 296 && D.completed === 30 && D.late === 1 && D.latePcs === 220 && D.plannedLate === 1,
  JSON.stringify([D.ordered, D.completed, D.late, D.latePcs, D.plannedLate]));
ok('…where every piece is adds up to the 296 ordered', D.places.reduce((t, e) => t + e.pcs, 0) === 296, JSON.stringify(D.places.map(e => [e.k, e.pcs])));
let h = C.__t.p1RepPart();
ok('the page: Ordered 296 and Completed 30 (10%) in the headline', /<span>Ordered<\/span><b>296<\/b>/.test(h) && /<span>Completed<\/span><b>30<\/b>/.test(h) && /10% in Finished Goods/.test(h));
ok('…a bar of where all 296 pieces are, each place a button that picks its lines', /Where all 296 pieces are now/.test(h) && /data-p1rproc="To Finished Goods"><i[^>]*><\/i><b>188<\/b><span>Pressed, to Finished Goods/.test(h));
ok('…the open lines by due week, the late week red', /class="rp-col late"[^>]*title="Week of 19 Oct: 1 line, 220 pcs"/.test(h));
ok('…by channel and by category', /By channel/.test(h) && /By category/.test(h) && />Amazon</.test(h) && />Tablecloth</.test(h));
ok('…the Lines sheet in the file\'s groups and colours, totals of the shown lines', /class="grp" style="background:#FBEAF0;color:#72243E">Printing</.test(h) && /<td><b>Total \(shown lines\)<\/b><\/td>/.test(h));
ok('…a late line tinted, its days late in red', /<tr class="lt">[^]*?<b class="late">31 d<\/b>/.test(h));
ok('…Summary by SKU, the most pending first (CPCC004 220 before TC<b>1 46)', h.indexOf('>CPCC004</td><td class="num">224') < h.indexOf('>TC&lt;b&gt;1</td><td class="num">50'));
ok('…a SKU from the order book is text, never HTML', !/TC<b>1/.test(h) && /TC&lt;b&gt;1/.test(h));
ok('…Download Excel for whoever may download', /data-p1rxl/.test(h));
C.__t.P1.rproc = 'RFD'; h = C.__t.p1RepPart();
ok('a process picked: only its lines (1 of 3)', /1 of 3/.test(h) && /TC&lt;b&gt;1/.test(h) && !/>CPCC004<\/td>/.test(h));
C.__t.P1.rproc = ''; C.__t.P1.rlate = true; h = C.__t.p1RepPart();
ok('Late only: the late line alone', /1 of 3/.test(h) && />CPCC004<\/td>/.test(h) && !/>CPCC002-18<\/td>/.test(h));
C.__t.P1.rlate = false; C.__t.P1.q = 'shp-9'; h = C.__t.p1RepPart(); C.__t.P1.q = '';
ok('search by order, SKU, category, printer or channel', /1 of 3/.test(h) && /TC&lt;b&gt;1/.test(h));
const V = load({ admin: false, tabs: ['flppc'] }); V.p1RepLines = () => ({ lines, from: '', to: '', on: 'planned' });
ok('no Download button without the Reports right (the figures stay)', !/data-p1rxl/.test(V.__t.p1RepPart()) && /Where all 296 pieces/.test(V.__t.p1RepPart()));
const E = load(); E.p1RepLines = () => ({ lines: [], from: '2026-11-19', to: '2026-11-25', on: 'planned' });
ok('no lines in the days: said, no empty charts', /No lines for "Planned in PPC/.test(E.__t.p1RepPart()) && !/rp-pipe/.test(E.__t.p1RepPart()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
