/* ================= SALES · PARENT LISTING REVIEW: one row per parent — last week against its 6-week average, stock, ad spend, action =================
 * Screens: Parent Listing Review (ensurePlaudit runs when the tab opens — core/nav.js), and the card that
 * opens when a parent ASIN is clicked.
 * Does: fetches nothing of its own. It joins what other screens already load — the weekly per-ASIN figures
 * of PPC & Organic (WEEKLY), the listings and quantities of Listing Health (HEALTH), the launch dates
 * (LAUNCH), the BSR snapshot (BSR), the Deal Calendar's photos (D_IMG) and the parent names — into one
 * row per parent (plRows) with a suggested action (plAction: stock first, then traffic, then spend), a
 * TOTAL row that only adds up what can be added (plSubtotal), and draws the sortable, filterable table
 * (renderPlaudit). Refresh stock & ranks pulls the FBA stock report and re-reads the rank snapshot;
 * Export writes the table as CSV.
 * Main functions: plAction, plRows, plSubtotal, renderPlaudit, plCardOpen, ensurePlaudit; helpers
 * plExcludedWeek, plMsg, plThumb, plBsrWeek, plLaunchOf; the plRefresh and plExport handlers. */

/* ============ Parent Listing Review ============
 *
 * One row per parent: how last week went against the parent's own recent average, how new the
 * listing is, and how long the stock on hand will last at that rate.
 *
 * Nothing here is fetched. Every figure comes from what other tabs already load — the weekly grid's
 * per-ASIN history, the health snapshot's listings and quantities, and the parent names — so opening
 * this tab costs a render, not a round trip.
 */
const PL_NEW_DAYS = 120;                 // a listing counts as "New" for this long after it goes live
const PL_AVG_WEEKS = 6;                  // the average each week is judged against

/**
 * Weeks that are not normal weeks, and so have no business in an average.
 *
 * A Prime Day week trades at several times its own baseline. Leaving it in the six-week average
 * lifts the bar for every week after it, and each of those then reports a fall that never happened —
 * the listing did not collapse, the average did.
 *
 * A WHOLE WEEK goes, not just the event days. The average is built from week totals, and subtracting
 * four days out of one would need per-ASIN daily figures going back further than they are kept. The
 * window then reaches one week further back so the average is still over six real weeks, and the
 * tooltip says which weeks were dropped rather than quietly using a different period.
 *
 * Add a row here for the next one — Black Friday, next year's Prime Day — and nothing else changes.
 */
const PL_EXCLUDE = [
  { from: '2026-06-23', to: '2026-06-26', why: 'Prime Day' },
];

/** Does the Sun–Sat week starting `wk` touch any of the excluded ranges? */
function plExcludedWeek(wk) {
  const end = sdShift(wk, 6);
  return PL_EXCLUDE.find(range => wk <= range.to && end >= range.from) || null;
}
const PL_WEEKS_PER_MONTH = 52 / 12;      // DOS is months of cover, not days — see plRows()

let PL_SORT = { k: 'runRate', dir: -1 };   // the column sorted on (k) and its direction (1 up, -1 down)
let PL_RENDER = { rows: [], defs: [] };    // what is on screen: the rows, the column definitions and the total — for the card and the export

/* Thresholds behind the suggested action. Named, because a bare 0.6 buried in a condition is a
 * number nobody can argue with — and these are all worth arguing with. */
const PL_LOW_COVER = 1;        // months of stock under which restocking is the only thing that matters
const PL_HIGH_COVER = 6;       // months over which stock is money sitting still
const PL_TRAFFIC_DROP = 0.6;   // last week's sessions as a share of the 6-week average
const PL_CVR_POOR = 0.01;      // 1% — these listings normally run 2–3%
const PL_MIN_SESS = 300;       // sessions needed before a conversion rate means anything at all
const PL_TINY_SPEND = 5;       // dollars a week below which "is it advertised" is really "no"

// Red is money leaving or a listing that cannot ship; amber is worth a look this week; green is an
// opportunity rather than a problem. "Steady" and "New" are deliberately colourless — a page where
// everything is highlighted highlights nothing.
const PL_ACT_TAG = {
  'Restock — out':  '<span class="ui-badge is-bad">Restock — out</span>',
  'Restock — low':  '<span class="ui-badge is-warn">Restock — low</span>',
  'Traffic drop':   '<span class="ui-badge is-warn">Traffic drop</span>',
  'Fix the page':   '<span class="ui-badge is-bad">Fix the page</span>',
  'Cut spend':      '<span class="ui-badge is-bad">Cut spend</span>',
  'Spend too high': '<span class="ui-badge is-bad">Spend too high</span>',
  'Add budget':     '<span class="ui-badge is-ok">Add budget</span>',
  'Overstocked':    '<span class="ui-badge is-warn">Overstocked</span>',
  'New — watch':    '<span class="muted">New — watch</span>',
  'Steady':         '<span class="muted">Steady</span>',
};

/**
 * What to do about this parent, from stock, traffic and ad spend — in that order of priority.
 *
 * The order is the point. There is no sense advising a bid change on something that ships next
 * month, so stock is asked first; traffic second, because paying to send people to a page that
 * cannot convert them is the most expensive mistake here; and spend last.
 *
 * Every branch refuses to speak about a figure it does not have. A parent whose ad report was never
 * pulled gets no advice about its budget, because "spend nothing on this" and "we never looked" are
 * not the same sentence.
 */
