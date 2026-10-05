/* Shopify quilt lines: their own counters (pt_shopProd) against what the registers hold (cutting, Job Work, QC/press). Read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const [ob, base, cut, press, qc, mdb, sp] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_shopProd'].map(get));
  const app = H.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press), shopProd: sp || {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setORD({ req: {}, busy: false, at: '', rows: [] });
  const q = app.ordLines().filter(l => l.src === 'SHP' && app.spIsQuilt(l));
  let withCounters = 0, differ = 0; const tot = { own: { cut: 0, issued: 0, received: 0, pressed: 0 }, reg: { cut: 0, issued: 0, received: 0, pressed: 0 } };
  const ex = [];
  q.forEach(l => {
    const r = app.spOf(l.orderNo, l.sku) || {};
    const own = { cut: +r.cut || 0, issued: +r.issued || 0, received: +r.received || 0, pressed: +r.pressed || 0 };
    const b = app.obBaseIndex ? null : null;
    const reg = { cut: app.obCutQty(l.orderNo, l.sku), issued: 0, received: 0, pressed: app.obPressQty(l.orderNo, l.sku) };
    L(base).forEach(x => { if (x && app.obUC(x.orderNo) === l.orderNo && app.obUC(x.sku) === l.sku) { reg.issued += +x.issuePieces || 0; reg.received += +x.receivedPieces || 0; } });
    if (own.cut || own.issued || own.received || own.pressed) withCounters++;
    Object.keys(own).forEach(k => { tot.own[k] += own[k]; tot.reg[k] += reg[k]; });
    if (JSON.stringify(own) !== JSON.stringify(reg)) { differ++; if (ex.length < 12) ex.push([l.orderNo, l.sku, l.open ? 'open' : 'closed', 'own', JSON.stringify(own), 'reg', JSON.stringify(reg)].join(' ')); }
  });
  console.log('SHP quilt lines', q.length, '· open', q.filter(l => l.open).length, '· with own counters', withCounters, '· own ≠ registers', differ);
  console.log('totals own', JSON.stringify(tot.own), '\ntotals reg', JSON.stringify(tot.reg));
  ex.forEach(x => console.log('  ' + x));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
