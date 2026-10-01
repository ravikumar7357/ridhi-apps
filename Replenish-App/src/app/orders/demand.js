/* ================= DEMAND: PRINTING AND CLOTH, OFF THE OPEN ORDER BOOK ================= */

/**
 * The two nodes this view adds, read once and only when somebody opens it.
 *
 * Neither is required. The read rules are granted by tab, so an account holding the Order Console and
 * not the Fabric or Vendor Orders tab is REFUSED them — that is not an error to show, it is two
 * columns that cannot be filled, and the table says which and why.
 */
let ORD_DEM = { tried: false, busy: false, fabOk: false, voOk: false };
async function ordDemandLoad() {
  if (ORD_DEM.tried || ORD_DEM.busy) return;
  ORD_DEM.busy = true;
  /* Side by side: one refusal must not stop the other from arriving. */
  await Promise.all([
    (async () => { try { await ensureFab(); ORD_DEM.fabOk = !FAB.err; } catch (e) { ORD_DEM.fabOk = false; } })(),
    (async () => { try { await ensureVo(); ORD_DEM.voOk = !VO.err; } catch (e) { ORD_DEM.voOk = false; } })(),
  ]);
  ORD_DEM.tried = true; ORD_DEM.busy = false;
  /* Only if the reader is still here. Coming back to a screen somebody has left would redraw the
   * Order Console underneath whatever they opened instead. */
  if (ordView() === 'demand') renderOrd();
}

/** RFD metres on the shelf, fabric name (upper case) → metres. Empty when the ledger was not read. */
function ordDemandRfd() {
  if (!ORD_DEM.fabOk || !Array.isArray(FAB.rows)) return null;
  const out = new Map();
  fabFlowRows(FAB.rows).forEach(g => out.set(obUC(g.fabricType), g.rfdLeft));
  return out;
}

/**
 * PRINTED ON RUNNING CLOTH, OR HANDED OVER AS CUT PIECES.
 *
 * Ravi, 2026-09-24: "jo cut pcs like jisme cutting required nahi h wo direct cut pcs me printing ke
 * liye jate h, unki sheeting running me printing nahi hoti h, to usko direct pcs me track karenge."
 *
 * A tablecloth goes to the printer already cut: the printer is handed pieces, not metres of sheeting.
 * Counting it as running cloth told the printing plan a number of metres nobody will ever send. So
 * printing demand now has two units — running cloth in metres, cut pieces in pieces.
 *
 * WHICH ONE A SKU IS. The printing rule's "Given to the printer as" decides wherever one is set: it is
 * the answer somebody chose for that article and subtype. Where no rule says, a SKU marked "Cutting
 * required: no" goes as cut pieces — Ravi's rule — and everything else is running cloth.
 *
 * THE CLOTH IS STILL CLOTH. Cut pieces are cut from RFD, so the metres they take stay in the RFD
 * requirement and in Short by; only the PRINTING figures change unit.
 */
function ordPrintAsPcs(m) {
  const r = ptPrintIssueAs(m);
  if (r === 'cut') return true;
  if (r === 'running') return false;
  return !!m && m.cuttingRequired === false;
}

/**
 * What the printers are holding, per fabric, in both units.
 *
 * { runM, cutPcs, cutM, pcs, m } — running cloth out in metres; cut pieces still owed and the cloth
 * they are; and the old totals (every piece owed on a SKU line, every metre out) that the RFD figures
 * are worked from.
 *
 * THE CLOTH IS COUNTED AS ALREADY GONE. Whether the line left as running cloth or as cut pieces, it
 * came off RFD stock when it left — so it is subtracted from what still has to be given out, and the
 * shelf figure beside it does not hold it either.
 */
