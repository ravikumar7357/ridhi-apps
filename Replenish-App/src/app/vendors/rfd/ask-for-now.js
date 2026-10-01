/* ================= ASK FOR NOW — a box per row, one button (2026-09-26) ================= */
/** What the boxes would raise: per row, how much is inside the order (agreed at once) and how much is over it. */
function vpRfdRaisePlan(o, drafts) {
  const rows = [];
  (drafts || []).forEach(d => {
    const want = parseFloat(d.qty);
    if (!(want > 0)) return;
    if (rfdKeyUnit(d.key) === 'm') {
      const f = rfdFabrics(o).find(x => rfdFabKey(x.fabric) === d.key);
      if (!f) return;
      const left = Math.max(0, rfdAllowed(o, f.fabric).left);
      const w = rfdRound(want), within = rfdRound(Math.min(w, left));
      rows.push({ key: d.key, unit: 'm', label: f.fabric, fabric: f.fabric, want: w, within, over: rfdRound(w - within) });
    } else {
      const g = rfdSizeOf(o, d.key);
      if (!g) return;
      if (Math.round(want) !== want) { rows.push({ key: d.key, unit: 'pcs', label: g.size || g.key, err: 'pieces have to be a whole number' }); return; }
      const within = Math.min(want, Math.max(0, g.left));
      rows.push({ key: d.key, unit: 'pcs', label: (g.size || g.key) + ' · ' + g.what, want, within, over: want - within });
    }
  });
  return rows;
}
/** Raise them: the part inside the order first (agreed at once), then the part over it (waits for approval, with why). */
async function vpRfdRaiseRun(o, drafts, reason) {
  const rows = vpRfdRaisePlan(o, drafts);
  const bad = rows.find(r => r.err);
  if (bad) return { err: bad.label + ': ' + bad.err + '.' };
  if (!rows.length) return { err: 'Put how much you need in "Ask for now" on at least one row.' };
  const why = String(reason || '').trim();
  if (rows.some(r => r.over > 0) && !why) return { err: 'Some of this is more than the order needs — say why, and it goes to The Fabric Rush to approve.' };
  let agreed = 0, waiting = 0;
  for (const r of rows) {
    if (r.within > 0) {
      const e = r.unit === 'm' ? await rfdSubmit(o, r.fabric, r.within, '') : await rfdSubmitSize(o, r.key, r.within, '');
      if (e) return { err: r.label + ': ' + e };
      agreed++;
    }
    if (r.over > 0) {
      const e = r.unit === 'm' ? await rfdSubmit(o, r.fabric, r.over, 'More than the order needs — ' + why) : await rfdSubmitSize(o, r.key, r.over, 'More than the order needs — ' + why);
      if (e) return { err: r.label + ': ' + e };
      waiting++;
    }
  }
  return { err: '', rows, agreed, waiting };
}

async function rfdSubmitSize(o, key, pieces, note) {
  if (!o) return 'That order is no longer here.';
  if (!rfdSizeOf(o, key)) return 'Pick which size you need.';
  const want = parseFloat(pieces) || 0;
  if (!(want > 0)) return 'How many pieces do you need?';
  if (Math.round(want) !== want) return 'Pieces have to be a whole number.';
  const plan = rfdSizePlan(o, key, want);
  if (plan.err) return plan.err;
  const asks = plan.asks;
  const recs = asks.map((a, i) => rfdRecord(o, a, note, i + 1));
  const base = 'pt_vendorOrders/' + (VP.code || o.vendorCode) + '/' + o.id + '/rfdReqs/';
  const patch = {};
  recs.forEach(r => { patch[base + r.id] = r; });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  rfdKeep(o, recs);
  return '';
}

/**
 * A size's pieces shared over its colours — by what each still needs; or, when none needs anything and the ask goes
 * beyond the order anyway, by how big each colour is. Over-asking is allowed here (it goes to the office), so the room
 * is stretched to fit rather than the ask trimmed. Used by the printer's ask and by the store's send alike.
 */
function rfdSizePlan(o, key, want) {
  const g = rfdSizeOf(o, key);
  if (!g) return { err: 'Pick which size you need.', asks: [] };
  const rooms = g.skus.map(x => Math.max(0, x.pieces - rfdUsedPcs(o, x.sku) - rfdStockForSku(o, x.sku)));
  const share = rfdSpread(want, rooms.some(x => x > 0) ? rooms : g.skus.map(x => x.pieces));
  const asks = [];
  g.skus.forEach((x, i) => {
    if (!(share[i] > 0)) return;
    asks.push({ unit: 'pcs', pieces: share[i], sku: x.sku, size: x.size, what: x.what,
      colour: x.colour, fabric: x.fabric, metres: x.per ? rfdRound(share[i] * x.per) : 0 });
  });
  return { err: asks.length ? '' : 'There is nothing left to ask for on that size.', asks };
}

