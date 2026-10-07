/* ================= LAST WEEK, AND HOW IT COMPARES =================
 *
 * Ravi, 2026-09-07: "mera last week kya production h article wise and WoW % changes bhi".
 *
 * The Weekly production report already answers "what did each week of THIS MONTH do". This answers a
 * different question — "what did last week do, and is that up or down" — and it deliberately does
 * not respect month ends, because a week-on-week comparison that stops at the 1st of the month is
 * comparing against nothing every fourth or fifth week.
 *
 * Same source and same rules as the weekly report: pieces off the press, opening balances left out,
 * customer-facing divided by the pack size. So a figure here and a figure there cannot disagree.
 */

const REP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The Sunday a date's week begins on. */
function repWeekStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; }
const repWkIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const repWkShift = (iso, weeks) => { const p = iso.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]); d.setDate(d.getDate() + weeks * 7); return repWkIso(d); };
/** "30 Aug – 5 Sep", which is what somebody means by "last week". */
function repWkRange(iso) {
  const p = iso.split('-').map(Number);
  const a = new Date(p[0], p[1] - 1, p[2]);
  const b = new Date(a); b.setDate(a.getDate() + 6);
  return a.getDate() + ' ' + REP_MON[a.getMonth()] + ' – ' + b.getDate() + ' ' + REP_MON[b.getMonth()];
}
/** The last week that has FINISHED. The one we are in is still being worked. */
function repLastFullWeek() { return repWkShift(repWkIso(repWeekStart(Date.now())), -1); }

/**
 * What came BACK, bucketed by the Sunday of the week it arrived. No month filter — a week-on-week
 * comparison that stops at the 1st has nothing to compare against every fourth or fifth week.
 *
 * Base Data, not press inventory. Received and rejected are separate columns there — pendingPieces
 * is issued − received − rejected — so receivedPieces is already the good pieces, and nothing has to
 * be subtracted from it.
 *
 * Dated by receivingDate. That date is stamped when a row COMPLETES, so a part-received row has none
 * yet and cannot be put in any week; those are counted and reported rather than dropped in silence.
 */
/**
 * WHEN THE PIECES OF ONE ROW CAME BACK: [{ ms, pcs }] (2026-10-02). Each receipt in receipts[] is counted on its own date;
 * whatever part of receivedPieces no receipt accounts for (rows received before receipts were kept) is dated by
 * receivingDate as before — ms 0 when that is not there yet (part-received, undated). If a correction lowered
 * receivedPieces below what the receipts add up to, the latest receipts are trimmed to fit.
 */
function repRecvParts(r) {
  const got = ptNum(r && r.receivedPieces);
  if (!(got > 0)) return [];
  const list = (Array.isArray(r.receipts) ? r.receipts : Object.values(r.receipts || {}))
    .map(x => ({ ms: x && x.at ? ptDtMs(x.at) : 0, pcs: ptNum(x && x.qty) })).filter(x => x.ms && x.pcs > 0)
    .sort((a, b) => a.ms - b.ms);
  const out = [];
  let left = got;
  for (const x of list) { if (left <= 0) break; const p = Math.min(x.pcs, left); out.push({ ms: x.ms, pcs: p }); left -= p; }
  if (left > 0) out.push({ ms: r.receivingDate ? ptDtMs(r.receivingDate) : 0, pcs: left });
  return out;
}

function repByWeek(brand, inhouseOnly) {
  const byWeek = {};
  let undated = 0;
  (PT.base || []).forEach(r => {
    if (!r) return;
    const pcs = ptNum(r.receivedPieces);
    if (pcs <= 0) return;                                     // issued, not back yet
    if (brand && repBrand(r.sku) !== brand) return;
    if (inhouseOnly && !repInhouse(r.sku)) return;
    if (repIsInsert(r)) return;                                // tracked apart (2026-09-29)
    const at = repAt(r.sku, r.articleType);
    repRecvParts(r).forEach(({ ms, pcs: p }) => {             // each receipt in its own week (2026-10-02)
      if (!ms) { undated += p; return; }
      const wk = repWkIso(repWeekStart(ms));
      byWeek[wk] = byWeek[wk] || {};
      byWeek[wk][at] = byWeek[wk][at] || { cust: 0, prod: 0 };
      byWeek[wk][at].prod += p;
      byWeek[wk][at].cust += p / repPack(r.sku);
    });
  });
  REP_UNDATED = undated;
  return byWeek;
}
/** Pieces that came back but carry no date yet, so no week can hold them. */
let REP_UNDATED = 0;
/** The Job Work rows behind REP_UNDATED: part-received (some pieces back, some still pending), so the receiving date —
 * stamped when a row is FULLY received — is not there yet. Pillow insert is apart, as in the report. */
