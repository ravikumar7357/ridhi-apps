/* How long the vendor portal's RFD screen takes to draw, on live data, per printer (read-only). node rfd-slow.js [VND001] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, L = app.ptList;
  const code = process.argv[2] || 'VND001';
  const [vo, dec, stock, masters, mdb] = await Promise.all(['pt_vendorOrders/' + code, 'pt_rfdDecisions', 'pt_rfdStock', 'pt_masters', 'pt_masterDB'].map(get));
  const rows = Object.entries(vo || {}).map(([k, o]) => Object.assign({ id: k, vendorCode: code }, o));
  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb).map(app.mdbYnFix) }));
  app.setRFD_({ decisions: dec || {}, err: '', busy: false, at: '', shown: [], stock: stock || {} });
  app.setVO(Object.assign({}, app.VO(), { rows }));
  app.setVP({ code, name: code, rows, err: '', busy: false, at: '', tab: 'rfd' });
  H.ME.admin = false;
  const t = (label, f) => { const a = Date.now(); f(); console.log(label.padEnd(34), (Date.now() - a) + ' ms'); };
  console.log(code, rows.length, 'orders');
  t('renderVp (rfd) cold', () => app.renderVp());
  t('renderVp (rfd) again', () => app.renderVp());
  const orders = app.vpRfdOrders();
  t('vpRfdOrders', () => app.vpRfdOrders());
  t('shortOrders loop', () => orders.filter(o => app.rfdFabrics(o).some(x => app.rfdSentFor(o, x.fabric) < app.rfdAllowed(o, x.fabric).need) || app.rfdPieceLines(o).some(x => app.rfdSentPcsFor(o, x.sku) < x.pieces)).length);
  const o = orders[0];
  t('rfdSizeGroups(one order)', () => app.rfdSizeGroups(o));
  t('vpRfdRows', () => app.vpRfdRows());
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
