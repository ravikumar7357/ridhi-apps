/* The slim/full split, cut from the real page and run. */
const fs = require('fs');
const mod = fs.readFileSync(__dirname + '/../../public/index.html', 'utf8').replace(/\r\n/g, '\n')
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const grab = name => {
  const m = new RegExp('^(?:async )?(?:function ' + name + '\\s*\\(|const ' + name + '\\s*=)', 'm').exec(mod);
  if (!m) throw new Error('not found: ' + name);
  const L = mod.slice(m.index).split('\n'); const o = [L[0]];
  for (let i = 1; i < L.length; i++) { if (/^(?:async )?(?:function |const |let |\/\*|\$\(')/.test(L[i])) break; o.push(L[i]); }
  return o.join('\n');
};
const src = ['REPL_FULL_TABS', 'REPL_SLIM_FIELDS', 'replFull', 'replSlimRow'].map(grab).join('\n')
  + '\nreturn { replFull, replSlimRow, REPL_SLIM_FIELDS };';
let CUR = {};
const X = new Function('get', src.replace(/\bME\b/g, 'get()'))(() => CUR);
let bad = 0;
const ok = (w, c, s) => { if (!c) bad++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${w}${c ? '' : '  — ' + s}`); };
CUR = { admin: true, tabs: [] }; ok('an admin reads the full snapshot', X.replFull());
CUR = { admin: false, tabs: ['shop', 'adj', 'shopprod'] }; ok('Shopify screens alone read the slim one', !X.replFull());
CUR = { admin: false, tabs: ['pack'] }; ok('…and so does the Packing List', !X.replFull());
CUR = { admin: false, tabs: ['vend'] }; ok('a vendor is not given the full one', !X.replFull());
CUR = { admin: false, tabs: ['shop', 'prod'] }; ok('a planning screen reads the full one', X.replFull());
const row = { sku: 'A1', subcat: 'Square', color: 'Red', size: '60X60', category: 'TC', totalStock: 5, awdAvail: 1, awdTransit: 0,
  last30: 99, last90: 300, l90amt: 5000, monthlyAmt: 1700, avgSale: 3.3, rec: 'AIR', decision: 'x', airQty: 10 };
const s = X.replSlimRow(row);
ok('the slim row keeps what a SKU is and what FBA holds', s.sku === 'A1' && s.totalStock === 5 && s.size === '60X60' && s.awdAvail === 1);
ok('…and none of the sales, revenue or advice',
  !['last30', 'last90', 'l90amt', 'monthlyAmt', 'avgSale', 'rec', 'decision', 'airQty'].some(k => k in s), Object.keys(s).join());
ok('eight columns at most', X.REPL_SLIM_FIELDS.length === 8);
console.log(bad ? bad + ' FAILED' : 'all passed');
process.exit(bad ? 1 : 0);
