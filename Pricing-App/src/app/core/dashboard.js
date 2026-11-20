/* ================= CORE · DASHBOARD: the first screen after sign-in (20–21 Nov 2026) =================
 * Screens: Dashboard (tab 'dash', #paneDash; core/nav.js calls ensureDash when it opens), the Sellora logo in the top bar (opens
 *          it) and the ✨ button beside the theme switch (#fxBtn: the Dashboard's animation on / off — nothing on any other
 *          screen moves or stops with it).
 * Does: shows, for Both / Ridhi / CPC (remembered in this browser), the numbers the other screens work out — never one of its own.
 *   It NEVER LOOKS EMPTY: every card first shows the number it showed last time (kept in this browser, selloraDash.v2, amber "as of
 *   <time>"), then counts over to the fresh number when that arrives. The very first time, a shimmer stands in until it does.
 *   The loads START WHEN SIGN-IN SUCCEEDS (dashPrefetch, from this file's own onAuthStateChanged — core/auth.js is not touched), all
 *   at once, each card on its own (one slow or failed card never holds up another; 15 s and it shows its cached number, or
 *   "couldn't load"), in this order: Sales · PPC · Inventory, then Listing Health, then Need pictures · Errors · BSR · Listing History.
 *   Each reads what its screen reads, read-only; data a screen already holds in memory is used as it is (no second call):
 *     sales    the Sales Dashboard's own loader (ensureSales: the latest nightly history, the live top-up, Seller Central's own totals)
 *              and its own sums (sdSum, sdSeries) — so MTD / YTD / vs LY / 90 days are the Sales Dashboard's to the cent;
 *     ads      the PPC & Organic weekly store (WEEKLY when that screen has it, else one read of its saved snapshot into the Dashboard's
 *              OWN copy — never WEEKLY itself: that screen merges last night's run into it and saves it);
 *     age      Inventory Age's saved snapshot (loadAgeCache);
 *     health   Listing Health's own loaders (lrLoad, amzEnsure, imListLoad, loadHealthCache) and judgement (hCtx, hHealthKept); the
 *              catalogue only when its saved copy is fresh (lrLoadCatalog WRITES a new copy when it is not — so then the card keeps its
 *              cached number and says to open Listing Health);
 *     img/lerr Image Manager's list (IML) — "need pictures" (imProblems · IM_NEEDS) and Listing Errors' "Errors only" count;
 *     bsr      BSR Audit's "Got worse" (its compare when drawn, else the latest two stored weeks through its own bsrWeekEntries / bsrMove);
 *     lh       Listing History this month (LH.rows when loaded, else a light read of only the newest log documents of the month).
 * NEVER: an Amazon refresh, "Refresh both brands", "Refresh from Amazon", AI, or a write anywhere but this browser (localStorage).
 * Look: GSAP 3 (loaded from jsDelivr the first time the Dashboard opens) — cards stagger in, numbers count up (exact final text),
 *       donuts grow, the line draws, bars rise, arrows draw, a dot runs along the flow, the glow drifts, cards lift on hover, a cached
 *       number counts over to the fresh one. No GSAP: the same in CSS (styles.css, DASHBOARD). ✨ off or reduced motion: no motion.
 * Main functions: ensureDash, dashPrefetch, dashRun, dashData, dashRender, dashPaint, dashAnimate, dashOpen. */

// var, not const: core/nav.js's load-time showTab calls ensureDash before this file has run (it waits for this).
var DASH_READY = false;
const DASH_LS = { brand: 'selloraDashBrand', fx: 'selloraDashFx', cache: 'selloraDash.v2' };
const DASH_GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
const DASH_TIMEOUT = 15000;
const DASH = { brand: 'ALL', st: {}, memo: {}, shown: {}, tw: {}, timing: {}, t0: 0, weekly: null, lhOwn: null, bsrOwn: null,
  catOk: {}, imlP: null, gs: null, cu: [], raf: 0, safety: 0, rendered: false };
