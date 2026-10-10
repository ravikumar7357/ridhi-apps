/* Production flow (src/app/flow/*): which bucket a line is in, PPC's plan, Demand's reservations, and the screen.
 *   node tests/flow-test.js      (FLOW_DIR=<dir> to test another copy — teeth/teeth-flow.js does) */
const fs = require('fs'), path = require('path');
const DIR = process.env.FLOW_DIR || path.join(__dirname, '..', 'src', 'app', 'flow');
const SRC = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-challan.js', 'flow-test-order.js', 'flow-view.js'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
const L = (o) => Object.assign({ orderNo: 'AMZ-1', sku: 'S1', qty: 100, orderDate: '2026-10-12', src: 'AMZ', cutReq: false, cut: 0, issued: 0, received: 0, pressed: 0,
  printer: '', printed: 0, open: true, handedAt: '', shopDoneAt: '' }, o);

function load(opts) {
  opts = opts || {};
  const els = {}, writes = [];
  const el = id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, onclick: null });
  const W = { lines: opts.lines || [], vendor: opts.vendor || {}, qc: opts.qc || {}, fg: opts.fg || {}, shelf: opts.shelf || [] };
  const ctx = {
    $: el, document: { querySelectorAll: () => [], querySelector: () => null }, localStorage: { getItem: k => (opts.ls || {})[k] ?? null },
    location: { hostname: opts.host || 'price-research-48ff3--flow-abc.web.app' },
    ME: Object.assign({ email: 'ppc@x', admin: false, tabs: [] }, opts.me || {}),
    obUC, esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])), nf: v => String(v),
    dToday: () => '2026-10-13', ptIsoDate: v => String(v || '').slice(0, 10),
    ordLines: () => W.lines, ordVendorOf: (o, s) => W.vendor[o + '|' + s] || null, ordQcOf: (o, s) => W.qc[o + '|' + s] || null,
    ordFgAt: (o, s) => W.fg[o + '|' + s] || null, ordWaitingAt: () => '', ordIsMto: no => /^(SHP|ONL)-/.test(no), ordJourney: () => {},
    accBalances: () => W.shelf, accCode: c => String(c == null ? '' : c).trim().toUpperCase(),
    cutSkuOf: sku => (opts.mdb || {})[sku] || null,
    ptConsPlan: m => (m && m.cons ? { metres: m.cons, fabric: m.fab } : { why: 'no cloth per piece' }),
    recipeValue: (m, f) => (m && m.recipe ? m.recipe[f] : undefined),
    ptPrintNeeded: m => !(m && m.noPrint), ptPrintIssueAs: () => 'metres',
    bdMaterialsFor: (sku, pcs) => { const m = (opts.mdb || {})[sku]; return m && m.chainLength ? [{ kind: 'zip', what: m.chainLength + '" zip', qty: pcs, unit: 'pcs' }] : []; },
    ptPatch: async p => { if (opts.writeFails) throw new Error('denied'); writes.push(p); },
    ptGet: async node => (opts.db || {})[node] || null,
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, ptFillSelect: () => {}, ptImgOf: () => '', ptImgSrc: u => u, showTab: () => {},
    ptLoadGates: async () => {}, ordCutReq: sku => !/NOCUT/.test(sku), confirm: () => true, PTG: { mdb: [] }, setTimeout, clearTimeout,
    voAllVendors: () => [{ code: 'V9', desc: 'Kalu Mill', category: 'Mill' }, { code: 'P1', desc: 'Sanganer Prints', category: 'Printer' }],
    window: { open: () => (opts.popupBlocked ? null : { document: { open() {}, write(h) { (ctx.__win = ctx.__win || []).push(h); }, close() {} } }) }, GPO: { settings: { company: 'Ridhi Home & Living' } },
    FAB: { rows: [] }, ptList: x => x || [], fabAutoLoad: async () => {}, fabStockOf: (name, st) => (st === 'RFD' ? (opts.rfd || {})[String(name).toUpperCase()] || 0 : 0),
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { FLOW_ON, FLOW_BUCKETS, FLOW_TABS, flowBucketsAllowed, flowKey, FLOW:()=>FLOW, setFLOW:v=>{FLOW=v}, flowLoad, flowState, flowRows, flowSuggest, flowHeld, flowAccFree, flowReserve, flowUnreserve, flowTable, renderFlow, flowPpcOpen, flowFabricOpen, flowInView, flowRfdCover, flowAccCover, flowChallanOpen, flowChallanNo, flowChallanHtml, flowChallanPrint, flowTestOpen, flowTestDelete, flowSimulate, flowTestLines, setView:v=>{FLOW_VIEW=v} };')(...Object.values(ctx));
  api.setFLOW(Object.assign(api.FLOW(), { ppc: opts.ppc || {}, dem: opts.dem || {}, res: opts.res || {} }));
  return Object.assign(api, { els, writes, W, ctx });
}
const plan = (o) => Object.assign({ orderNo: 'AMZ-1', sku: 'S1', qty: 100, fabric: { name: 'Cotton', perPc: 0.5, metres: 50 }, acc: [], print: { need: true }, dates: {} }, o);
const K = 'AMZ-1__S1';

