/* ================= VENDOR ORDERS =================
 *
 * Not a customer's order — an order placed WITH a printer. Different shape, different questions:
 * which vendor, what did we ask for, how much has actually come back, and what is still owed.
 *
 * A LINE IS NOT ALWAYS PIECES. An order carries `orderType` — 'cut' or 'running' — and every line in
 * it follows: a cut line has `sku`/`qty` in pieces, a running line has `fabricType`/`meters` and no
 * SKU at all. Adding the two together would be adding metres to pieces, so the totals are kept
 * apart and the unit is printed on every figure.
 *
 * WHAT CAME BACK IS THE DELIVERIES, NOT THE FIELD. `vendorQty` and `dispatchedQty` are caches of
 * `deliveries[]` and can be left behind when a delivery is edited. Today all 110 delivered lines
 * agree with their deliveries — the check below says so when they stop agreeing, rather than
 * silently showing a number nobody can reconcile.
 *
 * A CANCELLED LINE IS STILL SHOWN, greyed. Dropping it would make the order stop adding up.
 */
/* A picker filled from the data itself, so a value the tool starts using tomorrow appears on its own.
 * The chosen option is kept across refills; if it has gone from the data, the picker falls back to all. */
function ptFillSelect(id, pairs, allLabel) {
  const el = $(id), was = el.value;
  el.innerHTML = [`<option value="">${esc(allLabel)}</option>`]
    .concat(pairs.map(p => `<option value="${esc(p[0])}">${esc(p[1])}</option>`)).join("");
  el.value = was;
  if (el.value !== was) el.value = "";
}

/* Kept OUT of VO: that object is rebuilt whenever the orders are re-read, and a ticked set that
 * disappears under the render reading it is how a bulk delete acts on nothing. */
let VO_PICKED = new Set();
let VO_LOG = [];
let VO = { rows: null, map: null, err: '', busy: false, at: '', shown: [], pick: {} };

/* One read of the vendor orders at a time. The store, the Order Console's Demand view and this tab
 * can all ask in the same second, and each used to read all 657 KB for itself. */
let VO_LOADING = null;
async function ensureVo() {
  if (VO.rows === null && VO_LOADING) { await VO_LOADING; renderVo(); return; }
  if (VO.rows === null) {
    let done; VO_LOADING = new Promise(r => { done = r; });
    /* Whatever happens below, the waiters are let go — a promise left hanging would stop every
     * later call to this from ever returning. */
    try {
    VO.busy = true; renderVo();
    try {
      const [v, m] = await Promise.all([ptGet('pt_vendorOrders'), ptGet('pt_vendorMap')]);
      // Two levels deep: vendor code → order id → order. Flattened, keeping the vendor it came from.
      VO.rows = [];
      Object.entries(v || {}).forEach(([code, orders]) => Object.values(orders || {})
        .forEach(o => { if (o) VO.rows.push(Object.assign({ vendorCode: code }, o)); }));
      VO.map = m || {};
      VO.err = '';
    } catch (e) { VO.err = e.message || String(e); VO.rows = VO.rows || []; VO.map = VO.map || {}; }
    VO.at = ptStamp(); VO.busy = false;
    } finally { VO_LOADING = null; done(); }
  }
  renderVo();
}

/** A vendor code with no entry in the map is shown as the raw code — never blank, never invented. */
/**
 * What a vendor is called.
 *
 * THE MASTER ANSWERS FIRST. pt_vendorMap is a cache of portal LOGINS, written when a printer is given
 * a sign-in, and nothing keeps it in step with the vendor master — so a code whose cache row is stale
 * showed under whatever name that row happened to hold. Friends Rui Mattress arrived as VND009 and
 * inherited a leftover called "A R Textile Prints", carrying a different firm's email and phone.
 *
 * The cache is still read, for a code the master no longer has: an old order still deserves a name.
 */
const voMasterRow = c => ptList((PTG.masters || {}).vendor).find(v => v && String(v.code) === String(c)) || null;
/**
 * A PRINTER, not merely a vendor.
 *
 * Printing is the four categories whose name says so — Printer, Digital printer, Screen printer,
 * Marble printer. An embroidery firm, a fabricator and a filling house are all in the same master
 * and none of them prints anything.
 */
