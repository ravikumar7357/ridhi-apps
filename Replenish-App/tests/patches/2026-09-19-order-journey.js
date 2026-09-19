/* THE ORDER CONSOLE KNOWS WHAT THE VENDORS HOLD, AND AN ORDER CAN BE READ START TO FINISH.
 *
 * The Printing column read one thing: a printer put on a line from this screen (pt_shopProd). Every
 * order Ravi had placed with a printer from Vendor Orders — 489 live lines — was invisible to it, so
 * the column said "not printed" on cloth that had been at the printer for a week.
 *
 * A vendor order line names a SKU and never a sales order (0 of 489 do), so the link is by SKU. For
 * 264 SKUs that is exact — one order wants them. For 125 it is not, and what a printer holds has to be
 * shared out ONCE across the orders wanting it; otherwise the same 25 pieces read as "with the printer"
 * on every one of them, which is the mistake the India-stock column made before it.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the allocation ---- */
one(`/** Work that exists but names no order — real pieces the caps cannot see. */`,
`/* ================= WHAT THE VENDORS HOLD, ORDER BY ORDER =================
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
      pile.get(sku).push({ vendorCode: o.vendorCode, vpo: o.orderNo || o.id, service: prLineServices(o.vendorCode, o)[0] || '',
        left: qty, backLeft: Math.min(back, qty), at: ptDtMs(o.orderDate) || Date.parse(o.createdAt || '') || 0,
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
    const chunks = pile.get(sku);
    open.concat(shut).forEach(r => {
      let need = r.qty; const parts = [];
      for (const c of chunks) {
        if (!(need > 0)) break;
        if (!(c.left > 0)) continue;
        const take = Math.min(need, c.left), back = Math.min(take, c.backLeft);
        c.left -= take; c.backLeft -= back; need -= take;
        parts.push({ vendorCode: c.vendorCode, vpo: c.vpo, service: c.service, qty: take, back, due: c.due });
      }
      if (!parts.length) return;
      map.set(r.orderNo + '|' + r.sku, { given: parts.reduce((t, p) => t + p.qty, 0), back: parts.reduce((t, p) => t + p.back, 0),
        parts, shared: rows.length > 1 });
    });
  });
  ORDV = { vo: VO.rows, lines, map };
  return map;
}
/** One order line's share — null when no vendor holds anything for it. */
const ordVendorOf = (orderNo, sku) => ordVendorAlloc().get(obUC(orderNo) + '|' + obUC(sku)) || null;

/**
 * Where a line is waiting, in one word — the first stage that has not caught up with the one before.
 * Read off the same figures the row shows, so the two cannot disagree.
 */
function ordWaitingAt(r) {
  if (!r.open) return 'Complete';
  const v = ordVendorOf(r.orderNo, r.sku);
  const vGiven = r.printer ? r.qty : (v ? v.given : 0), vBack = r.printer ? r.printed : (v ? v.back : 0);
  if (vGiven > vBack && (r.cutReq ? r.cut < vGiven : r.received < vGiven)) return 'Vendor — ' + nf(vGiven - vBack) + ' to come back';
  if (r.pendingCut > 0) return 'Cutting — ' + nf(r.pendingCut) + ' to cut';
  if (r.issued < r.qty) return 'Issue — ' + nf(r.qty - r.issued) + ' not given to a karigar';
  if (r.received < r.issued) return 'Karigar — ' + nf(r.issued - r.received) + ' out';
  if (r.pressed < r.received) return 'Press — ' + nf(r.received - r.pressed) + ' to press';
  return 'Store / dispatch';
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
      store: ordFgOf(r.orderNo, r.sku) || 0, v }; };
  const S = rows.map(stage), sum = f => S.reduce((t, x) => t + (x[f] || 0), 0);
  const tiles = [['Ordered', sum('ordered')], ['With vendor', sum('given')], ['Back from vendor', sum('back')], ['Cut', sum('cut')],
    ['Issued', sum('issued')], ['Received', sum('received')], ['QC passed', sum('qc')], ['Pressed', sum('pressed')], ['In store', sum('store')]];
  const strip = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">' + tiles.map(([l, n], i) =>
    \`<div style="flex:1 1 92px;border:1px solid var(--line);border-radius:10px;padding:7px 9px;text-align:center">\`
    + \`<div style="font-size:17px;font-weight:700\${i && n < tiles[0][1] ? ';color:#7f6000' : ';color:var(--accent)'}">\${nf(n)}</div>\`
    + \`<div class="muted" style="font-size:11px">\${l}</div></div>\`).join('<div style="align-self:center" class="muted">›</div>') + '</div>';
  const num = (n, of) => n == null ? '<span class="muted">n/a</span>' : (n >= of ? \`<span style="color:#166534;font-weight:700">\${nf(n)}</span>\` : nf(n));
  const head = ['SKU', 'What', 'Ordered', 'With vendor', 'Back', 'Cut', 'Issued', 'Received', 'QC', 'Pressed', 'In store', 'Waiting at']
    .map((h, i) => \`<th\${i >= 2 && i <= 10 ? ' class="num"' : ''}>\${h}</th>\`).join('');
  const body = rows.map((r, i) => { const x = S[i];
    const vend = r.printer ? [\`\${esc(voName(r.printer))} · put on this line from the Order Console · \${nf(r.printed)} of \${nf(r.qty)} back\`]
      : (x.v ? x.v.parts.map(p => \`\${esc(p.vpo)} · \${esc(voName(p.vendorCode))}\${p.service ? ' · ' + esc(p.service) : ''} · \${nf(p.qty)} given, \${nf(p.back)} back\`
          + (p.due ? ' · promised ' + esc(p.due) : '')) : []);
    return '<tr>'
      + \`<td style="font-family:ui-monospace,monospace;text-align:left">\${esc(r.sku)}</td>\`
      + \`<td style="text-align:left;white-space:normal;min-width:170px">\${esc([r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '))}\`
      + (vend.length ? \`<div class="muted" style="font-size:11px">\${vend.join('<br>')}\${x.v && x.v.shared ? ' <i>(shared with other orders of this SKU)</i>' : ''}</div>\` : '') + '</td>'
      + \`<td class="num" style="font-weight:700">\${nf(x.ordered)}</td>\`
      + \`<td class="num">\${x.given ? nf(x.given) : '<span class="muted">—</span>'}</td><td class="num">\${x.given ? num(x.back, x.given) : '<span class="muted">—</span>'}</td>\`
      + \`<td class="num">\${num(x.cut, x.ordered)}</td><td class="num">\${num(x.issued, x.ordered)}</td><td class="num">\${num(x.received, x.ordered)}</td>\`
      + \`<td class="num">\${num(x.qc, x.ordered)}</td><td class="num">\${num(x.pressed, x.ordered)}</td><td class="num">\${num(x.store, x.ordered)}</td>\`
      + \`<td style="text-align:left;font-size:12px\${r.open ? '' : ';color:#166534'}">\${esc(ordWaitingAt(r))}</td></tr>\`; }).join('');
  const first = rows[0], openN = rows.filter(r => r.open).length;
  ptOpenDialog({
    title: 'Order ' + no + ' — start to finish',
    subtitle: \`\${first.orderDate || '—'}\${first.shopOrderNo ? '  ·  Shopify ' + first.shopOrderNo : ''}  ·  \${nf(rows.length)} line(s), \${nf(openN)} still open\`,
    note: 'Each figure is the same one its own register shows — cutting, Base Data, QC, press, finished goods and the vendor orders. '
      + 'A vendor order names a SKU and not a sales order, so where several orders want the same SKU the vendor\\'s pieces are shared '
      + 'out once between them: open orders first, oldest first.',
    html: strip + \`<div class="xlwrap" style="max-height:50vh;border:1px solid var(--line);border-radius:10px"><table class="xl"><thead><tr>\${head}</tr></thead><tbody>\${body}</tbody></table></div>\`,
  });
}

/** Work that exists but names no order — real pieces the caps cannot see. */`, 'allocation, waiting-at and the journey');