// → { a: the action's name (a key of PL_ACT_TAG), why: one sentence for the tooltip }, from one row of plRows.
function plAction(row) {
  const sold = row.lwUnits > 0 || row.lwSales > 0;
  const spendKnown = row.lwSpend != null;
  const advertised = spendKnown && row.lwSpend > PL_TINY_SPEND;
  const cvr = row.lwSess > 0 ? row.lwUnits / row.lwSess : null;

  /* --- stock first: nothing else is actionable if it cannot ship --- */
  if (row.stock === 0 && sold) {
    return { a: 'Restock — out', why: 'Sold last week and there is no FBA stock left.'
      + (advertised ? ` Ads are still spending $${Math.round(row.lwSpend)} a week on it.` : '') };
  }
  if (row.dos != null && row.dos < PL_LOW_COVER) {
    return { a: 'Restock — low', why: `About ${row.dos.toFixed(1)} month of cover at last week's rate.` };
  }

  /* --- then traffic --- */
  // `r.lwSess != null` is not belt and braces. Last week's sessions can be UNKNOWN while the average
  // is known, and `null < number` is `0 < number` — so a week Amazon has not reported yet would have
  // been announced as "Sessions down 100%", from no data at all.
  if (row.avgSess > 0 && row.lwSess != null && row.lwSess < row.avgSess * PL_TRAFFIC_DROP) {
    const pct = Math.round((1 - row.lwSess / row.avgSess) * 100);
    return { a: 'Traffic drop', why: `Sessions down ${pct}% on the 6-week average. Check rank and`
      + ' impression share before touching price.' };
  }
  if (cvr != null && row.lwSess >= PL_MIN_SESS && cvr < PL_CVR_POOR) {
    return { a: 'Fix the page', why: `${row.lwSess.toLocaleString('en-US')} sessions converted at `
      + `${(cvr * 100).toFixed(1)}%. The traffic is arriving and not buying — images, price and`
      + ' reviews, not budget.' };
  }

  /* --- then the money --- */
  if (advertised && !sold) {
    return { a: 'Cut spend', why: `$${Math.round(row.lwSpend)} spent last week and nothing sold.` };
  }
  if (advertised && row.lwSales > 0 && row.lwSpend / row.lwSales > 0.5) {
    return { a: 'Spend too high', why: `Ad spend is ${Math.round(row.lwSpend / row.lwSales * 100)}% of`
      + ' this parent\'s sales. Pull bids back before adding anything else.' };
  }
  if (spendKnown && !advertised && sold && row.dos != null && row.dos > PL_HIGH_COVER) {
    return { a: 'Add budget', why: `Selling with no ad spend and ${row.dos.toFixed(1)} months of stock`
      + ' sitting there. This is the cheapest place to put money.' };
  }
  if (row.dos != null && row.dos > PL_HIGH_COVER && row.diff != null && row.diff < 0) {
    return { a: 'Overstocked', why: `${row.dos.toFixed(1)} months of cover and sales falling. Deal,`
      + ' price or budget — something has to move it.' };
  }

  if (row.type === 'New') {
    return { a: 'New — watch', why: `Live ${row.ageDays} days. Too early to judge; leave it running.` };
  }
  return { a: 'Steady', why: 'Nothing in stock, traffic or spend stands out this week.' };
}

// The message line under the controls: grey normally, red when bad is true; blank text clears it.
function plMsg(text, bad) {
  const msg = $('plMsg');
  msg.textContent = text || '';
  msg.className = bad ? 'err' : 'muted';
}

/**
 * The same Amazon media URL, asked for at a size this grid can actually use.
 *
 * The Deal Calendar draws 30px and asks for 80. These cells are 76px, so they ask for 160 — double,
 * for a sharp picture on a retina screen — rather than pulling the 500px original for every row.
 */
