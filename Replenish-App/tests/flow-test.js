/* Production flow (src/app/flow/*): which bucket a line is in, PPC's plan, Demand's reservations, and the screen.
 *   node tests/flow-test.js      (FLOW_DIR=<dir> to test another copy — teeth/teeth-flow.js does) */
const fs = require('fs'), path = require('path');
const DIR = process.env.FLOW_DIR || path.join(__dirname, '..', 'src', 'app', 'flow');
const SRC = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-challan.js', 'flow-test-order.js', 'flow-receive.js', 'flow-printorder.js', 'flow-vendor.js', 'flow-edit.js', 'flow-back.js', 'flow-entries.js', 'flow-qcfg.js', 'flow-view.js'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
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
    $: el, document: { querySelectorAll: () => [], querySelector: () => null }, localStorage: { getItem: k => Object.assign({ flowTests: '1', flowReal: '1' }, opts.ls || {})[k] ?? null },
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
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, ptFillSelect: (id, pairs) => { (ctx.__fills = ctx.__fills || {})[id] = pairs; }, ptImgOf: () => '', ptImgSrc: u => u, showTab: () => {},
    ptLoadGates: async () => {},
    showTab: t => { (ctx.__tabs = ctx.__tabs || []).push(t); }, ensureCutForm: async () => {}, cutSkuTyped: () => {}, renderCutForm: () => {}, renderCutFab: () => {},
    ensureBdForm: async () => {}, bdSkuTyped: () => {}, renderBdForm: () => {}, bdMatFill: () => {}, qcSkuTyped: () => {}, renderQcCheckForm: () => {},
    jwRecvOpen: id => { ctx.__recv = id; },
    ptStampDate: d => String(d || ''), ptNow: () => '2026-10-13T10:00:00Z', qcParts: sku => ({ brand: 'Ridhi', at: 'Pillow Cover', sub: 'x', col: 'c', size: 's' }), QC: { checks: opts.qcChecks || [] }, voDayOf: d => String(d || ''), voDayKey: d => String(d || ''), ...(opts.cas ? { ptCas: async (path, expect, next) => { const db = ctx.__casDb || (ctx.__casDb = Object.assign({}, opts.casDb || {}));
      const cur = db[path] == null ? null : db[path]; if (JSON.stringify(cur) !== JSON.stringify(expect == null ? null : expect)) return 'changed';
      db[path] = next; (ctx.__cas = ctx.__cas || []).push([path, next]); return ''; } } : {}), FGI: { rows: [] }, fgiRecvOrderCheck: o => (W.lines.some(l => l.orderNo === o.orderNo) ? {} : { err: o.orderNo + ' is not on the order book' }), fgiNewId: (() => { let n = 0; return p => (p || 'FGI') + '-T' + (++n); })(),
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
    STORE: { rows: opts.store ? [] : null }, stMoves: () => opts.store || [], stBalances: mv => mv, fabKey: v => String(v || '').trim().toUpperCase(), fabAll: () => opts.fabRows || [], ptList: x => x || [], fabAutoLoad: async () => {}, GD: opts.gd, mdbOf: opts.mdbOf, MDBX: opts.mdbx, fabState: r => String((r && r.state) || (/RFD/.test(String(r && r.txnType)) ? 'RFD' : 'PRINTED')).toUpperCase(), fabKnown: t => ['OPENING_RFD', 'RFD_TO_PRINTER', 'ISSUE_TO_CUTTING', 'RECEIVE_RFD', 'PURCHASE_RFD', 'ADJUST'].includes(t), fabMove: r => (+r.qty || 0) * (['RFD_TO_PRINTER', 'ISSUE_TO_CUTTING'].includes(r.txnType) ? -1 : 1), fabStockOf: (name, st) => (st === 'RFD' ? (opts.rfd || {})[String(name).toUpperCase()] || 0 : 0),
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { flowFabOwed, flowRfdStock, flowFabKnown, flowMatRow, flowGdNote, flowPpcDraftSave, flowPpcDraftApply, flowPpcDraftDrop, flowPpcHasDraft, flowBackOpen, flowAgainOpen, flowIsBack, flowBackLines, flowBackPill, FLOW_ON, FLOW_BUCKETS, FLOW_TABS, flowBucketsAllowed, flowKey, FLOW_ROUTES, flowPlanRouteOf, FLOW:()=>FLOW, setFLOW:v=>{FLOW=v}, flowLoad, flowState, flowRows, flowSuggest, flowHeld, flowAccFree, flowReserve, flowUnreserve, flowTable, renderFlow, flowPpcOpen, flowFabricOpen, flowInView, flowRfdCover, flowAccCover, flowChallanOpen, flowChallanNo, flowChallanHtml, flowChallanPrint, flowTestOpen, flowTestDelete, flowSimulate, flowTestLines, flowTestCutOpen, flowTestIssueOpen, flowTestRecvOpen, flowTestVos, flowVoProgOf, flowVoProgSync, flowVlogRows, flowDocsOf, flowVoExtra, flowVpViewOnly, flowFgAcceptOpen, flowFgAccept, flowFgRejectOpen, flowFgReject, flowFgLines, flowFgRender, flowQcLine, flowTestOnly, flowTestOnlySet, flowReceiveOpen, flowCloseShortOpen, flowPrinterFor, flowChIndex, flowCommitted, flowCutEntry, flowIssueEntry, flowRecvEntry, flowQcEntry, flowIssuable, flowPrintWhat, flowChPrintGroups, flowMasterDiff, flowPrintExtras, flowToPrint, flowChallanForKeys, flowByPrintTable, flowPoSync, flowPoIndex, flowPoHtml, flowPoPrint, flowPoTable, flowFabOwed, flowVoLines, flowSwatchOf, flowSizeFifo, flowSizeChallanOpen, flowBySizeData, flowPpcXlRows, flowPpcXlRead, flowXlDate, FLOW_XL_COLS, VOrows:()=>VO.rows, setVOrows:v=>{VO.rows=v}, flowUnplan, flowChallanEditOpen, flowChallanCancelOpen, flowUndoReceipt, flowReopen, setAngle:(v,a)=>{FLOW_ANGLE[v]=a}, setView:v=>{FLOW_VIEW=v}, flowEmbedRender, FLOW_EMB:()=>FLOW_EMB, flowScreenAllowed, flowOwnsOrder, flowOwnedIn, flowVoIsFlow, flowFgOwns, flowDupViewsOff, renderView:()=>{ if (["cut","raw","wip","new","pord","vendor","fabric"].includes(FLOW_VIEW)) { const only = FLOW.testOnly != null ? FLOW.testOnly : flowTestOnly(); const rows = flowRows().filter(x => (!only || x.r.__t) && (FLOW_VIEW === "new" ? x.recent : flowInView(FLOW_VIEW, x.s))); $("flTable").innerHTML = flowTable(FLOW_VIEW, rows); } else renderFlow(); } };')(...Object.values(ctx));
  api.setFLOW(Object.assign(api.FLOW(), { ppc: opts.ppc || {}, dem: opts.dem || {}, res: opts.res || {} }));
  return Object.assign(api, { els, writes, W, ctx });
}
const plan = (o) => Object.assign({ orderNo: 'AMZ-1', sku: 'S1', qty: 100, fabric: { name: 'Cotton', perPc: 0.5, metres: 50 }, acc: [], print: { need: true }, dates: {} }, o);
const K = 'AMZ-1__S1';

