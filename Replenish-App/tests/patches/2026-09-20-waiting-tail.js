/* WHERE THE FINISHED PIECES ARE IS SAID ONCE, NOT IN THREE BRANCHES THAT CANNOT BE REACHED.
 *
 * A line is OPEN exactly while pressed < ordered. To reach a stage after the press it would have to have
 * issued >= ordered, received >= issued and pressed >= received — which makes pressed >= ordered, and the
 * line is not open. So every branch after the press check is unreachable by arithmetic; the pre-existing
 * "Store / dispatch" fallback was dead for the same reason, and the two I added on top of it were too.
 * The one place the answer is actually wanted is a FINISHED line — Ravi's own case: 25 ordered, 25 made,
 * all 25 sitting dispatched to FBA and nothing saying so.
 */
const fs = require('fs'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const T = pathm.join(__dirname, '..', 'prod-test.js');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  const g = fin;
  if (r.pressed > g.in) return 'Store — ' + nf(r.pressed - g.in) + ' pressed but not taken into the store';
  if (g.fbaOpen) return 'FBA — ' + nf(g.fbaOpen) + ' dispatched, waiting to ship';
  if (g.store) return 'Store — ' + nf(g.store) + ' ready to dispatch';
  return 'Dispatched';`,
`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  /* Anything past here can only be reached by figures that contradict each other — a line is open only
   * while pressed < ordered, and getting this far means pressed >= ordered. Saying where the pieces are
   * is still the most useful answer if it ever happens. */
  return tail ? 'Store —' + tail.replace(' · ', ' ') : 'Store / dispatch';`, 'one place, not three');

fs.writeFileSync(P, s.split(LF).join(CR + LF));

let t = fs.readFileSync(T, 'utf8');
const NL = t.indexOf(CR + LF) >= 0 ? CR + LF : LF;
const rep = (a, b, n) => { const A = a.split(LF).join(NL), B = b.split(LF).join(NL);
  if (t.split(A).length !== 2) throw new Error('test anchor (' + (t.split(A).length - 1) + '): ' + n);
  t = t.replace(A, () => B); console.log('  ok   ' + n); };

rep(`    /* FG-2 is 20 of 30 made, so it is still open, and its 30 received are on the shelf. */
    ok('…and an open line with stock on the shelf is ready to dispatch',
       /^Store — 30 ready to dispatch/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));`,
`    /* FG-2's pieces are all on the shelf, none dispatched. */
    A.setPTG(Object.assign(A.PTG(), { press: (A.PTG().press || []).map(p => (p.orderNo === 'FG-2' ? Object.assign({}, p, { pieces: 30 }) : p)) }));
    A.setPT(Object.assign(A.PT(), { base: A.PT().base.map(b => (b.orderNo === 'FG-2' ? Object.assign({}, b, { issuePieces: 30, receivedPieces: 30 }) : b)) }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });
    ok('…and one whose pieces are all on the shelf says that instead',
       /^Complete · 30 in store/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));
    /* A LINE NOBODY HAS FINISHED still answers about the stage it is at, not about the store. */
    A.setPT(Object.assign(A.PT(), { base: A.PT().base.map(b => (b.orderNo === 'FG-2' ? Object.assign({}, b, { issuePieces: 12, receivedPieces: 12 }) : b)) }));
    A.setPTG(Object.assign(A.PTG(), { press: (A.PTG().press || []).map(p => (p.orderNo === 'FG-2' ? Object.assign({}, p, { pieces: 12 }) : p)) }));
    A.setORD({ req: {}, busy: false, at: '', rows: [] });
    ok('…while an unfinished one still answers about the stage it is at',
       /^Issue — 18/.test(A.ordWaitingAt(row('FG-2'))), A.ordWaitingAt(row('FG-2')));`, 'the two finished cases');

fs.writeFileSync(T, t);
console.log('written');
