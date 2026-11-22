/* SHP / AMZ BOARD, TIMED ON THE LIVE DATABASE. Read-only (writes go to the harness stub). node shpb-slow.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const PR = pathm.join(__dirname, '..');
process.on('uncaughtException', e => { if (!/_hidden|otk/.test(String(e && e.stack))) console.log('   (background error) ' + (e && e.message)); });
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => { const t = Date.now(); https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { console.log('   read ' + p.padEnd(22) + (d.length / 1024).toFixed(0).padStart(6) + ' KB ' + (Date.now() - t) + ' ms'); res(JSON.parse(d)); }); }).on('error', rej); });
  const src = fs.readFileSync(pathm.join(PR, 'prod-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- real data ---- */')).replace(/__dirname/g, JSON.stringify(PR)).replace("C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html", pathm.join(PR, '..', 'public', 'index.html').split(String.fromCharCode(92)).join('/'))
    /* the harness knows the ids its tests use; a newer screen's button is made on the spot */
    .replace('const $ = id => els[id];', 'const $ = id => els[id] || (els[id] = mkEl(id));');
  const head2 = head.replace('const document = {', 'const document = { addEventListener(){}, removeEventListener(){}, ');
  const DOCFIX = 'try { const d = typeof document !== "undefined" ? document : null; if (d) { ["addEventListener","removeEventListener"].forEach(k => { if (typeof d[k] !== "function") d[k] = () => {}; }); if (!d.body) d.body = { classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, appendChild(){}, style: {} }; } } catch (e) {}\n';
  const H = new Function('require', 'process', 'global', head2 + '\n;return { A, els, ME, NET };')(require, process, global);
  const app = H.A, els = H.els, L = app.ptList, NET = H.NET;
  const [masters, mdb, ob, press, cut, base, qc] = await Promise.all(['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory', 'pt_cuttingData', 'pt_baseData', 'pt_qcChecks'].map(get));
  app.setPTG(Object.assign(app.PTG(), { masters: masters || {}, mdb: L(mdb), ob: L(ob), press: L(press), freeze: {}, qc: L(qc), at: Date.now() }));
  app.setPT(Object.assign(app.PT(), { base: L(base), cut: L(cut) }));
  H.ME.admin = true; H.ME.tabs = ['ord'];
  NET.on = true;
  // pass 1: find what the board asks the network for
  const kinds = (process.argv[2] || 'shpboard,amzboard').split(',');
  els.odView.value = process.env.FIRST || kinds[0];
  try { app.renderOrd(); } catch (e) { console.log('pass1 err', e.message); }
  await new Promise(r => setTimeout(r, 300));
  const want = [...new Set(NET.calls.filter(c => c.method === 'GET').map(c => (String(c.url).match(/\.app\/([^?]+)\.json/) || [])[1]).filter(Boolean))];
  console.log('board asks for:', want.join(', '));
  for (const p of want) NET.store[decodeURIComponent(p)] = await get(decodeURIComponent(p));
  app.setSHPB(Object.assign(app.SHPB(), { readyAt: 0, busy: false }));
  try { app.renderOrd(); } catch (e) { console.log('pass2 err', e.message); }
  await new Promise(r => setTimeout(r, 1500));
  const time = (label, f) => { const t = Date.now(); try { f(); } catch (e) { console.log('   ERR ' + label + ': ' + e.message); } const ms = Date.now() - t; console.log('   ' + label.padEnd(34) + String(ms).padStart(6) + ' ms'); return ms; };
  let PS = null;
  const profStart = async () => { const inspector = require('inspector'); PS = new inspector.Session(); PS.connect(); const post = (m, p) => new Promise((res, rej) => PS.post(m, p || {}, (e, r) => e ? rej(e) : res(r))); await post('Profiler.enable'); await post('Profiler.start'); PS.p = post; };
  const profStop = async () => { const { profile } = await PS.p('Profiler.stop'); const self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map(n => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    console.log('=== cold self time (ms), top 30'); [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, v]) => console.log('   ' + k.padEnd(40) + (v / 1000).toFixed(0).padStart(7))); };
  if (process.argv[3] === 'profcold') await profStart();
  for (const k of kinds) {
    els.odView.value = k;
    console.log('\n=== ' + k);
    time('renderOrd (1st)', () => app.renderOrd());
    time('renderOrd (again)', () => app.renderOrd());
    time('renderShpBoard', () => app.renderShpBoard());
    console.log('   table html ' + ((els.odTable.innerHTML || '').length / 1024).toFixed(0) + ' KB · rows ' + ((els.odTable.innerHTML || '').match(/<tr/g) || []).length);
    if (PS) { await profStop(); PS = null; }
  }
  if (process.argv[3] === 'prof') {
    const inspector = require('inspector'), s = new inspector.Session(); s.connect();
    const post = (m, p) => new Promise((res, rej) => s.post(m, p || {}, (e, r) => e ? rej(e) : res(r)));
    await post('Profiler.enable'); await post('Profiler.start');
    els.odView.value = process.env.FIRST || kinds[0]; app.renderOrd(); app.renderOrd();
    const { profile } = await post('Profiler.stop');
    const self = new Map(), dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName || '(anon)'; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    console.log('\n=== self time (ms), top 25');
    [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log('   ' + k.padEnd(34) + (v / 1000).toFixed(0).padStart(7)));
  }
  process.exit(0);
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
