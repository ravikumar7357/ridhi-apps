/* CLOTH ON ITS WAY TO THE PRINTER (Vishesh, 23 Nov).
 *   - every RFD challan to a printer leaves the printer its own copy (pt_vendorChallans/<code>/<no>, kind 'cloth'); a test
 *     order, cloth already standing with the printer and a record of cloth given earlier leave none
 *   - the printer's portal lists them above the Bulk orders: in transit ones with nothing searched, every match when searched
 *     (our order no., SKU, challan no.); "Cloth received" marks the copy, once, only for the printer (or an admin looking as it)
 *   - the portal's search finds a printer's order by OUR order number (AMZ-…), from the lines' forOrders
 *   - the printer's own Daily challan list does not show our copies
 *   - Greige Desk → Inventory: RFD on shelf gets a small "+ N m in transit to printers" line; the RFD drop-down lists them
 * Loads the real files with small fakes. Made-up printers, orders and fabrics only.
 *   node tests/challan-transit-test.js
 *   PCL_FILE=<broken printer-cloth.js> / GD_FILE=<broken greige-desk.js> / CH_FILE=<broken flow-challan.js> node tests/challan-transit-test.js */
const fs = require('fs'), vm = require('vm'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
const file = (env, rel) => (process.env[env] ? path.resolve(process.env[env]) : path.join(APP, rel));
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = n => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/* ---- the printer's copy of a challan (flow-challan.js: flowClothFor, flowClothInTransit) ---- */
function challanSide() {
  const src = fs.readFileSync(file('CH_FILE', 'flow/flow-challan.js'), 'utf8');
  const ctx = { console, FLOW: { ch: {}, cloth: null }, ptGet: async () => ({}), flowR2: n => Math.round(n * 100) / 100,
    flowFabKey: s => String(s || '').trim().toUpperCase(), flowKey: (o, s) => (String(o).toUpperCase() + '__' + String(s).toUpperCase()).replace(/[.#$\[\]\/]/g, '_'),
    document: undefined };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__C = { flowClothFor, flowClothInTransit, flowClothLoad };', ctx);
  return { C: ctx.__C, ctx };
}
console.log('== the printer gets its own copy of each RFD challan ==');
{
  const { C, ctx } = challanSide();
  const ch = { no: 'RFD-202611-455', date: '2026-11-23', orderNo: 'AMZ-1, AMZ-2', orders: ['AMZ-1', 'AMZ-2'], vendor: { code: 'P1', name: 'Sanganer Prints' }, at: '2026-11-23T10:00:00Z', by: 'store@x',
    lines: [{ key: 'AMZ-1__S1', sku: 'S1', fabric: 'Cambric', pcs: 325, metres: 113.75 }, { key: 'AMZ-2__S9', sku: 'S9', fabric: 'Cambric', pcs: 3, metres: 1.35 }] };
  const cp = C.flowClothFor(ch, { isTest: false });
  ok('the copy names each line\'s own order (AMZ-1 for S1, AMZ-2 for S9), the SKU and metres; 115.1 m in all; not received',
    cp && cp.kind === 'cloth' && cp.lines.map(l => l.orderNo + ' ' + l.sku + ' ' + l.metres).join() === 'AMZ-1 S1 113.75,AMZ-2 S9 1.35' && cp.metres === 115.1 && !cp.received, JSON.stringify(cp));
  ok('a test order gets no copy (no cloth travels)', C.flowClothFor(ch, { isTest: true }) === null);
  ok('cloth already standing with the printer gets no copy', C.flowClothFor(Object.assign({}, ch, { standing: true }), {}) === null);
  ok('a record of cloth given earlier gets no copy', C.flowClothFor(Object.assign({}, ch, { recordOnly: true }), {}) === null);

  ctx.FLOW.cloth = { P1: { 'RFD-202611-455': cp, 'RFD-202611-300': Object.assign({}, cp, { no: 'RFD-202611-300', date: '2026-11-02', received: { at: '2026-11-03T09:00:00Z', by: 'p1@x' } }) },
    P2: { 'DC-P2-23112026-01': { no: 'DC-P2-23112026-01', lines: [{ fabric: 'Cambric', metres: 999 }] }, 'RFD-202611-400': Object.assign({}, cp, { no: 'RFD-202611-400', date: '2026-10-30' }) } };
  const t = C.flowClothInTransit('cambric', '2026-11-01');
  ok('in transit: only copies not yet received, of that fabric, since the day counting began (not the printer\'s own daily challan, not before 1 Nov)',
    t.length === 2 && t.every(x => x.no === 'RFD-202611-455') && t.reduce((a, x) => a + x.metres, 0) === 115.1 && t[0].vendor === 'Sanganer Prints', JSON.stringify(t));
  ctx.FLOW.ch = { 'RFD-202611-455': { cancelled: true } };
  ok('a cancelled challan is not in transit', C.flowClothInTransit('Cambric', '2026-11-01').length === 0);
  ctx.ptGet = async () => { throw new Error('permission denied'); };
  const warned = []; ctx.console = { warn: m => warned.push(m), log() {} };
  (async () => {
    await C.flowClothLoad();
    ok('the copies cannot be read: nothing in transit, and the console says why (never throws)', JSON.stringify(ctx.FLOW.cloth) === '{}' && /nothing shows as in transit/.test(warned[0] || ''));
    await portal();
  })().catch(e => { fail++; console.log('  FAIL threw ' + (e.stack || e)); finish(); });
}

/* ---- the printer's portal (printer-cloth.js) ---- */
async function portal() {
  console.log('\n== Printer\'s portal: Cloth sent to you ==');
  const src = fs.readFileSync(file('PCL_FILE', 'vendors/portal/printer-cloth.js'), 'utf8');
  const writes = [], drawn = [];
  const branch = {
    'RFD-202611-455': { kind: 'cloth', no: 'RFD-202611-455', date: '2026-11-23', vendor: { code: 'P1', name: 'SS Hand Block' }, metres: 277.15,
      lines: [{ orderNo: 'AMZ-17102026-02-SEA', sku: 'CPCLS-CO-005', fabric: 'Cambric', pcs: 325, metres: 113.75 }, { orderNo: 'AMZ-19102026-01-AIR', sku: 'CPCTB005', fabric: 'Cambric', pcs: 3, metres: 1.35 }] },
    'RFD-202611-353': { kind: 'cloth', no: 'RFD-202611-353', date: '2026-11-18', vendor: { code: 'P1', name: 'SS Hand Block' }, metres: 137, received: { at: '2026-11-19T08:00:00Z', by: 'p1@x' },
      lines: [{ orderNo: 'AMZ-17102026-02-SEA', sku: 'CPCLS-CO-005', fabric: 'Cambric', pcs: 0, metres: 137 }] },
    'DC-P1-23112026-01': { no: 'DC-P1-23112026-01', date: '2026-11-23', lines: [{ orderNo: 'AMZ-17102026-02-SEA' }] },
  };
  const make = (me, vendor) => {
    const ctx = { console, VP: { code: 'P1' }, ME: me, NAV_IS_VENDOR: !!vendor, FLOW: { cloth: { P1: { 'RFD-202611-455': {} } } }, esc, nf,
      ptList: o => Object.keys(o || {}).map(k => Object.assign({ id: k }, o[k])),
      ptGet: async p => (p === 'pt_vendorChallans/P1' ? JSON.parse(JSON.stringify(branch)) : null),
      ptPut: async (p, v) => { writes.push([p, v]); }, renderVp: () => drawn.push(1), toast() {}, document: undefined };
    vm.createContext(ctx);
    vm.runInContext(src + '\n;globalThis.__P = { pclSection, pclShown, pclReceive, pclLoad, pclMayReceive, pclLineHtml, pclForLine, PCL, listOn: v => { PCL_LIST_SHOWN = v; } };', ctx);
    ctx.__P.listOn(true);   // the checks of the old list (off on the page since 24 Nov) see it
    return { P: ctx.__P, ctx };
  };
  const { P, ctx } = make({ admin: false, email: 'p1@x' }, true);
  ok('the first draw starts the read and shows nothing yet', P.pclSection('') === '');
  await new Promise(r => setTimeout(r, 5));
  ok('…once read, the portal draws itself again', drawn.length >= 1);
  ok('the printer\'s own daily challan is not in the list (only our copies)', P.PCL.rows.length === 2 && !P.PCL.rows.some(c => /^DC-/.test(c.no)));
  const html0 = P.pclSection('');
  ok('nothing searched: only the challan still in transit, with "Cloth received"', /RFD-202611-455/.test(html0) && !/RFD-202611-353/.test(html0) && /In transit/.test(html0) && /data-pclrecv="RFD-202611-455"/.test(html0) && /still on its way/.test(html0));
  const html1 = P.pclSection('amz-17102026-02-sea');
  ok('searching our order no.: both challans that carried it, the received one marked "Received 2026-11-19" with no button',
    /RFD-202611-455/.test(html1) && /RFD-202611-353/.test(html1) && /Received 2026-11-19/.test(html1) && !/data-pclrecv="RFD-202611-353"/.test(html1));
  ok('searching a SKU or the challan no. finds it too', P.pclShown(P.PCL.rows, 'cpctb005').length === 1 && P.pclShown(P.PCL.rows, 'rfd-202611-353').length === 1);
  ok('a search that matches nothing shows nothing (the orders below still show)', P.pclSection('shp-99') === '');
  /* ON THE ORDER'S OWN ROW (Ravi, 24 Nov): no list above the orders; each line says what we sent for it, with Cloth received */
  ctx.flowKey = (o, k) => (String(o).trim().toUpperCase() + '__' + String(k).trim().toUpperCase());
  P.listOn(false);
  ok('the list above the orders is gone from the page (24 Nov)', P.pclSection('') === '' && P.pclSection('amz-17102026-02-sea') === '');
  const vl = { flowPart: 'AMZ-17102026-02-SEA__CPCLS-CO-005|sku' };
  const row = P.pclLineHtml({}, vl);
  ok('…the order line shows both challans that carried its cut pieces: in transit with Cloth received, and the one received', /325 pcs|113\.75 m/.test(row) && /RFD-202611-455 · 2026-11-23 · in transit/.test(row)
    && /data-pclrecv="RFD-202611-455"/.test(row) && /✓ [^<]*received · RFD-202611-353 · 2026-11-19/.test(row) && !/data-pclrecv="RFD-202611-353"/.test(row), row);
  ok('…a line we sent nothing for says nothing', P.pclLineHtml({}, { flowPart: 'SHP-1__X|body' }) === '' && P.pclLineHtml({}, {}) === '');
  ok('…a merged line (two parts) finds each part\'s challans', P.pclForLine({}, { parts: ['AMZ-19102026-01-AIR__CPCTB005|sku', 'X__Y|body'] }).map(x => x.c.no).join() === 'RFD-202611-455');
  P.listOn(true);
  /* CUT PIECES IN PIECES (Ravi, 24 Nov): a copy says each line's unit; an older copy (no unit) stays in metres */
  ok('an older copy (no unit on its lines) says its metres, as before', /277\.15 m/.test(P.pclSection('rfd-202611-455')) && /<th>Sent<\/th>/.test(P.pclSection('rfd-202611-455')));
  P.PCL.rows.push({ kind: 'cloth', no: 'RFD-202611-464', date: '2026-11-24', metres: 31.6, lines: [{ orderNo: 'AMZ-24112026-01-AIR', sku: 'RTC327-6060', fabric: 'Sheeting 62', pcs: 20, metres: 31.6, unit: 'pcs' }] });
  ok('cut pieces (printed on the SKU itself) are said in pieces: 20 pcs, not 31.6 m', /<td class="num">20 pcs<\/td>/.test(P.pclSection('rfd-202611-464')));
  P.PCL.rows.push({ kind: 'cloth', no: 'RFD-202611-465', date: '2026-11-24', metres: 45.6, lines: [{ orderNo: 'X', sku: 'A', pcs: 20, metres: 31.6, unit: 'pcs' }, { orderNo: 'X', sku: 'B', pcs: 10, metres: 14, unit: 'm' }] });
  ok('…running cloth in metres, both on one challan: "20 pcs · 14 m"', /20 pcs · 14 m/.test(P.pclSection('rfd-202611-465')));
  P.PCL.rows = P.PCL.rows.filter(c => !/46[45]$/.test(c.no));
  ok('names on the page are text, never HTML', (P.PCL.rows[0].lines[0].sku = '<b>x', /&lt;b&gt;x/.test(P.pclSection(''))));

  const er = await P.pclReceive('RFD-202611-455');
  ok('"Cloth received": the copy gets received { at, by } in the printer\'s own branch', er === '' && writes.length === 1 && writes[0][0] === 'pt_vendorChallans/P1/RFD-202611-455/received' && writes[0][1].by === 'p1@x' && !!writes[0][1].at);
  ok('…the list now says Received and has no button; the Greige Desk\'s count is told too', /Received/.test(P.pclSection('rfd-202611-455')) && !/data-pclrecv/.test(P.pclSection('rfd-202611-455')) && !!ctx.FLOW.cloth.P1['RFD-202611-455'].received);
  ok('pressing it again writes nothing (safe twice)', (await P.pclReceive('RFD-202611-455')) === '' && writes.length === 1);
  ok('a challan not in the list is refused, in words', /not in your list/.test(await P.pclReceive('RFD-1')));

  const office = make({ admin: false, email: 'ppc@x' }, false);
  await office.P.pclLoad('P1');
  ok('someone who may only look at the portal sees the list but no "Cloth received" button, and cannot mark it',
    !/data-pclrecv/.test(office.P.pclSection('')) && /Only the printer/.test(await office.P.pclReceive('RFD-202611-455')) && writes.length === 1);
  const admin = make({ admin: true, email: 'ravi@x' }, false);
  await admin.P.pclLoad('P1');
  ok('an admin looking as the printer may press it', /data-pclrecv="RFD-202611-455"/.test(admin.P.pclSection('')));
  const refused = make({ admin: false, email: 'p1@x' }, true);
  await refused.P.pclLoad('P1'); refused.ctx.ptPut = async () => { throw new Error('permission denied'); };
  ok('a refused save says so and marks nothing', /was not marked received: permission denied/.test(await refused.P.pclReceive('RFD-202611-455')) && !refused.P.PCL.rows.find(c => c.no === 'RFD-202611-455').received);
  const unread = make({ admin: false, email: 'p1@x' }, true);
  unread.ctx.ptGet = async () => { throw new Error('PERMISSION_DENIED'); };
  await unread.P.pclLoad('P1');
  ok('the copies cannot be read from this sign-in: the list says so, in words', /not readable from this sign-in yet/.test(unread.P.pclSection('')));
  daily();
}

/* ---- the printer's Daily challan list and the portal search (daily-challan.js, vendor-portal.js) ---- */
async function daily() {
  console.log('\n== The printer\'s own lists ==');
  const src = fs.readFileSync(path.join(APP, 'vendors', 'portal', 'daily-challan.js'), 'utf8');
  const m = src.match(/async function dchLoad\(force\) \{[\s\S]*?\n\}/);
  const ctx = { DCH: {}, VP: { code: 'P1' }, ptList: o => Object.keys(o || {}).map(k => Object.assign({ id: k }, o[k])),
    ptGet: async () => ({ 'DC-P1-1': { no: 'DC-P1-1', at: '2026-11-23T09:00:00Z' }, 'RFD-202611-455': { kind: 'cloth', no: 'RFD-202611-455', at: '2026-11-23T10:00:00Z' } }) };
  vm.createContext(ctx); vm.runInContext(m[0] + '\n;globalThis.__d = dchLoad;', ctx);
  await ctx.__d(true);
  ok('Daily challan lists only the printer\'s own challans, not the cloth we sent', ctx.DCH.saved.map(c => c.no).join() === 'DC-P1-1');

  const vp = fs.readFileSync(path.join(APP, 'vendors', 'portal', 'vendor-portal.js'), 'utf8');
  const hay = vp.match(/const vpLineHay = [^\n]*\n/)[0], fo = vp.match(/const vpForOrders = [^\n]*\n/)[0];
  const c2 = {}; vm.createContext(c2); vm.runInContext(fo + hay + ';globalThis.__h = vpLineHay;', c2);
  const line = { sku: 'CPCLS-CO-005', fabricType: 'Cambric', forOrders: [{ orderNo: 'AMZ-17102026-02-SEA', qty: 500 }] };
  ok('the portal search finds a printer\'s line by our order number', c2.__h(line).includes('amz-17102026-02-sea') && c2.__h({ sku: 'X' }) === 'x');
  ok('…and the order-level search uses the same order numbers', /\.\.\.vpForOrders\(l\)\]\)\]/.test(vp));
  desk();
}

