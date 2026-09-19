/* QC NAMES ITS ORDER, AND THE ORDER CONSOLE CAN SHOW QC AT ALL.
 *
 * The check form has had an Order box since 16 Sep — marked optional, and in 245 checks nobody filled
 * it once. The Order Console looks QC up by order + SKU, so its QC column has been blank on every line
 * for as long as it has existed. Optional was right when it was written ("better than a number somebody
 * guessed"); it is wrong now that every other register is keyed by order and the form can OFFER the
 * orders the SKU is on instead of asking anybody to guess.
 *
 *   · the form: where the SKU is on an order, the order is required, offered from that list, and filled
 *     in by itself when there is only one. A SKU on no order still saves without — there is nothing to name.
 *   · the console: checks that carry an order are that order's. The ones that do not — all of history —
 *     are shared out by SKU, ONCE, never beyond what each order actually received, oldest first, and
 *     the cell says they were worked out. History is not rewritten to make the column look full.
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

/* ---- the form ---- */
one(`  if ($('qcwOrdList')) {
    const sku0 = qcNorm(($('qcwSku') || {}).value);
    $('qcwOrdList').innerHTML = (sku0 ? cutOrdersFor(sku0) : [])
      .map(o => \`<option value="\${esc(o.orderNo)}">\${esc(o.date || '')} · \${nf(o.ordered)} ordered</option>\`).join('');
  }`,
`  if ($('qcwOrdList')) {
    const sku0 = qcNorm(($('qcwSku') || {}).value);
    const on = sku0 ? qcOrdersFor(sku0) : [];
    $('qcwOrdList').innerHTML = on
      .map(o => \`<option value="\${esc(o.orderNo)}">\${esc(o.date || '')} · \${nf(o.ordered)} ordered · \${nf(o.received)} received</option>\`).join('');
    /* THE BOX SAYS WHETHER IT IS NEEDED, and fills itself in when there is only one answer — asking
     * somebody to type the one order a SKU is on is how a box comes to be left empty 245 times. */
    const box = $('qcwOrd');
    if (box) {
      box.placeholder = !sku0 ? 'Order No' : (on.length ? 'Order No *' : 'Order No — this SKU is on no order');
      if (on.length === 1 && !String(box.value || '').trim()) box.value = on[0].orderNo;
      if (on.length && String(box.value || '').trim() && !on.some(o => o.orderNo === obUC(box.value))) box.value = '';
    }
  }`, 'the form offers, requires and pre-fills');

one(`  const p = qcParts(sku);
  const rec = {
    id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),`,
`  /* AN ORDER, WHEREVER THERE IS ONE TO NAME. Every other register is keyed by order, and the Order
   * Console shows this figure as an order's own QC — a check with no order is invisible there. */
  const onOrders = qcOrdersFor(sku), ordTyped = obUC(($('qcwOrd') || {}).value);
  if (onOrders.length && !ordTyped) return qcCheckMsg(\`\${sku} is on \${nf(onOrders.length)} order(s) — pick which one these pieces are for.\`, true);
  if (ordTyped && onOrders.length && !onOrders.some(o => o.orderNo === ordTyped))
    return qcCheckMsg(\`Order \${ordTyped} has no line for \${sku}. It is on: \${onOrders.slice(0, 4).map(o => o.orderNo).join(', ')}\${onOrders.length > 4 ? '…' : ''}.\`, true);

  const p = qcParts(sku);
  const rec = {
    id: 'qc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),`, 'the save insists');

one(`    /* Blank is allowed and means "not against a named order" — better than a number somebody
     * guessed, because the Order Console shows this figure as an order's own QC. */`,
`    /* Blank survives only for a SKU that is on no order at all — there is nothing to name, and a
     * number somebody made up would be worse than none. */`, 'the comment says what is true now');

one(`/** What may be picked for cutting: master rows whose SKU is on at least one order. */`,
`/**
 * The orders a SKU is on, for the QC form — the ones with pieces back and not yet checked FIRST, because
 * that is the order the inspector is holding. Received comes from the Job Work Register.
 */
function qcOrdersFor(sku) {
  return cutOrdersFor(sku).map(o => { const b = obBaseIndex().get(obKeyOf(o.orderNo, sku));
    return Object.assign({}, o, { received: b ? b.received : 0 }); })
    .sort((a, b) => (b.received - a.received) || a.orderNo.localeCompare(b.orderNo));
}

/** What may be picked for cutting: master rows whose SKU is on at least one order. */`, 'qcOrdersFor');