const DASH_NUM = new Intl.NumberFormat('en-US');
const DASH_FMT = {
  money: v => '$' + DASH_NUM.format(Math.round(v)),         // the Sales Dashboard's sdMoney: whole dollars
  usd2: v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),   // Inventory Age's storage
  num: v => DASH_NUM.format(Math.round(v)),
};
const DASH_SLOTS = ['kSales', 'kYtd', 'kAds', 'kList', 'flow', 'donut', 'line', 'bars', 'tImg', 'tErr', 'tBsr', 'tAge'];
// Each data source: the screen whose access it needs, and the cards it fills.
const DASH_KEYS = {
  sales: { tab: 'sales', slots: ['kSales', 'kYtd', 'line'] },
  ads: { tab: 'ppcn', slots: ['kAds', 'bars'] },
  age: { tab: 'age', slots: ['tAge'] },
  health: { tab: 'health', slots: ['kList', 'flow', 'donut'] },
  lh: { tab: 'lhist', slots: ['flow'] },
  img: { tab: 'img', slots: ['tImg'] },
  lerr: { tab: 'lerr', slots: ['tErr'] },
  bsr: { tab: 'bsr', slots: ['tBsr'] },
};
const DASH_VIEWS = ['ALL', 'SP', 'CPC'];
const dashEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const dashGet = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const dashSet = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* private window: not remembered */ } };
const dashSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const dashBrandsOf = view => (view === 'ALL' ? ['SP', 'CPC'] : [view]);
const dashName = b => (b === 'SP' ? 'Ridhi' : b);
// May this account open screen t? (TAB_OK is set by core/access.js applyPerms once the account's rights are known.)
const dashMay = t => typeof TAB_OK === 'function' && !!TAB_OK(t);
const dashMayKey = k => (k === 'ads' ? dashMay('ppcn') || dashMay('weekly') : dashMay(DASH_KEYS[k].tab));
const dashAdKey = () => (typeof adBrands === 'function' ? adBrands().join(',') : 'SP,CPC');
const dashWhen = d => {
  const t = d instanceof Date ? d : new Date(d);
  return isNaN(t) ? '' : t.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const dashReduce = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
const dashFxSaved = () => dashGet(DASH_LS.fx) !== '0';
const dashFxOn = () => dashFxSaved() && !dashReduce();
// How the Dashboard moves right now: 'gsap', 'css' (GSAP not loaded), or 'none' (✨ off / reduced motion).
const dashEngine = () => (!dashFxOn() ? 'none' : window.gsap && DASH.gs === true ? 'gsap' : 'css');
const dashShown = () => !!$('paneDash') && !$('paneDash').classList.contains('hide');
const dashMs = () => Math.round(performance.now() - (DASH.t0 || 0));

/* ================= THE BROWSER COPY: the last numbers each card showed, per brand view ================= */
function dashCacheAll() {
  try { return JSON.parse(dashGet(DASH_LS.cache) || '{}') || {}; } catch (e) { return {}; }
}
// Keep a source's fresh numbers for all three views (Both, Ridhi, CPC), so the next sign-in shows them at once.
function dashStore(key) {
  const res = dashCalc(key);
  if (!res) return;
  const all = dashCacheAll();
  const into = all[key] || (all[key] = {});
  DASH_VIEWS.forEach(view => {
    if (res[view] && !res[view].empty) into[view] = Object.assign({}, res[view], { at: Date.now(), ab: key === 'ads' ? dashAdKey() : undefined });
  });
  dashSet(DASH_LS.cache, JSON.stringify(all));
}

/* ================= WORKING OUT THE NUMBERS — from what is in memory, all three views at once (memoised until data changes) ================= */
function dashCalc(key) {
  if (key in DASH.memo) return DASH.memo[key];
  let res = null;
  try { res = DASH_CALC[key](); } catch (e) { res = null; }
  DASH.memo[key] = res;
  return res;
}
const dashPerView = fn => { const out = {}; DASH_VIEWS.forEach(view => { out[view] = fn(view); }); return out; };
const DASH_CALC = {
  // The Sales Dashboard's own sums: sdSum / sdSeries read the channel on view (SD_CH), so it is set for each brand and put back
  // straight after, in the same moment (nothing else runs in between).
  sales: () => {
    if (!(SD && SD.at)) return null;
    const keep = SD_CH;
    const today = sdToday(), yest = sdShift(today, -1);
    const monthStart = today.slice(0, 8) + '01', yearStart = today.slice(0, 4) + '-01-01';
    const T = typeof T_MATCH !== 'undefined' && T_MATCH.biz;
    const when = 'nightly run ' + SD.at + (SD_LIVE ? ' · today ' + SD_LIVE : '') + (T ? ' · Seller Central totals' : '');
    try {
      return dashPerView(view => {
        const bs = dashBrandsOf(view);
        const sum = (from, to) => bs.reduce((t, ch) => { SD_CH = ch; return t + sdSum(from, to)[0]; }, 0);
        const by = {};
        bs.forEach(ch => { SD_CH = ch; sdSeries(sdShift(today, -89), today).forEach(p => { by[p.d] = (by[p.d] || 0) + p.v; }); });
        return { mtd: sum(monthStart, today), ytd: sum(yearStart, today),
          mc: sum(monthStart, yest), ml: sum(sdLastYear(monthStart), sdLastYear(yest)),
          yc: sum(yearStart, yest), yl: sum(sdLastYear(yearStart), sdLastYear(yest)),
          pts: Object.keys(by).sort().map(d => ({ d, v: Math.round(by[d] * 100) / 100 })), day: SD.at, when };
      });
    } finally { SD_CH = keep; }
  },
  // PPC & Organic: per week of the last 8, sales and ad spend; the latest week's TACoS as renderWeeklyKpis works it out.
  ads: () => {
    const W = WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length ? WEEKLY : DASH.weekly;
    if (!W) return null;
    const ad = typeof adBrands === 'function' ? adBrands() : ['SP', 'CPC'];
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => ad.includes(b));
      if (!bs.length || !Object.keys(W.rows).length) return { empty: true, when: bs.length ? 'nothing stored yet' : 'not in your access' };
      const all = bs.length === 2;                     // wRows: "All" keeps every row; one brand keeps its rows
      const rows = Object.values(W.rows).filter(r => all || bs.includes(r.brand || ''));
      const weeks = (W.weeks.length ? W.weeks : wWeeksList(26)).slice(-8);
      const per = weeks.map(w => {
        let rev = 0, spend = 0;
        rows.forEach(r => { const c = (r.weeks || {})[w]; if (c) { rev += c.rev || 0; spend += c.spend || 0; } });
        return { w, rev, spend, done: wWeekDone(w) };
      });
      const last = per[per.length - 1];
      return { per, last, tacos: last && last.rev ? Math.round(last.spend / last.rev * 100) : null,
        only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: (W.at ? 'sales as at ' + W.at : 'not pulled yet') + (W.adAt ? ' · ads ' + W.adAt : '') };
    });
  },
  // Inventory Age: aged 181+ units and the storage charge, as renderAgeKpis adds them up.
  age: () => {
    if (!AGE_LOADED) return null;
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => AGE[b]);
      if (!bs.length) return { empty: true, when: 'no snapshot yet' };
      const cols = totalCols([...new Set(bs.flatMap(b => AGE[b].cols))]);
      const aged = cols.filter(c => { const r = ageRange(c); return r && r[0] >= AGED_FROM; });
      let units = 0, storage = 0;
      bs.forEach(b => AGE[b].rows.forEach(r => {
        units += aged.reduce((s, c) => s + ((r.age || {})[c] || 0), 0);
        storage += r.storage || 0;
      }));
      const ats = bs.map(b => AGE[b].at).filter(Boolean);
      return { units, storage, only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
        when: ats.length ? 'updated ' + dashWhen(new Date(Math.min(...ats.map(d => d.getTime())))) : '' };
    });
  },
  // Listing Health's levels, as renderHealthKpis counts them — only once everything Listing Health judges with is in.
  health: () => {
    if (!H_LOADED || !LR) return null;
    if (['SP', 'CPC'].some(b => HEALTH[b] && !LR_CAT[b] && !DASH.catOk[b])) return null;      // its catalogue: not in, and not fresh
    if (hColdMany()) return null;                                                               // still to be judged (dashLoadHealth warms it)
    const hc = hCtx();
    const now = Date.now();
    const per = {};
    ['SP', 'CPC'].forEach(brand => {
      if (!HEALTH[brand]) return;
      const c = { n: 0, critical: 0, action: 0, review: 0, healthy: 0, unchecked: 0 };
      HEALTH[brand].rows.forEach(row => {
        const h = hHealthKept(row, Object.assign({}, row, { brand }), hc, now);
        c.n++;
        if (h.bucket === 'healthy' || h.bucket === 'monitor') c.healthy++;
        else if (h.bucket in c) c[h.bucket]++;
      });
      const lm = typeof lmDataLabel === 'function' ? lmDataLabel([brand]) : null;
      c.when = lm ? lm.text : HEALTH[brand].at ? 'updated ' + dashWhen(HEALTH[brand].at) : '';
      per[brand] = c;
    });
    return dashPerView(view => {
      const bs = dashBrandsOf(view).filter(b => per[b]);
      if (!bs.length) return { empty: true, when: 'no snapshot yet' };
      const v = { n: 0, critical: 0, action: 0, review: 0, healthy: 0, unchecked: 0 };
      bs.forEach(b => Object.keys(v).forEach(k => { v[k] += per[b][k]; }));
      const whens = [...new Set(bs.map(b => per[b].when))];
      return Object.assign(v, { per: Object.fromEntries(bs.map(b => [b, per[b]])),
        when: whens.length === 1 ? whens[0] : bs.map(b => dashName(b) + ': ' + per[b].when).join(' · ') });
    });
  },
  // Listing History this month: listings sent after approval, and listings Amazon accepted.
  lh: () => {
    const rows = Array.isArray(LH.rows) && !LH.loading && !LH.err ? LH.rows : DASH.lhOwn;
    if (!rows) return null;
    const month = lhFiltered(rows, { range: 'month', from: '', to: '', user: '', what: '', screen: '', result: '', q: '' });
    return dashPerView(view => {
      const mine = month.filter(r => dashBrandsOf(view).includes(r.brand));
      return { fixed: new Set(mine.filter(r => r.result !== 'notsent').map(r => r.brand + '|' + r.sku)).size,
        amz: new Set(mine.filter(r => r.result === 'accepted').map(r => r.brand + '|' + r.sku)).size, when: 'this month · Listing History' };
    });
  },
  img: () => dashImlCount(it => it.lvl !== 'parent', (it, b) => imProblems(it, b).some(k => IM_NEEDS.includes(k))),
  lerr: () => dashImlCount(x => x.lvl !== 'parent', x => (x.iss || []).some(i => i.s === 'E') || (!!x.ie && !x.iss)),
  // BSR Audit's "Got worse": its compare as drawn (the weeks picked there), else the latest two stored weeks worked out here.
  bsr: () => {
    const all = BSR_LOADED && BSR_RENDER && Array.isArray(BSR_RENDER.all) && BSR_RENDER.all.length ? BSR_RENDER.all : null;
    if (all) {
      const pick = $('bBrandView') ? $('bBrandView').value : 'ALL';
      const wA = $('bWeekA') ? $('bWeekA').value : '', wB = $('bWeekB') ? $('bWeekB').value : '';
      return dashPerView(view => {
        const bs = dashBrandsOf(view);
        if (pick !== 'ALL' && bs.some(b => b !== pick)) return null;
        const worse = all.filter(r => bs.includes(r.brand) && r.move === 'worse');
        return { n: worse.length, high: worse.filter(r => r.prio && r.prio.p === 'High').length, when: wA && wB ? wA + ' vs ' + wB : 'BSR Audit' };
      });
    }
    const own = DASH.bsrOwn;
    if (!own) return null;
    return dashPerView(view => (own.none ? { empty: true, when: 'no snapshots yet' }
      : { n: dashBrandsOf(view).reduce((s, b) => s + (own[b] || 0), 0), high: null, when: own.wA + ' vs ' + own.wB }));
  },
};
// Image Manager's list (IML), counted per brand: the child listings `kid` keeps for which `hit` is true.
function dashImlCount(kid, hit) {
  if (!['SP', 'CPC'].every(b => b in IML)) return null;
  const per = {};
  ['SP', 'CPC'].forEach(b => {
    const data = IML[b];
    if (data && Array.isArray(data.items)) per[b] = { n: data.items.filter(it => kid(it) && hit(it, b)).length,
      when: (typeof lmDataLabel === 'function' && lmDataLabel([b])) ? lmDataLabel([b]).text : data.at ? 'snapshot ' + dashWhen(data.at) : '' };
  });
  return dashPerView(view => {
    const bs = dashBrandsOf(view).filter(b => per[b]);
    if (!bs.length) return { empty: true, when: 'no snapshot yet' };
    const whens = [...new Set(bs.map(b => per[b].when))];
    return { n: bs.reduce((s, b) => s + per[b].n, 0), only: bs.length < dashBrandsOf(view).length ? bs.map(dashName).join(', ') + ' only' : '',
      when: whens.length === 1 ? whens[0] : bs.map(b => dashName(b) + ': ' + per[b].when).join(' · ') };
  });
}

