/* The made-up India store the store-alloc and fba-repeat suites run the app's own screens against.
 *   FGA_MUT_FILE=<path under src/app> FGA_MUT_SRC=<file> loads a broken copy of one app file (the teeth do this). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const mutated = f => (process.env.FGA_MUT_FILE && path.resolve(f) === path.resolve(APP, process.env.FGA_MUT_FILE) ? process.env.FGA_MUT_SRC : f);
const appFile = f => fs.readFileSync(mutated(path.join(APP, f)), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' - ' + extra : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cut = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('not found: ' + from); return src.slice(a, b); };
const line = (f, start) => cut(appFile(f), start, '\n') + '\n';
const whole = (f, name) => { const t = appFile(f), i = t.search(new RegExp('^(async )?function ' + name + '\\(', 'm')); if (i < 0) throw new Error(name + ' not found in ' + f); return t.slice(i, t.indexOf('\n}', i) + 2) + '\n'; };

/* the app's own small rules, taken from their files so they cannot drift */
const HELPERS = () => line('inventory/amazon-listing-status.js', 'const lstKey') + line('inventory/finished-goods.js', 'const fgiNum')
  + line('core/gates.js', 'const obUC') + whole('orders/vendor-holdings.js', 'fgiOutParts') + whole('orders/vendor-holdings.js', 'ordSrcOf')
  + whole('core/history.js', 'ptSame') + line('inventory/fba-dispatch.js', 'const fbaLegacy') + whole('inventory/fba-dispatch.js', 'fbaState')
  + whole('replenishment/replenishment.js', 'applyStatus') + whole('replenishment/replenishment.js', 'replReq')
  + cut(appFile('inventory/finished-goods.js'), '/** The pack the Master Database records', 'const fgiMaster')
  + line('orders/shopify-pipeline-team.js', 'const ORD_PLAT_SRC') + whole('orders/production-to-shipping.js', 'pdIso')
  + line('shopify/shopify-orders.js', 'const soAcctName') + whole('inventory/amazon-listing-status.js', 'lstOf')
  + cut(appFile('orders/vendor-holdings.js'), 'let ORD_ND', 'function ordFilters') + line('orders/raise-sales-order.js', 'const soModeOf')
  + line('orders/sales-orders.js', 'const soShipMode') + whole('inventory/fg-fba-repeat.js', 'fapDayOf');

/* What Amazon says about A: 'listed' (default), 'inactive', 'not', 'unknown' (never fetched) or 'unread' (the read failed). */
const listing = st => ({ err: st === 'unread' ? 'no signal' : '', map: new Map(st === 'unknown' ? [] : st === 'not' ? [['OTHER', { active: true }]]
  : [['A', { active: st !== 'inactive' }]]) });

const NOW = Date.now(), HOUR = 3600000, iso = ms => new Date(ms).toISOString();
const row = (id, txnType, qty, over) => Object.assign({ _id: id, txnType, sku: 'A', qty, createdAt: iso(NOW - 5 * HOUR) }, over);
const sent = (id, qty, over) => row(id, 'FBA', qty, Object.assign({ issuedFor: 'Ridhi FBA' }, over));
const ordLine = (orderNo, qty, over) => Object.assign({ orderNo, sku: 'A', qty }, over);
/* need: { SP: [air, sea, awd], CPC: [...] } in packs; age in hours of the Amazon figures */
const needNode = (need, age) => Object.fromEntries(['SP', 'CPC'].map(s => [s, { snapAt: NOW - (age || 1) * HOUR, at: NOW, by: 'p', skus: need[s] ? { A: need[s] } : {} }]));

/* A store: by default 20 of A; a sales order needs 4 (Custom 4), the website 2; FBA asks Air 3, Sea 4 (SP) and AWD 2 (CPC).
 * So: Custom 6, Air 3, Sea 4, AWD 2, Excess 5, FBA free 9.
 * sales: the sales orders as read; none by default, so no line is New development. */