/* ---- the console ---- */
one(`function ordQcIndex() {
  const src = QC.checks || [];
  if (ORD_QC_IX.map && ORD_QC_IX.src === src && ORD_QC_IX.n === src.length) return ORD_QC_IX.map;
  const map = new Map();
  src.forEach(r => {
    if (!r || !r.orderNo) return;
    const k = obKeyOf(r.orderNo, r.sku);
    const e = map.get(k) || { checked: 0, ok: 0, rej: 0, alt: 0 };
    e.checked += ptNum(r.checked); e.ok += ptNum(r.ok);
    e.rej += ptNum(r.rejected); e.alt += ptNum(r.forAlteration);
    map.set(k, e);
  });
  ORD_QC_IX = { src, n: src.length, map };
  return map;
}`,
`function ordQcIndex() {
  const src = QC.checks || [], lines = ordLines();
  if (ORD_QC_IX.map && ORD_QC_IX.src === src && ORD_QC_IX.n === src.length && ORD_QC_IX.lines === lines) return ORD_QC_IX.map;
  const map = new Map(), loose = new Map();
  const add = (k, c, ok, rej, alt, worked) => { const e = map.get(k) || { checked: 0, ok: 0, rej: 0, alt: 0, worked: 0 };
    e.checked += c; e.ok += ok; e.rej += rej; e.alt += alt; if (worked) e.worked += c; map.set(k, e); };
  src.forEach(r => {
    if (!r) return;
    if (r.orderNo) return add(obKeyOf(r.orderNo, r.sku), ptNum(r.checked), ptNum(r.ok), ptNum(r.rejected), ptNum(r.forAlteration), false);
    /* A CHECK THAT NAMED NO ORDER — every one made before the form asked. Kept by SKU, to be shared out. */
    const sku = obUC(r.sku); if (!sku) return;
    const p = loose.get(sku) || { checked: 0, ok: 0, rej: 0, alt: 0 };
    p.checked += ptNum(r.checked); p.ok += ptNum(r.ok); p.rej += ptNum(r.rejected); p.alt += ptNum(r.forAlteration);
    loose.set(sku, p);
  });
  /* SHARED OUT ONCE, AND NEVER BEYOND WHAT AN ORDER RECEIVED. Nothing can be inspected that did not come
   * back, so each order takes at most its received pieces less what was checked against it by name —
   * oldest order first. The outcome (passed / rejected / alteration) goes with the pieces in proportion.
   * What is left over belongs to no order in the book and is shown on none. */
  const when = r => ptDtMs(r.orderDate) || 0;
  loose.forEach((p, sku) => {
    let left = p.checked; if (!(left > 0)) return;
    lines.filter(r => r.sku === sku && r.received > 0).sort((a, b) => when(a) - when(b)).forEach(r => {
      if (!(left > 0)) return;
      const k = obKeyOf(r.orderNo, r.sku), room = r.received - ((map.get(k) || {}).checked || 0), take = Math.min(left, room);
      if (!(take > 0)) return;
      const f = take / p.checked;
      add(k, take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true); left -= take;
    });
  });
  ORD_QC_IX = { src, n: src.length, lines, map };
  return map;
}`, 'the console shares unnamed checks by SKU');

/* the cell says when the figure was worked out */
one(`      + (q => \`<td class="num"\` + (q && (q.rej || q.alt)
          ? ' title="' + nf(q.checked) + ' checked · ' + nf(q.ok) + ' passed · ' + nf(q.rej) + ' rejected'`,
`      + (q => \`<td class="num"\` + (q && q.worked && !(q.rej || q.alt)
          ? ' title="' + nf(q.worked) + ' of these checks named no order, so they are shared out by SKU — never beyond what this order received, oldest order first."'
          : '') + (q && (q.rej || q.alt)
          ? ' title="' + (q.worked ? nf(q.worked) + ' of these named no order and are shared out by SKU. ' : '') + nf(q.checked) + ' checked · ' + nf(q.ok) + ' passed · ' + nf(q.rej) + ' rejected'`, 'the cell says it was worked out');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