function plThumb(url) {
  const str = String(url || '');
  const match = str.match(/^(https?:\/\/[^?#]*\/images\/[A-Za-z]\/[^./]+)(\._[A-Za-z0-9,_-]+_)?(\.(?:jpg|jpeg|png|gif|webp))(\?[^#]*)?$/i);
  return match ? `${match[1]}._SL160_${match[3]}${match[4] || ''}` : str;
}

// Opening the tab: make sure everything the rows are built from is loaded (listings, parent names, launch
// dates, ranks, photos, weekly figures, last night's merge), then draw.
async function ensurePlaudit() {
  if (!H_LOADED) {
    plMsg('Loading listings…');
    await loadHealthCache();
  }
  if (!PNAME_LOADED) await loadParentNames();
  try {
    await loadLaunch();
  } catch (e) { /* manual launch dates are optional here */ }
  if (!BSR_LOADED) {
    plMsg('Loading ranks…');
    await loadBsrCache();
  }
  // Photos live with the Deal Calendar, fetched once for the whole account and shared. Loading the
  // document is cheap; it is only the catalogue fetch behind "Fetch images" that costs anything.
  if (!Object.keys(D_IMG).length) {
    plMsg('Loading photos…');
    try {
      await loadDeals();
    } catch (e) {}
  }
  if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) {
    plMsg('Loading weekly sales…');
    await loadWeekly();
  }
  // The same nightly merge the PPC tab does, sharing its throttle — so sales and sessions here are
  // last night's without anybody pressing anything, and opening both tabs does not read twice.
  if (!W_BUSY && Date.now() - W_NIGHT_RUN > 600000) {
    plMsg('Bringing in last night\'s figures…');
    try {
      await wNightly();
    } catch (e) { /* whatever is stored still renders */ }
  }
  plMsg('');
  renderPlaudit();
}

/** The newest BSR snapshot week that actually has readings, across both brands. */
function plBsrWeek() {
  const weeks = allWeeks();
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (Object.keys(BSR.SP[weeks[i]] || {}).length
      || Object.keys(BSR.CPC[weeks[i]] || {}).length) return weeks[i];
  }
  return weeks[weeks.length - 1] || '';
}

/**
 * When a parent's listing went live, and how sure we are of it.
 *
 * Two sources, in order of authority. The date somebody typed into the launch dialog wins, because
 * it is a deliberate statement about when the product was actually launched. Failing that, Amazon's
 * own open-date off the listings report — the earliest across the parent's children, since a parent
 * is as old as its oldest child.
 *
 * A parent with neither is reported as unknown rather than quietly filed under Old. "We never
 * recorded when this went live" and "this is an established listing" are different facts, and only
 * one of them is a reason to stop worrying about it.
 */
function plLaunchOf(brand, parent, kids) {
  const manual = LAUNCH[brand] && LAUNCH[brand][parent] && LAUNCH[brand][parent].launch;
  if (manual) return { date: manual, sure: true };
  let earliest = '';
  kids.forEach(row => {
    const opened = (row.opened || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(opened) && (!earliest || opened < earliest)) earliest = opened;
  });
  return { date: earliest, sure: false };
}

// Build the rows: one per parent of the brands chosen, with last week, the 6-week average, stock, months of
// cover, launch age, BSR and the suggested action; then filter and sort them as the controls say.
// → { rows, lastWeek, avgWeeks, bsrWeek, skipped, weekly }.
function plRows() {
  // --- the controls ---
  const brandSel = $('plBrand').value;
  const brands = adBrands().filter(b => brandSel === 'ALL' || b === brandSel);
  const typeSel = $('plType').value;
  const search = $('plFilter').value.trim().toLowerCase();

  // --- the weeks: last week, and the six the average is built from ---
  // Completed weeks only, newest last. The week in progress is excluded everywhere on this tab: on a
  // Monday it would otherwise show every listing collapsing against its own six-week average.
  const all = WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26);
  const thisWeek = wKeyOfDate(sdToday());
  const done = all.filter(w => w < thisWeek);
  const lastWeek = done[done.length - 1] || '';
  // Last week is last week whatever happened in it — that is the figure you came to look at. Only
  // the AVERAGE skips event weeks, and reaches further back so it still spans six real ones.
  const avgWeeks = done.filter(w => !plExcludedWeek(w)).slice(-PL_AVG_WEEKS);
  const skipped = done.slice(done.indexOf(avgWeeks[0]) >= 0 ? done.indexOf(avgWeeks[0]) : 0)
    .filter(w => w <= lastWeek && plExcludedWeek(w))
    .map(w => wLabel(w) + ' (' + plExcludedWeek(w).why + ')');

  // --- the children of each parent (from the health snapshot) ---
  // Children grouped under their parent, from the health snapshot: it is the only place that knows
  // which SKU belongs to which ASIN belongs to which parent, and it carries the quantities too.
  const kidsOf = {};
  brands.forEach(b => ((HEALTH[b] && HEALTH[b].rows) || []).forEach(row => {
    const parentId = row.parent || row.asin || row.sku;
    if (!parentId) return;
    (kidsOf[b + '|' + parentId] || (kidsOf[b + '|' + parentId] = [])).push(row);
  }));

  // --- the weekly figures of each parent (from the weekly store, added up over its children) ---
  // Sales, units, sessions and page views roll up from the weekly store, which is keyed by CHILD
  // ASIN. Anything the health snapshot has never seen still gets a row of its own rather than being
  // dropped — a product missing from an audit is worse than one standing on its own.
  const weekly = {};
  Object.entries(WEEKLY.rows).forEach(([asin, row]) => {
    if (!brands.includes(row.brand)) return;
    const key = row.brand + '|' + wParentOf(asin);
    const into = weekly[key] || (weekly[key] = {});
    Object.entries(row.weeks || {}).forEach(([wk, cell]) => wAddCell(into[wk] || (into[wk] = {}), cell));
  });

  // --- one row per parent ---
  const keys = new Set([...Object.keys(kidsOf), ...Object.keys(weekly)]);
  const today = sdToday();
  const bsrWeek = plBsrWeek();
  const out = [];

  keys.forEach(key => {
    const cut = key.indexOf('|');
    const brand = key.slice(0, cut);
    const parent = key.slice(cut + 1);
    const kids = kidsOf[key] || [];
    const byWeek = weekly[key] || {};

    // last week, and the averages
    const lw = byWeek[lastWeek] || {};
    const sum = field => avgWeeks.reduce((acc, w) => acc + ((byWeek[w] || {})[field] || 0), 0);
    const nWeeks = avgWeeks.length || 1;
    const avgSales = sum('rev') / nWeeks;
    const avgUnits = sum('u') / nWeeks;
    // Averaged over the weeks that ACTUALLY have a session figure, not over all six. Dividing by six
    // when only two weeks were ever collected reports a third of the real traffic — and reports it
    // confidently. No week with a figure means no average at all.
    const sessWeeks = avgWeeks.filter(w => (byWeek[w] || {}).sessions != null);
    const avgSess = sessWeeks.length
      ? sessWeeks.reduce((acc, w) => acc + (byWeek[w].sessions || 0), 0) / sessWeeks.length : null;
    const avgPv = sessWeeks.length
      ? sessWeeks.reduce((acc, w) => acc + (byWeek[w].pv || 0), 0) / sessWeeks.length : null;
    const lwSales = lw.rev || 0;
    const lwUnits = lw.u || 0;
    // The six weeks the average is built from, week by week. An average is impossible to argue with
    // until you can see its parts — one enormous week and six ordinary ones give the same number as
    // a steady decline, and they mean completely different things.
    const parts = avgWeeks
      .map(w => wLabel(w) + ' $' + Math.round((byWeek[w] || {}).rev || 0).toLocaleString('en-US'))
      .join(' · ');

    // UNKNOWN and ZERO stay apart. A week whose ad report was never pulled has no `spend` at all —
    // flattening that to 0 would report a parent as costing nothing to advertise, which is a much
    // more confident claim than the data supports.
    const lwSpend = lw.spend == null ? null : lw.spend;

    // 52-week run rate is last week annualised — the same thing the working sheet does. It answers
    // "at this week's pace, what is this parent worth in a year", not "what did it earn last year".
    const runRate = lwSales * 52;

    // Against its own recent average, not against last year. Nothing to divide by means no number: a
    // parent that sold nothing for six weeks and something this week has not grown by a percentage
    // anybody can act on.
    const diff = avgSales > 0 ? (lwSales - avgSales) / avgSales : null;

    // stock and months of cover
    const stock = kids.reduce((acc, row) => acc + (row.qty || 0), 0);
    // DOS means MONTHS of cover here, which is what the sheet this replaces has always meant by it:
    // stock over last week's units gives weeks, turned into months. No sales last week means no rate
    // to divide by, so the answer is unknown rather than infinite.
    const dos = lwUnits > 0 ? stock / lwUnits / PL_WEEKS_PER_MONTH : null;

    // launch date → age → New / Old / unknown
    const launchInfo = plLaunchOf(brand, parent, kids);
    const ageDays = launchInfo.date
      ? Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(launchInfo.date + 'T00:00:00Z')) / 86400000)
      : null;
    const type = ageDays == null ? '?' : (ageDays < PL_NEW_DAYS ? 'New' : 'Old');

    // The same name the BSR and Deal tabs show, from the same helper — a hand-typed name first, then
    // the seller's own Amazon parent name, then a child's title marked "~". One product must not be
    // called three different things on three tabs.
    const title = parentName(brand, parent, (kids[0] && kids[0].title) || '');
    const kidWithAsin = kids.find(row => row.asin);

    // BSR belongs to a child; the snapshot already stores the best rank in the family per parent.
    const bsrCell = (BSR[brand] && BSR[brand][bsrWeek] && BSR[brand][bsrWeek][parent]) || null;

    out.push({
      brand, parent, child: kidWithAsin ? kidWithAsin.asin : '', title,
      img: D_IMG[parent] || '',
      bsr: bsrCell && bsrCell.rank ? bsrCell.rank : null,
      bsrCat: (bsrCell && bsrCell.cat) || '',
      type, launch: launchInfo.date, launchSure: launchInfo.sure, ageDays,
      // Same rule as lwSpend above: a week whose Sales & Traffic report has not been collected has
      // no session figure, and 0 would say "nobody visited this listing" — a claim the data does not
      // make. It reads as a dead listing sitting next to real units and real sales.
      runRate,
      lwSess: lw.sessions == null ? null : lw.sessions,
      lwPv: lw.pv == null ? null : lw.pv,
      lwUnits, lwSales, lwSpend,
      avgSess, avgPv, avgUnits, avgSales, diff, stock, dos, parts,
    });
  });

  // --- the action, then the filters, the budget share and the sort ---
  // Worked out before filtering, so the action dropdown has something to filter ON.
  out.forEach(row => {
    const act = plAction(row);
    row.action = act.a;
    row.why = act.why;
  });

  let rows = out;
  if (typeSel !== 'ALL') rows = rows.filter(row => row.type === typeSel);
  const actSel = $('plAct').value;
  if (actSel === 'TODO') rows = rows.filter(row => row.action !== 'Steady' && row.action !== 'New — watch');
  else if (actSel !== 'ALL') rows = rows.filter(row => row.action === actSel);
  if (search) rows = rows.filter(row => (row.parent + ' ' + row.child + ' ' + row.title).toLowerCase().includes(search));

  const sortKey = PL_SORT.k;
  const dir = PL_SORT.dir;
  // Budget share is each parent's slice of the ad spend ACROSS WHAT IS ON SCREEN, so it answers
  // "where is the money going" for the view you are looking at — not for a catalogue you have just
  // filtered away. Worked out after filtering, for that reason.
  const totSpend = rows.reduce((acc, row) => acc + (row.lwSpend || 0), 0);
  rows.forEach(row => {
    row.share = (row.lwSpend != null && totSpend > 0) ? row.lwSpend / totSpend : null;
  });

  // text columns alphabetically, numbers numerically with unknowns at the bottom (or top, descending)
  rows.sort((a, b) => (typeof a[sortKey] === 'string')
    ? String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')) * dir
    : ((a[sortKey] == null ? -Infinity : a[sortKey]) - (b[sortKey] == null ? -Infinity : b[sortKey])) * dir);
  return { rows, lastWeek, avgWeeks, bsrWeek, skipped, weekly };
}

