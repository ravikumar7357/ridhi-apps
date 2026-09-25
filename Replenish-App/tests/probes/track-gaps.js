/* END-TO-END TRACKING, WHERE THE CHAIN BREAKS (2026-09-25). Read-only. Measures, on the live database:
 * orders by channel and state, what leaves the store (FBA / ISSUE) and whether it names an order, what the
 * FBA team records when it ships, and how many dispatched pieces have an open order of the same SKU to go to.
 *   node probes/track-gaps.js */
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
  const [ob, base, cut, press, qc, mdb, fg, vo, so] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_fgiLedger', 'pt_vendorOrders', 'pt_salesOrders'].map(get));
  const app = A.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press) }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(fg) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  app.setORD({ req: {}, busy: false, at: '', rows: [] });

  const lines = app.ordLines();
  const pre = n => String(n || '').split('-')[0] || '?';
  const by = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('ORDER LINES by prefix:', by(lines, r => pre(r.orderNo)));
  console.log('…open:', by(lines.filter(r => r.open), r => pre(r.orderNo)));
  const sos = L(so);
  console.log('SALES ORDERS by channel:', by(sos, o => String(o.channel || '?').toUpperCase()), ' by status:', by(sos, o => o.status || '?'));

  const led = L(fg);
  console.log('\nLEDGER by type:', by(led, r => r.txnType));
  const out = led.filter(r => r.txnType === 'FBA' || r.txnType === 'ISSUE');
  const live = out.filter(r => !/^sheet/.test(r.source || ''));
  console.log('OUT rows (FBA+ISSUE):', out.length, '· not from the old sheet:', live.length, '· naming an order:', out.filter(r => r.orderNo).length);
  console.log('…FBA by account:', by(led.filter(r => r.txnType === 'FBA'), r => r.issuedFor || '?'));
  console.log('…ISSUE issued to:', by(led.filter(r => r.txnType === 'ISSUE'), r => r.issuedFor || '?'));
  const fbaLive = led.filter(r => r.txnType === 'FBA' && !/^sheet/.test(r.source || ''));
  console.log('…FBA (not sheet) state:', by(fbaLive, r => r.fbaShippedAt ? 'shipped' : r.fbaAcceptedAt ? 'accepted' : 'waiting'),
    ' with a shipment id:', fbaLive.filter(r => r.fbaShipment).length);
  console.log('…FBA months:', by(fbaLive, r => String(r.createdAt || r.date || '').slice(0, 7)));

  /* Of the pieces sent to FBA since the app took over, how many have a same-SKU order that received them? */
  const inBy = new Map();
  led.filter(r => r.txnType === 'RECEIVE' && r.orderNo).forEach(r => { const k = String(r.sku).toUpperCase(); inBy.set(k, (inBy.get(k) || new Set()).add(r.orderNo)); });
  let withOrd = 0, noOrd = 0; const noOrdSku = {};
  fbaLive.forEach(r => { const k = String(r.sku).toUpperCase(); if (inBy.has(k)) withOrd += +r.qty || 0; else { noOrd += +r.qty || 0; noOrdSku[k] = 1; } });
  console.log('FBA pcs whose SKU was received against an order:', withOrd, '· whose SKU never was:', noOrd, '(' + Object.keys(noOrdSku).length + ' SKUs)');
  const ords = new Set(); inBy.forEach(s => s.forEach(o => ords.add(pre(o))));
  console.log('…receipts name orders of prefix:', [...ords].join(', '));

  /* Order lines that have reached the store: how far is each? */
  const st = { made: 0, inStore: 0, dispatched: 0, shipped: 0 };
  lines.forEach(r => { const g = app.ordFgAt(r.orderNo, r.sku); if (!g) return; if (g.in) st.inStore++; if (g.out) st.dispatched++; });
  console.log('\norder lines with a store receipt:', st.inStore, '· with pieces out (shared by SKU):', st.dispatched);

  /* The Tracking view on live data: orders per stage, and how long it takes. */
  const t0 = Date.now(); const tr = app.ordTrackRows(); const ms = Date.now() - t0;
  console.log('\nTRACKING VIEW: ' + tr.length + ' orders in ' + ms + ' ms');
  app.ORD_TRACK.forEach((x, i) => { const at = tr.filter(o => o.stage === i);
    console.log('  ' + x[1].padEnd(28) + String(at.length).padStart(5) + '  ' + JSON.stringify(by(at, o => o.src))); });
  const sku1 = (led.find(r => r.txnType === 'FBA') || {}).sku;
  const t1 = Date.now(); const cand = app.fgiOutOrders(sku1, 'FBA');
  console.log('fgiOutOrders(' + sku1 + '): ' + cand.length + ' order(s) in ' + (Date.now() - t1) + ' ms', JSON.stringify(cand.slice(0, 3)));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
