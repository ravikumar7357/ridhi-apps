/* ================= FABRIC FROM THE PRINTERS, IN SQUARE METRES =================
 *
 * Ravi, 17 Sep: "printing fabric in (square meter) requirement nikalni h … printer requ. according
 * open order jo (to make) kitna fabric mujhe printers se chahiye, and mere pas current capacity kitni
 * h base of vendor history, and mujhe history ke according production type weekly report bhi chahiye
 * ki kis printer ki capacity kitni aa rhi h, all vendor ka kitna h."
 *
 * THREE FIGURES, ONE PANEL:
 *   1. What the open order book still owes, turned into cloth: pieces still to make × the running
 *      metres one piece takes × the fabric's width. Same arithmetic the vendor orders already use
 *      (voSqm), so a printer's order and this demand can never disagree about what a piece costs.
 *   2. What the printers actually deliver, from the delivery log — not what they promise, and not a
 *      capacity somebody typed in. Cut lines are converted the same way; a running line is already
 *      metres and only needs its width.
 *   3. Both together: how many weeks of printing the open book represents at the rate the printers
 *      have really been running.
 *
 * WHAT IT REFUSES TO GUESS. A SKU with no consumption figure, or a fabric whose name does not end in
 * a width ("Sheeting 58" → 58 inches), cannot be turned into cloth at all. Those pieces are counted
 * and NAMED instead of being quietly left out of the total — a fabric order short by the lines
 * nobody could price is worse than no figure.
 */

/** Monday-based ISO week key for a day, so history lines up with the rest of the analysis. */
/* THE PRODUCTION WEEK (Ravi, 2026-09-28: "week days ko production ki tarah karo"): Sunday to Saturday, as the Reports
 * screen reads it and labels it — "20 Sep – 26 Sep". */
function pafWeekOf(ms) {
  if (!ms) return '';
  return repWkIso(repWeekStart(ms));
}

/**
 * Cloth the open order book still needs from the printers.
 *
 * Counted on `pendingMake` — the Order Console's own "still to make" — so this panel and that screen
 * answer to one number. A line already with a printer is still counted: the cloth has not arrived
 * until it arrives.
 */
function pafNeed() {
  const byFab = new Map();
  let sqm = 0, pieces = 0, unknownPcs = 0, noPrintPcs = 0;
  const unknown = new Map(), noPrint = new Map(), unruled = new Map();
  ordLines().forEach(l => {
    const left = Math.max(0, ptNum(l.pendingMake));
    if (!left) return;
    const m = mdbOf(l.sku) || {};

    /* NOT EVERY OPEN PIECE IS A PRINTING JOB. A pillow insert is filling and a white napkin is
     * never printed; counting them made the printer requirement bigger than the work. */
    if (!ptPrintNeeded(m)) {
      noPrintPcs += left;
      const why = !ptColourPrints(m.color) ? `colour "${m.color || '—'}" is never printed`
        : `${m.subtype || m.articleType || 'this article'} is never printed`;
      const k = (m.subtype || m.articleType || '—') + ' · ' + why;
      const e = noPrint.get(k) || { what: m.subtype || m.articleType || '—', why, pcs: 0 };
      e.pcs += left; noPrint.set(k, e);
      return;
    }
    pieces += left;
    /* A subtype nobody has ruled on is still counted — and named, so the gap is visible. */
    if (!ptPrintRuleOf(m)) {
      const k = ptPrintKey(m.articleType, m.subtype);
      const e = unruled.get(k) || { articleType: m.articleType || '—', subtype: m.subtype || '—', pcs: 0 };
      e.pcs += left; unruled.set(k, e);
    }

    const fab = ptPrintFabric(m) || '—';
    const cons = parseFloat(m.consumption) || 0;
    const w = voFabWidthM(fab);
    /* A tablecloth or runner by its own size, as the delivery log reads it (Ravi, 2026-09-29) — capacity is
     * measured on the same footing, so the weeks in hand compare like with like. */
    const area = voSizeSqm(m);
    if (!area && (!cons || !w)) {
      unknownPcs += left;
      const why = !cons ? 'no consumption on the master row' : `fabric "${fab || '—'}" has no width in its name`;
      const e = unknown.get(obUC(l.sku)) || { sku: obUC(l.sku), pcs: 0, why };
      e.pcs += left;
      unknown.set(obUC(l.sku), e);
      return;
    }
    const s = area ? left * area : left * cons * w;
    sqm += s;
    const e = byFab.get(fab) || { fabric: fab, sqm: 0, pcs: 0 };
    e.sqm += s; e.pcs += left;
    byFab.set(fab, e);
  });
  return {
    sqm, pieces, unknownPcs, noPrintPcs,
    byFab: [...byFab.values()].sort((a, b) => b.sqm - a.sqm),
    unknown: [...unknown.values()].sort((a, b) => b.pcs - a.pcs),
    noPrint: [...noPrint.values()].sort((a, b) => b.pcs - a.pcs),
    unruled: [...unruled.values()].sort((a, b) => b.pcs - a.pcs),
  };
}

