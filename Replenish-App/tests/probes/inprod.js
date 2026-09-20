/* WHAT "IN PRODUCTION" WOULD SAY IF IT CAME FROM THE ORDER CONSOLE INSTEAD OF AN UPLOAD. Read-only.
 *
 * Today the column is a workbook somebody uploads (Firestore repl/inproduction): SKU, Qty, Start,
 * Ready, Supplier. The Order Console already knows, line by line, what is on order and how far it has
 * got. This asks whether the second can replace the first: do the SKUs even match, how big is each
 * candidate definition, and is there a date to put against it.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const jget = url => new Promise((res, rej) => https.get(url, { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(url.slice(-40) + ': ' + d.slice(0, 160))); } }); }).on('error', rej));
  const get = p => jget(DB + '/' + p + '.json');
  const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v)) : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : o[k]))).filter(Boolean);
  const U = s => String(s == null ? '' : s).trim().toUpperCase(), N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const H = t => console.log('\n== ' + t + ' ==');
  /* Firestore's REST shape: {fields:{k:{stringValue|integerValue|arrayValue...}}} */
  const fv = v => v == null ? null
    : v.stringValue !== undefined ? v.stringValue
    : v.integerValue !== undefined ? Number(v.integerValue)
    : v.doubleValue !== undefined ? v.doubleValue
    : v.booleanValue !== undefined ? v.booleanValue
    : v.timestampValue !== undefined ? v.timestampValue
    : v.nullValue !== undefined ? null
    : v.arrayValue !== undefined ? (v.arrayValue.values || []).map(fv)
    : v.mapValue !== undefined ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fv(x)]))
    : null;
  const fdoc = d => Object.fromEntries(Object.entries((d && d.fields) || {}).map(([k, v]) => [k, fv(v)]));

  const [obR, baseR, cutR, pressR, fgR, spR, mdbR] = await Promise.all(
    ['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_fgiLedger', 'pt_shopProd', 'pt_masterDB'].map(get));
  const ob = list(obR), base = list(baseR), cut = list(cutR), press = list(pressR), fg = list(fgR), mdb = list(mdbR);
  const sp = spR || {};

  /* ---- the uploaded list, out of Firestore ---- */
  const meta = fdoc(await jget(FS + '/repl/inproduction'));
  let up = [];
  if (meta.chunks) {
    const got = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => jget(FS + '/repl_inprod/' + i)));
    got.forEach(g => { const d = fdoc(g); (d.r || []).forEach(x => up.push(x)); });
  } else up = meta.rows || [];

  H('1. THE UPLOADED LIST AS IT STANDS');
  console.log('uploaded at        : ' + (meta.at || '(unknown)') + '   by ' + (meta.by || '?'));
  console.log('rows               : ' + up.length + '   (meta says ' + meta.n + ')');
  const upBy = {};
  up.forEach(r => { const k = U(r.sku); if (!k) return; const e = upBy[k] || (upBy[k] = { qty: 0, noDate: 0 });
    e.qty += N(r.qty); if (!String(r.ready || '').trim()) e.noDate += N(r.qty); });
  const upTot = Object.values(upBy).reduce((a, e) => a + e.qty, 0);
  const upNoDate = Object.values(upBy).reduce((a, e) => a + e.noDate, 0);
  console.log('distinct SKUs      : ' + Object.keys(upBy).length);
  console.log('total units        : ' + upTot);
  console.log('with no Ready Date : ' + upNoDate + '   (' + Math.round(upNoDate / (upTot || 1) * 100) + '%)');
  console.log('a sample row       : ' + JSON.stringify(up[0]));

  H('2. WHAT THE ORDER BOOK LOOKS LIKE');
  console.log('order-book rows    : ' + ob.length);
  const keys = {}; ob.forEach(r => Object.keys(r).forEach(k => { keys[k] = (keys[k] || 0) + 1; }));
  console.log('fields present     :');
  Object.entries(keys).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log('   ' + k.padEnd(18) + n));
  console.log('a sample row       : ' + JSON.stringify(ob.find(r => U(r.sku))));

  /* ---- rebuild the console's own figures, the same way ordLinesBuild does ---- */
  const mdbBy = {}; mdb.forEach(m => { const k = U(m.sku); if (k && !mdbBy[k]) mdbBy[k] = m; });
  const pieces = r => (r.src === 'SHP' ? (N(r.pcs) || N(r.qty)) : N(r.qty));
  const lineKey = r => U(r.orderNo) + '|' + U(r.sku);
  const sum = (rows, f) => { const m = {}; rows.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return; const k = lineKey(r); m[k] = (m[k] || 0) + f(r); }); return m; };
  const recvM = sum(base, r => N(r.receivedPieces));
  const pressM = sum(press, r => N(r.pieces));
  /* Finished goods that name this order and SKU: what has already reached the store. */
  const fgM = {}; fg.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return; const k = lineKey(r);
    const t = String(r.txnType || r.type || '').toUpperCase();
    fgM[k] = (fgM[k] || 0) + (/RETURN|OUT|ISSUE|FBA/.test(t) ? 0 : N(r.pieces || r.qty)); });

  const lines = {};
  ob.forEach(r => { const no = U(r.orderNo), s = U(r.sku); if (!no || !s) return;
    const k = no + '|' + s; const e = lines[k] || (lines[k] = { orderNo: no, sku: s, qty: 0, orderDate: r.orderDate || '', src: r.src || '' });
    e.qty += pieces(r); if (!e.orderDate && r.orderDate) e.orderDate = r.orderDate; });
  let openLines = 0, openQty = 0, A = 0, B = 0, C = 0, D = 0;
  const bySku = {};
  Object.entries(lines).forEach(([k, l]) => {
    const spRow = sp[l.orderNo + '__' + l.sku] || null;
    const handed = !!(spRow && spRow.handedAt);
    const made = recvM[k] || 0, pressed = pressM[k] || 0, store = fgM[k] || 0;
    const open = l.src === 'SHP' ? !handed : pressed < l.qty;
    if (!open) return;
    openLines++; openQty += l.qty;
    const a = Math.max(0, l.qty - made);            // still to make
    const b = Math.max(0, l.qty - pressed);         // not yet pressed
    const c = l.qty;                                // the whole open line
    const d = Math.max(0, l.qty - store);           // not yet in the finished-goods store
    A += a; B += b; C += c; D += d;
    const e = bySku[l.sku] || (bySku[l.sku] = { a: 0, b: 0, c: 0, d: 0, orders: 0, dates: [] });
    e.a += a; e.b += b; e.c += c; e.d += d; e.orders++; if (l.orderDate) e.dates.push(l.orderDate);
  });

  H('3. FOUR CANDIDATE DEFINITIONS, ON LIVE DATA');
  console.log('open order lines                                 : ' + openLines + '  (' + openQty + ' pieces ordered)');
  console.log('  A  still to make      (ordered - received)      : ' + A);
  console.log('  B  not yet pressed    (ordered - pressed)       : ' + B);
  console.log('  C  the whole open line (ordered)                : ' + C);
  console.log('  D  not yet in the store (ordered - FG receipts) : ' + D);
  console.log('distinct SKUs on open lines                      : ' + Object.keys(bySku).length);
  console.log('the uploaded list says                           : ' + upTot + ' units over ' + Object.keys(upBy).length + ' SKUs');

  H('4. DO THE TWO EVEN SPEAK THE SAME SKU?');
  const conS = new Set(Object.keys(bySku)), upS = new Set(Object.keys(upBy));
  const both = [...conS].filter(k => upS.has(k));
  console.log('SKUs on open order lines        : ' + conS.size);
  console.log('SKUs on the uploaded list       : ' + upS.size);
  console.log('in BOTH                         : ' + both.length);
  console.log('only the console knows about    : ' + (conS.size - both.length));
  console.log('only the upload knows about     : ' + (upS.size - both.length));
  const inMdb = [...upS].filter(k => mdbBy[k]).length;
  console.log('uploaded SKUs that exist in the master database   : ' + inMdb + ' of ' + upS.size);
  console.log('\nBiggest differences where both know the SKU (upload vs A):');
  both.map(k => [k, upBy[k].qty, bySku[k].a]).sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))
    .slice(0, 12).forEach(([k, u, a]) => console.log('   ' + k.padEnd(22) + 'upload ' + String(u).padStart(7) + '   console ' + String(a).padStart(7) + '   diff ' + (a - u)));
  console.log('\nBiggest the upload alone carries:');
  [...upS].filter(k => !conS.has(k)).map(k => [k, upBy[k].qty]).sort((x, y) => y[1] - x[1]).slice(0, 10)
    .forEach(([k, q]) => console.log('   ' + k.padEnd(22) + q + (mdbBy[k] ? '' : '   (not in the master database either)')));

  H('5. IS THERE A DATE TO PUT AGAINST IT?');
  const withDate = Object.values(bySku).filter(e => e.dates.length).length;
  console.log('SKUs whose open lines carry an order date : ' + withDate + ' of ' + Object.keys(bySku).length);
  const dated = ob.filter(r => String(r.orderDate || '').trim()).length;
  console.log('order-book rows with an order date        : ' + dated + ' of ' + ob.length);
  ['dueDate', 'deliveryDate', 'readyDate', 'promiseDate', 'shipBy', 'deliveryOn'].forEach(f => {
    const n = ob.filter(r => String(r[f] || '').trim()).length;
    console.log('order-book rows with ' + f.padEnd(14) + ': ' + n);
  });
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
