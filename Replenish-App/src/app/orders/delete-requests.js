/* ================= ASKING SALES TO DELETE AN ORDER LINE =================
 *
 * Ravi: "ye mujhe system se delete krna h but I don't have option so give an option to send back to
 * sales team, ask for delete, they will delete it".
 *
 * THE ORDER CONSOLE ASKS; THE SALES TEAM DECIDES. A line in the order book is somebody's sales order,
 * so production does not delete it. It ticks the line(s), says why, and the request lands in Sales
 * Orders → Deletion requests. There the sales team deletes it, or keeps it with a note.
 *
 * WHERE: pt_obDeleteReqs/<odr_ORDER_SKU>. One id per order line, so asking twice cannot file two
 * requests. Asking again after a "keep" reopens the same record, and the earlier answer is kept on it.
 *
 * WHAT DELETING DOES, in ONE PATCH:
 *   · every pt_orderBook row for that order + SKU is removed — found by reading the order book again,
 *     by its stored key. The key is not rebuilt from the SKU: renamed SKUs still sit under their old
 *     key (ob_so_AMZ-25082026-01_CPC-SC-005 holds CPC-SWC-005);
 *   · the SKU's lines come off the sales order itself (pt_salesOrders/<order>/lines), and what was
 *     removed is logged on it as removedLines. Without this, approving the order again would put the
 *     line straight back — approval fills whatever is missing;
 *   · the request is marked deleted, with who and when.
 *
 * WORK ALREADY RECORDED against the line (cut, issued, received, pressed) is NOT deleted. Those rows
 * keep their Order ID and simply stop counting against a line. Both the request and the delete say
 * how much there is, so nobody removes a half-made line without seeing it.
 *
 * WHO: asking needs the Order Console (tab `ord`); answering needs Sales Orders (tab `so`). Admins can
 * do both.
 */
let ODR = { rows: null, pick: new Set() };

const odrId = (no, sku) => 'odr_' + (obUC(no) + '_' + obUC(sku)).replace(/[.#$\[\]\/\s]/g, '-');
const odrCanAsk = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('ord') >= 0);
const odrCanAnswer = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('so') >= 0);
const odrPending = () => (ODR.rows || []).filter(r => r && r.status === 'pending');
const odrPendingOf = (no, sku) => odrPending().find(r => r.id === odrId(no, sku)) || null;

async function odrLoad(force) {
  if (ODR.rows && !force) return ODR.rows;
  try { ODR.rows = ptList(await ptGet('pt_obDeleteReqs')).filter(r => r && r.id); }
  catch (e) { ODR.rows = ODR.rows || []; }
  odrBadge();
  return ODR.rows;
}

/** The count on Sales Orders — only for somebody who can answer. */
function odrBadge() {
  const n = odrCanAnswer() ? odrPending().length : 0;
  const el = $('soDelBadge');
  if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('hide', !n); }
  /* The quantity sheet writes quantities, so it is the approvers' button, like the single change. */
  ['sxQtyTpl', 'sxQtyImp'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !soCanApprove()); });
  const b = $('sxDelReqs');
  if (b) { b.textContent = n ? `Deletion requests (${nf(n)})` : 'Deletion requests'; b.classList.toggle('hide', !odrCanAnswer()); }
}

/** The work booked against a line right now, or what the request saw if the line is gone. */
function odrWork(r) {
  const l = ordLines().find(x => x.orderNo === obUC(r.orderNo) && x.sku === obUC(r.sku));
  const w = l ? { cut: l.cut, issued: l.issued, received: l.received, pressed: l.pressed, qty: l.qty, live: true }
    : Object.assign({ cut: 0, issued: 0, received: 0, pressed: 0, qty: r.qty, live: false }, r.work || {});
  w.any = (w.cut || 0) + (w.issued || 0) + (w.received || 0) + (w.pressed || 0) > 0;
  w.text = [w.cut && `${nf(w.cut)} cut`, w.issued && `${nf(w.issued)} issued`, w.received && `${nf(w.received)} received`,
    w.pressed && `${nf(w.pressed)} pressed`].filter(Boolean).join(' · ');
  return w;
}

