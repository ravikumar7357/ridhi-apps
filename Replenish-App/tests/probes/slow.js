/* WHERE THE BROWSER'S TIME GOES, ON THE REAL DATABASE. Read-only.
 *
 *   node slow.js
 *
 * Ravi, 2026-09-24: "system bahut hang ho rha h abhi."
 *
 * weight.js answers the wire half — 6.4 MB before anything appears. This is the other half: the
 * deployed app's OWN code (sliced out of index.html by the prod-test harness, not a copy of it) run
 * against what the database holds right now, with a clock on each screen. A render that takes a
 * second here takes longer on his machine, and the first number over ~200 ms is the hang.
 *
 * Every path is run twice: cold, then again. A second run that is much faster is a cache doing its
 * job; a second run just as slow is work being repeated on every keystroke.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(p + ': ' + d.slice(0, 120))); } }); }).on('error', rej));

  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList;

  const [masters, mdb, ob, press, cut, base, shopProd, vo, fab] = await Promise.all(
    ['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory', 'pt_cuttingData',
     'pt_baseData', 'pt_shopProd', 'pt_vendorOrders', 'pt_fabInvLedger'].map(get));

  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb), ob: L(ob),
    press: L(press), shopProd: shopProd || {}, freeze: {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  app.setFAB({ rows: L(fab), err: '', busy: false, at: '', shown: [] });
  app.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
  if (app.setORD_DEM) app.setORD_DEM({ tried: true, busy: false, fabOk: true, voOk: true });

  console.log('live: ' + L(ob).length + ' order-book rows, ' + L(mdb).length + ' masters, '
    + L(base).length + ' base-data rows, ' + rows.length + ' vendor orders\n');

  const time = (name, f) => {
    let a = Date.now(); let out;
    try { out = f(); } catch (e) { console.log('   ' + name.padEnd(42) + 'FAILED — ' + (e.message || e)); return; }
    const cold = Date.now() - a;
    a = Date.now();
    try { f(); } catch (e) { /* the cold number is the one that matters */ }
    const warm = Date.now() - a;
    const flag = cold > 1000 ? '   <<< HANG' : (cold > 250 ? '   <- slow' : '');
    console.log('   ' + name.padEnd(42) + String(cold).padStart(6) + ' ms cold'
      + String(warm).padStart(7) + ' ms again' + flag
      + (out && out.length ? '   (' + out.length + ')' : ''));
  };

  console.log('=== the order book');
  time('ordLines() — every line, from scratch', () => { app.setORD(Object.assign(app.ORD(), { rows: [] })); return app.ordLines(); });
  time('ordLines() — asked for again', () => app.ordLines());
  els.odView.value = 'book';
  time('renderOrd() — the order book table', () => app.renderOrd());
  els.odQ.value = 'tablecloth';
  time('renderOrd() — one letter typed in the search', () => app.renderOrd());
  els.odQ.value = '';
  els.odView.value = 'shopsku';
  time('renderOrd() — Shopify by SKU', () => app.renderOrd());
  els.odView.value = 'demand';
  time('renderOrd() — the new Demand view', () => app.renderOrd());
  if (app.ordDemandRows) time('ordDemandRows() on its own', () => app.ordDemandRows().rows);
  els.odView.value = 'book';

  console.log('\n=== the pieces underneath');
  if (app.pafNeed) time('pafNeed() — cloth from the printers', () => app.pafNeed().byFab);
  if (app.recipeCombos) time('recipeCombos() — the recipe screen', () => app.recipeCombos());
  if (app.ordProdRows) time('ordProdRows()', () => app.ordProdRows());
  if (app.fabFlowRows) time('fabFlowRows() — the fabric ledger', () => app.fabFlowRows(L(fab)));

  console.log('\n=== the same work one master row at a time (2,927 lines ask for these)');
  const some = L(mdb).slice(0, 2000);
  time('ptPrintFabric x 2000', () => { some.forEach(m => app.ptPrintFabric(m)); return null; });
  time('ptPrintNeeded x 2000', () => { some.forEach(m => app.ptPrintNeeded(m)); return null; });
})().catch(e => { console.error(e.message); process.exit(1); });
