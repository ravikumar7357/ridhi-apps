/* THE SAME ISSUE, SAVED TWICE WITHIN A MINUTE. Eleven pairs in the live Job Work Register — same karigar,
 * SKU, order, pieces and issue time, entered 0 to 47 seconds apart, ten of them already inside a frozen
 * payout. The button is disabled while a save is in flight, so these are a person pressing Save again
 * (eight of the eleven are custom orders). An identical issue inside two minutes now has to be confirmed. */
const fs = require('fs'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html', T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const A = `  $('bwSave').disabled = true;
  bdFormMsg('Saving…');
  try {
    await ptPut('pt_baseData/' + entry.id, entry);`;
if (s.split(A).length !== 2) throw new Error('save anchor ' + (s.split(A).length - 1));
s = s.replace(A, () => `  /* THE SAME ISSUE, AGAIN, INSIDE TWO MINUTES. Eleven pairs like this are in the live register — same karigar,
   * SKU, order and pieces, 0 to 47 seconds apart, ten of them already paid in a frozen fortnight. A second
   * identical issue can be real, so it is asked about, not refused. */
  const twin = bdTwinOf(entry);
  if (twin && !confirm(\`\${nf(pcs)} piece(s) of \${entry.sku} were issued to \${entry.empName}\${orderNo ? ' against ' + orderNo : ''} \`
    + \`\${Math.max(1, Math.round((Date.now() - Date.parse(twin.addedAt)) / 1000))} second(s) ago.\n\nThis would be a SECOND, identical issue — and a second payment. OK saves it anyway.\`))
    return bdFormMsg('Not saved — that exact issue was already saved a moment ago. It is in the register below.', true);

` + A);
const B = `$('bwSave').onclick = async () => {`;
if (s.split(B).length !== 2) throw new Error('handler anchor');
s = s.replace(B, () => `/** An identical issue — karigar, SKU, order, pieces — saved in the last two minutes, or null. */
function bdTwinOf(entry) {
  const now = Date.now();
  return (PT.base || []).find(r => r && r.empName === entry.empName && obUC(r.sku) === obUC(entry.sku)
    && String(r.orderNo || '') === String(entry.orderNo || '') && ptNum(r.issuePieces) === ptNum(entry.issuePieces)
    && now - (Date.parse(r.addedAt || '') || 0) < 120000) || null;
}

` + B);
fs.writeFileSync(P, s.split(LF).join(CR + LF));

let t = fs.readFileSync(T, 'utf8');
const ex = 'voStampOrders, ordBookCsv, qcOrdersFor, ordQcOf,';
if (t.split(ex).length !== 2) throw new Error('exports');
t = t.replace(ex, () => ex + ' bdTwinOf,');
const end = `  /* ---- the export carries what the screen shows ---- */`;
const E = t.indexOf(end.split(LF).join(CR + LF)) >= 0 ? end.split(LF).join(CR + LF) : end;
if (t.split(E).length !== 2) throw new Error('test anchor');
const NL = E.indexOf(CR) >= 0 ? CR + LF : LF;
t = t.replace(E, () => [
  '  /* ---- THE SAME ISSUE, SAVED TWICE ---- eleven pairs in the live register, 0 to 47 seconds apart. */',
  '  {',
  "    const keepBase = A.PT().base, iso = ms => new Date(Date.now() - ms).toISOString();",
  "    const e = { empName: 'Anita', sku: 'S-A', orderNo: 'O-1', issuePieces: 5 };",
  "    A.setPT(Object.assign(A.PT(), { base: [Object.assign({ id: 't1', addedAt: iso(20000) }, e)] }));",
  "    ok('an identical issue saved twenty seconds ago is noticed', !!A.bdTwinOf(e));",
  "    ok('…but not a different number of pieces', !A.bdTwinOf(Object.assign({}, e, { issuePieces: 6 })));",
  "    ok('…nor another karigar, SKU or order', !A.bdTwinOf(Object.assign({}, e, { empName: 'Soniya' })) && !A.bdTwinOf(Object.assign({}, e, { sku: 'S-B' })) && !A.bdTwinOf(Object.assign({}, e, { orderNo: 'O-2' })));",
  "    A.setPT(Object.assign(A.PT(), { base: [Object.assign({ id: 't1', addedAt: iso(10 * 60000) }, e)] }));",
  "    ok('…nor the same issue ten minutes later, which is simply a second issue', !A.bdTwinOf(e));",
  "    A.setPT(Object.assign(A.PT(), { base: [Object.assign({ id: 't1', addedAt: iso(5000) }, e, { orderNo: '' })] }));",
  "    ok('a custom order, which names no order, is caught the same way', !!A.bdTwinOf(Object.assign({}, e, { orderNo: '' })));",
  '    A.setPT(Object.assign(A.PT(), { base: keepBase }));',
  '  }', '', E].join(NL));
fs.writeFileSync(T, t);
console.log('written');
