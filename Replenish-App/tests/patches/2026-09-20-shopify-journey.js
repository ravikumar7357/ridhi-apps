/* THE SAME END TO END, FOR A SHOPIFY ORDER — whose end is a different one.
 *
 * A Shopify line goes ordered → printed → cut → issued → received → QC → pressed → HANDED TO SHIPPING.
 * It does not normally pass through the finished-goods store at all: 26 of its 432 SKUs ever reached
 * one, and 13 of 757 ledger rows name a SHP- order. So the last leg is the handover, not FBA — and the
 * journey shows the store only where there is something in it.
 *
 * AND A CORRECTION. When I collapsed ordWaitingAt I said everything after the press check was
 * unreachable, because a line is open only while pressed < ordered. That is true of every line EXCEPT a
 * Shopify one: those stay open until the shipping team takes them (open: !spHanded). So that branch is
 * reachable after all, for exactly the orders this change is about, and it now says the right thing.
 *
 * Also: the Shopify view's Printing column had the same fault the order book's had — it knew only a
 * printer put on the line from that screen, and said "not printed" on cloth that was with a vendor.
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

/* ---- 1. where a Shopify line is waiting, and where it ended ---- */
one(`  if (!r.open) return 'Complete' + tail;`,
`  /* HANDED OVER IS THE END OF A SHOPIFY LINE, and it says so by name — "Complete" on its own leaves you
   * wondering whether the goods actually went anywhere. */
  if (!r.open) return (r.handedAt ? 'Handed over' : 'Complete') + tail;`, 'handed over is the end');

one(`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  /* Anything past here can only be reached by figures that contradict each other — a line is open only
   * while pressed < ordered, and getting this far means pressed >= ordered. Saying where the pieces are
   * is still the most useful answer if it ever happens. */
  return tail ? 'Store —' + tail.replace(' · ', ' ') : 'Store / dispatch';`,
`  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  /* A SHOPIFY LINE IS OPEN UNTIL SHIPPING TAKES IT, so it reaches here made and waiting for a person.
   * Every other line is open only while pressed < ordered, which means nothing past the press check can
   * be reached for one — saying where the pieces are is still the most useful answer if it ever is. */
  if (r.src === 'SHP') return 'Ready to hand over to shipping' + tail;
  return tail ? 'Store —' + tail.replace(' · ', ' ') : 'Store / dispatch';`, 'ready to hand over');

/* ---- 2. the journey carries the Shopify end ---- */
one(`  const S = rows.map(stage), sum = f => S.reduce((t, x) => t + (x[f] || 0), 0);
  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')],
    ['In store', sum('store')], ['To FBA', sum('fba')]];`,
`  const S = rows.map(stage), sum = f => S.reduce((t, x) => t + (x[f] || 0), 0);
  /* A SHOPIFY ORDER ENDS AT THE SHIPPING TABLE, not at Amazon, and it does not normally pass through the
   * store — so those two tiles are shown only when they hold something, and the handover takes their
   * place. Tiles for stages an order never has are noise on the one screen meant to answer "where is it". */
  const shop = rows.some(r => r.src === 'SHP');
  const handed = rows.filter(r => r.handedAt).reduce((t, r) => t + r.qty, 0);
  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')]]
    .concat(shop && !sum('store') && !sum('fba') ? [] : [['In store', sum('store')], ['To FBA', sum('fba')]])
    .concat(shop ? [['Handed over', handed]] : []);`, 'the journey tiles');

one(`  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To FBA', 'Waiting at']
    .map((h, i) => \`<th\${i >= 2 && i <= 11 ? ' class="num"' : ''}>\${h}</th>\`).join('');`,
`  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To FBA']
    .concat(shop ? ['Handed over'] : []).concat(['Waiting at'])
    .map((h, i) => \`<th\${i >= 2 && i <= (shop ? 12 : 11) ? ' class="num"' : ''}>\${h}</th>\`).join('');`, 'the journey head');

one(`      + \`<td class="num">\${x.fba ? \`<span style="color:#166534">\${nf(x.fba)}</span>\` : '<span class="muted">—</span>'}</td>\``,
`      + \`<td class="num">\${x.fba ? \`<span style="color:#166534">\${nf(x.fba)}</span>\` : '<span class="muted">—</span>'}</td>\`
      + (!shop ? '' : \`<td class="num"\${r.handedAt ? \` title="\${esc(String(r.handedBy || '').split('@')[0] + ' · ' + (ptIsoDate(r.handedAt) || ''))}"\` : ''}>\`
          + (r.handedAt ? \`<b style="color:#166534">\${nf(r.qty)}</b>\` : '<span class="muted">—</span>') + '</td>')`, 'the journey row');

