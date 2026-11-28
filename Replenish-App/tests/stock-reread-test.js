/* Every stock-out save checks the India store as it is now, not as the screen read it earlier
 * (src/app/inventory/finished-goods.js — fgiStockReread, and the saves that ask it).
 * Ravi, 26 Nov: two screens both saw 4 pieces and both sent 4 out. Switch "lineHold" on: the ledger is read again just before the
 * stock check; if it cannot be read, nothing is saved. Off, nothing changes. Cases are made up.
 *   node tests/stock-reread-test.js      (STOCK_APP=<folder like src/app> tests another copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.STOCK_APP || path.join(__dirname, '..', 'src', 'app');
const src = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
/** One function, cut out of a file as it stands: from its first line to the closing brace at the margin. */
function cut(file, name) {
  const s = src(file), i = s.search(new RegExp('^(async )?function ' + name + '\\(', 'm'));
  if (i < 0) throw new Error(name + ' not found in ' + file);
  return s.slice(i, s.indexOf('\n}', i) + 2);
}

const SKU = 'MADE-UP-1';
const row = (id, txnType, qty) => ({ _id: id, txnType, sku: SKU, qty });
const SCREEN = () => [row('OPN-1', 'OPENING', 4)];                                  // what this screen read: 4 pieces
const NOW = () => [row('OPN-1', 'OPENING', 4), row('ISS-other', 'ISSUE', 4)];        // the database: another PC took them

/** The app around one save. world: { on, fail, stale } */
function app(file, name, world, extra) {
  const writes = [], boxes = {};
  const box = id => boxes[id] || (boxes[id] = { value: '', textContent: '', className: '', checked: false, dataset: {} });
  const nothing = () => {};
  const ctx = Object.assign({
    console: { warn: nothing, log: console.log }, $: box, nf: String, obUC: s => String(s || '').trim().toUpperCase(), ME: { email: 'store@test', admin: true },
    localStorage: { getItem: k => (k === 'lineHold' && world.on ? '1' : null) },
    shpHoldKey: k => String(k).toUpperCase(),
    ptGet: async () => { if (world.fail) throw new Error('offline'); return world.stale ? SCREEN() : NOW(); },
    ptList: v => v, FGI: { rows: SCREEN() },
    ptPatch: async p => { writes.push(p); }, ptPut: async (p, v) => { writes.push({ [p]: v }); },
    fgiNum: v => parseFloat(v) || 0, fgiNewId: p => p + '-new', fbaBadge: nothing, fgiOverBadge: nothing, renderFgi: nothing,
    lstAlertFor: async () => '', fgiCanEntry: () => true, FGI_NO_ENTRY: 'no right',
    fgiOutAlloc: () => ({ orders: [], loose: 0 }),
  }, extra || {});
  ctx.fgiOf = () => ({ current: ctx.FGI.rows.reduce((t, r) => t + (r.txnType === 'OPENING' ? r.qty : -r.qty), 0) });
  vm.createContext(ctx);
  vm.runInContext([cut('core/history.js', 'lineHoldOn'), cut('inventory/finished-goods.js', 'fgiStockReread'),
    cut('inventory/fg-other-movements.js', 'fgiOutCheck'), file ? cut(file, name) : ''].join('\n'), ctx);
  return { ctx, writes, box };
}

