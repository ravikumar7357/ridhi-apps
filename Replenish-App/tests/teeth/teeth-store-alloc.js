/* TEETH for tests/store-alloc-test.js: break the share rules on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-store-alloc.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const A = 'inventory/fg-store-alloc.js', H = 'inventory/fg-shop-hold.js', FORM = 'inventory/fg-other-movements.js', SCAN = 'inventory/fg-scanning.js',
  XL = 'inventory/fg-receive-excel.js', DONE = 'orders/complete-from-stock.js', SHP = 'orders/shp-board.js', CX = 'orders/customer-orders.js',
  EDIT = 'inventory/fg-corrections.js', DEL = 'inventory/fg-change-remove.js', UNDO = 'inventory/fba-ship-excel.js', LIST = 'inventory/finished-goods.js';
const breaks = {
  'on for everybody': [A, "return typeof window !== 'undefined' && !!window.__TEST_ERP;", 'return true;'],
  'on without the website hold': [A, 'if (!shpHoldOn()) return false;', ''],
  'the waiting view is still offered': [A, "if ($('fgPendOpt')) $('fgPendOpt').hidden = fgaOn();", "if ($('fgPendOpt')) $('fgPendOpt').hidden = false;"],
  'the waiting view goes for everybody': [A, "if ($('fgPendOpt')) $('fgPendOpt').hidden = fgaOn();", "if ($('fgPendOpt')) $('fgPendOpt').hidden = true;"],
  'FBA before Custom': [A, "const custom = take((book.ordered[shpHoldKey(sku)] || 0) + fgiHeld(sku, hold));\n  const air = take(lanes.air), sea = take(lanes.sea), awd = take(lanes.awd);",
    "const air = take(lanes.air), sea = take(lanes.sea), awd = take(lanes.awd);\n  const custom = take((book.ordered[shpHoldKey(sku)] || 0) + fgiHeld(sku, hold));"],
  'shares beyond the stock': [A, 'const n = Math.min(left, Math.max(0, wanted));', 'const n = Math.max(0, wanted);'],
  'the website hold is not Custom': [A, ' + fgiHeld(sku, hold));', ');'],
  'Shopify lines counted twice': [A, 'open.filter(l => !l.shopOrderId)', 'open'],
  'Amazon orders count': [A, "ordSrcOf(l.orderNo) !== 'AMZ' && ", ''],
  'closed lines count': [A, ' && !l.shopDoneAt && !l.handedAt', ''],
  'completed from stock is not issued': [H, ' || r.stockForOrder;', ';'],
  'packs are not pieces': [A, ' * pack, 0));', ', 0));'],
  'only one store is asked for': [A, 'const asked = [0, 1, 2].map(i => stores.reduce(', 'const asked = [0, 1, 2].map(i => stores.slice(0, 1).reduce('],
  'nothing on the way is taken off': [A, 'coming -= met; return n - met;', 'return n;'],
  'on the way is taken off every lane': [A, 'coming -= met; return n - met;', 'return n - met;'],
  'a shipped dispatch is always on the way': [A, "if (st === 'shipped' && !(", "if (false && !("],
  'a shipped one after the figures is forgotten': [A, "if (st === 'shipped' && !(Date.parse(r.fbaShippedAt || r.createdAt) > (store ? snapAtOf(store) : oldest))) return;", "if (st === 'shipped') return;"],
  'the making time decides, not the shipping time': [A, 'Date.parse(r.fbaShippedAt || r.createdAt)', 'Date.parse(r.createdAt)'],
  'a missing need asks': [A, "if (fgaNeedState(need).state === 'stale') fgaAskFresh();", "if (fgaNeedState(need).state !== 'ok') fgaAskFresh();"],
  'returned pieces are on the way': [A, 'const key = shpHoldKey(r.sku), had = out.get(key) || {};', 'const key = shpHoldKey(r.sku), had = out.get(key) || {};\n    if (r.fbaReturned) return;'],
  'old figures are trusted': [A, 'nowMs - snapAt > FGA_MAX_AGE_MS ?', 'false ?'],
  'one store is enough': [A, 'if (times.some(t => !t)) return', 'if (times.every(t => !t)) return'],
  'old need lets FBA go': [H, " || (shpAllocOn() ? fgaNeedWhy() : '');", ';'],
  'old figures still give Excess': [A, 'excess = old ? 0 : shares.excess;', 'excess = shares.excess;'],
  'an order takes all of Custom': [A, 'Math.min(qty, fgaPendingOf(orderNo, w.sku, book))', 'qty'],
  'an issue may take FBA pieces': [A, 'if (w.qty <= own + excess) return', 'if (w.qty <= own + excess + shares.air) return'],
  'rows of one SKU judged apart': [A, 'const key = shpHoldKey(w.sku), had = out.get(key) ||', 'const key = Math.random(), had = out.get(key) ||'],
  'FBA may take Excess': [A, 'return s.air + s.sea + s.awd;', 'return s.air + s.sea + s.awd + s.excess;'],
  'the old FBA rule stays': [H, 'if (shpAllocOn()) return Math.min(have,', 'if (false) return Math.min(have,'],
  'a release gives more than the stock': [H, 'return Math.min(have, fgaFbaShare(sku, have, hold, book) + fgiReleased(sku, hold));', 'return fgaFbaShare(sku, have, hold, book) + fgiReleased(sku, hold);'],
  'a release is used by the old rule': [H, 'if (book) owed = w.qty - fgaFbaShare(w.sku, w.current, hold, book);', ''],
  'a changed row is not left out': [H, 'fgaBook(new Set((wants || []).map(w => w.without).filter(Boolean)))', 'fgaBook()'],
  'a changed issue is not left out': [A, ', without: was._id || was.id }];', ' }];'],
  'the form does not ask': [FORM, "const kept = type === 'ISSUE' &&", "const kept = false &&"],
  'a scan does not ask': [SCAN, "const kept = h.t === 'ISSUE' && typeof fgaIssueRefusal === 'function' ? fgaIssueRefusal([{", "const kept = false ? fgaIssueRefusal([{"],
  'Save all does not ask': [SCAN, "? fgaIssueRefusal(recs) : '';", "? '' : '';"],
  'Excel does not ask': [XL, '? fgaIssueRefusal(p.good.map(x => x.rec))', "? ''"],
  'complete from stock does not ask': [DONE, '? fgaIssueRefusal([', "? '' && (["],
  'the SHP board does not ask': [SHP, '? fgaIssueRefusal([', "? '' && (["],
  'Customer Orders does not ask': [CX, '? fgaIssueRefusal([', "? '' && (["],
  'an edit does not ask': [EDIT, '? fgaIssueRefusal(fgaIssueEditWants(r, after))', "? ''"],
  'an edit reads nothing first': [EDIT, 'const unread = await fgaReread();', "const unread = '';"],
  'a delete reads nothing first': [DEL, 'const unread = await fgaReread();', "const unread = '';"],
  'an undo reads nothing first': [UNDO, 'const unread = await fgaReread();', "const unread = '';"],
  'the stock-out save reads the old way': [LIST, 'return fgaReread();\n  if (!lineHoldOn())', "return '';\n  if (!lineHoldOn())"],
  'the order book is not read again': [A, "ptReadReg('ob'), ", ''],
  'an unreadable book is ignored': [A, "return 'Nothing was saved — the India store and the order book", "return ''; ('"],
  'the need is not read again': [H, 'if (shpAllocOn()) await fgaNeedReread();\n    return', 'return'],
  'stopped SKUs ask': [A, 'replReq(applyStatus(Object.assign({}, r)))', 'replReq(Object.assign({}, r))'],
  'hidden SKUs ask': [A, ' && !isHiddenSku(r.sku))', ')'],
  'older figures overwrite': [A, 'return figure.snapAt === noted.snapAt && ', 'return '],
  'anybody notes': [A, 'if (!fgaOn() || !replFull()) return;\n  try {\n    await loadProd', 'if (!fgaOn()) return;\n  try {\n    await loadProd'],
  'the slim copy is noted': [A, "snap.mode !== 'full' || ", ''],
  'asks every time': [A, ' || Date.now() - fgaAskedAt() < FGA_ASK_EVERY_MS) return;', ') return;'],
  'the test website asks': [A, "if (typeof window !== 'undefined' && window.__TEST_ERP) return console.warn", "if (false) return console.warn"],
  'the old columns stay': [LIST, "...(alloc ? ['In Stock', ...FGA_SHARES.map(s => s[1])] :", '...(false ? [] :'],
  'the old card figures stay': [LIST, '(alloc ? `<div class="fg-mc-figs">', '(false ? `<div class="fg-mc-figs">'],
  'the view picker is ignored': [A, 'return SHP_HOLD_STORES.includes(picked) ? [picked] : SHP_HOLD_STORES;', 'return SHP_HOLD_STORES;'],
  'old figures not said on the list': [LIST, "const old = alloc ? fgiFbaAgeWhy() : '';", "const old = '';"],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-store-alloc-' + process.pid + '.js');
for (const [name, [file, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'store-alloc-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
  const caught = run.status !== 0;
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