/**
 * The subtotal across whatever is on screen.
 *
 * Counts and money add up. Ratios do NOT: the subtotal's difference is worked out from the summed
 * sales, never averaged from each row's percentage, or a parent doing $40 a week would pull the
 * total as hard as one doing $40,000. Rank and months of cover have no meaningful total at all, so
 * they are left blank rather than filled with a number that would only ever mislead.
 */
function plSubtotal(rows, avgWeeks, weeklyByKey) {
  // --- the plain sums ---
  const total = {
    lwSess: 0, lwPv: 0, lwUnits: 0, lwSales: 0,
    avgSess: 0, avgPv: 0, avgUnits: 0, avgSales: 0,
    stock: 0,
  };
  rows.forEach(row => Object.keys(total).forEach(key => {
    total[key] += row[key] || 0;
  }));
  // The session fields can be UNKNOWN rather than zero (see plRows). A total of nothing-known has to
  // be a dash: printing 0 there would announce that the whole brand got no traffic, which is exactly
  // the wrong conclusion to hand somebody looking at a screen full of dashes.
  ['lwSess', 'lwPv', 'avgSess', 'avgPv'].forEach(key => {
    if (!rows.some(row => row[key] != null)) total[key] = null;
  });
  // --- the week-by-week parts, the ratios, the spend ---
  // The same week-by-week breakdown for the total, so an odd average can be traced to the week that
  // caused it without opening a single row.
  // The `|| 0` MUST wrap only the value being added. Written as `acc + x.rev || 0` it binds as
  // `(acc + x.rev) || 0`, so the first parent with nothing that week turns the running total into
  // NaN and then into zero — which is exactly what it did, and every week read $0.
  total.parts = (avgWeeks || []).map(w => {
    const weekSum = rows.reduce((acc, row) => {
      const cell = ((weeklyByKey || {})[row.brand + '|' + row.parent] || {})[w];
      return acc + ((cell && cell.rev) || 0);
    }, 0);
    return wLabel(w) + ' $' + Math.round(weekSum).toLocaleString('en-US');
  }).join(' · ');
  total.runRate = total.lwSales * 52;
  total.diff = total.avgSales > 0 ? (total.lwSales - total.avgSales) / total.avgSales : null;
  // Spend totals only over the parents whose ad figures are actually known, and says so by staying
  // blank when none are. Adding the knowns and printing it beside a full parent count would read as
  // the whole account's spend when it is only part of it.
  const known = rows.filter(row => row.lwSpend != null);
  total.lwSpend = known.length ? known.reduce((acc, row) => acc + row.lwSpend, 0) : null;
  total.share = total.lwSpend == null ? null : 1;             // the view's spend is 100% of itself
  total.spendKnown = known.length;
  total.n = rows.length;
  return total;
}

