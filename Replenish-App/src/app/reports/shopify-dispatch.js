/* ================= SHOPIFY DISPATCH =================
 *
 * Ravi, 2026-09-24: "kitne order dispatch hue via mcf, via fedex, dhl and pending order as well and konse
 * article sabse jyada pending h". Read straight from Shopify for both stores — the same call the Shopify
 * Orders tab makes — so the counts are Shopify's own, not a copy that can go stale.
 *
 * HOW IT WENT is the carrier Shopify's fulfilment names: Amazon (or an MCF id on the order) is MCF,
 * FedEx, DHL; anything else named is Other; a fulfilment with no carrier at all is said as such rather
 * than guessed. The carrier typed on the order in this app is used only when Shopify names none.
 */
const REP_SHIP_VIA = ['MCF', 'FedEx', 'DHL', 'Other', 'No carrier'];
function repShipVia(o, meta) {
  const m = meta || {}, co = String((o && o.trkCo) || '').toLowerCase();
  if (m.mcfId || /amazon/.test(co)) return 'MCF';
  if (/fedex/.test(co)) return 'FedEx';
  if (/dhl/.test(co)) return 'DHL';
  if (co) return 'Other';
  const c = String(m.carrier || '').toUpperCase();
  return c === 'MCF' ? 'MCF' : c === 'FEDEX' ? 'FedEx' : c === 'DHL' ? 'DHL' : 'No carrier';
}
/** Units of a Shopify line still to send: nothing once it shipped, else Shopify's own fulfillable count. */
function repShopLeft(i) {
  if (!i || String(i.ffl || '').toLowerCase() === 'fulfilled') return 0;
  if (i.fq != null) return Math.max(0, Number(i.fq) || 0);
  const q = i.cq != null ? Number(i.cq) || 0 : Number(i.qty) || 0;
  return Math.max(0, q - (Number(i.rq) || 0));
}
/** shipped · pending · cancelled · closed (nothing left to send and never shipped: refunded or removed). */
function repShopState(o) {
  if (o.cancelledAt) return 'cancelled';
  if (String(o.ff || '').toLowerCase() === 'fulfilled') return 'shipped';
  return (o.items || []).some(i => repShopLeft(i) > 0) ? 'pending' : 'closed';
}
/** What a line is, for "which article is most pending": the master's subtype, else the Shopify title. */
function repShopArt(i) {
  const m = typeof mdbOf === 'function' ? mdbOf(String((i && i.sku) || '').trim()) : null;
  if (m && String(m.subtype || m.articleType || '').trim()) return String(m.subtype || m.articleType).trim();
  const n = String((i && i.name) || '').split(/\s[-–—]\s/)[0].trim();
  return n || '(no name)';
}
/* HOW OLD THE PENDING ORDERS ARE (Ravi, 20 Oct: "shopify pending order report bucket wise chahiye like 0-7 days, 8-14
 * days, 15-21 days, 22-28 days ...."): a week to a bucket, counted in whole days from the day the order was placed to
 * today — 0–7, 8–14, 15–21, … up to the oldest open order. */
const repShopAgeDays = (at, today) => {
  const a = Date.parse(String(at || '').slice(0, 10) + 'T00:00:00Z'), t = Date.parse(String(today || '').slice(0, 10) + 'T00:00:00Z');
  return isNaN(a) || isNaN(t) ? null : Math.max(0, Math.round((t - a) / 86400000));
};
const repShopAgeIdx = d => (d <= 7 ? 0 : Math.ceil((d - 7) / 7));
const repShopAgeLabel = i => (i === 0 ? '0–7 days' : `${7 * i + 1}–${7 * i + 7} days`);
const repShopArtList = arts => [...arts.values()].map(a => ({ art: a.art, pcs: a.pcs, SP: a.SP, CPC: a.CPC, orders: a.ids.size, oldest: a.oldest }))
  .sort((x, y) => y.pcs - x.pcs || y.orders - x.orders || x.art.localeCompare(y.art));
