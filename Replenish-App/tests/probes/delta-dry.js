/* DELTA SYNC — the shadow (core/delta-sync.js) run against the LIVE database, read-only. Its log line is printed, not
 * written. Run twice in one process: the first finds no copy and keeps one; the second rebuilds from it.
 *   node delta-dry.js [nodes,comma,separated]
 * What it proves that the unit test cannot: the real keys survive the paths, the $value query and ?shallow work on the
 * real registers, and the sizes are what phase 3 would really download. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PT_URL = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const SRC = fs.readFileSync(pathm.join(__dirname, '..', '..', 'src', 'app', 'core', 'delta-sync.js'), 'utf8');
const DBJS = fs.readFileSync(pathm.join(__dirname, '..', '..', 'src', 'app', 'core', 'database.js'), 'utf8');
const ptPath = new Function(DBJS.match(/const ptPath = [\s\S]*?\.join\('\/'\);/)[0] + '\nreturn ptPath;')();
const NODES = (process.argv[2] || 'pt_orderBook,pt_masterDB,pt_cuttingData,pt_pressInventory,pt_shopProd,pt_masters,pt_cuttingFreezes,pt_qcChecks').split(',');
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tk = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tk.access_token || tk;
  let got = 0;
  const fetch = (url) => new Promise((res, rej) => https.get(url, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => {
    got += d.length; res({ ok: x.statusCode < 300, status: x.statusCode, text: async () => d, json: async () => JSON.parse(d) }); }); }).on('error', rej));
  /* The truth, once, the way the live copy would hold it. */
  const truth = {};
  for (const n of NODES) truth[n] = JSON.parse((await (await fetch(`${PT_URL}/${n}.json?access_token=${at}`)).text()));
  got = 0;
  const store = new Map();
  const indexedDB = { open: () => { const req = {}; const db = { objectStoreNames: { contains: () => true }, createObjectStore: () => {}, close: () => {},
    transaction: () => { const tx = {}; const st = {
      get: k => { const q = { result: clone(store.get(k)) }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; },
      put: (v, k) => { store.set(k, clone(v)); const q = { result: k }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return q; } };
      tx.objectStore = () => st; return tx; } };
    setTimeout(() => { req.result = db; req.onsuccess && req.onsuccess(); }, 0); return req; } };
  const PT_LIVE = new Map(NODES.map(n => [n, { dead: false, wroteSeq: 0, evSeq: 1, snap: { val: () => clone(truth[n]) } }]));
  const lines = [];
  const ctx = { fetch, indexedDB, PT_URL, ptAuthQuery: async () => '?access_token=' + at, ptPath, PT_SYNC_NODES: new Set(NODES), PT_LIVE,
    PT_LIVE_UP: true, PT_LIVE_UID: 'dry', PT_LIVE_NO: { none: true }, PT_LIVE_SETTLE_MS: 5000,
    ptLiveDb: async () => ({ m: { ref: () => ({}), onValue: (r, cb) => { setTimeout(() => cb({ val: () => 0 }), 0); return () => {}; } }, db: {} }),
    auth: { currentUser: { uid: 'dry' } }, ME: { email: 'dry-run' }, AUDIT: { on: true }, spIsVendor: () => false, auditId: () => 'dry',
    ptAuditWrite: async u => { lines.push(Object.values(u)[0]); return true; }, localStorage: { getItem: () => null }, setTimeout };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { DELTA, deltaShadowRun };')(...Object.values(ctx));
  for (const round of [1, 2]) {
    got = 0;
    const t0 = Date.now();
    await api.deltaShadowRun();
    const L = lines[lines.length - 1];
    console.log(`\n== round ${round}: ${Date.now() - t0} ms, ${(got / 1024).toFixed(1)} KB read by the shadow`);
    if (L.err) console.log('  ERROR', L.err);
    Object.entries(L.nodes || {}).forEach(([n, r]) => console.log('  ' + n.padEnd(18), JSON.stringify(r)));
  }
})().catch(e => { console.error(e); process.exit(1); });
