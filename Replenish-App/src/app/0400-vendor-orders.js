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

/* ================= WHAT CAME IN, DAY BY DAY =================
 *
 * Every delivery a printer has recorded, laid out by the day it arrived. Ravi, 2026-09-07: "jab
 * vendor mujhe goods bheje to uska days wise logbook banana chahiye".
 *
 * Nothing new is stored for this. Each delivery is already written against its line as
 * { qty, date, by, at } the moment the printer records it in their portal — 176 of them today,
 * adding to exactly what the stored dispatched figures say. This reads them, it does not keep a
 * second copy that could drift.
 *
 * CUT AND RUNNING ARE NEVER ADDED TOGETHER. One is pieces, the other is metres of cloth. A single
 * "total received" across both would be a number with no unit, and this screen already says so
 * about the order list.
 */

/* Dates as they actually are in this data, not as they ought to be.
 *
 * A strict dd/mm/yyyy reader drops 22 of the 176 delivery rows — "31/08//2026" has two slashes and
 * "4/09/2026" has a one-digit day. That is 250 pieces, 7.3% of everything received, and it would
 * have gone missing from the logbook with nothing anywhere saying a row had been skipped. The app
 * writes the strict form itself, so these came in with the data; they are read, not rejected. */
function voDayOf(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  const parts = s.split('/').map(x => x.trim()).filter(x => x !== '');
  if (parts.length < 3) return '';
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900)) return '';
  return String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;
}
/** Sortable form of a day-first date. */
const voDayKey = day => { const p = String(day).split('/'); return p.length === 3 ? p[2] + p[1] + p[0] : ''; };

/**
 * The width of a cloth, in metres, read out of its own name — "Sheeting 62" is 62 inches wide.
 * There is nowhere else it is written: the fabricType master carries a code and a description and
 * no width at all, so the name is the only record there is. 914 master rows use a fabric with no
 * number in the name, and those simply cannot be worked out.
 */
function voFabWidthM(fabric) {
  const fed = fabWidthIn(fabric);
  if (fed > 0) return fed * 0.0254;
  const m = String(fabric || '').match(/(\d{2,3})\s*$/);
  const inch = m ? +m[1] : 0;
  return inch > 0 ? inch * 0.0254 : 0;
}

/**
 * The width somebody typed on the Fabric type master, in inches — 0 when nobody has.
 *
 * "Cambric", "Canvas", "Polyester" and six more carry no number in their name, so the old
 * digits-off-the-end rule read them as widthless and quietly dropped 65,466 pieces out of every
 * square-metre figure on the site. The width belongs to the fabric, not to its spelling.
 *
 * Built once per masters object: pafNeed asks this for every open order line.
 */
let FABW_IX = { src: null, map: null };
function fabWidthMap() {
  const src = (PTG.masters || {}).fabricType;
  if (FABW_IX.src === src && FABW_IX.map) return FABW_IX.map;
  const m = new Map();
  ptList(src).forEach(r => {
    const w = parseFloat(r && r.widthIn);
    if (!(w > 0)) return;
    /* Matched on either, because records say the name and forms sometimes carry the code. */
    [r.desc, r.code].forEach(x => { const k = String(x || '').trim().toLowerCase(); if (k) m.set(k, w); });
  });
  FABW_IX = { src, map: m };
  return m;
}
const fabWidthIn = fabric => fabWidthMap().get(String(fabric || '').trim().toLowerCase()) || 0;

/**
 * Square metres of cloth in a quantity — null when it cannot honestly be worked out.
 *
 * A CUT line: consumption is the running metres one piece takes, so pieces × consumption × width.
 * A RUNNING line: the quantity is already metres of cloth, so metres × width.
 */
