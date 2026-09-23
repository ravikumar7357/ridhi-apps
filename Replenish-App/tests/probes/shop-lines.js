/* WHAT SHOPIFY ACTUALLY SAYS PER LINE (2026-09-23: partly shipped orders still asking production).
 *
 *   node shop-lines.js 2026-09-19 2026-09-23 [orderNo]
 *
 * Reads the backend the app reads, and prints each order's fulfilment state and every line's own
 * ffl / fulfillable / current quantity — the three the app judges "already gone" by.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';

const getJson = (url, headers) => new Promise((res, rej) => {
  https.get(url, { headers: headers || {} }, r => {
    if (r.statusCode >= 300 && r.headers.location) return res(getJson(r.headers.location, headers));
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(String(r.statusCode) + ' ' + d.slice(0, 300))); } });
  }).on('error', rej);
});

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/config/api`, { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const url = (f.url && f.url.stringValue) || '', keyv = (f.key && f.key.stringValue) || '';
  if (!url) { console.error('no backend url in config/api:', JSON.stringify(Object.keys(f))); process.exit(1); }
  const [from, to, want] = [process.argv[2], process.argv[3], process.argv[4]];
  const q = `${url}?key=${encodeURIComponent(keyv)}&shopify=orders&start=${from}&end=${to}&open=0`;
  const r = await getJson(q);
  const orders = r.orders || [];
  console.log('orders', orders.length, 'from', r.from, 'to', r.to);
  const show = want ? orders.filter(o => String(o.no || '').includes(want)) : orders;
  let partial = 0;
  show.forEach(o => {
    const lines = o.items || [];
    const gone = lines.filter(i => /^ful/i.test(String(i.ffl || '')));
    if (!want && !(gone.length && gone.length < lines.length)) return;   // only the partly shipped ones
    partial++;
    if (partial > 6 && !want) return;
    console.log('\norder', o.no, '· order ff:', JSON.stringify(o.ff), '· lines', lines.length, '· lines marked fulfilled', gone.length);
    lines.forEach(i => console.log('   ', String(i.sku || '(no sku)').padEnd(16), 'qty', i.qty, '· ffl', JSON.stringify(i.ffl), '· fulfillable', i.fq, '· current', i.cq));
  });
  if (!want) console.log('\npartly shipped orders in that window:', partial);
})().catch(e => { console.error(e.message || e); process.exit(1); });
