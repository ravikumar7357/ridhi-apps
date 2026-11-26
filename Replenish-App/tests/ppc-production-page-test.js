/* PPC → Production, the lot list (src/app/core/ppc-one.js — p1DrawInv).
 * Ravi, 26 Nov: "remove the next step button and column from the ppc production page" — and keep History.
 *   node tests/ppc-production-page-test.js      (PPC_ONE=<file> to test another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.PPC_ONE || path.join(__dirname, '..', 'src', 'app', 'core', 'ppc-one.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const page = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
const ctx = {
  obUC: s => String(s == null ? '' : s).trim().toUpperCase(), esc: s => String(s == null ? '' : s), console, Date, Math, Set, Map, setTimeout: () => 0, clearTimeout() {},
  ptIsoDate: v => String(v || '').slice(0, 10), ptDtMs: v => Date.parse(v) || 0, FLOW: { ppc: {}, res: {} }, FLOW_ROUTES: [], flowRouteOf: () => 'inhouse',
  ME: { admin: true, tabs: [] }, document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }, $: () => page,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(FILE, 'utf8') + '\n;this.__t = { P1, p1DrawInv };', ctx);

const stages = {}; ['plan', 'rfd', 'prn', 'cut', 'iss', 'kar', 'qc', 'rdy'].forEach(k => { stages[k] = { w: k === 'prn' ? 48 : 0, m: 0, done: false, na: false }; });
const line = { x: { r: { orderNo: 'AMZ-1', sku: 'CPC-01', qty: 48 }, s: { bucket: 'vendor', printed: true, given: 48, back: 0 } },st: Object.assign({ q: 48 }, stages), D: {}, due: '2020-01-01', at: 'prn', chan: 'Amazon', printer: 'SS Hand Block' };
/* a late lot with pieces at the printer: the lot that used to carry the green "Receive printed 48" button */
const lot = { gk: 'L1', lot: null, notPlanned: 0, isNew: false, sku: 'CPC-01', what: 'Square Tablecloth', ordered: 48, orders: new Set(['AMZ-1']), lines: [line.x], ln: [line], stg: stages, D: {},
  holds: [], at: 'prn', due: '2020-01-01', over: 5, stuck: 0, chans: ['Amazon'], printers: ['SS Hand Block'], kars: [], find: 'CPC-01 AMZ-1' };
ctx.p1Board = () => [lot]; ctx.p1ViewSeg = () => ''; ctx.p1Local = () => '2026-11-26';

ctx.__t.P1.inv = 'L1';   // the lot opened, so its order line is drawn too
ctx.__t.p1DrawInv();
const h = page.innerHTML;
ok('the lot and its order line are on the page', /CPC-01/.test(h) && /AMZ-1/.test(h) && /class="p1l"/.test(h));
ok('no "Next step" heading', !/Next step/i.test(h));
ok('no step button on the lot or on the order line', !/data-p1step|p1-go2|class="p1-go"|Receive printed/.test(h));
ok('History stays on the lot', (h.match(/class="p1-hbtn" data-p1hist="L1"/g) || []).length === 1 && />History<\/button>/.test(h));
const cells = row => (row.match(/<td[ >]/g) || []).length;
const heads = (h.match(/<thead>[\s\S]*?<\/thead>/)[0].match(/<th[ >]/g) || []).length;
const rows = h.match(/<tr class="p1[rl][\s\S]*?<\/tr>/g) || [];
ok('every row still has one cell under each heading', rows.length === 2 && rows.every(r => cells(r) === heads), JSON.stringify([heads, rows.map(cells)]));
ok('a late lot is still marked at its left edge', /class="p1r lot open urgent"/.test(h));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