function repUndatedRows(brand) {
  return (PT.base || []).filter(r => r && repRecvParts(r).some(x => !x.ms)
    && !repIsInsert(r) && (!brand || repBrand(r.sku) === brand));
}
function repUndatedCsv() {
  const brand = $('repBrand') ? $('repBrand').value : '';
  const head = ['Issue date', 'Karigar', 'SKU', 'Article', 'Order', 'Issued', 'Received', 'Rejected', 'Pending', 'Row id'];
  const out = [head].concat(repUndatedRows(brand).map(r => [r.issueDate || '', r.empName || '', r.sku || '', repAt(r.sku, r.articleType),
    (r.orders && r.orders.join ? r.orders.join(' ') : r.orderNo) || '', ptNum(r.issuePieces), ptNum(r.receivedPieces),
    ptNum(r.rejectionPieces), ptNum(r.pendingPieces), r.id || '']));
  ptDownload('part-received-no-date', out.map(r => r.map(csvCell).join(',')));
}

/**
 * What came back inside a window [from, to), per article type. Same rule as repByWeek — received
 * pieces from Base Data, dated by receivingDate — but over any span, which is what a PART week needs
 * and a week bucket cannot express.
 *
 * The suite asserts this equals repByWeek's bucket when the window is a whole week. Two functions
 * that answer the same question have to be pinned together or they drift, and the drift shows up as
 * a report that quietly disagrees with the one beside it.
 */
function repByWindow(brand, inhouseOnly, from, to) {
  const out = {};
  (PT.base || []).forEach(r => {
    if (!r) return;
    const pcs = ptNum(r.receivedPieces);
    if (pcs <= 0) return;
    if (brand && repBrand(r.sku) !== brand) return;
    if (inhouseOnly && !repInhouse(r.sku)) return;
    if (repIsInsert(r)) return;                                // tracked apart (2026-09-29)
    const at = repAt(r.sku, r.articleType);
    repRecvParts(r).forEach(({ ms, pcs: p }) => {             // each receipt on its own date (2026-10-02)
      if (!ms || ms < from || ms >= to) return;
      out[at] = out[at] || { cust: 0, prod: 0 };
      out[at].prod += p;
      out[at].cust += p / repPack(r.sku);
    });
  });
  return out;
}

/**
 * WHAT QC PASSED inside a window [from, to), per article type — beside what came back, so the week reads "made, and of
 * that, really good" (Ravi, 2026-10-07: "isi data me Q.C pass data la dete h … production report to Q.C pass pcs par hi
 * hoga"). A check counts on the day it was recorded. Pillow insert and embroidery napkin are kept apart, as in the QC
 * report (qaApart).
 */
const repQcRows = () => ((QC && QC.checks && QC.checks.length) ? QC.checks : ((PTG.qc && PTG.qc.length) ? PTG.qc : (REP.qc || [])));
function repQcByWindow(brand, from, to) {
  const out = { byArt: {}, ok: 0, chk: 0, rej: 0, alt: 0, apart: { 'Pillow insert': 0, 'Embroidery napkin': 0 } };
  repQcRows().forEach(r => {
    if (!r) return;
    const ms = ptDtMs(r.date);
    if (!ms || ms < from || ms >= to) return;
    if (brand && repBrand(r.sku) !== brand) return;
    const ap = qaApart(r);
    if (ap) { out.apart[ap] += ptNum(r.ok); return; }
    const at = repAt(r.sku, r.articleType);
    out.byArt[at] = (out.byArt[at] || 0) + ptNum(r.ok);
    out.ok += ptNum(r.ok); out.chk += ptNum(r.checked); out.rej += ptNum(r.rejected); out.alt += ptNum(r.forAlteration);
  });
  return out;
}

