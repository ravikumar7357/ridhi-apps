/* ==== ERP REPORT MAIL — THE TWO PDFS (Ravi, 17 Nov 2026) ====
 * The Production and Shipping PDFs list every line in the layout of his order sheet: Colour name · Size · Qty · Personalization · Image · SKU · Status · Channel · Date · Dispatch date
 * · Production status, plus Priority (P1 first). Late rows are red, stuck rows yellow, complete rows green.
 * Easy to find your way (Ravi, 17 Nov: "add a filter system … or something which can make it actionable", then
 * "Better PDF only" + "add the link"): a cover page sums each section by channel and links to it, lines are grouped by SKU,
 * and each order number opens that order in the ERP's Order Console (core/nav.js).
 * Everything typed by people or sent by Shopify goes into the page as text (rmEsc), never as HTML.
 * Error strategy: none of this reads or sends anything; a missing photo leaves the box empty.
 */
const RM_COLS = ['Colour name', 'Size', 'Qty', 'Personalization', 'Image', 'SKU', 'Status', 'Channel / order', 'Date', 'Dispatch date', 'Production status', 'Priority'];
const RM_ORDER_COL = 7;
const RM_TONE = { late: '#fde2e1', stuck: '#fff4cc', done: '#e3f4e4', '': '#ffffff' };
const RM_ERP_URL = 'https://fabricrush-replenish.web.app/';
const RM_ERP_ORDER_URL = RM_ERP_URL + '#ord?q=';

const rmEsc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rmShowDay = day => { if (!day) return ''; const p = String(day).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(day); };
const rmNf = n => Number(n || 0).toLocaleString('en-IN');

/* ---- the PDFs ---- */

/** A production list row in the order-sheet layout. group: the channel it is listed under; order: the ERP order to open. */
function rmLineCells(r, status, tone) {
  const l = r.line;
  return { tone: tone || '', img: l.img, group: l.channel, sku: l.sku, order: l.orderNo, pcs: r.qty, cells: [l.color || l.article, l.size, rmNf(r.qty), l.personal, null, l.sku, status,
    l.channel + ' · ' + (l.shopOrderNo || l.orderNo), rmShowDay(l.orderDate), rmShowDay(l.due), l.stage, l.priority] };
}
/** Red when late, yellow when stuck, green when the line is complete (no longer open in production). */
const rmToneOf = l => (l.lateDays > 0 ? 'late' : l.stuck ? 'stuck' : !l.open ? 'done' : '');

/** The period in words for a section note: '14/11/2026 – 17/11/2026'. */
const rmPeriodTxt = rep => rmShowDay(rep.win.fromDay) + ' – ' + rmShowDay(rep.win.lastDay);
/** A by-hand report counts only what happened in its period (rmOnlySince); its notes say so. */
const rmNote = (rep, today, since) => (rep.win.byHand ? since + ' ' + rmPeriodTxt(rep) : today);

function rmProductionSections(rep) {
  const p = rep.prod;
  return [
    { title: 'Came into production', note: 'opened in production ' + rmShowDay(rep.win.fromDay) + ' – ' + rmShowDay(rep.win.lastDay),
      rows: p.came.map(r => rmLineCells(r, 'Opened ' + rmShowDay(rmIstDay(r.line.openMs)), rmToneOf(r.line))) },
    { title: 'Started in production', note: rmNote(rep, 'open items with cutting, karigar issue or a printer recorded', 'first cutting, karigar issue or printer'),
      rows: p.started.map(r => rmLineCells(r, 'Started ' + rmShowDay(rmIstDay(r.line.startMs)), rmToneOf(r.line))) },
    { title: 'Late', note: rmNote(rep, 'past the decided date (Dispatch date column)', 'still open, decided date (Dispatch date column) fell'),
      rows: p.late.map(r => rmLineCells(r, 'Late ' + r.line.lateDays + ' day' + (r.line.lateDays === 1 ? '' : 's'), 'late')) },
    { title: 'Stuck', note: rmNote(rep, 'no work recorded for ' + RM_STUCK_DAYS + ' days or more', 'reached ' + RM_STUCK_DAYS + ' days without work'),
      rows: p.stuck.map(r => rmLineCells(r, 'No work ' + r.line.idleDays + ' days', 'stuck')) },
    { title: 'Ready and into finished goods', note: 'handed to shipping or received into the store ' + rmShowDay(rep.win.fromDay) + ' – ' + rmShowDay(rep.win.lastDay),
      rows: p.finished.map(r => rmLineCells(r, 'In ' + rmShowDay(r.day), rmToneOf(r.line))) },
  ];
}
/**
 * A Shopify line for the Shipping PDF; its order opens in the ERP when production made it (erpNo). With no tone given
 * (pending, ready) the row is red or yellow when its production line is late or stuck — the reason it has not gone.
 */