one(`    subtitle: \`\${first.orderDate || '—'}\${first.shopOrderNo ? '  ·  Shopify ' + first.shopOrderNo : ''}  ·  \${nf(rows.length)} line(s), \${nf(openN)} still open\`,`,
`    subtitle: \`\${first.orderDate || '—'}\${first.shopOrderNo ? '  ·  Shopify ' + first.shopOrderNo : ''}  ·  \${nf(rows.length)} line(s), \${nf(openN)} still open\`
      + (shop ? \`  ·  \${nf(rows.filter(r => r.handedAt).length)} of \${nf(rows.length)} handed to shipping\` : ''),`, 'the journey subtitle');

/* ---- 3. the Shopify by-order table ---- */
one(`    : ['Order No', 'Shopify', 'Date', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];`,
`    /* RECEIVED AND QC were missing from the sequence: "issued 5, pressed 0, to make 5" does not say
     * whether the karigar ever brought them back. */
    : ['Order No', 'Shopify', 'Date', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Pieces', 'Printing', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'To make', 'Quilt team', 'Status', 'Entry'];`, 'the by-order head');

one(`  const numFrom = bySku ? 6 : 9, numTo = bySku ? 11 : 14;`,
`  /* THE NUMERIC RUN ENDS AT "To make" ON BOTH. Adding a column inside it and leaving these alone leaves
   * every heading after it over the wrong cells. */
  const numFrom = bySku ? 6 : 9, numTo = bySku ? 12 : 16;`, 'the numeric run');

one(`      + \`<td\${spPick ? '' : ' class="frz"'} style="text-align:left">\${esc(r.orderNo)}</td>\`
      + \`<td style="text-align:left">\${esc(r.shopOrderNo) || '<span class="muted">—</span>'}\``,
`      + \`<td\${spPick ? '' : ' class="frz"'} style="text-align:left"><a href="#" data-ordj="\${esc(r.orderNo)}" title="This order, start to finish" style="color:inherit;text-decoration:underline dotted">\${esc(r.orderNo)}</a></td>\`
      + \`<td style="text-align:left">\${esc(r.shopOrderNo) || '<span class="muted">—</span>'}\``, 'the order number is a link');

one(`      + \`<td style="text-align:left;font-size:12px">\${r.printer
          ? \`<b>\${nf(r.printed)}</b> <span class="muted">of \${nf(r.qty)}</span>\`
            + \`<div class="muted" style="font-size:11px">\${esc(voName(r.printer))}</div>\`
          : '<span class="muted">not printed</span>'}</td>\`
      + \`<td class="num">\${nf(r.cut)}</td><td class="num">\${nf(r.issued)}</td>\`
      + \`<td class="num" style="color:#166534">\${nf(r.pressed)}</td>\``,
`      /* THE SAME FAULT THE ORDER BOOK HAD: this knew only a printer put on the line from this screen, and
       * said "not printed" on cloth that had been with a vendor for a week. */
      + \`<td style="text-align:left;font-size:12px">\${r.printer
          ? \`<b>\${nf(r.printed)}</b> <span class="muted">of \${nf(r.qty)}</span>\`
            + \`<div class="muted" style="font-size:11px">\${esc(voName(r.printer))}</div>\`
          : (v => (v
            ? \`<b>\${nf(v.back)}</b> <span class="muted">back of \${nf(v.given)}</span>\`
              + \`<div class="muted" style="font-size:11px">\${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}\${v.shared ? ' · shared' : ''}</div>\`
            : '<span class="muted">not given to a vendor</span>'))(ordVendorOf(r.orderNo, r.sku))}</td>\`
      + \`<td class="num">\${nf(r.cut)}</td><td class="num">\${nf(r.issued)}</td>\`
      + \`<td class="num"\${r.overRecv ? ' style="color:#7f6000;font-weight:700"' : ''}>\${nf(r.received)}</td>\`
      + (q => \`<td class="num">\` + (q
          ? \`<span style="color:#166534;font-weight:700">\${nf(q.ok)}</span>\`
            + (q.rej ? \` <span style="color:var(--bad)">\${nf(q.rej)} ✗</span>\` : '')
          : '<span class="muted">—</span>') + '</td>')(ordQcOf(r.orderNo, r.sku))
      + \`<td class="num" style="color:#166534">\${nf(r.pressed)}</td>\``, 'the by-order cells');

/* ---- 4. the by-SKU table ---- */
one(`    ? ['SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Pressed', 'To make', 'Shopify orders']`,
`    ? ['SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Received', 'Pressed', 'To make', 'Shopify orders']`, 'the by-SKU head');

one(`      + \`<td class="num">\${nf(r.cut)}</td><td class="num">\${nf(r.issued)}</td>\`
      + \`<td class="num" style="color:#166534">\${nf(r.pressed)}</td>\`
      + \`<td class="num"\${r.pendingMake ? ' style="color:var(--bad);font-weight:700"' : ''}>\${r.pendingMake ? nf(r.pendingMake) : '<span class="muted">—</span>'}</td>\`
      + \`<td style="text-align:left;white-space:normal;max-width:320px;font-size:12px">\${chips}</td></tr>\`;`,
`      + \`<td class="num">\${nf(r.cut)}</td><td class="num">\${nf(r.issued)}</td>\`
      + \`<td class="num"\${r.overRecv ? ' style="color:#7f6000;font-weight:700"' : ''}>\${nf(r.received)}</td>\`
      + \`<td class="num" style="color:#166534">\${nf(r.pressed)}</td>\`
      + \`<td class="num"\${r.pendingMake ? ' style="color:var(--bad);font-weight:700"' : ''}>\${r.pendingMake ? nf(r.pendingMake) : '<span class="muted">—</span>'}</td>\`
      + \`<td style="text-align:left;white-space:normal;max-width:320px;font-size:12px">\${chips}</td></tr>\`;`, 'the by-SKU cells');

