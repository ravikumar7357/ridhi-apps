// Pricing-API ReplSnap.gs (25 Oct): the Replenish snapshot built from FabriCrush Inventory. Runs InvSync.gs + ReplSnap.gs in node against a fake store. node tests/replsnap-test.js
const fs = require('fs'), vm = require('vm');
const P = require('path').join(__dirname, '..', '..', 'Pricing-API') + '/';
const SRC = "var ORDERS_DATA_IDS = ['RIDHI-ORD', 'CPC-ORD'], RIDHI_SHEET_ID = 'RIDHI-MAIN', CPC_SHEET_ID = 'CPC-MAIN';\n"
  + fs.readFileSync(P + 'InvSync.gs', 'utf8') + '\n' + fs.readFileSync(P + 'ReplSnap.gs', 'utf8') + '\n' + fs.readFileSync(P + 'FriBooks.gs', 'utf8');
const FRI = {}, WRITES = []; let pass = 0, fail = 0;
const ok = (n, c, i) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (i ? '  ' + i : '')); } };
const friBase = 'https://firestore.googleapis.com/v1/projects/fabricrush-inventory/databases/(default)/documents';
const prBase = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents';
const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) });
const put = (p, obj) => { FRI[p] = JSON.stringify(obj); };
const fmt = (d, tz, pat) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace(/^H$/, String(+p.hour));
};
const ctx = {
  UrlFetchApp: { fetch(url, opt) {
    if (url === friBase + ':commit') { JSON.parse(opt.payload).writes.forEach(w => { if (w.update) FRI[w.update.name.split('/documents/')[1]] = w.update.fields.json.stringValue; }); return resp(200, {}); }
    if (url === friBase + ':batchGet') return resp(200, JSON.parse(opt.payload).documents.map(n => { const p = n.split('/documents/')[1]; return FRI[p] != null ? { found: { name: n, fields: { json: { stringValue: FRI[p] } } } } : { missing: n }; }));
    if (url.startsWith(friBase + '/')) { const p = url.slice(friBase.length + 1); return FRI[p] != null ? resp(200, { fields: { json: { stringValue: FRI[p] } } }) : resp(404, ''); }
    if (url === prBase + ':commit') { WRITES.push(...JSON.parse(opt.payload).writes); return resp(200, {}); }
    if (url.startsWith(prBase + '/')) return resp(404, '');
    throw new Error('unexpected fetch ' + url);
  } },
  ScriptApp: { getOAuthToken: () => 't' }, Utilities: { sleep() {}, formatDate: fmt },
  PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({}) }) }, Logger: { log() {} }, console,
};
vm.createContext(ctx); vm.runInContext(SRC, ctx);
const DAY = 864e5, now = Date.now(), ym = o => fmt(new Date(now + o * DAY), 'Asia/Kolkata', 'yyyy-MM');
const t = new Date(), nextYM = fmt(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 15)), 'UTC', 'yyyy-MM');
const lab = k => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+k.slice(5) - 1] + " '" + k.slice(2, 4) + ' Rec.';
const TXT = ['Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category'];
const cols = ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Color', 'Size', 'Sub-Category', 'Total Stock', 'warehouse', 'fulfillable', 'Unsellable', 'reserved', lab(nextYM),
  'inbound_working', 'inbound_shipped', 'inbound_receiving', 'reserved_orders', 'AWD Available', 'AWD Transit', 'Yesterday', 'Today', 'Last 7 Days', 'Last 14 Days',
  'Last 30 Days', 'Last 90 Days', 'Last 90 Days $', 'This Month', 'Air DoS', 'Air Qty', 'Sea DoS', 'Sea Qty'];
const row = (sku, o) => cols.map(h => (o[h] != null ? o[h] : h === 'SKU' ? sku : TXT.includes(h) ? '' : 0));
put('idx/inv_SP', { n: 1, count: 3, at: now - 60000, cols });
put('inv/SP_0', [
  row('A1', { Image: 'https://img/a1.jpg', 'Sub-Category': 'Napkin', 'Total Stock': 100, warehouse: 90, fulfillable: 80, 'Last 30 Days': 60, 'Last 90 Days': 150, 'Last 90 Days $': 6000, [lab(nextYM)]: 40 }),
  row('Q1', { 'Sub-Category': 'Queen Quilt', 'AWD Transit': 30 }),
  row('W1', { 'Sub-Category': 'Women', 'Total Stock': 5, 'Last 30 Days': 3, 'Last 90 Days': 9, 'Last 90 Days $': 90 }),
]);
put('idx/ship_SP', { n: 1, count: 1, cols: [] });
put('ship/SP_0', [[now - 40 * DAY, now + 10 * DAY, '', 'STAR-9', 'Q1', 30, 'AWD', 'Shipped', 80, 'STAR-9', 'created']]);
put('idx/cat_SP', { n: 1, count: 3 }); put('cat/SP_0', [['a1'], ['Q1'], ['a1']]);
const ms = [[ym(-45), -45], [ym(-80), -80], [ym(-120), -120]];
put('idx/ord_SP', { months: Object.fromEntries(ms.map(([k]) => [k, 2])), at: now });
ms.forEach(([k, off]) => {
  put('idx/ord_SP_' + k, { n: 1 });
  const d = new Date(now + off * DAY).toISOString();
  put('ord/SP_' + k + '_0', [['O' + off, d, d.slice(0, 10), 'Q1', 'B0Q', 30, 300, 'Shipped', 'Amazon.com', 0], ['M' + off, d, d.slice(0, 10), 'Q1', 'B0Q', 99, 0, 'Shipped', 'Non-Amazon', 1]]);
});
put('meta/settings', { sea: 80 });