/* ================= LOADING — read-only, each source on its own ================= */
// The backend address arrives a moment after sign-in (core/auth.js reads config/api): wait for it, at most 15 s.
async function dashApi() {
  for (let i = 0; i < 300 && !(typeof API !== 'undefined' && API && API.url); i++) await dashSleep(50);
}
// Sales: the Sales Dashboard's own loader — the latest nightly history, then the live top-up, then (not awaited by it) Seller
// Central's own totals. Each stage that lands redraws the cards (it is in memory then); "fresh" once the top-up is done.
async function dashLoadSales() {
  await dashApi();
  await ensureSales();
  dashChanged('sales');
  if (SD_BUSY) await SD_BUSY;
  // Seller Central's totals arrive on their own (tMatchEnsure): the cards follow for up to 15 s
  const had = !!(typeof T_MATCH !== 'undefined' && T_MATCH.biz);
  if (!had) (async () => {
    for (let i = 0; i < 30; i++) { await dashSleep(500); if (T_MATCH.biz) { dashChanged('sales'); dashStore('sales'); return; } }
  })();
}
// PPC & Organic: what that screen holds, else ONE read of its saved snapshot (audit/weekly + weeklyrows/n) into the Dashboard's own copy.
async function dashLoadAds() {
  if (WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length) return;
  if (DASH.weekly) return;
  const meta = await getDoc(doc(db, 'audit', 'weekly'));
  if (!meta.exists()) { DASH.weekly = { weeks: [], rows: {}, at: '', adAt: '' }; return; }
  const d = meta.data();
  const rows = {};
  if (d.chunks) {
    const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'weeklyrows', String(i)))));
    got.forEach(s => { if (s.exists()) Object.assign(rows, s.data().r || {}); });
  }
  DASH.weekly = { weeks: d.weeks || [], rows, at: d.at || '', adAt: d.adAt || '' };
}
async function dashLoadAge() { if (!AGE_LOADED) await loadAgeCache(); }
// Image Manager's list for both brands — once, shared by Listing Health, Need pictures and Errors (its own loader: this browser's
// copy of the listing cache, else the saved snapshot; never the Amazon read).
function dashLoadIml() {
  if (!DASH.imlP) DASH.imlP = Promise.all(['SP', 'CPC'].filter(b => !(b in IML)).map(b => Promise.resolve(imListLoad(b)).catch(() => {})));
  return DASH.imlP;
}
// The catalogue Listing Health judges with: taken only when its saved copy is fresh (under a day) — exactly what lrLoadCatalog does
// then. An old copy is left alone: lrLoadCatalog would read the workbook and WRITE a new copy, which the Dashboard never does.
async function dashCatalog() {
  for (const b of ['SP', 'CPC']) {
    if (LR_CAT[b]) continue;
    const snap = await getDoc(doc(db, 'listingrules', 'catalog_' + b));
    const data = snap.exists() ? snap.data() : null;
    const fresh = data && data.at && data.at.toDate && Date.now() - data.at.toDate().getTime() < 24 * 3600 * 1000;
    if (data && data.map && fresh) { LR_CAT[b] = data.map; DASH.catOk[b] = true; H_CTX = null; }
  }
}
// Listing Health: its own loaders (rules, catalogue as above, Amazon's status, the picture list, the snapshot), then its judgement in
// slices (hWarm) — the same state Listing Health builds when it opens.
async function dashLoadHealth() {
  await dashApi();
  const jobs = [];
  if (!LR) jobs.push(lrLoad());
  jobs.push(dashCatalog());
  if (!AMZ.map) jobs.push(amzEnsure());
  jobs.push(dashLoadIml());
  if (!H_LOADED) jobs.push(loadHealthCache());
  await Promise.all(jobs.map(p => Promise.resolve(p).catch(() => {})));
  for (let i = 0; i < 200 && AMZ.busy; i++) await dashSleep(50);           // a screen's amzEnsure still running
  H_CTX = null;
  if (hColdMany()) await hWarm();
  if (['SP', 'CPC'].some(b => HEALTH[b] && !LR_CAT[b] && !DASH.catOk[b])) throw new Error('the catalogue copy is over a day old — open Listing Health to update it');
}
// Listing History, this month only: the newest log documents, more only while the oldest read is still in this month.
async function dashLoadLh() {
  if (Array.isArray(LH.rows) && !LH.loading && !LH.err) return;
  const d = new Date();
  const fromDay = new Date(d.getFullYear(), d.getMonth(), 1, -24).toISOString().slice(0, 10);   // a day early: the log's day is UTC
  for (let n = 40; ; n = Math.min(n * 2, LH_DOCS)) {
    const snap = await getDocs(query(collection(db, 'history'), orderBy('day', 'desc'), limit(n)));
    const rows = [];
    let count = 0, oldest = '9999';
    snap.forEach(docSnap => {
      count++;
      const data = docSnap.data() || {};
      if (data.day && data.day < oldest) oldest = data.day;
      if (!/^listing_/.test(docSnap.id) || data.kind !== 'listing') return;
      Object.values(data.rows || {}).forEach(row => { if (row && row.kind === 'listing') rows.push(row); });
    });
    if (count < n || oldest < fromDay || n >= LH_DOCS) { DASH.lhOwn = rows; return; }
  }
}
// BSR Audit: its compare when drawn; else the latest two stored weeks (as its week pickers default) through its own functions.
async function dashLoadBsr() {
  if (BSR_LOADED && BSR_RENDER && Array.isArray(BSR_RENDER.all) && BSR_RENDER.all.length) return;
  if (!BSR_LOADED) await loadBsrCache();
  const weeks = allWeeks();
  if (!weeks.length) { DASH.bsrOwn = { none: true }; return; }
  const wA = weeks[weeks.length - 1], wB = weeks[weeks.length - 2] || wA;
  const own = { wA, wB };
  for (const b of ['SP', 'CPC']) {
    if (BSR_WEEKS[b].includes(wA)) await loadBsrWeek(b, wA);
    if (BSR_WEEKS[b].includes(wB)) await loadBsrWeek(b, wB);
    await bsrLoadDays(b, wA);
    await bsrLoadDays(b, wB);
    const A = bsrWeekEntries(b, wA).r, B = bsrWeekEntries(b, wB).r;
    let n = 0;
    new Set([...Object.keys(A), ...Object.keys(B)]).forEach(p => {
      const ea = A[p], eb = B[p];
      const used = bsrUsed(ea, eb);
      const catChanged = used.kind === 'sub' ? !!(ea && ea.subCat && eb && eb.subCat && ea.subCat !== eb.subCat)
        : !!(ea && ea.cat && eb && eb.cat && ea.cat !== eb.cat);
      if (used.b && used.a && !catChanged && bsrMove(used.a, used.b, used.kind) === 'worse') n++;   // bsrDecide's move
    });
    own[b] = n;
  }
  DASH.bsrOwn = own;
}
const DASH_LOAD = { sales: dashLoadSales, ads: dashLoadAds, age: dashLoadAge, health: dashLoadHealth, lh: dashLoadLh,
  img: dashLoadIml, lerr: dashLoadIml, bsr: dashLoadBsr };

