/* ================= INDIA STORE: REPEAT FBA DISPATCH NEEDS APPROVAL =================
 * Business rule (27 Nov, agreed): when a SKU already went from the store to FBA in the past 7 days (India dates), a new FBA
 * entry first shows that date, the pieces and who sent them, with Continue or Cancel. Cancel saves nothing. Continue saves a
 * request, with who is doing the FBA; those pieces stay in the store until the FBA repeat approver (the shipping head) or an
 * admin approves. The other SKUs of the same save go straight away. When an approver is the sender, Continue is the
 * approval, and is recorded. A rejection carries a reason the requester sees. Stock and FBA limits are checked when asking
 * and again at approval; an admin's release is used up only when the pieces leave.
 * The four ways that ask: the entry form, FG Scanning (FBA out, at "Save all"), Scan to pack and Pack & verify. An edit
 * cannot ask: one that sends more of such a SKU is for an approver only.
 * A packing list goes whole or not at all: while a SKU of it waits, none of its movements are written and it stays open.
 * Finished again, an approved SKU counts as already written and a rejected one stops the list. Taking a waiting SKU's boxes
 * out withdraws its request; an approved SKU's pieces have left the store, so its boxes stay unless that movement is
 * deleted.
 *
 * Requests sit at pt_fgiSettings/_fbaRepeat/<id> = { sku, qty, status: waiting | approving | approved | rejected | withdrawn, row (the
 * ledger movement to be written), recent, askedBy, askedAt, decidedBy, decidedAt, reason }. <id> is also the movement's own
 * id, so asking or approving twice makes one movement. The database rules let any non-vendor account with access rights
 * write there: who may approve is checked by this screen, not by the database.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — the store or the requests cannot be read, a request or approval cannot be saved: said, with what to
 *   do; nothing leaves the store. 'approving' means an approval started and did not finish: it can be done again after
 *   2 minutes.
 *   quiet, with a console line — reading the requests to draw the list, and putting a failed approval back to waiting.
 *
 * With switch fbaList also on (fba-lists.js, 28 Nov: stock goes to FBA by a list only), nothing new is asked or approved here:
 * a request made earlier can only be rejected, and the SKU is then ticked on Finished Goods and put on a list.
 *
 * BEHIND SWITCH storeAlloc (fg-store-alloc.js). Off, every save behaves as before. */
const FAP_PATH = 'pt_fgiSettings/_fbaRepeat';
const FAP_DAYS = 7;
const FAP_CLAIM_MS = 2 * 60 * 1000;   // an approval that has not finished by now never will
const FAP_NOT_APPROVER = 'Only the FBA repeat approver or an admin can decide a repeat FBA request.';
const FAP_REJECT_INSTEAD = 'A request made earlier cannot be approved: reject it.';

const fapOn = () => fgaOn();
const fapMayApprove = () => !spIsVendor() && !!(ME.admin || ME.fbaRepeatApprove);

/* ---- what went to FBA lately ---- */
/** The India date a movement was made on, as YYYY-MM-DD. */
function fapDayOf(r) {
  const ms = Date.parse(r.createdAt);
  return ms ? new Date(ms + 330 * 60000).toISOString().slice(0, 10) : ptIsoDate(r.date) || '';
}
/** A SKU's dispatches of the past 7 days that did not all come back, newest first. without: a movement to leave out. */
function fapRecent(sku, without) {
  const since = dAdd(dTodayIndia(), -FAP_DAYS), key = shpHoldKey(sku);
  return (FGI.rows || []).filter(r => {
    if (!r || r.txnType !== 'FBA' || shpHoldKey(r.sku) !== key || (without && (r._id || r.id) === without)) return false;
    const { st, open } = fbaState(r);
    return st !== 'sheet' && open > 0 && fapDayOf(r) >= since;
  }).sort((a, b) => fapDayOf(b).localeCompare(fapDayOf(a)));
}