function store(o) {
  o = o || {};
  const writes = [], patches = [], boxes = {}, nothing = () => {}, warns = [], asked = [], reads = [];
  const db = {
    _shopHold: { SP: { at: o.holdAt || NOW, skus: { A: o.web === undefined ? 2 : o.web } }, CPC: { at: o.holdAt || NOW, skus: {} }, releases: o.releases || {} },
    _fbaNeed: o.noNeed ? undefined : needNode(o.need || { SP: [3, 4, 0], CPC: [0, 0, 2] }, o.age),
    _fbaRepeat: o.requests,
  };
  const at = p => p.split('/').slice(1).reduce((v, k) => (v == null ? v : v[k]), db);
  const set = (p, v) => { const seg = p.split('/').slice(1); let n = db; seg.slice(0, -1).forEach(k => { n = n[k] = n[k] || {}; }); n[seg[seg.length - 1]] = v; };
  const copy = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', innerHTML: '', className: '', checked: false, dataset: {}, classList: { toggle: nothing, add: nothing, remove: nothing } });
  const saved = { 'storeAlloc': o.ls === undefined ? '1' : o.ls, 'shopHold': o.hold === undefined ? '1' : o.hold };
  const ledger = o.rows || [row('O', 'OPENING', 20)];
  const lines = o.lines || [ordLine('B2B-1', 4)];
  const write = async p => { if (o.writeFails) throw new Error('offline'); writes.push(p); patches.push(p); Object.entries(p).forEach(([k, v]) => { if (k.startsWith('pt_fgiSettings/')) set(k, copy(v)); }); };
  const ctx = {
    console: { warn: (...a) => warns.push(a.join(' ')) }, $: box, nf: String, esc: String, window: o.testSite ? { __TEST_ERP: {} } : {},
    localStorage: { getItem: k => { if (o.lsBlocked) throw new Error('blocked'); return saved[k] === undefined ? null : saved[k]; }, setItem: (k, v) => { saved[k] = v; } },
    ME: { email: 'store@test', admin: o.admin !== false },
    FGI: { rows: ledger.slice(), set: { _shopHold: copy(db._shopHold), _fbaNeed: copy(db._fbaNeed) || undefined }, err: '' },
    PTG: { mdb: [{ sku: 'A' }] }, mdbOf: () => (o.pack ? { packOf: o.pack } : {}), obPcsPerPack: () => o.rulePack || 1,
    ordLines: () => lines, fgiRowId: r => r._id,
    ptGetFresh: async p => { if (o.unread && p.includes(o.unread)) throw new Error('no signal'); return copy(at(p)); },
    ptCas: async (p, expect, next) => { if (o.refused) return 'refused'; if (o.before) { const b = o.before; o.before = null; b(set); } if (!same(copy(at(p)), copy(expect))) return 'changed'; set(p, copy(next)); writes.push({ p }); return ''; },
    ptGet: async p => { reads.push(p); if (p === 'pt_salesOrders') { if (o.salesDown) throw new Error('permission denied'); return copy(o.sales); }
      if (o.ledgerDown) throw new Error('no signal'); return p === 'pt_fgiLedger' ? (o.fresh || ledger) : ledger.find(r => p.endsWith('/' + r._id)); },
    LST: listing(o.listing), lstLoad: async () => { reads.push('listings'); },
    ptList: v => Object.values(v || {}), ptReadReg: async r => { reads.push(r); if (o.bookDown) throw new Error('no book'); },
    ptPatch: write, ptPut: async (p, v) => write({ [p]: v }),
    prGet: async p => { asked.push(p); if (o.askFails) throw new Error('backend down'); }, replFull: () => o.planner !== false,
    fgiNewId: p => p + '-new', fbaBadge: nothing, fgiOverBadge: nothing, renderFgi: nothing, renderCx: nothing, renderOrd: nothing, shpbAfter: nothing,
    lstAlertFor: async () => '', fgiCanEntry: () => true, fgiCanEdit: () => true, FGI_FBA_ACCOUNTS: ['Ridhi FBA'], fgiOutTxt: () => '', lineHoldOn: () => false,
    fgiOutAlloc: () => ({ orders: o.alloc || [], loose: 0 }), fgiOutOrderCheck: () => ({ fields: o.alloc ? { orders: o.alloc } : {} }),
  };
  ctx.fgiEffect = r => (r.txnType === 'OPENING' || r.txnType === 'FBA_RETURN' ? r.qty : -r.qty);
  ctx.fgiStock = () => { const by = new Map(); ctx.FGI.rows.forEach(r => { const b = by.get(r.sku) || { current: 0 }; b.current += ctx.fgiEffect(r); by.set(r.sku, b); }); return by; };
  ctx.fgiOf = sku => ctx.fgiStock().get(String(sku).trim().toUpperCase()) || { current: 0 };
  vm.createContext(ctx);
  vm.runInContext(HELPERS() + appFile('inventory/fg-shop-hold.js') + appFile('inventory/fg-store-alloc.js')
    + appFile('inventory/fg-store-newdev.js') + whole('inventory/finished-goods.js', 'fgiStockReread'), ctx);
  const run = code => vm.runInContext(code, ctx);
  if (o.sales) run(`FGA_SALES = { rows: ${JSON.stringify(o.sales)}, err: '' }`);
  const shares = (current, view) => copy(run(`fgaShares("A", ${current === undefined ? 'fgiOf("A").current' : current}, fgiHoldNode(), fgaBook()${view ? ', ' + JSON.stringify(view) : ''})`));
  return { ctx, run, writes, patches, box, db, warns, asked, reads, saved, shares, free: () => run('fgiFbaFree("A")') };
}
const split = (photo, custom, air, sea, awd, excess) => ({ photo, custom, air, sea, awd, excess });
const issueWhy = (S, qty, orders) => S.run(`fgaIssueRefusal([{ sku: "A", qty: ${qty}, orders: ${JSON.stringify(orders || [])} }])`);
const forOrder = (no, qty) => [{ orderNo: no, qty }];

