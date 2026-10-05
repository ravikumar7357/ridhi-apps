/* Renders the Order Console's Shopify / Online combined view from the live database with the app's own code, into an HTML
 * file with the app's stylesheet, for a look without signing in. Read-only. node probes/mto-view.js <out.html> [ONL] */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')))
    .replace("const dToday = () => '2026-09-04';", "const dToday = () => new Date().toLocaleDateString('en-CA');");
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const [ob, base, cut, press, qc, mdb, sp] = await Promise.all(['pt_orderBook', 'pt_baseData', 'pt_cuttingData', 'pt_pressInventory', 'pt_qcChecks', 'pt_masterDB', 'pt_shopProd'].map(get));
  const app = H.A, L = app.ptList;
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb), press: L(press), shopProd: sp || {} }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(qc), issue: [], ret: [] }));
  app.setORD({ req: {}, busy: false, at: '', rows: [], mtoSrc: process.argv[3] === 'ONL' ? 'ONL' : 'SHP' });
  H.els.odView.value = 'shopsku';
  app.renderOrd();
  const css = fs.readFileSync(pathm.join(__dirname, '..', '..', 'src', 'styles.css'), 'utf8');
  fs.writeFileSync(process.argv[2], '<!doctype html><meta charset="utf-8"><style>' + css + '</style><body style="padding:16px"><div id="odKpis" class="jw-kpiwrap">'
    + H.els.odKpis.innerHTML + '</div><div class="xlwrap"><table class="xl" id="odTable">' + H.els.odTable.innerHTML + '</table></div></body>');
  console.log('written', process.argv[2], H.els.odMsg.textContent || '');
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