// Draw the table: the message line and its tooltip, the head with the TOTAL row pinned under it, one row
// per parent, the sort clicks. Keeps what it drew in PL_RENDER for the card and the export.
function renderPlaudit() {
  // --- formatters (a dash for unknown) ---
  const esc = str => String(str == null ? '' : str)
    .replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const money = value => (value == null ? '<span class="ui-dim">—</span>' : '$' + Math.round(value).toLocaleString('en-US'));
  const nf = value => (value == null ? '<span class="ui-dim">—</span>' : Math.round(value).toLocaleString('en-US'));
  const pct = value => (value == null ? '<span class="ui-dim">—</span>'
    : '<span class="' + (value < 0 ? 'ui-neg' : 'ui-pos') + '">' + (value > 0 ? '+' : '') + (value * 100).toFixed(0) + '%</span>');

  // --- the rows ---
  wRenderCheck();
  const { rows, lastWeek, avgWeeks, bsrWeek, skipped, weekly } = plRows();

  if (!lastWeek) {
    $('plTable').innerHTML = '<tbody><tr><td class="ui-empty">'
      + 'No completed week stored yet — open PPC &amp; Organic and Refresh once.</td></tr></tbody>';
    plMsg('');
    return;
  }

  // --- the message line: the week, with the details in its tooltip ---
  const tot = plSubtotal(rows, avgWeeks, weekly);
  const nNew = rows.filter(row => row.type === 'New').length;
  const nUnk = rows.filter(row => row.type === '?').length;
  // Just the week. The parent count is already in the TOTAL row, and the rest — which rank snapshot,
  // how many are new, how many have no launch date — is worth having but not worth a line of prose
  // above every visit, so it moves into the tooltip.
  const msg = $('plMsg');
  msg.textContent = wLabel(lastWeek);
  msg.className = 'muted';
  msg.title = rows.length + ' parents · ' + avgWeeks.length + '-week average'
    + (avgWeeks.length ? ' (' + wLabel(avgWeeks[0]) + ' onwards)' : '')
    + (skipped.length ? ' · skipping ' + skipped.join(', ') : '')
    + (bsrWeek ? ' · ranks from ' + bsrWeek : ' · no rank snapshot yet')
    + ' · ' + nNew + ' new (live under ' + PL_NEW_DAYS + ' days)'
    + (nUnk ? ' · ' + nUnk + ' with no launch date on record' : '');
  // A dropped week changes what the "6wk" columns mean, so it is said on screen, not only on hover.
  if (skipped.length) msg.textContent += ' · avg excl. ' + skipped.join(', ');

  /* ORDER HERE, THE SUBTOTAL ROW AND THE BODY BELOW ARE ALL WRITTEN BY HAND AND MUST MATCH.
   * Nothing compares them at runtime, so a column moved in one place and not the other two puts every
   * heading over the wrong data — which is exactly what had happened on the Shopify Orders tab.
   * Listing Type and Action moved to the far right on 2026-09-01; they are read once in a while,
   * while the four on the left are what every row is identified by. */
  const COLS = [
    { k: 'parent', t: 'Parent ASIN', frz: 'frz' },
    { k: 'child', t: 'Child ASIN', frz: 'frz2' },
    { k: 'img', t: 'Image', noSort: 1, frz: 'frz3' },
    { k: 'title', t: 'Parent Title', frz: 'frz4' },
    { k: 'bsr', t: 'BSR', num: 1, tip: 'Best rank in the family, from the latest snapshot. Lower is better.' },
    { k: 'runRate', t: '52wk Run Rate', num: 1, tip: 'Last week&#39;s sales × 52.' },
    { k: 'lwSess', t: 'LW Sessions', num: 1 },
    { k: 'lwPv', t: 'LW Page Views', num: 1 },
    { k: 'lwUnits', t: 'LW Units', num: 1 },
    { k: 'lwSales', t: 'LW Sales', num: 1 },
    { k: 'lwSpend', t: 'LW Ad Spend', num: 1,
      tip: 'Sponsored Products spend last week. A dash means that week\'s ad report has not been pulled — '
        + 'not that nothing was spent.' },
    { k: 'share', t: 'Budget Share %', num: 1, tip: 'This parent\'s slice of the ad spend across the rows on screen.' },
    { k: 'avgSess', t: '6wk Sessions', num: 1 },
    { k: 'avgPv', t: '6wk Page Views', num: 1 },
    { k: 'avgUnits', t: '6wk Units', num: 1 },
    { k: 'avgSales', t: '6wk Sales', num: 1 },
    { k: 'diff', t: 'Difference', num: 1, tip: 'Last week against the 6-week average.' },
    { k: 'stock', t: 'FBA Stock', num: 1 },
    { k: 'dos', t: 'DOS', num: 1, tip: 'Months of cover: stock ÷ last week&#39;s units.' },
    { k: 'type', t: 'Listing Type' },
    { k: 'action', t: 'Action',
      tip: 'Stock is asked first, then traffic, then spend — there is no point changing a bid on something that '
        + 'ships next month. Hover a cell for the reason.' },
  ];

  // --- the head: the title row, then the TOTAL row ---
  const arrow = key => (PL_SORT.k === key ? (PL_SORT.dir > 0 ? ' ↑' : ' ↓') : '');
  const head = '<thead><tr>' + COLS.map(col =>
    '<th class="' + (col.num ? 'num' : '') + (col.frz ? ' ' + col.frz : '') + '"'
    + (col.noSort ? '' : ' data-pl-sort="' + col.k + '"')
    + (col.tip ? ' title="' + col.tip + '"' : '')
    + '>' + col.t + (col.noSort ? '' : arrow(col.k)) + '</th>').join('') + '</tr>'
    // The subtotal sits in the HEAD so it stays put while the rows scroll under it — the whole point
    // of a total is being able to read it without going back to the top.
    + '<tr class="subtot">'
    + '<th class="frz">TOTAL</th><th class="frz2">' + tot.n + ' parent' + (tot.n === 1 ? '' : 's') + '</th>'
    + '<th class="frz3"></th><th class="frz4"></th>'      // image, title
    + '<th></th>'                                          // BSR has no meaningful total
    + '<th class="num">' + money(tot.runRate) + '</th>'
    + '<th class="num">' + nf(tot.lwSess) + '</th><th class="num">' + nf(tot.lwPv) + '</th>'
    + '<th class="num">' + nf(tot.lwUnits) + '</th><th class="num">' + money(tot.lwSales) + '</th>'
    + '<th class="num">' + money(tot.lwSpend) + '</th>'
    + '<th class="num">' + (tot.share == null ? '<span class="ui-dim">—</span>' : '100%') + '</th>'
    + '<th class="num">' + nf(tot.avgSess) + '</th><th class="num">' + nf(tot.avgPv) + '</th>'
    + '<th class="num">' + nf(tot.avgUnits) + '</th>'
    + '<th class="num" title="' + esc(tot.parts) + '">' + money(tot.avgSales) + '</th>'
    + '<th class="num">' + pct(tot.diff) + '</th>'
    + '<th class="num">' + nf(tot.stock) + '</th><th></th>'   // stock, DOS
    + '<th></th><th></th>'                                  // listing type, action
    + '</tr></thead>';

  const TYPE_TAG = {
    New: '<span class="ui-badge is-ok">New</span>',
    Old: '<span class="muted">Old</span>',
    '?': '<span class="ui-badge">—</span>',
  };

  // --- the body: one row per parent, in the same column order ---
  const body = rows.map(row => '<tr>'
    + '<td class="frz"><span class="pl-open" data-pl-parent="' + esc(row.parent) + '" tabindex="0"'
      + ' role="button" title="Open everything known about this parent">' + esc(row.parent) + '</span></td>'
    + '<td class="frz2">' + esc(row.child) + '</td>'
    + '<td class="frz3 sa-pl-piccell">' + (row.img
        ? '<img src="' + esc(plThumb(row.img)) + '" loading="lazy" decoding="async" alt=""'
          + ' class="sa-pl-pic">'
        : '<span class="ui-dim">—</span>') + '</td>'
    // Clipped rather than wrapped: a long product name was stretching the column past everything
    // worth reading. The full name stays in the tooltip.
    + '<td class="frz4 ui-name sa-pl-title"'
      + ' title="' + esc(row.title) + '">' + esc(row.title) + '</td>'
    + '<td class="num"' + (row.bsrCat ? ' title="' + esc(row.bsrCat) + '"' : '') + '>'
      + (row.bsr ? row.bsr.toLocaleString('en-US') : '<span class="ui-dim">—</span>') + '</td>'
    + '<td class="num">' + money(row.runRate) + '</td>'
    + '<td class="num">' + nf(row.lwSess) + '</td><td class="num">' + nf(row.lwPv) + '</td>'
    + '<td class="num">' + nf(row.lwUnits) + '</td><td class="num">' + money(row.lwSales) + '</td>'
    + '<td class="num">' + money(row.lwSpend) + '</td>'
    + '<td class="num">'
      + (row.share == null ? '<span class="ui-dim">—</span>' : (row.share * 100).toFixed(1) + '%') + '</td>'
    + '<td class="num">' + nf(row.avgSess) + '</td><td class="num">' + nf(row.avgPv) + '</td>'
    + '<td class="num">' + nf(row.avgUnits) + '</td>'
    + '<td class="num" title="' + esc(row.parts) + '">' + money(row.avgSales) + '</td>'
    + '<td class="num">' + pct(row.diff) + '</td>'
    + '<td class="num">' + nf(row.stock) + '</td>'
    + '<td class="num">' + (row.dos == null ? '<span class="ui-dim">—</span>' : row.dos.toFixed(1)) + '</td>'
    + '<td title="' + esc(row.launch
        ? (row.launchSure ? 'Launched ' : 'Amazon open date ') + row.launch + ' · ' + row.ageDays + ' days ago'
        : 'No launch date recorded, and the listings report has no open date for it either') + '">'
      + TYPE_TAG[row.type]
      + (row.launch && !row.launchSure ? ' <span class="ui-note">auto</span>' : '')
    + '</td>'
    + '<td title="' + esc(row.why) + '" class="nowrap">'
      + (PL_ACT_TAG[row.action] || esc(row.action)) + '</td>'
    + '</tr>').join('');

  $('plTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="' + COLS.length + '" class="ui-empty">'
      + 'Nothing matches that filter.</td></tr>')
    + '</tbody>';
  PL_RENDER = { rows, defs: COLS, total: tot };

  // --- sort on a heading click: the same column flips the direction; a new one starts up (text) or down ---
  $('plTable').querySelectorAll('[data-pl-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.plSort;
    const text = (k === 'parent' || k === 'child' || k === 'title' || k === 'type');
    PL_SORT = { k, dir: PL_SORT.k === k ? -PL_SORT.dir : (text ? 1 : -1) };
    renderPlaudit();
  });

  // Pin the TOTAL row directly under the title row. Measured in rAF, not synchronously: reading a
  // height here would force a full layout of the table that was just inserted.
  requestAnimationFrame(() => {
    const firstTh = $('plTable').querySelector('thead tr:first-child th');
    const top = (firstTh ? Math.round(firstTh.getBoundingClientRect().height) : 0) || 34;
    $('plTable').querySelectorAll('thead tr.subtot th').forEach(th => {
      th.style.top = top + 'px';
    });
  });
}

