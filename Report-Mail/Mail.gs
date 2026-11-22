/* ==== ERP REPORT MAIL — THE MAIL ITSELF (Ravi, 17 Nov 2026) ====
 * "in the mail I want you to just give the count of the headings", every detail in the PDFs. Since 18 Nov ("remake the
 * design of this mail to the design of the late printer mail") it is laid out like the Printer Delay Notice (Printers.gs):
 * the navy Fabricrush heading, one line saying when and for which days, anything that needs a look, a Production table
 * and a Shipping table with one row per heading (orders, items, pieces, channels), the two PDF links, and the sign-off.
 * An item is one SKU on one order — what the ERP calls a line (Ravi, 18 Nov: "then say it as items").
 * The cell and heading styles are the notice's own (PL_CELL, plTh), so both mails look alike.
 * Error strategy: none of this reads or sends anything; text is escaped (rmEsc) on the way in.
 */
const RM_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const RM_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Monday 16 Nov 2026" */
const rmLongDay = day => RM_WEEKDAY[rmWeekday(day)] + ' ' + Number(day.slice(8, 10)) + ' ' + RM_MONTH[Number(day.slice(5, 7)) - 1] + ' ' + day.slice(0, 4);
/** "12 Nov" */
const rmShortDay = day => Number(day.slice(8, 10)) + ' ' + RM_MONTH[Number(day.slice(5, 7)) - 1];
/** The mail's subject line. */
const rmMailSubject = rep => 'Company report · ' + rmLongDay(rep.today);

/** The mail body. links: { Production: url, Shipping: url, err } — the PDFs are in Drive (too big to attach). */
function rmMailHtml(rep, links) {
  const h = rmMailHeadings(rep);
  const period = rmShortDay(rep.win.fromDay) + ' – ' + rmShortDay(rep.win.lastDay);
  const text = (pad, html) => '<tr><td style="padding:' + pad + ';font-size:14px;line-height:1.6">' + html + '</td></tr>';
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:1000px;font-family:Arial,Helvetica,sans-serif;color:#1d2430">'
    + '<tr><td style="background:#1f3b63;padding:14px 20px"><div style="font-size:11px;letter-spacing:2px;color:#c9d6ea">FABRICRUSH · RIDHI HOME &amp; LIVING</div>'
    + '<div style="font-size:18px;font-weight:bold;color:#ffffff;margin-top:4px">Company Report</div></td></tr>'
    + text('16px 20px 4px', 'Production and shipping as of ' + rmEsc(rmLongDay(rep.today)) + '. '
      + (rep.win.byHand ? 'Period counted: ' : 'Counted since the last report: ') + '<b>' + rmEsc(period) + '</b>.')
    + rmMailNotesBox(rmMailNotes(rep, links))
    + rmMailSection('Production', h.prod) + rmMailSection('Shipping', h.ship)
    + text('14px 20px 4px', 'Every order, with photos and links into the ERP: ' + ['Production', 'Shipping'].map(t => (links && links[t])
      ? '<a href="' + rmEsc(links[t]) + '" style="color:#1a4fa3;font-weight:bold">' + t + ' PDF</a>' : '<b>' + t + ' PDF</b> (not saved)').join(' · '))
    + '<tr><td style="padding:14px 20px 4px;font-size:13px;color:#4a5363;line-height:1.6">Regards,<br><b style="color:#1d2430">Fabricrush ERP</b><br>'
    + '<span style="font-size:12px;color:#6b7380">' + (rep.win.byHand ? 'This report was asked for by hand.' : 'This is an automatic report, sent every Monday and Thursday.')
    + '</span></td></tr></table>';
}
/** Things that need a look, in one red-edged box; nothing when all is well. */
function rmMailNotesBox(notes) {
  if (!notes.length) return '';
  return '<tr><td style="padding:10px 20px 0"><div style="border-left:4px solid #b3261e;background:#fdf2f1;padding:8px 12px;font-size:13px;color:#7a1f19;line-height:1.6">'
    + notes.join('<br>') + '</div></td></tr>';
}
/** A section title and its table: one row per heading — orders, lines, pieces, the channels, and how it is counted. */
function rmMailSection(title, headings) {
  const head = '<tr>' + plTh('Heading') + plTh('Orders', { right: true }) + plTh('Items', { right: true }) + plTh('Pieces', { right: true })
    + plTh('By channel') + plTh('Counted') + '</tr>';
  return '<tr><td style="padding:16px 20px 4px;font-size:15px;font-weight:bold;color:#1f3b63">' + rmEsc(title) + '</td></tr>'
    + '<tr><td style="padding:2px 20px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">'
    + head + headings.map(rmMailRow).join('') + '</table></td></tr>';
}
const RM_MAIL_TONE = { late: '#b3261e', stuck: '#c2410c' };
/**
 * One heading's row. h.unit 'lines+pcs' (still in production) has no order count, as the ERP's red strip gives lines and
 * pieces; h.extra is a small line under the name ("+ 72 lines due today / tomorrow"); h.missing says Shopify was not read.
 */
