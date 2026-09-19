const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- the key ---- */
  ['the key is article, subtype and size',
   "const recKey = m => [recNorm(m && m.articleType), recNorm(m && m.subtype), recNorm(m && m.size)].join('|');",
   "const recKey = m => [recNorm(m && m.articleType), recNorm(m && m.subtype)].join('|');"],

  ['…and colour is not part of it',
   "const recKey = m => [recNorm(m && m.articleType), recNorm(m && m.subtype), recNorm(m && m.size)].join('|');",
   "const recKey = m => [recNorm(m && m.articleType), recNorm(m && m.subtype), recNorm(m && m.size), recNorm(m && m.color)].join('|');"],

  ['…and spacing and case do not split a combination in two',
   "const recNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\\s+/g, ' ');",
   "const recNorm = v => String(v == null ? '' : v);"],

  /* ---- what the SKUs say ---- */
  ['a disagreement is reported as one',
   '  return { values, said, blank, agreed: values.length === 1 ? values[0].value : null,' + NL
     + '    conflict: values.length > 1 };',
   '  return { values, said, blank, agreed: values.length ? values[0].value : null,' + NL
     + '    conflict: false };'],

  ['…and the counts travel with it',
   '  const values = [...by].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);',
   '  const values = [...by].map(([value]) => ({ value, n: 0 })).sort((a, b) => b.n - a.n);'],

  ['…and a yes/no on a SKU is never counted as blank',
   "    if (RECIPE_YN.indexOf(field) >= 0) { said++; const k = v === true ? 'yes' : 'no'; by.set(k, (by.get(k) || 0) + 1); return; }",
   '    if (false) { return; }'],

  /* ---- the seed ---- */
  /* The tempting wrong move: let the majority win. Forty-two against one looks obvious and is
   * still Ravi's call — the one that says 1.7 may be the right one. */
  ['a seed is only proposed where every SKU agrees, not by majority',
   '      if (s.conflict) { skipped.push({ key: c.key, field: f, values: s.values, n: c.n }); return; }',
   '      if (s.conflict) { rec[f] = String(s.values[0].value); filled++; return; }'],

  ['…and the disagreements are handed back by name',
   '      if (s.conflict) { skipped.push({ key: c.key, field: f, values: s.values, n: c.n }); return; }',
   '      if (s.conflict) { return; }'],

  ['…and a recipe already set is never overwritten',
   '      if (recSaid(rec[f])) return;                        // the recipe has already been told',
   '      if (false) return;'],

  ['…and the seed is written in one go',
   '  try { await ptPatch(patch); }' + NL + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  const masters = Object.assign({}, PTG.masters || {});' + NL + '  masters.recipe = Object.assign({}, masters.recipe || {}, keep);',
   '  try { for (const p of Object.keys(patch)) await ptPut(p, patch[p]); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  const masters = Object.assign({}, PTG.masters || {});' + NL + '  masters.recipe = Object.assign({}, masters.recipe || {}, keep);'],

  /* ---- what a new SKU inherits ---- */
  ['a blank field is filled from the recipe',
   '    if (recSaid(out[f])) return;                  // the row said something; leave it alone' + NL
     + "    out[f] = kind === 'num' ? mdbNum(r[f]) : String(r[f]).trim();" + NL + '    from.push(f);',
   '    if (recSaid(out[f])) return;                  // the row said something; leave it alone'],

  ['…and what the row already said is kept',
   '    if (recSaid(out[f])) return;                  // the row said something; leave it alone',
   '    if (false) return;'],

  ['…and a yes/no is taken from the recipe outright',
   "    if (kind === 'yn') {" + NL + '      const want = recNorm(r[f]) === \'yes\';' + NL
     + '      if (out[f] !== want) { out[f] = want; from.push(f); }' + NL + '      return;' + NL + '    }',
   "    if (kind === 'yn') return;"],

  ['…and a zip turned off carries no size',
   '  if (out.isZip !== true) { out.chainLength = null; out.zipQty = null; }',
   '  if (false) { out.chainLength = null; out.zipQty = null; }'],

  ['…and which fields came from the recipe is reported',
   '      if (out[f] !== want) { out[f] = want; from.push(f); }',
   '      if (out[f] !== want) { out[f] = want; }'],

  /* ---- reading ---- */
  ['a SKU that has said something is not overridden by its recipe',
   '  if (recSaid(m && m[field])) return m[field];',
   '  if (false) return m[field];'],

  /* ---- applying ---- */
  ['a blank filled and a value contradicted are counted apart',
   "      if (!recSaid(had)) { fill.push({ sku: m.sku, field: f, label, from: '', to: want }); return; }",
   '      if (!recSaid(had)) { change.push({ sku: m.sku, field: f, label, from: \'\', to: want }); return; }'],

  ['…and a SKU that already matches is left alone',
   '      if (String(had).trim() === String(want).trim()) return;',
   '      if (false) return;'],

  ['…and only what was on the list is written',
   '    Object.keys(ch).forEach(f => { patch[\'pt_masterDB/\' + key + \'/\' + f] = row[f]; });',
   "    Object.keys(row).forEach(f => { if (f !== '_key') patch['pt_masterDB/' + key + '/' + f] = row[f]; });"],

  /* ---- who may ---- */
  ['saving a recipe asks for the master-database right',
   '  if (!mdbCanEdit()) return MDB_NO_EDIT;' + NL + '  const k = recKey(rec);',
   '  if (false) return MDB_NO_EDIT;' + NL + '  const k = recKey(rec);'],

  ['…and so does seeding',
   '  if (!mdbCanEdit()) return MDB_NO_EDIT;' + NL + "  if (!rows.length) return 'There is nothing to seed.';",
   "  if (false) return MDB_NO_EDIT;" + NL + "  if (!rows.length) return 'There is nothing to seed.';"],

  ['…and applying',
   '  if (!mdbCanEdit()) return MDB_NO_EDIT;' + NL + '  const bySku = new Map();',
   '  if (false) return MDB_NO_EDIT;' + NL + '  const bySku = new Map();'],

  /* ---- the screen ---- */
  ['the screen shows what the SKUs say under each field',
   "        + `<div style=\"font-size:10.5px\">${recSaysCell(c.says[f])}</div></td>`).join('')",
   "        + '</td>').join('')"],

  ['…and marks the disagreement',
   '  return s.conflict ? `<span style="color:var(--bad);font-weight:600">${txt}</span>` : `<span class="muted">${txt}</span>`;',
   '  return `<span class="muted">${txt}</span>`;'],

  ['…and counts them on the strip',
   "      <div class=\"metric\"><div class=\"v\"${clash ? ' style=\"color:var(--bad)\"' : ''}>${nf(clash)}</div><div class=\"l\">Where the SKUs disagree</div></div>",
   "      <div class=\"metric\"><div class=\"v\">${nf(clash)}</div><div class=\"l\">x</div></div>"],

  ['…and the buttons are only on this view',
   "    ['ptmRecSeed', 'ptmRecApply'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !mdbCanEdit()); });",
   "    ['ptmRecSeed', 'ptmRecApply'].forEach(id => { if ($(id)) $(id).classList.add('hide'); });"],

  ['…and taken away on the others',
   "  ['ptmRecSeed', 'ptmRecApply'].forEach(id => { if ($(id)) $(id).classList.add('hide'); });" + NL,
   ''],
];

const BASE = 1;
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
