/* ==== ERP REPORT MAIL — THE RULES (Ravi, 17 Nov 2026) ====
 * "the user will get the update of overall report of company on monday and thursday every week automatically":
 * production (came in · started · late or stuck · went to finished goods) and shipping (shipped · MCF · pending · ready
 * to dispatch), counted per channel, with a Production PDF and a Shipping PDF listing every line.
 *
 * Agreed with Ravi, 17 Nov:
 *  - "Came in", "went to finished goods" and "shipped" count the days since the last mail: Thursday–Sunday on Monday,
 *    Monday–Wednesday on Thursday. Started, late, stuck, pending and ready to dispatch are as they stand today.
 *  - Started = the first work is recorded on the line: cutting, issue to a karigar, or a printer put on it.
 *  - Late = past the decided date, counted exactly as the ERP's red order strip counts it ("Critical: … late"): the
 *    delivery date on the sales order line, else for a Shopify or Online line 5 working days after it was opened in
 *    production; days late are calendar days (Ravi, 17 Nov: "match the ERP's numbers").
 *  - Stuck = under production and stopped at some stage: work had started, and nothing has been recorded for 5 days or
 *    more. A line never started is not stuck (it shows under Late once past its date).
 *  - Amazon's FBA shipments count as the FBA team marks them; the mail says when the last one was marked, because on
 *    17 Nov nothing had been marked since 4 Nov.
 *  - P1–P4 is the priority on the sales order line; lists show P1 first.
 *
 * Everything here is plain functions over the data as the database holds it — no reading, no sending — so the tests
 * run it on made-up orders. Error strategy: these never throw on odd data; a record that cannot be read (no order
 * number, no date) is left out of the counts, and a missing date leaves the line out of "late" rather than guessing.
 */
const RM_TZ_MS = 330 * 60e3;          // India is UTC+5:30; every business day is an India day
const RM_DAY_MS = 864e5;
const RM_MTO_DAYS = 5;                // made-to-order lines are due 5 working days after opening
const RM_STUCK_DAYS = 5;              // no work for this many days is stuck
const RM_SEND_DAYS = [1, 4];          // Monday and Thursday
const RM_PRIORITY = ['P1', 'P2', 'P3', 'P4'];
const RM_CHANNEL = { SHP: 'Shopify', ONL: 'Online', AMZ: 'Amazon', B2B: 'B2B', SPY: 'Shopify CPC (sales order)', LEG: 'Legacy' };
const RM_SHOP_STORE = { SP: 'Shopify Ridhi', CPC: 'Shopify CPC' };

/* ---- the whole report ---- */

/** data: { ob, shopProd, cut, base, press, fgi, so, alerts, shop: { orders, err }, meta } as the database holds them. */
function rmReport(data, nowMs, fromDay) {
  const win = fromDay ? rmWindowFrom(fromDay, nowMs) : rmWindow(nowMs);
  const erp = rmErpOpenList(data.alerts, nowMs);
  const lines = rmLines(data, nowMs, erp.map);
  const rep = { win, today: rmIstDay(nowMs), erpList: { used: !!erp.map, at: erp.at || 0, why: erp.why },
    prod: rmProduction(lines, data, win), ship: rmShipping(lines, data, win) };
  return win.byHand ? rmOnlySince(rep) : rep;
}

/**
 * A report by hand counts only what happened in its period (Ravi, 17 Nov: "just give me data counted from Saturday 14"
 * → "only what happened since Sat 14"). The lists that are otherwise today's picture keep only:
 *   started   first work in the period            late      its decided date fell in the period, and it is still open
 *   stuck     went 5 days without work in the period   pending   ordered / opened in the period, not shipped yet
 *   ready     became ready in the period (handed to shipping, given to the FBA team, received into the store)
 */