/* ---- the requests ---- */
const fapAll = () => (FGI.set || {})._fbaRepeat || {};
const fapKeep = node => { FGI.set = Object.assign({}, FGI.set, { _fbaRepeat: node }); };
const fapKeepOne = (id, request) => fapKeep(Object.assign({}, fapAll(), { [id]: request }));
const fapClaimStale = q => q.status === 'approving' && Date.now() - Date.parse(q.decidedAt) > FAP_CLAIM_MS;
/** Can it still be decided? */
const fapOpen = q => !!q && (q.status === 'waiting' || fapClaimStale(q));
/** Read the requests as they are now. '' when read, else the sentence to show. */
async function fapReread() {
  try { fapKeep((await ptGetFresh(FAP_PATH)) || {}); return ''; }
  catch (e) {
    console.warn('Repeat FBA: the requests could not be read:', e.message || e);
    return 'The repeat FBA requests could not be read (' + (e.message || e) + '). Check the connection and try again.';
  }
}
function fapRequest(row, status) {
  return { sku: row.sku, qty: row.qty, status, row, askedBy: ME.email, askedAt: row.createdAt,
    recent: fapRecent(row.sku).map(r => ({ day: fapDayOf(r), qty: fgiNum(r.qty), by: r.createdBy || '' })) };
}

/* ---- asking ---- */
/** Why these new dispatches cannot be made as things stand, or ''. */
function fapLimitWhy(rows) {
  const bySku = new Map();
  rows.forEach(r => bySku.set(r.sku, (bySku.get(r.sku) || 0) + fgiNum(r.qty)));
  const wants = [...bySku].map(([sku, qty]) => ({ sku, qty, current: fgiOf(sku).current }));
  const short = wants.find(w => w.qty > w.current);
  if (short) return `${short.sku} has ${nf(Math.max(0, short.current))} piece(s) in the India Store, not ${nf(short.qty)}.`;
  return fgiHoldRefusal(wants);
}
const fapWho = email => String(email || '').split('@')[0] || 'not known';
const fapSentText = list => list.map(r => `${nf(r.qty)} pcs on ${ptDayWords(r.day)} by ${fapWho(r.by)}`).join('; ');
/** What the Continue / Cancel box says. */
function fapAskText(rows, approver) {
  const lines = rows.map(row => {
    const waiting = Object.values(fapAll()).filter(q => q.status === 'waiting' && shpHoldKey(q.sku) === shpHoldKey(row.sku));
    return `${row.sku} (${nf(row.qty)} pcs now) — already sent: ${fapSentText(fapRequest(row, '').recent)}`
      + (waiting.length ? `. Already waiting for approval: ${waiting.map(q => `${nf(q.qty)} pcs by ${fapWho(q.askedBy)}`).join('; ')}` : '');
  });
  return `Sent to FBA in the past ${FAP_DAYS} days:\n\n${lines.join('\n')}\n\n` + (approver
    ? 'Continue counts as your approval, and is recorded. Cancel saves nothing.'
    : 'Continue asks the FBA repeat approver: these stay in the store until approved ('
      + (rows[0].packId ? 'the whole packing list waits' : 'other SKUs go now') + '). Cancel saves nothing.');
}
/** The Continue / Cancel box, above whatever screen is open. Answers true for Continue. */
function fapAsk(text) {
  return new Promise(answer => {
    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    box.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    box.innerHTML = '<div class="card" style="max-width:560px;max-height:85vh;overflow:auto;padding:18px"><div data-fap-text style="white-space:pre-line"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="ghost" data-fap="0">Cancel</button>'
      + '<button type="button" data-fap="1">Continue</button></div></div>';
    box.querySelector('[data-fap-text]').textContent = text;
    box.onclick = e => { const b = e.target.closest('[data-fap]'); if (!b) return; box.remove(); answer(b.dataset.fap === '1'); };
    document.body.appendChild(box);
  });
}

