/* WHERE AN ORDER'S FINISHED PIECES ARE NOW — in the store, or gone to FBA.
 *
 * "In store" showed everything that had EVER come in for the order. CPC-DG-03-5454 read 25 there while
 * the Finished Goods screen read 0 in stock: all 25 had gone to FBA, and the console had no column that
 * could say so. So the line looked like stock that is not there, and the last leg of the order — the
 * dispatch to Amazon — was invisible.
 *
 * WHAT IS A FACT AND WHAT IS SHARED. The store keeps stock BY SKU, not by order: a RECEIVE names the
 * order it came in against (379 of 381 rows do), and a dispatch to FBA names none — 0 of 363 — because
 * the person taking pieces off a shelf is not told which order they were made for. So what came IN is
 * read as written, and what went OUT is shared among that SKU's orders: oldest first, never beyond what
 * that order actually received, outcome in proportion. The cell says when a figure was worked out.
 * This is the same rule the QC column uses, and it is now written once for both.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n, doneWhen) => {
  if (doneWhen && s.indexOf(doneWhen) >= 0) { console.log('  --   ' + n + ' (already applied)'); return; }
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the sharing rule, written once ---- */
one(`function ordQcIndex() {`,
`/**
 * ROWS THAT NAME NO ORDER, SHARED AMONG THE ORDERS OF THEIR SKU.
 *
 * QC checks and finished-goods outflows both record a SKU and not an order, and both have to be shown
 * against an order anyway. One rule, written once, because two copies of it would be two chances to
 * disagree: deal each SKU's loose pieces to its order lines OLDEST FIRST, never beyond the room that
 * line has, and never twice. What is left over belongs to no order in the book and is shown on none.
 *
 *   loose   Map sku → a number of pieces (and whatever else rides along)
 *   lines   the order lines to deal to
 *   roomOf  (line) → how many that line can still take; 0 or less means skip it
 *   give    (line, taken, fraction) → called for each share, fraction being taken/the SKU's whole
 */
function ordShareBySku(loose, lines, roomOf, give) {
  const when = r => ptDtMs(r.orderDate) || 0;
  const bySku = new Map();
  lines.forEach(r => { if (!bySku.has(r.sku)) bySku.set(r.sku, []); bySku.get(r.sku).push(r); });
  loose.forEach((whole, sku) => {
    let left = whole;
    if (!(left > 0)) return;
    (bySku.get(sku) || []).slice().sort((a, b) => when(a) - when(b)).forEach(r => {
      if (!(left > 0)) return;
      const take = Math.min(left, roomOf(r));
      if (!(take > 0)) return;
      give(r, take, take / whole);
      left -= take;
    });
  });
}

function ordQcIndex() {`, 'ordShareBySku');

one(`  /* SHARED OUT ONCE, AND NEVER BEYOND WHAT AN ORDER RECEIVED. Nothing can be inspected that did not come
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
  });`,
`  /* SHARED OUT ONCE, AND NEVER BEYOND WHAT AN ORDER RECEIVED — nothing can be inspected that did not
   * come back. The outcome (passed / rejected / alteration) goes with the pieces in proportion. */
  const whole = new Map(); loose.forEach((p, sku) => whole.set(sku, p.checked));
  ordShareBySku(whole, lines.filter(r => r.received > 0),
    r => r.received - ((map.get(obKeyOf(r.orderNo, r.sku)) || {}).checked || 0),
    (r, take, f) => { const p = loose.get(r.sku);
      add(obKeyOf(r.orderNo, r.sku), take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true); });`, 'QC uses it', 'ordShareBySku(whole, lines.filter(r => r.received > 0)');