// A source's data changed: work its numbers out again, and redraw its cards when the Dashboard is on screen.
function dashChanged(key) {
  delete DASH.memo[key];
  if (dashShown() && DASH.rendered) dashPaint(DASH_KEYS[key].slots, 'swap');
}
// Load one source: its own 15-second clock, its cards redrawn when it lands (or fails), its numbers kept in this browser.
function dashRun(key) {
  if (!dashMayKey(key)) return;
  const st = DASH.st[key];
  if (st && (st.s === 'loading' || st.s === 'ok')) return;
  DASH.st[key] = { s: 'loading', t0: dashMs() };
  dashChanged(key);
  const timer = setTimeout(() => { if (DASH.st[key].s === 'loading') { DASH.st[key].s = 'timeout'; dashChanged(key); } }, DASH_TIMEOUT);
  Promise.resolve().then(DASH_LOAD[key]).then(() => { DASH.st[key] = { s: 'ok', ms: dashMs() }; },
    e => { DASH.st[key] = { s: 'fail', why: String((e && e.message) || e || '') }; })
    .then(() => { clearTimeout(timer); delete DASH.memo[key]; if (DASH.st[key].s === 'ok') dashStore(key); dashChanged(key); });
}
// Every source, in order: Sales · PPC · Inventory first, then Listing Health, then the four that read the listing lists.
function dashPrefetch() {
  if (!dashMay('dash')) return;
  ['sales', 'ads', 'age', 'health', 'img', 'lerr', 'bsr', 'lh'].forEach(dashRun);
}

/* ================= WHAT A CARD SHOWS: fresh, else cached (amber), else a shimmer while loading, else why not ================= */
function dashData(key) {
  if (!dashMayKey(key)) return { state: 'deny' };
  const st = DASH.st[key] || { s: 'idle' };
  if (st.s === 'ok') {
    const res = dashCalc(key);
    if (res && res[DASH.brand]) { dashMark(key, 'fresh'); return { state: 'fresh', v: res[DASH.brand] }; }
  }
  const c = (dashCacheAll()[key] || {})[DASH.brand];
  if (c && (key !== 'ads' || c.ab === dashAdKey())) {
    dashMark(key, 'cached');
    return { state: 'cached', v: c, note: st.s === 'loading' || st.s === 'idle' ? ' · updating…' : st.why ? ' · ' + st.why : " · couldn't update" };
  }
  if (st.s === 'loading' || st.s === 'idle') return { state: 'loading' };
  return { state: 'fail', why: st.why };
}
// For the timing report: when each card first showed its cached and its fresh number (ms after sign-in).
function dashMark(key, kind) {
  const t = DASH.timing[key] || (DASH.timing[key] = {});
  if (t[kind] == null && dashShown()) t[kind] = dashMs();
}
const dashOk = d => d.state === 'fresh' || d.state === 'cached';
const dashSk = w => `<span class="dash-sk" style="width:${w}"></span>`;
const dashOpenBtn = (tab, extra) => (dashMay(tab) ? `<button type="button" class="dash-open" data-dash-open="${tab}"${extra || ''}>Open →</button>` : '');
// The line under a card.
function dashFoot(d, tab, when) {
  if (d.state === 'deny') return '<div class="dash-w">not in your access</div>';
  if (d.state === 'loading') return '<div class="dash-w is-wait">loading…</div>';
  if (d.state === 'fail') return `<div class="dash-w" title="${dashEsc(d.why || '')}">couldn't load · <button type="button" class="dash-go" data-dash-open="${tab}">open the screen</button></div>`;
  if (d.state === 'cached') { const t = 'as of ' + dashWhen(d.v.at) + d.note; return `<div class="dash-w is-old" title="${dashEsc(t)}">${dashEsc(t)}</div>`; }
  return `<div class="dash-w" title="${dashEsc(when)}">${dashEsc(when)}</div>`;
}
// A number that counts: the exact text is there from the start; the animation only runs towards it. k names it across redraws.
const dashCu = (v, fmt, k, tag) => `<${tag || 'span'} data-cu="${Number(v) || 0}" data-fmt="${fmt}" data-k="${k}">${dashEsc(DASH_FMT[fmt](v))}</${tag || 'span'}>`;
const dashDelta = (now, was) => (was ? `<span class="${now >= was ? 'dash-up' : 'dash-dn'}">${now < was ? '▼' : '▲'}${Math.abs((now - was) / was * 100).toFixed(1)}%</span> vs LY`
  : '<span>— vs LY</span>');

