/* ================= ADS · PLACEMENT DECISIONS (18 Nov 2026) =================
 * Screen: the top half of Placement (tab 'plc', pane panePlc; ensurePlc in ads/placement.js loads, then calls renderPlx).
 * For every campaign × placement (Top of Search, Rest of Search, Product Page; Off Amazon has no adjustment) it says
 * Raise / Lower / Keep / Not enough data, with the adjustment now and the one proposed, and the evidence; the change goes
 * to the shared review list (Search Term Analysis's: Firestore adsActions) and leaves as an Amazon bulk file row
 * (Entity "Bidding Adjustment"). "Apply now" is drawn but off until Sellora has Amazon edit permission (ADS_APPLY in
 * search-terms.js); each review item already carries the full call that route will make (api).
 *
 * READS (all loaded by staLoad, Search Term Analysis's loader):
 *   ST.plc / ST.plcr  the Ads backend's 7-day campaign × placement reports (AdsDecide.gs: plcSettled = days 8–37,
 *                     plcRecent = last 7 days). Decisions are judged on settled days only; the last 7 show under the spend.
 *   ST.ent            Amazon's record (AdsEntities.gs): per campaign [name, state, budget, strategy, Top %, Rest %, Product %,
 *                     targeting type, start]. Without it the direction is shown, not the new percentage.
 *   staModel('ALL')   each ad group's target and break-even ACoS (Profit & Margin costs), age, launch name, FBA cover —
 *                     weighted per campaign by its keywords' and targets' spend + sales.
 *   ST_RL             open placement items (In review) and recent ones (cooldown).
 *
 * THE RULES (PLX; 19 Nov audit):
 *   0 orders → Lower only when that is unlikely to be chance at the campaign's (or brand's) order rate (the same test as
 *     Search Term Analysis, under STA.CHANCE) AND it spent STA.NOSALE_MIN_SP or more; otherwise Not enough data.
 *   1 to MIN_ORDERS−1 orders → Lower only when even 2 more orders at its average order value would leave ACoS above
 *     break-even; otherwise Not enough data ("4 of 10 orders"). Raise always needs MIN_ORDERS.
 *   ACoS ≤ RAISE_SHARE × target → Raise +STEP points (cap MAX_PCT); not when FBA cover < STA.RAISE_COVER days, and not
 *     when the campaign already spends BUDGET_USE of its daily budget (a raise there only moves money between placements).
 *   ACoS > break-even → Lower −STEP points (floor 0); already at 0% → "lower the keyword bids instead" (Search Term Analysis).
 *   Otherwise Keep. New campaigns (under STA.AGE_DAYS days), launch campaigns, paused campaigns, an open review item, a
 *   downloaded change not yet seen at Amazon, or a change in the last COOLDOWN days → no decision (each its own chip).
 * Main functions: plxModel, plxDecide, renderPlx, plxKpis, plxDataLine, plxTable, plxItem, plxSend, plxCsvLines. */

const PLX = {
  MIN_ORDERS: 10,      // settled 7-day orders a placement needs before it is judged
  RAISE_SHARE: 0.75,   // raise when ACoS is at or below this share of the target
  STEP: 10,            // points per change, either way
  MAX_PCT: 200,        // Sellora never proposes more than this (Amazon allows 900)
  COOLDOWN: 14,        // days after a change (seen at Amazon) before the next decision: the settled window is days 8–37
  MORE_ORDERS: 2,      // 1–9 orders: lower only if ACoS stays above break-even even with this many more orders
  BUDGET_USE: 0.9,     // spends this share of its daily budget or more → no raise
  PAGE: 25,            // campaigns per page
};
// Amazon's placement names (report) → ours; then each one's API name, bulk-file name and its slot in adEntities' cp row.
const PLX_PK = { 'Top of Search on-Amazon': 'tos', 'Other on-Amazon': 'ros', 'Detail Page on-Amazon': 'pp', 'Off Amazon': 'off' };
const PLX_META = {
  tos: { name: 'Top of Search', amz: 'PLACEMENT_TOP', bulk: 'Placement Top', ix: 4 },
  ros: { name: 'Rest of Search', amz: 'PLACEMENT_REST_OF_SEARCH', bulk: 'Placement Rest Of Search', ix: 5 },
  pp: { name: 'Product Page', amz: 'PLACEMENT_PRODUCT_PAGE', bulk: 'Placement Product Page', ix: 6 },
  off: { name: 'Off Amazon', amz: '', bulk: '', ix: -1 },
};
const PLX_ORDER = ['tos', 'ros', 'pp', 'off'];
const PLX_STRAT = { LEGACY_FOR_SALES: 'Dynamic bids · down only', AUTO_FOR_SALES: 'Dynamic bids · up and down', MANUAL: 'Fixed bids' };
// The decision chips, in order: key, label.
const PLX_CHIPS = [['raise', 'Raise'], ['lower', 'Lower'], ['keep', 'Keep'], ['thin', 'Not enough data'], ['review', 'In review'],
  ['cool', 'Recently changed'], ['budget', 'Out of budget'], ['launch', 'Launch / new'], ['notgt', 'No target'], ['hold', 'Hold'],
  ['paused', 'Paused'], ['off', 'Off Amazon']];
let PLX_ACT = '', PLX_PG = 0, PLX_SORT = { k: 'sp', d: -1 }, PLX_LAST = null;
const PLX_SEL = new Map();

const plxPct = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v) + '%';
const plxColor = pk => plcColor((PLX_META[pk] || {}).name || pk);

