/* ================= PRODUCTION FLOW — every order line through Ravi's buckets (2026-10-10) =================
 *
 * Ravi's "production plan" (Downloads/production plan.docx): an order comes in, PPC raises what it needs (fabric,
 * accessories, printing, dates), the demand is arranged, a printer is given the work, the printed fabric comes in,
 * it is cut, the cut pieces wait in the store, karigars make them (issue → receive → QC), and the finished pieces go
 * to India stock. "Mene jo step bheje h wo apna apna alag alag bucket lete h" — each step is its own BUCKET, with its
 * own people, holding only the lines standing at that step.
 *
 * His choices (10 Oct): a line moves on BY ITSELF when its entry is made (no "done" button); it moves SKU by SKU, not
 * as a whole PO; PPC raises fabric, accessories, printing and planned dates; each bucket is its own access right;
 * cutting and "cut → store" are one bucket; accessories are RESERVED for the line in Demand.
 *
 * TEST ONLY until Ravi checks it: shown on a Firebase preview link (host has "--") or with localStorage flow = '1'.
 *
 * HOW THE FLOW FILES ARE LAID OUT:
 *   flow-core.js    the switch, the buckets and their rights, the data, and THE RULE that puts a line in a bucket
 *   flow-ppc.js     PPC: the plan for a line — worked out from the recipe, checked and saved by PPC
 *   flow-demand.js  Demand: fabric ready, accessories reserved (and what is short)
 *   flow-view.js    the screen: the bucket buttons and each bucket's list
 *
 * Data: pt_ppc/<line> (the plan), pt_flowDemand/<line> (fabric ready), pt_accReserve/<line> (accessories held),
 * pt_flowChallans/<no> (RFD challans, flow-challan.js).
 * Everything else is read from the registers the factory already fills — the Order Console's own figures. */

/* ---- the switch ---- */
const FLOW_ON = (() => {
  try { const v = localStorage.getItem('flow'); if (v === '0') return false; if (v === '1') return true; } catch (e) { /* storage blocked */ }
  try { return /--/.test(location.hostname) || /^(localhost|127\.)/.test(location.hostname); } catch (e) { return false; }
})();
/* PPC and Demand apply to orders from this date on: the 2,000 older POs were never planned this way, and putting them
 * all in PPC would bury the new ones. Older lines go straight to the bucket of the step they are really at. */
const FLOW_FROM_DEFAULT = '2026-10-10';
const flowFrom = () => { try { return localStorage.getItem('flowFrom') || FLOW_FROM_DEFAULT; } catch (e) { return FLOW_FROM_DEFAULT; } };

/* ---- the buckets, in the order the work moves: [key, label, the right that opens it, what it is waiting for] ---- */
const FLOW_BUCKETS = [
  ['new', 'New orders', 'flnew', 'Orders that came in over the last 7 days, and the bucket each line is in now.'],
  ['ppc', 'PPC', 'flppc', 'Plan not raised yet: fabric, accessories, printing and dates.'],
  ['pord', 'Print orders', 'flpo', 'What each printer was told to print — sent the moment PPC raised the plan; the fabric follows on challans.'],
  /* Demand is two departments (Ravi, 10 Oct): the RFD store answers for the fabric, the accessories store for the
   * accessories. A line stays in Demand until both have answered, and shows in each list only for its own part. */
  ['drfd', 'Demand · RFD fabric', 'fldem', 'Planned; the fabric is not ready yet. RFD in stock against what each line needs — red where it falls short.'],
  ['dacc', 'Demand · Accessories', 'flacc', 'Planned; the accessories are not reserved yet. Free on the shelf against what each line needs.'],
  ['dhist', 'Demand history', 'flchl', 'Every RFD challan. Open until the printed fabric comes back against it — receive it here and the lines move to the store.'],
  ['out', 'Outsourced', 'flout', 'Made outside, finished: waiting to be received into Finished Goods.'],
  ['vendor', 'Vendor allocation', 'flven', 'Printed lines not yet given to a printer in full.'],
  ['fabric', 'Printed fabric in', 'flfab', 'Given to a printer, not all back and accepted.'],
  ['cut', 'Cutting', 'flcut', 'Lines that need cutting, not all cut. The cutting entry puts the pieces in the store.'],
  ['raw', 'Raw cutting in store', 'flraw', 'Cut (or printed) pieces waiting to be issued to a karigar.'],
  ['wip', 'WIP', 'flwip', 'With karigars: issued, received, waiting for QC.'],
  ['ready', 'Ready → India stock', 'flrdy', 'Made and QC passed, not yet received into Finished Goods (Shopify: not handed to shipping).'],
];
const FLOW_TABS = FLOW_BUCKETS.map(b => b[2]);
/* How a line is made — PPC chooses (Ravi, 10 Oct: "mere yaha sirf stitching hoga … printing wala part nahi hoga", and
 * a provision for orders made outside):
 *   inhouse   printed by a vendor here, then cut, stitched, QC'd here — every bucket
 *   stitch    no printing: the fabric goes from RFD/store straight to cutting and stitching — skips both printer buckets
 *   outsource made outside and bought finished — no fabric, no accessories; waits in Outsourced until received */
