/* A VENDOR ORDER LINE SAYS WHICH SALES ORDERS IT IS FOR — written when the order is placed.
 *
 * Until now the link between what a printer holds and the order it is for was worked out afterwards,
 * by SKU, and shared between orders by a rule. That is the best that can be done for the 489 lines
 * already placed, none of which names a sales order. For every line placed from now on it is a fact:
 * forOrders: [{ orderNo, qty }], decided once, at the moment of ordering, against the orders that were
 * open and not yet covered — and it does not move when a newer order arrives.
 *
 * Also: the console's export carries the vendor columns the screen has.
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

/* ---- 1. the allocation honours a stamp before it deals anything ---- */
one(`  const when = r => ptDtMs(r.orderDate) || 0;
  const map = new Map();
  want.forEach((rows, sku) => {
    const open = rows.filter(r => r.open).sort((a, b) => when(a) - when(b));
    const shut = rows.filter(r => !r.open).sort((a, b) => when(b) - when(a));
    const chunks = pile.get(sku);
    open.concat(shut).forEach(r => {
      let need = r.qty; const parts = [];
      for (const c of chunks) {
        if (!(need > 0)) break;
        if (!(c.left > 0)) continue;
        const take = Math.min(need, c.left), back = Math.min(take, c.backLeft);
        c.left -= take; c.backLeft -= back; need -= take;
        parts.push({ vendorCode: c.vendorCode, vpo: c.vpo, service: c.service, qty: take, back, due: c.due });
      }
      if (!parts.length) return;
      map.set(r.orderNo + '|' + r.sku, { given: parts.reduce((t, p) => t + p.qty, 0), back: parts.reduce((t, p) => t + p.back, 0),
        parts, shared: rows.length > 1 });
    });
  });`,
`  const when = r => ptDtMs(r.orderDate) || 0;
  const map = new Map();
  want.forEach((rows, sku) => {
    const open = rows.filter(r => r.open).sort((a, b) => when(a) - when(b));
    const shut = rows.filter(r => !r.open).sort((a, b) => when(b) - when(a));
    const chunks = pile.get(sku), partsOf = new Map();
    const give = (r, c, take, stamped) => { const back = Math.min(take, c.backLeft);
      c.left -= take; c.backLeft -= back;
      if (!partsOf.has(r)) partsOf.set(r, []);
      partsOf.get(r).push({ vendorCode: c.vendorCode, vpo: c.vpo, service: c.service, qty: take, back, due: c.due, stamped }); };
    /* WHAT WAS WRITTEN DOWN COMES FIRST. A line placed since 2026-09-19 names the orders it is for, and
     * that is a fact, not a share: it is honoured before anything is dealt, and no rule can move it. A
     * stamp for an order that has since left the book goes back into the pile rather than vanishing. */
    chunks.forEach(c => (c.forOrders || []).forEach(f => {
      const r = rows.find(x => x.orderNo === obUC(f.orderNo)), take = Math.min(parseFloat(f.qty) || 0, c.left);
      if (r && take > 0) give(r, c, take, true);
    }));
    const held = r => (partsOf.get(r) || []).reduce((t, p) => t + p.qty, 0);
    open.concat(shut).forEach(r => {
      let need = r.qty - held(r);
      for (const c of chunks) {
        if (!(need > 0)) break;
        if (!(c.left > 0)) continue;
        const take = Math.min(need, c.left);
        give(r, c, take, false); need -= take;
      }
    });
    partsOf.forEach((parts, r) => map.set(r.orderNo + '|' + r.sku, {
      given: parts.reduce((t, p) => t + p.qty, 0), back: parts.reduce((t, p) => t + p.back, 0), parts,
      /* Only a WORKED-OUT share is "shared". A stamped one was decided when the order was placed. */
      shared: rows.length > 1 && parts.some(p => !p.stamped) }));
  });`, 'stamps first, then the dealing');

one(`        left: qty, backLeft: Math.min(back, qty), at: ptDtMs(o.orderDate) || Date.parse(o.createdAt || '') || 0,`,
`        left: qty, backLeft: Math.min(back, qty), at: ptDtMs(o.orderDate) || Date.parse(o.createdAt || '') || 0,
        forOrders: Array.isArray(l.forOrders) ? l.forOrders : [],`, 'the pile carries the stamps');

