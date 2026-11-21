/* SEND TO CUTTING, LINKED TO THE LINES (Ravi, 21 Nov: "Link it to the lines").
 * Greige Desk → Inventory → RFD on shelf → Send to cutting now asks which products the cloth is for:
 *   - only no-printing lines of that fabric are listed (still waiting for cloth, or marked ready and not cut yet)
 *   - at least one product must be ticked; the ticked thans must cover the ticked products (extra is fine, less is refused)
 *   - one save takes the thans off the shelf AND marks those lines' fabric ready (with the lot), so the shelf and the
 *     lines never disagree, and the flow no longer holds that cloth a second time
 *   - removing the cutting entry in the Fabric ledger puts the lines back exactly as they were
 *   - Cutting Data shows the lot on the line
 * Loads the real src/app/flow/greige-desk.js and src/app/flow/flow-demand.js. Made-up orders only.
 *   node tests/greige-cut-lines-test.js
 *   GD_FILE=<broken desk copy> / FLOW_FILE=<broken flow-demand copy> node tests/greige-cut-lines-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DESK = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
const DEMAND = process.env.FLOW_FILE ? path.resolve(process.env.FLOW_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-demand.js');
const VIEW = path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-view.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* ---- the production flow, with made-up lines ---- */
const line = (key, orderNo, orderDate, route, fabric, extra) => ({
  r: { orderNo, orderDate, sku: 'cush-' + key, qty: 10 },
  s: Object.assign({ key, route, bucket: 'demand', plan: { qty: 10, fabric: { name: fabric, metres: 20 } }, demand: {}, cut: 0, issued: 0, given: 0, needFab: true }, extra || {}) });
const flow = vm.createContext({ console });
vm.runInContext(fs.readFileSync(DEMAND, 'utf8'), flow);
let ROWS = [];
Object.assign(flow, {
  flowRows: () => ROWS, flowRfdStock: () => 200, flowInView: (v, s) => v === 'drfd' && s.bucket === 'demand' && s.needFab,
  flowPrinted: route => route !== 'stitch', flowFabOwed: () => ({ metres: 0 }), flowToPrint: (r, p) => ({ metres: p.fabric.metres }),
  flowRemFrac: () => 1, flowR2: n => Math.round((+n || 0) * 100) / 100, obUC: x => String(x || '').trim().toUpperCase()
});

console.log('== which products the window lists ==');
ROWS = [
  line('L3', 'SHP-3', '2026-11-12', 'stitch', 'Duck 64'),
  line('L1', 'B2B-1', '2026-11-10', 'stitch', 'Duck 64'),
  line('L2', 'B2B-2', '2026-11-11', 'inhouse', 'Duck 64'),                               // printed: goes by printer challan
  line('L4', 'B2B-4', '2026-11-09', 'stitch', 'Canvas 48'),                              // another fabric
  line('L5', 'SHP-5', '2026-11-08', 'stitch', 'Duck 64', { needFab: false, demand: { fabricReady: { what: 'Duck 64', metres: 18 } } }),   // ready, cloth held
  line('L6', 'SHP-6', '2026-11-07', 'stitch', 'Duck 64', { needFab: false, cut: 10, demand: { fabricReady: { what: 'Duck 64', metres: 20 } } }),   // already cut
  line('L7', 'SHP-7', '2026-11-06', 'stitch', 'Duck 64', { needFab: false, demand: { fabricReady: { what: 'Duck 64', metres: 20, cutEntry: 'e0', lot: 'LOT-001' } } }),   // already sent from the desk
  line('L8', 'SHP-8', '2026-11-05', 'stitch', 'Duck 64', { bucket: 'done', needFab: false })
];
const listed = flow.flowCutLines('duck 64');
const keys = listed.map(l => l.key).join(',');
ok('only the no-printing lines of that fabric, waiting or held, oldest order first', keys === 'L5,L1,L3', keys);
ok('a waiting line asks for what it still needs; a held one for what was made ready', listed.find(l => l.key === 'L1').metres === 20 && listed.find(l => l.key === 'L5').metres === 18);
ok('a held line is marked ready and remembers its old mark (for the undo)', listed.find(l => l.key === 'L5').ready === true && listed.find(l => l.key === 'L5').was.metres === 18 && listed.find(l => l.key === 'L1').was === null);
ok('each line carries its order, SKU and pieces', (l => l.orderNo === 'B2B-1' && l.sku === 'CUSH-L1' && l.pcs === 10)(listed.find(l => l.key === 'L1')));

