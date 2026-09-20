/* THESE THREE ARE ORDER CONSOLE FUNCTIONS, SO THEY LIVE WITH THE ORDER CONSOLE.
 *
 * I first put them beside the In Production tab, which is where they are USED. But they are built
 * out of ordLines, SOX and soLines, they belong to the production tracker's block, and — the reason
 * this is not a matter of taste — prod-test cuts that block out of the page and runs it. Left where
 * they were, the figure the whole replenishment plan now rests on had no test that could reach it.
 *
 * pdIso goes with them although inProdReadyMap, outside the block, calls it: function declarations
 * hoist across the module, so the call still resolves, and the test can reach the date reader that
 * silently threw away 234,847 units' worth of dates.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);

const from = '/**' + LF + ' * A date as the registers write it, turned into YYYY-MM-DD';
const to = '/* ================= IN PRODUCTION (from the Order Console) ================= */';
const a = s.indexOf(from), b = s.indexOf(to);
if (a < 0 || b < a) throw new Error('the three are not where the last patch put them');
const moved = s.slice(a, b).replace(/\n+$/, '');
s = s.slice(0, a) + s.slice(b);

const anchor = '/* ================= WHAT THE VENDORS HOLD, ORDER BY ORDER =================';
if (s.split(anchor).length !== 2) throw new Error('anchor not unique (' + (s.split(anchor).length - 1) + ')');
s = s.replace(anchor, () => moved + LF + LF + anchor);

if (s.indexOf('function pdIso') > s.indexOf('/* ================= SHOPIFY ORDERS & ADJUSTMENTS'))
  throw new Error('pdIso landed outside the tested block');
if (s.indexOf('function pdIso') < s.indexOf('/* ================= PRODUCTION TRACKER'))
  throw new Error('pdIso landed before the tested block');
['function pdIso', 'function ordDueIndex', 'function ordProdRows'].forEach(f => {
  if (s.split(f).length !== 2) throw new Error(f + ' appears ' + (s.split(f).length - 1) + ' times');
});
fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('  ok   the three moved into the production block');
