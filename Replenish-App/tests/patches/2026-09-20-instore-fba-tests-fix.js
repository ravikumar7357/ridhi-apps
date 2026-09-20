/* Three expectations of mine were wrong, and one fixture did not reach the stage it was testing.
 *   · FG-1 is the OLDER order, so it takes 20 of the loose 25 and only 5 are left for FG-2 — I wrote 10.
 *   · the screen fixture gives FG-1 thirty received, so all 25 of the dispatch are its, not 20.
 *   · the waiting-at fixture had nothing cut or pressed, so the answer was about cutting, not FBA. */
const fs = require('fs'), pathm = require('path');
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const rep = (a, b, n) => {
  const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('anchor not unique (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B);
  console.log('  ok   ' + n);
};

rep(`    ok('a dispatch that names its order is that order\\'s', at('FG-2').fba === 15 + 10, JSON.stringify(at('FG-2')));
    ok('…and what it took is not shared in again', at('FG-1').out === 20 && at('FG-1').store === 0);
    ok('…with only the shared part marked as worked out', at('FG-2').worked === 10);`,
`    /* FG-1 IS OLDER, so it takes 20 of the loose 25 first and 5 are left for FG-2 — which already had 15
     * dispatched by name. 15 + 5 = 20, and only the 5 of it were worked out. */
    ok('a dispatch that names its order is that order\\'s', at('FG-2').fba === 20 && at('FG-2').out === 20, JSON.stringify(at('FG-2')));
    ok('…and the named 15 came off its room before anything was shared in', at('FG-2').worked === 5);
    ok('…while the older order took only what it could hold', at('FG-1').out === 20 && at('FG-1').store === 0);`, 'the arithmetic');

rep(`    ok('a line whose stock all went to FBA shows nothing in store and the dispatch beside it',
       /<div class="muted" style="font-size:10.5px">20 waiting<\\/div>/.test(h), h.slice(0, 200));`,
`    /* FG-1 received 30 and is the older, so all 25 of the loose dispatch are its — 5 left in store. */
    ok('the dispatch shows beside the stock, with what is still waiting to ship',
       /25 waiting/.test(h) && /<b>5<\\/b>/.test(h), (h.match(/\\d+ waiting/g) || []).join(','));`, 'the screen figure');

rep(`    /* ---- the journey, and where the line is waiting ---- */
    const row = no => A.ordLines().find(r => r.orderNo === no);
    ok('a line whose pieces are waiting to ship says so', /^FBA —/.test(A.ordWaitingAt(row('FG-1'))), A.ordWaitingAt(row('FG-1')));
    ok('…and one with stock on the shelf says it is ready to dispatch',
       /^Store — 25 ready/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));`,
`    /* ---- where the line is waiting ----
     *
     * This needs lines that have got PAST cutting and the press, or the answer is about those stages. */
    A.setPTG(Object.assign(A.PTG(), { mdb: (A.PTG().mdb || []).concat([{ sku: 'FG-SKU', cuttingRequired: false }]),
      press: [{ id: 'p1', orderNo: 'FG-1', sku: 'FG-SKU', pieces: 30 }, { id: 'p2', orderNo: 'FG-2', sku: 'FG-SKU', pieces: 20 }] }));
    A.setPT(Object.assign(A.PT(), { base: [
      { id: 'j1', orderNo: 'FG-1', sku: 'FG-SKU', issuePieces: 30, receivedPieces: 30 },
      { id: 'j2', orderNo: 'FG-2', sku: 'FG-SKU', issuePieces: 20, receivedPieces: 20 }] }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });
    const row = no => A.ordLines().find(r => r.orderNo === no);
    /* FG-1 is made and pressed in full — COMPLETE — and 25 of its pieces are dispatched and unshipped.
     * Before this, a complete line said "Complete" and nothing about where its pieces were, which is
     * exactly the case Ravi was looking at: 25 ordered, 25 made, all 25 sitting at FBA. */
    ok('a finished line still says where its pieces are',
       /^Complete · 25 waiting to ship to FBA/.test(A.ordWaitingAt(row('FG-1'))), A.ordWaitingAt(row('FG-1')));
    /* FG-2 is 20 of 30 made, so it is still open, and its 30 received are on the shelf. */
    ok('…and an open line with stock on the shelf is ready to dispatch',
       /^Store — 30 ready to dispatch/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));`, 'the waiting-at fixture');

fs.writeFileSync(T, t);
console.log('written');