function rmOnlySince(rep) {
  const w = rep.win, inW = day => rmInWindow(day, w), p = rep.prod, s = rep.ship;
  const dayOfMs = ms => (ms ? rmIstDay(ms) : '');
  const handedDay = l => rmDayOf(l.handLog.reduce((m, e) => (String(e && e.at) > m ? String(e.at) : m), String(l.handedAt || '')));
  return Object.assign({}, rep, {
    prod: Object.assign({}, p, {
      started: p.started.filter(r => inW(dayOfMs(r.line.startMs))),
      late: p.late.filter(r => inW(r.line.due)),
      stuck: p.stuck.filter(r => inW(rmAddDays(dayOfMs(r.line.lastMs || r.line.openMs), RM_STUCK_DAYS))),
      dueSoon: [],
      inProduction: p.inProduction.filter(r => inW(dayOfMs(r.line.openMs))),
    }),
    ship: Object.assign({}, s, {
      shop: Object.assign({}, s.shop, {
        pending: s.shop.pending.filter(o => inW(String(o.order.at || '').slice(0, 10))),
        ready: s.shop.ready.filter(o => o.made.some(l => inW(handedDay(l)))),
      }),
      amazon: Object.assign({}, s.amazon, { pending: s.amazon.pending.filter(r => inW(dayOfMs(r.line.openMs))), ready: s.amazon.ready.filter(r => inW(r.day)) }),
      other: Object.assign({}, s.other, { pending: s.other.pending.filter(r => inW(dayOfMs(r.line.openMs))), ready: s.other.ready.filter(r => inW(r.day)) }),
    }),
  });
}

/* ---- the ERP's own list of open lines ---- */

const RM_ERP_LIST_MAX_AGE_MS = 24 * 3600e3;   // older than a day, the list is not trusted
/**
 * "take everything from the erp app" (Ravi, 17 Nov). The ERP keeps its own list of every open order line, pt_orderAlerts
 * (orders/order-alerts.js): the lines its red strip shows, with the ERP's own due date, pieces made and pieces ordered,
 * checked by an ERP page every 15 minutes. Which lines are open, their due date and pieces made are taken from it, so the
 * mail's late count is the strip's. Returns { map: key → entry, at } — or { map: null, why } when the list is missing or
 * more than a day old; the report then works lines out itself and the mail says so.
 */
function rmErpOpenList(alerts, nowMs) {
  if (!alerts || typeof alerts !== 'object' || !alerts.l) return { map: null, why: "The ERP's open-order list is not there" };
  const at = Number(alerts.at) || 0;
  if (!at) return { map: null, why: "The ERP's open-order list has never been checked" };
  if (nowMs - at > RM_ERP_LIST_MAX_AGE_MS) return { map: null, at, why: "The ERP's open-order list was last checked on " + rmShowDay(rmIstDay(at)) };
  const map = new Map();
  Object.values(alerts.l).forEach(e => { if (e && e.no && e.sku) map.set(rmKey(e.no, e.sku), e); });
  return { map, at, why: '' };
}

/* ---- dates ---- */

/** Any date the registers write (ISO, YYYY-MM-DD, DD/MM/YYYY with or without ", HH:MM") as a moment; 0 when not a date. */
function rmMs(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) - RM_TZ_MS;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) - RM_TZ_MS;
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}
const rmIstDay = ms => new Date(ms + RM_TZ_MS).toISOString().slice(0, 10);
const rmDayOf = v => { const ms = rmMs(v); return ms ? rmIstDay(ms) : ''; };
const rmWeekday = day => new Date(day + 'T00:00:00Z').getUTCDay();
function rmAddDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The day n working days after `day` — Sundays are not counted. */
function rmAddWorkDays(day, n) {
  let d = day;
  for (let k = 0; k < n;) { d = rmAddDays(d, 1); if (rmWeekday(d) !== 0) k++; }
  return d;
}
/** Calendar days from `from` to `to` (the order strip's otkDays). */
const rmDaysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / RM_DAY_MS);
/**
 * The days this mail covers: from the previous send day up to (not including) the latest send day.
 * Run on a Monday it is Thursday–Sunday; on a Thursday, Monday–Wednesday. Run by hand on another day it repeats the
 * window of the latest mail, so a re-run never double-counts or skips a day.
 */
function rmWindow(nowMs) {
  const today = rmIstDay(nowMs), sends = [];
  for (let i = 0; sends.length < 2 && i < 9; i++) {
    const d = rmAddDays(today, -i);
    if (RM_SEND_DAYS.indexOf(rmWeekday(d)) >= 0) sends.push(d);
  }
  return { fromDay: sends[1], toDay: sends[0], lastDay: rmAddDays(sends[0], -1) };
}
/**
 * A report asked for by hand from a chosen day up to and including today (Ravi, 17 Nov: "make it from Saturday" — a
 * copy for the boss counting from Saturday 14 Nov to today). The timed Monday/Thursday mails never use this.
 */