(async () => {
  console.log('== the switch ==');
  ok('on for a preview link (host has --)', load().FLOW_ON === true);
  ok('on the live app too since 14 Oct (one URL)', load({ host: 'price-research-48ff3.web.app' }).FLOW_ON === true);
  ok('localStorage flow=0 turns it off on one computer', load({ host: 'price-research-48ff3.web.app', ls: { flow: '0' } }).FLOW_ON === false && load({ ls: { flow: '0' } }).FLOW_ON === false);

  console.log('== each bucket its own right ==');
  ok('seven rights — New orders, Print orders, Vendor allocation, Outsourced, QC, Finished Goods and Printed fabric in are gone from the flow', load().FLOW_TABS.length === 7 && new Set(load().FLOW_TABS).size === 7 && !['flnew', 'flpo', 'flven', 'flout', 'flqc', 'flrdy', 'flfg', 'flfab'].some(t => load().FLOW_TABS.includes(t)));
  ok('an admin sees every bucket', load({ me: { admin: true } }).flowBucketsAllowed().length === 9 && load({ me: { admin: true } }).flowScreenAllowed().map(b => b[0]).join() === 'ppc,ppcdone,back,drfd,dhist,dacc');
  ok('PPC staff see PPC, PPC completed and Back to sales team only', load({ me: { tabs: ['flppc', 'ord'] } }).flowBucketsAllowed().map(b => b[0]).join() === 'ppc,ppcdone,back');
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
  { const st = A.flowState(L({ cutReq: true }));
    ok('part back (40 of 100), cutting needed → stays in Printed fabric in AND shows in Cutting for the 40 that can be cut now', st.bucket === 'fabric' && st.canCut === 40 && A.flowInView('cut', st) && A.flowInView('fabric', st));
    const sn = A.flowState(L({ cutReq: false }));
    ok('part back, printed on the SKU (no cutting) → the 40 pieces show in Raw cutting in store to issue', sn.bucket === 'fabric' && sn.canIssue === 40 && A.flowInView('raw', sn) && !A.flowInView('cut', sn));
    const s2 = A.flowState(L({ cutReq: true, cut: 40 }));
    ok('…cut those 40 → nothing more to cut now (Cutting empty), the 40 cut pieces in Raw cutting in store', !A.flowInView('cut', s2) && s2.canIssue === 40 && A.flowInView('raw', s2)); }
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } } }, ready));
  ok('all back, cutting needed, not cut → Cutting', b(L({ cutReq: true, cut: 60 })) === 'cut');
  ok('all cut → Raw cutting in store', b(L({ cutReq: true, cut: 100 })) === 'raw');
  ok('all issued, 30 back and not checked → QC', b(L({ cutReq: true, cut: 100, issued: 100, received: 30 })) === 'qcb');
  ok('all issued, nothing back → WIP', b(L({ cutReq: true, cut: 100, issued: 100, received: 0 })) === 'wip');
  const qc100 = [{ orderNo: 'AMZ-1', sku: 'S1', checked: 100, ok: 100 }];
  A = load(Object.assign({ vendor: { 'AMZ-1|S1': { given: 100, back: 100 } }, qc: { 'AMZ-1|S1': { ok: 100 } }, qcChecks: qc100 }, ready));
  ok('all QC passed, not in Finished Goods → Ready → India stock (the Finished Goods team accepts)', b(L({ issued: 100, received: 100 })) === 'fgin');
  { /* A SHOPIFY LINE IS MADE TO ORDER (Ravi, 14 Oct: "naye ppc flow me shopify ke order kese flow honge"): after QC it waits to be
     * handed to the shipping team, not on Finished Goods. */
    const SK = 'SHP-1__S1', shpReady = { ppc: { [SK]: plan({ orderNo: 'SHP-1' }) }, dem: { [SK]: { fabricReady: { at: 'x' } } } };
    A = load(Object.assign({ vendor: { 'SHP-1|S1': { given: 100, back: 100 } }, qc: { 'SHP-1|S1': { ok: 100 } }, qcChecks: [{ orderNo: 'SHP-1', sku: 'S1', checked: 100, ok: 100 }],
      lines: [L({ orderNo: 'SHP-1', src: 'SHP', issued: 100, received: 100 })] }, shpReady));
    ok('a Shopify line, all QC passed → Ready — hand to shipping, not Finished Goods', b(L({ orderNo: 'SHP-1', src: 'SHP', issued: 100, received: 100 })) === 'ship');
    ok('…not on the Finished Goods "to accept" list, and Finished Goods does not own it', !A.flowFgLines().some(x => x.r.orderNo === 'SHP-1') && A.flowFgOwns('SHP-1', 'S1') === false);
    ok('…handed to shipping on the Order Console → done', b(L({ orderNo: 'SHP-1', src: 'SHP', issued: 100, received: 100, handedAt: '2026-10-14' })) === 'done'); }
  { /* …and its TEST copy goes the same way (it used to land on Finished Goods, because only SHP-/ONL- numbers were made to order). */
    const TN = 'TEST-SHP-14102026-01', TK = TN + '__S1';
    const T = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' } }, qcChecks: [{ orderNo: TN, sku: 'S1', checked: 10, ok: 10 }],
      ppc: { [TK]: plan({ orderNo: TN, qty: 10 }) }, dem: { [TK]: { fabricReady: { at: 'x' } } } });
    T.setFLOW(Object.assign(T.FLOW(), { test: { [TN]: { orderNo: TN, src: 'SHP', orderDate: '2026-10-14', fromSo: 'SHP-1', lines: { S1: { qty: 10, given: 10, back: 10, cut: 10, issued: 10, received: 10 } } } } }));
    const row = () => T.flowRows().find(x => x.r.orderNo === TN);
    ok('a Shopify TEST copy, QC passed → Ready — hand to shipping, not Finished Goods', row() && row().s.bucket === 'ship' && !T.flowFgLines().some(x => x.r.orderNo === TN) && T.flowFgOwns(TN, 'S1') === false, row() && row().s.bucket);
    T.setView('ppcdone'); T.renderFlow();
    ok('…PPC completed offers "Hand to shipping (test)" in place of the Order Console\'s hand-over', new RegExp('data-flsim="' + TN + '\\|S1\\|ship"').test(T.els.flTable.innerHTML) && /Ready — hand to shipping/.test(T.els.flTable.innerHTML));
    const er = await T.flowSimulate(TN, 'S1', 'ship');
    ok('…pressing it hands the test line over → done', !er && T.writes.some(w => w['pt_flowTest/' + TN + '/lines/S1/handedAt']) && row().s.bucket === 'done', er || (row() && row().s.bucket)); }
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
  ok('the RFD list flags the line red: SHORT 10 m', /Short: 10 m/.test(A.els.flTable.innerHTML) && /fef2f2/.test(A.els.flTable.innerHTML));
  ok('above the lines: only the switch, By line | By fabric — not the stock table', /data-flang="stock"/.test(A.els.flPanel.innerHTML) && !/⚑ 10 m/.test(A.els.flPanel.innerHTML) && /By fabric/.test(A.els.flPanel.innerHTML));
  A.setAngle('drfd', 'stock'); A.renderFlow();
  ok('By fabric: the table IS the stock — in stock, need, short per fabric; the lines are not under it', /⚑ 10 m/.test(A.els.flTable.innerHTML) && /RFD in stock/.test(A.els.flTable.innerHTML) && !/data-flfab=/.test(A.els.flTable.innerHTML));
  /* By printer, as a pivot (17 Oct): printer down the side, fabric across, totals. */
  {
    const P2 = load({ me: { tabs: ['fldem'] }, rfd: { 'SHEETING 58': 500, 'COTTON': 500 }, lines: [L({ sku: 'S1' }), L({ sku: 'S2' }), L({ sku: 'S3', orderNo: 'AMZ-2' })],
      ppc: { [K]: pl('S1', 60, { printer: { code: 'P1', name: 'Sanganer Prints' } }), 'AMZ-1__S2': pl('S2', 40, { printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Cotton', perPc: 1, metres: 40 } }),
        'AMZ-2__S3': pl('S3', 25, { printer: { code: 'P2', name: 'Choudhary Hand Block' } }) } });
    P2.setView('drfd');
    P2.setAngle('drfd', 'size'); P2.renderFlow();
    const hs = P2.els.flTable.innerHTML;
    ok('Challan by size: a card per printer with fabric, size, pieces and the orders — and a Make challan button', /Sanganer Prints/.test(hs) && /Make challan/.test(hs) && /data-flszch="P1"/.test(hs) && /Orders \(oldest first\)/.test(hs), hs.slice(0, 900));
    ok('the metres pivot "By printer (pivot)" is gone; the size pivot has its Download Excel', !/data-flang="printer"/.test(P2.els.flPanel.innerHTML) && /data-flpivxl="size"/.test(P2.els.flPanel.innerHTML));
  }
  /* THE CHALLAN BY SIZE, FIFO (18 Oct): one size in several colours and orders is one line; what goes now fills the oldest first. */
  {
    const plS = (sku) => plan({ sku, qty: 10, route: 'inhouse', printer: { code: 'P1', name: 'Sanganer Prints' }, fabric: { name: 'Sheeting 62', perPc: 1.5, metres: 15 }, print: { need: true } });
    const lines = [L({ orderNo: 'SHP-9', sku: 'T1', size: '60x60', color: 'Red', orderDate: '2026-10-12', src: 'SHP', qty: 10 }),
      L({ orderNo: 'AMZ-5', sku: 'T2', size: '60X60', color: 'Blue', orderDate: '2026-10-11', qty: 10 }),
      L({ orderNo: 'AMZ-7', sku: 'T3', size: '60x60', color: 'Green', orderDate: '2026-10-13', qty: 10 })];
    const F = load({ me: { tabs: ['fldem'] }, rfd: { 'SHEETING 62': 500 }, lines, ppc: { 'SHP-9__T1': Object.assign(plS('T1'), { orderNo: 'SHP-9' }), 'AMZ-5__T2': Object.assign(plS('T2'), { orderNo: 'AMZ-5' }), 'AMZ-7__T3': Object.assign(plS('T3'), { orderNo: 'AMZ-7' }) } });
    const rows = F.flowRows().filter(x => F.flowInView('drfd', x.s));
    const d = F.flowBySizeData(rows), pr = d.P.find(p => p.pk === 'P1'), g = pr && pr.list[0];
    ok('size challan: three colours, two spellings of 60x60, three orders → ONE line, 30 pcs, 45 m', !!g && pr.list.length === 1 && g.pcs === 30 && Math.abs(g.metres - 45) < 0.01, JSON.stringify({ rows: rows.length, all: F.flowRows().map(x => [x.s.key, x.s.bucket, x.s.needFab, x.s.route]), P: d.P.map(p => [p.pk, p.list.map(q => [q.gk, q.pcs, q.metres])]) }));
    if (!g) throw new Error('no size group');
    ok('…its orders oldest first: AMZ-5 (11 Oct), SHP-9 (12 Oct), AMZ-7 (13 Oct)', g.lines.map(l => l.x.r.orderNo).join() === 'AMZ-5,SHP-9,AMZ-7', g.lines.map(l => l.x.r.orderNo).join());
    const pre = F.flowSizeFifo(pr.list, { [g.gk]: 15 });
    ok('FIFO: 15 pcs fill AMZ-5 (10, all), then SHP-9 (5 of 10); AMZ-7 waits', pre.get('AMZ-5__T2').pcs === 10 && pre.get('SHP-9__T1').pcs === 5 && !pre.has('AMZ-7__T3') && pre.get('SHP-9__T1').metres === 7.5, JSON.stringify([...pre]));
    F.flowSizeChallanOpen('P1');
    ok('Make challan asks the pieces per size, with what each order would get', /Challan by size/.test(F.ctx.__dlg.title) && /data-szq=/.test(F.ctx.__dlg.html) && /AMZ-5/.test(F.ctx.__dlg.html), F.ctx.__dlg.title);
    const er = await F.ctx.__dlg.onSave(); await new Promise(r => setTimeout(r, 5));
    ok('…Review challan opens the ordinary challan form with the FIFO lines and figures in it', er === '' && /RFD challan/.test(F.ctx.__dlg.title) && /value="15"/.test(F.ctx.__dlg.html), (F.ctx.__dlg.title || '') + ' ' + (er || ''));
  }
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
    ok('the challan opens to print: number, order, vendor, the running fabric and its metres (no order lines listed), signatures', /DELIVERY CHALLAN/.test(page) && /RFD-202610-001/.test(page) && /AMZ-1/.test(page) && /Sanganer Prints/.test(page) && /Running fabric — to print/.test(page) && /66 m/.test(page) && !/Square Tablecloth · Almond · 60x60/.test(page) && /Received by/.test(page) && /Ridhi Home/.test(page));
    ok('the next challan that month is 002', A.flowChallanNo('2026-10-20') === 'RFD-202610-002' && A.flowChallanNo('2026-11-01') === 'RFD-202611-001');
    /* ONE RULE FOR RFD STOCK (Ravi, 16 Oct: "fix it permanent"): the challan's metres come OFF the stock for good — not
     * held until the printed cloth is back and then counted as stock again. */
    let cv2 = A.flowRfdCover();
    ok('its metres come off the RFD stock (500 − 66), and are not held a second time', cv2.fab['SHEETING 62'].stock === 434 && cv2.fab['SHEETING 62'].held === 0, JSON.stringify(cv2.fab['SHEETING 62']));
    A.W.vendor['AMZ-1|S1'] = { given: 100, back: 0 }; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('…still off once the vendor order is placed', A.flowRfdCover().fab['SHEETING 62'].stock === 434);
    A.W.vendor['AMZ-1|S1'] = { given: 100, back: 20 }; A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('…and printed cloth coming back does NOT put the RFD back into stock', A.flowRfdCover().fab['SHEETING 62'].stock === 434 && A.flowRfdCover().fab['SHEETING 62'].held === 0);
    { const ch = A.FLOW().ch, no = Object.keys(ch)[0];
      A.setFLOW(Object.assign(A.FLOW(), { ch: Object.assign({}, ch, { [no]: Object.assign({}, ch[no], { cancelled: { at: '2026-10-11', why: 'x' } }) }) }));
      ok('a cancelled challan gives its metres back', A.flowRfdCover().fab['SHEETING 62'].stock === 500);
      A.setFLOW(Object.assign(A.FLOW(), { ch })); }
    { const NA = load({ me: { admin: true }, rfd: { 'SHEETING 62': 500 }, lines: A.W.lines, ppc: A.FLOW().ppc, vendor: A.W.vendor }); NA.setFLOW(Object.assign(NA.FLOW(), { ch: A.FLOW().ch, dem: A.FLOW().dem }));
      NA.setView('new'); NA.renderView();
      ok('no "Printed fabric in" bucket — New orders says where the line is: with the printer, received in Demand history, seen in History', !A.FLOW_BUCKETS.some(b => b[0] === 'fabric')
        && /With the printer — receive in Demand → Printed fabric in, see Vendors &amp; printers → History/.test(NA.els.flTable.innerHTML), NA.els.flTable.innerHTML.slice(0, 400)); }
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
    ok('its tab in Demand counts open challans', /Printed fabric in · history <b>1<\/b>/.test(A.els.flPanel.innerHTML) && /data-flb="demand"/.test(A.els.flBuckets.innerHTML), A.els.flPanel.innerHTML);
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
    ok('a closed challan has no Receive button and the count is 0', !/data-flchr=/.test(A.els.flTable.innerHTML) && /closed/.test(A.els.flTable.innerHTML) && /Printed fabric in · history <b>0<\/b>/.test(A.els.flPanel.innerHTML));
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
    ok('the PPC list says which printer, not "printed in-house"', /Print: <b>Sanganer Prints/.test(A.els.flTable.innerHTML) && !/printed in-house/.test(A.els.flTable.innerHTML));
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
    ok('…and half its pieces have moved, so only the other half of its cloth is still held (15 of 30 m, 17 Oct)', A.flowCommitted([]).fab['SHEETING 82'] === 15, String(A.flowCommitted([]).fab['SHEETING 82']));
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
    /* PRINTED CLOTH IN THE STORE, NO DIRECTION PICKED YET (Ravi, 17 Oct: "store me agate green ka printed sheeting pada h but
     * yaha kanhi show nahi ho rha h"): the store holds cloth by fabric and colour, so its row shows at once — and cloth all in
     * the store asks for no direction. */
    { const sp = {}; const span = sel => sp[sel] || (sp[sel] = { innerHTML: '', textContent: '' });
      const S = load({ mdb, fsku, lines: [L({ sku: 'RPCRU327-1818', qty: 40 })], store: [{ key: 'M|SHEETING 82|LIGHT STEEL BLUE', qty: 1000 }] });
      S.ctx.document.querySelector = sel => (/data-mat=|data-fm=|data-pget=|data-chips=/.test(sel) ? span(sel) : null);
      S.flowPpcOpen('AMZ-1');
      const mat = (sp['[data-mat="0"]'] || {}).innerHTML || '';
      ok('no direction picked, yet the printed cloth in the store shows: Sheeting 82 · Light Steel Blue', /Printed in store · <b>Sheeting 82<\/b> · Light Steel Blue/.test(mat), mat.slice(0, 400));
      S.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? [{ addEventListener() {}, dataset: { fp: '0', k: 'printer.code' }, type: 'select-one', value: 'P1' }] : [];
      const er2 = await S.ctx.__dlg.onSave();
      ok('…and with the body all in the store, the plan saves without asking which way it is printed', !/print direction/.test(er2 || ''), er2); }
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
    ok('Demand RFD "Made as" shows what each line prints, from the master data', /RBP-CANVAS-327/.test(A.els.flTable.innerHTML) && /RBPSF327-V-82/.test(A.els.flTable.innerHTML) && !/RBPSF327-H-82/.test(A.els.flTable.innerHTML) && /RTME-327<\/b><\/div><div class="muted" style="font-size:12px">Printed on the SKU itself/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1', 'P1');
    const q = {}; [0, 1, 2, 3].forEach(i => { q[`[data-chk="${i}"]`] = { checked: true }; q[`[data-chm="${i}"]`] = { value: ['5.3', '10.4', '0.25', '2'][i] }; });
    A.ctx.document.querySelector = sel => q[sel] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-10' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    er = await A.ctx.__dlg.onSave();
    const ch = A.FLOW().ch['RFD-202610-001'], gs = A.flowChPrintGroups(ch);
    ok('the challan keeps it per line, and "To print" has one row each: RBP-CANVAS-327 5.3 m, RBPSF327-V-82 10.4 + 2 = 12.4 m (two lines, one cloth), RTME-327 1 pcs', !er && gs.length === 3
      && gs.find(g => g.code === 'RBP-CANVAS-327').metres === 5.3 && Math.abs(gs.find(g => g.code === 'RBPSF327-V-82').metres - 12.4) < 1e-9 && gs.find(g => g.kind === 'sku').pcs === 1, er);
    ok('the printed challan says so', /Running fabric — to print/.test(A.ctx.__win[0] || '') && /RBP-CANVAS-327/.test(A.ctx.__win[0] || '') && /12\.4 m/.test(A.ctx.__win[0] || ''));
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
    ok('…and on the printed challan', /LSB/.test(A.ctx.__win[0] || '') && /16 m/.test(A.ctx.__win[0] || '') && /<b>LSB<\/b>/.test(A.ctx.__win[0] || ''));
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
    A.ctx.ME = A.ctx.ME; A.renderView();
    ok('the Cutting list shows what to cut: RBPSF327-V-92, 6 m for 10 pcs, all from printed stock', /RBPSF327-V-92/.test(A.els.flTable.innerHTML) && /6 m for 10 pcs/.test(A.els.flTable.innerHTML) && /all from printed stock in the store/.test(A.els.flTable.innerHTML), A.els.flTable.innerHTML.slice(0, 300));
    A = mk([{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 2 }]);
    A.flowPpcOpen('AMZ-1', 'RTC327-6060');
    const m2 = spans['[data-mat="0"]'].innerHTML;
    ok('only 2 m printed in store → covers 2 m, RFD the rest 4 m; ruffle all from RFD → short', /✓ covers 2 m/.test(m2) && /\(the rest\)<\/span><\/td><td class="num">4 m/.test(m2) && /⚑ short 23\.5 m/.test(m2), m2);
  }

  console.log('== the store belongs to the earlier orders first (Ravi, 11 Oct: CPC-01, 465 pcs in store, all another order’s) ==');
  {
    const spans = {}, span = q => spans[q] || (spans[q] = { innerHTML: '', textContent: '' });
    const mdb = { 'CPC-01': { color: 'Agate Green', fabric: 'Sheeting 62', consumption: 2.35, cuttingRequired: false, subtype: 'Tablecloth' },
      'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true, subtype: 'Ruffle Tablecloth' } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }];
    const T1 = 'TEST-AMZ-11102026-01';
    const mk = (earlier, store, sku) => { const B = load({ me: { admin: true }, mdb, fsCat, rfd: { 'SHEETING 62': 5000, 'SHEETING 92': 5000 }, fabRows: [{ fabricType: 'Sheeting 62' }, { fabricType: 'Sheeting 92' }], store,
        lines: [L({ orderNo: T1, sku, qty: 20, __t: {}, cutReq: sku !== 'CPC-01' }), ...earlier] });
      B.ctx.document.querySelector = q => (/data-mat=|data-fm=|data-pget=|data-chips=/.test(q) ? span(q) : null); return B; };
    const old = (sku, qty, o) => L(Object.assign({ orderNo: 'AMZ-OLD', sku, qty, orderDate: '2026-09-20', cutReq: sku !== 'CPC-01' }, o || {}));
    /* 465 in store, an earlier order still to issue 470 → nothing free: the new order goes to the printer */
    let B = mk([old('CPC-01', 470)], [{ key: 'P|CPC-01', qty: 465 }], 'CPC-01');
    B.flowPpcOpen(T1, 'CPC-01'); let mt = spans['[data-mat="0"]'].innerHTML;
    ok('465 in store, the earlier order still needs 470 → none free for the new order; it goes to the printer', /<b>0 pcs<\/b>/.test(mt) && !/✓ covers/.test(mt) && /all for earlier orders — goes to the printer/.test(mt)
      && /in store 465 pcs, 470 pcs of it for earlier orders/.test(mt) && !/All already printed/.test(spans['[data-pget="0"]'].innerHTML), mt);
    /* 465 in store, earlier orders need 400 (one issued 100 of 500) → 65 free → the 20 come from the store */
    B = mk([old('CPC-01', 500, { issued: 100 })], [{ key: 'P|CPC-01', qty: 465 }], 'CPC-01');
    B.flowPpcOpen(T1, 'CPC-01'); mt = spans['[data-mat="0"]'].innerHTML;
    ok('…earlier orders need only 400 of the 465 → 65 free, the 20 are covered: straight to the next step', /✓ covers 20 pcs/.test(mt) && /<b>65 pcs<\/b>/.test(mt), mt);
    /* a done line does not hold anything */
    B = mk([old('CPC-01', 470, { orderNo: 'AMZ-NEW', orderDate: '2026-10-11', handedAt: '2026-10-12' })], [{ key: 'P|CPC-01', qty: 465 }], 'CPC-01');
    B.flowPpcOpen(T1, 'CPC-01'); mt = spans['[data-mat="0"]'].innerHTML;
    ok('…an order already finished (handed over) holds nothing, though it is still listed', /✓ covers 20 pcs/.test(mt), mt);
    /* printed cloth: 10 m in store, an earlier order still to cut 20 pcs × 0.6 m = 12 m → none free */
    B = mk([old('RTC327-6060', 20)], [{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 10 }], 'RTC327-6060');
    B.flowPpcOpen(T1, 'RTC327-6060'); mt = spans['[data-mat="0"]'].innerHTML;
    ok('printed cloth too: 10 m in store, an earlier order still to cut 12 m of it → none for the new order', !/✓ covers/.test(mt) && /12 m of it for earlier orders/.test(mt), mt);
    B = mk([old('RTC327-6060', 20, { cut: 15 })], [{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 10 }], 'RTC327-6060');
    B.flowPpcOpen(T1, 'RTC327-6060'); mt = spans['[data-mat="0"]'].innerHTML;
    ok('…it has cut 15 of its 20 → it still needs 3 m, 7 m free → covers 7 m of the 12 m', /✓ covers 7 m/.test(mt), mt);
  }

  console.log('== what the printer reads: running fabric combined, cut pieces per SKU (Ravi, 11 Oct) ==');
  {
    const S = load({ me: { admin: true } });
    const run = (sku, m) => ({ key: 'K' + sku, sku, item: 'Pillow Cover · Basil Green', print: { kind: 'fabric', code: 'RBPSF9-H-82', label: 'Basil Green · Sheeting 82 · Horizontal', mode: 'Running fabric' }, extras: [], fabric: 'Sheeting 82', pcs: 100, metres: m });
    const cutp = { key: 'KCPC', sku: 'CPC-01', item: 'Tablecloth · Agate Green · 60x60', print: { kind: 'sku', code: 'CPC-01', label: 'Tablecloth · Agate Green · 60x60', mode: 'Cut pieces' }, extras: [], fabric: 'Sheeting 62', pcs: 40, metres: 94 };
    const page = S.flowChallanHtml({ no: 'TRFD-1', date: '2026-10-11', orderNo: 'TEST-1', vendor: { code: 'V', name: 'RBP-Bagru' }, lines: [run('RPCRU9-1818', 52), run('RPCRU9-2020', 184), cutp] });
    ok('running: ONE row — RBPSF9-H-82 · Sheeting 82 · Basil Green · Horizontal · 236 m; the two order lines are not listed', (page.match(/RBPSF9-H-82/g) || []).length === 1 && /<td[^>]*>Sheeting 82<\/td><td[^>]*>Basil Green<\/td><td[^>]*>Horizontal<\/td><td[^>]*><b>236 m<\/b>/.test(page)
      && !/RPCRU9-1818|RPCRU9-2020/.test(page) && !/For these order lines/.test(page), page.slice(page.indexOf('Running'), page.indexOf('Running') + 600));
    ok('cut pieces: per SKU — what, colour, size — in pieces, with the cloth that goes for them', /Cut pieces — print on the SKU/.test(page) && /<b>CPC-01<\/b>/.test(page) && /<b>40 pcs<\/b>/.test(page) && /94 m/.test(page)
      && /<td[^>]*>Tablecloth<\/td><td[^>]*><b>Agate Green<\/b><\/td><td[^>]*><b>60x60<\/b><\/td>/.test(page), page.slice(page.indexOf('Cut pieces'), page.indexOf('Cut pieces') + 700));
    ok('the printer and the date stand in one box at the top (19 Oct)', /Printer \(To\)<\/div><div[^>]*>RBP-Bagru/.test(page) && /Date<\/div><div[^>]*>11\/10\/2026/.test(page), page.slice(page.indexOf('Printer (To)') - 200, page.indexOf('Printer (To)') + 400));
  }

  { const S2 = load({ me: { admin: true } }); S2.ctx.GPO.settings = {};
    const pg = S2.flowChallanHtml({ no: 'TRFD-2', date: '2026-10-11', orderNo: 'T', vendor: { code: 'V', name: 'X' }, lines: [] }) + S2.flowPoHtml({ no: 'TPRN-2', date: '2026-10-11', orderNo: 'T', printer: { name: 'X' }, items: {} });
    ok('the challan and the print order carry Ridhi Home & Living — never The Fabric Rush', (pg.match(/Ridhi Home &amp; Living/g) || []).length === 2 && !/Fabric Rush/.test(pg), pg.slice(0, 300)); }

  console.log('== cut from the cloth printed for it; the waste shows in Raw cutting in store (Ravi, 11 Oct) ==');
  {
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true, subtype: 'Ruffle Tablecloth' } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }];
    const T7 = 'TEST-AMZ-77', K7 = T7 + '__RTC327-6060';
    const W7 = load({ me: { admin: true }, mdb, fsCat, fabRows: [{ fabricType: 'Sheeting 92' }], store: [{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 40 }],
      ppc: { [K7]: plan({ orderNo: T7, sku: 'RTC327-6060', qty: 10, route: 'inhouse', fabric: { name: 'Sheeting 92', perPc: 0.6, metres: 6, fromPrinted: 6 }, print: { need: true, dir: 'Vertical' } }) },
      dem: { [K7]: { fabricReady: { at: 'x' } } } });
    W7.setFLOW(Object.assign(W7.FLOW(), { test: { [T7]: { orderNo: T7, orderDate: '2026-10-12', lines: { 'RTC327-6060': { qty: 10 } } } } }));
    W7.flowTestCutOpen(T7, 'RTC327-6060');
    ok('the cutting entry names the printed fabric printed for it — RBPSF327-V-92 — and offers no fabric to pick', /<b>RBPSF327-V-92<\/b>/.test(W7.ctx.__dlg.html) && /printed for this order/.test(W7.ctx.__dlg.html) && !/id="fltcF"/.test(W7.ctx.__dlg.html), W7.ctx.__dlg.html.slice(0, 400));
    Object.assign(W7.els, { fltcP: { value: '10' }, fltcU: { value: '6' }, fltcW: { value: '0.5' }, fltcWW: { value: '18' }, fltcD: { value: '2026-10-12' }, fltcR: { value: '' } });
    const er = await W7.ctx.__dlg.onSave(); const reg = Object.values(W7.writes[0] || {}).find(v => v && v.pieces);
    ok('…saved: Cutting Data says printed fabric RBPSF327-V-92, Sheeting 92, 6 m used, 0.5 m waste at 18"', !er && reg && reg.printedFabric === 'RBPSF327-V-92' && reg.fabricWidth === 'Sheeting 92' && reg.fabricWaste === 0.5 && /Printed fabric RBPSF327-V-92/.test(reg.remarks), er || JSON.stringify(reg));
    W7.setView('raw'); W7.renderView();
    ok('Raw cutting in store shows the waste: RBPSF327-V-92, 0.5 m, 18" wide — and what the store holds of that cloth', /Waste back in the store from cutting/.test(W7.els.flTable.innerHTML) && /<b>RBPSF327-V-92<\/b>/.test(W7.els.flTable.innerHTML)
      && /<b>0\.5 m<\/b>/.test(W7.els.flTable.innerHTML) && /18"/.test(W7.els.flTable.innerHTML) && /40 m/.test(W7.els.flTable.innerHTML), W7.els.flTable.innerHTML.slice(0, 600));
  }

  console.log('== the ruffle cloth to a printer of its own (Ravi, 11 Oct: "ruffle ke fabric ke liye vendor alag h") ==');
  {
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true, subtype: 'Ruffle Tablecloth' } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' },
      { sku: 'LSB', fabric: 'Cambric', colour: 'Light Steel Blue', dir: 'Vertical', code: '327', manual: true }];
    const KR = 'AMZ-1__RTC327-6060', P1 = { code: 'P1', name: 'Sanganer Prints' }, P2 = { code: 'P2', name: 'Choudhary Hand Block' };
    const pr = o => plan(Object.assign({ sku: 'RTC327-6060', qty: 10, route: 'inhouse', fabric: { name: 'Sheeting 92', perPc: 0.6, metres: 6 }, print: { need: true, dir: 'Vertical' }, printer: P1, rufflePrinter: P2,
      extra: [{ what: 'Ruffle — Cambric', qty: 23.5, unit: 'm' }] }, o || {}));
    const mkR = o => load({ me: { admin: true }, mdb, fsCat, rfd: { 'SHEETING 92': 500, CAMBRIC: 500 }, fabRows: [{ fabricType: 'Sheeting 92' }, { fabricType: 'Cambric' }],
      lines: [L({ sku: 'RTC327-6060', qty: 10, cutReq: true })], ppc: { [KR]: pr(o) } });
    let R = mkR();
    R.flowPpcOpen('AMZ-1', 'RTC327-6060');
    ok('PPC offers a "Ruffle printer" beside the printer, the ruffle’s own one picked', /data-k="rufflePrinter.code"/.test(R.ctx.__dlg.html) && /Ruffle printer/.test(R.ctx.__dlg.html)
      && /<option value="P2" selected>/.test(R.ctx.__dlg.html.slice(R.ctx.__dlg.html.indexOf('rufflePrinter.code'))));
    const ps = R.flowPoSync([{ r: R.W.lines[0], p: pr() }], '2026-10-11'), pos = Object.values(ps.local);
    const po1 = pos.find(o => o.printer.code === 'P1'), po2 = pos.find(o => o.printer.code === 'P2');
    ok('two print orders, two numbers: the body to Sanganer (no ruffle on it), the ruffle cloth to Choudhary', po1 && po2 && po1.no !== po2.no && po1.items[KR] && !(po1.items[KR].extras || []).length && !po1.items[KR + '~ruffle']
      && po2.items[KR + '~ruffle'] && po2.items[KR + '~ruffle'].ruffle && po2.items[KR + '~ruffle'].metres === 23.5 && po2.items[KR + '~ruffle'].extras[0].code === 'LSB', JSON.stringify(pos.map(o => [o.printer.code, Object.keys(o.items)])));
    const v1 = R.flowVoLines(po1, () => pr()), v2 = R.flowVoLines(po2, () => pr());
    ok('…the Vendor Orders: Sanganer prints RBPSF327-V-92 6 m, Choudhary prints LSB 23.5 m — nothing else', v1.running.length === 1 && v1.running[0].sku === 'RBPSF327-V-92' && v1.running[0].meters === 6
      && v2.running.length === 1 && v2.running[0].sku === 'LSB' && v2.running[0].meters === 23.5 && !v2.cut.length, JSON.stringify([v1.running, v2.running]));
    ok('the same printer for both → one print order, the ruffle on it as before', (() => { const one = R.flowPoSync([{ r: R.W.lines[0], p: pr({ rufflePrinter: P1 }) }], '2026-10-11');
      const os = Object.values(one.local); return os.length === 1 && (os[0].items[KR].extras || []).length === 1 && !os[0].items[KR + '~ruffle']; })());
    R.setView('drfd'); R.renderFlow();
    ok('Demand · RFD: a challan button for each printer — the body to Sanganer, "Ruffle challan → Choudhary"', /data-pc="P1"/.test(R.els.flTable.innerHTML) && /Ruffle challan → Choudhary Hand Block/.test(R.els.flTable.innerHTML)
      && /ruffle: Cambric · 23\.5 m to Choudhary Hand Block/.test(R.els.flTable.innerHTML));
    R.flowChallanOpen('AMZ-1', 'P2');
    ok('Choudhary’s challan holds the ruffle cloth only', /ruffle only/.test(R.ctx.__dlg.html) && /RTC327-6060/.test(R.ctx.__dlg.html));
    let QS = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '23.5' } };
    R.ctx.document.querySelector = sel => QS[sel] || null;
    R.els.flcVen = { value: 'P1' }; R.els.flcDate = { value: '2026-10-11' }; R.els.flcNote = { value: '' };
    ok('…given to the wrong printer → refused', /ruffle is planned for Choudhary Hand Block/.test(await R.ctx.__dlg.onSave()));
    R.els.flcVen.value = 'P2'; let er = await R.ctx.__dlg.onSave();
    const cw = R.writes[R.writes.length - 1], chR = Object.entries(cw).find(([k]) => k.startsWith('pt_flowChallans/'))[1];
    ok('saved: one ruffle-only line, Cambric 23.5 m, and the line’s "fabric ready" left alone', !er && chR.lines.length === 1 && chR.lines[0].ruffleOnly && chR.lines[0].metres === 23.5 && chR.lines[0].fabric === 'Cambric'
      && !Object.keys(cw).some(k => k.startsWith('pt_flowDemand/')), er || JSON.stringify(cw));
    let st = R.flowState(R.W.lines[0]);
    ok('…the body cloth is still owed → the line stays in Demand · RFD; the ruffle button is gone', st.needFab && st.bucket === 'demand' && (R.setView('drfd'), R.renderFlow(), !/data-pc="P2"/.test(R.els.flTable.innerHTML) && /RFD ruffle: <a href="#" data-flchp="RFD-202610-001"[^]*(→ |Printer: )Choudhary Hand Block/.test(R.els.flTable.innerHTML)));
    R.flowChallanOpen('AMZ-1', 'P1');
    ok('Sanganer’s challan: the body only, saying the ruffle went to Choudhary', !/ruffle only/.test(R.ctx.__dlg.html) && /ruffle → Choudhary Hand Block/.test(R.ctx.__dlg.html));
    QS = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '6' } }; R.els.flcVen.value = 'P1'; er = await R.ctx.__dlg.onSave();
    const chB = Object.entries(R.writes[R.writes.length - 1]).find(([k]) => k.startsWith('pt_flowChallans/'))[1];
    st = R.flowState(R.W.lines[0]);
    ok('…saved with no ruffle on it; now nothing is owed → out of Demand', !er && !chB.lines[0].ruffleOnly && !(chB.lines[0].extras || []).length && !st.needFab && st.bucket !== 'demand', er || st.bucket);
  }

  console.log('== one order, two sizes on the same printed cloth: the store first, then ONE combined demand (Ravi, 11 Oct) ==');
  {
    const spans = {}, span = q => spans[q] || (spans[q] = { innerHTML: '', textContent: '' });
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.6, cuttingRequired: true, subtype: 'Ruffle Tablecloth' },
      'RTC327-6090': { color: 'Light Steel Blue', fabric: 'Sheeting 92', consumption: 0.9, cuttingRequired: true, subtype: 'Ruffle Tablecloth' } };
    const fsCat = [{ sku: 'RBPSF327-V-92', fabric: 'Sheeting 92', colour: 'Light Steel Blue', dir: 'Vertical', code: '327' }];
    const B = load({ me: { admin: true }, mdb, fsCat, rfd: { 'SHEETING 92': 500 }, fabRows: [{ fabricType: 'Sheeting 92' }], store: [{ key: 'M|SHEETING 92|LIGHT STEEL BLUE', qty: 10 }],
      lines: [L({ orderNo: 'AMZ-2', sku: 'RTC327-6060', qty: 20, cutReq: true }), L({ orderNo: 'AMZ-2', sku: 'RTC327-6090', qty: 20, cutReq: true })] });
    B.ctx.document.querySelector = q => (/data-mat=|data-fm=|data-pget=|data-chips=|data-combo/.test(q) ? span(q) : null);
    B.flowPpcOpen('AMZ-2');
    const m0 = spans['[data-mat="0"]'].innerHTML, m1 = spans['[data-mat="1"]'].innerHTML, cb = spans['[data-combo]'].innerHTML;
    ok('the first line takes the 10 m in the store (needs 12 m)', /✓ covers 10 m/.test(m0), m0);
    ok('…the second sees it taken by the line above — not "for earlier orders"', /the line above took it — goes to the printer/.test(m1) && /10 m taken by the line\(s\) above/.test(m1) && !/all for earlier orders|of it for earlier orders/.test(m1), m1);
    ok('"This order, combined": RBPSF327-V-92 to print once, 2 m + 18 m = 20 m', /This order, combined/.test(cb) && /<b>RBPSF327-V-92<\/b>[^]*?<b>20 m<\/b>/.test(cb), cb);
    ok('…and the RFD for the whole order in one row: Sheeting 92, 20 m', /RFD · <b>Sheeting 92<\/b><\/td><td class="num">20 m/.test(cb), cb);
    /* the Vendor Order the printer sees: one line for RBPSF327-V-92 */
    const it = (sku, m) => ({ sku, print: { kind: 'fabric', code: 'RBPSF327-V-92', label: 'Light Steel Blue · Sheeting 92 · Vertical', mode: 'Running fabric' }, extras: [], unit: 'm', pcs: 20, metres: m });
    const K1 = 'AMZ-2__RTC327-6060', K2 = 'AMZ-2__RTC327-6090', pl = { fabric: { name: 'Sheeting 92' }, print: { dir: 'Vertical' }, dates: {} };
    const vl = B.flowVoLines({ no: 'PRN-202610-009', orderNo: 'AMZ-2', items: { [K1]: it('RTC327-6060', 2), [K2]: it('RTC327-6090', 18) } }, () => pl);
    ok('the Vendor Order has ONE running line for RBPSF327-V-92: 20 m, for both SKUs', vl.running.length === 1 && vl.running[0].meters === 20 && vl.running[0].sku === 'RBPSF327-V-92'
      && vl.running[0].flowPart === [K1 + '|body', K2 + '|body'].sort().join('+') && /RTC327-6060, RTC327-6090/.test(vl.running[0].notes) && vl.running[0].forOrders.length === 1 && vl.running[0].forOrders[0].qty === 40, JSON.stringify(vl.running));
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
    A.setView('pord'); A.renderView();
    ok('the Print orders bucket lists it, counted as open', /PRN-202610-001/.test(A.els.flTable.innerHTML) && /sent to printer/.test(A.els.flTable.innerHTML));
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
    ok('Demand RFD says "3 of 5.3 m sent" and the print order', /3 of 5\.3 m sent/.test(A.els.flTable.innerHTML) && /PO: <a href="#" data-flpop="PRN-202610-001"/.test(A.els.flTable.innerHTML));
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('the next challan offers the 2.3 m left', /data-chm="0" type="number" step="0.01" value="2.3"/.test(A.ctx.__dlg.html) && /3 m sent already/.test(A.ctx.__dlg.html));
    q = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '2.3' }, '[data-chk="1"]': { checked: false }, '[data-chm="1"]': { value: '' } };
    er = await A.ctx.__dlg.onSave();
    st = A.flowState(L({ sku: 'RPC327-1818', qty: 10 }));
    ok('all 5.3 m sent over two challans → the line leaves Demand for Printed fabric in', !er && !A.flowInView('drfd', st) && st.bucket === 'fabric' && Object.keys(A.FLOW().ch).length === 2, er);
    A.setView('pord'); A.renderView();
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
    ok('a TEST order: its TPRN print order only — nothing written into the vendor order register', !er && !Object.keys(C.writes[0]).some(k => k.startsWith('pt_vendorOrders/')) && Object.keys(C.writes[0]).some(k => /pt_flowPrintOrders\/TPRN-/.test(k)), er);
    /* …but on the preview the Vendor Orders screen and the printer's portal show it (Ravi, 11 Oct), built on the fly. */
    const tv = C.flowTestVos();
    { const D2 = load({ me: { admin: true }, mdb, fsCat, cas: true, casDb: { 'pt_flowPrintOrders/TPRN-202610-001': { no: 'TPRN-202610-001', by: 'a@x' } }, lines: [L({ orderNo: 'TEST-AMZ-2', sku: 'RPC327-1818', qty: 10, __t: {} })] });
      D2.flowPpcOpen('TEST-AMZ-2'); D2.ctx.document.querySelectorAll = () => [PRF(0, 'P1')]; const e2 = await D2.ctx.__dlg.onSave();
      ok('two plans raised at once, same print order number: nothing saved, said — the other one’s print order stands', /raised by somebody else at the same moment/.test(e2) && !D2.writes.length && D2.ctx.__casDb['pt_flowPrintOrders/TPRN-202610-001'].by === 'a@x', e2); }
    ok('…the test print order shows as a TEST vendor order for P1: TVPO-…, the printed cloth, view only', tv.length >= 1 && tv.every(v => v.vendorCode === 'P1' && v.test && v.virtual && /^TVPO-/.test(v.orderNo) && /^tvpo_TPRN-/.test(v.id))
      && tv.some(v => v.lines.some(l => l.sku === 'RBP-CANVAS-327')) && C.flowVpViewOnly(tv[0]), JSON.stringify(tv.map(v => [v.orderNo, v.lines.map(l => l.sku)])));
    C.setFLOW(Object.assign(C.FLOW(), { at: Date.now() })); C.setVOrows([{ vendorCode: 'P1', id: 'real1', orderNo: 'VPO-1', lines: [] }]); await C.flowVoExtra(); await C.flowVoExtra();
    ok('…the Vendor Orders screen gets it once, beside the real ones, however often it is drawn', C.VOrows().length === 1 + tv.length && C.VOrows()[0].id === 'real1');
    /* 15 Oct, Ravi: the printer only looks — no entry, no acknowledge, no "start production", old orders included. */
    ok('every order is view only for the printer now — an old running order too', C.flowVpViewOnly({ id: 'real1', status: 'Placed' }) && C.flowVpViewOnly({ demandSource: 'ppc' }));
    { const E = load({ ls: { vpEntry: '1' }, me: { admin: true }, mdb, fsCat });
      ok('…vpEntry = 1 on one computer brings the old entries back for an old order (a PPC order stays view only)', !E.flowVpViewOnly({ id: 'real1', status: 'Placed' }) && E.flowVpViewOnly({ demandSource: 'ppc' })); }
    ok('…the test vendor order carries what the printer is told: given / received, in its unit, nothing yet',
      tv.every(v => v.flowProg && v.flowProg.unit === (v.orderType === 'cut' ? 'pcs' : 'm') && v.flowProg.given === 0 && v.flowProg.back === 0), JSON.stringify(tv.map(v => v.flowProg)));
    { /* a challan to P1 for the print order's running line, 12 m, 5 m back on 17 Oct */
      const po = Object.values(C.FLOW().po || {}).find(o => o && o.test), key = Object.keys(po.items).find(k => po.items[k] && po.items[k].unit !== 'pcs');
      C.setFLOW(Object.assign(C.FLOW(), { ch: { 'TRFD-9': { no: 'TRFD-9', date: '2026-10-16', orderNo: po.orderNo, vendor: { code: 'P1', name: 'Sanganer Prints' },
        lines: [{ key, sku: 'X', metres: 12 }], receipts: { r1: { date: '2026-10-17', items: { [key]: 5 } } } } } }));
      const pg = C.flowVoProgOf(po, 'running');
      ok('…a challan of 12 m and 5 m back → given 12 m on TRFD-9, received 5 m on 17 Oct', pg.given === 12 && pg.back === 5 && pg.challans[0].no === 'TRFD-9' && pg.receipts[0].date === '2026-10-17' && pg.receipts[0].qty === 5, JSON.stringify(pg));
      ok('…and per print-order line (items), for the colour board: 12 given, 5 back on that line', pg.items[key] && pg.items[key].given === 12 && pg.items[key].back === 5, JSON.stringify(pg.items));
      ok('…a challan to another printer, or for another order, is not counted', (() => { C.FLOW().ch['TRFD-9'].vendor.code = 'P2'; const x = C.flowVoProgOf(po, 'running'); C.FLOW().ch['TRFD-9'].vendor.code = 'P1'; return x.given === 0; })()); }
    { /* a REAL print order: the office's screen writes the summary onto the printer's vendor order, once */
      const S = load({ me: { admin: true }, mdb, fsCat });
      S.setFLOW(Object.assign(S.FLOW(), { po: { 'PRN-1': { no: 'PRN-1', orderNo: 'AMZ-9', printer: { code: 'P1', name: 'Sanganer Prints' }, items: { 'AMZ-9__S1': { sku: 'S1', unit: 'm', metres: 10 } },
        vo: { running: { code: 'P1', id: 'vpo_flow_1', orderNo: 'VPO-9' } } } },
        ch: { 'RFD-1': { no: 'RFD-1', date: '2026-10-15', orderNo: 'AMZ-9', vendor: { code: 'P1' }, lines: [{ key: 'AMZ-9__S1', sku: 'S1', metres: 10 }], receipts: {} } } }));
      S.flowVoProgSync(); await new Promise(r => setTimeout(r, 1700));
      const w = S.writes.find(p => p['pt_vendorOrders/P1/vpo_flow_1/flowProg']);
      ok('a real print order: given 10 m on RFD-1 is written onto the printer\'s vendor order (flowProg)', !!w && w['pt_vendorOrders/P1/vpo_flow_1/flowProg'].given === 10 && !!w['pt_flowPrintOrders/PRN-1/voProg/running'], JSON.stringify(S.writes));
      const n = S.writes.length; S.flowVoProgSync(); await new Promise(r => setTimeout(r, 1700));
      ok('…nothing changed → nothing written again', S.writes.length === n); }
    { const off = load({ ls: { flow: '0' }, me: { admin: true }, mdb, fsCat });
      off.setFLOW(Object.assign(off.FLOW(), { po: C.FLOW().po, ppc: C.FLOW().ppc }));
      ok('with the flow switched off (flow = 0): no test vendor order anywhere, and a PPC order is not view only', !off.flowTestVos().length && !off.flowVpViewOnly({ demandSource: 'ppc', test: true })); }
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
    A.setView('cut'); A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) })); A.renderView();
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

  console.log('== lampshades (17 Oct): two codes added by hand for one cloth, and a colour code past a dash ==');
  {
    const mdb = { 'CPCLS007': { color: 'Apatite Blue', fabric: 'Cambric', cuttingRequired: true, brand: 'CPC' } };
    const fsCat = [
      { sku: 'CPCF007', fabric: 'Cambric', colour: 'Apatite Blue', dir: 'Vertical', code: '007' },
      { sku: 'AB', fabric: 'Cambric', colour: 'Apatite Blue', dir: 'Vertical', code: '007', manual: true, at: '2026-09-25T08:16:06Z' },
      { sku: 'APB', fabric: 'Cambric', colour: 'Apatite Blue', dir: 'Vertical', code: '007', manual: true, at: '2026-09-25T08:23:29Z' },
    ];
    const p1 = plan({ sku: 'CPCLS007', qty: 500, route: 'inhouse', fabric: { name: 'Cambric', perPc: 0.35, metres: 175 }, print: { need: true } });
    const w = load({ mdb, fsCat }).flowPrintWhat(L({ sku: 'CPCLS007', qty: 500 }), p1);
    ok('Apatite Blue cambric → APB, the one added last — not "AB APB"', w.kind === 'fabric' && w.code === 'APB', JSON.stringify(w));
    const tie = fsCat.map(c => c.manual ? Object.assign({}, c, { at: 'same' }) : c);
    ok('two added at the same moment are both still named (nobody chose between them)', load({ mdb, fsCat: tie }).flowPrintWhat(L({ sku: 'CPCLS007', qty: 500 }), p1).code === 'AB APB');
    const cut = load({ mdb: { CPCLS007: Object.assign({}, mdb.CPCLS007, { cuttingRequired: false }) }, fsCat }).flowPrintWhat(L({ sku: 'CPCLS007', qty: 500 }), p1);
    ok('…and with "cutting required" off in the master it is printed on the SKU (pcs) — the master decides', cut.kind === 'sku' && cut.unit === 'pcs');
    /* the app's own colour-code reader, from the source */
    const occ = new Function('return ' + require('fs').readFileSync(require('path').join(__dirname, '../src/app/orders/orders-one-line.js'), 'utf8').match(/^const ordColCodeOf = (.*);\s*$/m)[1])();
    ok('colour code past a dash: CPCLS-CO-002 → 002, RBP-CANVAS-327 → 327, CPCLS-B-004 → 004', occ('CPCLS-CO-002') === '002' && occ('RBP-CANVAS-327') === '327' && occ('CPCLS-B-004') === '004', [occ('CPCLS-CO-002'), occ('RBP-CANVAS-327'), occ('CPCLS-B-004')].join());
    {
      const cat = [{ sku: 'CPCF007', fabric: 'Cambric', colour: 'Apatite Blue', dir: 'Vertical', code: '007', brand: 'CPC', imageUrl: 'https://x/cpc007.jpg' },
        { sku: 'APB', fabric: 'Cambric', colour: 'Apatite Blue', dir: 'Vertical', code: '007', brand: 'CPC', manual: true, imageUrl: '' }];
      const B = load({ mdb, fsCat: cat });
      ok('swatch: a code added by hand (APB) borrows the picture of the built one in the same colour code (CPCF007)', B.flowSwatchOf('CPCLS-CO-007', 'APB') === 'https://x/cpc007.jpg', B.flowSwatchOf('CPCLS-CO-007', 'APB'));
      ok('swatch: the built fabric SKU gives its own picture; an unknown one gives none (no crash)', B.flowSwatchOf('X', 'CPCF007') === 'https://x/cpc007.jpg' && B.flowSwatchOf('X', 'NOPE') === '');
    }
    ok('…and the plain ones read as before: RQL351-Q → 351, RBPSF9-H-82 → 9, CPCLS002 → 002, RB-MR → ""', occ('RQL351-Q') === '351' && occ('RBPSF9-H-82') === '9' && occ('CPCLS002') === '002' && occ('RB-MR') === '');
  }

  console.log('== PPC in Excel (17 Oct): the list out, the plan back in as drafts ==');
  {
    const mdb = { S1: { color: 'Red', fabric: 'Cotton', consumption: 0.5, cuttingRequired: true } };
    const X = load({ mdb, lines: [Object.assign(L({ orderNo: 'TST-1', sku: 'S1', qty: 100 }), { __t: true })], ls: { flowReal: '1' } });
    const ppc = X.flowRows().filter(x => x.s.bucket === 'ppc');
    const sh = X.flowPpcXlRows(ppc), H = sh[0], row = sh[1] || [], col = n => H.indexOf(n);
    ok('export: one row per PPC line, with the suggestion — fabric Cotton, 0.5 m/pc, 50 m, Printing', ppc.length === 1 && row[col('Fabric')] === 'Cotton' && row[col('Metres / piece')] === 0.5 && row[col('Total m')] === 50 && row[col('How it is made')] === 'Printing', JSON.stringify(row));
    const key = row[0], R = (vals) => { const r = H.map(() => ''); Object.entries(vals).forEach(([k, v]) => { r[col(k)] = v; }); return r; };
    const rd = X.flowPpcXlRead([H, R({ 'Line ID': key, 'How it is made': 'Cutting', 'Fabric': 'Sheeting 82', 'Metres / piece': '0.3', 'Printer': 'Choudhary Hand Block', 'Cut date': '20/10/2026', 'Raise (yes/no)': 'yes' }),
      R({ 'Line ID': key, 'How it is made': 'Teleport', 'Raise (yes/no)': 'yes' }), R({ 'Line ID': 'NOPE__X', 'Raise (yes/no)': 'yes' }), R({ 'Line ID': key, 'Raise (yes/no)': 'no' })]);
    const v = (rd.drafts || {})[key] || {};
    ok('import: a yes row becomes the line’s draft — route, fabric, m/pc, printer by name → code, date read', rd.keys.length === 1 && v.route === 'stitch' && v['fabric.name'] === 'Sheeting 82' && v['fabric.perPc'] === '0.3' && v['printer.code'] === 'P2' && v['dates.cut'] === '2026-10-20', JSON.stringify(rd));
    ok('import: a wrong route is refused by row, a line not in PPC left alone, a "no" row skipped', rd.errs.length === 1 && /How it is made/.test(rd.errs[0]) && rd.skipped.length === 1, JSON.stringify([rd.errs, rd.skipped]));
    ok('import: the Cutting route with "already printed" left blank means the cloth is in hand — no RFD', v['fabric.noRfd'] === true, JSON.stringify(v));
    const Y = load({ mdb: { S9: { color: 'Red', fabric: 'Cotton', consumption: 0.5, noPrint: true } } });
    const sg = Y.flowSuggest(L({ sku: 'S9', qty: 10 }));
    ok('a new plan on the Cutting route starts ticked "already printed — take no RFD" (17 Oct)', sg.route === 'stitch' && sg.fabric.noRfd === true, JSON.stringify(sg.fabric));
    ok('import: dates as the sheet may hold them', X.flowXlDate('2026-10-21') === '2026-10-21' && X.flowXlDate('21-10-2026') === '2026-10-21' && X.flowXlDate(46315) === '2026-10-20' && X.flowXlDate('') === '' && X.flowXlDate('soon') === null, X.flowXlDate(46316));
    ok('import: a sheet without Line ID / Raise is refused whole', !!X.flowPpcXlRead([['PO', 'SKU'], ['a', 'b']]).err);
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
    A.setView('vendor'); A.renderView();
    ok('no "edit plan" anywhere down the line — a plan is changed from PPC completed only', !/data-flplan=/.test(A.els.flTable.innerHTML));
    ok('a planned line that is finished (handed over) leaves PPC completed', A.flowInView('ppcdone', A.flowState(L())) && !A.flowInView('ppcdone', A.flowState(L({ handedAt: '2026-10-12' }))));
    A.setView('ppcdone'); A.renderFlow();
    ok('PPC completed lists every planned line not finished: what was planned, where it is now, and "Edit plan"', /data-flplan="AMZ-1\|S1"/.test(A.els.flTable.innerHTML) && /Cotton<\/b> · 100 m/.test(A.els.flTable.innerHTML)
      && /Sanganer Prints/.test(A.els.flTable.innerHTML) && /data-flb="ppcdone"/.test(A.els.flBuckets.innerHTML) && /<span class="fl-n">1<\/span><span>PPC completed/.test(A.els.flBuckets.innerHTML) && /data-flb="ppc"[^]*data-flb="ppcdone"[^]*data-flb="demand"/.test(A.els.flBuckets.innerHTML), A.els.flTable.innerHTML.slice(0, 600));
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
    ok('…shown as cancelled with no buttons but none, not counted open, and its number not reused', /cancelled/.test(A.els.flTable.innerHTML) && !/data-flchr=/.test(A.els.flTable.innerHTML) && /Printed fabric in · history <b>0<\/b>/.test(A.els.flPanel.innerHTML) && A.flowChallanNo('2026-10-12') === 'RFD-202610-002');
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
    ok('since 14 Oct the switch starts OFF even with a test order there (PPC shows the sales orders)', A.flowTestOnly() === false);
    A.flowTestOnlySet(true);
    A.setView('ppc'); A.renderFlow();
    ok('PPC holds only the test order, not the real AMZ-1', /TEST-AMZ-10102026-01/.test(A.els.flTable.innerHTML) && !/AMZ-1<\/a>/.test(A.els.flTable.innerHTML) && /Showing test orders only/.test(A.els.flMsg.textContent));
    ok('the counts are the test order\u2019s: PPC 1 (the real AMZ-1 is not counted); no WIP bucket here', /<span class="fl-n">1<\/span><span>PPC/.test(A.els.flBuckets.innerHTML) && !/data-flb="wip"/.test(A.els.flBuckets.innerHTML), A.els.flBuckets.innerHTML);
    A.setView('dhist'); A.renderFlow();
    ok('Demand history shows only the test challan', /TRFD-202610-001/.test(A.els.flTable.innerHTML) && !/>RFD-202610-001</.test(A.els.flTable.innerHTML) && /Printed fabric in · history <b>1<\/b>/.test(A.els.flPanel.innerHTML));
    A.flowTestOnlySet(false); A.setView('wip'); A.renderView();
    ok('switched off: everything again (the real SHP line is in WIP)', /SHP-5717/.test(A.els.flTable.innerHTML));
    ok('no test order → the switch starts OFF', load({ me: { admin: true } }).flowTestOnly() === false);
    ok('a choice made is kept (localStorage flowTestOnly)', load({ ls: { flowTestOnly: '0' } , me: { admin: true } }).flowTestOnly() === false && load({ ls: { flowTestOnly: '1' } }).flowTestOnly() === true);
  }

  console.log('== test orders switched off (flowTests = 0): only the sales orders ==');
  {
    const TN = 'TEST-AMZ-10102026-01';
    const db = {
      pt_flowTest: { [TN]: { orderNo: TN, src: 'AMZ', orderDate: '2026-10-13', lines: { S1: { qty: 10 } } } },
      pt_ppc: { [TN + '__S1']: { orderNo: TN, sku: 'S1' } },
      pt_accReserve: { [TN + '__S1']: { orderNo: TN, sku: 'S1', items: { Z1: 5 } }, 'AMZ-1__R2': { orderNo: 'AMZ-1', sku: 'R2', items: { Z1: 2 } } },
      pt_flowChallans: { 'TRFD-202610-001': { no: 'TRFD-202610-001', orderNo: TN, lines: [] }, 'RFD-202610-001': { no: 'RFD-202610-001', orderNo: 'AMZ-1', lines: [] } },
      pt_flowPrintOrders: { 'TPRN-1': { no: 'TPRN-1', test: true }, 'PRN-1': { no: 'PRN-1' } },
      pt_flowFgSend: { f1: { orderNo: TN, sku: 'S1', pcs: 1, test: true }, f2: { orderNo: 'AMZ-1', sku: 'R2', pcs: 1 } },
    };
    const B = load({ ls: { flowTests: '0', flowTestOnly: '1' }, me: { admin: true }, db, mdb: { R2: { cons: 1, fab: 'Cotton' } }, lines: [L({ sku: 'R2' })] });
    await B.flowLoad(true);
    const F = B.FLOW();
    ok('switched off: no test order is read', Object.keys(F.test).length === 0);
    ok('…nor its plan, reservation, challan, print order or FG send',
      !Object.keys(F.ppc).some(k => /^TEST-/.test(k)) && Object.keys(F.res).join() === 'AMZ-1__R2' && Object.keys(F.ch).join() === 'RFD-202610-001'
      && Object.keys(F.po).join() === 'PRN-1' && Object.keys(F.fg).join() === 'f2', JSON.stringify([F.res, F.ch, F.po, F.fg]));
    ok('"Only test orders" cannot narrow to nothing, even remembered ON', B.flowTestOnly() === false);
    B.setView('ppc'); B.renderFlow();
    ok('PPC holds the sales order AMZ-1, no test order', /AMZ-1/.test(B.els.flTable.innerHTML) && !/TEST-/.test(B.els.flTable.innerHTML) && !/SHOWING TEST ORDERS ONLY/.test(B.els.flMsg.textContent));
    ok('the "+ Test order" button and the switch are hidden', B.els.flTest.style.display === 'none');
    const C = load({ ls: { flowTests: null }, me: { admin: true }, db, lines: [L({ sku: 'R2' })] });
    await C.flowLoad(true);
    ok('OFF by default since 15 Oct (real working): no test order is read', !Object.keys(C.FLOW().test).length && !Object.values(C.FLOW().po).some(o => /^TEST-/.test(o.orderNo)), JSON.stringify(Object.values(C.FLOW().po).map(o => o.orderNo)));
    C.setView('ppc'); C.renderFlow();
    ok('…and no "+ Test order" button or switch', C.els.flTest.style.display === 'none');
  }

  console.log('== a test order made from a sales order (Ravi, 14 Oct) ==');
  {
    const S = load({ me: { admin: true }, mdb: { S1: { cons: 0.5, fab: 'Cotton' }, S2: { cons: 1, fab: 'Cotton' } },
      lines: [L({ orderNo: 'AMZ-900', sku: 'S1', qty: 4, orderDate: '2026-10-12' }), L({ orderNo: 'AMZ-900', sku: 'S2', qty: 6, orderDate: '2026-10-12' }),
        L({ orderNo: 'AMZ-77', sku: 'NOPE', qty: 2, orderDate: '2026-10-11' })] });
    S.flowTestOpen();
    ok('the dialog offers the sales orders, newest first', S.ctx.__dlg.html.indexOf('value="AMZ-900"') > 0 && S.ctx.__dlg.html.indexOf('value="AMZ-900"') < S.ctx.__dlg.html.indexOf('value="AMZ-77"'));
    S.els.fltSo = { value: 'shp-999' };
    ok('an order not on the book is refused', /SHP-999 is not on the order book/.test(await S.ctx.__dlg.onSave()) && !S.writes.length);
    S.els.fltSo = { value: 'AMZ-77' };
    ok('an order with a SKU not in the master is refused, named', /AMZ-77: NOPE is not in the master/.test(await S.ctx.__dlg.onSave()) && !S.writes.length);
    S.els.fltSo = { value: 'amz-900' };
    ok('saved: the order’s SKUs and quantities, its platform, and where it came from', !(await S.ctx.__dlg.onSave()) && S.writes.length === 1
      && (w => w && w.src === 'AMZ' && w.fromSo === 'AMZ-900' && w.lines.S1.qty === 4 && w.lines.S2.qty === 6)(S.writes[0]['pt_flowTest/TEST-AMZ-13102026-01']), JSON.stringify(S.writes));
    ok('the sales order itself is untouched, and both sit in the flow', S.W.lines.length === 3 && S.flowRows().some(x => x.r.orderNo === 'TEST-AMZ-13102026-01' && x.r.fromSo === 'AMZ-900'));
    ok('the new test order is put in the search box, so it is the one on screen', S.els.flQ.value === 'TEST-AMZ-13102026-01');
    S.els.flQ.value = ''; S.setView('ppc'); S.renderFlow();
    ok('PPC shows the real sales order and the test copy, which says what it copies', /AMZ-900/.test(S.els.flTable.innerHTML) && /copy of sales order AMZ-900/i.test(S.els.flTable.innerHTML) && /data-ordj="AMZ-900"/.test(S.els.flTable.innerHTML));
    ok('compact: an order of two lines is named once — one delete link, one copy note, the second line carries the order no small', (S.els.flTable.innerHTML.match(/data-fltdel="TEST-AMZ-13102026-01"/g) || []).length === 1 && (S.els.flTable.innerHTML.match(/copy of sales order AMZ-900/ig) || []).length === 1 && /<div class="muted" style="font-size:11px">TEST-AMZ-13102026-01<\/div>/.test(S.els.flTable.innerHTML));
  }

  console.log('== PPC completed: one cell under every heading (Ravi, 14 Oct: "too hotch potch") ==');
  {
    const P = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' }, S2: { cons: 1, fab: 'Cotton' } }, lines: [L({ sku: 'S1' }), L({ sku: 'S2' })],
      ppc: { 'AMZ-1__S1': plan({ printer: { code: 'P1', name: 'RBP-Bagru' }, at: '2026-10-12T10:00:00Z', by: 'ravi@x' }), 'AMZ-1__S2': plan({ sku: 'S2', at: '2026-10-12T10:00:00Z', by: 'ravi@x' }) } });
    P.setView('ppcdone'); P.renderFlow();
    const h = P.els.flTable.innerHTML, th = ((h.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0].match(/<th[ >]/g) || []).length;
    const rows = ((h.match(/<tbody>([\s\S]*)<\/tbody>/) || ['', ''])[1]).split(/<tr[ >]/).slice(1).map(r => (r.match(/<td[ >]/g) || []).length);
    ok('every row has as many cells as there are headings (Qty was there twice)', rows.length === 2 && rows.every(n => n === th), th + ' headings, rows ' + rows.join(','));
    ok('Edit plan sits under its own (last) heading, the second line of the order is named small', /Edit plan/.test(h) && /<div class="muted" style="font-size:11px">AMZ-1<\/div>/.test(h));
    ok('design A: the plan is one thing a line — Route:, Fabric:, Print:', /<div>Route: <b>/.test(h) && /<div>Fabric: <b>Cotton<\/b> · [\d,.]+ m<\/div>/.test(h) && /<div>Print: <b>RBP-Bagru<\/b><\/div>/.test(h), h.slice(0, 1500));
    ok('no extra lines (Ravi, 15 Oct): nothing to say → the line under the toolbar is empty; the phase is the Refresh tooltip', P.els.flMsg.textContent === '' && /(LIVE|TEST phase) — the flow runs/.test(P.els.flRefresh.title), P.els.flMsg.textContent);
  }

  console.log('== test phase on the live app: the flow runs TEST orders only until Ravi says so (14 Oct) ==');
  {
    const TN = 'TEST-AMZ-14102026-01';
    const db = {
      pt_flowTest: { [TN]: { orderNo: TN, src: 'AMZ', orderDate: '2026-10-14', fromSo: 'AMZ-1', lines: { S1: { qty: 5 } } } },
      pt_ppc: { [TN + '__S1']: plan({ orderNo: TN, sku: 'S1', qty: 5 }), 'AMZ-1__S1': plan() },
      pt_flowChallans: { 'TRFD-202610-001': { no: 'TRFD-202610-001', orderNo: TN, lines: [] }, 'RFD-202610-001': { no: 'RFD-202610-001', orderNo: 'AMZ-1', lines: [] } },
      pt_flowDemand: { 'AMZ-1__S1': { fabricReady: { at: '2026-10-12' } } },
    };
    const P = load({ ls: { flowReal: '0' }, host: 'fabricrush-replenish.web.app', me: { admin: true }, db, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines: [L()] });
    ok('on the live app the flow is on (menu, screens, Greige Desk)', P.FLOW_ON === true);
    ok('a real order dated after 10 Oct is NOT the flow\'s — the old screens take it as they always did', P.flowOwnsOrder('AMZ-1') === false && P.flowOwnsOrder('AMZ-1', '2026-10-12') === false);
    ok('a test order is the flow\'s', P.flowOwnsOrder(TN) === true);
    await P.flowLoad(true);
    const F = P.FLOW();
    ok('what the flow wrote for a real order is left out as it is read — plan, fabric ready, challan',
      !F.ppc['AMZ-1__S1'] && !F.dem['AMZ-1__S1'] && !F.ch['RFD-202610-001'] && !!F.ppc[TN + '__S1'] && !!F.ch['TRFD-202610-001'], JSON.stringify([Object.keys(F.ppc), Object.keys(F.ch)]));
    ok('the flow\'s lists hold the test order alone, no real line', P.flowRows().length === 1 && P.flowRows()[0].r.orderNo === TN, JSON.stringify(P.flowRows().map(x => x.r.orderNo)));
    P.flowTestOpen();
    ok('…and "+ Test order" still offers the real sales orders to copy', /value="AMZ-1"/.test(P.ctx.__dlg.html));
    const R = load({ ls: { flowReal: '1' }, me: { admin: true }, db, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines: [L()] });
    await R.flowLoad(true);
    ok('flowReal = 1 (the "move forward" switch) brings the real orders in', R.flowOwnsOrder('AMZ-1') === true && R.flowRows().some(x => x.r.orderNo === 'AMZ-1') && !!R.FLOW().ppc['AMZ-1__S1']);
  }

  console.log('== Shopify runs for real: an order opened from the Production bucket from 15 Oct is in PPC by itself (15 Oct) ==');
  {
    const lines = [
      L({ orderNo: 'SHP-1001', sku: 'S1', qty: 2, src: 'SHP', orderDate: '2026-10-08', openIso: '2026-10-15' }),   // ordered last week, opened today
      L({ orderNo: 'SHP-0900', sku: 'S1', qty: 1, src: 'SHP', orderDate: '2026-10-11', openIso: '2026-10-12' }),   // opened before the day
      L({ orderNo: 'ONL-77', sku: 'S1', qty: 1, src: 'ONL', orderDate: '2026-10-15', openIso: '2026-10-16' }),
      L({ orderNo: 'AMZ-1', sku: 'S1', qty: 5, orderDate: '2026-10-15', openIso: '2026-10-15' }),
    ];
    const db = { pt_ppc: { 'SHP-1001__S1': plan({ orderNo: 'SHP-1001', sku: 'S1', qty: 2 }), 'AMZ-1__S1': plan() },
      pt_flowChallans: { 'RFD-202610-009': { no: 'RFD-202610-009', orderNo: 'SHP-1001', lines: [] }, 'RFD-202610-001': { no: 'RFD-202610-001', orderNo: 'AMZ-1', lines: [] } } };
    const P = load({ ls: { flowReal: '0' }, host: 'fabricrush-replenish.web.app', me: { admin: true }, db, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines });
    ok('a Shopify order opened from 15 Oct is the flow\'s — its printing is PPC\'s, the old screens hand it over', P.flowOwnsOrder('SHP-1001') === true && P.flowOwnsOrder('ONL-77') === true);
    ok('…one opened before 15 Oct, and every Amazon order, still go the old way', P.flowOwnsOrder('SHP-0900') === false && P.flowOwnsOrder('AMZ-1') === false && P.flowOwnsOrder('AMZ-1', '2026-10-15') === false);
    await P.flowLoad(true);
    const F = P.FLOW();
    ok('its plan and challan are read; the Amazon order\'s stay left out', !!F.ppc['SHP-1001__S1'] && !!F.ch['RFD-202610-009'] && !F.ppc['AMZ-1__S1'] && !F.ch['RFD-202610-001'], JSON.stringify([Object.keys(F.ppc), Object.keys(F.ch)]));
    const nos = P.flowRows().map(x => x.r.orderNo).sort();
    ok('the flow\'s lists hold the two live Shopify / online orders, no other real line', JSON.stringify(nos) === JSON.stringify(['ONL-77', 'SHP-1001']), JSON.stringify(nos));
    const onl = P.flowRows().find(x => x.r.orderNo === 'ONL-77');
    ok('a live order with no plan yet sits in PPC by itself — no test order needed', onl.s.isNew === true && onl.s.bucket === 'ppc', JSON.stringify(onl.s.bucket));
    const shp = P.flowRows().find(x => x.r.orderNo === 'SHP-1001');
    ok('…new by the day it was opened, though the customer ordered before 10 Oct', shp.s.isNew === true);
    P.flowTestOpen();
    ok('"+ Test order" no longer offers a live Shopify order (it runs for real), still offers the rest',
      !/value="SHP-1001"/.test(P.ctx.__dlg.html) && !/value="ONL-77"/.test(P.ctx.__dlg.html) && /value="SHP-0900"/.test(P.ctx.__dlg.html) && /value="AMZ-1"/.test(P.ctx.__dlg.html));
    const O = load({ ls: { flowReal: '0', flowMto: '0' }, me: { admin: true }, db, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines });
    await O.flowLoad(true);
    ok('flowMto = 0 on one computer puts Shopify back on the old way', O.flowOwnsOrder('SHP-1001') === false && O.flowRows().length === 0 && !O.FLOW().ppc['SHP-1001__S1']);
  }

  console.log('== live for every order (15 Oct): the day an order came onto the book makes it PPC ==');
  {
    const lines = [
      L({ orderNo: 'AMZ-NEW', sku: 'S1', qty: 4, orderDate: '2026-09-20', openIso: '2026-10-15' }),   // re-uploaded today, old order date
      L({ orderNo: 'B2B-OLD', sku: 'S1', qty: 3, src: 'B2B', orderDate: '2026-09-20', openIso: '2026-09-21' }),
    ];
    const D = load({ ls: { flowReal: null }, host: 'fabricrush-replenish.web.app', me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' } }, lines });
    ok('with nothing set on the computer, the flow runs the real orders (FLOW_REAL_DEFAULT = true)', D.flowOwnsOrder('AMZ-1', '2026-10-12') === true);
    ok('an order uploaded on 15 Oct is the flow order even though its order date is 20 Sep', D.flowOwnsOrder('AMZ-NEW') === true && D.flowOwnsOrder('AMZ-NEW', '2026-09-20') === true);
    ok('…an order put on the book before, with an old date, is not', D.flowOwnsOrder('B2B-OLD') === false);
    const n = D.flowRows().find(x => x.r.orderNo === 'AMZ-NEW');
    ok('…and the re-uploaded order waits in PPC to be planned', !!n && n.s.isNew === true && n.s.bucket === 'ppc', JSON.stringify(n && n.s.bucket));
    D.setView('ppc'); D.renderFlow();
    ok('the page says it is live, and from which day an upload counts', /LIVE — the flow runs the real orders from 2026-10-10, and every order put on the book from 2026-10-15/.test(D.els.flRefresh.title), D.els.flRefresh.title);
  }

  console.log('== search and filters (Ravi, 15 Oct: "add a search bar and filter all action") ==');
  {
    const lines = [
      L({ orderNo: 'AMZ-A', sku: 'S1', color: 'Blue', size: '60x90', articleType: 'Tablecloth', orderDate: '2026-10-11' }),
      L({ orderNo: 'SHP-B', sku: 'S2', src: 'SHP', color: 'Red', size: '18x18', articleType: 'Pillow Cover', orderDate: '2026-10-12' }),
    ];
    const F = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton', fabric: 'Cotton' }, S2: { cons: 0.5, fab: 'Canvas', fabric: 'Canvas' } }, lines });
    F.setView('ppc'); F.renderFlow();
    ok('nothing narrowed → both lines, and no message', /AMZ-A/.test(F.els.flTable.innerHTML) && /SHP-B/.test(F.els.flTable.innerHTML) && F.els.flMsg.textContent === '' && F.els.flFiltN.textContent === '');
    F.els.flFCol.value = 'Red'; F.renderFlow();
    ok('Colour = Red → only the red line; the Filters button counts 1 and the line says what is narrowed',
      !/AMZ-A/.test(F.els.flTable.innerHTML) && /SHP-B/.test(F.els.flTable.innerHTML) && F.els.flFiltN.textContent === '1' && /Showing 1 of 2 line\(s\) — 1 filter\(s\)/.test(F.els.flMsg.textContent), F.els.flMsg.textContent);
    F.els.flFCol.value = ''; F.els.flFFab.value = 'Cotton'; F.renderFlow();
    ok('Fabric = Cotton (from the master data, no plan yet) → only the cotton line', /AMZ-A/.test(F.els.flTable.innerHTML) && !/SHP-B/.test(F.els.flTable.innerHTML));
    F.els.flFFab.value = ''; F.els.flQ.value = 'canvas'; F.renderFlow();
    ok('the search finds a line by its fabric too', !/AMZ-A/.test(F.els.flTable.innerHTML) && /SHP-B/.test(F.els.flTable.innerHTML) && /search “canvas”/.test(F.els.flMsg.textContent), F.els.flMsg.textContent);
    F.els.flQ.value = ''; F.els.flSrc.value = 'SHP'; F.els.flFArt.value = 'Tablecloth'; F.renderFlow();
    ok('filters add up: Shopify AND Tablecloth → nothing', !/AMZ-A|SHP-B/.test(F.els.flTable.innerHTML) && F.els.flFiltN.textContent === '2');
    F.els.flSrc.value = ''; F.els.flFArt.value = ''; F.els.flFPo.value = 'SHP-B'; F.renderFlow();
    ok('PO = SHP-B → only that order (Ravi, 16 Oct: "filter me PO add karo")', !/AMZ-A/.test(F.els.flTable.innerHTML) && /SHP-B/.test(F.els.flTable.innerHTML) && F.els.flFiltN.textContent === '1');
    F.els.flFPo.value = '';
    /* The PO list holds the POs of the bucket on screen only (17 Oct). */
    const G = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' }, S2: { cons: 1, fab: 'Cotton' } }, lines: [L({ orderNo: 'AMZ-A', sku: 'S1' }), L({ orderNo: 'AMZ-P', sku: 'S2' })],
      ppc: { 'AMZ-P__S2': plan({ orderNo: 'AMZ-P', sku: 'S2' }) } });
    G.setView('ppc'); G.renderFlow();
    const poList = () => ((G.ctx.__fills || {}).flFPo || []).map(p => p[0]).join();
    ok('PPC bucket open → the PO list holds the PPC POs only (AMZ-A, not the planned AMZ-P)', poList() === 'AMZ-A', poList());
    G.setView('ppcdone'); G.renderFlow();
    ok('…PPC completed open → its own POs (AMZ-P)', poList() === 'AMZ-P', poList());
  }

  console.log('== PPC sends a line to Printing, straight to Cutting, or straight to Job Work (15 Oct) ==');
  {
    const mdb = { S1: { cons: 1, fab: 'Cotton' } };
    const mk = route => load({ me: { admin: true }, mdb, lines: [L({ sku: 'S1', qty: 10, cutReq: true })],
      ppc: { 'AMZ-1__S1': plan({ sku: 'S1', qty: 10, route, fabric: { name: 'Cotton', perPc: 1, metres: route === 'jobwork' ? 0 : 10 }, print: { need: route === 'inhouse' } }) } });
    const P = mk('jobwork'), sJ = P.flowRows().find(x => x.r.orderNo === 'AMZ-1').s;
    ok('the three ways are offered with their names: Printing, Cutting, Job Work (and Outsourced)', ['inhouse', 'stitch', 'jobwork', 'outsource'].every(k => P.FLOW_ROUTES.some(r => r[0] === k))
      && P.FLOW_ROUTES.find(r => r[0] === 'jobwork')[2] === 'Job Work' && P.FLOW_ROUTES.find(r => r[0] === 'stitch')[2] === 'Cutting' && P.FLOW_ROUTES.find(r => r[0] === 'inhouse')[2] === 'Printing');
    ok('Job Work: no RFD is asked for, cutting is skipped though the SKU needs cutting → straight to Raw cutting in store',
      !sJ.needFab && !sJ.cutReq && sJ.bucket === 'raw' && sJ.canIssue === 10, JSON.stringify({ needFab: sJ.needFab, cutReq: sJ.cutReq, bucket: sJ.bucket, canIssue: sJ.canIssue }));
    const sC = mk('stitch').flowRows().find(x => x.r.orderNo === 'AMZ-1').s;
    ok('Cutting: no printing; the RFD is asked for first (Demand), then the cutting department', sC.needFab && sC.cutReq && sC.bucket === 'demand' && !sC.printed);
    ok('the registers can ask the planned route of an order line (Job Work → no cutting entry needed to issue)', P.flowPlanRouteOf('AMZ-1', 'S1') === 'jobwork' && P.flowPlanRouteOf('AMZ-1', 'NOPE') === '');
  }

  console.log('== a challan for part of the pieces; same SKU, same day orders combined in PPC (15 Oct) ==');
  {
    const mdb = { 'RTC327-6060': { color: 'Light Steel Blue', fabric: 'Sheeting 62', consumption: 1.58, cuttingRequired: false } };
    const pr = { code: 'P1', name: 'Sanganer Prints' };
    const A = load({ me: { admin: true }, mdb, rfd: { 'SHEETING 62': 9999 }, lines: [L({ sku: 'RTC327-6060', qty: 100 })],
      ppc: { 'AMZ-1__RTC327-6060': plan({ sku: 'RTC327-6060', qty: 100, printer: pr, fabric: { name: 'Sheeting 62', perPc: 1.58, metres: 158 }, print: { need: true } }) } });
    A.setView('drfd'); A.renderFlow();
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('a line printed on the SKU itself: the pieces are a box, 100 owed', /data-chp="0"[^>]*value="100"/.test(A.ctx.__dlg.html), A.ctx.__dlg.html.slice(0, 200));
    const q = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '63.2' }, '[data-chp="0"]': { value: '40' } };
    A.ctx.document.querySelector = sel => q[sel] || null;
    A.els.flcVen = { value: 'P1' }; A.els.flcDate = { value: '2026-10-15' }; A.els.flcNote = { value: '' }; A.ctx.__win = [];
    q['[data-chp="0"]'].value = '101';
    let er = await A.ctx.__dlg.onSave();
    ok('more pieces than owed is refused', /at most the 100 still owed/.test(er || ''), er);
    q['[data-chp="0"]'].value = '40';
    er = await A.ctx.__dlg.onSave();
    const ch = Object.values(A.FLOW().ch)[0];
    ok('40 of 100 pieces: the challan carries 40 pcs', !er && ch && ch.lines[0].pcs === 40, er || JSON.stringify(ch && ch.lines));
    A.setView('drfd'); A.renderFlow();
    ok('…the line stays in Demand → RFD, marked Partly sent: 40 of 100 sent, 60 still to send', /Partly sent/.test(A.els.flTable.innerHTML) && /40 of 100 pcs sent · 60 still to send/.test(A.els.flTable.innerHTML), A.els.flTable.innerHTML.slice(0, 300));
    A.flowChallanOpen('AMZ-1', 'P1');
    ok('…and the next challan offers the 60 left', /data-chp="0"[^>]*value="60"/.test(A.ctx.__dlg.html));
    /* A challan already made for all of it is cut down by Edit (Ravi's TRFD-202610-003: 1,00,000 pcs, only part went). */
    const no = ch.no;
    A.flowChallanEditOpen(no);
    ok('Edit challan: the pieces are a box too, at most 40 + the 60 still owed = 100', /data-cep="0"[^>]*max="100"[^>]*value="40"/.test(A.ctx.__dlg.html), A.ctx.__dlg.html.slice(0, 300));
    const e = { '[data-cek="0"]': { checked: true }, '[data-cem="0"]': { value: '15.8' }, '[data-cep="0"]': { value: '10' } };
    A.ctx.document.querySelector = sel => e[sel] || null;
    A.els.flceVen = { value: 'P1' }; A.els.flceDate = { value: '2026-10-15' }; A.els.flceNote = { value: '' };
    er = await A.ctx.__dlg.onSave();
    A.setView('drfd'); A.renderFlow();
    ok('…cut to 10 pcs: the challan says 10, and Demand says 10 of 100 sent, 90 still to send', !er && A.FLOW().ch[no].lines[0].pcs === 10
      && /10 of 100 pcs sent · 90 still to send/.test(A.els.flTable.innerHTML), er || A.els.flTable.innerHTML.slice(0, 300));
  }
  {
    const C = load({ me: { admin: true }, mdb: { S1: { cons: 1, fab: 'Cotton' } },
      lines: [L({ orderNo: 'AMZ-7', sku: 'S1', qty: 30, orderDate: '2026-10-15' }), L({ orderNo: 'B2B-8', src: 'B2B', sku: 'S1', qty: 20, orderDate: '2026-10-15' }),
        L({ orderNo: 'AMZ-9', sku: 'S1', qty: 5, orderDate: '2026-10-14' })] });
    C.setView('ppc'); C.renderFlow();
    const h = C.els.flTable.innerHTML;
    ok('PPC: two orders of one day for S1 are one row — Combined · 2 orders, 30 + 20 = 50, Plan together', /Combined · 2 orders/.test(h) && /<b>50<\/b>/.test(h) && /30 \+ 20/.test(h)
      && /data-flppck="AMZ-7__S1,B2B-8__S1"/.test(h), h.slice(0, 400));
    ok('…another day\'s order for the same SKU stays a row of its own', /data-flppc="AMZ-9"/.test(h) && (h.match(/Combined ·/g) || []).length === 1);
    C.flowPpcOpen('', '', ['AMZ-7__S1', 'B2B-8__S1']);
    ok('Plan together opens one plan for both orders, a card each', /AMZ-7, B2B-8/.test(C.ctx.__dlg.title) && (C.ctx.__dlg.html.match(/class="fpc-h"/g) || []).length === 2, C.ctx.__dlg.title);
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
    A.ctx.document.querySelector = sel => ({ '[data-flrm="0"]': { value: '5' } })[sel] || null;
    A.flowReceiveOpen('TRFD-202610-001'); A.els.flrDate = { value: '2026-10-14' }; A.els.flrNote = { value: '' };
    await A.ctx.__dlg.onSave();
    ok('received in full → the challan closes → the line is in the store (Cutting)', A.FLOW().ch['TRFD-202610-001'].closed && T().s.bucket === 'cut');
    { const hr = A.flowVlogRows();
      ok('…and the receipt is a row of Vendors & printers → History: 5 m from Sanganer, accepted, TEST, on its challan', hr.length === 1 && hr[0].qty === 5 && hr[0].unit === 'm' && hr[0].ok && hr[0].ok.qty === 5
        && hr[0].vendor === 'Sanganer Prints' && hr[0].test && /^flow\/TRFD-202610-001\//.test(hr[0].key2) && /TRFD-202610-001/.test(hr[0].orderNo), JSON.stringify(hr)); }
    { const LV = load({ ls: { flow: '0' } }); LV.setFLOW(Object.assign(LV.FLOW(), { ch: A.FLOW().ch }));
      ok('…never where the flow is switched off (flow = 0)', LV.flowVlogRows().length === 0); }
    /* Cutting: asks what Cutting Data asks. */
    A.setView('cut'); A.renderView();
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
    A.setView('wip'); A.renderView();
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
    ok('the flow screen has no QC bucket — the line is with Quality Control', /data-flb="ppc"/.test(A.els.flBuckets.innerHTML) && !/qcb|fgin/.test(A.els.flBuckets.innerHTML), A.els.flBuckets.innerHTML.slice(0, 200));
    A.setView('new'); A.renderView();
    ok('…New orders says where it is now: Quality Control (QC screen)', /Quality Control \(QC screen\)/.test(A.els.flTable.innerHTML));
    await A.flowQcEntry(T().r);
    ok('…"Quality Control →" opens Waiting for QC narrowed to the test order', A.ctx.__tabs.includes('qc') && A.els.qcQ.value === TN);
    qcAdd([{ checked: 6, ok: 6, baseId: bid(ramesh) }, { id: 'qcSpot', checked: 4, ok: 0, dept: 'spotting', spotting: 4, baseId: bid(pradeep) }]);
    ok('Quality Control passed 6 and sent 4 to spotting → still with Quality Control', T().s.qc === 6 && T().s.bucket === 'qcb', T().s.bucket);
    qcAdd([{ refId: 'qcSpot', ok: 3, rejected: 1, dept: 'spotting', baseId: bid(pradeep) }]);
    /* The 1 rejected is back in Raw cutting in store: issued again, received, checked. */
    ok('back from spotting: 3 passed, 1 rejected → QC clear, the 1 back in Raw cutting in store to issue again', T().s.qc === 9 && T().s.bucket === 'raw' && T().s.qcRej === 1 && T().s.issuedNet === 9, T().s.bucket);
    A.setView('raw'); A.renderView();
    ok('…the store list says so and offers the 1 to issue', /1 rejected at QC — back in store/.test(A.els.flTable.innerHTML) && />1<\/b>/.test(A.els.flTable.innerHTML));
    A.flowTestIssueOpen(TN, 'S1'); await new Promise(r => setTimeout(r, 0)); say({ fltiT: 'Company Contractor', fltiK: 'Suresh', fltiP: '1', fltiD: '2026-10-15', fltiR: '' });
    er = await A.ctx.__dlg.onSave();
    ok('issued again to Suresh → WIP', !er && T().s.bucket === 'wip' && T().s.issuedAll === 11, er || T().s.bucket);
    const sur = Object.entries(T().r.__t.issues).find(([, e]) => e.karigar === 'Suresh')[0];
    A.flowTestRecvOpen(TN, 'S1'); say({ fltrI: sur, fltrP: '1', fltrX: '0', fltrD: '2026-10-16' }); er = await A.ctx.__dlg.onSave();
    ok('back from Suresh → QC (1 waiting)', !er && T().s.bucket === 'qcb', er || T().s.bucket);
    qcAdd([{ checked: 1, ok: 1, baseId: bid(sur), date: '2026-10-16' }]);
    ok('QC passed it → all 10 passed → Ready → India stock', T().s.qc === 10 && T().s.bucket === 'fgin', T().s.bucket);
    A.setView('new'); A.renderView();
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
    const fgRows = A.writes.flatMap(w => Object.entries(w).filter(([k, v]) => k.startsWith('pt_fgiLedger/') && v).map(([, v]) => v));
    ok('the other 4 accepted → done; each accept is a TEST entry in the India store: RECEIVE, Received from QC (Production flow)', !er && A.flowState(T() ? T().r : A.flowTestLines()[0]).bucket === 'done' && !A.flowFgLines().length
      && fgRows.length === 2 && fgRows.every(r => r.txnType === 'RECEIVE' && r.orderNo === TN && r.sku === 'S1' && r.test && r.receivedFrom === 'QC (Production flow)' && /^\[TEST\]/.test(r.remarks))
      && fgRows.reduce((a, r) => a + r.qty, 0) === 10 && A.ctx.FGI.rows.length === 2, er || JSON.stringify(fgRows));
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
        && Object.keys(A.FLOW().fg || {}).length === 0 && Object.keys(w).filter(k => k.startsWith('pt_flowFgSend/')).length === 3
        && fgRows.every(r => w['pt_fgiLedger/' + r._id] === null) && !A.ctx.FGI.rows.length; })());
    { const w = A.writes[n0];
      ok('…and its TEST entries from all three registers — Cutting Data, Job Work, Quality Control', w['pt_cuttingData/' + cuts[0].id] === null && bds.every(r => w['pt_baseData/' + r.id] === null) && qcs.every(q => w['pt_qcChecks/' + q.id] === null), Object.keys(w).join());
      ok('…and from the screens\u2019 lists at once', !A.ctx.PT.cut.some(r => r.orderNo === TN) && !A.ctx.PT.base.some(r => r.orderNo === TN) && !A.ctx.QC.checks.some(r => r.orderNo === TN)); }
    ok('…and it is gone from every bucket', !A.flowRows().some(x => x.r.orderNo === TN));
  }

  console.log('== Simulate still stands in where the factory has no form of ours (printer, outsourced) ==');
  { const B = load({ me: { admin: true } }); B.setFLOW(Object.assign(B.FLOW(), { test: { 'TEST-AMZ-9': { orderNo: 'TEST-AMZ-9', orderDate: '2026-10-13', lines: { S1: { qty: 10 } } } } }));
    const er = await B.flowSimulate('TEST-AMZ-9', 'S1', 'vendor');
    ok('Simulate: vendor order placed → given 10', !er && B.flowTestLines()[0].__t.given === 10, er); }

  console.log('== two people at once: nothing written over (Ravi, 11 Oct: "same time par alag alag entry, ek hi bucket me") ==');
  {
    const pl2 = (sku, m) => plan({ sku, fabric: { name: 'Sheeting 62', perPc: 1, metres: m } });
    const mk = o => load(Object.assign({ me: { admin: true }, cas: true, rfd: { 'SHEETING 62': 500 }, lines: [L({ sku: 'S1' }), L({ sku: 'S2' })], ppc: { [K]: pl2('S1', 66), 'AMZ-1__S2': pl2('S2', 20) } }, o || {}));
    /* A made RFD-202610-001 a moment ago; B's screen has not read it yet */
    let B = mk({ casDb: { 'pt_flowChallans/RFD-202610-001': { no: 'RFD-202610-001', by: 'a@x' } } });
    B.flowChallanOpen('AMZ-1');
    const QS = { '[data-chk="0"]': { checked: true }, '[data-chm="0"]': { value: '66' }, '[data-chk="1"]': { checked: false }, '[data-chm="1"]': { value: '' } };
    B.ctx.document.querySelector = sel => QS[sel] || null;
    B.els.flcVen = { value: 'P1' }; B.els.flcDate = { value: '2026-10-10' }; B.els.flcNote = { value: '' };
    let er = await B.ctx.__dlg.onSave();
    ok('two challans at once: B’s number was taken → B gets RFD-202610-002; A’s challan is not written over', !er && B.ctx.__casDb['pt_flowChallans/RFD-202610-001'].by === 'a@x'
      && B.ctx.__casDb['pt_flowChallans/RFD-202610-002'] && B.ctx.__casDb['pt_flowChallans/RFD-202610-002'].no === 'RFD-202610-002', er || JSON.stringify(Object.keys(B.ctx.__casDb)));
    ok('…the challan itself is written only where nothing was; the save marks the line with the new number', !Object.keys(B.writes[0] || {}).some(k => /^pt_flowChallans\/[^/]+$/.test(k))
      && (B.writes[0] || {})['pt_flowDemand/' + K + '/fabricReady'].challan === 'RFD-202610-002', JSON.stringify(B.writes[0]));
    /* receiving: A received on it a moment ago (its revision is 1 in the database; B read it at none) */
    const ch = { 'RFD-202610-009': { no: 'RFD-202610-009', date: '2026-10-10', orderNo: 'AMZ-1', vendor: { code: 'P1', name: 'Sanganer Prints' }, lines: [{ key: K, sku: 'S1', metres: 66, print: { kind: 'fabric', code: 'X' } }] } };
    B = mk({ casDb: { 'pt_flowRev/ch_RFD-202610-009': 1 } }); B.setFLOW(Object.assign(B.FLOW(), { ch, at: Date.now() }));
    B.flowReceiveOpen('RFD-202610-009'); B.ctx.document.querySelector = sel => (sel === '[data-flrm="0"]' ? { value: '66' } : null);
    B.els.flrDate = { value: '2026-10-11' }; B.els.flrNote = { value: '' };
    er = await B.ctx.__dlg.onSave();
    ok('two receipts on one challan at once: the second is refused, nothing written, the screen read again', /Somebody else saved here just now/.test(er) && !B.writes.length, er);
    B = mk({ casDb: {} }); B.setFLOW(Object.assign(B.FLOW(), { ch, at: Date.now() }));
    B.flowReceiveOpen('RFD-202610-009'); B.ctx.document.querySelector = sel => (sel === '[data-flrm="0"]' ? { value: '66' } : null);
    B.els.flrDate = { value: '2026-10-11' }; B.els.flrNote = { value: '' };
    er = await B.ctx.__dlg.onSave();
    ok('…alone, it saves and moves the challan’s revision to 1', !er && B.ctx.__casDb['pt_flowRev/ch_RFD-202610-009'] === 1 && B.writes.length === 1, er);
    /* editing a challan writes its own fields, never the whole record (a receipt saved meanwhile would be lost) */
    B = mk({ casDb: {} }); B.setFLOW(Object.assign(B.FLOW(), { ch, at: Date.now() }));
    B.flowChallanEditOpen('RFD-202610-009');
    B.ctx.document.querySelector = sel => ({ '[data-cek="0"]': { checked: true }, '[data-cem="0"]': { value: '60' } })[sel] || null;
    B.els.flceVen = { value: 'P1' }; B.els.flceDate = { value: '2026-10-10' }; B.els.flceNote = { value: 'edited' };
    er = await B.ctx.__dlg.onSave(); const ew = B.writes[B.writes.length - 1] || {};
    ok('editing a challan: field by field (vendor, date, note, lines) — the receipts are never written over', !er && !('pt_flowChallans/RFD-202610-009' in ew) && ew['pt_flowChallans/RFD-202610-009/lines'] && !Object.keys(ew).some(k => /receipts/.test(k)), er || Object.keys(ew).join());
    /* the shared accessory shelf */
    B = mk({ casDb: { 'pt_flowRev/acc': 3 }, shelf: [{ code: '18', qty: 500 }], ppc: { [K]: plan({ acc: [{ code: '18', qty: 10 }] }) } });
    er = await B.flowReserve(L(), B.flowState(L()));
    ok('two reservations from the shelf at once: the second is refused, nothing reserved', /Somebody else saved here just now/.test(er) && !B.writes.length, er);
    /* Finished Goods: one line accepted by two of the team at once */
    B = mk({ casDb: { ['pt_flowRev/fg_' + K]: 1 } });
    er = await B.flowFgAccept({ r: L(), s: { key: K, made: 10, india: 0 } }, 10, '');
    ok('two Finished Goods accepts of one line at once: the second is refused — India stock counted once', /Somebody else saved here just now/.test(er) && !B.writes.length, er);
  }

  console.log('== Demand is one bucket with its tabs; cutting, raw cutting and WIP live in their own screens (Ravi, 12 Oct) ==');
  { const D = load({ me: { admin: true }, ppc: { [K]: plan() }, lines: [L()] });
    D.setView('drfd'); D.renderFlow();
    ok('inside the one menu item: PPC › Demand — no New orders, Print orders, Vendor allocation, Outsourced, Cutting, Raw cutting or WIP', /data-flb="ppc"[^]*data-flb="demand"/.test(D.els.flBuckets.innerHTML)
      && !/data-flb="(new|pord|vendor|out|cut|raw|wip)"/.test(D.els.flBuckets.innerHTML) && /class="fl-b on" data-flb="demand"/.test(D.els.flBuckets.innerHTML), D.els.flBuckets.innerHTML.slice(0, 300));
    ok('…Demand has its tabs: RFD fabric · out to printers (1, open) · Printed fabric in · history · Accessories', /data-fldem="drfd" class=""[^>]*>RFD fabric · out to printers <b>1<\/b>/.test(D.els.flPanel.innerHTML)
      && /data-fldem="dhist"/.test(D.els.flPanel.innerHTML) && /data-fldem="dacc"/.test(D.els.flPanel.innerHTML), D.els.flPanel.innerHTML.slice(0, 400));
    /* Job Work Register: Raw cutting in store and WIP as its tabs */
    const R = load({ me: { admin: true }, ppc: { [K]: plan({ print: { need: false } }) }, dem: { [K]: { fabricReady: { at: 'x' } } }, lines: [L()] });
    R.ctx.$('panePbase').children = []; R.ctx.$('flSeg_pbase'); R.ctx.$('flEmb_pbase'); R.FLOW_EMB().pbase = 'raw';
    await R.flowEmbedRender('pbase');
    ok('the Job Work Register gets tabs: Job Work Register · Raw cutting in store (1) · WIP — and Raw cutting shows the line to issue', /data-flemb=""[^>]*>Job Work Register/.test(R.els.flSeg_pbase.innerHTML)
      && /data-flemb="raw" class=""[^>]*>Raw cutting in store <b[^>]*>1<\/b>/.test(R.els.flSeg_pbase.innerHTML) && /data-flemb="wip"/.test(R.els.flSeg_pbase.innerHTML)
      && /AMZ-1/.test(R.els.flEmbT_pbase.innerHTML) && /Raw cutting in store: 1 line/.test(R.els.flEmbMsg_pbase.textContent), R.els.flSeg_pbase.innerHTML.slice(0, 400));
    const C = load({ me: { tabs: ['flcut'] }, lines: [L()] }); C.ctx.$('panePbase').children = []; C.ctx.$('flSeg_pbase'); C.ctx.$('flEmb_pbase'); C.FLOW_EMB().pbase = 'raw';
    await C.flowEmbedRender('pbase');
    ok('…a tab the account does not hold is not there, and nothing is shown for it', !/data-flemb="raw"/.test(C.els.flSeg_pbase.innerHTML) && C.FLOW_EMB().pbase === '');
    /* PLATFORM IN THE EMBEDDED LISTS (Ravi, 16 Oct: "to cut wale me filter laga kar check kar saku ki kis platform ka h"). */
    const K2 = 'SHP-9__S1';
    const E = load({ me: { admin: true }, ppc: { [K]: plan({ print: { need: false } }), [K2]: plan({ orderNo: 'SHP-9', print: { need: false } }) },
      dem: { [K]: { fabricReady: { at: 'x' } }, [K2]: { fabricReady: { at: 'x' } } }, lines: [L(), L({ orderNo: 'SHP-9', src: 'SHP' })] });
    E.ctx.$('panePbase').children = []; E.ctx.$('flSeg_pbase'); E.ctx.$('flEmb_pbase'); E.FLOW_EMB().pbase = 'raw';
    await E.flowEmbedRender('pbase');
    ok('both platforms listed before a pick', /AMZ-1/.test(E.els.flEmbT_pbase.innerHTML) && /SHP-9/.test(E.els.flEmbT_pbase.innerHTML));
    E.els.flEmbSrc_pbase.value = 'SHP'; await E.flowEmbedRender('pbase');
    ok('platform = SHP → only the Shopify line, and the line under it says 1 of 2', !/AMZ-1/.test(E.els.flEmbT_pbase.innerHTML) && /SHP-9/.test(E.els.flEmbT_pbase.innerHTML) && /1 of 2 line/.test(E.els.flEmbMsg_pbase.textContent), E.els.flEmbMsg_pbase.textContent);
    E.els.flEmbSrc_pbase.value = ''; E.els.flEmbQ_pbase.value = 'amz-1'; await E.flowEmbedRender('pbase');
    ok('…and the search finds a PO', /AMZ-1/.test(E.els.flEmbT_pbase.innerHTML) && !/SHP-9/.test(E.els.flEmbT_pbase.innerHTML));
  }

  console.log('== every number made for a line, on the line (Ravi, 12 Oct: "isme hi vendor bhi add kar do") ==');
  { const P = load({ me: { admin: true } });
    P.setFLOW(Object.assign(P.FLOW(), {
      po: { 'TPRN-202610-004': { no: 'TPRN-202610-004', test: true, orderNo: 'TEST-AMZ-3', printer: { name: 'SS Hand Block' }, items: { 'TEST-AMZ-3__CPC-02': { sku: 'CPC-02', print: { kind: 'sku', code: 'CPC-02' }, extras: [] } } },
        'PRN-202610-009': { no: 'PRN-202610-009', orderNo: 'AMZ-9', printer: { name: 'RBP-Bagru' }, vo: { running: { orderNo: 'VPO-261012-K7Q' } }, items: { 'AMZ-9__RPC1': { sku: 'RPC1', print: { kind: 'fabric', code: 'RBP-CANVAS-327' }, extras: [] } } } },
      ch: { 'TRFD-202610-007': { no: 'TRFD-202610-007', vendor: { name: 'SS Hand Block' }, lines: [{ key: 'TEST-AMZ-3__CPC-02' }] },
        'TRFD-202610-008': { no: 'TRFD-202610-008', cancelled: { why: 'x' }, vendor: { name: 'SS Hand Block' }, lines: [{ key: 'TEST-AMZ-3__CPC-02' }] } } }));
    const t = P.flowDocsOf({ s: { key: 'TEST-AMZ-3__CPC-02' } }).map(e => e.kind + ' ' + e.no + ' → ' + e.who).join(' | ');
    ok('a test line: its print order, its vendor order (TVPO-…-C, cut pieces) and its RFD challan — not the cancelled one', t === 'Print order TPRN-202610-004 → SS Hand Block | Vendor order TVPO-202610-004-C → SS Hand Block | RFD challan TRFD-202610-007 → SS Hand Block', t);
    const r = P.flowDocsOf({ s: { key: 'AMZ-9__RPC1' } }).map(e => e.kind + ' ' + e.no).join(' | ');
    ok('a real line: the vendor order is the one PPC placed (VPO-…), running cloth', r === 'Print order PRN-202610-009 | Vendor order VPO-261012-K7Q', r); }

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
  ok('only the buckets this account holds are buttons — WIP is a tab of the Job Work Register, not of this screen', /data-flb="ppc"/.test(A.els.flBuckets.innerHTML) && !/data-flb="wip"/.test(A.els.flBuckets.innerHTML) && !/data-flb="demand"/.test(A.els.flBuckets.innerHTML));
  ok('it opens on PPC, with the new line and a Plan button', /AMZ-1/.test(A.els.flTable.innerHTML) && /data-flppc="AMZ-1"/.test(A.els.flTable.innerHTML));
  ok('the old line is not in PPC', !/AMZ-0/.test(A.els.flTable.innerHTML));
  A.setView('wip'); A.renderView();
  ok('…it is in WIP, with Receive (issued 100, nothing back yet)', /AMZ-0/.test(A.els.flTable.innerHTML) && /data-flent="recv\|AMZ-0__S1"/.test(A.els.flTable.innerHTML));
  ok('the page says which phase the flow is in (here, with flowReal on: LIVE)', /LIVE — the flow runs the real orders from 2026-10-10/.test(A.els.flRefresh.title) && !/not on the live app/.test(A.els.flRefresh.title), A.els.flRefresh.title);
  { const TS = load({ ls: { flowReal: '0' }, me: { admin: true } }); TS.setView('ppc'); TS.renderFlow();
    ok('…in the test phase with Shopify live it says Shopify runs for real from 15 Oct, Amazon / B2B the old way', /Shopify LIVE — Shopify \/ online orders opened from the Production bucket from 2026-10-15/.test(TS.els.flRefresh.title), TS.els.flRefresh.title); }
  { const TP = load({ ls: { flowReal: '0', flowMto: '0' }, me: { admin: true } }); TP.setView('ppc'); TP.renderFlow();
    ok('…and in the test phase it says so: test orders only, real orders the old way', /TEST phase — the flow runs test orders only; real orders go the old way/.test(TP.els.flRefresh.title), TP.els.flRefresh.title); }
  A = load({ me: { tabs: ['ord'] } });
  A.renderFlow();
  ok('no bucket → says so, draws nothing', /No bucket/.test(A.els.flMsg.textContent) && !A.els.flTable.innerHTML);

  console.log('== one way in for a flow order (Ravi, 13 Oct: "remove the duplicate") ==');
  A = load({ lines: [L(), L({ orderNo: 'AMZ-0', orderDate: '2026-09-01' }), L({ orderNo: 'SHP-5', orderDate: '2026-10-11' })] });
  ok('an order dated from the flow date is the flow\'s', A.flowOwnsOrder('AMZ-1') === true && A.flowOwnsOrder('amz-1') === true);
  ok('an older order is not — it runs the old way to the end', A.flowOwnsOrder('AMZ-0') === false);
  ok('a test order always is; an order nobody knows is not', A.flowOwnsOrder('TEST-AMZ-12102026-01') === true && A.flowOwnsOrder('XYZ-9') === false);
  ok('a date passed in is used as it is', A.flowOwnsOrder('NEW-1', '2026-10-10') === true && A.flowOwnsOrder('NEW-1', '2026-10-09') === false);
  ok('a localStorage flowFrom moves the line', load({ lines: [L()], ls: { flowFrom: '2026-10-13' } }).flowOwnsOrder('AMZ-1') === false);
  ok('with the flow switched off nothing is the flow\'s', load({ lines: [L()], ls: { flow: '0' } }).flowOwnsOrder('AMZ-1') === false);
  ok('a hand-made vendor order stamped for a flow order is caught, once per order',
    JSON.stringify(A.flowOwnedIn([{ sku: 'S1', forOrders: [{ orderNo: 'AMZ-1', qty: 5 }, { orderNo: 'AMZ-0', qty: 5 }] }, { sku: 'S2', forOrders: [{ orderNo: 'AMZ-1', qty: 2 }] }, { sku: 'S3', cancelled: true, forOrders: [{ orderNo: 'TEST-X' }] }])) === '["AMZ-1"]');
  ok('…and one for older orders only passes', A.flowOwnedIn([{ sku: 'S1', forOrders: [{ orderNo: 'AMZ-0', qty: 5 }] }, { sku: 'S9' }]).length === 0);
  ok('PPC\'s vendor orders and test ones are the flow\'s; a hand-made one is not',
    A.flowVoIsFlow({ id: 'vpo_flow_x', demandSource: 'ppc' }) && A.flowVoIsFlow({ id: 'tvpo_PRN-1-R' }) && A.flowVoIsFlow({ id: 'x', test: true }) && !A.flowVoIsFlow({ id: 'vpo_123', demandSource: 'bulk' }));
  ok('a flow order\'s pieces are refused at the stock entry; an old order\'s and a make-to-order line\'s are not',
    A.flowFgOwns('AMZ-1', 'S1') === true && A.flowFgOwns('AMZ-0', 'S1') === false && A.flowFgOwns('SHP-5', 'S1') === false);
  A = load({ lines: [L()], ppc: { [K]: plan({ route: 'outsource', outVendor: 'V1' }) } });
  ok('…nor an outsourced line\'s, received from its vendor as before', A.flowFgOwns('AMZ-1', 'S1') === false);
  {
    const mk = (val, opt) => { const o = { removed: false, remove() { o.removed = true; } }; return { sel: { value: val, changed: 0, querySelector: q => (q.includes('"' + opt + '"') ? o : null), dispatchEvent() { this.changed++; } }, o }; };
    A = load({ me: { tabs: ['flraw', 'flwip'] } });
    const pc = mk('wait', 'wait'), pb = mk('', 'pending');
    A.els.pcView = pc.sel; A.els.pbStatus = pb.sel;
    A.flowDupViewsOff();
    ok('"Cut, not yet issued" goes where Raw cutting in store is, and a screen standing on it is moved off', pc.o.removed && pc.sel.value === '' && pc.sel.changed === 1);
    ok('"Has pending" goes where WIP is', pb.o.removed && pb.sel.changed === 0);
    A = load({ me: { tabs: ['flwip'] } });
    const pc2 = mk('wait', 'wait'), pb2 = mk('', 'pending');
    A.els.pcView = pc2.sel; A.els.pbStatus = pb2.sel;
    A.flowDupViewsOff();
    ok('…but stays for an account without the Raw cutting tab, so nobody loses the list', !pc2.o.removed && pc2.sel.value === 'wait' && pb2.o.removed);
  }

  console.log('\n== back to the sales team (Ravi, 15 Oct: "back to sale team function bhi add karo yadi order me koi problem h to") ==');
  {
    const L1 = L({ orderNo: 'SHP-9', sku: 'RTBX616', qty: 1, orderDate: '2026-10-14', src: 'SHP' }), L2 = L({ orderNo: 'SHP-9', sku: 'R2', qty: 2, orderDate: '2026-10-14', src: 'SHP' });
    const OB = [{ id: 'ob_shp_SHP-9_RTBX616', orderNo: 'SHP-9', sku: 'RTBX616', qty: 1 }, { id: 'ob_shp_SHP-9_R2', orderNo: 'SHP-9', sku: 'R2', qty: 2 }];
    const B = load({ me: { tabs: ['flppc'] }, lines: [L1, L2] });
    B.ctx.PTG.ob = OB;
    B.setView('ppc'); B.renderFlow();
    ok('every PPC line has "Back to sales"', (B.els.flTable.innerHTML.match(/data-flback=/g) || []).length === 2);
    B.flowBackOpen([B.flowKey('SHP-9', 'RTBX616')]);
    const dlg = B.ctx.__dlg;
    ok('the dialog asks what is wrong and a note', !!dlg && /flbkWhy/.test(dlg.html) && /flbkNote/.test(dlg.html), dlg && dlg.title);
    B.els.flbkWhy = { value: 'other' }; B.els.flbkNote = { value: '' };
    ok('"Other" with no note is refused', /why/i.test(await dlg.onSave()));
    B.els.flbkWhy = { value: 'master' }; B.els.flbkNote = { value: 'no consumption for 5x4.5x5' };
    ok('sent back: saved', (await dlg.onSave()) === '');
    const w = B.writes[B.writes.length - 1] || {}, nb = w['pt_orderBook/ob_shp_SHP-9_RTBX616/ppcBack'];
    ok('written on that line\'s order-book row only, with why, note, who and a log', !!nb && nb.why === 'master' && nb.note === 'no consumption for 5x4.5x5' && nb.by === 'ppc@x' && nb.log.length === 1 && Object.keys(w).length === 1, JSON.stringify(w));
    /* What the order book now says comes back through ordLines (production-to-shipping.js carries ppcBack). */
    const L1b = Object.assign({}, L1, { ppcBack: nb });
    const B2 = load({ me: { tabs: ['flppc'] }, lines: [L1b, L2] });
    B2.ctx.PTG.ob = OB.map(r => r.sku === 'RTBX616' ? Object.assign({}, r, { ppcBack: nb }) : r);
    const st = B2.flowRows().find(x => x.r.sku === 'RTBX616').s;
    ok('the line leaves PPC for "Back to sales team"', st.bucket === 'back' && !B2.flowInView('ppc', st) && B2.flowInView('back', st));
    B2.setView('back'); B2.renderFlow();
    ok('the bucket shows why, the note and "Take back into PPC"', /Master incomplete/.test(B2.els.flTable.innerHTML) && /no consumption for 5x4.5x5/.test(B2.els.flTable.innerHTML) && /Take back into PPC/.test(B2.els.flTable.innerHTML));
    ok('the other line stays in PPC', B2.flowRows().find(x => x.r.sku === 'R2').s.bucket === 'ppc');
    ok('Sales Orders lists it', B2.flowBackLines().length === 1 && B2.flowBackLines()[0].sku === 'RTBX616');
    ok('the Order Console pill says so', /Back with sales/.test(B2.flowBackPill(L1b)));
    B2.flowAgainOpen([{ orderNo: 'SHP-9', sku: 'RTBX616' }]);
    const d2 = B2.ctx.__dlg; B2.els.flagNote = { value: '' };
    ok('sending again needs a note of what was put right', /right/.test(await d2.onSave()));
    B2.els.flagNote = { value: 'consumption added' };
    ok('sent to PPC again: saved', (await d2.onSave()) === '');
    const nb2 = (B2.writes[B2.writes.length - 1] || {})['pt_orderBook/ob_shp_SHP-9_RTBX616/ppcBack'] || {};
    ok('…kept with its history, closed with who and what was done', nb2.why === 'master' && nb2.doneNote === 'consumption added' && nb2.doneBy === 'ppc@x' && (nb2.log || []).length === 2 && nb2.log[1].act === 'again', JSON.stringify(nb2));
    const L1c = Object.assign({}, L1, { ppcBack: nb2 });
    const B3 = load({ me: { tabs: ['flppc'] }, lines: [L1c] });
    ok('…and the line is back in PPC', B3.flowRows()[0].s.bucket === 'ppc' && !B3.flowIsBack(L1c));
    const B4 = load({ me: { tabs: ['flcut'] }, lines: [L2] });
    B4.flowBackOpen([B4.flowKey('SHP-9', 'R2')]);
    ok('without the PPC right nothing opens', !B4.ctx.__dlg);
  }

  console.log('\n== PPC drafts: auto-save and "Save as draft" (Ravi, 15 Oct: "window cut ho gyi to save as draft ka option and auto save") ==');
  {
    const store = {};
    const B = load({ me: { tabs: ['flppc'] }, lines: [L({ orderNo: 'AMZ-9', sku: 'S1' }), L({ orderNo: 'AMZ-9', sku: 'S2' })] });
    B.ctx.localStorage.getItem = k => (k in store ? store[k] : null);
    B.ctx.localStorage.setItem = (k, v) => { store[k] = String(v); };
    const box = (fp, k, value, type) => ({ dataset: { fp: String(fp), k }, value, type: type || 'text', checked: false, disabled: false });
    const form = [box(0, 'fabric.name', 'Sheeting 82'), box(0, 'fabric.perPc', '3.1', 'number'), box(0, 'printer.code', 'P2'),
      box(1, 'fabric.name', 'Cambric'), box(1, 'dates.cut', '2026-10-18', 'date')];
    B.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? form : [];
    const k0 = B.flowKey('AMZ-9', 'S1'), k1 = B.flowKey('AMZ-9', 'S2');
    const at = B.flowPpcDraftSave([k0, k1]);
    const kept = JSON.parse(store.ppcDraft || '{}');
    ok('what is typed is kept per line, on this computer', !!at && kept[k0].v['fabric.perPc'] === '3.1' && kept[k0].v['printer.code'] === 'P2' && kept[k1].v['dates.cut'] === '2026-10-18' && kept[k0].by === 'ppc@x', store.ppcDraft);
    ok('…and the PPC list can say "Draft saved" for those lines', B.flowPpcHasDraft(k0) && B.flowPpcHasDraft(k1) && !B.flowPpcHasDraft(B.flowKey('AMZ-9', 'S3')));
    /* The form opened again, with the suggestion in its boxes: the draft goes back in. */
    const fresh = [box(0, 'fabric.name', 'Canvas'), box(0, 'fabric.perPc', '0.5', 'number'), box(0, 'printer.code', ''), box(1, 'fabric.name', ''), box(1, 'dates.cut', '')];
    B.ctx.document.querySelector = sel => { const m = sel.match(/data-fp="(\d+)"\]\[data-k="([^"]+)"/); return m ? fresh.find(b => b.dataset.fp === m[1] && b.dataset.k === m[2]) || null : null; };
    const back = B.flowPpcDraftApply([k0, k1]);
    ok('opened again, the draft is put back into the boxes', back === at && fresh[0].value === 'Sheeting 82' && fresh[1].value === '3.1' && fresh[2].value === 'P2' && fresh[3].value === 'Cambric' && fresh[4].value === '2026-10-18');
    /* One line of that PO opened alone (or combined with another order) still finds its own draft. */
    const one = [box(0, 'fabric.name', '')];
    B.ctx.document.querySelector = sel => /data-k="fabric.name"/.test(sel) && /data-fp="0"/.test(sel) ? one[0] : null;
    B.flowPpcDraftApply([k1]);
    ok('a line opened on its own finds its own draft', one[0].value === 'Cambric');
    /* A draft from before the plan was raised is stale: the saved plan wins (17 Oct). */
    one[0].value = 'Canvas';
    ok('a draft older than the saved plan is not put back over it', B.flowPpcDraftApply([k1], ['2999-01-01T00:00:00Z']) === '' && one[0].value === 'Canvas');
    B.flowPpcDraftApply([k1], ['2000-01-01T00:00:00Z']);
    ok('…one newer than the plan still is', one[0].value === 'Cambric');
    /* A box PPC may not change (fabric on a challan) is left as it is. */
    const locked = box(0, 'fabric.name', 'Canvas'); locked.disabled = true;
    B.ctx.document.querySelector = sel => /data-k="fabric.name"/.test(sel) && /data-fp="0"/.test(sel) ? locked : null;
    B.flowPpcDraftApply([k0]);
    ok('a locked box is not overwritten by a draft', locked.value === 'Canvas');
    B.flowPpcDraftDrop([k0]);
    ok('raising the plan (or Discard) clears that line\'s draft and keeps the other', !B.flowPpcHasDraft(k0) && B.flowPpcHasDraft(k1));
    const d = JSON.parse(store.ppcDraft); d[k1].at = '2026-09-01T00:00:00Z'; store.ppcDraft = JSON.stringify(d);
    ok('a draft older than 14 days is dropped', !B.flowPpcHasDraft(k1));
    B.ctx.localStorage.setItem = () => { throw new Error('blocked'); };
    ok('blocked browser storage: no draft, and it says so (empty time)', B.flowPpcDraftSave([k0]) === '');
  }

  console.log('\n== RFD stock: the Greige Desk count replaces the old ledger (Ravi, 15 Oct: "13600 mtr fabric h but yaha 21,782") ==');
  {
    /* Sheeting 72 as it was on 15 Oct: the old ledger's 22 Sep opening less what went to printers, and the desk's count. */
    const fabRows = [
      { txnType: 'OPENING_RFD', fabricType: 'Sheeting 72', qty: 8350, state: 'RFD', createdAt: '2026-09-22T10:14:54Z', date: '22-09-2026' },
      { txnType: 'RFD_TO_PRINTER', fabricType: 'Sheeting 72', qty: 168, state: 'RFD', createdAt: '2026-10-01T09:00:00Z', date: '2026-10-01' },
      { txnType: 'RFD_TO_PRINTER', fabricType: 'Sheeting 72', qty: 40, state: 'RFD', createdAt: '2026-10-16T09:00:00Z', date: '2026-10-16' },
      { txnType: 'OPENING_RFD', fabricType: 'Cambric', qty: 500, state: 'RFD', createdAt: '2026-09-22T10:14:54Z', date: '22-09-2026' }];
    const gd = { rfdShelf: n => ({ 'SHEETING 72': 13600 })[String(n).toUpperCase()] || 0, rfdOpened: n => ({ 'SHEETING 72': '2026-10-15' })[String(n).toUpperCase()] || '' };
    const B = load({ fabRows, gd, rfd: { 'SHEETING 72': 8142, CAMBRIC: 500 } });
    const st = B.flowRfdStock('Sheeting 72');
    ok('a fabric the desk counted is that count, plus only what the old ledger moved after it (13,600 − 40), not 21,782', st === 13560, String(st));
    ok('a fabric the desk never counted is the old ledger, as before', B.flowRfdStock('Cambric') === 500, String(B.flowRfdStock('Cambric')));
    const C = load({ fabRows, rfd: { 'SHEETING 72': 8142 } });
    ok('with no Greige Desk read, the old ledger alone', C.flowRfdStock('Sheeting 72') === 8142, String(C.flowRfdStock('Sheeting 72')));
  }

  console.log('\n== RFD stock, one rule (Ravi, 16 Oct: "kal sheeting 72 ke sath bhi aaya tha please fix it permanent") ==');
  {
    const gdOk = { state: () => 'ok', rfdShelf: n => ({ 'VOIL 92': 8183 })[String(n).toUpperCase()] || 0, rfdOpened: n => ({ 'VOIL 92': '2026-10-15' })[String(n).toUpperCase()] || '' };
    const ch = { 'RFD-202610-009': { no: 'RFD-202610-009', date: '2026-10-16', lines: [{ key: 'K1', fabric: 'Voil 92', metres: 300 }] },
      'RFD-202610-002': { no: 'RFD-202610-002', date: '2026-10-12', lines: [{ key: 'K0', fabric: 'Voil 92', metres: 900 }] },
      'RFD-202610-010': { no: 'RFD-202610-010', date: '2026-10-16', cancelled: { at: 'x' }, lines: [{ key: 'K2', fabric: 'Voil 92', metres: 50 }] } };
    const A = load({ gd: gdOk, rfd: { 'VOIL 92': 0 } }); A.setFLOW(Object.assign(A.FLOW(), { ch }));
    ok('the desk\'s count less what went to printers on challans AFTER the count (8,183 − 300); the earlier challan and the cancelled one take nothing', A.flowRfdStock('Voil 92') === 7883, String(A.flowRfdStock('Voil 92')));
    const B = load({ gd: { state: () => 'err: timeout', rfdShelf: () => 0, rfdOpened: () => '' }, rfd: { 'VOIL 92': 0 }, fabRows: [{ fabricType: 'Voil 92' }] });
    ok('the desk not read on this computer: the stock is "not read", never 0 / short', B.flowFabKnown('Voil 92') === 'unread' && /stock not read — Refresh/.test(B.flowMatRow('RFD · Voil 92', 5, 0, 0, ' m', B.flowFabKnown('Voil 92'))) && !/short/.test(B.flowMatRow('RFD · Voil 92', 5, 0, 0, ' m', B.flowFabKnown('Voil 92'))));
    ok('…and the form says so at the top', /could not be read on this computer/.test(B.flowGdNote()));
    ok('a fabric the desk counted is known even if the old ledger never had it', A.flowFabKnown('Voil 92') === true);
    /* An earlier printed line whose print order is placed but whose cloth has not gone on a challan still has to take it. */
    const C = load({ gd: gdOk, rfd: {}, lines: [L({ orderNo: 'SHP-1', sku: 'V1', qty: 10 })],
      ppc: { 'SHP-1__V1': plan({ orderNo: 'SHP-1', sku: 'V1', qty: 10, fabric: { name: 'Voil 92', perPc: 5, metres: 50 } }) } });
    ok('an earlier printed line with no challan yet still holds its 50 m in the balance', C.flowCommitted([]).fab['VOIL 92'] === 50, JSON.stringify(C.flowCommitted([]).fab));
  }

  console.log('\n== part of a PO raised, the rest left in PPC (Ravi, 16 Oct: "half line plan kar liya ho to unko aage raise kar sake") ==');
  {
    const mdb = { S1: { cons: 1, fab: 'Cotton' }, S2: { cons: 1, fab: 'Cotton' } };
    const A = load({ me: { tabs: ['flppc'] }, mdb, lines: [L({ sku: 'S1' }), L({ sku: 'S2' })] });
    A.flowPpcOpen('AMZ-1');
    ok('each line of a PO has a "Raise now" tick, NOT ticked — PPC ticks what it raises (16 Oct)', (A.ctx.__dlg.html.match(/data-fpick="\d"/g) || []).length === 2 && !/data-fpick="\d" checked/.test(A.ctx.__dlg.html));
    const box = (i, k, v) => ({ addEventListener() {}, dataset: { fp: String(i), k }, type: 'select-one', value: v });
    A.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? [box(0, 'route', 'stitch'), box(1, 'route', 'stitch')] : [];
    const ticks = { 0: { checked: false }, 1: { checked: false } };
    A.ctx.document.querySelector = sel => { const m = String(sel).match(/data-fpick="(\d)"/); return m ? ticks[m[1]] : null; };
    ok('nothing ticked → refused, nothing written', /Tick at least one line/.test(await A.ctx.__dlg.onSave()) && !A.writes.length);
    ticks[0].checked = true;
    const e = await A.ctx.__dlg.onSave(), w = A.writes[A.writes.length - 1] || {};
    ok('only the ticked line is raised; the other stays in PPC', !e && !!w['pt_ppc/AMZ-1__S1'] && !w['pt_ppc/AMZ-1__S2'], e || JSON.stringify(Object.keys(w)));
    A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    ok('…and it is still in the PPC bucket', A.flowRows().find(x => x.r.sku === 'S2').s.bucket === 'ppc' && A.flowRows().find(x => x.r.sku === 'S1').s.bucket !== 'ppc');
  }

  console.log('\n== the BOM written from PPC into the master (Ravi, 16 Oct: "BOM nahi h to yanhi se likh saku or masterdata me save ho jay") ==');
  {
    const custom = [{ _key: 'RTBX616', sku: 'RTBX616', articleType: 'Tissue Box Cover', subtype: '', color: '', size: '5x4.5x5', fabric: '', consumption: 0 }];
    const master = { _key: 'm9', sku: 'S1', articleType: 'Tablecloth', subtype: 'Square Tablecloth', color: 'Red', size: '60x60', fabric: 'Cotton', consumption: 1.2 };
    const A = load({ me: { tabs: ['flppc'] }, mdbOf: s => (String(s).toUpperCase() === 'S1' ? master : null), mdbx: { custom },
      lines: [L({ orderNo: 'SHP-RBP6040', sku: 'RTBX616', qty: 1, src: 'SHP' })] });
    A.flowPpcOpen('SHP-RBP6040');
    const h = A.ctx.__dlg.html;
    ok('a SKU with no BOM gets a Master data box: what is blank, boxes for colour and subtype, "Save to master data" ticked',
      /Master data/.test(h) && /Custom SKUs list has no fabric, cloth per piece \(m\), colour, subtype/.test(h) && /data-mk="color"/.test(h) && /data-mk="subtype"/.test(h) && !/data-mk="size"/.test(h) && /data-fpms="0" checked/.test(h), h.slice(h.indexOf('Master data') - 40, h.indexOf('Master data') + 500));
    const box = (k, v) => ({ addEventListener() {}, dataset: { fp: '0', k }, type: 'text', value: v });
    A.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? [box('route', 'stitch'), box('fabric.name', 'Canvas'), box('fabric.perPc', '0.6')] : [];
    const typed = { '[data-fpm="0"][data-mk="color"]': { value: 'Coastal Blue' }, '[data-fpm="0"][data-mk="subtype"]': { value: 'Piping Tissue Box Cover' }, '[data-fpms="0"]': { checked: true } };
    A.ctx.document.querySelector = sel => typed[sel] || null;
    const e = await A.ctx.__dlg.onSave();
    const mw = A.writes.find(w => Object.keys(w).some(k => k.startsWith('pt_customSkus/'))) || {};
    ok('raised, and the blank fields go to that SKU\'s own row: fabric, m / piece, colour, subtype — the size it had is left alone',
      !e && mw['pt_customSkus/RTBX616/fabric'] === 'Canvas' && mw['pt_customSkus/RTBX616/consumption'] === 0.6 && mw['pt_customSkus/RTBX616/color'] === 'Coastal Blue'
      && mw['pt_customSkus/RTBX616/subtype'] === 'Piping Tissue Box Cover' && !('pt_customSkus/RTBX616/size' in mw) && !('pt_customSkus/RTBX616/articleType' in mw), e || JSON.stringify(mw));
    ok('…and the screen knows it at once', custom[0].fabric === 'Canvas' && custom[0].consumption === 0.6);
    const B = load({ me: { tabs: ['flppc'] }, mdbOf: s => (String(s).toUpperCase() === 'S1' ? master : null), mdbx: { custom: [] }, lines: [L({ sku: 'S1' })] });
    B.flowPpcOpen('AMZ-1');
    ok('a SKU whose master row is complete gets no box', !/data-fpms=/.test(B.ctx.__dlg.html));
    const m2 = { _key: 'm2', sku: 'S2', articleType: 'Tablecloth', subtype: 'Square Tablecloth', color: 'Red', size: '60x60', fabric: 'Cotton', consumption: 0 };
    const C = load({ me: { tabs: ['flppc'] }, mdb: { S2: { cons: 1, fab: 'Cotton' } }, mdbOf: s => (String(s).toUpperCase() === 'S2' ? m2 : null), mdbx: { custom: [] }, lines: [L({ sku: 'S2' })] });
    C.flowPpcOpen('AMZ-1');
    ok('a master row with no consumption but a cloth per piece PPC can work out from the size is NOT a missing BOM — no box, nothing written', !/data-fpms=/.test(C.ctx.__dlg.html));
  }

  console.log('\n== Cutting route, cloth already printed: no RFD (Ravi, 16 Oct: "printing required nahi h and rfd fabric bhi kam nahi hoga") ==');
  {
    const mdb = { S1: { cons: 0.25, fab: 'Sheeting 82' } };
    const A = load({ me: { tabs: ['flppc', 'fldem'] }, mdb, rfd: { 'SHEETING 82': 1000 }, lines: [L({ sku: 'S1', qty: 100 })] });
    A.flowPpcOpen('AMZ-1');
    ok('the form has the tick "Already printed / in hand — take no RFD"', /data-k="fabric\.noRfd"/.test(A.ctx.__dlg.html) && /Already printed \/ in hand — take no RFD/.test(A.ctx.__dlg.html));
    const box = (k, v, type, checked) => ({ addEventListener() {}, dataset: { fp: '0', k }, type: type || 'select-one', value: v, checked: !!checked });
    A.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? [box('route', 'stitch'), box('fabric.noRfd', '', 'checkbox', true)] : [];
    const e = await A.ctx.__dlg.onSave(), p = (A.writes[A.writes.length - 1] || {})['pt_ppc/AMZ-1__S1'];
    ok('saved: Cutting, fabric kept with its metres (100 × 0.25), marked in hand', !e && p && p.route === 'stitch' && p.fabric.name === 'Sheeting 82' && p.fabric.metres === 25 && p.fabric.noRfd === true, e || JSON.stringify(p && p.fabric));
    A.setFLOW(Object.assign(A.FLOW(), { ppc: Object.assign({}, A.FLOW().ppc) }));
    const st = A.flowRows()[0].s;
    ok('…so it does not wait in Demand → RFD, and goes on to Cutting / the store', !st.needFab && st.bucket !== 'demand' && !A.flowInView('drfd', st), st.bucket);
    ok('…and holds no RFD for itself in any later plan', !A.flowCommitted([]).fab['SHEETING 82']);
    const cutHtml = A.flowTable('cut', A.flowRows());
    ok('To cut says what it is cut from: Sheeting 82, printed, in hand, 25 m — not "—"', /<b>Sheeting 82<\/b>/.test(cutHtml) && /printed, in hand/.test(cutHtml) && /25 m for 100 pcs/.test(cutHtml), cutHtml.slice(0, 900));
    ok('To cut says how many pieces are still to cut — on the line and in a total on top (100 pcs, none cut yet)', /Pending to cut/.test(cutHtml) && /Cutting pending: <b>100 pcs<\/b> on 1 line/.test(cutHtml) && /<b style="font-size:15px">100<\/b> pcs/.test(cutHtml), cutHtml.slice(0, 1200));
    const B = load({ me: { tabs: ['flppc'] }, mdb, lines: [L({ sku: 'S1', qty: 100 })] });
    B.flowPpcOpen('AMZ-1');
    B.ctx.document.querySelectorAll = sel => sel === '[data-fp]' ? [box('route', 'inhouse'), box('printer.code', 'P1'), box('fabric.noRfd', '', 'checkbox', true)] : [];
    await B.ctx.__dlg.onSave();
    const q = (B.writes[B.writes.length - 1] || {})['pt_ppc/AMZ-1__S1'] || {};
    ok('the tick means nothing on the Printing route: the RFD is raised as usual', q.route === 'inhouse' && !(q.fabric || {}).noRfd && (q.fabric || {}).metres === 25, JSON.stringify(q.fabric));
  }

  console.log('\n== demand is what is still to make (Ravi, 17 Oct: "kitna pcs cut ho chuka h wo sara track kare jisase demand jayada generate n ho") ==');
  {
    const mdb = { S1: { cons: 0.25, fab: 'Sheeting 82' } };
    const pl = route => plan({ sku: 'S1', qty: 1200, route, print: { need: route === 'inhouse' }, fabric: { name: 'Sheeting 82', perPc: 0.25, metres: 300 } });
    const A = load({ me: { admin: true }, mdb, rfd: { 'SHEETING 82': 2000 }, lines: [L({ sku: 'S1', qty: 1200, cutReq: true, cut: 110 })], ppc: { 'AMZ-1__S1': pl('stitch') } });
    const st = A.flowRows()[0].s;
    ok('Cutting route, 110 of 1,200 cut → Demand asks for the other 1,090 pcs: 272.5 m, not 300', A.flowRfdCover().line['AMZ-1__S1'].need === 272.5, JSON.stringify(A.flowRfdCover().line['AMZ-1__S1']));
    ok('…and a later plan sees 272.5 m held for it, not 300', A.flowCommitted(['X']).fab['SHEETING 82'] === 272.5, String(A.flowCommitted(['X']).fab['SHEETING 82']));
    const B = load({ me: { admin: true }, mdb, rfd: { 'SHEETING 82': 2000 }, lines: [L({ sku: 'S1', qty: 1200, cutReq: true, cut: 110 })], ppc: { 'AMZ-1__S1': pl('inhouse') } });
    ok('Printing route, 110 cut from cloth that came another way → only 1,090 pcs of cloth still to send (272.5 m)', B.flowFabOwed({ qty: 1200 }, B.flowRows()[0].s).metres === 272.5, JSON.stringify(B.flowFabOwed({ qty: 1200 }, B.flowRows()[0].s)));
    const C = load({ me: { admin: true }, mdb, lines: [L({ sku: 'S1', qty: 1200, cutReq: true, cut: 1200 })], ppc: { 'AMZ-1__S1': pl('stitch') } });
    ok('all cut → nothing waits in Demand → RFD', !C.flowRows()[0].s.needFab && C.flowRows()[0].s.bucket !== 'demand');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