/**
 * The printer's own count of what is on their floor, per size.
 *
 * Their own branch and nobody else's. It is a DECLARATION, not a receipt — it is stamped with who
 * said it and when, and the office sees both, because it comes off what the factory will send.
 */
async function rfdStockSave(o, stockKey, pcs) {
  const code = rfdVendorOf(o);
  if (!code) return 'This sign-in is not linked to a printer.';
  const unit = rfdKeyUnit(stockKey);
  const g = unit === 'm' ? null : rfdSizeOf(o, stockKey);
  const f = unit === 'm' ? rfdFabrics(o).find(x => rfdFabKey(x.fabric) === stockKey) : null;
  const n = parseFloat(pcs);
  if (pcs !== '' && (!isFinite(n) || n < 0))
    return unit === 'm' ? 'How many metres do you have? A number, or leave it empty.'
      : 'How many pieces do you have? A number, or leave it empty.';
  /* Half a tablecloth is not a thing anybody can print. Half a metre of cloth is. */
  if (unit === 'pcs' && isFinite(n) && Math.round(n) !== n) return 'Pieces have to be a whole number.';
  const val = isFinite(n) ? (unit === 'm' ? rfdRound(n) : Math.round(n)) : 0;
  const row = { pcs: val, unit, what: (g && g.what) || (f ? f.fabric : ''),
    size: (g && g.size) || '', by: ME.email, at: new Date().toISOString() };
  /* AGAINST THE ORDER IT WAS TYPED ON. An older count for the same size that is shared, or that was
   * tagged to this order, is replaced — the printer is restating it here, and leaving it would count
   * the same cloth twice. */
  row.orderId = o.id;
  const key = stockKey + '@' + o.id;
  const gone = pcs === '' || !isFinite(n) || val === 0;
  const old = rfdStockEnts(code, stockKey).filter(e => e.k !== key && (!e.oid || e.oid === o.id)).map(e => e.k);
  const patch = { ['pt_rfdStock/' + code + '/' + key]: gone ? null : row };
  old.forEach(k => { patch['pt_rfdStock/' + code + '/' + k] = null; });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const all = Object.assign({}, RFD.stock || {});
  const mine = Object.assign({}, all[code] || {});
  old.forEach(k => { delete mine[k]; });
  if (gone) delete mine[key]; else mine[key] = row;
  all[code] = mine;
  RFD.stock = all;
  return '';
}
/** How a piece ask reads on a screen: "39 pcs of 60X60". */
const rfdPcsTxt = r => (r && r.pieces > 0)
  ? nf(rfdRound(r.pieces)) + ' pcs' + (r.size ? ' of ' + r.size : (r.sku ? ' of ' + r.sku : '')) : '';

/* ---- the requests on an order ---- */

const rfdKey = f => String(f == null ? '' : f).trim().toUpperCase();
/** A printer's own asks, read out of the order they were written into. */
const rfdReqsOf = o => (!o ? [] : Object.entries(o.rfdReqs || {})
  .map(([k, r]) => (r && typeof r === 'object' ? Object.assign({ reqId: k }, r) : null))
  .filter(r => r && r.id));

/** Which of two requests was raised first. The id breaks a tie, so the order never wobbles. */
const rfdSeq = r => String((r && r.raisedAt) || '') + '|' + String((r && r.id) || '');

/**
 * What this order still allows against one fabric.
 *
 * Everything already asked for and not refused counts against it, whether it has been approved, sent,
 * or is still waiting — a printer with a request in the queue has not been told no, and letting them
 * raise the same metres again while it sits there would auto-approve cloth the order cannot cover. A
 * refused one gives its metres back.
 *
 * PASS A REQUEST as the third argument to ask what was left AT THE MOMENT IT WAS RAISED: everything
 * asked before it counts, and everything asked after it does not. That is what decides whether it
 * was covered by its own order, and it has to be first-come-first-served or an approval stops being
 * one — a printer whose 100 m was agreed on Monday had it turn back into "waiting" on Tuesday when
 * they asked for 500 m more, because the later ask was eating the same ceiling.
 *
 * Pass nothing to ask what is left for a NEW request, which is every ask so far.
 */
