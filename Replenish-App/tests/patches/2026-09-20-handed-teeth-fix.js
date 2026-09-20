/* Two of mine.
 *   · counting /<tbody><tr/ counts the FIRST row and nothing else, so "only one row is shown" was true
 *     whatever the filter did. The rows are counted out of the tbody itself now.
 *   · the teeth break that removed the handedAt test zeroed every line and the suite CRASHED instead of
 *     failing; a crash names no guard. It now zeroes the un-handed lines instead, which is precisely the
 *     wrong behaviour being guarded against — a way to make outstanding work disappear. */
const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const TE = pathm.join(__dirname, '..', 'teeth', 'teeth-handed.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const a = [
  "      ok('…and clicking it shows only the lines with a hole',",
  '         /never recorded/.test(els.odTable.innerHTML) && (els.odTable.innerHTML.match(/<tbody><tr/g) || []).length === 1,',
  "         String((els.odTable.innerHTML.match(/<tr/g) || []).length) + ' rows');",
].join(NL);
const b = [
  '      /* THE ROWS IN THE BODY, not the one <tbody><tr> that starts it — that matches once however many',
  '       * rows there are, so it said "only one" whatever the filter did. */',
  "      const bodyRows = html => ((html.match(/<tbody>([\\s\\S]*)<\\/tbody>/) || [])[1] || '').match(/<tr/g) || [];",
  "      ok('…and clicking it shows only the lines with a hole',",
  '         /never recorded/.test(els.odTable.innerHTML) && bodyRows(els.odTable.innerHTML).length === 1,',
  "         bodyRows(els.odTable.innerHTML).length + ' row(s) shown');",
  "      A.setORD_KPI(''); A.renderOrd();",
  "      ok('…and letting it go shows them all again', bodyRows(els.odTable.innerHTML).length > 1,",
  "         bodyRows(els.odTable.innerHTML).length + ' row(s) shown');",
].join(NL);
if (t.split(a).length !== 2) throw new Error('test anchor not unique (' + (t.split(a).length - 1) + ')');
t = t.replace(a, () => b);
/* the old restore line right after it is now the second one above */
const dup = b + NL + "      A.setORD_KPI(''); A.renderOrd();";
if (t.split(dup).length === 2) t = t.replace(dup, () => b);
fs.writeFileSync(T, t);
console.log('  ok   the rows are counted out of the body');

let e = fs.readFileSync(TE, 'utf8');
const ea = `  ['…and a line nobody handed over keeps all of it',
   "    if (!l.handedAt) return Object.assign(l, { unrecorded: 0 });",
   '    if (false) return Object.assign(l, { unrecorded: 0 });'],`;
const eb = `  ['…and a line nobody handed over keeps all of it',
   "    if (!l.handedAt) return Object.assign(l, { unrecorded: 0 });",
   "    if (!l.handedAt) return Object.assign(l, { unrecorded: 0, pendingCut: 0, pendingMake: 0, madeToPress: 0 });"],`;
if (e.split(ea).length !== 2) throw new Error('teeth anchor not unique (' + (e.split(ea).length - 1) + ')');
fs.writeFileSync(TE, e.replace(ea, () => eb));
console.log('  ok   the break fails instead of crashing');
