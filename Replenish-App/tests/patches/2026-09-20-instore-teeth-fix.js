/* Three tests of mine passed with the guard removed, and one teeth anchor was wrong.
 *   · "a named dispatch comes off the room first" — my fixture let the OLDER order swallow the loose
 *     pieces anyway, so the room never mattered. A single order proves it.
 *   · "the numeric run covers the new column" — nothing asserted the class, only the cell count.
 *   · "the journey shows the last leg" — /To FBA/ matched the table heading, so deleting the TILE passed. */
const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const TE = pathm.join(__dirname, '..', 'teeth', 'teeth-instore.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const rep = (a, b, n) => { const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B); console.log('  ok   ' + n); };

rep(`    ok('…while the older order took only what it could hold', at('FG-1').out === 20 && at('FG-1').store === 0);`,
`    ok('…while the older order took only what it could hold', at('FG-1').out === 20 && at('FG-1').store === 0);
    /* ONE ORDER ON ITS OWN, so nothing else can absorb the loose pieces and the ROOM is the only thing
     * standing between them and a stock figure that went negative: 30 in, 25 already dispatched by name,
     * and 20 more loose — only 5 of which this order can possibly have sent. */
    A.setPTG(Object.assign(A.PTG(), { ob: [{ id: 'f1', orderNo: 'FG-1', sku: 'FG-SKU', qty: 30, orderDate: '2026-09-01' }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });
    fgi([{ _id: 'a', txnType: 'RECEIVE', sku: 'FG-SKU', qty: 30, orderNo: 'FG-1' },
         { _id: 'b', txnType: 'FBA', sku: 'FG-SKU', qty: 25, orderNo: 'FG-1' },
         { _id: 'c', txnType: 'FBA', sku: 'FG-SKU', qty: 20 }]);
    ok('a dispatch already named comes off the room before any is shared in',
       at('FG-1').out === 30 && at('FG-1').worked === 5, JSON.stringify(at('FG-1')));
    ok('…so the stock never goes below nothing', at('FG-1').store === 0);
    A.setPTG(Object.assign(A.PTG(), { ob: [
      { id: 'f1', orderNo: 'FG-1', sku: 'FG-SKU', qty: 30, orderDate: '2026-09-01' },
      { id: 'f2', orderNo: 'FG-2', sku: 'FG-SKU', qty: 30, orderDate: '2026-09-05' }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });`, 'the room is what limits it');

rep(`      ok('…and every row has exactly as many cells as there are headings', heads === cells, heads + ' headings vs ' + cells + ' cells');`,
`      ok('…and every row has exactly as many cells as there are headings', heads === cells, heads + ' headings vs ' + cells + ' cells');
      /* AND THE NUMERIC RUN REACHES THE END OF IT. Adding a column inside the run and leaving its bounds
       * alone leaves the last number left-aligned — the cheapest sign that the two have drifted apart. */
      const ths = h.match(/<th[^>]*>.*?<\\/th>/g) || [];
      const numOf = name => (ths.find(x => x.indexOf('>' + name + '<') >= 0) || '').indexOf('class="num"') >= 0;
      ok('…and every figure column is a numeric one, to the last', ['Ordered', 'In store', 'To FBA', 'To cut', 'To make'].every(numOf),
         ['Ordered', 'In store', 'To FBA', 'To cut', 'To make'].map(n => n + ':' + numOf(n)).join(' '));`, 'the numeric run');

rep(`    ok('the journey ends at FBA', /To FBA/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 300));`,
`    /* THE TILE, not merely the column heading — matching "To FBA" anywhere passed with the tile deleted. */
    ok('the journey ends at FBA', /<div class="l">To FBA<\\/div>/.test((A.PTD_() || {}).html || ''), String((A.PTD_() || {}).html).slice(0, 300));`, 'the tile');

fs.writeFileSync(T, t);

let e = fs.readFileSync(TE, 'utf8');
const badAnchor = "['what went out is taken off the stock', '  map.forEach(e => {'";
if (e.indexOf(badAnchor) < 0) throw new Error('teeth anchor line not found');
const i = e.indexOf("  ['what went out is taken off the stock',"), j = e.indexOf("  ['a dispatch that names no order is shared by SKU',");
if (i < 0 || j < i) throw new Error('teeth block not found');
e = e.slice(0, i) + "  ['what went out is taken off the stock', '    e.store = Math.max(0, e.in - e.out); });', '    e.store = e.in; });'],\n"
  + "  ['…and the stock never goes below nothing', '    e.store = Math.max(0, e.in - e.out); });', '    e.store = e.in - e.out; });'],\n\n" + e.slice(j);
fs.writeFileSync(TE, e);
console.log('  ok   the teeth anchor');