function dashKpi(i, icon, label, tab, d, value, sub) {
  const ok = dashOk(d) && !d.v.empty;
  return `<article class="dash-card dash-kpi" style="--i:${i}">
    <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${label}</span>${dashOpenBtn(tab)}</div>
    <div class="dash-v${ok ? '' : ' is-none'}">${ok ? value() : d.state === 'loading' ? dashSk('62%') : '—'}</div>
    <div class="dash-s">${ok ? sub() : d.state === 'loading' ? dashSk('45%') : ''}</div>
    ${dashFoot(d, tab, ok ? d.v.when : dashOk(d) ? d.v.when : '')}</article>`;
}
// A "needs attention" tile: the whole tile opens its screen; it pulses softly while its number is above 0.
function dashTile(i, icon, label, tab, d, big, more, hot) {
  const ok = dashOk(d) && !d.v.empty;
  const go = dashMay(tab);
  const foot = d.state === 'deny' ? '<span class="dash-w">not in your access</span>' : d.state === 'loading' ? '<span class="dash-w is-wait">loading…</span>'
    : d.state === 'fail' ? `<span class="dash-w" title="${dashEsc(d.why || '')}">couldn't load · open the screen</span>`
      : d.state === 'cached' ? `<span class="dash-w is-old">${dashEsc('as of ' + dashWhen(d.v.at) + d.note)}</span>` : `<span class="dash-w">${dashEsc(d.v.when)}</span>`;
  return `<button type="button" class="dash-card dash-tile${ok && hot(d.v) ? ' is-hot' : ''}" style="--i:${i}"${go ? ` data-dash-open="${tab}"` : ' disabled'}>
    <span class="dash-t"><span class="dash-ic" aria-hidden="true">${icon}</span>${dashEsc(label)}</span>
    <b>${ok ? big(d.v) : d.state === 'loading' ? dashSk('40%') : '—'}</b><span class="dash-more">${ok ? more(d.v) : dashOk(d) ? dashEsc(d.v.when) : ''}</span>
    ${foot}${go ? '<span class="dash-open">Open →</span>' : ''}</button>`;
}

