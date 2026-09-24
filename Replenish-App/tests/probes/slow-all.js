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

  /* Where each screen's HTML lands, so the cells it produced can be counted. */
  const TABLES = { renderOrd: 'odTable', renderPbase: 'pbTable', renderPcut: 'pcTable',
    renderPpress: 'ppTable', renderQc: 'qcTable', renderFgi: 'fgTable', renderFba: 'fbaTable',
    renderSox: 'soTable', renderVo: 'voTable', renderVlog: 'vlTable', renderFab: 'fbTable',
    renderAcc: 'acTable', renderPmdb: 'pmTable', renderMst: 'mstTable', renderPal: 'palTable',
    renderStore: 'stTable', renderRep: 'repTable', renderPa: 'paTable', renderKa: 'kaTable' };

  console.log('screen'.padEnd(19) + 'cold'.padStart(8) + 'again'.padStart(8) + 'cells'.padStart(9) + '   html');
  const out = [];
  Object.keys(TABLES).forEach(name => {
    process.stdout.write('   ' + name.padEnd(19) + '... ');
    const f = app[name];
    if (typeof f !== 'function') return;
    let cold, warm, cells = null, bytes = null;
    const a = Date.now();
    try { f(); } catch (e) { console.log('FAILED — ' + (e.message || String(e)).slice(0, 70)); out.push({ name, err: '1' }); return; }
    cold = Date.now() - a;
    const b = Date.now(); try { f(); } catch (e) { /* the cold number is the one that matters */ }
    warm = Date.now() - b;
    const el = els[TABLES[name]];
    if (el && typeof el.innerHTML === 'string') {
      bytes = el.innerHTML.length;
      cells = (el.innerHTML.match(/<td[\s>]/g) || []).length;
    }
    out.push({ name, cold, warm, cells, bytes });
    const kb = bytes == null ? '' : (bytes / 1024).toFixed(0) + ' KB';
    const flag = cold > 1000 ? '   <<< HANG' : (cold > 250 ? '   <- slow' : '');
    console.log((cold + ' ms').padStart(9) + (warm + ' ms').padStart(9)
      + String(cells == null ? '—' : cells).padStart(9) + '   ' + kb.padStart(7) + flag);
  });

  const heavy = out.filter(r => r.cells > 5000);
  if (heavy.length) {
    console.log('\nOver 5,000 cells — the browser has to lay every one of these out, which no timing here sees:');
    heavy.forEach(r => console.log('   ' + r.name + ' · ' + r.cells + ' cells · ' + (r.bytes / 1024).toFixed(0) + ' KB of HTML'));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