/* ---- asked before, under the same form, scan batch or packing list ---- */
const fapIdOf = (stem, sku) => 'FBAR-' + shpHoldKey(stem + '-' + sku);
const fapMovement = id => (FGI.rows || []).find(r => r && (r._id || r.id) === id);
/** Has this SKU of a packing list already left the store by an approval? */
function fapApproved(stem, sku) {
  const id = fapIdOf(stem, sku);
  return fapOn() && (fapAll()[id] || {}).status === 'approved' && !!fapMovement(id);
}
/** Why what was asked before does not allow this row to be saved, or ''. */
function fapEarlierWhy(row, request, id) {
  const { status, qty } = request;
  if (status === 'rejected') return `${row.sku} was rejected for FBA by ${fapWho(request.decidedBy)}: ${request.reason}. Take it out and save again.`;
  if (status === 'approved' && !fapMovement(id))
    return `${row.sku} was approved, but its movement has since been deleted in Finished Goods. Take it out and send it afresh.`;
  if (fgiNum(qty) === row.qty) return '';
  return status === 'approved'
    ? `${row.sku}: ${nf(qty)} pcs were approved and have left the store, but ${nf(row.qty)} are here. Make it ${nf(qty)} again.`
    : `${row.sku} was already asked for with ${nf(qty)} pcs, not ${nf(row.qty)}. Make it ${nf(qty)} again, or have the request rejected.`;
}
/** A packing list's requests whose SKU is no longer in it: { stop } or { removed: [[id, request]] still to withdraw }. */
function fapRemoved(rows, stem) {
  const here = new Set(rows.map(r => fapIdOf(stem, r.sku))), removed = [];
  for (const [id, q] of Object.entries(fapAll()).filter(([id, q]) => q.row.packId === stem && !here.has(id))) {
    if (q.status === 'approved' && fapMovement(id))
      return { stop: `${q.sku}: ${nf(q.qty)} pcs were approved and have left the store for this list. Put those boxes back, or delete that movement in Finished Goods first.` };
    if (q.status === 'approving' && !fapClaimStale(q)) return { stop: `${q.sku}: ${fapDecidedWhy(q)}` };
    if (fapOpen(q)) removed.push([id, q]);
  }
  return { removed };
}
/** The rows of a save sorted by what was asked before: { stop }, or { fresh, held (still waiting), written (approved, the
 *  movement is there), removed }. */
function fapEarlier(rows, stem) {
  const gone = fapRemoved(rows, stem);
  if (gone.stop) return gone;
  const out = { fresh: [], held: [], written: [], removed: gone.removed };
  for (const row of rows) {
    const id = fapIdOf(stem, row.sku), request = fapAll()[id];
    if (!request || request.status === 'withdrawn') { out.fresh.push(row); continue; }
    const why = fapEarlierWhy(row, request, id);
    if (why) return { stop: why };
    (request.status === 'approved' ? out.written : out.held).push(Object.assign({}, row, { _id: id }));
  }
  return out;
}
/** Withdraw the requests of SKUs taken out of a packing list. '' when done, else the sentence to show. */
async function fapWithdraw(removed) {
  for (const [id, was] of removed) {
    const next = Object.assign({}, was, { status: 'withdrawn', reason: 'Taken out of the packing list before approval.',
      decidedBy: ME.email, decidedAt: new Date().toISOString() });
    try {
      if (await ptCas(FAP_PATH + '/' + id, was, next)) return `The request for ${was.sku} was just decided by somebody else — press Finish again.`;
    } catch (e) { return `The request for ${was.sku} could not be withdrawn: ${e.message || e} — press Finish again.`; }
    fapKeepOne(id, next);
  }
  return '';
}