/* ---- asking, from the Order Console ---- */
function odrAskOpen() {
  if (!odrCanAsk()) return;
  const keys = [...(ORD.pick || new Set())];
  if (!keys.length) return;
  const all = new Map(ordLines().map(l => [l.orderNo + '|' + l.sku, l]));
  const lines = keys.map(k => all.get(k)).filter(Boolean);
  const busy = lines.filter(l => l.cut || l.issued || l.received || l.pressed);
  const asked = lines.filter(l => odrPendingOf(l.orderNo, l.sku));
  ptOpenDialog({
    title: `Ask sales to delete ${nf(lines.length)} line(s)`,
    subtitle: [...new Set(lines.map(l => l.orderNo))].slice(0, 4).join(', ') + (new Set(lines.map(l => l.orderNo)).size > 4 ? '…' : ''),
    note: 'The lines stay in the order book until the sales team answers in Sales Orders → Deletion requests. '
      + 'If they delete them, the line comes off the sales order too, so approving it again cannot bring it back.',
    html: `<div style="font-size:12.5px">
        ${busy.length ? `<div class="err">${nf(busy.length)} of these already have work booked against them — deleting the line does not delete that work, it just stops counting against an order.</div>` : ''}
        ${asked.length ? `<div class="muted">${nf(asked.length)} already have a request waiting and will be skipped.</div>` : ''}
        <label style="display:block;margin-top:8px">Why should these go?<input id="odrWhy" type="text" placeholder="e.g. Amazon cancelled, duplicate line, wrong SKU"></label>
        <div class="xlwrap" style="max-height:30vh;margin-top:8px"><table class="xl"><thead><tr><th>Order</th><th>SKU</th><th class="num">Ordered</th><th>Work booked</th></tr></thead><tbody>
        ${lines.slice(0, 200).map(l => `<tr><td style="text-align:left">${esc(l.orderNo)}</td><td style="font-family:ui-monospace,monospace;text-align:left">${esc(l.sku)}</td>`
          + `<td class="num">${nf(l.qty)}</td><td style="text-align:left">${esc(odrWork(l).text) || '<span class="muted">none</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>`,
    onSave: () => odrAskSave(keys),
    saveLabel: 'Send to the sales team',
  });
}

async function odrAskSave(keys) {
  if (!odrCanAsk()) return 'Only somebody with the Order Console can ask for a line to be deleted.';
  const why = String((($('odrWhy') || {}).value) || '').trim();
  if (!why) return 'Say why — the sales team has to decide from that.';
  if (!keys.length) return 'Tick the line(s) first.';
  await odrLoad(true);
  const all = new Map(ordLines().map(l => [l.orderNo + '|' + l.sku, l]));
  const now = new Date().toISOString(), updates = {}, recs = [], skipped = [];
  keys.forEach(k => {
    const l = all.get(k);
    if (!l) return skipped.push('not in the order book any more');
    if (odrPendingOf(l.orderNo, l.sku)) return skipped.push('already asked');
    const id = odrId(l.orderNo, l.sku);
    const old = (ODR.rows || []).find(r => r.id === id);
    const rec = { id, status: 'pending', orderNo: l.orderNo, sku: l.sku, qty: l.qty, orderDate: l.orderDate || '',
      articleType: l.articleType || '', articleSubtype: l.articleSubtype || '', color: l.color || '', size: l.size || '',
      src: l.src || '', work: { cut: l.cut || 0, issued: l.issued || 0, received: l.received || 0, pressed: l.pressed || 0 },
      why, by: ME.email, at: now };
    if (old) rec.previous = (Array.isArray(old.previous) ? old.previous : [])
      .concat({ status: old.status, why: old.why || '', by: old.by || '', at: old.at || '',
        answeredBy: old.answeredBy || '', answeredAt: old.answeredAt || '', note: old.note || '' });
    updates['pt_obDeleteReqs/' + id] = rec;
    recs.push(rec);
  });
  const skipText = skipped.length ? ` · ${nf(skipped.length)} skipped (${[...new Set(skipped)].join(', ')})` : '';
  if (!recs.length) return 'Nothing was sent' + skipText + '.';
  await ptPatch(updates);
  const ids = new Set(recs.map(r => r.id));
  ODR.rows = (ODR.rows || []).filter(r => !ids.has(r.id)).concat(recs);
  ORD.pick = new Set();
  odrBadge();
  renderOrd();
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(recs.length)} line(s) sent to the sales team to delete${skipText}. `
    + 'They stay in the order book until somebody in Sales Orders answers.';
  return '';
}

/* ---- answering, from Sales Orders ---- */
function odrListOpen() {
  if (!odrCanAnswer()) return;
  const rows = odrPending().slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  ODR.pick = new Set([...ODR.pick].filter(id => rows.some(r => r.id === id)));
  ptOpenDialog({
    title: 'Deletion requests',
    subtitle: rows.length ? `${nf(rows.length)} order line(s) production has asked you to delete` : 'Nothing is waiting',
    note: 'Delete removes the line from the order book AND from its sales order, so approving the order again '
      + 'will not bring it back. Work already booked against it (cut, issued, pressed) stays where it is. '
      + 'Keep sends it back with your note.',
    html: rows.length ? `<div class="xlwrap" style="max-height:44vh"><table class="xl"><thead><tr>
        <th><input type="checkbox" data-odr-all style="width:auto;margin:0" title="Tick every request"></th>
        <th>Order</th><th>SKU</th><th>Item</th><th class="num">Ordered</th><th>Work booked</th><th>Why</th><th>Asked by</th></tr></thead><tbody>
        ${rows.map(r => { const w = odrWork(r); return `<tr>`
          + `<td><input type="checkbox" data-odr-pick="${esc(r.id)}"${ODR.pick.has(r.id) ? ' checked' : ''} style="width:auto;margin:0"></td>`
          + `<td style="text-align:left">${esc(r.orderNo)}</td>`
          + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
          + `<td style="text-align:left">${esc([r.articleSubtype || r.articleType || r.itemName, r.color, r.size].filter(Boolean).join(' · '))}</td>`
          + `<td class="num" style="font-weight:700">${nf(w.qty)}</td>`
          + `<td style="text-align:left${w.any ? ';color:var(--bad)' : ''}">${esc(w.text) || '<span class="muted">none</span>'}${w.live ? '' : '<div class="muted" style="font-size:10.5px">already gone from the order book</div>'}</td>`
          + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.why)}</td>`
          + `<td style="font-size:12px">${esc(String(r.by || '').split('@')[0])}<div class="muted" style="font-size:10.5px">${esc(String(r.at || '').slice(0, 10))}</div></td>`
          + '</tr>'; }).join('')}
      </tbody></table></div>
      <label style="display:block;margin-top:10px">Note for production (needed to keep a line)<input id="odrNote" type="text" placeholder="e.g. still needed for the September shipment"></label>`
      : '<div class="muted">Nothing is waiting.</div>',
    onSave: rows.length ? () => odrDeleteRun([...ODR.pick]) : null,
    saveLabel: 'Delete ticked',
    alt: rows.length ? { label: 'Keep ticked', run: () => odrKeepRun([...ODR.pick]) } : null,
  });
}

