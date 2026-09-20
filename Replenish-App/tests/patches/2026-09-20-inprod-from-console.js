/* "IN PRODUCTION" NOW COMES FROM THE ORDER CONSOLE, NOT FROM A WORKBOOK SOMEBODY UPLOADS.
 *
 * What was there: a CSV of SKU / Qty / Start / Ready / Supplier, replaced by hand. The live one was
 * uploaded on 29 Aug and has not moved since - 234,847 units, of which 70,153 are on SKUs with no
 * open order line at all. Twenty-two days of orders placed, made and finished are invisible to it.
 *
 * AND EVERY ONE OF ITS DATES WAS BEING THROWN AWAY. The workbook writes "29-09-2026"; inProdReadyMap
 * parsed it with new Date(d + 'T00:00:00'), which only understands YYYY-MM-DD. Every row came back
 * Invalid Date, so every row was marked "no date" and given an ASSUMED ready date of a full
 * production cycle from today. That is the "no date" tag on every line of Ravi's screen. The import's
 * own warning never fired, because the cell was not empty - it just never parsed. Both ends are fixed
 * here: the date reader now understands DD-MM-YYYY too, and the new source writes ISO anyway.
 *
 * WHAT THE NEW FIGURE IS. Over the Order Console's own lines, the ones it calls OPEN: ordered minus
 * pressed. Pressing is the last stage in the factory and the console closes a line at it, so
 * "ordered - pressed" is exactly what is still being made. Measured: 163,929 pieces over 1,609 SKUs
 * on 2,401 open lines, and 99% of it carries a real delivery date off the sales order behind it.
 *
 * THE READY DATE IS THE ORDER'S OWN PROMISE, not a guess: the sales-order line's deliveryDate, or the
 * order's, earliest first. A line whose order promised nothing still has no date and still says so.
 *
 * NOBODY UPLOADS THIS ANY MORE, so Template and Import go with it. Leaving a button that writes a
 * list nothing reads is how somebody spends a day wondering why their upload changed nothing. The
 * old Firestore documents are left exactly where they are - this reads a different source, it does
 * not delete anybody's data.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};
const BS = String.fromCharCode(92);       // patch scripts and backslashes do not mix; build them

/* ---- 1. the source ---- */
one('/* ================= IN PRODUCTION (uploaded) ================= */',
[
'/**',
' * A date as the registers write it, turned into YYYY-MM-DD - or an empty string when it is not a',
' * date at all.',
' *',
' * TWO SHAPES ARE IN THE DATA and only one of them parsed. Sales orders write ISO; the production',
' * workbook and the vendor orders write DD-MM-YYYY. Handing the second to new Date gives Invalid',
' * Date, which is how 234,847 units came to be marked "no date" while every row had one.',
' */',
'function pdIso(v) {',
"  const d = String(v == null ? '' : v).trim();",
"  if (!d) return '';",
'  let m = d.match(/^(' + BS + 'd{4})-(' + BS + 'd{2})-(' + BS + 'd{2})/);',
"  if (m) return m[1] + '-' + m[2] + '-' + m[3];",
'  m = d.match(/^(' + BS + 'd{1,2})[-' + BS + '/.](' + BS + 'd{1,2})[-' + BS + '/.](' + BS + 'd{4})/);   // day first, as India writes it',
"  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');",
"  return '';",
'}',
'',
'/**',
' * Order + SKU -> the date that order promised, earliest first.',
' *',
" * The line's own delivery date where it has one, else the order's. This is a PROMISE, not a guess:",
' * a line whose order said nothing gets nothing here and is shown as undated.',
' */',
'function ordDueIndex() {',
'  const m = new Map();',
'  (SOX.rows || []).forEach(o => {',
'    if (!o) return;',
'    const no = obUC(o._id || o._key), ord = pdIso(o.deliveryDate);',
'    soLines(o).forEach(l => {',
'      const d = pdIso(l.deliveryDate) || ord;',
'      if (!d) return;',
"      const k = no + '|' + obUC(l.sku);",
'      const cur = m.get(k);',
'      if (!cur || d < cur) m.set(k, d);',
'    });',
'  });',
'  return m;',
'}',
'',
'/**',
' * WHAT IS BEING MADE RIGHT NOW, read off the Order Console.',
' *',
' * One row per open order line, in the shape the In Production list has always had, so everything',
' * downstream - the map, the forecast, the India Stock projection, the exports - is unchanged.',
' *',
' * ORDERED MINUS PRESSED. Pressing is the last stage inside the factory and the console closes a line',
' * at it, so a piece that is through the press is finished goods, not production. A Shopify line stays',
' * open until shipping takes it; if its pieces are already pressed it contributes nothing here, which',
' * is right - it is waiting to go out, not waiting to be made.',
' *',
' * `supplier` carries the ORDER NUMBER. That is what the floor asks about now that everything goes by',
' * order, and it means the cell can say which orders a total is made of instead of one bare figure.',
' */',
'function ordProdRows() {',
'  const due = ordDueIndex();',
'  const out = [];',
'  ordLines().forEach(r => {',
'    if (!r.open) return;',
'    const left = Math.max(0, r.qty - r.pressed);',
'    if (!left) return;',
'    out.push({ sku: r.sku, qty: left, start: pdIso(r.orderDate),',
"      ready: due.get(r.orderNo + '|' + r.sku) || '',",
'      supplier: r.orderNo, orderNo: r.orderNo,',
'      /* Which stage it is sitting at, from the line`s own figures - no vendor or finished-goods read,',
'       * so this stays a cheap screen to open. */',
"      stage: r.pendingCut > 0 ? 'to cut' : (r.pendingMake > 0 ? 'to make' : (r.madeToPress > 0 ? 'to press' : 'made')) });",
'  });',
'  return out;',
'}',
'',
'/* ================= IN PRODUCTION (from the Order Console) ================= */',
].join(LF), 'pdIso, ordDueIndex and ordProdRows');

