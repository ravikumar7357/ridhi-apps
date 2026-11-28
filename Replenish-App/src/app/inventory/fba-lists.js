/* ================= INDIA STORE: FBA LISTS =================
 * Business rule (28 Nov, approved plan): the FBA team ticks SKUs on Finished Goods and makes one list per lane (Air, Sea or
 * AWD) and FBA account. Making it keeps those pieces for the list; nothing leaves the store and no ledger row is written
 * until Ship, on FBA Dispatch. Shipping fewer frees the rest, and gives back an admin's release those pieces had used.
 * A list may take the lane's share of the stock for that store (fg-store-alloc.js) plus any open release, never more than
 * the stock that no other list has. A SKU sent to FBA in the past 7 days (fg-fba-repeat.js) goes on a list only when the
 * FBA repeat approver or an admin makes it, which is their approval.
 * Whoever holds the FBA Dispatch tab makes, packs, ships and undoes; a list is cancelled by its maker or an admin.
 * Undoing a shipment puts the list back to packed with the pieces that were shipped: those it left behind stay free.
 *
 * Lists sit at pt_fgiSettings/_fbaLists/<id> = { account, store, lane, status: open | packed | shipping, by, at,
 * lines: { SKU key: { sku, qty, packed } }, packId, released: { release id: pieces }, claimBy, claimAt }. A shipped or
 * cancelled one moves to .../_fbaListsDone/<id> with { status: shipped | cancelled, shipment, shipDate, shippedAt, ... ,
 * lines[..].shipped }. <id> is made once per form (fgiNewId('FBL')) and the movements are FBA-<id>-<n>, so a second tap
 * writes nothing new.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — making, packing, shipping, cancelling and undoing are stock: anything that cannot be read or saved
 *   is refused with what to do. A claim (a shipment or an undo) that did not finish can be done again after 5 minutes. It
 *   saves only while the list still carries its own claim, and only within 2 minutes of taking it, so a slow computer cannot
 *   write over the one that took over. A shipment whose answer was lost is looked up: saved counts as shipped.
 *   quiet, with a console line — the switch (storage blocked: the default), putting a failed shipment back to packed,
 *   moving a cancelled list out of the open ones (it keeps no pieces either way), and an Amazon listing alert that could not
 *   be raised after a shipment.
 *
 * BEHIND SWITCH fbaList, which needs storeAlloc on. On by itself on the test website only, OFF everywhere else.
 * localStorage fbaList = '1' turns it on for one computer, '0' off. The way back is that same '0'; a shipment a list made
 * can still be undone with it off, from its row on FBA Dispatch. */
const FBL_PATH = 'pt_fgiSettings/_fbaLists';
const FBL_DONE_PATH = 'pt_fgiSettings/_fbaListsDone';
const FBL_LANES = ['air', 'sea', 'awd'];
const FBL_ALLOTTING = ['open', 'packed', 'shipping'];   // a list in one of these keeps its pieces
const FBL_CLAIM_MS = 5 * 60 * 1000;
const FBL_SEND_BY_MS = 2 * 60 * 1000;   // a claim saves only this soon; the rest of its time is for the save to arrive
const FBL_TRIES = 3;
const FBL_SOURCE = 'fba list';
const FBL_NOT_TEAM = 'Only the FBA team (the FBA Dispatch tab) can do this to an FBA list.';
const FBL_OFF = 'FBA lists are switched off on this computer.';
const FBL_MOVED = 'The list was changed by somebody else just now — press Refresh and try again.';
const FBL_CLAIM_LOST = 'this took too long, or somebody else has taken the list over — press Refresh and look before trying again.';

function fblOn() {
  if (!fgaOn()) return false;
  try { const v = localStorage.getItem('fbaList'); if (v === '1') return true; if (v === '0') return false; }
  catch (e) { console.warn('FBA lists: this browser blocks saved settings, so the switch uses its default.'); }
  return typeof window !== 'undefined' && !!window.__TEST_ERP;
}
/** Why this person cannot work on FBA lists here, or ''. */
const fblBlocked = () => (!fblOn() ? FBL_OFF : (fbaCan() ? '' : FBL_NOT_TEAM));