const d = vm.runInContext("replSnapRows_('SP')", ctx);
const by = Object.fromEntries(d.rows.map(r => [r.sku, r]));
const a1 = by.A1, q1 = by.Q1, w1 = by.W1;
ok('rows come out with the sheet field names', d.rows.length === 3 && a1.image === 'https://img/a1.jpg' && a1.totalStock === 100 && a1.rec[lab(nextYM)] === 40, JSON.stringify(a1).slice(0, 300));
ok('A1: category B, avg sale 2 (max of 30- and 90-day rate)', a1.category === 'B' && a1.avgSale === 2 && a1.monthlyAmt === 2400, JSON.stringify([a1.category, a1.avgSale, a1.monthlyAmt]));
ok('A1: cover 50 days -> Air + Sea, next month Rec. in the inflow', a1.coverDos === 50 && a1.airReq > 0 && a1.decision.startsWith('Air') && a1.inflow.fut.length === 1, JSON.stringify([a1.coverDos, a1.airReq, a1.seaReq, a1.decision, a1.inflow]));
ok('Q1: long out of stock -> rated on its year, MCF lines left out', q1.oosYear === true && Math.abs(q1.avgSale - Math.round(90 / (3 * 30.4) * 100) / 100) < 1e-9 && q1.yrMonths === 3, JSON.stringify([q1.avgSale, q1.yrUnits, q1.yrMonths, q1.category]));
ok('Q1: a quilt cannot fly; AWD transit credited on its STAR ETA (10 days)', q1.airReq === 0 && q1.airExcluded === true && q1.inflow.awdDay === 10, JSON.stringify([q1.airReq, q1.seaReq, q1.inflow]));
ok('W1: "Women" is stopped as before', w1.stopped === true && w1.status === 'Discontinued');
ok('catalogue SKUs de-duplicated, upper case', JSON.stringify(d.catalogSkus) === JSON.stringify(['A1', 'Q1']), JSON.stringify(d.catalogSkus));
ok('history built from the stored orders and cached a day', d.histDiag.skus === 1 && !!FRI['work/replhist_SP'], JSON.stringify(d.histDiag));

vm.runInContext("replSnapWrite_('SP', replSnapRows_('SP'))", ctx);
const names = WRITES.filter(x => x.update).map(x => x.update.name.split('/documents/')[1]);
ok('three copies written: full, slim, shop; rows before headers', ['replrows/SP_0', 'replslimrows/SP_0', 'replshoprows/SP_0', 'repl/SP', 'replslim/SP', 'replshop/SP'].every(n => names.includes(n))
  && names.indexOf('repl/SP') > names.indexOf('replrows/SP_0'), names.join(' '));
const hdr = WRITES.find(x => x.update && x.update.name.endsWith('/repl/SP')).update.fields;
ok('the header: chunks, n, a timestamp, the Rec. columns', hdr.chunks.integerValue === '1' && hdr.n.integerValue === '3' && !!hdr.at.timestampValue && hdr.recCols.arrayValue.values[0].stringValue === lab(nextYM), JSON.stringify(hdr).slice(0, 300));
const rowsDoc = WRITES.find(x => x.update && x.update.name.endsWith('/replrows/SP_0')).update.fields.r.arrayValue.values;
const a1w = rowsDoc.find(v => v.mapValue.fields.sku.stringValue === 'A1').mapValue.fields;
ok('a row is a typed map: numbers, strings, the rec map, the inflow map', a1w.avgSale.integerValue === '2' && a1w.image.stringValue === 'https://img/a1.jpg' && !!a1w.rec.mapValue && !!a1w.inflow.mapValue, JSON.stringify(a1w.avgSale));
const shopHdr = WRITES.find(x => x.update && x.update.name.endsWith('/replshop/SP')).update.fields;
ok('the shop copy carries SKU -> fulfillable', shopHdr.ful.mapValue.fields.A1.integerValue === '80');
const steps = vm.runInContext("invStepsFor_('refresh', 'all').map(function (s) { return s.fn + s.b; }).join(',')", ctx);
ok('a refresh ends with the Replenish snapshot for both brands', /replSP,replCPC$/.test(steps), steps);
// FriBooks.gs: the Orders Data / Catalog workbooks answered from the stored sets (Step 2, Sellora's readers)
const ob = vm.runInContext("bookOpen_('RIDHI-ORD')", ctx), osh = ob.getSheetByName('Orders');
ok('books: the Ridhi orders book has the Orders tab only, never "CPC Orders" (a reader trying both counted the brand twice)', !!osh && ob.getSheetByName('CPC Orders') === null);
const ov = osh.getRange(1, 1, osh.getLastRow(), 10).getValues();
ok('books: a header, then 6 order lines oldest first, in the sheet columns (MCF as text)', ov.length === 7 && ov[0][0] === 'Order ID' && ov[1][9] === 'Amazon' && ov.some(r => r[9] === 'MCF') && ov[1][2] <= ov[ov.length - 1][2], JSON.stringify(ov.slice(0, 3)));
ok('books: friFirstRow skips to a month', osh.friFirstRow(ms[0][0] + '-01') === 2 + 4, String(osh.friFirstRow(ms[0][0] + '-01')));
const cb = vm.runInContext("bookOpen_('RIDHI-MAIN')", ctx).getSheetByName('Catalog');
ok('books: the catalogue tab, header first', cb.getRange(1, 1, 1, 2).getValues()[0][0] === 'SKU' && cb.getLastRow() === 4, String(cb.getLastRow()));
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
