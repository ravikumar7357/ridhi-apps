/* The window Ravi asked for, and a banner that is one line instead of a wall. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. pending, not unseen ---- */
one(`/** The ones nobody on the floor has said they have seen. */
const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => !a.seenAt);
/** Every unseen change across the whole book, newest first — what the banner counts. */
const ordQtyUnseenAll = () => {
  const out = [];
  ordQtyAdjIndex().forEach(l => l.forEach(a => { if (!a.seenAt) out.push(a); }));
  return out.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
};`,
`/** The ones waiting for an answer on this line. */
const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => soQtyStage(a) === 'pending');
/** Every one waiting across the whole book, oldest first — the order they should be answered in. */
const ordQtyUnseenAll = () => {
  const out = [];
  ordQtyAdjIndex().forEach(l => l.forEach(a => { if (soQtyStage(a) === 'pending') out.push(a); }));
  return out.sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')));
};`, 'pending, not unseen');

/* ---- 2. the banner is one line and a button ---- */
one(`  const unseen = ordQtyUnseenAll();
  $('odMsg').className = (unseen.length || orphanTotal) ? 'err' : 'muted';
  $('odMsg').innerHTML = (unseen.length
    ? '<b>' + nf(unseen.length) + ' quantit' + (unseen.length > 1 ? 'ies were' : 'y was')
      + ' changed on an order, and nobody here has said they have seen it</b> — '
      + esc(unseen.slice(0, 3).map(a => a.orderNo + ' ' + a.sku + ' ' + ordQtyPill(a)).join(', '))
      + (unseen.length > 3 ? ' and ' + nf(unseen.length - 3) + ' more' : '')
      + '. The "Quantity changed" tile shows only those lines. · ' : '')
    + (ORD.adjErr ? esc('The quantity changes could not be read (' + ORD.adjErr + '), so the pills are missing. · ') : '')
    + esc(\`\${nf(rows.length)} of \${nf(all.length)} line(s)\``,
`  /* ONE LINE AND A BUTTON. A paragraph of red naming three orders and "and 54 more" is a wall
   * nobody reads — and the answer to it is a window, not a sentence. */
  const unseen = ordQtyUnseenAll();
  $('odMsg').className = orphanTotal ? 'err' : 'muted';
  $('odMsg').innerHTML = (unseen.length
    ? '<button data-ordqtyopen style="padding:3px 10px;font-size:12px;margin-right:8px">'
      + nf(unseen.length) + ' quantity change' + (unseen.length > 1 ? 's' : '') + ' to approve</button>' : '')
    + (ORD.adjErr ? esc('The quantity changes could not be read (' + ORD.adjErr + '). · ') : '')
    + esc(\`\${nf(rows.length)} of \${nf(all.length)} line(s)\``, 'the banner is one line');

/* ---- 3. the pill says it is an ASK while it is one ---- */
one(`      + ordQtyAdj(r.orderNo, r.sku).slice(0, 3).map(a => \`<div><span class="pill"\`
        + \` style="background:\${a.seenAt ? 'var(--chip)' : '#fef3c7'};color:\${a.seenAt ? 'var(--muted)' : '#7c2d12'};border:1px solid \${a.seenAt ? 'var(--line)' : '#fbbf24'}"\`
        + \` title="\${esc('Changed by ' + String(a.by || '').split('@')[0] + ' on ' + (ptIsoDate(a.at) || '')
          + (a.why ? ' — ' + a.why : '') + (a.via === 'sheet' ? ' (from a sheet)' : '')
          + (a.seenAt ? '. Seen by ' + String(a.seenBy || '').split('@')[0] + ' on ' + (ptIsoDate(a.seenAt) || '') + '.' : '. Nobody here has said they have seen it.'))}">\`
        + \`qty \${ordQtyPill(a)}</span>\`
        + (a.seenAt ? '' : \` <a href="#" data-ordseen="\${esc(a.orderNo)}|\${esc(a.id)}" style="font-size:10.5px">Seen</a>\`)
        + '</div>').join('')`,
`      + ordQtyAdj(r.orderNo, r.sku).slice(0, 3).map(a => {
        const st = soQtyStage(a);
        /* WAITING is the loud one: nothing has moved yet and somebody has to answer. Applied is
         * history and rejected is a dead end — both are quiet. */
        const look = st === 'pending' ? 'background:#fef3c7;color:#7c2d12;border:1px solid #fbbf24'
          : (st === 'rejected' ? 'background:var(--chip);color:var(--muted);border:1px solid var(--line);text-decoration:line-through'
          : 'background:var(--chip);color:var(--muted);border:1px solid var(--line)');
        return \`<div><span class="pill" style="\${look}"\`
          + \` title="\${esc('Asked by ' + String(a.by || '').split('@')[0] + ' on ' + (ptIsoDate(a.at) || '')
            + (a.why ? ' — ' + a.why : '') + (a.via === 'sheet' ? ' (from a sheet)' : '')
            + (st === 'pending' ? '. Nothing has moved: it is waiting to be approved here.'
              : (st === 'rejected' ? '. Turned down by ' + String(a.decidedBy || '').split('@')[0]
                + (a.decidedWhy ? ' — ' + a.decidedWhy : '') + '.'
                : '. Approved by ' + String(a.decidedBy || '').split('@')[0] + ' on ' + (ptIsoDate(a.decidedAt) || '') + '.')))}">\`
          + (st === 'pending' ? 'qty asked ' : (st === 'rejected' ? 'qty refused ' : 'qty ')) + ordQtyPill(a) + '</span>'
          + (st === 'pending' ? ' <a href="#" data-ordqtyopen style="font-size:10.5px">Answer</a>' : '')
          + '</div>';
      }).join('')`, 'the pill says what it is');

