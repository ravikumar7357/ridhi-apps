/* EVERY SCREEN, TIMED, ON THE LIVE DATABASE. Read-only.
 *
 *   node slow-all.js
 *
 * Ravi, 2026-09-24: "abhi bhi system bahut hang ho rha h." slow.js timed the Order Console because
 * that is the screen he had open. This asks the same question of every screen there is, so the next
 * answer does not depend on guessing which one he is on.
 *
 * It also counts the HTML each screen produces. A table that is fast to build can still be slow to
 * show: a hundred thousand DOM nodes is a browser freeze that no amount of JavaScript timing will
 * reveal, and the number of cells is the closest this side can get to it.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');

const NODES = {
  masters: 'pt_masters', mdb: 'pt_masterDB', ob: 'pt_orderBook', press: 'pt_pressInventory',
  cut: 'pt_cuttingData', base: 'pt_baseData', shopProd: 'pt_shopProd', vo: 'pt_vendorOrders',
  fab: 'pt_fabInvLedger', fgi: 'pt_fgiLedger', qc: 'pt_qcChecks', so: 'pt_salesOrders',
  emp: 'pt_empList', pal: 'pt_printerAlloc', rfdD: 'pt_rfdDecisions',
};

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } }); }).on('error', rej));

  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList;

  const keys = Object.keys(NODES);
  const vals = await Promise.all(keys.map(k => get(NODES[k])));
  const D = {}; keys.forEach((k, i) => { D[k] = vals[i]; });

  app.setPTG(Object.assign(app.PTG(), { masters: D.masters || {}, mdb: L(D.mdb), ob: L(D.ob),
    press: L(D.press), shopProd: D.shopProd || {}, freeze: {} }));
  app.setPT(Object.assign(app.PT(), { base: L(D.base), cut: L(D.cut) }));
  const vrows = []; Object.keys(D.vo || {}).forEach(c => Object.values(D.vo[c] || {}).forEach(o => { if (o) vrows.push(Object.assign({ vendorCode: c }, o)); }));
  app.setVO({ busy: false, err: '', at: '', shown: [], map: {}, rows: vrows });
  app.setFAB({ rows: L(D.fab), err: '', busy: false, at: '', shown: [] });
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(D.fgi) }));
  app.setQC(Object.assign({}, app.QC(), { checks: L(D.qc), issue: [], ret: [] }));
  app.setSOX(Object.assign({}, app.SOX(), { rows: L(D.so) }));
  app.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() });
  if (app.setORD_DEM) app.setORD_DEM({ tried: true, busy: false, fabOk: true, voOk: true });

  
  /* EVERY ORDER CONSOLE VIEW, and the Master DB with its data. */
  app.setPT(Object.assign(app.PT(), { mdb: app.PTG().mdb }));
  const page = fs.readFileSync(pathm.join(PR, '../public/index.html'), 'utf8'); const i0 = page.indexOf('<select id="odView"'), i1 = page.indexOf('</select>', i0);
  const views = [...page.slice(i0, i1).matchAll(/value="([^"]+)"/g)].map(m => m[1]);
  const time = (label, f, tbl) => { const a = Date.now(); try { f(); } catch (e) { console.log(label.padEnd(26), 'FAILED', (e.message||e).slice(0,80)); return; } const cold = Date.now() - a; const b = Date.now(); try { f(); } catch (e) {} const warm = Date.now() - b;
    const h = (els[tbl] || {}).innerHTML || ''; console.log(label.padEnd(26), (cold+' ms').padStart(8), (warm+' ms').padStart(8), String((h.match(/<td[s>]/g)||[]).length).padStart(7), ((h.length/1024).toFixed(0)+' KB').padStart(8), cold > 250 ? '  <- slow' : ''); };
  views.forEach(v => { els.odView.value = v; app.setORD({ req: {}, busy: false, at: '', rows: [], pick: new Set() }); time('renderOrd ' + v, () => app.renderOrd(), 'odTable'); });
  els.ptmView.value = 'master'; time('renderPmdb master', () => app.renderPmdb(), 'ptmTable');
  els.ptmView.value = 'recipe'; time('renderPmdb recipe', () => app.renderPmdb(), 'ptmTable');
  els.ptmView.value = 'cons'; time('renderPmdb cons', () => app.renderPmdb(), 'ptmTable');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