/**
 * What each printer has actually delivered, week by week, in square metres.
 *
 * Read from the delivery log, which is the record of goods arriving — an order placed is not cloth
 * printed. A delivery whose cloth cannot be worked out is counted separately rather than as zero.
 */
function pafHistory(weeks) {
  const n = Math.max(1, parseInt(weeks, 10) || 8);
  const keys = [];
  const thisWk = repWkIso(repWeekStart(Date.now()));
  for (let i = n - 1; i >= 0; i--) keys.push(repWkShift(thisWk, -i));
  const keySet = new Set(keys);

  const byVendor = new Map();
  let unpriced = 0;
  voLogRows().forEach(r => {
    /* Printers only (Ravi, 2026-09-29: "friends rui mattress printer nahi h" — it is a Filling firm). */
    if (!r.printing) return;
    const wk = pafWeekOf(ptDtMs(r.day) || ptDtMs(r.raw));
    if (!wk || !keySet.has(wk)) return;
    const s = voSqm({ run: r.run, fabric: r.fabric, sku: r.sku }, r.qty);
    const v = byVendor.get(r.vendorCode) || { code: r.vendorCode, name: r.vendor, weeks: new Map(), total: 0, unpriced: 0 };
    if (s == null) { v.unpriced += r.qty; unpriced += r.qty; }
    else { v.weeks.set(wk, (v.weeks.get(wk) || 0) + s); v.total += s; }
    byVendor.set(r.vendorCode, v);
  });

  const vendors = [...byVendor.values()].map(v => {
    /* AVERAGED OVER THE WEEKS THEY ACTUALLY WORKED, not over the window. A printer who ran three of
     * eight weeks has a capacity of what those three weeks held; dividing by eight would understate
     * what they can do and under-order from them. */
    const ran = [...v.weeks.values()].filter(x => x > 0);
    const avg = ran.length ? v.total / ran.length : 0;
    return Object.assign(v, {
      avg, best: ran.length ? Math.max(...ran) : 0, ranWeeks: ran.length,
      last: v.weeks.get(keys[keys.length - 1]) || 0,
    });
  }).sort((a, b) => b.avg - a.avg);

  const perWeek = vendors.reduce((s, v) => s + v.avg, 0);
  return { keys, vendors, perWeek, total: vendors.reduce((s, v) => s + v.total, 0), unpriced };
}

/**
 * The requirement, printer by printer — as far as the data honestly goes.
 *
 * There is no allocation to read: no open order line carries a printer's name, and a printer's fed
 * capacity is a monthly PIECE count, which cannot be turned into square metres of any particular
 * cloth. So each printer is given a SHARE of the total need, in proportion to what they actually
 * deliver. That is a defensible way to split an order book between three printers who are all busy,
 * and it is not the same thing as a plan — which is why it is labelled as a share everywhere it
 * appears, and why palNeedWhy says what is missing.
 *
 * A printer who delivered nothing in the window has no rate, so no share: nothing is invented for
 * them.
 */
function palNeedSplit(need, hist) {
  const rate = (hist.vendors || []).reduce((s, v) => s + (v.avg || 0), 0);
  const map = new Map();
  (hist.vendors || []).forEach(v => {
    const share = rate > 0 ? (v.avg || 0) / rate : 0;
    const sqm = need.sqm * share;
    map.set(v.code, { share, sqm, weeks: v.avg > 0 ? sqm / v.avg : null });
  });
  return { rate, map };
}

/** What is stopping this from being a real per-printer requirement, in the words of the data. */
function palNeedWhy(need) {
  const why = [];
  const named = ordLines().filter(l => ptNum(l.pendingMake) > 0 && String(l.printer || '').trim()).length;
  if (!named) why.push('no open order line names a printer yet, so the share in the table is by delivery rate, not by who was given the work');
  if (!palPrinters().length) why.push('no printer has been fed a capacity, so the allocation plan has nothing to divide');
  if (need.unknownPcs) why.push(nf(need.unknownPcs) + ' piece(s) are missing from the m² total — no width in the fabric name, or no consumption on the master row');
  if ((need.unruled || []).length) why.push((need.unruled || []).length + ' subtype(s) have no printing rule yet, so they are counted as printed — '
    + need.unruled.slice(0, 3).map(u => u.subtype + ' (' + nf(u.pcs) + ')').join(', ')
    + (need.unruled.length > 3 ? ' and more' : '') + '; set them under Masters → Printing rule');
  return why;
}

