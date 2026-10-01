/* ================= ORDER CONSOLE =================
 *
 * The order book, with what has actually happened against each line: cut, issued, pressed, and what
 * is still owed. Every gate in this app measures against these numbers — this is the screen that
 * makes them legible, so a refusal ("only 40 cut pieces available to issue") can be understood
 * instead of argued with.
 *
 * IT COUNTS ONLY WHAT CARRIES AN ORDER ID, and that is not a detail: 653 of the 1,122 Base Data rows
 * and 277 of the 598 press rows do not have one. Those pieces were really made — they simply cannot
 * be attributed to an order, so they are excluded here exactly as they are excluded from the caps.
 * The count is shown rather than buried, because a line that reads "0 issued" when work was done is
 * otherwise read as a mistake in the screen.
 *
 * The cutting-complete threshold is the old tool's: 90% for a line up to 250 pieces, 95% above it.
 * A cut is never exactly the ordered number — the fabric decides — and demanding 100% would leave
 * every line looking unfinished forever.
 */
/* pick: the Shopify lines ticked for handover, as "ORDER|SKU". Held here and not on the checkboxes
 * because every write redraws the table, and a checkbox would lose its state the moment one did. */
let ORD = { req: null, busy: false, at: '', rows: [], pick: new Set() };
/* HOW MANY LINES ARE DRAWN — 600 at a time, "Show more" adds 600. Newest first (ordNewest), so what was just opened
 * is on the first screen: 61 of the 92 lines opened from the bucket on 28 Sep were past the old fixed 600. */
let ORD_CAP = 600;
/* "Oldest order first" is the order the book always had (ordLinesBuild sorts by order date), kept one pick away. */
const ordNewest = rows => (($('odSort') || {}).value === 'old' ? rows
  : rows.slice().sort((a, b) => ((b.addedMs || 0) - (a.addedMs || 0)) || (ptDtMs(b.orderDate) - ptDtMs(a.orderDate))));
function ordMoreBtn(n) {
  if (!(n > ORD_CAP) || !$('odMsg')) return;
  $('odMsg').innerHTML += (` <button type="button" data-ordmore style="padding:3px 10px;font-size:12px;margin-left:6px">Show ${nf(Math.min(600, n - ORD_CAP))} more</button>`);
}

async function ensureOrd() {
  if (!PTG.mdb) { ORD.busy = true; renderOrd(); await ptLoadGates(); }
  if (!PTE.emp) await ptLoadEmp();
  if (QC.checks === null) { try { QC.checks = ptList(await ptGet('pt_qcChecks')); QC.issue = ptList(await ptGet('pt_qcIssuance')); } catch (e) { QC.checks = QC.checks || []; QC.issue = QC.issue || []; } }
  // The per-SKU override that can flip "does this need cutting" for one code. It has never been
  // written in this data, but the old tool reads it, so this one does too.
  if (ORD.req === null) { try { ORD.req = (await ptGet('pt_cutRequired')) || {}; } catch (e) { ORD.req = {}; } }
  /* The last column is "what actually arrived", and that lives in the finished-goods ledger,
   * keyed by the order number a receipt has carried since 16 Sep. */
  if (FGI.rows === null) { try { await fgiLoad(); } catch (e) { FGI.rows = FGI.rows || []; } }
  /* WHAT THE VENDORS HOLD. The Printing column and an order's journey are built from the vendor orders;
   * a failed read leaves the column saying nothing is with a vendor rather than stopping the tab. */
  if (VO.rows === null) { try { await ensureVo(); } catch (e) { VO.rows = VO.rows || []; } }
  /* The priority tag is kept per SKU, not per order line — a sales order writes it there. Read for the
   * export; a failed read leaves the column blank rather than stopping the screen. */
  if (!PTE.priority) { try { PTE.priority = (await ptGet('pt_skuPriority')) || {}; } catch (e) { PTE.priority = {}; } }
  /* THE BRAND OF A B2B LINE. Its item is on the Custom SKUs list, not in the master, and without
   * this the Brand filter answers nothing for every wholesale order on the screen. A failed read
   * leaves the column blank rather than stopping the tab. */
  if (MDBX.custom === null) {
    try { MDBX.custom = ptList(await ptGet('pt_customSkus')); MDBX.err = ''; }
    catch (e) { MDBX.err = e.message || String(e); MDBX.custom = []; }
  }
  await odrLoad();
  /* THE QUANTITY CHANGES, which live on the sales orders. A failed read leaves the pills off rather
   * than stopping the screen — but it is the one thing here that is news, so it says so. */
  if (SOX.rows === null) {
    try { SOX.rows = ptList(await ptGet('pt_salesOrders')); }
    catch (e) { SOX.rows = []; ORD.adjErr = e.message || String(e); }
  }
  ORD.busy = false; ORD.at = ptStamp();
  ordQtyBadge();
  renderOrd();
}

