/* THE DEPLOYED APP'S OWN CODE, RUN AGAINST THE LIVE DATABASE. Not a copy of its logic — the harness from
 * prod-test.js (everything up to where it builds A) evaluates the real block out of index.html, and this
 * feeds it what the database holds right now. Read-only. Use it to ask "what does the screen compute for
 * order X" without signing in.
 *   node probes/live-console.js AMZ-01092026-01 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const want = String(process.argv[2] || '').toUpperCase();
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const [ob, base, cut, press, qc, mdb, fg, vo] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_fgiLedger', 'pt_vendorOrders'].map(get));
  const app = A.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press) }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(fg) }));
  const rows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) rows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows });
  app.setORD({ req: {}, busy: false, at: '', rows: [] });
  const lines = app.ordLines().filter(r => !want || r.orderNo === want);
  console.log((want || 'every order') + ' — ' + lines.length + ' line(s), as the deployed code computes them from the live database:\n');
  lines.slice(0, 40).forEach(r => { const q = app.ordQcOf(r.orderNo, r.sku), v = app.ordVendorOf(r.orderNo, r.sku);
    console.log('  ' + r.sku.padEnd(20) + 'ordered ' + String(r.qty).padStart(4) + '  received ' + String(r.received).padStart(4)
      + '   QC: ' + (q ? q.checked + ' checked, ' + q.ok + ' ok' + (q.worked ? ' (' + q.worked + ' shared by SKU)' : '') : '—')
      + '   vendor: ' + (v ? v.back + ' back of ' + v.given : '—') + '   waiting: ' + app.ordWaitingAt(r)); });
  if (!want) { const withQc = app.ordLines().filter(r => app.ordQcOf(r.orderNo, r.sku)).length; console.log('\norder lines that show a QC figure: ' + withQc + ' of ' + app.ordLines().length); }
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
