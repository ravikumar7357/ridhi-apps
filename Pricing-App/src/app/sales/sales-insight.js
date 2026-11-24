/* ================= SALES · THIS WEEK IN PLAIN ENGLISH: why revenue fell / rose last week (Sales card #2, 23 Nov 2026) =================
 * Screens: the chapter "This week, explained." on the Sales Dashboard (#viBox, 23 Nov 2026 — the approved chapters design): the
 *          headline "Revenue rose $56,659" with its ▲ / ▼ badge, the weeks, the summary and Show details (remembered: localStorage viOpen) on the
 *          left; ▲ Biggest gains | ▼ Biggest drops (a bar per mover, up to 2 driver pills) on the right. And ONE card on the Dashboard (the
 *          headline, the first sentence, Open →; core/dashboard.js slot tVi). The per-product days it reads also feed the Sales Dashboard's
 *          top products (sales/sales-charts.js).
 * Does — THE MOVERS (code, no AI: this decides everything): the last FINISHED week (Sunday → Saturday, US Pacific days, the
 *   PPC & Organic weeks) against the week before, per brand (Ridhi, CPC, Both = Ridhi + CPC), from PPC weekly sales per ASIN
 *   (docs/sales-metrics.md "PPC weekly sales": the Orders workbooks per ASIN, no Shopify). Products are grouped by parent (Listing
 *   Health's parent, as PPC & Organic does; an ASIN it never saw stands alone). The biggest $ drops and gains (at most VI_TOP each,
 *   VI_BARS bars) are the movers; "everything else" is the rest, so movers + everything else = the brand's change TO THE CENT
 *   (viCompute checks it, in whole cents, and says so if it ever did not). A second line: the same week last year (52 weeks back) —
 *   from the Sales Dashboard's daily history (the 800-day nightly cache, Seller Central's totals where published), both weeks from it,
 *   because PPC & Organic's store does not keep a year of weeks (the bars never mix the two sources).
 *   EACH MOVER'S DRIVER, only what the data shows (else "no clear driver"), in this order:
 *     price       revenue = price × units: when the price part of the change is bigger than the units part and the average selling
 *                 price (sales ÷ units) moved ≥ VI_T.price % → "price +15%"
 *     out of stock  a fall, Amazon's FBA stock for the parent's SKUs is 0 NOW (stock/{brand}, "as of" its date) and the week had days
 *                 without a sale (the nightly per-day cache dailyAsin) → "out of stock: 0 FBA units as of 23 Nov, 3 days without a sale".
 *                 Sellora keeps no stock history, so "out of stock" is never claimed without today's 0.
 *     no sale days  a fall with ≥ 2 more days without a sale than the week before → "3 days without a sale (0 the week before)"
 *     ad spend    spend moved the same way ≥ VI_T.spend % and ≥ $VI_T.spendUsd → "ad spend −45%"   (Sponsored Products, adsAsin)
 *     traffic     sessions moved the same way ≥ VI_T.traffic % → "traffic −35% (sessions)"          (the weekly traffic report)
 *     conversion  units ÷ sessions moved the same way ≥ VI_T.conv % (≥ VI_T.minSess sessions both weeks) → "conversion −25%"
 *     seasonal    the same two weeks LAST YEAR moved the same way ≥ VI_T.season % → "seasonal lift: the same week last year rose 40%"
 *   BSR is not used (it is not in the data this card may read).
 * THE TEXT: Claude writes ONLY the 2–3 sentences, from the computed movers (POST ai: 'sales_insight' — Pricing-API/SalesAI.gs: the same
 *   engine as ListingAI.gs, AI_MODEL_FAST, the monthly cap, the AI log, one call per brand per week). Every number in Claude's text must
 *   be one of the numbers sent (viNumbersOk); otherwise — and whenever AI is off, fails or is not set up — the box shows the sentence
 *   written here from the movers (viRuleText: always works, free). The bars and tiles never need AI. An answer is kept in this browser
 *   (localStorage VI_LS) per brand + week + movers, so Refresh re-reads the data and never asks Claude twice for the same movers.
 * READS ONLY, through the existing read-only loaders: PPC & Organic's store (WEEKLY, else the Dashboard's own copy — dashLoadAds), the
 *   nightly per-day cache (baCall cache: 'dailyAsin'), Amazon stock (stock/{brand}, only with Listing Health / Inventory Age / Shopify
 *   rights, as Ads Health reads it) and Listing Health's snapshot for the parents (loadHealthCache, as Parent Listing Review does).
 *   NEVER wNightly (it saves), an Amazon refresh or a write anywhere but this browser.
 * Main functions: viCompute (pure: the movers, drivers and check), viDriver, viRuleText, viAiFacts, viNumbersOk, viLoad, viDraw,
 *   viBoxHtml, viDashOf. Every name starts with vi / VI. Tests: tests/sales-insight-test.js. */

