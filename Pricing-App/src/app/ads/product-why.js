/* ================= ADS · PRODUCT PERFORMANCE · "WHY DID IT MOVE?" =================
 * Screens: a block INSIDE Product Performance (tab 'ppcn'; since 13 Nov no longer a side panel over the page). pwDrawer
 * draws it; ads/ppc-new.js puts it under the product's table row (pxWhyRow), at the top of the table when that row is not
 * on screen, or under What moved when it was opened there. Opened from a product's name, the "Why?" on any row that fell
 * 30%+, and the What moved card; each part carries an (i) note (pxI) on what it compares with what.
 * Does: splits ONE product's change in sales, between two runs of whole Sunday–Saturday weeks, into six causes —
 * traffic, ad spend, conversion, Buy Box, stock and price — size by size, and says which one it mostly was:
 *   1. Per size, sales = sessions × units per session × average price, so the change splits EXACTLY into a traffic, a
 *      conversion and a price part (the log-mean / LMDI split: each factor's change in logs × the log-mean of sales).
 *   2. Traffic splits further: the part that matches the change in ad clicks is AD SPEND, the rest organic TRAFFIC.
 *   3. Conversion splits further: the part that matches the fall in Buy Box (share of page views that had it) is BUY BOX.
 *   4. A size at 0 in Amazon stock now that stopped selling while it normally sells: its whole fall is STOCK.
 * Every size's parts add up to its change, so the six add up to the product's change to the cent; a size whose weeks
 * have no sessions report cannot be split and is shown as "not split". Whole weeks only: Amazon gives sessions and Buy
 * Box per Sunday–Saturday week, never per day.
 * Reads WEEKLY (sessions, page views, bbv = page views with the Buy Box — from the 12 Nov backend change), WDAY (days
 * without a sale), HEALTH (Amazon stock now, from Listing Health) and W_LOG (the change log). Keeps no store of its own.
 * Main functions: pwOpen, pwPeriod, pwQty, pwSum, pwSplit, pwBreak, pwTrend, pwWaterfall, pwDrawer. */