/* ---- 2. stamping at placement ---- */
one(`/** One order line's share — null when no vendor holds anything for it. */`,
`/**
 * WHICH SALES ORDERS A NEW VENDOR LINE IS FOR — decided once, as the order is placed.
 *
 * Each cut line's pieces go to the OPEN orders wanting that SKU, oldest first, and only as far as each
 * still needs: what vendors already hold for an order (stamped or worked out) comes off its need first,
 * so a second order for the same SKU stamps the NEXT order, not the first one again. Pieces no open
 * order wants are left unstamped — they are still real, and the sharing rule accounts for them.
 * Returns the lines with forOrders added; a line that already carries one is left exactly as it is.
 */
function voStampOrders(lines) {
  const taken = new Map();                                  // order line → pieces this very order has already given it
  const when = r => ptDtMs(r.orderDate) || 0;
  return (lines || []).map(l => {
    if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || (Array.isArray(l.forOrders) && l.forOrders.length)) return l;
    const sku = obUC(l.sku); let left = parseFloat(l.qty) || 0;
    if (!sku || !(left > 0)) return l;
    const forOrders = [];
    ordLines().filter(r => r.sku === sku && r.open).sort((a, b) => when(a) - when(b)).forEach(r => {
      if (!(left > 0)) return;
      const k = r.orderNo + '|' + r.sku, v = ordVendorOf(r.orderNo, r.sku);
      const need = r.qty - (r.printer ? r.qty : (v ? v.given : 0)) - (taken.get(k) || 0);
      const take = Math.min(left, need);
      if (!(take > 0)) return;
      forOrders.push({ orderNo: r.orderNo, qty: take }); taken.set(k, (taken.get(k) || 0) + take); left -= take;
    });
    return forOrders.length ? Object.assign({}, l, { forOrders }) : l;
  });
}

/** One order line's share — null when no vendor holds anything for it. */`, 'voStampOrders');

one(`    lines: VOF.lines.map(l => Object.assign({}, l)),
    createdBy: ME.email, createdAt: now,
  };
  if (VOF.kind === 'cut') order.demandSource = 'bulk';`,
`    lines: VOF.lines.map(l => Object.assign({}, l)),
    createdBy: ME.email, createdAt: now,
  };
  if (VOF.kind === 'cut') order.demandSource = 'bulk';
  /* EVERY LINE SAYS WHICH SALES ORDERS IT IS FOR. The order book is needed to say it; if it cannot be
   * read the order is still placed — an unstamped line is shared out by rule, as every older one is —
   * because refusing to order cloth over a missing annotation would be the wrong way round. */
  try { if (!PTG.ob) await ptLoadGates(); order.lines = voStampOrders(order.lines); } catch (e) { /* placed unstamped */ }`, 'a placed order is stamped');

one(`    lines: lines.map(l => Object.assign({}, l)),
    /* Raised by the person who asked; the approval is recorded beside it, not over it. */`,
`    lines: (() => { try { return voStampOrders(lines.map(l => Object.assign({}, l))); } catch (e) { return lines.map(l => Object.assign({}, l)); } })(),
    /* Raised by the person who asked; the approval is recorded beside it, not over it. */`, 'an approved request is stamped');

/* ---- 3. the screen says which it is ---- */
one("              + `<div class=\"muted\" style=\"font-size:11px\">${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}${v.shared ? ' · shared' : ''}</div></span>`",
    "              + `<div class=\"muted\" style=\"font-size:11px\">${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}${v.shared ? ' · shared' : (v.parts.every(p => p.stamped) ? ' · for this order' : '')}</div></span>`",
    'the cell says stamped or shared');
one("          + (p.due ? ' · promised ' + esc(p.due) : '')) : []);",
    "          + (p.due ? ' · promised ' + esc(p.due) : '') + (p.stamped ? ' · <b>placed for this order</b>' : '')) : []);", 'the journey says so too');

/* ---- 4. the export carries what the screen shows ---- */
one(`    'Cut %', 'Issued', 'Received', 'Pressed', 'To cut', 'To make', 'Status', 'Printer', 'Printed'].map(csvCell).join(',')];
  rows.forEach(r => lines.push([r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size,
    r.qty, r.cutReq ? r.cut : '', r.cutReq ? r.cutPct.toFixed(1) : '', r.issued, r.received, r.pressed,
    r.pendingCut, r.pendingMake, r.open ? 'Open' : 'Complete', r.printer ? voName(r.printer) : '', r.printer ? r.printed : ''].map(csvCell).join(',')));`,
`    'Cut %', 'Issued', 'Received', 'Pressed', 'To cut', 'To make', 'Status', 'Printer', 'Printed',
    /* What the vendors hold for the line, as the screen shows it — one column each, because a spreadsheet
     * is filtered on "with vendor" and "waiting at", not read a cell at a time. */
    'Vendor', 'Given to vendor', 'Back from vendor', 'Not given', 'Vendor orders', 'Promised', 'How linked', 'Waiting at'].map(csvCell).join(',')];
  rows.forEach(r => { const v = ordVendorOf(r.orderNo, r.sku);
    lines.push([r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size,
    r.qty, r.cutReq ? r.cut : '', r.cutReq ? r.cutPct.toFixed(1) : '', r.issued, r.received, r.pressed,
    r.pendingCut, r.pendingMake, r.open ? 'Open' : 'Complete', r.printer ? voName(r.printer) : '', r.printer ? r.printed : '',
    v ? [...new Set(v.parts.map(p => voName(p.vendorCode)))].join(' + ') : '', v ? v.given : '', v ? v.back : '',
    v ? Math.max(0, r.qty - v.given) : '', v ? [...new Set(v.parts.map(p => p.vpo))].join(' ') : '',
    v ? [...new Set(v.parts.map(p => p.due).filter(Boolean))].join(' ') : '',
    v ? (v.shared ? 'shared by SKU' : (v.parts.every(p => p.stamped) ? 'placed for this order' : 'only order for this SKU')) : '',
    ordWaitingAt(r)].map(csvCell).join(',')); });`, 'the export');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
