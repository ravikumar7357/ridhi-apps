/* RFD REQUIREMENTS: tick several and refuse them in one go.
 *
 * "yaha me select karke 1 time me refuse kar saku"
 *
 * WHAT CAN BE TICKED is exactly what the row's own Refuse button would allow: somebody with the
 * approving right, a requirement not already refused, and no cloth gone out against it. A tick box
 * on a row the button would refuse is a promise the write then breaks.
 *
 * ONLY WHAT IS ON SCREEN IS REFUSED. Ticks on rows a filter has since hidden are let go on the next
 * draw — refusing something the person can no longer see is how the wrong printer loses cloth.
 *
 * ONE REASON FOR ALL OF THEM, and it is required: every printer sees it on their own screen.
 * Each is refused through rfdDecide, the same write the single button uses, so the printer's copy,
 * the log and the right are checked the same way. One failing does not stop the rest; the message
 * says how many went and why the others did not.
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

/* ---- 1. the button ---- */
one(`          <button id="rfdExport" class="ghost">Export</button>
          <button id="rfdGo">Refresh</button>`,
`          <button id="rfdExport" class="ghost">Export</button>
          <button id="rfdRefuseSel" class="ghost hide" title="Refuse every ticked requirement, with one reason">Refuse ticked</button>
          <button id="rfdGo">Refresh</button>`, 'the button');

/* ---- 2. the picking ---- */
one(`/** Only what this account may actually do, and only what makes sense at this stage. */
function rfdButtons(r) {`,
`/* ---- ticking several ---- */

let RFD_PICK = new Set();

/** The same test the row's own Refuse button uses — a tick box must not offer what the write refuses. */
const rfdRefusable = r => !!r && rfdCanApprove() && r.stage !== 'rejected' && !(r.sent > 0);

function rfdPickToggle(id, on) { if (on) RFD_PICK.add(id); else RFD_PICK.delete(id); rfdPickShow(); }

/** Tick, or untick, every refusable row on screen — never one a filter is hiding. */
function rfdPickAll(on) {
  (RFD.shown || []).filter(rfdRefusable).forEach(r => { if (on) RFD_PICK.add(r.id); else RFD_PICK.delete(r.id); });
  rfdPickShow();
}

/** Let go of any tick on a row that is no longer on screen or no longer refusable. */
function rfdPickPrune() {
  const ok = new Set((RFD.shown || []).filter(rfdRefusable).map(r => r.id));
  RFD_PICK = new Set([...RFD_PICK].filter(id => ok.has(id)));
}

function rfdPickShow() {
  const b = $('rfdRefuseSel');
  if (b) {
    b.classList.toggle('hide', !RFD_PICK.size);
    b.textContent = 'Refuse ticked (' + nf(RFD_PICK.size) + ')';
  }
  const all = $('rfdPickAll');
  if (all) {
    const can = (RFD.shown || []).filter(rfdRefusable);
    all.checked = can.length > 0 && can.every(r => RFD_PICK.has(r.id));
  }
}

/**
 * Refuse several, one at a time, through the same write the single button uses.
 * Returns { done, failed: [{ id, err }] } or { err } when nothing was tried.
 */
async function rfdRefuseMany(ids, note) {
  if (!rfdCanApprove()) return { err: RFD_NO_APPROVE };
  const why = String(note || '').trim();
  if (!why) return { err: 'Give a reason — every printer sees it on their own screen.' };
  const list = [...new Set(ids || [])];
  if (!list.length) return { err: 'Nothing is ticked.' };
  let done = 0; const failed = [];
  for (const id of list) {
    const err = await rfdDecide(id, 'rejected', why);
    if (err) failed.push({ id, err }); else { done++; RFD_PICK.delete(id); }
  }
  return { done, failed };
}

/** Only what this account may actually do, and only what makes sense at this stage. */
function rfdButtons(r) {`, 'the picking');

