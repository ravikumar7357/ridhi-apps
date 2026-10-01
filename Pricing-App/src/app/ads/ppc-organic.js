/* ================= PPC & ORGANIC (weekly) =================
 * One row per ASIN, one column per week, and a metric picker deciding what sits in the cells.
 * Everything on this tab is derived from three stored numbers per ASIN per week — total sales, ad
 * spend/sales, and sessions — so TACoS, ACoS, organic split and CVR never disagree with each other.
 */
const W_CHUNK = 60;          // ASINs per Firestore doc; a 26-week row is ~1.5 KB
const W_POLL_MS = 15000;
const W_POLL_MAX = 40;
const W_ADS_LOOKBACK = 95;   // Amazon keeps Sponsored Products data about this long. Not a choice.

// rows[asin] = { brand, weeks: { '2026-05-10': { u, rev, spend, adSales, clicks, adOrders, sessions, pv } } }
// `nAt` records which nightly cache each shape was last merged from, by that cache's own stamp.
// See wNightly: a cache is folded in ONCE, so a manual Refresh is not undone by re-merging the same
// night's figures over the top of it the next time somebody opens the tab.
let WEEKLY = { weeks: [], rows: {}, at: '', adAt: '', doneWeeks: {}, pending: [], adDone: {}, nAt: {} };
let W_LOG = [];              // change-log entries
let W_BUSY = false;          // a refresh in flight — the button turns into Stop
let W_STOP = false;
// Once the range has been chosen by hand, nothing moves it again — not the nightly merge, not a
// newer week arriving. A report that jumps off the week you were reading is worse than a stale one.
// Declared here with the rest of the tab's state, not down by the wiring: ensureWeekly reads it, and
// a permission set that opens straight onto this tab would reach it before the wiring had run.
let W_RANGE_TOUCHED = false;
/**
 * Per-ASIN PER-DAY figures, for date ranges that are not whole weeks.
 *
 * Held in memory only, and re-read from the nightly cache when the tab opens. Deliberately NOT
 * saved to Firestore beside the weekly rows: this shape is roughly fifty times the size, and the
 * chunked write would run into the per-document limit — silently, on whichever ASIN tipped it over.
 *
 * rows[asin] = { days: { '2026-08-05': { u, rev, clicks, spend, adOrders, adSales } } }
 * `from` is the oldest day the nightly run keeps; anything before it can only be answered by week.
 */
let WDAY = { rows: {}, from: '', at: '' };

function wMsg(t, bad) { const m = $('wMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/* ---------- weeks ---------- */
const W_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wDate = k => new Date(k + 'T00:00:00Z');
/* Has this week FINISHED?
 *
 * Nothing is compared against a week that is still running. Three days of a week set beside seven of
 * the last one reads as a collapse — the PPC tab was showing -86% on sales and -81% on sessions every
 * Monday and Tuesday, and quietly "recovering" by Friday. The move was never real; the week was.
 *
 * Read in PT, the marketplace's day, and against the week's LAST day — the same rule the rest of the
 * date handling follows. `sdToday()` is already PT, and the week key is a UTC Sunday, so the end day
 * is derived in UTC and the two are compared as plain YYYY-MM-DD strings with no conversion between
 * them. Converting either one is how every date bug in this app has started. */
function wWeekDone(k) {
  const end = new Date(wDate(k).getTime() + 6 * 86400000).toISOString().slice(0, 10);
  return end < sdToday();
}
/** How many of a running week's days have finished, for saying so out loud. */
function wDaysIn(k) {
  const start = wDate(k).getTime();
  const today = new Date(sdToday() + 'T00:00:00Z').getTime();
  return Math.max(0, Math.min(7, Math.round((today - start) / 86400000)));
}
/** '2026-05-10' → 'May 10-16'; spans a month end as 'May 31-Jun 6', exactly like Seller Central. */
function wLabel(k) {
  const a = wDate(k), b = new Date(a.getTime() + 6 * 86400000);
  const am = W_MON[a.getUTCMonth()], bm = W_MON[b.getUTCMonth()];
  return am === bm
    ? `${am} ${a.getUTCDate()}-${b.getUTCDate()}`
    : `${am} ${a.getUTCDate()}-${bm} ${b.getUTCDate()}`;
}
/** The Sunday starting the week containing a yyyy-MM-dd date. Mirrors the backend's weekKeyOf_. */
function wKeyOfDate(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return new Date(d.getTime() - d.getUTCDay() * 86400000).toISOString().slice(0, 10);
}
function wWeeksList(n) {
  const today = new Date();
  const utc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const thisWeek = new Date(utc.getTime() - utc.getUTCDay() * 86400000).getTime();
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(thisWeek - i * 7 * 86400000).toISOString().slice(0, 10));
  return out;
}

/* ---------- storage ---------- */
const wCell = (asin, wk) => {
  const r = WEEKLY.rows[asin] || (WEEKLY.rows[asin] = { brand: '', weeks: {} });
  return r.weeks[wk] || (r.weeks[wk] = {});
};
async function loadWeekly() {
  try {
    const meta = await getDoc(doc(db, 'audit', 'weekly'));
    if (!meta.exists()) return;
    const d = meta.data();
    WEEKLY.weeks = d.weeks || [];
    WEEKLY.at = d.at || '';
    WEEKLY.adAt = d.adAt || '';
    WEEKLY.nAt = d.nAt || {};
    WEEKLY.doneWeeks = d.doneWeeks || {};
    WEEKLY.pending = d.pending || [];
    WEEKLY.adDone = d.adDone || {};
    WEEKLY.check = d.check || null;              // the nightly cross-check's last verdict
    let rows = {};
    if (d.chunks) {
      const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'weeklyrows', String(i)))));
      got.forEach(s => { if (s.exists()) Object.assign(rows, s.data().r || {}); });
    }
    WEEKLY.rows = rows;
  } catch (e) { /* nothing stored yet, or no read access */ }
  try {
    const l = await getDoc(doc(db, 'audit', 'weeklylog'));
    if (l.exists()) W_LOG = l.data().entries || [];
  } catch (e) { /* same */ }
}
async function saveWeekly() {
  const asins = Object.keys(WEEKLY.rows);
  const chunks = Math.ceil(asins.length / W_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    const slice = {};
    asins.slice(i * W_CHUNK, (i + 1) * W_CHUNK).forEach(a => { slice[a] = WEEKLY.rows[a]; });
    await setDoc(doc(db, 'weeklyrows', String(i)), { r: slice });
  }
  await setDoc(doc(db, 'audit', 'weekly'), {
    chunks, n: asins.length, weeks: WEEKLY.weeks, at: WEEKLY.at, adAt: WEEKLY.adAt,
    nAt: WEEKLY.nAt || {},
    doneWeeks: WEEKLY.doneWeeks, pending: WEEKLY.pending, adDone: WEEKLY.adDone,
    check: WEEKLY.check || null,
    by: ME.email, saved: serverTimestamp(),
  });
}
async function saveWeeklyLog() {
  await setDoc(doc(db, 'audit', 'weeklylog'), { entries: W_LOG, n: W_LOG.length, by: ME.email, saved: serverTimestamp() });
}

/**
 * Wipe some fields for one brand across a set of weeks, before the replacement is written over them.
 *
 * The nightly cache is a complete statement of the weeks it covers, so a week that dropped to no
 * spend at all simply has no row in it. Without this clear, that week would keep whatever it last
 * had and quietly report spend that stopped weeks ago.
 */
function wClearFields(brand, weeks, fields) {
  if (!weeks.size) return;
  Object.values(WEEKLY.rows).forEach(row => {
    if (row.brand !== brand) return;
    Object.entries(row.weeks || {}).forEach(([wk, c]) => {
      if (weeks.has(wk)) fields.forEach(f => { delete c[f]; });
    });
  });
}

/**
 * Fill this tab from last night's run, the same way the Ad Console does.
 *
 * Three caches feed the one grid — weekly sales out of the Orders workbooks, per-ASIN ad figures,
 * and Sales & Traffic sessions — and all three are keyed by the same Sunday week the grid uses, so
 * they drop straight in. Refresh stays for pulling ad history sooner than the next night.
 *
 * REPLACES, never adds. Every cache is a full statement of the weeks it covers, so adding would
 * double any week a Refresh had already collected.
 */
let W_NIGHT_RUN = 0;
async function wNightly() {
  const brands = adBrands();
  let changed = false, at = '', adAt = '';
  const seen = WEEKLY.nAt || (WEEKLY.nAt = {});
  /**
   * Fold each cache in ONCE, keyed on the stamp the nightly run wrote on it.
   *
   * Without this the merge re-applied the same night's figures on every visit, which quietly undid
   * any manual Refresh: you would re-scan, get the right numbers, switch tabs, come back, and last
   * night's stale ones would be sitting there again. A stamp that has not changed means there is
   * nothing new to fold in — whatever is stored is at least as fresh.
   *
   * Compared as a plain string, deliberately. The cache stamp is written in IST and the manual
   * refresh stamp in UTC, so any attempt to decide which is NEWER would be five and a half hours
   * wrong — see the note on weekKeyOf_ for how that kind of comparison ends.
   */
  const isNew = (name, stamp) => !!stamp && seen[name] !== stamp;

  // --- units and sales per ASIN per week ---
  try {
    const r = await baCall({ cache: 'weekly' });
    // This one cache is keyed `rows`, not `d`, unlike every other. Reading `d` here silently merged
    // nothing at all — no error, no empty-cache message, just sales that never updated.
    const d = (r.data && r.data.rows) || {};
    at = (r.data && r.data.at) || '';
    if (!isNew('weekly', at)) throw new Error('already merged');
    seen.weekly = at;
    /* A WEEK THAT FAILED THE NIGHTLY CROSS-CHECK IS NOT LET IN.
     *
     * The backend now compares this cache against the account daily one before publishing it, and
     * ships its verdict alongside the figures. Weeks it flagged are skipped here — not cleared, not
     * overwritten — so whatever is already stored for them, which came from a cache that DID agree,
     * stays exactly where it is.
     *
     * This is the piece that was missing. Everything else built today can tell you afterwards that
     * a number was wrong; only this stops the wrong number reaching the screen in the first place.
     * A six-week average is the worst possible place to notice: one bad week hides inside it for
     * six weeks, looking like a slow decline. */
    WEEKLY.check = (r.data && r.data.check) || null;
    const held = new Set(((WEEKLY.check && WEEKLY.check.bad) || []).map(x => x.brand + '|' + x.wk));
    brands.forEach(b => {
      const byAsin = d[b] || {};
      const weeks = new Set();
      Object.values(byAsin).forEach(byWeek => Object.keys(byWeek).forEach(w => weeks.add(w)));
      // Dropped from the CLEAR list as well as the write list. Clearing a week and then declining to
      // refill it would leave it empty, which is a worse answer than the one being rejected.
      held.forEach(k => { const cut = k.indexOf('|'); if (k.slice(0, cut) === b) weeks.delete(k.slice(cut + 1)); });
      wClearFields(b, weeks, ['u', 'rev']);
      Object.entries(byAsin).forEach(([a, byWeek]) => {
        const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand: b, weeks: {} });
        row.brand = row.brand || b;
        Object.entries(byWeek).forEach(([wk, v]) => {
          if (!weeks.has(wk)) return;                 // held back by the cross-check
          const c = row.weeks[wk] || (row.weeks[wk] = {});
          c.u = v[0] || 0;
          c.rev = Math.round((v[1] || 0) * 100) / 100;
          changed = true;
        });
      });
    });
  } catch (e) { /* nothing cached yet — the stored snapshot stays on screen */ }

  // --- ad spend, ad sales, clicks and ad orders, per ASIN per week ---
  // Impressions are deliberately not carried: this grid has never stored them per ASIN, and the
  // whole-account view is where they belong.
  try {
    const r = await baCall({ cache: 'adsAsin' });
    const d = (r.data && r.data.d) || {};
    adAt = (r.data && r.data.at) || '';
    if (!isNew('adsAsin', adAt)) throw new Error('already merged');
    seen.adsAsin = adAt;
    brands.forEach(b => {
      const byAsin = d[b] || {};
      const weeks = new Set();
      Object.values(byAsin).forEach(byWeek => Object.keys(byWeek).forEach(w => weeks.add(w)));
      wClearFields(b, weeks, ['clicks', 'spend', 'adOrders', 'adSales']);
      Object.entries(byAsin).forEach(([a, byWeek]) => {
        const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand: b, weeks: {} });
        row.brand = row.brand || b;
        Object.entries(byWeek).forEach(([wk, v]) => {
          const c = row.weeks[wk] || (row.weeks[wk] = {});
          c.clicks = v[1] || 0;
          c.spend = Math.round((v[2] || 0) * 100) / 100;
          c.adOrders = v[3] || 0;
          c.adSales = Math.round((v[4] || 0) * 100) / 100;
          changed = true;
        });
      });
    });
  } catch (e) { /* the ads phase may not have finished — last night's window stays */ }

  // --- sessions and page views ---
  // A week the nightly run has collected is also marked done, so a later Refresh does not spend
  // Amazon's one-report-a-minute budget asking again for something already in hand.
  try {
    const r = await baCall({ cache: 'sessions' });
    const d = (r.data && r.data.d) || {};
    const sAt = (r.data && r.data.at) || '';
    if (!isNew('sessions', sAt)) throw new Error('already merged');
    seen.sessions = sAt;
    brands.forEach(b => {
      Object.entries(d[b] || {}).forEach(([a, byWeek]) => {
        const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand: b, weeks: {} });
        row.brand = row.brand || b;
        Object.entries(byWeek).forEach(([wk, v]) => {
          const c = row.weeks[wk] || (row.weeks[wk] = {});
          c.sessions = v[0] || 0;
          c.pv = v[1] || 0;
          WEEKLY.doneWeeks[b + '|' + wk] = 1;
          changed = true;
        });
      });
    });
  } catch (e) { /* the sessions phase is the slowest — it may simply not have got there yet */ }

  // --- the per-day store, for ranges that are not whole weeks ---
  // Read into memory and never saved, so a failure here costs nothing but the daily range: the
  // weekly grid above is already complete without it.
  const dcell = (a, day) => {
    const row = WDAY.rows[a] || (WDAY.rows[a] = { days: {} });
    return row.days[day] || (row.days[day] = {});
  };
  try {
    const r = await baCall({ cache: 'dailyAsin' });
    const d = (r.data && r.data.d) || {};
    WDAY.from = (r.data && r.data.from) || '';
    WDAY.at = (r.data && r.data.at) || '';
    WDAY.rows = {};                                  // a full statement of its window — rebuild, never merge
    brands.forEach(b => Object.entries(d[b] || {}).forEach(([a, byDay]) => {
      Object.entries(byDay).forEach(([day, v]) => {
        const c = dcell(a, day);
        c.u = v[0] || 0;
        c.rev = Math.round((v[1] || 0) * 100) / 100;
      });
    }));
  } catch (e) { WDAY = { rows: {}, from: '', at: '' }; }
  try {
    const r = await baCall({ cache: 'adsAsinDay' });
    const d = (r.data && r.data.d) || {};
    brands.forEach(b => Object.entries(d[b] || {}).forEach(([a, byDay]) => {
      Object.entries(byDay).forEach(([day, v]) => {
        const c = dcell(a, day);
        c.clicks = v[1] || 0;
        c.spend = Math.round((v[2] || 0) * 100) / 100;
        c.adOrders = v[3] || 0;
        c.adSales = Math.round((v[4] || 0) * 100) / 100;
      });
    }));
  } catch (e) { /* sales-only daily ranges still work; the ad columns just show a dash */ }

  if (changed) {
    WEEKLY.weeks = wWeeksList(26);
    // Stamped with when the run actually produced the figures, not with now — "as at 05:12" is the
    // truth, and it is also how you can tell at a glance that last night's pass really happened.
    if (at) WEEKLY.at = at;
    if (adAt) WEEKLY.adAt = adAt;
    try { await saveWeekly(); } catch (e) { /* read-only account — the merge is on screen regardless */ }
  }
  W_NIGHT_RUN = Date.now();
  return changed ? (at || adAt || 'last night') : '';
}

/**
 * The week the range report should open on: the newest one that actually has figures.
 *
 * NOT simply the newest week in the list, which is what this used to be. That week is the one in
 * progress, and on a Sunday or a Monday it is a day old with nothing in it — so a tab full of data
 * opened onto an empty grid saying "nothing in this range", which reads as broken rather than as
 * "the week just started".
 */
function wDefaultWeek() {
  const all = WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26);
  if (!all.length) return '';
  const has = wk => Object.values(WEEKLY.rows).some(r => {
    const c = r.weeks && r.weeks[wk];
    return c && (c.rev || c.u || c.spend || c.sessions);
  });
  for (let i = all.length - 1; i >= 0; i--) if (has(all[i])) return all[i];
  // Nothing stored at all yet. The last COMPLETE week is still a better opening guess than one that
  // began this morning.
  return all[all.length > 1 ? all.length - 2 : 0];
}
function wSetDefaultRange() {
  const wk = wDefaultWeek();
  if (!wk) return;
  $('wFrom').value = wk;
  $('wTo').value = new Date(wDate(wk).getTime() + 6 * 86400000).toISOString().slice(0, 10);
}

async function ensureWeekly() {
  if (!H_LOADED) await loadHealthCache();          // ASIN → brand, title and parent all come from here
  if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) {
    wMsg('Loading…'); await loadWeekly(); wMsg('');
  }
  // Draw what is stored FIRST. The nightly merge below reads three cache sheets and can take a few
  // seconds; leaving the grid blank until it returns makes a working tab look empty.
  if (!$('wFrom').value) wSetDefaultRange();
  renderWeekly();
  // Fold in last night's run, so the grid is current on arrival rather than one long click later.
  // Throttled: switching between tabs must not re-read the cache sheets every time.
  if (!W_BUSY && Date.now() - W_NIGHT_RUN > 600000) {
    wMsg('Bringing in last night\'s figures…');
    let from = '';
    try { from = await wNightly(); } catch (e) { /* fall through to whatever is stored */ }
    // The merge can bring in a week that was not there before. Follow it onto the newest week with
    // figures — but never over a range the user has chosen for themselves.
    if (!W_RANGE_TOUCHED) wSetDefaultRange();
    renderWeekly();
    wMsg(from ? `Up to date — nightly run of ${from}.` : '');
  }
  // One cheap sweep for ad reports that finished since last time — opening the tab is the reminder.
  if (WEEKLY.pending.length) {
    wMsg(`Checking ${WEEKLY.pending.length} ad report${WEEKLY.pending.length === 1 ? '' : 's'} queued earlier…`);
    const got = await wCollect(1, false);
    wMsg(got
      ? `Collected ${got} ad report${got === 1 ? '' : 's'} that finished since last time.`
      : `${WEEKLY.pending.length} ad report${WEEKLY.pending.length === 1 ? '' : 's'} still building at Amazon's end — open this tab again in a few minutes.`);
  }
}

/* ---------- the refresh: sales, then ads, then sessions ---------- */
async function weeklyRefresh() {
  if (W_BUSY) { W_STOP = true; wMsg('Stopping after the current step — everything fetched so far is saved.'); return; }
  W_BUSY = true; W_STOP = false;
  $('wRefresh').textContent = 'Stop';
  const weeks = wWeeksList(26);
  WEEKLY.weeks = weeks;
  // How far back the SLOW parts go. Sales are one pass over the workbooks whatever we ask for, so
  // they always fill the whole window — it is ad reports and per-week session reports that cost
  // minutes, and those are the ones worth doing a couple of weeks at a time.
  const scope = Math.min(Number($('wScope').value) || 2, weeks.length);
  const scopeWeeks = weeks.slice(-scope);

  const wFailed = [];
  try {
    /* --- 1. total sales + units, straight out of the Orders workbooks --- */
    // Each workbook is guarded on its own, and every call retries on a network failure. One brand's
    // sheet dying used to take the whole run with it, so the AD step was never even reached — which
    // looked from the outside like the ad figures were broken when they had never been asked for.
    let books = 2;
    for (let book = 0; book < books && !W_STOP; book++) {
      const brand = book === 0 ? 'SP' : 'CPC';   // ORDERS_DATA_IDS is [Ridhi, CPC] on the backend
      try {
        // BUILT ASIDE, SWAPPED IN AT THE END. The scan adds slice by slice, so the brand's old
        // figures have to go before the new ones land or every Refresh counts the same orders twice.
        // But clearing FIRST and scanning after means a scan that dies half way — one slow response
        // is enough — leaves that brand with no sales at all and nothing to put back. That is
        // exactly what happened to Ridhi. So the slices accumulate into a map of their own, and the
        // stored figures are only replaced once the whole workbook has been read.
        const fresh = {};
        let start = 2, guard = 0;
        for (;;) {
          const d = await tCall({ weekly: 'sales', book, start, n: 12000, weeks: 26 });
          books = d.books || books;
          Object.entries(d.asins || {}).forEach(([a, byWeek]) => {
            const row = fresh[a] || (fresh[a] = {});
            Object.entries(byWeek).forEach(([wk, v]) => {
              const c = row[wk] || (row[wk] = { u: 0, rev: 0 });
              c.u += v[0] || 0;
              c.rev = Math.round((c.rev + (v[1] || 0)) * 100) / 100;
            });
          });
          const done = Math.min(start + (d.read || 0) - 1, d.lastRow || 0);
          wMsg(`Sales — ${BRAND_NAME[brand]}, row ${done.toLocaleString('en-US')} of ${(d.lastRow || 0).toLocaleString('en-US')}…`);
          if (d.done || !d.next) break;
          start = d.next;
          if (++guard > 600) throw new Error('Orders scan did not terminate.');
        }
        // The whole workbook is in hand. Only the sales fields are replaced — ad figures and
        // sessions come from elsewhere and must survive.
        Object.values(WEEKLY.rows).forEach(row => {
          if (row.brand !== brand) return;
          Object.values(row.weeks || {}).forEach(c => { delete c.u; delete c.rev; });
        });
        Object.entries(fresh).forEach(([a, byWeek]) => {
          const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand, weeks: {} });
          row.brand = row.brand || brand;
          Object.entries(byWeek).forEach(([wk, v]) => {
            const c = row.weeks[wk] || (row.weeks[wk] = {});
            c.u = v.u; c.rev = v.rev;
          });
        });
      } catch (err) {
        wFailed.push(`${BRAND_NAME[brand]} sales: ${err.message || err}`);
        wMsg(`Sales — ${BRAND_NAME[brand]} stopped: ${err.message || err}. Carrying on with the ad figures.`, true);
      }
    }
    WEEKLY.at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await saveWeekly();

    /* --- 2. ad spend + ad sales, in 31-day slices (the Ads API limit) --- */
    // Only the last ~95 days exist at Amazon's end, so the older weeks stay blank for good. Walking
    // back further would just burn minutes to be told the same thing.
    if (!W_STOP) {
      const today = new Date();
      const end0 = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - 86400000);
      const iso = d => d.toISOString().slice(0, 10);
      // Reach back far enough to cover the chosen weeks, but never past Amazon's ~95-day retention —
      // asking for older days spends minutes to be told there is nothing there.
      const wantDays = Math.min(W_ADS_LOOKBACK,
        Math.ceil((end0.getTime() - wDate(scopeWeeks[0]).getTime()) / 86400000) + 1);
      const slices = [];
      for (let off = 0; off < wantDays; off += 31) {
        const e = new Date(end0.getTime() - off * 86400000);
        const s = new Date(e.getTime() - Math.min(30, wantDays - off - 1) * 86400000);
        slices.push([iso(s), iso(e)]);
      }
      // ASK NOW, COLLECT LATER — the same design as the Ad Console, for the same reason: Amazon can
      // leave a report at PENDING for longer than anyone will sit and watch. The reportId is stored
      // and the download happens whenever it is ready, including the next time this tab is opened.
      const settled = iso(new Date(end0.getTime() - T_AD_SETTLE_DAYS * 86400000));
      let wSkipped = 0;
      for (const brand of adBrands()) {
        for (const [s, e] of slices) {
          if (W_STOP) break;
          // Settled and already collected — an ad week older than the attribution window never
          // changes again, so re-fetching it is pure waiting.
          if (WEEKLY.adDone[tSliceKey(brand, s, e)] && e < settled) { wSkipped++; continue; }
          if (WEEKLY.pending.some(p => p.brand === brand && p.start === s && p.end === e)) continue;
          try {
            wMsg(`Ad spend — ${BRAND_NAME[brand]}, ${s} → ${e}: asking Amazon…`);
            const c = await tCall({ ads: 'ppcRange', brand, start: s, end: e });
            if (!c.reportId) throw new Error('no report id');
            WEEKLY.pending.push({ brand, start: s, end: e, id: c.reportId, asked: Date.now() });
            await saveWeekly();
          } catch (err) {
            wFailed.push(`${BRAND_NAME[brand]} ads ${s}: ${err.message || err}`);
          }
        }
      }
      if (wSkipped) wMsg(`Ads — ${wSkipped} window(s) already settled and skipped.`);
      await wCollect(20, true);
      WEEKLY.adAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await saveWeekly();
    }

    /* --- 3. sessions, one report per brand per week --- */
    // NEWEST FIRST, saved after each one. This step is the slow one: Amazon rate-limits report
    // creation to roughly one a minute after a small burst, so a full 26-week backfill for two
    // brands is the better part of an hour. Newest-first means the weeks you actually look at land
    // in the first few minutes, and stopping half way still leaves the tab useful.
    const wantWeeks = [...scopeWeeks].reverse();
    for (const brand of ['SP', 'CPC']) {
      for (const wk of wantWeeks) {
        if (W_STOP) break;
        const doneKey = brand + '|' + wk;
        if (WEEKLY.doneWeeks[doneKey]) continue;          // already have it — never ask twice
        const end = new Date(wDate(wk).getTime() + 6 * 86400000).toISOString().slice(0, 10);
        try {
          wMsg(`Sessions — ${BRAND_NAME[brand]}, ${wLabel(wk)}: asking Amazon…`);
          const c = await baCall({ traffic: 'create', brand, start: wk, end });
          if (!c.reportId) throw new Error('no report id');
          const asins = await wAwaitTrafficReport(brand, c.reportId, `${BRAND_NAME[brand]} ${wLabel(wk)}`);
          if (asins) {
            Object.entries(asins).forEach(([a, v]) => {
              const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand, weeks: {} });
              row.brand = row.brand || brand;
              const cell = row.weeks[wk] || (row.weeks[wk] = {});
              cell.sessions = (cell.sessions || 0) + (v[0] || 0);
              cell.pv = (cell.pv || 0) + (v[1] || 0);
            });
          }
          // Marked done even when Amazon had nothing: an empty week is an answer, and re-asking it
          // every refresh would spend the rate limit on weeks that will never have data.
          WEEKLY.doneWeeks[doneKey] = 1;
          await saveWeekly();
          renderWeekly();
        } catch (err) {
          wMsg(`Sessions — ${BRAND_NAME[brand]} ${wLabel(wk)} failed: ${err.message || err}. Carrying on.`, true);
        }
      }
    }

    await saveWeekly();
    renderWeekly();
    // Every problem is listed at the end. A run that half worked is the hardest kind to diagnose
    // from a single line of red text, and the ad figures being absent is exactly that case.
    const done = `Done — ${scope} week${scope === 1 ? '' : 's'} of ads and sessions, all 26 weeks of sales.`
      + ` Sales as at ${WEEKLY.at}${WEEKLY.adAt ? ` · ads ${WEEKLY.adAt}` : ''}.`;
    wMsg(W_STOP ? 'Stopped. Everything fetched so far is saved — Refresh picks up where it left off.'
      : (wFailed.length
        ? `${done} · ${wFailed.length} problem${wFailed.length === 1 ? '' : 's'}: ${wFailed.slice(0, 3).join(' · ')}`
        : done + ' To go further back, pick a longer span and Refresh again.'), wFailed.length > 0);
  } catch (e) {
    const m = String(e.message || e);
    wMsg('Refresh failed: ' + m
      + (/permission/i.test(m) ? ' — your account needs the “PPC & Organic” permission (Settings → Access).' : ''), true);
    try { await saveWeekly(); } catch (x) { /* nothing more to do */ }
  }
  W_BUSY = false; W_STOP = false;
  $('wRefresh').textContent = 'Refresh';
}

/**
 * Download every queued per-ASIN ad report Amazon has finished, and leave the rest queued.
 * The twin of tCollect on the Ad Console — same reasoning, different shape of data.
 */
async function wCollect(rounds, wait) {
  if (!WEEKLY.pending.length) return 0;
  let done = 0;
  for (let r = 0; r < rounds && WEEKLY.pending.length && !W_STOP; r++) {
    for (const job of [...WEEKLY.pending]) {
      if (W_STOP) break;
      try {
        const s = await tCall({ ads: 'ppcStatus', brand: job.brand, id: job.id });
        if (/fail|cancel/i.test(s.status || '')) { WEEKLY.pending = WEEKLY.pending.filter(p => p.id !== job.id); continue; }
        if (!s.ready) continue;
        const d = await tCall({ ads: 'ppcFetch', brand: job.brand, id: job.id });
        // Cleared only now that the replacement is in hand — clearing at request time would wipe
        // good figures for as long as the report took, and for ever if it never arrived.
        Object.values(WEEKLY.rows).forEach(row => {
          if (row.brand !== job.brand) return;
          Object.entries(row.weeks || {}).forEach(([wk, c]) => {
            if (wk >= job.start && wk <= job.end) { delete c.clicks; delete c.spend; delete c.adOrders; delete c.adSales; }
          });
        });
        Object.entries(d.asins || {}).forEach(([a, byWeek]) => {
          const row = WEEKLY.rows[a] || (WEEKLY.rows[a] = { brand: job.brand, weeks: {} });
          row.brand = row.brand || job.brand;
          Object.entries(byWeek).forEach(([wk, v]) => {
            const cell = row.weeks[wk] || (row.weeks[wk] = {});
            cell.clicks = (cell.clicks || 0) + (v[1] || 0);
            cell.spend = Math.round(((cell.spend || 0) + (v[2] || 0)) * 100) / 100;
            cell.adOrders = (cell.adOrders || 0) + (v[3] || 0);
            cell.adSales = Math.round(((cell.adSales || 0) + (v[4] || 0)) * 100) / 100;
          });
        });
        WEEKLY.pending = WEEKLY.pending.filter(p => p.id !== job.id);
        WEEKLY.adDone[tSliceKey(job.brand, job.start, job.end)] = 1;
        done++;
        await saveWeekly(); renderWeekly();
      } catch (e) { /* still building, or a blip — it stays queued */ }
    }
    WEEKLY.pending = WEEKLY.pending.filter(p => !p.asked || Date.now() - p.asked < 86400000);
    if (!WEEKLY.pending.length || r === rounds - 1) break;
    wMsg(`Waiting on ${WEEKLY.pending.length} ad report${WEEKLY.pending.length === 1 ? '' : 's'} Amazon is still building — ${done} collected so far…`);
    if (wait) await new Promise(x => setTimeout(x, 15000));
  }
  return done;
}

/** Poll an Ads report to completion; returns its per-ASIN-per-week map, or null. */

/** Poll a Sales & Traffic report; null when Amazon has no data for that week (a normal answer). */
async function wAwaitTrafficReport(brand, id, label) {
  for (let t = 0; t < W_POLL_MAX; t++) {
    if (W_STOP) return null;
    const s = await baCall({ traffic: 'status', brand, id });
    if (s.dead) return null;                     // FATAL here means "nothing sold that week"
    if (s.ready) {
      if (!s.doc) return null;
      const d = await baCall({ traffic: 'fetch', brand, doc: s.doc });
      return d.asins || {};
    }
    wMsg(`Sessions — ${label}: Amazon is building the report (${t + 1}/${W_POLL_MAX})…`);
    await new Promise(r => setTimeout(r, W_POLL_MS));
  }
  throw new Error('report was not ready in time');
}

/* ---------- the numbers a cell can show ---------- */
// Everything here is derived from the four stored figures, so no two views can drift apart.
const wOrganic = c => (c.rev == null ? null : Math.max(0, (c.rev || 0) - (c.adSales || 0)));
const W_METRIC = {
  /* `sub` prints UNDER the number, in the same cell. TACoS only means anything against the sales it
   * was spent on, and reading it off a different metric view means holding two grids in your head. */
  sales:    { t: 'Total sales', money: 1, get: c => c.rev,
              sub: c => (c.spend != null && c.rev ? { txt: 'TACoS ' + (c.spend / c.rev * 100).toFixed(c.spend / c.rev * 100 < 10 ? 1 : 0) + '%',
                cls: (c.spend / c.rev * 100) <= 10 ? 'gd-good' : (c.spend / c.rev * 100) <= 20 ? 'gd-warn' : 'gd-bad' } : null) },
  spend:    { t: 'Ad spend', money: 1, get: c => c.spend },
  adsales:  { t: 'Ad sales', money: 1, get: c => c.adSales },
  organic:  { t: 'Organic sales', money: 1, get: c => (c.rev == null ? null : wOrganic(c)) },
  units:    { t: 'Units', get: c => c.u },
  // `wow` = colour this week against the LAST one, rather than against a fixed threshold. There is no
  // universally good session count, so a band would be arbitrary; the direction is the real signal.
  sessions: { t: 'Sessions', get: c => c.sessions, wow: 1 },
  // A ratio needs BOTH sides. Showing 0% because the denominator is missing is worse than a dash:
  // it reads as "nothing was spent" when the truth is "we do not know yet".
  tacos:    { t: 'TACoS', pct: 1, get: c => (c.spend != null && c.rev ? c.spend / c.rev * 100 : null),
              band: v => v <= 10 ? 'gd-good' : v <= 20 ? 'gd-warn' : 'gd-bad' },
  acos:     { t: 'ACoS', pct: 1, get: c => (c.spend != null && c.adSales ? c.spend / c.adSales * 100 : null),
              band: v => v <= 30 ? 'gd-good' : v <= 60 ? 'gd-warn' : 'gd-bad' },
  cvr:      { t: 'CVR', pct: 1, get: c => (c.u != null && c.sessions ? c.u / c.sessions * 100 : null),
              wow: 1, band: v => v >= 15 ? 'gd-good' : v >= 8 ? 'gd-warn' : 'gd-bad' },
  split:    { t: 'Ad % / Organic %', split: 1, get: c => (c.rev && c.adSales != null ? c.adSales / c.rev * 100 : null) },
};

// Built once and reused: scanning the health snapshot per ASIN per render turned a 40-column grid
// into a linear search inside a nested loop.
let W_TITLES = null, W_PARENT = null;
function wBuildLookups() {
  if (W_TITLES) return;
  W_TITLES = {}; W_PARENT = {};
  ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
    const a = String(r.asin || '').trim().toUpperCase(); if (!a) return;
    if (!W_TITLES[a] && r.title) W_TITLES[a] = r.title;
    const p = String(r.parent || '').trim().toUpperCase();
    if (!W_PARENT[a]) W_PARENT[a] = p || a;      // no parent recorded → it IS its own parent
  }));
}
function wTitle(asin) { wBuildLookups(); return W_TITLES[asin] || ''; }
// An ASIN the health snapshot has never seen still has to land somewhere, so it stands alone rather
// than being dropped — a product missing from the grid is far worse than one shown on its own row.
function wParentOf(asin) { wBuildLookups(); return W_PARENT[asin] || asin; }

/* ---------- render ---------- */
/**
 * Say, on the tabs that read these figures, that a week was refused.
 *
 * Drawn on BOTH tabs because both are built from the same store, and the one that matters most is
 * Parent Listing Review — a held-back week sits inside its six-week average, where it is invisible.
 * Silence here would mean the safest thing the pipeline does is also the thing nobody knows about.
 */
function wRenderCheck() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const bad = (WEEKLY.check && WEEKLY.check.bad) || [];
  const html = !bad.length ? '' : '<b>Sales held back for ' + bad.length + ' week'
    + (bad.length === 1 ? '' : 's') + '.</b> The nightly run\'s own figures for '
    + bad.map(b => esc((BRAND_NAME[b.brand] || b.brand) + ' ' + wLabel(b.wk))).join(', ')
    + ' disagreed with the account daily totals, so they were not loaded — what you see for those'
    + ' weeks is the last set that did agree. Run <code>weeklyAudit(0)</code> /'
    + ' <code>weeklyAudit(1)</code> in the Apps Script editor to see which ASINs, then Refresh here'
    + ' to rebuild straight from the Orders workbook.';
  ['wCheckBanner', 'plCheckBanner'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.innerHTML = html;
    el.classList.toggle('hide', !html);
  });
}

// Cells add up field by field. Only the four STORED figures are summed here — every ratio is worked
// out afterwards from the parent's totals, because averaging children's percentages would weight a
// child that sold twice the same as one that sold two thousand.
const W_SUM_FIELDS = ['u', 'rev', 'spend', 'adSales', 'clicks', 'adOrders', 'sessions', 'pv'];
function wAddCell(into, from) {
  W_SUM_FIELDS.forEach(f => {
    if (from[f] == null) return;
    into[f] = (into[f] || 0) + from[f];
  });
  if (into.rev != null) into.rev = Math.round(into.rev * 100) / 100;
  if (into.spend != null) into.spend = Math.round(into.spend * 100) / 100;
  if (into.adSales != null) into.adSales = Math.round(into.adSales * 100) / 100;
}

function wRows() {
  const brand = $('wBrand').value;
  const byParent = $('wView').value === 'parent';
  const q = $('wFilter').value.trim().toLowerCase();

  let out;
  if (byParent) {
    const g = {};
    Object.entries(WEEKLY.rows).forEach(([asin, r]) => {
      const key = wParentOf(asin);
      const o = g[key] || (g[key] = { asin: key, brand: r.brand || '', title: '', weeks: {}, days: {}, kids: 0 });
      o.brand = o.brand || r.brand || '';
      o.kids++;
      // The parent's own name if Amazon or a person gave it one; otherwise borrow a child's title,
      // marked with ~ so nobody reads a borrowed name as the parent's real one.
      if (!o.title) {
        const own = PNAME[o.brand]?.[key]?.v || HEALTH[o.brand]?.parentNames?.[key] || '';
        o.title = own || (wTitle(asin) ? '~ ' + wTitle(asin) : '');
      }
      Object.entries(r.weeks || {}).forEach(([wk, c]) => {
        wAddCell(o.weeks[wk] || (o.weeks[wk] = {}), c);
      });
      // The per-day figures roll up to the parent exactly the same way, so a daily range report
      // groups identically to a weekly one.
      Object.entries((WDAY.rows[asin] || {}).days || {}).forEach(([day, c]) => {
        wAddCell(o.days[day] || (o.days[day] = {}), c);
      });
    });
    out = Object.values(g);
  } else {
    out = Object.entries(WEEKLY.rows).map(([asin, r]) => ({
      asin, brand: r.brand || '', title: wTitle(asin), weeks: r.weeks || {},
      days: (WDAY.rows[asin] || {}).days || {}, kids: 0,
    }));
  }
  out.forEach(r => { r.total = Object.values(r.weeks).reduce((s, c) => s + (c.rev || 0), 0); });

  if (brand !== 'ALL') out = out.filter(r => r.brand === brand);
  if (q) out = out.filter(r => (r.asin + ' ' + r.title).toLowerCase().includes(q));
  // Biggest sellers first — that is the order anybody reads this in.
  out.sort((a, b) => b.total - a.total);
  return out;
}

function renderWeekly() {
  wRenderCheck();
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const nWeeks = Number($('wWeeks').value) || 13;
  const weeks = (WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26)).slice(-nWeeks);
  const mk = $('wMetric').value, M = W_METRIC[mk] || W_METRIC.sales;
  const rows = wRows();

  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const fmt = v => {
    if (v == null) return '<span class="muted">—</span>';
    if (M.pct) return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    if (M.money) return money(v);
    return Math.round(v).toLocaleString('en-US');
  };

  const byParent = $('wView').value === 'parent';
  const head = `<thead><tr><th class="frz">${byParent ? 'Parent ASIN' : 'ASIN'}</th><th class="frz2">Product</th>`
    + (byParent ? '<th class="num">Children</th>' : '') + '<th class="num">Total / Avg</th>'
    + weeks.map(w => {
        const done = wWeekDone(w);
        return `<th class="num" title="${esc(w)} → ${esc(new Date(wDate(w).getTime() + 6 * 86400000).toISOString().slice(0, 10))}${
          done ? '' : ` — still running, ${wDaysIn(w)} of 7 days. Not compared against the week before until it finishes.`}">`
          + `${esc(wLabel(w))}${done ? '' : '<div class="muted" style="font-weight:400;font-size:9.5px">' + wDaysIn(w) + '/7 days</div>'}</th>`;
      }).join('')
    + '</tr></thead>';

  const body = rows.map(r => {
    const cells = weeks.map((w, wi) => {
      const c = r.weeks[w] || {};
      const v = M.get(c);
      if (M.split) {
        if (v == null) return '<td class="num"><span class="muted">—</span></td>';
        const ad = Math.round(v), org = Math.max(0, 100 - ad);
        return `<td class="num" title="Ad ${ad}% · Organic ${org}%"><span class="st st-pending">${ad}%</span> <span class="st st-approved">${org}%</span></td>`;
      }
      if (v == null) return '<td class="num"><span class="muted">—</span></td>';
      const cls = M.band ? ` class="gd ${M.band(v)}"` : '';
      const main = M.band ? `<span${cls}>${fmt(v)}</span>` : fmt(v);

      /* Against the week BEFORE, for the metrics where no fixed threshold means anything. A session
       * count of 8,000 is neither good nor bad; 8,000 after 10,000 is. The FIRST column has nothing
       * to its left, so it is left plain rather than coloured against nothing. */
      let dirTip = '', dirCls = '';
      // A running week is left uncoloured. Its last column would be orange on every row for the only
      // reason that three days is less than seven — a red stripe down the grid that means nothing.
      if (M.wow && wi > 0 && wWeekDone(w)) {
        const pv = M.get(r.weeks[weeks[wi - 1]] || {});
        if (pv != null && pv !== 0) {
          const d = (v - pv) / pv * 100;
          if (Math.abs(d) >= 2) {                      // under 2% is noise, not a move
            dirCls = d > 0 ? ' wow-up' : ' wow-dn';
            dirTip = ` title="${d > 0 ? '+' : ''}${d.toFixed(Math.abs(d) < 10 ? 1 : 0)}% vs ${wLabel(weeks[wi - 1])}"`;
          }
        }
      }

      // The sub-line, when the metric carries one (sales → TACoS).
      const sb = M.sub ? M.sub(c) : null;
      const subHtml = sb ? `<div class="wsub"><span class="gd ${sb.cls}">${esc(sb.txt)}</span></div>` : '';
      return `<td class="num${dirCls}"${dirTip}>${main}${subHtml}</td>`;
    }).join('');

    // The Total column is a SUM for money and units, but an AVERAGE for a ratio — averaging dollars
    // or summing percentages would both be nonsense.
    let tot;
    if (M.pct || M.split) {
      const vals = weeks.map(w => M.get(r.weeks[w] || {})).filter(v => v != null);
      tot = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    } else {
      const vals = weeks.map(w => M.get(r.weeks[w] || {})).filter(v => v != null);
      tot = vals.length ? vals.reduce((s, v) => s + v, 0) : null;
    }
    const totTxt = M.split
      ? (tot == null ? '<span class="muted">—</span>' : `${Math.round(tot)}% / ${Math.round(100 - tot)}%`)
      : fmt(tot);

    return `<tr><td class="frz" style="font-family:ui-monospace,monospace">${esc(r.asin)}</td>`
      + `<td class="frz2" title="${esc(r.title)}">${esc(r.title.slice(0, 34)) || '<span class="muted">—</span>'}</td>`
      + (byParent ? `<td class="num"><span class="muted">${r.kids}</span></td>` : '')
      + `<td class="num" style="font-weight:700">${totTxt}</td>${cells}</tr>`;
  }).join('');

  $('wTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${weeks.length + (byParent ? 4 : 3)}" class="muted" style="padding:14px">Nothing stored yet — hit “Refresh”. The first run backfills the window and takes a while.</td></tr>`)
    + '</tbody>';

  renderWeeklyKpis(rows, weeks);
  renderWeeklyRange();
  renderWeeklyAlerts(rows, weeks);
  renderWeeklyLog();
}

function renderWeeklyKpis(rows, weeks) {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  const money = v => '$' + nf(v);
  const last = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
  const sum = (wk, f) => rows.reduce((s, r) => s + (f(r.weeks[wk] || {}) || 0), 0);
  const sales = sum(last, c => c.rev), spend = sum(last, c => c.spend);
  const adSales = sum(last, c => c.adSales), sess = sum(last, c => c.sessions), units = sum(last, c => c.u);
  const pSales = prev ? sum(prev, c => c.rev) : 0;
  const delta = pSales ? Math.round((sales - pSales) / pSales * 100) : null;
  const tacos = sales ? Math.round(spend / sales * 100) : null;
  const acos = adSales ? Math.round(spend / adSales * 100) : null;
  const cvr = sess ? (units / sess * 100) : null;
  const organicPct = sales ? Math.round((sales - adSales) / sales * 100) : null;
  // Last week's traffic, to say which WAY these moved. A rate on its own does not tell you whether
  // anything is going wrong — 3% CVR is fine or alarming depending entirely on what it was.
  const pSess = prev ? sum(prev, c => c.sessions) : 0;
  const pUnits = prev ? sum(prev, c => c.u) : 0;
  const pCvr = pSess ? (pUnits / pSess * 100) : null;
  const sessD = pSess ? (sess - pSess) / pSess * 100 : null;
  const cvrD = (pCvr && cvr != null) ? (cvr - pCvr) / pCvr * 100 : null;
  /* Green up, red down — and a DASH when there is nothing to compare against, never a green 0%.
   * A week whose sessions were simply never collected would otherwise read as "flat", which is a
   * claim; "we do not know" is the truth. */
  // A running week is not compared at all — see wWeekDone. The number still shows; the judgement waits.
  const done = wWeekDone(last);
  const running = `<span class="muted">week still running · ${wDaysIn(last)} of 7 days</span>`;
  const dir = (d, txt) => !done ? running
    : d == null
      ? `<span class="muted">${txt} · no week before</span>`
      : `<span class="${d >= 0 ? 'up' : 'dn'}">${txt} · ${d > 0 ? '+' : ''}${d.toFixed(d > -10 && d < 10 ? 1 : 0)}%</span>`;

  $('wKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Latest week — ${esc(wLabel(last))}${
      wWeekDone(last) ? '' : ` <span class="muted" style="font-weight:400;font-size:12px">· still running, ${wDaysIn(last)} of 7 days</span>`}</span>
      <span class="kpiwhen">${WEEKLY.at ? 'sales as at ' + esc(WEEKLY.at) : 'not pulled yet'}${
        WEEKLY.adAt ? ' · ads ' + esc(WEEKLY.adAt) : ''}</span></div>
    <div class="metrics">
      <div class="metric">
        <div class="v" style="font-size:15px">${money(sales)}</div><div class="l">Total sales</div>
        <div class="sub" style="color:${done && delta != null && delta < 0 ? 'var(--bad)' : 'inherit'}">${
          !done ? running : delta == null ? '— vs week before' : (delta > 0 ? '+' : '') + delta + '% vs week before'}</div>
        <div class="sub" title="Ad spend ÷ TOTAL sales — what all of the sales cost in advertising.">TACoS <b style="color:${
          tacos != null && tacos > 20 ? 'var(--bad)' : 'inherit'}">${tacos == null ? '—' : tacos + '%'}</b></div>
      </div>
      <div class="metric">
        <div class="v" style="font-size:15px">${money(spend)}</div><div class="l">Ad spend</div>
        <div class="sub" title="Ad spend ÷ AD sales only — what the advertised sales cost.">ACoS <b style="color:${
          acos != null && acos > 60 ? 'var(--bad)' : 'inherit'}">${acos == null ? '—' : acos + '%'}</b></div>
      </div>
      <div class="metric"><div class="v">${organicPct == null ? '—' : organicPct + '%'}</div><div class="l">Organic share</div></div>
      <div class="metric">
        <div class="v" style="font-size:15px">${nf(sess)}</div><div class="l">Sessions</div>
        <div class="sub">${dir(sessD, 'vs week before')}</div>
        <div class="sub">CVR <b>${cvr == null ? '—' : cvr.toFixed(1) + '%'}</b> ${
          !done ? '' : cvrD == null ? '<span class="muted">· no week before</span>'
            : `<span class="${cvrD >= 0 ? 'up' : 'dn'}">· ${cvrD > 0 ? '+' : ''}${cvrD.toFixed(cvrD > -10 && cvrD < 10 ? 1 : 0)}%</span>`}</div>
      </div>
    </div></div>`;
}

/* ---------- range report: one row per parent over a chosen span ---------- */
// The stored data is weekly, so a chosen range SNAPS to whole Sunday→Saturday weeks. Said plainly
// under the date boxes rather than quietly rounded: a total that silently covers different days
// than the dates on screen is the kind of thing that gets found out during an argument.
let W_RANGE_SORT = { k: 'sales', dir: -1 };

/**
 * Has the per-ASIN DAILY ad cache been loaded?
 *
 * Sales and ad figures arrive in the daily store from two different nightly phases, and the ad one
 * finishes hours later. So a day range can legitimately have sales and no spend for a while, and the
 * report needs to be able to say which of the two it is looking at.
 */
function wDayAdsReady() {
  return Object.values(WDAY.rows).some(r =>
    Object.values(r.days || {}).some(c => c.spend != null));
}

/** Every date from `lo` to `hi` inclusive, as yyyy-MM-dd. */
function wDaysBetween(lo, hi) {
  const out = [];
  for (let d = lo; d <= hi; d = sdShift(d, 1)) out.push(d);
  return out;
}

/**
 * Work out how to answer the chosen range, and from which store.
 *
 * Two stores, and which one is used is decided by the dates rather than by a setting:
 *
 *  · Whole Sunday→Saturday weeks go to the WEEKLY store. It is the only one holding sessions, so
 *    keeping whole-week ranges on it means Sessions and CVR still work for the common case.
 *  · Anything else goes to the DAILY store, which the nightly run keeps for a short recent window.
 *    Sessions cannot follow: Amazon aggregates the by-ASIN part of the traffic report over whatever
 *    range you ask for, with no date on it, so per-day sessions would mean one report per day per
 *    brand at roughly one report a minute. Those two columns show a dash instead of a wrong number.
 */
function wRangePlan() {
  const all = WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26);
  const a = $('wFrom').value, b = $('wTo').value;
  if (!a || !b) {
    const wk = all[all.length - 1];
    return { mode: 'week', keys: [wk], prev: [], lo: wk, hi: sdShift(wk, 6) };
  }
  const lo = a <= b ? a : b, hi = a <= b ? b : a;

  // A Sunday start and a Saturday end — the shape the weekly store can answer exactly.
  const wholeWeeks = wKeyOfDate(lo) === lo && wKeyOfDate(sdShift(hi, 1)) === sdShift(hi, 1);
  if (wholeWeeks) {
    const keys = all.filter(w => w >= lo && w <= hi);
    if (keys.length) {
      const firstIx = all.indexOf(keys[0]);
      const prev = firstIx > 0 ? all.slice(Math.max(0, firstIx - keys.length), firstIx) : [];
      return { mode: 'week', keys, prev, lo, hi };
    }
  }

  // Day resolution. Only over the window the nightly run keeps — outside it the honest answer is
  // that there is nothing to show, not a total quietly built from the wrong days.
  const days = wDaysBetween(lo, hi);
  const haveFrom = WDAY.from;
  if (haveFrom && lo >= haveFrom) {
    // The comparison period is the SAME NUMBER OF DAYS immediately before, exactly as the weekly
    // path compares like with like.
    const pHi = sdShift(lo, -1), pLo = sdShift(pHi, -(days.length - 1));
    const prev = pLo >= haveFrom ? wDaysBetween(pLo, pHi) : [];
    return { mode: 'day', keys: days, prev, lo, hi };
  }
  return { mode: 'day', keys: [], prev: [], lo, hi, outside: true, haveFrom };
}

function renderWeeklyRange() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => (v == null ? '<span class="muted">—</span>' : '$' + Math.round(v).toLocaleString('en-US'));
  const pct1 = v => (v == null ? '<span class="muted">—</span>' : (v * 100).toFixed(1) + '%');
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  const plan = wRangePlan();
  const { mode, keys, prev, lo, hi } = plan;
  const byParent = $('wView').value === 'parent';

  if (plan.outside || !keys.length) {
    const stored = WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26);
    $('wRangeNote').textContent = plan.haveFrom
      ? `${lo} → ${hi} is not a whole number of Sun–Sat weeks, and day-by-day figures only go back to `
        + `${plan.haveFrom}. Pick dates inside that, or line the range up with whole weeks to go further back.`
      : `Nothing stored for ${lo} → ${hi}. This tab holds ${stored[0]} onwards — day-by-day figures `
        + `arrive with tonight's run.`;
    $('wRangeTable').innerHTML = '<tbody><tr><td class="muted" style="padding:14px">'
      + 'Nothing stored for the dates you picked.</td></tr></tbody>';
    return;
  }

  const end = mode === 'week'
    ? new Date(wDate(keys[keys.length - 1]).getTime() + 6 * 86400000).toISOString().slice(0, 10)
    : keys[keys.length - 1];
  $('wRangeNote').textContent = (mode === 'week'
      ? `${keys.length} week${keys.length === 1 ? '' : 's'}: ${keys[0]} → ${end}`
      : `${keys.length} day${keys.length === 1 ? '' : 's'}: ${keys[0]} → ${end}`)
    + (prev.length
      ? ` · compared with the ${prev.length} ${mode === 'week' ? 'week' : 'day'}${prev.length === 1 ? '' : 's'} before`
      : ' · nothing stored before this to compare with')
    // Two different absences, and saying only the first one left a table of dashes with no
    // explanation. Sessions can NEVER be daily — Amazon aggregates the by-ASIN traffic report over
    // whatever range you ask for. The ad columns can, but only once the nightly run has built the
    // per-ASIN daily cache, so "not yet" and "not possible" are worth telling apart.
    + (mode === 'day'
      ? ' · day-by-day, so Sessions and CVR are not available'
        + (wDayAdsReady() ? '' : ' · daily ad figures arrive with tonight\'s run — until then Ad Spend, ACOS and Organic stay blank')
      : '');

  const add = (into, r, ks) => ks.forEach(k => {
    const c = mode === 'day' ? (r.days || {})[k] : r.weeks[k];
    if (c) wAddCell(into, c);
  });

  let rows = wRows().map(r => {
    const cur = {}, was = {};
    add(cur, r, keys); add(was, r, prev);
    const sales = cur.rev || 0;
    // UNKNOWN and ZERO are kept apart all the way through. A week whose ad report has not been
    // pulled has `spend`/`adSales` absent, not 0 — and if that were flattened to 0 here, organic
    // would come out equal to total sales and the listing would look like it needs no ads at all.
    // That is a confident lie; a dash is the truth.
    const adSales = cur.adSales == null ? null : cur.adSales;
    const spend = cur.spend == null ? null : cur.spend;
    // Floored at zero: Amazon books an ad sale against the CLICK date, not the order date, so a week
    // can legitimately report more ad sales than total sales. A negative organic figure would be an
    // artefact of that lag, not something anybody should act on.
    const organic = adSales == null ? null : Math.max(0, sales - adSales);
    const prevSales = was.rev || 0;
    return {
      asin: r.asin, title: r.title, kids: r.kids, brand: r.brand,
      units: cur.u || 0, sales, adSpend: spend, adSales, organic,
      sessions: cur.sessions == null ? null : cur.sessions,
      organicShare: (organic != null && sales > 0) ? organic / sales : null,
      acos: (spend != null && adSales > 0) ? spend / adSales : null,
      tacos: (spend != null && sales > 0) ? spend / sales : null,
      cvr: cur.sessions ? (cur.u || 0) / cur.sessions : null,
      prevSales, vsPrev: prevSales > 0 ? (sales - prevSales) / prevSales : null,
    };
  }).filter(r => r.sales || r.units || r.adSpend);

  // Budget share is each parent's slice of the ad spend ACROSS THE VIEW, so it answers "where is the
  // money going" for whatever is on screen — not for a catalogue you have filtered away.
  const totSpend = rows.reduce((s, r) => s + (r.adSpend || 0), 0);
  const anySpend = rows.some(r => r.adSpend != null);
  rows.forEach(r => { r.budgetShare = (r.adSpend != null && totSpend > 0) ? r.adSpend / totSpend : null; });

  const T = rows.reduce((a, r) => ({
    units: a.units + r.units, sales: a.sales + r.sales, spend: a.spend + (r.adSpend || 0),
    adSales: a.adSales + (r.adSales || 0), sessions: a.sessions + (r.sessions || 0), prev: a.prev + r.prevSales,
  }), { units: 0, sales: 0, spend: 0, adSales: 0, sessions: 0, prev: 0 });
  const anyAdSales = rows.some(r => r.adSales != null);
  const tOrganic = anyAdSales ? Math.max(0, T.sales - T.adSales) : null;

  // Sorting by a column that this mode does not have would leave every row equal and no arrow to
  // explain it, so a day range falls back to Sales.
  if (mode !== 'week' && (W_RANGE_SORT.k === 'sessions' || W_RANGE_SORT.k === 'cvr')) {
    W_RANGE_SORT = { k: 'sales', dir: -1 };
  }
  const k = W_RANGE_SORT.k, dir = W_RANGE_SORT.dir;
  rows.sort((a, b) => (typeof a[k] === 'string')
    ? String(a[k] || '').localeCompare(String(b[k] || '')) * dir
    : ((a[k] == null ? -Infinity : a[k]) - (b[k] == null ? -Infinity : b[k])) * dir);

  const COLS = [
    { k: 'asin', t: byParent ? 'Parent ASIN' : 'ASIN', frz: 1 },
    { k: 'title', t: 'Title' },
    { k: 'units', t: 'Units', num: 1 },
    { k: 'sales', t: 'Sales', num: 1 },
    { k: 'adSpend', t: 'Ad Spend', num: 1 },
    { k: 'budgetShare', t: 'Budget Share %', num: 1 },
    { k: 'adSales', t: 'Ad Sales', num: 1 },
    { k: 'organic', t: 'Organic Sales', num: 1 },
    { k: 'organicShare', t: 'Organic %', num: 1 },
    { k: 'acos', t: 'ACOS', num: 1 },
    { k: 'tacos', t: 'TACOS', num: 1 },
    // Sessions and CVR only exist per WEEK — Amazon aggregates the by-ASIN traffic report over
    // whatever range is asked for, with no date on it. On a day range the columns are dropped
    // altogether rather than shown full of dashes: a column that can never have a value in this
    // mode is just noise pushing the useful ones off the screen.
    ...(mode === 'week'
      ? [{ k: 'sessions', t: 'Sessions', num: 1 }, { k: 'cvr', t: 'CVR', num: 1 }]
      : []),
    { k: 'vsPrev', t: 'vs Prev %', num: 1 },
  ];
  const arrow = c => c.k === k ? (dir < 0 ? ' ↓' : ' ↑') : '';
  const head = '<thead><tr>' + COLS.map(c =>
    `<th data-wsort="${c.k}" class="${c.frz ? 'frz ' : ''}${c.num ? 'num' : ''}">${esc(c.t)}${arrow(c)}</th>`).join('')
    + '</tr>'
    + `<tr class="subtot"><th class="frz">TOTAL</th><th>${rows.length} ${byParent ? 'parents' : 'ASINs'}</th>`
    + `<th class="num">${nf(T.units)}</th><th class="num">${money(T.sales)}</th>`
    + `<th class="num">${anySpend ? money(T.spend) : '<span class="muted">—</span>'}</th>`
    + `<th class="num">${anySpend && totSpend > 0 ? '100%' : '<span class="muted">—</span>'}</th>`
    + `<th class="num">${anyAdSales ? money(T.adSales) : '<span class="muted">—</span>'}</th>`
    + `<th class="num">${money(tOrganic)}</th>`
    + `<th class="num">${pct1(tOrganic != null && T.sales > 0 ? tOrganic / T.sales : null)}</th>`
    + `<th class="num">${pct1(anySpend && T.adSales > 0 ? T.spend / T.adSales : null)}</th>`
    + `<th class="num">${pct1(anySpend && T.sales > 0 ? T.spend / T.sales : null)}</th>`
    + (mode === 'week'
      ? `<th class="num">${T.sessions ? nf(T.sessions) : '—'}</th>`
        + `<th class="num">${T.sessions ? ((T.units / T.sessions) * 100).toFixed(1) + '%' : '—'}</th>`
      : '')
    + `<th class="num">${pct1(T.prev > 0 ? (T.sales - T.prev) / T.prev : null)}</th></tr></thead>`;

  const shareCls = v => v == null ? '' : v >= 0.5 ? 'gd-good' : v >= 0.25 ? 'gd-warn' : 'gd-bad';
  const body = rows.slice(0, 300).map(r => `<tr>`
    + `<td class="frz" style="font-family:ui-monospace,monospace">${esc(r.asin)}</td>`
    + `<td title="${esc(r.title)}">${esc(String(r.title || '').slice(0, 34)) || '<span class="muted">—</span>'}</td>`
    + `<td class="num">${nf(r.units)}</td>`
    + `<td class="num" style="font-weight:700">${money(r.sales)}</td>`
    + `<td class="num"${r.adSpend == null ? ' title="No ad report has been pulled for this range yet"' : ''}>${money(r.adSpend)}</td>`
    + `<td class="num" style="color:#6d28d9;font-weight:600">${pct1(r.budgetShare)}</td>`
    + `<td class="num"><span class="muted">${r.adSales == null ? '—' : '$' + Math.round(r.adSales).toLocaleString('en-US')}</span></td>`
    + `<td class="num" style="font-weight:600"${r.organic == null ? ' title="Needs the ad figures — organic is total sales minus ad sales, and the ad side is not in yet"' : ''}>${money(r.organic)}</td>`
    + `<td class="num">${r.organicShare == null ? '<span class="muted">—</span>' : `<span class="gd ${shareCls(r.organicShare)}">${(r.organicShare * 100).toFixed(1)}%</span>`}</td>`
    + `<td class="num">${pct1(r.acos)}</td>`
    + `<td class="num" style="color:#166534">${pct1(r.tacos)}</td>`
    + (mode === 'week'
      ? `<td class="num">${r.sessions == null ? '<span class="muted">—</span>' : nf(r.sessions)}</td>`
        + `<td class="num">${r.cvr == null ? '<span class="muted">—</span>' : (r.cvr * 100).toFixed(1) + '%'}</td>`
      : '')
    + `<td class="num"${r.vsPrev != null && r.vsPrev < 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>${
        r.vsPrev == null ? '<span class="muted">—</span>' : (r.vsPrev > 0 ? '+' : '') + (r.vsPrev * 100).toFixed(1) + '%'}</td>`
    + `</tr>`).join('');

  $('wRangeTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${COLS.length}" class="muted" style="padding:14px">Nothing in this range — hit “Refresh”, or widen the dates.</td></tr>`)
    + '</tbody>';

  // Pin the TOTAL row directly under the title row. Measured in rAF, not synchronously: reading a
  // height here would force a full layout of the table that was just inserted.
  requestAnimationFrame(() => {
    const t = $('wRangeTable').querySelector('thead tr:first-child th');
    const top = (t ? Math.round(t.getBoundingClientRect().height) : 0) || 34;
    $('wRangeTable').querySelectorAll('thead tr.subtot th').forEach(th => { th.style.top = top + 'px'; });
  });
}

/* ---------- alerts ---------- */
// Thresholds are deliberately blunt: a 30% fall is worth a look, a 10% one is noise. The point is a
// short list somebody actually reads, not every wobble in the data.
const W_ALERT = { drop: 30, organic: 30, sessions: 30, acos: 60 };

function renderWeeklyAlerts(rows, weeks) {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const pctDrop = (now, was) => (was > 0 ? Math.round((now - was) / was * 100) : null);
  const out = [];

  rows.forEach(r => {
    for (let i = 1; i < weeks.length; i++) {
      const c = r.weeks[weeks[i]], p = r.weeks[weeks[i - 1]];
      if (!c || !p) continue;
      const flags = [];
      const dSales = pctDrop(c.rev || 0, p.rev || 0);
      // "Sold nothing this week after selling last week" is a different, louder fact than a fall.
      if ((p.rev || 0) > 0 && !(c.rev > 0)) flags.push('SALES ZERO');
      else if (dSales != null && dSales <= -W_ALERT.drop) flags.push(`SALES ▼${Math.abs(dSales)}%`);
      const dSpend = pctDrop(c.spend || 0, p.spend || 0);
      if (dSpend != null && dSpend <= -W_ALERT.drop) flags.push(`SPEND ▼${Math.abs(dSpend)}%`);
      const cOrg = wOrganic(c), pOrg = wOrganic(p);
      const dOrg = (cOrg != null && pOrg != null) ? pctDrop(cOrg, pOrg) : null;
      if (dOrg != null && dOrg <= -W_ALERT.organic) flags.push(`ORGANIC ▼${Math.abs(dOrg)}%`);
      const dSess = pctDrop(c.sessions || 0, p.sessions || 0);
      if (dSess != null && dSess <= -W_ALERT.sessions) flags.push(`SESSIONS ▼${Math.abs(dSess)}%`);
      const acos = (c.spend != null && c.adSales) ? Math.round(c.spend / c.adSales * 100) : null;
      if (acos != null && acos >= W_ALERT.acos) flags.push(`ACoS ${acos}%`);
      if (!flags.length) continue;
      out.push({ r, wk: weeks[i], c, p, flags, dSales: dSales == null ? 0 : dSales, acos });
    }
  });
  // Worst first, and only the most recent weeks matter most — sort by severity of the sales fall.
  out.sort((a, b) => (a.dSales - b.dSales) || (b.c.rev || 0) - (a.c.rev || 0));

  const byParent = $('wView').value === 'parent';
  const cols = [byParent ? 'Parent ASIN' : 'ASIN', 'Product', 'Week', 'Sales', 'Prev', 'Δ%',
    'Ad spend', 'Prev', 'Ad sales', 'Organic', 'Organic %', 'Org Δ%', 'Sessions', 'ACoS', 'Likely cause', 'Flags'];
  const NUM = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const head = '<thead><tr>' + cols.map((h, i) =>
    `<th${i === 0 ? ' class="frz"' : (NUM.has(i) ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';

  const body = out.slice(0, 200).map(x => {
    const d = x.dSales;
    const org = wOrganic(x.c), pOrg = wOrganic(x.p);
    const orgPct = (org != null && x.c.rev) ? Math.round(org / x.c.rev * 100) : null;
    const dOrg = (org != null && pOrg > 0) ? Math.round((org - pOrg) / pOrg * 100) : null;
    const cause = wCause(x);
    return `<tr><td class="frz" style="font-family:ui-monospace,monospace">${esc(x.r.asin)}</td>`
      + `<td title="${esc(x.r.title)}">${esc(x.r.title.slice(0, 28)) || '<span class="muted">—</span>'}</td>`
      + `<td>${esc(wLabel(x.wk))}</td>`
      + `<td class="num">${money(x.c.rev)}</td><td class="num"><span class="muted">${money(x.p.rev)}</span></td>`
      + `<td class="num"${d < 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>${d ? (d > 0 ? '+' : '') + d + '%' : '—'}</td>`
      + `<td class="num">${x.c.spend == null ? '<span class="muted">—</span>' : money(x.c.spend)}</td>`
      + `<td class="num"><span class="muted">${x.p.spend == null ? '—' : money(x.p.spend)}</span></td>`
      + `<td class="num">${x.c.adSales == null ? '<span class="muted">—</span>' : money(x.c.adSales)}</td>`
      + `<td class="num"${org != null ? ' style="font-weight:700"' : ''}>${org == null ? '<span class="muted">—</span>' : money(org)}</td>`
      // Organic share is the number that says whether the listing stands on its own. A high one is
      // the goal; a collapsing one means ads are the only thing still selling it.
      + `<td class="num">${orgPct == null ? '<span class="muted">—</span>'
          : `<span class="gd ${orgPct >= 50 ? 'gd-good' : orgPct >= 25 ? 'gd-warn' : 'gd-bad'}">${orgPct}%</span>`}</td>`
      + `<td class="num"${dOrg != null && dOrg < 0 ? ' style="color:var(--bad)"' : ''}>${dOrg == null ? '<span class="muted">—</span>' : (dOrg > 0 ? '+' : '') + dOrg + '%'}</td>`
      + `<td class="num">${x.c.sessions == null ? '<span class="muted">—</span>' : Math.round(x.c.sessions).toLocaleString('en-US')}</td>`
      + `<td class="num">${x.acos == null ? '<span class="muted">—</span>' : x.acos + '%'}</td>`
      + `<td title="${esc(cause.why)}"><span class="st ${cause.cls}">${esc(cause.t)}</span></td>`
      + `<td>${x.flags.map(f => `<span class="st ${/ZERO|ACoS/.test(f) ? 'st-rejected' : 'st-pending'}" style="margin-right:3px">${esc(f)}</span>`).join('')}</td></tr>`;
  }).join('');

  $('wAlerts').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${cols.length}" class="muted" style="padding:14px">Nothing is falling by more than ${W_ALERT.drop}% week on week. 🎉</td></tr>`)
    + '</tbody>';
}

/**
 * Why the week went the way it did — the "Spend-driven. Restore Catch All budget." line from the
 * sheet, worked out rather than typed.
 *
 * The order of the tests IS the reasoning. Spend is checked first because it is the one thing that
 * was definitely somebody's decision: if the budget was cut and sales fell with it, no further
 * explanation is needed. Only when spend held do we ask whether the traffic left (a ranking or
 * impression problem) or whether the same traffic stopped buying (a listing or price problem).
 *
 * Where the data needed to tell those apart is missing, it says so instead of picking one — a
 * confident wrong diagnosis costs more than an honest "not enough data".
 */
function wCause(x) {
  const c = x.c, p = x.p;
  const rel = (now, was) => (was > 0 ? (now - was) / was * 100 : null);
  const dSpend = rel(c.spend || 0, p.spend || 0);
  const dSess = (c.sessions != null && p.sessions != null) ? rel(c.sessions, p.sessions) : null;
  const cvr = k => (k.sessions ? k.u / k.sessions : null);
  const dCvr = (cvr(c) != null && cvr(p)) ? rel(cvr(c), cvr(p)) : null;
  const soldNothing = (p.rev || 0) > 0 && !(c.rev > 0);

  if (x.acos != null && x.acos >= W_ALERT.acos && !(x.dSales <= -W_ALERT.drop)) {
    return { t: 'Ads not paying', cls: 'st-rejected',
      why: `ACoS ${x.acos}% — the ads are spending more than they bring back. Sales themselves are not the problem; the campaign structure or bids are.` };
  }
  if (soldNothing) {
    return { t: 'Sold nothing', cls: 'st-rejected',
      why: `Sold ${'$' + Math.round(p.rev).toLocaleString('en-US')} the week before and nothing this week. Check stock first — an out-of-stock listing looks exactly like this.` };
  }
  if (x.dSales > -W_ALERT.drop) {
    return { t: 'Watch', cls: 'st-pending', why: 'Flagged on something other than a big sales fall — see the flags column.' };
  }
  if (dSpend != null && dSpend <= -W_ALERT.drop) {
    return { t: 'Spend-driven', cls: 'st-rejected',
      why: `Ad spend fell ${Math.abs(Math.round(dSpend))}% and sales fell ${Math.abs(Math.round(x.dSales))}% with it. The budget was cut — restore it and see whether sales come back before looking anywhere else.` };
  }
  if (dSess == null) {
    return { t: 'Need sessions', cls: 'st-draft',
      why: 'Spend held, so this is either lost traffic or lost conversion — and those need opposite fixes. Sessions for this week have not been pulled, so the app will not guess. Refresh with sessions included.' };
  }
  if (dSess <= -W_ALERT.sessions) {
    return { t: 'Traffic-driven', cls: 'st-rejected',
      why: `Spend held but sessions fell ${Math.abs(Math.round(dSess))}%. Fewer people are reaching the listing at all — look at keyword ranking, impressions and whether a competitor moved above you.` };
  }
  if (dCvr != null && dCvr <= -20) {
    return { t: 'Conversion-driven', cls: 'st-rejected',
      why: `Traffic held but conversion fell ${Math.abs(Math.round(dCvr))}%. The same people came and stopped buying — price, main image, reviews, a return badge, or a stock/delivery message.` };
  }
  return { t: 'Unexplained', cls: 'st-draft',
    why: 'Spend, sessions and conversion all held, yet sales fell. Worth opening the listing itself — this is the pattern of a price change, a buy-box loss or a seasonal drop.' };
}

/* ---------- change log ---------- */
let W_LOG_EDIT = null;

function renderWeeklyLog() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => (v == null ? '<span class="muted">—</span>' : '$' + Math.round(v).toLocaleString('en-US'));
  const cols = ['Date', 'ASIN', 'Product', 'Type', 'What changed', 'Why', 'Sales before', 'Sales after', 'Δ%',
    'Sessions before', 'Sessions after', 'CVR before', 'CVR after', 'Result / notes'];
  const head = '<thead><tr>' + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';

  const entries = [...W_LOG].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const body = entries.map((e, i) => {
    // The before/after pair is worked out from the stored weeks, never typed: a hand-typed figure
    // drifts away from the data the moment either side is refreshed.
    const wk = wKeyOfDate(e.date || '');
    const row = WEEKLY.rows[String(e.asin || '').toUpperCase()];
    const cur = row?.weeks?.[wk] || null;
    const prevKey = wk ? new Date(wDate(wk).getTime() - 7 * 86400000).toISOString().slice(0, 10) : '';
    const prev = row?.weeks?.[prevKey] || null;
    const cvr = c => (c && c.sessions ? c.u / c.sessions * 100 : null);
    const d = (prev?.rev > 0 && cur) ? Math.round(((cur.rev || 0) - prev.rev) / prev.rev * 100) : null;
    return `<tr data-wlog="${i}" style="cursor:pointer">`
      + `<td class="frz">${esc(e.date || '')}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(e.asin || '')}</td>`
      + `<td title="${esc(wTitle(String(e.asin || '').toUpperCase()))}">${esc(wTitle(String(e.asin || '').toUpperCase()).slice(0, 26)) || '<span class="muted">—</span>'}</td>`
      + `<td><span class="st st-draft">${esc(e.type || '')}</span></td>`
      + `<td title="${esc(e.what || '')}">${esc(String(e.what || '').slice(0, 48))}</td>`
      + `<td title="${esc(e.why || '')}">${esc(String(e.why || '').slice(0, 32))}</td>`
      + `<td class="num">${money(prev?.rev)}</td><td class="num">${money(cur?.rev)}</td>`
      + `<td class="num"${d != null && d < 0 ? ' style="color:var(--bad);font-weight:700"' : ''}>${d == null ? '—' : (d > 0 ? '+' : '') + d + '%'}</td>`
      + `<td class="num">${prev?.sessions == null ? '<span class="muted">—</span>' : Math.round(prev.sessions).toLocaleString('en-US')}</td>`
      + `<td class="num">${cur?.sessions == null ? '<span class="muted">—</span>' : Math.round(cur.sessions).toLocaleString('en-US')}</td>`
      + `<td class="num">${cvr(prev) == null ? '<span class="muted">—</span>' : cvr(prev).toFixed(1) + '%'}</td>`
      + `<td class="num">${cvr(cur) == null ? '<span class="muted">—</span>' : cvr(cur).toFixed(1) + '%'}</td>`
      + `<td title="${esc(e.note || '')}">${esc(String(e.note || '').slice(0, 48))}</td></tr>`;
  }).join('');

  $('wLog').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${cols.length}" class="muted" style="padding:14px">No entries yet. Record a change here and the before/after figures fill themselves in.</td></tr>`)
    + '</tbody>';
}

function openWeeklyLog(ix) {
  const e = ix == null ? { date: new Date().toISOString().slice(0, 10) } : ([...W_LOG].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))))[ix];
  W_LOG_EDIT = ix == null ? null : W_LOG.indexOf(e);
  $('wlDate').value = e.date || '';
  $('wlAsin').value = e.asin || '';
  $('wlType').value = e.type || 'PPC Campaign';
  $('wlWhat').value = e.what || '';
  $('wlWhy').value = e.why || '';
  $('wlNote').value = e.note || '';
  $('wlMsg').textContent = '';
  $('wlDelete').classList.toggle('hide', W_LOG_EDIT == null);
  $('wLogModal').classList.remove('hide');
  $('wlAsin').focus();
}

/* ---------- wiring ---------- */
['wBrand', 'wView', 'wMetric', 'wWeeks'].forEach(id => $(id).addEventListener('change', renderWeekly));

// The dates are taken exactly as picked. They used to be snapped onto whole weeks because that was
// all the stored data could answer; now a range that is not whole weeks is answered day by day
// instead, and wRangePlan decides which store to use.
['wFrom', 'wTo'].forEach(id => $(id).addEventListener('change', () => {
  W_RANGE_TOUCHED = true;
  renderWeeklyRange();
}));

// Week columns vs one row per parent over a span — the same numbers, two questions. "How is this
// trending" and "what did this period cost me" are rarely asked at the same moment, so only one is
// on screen at a time.
function wSetMode(range) {
  $('wModeGrid').classList.toggle('on', !range);
  $('wModeRange').classList.toggle('on', range);
  $('wGridCard').classList.toggle('hide', range);
  $('wRangeCard').classList.toggle('hide', !range);
  document.querySelectorAll('#paneWeekly .rangeOnly').forEach(el => el.classList.toggle('hide', !range));
  if (range) renderWeeklyRange();
}
$('wModeGrid').onclick = () => wSetMode(false);
$('wModeRange').onclick = () => wSetMode(true);
$('wRangeTable').addEventListener('click', e => {
  const th = e.target.closest('[data-wsort]'); if (!th) return;
  const k = th.dataset.wsort;
  W_RANGE_SORT = { k, dir: W_RANGE_SORT.k === k ? -W_RANGE_SORT.dir : (k === 'asin' || k === 'title' ? 1 : -1) };
  renderWeeklyRange();
});
let W_FILTER_T = null;
$('wFilter').addEventListener('input', () => { clearTimeout(W_FILTER_T); W_FILTER_T = setTimeout(renderWeekly, 250); });
$('wRefresh').onclick = weeklyRefresh;
$('wLogAdd').onclick = () => openWeeklyLog(null);
$('wLog').addEventListener('click', e => {
  const tr = e.target.closest('[data-wlog]'); if (!tr) return;
  openWeeklyLog(Number(tr.dataset.wlog));
});
$('wlCancel').onclick = () => { $('wLogModal').classList.add('hide'); W_LOG_EDIT = null; };
$('wlSave').onclick = async () => {
  const entry = {
    date: $('wlDate').value.trim(),
    asin: $('wlAsin').value.trim().toUpperCase(),
    type: $('wlType').value,
    what: $('wlWhat').value.trim(),
    why: $('wlWhy').value.trim(),
    note: $('wlNote').value.trim(),
    by: ME.email,
  };
  if (!entry.date || !entry.asin) { $('wlMsg').textContent = 'A date and an ASIN are needed.'; return; }
  if (W_LOG_EDIT == null) W_LOG.push(entry); else W_LOG[W_LOG_EDIT] = entry;
  $('wLogModal').classList.add('hide'); W_LOG_EDIT = null;
  renderWeeklyLog();
  try { await saveWeeklyLog(); wMsg('Change log saved.'); }
  catch (e) { wMsg('Could not save the change log: ' + (e.message || e), true); }
};
$('wlDelete').onclick = async () => {
  if (W_LOG_EDIT == null) return;
  if (!confirm('Delete this change-log entry?')) return;
  W_LOG.splice(W_LOG_EDIT, 1);
  $('wLogModal').classList.add('hide'); W_LOG_EDIT = null;
  renderWeeklyLog();
  try { await saveWeeklyLog(); } catch (e) { wMsg('Could not save: ' + (e.message || e), true); }
};
$('wExport').onclick = () => {
  const weeks = (WEEKLY.weeks.length ? WEEKLY.weeks : wWeeksList(26)).slice(-(Number($('wWeeks').value) || 13));
  const M = W_METRIC[$('wMetric').value] || W_METRIC.sales;
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['ASIN', 'Product', 'Brand', ...weeks.map(wLabel)].map(cell).join(',')];
  wRows().forEach(r => lines.push([r.asin, r.title, BRAND_NAME[r.brand] || '',
    ...weeks.map(w => { const v = M.get(r.weeks[w] || {}); return v == null ? '' : (M.pct ? v.toFixed(1) : Math.round(v)); })]
    .map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `ppc-organic-${$('wMetric').value}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};


