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
 * THE RULES (PLX):
 *   < MIN_ORDERS orders → Not enough data ("4 of 10 orders"), except 0 orders in NOSALE_CLICKS+ clicks → Lower.
 *   ACoS ≤ RAISE_SHARE × target → Raise +STEP points (cap MAX_PCT); not when FBA cover < STA.RAISE_COVER days.
 *   ACoS > break-even → Lower −STEP points (floor 0); already at 0% → "lower the keyword bids instead" (Search Term Analysis).
 *   Otherwise Keep. New campaigns (under STA.AGE_DAYS days), launch campaigns, paused campaigns, an open review item, or
 *   a change in the last COOLDOWN days → no decision.
 * Main functions: plxModel, plxDecide, renderPlx, plxKpis, plxDataLine, plxTable, plxItem, plxSend, plxCsvLines. */

const PLX = {
  MIN_ORDERS: 10,      // settled 7-day orders a placement needs before it is judged
  RAISE_SHARE: 0.75,   // raise when ACoS is at or below this share of the target
  STEP: 10,            // points per change, either way
  MAX_PCT: 200,        // Sellora never proposes more than this (Amazon allows 900)
  COOLDOWN: 3,         // days after a change before the next decision
  NOSALE_CLICKS: 40,   // 0 orders in this many clicks → lower, even under MIN_ORDERS
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
const PLX_CHIPS = [['raise', 'Raise'], ['lower', 'Lower'], ['keep', 'Keep'], ['thin', 'Not enough data'], ['review', 'In review'], ['hold', 'Hold / can\'t adjust']];
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
    if (x.status === 'review' || x.status === 'approved') open.set(x.key, x);
    else if (x.status === 'exported' || x.status === 'done' || x.status === 'applied') {
      const t = x.appliedAt || x.exportedAt || x.doneAt || x.at;
      if (!last.has(x.key) || t > last.get(x.key)) last.set(x.key, t);
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
  const set = (dec, why, to) => {
    r.dec = dec;
    r.why = why;
    r.to = to == null ? null : to;
    r.chip = dec === 'raise' || dec === 'lower' || dec === 'thin' || dec === 'review' ? dec : dec === 'keep' || dec === 'keep0' || dec === 'cap' ? 'keep' : 'hold';
    r.can = (dec === 'raise' || dec === 'lower') && r.cur != null && r.to != null && r.to !== r.cur;
    return r;
  };
  const m = PLX_META[r.pk];
  if (!m || m.ix < 0) return set('na', r.pk === 'off' ? 'Amazon has no bid adjustment for off-Amazon placements' : 'A placement Amazon has no adjustment for');
  if (c.state && !/enabled/i.test(c.state)) return set('na', 'Campaign ' + String(c.state).toLowerCase());
  if (c.launch) return set('hold', `Launch campaign (by its name): not judged on ACoS${c.launchTo ? ' until ' + staDay(c.launchTo) : ''}`);
  if (c.isNew && c.newFrom > now) return set('new', `New campaign: judged from ${staDay(c.newFrom)}`);
  const op = open.get(r.key);
  if (op) return set('review', `${staKindName(op)} ${plxPct(op.plc.from)} → ${plxPct(op.plc.to)} is in the review list`);
  const t = last.get(r.key);
  if (t && now - t < PLX.COOLDOWN * 86400000) return set('hold', `Changed ${staDays(t) || 'today'}${staDays(t) ? ' day' + (staDays(t) === 1 ? '' : 's') + ' ago' : ''}: next decision from ${staDay(t + PLX.COOLDOWN * 86400000)}`);
  const tgt = c.tgt, be = c.be, step = PLX.STEP;
  const down = r.cur == null ? null : Math.max(0, r.cur - step);
  if (!(r.o > 0) && r.c >= PLX.NOSALE_CLICKS) {
    if (r.cur === 0) return set('keep0', `0 orders in ${staInt(r.c)} clicks, and already at 0%: lower the keyword bids instead`);
    return set('lower', `0 orders in ${staInt(r.c)} clicks`, down);
  }
  if (r.o < PLX.MIN_ORDERS) return set('thin', `${staInt(r.o)} of ${PLX.MIN_ORDERS} orders needed before it is judged`);
  if (tgt == null) return set('hold', 'No unit cost for its products, so no target: set a fallback target in Search Term Analysis → Lists & settings');
  const src = c.fallback ? ' (your fallback)' : '';
  if (r.acos <= PLX.RAISE_SHARE * tgt) {
    if (c.cover != null && c.cover < STA.RAISE_COVER) return set('hold', `Sells well, but only ${Math.round(c.cover)} days of FBA stock: no raise`);
    if (r.cur != null && r.cur >= PLX.MAX_PCT) return set('cap', `ACoS ${staPct(r.acos)} is well under target, but it is at Sellora's ${PLX.MAX_PCT}% cap`);
    return set('raise', `ACoS ${staPct(r.acos)} is at or below 75% of the ${staPct(tgt)} target${src}, with ${staInt(r.o)} orders`,
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
  plxActBar(P);
  plxTable(P);
  plxSelBar();
  plxRlBadge();
}
// After a change in the review list (made from either page): redraw Placement if it is on screen.
function plxAfterChange() {
  if (!$('panePlc').classList.contains('hide')) renderPlx();
}
function plxRlBadge() {
  const n = ST_RL.items.filter(x => x.status === 'review' || x.status === 'approved').length;
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
  const tick = (P.shown || []).flatMap(c => c.rowsShown).filter(r => r.can);
  const allOn = tick.length && tick.every(r => PLX_SEL.has(r.key));
  $('plxActBar').classList.toggle('hide', !rows.length);
  $('plxActBar').innerHTML = '<span class="sta-actl">Decision</span>' + chip('', 'All', rows.length)
    + PLX_CHIPS.filter(([k]) => n[k]).map(([k, t]) => chip(k, t, n[k])).join('')
    + (tick.length ? `<button type="button" class="sta-btn dim sm sta-actall" data-tickall="1">${allOn ? 'Untick' : 'Tick'} all ${staInt(tick.length)}</button>` : '');
}

// The decision's badge and the line under it.
function plxDecCell(r) {
  const B = {
    raise: ['Raise', 'ok'], lower: ['Lower', 'bad'], keep: ['Keep', ''], keep0: ['Keep at 0%', 'warn'], cap: ['Keep · at the cap', ''],
    thin: ['Not enough data', ''], review: ['In review', 'info'], new: ['New', 'info'], hold: ['Hold', 'warn'], na: ['Can\'t adjust', ''],
  }[r.dec] || ['—', ''];
  const move = r.dec === 'raise' || r.dec === 'lower'
    ? `<span class="plx-move">${r.cur == null ? (r.dec === 'raise' ? '+' : '−') + PLX.STEP + ' points' : `${plxPct(r.cur)} → <b>${plxPct(r.to)}</b>`}</span>` : '';
  const link = r.dec === 'keep0' ? `<button type="button" class="sta-btn dim sm" data-gost="${staEsc(r.key)}">Lower keyword bids →</button>` : '';
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
  const th = (t, k, tip) => `<th class="num plx-sort${S.k === k ? ' on' : ''}" data-sort="${k}"${tip ? ` title="${staEsc(tip)}"` : ''}>${t}${S.k === k ? (S.d < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const head = `<thead><tr><th class="sta-stick">Campaign · placement</th><th class="num" title="The bid adjustment set at Amazon now">Now</th>
    <th class="num" title="This placement's clicks ÷ the campaign's clicks">Click share</th>${th('Impr.', 'i')}${th('Clicks', 'c')}${th('Spend', 'sp')}
    ${th('Sales', 's')}${th('Orders', 'o')}${th('ACoS', 'acos')}<th class="num">CPC</th><th class="num">CVR</th><th>Decision</th><th>Action</th></tr></thead>`;
  const num = (v, f) => v == null ? staDash : f(v);
  const recLine = r => r.rec && (r.rec.sp > 0 || r.rec.c > 0) ? `<small class="sta-s">+${staMoney0(r.rec.sp)} last 7 days</small>` : '';
  const body = page.map(c => {
    const strat = PLX_STRAT[c.strategy] || '';
    const tgtTxt = c.tgt != null ? `target ${staPct(c.tgt)} · break-even ${staPct(c.be)}${c.fallback ? ' (fallback)' : ''}` : 'no unit cost: no target';
    const nAct = c.rows.filter(r => r.dec === 'raise' || r.dec === 'lower').length;
    const head = `<tr class="sta-grprow plx-camp">
      <td class="sta-stick"><div class="sta-pl"><b>${staEsc(c.cn)}</b>${staCopy(c.cn, 'campaign')}</div>
        <div class="sta-under">${staBadge(staBrandName(c.brand), 'brand-' + c.brand)}${strat ? staBadge(strat, '') : ''}${c.budget ? `<span class="sta-dash">$${staInt(c.budget)}/day</span>` : ''}${c.state && !/enabled/i.test(c.state) ? staBadge(String(c.state).toLowerCase(), 'warn') : ''}</div></td>
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
  const open = new Set(ST_RL.items.filter(x => x.kind === 'plc' && (x.status === 'review' || x.status === 'approved')).map(x => x.key));
  let n = 0, skip = 0;
  for (const r of rows) {
    if (!r.can || open.has(r.key)) { skip++; continue; }
    try { await staRlSave(plxItem(r)); n++; open.add(r.key); } catch (e) { skip++; }
    PLX_SEL.delete(r.key);
  }
  staRlBadge();
  renderPlx();
  $('plxFoot').insertAdjacentHTML('afterbegin', `<span class="plx-note">${n ? `${n} change${n === 1 ? '' : 's'} added to the review list` : 'Nothing added'}${skip ? ` · ${skip} skipped (already waiting, or no current % from Amazon)` : ''}${ST_RL.where === 'local' ? ' · kept in this browser until the shared list is switched on' : ''}.</span>`);
}
const plxRowOf = key => (PLX_LAST ? PLX_LAST.rowsAll : []).find(r => r.key === key);

function plxSelBar() {
  const sel = [...PLX_SEL.values()].filter(r => r.can);
  $('plxSelBar').classList.toggle('hide', !sel.length);
  if (!sel.length) return;
  const up = sel.filter(r => r.dec === 'raise').length;
  $('plxSelTxt').innerHTML = `<b>${sel.length} selected</b> · ${up} raise, ${sel.length - up} lower`;
  $('plxSelAdd').textContent = `Send ${sel.length} to review`;
}

// "Lower keyword bids": Search Term Analysis → Burning money → By target, filtered to this campaign.
function plxGoSt(r) {
  ST_VIEW = 'burn';
  ST_SUB = 'target';
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
      `Under <b>${PLX.MIN_ORDERS} orders</b>: Not enough data — except <b>0 orders in ${PLX.NOSALE_CLICKS}+ clicks</b>, which lowers it.`,
      `<b>Raise +${PLX.STEP} points</b> when ACoS is at or below ${Math.round(PLX.RAISE_SHARE * 100)}% of the target; never over ${PLX.MAX_PCT}%, and not with under ${STA.RAISE_COVER} days of FBA stock.`,
      `<b>Lower −${PLX.STEP} points</b> when ACoS is above break-even (never below 0%). Already at 0%: the bids themselves are the lever — "Lower keyword bids" opens Search Term Analysis on that campaign.`,
      '<b>Keep</b> in between.',
      `Off Amazon has no adjustment at Amazon. Paused campaigns, campaigns in their first ${STA.AGE_DAYS} days and launch campaigns (by name) in their first ${STA.LAUNCH_DAYS} are not judged.`,
      `After a change, ${PLX.COOLDOWN} days before the next one, so Amazon\'s numbers can catch up.`])
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
$('plxFilter').addEventListener('input', () => { clearTimeout(PLX_T); PLX_T = setTimeout(() => { PLX_PG = 0; renderPlx(); }, 200); });
$('plxPlace').addEventListener('change', () => { PLX_PG = 0; renderPlx(); });
$('plxRlBtn').onclick = () => { if (ST.loaded) staRlOpen(); };
$('plxLegendBtn').onclick = () => { plxLegend(); $('plxLegend').classList.remove('hide'); };
$('plxLegendX').onclick = () => $('plxLegend').classList.add('hide');
$('plxLegend').addEventListener('click', e => { if (e.target === $('plxLegend')) $('plxLegend').classList.add('hide'); });
$('plxActBar').addEventListener('click', e => {
  if (e.target.closest('[data-tickall]')) {
    const tick = (PLX_LAST ? PLX_LAST.shown : []).flatMap(c => c.rowsShown).filter(r => r.can);
    const on = tick.length && tick.every(r => PLX_SEL.has(r.key));
    tick.forEach(r => { if (on) PLX_SEL.delete(r.key); else PLX_SEL.set(r.key, r); });
    renderPlx();
    return;
  }
  const c = e.target.closest('[data-a]');
  if (!c) return;
  PLX_ACT = PLX_ACT === c.dataset.a ? '' : c.dataset.a;
  PLX_PG = 0;
  renderPlx();
});
$('plxKpis').addEventListener('click', e => {
  const c = e.target.closest('[data-chip]');
  if (!c) return;
  PLX_ACT = c.dataset.chip;
  PLX_PG = 0;
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
    if (r) plxGoSt(r);
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
  try { await plxSend([...PLX_SEL.values()]); } finally { $('plxSelAdd').disabled = false; }
};
$('plxSelClear').onclick = () => { PLX_SEL.clear(); renderPlx(); };
$('plcWorst').addEventListener('click', e => {
  const cp = e.target.closest('button[data-copy]');
  if (cp) staCopyText(cp.dataset.copy, cp);
});
