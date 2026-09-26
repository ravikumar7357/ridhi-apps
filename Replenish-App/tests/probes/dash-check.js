/* Are the dashboard's stock figures right? RFD by fabric and FG on the shelf, on live data. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(PR));
  const H = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
  const app = H.A, L = app.ptList;
  const [fab, dec, fg, ob, mdb] = await Promise.all(['pt_fabInvLedger', 'pt_rfdDecisions', 'pt_fgiLedger', 'pt_orderBook', 'pt_masterDB'].map(get));
  app.setPTG(Object.assign(app.PTG(), { ob: L(ob), mdb: L(mdb) }));
  app.setFAB({ rows: L(fab), err: '', busy: false, at: '', shown: [] });
  app.setRFD({ decisions: dec || {}, stock: {}, err: '', busy: false, at: '', shown: [], loaded: true });
  const st = {}; Object.values(app.fabBalances(app.fabAll())).forEach(b => { const k = b.state + ' ' + b.fabricType; st[k] = (st[k] || 0) + b.qty; });
  console.log('fabric ledger by state · fabric (m):'); Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('  ' + k.padEnd(30) + Math.round(v)));
  const byT = {}; L(fab).forEach(r => { byT[r.txnType] = (byT[r.txnType] || 0) + (parseFloat(r.qty) || 0); }); console.log('ledger by txnType (m):', JSON.stringify(byT));
  app.setFGI(Object.assign({}, app.FGI(), { rows: L(fg) }));
  let pcs = 0, n = 0; app.fgiStock().forEach(b => { if (b.current > 0) { pcs += b.current; n++; } });
  console.log('FG on the shelf:', pcs, 'pcs in', n, 'SKUs · ledger rows', L(fg).length, 'by type', JSON.stringify(L(fg).reduce((a, r) => { a[r.txnType] = (a[r.txnType] || 0) + 1; return a; }, {})));
  const lines = app.ordLines(); const by = {}; lines.forEach(l => { const k = String(app.ordSrcOf(l)); by[k] = (by[k] || 0) + 1; }); console.log('ordSrcOf samples:', JSON.stringify(by), 'first line keys:', Object.keys(lines[0] || {}).slice(0, 20).join(','));
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