function rmShopCells(o, r, status, tone) {
  const fromProduction = r.prodTone === 'late' || r.prodTone === 'stuck' ? r.prodTone : '';
  return { tone: tone || fromProduction, img: r.img, group: o.store, sku: r.sku, order: r.erpNo, pcs: r.left || r.qty, cells: [r.name, r.variant, rmNf(r.left || r.qty), r.personal, null, r.sku, status, o.store + ' · ' + r.orderNo,
    rmShowDay(r.orderDate), rmShowDay(r.shippedAt), r.prodStage, r.priority] };
}
function rmFbaCells(r, status, tone) {
  const l = r.line || {};
  return { tone: tone || '', img: l.img || '', group: 'Amazon FBA', sku: r.sku, order: l.orderNo || '', pcs: r.qty, cells: [l.color || l.article || '', l.size || '', rmNf(r.qty), l.personal || '', null, r.sku, status,
    'Amazon FBA · ' + (r.account || '') + (l.orderNo ? ' · ' + l.orderNo : ''), rmShowDay(l.orderDate), rmShowDay(r.day), l.stage || '', l.priority || ''] };
}
function rmShippingSections(rep) {
  const s = rep.ship, items = (list, status, tone) => [].concat(...list.map(o => o.rows.map(r => rmShopCells(o, r, typeof status === 'function' ? status(o) : status, tone))));
  return [
    { title: 'Shipped', note: 'parcel sent ' + rmShowDay(rep.win.fromDay) + ' – ' + rmShowDay(rep.win.lastDay),
      rows: items(s.shop.shipped, o => 'Shipped via ' + o.via, 'done')
        .concat(s.amazon.shipped.map(r => rmFbaCells(r, 'Shipped to Amazon ' + r.shipment, 'done')))
        .concat(s.other.shipped.map(r => rmLineCells(r, 'Dispatched ' + rmShowDay(r.day), 'done'))) },
    { title: 'Shipped by MCF', note: 'Shopify orders sent from Amazon stock', rows: items(s.shop.mcf, 'Shipped via MCF', 'done') },
    { title: 'Pending', note: rmNote(rep, 'not shipped yet', 'ordered, not shipped yet:'),
      rows: items(s.shop.pending, 'Pending').concat(s.amazon.pending.map(r => rmLineCells(r, 'Not sent to FBA yet', rmToneOf(r.line))))
        .concat(s.other.pending.map(r => rmLineCells(r, 'Not dispatched yet', rmToneOf(r.line)))) },
    { title: 'Ready to dispatch', note: rmNote(rep, 'made, not shipped yet', 'became ready, not shipped yet:'),
      rows: items(s.shop.ready, 'Ready to dispatch').concat(s.amazon.ready.map(r => rmFbaCells(r, 'With FBA team, not shipped')))
        .concat(s.other.ready.map(r => rmLineCells(r, 'In store, not dispatched', ''))) },
  ];
}
/**
 * One PDF: a cover page for management (Ravi, 17 Nov: "the first page is not appealing … I have to show it to the boss")
 * — the company and report name, the date and period, a summary table of every section by channel, and the colour key —
 * then each section on its own pages, one row per SKU (Ravi, 17 Nov: "group them on the basis of skus", then "one row
 * per SKU"): see rmPdfSkuRow. imgSrc(url) → what the <img> loads, or ''.
 */