/* ---- the lists as last read ---- */
const fblLists = () => (FGI.set || {})._fbaLists || {};
const fblDone = () => (FGI.set || {})._fbaListsDone || {};
function fblKeep(node, id, rec) {
  const next = Object.assign({}, (FGI.set || {})[node]);
  if (rec) next[id] = rec; else delete next[id];
  FGI.set = Object.assign({}, FGI.set, { [node]: next });
}
const fblKeepAll = lists => { FGI.set = Object.assign({}, FGI.set, { _fbaLists: lists }); };

/** The pieces the lists keep, per SKU key: { total, SP: [air, sea, awd], CPC: [air, sea, awd] }. */
function fblAllotted(lists) {
  const out = {};
  Object.values(lists || {}).filter(l => l && FBL_ALLOTTING.includes(l.status)).forEach(l => {
    Object.entries(l.lines || {}).forEach(([key, line]) => {
      const had = out[key] || { total: 0, SP: [0, 0, 0], CPC: [0, 0, 0] };
      const lanes = had[l.store].slice();
      lanes[FBL_LANES.indexOf(l.lane)] += fgiNum(line.qty);
      out[key] = Object.assign({}, had, { total: had.total + fgiNum(line.qty), [l.store]: lanes });
    });
  });
  return out;
}

/* ---- making ---- */
/** The pieces of a SKU this lane of this store may still take without a release. */
const fblShare = (want, book) => fgaShares(want.sku, fgiOf(want.sku).current, fgiHoldNode(), book, [want.store])[want.lane];

/** Why these pieces cannot go on a list, or ''. want: { sku, qty, store, lane }; book: fgaBook(). */
function fblCapWhy(want, book) {
  const kept = (fblAllotted(fblLists())[shpHoldKey(want.sku)] || {}).total || 0;
  const unlisted = Math.max(0, fgiOf(want.sku).current - kept);
  const cap = Math.min(unlisted, fblShare(want, book) + fgiReleased(want.sku));
  return want.qty <= cap ? '' : `${want.sku} has ${nf(cap)} piece(s) free for this FBA list, not ${nf(want.qty)}.`
    + ' Take fewer, or ask an admin to release pieces on Finished Goods.';
}

/** The form's lines as the list keeps them, one per SKU: { lines } or { err }. */
function fblLines(entered) {
  const lines = {};
  for (const l of entered || []) {
    const sku = obUC(l.sku), qty = Number(l.qty), key = shpHoldKey(sku);
    if (!sku || !Number.isInteger(qty) || qty < 1) return { err: `Put in a whole number of pieces for ${sku || 'every SKU'}.` };
    lines[key] = { sku, qty: qty + (lines[key] ? lines[key].qty : 0), packed: 0 };
  }
  return Object.keys(lines).length ? { lines } : { err: 'Tick at least one SKU.' };
}
function fblNewList(v) {
  const store = FGA_STORE_OF[v.account];
  if (!store) return { err: 'Pick the FBA account — ' + Object.keys(FGA_STORE_OF).join(' or ') + '.' };
  if (!FBL_LANES.includes(v.lane)) return { err: 'Pick the lane — Air, Sea or AWD.' };
  const { lines, err } = fblLines(v.lines);
  return err ? { err } : { rec: { account: v.account, store, lane: v.lane, status: 'open', by: ME.email, at: new Date().toISOString(), lines } };
}
const fblAsked = rec => [rec.account, rec.lane, Object.keys(rec.lines).sort().map(k => [k, rec.lines[k].qty])];

/** MAKE A LIST, ONCE. v: { id: fgiNewId('FBL') made once per form, account, lane, lines: [{ sku, qty }] }.
 *  '' when saved (now or by an earlier press), else the sentence to show. */
