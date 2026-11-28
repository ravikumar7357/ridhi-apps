/* Greige Desk Inventory → Custom orders: only SHP / ONL / Etsy lines of Demand → RFD, a date range, a printer filter, a tick on the lines that can go, and Make challan for the ticked
 * ones through the Send-to-printer card's own review. Made-up lines only.   node tests/greige-custom-orders-test.js */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/app/flow/greige-desk.js', 'utf8');
const b = src.indexOf("/** What PPC's demand asks of this fabric");
const mk = (rows, ready) => {
  const listeners = {}, calls = { review: 0, alerts: [] };
  const ctx = { UI: { invBoard: 'all', cuFrom: '', cuTo: '', cuPrn: '', cuSel: {}, invView: 'custom', tab: 'inv' }, INV_CSS: '', esc: x => String(x == null ? '' : x), nf: x => String(x), m1: x => (+x).toFixed(1),
    plural: (n, o) => n + ' ' + o + (n === 1 ? '' : 's'), uniq: a => [...new Set(a)], lmMatch: () => true, th: l => '<thead>' + l.map(h => (h === '' ? '<th class="frz"></th>' : '<th>' + h + '</th>')).join('') + '</thead>',
    emptyRow: (c, w) => '<tr>' + w + '</tr>', gdFlowReady: () => ready, render() { calls.rendered = (calls.rendered || 0) + 1; }, alert(m) { calls.alerts.push(m); },
    document: { addEventListener: (k, f) => { listeners[k] = f; } }, flowScreenAllowed: () => [['drfd']],
    flowRows: () => rows, flowInView: () => true, flowCpActive: () => false,
    flowRfdCover: () => ({ line: { k1: { name: 'Sheeting 62', short: 0 }, k2: { name: 'Sheeting 62', short: 12.5 }, k5: { name: 'Percale', short: 0 } } }),
    flowShLine: x => ({ x, key: x.s.key, pcs: x.r.qty, metres: x.r.qty * 2, printer: x.r.prn || '', printerName: x.r.prnName || '', perPc: x.r.noCloth ? 0 : 2 }),
    flowShKind: l => (l.x.r.cut ? 'cut' : 'run'), flowShWhyNot: (S, l) => (l.perPc > 0 ? (l.printer ? '' : 'PPC has not given it a printer yet — PPC sets it first') : 'No cloth per piece on its master row — add it there first'),
    flowShReviewOpen() { calls.review++; }, flowShCommit() {}, FLOW_SH: null, calls, listeners };
  vm.createContext(ctx);
  /* the real order cloth goes in (flow-demand.js): Shopify board first, then oldest */
  const dm = fs.readFileSync(__dirname + '/../src/app/flow/flow-demand.js', 'utf8');
  vm.runInContext(dm.slice(dm.indexOf('const flowIsShpOrder'), dm.indexOf('function flowRfdCover(')), ctx);
  vm.runInContext("var UI_ = UI; function render() { calls.rendered = (calls.rendered || 0) + 1; }", ctx);
  vm.runInContext(src.slice(src.indexOf('var CU_BOARDS'), b), ctx); return ctx;
};
const R = (no, key, qty, o) => ({ r: Object.assign({ orderNo: no, sku: 'S-' + key, qty, orderDate: '2026-11-2' + key.slice(1), prn: 'p1', prnName: 'RBP-Bagru' }, o || {}), s: { key, route: 'print', plan: { fabric: { name: key === 'k5' ? 'Percale' : 'Sheeting 62' } } } });
let ok = 0; const t = (c, m) => { assert(c, m); ok++; };
const rows = [R('SHP-7862', 'k1', 4), R('AMZ-24112026-01-AIR', 'k3', 9), R('ONL-12', 'k2', 3, { prn: 'p2', prnName: 'Bhavya' }), R('ETSY-5', 'k4', 0), R('SHP-9', 'k5', 2, { noCloth: true })];
const c = mk(rows, true);
const L = vm.runInContext('cuLines()', c);
t(L.length === 3 && L.map(x => x.board).join() === 'shp,shp,onl', 'Amazon and the 0-pcs line are out; Shopify board first, then oldest');
let h = vm.runInContext('cuHtml()', c);
t(/data-cusel="k1"/.test(h) && /data-cusel="k2"/.test(h), 'lines that can go have a tick');
t(!/data-cusel="k5"/.test(h) && /No cloth per piece/.test(h), 'a line with no cloth per piece has none, and says why');
t(/data-cuf="cuFrom"/.test(h) && /data-cuf="cuTo"/.test(h) && /All printers/.test(h) && /RBP-Bagru/.test(h) && /Bhavya/.test(h), 'date range and printer filter');
t(!/Pivot/.test(h), 'no pivot buttons');
// printer filter + date range
vm.runInContext("UI.cuPrn='p2'", c); h = vm.runInContext('cuHtml()', c); t(/data-cusel="k2"/.test(h) && !/data-cusel="k1"/.test(h), 'printer filter');
vm.runInContext("UI.cuPrn=''; UI.cuFrom='2026-11-22'", c); h = vm.runInContext('cuHtml()', c); t(!/data-cusel="k1"/.test(h) && /data-cusel="k2"/.test(h), 'date range from');
vm.runInContext("UI.cuFrom=''; UI.cuTo='2026-11-21'", c); h = vm.runInContext('cuHtml()', c); t(/data-cusel="k1"/.test(h) && !/data-cusel="k2"/.test(h), 'date range to');
// ticks and Make challan
vm.runInContext("UI.cuTo=''", c);
vm.runInContext("UI.cuSel={k1:true,k2:true,k5:true}", c);
h = vm.runInContext('cuHtml()', c); t(/2 selected · 7 pcs · 14\.0 m/.test(h), 'the selection counts only what can go: k5 is dropped'); t(!/data-cumake="1" disabled/.test(h), 'Make challan is on');
c.listeners.change({ target: { getAttribute: k => (k === 'data-cuall' ? '1' : null), checked: false } }); t(Object.keys(vm.runInContext('UI.cuSel', c)).length === 0, 'select-all off clears');
c.listeners.change({ target: { getAttribute: k => (k === 'data-cuall' ? '1' : null), checked: true } }); t(Object.keys(vm.runInContext('UI.cuSel', c)).sort().join() === 'k1,k2', 'select-all ticks what can go');
vm.runInContext('cuMake()', c);
t(c.calls.review === 1, 'the review opens');
const S = vm.runInContext('FLOW_SH', c);
t(S.lines.length === 2 && S.tick.has('k1') && S.tick.has('k2') && S.review && typeof S.after === 'function', 'the card state carries the ticked lines');
vm.runInContext("UI.cuSel={}", c); vm.runInContext('cuMake()', c); t(c.calls.alerts.length === 1 && c.calls.review === 1, 'nothing ticked: no review');
t(/Loading the custom orders/.test(vm.runInContext('cuHtml()', mk([], false))), 'loading state');
console.log(ok + ' passed, 0 failed');