const FLOW_ROUTES = [['inhouse', 'In-house — printed by a vendor, cut & stitched here', 'In-house'],
  ['stitch', 'Stitching only — no printing', 'Stitching only'],
  ['outsource', 'Outsourced — made outside, received finished', 'Outsourced']];
const flowRouteOf = p => (p && p.route) || (p && p.print && p.print.need === false ? 'stitch' : 'inhouse');
/** Which list a line is in. Demand is one stop in the walk but two lists; the rest are the bucket itself. */
const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand' && s.needFab
  : view === 'dacc' ? s.bucket === 'demand' && s.needAcc : s.bucket === view;
const flowBucketsAllowed = () => (ME.admin ? FLOW_BUCKETS : FLOW_BUCKETS.filter(b => (ME.tabs || []).includes(b[2])));
const flowKey = (orderNo, sku) => (obUC(orderNo) + '__' + obUC(sku)).replace(/[.#$\[\]\/]/g, '_');

/* ---- the data ---- */
let FLOW = { ppc: null, dem: null, res: null, ch: null, test: null, po: null, at: 0, busy: null, err: '' };
async function flowLoad(force) {
  if (FLOW.busy) return FLOW.busy;
  if (FLOW.ppc && !force && Date.now() - FLOW.at < 60e3) return;
  FLOW.busy = (async () => {
    try {
      const [ppc, dem, res, ch, test, po] = await Promise.all([ptGet('pt_ppc'), ptGet('pt_flowDemand'), ptGet('pt_accReserve'), ptGet('pt_flowChallans'), ptGet('pt_flowTest'), ptGet('pt_flowPrintOrders')]);
      FLOW.ppc = ppc || {}; FLOW.dem = dem || {}; FLOW.res = res || {}; FLOW.ch = ch || {}; FLOW.test = test || {}; FLOW.po = po || {}; FLOW.err = '';
    } catch (e) { FLOW.err = e.message || String(e); FLOW.ppc = FLOW.ppc || {}; FLOW.dem = FLOW.dem || {}; FLOW.res = FLOW.res || {}; FLOW.ch = FLOW.ch || {}; FLOW.test = FLOW.test || {}; FLOW.po = FLOW.po || {}; }
    FLOW.at = Date.now(); FLOW.busy = null;
  })();
  return FLOW.busy;
}

/* ---- THE RULE: which bucket a line is in ----
 * Read straight off the registers, in the order the work moves; the first step not finished is the bucket.
 * `printed` for a planned line is what PPC said; for an older line it is what the registers show. */
function flowState(r) {
  const k = flowKey(r.orderNo, r.sku), qty = +r.qty || 0;
  const cap = n => Math.max(0, Math.min(qty, +n || 0));
  const p = (FLOW.ppc || {})[k] || null, d = (FLOW.dem || {})[k] || null, res = (FLOW.res || {})[k] || null;
  const isNew = String(ptIsoDate(r.orderDate) || '') >= flowFrom();
  /* A test order (flow-test-order.js) carries its own simulated figures instead of the registers'. */
  const t = r.__t;
  const v = t ? { given: +t.given || 0, back: +t.back || 0 } : ordVendorOf(r.orderNo, r.sku);
  const q = t ? { ok: +t.qc || 0 } : ordQcOf(r.orderNo, r.sku), g = t ? { in: +t.fgIn || 0 } : (ordFgAt(r.orderNo, r.sku) || {});
  const route = p ? flowRouteOf(p) : '';
  const printed = p ? route === 'inhouse' : !!(r.printer || (v && v.given > 0) || (!t && /^Vendor/.test(ordWaitingAt(r) || '')));
  const s = {
    key: k, isNew, plan: p, demand: d, res, printed, route,
    given: r.printer ? qty : (v ? cap(v.given) : 0), back: r.printer ? cap(r.printed) : (v ? cap(v.back) : 0),
    cut: r.cutReq ? cap(r.cut) : 0, issued: cap(r.issued), received: cap(r.received), qc: q ? cap(q.ok) : 0,
    made: Math.max(cap(r.pressed), q ? cap(q.ok) : 0), india: (r.handedAt || r.shopDoneAt) ? qty : cap(g.in),
  };
  /* ON A CHALLAN: given to that printer by the challan itself; back in the share received of what was sent, and all of
   * it once the challan is closed (flow-receive.js). */
  /* PRINT ORDER + CHALLANS (flow-printorder.js, flow-challan.js). The print order gives the work to the printer the moment
   * PPC plans; the fabric team then sends the cloth in as many challans as it takes. A printed line needs fabric until
   * what was sent covers what is still to print (printed stock already in the store taken off first); its printed
   * fabric is back in the share of the whole it makes up — printed stock taken + printed cloth received. */
  const cx = flowChIndex()[k], po = flowPoIndex()[k];
  if (cx) s.challan = cx;
  if (po) s.po = po;
  s.fabNeed = 0; s.fabSent = 0;
  if (p && route === 'inhouse') {
    const pcsWise = flowPrintWhat(r, p).kind === 'sku', tp = flowToPrint(r, p), fp = +(p.fabric && p.fabric.fromPrinted) || 0;
    s.fabUnit = pcsWise ? 'pcs' : 'm'; s.fabNeed = pcsWise ? tp.pcs : tp.metres; s.fabSent = cx ? flowR2(cx.sent) : 0;
    const total = pcsWise ? qty : flowR2(+(p.fabric && p.fabric.metres) || 0), have = fp + (cx ? cx.recv : 0);
    if (po || cx) {
      s.given = qty;
      const allBack = s.fabNeed <= 0 || (cx && cx.closed && s.fabSent >= s.fabNeed - 0.01);
      s.back = allBack ? qty : Math.max(s.back, cap(Math.floor(qty * Math.min(1, total > 0 ? have / total : 0) + 1e-9)));
    }
  }
  const accNeed = !!p && route !== 'outsource' && (p.acc || []).some(a => a.code && +a.qty > 0);
  const handReady = !!(d && d.fabricReady && !d.fabricReady.challan);
  s.needFab = isNew && !!p && route !== 'outsource' && !handReady
    && (route === 'inhouse' ? (s.fabNeed - s.fabSent > 0.01 || (!cx && flowPrintExtras(r, p).length > 0)) : !(d && d.fabricReady));   // the ruffle cloth goes too, on the first challan
  s.needAcc = isNew && accNeed && !res;
  s.bucket =
      (r.handedAt || r.shopDoneAt) ? 'done'
    : (isNew && !p) ? 'ppc'
    : (route === 'outsource') ? (s.india < qty ? 'out' : 'done')
    : (s.needFab || s.needAcc) ? 'demand'
    : (printed && s.given < qty) ? 'vendor'
    : (printed && s.back < qty) ? 'fabric'
    : (r.cutReq && s.cut < qty) ? 'cut'
    : (s.issued < qty) ? 'raw'
    : (s.made < qty) ? 'wip'
    : (s.india < qty && (isNew || r.open)) ? 'ready'
    : 'done';
  return s;
}

/** Every open line (and every new order's lines) with its state. Cached on the order book and the three nodes. */
let FLOW_C = { src: null, test: null, ppc: null, dem: null, res: null, rows: null };
function flowRows() {
  const real = ordLines(), test = flowTestLines();
  if (FLOW_C.rows && FLOW_C.src === real && FLOW_C.test === test && FLOW_C.ppc === FLOW.ppc && FLOW_C.dem === FLOW.dem && FLOW_C.res === FLOW.res && FLOW_C.ch === FLOW.ch && FLOW_C.po === FLOW.po) return FLOW_C.rows;
  const lines = test.length ? real.concat(test) : real;
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const rows = [];
  lines.forEach(r => {
    const s = flowState(r);
    const recent = String(ptIsoDate(r.orderDate) || '') >= since;
    if (s.bucket === 'done' && !recent) return;
    rows.push({ r, s, recent });
  });
  FLOW_C = { src: real, test, ppc: FLOW.ppc, dem: FLOW.dem, res: FLOW.res, ch: FLOW.ch, po: FLOW.po, rows };
  return rows;
}