function rmWindowFrom(fromDay, nowMs) {
  const today = rmIstDay(nowMs);
  return { fromDay, toDay: rmAddDays(today, 1), lastDay: today, byHand: true };
}
const rmInWindow = (day, win) => !!day && day >= win.fromDay && day < win.toDay;

/* ---- one line per order and SKU ---- */

const rmUC = v => String(v == null ? '' : v).trim().toUpperCase();
/** Records of a database node, each carrying its own key as _key (the ERP's ptList does the same) — some records keep
 *  their order number only in the key. A new object, so the data handed in is never changed. */
const rmList = v => (Array.isArray(v) ? v.map((r, i) => [String(i), r]) : Object.entries(v || {}))
  .filter(([, r]) => r && typeof r === 'object').map(([k, r]) => Object.assign({ _key: k }, r));
const rmNum = v => Math.max(0, Math.round(Number(v) || 0));
const rmKey = (no, sku) => rmUC(no) + '|' + rmUC(sku);
const rmIsMto = no => /^(SHP|ONL)-/.test(rmUC(no));
const rmChannelOf = no => RM_CHANNEL[rmUC(no).split('-')[0]] || rmUC(no).split('-')[0] || 'Other';
/** "No", "no", blank — nothing to personalise. Anything else is what the customer asked for. */
const rmPersonal = v => (/^(no|n\/a|na|-)?$/i.test(String(v == null ? '' : v).trim()) ? '' : String(v).trim());
const rmIsShopRow = r => String(r.src || '') === 'SHP' || /^SHP-/.test(rmUC(r.orderNo));
/**
 * Pieces on an order-book row. A Shopify row says how many pieces it meant (pcs) when its quantity is in packs. The
 * ERP's obPieces multiplies an old row without pcs by the pieces per pack from the SKU master, which this script does
 * not read — such a row counts its packs (on 17 Nov, 29 of 5,081 Shopify rows had no pcs).
 */
const rmPieces = r => (rmIsShopRow(r) && rmNum(r.pcs) > 0 ? rmNum(r.pcs) : rmNum(r.qty));

