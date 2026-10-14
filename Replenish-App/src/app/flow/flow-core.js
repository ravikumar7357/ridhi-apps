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

/* ---- ONE WAY IN FOR A FLOW ORDER (Ravi, 13 Oct: "remove the duplicate") ----
 * An order the flow runs — a test order, or any order dated from flowFrom() on — has its printer order raised by PPC, its
 * RFD sent and its printed fabric received on the flow's own challans, and its finished pieces accepted in Finished Goods
 * → From QC. The old screens that did the same work refuse it, and the old views that showed the same work leave it out,
 * so nothing is entered or counted twice. Older orders run the old way to the end. Only on the test link (FLOW_ON). */
let FLOW_OD = { src: null, so: null, map: null };
function flowOrderDate(no) {
  const src = typeof ordLines === 'function' ? ordLines() : [], so = (typeof SOX !== 'undefined' && SOX.rows) || null;
  if (!FLOW_OD.map || FLOW_OD.src !== src || FLOW_OD.so !== so) {
    const m = new Map();
    (so || []).forEach(o => { const k = obUC(o && (o._id || o._key)); if (k && o.orderDate) m.set(k, o.orderDate); });
    src.forEach(r => { if (r && r.orderNo && r.orderDate) m.set(obUC(r.orderNo), r.orderDate); });
    FLOW_OD = { src, so, map: m };
  }
  return FLOW_OD.map.get(obUC(no)) || '';
}
function flowOwnsOrder(orderNo, date) {
  if (!FLOW_ON) return false;
  const no = obUC(orderNo); if (!no) return false;
  if (/^TEST-/.test(no)) return true;
  const iso = String(ptIsoDate(date != null && date !== '' ? date : flowOrderDate(no)) || '');
  return !!iso && iso >= flowFrom();
}
/** A vendor order the flow made: PPC's (demandSource 'ppc', vpo_flow_…) or a test order's (tvpo_…). */
const flowVoIsFlow = o => !!(FLOW_ON && o && (o.test || o.demandSource === 'ppc' || /^(vpo_flow_|tvpo_)/.test(String(o.id || ''))));
/** The flow orders a vendor order's lines are stamped for. */
const flowOwnedIn = lines => [...new Set((lines || []).flatMap(l => (l && !l.cancelled && Array.isArray(l.forOrders) ? l.forOrders : [])
  .map(x => obUC(x && x.orderNo)).filter(no => flowOwnsOrder(no))))];
/** A flow order's finished pieces come in through Finished Goods → From QC — to accept, not the stock entry, the Excel or the
 * scanner. A make-to-order line goes to shipping on the Order Console, and an outsourced line is received from its vendor. */
function flowFgOwns(orderNo, sku) {
  if (!flowOwnsOrder(orderNo) || ordIsMto(obUC(orderNo))) return false;
  const p = ((typeof FLOW !== 'undefined' && FLOW.ppc) || {})[flowKey(orderNo, sku)];
  return !(p && flowRouteOf(p) === 'outsource');
}
const flowFgOwnsMsg = no => `${obUC(no)} is a Production flow order — its pieces come in through Finished Goods → From QC — to accept, once QC passes them.`;
const flowOwnsMsg = (nos, what) => `${nos.slice(0, 3).join(', ')}${nos.length > 3 ? ` and ${nos.length - 3} more` : ''} ${nos.length > 1 ? 'are Production flow orders' : 'is a Production flow order'}`
  + ` (dated from ${flowFrom()}): ${what}`;

/* The name on the challans and print orders (Ravi, 11 Oct: "challan me The Fabric Rush nahi hoga, yahan Ridhi Home &
 * Living karna h") — the PO settings' company when one is saved, else this. */
const FLOW_COMPANY = 'Ridhi Home & Living';

/* ---- the buckets, in the order the work moves: [key, label, the right that opens it, what it is waiting for] ---- */
/* WHERE EACH BUCKET LIVES (Ravi, 12 Oct: "New orders duplicate h — remove; Print orders Vendor Orders me h — remove; Demand
 * ek alag tab — PPC se jo demand aaye, RFD out to printers and printed fabric in history; Vendor allocation remove; cutting
 * Cutting department me, Raw cutting aur WIP Job Work Register me"): [key, label, right, what it waits for, home].
 *   home 'flow'    a bucket of the Production flow screen      home 'demand'  a tab inside its Demand bucket
 *   home 'pcut'    a tab of Cutting Data                        home 'pbase'   a tab of the Job Work Register */