/** Counts for one list of orders. metaOf(id) → the app's own record of that order (MCF id, carrier). */
function repShopDispatch(orders, metaOf, today) {
  const z = () => ({ SP: 0, CPC: 0 });
  const via = {}; REP_SHIP_VIA.forEach(k => { via[k] = z(); });
  const st = { placed: z(), shipped: z(), pending: z(), cancelled: z(), closed: z() };
  const arts = new Map(), ages = [];
  const day = today || (typeof dToday === 'function' ? dToday() : new Date().toISOString().slice(0, 10));
  const addArt = (map, art, n, b, o) => {
    let a = map.get(art);
    if (!a) map.set(art, a = { art, pcs: 0, SP: 0, CPC: 0, ids: new Set(), oldest: '' });
    a.pcs += n; a[b] += n; a.ids.add(o.id);
    if (o.at && (!a.oldest || o.at < a.oldest)) a.oldest = o.at;
  };
  (orders || []).forEach(o => {
    const b = o.shopBrand === 'CPC' ? 'CPC' : 'SP', k = repShopState(o);
    st.placed[b]++; st[k][b]++;
    if (k === 'shipped') via[repShipVia(o, metaOf ? metaOf(o.id) : null)][b]++;
    if (k !== 'pending') return;
    const d = repShopAgeDays(o.at, day), ai = d == null ? null : repShopAgeIdx(d);
    let g = null;
    if (ai != null) {
      for (let i = ages.length; i <= ai; i++) ages[i] = { idx: i, label: repShopAgeLabel(i), orders: z(), pcs: z(), arts: new Map() };
      g = ages[ai]; g.orders[b]++;
    }
    (o.items || []).forEach(i => {
      const n = repShopLeft(i); if (!n) return;
      const art = repShopArt(i);
      addArt(arts, art, n, b, o);
      if (g) { g.pcs[b] += n; addArt(g.arts, art, n, b, o); }
    });
  });
  return { via, st, arts: repShopArtList(arts), ages: ages.map(g => Object.assign({}, g, { arts: repShopArtList(g.arts) })) };
}
/** Both stores, one window. A store that fails is named, never silently left out of the totals. */
async function repShopFetch(win) {
  const [r, c] = await Promise.all([
    prGet(Object.assign({ shopify: 'orders' }, win)).catch(e => ({ _err: e.message || String(e) })),
    prGet(Object.assign({ shopify: 'orders', shop: 'CPC' }, win)).catch(e => ({ _err: e.message || String(e) })),
  ]);
  const errs = [r._err ? 'Ridhi: ' + r._err : '', c._err ? 'CPC: ' + c._err : ''].filter(Boolean);
  const more = !!(r.more || c.more);
  return { orders: (r.orders || []).map(o => Object.assign(o, { shopBrand: 'SP' }))
    .concat((c.orders || []).map(o => Object.assign(o, { shopBrand: 'CPC' }))), errs, more };
}
async function repLoadShopDispatch(ym) {
  REP.shd = { ym, busy: true };
  renderRep();
  try {
    if (typeof SHOP_META !== 'undefined' && !Object.keys(SHOP_META).length && typeof loadShopMeta === 'function') await loadShopMeta();
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const back = new Date(); back.setDate(back.getDate() - 120);
    const [mon, now] = await Promise.all([
      repShopFetch({ start: ym + '-01', end: ym + '-' + String(last).padStart(2, '0'), open: '0' }),
      repShopFetch({ start: back.toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10), open: '1' }),
    ]);
    const metaOf = id => (typeof SHOP_META !== 'undefined' ? SHOP_META[id] : null);
    REP.shd = { ym, sum: repShopDispatch(mon.orders, metaOf), now: repShopDispatch(now.orders, metaOf),
      errs: mon.errs.concat(now.errs.map(e => e + ' (pending)')), more: mon.more || now.more, at: ptStamp() };
  } catch (e) {
    REP.shd = { ym, err: e.message || String(e) };
  }
  if (REP.view === 'shpd') renderRep();
}
function repRenderShopDispatch() {
  const ym = $('repMonth').value;
  if (!ym) { $('repMsg').textContent = 'Pick a month.'; return; }
  if (!REP.shd || REP.shd.ym !== ym) { repLoadShopDispatch(ym); return; }
  if (REP.shd.busy) { $('repMsg').className = 'muted'; $('repMsg').textContent = 'Asking Shopify for both stores…'; $('repKpis').innerHTML = ''; ptEmpty('repTable', 'Loading…'); return; }
  if (REP.shd.err) { $('repMsg').className = 'err'; $('repMsg').textContent = 'Could not read Shopify: ' + REP.shd.err; $('repKpis').innerHTML = ''; ptEmpty('repTable', 'Nothing to show.'); return; }
  const d = REP.shd.sum, n = REP.shd.now;
  const tot = x => x.SP + x.CPC;
  const split = x => 'Ridhi ' + nf(x.SP) + ' · CPC ' + nf(x.CPC);
  const tile = (v, l, sub, tone) => `<div class="metric"><div class="v"${tone ? ' style="color:' + tone + '"' : ''}>${nf(v)}</div><div class="l">${l}</div><div class="muted" style="font-size:11px">${sub}</div></div>`;
  const mName = new Date(ym + '-01T00:00:00').toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const pendPcs = n.arts.reduce((t, a) => t + a.pcs, 0);
  const oldest = n.arts.reduce((o, a) => (a.oldest && (!o || a.oldest < o) ? a.oldest : o), '');
  $('repMsg').className = REP.shd.errs.length ? 'err' : 'muted';
  $('repMsg').textContent = [REP.shd.errs.length ? 'Not everything could be read — ' + REP.shd.errs.join(' · ') : '',
    REP.shd.more ? 'Shopify had more orders than one read holds; the counts may be short.' : '',
    'Read live from Shopify · ' + REP.shd.at].filter(Boolean).join(' · ');
  $('repKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Dispatched — orders placed in ${esc(mName)}</span><span class="kpiwhen">by the carrier on Shopify's fulfilment</span></div>
    <div class="metrics">${tile(tot(d.st.placed), 'Orders placed', split(d.st.placed))}${tile(tot(d.st.shipped), 'Dispatched', split(d.st.shipped), 'var(--accent)')}`
    + REP_SHIP_VIA.filter(k => k !== 'No carrier' || tot(d.via[k])).map(k => tile(tot(d.via[k]), 'via ' + k, split(d.via[k]))).join('')
    + `${tile(tot(d.st.pending), 'Still pending', split(d.st.pending), 'var(--bad)')}${tot(d.st.cancelled) ? tile(tot(d.st.cancelled), 'Cancelled', split(d.st.cancelled)) : ''}</div></div>
    <div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Pending right now — every open order of the last 120 days</span><span class="kpiwhen">not yet dispatched</span></div>
    <div class="metrics">${tile(tot(n.st.pending), 'Pending orders', split(n.st.pending), 'var(--bad)')}${tile(pendPcs, 'Pieces to send', 'on those orders')}`
    + `<div class="metric"><div class="v" style="font-size:18px">${esc(oldest || '—')}</div><div class="l">Oldest pending order</div></div></div></div>`
    + repShopAgeCard(n);
  const pick = REP.shdAge != null && n.ages && n.ages[REP.shdAge] ? n.ages[REP.shdAge] : null;
  const arts = pick ? pick.arts : n.arts;
  if (!arts.length) { ptEmpty('repTable', pick ? 'Nothing pending in ' + pick.label + '.' : 'Nothing is pending.'); return; }
  const top = arts[0].pcs || 1;
  $('repTable').innerHTML = '<thead><tr><th style="text-align:left">Article — most pending first' + (pick ? ' · ' + esc(pick.label) + ' old' : '') + '</th><th class="num">Pending pieces</th><th class="num">Orders</th>'
    + '<th class="num">Ridhi</th><th class="num">CPC</th><th>Oldest order</th><th style="width:30%"></th></tr></thead><tbody>'
    + arts.slice(0, 200).map(a => '<tr><td style="text-align:left;font-weight:600">' + esc(a.art) + '</td>'
      + '<td class="num" style="font-weight:700">' + nf(a.pcs) + '</td><td class="num">' + nf(a.orders) + '</td>'
      + '<td class="num">' + (a.SP ? nf(a.SP) : '<span class="muted">—</span>') + '</td><td class="num">' + (a.CPC ? nf(a.CPC) : '<span class="muted">—</span>') + '</td>'
      + '<td>' + esc(a.oldest || '') + '</td>'
      + '<td><div style="height:8px;border-radius:4px;background:var(--bad);opacity:.75;width:' + Math.max(2, Math.round(a.pcs / top * 100)) + '%"></div></td></tr>').join('')
    + '</tbody>';
}

/** Pending by age: one tile a week, orders big, pieces and shops under; a tile narrows the article table to it. */
function repShopAgeCard(n) {
  const ages = (n && n.ages) || [];
  if (!ages.length) return '';
  const sel = REP.shdAge;
  const tile = g => { const o = g.orders.SP + g.orders.CPC, p = g.pcs.SP + g.pcs.CPC, on = sel === g.idx, old = g.idx >= 2;
    return `<button type="button" class="metric" data-shdage="${g.idx}" title="Show only the articles of orders ${esc(g.label)} old"
      style="text-align:left;cursor:pointer;border:${on ? '2px solid var(--accent)' : '1px solid var(--line)'};background:${on ? 'var(--soft,#eef3f9)' : 'transparent'};border-radius:12px;padding:8px 12px;min-width:120px;width:auto">
      <div class="l" style="font-weight:700">${esc(g.label)}</div><div class="v"${o && old ? ' style="color:var(--bad)"' : ''}>${nf(o)}</div>
      <div class="muted" style="font-size:11px">orders · ${nf(p)} pcs</div><div class="muted" style="font-size:11px">Ridhi ${nf(g.orders.SP)} · CPC ${nf(g.orders.CPC)}</div></button>`; };
  return `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Pending by age — days since the order was placed</span><span class="kpiwhen">${sel != null ? '<a href="#" data-shdage="all">show all ages</a>' : 'tap a week to see its articles'}</span></div>
    <div class="metrics" style="gap:8px;flex-wrap:wrap">${ages.map(tile).join('')}</div></div>`;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('[data-shdage]'); if (!b) return;
  e.preventDefault();
  const v = b.getAttribute('data-shdage');
  REP.shdAge = v === 'all' || +v === REP.shdAge ? null : +v;
  if (REP.view === 'shpd' || ($('repView') && $('repView').value === 'shpd')) repRenderShopDispatch();
});
function renderRep() {
  if (REP.busy) { $('repMsg').className = 'muted'; $('repMsg').textContent = 'Reading…'; ptEmpty('repTable', 'Loading…'); return; }
  const v = $('repView').value;
  REP.view = v;
  ptFillSelect('repBrand', repBrands().map(b => [b, b]), 'All brands');
  /* Only the controls a report actually uses are shown — a month picker on a report that ignores
   * it is a question the reader will waste time answering. */
  $('repMonth').classList.toggle('hide', v !== 'wpr' && v !== 'ihp' && v !== 'shpd');
  $('repBrand').classList.toggle('hide', v === 'shpd');     // both shops are shown side by side there
  $('repWeeks').classList.toggle('hide', v !== 'srpl');
  $('repWk').classList.toggle('hide', v !== 'wow' && v !== 'mtg');
  $('repQ').classList.toggle('hide', v !== 'qa');
  if ($('repQaWk')) $('repQaWk').classList.toggle('hide', v !== 'qa');
  /* CLEARED BEFORE ANY OF THEM DRAWS. Only the week-on-week report has charts, and one view's charts
   * sitting above another view's table is worse than no charts at all — the figures would look like
   * they belonged to the table under them. The view that has them fills them back in. */
  repChartsOff();
  if (v === 'wow') { repFillWeeks(); return repRenderWow(); }
  if (v === 'mtg') return renderMtg();
  if (v === 'live') return repRenderLive();
  if (v === 'wpr' || v === 'ihp') return repRenderWeekly(v === 'ihp');
  if (v === 'fgval') return repRenderFgVal();
  if (v === 'srpl') return repRenderSurplus();
  if (v === 'shpd') return repRenderShopDispatch();
  return repRenderQa();
}

$('repView').addEventListener('change', async () => {
  if ($('repView').value === 'fgval' && FGI.rows === null) {
    REP.busy = true; renderRep();
    try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { FGI.rows = []; }
    REP.busy = false;
  }
  if ($('repView').value === 'qa' && !REP.qc) {
    REP.busy = true; renderRep();
    try { REP.qc = ptList(await ptGet('pt_qcChecks')); } catch (e) { REP.qc = []; }
    REP.busy = false;
  }
  renderRep();
});
['repMonth', 'repBrand', 'repWeeks', 'repWk', 'repQaWk'].forEach(id => $(id).addEventListener('change', renderRep));
ptDebounce('repQ', renderRep);
$('repGo').onclick = async () => { PTG.mdb = null; FGI.rows = null; REP.qc = null; REP.shd = null;
  if ($('repView').value === 'mtg') { VO.rows = null; SOX.rows = null; ACC.ledger = null; ORD_DEM.tried = false; MTG.meet = null; renderRep(); await mtgLoad(true); return renderRep(); }
  await ptLoadGates(); REP.at = ptStamp();
  if ($('repView').value === 'qa') { try { REP.qc = ptList(await ptGet('pt_qcChecks')); } catch (e) { REP.qc = []; } }
  if ($('repView').value === 'fgval') { try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { FGI.rows = []; } }
  renderRep(); };
$('repExport').onclick = () => {
  if ($('repView').value === 'mtg') return mtgExport();
  if ($('repView').value === 'shpd') {
    const d = REP.shd && REP.shd.sum; if (!d) return;
    const out = [['Report', 'What', 'Ridhi', 'CPC', 'Total'].map(csvCell).join(',')];
    REP_SHIP_VIA.forEach(k => out.push(['Dispatched in ' + REP.shd.ym, 'via ' + k, d.via[k].SP, d.via[k].CPC, d.via[k].SP + d.via[k].CPC].map(csvCell).join(',')));
    ['placed', 'shipped', 'pending', 'cancelled', 'closed'].forEach(k => out.push(['Orders placed in ' + REP.shd.ym, k,
      d.st[k].SP, d.st[k].CPC, d.st[k].SP + d.st[k].CPC].map(csvCell).join(',')));
    out.push('');
    out.push(['Pending by age', 'Orders', 'Ridhi orders', 'CPC orders', 'Pieces', 'Ridhi pieces', 'CPC pieces'].map(csvCell).join(','));
    (REP.shd.now.ages || []).forEach(g => out.push([g.label, g.orders.SP + g.orders.CPC, g.orders.SP, g.orders.CPC, g.pcs.SP + g.pcs.CPC, g.pcs.SP, g.pcs.CPC].map(csvCell).join(',')));
    out.push('');
    out.push(['Article (pending now)', 'Pending pieces', 'Orders', 'Ridhi pieces', 'CPC pieces', 'Oldest order'].map(csvCell).join(','));
    REP.shd.now.arts.forEach(a => out.push([a.art, a.pcs, a.orders, a.SP, a.CPC, a.oldest].map(csvCell).join(',')));
    return ptDownload('shopify-dispatch-' + REP.shd.ym, out);
  }
  if ($('repView').value === 'wow') {
    const w = REP.wow; if (!w || !w.rows.length) return;
    const out = [['Article type'].concat(w.weeks.map(x => repWkRange(x)))
      .concat(['Customer (last week)', 'Change', 'Week on week %']).map(csvCell).join(',')];
    w.rows.forEach(r => out.push([r.art].concat(r.hist)
      .concat([Math.round(r.cust), r.delta, r.pct === null ? 'new' : r.pct.toFixed(1)]).map(csvCell).join(',')));
    ptDownload('week-on-week', out);
    return;
  }
  if ($('repView').value === 'live') {
    const L = REP.live; if (!L || !L.rows.length) return;
    const out = [['Article type', 'This week so far', 'Customer', 'Same days last week', 'Change', 'Week on week %']
      .map(csvCell).join(',')];
    L.rows.forEach(r => out.push([r.art, Math.round(r.prod), Math.round(r.cust), Math.round(r.prevProd),
      Math.round(r.delta), r.pct === null ? 'new' : r.pct.toFixed(1)].map(csvCell).join(',')));
    ptDownload('this-week-so-far', out);
    return;
  }
  const v = $('repView').value;
  if (v === 'wpr' || v === 'ihp') {
    const ym = $('repMonth').value; if (!ym) return;
    const { weeks, byWeek, arts } = repWeekly(+ym.split('-')[0], +ym.split('-')[1], $('repBrand').value, v === 'ihp');
    const head = ['Article type'].concat(weeks.flatMap(w => [repWeekLabel(w) + ' customer', repWeekLabel(w) + ' production']))
      .concat(['Month customer', 'Month production']);
    const lines = [head.map(csvCell).join(',')];
    arts.forEach(a => {
      const cells = weeks.flatMap(w => { const d = (byWeek[w] && byWeek[w][a]) || { cust: 0, prod: 0 }; return [Math.round(d.cust), d.prod]; });
      const tc = weeks.reduce((s, w) => s + (((byWeek[w] || {})[a] || {}).cust || 0), 0);
      const tp = weeks.reduce((s, w) => s + (((byWeek[w] || {})[a] || {}).prod || 0), 0);
      lines.push([a].concat(cells).concat([Math.round(tc), tp]).map(csvCell).join(','));
    });
    return ptDownload((v === 'ihp' ? 'inhouse' : 'weekly') + '-production-' + ym, lines);
  }
  if (v === 'fgval') {
    const rows = REP.shown || []; if (!rows.length) return;
    return ptDownload('finished-goods-valuation',
      [['SKU', 'Brand', 'Article', 'Subtype', 'Pack', 'Pieces', 'Customer-facing', 'Price', 'Value'].map(csvCell).join(',')]
        .concat(rows.map(r => [r.sku, r.brand, r.articleType, r.subtype, r.pack, r.pieces,
          Math.round(r.cust), r.price === null ? '' : r.price, r.price === null ? '' : Math.round(r.value)].map(csvCell).join(','))));
  }
  if (v === 'srpl') {
    const { series } = repSurplus(parseInt($('repWeeks').value, 10) || 12, $('repBrand').value);
    return ptDownload('surplus',
      [['Week ending', 'Pressed', 'Pressed over', 'Cut', 'Cut over'].map(csvCell).join(',')]
        .concat(series.map(s => [s.end.toISOString().slice(0, 10), Math.round(s.madePress),
          Math.round(s.overPress), Math.round(s.madeCut), Math.round(s.overCut)].map(csvCell).join(','))));
  }
  const rows = REP.shown || []; if (!rows.length) return;
  const W = REP.qaWeek;
  if (W) return ptDownload('qc-passed-production-' + W.wk,
    [['QC passed (production)', 'Week', qaRange(W.wk)].map(csvCell).join(','), ['Passed', W.okp, 'Last week', W.prev, 'Checked', W.chk, 'Rejected', W.rej, 'For alteration', W.alt].map(csvCell).join(','), '',
      ['Day', 'Passed'].map(csvCell).join(',')].concat(W.days.map(d2 => [d2.label, d2.ok].map(csvCell).join(',')), [''],
      [['Article', 'This week', 'Last week'].map(csvCell).join(',')], W.arts.map(a2 => [a2.k, a2.now, a2.prev].map(csvCell).join(',')), [''],
      [['Kept apart (not in production)', 'This week', 'Last week'].map(csvCell).join(',')], (W.apart || []).map(a2 => [a2.k, a2.now, a2.prev].map(csvCell).join(',')), [''],
      W.kar.length ? [['Karigar', 'Passed'].map(csvCell).join(',')].concat(W.kar.map(k => k.map(csvCell).join(','))).concat(['']) : [],
      [['SKU', 'Article', 'Colour', 'Size', 'Checked', 'Passed', 'Rejected', 'For alteration'].map(csvCell).join(',')],
      rows.map(o => [o.sku, o.articleType, o.color, o.size, o.chk, o.ok, o.rej, o.alt].map(csvCell).join(','))));
  ptDownload('quality',
    [['SKU', 'Article', 'Colour', 'Size', 'Checked', 'Passed', 'Rejected', 'For alteration'].map(csvCell).join(',')]
      .concat(rows.map(o => [o.sku, o.articleType, o.color, o.size, o.chk, o.ok, o.rej, o.alt].map(csvCell).join(','))));
};

$('repMonth').value = (() => {
  let best = 0;
  (PTG.press || []).forEach(r => { const ms = r && ptDtMs(r.entryDate); if (ms > best) best = ms; });
  const d = best ? new Date(best) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
})();