/* ---------- the model ---------- */
function plxModel() {
  const pick = $('plcBrand').value;
  const brands = pick === 'ALL' ? ['SP', 'CPC'] : [pick];
  const q = ($('plxFilter').value || '').trim().toLowerCase();
  const only = $('plxPlace').value;
  const now = Date.now(), DAY = 86400000;
  let M = null;
  try { M = staModel('ALL'); } catch (e) { M = null; }
  // Open placement items (In review) and the last change per placement (cooldown).
  const open = new Map(), last = new Map();
  ST_RL.items.forEach(x => {
    if (x.kind !== 'plc') return;
    if (x.status === 'review' || x.status === 'approved' || x.status === 'applying' || x.status === 'failed') open.set(x.key, x);
    else if (x.status === 'exported' || x.status === 'done' || x.status === 'applied' || x.status === 'undone') {
      const t = x.status === 'undone' ? x.undoneAt || x.at : x.status === 'applied' ? x.appliedAt || x.at : x.status === 'done' ? x.doneAt || x.exportedAt || x.at : x.exportedAt || x.at;
      const was = last.get(x.key);
      if (!was || t > was.t) last.set(x.key, { t, st: x.status });
    }
  });
  // Per campaign: target and break-even weighted by its targets' spend + sales; youngest age; lowest FBA cover.
  const info = new Map();
  if (M) {
    const seen = new Set();
    (M.tgAll || []).forEach(g => {
      const ai = g.ai;
      if (!ai) return;
      const k = g.brand + '|' + (g.cid || ai.cid);
      const x = info.get(k) || info.set(k, { w: 0, tw: 0, bw: 0, w0: 0, tw0: 0, bw0: 0, known: false, fallback: false, isNew: false, launch: false, newFrom: 0, cover: null }).get(k);
      const ln = ai.ln || {};
      const w = (g.sp || 0) + (g.s || 0);
      if (ln.tgt != null) {
        x.tw += ln.tgt * w; x.bw += ln.be * w; x.w += w;
        x.tw0 += ln.tgt; x.bw0 += ln.be; x.w0 += 1;
        if (ln.known) x.known = true;
        if (ln.fallback) x.fallback = true;
      }
      if (!seen.has(g.brand + '|' + ai.ag)) {
        seen.add(g.brand + '|' + ai.ag);
        if (ai.launch) { x.launch = true; x.launchTo = Math.max(x.launchTo || 0, ai.launchTo || 0); }
        if (ai.isNew) { x.isNew = true; x.newFrom = Math.max(x.newFrom, ai.newFrom || 0); }
        if (ln.cover != null) x.cover = x.cover == null ? ln.cover : Math.min(x.cover, ln.cover);
      }
    });
  }
  const out = { brands, camps: [], rows: [], from: '', to: '', settled: !!ST.plc, ent: !!ST.ent, costs: ST.costs, rlOpen: open };
  brands.forEach(b => {
    const pack = ST.plc && ST.plc.d && ST.plc.d[b];
    if (!pack) return;
    if (ST.plc.from && !out.from) { out.from = pack.from || ST.plc.from; out.to = pack.to || ST.plc.to; }
    const rec = (ST.plcr && ST.plcr.d && ST.plcr.d[b] && ST.plcr.d[b].rows) || [];
    const recOf = new Map(rec.map(x => [x.cid + '|' + x.p, x]));
    const E = ST.ent && ST.ent.d && ST.ent.d[b];
    const cpRec = (E && E.cp) || {};
    const byC = new Map();
    const f0 = Date.parse(pack.from || ST.plc.from || ''), t0 = Date.parse(pack.to || ST.plc.to || '');
    const winDays = f0 && t0 && t0 >= f0 ? Math.round((t0 - f0) / 86400000) + 1 : 30;
    let bc = 0, bo = 0;
    (pack.rows || []).forEach(x => { if (PLX_PK[x.p] !== 'off') { bc += x.c || 0; bo += x.o || 0; } });
    const bRate = bo > 0 && bc > 0 ? { p: bo / bc, w: 'the brand\'s placements' } : null;
    (pack.rows || []).forEach(x => {
      const c = byC.get(x.cid) || byC.set(x.cid, { key: b + '|' + x.cid, brand: b, cid: x.cid, cn: x.cn || (cpRec[x.cid] || [])[0] || 'Campaign ' + x.cid,
        i: 0, c: 0, sp: 0, o: 0, s: 0, rows: [] }).get(x.cid);
      const pk = PLX_PK[x.p] || 'x:' + x.p;
      const r = { key: 'plc|' + b + '|' + x.cid + '|' + pk, type: 'plc', brand: b, cid: x.cid, pk, name: (PLX_META[pk] || {}).name || x.p,
        i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0, rec: recOf.get(x.cid + '|' + x.p) || null };
      c.rows.push(r);
      c.i += r.i; c.c += r.c; c.sp += r.sp; c.o += r.o; c.s += r.s;
    });
    byC.forEach(c => {
      const ent = cpRec[c.cid] || null;
      c.ent = ent;
      c.state = ent ? ent[1] : '';
      c.budget = ent ? Number(ent[2]) || 0 : 0;
      c.strategy = ent ? ent[3] : '';
      c.started = ent ? Number(ent[8]) || 0 : 0;
      const ci = info.get(b + '|' + c.cid) || {};
      c.tgt = ci.w > 0 ? ci.tw / ci.w : ci.w0 > 0 ? ci.tw0 / ci.w0 : null;
      c.be = ci.w > 0 ? ci.bw / ci.w : ci.w0 > 0 ? ci.bw0 / ci.w0 : null;
      c.fallback = !!ci.fallback && !ci.known;
      // Launch / ranking campaigns (by name) are left alone for STA.LAUNCH_DAYS from their start, as in Search Term Analysis
      // (18 Nov audit: the name alone used to exempt them for good). The name test here only covers a campaign whose ad
      // groups Search Term Analysis has not seen.
      c.launch = !!ci.launch || (!info.has(b + '|' + c.cid) && STA_LAUNCH.test(c.cn) && (!c.started || !staStarted(c.started, STA.LAUNCH_DAYS)));
      c.launchTo = ci.launchTo || (c.started ? staAddDays(c.started, STA.LAUNCH_DAYS) : 0);
      c.cover = ci.cover != null ? ci.cover : null;
      c.isNew = !!ci.isNew || (!!c.started && !staStarted(c.started, STA.AGE_DAYS));
      c.newFrom = Math.max(ci.newFrom || 0, c.started ? staAddDays(c.started, STA.AGE_DAYS) : 0);
      c.acos = c.s > 0 ? c.sp / c.s * 100 : null;
      // Spend per day: the last 7 days when reported (closest to today's budget), else the settled window.
      const rec7 = c.rows.reduce((a, r) => a + (r.rec ? r.rec.sp || 0 : 0), 0);
      c.daySp = rec7 > 0 ? rec7 / 7 : c.sp / winDays;
      c.rate = c.o >= STA.RATE_ORDERS && c.c > 0 ? { p: c.o / c.c, w: 'this campaign' } : bRate;
      c.settledTo = t0 || 0;
      c.rows.sort((x, y) => (PLX_ORDER.indexOf(x.pk) + 1 || 9) - (PLX_ORDER.indexOf(y.pk) + 1 || 9));
      c.rows.forEach(r => {
        r.camp = c;
        r.cn = c.cn;
        r.share = c.c > 0 ? r.c / c.c : null;
        r.acos = r.s > 0 ? r.sp / r.s * 100 : null;
        r.cpc = r.c > 0 ? r.sp / r.c : null;
        r.cvr = r.c > 0 ? r.o / r.c * 100 : null;
        const m = PLX_META[r.pk];
        r.cur = m && m.ix >= 0 && ent ? Number(ent[m.ix]) || 0 : null;
        plxDecide(r, c, open, last, now);
      });
      c.hay = (c.cn + ' ' + c.cid).toLowerCase();
      out.camps.push(c);
    });
  });
  // Filters: text, placement; the chip filters rows (campaigns with none left drop out).
  let camps = out.camps.filter(c => !q || c.hay.includes(q));
  out.all = camps;
  out.rowsAll = camps.flatMap(c => c.rows.filter(r => !only || r.pk === only));
  out.shown = camps.map(c => Object.assign(Object.create(c), {
    rowsShown: c.rows.filter(r => (!only || r.pk === only) && (!PLX_ACT || r.chip === PLX_ACT)) })).filter(c => c.rowsShown.length);
  return out;
}

