/* ================= FINISHED GOODS: CHANGING AND REMOVING, ONE OR MANY =================
 *
 * Ravi: "finish goods ko me edit kr pau or delete kar pau bulk me bhi single bhi and team ko access
 * de pau view or edit".
 *
 * WHO. The Finished Goods tab on its own is now VIEW ONLY. Making an entry, changing one, deleting
 * one — singly or ticked in bulk — needs perms.fgiEdit ("Can edit finished goods" in Sellora →
 * Access). Admins have it always. The buttons are hidden without it, and every save refuses again,
 * because a page left open while access is withdrawn still has the old buttons drawn on it.
 *
 * WHAT AN EDIT IS. The store is still a ledger: an edit changes the movement, and the balance follows
 * because the balance is only ever what the movements add up to. What an edit must not do is lose
 * what the row said before — so every change appends {at, by, was} to the row's `edits`, and only
 * the fields that changed are written. Writing the whole row back would overwrite whatever the FBA
 * team did to it in the meantime.
 *
 * WHAT CANNOT BE EDITED FREELY.
 *   · a marker (RECEIPT_CONFIRM, RETURN_TO_PRESS) — it records a transfer, it is not a movement;
 *   · a TRANSFER_IN's pieces or SKU — a press row gave exactly those pieces up;
 *   · an FBA dispatch the FBA team has already accepted, shipped or returned part of — its pieces and
 *     SKU are what they acted on. Undo their step in FBA Dispatch first;
 *   · an FBA_RETURN's pieces — the dispatch it came back from carries the same figure.
 * Those rows still take a new date, reason and note.
 *
 * AN EDIT MAY NOT PUSH A SKU BELOW ZERO — unless it was already there and the edit makes it no worse.
 * Three SKUs are negative today; refusing every edit on them would stop anyone putting them right.
 *
 * DELETING, ONE OR MANY, GOES THROUGH ONE PLAN (fgiDeletePlan), so a bulk delete cannot do anything a
 * single delete would refuse: a transfer takes its markers and gives its pieces back to press; an FBA
 * dispatch takes its returns with it; a return deleted alone takes its pieces back off the dispatch.
 * Everything goes in ONE PATCH — all of it happens or none of it does.
 *
 * DELETING A SKU from the stock view deletes every movement it has. It is the heaviest button on the
 * screen, so the confirmation names the pieces, the movements and anything going back to press.
 *
 * CORRECTING A COUNT from the stock view does not rewrite history: it writes one OPENING row marked
 * `adjust: true` for the difference, which is what a count correction has always been here.
 */
const fgiCanEdit = () => !spIsVendor() && !!(ME.admin || ME.fgiEdit);
const FGI_NO_EDIT = 'Only somebody with "Can edit finished goods" (or an admin) can change the store. '
  + 'Ask an admin to tick it in Sellora → Settings → Access.';

/** What a row does to its SKU's balance, signed. Markers and pieces still in transit do nothing. */
function fgiEffect(r) {
  if (!r) return 0;
  const q = fgiNum(r.qty);
  switch (r.txnType) {
    case 'OPENING': case 'RECEIVE': case 'FBA_RETURN': return q;
    case 'TRANSFER_IN': return (r.confirmed === true && r.reversed !== true) ? q : 0;
    case 'ISSUE': case 'FBA': return -q;
    default: return 0;
  }
}
const fgiIsMarker = r => !!r && (r.txnType === 'RECEIPT_CONFIRM' || r.txnType === 'RETURN_TO_PRESS');
const fgiRowId = r => (r && (r._id || r.id)) || '';
const fgiDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ''); };

/** Ticked rows, per view: SKUs on the stock view, movement ids on the ledger. */
let FGI_PICK = { stock: new Set(), ledger: new Set() };

