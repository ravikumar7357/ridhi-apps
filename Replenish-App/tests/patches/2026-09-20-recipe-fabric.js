/* FABRIC IS A RECIPE FIELD.
 *
 * I said last time it could not be, because the cloth changes with the colour and a recipe is keyed
 * by article + subtype + size. The first half is true - 46 of 321 combinations use two different
 * fabrics across their colours - but the conclusion was too careful. The recipe machinery was built
 * for exactly this:
 *
 *   · recipeValue makes a recipe a DEFAULT, never an override. A SKU that names its own cloth keeps
 *     it, whatever forty-two siblings say.
 *   · recipeFill only fills a blank, and only on a SKU being CREATED. Type the fabric on the New SKU
 *     form and yours stands.
 *   · recipeSeedPlan fills only where every SKU that has spoken agrees. The 46 that disagree are
 *     SKIPPED and listed for Ravi - they do not get a wrong answer, they get a question.
 *   · Apply recipes shows every change before it writes one.
 *
 * So the 212 combinations that use one cloth throughout stop being retyped for every new colour,
 * which is the whole point of the recipe, and the 46 that do not are named instead of guessed at.
 *
 * A NEW KIND, 'fab': text, but picked from the Fabric Type master. The SKU form became a picker
 * yesterday so a typo could not invent a fabric; a free-text recipe column would have opened that
 * door again from the other side, and written the invention onto every SKU under it. The sheet
 * carries a dropdown and the importer refuses a spelling the master does not have.
 *
 * ruffleFabric is the same kind for the same reason - it is written straight onto the fabric ledger.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the field itself ---- */
one(`const RECIPE_FIELDS = [
  ['consumption', 'Consumption (m)', 'num'],`,
`const RECIPE_FIELDS = [
  /* FIRST, because it is the first thing anybody asks about a product. 'fab' is text picked from the
   * Fabric Type master rather than typed: see RECIPE_FAB below. */
  ['fabric', 'Fabric', 'fab'],
  ['consumption', 'Consumption (m)', 'num'],`, 'Fabric joins the recipe');

one(`  ['ruffleFabric', 'Ruffle fabric', 'txt'],`,
`  ['ruffleFabric', 'Ruffle fabric', 'fab'],`, 'and the ruffle cloth is picked too');

one(`const RECIPE_YN = RECIPE_FIELDS.filter(f => f[2] === 'yn').map(f => f[0]);`,
`const RECIPE_YN = RECIPE_FIELDS.filter(f => f[2] === 'yn').map(f => f[0]);
/* THE CLOTH FIELDS. Stored as text like any other, but only ever a spelling the Fabric Type master
 * already has — anywhere one can be typed, it is checked against that list first. */
const RECIPE_FAB = RECIPE_FIELDS.filter(f => f[2] === 'fab').map(f => f[0]);`, 'the list of cloth fields');

/* ---- 2. the importer refuses a fabric the master does not have ---- */
one(`      } else if (spec[2] === 'num' && !Number.isFinite(mdbNum(raw))) {`,
`      } else if (spec[2] === 'fab') {
        /* A SPELLING THE MASTER DOES NOT HAVE IS A FABRIC NOBODY AGREED TO — and from here it would
         * be written onto every SKU under this combination. The row is refused with the reason. */
        const hit = cutFabrics().find(x => recNorm(x) === recNorm(raw));
        if (!hit) {
          skip.push({ row: e.row, key, why: \`"\${raw}" is not in the Fabric Type master. Add it there first, or fix the spelling.\` });
          return;
        }
        e.vals[f] = hit;                       // the master's own spelling, not the sheet's
      } else if (spec[2] === 'num' && !Number.isFinite(mdbNum(raw))) {`, 'a fabric the master does not have is refused');

/* `want` is read from e.vals so the corrected spelling is what gets written. */
one(`      const want = spec[2] === 'yn' ? recNorm(raw) : String(raw).trim();`,
`      const want = spec[2] === 'yn' ? recNorm(raw) : String(e.vals[f]).trim();`, 'and the master spelling is what is written');

/* ---- 3. the edit dialog picks it ---- */
one(`      return kind === 'yn'
        ? { key: f, label: label + '  [' + said + ']', type: 'select', value: recSaid(r[f]) ? recNorm(r[f]) : '',
            options: ['', 'yes', 'no'] }
        : { key: f, label: label + '  [' + said + ']', type: kind === 'num' ? 'number' : 'text',`,
`      if (kind === 'fab') return { key: f, label: label + '  [' + said + ']', type: 'select',
        value: recSaid(r[f]) ? String(r[f]).trim() : '', options: [''].concat(fabListOr(r[f])) };
      return kind === 'yn'
        ? { key: f, label: label + '  [' + said + ']', type: 'select', value: recSaid(r[f]) ? recNorm(r[f]) : '',
            options: ['', 'yes', 'no'] }
        : { key: f, label: label + '  [' + said + ']', type: kind === 'num' ? 'number' : 'text',`, 'the edit dialog picks it');

/* ---- 4. the sheet carries a dropdown for it ---- */
one(`  const dvs = RECIPE_FIELDS.filter(f => f[2] === 'yn').map(f => {
    const c = soColName(rows[0].indexOf(f[1]));
    return \`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="\${c}2:\${c}\${last}"><formula1>YesNo</formula1></dataValidation>\`;
  }).join('');`,
`  /* THE FABRICS GO IN THE HIDDEN Lists SHEET beside yes/no, so the cloth columns are a dropdown in
   * Excel rather than a box to mistype into. */
  const fabs = cutFabrics();
  const dvFor = (kind, name) => RECIPE_FIELDS.filter(f => f[2] === kind).map(f => {
    const c = soColName(rows[0].indexOf(f[1]));
    return \`<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="\${c}2:\${c}\${last}"><formula1>\${name}</formula1></dataValidation>\`;
  }).join('');
  const dvs = dvFor('yn', 'YesNo') + (fabs.length ? dvFor('fab', 'Fabrics') : '');
  const dvN = RECIPE_FIELDS.filter(f => f[2] === 'yn').length
    + (fabs.length ? RECIPE_FIELDS.filter(f => f[2] === 'fab').length : 0);`, 'the fabric dropdown');

one('    + `<dataValidations count="${RECIPE_FIELDS.filter(f => f[2] === \'yn\').length}">${dvs}</dataValidations></worksheet>`;',
  '    + `<dataValidations count="${dvN}">${dvs}</dataValidations></worksheet>`;', 'counted right');

one("    + `<row r=\"1\">${cellX('yes', 'A1')}</row><row r=\"2\">${cellX('no', 'A2')}</row>` + '</sheetData></worksheet>';",
`    + \`<row r="1">\${cellX('yes', 'A1')}\${cellX(fabs[0], 'B1')}</row><row r="2">\${cellX('no', 'A2')}\${cellX(fabs[1], 'B2')}</row>\`
    + fabs.slice(2).map((f, i) => \`<row r="\${i + 3}">\${cellX(f, 'B' + (i + 3))}</row>\`).join('') + '</sheetData></worksheet>';`, 'the Lists sheet carries them');

one(`    + '<definedNames><definedName name="YesNo">Lists!$A$1:$A$2</definedName></definedNames></workbook>';`,
`    + '<definedNames><definedName name="YesNo">Lists!$A$1:$A$2</definedName>'
    + (fabs.length ? '<definedName name="Fabrics">Lists!$B$1:$B$' + fabs.length + '</definedName>' : '')
    + '</definedNames></workbook>';`, 'and the name that points at them');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
