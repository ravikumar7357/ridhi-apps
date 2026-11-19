/* ================= ADS · ACCOUNT TRENDS: the Ad Console's data store and its nightly fill =================
 * Screens: Ad Console (tab 'trends', pane paneTrends; tMsg is its message line). The screen itself — ensureTrends,
 * the Refresh that scans the Orders sheets and asks Amazon for ad history, renderTrends, the granularity buttons
 * and the CSV export — lives in ads/placement.js; this file holds what it works on. ads/deal-calendar.js also
 * reads TREND, for its effect columns.
 * Does: TREND is the whole-account snapshot — one row per day per brand, [sales, units, orders, impressions,
 * clicks, spend, adOrders, adSales] (T_I names the slots) — cached in Firestore audit/trends (loadTrends,
 * saveTrends) together with the window of days the ad figures really cover (adFrom/adTo, widened by
 * tWidenAdWindow) and the ad reports still queued at Amazon (pending, adDone). tNightly folds last night's run
 * (the backend's daily and ads caches) and the last five days read live into that snapshot when the tab opens,
 * so nobody has to press Refresh.
 * Main functions: tMsg, loadTrends, saveTrends, tWidenAdWindow, tNightly. */

/* ================= ACCOUNT TRENDS =================
 * Whole-account, one row per DAY, stored per brand. Deliberately without the ASIN dimension: this
 * answers "how is the account doing", and dropping ASINs makes a year of days small enough to hold
 * in one document and roll up into weeks, months or quarters in the browser — no round trip when
 * the granularity changes.
 *
 * Per day, per brand: [sales, units, orders, impressions, clicks, spend, adOrders, adSales]
 */
// Slot of each figure in a day's array, and the array's length.
const T_I = { sales: 0, units: 1, orders: 2, impr: 3, clicks: 4, spend: 5, adOrders: 6, adSales: 7 };
const T_LEN = 8;
const T_DAYS = 400;            // how far back the Orders scan looks
const T_ADS_LOOKBACK = 95;     // Amazon keeps Sponsored Products data about this long
// adFrom/adTo record WHICH DAYS the ad figures actually cover. Without them a day with no ad data
// is indistinguishable from a day with genuinely zero spend, and the table then reports TACOS 0%
// and Organic 100% for months Amazon will never have data for — a confident, wrong answer.
// The snapshot: d = per brand { day → array }, at / adAt = when sales / ad figures were last written,
// pending = ad reports still queued at Amazon, adDone = ad windows already fetched (see tSliceKey).
let TREND = { d: { SP: {}, CPC: {} }, at: '', adAt: '', adFrom: '', adTo: '', pending: [], adDone: {} };

/**
 * Days after which a day's ad figures stop moving.
 *
 * NOT zero, which is the tempting assumption. Amazon books an ad sale against the CLICK, and the
 * `sales30d` column keeps collecting orders for thirty days after it — so a week pulled today and
 * the same week pulled next month are genuinely different numbers, and the newer one is right.
 * Everything older than this really is settled, and re-fetching it is pure waiting.
 */
const T_AD_SETTLE_DAYS = 32;                    // 30 + a couple of days of slack
// Key of one fetched ad window in TREND.adDone (and WEEKLY.adDone): brand, first day, last day.
const tSliceKey = (brand, s, e) => `${brand}|${s}|${e}`;
// T_GRAN: the roll-up on screen (day / week / month / quarter). T_BUSY: a Refresh is running. T_STOP: Stop pressed.
let T_GRAN = 'week', T_BUSY = false, T_STOP = false;

// Write the Ad Console's message line; bad = true shows it in red (class err), otherwise muted.
function tMsg(t, bad) {
  const m = $('tMsg');
  m.textContent = t || '';
  m.className = bad ? 'err' : 'muted';
}

