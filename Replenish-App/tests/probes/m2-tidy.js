/* ROUND THE STORED METRES TO TWO PLACES. Dry run unless --apply; backs up first.
 *
 *   node m2-tidy.js            what would change
 *   node m2-tidy.js --apply    write a backup file, then the rounded values
 *
 * Ravi, 2026-09-24: "ye auto . ke bad only 2 digit me aay." The app now rounds consumption, ruffle
 * metres and piping metres to two places wherever they are written, and shows them so. This brings
 * what is ALREADY stored into line — 373 SKUs and 16 recipes held raw inch conversions such as
 * 1.2953999999999999 — so the figure every calculation uses is the figure the screen shows.
 *
 * Only values that are not already at two places are written. The old values go to a backup file
 * beside this script before anything is written, so every change can be put back exactly.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const HOST = 'price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const FIELDS = ['consumption', 'ruffleMeters', 'pipingMeters'];
const m2 = v => { const n = parseFloat(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; };
const long = v => { const n = parseFloat(v); return isFinite(n) && Math.abs(Math.round(n * 100) / 100 - n) > 1e-9; };

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const call = (method, p, body) => new Promise((res, rej) => {
    const r = https.request({ hostname: HOST, path: '/' + p + '.json', method,
      headers: Object.assign({ Authorization: 'Bearer ' + at }, body ? { 'Content-Type': 'application/json' } : {}) },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ status: x.statusCode, j: JSON.parse(d) }); } catch (e) { res({ status: x.statusCode, j: d }); } }); });
    r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end();
  });
  const mdb = (await call('GET', 'pt_masterDB')).j || {};
  const rec = (await call('GET', 'pt_masters/recipe')).j || {};

  const patch = {}, backup = {};
  let skus = 0, recipes = 0;
  Object.entries(mdb).forEach(([k, r]) => {
    if (!r) return;
    let hit = false;
    FIELDS.forEach(f => { if (long(r[f])) { patch['pt_masterDB/' + k + '/' + f] = m2(r[f]); backup['pt_masterDB/' + k + '/' + f] = r[f]; hit = true; } });
    if (hit) skus++;
  });
  Object.entries(rec).forEach(([k, r]) => {
    if (!r) return;
    let hit = false;
    /* A recipe keeps its figures as text; so does this. */
    FIELDS.forEach(f => { if (long(r[f])) { patch['pt_masters/recipe/' + k + '/' + f] = String(m2(r[f])); backup['pt_masters/recipe/' + k + '/' + f] = r[f]; hit = true; } });
    if (hit) recipes++;
  });

  console.log(skus + ' SKU(s) and ' + recipes + ' recipe(s) — ' + Object.keys(patch).length + ' value(s) to round');
  Object.keys(patch).slice(0, 8).forEach(p => console.log('   ' + p + ':  ' + backup[p] + '  ->  ' + patch[p]));
  if (!Object.keys(patch).length) return console.log('nothing to do');
  if (!APPLY) return console.log('\n(dry run — nothing written. Run with --apply to write.)');

  const file = pathm.join(__dirname, 'm2-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log('\nbackup: ' + file);
  const w = await call('PATCH', '', patch);
  if (w.status !== 200) throw new Error('write refused: HTTP ' + w.status + ' ' + JSON.stringify(w.j).slice(0, 200));
  console.log('written: ' + Object.keys(patch).length + ' value(s).');
})().catch(e => { console.error(e.message); process.exit(1); });
