const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- the sheet ---- */
  ['the sheet has a column for every recipe field',
   "  .concat(RECIPE_FIELDS.map(f => f[1]))" + NL + "  .concat(RECIPE_FIELDS.map(f => 'SKUs say: ' + f[1]));",
   "  .concat(RECIPE_FIELDS.map(f => 'SKUs say: ' + f[1]));"],

  ['…and a read-only twin saying what the SKUs say',
   "  .concat(RECIPE_FIELDS.map(f => 'SKUs say: ' + f[1]));",
   '  ;'],

  ['…and the SKU count on the row',
   "    rows.push([c.articleType, c.subtype, c.size, c.n]",
   "    rows.push([c.articleType, c.subtype, c.size, 0]"],

  /* THE TWIN MUST NEVER BE MISTAKEN FOR THE FIELD. indexOf finds "SKUs say: Consumption (m)"
   * for a loose match and the upload would read the wrong column. */
  /* A loose match reads "SKUs say: Consumption (m)" as the field itself and writes that sentence
   * into a recipe as a quantity. */
  ['reading a sheet takes the field, not its read-only twin',
   '    const i = head.findIndex(h => h === label.toLowerCase());',
   "    const i = head.findIndex(h => h.indexOf(label.toLowerCase()) >= 0);"],

  /* A BLANK CELL SAYS NOTHING — reading it as an instruction would wipe untouched recipes. */
  ['a blank cell is left alone',
   "    Object.keys(at).forEach(f => { const v = cell(at[f]); if (v !== '') e.vals[f] = v; });",
   '    Object.keys(at).forEach(f => { e.vals[f] = cell(at[f]); });'],

  ['…and a file without the key columns is refused',
   "    return { err: 'The file needs Article, Subtype and Size columns. Download the recipe template to see them.' };",
   '    return { err: 0 };'],

  ['…and one with no recipe columns at all',
   "    return { err: 'The file has none of the recipe columns. Download the recipe template to see them.' };",
   '    return { err: 0 };'],

  /* ---- what an upload would do ---- */
  ['a combination no SKU uses is refused',
   "      skip.push({ row: e.row, key, why: 'no SKU in the catalogue has that article, subtype and size.' });" + NL + '      return;',
   '      return;'],

  ['setting a field and changing one are counted apart',
   '      (recSaid(had) ? change : set).push({ row: e.row, key, field: f, label: spec[1],',
   '      (false ? change : set).push({ row: e.row, key, field: f, label: spec[1],'],

  ['…and a field that already says exactly that is left alone',
   '      if (recSaid(had) && String(had).trim() === want) return;      // already says exactly that',
   ''],

  /* THE null >= 0 TRAP. mdbNum answers null for anything that is not a number, and null >= 0 is
   * true — so "lots" would have been written as a quantity. */
  ['a number that is not a number is refused',
   "      } else if (spec[2] === 'num' && !Number.isFinite(mdbNum(raw))) {",
   "      } else if (spec[2] === 'num' && !(mdbNum(raw) >= 0)) {"],

  ['…and a yes/no that is neither',
   "        if (k !== 'yes' && k !== 'no') {",
   '        if (false) {'],

  /* ---- writing ---- */
  ['the upload asks for the master-database right',
   '  if (!mdbCanEdit()) return MDB_NO_EDIT;' + NL + '  const all = plan.set.concat(plan.change);',
   '  if (false) return MDB_NO_EDIT;' + NL + '  const all = plan.set.concat(plan.change);'],

  ['…and writes in one go',
   '  try { await ptPatch(patch); }' + NL + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  const masters = Object.assign({}, PTG.masters || {});' + NL
     + '  masters.recipe = Object.assign({}, masters.recipe || {}, keep);' + NL
     + '  PTG.masters = masters;' + NL + '  RECIPE_IX = { src: null, map: null };' + NL + "  return '';" + NL + '}' + NL + NL
     + '/** The recipe sheet as .xlsx',
   '  try { for (const p of Object.keys(patch)) await ptPut(p, patch[p]); }' + NL
     + "  catch (e) { return 'Not saved: ' + (e.message || e); }" + NL
     + '  const masters = Object.assign({}, PTG.masters || {});' + NL
     + '  masters.recipe = Object.assign({}, masters.recipe || {}, keep);' + NL
     + '  PTG.masters = masters;' + NL + '  RECIPE_IX = { src: null, map: null };' + NL + "  return '';" + NL + '}' + NL + NL
     + '/** The recipe sheet as .xlsx'],

  /* ---- the toolbar ---- */
  ['a control not listed for a view is hidden on it',
   '    const show = on.indexOf(id) >= 0 && !(PMDB_WRITES.indexOf(id) >= 0 && !mdbCanEdit());',
   '    const show = true;'],

  ['…and one that writes is hidden from somebody who may not',
   '    const show = on.indexOf(id) >= 0 && !(PMDB_WRITES.indexOf(id) >= 0 && !mdbCanEdit());',
   '    const show = on.indexOf(id) >= 0;'],

  ['…and the recipe view keeps article, subtype and size',
   "  recipe: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmRecSeed', 'ptmRecApply',",
   "  recipe: ['ptmQ', 'ptmRecSeed', 'ptmRecApply',"],

  ['…and drops the boxes that mean nothing to it',
   "  recipe: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmRecSeed', 'ptmRecApply',",
   "  recipe: ['ptmBrand', 'ptmCol', 'ptmCut', 'ptmNew', 'ptmImgs', 'ptmRename', 'ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmRecSeed', 'ptmRecApply',"],

  ['…and Template says which one it is',
   "  if ($('ptmTemplate')) $('ptmTemplate').textContent = rec ? 'Recipe template' : 'Template';",
   "  if ($('ptmTemplate')) $('ptmTemplate').textContent = 'Template';"],

  ['…and Import too',
   "  if ($('ptmImport')) $('ptmImport').textContent = rec ? 'Upload recipes' : 'Import';",
   "  if ($('ptmImport')) $('ptmImport').textContent = 'Import';"],

  ['the fabric view keeps the two filters only it has',
   "  fabric: ['ptmBrandFs', 'ptmDir', 'ptmCol', 'ptmQ', 'ptmClear', 'ptmExport', 'ptmGo'],",
   "  fabric: ['ptmCol', 'ptmQ', 'ptmClear', 'ptmExport', 'ptmGo'],"],

  ['the worked-out view keeps Apply consumption',
   "  cons: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ'," + NL
     + "    'ptmConsApply', 'ptmClear', 'ptmExport', 'ptmGo'],",
   "  cons: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ'," + NL
     + "    'ptmClear', 'ptmExport', 'ptmGo'],"],

  /* ---- the recipe view's own filters ---- */
  ['the recipe view filters by article',
   '  const combos = all.filter(c => (!fA || ptCi(c.articleType, fA))',
   '  const combos = all.filter(c => (true)'],
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