$('ptDlgBody').addEventListener('change', e => {
  const p = e.target.closest('[data-odr-pick]');
  if (p) { const id = p.getAttribute('data-odr-pick'); if (p.checked) ODR.pick.add(id); else ODR.pick.delete(id); return; }
  const a = e.target.closest('[data-odr-all]');
  if (a) {
    document.querySelectorAll('[data-odr-pick]').forEach(x => {
      x.checked = a.checked;
      const id = x.getAttribute('data-odr-pick');
      if (a.checked) ODR.pick.add(id); else ODR.pick.delete(id);
    });
  }
});

async function odrDeleteRun(ids) {
  if (!odrCanAnswer()) return 'Only the sales team (the Sales Orders tab) can delete an order line.';
  if (!ids.length) return 'Tick at least one request.';
  await odrLoad(true);
  const reqs = ids.map(id => odrPending().find(r => r.id === id)).filter(Boolean);
  if (!reqs.length) return 'Those requests are no longer waiting — somebody has answered them.';

  /* Read again: the order book and every sales order involved. A line may have been re-added, a
   * sales order edited, since the request was made. */
  const ob = ptList(await ptGet('pt_orderBook'));
  const orders = [...new Set(reqs.map(r => obUC(r.orderNo)))];
  const sos = await Promise.all(orders.map(no => ptGet('pt_salesOrders/' + no)));
  const soNext = new Map();
  orders.forEach((no, i) => {
    const so = sos[i];
    if (so && typeof so === 'object' && (so.lines || so.status))
      soNext.set(no, { lines: soLines(so), removed: Array.isArray(so.removedLines) ? so.removedLines.slice() : [], changed: false });
  });

  const now = new Date().toISOString(), updates = {}, goneKeys = new Set();
  let rowsGone = 0, soPieces = 0;
  const notes = [];
  reqs.forEach(r => {
    const no = obUC(r.orderNo), sku = obUC(r.sku);
    const w = odrWork(r);
    const rows = ob.filter(x => x && obUC(x.orderNo) === no && obUC(x.sku) === sku && x._key);
    rows.forEach(x => { updates['pt_orderBook/' + x._key] = null; goneKeys.add(x._key); });
    rowsGone += rows.length;
    const s = soNext.get(no);
    let q = 0;
    if (s) {
      const hit = s.lines.filter(l => obUC(l.sku) === sku);
      q = hit.reduce((t, l) => t + (parseFloat(l.qty) || 0), 0);
      if (hit.length) {
        s.lines = s.lines.filter(l => obUC(l.sku) !== sku);
        s.removed.push({ sku, qty: q, at: now, by: ME.email, reqId: r.id, why: r.why || '', askedBy: r.by || '' });
        s.changed = true;
        soPieces += q;
      }
    } else notes.push(`${no} is not a sales order in this app, so only its order-book row was removed`);
    Object.assign(updates, {
      ['pt_obDeleteReqs/' + r.id + '/status']: 'deleted',
      ['pt_obDeleteReqs/' + r.id + '/answeredBy']: ME.email,
      ['pt_obDeleteReqs/' + r.id + '/answeredAt']: now,
      ['pt_obDeleteReqs/' + r.id + '/obRowsRemoved']: rows.length,
      ['pt_obDeleteReqs/' + r.id + '/soQtyRemoved']: q,
      ['pt_obDeleteReqs/' + r.id + '/workAtDelete']: { cut: w.cut || 0, issued: w.issued || 0, received: w.received || 0, pressed: w.pressed || 0 },
    });
  });
  soNext.forEach((s, no) => {
    if (!s.changed) return;
    updates['pt_salesOrders/' + no + '/lines'] = s.lines;
    updates['pt_salesOrders/' + no + '/removedLines'] = s.removed;
    updates['pt_salesOrders/' + no + '/updatedAt'] = now;
  });
  await ptPatch(updates);

  /* A new array, so every index built on the order book knows it moved. */
  if (PTG.ob) PTG.ob = PTG.ob.filter(x => !(x && goneKeys.has(x._key)));
  if (SOX.rows) SOX.rows = SOX.rows.map(o => {
    const s = soNext.get(obUC(o._id || o._key));
    return s && s.changed ? Object.assign({}, o, { lines: s.lines, removedLines: s.removed, updatedAt: now }) : o;
  });
  const done = new Set(reqs.map(r => r.id));
  ODR.rows = (ODR.rows || []).map(r => (done.has(r.id) ? Object.assign({}, r, { status: 'deleted', answeredBy: ME.email, answeredAt: now }) : r));
  ODR.pick = new Set();
  odrBadge();
  if ($('sxMsg')) {
    $('sxMsg').className = 'muted';
    $('sxMsg').textContent = `${nf(reqs.length)} order line(s) deleted · ${nf(rowsGone)} order-book row(s) removed`
      + ` · ${nf(soPieces)} piece(s) taken off their sales order(s)`
      + (notes.length ? ' · ' + [...new Set(notes)].join('; ') : '') + '.';
  }
  try { renderSox(); } catch (e) { /* the screen may not be open */ }
  return '';
}

