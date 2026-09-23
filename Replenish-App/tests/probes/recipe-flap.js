/* PIPING FLAP PILLOW COVER HAS NO RECIPES (2026-09-23).
 *
 * The master clean-up renamed Ridhi's RPC subtype from "Piping Pillow Cover" to "Piping Flap Pillow
 * Cover" — the name Ravi's own reference uses. Recipes are keyed on article|subtype|size, so every one
 * of those SKUs lost the recipe behind it, and a short-template import filled nothing in.
 *
 * This copies the nine "Piping Pillow Cover" recipes to the new name, and says what applying the
 * recipes would then do. `node recipe-flap.js` shows; `node recipe-flap.js go` writes the copies.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const FROM = 'Piping Pillow Cover', TO = 'Piping Flap Pillow Cover';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const key = r => [norm(r.articleType), norm(r.subtype), norm(r.size)].join('|');
const path = k => k.replace(/[.#$/[\]]/g, '_');
const said = v => v !== undefined && v !== null && String(v).trim() !== '';

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });

  const [recs, mdbRaw] = await Promise.all([req('GET', 'pt_masters/recipe'), req('GET', 'pt_masterDB')]);
  const list = Object.entries(recs || {}).map(([k, v]) => Object.assign({ _path: k }, v)).filter(r => r && r.articleType);
  const mdb = Object.values(mdbRaw || {}).filter(Boolean);
  const have = new Set(list.map(key));

  const copies = {};
  list.filter(r => norm(r.subtype) === norm(FROM)).forEach(r => {
    const next = Object.assign({}, r, { subtype: TO, copiedFrom: FROM, copiedAt: new Date().toISOString() });
    delete next._path;
    const k = key(next);
    if (have.has(k)) { console.log('already there:', k); return; }
    copies[path(k)] = next;
  });
  console.log(`copying ${Object.keys(copies).length} recipe(s) "${FROM}" → "${TO}"`);
  Object.values(copies).forEach(r => console.log('  ', r.size, '·', r.fabric || '(no fabric)', '·', r.consumption || '-', '· zip', r.isZip || '-', r.chainLength || ''));

  /* what the SKUs would then take */
  const after = list.concat(Object.values(copies));
  const byKey = new Map(after.map(r => [key(r), r]));
  const FIELDS = [['fabric', 'txt'], ['consumption', 'num'], ['packOf', 'txt'], ['cuttingRequired', 'yn'], ['isZip', 'yn'], ['zipQty', 'num'],
    ['chainLength', 'num'], ['isRuffle', 'yn'], ['ruffleMeters', 'num'], ['ruffleFabric', 'txt'], ['isPiping', 'yn'], ['pipingMeters', 'num'],
    ['fillerFabricRequired', 'yn'], ['standardFillingQty', 'num']];
  const count = (map) => {
    const fill = {}, change = {};
    mdb.forEach(m => {
      const r = map.get(key(m));
      if (!r) return;
      FIELDS.forEach(([f, kind]) => {
        if (!said(r[f])) return;
        if (kind === 'yn') {
          const want = norm(r[f]) === 'yes';
          if ((m[f] === true) !== want) change[f] = (change[f] || 0) + 1;
          return;
        }
        if (!said(m[f])) { fill[f] = (fill[f] || 0) + 1; return; }
        if (String(m[f]).trim() !== String(r[f]).trim()) change[f] = (change[f] || 0) + 1;
      });
    });
    return { fill, change };
  };
  const before = count(new Map(list.map(r => [key(r), r])));
  const now = count(byKey);
  const tot = o => Object.values(o).reduce((a, b) => a + b, 0);
  console.log('\nApply recipes — blanks filled, before:', tot(before.fill), 'after the copies:', tot(now.fill), JSON.stringify(now.fill));
  console.log('Apply recipes — values it would CHANGE (not blanks), before:', tot(before.change), 'after:', tot(now.change), JSON.stringify(now.change));
  const flap = mdb.filter(m => norm(m.subtype) === norm(TO));
  console.log('\nSKUs called', TO + ':', flap.length, '· of them with no fabric:', flap.filter(m => !said(m.fabric)).length);
  if (process.argv[2] !== 'go') return;
  await req('PATCH', 'pt_masters/recipe', copies);
  const back = await req('GET', 'pt_masters/recipe');
  console.log('\nwritten. recipes now:', Object.keys(back || {}).length);
})().catch(e => { console.error(e.message || e); process.exit(1); });
