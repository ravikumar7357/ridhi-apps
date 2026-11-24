/* ==== PRINTER LATE ALERT (Ravi, 17 Nov 2026) ====
 * "if a printer has got a line red and still not taken action for more than 2 days then a mail is sent to the described
 * person". Agreed: a line counts when it has been red — past its due date while the printer holds pieces — for more than
 * 2 days (from 18 Nov: 5 days and over, in delay groups); one mail a day listing every such printer (18 Nov: one mail, not one per printer), to our purchase / vendor
 * person and to Ravi, until the lines are delivered or get a new date.
 * Red is worked out exactly as the Vendor Portal colours it (vendors/orders/vendor-orders.js voDueOf + voDueTone):
 *   due        the printer's promised date, else the date we asked for
 *   left       ordered less what came back (accepted deliveries, else what the printer said it sent)
 *   with them  for a line the PPC flow placed, what we gave less what came back (flowProg on the order); a line whose
 *              cloth we have not given is waiting for us, not late
 * Orders that are Received, Cancelled or Draft, and cancelled lines, are left out (the management dashboard's rule).
 * Error strategy: plain functions over the data, no reading or sending; a line with no date or an unreadable date is
 * never late.
 */
/* From 5 days late (Srikant, 18 Nov: the delay groups start at 5–7 days); it was "more than 2 days" until then. */
const PL_LATE_AFTER_DAYS = 4;           // more than 4 days late = 5 days and over
const PL_CLOSED = ['Received', 'Cancelled', 'Draft'];

/** Every printer line more than 2 days late: { code, orderNo, what, sku, color, withPrinter, unit, due, days }. */
function plLateLines(vendorOrders, todayDay) {
  const out = [];
  Object.entries(vendorOrders || {}).forEach(([code, orders]) => Object.values(orders || {}).forEach(o => {
    if (!o || o.cancelled || PL_CLOSED.indexOf(o.status || 'Placed') >= 0) return;
    plLines(o).forEach(l => {
      const x = plDueOf(o, l, todayDay);
      if (!x || x.st !== 'late' || !(x.days > PL_LATE_AFTER_DAYS)) return;
      out.push({ code, orderNo: String(o.orderNo || o.poNo || o.id || ''), what: plWhat(o, l), sku: String(l.sku || ''), color: String(l.color || ''),
        withPrinter: x.withV, unit: plRunning(o) ? 'm' : 'pcs', due: x.due, days: x.days });
    });
  }));
  return out.sort((a, b) => b.days - a.days || a.orderNo.localeCompare(b.orderNo));
}
/** The late lines by printer, the printer with the most late lines first: [{ code, name, phone, lines }].
 *  names / phones: code → the printer's name / phone (plNames, plPhones). */
function plByPrinter(lines, names, phones) {
  const by = new Map();
  lines.forEach(l => { if (!by.has(l.code)) by.set(l.code, []); by.get(l.code).push(l); });
  return [...by.entries()].map(([code, list]) => ({ code, name: (names && names[code]) || code, phone: (phones && phones[code]) || '', lines: list }))
    .sort((a, b) => b.lines.length - a.lines.length || a.name.localeCompare(b.name));
}
/** The vendor name as the ERP shows it: the vendor master first, else the portal sign-in list, else the code. */
function plNames(masterVendors, vendorMap) {
  const names = {};
  Object.entries(vendorMap || {}).forEach(([code, v]) => { if (v && v.name) names[code] = String(v.name); });
  rmList(masterVendors).forEach(v => { const n = String(v.desc || v.name || '').trim(); if (v.code && n) names[String(v.code)] = n; });
  return names;
}
/* WHO TO CALL (Ravi, 18 Nov: the computer layout with the contact under each printer): the cellphone from the vendor master,
 * else the portal sign-in list. A printer with none shows no phone line. */
function plPhones(masterVendors, vendorMap) {
  const phones = {};
  Object.entries(vendorMap || {}).forEach(([code, v]) => { if (v && String(v.phone || '').trim()) phones[code] = String(v.phone).trim(); });
  rmList(masterVendors).forEach(v => { const p = String(v.phone || '').trim(); if (v.code && p) phones[String(v.code)] = p; });
  return phones;
}

/* ---- the Vendor Portal's reading of one line ---- */

