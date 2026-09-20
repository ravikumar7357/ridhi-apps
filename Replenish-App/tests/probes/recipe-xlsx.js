/* THE RECIPE WORKBOOK IS ACTUALLY WRITTEN, AND THE FILE IS OPENED. Read-only.
 *
 * recipeXlsx leans on soColName, soXml and soZip, which sit outside the block prod-test cuts out of
 * the page — so the suite cannot reach it. A change to the .xlsx writing that nothing checks is a
 * file somebody discovers is broken when they try to open it. This pulls the five functions out of
 * the real page, writes a workbook, and reads the zip back: the Fabric column, the Fabrics dropdown,
 * the hidden Lists sheet and the defined name that ties them together.
 */
const fs = require('fs'), zlib = require('zlib');
const APP = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const mod = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n').match(/<script type="module">([\s\S]*?)<\/script>/)[1];

/** One top-level function, by name, cut from the page. */
const grab = name => {
  const re = new RegExp('^(?:async )?(?:function ' + name + '\\s*\\(|const ' + name + '\\s*=)', 'm');
  const m = re.exec(mod);
  if (!m) throw new Error('not found in the page: ' + name);
  const lines = mod.slice(m.index).split('\n');
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:async )?(?:function |const |let |\/\*|\$\(')/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
};

const FIELDS = [['fabric', 'Fabric', 'fab'], ['consumption', 'Consumption (m)', 'num'],
  ['cuttingRequired', 'Cutting required', 'yn'], ['ruffleFabric', 'Ruffle fabric', 'fab']];
const FABS = ['Cambric', 'Chambray', 'Sheeting 62', 'Sheeting 82'];
const src = ['let SO_CRC_T = null;', grab('soColName'), grab('soXml'), grab('soCrc32'), grab('soZip'), grab('recipeXlsx'),
  'return recipeXlsx(ROWS);'].join('\n');
const ROWS = [['Article', 'Subtype', 'Size', 'SKUs'].concat(FIELDS.map(f => f[1]))
    .concat(FIELDS.map(f => 'SKUs say: ' + f[1])),
  ['Tablecloth', 'Square Tablecloth', '60x60', 142, 'Sheeting 62', 1.6, 'yes', '', '', '', '', '']];
const bytes = new Function('ROWS', 'RECIPE_FIELDS', 'cutFabrics', src)(ROWS, FIELDS, () => FABS);

/* ---- read the zip back, the way Excel would ---- */
const buf = Buffer.from(bytes);
const files = {};
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf.readUInt32LE(i) !== 0x04034b50) continue;
  const nLen = buf.readUInt16LE(i + 26), xLen = buf.readUInt16LE(i + 28);
  const name = buf.slice(i + 30, i + 30 + nLen).toString();
  const size = buf.readUInt32LE(i + 18), method = buf.readUInt16LE(i + 8);
  const raw = buf.slice(i + 30 + nLen + xLen, i + 30 + nLen + xLen + size);
  files[name] = method === 8 ? zlib.inflateRawSync(raw).toString() : raw.toString();
}
let bad = 0;
const ok = (what, cond, saw) => { if (!cond) bad++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${cond ? '' : '  — ' + saw}`); };

ok('the workbook has the parts Excel needs',
  ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/styles.xml'].every(f => files[f]),
  Object.keys(files).join(', '));
const s1 = files['xl/worksheets/sheet1.xml'] || '', s2 = files['xl/worksheets/sheet2.xml'] || '', wb = files['xl/workbook.xml'] || '';
ok('the Fabric column is in the sheet', /<t[^>]*>Fabric<\/t>/.test(s1), s1.slice(0, 200));
ok('…and its read-only twin beside it', /SKUs say: Fabric/.test(s1));
ok('the hidden Lists sheet carries every fabric',
  FABS.every(f => s2.indexOf('>' + f + '<') >= 0), s2);
ok('…and yes/no is still there beside them', /<t[^>]*>yes<\/t>/.test(s2) && /<t[^>]*>no<\/t>/.test(s2), s2);
ok('the fabrics are in column B, not on top of yes/no',
  /r="B1"/.test(s2) && /r="A1"/.test(s2) && !/r="A3"/.test(s2), s2);
ok('the workbook names the fabric range', /name="Fabrics">Lists!\$B\$1:\$B\$4</.test(wb), wb);
ok('…and the yes/no one is untouched', /name="YesNo">Lists!\$A\$1:\$A\$2</.test(wb), wb);
ok('the Fabric column is a dropdown onto it',
  /sqref="E2:[^"]*"><formula1>Fabrics<\/formula1>/.test(s1), (s1.match(/<dataValidation[^/]*\/formula1>/g) || []).join(' | '));
ok('…and so is the ruffle cloth', (s1.match(/<formula1>Fabrics<\/formula1>/g) || []).length === 2,
  String((s1.match(/<formula1>Fabrics<\/formula1>/g) || []).length));
ok('…and the yes/no dropdown survived', /<formula1>YesNo<\/formula1>/.test(s1));
ok('the count matches the number of dropdowns',
  (m => m && +m[1] === (s1.match(/<dataValidation /g) || []).length)(s1.match(/<dataValidations count="(\d+)"/)),
  (s1.match(/<dataValidations count="\d+"/) || [''])[0] + ' vs ' + (s1.match(/<dataValidation /g) || []).length);

/* AND WITH NO FABRIC MASTER AT ALL it must still write a file rather than an empty dropdown. */
const none = new Function('ROWS', 'RECIPE_FIELDS', 'cutFabrics', src)(ROWS, FIELDS, () => []);
ok('a workbook is still written when no fabric is set up yet', none && none.length > 500, String(none && none.length));

console.log(bad ? '\n' + bad + ' FAILED' : '\nall ' + 13 + ' checks passed');
process.exit(bad ? 1 : 0);
