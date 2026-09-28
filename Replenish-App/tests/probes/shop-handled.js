/* ORDERS HIDDEN FROM PRODUCTION BY A "DONE / READY" NOTE (read-only). START=2026-07-01 node shop-handled.js */
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
  const from = process.env.START || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
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
  const ind = process.env.NOINDIA ? { j: { d: {} }, ms: 0 } : await req(url + '?key=' + encodeURIComponent(key) + '&india=stock', false);
  A.setIndia((ind.j && ind.j.d) || {}, true, '');
  console.log('   Amazon stock SKUs ' + Object.keys(stk).length + ' · India stock SKUs ' + Object.keys((ind.j && ind.j.d) || {}).length + ' (' + ind.ms + ' ms)');
  console.log('   order book rows in the harness', H.PTG.ob.length);
  A.soRows();
  const all = (typeof A.SO_ALL_ROWS === 'function' ? A.SO_ALL_ROWS() : A.SO_ALL_ROWS) || [];
  const opened = new Set(H.PTG.ob.filter(x => x && x.shopOrderId).map(x => String(x.shopOrderId) + '|' + String(x.sku).toUpperCase()));
  const hid = [];
  all.filter(o => o && o.handled && !o.shipped && !o.cancelled).forEach(o => {
    const raw = A.SHOP().orders.find(x => String(x.id) === String(o.id)) || o;
    const f = A.soFlags(raw, A.SHOP_META()[o.id] || {});
    const make = (o.items || []).filter(i => { if (A.shpLineShipped(i)) return false; let st; try { st = A.soLineState(o, i); } catch (e) { return false; } return st && st.v === 'make'; });
    if (make.length) hid.push({ no: o.no, at: String(o.at).slice(0, 10), why: f.handledWhy, ff: o.ff, make: make.map(i => i.sku + (opened.has(String(o.id) + '|' + String(i.sku).toUpperCase()) ? '(on book)' : '')).join(' ') });
  });
  console.log('\nhandled, not shipped, with lines stock cannot fill:', hid.length, 'orders,', hid.reduce((t, h) => t + h.make.split(' ').length, 0), 'lines');
  const byWhy = {}; hid.forEach(h => { const k = h.why.replace(/“.*”/, m => m.toUpperCase()); byWhy[k] = (byWhy[k] || 0) + 1; });
  console.log(byWhy);
  hid.slice(0, 40).forEach(h => console.log(' ', h.no, h.at, h.ff, '|', h.why, '|', h.make));
})().catch(e => { console.error('FAILED', e.stack || e); process.exit(1); });