const FLOW_BUCKETS = [
  ['ppc', 'PPC', 'flppc', 'Plan not raised yet: fabric, accessories, printing and dates.', 'flow'],
  /* PPC COMPLETED (Ravi, 12 Oct: "jiska PPC plan ho chuka h — yadi koi edit h to yahin se edit kar sake; aage se edit nahi
   * hoga, wo PPC se hi edit hoga"): every line PPC has raised and not finished, with what was planned and where it is now.
   * The plan is changed (or undone) here and nowhere else. */
  ['ppcdone', 'PPC completed', 'flppc', 'Plan raised — what was planned and where the line is now. A plan is changed or undone here only.', 'flow'],
  ['drfd', 'RFD fabric · out to printers', 'fldem', 'Planned; the fabric is not with the printer yet. RFD in stock against what each line needs — red where it falls short; make the challan to the printer.', 'demand'],
  ['dhist', 'Printed fabric in · history', 'flchl', 'Every RFD challan. Open until the printed fabric comes back against it — receive it here and the lines move to the store.', 'demand'],
  ['dacc', 'Accessories', 'flacc', 'Planned; the accessories are not reserved yet. Free on the shelf against what each line needs.', 'demand'],
  ['cut', 'To cut · Production flow', 'flcut', 'Lines that need cutting and have printed fabric back. The cutting entry puts the pieces in the store.', 'pcut'],
  ['raw', 'Raw cutting in store', 'flraw', 'Cut (or printed) pieces waiting to be issued to a karigar.', 'pbase'],
  ['wip', 'WIP · with karigars', 'flwip', 'With karigars: issued, not back yet.', 'pbase'],
];
const FLOW_TABS = [...new Set(FLOW_BUCKETS.map(b => b[2]))];   // one right can open more than one bucket (PPC and PPC completed)
/* AFTER WIP THE LINE LEAVES THIS SCREEN (Ravi, 10 Oct: "Q.C wala part abhi ke Q.C me flow kare, yahan se remove; ready to
 * India stock wala Finish Goods me show ho for accept"). A line still gets the bucket of where it is — 'qcb' with Quality
 * Control, 'fgin' waiting for the Finished Goods team — but no bucket of this screen lists it: the work is done there. */
/* Printed fabric in, too (Ravi, 11 Oct: "dekhne ke liye hum History tab use karenge, Printed fabric in ko hata dete h"):
 * received on its challan in Demand history, seen in Vendors & printers → History (flowVlogRows). */
const FLOW_ELSEWHERE = { qcb: 'Quality Control (QC screen)', fgin: 'Finished Goods — to accept (Finished Goods screen)', fabric: 'With the printer — receive in Demand → Printed fabric in, see Vendors & printers → History',
  vendor: 'Vendor Orders — not given to a printer yet', out: 'Made outside — received into Finished Goods', cut: 'Cutting Data → To cut', raw: 'Job Work Register → Raw cutting in store', wip: 'Job Work Register → WIP' };
const FLOW_DEMAND = ['drfd', 'dhist', 'dacc'];
/** The buckets of the Production flow screen itself (its own, and the Demand tabs), this account may open. */
const flowScreenAllowed = () => flowBucketsAllowed().filter(b => b[4] === 'flow' || b[4] === 'demand');
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
/* PART BACK, PART ON (Ravi, 11 Oct: "maine order ke against partially fabric receive kiya, but wo partially fabric cutting
 * me show nahi hua"). A line stays in the bucket of the step it has not finished, and ALSO shows where the part already
 * done can go on: printed fabric back for part of it → Cutting, for what can be cut now; pieces back from the printer
 * (or cut) and not issued → Raw cutting in store, for what can be issued now. */
const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand' && s.needFab
  : view === 'dacc' ? s.bucket === 'demand' && s.needAcc
  : view === 'cut' ? s.bucket === 'cut' || (s.bucket === 'fabric' && s.cutReq && s.canCut > 0)
  : view === 'raw' ? s.bucket === 'raw' || (['fabric', 'cut'].includes(s.bucket) && s.canIssue > 0)
  : view === 'ppcdone' ? !!s.plan && s.bucket !== 'done'
  : s.bucket === view;
const flowBucketsAllowed = () => (ME.admin ? FLOW_BUCKETS : FLOW_BUCKETS.filter(b => (ME.tabs || []).includes(b[2])));
const flowKey = (orderNo, sku) => (obUC(orderNo) + '__' + obUC(sku)).replace(/[.#$\[\]\/]/g, '_');

/* ---- THE TEST ORDERS SWITCH ----
 * 14 Oct, Ravi: "PPC me order sales order se aana chahiye", then "abhi hum jo test kar rahe h wo chalta rahe but sales order se
 * test order bana saku". Test orders stay ON, so the test under way carries on, and a new one is made FROM A SALES ORDER
 * (flow-test-order.js), its lines copied from the order book. PPC holds the real sales orders from flowFrom() on beside them.
 * localStorage flowTests = '0' takes every test order out of the screen as it is read: its plan, demand, reservations, print
 * orders, challans and FG sends too, so a test reservation holds no real accessories. Nothing is deleted from the database. */
function flowTestsOn() { try { return localStorage.getItem('flowTests') !== '0'; } catch (e) { return true; } }
function flowDropTests() {
  const isTest = (k, v) => /^TEST-/.test(String(k)) || !!(v && (v.test || /^TEST-/.test(obUC(v.orderNo))));
  const keep = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => !isTest(k, v)));
  FLOW.test = {};
  FLOW.ppc = keep(FLOW.ppc); FLOW.dem = keep(FLOW.dem); FLOW.res = keep(FLOW.res);
  FLOW.ch = keep(FLOW.ch); FLOW.po = keep(FLOW.po); FLOW.fg = keep(FLOW.fg);
}