async function odrKeepRun(ids) {
  if (!odrCanAnswer()) return 'Only the sales team (the Sales Orders tab) can answer a request.';
  if (!ids.length) return 'Tick at least one request.';
  const note = String((($('odrNote') || {}).value) || '').trim();
  if (!note) return 'Say why these lines stay — production asked for a reason, and gets one back.';
  await odrLoad(true);
  const reqs = ids.map(id => odrPending().find(r => r.id === id)).filter(Boolean);
  if (!reqs.length) return 'Those requests are no longer waiting — somebody has answered them.';
  const now = new Date().toISOString(), updates = {};
  reqs.forEach(r => Object.assign(updates, {
    ['pt_obDeleteReqs/' + r.id + '/status']: 'kept',
    ['pt_obDeleteReqs/' + r.id + '/answeredBy']: ME.email,
    ['pt_obDeleteReqs/' + r.id + '/answeredAt']: now,
    ['pt_obDeleteReqs/' + r.id + '/note']: note,
  }));
  await ptPatch(updates);
  const done = new Set(reqs.map(r => r.id));
  ODR.rows = (ODR.rows || []).map(r => (done.has(r.id) ? Object.assign({}, r, { status: 'kept', answeredBy: ME.email, answeredAt: now, note }) : r));
  ODR.pick = new Set();
  odrBadge();
  if ($('sxMsg')) { $('sxMsg').className = 'muted'; $('sxMsg').textContent = `${nf(reqs.length)} line(s) kept · production can see your note on them.`; }
  return '';
}