// One campaign × placement's decision: r.dec (raise / lower / keep / keep0 / cap / thin / review / cool / new / hold / na),
// r.chip (the chip it counts under), r.to (the proposed %), r.why (one line), r.can (can go to the review list).
function plxDecide(r, c, open, last, now) {
  const set = (dec, why, to, chip) => {
    r.dec = dec;
    r.why = why + (post && (dec === 'raise' || dec === 'lower' || dec === 'keep') ? post : '');
    r.to = to == null ? null : to;
    r.chip = chip || (dec === 'raise' || dec === 'lower' || dec === 'thin' || dec === 'review' ? dec : dec === 'keep' || dec === 'keep0' || dec === 'cap' ? 'keep' : 'hold');
    r.can = (dec === 'raise' || dec === 'lower') && r.cur != null && r.to != null && r.to !== r.cur;
    return r;
  };
  let post = '';
  const m = PLX_META[r.pk];
  if (!m || m.ix < 0) return set('na', r.pk === 'off' ? 'Amazon has no bid adjustment for off-Amazon placements: its search terms and bids are the lever' : 'A placement Amazon has no adjustment for', null, 'off');
  if (c.state && !/enabled/i.test(c.state)) return set('na', 'Campaign ' + String(c.state).toLowerCase(), null, 'paused');
  if (c.launch) return set('hold', `Launch campaign (by its name): not judged on ACoS${c.launchTo ? ' until ' + staDay(c.launchTo) : ''}`, null, 'launch');
  if (c.isNew && c.newFrom > now) return set('new', `New campaign: judged from ${staDay(c.newFrom)}`, null, 'launch');
  const op = open.get(r.key);
  if (op) return set('review', `${staKindName(op)} ${plxPct(op.plc.from)} → ${plxPct(op.plc.to)} is ${op.status === 'failed' ? 'in the review list (apply failed)' : 'in the review list'}`);
  const L = last.get(r.key), DAY = 86400000;
  if (L && L.st === 'exported') return set('hold', `A change downloaded ${staDay(L.t)} is not seen at Amazon yet: decided again once it is${now - L.t > 3 * DAY ? ' (if it was never uploaded, cancel it in the review list)' : ''}`, null, 'cool');
  if (L && now - L.t < PLX.COOLDOWN * DAY) {
    const d = Math.floor((now - L.t) / DAY);
    return set('hold', `${L.st === 'undone' ? 'Undone' : 'Changed'} ${d ? d + ' day' + (d === 1 ? '' : 's') + ' ago' : 'today'}: waiting for data since the change — next decision from ${staDay(L.t + PLX.COOLDOWN * DAY)}`, null, 'cool');
  }
  // After the cooldown the settled window (days 8–37) still holds days from before the change: say how many are after it.
  if (L && c.settledTo && c.settledTo > L.t) {
    const n = Math.floor((c.settledTo - L.t) / DAY) + 1;
    if (n < 30) post = ` · ${n} of the 30 settled days are after the last change`;
  } else if (L) post = ' · the settled days are all from before the last change';
  const tgt = c.tgt, be = c.be, step = PLX.STEP;
  const down = r.cur == null ? null : Math.max(0, r.cur - step);
  // No orders: the same test as Search Term Analysis — how likely is 0 in this many clicks at the usual order rate?
  if (!(r.o > 0)) {
    const p = c.rate && c.rate.p;
    if (!p) return set('thin', `0 orders in ${staInt(r.c)} clicks, and nothing in this brand's placements sold to compare with`);
    const ch = Math.pow(1 - p, r.c);
    if (ch >= STA.CHANCE) return set('thin', `0 orders in ${staInt(r.c)} clicks could be chance at ${(p * 100).toFixed(1)}% (${c.rate.w}): about ${staInt(staNeed(p, r.c))} more clicks to tell`);
    if (r.sp < STA.NOSALE_MIN_SP) return set('thin', `0 orders on ${staMoney(r.sp)}: judged from ${staMoney(STA.NOSALE_MIN_SP)} of spend`);
    if (r.cur === 0) return set('keep0', `0 orders in ${staInt(r.c)} clicks (${staMoney(r.sp)}), and already at 0%: lower the keyword bids instead`);
    return set('lower', `0 orders in ${staInt(r.c)} clicks (${staMoney(r.sp)}): at ${(p * 100).toFixed(1)}% (${c.rate.w}) that is unlikely to be chance`, down);
  }
  if (r.o < PLX.MIN_ORDERS) {
    // A few orders: lower only when even MORE_ORDERS more at its average order value would leave it above break-even.
    if (be != null && r.s > 0) {
      const with2 = r.sp / (r.s + PLX.MORE_ORDERS * r.s / r.o) * 100;
      if (with2 > be) {
        if (r.cur === 0) return set('keep0', `ACoS ${staPct(r.acos)} on ${staInt(r.o)} orders, and already at 0%: lower the keyword bids instead`);
        return set('lower', `ACoS ${staPct(r.acos)} on ${staInt(r.o)} order${r.o === 1 ? '' : 's'}: even ${PLX.MORE_ORDERS} more would leave it at ${staPct(with2)}, above break-even ${staPct(be)}`, down);
      }
    }
    return set('thin', `${staInt(r.o)} of ${PLX.MIN_ORDERS} orders needed before it is judged`);
  }
  if (tgt == null) return set('hold', 'No unit cost for its products, so no target: set a break-even ACoS in Search Term Analysis → Lists & settings', null, 'notgt');
  const src = c.fallback ? ' (your setting)' : '';
  if (r.acos <= PLX.RAISE_SHARE * tgt) {
    if (c.cover != null && c.cover < STA.RAISE_COVER) return set('hold', `Sells well, but only ${Math.round(c.cover)} days of FBA stock: no raise`);
    if (r.cur != null && r.cur >= PLX.MAX_PCT) return set('cap', `ACoS ${staPct(r.acos)} is well under target, but it is at Sellora's ${PLX.MAX_PCT}% cap`);
    if (c.budget > 0 && c.daySp >= PLX.BUDGET_USE * c.budget)
      return set('hold', `Sells well, but it already spends about ${staMoney0(c.daySp)} of its $${staInt(c.budget)}/day budget: raise the budget first — a higher adjustment would only move money between placements`, null, 'budget');
    const dyn = c.strategy === 'AUTO_FOR_SALES' && r.pk === 'tos' ? ' · with "up and down" bids Amazon may add up to 100% more on Top of Search' : '';
    return set('raise', `ACoS ${staPct(r.acos)} is at or below 75% of the ${staPct(tgt)} target${src}, with ${staInt(r.o)} orders${dyn}`,
      r.cur == null ? null : Math.min(PLX.MAX_PCT, r.cur + step));
  }
  if (be != null && r.acos > be) {
    if (r.cur === 0) return set('keep0', `ACoS ${staPct(r.acos)} is above break-even ${staPct(be)}, and already at 0%: lower the keyword bids instead`);
    return set('lower', `ACoS ${staPct(r.acos)} is above break-even ${staPct(be)}${src}, with ${staInt(r.o)} orders`, down);
  }
  return set('keep', `ACoS ${staPct(r.acos)} is between 75% of target (${staPct(PLX.RAISE_SHARE * tgt)}) and break-even (${staPct(be)})`);
}