// The icons: one per cause, plus the sparkle used on hints. Stroke icons in currentColor, so each takes its cause's colour.
const pwIc = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const PW_IC = {
  traffic: pwIc('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  ads: pwIc('<path d="M3 10.5v3a1 1 0 0 0 1 1h2.5l5.5 4.5v-14L6.5 9.5H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.8 6a8 8 0 0 1 0 12"/>'),
  conv: pwIc('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.6a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.5L21.8 8H6.4"/>'),
  bb: pwIc('<path d="M8 21h8M12 16.5V21M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5.5h2.8v1.8A3 3 0 0 1 17 10.2M7 5.5H4.2v1.8A3 3 0 0 0 7 10.2"/>'),
  stock: pwIc('<path d="M21 8 12 3 3 8l9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
  price: pwIc('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.6" cy="7.6" r="1.4"/>'),
  other: pwIc('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 17h.01"/>'),
  spark: pwIc('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1-5.1-1.9 5.1-1.9z"/><path d="M19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  close: pwIc('<path d="M6 6l12 12M18 6 6 18"/>'),
};
// The six causes in the order the waterfall walks them; "other" (not split) follows only when it is not zero.
const PW_CAUSES = ['traffic', 'ads', 'conv', 'bb', 'stock', 'price'];
// Each cause: its name, what it measures, and the first things to check when it is the main reason for a fall.
const PW_META = {
  traffic: { t: 'Traffic', m: 'Organic sessions', check: [
    'Search Terms: has a top keyword lost its rank or its impressions?',
    'Is a competitor or a new listing sitting above you in search?',
    'Listing Health: is the listing or a variation suppressed?'] },
  ads: { t: 'Ad spend', m: 'Paid clicks', check: [
    'Ad Console: was a budget capped, a campaign paused or bids cut?',
    'If ACoS was the reason, cut the worst search terms rather than the whole budget.'] },
  conv: { t: 'Conversion', m: 'Units per session', check: [
    'Reviews and rating: a new 1–2★ review on the top sizes?',
    'Was the main image, title or A+ changed in these weeks?',
    'Price and delivery promise against the listings beside you.'] },
  bb: { t: 'Buy Box', m: 'Page views that had the Buy Box', check: [
    'Is another seller on the sizes below? Check their offers.',
    'Is your price above Amazon’s reference price, or is FBA stock stranded / unfulfillable?'] },
  stock: { t: 'Stock', m: 'Sizes in stock at Amazon', check: [
    'Replenish the sizes at 0 — Replenishment and Inventory Age have them.',
    'Any inbound shipment stuck in receiving?'] },
  price: { t: 'Price', m: 'Average selling price', check: [
    'A coupon, deal or price change in these weeks? See the Deal Calendar.'] },
  other: { t: 'Not split', m: 'No sessions report for these weeks' },
};

/* ---------- which weeks ---------- */
// Open the panel on a product (a parent, or one size), comparing the weeks pwPeriod picks. Opened from inside the panel
// (a size of the product on show), it keeps the weeks being compared and remembers where it came from, for "back".
/* 13 Nov (Vishesh): no longer a panel over the page — the breakdown opens INSIDE the page, under the row that was
 * clicked (at 'table'; under the parent's row when a size was clicked), or under What moved when it was opened there
 * (at 'moved', comparing that card's week with the one before). A product not on screen (filtered out, or past "Show
 * more") opens at the top of the table instead. Clicking the same name again closes it. */
function pwOpen(key, at) {
  const was = PX.why;
  const ents = pxEntities();
  const anchor = (ents.find(x => x.key === key) || ents.find(x => x.asins.includes(key)) || { key }).key;
  // A size inside the open breakdown: same place, same weeks, and "back" to where it came from.
  // solo: this ASIN on its own, even when it is also its parent's key (a parent listed as one of its own sizes).
  if (was && at === 'inside') {
    if (was.key === key && was.solo) return;
    PX.why = Object.assign({}, was, { key, solo: true, back: was.key, backSolo: !!was.solo });
    return;
  }
  // The same product clicked again where it is open: close it.
  if (was && was.key === key && was.at === at) {
    PX.why = null;
    return;
  }
  const per = at === 'moved'
    ? { n: 1, end: pxAlertWeeks()[Math.min(PX.alertWk, pxAlertWeeks().length - 1)], fit: false, wk: true }
    : pwPeriod();
  PX.why = Object.assign({ key, anchor, at: at || 'table' }, per);
  PX.whyAnim = true;
}
/* The weeks compared: the dates in view when they ARE whole finished Sunday–Saturday weeks; otherwise the last
 * finished week(s) — 1 for ranges up to ten days, 2 up to three weeks, 4 beyond — since sessions and Buy Box exist only
 * per whole week. { n, end: the Sunday of the last week compared, fit: true when they are exactly the dates in view } */
function pwPeriod() {
  const t = pxToday(), last = sdShift(wKeyOfDate(t), -7);
  if (PX.mode === 'range') {
    const [lo, hi] = pxRange();
    if (lo && hi && hi < t && wKeyOfDate(lo) === lo && wKeyOfDate(sdShift(hi, 1)) === sdShift(hi, 1)) {
      return { n: Math.max(1, Math.min(8, Math.round(pxLen(lo, hi) / 7))), end: wKeyOfDate(hi), fit: true };
    }
    const L = lo && hi ? pxLen(lo, hi) : 7;
    return { n: L <= 10 ? 1 : L <= 21 ? 2 : 4, end: last, fit: false };
  }
  return { n: 1, end: last, fit: false };
}
// The n weeks ending on week `end` (cur), and the n weeks just before them (prev) — Sunday keys, oldest first.
const pwWeeks = (n, end) => ({
  cur: Array.from({ length: n }, (_, i) => sdShift(end, -7 * (n - 1 - i))),
  prev: Array.from({ length: n }, (_, i) => sdShift(end, -7 * (2 * n - 1 - i))),
});

/* ---------- the figures ---------- */
// asin → Amazon stock now (summed over its SKUs), from the Listing Health snapshot; null when not known.
let PW_QTY = null;
function pwQty(a) {
  if (!PW_QTY) {
    PW_QTY = {};
    ['SP', 'CPC'].forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
      const x = String(r.asin || '').trim().toUpperCase();
      if (x && r.qty != null) PW_QTY[x] = (PW_QTY[x] || 0) + r.qty;
    }));
  }
  return a in PW_QTY ? PW_QTY[a] : null;
}
// One size's weeks added up: sales, units, sessions, page views, Buy Box page views, spend, clicks, ad sales. Sessions
// are null when the brand's report for any of the weeks is not in; Buy Box is null unless every week with page views
// carries it (weeks collected before the backend change do not).
function pwSum(a, wks) {
  const row = WEEKLY.rows[a] || {}, w = row.weeks || {};
  const b = row.brand || (pxLookup()[a] || {}).brand, have = pxSessWeeks();
  const o = { rev: 0, u: 0, se: 0, pv: 0, bbv: 0, spend: 0, cl: 0, adSales: 0, has: false };
  let seOk = true, bbMiss = false;
  wks.forEach(k => {
    if (!have.has(b + '|' + k)) seOk = false;
    const c = w[k];
    if (!c) return;
    o.has = true;
    o.rev += c.rev || 0;
    o.u += c.u || 0;
    o.se += c.sessions || 0;
    o.pv += c.pv || 0;
    if (c.bbv != null) o.bbv += c.bbv;
    else if (c.pv) bbMiss = true;
    o.spend += c.spend || 0;
    o.cl += c.clicks || 0;
    o.adSales += c.adSales || 0;
  });
  if (!seOk) {
    o.se = null;
    o.pv = null;
  }
  o.bb = !bbMiss && o.pv ? o.bbv / o.pv : null;
  return o;
}
/* A cause's SHARE: of all the parts that moved the same way as sales (the gross fall, or the gross rise) — not of the net
 * change, which a part pulling the other way can make smaller than any one cause (a 22% coupon losing $3,300 while
 * traffic added $1,000 read "price 222%"). Same-direction shares add up to 100%; a part pulling the other way is shown
 * against the same total. */
function pwGross(Z, dS) {
  return Object.keys(Z).reduce((s, k) => s + (dS < 0 ? Math.max(0, -Z[k]) : Math.max(0, Z[k])), 0) || Math.abs(dS) || 1;
}
// The log-mean of two positive numbers (LMDI's weight).
const pwLM = (a, b) => (Math.abs(a - b) < 1e-9 ? a : (a - b) / (Math.log(a) - Math.log(b)));
/* One size's change split into the causes: { traffic, ads, conv, bb, stock, price, other }, adding up to c.rev − p.rev.
 * p / c: the size's weeks before / now (pwSum); oos: the size is out of stock now and stopped selling. */