/* ---- one plan for every delete ---- */
function fgiDeletePlan(ids) {
  const rows = FGI.rows || [];
  const byId = new Map(rows.map(r => [fgiRowId(r), r]));
  const want = new Set(ids);
  const updates = {}, gone = new Set(), refused = [], notes = [];
  const pressBack = new Map();          // press key -> pieces given back
  const fbaBack = new Map();            // FBA dispatch id -> returned pieces removed with its return rows
  const take = id => { gone.add(id); updates['pt_fgiLedger/' + id] = null; };

  ids.forEach(id => {
    const r = byId.get(id);
    if (!r) { refused.push({ id, sku: '', why: 'gone already' }); return; }
    if (gone.has(id)) return;
    if (fgiIsMarker(r)) {
      if (!want.has(r.linkedTransferId)) refused.push({ id, sku: obUC(r.sku),
        why: 'a marker for a transfer, not a movement of its own — delete the transfer itself and this goes with it' });
      return;
    }
    if (r.txnType === 'FBA_RETURN' && !want.has(r.linkedFbaId)) {
      const parent = byId.get(r.linkedFbaId);
      if (parent && parent.fbaShippedAt) {
        refused.push({ id, sku: obUC(r.sku), why: 'the rest of that FBA dispatch is already shipped — undo the shipment in FBA Dispatch first' });
        return;
      }
      if (parent) fbaBack.set(fgiRowId(parent), (fbaBack.get(fgiRowId(parent)) || 0) + fgiNum(r.qty));
    }
    take(id);
    if (r.txnType === 'TRANSFER_IN') {
      rows.forEach(x => { if (x && x.linkedTransferId === id) take(fgiRowId(x)); });
      /* The press row gave these pieces up. Deleting the transfer without giving them back would lose
       * them to both sides — gone from the store and still counted as sent from press. */
      const press = (PTG.press || []).find(x => (x.id || x._key) === r.fromPress);
      if (!r.reversed && press) pressBack.set(press.id || press._key, (pressBack.get(press.id || press._key) || 0) + fgiNum(r.qty));
      else if (!r.reversed && r.fromPress)
        notes.push(`${obUC(r.sku)}: its press entry could not be found, so nothing was given back to it — check Press Inventory.`);
    }
    if (r.txnType === 'FBA') {
      rows.forEach(x => { if (x && x.txnType === 'FBA_RETURN' && x.linkedFbaId === id) take(fgiRowId(x)); });
      if (r.fbaShippedAt) notes.push(`${obUC(r.sku)}: the FBA team marked this dispatch SHIPPED`
        + `${r.fbaShipment ? ' (' + r.fbaShipment + ')' : ''} — deleting it puts those pieces back in the store.`);
      else if (r.fbaAcceptedAt) notes.push(`${obUC(r.sku)}: the FBA team had already accepted this dispatch.`);
    }
  });
  /* A return row whose dispatch is itself being deleted needs no correction on the dispatch. */
  fbaBack.forEach((q, pid) => {
    if (gone.has(pid)) return;
    const p = byId.get(pid);
    updates['pt_fgiLedger/' + pid + '/fbaReturned'] = Math.max(0, fgiNum(p.fbaReturned) - q);
  });
  pressBack.forEach((q, key) => {
    const press = (PTG.press || []).find(x => (x.id || x._key) === key);
    updates['pt_pressInventory/' + key + '/transferredQty'] = Math.max(0, fgiNum(press && press.transferredQty) - q);
  });

  const delta = new Map();
  gone.forEach(id => {
    const r = byId.get(id), sku = obUC(r.sku);
    delta.set(sku, (delta.get(sku) || 0) - fgiEffect(r));
  });
  const stock = fgiStock();   // once — fgiOf per SKU would re-add the whole ledger for every one of them
  const skus = [...delta.keys()].map(sku => {
    const before = (stock.get(sku) || { current: 0 }).current;
    return { sku, before, after: before + delta.get(sku) };
  });
  return { updates, gone: [...gone], refused, notes, skus, pressBack, fbaBack, rows: [...gone].map(id => byId.get(id)) };
}

