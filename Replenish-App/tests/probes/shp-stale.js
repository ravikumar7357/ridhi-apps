/* SHOPIFY vs THE PRODUCTION QUEUE (2026-09-23).
 *
 * Ravi: partly shipped orders are still being asked for from production, and orders that have NOT
 * shipped and do need production are not open. This compares the two, order by order:
 *
 *   node shp-stale.js [daysBack]
 *
 * For every SHP row in the order book it finds the Shopify order behind it and asks whether that
 * line has shipped; and for every fetched order it asks whether a line that still needs making has
 * no row. Nothing is written.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const days = Number(process.argv[2] || 60);
const shipped = i => /^ful/i.test(String((i && i.ffl) || ''));
const uc = v => String(v == null ? '' : v).trim().toUpperCase();

const getJson = (url, headers) => new Promise((res, rej) => {
  https.get(url, { headers: headers || {} }, r => {
    if (r.statusCode >= 300 && r.headers.location) return res(getJson(r.headers.location, headers));
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(String(r.statusCode) + ' ' + d.slice(0, 200))); } });
  }).on('error', rej);
});

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const rtdb = p => getJson(DB + '/' + p + '.json', { Authorization: 'Bearer ' + at });
  const doc = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/config/api`, { Authorization: 'Bearer ' + at });
  const url = doc.fields.url.stringValue, keyv = doc.fields.key.stringValue;

  const end = new Date(), start = new Date(Date.now() - days * 864e5);
  const iso = d => d.toISOString().slice(0, 10);
  const r = await getJson(`${url}?key=${encodeURIComponent(keyv)}&shopify=orders&start=${iso(start)}&end=${iso(end)}&open=0`);
  const orders = r.orders || [];
  const byNo = new Map(orders.map(o => [String(o.no || ''), o]));
  const byId = new Map(orders.map(o => [String(o.id || ''), o]));

  const [ob, base, cut] = await Promise.all([rtdb('pt_orderBook'), rtdb('pt_baseData'), rtdb('pt_cuttingData')]);
  const rows = Object.values(ob || {}).filter(x => x && String(x.src || '') === 'SHP');
  /* work already done against an order+sku — the reason a row is kept even when the line has gone */
  const work = new Map();
  const note = (o, s, n) => { const k = uc(o) + '|' + uc(s); work.set(k, (work.get(k) || 0) + (Number(n) || 0)); };
  Object.values(base || {}).forEach(b => b && note(b.orderNo, b.sku, b.issuePieces));
  Object.values(cut || {}).forEach(c => c && note(c.orderNo, c.sku, c.pieces));

  const stale = [], unknown = [], kept = [];
  rows.forEach(x => {
    const o = byId.get(String(x.shopOrderId || '')) || byNo.get(String(x.shopOrderNo || ''));
    if (!o) { unknown.push(x); return; }
    const lines = (o.items || []).filter(i => uc(i.sku) === uc(x.sku));
    if (!lines.length) return;
    const gone = lines.every(shipped) || !!/^ful/i.test(String(o.ff || '')) || !!o.cancelled;
    if (!gone) return;
    (work.get(uc(x.orderNo) + '|' + uc(x.sku)) > 0 ? kept : stale).push({ no: x.orderNo, shop: o.no, sku: x.sku, qty: x.qty, ff: o.ff || '' });
  });

  console.log('SHP rows in the order book:', rows.length, '· Shopify orders read:', orders.length, `(last ${days} days)`);
  console.log('\n1) rows whose line HAS shipped and no work started — these should close:', stale.length);
  stale.slice(0, 25).forEach(s => console.log('   ', s.no, '·', s.shop, '·', s.sku, '· qty', s.qty, '· order', s.ff));
  console.log('\n2) rows whose line has shipped but production already started (kept on purpose):', kept.length);
  kept.slice(0, 15).forEach(s => console.log('   ', s.no, '·', s.shop, '·', s.sku));
  console.log('\n3) rows whose Shopify order is outside the window read here:', unknown.length);

  /* the other direction: a line that still needs making, with no row against it */
  const have = new Set(rows.map(x => uc(x.shopOrderId || '') + '|' + uc(x.sku)));
  const missing = [];
  orders.forEach(o => {
    if (o.cancelled || /^ful/i.test(String(o.ff || ''))) return;
    (o.items || []).forEach(i => {
      if (shipped(i)) return;
      if (!(Number(i.fq) > 0)) return;              // nothing left to fulfil on this line
      if (!uc(i.sku)) return;
      if (have.has(uc(o.id) + '|' + uc(i.sku))) return;
      missing.push({ shop: o.no, sku: i.sku, qty: i.fq, at: String(o.at || '').slice(0, 10) });
    });
  });
  console.log('\n4) unshipped lines with NO production row (may be fillable from Amazon/India stock):', missing.length);
  missing.slice(0, 20).forEach(m => console.log('   ', m.shop, '·', m.sku, '· to fulfil', m.qty, '·', m.at));
})().catch(e => { console.error(e.message || e); process.exit(1); });
