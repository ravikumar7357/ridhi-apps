/* UNDO MY WRONG FILL, AND SET THE FLAP RECIPES TO WHAT THE SKUs SAY (2026-09-23).
 *
 * I copied the "Piping Pillow Cover" recipes (Sheeting 82) onto "Piping Flap Pillow Cover", which is
 * canvas. Twenty-five SKUs then took a Sheeting consumption into a blank field, and four took the
 * fabric. This lists exactly those, sets each one to what its own size's SKUs agree on, and rewrites
 * the recipes as canvas — with no zip, because not one Flap SKU has one.
 *
 * `node flap-undo.js` shows; `node flap-undo.js go` writes.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const SUB = 'piping flap pillow cover';
/* what the Sheeting recipe wrongly put in, per size */
const WRONG = { '16x16': 0.23, '18x18': 0.26, '20x20': 0.37, '24x24': 0.45, '12x20': 0.19, '14x36': 0.39, '20x54': 0.95 };
/* what that size's own SKUs agree on */
const RIGHT = { '16x16': 0.48, '18x18': 0.53, '20x20': 1.15, '24x24': 1.6, '12x20': 0.72, '14x36': 0.85, '20x54': 1.5 };
const PACK = { '16x16': '2', '18x18': '2', '20x20': '2', '24x24': '2', '12x20': '1', '14x36': '1', '20x54': '1' };
const path = k => k.replace(/[.#$/[\]]/g, '_');

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });

  const [mdbRaw, recs] = await Promise.all([req('GET', 'pt_masterDB'), req('GET', 'pt_masters/recipe')]);
  const patch = {}, rows = [];
  Object.entries(mdbRaw || {}).forEach(([k, m]) => {
    if (!m || norm(m.subtype) !== SUB) return;
    const sz = norm(m.size), cons = parseFloat(m.consumption);
    const wrongCons = WRONG[sz] !== undefined && Math.abs(cons - WRONG[sz]) < 1e-9;
    const wrongFab = norm(m.fabric) === 'sheeting 82';
    if (!wrongCons && !wrongFab) return;
    const set = {};
    if (wrongCons && RIGHT[sz] !== undefined) set.consumption = RIGHT[sz];
    /* THE FABRIC IS LEFT ALONE unless this script put it there. Sheeting 82 on a Flap SKU that predates
     * my copy is somebody else‘s entry, and silently rewriting it would be a second wrong. */
    if (wrongFab && /^RPC0009-/.test(String(m.sku || ''))) set.fabric = 'Canvas';
    Object.entries(set).forEach(([f, v]) => { patch[k + '/' + f] = v; });
    rows.push([m.sku, m.size, (wrongFab ? 'Sheeting 82 → Canvas' : ''), (wrongCons ? cons + ' → ' + RIGHT[sz] : '')].filter(Boolean).join('  ·  '));
  });
  console.log('SKUs to correct:', rows.length, '· fields:', Object.keys(patch).length);
  rows.slice(0, 40).forEach(r => console.log('  ', r));

  /* the recipes themselves: canvas, the size's own consumption, no zip */
  const recPatch = {};
  Object.entries(recs || {}).forEach(([k, r]) => {
    if (!r || norm(r.subtype) !== SUB) return;
    const sz = norm(r.size);
    if (RIGHT[sz] === undefined) { recPatch[k] = null; console.log('  recipe dropped (no SKU of that size to learn from):', r.size); return; }
    const next = Object.assign({}, r, { fabric: 'Canvas', consumption: String(RIGHT[sz]), packOf: PACK[sz], isZip: 'no', copiedFrom: '' });
    delete next.chainLength; delete next.zipQty; delete next.copiedFrom;
    /* Honest about who wrote it: this script, correcting its own earlier copy. */
    next.editedBy = 'claude · flap-undo.js'; next.editedAt = new Date().toISOString();
    recPatch[k] = next;
  });
  console.log('\nrecipes to rewrite as canvas:', Object.values(recPatch).filter(Boolean).length, '· to drop:', Object.values(recPatch).filter(v => !v).length);
  Object.values(recPatch).filter(Boolean).forEach(r => console.log('  ', r.size, '· Canvas ·', r.consumption, '· pack', r.packOf, '· zip no'));
  if (process.argv[2] !== 'go') return;
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 400) {
    const slice = {}; keys.slice(i, i + 400).forEach(k => { slice[k] = patch[k]; });
    await req('PATCH', 'pt_masterDB', slice);
  }
  await req('PATCH', 'pt_masters/recipe', recPatch);
  console.log('\nwritten.');
})().catch(e => { console.error(e.message); process.exit(1); });