async function fgiDeleteRun(plan) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  if (!plan.gone.length) return plan.refused.length ? 'Nothing could be deleted: ' + plan.refused[0].why + '.' : 'Nothing is ticked.';
  /* THE STORE MAY NOT GO BELOW ZERO — this was the hole. Every other path checks it (an issue, a
   * dispatch, a scan, an edit, a count), but deleting a receipt whose pieces had already gone to FBA
   * did not, and left the store owing stock it never had. The pieces that went out are the entry to
   * fix first; until that is gone, the receipt behind it stays. */
  const short = (plan.skus || []).filter(x => x.after < 0 && x.after < x.before);
  if (short.length) return `That would take ${short.map(x => `${x.sku} to ${nf(x.after)}`).join(', ')} — below zero. `
    + `Those pieces have already left the store, so the movement that took them out has to go first `
    + `(or be corrected) — a store cannot hold less than nothing.`;
  await ptPatch(plan.updates);
  plan.pressBack.forEach((q, key) => {
    const press = (PTG.press || []).find(x => (x.id || x._key) === key);
    if (press) press.transferredQty = Math.max(0, fgiNum(press.transferredQty) - q);
  });
  const goneSet = new Set(plan.gone);
  FGI.rows = (FGI.rows || []).filter(x => !goneSet.has(fgiRowId(x)));
  plan.fbaBack.forEach((q, pid) => {
    const p = (FGI.rows || []).find(x => fgiRowId(x) === pid);
    if (p) p.fbaReturned = Math.max(0, fgiNum(p.fbaReturned) - q);
  });
  plan.gone.forEach(id => { FGI_PICK.ledger.delete(id); });
  return '';
}

/* ---- ticking ---- */
function fgiPickCount() {
  const view = $('fgView').value;
  const set = view === 'stock' ? FGI_PICK.stock : (view === 'ledger' ? FGI_PICK.ledger : null);
  const n = set ? set.size : 0;
  const can = fgiCanEdit() && !!set;
  $('fgEditPicked').classList.toggle('hide', !(can && n));
  $('fgDelPicked').classList.toggle('hide', !(can && n));
  $('fgEditPicked').textContent = `Edit ${nf(n)} ticked`;
  $('fgDelPicked').textContent = `Delete ${nf(n)} ticked`;
  return n;
}

