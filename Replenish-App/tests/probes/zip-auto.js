/* WHY THE ZIPPERS DO NOT COME OFF ON THEIR OWN. Read-only.
 *
 *   node zip-auto.js
 *
 * Ravi, 2026-09-24: "accessories me zip padi h but ye auto minus nahi ho rhi h." The Accessories screen
 * shows zip stock under codes 16, 18, 20, 24, 30, 40 — each flagged "not in master".
 *
 * ptConsumeZippers finds the accessory whose code equals the SKU's chainLength on the ACCESSORIES LIST
 * (not the ledger). If the list lacks it, it throws, and the Job Work save catches that and carries on —
 * the issue is booked and the zips stay on the shelf. This checks each link of that chain on live data.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const up = v => String(v == null ? '' : v).trim().toUpperCase();
const list = v => !v ? [] : (Array.isArray(v) ? v : Object.entries(v).map(([k, x]) => x && typeof x === 'object' ? Object.assign({ _key: k }, x) : x)).filter(Boolean);

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } }); }));
  const [acc, ledger, mdb, base] = await Promise.all(['pt_masters/accessories', 'pt_accLedger', 'pt_masterDB', 'pt_baseData'].map(get));

  const items = list(acc);
  console.log('=== 1. the accessories LIST (pt_masters/accessories) — what ptConsumeZippers searches');
  console.log('   ' + items.length + ' item(s): ' + items.map(i => JSON.stringify(up(i.code)) + (i.name ? ' ' + i.name : '')).join(' · ').slice(0, 900));

  const L = list(ledger);
  const byCode = {};
  L.forEach(r => { const c = up(r.itemCode); const e = byCode[c] || (byCode[c] = { in: 0, out: 0, auto: 0, n: 0, first: '', last: '' });
    const q = parseFloat(r.qty) || 0; e.n++;
    if (r.txnType === 'OUT' || r.txnType === 'ISSUE') e.out += q; else e.in += q;
    if (r.auto) e.auto++;
    const d = String(r.createdAt || r.date || ''); if (d && (!e.first || d < e.first)) e.first = d; if (d > e.last) e.last = d; });
  const onList = new Set(items.map(i => up(i.code)));
  console.log('\n=== 2. the LEDGER (pt_accLedger) by code — ' + L.length + ' rows');
  Object.entries(byCode).sort().forEach(([c, e]) => console.log('   ' + JSON.stringify(c).padEnd(14) + (onList.has(c) ? 'on list  ' : 'NOT ON LIST')
    + '  in ' + e.in + ' · out ' + e.out + ' · automatic ' + e.auto + ' · first ' + e.first.slice(0, 10) + ' · last ' + e.last.slice(0, 10)));
  const txn = {}; L.forEach(r => { txn[r.txnType] = (txn[r.txnType] || 0) + 1; });
  console.log('   movement types: ' + JSON.stringify(txn));

  const M = list(mdb);
  const zipSkus = M.filter(m => m.isZip === true);
  const chains = {}; zipSkus.forEach(m => { const c = up(m.chainLength); chains[c] = (chains[c] || 0) + 1; });
  console.log('\n=== 3. the MASTER — ' + zipSkus.length + ' SKU(s) marked isZip; their chainLength values:');
  console.log('   ' + Object.entries(chains).sort((a, b) => b[1] - a[1]).map(([c, n]) => JSON.stringify(c) + '×' + n).join(' · '));
  const miss = Object.keys(chains).filter(c => !onList.has(c));
  console.log('   chain lengths with NO item on the accessories list: ' + (miss.length ? miss.map(c => JSON.stringify(c)).join(', ') : 'none'));
  const zipByLen = M.filter(m => m.isZip !== true && m.chainLength != null && String(m.chainLength).trim() !== '').length;
  console.log('   SKUs with a chainLength but isZip NOT true (never deducted): ' + zipByLen);

  /* ---- what SHOULD have come off ---- */
  const skuOf = new Map(M.map(m => [up(m.sku), m]));
  const autoIds = new Set(L.filter(r => r.auto && r.srcEntryId).map(r => String(r.srcEntryId)));
  const firstStock = Object.values(byCode).map(e => e.first).filter(Boolean).sort()[0] || '';
  const B = list(base);
  const should = [], why = {};
  B.forEach(r => {
    const m = skuOf.get(up(r.sku)); if (!m || m.isZip !== true) return;
    const q = parseInt(r.issuePieces, 10) || 0; if (!q) return;
    const at = String(r.addedAt || '');
    if (firstStock && at < firstStock) return;
    const c = up(m.chainLength);
    const done = autoIds.has(String(r.id));
    const reason = done ? 'deducted' : (!onList.has(c) ? 'chain ' + JSON.stringify(c) + ' not on the list' : 'on the list, still not deducted');
    why[reason] = (why[reason] || 0) + q * (parseFloat(m.zipQty) || 1);
    should.push({ at, sku: r.sku, q, c, reason, src: r.src || 'form' });
  });
  console.log('\n=== 4. Job Work issues of zip SKUs since the first zip stock (' + firstStock.slice(0, 10) + ') — ' + should.length + ' issue(s)');
  Object.entries(why).forEach(([k, v]) => console.log('   ' + k.padEnd(40) + v + ' zip(s)'));
  const bySrc = {}; should.forEach(x => { const k = x.src + ' · ' + (x.reason === 'deducted' ? 'deducted' : 'NOT deducted'); bySrc[k] = (bySrc[k] || 0) + 1; });
  console.log('   by where the issue was made: ' + JSON.stringify(bySrc));
  const shpBefore = should.filter(x => x.src === 'SHP' && x.at < '2026-09-22');
  console.log('   Shopify-screen issues BEFORE the list was wiped: ' + shpBefore.length + ', of which deducted: ' + shpBefore.filter(x => x.reason === 'deducted').length);
  should.slice(-8).forEach(x => console.log('     ' + x.at.slice(0, 16) + ' · ' + x.sku + ' · ' + x.q + ' pcs · chain ' + x.c + ' · ' + x.reason));
})().catch(e => { console.error(e.message); process.exit(1); });