const VI_TOP = 6;                                  // drops at most, and gains at most
const VI_BARS = 8;                                 // bars at most (biggest $ first)
const VI_T = { price: 5, spend: 30, spendUsd: 20, traffic: 20, conv: 15, minSess: 20, season: 20, noSale: 2 };
const VI_LS = 'viAi.v1';                           // this browser: Claude's summaries kept, per brand + week + movers
const VI_LS_MAX = 24;
const VI_NAME_MAX = 60;
const VI = { v: 0, busy: null, data: null, res: {}, ai: {}, asked: {}, err: '' };
const VI_BRAND_NAME = { SP: 'Ridhi', CPC: 'CPC', ALL: 'Ridhi + CPC' };

/* ----- dates: week keys are UTC Sundays, as PPC & Organic keeps them; compared as plain yyyy-MM-dd strings ----- */
const viDate = k => new Date(k + 'T00:00:00Z');
const viAdd = (k, n) => new Date(viDate(k).getTime() + n * 864e5).toISOString().slice(0, 10);
const viSun = k => viAdd(k, -viDate(k).getUTCDay());
const VI_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-15' → 'Nov 15-21' (PPC & Organic's wLabel). */
function viLabel(k) {
  const a = viDate(k), b = viDate(viAdd(k, 6));
  const am = VI_MON[a.getUTCMonth()], bm = VI_MON[b.getUTCMonth()];
  return am === bm ? `${am} ${a.getUTCDate()}-${b.getUTCDate()}` : `${am} ${a.getUTCDate()}-${bm} ${b.getUTCDate()}`;
}
/** The weeks compared, from today (PT, yyyy-MM-dd): L = the last finished week, P = the one before, LY / LYP = the same two 52 weeks back. */
function viWeeks(today) {
  const L = viAdd(viSun(today), -7);
  return { L, P: viAdd(L, -7), LY: viAdd(L, -364), LYP: viAdd(L, -371) };
}
// '2026-11-23 05:42' (or an ISO time) → '23 Nov'.
function viDay(at) {
  const m = String(at || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]} ${VI_MON[+m[2] - 1]}` : '';
}

/* ----- money in whole cents, so the add-up check is exact ----- */
const viC = v => Math.round((Number(v) || 0) * 100);
const VI_NF = new Intl.NumberFormat('en-US');
/** cents → '$9,400' (whole dollars, as the Sales Dashboard shows money); signed → '+$1,200' / '−$9,400'. */
function viMoney(cents, signed) {
  const d = Math.round(Math.abs(cents) / 100);
  return (signed ? (cents < 0 ? '−' : '+') : cents < 0 ? '−' : '') + '$' + VI_NF.format(d);
}
// (now − was) ÷ was × 100, or null when was is 0 (never "+100%").
const viRel = (now, was) => (was ? (now - was) / was * 100 : null);
const viPct = (v, dec) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dec == null ? 1 : dec) + '%');

/* ----- the groups: one per parent (or per product), the four weeks' cells added up ----- */
const VI_FIELDS = ['u', 'rev', 'spend', 'sessions'];
function viAddCell(into, from) {
  if (!from) return;
  VI_FIELDS.forEach(f => { if (from[f] != null) into[f] = (into[f] || 0) + (f === 'rev' || f === 'spend' ? viC(from[f]) : Number(from[f]) || 0); });
}
function viGroups(weekly, brand, wk, opt) {
  const g = {};
  const brands = brand === 'ALL' ? ['SP', 'CPC'] : [brand];
  Object.entries((weekly && weekly.rows) || {}).forEach(([asin, r]) => {
    const b = (r && r.brand) || '';
    if (!brands.includes(b)) return;
    const parent = (opt.parentOf && opt.parentOf(asin, b)) || asin;
    const key = b + '|' + parent;
    const o = g[key] || (g[key] = { key, brand: b, parent, asins: [], name: '', c: { L: {}, P: {}, LY: {}, LYP: {} } });
    o.asins.push(asin);
    if (!o.name && opt.nameOf) o.name = opt.nameOf(parent, asin, b) || '';
    ['L', 'P', 'LY', 'LYP'].forEach(k => viAddCell(o.c[k], (r.weeks || {})[wk[k]]));
  });
  Object.values(g).forEach(o => { if (!o.name) o.name = o.parent; });
  return Object.values(g);
}

/* ----- one mover's driver: only what the data shows ----- */
// Days of week k without a sale for these ASINs, from the per-day cache; null when the cache does not hold the whole week.
function viNoSaleDays(asins, k, days) {
  if (!days || !days.d || !days.from || days.from > k) return null;
  const end = viAdd(k, 6);
  if (days.upTo && days.upTo < end) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const day = viAdd(k, i);
    const u = asins.reduce((s, a) => s + (((days.d[a] || {})[day] || [0])[0] || 0), 0);
    if (!u) n++;
  }
  return n;
}
// Amazon's FBA stock now for these ASINs' SKUs: { n, at } or null when no SKU of them is in the stock document.
function viStockNow(asins, brand, stock) {
  if (!stock || !stock.m || !stock.skuOf) return null;
  let n = 0, seen = 0;
  asins.forEach(a => (stock.skuOf[a] || []).forEach(sku => { if (sku in stock.m) { seen++; n += Number(stock.m[sku]) || 0; } }));
  return seen ? { n, at: stock.at } : null;
}
/** { k, t } for one group (d = its change in cents): price · out of stock · no sale days · ad spend · traffic · conversion · seasonal · none.
 *  also = a second driver the data shows, or null. */
function viDriver(g, d, opt) {
  const c = g.c.L, p = g.c.P;
  const sign = d < 0 ? -1 : 1;
  const same = v => v != null && Math.sign(v) === sign;
  const found = [];
  const cu = c.u || 0, pu = p.u || 0;
  if (!pu && cu) found.push({ k: 'new', t: 'no sales the week before' });
  let priceRel = null, priceWins = false;
  if (cu > 0 && pu > 0) {
    const p1 = c.rev / cu, p0 = p.rev / pu;
    priceRel = viRel(p1, p0);
    const priceEff = (p1 - p0) * cu, unitEff = (cu - pu) * p0;
    priceWins = Math.abs(priceEff) > Math.abs(unitEff) && Math.abs(priceRel) >= VI_T.price;
    if (priceWins) found.push({ k: 'price', t: `price ${viPct(priceRel, 0)}` });
  }
  if (!priceWins) {
    const zL = viNoSaleDays(g.asins, opt.wk.L, opt.days), zP = viNoSaleDays(g.asins, opt.wk.P, opt.days);
    const st = d < 0 ? viStockNow(g.asins, g.brand, opt.stock && opt.stock[g.brand]) : null;
    if (d < 0 && st && st.n === 0 && zL) found.push({ k: 'oos', t: `out of stock: 0 FBA units as of ${viDay(st.at) || 'the stock snapshot'}, ${zL} day${zL === 1 ? '' : 's'} without a sale`, days: zL });
    else if (d < 0 && zL != null && zP != null && zL - zP >= VI_T.noSale) found.push({ k: 'nosale', t: `${zL} days without a sale (${zP} the week before)`, days: zL });
    if (c.spend != null && p.spend != null) {
      const r = viRel(c.spend, p.spend);
      if (same(r) && Math.abs(r) >= VI_T.spend && Math.abs(c.spend - p.spend) >= VI_T.spendUsd * 100) found.push({ k: 'ads', t: `ad spend ${viPct(r, 0)}` });
    }
    if (c.sessions != null && p.sessions != null && p.sessions > 0) {
      const r = viRel(c.sessions, p.sessions);
      if (same(r) && Math.abs(r) >= VI_T.traffic) found.push({ k: 'traffic', t: `traffic ${viPct(r, 0)} (sessions)` });
      if (c.sessions >= VI_T.minSess && p.sessions >= VI_T.minSess && pu > 0) {
        const cv = viRel(cu / c.sessions, pu / p.sessions);
        if (same(cv) && Math.abs(cv) >= VI_T.conv) found.push({ k: 'conv', t: `conversion ${viPct(cv, 0)}` });
      }
    }
    const ly = g.c.LY.rev, lyp = g.c.LYP.rev;
    if (ly != null && lyp) {
      const r = viRel(ly, lyp);
      if (same(r) && Math.abs(r) >= VI_T.season) found.push({ k: 'season', t: `seasonal ${d > 0 ? 'lift' : 'dip'}: the same week last year ${d > 0 ? 'rose' : 'fell'} ${Math.abs(r).toFixed(0)}%` });
    }
    if (priceRel != null && Math.abs(priceRel) >= VI_T.price && Math.sign(priceRel) === -sign) found.push({ k: 'price', t: `price ${viPct(priceRel, 0)}` });
  }
  const main = found[0] || { k: 'none', t: 'no clear driver' };
  return Object.assign({}, main, { also: found[1] ? found[1].t : null, more: found[1] || null });   // more: the second driver whole (the box's pills)
}

/* ----- THE MOVERS ----- */
/** Pure. opt: { weekly: { rows, at }, brand: 'SP' | 'CPC' | 'ALL', today (PT yyyy-MM-dd), parentOf(asin, brand), nameOf(parent, asin, brand),
 *  days: { d: { asin: { day: [units, sales] } }, from, upTo, at }, stock: { SP|CPC: { m: { sku: qty }, at, skuOf: { asin: [sku] } } } }.
 *  → { ok: true, brand, wk, labels, total, ly, movers, rest, explained, share, named, check, asOf } or { ok: false, why }. */
function viCompute(opt) {
  const wk = viWeeks(opt.today);
  const weekly = opt.weekly;
  if (!weekly || !weekly.rows || !Object.keys(weekly.rows).length) return { ok: false, why: 'PPC & Organic has no weekly figures saved yet.' };
  const sat = viAdd(wk.L, 6);
  // the store must be written after the week ended, or the week is only partly in it: a US Pacific Saturday ends on Sunday afternoon in
  // India, so the stamp (IST from the nightly run, UTC from a manual Refresh — both 'yyyy-MM-dd HH:mm') must be Sunday 14:00 or later
  const atDay = String(weekly.at || '').slice(0, 16);
  if (!atDay || atDay < viAdd(sat, 1) + ' 14:00') return { ok: false, why: `Last week (${viLabel(wk.L)}) is not complete in PPC & Organic's store yet (its sales are as at ${weekly.at || 'never'}). Open PPC & Organic once to fold in last night's run.`, wk };
  const groups = viGroups(weekly, opt.brand, wk, opt);
  if (!groups.length) return { ok: false, why: `No ${VI_BRAND_NAME[opt.brand] || opt.brand} products in PPC & Organic's store.`, wk };
  const has = k => groups.some(g => g.c[k].rev != null);
  if (!has('L') || !has('P')) return { ok: false, why: `PPC & Organic's store does not hold both ${viLabel(wk.L)} and ${viLabel(wk.P)}.`, wk };
  const sum = k => groups.reduce((s, g) => s + (g.c[k].rev || 0), 0);
  const now = sum('L'), was = sum('P'), total = now - was;
  // the same week last year: both weeks from the Sales Dashboard's daily history (opt.daily = its sdDays), never from the weekly store
  const ly = viLyLine(opt.daily, opt.brand, wk);
  groups.forEach(g => { g.d = (g.c.L.rev || 0) - (g.c.P.rev || 0); });
  const drops = groups.filter(g => g.d < 0).sort((a, b) => a.d - b.d).slice(0, VI_TOP);
  const gains = groups.filter(g => g.d > 0).sort((a, b) => b.d - a.d).slice(0, VI_TOP);
  const picked = drops.concat(gains).sort((a, b) => Math.abs(b.d) - Math.abs(a.d) || (a.key < b.key ? -1 : 1)).slice(0, VI_BARS);
  const movers = picked.map(g => {
    const dr = viDriver(g, g.d, Object.assign({}, opt, { wk }));
    const name = String(g.name || g.parent).replace(/^~\s*/, '').slice(0, VI_NAME_MAX);
    return { key: g.key, parent: g.parent, brand: g.brand, name, now: g.c.L.rev || 0, was: g.c.P.rev || 0, d: g.d, pct: viRel(g.c.L.rev || 0, g.c.P.rev || 0), driver: dr };
  });
  const explained = movers.reduce((s, m) => s + m.d, 0);
  const rest = total - explained;
  const check = movers.reduce((s, m) => s + m.d, 0) + rest === total && groups.reduce((s, g) => s + g.d, 0) === total;
  const top = movers[0] || null;
  return {
    ok: true, brand: opt.brand, wk, labels: { L: viLabel(wk.L), P: viLabel(wk.P), LY: viLabel(wk.LY) },
    total: { now, was, d: total, pct: viRel(now, was) },
    ly,
    movers, rest, explained, groups: groups.length,
    share: top && total ? Math.round(top.d / total * 100) : null,
    named: movers.filter(m => m.driver.k !== 'none').length,
    check,
    asOf: { sales: weekly.at || '', days: (opt.days && opt.days.at) || '', stock: Object.fromEntries(Object.entries(opt.stock || {}).map(([b, s]) => [b, (s && s.at) || ''])) },
  };
}