/* Each order chip opens that order, the same as the number on the other view. */
one(`    const chips = sortedOrders.slice(0, 6)
      .map(o => \`<span title="\${esc(o.no)}\${o.adj ? ' · ' + esc(o.adj) : ''} — \${nf(o.qty)} piece(s)\${o.open ? '' : ', done'}">\`
        + \`\${esc(o.shop || o.no)}<span class="muted">&times;\${nf(o.qty)}</span></span>\`).join(', ')`,
`    const chips = sortedOrders.slice(0, 6)
      .map(o => \`<a href="#" data-ordj="\${esc(o.no)}" style="color:inherit;text-decoration:underline dotted" title="\${esc(o.no)}\${o.adj ? ' · ' + esc(o.adj) : ''} — \${nf(o.qty)} piece(s)\${o.open ? '' : ', done'} — click for this order start to finish">\`
        + \`\${esc(o.shop || o.no)}<span class="muted">&times;\${nf(o.qty)}</span></a>\`).join(', ')`, 'the chips are links');

/* ---- 5. the Shopify exports carry the same stages ---- */
one(`      ? [['SKU', 'Priority', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Pressed',
          'To make', 'Shopify orders', 'Needs master row'].map(csvCell).join(',')]
      : [['Order No', 'Shopify Order', 'Adjustment', 'Date', 'SKU', 'Priority', 'Article', 'Subtype', 'Color',
          'Size', 'Pieces', 'Cut', 'Issued', 'Pressed', 'To make', 'Status', 'Printer', 'Printed'].map(csvCell).join(',')];`,
`      ? [['SKU', 'Priority', 'Article', 'Subtype', 'Color', 'Size', 'Orders', 'Pieces', 'Cut', 'Issued', 'Received', 'Pressed',
          'To make', 'Shopify orders', 'Needs master row'].map(csvCell).join(',')]
      : [['Order No', 'Shopify Order', 'Adjustment', 'Date', 'SKU', 'Priority', 'Article', 'Subtype', 'Color',
          'Size', 'Pieces', 'Cut', 'Issued', 'Received', 'QC passed', 'Pressed', 'To make', 'Status', 'Printer', 'Printed',
          'With vendor', 'Back from vendor', 'Handed over', 'Waiting at'].map(csvCell).join(',')];`, 'the Shopify export head');

one(`    rows.forEach(r => out.push(bySku
      ? [r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size, r.orders.length, r.qty, r.cut,
        r.issued, r.pressed, r.pendingMake,
        r.orders.map(o => (o.shop || o.no) + '×' + o.qty).join(' '), r.needsSku ? 'yes' : ''].map(csvCell).join(',')
      : [r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType,
        r.articleSubtype, r.color, r.size, r.qty, r.cut, r.issued, r.pressed, r.pendingMake,
        r.handedAt ? 'Handed over' : (r.open ? 'Open' : 'Complete'),
        r.printer ? voName(r.printer) : '', r.printer ? r.printed : ''].map(csvCell).join(',')));`,
`    rows.forEach(r => out.push(bySku
      ? [r.sku, ordPri(r.sku), r.articleType, r.articleSubtype, r.color, r.size, r.orders.length, r.qty, r.cut,
        r.issued, r.received, r.pressed, r.pendingMake,
        r.orders.map(o => (o.shop || o.no) + '×' + o.qty).join(' '), r.needsSku ? 'yes' : ''].map(csvCell).join(',')
      : ((v, q) => [r.orderNo, r.shopOrderNo || '', r.adjId || '', r.orderDate, r.sku, ordPri(r.sku), r.articleType,
        r.articleSubtype, r.color, r.size, r.qty, r.cut, r.issued, r.received, q ? q.ok : '', r.pressed, r.pendingMake,
        r.handedAt ? 'Handed over' : (r.open ? 'Open' : 'Complete'),
        r.printer ? voName(r.printer) : (v ? [...new Set(v.parts.map(p => voName(p.vendorCode)))].join(' + ') : ''),
        r.printer ? r.printed : '',
        v ? v.given : '', v ? v.back : '', r.handedAt ? ptIsoDate(r.handedAt) : '', ordWaitingAt(r)].map(csvCell).join(','))(
          ordVendorOf(r.orderNo, r.sku), ordQcOf(r.orderNo, r.sku))));`, 'the Shopify export rows');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