/* ---- 4. the window ---- */
one(`$('odTable').addEventListener('click', async e => {
  const a = e.target.closest('[data-ordseen]');
  if (!a) return;
  e.preventDefault();
  const [orderNo, logId] = a.getAttribute('data-ordseen').split('|');
  const err = await ordQtySeen(orderNo, logId);
  if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; return; }
  renderOrd();
});`,
`/**
 * THE WINDOW, the way a sales order gets one.
 *
 * Everything the answer needs is on it: what the order says now, what is being asked for, what has
 * already been made against the line — because that is what decides whether it can be granted — who
 * asked and why. Tick and approve, or tick and turn down with a reason.
 */
function ordQtyListOpen() {
  const rows = ordQtyUnseenAll();
  ORD.qtyPick = new Set([...(ORD.qtyPick || [])].filter(k => rows.some(r => r.orderNo + '|' + r.id === k)));
  ptOpenDialog({
    title: 'Quantity changes to approve',
    subtitle: rows.length ? \`\${nf(rows.length)} change(s) the sales team has asked for\` : 'Nothing is waiting',
    note: 'Nothing has moved yet. Approving a change moves the sales order AND the order book together, '
      + 'so the figure you work to changes at that moment and not before. Turning one down needs a reason — '
      + 'the sales team reads it on the order. A change cannot take a line below what has already been '
      + 'cut, received or pressed, and that is checked again now, not when it was asked for.',
    html: rows.length ? \`<div class="xlwrap" style="max-height:44vh"><table class="xl"><thead><tr>
        <th><input type="checkbox" data-ordqty-all style="width:auto;margin:0" title="Tick every change"></th>
        <th>Order</th><th>SKU</th><th class="num">Now</th><th class="num">Asked</th><th class="num">Made so far</th><th>Why</th><th>Asked by</th></tr></thead><tbody>
        \${rows.map(r => {
          const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(r.orderNo));
          const nowQty = o ? soQtyOf(o, r.sku) : r.from;
          const d = soDoneOn(r.orderNo, r.sku);
          const blocked = r.to < d.floor;
          return \`<tr\${blocked ? ' style="background:var(--bad-bg)"' : ''}>\`
            + \`<td><input type="checkbox" data-ordqty-pick="\${esc(r.orderNo + '|' + r.id)}"\${
              (ORD.qtyPick || new Set()).has(r.orderNo + '|' + r.id) ? ' checked' : ''} style="width:auto;margin:0"></td>\`
            + \`<td style="text-align:left">\${esc(r.orderNo)}</td>\`
            + \`<td style="font-family:ui-monospace,monospace;text-align:left">\${esc(r.sku)}</td>\`
            + \`<td class="num">\${nf(nowQty)}</td>\`
            + \`<td class="num" style="font-weight:700;color:\${r.to > nowQty ? '#166534' : 'var(--bad)'}">\${nf(r.to)}</td>\`
            + \`<td class="num"\${blocked ? ' style="color:var(--bad);font-weight:700"' : ''}>\${nf(d.floor)}\`
            + (blocked ? '<div style="font-size:10.5px">cannot go below this</div>' : '') + '</td>'
            + \`<td style="text-align:left;white-space:normal;max-width:220px">\${esc(r.why || '')}\${
              r.via === 'sheet' ? '<div class="muted" style="font-size:10.5px">from a sheet</div>' : ''}</td>\`
            + \`<td style="font-size:12px">\${esc(String(r.by || '').split('@')[0])}<div class="muted" style="font-size:10.5px">\${esc(ptIsoDate(r.at) || '')}</div></td>\`
            + '</tr>';
        }).join('')}
      </tbody></table></div>
      <label style="display:block;margin-top:10px">Reason, if you are turning them down<input id="ordQtyWhy" type="text" placeholder="e.g. already cut for the 25th, cannot drop it now"></label>\`
      : '<div class="muted">Nothing is waiting.</div>',
    onSave: rows.length ? () => ordQtyAnswerRun([...(ORD.qtyPick || [])], false) : null,
    saveLabel: 'Approve ticked',
    alt: rows.length ? { label: 'Turn down ticked',
      run: () => ordQtyAnswerRun([...(ORD.qtyPick || [])], true, (($('ordQtyWhy') || {}).value) || '') } : null,
  });
}

$('ptDlgBody').addEventListener('change', e => {
  const all = e.target.closest('[data-ordqty-all]');
  if (all) {
    ORD.qtyPick = all.checked ? new Set(ordQtyUnseenAll().map(r => r.orderNo + '|' + r.id)) : new Set();
    return ordQtyListOpen();
  }
  const p = e.target.closest('[data-ordqty-pick]');
  if (!p) return;
  const k = p.getAttribute('data-ordqty-pick');
  ORD.qtyPick = ORD.qtyPick || new Set();
  if (p.checked) ORD.qtyPick.add(k); else ORD.qtyPick.delete(k);
});

/* The window opens from the button at the top and from the Answer link on any waiting line. */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ordqtyopen]');
  if (!b) return;
  e.preventDefault();
  if (!ordQtyCanApprove()) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Answering a quantity change needs the Order Console.'; return; }
  ordQtyListOpen();
});`, 'the window');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
