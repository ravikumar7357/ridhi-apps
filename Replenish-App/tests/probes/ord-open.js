/* How many order lines the Order Console's pending book holds, and where today's bucket lines fall (read-only). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = u => new Promise((res, rej) => https.get(u, { headers: { Authorization: 'Bearer ' + at }, timeout: 120000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
  const [ob, press] = await Promise.all([get(DB + '/pt_orderBook.json'), get(DB + '/pt_pressInventory.json')]);
  const U = s => String(s || '').trim().toUpperCase();
  const P = {}; Object.values(press || {}).forEach(r => { if (r) { const k = U(r.orderNo) + '|' + U(r.sku); P[k] = (P[k] || 0) + (parseInt(r.pieces, 10) || 0); } });
  const by = {}, order = [];
  Object.entries(ob || {}).forEach(([k, r]) => { if (!r || !r.orderNo || !r.sku) return; const kk = U(r.orderNo) + '|' + U(r.sku);
    if (!by[kk]) { by[kk] = { no: U(r.orderNo), qty: 0, done: '', src: r.src, bucketToday: false }; order.push(kk); }
    by[kk].qty += Number(r.pcs || r.qty) || 0; if (r.shopDoneAt) by[kk].done = r.shopDoneAt;
    if (r.openedFrom === 'bucket' && String(r.openedAt).slice(0, 10) === '2026-09-28') by[kk].bucketToday = true; });
  const open = order.filter(k => !by[k].done && (P[k] || 0) < by[k].qty);
  console.log('lines', order.length, '· pending (rough)', open.length);
  const pos = open.map((k, i) => by[k].bucketToday ? i : -1).filter(i => i >= 0);
  console.log('today\'s bucket lines in the pending list:', pos.length, '· positions', pos.slice(0, 5), '…', pos.slice(-3), '· past 600:', pos.filter(i => i >= 600).length);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
