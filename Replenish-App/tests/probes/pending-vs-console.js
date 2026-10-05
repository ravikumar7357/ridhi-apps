/* Ravi's "All Shopify Order Pending" sheet against the Order Console's SHP lines, as the app's own code computes them
 * from the live database. Read-only. Writes the JSON the Excel is built from.
 *   node probes/pending-vs-console.js "<sheet.json>" "<out.json>"   (sheet.json = rows [order, sku, qty, status, stock, date, product, ff]) */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const [ob, base, cut, press, qc, mdb, sp] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_shopProd'].map(get));
  const app = A.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press), shopProd: sp || {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setORD({ req: {}, busy: false, at: '', rows: [] });
  const lines = app.ordLines().filter(l => process.env.PFX ? l.orderNo.indexOf(process.env.PFX) === 0 : (l.src === 'SHP' || /^SHP-/.test(l.orderNo))).map(l => ({ mtoDue: l.mtoDue, mtoLate: l.mtoLate, mtoOpen: l.mtoOpen,
    orderNo: l.orderNo, shop: String(l.shopOrderNo || '').replace(/\s+/g, ''), sku: l.sku, qty: l.qty, open: !!l.open, made: Math.min(l.qty, l.pressed || 0),
    handedAt: l.handedAt || '', shopDoneAt: l.shopDoneAt || '', shopDoneWhy: l.shopDoneWhy || '', orderDate: l.orderDate || '',
    item: [l.articleSubtype || l.articleType || l.itemName, l.color, l.size].filter(Boolean).join(' · '), waiting: l.open ? app.ordWaitingAt(l) : '' }));
  fs.writeFileSync(process.argv[3], JSON.stringify(lines));
  console.log('SHP lines', lines.length, 'open', lines.filter(l => l.open).length);
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
