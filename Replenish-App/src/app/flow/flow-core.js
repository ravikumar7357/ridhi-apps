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
/* ON EVERYWHERE SINCE 14 OCT (Ravi: "1 url kro — live par sab kuch, but test jab tak rahe jab tak me pakka n krlu"). The
 * flow screens, the new menu and the Greige Desk are on the live app too; localStorage flow = '0' still turns them off on
 * one computer. What keeps it a TEST is FLOW_REAL below. */
const FLOW_ON = (() => {
  try { const v = localStorage.getItem('flow'); if (v === '0') return false; } catch (e) { /* storage blocked */ }
  return true;
})();
/* FLOW_REAL — does the flow run the REAL sales orders? Not yet: until Ravi says it is right, the flow runs the TEST orders
 * alone (made from a sales order with "+ Test order"). Real orders keep going through the screens they always did, which
 * do not refuse them, and the flow's lists hold no real line. Turning this on is the one switch for "move forward":
 * FLOW_REAL_DEFAULT = true (or localStorage flowReal = '1' on one computer to try it). */
/* ON FOR EVERY ORDER SINCE 15 OCT (Ravi: "sare order delete karunga jo abhi open h, then i will upload new orders", and the
 * old printing screens came off the menu). localStorage flowReal = '0' puts one computer back in the test phase. */
const FLOW_REAL_DEFAULT = true;
const FLOW_REAL = (() => {
  try { const v = localStorage.getItem('flowReal'); if (v === '1') return true; if (v === '0') return false; } catch (e) { /* storage blocked */ }
  return FLOW_REAL_DEFAULT;
})();
const FLOW_NO_REAL = Object.freeze([]);
/* SHOPIFY RUNS FOR REAL (Ravi, 15 Oct: "aage se sales order hamara production bucket se order open ho to auto ppc me aana
 * chahiye, hume test order se 1 bhi order open nahi karna h"). With FLOW_REAL still off, a Shopify / online order put on
 * the book from FLOW_MTO_FROM on — opened from the Production bucket — is a real flow order: it is in PPC by itself, and the
 * old screens hand its printing to PPC. Shopify lines opened before, and every Amazon / B2B order, go the old way.
 * The day is the day the line was OPENED (openIso), not the day the customer ordered: an order opened today from last
 * week is still new. localStorage flowMto = '0' turns it off on one computer. */
const FLOW_MTO_FROM = '2026-10-15';
const FLOW_MTO_LIVE = (() => { try { return localStorage.getItem('flowMto') !== '0'; } catch (e) { return true; } })();
/** A real line put on the book from FLOW_MTO_FROM on. With FLOW_REAL every such line is new (15 Oct: the open orders were
 * deleted and uploaded again, many with an order date from before flowFrom() — the day they came onto the book is what
 * makes them PPC's). */
const flowOpenNew = r => !!(r && !r.__t && String(r.openIso || '') >= FLOW_MTO_FROM);
const flowMtoLive = r => !!(FLOW_MTO_LIVE && r && ordIsMto(obUC(r.orderNo)) && flowOpenNew(r));
let FLOW_MTO_C = { src: null, rows: FLOW_NO_REAL, nos: new Set(), open: new Set() };
/** The real lines the flow runs while FLOW_REAL is off — the Shopify / online ones opened from FLOW_MTO_FROM. */
function flowMtoLines() {
  const src = typeof ordLines === 'function' ? ordLines() : [];
  if (FLOW_MTO_C.src !== src) { const rows = src.filter(flowMtoLive); FLOW_MTO_C = { src, rows, nos: new Set(rows.map(r => obUC(r.orderNo))),
    open: new Set(src.filter(flowOpenNew).map(r => obUC(r.orderNo))) }; }
  return FLOW_MTO_C.rows;
}
/** What the flow's screens say about the phase they are in (14 Oct: the flow is on the live app, so "not on the live app"
 * was no longer true). */
