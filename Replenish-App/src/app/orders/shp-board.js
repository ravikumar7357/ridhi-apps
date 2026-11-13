/* ================= SHP BOARD — Shopify orders, stage by stage (TEST WINDOW) =================
 *
 * Ravi, 28 Oct: "Ek test window banao for only SHP … sath sath me mention kar saku ki ye order kab ready hoga (live nahi karna
 * h, test window m rakhna h)". One row per ORDER LINE, with a column for each stage — printer receive · cut · issued · received ·
 * QC passed · press — and every step is done from the row, in a dialog, through the SAME forms and checks the registers use
 * (the PPC plan, the cutting form, the Job Work issue form, Receive, Waiting for QC, the shipping hand-over).
 *
 * A stage cell reads "waiting − (done moved)": "1 − (0 moved)" until the work is done, "0 − (1 moved)" once it is. The buckets on
 * top count the orders waiting at each stage. A strip in the row (FLOW) shows the whole way of the line — which steps it has been
 * through (green), where it is now (orange), what is still ahead (grey).
 *
 * PRESS (Ravi, 28 Oct: "pressman add karo … press entry hote hi order showing in complete, and complete me hi shipping team accept
 * or not received kar sake"): after QC the pressman presses the pieces — a press entry names who (Keshav, Jagdish, …). From then
 * the line is in the COMPLETE tab, where shipping accepts the pieces (the real hand-over, shpReceive) or says "not received".
 * Press entries and "not received" notes are kept on TEST nodes (pt_shpBoardPress, pt_shpBoardShip): the live registers (the press
 * register has been closed since 5 Oct) are not written. The ready date of each order is on pt_shpBoardTest/<order>__<sku>.
 *
 * LIVE since 28 Oct (Ravi: "ab isko live kardo"). It shows only the Shopify orders the board OWNS — dated from FLOW_BOARD_FROM on
 * (flow-core.js) — and those are planned HERE, not in PPC: the Plan button opens the plan form (flowPpcOpen) and a line with no plan
 * waits in the 'To plan' bucket, never in PPC's. Press entries, "not received" notes and ready dates are on pt_shpBoardPress /
 * pt_shpBoardShip / pt_shpBoardTest (the names date from the test window; the data is real). */
const SHPB_ON = (() => { try { return localStorage.getItem('shpBoard') !== '0'; } catch (e) { return true; } })();   // on for everyone; shpBoard = '0' hides it on one computer
const SHPB_NODE = 'pt_shpBoardTest', SHPB_PRESS = 'pt_shpBoardPress', SHPB_SHIP = 'pt_shpBoardShip';
const SHPB_PRESSMEN = ['Keshav', 'Jagdish', 'Anokhi', 'Mangal', 'Om Prakash', 'Deepak', 'Chetram', 'Kuldeep', 'Shankar'];
let SHPB_FILLCOL = false;
let SHPB = { tab: 'pending', stage: '', ready: {}, press: {}, ship: {}, pressBy: {}, readyAt: 0, busy: false, err: '' };
/* PLAN FROM EXCEL (Ravi, 2 Nov: "excel se printer ko plan de saku … sirf plan window ka data aay sara nahi and tick wala option remove"):
 * the lines in the TO PLAN bucket as PPC's sheet — fill Printer (and anything else), Raise = yes, upload; the plan form opens with those lines
 * ticked, 40 at a time (flowXlOpenNext), and its Save raises the print orders. */
const shpbPickKey = r => (typeof flowKey === 'function' ? flowKey(r.orderNo, r.sku) : shpbKey(r.orderNo, r.sku));
const shpbToPlan = pend => pend.filter(r => shpbStages([r]).planW > 0);
const shpbKey = (orderNo, sku) => obUC(orderNo) + '__' + obUC(sku);
/* STATUS and READY DATE of a line, at the END of its row (Ravi, 29 Oct: "press ke end me status ka option chahiye like OOS, and ready date dal sake").
 * Both live on pt_shpBoardTest/<ORDER__SKU> with the pieces taken from ready stock (stockQty): { orderNo, sku, date, status, stockQty, by, at }. */
const SHPB_STATUS = [['', 'In production'], ['OOS', 'OOS — out of stock'], ['Need from printer', 'Need from printer']];
/** A TABLECLOTH that production has marked OOS or Need from printer goes the printer way — plan it, give it to the printer, receive it back, then the rest —
 *  so until it has a plan it waits in "To plan" and nothing downstream is open for it (Ravi, 29 Oct). Only while no work has started on it. */
const shpbIsCloth = r => /tablecloth/i.test(String(r.articleType || r.articleSubtype || r.itemName || ''));
const shpbGated = r => !(+r.cut > 0) && !(+r.issued > 0) && !shpbPlanOf(r) && (shpbIsShp()
  ? ((shpbIsCloth(r) && shpbStatusOf(r) === 'OOS') || shpbStatusOf(r) === 'Need from printer')
  : ((shpbFlowState(r) || {}).bucket === 'ppc'));   // AMZ / B2B / SPY: still waiting in PPC
const shpbStatusOf = r => String((((SHPB || {}).ready || {})[shpbKey(r.orderNo, r.sku)] || {}).status || '');
/** Pieces of this line completed from the India store's ready stock (never more than the line). */
const shpbStockOf = r => Math.max(0, Math.min(+r.qty || 0, parseInt((((SHPB || {}).ready || {})[shpbKey(r.orderNo, r.sku)] || {}).stockQty, 10) || 0));
/** THE STATUS THAT FOLLOWS THE ORDER (Ravi, 29 Oct): OOS / Need from printer is set by hand ONCE; from then on the line's status is the furthest step
 *  its pieces have reached — Printer received, Cut, Issued, Received, QC passed, Pressed, Accepted by shipping — or At printer / Planned once it has a plan.
 *  { label, auto } — auto false means nothing has moved yet, so the hand-set status (or In production) still shows and can be changed. */
function shpbStatusInfo(r, s) {
  s = s || shpbStages([r]);
  const steps = [['handD', 'Accepted by shipping'], ['prsD', shpbIsQuilt(r) ? 'Filled' : 'Pressed'], ['qcD', 'QC passed'], ['recD', 'Received'], ['issD', 'Issued'], ['cutD', 'Cut'], ['prcD', 'Printer received']];
  const hit = steps.find(x => s[x[0]] > 0);
  if (hit) return { label: hit[1], auto: true };
  if (s.stk) return { label: 'From stock', auto: true };
  if (shpbPlanOf(r)) return { label: s.prcA ? 'At printer' : 'Planned', auto: true };
  return { label: shpbStatusOf(r) || 'In production', auto: false };
}
let SHPB_STK = null;   // sku → India store row, taken once per draw (fgiStock is not cheap); null until the ledger is read
const shpbDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
const shpbCanEdit = () => !!(ME.admin || (typeof ptCanEdit === 'function' && ptCanEdit()));
const shpbToday = () => (typeof dToday === 'function' ? dToday() : new Date().toISOString().slice(0, 10));

/** The orders this board owns: Shopify, dated from FLOW_BOARD_FROM on, made by Ridhi. */
const shpbOwns = r => flowBoardOwns(r) && shpbIsMine(r);
/* THE SAME BOARD FOR AMAZON, B2B AND SPY (Ravi, 2 Nov: "jesa SHP board banaya h same thing B2B orders and amazon, shopify (SPY jo order bulk me
 * open krte h) ke liye bhi … ye sare PPC me jane chahiye jo abhi jate h and yaha se bhi plan kar sake"). One view per channel; the SHP board alone
 * OWNS its orders (planned only here, never in PPC). The others are only SHOWN here: they stay in PPC as before, and the Plan button opens the same
 * plan form PPC opens. Their "To plan" is what PPC still has to plan; they have no "Shipping to accept" (they end at the press / the store). */
const SHPB_KINDS = { shpboard: ['shp', 'SHP board — Shopify orders', ''], amzboard: ['amz', 'AMZ board — Amazon orders', 'AMZ'],
  b2bboard: ['b2b', 'B2B board — B2B orders', 'B2B'], spyboard: ['spy', 'SPY board — Shopify bulk orders', 'SPY'] };