async function fblMake(v) {
  const blocked = fblBlocked();
  if (blocked) return blocked;
  const made = fblNewList(v);
  if (made.err) return made.err;
  try {
    for (let i = 0; i < FBL_TRIES; i++) {
      const answer = await fblMakeTry(v.id, made.rec);
      if (answer !== 'changed') return answer;
    }
  } catch (e) { return `The list was not saved: ${e.message || e} — check the connection and press Save again.`; }
  return 'The list was not saved — the FBA lists kept changing. Press Save again.';
}
/** One try, on figures read now: '' saved, 'changed' somebody saved a list meanwhile, else the sentence to show. */
async function fblMakeTry(id, rec) {
  const unread = await fgiStockReread();
  if (unread) return unread;
  const [seen, finished] = await Promise.all([ptGetFresh(FBL_PATH), ptGetFresh(FBL_DONE_PATH + '/' + id)]);
  fblKeepAll(seen || {});
  const earlier = (seen || {})[id] || finished;
  if (earlier) return ptSame(fblAsked(earlier), fblAsked(rec)) ? ''
    : 'This form has already saved a different list — close it and make a new one.';
  const checked = fblCheck(rec);
  if (checked.err) return checked.err;
  return fblWriteNew(id, checked, seen);
}
/** The limits of a new list: { err }, or { rec (repeat approvals noted), wants for the releases }. */
function fblCheck(rec) {
  const old = fgiFbaAgeWhy();
  if (old) return { err: 'Nothing was saved — ' + old };
  const book = fgaBook(), lines = {}, wants = [];
  for (const [key, line] of Object.entries(rec.lines)) {
    const want = { sku: line.sku, qty: line.qty, store: rec.store, lane: rec.lane };
    const repeat = fapRecent(line.sku).length > 0;
    if (repeat && !fapMayApprove()) return { err: `Nothing was saved — ${line.sku} went to FBA in the past ${FAP_DAYS} days: `
      + 'the FBA repeat approver or an admin has to make this list, or take that SKU off it.' };
    const why = fblCapWhy(want, book);
    if (why) return { err: 'Nothing was saved — ' + why };
    lines[key] = repeat ? Object.assign({}, line, { repeatBy: ME.email }) : line;
    wants.push({ sku: line.sku, qty: line.qty, current: fgiOf(line.sku).current, list: true, share: fblShare(want, book) });
  }
  return { rec: Object.assign({}, rec, { lines }), wants };
}
/** Releases are used up and the list written only if no list changed since `seen`; otherwise they are given back. */
async function fblWriteNew(id, checked, seen) {
  let changed = false;
  const refused = await fgiFbaWrite(checked.wants, async used => {
    const rec = Object.keys(used || {}).length ? Object.assign({}, checked.rec, { released: used }) : checked.rec;
    const next = Object.assign({}, seen, { [id]: rec });
    changed = !!(await ptCas(FBL_PATH, seen, next));
    if (changed) throw new Error('the FBA lists changed');
    fblKeepAll(next);
  });
  /* a release that could not be given back is said, never retried over */
  return changed && !/NOT given back/.test(refused) ? 'changed' : refused;
}

/* ---- one list ---- */
const fblClaimLive = l => !!l.claimAt && Date.now() - Date.parse(l.claimAt) <= FBL_CLAIM_MS;
const fblBusyWhy = l => `${String(l.claimBy || '').split('@')[0]} is working on this list just now — press Refresh in ${FBL_CLAIM_MS / 60000} minutes.`;
/** Read one list as it is now, from the open ones or the finished ones: { open, done } (null where it is not). */
async function fblReadOne(id) {
  const [open, done] = await Promise.all([ptGetFresh(FBL_PATH + '/' + id), ptGetFresh(FBL_DONE_PATH + '/' + id)]);
  fblKeep('_fbaLists', id, open);
  fblKeep('_fbaListsDone', id, done);
  return { open, done };
}

/** Why this claim may no longer save, or '': asked just before the save, on the list as it is now. */
async function fblClaimLostWhy(path, claim) {
  const now = await ptGetFresh(path);
  return ptSame(now, claim) && Date.now() - Date.parse(claim.claimAt) <= FBL_SEND_BY_MS ? '' : FBL_CLAIM_LOST;
}

