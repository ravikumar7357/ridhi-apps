/* ================= WHAT THE VENDORS HOLD, ORDER BY ORDER =================
 *
 * A vendor order line names a SKU and a quantity; it has never named the sales order it was raised
 * for. So what a printer holds is known per SKU, and an order line's share of it has to be worked out.
 *
 * SHARED OUT ONCE. Where one order wants a SKU the share is simply all of it. Where several do, the
 * printer's pieces are dealt to them in turn and each piece is dealt once — judging every order against
 * the whole pile would show the same 25 pieces as "with the printer" on all of them.
 *
 * WHO IS SERVED FIRST: the orders still OPEN, oldest first — that is who the cloth is for. Whatever is
 * left goes to finished orders, newest first: they are the likeliest to have used it, and an order
 * finished a year before any vendor order existed should not swallow this month's printing.
 *
 * A line put with a printer FROM THIS SCREEN (it carries shopKey) is not in the pile: it already
 * belongs to one order line, and the Printing column has always shown it.
 */
let ORDV = { vo: null, lines: null, map: null };
function ordVendorAlloc() {
  const lines = ordLines();
  if (ORDV.map && ORDV.vo === VO.rows && ORDV.lines === lines) return ORDV.map;
  const pile = new Map();                                  // sku → the vendor lines holding it, oldest first
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled') return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;
      const sku = obUC(l.sku), qty = parseFloat(l.qty) || 0;
      if (!sku || !(qty > 0)) return;
      const back = voDels(l).reduce((t, d) => { const ok = vlOk(d); return t + (ok ? (parseFloat(ok.qty) || 0) : 0); }, 0);
      if (!pile.has(sku)) pile.set(sku, []);
      /* A DELIVERY THAT NAMES ITS ORDERS (2026-10-03, Ravi: "order number base banao"): the office says, as it accepts,
       * which orders the pieces came for. That part of what came back belongs to those orders and is not shared out. */
      const named = new Map(); let namedLeft = Math.min(back, qty);
      voDels(l).forEach(d => { const ok = vlOk(d); if (!ok || !Array.isArray(ok.orders)) return;
        ok.orders.forEach(f => { const no = obUC(f && f.orderNo), q = Math.min(parseFloat(f && f.qty) || 0, namedLeft);
          if (no && q > 0) { named.set(no, (named.get(no) || 0) + q); namedLeft -= q; } }); });
      const namedTot = [...named.values()].reduce((a, b) => a + b, 0);
      pile.get(sku).push({ vendorCode: o.vendorCode, vpo: o.orderNo || o.id, service: prLineServices(o.vendorCode, o)[0] || '',
        left: qty, backLeft: Math.min(back, qty) - namedTot, named, at: ptDtMs(o.orderDate) || Date.parse(o.createdAt || '') || 0,
        forOrders: Array.isArray(l.forOrders) ? l.forOrders : [],
        due: voDayOf(l.vendorDate) || voDayOf(l.deliveryDate) || '' });
    });
  });
  pile.forEach(v => v.sort((a, b) => a.at - b.at));
  const want = new Map();                                  // sku → the order lines wanting it, in serving order
  lines.forEach(r => { if (!pile.has(r.sku)) return; if (!want.has(r.sku)) want.set(r.sku, []); want.get(r.sku).push(r); });
  const when = r => ptDtMs(r.orderDate) || 0;
  const map = new Map();
  want.forEach((rows, sku) => {
    const open = rows.filter(r => r.open).sort((a, b) => when(a) - when(b));
    const shut = rows.filter(r => !r.open).sort((a, b) => when(b) - when(a));
    const chunks = pile.get(sku), partsOf = new Map(), gave = new Map();
    const give = (r, c, take, stamped) => {
      /* What came back NAMED for this order is its own first; then its share of what came back unnamed. */
      const nb = Math.min(take, c.named.get(r.orderNo) || 0);
      if (nb) c.named.set(r.orderNo, c.named.get(r.orderNo) - nb);
      const ub = Math.min(take - nb, c.backLeft), back = nb + ub;
      c.left -= take; c.backLeft -= ub;
      if (!gave.has(c)) gave.set(c, new Map());
      gave.get(c).set(r, (gave.get(c).get(r) || 0) + take);
      if (!partsOf.has(r)) partsOf.set(r, []);
      partsOf.get(r).push({ vendorCode: c.vendorCode, vpo: c.vpo, service: c.service, qty: take, back, due: c.due, stamped }); };
    const gaveFrom = (r, c) => (gave.get(c) && gave.get(c).get(r)) || 0;
    /* A delivery that named an order is a fact, like a stamp — honoured first. Named for an order no longer in the book,
     * the pieces go back to the pile rather than vanishing. */
    chunks.forEach(c => c.named.forEach((q, no) => {
      const r = rows.find(x => x.orderNo === no);
      if (!r) { c.backLeft += q; c.named.delete(no); return; }
      const take = Math.min(q, c.left);
      if (take > 0) give(r, c, take, true);
    }));
    /* WHAT WAS WRITTEN DOWN COMES FIRST. A line placed since 2026-09-19 names the orders it is for, and
     * that is a fact, not a share: it is honoured before anything is dealt, and no rule can move it. A
     * stamp for an order that has since left the book goes back into the pile rather than vanishing. */
    chunks.forEach(c => (c.forOrders || []).forEach(f => {
      const r = rows.find(x => x.orderNo === obUC(f.orderNo));
      const take = r ? Math.min((parseFloat(f.qty) || 0) - gaveFrom(r, c), c.left) : 0;
      if (r && take > 0) give(r, c, take, true);
    }));
    const held = r => (partsOf.get(r) || []).reduce((t, p) => t + p.qty, 0);
    open.concat(shut).forEach(r => {
      let need = r.qty - held(r);
      for (const c of chunks) {
        if (!(need > 0)) break;
        if (!(c.left > 0)) continue;
        const take = Math.min(need, c.left);
        give(r, c, take, false); need -= take;
      }
    });
    partsOf.forEach((parts, r) => map.set(r.orderNo + '|' + r.sku, {
      given: parts.reduce((t, p) => t + p.qty, 0), back: parts.reduce((t, p) => t + p.back, 0), parts,
      /* Only a WORKED-OUT share is "shared". A stamped one was decided when the order was placed. */
      shared: rows.length > 1 && parts.some(p => !p.stamped) }));
  });
  ORDV = { vo: VO.rows, lines, map };
  return map;
}
/**
 * WHICH SALES ORDERS A NEW VENDOR LINE IS FOR — decided once, as the order is placed.
 *
 * Each cut line's pieces go to the OPEN orders wanting that SKU, oldest first, and only as far as each
 * still needs: what vendors already hold for an order (stamped or worked out) comes off its need first,
 * so a second order for the same SKU stamps the NEXT order, not the first one again. Pieces no open
 * order wants are left unstamped — they are still real, and the sharing rule accounts for them.
 * Returns the lines with forOrders added; a line that already carries one is left exactly as it is.
 */