const shpbIsBoard = v => !!SHPB_KINDS[v];
const shpbKind = () => { const v = typeof ordView === 'function' ? ordView() : ''; return SHPB_KINDS[v] ? SHPB_KINDS[v][0] : 'shp'; };
const shpbIsShp = () => shpbKind() === 'shp';
/** The lines a board shows: the SHP board its own orders; the others every line of their channel made by Ridhi. */
function shpbBelongs(r) {
  const k = SHPB_KINDS[typeof ordView === 'function' ? ordView() : ''];
  if (!k || k[0] === 'shp') return shpbOwns(r);
  return String(r.orderNo || '').split('-')[0] === k[2] && shpbIsMine(r);
}
/** The date typed for a line, else the date PPC planned it ready, else its make-to-order due date. */
function shpbReadyOf(r) {
  const k = shpbKey(r.orderNo, r.sku), set = SHPB.ready[k];
  if (set && set.date) return { date: set.date, how: 'set', by: String(set.by || '').split('@')[0] };
  const plan = ((typeof FLOW !== 'undefined' && FLOW && FLOW.ppc) || {})[typeof flowKey === 'function' ? flowKey(r.orderNo, r.sku) : k];
  const pd = plan && plan.dates && plan.dates.ready;
  if (pd) return { date: String(pd).slice(0, 10), how: 'PPC plan' };
  if (r.mtoDue) return { date: r.mtoDue, how: '5 working days' };
  const so = typeof SOX !== 'undefined' && SOX.rows && typeof ordDueIndex === 'function' ? ordDueIndex().get(r.orderNo + '|' + r.sku) : '';
  if (so) return { date: so, how: 'sales order' };
  return { date: '', how: '' };
}
/** Press entries added up per line: { pcs, last (day), men: [names] }. */
function shpbIndexPress(press) {
  const by = {};
  Object.values(press || {}).forEach(e => { if (!e || !e.orderNo) return; const k = shpbKey(e.orderNo, e.sku), x = by[k] || (by[k] = { pcs: 0, last: '', men: [] });
    x.pcs += Math.max(0, +e.pieces || 0); if (String(e.date || '') > x.last) x.last = String(e.date || ''); if (e.pressman && !x.men.includes(e.pressman)) x.men.push(e.pressman); });
  return by;
}
async function shpbLoad(force) {
  if (SHPB.busy || (!force && SHPB.readyAt && Date.now() - SHPB.readyAt < 60e3)) return;
  SHPB.busy = true;
  const get = async n => { try { return (await ptGet(n)) || {}; } catch (e) { SHPB.err = 'Some of the board\'s own records could not be read (' + (e.message || e) + ') — ready dates, press entries and "not received" notes may be missing.'; return {}; } };
  SHPB.err = '';
  [SHPB.ready, SHPB.press, SHPB.ship] = await Promise.all([get(SHPB_NODE), get(SHPB_PRESS), get(SHPB_SHIP)]);
  /* The India store's ledger, once, so the board can say how many pieces of a SKU are ready to complete an order from. */
  if (!Array.isArray(FGI.rows)) { try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { /* the stock button still reads it when pressed */ } }
  SHPB.pressBy = shpbIndexPress(SHPB.press);
  SHPB.busy = false; SHPB.readyAt = Date.now();
  if (typeof ordView === 'function' && shpbIsBoard(ordView())) renderShpBoard();
}
async function shpbSetReady(key, patch) {
  const [orderNo, sku] = key.split('__'), now = new Date().toISOString();
  const next = Object.assign({}, SHPB.ready[key] || {}, patch, { orderNo, sku, by: ME.email, at: now });
  const empty = !next.date && !next.status && !(parseInt(next.stockQty, 10) > 0) && !(next.fill && (next.fill.code || next.fill.name));
  try {
    if (empty) await ptDelete(SHPB_NODE + '/' + key); else await ptPut(SHPB_NODE + '/' + key, next);
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  SHPB.ready = Object.assign({}, SHPB.ready);
  if (empty) delete SHPB.ready[key]; else SHPB.ready[key] = next;
  return '';
}

/** What the Production flow says of a line that goes to a printer: the printer, the pieces owed and the pieces back (the challan person's receipts). */
let SHPB_FM = { src: null, map: null };
/** The line's flow state (bucket, plan, route…), or null. */
function shpbFlowState(r) {
  let rows; try { rows = typeof flowRows === 'function' ? flowRows() : null; } catch (e) { rows = null; }
  if (!rows) return null;
  if (SHPB_FM.src !== rows) SHPB_FM = { src: rows, map: new Map(rows.map(x => [x.r.orderNo + '|' + x.r.sku, x.s])) };
  return SHPB_FM.map.get(r.orderNo + '|' + r.sku) || null;
}
function shpbFlowOf(r) {
  const s = shpbFlowState(r);
  if (!s || !s.plan || !flowPrinted(s.route) || s.fromStock || flowInHand(s.plan)) return null;
  const q = +r.qty || 0;
  return { printer: (s.plan.printer && (s.plan.printer.code || s.plan.printer.name)) || '', back: Math.max(0, Math.min(q, +s.back || 0)) };
}
/** The stage figures of a set of lines. For each stage: A = what has ARRIVED (can be worked on), D = what it has DONE and moved on, W = what waits here. */
function shpbStages(lines) {
  const s = { pcs: 0, cutX: 0, cutMv: 0, cutNone: 0, toCut: 0, issX: 0, issMv: 0, toIssue: 0, recX: 0, recMv: 0, qcX: 0, qcMv: 0, ready: 0,
    planA: 0, planW: 0, planD: 0, prcA: 0, prcW: 0, prcD: 0, cutA: 0, cutW: 0, cutD: 0, issA: 0, issW: 0, issD: 0, recA: 0, recW: 0, recD: 0, qcA: 0, qcW: 0, qcD: 0,
    prsA: 0, prsW: 0, prsD: 0, handA: 0, handW: 0, handD: 0, stk: 0 };
  lines.forEach(r => {
    /* q = what is still to be MADE: the line less the pieces completed from ready stock (those go straight to shipping). */
    const q0 = +r.qty || 0, stk = shpbStockOf(r), q = q0 - stk, cap = n => Math.max(0, Math.min(q, +n || 0));
    const iss = cap(r.issued), rec = cap(r.received), qc = cap(r.pressed);
    const sp = (typeof spOf === 'function' ? spOf(r.orderNo, r.sku) : null) || {}, got = Math.min(q0, Number(sp.handedQty) || (r.handedAt ? q0 : 0));
    /* A QUILT IS NOT PRESSED (Ravi, 4 Nov: "quilt artile press nahi hota h direct filling ke liye jata h"): after QC it goes to the filler
     * vendor, and what comes back filled stands where pressed pieces stand — so Complete, shipping and the reports need no other change. */
    const prs = shpbIsQuilt(r) ? Math.min(qc, cap(shpbFillSum(shpbFillOf(r), 'rec'))) : Math.min(qc, cap(((SHPB.pressBy || {})[shpbKey(r.orderNo, r.sku)] || {}).pcs));
    s.pcs += q0; s.stk += stk;
    if (r.cutReq) { const c = cap(r.cut); s.cutX += c; s.cutMv += Math.min(c, iss); s.toCut += Math.max(0, q - c); s.toIssue += Math.max(0, c - iss); }
    else { s.cutNone += q; s.toIssue += Math.max(0, q - iss); }
    s.issX += iss; s.issMv += Math.min(iss, rec);
    s.recX += rec; s.recMv += Math.min(rec, qc);
    s.qcX += qc; s.qcMv += qc;
    s.ready += Math.max(0, qc - got);
    /* TO PLAN holds only what production sent to the printer (status Need from printer, or a tablecloth marked OOS) and nobody has planned yet; every other line sits at its own stage. */
    if (shpbGated(r)) { s.planA += q; s.planW += q; }
    /* A line that goes to a printer can be cut / issued only as far as the printed cloth has come back (flowState does the same). */
    /* WORK FURTHER ON SAYS THE CLOTH CAME (Ravi, 2 Nov: "kuch entry aise h jo issue press ho chuki but show kar rahi printer receive me"): a piece
     * cut, issued, received, passed or pressed is past the printer whatever the challan says — the printer receive counts at least that many. */
    const fl = shpbFlowOf(r), past = Math.max(r.cutReq ? cap(r.cut) : 0, iss, rec, qc, prs), flBack = fl ? Math.min(q, Math.max(+fl.back || 0, past)) : 0;
    const base = shpbGated(r) ? 0 : (fl ? flBack : q);
    if (fl) { s.prcA += q; s.prcD += flBack; s.prcW += q - flBack; }
    const cutDone = r.cutReq ? cap(r.cut) : base;
    if (r.cutReq) { s.cutA += base; s.cutD += cap(r.cut); s.cutW += Math.max(0, base - cap(r.cut)); }
    s.issA += cutDone; s.issD += iss; s.issW += Math.max(0, cutDone - iss);
    s.recA += iss; s.recD += rec; s.recW += Math.max(0, iss - rec);
    s.qcA += rec; s.qcD += qc; s.qcW += Math.max(0, rec - qc);
    s.prsA += qc; s.prsD += prs; s.prsW += Math.max(0, qc - prs);          // passed QC → the pressman presses it
    s.handA += prs + stk; s.handD += Math.min(got, (prs + stk) || got); s.handW += Math.max(0, prs + stk - got);   // pressed → shipping accepts it
  });
  return s;
}

const SHPB_STAGE_BG = 'background:#fdf0e8', SHPB_PAD = 'padding:3px 7px;';
/* THE STAGES, in the order the work moves — [id, label, action, waiting, done, arrived]. */
const SHPB_STAGES = [['plan', 'To plan', 'plan', 'planW', 'planD', 'planA'], ['prcv', 'Printer receive', 'prcv', 'prcW', 'prcD', 'prcA'], ['cut', 'Cut', 'cut', 'cutW', 'cutD', 'cutA'], ['issue', 'Issue', 'issue', 'issW', 'issD', 'issA'],
  ['receive', 'Receive', 'receive', 'recW', 'recD', 'recA'], ['qc', 'QC pass', 'qc', 'qcW', 'qcD', 'qcA'], ['press', 'Press', 'press', 'prsW', 'prsD', 'prsA'],
  ['hand', 'Shipping to accept', 'accept', 'handW', 'handD', 'handA']];
/** One stage cell: "waiting − (done moved)", and the button for the work that is waiting. */
/* EACH BUTTON TO THOSE WHO HOLD ITS WORK (Ravi, 2 Nov: "jiske pas access h wo hi cut issue receive kar pay — abhi cutting wala issue receive ki
 * entry kar pa rha h"). The board lets a person do from the row only what their rights let them do on the register itself: [the rights, any one
 * of them]. An admin does everything. The figures stay for everybody; only the buttons go. */
const SHPB_RIGHT = { plan: ['flppc'], print: ['flppc'], prcv: ['flchl'], cut: ['pcut', 'flcut'], issue: ['pbase', 'flraw'], receive: ['pbase', 'flwip'],
  qc: ['qc'], press: ['ppress', 'qc'], stock: ['fgi'], fill: ['pbase', 'flraw', 'flwip'] };
/* BOARD RIGHTS, ONE PER BUTTON (Ravi, 4 Nov: "access me thoda refine version … jisko jis cheej ka access du wo hi kar pay like cut,
 * issue, receive, qc, press"). Somebody given ANY board right does exactly those steps on the boards and no other — whatever screens
 * they also hold. Somebody given none keeps the rule above (the screens they hold), so nobody's work stops the day this goes live. */
const SHPB_BD = { cut: 'bdCut', issue: 'bdIssue', receive: 'bdRecv', qc: 'bdQc', press: 'bdPress', fill: 'bdFill' };
var SHPB_BD_RIGHTS = Object.values(SHPB_BD);   // var: core/auth.js reads it at sign-in
function shpbMay(act) {
  if (ME.admin) return true;
  const need = SHPB_RIGHT[act];
  if (!need) return true;   // accept / not received: shpCanReceive decides
  if (SHPB_BD[act] && SHPB_BD_RIGHTS.some(k => ME[k])) return !!ME[SHPB_BD[act]];
  return need.some(t => (ME.tabs || []).includes(t));
}
/* THE FILLER VENDOR, QUILTS ONLY (Ravi, 4 Nov: "board me yaha se only for quilt article ke liye filler vendor select kar saku — Filler
 * Vendor · Issued Qty · Received Qty — and iska access view me jodna h"). A quilt's stitched cover goes out to a filling vendor and
 * comes back filled. Kept on the line's own board record (pt_shpBoardTest/<ORDER__SKU>.fill = { code, name, iss: {id: {qty, date,
 * by, at}}, rec: {…} }) — the record the board already reads and writes, so no new rule. The button needs Board — Filler (bdFill). */
const shpbIsQuilt = r => /quilt/i.test([r.articleSubtype, r.articleType, r.itemName].filter(Boolean).join(' '));
const shpbFillOf = r => ((SHPB.ready[shpbKey(r.orderNo, r.sku)] || {}).fill) || null;
const shpbFillSum = (f, k) => Object.values((f && f[k]) || {}).reduce((a, x) => a + (+(x && x.qty) || 0), 0);
const shpbFillers = () => { let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const f = all.filter(v => /fill/i.test(String(v.category || ''))); return f.length ? f : all; };
/* THREE COLUMNS AFTER QC (Ravi, 4 Nov: "quilt ke liye press required nahi h and qc ke bad Filler · Qty · Rec"): the filler vendor and
 * its button, the pieces issued to it, the pieces received back filled. A line that is not a quilt shows a dash in all three. */
function shpbFillCell(r, k) {
  const dash = '<td class="num" style="' + SHPB_STAGE_BG + ';' + SHPB_PAD + '"><span class="muted">—</span></td>';
  if (!shpbIsQuilt(r)) return dash + dash + dash;
  const f = shpbFillOf(r), iss = shpbFillSum(f, 'iss'), rec = shpbFillSum(f, 'rec'), qc = shpbStages([r]).qcD;
  const td = (x, al) => '<td style="' + SHPB_STAGE_BG + ';' + SHPB_PAD + 'text-align:' + (al || 'center') + ';white-space:nowrap;line-height:1.25;font-size:11.5px">' + x + '</td>';
  return td((f && (f.name || f.code) ? '<b>' + esc(f.name || f.code) + '</b>' : '<span class="muted">not given</span>')
      + (shpbMay('fill') ? '<div><button type="button" class="ghost" data-shpb-act="fill" data-key="' + esc(k) + '" style="width:auto;padding:0 7px;font-size:10.5px;line-height:18px">Filler</button></div>' : ''), 'left')
    + td('<b style="font-size:13px">' + nf(iss) + '</b>' + (qc > iss ? '<div style="color:#b45309">' + nf(qc - iss) + ' passed QC, not issued</div>' : ''))
    + td('<b style="font-size:13px;color:' + (rec < iss ? '#b45309' : '#166534') + '">' + nf(rec) + '</b>' + (iss > rec ? '<div class="muted">' + nf(iss - rec) + ' with filler</div>' : ''));
}
async function shpbFillSave(r, v) {
  const key = shpbKey(r.orderNo, r.sku), was = shpbFillOf(r) || {}, all = shpbFillers();
  /* A FILLER NOT ON THE VENDOR LIST (Ravi, 4 Nov: "vendor yadi list me nahi h to manually feed kar sake"): its name is typed, kept with no code */
  const typed = String(v.venTxt || '').trim().replace(/\s+/g, ' ');
  const ven = typed ? { code: '', name: typed } : (all.find(x => String(x.code) === String(v.ven)) || null);
  if (!ven && !was.code && !was.name) return 'Pick the filler vendor, or type its name.';
  const iq = Math.round(+v.iss || 0), rq = Math.round(+v.rec || 0), qty = +r.qty || 0;
  if (iq < 0 || rq < 0) return 'Quantities cannot be below 0.';
  const iss = shpbFillSum(was, 'iss') + iq, rec = shpbFillSum(was, 'rec') + rq;
  const qcd = shpbStages([r]).qcD;
  if (iss > qty) return `Only ${nf(qty)} piece(s) on this line — ${nf(iss)} would be issued.`;
  if (iq > 0 && iss > qcd) return `Only ${nf(qcd)} piece(s) have passed QC — a quilt goes to the filler after QC.`;
  if (rec > iss) return `Only ${nf(iss)} issued — ${nf(rec)} cannot come back.`;
  const now = new Date().toISOString(), id = 'f' + Date.now().toString(36), day = v.date || shpbToday(), by = ME.email || '';
  const next = { code: ven ? String(ven.code || '') : (was.code || ''), name: ven ? String(ven.desc || ven.name || ven.code) : (was.name || ''),
    iss: Object.assign({}, was.iss || {}, iq > 0 ? { [id + 'i']: { qty: iq, date: day, by, at: now } } : {}),
    rec: Object.assign({}, was.rec || {}, rq > 0 ? { [id + 'r']: { qty: rq, date: day, by, at: now } } : {}) };
  return shpbSetReady(key, { fill: next });
}
function shpbCell(a, w, d, act, label, key, title) {
  if (!a && !d) return '<td class="num" style="' + SHPB_STAGE_BG + ';' + SHPB_PAD + '"><span class="muted">—</span></td>';
  return '<td class="num" style="' + SHPB_STAGE_BG + ';' + SHPB_PAD + 'white-space:nowrap;line-height:1.25" title="' + esc(title || '') + '">'
    + (w ? '<b style="color:#b45309">' + nf(w) + '</b>' : '<b style="color:#166534">0</b>') + '<span class="muted" style="font-size:11px"> − (' + nf(d) + ' moved)</span>'
    + (w && shpbMay(act) ? '<div><button type="button" class="ghost" data-shpb-act="' + act + '" data-key="' + esc(key) + '" style="width:auto;padding:0 7px;font-size:10.5px;line-height:18px">' + esc(label) + '</button></div>' : '') + '</td>';
}
const shpbLineOf = key => { const [o, k] = String(key).split('__'); return ordLines().find(r => r.orderNo === obUC(o) && r.sku === obUC(k)) || null; };
const shpbPlanOf = r => ((typeof FLOW !== 'undefined' && FLOW && FLOW.ppc) || {})[typeof flowKey === 'function' ? flowKey(r.orderNo, r.sku) : ''] || null;
const shpbPrinterOf = r => { const p = shpbPlanOf(r), pr = p && p.printer; return (pr && (pr.name || pr.code)) || r.printer || ''; };
const shpbIsMine = r => { try { const m = typeof mdbOf === 'function' ? mdbOf(r.sku) : null; return !(m && typeof mdbIsReady === 'function' && mdbIsReady(m)) && !(typeof shpInsertProduct === 'function' && shpInsertProduct(r.sku)); } catch (e) { return true; } };

/** The item, compact: a small picture, what it is, colour • size, the code. */
function shpbItem(r) {
  const what = [r.color, r.size].filter(Boolean).join(' • ');
  /* A LONG NAME WRAPS INSIDE ITS CELL (30 Oct: a Shopify title over the Pcs and Printer columns): the cell has a width, the text breaks to fit it. */
  return '<td style="' + SHPB_PAD + 'text-align:left;min-width:240px;width:260px;max-width:280px;white-space:normal"><div style="display:flex;gap:7px;align-items:center">' + (typeof ptImgSpan === 'function' ? ptImgSpan(r.sku, 30) : '')
    + '<div style="line-height:1.25;min-width:180px;overflow-wrap:break-word"><div style="font-weight:600;font-size:12.5px">' + esc(r.articleSubtype || r.articleType || r.itemName || '—') + '</div>'
    + '<div class="muted" style="font-size:11px">' + esc(what) + ' · <span style="font-family:ui-monospace,monospace">' + esc(r.sku) + '</span></div></div></div></td>';
}
/** THE LINE'S WHOLE WAY, as a strip: done (green), here now (orange), partly done (amber), still ahead (grey). */
function shpbFlowSpans(r, s) {
  const qf = +r.qty || 0, q = qf - shpbStockOf(r), plan = shpbPlanOf(r), fl = shpbFlowOf(r);
  const st = (a, w, d, qq) => (!a && !d) ? 'future' : (w === 0 && d >= (qq == null ? q : qq) ? 'done' : (d > 0 ? 'part' : 'active'));
  const steps = [['Plan', plan ? 'done' : 'na', 'PPC plan'], ['Printer', fl ? (fl.printer ? 'done' : 'active') : 'na', 'Printer given'],
    ['P.recv', fl ? st(s.prcA, s.prcW, s.prcD) : 'na', 'Printed cloth back from the printer'], ['Cut', r.cutReq ? st(s.cutA, s.cutW, s.cutD) : 'na', 'Cut'],
    ['Issue', st(s.issA, s.issW, s.issD), 'Issued to a karigar'], ['Recv', st(s.recA, s.recW, s.recD), 'Received from the karigar'], ['QC', st(s.qcA, s.qcW, s.qcD), 'Passed QC'],
    shpbIsQuilt(r) ? ['Filling', st(s.prsA, s.prsW, s.prsD), 'Back filled from the filler vendor'] : ['Press', st(s.prsA, s.prsW, s.prsD), 'Pressed'], ['Ship', st(s.handA, s.handW, s.handD, qf), 'Accepted by shipping']];
  const look = { done: 'background:#dcfce7;color:#166534', part: 'background:#fef3c7;color:#92400e', active: 'background:#f59e0b;color:#fff;font-weight:700', future: 'background:#f1f5f9;color:#94a3b8' };
  return steps.filter(x => x[1] !== 'na').map(x =>
    `<span title="${esc(x[2])}" style="font-size:10px;padding:1px 5px;border-radius:7px;${look[x[1]]}">${x[1] === 'done' ? '✓ ' : ''}${esc(x[0])}</span>`).join('<span class="muted" style="font-size:9px"> ›</span>');
}
const shpbFlow = (r, s) => '<td style="' + SHPB_PAD + 'text-align:left;white-space:nowrap">' + shpbFlowSpans(r, s) + '</td>';

/** One order line: date, order, ready date, item, flow, pieces, printer, then the stages. */
function shpbRow(r) {
  const k = shpbKey(r.orderNo, r.sku), s = shpbStages([r]), rd = shpbReadyOf(r), edit = shpbCanEdit(), late = rd.date && rd.date < dToday();
  const prn = shpbPrinterOf(r);
  const tips = { prcv: 'Owed by the printer − printed cloth received back on the challan', cut: 'Still to cut − cut so far', issue: 'Cut and not yet issued − issued to karigars', receive: 'Out with karigars − received back', qc: 'Received, not checked − passed QC', press: 'Passed QC, not pressed − pressed' };
  const stuck = shpbStuck(r);
  return (stuck ? '<tr style="background:#fef2f2;box-shadow:inset 4px 0 0 #dc2626">' : '<tr>') + '<td class="frz" style="' + SHPB_PAD + 'text-align:left;white-space:nowrap;font-size:12px">' + esc(shpbDmy(ptIsoDate(r.orderDate)))
    + (stuck ? `<div title="Nothing done on this line since ${esc(shpbDmy(stuck.since))} — Sundays not counted"><span class="pill" style="background:#dc2626;color:#fff;font-size:10px">Stuck ${nf(stuck.days)} day${stuck.days === 1 ? '' : 's'}</span></div>`
      + `<div style="font-size:10.5px;color:#b91c1c;white-space:normal;max-width:110px">last step: ${esc(stuck.at)} · since ${esc(shpbDmy(stuck.since))}</div>` : '') + '</td>'
    + '<td style="' + SHPB_PAD + 'text-align:left;white-space:nowrap;line-height:1.25"><a href="#" data-ordj="' + esc(r.orderNo) + '" style="color:inherit;text-decoration:underline dotted;font-weight:700">'
    + esc(String(r.shopOrderNo || r.orderNo).replace(/^#\s*/, '')) + '</a>'
    + '</td>'
    + shpbItem(r)
    + `<td class="num" style="${SHPB_PAD}"><b>${nf(r.qty)}</b></td>`
    + `<td style="${SHPB_PAD}text-align:left;font-size:11.5px;white-space:nowrap;line-height:1.25">${prn ? '<b>' + esc(prn) + '</b>' : (shpbPlanOf(r) ? '<span class="muted">no printer</span>' : '<b style="color:#b91c1c">not planned</b>')}`
    + (!shpbMay('print') ? '' : `<div><button type="button" class="ghost" data-shpb-act="print" data-key="${esc(k)}" style="width:auto;padding:0 7px;font-size:10.5px;line-height:18px" title="${shpbIsShp() ? 'The plan of this line: printer, fabric, accessories, dates — planned here, not in PPC' : 'The plan of this line — the same plan PPC raises; the line stays in PPC too'}">${shpbPlanOf(r) ? (prn ? 'Change' : 'Plan') : 'Plan'}</button></div>`) + '</td>'
    + shpbCell(s.prcA, s.prcW, s.prcD, 'prcv', 'Receive', k, tips.prcv)
    + (!r.cutReq ? `<td class="num" style="${SHPB_STAGE_BG};${SHPB_PAD}"><span class="muted" style="font-size:11px">not needed</span></td>` : shpbCell(s.cutA, s.cutW, s.cutD, 'cut', 'Cut', k, tips.cut))
    + shpbCell(s.issA, s.issW, s.issD, 'issue', 'Issue', k, tips.issue)
    + shpbCell(s.recA, s.recW, s.recD, 'receive', 'Receive', k, tips.receive)
    + shpbCell(s.qcA, s.qcW, s.qcD, 'qc', 'QC pass', k, tips.qc)
    + (SHPB_FILLCOL ? shpbFillCell(r, k) : '')
    + (shpbIsQuilt(r) ? `<td class="num" style="${SHPB_STAGE_BG};${SHPB_PAD}"><span class="muted" style="font-size:11px">not needed</span></td>` : shpbCell(s.prsA, s.prsW, s.prsD, 'press', 'Press', k, tips.press))
    + shpbStatusCell(r, k, rd, late, edit) + '</tr>';
}
/** THE LAST COLUMN: the line's status (In production / OOS / Delayed / On hold), the date it will be ready, and the way to complete it from ready stock. */
function shpbStatusCell(r, k, rd, late, edit) {
  const sx = shpbStages([r]), inf = shpbStatusInfo(r, sx), st = inf.auto ? '' : shpbStatusOf(r), stk = shpbStockOf(r), have = SHPB_STK ? Math.floor(((SHPB_STK.get(obUC(r.sku)) || {}).current) || 0) : null;
  const left = Math.max(0, (+r.qty || 0) - stk - sx.prsD);
  const badge = inf.auto ? `<b style="color:#166534" title="Follows the order by itself">${esc(inf.label)}</b>` : (st ? `<b style="color:${st === 'OOS' ? '#b91c1c' : '#b45309'}">${esc(st)}</b>` : '<span class="muted">In production</span>');
  return '<td style="' + SHPB_PAD + 'text-align:left;white-space:nowrap;line-height:1.3">'
    + (edit && !inf.auto ? '<select data-shpb-status="' + esc(k) + '" style="font-size:11px;height:22px;padding:0 3px;width:auto;' + (st === 'OOS' ? 'color:#b91c1c;font-weight:700' : '') + '" title="Where this order stands">'
      + SHPB_STATUS.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === st ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>' : badge)
    + '<div>' + (edit ? '<input type="date" data-shpb-ready="' + esc(k) + '" value="' + esc(rd.date) + '" style="width:118px;padding:0 3px;font-size:11px;height:22px' + (late ? ';color:#b91c1c' : '') + '" title="When production will have this order ready">'
        : '<span style="font-size:11.5px">' + esc(shpbDmy(rd.date) || '—') + '</span>')
      + (rd.how ? ' <span class="muted" style="font-size:10px">' + (rd.how === 'set' ? 'set' + (rd.by ? ' · ' + esc(rd.by) : '') : esc(rd.how)) + '</span>' : '') + '</div>'
    + (stk ? '<div><span class="pill" style="background:#dcfce7;color:#166534" title="Completed from the ready stock in the India store, handed to shipping">' + nf(stk) + ' from stock</span></div>' : '')
    + (edit && left > 0 && have !== 0 && shpbIsShp() && shpbMay('stock') ? '<div><button type="button" class="ghost" data-shpb-act="stock" data-key="' + esc(k) + '" style="width:auto;padding:0 7px;font-size:10.5px;line-height:18px" title="Complete this order from pieces already made and held in the India store">From stock' + (have ? ' (' + nf(have) + ')' : '') + '</button></div>' : '')
    + '</td>';
}

/** What the board shows now. PENDING = lines with pieces not yet pressed; COMPLETE = lines pressed (waiting for shipping, or handed over) and closed ones. */
/* STUCK IN ONE PLACE (Ravi, 13 Nov: "yadi koi order 1 hi jagah 24 hours se jyada pada h aage move nahi hua h wo highlight ho jay";
 * Sundays not counted). The last day anything happened to a pending line — every date its own flow shows: ordered/opened, plan,
 * printer, cloth back, cut, issued, received, QC, filler, press — and if a whole working day (Mon–Sat) has passed since with
 * nothing, the line is stuck: its row goes red with where it waits and for how long, and "Stuck > 24h" shows only those.
 * Days, not hours: the registers keep the day of a step, not its time — so a line moved on Monday is stuck from Wednesday. */
const shpbIsoOf = d => { const m = String(d || '').match(/(\d{2})-(\d{2})-(\d{4})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
function shpbLastMove(r) {
  let best = '';
  try { shpbSteps(r).forEach(x => String(x.when || '').replace(/(\d{2})-(\d{2})-(\d{4})/g, (t, d, mo, y) => { const iso = y + '-' + mo + '-' + d; if (iso > best) best = iso; return t; })); }
  catch (e) { /* a line whose flow cannot be read is never called stuck */ }
  return best;
}
/** Working days (Monday–Saturday) wholly between two ISO days. */
function shpbWorkDaysBetween(a, b) {
  const t0 = Date.parse(a + 'T00:00:00Z'), t1 = Date.parse(b + 'T00:00:00Z');
  if (!(t0 < t1)) return 0;
  let n = 0;
  for (let t = t0 + 864e5; t < t1; t += 864e5) if (new Date(t).getUTCDay() !== 0) n++;
  return n;
}
let SHPB_STUCKC = { sig: null, map: new Map() };
/** { since, days, at } for a pending line stuck a working day or more, else null. */
function shpbStuck(r) {
  const today = shpbToday(), sig = [today, PT.base, PT.cut, (typeof QC !== 'undefined' && QC.checks) || null, SHPB.ready, SHPB.press, (typeof FLOW !== 'undefined' && FLOW && FLOW.ch) || null];
  if (!SHPB_STUCKC.sig || SHPB_STUCKC.sig.some((x, i) => x !== sig[i])) SHPB_STUCKC = { sig, map: new Map() };
  const k = shpbKey(r.orderNo, r.sku);
  if (SHPB_STUCKC.map.has(k)) return SHPB_STUCKC.map.get(k);
  let out = null;
  if (r.open) {
    const last = shpbLastMove(r), days = last ? shpbWorkDaysBetween(last, today) : 0;
    if (days >= 1) out = { since: last, days, at: shpbStatusInfo(r).label };
  }
  SHPB_STUCKC.map.set(k, out);
  return out;
}
function shpbView() {
  const f = ordFilters(), all = ordLines().filter(shpbBelongs), shown = ordApply(all, f);
  const sOf = r => shpbStages([r]);
  const pend = shown.filter(r => r.open && sOf(r).prsD + sOf(r).stk < (+r.qty || 0));
  const done = shown.filter(r => { if (!r.open) return true; return sOf(r).prsD > 0 || sOf(r).stk > 0; });
  const stg = SHPB_STAGES.find(x => x[0] === SHPB.stage);
  let list = SHPB.tab === 'done' ? (stg && stg[0] === 'hand' ? done.filter(r => sOf(r)[stg[3]] > 0) : done) : (stg && stg[0] !== 'hand' ? pend.filter(r => sOf(r)[stg[3]] > 0) : pend);
  if (SHPB.stuck && SHPB.tab !== 'done') list = list.filter(shpbStuck);
  return { f, all, pend, done, list };
}

const shpbStagesShown = () => SHPB_STAGES.filter(x => shpbIsShp() || x[0] !== 'hand');
function renderShpBoard() {
  if (!$('odTable')) return;
  /* AMZ / B2B / SPY have no "Shipping to accept" list. */
  if (!shpbIsShp() && SHPB.stage === 'hand') SHPB.stage = '';
  /* SHIPPING TO ACCEPT ONLY: the one list this account works — pieces pressed and waiting for shipping — without the buckets, the tabs, the view
   * picker or Close lines. */
  if (ME.shpAccOnly) { SHPB.tab = 'done'; SHPB.stage = 'hand'; ['odView', 'odClose', 'odExport'].forEach(id => { const b = $(id); if (b && b.classList) b.classList.add('hide'); }); }
  if (!SHPB.readyAt && !SHPB.busy) shpbLoad(true);
  SHPB_STK = Array.isArray(FGI.rows) ? fgiStock() : null;
  const { f, all, pend, done, list } = shpbView(), tab = SHPB.tab;
  ptFill('odArt', ordApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('odSub', ordApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('odCol', ordApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('odSz', ordApply(all, f, 'sz').map(r => r.size), 'All sizes');
  const tabBtn = (v, t) => `<button type="button" data-shpb-tab="${v}" style="height:36px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
    + (tab === v ? 'background:#15803D;color:#fff;border:1px solid #15803D' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${t}</button>`;
  /* THE BUCKETS: how many orders wait at each stage, and how many pieces. A click shows only those lines; click again for all. */
  const bucket = x => { const src = x[0] === 'hand' ? done : pend, ls = src.filter(r => shpbStages([r])[x[3]] > 0), pcs = ls.reduce((a, r) => a + shpbStages([r])[x[3]], 0), on = SHPB.stage === x[0];
    return `<button type="button" data-shpb-stage="${x[0]}" title="Show only the lines waiting at ${esc(x[1])}" style="padding:6px 12px;border-radius:12px;font:inherit;cursor:pointer;box-shadow:none;transform:none;text-align:left;line-height:1.25;`
      + (on ? 'background:#b45309;color:#fff;border:1px solid #b45309' : 'background:#fdf0e8;color:#17202B;border:1px solid #f0cdb5') + `"><b>${esc(x[1])}</b> <span style="font-weight:700">(${nf(new Set(ls.map(r => r.orderNo)).size)})</span>`
      + `<div style="font-size:10.5px;opacity:.85">orders · ${nf(pcs)} pcs</div></button>`; };
  /* No title and no KPI cards (Ravi, 28 Oct) — the buckets are the summary. */
  /* ONE LINE: the stage buckets, and the two tabs at the right end (Ravi, 28 Oct: no "Waiting at:", no long note, the tabs up with the buckets). */
  $('odKpis').innerHTML = ME.shpAccOnly ? `<div style="margin:2px 0 8px;font-weight:700;font-size:15px">Shipping to accept · ${nf(done.filter(r => r.open && shpbStages([r]).handW > 0).length)} line(s)</div>`
    : `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:2px 0 8px">${shpbStagesShown().map(bucket).join('')}`
    + (() => { const n = pend.filter(shpbStuck).length, on = !!SHPB.stuck;
        return `<button type="button" data-shpb-stuck="1" title="Pending lines with nothing done for a whole working day (Sundays not counted)" style="height:36px;padding:0 14px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
          + (on ? 'background:#b91c1c;color:#fff;border:1px solid #b91c1c' : 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca') + `">Stuck &gt; 24h · ${nf(n)}</button>`; })()
    + `<div style="display:flex;gap:8px;margin-left:auto">${tabBtn('pending', 'Order pending · ' + nf(pend.length))}${tabBtn('done', 'Complete · ' + nf(done.length))}</div></div>`
    + (tab === 'pending' && shpbMay('plan') ? (() => {
      const can = shpbToPlan(pend).length, left = typeof FLOW_XL_IMP !== 'undefined' && FLOW_XL_IMP.length ? flowXlLeft().length : 0;
      const b = 'height:34px;padding:0 14px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;width:auto;';
      return can || left ? `<div style="display:flex;gap:8px;align-items:center;margin:0 0 8px">`
        + (can ? `<button type="button" class="ghost" data-shpb-xlout="1" style="${b}" title="The ${nf(can)} line(s) in To plan, as the PPC sheet — fill Printer and Raise = yes">Excel — To plan (${nf(can)})</button>` : '')
        + `<button type="button" class="ghost" data-shpb-xlin="1" style="${b}" title="Upload the filled sheet — rows marked Raise = yes open in the plan form">Import plan</button><input type="file" accept=".xlsx,.csv" data-shpb-xlfile="1" class="hide">`
        + (left ? `<button type="button" data-shpb-xlnext="1" style="${b}">Open imported (${nf(left)})</button>` : '')
        + `<span class="muted" style="font-size:12px">fill Printer and Raise = yes, then Import plan · the form opens 40 lines at a time</span></div>` : '';
    })() : '');
  $('odMsg').className = SHPB.err ? 'err' : 'muted';
  $('odMsg').textContent = SHPB.err || '';

  if (tab === 'done') return renderShpBoardDone(list);
  if (!list.length) { ptEmpty('odTable', SHPB.stage ? 'No line is waiting at that stage.' : 'No ' + ({ shp: 'Shopify', amz: 'Amazon', b2b: 'B2B', spy: 'SPY' }[shpbKind()]) + ' order is pending.'); return; }
  SHPB_FILLCOL = list.some(shpbIsQuilt);   // the Filler vendor column only when a quilt is on the list
  const rows = ordNewest(list.slice().sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku)));
  const th = (t, c) => `<th class="${c || ''}" style="${SHPB_PAD}${c === 'num' ? SHPB_STAGE_BG : ''}">${t}</th>`;
  const head = '<thead><tr><th class="frz" style="' + SHPB_PAD + 'text-align:left">Date</th><th style="' + SHPB_PAD + 'text-align:left">Order ID</th><th style="' + SHPB_PAD + 'text-align:left">Item</th>'
    + '<th class="num" style="' + SHPB_PAD + '">Pcs</th><th style="' + SHPB_PAD + 'text-align:left">Printer</th>'
    + ['Printer receive', 'Cut', 'Issued', 'Received', 'QC passed'].concat(SHPB_FILLCOL ? ['Filler', 'Qty', 'Rec'] : [], ['Press']).map(h => th(h, 'num')).join('') + '<th style="' + SHPB_PAD + 'text-align:left">Status · ready by</th></tr></thead>';
  $('odTable').innerHTML = head + '<tbody>' + rows.slice(0, 300).map(shpbRow).join('') + '</tbody>'
    + (rows.length > 300 ? '<tfoot><tr><td colspan="' + (SHPB_FILLCOL ? 14 : 11) + '" class="muted" style="padding:10px;text-align:left">Showing the first 300 of ' + nf(rows.length) + ' lines — search or filter to narrow them. Export has all of them.</td></tr></tfoot>' : '');
}

/** COMPLETE: pressed lines waiting for shipping (Accept / Not received), then handed-over lines, newest day first. */
function renderShpBoardDone(list) {
  if (!list.length) { ptEmpty('odTable', SHPB.stage === 'hand' ? 'Nothing is waiting for shipping to accept.' : 'Nothing is pressed or handed over yet.'); return; }
  const waiting = !shpbIsShp() ? [] : list.filter(r => r.open && shpbStages([r]).handW > 0).sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo));
  const rest = list.filter(r => !waiting.includes(r)).map(r => ({ r, at: String(r.handedAt || r.shopDoneAt || (shpbIsShp() ? '' : ((SHPB.pressBy || {})[shpbKey(r.orderNo, r.sku)] || {}).last || r.openIso || '')) })).sort((a, b) => b.at.localeCompare(a.at) || a.r.orderNo.localeCompare(b.r.orderNo)).slice(0, 500);
  const edit = shpbCanEdit() || !!ME.shpAccOnly;
  const th = t => `<th style="${SHPB_PAD}text-align:left">${t}</th>`;
  const head = `<thead><tr>${th('Date')}${th('Order ID')}${th('Item')}<th class="num" style="${SHPB_PAD}">Pcs</th>${th('Pressed')}<th class="num" style="${SHPB_PAD}">Accepted</th>${th('Shipping')}</tr></thead>`;
  const common = r => { const s = shpbStages([r]), px = (SHPB.pressBy || {})[shpbKey(r.orderNo, r.sku)] || {};
    const stk = shpbStockOf(r), pr = px.pcs ? `<b>${nf(Math.min(px.pcs, +r.qty || 0))}</b> <span class="muted" style="font-size:11px">${esc((px.men || []).join(', '))}${px.last ? ' · ' + esc(shpbDmy(px.last)) : ''}</span>` : '';
    return { s, press: pr + (stk ? `<div style="font-size:11px"><b>${nf(stk)}</b> from stock</div>` : '') || '<span class="muted">—</span>' }; };
  const link = r => `<a href="#" data-ordj="${esc(r.orderNo)}" style="color:inherit;text-decoration:underline dotted;font-weight:700">${esc(String(r.shopOrderNo || r.orderNo).replace(/^#\s*/, ''))}</a>`;
  const wRow = r => { const { s, press } = common(r), k = shpbKey(r.orderNo, r.sku), ns = (SHPB.ship || {})[k], pd = ((SHPB.pressBy || {})[k] || {}).last || '';
    return `<tr><td style="${SHPB_PAD}white-space:nowrap;font-size:12px">${esc(shpbDmy(pd || ptIsoDate(r.orderDate)))}</td><td style="${SHPB_PAD}text-align:left">${link(r)}</td>${shpbItem(r)}<td class="num" style="${SHPB_PAD}"><b>${nf(r.qty)}</b></td>`
      + `<td style="${SHPB_PAD}text-align:left;white-space:nowrap">${press}</td><td class="num" style="${SHPB_PAD}">${nf(s.handD)}</td>`
      + `<td style="${SHPB_PAD}text-align:left;white-space:nowrap">${nf(s.handW)} to accept `
      + (ns && ns.state === 'notrecv' ? `<span class="pill pill-out" title="${esc((ns.by || '').split('@')[0] + ' · ' + (ns.note || ''))}">not received${ns.note ? ' · ' + esc(String(ns.note).slice(0, 30)) : ''}</span> ` : '')
      + (edit ? `<button type="button" data-shpb-act="accept" data-key="${esc(k)}" style="width:auto;padding:0 9px;font-size:11px;line-height:20px">Accept</button> <button type="button" class="ghost" data-shpb-act="notrecv" data-key="${esc(k)}" style="width:auto;padding:0 9px;font-size:11px;line-height:20px">Not received</button>` : '') + '</td></tr>'; };
  let prev = '';
  const hRow = ({ r, at }) => { const day = ptIsoDate(at) || '', first = day !== prev, c = common(r); prev = day;
    return (first ? `<tr><td colspan="7" style="${SHPB_PAD}text-align:left;background:#eef2f7;font-weight:700;font-size:12px">${esc(shpbDmy(day) || 'no date')} — ${shpbIsShp() ? 'handed to shipping' : 'complete'}</td></tr>` : '')
      + `<tr><td style="${SHPB_PAD}white-space:nowrap;font-size:12px">${esc(shpbDmy(day))}</td><td style="${SHPB_PAD}text-align:left">${link(r)}</td>${shpbItem(r)}<td class="num" style="${SHPB_PAD}">${nf(r.qty)}</td>`
      + `<td style="${SHPB_PAD}text-align:left">${c.press}</td><td class="num" style="${SHPB_PAD}">${nf(Math.min(+r.qty || 0, r.handedAt ? +r.qty || 0 : c.s.handD))}</td>`
      + `<td style="${SHPB_PAD}text-align:left;font-size:12px">${!shpbIsShp() ? (r.open ? 'Pressed' : 'Complete') : r.handedAt ? 'Handed over' + (r.handedBy ? ' · ' + esc(String(r.handedBy).split('@')[0]) : '') : esc(typeof SHP_DONE_TXT === 'function' ? SHP_DONE_TXT(r.shopDoneWhy) : 'Closed')}</td></tr>`; };
  $('odTable').innerHTML = head + '<tbody>'
    + (waiting.length ? `<tr><td colspan="7" style="${SHPB_PAD}text-align:left;background:#fdf0e8;font-weight:700;font-size:12px">Waiting for shipping to accept — ${nf(waiting.length)} line(s)</td></tr>` + waiting.map(wRow).join('') : '')
    + rest.map(hRow).join('') + '</tbody>';
}

/** Export: every line shown (the bar's filters, the tab, the stage bucket) — one CSV row per order line, which Excel opens. */
function shpbExport() {
  const { list } = shpbView(); if (!list.length) return;
  const head = ['Order date', 'Order ID', 'Order', 'SKU', 'Article', 'Subtype', 'Colour', 'Size', 'Pieces', 'Ready on', 'Ready date from', 'Status', 'Printer',
    'Printer receive: waiting', 'Printer receive: back', 'Cut: waiting', 'Cut: done', 'Issue: waiting', 'Issued: done', 'Receive: waiting', 'Received: done', 'QC: waiting', 'QC passed',
    'Press: waiting', 'Pressed', 'Pressman', 'Filler vendor', 'Filler issued', 'Filler received', 'From stock', 'Shipping to accept', 'Accepted by shipping', 'Handed / closed on', 'Status'];
  const lines = [head.map(csvCell).join(',')];
  list.slice().sort((a, b) => String(a.orderDate).localeCompare(String(b.orderDate)) || a.orderNo.localeCompare(b.orderNo)).forEach(r => {
    const s = shpbStages([r]), rd = shpbReadyOf(r), at = ptIsoDate(r.handedAt || r.shopDoneAt) || '', px = (SHPB.pressBy || {})[shpbKey(r.orderNo, r.sku)] || {};
    lines.push([ptIsoDate(r.orderDate) || '', r.shopOrderNo || '', r.orderNo, r.sku, r.articleType || r.itemName || '', r.articleSubtype || '', r.color || '', r.size || '', r.qty, rd.date, rd.how === 'set' ? 'typed here' : rd.how, shpbStatusInfo(r).label, shpbPrinterOf(r),
      s.prcA ? s.prcW : '', s.prcA ? s.prcD : '', r.cutReq ? s.cutW : 'not needed', r.cutReq ? s.cutD : '', s.issW, s.issD, s.recW, s.recD, s.qcW, s.qcD, shpbIsQuilt(r) ? '' : s.prsW, shpbIsQuilt(r) ? '' : s.prsD, (px.men || []).join(' / '), shpbIsQuilt(r) ? ((shpbFillOf(r) || {}).name || '') : '', shpbIsQuilt(r) ? shpbFillSum(shpbFillOf(r), 'iss') : '', shpbIsQuilt(r) ? shpbFillSum(shpbFillOf(r), 'rec') : '', s.stk || '', s.handW, s.handD, at,
      r.open ? 'Pending' : (r.handedAt ? 'Handed over' : (typeof SHP_DONE_TXT === 'function' ? SHP_DONE_TXT(r.shopDoneWhy) : 'Closed'))].map(csvCell).join(','));
  });
  ptDownload(shpbKind() + '-board-' + (SHPB.tab === 'done' ? 'complete' : (SHPB.stage ? 'waiting-' + SHPB.stage : 'pending')), lines);
}

/* ---- the work, done from the row ------------------------------------------------------------------------------------
 * Cutting and the Job Work issue are written by the same save buttons of their own forms (the form's boxes are filled and its
 * Save pressed), so every check they make — the order's cap, a month frozen, a zipper short, the same issue twice — answers
 * here too. A refusal is the form's own message. */
async function shpbDrive(set, saveId, msgId) {
  Object.entries(set).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
  await $(saveId).onclick();
  const m = $(msgId);
  return m && m.className === 'err' ? (m.textContent || 'Not saved.') : '';
}
/** The fabric this SKU is cut from: the PPC plan's, else the master row's (flowSuggest). */
function shpbOwnFabric(r) { try { return String(((shpbPlanOf(r) || {}).fabric || {}).name || flowSuggest(r).fabric.name || '').trim(); } catch (e) { return ''; } }
/** COMPLETE FROM READY STOCK (Ravi, 29 Oct): pieces already made and held in the India store complete this order. The store gives them up
 *  (an ISSUE row in the Finished Goods ledger, naming the order), the line is told how many came from stock (stockQty — the making stages
 *  then ask for that many fewer) and shipping is handed the pieces (shpReceive, the real hand-over). The ledger row and the note are ONE write. */
async function shpbStockSave(r, v) {
  const pcs = parseInt(v.pcs, 10), key = shpbKey(r.orderNo, r.sku), s = shpbStages([r]);
  if (!(pcs > 0)) return 'Type how many pieces come from stock.';
  if (typeof shpReceive !== 'function' || !shpCanReceive()) return 'Handing pieces to shipping needs the Shopify tab.';
  const need = Math.max(0, (+r.qty || 0) - s.stk - s.prsD);
  if (pcs > need) return `Only ${nf(need)} piece(s) of this line still need to be made.`;
  const short = fgiOutCheck(obUC(r.sku), pcs, 'ISSUE', 0); if (short) return short;
  const now = new Date().toISOString(), d = new Date(), p2 = x => String(x).padStart(2, '0');
  const issue = { _id: fgiNewId('ISS'), txnType: 'ISSUE', sku: obUC(r.sku), qty: pcs, date: p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear(),
    issuedFor: 'Shopify order ' + (r.shopOrderNo || r.orderNo), reason: 'SHP board — completed from ready stock', remarks: String(v.note || '').trim(), shpOrderNo: r.orderNo,
    createdAt: now, createdBy: ME.email };
  const next = Object.assign({}, SHPB.ready[key] || {}, { orderNo: r.orderNo, sku: r.sku, stockQty: s.stk + pcs, by: ME.email, at: now });
  try { await ptPatch({ ['pt_fgiLedger/' + issue._id]: issue, [SHPB_NODE + '/' + key]: next }); } catch (x) { return 'Not saved: ' + (x.message || x); }
  FGI.rows = (FGI.rows || []).concat(issue); SHPB.ready = Object.assign({}, SHPB.ready, { [key]: next });
  /* The pieces have left the store. If the hand-over is refused the line says so and Accept finishes it — this dialog must not be pressed twice. */
  const err = await shpReceive([{ orderNo: r.orderNo, sku: r.sku, qty: pcs }]);
  if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = `${nf(pcs)} piece(s) were issued from the store, but handing them to shipping failed (${err}) — press Accept on the line.`; }
  shpbAfter(); return '';
}
async function shpbCutSave(r, v) {
  const pcs = parseInt(v.pcs, 10);
  if (!(pcs > 0)) return 'Type how many pieces were cut.';
  await ensureCutForm();
  $('cwSku').value = r.sku; $('cwSku').dataset.typed = '1'; renderCutPick(); renderCutForm();
  /* The cloth: the SKU's own fabric, a rejected tablecloth, wastage cloth, or another fabric of the master. */
  const other = Object.keys(CUT_OTHER_CLOTH).find(k => CUT_OTHER_CLOTH[k] === v.fabric) || '';
  if (!v.fabric) return 'Pick the cloth this was cut from.';
  CUT_FROM = other; CUT_OWN_OK = (!other && v.fabric === shpbOwnFabric(r)) ? v.fabric : '';
  try { return await shpbDrive({ cwOrd: r.orderNo, cwPcs: String(pcs), cwFabric: other ? CUT_OTHER_CLOTH[other] : v.fabric, cwDate: v.date || shpbToday() }, 'cwSave', 'cwMsg'); }
  finally { CUT_FROM = ''; CUT_OWN_OK = ''; }
}
/* ISSUE TO AN EMBROIDERY VENDOR (Ravi, 13 Nov: "embroidery piece ke liye job work bhi karwata hu to karigar ke sath sath mene bahar kis
 * vendor ko diye h embroidery ke liye wo bhi mention kar saku jisase order aage move ho" — "bas only embroidery wale orders ke liye").
 * An embroidery line (its article says Embroidery, or its PPC route is 'emb') may be issued to a vendor instead of a karigar. It is
 * the same Job Work register entry, so Receive brings it back and the line moves on exactly as it does for a karigar — only its type
 * is 'Embroidery vendor' (with the vendor's code), which no karigar payout counts (payouts.js reads Company / External Contractor). */
const SHPB_EMB_TYPE = 'Embroidery vendor';
const shpbIsEmb = r => /embroid/i.test([r.articleSubtype, r.articleType, r.itemName].filter(Boolean).join(' '))
  || (typeof flowPlanRouteOf === 'function' && flowPlanRouteOf(r.orderNo, r.sku) === 'emb');
const shpbEmbVendors = () => { let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const f = all.filter(x => /embroid/i.test(String(x.category || ''))); return f.length ? f : all; };
async function shpbIssueVendorSave(r, v) {
  const pcs = parseInt(v.pcs, 10), ven = shpbEmbVendors().find(x => String(x.code) === String(v.ven));
  if (!ven) return 'Pick the embroidery vendor.';
  if (!(pcs > 0)) return 'Type how many pieces are being issued.';
  const s = shpbStages([r]);
  if (pcs > s.issW) return `Only ${nf(s.issW)} piece(s) can be issued now.`;
  if (typeof bdGuard === 'function') { const g = bdGuard(r.orderNo, r.sku, pcs); if (g) return g; }
  const m = (typeof cutSkuOf === 'function' ? cutSkuOf(r.sku) : null) || {};
  const day = v.date || shpbToday(), name = String(ven.desc || ven.name || ven.code);
  const e = { id: 'bd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), empType: SHPB_EMB_TYPE, empName: name, vendorCode: String(ven.code),
    sku: obUC(r.sku), articleType: m.articleType || r.articleType || '', articleSubtype: m.subtype || r.articleSubtype || '', color: m.color || r.color || '',
    size: m.size || r.size || '', orderNo: r.orderNo, issuePieces: pcs, issueDate: typeof ptStampDate === 'function' ? ptStampDate(day) : day,
    receivedPieces: 0, rejectionPieces: 0, receivingDate: '', pendingPieces: pcs, remarks: 'Embroidery — outside vendor', frozen: false,
    addedBy: ME.email, addedAt: new Date().toISOString() };
  try { await ptPut('pt_baseData/' + e.id, e); } catch (x) { return 'Not saved: ' + (x.message || x); }
  PT.base = (PT.base || []).concat(Object.assign({ _key: e.id }, e));
  return '';
}
async function shpbIssueSave(r, v) {
  if (v.to === 'vendor') return shpbIssueVendorSave(r, v);
  const pcs = parseInt(v.pcs, 10), name = String(v.emp || '').trim();
  if (!name) return 'Pick the karigar.';
  if (!(pcs > 0)) return 'Type how many pieces are being issued.';
  const emp = (PTE.emp || []).find(e => String(e[1]).trim().toLowerCase() === name.toLowerCase());
  if (!emp) return `"${name}" is not on the employee list.`;
  await ensureBdForm();
  $('bwSku').value = r.sku; $('bwSku').dataset.typed = '1';
  $('bwType').value = String(emp[0] || '').trim(); renderBdForm(); bdSkuTyped();
  $('bwType').value = String(emp[0] || '').trim();
  $('bwEmp').value = String(emp[1]).trim();
  $('bwOrd').value = r.orderNo; $('bwPcs').value = String(pcs); $('bwDate').value = v.date || shpbToday(); $('bwDate').dataset.auto = '';
  if (typeof bdMatFill === 'function') bdMatFill();
  return shpbDrive({}, 'bwSave', 'bwMsg');
}
/** A press entry: the pressman, the pieces, the day. Never more than passed QC and is not yet pressed. */
async function shpbPressSave(r, v) {
  const man = String(v.man || '').trim(), pcs = parseInt(v.pcs, 10), s = shpbStages([r]);
  if (!SHPB_PRESSMEN.includes(man)) return 'Pick the pressman.';
  if (!(pcs > 0)) return 'Type how many pieces were pressed.';
  if (pcs > s.prsW) return `Only ${nf(s.prsW)} piece(s) have passed QC and are not pressed yet.`;
  const id = 'sbp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), e = { id, orderNo: r.orderNo, sku: r.sku, pieces: pcs, pressman: man, date: v.date || shpbToday(), by: ME.email, at: new Date().toISOString() };
  try { await ptPut(SHPB_PRESS + '/' + id, e); } catch (x) { return 'Not saved: ' + (x.message || x); }
  SHPB.press = Object.assign({}, SHPB.press, { [id]: e }); SHPB.pressBy = shpbIndexPress(SHPB.press);
  return '';
}
const shpbAfter = () => { try { renderOrd(); } catch (e) { /* the next draw shows it */ } };

function shpbDialog(act, key) {
  const r = shpbLineOf(key); if (!r) return;
  if (!shpbMay(act)) { $('odMsg').className = 'err'; $('odMsg').textContent = 'You do not have the right for this step — ask an admin.'; return; }
  const s = shpbStages([r]), who = (r.shopOrderNo || r.orderNo) + ' · ' + r.sku;
  if (act === 'print' || act === 'plan') { if (typeof flowPpcOpen === 'function') flowPpcOpen(r.orderNo, r.sku); return; }
  if (act === 'stock') {
    return (async () => {
      try { if (!Array.isArray(FGI.rows)) FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read the India store: ' + (e.message || e); return; }
      const have = Math.max(0, Math.floor(fgiOf(r.sku).current)), s2 = shpbStages([r]), need = Math.max(0, (+r.qty || 0) - s2.stk - s2.prsD), top = Math.min(have, need);
      if (!(top > 0)) return ptOpenDialog({ title: 'From stock — ' + who, subtitle: have > 0 ? 'Nothing more of this line needs to be made.' : `${r.sku} has no pieces in the India store, so nothing can be completed from stock.` });
      ptOpenDialog({ title: 'Complete from ready stock — ' + who, subtitle: `${nf(have)} piece(s) of ${r.sku} in the India store · this line still needs ${nf(need)}. The store gives the pieces up and shipping is handed them.`,
        fields: [{ key: 'pcs', label: 'Pieces from stock', type: 'number', min: 1, max: top, value: top }, { key: 'note', label: 'Note (optional)', value: '' }],
        saveLabel: 'Complete from stock', onSave: v => shpbStockSave(r, v) });
    })();
  }
  if (act === 'accept') return shpbAcceptOpen(key);
  if (act === 'notrecv') return shpbNotRecvOpen(key);
  if (act === 'prcv') {
    const fl = shpbFlowOf(r);
    if (!fl || !fl.printer || typeof flowDueRecvOpen !== 'function') { $('odMsg').className = 'err'; $('odMsg').textContent = 'This line has no printer in the PPC plan.'; return; }
    return flowDueRecvOpen(fl.printer);   // the printer's open lines, with search — the same dialog as Printed fabric in
  }
  if (act === 'fill') {
    const f = shpbFillOf(r) || {}, iss = shpbFillSum(f, 'iss'), rec = shpbFillSum(f, 'rec'), vs = shpbFillers();
    const hist = ['iss', 'rec'].flatMap(k => Object.values(f[k] || {}).map(x => ({ k, x }))).sort((a, b) => String(a.x.at).localeCompare(String(b.x.at)));
    return ptOpenDialog({ title: 'Filler vendor — ' + who, subtitle: `${nf(+r.qty || 0)} quilt(s) on this line · ${nf(iss)} issued to the filler · ${nf(rec)} received back filled`,
      html: hist.length ? '<div style="font-size:12px;margin:-4px 0 8px">' + hist.map(h => `<div class="muted">${esc(shpbDmy(h.x.date))} · ${h.k === 'iss' ? 'issued' : 'received'} <b>${nf(h.x.qty)}</b> · ${esc(String(h.x.by || '').split('@')[0])}</div>`).join('') + '</div>' : '',
      fields: [{ key: 'ven', label: 'Filler vendor', type: 'select', options: [['', vs.length ? '— pick —' : 'no vendor with category Filling in the vendor master']].concat(vs.map(v => [String(v.code), String(v.desc || v.name || v.code)])), value: f.code || '' },
        { key: 'venTxt', label: 'Not in the list? Type the filler vendor', value: f.code ? '' : (f.name || '') },
        { key: 'iss', label: 'Issue now (pieces)', type: 'number', min: 0, value: '' },
        { key: 'rec', label: 'Received back now (pieces)', type: 'number', min: 0, value: '' },
        { key: 'date', label: 'Date', type: 'date', value: shpbToday() }],
      saveLabel: 'Save', onSave: async v => { const err = await shpbFillSave(r, v); if (!err) shpbAfter(); return err; } });
  }
  if (act === 'press' && shpbIsQuilt(r)) return ptOpenDialog({ title: 'Press — ' + who, subtitle: 'A quilt is not pressed — after QC it goes to the filler vendor (the Filler button).' });
  if (act === 'press') {
    return ptOpenDialog({ title: 'Press — ' + who, subtitle: nf(s.prsW) + ' passed QC and not pressed yet. After this entry the line is in Complete, for shipping to accept.',
      fields: [{ key: 'man', label: 'Pressman', type: 'select', options: [['', '— pick —']].concat(SHPB_PRESSMEN.map(x => [x, x])), value: '' },
        { key: 'pcs', label: 'Pieces pressed', type: 'number', min: 1, value: s.prsW || '' }, { key: 'date', label: 'Press date', type: 'date', value: shpbToday() }],
      saveLabel: 'Save press entry', onSave: async v => { const err = await shpbPressSave(r, v); if (!err) shpbAfter(); return err; } });
  }
  if (act === 'cut') {
    /* THE SKU'S OWN FABRIC comes in by itself — the plan's, else the master row's — and is the default; a rejected tablecloth or wastage cloth is one pick away. */
    const fabs = typeof cutFabrics === 'function' ? cutFabrics() : [];
    const ownIn = shpbOwnFabric(r);
    const opts = (ownIn ? [[ownIn, ownIn + ' — this SKU\'s fabric']] : []).concat(Object.values(CUT_OTHER_CLOTH).map(x => [x, x + ' (not from the SKU\'s fabric)']), fabs.filter(x => String(x).toLowerCase() !== ownIn.toLowerCase()).map(x => [x, x]));
    const def = ownIn;
    return ptOpenDialog({ title: 'Cut — ' + who, subtitle: nf(s.cutW) + ' can be cut now (of ' + nf(r.qty) + '). Saved in Cutting Data, against this order.',
      fields: [{ key: 'pcs', label: 'Pieces cut', type: 'number', min: 1, value: s.cutW || '' },
        { key: 'fabric', label: 'Cloth it is cut from', type: 'select', options: ownIn ? opts : [['', '— pick —']].concat(opts), value: def },
        { key: 'date', label: 'Cutting date', type: 'date', value: shpbToday() }],
      saveLabel: 'Save cutting', onSave: async v => { const err = await shpbCutSave(r, v); if (!err) shpbAfter(); return err; } });
  }
  if (act === 'issue') {
    const emb = shpbIsEmb(r);
    const go = () => ptOpenDialog({ title: (emb ? 'Issue to a karigar or an embroidery vendor — ' : 'Issue to a karigar — ') + who,
      subtitle: nf(s.issW) + ' can be issued now. Saved in the Job Work register, against this order.' + (emb ? ' An embroidery vendor\'s pieces come back with Receive, like a karigar\'s; they are not in any karigar payout.' : ''),
      fields: (emb ? [{ key: 'to', label: 'Issue to', type: 'select', options: [['karigar', 'Karigar'], ['vendor', 'Embroidery vendor (outside)']], value: 'karigar' },
          { key: 'ven', label: 'Embroidery vendor (if vendor)', type: 'select', options: [['', '— pick —']].concat(shpbEmbVendors().map(x => [String(x.code), String(x.desc || x.name || x.code)])), value: '' }] : [])
        .concat([{ key: 'emp', label: emb ? 'Karigar / contractor (if karigar)' : 'Karigar / contractor', list: (PTE.emp || []).map(e => String(e[1]).trim()).filter(Boolean), value: '' },
        { key: 'pcs', label: 'Pieces issued', type: 'number', min: 1, value: s.issW || '' }, { key: 'date', label: 'Issue date', type: 'date', value: shpbToday() }]),
      saveLabel: 'Issue', onSave: async v => { const err = await shpbIssueSave(r, v); if (!err) shpbAfter(); return err; } });
    if (PTE.emp) return go();
    return ptLoadEmp().then(go).catch(e => { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read the employee list: ' + (e.message || e); });
  }
  if (act === 'receive') {
    const open = (PT.base || []).filter(b => b && !b.frozen && obUC(b.orderNo) === r.orderNo && obUC(b.sku) === r.sku && ptNum(b.pendingPieces) > 0);
    return ptOpenDialog({ title: 'Receive back — ' + who, subtitle: open.length ? 'Pick the entry the pieces came back on.' : 'Nothing is out with a karigar on this line.',
      html: open.map(b => `<div style="display:flex;align-items:center;gap:10px;margin:6px 0"><div style="flex:1"><b>${esc(b.empName)}</b> <span class="muted">· ${nf(ptNum(b.issuePieces))} issued ${esc(String(b.issueDate || '').slice(0, 10))} · ${nf(ptNum(b.receivedPieces))} back · <b>${nf(ptNum(b.pendingPieces))} out</b></span></div>`
        + `<button type="button" data-shpb-recv="${esc(b.id)}" style="width:auto">Receive</button></div>`).join('') });
  }
  if (act === 'qc') {
    return Promise.resolve(typeof ensureQc === 'function' ? ensureQc() : null).then(() => {
      const rows = qcInboxRows().filter(x => obUC(x.r.orderNo) === r.orderNo && obUC(x.r.sku) === r.sku);
      ptOpenDialog({ title: 'QC pass — ' + who, subtitle: rows.length ? 'Pieces received and waiting for QC. Type what passes now.' : 'Nothing is waiting for QC on this line.',
        fields: rows.map((x, i) => ({ key: 'q' + i, label: `${x.r.empName || ''} · ${nf(x.wait)} waiting`, type: 'number', min: 0, value: x.wait })),
        saveLabel: 'QC pass',
        onSave: rows.length ? async v => {
          let n = 0;
          for (let i = 0; i < rows.length; i++) { const q = parseInt(v['q' + i], 10) || 0; if (!(q > 0)) continue; const err = await qcInboxAccept(rows[i].r.id, q, ''); if (err) return err; n++; }
          if (!n) return 'Type how many pieces pass.'; shpbAfter(); return '';
        } : undefined });
    });
  }
}
/** Shipping accepts the pressed pieces — the real hand-over (shpReceive), never more than was pressed. A "not received" note is cleared. */
function shpbAcceptOpen(key) {
  const r = shpbLineOf(key), s = r && shpbStages([r]);
  if (!r || typeof shpReceive !== 'function' || !shpCanReceive()) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Accepting needs the Shopify tab.'; return; }
  if (!(s.handW > 0)) return;
  ptOpenDialog({
    title: 'Shipping accepts — ' + (r.shopOrderNo || r.orderNo) + ' · ' + r.sku, subtitle: 'Pressed and not accepted yet: ' + nf(s.handW) + '. Type what shipping has received.',
    fields: [{ key: 'q', label: 'Pieces received', type: 'number', min: 1, value: s.handW }], saveLabel: 'Accept',
    onSave: async v => { const q = Math.min(s.handW, Math.round(+v.q || 0)); if (!(q > 0)) return 'Type how many pieces shipping received.';
      const err = await shpReceive([{ orderNo: r.orderNo, sku: r.sku, qty: q }]);
      if (!err && (SHPB.ship || {})[key]) { try { await ptDelete(SHPB_SHIP + '/' + key); } catch (e) { /* the note stays */ } SHPB.ship = Object.assign({}, SHPB.ship); delete SHPB.ship[key]; }
      if (!err) shpbAfter(); return err; },
  });
}
/** Shipping says the pressed pieces did not arrive: a note on the line, so production sees it. Nothing else changes. */
function shpbNotRecvOpen(key) {
  const r = shpbLineOf(key), s = r && shpbStages([r]); if (!r || !(s.handW > 0)) return;
  ptOpenDialog({
    title: 'Not received — ' + (r.shopOrderNo || r.orderNo) + ' · ' + r.sku, subtitle: nf(s.handW) + ' pressed piece(s) have not reached shipping. The line stays here, marked.',
    fields: [{ key: 'note', label: 'What is wrong (optional)', value: '' }], saveLabel: 'Mark not received',
    onSave: async v => { const e = { state: 'notrecv', orderNo: r.orderNo, sku: r.sku, qty: s.handW, note: String(v.note || '').trim(), by: ME.email, at: new Date().toISOString() };
      try { await ptPut(SHPB_SHIP + '/' + key, e); } catch (x) { return 'Not saved: ' + (x.message || x); }
      SHPB.ship = Object.assign({}, SHPB.ship, { [key]: e }); shpbAfter(); return ''; },
  });
}

/* ---- THE ORDER'S FLOW (Ravi, 28 Oct: "order id par click krne ke bad flow is bucket me aay — abhi jo banaya wo nahi") ----
 * A click on an Order ID here opens THIS, not the Order Console's start-to-finish: for each line of the order the flow strip, and under
 * it every step with what was done, by whom, and when — printer, printed cloth back, cut, issued to which karigar, received, QC, press,
 * shipping — and where the line is waiting now. Read from the same registers the cells read. */
const shpbDay = v => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/) || String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return !m ? '' : (m.length === 2 ? shpbDmy(m[1]) : m[1] + '-' + m[2] + '-' + m[3]); };
function shpbSteps(r) {
  const s = shpbStages([r]), qf = +r.qty || 0, q = qf - s.stk, key = shpbKey(r.orderNo, r.sku), plan = shpbPlanOf(r), fl = shpbFlowOf(r), out = [], rdy = shpbReadyOf(r), stt = shpbStatusOf(r);
  const st = (a, w, d, qq) => (!a && !d) ? 'future' : (w === 0 && d >= (qq == null ? q : qq) ? 'done' : (d > 0 ? 'part' : 'active'));
  const add = (step, state, what, when) => out.push({ step, state, what, when });
  add('Ordered', 'done', nf(qf) + ' pcs' + (stt ? ' · set as ' + stt : '') + (rdy.date ? ' · ready by ' + shpbDmy(rdy.date) : ''), shpbDmy(ptIsoDate(r.orderDate)) + (r.openIso ? ' · opened in production ' + shpbDmy(r.openIso) : ''));
  if (s.stk) add('From stock', 'done', nf(s.stk) + ' of ' + nf(qf) + ' completed from ready stock in the India store, handed to shipping', shpbDay((SHPB.ready[key] || {}).at));
  add('PPC plan', plan ? 'done' : 'na', plan ? 'route ' + (plan.route || '') + (shpbPrinterOf(r) ? ' · printer ' + shpbPrinterOf(r) : '') + (plan.dates && plan.dates.ready ? ' · ready ' + shpbDmy(plan.dates.ready) : '') : 'no plan (an older order)', plan ? shpbDay(plan.at) + (plan.by ? ' · ' + String(plan.by).split('@')[0] : '') : '');
  if (fl) {
    const chs = Object.values((typeof FLOW !== 'undefined' && FLOW && FLOW.ch) || {}).filter(c => c && !c.cancelled && (c.lines || []).some(l => l.key === key));
    add('Printer receive', st(s.prcA, s.prcW, s.prcD), nf(s.prcD) + ' of ' + nf(q) + ' back from the printer' + (chs.length ? ' · ' + chs.map(c => c.no).join(', ') : ' · no challan yet'),
      chs.map(c => { const rc = Object.values(c.receipts || {}).filter(x => x && x.items && x.items[key]); return rc.length ? shpbDay(rc[rc.length - 1].date) : ''; }).filter(Boolean).join(', '));
  }
  if (r.cutReq) {
    const cs = (PT.cut || []).filter(c => c && obUC(c.orderNo) === r.orderNo && obUC(c.sku) === r.sku);
    add('Cut', st(s.cutA, s.cutW, s.cutD), nf(s.cutD) + ' of ' + nf(q) + ' cut' + (cs.length ? ' · ' + cs.map(c => nf(ptNum(c.pieces))).join(' + ') : ''), cs.length ? shpbDay(cs[cs.length - 1].cutDate) : '');
  }
  const bs = (PT.base || []).filter(b => b && obUC(b.orderNo) === r.orderNo && obUC(b.sku) === r.sku);
  add('Issued', st(s.issA, s.issW, s.issD), nf(s.issD) + ' of ' + nf(q) + ' issued' + (bs.length ? ' · ' + bs.map(b => b.empName + ' ' + nf(ptNum(b.issuePieces))).join(', ') : ''), bs.length ? shpbDay(bs[bs.length - 1].issueDate) : '');
  add('Received', st(s.recA, s.recW, s.recD), nf(s.recD) + ' of ' + nf(q) + ' back from karigars' + (bs.some(b => ptNum(b.receivedPieces)) ? ' · ' + bs.filter(b => ptNum(b.receivedPieces)).map(b => b.empName + ' ' + nf(ptNum(b.receivedPieces))).join(', ') : ''),
    bs.filter(b => b.receivingDate).length ? shpbDay(bs.filter(b => b.receivingDate).pop().receivingDate) : '');
  const qcs = ((typeof QC !== 'undefined' && QC.checks) || []).filter(c => c && obUC(c.orderNo) === r.orderNo && qcNorm(c.sku) === r.sku && ptNum(c.ok) > 0);
  add('QC passed', s.qcW ? (s.qcD ? 'part' : (s.qcA ? 'active' : 'future')) : (s.qcA ? 'done' : 'future'), nf(s.qcD) + ' of ' + nf(q) + ' passed' + (qcs.length ? ' · by ' + [...new Set(qcs.map(c => c.checkedBy || String(c.addedBy || '').split('@')[0]))].join(', ') : ''), qcs.length ? shpbDay(qcs[qcs.length - 1].date) : '');
  const px = (SHPB.pressBy || {})[key] || {}, pe = Object.values(SHPB.press || {}).filter(e => e && shpbKey(e.orderNo, e.sku) === key);
  if (shpbIsQuilt(r)) { const fz = shpbFillOf(r) || {}, fi = Object.values(fz.iss || {}), fr = Object.values(fz.rec || {}), lastF = fr.concat(fi).map(x => x.date).sort().pop();
    add('Filling', st(s.prsA, s.prsW, s.prsD), nf(s.prsD) + ' of ' + nf(q) + ' back filled' + (fz.name ? ' · ' + fz.name : '') + ' · ' + nf(shpbFillSum(fz, 'iss')) + ' issued', lastF ? shpbDmy(lastF) : ''); }
  else add('Press', st(s.prsA, s.prsW, s.prsD), nf(s.prsD) + ' of ' + nf(q) + ' pressed' + (pe.length ? ' · ' + pe.map(e => e.pressman + ' ' + nf(e.pieces)).join(', ') : ''), px.last ? shpbDmy(px.last) : '');
  const sp = (typeof spOf === 'function' ? spOf(r.orderNo, r.sku) : null) || {}, ns = (SHPB.ship || {})[key];
  add('Shipping', r.handedAt ? 'done' : st(s.handA, s.handW, s.handD, qf),
    (r.handedAt ? 'handed over' : nf(s.handD) + ' accepted') + (s.handW ? ' · ' + nf(s.handW) + ' waiting to accept' : '') + (ns && ns.state === 'notrecv' ? ' · NOT RECEIVED' + (ns.note ? ' (' + ns.note + ')' : '') : ''),
    shpbDay(r.handedAt || (Array.isArray(sp.handLog) && sp.handLog.length ? sp.handLog[sp.handLog.length - 1].at : '')));
  return out.filter(x => x.state !== 'na');
}
function shpbJourneyOpen(orderNo) {
  const no = obUC(orderNo), lines = ordLines().filter(r => r.orderNo === no);
  if (!lines.length) return;
  const dot = { done: ['#dcfce7', '#166534', '✓'], part: ['#fef3c7', '#92400e', '◐'], active: ['#f59e0b', '#fff', '●'], future: ['#f1f5f9', '#94a3b8', '○'] };
  const html = lines.map(r => {
    const s = shpbStages([r]), steps = shpbSteps(r), now = steps.find(x => x.state === 'active' || x.state === 'part');
    return `<div style="border:1px solid var(--line,#e2e8f0);border-radius:10px;padding:8px 10px;margin:0 0 10px">`
      + `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(r.articleSubtype || r.articleType || r.itemName || '')}</b> <span class="muted">${esc([r.color, r.size].filter(Boolean).join(' • '))} · ${esc(r.sku)} · ${nf(r.qty)} pcs</span></div>`
      + `<div style="font-size:12px;font-weight:700;color:${now ? '#b45309' : '#166534'}">${now ? 'Now at: ' + esc(now.step) : (r.open ? 'Everything done' : 'Complete')}</div></div>`
      + `<div style="margin:6px 0">${shpbFlowSpans(r, s)}</div>`
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">' + steps.map(x => { const d = dot[x.state] || dot.future;
        return `<tr><td style="padding:2px 6px;width:22px"><span style="display:inline-block;min-width:18px;text-align:center;border-radius:9px;background:${d[0]};color:${d[1]}">${d[2]}</span></td>`
          + `<td style="padding:2px 6px;white-space:nowrap;font-weight:700">${esc(x.step)}</td><td style="padding:2px 6px;text-align:left">${esc(x.what)}</td><td style="padding:2px 6px;white-space:nowrap;color:#64748b">${esc(x.when)}</td></tr>`; }).join('') + '</table></div>';
  }).join('');
  ptOpenDialog({ title: 'Order ' + (lines[0].shopOrderNo || no) + ' — flow', subtitle: nf(lines.length) + ' line(s). ✓ done · ◐ partly done · ● waiting here now · ○ not reached yet.', html, wide: true });
}

if (SHPB_ON && $('odView') && $('odView').insertAdjacentHTML) $('odView').insertAdjacentHTML('beforeend', Object.entries(SHPB_KINDS).map(([v, k]) => `<option value="${v}">${k[1]}</option>`).join(''));
if ($('odTable') && $('odTable').addEventListener) {
  $('odTable').addEventListener('click', e => {
    if (typeof ordView !== 'function' || !shpbIsBoard(ordView())) return;
    const oj = e.target.closest && e.target.closest('[data-ordj]'); if (oj) { e.preventDefault(); e.stopPropagation(); shpbJourneyOpen(oj.getAttribute('data-ordj')); }
  }, true);
  $('odTable').addEventListener('click', e => {
    if (typeof ordView !== 'function' || !shpbIsBoard(ordView())) return;
    const a = e.target.closest && e.target.closest('[data-shpb-act]'); if (a) { e.preventDefault(); shpbDialog(a.dataset.shpbAct, a.dataset.key); }
  });
  $('odTable').addEventListener('change', async e => {
    if (typeof ordView !== 'function' || !shpbIsBoard(ordView())) return;
    const sel = e.target.closest && e.target.closest('[data-shpb-status]');
    if (sel) { const err = await shpbSetReady(sel.dataset.shpbStatus, { status: sel.value }); if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; } else renderShpBoard(); return; }
    const i = e.target.closest && e.target.closest('[data-shpb-ready]'); if (!i) return;
    const err = await shpbSetReady(i.dataset.shpbReady, { date: i.value });
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; } else renderShpBoard();
  });
}
if ($('ptDlgBody') && $('ptDlgBody').addEventListener) $('ptDlgBody').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-shpb-recv]'); if (b) { const id = b.dataset.shpbRecv; ptDlgClose(); jwRecvOpen(id); }
});
if ($('odKpis') && $('odKpis').addEventListener) $('odKpis').addEventListener('change', e => {
  const f = e.target.closest && e.target.closest('[data-shpb-xlfile]'); if (!f) return;
  const file = f.files && f.files[0]; f.value = '';
  if (file && typeof flowPpcXlIn === 'function') flowPpcXlIn(file, 'odMsg');
});
if ($('odKpis') && $('odKpis').addEventListener) $('odKpis').addEventListener('click', e => {
  if (!shpbIsBoard(ordView())) return;
  const t = e.target.closest && e.target.closest('[data-shpb-tab]'); if (t) { SHPB.tab = t.dataset.shpbTab; SHPB.stage = ''; renderShpBoard(); return; }
  if (e.target.closest && e.target.closest('[data-shpb-xlout]')) {
    const keys = new Set(shpbToPlan(shpbView().pend).map(shpbPickKey));
    try { flowPpcXlOut(flowRows().filter(x => keys.has(x.s.key)), shpbKind() + '-board-plan'); } catch (x) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not make the sheet: ' + (x.message || x); }
    return;
  }
  if (e.target.closest && e.target.closest('[data-shpb-xlin]')) { const f = document.querySelector('[data-shpb-xlfile]'); if (f) f.click(); return; }
  if (e.target.closest && e.target.closest('[data-shpb-xlnext]')) { flowXlOpenNext(); return; }
  if (e.target.closest && e.target.closest('[data-shpb-stuck]')) { SHPB.stuck = !SHPB.stuck; if (SHPB.stuck) SHPB.tab = 'pending'; renderShpBoard(); return; }
  const g = e.target.closest && e.target.closest('[data-shpb-stage]');
  if (g) { SHPB.stage = SHPB.stage === g.dataset.shpbStage ? '' : g.dataset.shpbStage; SHPB.tab = SHPB.stage === 'hand' ? 'done' : 'pending'; renderShpBoard(); }
});