const flowPhaseTxt = () => FLOW_REAL ? `LIVE — the flow runs the real orders from ${flowFrom()}, and every order put on the book from ${FLOW_MTO_FROM}`
  : FLOW_MTO_LIVE ? `Shopify LIVE — Shopify / online orders opened from the Production bucket from ${FLOW_MTO_FROM} run here by themselves; Amazon / B2B still go the old way (test orders only)`
  : 'TEST phase — the flow runs test orders only; real orders go the old way';
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
  /* test phase: a real order is not the flow's — unless it is a Shopify / online order opened from FLOW_MTO_FROM */
  if (!FLOW_REAL) return ordIsMto(no) && (flowMtoLines(), FLOW_MTO_C.nos.has(no));
  if ((flowMtoLines(), FLOW_MTO_C.open.has(no))) return true;   // put on the book from FLOW_MTO_FROM, whatever its order date
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
/* MADE TO ORDER (Shopify, online): after QC the line goes to the shipping team on the Order Console, never to Finished
 * Goods. A TEST copy of a Shopify order (TEST-SHP-…) is made to order too — its own platform says so (14 Oct). */
const flowTestSrcOf = no => { const t = (typeof FLOW !== 'undefined' && FLOW.test) || {}; return obUC((t[no] || t[obUC(no)] || {}).src); };
const flowIsMtoNo = no => ordIsMto(obUC(no)) || /^(SHP|ONL)$/.test(flowTestSrcOf(no));
const flowIsMto = r => !!r && (ordIsMto(obUC(r.orderNo)) || (!!r.__t && /^(SHP|ONL)$/.test(obUC(r.src))));
function flowFgOwns(orderNo, sku) {
  if (!flowOwnsOrder(orderNo) || flowIsMtoNo(orderNo)) return false;
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
  /* BACK TO THE SALES TEAM (Ravi, 15 Oct, flow-back.js): lines PPC could not plan, waiting for the sales team to put them right. */
  ['back', 'Back to sales team', 'flppc', 'PPC sent these back with a reason. They come back into PPC when the sales team (Sales Orders) sends them again.', 'flow'],
  ['drfd', 'RFD fabric · out to printers', 'fldem', 'Planned; the fabric is not with the printer yet. RFD in stock against what each line needs — red where it falls short; make the challan to the printer.', 'demand'],
  /* EMBROIDERY (Ravi, 21 Oct): the printed cloth of a line PPC sent to embroidery goes out in metres and comes back as
   * pieces — the fabric team's, on its own challans (flow-emb.js). */
  ['demb', 'Embroidery', 'flchl', 'Printed fabric back for lines PPC sent to embroidery: send it (metres) to the embroidery department or vendor, and receive the embroidered pieces — they go on to Cutting, then straight to QC.', 'demand'],
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
const FLOW_ELSEWHERE = { emb: 'Embroidery (Demand → Embroidery)', ship: 'Ready — hand to shipping (Order Console → Production to shipping)', qcb: 'Quality Control (QC screen)',fgin: 'Finished Goods — to accept (Finished Goods screen)', fabric: 'With the printer — receive in Demand → Printed fabric in, see Vendors & printers → History',
  vendor: 'Vendor Orders — not given to a printer yet', out: 'Made outside — received into Finished Goods', cut: 'Cutting Data → To cut', raw: 'Job Work Register → Raw cutting in store', wip: 'Job Work Register → WIP' };
const FLOW_DEMAND = ['drfd', 'demb', 'dhist', 'dacc'];
/** The buckets of the Production flow screen itself (its own, and the Demand tabs), this account may open. */
const flowScreenAllowed = () => flowBucketsAllowed().filter(b => b[4] === 'flow' || b[4] === 'demand');
/* How a line is made — PPC chooses (Ravi, 10 Oct: "mere yaha sirf stitching hoga … printing wala part nahi hoga", and
 * a provision for orders made outside):
 *   inhouse   printed by a vendor here, then cut, stitched, QC'd here — every bucket
 *   stitch    no printing: the fabric goes from RFD/store straight to cutting and stitching — skips both printer buckets
 *   outsource made outside and bought finished — no fabric, no accessories; waits in Outsourced until received */
/* WHERE PPC SENDS IT (Ravi, 15 Oct: "PPC karte time ye select kar pau ki ye mujhe printing me bhejna h ya nahi ya direct
 * cutting department me bhejna h ya direct job work department me bhejna h"). The keys stay as they were (plans already
 * saved keep their meaning); 'jobwork' is new: no printing, no cutting, no RFD — straight to Raw cutting in store, to be
 * issued to a karigar. */
/* PRINTING + EMBROIDERY (Ravi, 21 Oct: "ppc plan me 1 section embroidery ka bhi add krna padega … pahle fabric print then
 * embroidery then cut and then Q.C"): printed as running cloth, sent in metres to the embroidery department or an embroidery
 * vendor (picked per line — plan.emb), back as pieces, cut (the cloth round the embroidery is trimmed), then QC — no
 * karigar. A SKU whose subtype says Embroidery starts on it. */
const FLOW_ROUTES = [['inhouse', 'Printing — printed by a vendor, then cut & stitched here', 'Printing'],
  ['emb', 'Printing + Embroidery — printed, embroidered, cut, then QC', 'Embroidery'],
  ['stitch', 'Cutting — no printing, straight to the cutting department', 'Cutting'],
  ['jobwork', 'Job Work — no printing, no cutting, straight to the karigars', 'Job Work'],
  ['outsource', 'Outsourced — made outside, received finished', 'Outsourced']];
const flowRouteOf = p => (p && p.route) || (p && p.print && p.print.need === false ? 'stitch' : 'inhouse');
/** A route the printer prints for: Printing, and Printing + Embroidery. */
const flowPrinted = route => route === 'inhouse' || route === 'emb';
/* PRINTED CLOTH IN HAND (Ravi, 16 Oct for Cutting; 22 Oct for Embroidery: "mere pas fabric h m direct embroidery me bhejna chahta
 * hu"): the plan's tick fabric.noRfd — nothing goes to a printer, no RFD is raised; on Embroidery the cloth goes straight to the
 * embroiderer (all of the plan's metres are ready to send). */
const flowInHand = p => !!(p && p.fabric && p.fabric.noRfd && ['stitch', 'emb'].includes(flowRouteOf(p)));
/** Our own embroidery department — picked like a vendor, never on the vendor list. */
const FLOW_EMB_DEPT = Object.freeze({ code: 'EMBDEPT', name: 'Embroidery department (in-house)' });
const flowIsEmbSku = m => /embroid/i.test(String((m && (m.subtype || m.articleSubtype)) || ''));
/** The route PPC planned for an order line, '' when it has no plan (or the plans are not read yet). For the registers. */
const flowPlanRouteOf = (orderNo, sku) => { try { const p = ((typeof FLOW !== 'undefined' && FLOW && FLOW.ppc) || {})[flowKey(orderNo, sku)]; return p ? flowRouteOf(p) : ''; } catch (e) { return ''; } };
/** Which list a line is in. Demand is one stop in the walk but two lists; the rest are the bucket itself. */
/* PART BACK, PART ON (Ravi, 11 Oct: "maine order ke against partially fabric receive kiya, but wo partially fabric cutting
 * me show nahi hua"). A line stays in the bucket of the step it has not finished, and ALSO shows where the part already
 * done can go on: printed fabric back for part of it → Cutting, for what can be cut now; pieces back from the printer
 * (or cut) and not issued → Raw cutting in store, for what can be issued now. */
const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand' && s.needFab
  : view === 'dacc' ? s.bucket === 'demand' && s.needAcc
  : view === 'cut' ? s.bucket === 'cut' || (['fabric', 'emb'].includes(s.bucket) && s.cutReq && s.canCut > 0)
  : view === 'demb' ? s.bucket === 'emb' || (s.bucket === 'fabric' && s.route === 'emb' && s.embCanSend > 0)
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
/* TEST ORDERS OFF FOR GOOD (Ravi, 15 Oct: "ab test window hata do hum real working karenge"): no "+ Test order", no
 * "Only test orders", no test order on any list. None was left in the database. localStorage flowTests = '1' brings the
 * test tools back on one computer. */
/* REMOVED FROM THE APP (Ravi, 16 Oct: "test ab chahiye hi nahi remove test"): no button, no switch on the page. The
 * localStorage key is read only by the automated tests (tests/flow-test.js), which walk the flow on test orders. */
function flowTestsOn() { try { return localStorage.getItem('flowTests') === '1'; } catch (e) { return false; } }
/* The other half, for the test phase (FLOW_REAL off): whatever the flow wrote for a REAL order while it ran on the preview
 * link — plans, fabric ready, reservations, challans, print orders, FG sends — is left out as it is read, so no flow list
 * shows it and no real accessory or RFD figure is held by it. Nothing is deleted. */
function flowDropReal() {
  /* A Shopify / online order's records are kept: those orders run for real (FLOW_MTO_LIVE). None was written before. */
  const mto = (k, v) => FLOW_MTO_LIVE && (/^(SHP|ONL)-/.test(String(k)) || /^(SHP|ONL)-/.test(obUC(v && v.orderNo)));
  const isTest = (k, v) => /^TEST-/.test(String(k)) || !!(v && (v.test || /^TEST-/.test(obUC(v.orderNo)))) || mto(k, v);
  const keep = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => isTest(k, v)));
  FLOW.ppc = keep(FLOW.ppc); FLOW.dem = keep(FLOW.dem); FLOW.res = keep(FLOW.res);
  FLOW.ch = keep(FLOW.ch); FLOW.po = keep(FLOW.po); FLOW.fg = keep(FLOW.fg); FLOW.emb = keep(FLOW.emb);
}
/* EMBROIDERY CHALLANS (flow-emb.js) are written to pt_flowChallans — the node the fabric team already writes and the flow's
 * rights already read — with kind 'emb'. As they are read they go to FLOW.emb, so every RFD challan list, total and index
 * (FLOW.ch) stays exactly what it was. */
