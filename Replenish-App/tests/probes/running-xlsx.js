/* THE RUNNING-FABRIC TEMPLATE CARRIES THE VOIL AND CANVAS SKUs, and a picked one reads back.
 * voRunningXlsx sits outside the block prod-test cuts, so this pulls it and the catalogue functions
 * out of the real page, writes the workbook, and reads the zip back. */
const fs = require('fs'), zlib = require('zlib');
const APP = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const mod = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n').match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const grab = name => {
  const m = new RegExp('^(?:async )?(?:function ' + name + '\\s*\\(|const ' + name + '\\s*=)', 'm').exec(mod);
  if (!m) throw new Error('not found in the page: ' + name);
  const lines = mod.slice(m.index).split('\n'); const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) { if (/^(?:async )?(?:function |const |let |\/\*|\$\(')/.test(lines[i])) break; out.push(lines[i]); }
  return out.join('\n');
};
const src = ['let SO_CRC_T = null;', ...['soColName', 'soXml', 'soCrc32', 'soZip', 'FS_BRANDS', 'FS_WIDTHS', 'FS_DIRS',
  'FS_QUILT', 'FS_VOIL', 'FS_SIDES', 'fsSku', 'fsLinesFor', 'VO_XLSX_ROWS', 'voRunningXlsx'].map(grab),
  `const voFabricCatalogue = () => new Map(fsLinesFor('RBP', '327', 'Light Steel Blue')
     .map(l => Object.assign({ brandName: 'Ridhi' }, l)).map(r => [r.sku.toUpperCase(), r]));`,
  `const voMasterList = k => k === 'fabricType' ? ['Cambric', 'Voil 92', 'Voil 112', 'Canvas'] : ['Light Steel Blue'];`,
  'return voRunningXlsx();'].join('\n');
const buf = Buffer.from(new Function(src)());
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
const s2 = files['xl/worksheets/sheet2.xml'] || '', wb = files['xl/workbook.xml'] || '';
ok('the SKU dropdown offers a voil SKU with its side',
  s2.indexOf('RQL327-T-Front | Light Steel Blue · Voil 92 · Horizontal · Front') >= 0, s2.slice(0, 400));
ok('…and the back', s2.indexOf('RQL327-K-Back | Light Steel Blue · Voil 112 · Horizontal · Back') >= 0);
ok('…and canvas', s2.indexOf('RBP-CANVAS-327 | Light Steel Blue · Canvas') >= 0);
ok('…with fabric, colour and direction beside it for the formulas',
  /<t[^>]*>Voil 92<\/t>/.test(s2) && /<t[^>]*>Canvas<\/t>/.test(s2));
ok('the dropdown range covers all 18 lines of the colour', /name="FabricSkus">Lists!\$A\$1:\$A\$18</.test(wb), wb);
ok('Voil and Canvas are in the Fabric Type dropdown', /<t[^>]*>Voil 112<\/t>/.test(s2));
console.log(bad ? '\n' + bad + ' FAILED' : '\nall checks passed'); process.exit(bad ? 1 : 0);