/**
 * The metres of one cloth already asked for on this order.
 *
 * Lifted out of rfdAllowed for the same reason rfdUsedPcs was: "what is left" now depends on what
 * the printer says is with them, which is worked out from what each order still needs — and asking
 * rfdAllowed for that would be a circle with no bottom.
 */
function rfdUsedM(o, fabric, before) {
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  return rfdReqsOf(o).reduce((a, r) => {
    if (exceptId && r.id === exceptId) return a;
    if (cut && rfdSeq(r) >= cut) return a;
    if (rfdKey(r.fabric) !== rfdKey(fabric)) return a;
    /* METRE REQUIREMENTS ONLY. A piece requirement is its own pool now — the cloth behind it was
     * never counted in this total, so charging it here would take the same cloth away twice. */
    if (rfdUnit(r) !== 'm') return a;
    /* THE DECISION, NOT THE STAGE. Asking rfdStage here would be the natural thing to write and it
     * hangs the browser: the stage of an unanswered request is worked out from what is left, which
     * is worked out from the stages of the others — two unanswered asks on one fabric and the two
     * call each other until the stack gives out. A refusal only ever comes from the decision, so the
     * decision is what this reads. */
    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.metres) || 0);
  }, 0);
}

function rfdAllowed(o, fabric, before) {
  const need = rfdOrderNeed(o).byFab.get(String(fabric || '').trim()) || 0;
  const used = rfdUsedM(o, fabric, before);
  /* WHAT THE PRINTER SAYS IS ALREADY WITH THEM, on a NEW request only — see rfdPcsAllowed. */
  const stock = before ? 0 : rfdStockHere(o, rfdFabKey(fabric));
  return { need: rfdRound(need), used: rfdRound(used), stock: rfdRound(stock),
    left: rfdRound(Math.max(0, need - used - stock)) };
}

/**
 * What this order still allows against one SKU, in PIECES.
 *
 * The fabric ceiling alone would not catch this. An order with 5,798 m of Sheeting 62 across a dozen
 * sizes has plenty of cloth for a request of 200 pieces of one of them — and 200 pieces of a size the
 * order asks for 39 of is still wrong. So a piece ask has to clear this as well.
 *
 * Only piece asks count against it. A plain metre ask is not a claim on any particular size, so
 * charging it to one would refuse the next honest request for a reason nobody could see.
 *
 * The third argument behaves as it does on rfdAllowed: pass a request to ask what was left when IT
 * was raised, pass nothing to ask what is left for a new one.
 */
/**
 * How many pieces of one size have already been asked for on this order.
 *
 * Lifted out of rfdPcsAllowed so the size groups can ask for it WITHOUT asking for "what is left" —
 * which now depends on the declared pile, which is worked out from the size groups. Calling the
 * whole thing there would have been a loop with no bottom.
 */
function rfdUsedPcs(o, sku, before) {
  const cut = before && typeof before === 'object' ? rfdSeq(before) : null;
  const exceptId = before && typeof before === 'string' ? before : (before && before.id) || '';
  return rfdReqsOf(o).reduce((a, r) => {
    if (rfdUnit(r) !== 'pcs' || obUC(r.sku) !== obUC(sku)) return a;
    if (exceptId && r.id === exceptId) return a;
    if (cut && rfdSeq(r) >= cut) return a;
    const d = rfdDecisionOf(r.id);
    if (d && d.stage === 'rejected') return a;
    return a + (parseFloat(r.pieces) || 0);
  }, 0);
}

function rfdPcsAllowed(o, sku, before) {
  const line = rfdPieceOf(o, sku);
  const need = line ? line.pieces : 0;
  const used = rfdUsedPcs(o, sku, before);
  /* WHAT THE PRINTER SAYS IS ALREADY WITH THEM comes off what is left to ask for — but only when we
   * are asked about a NEW request. `before` means "what was left at the moment that one was raised",
   * and that answer decided whether it was agreed on the spot; a count typed today must not reach
   * back and turn an agreed request into one that needs approval. */
  const stock = before ? 0 : rfdStockForSku(o, sku);
  return { need: rfdRound(need), used: rfdRound(used), stock: rfdRound(stock),
    left: rfdRound(Math.max(0, need - used - stock)) };
}

/* ---- the decision, which a printer cannot write ---- */