function ordDemandAtPrinters() {
  if (!ORD_DEM.voOk || !Array.isArray(VO.rows)) return null;
  const out = new Map();
  const get = f => { const k = obUC(f); let e = out.get(k); if (!e) out.set(k, e = { runM: 0, cutPcs: 0, cutM: 0, pcs: 0, m: 0 }); return e; };
  VO.rows.forEach(o => {
    if (!o || o.cancelled || o.status === 'Cancelled' || o.status === 'Draft') return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled) return;
      const owed = voQty(o, l) - (parseFloat(voDone(l)) || 0);
      if (!(owed > 0)) return;
      if (voKind(l) === 'running' || o.orderType === 'running') {
        const fab = String(l.fabricType || '').trim();
        if (fab) { const e = get(fab); e.runM += owed; e.m += owed; }
        return;
      }
      const m = mdbOf(l.sku);
      if (!m) return;
      const fab = ptPrintFabric(m) || String(m.fabric || '').trim();
      if (!fab) return;
      const e = get(fab);
      const cons = parseFloat(m.consumption) || 0;
      e.pcs += owed;
      if (cons > 0) e.m += owed * cons;
      if (ordPrintAsPcs(m)) { e.cutPcs += owed; if (cons > 0) e.cutM += owed * cons; }
      else if (cons > 0) e.runM += owed * cons;
    });
  });
  return out;
}

/**
 * The open book as printing demand, one row per fabric.
 *
 * Counted on pendingMake — the same "still to make" the Order Console shows — so this view and that
 * table can never disagree about how much work is left.
 *
 * need / atM / give / have / short are the CLOTH figures (both kinds, in metres) that the RFD shelf is
 * measured against. runNeed / runGive are running cloth to print, in metres; cutPcs / cutGive are cut
 * pieces to print, in pieces.
 */
function ordDemandRows() {
  const f = ordFilters();
  const byFab = new Map();
  let pcs = 0, noPrintPcs = 0, unknownPcs = 0, cutNoConsPcs = 0;
  const noPrint = new Map(), unknown = new Map();
  ordApply(ordLines(), f).forEach(l => {
    const left = Math.max(0, ptNum(l.pendingMake));
    if (!left) return;
    const m = mdbOf(l.sku) || {};
    /* NOT EVERY OPEN PIECE IS A PRINTING JOB. A pillow insert is filling and a white napkin is never
     * printed; counting them makes the requirement bigger than the work. */
    if (!ptPrintNeeded(m)) {
      noPrintPcs += left;
      const why = !ptColourPrints(m.color) ? 'colour "' + (m.color || '—') + '" is never printed'
        : (m.subtype || m.articleType || 'this article') + ' is never printed';
      const e = noPrint.get(why) || { why, pcs: 0 };
      e.pcs += left; noPrint.set(why, e);
      return;
    }
    pcs += left;
    const fab = ptPrintFabric(m) || '';
    const cons = parseFloat(m.consumption) || 0;
    const asPcs = ordPrintAsPcs(m);
    /* A CUT PIECE NEEDS NO CONSUMPTION TO BE COUNTED — it is printed as a piece. Only its cloth goes
     * uncounted, and that is said. A running SKU with no consumption cannot be turned into metres. */
    if (!fab || (!asPcs && !(cons > 0))) {
      unknownPcs += left;
      const why = !fab ? 'no fabric on the master row' : 'no consumption on the master row';
      const k = obUC(l.sku) + '|' + why;
      const e = unknown.get(k) || { sku: obUC(l.sku), why, pcs: 0 };
      e.pcs += left; unknown.set(k, e);
      return;
    }
    const k = obUC(fab);
    let g = byFab.get(k);
    if (!g) byFab.set(k, g = { fabric: fab, pcs: 0, need: 0, runPcs: 0, runNeed: 0, cutPcs: 0, cutNeedM: 0, skus: new Set() });
    g.pcs += left; g.skus.add(obUC(l.sku));
    if (asPcs) {
      g.cutPcs += left;
      if (cons > 0) { g.cutNeedM += left * cons; g.need += left * cons; } else cutNoConsPcs += left;
    } else { g.runPcs += left; g.runNeed += left * cons; g.need += left * cons; }
  });

  const rfd = ordDemandRfd(), at = ordDemandAtPrinters();
  /* A fabric with nothing outstanding but work at a printer still belongs on the table — a fabric
   * missing from the list reads as nothing running rather than nothing ordered. */
  if (at) at.forEach((v, k) => { if (!byFab.has(k) && (v.pcs > 0 || v.m > 0))
    byFab.set(k, { fabric: k, pcs: 0, need: 0, runPcs: 0, runNeed: 0, cutPcs: 0, cutNeedM: 0, skus: new Set() }); });

  const rows = [...byFab.entries()].map(([k, g]) => {
    const a = at ? (at.get(k) || { runM: 0, cutPcs: 0, cutM: 0, pcs: 0, m: 0 }) : null;
    const give = a ? Math.max(0, g.need - a.m) : g.need;
    const have = rfd ? (rfd.get(k) || 0) : null;
    return Object.assign(g, {
      key: k, skus: g.skus.size,
      atPcs: a ? a.pcs : null, atM: a ? a.m : null,
      runAtM: a ? a.runM : null, runGive: a ? Math.max(0, g.runNeed - a.runM) : g.runNeed,
      cutAtPcs: a ? a.cutPcs : null, cutGive: a ? Math.max(0, g.cutPcs - a.cutPcs) : g.cutPcs,
      give, have, short: have == null ? null : Math.max(0, give - have),
    });
  }).sort((a, b) => (b.short || 0) - (a.short || 0) || b.need - a.need || b.cutPcs - a.cutPcs);

  return { rows, pcs, noPrintPcs, unknownPcs, cutNoConsPcs,
    noPrint: [...noPrint.values()].sort((a, b) => b.pcs - a.pcs),
    unknown: [...unknown.values()].sort((a, b) => b.pcs - a.pcs) };
}