/** Does this SKU need cutting: the override first, then the master row, then yes. */
function ordCutReq(sku) {
  const k = obUC(sku);
  if (ORD.req && k in ORD.req) return ORD.req[k] !== false;
  const m = cutSkuOf(sku);
  return !m || m.cuttingRequired !== false;
}

const ORD_THRESHOLD = q => (q > 250 ? 95 : 90);

/* Why the panel does not equal Ordered − Received. Written once, used by both panels. */
const ODK_OVER = ' title="Pieces that came back beyond what the line ordered.'
  + ' Still to make is worked out per line and floored at zero — extra pieces of one SKU cannot fill'
  + ' a shortfall in another — so Ordered − Received + Over-received = Still to make."';

/** One row per order line, with everything that has happened against it. */
/* ONE COMPUTATION PER VERSION OF THE DATA.
 *
 * renderOrdShopify asks for these rows six times in a single render — once for the table and once
 * for each filter list it fills — and every one of those was a fresh pass over the whole order book
 * and all three registers. Three and a quarter seconds of the six were this alone.
 *
 * Invalidated the same way as the indexes: by the identity and length of the lists it is built
 * from, so anything that replaces or extends them rebuilds it. */
let ORD_IX = { ob: null, obN: -1, base: null, baseN: -1, cut: null, cutN: -1, press: null, pressN: -1, rows: null };
/* ---- Shopify's own production record ----
 *
 * Shopify work is recorded HERE and not in Base Data. Ravi chose that knowingly: this screen stays
 * his, and the one-and-two-piece web orders do not land in the middle of the factory's bulk register.
 * The cost is that the cutting cap, the weekly report and piece-rate pay all read Base Data and will
 * not see any of it.
 *
 * Keyed by ORDER and SKU, which is the pair a line is keyed by anyway. The order-book row id is
 * rewritten whenever the Shopify sync re-plans an order, and keying on that would throw the progress
 * away with it.
 */
const spKey = (orderNo, sku) => obUC(orderNo) + '__' + obUC(sku);
/**
 * Tick or untick every open line behind one combined row.
 *
 * ALL OR NOTHING. Half a SKU ticked happens when somebody ticked some of its orders on the other
 * view; pressing the box here then means "take the rest as well", because that is what somebody
 * clicking a half-filled box wants — not to undo the ones they already chose.
 */
