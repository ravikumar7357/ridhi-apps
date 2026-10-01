/* ==== FROM PRODUCTION TO SHIPPING (Ravi, 2026-09-28) ====
 * Nobody presses "hand over" any more. What production has PRESSED on a Shopify line and the shipping team has not yet
 * taken is ready, and it shows in the Production bucket under "From production" by itself. The shipping team fills in
 * how many actually arrived and accepts: that is kept on the line (handedQty, and a log of every receipt), and once the
 * whole line is in it is handed over — the same handedAt the Order Console has always read. */
function shpReadyLines() {
  let lines; try { lines = ordLines(); } catch (e) { return []; }
  return lines.filter(l => /^SHP-/.test(l.orderNo) && !l.handedAt && !l.shopDoneAt).map(l => {
    const sp = (typeof spOf === 'function' ? spOf(l.orderNo, l.sku) : null) || {};
    const got = Number(sp.handedQty) || 0, made = Math.min(l.qty, Number(l.pressed) || 0);
    return { key: l.orderNo + '|' + l.sku, l, orderNo: l.orderNo, sku: l.sku, shop: l.shopOrderNo || l.orderNo, qty: l.qty, made, got, ready: Math.max(0, made - got) };
  }).filter(x => x.ready > 0).sort((a, b) => String(a.l.orderDate || '').localeCompare(String(b.l.orderDate || '')) || a.key.localeCompare(b.key));
}
/** The shipping team takes the goods: whoever works the Shopify tab, anybody who records production, an admin. */
const shpCanReceive = () => !spIsVendor() && !!(ME.admin || ptCanEdit() || (ME.tabs || []).indexOf('shopify') >= 0);
/** items: [{ orderNo, sku, qty }] — what arrived. Never more than the line still owes. */
async function shpReceive(items) {
  if (!shpCanReceive()) return 'Taking goods from production needs the Shopify tab.';
  const now = new Date().toISOString(), upd = {};
  let n = 0;
  (items || []).forEach(it => {
    const line = (ordLines() || []).find(l => l.orderNo === obUC(it.orderNo) && l.sku === obUC(it.sku));
    if (!line) return;
    const key = spKey(line.orderNo, line.sku), was = spOf(line.orderNo, line.sku) || { orderNo: line.orderNo, sku: line.sku };
    const have = Number(was.handedQty) || 0;
    const q = Math.min(Math.round(Number(it.qty) || 0), Math.max(0, line.qty - have));
    if (!(q > 0)) return;
    const got = have + q;
    const log = (Array.isArray(was.handLog) ? was.handLog.slice(-19) : []).concat([{ qty: q, at: now, by: ME.email }]);
    upd['pt_shopProd/' + key] = Object.assign({}, was, { handedQty: got, handLog: log }, got >= line.qty ? { handedAt: now, handedBy: ME.email } : {});
    n++;
  });
  if (!n) return 'Put in how many arrived.';
  try { await ptPatch(upd); } catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = Object.assign({}, PTG.shopProd || {});
  Object.keys(upd).forEach(k => { PTG.shopProd[k.slice('pt_shopProd/'.length)] = upd[k]; });
  ORD_IX = {};
  return '';
}