// Every control redraws as it changes.
['plBrand', 'plType', 'plAct', 'plFilter'].forEach(id => $(id).addEventListener('input', renderPlaudit));

/* ---------- one parent, everything known about it ------------------------------------------
 *
 * The table is twenty-one columns wide and most of it is off screen at any moment. Deciding what to
 * do about a parent means reading last week AGAINST the six-week average, the stock and the ad spend
 * together — and that is four horizontal scrolls apart. This is the same row, standing still.
 *
 * It invents nothing: every figure here is the one already in the row. Where the row has no value
 * the card says so rather than printing a zero, because "no ad report pulled yet" and "nothing was
 * spent" are different answers and only one of them is a reason to act.
 */
// Open the card for one parent (by parent ASIN) from the rows on screen: photo, title, action, six tiles, and
// last week against the 6-week average per metric.
function plCardOpen(parent) {
  const row = (PL_RENDER.rows || []).find(each => each.parent === parent);
  if (!row) return;
  // --- formatters ---
  const esc = str => String(str == null ? '' : str)
    .replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const money = value => (value == null ? '<span class="ui-dim">—</span>' : '$' + Math.round(value).toLocaleString('en-US'));
  const nf = value => (value == null ? '<span class="ui-dim">—</span>' : Math.round(value).toLocaleString('en-US'));

  // Last week against the six-week average, per metric. The percentage is worked out here rather
  // than taken from r.diff — that one is the SALES difference, and printing it beside sessions
  // would put one number under four headings.
  const cmp = (label, lw, avg, fmt) => {
    const format = fmt || nf;
    const change = (avg > 0 && lw != null) ? (lw - avg) / avg * 100 : null;
    const cls = change == null ? 'muted' : (change >= 0 ? 'pl-up' : 'pl-dn');
    return `<tr><td>${label}</td><td class="num">${format(lw)}</td><td class="num">${format(avg)}</td>`
      + `<td class="num ${cls}">${change == null ? '<span class="ui-dim">—</span>'
          : (change >= 0 ? '+' : '') + change.toFixed(0) + '%'}</td></tr>`;
  };

  // one of the six tiles: a value over a label, with an optional tooltip
  const tile = (label, val, tip) => `<div class="pl-tile"${tip ? ` title="${esc(tip)}"` : ''}>`
    + `<div class="pl-tv">${val}</div><div class="pl-tl">${esc(label)}</div></div>`;

  const launch = row.launch
    ? (row.launchSure ? 'Launched ' : 'Amazon open date ') + row.launch + ' · ' + row.ageDays + ' days ago'
    : 'No launch date recorded';

  // --- the card ---
  $('plCardBody').innerHTML =
    `<div class="pl-head">
       ${row.img ? `<img src="${esc(plThumb(row.img))}" alt="" class="pl-img">`
               : '<div class="pl-img pl-noimg">no photo</div>'}
       <div class="sa-shrink">
         <div class="pl-title">${esc(row.title) || '<span class="muted">no title</span>'}</div>
         <div class="pl-ids">${esc(row.parent)}${row.child ? ' · child ' + esc(row.child) : ''}</div>
         <div class="sa-tags mt-8 gap-8">
           ${PL_ACT_TAG[row.action] || esc(row.action || '')}
           <span class="ui-note" title="${esc(launch)}">${esc(row.type === 'New' ? 'New listing' : row.type === 'Old' ? 'Old listing' : 'Listing age unknown')}</span>
         </div>
         ${row.why ? `<div class="pl-why">${esc(row.why)}</div>` : ''}
       </div>
     </div>

     <div class="pl-tiles">
       ${tile('BSR', row.bsr ? row.bsr.toLocaleString('en-US') : '<span class="ui-dim">—</span>', row.bsrCat || '')}
       ${tile('52wk run rate', money(row.runRate), 'Last week’s sales × 52.')}
       ${tile('FBA stock', nf(row.stock))}
       ${tile('Months of cover', row.dos == null ? '<span class="ui-dim">—</span>' : row.dos.toFixed(1),
              'Stock ÷ last week’s units.')}
       ${tile('LW ad spend', money(row.lwSpend),
              'Sponsored Products, last week. A dash means that week’s ad report has not been pulled — '
              + 'not that nothing was spent.')}
       ${tile('Budget share', row.share == null ? '<span class="ui-dim">—</span>' : (row.share * 100).toFixed(1) + '%',
              'This parent’s slice of the ad spend across the rows on screen.')}
     </div>

     <div class="pl-sec">Last week against the 6-week average</div>
     <table class="pl-cmp">
       <thead><tr><th></th><th class="num">Last week</th><th class="num">6wk avg</th><th class="num">Change</th></tr></thead>
       <tbody>
         ${cmp('Sessions', row.lwSess, row.avgSess)}
         ${cmp('Page views', row.lwPv, row.avgPv)}
         ${cmp('Units', row.lwUnits, row.avgUnits)}
         ${cmp('Sales', row.lwSales, row.avgSales, money)}
       </tbody>
     </table>
     ${row.parts ? `<div class="pl-note">${esc(row.parts)}</div>` : ''}
     <div class="pl-note">${esc(launch)}</div>`;

  $('plCardModal').classList.remove('hide');
  $('plCardClose').focus();
}