/* ---------- drawing ---------- */
function renderPlx() {
  if ($('panePlc').classList.contains('hide')) return;
  const P = plxModel();
  PLX_LAST = P;
  plxDataLine(P);
  plxKpis(P);
  plxTable(P);
  plxActBar(P);
  plxSelBar();
  plxRlBadge();
}
// After a change in the review list (made from either page): redraw Placement if it is on screen.
function plxAfterChange() {
  if (!$('panePlc').classList.contains('hide')) renderPlx();
}
function plxRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved' || x.status === 'failed').length;
  $('plxRlN').textContent = n;
  $('plxRlN').classList.toggle('hide', !n);
}

// The message line: the window and what it is judged on, then what is missing and why it matters.
function plxDataLine(P) {
  const parts = [];
  if (P.settled) parts.push(`Decisions judged on <b>settled days, ${staEsc(staShortDay(P.from))} – ${staEsc(staShortDay(P.to))}</b>, with 7-day sales as in the Ads console. The last 7 days show under the spend and are not counted.`);
  const src = ST.src || {};
  const one = (name, label) => {
    const x = src[name];
    if (!x) return '';
    if (x.ok) return `<span class="sta-ok">✓ ${label} ${staEsc(x.at || '')}</span>`;
    if (x.off) return `<span class="sta-dash">${label}: not switched on yet</span>`;
    return `<span class="sta-bad" title="${staEsc(x.err || '')}">✗ ${label}: could not be read</span>`;
  };
  parts.push('Amazon data: ' + [one('plcSettled', '7-day placement reports'), one('adEntities', 'current adjustments'),
    PLC.at ? `<span class="sta-ok">✓ nightly placements ${staEsc(PLC.at)}</span>` : ''].filter(Boolean).join(' · '));
  const warn = [];
  if (!P.settled) warn.push('<b>No decisions yet:</b> they need the Ads backend\'s 7-day placement reports (AdsDecide.gs → plcSettled), which Ravi switches on. The chart and tables below are from the nightly run.');
  if (P.settled && !P.ent) warn.push('Amazon\'s current adjustments are not read yet (AdsEntities.gs): decisions show the direction, and cannot go into a bulk file until they are.');
  if (P.settled && !ST.costs) warn.push(ST.costErr ? 'Unit costs could not be read for this account: ' + staEsc(ST.costErr) : 'No unit costs (Profit & Margin): no targets, so no Raise or Lower beyond "no orders".');
  // Per brand: how many campaigns have no target, or a target from the setting rather than unit costs.
  if (P.settled && ST.costs) P.brands.forEach(b => {
    const cs = P.camps.filter(c => c.brand === b && c.sp > 0);
    if (!cs.length) return;
    const none = cs.filter(c => c.tgt == null).length, fb = cs.filter(c => c.tgt != null && c.fallback).length;
    if (none) warn.push(`<b>${staEsc(staBrandName(b))}:</b> ${staInt(none)} of ${staInt(cs.length)} campaigns have no unit cost, so no target — set a break-even ACoS for ${staEsc(staBrandName(b))} in Search Term Analysis → Lists & settings.`);
    else if (fb) warn.push(`<b>${staEsc(staBrandName(b))}:</b> ${staInt(fb)} of ${staInt(cs.length)} campaigns use the break-even you set, not unit costs.`);
  });
  if (!ST_RL.where) warn.push('The review list has not loaded yet: "In review" and "Recently changed" are not known, so decisions may repeat one already waiting.');
  plcMsg(parts.join('<br>') + (warn.length ? '<div class="sta-warnline">' + warn.join('<br>') + '</div>' : ''));
}