function voSqm(r, qty) {
  const q = parseFloat(qty) || 0;
  if (!(q > 0)) return null;
  if (r.run) {
    const w = voFabWidthM(r.fabric);
    return w ? q * w : null;
  }
  const m = mdbOf(r.sku);
  if (!m) return null;
  /* A TABLECLOTH OR RUNNER IS ITS OWN SIZE (Ravi, 2026-09-29: "square meter looks wrong" — 33 of a 60x90 read
   * 122.13 m², the cloth consumed with its hems and the bolt's spare width, where the piece is 33 × 3.48 = 114.97).
   * Everything else is still the cloth a piece takes: consumption × the fabric's width. The printers' capacity
   * (pafHistory) and the printing need (pafNeed) are read the same way, so the two still measure alike. */
  const a = voSizeSqm(m);
  if (a) return q * a;
  const cons = parseFloat(m.consumption) || 0;
  const w = voFabWidthM(m.fabric);
  if (!cons || !w) return null;
  return q * cons * w;
}
/**
 * A tablecloth's or runner's own size as square metres, for a row with no consumption or no fabric width:
 * "60x90" is 60 × 90 inches, "110 Round" is cut from a 110 × 110 square. Other articles have no such rule — null.
 */
function voSizeSqm(m) {
  if (!m || !/tablecloth|runner/i.test(String(m.articleType || '') + ' ' + String(m.subtype || ''))) return null;
  const z = String(m.size || '').trim();
  const r = z.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (r) return (+r[1]) * (+r[2]) * 0.00064516;
  const d = z.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)?\s*(?:round)?$/i);
  return d && (/round/i.test(z) || /round/i.test(String(m.subtype || ''))) ? (+d[1]) * (+d[1]) * 0.00064516 : null;
}
const voSqmTxt = v => v == null ? '<span class="muted">—</span>' : nf(Math.round(v * 100) / 100);

/** Every recorded delivery, one row each, oldest fields kept as they were written. */
function voLogRows() {
  const out = [];
  (VO.rows || []).forEach(o => {
    const run = voRunning(o);
    voLines(o).forEach((l, li) => {
      voDels(l).forEach((d, di) => {
        const qty = parseFloat(d.qty) || 0;
        if (!qty) return;
        const day = voDayOf(d.date);
        out.push({
          day, key: voDayKey(day), raw: String(d.date || ''),
          /* Enough to find this exact delivery again, and a key of its own for the tick boxes. */
          li, di, del: d, ok: (d.ok && isFinite(parseFloat(d.ok.qty))) ? d.ok : null,
          key2: o.vendorCode + '/' + o.id + '/' + li + '/' + di,
          vendorCode: o.vendorCode, vendor: voName(o.vendorCode),
          orderNo: o.orderNo || o.id, id: o.id, run, unit: run ? 'm' : 'pcs',
          /* PRINTING WORK, from a printer: the firm's kind in the vendor master says printer, and the order — when it
           * names its work — names printing. A filling house's quilts are not printing capacity. */
          printing: /print/i.test(String(voCatOf(o.vendorCode) || '')) && (!o.service || voIsPrinting(o)),
          sku: l.sku || '',
          /* The fabric a RUNNING line is printed on — a cut line's comes off its master row instead. */
          fabric: run ? (l.fabricType || '') : '', colour: l.color || '',
          what: run ? [l.fabricType, l.color, l.printDirection].filter(Boolean).join(' · ')
                    : [l.articleSubtype || l.articleType, l.color, l.size].filter(Boolean).join(' · '),
          qty, by: d.by || '', at: d.at || '',
        });
      });
    });
  });
  return out;
}

/** The logbook, filtered by the toolbar this screen already has. */
function voLogFiltered() {
  const vf = $('voVendor').value, tf = $('voType').value;
  const q = $('voQ').value.trim().toLowerCase();
  return voLogRows().filter(r =>
    (!vf || r.vendorCode === vf)
    && (!tf || (r.run ? 'running' : 'cut') === tf)
    && (!q || [r.vendor, r.orderNo, r.sku, r.what, r.day, r.by].join(' ').toLowerCase().includes(q)));
}

/* renderVoLog is gone: the day-by-day log has its own tab, with its own filters and its own
 * date window. voLogRows(), which reads the deliveries, is shared by both and stays. */

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