// Close the card: its Close button, a click on the backdrop, or Escape.
$('plCardClose').onclick = () => $('plCardModal').classList.add('hide');
$('plCardModal').onclick = e => {
  if (e.target === $('plCardModal')) $('plCardModal').classList.add('hide');
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('plCardModal').classList.contains('hide')) $('plCardModal').classList.add('hide');
});
// Open the card: a click on a parent ASIN, or Enter / Space on it.
// Delegated, because the table body is rebuilt on every sort and every filter keystroke.
$('plTable').addEventListener('click', e => {
  const el = e.target.closest('[data-pl-parent]');
  if (el) plCardOpen(el.dataset.plParent);
});
$('plTable').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[data-pl-parent]');
  if (el) {
    e.preventDefault();
    plCardOpen(el.dataset.plParent);
  }
});


/**
 * Pull the two figures the nightly run cannot reach: FBA stock, and the latest rank snapshot.
 *
 * Stock comes off the same FBA ageing report the Inventory Age tab uses, written back to the shared
 * `stock/{brand}` document so every tab sees the new quantities rather than this one holding a
 * private copy.
 *
 * Ranks are only RE-READ here, never re-taken. Taking a snapshot walks 1,200 child ASINs a run and
 * resumes across runs — that belongs behind its own button on BSR Audit, not started by surprise
 * from another tab. This picks up whatever snapshot exists.
 */