/* ---- one movement ---- */
function fgiEditOpen(id) {
  if (!fgiCanEdit()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = FGI_NO_EDIT; return; }
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return;
  if (fgiIsMarker(r)) {
    $('fgMsg').className = 'err';
    $('fgMsg').textContent = 'That row is a marker for a transfer, not a movement — it cannot be edited on its own.';
    return;
  }
  const locked = fgiEditLocked(r);
  const full = !locked;
  const types = r.txnType === 'OPENING' ? ['OPENING'] : Object.keys(FGI_KINDS);
  const lbl = t => t === 'OPENING' ? (r.adjust ? 'Count correction' : 'Opening stock') : FGI_KINDS[t].label;
  const who = r.issuedFor || r.receivedFrom || '';
  const k = FGI_KINDS[r.txnType];
  const dis = full ? '' : ' disabled';
  ptOpenDialog({
    title: 'Edit this movement',
    subtitle: `${String(r.txnType).replace(/_/g, ' ').toLowerCase()} · ${obUC(r.sku)} · ${nf(fgiNum(r.qty))} piece(s)`,
    note: locked || 'The balance follows the movement, because it is only ever what the movements add up to. '
      + 'What the row said before is kept on the row.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Type<select id="fgeType"${dis || (types.length < 2 ? ' disabled' : '')}>${types.map(t =>
          `<option value="${t}"${t === r.txnType ? ' selected' : ''}>${esc(lbl(t))}</option>`).join('')}</select></label>
        <label>Date<input id="fgeDate" type="date" value="${esc(ptIsoDate(r.date) || String(r.createdAt || '').slice(0, 10))}"></label>
        <label style="grid-column:1/-1">SKU<input id="fgeSku" value="${esc(obUC(r.sku))}"${dis}
          style="font-family:ui-monospace,monospace;text-transform:uppercase"></label>
        <label>Pieces<input id="fgeQty" type="number" step="1" value="${esc(fgiNum(r.qty))}"${dis}></label>
        <label><span id="fgeWhoLbl">${esc(k ? k.who : (r.txnType === 'FBA_RETURN' ? 'Returned by' : 'From / for'))}</span>
          <input id="fgeWho" type="text" value="${esc(who)}"${k ? '' : ' disabled'}></label>
        <label>Order No <span class="muted" style="font-weight:400">(receive)</span><input id="fgeOrd" value="${esc(r.orderNo || '')}"${full ? '' : ' disabled'}
          style="font-family:ui-monospace,monospace;text-transform:uppercase"></label>
        <label>Reason<input id="fgeReason" type="text" value="${esc(r.reason || '')}"></label>
        <label style="grid-column:1/-1">Note<input id="fgeRemarks" type="text" value="${esc(r.remarks || '')}"></label>
      </div>
      <div id="fgeInfo" class="muted" style="margin-top:8px;font-size:12.5px">${(r.edits && r.edits.length)
        ? `Changed ${nf(r.edits.length)} time(s) before — last by ${esc(String(r.edits[r.edits.length - 1].by || '').split('@')[0])}`
          + ` on ${esc(String(r.edits[r.edits.length - 1].at || '').slice(0, 10))}.` : ''}</div>`,
    onSave: () => fgiEditSave(id),
    saveLabel: 'Save the change',
  });
  const t = $('fgeType');
  if (t && t.addEventListener) t.addEventListener('change', () => {
    const kk = FGI_KINDS[t.value]; if (kk && $('fgeWhoLbl')) $('fgeWhoLbl').textContent = kk.who;
  });
}

/** Why a row's pieces, SKU and type cannot be changed, or '' when they can. */
function fgiEditLocked(r) {
  if (r.txnType === 'TRANSFER_IN') return 'A transfer from press: its pieces and SKU are what the press entry gave up, so only the date, reason and note can change here.';
  if (r.txnType === 'FBA_RETURN') return 'Pieces returned by the FBA team: the dispatch they came back from carries the same figure, so only the date, reason and note can change. Delete the return to undo it.';
  if (r.txnType === 'FBA' && (r.fbaAcceptedAt || r.fbaShippedAt || fgiNum(r.fbaReturned) > 0))
    return 'The FBA team has already acted on this dispatch, so its pieces, SKU and type are fixed. Undo their step in FBA Dispatch to change them; the date, reason and note can still change.';
  return '';
}

/* fgiEditSave now lives beside fgiEditApply, under FINISHED GOODS: ASKING FOR A CORRECTION. */

/* ---- many movements ---- */
function fgiBulkEditOpen() {
  if (!fgiCanEdit()) return;
  const ids = [...FGI_PICK.ledger];
  const rows = (FGI.rows || []).filter(r => ids.indexOf(fgiRowId(r)) >= 0 && !fgiIsMarker(r));
  if (!rows.length) return;
  ptOpenDialog({
    title: `Edit ${nf(rows.length)} movement(s)`,
    subtitle: `${nf(new Set(rows.map(r => obUC(r.sku))).size)} SKU(s)`,
    note: 'Fill in only what should change — a box left empty leaves that field as it is on every row. '
      + 'Pieces, SKU and type are changed one row at a time, where the balance they move can be checked.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Date<input id="fgbDate" type="date"></label>
        <label>Issued to / received from<input id="fgbWho" type="text" placeholder="leave as it is"></label>
        <label>Reason<input id="fgbReason" type="text" placeholder="leave as it is"></label>
        <label style="grid-column:1/-1">Note<input id="fgbRemarks" type="text" placeholder="leave as it is"></label>
      </div>`,
    onSave: () => fgiBulkEditSave(),
    saveLabel: 'Change them',
  });
}