/** Midnight on the Sunday the running week began. */
const repLiveStart = () => repWeekStart(Date.now()).getTime();
/** How far into it we are, in whole days — Sunday is day 1. */
const repDaysIn = () => Math.floor((Date.now() - repLiveStart()) / 86400000) + 1;

/**
 * The running week against the SAME STRETCH of the week before — Sunday to now, and Sunday to the
 * same moment seven days ago. Comparing three days against a finished seven-day week is the one
 * mistake this view exists to avoid; it would have read −63.7% today when the honest figure is −27.5%.
 */
function repLive(brand, inhouseOnly) {
  const start = repLiveStart();
  const elapsed = Date.now() - start;
  const prevStart = start - 7 * 86400000;
  const cur = repByWindow(brand, inhouseOnly, start, Date.now());
  const prev = repByWindow(brand, inhouseOnly, prevStart, prevStart + elapsed);
  const qc = repQcByWindow(brand, start, Date.now()), qcPrev = repQcByWindow(brand, prevStart, prevStart + elapsed);
  const arts = [...new Set(Object.keys(cur).concat(Object.keys(prev), Object.keys(qc.byArt), Object.keys(qcPrev.byArt)))]
    .filter(a => (cur[a] && cur[a].prod) || (prev[a] && prev[a].prod) || qc.byArt[a] || qcPrev.byArt[a]);
  const rows = arts.map(a => {
    const c = cur[a] || { cust: 0, prod: 0 }, p = prev[a] || { cust: 0, prod: 0 };
    const delta = c.prod - p.prod;
    return { art: a, cust: c.cust, prod: c.prod, prevProd: p.prod, prevCust: p.cust, delta,
      pct: p.prod > 0 ? (delta / p.prod) * 100 : null, qc: qc.byArt[a] || 0, prevQc: qcPrev.byArt[a] || 0 };
  }).sort((x, y) => y.prod - x.prod || y.qc - x.qc || x.art.localeCompare(y.art));
  /* The whole of last week, for context only — never as the thing the percentage is against. */
  const fullPrev = repByWindow(brand, inhouseOnly, prevStart, start);
  const fullPrevProd = Object.values(fullPrev).reduce((s, d) => s + d.prod, 0);
  return { start, prevStart, days: repDaysIn(), rows, fullPrevProd, qc, qcPrev };
}

/**
 * The change between two weeks, per article.
 *
 * A PERCENTAGE NEEDS SOMETHING TO BE A PERCENTAGE OF. Where last week made something and the week
 * before made nothing, there is no percentage — it is "new", and printing ∞% or 100% would both be
 * inventions. That case is common here: one article type appearing for the first time.
 */
const REP_WOW_SPAN = 4;          // how many weeks are shown across

function repWow(week, brand, inhouseOnly, span) {
  const n = span || REP_WOW_SPAN;
  const byWeek = repByWeek(brand, inhouseOnly);
  /* Oldest first, so the row reads left to right the way a trend is spoken. */
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) weeks.push(repWkShift(week, -i));
  const prevWeek = repWkShift(week, -1);
  const cur = byWeek[week] || {}, prev = byWeek[prevWeek] || {};

  /* An article is listed if it appears in ANY of the weeks on screen — one that stopped three weeks
   * ago still belongs on a four-week view, and a row that vanishes is the one nobody notices. */
  const arts = [...new Set(weeks.flatMap(w => Object.keys(byWeek[w] || {})))]
    .filter(a => weeks.some(w => (byWeek[w] || {})[a] && (byWeek[w] || {})[a].prod));
  const rows = arts.map(a => {
    const c = cur[a] || { cust: 0, prod: 0 }, p = prev[a] || { cust: 0, prod: 0 };
    const delta = c.prod - p.prod;
    return { art: a, cust: c.cust, prod: c.prod, prevProd: p.prod, prevCust: p.cust, delta,
      pct: p.prod > 0 ? (delta / p.prod) * 100 : null,
      hist: weeks.map(w => ((byWeek[w] || {})[a] || { prod: 0 }).prod) };
  }).sort((x, y) => y.prod - x.prod || x.art.localeCompare(y.art));
  return { week, prevWeek, weeks, rows, byWeek };
}