// Five cards: Top of Search's share of spend, ACoS per placement, the proposals.
function plxKpis(P) {
  const tot = { tos: [0, 0, 0], ros: [0, 0, 0], pp: [0, 0, 0], off: [0, 0, 0] };   // spend, sales, orders
  let all = 0, src = '';
  if (P.settled && P.all.length) {
    src = '7-day · settled';
    P.all.forEach(c => c.rows.forEach(r => {
      all += r.sp;
      const t = tot[r.pk];
      if (t) { t[0] += r.sp; t[1] += r.s; t[2] += r.o; }
    }));
  } else if (Object.keys(PLC.d).length) {
    src = '30 days · nightly';
    const A = plcAgg();
    const back = { 'Top of Search': 'tos', 'Rest of Search': 'ros', 'Product Page': 'pp', 'Off Amazon': 'off' };
    A.names.forEach(n => {
      const v = A.place[n];
      all += v[2];
      const t = tot[back[n]];
      if (t) { t[0] += v[2]; t[1] += v[4]; t[2] += v[3]; }
    });
  }
  const acos = t => t[1] > 0 ? t[0] / t[1] * 100 : null;
  const rows = P.rowsAll || [];
  const nR = rows.filter(r => r.dec === 'raise').length, nL = rows.filter(r => r.dec === 'lower').length;
  // The brand-level target, weighted like the campaigns, to colour the ACoS cards.
  let tw = 0, w = 0;
  P.all.forEach(c => { if (c.tgt != null && c.sp > 0) { tw += c.tgt * c.sp; w += c.sp; } });
  const tgt = w > 0 ? tw / w : null;
  const IC = {
    share: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 6"/>',
    pct: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    go: '<path d="M12 5v14"/><path d="M5 12l7-7 7 7"/>',
  };
  const card = (ic, c, label, big, sub, tag, chip) => `
    <div class="adx-box plx-kpi${chip ? ' plx-click' : ''}" style="--c:${c};--adx-glow:.10"${chip ? ` data-chip="${chip}" role="button" tabindex="0"` : ''}>
      <div class="adx-l"><span class="adx-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg></span>${label}</div>
      <div class="plx-big">${big}</div>
      <div class="plx-sub">${sub}</div>
      ${tag ? `<div class="plx-tags">${tag.split(' · ').map(x => `<span>${staEsc(x)}</span>`).join('')}</div>` : ''}
    </div>`;
  const tone = v => v == null || tgt == null ? '' : v <= PLX.RAISE_SHARE * tgt ? ' plx-good' : v > tgt * 1.4 ? ' plx-bad' : '';
  const acosCard = (k, c) => {
    const v = acos(tot[k]);
    return card('pct', c, PLX_META[k].name + ' ACoS', `<b class="${tone(v)}">${v == null ? '—' : staPct(v)}</b>`,
      `${staMoney0(tot[k][0])} ad spend · ${staInt(Math.round(tot[k][2]))} orders`, src);
  };
  $('plxKpis').innerHTML = !all ? '' :
    card('share', 'var(--accent)', 'Top of Search share', `<b>${staPct(tot.tos[0] / all * 100)}</b>`, `${staMoney0(tot.tos[0])} of ${staMoney0(all)} ad spend`, src)
    + acosCard('tos', 'var(--accent)') + acosCard('ros', 'var(--act)') + acosCard('pp', 'var(--muted)')
    + card('go', 'var(--brand)', 'Placement proposals', `<b>${P.settled ? staInt(nR + nL) : '—'}</b>`,
      P.settled ? `${staInt(nR)} raise · ${staInt(nL)} lower${tgt != null ? ` · target ${staPct(tgt)}` : ''}` : 'Waiting for the 7-day placement reports', P.settled ? 'Derived' : '', P.settled && nR + nL ? (nR >= nL ? 'raise' : 'lower') : '');
  $('plxSub').textContent = P.settled
    ? `${staInt(P.all.length)} campaigns · ${staInt(rows.length)} placements · ${staInt(nR)} to raise, ${staInt(nL)} to lower. Each row is one campaign's placement; the adjustment applies to every bid in that campaign.`
    : 'Switches on with the Ads backend\'s 7-day placement reports.';
}

// The decision chips over the table.
function plxActBar(P) {
  const rows = P.rowsAll || [];
  const n = {};
  rows.forEach(r => { n[r.chip] = (n[r.chip] || 0) + 1; });
  if (PLX_ACT && !n[PLX_ACT]) PLX_ACT = '';
  const chip = (k, t, c) => `<button type="button" class="sta-chip${PLX_ACT === k ? ' on' : ''} a-${k ? 'p' + k : ''}" data-a="${k}" aria-pressed="${PLX_ACT === k}">${t}<span>${staInt(c)}</span></button>`;
  const tick = (P.page || []).flatMap(c => c.rowsShown).filter(r => r.can);
  const allOn = tick.length && tick.every(r => PLX_SEL.has(r.key));
  $('plxActBar').classList.toggle('hide', !rows.length);
  $('plxActBar').innerHTML = '<span class="sta-actl">Decision</span>' + chip('', 'All', rows.length)
    + PLX_CHIPS.filter(([k]) => n[k]).map(([k, t]) => chip(k, t, n[k])).join('')
    + (tick.length ? `<button type="button" class="sta-btn dim sm sta-actall" data-tickall="1">${allOn ? 'Untick' : 'Tick'} ${staInt(tick.length)} on this page</button>` : '');
}

// The decision's badge and the line under it.
function plxDecCell(r) {
  const B = {
    raise: ['Raise', 'ok'], lower: ['Lower', 'bad'], keep: ['Keep', ''], keep0: ['Keep at 0%', 'warn'], cap: ['Keep · at the cap', ''],
    thin: ['Not enough data', ''], review: ['In review', 'info'], new: ['New', 'info'], hold: ['Hold', 'warn'], na: ['Can\'t adjust', ''],
  }[r.dec] || ['—', ''];
  const move = r.dec === 'raise' || r.dec === 'lower'
    ? `<span class="plx-move">${r.cur == null ? (r.dec === 'raise' ? '+' : '−') + PLX.STEP + ' points' : `${plxPct(r.cur)} → <b>${plxPct(r.to)}</b>`}</span>` : '';
  const link = r.dec === 'keep0' ? `<button type="button" class="sta-btn dim sm" data-gost="${staEsc(r.key)}">Lower keyword bids →</button>`
    : r.pk === 'off' && r.sp > 0 ? `<button type="button" class="sta-btn dim sm" data-gost="${staEsc(r.key)}" data-view="all">Its search terms →</button>` : '';
  return `<td class="sta-ev plx-dec">${staBadge(B[0], B[1])}${move}<div class="sta-why">${staEsc(r.why || '')}</div>${link}</td>`;
}
// The action cell: Apply now (off until Sellora may change Amazon), Send to review.
function plxActCell(r) {
  if (r.dec === 'review') return '<td class="plx-actc"><span class="sta-dash">In the review list</span></td>';
  if (!(r.dec === 'raise' || r.dec === 'lower')) return '<td class="plx-actc"><span class="sta-dash">No change proposed</span></td>';
  if (!r.can) return `<td class="plx-actc"><span class="sta-dash" title="Amazon's current adjustment is needed for the bulk file">Needs Amazon's current %</span></td>`;
  return `<td class="plx-actc"><div class="plx-acts">
      <button type="button" class="sta-btn plx-apply" data-apply="${staEsc(r.key)}"${ADS_APPLY.on ? '' : ' disabled'} title="${staEsc(ADS_APPLY.on ? 'Change it at Amazon now' : ADS_APPLY.why)}">${ADS_APPLY.on ? '' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'}Apply now</button>
      <button type="button" class="sta-btn dim" data-send="${staEsc(r.key)}">Send to review</button></div></td>`;
}

