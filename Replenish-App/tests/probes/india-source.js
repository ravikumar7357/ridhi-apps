/* CAN INDIA STOCK COME OUT OF THIS APP INSTEAD OF THE WORKBOOK — read-only.
 *
 *   node india-source.js
 *
 * Ravi, 2026-09-23: "india stock ab isi app se jodo other google sheet se nahi".
 *
 * Before moving the source of a number that decides every reorder, both sides are counted: what the
 * warehouse workbook says today, and what this app's own Finished Goods (pt_fgi) would say. The
 * answer is the overlap and, more importantly, the gap — the SKUs one side knows and the other
 * does not, and how far the quantities differ where both know a SKU.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const get = (u, h) => new Promise((res, rej) => https.get(u, { headers: h || {} }, r => {
  if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, h));
  let d = ''; r.on('data', c => d += c);
  r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(r.statusCode + ' ' + d.slice(0, 200))); } });
}).on('error', rej));
const up = v => String(v == null ? '' : v).trim().toUpperCase();

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const H = { Authorization: 'Bearer ' + at };
  const api = (await get('https://firestore.googleapis.com/v1/projects/' + PROJ + '/databases/(default)/documents/config/api', H)).fields || {};

  /* ---- what the workbook says ---- */
  const u = new URL(api.url.stringValue);
  u.searchParams.set('key', api.key.stringValue);
  u.searchParams.set('india', 'stock');
  const t0 = Date.now();
  const live = await get(u.toString());
  const sheet = live.d || {};
  console.log('the warehouse workbook:', Object.keys(sheet).length, 'SKU(s) ·', (Date.now() - t0) + ' ms · read', live.at || '?');
  const sheetQty = new Map();
  Object.keys(sheet).forEach(k => sheetQty.set(up(k), Number(sheet[k][0]) || 0));

  /* ---- what this app holds ---- */
  const [fgi, fgt] = await Promise.all([get(DB + '/pt_fgi.json', H), get(DB + '/pt_fgiTxn.json', H)]);
  const rows = Object.values(fgi || {}).filter(Boolean);
  const txns = Object.values(fgt || {}).filter(Boolean);
  console.log('this app: pt_fgi', rows.length, 'row(s) · pt_fgiTxn', txns.length, 'row(s)');
  if (rows.length) console.log('  a pt_fgi row looks like:', JSON.stringify(rows[0]).slice(0, 300));
  if (txns.length) console.log('  a pt_fgiTxn row looks like:', JSON.stringify(txns[0]).slice(0, 300));

  /* Finished Goods, added up per SKU however it stores itself. */
  const appQty = new Map();
  const add = (sku, n) => { const k = up(sku); if (!k) return; appQty.set(k, (appQty.get(k) || 0) + (Number(n) || 0)); };
  rows.forEach(r => add(r.sku, r.qty != null ? r.qty : (r.pieces != null ? r.pieces : r.pcs)));
  if (!appQty.size) txns.forEach(r => add(r.sku, r.qty != null ? r.qty : r.pieces));
  console.log('this app knows', appQty.size, 'SKU(s) with a quantity');

  const inBoth = [...sheetQty.keys()].filter(k => appQty.has(k));
  const sheetOnly = [...sheetQty.keys()].filter(k => !appQty.has(k));
  const appOnly = [...appQty.keys()].filter(k => !sheetQty.has(k));
  console.log('\nboth know:', inBoth.length, '· workbook only:', sheetOnly.length, '· this app only:', appOnly.length);

  const diffs = inBoth.map(k => ({ k, s: sheetQty.get(k), a: appQty.get(k) })).filter(x => x.s !== x.a);
  console.log('of the', inBoth.length, 'they share,', diffs.length, 'disagree on the quantity');
  diffs.sort((a, b) => Math.abs(b.s - b.a) - Math.abs(a.s - a.a)).slice(0, 15)
    .forEach(x => console.log('   ', x.k.padEnd(20), 'workbook', String(x.s).padStart(6), '· app', String(x.a).padStart(6)));
  console.log('\nthe biggest the workbook has and the app does not:');
  sheetOnly.map(k => [k, sheetQty.get(k)]).sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, v]) => console.log('   ', k.padEnd(20), v));
})().catch(e => { console.error(e.message); process.exit(1); });
