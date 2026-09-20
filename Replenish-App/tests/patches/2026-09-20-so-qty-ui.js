/* The screen for it: a Change button on the SKU, a dialog that shows what would happen before it
 * happens, and the changes written down where the order is read. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the column and the button ---- */
one(`  const head = ['SKU', 'Image', 'Qty', 'Cut', 'Made', 'Owed', 'Delivery', 'Priority', 'In order book']
    .map((h, i) => \`<th\${i >= 2 && i <= 5 ? ' class="num"' : ''}>\${h}</th>\`).join('');`,
`  /* WHO MAY MOVE A QUANTITY: whoever approved the order in the first place. */
  const mayQty = soCanApprove() && soStatus(o) === 'approved';
  const head = ['SKU', 'Image', 'Qty', 'Cut', 'Made', 'Owed', 'Delivery', 'Priority', 'In order book']
    .concat(mayQty ? [''] : [])
    .map((h, i) => \`<th\${i >= 2 && i <= 5 ? ' class="num"' : ''}>\${h}</th>\`).join('');`, 'the column');

one(`      + \`<td style="font-weight:700;color:\${g.inBook ? 'var(--accent)' : 'var(--bad)'}">\${g.inBook ? 'yes' : 'NO'}</td></tr>\`;
  }).join('');`,
`      + \`<td style="font-weight:700;color:\${g.inBook ? 'var(--accent)' : 'var(--bad)'}">\${g.inBook ? 'yes' : 'NO'}</td>\`
      + (mayQty ? \`<td><button class="ghost" data-so-qty="\${esc(o._id)}|\${esc(g.sku)}" style="padding:3px 9px;font-size:12px">Change qty</button></td>\` : '')
      + '</tr>';
  }).join('');`, 'the button');

/* ---- 2. what has already been changed, said where the order is read ---- */
one(`      + (removed ? \` \${nf(removed)} line(s) were removed from this order after it was raised.\` : '')
      + (o.saRemarks ? \` Remarks: \${o.saRemarks}\` : ''),`,
`      + (removed ? \` \${nf(removed)} line(s) were removed from this order after it was raised.\` : '')
      + (adj.length ? \` \${nf(adj.length)} quantit\${adj.length > 1 ? 'ies were' : 'y was'} changed after approval.\` : '')
      + (o.saRemarks ? \` Remarks: \${o.saRemarks}\` : ''),`, 'the note counts them');

one(`  const removed = (Array.isArray(o.lineRemovals) ? o.lineRemovals : Object.values(o.lineRemovals || {}))
    .filter(Boolean).reduce((n, r) => n + (parseInt(r.count, 10) || soCount(r.lines)), 0);`,
`  const removed = (Array.isArray(o.lineRemovals) ? o.lineRemovals : Object.values(o.lineRemovals || {}))
    .filter(Boolean).reduce((n, r) => n + (parseInt(r.count, 10) || soCount(r.lines)), 0);
  /* EVERY QUANTITY THAT MOVED, newest first. A figure that changed and cannot be explained three
   * weeks later is the reason this is kept at all. */
  const adj = Object.values(o.qtyAdjustments || {}).filter(Boolean)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));`, 'the log is read');

one(`      + (s.groups.length > 400 ? \`<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 400 of \${nf(s.groups.length)} SKUs. Export gives you all of them.</div>\` : ''),`,
`      + (s.groups.length > 400 ? \`<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 400 of \${nf(s.groups.length)} SKUs. Export gives you all of them.</div>\` : '')
      + (adj.length ? '<div style="margin-top:10px;font-weight:600;font-size:13px">Quantities changed after approval</div>'
        + '<table class="xl" style="margin-top:4px"><thead><tr><th>When</th><th>SKU</th><th class="num">From</th><th class="num">To</th><th>Why</th><th>By</th></tr></thead><tbody>'
        + adj.slice(0, 40).map(a => \`<tr><td style="text-align:left">\${esc(ptIsoDate(a.at) || '')}</td>\`
          + \`<td style="text-align:left;font-family:ui-monospace,monospace">\${esc(a.sku)}</td>\`
          + \`<td class="num">\${nf(a.from)}</td>\`
          + \`<td class="num" style="font-weight:700;color:\${a.to > a.from ? '#166534' : 'var(--bad)'}">\${nf(a.to)}</td>\`
          + \`<td style="text-align:left">\${esc(a.why || '')}</td>\`
          + \`<td>\${esc(String(a.by || '').split('@')[0])}</td></tr>\`).join('')
        + '</tbody></table>' : ''),`, 'the log is shown');

/* ---- 3. the dialog ---- */
one(`$('sxTable').addEventListener('click', e => {`,
`/**
 * THE DIALOG. Everything the decision needs is on it before the number is typed: what the order says
 * now, what the factory has already done against it, what the order book carries, and the figure it
 * cannot go below.
 */
function soQtyOpen(id, sku) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return;
  const now = soQtyOf(o, sku);
  const done = soDoneOn(o._id, sku);
  const book = (PTG.ob || []).find(r => r && r.id === soBookId(o._id, sku));
  const lines = soLinesOf(o, sku);
  ptOpenDialog({
    title: 'Change the quantity — ' + sku,
    subtitle: 'Sales order ' + o._id + (o.buyerName ? '  ·  ' + o.buyerName : ''),
    note: \`On the order now: \${nf(now)} piece(s)\${lines.length > 1 ? ' over ' + nf(lines.length) + ' lines' : ''}. \`
      + \`Already cut \${nf(done.cut)}, received \${nf(done.made)}, pressed \${nf(done.pressed)}. \`
      + (done.floor ? \`It cannot go below \${nf(done.floor)} — those pieces exist. \` : 'Nothing has been made yet, so it can go to zero. ')
      + (book ? \`The order book carries \${nf(parseFloat(book.qty) || 0)} and moves with it.\`
        : 'This SKU never reached the order book, so only the sales order changes — use "Add the missing" to put it there.')
      + (lines.length > 1 ? ' Extra goes on the latest delivery date; a cut comes off the latest first.' : ''),
    fields: [
      { key: 'qty', label: 'New quantity', type: 'number', step: '1', min: done.floor, value: now },
      { key: 'why', label: 'Why it is changing', value: '', span: true },
    ],
    saveLabel: 'Change it',
    onSave: async v => {
      const err = await soQtyRun(o, sku, v.qty, v.why);
      if (err) return err;
      renderSox();
      $('sxMsg').className = 'muted';
      $('sxMsg').textContent = sku + ' on ' + o._id + ' is now ' + nf(parseFloat(v.qty) || 0)
        + ' piece(s), and the order book says the same.';
      return '';
    },
  });
}

$('sxTable').addEventListener('click', e => {`, 'the dialog');

/* ---- 4. wired from inside the order dialog ---- */
one(`$('ptDlgBody').addEventListener('click', e => {
  const del = e.target.closest('[data-sofdel]');`,
`$('ptDlgBody').addEventListener('click', e => {
  /* The SKU table lives inside the order's own dialog, so this one replaces it with the quantity
   * dialog and the order is reopened underneath when that is done with. */
  const q = e.target.closest('[data-so-qty]');
  if (q) { const [id, sku] = q.getAttribute('data-so-qty').split('|'); return soQtyOpen(id, sku); }
  const del = e.target.closest('[data-sofdel]');`, 'wired from the order dialog');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