/** Last week against the same week last year, both from the Sales Dashboard's daily history ({ SP: { day: [sales, units, orders] } }):
 *  { now, was, d, pct } in cents, or null when that history does not hold every day of both weeks. Both = Ridhi + CPC (no Shopify). */
function viLyLine(daily, brand, wk) {
  if (!daily) return null;
  const chans = brand === 'ALL' ? ['SP', 'CPC'] : [brand];
  const week = k => { let s = 0; for (let i = 0; i < 7; i++) { const day = viAdd(k, i); for (const ch of chans) { const v = daily[ch] && daily[ch][day]; if (!v) return null; s += viC(v[0]); } } return s; };
  const now = week(wk.L), was = week(wk.LY);
  return now == null || was == null ? null : { now, was, d: now - was, pct: viRel(now, was) };
}

/* ----- the sentence written here (always works, free) ----- */
const viFell = d => (d < 0 ? 'fell' : d > 0 ? 'rose' : 'held');
/** 2–3 sentences from the movers; every number in it is one of the numbers viAiFacts sends. */
function viRuleText(res) {
  if (!res || !res.ok) return '';
  const t = res.total, brand = VI_BRAND_NAME[res.brand] || res.brand;
  const out = [];
  out.push(t.d ? `${brand} revenue ${viFell(t.d)} ${viMoney(Math.abs(t.d))} (${viPct(t.pct)}) in ${res.labels.L} against ${res.labels.P}.`
    : `${brand} revenue held level in ${res.labels.L} against ${res.labels.P}.`);
  const top = res.movers[0];
  if (top) {
    const part = res.share == null ? '' : res.share > 100 ? `, more than the whole ${t.d < 0 ? 'fall' : 'rise'}` : res.share > 0 ? `, ${res.share}% of the ${t.d < 0 ? 'fall' : 'rise'}` : '';
    out.push(`The biggest mover, ${top.name}, ${viFell(top.d)} ${viMoney(Math.abs(top.d))}${part} — ${top.driver.k === 'none' ? 'no clear driver in the data' : top.driver.t}.`);
  }
  const next = res.movers.slice(1).find(m => Math.sign(m.d) !== Math.sign(top ? top.d : 0)) || res.movers[1];
  if (next) out.push(`${next.name} ${viFell(next.d)} ${viMoney(Math.abs(next.d))} — ${next.driver.k === 'none' ? 'no clear driver' : next.driver.t}.`);
  return out.join(' ');
}

