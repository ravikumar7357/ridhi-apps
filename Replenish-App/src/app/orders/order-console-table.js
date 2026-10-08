/* ================= THE ORDER CONSOLE, READ LIKE THE JOB WORK TABLE =================
 *
 * Ravi, 2026-09-23: "order book h and other tab h unki them job work ke jese krna h".
 *
 * Six columns for one product — SKU, Image, Article, Subtype, Color, Size — and three more for one
 * order, on a table that is already twenty wide. The first columns slide off the screen and what is
 * left is a wall of figures. Job Work answers this and he approved that answer, so the identity of
 * a line is one cell here too: a picture, what the thing is, its colour and size, its code.
 *
 * NOTHING IS LOST. Every fact that was in those columns is in the cell, the export still writes one
 * column each, and the figures to the right are untouched.
 */
/** The picture, inline, for a line that came with its own — a Shopify order line. */
function ptImgSpanSrc(sku, url, px) {
  const u = String(url || '').trim();
  if (!u) return ptImgSpan(sku, px);
  const n = px || 42;
  return `<img src="${esc(ptImgSrc(u, n))}" alt="" loading="lazy" title="${esc(sku)}"`
    + ` style="width:${n}px;height:${n}px;object-fit:cover;border-radius:6px;border:1px solid var(--line);flex:0 0 auto">`;
}
/** The product: picture, what it is, colour • size, then the code. */
function ordItemCell(r, img, extra, frz) {
  const what = [r.color, r.size].filter(Boolean).join(' • ');
  return '<td' + (frz ? ' class="frz"' : '') + ' style="text-align:left"><div class="jw-item">' + (img == null ? ptImgSpan(r.sku, 42) : img)
    + '<div style="min-width:0"><div style="font-weight:600">' + (esc(r.articleSubtype || r.articleType || r.itemName) || '<span class="muted">—</span>') + '</div>'
    + (!r.articleSubtype && !r.articleType && r.itemName && r.material ? '<div class="jw-sub">' + esc(r.material) + '</div>' : '')
    + (r.articleSubtype && r.articleType ? '<div class="jw-sub">' + esc(r.articleType) + '</div>' : '')
    + '<div class="jw-sub">' + (esc(what) || '—') + '</div>'
    + '<div class="jw-sku">' + esc(r.sku) + '</div>' + (extra || '') + '</div></div></td>';
}
/** The order: its number, what raised it, and when. */
function ordOrderCell(r, frz) {
  return '<td' + (frz ? ' class="frz"' : '') + ' style="text-align:left">'
    + '<a href="#" data-ordj="' + esc(r.orderNo) + '" title="This order, start to finish"'
    + ' style="color:inherit;text-decoration:underline dotted;font-weight:600">' + esc(r.orderNo) + '</a>'
    + (r.shopOrderNo ? '<div class="jw-sub">' + esc(r.shopOrderNo) + '</div>' : '')
    + (r.adjId ? '<div class="jw-sku">' + esc(r.adjId) + '</div>' : '')
    + (r.orderDate ? '<div class="jw-t">' + esc(r.orderDate) + '</div>' : '') + '</td>';
}
/**
 * The head, built from the columns themselves.
 *
 * It used to be a list of names and a pair of numbers saying which of them were numeric — "the
 * numeric run ends at To make" — so adding one column in the middle silently put every heading
 * after it over the wrong data. Each column now carries its own alignment.
 */
function ordHead(cols, tick) {
  return '<thead><tr>' + (tick ? '<th class="frz" style="width:34px">' + tick + '</th>' : '')
    + cols.map((c, i) => '<th' + (i === 0 && !tick ? ' class="frz"' : (c[1] ? ' class="' + c[1] + '"' : '')) + '>' + c[0] + '</th>').join('')
    + '</tr></thead>';
}
/** What a line is waiting for, in the Job Work pills. */
/** Completed because of Shopify, in words the floor and the shipping team both read. */
const SHP_DONE_TXT = why => ({ fulfilled: 'Fulfilled by shipping team', cancelled: 'Cancelled on Shopify', refunded: 'Refunded on Shopify',
  'marked done': 'Marked done by shipping team', stock: 'Shipped from stock', partial: 'Closed at what was handed over',
  outside: 'Made outside', duplicate: 'Duplicate — closed', other: 'Closed by hand' })[why] || 'Fulfilled by shipping team';
/** Shopify's word on a line production still has open: it changes nothing, so it says what to do. */
const SHP_SAYS_TXT = why => ({ fulfilled: 'Shopify: shipped — not handed over by production', cancelled: 'Shopify: cancelled — production to decide',
  refunded: 'Shopify: refunded — production to decide', 'marked done': 'Shopify note says DONE / READY — not handed over' })[why] || '';