/* ---- packing ---- */
/** The lines with these packed counts (a SKU not named has none): { lines } or { err }. */
function fblPackedLines(list, packed) {
  const counts = {};
  for (const [sku, n] of Object.entries(packed || {})) {
    const key = shpHoldKey(sku), line = list.lines[key], pcs = Number(n);
    if (!line) return { err: `${obUC(sku)} is not on this FBA list — take it out of the boxes.` };
    counts[key] = (counts[key] || 0) + pcs;
    if (!Number.isInteger(pcs) || pcs < 0 || counts[key] > line.qty)
      return { err: `${line.sku}: the list has ${nf(line.qty)} piece(s) — pack no more than that, in whole pieces.` };
  }
  const lines = {};
  Object.entries(list.lines).forEach(([key, line]) => { lines[key] = Object.assign({}, line, { packed: counts[key] || 0 }); });
  return { lines };
}
/** SAVE WHAT IS PACKED. packed: { SKU: pieces }. No stock moves. '' when saved, else the sentence to show. */
async function fblPackSave(id, packId, packed) {
  const blocked = fblBlocked();
  if (blocked) return blocked;
  try {
    const { open } = await fblReadOne(id);
    if (!open || !['open', 'packed'].includes(open.status)) return 'This FBA list is no longer open for packing — press Refresh.';
    const { lines, err } = fblPackedLines(open, packed);
    if (err) return err;
    const status = Object.values(lines).some(l => l.packed > 0) ? 'packed' : 'open';
    const next = Object.assign({}, open, { lines, status, packId });
    if (await ptCas(FBL_PATH + '/' + id, open, next)) return FBL_MOVED;
    fblKeep('_fbaLists', id, next);
  } catch (e) { return `The packing was not saved: ${e.message || e} — press Save again.`; }
  return '';
}

/* ---- shipping ---- */
/** The pieces of each line that go, by default all that is packed: { qty: { SKU key: pieces } } or { err }. */
function fblShipQty(list, qtyBySku) {
  const asked = {};
  for (const [sku, n] of Object.entries(qtyBySku || {})) {
    if (!list.lines[shpHoldKey(sku)]) return { err: `${obUC(sku)} is not on this FBA list.` };
    asked[shpHoldKey(sku)] = Number(n);
  }
  const qty = {};
  for (const [key, line] of Object.entries(list.lines)) {
    const n = key in asked ? asked[key] : fgiNum(line.packed);
    if (!Number.isInteger(n) || n < 0 || n > fgiNum(line.packed))
      return { err: `${line.sku}: ${nf(fgiNum(line.packed))} piece(s) are packed — ship no more than that, in whole pieces.` };
    qty[key] = n;
  }
  return Object.values(qty).some(n => n > 0) ? { qty } : { err: 'Nothing to ship — put in the pieces going.' };
}
/** Why the store cannot cover these pieces beside what the other lists keep, or ''. */
function fblStockWhy(id, list, qty) {
  const others = fblAllotted(Object.assign({}, fblLists(), { [id]: null }));
  return Object.entries(qty).map(([key, n]) => {
    const { sku } = list.lines[key], free = fgiOf(sku).current - ((others[key] || {}).total || 0);
    return n > 0 && n > free ? `${sku}: the India Store has ${nf(Math.max(0, free))} piece(s) for this list, not ${nf(n)} — ship fewer.` : '';
  }).filter(Boolean).join(' ');
}
/** The movements of a shipment, one per SKU that goes, already accepted and shipped. */
function fblShipRows(id, list, qty, head) {
  return Object.keys(list.lines).sort().map((key, n) => {
    const line = list.lines[key];
    if (!(qty[key] > 0)) return null;
    const { orders } = fgiOutAlloc(line.sku, qty[key], 'FBA', '');
    return Object.assign({ _id: `FBA-${id}-${n + 1}`, txnType: 'FBA', sku: line.sku, qty: qty[key], date: fgiDmy(dTodayIndia()),
      issuedFor: list.account, reason: '', remarks: FBL_SOURCE, createdAt: head.at, createdBy: ME.email,
      fbaAcceptedAt: head.at, fbaAcceptedBy: ME.email, fbaShippedAt: head.at, fbaShippedBy: ME.email,
      fbaShipment: head.shipment, fbaShipDate: head.shipDate, fbaListId: id, fbaLane: list.lane, source: FBL_SOURCE },
    orders.length ? { orders } : {}, line.repeatBy ? { fbaRepeatBy: line.repeatBy } : {});
  }).filter(Boolean);
}
/** Of the releases a list used, those its unshipped pieces give back: { back, kept } as { release id: pieces }. */
function fblReleaseSplit(list, qty, releases) {
  const left = {}, back = {}, kept = {};
  Object.entries(list.lines).forEach(([key, line]) => { left[key] = line.qty - qty[key]; });
  Object.entries(list.released || {}).forEach(([relId, pcs]) => {
    const key = shpHoldKey(((releases || {})[relId] || {}).sku || ''), n = Math.min(pcs, left[key] || 0);
    if (n > 0) { back[relId] = n; left[key] -= n; }
    if (pcs > n) kept[relId] = pcs - n;
  });
  return { back, kept };
}
/** The record of a shipped list, as it is kept among the finished ones. */
function fblShippedRec(list, qty, head, released) {
  const lines = {};
  Object.entries(list.lines).forEach(([key, line]) => { lines[key] = Object.assign({}, line, { shipped: qty[key] }); });
  const rec = Object.assign({}, list, { status: 'shipped', lines, released, shipment: head.shipment, shipDate: head.shipDate,
    shippedAt: head.at, shippedBy: ME.email });
  delete rec.claimBy; delete rec.claimAt;
  if (!Object.keys(released).length) delete rec.released;
  return rec;
}
/** Give released pieces back to their releases. '' when done, else the sentence to show. */
async function fblGiveBack(used) {
  const said = await fgiReleaseGiveBack(used);
  return said.includes('NOT given back') ? said.trim() : '';
}