// Each card's HTML; i = its place in the stagger.
const DASH_PAINT = {
  kSales: i => { const d = dashData('sales'); return dashKpi(i, '💰', 'Sales MTD', 'sales', d, () => dashCu(d.v.mtd, 'money', 'mtd'), () => dashDelta(d.v.mc, d.v.ml) + ' <span>· complete days</span>'); },
  kYtd: i => { const d = dashData('sales'); return dashKpi(i, '📈', 'Sales YTD', 'sales', d, () => dashCu(d.v.ytd, 'money', 'ytd'), () => dashDelta(d.v.yc, d.v.yl) + ' <span>· complete days</span>'); },
  kAds: i => {
    const d = dashData('ads');
    return dashKpi(i, '📢', 'Ad spend · latest week', 'ppcn', d, () => dashCu(d.v.last.spend, 'money', 'spend'),
      () => `<span>TACoS <b class="${d.v.tacos != null && d.v.tacos > 20 ? 'dash-bad' : ''}">${d.v.tacos == null ? '—' : d.v.tacos + '%'}</b></span>`
        + `<span>${dashEsc(wLabel(d.v.last.w))}${d.v.last.done ? '' : ' · ' + wDaysIn(d.v.last.w) + '/7 days'}</span>${d.v.only ? `<span>${dashEsc(d.v.only)}</span>` : ''}`);
  },
  kList: i => {
    const d = dashData('health');
    return dashKpi(i, '🩺', 'Listings', 'health', d, () => dashCu(d.v.n, 'num', 'ln'),
      () => `<span><b class="dash-bad">${DASH_FMT.num(d.v.critical)}</b> critical</span><span>${DASH_FMT.num(d.v.action + d.v.review)} to review</span>`);
  },
  flow: i => {
    const h = dashData('health'), l = dashData('lh');
    const hv = dashOk(h) && !h.v.empty ? h.v : null, lv = dashOk(l) && !l.v.empty ? l.v : null;
    const step = (s, cls, label, src, v, sub, tab, level) => {
      const go = dashMay(tab);
      const val = v != null ? dashCu(v, 'num', 'f' + s) : src.state === 'loading' ? dashSk('50%') : '—';
      return `<button type="button" class="dash-step ${cls}${src.state === 'cached' ? ' is-old' : ''}" style="--s:${s}"${go ? ` data-dash-open="${tab}"${level ? ` data-dash-level="${level}"` : ''}` : ' disabled'}`
        + ` title="${dashEsc(label)}${go ? ' — open' : ''}"><span class="dash-step-l">${dashEsc(label)}</span><b>${val}</b><small>${dashEsc(sub)}</small></button>`;
    };
    const arrow = s => `<span class="dash-arrow" style="--s:${s}" aria-hidden="true"><svg viewBox="0 0 44 12"><path pathLength="1" d="M3 6H39"/><path pathLength="1" d="M34 1.5 39.5 6 34 10.5"/></svg></span>`;
    const lhTab = dashMay('lhist') ? 'lhist' : 'health';
    // the line under it: Listing Health's, then Listing History's
    const part = (d, tab) => (d.state === 'fresh' ? d.v.when : d.state === 'cached' ? 'as of ' + dashWhen(d.v.at) + d.note : d.state === 'loading' ? 'loading…'
      : d.state === 'fail' ? "couldn't load" : '');
    const old = h.state === 'cached' || l.state === 'cached';
    const line = [...new Set([part(h), part(l)])].filter(Boolean).join(' · ');
    return `<article class="dash-card dash-flowcard" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🔁</span>Listing flow</span>${dashOpenBtn('health')}</div>
      <div class="dash-flowrow">
        <div class="dash-track" aria-hidden="true"><span class="dash-runner"><i></i></span></div>
        ${step(0, '', 'All listings', h, hv ? hv.n : null, 'in Listing Health', 'health', 'ALL')}${arrow(0)}
        ${step(1, 'is-act', 'Problems found', h, hv ? hv.critical + hv.action + hv.review : null, 'critical · action · review', 'health', 'ALL')}${arrow(1)}
        ${step(2, 'is-bad', 'Critical', h, hv ? hv.critical : null, 'fix first', 'health', 'critical')}${arrow(2)}
        ${step(3, 'is-brand', 'Fixed / Approved', l, lv ? lv.fixed : null, 'sent this month', lhTab)}${arrow(3)}
        ${step(4, 'is-ok', 'On Amazon', l, lv ? lv.amz : null, 'accepted this month', lhTab)}
      </div>
      <div class="dash-w${old ? ' is-old' : ''}${h.state === 'loading' && l.state === 'loading' ? ' is-wait' : ''}" title="${dashEsc(line)}">${dashEsc(line)}${
        h.state === 'fail' && !old ? ' · <button type="button" class="dash-go" data-dash-open="health">open the screen</button>' : ''}</div></article>`;
  },
  donut: i => {
    const d = dashData('health');
    const ok = dashOk(d) && !d.v.empty && d.v.per;
    const one = b => {
      const x = d.v.per[b];
      const parts = [['is-c', x.critical], ['is-a', x.action], ['is-r', x.review], ['is-h', x.healthy], ['is-u', x.unchecked || 0]];
      const total = parts.reduce((s, p) => s + p[1], 0) || 1;
      let at = 0;
      const segs = parts.filter(p => p[1] > 0).map(([cls, n]) => {
        const len = n / total * 100;
        const seg = `<circle class="dash-seg ${cls}" cx="60" cy="60" r="44" pathLength="100" stroke-dasharray="${Math.max(0, len - (len > 1.2 ? 0.6 : 0)).toFixed(2)} 100" stroke-dashoffset="${(-at).toFixed(2)}"><title>${DASH_FMT.num(n)}</title></circle>`;
        at += len;
        return seg;
      }).join('');
      return `<figure class="dash-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${dashEsc(dashName(b))}: ${x.critical} critical, ${x.action} needs action, ${x.review} review, ${x.healthy} healthy">`
        + `<defs><mask id="dashMask${b}"><circle class="dash-dm" cx="60" cy="60" r="44" pathLength="1" stroke="white" transform="rotate(-90 60 60)"/></mask></defs>`
        + `<g mask="url(#dashMask${b})"><g transform="rotate(-90 60 60)">${segs}</g></g>`
        + `<text class="dash-mid" x="60" y="62" text-anchor="middle">${dashCu(x.n, 'num', 'dn' + b, 'tspan')}</text><text class="dash-midl" x="60" y="77" text-anchor="middle">listings</text></svg>`
        + `<figcaption>${dashEsc(dashName(b))}</figcaption><div class="dash-mini">`
        + [['is-c', x.critical], ['is-a', x.action], ['is-r', x.review], ['is-h', x.healthy]].map(([cls, n]) => `<span><i class="dash-dot ${cls}"></i>${DASH_FMT.num(n)}</span>`).join('')
        + '</div></figure>';
    };
    const bs = ok ? Object.keys(d.v.per) : [];
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">🍩</span>Listing Health</span>${dashOpenBtn('health')}</div>
      ${ok ? `<div class="dash-donuts">${bs.map(one).join('')}</div>
      <div class="dash-key"><span><i class="dash-dot is-c"></i>Critical</span><span><i class="dash-dot is-a"></i>Needs Action</span><span><i class="dash-dot is-r"></i>Review</span><span><i class="dash-dot is-h"></i>Healthy</span>${bs.some(b => d.v.per[b].unchecked) ? '<span><i class="dash-dot is-u"></i>Not checked</span>' : ''}</div>`
        : d.state === 'loading' ? '<div class="dash-donuts"><span class="dash-sk is-round"></span><span class="dash-sk is-round"></span></div>' : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(d, 'health', ok ? d.v.when : '')}</article>`;
  },
  line: i => {
    const d = dashData('sales');
    const ok = dashOk(d) && d.v.pts && d.v.pts.length;
    let svg = '';
    if (ok) {
      const pts = d.v.pts;
      const W = 300, H = 120, L = 4, R = 4, T = 8, B = 18;
      const max = Math.max(1, ...pts.map(p => p.v));
      const x = k => L + (pts.length === 1 ? (W - L - R) / 2 : k / (pts.length - 1) * (W - L - R));
      const y = v => T + (H - T - B) - v / max * (H - T - B);
      const line = pts.map((p, k) => (k ? 'L' : 'M') + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
      const area = `M${x(0).toFixed(1)} ${H - B} ` + pts.map((p, k) => 'L' + x(k).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ') + ` L${x(pts.length - 1).toFixed(1)} ${H - B} Z`;
      const short = iso => String(Number(iso.slice(8, 10))) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1];
      svg = `<svg class="dash-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales, last 90 days">`
        + `<line class="dash-base" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`
        + `<path class="dash-area" d="${area}"/><path class="dash-line" pathLength="1" d="${line}"/>`
        + `<text class="dash-axis" x="${L}" y="${H - 4}">${short(pts[0].d)}</text><text class="dash-axis" x="${W - R}" y="${H - 4}" text-anchor="end">${short(pts[pts.length - 1].d)}</text>`
        + `<text class="dash-axis" x="${W - R}" y="${T + 2}" text-anchor="end">top day ${DASH_FMT.money(max)}</text></svg>`;
    }
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📊</span>Sales · last 90 days</span>${dashOpenBtn('sales')}</div>
      ${ok ? `<div class="dash-s"><b>${dashCu(d.v.pts.reduce((t, p) => t + p.v, 0), 'money', 's90')}</b><span>in 90 days</span></div>${svg}`
        : d.state === 'loading' ? `<div class="dash-s">${dashSk('40%')}</div><span class="dash-sk is-chart"></span>` : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(d, 'sales', ok ? d.v.when : '')}</article>`;
  },
  bars: i => {
    const d = dashData('ads');
    const ok = dashOk(d) && !d.v.empty && d.v.per && d.v.per.length;
    let svg = '';
    if (ok) {
      const W = 300, H = 130, T = 6, B = 18;
      const n = d.v.per.length, gw = W / n, bw = Math.min(14, gw * 0.32);
      const max = Math.max(1, ...d.v.per.map(p => Math.max(p.rev, p.spend)));
      const h = v => v / max * (H - T - B);
      svg = `<svg class="dash-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales and ad spend, last ${n} weeks">`
        + `<line class="dash-base" x1="0" y1="${H - B}" x2="${W}" y2="${H - B}"/>`
        + d.v.per.map((p, k) => {
          const cx = gw * k + gw / 2, run = p.done ? '' : ' is-run';
          const tip = `${wLabel(p.w)}${p.done ? '' : ' (still running)'} — sales ${DASH_FMT.money(p.rev)}, ad spend ${DASH_FMT.money(p.spend)}`;
          return `<g><title>${dashEsc(tip)}</title>`
            + `<rect class="dash-bar is-sales${run}" style="--b:${k * 2}" x="${(cx - bw - 1).toFixed(1)}" y="${(H - B - h(p.rev)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.rev).toFixed(1)}" rx="2"/>`
            + `<rect class="dash-bar is-spend${run}" style="--b:${k * 2 + 1}" x="${(cx + 1).toFixed(1)}" y="${(H - B - h(p.spend)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(p.spend).toFixed(1)}" rx="2"/>`
            + `<text class="dash-axis" x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${dashEsc(wLabel(p.w).split('-')[0])}</text></g>`;
        }).join('') + '</svg>';
    }
    return `<article class="dash-card" style="--i:${i}">
      <div class="dash-h"><span class="dash-t"><span class="dash-ic" aria-hidden="true">📦</span>PPC · weekly</span>${dashOpenBtn('ppcn')}</div>
      ${ok ? `<div class="dash-key" style="justify-content:flex-start"><span><i class="dash-dot is-sales"></i>Sales</span><span><i class="dash-dot is-spend"></i>Ad spend</span>${d.v.only ? `<span>${dashEsc(d.v.only)}</span>` : ''}</div>${svg}`
        : d.state === 'loading' ? `<div class="dash-s">${dashSk('35%')}</div><span class="dash-sk is-chart"></span>` : '<div class="dash-v is-none">—</div>'}
      ${dashFoot(d, 'ppcn', ok ? d.v.when : '')}</article>`;
  },
  tImg: i => dashTile(i, '🖼', 'Need pictures', 'img', dashData('img'), v => dashCu(v.n, 'num', 'img'), v => 'listings that need pictures · Image Manager' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.n > 0),
  tErr: i => dashTile(i, '⚠️', 'Listing errors', 'lerr', dashData('lerr'), v => dashCu(v.n, 'num', 'err'), v => 'listings with an Amazon error' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.n > 0),
  tBsr: i => dashTile(i, '📉', 'BSR got worse', 'bsr', dashData('bsr'), v => dashCu(v.n, 'num', 'bsr'), v => 'parents' + (v.high != null ? ` · ${DASH_FMT.num(v.high)} high priority` : ''), v => v.n > 0),
  tAge: i => dashTile(i, '⏳', 'Aged 181+ units', 'age', dashData('age'), v => dashCu(v.units, 'num', 'aged'),
    v => (v.storage ? dashCu(v.storage, 'usd2', 'stor') : '—') + ' storage' + (v.only ? ' · ' + dashEsc(v.only) : ''), v => v.units > 0),
};