/* ---- the data ---- */
let FLOW ={ ppc: null, dem: null, res: null, ch: null, test: null, po: null, fg: null, rev: null, at: 0, busy: null, err: '' };
async function flowLoad(force) {
  if (FLOW.busy) return FLOW.busy;
  if (FLOW.ppc && !force && Date.now() - FLOW.at < 60e3) return;
  FLOW.busy = (async () => {
    try {
      const [ppc, dem, res, ch, test, po, fg, rev] = await Promise.all([ptGet('pt_ppc'), ptGet('pt_flowDemand'), ptGet('pt_accReserve'), ptGet('pt_flowChallans'), ptGet('pt_flowTest'), ptGet('pt_flowPrintOrders'), ptGet('pt_flowFgSend'), ptGet('pt_flowRev')]);
      FLOW.ppc = ppc || {}; FLOW.dem = dem || {}; FLOW.res = res || {}; FLOW.ch = ch || {}; FLOW.test = test || {}; FLOW.po = po || {}; FLOW.fg = fg || {}; FLOW.rev = rev || {}; FLOW.err = '';
      if (!flowTestsOn()) flowDropTests();
    } catch (e) { FLOW.err = e.message || String(e); FLOW.ppc = FLOW.ppc || {}; FLOW.dem = FLOW.dem || {}; FLOW.res = FLOW.res || {}; FLOW.ch = FLOW.ch || {}; FLOW.test = FLOW.test || {}; FLOW.po = FLOW.po || {}; FLOW.fg = FLOW.fg || {}; }
    FLOW.at = Date.now(); FLOW.busy = null;
  })();
  return FLOW.busy;
}

/* ---- TWO PEOPLE AT ONCE (Ravi, 11 Oct: "mere bande same time par alag alag entry karein ek hi bucket me, to kya dono ki
 * entry save hone me risk h") ----
 * Every write names its own paths, so two people on different lines never touch each other. Where they could — the same
 * challan, the same line's Finished Goods, the shared accessory shelf, a test line's counts — a revision number in
 * pt_flowRev is moved with a compare-and-set first (ptCas): it moves only if it still holds what this screen read. If
 * somebody else saved there since, nothing is written, the screen reads everything again and says so. A new challan or
 * print order is written only where no record of that number exists yet (a number taken meanwhile → the next one). */