/** Every order line, with its work, dates, priority and where it is now. erpMap: the ERP's open lines, or null. */
function rmLines(data, nowMs, erpMap) {
  const by = new Map();
  rmList(data.ob).forEach(r => {
    const no = rmUC(r.orderNo), sku = rmUC(r.sku);
    if (!no || !sku) return;
    const k = no + '|' + sku;
    let l = by.get(k);
    if (!l) by.set(k, l = rmNewLine(no, sku, r));
    l.qty += rmPieces(r);
    l.fromStock += rmNum(r.stockDone);
    const opened = rmMs(r.openedAt || r.uploadedAt) || rmMs(r.orderDate);
    if (opened && (!l.openMs || opened < l.openMs)) l.openMs = opened;
    if (r.shopDoneAt) { l.shopDoneAt = r.shopDoneAt; l.shopDoneWhy = r.shopDoneWhy || 'fulfilled'; }
    if (!l.img && r.shopImg) l.img = r.shopImg;
    if (!l.personal) l.personal = rmPersonal(r.customization);
  });
  /* A line the ERP lists as open but the order book here does not hold still counts — the ERP's word is the count. */
  if (erpMap) erpMap.forEach((e, k) => { if (!by.has(k)) by.set(k, rmNewLine(rmUC(e.no), rmUC(e.sku), { articleSubtype: e.what })); });
  const work = rmWorkIndex(data), sp = rmShopProdIndex(data), so = rmSalesOrderIndex(data);
  return [...by.values()].map(l => rmFinishLine(l, { work: work.get(l.key), sp: sp.get(l.key), so: so.get(l.key),
    erp: erpMap ? (erpMap.get(l.key) || null) : undefined }, nowMs));
}
function rmNewLine(no, sku, r) {
  return { key: no + '|' + sku, orderNo: no, sku, qty: 0, fromStock: 0, channel: rmChannelOf(no), mto: rmIsMto(no),
    orderDate: rmDayOf(r.orderDate), openMs: 0, color: String(r.color || ''), size: String(r.size || ''),
    article: String(r.articleSubtype || r.articleType || r.itemName || ''), img: '', personal: '',
    shopOrderNo: String(r.shopOrderNo || ''), shopOrderId: String(r.shopOrderId || ''), shopDoneAt: '', shopDoneWhy: '' };
}
/** Cut, issued, received and pressed pieces per line, with the first and the latest day work was recorded. */
function rmWorkIndex(data) {
  const ix = new Map();
  const add = (r, field, pcs, when) => {
    const q = rmNum(pcs), ms = rmMs(when) || rmMs(r.addedAt);
    if (!q || !r.orderNo || !r.sku) return;
    const k = rmKey(r.orderNo, r.sku);
    const w = ix.get(k) || { cut: 0, issued: 0, received: 0, pressed: 0, firstMs: 0, lastMs: 0, startMs: 0 };
    w[field] += q;
    if (ms) {
      w.lastMs = Math.max(w.lastMs, ms);
      if (field === 'cut' || field === 'issued') w.startMs = w.startMs ? Math.min(w.startMs, ms) : ms;
    }
    ix.set(k, w);
  };
  /* Rejected pieces at cutting do not count as cut — the cutting register's own rule (obCutQty). */
  rmList(data.cut).forEach(r => add(r, 'cut', rmNum(r.pieces) - (r.rejected === true ? rmNum(r.rejPieces) : 0), r.cutDate));
  rmList(data.base).forEach(r => {
    add(r, 'issued', r.issuePieces, r.issueDate);
    if (r.receivingDate) add(r, 'received', r.receivedPieces, r.receivingDate);
  });
  rmList(data.press).forEach(r => add(r, 'pressed', r.pieces, r.entryDate));
  return ix;
}
/** The printer and the hand-over to shipping, kept per line on pt_shopProd under the key ORDER__SKU (spOf's key). */
function rmShopProdIndex(data) {
  const ix = new Map();
  rmList(data.shopProd).forEach(r => {
    const [kNo, kSku] = String(r._key).split('__');
    const no = r.orderNo || kNo, sku = r.sku || kSku;
    if (no && sku) ix.set(rmKey(no, sku), r);
  });
  return ix;
}
/** The sales order line: its priority, and the earliest delivery date promised for it (ordDueIndex's rule). */
function rmSalesOrderIndex(data) {
  const ix = new Map();
  rmList(data.so).forEach(o => {
    const no = rmUC(o._id || o._key);
    rmList(o.lines).forEach(l => {
      if (!l.sku) return;
      const k = rmKey(no, l.sku), was = ix.get(k), due = rmDayOf(l.deliveryDate) || rmDayOf(o.deliveryDate);
      const earliest = was && was.due && (!due || was.due < due) ? was.due : due;
      ix.set(k, { priority: (was && was.priority) || rmUC(l.priority), due: earliest });
    });
  });
  return ix;
}
const RM_NO_WORK = { cut: 0, issued: 0, received: 0, pressed: 0, lastMs: 0, startMs: 0 };
/**
 * One order line made whole: its work, whether it is open, started, late or stuck, and where it waits.
 * facts.erp: the ERP's own entry for the line (null = the ERP says it is not open; undefined = no ERP list to go by).
 */
function rmFinishLine(l, facts, nowMs) {
  const w = facts.work || RM_NO_WORK, sp = facts.sp || {}, so = facts.so || {}, erp = facts.erp;
  const handedAt = l.mto ? String(sp.handedAt || '') : '';
  const own = rmOwnOpenAndDue(l, w, so, handedAt);
  const qty = erp ? rmNum(erp.qty) : l.qty;
  const pressed = erp ? rmNum(erp.pr) + rmNum(erp.fs) : own.pressed;
  const open = erp === undefined ? own.open : !!erp;
  const due = erp ? String(erp.due || '') : own.due;
  const moments = rmLineMoments(w, sp, handedAt);
  const openDay = l.openMs ? rmIstDay(l.openMs) : '';
  const idleDays = Math.floor((nowMs - (moments.lastMs || l.openMs || nowMs)) / RM_DAY_MS);
  const done = Object.assign({}, l, moments, {
    qty, cut: w.cut, issued: w.issued, received: w.received, pressed, printer: String(sp.printer || ''),
    handedAt, handLog: Array.isArray(sp.handLog) ? sp.handLog : [], open, openDay, idleDays, due, priority: so.priority || '',
    started: open && moments.startMs > 0,
    lateDays: rmLateDays(open, due, rmIstDay(nowMs)),
    /* Due today or tomorrow — the red strip's "… due today / tomorrow". */
    dueSoon: open && !!due && rmDaysBetween(rmIstDay(nowMs), due) >= 0 && rmDaysBetween(rmIstDay(nowMs), due) <= 1,
    stuck: open && moments.startMs > 0 && idleDays >= RM_STUCK_DAYS,
  });
  done.stage = rmStage(done);
  return done;
}
/**
 * Open, pieces made and due date worked out here, for when the ERP's own list cannot be used. Open until shipping takes
 * it (Shopify and Online), otherwise until pressed in full — the Order Console's rule. The sales order's date wins, else
 * a Shopify/Online line's 5 working days — the order strip's oalEntry.
 */