/** Save one request, once. '' when it is saved (now or by an earlier press), else the sentence to show. */
async function fapSaveRequest(request) {
  const id = request.row._id, path = FAP_PATH + '/' + id;
  try {
    if (await ptCas(path, fapAll()[id] || null, request)) {
      const had = await ptGetFresh(path);
      if (!had || had.status !== 'waiting' || fgiNum(had.qty) !== request.qty)
        return `${request.sku} was already asked for from this screen (${had ? had.status : 'changed'}). Look under "Repeat FBA requests" before sending it again.`;
    } else fapKeepOne(id, request);
  } catch (e) { return `The request for ${request.sku} was not saved: ${e.message || e} — press Save again.`; }
  return '';
}

/** BEFORE NEW FBA MOVEMENTS ARE WRITTEN. rows: the ledger records about to be written; stem names this save (form, scan batch
 *  or packing list), so saving it again finds the same requests. Answers { stop: sentence } when nothing is to be written, else
 *  { send: rows to write now, extra: further paths to write with them, held: rows waiting for approval, written: rows an
 *  approval has already written }. */
async function fapGate(rows, stem) {
  if (!fapOn()) return { send: rows, extra: {}, held: [], written: [] };
  if (shpListsOn()) return { stop: FGI_FBA_BY_LIST };
  const unread = await fgiStockReread() || await fapReread();
  if (unread) return { stop: unread };
  const earlier = fapEarlier(rows, stem);
  if (earlier.stop) return earlier;
  const now = await fapAskRepeats(earlier.fresh, stem);
  if (now.stop) return now;
  const kept = await fapWithdraw(earlier.removed);
  if (kept) return { stop: kept };
  return { send: now.send, extra: now.extra, held: earlier.held.concat(now.held), written: earlier.written };
}
/** The rows nobody has asked about yet: those sent in the past 7 days are asked about now. */
async function fapAskRepeats(rows, stem) {
  const repeats = rows.filter(r => fapRecent(r.sku).length);
  if (!repeats.length) return { send: rows, extra: {}, held: [] };
  const why = fapLimitWhy(rows);
  if (why) return { stop: 'Nothing was saved — ' + why };
  const approver = fapMayApprove();
  if (!(await fapAsk(fapAskText(repeats, approver)))) return { stop: 'Nothing was saved — you pressed Cancel.' };
  return approver ? fapSelfApproved(rows, repeats) : fapHold(rows, repeats, stem);
}
/** The sender is an approver: the rows go now, each with its approval on record. */
function fapSelfApproved(rows, repeats) {
  const extra = {};
  const send = rows.map(r => {
    if (!repeats.includes(r)) return r;
    const row = Object.assign({}, r, { fbaRepeatId: r._id, fbaRepeatBy: ME.email });
    extra[FAP_PATH + '/' + r._id] = Object.assign(fapRequest(row, 'approved'), { decidedBy: ME.email, decidedAt: row.createdAt });
    return row;
  });
  return { send, extra, held: [] };
}
/** The repeated rows become requests; the rest go now. */
async function fapHold(rows, repeats, stem) {
  const held = repeats.map(r => Object.assign({}, r, { _id: fapIdOf(stem, r.sku) }));
  for (const row of held) {
    const why = await fapSaveRequest(fapRequest(row, 'waiting'));
    if (why) return { stop: why };
  }
  return { send: rows.filter(r => !repeats.includes(r)), extra: {}, held };
}
const fapHeldNote = held => held.length
  ? ` ${nf(held.length)} SKU(s) (${held.map(r => r.sku).join(', ')}) wait for the FBA repeat approver — nothing of them has left the store.` : '';

/* ---- FG Scanning ---- */
/** Why a scan of a recently sent SKU is not entered straight away, or ''. without: this batch's own movement. */
const fapScanHeld = (sku, without) => (fapOn() && fapRecent(sku, without).length
  ? `${sku} went to FBA in the past ${FAP_DAYS} days — press "Save all" to continue or cancel.` : '');