function pwSplit(p, c, oos) {
  const z = { traffic: 0, ads: 0, conv: 0, bb: 0, stock: 0, price: 0, other: 0 };
  const dS = c.rev - p.rev;
  if (Math.abs(dS) < 0.01) return z;
  if (dS < 0 && oos) {
    z.stock = dS;
    return z;
  }
  if (p.se == null || c.se == null) {
    z.other = dS;
    return z;
  }
  let t = 0, cv = 0, pr = 0;
  const cr0 = p.se > 0 ? p.u / p.se : 0, cr1 = c.se > 0 ? c.u / c.se : 0;
  if (p.rev > 0 && c.rev > 0 && p.u > 0 && c.u > 0 && p.se > 0 && c.se > 0) {
    // --- sales = sessions × units per session × price: the exact three-way split ---
    const L = pwLM(c.rev, p.rev);
    t = L * Math.log(c.se / p.se);
    cv = L * Math.log(cr1 / cr0);
    pr = L * Math.log((c.rev / c.u) / (p.rev / p.u));
  } else {
    // One side sold nothing (or had no sessions): it is all traffic when the sessions went too, else all conversion.
    if (dS < 0 ? !(c.se > 0) : !(p.se > 0)) t = dS;
    else cv = dS;
  }
  // --- Buy Box: the part of a fall in conversion that the fall in Buy Box accounts for ---
  if (cv < 0 && p.bb != null && c.bb != null && c.bb < p.bb - 0.02) {
    let share = (p.bb - c.bb) / p.bb;
    if (cr0 > 0 && cr1 > 0 && cr1 < cr0) share = c.bb > 0 ? Math.log(c.bb / p.bb) / Math.log(cr1 / cr0) : 1;
    share = Math.max(0, Math.min(1, share));
    z.bb = cv * share;
    cv -= z.bb;
  }
  // --- Ad spend: the part of the change in sessions that the change in ad clicks accounts for ---
  const dse = c.se - p.se, dcl = c.cl - p.cl;
  if (t !== 0 && dse !== 0 && Math.sign(dcl) === Math.sign(dse)) {
    const share = Math.max(0, Math.min(1, dcl / dse));
    z.ads = t * share;
    t -= z.ads;
  }
  z.traffic = t;
  z.conv = cv;
  z.price = pr;
  return z;
}
// Product-level totals, added size by size (sessions null when any size's are; Buy Box over the sizes that have it).
function pwAdd(into, x) {
  into.rev += x.rev;
  into.u += x.u;
  into.spend += x.spend;
  into.cl += x.cl;
  into.adSales += x.adSales;
  if (x.se == null) into.seMiss = true;
  else into.se += x.se;
  if (x.bb != null) {
    into.bbv += x.bbv;
    into.bbpv += x.pv;
  }
}
const pwZero = () => ({ rev: 0, u: 0, se: 0, spend: 0, cl: 0, adSales: 0, bbv: 0, bbpv: 0, seMiss: false });
/* The whole breakdown for a list of ASINs over pwWeeks: Z (the causes added up), P / C (the totals before / now) and
 * kids (each size: before, now, its split, its stock now and its days without a sale). */
function pwBreak(asins, per) {
  const days = per.cur.flatMap(w => wDaysBetween(w, sdShift(w, 6)));
  const dayOk = !!WDAY.from && days[0] >= WDAY.from;
  const Z = { traffic: 0, ads: 0, conv: 0, bb: 0, stock: 0, price: 0, other: 0 }, P = pwZero(), C = pwZero(), kids = [];
  asins.forEach(a => {
    const p = pwSum(a, per.prev), c = pwSum(a, per.cur);
    if (!p.has && !c.has) return;
    const qty = pwQty(a);
    // Days without a sale, from the per-day store (only when these weeks are inside its window).
    let zero = null;
    if (dayOk) {
      const dd = (WDAY.rows[a] || {}).days || {};
      zero = days.filter(d => !(dd[d] && dd[d].u > 0)).length;
    }
    // OUT OF STOCK: at 0 at Amazon now and not selling, or many days without a sale on a size that sells most days and
    // is all but empty. An estimate (stock is known now, not per day) — the card says so.
    const perDay = p.u / days.length;
    const oos = c.rev < p.rev && ((qty === 0 && (zero == null || zero >= 2))
      || (zero != null && qty != null && qty <= 5 && perDay >= 1 && zero >= Math.max(3, Math.ceil(days.length * 0.4))));
    const z = pwSplit(p, c, oos);
    Object.keys(Z).forEach(k => { Z[k] += z[k]; });
    pwAdd(P, p);
    pwAdd(C, c);
    kids.push({ a, p, c, z, qty, zero, oos, d: c.rev - p.rev });
  });
  [P, C].forEach(o => {
    if (o.seMiss) o.se = null;
    o.bb = o.bbpv ? o.bbv / o.bbpv : null;
    o.usp = o.se ? o.u / o.se * 100 : null;
    o.asp = o.u ? o.rev / o.u : null;
    o.acos = o.adSales ? o.spend / o.adSales * 100 : null;
  });
  return { Z, P, C, kids, days, dayOk };
}
// The main cause of a list of ASINs' change between week wk and the week before — the What moved table's "Likely cause".
function pwMain(asins, wk) {
  const B = pwBreak(asins, pwWeeks(1, wk)), dS = B.C.rev - B.P.rev;
  if (Math.abs(dS) < 1) return null;
  const keys = PW_CAUSES.concat(Math.abs(B.Z.other) >= 1 ? ['other'] : []);
  const main = keys.reduce((m, k) => ((dS < 0 ? B.Z[k] < B.Z[m] : B.Z[k] > B.Z[m]) ? k : m), keys[0]);
  return { main, share: Math.abs(B.Z[main]) / pwGross(B.Z, dS) };
}
// Eight weeks of a list of ASINs ending on week `end`: sales, units, sessions, unit session %, Buy Box %, spend, price.
function pwTrend(asins, end) {
  return Array.from({ length: 8 }, (_, i) => sdShift(end, -7 * (7 - i))).map(k => {
    const o = { k, rev: 0, u: 0, se: 0, pv: 0, bbv: 0, bbpv: 0, spend: 0, any: false };
    asins.forEach(a => {
      const c = ((WEEKLY.rows[a] || {}).weeks || {})[k];
      if (!c) return;
      o.any = true;
      o.rev += c.rev || 0;
      o.u += c.u || 0;
      o.se += c.sessions || 0;
      o.spend += c.spend || 0;
      if (c.bbv != null && c.pv) {
        o.bbv += c.bbv;
        o.bbpv += c.pv;
      }
    });
    return { k, rev: o.any ? o.rev : null, u: o.any ? o.u : null, se: o.se || null, spend: o.any ? o.spend : null,
      usp: o.se ? o.u / o.se * 100 : null, bb: o.bbpv ? o.bbv / o.bbpv * 100 : null, asp: o.u ? o.rev / o.u : null };
  });
}

