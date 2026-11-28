/* Greige Desk Inventory → Custom orders: only SHP / ONL / Etsy lines of Demand → RFD, read against the shelf. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/app/flow/greige-desk.js', 'utf8');
const a = src.indexOf('UI.invView = '), b = src.indexOf("/** What PPC's demand asks of this fabric");
const mk = (rows, ready) => {
  const ctx = { UI: { invBoard: 'all' }, INV_CSS: '', esc: x => String(x == null ? '' : x), nf: x => String(x), m1: x => (+x).toFixed(1), plural: (n, o) => n + ' ' + o + (n === 1 ? '' : 's'),
    lmMatch: () => true, th: l => '<thead>' + l.join('|') + '</thead>', emptyRow: (c, w) => '<tr>' + w + '</tr>', gdFlowReady: () => ready,
    flowRows: () => rows, flowInView: () => true, flowCpActive: () => false, flowRfdCover: () => ({ line: { k1: { name: 'Sheeting 62', short: 0 }, k2: { name: 'Sheeting 62', short: 12.5 } } }),
    flowShLine: x => ({ x, key: x.s.key, pcs: x.r.qty, metres: x.r.qty * 2, printerName: '' }) };
  vm.createContext(ctx); vm.runInContext(src.slice(src.indexOf("var CU_BOARDS"), b), ctx); return ctx;
};
const R = (no, key, qty) => ({ r: { orderNo: no, sku: 'S-' + key, qty, orderDate: '2026-11-2' + key.slice(1) }, s: { key, plan: { fabric: { name: 'Sheeting 62' } } } });
let ok = 0;
let c = mk([R('SHP-7862', 'k1', 4), R('AMZ-24112026-01-AIR', 'k3', 9), R('ONL-12', 'k2', 3), R('ETSY-5', 'k4', 0)], true);
const L = vm.runInContext('cuLines()', c);
assert.strictEqual(L.length, 2); ok++;                                   // Amazon out, the 0-pcs Etsy out
assert.deepStrictEqual(L.map(x => x.board), ['shp', 'onl']); ok++;
const h = vm.runInContext('cuHtml()', c);
assert(/RFD on shelf/.test(h) && /short 12\.5 m/.test(h)); ok++;
assert(/data-gdlines="Sheeting 62"/.test(h) && !/AMZ-24112026/.test(h)); ok++;
assert(/Loading the custom orders/.test(vm.runInContext('cuHtml()', mk([], false)))); ok++;
console.log(ok + ' passed, 0 failed');
