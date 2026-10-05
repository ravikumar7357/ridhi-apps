/* 5 Oct 2026, Ravi: "3 aur 4 theek karo".
 *  - REOPEN: SHP lines closed as "marked done" (a DONE/READY note) that Shopify still has to ship.
 *  - CLOSE:  open SHP lines Shopify has already fulfilled or cancelled — what the app's own maintenance does.
 * Reads Shopify's word from truth.json (shp-truth.js), re-reads pt_orderBook live. Dry run unless WRITE=1.
 * Saves an undo file (path → value before) and a pt_audit line.   node probes/shp-fix-1005.js <truth.json> */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const call = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, timeout: 300000 },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) return rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const T = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const U = s => String(s || '').trim().toUpperCase();
  const reopen = new Map(T.filter(l => l.shopDoneWhy === 'marked done' && !l.handedAt && l.truth === 'to ship').map(l => [l.orderNo + '|' + l.sku, l]));
  const close = new Map(T.filter(l => l.open && (l.truth === 'fulfilled' || l.truth === 'cancelled')).map(l => [l.orderNo + '|' + l.sku, l]));
  const ob = await call('GET', 'pt_orderBook') || {};
  const now = new Date().toISOString(), who = 'ravi@thefabricrush.com (fixed by Claude)';
  const patch = {}, undo = {}, rows = [];
  const set = (path, v, was) => { patch[path] = v; undo[path] = was === undefined ? null : was; };
  Object.entries(ob).forEach(([id, r]) => {
    if (!r) return;
    const k = U(r.orderNo) + '|' + U(r.sku);
    if (reopen.has(k) && r.shopDoneWhy === 'marked done') {
      const b = 'pt_orderBook/' + id + '/';
      set(b + 'shopDoneAt', null, r.shopDoneAt); set(b + 'shopDoneWhy', null, r.shopDoneWhy);
      set(b + 'reopenedAt', now, r.reopenedAt); set(b + 'reopenedBy', who, r.reopenedBy);
      set(b + 'reopenedWhy', 'closed by a DONE/READY note (' + String(r.shopDoneAt || '').slice(0, 10) + ') but Shopify still has to ship it', r.reopenedWhy);
      rows.push(['REOPEN', r.orderNo, r.shopOrderNo || '', r.sku, r.qty, String(r.shopDoneAt || '').slice(0, 10)]);
    }
    if (close.has(k) && !r.shopDoneAt) {
      const why = close.get(k).truth;
      const b = 'pt_orderBook/' + id + '/';
      set(b + 'shopDoneAt', now, r.shopDoneAt); set(b + 'shopDoneWhy', why, r.shopDoneWhy);
      rows.push(['CLOSE ' + why, r.orderNo, r.shopOrderNo || '', r.sku, r.qty, '']);
    }
  });
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  rows.forEach(r => console.log(r.join('  ')));
  console.log('\nlines: reopen ' + reopen.size + ' · close ' + close.size + ' → rows touched ' + rows.length + ' · paths ' + Object.keys(patch).length);
  if (process.env.WRITE !== '1') { console.log('dry run — nothing written'); return; }
  const stamp = now.replace(/[:.]/g, '-');
  const undoFile = pathm.join(__dirname, 'shp-fix-undo-' + stamp + '.json');
  fs.writeFileSync(undoFile, JSON.stringify(undo, null, 1));
  await call('PATCH', '', patch);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const keys = Object.keys(patch);
  await call('PATCH', '', { ['pt_audit/' + now.slice(0, 7) + '/' + id]: { at: now, by: who, tab: 'fix', kind: 'patch', n: keys.length, paths: keys.slice(0, 50), note: 'Reopened note-closed lines Shopify still has to ship; closed open lines Shopify fulfilled/cancelled. Undo: ' + pathm.basename(undoFile) } });
  console.log('WRITTEN · undo file ' + undoFile);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