function voStampOrders(lines, channel) {
  const taken = new Map();                                  // order line → pieces this very order has already given it
  const when = r => ptDtMs(r.orderDate) || 0;
  return (lines || []).map(l => {
    if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || (Array.isArray(l.forOrders) && l.forOrders.length)) return l;
    const sku = obUC(l.sku); let left = parseFloat(l.qty) || 0;
    if (!sku || !(left > 0)) return l;
    const forOrders = [];
    ordLines().filter(r => r.sku === sku && r.open && (!channel || voChannelWants(channel, r))).sort((a, b) => when(a) - when(b)).forEach(r => {
      if (!(left > 0)) return;
      const k = r.orderNo + '|' + r.sku, v = ordVendorOf(r.orderNo, r.sku);
      const need = r.qty - (r.printer ? r.qty : (v ? v.given : 0)) - (taken.get(k) || 0);
      const take = Math.min(left, need);
      if (!(take > 0)) return;
      forOrders.push({ orderNo: r.orderNo, qty: take }); taken.set(k, (taken.get(k) || 0) + take); left -= take;
    });
    return forOrders.length ? Object.assign({}, l, { forOrders }) : l;
  });
}

/** One order line's share — null when no vendor holds anything for it. */
const ordVendorOf = (orderNo, sku) => ordVendorAlloc().get(obUC(orderNo) + '|' + obUC(sku)) || null;

/**
 * Where a line is waiting, in one word — the first stage that has not caught up with the one before.
 * Read off the same figures the row shows, so the two cannot disagree.
 */
function ordWaitingAt(r) {
  /* THE LAST LEG IS WORTH SAYING EVEN ON A FINISHED LINE — that is Ravi's own case: 25 ordered, 25 made,
   * and all 25 sitting dispatched to FBA. "Complete" leads, so anything reading the first word still
   * reads what it always did. */
  const fin = ordFgAt(r.orderNo, r.sku) || { store: 0, fbaOpen: 0, in: 0 };
  /* …and past the store, where it went (2026-09-25): shipped to Amazon, or issued out to the buyer. */
  const tail = fin.fbaOpen ? ' · ' + nf(fin.fbaOpen) + ' waiting to ship to FBA'
    : (fin.store ? ' · ' + nf(fin.store) + ' in store'
      : (fin.fbaShip ? ' · ' + nf(fin.fbaShip) + ' shipped to Amazon' + (fin.issued ? ', ' + nf(fin.issued) + ' dispatched' : '')
        : (fin.issued ? ' · ' + nf(fin.issued) + ' dispatched' : '')));
  /* HANDED OVER IS THE END OF A SHOPIFY LINE, and it says so by name — "Complete" on its own leaves you
   * wondering whether the goods actually went anywhere. */
  if (!r.open) return (r.shopDoneAt && !r.handedAt ? SHP_DONE_TXT(r.shopDoneWhy)
    : (r.handedAt ? 'Handed over' + (r.unrecorded ? ' · ' + nf(r.unrecorded) + ' never recorded' : '') : 'Complete')) + tail;
  const v = ordVendorOf(r.orderNo, r.sku);
  const vGiven = r.printer ? r.qty : (v ? v.given : 0), vBack = r.printer ? r.printed : (v ? v.back : 0);
  if (vGiven > vBack && (r.cutReq ? r.cut < vGiven : r.received < vGiven)) return 'Vendor — ' + nf(vGiven - vBack) + ' to come back';
  if (r.pendingCut > 0) return 'Cutting — ' + nf(r.pendingCut) + ' to cut';
  if (r.issued < r.qty) return 'Issue — ' + nf(r.qty - r.issued) + ' not given to a karigar';
  if (r.received < r.issued) return 'Karigar — ' + nf(r.issued - r.received) + ' out';
  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  /* ONLY A SHOPIFY LINE CAN BE HERE. Every other kind is open only while pressed < ordered, so getting
   * past the press check means it is not open and this function returned at the top. A Shopify line
   * stays open until the shipping team takes it, which is exactly what it is waiting for. */
  return 'Ready to hand over to shipping' + tail;
}

/**
 * One order, start to finish. Every stage for every line, what each vendor holds and until when, and
 * where each line is waiting — so that "where is order X" is one click and not six screens.
 */