function ordStatePill(r) {
  const canC = typeof ordCanClose === 'function' && ordCanClose() && ordIsMto(r.orderNo);
  const key = esc(r.orderNo + '|' + r.sku);
  if (r.open && r.shopSays && SHP_SAYS_TXT(r.shopSays)) return '<span class="jw-st pend" title="Still open: only a hand-over to shipping closes it">' + esc(SHP_SAYS_TXT(r.shopSays)) + '</span> '
    + (canC ? `<a href="#" data-ordclose="${key}" class="pill pill-ok" style="text-decoration:none" title="Shopify is done with it — close the line">Ready to close · Close</a> ` : '') + ordStatePillWork(r);
  if (canC && r.open) return ordStatePillWork(r) + ` <a href="#" data-ordclose="${key}" style="font-size:11.5px" title="Close this line with a reason">close</a>`;
  if (canC && !r.open && r.shopDoneAt && !r.handedAt) return ordStatePillWork(r) + ` <a href="#" data-ordreopen="${key}" style="font-size:11.5px" title="${esc((r.shopDoneBy ? 'Closed by ' + r.shopDoneBy : '') + (r.shopDoneNote ? ' — ' + r.shopDoneNote : ''))}">reopen</a>`;
  return ordStatePillWork(r);
}
function ordStatePillWork(r) {
  if (!r.open && r.shopDoneAt && !r.handedAt) return '<span class="jw-st done" title="Closed from Shopify ' + esc(ptIsoDate(r.shopDoneAt) || '') + '">' + esc(SHP_DONE_TXT(r.shopDoneWhy)) + '</span>';
  if (!r.open) return '<span class="jw-st done">Complete</span>';
  if (r.pendingCut > 0) return '<span class="jw-st pend">' + nf(r.pendingCut) + ' to cut</span>';
  if (r.pendingMake > 0) return '<span class="jw-st prog">' + nf(r.pendingMake) + ' to make</span>';
  /* Saying "0 to make" here would be silence in a louder font. */
  return '<span class="jw-st prog">' + nf(r.madeToPress) + ' to press</span>';
}