function rmMailRow(h) {
  const c = h.count, num = v => '<td style="' + PL_CELL + 'text-align:right">' + v + '</td>';
  const name = '<td style="' + PL_CELL + 'font-weight:bold;color:' + (RM_MAIL_TONE[h.tone] || '#1d2430') + '">' + rmEsc(h.name)
    + (h.extra ? '<br><span style="font-size:12px;font-weight:normal;color:#6b7380">' + rmEsc(h.extra) + '</span>' : '') + '</td>';
  const counted = '<td style="' + PL_CELL + 'color:#6b7380;white-space:nowrap">' + rmEsc(h.when) + '</td>';
  if (h.missing === 'all') return '<tr>' + name + num('–') + num('–') + num('–') + '<td style="' + PL_CELL + 'color:#b3261e">not known: Shopify could not be read</td>' + counted + '</tr>';
  const by = h.unit === 'lines+pcs' ? b => b.lines : b => b.orders;
  const channels = c.byChannel.map(b => rmEsc(b.channel) + ' ' + rmNf(by(b))).join(' · ') || '–';
  const gap = h.missing === 'part' ? '<br><span style="color:#b3261e">+ Shopify not read</span>' : '';
  return '<tr>' + name + num(h.unit === 'lines+pcs' ? '–' : '<b>' + rmNf(c.orders) + '</b>') + num(rmNf(c.lines)) + num(rmNf(c.pcs))
    + '<td style="' + PL_CELL + '">' + channels + gap + '</td>' + counted + '</tr>';
}