// Read the cached snapshot from Firestore audit/trends into TREND; nothing stored leaves TREND as it is.
async function loadTrends() {
  try {
    const s = await getDoc(doc(db, 'audit', 'trends'));
    if (s.exists()) {
      const d = s.data();
      TREND = {
        d: { SP: d.SP || {}, CPC: d.CPC || {} },
        at: d.at || '',
        adAt: d.adAt || '',
        adFrom: d.adFrom || '',
        adTo: d.adTo || '',
        pending: d.pending || [],
        adDone: d.adDone || {} };
    }
  } catch (e) { /* nothing stored yet, or no read access */ }
}
// Write the whole of TREND to Firestore audit/trends, stamped with who saved it and when.
async function saveTrends() {
  await setDoc(doc(db, 'audit', 'trends'), {
    SP: TREND.d.SP,
    CPC: TREND.d.CPC,
    at: TREND.at,
    adAt: TREND.adAt,
    adFrom: TREND.adFrom,
    adTo: TREND.adTo,
    pending: TREND.pending,
    adDone: TREND.adDone,
    by: ME.email,
    saved: serverTimestamp(),
  });
}
/**
 * Extend the "ad figures are known for these days" window over what the nightly run delivered.
 *
 * Only over a CONTIGUOUS run ending at the newest day it holds. A phase that half finished leaves
 * holes, and a window stretched across a hole reports a confident $0 spend for a day nobody ever
 * fetched — which is the one thing the dash is there to prevent.
 *
 * The old window is merged in only if the two actually meet. If they do not, the nightly range wins
 * on its own: showing a dash for figures we happen to hold is merely cautious, while showing a zero
 * for figures we do not hold is wrong.
 */
// Widen TREND.adFrom/adTo over the unbroken run of days ending at the newest day given.
function tWidenAdWindow(days) {
  if (!days.length) return;
  // --- the unbroken run of days ending at the newest ---
  const uniq = [...new Set(days)].sort();
  const to = uniq[uniq.length - 1];
  let from = to;
  for (let i = uniq.length - 2; i >= 0; i--) {
    if (uniq[i] !== sdShift(uniq[i + 1], -1)) break;
    from = uniq[i];
  }
  // --- merge with the old window only if the two meet ---
  const meets = TREND.adFrom && TREND.adTo && TREND.adFrom <= sdShift(to, 1) && TREND.adTo >= sdShift(from, -1);
  TREND.adFrom = meets && TREND.adFrom < from ? TREND.adFrom : from;
  TREND.adTo = meets && TREND.adTo > to ? TREND.adTo : to;
}

/**
 * AMAZON'S OWN DAY TOTALS (Pricing-API/AmazonMatch.gs, 16 Nov 2026) — laid over the snapshot so the Ad Console says what
 * Seller Central and the Ads console say.
 *
 * The backend's matchBiz cache is Business Reports → By Date (per day: [Ordered Product Sales, Units Ordered, Total Order
 * Items, Sessions, …]); matchAds is the campaign reports per type (per day: { sp, sb, sd }, each [impressions, clicks, cost,
 * sales, orders, …] — Sponsored Products on 7-day sales, as the console counts). Before this the screen took sales from the
 * Orders workbooks and ads from Sponsored Products alone on 30-day sales, so spend left Brands and Display out and ACOS read low.
 *
 * WHAT IT REPLACES, per day it holds: Sales, Units and Order items (matchBiz — Seller Central's Total Order Items, which is
 * why the row is titled "Order items" and no longer "Orders"); Impressions, Clicks, Ad Spend, Ad Sales and Ad Orders
 * (matchAds, the three types added up). Days neither cache holds keep the figures they had — the newest day or two (Amazon
 * publishes late; there the count is still this app's distinct orders) and ad days older than Amazon keeps.
 *
 * ONE COPY FOR EVERY SCREEN (16 Nov): T_MATCH is the page's only copy of the two caches. The Ad Console lays it over TREND
 * here; the Sales Dashboard reads the same days through tMatchBizDays (sales/sales-dashboard.js, sdDays). tMatchEnsure is
 * the shared, throttled way to have them loaded.
 *
 * Applied LAST by tNightly, and again after anything else writes those slots (Refresh's Orders scan, a collected ad report),
 * so the older sources can never put their figures back over Amazon's.
 */