const ordDemM = v => v == null ? '<span class="muted">—</span>' : nf(Math.round(v));
/* A figure, or a dash where there is nothing — a column of zeros reads as a column of problems. */
const ordDemN = (v, unit) => v == null || !Math.round(v) ? '<span class="muted">—</span>' : nf(Math.round(v)) + (unit || '');

/**
 * What the printers are holding, per fabric AND colour — and, for SKU lines, per product too.
 * { col: Map("FABRIC|COLOUR" → {runM, cutPcs, pcs}), prod: Map("FABRIC|COLOUR|SUBTYPE|SIZE" → pcs) }.
 */
function ordDemandAtPrintersCol() {
  if (!ORD_DEM.voOk || !Array.isArray(VO.rows)) return null;
  const col = new Map(), prod = new Map();
  const get = k => { let e = col.get(k); if (!e) col.set(k, e = { runM: 0, cutPcs: 0, pcs: 0, who: new Map(), codes: new Set() }); return e; };
  VO.rows.forEach(o => {
    if (!o || o.cancelled || o.status === 'Cancelled' || o.status === 'Draft') return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled) return;
      const owed = voQty(o, l) - (parseFloat(voDone(l)) || 0);
      if (!(owed > 0)) return;
      if (voKind(l) === 'running' || o.orderType === 'running') {
        const fab = String(l.fabricType || '').trim();
        if (fab) {
          const nm = o.vendorName || voName(o.vendorCode) || o.vendorCode || '';
          const dn = /^h/i.test(String(l.printDirection || '')) ? 'Horizontal' : (/^v/i.test(String(l.printDirection || '')) ? 'Vertical' : '');
          /* Under the colour, and under the colour AND direction for the quilt rows that are split that way. */
          [obUC(fab) + '|' + obUC(l.color)].concat(dn ? [obUC(fab) + '|' + obUC(l.color) + '|' + dn] : []).forEach(k => {
            const e = get(k);
            e.runM += owed;
            if (nm) e.who.set(nm, (e.who.get(nm) || 0) + owed);
            if (o.vendorCode) e.codes.add(obUC(o.vendorCode));
          });
        }
        return;
      }
      const m = mdbOf(l.sku);
      if (!m) return;
      const fab = ptPrintFabric(m) || String(m.fabric || '').trim();
      if (!fab) return;
      const ck = obUC(fab) + '|' + obUC(m.color);
      const e = get(ck);
      e.pcs += owed;
      const cons = parseFloat(m.consumption) || 0;
      if (ordPrintAsPcs(m)) e.cutPcs += owed; else if (cons > 0) e.runM += owed * cons;
      const pk = ck + '|' + obUC(m.subtype || m.articleType) + '|' + obUC(m.size);
      prod.set(pk, (prod.get(pk) || 0) + owed);
    });
  });
  return { col, prod };
}

/**
 * The open book as printing demand, fabric → colour → product and size.
 *
 * The same lines and the same rules as the fabric view, so the two add up to the same totals. A
 * colour row carries its running cloth in metres and its cut pieces in pieces; a product row is one or
 * the other, and says which.
 */