/* ---- 2. the finished-goods index: in store, and gone to FBA ---- */
one(`/** Pieces of this order that actually reached the finished-goods store. */
let ORD_FG_IX = { src: null, n: -1, map: null };
function ordFgIndex() {
  const src = FGI.rows || [];
  if (ORD_FG_IX.map && ORD_FG_IX.src === src && ORD_FG_IX.n === src.length) return ORD_FG_IX.map;
  const map = new Map();
  src.forEach(r => {
    if (!r || !r.orderNo || r.txnType !== 'RECEIVE') return;
    const k = obKeyOf(r.orderNo, r.sku);
    map.set(k, (map.get(k) || 0) + fgiNum(r.qty));
  });
  ORD_FG_IX = { src, n: src.length, map };
  return map;
}
const ordFgOf = (orderNo, sku) => ordFgIndex().get(obKeyOf(orderNo, sku)) || 0;`,
`/**
 * WHERE AN ORDER'S FINISHED PIECES ARE NOW.
 *
 * What came IN is a fact — a RECEIVE names its order. What went OUT names none, because the store keeps
 * stock by SKU and nobody taking pieces off a shelf is told which order they were made for; those are
 * shared among the SKU's orders by ordShareBySku, oldest first, never beyond what that order received.
 *
 * Returned: in (received), out, fba (of that, sent to Amazon), fbaOpen (dispatched and not yet shipped,
 * so still the factory's), store (in − out) and worked (how many of the outward pieces were shared
 * rather than written down).
 */
let ORD_FG_IX = { src: null, n: -1, lines: null, map: null };
function ordFgIndex() {
  const src = FGI.rows || [], lines = ordLines();
  if (ORD_FG_IX.map && ORD_FG_IX.src === src && ORD_FG_IX.n === src.length && ORD_FG_IX.lines === lines) return ORD_FG_IX.map;
  const map = new Map(), loose = new Map();
  const get = k => { let e = map.get(k); if (!e) { e = { in: 0, out: 0, fba: 0, fbaOpen: 0, worked: 0 }; map.set(k, e); } return e; };
  const pool = sku => { let p = loose.get(sku); if (!p) { p = { out: 0, fba: 0, fbaOpen: 0 }; loose.set(sku, p); } return p; };
  src.forEach(r => {
    if (!r) return;
    const q = fgiNum(r.qty), sku = obUC(r.sku); if (!sku) return;
    /* IN — the same rules the Finished Goods screen counts by: a confirmed transfer from the press is
     * stock, an unconfirmed one is not yet, and a reversed one never was. */
    if (r.txnType === 'RECEIVE' || (r.txnType === 'TRANSFER_IN' && r.confirmed === true && r.reversed !== true)) {
      if (r.orderNo) get(obKeyOf(r.orderNo, sku)).in += q;
      return;
    }
    if (r.txnType !== 'ISSUE' && r.txnType !== 'FBA' && r.txnType !== 'FBA_RETURN') return;   // OPENING and the markers
    /* OUT. A return from FBA gives the pieces back, so it is the same figures with the sign turned. */
    const sign = r.txnType === 'FBA_RETURN' ? -1 : 1;
    const isFba = r.txnType === 'FBA' || r.txnType === 'FBA_RETURN';
    const st = r.txnType === 'FBA' ? fbaState(r) : null;
    const open = st ? st.open : 0;                       // dispatched and not yet shipped to Amazon
    const shipped = st && st.st === 'shipped';
    const add = (e, f) => { e.out += sign * q * f; if (isFba) { e.fba += sign * q * f; e.fbaOpen += sign * (shipped ? 0 : open) * f; } };
    if (r.orderNo) add(get(obKeyOf(r.orderNo, sku)), 1);
    else { const p = pool(sku); p.out += sign * q; if (isFba) { p.fba += sign * q; p.fbaOpen += sign * (shipped ? 0 : open); } }
  });
  /* THE LOOSE OUTFLOWS. An order can only have sent out what it took in, less what left it by name. */
  const whole = new Map(); loose.forEach((p, sku) => { if (p.out > 0) whole.set(sku, p.out); });
  ordShareBySku(whole, lines,
    r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },
    (r, take, f) => { const p = loose.get(r.sku), e = get(obKeyOf(r.orderNo, r.sku));
      e.out += take; e.fba += p.fba * f; e.fbaOpen += p.fbaOpen * f; e.worked += take; });
  map.forEach(e => { ['in', 'out', 'fba', 'fbaOpen', 'worked'].forEach(k => { e[k] = Math.round(e[k]); });
    e.store = Math.max(0, e.in - e.out); });
  ORD_FG_IX = { src, n: src.length, lines, map };
  return map;
}
const ordFgAt = (orderNo, sku) => ordFgIndex().get(obKeyOf(orderNo, sku)) || null;
/** Pieces of this order sitting in the India Store right now. */
const ordFgOf = (orderNo, sku) => { const e = ordFgAt(orderNo, sku); return e ? e.store : 0; };`, 'the finished-goods index');

/* ---- 3. the columns ---- */
one(`    'Ordered', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To cut', 'To make', 'Status'].concat(bkPrint ? ['Printing', 'Printer'] : [])
    .map((h, i) => \`<th\${i === 0 && !bkPick ? ' class="frz"' : (i >= 9 && i <= 17 ? ' class="num"' : '')}>\${h}</th>\`).join('') + '</tr></thead>';`,
`    'Ordered', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To FBA', 'To cut', 'To make', 'Status'].concat(bkPrint ? ['Printing', 'Printer'] : [])
    /* THE NUMERIC RUN ENDS AT "To make". Adding a column inside it and leaving this range alone puts every
     * heading after it over the wrong cells — which has happened on this table before. */
    .map((h, i) => \`<th\${i === 0 && !bkPick ? ' class="frz"' : (i >= 9 && i <= 18 ? ' class="num"' : '')}>\${h}</th>\`).join('') + '</tr></thead>';`, 'the header');