/* ---- 2. load it from there ---- */
one([
'async function loadInProd() {',
'  INPROD_ROWS = []; INPROD_AT = null;',
'  try {',
"    const meta = await getDoc(doc(db, 'repl', 'inproduction'));",
'    if (!meta.exists()) { INPROD_LOADED = true; return; }',
'    const d = meta.data();',
'    INPROD_AT = d.at && d.at.toDate ? d.at.toDate() : null;',
'    let rows = [];',
'    if (d.chunks) {',
"      const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'repl_inprod', String(i)))));",
'      got.forEach(s => { if (s.exists()) rows = rows.concat(s.data().r || []); });',
'    } else rows = d.rows || [];',
'    INPROD_ROWS = rows;',
'  } catch (e) { INPROD_ROWS = []; }',
'  INPROD_LOADED = true;',
'}',
'async function saveInProd(rows) {',
'  const chunks = Math.ceil(rows.length / PD_CHUNK) || 1;',
"  for (let i = 0; i < chunks; i++) await setDoc(doc(db, 'repl_inprod', String(i)), { r: rows.slice(i * PD_CHUNK, (i + 1) * PD_CHUNK) });",
"  await setDoc(doc(db, 'repl', 'inproduction'), { chunks, n: rows.length, rows: null, by: ME.email, at: serverTimestamp() });",
'}',
].join(LF),
[
'/**',
' * READ THE ORDER BOOK AND THE REGISTERS, then build the list from them.',
' *',
' * pt_salesOrders is read straight rather than through ensureSox, which would paint the Sales Orders',
' * screen as a side effect of opening Replenishment.',
' *',
' * A FAILED READ LEAVES THE LIST EMPTY AND SAYS WHY. An empty In Production column makes the forecast',
' * ask for production that may already be running, so this is the one case where the screen has to',
' * carry the reason rather than quietly show a dash.',
' */',
'async function loadInProd() {',
"  INPROD_ROWS = []; INPROD_AT = null; INPROD_ERR = '';",
'  try {',
'    if (!PTG.mdb) await ptLoadGates();',
'    if (PTG.err) throw new Error(PTG.err);',
"    if (SOX.rows === null) SOX.rows = ptList(await ptGet('pt_salesOrders'));",
'    INPROD_ROWS = ordProdRows();',
'    INPROD_AT = new Date();',
'  } catch (e) { INPROD_ROWS = []; INPROD_ERR = e.message || String(e); }',
'  INPROD_LOADED = true;',
'}',
].join(LF), 'loadInProd reads the console');

one('let INPROD_ROWS = [], INPROD_AT = null, INPROD_LOADED = false, PD_LAST = [];',
  "let INPROD_ROWS = [], INPROD_AT = null, INPROD_LOADED = false, PD_LAST = [], INPROD_ERR = '';",
  'the error carrier');

/* ---- 3. the date reader understands both shapes ---- */
one([
"    const d = String(r.ready || '').trim();",
"    let ms = d ? new Date(d + 'T00:00:00').getTime() : NaN;",
].join(LF),
[
'    /* pdIso FIRST. "29-09-2026" is a date; new Date("29-09-2026T00:00:00") is not, and every row of',
'     * the old workbook fell into the guess below because of it. */',
'    const d = pdIso(r.ready);',
"    let ms = d ? new Date(d + 'T00:00:00').getTime() : NaN;",
].join(LF), 'DD-MM-YYYY parses');