/** What a line needs printed, in one place: its fabric · colour, its product, running metres or cut pieces. */
function ordDemLine(l) {
  const left = Math.max(0, ptNum(l.pendingMake));
  if (!left) return null;
  const m = mdbOf(l.sku) || {};
  if (!ptPrintNeeded(m)) return { left, noPrint: true };
  const fab = ptPrintFabric(m) || '';
  const cons = parseFloat(m.consumption) || 0;
  const asPcs = ordPrintAsPcs(m);
  if (!fab || (!asPcs && !(cons > 0))) return { left, unknown: true };
  const colour = String(m.color || l.color || '').trim();
  const ck = obUC(fab) + '|' + obUC(colour);
  const what = String(m.subtype || m.articleType || l.articleSubtype || '').trim(), size = String(m.size || l.size || '').trim();
  return { left, m, fab, colour, ck, pk: ck + '|' + obUC(what) + '|' + obUC(size), what, size, asPcs, cons,
    runM: asPcs ? 0 : left * cons, key: l.orderNo + '|' + l.sku };
}

/**
 * WHAT THE PRINTERS HOLD, SHARED OUT — oldest order first — over every open line, so a narrowed view (a week, a
 * brand, a search) counts only its own lines' share. Running metres go to a colour's running lines; cut pieces
 * to that product's cut lines. Map lineKey → { m, pcs }.
 */
function ordDemAlloc(at) {
  const out = new Map();
  if (!at) return out;
  const byCol = new Map(), byProd = new Map();
  ordLines().forEach(l => {
    const x = ordDemLine(l);
    if (!x || x.noPrint || x.unknown) return;
    const row = { key: x.key, date: String(l.orderDate || ''), no: l.orderNo, x };
    if (x.asPcs) { if (!byProd.has(x.pk)) byProd.set(x.pk, []); byProd.get(x.pk).push(row); }
    else { if (!byCol.has(x.ck)) byCol.set(x.ck, []); byCol.get(x.ck).push(row); }
  });
  const oldest = (a, b) => a.date.localeCompare(b.date) || String(a.no).localeCompare(String(b.no));
  const put = (k, f, v) => { const e = out.get(k) || { m: 0, pcs: 0 }; e[f] += v; out.set(k, e); };
  byCol.forEach((rows, ck) => {
    let left = (at.col.get(ck) || {}).runM || 0;
    rows.sort(oldest).forEach(r => { const t = Math.min(left, r.x.runM); if (t > 0) { put(r.key, 'm', t); left -= t; } });
  });
  byProd.forEach((rows, pk) => {
    let left = at.prod.get(pk) || 0;
    rows.sort(oldest).forEach(r => { const t = Math.min(left, r.x.left); if (t > 0) { put(r.key, 'pcs', t); left -= t; } });
  });
  return out;
}
/** Is anything narrowing the book? Then "with printers" is the lines' share, not the printers' whole stock. */
const ordDemNarrowed = f => ['ord', 'art', 'sub', 'col', 'sz', 'st', 'src', 'brand', 'q', 'd1', 'd2'].some(k => String((f || {})[k] || '').trim());