async function fgiBulkEditSave() {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const v = id => String((($(id) || {}).value) || '').trim();
  const date = v('fgbDate') ? fgiDmy(v('fgbDate')) : '';
  const who = v('fgbWho'), reason = v('fgbReason'), remarks = v('fgbRemarks');
  if (!date && !who && !reason && !remarks) return 'Nothing to change — every box is empty.';
  const ids = [...FGI_PICK.ledger];
  const rows = (FGI.rows || []).filter(r => ids.indexOf(fgiRowId(r)) >= 0 && !fgiIsMarker(r));
  const updates = {}, touched = [];
  let noWho = 0;
  const now = new Date().toISOString();
  rows.forEach(r => {
    const id = fgiRowId(r), was = {}, set = {};
    if (date && date !== r.date) { was.date = r.date || ''; set.date = date; }
    if (reason && reason !== (r.reason || '')) { was.reason = r.reason || ''; set.reason = reason; }
    if (remarks && remarks !== (r.remarks || '')) { was.remarks = r.remarks || ''; set.remarks = remarks; }
    const k = FGI_KINDS[r.txnType];
    if (who) {
      if (!k) noWho++;
      else {
        const f = k.dir < 0 ? 'issuedFor' : 'receivedFrom';
        if (who !== (r[f] || '')) { was[f] = r[f] || ''; set[f] = who; }
      }
    }
    if (!Object.keys(set).length) return;
    Object.keys(set).forEach(f => { updates['pt_fgiLedger/' + id + '/' + f] = set[f]; });
    updates['pt_fgiLedger/' + id + '/edits'] = (Array.isArray(r.edits) ? r.edits : []).concat({ at: now, by: ME.email, was });
    touched.push([r, set, updates['pt_fgiLedger/' + id + '/edits']]);
  });
  if (!touched.length) return 'Every ticked row already says that — nothing to change.';
  await ptPatch(updates);
  touched.forEach(([r, set, edits]) => { Object.assign(r, set); r.edits = edits; });
  FGI_PICK.ledger = new Set();
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(touched.length)} movement(s) changed`
    + (noWho ? ` · the name was left alone on ${nf(noWho)} row(s) that are not a receive, issue or FBA dispatch` : '')
    + ' · no balance moved, because no pieces changed.';
  return '';
}

/** The confirmation for anything more than one row: what goes, what it does, and what cannot go. */
function fgiDeleteConfirm(plan, title) {
  const neg = plan.skus.filter(s => s.after < 0 && s.after < s.before);
  const inStock = plan.skus.reduce((s, x) => s + Math.abs(x.after - x.before), 0);
  const press = [...plan.pressBack.values()].reduce((s, q) => s + q, 0);
  const list = plan.skus.slice().sort((a, b) => (a.after - a.before) - (b.after - b.before)).slice(0, 40);
  ptOpenDialog({
    title,
    subtitle: `${nf(plan.gone.length)} movement(s) · ${nf(plan.skus.length)} SKU(s)`,
    note: 'Deleting a movement moves the stock back — the balance is only ever what the movements add up to. '
      + 'It cannot be undone from here.',
    html: `<div style="font-size:12.5px">
        ${inStock ? `<div>${nf(inStock)} piece(s) of stock change as a result.</div>` : ''}
        ${press ? `<div>${nf(press)} piece(s) go back to their press entries.</div>` : ''}
        ${neg.length ? `<div class="err">${nf(neg.length)} SKU(s) would go BELOW ZERO: ${esc(neg.slice(0, 8).map(s => s.sku + ' → ' + nf(s.after)).join(', '))}${neg.length > 8 ? '…' : ''}</div>` : ''}
        ${plan.refused.length ? `<div class="err">${nf(plan.refused.length)} ticked row(s) will NOT be deleted — ${esc(plan.refused[0].why)}.</div>` : ''}
        ${plan.notes.map(n => `<div class="err">${esc(n)}</div>`).join('')}
        <table class="xl" style="margin-top:8px"><thead><tr><th>SKU</th><th class="num">Now</th><th class="num">After</th></tr></thead><tbody>
        ${list.map(s => `<tr><td style="font-family:ui-monospace,monospace;text-align:left">${esc(s.sku)}</td>`
          + `<td class="num">${nf(s.before)}</td><td class="num" style="font-weight:700;color:${s.after < 0 ? 'var(--bad)' : 'inherit'}">${nf(s.after)}</td></tr>`).join('')}
        </tbody></table>${plan.skus.length > list.length ? `<div class="muted">…and ${nf(plan.skus.length - list.length)} more</div>` : ''}
      </div>`,
    onSave: async () => {
      const why = await fgiDeleteRun(plan);
      if (why) return why;
      renderFgi();
      $('fgMsg').className = 'muted';
      $('fgMsg').textContent = `Deleted ${nf(plan.gone.length)} movement(s) across ${nf(plan.skus.length)} SKU(s)`
        + (press ? ` · ${nf(press)} piece(s) back on their press entries` : '')
        + (plan.refused.length ? ` · ${nf(plan.refused.length)} left alone (${plan.refused[0].why})` : '') + '.';
      return '';
    },
    saveLabel: plan.gone.length ? `Delete ${nf(plan.gone.length)}` : 'Delete',
  });
}

function fgiBulkDeleteAsk() {
  if (!fgiCanEdit()) return;
  const plan = fgiDeletePlan([...FGI_PICK.ledger]);
  FGI_PICK.ledger = new Set();
  fgiDeleteConfirm(plan, 'Delete the ticked movements');
}

/* ---- the stock view: a SKU, or many ---- */
function fgiSkuEditOpen(sku) {
  if (!fgiCanEdit()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = FGI_NO_EDIT; return; }
  const s = obUC(sku), cur = (FGI.set || {})[s] || {}, m = fgiMaster(s), b = fgiOf(s);
  const price = parseFloat(m.inventoryValuationPrice);
  ptOpenDialog({
    title: 'Edit ' + s,
    subtitle: [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · '),
    note: 'Change the in-stock figure to what was actually counted: the difference is written as one '
      + 'count-correction row, so the history still adds up. The re-order level turns the status amber; '
      + 'the tag is your own note.' + (isFinite(price) ? ` Valuation price on the master database: ${nf(price)}.` : ''),
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>In stock (counted)<input id="fgkCount" type="number" step="1" value="${esc(b.current)}"></label>
        <label>Why it changed<input id="fgkReason" type="text" placeholder="e.g. physical count"></label>
        <label>Re-order level<input id="fgkReorder" type="number" min="0" step="1" value="${esc(cur.reorder == null ? '' : cur.reorder)}"></label>
        <label>Tag<select id="fgkTag">${['', 'Listed', 'Need listing', 'Discontinue', 'Etsy'].map(t =>
          `<option value="${esc(t)}"${t === (cur.remark || '') ? ' selected' : ''}>${esc(t || '— none —')}</option>`).join('')}</select></label>
      </div>
      <div class="muted" style="margin-top:8px;font-size:12.5px">${nf(b.current)} in stock now · ${nf(b.moves || 0)} movement(s) on record</div>`,
    onSave: () => fgiSkuEditSave(s),
    saveLabel: 'Save',
    /* The alt button closes this dialog when it returns nothing, so the confirmation opens just after. */
    alt: { label: 'Delete this SKU from the store', run: () => { setTimeout(() => fgiSkuDeleteAsk([s]), 0); return ''; } },
  });
}