/* ================= DRAWING ================= */
// Draw these cards. mode 'intro' = the page arriving (stagger, count from 0); 'swap' = new numbers for cards already on screen
// (they count over from what was shown; nothing else moves).
function dashPaint(ids, mode) {
  const eng = DASH.eng || 'none';                 // the motion chosen when the page was drawn (dashRender)
  ids.forEach(id => {
    const el = $('dash-' + id);
    if (!el) return;
    dashKill(id);
    let html;
    try { html = DASH_PAINT[id](DASH_SLOTS.indexOf(id)); } catch (e) { html = '<article class="dash-card"><div class="dash-v is-none">—</div></article>'; }
    el.classList.toggle('is-swap', mode === 'swap');
    el.innerHTML = html;
    try { dashAnimate(id, el, mode === 'swap' ? 0 : DASH_SLOTS.indexOf(id), mode, eng); } catch (e) { /* shown as it is */ }
  });
}
// The whole page: greeting, date, brand switch, then every card.
function dashRender() {
  const root = $('dashRoot');
  if (!root) return;
  dashKillAll();
  dashStop();
  DASH.memo = {};
  DASH.shown = {};
  const eng = DASH.eng = dashEngine();
  $('paneDash').classList.toggle('dash-fx', eng === 'css');
  $('paneDash').classList.toggle('dash-gs', eng === 'gsap');
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const who = (typeof sqName === 'function' ? sqName(ME.email) : '').split(' ')[0];
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const brand = (v, t) => `<button type="button" data-dash-brand="${v}" aria-pressed="${DASH.brand === v}">${t}</button>`;
  const slot = id => `<div class="dash-slot" id="dash-${id}"></div>`;
  root.innerHTML = '<div class="dash-glow" aria-hidden="true"><i></i><i></i><i></i></div>'
    + `<header class="dash-hero"><div><h3 class="dash-hi">${hi}${who ? ', ' + dashEsc(who) : ''}</h3><div class="dash-date">${dashEsc(date)}</div></div>`
    + `<div class="dash-brands" role="group" aria-label="Brand">${brand('ALL', 'Both')}${brand('SP', 'Ridhi')}${brand('CPC', 'CPC')}</div></header>`
    + `<section class="dash-grid dash-kpis">${['kSales', 'kYtd', 'kAds', 'kList'].map(slot).join('')}</section>`
    + `<section class="dash-grid">${slot('flow')}</section>`
    + `<section class="dash-grid dash-row3">${['donut', 'line', 'bars'].map(slot).join('')}</section>`
    + `<section class="dash-grid dash-tiles">${['tImg', 'tErr', 'tBsr', 'tAge'].map(slot).join('')}</section>`;
  DASH.rendered = true;
  if (eng === 'gsap') dashGsRoot(root);
  dashPaint(DASH_SLOTS, 'intro');
}