function ordDemandColRows() {
  const f = ordFilters();
  const narrowed = ordDemNarrowed(f);
  const groups = new Map();
  let pcs = 0, noPrintPcs = 0, unknownPcs = 0;
  ordApply(ordLines(), f).forEach(l => {
    const left = Math.max(0, ptNum(l.pendingMake));
    if (!left) return;
    const m = mdbOf(l.sku) || {};
    if (!ptPrintNeeded(m)) { noPrintPcs += left; return; }
    pcs += left;
    const fab = ptPrintFabric(m) || '';
    const cons = parseFloat(m.consumption) || 0;
    const asPcs = ordPrintAsPcs(m);
    if (!fab || (!asPcs && !(cons > 0))) { unknownPcs += left; return; }
    const colour = String(m.color || l.color || '').trim();
    const ck = obUC(fab) + '|' + obUC(colour);
    /* A quilt colour splits by the way it is printed: 60x90 and 90x96 on Voil 92 are two different running orders. */
    const dir = asPcs ? '' : ptPrintDir(m, fab);
    const gk = ck + (dir ? '|' + dir : '');
    let g = groups.get(gk);
    if (!g) groups.set(gk, g = { key: gk, colKey: ck, dir, fabric: fab, colour, pcs: 0, need: 0, cutPcs: 0, skus: new Set(), products: new Map(), lineOf: new Map(), keys: [], codes: new Map() });
    /* THE COLOUR CODE the ordered SKU carries (RQL351-Q → 351): one colour name can be two codes, and each is its own
     * printed cloth with its own fabric SKU. */
    if (!asPcs) {
      const cc = ordColCodeOf(l.sku), e = g.codes.get(cc) || { code: cc, pcs: 0, need: 0, products: new Map() };
      e.pcs += left; e.need += left * cons;
      const pw = [String(m.subtype || m.articleType || '').trim(), String(m.size || l.size || '').trim()].filter(Boolean).join(' ');
      e.products.set(pw, (e.products.get(pw) || 0) + left);
      g.codes.set(cc, e);
    }
    g.keys.push({ key: l.orderNo + '|' + l.sku, pk: ck + '|' + obUC(String(m.subtype || m.articleType || l.articleSubtype || '').trim()) + '|' + obUC(String(m.size || l.size || '').trim()) });
    /* The lines behind the colour, so a printer can be given all of them from the totals view. */
    g.lineOf.set(l.orderNo + '|' + l.sku, String(l.printer || ''));
    const what = String(m.subtype || m.articleType || l.articleSubtype || '').trim(), size = String(m.size || l.size || '').trim();
    const pk = ck + '|' + obUC(what) + '|' + obUC(size);
    let p = g.products.get(pk);
    if (!p) g.products.set(pk, p = { key: pk, what, size, asPcs, pcs: 0, need: 0, skus: new Set(), perMin: Infinity, perMax: 0, rufFab: '', rufM: 0 });
    p.pcs += left; p.skus.add(obUC(l.sku));
    if (asPcs) g.cutPcs += left;
    else { p.need += left * cons; g.need += left * cons; p.perMin = Math.min(p.perMin, cons); p.perMax = Math.max(p.perMax, cons); }
    /* The ruffle strip: shown beside the product, never added to the printing total. */
    const ruf = ptIsRuffle(m) ? ptRuffleOf(m) : null;
    if (ruf) { p.rufFab = p.rufFab || ruf.fabric; p.rufM += left * ruf.meters; }
    g.pcs += left; g.skus.add(obUC(l.sku));
  });

  const at = ordDemandAtPrintersCol();
  /* NARROWED: each shown line carries only its share of what the printers hold (ordDemAlloc). */
  const share = narrowed && at ? ordDemAlloc(at) : null;
  const cols = [...groups.values()].map(g => {
    let a = at ? (at.col.get(g.key) || { runM: 0, cutPcs: 0, pcs: 0 }) : null;
    let prodAt = null;
    if (share) {
      let m = 0, p = 0; prodAt = new Map();
      g.keys.forEach(k => { const e = share.get(k.key); if (!e) return; m += e.m; p += e.pcs; prodAt.set(k.pk, (prodAt.get(k.pk) || 0) + e.pcs); });
      a = { runM: m, cutPcs: p, pcs: p, who: a && a.who, codes: a && a.codes };
    }
    const products = [...g.products.values()].map(p => {
      const atP = at ? (prodAt ? (prodAt.get(p.key) || 0) : (at.prod.get(p.key) || 0)) : null;
      return Object.assign(p, { skus: p.skus.size, atPcs: atP,
        cutGive: p.asPcs ? (atP == null ? p.pcs : Math.max(0, p.pcs - atP)) : null });
    }).sort((x, y) => (y.need - x.need) || (y.pcs - x.pcs));
    const printers = new Map(), open = [];
    g.lineOf.forEach((pr, k) => { if (pr) printers.set(pr, (printers.get(pr) || 0) + 1); else open.push(k); });
    return Object.assign(g, { skus: g.skus.size, products, lines: g.lineOf.size, openKeys: open, printers, runWho: a && a.who ? a.who : null, runCodes: a && a.codes ? a.codes : null, narrowed,
      atPcs: a ? a.pcs : null, atM: a ? a.runM : null, cutAtPcs: a ? a.cutPcs : null,
      give: a ? Math.max(0, g.need - a.runM) : g.need,
      cutGive: a ? Math.max(0, g.cutPcs - a.cutPcs) : g.cutPcs,
      rufM: products.reduce((t, p) => t + p.rufM, 0) });
  }).sort((x, y) => (y.need - x.need) || (y.cutPcs - x.cutPcs));

  return { cols, pcs, noPrintPcs, unknownPcs, narrowed };
}