/** SHIP A PACKED LIST, ONCE. v: { shipment, date (YYYY-MM-DD, default today), qtyBySku: { SKU: pieces } }. The list is
 *  claimed, then the movements and the shipped list are written together. '' when done, else the sentence to show. */
async function fblShip(id, v) {
  const blocked = fblBlocked();
  if (blocked) return blocked;
  const shipment = String(v.shipment || '').trim();
  if (!shipment) return 'Put in the shipment id — a shipment nobody can trace is not a shipment.';
  const taken = await fblShipClaim(id, shipment, v.qtyBySku);
  if (!taken.claim) return taken.err;
  const head = { shipment, shipDate: fgiDmy(v.date || dTodayIndia()), at: taken.claim.claimAt };
  const written = await fblShipWrite(id, taken.claim, taken.qty, head);
  if (written.err) { await fblUnclaim(id, taken.claim, taken.was); return written.err; }
  return fblShipAfter(taken.claim, taken.qty, written.back);
}
/** Claim a packed list for this shipment: { claim, was, qty }, else { err } ('' when this shipment is already written). */
async function fblShipClaim(id, shipment, qtyBySku) {
  try {
    const { open, done } = await fblReadOne(id);
    if (!open) {
      const already = !!done && done.status === 'shipped' && done.shipment === shipment;
      return { err: already ? '' : 'This FBA list is no longer waiting to ship — press Refresh.' };
    }
    if (open.status === 'shipping' && fblClaimLive(open)) return { err: fblBusyWhy(open) };
    if (!['packed', 'shipping'].includes(open.status)) return { err: 'Pack this FBA list before shipping it.' };
    const going = fblShipQty(open, qtyBySku);
    if (going.err) return going;
    const claim = Object.assign({}, open, { status: 'shipping', claimBy: ME.email, claimAt: new Date().toISOString() });
    if (await ptCas(FBL_PATH + '/' + id, open, claim)) return { err: FBL_MOVED };
    return { claim, was: open, qty: going.qty };
  } catch (e) { return { err: `Not shipped: ${e.message || e} — check the connection and try again.` }; }
}
/** Check the stock afresh and write the shipment: { back (release pieces to give back) }, else { err }. */
async function fblShipWrite(id, claim, qty, head) {
  try {
    const unread = await fgiStockReread();
    if (unread) return { err: unread };
    fblKeepAll((await ptGetFresh(FBL_PATH)) || {});
    const short = fblStockWhy(id, claim, qty);
    if (short) return { err: 'Not shipped — ' + short };
    const rows = fblShipRows(id, claim, qty, head);
    const { back, kept } = fblReleaseSplit(claim, qty, fgiHoldNode().releases);
    const done = fblShippedRec(claim, qty, head, kept);
    const patch = { [FBL_PATH + '/' + id]: null, [FBL_DONE_PATH + '/' + id]: done };
    rows.forEach(r => { patch['pt_fgiLedger/' + r._id] = r; });
    const lost = await fblClaimLostWhy(FBL_PATH + '/' + id, claim);
    if (lost) return { err: 'Not shipped — ' + lost };
    const unsure = await fblShipSend(id, patch, head);
    if (unsure) return { err: unsure };
    const ids = new Set(rows.map(fgiRowId));
    FGI.rows = (FGI.rows || []).filter(r => !ids.has(fgiRowId(r))).concat(rows);
    fblKeep('_fbaLists', id, null);
    fblKeep('_fbaListsDone', id, done);
    return { back };
  } catch (e) { return { err: `Not shipped: ${e.message || e} — check the connection and try again.` }; }
}
/** Send the shipment. '' when it is saved, also when only the answer was lost; throws when it was not saved; else the
 *  sentence to show because that could not be checked. */