// The two caches as last read this session (null until tMatchLoad has them).
let T_MATCH = { biz: null, ads: null };
let T_MATCH_AT = 0;                             // when tMatchLoad last ran in this session
// Have the two caches loaded, at most one round trip every ten minutes whichever screen asks.
async function tMatchEnsure() {
  if ((T_MATCH.biz || T_MATCH.ads) && Date.now() - T_MATCH_AT < 600000) return;
  await tMatchLoad();
}
// One brand's Business Report days that can be shown: { day: [sales, units, orderItems, sessions, pageViews, …] }. A day
// in the last three that reads all zero is left out — that is "Amazon has not published it yet", not a day without sales.
function tMatchBizDays(b) {
  const d = T_MATCH.biz && T_MATCH.biz.d && T_MATCH.biz.d[b];
  if (!d) return {};
  const fresh = sdShift(sdToday(), -3), out = {};
  Object.entries(d).forEach(([day, v]) => {
    if (v && !(day >= fresh && !v[0] && !v[1])) out[day] = v;
  });
  return out;
}
// Read matchBiz and matchAds from the backend. Either may be missing (AmazonMatch not installed, or still filling).
async function tMatchLoad() {
  T_MATCH_AT = Date.now();
  try {
    const r = await baCall({ cache: 'matchBiz' });
    if (r && r.data && r.data.d) T_MATCH.biz = r.data;
  } catch (e) { /* not there yet — the snapshot stays as it is */ }
  try {
    const r = await baCall({ cache: 'matchAds' });
    if (r && r.data && r.data.d) T_MATCH.ads = r.data;
  } catch (e) { /* not there yet */ }
}
// LABELS SAY WHAT THEY COUNT (16 Nov 2026). The Ad Console's ad figures are Sponsored Products, Brands and Display added
// up wherever matchAds holds the day, and Sponsored Products alone where it does not (before matchAds, or before the
// first day Amazon still kept Brands / Display for). tAdTag is what the ad measures' names carry; tAllTypesFrom is the
// first day the three types are in for every brand in view that has any Brands / Display at all.
const tAdTag = () => (T_MATCH.ads && T_MATCH.ads.d ? ' · all types' : ' · SP only');
function tAllTypesFrom(bs) {
  if (!T_MATCH.ads || !T_MATCH.ads.d) return '';
  let from = '';
  bs.forEach(b => {
    const d = T_MATCH.ads.d[b] || {};
    const first = Object.keys(d).filter(k => d[k] && (d[k].sb || d[k].sd)).sort()[0];
    if (first && first > from) from = first;
  });
  return from;
}
// Lay the two caches over TREND for this account's brands; returns how many day-cells were written.
function tMatchApply() {
  const brands = tBrands();
  const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
  let n = 0;
  if (T_MATCH.biz) {
    brands.forEach(b => Object.entries(tMatchBizDays(b)).forEach(([day, v]) => {
      const c = tCell(b, day);
      c[T_I.sales] = r2(v[0]);
      c[T_I.units] = Number(v[1]) || 0;
      c[T_I.orders] = Number(v[2]) || 0;         // Total Order Items, as Seller Central counts
      n++;
    }));
  }
  if (T_MATCH.ads) {
    const days = [];
    brands.forEach(b => Object.entries(T_MATCH.ads.d[b] || {}).forEach(([day, k]) => {
      if (!k || !k.sp) return;                    // Sponsored Products is the bulk: without it the day is not known
      const kinds = [k.sp, k.sb, k.sd].filter(Boolean);
      const sum = i => kinds.reduce((t, a) => t + (Number(a[i]) || 0), 0);
      const c = tCell(b, day);
      c[T_I.impr] = sum(0);
      c[T_I.clicks] = sum(1);
      c[T_I.spend] = r2(sum(2));
      c[T_I.adSales] = r2(sum(3));
      c[T_I.adOrders] = sum(4);
      days.push(day);
      n++;
    }));
    tWidenAdWindow(days);
  }
  return n;
}