/* ---- 4. the screen says where it comes from ---- */
one('<select id="pdSupplier" style="flex:0 0 150px"><option value="">All suppliers</option></select>',
  '<select id="pdSupplier" style="flex:0 0 150px" title="The order a SKU is being made against."><option value="">All orders</option></select>',
  'the filter says orders');

one([
'          <button id="pdTemplate" class="ghost">Template</button>',
'          <button id="pdExport" class="ghost">Export</button>',
'          <button id="pdImport" class="ghost">Import</button>',
'          <input id="pdFile" type="file" accept=".csv,text/csv" style="display:none">',
].join(LF),
'          <button id="pdExport" class="ghost">Export</button>', 'Template and Import go');

one("fillSel('pdSupplier', rows.flatMap(r => (r.supplier || '').split(', ')), 'All suppliers');",
  "fillSel('pdSupplier', rows.flatMap(r => (r.supplier || '').split(', ')), 'All orders');", 'and its label');

one("  const when = INPROD_AT ? INPROD_AT.toLocaleString() : 'never uploaded';",
[
'  /* WHERE THE FIGURE COMES FROM, on the screen that shows it. It is the Order Console`s open lines as',
'   * of this read - not a workbook, and not something anybody has to remember to refresh. */',
"  const when = INPROD_ERR ? 'COULD NOT READ THE ORDER BOOK - ' + INPROD_ERR",
"    : (INPROD_AT ? 'from the Order Console, read ' + INPROD_AT.toLocaleString() : 'not read yet');",
].join(LF), 'the KPI head says its source');

/* The India Stock panel next door still says "last upload", and truthfully — that one IS still a
 * workbook. So the anchor carries this panel's own name with it. */
one('plan &amp; check</span><span class="kpiwhen">last upload: ',
  'plan &amp; check</span><span class="kpiwhen"${INPROD_ERR ? Q style="color:var(--bad)"Q : QQ}>'
    .replace(/Q/g, String.fromCharCode(39)),
  'and colours a failure');

/* ---- 5. the tooltips stop talking about an upload ---- */
one("      tip: 'Units currently being made, from the In Production tab. The Ready Date decides which month they can first cover \u2014 hover a \u201c\u2190 Production\u201d cell for that.',",
  "      tip: 'Units still being made, from the Order Console: ordered less pressed, over every order line that is still open. The order\u2019s own delivery date decides which month they can first cover \u2014 hover a \u201c\u2190 Production\u201d cell for that.',",
  'the Replenishment column tooltip');

one('title="Counted on an assumed date. Add the Ready Date on the In Production tab for the real month.">no date</span>',
  'title="The order these pieces are on promised no delivery date, so they are counted on an assumed one - a full production cycle from today. Put a delivery date on that sales order for the real month.">no date</span>',
  'and the no-date tag');

one('That batch has no Ready Date, so it is assumed to take a full production cycle',
  'The order behind that batch promised no delivery date, so it is assumed to take a full production cycle',
  'the assumed tag');
one('Add the Ready Date on the In Production tab for the real month.">assumed</span>',
  'Put a delivery date on the sales order for the real month.">assumed</span>', 'and its second half');

one('title="No ready date on the uploaded row, so these units cannot be credited to a month \u2014 they are counted in the total only"',
  'title="The order behind these pieces promised no delivery date, so they cannot be credited to a month \u2014 they are counted in the total only"',
  'and the India Stock projection');

/* ---- 6. the handlers that no longer have a button ---- */
one("$('pdTemplate').onclick = () => csvDownload('in-production-template', PD_COLS, [['ABC-123', '200', '2026-07-20', '2026-08-15', 'Factory A']]);" + LF, '', 'the Template handler');

/* The importer, from its first line to the close of its onchange. */
const impStart = "$('pdImport').onclick = () => $('pdFile').click();";
const impEnd = "  } catch (err) { $('pdMsg').textContent = 'Import failed: ' + (err.message || err); }" + LF + '};' + LF;
const i0 = s.indexOf(impStart), i1 = s.indexOf(impEnd);
if (i0 < 0 || i1 < i0) throw new Error('the importer is not where it was');
s = s.slice(0, i0) + s.slice(i1 + impEnd.length);
if (s.indexOf('saveInProd') >= 0) throw new Error('saveInProd is still referenced');
if (s.indexOf('pdFile') >= 0) throw new Error('pdFile is still referenced');
if (s.indexOf('pdImport') >= 0) throw new Error('pdImport is still referenced');
if (s.indexOf('pdTemplate') >= 0) throw new Error('pdTemplate is still referenced');
console.log('  ok   the importer and everything that fed it');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
