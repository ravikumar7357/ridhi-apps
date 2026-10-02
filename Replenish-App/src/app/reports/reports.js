/* ================= REPORTS =================
 *
 * Five readings of data that already exists. Nothing here writes anything.
 *
 * TWO WAYS TO COUNT A PIECE, and every production report shows both. PRODUCTION-FACING is pieces off
 * the press. CUSTOMER-FACING divides by the pack size, because a pack of four sold once is one thing
 * a customer received and four things the floor made. Reporting only one of them makes either the
 * factory or the customer look wrong.
 *
 * A WEEK RUNS SUNDAY TO SATURDAY, and belongs to the month its SUNDAY falls in — so a week starting
 * 29 June stays wholly in June even though most of it is July. Splitting it would put half a week's
 * work in each month and make both look short.
 *
 * LEGACY ROWS ARE NOT PRODUCTION. A row marked `legacy` is opening stock carried in on the day the
 * system started; counting it as that week's output would invent a week nobody worked.
 */
let REP = { view: 'wpr', busy: false, at: '' };

async function ensureRep() {
  /* PT.base as well as the press: the week-on-week report is built on receipts now, and opening the
   * tab straight onto it would otherwise show an empty report rather than a loading one. */
  if (!PTG.mdb || !PTG.press || !PT.base) { REP.busy = true; renderRep(); await ptLoadGates(); REP.busy = false; REP.at = ptStamp(); }
  if (FGI.rows === null && $('repView').value === 'fgval') { try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { FGI.rows = []; } }
  if (REP_HEADS === null) { try { REP_HEADS = (await ptGet('pt_contractorHeads')) || {}; } catch (e) { REP_HEADS = {}; } }
  renderRep();
  /* The cut pieces that came from printers are vendor deliveries: read after the report is on screen. */
  if (VO.rows === null && ($('repView') || {}).value === 'wow') { try { await ensureVo(); renderRep(); } catch (e) { /* the tile says it is not read */ } }
}

const repPack = sku => { const m = mdbOf(sku);
  const n = parseInt(String((m && m.packOf) || '').replace(/[^0-9]/g, ''), 10); return n > 0 ? n : 1; };
const repAt = (sku, fallback) => { const m = mdbOf(sku);
  return (m && String(m.articleType || '').trim()) || String(fallback || '').trim() || '(unknown)'; };
const repBrand = sku => { const m = mdbOf(sku);
  return m ? String(m.brand || '').trim() : ''; };
const repBrands = () => [...new Set((PTG.mdb || []).map(r => String((r && r.brand) || '').trim()).filter(Boolean))].sort();

/* PILLOW INSERT IS TRACKED APART (Ravi, 2026-09-29: "pillow insert ko alag se track krna h is production report me add
 * nahi krna h"). It is filling, not stitching: the production report and its capacity figures leave it out, and it has a
 * line of its own. */
const repIsInsert = r => /pillow insert/i.test(repAt(r && r.sku, r && r.articleType));
/* An external contractor's pieces come back under one name for a whole team; their people are counted apart, from the
 * headcount Ravi gives at the end of the week (pt_contractorHeads/<week>/<name>). */