console.log('== the flow does not hold cloth the desk already sent to cutting ==');
ROWS = [
  line('H1', 'B2B-1', '2026-11-10', 'stitch', 'Duck 64', { needFab: false, demand: { fabricReady: { what: 'Duck 64', metres: 30 } } }),
  line('H2', 'B2B-2', '2026-11-10', 'stitch', 'Duck 64', { needFab: false, demand: { fabricReady: { what: 'Duck 64', metres: 50, cutEntry: 'e1', lot: 'LOT-016' } } })
];
const fab = flow.flowRfdCover().fab['DUCK 64'];
ok('a line marked ready by hand still holds its 30 m; the one sent from the desk holds nothing (its thans already left)', fab.held === 30 && fab.free === 170, JSON.stringify(fab));

/* ---- the Greige Desk window ---- */
const code = fs.readFileSync(DESK, 'utf8');
const anchor = '  return { open: open,';
if (code.split(anchor).length !== 2) throw new Error('greige-desk.js: the closing "return { open" line moved; update this test');
const desk = vm.createContext({ console, window: { document: {} }, ME: { email: 'store@example.test' } });
vm.runInContext(code.replace(anchor, '  globalThis.__GDT = { cutLinesCheck, cutLinesPatch, cutLinesUndoPatch, cutTotHtml, cutFlowKeep, setCUT: function (v) { CUT = v; } };\n' + anchor), desk);
const G = desk.__GDT;
const products = [{ key: 'L1', orderNo: 'B2B-1', metres: 80, was: null }, { key: 'L5', orderNo: 'SHP-5', metres: 63, was: { what: 'Duck 64', metres: 63, note: 'by hand' } }, { key: 'L9', orderNo: 'B2B-1', metres: 10, was: null }];
const windowWith = ticked => G.setCUT({ lot: 'LOT-016', pick: {}, qty: '', lines: products, lpick: Object.fromEntries(ticked.map(k => [k, true])) });

console.log('== the window\'s rules (Ravi: must tick; thans must cover the products) ==');
windowWith([]);
ok('no product ticked: refused, and it says what to do', G.cutLinesCheck(150) === 'Tick the products this cloth is for.');
windowWith(['L1', 'L5']);
ok('thans less than the products need: refused with both figures', /^The thans come to 120\.0 m.*143\.0 m/.test(G.cutLinesCheck(120, true)), G.cutLinesCheck(120, true));
/* Ravi's UAT check, 21 Nov: on a lot with no thans listed the metres are typed, so the refusal must not talk of thans */
ok('metres typed by hand, too few: refused in metres, with no word of thans',
  (m => /^60\.0 m is going; the ticked products need 143\.0 m\. Send more metres/.test(m) && !/than/.test(m))(G.cutLinesCheck(60, false)), G.cutLinesCheck(60, false));
ok('the save says which kind of lot it is', code.includes('err = cutLinesCheck(q, !!picked) || fabEntryCheck('));
ok('typing a new figure clears the last refusal', /CUT\.qty = el\.value; \$\('cutErr'\)\.classList\.add\('hide'\);/.test(code));
ok('thans exactly what the products need: allowed', G.cutLinesCheck(143) === '');
ok('thans more than they need: allowed (the extra goes with them)', G.cutLinesCheck(150) === '');
ok('the bottom line shows the need, what is going and the extra', (t => /For 2 products: <b>143.0 m/.test(t) && /7.0 m extra/.test(t))(G.cutTotHtml(150, '2 thans · ')), G.cutTotHtml(150, '2 thans · '));
ok('…and the shortfall in red when the thans are less', /23.0 m short/.test(G.cutTotHtml(120, '')));
G.setCUT({ lot: 'LOT-016', pick: {}, qty: '', lines: null, lpick: {} });
ok('while the products are still loading, nothing can go', /still loading/.test(G.cutLinesCheck(150)));