/**
 * Fill this tab from last night's run, so opening it is enough.
 *
 * The nightly pipeline cannot write Firestore — Apps Script has no service account — so it leaves
 * its results in cache sheets instead. This reads those and folds them into the very same snapshot
 * a manual Refresh builds. That is what makes yesterday complete without anybody pressing anything;
 * Refresh is now only for re-pulling ad history sooner than the next night.
 *
 * REPLACES, never adds. Both caches are a complete statement of every day they cover, so adding
 * them to days a Refresh had already collected would double each one.
 *
 * Only this account's brands are merged, which also means the nightly run's third channel, Shopify,
 * is left where it is: it belongs to the Sales Dashboard, and folding it in here would inflate Sales
 * against Amazon-only ad spend and quietly bend TACOS, ACOS and organic share.
 */
let T_NIGHT_RUN = 0;                            // when this last ran in this session
// Merge the nightly caches (daily sales, ads) and the last five live days into TREND, save, and return the
// nightly run's stamp ('' when nothing changed).
async function tNightly() {
  const brands = tBrands();
  const today = sdToday();                      // the marketplace's day, never the viewer's
  let changed = false, stamp = '';

  // --- sales, units and orders, for every finished day the run covers ---
  // Today is deliberately skipped: the nightly figure for it is whatever had arrived by 05:00, and
  // the live top-up below is the honest version of it.
  try {
    const r = await baCall({ cache: 'daily' });
    const d = (r.data && r.data.d) || {};
    stamp = (r.data && r.data.at) || '';
    brands.forEach(b => Object.entries(d[b] || {}).forEach(([day, v]) => {
      if (day >= today) return;
      const c = tCell(b, day);
      c[T_I.sales] = v[0] || 0;
      c[T_I.units] = v[1] || 0;
      c[T_I.orders] = v[2] || 0;
      changed = true;
    }));
  } catch (e) { /* nothing cached yet — whatever is already on screen stays */ }

  // --- ad figures, and the window they can be trusted over ---
  try {
    const r = await baCall({ cache: 'ads' });
    const d = (r.data && r.data.d) || {};
    const days = [];
    brands.forEach(b => Object.entries(d[b] || {}).forEach(([day, v]) => {
      const c = tCell(b, day);
      c[T_I.impr] = v[0] || 0;
      c[T_I.clicks] = v[1] || 0;
      c[T_I.spend] = Math.round((v[2] || 0) * 100) / 100;
      c[T_I.adOrders] = v[3] || 0;
      c[T_I.adSales] = Math.round((v[4] || 0) * 100) / 100;
      days.push(day);
      changed = true;
    }));
    tWidenAdWindow(days);
  } catch (e) { /* the ads phase may not have finished yet — yesterday's window stays */ }

  // --- today and the days around it, live from the tail of the Orders sheets ---
  // The same call and the same reasoning as the Sales Dashboard: a day is only settled once it is
  // over, so the last few are re-read rather than trusted from a 05:00 snapshot.
  try {
    const r = await baCall({ daily: 'recent', days: 5 });
    Object.entries(r.d || {}).forEach(([ch, byDay]) => {
      if (!brands.includes(ch)) return;         // skips 'shopError' and Shopify in one test
      Object.entries(byDay).forEach(([day, v]) => {
        const c = tCell(ch, day);
        c[T_I.sales] = v[0] || 0;
        c[T_I.units] = v[1] || 0;
        c[T_I.orders] = v[2] || 0;
        changed = true;
      });
    });
  } catch (e) { /* the cached days are still true; only today is missing */ }

  // --- Amazon's own day totals, last, so they win on every day they hold ---
  try {
    await tMatchLoad();
    if (tMatchApply()) changed = true;
  } catch (e) { /* the figures above stay */ }

  // --- save and report ---
  if (changed) {
    TREND.at = new Date().toISOString().slice(0, 16).replace('T', ' ');
    // Shared, so the next person to open the tab gets it without the round trip. An account that may
    // read but not write is not an error here — the merge is already on screen either way.
    try { await saveTrends(); } catch (e) { /* read-only account */ }
  }
  T_NIGHT_RUN = Date.now();
  return changed ? (stamp || 'last night') : '';
}