const fapScanRow = (r, qty, h) => {
  const al = fgiOutAlloc(r.sku, qty, 'FBA', '');
  return Object.assign({ _id: fgiNewId('FBA'), txnType: 'FBA', sku: r.sku, qty, date: h.date, reason: '', scanned: true, issuedFor: h.who,
    remarks: 'scanned', createdAt: new Date().toISOString(), createdBy: ME.email },
  al.orders.length ? { orders: al.orders } : {}, h.hand ? { handoverTo: h.hand } : {});
};
/** "SAVE ALL", FBA: the scanned SKUs sent in the past 7 days are answered together and leave the scan list. Answers
 *  { err } to show, else { handled: SKUs dealt with, note: what to add to the message }. */
async function fapScanSave() {
  const none = { handled: 0, note: '' };
  if (!fapOn() || (($('fgsType') || {}).value || FGS.type) !== 'FBA') return none;
  const h = fgiScanHead();
  if (h.err) return { err: h.err };
  await Promise.resolve(FGS.q).catch(e => console.warn('[scan queue] a scan was not entered:', e));
  const unread = await fgiStockReread();
  if (unread) return { err: unread };
  const waiting = r => fgiNum(r.qty) - fgiNum(r.saved);
  const rows = [...FGS.rows.values()].filter(r => waiting(r) > 0 && fapRecent(r.sku, r.id).length);
  if (!rows.length) return none;
  FGS.stem = FGS.stem || fgiNewId('SCAN');
  const gate = await fapGate(rows.map(r => fapScanRow(r, waiting(r), h)), FGS.stem);
  if (gate.stop) return { err: gate.stop };
  const refused = await fapWrite(gate);
  if (refused) return { err: refused };
  rows.forEach(r => FGS.rows.delete(r.sku));
  FGS.stem = '';
  return { handled: rows.length, note: fapHeldNote(gate.held) };
}
/** Write what the gate let through, past the FBA limits and releases. '' when written (or nothing to write). */
async function fapWrite(gate) {
  if (!gate.send.length) return '';
  const patch = Object.assign({}, gate.extra);
  gate.send.forEach(r => { patch['pt_fgiLedger/' + r._id] = r; });
  const refused = await fgiFbaWrite(gate.send.map(r => ({ sku: r.sku, qty: r.qty, current: fgiOf(r.sku).current })), () => ptPatch(patch));
  if (refused) return refused;
  FGI.rows = (FGI.rows || []).concat(gate.send);
  for (const r of gate.send) await lstAlertFor(r.sku, 'FBA', r.qty);
  return '';
}

/* ---- edits ---- */
/** Why an edit may not send more of these SKUs, or ''. wants: as fgiFbaEditWants gives them. */
function fapEditRefusal(wants) {
  if (!fapOn() || fapMayApprove() || shpListsOn()) return '';   // with FBA lists, the save itself refuses (fg-shop-hold.js)
  const w = wants.find(x => fapRecent(x.sku, x.without).length);
  return w ? `${w.sku} went to FBA in the past ${FAP_DAYS} days, so an edit cannot send more of it. Send the extra as a new FBA entry `
    + '(it goes to the FBA repeat approver), or ask the approver to make this edit.' : '';
}

/* ---- deciding ---- */
const fapDecidedWhy = q => !q ? 'That request is gone — press Refresh.'
  : q.status === 'approving' ? `${fapWho(q.decidedBy)} is approving it just now — press Refresh in 2 minutes.`
    : `Already ${q.status} by ${fapWho(q.decidedBy)} — press Refresh.`;
/** The movement an approval writes: it leaves the store now, still in the name of who asked. Orders are dealt afresh,
 *  except a packing list's, which were packed against. */
function fapRowFor(id, request, at) {
  const row = Object.assign({}, request.row, { _id: id, date: fgiDmy(dTodayIndia()), createdAt: at, fbaRepeatId: id, fbaRepeatBy: ME.email });
  if (row.packId) return row;
  const { orders } = fgiOutAlloc(row.sku, row.qty, 'FBA', '');
  delete row.orders;
  return orders.length ? Object.assign(row, { orders }) : row;
}
/** APPROVE, ONCE. The request is claimed (compare-and-set), then the movement and "approved" are written together.
 *  '' when done, else the sentence to show. */
