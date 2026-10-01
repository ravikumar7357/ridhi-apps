/* FILLING AMAZON'S BOX-CONTENT TEMPLATE — the real code, against a real .xlsx.
 *
 * Ravi, 2026-09-23: "packing list se hi fill amazon fba template wala action bhi ho".
 *
 * What makes this worth a test of its own: the output goes to AMAZON. A workbook that opens here
 * and is refused there teaches nobody anything, so the test builds a template the way Excel does
 * (a real zip, deflated, with styles and a second sheet), runs the app's own code over it, and then
 * reads the result back — checking both that the figures landed where Amazon looks for them AND
 * that every other byte of the workbook came through untouched.
 *
 *   node fba-test.js
 */
const fs = require('fs');
const zlib = require('zlib');
const pathm = require('path');
const APP = pathm.join(__dirname, '..', 'public', 'index.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

/* ---- a zip writer of our own, so the test does not lean on the code it is testing ---- */
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  let x = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) x = t[(x ^ buf[i]) & 0xFF] ^ (x >>> 8);
  return (x ^ 0xFFFFFFFF) >>> 0;
}
function zipOf(files) {
  const parts = [], dir = [];
  let at = 0;
  files.forEach(([name, text]) => {
    const raw = Buffer.from(text, 'utf8');
    const def = zlib.deflateRawSync(raw);
    const nameB = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(def.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    parts.push(lh, nameB, def);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(def.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(at, 42);
    dir.push(ch, nameB);
    at += 30 + nameB.length + def.length;
  });
  const dirAt = at;
  const dirLen = dir.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dirLen, 12); eocd.writeUInt32LE(dirAt, 16);
  return Buffer.concat([...parts, ...dir, eocd]);
}

/* ---- a template shaped the way Amazon's is ---- */
const SHARED = ['SKU', 'Total box count', 'Name of box', 'Box weight (lb)', 'Box length (in)',
  'Box width (in)', 'Box height (in)', 'RTC617-5656', 'RQL354-K', 'RPC177-2020', 'Expected quantity'];
const si = i => '<si><t>' + SHARED[i] + '</t></si>';
const sst = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="'
  + SHARED.length + '" uniqueCount="' + SHARED.length + '">' + SHARED.map((_, i) => si(i)).join('') + '</sst>';
const c = (ref, v, t, style) => '<c r="' + ref + '"' + (style ? ' s="' + style + '"' : '') + (t ? ' t="' + t + '"' : '') + '><v>' + v + '</v></c>';
const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
  + '<row r="1">' + c('A1', 1, 's') + c('B1', 3) + '</row>'          // Total box count = 3
  + '<row r="4">' + c('A4', 0, 's', 4) + c('K4', 10, 's') + c('M4', 1) + c('N4', 2) + c('O4', 3) + '</row>'  // header row
  + '<row r="5">' + c('A5', 7, 's') + '</row>'                        // RTC617-5656
  + '<row r="6">' + c('A6', 8, 's') + '</row>'                        // RQL354-K
  + '<row r="7">' + c('A7', 9, 's') + '</row>'                        // RPC177-2020
  + '<row r="8">' + c('A8', 2, 's') + '</row>'                        // "Name of box" — the list ends here
  + '<row r="9">' + c('A9', 3, 's') + '</row>'                        // Box weight (lb)
  + '<row r="10">' + c('A10', 4, 's') + '</row>'                      // Box length (in)
  + '<row r="11">' + c('A11', 5, 's') + '</row>'                      // Box width (in)
  + '<row r="12">' + c('A12', 6, 's') + '</row>'                      // Box height (in)
  + '</sheetData></worksheet>';
const other = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>';
const wb = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
  + '<sheet name="Instructions" sheetId="1" r:id="rId1"/>'
  + '<sheet name="Box packing information" sheetId="2" r:id="rId2"/></sheets></workbook>';
const rels = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/>'
  + '<Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>';
const styles = '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>';
const FILES = [['[Content_Types].xml', '<?xml version="1.0"?><Types/>'], ['xl/workbook.xml', wb],
  ['xl/_rels/workbook.xml.rels', rels], ['xl/sharedStrings.xml', sst], ['xl/styles.xml', styles],
  ['xl/worksheets/sheet1.xml', other], ['xl/worksheets/sheet2.xml', sheet]];
const TEMPLATE = zipOf(FILES);

/* ---- the app's own code, cut out of the page ---- */
const html = fs.readFileSync(APP, 'utf8');
const from = html.indexOf('let PK = [], PK_LOADED');
const to = html.indexOf('async function pkDelete(id) {');
if (from < 0 || to < 0) throw new Error('the packing block is not where it was');
const block = html.slice(from, to);
const ctx = { AUDIT_OFF: true, BASE_SPLIT_OFF: true,
  $: () => ({ value: '', click() {}, onchange: null, classList: { add() {}, remove() {}, toggle() {} },
    querySelectorAll: () => [], style: {}, textContent: '', innerHTML: '' }),
  document: { createElement: () => ({ click() {}, style: {} }), querySelectorAll: () => [] },
  esc: s => String(s == null ? '' : s), nf: v => String(v),
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout, console, TextDecoder, TextEncoder, Blob, Response, CompressionStream, DecompressionStream,
  pkMsg: () => {}, alert: () => {}, confirm: () => true, localStorage: { getItem: () => null, setItem() {} },
  ptIsoDate: v => String(v || ''), mdbOf: () => null, replRowMap: () => ({}), ME: { email: 't@x' },
};
const A = new Function(...Object.keys(ctx), block
  + '\n;return { pkUnzip, pkZipEntries, pkZipReplace, pkCrc32, amzSheetPath, amzPlan, amzSetCell, amzNumToCol, pkCalc, PK_TD };')(
  ...Object.values(ctx));

/* ---- the packing list to fill from ---- */
const LIST = {
  id: 'p1', date: '2026-09-23', title: 'RIDHI AIR 7', pkgWt: 0.5, volDiv: 5000,
  boxes: [
    { n: 1, L: 50, W: 40, H: 30, items: [{ sku: 'RTC617-5656', qty: 10, perPcsWt: 0.4 }, { sku: 'RQL354-K', qty: 5, perPcsWt: 1.2 }] },
    { n: 2, L: 60, W: 40, H: 20, items: [{ sku: 'RPC177-2020', qty: 12, perPcsWt: 0.2 }] },
    /* A SKU the template has never heard of — the one failure this job actually has. */
    { n: 3, L: 30, W: 30, H: 30, items: [{ sku: 'NOT-IN-TEMPLATE', qty: 7, perPcsWt: 0.3 }] },
    /* And a box beyond what the template made room for. */
    { n: 9, L: 20, W: 20, H: 20, items: [{ sku: 'RTC617-5656', qty: 1, perPcsWt: 0.4 }] },
  ],
};

(async () => {
  console.log('== the template is recognised ==');
  const bytes = new Uint8Array(TEMPLATE);
  const path = await A.amzSheetPath(bytes);
  ok('the box sheet is found through the workbook, not by guessing a file name', path === 'xl/worksheets/sheet2.xml', path);

  let threw = '';
  try { await A.amzSheetPath(new Uint8Array(zipOf([['xl/workbook.xml', '<workbook><sheets/></workbook>']]))); }
  catch (e) { threw = e.message; }
  ok('a workbook that is not the box template is refused by name', /box-content template/.test(threw), threw);

  console.log('\n== what goes where ==');
  const files = await A.pkUnzip(bytes, n => n === path || n === 'xl/sharedStrings.xml');
  const shared = [];
  new TextDecoder().decode(files['xl/sharedStrings.xml']).split('<si>').slice(1).forEach(s2 => {
    let t = ''; for (const m of s2.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
    shared.push(t);
  });
  let xml = new TextDecoder().decode(files[path]);
  const plan = A.amzPlan(xml, shared, LIST);
  ok('the header row is found', plan.head === 4, String(plan.head));
  ok('…and the box count Amazon made room for', plan.boxes === 3, String(plan.boxes));
  const at = (col, row) => plan.sets.find(x => x.col === col && x.row === row);
  ok('box 1 column M carries its two SKUs', at(13, 5) && at(13, 5).value === 10 && at(13, 6) && at(13, 6).value === 5,
     JSON.stringify(plan.sets.filter(x => x.col === 13)));
  ok('box 2 column N carries its one', at(14, 7) && at(14, 7).value === 12);
  /* Box 1: (10 × 0.4) + (5 × 1.2) = 10 kg net, + 0.5 packaging = 10.5 kg → 23.1 lb. */
  ok('the weight is in POUNDS, as Amazon asks', at(13, 9) && Math.abs(at(13, 9).value - 23.1) < 0.05,
     at(13, 9) && String(at(13, 9).value));
  /* 50 cm ÷ 2.54 = 19.7 → 20 inches. */
  ok('…and the sizes in INCHES, rounded', at(13, 10) && at(13, 10).value === 20 && at(13, 11).value === 16 && at(13, 12).value === 12,
     JSON.stringify([at(13, 10), at(13, 11), at(13, 12)].map(x => x && x.value)));
  ok('a SKU the template does not have is named, not silently dropped',
     plan.missing.length === 1 && plan.missing[0].sku === 'NOT-IN-TEMPLATE' && plan.missing[0].qty === 7,
     JSON.stringify(plan.missing));
  ok('…and a box beyond the template\'s count is reported', plan.used === 9 && plan.boxes === 3);
  ok('…and nothing is written for it', !plan.sets.some(x => x.col === A.amzNumToCol ? false : x.col > 15));

  console.log('\n== the cells land in the file ==');
  plan.sets.forEach(x => { xml = A.amzSetCell(xml, x.col, x.row, x.value, plan.head); });
  ok('a cell that already existed keeps its style', /<c r="M4"[^>]*><v>1<\/v><\/c>/.test(xml));
  ok('…and one that did not is inserted in column order', /<c r="A5"[^>]*t="s"[^>]*><v>7<\/v><\/c><c r="M5"[^>]*><v>10<\/v><\/c>/.test(xml),
     (xml.match(/<row r="5">[\s\S]*?<\/row>/) || [''])[0]);
  ok('…and the row stays a row', (xml.match(/<row r="5"/g) || []).length === 1);

  console.log('\n== the workbook comes back whole ==');
  const blob = await A.pkZipReplace(bytes, path, xml);
  const out = new Uint8Array(await blob.arrayBuffer());
  const before = await A.pkZipEntries(bytes);
  const after = await A.pkZipEntries(out);
  ok('every entry is still there, in order', after.length === before.length
     && after.every((e, i) => e.name === before[i].name), after.map(e => e.name).join(','));
  const untouched = after.filter(e => e.name !== path);
  ok('…and every one this app did not change is byte for byte what it was',
     untouched.every(e => {
       const was = before.find(b => b.name === e.name);
       return was && was.crc === e.crc && was.csize === e.csize && was.usize === e.usize
         && Buffer.compare(Buffer.from(was.data), Buffer.from(e.data)) === 0;
     }));
  const back = await A.pkUnzip(out, n => n === path || n === 'xl/worksheets/sheet1.xml');
  const backXml = new TextDecoder().decode(back[path]);
  ok('the figures are in the file that comes out', /<c r="M5"[^>]*><v>10<\/v><\/c>/.test(backXml)
     && /<c r="N7"[^>]*><v>12<\/v><\/c>/.test(backXml), backXml.slice(0, 200));
  ok('…and the other sheet is untouched', /<c r="A1"><v>42<\/v><\/c>/.test(new TextDecoder().decode(back['xl/worksheets/sheet1.xml'])));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