function rmOwnOpenAndDue(l, w, so, handedAt) {
  const pressed = w.pressed + Math.min(l.qty, l.fromStock);
  const open = l.shopDoneAt ? false : (l.mto ? !handedAt : pressed < l.qty);
  const openDay = l.openMs ? rmIstDay(l.openMs) : '';
  return { pressed, open, due: so.due || (l.mto && openDay ? rmAddWorkDays(openDay, RM_MTO_DAYS) : '') };
}
/**
 * When work on a line first started and when it last moved. A printer starts it when put on the line; the printer's
 * print entry and every hand-over move it too. (Printing progress a vendor types on the Vendor Portal challans is not
 * read here, so a line at a printer whose only news is on a challan can show as stuck.)
 */
function rmLineMoments(w, sp, handedAt) {
  const printerMs = sp.printer ? rmMs(sp.assignedAt) || rmMs(sp.at) : 0;
  const handMs = (Array.isArray(sp.handLog) ? sp.handLog : []).reduce((m, e) => Math.max(m, rmMs(e && e.at)), rmMs(handedAt));
  return {
    startMs: [w.startMs, printerMs].filter(Boolean).sort((a, b) => a - b)[0] || 0,
    lastMs: Math.max(w.lastMs, printerMs, rmMs(sp.printedAt), handMs),
  };
}
/** Days an open line is past its decided date, counted the way the ERP's red strip counts them ("LATE 75 days");
 *  0 when it is not open, has no date, or is not past it. */
const rmLateDays = (open, due, today) => (open && due && due < today ? rmDaysBetween(due, today) : 0);
/** Where an open line is waiting, in the floor's words — the Order Console's order of stages. */
function rmStage(l) {
  if (!l.open) return l.handedAt ? 'Handed to shipping' : (l.shopDoneAt ? 'Closed by shipping (' + l.shopDoneWhy + ')' : 'Complete');
  if (l.pressed >= l.qty) return 'Ready to hand over';
  if (l.printer && !l.cut && !l.issued) return 'At printer ' + l.printer;
  if (!l.cut && !l.issued) return 'Not started';
  if (l.issued < l.qty) return l.cut > l.issued ? 'Cut, to give a karigar' : 'Cutting';
  if (l.received < l.issued) return 'With karigar';
  return 'QC / press';
}

/* ---- production ---- */

function rmProduction(lines, data, win) {
  const came = lines.filter(l => l.openMs && rmInWindow(rmIstDay(l.openMs), win));
  /* The legacy order holds pieces made on the floor before the app had orders (1–15 Oct); it takes no new work, so
   * it is never started or stuck. Late follows the ERP's red strip, which counts it like any line with a date. */
  const open = lines.filter(l => l.open && l.channel !== RM_CHANNEL.LEG);
  return {
    came: rmRows(came),
    started: rmRows(open.filter(l => l.started)),
    late: rmRows(lines.filter(l => l.lateDays > 0)),
    dueSoon: rmRows(lines.filter(l => l.dueSoon)),
    /* Still in production: every open line and the pieces it still owes — the red strip's "Pending: … lines · … pcs". */
    inProduction: lines.filter(l => l.open).map(l => ({ line: l, qty: Math.max(0, l.qty - l.pressed), day: '' })),
    stuck: rmRows(open.filter(l => l.stuck)),
    finished: rmFinishedRows(lines, data, win),
  };
}
/**
 * Pieces that went into finished goods in the window. A Shopify or Online line goes when shipping accepts it from
 * production (each receipt on its own day; a line closed whole from the Order Console on its hand-over day); every
 * other line when the store receives it against its order.
 */