const plRunning = o => o.orderType === 'running';
const plLines = o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {})).filter(l => l && !l.cancelled);
const plQty = (o, l) => { const n = parseFloat(plRunning(o) ? l.meters : l.qty); return isFinite(n) ? n : 0; };
const plWhat = (o, l) => String((plRunning(o) ? [l.fabricType, l.printDirection].filter(Boolean).join(' · ') : (l.articleSubtype || l.articleType)) || l.sku || '');
/** What a delivery is worth: nothing if it never arrived, what was accepted, else what the printer claimed. */
function plDeliveryQty(d) {
  const ok = d && d.ok && isFinite(parseFloat(d.ok.qty)) ? d.ok : null;
  if (d && d.no && !ok) return 0;
  return ok ? parseFloat(ok.qty) : (parseFloat(d && d.qty) || 0);
}
function plDone(l) {
  const d = (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).filter(Boolean);
  if (d.length) return d.reduce((s, x) => s + plDeliveryQty(x), 0);
  const cached = parseFloat(l.vendorQty != null ? l.vendorQty : l.dispatchedQty);
  return isFinite(cached) ? cached : 0;
}
const plDue = l => String(l.vendorDate || '').trim() || String(l.deliveryDate || '').trim();
const plParts = l => (Array.isArray(l.parts) ? l.parts : String(l.flowPart || '').split('+').filter(Boolean));
const plPartKey = p => { const [k, part] = String(p || '').split('|'); return part === 'ruffle' ? k + '~ruffle' : k; };
const plRound = n => Math.round(n * 100) / 100;
/** Given and back for a PPC-flow line, shared over the vendor-order lines that stand for the same print-order line. */
function plFlowShare(o, l) {
  const p = o.flowProg;
  if (!p || !plParts(l).length) return null;
  const items = p.items || (!(+p.given > 0) && !(+p.back > 0) ? {} : null);
  if (!items) return null;
  const cnt = {};
  plLines(o).forEach(x => plParts(x).forEach(q => { const k = plPartKey(q); cnt[k] = (cnt[k] || 0) + 1; }));
  let given = 0, back = 0;
  plParts(l).forEach(q => { const k = plPartKey(q), it = items[k], n = cnt[k] || 1; if (it) { given += (+it.given || 0) / n; back += (+it.back || 0) / n; } });
  return { given: plRound(given), back: plRound(back) };
}
/** { st: 'late' | 'wait' | 'other', days, due, withV } — or null when nothing is left on the line. */
function plDueOf(o, l, todayDay) {
  const flow = plFlowShare(o, l), back = flow ? flow.back : plDone(l);
  const left = plRound(plQty(o, l) - back);
  if (!(left > 0.001)) return null;
  const withV = flow ? Math.max(0, plRound(flow.given - back)) : left;
  const due = plDue(l);
  if (!(withV > 0.001)) return { st: 'wait', days: 0, due, withV };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { st: 'other', days: 0, due, withV };
  const days = rmDaysBetween(due, todayDay);
  return { st: days > 0 ? 'late' : 'other', days: Math.max(0, days), due, withV };
}

/* ---- the mail ---- */

/* SHORT (Ravi, 17 Nov, on the first live mail listing 80 lines: "nobody can read like this" → "just tell how much cloth is
 * pending with the vendor name and since when"): the mail gives only the printer, the cloth it holds late, and since when. */
/** What the printer holds late: pieces and metres apart (never added), lines, orders, and the oldest due date. */
function plPending(g) {
  const sum = unit => plRound(g.lines.filter(l => l.unit === unit).reduce((t, l) => t + l.withPrinter, 0));
  const oldest = g.lines.reduce((m, l) => (!m || l.days > m.days ? l : m), null);   // the most days late is the oldest due date
  return { pcs: sum('pcs'), m: sum('m'), lines: g.lines.length, orders: new Set(g.lines.map(l => l.orderNo)).size,
    since: oldest ? oldest.due : '', days: oldest ? oldest.days : 0 };
}
/* THE DESIGNS, NOT A COUNT OF ITEMS (Ravi, 18 Nov: "instead of showing items can we show the designs or colours that are
 * pending"): each design (colour / print name) the printer holds late, the one with most cloth first. */
const PL_DESIGNS_SHOWN = 6;
/** { names: the first designs, more: how many others } — a line with no colour is named by its fabric or SKU. */
function plDesigns(g, shown) {
  const limit = shown || PL_DESIGNS_SHOWN;
  const by = new Map();
  g.lines.forEach(l => { const d = l.color || l.what || l.sku; if (d) by.set(d, (by.get(d) || 0) + l.withPrinter); });
  const names = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
  return { names: names.slice(0, limit), more: Math.max(0, names.length - limit), total: names.length };
}
/* THE PRINTER IS A LINK (Ravi, 18 Nov; on the printer's name since the delay groups): to that printer's portal in the ERP, looked at as the printer, "Show late only" on
 * (core/nav.js navHashPrinter). That screen shows every late line, also those only 1–2 days late. */