/* ---- Greige Desk → Inventory (greige-desk.js) ---- */
function desk() {
  console.log('\n== Greige Desk → Inventory: in transit to printers ==');
  const SRC = file('GD_FILE', 'flow/greige-desk.js');
  const code = fs.readFileSync(SRC, 'utf8');
  const rootLine = '  var GD_ROOT = null;', anchor = '  return { open: open,';
  if (code.split(rootLine).length !== 2 || code.split(anchor).length !== 2) throw new Error('greige-desk.js: an anchor this test needs moved; update the test');
  const els = {}, stub = () => ({ value: '', textContent: '', innerHTML: '', className: '', hidden: false, classList: { add() {}, remove() {}, toggle() {}, has: () => false }, getAttribute: () => null, setAttribute() {} });
  const root = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const opened = code.replace(rootLine, '  var GD_ROOT = globalThis.__ROOT;').replace(anchor, '  globalThis.__GDT = { invAll: invAll, invDetail: invDetail, invRfdCell: invRfdCell, UI: UI,'
    + ' setDB: function (v) { DB = v; GD_STATE = "ok"; GD_SNAP = gdSnap(); } };\n' + anchor);
  const transit = [{ no: 'RFD-202611-455', date: '2026-11-23', vendor: 'SS Hand Block', orderNo: 'AMZ-17102026-02-SEA', sku: 'CPCLS-CO-005', metres: 273 },
    { no: 'RFD-202611-455', date: '2026-11-23', vendor: 'SS Hand Block', orderNo: 'AMZ-19102026-01-AIR', sku: 'CPCTB<005>', metres: 4 }];
  const asked = [];
  const ctx = { console, window: { document: {} }, __ROOT: root, ptPatch: async () => {}, ptPut: async () => {}, setTimeout: () => 0, clearTimeout: () => {},
    ME: { admin: true, email: 'test@example.test', tabs: [] },
    FLOW: { ch: { 'RFD-202611-455': {} }, cloth: { P1: {} } }, flowRfdChallanOut: () => 277,
    flowClothInTransit: (name, from) => { asked.push([name, from]); return String(name).toUpperCase() === 'CAMBRIC' ? transit : []; } };
  vm.createContext(ctx); vm.runInContext(opened, ctx);
  const G = ctx.__GDT;
  const db = { gpo: [], fab: [{ id: 'o1', date: '2026-11-21', lot: 'LOT-014', fabricType: 'Cambric', txnType: 'OPENING_RFD', qty: 1149, party: '', bill: '', orderNo: '' }],
    mst: [{ rfd: 'Cambric', greige: 'Greige Cambric 48', active: true, rfdWidth: 44 }], ven: [], co: {}, users: [], me: '' };
  G.setDB(JSON.parse(JSON.stringify(db)));
  const r = G.invAll().filter(x => x.fabric === 'Cambric')[0] || {};
  ok('RFD on shelf 872 m (1,149 less the 277 m on challans); the 277 m in transit are not in the total',
    r.inStoreRfd === 872 && r.owned === 872 && r.transit.length === 2, JSON.stringify({ s: r.inStoreRfd, o: r.owned }));
  ok('…in transit counted from the day the desk began counting Cambric', asked.some(a => a[0] === 'Cambric' && a[1] === '2026-11-21'));
  const cell = G.invRfdCell(r);
  ok('no new column: the RFD on shelf cell keeps its figure and gets a small line "+ 277 m in transit to printers"',
    /data-invd="Cambric\|rfd"/.test(cell) && />872 </.test(cell) && /\+ 277 m in transit to printers/.test(cell) && (cell.match(/<td/g) || []).length === 1, cell);
  const d = G.invDetail(r, 'rfd');
  ok('clicking it: "In transit to printers" lists challan, printer, our order, SKU and metres',
    /In transit to printers · 277 m/.test(d) && /RFD-202611-455/.test(d) && /SS Hand Block/.test(d) && /AMZ-19102026-01-AIR/.test(d) && />4 m</.test(d));
  ok('…a SKU is shown as text, never as HTML', /CPCTB&lt;005&gt;/.test(d));
  const other = { fabric: 'Canvas', inStoreRfd: 84, transit: [] };
  ok('a fabric with nothing in transit: the cell is as before, no line', !/in transit/.test(G.invRfdCell(other)) && /84/.test(G.invRfdCell(other)));
  ctx.FLOW = { ch: {} };   // the copies not read yet
  G.setDB(JSON.parse(JSON.stringify(db)));
  const r2 = G.invAll().filter(x => x.fabric === 'Cambric')[0] || {};
  ok('the printers\' copies not read yet: nothing in transit, nothing invented', Array.isArray(r2.transit) && r2.transit.length === 0 && !/in transit/.test(G.invRfdCell(r2)));
  finish();
}
function finish() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
