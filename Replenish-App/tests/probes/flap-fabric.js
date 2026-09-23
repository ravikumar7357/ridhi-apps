/* WHAT DO THE PIPING FLAP SKUs ACTUALLY SAY? (Ravi, 2026-09-23: "piping flap pillow cover me canvas
 * fabric use hota h" — the recipes I copied from Piping Pillow Cover say Sheeting 82, which is wrong.)
 * Shows each size: which fabric and consumption its SKUs carry, and what the recipe says now. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const norm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*[x×]\s*/g, 'x');
const said = v => v !== undefined && v !== null && String(v).trim() !== '';
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const get = p => new Promise((res, rej) => https.get(DB + '/' + p + '.json', { headers: { Authorization: 'Bearer ' + at } },
    r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const [mdbRaw, recs] = await Promise.all([get('pt_masterDB'), get('pt_masters/recipe')]);
  const mdb = Object.values(mdbRaw || {}).filter(Boolean);
  const sub = process.argv[2] || 'piping flap pillow cover';
  const mine = mdb.filter(m => norm(m.subtype) === sub);
  const by = {};
  mine.forEach(m => {
    const k = norm(m.size);
    const e = by[k] || (by[k] = { n: 0, fab: {}, cons: {}, zip: 0, pack: {} });
    e.n++;
    e.fab[String(m.fabric || '(blank)')] = (e.fab[String(m.fabric || '(blank)')] || 0) + 1;
    e.cons[String(m.consumption == null ? '(blank)' : m.consumption)] = (e.cons[String(m.consumption == null ? '(blank)' : m.consumption)] || 0) + 1;
    if (m.isZip === true) e.zip++;
    e.pack[String(m.packOf || '(blank)')] = (e.pack[String(m.packOf || '(blank)')] || 0) + 1;
  });
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + '×' + n).join(', ');
  console.log('SKUs with subtype "' + sub + '":', mine.length);
  Object.keys(by).sort().forEach(k => console.log('  ', k.padEnd(8), 'n=' + String(by[k].n).padEnd(4), 'fabric:', top(by[k].fab), '| consumption:', top(by[k].cons), '| zip yes:', by[k].zip, '| pack:', top(by[k].pack)));
  console.log('\nrecipes for that subtype now:');
  Object.values(recs || {}).filter(r => r && norm(r.subtype) === sub).sort((a, b) => norm(a.size).localeCompare(norm(b.size)))
    .forEach(r => console.log('  ', String(r.size).padEnd(8), 'fabric', r.fabric || '-', '| consumption', r.consumption || '-', '| zip', r.isZip || '-', r.chainLength || '', '| pack', r.packOf || '-', r.copiedFrom ? '(copied from ' + r.copiedFrom + ')' : ''));
})().catch(e => { console.error(e.message); process.exit(1); });