async function fgiSkuEditSave(sku) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const s = obUC(sku), b = fgiOf(s), cur = (FGI.set || {})[s] || {};
  const v = id => String((($(id) || {}).value) == null ? '' : ($(id) || {}).value).trim();
  const count = v('fgkCount') === '' ? b.current : parseInt(v('fgkCount'), 10);
  if (!isFinite(count) || count < 0) return 'The counted figure has to be a whole number, zero or more.';
  const diff = count - b.current;
  const reason = v('fgkReason');
  if (diff && !reason) return `That changes ${s} by ${diff > 0 ? '+' : ''}${nf(diff)} — say why (a count, damage found…).`;
  const n = parseFloat(v('fgkReorder'));
  const reorder = isFinite(n) && n > 0 ? n : null;
  const remark = v('fgkTag');
  const setChanged = String(reorder == null ? '' : reorder) !== String(cur.reorder == null ? '' : cur.reorder)
    || remark !== (cur.remark || '');
  if (!diff && !setChanged) return 'Nothing was changed.';
  const updates = {};
  let rec = null;
  if (diff) {
    rec = { _id: fgiNewId('ADJ'), txnType: 'OPENING', adjust: true, sku: s, qty: diff,
      date: fgiDmy(dToday()), reason, receivedFrom: 'Stock count',
      remarks: `counted ${count}, the ledger said ${b.current}`,
      createdAt: new Date().toISOString(), createdBy: ME.email };
    updates['pt_fgiLedger/' + rec._id] = rec;
  }
  let row = null;
  if (setChanged) {
    row = { reorder, remark, at: new Date().toISOString(), by: ME.email };
    updates['pt_fgiSettings/' + s] = row;
  }
  await ptPatch(updates);
  if (rec) FGI.rows = (FGI.rows || []).concat(rec);
  if (row) { FGI.set = FGI.set || {}; FGI.set[s] = row; }
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${s}: ` + [diff ? `stock corrected by ${diff > 0 ? '+' : ''}${nf(diff)} to ${nf(fgiOf(s).current)}` : '',
    setChanged ? 're-order level and tag saved' : ''].filter(Boolean).join(' · ') + '.';
  return '';
}

function fgiSkuBulkEditOpen() {
  if (!fgiCanEdit()) return;
  const skus = [...FGI_PICK.stock]; if (!skus.length) return;
  ptOpenDialog({
    title: `Edit ${nf(skus.length)} SKU(s)`,
    subtitle: skus.slice(0, 6).join(', ') + (skus.length > 6 ? '…' : ''),
    note: 'Only what you fill in changes. Stock figures are corrected one SKU at a time (Edit on the row), '
      + 'where the count can be checked against what the ledger says.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Tag<select id="fgbTag"><option value="_keep">— leave as it is —</option>${['', 'Listed', 'Need listing', 'Discontinue', 'Etsy'].map(t =>
          `<option value="${esc(t)}">${esc(t || 'No tag')}</option>`).join('')}</select></label>
        <label>Re-order level<input id="fgbReorder" type="number" min="0" step="1" placeholder="leave as it is — 0 clears it"></label>
      </div>`,
    onSave: () => fgiSkuBulkEditSave(),
    saveLabel: 'Change them',
  });
}