/* Metres to two places where it matters: a piece takes 1.85 m, not "2". */
const ordDemPer = p => !isFinite(p.perMin) ? '<span class="muted">—</span>'
  : (Math.abs(p.perMax - p.perMin) < 0.005 ? nf(Math.round(p.perMin * 100) / 100) + ' m'
    : nf(Math.round(p.perMin * 100) / 100) + '–' + nf(Math.round(p.perMax * 100) / 100) + ' m');

/* Drawn rows, at most — the same ceiling as every other register. The cards still count everything. */
const ORD_DEMCOL_MAX = 600;

/* "252 m · 40 pcs", "40 pcs", "252 m" or a dash — a colour holds either kind, or both. */
const ordDemBoth = (m, p) => {
  const a = [];
  if (m != null && Math.round(m)) a.push(nf(Math.round(m)) + ' m');
  if (p != null && Math.round(p)) a.push(nf(Math.round(p)) + ' pcs');
  return a.length ? a.join(' · ') : '<span class="muted">—</span>';
};
const ordDemAs = asPcs => asPcs
  ? '<span class="jw-st pend">Cut pieces</span>' : '<span class="jw-st prog">Running</span>';

function renderOrdDemandCol() {
  ordDemandLoad();
  if ($('odPickBar')) { $('odPickBar').classList.add('hide'); $('odPickBar').innerHTML = ''; }
  const d = ordDemandColRows();
  const flat = [];
  d.cols.forEach(g => { flat.push(Object.assign({ kind: 'col' }, g));
    g.products.forEach(p => flat.push(Object.assign({ kind: 'prod', fabric: g.fabric, colour: g.colour, dir: g.dir || '' }, p))); });
  ORD.rows = flat;
  const s = k => d.cols.reduce((a, r) => a + (r[k] || 0), 0);
  const anyAt = d.cols.some(r => r.atM != null);

  $('odKpis').innerHTML = '<div class="jw-kpiname">Demand — by colour &amp; product</div><div class="jw-kpis">'
    + ordKpiCard(nf(d.pcs), 'To make', 'box', 'blue', 'pieces the book still owes')
    + ordKpiCard(nf(Math.round(s('need'))) + ' m', 'Running cloth', 'cut', 'blue', 'printed on sheeting, in metres')
    + ordKpiCard(nf(s('cutPcs')) + ' pcs', 'Cut pieces', 'list', 'amber', 'printed as pieces')
    + ordKpiCard(anyAt ? ordDemBoth(s('atM'), s('cutAtPcs')) : '—', 'At printers', 'clock',
        anyAt ? 'amber' : 'blue', anyAt ? 'still owed back' : 'vendor orders not read')
    + ordKpiCard(ordDemBoth(s('give'), s('cutGive')), 'Still to give', 'up', 'blue', 'needed − already out')
    + ordKpiCard(nf(Math.round(s('rufM'))) + ' m', 'Ruffle cloth', 'doc', 'green', 'from RFD, not printed')
    + '</div>';

  const head = ordHead([['Fabric · colour', ''], ['Product · size', ''], ['Printed as', ''], ['SKUs', 'num'], ['To make', 'num'],
    ['A piece', 'num'], ['Running cloth', 'num'], ['At printers', 'num'], ['Still to give', 'num'], ['Ruffle cloth', '']]);
  const dash = '<span class="muted">—</span>';
  const drawn = flat.slice(0, ORD_DEMCOL_MAX);
  $('odTable').innerHTML = head + '<tbody>' + (drawn.length ? drawn.map(r => r.kind === 'col'
    ? '<tr style="background:var(--soft)">'
      + '<td class="frz" style="text-align:left;background:var(--soft)"><b>' + esc(r.fabric) + '</b> · <b>' + (esc(r.colour) || '<span class="muted">no colour</span>') + '</b>' + (r.dir ? ' · <b style="color:#7C3AED">' + esc(r.dir) + '</b>' : '') + '</td>'
      + '<td style="text-align:left" class="muted">' + nf(r.products.length) + ' product(s)</td>'
      + '<td style="text-align:left">' + (r.need && r.cutPcs ? ordDemAs(false) + ' ' + ordDemAs(true) : ordDemAs(!r.need && !!r.cutPcs)) + '</td>'
      + '<td class="num">' + nf(r.skus) + '</td>'
      + '<td class="num" style="font-weight:700">' + nf(r.pcs) + '</td>'
      + '<td class="num">' + dash + '</td>'
      + '<td class="num" style="font-weight:800">' + ordDemN(r.need, ' m') + '</td>'
      + '<td class="num">' + (r.atM == null ? dash : ordDemBoth(r.atM, r.cutAtPcs)) + '</td>'
      + '<td class="num" style="font-weight:800">' + ordDemBoth(r.give, r.cutGive) + '</td>'
      + '<td style="text-align:left">' + (r.rufM ? nf(Math.round(r.rufM)) + ' m' : dash) + '</td></tr>'
    : '<tr>'
      + '<td class="frz"></td>'
      + '<td style="text-align:left">' + esc(r.what || '—') + (r.size ? ' · ' + esc(r.size) : '') + '</td>'
      + '<td style="text-align:left">' + ordDemAs(r.asPcs) + '</td>'
      + '<td class="num muted">' + nf(r.skus) + '</td>'
      + '<td class="num">' + nf(r.pcs) + '</td>'
      + '<td class="num muted">' + (r.asPcs ? dash : ordDemPer(r)) + '</td>'
      + '<td class="num" style="font-weight:700">' + (r.asPcs ? dash : nf(Math.round(r.need)) + ' m') + '</td>'
      + '<td class="num">' + (r.atPcs == null ? dash : ordDemN(r.atPcs, ' pcs')) + '</td>'
      + '<td class="num"' + (r.asPcs ? ' style="font-weight:700"' : '') + '>' + (r.asPcs ? ordDemN(r.cutGive, ' pcs') : dash) + '</td>'
      + '<td style="text-align:left">' + (r.rufM ? esc(r.rufFab) + ' · ' + nf(Math.round(r.rufM)) + ' m' : dash) + '</td></tr>').join('')
    : '<tr><td colspan="10" class="muted" style="padding:16px">Nothing on the open book needs printing.</td></tr>')
    + '</tbody>';

  const say = [];
  if (ORD_DEM.busy) say.push('reading the vendor orders…');
  if (flat.length > drawn.length) say.push(nf(drawn.length) + ' of ' + nf(flat.length) + ' rows shown — narrow it with the filters');
  if (d.unknownPcs) say.push(nf(d.unknownPcs) + ' piece(s) have no fabric or consumption and are not counted');
  if (d.noPrintPcs) say.push(nf(d.noPrintPcs) + ' never-printed piece(s) left out');
  $('odMsg').className = 'muted';
  $('odMsg').textContent = nf(d.cols.length) + ' fabric · colour(s) · ' + nf(d.pcs) + ' piece(s) to make'
    + (say.length ? ' · ' + say.join(' · ') : '');
}