async function flowGuard(thing) {
  if (typeof ptCas !== 'function') return '';
  const expect = (FLOW.rev || {})[thing] || null, next = (+expect || 0) + 1;
  let r = ''; try { r = await ptCas('pt_flowRev/' + thing, expect, next); } catch (e) { return 'Could not save: ' + (e.message || e); }
  if (r) { try { await flowLoad(true); } catch (e) { /* the message still stands */ } return 'Somebody else saved here just now — the screen has been read again. Look at it and do it once more if it is still needed.'; }
  FLOW.rev = Object.assign({}, FLOW.rev, { [thing]: next });
  return '';
}
/** Write a NEW record only where nothing is yet: '' written, 'taken' somebody else holds that number. */
async function flowClaim(path, value) {
  if (typeof ptCas !== 'function') return '';
  return (await ptCas(path, null, value)) ? 'taken' : '';
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
  const q = t ? { ok: flowQcLine(r).ok } : ordQcOf(r.orderNo, r.sku), g = t ? { in: +t.fgIn || 0 } : (ordFgAt(r.orderNo, r.sku) || {});
  const route = p ? flowRouteOf(p) : '';
  const printed = p ? route === 'inhouse' : !!(r.printer || (v && v.given > 0) || (!t && /^Vendor/.test(ordWaitingAt(r) || '')));
  const s = {
    key: k, isNew, plan: p, demand: d, res, printed, route,
    given: r.printer ? qty : (v ? cap(v.given) : 0), back: r.printer ? cap(r.printed) : (v ? cap(v.back) : 0),
    cut: r.cutReq ? cap(r.cut) : 0, issued: cap(r.issued), received: cap(r.received), qc: q ? cap(q.ok) : 0,
    /* Uncapped: a piece rejected at QC is issued again, so a line can issue and receive more than it orders. */
    issuedAll: Math.max(0, +r.issued || 0), receivedAll: Math.max(0, +r.received || 0),
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
    /* ALL FROM PRINTED STOCK: nothing to print, nothing to send — given and back in full, straight to Cutting. */
    s.fromStock = !flowPrintsSomething(r, p);
    if (s.fromStock) { s.given = qty; s.back = qty; }
    else if (po || cx) {
      s.given = qty;
      const allBack = s.fabNeed <= 0 || (cx && cx.closed && s.fabSent >= s.fabNeed - 0.01);
      s.back = allBack ? qty : Math.max(s.back, cap(Math.floor(qty * Math.min(1, total > 0 ? have / total : 0) + 1e-9)));
    }
  }
  s.qcRej = p ? flowQcLine(r).rej : 0;
  s.issuedNet = p ? Math.max(0, s.issuedAll - s.qcRej) : s.issued;
  /* what can go on now, while the rest is still on its way (flowInView) */
  s.cutReq = !!r.cutReq;
  s.canCut = r.cutReq ? Math.max(0, (printed ? s.back : qty) - s.cut) : 0;
  s.canIssue = Math.max(0, (r.cutReq ? s.cut : (printed ? s.back : qty)) - s.issuedNet);
  const accNeed = !!p && route !== 'outsource' && (p.acc || []).some(a => a.code && +a.qty > 0);
  const handReady = !!(d && d.fabricReady && !d.fabricReady.challan);
  s.needFab = isNew && !!p && route !== 'outsource' && !handReady
    && (route === 'inhouse' ? (s.fabNeed - s.fabSent > 0.01 || (flowPrintExtras(r, p).length > 0 && !(flowRufflePrinter(p) ? flowChIndex()[k + FLOW_RUF] : cx))) : !(d && d.fabricReady));   // the ruffle cloth goes too, on the first challan
  s.needAcc = isNew && accNeed && !res;
  s.bucket =
      (r.handedAt || r.shopDoneAt) ? 'done'
    : (isNew && !p) ? 'ppc'
    : (route === 'outsource') ? (s.india < qty ? 'out' : 'done')
    : (s.needFab || s.needAcc) ? 'demand'
    : (printed && s.given < qty) ? 'vendor'
    : (printed && s.back < qty) ? 'fabric'
    : (r.cutReq && s.cut < qty) ? 'cut'
    /* REJECTED AT QC → BACK IN RAW CUTTING IN STORE (Ravi, 10 Oct: "rejected pcs raw cutting in store me hona chahiye").
     * For a planned line the pieces QC rejected are not "issued" any more: they wait in the store to be issued again. */
    : (s.issuedNet < qty && !(p && flowQcOpen(r, s))) ? 'raw'   // QC work still open comes first
    /* QC (flow-qcfg.js), for a planned line: anything still with Quality Control (waiting, spotting / touching, alteration). */
    : (s.made < qty) ? (p && flowQcOpen(r, s) ? 'qcb' : 'wip')
    /* …then Ready → India stock: passed and not in India stock — the Finished Goods team accepts it on its own screen. */
    : (s.india < qty && (p || isNew || r.open)) ? 'fgin'
    : 'done';
  return s;
}

/** Every open line (and every new order's lines) with its state. Cached on the order book and the three nodes. */
let FLOW_C = { src: null, test: null, ppc: null, dem: null, res: null, rows: null };
function flowRows() {
  const real = ordLines(), test = flowTestLines();
  if (FLOW_C.rows && FLOW_C.src === real && FLOW_C.test === test && FLOW_C.ppc === FLOW.ppc && FLOW_C.dem === FLOW.dem && FLOW_C.res === FLOW.res && FLOW_C.ch === FLOW.ch && FLOW_C.po === FLOW.po && FLOW_C.fg === FLOW.fg
    && FLOW_C.qc === (typeof QC !== 'undefined' ? QC.checks : null) && FLOW_C.fgi === (typeof FGI !== 'undefined' ? FGI.rows : null)) return FLOW_C.rows;
  const lines = test.length ? real.concat(test) : real;
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const rows = [];
  lines.forEach(r => {
    const s = flowState(r);
    const recent = String(ptIsoDate(r.orderDate) || '') >= since;
    if (s.bucket === 'done' && !recent) return;
    rows.push({ r, s, recent });
  });
  FLOW_C = { src: real, test, ppc: FLOW.ppc, dem: FLOW.dem, res: FLOW.res, ch: FLOW.ch, po: FLOW.po, fg: FLOW.fg, qc: (typeof QC !== 'undefined' ? QC.checks : null), fgi: (typeof FGI !== 'undefined' ? FGI.rows : null), rows };
  return rows;
}