async function spHandover(orderNo, sku, on) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const key = spKey(orderNo, sku);
  const was = spOf(orderNo, sku);
  if (on) {
    const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
    /* NOTHING IS HANDED OVER THAT WAS NEVER MADE. Otherwise the one act that closes a line would
     * also be the way to make work disappear without doing it. */
    /* The LINE's figures, not the record's counters: a karigar-issued line keeps its received and
     * pressed in Base Data and the press register, and only a quilt keeps them on the record. */
    const own = !line || spIsQuilt(line);
    const recv = own ? spNum(was && was.received) : spNum(line.received);
    const pressed = own ? spNum(was && was.pressed) : spNum(line.pressed);
    if (!(recv > 0)) {
      return 'Nothing has been received against this line yet, so there is nothing to hand over.';
    }
    if (pressed < recv) {
      return `${nf(recv - pressed)} piece(s) have not been pressed yet. Record the press first, or say how many really are going.`;
    }
  }
  const rec = Object.assign({}, was || { orderNo: obUC(orderNo), sku: obUC(sku) }, on
    ? { handedAt: new Date().toISOString(), handedBy: ME.email }
    : { handedAt: '', handedBy: '' });
  try { await ptPut('pt_shopProd/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = PTG.shopProd || {};
  PTG.shopProd[key] = rec;
  ORD_IX = {};
  renderOrd();
  return '';
}

function ordLines() {
  const ob = PTG.ob || [], base = PT.base || [], cut = PT.cut || [], press = PTG.press || [];
  const mdbSrc = PTG.mdb || [];
  if (ORD_IX.rows && ORD_IX.ob === ob && ORD_IX.obN === ob.length
      && ORD_IX.mdb === mdbSrc && ORD_IX.mdbN === mdbSrc.length
      && ORD_IX.base === base && ORD_IX.baseN === base.length
      && ORD_IX.cut === cut && ORD_IX.cutN === cut.length
      && ORD_IX.press === press && ORD_IX.pressN === press.length) return ORD_IX.rows;
  const out = ordLinesBuild();
  ORD_IX = { ob, obN: ob.length, base, baseN: base.length, cut, cutN: cut.length,
    press, pressN: press.length, mdb: mdbSrc, mdbN: mdbSrc.length, rows: out };
  return out;
}
function ordLinesBuild() {
  const byKey = {};
  (PTG.ob || []).forEach(r => {
    const no = obUC(r.orderNo), sku = obUC(r.sku);
    if (!no || !sku) return;
    const k = no + '|' + sku;
    const e = byKey[k] || (byKey[k] = Object.assign({ orderNo: no, sku, qty: 0, orderDate: r.orderDate || '',
      src: r.src || '', addedMs: 0 }, obWhat(r), {
      // Where an order line came from, when it came from a Shopify order that had to be made.
      shopOrderNo: r.shopOrderNo || '', shopOrderId: r.shopOrderId || '', adjId: r.adjId || '',
      shopImg: r.shopImg || '', packs: 0, pcsPer: 1, shopDoneAt: '', shopDoneWhy: '',
      /* WHAT THE ORDER CALLED IT (2026-09-26): a B2B custom SKU is in no master, so its article is blank — the name
       * and material the order came in with are what say what it is. */
      itemName: r.itemName || ordCustomName(r.sku), material: r.material || '' }));
    /* COMPLETED BY THE SHIPPING TEAM (2026-09-26): Shopify says the parcel went (or never will). */
    if (r.shopDoneAt) { e.shopDoneAt = r.shopDoneAt; e.shopDoneWhy = r.shopDoneWhy || 'fulfilled'; }
    /* WHEN IT WAS PUT ON THE BOOK — the newest first on screen. */
    { const ms = ptDtMs(r.openedAt || r.uploadedAt); if (ms > e.addedMs) e.addedMs = ms; }
    /* PIECES, not packs. A Shopify line keeps what the customer ordered alongside, so the screen can
     * say "1 pack of 2" rather than leave somebody wondering where the second piece came from. */
    e.qty += obPieces(r);
    if (obIsShop(r)) { e.packs += obShopUnits(r); e.pcsPer = e.packs ? Math.round(e.qty / e.packs) : 1; }
    if (!e.orderDate && r.orderDate) e.orderDate = r.orderDate;
  });
  return Object.values(byKey).map(l => {
    /* ONLY A SHOPIFY QUILT KEEPS ITS OWN COUNTERS. Everything else is issued to a named karigar and
     * read from the registers — cutting data, Base Data, press inventory.
     *
     * This used to be "any Shopify line with a record of its own", and assigning a printer writes that
     * record. So putting a printer on a line hid every karigar issue booked for it and showed counters
     * nobody fills in any more. The record still carries the printer and the handovers; it just no
     * longer decides the figures, unless the line is a quilt. */
    /* A PRINTER CAN BE PUT ON ANY LINE — a sales order or a B2B order is block printed the same way
     * a Shopify one is. The handover to shipping and a quilt's own counters stay Shopify's. */
    const sp0 = spOf(l.orderNo, l.sku);
    const shp0 = l.src === 'SHP' ? sp0 : null;
    const sp = shp0 && spIsQuilt(l) ? shp0 : null;
    const cut = sp ? spNum(sp.cut) : obCutQty(l.orderNo, l.sku);
    const pressed = sp ? spNum(sp.pressed) : obPressQty(l.orderNo, l.sku);
    // Issued is the gross that went out, not the allowance figure — this screen reports work done,
    // it does not re-derive the cap.
    /* Was a full pass over Base Data for every order line — 1,669 rows × 1,300 lines. */
    const b = sp ? null : obBaseIndex().get(obKeyOf(l.orderNo, l.sku));
    const issued = sp ? spNum(sp.issued) : (b ? b.issued : 0);
    const received = sp ? spNum(sp.received) : (b ? b.received : 0);
    const cutReq = ordCutReq(l.sku);
    const cutPct = l.qty > 0 ? (cut / l.qty) * 100 : 0;
    const cutDone = !cutReq || cutPct >= ORD_THRESHOLD(l.qty);
    /* MADE IS WHAT CAME BACK — the received figure from Base Data, and nothing else.
     *
     * Ravi's rule, chosen knowingly. 97 order-and-SKU lines have more pressed than received, so 1,934
     * pressed pieces now count as still to make: nothing in Base Data says anybody received them, and
     * a press entry with no receipt behind it is a hole in the register rather than a piece that made
     * itself. Counting it as made would hide the hole; counting it as outstanding sends somebody to
     * find the missing receipt.
     *
     * Pressing is NOT added in here. It still decides "Complete" below, which is the other question:
     * whether the line can ship. */
    const made = received;
    return Object.assign({}, l, {
      cut, pressed, issued, received, made, cutReq, cutPct, cutDone,
      pendingCut: cutReq ? Math.max(0, l.qty - cut) : 0,
      pendingMake: Math.max(0, l.qty - made),
      /* MORE CAME BACK THAN WAS ORDERED. "Still to make" is floored at zero per line, because extra
       * pieces of one SKU cannot fill a shortfall in another — so the line totals do not equal
       * Ordered − Received, and this is the difference. Seven lines carry 74 pieces of it today.
       * Naming it lets the panel's own arithmetic close instead of inviting the question. */
      overRecv: Math.max(0, received - l.qty),
      /* Made, and waiting on the press. made − pressed, NOT ordered − pressed: the second counts
       * pieces nobody has made yet, which on a line is invisible (the pill only appears once the
       * line is fully made) and in a total is simply wrong — it once read 140,129 against 16,525
       * pieces actually made. */
      madeToPress: Math.max(0, made - pressed),
      /* HANDED OVER IS THE END. Pressed alone is not: a pressed piece still sitting on the table is
       * not off this screen's list, and the shipping team taking it is the moment it is. For
       * everything that is not a Shopify line, nothing changes — there is no handover to wait for. */
      /* THE REST OF THE RECORD IS EVERY SHOPIFY LINE'S, quilt or not: who prints it, and whether the
       * shipping team has it. Only the counters above are a quilt's alone. Reading these from the
       * quilt-only record made every handed-over tablecloth come back as open. */
      printer: sp0 ? String(sp0.printer || '') : '',
      printed: sp0 ? spNum(sp0.printed) : 0,
      printedAt: sp0 ? (sp0.printedAt || '') : '',
      /* Printing is a stage, so it has its own outstanding figure. Only a line that HAS a printer can
       * be waiting on printing — one nobody prints is not behind, it simply does not print. */
      pendingPrint: sp0 && sp0.printer ? Math.max(0, l.qty - spNum(sp0.printed)) : 0,
      handedAt: shp0 ? (shp0.handedAt || '') : '',
      handedBy: shp0 ? (shp0.handedBy || '') : '',
      spRemarks: shp0 ? String(shp0.remarks || '') : '',
      open: l.shopDoneAt ? false : (shp0 ? !spHanded(shp0) : pressed < l.qty),
    });
  }).map(l => {
    /* HANDED OVER IS THE END. The goods are with a customer, so nothing on this line is outstanding
     * whatever the registers say — leaving it in "still to make" asks the floor to make pieces that
     * have gone. What the registers never recorded is not swept away with it: it is carried here, shown
     * on the row and counted in its own tile, because a register hole is worth seeing. */
    /* AND SO IS COMPLETE (Ravi, 2026-09-24: "jo item handed over ya complete ho gya ho wo to make me nahi
     * aana chahiye"). A line pressed in full is finished, so it owes nothing to cut or make even when
     * Base Data never recorded the receipt. That hole is still shown — as "never recorded" beside the
     * status, never as work for the floor. */
    if (!l.handedAt && l.open) return Object.assign(l, { unrecorded: 0 });
    /* A line the shipping team fulfilled from stock was never owed by the floor — not a register hole. */
    return Object.assign(l, { unrecorded: l.shopDoneAt && !l.handedAt ? 0 : Math.max(0, l.qty - l.made),
      pendingCut: 0, pendingMake: 0, madeToPress: 0 });
  }).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}

/**
 * A date as the registers write it, turned into YYYY-MM-DD - or an empty string when it is not a
 * date at all.
 *
 * TWO SHAPES ARE IN THE DATA and only one of them parsed. Sales orders write ISO; the production
 * workbook and the vendor orders write DD-MM-YYYY. Handing the second to new Date gives Invalid
 * Date, which is how 234,847 units came to be marked "no date" while every row had one.
 */
function pdIso(v) {
  const d = String(v == null ? '' : v).trim();
  if (!d) return '';
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);   // day first, as India writes it
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  return '';
}

