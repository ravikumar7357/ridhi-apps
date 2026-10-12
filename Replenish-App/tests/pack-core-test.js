/* Pack core (src/app/replenishment/pack-core.js): the rules both scanning screens pack by, and the one ledger write.
 *   node tests/pack-core-test.js      (PKC_SRC=<file> to test another copy — teeth/teeth-pack-core.js does) */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.PKC_SRC || path.join(__dirname, '..', 'src', 'app', 'replenishment', 'pack-core.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const up = s => String(s == null ? '' : s).trim().toUpperCase();

function load(o) {
  o = o || {};
  const patches = [], alerts = [];
  const ctx = {
    obUC: up, ME: { email: 'packer@test' },
    FGI: { rows: o.rows || [], err: '' }, fgiLoad: async () => {},
    fgiOf: sku => ({ current: (o.stock || {})[up(sku)] || 0 }),
    ordLines: () => o.lines || [], fgiOrderKnown: no => (o.lines || []).some(l => l.orderNo === up(no)),
    fgiOutOrders: (sku, type) => (o.lines || []).filter(l => l.sku === up(sku)).map(l => ({ orderNo: l.orderNo, store: (o.store || {})[l.orderNo + '|' + l.sku] || 0 })),
    fgiOutAlloc: (sku, qty, type, first, taken) => { const t = taken || new Map(); const c = ctx.fgiOutOrders(sku, type).map(x => ({ orderNo: x.orderNo, store: x.store - (t.get(x.orderNo) || 0) })).filter(x => x.store > 0); let left = qty; const orders = []; c.forEach(x => { if (left <= 0) return; const q = Math.min(left, x.store); orders.push({ orderNo: x.orderNo, qty: q }); left -= q; }); return { orders, loose: Math.max(0, left) }; },
    fgiOutCheck: (sku, qty) => qty > ctx.fgiOf(sku).current ? `You don't have enough stock — ${up(sku)} has ${ctx.fgiOf(sku).current} piece(s) in the India Store and this dispatch asks for ${qty}.` : '',
    fgiCanEntry: () => o.right !== false, FGI_NO_ENTRY: 'Only somebody with "Can add stock entries"…', FGI_FBA_ACCOUNTS: ['Ridhi FBA', 'CPC FBA'],
    fgiNewId: p => p + '-' + (patches.length + 1) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
    ptPatch: async patch => { if (o.patchFails) throw new Error('offline'); patches.push(patch); },
    fbaBadge: () => {}, fgiOverBadge: () => {}, lstAlertFor: async (sku) => { alerts.push(sku); return ''; },
    mdbOf: sku => (o.mdb || {})[up(sku)] || null, PK_WT: o.wt || {},
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { PACK_CORE, packGuarded, packScanNew, packOrderLines, packDataReady, packOrdersUnknown, packWtOf, packLedgerWrite };')(...Object.values(ctx));
  return Object.assign(api, { patches, alerts, ctx });
}
const C = load().PACK_CORE;
/* two SKUs; one on two orders; the store holds fewer than ordered on one line; a pasted plan line */
const orders = () => [
  { sku: 'RTC327-6060', orderNo: 'OC-1', qty: 4, store: 10 },
  { sku: 'RTBXRU-327', orderNo: 'OC-1', qty: 2, store: 1 },     // ordered 2, only 1 in the store for it
  { sku: 'RTBXRU-327', orderNo: 'OC-2', qty: 3, store: 3 },
  { sku: 'RTBX72', orderNo: 'FBA-PLAN-1', qty: 5, store: 5, plan: true },
];
const hit = sku => ({ sku, how: 'fnsku' });

(async () => {
  console.log('== a scan against the orders ==');
  { const packed = {};
    let r = C.apply(hit('RTBXRU-327'), orders(), packed, 1);
    ok('the first piece goes to the oldest order, which then has 0 left (store cap 1)', r.kind === 'good' && r.orderNo === 'OC-1' && r.taken === 1 && r.left === 3, JSON.stringify(r));
    r = C.apply(hit('RTBXRU-327'), orders(), packed, 1);
    ok('the second piece moves on to OC-2', r.kind === 'good' && r.orderNo === 'OC-2' && r.left === 2);
    ok('packed remembers each order', packed['RTBXRU-327']['OC-1'] === 1 && packed['RTBXRU-327']['OC-2'] === 1);
    r = C.apply(hit('RTBXRU-327'), orders(), packed, 4);
    ok('four more when two are left: short, two taken', r.kind === 'short' && r.taken === 2 && r.parts.length === 1 && r.parts[0].qty === 2 && r.left === 0, JSON.stringify(r));
    r = C.apply(hit('RTBXRU-327'), orders(), packed, 1);
    ok('then full — OC-1 still wants one but the store holds none for it: NO STOCK LEFT', r.kind === 'full' && r.why === 'store' && r.taken === 0, JSON.stringify(r));
    const p2 = {}; for (let i = 0; i < 4; i++) C.apply(hit('RTC327-6060'), orders(), p2, 1);
    r = C.apply(hit('RTC327-6060'), orders(), p2, 1);
    ok('every line packed: ORDER FULL', r.kind === 'full' && r.why === 'order' && p2['RTC327-6060']['OC-1'] === 4);
    C.untake(packed, 'RTBXRU-327', [{ orderNo: 'OC-2', qty: 2 }]);
    ok('undo gives the pieces back to their order', packed['RTBXRU-327']['OC-2'] === 1);
    C.untake(packed, 'RTBXRU-327', [{ orderNo: 'OC-2', qty: 1 }, { orderNo: 'OC-1', qty: 1 }]);
    ok('…and a SKU with nothing packed is gone from packed', !packed['RTBXRU-327']);
  }
  { const packed = {};
    const r = C.apply(hit('RTBXRU-327'), orders().map(o => Object.assign({}, o, { store: 0 })), packed, 1);
    ok('nothing in the India Store for the orders: NO STOCK LEFT, not counted', r.kind === 'full' && r.why === 'store' && !packed['RTBXRU-327']);
  }
  { const packed = {};
    const r = C.apply(hit('RQL34-Q'), orders(), packed, 1);
    ok('a known SKU on no order is WRONG, never counted', r.kind === 'wrong' && r.sku === 'RQL34-Q' && r.taken === 0 && Object.keys(packed).length === 0);
    ok('an unknown code is unknown', C.apply({ sku: '', how: '' }, orders(), packed, 1).kind === 'unknown' && C.apply(null, orders(), packed, 1).kind === 'unknown');
    ok('a plan line packs like an order', C.apply(hit('RTBX72'), orders(), packed, 2).kind === 'good' && packed.RTBX72['FBA-PLAN-1'] === 2);
  }
  { const packed = { 'RTC327-6060': { 'OC-1': 3 } };
    const left = C.leftBySku(orders(), packed);
    const tc = left.find(x => x.sku === 'RTC327-6060');
    ok('left per SKU: ordered 4, packed 3, 1 left; the store cap counts (RTBXRU 2+3 ordered, 1+3 in store → 4 left)', tc.qty === 4 && tc.got === 3 && tc.left === 1 && left.find(x => x.sku === 'RTBXRU-327').left === 4, JSON.stringify(left));
  }

  console.log('== boxes in the Packing List shape ==');
  { const box = { n: 1, items: [] };
    const it = C.addToBox(box, 'rtc327-6060', 2, { desc: 'Cotton Square Tablecloth 60x60', size: '60x60', perPcsWt: 0.42 });
    ok('the first scan makes the line with what the packing list prints', it.sku === 'RTC327-6060' && it.desc === 'Cotton Square Tablecloth 60x60' && it.size === '60x60' && it.material === '100% COTTON' && it.perPcsWt === 0.42 && it.qty === 2);
    C.addToBox(box, 'RTC327-6060', 3, null);
    ok('more pieces add to the same line', box.items.length === 1 && box.items[0].qty === 5 && C.boxQty(box) === 5 && C.itemOf(box, 'rtc327-6060').qty === 5);
    ok('take back 2 → 3', C.takeFromBox(box, 'RTC327-6060', 2) === 3 && box.items[0].qty === 3);
    ok('take back to zero removes the line', C.takeFromBox(box, 'RTC327-6060', 3) === 0 && box.items.length === 0);
    ok('a SKU not in the box is -1', C.takeFromBox(box, 'RTBX72', 1) === -1);
  }

  console.log('== weights ==');
  { const wt = { A1: 0.5, A2: 0.7, B1: 1.2 }, meta = { A1: { subcat: 'Napkin', size: '20x20' }, A2: { subcat: 'Napkin', size: '20x20' }, A3: { subcat: 'Napkin', size: '20x20' }, A4: { subcat: 'Napkin', size: '18x18' }, B1: { subcat: 'Runner', size: '72' }, Z: { subcat: '', size: '' } };
    const all = Object.keys(wt);
    ok('typed in the master wins', JSON.stringify(C.weightOf('A1', wt, meta, all)) === JSON.stringify({ wt: 0.5, approx: false, how: 'master' }));
    ok('same sub-category and size: the mean (0.6), approx', C.weightOf('A3', wt, meta, all).wt === 0.6 && C.weightOf('A3', wt, meta, all).approx);
    ok('same sub-category only: the mean of the two napkins', C.weightOf('A4', wt, meta, all).how === 'same sub-category' && C.weightOf('A4', wt, meta, all).wt === 0.6);
    ok('nothing anywhere: 0, approx', C.weightOf('Z', wt, meta, all).wt === 0 && C.weightOf('Z', wt, meta, all).approx);
    const box = { n: 1, L: 50, W: 40, H: 25, items: [{ sku: 'A1', qty: 10, perPcsWt: 0.5 }, { sku: 'B1', qty: 2, perPcsWt: 1.2 }] };
    let w = C.boxWeights(box, null, 1.5, 5000);
    ok('net 7.4 from the lines, gross +1.5, volume weight 10, CBM 0.05', Math.abs(w.net - 7.4) < 1e-9 && Math.abs(w.gross - 8.9) < 1e-9 && w.vol === 10 && w.cbm === 0.05, JSON.stringify(w));
    w = C.boxWeights(Object.assign({}, box, { grossWtOverride: 9.35 }), s => ({ A1: 0.5, B1: 1.2 })[s], 1.5, 5000);
    ok('a scale reading wins over the arithmetic', w.gross === 9.35 && Math.abs(w.net - 7.4) < 1e-9);
  }

  console.log('== a pasted Amazon shipment plan ==');
  { let p = C.planParse('Merchant SKU\tFNSKU\tQuantity\nRTC327-6060\tX00ABC\t4\nrtbx72\tX00DEF\t5\nRTC327-6060\tX00ABC\t2\n');
    ok("Amazon's columns, tabs, duplicates merged, SKUs upper-cased", p.lines.length === 2 && p.lines[0].sku === 'RTC327-6060' && p.lines[0].qty === 6 && p.lines[1].sku === 'RTBX72' && p.lines[1].qty === 5 && p.why === '', JSON.stringify(p));
    p = C.planParse('sku,qty\n"RQL34-Q",3\n,\n');
    ok('commas and quotes too', p.lines.length === 1 && p.lines[0].sku === 'RQL34-Q' && p.lines[0].qty === 3);
    ok('no SKU / Quantity column: nothing, and why', C.planParse('Article\tPieces\nX\t1').lines.length === 0 && /SKU column/.test(C.planParse('Article\tPieces\nX\t1').why));
    ok('nothing pasted: nothing, and why', C.planParse('').why === 'Nothing pasted.' && /No row/.test(C.planParse('sku\tqty\n').why));
  }

  console.log('== the Send to FBA rows ==');
  { const p = { id: 'PKT1', date: '2026-10-12', account: 'Ridhi FBA',
      boxes: [{ n: 1, items: [{ sku: 'RTC327-6060', qty: 3 }, { sku: 'RTBXRU-327', qty: 1 }] }, { n: 2, items: [{ sku: 'RTC327-6060', qty: 2 }] }, { n: 3, items: [] }],
      scan: { orders: ['OC-1'], plan: [{ sku: 'RTBXRU-327', qty: 1 }], planNo: 'FBA-PLAN-1', handoverTo: 'Raju', packed: { 'RTC327-6060': { 'OC-1': 4 }, 'RTBXRU-327': { 'FBA-PLAN-1': 1 } } } };
    const allots = [];
    const rows = C.ledgerRows(p, { newId: () => 'FBA-X', nowIso: '2026-10-12T10:00:00.000Z', by: 'me', allot: (sku, n, taken) => { allots.push([sku, n, [...taken.entries()]]); return { orders: [{ orderNo: 'OC-9', qty: n }] }; } });
    const tc = rows.find(r => r.sku === 'RTC327-6060'), ru = rows.find(r => r.sku === 'RTBXRU-327');
    ok('one row per SKU, the Finished Goods shape, dated DD/MM/YYYY', rows.length === 2 && tc.txnType === 'FBA' && tc.qty === 5 && tc.date === '12/10/2026' && tc.scanned === true && tc.issuedFor === 'Ridhi FBA' && tc.handoverTo === 'Raju' && tc.createdBy === 'me' && tc._id === 'FBA-X');
    ok('the boxes it sits in, and the pack id', JSON.stringify(tc.boxes) === '[{"n":1,"qty":3},{"n":2,"qty":2}]' && tc.packId === 'PKT1' && /pack PKT1 · plan FBA-PLAN-1/.test(tc.remarks));
    ok('pieces packed for an Order Console order name it; the one past the orders is dealt the Auto way, with what the orders took', JSON.stringify(tc.orders) === '[{"orderNo":"OC-1","qty":4},{"orderNo":"OC-9","qty":1}]' && JSON.stringify(allots[0]) === '["RTC327-6060",1,[["OC-1",4]]]', JSON.stringify(tc.orders) + ' ' + JSON.stringify(allots));
    ok('a plan is not an order: its pieces are re-dealt to real orders', JSON.stringify(ru.orders) === '[{"orderNo":"OC-9","qty":1}]');
    const none = C.ledgerRows({ id: 'P', date: '12/10/2026', account: 'CPC FBA', boxes: [{ n: 1, items: [{ sku: 'A', qty: 2 }] }] }, { newId: () => 'i', nowIso: 'now', by: 'b' });
    ok('a list with no scan block and no allotter still writes its rows, date kept as it is, no orders field', none.length === 1 && none[0].date === '12/10/2026' && !('orders' in none[0]) && !('handoverTo' in none[0]));
  }

  console.log('== packLedgerWrite: once, with the dispatch checks ==');
  { const lines = [{ orderNo: 'OC-1', sku: 'RTC327-6060', qty: 4 }];
    const mk = o => Object.assign({ lines, store: { 'OC-1|RTC327-6060': 4 }, stock: { 'RTC327-6060': 4 } }, o || {});
    const list = () => ({ id: 'PKT2', date: '2026-10-12', account: 'Ridhi FBA', boxes: [{ n: 1, items: [{ sku: 'RTC327-6060', qty: 3 }] }], scan: { orders: ['OC-1'], plan: [], planNo: '', packed: { 'RTC327-6060': { 'OC-1': 3 } }, wrong: [], ledgerIds: [], done: false } });
    let A = load(mk({ right: false })); let r = await A.packLedgerWrite(list(), '');
    ok('no stock-entry right: refused, nothing written', /stock entries/.test(r.err) && A.patches.length === 0);
    A = load(mk()); r = await A.packLedgerWrite(Object.assign(list(), { account: 'Amazon' }), '');
    ok('not an FBA account: refused', /FBA account/.test(r.err) && A.patches.length === 0);
    A = load(mk({ stock: { 'RTC327-6060': 2 } })); r = await A.packLedgerWrite(list(), '');
    ok('more than the India Store holds: refused, says so, nothing written', /enough stock/.test(r.err) && /Receive it in Finished Goods first/.test(r.err) && A.patches.length === 0);
    A = load(mk()); const p = list(); r = await A.packLedgerWrite(p, 'Raju');
    const keys = Object.keys(A.patches[0] || {});
    ok('written: one PATCH, one row under pt_fgiLedger', !r.err && r.rows.length === 1 && A.patches.length === 1 && keys.length === 1 && /^pt_fgiLedger\/FBA-/.test(keys[0]), JSON.stringify(r));
    const row = A.patches[0][keys[0]];
    ok('the row: FBA, 3 pcs for OC-1, scanned, handed to Raju, pack id, box', row.txnType === 'FBA' && row.qty === 3 && JSON.stringify(row.orders) === '[{"orderNo":"OC-1","qty":3}]' && row.scanned && row.handoverTo === 'Raju' && row.packId === 'PKT2' && row.boxes[0].n === 1, JSON.stringify(row));
    ok('the list remembers: ledgerIds, done, by whom; the ledger in memory has the row; the listing alert ran', p.scan.ledgerIds[0] === row._id && p.scan.done && p.scan.doneBy === 'packer@test' && A.ctx.FGI.rows.length === 1 && A.alerts[0] === 'RTC327-6060');
    r = await A.packLedgerWrite(p, '');
    ok('a second Finish writes nothing twice', r.already === true && A.patches.length === 1);
    A = load(mk()); r = await A.packLedgerWrite({ id: 'E', date: '2026-10-12', account: 'Ridhi FBA', boxes: [], scan: null }, '');
    ok('an empty list: nothing packed yet', /Nothing packed/.test(r.err) && A.patches.length === 0);
    A = load(mk({ patchFails: true })); let threw = false; try { await A.packLedgerWrite(list(), ''); } catch (e) { threw = true; }
    ok('a failed PATCH throws (the screen says so) and marks nothing done', threw);
  }

  console.log('== the order lines a list packs against ==');
  { const lines = [{ orderNo: 'OC-1', sku: 'RTC327-6060', qty: 4 }, { orderNo: 'OC-2', sku: 'RTC327-6060', qty: 2 }, { orderNo: 'OC-1', sku: 'RTBX72', qty: 1 }];
    const A = load({ lines, store: { 'OC-1|RTC327-6060': 3, 'OC-1|RTBX72': 0 }, stock: { RQL: 7 } });
    const ls = A.packOrderLines(A.packScanNew(['oc-1'], [{ sku: 'RQL', qty: 5 }], 'FBA-PLAN-9', ''));
    ok('the named order\'s lines with the pieces the store holds for each, plus the plan capped by the store', JSON.stringify(ls) === JSON.stringify([
      { sku: 'RQL', orderNo: 'FBA-PLAN-9', qty: 5, store: 7, plan: true },
      { sku: 'RTC327-6060', orderNo: 'OC-1', qty: 4, store: 3 },
      { sku: 'RTBX72', orderNo: 'OC-1', qty: 1, store: 0 }]), JSON.stringify(ls));
    ok('guarded = has orders or a plan', A.packGuarded({ scan: A.packScanNew(['OC-1'], [], '', '') }) && A.packGuarded({ scan: A.packScanNew([], [{ sku: 'X', qty: 1 }], 'P', '') }) && !A.packGuarded({ scan: A.packScanNew([], [], '', '') }) && !A.packGuarded({}));
    ok('unknown orders are named', JSON.stringify(A.packOrdersUnknown(['OC-1', 'zz-9'])) === '["ZZ-9"]');
    ok('packDataReady reads nothing when the ledger is there', await A.packDataReady() === '');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
