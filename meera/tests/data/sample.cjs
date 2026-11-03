/* PHASE 7 SAMPLE FACTORY — made-up data, never the live database (Ravi: "Build with SAMPLE data in the offline copy
 * first. Do not read live data without asking"). The test bench's clock is 29 Oct 2026, 10:30.
 *
 * install(M, { tabs, admin, missing }) puts into the bench's page what the ERP would hold in memory after its screens were
 * opened — PT.base (Job Work), PTE.emp (karigars), PTG.mdb (SKUs), the Order Console's lines (ordLines), FGI (store),
 * QC.checks — and, in place of the ERP's own helpers, small stand-ins that follow the same rules (ordWaitingAt's
 * "Waiting at" words, ordKarigarsOf, ordEvents, fgiOf, repRecvParts, mobMay).
 * Every function that SAVES or READS the database is replaced by a counter (M.ctx.__touched), so a test can prove
 * Phase 7 never calls one. RAW is the same data, plain, for working out the right answers separately. */
const DAY = 864e5, NOW = Date.parse('2026-10-29T05:00:00Z');
const p2 = n => String(n).padStart(2, '0');
const stamp = ms => { const d = new Date(ms); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const ago = (days, hh = 11, mm = 0) => { const d = new Date(NOW - days * DAY); d.setHours(hh, mm, 0, 0); return d.getTime(); };

const KARIGARS = ['Raju Kumar', 'Raju Singh', 'Imran Ali', 'Sunita Devi', 'Mohan Lal', 'Suresh Yadav', 'Farida Begum', 'Ramesh Prasad'];
const SKUS = ['CPC008-04', 'CPC008-06', 'CPC008-08', 'RTBX72', 'RQL354-K', 'RBC101-S', 'RBC101-M', 'CPC210-02'];
/* the Order Console's lines: qty, and how far each got */
const LINES = [
  { orderNo: 'AMZ-16092026-02', sku: 'CPC008-04', qty: 60, orderDate: '16/09/2026', given: 60, back: 60, cutReq: true, cut: 60, issued: 60, received: 35, pressed: 35 },
  { orderNo: 'AMZ-16092026-02', sku: 'CPC008-06', qty: 40, orderDate: '16/09/2026', given: 40, back: 40, cutReq: true, cut: 40, issued: 40, received: 40, pressed: 22 },
  { orderNo: 'AMZ-25102026-01', sku: 'RTBX72', qty: 120, orderDate: '25/10/2026', given: 120, back: 70, cutReq: true, cut: 50, issued: 0, received: 0, pressed: 0 },
  { orderNo: 'SHP-RBP7620', sku: 'RQL354-K', qty: 2, orderDate: '20/10/2026', given: 0, back: 0, cutReq: true, cut: 2, issued: 2, received: 0, pressed: 0 },
  { orderNo: 'SHP-1001', sku: 'RBC101-S', qty: 1, orderDate: '27/10/2026', given: 0, back: 0, cutReq: true, cut: 0, issued: 0, received: 0, pressed: 0 },
  { orderNo: 'B2B-20102026-01', sku: 'RBC101-M', qty: 200, orderDate: '20/10/2026', given: 0, back: 0, cutReq: true, cut: 200, issued: 150, received: 90, pressed: 60 },
  { orderNo: 'LEG-17102026-01', sku: 'CPC210-02', qty: 80, orderDate: '17/10/2026', given: 0, back: 0, cutReq: true, cut: 80, issued: 80, received: 80, pressed: 80 },
  { orderNo: 'SPY-28102026-03', sku: 'CPC008-08', qty: 30, orderDate: '28/10/2026', given: 30, back: 0, cutReq: true, cut: 0, issued: 0, received: 0, pressed: 0 },
];
/* Job Work entries: who was given what, and what came back (receipts) */
const BASE = [
  { id: 'jw1', empName: 'Raju Kumar', sku: 'CPC008-04', orderNo: 'AMZ-16092026-02', issuePieces: 35, issueAt: ago(9), recv: [[ago(6), 20]] },
  { id: 'jw2', empName: 'Imran Ali', sku: 'CPC008-04', orderNo: 'AMZ-16092026-02', issuePieces: 25, issueAt: ago(9), recv: [[ago(7), 15]] },
  { id: 'jw3', empName: 'Sunita Devi', sku: 'CPC008-06', orderNo: 'AMZ-16092026-02', issuePieces: 40, issueAt: ago(10), recv: [[ago(7), 40]] },
  { id: 'jw4', empName: 'Raju Singh', sku: 'RQL354-K', orderNo: 'SHP-RBP7620', issuePieces: 2, issueAt: ago(3), recv: [] },
  { id: 'jw5', empName: 'Mohan Lal', sku: 'RBC101-M', orderNo: 'B2B-20102026-01', issuePieces: 100, issueAt: ago(4), recv: [[ago(1), 50], [ago(0, 9, 40), 30]] },
  { id: 'jw6', empName: 'Raju Kumar', sku: 'RBC101-M', orderNo: 'B2B-20102026-01', issuePieces: 30, issueAt: ago(0, 9, 15), recv: [[ago(0, 10, 5), 10]] },
  { id: 'jw7', empName: 'Farida Begum', sku: 'RBC101-M', orderNo: 'B2B-20102026-01', issuePieces: 20, issueAt: ago(0, 10, 0), recv: [], rejection: 0 },
  { id: 'jw8', empName: 'Suresh Yadav', sku: 'CPC210-02', orderNo: 'LEG-17102026-01', issuePieces: 80, issueAt: ago(12), recv: [[ago(8), 78]], rejection: 2 },
];
const STOCK = { 'CPC008-04': { current: 34, pending: 5 }, 'CPC008-06': { current: 0, pending: 0 }, 'CPC008-08': { current: 12, pending: 0 }, RTBX72: { current: 210, pending: 0 },
  'RQL354-K': { current: 3, pending: 1 }, 'RBC101-S': { current: 0, pending: 0 }, 'RBC101-M': { current: 18, pending: 0 }, 'CPC210-02': { current: 80, pending: 0 } };
/* QC checks: today's passed, and yesterday's (not today) */
const CHECKS = [{ baseId: 'jw5', date: stamp(ago(0, 10, 10)), ok: 25, checked: 26 }, { baseId: 'jw1', date: stamp(ago(0, 9, 50)), ok: 18, checked: 20 },
  { baseId: 'jw5', date: stamp(ago(1, 16, 0)), ok: 40, checked: 40 }, { baseId: null, refId: 'ret1', date: stamp(ago(0, 9, 0)), ok: 6, checked: 6 }];
/* the last work on each order (the Order Console's events) */
const LAST = { 'AMZ-16092026-02': { ms: ago(6), by: 'Raju Kumar', kind: 'received' }, 'AMZ-25102026-01': { ms: ago(1), by: 'Store', kind: 'cut' },
  'SHP-RBP7620': { ms: ago(3), by: 'Raju Singh', kind: 'issued' }, 'B2B-20102026-01': { ms: ago(0, 10, 5), by: 'Raju Kumar', kind: 'received' },
  'LEG-17102026-01': { ms: ago(8), by: 'Suresh Yadav', kind: 'received' }, 'SPY-28102026-03': { ms: ago(1), by: 'Printer Shree', kind: 'given to printer' } };

const left = b => b.issuePieces - b.recv.reduce((a, r) => a + r[1], 0) - (b.rejection || 0);
const open = l => l.pressed < l.qty;
/** the Order Console's "Waiting at" words, by its rules (orders/vendor-holdings.js ordWaitingAt) */
function waitingAt(l) {
  if (!open(l)) return 'Complete';
  if (l.given > l.back && l.cut < l.given) return 'Vendor — ' + (l.given - l.back).toLocaleString('en-IN') + ' to come back';
  const pendingCut = l.cutReq ? Math.max(0, Math.min(l.qty, l.given || l.qty) - l.cut) : 0;
  if (pendingCut > 0) return 'Cutting — ' + pendingCut.toLocaleString('en-IN') + ' to cut';
  if (l.issued < l.qty) return 'Issue — ' + (l.qty - l.issued).toLocaleString('en-IN') + ' not given to a karigar';
  if (l.received < l.issued) return 'Karigar — ' + (l.issued - l.received).toLocaleString('en-IN') + ' out';
  if (l.pressed < l.received) return 'QC — ' + (l.received - l.pressed).toLocaleString('en-IN') + ' to check';
  return 'Ready to hand over to shipping';
}
/* the Master Database rows (made up) — with a cost value and a maker that Meera must never show */
const MASTER = {
  'CPC008-04': { brand: 'CPC', articleType: 'Cushion Cover', color: 'Beige', size: '16x16', packOf: 5, fabric: 'Cotton Duck', cuttingRequired: true, consumption: 0.45,
    isZip: true, chainLength: '14 in', zipQty: 1, isPiping: true, pipingMeters: 1.6, pipingFabric: 'Cotton Duck', asin: 'B0CPC00804', parentAsin: 'B0CPC008PA', listingStatus: 'Active',
    inventoryValuationPrice: 187.5, manufacturer: 'Shree Ganesh Textiles' },
  'RTBX72': { brand: 'Ridhi', articleType: 'Table Runner', color: 'Red', size: '13x72', packOf: 1, fabric: 'Linen Blend', cuttingRequired: true, consumption: 0.6, isRuffle: true, ruffleMeters: 4, ruffleFabric: 'Linen Blend',
    asin: 'B0RTBX7200', listingStatus: 'Inactive', inventoryValuationPrice: 240, manufacturer: 'Jai Ambe Prints' },
  'RQL354-K': { brand: 'Ridhi', articleType: 'Quilt', size: 'King', fabric: 'Mulmul', consumption: 5.2, fillerFabricRequired: true, standardFillingQty: '1.8 kg', inventoryValuationPrice: 1450, manufacturer: 'Om Quilts' },
};
const FABRIC_WIDTHS = [{ fabric: 'Cotton Duck', widthIn: 58 }, { fabric: 'Linen Blend', widthIn: 54 }, { fabric: 'Mulmul', widthIn: 44 }];
const RAW = { NOW, DAY, KARIGARS, SKUS, LINES, MASTER, FABRIC_WIDTHS, BASE, STOCK, CHECKS, LAST, left, open, waitingAt, stamp, ago, today: stamp(NOW).slice(0, 10) };

/** the functions that save to the database, read it, or start a screen's own reading — each a counter here */
const TOUCH = ['ptPut', 'ptPatch', 'ptCas', 'ptDelete', 'ptAuditWrite', 'setDoc', 'addDoc', 'deleteDoc', 'saveShopMeta', 'baseAutoMove', 'baseArchiveRun', 'flowGuard', 'flowClaim',
  'ptGet', 'ptLoadGates', 'ptLoadEmp', 'fgiLoad', 'flowLoad', 'ensureOrd', 'ensureQc', 'ensureAdj', 'ptOpenFresh'];
function install(M, o = {}) {
  const c = M.ctx;
  c.__touched = [];
  TOUCH.forEach(n => { c[n] = (...a) => { c.__touched.push(n); return Promise.resolve(null); }; });
  c.__opened = [];
  c.showTab = t => c.__opened.push('tab:' + t);
  c.ordJourney = no => c.__opened.push('order:' + no);
  c.mobSearchOpen = id => c.__opened.push('search:' + id);
  c.mobSkuSheet = s => c.__opened.push('sku:' + s);
  c.ME = { email: 'sample@local', admin: o.admin !== false && !o.tabs, tabs: o.tabs || [] };
  c.mobMay = t => { if (!t) return true; const ME = c.ME; if (!ME || !ME.tabs || !ME.tabs.length) return true; if (ME.tabs.includes(t)) return true;
    if (t === 'ord' && ME.tabs.includes('shopprod')) return true; if (t === 'shop' && ME.tabs.includes('shopret')) return true; return false; };
  const miss = new Set(o.missing || []);
  c.PTE = { emp: KARIGARS.map(n => ['Karigar', n, 'Stitching', '']) };
  c.PT = { base: miss.has('pbase') ? null : BASE.map(b => ({ id: b.id, empName: b.empName, empType: 'Karigar', sku: b.sku, orderNo: b.orderNo, issuePieces: b.issuePieces, issueDate: stamp(b.issueAt),
    receivedPieces: b.recv.reduce((a, r) => a + r[1], 0), rejectionPieces: b.rejection || 0, pendingPieces: left(b), receipts: b.recv.map(([ms, qty]) => ({ at: stamp(ms), qty })) })),
    at: { mdb: '', base: miss.has('pbase') ? '' : '29 Oct, 10:12', cut: '' } };
  c.PTG = { mdb: miss.has('pmdb') ? null : SKUS.map(s => ({ sku: s, ...(MASTER[s] || {}) })), ob: miss.has('ord') ? null : [], at: miss.has('ord') ? 0 : ago(0, 10, 20) };
  c.mdbOf = s => (c.PTG.mdb || []).find(r => r.sku === String(s).toUpperCase()) || null;
  c.ptFabricWidths = () => FABRIC_WIDTHS.slice();
  c.QC = { checks: miss.has('qc') ? null : CHECKS.slice(), at: miss.has('qc') ? '' : '29 Oct, 10:15' };
  c.FGI = { rows: miss.has('fgi') ? null : [], at: miss.has('fgi') ? '' : '29 Oct, 09:55' };
  c.ORD_PIPE_STALE_DAYS = 5;
  c.ordLines = () => LINES.map(l => ({ ...l, open: open(l) }));
  c.ordWaitingAt = r => waitingAt(r);
  c.ordKarigarsOf = no => { const m = new Map(); BASE.filter(b => b.orderNo === no && left(b) > 0).forEach(b => m.set(b.empName, (m.get(b.empName) || 0) + left(b))); return m; };
  c.ordEvents = () => ({ last: new Map(Object.entries(LAST)), list: [] });
  c.fgiOf = s => STOCK[String(s).toUpperCase()] || { current: 0, pending: 0 };
  c.ptDtMs = s => { const m = String(s || '').match(/^(\d\d)\/(\d\d)\/(\d{4})(?:, (\d\d):(\d\d))?/); return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0; };
  c.repRecvParts = r => (r.receipts || []).map(x => ({ ms: c.ptDtMs(x.at), pcs: x.qty }));
  c.obUC = s => String(s || '').toUpperCase();
}
module.exports = { install, RAW, TOUCH };