async function fapApprove(id) {
  if (!fapMayApprove()) return FAP_NOT_APPROVER;
  if (shpListsOn()) return `${FGI_FBA_BY_LIST} ${FAP_REJECT_INSTEAD}`;
  const unread = await fgiStockReread();
  if (unread) return unread;
  const path = FAP_PATH + '/' + id, at = new Date().toISOString();
  let was, claim;
  try {
    was = await ptGetFresh(path);
    if (!fapOpen(was)) return fapDecidedWhy(was);
    const why = fapLimitWhy([fapRowFor(id, was, at)]);
    if (why) return 'Not approved — ' + why;
    claim = Object.assign({}, was, { status: 'approving', decidedBy: ME.email, decidedAt: at });
    if (await ptCas(path, was, claim)) return 'Somebody else decided this request just now — press Refresh.';
  } catch (e) { return `Not approved: ${e.message || e} — try again.`; }
  const row = fapRowFor(id, was, at), done = Object.assign({}, claim, { status: 'approved' });
  const refused = await fgiFbaWrite([{ sku: row.sku, qty: row.qty, current: fgiOf(row.sku).current }],
    () => ptPatch({ ['pt_fgiLedger/' + id]: row, [path]: done }));
  if (refused) { await fapUnclaim(path, claim, was); return refused; }
  FGI.rows = (FGI.rows || []).filter(r => (r._id || r.id) !== id).concat(row);
  fapKeepOne(id, done);
  fbaBadge();
  await lstAlertFor(row.sku, 'FBA', row.qty);
  return '';
}
async function fapUnclaim(path, claim, was) {
  try { await ptCas(path, claim, Object.assign({}, was, { status: 'waiting' })); }
  catch (e) { console.warn('Repeat FBA: a failed approval was not put back to waiting; it can be approved again in 2 minutes:', e.message || e); }
}
/** REJECT, ONCE, with the reason the requester will see. '' when done, else the sentence to show. */
async function fapReject(id, reason) {
  if (!fapMayApprove()) return FAP_NOT_APPROVER;
  const why = String(reason || '').trim();
  if (!why) return 'Say why it is rejected — the person who asked sees this.';
  const path = FAP_PATH + '/' + id;
  try {
    const was = await ptGetFresh(path);
    if (!fapOpen(was)) return fapDecidedWhy(was);
    const next = Object.assign({}, was, { status: 'rejected', reason: why, decidedBy: ME.email, decidedAt: new Date().toISOString() });
    if (await ptCas(path, was, next)) return 'Somebody else decided this request just now — press Refresh.';
    fapKeepOne(id, next);
  } catch (e) { return `Not rejected: ${e.message || e} — try again.`; }
  return '';
}

/* ---- the list on Finished Goods ---- */
/** How many requests want this person's eye: for an approver those to decide; else their own waiting, and their own
 *  rejections of the past 7 days. */