const spPrinters = () => voAllVendors().filter(v => /print/i.test(String(v.category || '')));
const spIsPrinterCode = c => { const v = voMasterRow(c); return !!(v && v.active !== false && /print/i.test(String(v.category || ''))); };
/** A vendor by code OR by the name somebody would type into a spreadsheet. */
function spPrinterByText(t) {
  const q = String(t == null ? '' : t).trim();
  if (!q) return null;
  const k = q.toLowerCase();
  const list = spPrinters();
  return list.find(v => String(v.code).toLowerCase() === k)
    || list.find(v => String(v.desc || v.name || '').toLowerCase() === k)
    /* "RBP-Bagru (VND001)" is what the dropdown writes into the cell, so it is what comes back. */
    || list.find(v => (String(v.desc || v.name || '') + ' (' + v.code + ')').toLowerCase() === k)
    || null;
}
const voName = c => {
  const m = voMasterRow(c);
  const fromMaster = m && String(m.desc || m.name || '').trim();
  if (fromMaster) return fromMaster;
  return (VO.map && VO.map[c] && VO.map[c].name) || c || '(no vendor)';
};
const voKnown = c => !!(voMasterRow(c) || (VO.map && VO.map[c] && VO.map[c].name));
const voLines = o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(Boolean);
const voRunning = o => o.orderType === 'running';
const voUnit = o => (voRunning(o) ? 'm' : 'pcs');
/** Running lines carry metres, cut lines pieces. */
const voQty = (o, l) => { const n = parseFloat(voRunning(o) ? l.meters : l.qty); return isFinite(n) ? n : 0; };
const voDels = l => (Array.isArray(l.deliveries) ? l.deliveries : Object.values((l && l.deliveries) || {})).filter(Boolean);
function voDone(l) {
  const d = voDels(l);
  /* ACCEPTED BEATS CLAIMED. Until somebody at this end confirms it, the printer's own figure stands
   * — 177 deliveries are already on record with nobody having accepted any of them, and demanding
   * acceptance first would show every order as nothing-received overnight. */
  if (d.length) return d.reduce((s, x) => s + vlQtyOf(x), 0);
  const cached = parseFloat(l.vendorQty != null ? l.vendorQty : l.dispatchedQty);
  return isFinite(cached) ? cached : 0;
}
/* ---- the two dates a line carries ----
 *
 * What we ASKED for is a wish; what the vendor PROMISED is the only date anybody has agreed to. So
 * planning runs on the promise where there is one, and a line with no promise is not on time — it is
 * unanswered, which is its own thing to chase.
 */
const voWant = l => String((l && l.deliveryDate) || '').trim();
const voProm = l => String((l && l.vendorDate) || '').trim();
/** Their FIRST promise. Kept for ever, so moving the date cannot quietly erase the slip. */
const voPromFirst = l => String((l && l.vendorDateFirst) || '').trim() || voProm(l);
/** The date this line is actually run against: theirs if they have given one, otherwise ours. */
const voDue = l => voProm(l) || voWant(l);

/** Whole days from one ISO date to another, or null if either is missing or unreadable. */
function voDays(fromIso, toIso) {
  const a = String(fromIso || '').trim(), b = String(toIso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const ms = new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime();
  return isFinite(ms) ? Math.round(ms / 86400000) : null;
}
/** How much longer the vendor asked for than we wanted. Positive = later than we asked. */
const voGap = l => voDays(voWant(l), voProm(l));
/** How far they have moved their OWN promise since the first one. Positive = slipped. */
const voSlip = l => voDays(voPromFirst(l), voProm(l));
/** How many times they have moved it. */
const voMoves = l => (Array.isArray(l && l.vendorDateLog) ? l.vendorDateLog : []).length;

/** Days late against the date this line runs on — null when there is no date, or nothing is owed. */
function voLateBy(o, l, todayIso) {
  if (!l || l.cancelled) return null;
  if (voQty(o, l) - voDone(l) <= 0) return null;            // nothing still owed cannot be late
  const due = voDue(l); if (!due) return null;
  const d = voDays(due, todayIso || dToday());
  return d != null && d > 0 ? d : null;
}
/** A date as Ravi reads it: day first, two-digit year. */
const dShow = iso => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : String(iso || '');
};

/** True when a cached figure no longer matches the deliveries it is supposed to summarise. */
function voStale(l) {
  const d = voDels(l); if (!d.length) return false;
  const sum = voDone(l);
  return [l.vendorQty, l.dispatchedQty].some(v => {
    const n = parseFloat(v); return isFinite(n) && Math.abs(sum - n) > 0.001;
  });
}

/** One order reduced to the numbers that matter, cancelled lines held apart. */
function voSummary(o) {
  const all = voLines(o), live = all.filter(l => !l.cancelled), dead = all.filter(l => l.cancelled);
  const ordered = live.reduce((s, l) => s + voQty(o, l), 0);
  const done = live.reduce((s, l) => s + voDone(l), 0);
  /* Unanswered lines are not late and not on time — nobody has said anything about them. They are
   * counted separately because chasing a promise and chasing a delivery are different jobs. */
  const owing = live.filter(l => voQty(o, l) - voDone(l) > 0);
  return { lines: all.length, live: live.length, cancelled: dead.length,
    cancelledQty: dead.reduce((s, l) => s + voQty(o, l), 0),
    ordered, done, owed: Math.max(0, ordered - done),
    stale: all.filter(voStale).length,
    unpromised: owing.filter(l => !voProm(l)).length,
    late: owing.filter(l => voLateBy(o, l) != null).length,
    slipped: live.filter(l => (voSlip(l) || 0) > 0).length,
    pct: ordered ? Math.round(done / ordered * 100) : 0 };
}