console.log('== one save: the shelf and the lines together ==');
windowWith(['L1', 'L5']);
const row = { id: 'e42', lot: 'LOT-016', fabricType: 'Duck 64', qty: 150, by: 'Ramesh' };
const patch = G.cutLinesPatch(row, products.filter(p => ['L1', 'L5'].includes(p.key)));
const fr1 = patch['pt_flowDemand/L1/fabricReady'];
ok('each ticked line\'s fabric is marked ready with the lot, its metres and this entry', fr1 && fr1.lot === 'LOT-016' && fr1.metres === 80 && fr1.cutEntry === 'e42' && fr1.what === 'Duck 64' && /Sent to cutting · LOT-016/.test(fr1.note));
ok('the person is named by email, as the flow does', fr1.by === 'store@example.test');
ok('only the ticked lines are written', Object.keys(patch).length === 2 && !patch['pt_flowDemand/L9/fabricReady']);
ok('the entry remembers its lines, their old marks and the orders', row.lines.join() === 'L1,L5' && row.lineWas.L1 === null && row.lineWas.L5.note === 'by hand' && row.forOrders === 'B2B-1, SHP-5');
ok('the desk saves the entry and the lines in ONE patch', /function lmSaveDb\(alsoWrite\)/.test(code) && /patch = Object\.assign\(\{\}, alsoWrite \|\| \{\}\)/.test(code)
  && /var flowPatch = cutLinesPatch\(row, cutLinesPicked\(\)\);\s*DB\.fab\.push\(row\); lmSaveDb\(flowPatch\);/.test(code));
ok('the save is refused before anything is written when the rules say no', /err = cutLinesCheck\(q, !!picked\) \|\| fabEntryCheck\(/.test(code));
desk.FLOW = { dem: { L1: { other: 1 } } };
G.cutFlowKeep(patch);
ok('the flow on this screen sees it at once (no reload)', desk.FLOW.dem.L1.fabricReady.cutEntry === 'e42' && desk.FLOW.dem.L1.other === 1 && desk.FLOW.dem.L5.fabricReady.lot === 'LOT-016');

console.log('== removing the entry puts the lines back ==');
const back = G.cutLinesUndoPatch(row);
ok('a line that was waiting waits again; a line marked ready by hand gets its old mark back',
  back['pt_flowDemand/L1/fabricReady'] === null && (back['pt_flowDemand/L5/fabricReady'] || {}).note === 'by hand');
ok('an ordinary entry (no lines) touches no line', Object.keys(G.cutLinesUndoPatch({ id: 'x' })).length === 0);
ok('the ledger\'s Remove writes the entry and the lines in one patch', /var back = cutLinesUndoPatch\(r\);[^\n]*\n\s*lmSaveDb\(back\);/.test(code));

console.log('== where people see it ==');
ok('a changed tick clears the last refusal', code.includes("rfd = cutRfdOf(g);\n  $('cutErr').classList.add('hide');"));
ok('the window lists the products above the thans', (code.match(/innerHTML = cutLinesHtml\(\) \+/g) || []).length === 2);
ok('the Fabric ledger and stock history say which orders the cloth went for', /r\.forOrders \? 'for ' \+ r\.forOrders : ''/.test(code) && /\(r\.forOrders \? '<div class="muted"/.test(code));
const view = fs.readFileSync(VIEW, 'utf8');
ok('Cutting Data shows the lot and metres on the line', /function flowCutFromLot\(s\)/.test(view) && /\+ flowCutFromLot\(x\.s\);/.test(view) && /sent to cutting<\/div>/.test(view));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