function plxTable(P) {
  const S = PLX_SORT;
  const val = c => S.k === 'acos' ? (c.acos == null ? Infinity : c.acos) : c[S.k] || 0;
  const camps = P.shown.slice().sort((a, b) => (val(a) - val(b)) * S.d || b.sp - a.sp);
  const pages = Math.max(1, Math.ceil(camps.length / PLX.PAGE));
  if (PLX_PG >= pages) PLX_PG = pages - 1;
  const page = camps.slice(PLX_PG * PLX.PAGE, (PLX_PG + 1) * PLX.PAGE);
  P.page = page;
  const win = P.from ? `Settled days ${staShortDay(P.from)} – ${staShortDay(P.to)}` : 'Settled days';
  const th = (t, k, tip) => `<th class="num plx-sort${S.k === k ? ' on' : ''}" data-sort="${k}"${tip ? ` title="${staEsc(tip)}"` : ''}>${t}${S.k === k ? (S.d < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const head = `<thead><tr><th class="sta-stick">Campaign · placement</th><th class="num" title="The bid adjustment set at Amazon now">Now</th>
    <th class="num" title="This placement's clicks ÷ the campaign's clicks">Click share</th>${th('Impr.', 'i', win)}${th('Clicks', 'c', win)}${th('Spend', 'sp', win + '; the small line is the last 7 days, not counted')}
    ${th('Sales', 's', win + ' · 7-day sales')}${th('Orders', 'o', win)}${th('ACoS', 'acos', win)}<th class="num">CPC</th><th class="num">CVR</th><th>Decision</th><th>Action</th></tr></thead>`;
  const num = (v, f) => v == null ? staDash : f(v);
  const recLine = r => r.rec && (r.rec.sp > 0 || r.rec.c > 0) ? `<small class="sta-s">+${staMoney0(r.rec.sp)} last 7 days</small>` : '';
  const body = page.map(c => {
    const strat = PLX_STRAT[c.strategy] || '';
    const tgtTxt = c.tgt != null ? `target ${staPct(c.tgt)} · break-even ${staPct(c.be)}${c.fallback ? ' (fallback)' : ''}` : 'no unit cost: no target';
    const nAct = c.rows.filter(r => r.dec === 'raise' || r.dec === 'lower').length;
    const head = `<tr class="sta-grprow plx-camp">
      <td class="sta-stick"><div class="sta-pl"><b>${staEsc(c.cn)}</b>${staCopy(c.cn, 'campaign')}</div>
        <div class="sta-under">${staBadge(staBrandName(c.brand), 'brand-' + c.brand)}${strat ? staBadge(strat, c.strategy === 'AUTO_FOR_SALES' ? 'warn' : '', c.strategy === 'AUTO_FOR_SALES' ? 'Amazon may raise bids up to 100% on Top of Search, on top of the adjustment' : '') : ''}${c.budget ? `<span class="sta-dash${c.daySp >= PLX.BUDGET_USE * c.budget ? ' sta-bad' : ''}" title="About ${staEsc(staMoney0(c.daySp))} a day spent">$${staInt(c.budget)}/day${c.daySp >= PLX.BUDGET_USE * c.budget ? ' · used up' : ''}</span>` : ''}${c.state && !/enabled/i.test(c.state) ? staBadge(String(c.state).toLowerCase(), 'warn') : ''}</div></td>
      <td class="num"></td><td class="num"></td>
      <td class="num">${staInt(c.i)}</td><td class="num">${staInt(c.c)}</td><td class="num"><b>${staMoney(c.sp)}</b></td><td class="num">${staMoney(c.s)}</td><td class="num">${staInt(c.o)}</td>
      <td class="num"><b>${num(c.acos, staPct)}</b></td><td class="num">${c.c > 0 ? staMoney(c.sp / c.c) : staDash}</td><td class="num">${c.c > 0 ? staPct(c.o / c.c * 100) : staDash}</td>
      <td colspan="2" class="plx-ctgt"><span class="sta-dash">${staEsc(tgtTxt)}</span>${nAct ? ` · <b>${nAct} change${nAct === 1 ? '' : 's'}</b>` : ''}</td></tr>`;
    return head + c.rowsShown.map(r => `<tr class="sta-subrow${PLX_SEL.has(r.key) ? ' sel' : ''}">
      <td class="sta-stick">${r.can ? `<input type="checkbox" class="sta-cb" data-tick="${staEsc(r.key)}"${PLX_SEL.has(r.key) ? ' checked' : ''} aria-label="Select ${staEsc(c.cn + ' · ' + r.name)}">` : '<span class="sta-cbgap"></span>'}
        <span class="plx-dot" style="background:${plxColor(r.pk)}"></span>${staEsc(r.name)}</td>
      <td class="num"><b>${r.pk === 'off' ? staDash : r.cur == null ? '<span class="sta-dash" title="Not read from Amazon yet">?</span>' : plxPct(r.cur)}</b></td>
      <td class="num">${r.share == null ? staDash : staPct(r.share * 100)}</td>
      <td class="num">${staInt(r.i)}</td><td class="num">${staInt(r.c)}</td><td class="num">${staMoney(r.sp)}${recLine(r)}</td>
      <td class="num">${staMoney(r.s)}</td><td class="num">${staInt(r.o)}</td><td class="num">${num(r.acos, staPct)}</td>
      <td class="num">${num(r.cpc, staMoney)}</td><td class="num">${num(r.cvr, staPct)}</td>
      ${plxDecCell(r)}${plxActCell(r)}</tr>`).join('');
  }).join('');
  const empty = !P.settled
    ? 'Placement decisions appear here once the Ads backend sends its 7-day placement reports. Until then, the chart and the two tables below show the nightly 30-day figures.'
    : PLX_ACT || $('plxFilter').value || $('plxPlace').value ? 'Nothing matches these filters.' : 'No Sponsored Products placements in this window.';
  $('plxTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="14" class="muted" style="padding:16px 22px">${empty}</td></tr>`) + '</tbody>';
  $('plxFoot').innerHTML = camps.length > PLX.PAGE
    ? `<span>${PLX_PG * PLX.PAGE + 1}–${Math.min(camps.length, (PLX_PG + 1) * PLX.PAGE)} of ${staInt(camps.length)} campaigns</span>
       <span class="sta-pages"><button type="button" class="ghost" data-pg="-1"${PLX_PG ? '' : ' disabled'}>← Previous</button><button type="button" class="ghost" data-pg="1"${PLX_PG < pages - 1 ? '' : ' disabled'}>Next →</button></span>`
    : camps.length ? `<span>${staInt(camps.length)} campaign${camps.length === 1 ? '' : 's'}${PLX_ACT ? ' with a matching placement' : ''}</span>` : '';
}