/**
 * Order + SKU -> the date that order promised, earliest first.
 *
 * The line's own delivery date where it has one, else the order's. This is a PROMISE, not a guess:
 * a line whose order said nothing gets nothing here and is shown as undated.
 */
function ordDueIndex() {
  const m = new Map();
  (SOX.rows || []).forEach(o => {
    if (!o) return;
    const no = obUC(o._id || o._key), ord = pdIso(o.deliveryDate);
    soLines(o).forEach(l => {
      const d = pdIso(l.deliveryDate) || ord;
      if (!d) return;
      const k = no + '|' + obUC(l.sku);
      const cur = m.get(k);
      if (!cur || d < cur) m.set(k, d);
    });
  });
  return m;
}

/**
 * WHAT IS BEING MADE RIGHT NOW, read off the Order Console.
 *
 * One row per open order line, in the shape the In Production list has always had, so everything
 * downstream - the map, the forecast, the India Stock projection, the exports - is unchanged.
 *
 * ORDERED MINUS PRESSED. Pressing is the last stage inside the factory and the console closes a line
 * at it, so a piece that is through the press is finished goods, not production. A Shopify line stays
 * open until shipping takes it; if its pieces are already pressed it contributes nothing here, which
 * is right - it is waiting to go out, not waiting to be made.
 *
 * The supplier field carries the ORDER NUMBER. That is what the floor asks about now that everything goes by
 * order, and it means the cell can say which orders a total is made of instead of one bare figure.
 */
function ordProdRows() {
  const due = ordDueIndex();
  const out = [];
  ordLines().forEach(r => {
    if (!r.open) return;
    const left = Math.max(0, r.qty - r.pressed);
    if (!left) return;
    out.push({ sku: r.sku, qty: left, start: pdIso(r.orderDate),
      ready: due.get(r.orderNo + '|' + r.sku) || '',
      supplier: r.orderNo, orderNo: r.orderNo,
      /* Which stage it is sitting at, from the line's own figures - no vendor or finished-goods read,
       * so this stays a cheap screen to open. */
      stage: r.pendingCut > 0 ? 'to cut' : (r.pendingMake > 0 ? 'to make' : (r.madeToPress > 0 ? 'to press' : 'made')) });
  });
  return out;
}