function rmFinishedRows(lines, data, win) {
  const byKey = new Map(lines.map(l => [l.key, l]));
  const out = [];
  lines.filter(l => l.mto).forEach(l => {
    let logged = 0;
    l.handLog.forEach(e => {
      const q = rmNum(e && e.qty);
      logged += q;
      if (q && rmInWindow(rmDayOf(e.at), win)) out.push({ line: l, qty: q, day: rmDayOf(e.at) });
    });
    if (l.handedAt && logged < l.qty && rmInWindow(rmDayOf(l.handedAt), win)) out.push({ line: l, qty: l.qty - logged, day: rmDayOf(l.handedAt) });
  });
  rmList(data.fgi).forEach(r => {
    if (r.txnType !== 'RECEIVE') return;
    const day = rmDayOf(r.createdAt) || rmDayOf(r.date);
    if (!rmInWindow(day, win)) return;
    rmFgiOrders(r).forEach(o => {
      const l = byKey.get(rmKey(o.orderNo, r.sku));
      if (l && !l.mto) out.push({ line: l, qty: o.qty, day });
    });
  });
  return rmSortRows(out);
}
/** The orders a finished-goods entry is for: its list of orders, else its one order number. */
function rmFgiOrders(r) {
  if (Array.isArray(r.orders) && r.orders.length) return r.orders.filter(o => o && o.orderNo).map(o => ({ orderNo: o.orderNo, qty: rmNum(o.qty) }));
  return r.orderNo ? [{ orderNo: r.orderNo, qty: rmNum(r.qty) }] : [];
}
const rmRows = lines => rmSortRows(lines.map(l => ({ line: l, qty: l.qty, day: '' })));
const rmPriRank = p => { const i = RM_PRIORITY.indexOf(p); return i < 0 ? RM_PRIORITY.length : i; };
/** P1 first, then the most late, then the oldest order. */
function rmSortRows(rows) {
  return rows.sort((a, b) => rmPriRank(a.line.priority) - rmPriRank(b.line.priority) || b.line.lateDays - a.line.lateDays
    || String(a.line.orderDate).localeCompare(String(b.line.orderDate)) || a.line.key.localeCompare(b.line.key));
}

/* ---- shipping ---- */

function rmShipping(lines, data, win) {
  return { shop: rmShopifyShipping(lines, data, win), amazon: rmAmazonShipping(lines, data, win),
    other: rmStoreShipping(lines, data, win), shopErr: (data.shop && data.shop.err) || '' };
}
/** How a Shopify order went — the Shopify Dispatch report's repShipVia, word for word: Amazon (or an MCF id on the order)
 *  is MCF; the carrier typed in the app counts only when Shopify names none. */
function rmShipVia(o, meta) {
  const m = meta || {}, co = String((o && o.trkCo) || '').toLowerCase();
  if (m.mcfId || /amazon/.test(co)) return 'MCF';
  if (/fedex/.test(co)) return 'FedEx';
  if (/dhl/.test(co)) return 'DHL';
  if (co) return 'Other';
  const c = String(m.carrier || '').toUpperCase();
  return c === 'MCF' ? 'MCF' : c === 'FEDEX' ? 'FedEx' : c === 'DHL' ? 'DHL' : 'No carrier';
}
/** Units of a Shopify line still to send: nothing once it shipped, else Shopify's own fulfillable count. */
function rmShopLeft(i) {
  if (!i || String(i.ffl || '').toLowerCase() === 'fulfilled') return 0;
  if (i.fq != null) return rmNum(i.fq);
  return Math.max(0, (i.cq != null ? rmNum(i.cq) : rmNum(i.qty)) - rmNum(i.rq));
}
const rmShopPending = o => !o.cancelledAt && String(o.ff || '').toLowerCase() !== 'fulfilled' && (o.items || []).some(i => rmShopLeft(i) > 0);
/**
 * Shopify, both stores. Shipped = Shopify's first parcel date falls in the window; pending = not cancelled, not fully
 * sent, something still to send. Ready to dispatch = pending, and every line production makes for it is handed over.
 */