/** Ravi's headings with their counts: { prod: [heading], ship: [heading] }, heading = { name, count, missing }. */
function rmMailHeadings(rep) {
  const p = rep.prod, s = rep.ship, ch = rmLineChannel, shopCh = x => x.store;
  const shop = list => rmCount(list.map(rmShopCountRow), shopCh);
  /* When Shopify could not be read, a 0 would look like "nothing shipped" — the line says the Shopify part is missing
   * instead (Ravi, 17 Nov: "why is it showing 0"). MCF is only Shopify, so it shows no number at all. */
  const noShop = !!s.shopErr && !((s.shop.shipped.length + s.shop.pending.length) > 0);
  /* How each count is taken: the days of the report, or as it stands today. A report by hand counts only its period (rmOnlySince). */
  const since = rep.win.byHand ? 'in the period' : 'since last report', now = rep.win.byHand ? 'in the period' : 'today';
  const one = (name, count, more) => Object.assign({ name, count, unit: 'orders', extra: '', tone: '', when: now }, more || {},
    { missing: noShop ? ((more && more.missing) || '') : '' });
  const soon = p.dueSoon.length;
  /* The carriers other than MCF that Shopify's parcels went with (the Shopify dispatch report's "via FedEx / DHL / Other"). */
  const carriers = rmCount(s.shop.shipped.filter(o => o.via !== 'MCF').map(o => Object.assign(rmShopCountRow(o), { via: o.via })), x => x.via);
  return {
    prod: [
      one('Came into production', rmCount(p.came, ch), { when: since }),
      one('Started in production', rmCount(p.started, ch)),
      one('Late (past the decided date)', rmCount(p.late, ch), { tone: 'late', extra: soon ? '+ ' + rmNf(soon) + ' items due today / tomorrow' : '' }),
      one('Stuck (no work for ' + RM_STUCK_DAYS + '+ days)', rmCount(p.stuck, ch), { tone: 'stuck' }),
      one('Ready, into finished goods', rmCount(p.finished, ch), { when: since }),
      one('Still in production', rmCount(p.inProduction, ch), { unit: 'lines+pcs' }),
    ],
    ship: [
      one('Shipped', rmMergeCounts([shop(s.shop.shipped), rmFbaCount(s.amazon.shipped), rmCount(s.other.shipped, ch)]), { when: since, missing: 'part' }),
      one('Shipped by MCF', shop(s.shop.mcf), { when: since, missing: 'all' }),
      one('Other carriers', carriers, { when: since, missing: 'all' }),
      one('Still pending', rmMergeCounts([shop(s.shop.pending), rmCount(s.amazon.pending, ch), rmCount(s.other.pending, ch)]), { missing: 'part' }),
      one('Ready to dispatch', rmMergeCounts([shop(s.shop.ready), rmFbaCount(s.amazon.ready), rmCount(s.other.ready, ch)]), { missing: 'part' }),
    ],
  };
}
/** Things that need a look: Shopify not read, FBA shipments not being marked, a PDF not saved or shared. [] when all is well. */
function rmMailNotes(rep, links) {
  const notes = [];
  if (!rep.erpList.used) notes.push(rmEsc(rep.erpList.why) + ", so open, late and stuck orders were worked out by this report and may differ a little from the ERP's red strip.");
  if (rep.ship.shopErr) notes.push('Shopify could not be read: ' + rmEsc(rep.ship.shopErr) + '.');
  const fba = rmFbaWarning(rep);
  if (fba) notes.push(rmEsc(fba));
  if (links && links.err) notes.push(rmEsc(links.err));
  return notes;
}
/** The FBA team has marked no shipment in this mail's days — "ready to dispatch" may then hold goods already gone. '' when fine. */
function rmFbaWarning(rep) {
  const last = rep.ship.amazon.lastShippedDay;
  if (last && last >= rep.win.fromDay) return '';
  return 'Amazon FBA: no shipment has been marked shipped ' + (last ? 'since ' + rmShowDay(last) : 'yet')
    + ', so "ready to dispatch" for Amazon may include goods already sent.';
}

/* ---- counting for the mail ---- */

/** A Shopify order as one countable row. */
const rmShopCountRow = o => ({ orderNo: o.store + '|' + o.order.id, store: o.store, qty: o.rows.reduce((t, r) => t + (r.left || r.qty), 0) });
/** FBA entries: one "order" per shipment (or per entry while it has none), all under Amazon FBA. */
function rmFbaCount(rows) {
  const ids = new Set(rows.map(r => r.shipment || r.entry._id || r.entry._key));
  const pcs = rows.reduce((t, r) => t + r.qty, 0);
  return { orders: ids.size, lines: rows.length, pcs, byChannel: ids.size ? [{ channel: 'Amazon FBA', orders: ids.size, lines: rows.length, pcs }] : [] };
}
function rmMergeCounts(list) {
  const by = [].concat(...list.map(c => c.byChannel)).sort(rmByOrdersThenName);
  return { orders: list.reduce((t, c) => t + c.orders, 0), lines: list.reduce((t, c) => t + c.lines, 0), pcs: list.reduce((t, c) => t + c.pcs, 0), byChannel: by };
}