/* ---------- actions ---------- */
// The review item for one placement change, in the shape the later apply route reads: the bulk-file fields (plc) and the
// Ads API call itself (api: PUT /sp/campaigns with every placement, so the other two are not reset).
function plxItem(r) {
  const c = r.camp, m = PLX_META[r.pk];
  const who = String(ME.email || '').split('@')[0].split(/[._]/)[0];
  const pb = ['tos', 'ros', 'pp'].map(k => ({ placement: PLX_META[k].amz, percentage: k === r.pk ? r.to : Number((c.ent || [])[PLX_META[k].ix]) || 0 }));
  return {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), v: 2, brand: r.brand, kind: 'plc', key: r.key, pathKey: '',
    term: '', target: m.name, kw: '', mt: '', kid: '', cid: r.cid, ag: '', cn: c.cn, agn: '',
    ev: { c: r.c, sp: staR2(r.sp), o: r.o, s: staR2(r.s), win: 'settled' },
    plc: { pk: r.pk, name: m.name, amz: m.amz, bulk: m.bulk, ix: m.ix, from: r.cur, to: r.to, strategy: c.strategy || '' },
    api: { call: 'PUT /sp/campaigns', body: { campaigns: [{ campaignId: r.cid, dynamicBidding: Object.assign(c.strategy ? { strategy: c.strategy } : {}, { placementBidding: pb }) }] } },
    what: `${m.name} ${plxPct(r.cur)} → ${plxPct(r.to)}`, why: r.why,
    status: 'review', by: who ? who[0].toUpperCase() + who.slice(1) : '', byEmail: ME.email || '', at: Date.now(),
  };
}
// Send rows to the review list. Two changes to the same placement never both wait.
async function plxSend(rows) {
  const open = new Set(ST_RL.items.filter(x => x.kind === 'plc' && STA_OPEN_ST.includes(x.status)).map(x => x.key));
  let n = 0, skip = 0;
  const errs = [];
  for (const r of rows) {
    if (!r.can || open.has(r.key)) { skip++; continue; }
    try { await staRlSave(plxItem(r)); n++; open.add(r.key); } catch (e) { skip++; errs.push(String((e && (e.code || e.message)) || e)); }
    PLX_SEL.delete(r.key);
  }
  staRlBadge();
  renderPlx();
  $('plxFoot').insertAdjacentHTML('afterbegin', `<span class="plx-note">${n ? `${n} change${n === 1 ? '' : 's'} added to the review list` : 'Nothing added'}${skip - errs.length ? ` · ${skip - errs.length} skipped (already waiting, or no current % from Amazon)` : ''}${errs.length ? ` · ${errs.length} could not be saved: ${staEsc(errs[0])}` : ''}${ST_RL.where === 'local' ? ' · kept in this browser until the shared list is switched on' : ''}.</span>`);
}
const plxRowOf = key => (PLX_LAST ? PLX_LAST.rowsAll : []).find(r => r.key === key);

function plxSelBar() {
  const sel = [...PLX_SEL.keys()].map(plxRowOf).filter(r => r && r.can);
  $('plxSelBar').classList.toggle('hide', !sel.length);
  if (!sel.length) return;
  const up = sel.filter(r => r.dec === 'raise').length;
  $('plxSelTxt').innerHTML = `<b>${sel.length} selected</b> · ${up} raise, ${sel.length - up} lower`;
  $('plxSelAdd').textContent = `Send ${sel.length} to review`;
}

// "Lower keyword bids": Search Term Analysis → Burning money → By target, filtered to this campaign.
function plxGoSt(r, view) {
  ST_VIEW = view || 'burn';
  ST_SUB = view ? 'term' : 'target';
  ST_PG = 0;
  ST_ACT = '';
  $('stBrand').value = r.brand;
  $('stFilter').value = r.cn;
  STM = null;
  showTab('st');
}

/* ---------- the legend ---------- */
function plxLegend() {
  const L = (t, items) => `<section><h4>${t}</h4><ul>${items.map(x => `<li>${x}</li>`).join('')}</ul></section>`;
  $('plxLegendBody').innerHTML = L('What it is judged on', [
    'Each campaign × placement over the <b>settled days</b> (8–37 days ago), with <b>7-day sales</b> as in the Ads console. The last 7 days show under the spend and are not counted.',
    'The target and break-even ACoS of the campaign\'s products, from Profit & Margin costs, weighted by what each of its keywords and targets spent and sold — the same numbers as Search Term Analysis.',
    'The adjustment set now, from Amazon\'s record of the campaign (read twice a day).'])
    + L('The decision', [
      `<b>0 orders</b>: Lower only when that is unlikely to be chance at the campaign's order rate (the brand's when the campaign has under ${STA.RATE_ORDERS} orders) and it spent ${staMoney(STA.NOSALE_MIN_SP)} or more — the same test as Search Term Analysis.`,
      `<b>1–${PLX.MIN_ORDERS - 1} orders</b>: Not enough data, unless even ${PLX.MORE_ORDERS} more orders would leave ACoS above break-even — then Lower. Raise needs ${PLX.MIN_ORDERS} orders.`,
      `<b>Raise +${PLX.STEP} points</b> when ACoS is at or below ${Math.round(PLX.RAISE_SHARE * 100)}% of the target; never over ${PLX.MAX_PCT}%, not with under ${STA.RAISE_COVER} days of FBA stock, and not when the campaign already spends ${Math.round(PLX.BUDGET_USE * 100)}% of its daily budget (raise the budget first).`,
      `<b>Lower −${PLX.STEP} points</b> when ACoS is above break-even (never below 0%). Already at 0%: the bids themselves are the lever — "Lower keyword bids" opens Search Term Analysis on that campaign.`,
      '<b>Keep</b> in between.',
      `Off Amazon has no adjustment at Amazon. Paused campaigns, campaigns in their first ${STA.AGE_DAYS} days and launch campaigns (by name) in their first ${STA.LAUNCH_DAYS} are not judged.`,
      `After a change is seen at Amazon, ${PLX.COOLDOWN} days before the next one ("Recently changed"); a downloaded change not seen at Amazon yet holds it too. After that the reason says how many of the 30 settled days are after the change.`])
    + L('What happens to a change', [
      '<b>Send to review</b> puts it in the shared review list (the same one as Search Term Analysis). Approved changes download as an Amazon bulk file (Entity "Bidding Adjustment", the new % as a whole number) to upload in the Ads console.',
      `<b>Apply now</b> is off: ${staEsc(ADS_APPLY.why)} Each change already carries the exact call Sellora will make then (the campaign's three placements, so the other two are not reset).`,
      'Bidding strategy matters: with "Dynamic bids · up and down", Amazon may raise a Top of Search bid by up to 100% on top of the adjustment.']);
}