/* ================= MOTION — GSAP, else CSS; nothing when ✨ is off ================= */
// GSAP, fetched once, the first time the Dashboard opens with ✨ on. true = ready, false = could not load (CSS from then on).
function dashGsap() {
  if (window.gsap && DASH.gs === true) return Promise.resolve(true);
  if (!DASH.gsTry) DASH.gsTry = new Promise(resolve => {
    try {
      if (window.gsap) { window.gsap.config({ nullTargetWarn: false }); DASH.gs = true; return resolve(true); }
      const s = document.createElement('script');
      s.src = DASH_GSAP_URL;
      s.async = true;
      s.onload = () => {
        try { window.gsap.config({ nullTargetWarn: false }); DASH.gs = true; } catch (e) { DASH.gs = false; }
        resolve(DASH.gs);
      };
      s.onerror = () => { DASH.gs = false; resolve(false); };
      document.head.appendChild(s);
    } catch (e) { DASH.gs = false; resolve(false); }
  });
  return DASH.gsTry;
}
const dashTw = (id, t) => { (DASH.tw[id] || (DASH.tw[id] = [])).push(t); return t; };
function dashKill(id) {
  (DASH.tw[id] || []).forEach(t => { try { t.kill(); } catch (e) { /* gone */ } });
  DASH.tw[id] = [];
}
const dashKillAll = () => Object.keys(DASH.tw).forEach(dashKill);
// The page itself: the greeting rises in, the glow drifts.
function dashGsRoot(root) {
  const g = window.gsap;
  dashTw('root', g.from(root.querySelector('.dash-hero'), { opacity: 0, y: 14, duration: 0.5, ease: 'power3.out', clearProps: 'opacity,transform' }));
  root.querySelectorAll('.dash-glow i').forEach((blob, k) => {
    dashTw('root', g.to(blob, { xPercent: 10 + k * 3, yPercent: 14 - k * 4, scale: 1.15, duration: 18 + k * 5, ease: 'sine.inOut', yoyo: true, repeat: -1 }));
  });
}
// One card: its entrance (intro), its numbers, its chart, the flow's dot, the hover lift.
function dashAnimate(id, el, i, mode, eng) {
  dashNumbers(id, el, i, mode, eng);
  if (eng !== 'gsap') return;
  const g = window.gsap;
  const d = i * 0.08 + 0.06;
  const card = el.querySelector('.dash-card');
  if (card) {
    card.addEventListener('mouseenter', () => g.to(card, { y: -3, duration: 0.2, ease: 'power2.out', overwrite: 'auto' }));
    card.addEventListener('mouseleave', () => g.to(card, { y: 0, duration: 0.25, ease: 'power2.out', overwrite: 'auto' }));
  }
  const run = el.querySelector('.dash-runner');
  if (run) {
    const down = window.matchMedia && window.matchMedia('(max-width:700px)').matches;
    const tl = g.timeline({ repeat: -1, delay: mode === 'intro' ? d + 1.6 : 0.4 });
    tl.fromTo(run, down ? { yPercent: 0 } : { xPercent: 0 }, Object.assign(down ? { yPercent: 100 } : { xPercent: 100 }, { duration: 5, ease: 'none' }), 0)
      .fromTo(run, { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0).to(run, { opacity: 0, duration: 0.3 }, 4.7);
    dashTw(id, tl);
  }
  if (mode !== 'intro') return;
  if (card) dashTw(id, g.from(card, { opacity: 0, y: 14, duration: 0.55, ease: 'power3.out', delay: d, clearProps: 'opacity' }));
  const steps = el.querySelectorAll('.dash-step');
  if (steps.length) dashTw(id, g.from(steps, { opacity: 0, y: 10, duration: 0.45, ease: 'power2.out', delay: d + 0.16, stagger: 0.17, clearProps: 'opacity,transform' }));
  el.querySelectorAll('.dash-arrow').forEach((a, k) => dashTw(id, g.fromTo(a.querySelectorAll('path'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power1.out', delay: d + 0.25 + k * 0.17 })));
  el.querySelectorAll('.dash-dm').forEach(m => dashTw(id, g.fromTo(m, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out', delay: d + 0.22 })));
  el.querySelectorAll('.dash-line').forEach(p => dashTw(id, g.fromTo(p, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: 'power1.out', delay: d + 0.22 })));
  el.querySelectorAll('.dash-area').forEach(p => dashTw(id, g.from(p, { opacity: 0, duration: 0.9, delay: d + 0.7 })));
  const bars = el.querySelectorAll('.dash-bar');
  if (bars.length) dashTw(id, g.from(bars, { scaleY: 0, transformOrigin: '50% 100%', duration: 0.6, ease: 'power3.out', delay: d + 0.22, stagger: 0.045 }));
}
// The numbers: from 0 on arrival; on a swap from the number that was on screen (a flash says it changed); always ending on the exact text.
function dashNumbers(id, el, i, mode, eng) {
  el.querySelectorAll('[data-cu]').forEach(n => {
    const v = Number(n.dataset.cu), fmt = DASH_FMT[n.dataset.fmt], k = n.dataset.k;
    const prev = k in DASH.shown ? DASH.shown[k] : null;
    DASH.shown[k] = v;
    if (!fmt || eng === 'none') return;
    const from = mode === 'swap' ? (prev == null ? 0 : prev) : 0;
    if (from === v) return;
    const end = n.textContent;
    const delay = mode === 'swap' ? 0 : i * 80 + 160;
    if (eng === 'gsap') {
      const g = window.gsap, o = { x: from };
      n.textContent = fmt(from);
      dashTw(id, g.to(o, { x: v, duration: 0.8, ease: 'power2.out', delay: delay / 1000,
        onUpdate: () => { n.textContent = fmt(o.x); }, onComplete: () => { n.textContent = end; } }));
      if (mode === 'swap' && prev != null) dashTw(id, g.fromTo(n, { opacity: 0.35 }, { opacity: 1, duration: 0.6, ease: 'power1.out' }));
      return;
    }
    n.textContent = fmt(from);
    DASH.cu.push({ el: n, from, v, fmt, end, t0: performance.now() + delay });
  });
  if (DASH.cu.length && !DASH.raf) DASH.raf = requestAnimationFrame(dashTick);
  if (DASH.cu.length) { clearTimeout(DASH.safety); DASH.safety = setTimeout(dashStop, 3000); }   // a frame that never comes: the exact text anyway
}
function dashTick(t) {
  DASH.raf = 0;
  DASH.cu = DASH.cu.filter(x => {
    if (!x.el.isConnected) return false;
    const p = Math.min(1, Math.max(0, (t - x.t0) / 800));
    if (p >= 1) { x.el.textContent = x.end; return false; }
    x.el.textContent = x.fmt(x.from + (x.v - x.from) * (1 - Math.pow(1 - p, 3)));
    return true;
  });
  if (DASH.cu.length) DASH.raf = requestAnimationFrame(dashTick);
}
// Stop the CSS-mode counting: every number its exact text, now.
function dashStop() {
  if (DASH.raf) cancelAnimationFrame(DASH.raf);
  DASH.raf = 0;
  DASH.cu.forEach(x => { x.el.textContent = x.end; });
  DASH.cu = [];
  clearTimeout(DASH.safety);
}

/* ================= OPENING A SCREEN FROM A CARD ================= */
// Listing Health opens with the level asked for (and the brand on view), exactly as its own level boxes set it.
function dashOpen(tab, level) {
  if (!dashMay(tab)) return;
  if (tab === 'health') {
    const pick = (id, v) => { const el = $(id); if (el && [...el.options].some(o => o.value === v)) el.value = v; };
    if (level) pick('hIssueView', level);
    pick('hBrandView', DASH.brand);
  }
  showTab(tab);
}

/* ================= THE SCREEN, THE SWITCH, THE LOGO, SIGN-IN ================= */
// Opening the Dashboard: drawn at once (fresh, cached or shimmering cards); the loads already running fill it as they land. The first
// time with ✨ on, GSAP is fetched — waited for at most 300 ms, after which the CSS motion is used for this drawing.
async function ensureDash() {
  if (!DASH_READY) return;
  dashPrefetch();
  if (dashFxOn() && DASH.gs == null) await Promise.race([dashGsap(), dashSleep(300)]);
  if ($('paneDash').classList.contains('hide')) return;
  try { dashRender(); } catch (e) { /* the page stays as it was */ }
}
(() => {
  try {
    const saved = dashGet(DASH_LS.brand);
    if (saved === 'ALL' || saved === 'SP' || saved === 'CPC') DASH.brand = saved;
  } catch (e) { /* Both */ }
  const pane = $('paneDash');
  if (pane) pane.addEventListener('click', e => {
    const b = e.target.closest('[data-dash-brand]');
    if (b) {
      DASH.brand = b.dataset.dashBrand;
      dashSet(DASH_LS.brand, DASH.brand);
      dashRender();
      return;
    }
    const o = e.target.closest('[data-dash-open]');
    if (o && !o.disabled) dashOpen(o.dataset.dashOpen, o.dataset.dashLevel || '');
  });
  // ✨: aria-pressed = the choice; the title also says when the computer's reduced-motion setting keeps it still.
  const btn = $('fxBtn');
  const sync = () => {
    if (!btn) return;
    const on = dashFxSaved();
    btn.setAttribute('aria-pressed', String(on));
    btn.title = 'Dashboard animation: ' + (on ? (dashReduce() ? 'on, but your computer asks for reduced motion' : 'on') : 'off');
  };
  if (btn) btn.addEventListener('click', async () => {
    dashSet(DASH_LS.fx, dashFxSaved() ? '0' : '1');
    sync();
    if (!dashShown()) return;
    if (dashFxOn() && DASH.gs == null) await Promise.race([dashGsap(), dashSleep(300)]);
    dashRender();
  });
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { sync(); if (dashShown()) dashRender(); });
  } catch (e) { /* the setting is read again on every draw */ }
  sync();
  // The Sellora logo opens the Dashboard (the menu's close button beside it keeps its own job).
  document.querySelectorAll('#sideNav .brandtile, #sideNav .brandname').forEach(el => el.addEventListener('click', () => {
    if (dashMay('dash')) showTab('dash');
  }));
  // SIGN-IN: the loads start as soon as the account's rights are known (core/access.js applyPerms), whatever screen opens first.
  try {
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      DASH.t0 = performance.now();
      const email = String(user.email || '').toLowerCase();
      for (let i = 0; i < 300 && !(ME.email === email && dashMay('dash')); i++) await dashSleep(25);
      dashPrefetch();
    });
  } catch (e) { /* the loads then start when the Dashboard opens */ }
  DASH_READY = true;
})();
