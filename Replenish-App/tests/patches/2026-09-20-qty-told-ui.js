/* The news, where the work is: a pill on the line, a tile that counts what nobody has looked at, a
 * red line at the top while any of it is unseen, and a Seen button that closes the loop. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the tile ---- */
one(`  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded },
};`,
`  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded },
  /* A QUANTITY SOMEBODY MOVED AND NOBODY HERE HAS READ. Not pieces — changes: one line whose figure
   * moved twice is two things to read, and the number people act on is how many are waiting. */
  qtyChanged: { label: 'Quantity changed', of: r => ordQtyUnseen(r.orderNo, r.sku).length },
};`, 'the tile');

one(`  const colour = { received: '#166534', overRecv: '#7f6000', pressed: '#166534', pendingMake: 'var(--bad)', madeToPress: '#7f6000', unrecorded: '#7f6000' };`,
`  const colour = { received: '#166534', overRecv: '#7f6000', pressed: '#166534', pendingMake: 'var(--bad)', madeToPress: '#7f6000', unrecorded: '#7f6000', qtyChanged: '#b45309' };`, 'its colour');

one(`      : (key === 'unrecorded' ? 'Handed to shipping with no record of being cut, issued or received. The pieces '
        + 'have gone, so they are not counted as work outstanding — this is what the registers are missing. ' : '');`,
`      : (key === 'unrecorded' ? 'Handed to shipping with no record of being cut, issued or received. The pieces '
        + 'have gone, so they are not counted as work outstanding — this is what the registers are missing. '
      : (key === 'qtyChanged' ? 'The quantity on the sales order was changed after it was approved, and nobody '
        + 'here has said they have seen it. Click to see only those lines. ' : ''));`, 'its tooltip');

/* ---- 2. the pill on the line, and the Seen button ---- */
one(`      + (r.unrecorded ? \`<div><span class="pill pill-low" title="\${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
        + ' piece(s) were handed to shipping with nothing in the registers to say they were made.')}">\${nf(r.unrecorded)} never recorded</span></div>\` : '')`,
`      + (r.unrecorded ? \`<div><span class="pill pill-low" title="\${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
        + ' piece(s) were handed to shipping with nothing in the registers to say they were made.')}">\${nf(r.unrecorded)} never recorded</span></div>\` : '')
      /* THE QUANTITY MOVED, SAID WHERE THE WORK IS DONE. It was written on the sales order, and
       * nobody on this floor opens one. */
      + ordQtyAdj(r.orderNo, r.sku).slice(0, 3).map(a => \`<div><span class="pill"\`
        + \` style="background:\${a.seenAt ? 'var(--chip)' : '#fef3c7'};color:\${a.seenAt ? 'var(--muted)' : '#7c2d12'};border:1px solid \${a.seenAt ? 'var(--line)' : '#fbbf24'}"\`
        + \` title="\${esc('Changed by ' + String(a.by || '').split('@')[0] + ' on ' + (ptIsoDate(a.at) || '')
          + (a.why ? ' — ' + a.why : '') + (a.via === 'sheet' ? ' (from a sheet)' : '')
          + (a.seenAt ? '. Seen by ' + String(a.seenBy || '').split('@')[0] + ' on ' + (ptIsoDate(a.seenAt) || '') + '.' : '. Nobody here has said they have seen it.'))}">\`
        + \`qty \${ordQtyPill(a)}</span>\`
        + (a.seenAt ? '' : \` <a href="#" data-ordseen="\${esc(a.orderNo)}|\${esc(a.id)}" style="font-size:10.5px">Seen</a>\`)
        + '</div>').join('')`, 'the pill and the Seen link');

/* ---- 3. the red line at the top ---- */
one(`  $('odMsg').className = 'muted';
  $('odMsg').textContent = \`\${nf(rows.length)} \${bySku ? 'SKU' : 'line'}(s) of \${nf(src.length)}\``,
`  /* SAID AT THE TOP, NOT ONLY ON THE ROW. A pill halfway down a table of 1,300 lines is not news. */
  const unseen = ordQtyUnseenAll();
  $('odMsg').className = unseen.length ? 'err' : 'muted';
  $('odMsg').innerHTML = (unseen.length
    ? '<b>' + nf(unseen.length) + ' quantit' + (unseen.length > 1 ? 'ies were' : 'y was') + ' changed on an order'
      + ' and nobody here has said they have seen it</b> — ' + esc(unseen.slice(0, 3).map(a =>
        a.orderNo + ' ' + a.sku + ' ' + ordQtyPill(a)).join(', '))
      + (unseen.length > 3 ? ' and ' + nf(unseen.length - 3) + ' more' : '')
      + '. Press the "Quantity changed" tile to see them. · ' : '')
    + esc(ORD.adjErr ? 'The quantity changes could not be read (' + ORD.adjErr + '), so the pills are missing. · ' : '');
  $('odMsg').textContent = ($('odMsg').textContent || '') + \`\${nf(rows.length)} \${bySku ? 'SKU' : 'line'}(s) of \${nf(src.length)}\``, 'the red line at the top');

/* ---- 4. the Seen link ---- */
one(`$('odKpis').addEventListener('click', ordKpiClick);`,
`/* SOMEBODY ON THE FLOOR SAYS THEY SAW IT, and the person who changed the figure can read that back
 * on the order. Delivered and read are different things. */
$('odTable').addEventListener('click', async e => {
  const a = e.target.closest('[data-ordseen]');
  if (!a) return;
  e.preventDefault();
  const [orderNo, logId] = a.getAttribute('data-ordseen').split('|');
  const err = await ordQtySeen(orderNo, logId);
  if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; return; }
  renderOrd();
});

$('odKpis').addEventListener('click', ordKpiClick);`, 'the Seen link');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