function ordJourney(orderNo) {
  const no = obUC(orderNo), rows = ordLines().filter(r => r.orderNo === no);
  if (!rows.length) return;
  const stage = r => { const v = ordVendorOf(r.orderNo, r.sku), q = ordQcOf(r.orderNo, r.sku);
    return { ordered: r.qty, given: r.printer ? r.qty : (v ? v.given : 0), back: r.printer ? r.printed : (v ? v.back : 0),
      cut: r.cutReq ? r.cut : null, issued: r.issued, received: r.received, qc: q ? q.ok : null, pressed: r.pressed,
      store: (ordFgAt(r.orderNo, r.sku) || {}).store || 0, fba: (ordFgAt(r.orderNo, r.sku) || {}).fba || 0,
      fbaShip: (ordFgAt(r.orderNo, r.sku) || {}).fbaShip || 0, out: (ordFgAt(r.orderNo, r.sku) || {}).issued || 0,
      docs: (ordFgAt(r.orderNo, r.sku) || {}).docs || [], worked: (ordFgAt(r.orderNo, r.sku) || {}).worked || 0, v }; };
  const S = rows.map(stage), sum = f => S.reduce((t, x) => t + (x[f] || 0), 0);
  /* A SHOPIFY ORDER ENDS AT THE SHIPPING TABLE, not at Amazon, and it does not normally pass through the
   * store — so those two tiles are shown only when they hold something, and the handover takes their
   * place. Tiles for stages an order never has are noise on the one screen meant to answer "where is it". */
  const shop = rows.some(r => r.src === 'SHP');
  const handed = rows.filter(r => r.handedAt).reduce((t, r) => t + r.qty, 0);
  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')]]
    .concat(shop && !sum('store') && !sum('fba') && !sum('out') ? [] : [['In store', sum('store')], ['To FBA', sum('fba')]])
    /* THE LAST LEG (2026-09-25): what Amazon has, and what went out to a buyer. Shown when the order has any. */
    .concat(sum('fba') ? [['Shipped to Amazon', sum('fbaShip')]] : [])
    .concat(sum('out') ? [['Dispatched', sum('out')]] : [])
    .concat(shop ? [['Handed over', handed]] : []);
  const strip = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + tiles.map(([l, n], i) =>
    `<div style="flex:1 1 92px;border:1px solid var(--line);border-radius:10px;padding:7px 9px;text-align:center">`
    + `<div style="font-size:17px;font-weight:700${i && n < tiles[0][1] ? ';color:#7f6000' : ';color:var(--accent)'}">${nf(n)}</div>`
    + `<div class="muted" style="font-size:11px">${l}</div></div>`).join('<div style="align-self:center" class="muted">›</div>') + '</div>';
  const num = (n, of) => n == null ? '<span class="muted">n/a</span>' : (n >= of ? `<span style="color:#166534;font-weight:700">${nf(n)}</span>` : nf(n));
  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'To FBA', 'Dispatched']
    .concat(shop ? ['Handed over'] : []).concat(['Shipment / papers', 'Waiting at'])
    .map((h, i) => `<th${i >= 2 && i <= (shop ? 13 : 12) ? ' class="num"' : ''}>${h}</th>`).join('');
  /* The papers behind a line: each FBA dispatch with its shipment (or where it stands), each issue with its invoice / LR. */
  const papers = x => {
    const list = x.docs.map(d => d.type === 'FBA'
      ? `FBA ${nf(d.qty)} · ${d.shipment ? '<b>' + esc(d.shipment) + '</b>' + (d.shipDate ? ' · ' + esc(d.shipDate) : '') : esc(({ waiting: 'waiting for the FBA team', accepted: 'accepted, not shipped', returned: 'returned' })[d.st] || d.st || '')}`
      : `Out ${nf(d.qty)} → ${esc(d.to)}${d.invoice ? ' · inv <b>' + esc(d.invoice) + '</b>' : ''}${d.transporter ? ' · ' + esc(d.transporter) : ''}${d.lr ? ' · LR <b>' + esc(d.lr) + '</b>' : ''}${d.date ? ' · ' + esc(d.date) : ''}`);
    if (x.worked) list.push(`<i>${nf(x.worked)} shared by SKU — sent before dispatches named their order</i>`);
    return list.length ? list.join('<br>') : '<span class="muted">—</span>';
  };
  const body = rows.map((r, i) => { const x = S[i];
    const vend = r.printer ? [`${esc(voName(r.printer))} · put on this line from the Order Console · ${nf(r.printed)} of ${nf(r.qty)} back`]
      : (x.v ? x.v.parts.map(p => `${esc(p.vpo)} · ${esc(voName(p.vendorCode))}${p.service ? ' · ' + esc(p.service) : ''} · ${nf(p.qty)} given, ${nf(p.back)} back`
          + (p.due ? ' · promised ' + esc(p.due) : '') + (p.stamped ? ' · <b>placed for this order</b>' : '')) : []);
    return '<tr>'
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + `<td style="text-align:left;white-space:normal;min-width:170px">${esc([r.articleSubtype || r.articleType || r.itemName, r.color, r.size].filter(Boolean).join(' · '))}`
      + (vend.length ? `<div class="muted" style="font-size:11px">${vend.join('<br>')}${x.v && x.v.shared ? ' <i>(shared with other orders of this SKU)</i>' : ''}</div>` : '') + '</td>'
      + `<td class="num" style="font-weight:700">${nf(x.ordered)}</td>`
      + `<td class="num">${x.given ? nf(x.given) : '<span class="muted">—</span>'}</td><td class="num">${x.given ? num(x.back, x.given) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${num(x.cut, x.ordered)}</td><td class="num">${num(x.issued, x.ordered)}</td><td class="num">${num(x.received, x.ordered)}</td>`
      + `<td class="num">${num(x.qc, x.ordered)}</td><td class="num">${num(x.pressed, x.ordered)}</td>`
      + `<td class="num">${x.store ? nf(x.store) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${x.fba ? `<span style="color:#166534">${nf(x.fba)}</span>` : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${x.out ? `<span style="color:#166534">${nf(x.out)}</span>` : '<span class="muted">—</span>'}</td>`
      + (!shop ? '' : `<td class="num"${r.handedAt ? ` title="${esc(String(r.handedBy || '').split('@')[0] + ' · ' + (ptIsoDate(r.handedAt) || ''))}"` : ''}>`
          + (r.handedAt ? `<b style="color:#166534">${nf(r.qty)}</b>` : '<span class="muted">—</span>') + '</td>')
      + `<td style="text-align:left;font-size:11.5px;white-space:normal;min-width:190px">${papers(x)}</td>`
      + `<td style="text-align:left;font-size:12px${r.open ? '' : ';color:#166534'}">${esc(ordWaitingAt(r))}</td></tr>`; }).join('');
  const first = rows[0], openN = rows.filter(r => r.open).length;
  ptOpenDialog({
    title: 'Order ' + no + ' — start to finish',
    subtitle: `${first.orderDate || '—'}${first.shopOrderNo ? '  ·  Shopify ' + first.shopOrderNo : ''}  ·  ${nf(rows.length)} line(s), ${nf(openN)} still open`
      + (shop ? `  ·  ${nf(rows.filter(r => r.handedAt).length)} of ${nf(rows.length)} handed to shipping` : '')
      + ((x => x ? `  ·  Shopify: ${x.cancelledAt ? 'cancelled' : x.ff}${x.trk.length ? ' · ' + x.via + ' ' + x.trk.join(', ') : ''}` : '')(ordShopTrkOf(first.shopOrderId))),
    note: 'Each figure is the same one its own register shows — cutting, Base Data, QC, press, finished goods and the vendor orders. '
      + 'A vendor order names a SKU and not a sales order, so where several orders want the same SKU the vendor\'s pieces are shared '
      + 'out once between them: open orders first, oldest first.',
    html: strip + `<div class="xlwrap" style="max-height:50vh;border:1px solid var(--line);border-radius:10px"><table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
  });
}

/** Work that exists but names no order — real pieces the caps cannot see. */
function ordOrphans() {
  const n = list => (list || []).filter(r => r && !String(r.orderNo || '').trim()).length;
  return { base: n(PT.base), cut: n(PT.cut), press: n(PTG.press) };
}

/**
 * The tile somebody clicked on the Order Console, if any.
 *
 * Each tile is a figure on a line; picking one keeps only the lines where that figure is above zero.
 * Kept in memory only — a filter nobody can see having set is worse than one that resets.
 */
let ORD_KPI = '';
/* Each figure carries its own card: an icon, a colour, and the one line underneath that says what
 * the number is a share OF — a figure with nothing to measure it against is just a big number. */
const ORD_KPI_FIELDS = {
  cut: { label: 'Cut', of: r => r.cut, icon: 'cut', tone: 'blue', sub: (v, t) => ordPct(v, t.ordered) + '% of ordered' },
  issued: { label: 'Issued', of: r => r.issued, icon: 'up', tone: 'blue', sub: (v, t) => ordPct(v, t.cut) + '% of what is cut' },
  received: { label: 'Received', of: r => r.received, icon: 'ok', tone: 'green', colour: '#166534', sub: (v, t) => ordPct(v, t.issued) + '% of issued' },
  overRecv: { label: 'Over-received', of: r => r.overRecv, icon: 'alert', tone: 'amber', colour: '#7f6000', sub: () => 'more than the line ordered' },
  pressed: { label: 'Pressed', of: r => r.pressed, icon: 'press', tone: 'green', colour: '#166534', sub: (v, t) => ordPct(v, t.received) + '% of received' },
  pendingMake: { label: 'Still to make', of: r => r.pendingMake, icon: 'clock', tone: 'red', colour: 'var(--bad)', sub: (v, t) => ordPct(v, t.ordered) + '% of ordered' },
  madeToPress: { label: 'Made, to press', of: r => r.madeToPress, icon: 'box', tone: 'amber', colour: '#7f6000', sub: () => 'made, waiting on the press' },
  /* SENT WITHOUT A RECORD OF BEING MADE. Not outstanding work — the pieces have gone — but a hole in
   * the registers, and the one number that says how big it is. Clicking it shows exactly those lines. */
  unrecorded: { label: 'Sent, never recorded', of: r => r.unrecorded, icon: 'x', tone: 'amber', colour: '#7f6000', sub: () => 'gone, with no entry behind them' },
  /* A QUANTITY SOMEBODY MOVED AND NOBODY HERE HAS READ. Not pieces — changes: one line whose figure
   * moved twice is two things to read, and the number people act on is how many are waiting. */
  qtyChanged: { label: 'Quantity changed', of: r => ordQtyUnseen(r.orderNo, r.sku).length, icon: 'edit', tone: 'amber', colour: '#b45309', sub: () => 'waiting to be read here' },
};
function ordKpiApply(rows) {
  const k = ORD_KPI_FIELDS[ORD_KPI];
  return k ? rows.filter(r => (Number(k.of(r)) || 0) > 0) : rows;
}
const ordPct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
/** One card. The number and its name stay in .v and .l, where every reader looks. */
function ordKpiCard(v, label, icon, tone, sub, opt) {
  const o = opt || {};
  return '<div class="jw-kc metric' + (o.key ? ' pt-kpi' + (ORD_KPI === o.key ? ' pt-kpi-on' : '') : '') + '"'
    + (o.key ? ' data-odkpi="' + o.key + '" role="button" tabindex="0"' : '')
    + (o.tip ? ' title="' + esc(o.tip) + '"' : '') + '>'
    + '<div class="jw-kt"><div><div class="v"' + (o.colour ? ' style="color:' + o.colour + '"' : '') + '>' + v + '</div>'
    + '<div class="l">' + esc(label) + (o.key && ORD_KPI === o.key ? ' ✕' : '') + '</div></div>'
    + '<span class="jw-ki ' + tone + '">' + JW_ICON[icon] + '</span></div>'
    + '<div class="jw-ks">' + sub + '</div></div>';
}
/**
 * The figures as cards, the same on the order book and on the Shopify views.
 *
 * Ravi, 2026-09-23: "kpi tool ko job work ki tarah design karo". Eleven numbers in one strip is a
 * price list; the same eleven as cards, each with its icon and its share, can be read at a glance —
 * and clicking one still narrows the table to the lines behind it.
 */
function ordKpiCards(name, lead, s) {
  const t = { ordered: s(r => r.qty), cut: s(r => r.cut), issued: s(r => r.issued), received: s(r => r.received) };
  /* WHICH SET OF FIGURES THESE ARE. One tab holds three views, and the Shopify ones counted as the
   * factory's whole order book is a mistake worth a day of somebody's time. */
  return '<div class="jw-kpiname">' + esc(name) + '</div><div class="jw-kpis">'
    + lead.map(c => ordKpiCard(c[0], c[1], c[2], c[3], c[4])).join('')
    + Object.keys(ORD_KPI_FIELDS).map(key => {
      const k = ORD_KPI_FIELDS[key], on = ORD_KPI === key, v = s(k.of);
      const why = key === 'overRecv' ? ODK_OVER.replace(/^ title="|"$/g, '') + ' — '
        : (key === 'unrecorded' ? 'Handed to shipping with no record of being cut, issued or received. The pieces '
          + 'have gone, so they are not counted as work outstanding — this is what the registers are missing. '
        : (key === 'qtyChanged' ? 'The quantity on the sales order was changed after it was approved, and nobody '
          + 'here has said they have seen it. ' : ''));
      return ordKpiCard(nf(v), k.label, k.icon, k.tone, k.sub(v, t), { key, colour: k.colour,
        tip: why + (on ? 'Showing only these lines. Click again to show all.' : 'Show only the lines with ' + k.label.toLowerCase() + '.') });
    }).join('') + '</div>';
}
function ordKpiNote() {
  const k = ORD_KPI_FIELDS[ORD_KPI];
  return k ? ' · only lines with ' + k.label + ' — click the tile again to show all' : '';
}

/** AMZ / SHP / B2B, taken from the order number the book already carries. */
function ordSrcOf(orderNo) {
  const p = obUC(orderNo).split('-')[0];
  return p === 'AMZ' || p === 'SHP' || p === 'B2B' ? p : '';
}
/**
 * The brand of a SKU, as the master database spells it. Ridhi and RBP are one brand.
 *
 * A B2B item is usually not in the master at all — it goes on the CUSTOM SKUs list, carrying the
 * Brand Name off the wholesale file. Without reading that list every B2B line answers "" and the
 * Brand filter on this screen cannot see the orders it was built for.
 */
let ORDBRAND_IX = { src: null, map: null };
function ordCustomBrands() {
  const src = MDBX.custom;
  if (ORDBRAND_IX.src === src && ORDBRAND_IX.map) return ORDBRAND_IX.map;
  const m = new Map();
  (src || []).forEach(r => { if (r && r.sku && r.brand) m.set(obUC(r.sku), obUC(r.brand)); });
  ORDBRAND_IX = { src, map: m };
  return m;
}
/** A custom SKU's name as Shopify gave it (the Custom SKUs list), for a line no master row describes. */
let ORDCNAME_IX = { src: null, map: null };
function ordCustomName(sku) {
  const src = typeof MDBX !== 'undefined' ? MDBX.custom : null;
  if (ORDCNAME_IX.src !== src || !ORDCNAME_IX.map) {
    const m = new Map(); (src || []).forEach(r => { if (r && r.sku && (r.shopName || r.name)) m.set(obUC(r.sku), String(r.shopName || r.name)); });
    ORDCNAME_IX = { src, map: m };
  }
  return ORDCNAME_IX.map.get(obUC(sku)) || '';
}
function ordBrandOf(sku) {
  /* The catalogue first — a code that is in both is the catalogue's. */
  const b = obUC((mdbOf(sku) || {}).brand) || ordCustomBrands().get(obUC(sku)) || '';
  return String(b).replace('RIDHI', 'RBP');
}

/**
 * QC against ONE ORDER LINE.
 *
 * A check has always been recorded per SKU; an order number on it is new, so anything checked before
 * today answers null — which the column shows as "—" rather than as a zero that reads like "nothing
 * passed". Shared out across orders by a guess it would be worse than useless: it decides pay.
 */
let ORD_QC_IX = { src: null, n: -1, map: null };
/**
 * ROWS THAT NAME NO ORDER, SHARED AMONG THE ORDERS OF THEIR SKU.
 *
 * QC checks and finished-goods outflows both record a SKU and not an order, and both have to be shown
 * against an order anyway. One rule, written once, because two copies of it would be two chances to
 * disagree: deal each SKU's loose pieces to its order lines OLDEST FIRST, never beyond the room that
 * line has, and never twice. What is left over belongs to no order in the book and is shown on none.
 *
 *   loose   Map sku → a number of pieces (and whatever else rides along)
 *   lines   the order lines to deal to
 *   roomOf  (line) → how many that line can still take; 0 or less means skip it
 *   give    (line, taken, fraction) → called for each share, fraction being taken/the SKU's whole
 */
function ordShareBySku(loose, lines, roomOf, give, rank) {
  const when = r => ptDtMs(r.orderDate) || 0;
  const rk = rank || (() => 0);
  const bySku = new Map();
  lines.forEach(r => { if (!bySku.has(r.sku)) bySku.set(r.sku, []); bySku.get(r.sku).push(r); });
  loose.forEach((whole, sku) => {
    let left = whole;
    if (!(left > 0)) return;
    (bySku.get(sku) || []).slice().sort((a, b) => rk(a) - rk(b) || when(a) - when(b)).forEach(r => {
      if (!(left > 0)) return;
      const take = Math.min(left, roomOf(r));
      if (!(take > 0)) return;
      give(r, take, take / whole);
      left -= take;
    });
  });
}

function ordQcIndex() {
  const src = QC.checks || PT_NONE, lines = ordLines();
  if (ORD_QC_IX.map && ORD_QC_IX.src === src && ORD_QC_IX.n === src.length && ORD_QC_IX.lines === lines) return ORD_QC_IX.map;
  const map = new Map(), loose = new Map();
  const add = (k, c, ok, rej, alt, worked) => { const e = map.get(k) || { checked: 0, ok: 0, rej: 0, alt: 0, worked: 0 };
    e.checked += c; e.ok += ok; e.rej += rej; e.alt += alt; if (worked) e.worked += c; map.set(k, e); };
  src.forEach(r => {
    if (!r) return;
    if (r.orderNo) return add(obKeyOf(r.orderNo, r.sku), ptNum(r.checked), ptNum(r.ok), ptNum(r.rejected), ptNum(r.forAlteration), false);
    /* A CHECK THAT NAMED NO ORDER — every one made before the form asked. Kept by SKU, to be shared out. */
    const sku = obUC(r.sku); if (!sku) return;
    const p = loose.get(sku) || { checked: 0, ok: 0, rej: 0, alt: 0 };
    p.checked += ptNum(r.checked); p.ok += ptNum(r.ok); p.rej += ptNum(r.rejected); p.alt += ptNum(r.forAlteration);
    loose.set(sku, p);
  });
  /* SHARED OUT ONCE, AND NEVER BEYOND WHAT AN ORDER RECEIVED — nothing can be inspected that did not
   * come back. The outcome (passed / rejected / alteration) goes with the pieces in proportion. */
  const whole = new Map(); loose.forEach((p, sku) => whole.set(sku, p.checked));
  ordShareBySku(whole, lines.filter(r => r.received > 0),
    r => r.received - ((map.get(obKeyOf(r.orderNo, r.sku)) || {}).checked || 0),
    (r, take, f) => { const p = loose.get(r.sku);
      add(obKeyOf(r.orderNo, r.sku), take, Math.round(p.ok * f), Math.round(p.rej * f), Math.round(p.alt * f), true); });
  ORD_QC_IX = { src, n: src.length, lines, map };
  return map;
}
const ordQcOf = (orderNo, sku) => ordQcIndex().get(obKeyOf(orderNo, sku)) || null;

/**
 * WHERE AN ORDER'S FINISHED PIECES ARE NOW.
 *
 * What came IN is a fact — a RECEIVE names its order. What went OUT names none, because the store keeps
 * stock by SKU and nobody taking pieces off a shelf is told which order they were made for; those are
 * shared among the SKU's orders by ordShareBySku, oldest first, never beyond what that order received.
 *
 * Returned: in (received), out, fba (of that, sent to Amazon), fbaOpen (dispatched and not yet shipped,
 * so still the factory's), store (in − out) and worked (how many of the outward pieces were shared
 * rather than written down).
 */
/** The orders an outward row names: [{orderNo, qty, sign}]. `orders` (new) wins over a single `orderNo`. */
function fgiOutParts(r) {
  if (!r || (r.txnType !== 'ISSUE' && r.txnType !== 'FBA' && r.txnType !== 'FBA_RETURN')) return [];
  const sign = r.txnType === 'FBA_RETURN' ? -1 : 1;
  const list = Array.isArray(r.orders) ? r.orders : (r.orders && typeof r.orders === 'object' ? Object.values(r.orders) : []);
  if (list.length) return list.filter(p => p && p.orderNo && fgiNum(p.qty) > 0).map(p => ({ orderNo: obUC(p.orderNo), qty: fgiNum(p.qty), sign }));
  if (r.orderNo) return [{ orderNo: obUC(r.orderNo), qty: fgiNum(r.qty), sign }];
  return [];
}
/** Which orders a dispatch takes first: FBA serves Amazon orders first; an issue serves the others first. */
function fgiOutRank(orderNo, type) {
  const amz = ordSrcOf(orderNo) === 'AMZ';
  return type === 'FBA' ? (amz ? 0 : 1) : (amz ? 1 : 0);
}
/**
 * Orders that have pieces of this SKU in the India Store, in the order a dispatch should take them.
 * Console orders read the console's own "in store"; an external order is what was received against it, less
 * what left naming it. `taken` (orderNo → pcs) is what earlier rows of the same sheet or scan already took.
 */
function fgiOutOrders(sku, type, taken) {
  const s = obUC(sku), t = taken || new Map(), seen = new Set(), out = [];
  ordLines().forEach(r => {
    if (r.sku !== s || seen.has(r.orderNo)) return;
    seen.add(r.orderNo);
    const e = ordFgAt(r.orderNo, s), store = (e ? e.store : 0) - (t.get(r.orderNo) || 0);
    if (store > 0) out.push({ orderNo: r.orderNo, store, ms: ptDtMs(r.orderDate) || 0, rank: fgiOutRank(r.orderNo, type) });
  });
  const ext = new Map();
  (FGI.rows || []).forEach(r => {
    if (!r || obUC(r.sku) !== s) return;
    if (r.txnType === 'RECEIVE' && r.orderSource === 'external' && r.orderNo && !seen.has(obUC(r.orderNo))) {
      const k = obUC(r.orderNo), e = ext.get(k) || { in: 0, out: 0, ms: ptDtMs(r.date) || 0 };
      e.in += fgiNum(r.qty); ext.set(k, e);
    }
  });
  if (ext.size) (FGI.rows || []).forEach(r => { if (r && obUC(r.sku) === s) fgiOutParts(r).forEach(p => { const e = ext.get(p.orderNo); if (e) e.out += p.sign * p.qty; }); });
  ext.forEach((e, no) => { const store = e.in - e.out - (t.get(no) || 0); if (store > 0) out.push({ orderNo: no, store, ms: e.ms, rank: 1, ext: true }); });
  return out.sort((a, b) => a.rank - b.rank || a.ms - b.ms);
}
/** Deal `qty` pieces to those orders — the picked one first, then the rest in their turn. What no order holds
 *  (opening stock, pieces received beyond every order) is `loose`. */
function fgiOutAlloc(sku, qty, type, first, taken) {
  const c = fgiOutOrders(sku, type, taken), want = obUC(first || '');
  if (want) {
    const i = c.findIndex(x => x.orderNo === want);
    if (i < 0) return { err: `${want} has no pieces of ${obUC(sku)} in the India Store — pick one of the orders in the list, or leave it on Auto.` };
    c.unshift(c.splice(i, 1)[0]);
  }
  let left = qty; const orders = [];
  c.forEach(x => { if (left <= 0) return; const q = Math.min(left, x.store); orders.push({ orderNo: x.orderNo, qty: q }); left -= q; });
  return { orders, loose: Math.max(0, left) };
}
/**
 * THE ORDER SIDE OF A DISPATCH — the form, the Excel issue and the scan all ask here, so they cannot drift.
 * v: { sku, qty, type, order ('' = auto, '__none' = not for an order, or an order number), why, inv, trans, lr }.
 * Returns { err } or { fields, alloc } where fields go straight onto the ledger row.
 */
function fgiOutOrderCheck(v, taken) {
  const sku = obUC(v.sku), qty = parseInt(v.qty, 10) || 0, type = v.type;
  const ord = String(v.order == null ? '' : v.order).trim(), why = String(v.why || '').trim();
  const none = ord === '__none' || /^(no order|none|not for an order)$/i.test(ord) || (!ord && !!why && v.whyMeansNone !== false);
  const fields = {};
  if (type === 'ISSUE') {
    const inv = String(v.inv || '').trim(), tr = String(v.trans || '').trim(), lr = String(v.lr || '').trim();
    if (inv) fields.invoiceNo = inv;
    if (tr) fields.transporter = tr;
    if (lr) fields.lrNo = lr;
  }
  if (none) {
    if (!why) return { err: 'Say why these pieces are not for an order — a sample, damaged, a photo shoot…' };
    fields.noOrderWhy = why;
    return { fields, alloc: { orders: [], loose: qty } };
  }
  const alloc = fgiOutAlloc(sku, qty, type, ord, taken);
  if (alloc.err) return { err: alloc.err };
  if (alloc.orders.length) fields.orders = alloc.orders;
  return { fields, alloc };
}
/** "AMZ-01 12 · AMZ-02 8", for messages and cells. */
const fgiOutTxt = orders => (orders || []).map(p => p.orderNo + ' ' + nf(p.qty)).join(' · ');

let ORD_FG_IX = { src: null, n: -1, lines: null, map: null };
function ordFgIndex() {
  const src = FGI.rows || PT_NONE, lines = ordLines();
  if (ORD_FG_IX.map && ORD_FG_IX.src === src && ORD_FG_IX.n === src.length && ORD_FG_IX.lines === lines) return ORD_FG_IX.map;
  const map = new Map(), looseF = new Map(), looseI = new Map();
  const get = k => { let e = map.get(k); if (!e) { e = { in: 0, out: 0, fba: 0, fbaOpen: 0, fbaShip: 0, issued: 0, worked: 0, docs: [] }; map.set(k, e); } return e; };
  /* Unnamed outflows are kept in two pools: what went to Amazon, and what was issued. They are shared out with
   * different preferences — Amazon orders first for FBA, the others first for an issue. */
  const pool = (sku, fba) => { const L = fba ? looseF : looseI; let p = L.get(sku); if (!p) { p = { out: 0, fba: 0, fbaOpen: 0, fbaShip: 0 }; L.set(sku, p); } return p; };
  const byId = new Map(); src.forEach(r => { if (r && r.txnType === 'FBA') byId.set(fgiRowId(r), r); });
  src.forEach(r => {
    if (!r) return;
    const q = fgiNum(r.qty), sku = obUC(r.sku); if (!sku) return;
    /* IN — the same rules the Finished Goods screen counts by: a confirmed transfer from the press is
     * stock, an unconfirmed one is not yet, and a reversed one never was. */
    if (r.txnType === 'RECEIVE' || (r.txnType === 'TRANSFER_IN' && r.confirmed === true && r.reversed !== true)) {
      if (r.orderNo) get(obKeyOf(r.orderNo, sku)).in += q;
      return;
    }
    if (r.txnType !== 'ISSUE' && r.txnType !== 'FBA' && r.txnType !== 'FBA_RETURN') return;   // OPENING and the markers
    /* OUT. A return from FBA gives the pieces back, so it is the same figures with the sign turned. */
    const sign = r.txnType === 'FBA_RETURN' ? -1 : 1;
    const isFba = r.txnType === 'FBA' || r.txnType === 'FBA_RETURN';
    const st = r.txnType === 'FBA' ? fbaState(r) : null;
    const open = st ? st.open : 0;                       // dispatched and not yet shipped to Amazon
    const shipped = st && st.st === 'shipped';
    const add = (e, f) => { e.out += sign * q * f; if (isFba) { e.fba += sign * q * f; e.fbaOpen += sign * (shipped ? 0 : open) * f; e.fbaShip += sign * (shipped ? open : 0) * f; } else e.issued += q * f; };
    /* NAMED PARTS FIRST (2026-09-25). A return goes back to the orders its dispatch named, in proportion. */
    let parts = fgiOutParts(r);
    if (r.txnType === 'FBA_RETURN' && r.linkedFbaId) {
      const d = byId.get(r.linkedFbaId), dq = d ? fgiNum(d.qty) : 0;
      parts = dq > 0 ? fgiOutParts(d).map(p => ({ orderNo: p.orderNo, qty: q * p.qty / dq })) : [];
    }
    let named = 0;
    parts.forEach(p => {
      const e = get(obKeyOf(p.orderNo, sku)), f = p.qty / q;
      add(e, f); named += p.qty;
      if (r.txnType !== 'FBA_RETURN') e.docs.push({ id: fgiRowId(r), type: r.txnType, qty: p.qty, date: r.date || '', to: r.issuedFor || '',
        st: st ? st.st : '', shipment: r.fbaShipment || '', shipDate: r.fbaShipDate || '', invoice: r.invoiceNo || '', transporter: r.transporter || '', lr: r.lrNo || '' });
    });
    const rest = q - named;
    if (rest > 0.0001) {
      const f = rest / q, p = pool(sku, isFba);
      p.out += sign * q * f; if (isFba) { p.fba += sign * q * f; p.fbaOpen += sign * (shipped ? 0 : open) * f; p.fbaShip += sign * (shipped ? open : 0) * f; }
    }
  });
  /* THE LOOSE OUTFLOWS. An order can only have sent out what it took in, less what left it by name. */
  [[looseF, true], [looseI, false]].forEach(([loose, fba]) => {
    const whole = new Map(); loose.forEach((p, sku) => { if (p.out > 0) whole.set(sku, p.out); });
    ordShareBySku(whole, lines,
      r => { const e = map.get(obKeyOf(r.orderNo, r.sku)); return e ? e.in - e.out : 0; },
      (r, take, f) => { const p = loose.get(r.sku), e = get(obKeyOf(r.orderNo, r.sku));
        e.out += take; e.fba += p.fba * f; e.fbaOpen += p.fbaOpen * f; e.fbaShip += p.fbaShip * f; if (!fba) e.issued += take; e.worked += take; },
      r => fgiOutRank(r.orderNo, fba ? 'FBA' : 'ISSUE'));
  });
  map.forEach(e => { ['in', 'out', 'fba', 'fbaOpen', 'fbaShip', 'issued', 'worked'].forEach(k => { e[k] = Math.round(e[k]); });
    e.store = Math.max(0, e.in - e.out); });
  ORD_FG_IX = { src, n: src.length, lines, map };
  return map;
}
const ordFgAt = (orderNo, sku) => ordFgIndex().get(obKeyOf(orderNo, sku)) || null;
/** Pieces of this order sitting in the India Store right now. */
const ordFgOf = (orderNo, sku) => { const e = ordFgAt(orderNo, sku); return e ? e.store : 0; };

function ordFilters() {
  const v = id => ($(id) || {}).value || '';
  return { ord: v('odOrd'), art: v('odArt'), sub: v('odSub'), col: v('odCol'), sz: v('odSz'),
    st: v('odStatus'), src: v('odSrc'), brand: v('odBrand'), q: v('odQ').trim().toLowerCase(),
    d1: v('odD1'), d2: v('odD2') };
}

function ordApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'ord' && f.ord && !ptCi(r.orderNo, f.ord)) return false;
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    /* The order number says what kind of order it is: AMZ- a sales order, SHP- a Shopify one, B2B- wholesale. */
    if (skip !== 'src' && f.src && ordSrcOf(r.orderNo) !== f.src) return false;
    if (skip !== 'brand' && f.brand && ordBrandOf(r.sku) !== f.brand) return false;
    if (skip !== 'st' && f.st === 'open' && !r.open) return false;
    if (skip !== 'st' && f.st === 'done' && r.open) return false;
    if (skip !== 'st' && f.st === 'tocut' && r.pendingCut <= 0) return false;
    if (skip !== 'st' && f.st === 'cutdone' && !r.cutDone) return false;
    /* NOT SKIPPABLE. Every other filter here is skipped while its own dropdown is being filled, so a
     * dropdown still offers the values it would reach. The dates have no dropdown to fill — and the
     * lists they DO narrow should stay narrowed, so that picking a month leaves only the orders of
     * that month in "All orders". */
    if (!ptInRange(r && r.orderDate, f.d1, f.d2)) return false;
    if (skip !== 'q' && f.q) {
      /* The Shopify order number and the adjustment id are searched too. Somebody chasing an order
       * has the customer's number in front of them, not ADJ-1001 — and a search box that cannot
       * find it makes the column that shows it useless for the one job it is there for. */
      const hay = [r.orderNo, r.sku, r.articleType, r.articleSubtype, r.color, r.size,
        r.shopOrderNo, r.adjId].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

/**
 * THE SHOPIFY VIEWS OF THE ORDER CONSOLE.
 *
 * These were briefly their own sidebar tab. Ravi moved them here — "remove from here and build this
 * tab in order console" — and he is right: it is the same order book, read with a different question
 * in mind, and a second tab meant two places to look for one answer.
 *
 * Three views, one screen. The order book as it always was, and the Shopify work counted two ways:
 *
 *   BY SKU is what the floor makes. Twelve customers ordering one cloth is not twelve jobs — it is
 *   twelve pieces of one thing, cut once, pressed once.
 *
 *   BY ORDER is who is owed, the same rows ungrouped. That is the per-order tracking.
 *
 * Neither is a summary of the other: they are the same pieces added up along a different edge, built
 * on the same ordLines() the order book uses, so a total on one view can never disagree with a total
 * on another.
 */

/** Every order-book line that came from a Shopify order. */
function shppLines() {
  return ordLines()
    .filter(l => String(l.orderNo || '').indexOf('SHP-') === 0)
    /* A PRINTER SEES THEIR OWN LINES AND NO OTHERS. Everybody else sees all of them. Said plainly in
     * spCanSee: this is the app behaving, not isolation — the database still has no rules on it. */
    .filter(l => spCanSee(l.orderNo, l.sku));
}

/** The same lines, added up per SKU, each keeping the orders it is made of. */
/**
 * The lines behind a combined row — the ones a printer could actually be given.
 *
 * OPEN ONLY. A by-SKU row hides which of its orders are finished; ticking it and sweeping those in
 * would hand a printer work that has already come back, and this screen gives nobody the chance to
 * notice it happening.
 */
const spSkuKeys = r => ((r && r.orders) || []).filter(o => o && o.open).map(o => o.no + '|' + r.sku);

/** All of a row's assignable lines ticked, some of them, or none. */
function spSkuPicked(r, pick) {
  const keys = spSkuKeys(r);
  if (!keys.length) return 'none';
  const on = keys.filter(k => pick.has(k)).length;
  return on === 0 ? 'none' : (on === keys.length ? 'all' : 'some');
}

function shppBySku(only) {
  const by = new Map();
  (only || shppLines()).forEach(l => {
    let e = by.get(l.sku);
    if (!e) {
      e = { sku: l.sku, articleType: l.articleType, articleSubtype: l.articleSubtype,
        color: l.color, size: l.size, qty: 0, cut: 0, issued: 0, received: 0, pressed: 0, made: 0,
        pendingCut: 0, pendingMake: 0, madeToPress: 0, overRecv: 0, cutReq: l.cutReq, orders: [], needsSku: false, open: false, addedMs: 0 };
      by.set(l.sku, e);
    }
    e.qty += l.qty; e.cut += l.cut; e.issued += l.issued; e.received += l.received;
    e.pressed += l.pressed; e.made += l.made;
    /* IN STORE (2026-09-28): what of these orders came into the India store and is still there. */
    e.store = (e.store || 0) + ((typeof ordFgAt === 'function' ? ordFgAt(l.orderNo, l.sku) : null) || {}).store || 0;
    e.pendingCut += l.pendingCut; e.pendingMake += l.pendingMake; e.madeToPress += l.madeToPress;
    e.overRecv += l.overRecv;
    if (l.open) e.open = true;
    if ((l.addedMs || 0) > e.addedMs) e.addedMs = l.addedMs;
    /* WHO IS PRINTING IT — read from the vendor orders, shared out by ordVendorAlloc (2026-09-28). */
    { const v = ordVendorOf(l.orderNo, l.sku);
      if (!e.prn) e.prn = new Map();
      if (l.printer) { const k = voName(l.printer), x = e.prn.get(k) || { given: 0, back: 0 }; x.given += l.qty; x.back += Math.min(l.qty, Number(l.printed) || 0); e.prn.set(k, x); }
      else if (v) v.parts.forEach(pp => { const k = voName(pp.vendorCode), x = e.prn.get(k) || { given: 0, back: 0 }; x.given += pp.qty; x.back += pp.back; e.prn.set(k, x); }); }
    /* Article details come from whichever line has them. A SKU still on the Custom SKUs list has
     * none, and that is worth showing rather than hiding behind a blank cell. */
    if (!e.articleType && l.articleType) { e.articleType = l.articleType; e.articleSubtype = l.articleSubtype; e.color = l.color; e.size = l.size; }
    if (l.needsSku) e.needsSku = true;
    e.orders.push({ no: l.orderNo, shop: l.shopOrderNo || '', adj: l.adjId || '', qty: l.qty,
      pressed: l.pressed, date: l.orderDate, open: l.open });
  });
  return [...by.values()].sort((a, b) => b.pendingMake - a.pendingMake || a.sku.localeCompare(b.sku));
}

/** The Order Console's own filters, applied to a combined row — which has no order number. */
function shppApply(rows, f) {
  return rows.filter(r => {
    if (f.art && !ptCi(r.articleType, f.art)) return false;
    if (f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (f.col && !ptCi(r.color, f.col)) return false;
    if (f.sz && !ptCi(r.size, f.sz)) return false;
    if (f.st === 'open' && !r.open) return false;
    if (f.st === 'done' && r.open) return false;
    if (f.st === 'tocut' && r.pendingCut <= 0) return false;
    if (f.q) {
      /* The order numbers belong in the haystack too. Combined rows keep theirs in `orders`;
       * an UNcombined row carries them on itself, and leaving those out meant the by-order view
       * could not be searched by the one thing somebody actually types — the customer's number. */
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size,
        r.orderNo, r.shopOrderNo, r.adjId]
        .concat((r.orders || []).map(o => o.no + ' ' + o.shop + ' ' + o.adj)).join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

