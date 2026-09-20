/* The tile assertion called ORD_KPI_FIELDS as a function and never exercised the filter it is for. */
const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const a = [
  "      ok('…and it is one of the tiles you can click to see only those lines',",
  '         !!A.ORD_KPI_FIELDS().unrecorded || !!A.ORD_KPI_FIELDS.unrecorded, Object.keys(A.ORD_KPI_FIELDS.unrecorded ? A.ORD_KPI_FIELDS : {}).join(\',\'));',
].join(NL);
const b = [
  '      /* AND IT IS ONE OF THE TILES YOU CAN CLICK — the panel filters the table down to exactly those',
  '       * lines, which is how somebody goes and fixes them rather than reading a number. */',
  "      ok('…and it is one of the tiles you can click', !!A.ORD_KPI_FIELDS.unrecorded, Object.keys(A.ORD_KPI_FIELDS).join(','));",
  "      A.setORD_KPI('unrecorded'); A.renderOrd();",
  "      ok('…and clicking it shows only the lines with a hole',",
  "         /never recorded/.test(els.odTable.innerHTML) && (els.odTable.innerHTML.match(/<tbody><tr/g) || []).length === 1,",
  "         String((els.odTable.innerHTML.match(/<tr/g) || []).length) + ' rows');",
  "      A.setORD_KPI(''); A.renderOrd();",
].join(NL);
if (t.split(a).length !== 2) throw new Error('anchor not unique (' + (t.split(a).length - 1) + ')');
fs.writeFileSync(T, t.replace(a, () => b));
console.log('  ok   the tile filter is exercised');