function renderOrdShopify(bySku, done) {
  /* BY ORDER IS SPLIT IN TWO (Ravi, 2026-09-24): the pending lines here, and every line that is complete
   * or handed over in its own window — "yaha sirf pending order hi show hone chahiye". By SKU keeps all
   * of them, as it always has: it is the floor's total, and its tick only ever takes the open lines. */
  /* PENDING OR COMPLETED, on the combined view too (Ravi, 2026-09-28: "jitne order complete ho jay wo auto complete me move
   * ho jay remove n ho"): a line that is finished — handed over, or closed by Shopify — leaves Pending by itself and is kept
   * under Completed. */
  /* SHOPIFY OR ONLINE — both made to order, one view (2026-10-05). */
  const NM = ORD.mtoSrc === 'ONL' ? 'Online' : 'Shopify', PFX = ORD.mtoSrc === 'ONL' ? 'ONL-' : 'SHP-';
  const lines = shppLines(PFX).filter(l => (done ? !l.open : l.open));
  if (!lines.length) {
    $('odMsg').className = 'muted';
    $('odMsg').textContent = done ? 'No ' + NM + ' line is complete or handed over yet.'
      : 'Nothing from ' + NM + ' is waiting on production.' + (NM === 'Shopify' ? ' Orders appear here once they are opened from the Production bucket.' : '');
    $('odKpis').innerHTML = ordSrcChips(); ORD.rows = [];
    ptEmpty('odTable', done ? 'Nothing finished yet.' : 'No ' + NM + ' orders in production.');
    return;
  }

  const f = ordFilters();
  /* Grouped ONCE. This was six separate calls — the table and one per filter list — and each of them
   * rebuilt the whole order book from scratch. */
  const src = bySku ? shppBySku(lines) : lines;
  /* The order dropdown is meaningless once rows are combined, and misleading when they are not —
   * it lists every order number in the book, including the six hundred that are not Shopify. */
  ptFill('odArt', shppApply(src, Object.assign({}, f, { art: '' })).map(r => r.articleType), 'All articles');
  ptFill('odSub', shppApply(src, Object.assign({}, f, { sub: '' })).map(r => r.articleSubtype), 'All subtypes');
  ptFill('odCol', shppApply(src, Object.assign({}, f, { col: '' })).map(r => r.color), 'All colors');
  ptFill('odSz', shppApply(src, Object.assign({}, f, { sz: '' })).map(r => r.size), 'All sizes');

  /* THE LATEST FIRST — the most working days past due at the top; otherwise as the sort picker says. */
  const rows0 = ordNewest(ordKpiApply(shppApply(src, f)));
  const rows = bySku && !done ? rows0.slice().sort((a, b) => (b.maxLate || 0) - (a.maxLate || 0)) : rows0;
  ORD.rows = rows;
  const s = fn => lines.reduce((a, r) => a + fn(r), 0);

  const allL = bySku ? shppLines(PFX) : [];
  const sw = !bySku ? '' : (() => {
    const nOpen = new Set(allL.filter(l => l.open).map(l => l.sku)).size, nDone = new Set(allL.filter(l => !l.open).map(l => l.sku)).size;
    const b = (on, v, t) => `<button type="button" data-skudone="${v}" style="height:38px;padding:0 16px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer;box-shadow:none;transform:none;`
      + (on ? 'background:#15803D;color:#fff;border:1px solid #15803D' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5') + `">${t}</button>`;
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;width:100%">${b(!done, '0', 'Pending · ' + nf(nOpen) + ' SKU(s)')}${b(done, '1', 'Completed · ' + nf(nDone) + ' SKU(s)')}</div>`;
  })();
  const lateN = lines.filter(l => l.mtoLate > 0).length;
  const readyN = lines.reduce((t, l) => { const sp = (typeof spOf === 'function' ? spOf(l.orderNo, l.sku) : null) || {};
    return t + (l.open ? Math.max(0, Math.min(l.qty, Number(l.pressed) || 0) - Math.min(l.qty, Number(sp.handedQty) || 0)) : 0); }, 0);
  $('odKpis').innerHTML = ordSrcChips() + sw + ordKpiCards(done ? NM + ', complete & handed over' : NM + ', made to order — due 5 working days after opening', [
    [nf(new Set(lines.map(r => r.orderNo)).size), NM + ' orders', 'doc', 'blue', 'read live' + (ORD.at ? ' · ' + esc(ORD.at) : '')],
    ...(done ? [] : [[nf(lateN), 'Late lines', 'alert', 'amber', 'past 5 working days, not handed over'],
      [nf(readyN), 'Ready for shipping', 'box', 'green', 'QC passed — in From production']]),
    [nf(new Set(lines.map(r => r.sku)).size), 'SKUs', 'list', 'blue', done ? 'finished' : 'waiting on production'],
    [nf(s(r => r.qty)), 'Pieces', 'box', 'blue', 'pieces asked for'],
  ], s);

  /* ONE CELL FOR THE PRODUCT, AND ONE FOR THE ORDER, as the Job Work table reads them.
   * RECEIVED AND QC stay in the sequence: "issued 5, pressed 0, to make 5" does not say whether the
   * karigar ever brought them back. */
  const cols = bySku
    /* RAVI'S LAYOUT (2026-10-05): order IDs first, then the item, and the stages in the order they happen up to the
     * hand-over to shipping. */
    ? [['Order ID', ''], ['Item', ''], ['Orders', 'num'], ['Pieces', 'num'], ['Cut', 'num'], ['Issued', 'num'],
      ['Received', 'num'], ['QC passed', 'num'], ['Handed to shipping', '']]
    : [['Order', ''], ['Item', ''], ['Pieces', 'num'], ['Printing', ''], ['Cut', 'num'], ['Issued', 'num'],
      ['Received', 'num'], ['QC', 'num'], ['Made', 'num'], ['To make', 'num'], ['Quilt team', ''],
      ['Status', ''], ['', '']];
  /* Somebody allowed only to assign printers ticks lines too — for that, and nothing else.
   *
   * ON BOTH VIEWS NOW. It used to be the by-order one alone, because a combined row is not a line —
   * but that decides what a tick MEANS, not whether there is one. Here a tick stands for every open
   * line behind the SKU, which is exactly the bulk assign Ravi asked for. Handing over to shipping
   * stays on the by-order view: that is a decision per order, and a row here hides which. */
  /* A tick is for Completed — handing the lines to the shipping team — and nothing else (2026-09-28). */
  const spPick = ptCanEdit() && !done;
  /* PINNED TO THE LEFT, because the first column is the first thing to slide off a narrow screen —
   * which is how a tick box that is right there stops existing. */
  const thead = ordHead(cols, spPick ? '<input type="checkbox" id="spPickAll" style="width:auto;margin:0" title="Tick every line shown">' : '');

  const body = rows.slice(0, ORD_CAP).map(r => bySku ? (() => {
    /* Every order this SKU is made of, so combining never hides who is owed what. */
    /* THE FIRST SIX ORDERS, and how many more. Twenty-eight written out made one row a screen tall;
     * the rest are in the tooltip and in the by-order view. */
    /* Most late first, then the soonest due. Each order says when it is due, and how many working days late. */
    const today = dToday();
    const sortedOrders = r.orders.slice().sort((a, b) => (b.late || 0) - (a.late || 0) || String(a.due || a.date).localeCompare(String(b.due || b.date)));
    const canClose = typeof ordCanClose === 'function' && ordCanClose();
    const allChips = (ORD.chipOpen || new Set()).has(r.sku);
    const chips = sortedOrders.slice(0, allChips ? sortedOrders.length : 6)
      .map(o => `<div style="white-space:nowrap"><a href="#" data-ordj="${esc(o.no)}" style="color:inherit;text-decoration:underline dotted;font-weight:700" title="${esc(o.no)}${o.adj ? ' · ' + esc(o.adj) : ''} — ${nf(o.qty)} piece(s)${o.open ? '' : ', done'}${o.opened ? ' · opened in production ' + esc(mtoShow(o.opened)) : ''}${o.due ? ' · due ' + esc(mtoShow(o.due)) + ' (5 working days)' : ''} — click for this order start to finish">`
        + `${esc(o.shop || o.no)}</a><span class="muted">&times;${nf(o.qty)}</span>`
        + (canClose && o.open ? ` <a href="#" data-ordclose="${esc(o.no + '|' + (o.sku || r.sku))}" style="font-size:11px${o.says ? ';color:#166534;font-weight:700' : ''}" title="${o.says ? 'Shopify is done with it — ' : ''}close this order's line">${o.says ? 'ready · close' : 'close'}</a>` : '')
        + (canClose && !o.open && o.byShop ? ` <a href="#" data-ordreopen="${esc(o.no + '|' + (o.sku || r.sku))}" style="font-size:11px" title="Closed by hand or by Shopify — reopen it">reopen</a>` : '')
        + (!o.open ? ' <span class="muted" style="font-size:11px">done</span>'
          : o.late > 0 ? ` <span style="color:var(--bad);font-weight:700;font-size:11px">${nf(o.late)}d late</span>`
          : o.due ? ` <span style="font-size:11px;${o.due === today ? 'color:#7f6000;font-weight:700' : 'color:var(--muted,#6b7280)'}">${o.due === today ? 'due today' : 'due ' + esc(mtoShow(o.due))}</span>` : '')
        + '</div>').join('')
      + (sortedOrders.length > 6 ? (allChips
          ? `<a href="#" data-chipmore="${esc(r.sku)}" class="muted" style="font-size:12px">show fewer</a>`
          : `<a href="#" data-chipmore="${esc(r.sku)}" class="muted" style="font-size:12px;text-decoration:underline" title="Show every order for this SKU">+${nf(sortedOrders.length - 6)} more</a>`) : '');
    /* One tick, every open line behind it. A SKU whose orders are all finished has nothing to give
     * anybody, so it has no box rather than a box that does nothing. */
    const skuKeys = spSkuKeys(r);
    const state = spSkuPicked(r, ORD.pick || new Set());
    return '<tr>'
      + (spPick ? `<td class="frz">${skuKeys.length
          ? `<input type="checkbox" data-spskupick="${esc(r.sku)}"${state === 'all' ? ' checked' : ''}`
            + `${state === 'some' ? ' data-part="1"' : ''} style="width:auto;margin:0"`
            + ` title="${nf(skuKeys.length)} open line(s) behind this SKU${state === 'some' ? ' — some of them are ticked' : ''}">`
          : '<span class="muted" title="Every order for this SKU is finished — there is nothing to give a printer.">&mdash;</span>'}</td>` : '')
      + `<td${!spPick ? ' class="frz"' : ''} style="text-align:left;font-size:12.5px;min-width:170px">${chips}</td>`
      + ordItemCell(r, ptImgSpanSrc(r.sku, r.shopImg, 42),
        (r.needsSku ? '<div><span class="st st-pending" title="Not in the Master Database yet — it is on the Custom SKUs list, waiting for its article, colour and size.">custom</span></div>' : '')
        + (r.prn && r.prn.size ? `<div class="jw-sub">Printer: ${[...r.prn.entries()].map(([k, x]) => esc(k) + ' ' + nf(x.back) + '/' + nf(x.given)).join(', ')}</div>` : '')
        + (skuKeys.length && state !== 'none'
          ? `<div class="jw-sub">${nf(skuKeys.filter(k => (ORD.pick || new Set()).has(k)).length)} of ${nf(skuKeys.length)} line(s) ticked</div>` : ''),
        false)
      + `<td class="num">${nf(r.orders.length)}</td>`
      + `<td class="num" style="font-weight:700">${nf(r.qty)}</td>`
      /* CUT ONLY WHERE THE ARTICLE IS CUT. */
      + `<td class="num">${r.cutOf ? nf(r.cut) : '<span class="muted" style="font-size:11.5px" title="This article is not cut — nothing to record">not needed</span>'}</td>`
      + `<td class="num">${nf(r.issued)}</td>`
      + `<td class="num"${r.overRecv ? ' style="color:#7f6000;font-weight:700"' : ''}>${nf(r.received)}</td>`
      /* QC PASSED, AND WHAT OF IT IS WAITING FOR SHIPPING — it is in the shipping team's From production list already. */
      + `<td class="num"><b style="color:#166534">${nf(r.pressed)}</b>${r.forQc ? `<div style="color:#B45309;font-weight:700;font-size:11px;white-space:nowrap" title="Received from the karigar, not checked by QC yet">${nf(r.forQc)} available for QC</div>` : ''}</td>`
      /* HANDED TO SHIPPING: once shipping accepts all of a line, that line is complete by itself. */
      + `<td style="text-align:left;white-space:nowrap">${r.handed >= r.qty ? '<span class="jw-st done">Complete</span>'
          : `<b>${nf(r.handed)}</b> <span class="muted">of ${nf(r.qty)}</span>`
            + (r.ready ? `<div style="font-size:11px;color:#166534;font-weight:700" title="Passed by QC, not handed over yet — the shipping team takes it in From production">${nf(r.ready)} available for handover</div>` : '')}</td></tr>`;
  })() : (() => {
    /* HANDED OVER IS THE END OF A SHOPIFY LINE, and it says so by name — "Complete" on its own left
     * you wondering whether the goods had actually gone anywhere. */
    const status = r.handedAt ? `<span class="jw-st done" title="${esc(r.handedBy || '')} · ${esc(ptIsoDate(r.handedAt) || '')}">Handed over</span>`
        + (r.unrecorded ? `<div><span class="pill pill-low" title="${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
          + ' piece(s) were sent with nothing in the registers to say they were made. The goods have gone, so they are not work '
          + 'outstanding — but the entry is missing.')}">${nf(r.unrecorded)} never recorded</span></div>` : '')
      /* Made, pressed, and waiting for the shipping team to take it — the one state the order book
       * does not have, because only a Shopify line is handed over. */
      : r.open && !r.pendingCut && !r.pendingMake && !r.madeToPress ? '<span class="jw-st pend">ready to hand over</span>'
      : ordStatePill(r) + (!r.open && r.unrecorded ? `<div><span class="pill pill-low" title="${esc(nf(r.unrecorded) + ' of these '
          + nf(r.qty) + ' piece(s) were pressed with no receipt in Base Data. The line is finished, so nothing is left to make — but the entry is missing.')}">${nf(r.unrecorded)} never recorded</span></div>` : '');
    const pk = r.orderNo + '|' + r.sku;
    return '<tr>'
      + (spPick ? `<td class="frz"><input type="checkbox" data-sppick="${esc(pk)}"${
          (ORD.pick || new Set()).has(pk) ? ' checked' : ''} style="width:auto;margin:0"></td>` : '')
      + ordOrderCell(r, !spPick)
      + ordItemCell(r, ptImgSpanSrc(r.sku, r.shopImg, 42),
        r.needsSku ? '<div><span class="st st-pending" title="Not in the Master Database yet — it is on the Custom SKUs list.">custom</span></div>' : '')
      + `<td class="num" style="font-weight:700">${nf(r.qty)}${r.pcsPer > 1 ? `<div class="muted" style="font-size:10px;font-weight:400">${nf(r.packs)} × ${nf(r.pcsPer)}</div>` : ''}</td>`
      /* WHO IS PRINTING IT, AND HOW MUCH OF IT. A line nobody prints says so plainly rather than
       * showing a nought that reads like work nobody has started. */
      /* THE SAME FAULT THE ORDER BOOK HAD: this knew only a printer put on the line from this screen, and
       * said "not printed" on cloth that had been with a vendor for a week. */
      + `<td style="text-align:left;font-size:12px">${r.printer
          ? `<b>${nf(r.printed)}</b> <span class="muted">of ${nf(r.qty)}</span>`
            + `<div class="muted" style="font-size:11px">${esc(voName(r.printer))}</div>`
          : (v => (v
            ? `<b>${nf(v.back)}</b> <span class="muted">back of ${nf(v.given)}</span>`
              + `<div class="muted" style="font-size:11px">${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}${v.shared ? ' · shared' : ''}</div>`
            : '<span class="muted">not given to a vendor</span>'))(ordVendorOf(r.orderNo, r.sku))}</td>`
      + `<td class="num">${nf(r.cut)}</td><td class="num">${nf(r.issued)}</td>`
      + `<td class="num"${r.overRecv ? ' style="color:#7f6000;font-weight:700"' : ''}>${nf(r.received)}</td>`
      + (q => `<td class="num">` + (q
          ? `<span style="color:#166534;font-weight:700">${nf(q.ok)}</span>`
            + (q.rej ? ` <span style="color:var(--bad)">${nf(q.rej)} ✗</span>` : '')
          : '<span class="muted">—</span>') + '</td>')(ordQcOf(r.orderNo, r.sku))
      + `<td class="num" style="color:#166534">${nf(r.pressed)}</td>`
      + `<td class="num"${r.pendingMake ? ' style="color:var(--bad);font-weight:700"' : ''}>${r.pendingMake ? nf(r.pendingMake) : '<span class="muted">—</span>'}</td>`
      /* WHO HAS THE QUILT. Only a quilt has a quilt team to be with; everything else says so by
       * saying nothing. */
      + `<td style="text-align:left;font-size:12px">${(() => {
          if (!spIsQuilt(r)) return '<span class="muted">—</span>';
          const q = spOf(r.orderNo, r.sku) || {};
          return q.quiltAt
            ? `<span class="pill pill-ok" title="${esc(q.quiltBy || '')}">with the quilt team</span>`
              + `<div class="muted" style="font-size:10px">${esc(ptIsoDate(q.quiltAt) || '')}</div>`
            : '<span class="muted">not yet</span>';
        })()}</td>`
      + `<td>${status}</td>`
      /* Shopify work is recorded from here and nowhere else, so the way to record it is on the row.
       * Somebody who may not change a production entry gets neither button, rather than one that
       * refuses when pressed. */
      /* A PRINTER GETS ONE BUTTON AND ONLY ONE. Recording the printing is theirs; the rest of the
       * line is not, and a button that refuses when pressed reads as a broken app. */
      + `<td><div class="jw-acts">${(() => {
        const k = esc(r.orderNo + '|' + r.sku);
        const bits = [];
        if (spCanPrint(r.orderNo, r.sku))
          bits.push(`<button class="jw-btn" data-spprint="${k}">Printed</button>`);
        if (!spIsVendor() && ptCanEdit()) {
          bits.push(`<button class="jw-btn jw-primary" data-sp="${k}" title="Record cutting, issue to a karigar, receive, press">Entry</button>`);
          if (spIsQuilt(r)) {
            const q = spOf(r.orderNo, r.sku) || {};
            bits.push(q.quiltAt
              ? `<button class="jw-btn" data-spquilt="${k}" data-on="0">Undo quilt</button>`
              : `<button class="jw-btn" data-spquilt="${k}" data-on="1" style="color:#166534">To quilt team</button>`);
          }
          bits.push(r.handedAt
            ? `<button class="jw-btn" data-spback="${k}">Undo</button>`
            : `<button class="jw-btn" data-sphand="${k}" style="color:#166534">Handover</button>`);
        }
        if (spCanAssign())
          bits.push(`<button class="jw-btn" data-spassign="${k}">${r.printer ? 'Printer' : 'Assign'}</button>`);
        return bits.length ? bits.join('') : '<span class="muted">—</span>';
      })()}</div></td>`
      + '</tr>';
  })()).join('');

  $('odTable').innerHTML = thead + '<tbody>' + body + '</tbody>';
  /* A BOX THAT IS NEITHER ON NOR OFF. Some of a SKU's orders ticked and some not is a real state,
   * and an empty box would say the opposite of what is true. It cannot be set from markup. */
  (document.querySelectorAll('#odTable [data-spskupick][data-part]') || [])
    .forEach(el => { el.indeterminate = true; });
  /* ABOVE THE TABLE, not below it. Six hundred rows between somebody and the button that acts on
   * what they just ticked is the same as not having the button. */
  const bar = $('odPickBar');
  if (bar) {
    const n = (ORD.pick || new Set()).size;
    /* COMPLETED lives beside Refresh (Ravi, 2026-09-28: "looking too odd here"); this bar only counts the ticks. */
    bar.classList.toggle('hide', !spPick || !n);
    const db = $('odDone');
    if (db) {
      db.classList.toggle('hide', !spPick);
      db.disabled = !n; db.style.opacity = n ? '1' : '.55';
      db.textContent = n ? `Completed (${nf(n)})` : 'Completed';
      db.onclick = async () => {
        db.disabled = true;
        const err = await spHandoverPicked();
        if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
      };
    }
    bar.innerHTML = !spPick ? '' : (n
      /* THE COUNT IS LINES, and on this view it says how many SKUs those lines came from — ticking
       * one row and being told "1" while thirty-three orders move is how a bulk button loses
       * anybody's trust. */
      ? `<span class="muted" style="font-size:12.5px"><b>${nf(n)}</b> line(s) ticked${
          bySku ? ' across ' + nf(new Set([...(ORD.pick || new Set())].map(k => k.slice(k.indexOf('|') + 1))).size) + ' SKU(s)' : ''}</span>`
        + '<button id="spPickClear" class="ghost">Clear</button>'
      : '');
    if ($('spAssignAll')) $('spAssignAll').onclick = () => spAssignPickedOpen();
    if ($('spHandAll')) $('spHandAll').onclick = async () => {
      $('spHandAll').disabled = true;
      const err = await spHandoverPicked();
      if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
      if ($('spHandAll')) $('spHandAll').disabled = false;
    };
    if ($('spPickClear')) $('spPickClear').onclick = () => { ORD.pick = new Set(); renderOrd(); };
    if ($('spPickAll')) $('spPickAll').onchange = e => {
      ORD.pick = ORD.pick || new Set();
      if (!e.target.checked) ORD.pick = new Set();
      /* WHAT IS SHOWN, not every line in the book: a filtered table of four out of six hundred must
       * not quietly tick the other five hundred and ninety-six. */
      else rows.slice(0, ORD_CAP).forEach(x => (bySku ? spSkuKeys(x) : [x.orderNo + '|' + x.sku])
        .forEach(k => ORD.pick.add(k)));
      renderOrd();
    };
  }
  const short = rows.filter(r => r.needsSku).length;
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(rows.length)} ${bySku ? 'SKU' : 'line'}(s) of ${nf(src.length)}`
    + (rows.length > ORD_CAP ? ` · showing the newest ${nf(ORD_CAP)} · Export covers all of them` : '')
    + ordKpiNote()
    + (short ? ` · ${nf(short)} SKU(s) still on the Custom SKUs list, waiting for article, colour and size` : '');
  ordMoreBtn(rows.length);
  ptImgFill(rows.slice(0, ORD_CAP).map(r => r.sku), false, ptIfTab('ord', renderOrd));
}

/**
 * Hand over every ticked line that is ready, and say what happened to the ones that were not.
 *
 * NOT ALL OR NOTHING, unlike cancelling. Eighteen of twenty being ready means eighteen pieces are
 * genuinely going to the shipping team, and refusing the lot because two still need pressing would
 * mean doing those eighteen one at a time. Each one that is left behind is named with its reason,
 * and every handover can be undone.
 */
async function spHandoverPicked() {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const picked = [...(ORD.pick || new Set())];
  if (!picked.length) return 'Tick the line(s) first.';
  const done = [], left = [];
  for (const k of picked) {
    const i = k.indexOf('|');
    const no = k.slice(0, i), sku = k.slice(i + 1);
    /* spHandover redraws on success. The list being walked is ORD.pick, which is state rather than
     * anything on the screen, so the redraw cannot take it away mid-loop. */
    const err = await spHandover(no, sku, true);
    if (err) left.push((sku || no) + ': ' + err.replace(/^Nothing has been received[^,]*, so there is nothing to hand over\.$/, 'nothing received yet'));
    else done.push(k);
  }
  done.forEach(k => ORD.pick.delete(k));
  renderOrd();
  if (!done.length) return left.slice(0, 3).join(' · ') + (left.length > 3 ? ` And ${nf(left.length - 3)} more.` : '');
  $('odMsg').className = left.length ? 'err' : 'muted';
  $('odMsg').textContent = `${nf(done.length)} line(s) handed to the shipping team.`
    + (left.length ? ` ${nf(left.length)} left behind — ${left.slice(0, 2).join(' · ')}`
      + (left.length > 2 ? ` and ${nf(left.length - 2)} more.` : '.') : '');
  return '';
}

/** The entry form for one Shopify line: the four stages, in the order they happen. */
/**
 * Is this Shopify line a quilt?
 *
 * Quilts go to the quilt team as a job, not to a karigar by the piece — so a quilt line keeps simple
 * counters and a handover of its own, and everything else is issued to a named person.
 */
function spIsQuilt(line) {
  const hay = [line && line.articleType, line && line.articleSubtype].join(' ');
  if (/quilt/i.test(hay)) return true;
  const m = line && cutSkuOf(line.sku);
  return !!(m && /quilt/i.test([m.articleType, m.subtype].join(' ')));
}

/* ---- Shopify work, written into the registers that count ---- */

/** The Base Data rows this Shopify line has produced — what was issued, to whom, and what came back. */
function spBaseRows(orderNo, sku) {
  return (PT.base || []).filter(r => r && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku));
}
const spIssuedReal = (o, s) => spBaseRows(o, s).reduce((a, r) => a + ptNum(r.issuePieces), 0);
const spRecvReal = (o, s) => spBaseRows(o, s).reduce((a, r) => a + ptNum(r.receivedPieces), 0);

/**
 * Issue pieces of a Shopify line to a karigar.
 *
 * A REAL BASE DATA ROW, not a counter. Piece-rate pay is worked out from these rows — name, type,
 * pieces, received — so an issue that does not land here is work somebody does not get paid for.
 * Every cap that guards an ordinary issue guards this one: what the order asked for, and what has
 * actually been cut.
 */
async function spIssueReal(orderNo, sku, type, name, pcs, date, remarks, extraReason) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer on the order.';
  const t = String(type || '').trim(), n = String(name || '').trim();
  if (!t) return 'Which employment type?';
  if (!n) return 'Which karigar is it going to?';
  const emp = ptEmpsOfType(t).find(e => String(e[1]).trim().toLowerCase() === n.toLowerCase());
  if (!emp) return `"${n}" is not on the ${t} list.`;
  const q = parseInt(pcs, 10);
  if (!q || q < 1) return 'How many pieces?';
  const d = String(date || '').trim() || dToday();

  /* THE SAME GUARD AS ANY OTHER ISSUE: not more than the order asked for, and not more than has been
   * cut. Shopify orders are in the order book, so this needs no special case. */
  const extra = String(extraReason || '').trim();
  const gErr = bdGuard(obUC(orderNo), obUC(sku), q, undefined, !!extra);
  if (gErr) return gErr;
  /* THE SAME ZIPPER GATE AS THE FORM. This path never had it, and never deducted either: 143 Shopify
   * issues of zip SKUs since 13 Sep, not one zipper taken off the shelf. */
  const zErr = ptZipCheck(sku, q, null);
  if (zErr) return zErr;

  /* THE ITEM'S DETAILS FROM THE CUSTOM SKUs LIST WHEN THE ORDER LINE HAS NONE (2026-10-01). The line takes them from
   * the master (obWhat, since 25 Sep), but a SKU that is only on the Custom SKUs list came through blank: Job Work
   * rows with no article, subtype or size have no rate, so karigar pay could not be worked out (104 rows, 13-28 Sep).
   * What that list's own record says fills what the line leaves empty — never a guess, so a wrong rate cannot
   * slip in quietly; what the line does say is kept. */
  let meta = {};
  if (!mdbOf(obUC(sku)) && typeof MDBX !== 'undefined') {
    try { await ptEnsureCustom(); } catch (e) { /* the line alone, as before */ }
    meta = (MDBX.custom || []).find(r => r && obUC(r.sku) === obUC(sku)) || {};
  }
  const entry = {
    id: 'bd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    empType: t, empName: emp[1], sku: obUC(sku),
    articleType: line.articleType || meta.articleType || '', articleSubtype: line.articleSubtype || meta.subtype || '',
    color: line.color || meta.color || '', size: line.size || meta.size || '',
    orderNo: obUC(orderNo),
    issuePieces: q, issueDate: ptStampDate(d),
    receivedPieces: 0, rejectionPieces: 0, receivingDate: '', pendingPieces: q,
    remarks: [extra ? 'Extra: ' + extra : '', String(remarks || '').trim()].filter(Boolean).join(' · '),
    extraPcs: extra ? q : 0, extraReason: extra,
    frozen: false,
    /* Where it came from, so the Shopify screen and the register agree about what this row is. */
    shopOrderNo: line.shopOrderNo || '', src: 'SHP',
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  try { await ptPut('pt_baseData/' + entry.id, entry); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PT.base = (PT.base || []).concat([Object.assign({ _key: entry.id }, entry)]);
  /* WHAT GOES WITH THE PIECES, as the form does it: the zippers, and a ruffle's fabric. Both are keyed
   * on this row, so they can never be taken twice, and deleting the issue gives them back. The issue
   * itself is saved by now, so a failure here is reported rather than returned — returning it would
   * read as "not issued" and invite the same pieces being issued again. */
  try { await ptConsumeZippers(entry); } catch (e) { console.warn('Zipper deduction did not save for ' + entry.id + ': ' + (e.message || e)); }
  try { await ptConsumeRuffle(entry); } catch (e) { console.warn('Ruffle deduction did not save for ' + entry.id + ': ' + (e.message || e)); }
  if (!SP_QUIET) renderOrd();
  return '';
}

/**
 * Book pieces back from the karigar, oldest issue first.
 *
 * The pieces belong to an issue, not to a line: "Ramesh took twelve" is what gets settled, and the
 * oldest one is the one that has been waiting.
 */
async function spReceiveReal(orderNo, sku, pcs, date, fromName) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  let left = parseInt(pcs, 10);
  if (!left || left < 1) return 'How many pieces came back?';
  /* FROM WHOM, when it is said. Two karigars can hold the same SKU on one order; closing the other
   * one's issue would pay the wrong person. */
  const from = String(fromName || '').trim().toLowerCase();
  const open = spBaseRows(orderNo, sku).filter(r => !r.frozen && ptNum(r.pendingPieces) > 0
      && (!from || String(r.empName || '').trim().toLowerCase() === from))
    .sort((a, b) => ptDtMs(a.issueDate) - ptDtMs(b.issueDate));
  if (!open.length) return from ? `Nothing is out with ${fromName} on this line.` : 'Nothing is out with anybody on this line.';
  const pend = open.reduce((a, r) => a + ptNum(r.pendingPieces), 0);
  if (left > pend) return `Only ${nf(pend)} piece(s) are out with ${from ? fromName : 'the karigars'} on this line.`;
  const d = String(date || '').trim() || dToday();
  for (const row of open) {
    if (left <= 0) break;
    const take = Math.min(left, ptNum(row.pendingPieces));
    const res = bdApplyRecv(row, take, ptStampDate(d));      // the receipt is dated the day the goods came in
    if (res.err) return res.err;
    /* THE ROW IS CLOSED THE WAY THE BASE DATA SCREEN CLOSES IT. Payroll pays a row once it carries a
     * receiving date, and Base Data stamps that date only when the last piece is back. Stamping it on
     * every receipt paid a half-finished Shopify issue that an ordinary one would not have been paid
     * for yet. When the row does close, it closes on the day the goods came in, not the moment it was
     * typed. */
    /* Only a row closing for the FIRST time takes the day that was picked; one that already carries
     * a receiving date keeps it, admin's override apart. */
    if (res.row.frozen && !row.receivingDate) res.row.receivingDate = ptStampDate(d);
    try { await bdSaveRow(res.row); } catch (e) { return 'Not saved: ' + (e.message || e); }
    left -= take;
  }
  if (!SP_QUIET) renderOrd();
  return '';
}

/** Cutting and pressing, written where those screens write them. */
async function spCutReal(orderNo, sku, pcs, date, fabric, remarks, extraReason) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer on the order.';
  const q = parseInt(pcs, 10);
  if (!q || q < 1) return 'How many pieces were cut?';
  const d = String(date || '').trim() || dToday();
  if (cutMonthFrozen(d)) return `${ptMonthKey(d)} is frozen — cutting entries for that month are locked.`;
  const extra = String(extraReason || '').trim();
  const gErr = cutGuard(obUC(orderNo), obUC(sku), q, undefined, !!extra);
  if (gErr) return gErr;
  const entry = {
    id: 'cut_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    sku: obUC(sku), articleType: line.articleType || '', articleSubtype: line.articleSubtype || '',
    color: line.color || '', size: line.size || '',
    pieces: q, cutDate: ptStampDate(d), fabricWidth: String(fabric || '').trim(),
    orderNo: obUC(orderNo), remarks: [extra ? 'Extra: ' + extra : '', String(remarks || '').trim()].filter(Boolean).join(' · '),
    extraPcs: extra ? q : 0, extraReason: extra,
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  try { await ptPut('pt_cuttingData/' + entry.id, entry); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PT.cut = (PT.cut || []).concat([Object.assign({ _key: entry.id }, entry)]);
  if (!SP_QUIET) renderOrd();
  return '';
}

async function spPressReal(orderNo, sku, pcs, date, remarks, extraReason) {
  return 'Pressing is no longer recorded (since 5 Oct 2026) — a piece counts as made once QC passes it. Record it in Quality Control.';
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer on the order.';
  const q = parseInt(pcs, 10);
  if (!q || q < 1) return 'How many pieces were pressed?';
  const d = String(date || '').trim() || dToday();
  const extra = String(extraReason || '').trim();
  const gErr = pressGuard(obUC(orderNo), obUC(sku), q, undefined, !!extra);
  if (gErr) return gErr;
  const entry = {
    id: 'press_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    sku: obUC(sku), articleType: line.articleType || '', articleSubtype: line.articleSubtype || '',
    color: line.color || '', size: line.size || '',
    pieces: q, entryDate: ptStampDate(d), orderNo: obUC(orderNo),
    remarks: [extra ? 'Extra: ' + extra : '', String(remarks || '').trim()].filter(Boolean).join(' · '),
    extraPcs: extra ? q : 0, extraReason: extra,
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };
  try { await ptPut('pt_pressInventory/' + entry.id, entry); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.press = (PTG.press || []).concat([Object.assign({ _key: entry.id }, entry)]);
  if (!SP_QUIET) renderOrd();
  return '';
}