const KINDS = { ISSUE: { dir: -1 }, FBA: { dir: -1 }, RECEIVE: { dir: 1 } };
const scanHead = t => ({ t, k: KINDS[t], err: '', date: '27/11/2026', who: 'x', hand: '', orderNo: '', orderSource: '', extFrom: '' });
/* Each way out of the store: q pieces of A, as type t (where the screen has a type), for the order(s) in o.alloc. */
const WAYS = {
  'entry form': { types: ['ISSUE', 'FBA'], go: async (o, q, t) => {
    const S = store(o);
    S.ctx.FGI_KINDS = KINDS;
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('inventory/fg-other-movements.js', 'fgiEntrySave'));
    Object.entries({ fgmType: t, fgmSku: 'A', fgmQty: String(q), fgmWho: 'x', fgmFbaAcct: 'Ridhi FBA' }).forEach(([k, v]) => { S.box(k).value = v; });
    return { S, said: await S.ctx.fgiEntrySave() };
  } },
  'scan, entered as scanned': { types: ['ISSUE', 'FBA'], go: async (o, q, t) => {
    const S = store(o);
    Object.assign(S.ctx, { FGS: { rows: new Map([['A', { sku: 'A', qty: q }]]) }, fgiScanHead: () => scanHead(t) });
    S.run(whole('inventory/fg-scanning.js', 'fgiScanFlush'));
    return { S, said: await S.ctx.fgiScanFlush('A') };
  } },
  'scan, Save all': { types: ['ISSUE', 'FBA'], go: async (o, q, t) => {
    const S = store(o);
    Object.assign(S.ctx, { FGS: { rows: new Map([['A', { sku: 'A', qty: q }]]), unknown: new Map() }, fgiScanAuto: () => false, fgiScanHead: () => scanHead(t) });
    S.run(whole('inventory/fg-scanning.js', 'fgiScanSave'));
    return { S, said: await S.ctx.fgiScanSave() };
  } },
  'Excel issue': { types: ['ISSUE'], go: async (o, q) => {
    const S = store(o);
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('inventory/fg-receive-excel.js', 'fgiRecvXlSave'));
    S.ctx.FGI_XL = { kind: 'ISSUE', bad: [], good: [{ rec: row('X', 'ISSUE', q, { orders: o.alloc }) }] };
    return { S, said: await S.ctx.fgiRecvXlSave() };
  } },
  'complete from stock': { types: ['ISSUE'], order: 'B2B-1', go: async (o, q) => {
    const S = store(o);
    Object.assign(S.ctx, { ordStockCan: () => true, ordIsMto: () => false, ordStockOwed: () => 99, ordStockRows: () => [{ id: 'k' }] });
    S.ctx.PTG.ob = [];
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('orders/complete-from-stock.js', 'ordStockSave'));
    S.ctx.l = { orderNo: (o.alloc || [{ orderNo: 'NONE' }])[0].orderNo, sku: 'A' };
    return { S, said: await S.run(`ordStockSave(l, { pcs: ${q} })`) };
  } },
  'SHP board': { types: ['ISSUE'], order: 'B2B-1', go: async (o, q) => {
    const S = store(o);
    Object.assign(S.ctx, { shpbKey: () => 'k', shpbStages: () => ({ stk: 0, prsD: 0 }), shpReceive: async () => '', shpCanReceive: () => true, spOf: () => null, SHPB: { ready: {} }, SHPB_NODE: 'pt_x' });
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + whole('orders/shp-board.js', 'shpbStockSave'));
    S.ctx.r = { orderNo: (o.alloc || [{ orderNo: 'NONE' }])[0].orderNo, sku: 'A', qty: 99 };
    return { S, said: await S.run(`shpbStockSave(r, { pcs: ${q} })`) };
  } },
  'Customer Orders': { types: ['ISSUE'], noOrder: true, go: async (o, q) => {
    const S = store(o);
    Object.assign(S.ctx, { CX: { rows: [{ id: 'c', sku: 'A', qty: q, orderNo: 'B2B-1' }] }, cxIndia: () => 20 });
    S.run(whole('orders/customer-orders.js', 'cxFromIndia'));
    return { S, said: await S.ctx.cxFromIndia('c') };
  } },
  'packing list Finish': { types: ['FBA'], go: async (o, q) => {
    const S = store(o);
    Object.assign(S.ctx, { fgiOutOrders: () => [] });
    S.run(whole('inventory/fg-other-movements.js', 'fgiOutCheck') + appFile('replenishment/pack-core.js'));
    S.ctx.list = { id: 'P', date: '2026-11-27', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: 'A', qty: q }] }] };
    return { S, said: (await S.run('packLedgerWrite(list, "")')).err || '' };
  } },
};

function editStore(o) {
  const S = store(o);
  Object.assign(S.ctx, { FGI_KINDS: KINDS, fgiIsMarker: () => false, fgiEditLocked: () => '', ptIsoDate: () => '', fgiOrdersFor: () => [] });
  S.run(whole('inventory/fg-corrections.js', 'fgiEditApply'));
  return S;
}
const movement = (txnType, qty, over) => row('F', txnType, qty, Object.assign({ issuedFor: 'x', date: '27/11/2026' }, over));

module.exports = { fs, path, vm, APP, appFile, same, cut, line, whole, NOW, HOUR, iso, row, sent, ordLine, needNode, store, split, issueWhy, forOrder, KINDS, scanHead, WAYS, editStore, movement, counts: () => ({ pass, fail }), check: ok };