/* ---------- export ---------- */
// The decisions table as CSV lines (heading first); [] when there is nothing. Used by Placement's Export.
function plxCsvLines() {
  const P = PLX_LAST || (ST.loaded ? plxModel() : null);
  if (!P || !P.rowsAll || !P.rowsAll.length) return [];
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [['Brand', 'Campaign', 'Campaign ID', 'Placement', 'Adjustment now %', 'Decision', 'Proposed %', 'Why', 'Impressions', 'Clicks',
    'Click share %', 'Spend', 'Sales', 'Orders', 'ACoS %', 'CPC', 'CVR %', 'Target ACoS %', 'Break-even ACoS %', 'Spend last 7 days'].map(cell).join(',')];
  P.rowsAll.forEach(r => lines.push([staBrandName(r.brand), r.cn, r.cid, r.name, r.cur == null ? '' : r.cur, r.dec, r.to == null ? '' : r.to, r.why,
    r.i, r.c, r.share == null ? '' : (r.share * 100).toFixed(1), staR2(r.sp), staR2(r.s), r.o, r.acos == null ? '' : r.acos.toFixed(1),
    r.cpc == null ? '' : r.cpc.toFixed(2), r.cvr == null ? '' : r.cvr.toFixed(1), r.camp.tgt == null ? '' : r.camp.tgt.toFixed(1),
    r.camp.be == null ? '' : r.camp.be.toFixed(1), r.rec ? staR2(r.rec.sp) : ''].map(cell).join(',')));
  return lines;
}

/* ---------- events ---------- */
$('plcBrand').addEventListener('change', () => { PLX_PG = 0; PLX_SEL.clear(); renderPlx(); });
let PLX_T = 0;
$('plxFilter').addEventListener('input', () => { clearTimeout(PLX_T); PLX_T = setTimeout(() => { PLX_PG = 0; PLX_SEL.clear(); renderPlx(); }, 200); });
$('plxPlace').addEventListener('change', () => { PLX_PG = 0; PLX_SEL.clear(); renderPlx(); });
$('plxRlBtn').onclick = () => {
  if (ST.loaded && ST_RL.where) staRlOpen();
  else $('plxFoot').insertAdjacentHTML('afterbegin', '<span class="plx-note">The review list opens once Search Term Analysis data has loaded (it loads with this page; a moment).</span>');
};
$('plxLegendBtn').onclick = () => { plxLegend(); $('plxLegend').classList.remove('hide'); };
$('plxLegendX').onclick = () => $('plxLegend').classList.add('hide');
$('plxLegend').addEventListener('click', e => { if (e.target === $('plxLegend')) $('plxLegend').classList.add('hide'); });
$('plxActBar').addEventListener('click', e => {
  if (e.target.closest('[data-tickall]')) {
    const tick = (PLX_LAST ? PLX_LAST.page || [] : []).flatMap(c => c.rowsShown).filter(r => r.can);
    const on = tick.length && tick.every(r => PLX_SEL.has(r.key));
    tick.forEach(r => { if (on) PLX_SEL.delete(r.key); else PLX_SEL.set(r.key, r); });
    renderPlx();
    return;
  }
  const c = e.target.closest('[data-a]');
  if (!c) return;
  PLX_ACT = PLX_ACT === c.dataset.a ? '' : c.dataset.a;
  PLX_PG = 0;
  PLX_SEL.clear();
  renderPlx();
});
$('plxKpis').addEventListener('click', e => {
  const c = e.target.closest('[data-chip]');
  if (!c) return;
  PLX_ACT = c.dataset.chip;
  PLX_PG = 0;
  PLX_SEL.clear();
  renderPlx();
  $('plxTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('plxTable').addEventListener('click', async e => {
  const cp = e.target.closest('button[data-copy]');
  if (cp) { staCopyText(cp.dataset.copy, cp); return; }
  const s = e.target.closest('[data-sort]');
  if (s) {
    const k = s.dataset.sort;
    PLX_SORT = PLX_SORT.k === k ? { k, d: -PLX_SORT.d } : { k, d: k === 'acos' ? 1 : -1 };
    renderPlx();
    return;
  }
  const t = e.target.closest('input[data-tick]');
  if (t) {
    const r = plxRowOf(t.dataset.tick);
    if (r) { if (t.checked) PLX_SEL.set(r.key, r); else PLX_SEL.delete(r.key); }
    t.closest('tr').classList.toggle('sel', t.checked);
    plxSelBar();
    plxActBar(PLX_LAST);
    return;
  }
  const send = e.target.closest('[data-send]');
  if (send) {
    const r = plxRowOf(send.dataset.send);
    if (r) { send.disabled = true; await plxSend([r]); }
    return;
  }
  const go = e.target.closest('[data-gost]');
  if (go) {
    const r = plxRowOf(go.dataset.gost);
    if (r) plxGoSt(r, go.dataset.view || '');
    return;
  }
  // Apply now (only when the switch is on): the change goes to the review list as approved, then to Amazon.
  const ap = e.target.closest('[data-apply]');
  if (ap && !ap.disabled) {
    const r = plxRowOf(ap.dataset.apply);
    if (!r || !r.can) return;
    ap.disabled = true;
    const it = Object.assign(plxItem(r), { status: 'approved', approvedBy: String(ME.email || ''), approvedAt: Date.now(), note: 'Apply now from Placement' });
    let msg;
    try { await staRlSave(it); msg = await staApply([it]); } catch (x) { msg = 'Could not save it: ' + (x.message || x); }
    renderPlx();
    $('plxFoot').insertAdjacentHTML('afterbegin', `<span class="plx-note">${staEsc(msg)}</span>`);
  }
});
$('plxFoot').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  PLX_PG = Math.max(0, PLX_PG + Number(b.dataset.pg));
  renderPlx();
  $('plxTable').scrollIntoView({ block: 'start' });
});
$('plxSelAdd').onclick = async () => {
  $('plxSelAdd').disabled = true;
  try { await plxSend([...PLX_SEL.keys()].map(plxRowOf).filter(Boolean)); } finally { $('plxSelAdd').disabled = false; }
};
$('plxSelClear').onclick = () => { PLX_SEL.clear(); renderPlx(); };
$('plcWorst').addEventListener('click', e => {
  const cp = e.target.closest('button[data-copy]');
  if (cp) staCopyText(cp.dataset.copy, cp);
});
