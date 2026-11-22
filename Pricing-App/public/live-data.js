/* LIVE VS LAST YEAR — THE NEW BACKEND (Ravi, 21 Nov 2026: "switch both to the new backend").
 *
 * Both pages — public/live.html and Sellora's Live vs Last Year (src/app/sales/live-yoy.js) — now read their figures from
 * Supabase (schema sellora, filled every 10 minutes by Sellora-Backend), with ONE call: sellora.page_data. This file turns
 * that answer into the very shapes the pages were drawn from before (Apps Script's ?live=yoy / ?live=range / ?live=hist
 * and its published-sheet snapshot), so no drawing code changed — only where the numbers come from.
 *
 * Why: the new backend reads every day whole from the APIs (Apps Script's newest day was half a day — 20 Nov Ridhi
 * Shopify read $5,683 for $6,971), has Meta (in dollars), and is one small read instead of a large sheet.
 *
 *   LiveData.load(day)           the page_data answer for a Pacific day (default today); the full history once, then
 *                                only the last days on refresh, laid over what is already here
 *   LiveData.ready(pd, day)      true when the backend has that day by the hour for both brands (else: use Apps Script)
 *   LiveData.brandYoy(pd, b)     = Apps Script's ?live=yoy answer for brand SP or CPC
 *   LiveData.range(pd, b, from, to, shift) = ?live=range
 *   LiveData.hist(pd)            = ?live=hist
 *   LiveData.snapshot(pd)        = the published-sheet snapshot live.html read (DATA)
 *
 * The publishable key below is meant to be public: it can only call sellora.page_data, never read or change a table. */
