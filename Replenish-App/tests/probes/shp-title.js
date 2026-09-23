/* WHAT A CODELESS SHOPIFY LINE ACTUALLY CARRIES, and what the master database has that could match
 * it — read-only.
 *
 *   node shp-title.js 6571
 *
 * Ravi, 2026-09-23: "title me 3 things h subtype color and size but size me yaha " sign h to iske
 * basis par masterdata me sku mil jayega". Before matching on a title, look at both sides of the
 * match exactly as they are stored.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const getJson = (url, headers) => new Promise((res, rej) => {
  https.get(url, { headers: headers || {} }, r => {
    if (r.statusCode >= 300 && r.headers.location) return res(getJson(r.headers.location, headers));
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(String(r.statusCode) + ' ' + d.slice(0, 300))); } });
  }).on('error', rej);
});
const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const want = String(process.argv[2] || '6571').replace(/^#/, '');
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const doc = await getJson(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/config/api`, { Authorization: 'Bearer ' + at });
  const f = doc.fields || {};
  const url = (f.url && f.url.stringValue) || '', key = (f.key && f.key.stringValue) || '';

  const u = new URL(url);
  u.searchParams.set('key', key);
  u.searchParams.set('shopify', 'orders');
  u.searchParams.set('shop', 'CPC');
  u.searchParams.set('start', day(-45)); u.searchParams.set('end', day(0)); u.searchParams.set('open', '0');
  const d = await getJson(u.toString());
  const o = (d.orders || []).find(x => String(x.no || '').replace(/^#/, '') === want);
  if (!o) { console.log('order', want, 'not in the last 45 days of the CPC shop'); }
  else {
    console.log('=== #' + o.no + ' — every field each line carries, verbatim');
    (o.items || []).forEach(i => console.log(JSON.stringify(i, null, 1)));
  }

  const mdb = await new Promise((res, rej) => https.get(DB + '/pt_masterDB.json?auth=' + at, r => {
    let s = ''; r.on('data', c => s += c); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(new Error(s.slice(0, 200))); } });
  }).on('error', rej));
  const rows = (Array.isArray(mdb) ? mdb : Object.values(mdb || {})).filter(Boolean);
  console.log('\n=== master database: ' + rows.length + ' row(s)');
  const hit = rows.filter(r => /ruffle tablecloth/i.test(String(r.articleSubtype || '') + ' ' + String(r.articleType || ''))
    && /agate/i.test(String(r.color || '')));
  console.log('rows whose subtype is a Ruffle Tablecloth and colour is Agate:', hit.length);
  hit.forEach(r => console.log('  ', r.sku, '| type:', r.articleType, '| subtype:', r.articleSubtype, '| colour:', r.color, '| size:', JSON.stringify(r.size)));

  /* How sizes are actually written across the whole database — the shape of the thing to match. */
  const sizes = {};
  rows.forEach(r => { const s = String(r.size || '').trim(); if (s) sizes[s] = (sizes[s] || 0) + 1; });
  const top = Object.entries(sizes).sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log('\n=== the commonest size spellings in the master');
  top.forEach(([s, n]) => console.log('  ', JSON.stringify(s), '·', n));
  console.log('   sizes holding a quote or an inch mark:',
    Object.keys(sizes).filter(s => /["\u2033\u201d]/.test(s)).slice(0, 10).map(s => JSON.stringify(s)).join(', ') || 'none');
})().catch(e => { console.error(e.message); process.exit(1); });
