/* FILL THE BLANKS FROM THE RECIPES — and only the blanks (Ravi, 2026-09-23).
 *
 * The app's "Apply recipes" also OVERWRITES values that disagree; on this catalogue that is 1,400-odd
 * fields, most of them nothing to do with the question asked. This fills a field only where the SKU
 * says nothing at all, and only where the field makes sense on that SKU: no ruffle metres on a SKU
 * that is not ruffled, no chain length on one with no zip.
 *
 * `node recipe-fillblanks.js` shows what it would do; `node recipe-fillblanks.js go` writes it.
 */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const key = r => [norm(r.articleType), norm(r.subtype), norm(r.size)].join('|');
const said = v => v !== undefined && v !== null && String(v).trim() !== '';
const num = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
/* field, kind, and the flag on the SKU that has to be true for the field to mean anything */
const FIELDS = [['fabric', 'txt', null], ['consumption', 'num', null], ['packOf', 'txt', null],
  ['zipQty', 'num', 'isZip'], ['chainLength', 'num', 'isZip'],
  ['ruffleMeters', 'num', 'isRuffle'], ['ruffleFabric', 'txt', 'isRuffle'],
  ['pipingMeters', 'num', 'isPiping'], ['standardFillingQty', 'num', 'fillerFabricRequired']];

(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); else res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });

  const [recs, mdbRaw] = await Promise.all([req('GET', 'pt_masters/recipe'), req('GET', 'pt_masterDB')]);
  const byKey = new Map(Object.values(recs || {}).filter(r => r && r.articleType).map(r => [key(r), r]));
  const patch = {}, per = {}, skus = new Set();
  Object.entries(mdbRaw || {}).forEach(([k, m]) => {
    if (!m) return;
    const r = byKey.get(key(m));
    if (!r) return;
    FIELDS.forEach(([f, kind, needs]) => {
      if (!said(r[f]) || said(m[f])) return;
      if (needs && m[needs] !== true) return;
      const v = kind === 'num' ? num(r[f]) : String(r[f]).trim();
      if (v === null || v === '') return;
      patch[k + '/' + f] = v;
      per[f] = (per[f] || 0) + 1;
      skus.add(m.sku);
    });
  });
  console.log('fields to fill', Object.keys(patch).length, 'on', skus.size, 'SKU(s):', JSON.stringify(per));
  const flap = Object.values(mdbRaw || {}).filter(m => m && norm(m.subtype) === 'piping flap pillow cover');
  console.log('Piping Flap Pillow Cover — with no fabric now:', flap.filter(m => !said(m.fabric)).length, 'of', flap.length);
  if (process.argv[2] !== 'go') return;
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 400) {
    const slice = {}; keys.slice(i, i + 400).forEach(k => { slice[k] = patch[k]; });
    await req('PATCH', 'pt_masterDB', slice);
  }
  const after = await req('GET', 'pt_masterDB');
  const f2 = Object.values(after || {}).filter(m => m && norm(m.subtype) === 'piping flap pillow cover');
  console.log('written. Piping Flap with no fabric now:', f2.filter(m => !said(m.fabric)).length, 'of', f2.length);
})().catch(e => { console.error(e.message || e); process.exit(1); });
