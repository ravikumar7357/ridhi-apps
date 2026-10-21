/* PICTURES IN A B2B SHEET (19 Oct): pkXlsxPictures reads a picture placed in a cell (Insert → Pictures → Place in Cell)
 * and one placed over the cells, each to the row it belongs to. tests/b2b-pictures.xlsx: rows 2 and 3 have in-cell
 * pictures (red JPEG, blue PNG), row 4 a picture over B4 written without the xdr: prefix.  node tests/b2b-pictures-test.js */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/app/replenishment/packing-list-labels.js'), 'utf8');
const grab = start => { const i = src.indexOf(start); if (i < 0) throw new Error('missing ' + start);
  let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } } return src.slice(i, j + 1); };
const u0 = src.indexOf('const pkUnesc ='), unesc = src.slice(u0, src.indexOf('\n', src.indexOf('&amp;', u0)));
const f = new Function(['const PK_TD = new TextDecoder();', unesc, grab('async function pkInflate'), grab('async function pkUnzip'), grab('function pkColIx'),
  grab('async function pkReadXlsx'), grab('function pkPathJoin'), grab('async function pkXlsxPictures')].join('\n') + '\nreturn { pkReadXlsx, pkXlsxPictures };')();
let pass = 0, fail = 0;
const ok = (name, c, info) => { if (c) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' — ' + info : '')); } };
(async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'b2b-pictures.xlsx')));
  const rows = await f.pkReadXlsx(bytes), pics = await f.pkXlsxPictures(bytes);
  const at = r => pics.find(p => p.row === r);
  ok('every row knows its Excel row number', rows.map(r => r.r).join() === '1,2,3,4', rows.map(r => r.r).join());
  ok('three pictures', pics.length === 3, JSON.stringify(pics.map(p => [p.row, p.how])));
  ok('row 2: the in-cell picture is the red JPEG (vm 1 → rich value 0 → rel 1)', at(2) && at(2).how === 'cell' && at(2).ext === 'jpeg' && at(2).col === 1);
  ok('row 3: the in-cell picture is the blue PNG', at(3) && at(3).how === 'cell' && at(3).ext === 'png');
  ok('row 4: the picture placed over B4 (no xdr: prefix) belongs to row 4', at(4) && at(4).how === 'over' && at(4).col === 1);
  ok('the bytes are the picture itself', at(2) && at(2).bytes[0] === 0xFF && at(2).bytes[1] === 0xD8 && at(3).bytes[1] === 0x50);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