/* ---- 2. the row: the order number opens the journey; the Printing cell reads the vendors ---- */
one("      + `<td${bkPick ? '' : ' class=\"frz\"'} style=\"text-align:left\">${esc(r.orderNo)}</td>`",
    "      + `<td${bkPick ? '' : ' class=\"frz\"'} style=\"text-align:left\"><a href=\"#\" data-ordj=\"${esc(r.orderNo)}\" title=\"This order, start to finish\" style=\"color:inherit;text-decoration:underline dotted\">${esc(r.orderNo)}</a></td>`",
    'the order number is a link');

one(`  const bkPrint = rows.some(r => r.printer) || bkAssign;`,
`  const bkPrint = rows.some(r => r.printer || ordVendorOf(r.orderNo, r.sku)) || bkAssign;`, 'the column shows when a vendor holds anything');

one("      + (!bkPrint ? '' : `<td style=\"text-align:left;font-size:12px\">${r.printer\n"
  + "          ? `<b>${nf(r.printed)}</b> <span class=\"muted\">of ${nf(r.qty)}</span>`\n"
  + "            + `<div class=\"muted\" style=\"font-size:11px\">${esc(voName(r.printer))}</div>`\n"
  + "          : '<span class=\"muted\">not printed</span>'}</td>`",
    "      + (!bkPrint ? '' : `<td style=\"text-align:left;font-size:12px\">${r.printer\n"
  + "          ? `<b>${nf(r.printed)}</b> <span class=\"muted\">of ${nf(r.qty)}</span>`\n"
  + "            + `<div class=\"muted\" style=\"font-size:11px\">${esc(voName(r.printer))}</div>`\n"
  + "          /* WHAT A VENDOR ORDER ALREADY GAVE OUT. This cell used to know only a printer put on the line from\n"
  + "           * this screen, and said \"not printed\" on cloth that had been at the printer for a week. */\n"
  + "          : (v => (v\n"
  + "            ? `<span title=\"${esc(v.parts.map(p => p.vpo + ' · ' + voName(p.vendorCode) + ' · ' + nf(p.qty) + ' given, ' + nf(p.back) + ' back' + (p.due ? ' · promised ' + p.due : '')).join('\\n')\n"
  + "                + (v.shared ? '\\n\\nThis SKU is on more than one order, so the vendor\\u2019s pieces are shared out between them once — open orders first, oldest first.' : ''))}\">`\n"
  + "              + `<b>${nf(v.back)}</b> <span class=\"muted\">back of ${nf(v.given)} given</span>`\n"
  + "              + (v.given < r.qty ? ` <span class=\"muted\">· ${nf(r.qty - v.given)} not given</span>` : '')\n"
  + "              + `<div class=\"muted\" style=\"font-size:11px\">${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}${v.shared ? ' · shared' : ''}</div></span>`\n"
  + "            : '<span class=\"muted\">not given to a vendor</span>'))(ordVendorOf(r.orderNo, r.sku))}</td>`",
    'the Printing cell reads the vendor orders');

/* ---- 3. the click, and the load ---- */
one(`$('odTable').addEventListener('click', async e => {`,
`$('odTable').addEventListener('click', async e => {
  const oj = e.target.closest('[data-ordj]');
  if (oj) { e.preventDefault(); return ordJourney(oj.getAttribute('data-ordj')); }`, 'the click');

one(`  if (FGI.rows === null) { try { await fgiLoad(); } catch (e) { FGI.rows = FGI.rows || []; } }
  /* The priority tag is kept per SKU`,
`  if (FGI.rows === null) { try { await fgiLoad(); } catch (e) { FGI.rows = FGI.rows || []; } }
  /* WHAT THE VENDORS HOLD. The Printing column and an order's journey are built from the vendor orders;
   * a failed read leaves the column saying nothing is with a vendor rather than stopping the tab. */
  if (VO.rows === null) { try { await ensureVo(); } catch (e) { VO.rows = VO.rows || []; } }
  /* The priority tag is kept per SKU`, 'the console loads the vendor orders');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