async function fblShipSend(id, patch, head) {
  try { await ptPatch(patch); return ''; }
  catch (e) {
    let done;
    try { done = await ptGetFresh(FBL_DONE_PATH + '/' + id); }
    catch (unread) {
      console.warn('FBA lists: shipment ' + head.shipment + ' could not be looked up after a failed save:', unread.message || unread);
      return `The shipment may or may not be saved: ${e.message || e} — press Refresh and look before shipping again.`;
    }
    if (!done || done.status !== 'shipped' || done.shippedAt !== head.at) throw e;
    console.warn('FBA lists: shipment ' + head.shipment + ' was saved although its answer was lost:', e.message || e);
    return '';
  }
}
/** After the shipment is written: unused releases go back, and Amazon listing alerts are raised. */
async function fblShipAfter(list, qty, back) {
  const kept = await fblGiveBack(back);
  fbaBadge();
  for (const [key, n] of Object.entries(qty)) if (n > 0) await fblListingAlert(list.lines[key].sku, n);
  return kept && 'Shipped. ' + kept;
}
/** The pieces have gone whether or not the alert can be raised, so its failure never reads as a failed shipment. */
async function fblListingAlert(sku, pieces) {
  try { await lstAlertFor(sku, 'FBA', pieces); }
  catch (e) { console.warn('FBA lists: ' + sku + ' shipped, but its Amazon listing alert was not raised:', e.message || e); }
}
async function fblUnclaim(id, claim, was) {
  const back = Object.assign({}, was, { status: 'packed' });
  delete back.claimBy; delete back.claimAt;
  try {
    const path = FBL_PATH + '/' + id, now = await ptGetFresh(path);
    /* compared field by field, then written against the record as the database gave it (its own field order) */
    if (ptSame(now, claim) && !(await ptCas(path, now, back))) fblKeep('_fbaLists', id, back);
  } catch (e) { console.warn('FBA lists: a failed shipment was not put back to packed; it can be shipped again in 5 minutes:', e.message || e); }
}

