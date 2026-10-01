/* ================= CHANGING AND REMOVING A VENDOR ORDER =================
 *
 * Ravi, 2026-09-07: "me vendor ka order update kar saku or delete kar bulk me bhi or manually bhi".
 *
 * WHAT EDIT COVERS: the ordered quantity on each line, cancelling a line, and the order's notes. Not
 * adding lines — a new line is a new order to the printer, and slipping one into an order they have
 * already acknowledged is how a printer ends up making something nobody told them about.
 *
 * WHAT IT REFUSES: a quantity below what has already been delivered. That would make the order owe a
 * negative amount and would quietly rewrite history the printer can see in their own portal.
 *
 * DELETE IS NOT CANCEL, and the difference matters. Cancel leaves the order, its lines and its
 * delivery history in place and simply stops it counting. Delete removes the record — including
 * every delivery recorded against it, which is what the receiving logbook is built from. So an order
 * that has taken ANY delivery cannot be deleted at all; Cancel is offered instead.
 */

/** The lines as the edit dialog last had them, plus which rows the dialog has marked cancelled. */
let VOE = { key: null, lines: null, cancel: null };

/** What the printer CLAIMED across its rounds — before anybody accepted any of it. */
const voClaimed = l => voDels(l).reduce((s, d) => s + (parseFloat(d && d.qty) || 0), 0);
/**
 * What WE accepted. The app records acceptance per delivery (d.ok, written by the History tab's
 * challan flow); the old tracker keeps a single confirmedQty on the line. Both are read, because
 * both tools are pointed at the same database and either may have written.
 */
function voConfirmed(l) {
  const any = voDels(l).some(d => vlOk(d));
  if (any) return voDels(l).reduce((s, d) => { const k = vlOk(d); return s + (k ? (parseFloat(k.qty) || 0) : 0); }, 0);
  return (l && l.confirmedQty != null) ? (parseFloat(l.confirmedQty) || 0) : null;
}

/* The tracker's priority badge, same four levels. */
const VO_PRI = { P1: ['#FFDCE1', '#C00000'], P2: ['#FCE4D6', '#C65911'], P3: ['#FFF2CC', '#7F6000'], P4: ['#E2EFDA', '#375623'] };
function voPriBadge(p) {
  const k = String(p || '').trim().toUpperCase();
  const c = VO_PRI[k];
  return c ? `<span class="pill" style="background:${c[0]};color:${c[1]}">${esc(k)}</span>`
           : '<span class="muted">—</span>';
}

/**
 * ONE ROW, the way the tracker draws it: what the line is, its priority, what was ordered, what the
 * printer says it sent, what is left, what we accepted, and the gap between the last two.
 *
 * The ordered quantity is an input rather than the tracker's pencil-and-prompt. It is the same box
 * the old "Change this order" table had, so the guards behind it are unchanged — a quantity below
 * what has already been delivered is refused, and a raised quantity is re-checked against the
 * printer cap. A prompt would have meant a second, unguarded way in.
 */
/**
 * The delivery cell: what they promised, over what we asked for.
 *
 * The PROMISE is what planning runs on, so it reads first and largest. Ours sits under it, because
 * the gap between the two is the useful thing — and a line nobody has answered is called that
 * rather than being left looking fine.
 */
function voDueCell(o, l) {
  if (l && l.cancelled) return '<span class="muted">—</span>';
  const want = voWant(l), prom = voProm(l);
  const late = voLateBy(o, l), gap = voGap(l), slip = voSlip(l), moves = voMoves(l);
  const sub = [];
  if (want) sub.push('asked ' + esc(dShow(want)));
  if (gap != null && gap > 0) sub.push(`<span style="color:#7f6000">+${nf(gap)}d</span>`);
  if (moves) sub.push(`<span style="color:var(--bad)" title="First promised ${esc(dShow(voPromFirst(l)))}, moved ${nf(moves)} time(s)">moved ${nf(moves)}×${slip > 0 ? ', +' + nf(slip) + 'd' : ''}</span>`);
  const under = sub.length ? `<div class="muted" style="font-size:10px">${sub.join(' · ')}</div>` : '';
  if (!prom) {
    /* NOT LATE, AND NOT ON TIME — unanswered. Chasing a promise is a different job from chasing
     * goods, and a blank cell would look like neither. */
    return `<span class="pill pill-low" title="This vendor has not said when they will deliver this line.">no date yet</span>${under}`;
  }
  const col = late != null ? 'var(--bad)' : '#375623';
  return `<span style="font-weight:700;color:${col}">${esc(dShow(prom))}</span>`
    + (late != null ? `<div style="font-size:10px;color:var(--bad);font-weight:700">${nf(late)} day(s) late</div>` : '')
    + under;
}

