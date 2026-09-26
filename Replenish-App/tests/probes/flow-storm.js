/* OPENING THE FABRIC TAB, counted: how many database reads and how many draws one open sets off. Read-only (the harness's
 * fetch stub answers from NET.store, so nothing real is read here; the point is the COUNT). node flow-storm.js */
const fs = require('fs'), pathm = require('path');
const PR = pathm.join(__dirname, '..');
(async () => {
  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME, NET };')(require, process, global);
  const app = H.A, els = H.els, NET = H.NET;
  H.ME.admin = true;
  app.setPTG(Object.assign(app.PTG(), { mdb: null }));
  app.setFAB({ rows: [], err: '', busy: false, at: '', shown: [] });
  app.setSTORE({ rows: null, checks: null, err: '', busy: false, at: '' });
  app.setVO({ rows: null, map: null, err: '', busy: false, at: '', shown: [], pick: {} });
  app.setGPO(Object.assign({}, app.GPO(), { rows: null }));
  app.setRFD({ decisions: null, stock: {}, err: '', busy: false, at: '', shown: [] });
  app.setFFLOW({ stage: 4, loaded: false, busy: false, err: [] });
  let draws = 0; const desc = Object.getOwnPropertyDescriptor(els.fbTable, 'innerHTML');
  let html = ''; Object.defineProperty(els.fbTable, 'innerHTML', { get: () => html, set: v => { html = v; draws++; }, configurable: true });
  NET.on = true; NET.calls.length = 0; NET.store = {};
  els.fbView.value = 'flow';
  const t = Date.now();
  app.renderFab();
  for (let i = 0; i < 50; i++) await new Promise(r => setTimeout(r, 20));      // let the fire-and-forget loads land
  const paths = NET.calls.map(c => (String(c.url).match(/\.app\/([^?]+)\.json/) || [])[1] || c.url).map(p => String(p).split('/')[0]);
  const by = {}; paths.forEach(p => { by[p] = (by[p] || 0) + 1; });
  console.log('one open of the Fabric tab (Fabric flow): ' + NET.calls.length + ' read(s), ' + draws + ' draw(s) of the table, ' + (Date.now() - t) + ' ms in the harness');
  console.log(JSON.stringify(by, null, 1));
  console.log('message:', els.fbMsg.textContent.slice(0, 160));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
