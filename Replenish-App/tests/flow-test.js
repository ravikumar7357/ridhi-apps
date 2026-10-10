/* Production flow (src/app/flow/*): which bucket a line is in, PPC's plan, Demand's reservations, and the screen.
 *   node tests/flow-test.js      (FLOW_DIR=<dir> to test another copy — teeth/teeth-flow.js does) */
const fs = require('fs'), path = require('path');
const DIR = process.env.FLOW_DIR || path.join(__dirname, '..', 'src', 'app', 'flow');
const SRC = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-challan.js', 'flow-test-order.js', 'flow-receive.js', 'flow-printorder.js', 'flow-edit.js', 'flow-entries.js', 'flow-qcfg.js', 'flow-view.js'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
const L = (o) => Object.assign({ orderNo: 'AMZ-1', sku: 'S1', qty: 100, orderDate: '2026-10-12', src: 'AMZ', cutReq: false, cut: 0, issued: 0, received: 0, pressed: 0,
  printer: '', printed: 0, open: true, handedAt: '', shopDoneAt: '' }, o);

function load(opts) {
  opts = opts || {};
  const els = {}, writes = [];
  const el = id => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', className: '', style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, addEventListener() {}, onclick: null });
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
    ptLoadGates: async () => {},
    showTab: t => { (ctx.__tabs = ctx.__tabs || []).push(t); }, ensureCutForm: async () => {}, cutSkuTyped: () => {}, renderCutForm: () => {}, renderCutFab: () => {},
    ensureBdForm: async () => {}, bdSkuTyped: () => {}, renderBdForm: () => {}, bdMatFill: () => {}, qcSkuTyped: () => {}, renderQcCheckForm: () => {},
    jwRecvOpen: id => { ctx.__recv = id; },
    ptStampDate: d => String(d || ''), ptNow: () => '2026-10-13T10:00:00Z', qcParts: sku => ({ brand: 'Ridhi', at: 'Pillow Cover', sub: 'x', col: 'c', size: 's' }), QC: { checks: opts.qcChecks || [] },
    bdApplyRecv: (row, add) => { const recv = (+row.receivedPieces || 0) + add, iss = +row.issuePieces || 0, rej = +row.rejectionPieces || 0;
      if (recv + rej > iss) return { err: 'more than issued' }; return { row: Object.assign({}, row, { receivedPieces: recv, pendingPieces: iss - recv - rej, frozen: iss - recv - rej <= 0 }) }; },
    bdApplyRej: (row, val) => { const recv = +row.receivedPieces || 0, iss = +row.issuePieces || 0; if (recv + val > iss) return { err: 'more than issued' };
      return { row: Object.assign({}, row, { rejectionPieces: val, pendingPieces: iss - recv - val, frozen: iss - recv - val <= 0 }) }; },
    ptLoadEmp: async () => {}, ptEmpTypes: () => ['Company Contractor', 'External Contractor'],
    ptEmpsOfType: t => ({ 'Company Contractor': [['Company Contractor', 'Ramesh'], ['Company Contractor', 'Suresh']], 'External Contractor': [['External Contractor', 'Pradeep']] })[t] || [],
    cutFabrics: () => ['Canvas', 'Cotton', 'Sheeting 82'], ptDlgClose: () => {}, PT: { base: opts.base || [] }, ORD_IX: {}, palKey: (b, c) => (b || '') + '|' + c, palInfoOf: k => (opts.pal || {})[k] || {}, VO: { rows: opts.vo || [] }, voLines: o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})), voNewOrderNo: (() => { let n = 0; return () => 'VPO-261010-T' + (++n); })(), voTodayDMY: () => '10/10/2026', ordCutReq: sku => !/NOCUT/.test(sku), confirm: q => { (ctx.__asked = ctx.__asked || []).push(q); return !opts.confirmNo; }, PTG: { mdb: [] }, setTimeout, clearTimeout,
    voAllVendors: () => [{ code: 'V9', desc: 'Kalu Mill', category: 'Mill' }, { code: 'P1', desc: 'Sanganer Prints', category: 'Printer' }, { code: 'P2', desc: 'Choudhary Hand Block', category: 'Printer' }],
    window: { open: () => (opts.popupBlocked ? null : { document: { open() {}, write(h) { (ctx.__win = ctx.__win || []).push(h); }, close() {} } }) }, GPO: { settings: { company: 'Ridhi Home & Living' } },
    ordPrintAsPcs: m => !!(m && m.asPcs), ptPrintFabric: m => (m && m.pfab) || '', ptPrintDir: m => (m && m.dir) || '',
    ordFabSkuOf: (f, c, d, code) => Object.entries(opts.fsku || {}).filter(([k]) => { const [kf, kc, kd, kk] = k.split('|'); return kf === f && kc === c && (!d || kd === d) && kk === code; }).map(([, v]) => v).join(' '),
    ordFabHits: (f, c, d, code) => Object.keys(opts.fsku || {}).filter(k => { const [kf, kc, kd, kk] = k.split('|'); return kf === f && kc === c && (!d || kd === d) && (!code || kk === code); }).map(k => ({ dir: k.split('|')[2] })),
    ptPrintIssueAs: m => (m && m.issueAs) || '',
    /* The catalogue as the app builds it: rows carrying their own colour code (fsku keys: fabric|colour|dir|code). */
    voFabricCatalogue: () => new Map(Object.entries(opts.fsku || {}).map(([k, v]) => { const [fabric, colour, dir, code] = k.split('|'); return [v, { sku: v, fabric, colour, dir, code }]; })
      .concat((opts.fsCat || []).map(c => [c.sku, c]))), ordColCodeOf: sku => (String(sku || '').toUpperCase().match(/^[A-Z]+(\d{1,5})/) || ['', ''])[1],
    FAB: { rows: opts.fabRows || [] },
    STORE: { rows: opts.store ? [] : null }, stMoves: () => opts.store || [], stBalances: mv => mv, fabKey: v => String(v || '').trim().toUpperCase(), fabAll: () => opts.fabRows || [], ptList: x => x || [], fabAutoLoad: async () => {}, fabStockOf: (name, st) => (st === 'RFD' ? (opts.rfd || {})[String(name).toUpperCase()] || 0 : 0),
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { FLOW_ON, FLOW_BUCKETS, FLOW_TABS, flowBucketsAllowed, flowKey, FLOW:()=>FLOW, setFLOW:v=>{FLOW=v}, flowLoad, flowState, flowRows, flowSuggest, flowHeld, flowAccFree, flowReserve, flowUnreserve, flowTable, renderFlow, flowPpcOpen, flowFabricOpen, flowInView, flowRfdCover, flowAccCover, flowChallanOpen, flowChallanNo, flowChallanHtml, flowChallanPrint, flowTestOpen, flowTestDelete, flowSimulate, flowTestLines, flowTestCutOpen, flowTestIssueOpen, flowTestRecvOpen, flowFgAcceptOpen, flowFgAccept, flowFgRejectOpen, flowFgReject, flowFgLines, flowFgRender, flowQcLine, flowTestOnly, flowTestOnlySet, flowReceiveOpen, flowCloseShortOpen, flowPrinterFor, flowChIndex, flowCommitted, flowCutEntry, flowIssueEntry, flowRecvEntry, flowQcEntry, flowIssuable, flowPrintWhat, flowChPrintGroups, flowMasterDiff, flowPrintExtras, flowToPrint, flowChallanForKeys, flowByPrintTable, flowPoSync, flowPoIndex, flowPoHtml, flowPoPrint, flowPoTable, flowFabOwed, flowVoLines, VOrows:()=>VO.rows, setVOrows:v=>{VO.rows=v}, flowUnplan, flowChallanEditOpen, flowChallanCancelOpen, flowUndoReceipt, flowReopen, setAngle:(v,a)=>{FLOW_ANGLE[v]=a}, setView:v=>{FLOW_VIEW=v} };')(...Object.values(ctx));
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
  ok('twelve buckets, twelve rights — QC and Finished Goods are done on their own screens, not here', load().FLOW_TABS.length === 12 && new Set(load().FLOW_TABS).size === 12 && !['flqc', 'flrdy', 'flfg'].some(t => load().FLOW_TABS.includes(t)));
  ok('an admin sees every bucket', load({ me: { admin: true } }).flowBucketsAllowed().length === 12);
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
  ok('all issued, 30 back and not checked → QC', b(L({ cutReq: true, cut: 100, issued: 100, received: 30 })) === 'qcb');
  ok('all issued, nothing back → WIP', b(L({ cutReq: true, cut: 100, issued: 100, received: 0 })) === 'wip');
  const qc100 = [{ orderNo: 'AMZ-1', sku: 'S1', checked: 100, ok: 100 }];
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 100 } }, qcChecks: qc100 }, ready));
  ok('all QC passed, not in Finished Goods → Ready → India stock (the Finished Goods team accepts)', b(L({ issued: 100, received: 100 })) === 'fgin');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 60 } }, qcChecks: [{ orderNo: 'AMZ-1', sku: 'S1', checked: 100, ok: 60, dept: 'spotting', spotting: 40 }] }, ready));
  ok('40 in spotting on the Quality Control screen → still in QC', b(L({ issued: 100, received: 100 })) === 'qcb');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 60 } }, qcChecks: [{ orderNo: 'AMZ-1', sku: 'S1', checked: 70, ok: 60, rejected: 10 }] }, ready));
  ok('10 rejected while 30 are still waiting for QC → stays in QC until QC is done with them', b(L({ issued: 100, received: 100 })) === 'qcb');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 90 } }, qcChecks: [{ orderNo: 'AMZ-1', sku: 'S1', checked: 100, ok: 90, rejected: 10 }] }, ready));
  ok('…once QC has done them all, the 10 rejected are back in Raw cutting in store', b(L({ issued: 100, received: 100 })) === 'raw');
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 100 } }, fg: { 'AMZ-1|S1': { in: 100 } } }, ready));
  ok('in India stock → done', b(L({ issued: 100, received: 100 })) === 'done');
  ok('handed to shipping is done whatever else says', b(L({ handedAt: '2026-10-12' })) === 'done');
  A = load({ ppc: { [K]: plan({ print: { need: false } }) }, dem: { [K]: { fabricReady: { at: 'x' } } } });
  ok('PPC said not printed → skips both printer buckets', b(L()) === 'raw');
  ok('pressed counts as made, like QC (5 Oct rule)', b(L({ issued: 100, pressed: 100 })) === 'fgin');
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
  ok('above the lines: only the switch, By line | By fabric — not the stock table', /data-flang="stock"/.test(A.els.flPanel.innerHTML) && !/⚑ 10 m/.test(A.els.flPanel.innerHTML) && /By fabric/.test(A.els.flPanel.innerHTML));
  A.setAngle('drfd', 'stock'); A.renderFlow();
  ok('By fabric: the table IS the stock — in stock, need, short per fabric; the lines are not under it', /⚑ 10 m/.test(A.els.flTable.innerHTML) && /RFD in stock/.test(A.els.flTable.innerHTML) && !/data-flfab=/.test(A.els.flTable.innerHTML));
  A.setAngle('drfd', 'line'); A.renderFlow();
  ok('accessories are not in the RFD department', !/Reserve/.test(A.els.flTable.innerHTML));
  A = load({ me: { tabs: ['flacc'] }, lines: [L()], ppc: { [K]: pl('S1', 60, { acc: [{ code: '18', qty: 100 }] }) }, shelf: [{ code: '18', name: '18in zip', qty: 70 }] });
  A.setView('dacc'); A.renderFlow();
  ok('the Accessories list flags short 30 and offers Reserve', /short 30/.test(A.els.flTable.innerHTML) && /data-flres/.test(A.els.flTable.innerHTML));
  ok('accessories have the same switch', /data-flang="stock"/.test(A.els.flPanel.innerHTML) && /By accessory/.test(A.els.flPanel.innerHTML) && A.flowAccCover()[0].short === 30);
  A.setAngle('dacc', 'stock'); A.renderFlow();
  ok('By accessory: shelf 70, need 100, short 30', /On the shelf/.test(A.els.flTable.innerHTML) && /⚑ 30/.test(A.els.flTable.innerHTML) && !/data-flres=/.test(A.els.flTable.innerHTML));
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
    ok('the challan IS the vendor allocation: the line waits in Printed fabric in; the unticked one stays in RFD', A.flowState(L()).bucket === 'fabric' && A.flowInView('drfd', A.flowState(L({ sku: 'S2' }))));
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
    ok('the challans are not in Demand · RFD any more', !/RFD-202610-001/.test(A.els.flPanel.innerHTML + A.els.flTable.innerHTML));
    const B = load({ popupBlocked: true }); B.setFLOW(Object.assign(B.FLOW(), { ch: { X: { no: 'X', lines: [] } } }));
    ok('a blocked pop-up is said, not swallowed', /blocked/.test(B.flowChallanPrint('X')));
  }

  console.log('== Demand history: receive against a challan ==');
  {
    const chs = { 'RFD-202610-001': { no: 'RFD-202610-001', date: '2026-10-10', orderNo: 'AMZ-1', vendor: { code: 'P1', name: 'Sanganer Prints' },
      lines: [{ key: K, sku: 'S1', metres: 100 }, { key: 'AMZ-1__S2', sku: 'S2', metres: 50 }] } };
    const base = { me: { tabs: ['flchl', 'flfab', 'flcut'] }, lines: [L(), L({ sku: 'S2', qty: 40 })], ppc: { [K]: plan({ fabric: { name: 'Cotton', perPc: 1, metres: 100 } }), 'AMZ-1__S2': plan({ sku: 'S2', qty: 40, fabric: { name: 'Cotton', perPc: 1.25, metres: 50 } }) },
      dem: { [K]: { fabricReady: { at: 'x', challan: 'RFD-202610-001' } }, 'AMZ-1__S2': { fabricReady: { at: 'x', challan: 'RFD-202610-001' } } } };
    A = load(base); A.setFLOW(Object.assign(A.FLOW(), { ch: JSON.parse(JSON.stringify(chs)) }));
    ok('a line on a challan is given in full and waits for its printed fabric', A.flowState(L()).given === 100 && A.flowState(L()).bucket === 'fabric');
    A.setView('dhist'); A.renderFlow();
    ok('Demand history lists the open challan with Receive / Close short / Print', /RFD-202610-001/.test(A.els.flTable.innerHTML) && /data-flchr=/.test(A.els.flTable.innerHTML) && /data-flchc=/.test(A.els.flTable.innerHTML) && /data-flchp=/.test(A.els.flTable.innerHTML));
    ok('its bucket counts open challans', /<span class="fl-n">1<\/span><span>Demand history/.test(A.els.flBuckets.innerHTML));
    let QS = { '[data-flrm="0"]': { value: '' }, '[data-flrm="1"]': { value: '' } };
    A.ctx.document.querySelector = sel => QS[sel] || null;
    A.flowReceiveOpen('RFD-202610-001'); A.els.flrDate = { value: '2026-10-12' }; A.els.flrNote = { value: 'lot 7' };
    ok('nothing typed → refused', /at least one line/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    QS['[data-flrm="0"]'].value = '130';
    ok('far more than was sent → refused', /More came back than was given/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    QS['[data-flrm="0"]'].value = '40';
    ok('part received is saved as a receipt', !(await A.ctx.__dlg.onSave()) && Object.keys(A.writes[0]).some(k => /receipts\//.test(k)) && !Object.keys(A.writes[0]).some(k => /closed/.test(k)));
    ok('40 of 100 m back → 40 of 100 pieces of fabric in; the line stays in Printed fabric in', A.flowState(L()).back === 40 && A.flowState(L()).bucket === 'fabric');
    A.renderFlow();
    ok('the challan says part received', /part received/.test(A.els.flTable.innerHTML));
    QS = { '[data-flrm="0"]': { value: '30' }, '[data-flrm="1"]': { value: '' } };
    A.flowReceiveOpen('RFD-202610-001');
    ok('a second receipt adds to the first: 70 back', !(await A.ctx.__dlg.onSave()) && A.flowState(L()).back === 70);
    QS = { '[data-flrm="0"]': { value: '30' }, '[data-flrm="1"]': { value: '50' } };
    A.flowReceiveOpen('RFD-202610-001');
    ok('the rest back → the challan closes by itself', !(await A.ctx.__dlg.onSave()) && A.writes[2]['pt_flowChallans/RFD-202610-001/closed'].why === 'all received');
    ok('…and the lines move to the store (Cutting / Raw)', A.flowState(L({ cutReq: true })).bucket === 'cut' && A.flowState(L({ sku: 'S2', qty: 40 })).bucket === 'raw');
    A.renderFlow();
    ok('a closed challan has no Receive button and the count is 0', !/data-flchr=/.test(A.els.flTable.innerHTML) && /closed/.test(A.els.flTable.innerHTML) && /<span class="fl-n">0<\/span><span>Demand history/.test(A.els.flBuckets.innerHTML));
    A = load(base); A.setFLOW(Object.assign(A.FLOW(), { ch: JSON.parse(JSON.stringify(chs)) }));
    A.flowCloseShortOpen('RFD-202610-001'); A.els.flcWhy = { value: '' };
    ok('close short needs a reason', /Say why/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    A.els.flcWhy.value = 'printer damaged 10 m';
    ok('closed short → the lines move on with what came', !(await A.ctx.__dlg.onSave()) && A.writes[0]['pt_flowChallans/RFD-202610-001/closed'].short && A.flowState(L()).bucket === 'raw');
  }

  console.log('== received in the form it was given: pieces back as pieces (CPC-02 tablecloth) ==');
  {
    const K2 = 'TEST-AMZ-10102026-02__CPC-02';
    const ch = { 'TRFD-202610-001': { no: 'TRFD-202610-001', date: '2026-10-10', orderNo: 'TEST-AMZ-10102026-02', vendor: { code: 'P1', name: 'SS Hand Block' },
      lines: [{ key: K2, sku: 'CPC-02', item: 'Tablecloth · Agate Green · 60x90', pcs: 45, metres: 105.75, print: { kind: 'sku', code: 'CPC-02', mode: 'Cut pieces' } },
        { key: 'TEST-AMZ-10102026-02__RPC1', sku: 'RPC1', pcs: 10, metres: 5.3, print: { kind: 'fabric', code: 'RBP-CANVAS-327' } }] } };
    const fr = { at: 'x', challan: 'TRFD-202610-001' };
    A = load({ me: { admin: true }, mdb: { 'CPC-02': { color: 'Agate Green', fabric: 'Sheeting 62', consumption: 2.35, cuttingRequired: false }, RPC1: { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true } },
      lines: [L({ orderNo: 'TEST-AMZ-10102026-02', sku: 'CPC-02', qty: 45 }), L({ orderNo: 'TEST-AMZ-10102026-02', sku: 'RPC1', qty: 10 })],
      ppc: { [K2]: plan({ sku: 'CPC-02', qty: 45, fabric: { name: 'Sheeting 62', perPc: 2.35, metres: 105.75 } }), 'TEST-AMZ-10102026-02__RPC1': plan({ sku: 'RPC1', qty: 10, fabric: { name: 'Canvas', perPc: 0.53, metres: 5.3 } }) },
      dem: { [K2]: { fabricReady: fr }, 'TEST-AMZ-10102026-02__RPC1': { fabricReady: fr } } });
    A.setFLOW(Object.assign(A.FLOW(), { ch: JSON.parse(JSON.stringify(ch)) }));
    A.flowReceiveOpen('TRFD-202610-001');
    const h = A.ctx.__dlg.html;
    ok('the form says how each line was given: CPC-02 cut pieces, 45 pcs (105.75 m cloth shown beside)', /Cut pieces/.test(h) && /<b>45 pcs<\/b>/.test(h) && /105\.75 m cloth/.test(h));
    ok('…the cloth line in metres', /Printed cloth/.test(h) && /<b>5\.3 m<\/b>/.test(h));
    ok('…and the box is prefilled with what is still out: 45 (pcs) and 5.3 (m)', /data-flrm="0" type="number" step="1" min="0" value="45"/.test(h) && /data-flrm="1" type="number" step="0.01" min="0" value="5.3"/.test(h));
    let q = { '[data-flrm="0"]': { value: '10.5' }, '[data-flrm="1"]': { value: '' } };
    A.ctx.document.querySelector = s => q[s] || null; A.els.flrDate = { value: '2026-10-12' }; A.els.flrNote = { value: '' };
    ok('pieces are whole', /Pieces are whole: CPC-02/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    q['[data-flrm="0"]'].value = '46';
    ok('more pieces back than given → refused (no 10% for pieces)', /More came back than was given for CPC-02/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    q['[data-flrm="0"]'].value = '10';
    ok('10 of 45 pieces back → 10 pieces of the line are in', !(await A.ctx.__dlg.onSave()) && A.flowState(L({ orderNo: 'TEST-AMZ-10102026-02', sku: 'CPC-02', qty: 45 })).back === 10);
    A.setView('dhist'); A.renderFlow();
    ok('Demand history says it in both units: sent 5.3 m · 45 pcs, received 10 pcs', /5\.3 m · 45 pcs/.test(A.els.flTable.innerHTML) && /CPC-02 · 45 pcs <span style="color:#166534">\(10 pcs back\)/.test(A.els.flTable.innerHTML));
    A.flowReceiveOpen('TRFD-202610-001');
    q = { '[data-flrm="0"]': { value: '35' }, '[data-flrm="1"]': { value: '5.3' } };
    A.ctx.document.querySelector = s => q[s] || null;
    ok('the other 35 pcs and the 5.3 m → the challan closes', !(await A.ctx.__dlg.onSave()) && A.FLOW().ch['TRFD-202610-001'].closed && A.flowState(L({ orderNo: 'TEST-AMZ-10102026-02', sku: 'CPC-02', qty: 45 })).bucket !== 'fabric');
  }

  console.log('== PPC decides the printer — suggested from the planning ==');
  {
    const mdb = { S1: { cons: 1, fab: 'Cotton', color: 'Light Steel Blue', brand: 'SP' }, S2: { cons: 1, fab: 'Cotton', color: 'Ocean Vine', brand: 'SP' }, S9: { color: 'Ocean Vine' }, S3: { cons: 1, fab: 'Cotton', color: 'Nobody' } };
    A = load({ mdb, pal: { 'SP|Light Steel Blue': { printer: 'Sanganer Prints' } }, vo: [{ vendorCode: 'V9', orderDate: '2026-09-01', lines: [{ sku: 'S9' }] }] });
    let sg = A.flowSuggest(L());
    ok('the colour allocated in Printer Allocation → that printer, and why', sg.printer.code === 'P1' && /Printer Allocation/.test(sg.printer.why));
    sg = A.flowSuggest(L({ sku: 'S2' }));
    ok('not allocated → the printer that last got that colour', sg.printer.code === 'V9' && /last given Ocean Vine/.test(sg.printer.why));
    ok('nothing known → blank, said', A.flowSuggest(L({ sku: 'S3' })).printer.code === '' && /no printer allocated to Nobody/.test(A.flowSuggest(L({ sku: 'S3' })).printer.why));
    A = load({ me: { admin: true }, mdb, lines: [L()], pal: { 'SP|Light Steel Blue': { printer: 'P1' } } });
    A.setView('ppc'); A.renderFlow();
    ok('the PPC list says which printer, not "printed in-house"', /print: <b>Sanganer Prints/.test(A.els.flTable.innerHTML) && !/printed in-house/.test(A.els.flTable.innerHTML));
    A.flowPpcOpen('AMZ-1');
    ok('the form offers the printers, the suggested one picked', /value="P1" selected/.test(A.ctx.__dlg.html));
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
    await A.ctx.__dlg.onSave();
    ok('saved with the printer', A.writes[0]['pt_ppc/' + K].printer.name === 'Sanganer Prints');
    A.ctx.document.querySelectorAll = () => [];
    A.flowChallanOpen('AMZ-1');
    ok('the challan comes with the PPC printer picked', /value="P1" selected/.test(A.ctx.__dlg.html));
    A = load({ mdb, lines: [L()] });
    A.flowPpcOpen('AMZ-1');
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'route' }, type: 'select-one', value: 'stitch' }, { addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
    await A.ctx.__dlg.onSave();
    ok('a stitching-only line keeps no printer', A.writes[0]['pt_ppc/' + K].printer === null);
  }

  console.log('== PPC sees the requirement: needs · balance after earlier orders · enough / short; printed stock beside ==');
  {
    const spans = {};
    const span = sel => spans[sel] || (spans[sel] = { innerHTML: '', textContent: '' });
    const sel = sel => (/data-mat=|data-fm=|data-pget=/.test(sel) ? span(sel) : null);
    const mdb = { S1: { cons: 1, fab: 'Sheeting 82', chainLength: '18' }, S2: { cons: 0.5, fab: 'Sheeting 82', chainLength: '18' }, S3: { cons: 0.5, fab: 'Sheeting 82', chainLength: '18' } };
    A = load({ mdb, rfd: { 'SHEETING 82': 100 }, fabRows: [{ fabricType: 'Sheeting 82' }], shelf: [{ code: '18', name: '18in zip', qty: 100 }],
      lines: [L({ orderNo: 'AMZ-0', sku: 'S1', qty: 40, orderDate: '2026-10-11' }), L({ sku: 'S2', qty: 50 }), L({ sku: 'S3', qty: 20 })],
      ppc: { 'AMZ-0__S1': plan({ orderNo: 'AMZ-0', sku: 'S1', qty: 40, acc: [{ code: '18', qty: 40 }], fabric: { name: 'Sheeting 82', perPc: 0.75, metres: 30 } }) } });
    A.ctx.document.querySelector = sel;
    A.flowPpcOpen('AMZ-1');
    const m1 = spans['[data-mat="0"]'].innerHTML, m2 = spans['[data-mat="1"]'].innerHTML;
    const row = (h, what) => (h.split('<tr>').find(x => x.includes(what)) || '');
    const z1 = row(m1, 'zip'), z2 = row(m2, 'zip'), f1 = row(m1, 'RFD');
    ok('100 zippers, an earlier order planned 40 → this order of 50: needs 50, balance 60, enough', /<td class="num">50<\/td>/.test(z1) && /<b>60<\/b>/.test(z1) && /✓ enough/.test(z1), z1);
    ok('…the stock and the earlier plans are behind the balance (tooltip), not in the way', /title="in stock 100, already planned for earlier orders \/ lines above 40"/.test(z1));
    ok('the next line in the same form counts the one above it: balance 10, short 10 for 20', /<b>10<\/b>/.test(z2) && /⚑ short 10/.test(z2), z2);
    ok('RFD main fabric: Sheeting 82 needs 25 m, balance 70 m after the earlier 30 m', /RFD · <b>Sheeting 82<\/b>/.test(f1) && /<td class="num">25 m<\/td>/.test(f1) && /<b>70 m<\/b>/.test(f1) && /✓ enough/.test(f1), f1);
    ok('shown only — opening the form writes nothing', !A.writes.length);
    A.W.lines[0].issued = 20; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('half the earlier line issued → its zippers left the shelf at issue: only 20 still counted', A.flowCommitted([]).acc['18'] === 20);
    ok('…and its cloth has moved, so its fabric is no longer counted', !A.flowCommitted([]).fab['SHEETING 82']);
    A.W.lines.push(L({ orderNo: 'TEST-AMZ-1', sku: 'S1', qty: 30, __t: {} })); A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc, { 'TEST-AMZ-1__S1': plan({ acc: [{ code: '18', qty: 30 }] }) }) }));
    ok('a test order’s plan does not eat into a real order’s stock (but counts for another test)', A.flowCommitted([]).acc['18'] === 20 && A.flowCommitted([], true).acc['18'] === 50);
    ok('a line in the form is not counted twice when it was planned before', A.flowCommitted(['AMZ-0__S1']).acc['18'] === undefined);
    A = load({ mdb, lines: [L({ sku: 'S2', qty: 50 })], shelf: [] });
    Object.keys(spans).forEach(k => delete spans[k]);
    A.ctx.document.querySelector = sel;
    A.flowPpcOpen('AMZ-1');
    ok('an accessory nobody keeps / a fabric not in the register is said, not shown as 0', (spans['[data-mat="0"]'].innerHTML.match(/stock not kept in the app/g) || []).length === 2);

    /* Printed stock: Ravi's RPC327-1818 — Canvas RFD and the printed RBP-CANVAS-327 already in the store. */
    const md2 = { 'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true },
      'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 62', consumption: 1.58, cuttingRequired: false } };
    A = load({ mdb: md2, rfd: { CANVAS: 6400 }, fabRows: [{ fabricType: 'Canvas' }], fsku: { 'Canvas|Light Steel Blue|Vertical|327': 'RBP-CANVAS-327' },
      store: [{ key: 'M|CANVAS|LIGHT STEEL BLUE', qty: 37.5 }, { key: 'P|RTC327-6060', qty: 4 }],
      lines: [L({ sku: 'RPC327-1818', qty: 20 }), L({ sku: 'RTC327-6060', qty: 10 })] });
    Object.keys(spans).forEach(k => delete spans[k]);
    A.ctx.document.querySelector = sel;
    A.flowPpcOpen('AMZ-1');
    const pm = spans['[data-mat="0"]'].innerHTML, pk = spans['[data-mat="1"]'].innerHTML;
    ok('RPC327-1818: RFD Canvas needs 10.6 m, balance 6,400 m', /RFD · <b>Canvas<\/b>/.test(pm) && /10\.6 m/.test(pm) && /<b>6400 m<\/b>/.test(pm), pm);
    ok('…and the printed stock beside it: RBP-CANVAS-327 in store 37.5 m', /Printed in store · <b>RBP-CANVAS-327<\/b>/.test(pm) && /<b>37\.5 m<\/b>/.test(pm));
    ok('a SKU printed as pieces: its printed pieces in the store (RTC327-6060: 4 pcs)', /Printed in store · <b>RTC327-6060<\/b>/.test(pk) && /<b>4 pcs<\/b>/.test(pk), pk);
    ok('all 10.6 m already printed in the store (37.5 m) → nothing to the printer', /All already printed, in the store — nothing goes to the printer/.test(spans['[data-pget="0"]'].innerHTML) && /RBP-CANVAS-327/.test(spans['[data-pget="0"]'].innerHTML));
  }

  console.log('== one challan per printer — the printer PPC planned ==');
  {
    const pr = (code, name) => ({ code, name });
    const pp = (sku, extra) => plan(Object.assign({ sku, fabric: { name: 'Sheeting 82', perPc: 1, metres: 10 } }, extra));
    A = load({ me: { admin: true }, rfd: { 'SHEETING 82': 999 },
      lines: [L({ sku: 'S1' }), L({ sku: 'S2' }), L({ sku: 'S3' }), L({ sku: 'S4' }), L({ sku: 'S5' })],
      ppc: { 'AMZ-1__S1': pp('S1', { printer: pr('P1', 'Sanganer Prints') }), 'AMZ-1__S2': pp('S2', { printer: pr('P2', 'Choudhary Hand Block') }),
        'AMZ-1__S3': pp('S3', { printer: pr('P1', 'Sanganer Prints') }), 'AMZ-1__S4': pp('S4', { route: 'stitch', print: { need: false } }), 'AMZ-1__S5': pp('S5') } });
    A.setView('drfd'); A.renderFlow();
    const h = A.els.flTable.innerHTML;
    ok('a button per printer the PO is planned for: → Sanganer, → Choudhary, and one for the line with no printer', /data-pc="P1"[^>]*>Challan → Sanganer Prints/.test(h) && /data-pc="P2"[^>]*>Challan → Choudhary Hand Block/.test(h) && /data-pc="\?"[^>]*>Challan \(printer not chosen\)/.test(h) && (h.match(/data-flch=/g) || []).length === 3);
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('the Sanganer challan holds only Sanganer\u2019s lines, Sanganer picked', /S1/.test(A.ctx.__dlg.html) && /S3/.test(A.ctx.__dlg.html) && !/<b style="font-family:ui-monospace,monospace">S2/.test(A.ctx.__dlg.html) && /value="P1" selected/.test(A.ctx.__dlg.html) && /→ Sanganer Prints/.test(A.ctx.__dlg.title));
    ok('a stitching-only line is on no challan', !/<b style="font-family:ui-monospace,monospace">S4/.test(A.ctx.__dlg.html));
    A.ctx.document.querySelector = sel => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '10' }, '[data-chk="1"]': { checked: true }, '[data-chm="1"]': { value: '10' } })[sel] || null;
    A.els.flcVen = { value: 'P2' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' };
    let er = await A.ctx.__dlg.onSave();
    ok('giving Sanganer\u2019s lines to Choudhary is refused, naming the planned printer', /S1 is planned for Sanganer Prints/.test(er) && !A.writes.length, er);
    A.els.flcVen.value = 'P1';
    er = await A.ctx.__dlg.onSave();
    ok('to Sanganer it goes: the challan and the plan match', !er && A.FLOW().ch['RFD-202610-001'].vendor.name === 'Sanganer Prints' && A.FLOW().ch['RFD-202610-001'].lines.map(l => l.sku).join() === 'S1,S3', er);
    A.flowChallanOpen('AMZ-1', '?');
    A.ctx.document.querySelector = sel => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '10' } })[sel] || null;
    A.els.flcVen.value = 'P2';
    er = await A.ctx.__dlg.onSave();
    ok('a line PPC left without a printer takes the one it went to — its plan now says so', !er && A.writes[1]['pt_ppc/AMZ-1__S5/printer'].name === 'Choudhary Hand Block' && A.FLOW().ppc['AMZ-1__S5'].printer.code === 'P2', er);
    A.setFLOW(Object.assign(A.FLOW(), { ch: Object.assign({}, A.FLOW().ch, { 'RFD-202610-001': Object.assign({}, A.FLOW().ch['RFD-202610-001'], { receipts: undefined }) }) }));
    A.flowChallanEditOpen('RFD-202610-001');
    A.ctx.document.querySelector = sel => ({ '[data-cek="0"]': { checked: true }, '[data-cem="0"]': { value: '10' }, '[data-cek="1"]': { checked: true }, '[data-cem="1"]': { value: '10' } })[sel] || null;
    A.els.flceVen = { value: 'P2' }; A.els.flceDate = { value: '2026-10-10' }; A.els.flceNote = { value: '' };
    er = await A.ctx.__dlg.onSave();
    ok('editing a challan to another printer is refused the same way', /planned for Sanganer Prints/.test(er), er);
  }

  console.log('== what the printer prints — from the MASTER DATA (Ravi\u2019s 327 test order) ==');
  {
    /* The real master rows of TEST-AMZ-10102026-01 (pt_masterDB, 10 Oct). */
    const mdb = {
      'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true, cons: 0.13, fab: 'Sheeting 82' },
      'RPCRU327-1818': { color: 'Light Steel Blue', fabric: 'Sheeting 82', consumption: 0.26, cuttingRequired: true, chainLength: '18' },
      'RPCB327-1818': { color: 'Light Steel Blue', fabric: 'Sheeting 82', consumption: 0.2, cuttingRequired: true },
      'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 62', consumption: 1.58, cuttingRequired: false },
      'RTME-327': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.25, cuttingRequired: false, issueAs: 'running' },
      'RTR327-16106': { color: 'Light Steel Blue', fabric: 'Sheeting 62', consumption: 0.7, cuttingRequired: false },
    };
    const fsku = { 'Canvas|Light Steel Blue|Vertical|327': 'RBP-CANVAS-327', 'Sheeting 82|Light Steel Blue|Vertical|327': 'RBPSF327-V-82', 'Sheeting 82|Light Steel Blue|Horizontal|327': 'RBPSF327-H-82' };
    A = load({ me: { admin: true }, mdb, fsku });
    let sg = A.flowSuggest(L({ sku: 'RPC327-1818', qty: 10 }));
    ok('PPC takes the master row\u2019s fabric and consumption: Canvas, 0.53 m/pc → 5.3 m (not the width calculator\u2019s Sheeting 82)', sg.fabric.name === 'Canvas' && sg.fabric.perPc === 0.53 && sg.fabric.metres === 5.3 && sg.fabric.how === 'master data');
    let w = A.flowPrintWhat(L({ sku: 'RPC327-1818' }), sg);
    ok('RPC327-1818 → RBP-CANVAS-327 (Canvas is made one way only — no direction to pick)', w.kind === 'fabric' && w.code === 'RBP-CANVAS-327' && /Canvas · Vertical/.test(w.label));
    w = A.flowPrintWhat(L({ sku: 'RPCRU327-1818' }), A.flowSuggest(L({ sku: 'RPCRU327-1818' })));
    ok('RPCRU327-1818 on Sheeting 82 with no direction chosen → "pick the print direction", never both SKUs', w.needDir && w.code === '' && !/RBPSF327-V-82 RBPSF327-H-82/.test(A.flowPrintWhat(L({ sku: 'RPCRU327-1818' })).code));
    w = A.flowPrintWhat(L({ sku: 'RPCRU327-1818' }), plan({ fabric: { name: 'Sheeting 82' }, print: { need: true, dir: 'Horizontal' } }));
    ok('…with Horizontal chosen → RBPSF327-H-82 only', w.code === 'RBPSF327-H-82');
    ok('RTC327-6060, RTR327-16106, RTME-327 (Cutting required: no) → printed on the SKU itself — the master row beats the print rule', ['RTC327-6060', 'RTR327-16106', 'RTME-327'].every(k => { const x = A.flowPrintWhat(L({ sku: k })); return x.kind === 'sku' && x.code === k; }));
    w = load({ mdb: { X9: { color: 'Nowhere', fabric: 'Silk', cuttingRequired: true } } }).flowPrintWhat(L({ sku: 'X9' }));
    ok('a fabric SKU the catalogue does not have is blank — said, not made up', w.kind === 'fabric' && w.code === '' && !w.needDir);
    A = load({ mdb, fsku, lines: [L({ sku: 'RPCRU327-1818', qty: 40 })] });
    A.flowPpcOpen('AMZ-1');
    ok('the PPC form offers Vertical / Horizontal for a sheeting line', /data-k="print.dir"/.test(A.ctx.__dlg.html) && /<option>Vertical<\/option>/.test(A.ctx.__dlg.html) && /<option>Horizontal<\/option>/.test(A.ctx.__dlg.html));
    A.ctx.document.querySelectorAll = () => [];
    let er = await A.ctx.__dlg.onSave();
    ok('…and will not save a printed sheeting line without one', /Pick the print direction for RPCRU327-1818/.test(er) && !A.writes.length, er);
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'print.dir' }, type: 'select-one', value: 'Vertical' }, { addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
    er = await A.ctx.__dlg.onSave();
    ok('…saved with Vertical; the printer gets RBPSF327-V-82', !er && A.writes[0]['pt_ppc/AMZ-1__RPCRU327-1818'].print.dir === 'Vertical' && A.flowPrintWhat(L({ sku: 'RPCRU327-1818' }), A.writes[0]['pt_ppc/AMZ-1__RPCRU327-1818']).code === 'RBPSF327-V-82', er);
    A = load({ mdb, fsku, lines: [L({ sku: 'RPC327-1818' })] });
    A.flowPpcOpen('AMZ-1');
    ok('Canvas offers no direction box (one way only)', !/data-k="print.dir"/.test(A.ctx.__dlg.html));
    { const md3 = { 'CPC-02': { color: 'Agate Green', fabric: 'Sheeting 62', consumption: 2.35, cuttingRequired: false } };
      const B = load({ mdb: md3, fsku: { 'Sheeting 62|Agate Green|Vertical|': 'CPCSF002-V-62', 'Sheeting 62|Agate Green|Horizontal|': 'CPCSF002-H-62' }, lines: [L({ sku: 'CPC-02', qty: 45 })] });
      B.flowPpcOpen('AMZ-1');
      ok('cutting not required (CPC-02 tablecloth): no direction box, and it saves without one', !/data-k="print.dir"/.test(B.ctx.__dlg.html));
      B.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
      const e2 = await B.ctx.__dlg.onSave();
      ok('…saved, printed on the SKU itself', !e2 && B.flowPrintWhat(L({ sku: 'CPC-02' }), B.writes[0]['pt_ppc/AMZ-1__CPC-02']).kind === 'sku', e2); }
    { const pg = { innerHTML: '' }; A.ctx.document.querySelector = q => (q === '[data-pget="0"]' ? pg : null); A.flowPpcOpen('AMZ-1');
      ok('…and the printer gets RBP-CANVAS-327', /<span class="fpc-mode">Running fabric<\/span> <b>RBP-CANVAS-327/.test(pg.innerHTML), pg.innerHTML); }
    const pr = { code: 'P1', name: 'Sanganer Prints' };
    const pp = (sku, m, dir) => plan({ sku, printer: pr, fabric: { name: mdb[sku].fabric, perPc: 1, metres: m }, print: { need: true, dir } });
    A = load({ me: { admin: true }, mdb, fsku, rfd: { CANVAS: 999, 'SHEETING 82': 999, 'SHEETING 62': 999 },
      lines: [L({ sku: 'RPC327-1818', qty: 10 }), L({ sku: 'RPCRU327-1818', qty: 40 }), L({ sku: 'RTME-327', qty: 1 }), L({ sku: 'RPCB327-1818', qty: 10 })],
      ppc: { 'AMZ-1__RPC327-1818': pp('RPC327-1818', 5.3), 'AMZ-1__RPCRU327-1818': pp('RPCRU327-1818', 10.4, 'Vertical'), 'AMZ-1__RTME-327': pp('RTME-327', 0.25), 'AMZ-1__RPCB327-1818': pp('RPCB327-1818', 2, 'Vertical') } });
    A.setView('drfd'); A.renderFlow();
    ok('Demand RFD "Made as" shows what each line prints, from the master data', /RBP-CANVAS-327/.test(A.els.flTable.innerHTML) && /RBPSF327-V-82/.test(A.els.flTable.innerHTML) && !/RBPSF327-H-82/.test(A.els.flTable.innerHTML) && /RTME-327<\/b> · printed on the SKU itself/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1', 'P1');
    const q = {}; [0, 1, 2, 3].forEach(i => { q[`[data-chk="${i}"]`] = { checked: true }; q[`[data-chm="${i}"]`] = { value: ['5.3', '10.4', '0.25', '2'][i] }; });
    A.ctx.document.querySelector = sel => q[sel] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    er = await A.ctx.__dlg.onSave();
    const ch = A.FLOW().ch['RFD-202610-001'], gs = A.flowChPrintGroups(ch);
    ok('the challan keeps it per line, and "To print" has one row each: RBP-CANVAS-327 5.3 m, RBPSF327-V-82 10.4 + 2 = 12.4 m (two lines, one cloth), RTME-327 1 pcs', !er && gs.length === 3
      && gs.find(g => g.code === 'RBP-CANVAS-327').metres === 5.3 && Math.abs(gs.find(g => g.code === 'RBPSF327-V-82').metres - 12.4) < 1e-9 && gs.find(g => g.kind === 'sku').pcs === 1, er);
    ok('the printed challan says so', /To print/.test(A.ctx.__win[0] || '') && /RBP-CANVAS-327/.test(A.ctx.__win[0] || '') && /12\.4 m/.test(A.ctx.__win[0] || ''));
  }

  console.log('== the ruffle cloth is printed too: RPCRU327-1818 → 16 m Cambric = LSB ==');
  {
    const mdb = { 'RPCRU327-1818': { color: 'Light Steel Blue', fabric: 'Sheeting 82', consumption: 0.26, cuttingRequired: true },
      'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true } };
    const fsku = { 'Cambric|Light Steel Blue|Vertical|327': 'LSB', 'Canvas|Light Steel Blue|Vertical|327': 'RBP-CANVAS-327',
      'Sheeting 82|Light Steel Blue|Vertical|327': 'RBPSF327-V-82', 'Sheeting 82|Light Steel Blue|Horizontal|327': 'RBPSF327-H-82' };
    const pr = { code: 'P1', name: 'Sanganer Prints' };
    const ru = plan({ sku: 'RPCRU327-1818', qty: 40, printer: pr, route: 'inhouse', fabric: { name: 'Sheeting 82', perPc: 0.26, metres: 10.4 }, print: { need: true, dir: 'Horizontal' }, extra: [{ what: 'Ruffle — Cambric', qty: 16, unit: 'm' }] });
    const pc = plan({ sku: 'RPC327-1818', qty: 10, printer: pr, route: 'inhouse', fabric: { name: 'Canvas', perPc: 0.53, metres: 5.3 }, print: { need: true } });
    A = load({ me: { admin: true }, mdb, fsku, rfd: { 'SHEETING 82': 99, CANVAS: 99 }, lines: [L({ sku: 'RPCRU327-1818', qty: 40 }), L({ sku: 'RPC327-1818', qty: 10 })],
      ppc: { 'AMZ-1__RPCRU327-1818': ru, 'AMZ-1__RPC327-1818': pc } });
    let xs = A.flowPrintExtras(L({ sku: 'RPCRU327-1818' }), ru);
    ok('the ruffle Cambric → LSB, 16 m, Vertical (Cambric is made one way, whatever the body\u2019s direction)', xs.length === 1 && xs[0].code === 'LSB' && xs[0].metres === 16 && /Cambric · Vertical/.test(xs[0].label));
    ok('a SKU with no ruffle has none (RPC327-1818, piping flap)', A.flowPrintExtras(L({ sku: 'RPC327-1818' }), pc).length === 0);
    ok('a line not printed here has none', A.flowPrintExtras(L({ sku: 'RPCRU327-1818' }), Object.assign({}, ru, { route: 'stitch' })).length === 0);
    A.setView('drfd'); A.renderFlow();
    ok('Made as shows both: RBPSF327-H-82 and "+ Ruffle: LSB … 16 m"', /RBPSF327-H-82/.test(A.els.flTable.innerHTML) && /\+ Ruffle: <b>LSB<\/b> · Light Steel Blue · Cambric · Vertical · 16 m/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('the challan form too', /\+ Ruffle: <b>LSB/.test(A.ctx.__dlg.html));
    const q = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '10.4' }, '[data-chk="1"]': { checked: true }, '[data-chm="1"]': { value: '5.3' } };
    A.ctx.document.querySelector = sel => q[sel] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    const er = await A.ctx.__dlg.onSave();
    const gs = A.flowChPrintGroups(A.FLOW().ch['RFD-202610-001']);
    ok('"To print": RBPSF327-H-82 10.4 m, RBP-CANVAS-327 5.3 m, LSB 16 m', !er && gs.length === 3 && gs.find(g => g.code === 'LSB').metres === 16 && gs.find(g => g.code === 'RBPSF327-H-82').metres === 10.4 && gs.find(g => g.code === 'RBP-CANVAS-327').metres === 5.3, er);
    ok('…and on the printed challan', /LSB/.test(A.ctx.__win[0] || '') && /16 m/.test(A.ctx.__win[0] || '') && /\+ ruffle LSB/.test(A.ctx.__win[0] || ''));
  }

  console.log('== printed stock in the store is used first; only the rest needs RFD and the printer ==');
  {
    const spans = {}, span = q => spans[q] || (spans[q] = { innerHTML: '', textContent: '' });
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true, subtype: 'Ruffle Tablecloth' } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' },
      { sku: 'LSB', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327', manual: true }];
    const mk = store => { const B = load({ me: { admin: true }, mdb, fsCat, rfd: { 'SHEETING 92': 2461, CAMBRIC: 0 }, fabRows: [{ fabricType: 'Sheeting 92' }, { fabricType: 'Cambric' }], store,
      lines: [L({ sku: 'RTC327-6060', qty: 10 })], ppc: { [ 'AMZ-1__RTC327-6060']: plan({ sku: 'RTC327-6060', qty: 10, route: 'inhouse', fabric: { name: 'Sheeting 92', perPc: 0.6, metres: 6 }, print: { need: true, dir: 'Vertical' }, extra: [{ what: 'Ruffle — Cambric', qty: 23.5, unit: 'm' }] }) } });
      Object.keys(spans).forEach(k => delete spans[k]); B.ctx.document.querySelector = q => (/data-mat=|data-fm=|data-pget=|data-chips=/.test(q) ? span(q) : null); return B; };
    /* Ravi's screen: 100 m printed RBPSF327-V-92 and 1,500 m printed LSB in the store; Cambric RFD 0. */
    A = mk([{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 100 }, { key: 'M|CAMBRIC|LIGHT STEEL BLUE', qty: 1500 }]);
    A.flowPpcOpen('AMZ-1', 'RTC327-6060');
    const mt = spans['[data-mat="0"]'].innerHTML;
    ok('the ruffle Cambric (23.5 m) is covered by the 1,500 m printed LSB', /Printed in store · <b>LSB<\/b>/.test(mt) && /✓ covers 23\.5 m/.test(mt), mt);
    ok('the body: 100 m printed RBPSF327-V-92 covers the 6 m', /Printed in store · <b>RBPSF327-V-92<\/b>/.test(mt) && /✓ covers 6 m/.test(mt));
    ok('…RFD needs 0 m of either — "not needed", never "short 0"', /not needed/.test(mt) && !/short/.test(mt));
    ok('the printer box: all already printed — nothing goes to the printer, straight to Cutting', /All already printed, in the store — nothing goes to the printer/.test(spans['[data-pget="0"]'].innerHTML));
    ok('the chip says all in stock', /✓ all in stock/.test(spans['[data-chips="0"]'].innerHTML));
    A.ctx.document.querySelectorAll = () => []; A.els.flpUndo = { checked: false };
    let er = await A.ctx.__dlg.onSave(); let w0 = A.writes[0] || {}, pw = w0['pt_ppc/AMZ-1__RTC327-6060'] || {};
    ok('it saves with no printer picked — no printer is needed', !er && pw.fabric, er);
    ok('saved on the plan: 6 m body and 23.5 m ruffle from printed stock', pw.fabric.fromPrinted === 6 && pw.extra[0].fromPrinted === 23.5, JSON.stringify(pw.fabric));
    ok('no print order, no vendor order — nothing for a printer', !Object.keys(w0).some(k => /^pt_(flowPrintOrders|vendorOrders)\//.test(k)), Object.keys(w0).join());
    { const B = mk([{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 100 }, { key: 'M|CAMBRIC|LIGHT STEEL BLUE', qty: 1500 }]);
      B.flowPpcOpen('AMZ-1', 'RTC327-6060'); B.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }]; B.els.flpUndo = { checked: false };
      const e3 = await B.ctx.__dlg.onSave();
      ok('…even with a printer picked, nothing goes to it', !e3 && !Object.keys(B.writes[0] || {}).some(k => /^pt_(flowPrintOrders|vendorOrders)\//.test(k)), e3 || Object.keys(B.writes[0] || {}).join()); }
    const st0 = A.flowState(L({ sku: 'RTC327-6060', qty: 10, cutReq: true }));
    ok('the line goes straight to Cutting: given and back in full, not in Demand', st0.fromStock && st0.given === 10 && st0.back === 10 && st0.bucket === 'cut' && !A.flowInView('drfd', st0));
    A.W.lines[0].cutReq = true; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) })); A.setView('cut'); A.ctx.document.querySelector = () => null;
    A.ctx.ME = A.ctx.ME; A.renderFlow();
    ok('the Cutting list shows what to cut: RBPSF327-V-92, 6 m for 10 pcs, all from printed stock', /RBPSF327-V-92/.test(A.els.flTable.innerHTML) && /6 m for 10 pcs/.test(A.els.flTable.innerHTML) && /all from printed stock in the store/.test(A.els.flTable.innerHTML), A.els.flTable.innerHTML.slice(0, 300));
    A = mk([{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 2 }]);
    A.flowPpcOpen('AMZ-1', 'RTC327-6060');
    const m2 = spans['[data-mat="0"]'].innerHTML;
    ok('only 2 m printed in store → covers 2 m, RFD the rest 4 m; ruffle all from RFD → short', /✓ covers 2 m/.test(m2) && /\(the rest\)<\/span><\/td><td class="num">4 m/.test(m2) && /⚑ short 23\.5 m/.test(m2), m2);
  }

  console.log('== a quilt: Front and Back, half the cloth each ==');
  {
    const mdb = { 'RQL327-Q': { color: 'Light Steel Blue', fabric: 'Voil 92', consumption: 5, cuttingRequired: true, articleType: 'Quilt' } };
    const fsCat = [{ sku: 'RQL327-Q-Front', fabric: 'Voil 92', colour: 'Light Steel Blue', dir: 'Vertical', side: 'Front', code: '327' },
      { sku: 'RQL327-Q-Back', fabric: 'Voil 92', colour: 'Light Steel Blue', dir: 'Vertical', side: 'Back', code: '327' }];
    A = load({ me: { admin: true }, mdb, fsCat, rfd: { 'VOIL 92': 999 }, lines: [L({ sku: 'RQL327-Q', qty: 10 })],
      ppc: { 'AMZ-1__RQL327-Q': plan({ sku: 'RQL327-Q', qty: 10, printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Voil 92', perPc: 5, metres: 50 }, print: { need: true, dir: 'Vertical' } }) } });
    const w = A.flowPrintWhat(L({ sku: 'RQL327-Q' }), A.FLOW().ppc['AMZ-1__RQL327-Q']);
    ok('the quilt prints as two fabric SKUs: Front RQL327-Q-Front + Back RQL327-Q-Back', w.sides && w.sides.length === 2 && w.sides[0].side === 'Front' && w.sides[0].code === 'RQL327-Q-Front' && w.sides[1].code === 'RQL327-Q-Back');
    A.flowChallanOpen('AMZ-1', 'P1');
    A.ctx.document.querySelector = q => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '50' } })[q] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    await A.ctx.__dlg.onSave();
    const gs = A.flowChPrintGroups(A.FLOW().ch['RFD-202610-001']);
    ok('"To print": RQL327-Q-Front 25 m and RQL327-Q-Back 25 m (5 m a quilt = 2.5 + 2.5)', gs.length === 2 && gs.find(g => g.code === 'RQL327-Q-Front').metres === 25 && gs.find(g => g.code === 'RQL327-Q-Back').metres === 25, JSON.stringify(gs));
  }

  console.log('== one printed fabric, several orders → one challan ==');
  {
    const mdb = { 'RPC327-A': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.5, cuttingRequired: true }, 'RPC327-B': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.25, cuttingRequired: true } };
    const fsCat = [{ sku: 'RBP-CANVAS-327', fabric: 'Canvas', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }];
    const pr = { code: 'P1', name: 'Sanganer Prints' };
    const pp = (no, sku, m) => plan({ orderNo: no, sku, qty: 10, printer: pr, fabric: { name: 'Canvas', perPc: m / 10, metres: m }, print: { need: true } });
    A = load({ me: { admin: true }, mdb, fsCat, rfd: { CANVAS: 999 },
      lines: [L({ orderNo: 'AMZ-1', sku: 'RPC327-A' }), L({ orderNo: 'AMZ-2', sku: 'RPC327-B' }), L({ orderNo: 'TEST-AMZ-9', sku: 'RPC327-A', __t: {} })],
      ppc: { 'AMZ-1__RPC327-A': pp('AMZ-1', 'RPC327-A', 5), 'AMZ-2__RPC327-B': pp('AMZ-2', 'RPC327-B', 2.5), 'TEST-AMZ-9__RPC327-A': pp('TEST-AMZ-9', 'RPC327-A', 5) } });
    A.flowTestOnlySet(false);
    A.setView('drfd'); A.setAngle('drfd', 'print'); A.renderFlow();
    const h = A.els.flTable.innerHTML;
    ok('By printed fabric: RBP-CANVAS-327 for AMZ-1 + AMZ-2 in one row, 7.5 m to print, Sanganer', /RBP-CANVAS-327/.test(h) && /AMZ-1<br>AMZ-2/.test(h) && /<b>7\.5 m<\/b>/.test(h) && /One challan for 2 orders/.test(h), h);
    ok('…the test order is its own row, never mixed with real ones', (h.match(/RBP-CANVAS-327/g) || []).length === 2);
    A.flowChallanForKeys(['AMZ-1__RPC327-A', 'TEST-AMZ-9__RPC327-A']);
    ok('a test order and a real one cannot share a challan', /cannot share a challan/.test(A.els.flMsg.textContent));
    A.flowChallanForKeys(['AMZ-1__RPC327-A', 'AMZ-2__RPC327-B']);
    ok('one challan form with both orders\u2019 lines', /AMZ-1/.test(A.ctx.__dlg.html) && /AMZ-2/.test(A.ctx.__dlg.html) && /2 orders, one printed fabric, one vendor/.test(A.ctx.__dlg.subtitle));
    A.ctx.document.querySelector = q => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '5' }, '[data-chk="1"]': { checked: true }, '[data-chm="1"]': { value: '2.5' } })[q] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    const er = await A.ctx.__dlg.onSave(); const ch = A.FLOW().ch['RFD-202610-001'];
    ok('saved as one challan for both orders; both lines move on', !er && ch.orders.join() === 'AMZ-1,AMZ-2' && ch.orderNo === 'AMZ-1, AMZ-2' && A.flowState(L({ orderNo: 'AMZ-1', sku: 'RPC327-A' })).bucket === 'fabric' && A.flowState(L({ orderNo: 'AMZ-2', sku: 'RPC327-B' })).bucket === 'fabric', er);
  }

  console.log('== PPC raises the plan → the printer gets its print order at once; the fabric follows in challans ==');
  {
    const mdb = { 'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true },
      'CPC-02': { color: 'Agate Green', fabric: 'Sheeting 62', consumption: 2.35, cuttingRequired: false } };
    const fsCat = [{ sku: 'RBP-CANVAS-327', fabric: 'Canvas', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }];
    const PRF = v => ({ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: v });
    const PRF1 = v => ({ addEventListener() {}, dataset: { fp: '1', k: 'printer.code' }, type: 'select-one', value: v });
    A = load({ me: { admin: true }, mdb, fsCat, rfd: { CANVAS: 999, 'SHEETING 62': 999 }, fabRows: [{ fabricType: 'Canvas' }],
      lines: [L({ sku: 'RPC327-1818', qty: 10 }), L({ sku: 'CPC-02', qty: 45 })] });
    A.flowPpcOpen('AMZ-1');
    A.ctx.document.querySelectorAll = () => [PRF('P1'), PRF1('P1')];
    let er = await A.ctx.__dlg.onSave();
    const po = Object.values(A.FLOW().po)[0];
    ok('one save → one print order PRN-202610-001 to Sanganer, both lines on it', !er && po && po.no === 'PRN-202610-001' && po.printer.name === 'Sanganer Prints'
      && po.items['AMZ-1__RPC327-1818'] && po.items['AMZ-1__CPC-02'], er || JSON.stringify(A.FLOW().po));
    ok('…what to print: RBP-CANVAS-327 5.3 m, and CPC-02 45 pcs on the SKU itself', po.items['AMZ-1__RPC327-1818'].print.code === 'RBP-CANVAS-327' && po.items['AMZ-1__RPC327-1818'].metres === 5.3
      && po.items['AMZ-1__CPC-02'].unit === 'pcs' && po.items['AMZ-1__CPC-02'].pcs === 45);
    ok('the line is given to the printer by the print order; the fabric team still owes the cloth (Demand · RFD)', A.flowState(L({ sku: 'RPC327-1818', qty: 10 })).given === 10 && A.flowInView('drfd', A.flowState(L({ sku: 'RPC327-1818', qty: 10 }))));
    A.setView('pord'); A.renderFlow();
    ok('the Print orders bucket lists it, counted as open', /PRN-202610-001/.test(A.els.flTable.innerHTML) && /sent to printer/.test(A.els.flTable.innerHTML) && /<span class="fl-n">1<\/span><span>Print orders/.test(A.els.flBuckets.innerHTML));
    const page = A.flowPoHtml(po);
    ok('the print order page: PRINT ORDER, the printer, what to print', /PRINT ORDER/.test(page) && /Sanganer Prints/.test(page) && /RBP-CANVAS-327/.test(page) && /5\.3 m/.test(page) && /45 pcs/.test(page));
    /* The fabric team sends the cloth in two goes. */
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('the challan offers what is owed: 5.3 m for the Canvas line', /data-chm="0" type="number" step="0.01" value="5.3"/.test(A.ctx.__dlg.html));
    let q = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '3' }, '[data-chk="1"]': { checked: false }, '[data-chm="1"]': { value: '' } };
    A.ctx.document.querySelector = x => q[x] || null; A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    er = await A.ctx.__dlg.onSave();
    let st = A.flowState(L({ sku: 'RPC327-1818', qty: 10 }));
    ok('3 of 5.3 m sent → still in Demand · RFD, owing 2.3 m', !er && A.flowInView('drfd', st) && st.fabSent === 3 && A.flowFabOwed(L({ sku: 'RPC327-1818', qty: 10 }), st).metres === 2.3, er);
    A.setView('drfd'); A.setAngle('drfd', 'line'); A.renderFlow();
    ok('Demand RFD says "3 of 5.3 m sent" and the print order', /3 of 5\.3 m sent/.test(A.els.flTable.innerHTML) && /print order PRN-202610-001/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('the next challan offers the 2.3 m left', /data-chm="0" type="number" step="0.01" value="2.3"/.test(A.ctx.__dlg.html) && /3 m sent already/.test(A.ctx.__dlg.html));
    q = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '2.3' }, '[data-chk="1"]': { checked: false }, '[data-chm="1"]': { value: '' } };
    er = await A.ctx.__dlg.onSave();
    st = A.flowState(L({ sku: 'RPC327-1818', qty: 10 }));
    ok('all 5.3 m sent over two challans → the line leaves Demand for Printed fabric in', !er && !A.flowInView('drfd', st) && st.bucket === 'fabric' && Object.keys(A.FLOW().ch).length === 2, er);
    A.setView('pord'); A.renderFlow();
    ok('the print order shows the cloth sent: 5.3 m, nothing back yet', /cloth sent 5\.3 m, back 0 m/.test(A.els.flTable.innerHTML) && /fabric going/.test(A.els.flTable.innerHTML));
    /* Printer changed in a re-plan: the line moves to the other printer's order. */
    A = load({ me: { admin: true }, mdb, fsCat, lines: [L({ sku: 'RPC327-1818', qty: 10 })] });
    const r = L({ sku: 'RPC327-1818', qty: 10 }), p1 = Object.assign(A.flowSuggest(r), { printer: { code: 'P1', name: 'Sanganer Prints' } });
    let sy = A.flowPoSync([{ r, p: p1 }], '2026-10-10'); A.setFLOW(Object.assign(A.FLOW(), { po: sy.local }));
    sy = A.flowPoSync([{ r, p: Object.assign({}, p1, { printer: { code: 'P2', name: 'Choudhary Hand Block' } }) }], '2026-10-10');
    ok('printer changed → off PRN-001 (now empty, cancelled), onto a new order for Choudhary', sy.local['PRN-202610-001'].cancelled && sy.local['PRN-202610-002'].printer.code === 'P2' && sy.local['PRN-202610-002'].items['AMZ-1__RPC327-1818']);
    A.setFLOW(Object.assign(A.FLOW(), { po: sy.local }));
    sy = A.flowPoSync([{ r, p: null }], '2026-10-10');
    ok('plan undone → taken off its print order', sy.local['PRN-202610-002'].cancelled && sy.patch['pt_flowPrintOrders/PRN-202610-002/items/AMZ-1__RPC327-1818'] === null);
    sy = A.flowPoSync([{ r, p: Object.assign({}, p1, { route: 'stitch' }) }], '2026-10-10');
    ok('a stitching-only line has no print order', !Object.keys(sy.patch).some(k => /items\/AMZ-1__RPC327-1818$/.test(k) && sy.patch[k]));
  }

  console.log('== a REAL order: PPC places the Vendor Order the printer sees (Vendor Orders / Vendor Portal) ==');
  {
    const mdb = { 'RPC327-1818': { brand: 'Ridhi', color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true, subtype: 'Ruffle Pillow Cover' },
      'CPC-02': { brand: 'CPC', color: 'Agate Green', fabric: 'Sheeting 62', consumption: 2.35, cuttingRequired: false, articleType: 'Tablecloth', size: '60x90' },
      'RQL327-K': { brand: 'Ridhi', color: 'Light Steel Blue', fabric: 'Voil 112', consumption: 5, cuttingRequired: true, articleType: 'Quilt' } };
    const fsCat = [{ sku: 'RBP-CANVAS-327', fabric: 'Canvas', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' },
      { sku: 'LSB', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327', manual: true },
      { sku: 'RQL327-K-Front', fabric: 'Voil 112', colour: 'Light Steel Blue', dir: 'Horizontal', side: 'Front', code: '327' },
      { sku: 'RQL327-K-Back', fabric: 'Voil 112', colour: 'Light Steel Blue', dir: 'Horizontal', side: 'Back', code: '327' }];
    const PRF = (i, v) => ({ addEventListener() {}, dataset: { fp: String(i), k: 'printer.code' }, type: 'select-one', value: v });
    const mk = o => load(Object.assign({ me: { admin: true }, mdb, fsCat, rfd: { CANVAS: 999 }, lines: [L({ sku: 'RPC327-1818', qty: 10, src: 'AMZ' }), L({ sku: 'CPC-02', qty: 45, src: 'AMZ' }), L({ sku: 'RQL327-K', qty: 10, src: 'AMZ' })] }, o));
    A = mk({});
    A.flowPpcOpen('AMZ-1');
    A.ctx.document.querySelectorAll = () => [PRF(0, 'P1'), PRF(1, 'P1'), PRF(2, 'P1')];
    let er = await A.ctx.__dlg.onSave();
    let w = A.writes[0] || {}, vk = Object.keys(w).filter(k => k.startsWith('pt_vendorOrders/'));
    const run = vk.map(k => w[k]).find(o => o.orderType === 'running'), cut = vk.map(k => w[k]).find(o => o.orderType === 'cut');
    ok('asked first: "the printer sees it in the Vendor Portal now", naming the orders', /Vendor Portal now/.test((A.ctx.__asked || [])[0] || '') && /VPO-261010-T1 — Sanganer Prints/.test((A.ctx.__asked || [])[0] || ''), (A.ctx.__asked || []).join(' | '));
    ok('one save → a running Vendor Order and a cut one, Placed, with Sanganer, in the same write as the plan', !er && vk.length === 2 && run && cut && run.status === 'Placed' && run.vendorCode === 'P1'
      && /^pt_vendorOrders\/P1\/vpo_flow_/.test(vk[0]) && w['pt_ppc/AMZ-1__RPC327-1818'], er || vk.join());
    ok('…the running order: RBP-CANVAS-327 5.3 m, the quilt as Front 25 m + Back 25 m', run.lines.some(l => l.sku === 'RBP-CANVAS-327' && l.meters === 5.3 && l.fabricType === 'Canvas' && l.printDirection === 'Vertical')
      && run.lines.some(l => l.sku === 'RQL327-K-Front' && l.meters === 25) && run.lines.some(l => l.sku === 'RQL327-K-Back' && l.meters === 25), JSON.stringify(run.lines.map(l => [l.sku, l.meters])));
    { const vl = A.flowVoLines({ no: 'PRN-X', orderNo: 'AMZ-1', items: { 'AMZ-1__RPC327-1818': { sku: 'RPC327-1818', unit: 'm', metres: 5.3, pcs: 10,
        print: { kind: 'fabric', code: 'RBP-CANVAS-327', label: 'Light Steel Blue · Canvas · Vertical' }, extras: [{ code: 'LSB', label: 'Light Steel Blue · Cambric · Vertical', metres: 4 }] } } });
      ok('…a ruffle’s cloth is its own running line: LSB · Cambric · 4 m', vl.running.some(l => l.sku === 'LSB' && l.fabricType === 'Cambric' && l.meters === 4 && /ruffle/.test(l.notes))); }
    ok('…the cut order: CPC-02 45 pcs, size and article, like the Vendor Orders screen writes', cut.lines.length === 1 && cut.lines[0].sku === 'CPC-02' && cut.lines[0].qty === 45 && cut.lines[0].size === '60x90' && cut.lines[0].kind === 'cut');
    ok('…every line names the sales order it is for (forOrders AMZ-1) and the channel is Amazon', run.lines.concat(cut.lines).every(l => l.forOrders[0].orderNo === 'AMZ-1' && l.lineId) && run.channel === 'Amazon' && run.service === 'Block print');
    ok('…the flow print order points at them; the Vendor Orders list has them', A.FLOW().po['PRN-202610-001'].vo.running.id === run.id && A.FLOW().po['PRN-202610-001'].vo.cut.orderNo === cut.orderNo && A.VOrows().length === 2);
    /* re-plan: the same vendor order is updated, its line ids kept */
    const lid = run.lines.find(l => l.sku === 'RBP-CANVAS-327').lineId;
    A.flowPpcOpen('AMZ-1', 'RPC327-1818');
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'fabric.perPc' }, type: 'number', value: '0.6' }, PRF(0, 'P1')];
    A.els.flpUndo = { checked: false };
    er = await A.ctx.__dlg.onSave(); w = A.writes[1] || {};
    const run2 = w['pt_vendorOrders/P1/' + run.id];
    ok('re-plan (0.6 m/pc): the SAME vendor order is updated — 6 m, its line id kept', !er && run2 && run2.orderNo === run.orderNo && run2.lines.find(l => l.sku === 'RBP-CANVAS-327').meters === 6 && run2.lines.find(l => l.sku === 'RBP-CANVAS-327').lineId === lid, er);
    /* the printer has started: never rewritten from here */
    A.setVOrows(A.VOrows().map(o => o.id === run.id ? Object.assign({}, o, { lines: o.lines.map((l, i) => i === 0 ? Object.assign({}, l, { deliveries: [{ qty: 2 }] }) : l) }) : o));
    A.flowPpcOpen('AMZ-1', 'RPC327-1818');
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'fabric.perPc' }, type: 'number', value: '0.7' }, PRF(0, 'P1')];
    er = await A.ctx.__dlg.onSave(); w = A.writes[2] || {};
    ok('once the printer has delivered on it, the vendor order is left alone — said', !er && !w['pt_vendorOrders/P1/' + run.id] && /has deliveries already/.test(A.els.flMsg.textContent + ' ' + JSON.stringify(A.ctx.__said || '')) || !w['pt_vendorOrders/P1/' + run.id]);
    /* declined: nothing at all is written */
    const B = mk({ confirmNo: true });
    B.flowPpcOpen('AMZ-1'); B.ctx.document.querySelectorAll = () => [PRF(0, 'P1'), PRF(1, 'P1'), PRF(2, 'P1')];
    er = await B.ctx.__dlg.onSave();
    ok('answer No → not saved, no Vendor Order, the list as it was', /no Vendor Order was placed/.test(er) && !B.writes.length && B.VOrows().length === 0, er);
    /* a test order never makes one */
    const C = load({ me: { admin: true }, mdb, fsCat, lines: [L({ orderNo: 'TEST-AMZ-1', sku: 'RPC327-1818', qty: 10, __t: {} })] });
    C.flowPpcOpen('TEST-AMZ-1'); C.ctx.document.querySelectorAll = () => [PRF(0, 'P1')];
    er = await C.ctx.__dlg.onSave();
    ok('a TEST order: its TPRN print order only — no Vendor Order, nothing for a printer to see', !er && !Object.keys(C.writes[0]).some(k => k.startsWith('pt_vendorOrders/')) && Object.keys(C.writes[0]).some(k => /pt_flowPrintOrders\/TPRN-/.test(k)), er);
    /* printer changed / plan undone */
    const D = mk({});
    D.flowPpcOpen('AMZ-1'); D.ctx.document.querySelectorAll = () => [PRF(0, 'P1'), PRF(1, 'P1'), PRF(2, 'P1')]; await D.ctx.__dlg.onSave();
    const first = Object.values(D.writes[0]).find(o => o && o.orderType === 'cut');
    D.flowPpcOpen('AMZ-1', 'CPC-02'); D.ctx.document.querySelectorAll = () => [PRF(0, 'P2')]; D.els.flpUndo = { checked: false };
    er = await D.ctx.__dlg.onSave(); w = D.writes[1] || {};
    const p2 = Object.keys(w).filter(k => /^pt_vendorOrders\/P2\//.test(k)).map(k => w[k])[0];
    ok('printer changed → the old cut order is cancelled, a new one placed with Choudhary', !er && w['pt_vendorOrders/P1/' + first.id].status === 'Cancelled' && p2 && p2.vendorName === 'Choudhary Hand Block' && p2.lines[0].sku === 'CPC-02', er || Object.keys(w).join());
    D.flowPpcOpen('AMZ-1', 'CPC-02'); D.els.flpUndo = { checked: true };
    er = await D.ctx.__dlg.onSave(); w = D.writes[2] || {};
    ok('plan undone → its vendor order cancelled too', !er && Object.values(w).some(o => o && o.id === p2.id && o.status === 'Cancelled'), er || Object.keys(w).join());
  }

  console.log('== accessories reserved by themselves when PPC raises the plan ==');
  {
    const mdb = { 'S1': { cons: 1, fab: 'Cotton', chainLength: '18' }, 'S2': { cons: 1, fab: 'Cotton', chainLength: '18' }, 'S3': { cons: 1, fab: 'Cotton', chainLength: '18' } };
    A = load({ me: { admin: true }, mdb, shelf: [{ code: '18', name: '18 inch zip', qty: 100 }],
      lines: [L({ sku: 'S1', qty: 40 }), L({ sku: 'S2', qty: 50 }), L({ sku: 'S3', qty: 30 })] });
    A.flowPpcOpen('AMZ-1');
    A.ctx.document.querySelectorAll = () => [0, 1, 2].map(i => ({ addEventListener() {}, dataset: { fp: String(i), k: 'printer.code' }, type: 'select-one', value: 'P1' }));
    const er = await A.ctx.__dlg.onSave(); const w = A.writes[0] || {};
    ok('100 zippers: S1 (40) and S2 (50) are reserved in the same save, marked auto', !er && w['pt_accReserve/AMZ-1__S1'].items['18'] === 40 && w['pt_accReserve/AMZ-1__S2'].items['18'] === 50 && w['pt_accReserve/AMZ-1__S1'].auto, er);
    ok('S3 (30) — only 10 left — is not reserved and waits in Demand · Accessories', !w['pt_accReserve/AMZ-1__S3'] && A.flowInView('dacc', A.flowState(L({ sku: 'S3', qty: 30 }))));
    ok('…S1 and S2 are not in Demand · Accessories', !A.flowInView('dacc', A.flowState(L({ sku: 'S1', qty: 40 }))) && !A.flowInView('dacc', A.flowState(L({ sku: 'S2', qty: 50 }))));
    ok('the shelf now shows 10 free', A.flowAccFree()['18'].free === 10);
  }

  console.log('== Cutting, Raw cutting in store, WIP open the factory\u2019s own entry for the line ==');
  {
    A = load({ me: { admin: true }, base: [{ id: 'b0', sku: 'S1', orderNo: 'AMZ-2', issuePieces: 10, receivedPieces: 0, empName: 'Other order' }, { id: 'b1', sku: 'S1', orderNo: 'AMZ-1', issuePieces: 30, receivedPieces: 10, rejectionPieces: 0, empName: 'Ramesh', issueDate: '2026-10-11' },
      { id: 'b2', sku: 'S9', orderNo: 'AMZ-1', issuePieces: 5, receivedPieces: 5 }] });
    const r = L({ sku: 'S1', qty: 100, cutReq: true, cut: 60 }), st = A.flowState(r);
    await A.flowCutEntry(r, st);
    ok('Cutting entry: Cutting Data opens with SKU S1, order AMZ-1, the 40 pieces still to cut', A.ctx.__tabs.includes('pcut') && A.els.cwSku.value === 'S1' && A.els.cwOrd.value === 'AMZ-1' && A.els.cwPcs.value === 40);
    await A.flowIssueEntry(r, st);
    ok('Issue to karigar: the Job Work form opens with S1, AMZ-1 and the 60 cut, none issued yet', A.ctx.__tabs.includes('pbase') && A.els.bwSku.value === 'S1' && A.els.bwOrd.value === 'AMZ-1' && A.els.bwPcs.value === A.flowIssuable(r, st) && A.flowIssuable(r, st) === 60);
    A.flowRecvEntry(r);
    ok('Receive: the karigar\u2019s open issue for this line (Ramesh, 20 still out) opens the Job Work receive', A.ctx.__recv === 'b1');
    const r2 = L({ sku: 'S1', qty: 100, issued: 30, received: 25 });
    await A.flowQcEntry(r2);
    ok('Quality Control →: the QC screen opens on Waiting for QC, narrowed to AMZ-1', A.ctx.__tabs.includes('qc') && A.els.qcQ.value === 'AMZ-1');
    A.flowRecvEntry(L({ sku: 'S9', qty: 5 }));
    ok('nothing out with a karigar → it says so', /Nothing of S9 on AMZ-1 is out with a karigar/.test(A.els.flMsg.textContent));
    const B = load({ me: { tabs: ['flcut'] } });
    await B.flowCutEntry(r, st);
    ok('an account without the Cutting right is told, and no screen is opened', /not open to this account/.test(B.els.flMsg.textContent) && !(B.ctx.__tabs || []).length);
    A.W.lines.push(L({ orderNo: 'AMZ-5', sku: 'S5', qty: 10, orderDate: '2026-09-01', cutReq: true }));
    A.setView('cut'); A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) })); A.renderFlow();
    ok('the Cutting list offers "Cutting entry" for a real line', /data-flent="cut\|AMZ-5__S5"/.test(A.els.flTable.innerHTML));
  }

  console.log('== a body all from printed stock still sends its ruffle cloth ==');
  {
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }, { sku: 'LSB', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327', manual: true }];
    const pl = plan({ sku: 'RTC327-6060', qty: 10, route: 'inhouse', printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Sheeting 92', perPc: 0.6, metres: 6, fromPrinted: 6, printedUnit: 'm' }, print: { need: true, dir: 'Vertical' }, extra: [{ what: 'Ruffle — Cambric', qty: 23.5, unit: 'm', fromPrinted: 0 }] });
    A = load({ me: { admin: true }, mdb, fsCat, lines: [L({ sku: 'RTC327-6060', qty: 10 })], ppc: { 'AMZ-1__RTC327-6060': pl } });
    ok('the body is covered (0 m owed) but the ruffle cloth is not → still in Demand · RFD', A.flowInView('drfd', A.flowState(L({ sku: 'RTC327-6060', qty: 10 }))));
    A.flowChallanOpen('AMZ-1', 'P1');
    A.ctx.document.querySelector = x => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '0' } })[x] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    const er = await A.ctx.__dlg.onSave();
    const ch = A.FLOW().ch['RFD-202610-001'];
    ok('a challan for the ruffle cloth alone: LSB 23.5 m', !er && ch && ch.lines[0].extras[0].code === 'LSB' && ch.lines[0].extras[0].metres === 23.5, er);
    ok('…and the line moves on', !A.flowInView('drfd', A.flowState(L({ sku: 'RTC327-6060', qty: 10 }))));
  }

  console.log('== the catalogue by its own colour code; a SKU added by hand wins ==');
  {
    const mdb = { 'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true } };
    /* The real 327 rows: built names that do not carry the code where the SKU-text reading looked for it. */
    const fsCat = [
      { sku: 'RBP-CANVAS-327', fabric: 'Canvas', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' },
      { sku: 'RBP327', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' },
      { sku: 'LSB', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327', manual: true },
      { sku: 'CPC-CANVAS-327', fabric: 'Canvas', colour: 'Some Other Colour', dir: 'Vertical', code: '327' },
      { sku: 'RBP-CANVAS-328', fabric: 'Canvas', colour: 'Light Steel Blue', dir: 'Vertical', code: '328' },   // one colour name, two codes
    ];
    A = load({ mdb, fsCat });
    const p1 = plan({ sku: 'RPC327-1818', route: 'inhouse', fabric: { name: 'Canvas', perPc: 0.53, metres: 10.6 }, print: { need: true }, extra: [{ what: 'Ruffle — Cambric', qty: 8, unit: 'm' }] });
    const w = A.flowPrintWhat(L({ sku: 'RPC327-1818', qty: 20 }), p1);
    ok('Canvas 327 → RBP-CANVAS-327 (Ravi\u2019s screen said "no fabric SKU in the catalogue")', w.code === 'RBP-CANVAS-327' && !w.needDir, JSON.stringify(w));
    const xs = A.flowPrintExtras(L({ sku: 'RPC327-1818', qty: 20 }), p1);
    ok('the ruffle Cambric → LSB, the one added by hand — not the built RBP327', xs.length === 1 && xs[0].code === 'LSB' && xs[0].metres === 8, JSON.stringify(xs));
    ok('a built SKU with no hand-added one beside it still counts (RBP327 when LSB is not there)', load({ mdb, fsCat: fsCat.filter(c => !c.manual) }).flowPrintExtras(L({ sku: 'RPC327-1818', qty: 20 }), p1)[0].code === 'RBP327');
  }

  console.log('== a plan saved before the master-data fix is flagged, not hidden ==');
  {
    const mdb = { 'RPC327-1818': { color: 'Light Steel Blue', fabric: 'Canvas', consumption: 0.53, cuttingRequired: true },
      'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 62', consumption: 1.58, cuttingRequired: false } };
    const old = { 'AMZ-1__RPC327-1818': plan({ sku: 'RPC327-1818', qty: 10, printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Sheeting 82', perPc: 0.13, metres: 1.3 } }),
      'AMZ-1__RTC327-6060': plan({ sku: 'RTC327-6060', qty: 10, printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Sheeting 62', perPc: 1.58, metres: 15.8 } }) };
    A = load({ me: { admin: true }, mdb, rfd: { 'SHEETING 82': 99, 'SHEETING 62': 99 }, lines: [L({ sku: 'RPC327-1818', qty: 10 }), L({ sku: 'RTC327-6060', qty: 10 })], ppc: old });
    A.setView('drfd'); A.renderFlow();
    const h = A.els.flTable.innerHTML;
    ok('Ravi\u2019s old RPC327-1818 plan (Sheeting 82, 1.3 m) shows "⚑ master data says Canvas · 0.53 m/pc → 5.3 m"', /master data says Canvas · 0\.53 m\/pc → 5\.3 m/.test(h));
    ok('a plan that matches the master row has no flag', (h.match(/master data says/g) || []).length === 1);
    ok('right fabric, wrong m/pc is flagged too (RTME-327: Canvas 0.22 saved, master 0.25)', !!(load({ mdb: { 'RTME-327': { fabric: 'Canvas', consumption: 0.25 } } }).flowMasterDiff(L({ sku: 'RTME-327', qty: 1 }), plan({ fabric: { name: 'Canvas', perPc: 0.22 } }))));
    A.flowPpcOpen('AMZ-1', 'RPC327-1818');
    ok('edit plan opens on the MASTER data (Canvas · 0.53), saying what the old plan had', /value="Canvas"/.test(A.ctx.__dlg.html) && /value="0.53"/.test(A.ctx.__dlg.html) && /old plan had Sheeting 82 · 0\.13 m\/pc/.test(A.ctx.__dlg.html) && !/master data says/.test(A.ctx.__dlg.html));
    A.ctx.document.querySelectorAll = () => []; A.els.flpUndo = { checked: false };
    let er = await A.ctx.__dlg.onSave();
    let w = A.writes[0]['pt_ppc/AMZ-1__RPC327-1818'];
    ok('…saving makes the plan Canvas · 5.3 m (master data) — the flag is gone', !er && w.fabric.name === 'Canvas' && w.fabric.metres === 5.3 && w.fabric.how === 'master data' && !w.fabric.was && !A.flowMasterDiff(L({ sku: 'RPC327-1818', qty: 10 }), w), er);
    /* A fabric PPC typed on purpose stays PPC's choice. */
    const typed = { 'AMZ-1__RPC327-1818': plan({ sku: 'RPC327-1818', qty: 10, printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Sheeting 82', perPc: 0.13, metres: 1.3, how: 'typed by PPC' } }) };
    A = load({ me: { admin: true }, mdb, lines: [L({ sku: 'RPC327-1818', qty: 10 })], ppc: typed });
    A.flowPpcOpen('AMZ-1', 'RPC327-1818');
    ok('a fabric PPC typed on purpose is kept, flagged, with "Use the master data"', /value="Sheeting 82"/.test(A.ctx.__dlg.html) && /master data says Canvas/.test(A.ctx.__dlg.html) && /data-usem="0" data-n="Canvas" data-p="0.53"/.test(A.ctx.__dlg.html));
    const nameBox = { value: 'Sheeting 82', dataset: { fp: '0', k: 'fabric.name' }, type: 'text', addEventListener() {} };
    const perBox = { value: '0.13', dataset: { fp: '0', k: 'fabric.perPc' }, type: 'number', addEventListener() {}, dispatchEvent() {} };
    const btn = { dataset: { usem: '0', n: 'Canvas', p: '0.53' }, parentNode: { textContent: '' }, remove() {} };
    A.ctx.document.querySelectorAll = sel => (sel === '[data-usem]' ? [btn] : [nameBox, perBox]);
    A.ctx.document.querySelector = sel => (sel === '[data-fp="0"][data-k="fabric.name"]' ? nameBox : sel === '[data-fp="0"][data-k="fabric.perPc"]' ? perBox : null);
    A.flowPpcOpen('AMZ-1', 'RPC327-1818');
    btn.onclick();
    ok('pressing it puts Canvas and 0.53 in the boxes', nameBox.value === 'Canvas' && perBox.value === '0.53');
    A.els.flpUndo = { checked: false };
    er = await A.ctx.__dlg.onSave(); w = A.writes[0]['pt_ppc/AMZ-1__RPC327-1818'];
    ok('…and saving with them makes it master data again', !er && w.fabric.name === 'Canvas' && w.fabric.how === 'master data', er);
    nameBox.value = 'Sheeting 82'; perBox.value = '0.13';
    A.flowPpcOpen('AMZ-1', 'RPC327-1818'); er = await A.ctx.__dlg.onSave(); w = A.writes[1]['pt_ppc/AMZ-1__RPC327-1818'];
    ok('typing another fabric again saves it as "typed by PPC"', !er && w.fabric.name === 'Sheeting 82' && w.fabric.how === 'typed by PPC', er);
  }

  console.log('== putting a mistake right ==');
  {
    const mdb = { S1: { cons: 1, fab: 'Cotton', chainLength: '18' } };
    const pl = plan({ printer: { code: 'P1', name: 'Sanganer Prints' }, acc: [{ code: '18', qty: 100 }], fabric: { name: 'Cotton', perPc: 1, metres: 100 } });
    A = load({ me: { admin: true }, mdb, lines: [L()], ppc: { [K]: pl }, dem: { [K]: { fabricReady: { at: 'x', metres: 100 } } }, res: { [K]: { items: { 18: 100 } } } });
    A.setView('cut'); A.renderFlow(); A.setView('vendor'); A.renderFlow();
    ok('every planned line has an "edit plan" link', /data-flplan="AMZ-1\|S1"/.test(A.els.flTable.innerHTML));
    A.flowPpcOpen('AMZ-1', 'S1');
    ok('it opens the plan as saved, as an edit, with an undo box', /Edit plan/.test(A.ctx.__dlg.title) && /flpUndo/.test(A.ctx.__dlg.html) && /Save the plan/.test(A.ctx.__dlg.saveLabel));
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'acc.0.qty' }, type: 'number', value: '90' }];
    A.els.flpUndo = { checked: false };
    let er = await A.ctx.__dlg.onSave(); let w = A.writes[0] || {};
    ok('changing the accessories lets go of the old reservation, in the same save', !er && w['pt_ppc/' + K].acc[0].qty === 90 && w['pt_accReserve/' + K] === null, er);
    ok('…fabric unchanged, so "fabric ready" stays', !('pt_flowDemand/' + K + '/fabricReady' in w));
    ok('…and the line is back in Demand · Accessories to reserve again', A.flowInView('dacc', A.flowState(L())));
    ok('the plan list holds only plans (no stray keys)', Object.keys(A.FLOW().ppc).every(k => !/\//.test(k)));
    A.flowPpcOpen('AMZ-1', 'S1');
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'fabric.perPc' }, type: 'number', value: '1.2' }];
    er = await A.ctx.__dlg.onSave(); w = A.writes[1] || {};
    ok('changing the cloth undoes "fabric ready" (it was ready for the old plan)', !er && w['pt_flowDemand/' + K + '/fabricReady'] === null && A.flowInView('drfd', A.flowState(L())));
    A.flowPpcOpen('AMZ-1', 'S1'); A.els.flpUndo = { checked: true };
    er = await A.ctx.__dlg.onSave(); w = A.writes[2] || {};
    ok('undo the plan → the line is back in PPC, its demand and reservation gone', !er && w['pt_ppc/' + K] === null && w['pt_flowDemand/' + K] === null && w['pt_accReserve/' + K] === null && A.flowState(L()).bucket === 'ppc');

    const ch = { 'RFD-202610-001': { no: 'RFD-202610-001', date: '2026-10-10', orderNo: 'AMZ-1', vendor: { code: 'P1', name: 'Sanganer Prints' },
      lines: [{ key: K, sku: 'S1', fabric: 'Cotton', metres: 100 }, { key: 'AMZ-1__S2', sku: 'S2', fabric: 'Cotton', metres: 50 }] } };
    const fr = { at: 'x', challan: 'RFD-202610-001', vendor: 'Sanganer Prints' };
    const mk = () => { const B = load({ me: { admin: true }, mdb, lines: [L(), L({ sku: 'S2' })], ppc: { [K]: pl, 'AMZ-1__S2': plan({ sku: 'S2', printer: { code: 'P1', name: 'Sanganer Prints' } }) }, dem: { [K]: { fabricReady: fr }, 'AMZ-1__S2': { fabricReady: fr } }, res: { [K]: { items: { 18: 100 } } } });
      B.setFLOW(Object.assign(B.FLOW(), { ch: JSON.parse(JSON.stringify(ch)) })); return B; };
    A = mk();
    A.flowPpcOpen('AMZ-1', 'S1');
    ok('a line whose fabric is on a challan: fabric, route and printer locked, undo refused — and it says why', /on challan RFD-202610-001/.test(A.ctx.__dlg.subtitle) && /flpUndo" type="checkbox" style="width:auto" disabled/.test(A.ctx.__dlg.html));
    ok('…undo through the back door is refused too', /cancel that challan first/.test(await A.flowUnplan(A.flowState(L()))));
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'fabric.perPc' }, type: 'number', value: '9' }, { addEventListener() {}, dataset: { fp: '0', k: 'note' }, type: 'text', value: 'rush' }];
    A.els.flpUndo = { checked: false };
    await A.ctx.__dlg.onSave(); w = A.writes[0] || {};
    ok('…the rest still saves; the locked fabric stays as it was', w['pt_ppc/' + K].note === 'rush' && w['pt_ppc/' + K].fabric.perPc === 1);
    A.setView('dhist'); A.renderFlow();
    ok('a challan with nothing received offers Edit and Cancel', /data-flche=/.test(A.els.flTable.innerHTML) && /data-flchx=/.test(A.els.flTable.innerHTML));
    const QS = { '[data-cek="0"]': { checked: true }, '[data-cem="0"]': { value: '90' }, '[data-cek="1"]': { checked: false }, '[data-cem="1"]': { value: '50' } };
    A.ctx.document.querySelector = sel => QS[sel] || null;
    A.flowChallanEditOpen('RFD-202610-001'); A.els.flceVen = { value: 'P1' }; A.els.flceDate = { value: '2026-10-11' }; A.els.flceNote = { value: '' };
    er = await A.ctx.__dlg.onSave(); w = A.writes[1] || {};
    const ec = A.FLOW().ch['RFD-202610-001'];
    ok('edit: new metres, the unticked line taken off and back in Demand · RFD', !er && ec.vendor.name === 'Sanganer Prints' && ec.lines.length === 1 && ec.lines[0].metres === 90 && w['pt_flowDemand/AMZ-1__S2/fabricReady'] === null && A.flowInView('drfd', A.flowState(L({ sku: 'S2' }))), er);
    ok('…the line still on it is re-stamped with the challan', w['pt_flowDemand/' + K + '/fabricReady'].vendor === 'Sanganer Prints' && w['pt_flowDemand/' + K + '/fabricReady'].metres === 90);
    A = mk();
    A.flowChallanCancelOpen('RFD-202610-001'); A.els.flccWhy = { value: '' };
    ok('cancel needs a reason', /Say why/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    A.els.flccWhy.value = 'wrong printer';
    er = await A.ctx.__dlg.onSave();
    ok('cancelled: the number stays, both lines back in Demand · RFD, nothing given', !er && A.FLOW().ch['RFD-202610-001'].cancelled.why === 'wrong printer' && A.flowInView('drfd', A.flowState(L())) && A.flowState(L()).given === 0);
    A.setView('dhist'); A.renderFlow();
    ok('…shown as cancelled with no buttons but none, not counted open, and its number not reused', /cancelled/.test(A.els.flTable.innerHTML) && !/data-flchr=/.test(A.els.flTable.innerHTML) && /<span class="fl-n">0<\/span><span>Demand history/.test(A.els.flBuckets.innerHTML) && A.flowChallanNo('2026-10-12') === 'RFD-202610-002');
    A = mk();
    let rq = { '[data-flrm="0"]': { value: '100' }, '[data-flrm="1"]': { value: '50' } };
    A.ctx.document.querySelector = sel => rq[sel] || null;
    A.flowReceiveOpen('RFD-202610-001'); A.els.flrDate = { value: '2026-10-12' }; A.els.flrNote = { value: '' };
    await A.ctx.__dlg.onSave();
    ok('(all received → closed, lines in the store)', A.FLOW().ch['RFD-202610-001'].closed && A.flowState(L()).bucket === 'raw');
    A.setView('dhist'); A.renderFlow();
    ok('received: no Edit / Cancel any more, but Undo last receipt', !/data-flche=/.test(A.els.flTable.innerHTML) && /data-flchu=/.test(A.els.flTable.innerHTML));
    A.flowChallanEditOpen('RFD-202610-001');
    ok('…and Edit itself refuses, saying why', /undo the receipt first/.test(A.els.flMsg.textContent));
    er = await A.flowUndoReceipt('RFD-202610-001');
    ok('undo the receipt: the challan opens again and the lines go back to Printed fabric in', !er && !A.FLOW().ch['RFD-202610-001'].closed && A.flowState(L()).bucket === 'fabric');
    A = mk();
    A.setFLOW(Object.assign(A.FLOW(), { ch: { 'RFD-202610-001': Object.assign(JSON.parse(JSON.stringify(ch['RFD-202610-001'])), { closed: { at: 'x', why: 'oops', short: true } }) } }));
    ok('closed short by mistake → Reopen', !(await A.flowReopen('RFD-202610-001')) && !A.FLOW().ch['RFD-202610-001'].closed && A.flowState(L()).bucket === 'fabric');
  }

  console.log('== only test orders: track one order end to end ==');
  {
    const tst = { 'TEST-AMZ-10102026-01': { orderNo: 'TEST-AMZ-10102026-01', src: 'AMZ', orderDate: '2026-10-13', lines: { S1: { qty: 10 } } } };
    const chs = { 'RFD-202610-001': { no: 'RFD-202610-001', orderNo: 'AMZ-1', vendor: { name: 'Real' }, lines: [] },
      'TRFD-202610-001': { no: 'TRFD-202610-001', orderNo: 'TEST-AMZ-10102026-01', vendor: { name: 'Test' }, lines: [] } };
    A = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines: [L({ orderNo: 'SHP-5717', orderDate: '2026-08-01', sku: 'R1', issued: 1, qty: 1 }), L({ sku: 'R2' })] });
    A.setFLOW(Object.assign(A.FLOW(), { test: tst, ch: chs }));
    ok('with a test order there, the switch starts ON', A.flowTestOnly() === true);
    A.setView('ppc'); A.renderFlow();
    ok('PPC holds only the test order, not the real AMZ-1', /TEST-AMZ-10102026-01/.test(A.els.flTable.innerHTML) && !/AMZ-1<\/a>/.test(A.els.flTable.innerHTML) && /SHOWING TEST ORDERS ONLY/.test(A.els.flMsg.textContent));
    ok('the counts are the test order\u2019s: PPC 1, WIP 0 (the real SHP line is not counted)', /<span class="fl-n">1<\/span><span>PPC/.test(A.els.flBuckets.innerHTML) && /<span class="fl-n">0<\/span><span>WIP/.test(A.els.flBuckets.innerHTML));
    A.setView('dhist'); A.renderFlow();
    ok('Demand history shows only the test challan', /TRFD-202610-001/.test(A.els.flTable.innerHTML) && !/>RFD-202610-001</.test(A.els.flTable.innerHTML) && /<span class="fl-n">1<\/span><span>Demand history/.test(A.els.flBuckets.innerHTML));
    A.flowTestOnlySet(false); A.setView('wip'); A.renderFlow();
    ok('switched off: everything again (the real SHP line is in WIP)', /SHP-5717/.test(A.els.flTable.innerHTML) && !/SHOWING TEST ORDERS ONLY/.test(A.els.flMsg.textContent));
    ok('no test order → the switch starts OFF', load({ me: { admin: true } }).flowTestOnly() === false);
    ok('a choice made is kept (localStorage flowTestOnly)', load({ ls: { flowTestOnly: '0' } , me: { admin: true } }).flowTestOnly() === false && load({ ls: { flowTestOnly: '1' } }).flowTestOnly() === true);
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
    A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
    A.flowPpcOpen(TN); await A.ctx.__dlg.onSave();
    ok('raising the plan sends the printer its print order at once (TPRN-…)', Object.values(A.FLOW().po || {}).some(o => o.no.startsWith('TPRN-') && o.printer.code === 'P1' && o.items[TK]));
    ok('PPC plans it for real → Demand · RFD', A.flowInView('drfd', T().s));
    A.ctx.document.querySelector = sel => ({ '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '5' } })[sel] || null;
    A.flowChallanOpen(TN); A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-13' }; A.els.flcNote = { value: '' };
    await A.ctx.__dlg.onSave();
    ok('its challan is numbered apart (TRFD-…), never using a real number', A.FLOW().ch['TRFD-202610-001'] && A.flowChallanNo('2026-10-13') === 'RFD-202610-001');
    ok('→ Printed fabric in (the challan gave it to the printer)', T().s.bucket === 'fabric');
    A.setView('fabric'); A.renderFlow();
    ok('…with a "Receive on" button, not a Simulate one', /data-flchr="TRFD-202610-001"/.test(A.els.flTable.innerHTML) && !/data-flsim="TEST[^"]*\|fabric"/.test(A.els.flTable.innerHTML));
    A.ctx.document.querySelector = sel => ({ '[data-flrm="0"]': { value: '5' } })[sel] || null;
    A.flowReceiveOpen('TRFD-202610-001'); A.els.flrDate = { value: '2026-10-14' }; A.els.flrNote = { value: '' };
    await A.ctx.__dlg.onSave();
    ok('received in full → the challan closes → the line is in the store (Cutting)', A.FLOW().ch['TRFD-202610-001'].closed && T().s.bucket === 'cut');
    /* Cutting: asks what Cutting Data asks. */
    A.setView('cut'); A.renderFlow();
    ok('Cutting offers "Cutting entry (test)", not a bare Simulate', /data-flte="cut\|TEST-AMZ-13102026-01\|S1"/.test(A.els.flTable.innerHTML) && !/data-flsim="[^"]*\|cut"/.test(A.els.flTable.innerHTML));
    const say = (o) => { Object.entries(o).forEach(([k, v]) => { A.els[k] = { value: v }; }); };
    A.flowTestCutOpen(TN, 'S1');
    say({ fltcP: '10', fltcF: '', fltcU: '5', fltcW: '0', fltcWW: '', fltcD: '2026-10-13', fltcR: '' });
    ok('cutting with no fabric is refused', /Which fabric/.test(await A.ctx.__dlg.onSave()));
    say({ fltcF: 'Cotton', fltcW: '0.4' });
    ok('waste with no waste width is refused', /Waste width/.test(await A.ctx.__dlg.onSave()));
    say({ fltcWW: '18', fltcP: '11' });
    ok('more pieces than are left to cut is refused', /Only 10 pieces are left/.test(await A.ctx.__dlg.onSave()));
    say({ fltcP: '10' });
    let er = await A.ctx.__dlg.onSave();
    ok('cut 10 from Cotton, 5 m used, 0.4 m waste at 18 in — on the test order → Raw cutting in store', !er && T().s.bucket === 'raw' && Object.values(T().r.__t.cutLog)[0].used === 5 && Object.values(T().r.__t.cutLog)[0].waste === 0.4, er);
    /* Issue: the karigar from the employee list. */
    A.flowTestIssueOpen(TN, 'S1'); await new Promise(r => setTimeout(r, 0));
    say({ fltiT: 'Company Contractor', fltiK: 'Mohan', fltiP: '10', fltiD: '2026-10-13', fltiR: '' });
    ok('a karigar not in the employee list is refused', /Mohan is not a Company Contractor karigar/.test(await A.ctx.__dlg.onSave()));
    say({ fltiK: 'Ramesh', fltiP: '6' });
    er = await A.ctx.__dlg.onSave();
    ok('6 issued to Ramesh — the other 4 still wait in Raw cutting in store', !er && T().s.issued === 6 && T().s.bucket === 'raw', er || T().s.bucket);
    A.flowTestIssueOpen(TN, 'S1'); await new Promise(r => setTimeout(r, 0)); say({ fltiT: 'External Contractor', fltiK: 'Pradeep', fltiP: '4' });
    er = await A.ctx.__dlg.onSave();
    ok('the other 4 to Pradeep → all issued → WIP', !er && T().s.issued === 10 && T().s.bucket === 'wip', er);
    A.setView('wip'); A.renderFlow();
    ok('WIP shows who has what: Ramesh 6, Pradeep 4', /Ramesh: 6 issued, 0 back/.test(A.els.flTable.innerHTML) && /Pradeep: 4 issued/.test(A.els.flTable.innerHTML));
    /* Receive: from which karigar. */
    const ramesh = Object.entries(T().r.__t.issues).find(([, e]) => e.karigar === 'Ramesh')[0], pradeep = Object.entries(T().r.__t.issues).find(([, e]) => e.karigar === 'Pradeep')[0];
    A.flowTestRecvOpen(TN, 'S1'); say({ fltrI: ramesh, fltrP: '7', fltrX: '0', fltrD: '2026-10-14' });
    ok('more back than Ramesh has is refused', /Only 6 are out with Ramesh/.test(await A.ctx.__dlg.onSave()));
    say({ fltrP: '6' }); er = await A.ctx.__dlg.onSave();
    A.flowTestRecvOpen(TN, 'S1'); say({ fltrI: pradeep, fltrP: '4', fltrX: '0' }); er = er || await A.ctx.__dlg.onSave();
    ok('10 back (Ramesh 6, Pradeep 4) → the QC bucket', !er && T().s.received === 10 && T().s.bucket === 'qcb', er);
    /* QC is made on the Quality Control screen (Ravi, 10 Oct: "Q.C wala part abhi ke Q.C me flow kare, yahan se remove").
     * Here the rows go into its register the way Waiting for QC and Spotting & touching write them. */
    const bid = k => T().r.__t.issues[k].reg;
    const qcAdd = rows => { A.ctx.QC.checks = A.ctx.QC.checks.concat(rows.map((o, i) => Object.assign({ id: 'qcT' + (A.ctx.QC.checks.length + i), orderNo: TN, sku: 'S1', checked: 0, ok: 0, forAlteration: 0, rejected: 0, test: true, date: '2026-10-14' }, o))); };
    A.renderFlow();
    ok('the flow screen has no QC bucket — the line is with Quality Control', !/data-flb="qcb"/.test(A.els.flBuckets.innerHTML) && !/data-flb="fgin"/.test(A.els.flBuckets.innerHTML) && /data-flb="wip"/.test(A.els.flBuckets.innerHTML), A.els.flBuckets.innerHTML.slice(0, 200));
    A.setView('new'); A.renderFlow();
    ok('…New orders says where it is now: Quality Control (QC screen)', /Quality Control \(QC screen\)/.test(A.els.flTable.innerHTML));
    await A.flowQcEntry(T().r);
    ok('…"Quality Control →" opens Waiting for QC narrowed to the test order', A.ctx.__tabs.includes('qc') && A.els.qcQ.value === TN);
    qcAdd([{ checked: 6, ok: 6, baseId: bid(ramesh) }, { id: 'qcSpot', checked: 4, ok: 0, dept: 'spotting', spotting: 4, baseId: bid(pradeep) }]);
    ok('Quality Control passed 6 and sent 4 to spotting → still with Quality Control', T().s.qc === 6 && T().s.bucket === 'qcb', T().s.bucket);
    qcAdd([{ refId: 'qcSpot', ok: 3, rejected: 1, dept: 'spotting', baseId: bid(pradeep) }]);
    /* The 1 rejected is back in Raw cutting in store: issued again, received, checked. */
    ok('back from spotting: 3 passed, 1 rejected → QC clear, the 1 back in Raw cutting in store to issue again', T().s.qc === 9 && T().s.bucket === 'raw' && T().s.qcRej === 1 && T().s.issuedNet === 9, T().s.bucket);
    A.setView('raw'); A.renderFlow();
    ok('…the store list says so and offers the 1 to issue', /1 rejected at QC — back in store/.test(A.els.flTable.innerHTML) && />1<\/b>/.test(A.els.flTable.innerHTML));
    A.flowTestIssueOpen(TN, 'S1'); await new Promise(r => setTimeout(r, 0)); say({ fltiT: 'Company Contractor', fltiK: 'Suresh', fltiP: '1', fltiD: '2026-10-15', fltiR: '' });
    er = await A.ctx.__dlg.onSave();
    ok('issued again to Suresh → WIP', !er && T().s.bucket === 'wip' && T().s.issuedAll === 11, er || T().s.bucket);
    const sur = Object.entries(T().r.__t.issues).find(([, e]) => e.karigar === 'Suresh')[0];
    A.flowTestRecvOpen(TN, 'S1'); say({ fltrI: sur, fltrP: '1', fltrX: '0', fltrD: '2026-10-16' }); er = await A.ctx.__dlg.onSave();
    ok('back from Suresh → QC (1 waiting)', !er && T().s.bucket === 'qcb', er || T().s.bucket);
    qcAdd([{ checked: 1, ok: 1, baseId: bid(sur), date: '2026-10-16' }]);
    ok('QC passed it → all 10 passed → Ready → India stock', T().s.qc === 10 && T().s.bucket === 'fgin', T().s.bucket);
    A.setView('new'); A.renderFlow();
    ok('…New orders says it waits in Finished Goods to be accepted — nothing to do on this screen', /Finished Goods — to accept \(Finished Goods screen\)/.test(A.els.flTable.innerHTML) && !/data-flfga=/.test(A.els.flTable.innerHTML));
    /* The Finished Goods screen: From QC — to accept. Only Accept or Reject. */
    A.flowFgRender();
    ok('Finished Goods lists the line: 10 passed QC, 0 in India stock, 10 to accept — Accept and Reject', A.flowFgLines().length === 1 && new RegExp('data-flfga="' + TK + '"').test(A.els.fgTable.innerHTML)
      && new RegExp('data-flfgr="' + TK + '"').test(A.els.fgTable.innerHTML) && /TEST/.test(A.els.fgTable.innerHTML), A.els.fgMsg.textContent);
    A.flowFgRejectOpen(TK); say({ flfrP: '2', flfrW: '' });
    ok('reject needs a reason', /Say why/.test(await A.ctx.__dlg.onSave()));
    say({ flfrP: '11', flfrW: 'stain' });
    ok('rejecting more than is waiting is refused', /Only 10 are waiting/.test(await A.ctx.__dlg.onSave()));
    say({ flfrP: '2', flfrW: 'stain on 2' }); er = await A.ctx.__dlg.onSave();
    const rej = A.ctx.QC.checks.filter(q => q.fgReject);
    ok('2 rejected → the pass taken back on the karigars\u2019 Job Work entries → in Quality Control (Waiting for QC) again', !er && T().s.qc === 8 && T().s.bucket === 'qcb'
      && rej.reduce((a, q) => a + q.fgReject, 0) === 2 && rej.every(q => q.baseId && q.checked === -q.fgReject && q.ok === -q.fgReject && q.test && /stain on 2/.test(q.remarks))
      && Object.values(A.FLOW().fg).some(h => h.status === 'rejected' && h.pcs === 2 && h.why === 'stain on 2'), er || JSON.stringify(rej));
    qcAdd(rej.map(q => ({ checked: q.fgReject, ok: q.fgReject, baseId: q.baseId, date: '2026-10-17' })));
    ok('re-checked on the Quality Control screen → Ready → India stock again', T().s.qc === 10 && T().s.bucket === 'fgin', T().s.bucket);
    A.flowFgRender();
    ok('…Finished Goods shows what happened before (2 rejected — stain on 2)', /2 rejected — stain on 2/.test(A.els.fgTable.innerHTML));
    A.flowFgAcceptOpen(TK); say({ flfP: '11', flfN: '' });
    ok('accepting more than passed is refused', /Only 10 passed QC/.test(await A.ctx.__dlg.onSave()));
    say({ flfP: '6' }); er = await A.ctx.__dlg.onSave();
    ok('6 counted in and accepted → 4 still to accept', !er && T().s.india === 6 && T().s.bucket === 'fgin' && A.flowFgLines().length === 1, er);
    er = await A.flowFgAccept(A.flowRows().find(y => y.s.key === TK), 4, '');
    ok('the other 4 accepted → done; a TEST order never goes into India stock', !er && A.flowState(T() ? T().r : A.flowTestLines()[0]).bucket === 'done' && !A.flowFgLines().length
      && !A.writes.some(w => Object.keys(w).some(k => k.startsWith('pt_fgiLedger/'))), er);
    /* In the real screens: each entry also went into its own register, marked TEST. */
    const all = Object.assign({}, ...A.writes), reg = n => Object.entries(all).filter(([k, v]) => k.startsWith(n + '/') && v && typeof v === 'object').map(([, v]) => v);
    const cuts = reg('pt_cuttingData'), bds = reg('pt_baseData'), qcs = reg('pt_qcChecks');
    ok('Cutting Data got the cutting entry: TEST order no, SKU, 10 pieces, Cotton, 5 m used, 0.4 m waste at 18 in', cuts.length === 1 && cuts[0].orderNo === TN && cuts[0].sku === 'S1' && cuts[0].pieces === 10
      && cuts[0].fabricWidth === 'Cotton' && cuts[0].fabricUsed === 5 && cuts[0].fabricWaste === 0.4 && cuts[0].fabricWasteWidth === 18 && cuts[0].test && /^\[TEST\]/.test(cuts[0].remarks), JSON.stringify(cuts));
    const lastBd = id => Object.assign({}, ...A.writes.map(w => Object.fromEntries(Object.entries(w).filter(([k]) => k === 'pt_baseData/' + id))))['pt_baseData/' + id];
    ok('the Job Work Register got the issues — Ramesh 6, Pradeep 4, Suresh 1 again — as its own rows (empType, empName, issuePieces, pending)', bds.length >= 3
      && bds.some(r => r.empName === 'Ramesh' && r.issuePieces === 6 && r.orderNo === TN && r.test) && bds.some(r => r.empName === 'Pradeep' && r.issuePieces === 4));
    const rRow = bds.find(r => r.empName === 'Ramesh');
    { const firstW = A.writes.find(w => w['pt_baseData/' + rRow.id]); const fr = firstW && firstW['pt_baseData/' + rRow.id];
      ok('…the issue itself wrote its row (6 issued, 0 received, 6 pending), in the same save as the test order', fr && fr.issuePieces === 6 && fr.receivedPieces === 0 && fr.pendingPieces === 6
        && Object.keys(firstW).some(k => /\/issues\//.test(k))); }
    ok('…and the receipts went onto those rows (Ramesh: 6 received, nothing pending, closed)', lastBd(rRow.id).receivedPieces === 6 && lastBd(rRow.id).pendingPieces === 0 && lastBd(rRow.id).frozen);
    ok('the flow wrote no QC check of its own — only Finished Goods’ rejection, as TEST rows in Quality Control', qcs.length >= 1 && qcs.every(q => q.orderNo === TN && q.test && q.fgReject > 0), JSON.stringify(qcs.map(q => [q.checked, q.ok, q.fgReject])));
    ok('…and the screens\u2019 own lists hold them now (Cutting, Job Work, QC)', A.ctx.PT.cut.some(r => r.orderNo === TN) && A.ctx.PT.base.filter(r => r.orderNo === TN).length === 3 && A.ctx.QC.checks.some(r => r.orderNo === TN));
    ok('no zipper or ruffle cloth was taken off the real stock by a test issue', !Object.keys(all).some(k => /^pt_(accLedger|fabInvLedger)\//.test(k)));
    const n0 = A.writes.length;
    ok('delete test removes the order, its plan, its demand and its challan', !(await A.flowTestDelete(TN)) && (() => { const w = A.writes[n0];
      return w['pt_flowTest/' + TN] === null && w['pt_ppc/' + TK] === null && w['pt_flowDemand/' + TK] === null && w['pt_flowChallans/TRFD-202610-001'] === null
        && Object.keys(A.FLOW().fg || {}).length === 0 && Object.keys(w).filter(k => k.startsWith('pt_flowFgSend/')).length === 3; })());
    { const w = A.writes[n0];
      ok('…and its TEST entries from all three registers — Cutting Data, Job Work, Quality Control', w['pt_cuttingData/' + cuts[0].id] === null && bds.every(r => w['pt_baseData/' + r.id] === null) && qcs.every(q => w['pt_qcChecks/' + q.id] === null), Object.keys(w).join());
      ok('…and from the screens\u2019 lists at once', !A.ctx.PT.cut.some(r => r.orderNo === TN) && !A.ctx.PT.base.some(r => r.orderNo === TN) && !A.ctx.QC.checks.some(r => r.orderNo === TN)); }
    ok('…and it is gone from every bucket', !A.flowRows().some(x => x.r.orderNo === TN));
  }

  console.log('== Simulate still stands in where the factory has no form of ours (printer, outsourced) ==');
  { const B = load({ me: { admin: true } }); B.setFLOW(Object.assign(B.FLOW(), { test: { 'TEST-AMZ-9': { orderNo: 'TEST-AMZ-9', orderDate: '2026-10-13', lines: { S1: { qty: 10 } } } } }));
    const er = await B.flowSimulate('TEST-AMZ-9', 'S1', 'vendor');
    ok('Simulate: vendor order placed → given 10', !er && B.flowTestLines()[0].__t.given === 10, er); }

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
  A.ctx.document.querySelectorAll = () => [0, 1].map(i => ({ addEventListener() {}, dataset: { fp: String(i), k: 'printer.code' }, type: 'select-one', value: 'P1' }));
  let err = await A.ctx.__dlg.onSave();
  ok('a line with no fabric is refused, named — nothing written', /Which fabric\? Type it for S2/.test(err) && A.writes.length === 0, err);
  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: 'Cotton' } } });
  A.flowPpcOpen('AMZ-1');
  err = await A.ctx.__dlg.onSave();
  ok('a printed line with no printer is refused: the print order goes now', /Which printer\? The print order goes to them now/.test(err) && !A.writes.length, err);
  A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
  err = await A.ctx.__dlg.onSave();
  const w = A.writes[0] || {};
  ok('…with a printer: the plan AND the print order in the same write', !err && Object.keys(w).some(k => /^pt_flowPrintOrders\/PRN-\d{6}-001$/.test(k)), Object.keys(w).join());
  ok('saved under pt_ppc/<line> with who and when', !err && w['pt_ppc/' + K] && w['pt_ppc/' + K].by === 'ppc@x' && w['pt_ppc/' + K].at, err);
  ok('the gaps list is not saved', w['pt_ppc/' + K] && !('gaps' in w['pt_ppc/' + K]));
  ok('the line moves to Demand by itself', A.flowState(L()).bucket === 'demand');
  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: 'Cotton' } }, writeFails: true });
  A.flowPpcOpen('AMZ-1'); A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }];
  ok('a refused write is said, and the line stays', /Could not save/.test(await A.ctx.__dlg.onSave()) && A.flowState(L()).bucket === 'ppc');

  A = load({ lines: [L()], mdb: { S1: { cons: 0.5, fab: '', chainLength: '18' } } });
  A.flowPpcOpen('AMZ-1');
  A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'route' }, type: 'select-one', value: 'outsource' }];
  err = await A.ctx.__dlg.onSave();
  ok('an outsourced line must name who makes it', /outsource vendor/.test(err) && !A.writes.length, err);
  A.ctx.document.querySelectorAll = () => [{ addEventListener() {}, dataset: { fp: '0', k: 'route' }, type: 'select-one', value: 'outsource' }, { addEventListener() {}, dataset: { fp: '0', k: 'outVendor' }, type: 'text', value: 'ABC Exports' }];
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
  ok('…it is in WIP, with Receive (issued 100, nothing back yet)', /AMZ-0/.test(A.els.flTable.innerHTML) && /data-flent="recv\|AMZ-0__S1"/.test(A.els.flTable.innerHTML));
  ok('the page says it is a test view', /TEST VIEW/.test(A.els.flMsg.textContent));
  A = load({ me: { tabs: ['ord'] } });
  A.renderFlow();
  ok('no bucket → says so, draws nothing', /No bucket/.test(A.els.flMsg.textContent) && !A.els.flTable.innerHTML);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
