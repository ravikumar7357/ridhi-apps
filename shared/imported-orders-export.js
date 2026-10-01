$('soExport').onclick = () => {
  /* TICKED FIRST, EVERYTHING SHOWN OTHERWISE — the same rule as Print orders, deliberately.
   *
   * Export used to ignore the ticks entirely, so the one control that says "these ones" worked for
   * the printer and not for the file. Somebody ticking four orders and pressing Export got all 466,
   * and nothing on screen had said it would. Two buttons sitting next to each other must not read
   * the same tick differently. */
  const shownRows = soRows();
  const pickedRows = shownRows.filter(r => SO_PICKED.has(r.id));
  const rows = pickedRows.length ? pickedRows : shownRows;
  const usedTicks = pickedRows.length > 0;
  if (!rows.length) { soMsg('Nothing to export \u2014 widen the filters, or fetch some orders.', true); return; }
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const pick = $('soTmpl').value;
  const T = SO_TMPL[pick];
  if (T) {
    // SAID BEFORE THE FILE IS WRITTEN, not after the uploader rejects it. DHL's own guide makes one
    // complete invoice pair mandatory, and an HS code mandatory on every line — both are things
    // only a person can supply, and both are invisible until the upload fails.
    if (pick === 'dhlh' || pick === 'dhlc') {
      const noInv = [], noHs = new Set();
      rows.forEach(r => {
        const m = SHOP_META[r.id] || {};
        const pair = (m.gstInv && m.gstInvDate) || (m.ngstInv && m.ngstInvDate);
        if (!pair) noInv.push(r.no);
        r.items.forEach(i => { if (i.sku && !soSku(i.sku).hs) noHs.add(String(i.sku).toUpperCase()); });
      });
      if (noInv.length || noHs.size) {
        soMsg('Not written — DHL would reject it. '
          + (noInv.length ? noInv.length + ' order(s) have no complete invoice pair (' + noInv.slice(0, 4).join(', ') + (noInv.length > 4 ? '…' : '') + '). ' : '')
          + (noHs.size ? noHs.size + ' SKU(s) have no HS code (' + [...noHs].slice(0, 4).join(', ') + (noHs.size > 4 ? '…' : '') + ').' : '')
          + ' Open the order and fill them under Invoice & customs.', true);
        return;
      }
    }
    const lines = [T.head.map(cell).join(',')];
    let seq = 0;
    // NAMED, NOT SILENTLY MISSING. An order whose every line is refunded, removed or set to 0 writes
    // no rows — which is right, but an order absent from a courier file is otherwise discovered at
    // the counter, by its absence.
    const nothing = [];
    rows.forEach(r => {
      seq++;
      const meta = SHOP_META[r.id] || {};
      const built = T.rows(r, seq, meta);
      if (!built.length) { nothing.push(r.no); return; }
      built.forEach(line => {
        // Padded to the template's own width. A short row shifts every later column by one, and the
        // uploader reads the shifted value rather than refusing it.
        const out = line.slice(0, T.head.length);
        while (out.length < T.head.length) out.push('');
        lines.push(out.map(cell).join(','));
      });
    });
    const blob0 = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a0 = document.createElement('a'); a0.href = URL.createObjectURL(blob0);
    a0.download = T.file + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    a0.click(); URL.revokeObjectURL(a0.href);
    // DHL HYBRID CARRIES NO CURRENCY COLUMN AT ALL.
    //
    // Its own bundled user guide calls "Shipment Currency" mandatory — but that guide is the CSV
    // template's, pasted into the Hybrid workbook, and Hybrid's Sheet1 has no such column (nor
    // Terms of Trade, Tax Payment Option or Total Item FOB value). So the rates in a Hybrid file are
    // read in whatever currency the DHL account is set to, and nothing in the file says which.
    //
    // Getting that backwards is not a rounding error: INR read as USD is out by a factor of about
    // eighty. The app cannot check it, so it says so rather than letting the file leave quietly.
    const curNote = (pick === 'dhlh' && (rows[0] && (SHOP_META[rows[0].id] || {}).cur) !== 'USD')
      ? ' NOTE: the Hybrid sheet has no currency column — DHL will read these rates in whatever'
        + ' currency your account is set to. Confirm with DHL that it is INR.'
      : '';
    soMsg(`${T.file}: ${lines.length - 1} row(s) for ${rows.length} order(s)${usedTicks ? ' (ticked)' : ' (everything shown)'}. `
      + `Invoice numbers and dates are deliberately blank — fill them in before uploading.`
      + (nothing.length ? ` Left out ${nothing.length} order(s) with nothing left to ship: ${nothing.slice(0, 6).join(', ')}${nothing.length > 6 ? '…' : ''}.` : '')
      + curNote,
      !!curNote || nothing.length > 0);
    return;
  }
  /* ONE ROW PER LINE ITEM by default, with the order's own fields REPEATED on every row.
   *
   * Shopify's own export blanks the order columns on continuation rows, and that shape is only safe
   * for as long as nobody sorts the file. One sort and a line has lost the order it belonged to.
   * This file exists to be filtered, sorted and pivoted, so every row carries its own order.
   *
   * "One row per order" stays available for anything that counts ORDERS rather than pieces — on a
   * line item file the same order would be counted once per line.
   */
  const perOrder = pick === 'plainOrder';
  const ORDER_COLS = ['Shop', 'Order', 'Date', 'Ship to', 'Company', 'Address 1', 'Address 2', 'City', 'State',
    'Zip', 'Country', 'Phone', 'Email', 'Order units', 'Weight kg', 'Order value', 'Currency',
    'Location', 'To make', 'Ship from', 'MCF', 'India', 'Shopify status', 'Shipped on', 'Tracking',
    'Tracking carrier', 'Status', 'Our note', 'Shopify note', 'Ship via', 'Contents', 'Declared value'];
  /* A STATUS PER LINE, not one per order.
   *
   * "Required from production" on an order says nothing about the line inside it that is in FBA and
   * could go today — and it is the LINE that somebody picks, costs and chases. Same wording and the
   * same order of preference as the order-level route, so a line and its order cannot disagree.
   * `Qty refunded` sits beside it because a cancelled line is almost always a refunded one, and the
   * number is what makes the status checkable rather than something to be taken on trust. */
  const LINE_COLS = ['SKU', 'Amazon SKU', 'Product', 'Variant', 'Qty ordered', 'Qty refunded',
    'Qty removed', 'Qty to send', 'Unit price', 'Line total', 'Bin', 'FBA available',
    'India sellable', 'Comments'];

  /* IN THE BY-LINE FILE, "Ship from" ANSWERS FOR THE LINE.
   *
   * Every row in that file IS a line, so a "Ship from" column repeating the order's summary was the
   * one column somebody would read per line and be wrong about: an order reading "Need from
   * production" carries lines that are sitting in FBA and could go today. The order's own verdict
   * keeps its place beside it under its own name — nothing is lost, and where a line and its order
   * differ the file now shows both instead of hiding one.
   *
   * The by-ORDER file is unchanged: there, one row is one order and the summary is the answer.
   */
  const SHIP_AT = ORDER_COLS.indexOf('Ship from');
  const head = perOrder
    ? ORDER_COLS.concat(['Items'])
    : ORDER_COLS.slice(0, SHIP_AT + 1)
        .concat(['Order ship from'], ORDER_COLS.slice(SHIP_AT + 1), LINE_COLS);
  const lines = [head.map(cell).join(',')];
  const orderCells = (r, meta) => [r.channel, r.no, r.at, r.ship.name, r.ship.company, r.ship.a1, r.ship.a2,
    r.ship.city, r.ship.state, r.ship.zip, r.ship.country, r.ship.phone, r.email, r.units,
    r.kg ? r.kg.toFixed(2) : '', r.total, r.cur, r.locTxt || '', r.makeQty || '', r.route, r.mcf, r.india,
    r.ff || '', r.shippedAt || '', r.trkTxt || '', r.trkCo || '', r.status, r.note, r.shopNote,
    r.carrier, meta.desc || '', meta.val == null ? '' : meta.val];
  let lineCount = 0;
  rows.forEach(r => {
    const meta = SHOP_META[r.id] || {};
    if (perOrder) {
      lines.push(orderCells(r, meta).concat([
        // The bin travels with each line, so the list is readable on its own.
        // The bin AND the line's own status travel with each line, so the one-row-per-order file is
        // still readable on its own and does not have to be joined back to the line file.
        r.items.map(i => `${i.sku || i.name} x${i.qty}${soLocOf(i.sku) ? ' @' + soLocOf(i.sku) : ''}`
          + ` [${soLineState(r, i).label}]`).join(' | '),
      ]).map(cell).join(','));
      return;
    }
    // An order with NO line items still gets one row. Dropping it would make the file quietly
    // disagree with the order count on screen, and the missing order is exactly the odd one.
    const items = r.items.length ? r.items : [null];
    // The line's own verdict takes the "Ship from" slot; the order's slides one to the right.
    const base = orderCells(r, meta);
    const shipCells = lineRoute => base.slice(0, SHIP_AT)
      .concat([lineRoute, base[SHIP_AT]], base.slice(SHIP_AT + 1));
    items.forEach(i => {
      lineCount++;
      if (!i) { lines.push(shipCells('').concat(LINE_COLS.map(() => '')).map(cell).join(',')); return; }
      const shop = String(i.sku || '').trim().toUpperCase();
      const amz = soAmzSku(i.sku);
      const send = soSendQty(r.id, i.sku, soLive(i));
      const ind = soIndiaOf(i.sku);
      const fbaK = String(amz || '').toUpperCase();
      const fba = typeof soOrdFba === 'function' ? (fbaK ? (soOrdFba(r, fbaK) ?? '') : '')   // Replenish: by the order's brand
        : ((fbaK && fbaK in SHOP_STOCK) ? SHOP_STOCK[fbaK] : '');                        // Sellora
      const st = soLineState(r, i);
      lines.push(shipCells(st.label).concat([
        shop, amz && amz !== shop ? amz : '', i.name || '', i.variant || '',
        i.qty, i.rq || '', soRemovedQty(i) || '', send, i.price == null ? '' : i.price,
        i.price == null ? '' : Math.round(i.price * i.qty * 100) / 100,
        soLocOf(shop) || '', fba, ind ? ind[0] : '', st.why,
      ]).map(cell).join(','));
    });
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'shopify-orders-' + (perOrder ? 'by-order-' : 'by-line-')
    + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
  const how = usedTicks ? ' (ticked)' : ' (everything shown)';
  soMsg(perOrder
    ? `${rows.length} order(s) written, one row each${how}.`
    : `${lineCount} line(s) across ${rows.length} order(s)${how} \u2014 one row per line item, order repeated on each.`);
};


