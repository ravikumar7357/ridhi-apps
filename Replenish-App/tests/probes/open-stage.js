/* Every OPEN order line (all channels) with the Production flow's own state (flowState) from the live database. Read-only.
 *   node probes/shop-stage.js <out.json> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(p + ': ' + d.slice(0, 200))); } }); }).on('error', rej));
  global.__kaStore = { flowReal: '1' };
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const names = ['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_shopProd', 'pt_vendorOrders',
    'pt_ppc', 'pt_flowDemand', 'pt_accReserve', 'pt_flowChallans', 'pt_flowPrintOrders', 'pt_flowFgSend'];
  const d = {}; for (const n of names) { const t = Date.now(); d[n] = await get(n); console.log('got', n, Date.now() - t, 'ms'); }
  const app = A.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(d.pt_orderBook), mdb: L(d.pt_masterDB), press: L(d.pt_pressInventory), shopProd: d.pt_shopProd || {} }));
  app.setPT(Object.assign(app.PT(), { base: L(d.pt_baseData), cut: L(d.pt_cuttingData) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(d.pt_qcChecks), issue: [], ret: [] }));
  app.setORD({ req: {}, busy: false, at: '', rows: [] });
  const flat = [];
  Object.entries(d.pt_vendorOrders || {}).forEach(([code, os]) => Object.values(os || {}).forEach(o => { if (o) flat.push(Object.assign({ vendorCode: code }, o)); }));
  app.setVO(Object.assign(app.VO(), { rows: flat, map: {}, err: '', busy: false }));
  app.setFLOW(Object.assign(app.FLOW(), { ppc: d.pt_ppc || {}, dem: d.pt_flowDemand || {}, res: d.pt_accReserve || {}, ch: d.pt_flowChallans || {},
    po: d.pt_flowPrintOrders || {}, fg: d.pt_flowFgSend || {}, emb: {}, test: {} }));
  const obRow = {}; L(d.pt_orderBook).forEach(r => { if (r && r.orderNo && r.sku) obRow[app.obUC(r.orderNo) + '|' + app.obUC(r.sku)] = r; });
  let N = 0; const T0 = Date.now(); console.log('ordLines…'); const out = app.ordLines().filter(l => l.open).map(l => {
    if (!(++N % 200)) console.log('lines', N, Date.now() - T0, 'ms'); let s = {}; try { s = app.flowState(l); } catch (e) { s = { bucket: 'ERR ' + e.message }; }
    const r = obRow[app.obUC(l.orderNo) + '|' + app.obUC(l.sku)] || {};
    return { orderNo: l.orderNo, shop: String(l.shopOrderNo || '').replace(/\s+/g, ''), sku: l.sku, qty: l.qty, open: !!l.open,
      item: [l.articleSubtype || l.articleType || l.itemName, l.color, l.size].filter(Boolean).join(' · '), art: l.articleType || '', sub: l.articleSubtype || '',
      orderDate: l.orderDate || '', openedAt: r.openedAt || r.uploadedAt || '', handedAt: l.handedAt || '', shopDoneAt: l.shopDoneAt || '', shopDoneWhy: l.shopDoneWhy || '',
      bucket: s.bucket, route: s.route || '', plan: !!s.plan, given: s.given, back: s.back, cut: s.cut, cutReq: !!s.cutReq, issued: s.issued, received: s.received,
      qc: s.qc, made: s.made, waiting: l.open ? app.ordWaitingAt(l) : '' };
  });
  fs.writeFileSync(process.argv[2], JSON.stringify(out));
  const c = {}; out.forEach(x => { c[x.bucket] = (c[x.bucket] || 0) + 1; });
  console.log('lines', out.length, JSON.stringify(c));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