function voEditRow(o, l, i, editable, pickKey) {
  const run = voRunning(o), q0 = voQty(o, l);
  /* VOE holds what the DIALOG has marked, for the one order it is open on. Without the key check a
   * second order drawn elsewhere would inherit the first order's cancelled rows by index. */
  const mine = VOE.cancel && VOE.key === o.vendorCode + '/' + o.id;
  const cancelled = mine ? VOE.cancel.has(i) : !!l.cancelled;
  const claimed = voClaimed(l) || voDone(l);
  const rounds = voDels(l).length;
  const conf = voConfirmed(l);
  const bal = q0 - claimed;
  const strike = cancelled ? 'text-decoration:line-through;color:var(--muted);' : '';
  const lead = run
    ? `<td style="text-align:left;${strike}">${esc(l.fabricType)}${l.sku ? `<div style="font-family:ui-monospace,monospace;font-size:11px" class="muted">${esc(l.sku)}</div>` : ''}</td>`
      + `<td style="text-align:left;${strike}">${esc(l.color)}</td>`
      + `<td style="text-align:left;${strike}">${esc(l.printDirection)}</td>`
    : `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px;${strike}">${esc(l.sku)}</td>`
      + ptImgCell(l.sku)
      + `<td style="text-align:left;font-size:12px;${strike}">${esc([l.articleType, l.articleSubtype, l.color, l.size].filter(Boolean).join(' · '))}</td>`;
  /* A tick box only where ticking does something: the card, for somebody who may change the order. */
  /* PINNED TO THE LEFT. It is the first column of a table wider than the screen, so without this it
   * slides off the edge the moment the table is nudged sideways — which is how a feature that is
   * right there stops existing as far as anybody can tell. */
  const tick = pickKey
    ? `<td class="frz"><input type="checkbox" data-vopick="${esc(pickKey)}" data-i="${i}"${
        (voPicked(pickKey) || new Set()).has(i) ? ' checked' : ''} style="width:auto;margin:0"></td>`
    : '';
  return `<tr${cancelled ? ' style="opacity:.7"' : ''}>` + tick + lead
    + `<td>${voPriBadge(l.priority)}</td>`
    + `<td class="num" style="font-weight:700">${(editable || pickKey) && !cancelled
        ? `<input ${editable ? `data-voe="${i}"` : `data-voqty="${esc(pickKey)}" data-i="${i}"`} type="number" min="0" step="1" value="${esc(q0)}" style="width:78px;text-align:right">`
        : `<span style="${strike}">${nf(q0)}</span>`}</td>`
    /* What the printer claims, and how many rounds it came in — the tracker's "N round(s)". */
    + `<td class="num">${claimed ? `<b>${nf(claimed)}</b>` : '<span class="muted">—</span>'}`
      + `${rounds ? `<div class="muted" style="font-size:10px">${nf(rounds)} round(s)</div>` : ''}</td>`
    + `<td class="num">${cancelled ? '<span class="pill pill-out">CANCELLED</span>'
        : `<span style="font-weight:700;color:${bal > 0 ? '#C65911' : '#375623'}">${nf(bal)}</span>`}</td>`
    /* Read-only: accepting a delivery belongs to the History tab, where it is done round by round
     * with a note and a name against it. Two ways to accept would be two different records. */
    + `<td style="font-size:12px">${voDueCell(o, l)}</td>`
    + `<td class="num">${conf == null ? '<span class="muted">—</span>' : `<b>${nf(conf)}</b>`}</td>`
    + `<td class="num">${conf == null || !claimed ? ''
        : (claimed - conf === 0 ? '<span style="color:#375623">✓</span>'
          : `<span style="color:var(--bad);font-weight:700">${claimed - conf > 0 ? '+' : ''}${nf(claimed - conf)}</span>`)}</td>`
    + (editable ? `<td>${cancelled
        ? `<button class="ghost" data-voetog="${i}" style="padding:2px 9px;font-size:11px;color:#375623" title="Restore this line — it counts toward the order again">↺ Restore</button>`
        : `<button class="ghost" data-voetog="${i}" style="padding:2px 9px;font-size:11px;color:var(--bad)" title="Cancel just this line — the rest of the order is unaffected">✕ Cancel</button>`}</td>` : '')
    + '</tr>';
}

