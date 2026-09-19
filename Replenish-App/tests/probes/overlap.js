/* WHERE THE REGISTERS DISAGREE ABOUT THE SAME PIECES. Read-only.
 *
 * Every register (order book, cutting, Base Data, press, QC, finished goods, vendor orders) is keyed
 * by order number + SKU. This asks, of the live data: which rows carry no order, which carry an order
 * the book does not have, where the book itself repeats a line, and where one stage claims more pieces
 * than the stage before it could have given it.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(p + ': ' + d.slice(0, 120))); } }); }).on('error', rej));
  const list = o => (Array.isArray(o) ? o.map((v, i) => (v && typeof v === 'object' ? Object.assign({ _key: String(i) }, v) : v)) : Object.keys(o || {}).map(k => (o[k] && typeof o[k] === 'object' ? Object.assign({ _key: k }, o[k]) : o[k]))).filter(Boolean);
  const U = s => String(s == null ? '' : s).trim().toUpperCase(), N = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
  const ms = d => { const s = String(d || '').trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return Date.parse(m[0]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; };
  const ym = d => { const t = ms(d); if (!t) return '(no date)'; const x = new Date(t); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
  const [obR, baseR, cutR, pressR, qcR, fgR, soR, voR, mdbR] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory',
    'pt_qcChecks', 'pt_fgiLedger', 'pt_salesOrders', 'pt_vendorOrders', 'pt_masterDB'].map(get));
  const ob = list(obR), base = list(baseR), cut = list(cutR), press = list(pressR), qc = list(qcR), fg = list(fgR), so = list(soR), mdb = list(mdbR);
  const line = r => U(r.orderNo) + '|' + U(r.sku);
  const bookKeys = new Set(ob.filter(r => U(r.orderNo) && U(r.sku)).map(line)), bookOrders = new Set(ob.map(r => U(r.orderNo)).filter(Boolean));
  const ordersOfSku = {}; ob.forEach(r => { const s = U(r.sku); if (!s || !U(r.orderNo)) return; (ordersOfSku[s] = ordersOfSku[s] || new Set()).add(U(r.orderNo)); });
  const H = t => console.log('\n== ' + t + ' ==');

  /* ---- 1. rows that name no order, or an order the book does not have ---- */
  H('1. WORK THAT CANNOT BE TIED TO AN ORDER');
  const reg = [['Job Work Register (Base Data)', base, r => N(r.receivedPieces) || N(r.issuePieces), r => r.issueDate || r.receivingDate],
    ['Cutting', cut, r => N(r.pieces), r => r.cutDate || r.date], ['Press', press, r => N(r.pieces), r => r.entryDate || r.date],
    ['QC checks', qc, r => N(r.checked) || N(r.qty), r => r.date], ['Finished goods ledger', fg, r => N(r.qty), r => r.date]];
  const fixable = {};
  reg.forEach(([name, rows, pcs, when]) => {
    const none = rows.filter(r => !U(r.orderNo)), ghost = rows.filter(r => U(r.orderNo) && U(r.sku) && !bookKeys.has(line(r)));
    const ghostOrder = ghost.filter(r => !bookOrders.has(U(r.orderNo)));
    console.log('  ' + name.padEnd(32) + String(rows.length).padStart(6) + ' rows   no order: ' + String(none.length).padStart(5) + ' (' + Math.round(none.reduce((t, r) => t + pcs(r), 0)) + ' pcs)'
      + '   order+SKU not in the book: ' + String(ghost.length).padStart(4) + '  (of which the ORDER itself is unknown: ' + ghostOrder.length + ')');
    if (!none.length) return;
    const byM = {}; none.forEach(r => { const k = ym(when(r)); byM[k] = (byM[k] || 0) + 1; });
    console.log('      when the no-order rows were made: ' + Object.keys(byM).sort().map(k => k + ':' + byM[k]).join('  '));
    let one = 0, many = 0, zero = 0; none.forEach(r => { const n = (ordersOfSku[U(r.sku)] || new Set()).size; if (n === 1) one++; else if (n > 1) many++; else zero++; });
    console.log('      their SKU is in the book under: exactly ONE order ' + one + ' · several orders ' + many + ' · no order at all ' + zero);
    fixable[name] = { one, many, zero };
  });

  /* ---- 2. the order book repeating itself ---- */
  H('2. THE ORDER BOOK REPEATING A LINE');
  const byLine = {}; ob.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return; (byLine[line(r)] = byLine[line(r)] || []).push(r); });
  const rep = Object.values(byLine).filter(a => a.length > 1);
  const exact = rep.filter(a => new Set(a.map(r => [N(r.qty), r.orderDate, r.src || '', r.color || '', r.size || ''].join('|'))).size === 1);
  console.log('  order+SKU pairs: ' + Object.keys(byLine).length + ' · appearing more than once: ' + rep.length + ' · of those, IDENTICAL copies (same qty, date, source): ' + exact.length
    + ' → ' + Math.round(exact.reduce((t, a) => t + (a.length - 1) * N(a[0].qty), 0)) + ' pieces counted extra if they are duplicates');
  exact.slice(0, 6).forEach(a => console.log('      ' + line(a[0]).padEnd(40) + a.length + ' × ' + N(a[0].qty) + '   ids: ' + a.map(r => r._key || r.id).join(', ').slice(0, 70)));
  /* a sales order pushed into the book more than once */
  const soByNo = {}; so.forEach(o => { const no = U(o.orderNo || o.id); (soByNo[no] = soByNo[no] || []).push(o); });
  console.log('  sales orders sharing an order number: ' + Object.values(soByNo).filter(a => a.length > 1).length);
  const soLines = o => list(o.lines);
  let soBookMismatch = 0; const mm = [];
  so.filter(o => /approv/i.test(o.status || '')).forEach(o => { const no = U(o.orderNo || o.id);
    soLines(o).forEach(l => { const k = no + '|' + U(l.sku); const inBook = (byLine[k] || []).reduce((t, r) => t + N(r.qty), 0), want = N(l.qty);
      if (U(l.sku) && Math.abs(inBook - want) > 0.01) { soBookMismatch++; if (mm.length < 6) mm.push(k + '  sales order says ' + want + ', order book holds ' + inBook); } }); });
  console.log('  approved sales-order lines whose quantity in the order book is DIFFERENT: ' + soBookMismatch); mm.forEach(x => console.log('      ' + x));

  /* ---- 3. a stage claiming more than the one before it ---- */
  H('3. ONE STAGE HOLDING MORE PIECES THAN THE STAGE BEFORE COULD HAVE GIVEN IT');
  const sum = (rows, f) => { const m = {}; rows.forEach(r => { if (!U(r.orderNo) || !U(r.sku)) return; m[line(r)] = (m[line(r)] || 0) + f(r); }); return m; };
  const ordered = sum(ob, r => N(r.qty) * (N(r.packOf) || 1)), cutM = sum(cut, r => N(r.pieces) - N(r.rejPieces)), issued = sum(base, r => N(r.issuePieces)),
    recv = sum(base, r => N(r.receivedPieces)), pressed = sum(press, r => N(r.pieces)), store = sum(fg.filter(r => /in|recv|receive/i.test(r.type || 'in')), r => N(r.qty));
  const over = (a, b, la, lb) => { const k = Object.keys(a).filter(x => a[x] > (b[x] || 0) + 0.01); console.log('  ' + (la + ' more than ' + lb).padEnd(34) + String(k.length).padStart(5) + ' lines   '
    + Math.round(k.reduce((t, x) => t + a[x] - (b[x] || 0), 0)) + ' pieces'); return k; };
  over(cutM, ordered, 'cut', 'ordered'); over(issued, ordered, 'issued', 'ordered'); over(recv, issued, 'received', 'issued');
  over(recv, ordered, 'received', 'ordered'); const pr = over(pressed, recv, 'pressed', 'received'); over(pressed, ordered, 'pressed', 'ordered');

  /* ---- 4. the same work under two names ---- */
  H('4. THE SAME THING UNDER TWO NAMES');
  const skuSeen = {}; mdb.forEach(m => { const k = U(m.sku); if (k) (skuSeen[k] = skuSeen[k] || []).push(m.sku); });
  const dupSku = Object.values(skuSeen).filter(a => a.length > 1);
  console.log('  SKUs in the master more than once: ' + dupSku.length + '  ' + dupSku.slice(0, 5).map(a => JSON.stringify(a)).join(' '));
  const orderSpell = {}; [ob, base, cut, press].forEach(rows => rows.forEach(r => { const raw = String(r.orderNo || ''); if (!raw.trim()) return; (orderSpell[U(raw).replace(/[\s_-]+/g, '')] = orderSpell[U(raw).replace(/[\s_-]+/g, '')] || new Set()).add(U(raw)); }));
  const odd = Object.values(orderSpell).filter(s => s.size > 1);
  console.log('  order numbers written more than one way (spaces / dashes): ' + odd.length + '  ' + odd.slice(0, 6).map(s => [...s].join(' ≈ ')).join('   '));
  const baseDup = {}; base.forEach(r => { const k = [U(r.orderNo), U(r.sku), U(r.empName), r.issueDate, N(r.issuePieces), N(r.receivedPieces)].join('|'); (baseDup[k] = baseDup[k] || []).push(r); });
  const bd = Object.values(baseDup).filter(a => a.length > 1);
  console.log('  Job Work rows that are IDENTICAL (same order, SKU, karigar, date, pieces): ' + bd.length + ' groups, ' + bd.reduce((t, a) => t + a.length - 1, 0) + ' extra rows, '
    + Math.round(bd.reduce((t, a) => t + (a.length - 1) * N(a[0].receivedPieces), 0)) + ' received pieces that may be paid twice');
  const pressDup = {}; press.forEach(r => { const k = [U(r.orderNo), U(r.sku), r.entryDate || r.date, N(r.pieces)].join('|'); (pressDup[k] = pressDup[k] || []).push(r); });
  console.log('  press rows that are identical: ' + Object.values(pressDup).filter(a => a.length > 1).length + ' groups');
  const cutDup = {}; cut.forEach(r => { const k = [U(r.orderNo), U(r.sku), r.cutDate || r.date, N(r.pieces)].join('|'); (cutDup[k] = cutDup[k] || []).push(r); });
  console.log('  cutting rows that are identical: ' + Object.values(cutDup).filter(a => a.length > 1).length + ' groups');

  fs.writeFileSync(pathm.join(__dirname, 'overlap-last.json'), JSON.stringify({ at: new Date().toISOString(), fixable }, null, 2));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