/* ---- 3. the tick boxes ---- */
one(`  const head = '<thead><tr>' + ['Raised', 'Printer', 'Order', 'What they need', 'How much',
    'What the order covers', 'Stage', 'Sent', 'Note', '']
    .map((h, i) => \`<th\${i === 0 ? ' class="frz"' : ([4, 7].indexOf(i) >= 0 ? ' class="num"' : '')}>\${esc(h)}</th>\`).join('') + '</tr></thead>';`,
`  /* The tick-all box sits in the first header, and only for somebody who can refuse. */
  const picking = rfdCanApprove() && rows.some(rfdRefusable);
  const head = '<thead><tr>' + ['Raised', 'Printer', 'Order', 'What they need', 'How much',
    'What the order covers', 'Stage', 'Sent', 'Note', '']
    .map((h, i) => \`<th\${i === 0 ? ' class="frz"' : ([4, 7].indexOf(i) >= 0 ? ' class="num"' : '')}>\`
      + (i === 0 && picking ? '<input type="checkbox" id="rfdPickAll" title="Tick every requirement shown that can still be refused" style="margin-right:6px;vertical-align:middle">' : '')
      + \`\${esc(h)}</th>\`).join('') + '</tr></thead>';`, 'tick-all');

one(`    return '<tr>'
      + \`<td class="frz" style="text-align:left">\${esc(ptIsoDate(r.raisedAt) || '')}\``,
`    return '<tr>'
      + \`<td class="frz" style="text-align:left">\`
      + (rfdRefusable(r) ? \`<input type="checkbox" data-rfd-pick="\${esc(r.id)}"\${RFD_PICK.has(r.id) ? ' checked' : ''} style="margin-right:6px;vertical-align:middle">\` : '')
      + \`\${esc(ptIsoDate(r.raisedAt) || '')}\``, 'a tick per row');

/* ---- 4. drawing keeps the ticks honest ---- */
one(`  const rows = rfdApply(all, rfdFilters());
  RFD.shown = rows;
`,
`  const rows = rfdApply(all, rfdFilters());
  RFD.shown = rows;
  rfdPickPrune();
`, 'prune on draw');

one(`    + (rfdCanApprove() ? '' : ' · you may look, not answer');
}`,
`    + (rfdCanApprove() ? '' : ' · you may look, not answer');
  rfdPickShow();
}`, 'show the count');

/* ---- 5. wiring ---- */
one(`function rfdKpiClick(e) {`,
`$('rfdTable').addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.getAttribute) return;
  if (t.id === 'rfdPickAll') { rfdPickAll(!!t.checked); renderRfd(); return; }
  const id = t.getAttribute('data-rfd-pick');
  if (id) rfdPickToggle(id, !!t.checked);
});

$('rfdRefuseSel').onclick = () => {
  rfdPickPrune();
  const picked = (RFD.shown || []).filter(r => RFD_PICK.has(r.id));
  if (!picked.length) { rfdPickShow(); return; }
  const printers = [...new Set(picked.map(r => r.vendorName || r.vendorCode))];
  ptOpenDialog({
    title: 'Refuse ' + nf(picked.length) + ' requirement(s)',
    subtitle: printers.slice(0, 4).join(', ') + (printers.length > 4 ? ' and ' + nf(printers.length - 4) + ' more' : ''),
    note: 'Every printer sees this reason on their own screen. Say something they can act on.',
    html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
      + picked.slice(0, 12).map(r => esc(r.orderNo + ' · ' + (r.vendorName || r.vendorCode) + ' · ' + r.unitTxt + ' · ' + rfdQtyTxt(r))).join('<br>')
      + (picked.length > 12 ? '<br>…and ' + nf(picked.length - 12) + ' more.' : '') + '</div>',
    fields: [{ key: 'note', label: 'Reason', span: true, value: '' }],
    saveLabel: 'Refuse ' + nf(picked.length),
    onSave: async v => {
      const res = await rfdRefuseMany(picked.map(r => r.id), v.note);
      if (res.err) return res.err;
      renderRfd();
      $('rfdMsg').className = res.failed.length ? 'err' : 'muted';
      $('rfdMsg').textContent = nf(res.done) + ' refused.'
        + (res.failed.length ? ' ' + nf(res.failed.length) + ' were not: '
          + res.failed.slice(0, 3).map(x => { const r = rfdFind(x.id); return (r ? r.orderNo : x.id) + ' — ' + x.err; }).join(' · ') : '');
      return '';
    },
  });
};

function rfdKpiClick(e) {`, 'wired');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