function rmShopifyShipping(lines, data, win) {
  const orders = (data.shop && data.shop.orders) || [], meta = data.meta || {};
  const byShopId = new Map();
  lines.filter(l => l.shopOrderId).forEach(l => {
    if (!byShopId.has(l.shopOrderId)) byShopId.set(l.shopOrderId, []);
    byShopId.get(l.shopOrderId).push(l);
  });
  const imgOf = new Map(lines.filter(l => l.img).map(l => [l.sku, l.img]));
  const shipped = [], pending = [], ready = [];
  orders.forEach(o => {
    const store = RM_SHOP_STORE[o.shopBrand] || RM_SHOP_STORE.SP;
    const made = byShopId.get(String(o.id)) || [];
    const isPending = rmShopPending(o);
    const isShipped = !o.cancelledAt && !!o.shippedAt && rmInWindow(rmDayOf(o.shippedAt), win);
    const via = isShipped ? rmShipVia(o, meta[o.id]) : '';
    const isReady = isPending && made.length > 0 && made.every(l => !l.open);
    const rows = (o.items || []).map(i => rmShopItemRow(o, i, { store, made, imgOf, via }));
    if (isShipped) shipped.push({ order: o, store, via, rows });
    if (isPending) pending.push({ order: o, store, rows: rows.filter(r => r.left > 0) });
    if (isReady) ready.push({ order: o, store, made, rows: rows.filter(r => r.left > 0) });
  });
  const byOld = (a, b) => String(a.order.at).localeCompare(String(b.order.at));
  return { shipped: shipped.sort(byOld), mcf: shipped.filter(s => s.via === 'MCF'), pending: pending.sort(byOld), ready: ready.sort(byOld) };
}
/** One Shopify line for the Shipping PDF. ctx: { store, made (the order's production lines), imgOf (SKU → photo), via }. */
function rmShopItemRow(o, i, ctx) {
  const { store, made, imgOf, via } = ctx;
  const sku = rmUC(i.sku), l = made.find(x => x.sku === sku) || null;
  return { orderNo: o.no || ('#' + o.id), erpNo: l ? l.orderNo : '', prodTone: l ? (l.lateDays > 0 ? 'late' : l.stuck ? 'stuck' : '') : '', sku, name: String(i.name || ''), variant: String(i.variant || ''), qty: rmNum(i.cq != null ? i.cq : i.qty),
    left: rmShopLeft(i), img: String(i.img || '') || (l && l.img) || imgOf.get(sku) || '', channel: store, orderDate: String(o.at || ''),
    shippedAt: String(o.shippedAt || ''), via, personal: l ? l.personal : '', prodStage: l ? l.stage : 'From stock (no production line)',
    priority: l ? l.priority : '' };
}
/**
 * Where an FBA entry stands — the FBA Dispatch screen's fbaState: the old rows copied in from the sheet ('sheet') and
 * entries the FBA team gave back in full ('returned') are neither waiting nor shipped; open = pieces not given back.
 */
function rmFbaState(r) {
  const qty = rmNum(r.qty), returned = Math.min(qty, rmNum(r.fbaReturned)), open = qty - returned;
  const legacy = /^sheet/i.test(String(r.source || '')) && !(r.fbaAcceptedAt || r.fbaShippedAt || returned);
  const st = legacy ? 'sheet' : open <= 0 ? 'returned' : r.fbaShippedAt ? 'shipped' : r.fbaAcceptedAt ? 'accepted' : 'waiting';
  return { st, qty, open };
}
/**
 * Amazon: goods the store sends to the FBA team. Shipped = the FBA team marked it shipped in the window; ready to
 * dispatch = waiting for the FBA team to accept; pending = pieces of Amazon order lines not sent to FBA yet.
 * Pieces the FBA team gave back are not counted as sent.
 */
