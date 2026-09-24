/* TAKE OFF THE ZIPPERS THAT SHOULD ALREADY HAVE COME OFF. Dry run unless --apply.
 *
 *   node zip-backfill.js            what would be written, and the balance each zipper would be left at
 *   node zip-backfill.js --apply    write it
 *
 * Ravi, 2026-09-24: "accessories me zip padi h but ye auto minus nahi ho rhi h." Two holes, both now
 * closed in the app: issues from the Shopify screen never deducted zippers, and from 22 Sep the list the
 * deduction looks in had lost them. The issues are in the Job Work register; the zippers that went with
 * them never left the accessories ledger.
 *
 * WHAT IS WRITTEN is exactly what ptConsumeZippers writes at the moment of an issue — same key
 * (acc_auto_<issue id>), same fields, same quantity rule (the zips typed on the issue, else pieces x the
 * SKU's zips per piece) — so a row written here is indistinguishable from one written on time, except
 * that it says it was backfilled. The key means running this twice writes nothing twice, and deleting
 * the issue still gives the zippers back.
 *
 * FROM WHEN: for each zipper, from its first movement in the ledger. Before that there was no stock of
 * it to take anything from, and nobody was keeping this ledger.
 *
 * NOTHING IS REFUSED FOR BEING SHORT. The gate that stops an issue the shelf cannot cover belongs at the
 * moment of the issue; these pieces have already been issued and sewn. If a zipper goes below zero, that
 * is the ledger telling the truth — the stock typed in does not cover what was used — and it is shown.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const HOST = 'price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const up = v => String(v == null ? '' : v).trim().toUpperCase();
const list = v => !v ? [] : (Array.isArray(v) ? v : Object.entries(v).map(([k, x]) => x && typeof x === 'object' ? Object.assign({ _key: k }, x) : x)).filter(Boolean);
const zipQty = m => { const n = parseFloat(m && m.zipQty); return isFinite(n) && n > 0 ? n : 1; };

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const call = (method, p, body) => new Promise((res, rej) => {
    const r = https.request({ hostname: HOST, path: '/' + p + '.json', method,
      headers: Object.assign({ Authorization: 'Bearer ' + at }, body ? { 'Content-Type': 'application/json' } : {}) },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ status: x.statusCode, j: JSON.parse(d) }); } catch (e) { res({ status: x.statusCode, j: d }); } }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
  const [items, ledger, mdb, base] = (await Promise.all(['pt_masters/accessories', 'pt_accLedger', 'pt_masterDB', 'pt_baseData']
    .map(p => call('GET', p)))).map(r => list(r.j));

  const itemBy = new Map(items.map(i => [up(i.code), i]));
  const skuOf = new Map(mdb.map(m => [up(m.sku), m]));
  const have = new Set(ledger.map(r => String(r._id || r._key || '')));
  const first = {};
  ledger.forEach(r => { const c = up(r.itemCode), d = String(r.createdAt || r.date || ''); if (c && d && (!first[c] || d < first[c])) first[c] = d; });
  const bal = {};
  ledger.forEach(r => { const c = up(r.itemCode), q = parseFloat(r.qty) || 0;
    bal[c] = (bal[c] || 0) + (['OPENING', 'IN', 'RETURN'].includes(r.txnType) ? q : (r.txnType === 'OUT' ? -q : 0)); });

  const recs = [], skipped = {};
  const skip = w => { skipped[w] = (skipped[w] || 0) + 1; };
  base.forEach(e => {
    const m = skuOf.get(up(e.sku));
    if (!m || m.isZip !== true) return;
    const chain = m.chainLength;
    if (chain == null || isNaN(parseFloat(chain))) return skip('zip SKU with no chain length');
    const id = 'acc_auto_' + e.id;
    if (have.has(id)) return;                                     // taken on time
    const item = itemBy.get(up(chain));
    if (!item) return skip('zipper ' + chain + ' not on the list');
    const at = String(e.addedAt || '');
    if (!first[up(item.code)] || !at || at < first[up(item.code)]) return skip('before that zipper had any stock');
    const said = parseFloat(e.zipsIssued);
    const need = isFinite(said) && said >= 0 ? said : (parseInt(e.issuePieces, 10) || 0) * zipQty(m);
    if (!(need > 0)) return;
    recs.push({ _id: id, txnType: 'OUT', itemCode: item.code, qty: need,
      date: String(e.issueDate || '').slice(0, 10) || at.slice(0, 10),
      issuedTo: String(e.empName || '').trim(), ref: 'AUTO · ' + e.sku,
      remarks: `Automatic zipper consumption — ${e.issuePieces} piece(s) issued to ${e.empName || ''}`
        + ' · backfilled 24 Sep 2026 (missed by the Shopify screen / the emptied accessories list)',
      auto: true, backfilled: true, srcEntryId: e.id, createdBy: 'ravi@thefabricrush.com', createdAt: at || new Date().toISOString(),
      _src: e.src || 'form' });
  });

  const by = {};
  recs.forEach(r => { const c = up(r.itemCode); const x = by[c] || (by[c] = { n: 0, q: 0, shp: 0 }); x.n++; x.q += r.qty; if (r._src === 'SHP') x.shp++; });
  console.log('zippers that should already have come off:\n');
  console.log('   zipper   issues   zips   (Shopify screen)   balance now  ->  after');
  Object.keys(by).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach(c => {
    const b0 = Math.round(bal[c] || 0), b1 = Math.round((bal[c] || 0) - by[c].q);
    console.log('   ' + c.padEnd(8) + String(by[c].n).padStart(7) + String(by[c].q).padStart(7) + String(by[c].shp).padStart(12)
      + '        ' + String(b0).padStart(8) + '  ->  ' + String(b1).padStart(6) + (b1 < 0 ? '   BELOW ZERO — stock entered does not cover what was used' : ''));
  });
  console.log('\n   total: ' + recs.length + ' issue(s), ' + recs.reduce((a, r) => a + r.qty, 0) + ' zipper(s)');
  if (Object.keys(skipped).length) console.log('   not written: ' + JSON.stringify(skipped));
  if (!recs.length) return;
  if (!APPLY) return console.log('\n(dry run — nothing written. Run with --apply to write.)');

  const patch = {};
  recs.forEach(r => { const x = Object.assign({}, r); delete x._src; patch[r._id] = x; });
  const w = await call('PATCH', 'pt_accLedger', patch);
  if (w.status !== 200) throw new Error('write refused: HTTP ' + w.status + ' ' + JSON.stringify(w.j).slice(0, 200));
  console.log('\nwritten: ' + recs.length + ' row(s) in pt_accLedger.');
})().catch(e => { console.error(e.message); process.exit(1); });