/* Each save: how to set its screen up, and how to press it. `said` is whatever the person is shown. */
const KINDS = { ISSUE: { dir: -1 }, FBA: { dir: -1 }, RECEIVE: { dir: 1 } };
const head = { t: 'ISSUE', k: KINDS.ISSUE, err: '', date: '26/11/2026', who: 'Sample room', hand: '', orderNo: '', orderSource: '', extFrom: '' };
const SAVES = [
  { title: 'Scan to pack / Pack & verify — Finish', run: async w => {
    const a = app(null, null, w);
    Object.assign(a.ctx, { FGI_FBA_ACCOUNTS: ['Ridhi FBA'], packDataReady: async () => '', fgiOutOrders: () => [] });
    vm.runInContext(src('replenishment/pack-core.js'), a.ctx);
    const list = { id: 'PK1', date: '2026-11-26', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: SKU, qty: 4 }] }] };
    const r = await vm.runInContext('packLedgerWrite', a.ctx)(list, '');
    return { a, said: r.err || '' };
  } },
  { title: 'Finished Goods form — issue', run: async w => {
    const a = app('inventory/fg-other-movements.js', 'fgiEntrySave', w, { FGI_KINDS: KINDS, PTG: { mdb: [{ sku: SKU }] },
      fgiOutOrderCheck: () => ({ fields: {} }), fgiOutTxt: () => '' });
    a.box('fgmType').value = 'ISSUE'; a.box('fgmSku').value = SKU; a.box('fgmQty').value = '4'; a.box('fgmWho').value = 'Sample room';
    return { a, said: await a.ctx.fgiEntrySave() };
  } },
  { title: 'Excel issue', run: async w => {
    const a = app('inventory/fg-receive-excel.js', 'fgiRecvXlSave', w, { FGI_XL: { kind: 'ISSUE', bad: [], good: [{ rec: row('ISS-xl', 'ISSUE', 4) }] } });
    return { a, said: await a.ctx.fgiRecvXlSave() };
  } },
  { title: 'Scan out — entered as scanned', run: async w => {
    const a = app('inventory/fg-scanning.js', 'fgiScanFlush', w, { FGS: { rows: new Map([[SKU, { sku: SKU, qty: 4 }]]) },
      fgiScanHead: () => head, PTG: { mdb: [{ sku: SKU }] }, fgiRowId: r => r._id });
    return { a, said: await a.ctx.fgiScanFlush(SKU) };
  } },
  { title: 'Scan out — Save all', run: async w => {
    const a = app('inventory/fg-scanning.js', 'fgiScanSave', w, { FGS: { rows: new Map([[SKU, { sku: SKU, qty: 4 }]]), unknown: new Map() },
      fgiScanAuto: () => false, fgiScanHead: () => head, PTG: { mdb: [{ sku: SKU }] } });
    return { a, said: await a.ctx.fgiScanSave() };
  } },
  { title: 'Order Console — complete from stock', run: async w => {
    const a = app('orders/complete-from-stock.js', 'ordStockSave', w, { ordStockCan: () => true, ordIsMto: () => false, ordStockOwed: () => 10,
      ordStockRows: () => [{ id: 'row1' }], PTG: { ob: [] } });
    return { a, said: await a.ctx.ordStockSave({ orderNo: 'OC-1', sku: SKU }, { pcs: '4' }) };
  } },
  { title: 'Customer Orders — send from India', run: async w => {
    const a = app('orders/customer-orders.js', 'cxFromIndia', w, { CX: { rows: [{ id: 'c1', sku: SKU, qty: 4, orderNo: 'CX-1' }] }, renderCx: () => {} });
    a.ctx.cxIndia = sku => a.ctx.fgiOf(sku).current;
    return { a, said: await a.ctx.cxFromIndia('c1') };
  } },
  { title: 'SHP board — from ready stock', run: async w => {
    const a = app('orders/shp-board.js', 'shpbStockSave', w, { shpbKey: () => 'k', shpbStages: () => ({ stk: 0, prsD: 0 }), SHPB: { ready: {} }, SHPB_NODE: 'pt_made_up',
      shpReceive: async () => '', shpCanReceive: () => true, shpbAfter: () => {} });
    return { a, said: await a.ctx.shpbStockSave({ orderNo: 'SH-1', sku: SKU, qty: 4 }, { pcs: '4' }) };
  } },
];

(async () => {
  console.log('== the re-read itself ==');
  { let a = app(null, null, { on: false, fail: true });
    ok('switch off: the database is not asked and the screen keeps its ledger', await a.ctx.fgiStockReread() === '' && a.ctx.FGI.rows.length === 1);
    a = app(null, null, { on: true });
    ok('switch on: the screen now holds what the database holds', await a.ctx.fgiStockReread() === '' && a.ctx.FGI.rows.length === 2);
    a = app(null, null, { on: true, fail: true });
    const said = await a.ctx.fgiStockReread();
    ok('cannot be read: says nothing was saved, why, and what to do', /Nothing was saved/.test(said) && /offline/.test(said) && /save again/.test(said), said);
    ok('…and the screen keeps the ledger it had', a.ctx.FGI.rows.length === 1);
  }
  for (const s of SAVES) {
    console.log('== ' + s.title + ' ==');
    let r = await s.run({ on: true });
    ok('another PC took the pieces: refused, nothing written', /enough stock/.test(r.said) && r.a.writes.length === 0, JSON.stringify(r.said));
    r = await s.run({ on: true, fail: true });
    ok('ledger cannot be read: nothing written, says so', /could not be read/.test(r.said) && r.a.writes.length === 0, JSON.stringify(r.said));
    r = await s.run({ on: true, stale: true });
    ok('the pieces are still there: saved', r.said === '' && r.a.writes.length === 1, JSON.stringify(r.said));
    r = await s.run({ on: false });
    ok('switch off: saved as it always was', r.said === '' && r.a.writes.length === 1, JSON.stringify(r.said));
  }
  console.log('== Save all while a scan is still being entered ==');
  for (const on of [true, false]) {
    const a = app('inventory/fg-scanning.js', 'fgiScanFlush', { on, stale: true }, { FGS: { rows: new Map([[SKU, { sku: SKU, qty: 4 }]]), unknown: new Map() },
      fgiScanAuto: () => true, fgiScanHead: () => head, PTG: { mdb: [{ sku: SKU }] }, fgiRowId: r => r._id, fgiScanRender: () => {} });
    vm.runInContext(cut('inventory/fg-scanning.js', 'fgiScanSave'), a.ctx);
    a.ctx.FGS.q = Promise.resolve().then(() => a.ctx.fgiScanFlush(SKU));        // the scan, as fgiScanAdd queues it
    const queued = a.ctx.FGS.q;
    const said = await a.ctx.fgiScanSave(); await queued;
    ok('switch ' + (on ? 'on' : 'off') + ': the pieces are entered once', said === '' && a.writes.length === 1, a.writes.length + ' writes ' + said);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