const REP_CONTRACTOR_RE = /pradeep/i;
let REP_HEADS = null;
const REP_DAYS = 6;
const repHeadKey = n => String(n || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '').replace(/\s+/g, '_');
/** One week of work, pillow insert apart: in-house karigars and what each brought back, and each contractor. */
function repManpower(week, brand) {
  /* The week read in local time: "2026-09-20" on its own parses as UTC midnight, five and a half hours off. */
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), to = new Date(wp[0], wp[1] - 1, wp[2] + 7).getTime();
  const kar = new Map(), con = new Map();
  let insert = 0;
  (PT.base || []).forEach(r => {
    if (!r) return;
    const pcs = ptNum(r.receivedPieces);
    if (!(pcs > 0)) return;
    if (brand && repBrand(r.sku) !== brand) return;
    /* What came back THIS week, receipt by receipt (2026-10-02). */
    const inWeek = repRecvParts(r).filter(x => x.ms && x.ms >= from && x.ms < to).reduce((a, x) => a + x.pcs, 0);
    if (!(inWeek > 0)) return;
    if (repIsInsert(r)) { insert += inWeek; return; }
    const who = String(r.empName || '').trim() || '(no name)';
    const m = REP_CONTRACTOR_RE.test(who) ? con : kar;
    m.set(who, (m.get(who) || 0) + inWeek);
  });
  const inPcs = [...kar.values()].reduce((a, b) => a + b, 0);
  const heads = (REP_HEADS || {})[week] || {};
  /* The contractor's number is the WEEK'S ATTENDANCE — each day's people added up (20 a day for 6 days = 120). Over the
   * working days it is the people a day; his pieces over that is what one person made in the week, and over the
   * attendance, in a day. The working days are 6 (Monday to Saturday) unless typed for the week. */
  const days = Number(heads._days) || REP_DAYS;
  const avg = kar.size ? inPcs / kar.size : 0;
  return { week, insert, days, people: kar.size, inPcs, avg, avgDay: avg / days,
    karigars: [...kar.entries()].sort((a, b) => b[1] - a[1]),
    contractors: [...con.entries()].map(([name, pcs]) => {
      const h = Number(heads[repHeadKey(name)]) || 0;
      return { name, pcs, heads: h, perDayPeople: h ? h / days : null, per: h ? pcs * days / h : null, perDay: h ? pcs / h : null };
    }) };
}

/* WHERE THE GAP IS (Ravi, 2026-09-29): "meri kami kaha h — cutting kam ho rhi h ya karigar". A karigar can make
 * REP_PER_DAY pieces a day (50 unless typed); the week's in-house karigars could have made karigars × that × working
 * days. What they did not make is split two ways:
 *   NO WORK   — karigar-days on which a karigar who worked this week had nothing in hand and was given nothing
 *               (from the issue date until the row closed), × the pieces a day;
 *   SPEED     — the rest: they had work and made less than the day's figure.
 * The supply beside it — what they held at the start, what they were given, what was cut — says whether the
 * cutting and issuing kept up. Pillow insert and the outside contractor are left out, as in the rest of the card. */
const REP_PER_DAY = 50;
/* WHAT IS CUT IN-HOUSE (Ravi, 2026-09-29: "cutting me jo article nahi aate h wo ye h — tablecloth, in ko chhodkar ruffle
 * tablecloth, piping scallop tablecloth; border napkin; table runner"). Those come already cut from the printer; everything
 * else goes through our cutting first. */
