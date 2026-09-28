/* What "Fill from look-alikes" would write on the live data — the page's own functions, read-only. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const src = fs.readFileSync(pathm.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('/**\n * WHAT "Fill from look-alikes" WOULD WRITE'), z = src.indexOf('\nfunction obWhat(r) {');
const block = src.slice(a, z).replace("if ($('ptmLookalike')) $('ptmLookalike').onclick = () => skuFillOpen();", '');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [mdbRaw, vo, cus] = await Promise.all([get(DB + '/pt_masterDB.json'), get(DB + '/pt_vendorOrders.json'), get(DB + '/pt_customSkus.json')]);
  const obUC = s => String(s == null ? '' : s).trim().toUpperCase();
  const PTG = { mdb: Object.values(mdbRaw || {}).filter(Boolean) }, PT_NONE = [];
  const mIx = new Map(PTG.mdb.map(r => [obUC(r.sku), r]));
  const f = new Function('PTG', 'PT_NONE', 'obUC', 'mdbOf', 'voRunning', block + '\nreturn { skuFillPlan, skuLookalike };');
  const A = f(PTG, PT_NONE, obUC, s => mIx.get(obUC(s)), o => o.orderType === 'running');
  const orders = []; Object.entries(vo || {}).forEach(([code, os]) => Object.entries(os || {}).forEach(([id, o]) => { if (o) orders.push(Object.assign({ vendorCode: code, id }, o)); }));
  const custom = Object.entries(cus || {}).map(([k, v]) => Object.assign({ _key: k }, v));
  const plan = A.skuFillPlan(custom, orders);
  const full = x => ['articleType', 'color', 'size'].every(k => x.l ? (x.l[k] || x.w[k]) : (x.w[k] || '')); 
  console.log('vendor-order lines to fill', plan.lines.length, '· complete after', plan.lines.filter(x => (x.l.articleType || x.w.articleType) && (x.l.color || x.w.color) && (x.l.size || x.w.size)).length);
  console.log('custom SKUs to fill', plan.custom.length, '· nothing looks like', plan.noGuess.size);
  plan.lines.slice(0, 14).forEach(x => console.log('  ', x.sku.padEnd(16), JSON.stringify(x.w), '←', x.from));
  console.log('  …custom:'); plan.custom.slice(0, 10).forEach(x => console.log('  ', x.sku.padEnd(16), JSON.stringify(x.w), '←', x.from));
  console.log('  nothing:', [...plan.noGuess].slice(0, 20).join(' '));
})().catch(e => { console.error('FAILED', e.stack || e); process.exit(1); });