$('plRefresh').onclick = async () => {
  const btn = $('plRefresh');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>…';
  const failed = [];             // what went wrong, one line per brand or step
  const usedCol = new Set();     // which column of Amazon's report the quantities came from
  let updated = 0;               // SKUs whose quantity changed on screen
  // --- stock, brand by brand ---
  /* myBrands(), not adBrands(). This button refreshes FBA STOCK, which is not advertising data —
   * it was switched to adBrands() by mistake when the brand restriction was narrowed to the ad tabs
   * on 2026-08-23. An admin sees no difference, which is exactly why it went unnoticed; a
   * brand-restricted account would have quietly refreshed one brand's stock and left the other. */
  for (const brand of myBrands()) {
    try {
      plMsg(`${BRAND_NAME[brand]}: asking Amazon for the stock report…`);
      const report = await pollReport({ age: 'create', brand }, { age: 'poll', brand },
        progress => plMsg(`${BRAND_NAME[brand]}: stock report building… ${progress}`));
      const map = {};
      (report.rows || []).forEach(row => {
        if (row.sku) map[row.sku] = row.available || 0;
      });
      // WHICH column Amazon's report gave us. MCF can only ship what is fulfillable today, and this
      // report carries a friendlier-sounding `available` column that counts more than that. Saying
      // the name on screen turns "why is it 13 when Seller Central says 7" into something readable
      // instead of something to be investigated. (2026-09-01)
      if (report.availCol) usedCol.add(report.availCol);
      await saveStockDoc(brand, map);
      // Straight into the rows this tab reads, so the grid updates without a reload. A SKU missing
      // from the report is left alone rather than zeroed — absent from a report is not "sold out".
      ((HEALTH[brand] || {}).rows || []).forEach(row => {
        if (row.sku && Object.prototype.hasOwnProperty.call(map, row.sku)) {
          row.qty = map[row.sku];
          updated++;
        }
      });
    } catch (e) {
      failed.push(`${BRAND_NAME[brand]} stock: ${e.message || e}`);
    }
  }
  // --- ranks: re-read the snapshot ---
  try {
    BSR_LOADED = false;
    await loadBsrCache();
    BSR_LOADED = true;
  } catch (e) {
    failed.push(`ranks: ${e.message || e}`);
  }

  // --- redraw, and say what happened ---
  renderPlaudit();
  // Amazon allows roughly one report a minute, so two brands back to back can hit a 429. Say that
  // rather than dumping the raw error — the figures on screen are still the last good ones.
  if (failed.length) {
    const quota = failed.some(failure => /429|QuotaExceeded/i.test(failure));
    plMsg(quota
      ? 'Amazon’s report quota is used up (about one report a minute). Wait ~10 minutes and try again — '
        + 'the stock below is the last successful pull.'
      : failed.join('  ·  '), true);
  } else {
    const col = [...usedCol].join(', ');
    plMsg(`Stock updated for ${updated.toLocaleString('en-US')} SKUs · ranks re-read.`
      + (col ? ` · quantities read from “${col}”`
          + (/fulfillable|sellable/i.test(col) ? ' — what Amazon can pick today, which is what MCF may use.'
             : ' — WARNING: this is not the fulfillable column, so it may count stock MCF cannot ship.')
        : '')
      + ' Take a new snapshot on BSR Audit if the ranks look stale.');
  }
  btn.disabled = false;
  btn.textContent = 'Refresh stock & ranks';
};

// Export: the table on screen as CSV — the headings, the TOTAL row, then one line per parent.
$('plExport').onclick = () => {
  const { rows, defs, total } = PL_RENDER;
  // --- the lines ---
  // one CSV field: quoted when it holds a quote, a comma or a line break
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  // one row's value for one column, as the sheet should see it
  const val = (row, key) => {
    if (key === 'diff') return row.diff == null ? '' : (row.diff * 100).toFixed(0);
    if (key === 'dos') return row.dos == null ? '' : row.dos.toFixed(1);
    if (key === 'img') return row.img || '';                 // the URL, so the sheet can pull the picture
    const value = row[key];
    return typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  };
  const lines = [defs.map(col => col.t).map(cell).join(',')];
  // The total goes at the TOP, where it is read, and where a sort or a filter in the sheet leaves it
  // alone rather than dragging it into the middle of the rows.
  if (total) lines.push(defs.map(col => {
    if (col.k === 'parent') return 'TOTAL';
    if (col.k === 'child') return total.n + ' parents';
    if (col.k === 'diff') return total.diff == null ? '' : (total.diff * 100).toFixed(0);
    const value = total[col.k];
    return typeof value === 'number' ? Math.round(value * 100) / 100 : '';
  }).map(cell).join(','));
  rows.forEach(row => lines.push(defs.map(col => val(row, col.k)).map(cell).join(',')));
  // --- download; the string below starts with the invisible UTF-8 byte-order mark (U+FEFF) for Excel ---
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'parent-listing-review-' + new Date().toISOString().slice(0, 10) + '.csv';
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