/**
 * One line per fabric · colour: how much cloth it needs, how much is already with the printers, and how
 * much is still to give. The same rows as "by colour & product" (ordDemandColRows), with the products
 * folded away — so the two views can never disagree, and the same filters narrow both.
 */
/** The orders being built on the totals view, one per printer, each with its Place order. */
function demBasketBar() {
  const bar = $('odPickBar'); if (!bar) return;
  const B = ORD.demBasket || {};
  const codes = Object.keys(B).filter(c => (B[c] || []).length);
  bar.classList.toggle('hide', !codes.length);
  bar.innerHTML = codes.map(c => {
    const ls = B[c], m = ls.reduce((t, x) => t + x.m, 0);
    return '<span style="display:inline-flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;border-radius:12px;background:var(--brand-bg)">'
      + '<b>' + esc(voName(c)) + '</b><span class="muted" style="font-size:12.5px">' + nf(ls.length) + ' line(s) · ' + nf(m) + ' m</span>'
      + '<button class="jw-btn jw-primary" data-demplace="' + esc(c) + '">Place order</button>'
      + '<button class="jw-btn" data-demclr="' + esc(c) + '" aria-label="Empty this order">Clear</button></span>';
  }).join(' ');
  if (bar.querySelectorAll) bar.querySelectorAll('[data-demplace]').forEach(b => { b.onclick = () => demBasketPlace(b.getAttribute('data-demplace')); });
  if (bar.querySelectorAll) bar.querySelectorAll('[data-demclr]').forEach(b => { b.onclick = () => { delete ORD.demBasket[b.getAttribute('data-demclr')]; renderOrd(); }; });
}