/* ----- what Claude is sent: ONLY the computed movers, every number already written as text ----- */
function viAiFacts(res) {
  return {
    brand: VI_BRAND_NAME[res.brand] || res.brand, week: res.labels.L, weekBefore: res.labels.P,
    direction: viFell(res.total.d), change: viMoney(Math.abs(res.total.d)), changePct: viPct(res.total.pct),
    topMoverShare: res.share == null ? '' : res.share + '%',
    movers: res.movers.map(m => ({ name: m.name, change: viMoney(m.d, true), changePct: viPct(m.pct, 0), driver: m.driver.k === 'none' ? 'no clear driver' : m.driver.t })),
    everythingElse: viMoney(res.rest, true),
  };
}
// A stable short key of the facts (which movers, which numbers): the same facts → the same kept answer.
function viHash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h.toString(36); }
const viAiKey = res => [res.brand, res.wk.L, viHash(JSON.stringify(viAiFacts(res)))].join('|');
/** The numbers in a text: "$9,400", "12.3%", "16-22" → [9400, 12.3, 16, 22] (signs and separators dropped). */
const viNums = text => (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(s => Number(s.replace(/,/g, ''))).filter(n => isFinite(n));
/** True when every number in `text` is one of the numbers in the facts sent (a number Claude made up, or rounded, fails). */
function viNumbersOk(text, facts) {
  const allowed = new Set(viNums(JSON.stringify(facts)));
  const got = viNums(text);
  return !!String(text || '').trim() && got.every(n => allowed.has(n));
}
function viKeptGet(key) { try { const all = JSON.parse(localStorage.getItem(VI_LS) || '{}') || {}; return all[key] || null; } catch (e) { return null; } }
function viKeptSet(key, v) {
  try {
    const all = JSON.parse(localStorage.getItem(VI_LS) || '{}') || {};
    all[key] = Object.assign({ at: Date.now() }, v);
    const keys = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
    keys.slice(VI_LS_MAX).forEach(k => { delete all[k]; });
    localStorage.setItem(VI_LS, JSON.stringify(all));
  } catch (e) { /* private window: asked again next visit (the backend keeps it too) */ }
}
/** The summary to show: { text, by: 'claude' | 'rules', why }. A kept Claude answer whose numbers all check, else the rule sentence. */
function viSummary(res) {
  const rule = { text: viRuleText(res), by: 'rules', why: '' };
  if (!res || !res.ok) return rule;
  const key = viAiKey(res), facts = viAiFacts(res);
  const kept = VI.ai[key] || viKeptGet(key);
  if (kept && kept.text) {
    if (viNumbersOk(kept.text, facts)) return { text: kept.text, by: 'claude', why: '' };
    return Object.assign(rule, { why: 'Claude\'s text named a number that is not in the movers — the rule-written summary is shown instead.' });
  }
  if (kept && kept.err) return Object.assign(rule, { why: kept.err });
  return rule;
}
// Ask Claude once for these movers (never twice for the same key in this browser); the box redraws when it lands.
async function viAskAi(res) {
  if (!res || !res.ok || !res.movers.length) return;
  const key = viAiKey(res);
  if (VI.asked[key] || VI.ai[key] || viKeptGet(key)) return;
  VI.asked[key] = true;
  try {
    // the test site stops every POST (and says so in a pop-up): the rule-written summary there, without asking
    if (typeof window !== 'undefined' && window.__TEST_ERP) { VI.ai[key] = { err: '' }; return; }
    if (typeof aiStatusCheck === 'function') await aiStatusCheck();
    if (!(typeof aiOn === 'function' && aiOn())) { VI.ai[key] = { err: '' }; return; }      // AI not set up: the rule sentence, quietly
    if (typeof adsPost !== 'function') return;
    const ans = await Promise.race([adsPost({ ai: 'sales_insight', brand: res.brand, week: res.wk.L, facts: viAiFacts(res) }),
      new Promise(r => setTimeout(() => r({ ok: false, error: 'took over a minute' }), 60000))]);
    const text = ans && (ans.text || ans.kept) ? String(ans.text || ans.kept).trim() : '';
    if (text) { VI.ai[key] = { text, model: ans.model || '' }; viKeptSet(key, { text, model: ans.model || '' }); }
    else VI.ai[key] = { err: (ans && ans.error) || '' };
  } catch (e) { VI.ai[key] = { err: '' }; }
  VI.v++;
  viDraw();
}

/* ----- the data, read only ----- */
const viCan = t => typeof ME !== 'undefined' && ME && (ME.admin || (ME.tabs || []).includes(t));
/** Load once per visit (force: read again — Refresh): the weekly store, the per-day cache, stock and the parents. */
function viLoad(force) {
  if (VI.busy) return VI.busy;
  if (VI.data && !force) return Promise.resolve(VI.data);
  VI.busy = (async () => {
    const data = { weekly: null, days: null, stock: {}, err: '' };
    try {
      if (force && typeof DASH !== 'undefined' && !(WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length)) DASH.weekly = null;
      if (typeof dashLoadAds === 'function') await dashLoadAds();          // WEEKLY as PPC & Organic holds it, else ONE read of its saved store
      data.weekly = WEEKLY.weeks.length && Object.keys(WEEKLY.rows).length ? WEEKLY : (typeof DASH !== 'undefined' && DASH.weekly) || null;
    } catch (e) { data.err = 'PPC & Organic\'s store could not be read: ' + ((e && e.message) || e); }
    try {
      const r = await baCall({ cache: 'dailyAsin' });                      // the nightly per-day cache (45 days): days without a sale
      const d = {}, brand = {};                                             // brand: which account each ASIN is in (the top products)
      Object.entries((r && r.data && r.data.d) || {}).forEach(([b, byAsin]) => Object.entries(byAsin || {}).forEach(([a, byDay]) => { d[a] = byDay; brand[a] = b; }));
      const all = Object.values(d).flatMap(byDay => Object.keys(byDay || {}));
      data.days = { d, brand, from: (r && r.data && r.data.from) || '', upTo: all.length ? all.sort().pop() : '', at: (r && r.data && r.data.at) || '' };
    } catch (e) { data.days = null; }
    try {
      // the parents (Parent Listing Review does the same); the Dashboard may be reading the same snapshot just now — wait for it then
      const dashH = () => typeof DASH !== 'undefined' && DASH.st && DASH.st.health && DASH.st.health.s === 'loading';
      for (let i = 0; !H_LOADED && dashH() && i < 400; i++) await new Promise(r => setTimeout(r, 50));
      if (!H_LOADED && viCan('health') && typeof loadHealthCache === 'function') await loadHealthCache();
    } catch (e) { /* products stand alone */ }
    if (viCan('health') || viCan('age') || viCan('shop')) {
      await Promise.all(['SP', 'CPC'].map(async b => {
        try {
          const snap = await getDoc(doc(db, 'stock', b));
          if (!snap.exists()) return;
          const s = snap.data();
          const skuOf = {};
          ((HEALTH[b] && HEALTH[b].rows) || []).forEach(r => { const a = String(r.asin || '').toUpperCase(); if (a && r.sku) (skuOf[a] || (skuOf[a] = [])).push(r.sku); });
          data.stock[b] = { m: s.m || {}, at: s.at && s.at.toDate ? s.at.toDate().toISOString() : '', skuOf };
        } catch (e) { /* no stock: "out of stock" is never claimed */ }
      }));
    }
    VI.data = data;
    VI.res = {};
    VI.v++;
    if (typeof sdcAfterVi === 'function') setTimeout(sdcAfterVi, 0);        // the Sales Dashboard's top products and event labels take them
    return data;
  })().finally(() => { VI.busy = null; });
  return VI.busy;
}
/** A parent's name: its own (Listing Rules / Listing Health), else a child's title, else ''. */
function viNameOf(parent, asin, b) {
  return (typeof PNAME !== 'undefined' && PNAME[b] && PNAME[b][parent] && PNAME[b][parent].v)
    || (typeof HEALTH !== 'undefined' && HEALTH[b] && HEALTH[b].parentNames && HEALTH[b].parentNames[parent]) || (typeof wTitle === 'function' ? wTitle(asin) : '') || '';
}
// The movers for one view (SP, CPC or ALL), worked out once per data version.
function viFor(brand) {
  if (!VI.data) return null;
  const k = brand + '@' + VI.v + '@' + (typeof sdToday === 'function' ? sdToday() : '') + '@' + (typeof H_LOADED !== 'undefined' && H_LOADED ? 'h' : '');
  if (VI.res[brand] && VI.res[brand].k === k) return VI.res[brand].r;
  const parentOf = typeof wParentOf === 'function' ? a => wParentOf(a) : null;
  const nameOf = viNameOf;
  let r;
  if (VI.data.err && !VI.data.weekly) r = { ok: false, why: VI.data.err };
  else r = viCompute({ weekly: VI.data.weekly, brand, today: sdToday(), parentOf, nameOf, days: VI.data.days, stock: VI.data.stock,
    // the Sales Dashboard's own days (sdDays: its history with Seller Central's totals laid over), so the line matches its figures to the cent
    daily: typeof SD !== 'undefined' && SD && SD.d && typeof sdDays === 'function' ? { SP: sdDays('SP'), CPC: sdDays('CPC') } : null });
  VI.res[brand] = { k, r };
  return r;
}

/* ----- the chapter "This week, explained." on the Sales Dashboard (23 Nov 2026: the approved chapters design) ----- */
const VI_OPEN_LS = 'viOpen';                       // this browser: the box open (1) or closed (0) — closed by default
const viEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
const viBrandOfCh = ch => (ch === 'SP' || ch === 'CPC' ? ch : ch === 'ALL' ? 'ALL' : null);
function viWhen(at) {
  const s = String(at || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${+m[3]} ${VI_MON[+m[2] - 1]} ${m[4]}:${m[5]}` : viDay(s);
}
const viDash = label => String(label || '').replace(/(\d)-(?=[A-Z0-9])/g, '$1–');        // "Nov 15-21" → "Nov 15–21" (shown only)
/** cents → "$35.6k" / "$940" (a chip); "−" when below 0. */
function viShort(cents) {
  const d = Math.abs(cents) / 100, sign = cents < 0 ? '−' : '';
  return sign + '$' + (d >= 1e6 ? (d / 1e6).toFixed(1) + 'M' : d >= 1e3 ? (d / 1e3).toFixed(1) + 'k' : VI_NF.format(Math.round(d)));
}
function viOpenGet() { try { return localStorage.getItem(VI_OPEN_LS) === '1'; } catch (e) { return false; } }
function viOpenSet(on) { try { localStorage.setItem(VI_OPEN_LS, on ? '1' : '0'); } catch (e) { /* private window: closed next visit */ } }
/** A driver as a short pill: "ad spend ↑30%", "traffic ↓52%", "price ↓8%", "3 days no sale", "out of stock", "seasonal" (+ its whole text on hover). */
function viPill(dr) {
  if (!dr) return '';
  const LBL = { price: 'price', ads: 'ad spend', traffic: 'traffic', conv: 'conversion' };
  let t = '', cls = 'is-flat';
  if (LBL[dr.k]) {
    const m = String(dr.t).match(/([+−-])(\d+)%/);
    if (!m) return '';
    const up = m[1] === '+';
    t = `${LBL[dr.k]} ${up ? '↑' : '↓'}${m[2]}%`;
    cls = up ? 'is-up' : 'is-dn';
  } else if (dr.k === 'oos') { t = 'out of stock'; cls = 'is-dn'; }
  else if (dr.k === 'nosale') { t = `${dr.days} days no sale`; cls = 'is-dn'; }
  else if (dr.k === 'season') { t = 'seasonal'; cls = /lift/.test(dr.t) ? 'is-up' : 'is-dn'; }
  else if (dr.k === 'new') { t = 'new this week'; cls = 'is-up'; }
  else { t = 'no clear driver'; cls = 'is-flat'; }
  return `<span class="vi-pill ${cls}" title="${viEsc(dr.t)}">${viEsc(t)}</span>`;
}
/** "This week, explained." (the chapter, 23 Nov 2026 — the approved preview's card): left the headline, the weeks, the summary and
 *  Show details; right ▲ Biggest gains | ▼ Biggest drops (a bar per mover, scaled to the biggest, and up to 2 driver pills). */
function viBoxHtml(res, sum, brand, open) {
  const plain = text => `<div><p class="sdx-hl" id="viH">This week in plain English</p><p class="sdx-summary muted">${viEsc(text)}</p></div><div></div>`;
  if (!res) return plain('Reading the weekly figures…');
  if (!res.ok) return plain(res.why);
  const t = res.total;
  const head = t.d ? `Revenue ${viFell(t.d)} ${viMoney(Math.abs(t.d))}` : 'Revenue held level';
  const badge = t.pct == null ? '' : `<span class="sdx-delta ${t.d < 0 ? 'down' : 'up'}">${t.d < 0 ? '▼' : '▲'} ${Math.abs(t.pct).toFixed(1)}%</span>`;
  const stockAt = Object.entries(res.asOf.stock || {}).filter(([, a]) => a).map(([b, a]) => `${VI_BRAND_NAME[b] || b} ${viDay(a)}`).join(', ');
  const src = `From PPC weekly sales: the Orders workbooks per ASIN, Sunday–Saturday weeks, US Pacific days, no Shopify. Sales as at ${res.asOf.sales || '—'}`
    + `${res.asOf.days ? '; days without a sale from the nightly run of ' + res.asOf.days : ''}${stockAt ? '; FBA stock as of ' + stockAt : ''}.`
    + (res.ly ? ` Same week last year from the Sales Dashboard's figures: ${viMoney(res.ly.was)} → ${viMoney(res.ly.now)}.` : '');
  const others = res.groups - res.movers.length;
  const more = [res.rest || others ? `Everything else: ${viMoney(res.rest, true)} from ${VI_NF.format(others)} other product${others === 1 ? '' : 's'}` : '',
    res.ly ? `Same week last year: ${viPct(res.ly.pct)}` : '',
    `${viShort(res.explained)} explained${t.d ? ' (' + Math.round(res.explained / t.d * 100) + '%)' : ''} by ${res.movers.length} mover${res.movers.length === 1 ? '' : 's'}`,
    `${VI_NF.format(res.named)} driver${res.named === 1 ? '' : 's'} named`,
    res.check ? '' : '⚠ the movers did not add up — please report this'].filter(Boolean).map(viEsc).join(' · ')
    + ` · as of ${viEsc(viWhen(res.asOf.sales) || '—')}<button type="button" class="sdx-i" aria-label="Where these figures come from" title="${viEsc(src)}">ⓘ</button>`;
  const max = Math.max(1, ...res.movers.map(m => Math.abs(m.d)));
  const row = m => {
    const tip = `${m.name}: ${viMoney(m.was)} → ${viMoney(m.now)} (${viPct(m.pct, 0)})${res.brand === 'ALL' ? ' · ' + (VI_BRAND_NAME[m.brand] || m.brand) : ''} · ${m.driver.t}${m.driver.also ? ' · ' + m.driver.also : ''}`;
    return `<div class="sdx-mv ${m.d < 0 ? 'down' : 'up'}" title="${viEsc(tip)}"><span class="sdx-mv-n">${viEsc(m.name)}</span><span class="sdx-mv-amt">${viMoney(m.d, true)}</span>`
      + `<span class="sdx-mv-bar" aria-hidden="true"><i style="width:${Math.max(3, Math.round(Math.abs(m.d) / max * 100))}%"></i></span>`
      + `<span class="sdx-pills">${viPill(m.driver)}${m.driver.k !== 'none' ? viPill(m.driver.more) : ''}</span></div>`;
  };
  const gains = res.movers.filter(m => m.d > 0).sort((a, b) => b.d - a.d), drops = res.movers.filter(m => m.d < 0).sort((a, b) => a.d - b.d);
  const col = (cls, title, list, none) => `<div><h3 class="sdx-mv-h ${cls}">${title}</h3>${list.length ? list.map(row).join('') : `<p class="sdx-none">${none}</p>`}</div>`;
  return `<div><p class="sdx-hl" id="viH">${viEsc(head)}${badge}</p>`
      + `<div class="sdx-weeks">${viEsc(viDash(res.labels.L))} vs ${viEsc(viDash(res.labels.P))} · ${viEsc(VI_BRAND_NAME[brand] || brand)}</div>`
      + `<span class="sdx-by">${sum.by === 'claude' ? 'Claude summary' : 'Summary'}</span><p class="sdx-summary">${viEsc(sum.text)}</p>`
      + (sum.why ? `<p class="sdx-summary muted" style="font-size:14px">${viEsc(sum.why)}</p>` : '')
      + `<button type="button" class="sdx-link" data-vi-toggle aria-expanded="${open}" aria-controls="viDet">${open ? 'Hide details ▴' : 'Show details ▾'}</button>`
      + `<div class="sdx-more" id="viDet"${open ? '' : ' hidden'}>${more}</div></div>`
    + `<div class="sdx-cols2">${col('up', '▲ Biggest gains', gains, 'No product rose.')}${col('down', '▼ Biggest drops', drops, 'No product fell.')}</div>`;
}
/** Draw the chapter for the channel on view (the Sales Dashboard's SD_CH); loads first, asks Claude after (never blocking it). */
function viDraw() {
  const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('viBox') : null;
  if (!el) return;
  const brand = viBrandOfCh(typeof SD_CH !== 'undefined' ? SD_CH : 'SP');
  el.hidden = false;
  if (!brand) {
    el.innerHTML = viBoxHtml({ ok: false, why: 'Per-product weekly figures exist for the Amazon accounts only — pick Ridhi, CPC or All.' }, null, 'SP', false);
    el.dataset.viHtml = '';
    return;
  }
  if (!VI.data) {
    el.innerHTML = viBoxHtml(null, null, brand, false);
    viLoad().then(() => viDraw(), () => viDraw());
    return;
  }
  const res = viFor(brand);
  const sum = viSummary(res);
  const html = viBoxHtml(res, sum, brand, viOpenGet());
  if (el.dataset.viHtml === html) return;
  el.dataset.viHtml = html;
  el.innerHTML = html;
  if (res && res.ok && sum.by === 'rules' && !sum.why) viAskAi(res);
}
/** Show / hide the details (remembered in this browser). */
function viToggle(btn) {
  const det = document.getElementById('viDet');
  if (!det) return;
  const open = det.hidden;
  det.hidden = !open;
  viOpenSet(open);
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide details ▴' : 'Show details ▾';
  const box = document.getElementById('viBox');
  if (box) box.dataset.viHtml = '';                  // the next draw takes the new state as its own
  if (typeof window !== 'undefined' && window.ScrollTrigger) window.ScrollTrigger.refresh();
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('[data-vi-toggle]') : null;
    if (t) viToggle(t);
  });
}

/* ----- the Dashboard's card (core/dashboard.js tVi): the headline and the first sentence of the summary ----- */
async function viDashLoad() { await viLoad(); }
/** One Dashboard view (ALL = Both, SP, CPC): { head, pct, up, text, when } or { empty: true }. */
function viDashOf(view) {
  const res = viFor(view === 'ALL' ? 'ALL' : view);
  if (!res || !res.ok) return { empty: true, why: res ? res.why : '' };
  const text = viSummary(res).text;
  const first = (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0];
  const t = res.total;
  return { head: t.d ? `Revenue ${viFell(t.d)} ${viMoney(Math.abs(t.d))} last week` : 'Revenue held level last week',
    pct: t.pct == null ? null : Math.round(t.pct * 10) / 10, up: t.d >= 0, text: first, when: `${res.labels.L} · sales as at ${res.asOf.sales || '—'}` };
}