/**
 * Why this line cannot be cancelled — '' when it can.
 *
 * Goods already delivered against it are the one reason. voSummary counts only LIVE lines, so
 * cancelling a line that has taken deliveries removes those pieces from the order while the challan
 * for them still sits in History. The two screens would disagree and neither would be wrong.
 */
function voWhyNoCancel(l) {
  const d = voDone(l);
  return d > 0
    ? `${l.sku || l.fabricType || 'this line'}: ${nf(d)} already delivered against it`
    : '';
}

/** Which lines of an order are ticked right now. */
const voPicked = key => (VO.pick && VO.pick[key]) || null;

/**
 * Cancel, or restore, the ticked lines of one order.
 *
 * The card shows every line already; opening a dialog to reach them was the only reason the dialog
 * existed for this. Returns a message, '' when it went through.
 */
async function voCancelPicked(key, on) {
  if (!ME.admin) return 'Only an admin can change a vendor order.';
  const picked = voPicked(key);
  if (!picked || !picked.size) return 'Tick the line(s) first.';
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id);
  if (!o) return 'That order is gone.';

  const lines = voLines(o).map(l => Object.assign({}, l));
  const refused = [];
  let n = 0;
  [...picked].forEach(i => {
    const l = lines[i]; if (!l) return;
    if (!!l.cancelled === on) return;                    // already where it is wanted
    if (on) { const why = voWhyNoCancel(l); if (why) { refused.push(why); return; } }
    l.cancelled = on; n++;
  });
  if (refused.length) {
    return `${nf(refused.length)} line(s) cannot be cancelled — ${refused.slice(0, 2).join('; ')}`
      + (refused.length > 2 ? ` and ${nf(refused.length - 2)} more.` : '.')
      + ' Nothing was changed.';
  }
  if (!n) return on ? 'Those are already cancelled.' : 'Those are not cancelled.';
  /* An order with nothing live is not an order. Cancelling the whole thing is a different act, and
   * it has its own button. */
  if (!lines.some(l => !l.cancelled)) return 'That would cancel every line. Cancel the whole order instead.';

  const next = Object.assign({}, o, { lines,
    staffUpdatedAt: new Date().toISOString(), staffUpdatedBy: ME.email });
  delete next.vendorCode;
  try { await ptPut('pt_vendorOrders/' + code + '/' + id, next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  VO.rows = (VO.rows || []).map(x => (x.id === id && x.vendorCode === code ? Object.assign({ vendorCode: code }, next) : x));
  if (VO.pick) delete VO.pick[key];
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${o.orderNo || id}: ${nf(n)} line(s) ${on ? 'cancelled' : 'restored'}. `
    + 'The vendor sees it in their portal.';
  return '';
}

/**
 * Save the quantities typed on a card, for one order.
 *
 * THE SAME TWO RULES THE DIALOG APPLIES, because two ways into the same order that disagree about
 * what is allowed are worse than one way in: a figure below what has already been delivered is a
 * contradiction rather than a correction, and an increase answers to the printer cap — otherwise
 * editing an order would be the way around a limit that placing one obeys.
 */
async function voSaveQty(key) {
  if (!ME.admin) return 'Only an admin can change a vendor order.';
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id);
  if (!o) return 'That order is gone.';

  const run = voRunning(o);
  const lines = voLines(o).map(l => Object.assign({}, l));
  const bad = [], grew = [];
  let n = 0;
  lines.forEach((l, i) => {
    if (l.cancelled) return;
    const el = document.querySelector(`[data-voqty="${key}"][data-i="${i}"]`);
    if (!el) return;                                  // filtered off the card, so not being changed
    const v = parseFloat(el.value);
    const was = voQty(o, l);
    if (!isFinite(v) || v < 0) { bad.push(`${l.sku || l.fabricType || 'line ' + (i + 1)}: not a quantity`); return; }
    if (v === was) return;
    const d0 = voDone(l);
    if (v < d0) { bad.push(`${l.sku || l.fabricType || 'line ' + (i + 1)}: ${nf(d0)} already delivered, cannot be set to ${nf(v)}`); return; }
    if (v > was) grew.push({ sku: l.sku, qty: v - was });
    if (run) l.meters = v; else l.qty = v;
    n++;
  });
  if (bad.length) return bad.slice(0, 3).join(' · ') + (bad.length > 3 ? ` And ${nf(bad.length - 3)} more.` : '')
    + ' Nothing was changed.';
  if (!n) return 'Nothing changed.';

  if (!run && voIsPrinting(o) && grew.length) {
    const over = voValidateCut(grew);
    if (over.length) return 'Over the cap: ' + over.slice(0, 3).map(voCapMsg).join(' ') + ' Nothing was changed.';
  }

  const next = Object.assign({}, o, { lines,
    staffUpdatedAt: new Date().toISOString(), staffUpdatedBy: ME.email });
  delete next.vendorCode;
  try { await ptPut('pt_vendorOrders/' + code + '/' + id, next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  VO.rows = (VO.rows || []).map(x => (x.id === id && x.vendorCode === code ? Object.assign({ vendorCode: code }, next) : x));
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${o.orderNo || id}: ${nf(n)} quantity(ies) changed. The vendor sees the new figures in their portal.`;
  return '';
}

/** Read the dialog back, check it, and say what is wrong rather than silently clamping. */
function voEditRead(o) {
  const lines = voLines(o).map(l => Object.assign({}, l));
  const bad = [];
  lines.forEach((l, i) => {
    /* Cancellation is held in VOE.cancel, not on a checkbox: the row is redrawn every time one is
     * toggled, and a checkbox would lose its state on the redraw. */
    if (VOE.cancel) {
      const want = VOE.cancel.has(i);
      /* The same rule the card applies: a line with goods against it cannot be cancelled, or its
       * delivered pieces leave the order while the challan for them stays in History. */
      if (want && !l.cancelled) { const why = voWhyNoCancel(l); if (why) { bad.push(why); return; } }
      l.cancelled = want;
    }
    const el = document.querySelector(`[data-voe="${i}"]`);
    if (!el || el.disabled || l.cancelled) return;
    const v = parseFloat(el.value);
    if (!isFinite(v) || v < 0) { bad.push(`${l.sku || l.fabricType || 'line ' + (i + 1)}: not a quantity`); return; }
    const d0 = voDone(l);
    /* Below what the printer has already sent is not a correction, it is a contradiction. */
    if (v < d0) { bad.push(`${l.sku || l.fabricType || 'line ' + (i + 1)}: ${nf(d0)} already delivered, cannot be set to ${nf(v)}`); return; }
    if (voRunning(o)) l.meters = v; else l.qty = v;
  });
  return { lines, bad };
}

async function voEditSave() {
  if (!ME.admin) return 'Only an admin can change a vendor order.';
  const key = VOE.key; if (!key) return 'That order is gone.';
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id); if (!o) return 'That order is gone.';

  const { lines, bad } = voEditRead(o);
  if (bad.length) return bad.slice(0, 3).join(' · ') + (bad.length > 3 ? ` And ${nf(bad.length - 3)} more.` : '');
  if (!lines.some(l => !l.cancelled)) return 'Every line is cancelled. Cancel the whole order instead.';

  /* Raising a quantity puts more against the printer cap, so it is checked again here — the cap is
   * checked when an order is placed, and an edit that skipped it would be the way around it. */
  if (!voRunning(o) && voIsPrinting(o)) {
    const was = voLines(o);
    const grew = lines.map((l, i) => ({ l, before: parseFloat(was[i] && was[i].qty) || 0 }))
      .filter(({ l, before }) => !l.cancelled && (parseFloat(l.qty) || 0) > before);
    if (grew.length) {
      /* Only what is BEING ADDED goes to the cap. The quantity already on this order is already
       * counted by it — asking for the whole line again double-counts it against itself. */
      const over = voValidateCut(grew.map(({ l, before }) => ({ sku: l.sku, qty: (parseFloat(l.qty) || 0) - before })));
      if (over.length) return 'Over the cap: ' + over.slice(0, 3).map(voCapMsg).join(' ');
    }
  }

  const next = Object.assign({}, o, { lines, notes: String(($('ptf_notes') || {}).value || '').trim(),
    staffUpdatedAt: new Date().toISOString(), staffUpdatedBy: ME.email });
  /* Only a filling order carries a filler, and clearing the box clears it — an order that names the
   * wrong one is worse than one that names none, because it is paid at the wrong card without a word. */
  if (voIsFilling(o)) {
    const f = String(($('ptf_filler') || {}).value || '').trim();
    if (f) next.filler = f; else delete next.filler;
  }
  delete next.vendorCode;
  await ptPut('pt_vendorOrders/' + code + '/' + id, next);
  VO.rows = (VO.rows || []).map(x => (x.id === id && x.vendorCode === code ? Object.assign({ vendorCode: code }, next) : x));
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${o.orderNo || id} updated. The printer sees the new quantities in their portal.`;
  return '';
}

/* ---- Current orders: the tracker's layout, one card per order with its lines under it ---- */

/** The attribute filters, which narrow LINES rather than orders. */
const voAttrF = () => ({ at: ($('voAt') || {}).value || '', sub: ($('voSub') || {}).value || '',
  col: ($('voCol') || {}).value || '', sz: ($('voSz') || {}).value || '', pri: ($('voPri') || {}).value || '' });
const voAttrOn = f => !!(f.at || f.sub || f.col || f.sz || f.pri);
/** Does one line survive them? A running line has no article or size, so those never match it. */
function voLineMatches(l, f) {
  if (f.at && !ptCi(l.articleType, f.at)) return false;
  if (f.sub && !ptCi(l.articleSubtype, f.sub)) return false;
  if (f.col && !ptCi(l.color, f.col)) return false;
  if (f.sz && !ptCi(l.size, f.sz)) return false;
  if (f.pri && String(l.priority || '').trim().toUpperCase() !== f.pri) return false;
  return true;
}

/** The order's own priority chip — the most urgent any of its live lines carries. */
function voOrderPri(o) {
  const rank = { P1: 1, P2: 2, P3: 3, P4: 4 };
  let best = '';
  voLines(o).forEach(l => {
    if (l.cancelled) return;
    const p = String(l.priority || '').trim().toUpperCase();
    if (!rank[p]) return;
    if (!best || rank[p] < rank[best]) best = p;
  });
  return best;
}

/** How many lines a card draws before it stops. One order here carries 327. */
const VO_CARD_LINES = 60;

function renderVoCards(rows) {
  const f = voAttrF(), on = voAttrOn(f);
  const html = rows.map(({ o, s }) => {
    const run = voRunning(o), u = voUnit(o);
    const all = voLines(o);
    const keep = all.map((l, i) => ({ l, i })).filter(({ l }) => !on || voLineMatches(l, f));
    if (on && !keep.length) return '';                 // nothing of this order survives the filters
    const shown = keep.slice(0, VO_CARD_LINES);
    const pri = voOrderPri(o);
    const cls = s.owed <= 0 ? 'pill-ok' : (o.status === 'Placed' ? '' : 'pill-low');
    /* Ticking is for whoever may change the order. Anybody else gets the same card without it, and
     * without a column that would do nothing. */
    const pickKey = ME.admin && o.status !== 'Cancelled' ? o.vendorCode + '/' + o.id : '';
    const picked = voPicked(pickKey) || new Set();
    const head = (pickKey ? ['<th class="frz" style="width:34px"><input type="checkbox" data-vopickall="'
        + esc(pickKey) + '" style="width:auto;margin:0" title="Tick every line shown"></th>'] : [])
      .concat((run ? ['Fabric', 'Colour', 'Print'] : ['SKU', 'Image', 'Article'])
        .concat(['Priority', 'Ordered', 'Vendor Qty', 'Balance', 'Delivery', 'Inwards Conf.', '\u0394'])
        .map(h => `<th${['Ordered', 'Vendor Qty', 'Balance', 'Inwards Conf.', '\u0394'].indexOf(h) >= 0 ? ' class="num"' : ''}>${h}</th>`))
      .join('');
    return `<div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <b style="font-size:15px">${esc(o.orderNo || o.id)}</b>${o.channel ? ` <span class="pill" style="background:#E9EFF6;color:#3A5573">For ${esc(o.channel)}</span>` : ''}
        <span class="pill">${esc(run ? 'Running fabric' : 'Cut fabric')}</span>
        ${pri ? voPriBadge(pri) : ''}
        <span class="muted" style="font-size:12.5px">${esc(voName(o.vendorCode))}</span>
        <span style="flex:1"></span>
        <span class="pill ${cls}">${esc(o.status || 'Placed')}</span>
        ${pickKey ? '' : `<button class="ghost" data-vo-open="${esc(o.vendorCode + '/' + o.id)}" style="padding:3px 10px;font-size:12px">Open</button>`}
      </div>
      <div class="muted" style="font-size:12px;margin-top:3px">Placed ${esc(o.orderDate || '—')} · ${nf(s.ordered)} ${u}${
        s.done ? ' · delivered ' + nf(s.done) + ' ' + u : ''}${
        s.owed ? ' · still owed ' + nf(s.owed) + ' ' + u : ''}${
        s.cancelled ? ' · ' + nf(s.cancelled) + ' line(s) cancelled' : ''}${
        /* The two things worth chasing, and they are chased differently: a line nobody has answered
         * needs a phone call about a DATE; a late one needs a call about GOODS. */
        s.unpromised ? ` · <span style="color:#7f6000;font-weight:600">${nf(s.unpromised)} with no date from them</span>` : ''}${
        s.late ? ` · <span style="color:var(--bad);font-weight:700">${nf(s.late)} past their own date</span>` : ''}</div>
      ${pickKey ? `<div class="toolbar" style="margin-top:8px">
        ${!picked.size ? '<span class="muted" style="font-size:12.5px">Tick line(s) on the left to cancel them →</span>' : ''}
        ${picked.size ? `<span class="muted" style="font-size:12.5px"><b>${nf(picked.size)}</b> line(s) ticked</span>
          <button class="ghost" data-vocancel="${esc(pickKey)}" style="color:var(--bad)">✕ Cancel these line(s)</button>
          <button class="ghost" data-vorestore="${esc(pickKey)}" style="color:#375623">↺ Restore</button>
          <button class="ghost" data-voclearpick="${esc(pickKey)}">Clear</button>
          <span style="width:12px"></span>` : ''}
        <button class="ghost" data-voqtysave="${esc(pickKey)}">Save quantities</button>
        <span style="flex:1"></span>
        ${o.status !== 'Received' ? `<button class="ghost" data-vo-recv="${esc(pickKey)}">Mark received</button>` : ''}
        <button class="ghost" data-vo-cxl="${esc(pickKey)}" style="color:var(--bad)">Cancel this order</button>
      </div>` : ''}
      <div class="xlwrap" style="margin-top:8px;border:1px solid var(--line);border-radius:10px">
        <table class="xl"><thead><tr>${head}</tr></thead><tbody>${
          shown.map(({ l, i }) => voEditRow(o, l, i, false, pickKey)).join('')}</tbody></table></div>
      ${keep.length > shown.length ? `<div class="muted" style="font-size:12px;margin-top:6px">Showing ${nf(shown.length)} of ${nf(keep.length)} line(s)${on ? ' that match the filters' : ''} — narrow them above, or open the order.</div>` : ''}
      ${on && keep.length < all.length ? `<div class="muted" style="font-size:12px;margin-top:4px">${nf(all.length - keep.length)} of this order's line(s) are filtered out.</div>` : ''}
    </div>`;
  }).join('');
  $('voCards').innerHTML = html
    || '<div class="card" style="padding:18px;text-align:center" class="muted">No order has a line matching those filters.</div>';
  if (rows.some(({ o }) => !voRunning(o))) {
    ptImgFill(rows.flatMap(({ o }) => voLines(o).slice(0, VO_CARD_LINES).map(l => l.sku)), false, ptImgPatch);
  }
}

/** Every delivery recorded against an order — what a delete would destroy. */
const voDeliveredCount = o => voLines(o).reduce((n, l) => n + voDels(l).length, 0);

async function voDelete(key) {
  if (!ME.admin) return 'Only an admin can delete a vendor order.';
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id); if (!o) return 'That order is gone.';
  const dels = voDeliveredCount(o);
  if (dels) {
    return `${o.orderNo || id} has ${nf(dels)} delivery(ies) recorded against it. Deleting it would take `
      + 'those out of the receiving logbook as well. Cancel it instead — that stops it counting and keeps '
      + 'what the printer actually sent.';
  }
  await ptDelete('pt_vendorOrders/' + code + '/' + id);
  VO.rows = (VO.rows || []).filter(x => !(x.id === id && x.vendorCode === code));
  VO_PICKED.delete(key);
  renderVo();
  return '';
}

/** The ticked orders, deleted together — with the same refusal, per order. */
async function voDeletePicked() {
  if (!ME.admin) { $('voMsg').className = 'err'; $('voMsg').textContent = 'Only an admin can delete a vendor order.'; return; }
  const keys = [...VO_PICKED];
  if (!keys.length) return;
  const rows = keys.map(k => {
    const c = k.indexOf('/');
    return (VO.rows || []).find(x => x.vendorCode === k.slice(0, c) && x.id === k.slice(c + 1));
  }).filter(Boolean);
  const held = rows.filter(o => voDeliveredCount(o) > 0);
  const free = rows.filter(o => voDeliveredCount(o) === 0);

  if (!free.length) {
    $('voMsg').className = 'err';
    $('voMsg').textContent = `None of the ${nf(rows.length)} ticked order(s) can be deleted — every one has `
      + 'deliveries recorded against it. Cancel them instead; that keeps what the printer sent.';
    return;
  }
  /* Said before it happens, and it names what is being kept as well as what is going. */
  if (!confirm(`Delete ${nf(free.length)} vendor order(s)?\n\n`
    + 'They disappear from this list and from the printer\'s portal. This cannot be undone.\n\n'
    + (held.length ? `${held.length} of the ticked order(s) will be LEFT ALONE because deliveries have been `
      + 'recorded against them: ' + held.map(o => o.orderNo || o.id).slice(0, 5).join(', ') + '.' : ''))) return;

  const patch = {};
  free.forEach(o => { patch['pt_vendorOrders/' + o.vendorCode + '/' + o.id] = null; });
  try { await ptPatch(patch); }
  catch (e) { $('voMsg').className = 'err'; $('voMsg').textContent = 'Not deleted: ' + (e.message || e); return; }
  const gone = new Set(free.map(o => o.vendorCode + '/' + o.id));
  VO.rows = (VO.rows || []).filter(x => !gone.has(x.vendorCode + '/' + x.id));
  VO_PICKED = new Set();
  renderVo();
  $('voMsg').className = held.length ? 'err' : 'muted';
  $('voMsg').textContent = `${nf(free.length)} order(s) deleted.`
    + (held.length ? ` ${nf(held.length)} were kept because deliveries are recorded against them: `
      + held.map(o => o.orderNo || o.id).join(', ') + '.' : '');
}