function fapBadgeCount() {
  const list = Object.values(fapAll()), since = Date.now() - FAP_DAYS * 864e5;
  if (fapMayApprove()) return list.filter(fapOpen).length;
  return list.filter(q => q.askedBy === ME.email && (q.status === 'waiting' || (q.status === 'rejected' && Date.parse(q.decidedAt) > since))).length;
}
/** The requests view is offered only with the switch on; off, a picked one goes back to the store list. */
function fapOfferView() {
  const on = fapOn();
  if ($('fapOpt')) { $('fapOpt').hidden = !on; $('fapOpt').disabled = !on; }
  if (!on && $('fgView').value === 'fbarep') $('fgView').value = 'stock';
}
function fapDrawBadge() {
  const badge = $('fapBadge'); if (!badge) return;
  const n = fapOn() ? fapBadgeCount() : 0;
  badge.textContent = n ? nf(n) : '';
  badge.classList.toggle('hide', !n);
}
function fapStateCell(q) {
  const by = q.decidedBy ? ` by ${esc(fapWho(q.decidedBy))}` : '';
  if (q.status === 'rejected') return `<span class="pill pill-out">rejected</span>${by}<div class="err" style="font-size:11.5px">${esc(q.reason)}</div>`;
  if (q.status === 'approved') return `<span class="pill pill-ok">approved</span>${by}`;
  if (q.status === 'withdrawn') return `<span class="pill">withdrawn</span>${by}<div class="muted" style="font-size:11.5px">${esc(q.reason)}</div>`;
  return `<span class="pill pill-low">${q.status === 'approving' ? 'being approved' : 'waiting'}</span>`;
}
function fapRender() {
  const list = Object.entries(fapAll()).sort((a, b) => fapOpen(b[1]) - fapOpen(a[1]) || String(b[1].askedAt).localeCompare(String(a[1].askedAt)));
  const head = '<thead><tr>' + ['Asked', 'SKU', 'Pieces', 'FBA account', 'Doing the FBA', 'Sent in the 7 days before', 'State', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 2 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const byList = shpListsOn();   // nothing is approved then, only rejected
  const button = (attr, id, label) => `<button class="ghost" ${attr}="${esc(id)}" style="padding:3px 9px;font-size:12px">${label}</button>`;
  $('fgTable').innerHTML = head + '<tbody>' + (list.length ? list.slice(0, 600).map(([id, q]) => '<tr>'
    + `<td class="frz">${esc(String(q.askedAt).slice(0, 16).replace('T', ' '))}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(q.sku)}</td><td class="num" style="font-weight:700">${nf(q.qty)}</td>`
    + `<td>${esc(q.row.issuedFor)}</td>`
    + `<td>${esc(fapWho(q.askedBy))}${q.row.handoverTo ? `<div class="muted" style="font-size:11px">handed to ${esc(q.row.handoverTo)}</div>` : ''}</td>`
    + `<td style="text-align:left;font-size:12px">${esc(fapSentText(q.recent || []))}</td><td style="text-align:left">${fapStateCell(q)}</td>`
    + `<td style="white-space:nowrap">${fapMayApprove() && fapOpen(q) ? (byList ? '' : button('data-fapok', id, 'Approve') + ' ')
      + button('data-fapno', id, 'Reject') : ''}</td></tr>`).join('')
    : '<tr><td colspan="8" class="muted" style="padding:16px">No repeat FBA requests.</td></tr>') + '</tbody>';
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(list.filter(([, q]) => fapOpen(q)).length)} request(s) waiting. Nothing of a waiting or rejected request has left the store. Times are UTC.`
    + (byList ? ` ${FGI_FBA_BY_LIST} ${FAP_REJECT_INSTEAD}` : '');
}
/** The list was opened: read the requests as they are now and draw them. */
async function fapViewOpened() {
  if (!fapOn() || $('fgView').value !== 'fbarep') return;
  const unread = await fapReread();
  renderFgi();
  if (unread) { $('fgMsg').className = 'err'; $('fgMsg').textContent = unread; }
}
async function fapApprovePress(button) {
  button.disabled = true;
  const why = await fapApprove(button.getAttribute('data-fapok'));
  renderFgi();
  if (why) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; }
}
function fapRejectOpen(id) {
  const q = fapAll()[id]; if (!q) return;
  ptOpenDialog({
    title: 'Reject this repeat FBA',
    subtitle: `${q.sku} · ${nf(q.qty)} pcs · asked by ${fapWho(q.askedBy)}`,
    fields: [{ key: 'reason', label: 'Reason (the person who asked sees it)', value: '', span: true }],
    onSave: async v => { const why = await fapReject(id, v.reason); if (!why) renderFgi(); return why; },
    saveLabel: 'Reject it',
  });
}