function rmAmazonShipping(lines, data, win) {
  const fba = rmList(data.fgi).filter(r => r.txnType === 'FBA').map(r => Object.assign({}, r, { state: rmFbaState(r) }))
    .filter(r => r.state.st !== 'sheet' && r.state.st !== 'returned');
  const byKey = new Map(lines.map(l => [l.key, l]));
  const sentByKey = new Map();
  fba.forEach(r => rmFgiOrders(r).forEach(o => {
    const k = rmKey(o.orderNo, r.sku), sent = r.state.qty ? Math.round(o.qty * r.state.open / r.state.qty) : 0;
    sentByKey.set(k, (sentByKey.get(k) || 0) + sent);
  }));
  const row = (r, day) => ({ entry: r, sku: rmUC(r.sku), qty: r.state.open, day, shipment: String(r.fbaShipment || ''),
    account: String(r.issuedFor || ''), line: byKey.get(rmKey(r.orderNo || (rmFgiOrders(r)[0] || {}).orderNo, r.sku)) || null });
  const shipped = fba.filter(r => r.state.st === 'shipped' && rmInWindow(rmDayOf(r.fbaShippedAt), win)).map(r => row(r, rmDayOf(r.fbaShippedAt)));
  /* Waiting for the FBA team to accept — the ERP's "FBA dispatches to accept" (My work today). Entries the team accepted
   * but never marked shipped are left out: on 17 Nov there were 2,194 of them, most already gone (Ravi, 17 Nov: match the ERP). */
  const ready = fba.filter(r => r.state.st === 'waiting').map(r => row(r, rmDayOf(r.createdAt)));
  const pending = rmSortRows(lines.filter(l => l.channel === RM_CHANNEL.AMZ && !l.shopDoneAt && (sentByKey.get(l.key) || 0) < l.qty)
    .map(l => ({ line: l, qty: l.qty - (sentByKey.get(l.key) || 0), day: '' })));
  const lastShippedDay = fba.map(r => rmDayOf(r.fbaShippedAt)).filter(Boolean).sort().pop() || '';
  return { shipped, ready, pending, lastShippedDay };
}
/**
 * B2B, Online and sales orders: the store issues the goods out against the order. Shipped = issued in the window;
 * ready to dispatch = received into the store and not issued yet; pending = pieces of the order not issued yet.
 */
function rmStoreShipping(lines, data, win) {
  const ours = lines.filter(l => !l.mto && l.channel !== RM_CHANNEL.AMZ && l.channel !== RM_CHANNEL.LEG);
  const keys = new Set(ours.map(l => l.key));
  const recv = new Map(), out = new Map(), recvDay = new Map(), shipped = [];
  rmList(data.fgi).forEach(r => {
    if (r.txnType !== 'RECEIVE' && r.txnType !== 'ISSUE') return;
    rmFgiOrders(r).forEach(o => {
      const k = rmKey(o.orderNo, r.sku);
      if (!keys.has(k)) return;
      const m = r.txnType === 'RECEIVE' ? recv : out;
      m.set(k, (m.get(k) || 0) + o.qty);
      const day = rmDayOf(r.createdAt) || rmDayOf(r.date);
      if (r.txnType === 'RECEIVE' && day > (recvDay.get(k) || '')) recvDay.set(k, day);
      if (r.txnType === 'ISSUE' && rmInWindow(day, win)) shipped.push({ key: k, qty: o.qty, day });
    });
  });
  const byKey = new Map(ours.map(l => [l.key, l]));
  const left = l => Math.max(0, l.qty - (out.get(l.key) || 0));
  return {
    shipped: rmSortRows(shipped.map(s => ({ line: byKey.get(s.key), qty: s.qty, day: s.day }))),
    ready: rmSortRows(ours.filter(l => (recv.get(l.key) || 0) > (out.get(l.key) || 0))
      .map(l => ({ line: l, qty: (recv.get(l.key) || 0) - (out.get(l.key) || 0), day: recvDay.get(l.key) || '' }))),
    pending: rmSortRows(ours.filter(l => left(l) > 0).map(l => ({ line: l, qty: left(l), day: '' }))),
  };
}

/* ---- counts for the mail ---- */

/** Orders, lines and pieces in a list of rows, and the same per channel. */
function rmCount(rows, channelOf) {
  const orders = new Set(), by = new Map();
  let pcs = 0;
  rows.forEach(r => {
    const ch = channelOf(r), no = r.line ? r.line.orderNo : (r.order ? r.order.id : r.orderNo);
    orders.add(no); pcs += r.qty || 0;
    const c = by.get(ch) || { orders: new Set(), lines: 0, pcs: 0 };
    c.orders.add(no); c.lines++; c.pcs += r.qty || 0;
    by.set(ch, c);
  });
  return { orders: orders.size, lines: rows.length, pcs,
    byChannel: [...by.entries()].map(([ch, c]) => ({ channel: ch, orders: c.orders.size, lines: c.lines, pcs: c.pcs })).sort(rmByOrdersThenName) };
}
const rmByOrdersThenName = (a, b) => b.orders - a.orders || a.channel.localeCompare(b.channel);
const rmLineChannel = r => r.line.channel;
