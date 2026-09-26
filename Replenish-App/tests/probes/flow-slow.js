/* FABRIC FLOW, TIMED ON THE LIVE DATABASE. Read-only. node flow-slow.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => { const t = Date.now(); https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { console.log('   read ' + p.padEnd(18) + (d.length / 1024).toFixed(0).padStart(6) + ' KB ' + (Date.now() - t) + ' ms'); res(JSON.parse(d)); }); }).on('error', rej); });
  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList;
  console.log('=== what the Fabric tab reads');
  const [masters, mdb, ob, press, cut, base, vo, fab, st, stc, dec, stock, gpo] = await Promise.all(
    ['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory', 'pt_cuttingData', 'pt_baseData',
     'pt_vendorOrders', 'pt_fabInvLedger', 'pt_storeLedger', 'pt_storeChecks', 'pt_rfdDecisions', 'pt_rfdStock', 'pt_greigePO'].map(get));
  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb), ob: L(ob), press: L(press), freeze: {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  const vrows = []; Object.keys(vo || {}).forEach(c => Object.values(vo[c] || {}).forEach(o => { if (o) vrows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: vrows });
  app.setFAB({ rows: L(fab), err: '', busy: false, at: '', shown: [] });
  app.setSTORE({ rows: L(st), checks: stc || {}, err: '', busy: false, at: '' });
  app.setRFD({ decisions: dec || {}, stock: stock || {}, err: '', busy: false, at: '', shown: [], loaded: true });
  app.setGPO(Object.assign({}, app.GPO(), { rows: L(gpo) }));
  app.setFFLOW({ stage: 4, loaded: true, busy: false, err: [] });
  H.ME.admin = true;
  const time = (label, f) => { const t = Date.now(); const r = f(); console.log('   ' + label.padEnd(28) + String(Date.now() - t).padStart(6) + ' ms'); return r; };
  console.log('\n=== one draw of Fabric flow');
  time('fabAll', () => app.fabAll());
  time('fabAll again', () => app.fabAll());
  time('rfdOrderRows', () => app.rfdOrderRows());
  time('stMoves+stBalances', () => app.stBalances(app.stMoves()));
  time('voLogRows', () => app.voLogRows());
  time('fabLots', () => app.fabLots(app.fabAll()));
  const X = time('ffFacts', () => app.ffFacts());
  time('ffFacts again', () => app.ffFacts());
  els.fbView.value = 'flow';
  time('renderFab (flow) cold', () => app.renderFab());
  time('renderFab (flow) again', () => app.renderFab());
  console.log('   kpis html ' + (els.fbKpis.innerHTML.length / 1024).toFixed(0) + ' KB · table html ' + (els.fbTable.innerHTML.length / 1024).toFixed(0) + ' KB · fabrics ' + X.fabrics.length + ' · worklist rows ' + X.rows.length);
  [1, 2, 3, 5].forEach(s => { app.setFFLOW({ stage: s, loaded: true, busy: false, err: [] }); time('renderFab stage ' + s, () => app.renderFab()); });
  els.fbView.value = 'store'; time('renderFab (store)', () => app.renderFab());
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
