/* SHOPIFY ORDERS, TIMED WITH THE REAL ORDERS. Read-only: the orders come from the Pricing-API backend exactly as the
 * tab asks for them; nothing is written (the harness's setDoc/ptPut are stubs). node shop-slow.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const PR = pathm.join(__dirname, '..');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (u, auth) => new Promise((res, rej) => { const t = Date.now(); https.get(u, { headers: auth === false ? {} : { Authorization: 'Bearer ' + at }, timeout: 180000 }, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) return req(r.headers.location, false).then(res, rej);
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res({ j: JSON.parse(d), b: d.length, ms: Date.now() - t }); } catch (e) { rej(new Error(d.slice(0, 120))); } }); }).on('error', rej); });
  const val = v => v == null ? null : ('stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'nullValue' in v ? null : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : 'arrayValue' in v ? (v.arrayValue.values || []).map(val) : null);
  const api = (await req(FS + 'config/api')).j; const url = api.fields.url.stringValue, key = api.fields.key.stringValue;
  const meta = (await req(FS + 'audit/shoporders')).j; const M = val((meta.fields || {}).m) || {};
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  console.log('=== what the tab reads');
  const [sp, cpc, ob] = await Promise.all([
    req(url + '?key=' + encodeURIComponent(key) + '&shopify=orders&start=' + from + '&end=' + to + '&open=0', false),
    req(url + '?key=' + encodeURIComponent(key) + '&shopify=orders&shop=CPC&start=' + from + '&end=' + to + '&open=0', false),
    req(DB + '/pt_orderBook.json')]);
  console.log('   Shopify Ridhi ' + (sp.j.orders || []).length + ' orders ' + (sp.b / 1024).toFixed(0) + ' KB ' + sp.ms + ' ms · CPC ' + (cpc.j.orders || []).length + ' orders ' + cpc.ms + ' ms · meta ' + Object.keys(M).length + ' orders noted · order book ' + (ob.b / 1048576).toFixed(1) + ' MB');
  const src = fs.readFileSync(pathm.join(PR, 'shop-test.js'), 'utf8');
  const head = src.slice(0, src.indexOf('/* ---- runner ---- */')).replace(/__dirname/g, JSON.stringify(PR))
    /* The app's real ordLines is cached on the identity of its inputs; the harness's stub is not. Cached here the same
     * way, so the timing is the browser's and not the stub's. */
    .replace('function ordLines() {', 'let OL_C = { ob: null, rows: null };\nfunction ordLines() { if (OL_C.ob === PTG.ob && OL_C.rows) return OL_C.rows; OL_C = { ob: PTG.ob, rows: ordLinesRaw() }; return OL_C.rows; }\nfunction ordLinesRaw() {');
  const H = new Function('require', 'process', 'global', head + '\n;return { A, PTG, els: typeof els !== "undefined" ? els : null };')(require, process, global);
  const A = H.A;
  const orders = (sp.j.orders || []).map(o => Object.assign(o, { shopBrand: 'SP', channel: o.channel || 'Shopify' }))
    .concat((cpc.j.orders || []).map(o => Object.assign(o, { shopBrand: 'CPC', channel: 'CPC Shopify' })));
  A.setSHOP(Object.assign({}, A.SHOP(), { orders, from, to, at: 'now' }));
  A.setMETA(M);
  H.PTG.ob = Object.entries(ob.j || {}).map(([k, v]) => Object.assign({ _key: k }, v)).filter(r => r && r.orderNo);
  /* THE REAL STOCK: Amazon's per SKU (Firestore stock/SP, stock/CPC) and India's (the backend's india=stock). */
  const stk = {};
  for (const b of ['SP', 'CPC']) { const d = (await req(FS + 'stock/' + b)).j; Object.entries(val((d.fields || {}).m) || {}).forEach(([k, q]) => { const u = String(k).trim().toUpperCase(); stk[u] = Math.max(stk[u] || 0, Number(q) || 0); }); }
  A.setSTOCK(stk); A.setSTOCKCASE(Object.fromEntries(Object.keys(stk).map(k => [k, k])));
  A.setStockLoaded(true);
  const ind = await req(url + '?key=' + encodeURIComponent(key) + '&india=stock', false);
  A.setIndia((ind.j && ind.j.d) || {}, true, '');
  console.log('   Amazon stock SKUs ' + Object.keys(stk).length + ' · India stock SKUs ' + Object.keys((ind.j && ind.j.d) || {}).length + ' (' + ind.ms + ' ms)');
  console.log('   order book rows in the harness', H.PTG.ob.length);
  const time = (label, f, n) => { const t = Date.now(); let r; for (let i = 0; i < (n || 1); i++) r = f(); const ms = (Date.now() - t) / (n || 1); console.log('   ' + label.padEnd(30) + String(Math.round(ms)).padStart(6) + ' ms' + (ms > 250 ? '   <- slow' : '')); return r; };
  console.log('\n=== one draw of the Shopify tab, ' + orders.length + ' orders');
  time('soRows', () => A.soRows());
  time('soRows again', () => A.soRows());
  time('shpBucketMake', () => A.shpBucketMake && A.shpBucketMake());
  { const inspector = require('inspector'); const sess = new inspector.Session(); sess.connect();
    const post = (m, p) => new Promise((res, rej) => sess.post(m, p || {}, (e, r) => e ? rej(e) : res(r)));
    await post('Profiler.enable'); await post('Profiler.start');
    A.renderShop();
    const { profile } = await post('Profiler.stop');
    const self = {}; const byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName || '(anon)'; self[k] = (self[k] || 0) + (dt[i] || 0); });
    console.log('   self time by function (top 12):');
    Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log('     ' + k.padEnd(30) + Math.round(v / 1000) + ' ms'));
  }
  time('renderShop', () => A.renderShop());
  time('renderShop again', () => A.renderShop());
  time('renderShop × 5 (typing in search)', () => A.renderShop(), 5);
  time('shpPlanAll (the background sync, planning only)', () => 0);
  { const inspector = require('inspector'); const ss = new inspector.Session(); ss.connect(); const post2 = (m, p) => new Promise((res, rej) => ss.post(m, p || {}, (e, r) => e ? rej(e) : res(r))); await post2('Profiler.enable'); await post2('Profiler.start'); try { await A.shpSyncAll({ maintain: true, dry: true }); } catch (e) {} const { profile } = await post2('Profiler.stop'); const self = {}; const byId = new Map(profile.nodes.map(n => [n.id, n])); profile.samples.forEach((id, i) => { const k = byId.get(id).callFrame.functionName || '(anon)'; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0); }); console.log('   sync self time (top 10):'); Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log('     ' + k.padEnd(30) + Math.round(v / 1000) + ' ms')); }
  { const t = Date.now(); try { await A.shpSyncAll({ maintain: true, dry: true }); } catch (e) { console.log('   sync threw', e.message); } console.log('   shpSyncAll maintain'.padEnd(33) + String(Date.now() - t).padStart(6) + ' ms'); }
  const el = H.els && H.els.soTable; if (el) console.log('   table html ' + (String(el.innerHTML || '').length / 1024).toFixed(0) + ' KB · rows ' + (String(el.innerHTML || '').match(/<tr data-so=/g) || []).length);
})().catch(e => { console.error('FAILED', e && (e.stack || e.message || e)); process.exit(1); });