(function () {
  const URL = 'https://xkpktnsdmpkwaingvdbd.supabase.co/rest/v1/rpc/page_data';
  const KEY = 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q';
  const BRANDS = ['SP', 'CPC'];
  const MONTHS_GID = '1210035137';                  // live.html's By product tab still reads Apps Script's "months" sheet
  const FULL_EVERY = 6 * 3600 * 1000;              // the whole history again every 6 hours; the last days every refresh

  const sh = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const days = (a, b) => { const out = []; for (let d = a; d <= b; d = sh(d, 1)) out.push(d); return out; };
  const todayPT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const r2 = v => Math.round(v * 100) / 100;

  async function call(day, nDays) {
    const r = await fetch(URL, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: KEY, 'Content-Type': 'application/json', 'Content-Profile': 'sellora', 'Accept-Profile': 'sellora' },
      body: JSON.stringify({ p_day: day || null, p_days: nDays }),
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) { /* below */ }
    if (!r.ok || !j || !j.ok) throw new Error('figures not available (' + r.status + (j && j.message ? ': ' + j.message : '') + ')');
    return j;
  }

  // One page_data answer per day on view; a refresh asks only for the last 10 days and lays them over it.
  const CACHE = {};
  function overlay(base, top) {
    const out = JSON.parse(JSON.stringify(base));
    for (const part of ['daily', 'ads']) {          // brand → channel / ad type → day
      out[part] = out[part] || {};
      for (const b of Object.keys(top[part] || {})) {
        out[part][b] = out[part][b] || {};
        for (const k of Object.keys(top[part][b])) out[part][b][k] = Object.assign({}, out[part][b][k] || {}, top[part][b][k]);
      }
    }
    out.shop_breakdown = out.shop_breakdown || {};   // brand → day
    for (const b of Object.keys(top.shop_breakdown || {})) out.shop_breakdown[b] = Object.assign({}, out.shop_breakdown[b] || {}, top.shop_breakdown[b]);
    for (const f of ['asOf', 'day', 'ly', 'lw', 'm4', 'hours', 'events', 'runs']) out[f] = top[f];
    return out;
  }
  async function load(day) {
    const d = day || todayPT(), c = CACHE[d];
    if (!c || Date.now() - c.full > FULL_EVERY) {
      const pd = await call(d, 800);
      CACHE[d] = { pd, full: Date.now() };
      return pd;
    }
    c.pd = overlay(c.pd, await call(d, 10));
    return c.pd;
  }

  // Hour rows as the pages know them: one per Pacific hour, in order, { t, orders, units, items, sales }.
  const hourRows = (list, day) => (list || []).map(x => ({
    t: day + 'T' + String(x[0]).padStart(2, '0') + ':00', orders: +x[1] || 0, units: +x[2] || 0, items: +x[1] || 0, sales: +x[3] || 0,
  }));
  const sumRows = rows => rows.reduce((t, r) => ({ orders: t.orders + r.orders, units: t.units + r.units, sales: r2(t.sales + r.sales) }), { orders: 0, units: 0, sales: 0 });
  const dayRow = a => (a ? { orders: +a[2] || 0, units: +a[1] || 0, sales: +a[0] || 0 } : null);   // daily arrays are [sales, units, orders]
  const H = (pd, b, ch) => (((pd.hours || {})[b] || {})[ch]) || {};
  const D = (pd, b, ch) => (((pd.daily || {})[b] || {})[ch]) || {};

  function ready(pd, day) {
    return !!pd && pd.day === (day || pd.day) && BRANDS.every(b => (H(pd, b, 'amazon').now || []).length && (H(pd, b, 'amazon').ly || []).length);
  }

  // Amazon's ad figures for a day: Products + Brands + Display when the backend has them, else Apps Script's total.
  function adDay(pd, b, d) {
    const A = (pd.ads || {})[b] || {};
    const types = ['sp', 'sb', 'sd'].filter(t => A[t] && A[t][d]);
    const src = types.length ? types.map(t => A[t][d]) : (A.total && A.total[d] ? [A.total[d]] : []);
    if (!src.length) return null;
    const s = src.reduce((t, x) => t.map((v, i) => v + (+x[i] || 0)), [0, 0, 0, 0, 0]);
    return { impressions: s[0], clicks: s[1], spend: r2(s[2]), orders: s[3], sales: r2(s[4]), perType: types.length > 0 };
  }

  function brandYoy(pd, b) {
    const day = pd.day, A = H(pd, b, 'amazon'), S = H(pd, b, 'shopify'), runs = pd.runs || {};
    const now = hourRows(A.now, day);
    const week = days(sh(day, -6), sh(day, -1)).map(d => { const r = dayRow(D(pd, b, 'amazon')[d]); return r && Object.assign({ t: d }, r); }).filter(Boolean);
    week.push(Object.assign({ t: day }, sumRows(now)));
    // The ad report covers the last 8 days (sp/sb/sd); older days are in hist.ads.
    const A2 = (pd.ads || {})[b] || {}, adDays = {}, types = [];
    if (A2.sp) types.push('Products'); if (A2.sb) types.push('Brands'); if (A2.sd) types.push('Display');
    days(sh(day, -8), day).forEach(d => { const x = adDay(pd, b, d); if (x && x.perType) adDays[d] = { impressions: x.impressions, clicks: x.clicks, spend: x.spend, orders: x.orders, sales: x.sales }; });
    const adRun = runs['amazon_ads:' + b];
    const ads = types.length ? { at: adRun && adRun.at, types, days: adDays, err: adRun && !adRun.ok ? adRun.error : '' } : { err: adRun && !adRun.ok ? adRun.error : '' };
    const shopRun = runs['shopify:' + b];
    const shop = (S.now || []).length
      ? { now: hourRows(S.now, day), last: hourRows(S.ly, pd.ly), lastWeek: hourRows(S.lw, pd.lw), fourWk: hourRows(S.m4, pd.m4), fourWkDay: pd.m4 }
      : { err: shopRun && !shopRun.ok ? shopRun.error : 'no Shopify figures yet' };
    const M = A2.meta, metaRun = runs['meta_ads:' + b], metaDays = {};
    if (M) Object.keys(M).forEach(d => { const x = M[d]; metaDays[d] = { impressions: +x[0] || 0, clicks: +x[1] || 0, spend: +x[2] || 0, purchases: +x[3] || 0, value: +x[4] || 0 }; });
    const meta = M ? { configured: true, at: metaRun && metaRun.at, days: metaDays, err: metaRun && !metaRun.ok ? metaRun.error : '' } : { configured: false };
    return { ok: true, brand: b, asOf: pd.asOf || new Date().toISOString(), day, ly: pd.ly, lw: pd.lw,
      now, last: hourRows(A.ly, pd.ly), lastWeek: hourRows(A.lw, pd.lw), week, ads, shop, meta };
  }

  // A run of days against the same run `shift` days earlier, as ?live=range answered it. Today from its hours so far.
  function range(pd, b, from, to, shift) {
    const dates = days(from, to), lyDates = dates.map(d => sh(d, -(shift || 364))), am = D(pd, b, 'amazon'), now = {}, last = {};
    dates.forEach(d => {
      if (d < pd.day) { const r = dayRow(am[d]); if (r) now[d] = r; }
      else if (d === pd.day) now[d] = sumRows(hourRows(H(pd, b, 'amazon').now, d));
    });
    lyDates.forEach(d => { const r = dayRow(am[d]); if (r) last[d] = r; });
    return { ok: true, brand: b, asOf: pd.asOf, from, to, lyFrom: lyDates[0], lyTo: lyDates[lyDates.length - 1], dates, lyDates, now, last };
  }

  function hist(pd) {
    const d = { SP: D(pd, 'SP', 'amazon'), CPC: D(pd, 'CPC', 'amazon'), SHOP: D(pd, 'SP', 'shopify'), SHOP_CPC: D(pd, 'CPC', 'shopify') };
    let through = '';
    Object.values(d).forEach(o => Object.keys(o).forEach(k => { if (k > through && k < pd.day) through = k; }));
    const ads = {};
    BRANDS.forEach(b => {
      const A = (pd.ads || {})[b] || {}, all = new Set();
      ['sp', 'sb', 'sd', 'total'].forEach(t => Object.keys(A[t] || {}).forEach(k => all.add(k)));
      ads[b] = {};
      all.forEach(k => { const x = adDay(pd, b, k); if (x) ads[b][k] = [x.impressions, x.clicks, x.spend, x.orders, x.sales]; });
    });
    // Meta spend per day (US dollars; the ad account's own day — Ridhi's runs on India time), for the period totals.
    const meta = {};
    BRANDS.forEach(b => { const M = ((pd.ads || {})[b] || {}).meta || {}; meta[b] = {}; Object.keys(M).forEach(k => { meta[b][k] = +M[k][2] || 0; }); });
    // Shopify's own Total sales breakdown per store and Pacific day: [gross, discounts, returns, net, shipping, taxes, total, orders].
    const bd = pd.shop_breakdown || {};
    return { ok: true, at: pd.asOf, through, d, ads, meta, bd, shopCpcFrom: Object.keys(d.SHOP_CPC).sort()[0] || '', adsAt: pd.asOf };
  }

  // What live.html read from the published sheet (DATA): today against the same weekday last year, 15 Nov – 1 Dec run.
  function snapshot(pd) {
    const y = pd.day.slice(0, 4), from = y + '-11-15', to = y + '-12-01', brands = {};
    BRANDS.forEach(b => { brands[b] = { yoy: brandYoy(pd, b), range: range(pd, b, from, to, 364) }; });
    return { asOf: pd.asOf || new Date().toISOString(), day: pd.day, ly: pd.ly, lw: pd.lw, from, to, brands, hist: hist(pd), monthsGid: MONTHS_GID, source: 'sellora' };
  }

  window.LiveData = { load, ready, brandYoy, range, hist, snapshot, todayPT };
})();