/* ---------- drawing ---------- */
// The waterfall: sales before, each cause as a step up or down, sales after. Bars grow in, one after another.
function pwWaterfall(P, C, Z) {
  const gross = pwGross(Z, C.rev - P.rev);
  const keys = PW_CAUSES.concat(Math.abs(Z.other) >= 1 ? ['other'] : []);
  const steps = [{ k: 'start', t: 'Before', v: P.rev, abs: true }]
    .concat(keys.map(k => ({ k, t: PW_META[k].t, v: Z[k] })))
    .concat([{ k: 'end', t: 'Now', v: C.rev, abs: true }]);
  let run = 0;
  const bars = steps.map(s => {
    if (s.abs) {
      run = s.v;
      return Object.assign({ lo: 0, hi: s.v, lvl: s.v }, s);
    }
    const lo = Math.min(run, run + s.v), hi = Math.max(run, run + s.v);
    run += s.v;
    return Object.assign({ lo, hi, lvl: run }, s);
  });
  const W = 720, H = 232, pl = 6, pr = 6, pt = 28, pb = 46, iw = W - pl - pr, ih = H - pt - pb;
  const mx = Math.max(1, ...bars.map(b => b.hi)) * 1.04, n = bars.length, sw = iw / n, bw = Math.min(62, sw * 0.6);
  const Y = v => pt + ih - v / mx * ih, dS = C.rev - P.rev;
  let h = `<line class="pw-wf-base" x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  bars.forEach((b, i) => {
    const x = pl + i * sw + (sw - bw) / 2, hh = Math.max(2, Y(b.lo) - Y(b.hi));
    const cls = b.abs ? (b.k === 'end' ? 'pw-wf-end' : 'pw-wf-abs') : b.v < -0.5 ? 'pw-wf-dn' : b.v > 0.5 ? 'pw-wf-up' : 'pw-wf-0';
    h += `<rect class="pw-wf ${cls}" x="${x.toFixed(1)}" y="${Y(b.hi).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="6" style="animation-delay:${i * 70}ms"><title>${pxEsc(b.t)}: ${b.abs ? pxMoney(b.v) : (b.v < 0 ? '−' : '+') + pxMoney(Math.abs(b.v))}</title></rect>`;
    if (i < n - 1) {
      const nx = pl + (i + 1) * sw + (sw - bw) / 2;
      h += `<line class="pw-wf-link" x1="${(x + bw).toFixed(1)}" x2="${nx.toFixed(1)}" y1="${Y(b.lvl).toFixed(1)}" y2="${Y(b.lvl).toFixed(1)}"/>`;
    }
    const val = b.abs ? pxShort(b.v) : Math.abs(b.v) < 0.5 ? '$0' : (b.v < 0 ? '−' : '+') + pxShort(Math.abs(b.v));
    h += `<text class="pw-wf-v ${cls}" x="${(x + bw / 2).toFixed(1)}" y="${(Y(b.hi) - 8).toFixed(1)}" text-anchor="middle">${val}</text>`
      + `<text class="pw-wf-t" x="${(x + bw / 2).toFixed(1)}" y="${H - 26}" text-anchor="middle">${pxEsc(b.t)}</text>`;
    if (!b.abs && dS && Math.abs(b.v) >= 0.5) {
      h += `<text class="pw-wf-s" x="${(x + bw / 2).toFixed(1)}" y="${H - 11}" text-anchor="middle">${Math.round(Math.abs(b.v) / gross * 100)}%</text>`;
    }
  });
  return `<svg class="pw-wf-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the change in sales came from">${h}</svg>`;
}

