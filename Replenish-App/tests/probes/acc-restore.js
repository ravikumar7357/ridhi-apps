/* PUT THE ZIPPERS BACK ON THE ACCESSORIES LIST. Dry run unless --apply.
 *
 *   node acc-restore.js            what would be written
 *   node acc-restore.js --apply    write it
 *
 * Ravi, 2026-09-24: "accessories me zip padi h but ye auto minus nahi ho rhi h." On 22 Sep the list
 * (pt_masters/accessories) was saved whole from a browser holding an empty copy, and seven items became
 * one — "THREAD CUT". Their stock and 119 movements are still in pt_accLedger; only the list lost them,
 * and the deduction looks a zipper up on the list. (The save is now a read-merge; this puts back what
 * the old save lost.)
 *
 * WHAT IS PUT BACK: every code the ledger has movements for and the list lacks. The four zippers in the
 * 19 Sep copy (tests/mix/pt_masters.json) come back exactly as they were, names included; 24 and 40
 * were added after that copy, so they get the same shape and the same kind of name. Numeric codes are
 * Zippers — the rule the accessories upload already uses — so they count as used up, not lent.
 * Anything else comes back as "Other", the kind it showed as before; Ravi can change it on screen.
 *
 * NOTHING ON THE LIST NOW IS CHANGED OR REMOVED. The current list is read, and only appended to.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const HOST = 'price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const up = v => String(v == null ? '' : v).trim().toUpperCase();
const list = v => !v ? [] : (Array.isArray(v) ? v : Object.values(v)).filter(Boolean);

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const call = (method, p, body) => new Promise((res, rej) => {
    const r = https.request({ hostname: HOST, path: '/' + p + '.json', method,
      headers: Object.assign({ Authorization: 'Bearer ' + at }, body ? { 'Content-Type': 'application/json' } : {}) },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ status: x.statusCode, j: JSON.parse(d) }); } catch (e) { res({ status: x.statusCode, j: d }); } }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });

  const now = list((await call('GET', 'pt_masters/accessories')).j);
  const ledger = list((await call('GET', 'pt_accLedger')).j);
  const old = list((JSON.parse(fs.readFileSync(pathm.join(__dirname, '..', 'mix', 'pt_masters.json'), 'utf8')) || {}).accessories);
  const oldBy = new Map(old.map(x => [up(x.code), x]));
  const onList = new Set(now.map(x => up(x.code)));

  /* The codes the ledger knows, in the spelling it first used. */
  const codes = new Map();
  ledger.forEach(r => { const c = up(r.itemCode); if (c && !codes.has(c)) codes.set(c, String(r.itemCode).trim()); });

  const add = [];
  [...codes.entries()].sort().forEach(([k, spelled]) => {
    if (onList.has(k)) return;
    const was = oldBy.get(k);
    const zip = /^\d+$/.test(k);
    const rec = was ? Object.assign({}, was) : { code: spelled, name: zip ? 'Zipper ' + k + ' inch' : '', unit: 'pcs', reorderLevel: '' };
    if (zip) rec.category = 'Zipper';
    rec.restoredAt = new Date().toISOString();
    rec.restoredWhy = 'dropped from the list by a whole-list save on 22 Sep 2026; movements were intact';
    add.push({ rec, from: was ? '19 Sep copy' : 'rebuilt' });
  });

  console.log('on the list now: ' + now.map(x => JSON.stringify(x.code)).join(', '));
  console.log('to put back (' + add.length + '):');
  add.forEach(a => console.log('   ' + JSON.stringify(a.rec.code).padEnd(12) + (a.rec.category || 'Other').padEnd(8) + JSON.stringify(a.rec.name || '').padEnd(20) + a.from));
  if (!add.length) return console.log('nothing to do');
  if (!APPLY) return console.log('\n(dry run — nothing written. Run with --apply to write.)');

  const next = now.concat(add.map(a => a.rec));
  const w = await call('PUT', 'pt_masters/accessories', next);
  if (w.status !== 200) throw new Error('write refused: HTTP ' + w.status + ' ' + JSON.stringify(w.j).slice(0, 200));
  const back = list((await call('GET', 'pt_masters/accessories')).j);
  console.log('\nwritten. The list now holds ' + back.length + ': ' + back.map(x => JSON.stringify(x.code)).join(', '));
})().catch(e => { console.error(e.message); process.exit(1); });