const rfdDecisionOf = id => ((RFD.decisions || {})[String(id)] || null);
const rfdSends = d => (Array.isArray(d && d.sends) ? d.sends : Object.values((d && d.sends) || {})).filter(Boolean);
const rfdSentQty = id => rfdSends(rfdDecisionOf(id)).reduce((a, x) => a + (parseFloat(x.qty) || 0), 0);
/**
 * How much has actually reached the printer against one request — from whichever side is asking.
 *
 * Staff hold the real record and it is used where it exists. A printer cannot read that node at all,
 * so their own screen falls back to the copy left for them. Same question, two vantage points, and
 * neither is asked to pretend it can see the other's.
 */
const rfdSentSeen = r => {
  const d = rfdDecisionOf(r && r.id);
  if (d) return rfdSends(d).reduce((a, x) => a + (parseFloat(x.qty) || 0), 0);
  return Math.max(0, parseFloat(r && r.shown && r.shown.sent) || 0);
};
/**
 * Cloth already in the printer's hands for one fabric on one order — "do they have the goods for
 * this order yet".
 *
 * A refused request is not counted: nothing went out on it. What has gone out against an approved
 * one is counted whatever happened afterwards, because the cloth is with them either way.
 */
function rfdSentFor(o, fabric) {
  /* No exception for a refused requirement: one cannot be refused after cloth has gone out against
   * it — rfdDecide says so in as many words — so a refused one has nought sent and subtracting it
   * would be a rule about a case that cannot arise. */
  return rfdRound(rfdReqsOf(o).reduce((a, r) =>
    (rfdUnit(r) === 'm' && rfdKey(r.fabric) === rfdKey(fabric) ? a + rfdSentSeen(r) : a), 0));
}
/** The same question for a size that goes out already cut: how many pieces have actually reached them. */
function rfdSentPcsFor(o, sku) {
  return rfdRound(rfdReqsOf(o).reduce((a, r) =>
    (rfdUnit(r) === 'pcs' && obUC(r.sku) === obUC(sku) ? a + rfdSentSeen(r) : a), 0));
}

/**
 * Where a request stands, in one word.
 *
 *   pending    somebody has to say yes — it asks for more than the order covers
 *   approved   agreed, and the cloth has not all gone out yet
 *   sent       the cloth has gone out
 *   rejected   refused
 *
 * A request within what the order covers is APPROVED WITH NOBODY TOUCHING IT — that is the whole of
 * "yadi order ke according h to auto approve". It is worked out fresh every time rather than stamped
 * once, because the order it is measured against can change after the asking.
 */
/**
 * How much of one request is already with the printer, by their own count on that order.
 *
 * Their count for the size (or the cloth) is shared over that order's requests of it, oldest first,
 * each taking up to what it asked for. A refused request takes none.
 */
function rfdWithPrinter(r, o) {
  /* A store-raised requirement was sized net of the printer's count already (rfdOfficeSend works from the order's
   * to-send), so the count is never set against it a second time. */
  if (!r || r.office === true) return 0;
  const order = o || r._order || rfdOrderOf(r);
  if (!order) return 0;
  const code = rfdVendorOf(order);
  /* Most printers have said nothing; this runs for every row, so they cost nothing. */
  if (!Object.keys((RFD.stock || {})[obUC(code)] || {}).length) return 0;
  let key, same;
  if (rfdUnit(r) === 'pcs') {
    const lines = rfdPieceLines(order);
    const keyOf = sku => { const p = lines.find(x => obUC(x.sku) === obUC(sku)); return p ? rfdStockKey(p) : ''; };
    key = keyOf(r.sku);
    if (!key) return 0;
    same = x => rfdUnit(x) === 'pcs' && keyOf(x.sku) === key;
  } else {
    key = rfdFabKey(r.fabric);
    same = x => rfdUnit(x) === 'm' && rfdFabKey(x.fabric) === key;
  }
  let pool = rfdStockOf(code, key, order);
  if (!(pool > 0)) return 0;
  const list = rfdReqsOf(order).filter(x => same(x) && !((d => d && d.stage === 'rejected')(rfdDecisionOf(x.id))))
    .sort((a, b) => (rfdSeq(a) < rfdSeq(b) ? -1 : rfdSeq(a) > rfdSeq(b) ? 1 : 0));
  for (const x of list) {
    const take = Math.min(pool, rfdWant(x));
    if (x.id === r.id) return rfdRound(take);
    pool -= take;
  }
  return 0;
}
/** What is still to go out on one request: what was asked, less what is already with them. */
const rfdToSend = (r, o) => rfdRound(Math.max(0, rfdWant(r) - rfdWithPrinter(r, o)));