function spSkuToggle(sku, rows) {
  const r = (rows || ORD.rows || []).find(x => x && x.sku === sku);
  if (!r) return;
  ORD.pick = ORD.pick || new Set();
  const keys = spSkuKeys(r);
  if (!keys.length) return;
  const state = spSkuPicked(r, ORD.pick);
  if (state === 'all') keys.forEach(k => ORD.pick.delete(k));
  else keys.forEach(k => ORD.pick.add(k));
  renderOrd();
}
/* The same characters the order book refuses, for the same reason: these become database keys. */
const spKeySafe = k => !!k && !/[.$#\[\]/]/.test(k);
const spOf = (orderNo, sku) => (PTG.shopProd || {})[spKey(orderNo, sku)] || null;
const spNum = v => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
/** Has this line been handed to the shipping team? That is the end of it, and the only true end. */
const spHanded = r => !!(r && r.handedAt);
/** Which printer a Shopify line has been given to, '' when nobody. */
const spPrinter = (orderNo, sku) => { const s = spOf(orderNo, sku); return s ? String(s.printer || '') : ''; };
/**
 * May this account record the PRINTING on this line?
 *
 * Ravi's rule: the printing is the printer's own entry and nobody else's. An admin can too — somebody
 * has to be able to correct it when a printer cannot, and the alternative is a figure nobody can fix.
 */
function spCanPrint(orderNo, sku) {
  const code = spPrinter(orderNo, sku);
  if (!code) return false;                       // nobody assigned: there is no printing to record
  return !!(ME.admin || (spIsVendor() && String(VP.code) === code));
}
/**
 * May this account SEE this line at all?
 *
 * A printer sees the lines given to them and no others — not another printer's, and not the ones
 * nobody has been given. Everybody else who can open the screen sees all of it.
 *
 * THIS IS THE APP BEING WELL-BEHAVED, NOT ISOLATION. The database it reads has no rules on it yet,
 * so a printer who went around this screen could still read the node. The real barrier arrives with
 * the migration; until then this is a display rule, and it is worth saying so out loud.
 */
function spCanSee(orderNo, sku) {
  if (!spIsVendor()) return true;                // an ordinary account sees all of it
  return spPrinter(orderNo, sku) === String(VP.code);
}

/**
 * May this account give a Shopify line to a printer?
 *
 * A grant of its own, so the person who hands work out does not have to be an admin. A printer never
 * has it: they are outside the company, and deciding who prints what is not theirs to do.
 */
const spCanAssign = () => !spIsVendor() && !!(ME.admin || ME.shopAssign);
/**
 * May this account give a line in the FACTORY'S OWN order book to a printer?
 *
 * A separate grant from the Shopify one. They are different queues worked by different people, and
 * running both off perms.shopAssign meant handing somebody the Shopify queue to let them do B2B.
 * Either grant is enough for somebody who does both; a vendor never has it.
 */
const bkCanAssign = () => !spIsVendor() && !!(ME.admin || ME.b2bAssign);
const BK_NO_ASSIGN = 'Giving a line to a printer needs permission. Ask an admin to switch on '
  + '"Can assign printers on the order book" for your account.';

/**
 * May this account give THIS line to a printer? The order number says which queue it is in, so the
 * answer follows the work rather than the screen somebody happens to be looking at.
 */
const spCanAssignOrder = orderNo => (obUC(orderNo).indexOf('SHP-') === 0 ? spCanAssign() : bkCanAssign());
const spNoAssignFor = orderNo => (obUC(orderNo).indexOf('SHP-') === 0 ? SP_NO_ASSIGN : BK_NO_ASSIGN);
const SP_NO_ASSIGN = 'Giving a line to a printer needs permission. Ask an admin to switch on '
  + '"Can assign printers on Shopify orders" for your account.';

/**
 * Is THIS account a vendor?
 *
 * Not "has the Vendor Portal been opened" — VP.code is filled the moment that screen looks the
 * account up, and an admin may open it. Asking the wrong question made every Shopify line disappear
 * for Ravi the moment he had visited the portal once.
 */
const spIsVendor = () => !!(!ME.admin && VP && VP.code);

/**
 * Record what has happened to one Shopify line.
 *
 * Four figures, each checked against the one before it, because the sequence is the thing: nothing is
 * pressed that was never received, nothing received that was never issued. A register that accepts
 * "12 pressed, 0 received" is a register nobody can answer a question from later.
 *
 * Returns a message, '' when it went through.
 */
async function spSave(orderNo, sku, v) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const key = spKey(orderNo, sku);
  if (!spKeySafe(key)) return 'That order and SKU cannot be made into a database key.';
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer in the order book.';

  const n = k => { const x = parseFloat(v[k]); return isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : 0; };
  const cut = n('cut'), issued = n('issued'), received = n('received'), pressed = n('pressed');
  const ordered = parseFloat(line.qty) || 0;
  const was0 = spOf(orderNo, sku) || {};
  /* PRINTING IS THE PRINTER'S ENTRY. This form does not carry it, so whatever the printer recorded
   * stays exactly as it was — saving from here must never quietly take it back to zero. */
  const printed = spNum(was0.printed);
  /* And once a line HAS a printer, nothing can be cut that was not printed first. A line with no
   * printer needs no printing: not every SKU is block printed, and pretending otherwise would block
   * honest entries. */
  if (was0.printer && cut > printed) {
    return `${nf(cut)} cut, but only ${nf(printed)} printed. ${voName(was0.printer)} has to record the printing first.`;
  }

  /* THE SEQUENCE IS THE POINT. Each figure is bounded by the one before it, so the register cannot
   * hold a story that could not have happened. */
  if (issued > cut && cut > 0) return `Issued (${nf(issued)}) is more than cut (${nf(cut)}).`;
  if (received > issued && issued > 0) return `Received (${nf(received)}) is more than issued (${nf(issued)}).`;
  if (pressed > received) return `Pressed (${nf(pressed)}) is more than received (${nf(received)}). Nothing can be pressed that has not come back.`;
  /* Over-receipt against the order is allowed and named elsewhere on this screen, so it is not
   * refused here — but a figure many times the order is a typo, not a windfall. */
  if (ordered > 0 && received > ordered * 3) {
    return `Received (${nf(received)}) is more than three times the ${nf(ordered)} ordered. If that is right, record it in two goes.`;
  }

  const was = was0;
  const rec = Object.assign({}, was, { orderNo: obUC(orderNo), sku: obUC(sku),
    cut, issued, received, pressed,
    remarks: String(v.remarks || '').trim(),
    at: new Date().toISOString(), by: ME.email });
  try { await ptPut('pt_shopProd/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = PTG.shopProd || {};
  PTG.shopProd[key] = rec;
  ORD_IX = {};                                   // the line cache is built from these figures
  renderOrd();
  return '';
}

/**
 * Give a Shopify line to a printer, or take it off them.
 *
 * ASSIGNING IS RAVI'S, not the printer's. A printer who could give themselves work would be able to
 * take somebody else's, and the whole point of the assignment is that it says who is responsible.
 */
/* ---- the printer's own copy of an assigned Shopify line ----
 *
 * One standing order per printer rather than one order per Shopify order: a printer who is given
 * forty single lines over a month should see one list, not forty orders of one line each.
 */
const spShopOrderId = code => 'vpo_shop_' + String(code || '').trim();
const spShopOrderNo = code => 'VPO-SHOP-' + String(code || '').trim();
const spLineId = (orderNo, sku) => 'ln_shop_' + spKey(orderNo, sku);

/** The order-book row behind a Shopify line: what is owed, what the customer's order is called, and
 *  the photo the order was placed against. */
const spObRow = (orderNo, sku) => (PTG.ob || []).find(x => x
  && obUC(x.orderNo) === obUC(orderNo) && obUC(x.sku) === obUC(sku)) || null;

/** What the order book says is still to be made on that line — the printer is told the real figure. */
function spShopQty(orderNo, sku) {
  return Math.max(0, obPieces(spObRow(orderNo, sku) || {}));
}

/**
 * Put the line on the printer's order, or take it off.
 *
 * READ, MERGE, WRITE — never a blind overwrite. The printer writes to this same order every time
 * they record a dispatch, and a whole-node write from here would throw that away. The read is of
 * their one order, not the whole node, so it is cheap.
 */
async function spMirror(orderNo, sku, code, add) {
  code = String(code || '').trim();
  if (!code) return '';
  const key = spKey(orderNo, sku);
  const path = 'pt_vendorOrders/' + code + '/' + spShopOrderId(code);
  let order = null;
  try { order = await ptGet(path); } catch (e) { return 'Could not read the printer\'s orders: ' + (e.message || e); }

  const lines = (order && Array.isArray(order.lines) ? order.lines : []).filter(l => l && l.shopKey !== key);
  if (add) {
    /* NOT IN THE MASTER: its look-alike's article, colour and size, so the printer sees what it is (2026-09-28). */
    const m = (PTG.mdb || []).find(x => x && obUC(x.sku) === obUC(sku)) || skuLookalike(sku) || {};
    const ob = spObRow(orderNo, sku) || {};
    lines.push({
      lineId: spLineId(orderNo, sku),
      shopKey: key,                       // what ties this line back to the Shopify one
      shopOrderNo: String(orderNo || ''),
      /* What everybody else calls it — the customer, Shopify, and Ravi on the phone. The line sorts
       * by the production number and is READ by this one. */
      shopRef: String(ob.shopOrderNo || ob.brand || ''),
      /* The photo the order was placed against, so the printer is looking at the right cloth. It
       * travels WITH the line because a printer cannot read the picture cache: the rules give them
       * their own branch and nothing else. */
      img: String(ob.shopImg || ''),
      kind: 'cut',
      sku: obUC(sku),
      qty: spShopQty(orderNo, sku),
      /* A B2B item not in the master yet still has a name and a size on its order. */
      articleType: m.articleType || ob.articleType || '', articleSubtype: m.subtype || ob.articleSubtype || '',
      color: m.color || ob.color || '', size: m.size || ob.size || '', brand: m.brand || ob.brand || '',
      itemName: String(ob.itemName || ''),
      priority: 'P1',
      deliveryDate: '',
      dispatchedQty: 0,
      notes: (obIsShop(ob.orderNo ? ob : { orderNo }) ? 'Shopify order ' : 'Sales order ') + String(orderNo || '')
        + (ob.itemName ? ' · ' + ob.itemName : ''),
    });
  }

  /* Nothing left on it means the printer has nothing from Shopify, and an empty order on their
   * screen is a question they cannot answer. */
  if (!lines.length) {
    if (order) { try { await ptDelete(path); } catch (e) { return 'Not saved: ' + (e.message || e); } }
  } else {
    const now = new Date().toISOString();
    const rec = Object.assign({
      id: spShopOrderId(code),
      orderNo: spShopOrderNo(code),
      orderType: 'cut',
      status: 'Placed',
      orderDate: voTodayDMY(),
      vendorName: voName(code),
      demandSource: 'shopify',
      notes: 'Orders assigned to you for printing.',
      createdAt: now, createdBy: ME.email,
    }, order || {}, { lines, staffUpdatedAt: now, staffUpdatedBy: ME.email });
    try { await ptPut(path, rec); } catch (e) { return 'Not saved: ' + (e.message || e); }
    /* Keep what is on screen in step, if this screen has the vendor orders loaded at all. */
    if (Array.isArray(VO.rows)) {
      VO.rows = VO.rows.filter(o => !(o && o.id === rec.id && String(o.vendorCode) === code))
        .concat([Object.assign({ vendorCode: code }, rec)]);
    }
    return '';
  }
  if (Array.isArray(VO.rows)) {
    VO.rows = VO.rows.filter(o => !(o && o.id === spShopOrderId(code) && String(o.vendorCode) === code));
  }
  return '';
}

async function spAssign(orderNo, sku, code, opts) {
  if (!spCanAssignOrder(orderNo)) return spNoAssignFor(orderNo);
  const key = spKey(orderNo, sku);
  if (!spKeySafe(key)) return 'That order and SKU cannot be made into a database key.';
  const want = String(code || '').trim();
  if (want && !voMasterRow(want)) return 'That printer is not in the vendor master.';
  /* ONLY A PRINTER PRINTS. The picker has always filtered to printers; this is the same rule where
   * the writing happens, so a spreadsheet cannot put an embroidery firm or a filling house on a line
   * as though it were one. */
  if (want && !spIsPrinterCode(want)) {
    const v = voMasterRow(want) || {};
    return `${voName(want)} is ${v.active === false ? 'no longer active' : 'a ' + (v.category || 'vendor').toLowerCase()}, not a printer. `
      + 'Only a printer can be given a line to print.';
  }
  const was = spOf(orderNo, sku) || {};
  /* TAKING A PRINTER OFF A LINE THEY HAVE PRINTED loses the only record of who did it. The figure
   * goes back to nobody's, and nobody can answer for it later. */
  if (!want && spNum(was.printed) > 0) {
    return `${nf(spNum(was.printed))} piece(s) are already recorded as printed by ${voName(was.printer)}. `
      + 'Change the printer instead of removing one, so the work still has a name on it.';
  }
  const rec = Object.assign({}, was, { orderNo: obUC(orderNo), sku: obUC(sku), printer: want,
    assignedAt: want ? new Date().toISOString() : '', assignedBy: want ? ME.email : '' });
  try { await ptPut('pt_shopProd/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = PTG.shopProd || {};
  PTG.shopProd[key] = rec;

  /* AND THE PRINTER HAS TO BE ABLE TO SEE IT. The tag above only says who may type a figure here;
   * the line itself goes on their own order, which is the one thing their sign-in can read. A
   * printer taken off the line loses it from their portal at the same moment. */
  const wasCode = String(was.printer || '').trim();
  let msg = '';
  if (wasCode && wasCode !== want) msg = await spMirror(orderNo, sku, wasCode, false) || msg;
  if (want) msg = await spMirror(orderNo, sku, want, true) || msg;

  ORD_IX = {};
  if (!(opts && opts.noRender)) renderOrd();
  return msg;
}

/**
 * Record what a printer has printed.
 *
 * THE PRINTER'S OWN ENTRY. spCanPrint is what decides, and it answers yes only to the printer the
 * line was given to — or to an admin, because a figure nobody can correct is worse than one anybody
 * can.
 */
async function spPrint(orderNo, sku, qty) {
  if (!spCanPrint(orderNo, sku)) {
    const code = spPrinter(orderNo, sku);
    return code ? `Only ${voName(code)} records the printing on this line.`
      : 'Nobody has been given this line to print yet.';
  }
  const key = spKey(orderNo, sku);
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer in the order book.';
  const v = parseFloat(qty);
  if (!isFinite(v) || v < 0) return 'That is not a quantity.';
  const printed = Math.round(v * 100) / 100;
  const ordered = parseFloat(line.qty) || 0;
  if (ordered > 0 && printed > ordered * 3) {
    return `${nf(printed)} printed against ${nf(ordered)} ordered. If that is right, record it in two goes.`;
  }
  const was = spOf(orderNo, sku) || {};
  /* Printing cannot go below what has already been cut out of it — the cloth is cut, and saying it
   * was never printed does not put it back. */
  if (printed < spNum(was.cut)) {
    return `${nf(spNum(was.cut))} piece(s) have already been cut from this. Printing cannot be less than that.`;
  }
  const rec = Object.assign({}, was, { orderNo: obUC(orderNo), sku: obUC(sku), printed,
    printedAt: new Date().toISOString(), printedBy: ME.email });
  try { await ptPut('pt_shopProd/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = PTG.shopProd || {};
  PTG.shopProd[key] = rec;
  ORD_IX = {};
  renderOrd();
  return '';
}

/**
 * Hand a line to the shipping team, or take it back.
 *
 * This is what closes a Shopify line. Pressed is not the end — a pressed piece still on the table is
 * not out of the building, and the moment somebody takes it is the moment this screen is done with
 * it.
 */