/* ---- cancelling ---- */
/** CANCEL A LIST not yet shipped: its pieces are free again and its releases go back. '' when done, else the sentence. */
async function fblCancel(id) {
  if (!fblOn()) return FBL_OFF;
  let next, used;
  try {
    const { open, done } = await fblReadOne(id);
    const list = open || done;
    if (list && list.status === 'cancelled') return '';
    if (!open) return 'This FBA list is no longer open — press Refresh.';
    if (!(ME.admin || open.by === ME.email)) return 'Only the person who made this FBA list or an admin can cancel it.';
    if (open.status === 'shipping' && fblClaimLive(open)) return fblBusyWhy(open);
    used = open.released || {};
    next = Object.assign({}, open, { status: 'cancelled', cancelledBy: ME.email, cancelledAt: new Date().toISOString() });
    delete next.released; delete next.claimBy; delete next.claimAt;
    if (await ptCas(FBL_PATH + '/' + id, open, next)) return FBL_MOVED;
  } catch (e) { return `Not cancelled: ${e.message || e} — try again.`; }
  await fblFileCancelled(id, next);
  const kept = await fblGiveBack(used);
  return kept && 'Cancelled. ' + kept;
}
async function fblFileCancelled(id, list) {
  fblKeep('_fbaLists', id, list);
  try {
    await ptPatch({ [FBL_PATH + '/' + id]: null, [FBL_DONE_PATH + '/' + id]: list });
    fblKeep('_fbaLists', id, null);
    fblKeep('_fbaListsDone', id, list);
  } catch (e) { console.warn('FBA lists: cancelled list ' + id + ' stays among the open ones (it keeps no pieces):', e.message || e); }
}

/* ---- undoing a shipment ---- */
/** A shipped list as it goes back to packed: the pieces that were shipped. */
function fblUnshipped(done) {
  const lines = {};
  Object.entries(done.lines).filter(([, l]) => l.shipped > 0).forEach(([key, l]) => {
    lines[key] = Object.assign({}, l, { qty: l.shipped, packed: l.shipped });
    delete lines[key].shipped;
  });
  const back = Object.assign({}, done, { status: 'packed', lines });
  ['shipment', 'shipDate', 'shippedAt', 'shippedBy', 'claimBy', 'claimAt'].forEach(f => delete back[f]);
  return back;
}
/** The movements a shipped list wrote, or why they cannot be taken out: { ids } or { err }. */
function fblShippedMovements(id) {
  const rows = (FGI.rows || []).filter(r => r && r.txnType === 'FBA' && r.fbaListId === id);
  const ids = new Set(rows.map(fgiRowId));
  const returned = rows.find(r => fgiNum(r.fbaReturned) > 0)
    || (FGI.rows || []).find(r => r && r.txnType === 'FBA_RETURN' && ids.has(r.linkedFbaId));
  return returned ? { err: `${returned.sku}: pieces of this shipment were returned from FBA — delete that return in Finished Goods first.` }
    : { ids: [...ids] };
}
/** UNDO A SHIPMENT: its movements are deleted and the list is packed again, in one save. Allowed with the switch off, as it
 *  touches only what that list wrote. '' when done, else the sentence. */
async function fblUndoShip(id) {
  if (!fbaCan()) return FBL_NOT_TEAM;
  try {
    const { open, done } = await fblReadOne(id);
    if (!done) return open && open.status === 'packed' ? '' : 'This FBA list is not shipped — press Refresh.';
    if (done.status !== 'shipped') return 'This FBA list is not shipped — press Refresh.';
    if (fblClaimLive(done)) return fblBusyWhy(done);
    const unread = await fgiStockReread();
    if (unread) return unread;
    const { ids, err } = fblShippedMovements(id);
    if (err) return err;
    const claim = Object.assign({}, done, { claimBy: ME.email, claimAt: new Date().toISOString() });
    if (await ptCas(FBL_DONE_PATH + '/' + id, done, claim)) return FBL_MOVED;
    const refused = await fblWriteUndo(id, claim, ids);
    if (refused) return refused;
  } catch (e) { return `The shipment was not undone: ${e.message || e} — try again in 5 minutes.`; }
  fbaBadge();
  return '';
}
async function fblWriteUndo(id, done, ids) {
  const back = fblUnshipped(done);
  const patch = { [FBL_DONE_PATH + '/' + id]: null, [FBL_PATH + '/' + id]: back };
  ids.forEach(rowId => { patch['pt_fgiLedger/' + rowId] = null; });
  const lost = await fblClaimLostWhy(FBL_DONE_PATH + '/' + id, done);
  if (lost) return 'The shipment was not undone — ' + lost;
  await ptPatch(patch);
  const gone = new Set(ids);
  FGI.rows = (FGI.rows || []).filter(r => !gone.has(fgiRowId(r)));
  fblKeep('_fbaListsDone', id, null);
  fblKeep('_fbaLists', id, back);
  return '';
}
