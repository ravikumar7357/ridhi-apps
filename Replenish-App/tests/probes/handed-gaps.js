/* Lines the shipping team has taken, and what the registers say was made for them. Read-only:
 * uses the deployed app's own code against the live database. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global).A;
  const [ob, base, cut, press, sp, qc, fg, vo] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData',
    'pt_pressInventory', 'pt_shopProd', 'pt_qcChecks', 'pt_fgiLedger', 'pt_vendorOrders'].map(get));
  const L = A.ptList;
  A.setPTG(Object.assign(A.PTG(), { ob: L(ob), mdb: L(await get('pt_masterDB')), press: L(press), shopProd: sp || {} }));
  A.setPT(Object.assign(A.PT(), { base: L(base), cut: L(cut) }));
  A.setQC(Object.assign({}, A.QC(), { checks: L(qc), issue: [], ret: [] }));
  A.setFGI(Object.assign({}, A.FGI(), { rows: L(fg) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  A.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  A.setORD({ req: {}, busy: false, at: '', rows: [] });

  const all = A.ordLines();
  const handed = all.filter(r => r.handedAt);
  const gap = handed.filter(r => r.pendingMake > 0 || r.pendingCut > 0);
  const sum = (a, f) => Math.round(a.reduce((t, r) => t + (r[f] || 0), 0));
  console.log('order lines in the book: ' + all.length + '  ·  Shopify: ' + all.filter(r => r.src === 'SHP').length);
  console.log('HANDED OVER to shipping: ' + handed.length + ' line(s), ' + sum(handed, 'qty') + ' pieces');
  console.log('  …of which the registers show work still outstanding: ' + gap.length + ' line(s)');
  console.log('      still "to cut"   : ' + sum(gap, 'pendingCut') + ' pieces');
  console.log('      still "to make"  : ' + sum(gap, 'pendingMake') + ' pieces');
  console.log('      still "to press" : ' + sum(handed, 'madeToPress') + ' pieces');
  const none = handed.filter(r => !r.received && !r.cut && !r.issued);
  console.log('  …with NOTHING recorded at all (no cut, no issue, no receipt): ' + none.length + ' line(s), ' + sum(none, 'qty') + ' pieces');
  const open = all.filter(r => r.open);
  console.log('\nthe console\'s outstanding totals, as they stand:');
  console.log('  still to cut  : ' + sum(all, 'pendingCut') + '   of which on handed-over lines: ' + sum(handed, 'pendingCut'));
  console.log('  still to make : ' + sum(all, 'pendingMake') + '   of which on handed-over lines: ' + sum(handed, 'pendingMake'));
  console.log('  made, to press: ' + sum(all, 'madeToPress') + '   of which on handed-over lines: ' + sum(handed, 'madeToPress'));
  console.log('\nwhen these were handed over:');
  const by = {}; handed.forEach(r => { const m = String(r.handedAt || '').slice(0, 7); by[m] = (by[m] || 0) + 1; });
  Object.keys(by).sort().forEach(m => console.log('   ' + m + '  ' + by[m] + ' line(s)'));
  console.log('\na few of the lines with nothing recorded:');
  none.slice(0, 8).forEach(r => console.log('   ' + r.orderNo.padEnd(12) + r.sku.padEnd(20) + 'ordered ' + String(r.qty).padStart(3)
    + '  cut ' + r.cut + ' issued ' + r.issued + ' received ' + r.received + ' pressed ' + r.pressed + '  handed ' + String(r.handedAt).slice(0, 10)));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