function rmPdfHtml(title, rep, sections, imgSrc) {
  const parts = sections.map((s, i) => ({ s, id: 's' + i, skus: rmSkuGroups(s.rows) }));
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + rmEsc(title) + ' report</title><style>' + RM_PDF_CSS + '</style></head><body>'
    + rmPdfCover(title, rep, parts)
    + parts.map(p => '<div class="sec" id="' + p.id + '"><div class="sech">' + rmEsc(title) + ' · <b>' + rmEsc(p.s.title) + '</b><span>'
      + rmNf(p.skus.length) + ' SKUs · ' + rmNf(p.s.rows.length) + ' items</span></div>'
      + '<div class="sub">' + rmEsc(p.s.note) + '</div>'
      + (p.skus.length ? rmPdfSkuTable(p.skus, imgSrc) : '<div class="sub">None in this period.</div>') + '</div>').join('')
    + '</body></html>';
}
const RM_PDF_CSS = '@page{size:A4 landscape;margin:12mm}body{font:9px Arial,Helvetica,sans-serif;color:#1d2430;margin:0}'
  + '.band{background:#1f3b63;color:#fff;padding:22px 26px}.band .co{font-size:12px;letter-spacing:3px;color:#c9d6ea}.band .doc{font-size:26px;font-weight:bold;margin-top:6px}'
  + '.meta{width:100%;border-collapse:collapse;margin:14px 0 4px}.meta td{padding:6px 10px;border:1px solid #d6dce6;font-size:11px}.meta td.k{background:#f2f5fa;color:#6b7380;width:12%}'
  + '.cap{font-size:13px;color:#1f3b63;margin:20px 0 6px;padding-bottom:4px;border-bottom:2px solid #3d6fb6}'
  + '.sum{width:100%;border-collapse:collapse;font-size:11px}.sum th{background:#1f3b63;color:#fff;padding:7px 8px;text-align:right;border:1px solid #1f3b63}.sum th:first-child{text-align:left}'
  + '.sum td{padding:7px 8px;border:1px solid #d6dce6;text-align:right}.sum td:first-child{text-align:left;font-weight:bold}.sum tr:nth-child(even) td{background:#f7f9fc}.sum a{color:#1d2430;text-decoration:none}'
  + '.sum td.tot{font-weight:bold;background:#eef2f8}.note{color:#6b7380;font-size:10px;margin-top:6px;line-height:1.5}'
  + '.key{border-collapse:collapse;font-size:11px}.key td{padding:6px 10px;border:1px solid #d6dce6}.key td.sw{width:60px}'
  + '.sec{page-break-before:always}.sech{background:#1f3b63;color:#fff;font-size:13px;padding:8px 12px}.sech span{float:right;font-size:11px;color:#c9d6ea}'
  + '.sub{color:#6b7380;margin:6px 0 8px}'
  + 'table.lines{border-collapse:collapse;width:100%;page-break-inside:auto}tr{page-break-inside:avoid}thead{display:table-header-group}'
  + 'table.lines th{background:#dbe5f4;border:1px solid #9aa9c2;padding:4px;text-align:left}table.lines td{border:1px solid #c3cad6;padding:2px 4px;vertical-align:middle;font-size:8.5px}'
  + 'td.img{width:24px;height:24px;padding:1px;text-align:center}td.img img{max-width:22px;max-height:22px}td.num{text-align:right;font-weight:bold}a{color:#1a4fa3}';
