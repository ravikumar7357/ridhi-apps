/* WHAT TO SEND IS WHAT WAS ASKED, LESS WHAT IS ALREADY WITH THE PRINTER.
 *
 * Ravi, 2026-09-21, on the RFD Requirements office screen: "abhi uske pas jo pcs pade h wo minus krke
 * req. qty aani chahiye". The requirement is kept as the printer raised it — it is their record, and
 * nothing is rewritten — but the office sees, and sends against, the part that is not already on
 * their floor.
 *
 * THE COUNT IS THE ONE TYPED ON THAT ORDER, for that size (pieces) or that cloth (metres), and it is
 * applied to that order's requests of the size OLDEST FIRST, so two requests of one size do not both
 * claim the same pieces. A refused request takes none.
 *
 * A REQUEST THE PRINTER ALREADY HOLDS IN FULL IS DONE: nothing is to go out, so it moves to the
 * finished stage rather than sitting in "approved, not yet sent" for ever.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the sum ---- */
one(`function rfdStage(r, o) {
  if (!r) return '';
  const d = rfdDecisionOf(r.id);
  if (d && d.stage === 'rejected') return 'rejected';
  const want = rfdWant(r);
  if (want > 0 && rfdSentQty(r.id) >= want) return 'sent';`,
`/**
 * How much of one request is already with the printer, by their own count on that order.
 *
 * Their count for the size (or the cloth) is shared over that order's requests of it, oldest first,
 * each taking up to what it asked for. A refused request takes none.
 */
function rfdWithPrinter(r, o) {
  if (!r) return 0;
  const order = o || r._order || rfdOrderOf(r);
  if (!order) return 0;
  const code = rfdVendorOf(order);
  let key, same;
  if (rfdUnit(r) === 'pcs') {
    const lines = rfdPieceLines(order);
    const keyOf = sku => { const p = lines.find(x => obUC(x.sku) === obUC(sku)); return p ? rfdStockKey(p) : ''; };
    key = keyOf(r.sku);
    if (!key) return 0;
    same = x => rfdUnit(x) === 'pcs' && keyOf(x.sku) === key;
  } else {
    key = rfdFabKey(r.fabric);
    same = x => rfdUnit(x) === 'm' && rfdFabKey(x.fabric) === key;
  }
  let pool = rfdStockOf(code, key, order);
  if (!(pool > 0)) return 0;
  const list = rfdReqsOf(order).filter(x => same(x) && !((d => d && d.stage === 'rejected')(rfdDecisionOf(x.id))))
    .sort((a, b) => (rfdSeq(a) < rfdSeq(b) ? -1 : rfdSeq(a) > rfdSeq(b) ? 1 : 0));
  for (const x of list) {
    const take = Math.min(pool, rfdWant(x));
    if (x.id === r.id) return rfdRound(take);
    pool -= take;
  }
  return 0;
}
/** What is still to go out on one request: what was asked, less what is already with them. */
const rfdToSend = (r, o) => rfdRound(Math.max(0, rfdWant(r) - rfdWithPrinter(r, o)));

function rfdStage(r, o) {
  if (!r) return '';
  const d = rfdDecisionOf(r.id);
  if (d && d.stage === 'rejected') return 'rejected';
  const want = rfdWant(r);
  if (want > 0 && rfdSentQty(r.id) >= want) return 'sent';
  /* HELD IN FULL, or sent up to what was not held: nothing more is to go out. */
  if (want > 0 && (d ? d.stage !== 'pending' : true)) {
    const toSend = rfdToSend(r, o);
    if (toSend < want && rfdSentQty(r.id) >= toSend) return 'sent';
  }`, 'the sum');

/* ---- 2. sending stops at what is not already with them ---- */
one(`  const unit = rfdUnit(r);
  const left = rfdRound(want - rfdSentQty(id));
  if (unit === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';
  if (q > left) return 'Only ' + nf(left) + ' ' + unit + ' of this requirement is still to go out.';`,
`  const unit = rfdUnit(r);
  const held = rfdWithPrinter(r);
  const left = rfdRound(Math.max(0, want - held - rfdSentQty(id)));
  if (unit === 'pcs' && Math.round(q) !== q) return 'Pieces have to be a whole number.';
  if (q > left) return 'Only ' + nf(left) + ' ' + unit + ' of this requirement is still to go out'
    + (held ? ' — ' + nf(held) + ' ' + unit + ' of it is already with them.' : '.');`, 'send cap');

one(`  if (rfdCanSend() && (r.stage === 'approved' || r.stage === 'sent') && r.sent < rfdWant(r))`,
`  if (rfdCanSend() && (r.stage === 'approved' || r.stage === 'sent') && r.sent < rfdToSend(r, r._order))`, 'button');

one(`    const left = rfdRound(rfdWant(r) - r.sent);
    const u = rfdUnit(r);`,
`    const left = rfdRound(Math.max(0, rfdToSend(r, r._order) - r.sent));
    const u = rfdUnit(r);`, 'dialog default');

/* ---- 3. the row ---- */
one(`      + \`<td class="num" style="font-weight:700">\${esc(rfdQtyTxt(r))}</td>\``,
`      /* ASKED, WITH THEM, TO SEND. The ask stays as they raised it; the office works from the last. */
      + (held > 0
        ? \`<td class="num"><div class="muted" style="font-size:11px">\${esc(rfdQtyTxt(r))} asked</div>\`
          + \`<div style="font-size:11px;color:#7f6000">− \${nf(held)} \${u} with them</div>\`
          + \`<div style="font-weight:700">\${nf(rfdRound(Math.max(0, want - held)))} \${u} to send</div></td>\`
        : \`<td class="num" style="font-weight:700">\${esc(rfdQtyTxt(r))}</td>\`)`, 'the cell');

one(`    const want = rfdWant(r);
    const over = cap ? rfdRound(want - cap.left) : 0;`,
`    const want = rfdWant(r);
    const held = r._order ? rfdWithPrinter(r, r._order) : 0;
    const over = cap ? rfdRound(want - cap.left) : 0;`, 'held on the row');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