async function fgiSkuBulkEditSave() {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const tag = (($('fgbTag') || {}).value);
  const ro = String((($('fgbReorder') || {}).value) || '').trim();
  const keepTag = tag == null || tag === '_keep';
  if (keepTag && ro === '') return 'Nothing to change — pick a tag or put in a re-order level.';
  const n = parseFloat(ro);
  if (ro !== '' && (!isFinite(n) || n < 0)) return 'The re-order level has to be zero or more.';
  const skus = [...FGI_PICK.stock];
  const updates = {}, now = new Date().toISOString();
  skus.forEach(s => {
    if (!keepTag) updates['pt_fgiSettings/' + s + '/remark'] = tag;
    if (ro !== '') updates['pt_fgiSettings/' + s + '/reorder'] = n > 0 ? n : null;
    updates['pt_fgiSettings/' + s + '/at'] = now;
    updates['pt_fgiSettings/' + s + '/by'] = ME.email;
  });
  await ptPatch(updates);
  FGI.set = FGI.set || {};
  skus.forEach(s => {
    const row = Object.assign({}, FGI.set[s] || {}, { at: now, by: ME.email });
    if (!keepTag) row.remark = tag;
    if (ro !== '') row.reorder = n > 0 ? n : null;
    FGI.set[s] = row;
  });
  FGI_PICK.stock = new Set();
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(skus.length)} SKU(s) changed`
    + (!keepTag ? ` · tag ${tag ? '"' + tag + '"' : 'cleared'}` : '')
    + (ro !== '' ? ` · re-order level ${n > 0 ? nf(n) : 'cleared'}` : '') + '.';
  return '';
}

function fgiSkuDeleteAsk(skus) {
  if (!fgiCanEdit()) return;
  const want = new Set(skus.map(obUC));
  const ids = (FGI.rows || []).filter(r => r && want.has(obUC(r.sku))).map(fgiRowId);
  const plan = fgiDeletePlan(ids);
  FGI_PICK.stock = new Set();
  fgiDeleteConfirm(plan, want.size === 1 ? `Delete ${[...want][0]} from the store` : `Delete ${nf(want.size)} SKU(s) from the store`);
}