function flowEmbSplit() {
  const ch = {}, emb = {};
  Object.entries(FLOW.ch || {}).forEach(([k, v]) => { (v && v.kind === 'emb' ? emb : ch)[k] = v; });
  FLOW.ch = ch; FLOW.emb = emb;
}
function flowDropTests() {
  const isTest = (k, v) => /^TEST-/.test(String(k)) || !!(v && (v.test || /^TEST-/.test(obUC(v.orderNo))));
  const keep = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => !isTest(k, v)));
  FLOW.test = {};
  FLOW.ppc = keep(FLOW.ppc); FLOW.dem = keep(FLOW.dem); FLOW.res = keep(FLOW.res);
  FLOW.ch = keep(FLOW.ch); FLOW.po = keep(FLOW.po); FLOW.fg = keep(FLOW.fg); FLOW.emb = keep(FLOW.emb);
}

/* ---- the data ---- */
let FLOW ={ ppc: null, dem: null, res: null, ch: null, emb: null, test: null, po: null, fg: null, rev: null, at: 0, busy: null, err: '' };
async function flowLoad(force) {
  if (FLOW.busy) return FLOW.busy;
  if (FLOW.ppc && !force && Date.now() - FLOW.at < 60e3) return;
  FLOW.busy = (async () => {
    try {
      const [ppc, dem, res, ch, test, po, fg, rev] = await Promise.all([ptGet('pt_ppc'), ptGet('pt_flowDemand'), ptGet('pt_accReserve'), ptGet('pt_flowChallans'), ptGet('pt_flowTest'), ptGet('pt_flowPrintOrders'), ptGet('pt_flowFgSend'), ptGet('pt_flowRev')]);
      FLOW.ppc = ppc || {}; FLOW.dem = dem || {}; FLOW.res = res || {}; FLOW.ch = ch || {}; FLOW.test = test || {}; FLOW.po = po || {}; FLOW.fg = fg || {}; FLOW.rev = rev || {}; FLOW.err = '';
      flowEmbSplit();
      if (!flowTestsOn()) flowDropTests();
      if (!FLOW_REAL) flowDropReal();
    } catch (e) { FLOW.err = e.message || String(e); FLOW.ppc = FLOW.ppc || {}; FLOW.dem = FLOW.dem || {}; FLOW.res = FLOW.res || {}; FLOW.ch = FLOW.ch || {}; FLOW.emb = FLOW.emb || {}; FLOW.test = FLOW.test || {}; FLOW.po = FLOW.po || {}; FLOW.fg = FLOW.fg || {}; }
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
/* WHAT IS STILL TO MAKE (Ravi, 17 Oct: "cutting wale bande ne is order ke against me cutting kar li … wo sara track kare
 * jisase demand jyada generate n ho, and aage ke action me bhi dekhna ki kisi entry ki bajah se demand jyada n bane"). The
 * share of a line not yet cut, issued or passed — the most any of those registers says is done, never their sum. Every
 * demand (RFD to send, cloth held for earlier plans, the PPC form's need) is that share of the line, not the whole of it. */
function flowRemFrac(r, s) {
  const q = +(r && r.qty) || 0; if (!(q > 0) || !s) return 1;
  const done = Math.min(q, Math.max(+s.cut || 0, +s.issued || 0, +s.made || 0));
  return (q - done) / q;
}
function flowState(r) {
  const k = flowKey(r.orderNo, r.sku), qty = +r.qty || 0;
  const cap = n => Math.max(0, Math.min(qty, +n || 0));
  const p = (FLOW.ppc || {})[k] || null, d = (FLOW.dem || {})[k] || null, res = (FLOW.res || {})[k] || null;
  const isNew = String(ptIsoDate(r.orderDate) || '') >= flowFrom() || (FLOW_REAL ? flowOpenNew(r) : flowMtoLive(r));
  /* A test order (flow-test-order.js) carries its own simulated figures instead of the registers'. */
  const t = r.__t;
  const v = t ? { given: +t.given || 0, back: +t.back || 0 } : ordVendorOf(r.orderNo, r.sku);
  const q = t ? { ok: flowQcLine(r).ok } : ordQcOf(r.orderNo, r.sku), g = t ? { in: +t.fgIn || 0 } : (ordFgAt(r.orderNo, r.sku) || {});
  const route = p ? flowRouteOf(p) : '';
  const printed = p ? flowPrinted(route) : !!(r.printer || (v && v.given > 0) || (!t && /^Vendor/.test(ordWaitingAt(r) || '')));
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
  if (p && flowPrinted(route)) {
    const pcsWise = flowPrintWhat(r, p).kind === 'sku', tp = flowToPrint(r, p), fp = +(p.fabric && p.fabric.fromPrinted) || 0;
    s.fabUnit = pcsWise ? 'pcs' : 'm'; s.fabNeed = pcsWise ? tp.pcs : tp.metres; s.fabSent = cx ? flowR2(cx.sent) : 0;
    const total = pcsWise ? qty : flowR2(+(p.fabric && p.fabric.metres) || 0), have = fp + (cx ? cx.recv : 0);
    s.fabHave = flowR2(have); s.fabTotal = total;
    if (route === 'emb' && flowInHand(p)) s.fabHave = flowR2(+(p.fabric && p.fabric.metres) || 0);   // in hand: all of it, for embroidery
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
  /* Job Work straight away: whatever the master says about cutting, PPC sent it past the cutting table. */
  s.cutReq = !!r.cutReq && route !== 'jobwork';
  s.canCut = s.cutReq ? Math.max(0, (printed ? s.back : qty) - s.cut) : 0;
  s.canIssue = Math.max(0, (s.cutReq ? s.cut : (printed ? s.back : qty)) - s.issuedNet);
  /* EMBROIDERED, THEN CUT, THEN QC (Ravi, 21 Oct). The printed cloth goes to embroidery in metres and comes back as pieces
   * (flow-emb.js); those are cut — the cloth left round the embroidery trimmed — and the cut pieces wait for QC: no karigar,
   * so "issued" and "received" are the pieces cut. A piece QC rejects is embroidered again (it leaves the embroidered count). */
  if (route === 'emb') {
    const e = (typeof flowEmbIndex === 'function' ? flowEmbIndex()[k] : null) || { sent: 0, back: 0 }, cutAll = Math.max(0, +r.cut || 0);
    s.embSent = flowR2(e.sent || 0); s.embBack = Math.max(0, +e.back || 0); s.embTo = e.to || ''; s.embNos = e.nos || [];
    s.embOk = Math.max(0, s.embBack - s.qcRej);
    s.embCanSend = flowR2(Math.max(0, (s.fabHave || 0) - s.embSent));
    s.cutReq = true; s.cut = cap(cutAll); s.cutAll = cutAll;
    s.canCut = Math.max(0, s.embBack - cutAll);
    s.issued = s.cut; s.issuedAll = cutAll; s.issuedNet = Math.max(0, cutAll - s.qcRej);
    s.received = cap(cutAll); s.receivedAll = cutAll;
    s.canIssue = 0;
  }
  const accNeed = !!p && route !== 'outsource' && (p.acc || []).some(a => a.code && +a.qty > 0);
  const handReady = !!(d && d.fabricReady && !d.fabricReady.challan);
  s.needFab = isNew && !!p && route !== 'outsource' && route !== 'jobwork' && !handReady && !flowInHand(p)
    && (flowPrinted(route) ? (flowFabOwed({ qty }, s).left > 0.01 || (flowPrintExtras(r, p).length > 0 && !(flowRufflePrinter(p) ? flowChIndex()[k + FLOW_RUF] : cx))) : (!(d && d.fabricReady) && flowRemFrac(r, s) > 0));   // the ruffle cloth goes too, on the first challan
  s.needAcc = isNew && accNeed && !res;
  s.bucket =
      (r.handedAt || r.shopDoneAt) ? 'done'
    : (isNew && !p) ? (flowIsBack(r) ? 'back' : 'ppc')
    : (route === 'outsource') ? (s.india < qty ? 'out' : 'done')
    : (s.needFab || s.needAcc) ? 'demand'
    : (printed && s.given < qty) ? 'vendor'
    : (printed && s.back < qty) ? 'fabric'
    : (route === 'emb' && s.embOk < qty) ? 'emb'
    : (route === 'emb' && s.issuedNet < qty) ? 'cut'
    : (s.cutReq && s.cut < qty) ? 'cut'
    /* REJECTED AT QC → BACK IN RAW CUTTING IN STORE (Ravi, 10 Oct: "rejected pcs raw cutting in store me hona chahiye").
     * For a planned line the pieces QC rejected are not "issued" any more: they wait in the store to be issued again. */
    : (s.issuedNet < qty && !(p && flowQcOpen(r, s))) ? 'raw'   // QC work still open comes first
    /* QC (flow-qcfg.js), for a planned line: anything still with Quality Control (waiting, spotting / touching, alteration). */
    : (s.made < qty) ? (p && (flowQcOpen(r, s) || route === 'emb') ? 'qcb' : 'wip')
    /* …a Shopify / online line is made to order: passed QC, it waits to be handed to the shipping team (14 Oct). */
    : (flowIsMto(r) && (p || isNew || r.open)) ? 'ship'
    /* …then Ready → India stock: passed and not in India stock — the Finished Goods team accepts it on its own screen. */
    : (s.india < qty && (p || isNew || r.open)) ? 'fgin'
    : 'done';
  return s;
}

/** Every open line (and every new order's lines) with its state. Cached on the order book and the three nodes. */
let FLOW_C = { src: null, test: null, ppc: null, dem: null, res: null, rows: null };
function flowRows() {
  const real = FLOW_REAL ? ordLines() : flowMtoLines(), test = flowTestLines();
  if (FLOW_C.rows && FLOW_C.src === real && FLOW_C.test === test && FLOW_C.ppc === FLOW.ppc && FLOW_C.dem === FLOW.dem && FLOW_C.res === FLOW.res && FLOW_C.ch === FLOW.ch && FLOW_C.emb === FLOW.emb && FLOW_C.po === FLOW.po && FLOW_C.fg === FLOW.fg
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
  FLOW_C = { src: real, test, ppc: FLOW.ppc, dem: FLOW.dem, res: FLOW.res, ch: FLOW.ch, emb: FLOW.emb, po: FLOW.po, fg: FLOW.fg, qc: (typeof QC !== 'undefined' ? QC.checks : null), fgi: (typeof FGI !== 'undefined' ? FGI.rows : null), rows };
  return rows;
}