const plPortalUrl = code => RM_ERP_URL + '#vend?printer=' + encodeURIComponent(code) + '&late=1';
/** "Azure Regal, Apatite Blue, Jade Green and 8 more" */
const plDesignsTxt = d => d.names.join(', ') + (d.more ? ' and ' + rmNf(d.more) + ' more' : '');
/** "120 pcs + 1,050.5 m" — only the units it holds. */
const plCloth = p => [p.pcs ? rmNf(p.pcs) + ' pcs' : '', p.m ? rmNf(p.m) + ' m' : ''].filter(Boolean).join(' + ');
/* BY HOW LATE (Srikant, 18 Nov: "make it condensed so that we can make it actionable. Also add a summary on top of the
 * email. Categories: 5-7, 8-14, 15-21, 21 days and above"; day 21 counts in 15–21). Each printer's late designs are put in
 * the group of how many days late they are, so the mail says "this printer has these colours 5–7 days late, these 8–14
 * days late …". A summary on top counts each group for all printers. */
const PL_GROUPS = [
  { label: '5–7 days', from: 5, to: 7 },
  { label: '8–14 days', from: 8, to: 14 },
  { label: '15–21 days', from: 15, to: 21 },
  { label: '22+ days', from: 22, to: Infinity },
];
const PL_GROUP_DESIGNS_SHOWN = 4;       // design names in one cell before "and N more"
/** The delay group a line belongs to, or null when it is not late enough for any. */
const plGroupOf = days => PL_GROUPS.find(b => days >= b.from && days <= b.to) || null;
/** One printer's late lines split by delay group: [{ group, lines }] for every group, empty ones included. */
const plByGroup = g => PL_GROUPS.map(group => ({ group, lines: g.lines.filter(l => plGroupOf(l.days) === group) }));
/** The top summary: per delay group, how many printers, how many designs (counted per printer) and the cloth. */
function plSummary(groups) {
  return PL_GROUPS.map(group => {
    const lines = [].concat(...groups.map(g => g.lines.filter(l => plGroupOf(l.days) === group)));
    const printers = groups.filter(g => g.lines.some(l => plGroupOf(l.days) === group));
    const designs = printers.reduce((t, g) => t + plDesigns({ lines: g.lines.filter(l => plGroupOf(l.days) === group) }).total, 0);
    return { group, printers: printers.length, designs, cloth: plPending({ lines }) };
  });
}
const plPlural = (n, word) => rmNf(n) + ' ' + word + (n === 1 ? '' : 's');
const plMailSubject = (groups, todayDay) => 'Printer delays: ' + plPlural(groups.length, 'printer') + ' 5+ days late · ' + rmShortDay(todayDay);
/**
 * The notice in the company's report style (Ravi, 18 Nov: "make it a bit professional"): the navy Fabricrush heading the
 * report PDFs use, the summary by delay group, then one row per printer with its designs in each delay group, the most
 * delayed printer first; the printer's name opens its late orders in the ERP. Tables with the style on each piece, so
 * Gmail and Outlook show it alike.
 */
function plMailHtml(groups, todayDay) {
  const ordered = groups.slice().sort((a, b) => plPending(b).days - plPending(a).days || a.name.localeCompare(b.name));
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:1000px;font-family:Arial,Helvetica,sans-serif;color:#1d2430">'
    + '<tr><td style="background:#1f3b63;padding:14px 20px"><div style="font-size:11px;letter-spacing:2px;color:#c9d6ea">FABRICRUSH · RIDHI HOME &amp; LIVING</div>'
    + '<div style="font-size:18px;font-weight:bold;color:#ffffff;margin-top:4px">Printer Delay Notice</div></td></tr>'
    + '<tr><td style="padding:16px 20px 4px;font-size:14px;line-height:1.6">' + plPlural(groups.length, 'printer') + ' holding cloth 5 or more days past its due date, as of '
    + rmEsc(rmLongDay(todayDay)) + '.</td></tr>'
    + '<tr><td style="padding:8px 20px">' + plSummaryTable(groups) + '</td></tr>'
    + '<tr><td style="padding:14px 20px 4px;font-size:13px;color:#4a5363">By printer — worst delays first. Click a printer to open its late orders on the Vendor Portal.</td></tr>'
    + '<tr><td style="padding:6px 20px">' + plPrinterTable(ordered) + '</td></tr>'
    + '<tr><td style="padding:14px 20px 4px;font-size:13px;color:#4a5363;line-height:1.6">Regards,<br><b style="color:#1d2430">Fabricrush ERP</b><br>'
    + '<span style="font-size:12px;color:#6b7380">This is an automatic notice, sent every Tuesday and Friday.</span></td></tr></table>';
}
const PL_CELL = 'padding:8px 10px;border:1px solid #d6dce6;font-size:13px;vertical-align:top;';
/* WORST FIRST (Ravi, 18 Nov — the computer layout): the summary and the printer table run 22+ → 15–21 → 8–14 → 5–7 days,
 * coloured from red down to grey, so the most urgent cloth is what the eye meets first. */