$('sxDelReqs').onclick = async () => { await odrLoad(true); if (!PTG.ob) await ptLoadGates(); odrListOpen(); };

$('sxQtyTpl').onclick = soQtyTemplate;
$('sxQtyImp').onclick = () => $('sxQtyFile').click();
$('sxQtyFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = soQtySheetRead(rows);
    if (read.err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = read.err; return; }
    const plan = soQtyBulkPlan(read.entries);
    if (!plan.ok.length) {
      $('sxMsg').className = plan.skip.length ? 'err' : 'muted';
      $('sxMsg').textContent = plan.skip.length
        ? `Nothing to write. ${nf(plan.skip.length)} row(s) refused: `
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ` and ${nf(plan.skip.length - 3)} more.` : '')
        : 'Every row in that file already says what the order says.';
      return;
    }
    const up = plan.ok.filter(x => x.delta > 0), down = plan.ok.filter(x => x.delta < 0);
    const show = list => list.slice(0, 12).map(x => esc(x.o._id) + ' · ' + esc(x.sku) + ': '
      + nf(x.from) + ' → <b>' + nf(x.to) + '</b>' + (x.book == null ? ' <i>(not in the order book)</i>' : '')).join('<br>');
    ptOpenDialog({
      title: 'Change these quantities?',
      subtitle: `${nf(plan.ok.length)} line(s) · ${nf(up.length)} up · ${nf(down.length)} down`,
      /* THE ORDER BOOK MOVES WITH THEM — said here, because that is the part that reaches the floor. */
      note: 'The order book moves with the sales order, in the same write. A line the order book never '
        + 'got changes on the order only. Nothing goes below what has already been cut, received or pressed.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (up.length ? `<b style="color:#166534">Going up</b><br>${show(up)}`
          + (up.length > 12 ? `<br>…and ${nf(up.length - 12)} more.` : '') + '<br><br>' : '')
        + (down.length ? `<b style="color:var(--bad)">Coming down</b><br>${show(down)}`
          + (down.length > 12 ? `<br>…and ${nf(down.length - 12)} more.` : '') + '<br><br>' : '')
        + (plan.skip.length ? `<b style="color:var(--bad)">${nf(plan.skip.length)} row(s) refused, and not written</b><br>`
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 10 ? `<br>…and ${nf(plan.skip.length - 10)} more.` : '') : '')
        + '</div>',
      saveLabel: `Change ${nf(plan.ok.length)} line(s)`,
      onSave: async () => {
        const out = await soQtyBulkRun(plan);
        renderSox();
        if (out.err) return out.err;
        $('sxMsg').className = 'muted';
        $('sxMsg').textContent = `${nf(out.done)} quantit${out.done > 1 ? 'ies' : 'y'} changed, and the order book says the same.`
          + (plan.skip.length ? ` ${nf(plan.skip.length)} row(s) were refused and left alone.` : '');
        return '';
      },
    });
  } catch (err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = 'Could not read it: ' + (err.message || err); }
};