(async () => {
  console.log('== the switch ==');
  ok('on for a preview link (host has --)', load().FLOW_ON === true);
  ok('off on the live app', load({ host: 'price-research-48ff3.web.app' }).FLOW_ON === false);
  ok('localStorage flow=1 turns it on anywhere, flow=0 off anywhere',
    load({ host: 'price-research-48ff3.web.app', ls: { flow: '1' } }).FLOW_ON === true && load({ ls: { flow: '0' } }).FLOW_ON === false);

  console.log('== each bucket its own right ==');
  ok('eleven buckets, eleven rights', load().FLOW_TABS.length === 11 && new Set(load().FLOW_TABS).size === 11);
  ok('an admin sees every bucket', load({ me: { admin: true } }).flowBucketsAllowed().length === 11);
  ok('PPC staff see PPC only', load({ me: { tabs: ['flppc', 'ord'] } }).flowBucketsAllowed().map(b => b[0]).join() === 'ppc');
  ok('nobody with no right sees any', load({ me: { tabs: ['ord'] } }).flowBucketsAllowed().length === 0);
  ok('a key is safe for the database (no . # $ [ ] /)', load().flowKey('amz/1.2', 's#1') === 'AMZ_1_2__S_1');

  console.log('== THE RULE: a new order line walks the buckets by itself ==');
  let A = load();
  const b = r => A.flowState(r).bucket;
  ok('a new order with no plan is in PPC', b(L()) === 'ppc');
  A = load({ ppc: { [K]: plan() } });
  ok('planned, fabric not ready → Demand', b(L()) === 'demand');
  A = load({ ppc: { [K]: plan() }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  ok('fabric ready, printed, nothing given → Vendor allocation', b(L()) === 'vendor');
  A = load({ ppc: { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  ok('fabric ready but accessories not reserved → still Demand', b(L()) === 'demand');
  A = load({ ppc: { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) }, dem: { [K]: { fabricReady: { at: 'x' } } }, res: { [K]: { items: { 18: 100 } } } });
  ok('…reserved too → moves on', b(L()) === 'vendor');
  const ready = { ppc: { [K]: plan() }, dem: { [K]: { fabricReady: { at: 'x' } } } };
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 40 } } }, ready));
  ok('all given, 40 back → Printed fabric in', b(L()) === 'fabric');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } } }, ready));
  ok('all back, cutting needed, not cut → Cutting', b(L({ cutReq: true, cut: 60 })) === 'cut');
  ok('all cut → Raw cutting in store', b(L({ cutReq: true, cut: 100 })) === 'raw');
  ok('all issued → WIP', b(L({ cutReq: true, cut: 100, issued: 100, received: 30 })) === 'wip');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 100 } } }, ready));
  ok('all QC passed, not in Finished Goods → Ready', b(L({ issued: 100, received: 100 })) === 'ready');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 100 } }, fg: { 'AMZ-1|S1': { in: 100 } } }, ready));
  ok('in India stock → done', b(L({ issued: 100, received: 100 })) === 'done');
  ok('handed to shipping is done whatever else says', b(L({ handedAt: '2026-10-12' })) === 'done');
  A = load({ ppc: { [K]: plan({ print: { need: false } }) }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  ok('PPC said not printed → skips both printer buckets', b(L()) === 'raw');
  ok('pressed counts as made, like QC (5 Oct rule)', b(L({ issued: 100, pressed: 100 })) === 'ready');
  ok('figures over the order are capped at it', A.flowState(L({ issued: 250 })).issued === 100);

  console.log('== Demand is two departments ==');
  A = load({ ppc: { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) }, res: { [K]: { items: { 18: 100 } } } });
  let st = A.flowState(L());
  ok('fabric not ready, accessories reserved → in the RFD list only', A.flowInView('drfd', st) && !A.flowInView('dacc', st));
  A = load({ ppc: { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  st = A.flowState(L());
  ok('fabric ready, accessories not reserved → in the Accessories list only', !A.flowInView('drfd', st) && A.flowInView('dacc', st));
  A = load({ ppc: { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) } });
  st = A.flowState(L());
  ok('neither → in both lists', A.flowInView('drfd', st) && A.flowInView('dacc', st));

  console.log('== how it is made: stitching only, or outsourced ==');
  A = load({ ppc: { [K]: plan({ route: 'stitch', print: { need: true } }) }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  ok('stitching only skips both printer buckets, whatever the print rule says', b(L({ cutReq: true })) === 'cut');
  A = load({ ppc: { [K]: plan({ route: 'outsource', outVendor: 'ABC', acc: [{ code: '18', qty: 100 }] }) } });
  ok('outsourced: no Demand, no fabric, straight to Outsourced', b(L()) === 'out' && !A.flowState(L()).needAcc);
  A = load({ ppc: { [K]: plan({ route: 'outsource', outVendor: 'ABC' }) }, fg: { 'AMZ-1|S1': { in: 100 } } });
  ok('…done when received into Finished Goods', b(L()) === 'done');
  A = load({ ppc: { [K]: plan({ route: 'outsource', outVendor: 'ABC' }) }, fg: { 'AMZ-1|S1': { in: 40 } } });
  ok('…still waiting with 40 of 100 in', b(L()) === 'out' && A.flowState(L()).india === 40);

  console.log('== RFD in stock against the lines (red flag when short) ==');
  const pl = (sku, m, extra) => plan(Object.assign({ sku, fabric: { name: 'Sheeting 58', perPc: 1, metres: m } }, extra));
  A = load({ rfd: { 'SHEETING 58': 100 }, lines: [L({ sku: 'S1', orderDate: '2026-10-11' }), L({ sku: 'S2', orderDate: '2026-10-12' }), L({ sku: 'S3', orderDate: '2026-10-12', orderNo: 'AMZ-2' })],
    ppc: { [K]: pl('S1', 60), 'AMZ-1__S2': pl('S2', 60), 'AMZ-2__S3': pl('S3', 30) }, dem: { 'AMZ-2__S3': { fabricReady: { at: 'x', what: 'Sheeting 58', metres: 30 } } } });
  let cv = A.flowRfdCover();
  ok('a line marked ready whose cloth has not moved keeps its metres out of the stock', cv.fab['SHEETING 58'].held === 30 && cv.fab['SHEETING 58'].free === 70);
  ok('the oldest order is served first: covered', cv.line[K].short === 0 && cv.line[K].avail === 70);
  ok('the next is short by what is left: 60 needed, 10 left → short 50', cv.line['AMZ-1__S2'].short === 50 && cv.line['AMZ-1__S2'].avail === 10);
  ok('the fabric total says short 50', cv.fab['SHEETING 58'].need === 120 && cv.fab['SHEETING 58'].short === 50);
  A.W.lines[2].issued = 10;
  A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
  ok('once its cloth moved (issued), it is no longer held — the register has taken it', A.flowRfdCover().fab['SHEETING 58'].held === 0);
  A = load({ me: { tabs: ['fldem'] }, rfd: { 'SHEETING 58': 50 }, lines: [L()], ppc: { [K]: pl('S1', 60) } });
  A.setView('drfd'); A.renderFlow();
  ok('the RFD list flags the line red: SHORT 10 m', /SHORT 10 m/.test(A.els.flTable.innerHTML) && /fef2f2/.test(A.els.flTable.innerHTML));
  ok('…and the panel shows stock, need and short per fabric', /RFD in stock against these orders/.test(A.els.flPanel.innerHTML) && /⚑ 10 m/.test(A.els.flPanel.innerHTML));
  ok('accessories are not in the RFD department', !/Reserve/.test(A.els.flTable.innerHTML));
  A = load({ me: { tabs: ['flacc'] }, lines: [L()], ppc: { [K]: pl('S1', 60, { acc: [{ code: '18', qty: 100 }] }) }, shelf: [{ code: '18', name: '18in zip', qty: 70 }] });
  A.setView('dacc'); A.renderFlow();
  ok('the Accessories list flags short 30 and offers Reserve', /short 30/.test(A.els.flTable.innerHTML) && /data-flres/.test(A.els.flTable.innerHTML));
  ok('…its panel: shelf 70, need 100, short 30', A.flowAccCover()[0].short === 30 && /Accessories on the shelf/.test(A.els.flPanel.innerHTML));
  ok('fabric is not in the Accessories department', !/Mark fabric ready/.test(A.els.flTable.innerHTML));

  console.log('== RFD challan, order-wise, to one vendor ==');
  {
    const pl2 = (sku, m) => plan({ sku, fabric: { name: 'Sheeting 62', perPc: 1, metres: m } });
    A = load({ me: { tabs: ['fldem', 'flfab'] }, rfd: { 'SHEETING 62': 500 }, lines: [L({ sku: 'S1', articleSubtype: 'Square Tablecloth', color: 'Almond', size: '60x60' }), L({ sku: 'S2' }), L({ orderNo: 'AMZ-9', sku: 'S3' })],
      ppc: { [K]: pl2('S1', 66), 'AMZ-1__S2': pl2('S2', 83.7), 'AMZ-9__S3': pl2('S3', 10) } });
    A.setView('drfd'); A.renderFlow();
    ok('one "Challan for this PO" button per PO', (A.els.flTable.innerHTML.match(/data-flch="AMZ-1"/g) || []).length === 1 && /data-flch="AMZ-9"/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1');
    ok('the challan holds only this PO’s lines', /S1/.test(A.ctx.__dlg.html) && /S2/.test(A.ctx.__dlg.html) && !/S3/.test(A.ctx.__dlg.html));
    ok('…and offers the printers first', A.ctx.__dlg.html.indexOf('Sanganer') < A.ctx.__dlg.html.indexOf('Kalu'));
    const QS = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '66' }, '[data-chk="1"]': { checked: false }, '[data-chm="1"]': { value: '83.7' } };
    A.ctx.document.querySelector = sel => QS[sel] || null;
    A.els.flcVen = { value: '' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: 'tempo' };
    ok('no vendor → refused, nothing written', /Which vendor/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    A.els.flcVen.value = 'P1';
    QS['[data-chm="0"]'].value = '';
    ok('a ticked line with no metres → refused', /How many metres/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    QS['[data-chm="0"]'].value = '66';
    const e3 = await A.ctx.__dlg.onSave();
    const cw = A.writes[0] || {}, chs = cw['pt_flowChallans/RFD-202610-001'];
    ok('saved as RFD-202610-001: order, vendor, the ticked line only', !e3 && chs && chs.orderNo === 'AMZ-1' && chs.vendor.name === 'Sanganer Prints' && chs.lines.length === 1 && chs.lines[0].metres === 66, e3 || JSON.stringify(Object.keys(cw)));
    ok('the line’s fabric is marked given on that challan, in the same write', cw['pt_flowDemand/' + K + '/fabricReady'].challan === 'RFD-202610-001' && !cw['pt_flowDemand/AMZ-1__S2/fabricReady']);
    ok('the line moves on to Vendor allocation; the unticked one stays in RFD', A.flowState(L()).bucket === 'vendor' && A.flowInView('drfd', A.flowState(L({ sku: 'S2' }))));
    const page = (A.ctx.__win || [])[0] || '';
    ok('the challan opens to print: number, order, vendor, item, metres, signatures', /DELIVERY CHALLAN/.test(page) && /RFD-202610-001/.test(page) && /AMZ-1/.test(page) && /Sanganer Prints/.test(page) && /Square Tablecloth · Almond · 60x60/.test(page) && /66/.test(page) && /Received by/.test(page) && /Ridhi Home/.test(page));
    ok('the next challan that month is 002', A.flowChallanNo('2026-10-20') === 'RFD-202610-002' && A.flowChallanNo('2026-11-01') === 'RFD-202611-001');
    let cv2 = A.flowRfdCover();
    ok('its metres are kept out of the RFD stock', cv2.fab['SHEETING 62'].held === 66);
    A.W.vendor['AMZ-1|S1'] = { given: 100, back: 0 }; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('…still kept once the vendor order is placed (the register has not taken it)', A.flowRfdCover().fab['SHEETING 62'].held === 66);
    A.W.vendor['AMZ-1|S1'] = { given: 100, back: 20 }; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('…let go once printed cloth comes back', A.flowRfdCover().fab['SHEETING 62'].held === 0);
    A.setView('fabric'); A.renderFlow();
    ok('Printed fabric in shows which challan it went on', /RFD-202610-001/.test(A.els.flTable.innerHTML) && /Sanganer/.test(A.els.flTable.innerHTML));
    A.setView('drfd'); A.renderFlow();
    ok('the challans made are listed to print again', /Challans made/.test(A.els.flPanel.innerHTML) && /data-flchp="RFD-202610-001"/.test(A.els.flPanel.innerHTML));
    const B = load({ popupBlocked: true }); B.setFLOW(Object.assign(B.FLOW(), { ch: { X: { no: 'X', lines: [] } } }));
    ok('a blocked pop-up is said, not swallowed', /blocked/.test(B.flowChallanPrint('X')));
  }

  console.log('== a TEST order walks every bucket, end to end ==');
  {
    A = load({ me: { admin: true }, lines: [L({ orderNo: 'AMZ-REAL', sku: 'R1' })], mdb: { S1: { cons: 0.5, fab: 'Cotton', articleSubtype: 'Napkin' }, X1: { cons: 1, fab: 'Cotton' } }, rfd: { COTTON: 999 } });
    A.ctx.__win = [];
    A.flowTestOpen();
    const QS = { '[data-tsku="0"]': { value: 's1' }, '[data-tqty="0"]': { value: '10' }, '[data-tsku="1"]': { value: 'NOPE' }, '[data-tqty="1"]': { value: '5' } };
    A.ctx.document.querySelector = sel => QS[sel] || null;
    A.els.fltSrc = { value: 'AMZ' };
    ok('a SKU not in the master is refused, named', /NOPE is not in the master/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    QS['[data-tsku="1"]'].value = '';
    ok('saved as TEST-AMZ-<date>-01, in pt_flowTest only', !(await A.ctx.__dlg.onSave()) && A.writes.length === 1 && A.writes[0]['pt_flowTest/TEST-AMZ-13102026-01']);
    const TN = 'TEST-AMZ-13102026-01', TK = TN + '__S1', T = () => A.flowRows().find(x => x.r.orderNo === TN);
    ok('the real order book is untouched; the test line sits beside it', A.W.lines.length === 1 && A.flowRows().some(x => x.r.orderNo === 'AMZ-REAL') && T());
    ok('it starts in PPC, with the master’s description', T().s.bucket === 'ppc' && T().r.articleSubtype === 'Napkin');
    A.setView('ppc'); A.renderFlow();
    ok('the row says TEST and offers delete, not the order journey', /TEST/.test(A.els.flTable.innerHTML) && /data-fltdel/.test(A.els.flTable.innerHTML) && !/data-ordj="TEST/.test(A.els.flTable.innerHTML));
    A.ctx.document.querySelectorAll = () => [];
    A.flowPpcOpen(TN); await A.ctx.__dlg.onSave();
    ok('PPC plans it for real → Demand · RFD', A.flowInView('drfd', T().s));
    A.ctx.document.querySelector = sel => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '5' } })[sel] || null;
    A.flowChallanOpen(TN); A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-13' }; A.els.flcNote = { value: '' };
    await A.ctx.__dlg.onSave();
    ok('its challan is numbered apart (TRFD-…), never using a real number', A.FLOW().ch['TRFD-202610-001'] && A.flowChallanNo('2026-10-13') === 'RFD-202610-001');
    ok('→ Vendor allocation', T().s.bucket === 'vendor');
    const walk = [['vendor', 'fabric'], ['fabric', 'cut'], ['cut', 'raw'], ['raw', 'wip'], ['wip', 'ready'], ['ready', 'done']];
    for (const [from, to] of walk) {
      A.setView(from); A.renderFlow();
      const btn = new RegExp('data-flsim="' + TN + '\|S1\|' + from + '"').test(A.els.flTable.innerHTML);
      const er = await A.flowSimulate(TN, 'S1', from);
      ok(`${from}: a Simulate button, and pressing it moves the line to ${to}`, btn && !er && A.flowState(T() ? T().r : A.flowTestLines()[0]).bucket === to, er || (T() ? T().s.bucket : 'gone'));
    }
    ok('the simulation is written on the test order only', A.writes.every(w => Object.keys(w).every(k => /^pt_(flowTest|ppc|flowDemand|flowChallans|accReserve)\//.test(k))));
    const n0 = A.writes.length;
    ok('delete test removes the order, its plan, its demand and its challan', !(await A.flowTestDelete(TN)) && (() => { const w = A.writes[n0];
      return w['pt_flowTest/' + TN] === null && w['pt_ppc/' + TK] === null && w['pt_flowDemand/' + TK] === null && w['pt_flowChallans/TRFD-202610-001'] === null; })());
    ok('…and it is gone from every bucket', !A.flowRows().some(x => x.r.orderNo === TN));
  }

  console.log('== old orders are not dumped into PPC ==');
  A = load();
  ok('an order from before 10 Oct skips PPC and Demand: at the step it is really at', b(L({ orderDate: '2026-09-01' })) === 'raw');
  ok('…and an old printed line with a printer is at the printer', b(L({ orderDate: '2026-09-01', printer: 'P1', printed: 10 })) === 'fabric');
  ok('an old line already in stock and not open is not listed at all', b(L({ orderDate: '2026-09-01', issued: 100, pressed: 100, open: false })) === 'done');
  A = load({ lines: [L({ orderDate: '2026-09-01', handedAt: 'x' }), L({ sku: 'S2', handedAt: 'x' }), L({ sku: 'S3' })] });
  const rows = A.flowRows();
  ok('done lines leave the list, except a new order\'s (last 7 days)', rows.length === 2 && !rows.some(x => x.r.orderDate === '2026-09-01'));
  ok('the rows are cached until a plan changes', A.flowRows() === rows);
  A.setFLOW(Object.assign(A.FLOW(), { ppc: { [K]: plan() } }));
  ok('…and worked out again when one does', A.flowRows() !== rows);

  console.log('== PPC: the plan the app suggests ==');
  A = load({ mdb: { S1: { cons: 0.62, fab: 'Cotton Slub', chainLength: '18' } } });
  let sg = A.flowSuggest(L());
  ok('fabric from cloth per piece: name, per piece, metres for the line', sg.fabric.name === 'Cotton Slub' && sg.fabric.perPc === 0.62 && sg.fabric.metres === 62);
  ok('the zipper is an accessory, by its code, one per piece', sg.acc.length === 1 && sg.acc[0].code === '18' && sg.acc[0].qty === 100);
  ok('planned dates from today, ready = +10', sg.dates.cut === '2026-10-16' && sg.dates.ready === '2026-10-23');
  ok('a make-to-order due date is the ready date', A.flowSuggest(L({ mtoDue: '2026-10-19' })).dates.ready === '2026-10-19');
  A = load({ mdb: { S1: { recipe: { consumption: 0.3, fabric: 'Linen', isPiping: true, pipingMeters: 2 } } } });
  sg = A.flowSuggest(L());
  ok('no cloth per piece → the recipe consumption', sg.fabric.name === 'Linen' && sg.fabric.metres === 30 && sg.fabric.how === 'recipe consumption');
  ok('piping goes to other materials', sg.extra.some(x => x.what === 'Piping' && x.qty === 200));
  sg = load().flowSuggest(L());
  ok('nothing known → blank, and the gap is named (never invented)', sg.fabric.metres === 0 && sg.gaps.length > 0);

  console.log('== PPC: raising the plan ==');
  A = load({ lines: [L(), L({ sku: 'S2', qty: 40 })], mdb: { S1: { cons: 0.5, fab: 'Cotton' } } });
  A.flowPpcOpen('AMZ-1');
  ok('one dialog for every line of the PO still in PPC', /2 line/.test(A.ctx.__dlg.subtitle));
  let err = await A.ctx.__dlg.onSave();
  ok('a line with no fabric is refused, named — nothing written', /S2/.test(err) && A.writes.length === 0, err);
  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: 'Cotton' } } });
  A.flowPpcOpen('AMZ-1');
  err = await A.ctx.__dlg.onSave();
  const w = A.writes[0] || {};
  ok('saved under pt_ppc/<line> with who and when', !err && w['pt_ppc/' + K] && w['pt_ppc/' + K].by === 'ppc@x' && w['pt_ppc/' + K].at, err);
  ok('the gaps list is not saved', w['pt_ppc/' + K] && !('gaps' in w['pt_ppc/' + K]));
  ok('the line moves to Demand by itself', A.flowState(L()).bucket === 'demand');
  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: 'Cotton' } }, writeFails: true });
  A.flowPpcOpen('AMZ-1');
  ok('a refused write is said, and the line stays', /Could not save/.test(await A.ctx.__dlg.onSave()) && A.flowState(L()).bucket === 'ppc');

  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: '', chainLength: '18' } } });
  A.flowPpcOpen('AMZ-1');
  A.ctx.document.querySelectorAll = () => [{ dataset: { fp: '0', k: 'route' }, type: 'select-one', value: 'outsource' }];
  err = await A.ctx.__dlg.onSave();
  ok('an outsourced line must name who makes it', /outsource vendor/.test(err) && !A.writes.length, err);
  A.ctx.document.querySelectorAll = () => [{ dataset: { fp: '0', k: 'route' }, type: 'select-one', value: 'outsource' }, { dataset: { fp: '0', k: 'outVendor' }, type: 'text', value: 'ABC Exports' }];
  err = await A.ctx.__dlg.onSave();
  const ow = (A.writes[0] || {})['pt_ppc/' + K] || {};
  ok('…then it saves with no fabric needed, not printed, no accessories', !err && ow.route === 'outsource' && ow.outVendor === 'ABC Exports' && ow.print.need === false && !ow.acc.length, err);
  ok('…and goes to Outsourced, not Demand', A.flowState(L()).bucket === 'out');

  console.log('== Demand: fabric ready ==');
  A = load({ lines: [L()], ppc: { [K]: plan() } });
  let s = A.flowState(L());
  A.flowFabricOpen(L(), s);
  A.els.flfM = { value: '30' }; A.els.flfWhat = { value: 'Cotton' }; A.els.flfNote = { value: '' };
  ok('less than PPC raised is not ready', /50/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
  A.els.flfM.value = '50';
  ok('all of it is: written, with who', !(await A.ctx.__dlg.onSave()) && A.writes[0]['pt_flowDemand/' + K + '/fabricReady'].by === 'ppc@x');

  console.log('== Demand: accessories reserved ==');
  const accPlan = { [K]: plan({ acc: [{ code: '18', qty: 100 }] }) };
  A = load({ lines: [L()], ppc: accPlan, shelf: [{ code: '18', name: '18" zip', qty: 150 }] });
  s = A.flowState(L());
  ok('free = shelf when nothing is held', A.flowAccFree()['18'].free === 150);
  ok('reserving writes pt_accReserve/<line>', !(await A.flowReserve(L(), s)) && A.writes[0]['pt_accReserve/' + K].items['18'] === 100);
  ok('…and holds it: 50 left free', A.flowAccFree()['18'].held === 100 && A.flowAccFree()['18'].free === 50);
  const K2 = 'AMZ-1__S2';
  A.W.lines.push(L({ sku: 'S2' }));
  A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc, { [K2]: plan({ sku: 'S2', acc: [{ code: '18', qty: 100 }] }) }) }));
  const e2 = await A.flowReserve(L({ sku: 'S2' }), A.flowState(L({ sku: 'S2' })));
  ok('a second line wanting 100 when 50 are free is refused, all of it, short named', /18 needs 100, 50 free/.test(e2) && A.writes.length === 1, e2);
  ok('a held reservation lets go as the line is issued (60 issued → 40 held)', JSON.stringify(A.flowHeld(K, 60, 100)) === '{"18":40}');
  ok('fully issued holds nothing — the zipper was taken at issue, not twice', Object.keys(A.flowHeld(K, 100, 100)).length === 0);
  ok('release frees it', !(await A.flowUnreserve(A.flowState(L()))) && A.flowAccFree()['18'].free === 150);
  A = load({ lines: [L()], ppc: { [K]: plan() } });
  ok('nothing to reserve is said', /Nothing to reserve/.test(await A.flowReserve(L(), A.flowState(L()))));

  console.log('== the screen ==');
  A = load({ me: { tabs: ['flppc', 'flwip'] }, lines: [L(), L({ orderNo: 'AMZ-0', orderDate: '2026-09-01', issued: 100 })] });
  A.renderFlow();
  ok('only the buckets this account holds are buttons', /data-flb="ppc"/.test(A.els.flBuckets.innerHTML) && /data-flb="wip"/.test(A.els.flBuckets.innerHTML) && !/data-flb="drfd"/.test(A.els.flBuckets.innerHTML));
  ok('it opens on PPC, with the new line and a Plan button', /AMZ-1/.test(A.els.flTable.innerHTML) && /data-flppc="AMZ-1"/.test(A.els.flTable.innerHTML));
  ok('the old line is not in PPC', !/AMZ-0/.test(A.els.flTable.innerHTML));
  A.setView('wip'); A.renderFlow();
  ok('…it is in WIP, with a button to QC', /AMZ-0/.test(A.els.flTable.innerHTML) && /data-flgo="qc"/.test(A.els.flTable.innerHTML));
  ok('the page says it is a test view', /TEST VIEW/.test(A.els.flMsg.textContent));
  A = load({ me: { tabs: ['ord'] } });
  A.renderFlow();
  ok('no bucket → says so, draws nothing', /No bucket/.test(A.els.flMsg.textContent) && !A.els.flTable.innerHTML);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