const PL_GROUPS_WORST_FIRST = PL_GROUPS.slice().reverse();
const PL_GROUP_COLOUR = { 22: '#b3261e', 15: '#c2410c', 8: '#9a5b00', 5: '#4a5363' };
const plGroupColour = group => PL_GROUP_COLOUR[group.from] || '#4a5363';
const plTh = (text, opts) => '<th style="' + PL_CELL + 'background:#f2f5fa;font-weight:bold;color:' + ((opts && opts.colour) || '#4a5363')
  + ';text-align:' + ((opts && opts.right) ? 'right' : 'left') + '">' + text + '</th>';
/** Summary: one row per delay group, worst first — printers, designs, cloth pending. */
function plSummaryTable(groups) {
  const byGroup = new Map(plSummary(groups).map(s => [s.group, s]));
  const rows = PL_GROUPS_WORST_FIRST.map(group => byGroup.get(group)).map(s => '<tr><td style="' + PL_CELL + 'font-weight:bold;color:' + plGroupColour(s.group) + '">'
    + s.group.label + ' late</td><td style="' + PL_CELL + 'text-align:right">' + rmNf(s.printers) + '</td><td style="' + PL_CELL + 'text-align:right">' + rmNf(s.designs) + '</td>'
    + '<td style="' + PL_CELL + 'white-space:nowrap">' + (plCloth(s.cloth) || '–') + '</td></tr>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:440px"><tr>' + plTh('Summary')
    + plTh('Printers', { right: true }) + plTh('Designs', { right: true }) + plTh('Cloth pending') + '</tr>' + rows + '</table>';
}
/** By printer: the printer and who to call, its total (oldest delay, all late cloth), then a column per delay group, worst first. */
function plPrinterTable(groups) {
  const head = '<tr>' + plTh('Printer') + plTh('Total') + PL_GROUPS_WORST_FIRST.map(b => plTh(b.label, { colour: plGroupColour(b) })).join('') + '</tr>';
  const cells = g => { const by = new Map(plByGroup(g).map(x => [x.group, x])); return PL_GROUPS_WORST_FIRST.map(b => plGroupCell(by.get(b))).join(''); };
  const rows = groups.map(g => '<tr>' + plPrinterCell(g) + plTotalCell(plPending(g)) + cells(g) + '</tr>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' + head + rows + '</table>';
}
/** The printer's name (the link to its late orders in the ERP), its code and phone. */
const plPrinterCell = g => '<td style="' + PL_CELL + '"><a href="' + rmEsc(plPortalUrl(g.code)) + '" style="color:#1a4fa3;font-weight:bold">' + rmEsc(g.name) + '</a>'
  + '<br><span style="font-size:12px;color:#6b7380">' + rmEsc(g.code) + (g.phone ? '<br><span style="white-space:nowrap">Phone ' + rmEsc(g.phone) + '</span>' : '') + '</span></td>';
/** "28 days oldest · 100 pcs + 615 m" */
const plTotalCell = p => '<td style="' + PL_CELL + 'background:#fbfcfe;white-space:nowrap"><b style="color:#b3261e">' + plPlural(p.days, 'day') + '</b> oldest<br><b>' + plCloth(p) + '</b></td>';
/** "Azure Regal, Jade Green and 2 more · 40 pcs" — or a dash when the printer has nothing in that group. */
function plGroupCell(x) {
  if (!x.lines.length) return '<td style="' + PL_CELL + 'color:#9aa3b2">–</td>';
  const d = plDesigns({ lines: x.lines }, PL_GROUP_DESIGNS_SHOWN);
  return '<td style="' + PL_CELL + '">' + rmEsc(plDesignsTxt(d)) + '<br><b>' + plCloth(plPending({ lines: x.lines })) + '</b></td>';
}
