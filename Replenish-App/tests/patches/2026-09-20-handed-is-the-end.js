/* HANDED OVER IS THE END — THERE IS NO WORK OUTSTANDING ON A LINE WHOSE GOODS HAVE GONE.
 *
 * 334 Shopify lines have been taken by the shipping team. 46 of them still showed work in the
 * registers, and 37 had nothing recorded at all — pieces made and sent in September before anybody
 * entered them. The console counted those as "still to cut" and "still to make", which asks the floor
 * to make pieces that are already with a customer.
 *
 * SO THE FIGURES GO TO ZERO, AND THE HOLE DOES NOT. The gap between what was ordered and what the
 * registers recorded is carried as `unrecorded` on the line, shown on its row and counted in a tile of
 * its own. Hiding it would be the shortcut; naming it is the opposite.
 *
 * AND NO SHORTCUT IS OPENED. This is not a way to declare a line done: the only thing that sets
 * handedAt is spHandover, which already refuses a line with nothing received and refuses one whose
 * pieces are not pressed. A line cannot reach this state today without the entries — the 37 that did
 * were handed over before that guard existed, and every one of them is from 2026-09.
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

/* ---- 1. the line ---- */
one(`      open: shp0 ? !spHanded(shp0) : pressed < l.qty,
    });
  }).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));`,
`      open: shp0 ? !spHanded(shp0) : pressed < l.qty,
    });
  }).map(l => {
    /* HANDED OVER IS THE END. The goods are with a customer, so nothing on this line is outstanding
     * whatever the registers say — leaving it in "still to make" asks the floor to make pieces that
     * have gone. What the registers never recorded is not swept away with it: it is carried here, shown
     * on the row and counted in its own tile, because a register hole is worth seeing. */
    if (!l.handedAt) return Object.assign(l, { unrecorded: 0 });
    return Object.assign(l, { unrecorded: Math.max(0, l.qty - l.made),
      pendingCut: 0, pendingMake: 0, madeToPress: 0 });
  }).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));`, 'a handed line has nothing outstanding');

/* ---- 2. a tile of its own, on both views ---- */
one(`  pendingMake: { label: 'Still to make', of: r => r.pendingMake },
  madeToPress: { label: 'Made, to press', of: r => r.madeToPress },
};`,
`  pendingMake: { label: 'Still to make', of: r => r.pendingMake },
  madeToPress: { label: 'Made, to press', of: r => r.madeToPress },
  /* SENT WITHOUT A RECORD OF BEING MADE. Not outstanding work — the pieces have gone — but a hole in
   * the registers, and the one number that says how big it is. Clicking it shows exactly those lines. */
  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded },
};`, 'the tile');

one(`  const colour = { received: '#166534', overRecv: '#7f6000', pressed: '#166534', pendingMake: 'var(--bad)', madeToPress: '#7f6000' };`,
`  const colour = { received: '#166534', overRecv: '#7f6000', pressed: '#166534', pendingMake: 'var(--bad)', madeToPress: '#7f6000', unrecorded: '#7f6000' };`, 'its colour');

one(`    const tip = key === 'overRecv' ? ODK_OVER.replace(/^ title="|"$/g, '') + ' — ' : '';`,
`    const tip = key === 'overRecv' ? ODK_OVER.replace(/^ title="|"$/g, '') + ' — '
      : (key === 'unrecorded' ? 'Handed to shipping with no record of being cut, issued or received. The pieces '
        + 'have gone, so they are not counted as work outstanding — this is what the registers are missing. ' : '');`, 'its tooltip');

/* ---- 3. the row says so ---- */
one(`    const status = r.handedAt ? \`<span class="pill pill-ok" title="\${esc(r.handedBy || '')} · \${esc(ptIsoDate(r.handedAt) || '')}">Handed over</span>\``,
`    const status = r.handedAt ? \`<span class="pill pill-ok" title="\${esc(r.handedBy || '')} · \${esc(ptIsoDate(r.handedAt) || '')}">Handed over</span>\`
        + (r.unrecorded ? \`<div><span class="pill pill-low" title="\${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
          + ' piece(s) were sent with nothing in the registers to say they were made. The goods have gone, so they are not work '
          + 'outstanding — but the entry is missing.')}">\${nf(r.unrecorded)} never recorded</span></div>\` : '')\``, 'the Shopify row');

/* The order book shows the same lines, so it says it there too. */
one(`      + (odrPendingOf(r.orderNo, r.sku)
        ? \`<div><span class="pill pill-out" title="\${esc('Asked by ' + String(odrPendingOf(r.orderNo, r.sku).by || '').split('@')[0] + ': ' + (odrPendingOf(r.orderNo, r.sku).why || ''))}">delete asked</span></div>\``,
`      + (r.unrecorded ? \`<div><span class="pill pill-low" title="\${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
        + ' piece(s) were handed to shipping with nothing in the registers to say they were made.')}">\${nf(r.unrecorded)} never recorded</span></div>\` : '')
      + (odrPendingOf(r.orderNo, r.sku)
        ? \`<div><span class="pill pill-out" title="\${esc('Asked by ' + String(odrPendingOf(r.orderNo, r.sku).by || '').split('@')[0] + ': ' + (odrPendingOf(r.orderNo, r.sku).why || ''))}">delete asked</span></div>\``, 'the order book row');

/* ---- 4. and where the line is waiting ---- */
one(`  if (!r.open) return (r.handedAt ? 'Handed over' : 'Complete') + tail;`,
`  if (!r.open) return (r.handedAt ? 'Handed over' + (r.unrecorded ? ' · ' + nf(r.unrecorded) + ' never recorded' : '') : 'Complete') + tail;`, 'the journey says it too');

/* ---- 5. the exports carry it ---- */
one(`    'Into store', 'In store now', 'To FBA', 'FBA not yet shipped', 'Waiting at'].map(csvCell).join(',')];`,
`    'Into store', 'In store now', 'To FBA', 'FBA not yet shipped', 'Sent never recorded', 'Waiting at'].map(csvCell).join(',')];`, 'the book export head');
one(`    (g => g ? [g.in, g.store, g.fba, g.fbaOpen] : ['', '', '', ''])(ordFgAt(r.orderNo, r.sku)),
    ordWaitingAt(r)].flat().map(csvCell).join(',')); });`,
`    (g => g ? [g.in, g.store, g.fba, g.fbaOpen] : ['', '', '', ''])(ordFgAt(r.orderNo, r.sku)),
    r.unrecorded || '', ordWaitingAt(r)].flat().map(csvCell).join(',')); });`, 'the book export row');

one(`          'To make', 'Shopify orders', 'Needs master row'].map(csvCell).join(',')]`,
`          'To make', 'Shopify orders', 'Needs master row'].map(csvCell).join(',')]`, 'by-SKU export head unchanged');
one(`          'With vendor', 'Back from vendor', 'Handed over', 'Waiting at'].map(csvCell).join(',')];`,
`          'With vendor', 'Back from vendor', 'Handed over', 'Sent never recorded', 'Waiting at'].map(csvCell).join(',')];`, 'the Shopify export head');
one(`        v ? v.given : '', v ? v.back : '', r.handedAt ? ptIsoDate(r.handedAt) : '', ordWaitingAt(r)].map(csvCell).join(','))(`,
`        v ? v.given : '', v ? v.back : '', r.handedAt ? ptIsoDate(r.handedAt) : '', r.unrecorded || '', ordWaitingAt(r)].map(csvCell).join(','))(`, 'the Shopify export row');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
