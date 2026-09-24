/* WHAT THE APP CARRIES, NODE BY NODE — how big, and how long to read. Read-only.
 *
 *   node weight.js
 *
 * Ravi, 2026-09-24: "system bahut hang ho rha h abhi."
 *
 * A hang is either bytes on the wire or work in the browser, and the two are told apart by numbers,
 * not by opinion. This prints, for every node the app reads on the way in and on the heavy screens:
 * the wire size, the row count, and the seconds the read itself took. The eight ptLoadGates nodes
 * are read together the way the app reads them, so the figure at the bottom is the real wait before
 * anything at all appears.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';

const get = (u, h) => new Promise((res, rej) => https.get(u, { headers: h || {} }, r => {
  if (r.statusCode >= 300 && r.headers.location) return res(get(r.headers.location, h));
  let n = 0; const d = [];
  r.on('data', c => { n += c.length; d.push(c); });
  r.on('end', () => res({ status: r.statusCode, bytes: n, text: Buffer.concat(d).toString('utf8') }));
}).on('error', rej));

const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';

/* The eight the app reads before it will show anything, then the ones a screen adds. */
const GATES = ['pt_masters', 'pt_masterDB', 'pt_orderBook', 'pt_pressInventory',
  'pt_cuttingFreezes', 'pt_cuttingData', 'pt_baseData', 'pt_shopProd'];
const EXTRA = ['pt_skuImages', 'pt_vendorOrders', 'pt_fabInvLedger', 'pt_empList',
  'pt_qcData', 'pt_fgiLedger', 'pt_deliveries', 'pt_rfdDecisions', 'pt_rfdReqs',
  'pt_amzListings', 'pt_perms', 'pt_salesOrders'];

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  const H = { Authorization: 'Bearer ' + (tok.access_token || tok) };

  const one = async name => {
    const t = Date.now();
    let r;
    try { r = await get(DB + '/' + name + '.json', H); }
    catch (e) { return { name, err: e.message }; }
    const took = Date.now() - t;
    let rows = null;
    try { const j = JSON.parse(r.text); rows = j == null ? 0 : (Array.isArray(j) ? j.length : Object.keys(j).length); }
    catch (e) { /* not an object */ }
    return { name, bytes: r.bytes, rows, took, status: r.status };
  };

  const show = r => console.log('   ' + r.name.padEnd(22)
    + (r.err ? 'FAILED — ' + r.err
      : String(r.rows == null ? '—' : r.rows).padStart(8) + ' rows'
        + mb(r.bytes).padStart(10) + (r.took / 1000).toFixed(1).padStart(8) + ' s'
        + (r.status !== 200 ? '   HTTP ' + r.status : '')));

  console.log('=== READ BEFORE ANY SCREEN APPEARS (ptLoadGates — the app reads these eight together)');
  const t0 = Date.now();
  const gates = await Promise.all(GATES.map(one));
  const wall = Date.now() - t0;
  gates.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).forEach(show);
  console.log('   ' + ''.padEnd(22) + String(gates.reduce((a, g) => a + (g.rows || 0), 0)).padStart(8)
    + ' rows' + mb(gates.reduce((a, g) => a + (g.bytes || 0), 0)).padStart(10)
    + (wall / 1000).toFixed(1).padStart(8) + ' s   <- all eight at once');

  console.log('\n=== READ WHEN A SCREEN ASKS FOR IT');
  const extra = [];
  for (const n of EXTRA) extra.push(await one(n));          // one at a time: their own true cost
  extra.sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).forEach(show);

  const big = gates.concat(extra).filter(r => r.bytes > 2 * 1048576);
  if (big.length) {
    console.log('\n=== OVER 2 MB — every one of these is parsed into objects in the browser too');
    big.sort((a, b) => b.bytes - a.bytes).forEach(r => console.log('   ' + r.name + ' · ' + mb(r.bytes)
      + ' · ' + r.rows + ' rows · ' + (r.bytes / Math.max(1, r.rows)).toFixed(0) + ' bytes a row'));
  }
})().catch(e => { console.error(e.message); process.exit(1); });