one(`      + (g => \`<td class="num" title="Pieces of this order that reached the India Store — from the Finished Goods register.">\`
          + (g ? \`<b>\${nf(g)}</b>\` : '<span class="muted">—</span>') + '</td>')(ordFgOf(r.orderNo, r.sku))`,
`      + (g => \`<td class="num"\${g ? \` title="\${esc(nf(g.in) + ' of this order came into the India Store and ' + nf(g.out) + ' have gone out, so ' + nf(g.store) + ' are there now.'
            + (g.fbaOpen ? ' A further ' + nf(g.fbaOpen) + ' are dispatched to FBA and not yet shipped, so ' + nf(g.store + g.fbaOpen) + ' are still the factory\\'s.' : '')
            + (g.worked ? ' The store keeps stock by SKU, so ' + nf(g.worked) + ' of the outward pieces name no order and are shared out by SKU — oldest order first, never beyond what this order received.' : ''))}"\` : ''}>\`
          + (g && g.store ? \`<b>\${nf(g.store)}</b>\` : '<span class="muted">—</span>')
          + (g && g.fbaOpen ? \`<div class="muted" style="font-size:10.5px">+\${nf(g.fbaOpen)} held for FBA</div>\` : '')
          + '</td>'
          /* THE LAST LEG. Pieces that left the store for Amazon, and whether they have actually gone. */
          + \`<td class="num"\${g && g.fba ? \` title="\${esc(nf(g.fba) + ' dispatched to FBA'
            + (g.fbaOpen ? ', of which ' + nf(g.fbaOpen) + ' are still waiting to be shipped' : ' and all shipped'))}"\` : ''}>\`
          + (g && g.fba ? \`<b style="color:#166534">\${nf(g.fba)}</b>\`
              + (g.fbaOpen ? \`<div class="muted" style="font-size:10.5px">\${nf(g.fbaOpen)} waiting</div>\` : '')
            : '<span class="muted">—</span>') + '</td>')(ordFgAt(r.orderNo, r.sku))`, 'the two cells');

/* ---- 4. the journey, and where a line is waiting ---- */
one(`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  return 'Store / dispatch';`,
`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  const g = ordFgAt(r.orderNo, r.sku) || { store: 0, fbaOpen: 0, in: 0 };
  if (r.pressed > g.in) return 'Store — ' + nf(r.pressed - g.in) + ' pressed but not taken into the store';
  if (g.fbaOpen) return 'FBA — ' + nf(g.fbaOpen) + ' dispatched, waiting to ship';
  if (g.store) return 'Store — ' + nf(g.store) + ' ready to dispatch';
  return 'Dispatched';`, 'waiting-at reaches the end');

one(`      cut: r.cutReq ? r.cut : null, issued: r.issued, received: r.received, qc: q ? q.ok : null, pressed: r.pressed,
      store: ordFgOf(r.orderNo, r.sku) || 0, v }; };`,
`      cut: r.cutReq ? r.cut : null, issued: r.issued, received: r.received, qc: q ? q.ok : null, pressed: r.pressed,
      store: (ordFgAt(r.orderNo, r.sku) || {}).store || 0, fba: (ordFgAt(r.orderNo, r.sku) || {}).fba || 0, v }; };`, 'the journey stage');

one(`  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')], ['In store', sum('store')]];`,
`  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')],
    ['In store', sum('store')], ['To FBA', sum('fba')]];`, 'the journey tiles');

one(`  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'Waiting at']
    .map((h, i) => \`<th\${i >= 2 && i <= 10 ? ' class="num"' : ''}>\${h}</th>\`).join('');`,
`  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To FBA', 'Waiting at']
    .map((h, i) => \`<th\${i >= 2 && i <= 11 ? ' class="num"' : ''}>\${h}</th>\`).join('');`, 'the journey head');

one(`      + \`<td class="num">\${num(x.qc, x.ordered)}</td><td class="num">\${num(x.pressed, x.ordered)}</td><td class="num">\${num(x.store, x.ordered)}</td>\``,
`      + \`<td class="num">\${num(x.qc, x.ordered)}</td><td class="num">\${num(x.pressed, x.ordered)}</td>\`
      + \`<td class="num">\${x.store ? nf(x.store) : '<span class="muted">—</span>'}</td>\`
      + \`<td class="num">\${x.fba ? \`<span style="color:#166534">\${nf(x.fba)}</span>\` : '<span class="muted">—</span>'}</td>\``, 'the journey row');

/* ---- 5. the export ---- */
one(`    'Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked', 'Waiting at'].map(csvCell).join(',')];`,
`    'Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked',
    'Into store', 'In store now', 'To FBA', 'FBA not yet shipped', 'Waiting at'].map(csvCell).join(',')];`, 'the export head');

one(`    v ? (v.shared ? 'shared by SKU' : (v.parts.every(p => p.stamped) ? 'placed for this order' : 'only order for this SKU')) : '',
    ordWaitingAt(r)].map(csvCell).join(',')); });`,
`    v ? (v.shared ? 'shared by SKU' : (v.parts.every(p => p.stamped) ? 'placed for this order' : 'only order for this SKU')) : '',
    (g => g ? [g.in, g.store, g.fba, g.fbaOpen] : ['', '', '', ''])(ordFgAt(r.orderNo, r.sku)),
    ordWaitingAt(r)].flat().map(csvCell).join(',')); });`, 'the export row');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