// The whole panel for PX.why, or '' when it is closed.
function pwDrawer(ctx) {
  if (!PX.why) return '';
  const w = PX.why, e = (!w.solo && ctx.ents.find(x => x.key === w.key))
    || { key: w.key, asins: [w.key], title: wTitle(w.key) || w.key, brand: (WEEKLY.rows[w.key] || {}).brand || (pxLookup()[w.key] || {}).brand || '' };
  const per = pwWeeks(w.n, w.end), B = pwBreak(e.asins, per), { Z, P, C } = B, dS = C.rev - P.rev, fell = dS < 0;
  const tr = pwTrend(e.asins, w.end);
  const name = String(e.title || e.key).replace(/^~\s*/, '');
  const size = e.asins.length === 1 ? pxSize(e.key) : '';
  const fmtR = (ws) => pxFmtRange(ws[0], sdShift(ws[ws.length - 1], 6));
  const pctS = v => (v == null ? '—' : v.toFixed(v < 10 ? 1 : 0) + '%');
  const arrow = (a, b, f) => `${f(a)} <i>→</i> ${f(b)}`;
  const chg = (a, b, good) => pxDelta(b, a, '', good);
  // --- the main cause: the biggest part in the direction sales moved ---
  const keys = PW_CAUSES.concat(Math.abs(Z.other) >= 1 ? ['other'] : []);
  const main = Math.abs(dS) < 1 ? null : keys.reduce((m, k) => ((fell ? Z[k] < Z[m] : Z[k] > Z[m]) ? k : m), keys[0]);
  const gross = pwGross(Z, dS), share = k => (dS ? (fell ? -Z[k] : Z[k]) / gross : 0);
  const kidsOos = B.kids.filter(k => k.qty === 0), kidsLowBb = B.kids.filter(k => k.c.bb != null && k.c.bb < 0.8 && k.c.pv > 0);
  const zeroDays = B.kids.filter(k => k.oos && k.zero != null).reduce((s, k) => s + k.zero, 0);
  const nSizes = e.asins.length;

  // --- what each card says: the figures behind the cause ---
  const EV = {
    traffic: [`Sessions ${arrow(P.se, C.se, pxN)} ${P.se != null && C.se != null ? chg(P.se, C.se, 'up') : ''}`,
      P.se != null && C.se != null ? `Organic sessions ${arrow(Math.max(0, P.se - P.cl), Math.max(0, C.se - C.cl), pxN)}` : 'No sessions report for these weeks yet'],
    ads: [`Spend ${arrow(P.spend, C.spend, pxMoney)} ${chg(P.spend, C.spend, '')}`,
      `Ad clicks ${arrow(P.cl, C.cl, pxN)} · ACoS ${arrow(P.acos, C.acos, pctS)}`],
    conv: [`Unit session % ${arrow(P.usp, C.usp, pctS)}`, `Units ${arrow(P.u, C.u, pxN)} ${chg(P.u, C.u, 'up')}`],
    bb: C.bb == null || P.bb == null
      ? ['Not collected for these weeks yet', 'Arrives with the nightly Buy Box change']
      : [`${arrow(P.bb * 100, C.bb * 100, pctS)} of page views`, kidsLowBb.length ? `${kidsLowBb.length} size${kidsLowBb.length === 1 ? '' : 's'} under 80% now` : 'Every size above 80%'],
    stock: [kidsOos.length ? `${kidsOos.length} of ${nSizes} size${nSizes === 1 ? '' : 's'} at 0 at Amazon now` : 'No size at 0 at Amazon now',
      zeroDays ? `${zeroDays} days without a sale on sizes that sell daily` : B.dayOk ? 'No unusual days without a sale' : 'Stock is known for today only'],
    price: [`Average price ${arrow(P.asp, C.asp, v => (v == null ? '—' : '$' + v.toFixed(2)))} ${P.asp && C.asp ? chg(P.asp, C.asp, '') : ''}`,
      'Sales ÷ units, every size together'],
  };
  const SP = {
    traffic: tr.map(x => x.se), ads: tr.map(x => x.spend), conv: tr.map(x => x.usp), bb: tr.map(x => x.bb),
    stock: tr.map(x => x.u), price: tr.map(x => x.asp),
  };
  const noData = k => (k === 'bb' && (C.bb == null || P.bb == null)) || ((k === 'traffic' || k === 'conv' || k === 'ads') && (P.se == null || C.se == null));
  const card = k => {
    const v = Z[k], s = share(k);
    const st = noData(k) && Math.abs(v) < 0.5 ? 'nodata' : k === main ? 'main' : s >= 0.1 ? 'adds' : s >= 0.03 ? 'minor'
      : s <= -0.03 ? 'helped' : 'none';
    const tag = { main: fell ? 'Main cause' : 'Main driver', adds: 'Adds to it', minor: 'Small part', helped: fell ? 'Held it up' : 'Held it back',
      none: 'Not a factor', nodata: 'No data yet' }[st];
    return `<div class="pw-c pw-st-${st} pw-k-${k}"><div class="pw-c-h"><span class="pw-ic">${PW_IC[k]}</span><span><b>${PW_META[k].t}</b><small>${PW_META[k].m}</small></span><span class="pw-tag">${tag}</span></div>`
      + `<div class="pw-c-v"><b>${Math.abs(v) < 0.5 ? '$0' : (v < 0 ? '−' : '+') + pxMoney(Math.abs(v))}</b>${dS && Math.abs(v) >= 0.5 ? `<small>${Math.round(Math.abs(s) * 100)}% of the ${fell ? 'fall' : 'rise'}</small>` : ''}</div>`
      + `<div class="pw-c-bar"><i style="--w:${Math.min(100, Math.abs(s) * 100).toFixed(1)}%"></i></div>`
      + `<div class="pw-c-e">${EV[k].map(x => `<span>${x}</span>`).join('')}</div>`
      + `<div class="pw-c-sp">${pxSpark(SP[k], 'pw-sp-' + k, 132, 30)}<small>8 weeks</small></div></div>`;
  };

  // --- the verdict: one sentence for the main cause, then the mix and what to check first ---
  const pctChg = (a, b) => (a ? Math.abs((b - a) / a * 100).toFixed(0) + '%' : '');
  const HEAD = {
    traffic: fell ? 'Fewer shoppers reached it' : 'More shoppers found it',
    ads: fell ? 'Ad spend was cut — and its traffic with it' : 'More ad spend bought more traffic',
    conv: fell ? 'Shoppers came, but fewer bought' : 'More of its visitors bought',
    bb: fell ? 'Buy Box lost' : 'Buy Box won back',
    stock: 'Ran out of stock',
    price: fell ? 'Sold at a lower price' : 'Sold at a higher price',
    other: 'Sessions for these weeks are not in yet',
  };
  const WHY = {
    traffic: `Sessions went ${pxN(P.se)} → ${pxN(C.se)} while ad clicks went ${pxN(P.cl)} → ${pxN(C.cl)}: the change is organic — ranking, impressions or the listing, not the ads.`,
    ads: `Spend went ${pxMoney(P.spend)} → ${pxMoney(C.spend)} (${fell ? 'down' : 'up'} ${pctChg(P.spend, C.spend)}) and ad clicks ${pxN(P.cl)} → ${pxN(C.cl)}; the sales those clicks brought ${fell ? 'went' : 'came'} with them.`,
    conv: `Unit session % went ${pctS(P.usp)} → ${pctS(C.usp)} with sessions ${pctChg(P.se, C.se) ? (C.se < P.se ? 'down ' : 'up ') + pctChg(P.se, C.se) : 'steady'}${C.bb != null ? ` and the Buy Box at ${pctS(C.bb * 100)}` : ''}: the visitors were there and stopped buying.`,
    bb: `Only ${pctS((C.bb || 0) * 100)} of page views had the Buy Box, against ${pctS((P.bb || 0) * 100)} before${kidsLowBb.length ? `, worst on ${kidsLowBb.length} size${kidsLowBb.length === 1 ? '' : 's'}` : ''}. Shoppers saw another seller’s offer — or none — and unit session % fell ${pctS(P.usp)} → ${pctS(C.usp)}.`,
    stock: `${kidsOos.length} size${kidsOos.length === 1 ? ' is' : 's are'} at 0 at Amazon now${zeroDays ? `, with ${zeroDays} days without a sale between them` : ''}. They sold ${pxMoney(B.kids.filter(k => k.oos).reduce((s, k) => s + k.p.rev, 0))} the weeks before.`,
    price: `The average price went ${P.asp ? '$' + P.asp.toFixed(2) : '—'} → ${C.asp ? '$' + C.asp.toFixed(2) : '—'} on about the same units.`,
    other: 'Amazon’s traffic report for these weeks has not arrived, so traffic and conversion cannot be told apart yet. Sales and ads below are complete.',
  };
  const mix = keys.filter(k => (fell ? Z[k] < 0 : Z[k] > 0) && Math.abs(share(k)) >= 0.05)
    .sort((a, b) => Math.abs(Z[b]) - Math.abs(Z[a])).slice(0, 4)
    .map(k => `<span class="pw-mix-c pw-k-${k}">${PW_IC[k]}${PW_META[k].t} <b>${Math.round(Math.abs(share(k)) * 100)}%</b></span>`).join('');
  const verdict = !main ? `<div class="pw-verdict pw-v-flat"><span class="pw-vic">${PW_IC.spark}</span><div><small>Steady</small><b>Sales did not move between these weeks</b></div></div>`
    : `<div class="pw-verdict pw-k-${main}${fell ? '' : ' pw-v-rise'}"><span class="pw-vic">${PW_IC[main]}</span><div><small>${fell ? 'Mostly' : 'Grew mostly on'} · ${PW_META[main].t.toLowerCase()}</small>`
      + `<b>${pxEsc(HEAD[main])}</b><p>${WHY[main]}</p>${mix ? `<div class="pw-mix">${mix}</div>` : ''}`
      + (fell && PW_META[main].check ? `<ul class="pw-check">${PW_META[main].check.map(c => `<li>${pxEsc(c)}</li>`).join('')}</ul>` : '') + '</div></div>';

  // --- the sizes that moved most, each with its own main cause ---
  const kidMain = k => {
    const ks = PW_CAUSES.concat('other');
    return ks.reduce((m, x) => ((k.d < 0 ? k.z[x] < k.z[m] : k.z[x] > k.z[m]) ? x : m), ks[0]);
  };
  const movers = B.kids.filter(k => Math.abs(k.d) >= 1).sort((a, b) => (fell ? a.d - b.d : b.d - a.d)).slice(0, 6);
  const bigK = Math.max(1, ...movers.map(k => Math.abs(k.d)));
  const sizes = nSizes < 2 || !movers.length ? '' : `<section class="pw-sec"><h4>Sizes that moved most <small>${B.kids.length} with sales in these weeks</small></h4><div class="pw-sizes">`
    + movers.map(k => {
      const m = kidMain(k), flags = [];
      if (k.qty === 0) flags.push('<span class="pw-flag pw-flag-bad">0 in stock</span>');
      if (k.c.bb != null && k.c.pv > 0 && k.c.bb < 0.8) flags.push(`<span class="pw-flag pw-flag-bad">Buy Box ${Math.round(k.c.bb * 100)}%</span>`);
      if (k.c.se) flags.push(`<span class="pw-flag">Unit session % ${pctS(k.c.u / k.c.se * 100)}</span>`);
      return `<button class="pw-size" data-pxwhy="${pxEsc(k.a)}" data-pxat="inside" title="This size on its own">${pxPic([k.a], pxSize(k.a) || wTitle(k.a), true)}`
        + `<span class="pw-size-n"><b>${pxEsc(pxSize(k.a) || wTitle(k.a) || k.a)}</b><small>${pxEsc(k.a)} · ${pxMoney(k.p.rev)} → ${pxMoney(k.c.rev)}</small><span>${flags.join('')}</span></span>`
        + `<span class="pw-size-bar ${k.d < 0 ? 'dn' : 'up'}"><i style="--w:${(Math.abs(k.d) / bigK * 100).toFixed(1)}%"></i></span>`
        + `<b class="pw-size-d ${k.d < 0 ? 'px-neg' : 'px-pos'}">${k.d < 0 ? '−' : '+'}${pxShort(Math.abs(k.d))}</b>`
        + `<span class="pw-mix-c pw-k-${m}">${PW_IC[m]}${PW_META[m].t}</span></button>`;
    }).join('') + '</div></section>';

  // --- what the team changed in these weeks (the change log) ---
  const set = new Set(e.asins.concat(e.key)), lo = per.prev[0], hi = sdShift(per.cur[per.cur.length - 1], 6);
  const logs = (W_LOG || []).filter(x => set.has(String(x.asin || '').toUpperCase()) && x.date >= lo && x.date <= hi)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const log = `<section class="pw-sec"><h4>Changes logged <small>${pxEsc(pxFmtRange(lo, hi))}</small></h4>`
    + (logs.length ? '<div class="pw-logs">' + logs.map(x => `<div class="pw-log"><span class="pw-log-d">${pxEsc(pxDM(x.date))}</span><span class="pw-flag">${pxEsc(x.type || '')}</span><span><b>${pxEsc(x.what || '')}</b>${x.why ? `<small>${pxEsc(x.why)}</small>` : ''}</span><span class="px-dim">${pxEsc(String(x.by || '').split('@')[0])}</span></div>`).join('') + '</div>'
      : '<div class="pw-none">Nothing logged for these weeks. A price, image or campaign change written in the change log shows up here beside the figures it moved.</div>')
    + '</section>';

  // --- the head: the product, the weeks, and the four numbers that matter ---
  const nChips = [1, 2, 4].map(k => `<button data-pwn="${k}" aria-pressed="${w.n === k}">${k} week${k === 1 ? '' : 's'}</button>`).join('');
  const hero = `<div class="pw-hero"><div class="pw-hero-m"><small>Sales, ${w.n === 1 ? 'week' : w.n + ' weeks'} on ${w.n === 1 ? 'week' : w.n + ' weeks'}</small>`
    + `<div class="pw-hero-v"><b>${pxMoney(C.rev)}</b>${pxDelta(C.rev, P.rev, '', 'up')}</div>`
    + `<em>from ${pxMoney(P.rev)} · ${dS < 0 ? '−' : '+'}${pxMoney(Math.abs(dS))}</em></div>`
    + `<div class="pw-hero-k"><small>Unit session %</small><b>${arrow(P.usp, C.usp, pctS)}</b></div>`
    + `<div class="pw-hero-k"><small>Sessions</small><b>${arrow(P.se, C.se, pxN)}</b></div>`
    + `<div class="pw-hero-k"><small>Buy Box</small><b>${P.bb == null || C.bb == null ? '—' : arrow(P.bb * 100, C.bb * 100, pctS)}</b></div>`
    + `<div class="pw-hero-k"><small>Ad spend</small><b>${arrow(P.spend, C.spend, pxShort)}</b></div>`
    + `<div class="pw-hero-t">${pxBars(tr.map(x => x.rev), i => i >= 8 - w.n, fell ? 'pw-hb-dn' : 'pw-hb-up', 46)}<small>Weekly sales, 8 weeks · the ${w.n === 1 ? 'week' : 'weeks'} compared in colour</small></div></div>`;

  // --- drawn in the page: a head, then the figures in two columns ---
  const info = (id, t, h) => pxI('pw-' + id, t, h);
  const perTxt = `<b>${pxEsc(fmtR(per.cur))}</b> against <b>${pxEsc(fmtR(per.prev))}</b>`;
  const whyWk = w.wk ? 'the week chosen in What moved, against the week before it'
    : w.fit ? 'exactly the dates in view' : 'whole Sunday–Saturday weeks — the only span Amazon reports sessions and Buy Box for — the finished weeks closest to the dates in view';
  return `<div class="pw-inl${PX.whyAnim ? ' pw-in' : ''}" role="region" aria-label="Why did it move? ${pxEsc(name)}">`
    + `<header class="pw-h">${pxPic(e.asins.length > 1 ? [e.key].concat(e.asins) : [e.key], name)}`
    + `<div class="pw-h-t"><small>${PW_IC.spark}Why did it move?${w.back ? ` <button class="pw-back-l" data-pwback="1">← back to ${pxEsc(String((ctx.ents.find(x => x.key === w.back) || {}).title || w.back).replace(/^~\s*/, ''))}</button>` : ''}</small><h3>${pxEsc(name)}${size ? `<span class="px-var">${pxEsc(size)}</span>` : ''}</h3>`
    + `<span class="pw-meta">${pxEsc(e.key)} · ${pxEsc(BRAND_NAME[e.brand] || e.brand || '')}${nSizes > 1 ? ` · ${nSizes} sizes` : ''}</span></div>`
    + `<div class="pw-per"><div class="px-seg px-segsm" role="group" aria-label="Weeks compared">${nChips}</div>`
    + `<span>${perTxt}</span>${info('per', 'Which weeks are compared', `<p>This compares <b>${pxEsc(fmtR(per.cur))}</b> (the ${w.n === 1 ? 'week' : w.n + ' weeks'} you are looking at) with <b>${pxEsc(fmtR(per.prev))}</b> — the same number of weeks just before.</p><p>The weeks are ${whyWk}. Change it with 1 / 2 / 4 weeks.</p><p>Every figure in this breakdown is for <b>${pxEsc(name)}</b>${nSizes > 1 ? ` and its ${nSizes} sizes together` : ''} only.</p>`)}</div>`
    + `<button class="pw-x" data-pwclose="1" aria-label="Close the breakdown" title="Close (Esc)">${PW_IC.close}</button></header>`
    + `<div class="pw-body pw-wide">`
    + `<div class="pw-col">${hero.replace(' compared in colour</small>', ' compared in colour' + info('hero', 'The weekly sales bars', `<p>One bar per Sunday–Saturday week, the last 8 finished weeks of <b>${pxEsc(name)}</b>'s sales.</p><p>The ${w.n === 1 ? 'week' : w.n + ' weeks'} compared (${pxEsc(fmtR(per.cur))}) are in colour — red when sales fell against the ${w.n === 1 ? 'week' : 'weeks'} before, green when they grew. The grey bars are context only.</p><p>The figures above them are each “before → now”: ${pxEsc(fmtR(per.prev))} → ${pxEsc(fmtR(per.cur))}.</p>`) + '</small>')}${verdict}</div>`
    + `<section class="pw-sec pw-col"><h4>Where the ${dS < 0 ? '−' : '+'}${pxMoney(Math.abs(dS))} came from <small>each size split, then added up · % of the ${fell ? 'fall' : 'rise'}</small>${info('wf', 'The waterfall', `<p>It walks from sales before to sales now. The grey bar on the left is <b>${pxEsc(fmtR(per.prev))}</b> (${pxMoney(P.rev)}); the blue bar on the right is <b>${pxEsc(fmtR(per.cur))}</b> (${pxMoney(C.rev)}).</p><p>Each bar between them is one cause — how many dollars it added (green, up) or took away (red, down). Together they add up exactly to the ${dS < 0 ? 'fall' : 'rise'} of ${pxMoney(Math.abs(dS))}.</p><p>Each size is split on its own first, then the sizes are added up, so one size running out does not hide behind another selling more.</p>`)}</h4><div class="pw-wf-wrap">${pwWaterfall(P, C, Z)}</div></section>`
    + `<section class="pw-sec pw-full"><h4>The six causes <small>${pxEsc(fmtR(per.prev))} → ${pxEsc(fmtR(per.cur))}</small>${info('causes', 'The six causes', `<p>Every card is one possible reason, with the dollars it explains and its share of the whole move (the ${fell ? 'falls' : 'rises'} and the parts that pushed the other way, added together).</p><ul><li><b>Traffic</b> — fewer or more sessions not explained by ad clicks.</li><li><b>Ad spend</b> — the sessions that came and went with ad clicks.</li><li><b>Conversion</b> — units per session, apart from Buy Box.</li><li><b>Buy Box</b> — the part of conversion that matches the share of page views with the Buy Box.</li><li><b>Stock</b> — sizes at 0 at Amazon now that stopped selling.</li><li><b>Price</b> — sales ÷ units.</li></ul><p>The grey lines under each card are that figure's last 8 weeks. The tag says how much it matters: Main cause, Adds to it, Small part, Held it up, Not a factor.</p>`)}</h4><div class="pw-cards">${PW_CAUSES.map(card).join('')}</div></section>`
    + (sizes ? sizes.replace('</small></h4>', '</small>' + info('sizes', 'Sizes that moved most', `<p>The sizes whose sales changed most in dollars between ${pxEsc(fmtR(per.prev))} and ${pxEsc(fmtR(per.cur))}, before → now, each with its own main cause.</p><p>Red flags: 0 in stock at Amazon now, or Buy Box under 80% of page views. Click a size to see its own breakdown here; “back” returns to the product.</p>`) + '</h4>').replace('pw-sec"', 'pw-sec pw-col"') : '')
    + log.replace('</small></h4>', '</small>' + info('log', 'Changes logged', `<p>What the team wrote in the change log (price, image, campaign, listing changes) for these products between ${pxEsc(pxFmtRange(lo, hi))} — so a fall can be read beside the change that may have caused it.</p>`) + '</h4>').replace('pw-sec"', 'pw-sec pw-col"')
    + `<footer class="pw-f pw-full"><b>How this is worked out.</b> For each size, sales = sessions × units per session × average price, so its change splits exactly into traffic, conversion and price. The traffic part that matches the change in ad clicks is counted as ad spend; the conversion part that matches the fall in Buy Box, as Buy Box. A size at 0 in stock now that stopped selling counts as stock (an estimate: stock is known for today, not per day). The sizes are then added up, so the six causes total the change in sales.</footer>`
    + '</div></div>';
}