function repNeedsCutting(r) {
  const m = typeof mdbOf === 'function' ? mdbOf(r && r.sku) : null;
  const at = String((m && m.articleType) || (r && r.articleType) || ''), st = String((m && m.subtype) || (r && r.articleSubtype) || '');
  const t = at + ' ' + st;
  if (/table\s*runner/i.test(t)) return false;
  if (/border\s*napkin/i.test(t)) return false;
  if (/tablecloth/i.test(t)) return /ruffle|piping|scallop/i.test(st);
  return true;
}
const repPerDay = () => Number(((REP_HEADS || {})._settings || {}).perday) || REP_PER_DAY;   // saved under repHeadKey('perDay')
function repGap(week, brand) {
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), DAY = 864e5, to = from + 7 * DAY;
  const heads = (REP_HEADS || {})[week] || {}, nDays = Number(heads._days) || REP_DAYS, T = repPerDay();
  const mine = r => r && !repIsInsert(r) && !REP_CONTRACTOR_RE.test(String(r.empName || '')) && (!brand || repBrand(r.sku) === brand);
  const rows = (PT.base || []).filter(mine);
  const byWho = new Map(), made = new Map();
  let issued = 0, held = 0, issuedCut = 0;
  rows.forEach(r => {
    const k = String(r.empName || '').trim() || '(no name)';
    (byWho.get(k) || byWho.set(k, []).get(k)).push(r);
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (rm && rm >= from && rm < to && ptNum(r.receivedPieces) > 0) made.set(k, (made.get(k) || 0) + ptNum(r.receivedPieces));
    if (im && im >= from && im < to) { issued += ptNum(r.issuePieces); if (repNeedsCutting(r)) issuedCut += ptNum(r.issuePieces); }
    if (im && im < from && (!rm || rm >= from)) held += ptNum(r.issuePieces);         // still out when the week began
  });
  /* The working days: Monday to Saturday of this week, as many as the week's working days, and none still to come. */
  const days = [];
  for (let i = 0; i < 7 && days.length < nDays; i++) { const d = new Date(wp[0], wp[1] - 1, wp[2] + i); if (d.getDay() !== 0 && d.getTime() <= Date.now()) days.push(d.getTime()); }
  const K = made.size, madeTot = [...made.values()].reduce((a, b) => a + b, 0);
  const empty = [], dayCounts = days.map(() => 0);
  made.forEach((_, k) => {
    const rs = byWho.get(k) || [];
    let n = 0;
    days.forEach((d, i) => {
      const busy = rs.some(r => { const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0; return im && im < d + DAY && (!rm || rm >= d); });
      if (busy) dayCounts[i]++; else n++;
    });
    if (n) empty.push({ name: k, days: n, made: made.get(k) || 0 });
  });
  const emptyDays = empty.reduce((a, e) => a + e.days, 0);
  let cut = 0;
  (PT.cut || []).forEach(r => { const ms = r && ptDtMs(r.cutDate); if (ms && ms >= from && ms < to && !repIsInsert(r) && repNeedsCutting(r) && (!brand || repBrand(r.sku) === brand)) cut += ptNum(r.pieces); });
  const possible = K * T * days.length, short = Math.max(0, possible - madeTot);
  const noWork = Math.min(short, emptyDays * T), speed = Math.max(0, short - noWork);
  /* MANPOWER A DAY: on each working day, the karigars who had work in hand — 48 one day, 50 the next, 49 on average. */
  const personDays = dayCounts.reduce((a, b) => a + b, 0);
  return { week, perDay: T, days: days.length, karigars: K, made: madeTot, possible, short, noWork, speed,
    dayCounts, dayMs: days, personDays, perDayPeople: days.length ? personDays / days.length : 0, perPersonDay: personDays ? madeTot / personDays : 0,
    emptyDays, karigarDays: K * days.length, held, issued, issuedCut, issuedReady: issued - issuedCut, cut, available: held + issued,
    empty: empty.sort((a, b) => b.days - a.days || a.made - b.made) };
}

/** A SKU the factory makes itself, as the tool defines it. An unknown SKU counts in. */
function repInhouse(sku) {
  const m = mdbOf(sku);
  if (!m) return true;
  const at = String(m.articleType || '').trim().toLowerCase();
  return m.cuttingRequired !== false || m.isCustom === true || at === 'tablecloth' || at === 'table runner';
}

/* ---- weekly production, and its in-house twin ---- */
function repWeekly(yr, mo, brand, inhouseOnly) {
  const byWeek = {};
  (PTG.press || []).forEach(r => {
    if (!r || !r.entryDate || r.legacy === true) return;
    const ms = ptDtMs(r.entryDate); if (!ms) return;
    if (brand && repBrand(r.sku) !== brand) return;
    if (inhouseOnly && !repInhouse(r.sku)) return;
    if (repIsInsert(r)) return;                                // tracked apart (2026-09-29)
    const d = new Date(ms);
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());       // the Sunday this week starts on
    if (ws.getFullYear() !== yr || ws.getMonth() + 1 !== mo) return;
    const wk = ws.getFullYear() + '-' + String(ws.getMonth() + 1).padStart(2, '0') + '-' + String(ws.getDate()).padStart(2, '0');
    const at = repAt(r.sku, r.articleType);
    byWeek[wk] = byWeek[wk] || {};
    byWeek[wk][at] = byWeek[wk][at] || { cust: 0, prod: 0 };
    const pcs = parseInt(r.pieces, 10) || 0;
    byWeek[wk][at].prod += pcs;
    byWeek[wk][at].cust += pcs / repPack(r.sku);
  });
  const weeks = Object.keys(byWeek).sort();
  const arts = [...new Set(weeks.flatMap(w => Object.keys(byWeek[w])))].sort((a, b) => a.localeCompare(b));
  return { weeks, byWeek, arts };
}

const repWeekLabel = iso => { const p = iso.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2]);
  return String(d.getDate()).padStart(2, '0') + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };

