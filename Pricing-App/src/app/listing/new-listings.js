/* ================= LISTING · NEW LISTINGS: which listings are new, and how each one is doing (24 Nov 2026) =================
 * Screens: the Dashboard's "New listings" card (core/dashboard.js, cNew) and Listing Health's level filter "New (30 days)" /
 *          "New (7 days)" (listing-health-data.js renderHealth: nlHealthPick picks the rows, nlHealthDefs gives the table).
 * Does: one answer for both screens, read-only, from data Sellora already holds:
 *   THE FIRST-LISTED DATE of each listing (Listing Health's rows: HEALTH), best source first, and which one was used:
 *     1. Amazon's own date — the Listings Items API's createdDate in the ListingMatch cache (lmGet(sku).cr), and the All Listings
 *        report's open-date in the Listing Health snapshot (row.opened); the earlier of the two when both are there;
 *     2. else the first Sellora snapshot the listing appeared in — a row the listing cache added after the Listing Health snapshot
 *        (row.lmAdded) was not in that snapshot, so it was listed AFTER it: the date is "after <snapshot day>" (a bound, never a
 *        guessed day) — used only when Listing History has no Create Listing date for it;
 *     3. else Listing History: the first send from Create Listing for that SKU (LH rows, screen 'Create Listing').
 *     A listing with none of these is "date not known" — never counted as new.
 *   NOT NEW (a relisting): the SKU or its product was there before its date — another SKU on the same ASIN listed earlier, the ASIN
 *     sold before that date (the nightly per-day cache dailyAsin, or the PPC & Organic weekly store), or a Listing History send for the
 *     SKU before it. Kept in res.relisted with the reason, never in the counts.
 *   STATUS: selling = 1+ unit since listed · live, no sale yet = live (BUYABLE + stock > 0, Family check's rule; the report's Active
 *     when the cache has not read the listing) with no unit · not live yet = not active / inbound / no stock. Units and $ since listed
 *     come from dailyAsin when it reaches back to the listed day, else from the weekly store (weeks from the listed week on).
 *   NEEDS HELP (Listing Health only): not live after 7 days · no sale after 14 days · fewer than 6 images.
 * Loads (read-only): nlLoadLh (the newest Listing History documents, back ~9 weeks), viLoad (dailyAsin + the weekly store).
 * Main functions: nlCompute (pure), nlInput, nlNow, nlSummary, nlLoad, nlHealthPick, nlHealthDefs, nlHealthEnsure. */

const NL_WINDOWS = [7, 30];                     // the card's two windows (days, today counted as day 0)
const NL_WEEKS = 8;                             // the card's bars: new listings per week, the last 8 weeks
const NL_HELP = { live: 7, sale: 14, images: 6 };
const NL_LH_SCREEN = /^Create Listing/;
const NL = { lh: null, lhP: null, memo: null, sig: null, ensureP: null };
const NL_PT = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch (e) { return null; } })();
const nlAdd = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const nlDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const nlWeekOf = iso => nlAdd(iso, -new Date(iso + 'T00:00:00Z').getUTCDay());          // the Sunday starting its week (wKeyOfDate)
// A moment as the marketplace's day (PT): an ISO time with a clock ('…T…Z') is converted; a plain day is kept as it is.
function nlPtDay(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || v instanceof Date) {
    const ms = typeof v === 'number' ? v : v.getTime();
    if (!isFinite(ms) || !ms) return '';
    return NL_PT ? NL_PT.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const ms = Date.parse(s); if (isFinite(ms)) return nlPtDay(ms); }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}
const nlDayText = iso => { const d = new Date(iso + 'T00:00:00Z'); return isNaN(d) ? '' : d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; };

/** THE ANSWER, from plain inputs (tests call it with fixtures):
 *  inp = { today, brands, rows: { b: [listing rows] }, snapAt: { b: ms | Date | null }, lm(b, sku) → { cr, as } | null, lh: [rows] | null,
 *          daily: { d: { ASIN: { day: [units, $] } }, from, upTo } | null, weekly: { rows: { ASIN: { brand, weeks: { wk: { u, rev } } } }, at } | null }
 *  → { today, weeks, first, items, relisted, undated, src: { amazon, snapshot, lh }, salesAt } — items newest first, each
 *  { brand, sku, asin, parent, title, date, approx, after, src, srcText, days, live, stock, status, units, rev, salesSrc, state }. */
function nlCompute(inp) {
  const today = inp.today;
  const weeks = [];
  for (let i = NL_WEEKS - 1; i >= 0; i--) weeks.push(nlAdd(nlWeekOf(today), -7 * i));
  const first = weeks[0];                                                        // nothing older than the first bar's Sunday is looked at
  // Listing History, per listing: the first Create Listing send, and the first send of any kind
  const lhCreate = new Map(), lhAny = new Map();
  (inp.lh || []).forEach(r => {
    if (!r || !r.sku || !r.brand || r.result === 'notsent') return;
    const k = r.brand + '|' + r.sku, day = nlPtDay(r.at);
    if (!day) return;
    if (!lhAny.has(k) || day < lhAny.get(k)) lhAny.set(k, day);
    if (NL_LH_SCREEN.test(String(r.screen || '')) && (!lhCreate.has(k) || day < lhCreate.get(k))) lhCreate.set(k, day);
  });
  // sales per ASIN (upper case), as the two stores key them
  const daily = inp.daily && inp.daily.d ? inp.daily : null;
  const dByAsin = new Map();
  if (daily) Object.keys(daily.d).forEach(a => dByAsin.set(String(a).toUpperCase(), daily.d[a] || {}));
  const dFrom = daily ? String(daily.from || Object.values(daily.d).flatMap(o => Object.keys(o || {})).sort()[0] || '') : '';
  const wRows = inp.weekly && inp.weekly.rows ? inp.weekly.rows : null;
  const wByAsin = new Map();
  if (wRows) Object.keys(wRows).forEach(a => wByAsin.set(String(a).toUpperCase(), wRows[a] || {}));
  // the sales of an ASIN from day `from` on (null: no store holds that ASIN's days) and whether it sold before day `before`
  const salesOf = (asin, from) => {
    const A = String(asin || '').toUpperCase();
    if (daily && dFrom && dFrom <= from) {
      const by = dByAsin.get(A) || {};
      let u = 0, rev = 0;
      Object.keys(by).forEach(day => { if (day >= from) { u += Number((by[day] || [])[0]) || 0; rev += Number((by[day] || [])[1]) || 0; } });
      return { u, rev: Math.round(rev * 100) / 100, src: 'daily', at: daily.upTo || '' };
    }
    if (wRows) {
      const wk0 = nlWeekOf(from), row = wByAsin.get(A);
      let u = 0, rev = 0;
      Object.entries((row && row.weeks) || {}).forEach(([wk, c]) => { if (wk >= wk0 && c) { u += Number(c.u) || 0; rev += Number(c.rev) || 0; } });
      return { u, rev: Math.round(rev * 100) / 100, src: 'weekly', at: (inp.weekly && inp.weekly.at) || '' };
    }
    return null;
  };
  const soldBefore = (asin, day) => {
    const A = String(asin || '').toUpperCase();
    const by = dByAsin.get(A);
    if (by) { const hit = Object.keys(by).sort().find(d => d < day && ((Number((by[d] || [])[0]) || 0) > 0 || (Number((by[d] || [])[1]) || 0) > 0)); if (hit) return 'it sold on ' + nlDayText(hit) + ', before that date'; }
    const row = wByAsin.get(A);
    if (row && row.weeks) {
      const hit = Object.keys(row.weeks).sort().find(wk => nlAdd(wk, 6) < day && ((Number(row.weeks[wk].u) || 0) > 0 || (Number(row.weeks[wk].rev) || 0) > 0));
      if (hit) return 'it sold in the week of ' + nlDayText(hit) + ', before that date';
    }
    return '';
  };
  // every listing: its date and where it came from
  const all = [];
  let undated = 0;
  (inp.brands || []).forEach(b => {
    const snapDay = nlPtDay(inp.snapAt && inp.snapAt[b]);
    ((inp.rows && inp.rows[b]) || []).forEach(row => {
      if (!row || !row.sku) return;
      const m = typeof inp.lm === 'function' ? inp.lm(b, row.sku) : null;
      const cr = nlPtDay(m && m.cr), od = nlPtDay(row.opened);
      const k = b + '|' + row.sku;
      let date = '', after = '', src = '', srcText = '';
      if (cr || od) {
        date = cr && od ? (cr < od ? cr : od) : cr || od;
        src = 'amazon';
        srcText = date === cr ? 'Amazon create date' : 'Amazon open date';
      } else if (lhCreate.has(k)) {
        date = lhCreate.get(k); src = 'lh'; srcText = 'Listing History · Create Listing';
      } else if (row.lmAdded && snapDay) {
        after = snapDay; src = 'snapshot'; srcText = `first seen by Sellora after the ${nlDayText(snapDay)} snapshot`;
      } else { undated++; return; }
      all.push({ brand: b, sku: row.sku, asin: String(row.asin || ''), parent: row.parent || '', title: String(row.title || ''), row, m,
        date, after, approx: !date, src, srcText, day: date || nlAdd(after, 1) });
    });
  });
  // the first listed SKU of each ASIN (per brand): a later SKU on the same product is not a new listing
  const firstOfAsin = new Map();
  all.forEach(it => {
    if (!it.asin) return;
    const k = it.brand + '|' + it.asin.toUpperCase(), was = firstOfAsin.get(k);
    if (!was || it.day < was.day || (it.day === was.day && it.sku < was.sku)) firstOfAsin.set(k, it);
  });
  const items = [], relisted = [];
  const src = { amazon: 0, snapshot: 0, lh: 0 };
  all.forEach(it => {
    if (it.approx ? it.after < nlAdd(first, -1) : it.day < first) return;                    // older than the eight weeks
    const why = (() => {
      const f = it.asin && firstOfAsin.get(it.brand + '|' + it.asin.toUpperCase());
      if (f && f !== it) return `the same product (${it.asin}) was listed earlier as ${f.sku}${f.date ? ' on ' + nlDayText(f.date) : ''}`;
      const checkDay = it.approx ? it.after : it.day;
      const sold = it.asin ? soldBefore(it.asin, checkDay) : '';
      if (sold) return sold;
      const lh = lhAny.get(it.brand + '|' + it.sku);
      if (lh && lh < nlAdd(checkDay, -1)) return `Listing History has a send for it on ${nlDayText(lh)}, before that date`;
      return '';
    })();
    if (why) { relisted.push({ brand: it.brand, sku: it.sku, asin: it.asin, date: it.date, after: it.after, why }); return; }
    const row = it.row;
    const stock = row.qty == null ? null : Number(row.qty);
    const amzSt = it.m && it.m.as ? String(it.m.as) : '';
    const live = amzSt ? /BUYABLE/.test(amzSt) && stock != null && stock > 0
      : /active/i.test(row.status || '') && !/inactive/i.test(row.status || '') && stock != null && stock > 0;
    const s = it.asin ? salesOf(it.asin, it.approx ? nlAdd(it.after, 1) : it.date) : null;
    const units = s ? s.u : null;
    const state = units != null && units >= 1 ? 'selling' : units == null ? 'nodata' : live ? 'nosale' : 'notlive';
    src[it.src]++;
    items.push({ brand: it.brand, sku: it.sku, asin: it.asin, parent: it.parent, title: it.title, date: it.date, after: it.after, approx: it.approx,
      src: it.src, srcText: it.srcText, days: it.approx ? null : nlDiff(today, it.date), maxDays: it.approx ? nlDiff(today, it.after) - 1 : null,
      live, stock, status: amzSt || row.status || '', units, rev: s ? s.rev : null, salesSrc: s ? s.src : '', salesAt: s ? s.at : '', state });
  });
  items.sort((a, b) => (b.date || b.after).localeCompare(a.date || a.after) || a.sku.localeCompare(b.sku));
  return { today, weeks, first, items, relisted, undated, src, salesAt: daily ? daily.upTo || '' : (inp.weekly && inp.weekly.at) || '' };
}
// Listed inside the last n days (today = day 0)? A listing known only as "after <snapshot day>" when that day is inside the window.
const nlIn = (it, n) => (it.approx ? it.maxDays != null && it.maxDays < n : it.days != null && it.days >= 0 && it.days < n);

/** The card's numbers for some brands and one window: { n, selling, nosale, notlive, nodata, top, bars, ... } (plain, kept in this browser). */
function nlSummary(res, brands, n) {
  const mine = res.items.filter(it => brands.includes(it.brand));
  const list = mine.filter(it => nlIn(it, n));
  const c = { selling: 0, nosale: 0, notlive: 0, nodata: 0 };
  list.forEach(it => { c[it.state]++; });
  const top = list.filter(it => it.units > 0).sort((a, b) => b.units - a.units || b.rev - a.rev)[0] || null;
  const bars = res.weeks.map(wk => ({ wk, n: mine.filter(it => !it.approx && it.date >= wk && it.date <= nlAdd(wk, 6)).length }));
  const used = [...new Set(list.map(it => it.src))];
  return Object.assign({ n: list.length, top: top ? { name: top.title || top.sku, sku: top.sku, units: top.units, rev: top.rev } : null, bars,
    approx: list.filter(it => it.approx).length, relisted: res.relisted.filter(r => brands.includes(r.brand)).length, srcUsed: used,
    salesAt: res.salesAt }, c);
}

/* ----- the inputs, as the screens hold them ----- */
function nlInput() {
  const W = typeof WEEKLY !== 'undefined' && WEEKLY.weeks && WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length ? WEEKLY
    : (typeof DASH !== 'undefined' && DASH.weekly) || (typeof VI !== 'undefined' && VI.data && VI.data.weekly) || null;
  const lhRows = typeof LH !== 'undefined' && Array.isArray(LH.rows) && !LH.loading && !LH.err ? LH.rows : NL.lh;
  const brands = ['SP', 'CPC'].filter(b => HEALTH[b] && Array.isArray(HEALTH[b].rows));
  return { today: sdToday(), brands, rows: Object.fromEntries(brands.map(b => [b, HEALTH[b].rows])),
    snapAt: Object.fromEntries(brands.map(b => [b, HEALTH[b].at || null])),
    lm: (b, sku) => (typeof lmGet === 'function' ? lmGet(sku, b) : null), lh: lhRows,
    daily: typeof VI !== 'undefined' && VI.data ? VI.data.days : null, weekly: W };
}
/** The answer now (kept until an input changes); null until Listing Health's rows are in. */
function nlNow() {
  if (typeof H_LOADED === 'undefined' || !H_LOADED || !['SP', 'CPC'].some(b => HEALTH[b] && HEALTH[b].rows)) return null;
  const inp = nlInput();
  const sig = [inp.today, HEALTH.SP && HEALTH.SP.rows, HEALTH.CPC && HEALTH.CPC.rows, inp.lh, inp.daily, inp.weekly, inp.weekly && inp.weekly.rows,
    typeof lmVersion === 'function' ? lmVersion() : 0, typeof LM !== 'undefined' ? LM.ov : 0];
  if (NL.memo && NL.sig && NL.sig.length === sig.length && NL.sig.every((x, i) => x === sig[i])) return NL.memo;
  NL.sig = sig;
  NL.memo = nlCompute(inp);
  return NL.memo;
}

/* ----- loading, read-only ----- */
// Listing History back to the first bar (and a week more): LH.rows when that screen has loaded, else the newest LISTING documents of the
// shared /history collection — more while the oldest one read is still newer than that, up to the LH_DOCS the screen reads.
function nlLoadLh() {
  if (typeof LH !== 'undefined' && Array.isArray(LH.rows) && !LH.loading && !LH.err) return Promise.resolve(LH.rows);
  if (NL.lh) return Promise.resolve(NL.lh);
  if (!NL.lhP) NL.lhP = (async () => {
    const fromDay = nlAdd(sdToday(), -7 * (NL_WEEKS + 1));
    const max = typeof LH_DOCS !== 'undefined' ? LH_DOCS : 800;
    for (let n = 60; ; n = Math.min(n * 2, max)) {
      const snap = await getDocs(query(collection(db, 'history'), orderBy('day', 'desc'), limit(n)));
      const rows = [];
      let count = 0, oldest = '';
      snap.forEach(docSnap => {
        count++;
        const data = docSnap.data() || {};
        if (!/^listing_/.test(docSnap.id) || data.kind !== 'listing') return;
        if (data.day && (!oldest || data.day < oldest)) oldest = data.day;
        Object.values(data.rows || {}).forEach(row => { if (row && row.kind === 'listing') rows.push(row); });
      });
      if (count < n || (oldest && oldest < fromDay) || n >= max) { NL.lh = rows; return rows; }
    }
  })().finally(() => { NL.lhP = null; });
  return NL.lhP;
}
/** Everything the answer reads: the sales stores (viLoad reads Listing Health's snapshot too, with that access), the snapshot, History. */
async function nlLoad() {
  await Promise.all([
    (async () => {
      if (typeof viLoad === 'function') await viLoad();
      if (!H_LOADED) await loadHealthCache();
    })(),
    nlLoadLh().catch(() => null),
  ]);
  // the listing cache's first refresh (its createdDate and status), when it is still running
  if (typeof LM !== 'undefined' && LM.busy) await Promise.race([Promise.resolve(LM.busy).catch(() => {}), new Promise(r => setTimeout(r, 10000))]);
}

/* ----- Listing Health: the level filter "New (30 days)" / "New (7 days)" ----- */
const nlHealthDays = view => (view === 'new7' ? 7 : view === 'new30' ? 30 : 0);
// Is this Listing Health row (a copy with .brand) new in the window of `view`? Its answer is kept on the row (row._nl) for the table.
function nlHealthPick(row, view) {
  const n = nlHealthDays(view);
  const res = nlNow();
  if (!n || !res) return false;
  if (!res.byKey) res.byKey = new Map(res.items.map(it => [it.brand + '|' + it.sku, it]));
  const it = res.byKey.get(row.brand + '|' + row.sku);
  if (!it || !nlIn(it, n)) return false;
  row._nl = it;
  const h = row._h || {};
  const pics = h.pics ? (h.pics.main ? h.pics.n : 0) : null;
  row._nlPics = pics;
  row._nlHelp = [it.state === 'notlive' && (it.days != null ? it.days : it.maxDays) >= NL_HELP.live ? `not live after ${NL_HELP.live} days` : '',
    it.units === 0 && (it.days != null ? it.days : it.maxDays) >= NL_HELP.sale ? `no sale after ${NL_HELP.sale} days` : '',
    pics != null && pics < NL_HELP.images ? `fewer than ${NL_HELP.images} images (${pics})` : ''].filter(Boolean);
  return true;
}
const NL_STATE = { selling: 'Selling', nosale: 'Live, no sale yet', notlive: 'Not live yet', nodata: 'Live?: no sales data' };
const nlEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
/** The columns of the "New" table: SKU, ASIN, parent, title, date listed, days, status, stock, units & $ since listed, images, A+, errors,
 *  and what needs help. `dflt` = the column it sorts by first (newest first). */
function nlHealthDefs(multiBrand) {
  const money = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
  const defs = [
    { k: 'sku', t: 'SKU', frz: 1, cell: row => `<div class="ls-prod">${typeof hPicHtml === 'function' ? hPicHtml(row.brand, [row]) : ''}<div class="ls-prod-t"><div class="ui-mono">${nlEsc(row.sku)}</div></div></div>` },
    { k: 'asin', t: 'ASIN', mono: 1 },
  ];
  if (multiBrand) defs.push({ k: 'brand', t: 'Brand', map: row => (typeof BRAND_NAME !== 'undefined' ? BRAND_NAME[row.brand] : row.brand) });
  defs.push(
    { k: 'parent', t: 'Parent', mono: 1 },
    { k: 'title', t: 'Title', trunc: 44 },
    { k: 'nlDate', t: 'Date listed', map: row => row._nl.date || row._nl.after,
      cell: row => `<span title="${nlEsc(row._nl.srcText)}">${row._nl.date ? nlEsc(nlDayText(row._nl.date)) : 'after ' + nlEsc(nlDayText(row._nl.after))}</span><div class="nl-src">${nlEsc(row._nl.src === 'amazon' ? row._nl.srcText : row._nl.src === 'lh' ? 'Create Listing' : 'first seen')}</div>`,
      tip: 'Amazon\'s own create / open date when Sellora holds it; else the first Create Listing send in Listing History; else "after" the Listing Health snapshot the listing was not in yet.' },
    { k: 'nlDays', t: 'Days', num: 1, noTotal: 1, dflt: 1, map: row => (row._nl.days != null ? row._nl.days : row._nl.maxDays),
      cell: row => (row._nl.days != null ? String(row._nl.days) : '&lt; ' + (row._nl.maxDays + 1)), tip: 'Days since listed (today = 0).' },
    { k: 'nlState', t: 'Status', noTotal: 1, map: row => NL_STATE[row._nl.state],
      cell: row => `<span class="nl-st is-${row._nl.state}">${nlEsc(NL_STATE[row._nl.state])}</span><div class="nl-src">${nlEsc(row._nl.status || '—')}</div>` },
    { k: 'qty', t: 'Stock', num: 1 },
    { k: 'nlUnits', t: 'Units since listed', num: 1, map: row => row._nl.units,
      tip: 'From the nightly per-day sales (dailyAsin) when it reaches back to the listed day, else the PPC & Organic weekly store (weeks from the listed week on).' },
    { k: 'nlRev', t: '$ since listed', num: 1, map: row => row._nl.rev, cell: row => money(row._nl.rev) },
    { k: 'nlPics', t: 'Images', num: 1, noTotal: 1, map: row => row._nlPics, tip: 'Pictures on the listing, as Listing Health counts them (— = not read yet).' },
    { k: 'nlAplus', t: 'A+', noTotal: 1, map: row => (row._h && row._h.aplus && row._h.aplus.v === true ? 'Yes' : row._h && row._h.aplus && row._h.aplus.v === false ? 'No' : '—') },
    { k: 'nlErr', t: 'Errors', num: 1, map: row => (row._h && row._h.critical ? row._h.critical.length : 0), tip: 'Problems at "Error: fix first" level, as Listing Health judges them.' },
    { k: 'nlHelp', t: 'Needs help', noTotal: 1, map: row => row._nlHelp.join(' · '),
      cell: row => (row._nlHelp.length ? row._nlHelp.map(t => `<span class="nl-help-tag">${nlEsc(t)}</span>`).join(' ') : '<span class="muted">—</span>'),
      tip: `Not live after ${NL_HELP.live} days · no sale after ${NL_HELP.sale} days · fewer than ${NL_HELP.images} images.` });
  return defs;
}
// The "New" filter needs the sales stores and Listing History: read once, then the table is drawn again (if it still shows "New").
function nlHealthEnsure() {
  if (NL.ensureP || NL.ensured) return;
  NL.ensureP = nlLoad().catch(() => {}).then(() => {
    NL.ensureP = null;
    NL.ensured = true;
    NL.memo = null;
    if (/^new\d+$/.test(($('hIssueView') || {}).value || '') && typeof renderHealth === 'function') renderHealth();
  });
}