/** The cover: company, report name, date and period, the summary table and the colour key. */
function rmPdfCover(title, rep, parts) {
  const period = rmShowDay(rep.win.fromDay) + ' – ' + rmShowDay(rep.win.lastDay) + (rep.win.byHand ? '' : ' (since the last report)');
  return '<div class="band"><div class="co">FABRICRUSH · RIDHI HOME &amp; LIVING</div><div class="doc">' + rmEsc(title) + ' Report</div></div>'
    + '<table class="meta"><tr><td class="k">Report date</td><td>' + rmEsc(rmLongDay(rep.today)) + '</td><td class="k">Period</td><td>' + rmEsc(period) + '</td>'
    + '<td class="k">Source</td><td>Fabricrush ERP</td></tr></table>'
    + '<div class="cap">Summary</div>' + rmPdfSummary(parts)
    + '<div class="note">Counts are items (one SKU on one order). Click a section to go to its list. In the lists, each SKU is one row (most pieces first) with its '
    + 'total pieces and every order; click an order number to open that order in the ERP.</div>'
    + '<div class="cap">Colour key</div><table class="key">'
    + [['late', 'Late', 'past the decided completion date'], ['stuck', 'Stuck', 'work started, then nothing recorded for ' + RM_STUCK_DAYS + ' days or more'],
      ['done', 'Complete', 'handed to shipping, closed or shipped'], ['', 'Open', 'still in progress']]
      .map(([t, name, what]) => '<tr><td class="sw" style="background:' + RM_TONE[t] + '"></td><td><b>' + name + '</b></td><td>' + rmEsc(what) + '</td></tr>').join('')
    + '</table>';
}
/** Every section by channel: lines per channel, SKUs, total lines and pieces; the section name links to its list. */
function rmPdfSummary(parts) {
  const tally = new Map(), chOf = r => r.group || 'Other';
  parts.forEach(p => p.s.rows.forEach(r => tally.set(chOf(r), (tally.get(chOf(r)) || 0) + 1)));
  const channels = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(x => x[0]);
  const pcs = rows => rows.reduce((t, r) => t + (r.pcs || 0), 0);
  return '<table class="sum"><tr><th>Section</th>' + channels.map(c => '<th>' + rmEsc(c) + '</th>').join('') + '<th>SKUs</th><th>Total items</th><th>Pieces</th></tr>'
    + parts.map(p => '<tr><td><a href="#' + p.id + '">' + rmEsc(p.s.title) + '</a></td>' + channels.map(c => {
      const n = p.s.rows.filter(r => chOf(r) === c).length;
      return '<td>' + (n ? rmNf(n) : '–') + '</td>';
    }).join('') + '<td class="tot">' + rmNf(p.skus.length) + '</td><td class="tot">' + rmNf(p.s.rows.length) + '</td><td class="tot">' + rmNf(pcs(p.s.rows)) + '</td></tr>').join('') + '</table>';
}
/** Rows by SKU, the SKU with most pieces first; inside a SKU the rows keep their order (P1 first). */
function rmSkuGroups(rows) {
  const by = new Map();
  rows.forEach(r => { const k = r.sku || '(no SKU)'; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
  return [...by.entries()].map(([sku, list]) => ({ sku, rows: list, pcs: list.reduce((t, r) => t + (r.pcs || 0), 0),
    orders: new Set(list.map(r => r.order || r.cells[RM_ORDER_COL])).size }))
    .sort((a, b) => b.pcs - a.pcs || a.sku.localeCompare(b.sku));
}
/** One table for a section: the column heads repeat on every page; each SKU has a heading row, then its lines. */
/* ONE ROW PER SKU (Ravi, 17 Nov: "these are too many pages" → "Yes, one row per SKU"). Each SKU of a section is one row
 * in his order-sheet layout: its photo, total pieces, how many orders, every order number (each a link into the ERP),
 * the earliest order and decided dates, how its lines stand in production, and the most urgent priority. The row takes
 * the most urgent colour of its lines: late, then stuck, then open; green only when every line is complete. */
const RM_SKU_COLS = ['Colour name', 'Size', 'Total qty', 'Personalization', 'Image', 'SKU', 'Status', 'Orders', 'Order date', 'Dispatch date', 'Production status', 'Priority'];
const RM_TONE_RANK = ['late', 'stuck', '', 'done'];
function rmPdfSkuTable(skus, imgSrc) {
  return '<table class="lines"><thead><tr>' + RM_SKU_COLS.map(c => '<th>' + rmEsc(c) + '</th>').join('') + '</tr></thead><tbody>'
    + skus.map(g => rmPdfSkuRow(g, imgSrc)).join('') + '</tbody></table>';
}
function rmPdfSkuRow(g, imgSrc) {
  const rows = g.rows, first = rows[0], cell = i => rows.map(r => r.cells[i]);
  const src = rows.map(r => (r.img ? imgSrc(r.img) : '')).find(Boolean) || '';
  const tone = RM_TONE_RANK.find(t => rows.some(r => (r.tone || '') === t)) || '';
  const td = v => '<td>' + rmEsc(v) + '</td>';
  return '<tr style="background:' + RM_TONE[tone] + '">' + td(first.cells[0]) + td(first.cells[1]) + '<td class="num">' + rmNf(g.pcs) + '</td>'
    + td(rmFewOf(cell(3))) + '<td class="img">' + (src ? '<img src="' + rmEsc(src) + '">' : '') + '</td>' + '<td><b>' + rmEsc(g.sku) + '</b></td>'
    + td(rmFewOf(cell(6))) + '<td>' + rmNf(g.orders) + ': ' + rmPdfOrderLinks(rows) + '</td>'
    + td(rmEarliestDay(cell(8))) + td(rmEarliestDay(cell(9))) + td(rmTally(cell(10))) + td(rmBestPriority(cell(11))) + '</tr>';
}
/** Every order of the SKU once, each a link that opens it in the ERP when the ERP knows it. */
function rmPdfOrderLinks(rows) {
  const seen = new Map();
  rows.forEach(r => { const name = r.cells[RM_ORDER_COL]; if (!seen.has(name)) seen.set(name, r.order); });
  return [...seen.entries()].map(([name, order]) => (order
    ? '<a href="' + rmEsc(RM_ERP_ORDER_URL + encodeURIComponent(order)) + '">' + rmEsc(name) + '</a>' : rmEsc(name))).join(', ');
}
/** Up to two different values, then "+n more": "Late 3 days, Late 5 days +2 more". */
function rmFewOf(values) {
  const u = [...new Set(values.filter(Boolean))];
  return u.slice(0, 2).join(', ') + (u.length > 2 ? ' +' + (u.length - 2) + ' more' : '');
}
/** How many lines at each stage: "Not started 3, With karigar 1". */
function rmTally(values) {
  const by = new Map();
  values.filter(Boolean).forEach(v => by.set(v, (by.get(v) || 0) + 1));
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => (by.size === 1 && n === 1 ? v : v + ' ' + n)).join(', ');
}
/** The earliest of shown days (DD/MM/YYYY). */
function rmEarliestDay(values) {
  const key = v => String(v).split('/').reverse().join('');
  return values.filter(Boolean).sort((a, b) => key(a).localeCompare(key(b)))[0] || '';
}
/** The most urgent priority: P1 before P2 …; '' when none is set. */
const rmBestPriority = values => values.filter(Boolean).sort((a, b) => rmPriRank(a) - rmPriRank(b))[0] || '';
