/* ================= FBA DISPATCH: ONE LINE PER ARTICLE =================
 * Business rule (28 Nov, agreed): FBA Dispatch reads like the India Store. The FBA team sees one line per article, with the
 * pieces waiting, accepted and not shipped, shipped and returned, most still to do first; a line opens into its dispatches,
 * with the same columns and buttons as the "Every dispatch" view. Brand and FBA account filters, a search that says why it
 * found nothing, Air / Sea / AWD on each dispatch, the orders behind a figure, and how long accepted pieces have waited.
 * Nothing here changes a record.
 *
 *   Air / Sea / AWD = the lane of the FBA list that shipped it, else the mode of each order it names (the end of the order
 *   number, else the sales order). Not known: — (never taken as Air).
 *   The orders behind a figure = the orders the dispatch names, in the order named; pieces beyond them name no order. A
 *   return names no order, so the pieces still out are counted for the first orders named and the returned ones for the last.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, to the user — a ledger that cannot be read (fba-dispatch.js); sales orders that cannot be read are said on the
 *   screen's message line, as Air / Sea then comes from the order number alone.
 *   There is no quiet fallback here.
 *
 * BEHIND SWITCH storeAlloc (fg-store-alloc.js). Off: the screen is as it was. */
const FBV_LANE_HEAD = 'Air / Sea / AWD';
const FBV_NO_LANE = '—';
const FBV_NO_ACCOUNT = 'none';   // the account filter's value for a dispatch naming neither account
const FBV_NO_ORDER = 'No order named';
/** The figures of an article's line, in column order. */
const FBV_FIGURES = [['waiting', 'Waiting'], ['accepted', 'Accepted, not shipped'], ['shipped', 'Shipped'], ['returned', 'Returned'],
  ['sheet', 'From the sheet']];
/** How long ago accepted pieces were sent, youngest first. */
const FBV_AGES = [{ key: '0-7', label: '0–7 days', upTo: 7 }, { key: '8-30', label: '8–30 days', upTo: 30 },
  { key: '31-90', label: '31–90 days', upTo: 90 }, { key: 'over90', label: 'over 90 days', upTo: Infinity }];
const FBV_AGE_UNKNOWN = { key: 'unknown', label: 'sent date not known' };
let FBV = { open: new Set(), age: '' };   // the articles opened, and the age picked on the accepted line

const fbvOn = () => typeof fgaOn === 'function' && fgaOn();
const fbvByArticle = () => fbvOn() && $('fbvView').value !== 'dispatch';
const fbvSum = (list, of) => list.reduce((n, x) => n + of(x), 0);
const fbvWhat = m => [m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ');

/* ---- the filters ---- */
const fbvBrandOf = sku => String(fgiMaster(sku).brand || '').trim();
const fbvAccountOf = r => FGA_STORE_OF[r.issuedFor] || FBV_NO_ACCOUNT;
function fbvAgeOf(r) {
  const sent = pdIso(r.date) || fapDayOf(r);
  if (!sent) return FBV_AGE_UNKNOWN.key;
  const days = dDiff(sent, dTodayIndia());
  return FBV_AGES.find(a => days <= a.upTo).key;
}
/** Do the brand, account and age filters keep a dispatch? The picked age counts only while the screen lists accepted ones.
 *  over: { account, age } to count with in place of the screen's. */
function fbvKeeps(r, over) {
  const brand = $('fbvBrand').value;
  const account = over.account !== undefined ? over.account : $('fbvAccount').value;
  const age = over.age !== undefined ? over.age : ($('fbaStatus').value === 'accepted' ? FBV.age : '');
  return (!brand || fbvBrandOf(r.sku) === brand) && (!account || fbvAccountOf(r) === account) && (!age || fbvAgeOf(r) === age);
}
function fbvToolbar() {
  const off = !fbvOn();
  ['fbvView', 'fbvBrand', 'fbvAccount'].forEach(id => $(id).classList.toggle('hide', off));
  $('fbvAges').classList.add('hide');   // drawn again once the dispatches are in hand
}
function fbvFillBrands() {
  ptFillSelect('fbvBrand', [...new Set(fbaAll().map(r => fbvBrandOf(r.sku)).filter(Boolean))].sort().map(b => [b, b]), 'All brands');
}

/* ---- the orders a dispatch names, and its lane ---- */
const fbvSalesByNo = () => new Map(FGA_SALES.rows.map(o => [obUC(o._id), o]));
const fbvSalesNote = () => (FGA_SALES.err ? ' · The sales orders could not be read, so Air / Sea comes from the order number alone — press Refresh.' : '');
/** A dispatch's pieces by the order they name: [{ no, pcs }]; no = '' for the pieces that name none. */
function fbvParts(r) {
  let left = fgiNum(r.qty);
  const parts = fgiOutParts(r).map(p => { const pcs = Math.min(left, p.qty); left -= pcs; return { no: p.orderNo, pcs }; });
  return parts.concat({ no: '', pcs: left }).filter(p => p.pcs > 0);
}
function fbvOrderLane(orderNo, sales) {
  const mode = soShipMode(sales.get(orderNo) || { _id: orderNo });
  return FBLV_LANE_NAMES[mode.toLowerCase()] || FBV_NO_LANE;
}
/** The lanes of one dispatch, each once. */
function fbvLanesOf(r, sales) {
  if (FBLV_LANE_NAMES[r.fbaLane]) return [FBLV_LANE_NAMES[r.fbaLane]];
  const lanes = fbvParts(r).map(p => fbvOrderLane(p.no, sales));
  return lanes.length ? [...new Set(lanes)] : [FBV_NO_LANE];
}

/* ---- the figures ---- */
/** The pieces of a dispatch that one figure counts, as the tiles count them. 'sent' is all it was sent with. */
function fbvPiecesOf({ s }, figure) {
  if (figure === 'sent') return s.qty;
  if (figure === 'returned') return s.st === 'sheet' ? 0 : s.returned;
  return s.st === figure ? s.open : 0;
}
/** The dispatches added up by article, most pieces still to do first. */
function fbvArticles(rows) {
  const bySku = new Map();
  rows.forEach(x => { const sku = obUC(x.r.sku); if (!bySku.has(sku)) bySku.set(sku, []); bySku.get(sku).push(x); });
  const todo = a => a.waiting + a.accepted;
  return [...bySku].map(([sku, items]) => Object.assign({ sku, items },
    Object.fromEntries(FBV_FIGURES.map(([k]) => [k, fbvSum(items, x => fbvPiecesOf(x, k))]))))
    .sort((a, b) => todo(b) - todo(a) || a.sku.localeCompare(b.sku));
}
/** The dispatches of one article its opened line holds. */
const fbvInside = article => article.items.slice(0, FBA_LIST_LIMIT);
/** The dispatches the article table holds, opened or not. */
const fbvHeld = rows => fbvArticles(rows).slice(0, FBA_LIST_LIMIT).flatMap(fbvInside);
function fbvArticleLanes(article, sales) {
  const found = new Set(article.items.flatMap(x => fbvLanesOf(x.r, sales)));
  return Object.values(FBLV_LANE_NAMES).concat(FBV_NO_LANE).filter(lane => found.has(lane));
}
/** The figure columns shown: the sheet's history only when the list holds some. */
const fbvColumns = articles => FBV_FIGURES.filter(([k]) => k !== 'sheet' || articles.some(a => a.sheet));

/* ---- the article table ---- */
/** A figure that opens the orders behind it. of: the data attribute saying whose it is. */
const fbvFigureButton = (figure, of, pieces) => `<button class="ghost" data-fbv-fig="${figure}" ${of} title="See the orders these pieces are for"`
  + ` style="width:auto;padding:1px 7px;font-size:inherit;font-weight:inherit;color:inherit;text-decoration:underline">${nf(pieces)}</button>`;
const fbvDispatchFigure = (figure, id, pieces) => (pieces ? fbvFigureButton(figure, `data-fbv-id="${esc(id)}"`, pieces) : nf(pieces));
function fbvTickBox(article) {
  const can = fbvInside(article).filter(fbaActionable);
  if (!can.length) return '';
  const ticked = can.filter(x => FBA_PICK.has(fgiRowId(x.r))).length;
  return `<input type="checkbox" data-fbv-pick="${esc(article.sku)}"${ticked === can.length ? ' checked' : ''}`
    + ` aria-label="Tick every dispatch of ${esc(article.sku)} that can still be acted on">`
    + (ticked && ticked < can.length ? `<div class="muted" style="font-size:10.5px">${nf(ticked)} of ${nf(can.length)}</div>` : '');
}
function fbvInsideRow(article, view, span) {
  const shown = fbvInside(article);
  return `<tr><td colspan="${span}" style="text-align:left;padding:6px 10px 12px 34px"><table class="xl fbv-sub">`
    + fbaDispatchHead(view, '') + '<tbody>' + shown.map(x => fbaDispatchRow(x, view)).join('') + '</tbody></table>'
    + (article.items.length > shown.length ? `<div class="muted">Showing the first ${FBA_LIST_LIMIT} dispatches · Export in Every dispatch covers all of them</div>` : '')
    + '</td></tr>';
}
function fbvArticleRow(article, view, columns) {
  const { sku } = article, m = fgiMaster(sku), open = FBV.open.has(sku);
  const text = v => `<td style="text-align:left">${esc(v || '')}</td>`;
  const row = '<tr>'
    + (view.can ? `<td>${fbvTickBox(article)}</td>` : '')
    + `<td class="frz" style="text-align:left"><button class="ghost" data-fbv-open="${esc(sku)}" aria-expanded="${open}" title="Show or hide its dispatches"`
    + ` style="font-family:ui-monospace,monospace;padding:2px 7px;font-size:12.5px">${open ? '▾' : '▸'} ${esc(sku)}</button></td>`
    + ptImgCell(sku)
    + text(m.brand)
    + `<td style="text-align:left">${esc(m.subtype || m.articleType || '') || '<span class="muted">not in the master DB</span>'}</td>`
    + text(m.color) + text(m.size)
    + columns.map(([k]) => `<td class="num">${article[k] ? fbvFigureButton(k, `data-fbv-sku="${esc(sku)}"`, article[k]) : '<span class="muted">—</span>'}</td>`).join('')
    + `<td>${esc(fbvArticleLanes(article, view.sales).join(', '))}</td></tr>`;
  return open ? row + fbvInsideRow(article, view, fbvSpan(view, columns)) : row;
}
const FBV_NAME_COLS = ['SKU', 'Image', 'Brand', 'Item', 'Colour', 'Size'];
const fbvSpan = (view, columns) => (view.can ? 1 : 0) + FBV_NAME_COLS.length + columns.length + 1;
function fbvHead(view, columns, tick) {
  return '<thead><tr>' + (view.can ? `<th>${tick}</th>` : '')
    + FBV_NAME_COLS.map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('')
    + columns.map(([, label]) => `<th class="num">${label}</th>`).join('') + `<th>${FBV_LANE_HEAD}</th></tr></thead>`;
}
/** The totals of every article listed, those beyond the first lines too. */
function fbvTotals(articles, view, columns) {
  return '<tfoot><tr>' + (view.can ? '<td></td>' : '') + '<td class="frz" style="text-align:left">Total</td>'
    + `<td colspan="${FBV_NAME_COLS.length - 1}" style="text-align:left">${nf(articles.length)} article(s)</td>`
    + columns.map(([k]) => `<td class="num">${nf(fbvSum(articles, a => a[k]))}</td>`).join('') + '<td></td></tr></tfoot>';
}
/** The table with a line per article. Answers { note: the line above it, skus: whose pictures it shows }. */
function fbvDrawArticles(rows, view) {
  const articles = fbvArticles(rows), shown = articles.slice(0, FBA_LIST_LIMIT), columns = fbvColumns(articles);
  $('fbaTable').innerHTML = fbvHead(view, columns, view.can ? fbaTickAll(rows) : '') + '<tbody>'
    + (shown.length ? shown.map(a => fbvArticleRow(a, view, columns)).join('') : fbaNothingRow(fbvSpan(view, columns), view.sought))
    + '</tbody>' + (shown.length ? fbvTotals(articles, view, columns) : '');
  const note = `${nf(articles.length)} article(s), most pieces to do first · ${nf(rows.length)} dispatch(es)`
    + ` · ${nf(fbvSum(rows, x => x.s.open))} piece(s) not returned`
    + (articles.length > FBA_LIST_LIMIT ? ` · showing the first ${FBA_LIST_LIMIT} articles · Export covers all of them` : '')
    + fbaNoteEnd(view.history);
  return { note, skus: shown.map(a => a.sku) };
}
function fbvExport(rows) {
  const articles = fbvArticles(rows), columns = fbvColumns(articles), sales = fbvSalesByNo();
  const head = ['SKU', 'Brand', 'Item', 'Colour', 'Size', ...columns.map(c => c[1]), FBV_LANE_HEAD];
  ptDownload('fba-dispatch-by-article', [head].concat(articles.map(a => {
    const m = fgiMaster(a.sku);
    return [a.sku, m.brand || '', m.subtype || m.articleType || '', m.color || '', m.size || '', ...columns.map(([k]) => a[k]),
      fbvArticleLanes(a, sales).join(', ')];
  })).map(line => line.map(csvCell).join(',')));
}

/* ---- the orders behind a figure ---- */
/** Which of a dispatch's pieces a figure counts, by order: returned ones are the last named, all others the first. */
function fbvFigureParts(x, figure) {
  let skip = figure === 'returned' ? x.s.open : 0, take = fbvPiecesOf(x, figure);
  return fbvParts(x.r).map(p => {
    const passed = Math.min(skip, p.pcs), pcs = Math.min(take, p.pcs - passed);
    skip -= passed; take -= pcs;
    return { no: p.no, pcs };
  }).filter(p => p.pcs > 0);
}
/** The orders behind a figure of these dispatches: [{ no, channel, on, pcs }], oldest order first, no order last. */
function fbvOrders(items, figure) {
  const pieces = new Map();
  items.flatMap(x => fbvFigureParts(x, figure)).forEach(p => pieces.set(p.no, (pieces.get(p.no) || 0) + p.pcs));
  const days = new Map([...fbvSalesByNo()].map(([no, o]) => [no, pdIso(o.orderDate)]));
  ordLines().forEach(l => { if (pieces.has(l.orderNo)) days.set(l.orderNo, pdIso(l.orderDate)); });
  const rank = o => (o.no ? o.on || '9999' : '99999');
  return [...pieces].map(([no, pcs]) => ({ no, pcs, on: days.get(no) || '',
    channel: no ? ORD_PLAT_SRC[no.split('-')[0]] || 'Other' : '' }))
    .sort((a, b) => rank(a).localeCompare(rank(b)) || a.no.localeCompare(b.no));
}
function fbvOrderRow(o) {
  const cell = v => `<td style="text-align:left;white-space:nowrap">${esc(v || '—')}</td>`;
  return '<tr>' + cell(o.no || FBV_NO_ORDER) + cell(o.channel) + cell(fgiDmy(o.on)) + `<td class="num">${nf(o.pcs)}</td></tr>`;
}
/** The read-only box a figure opens, from the dispatches the screen is showing. whose: { sku } or { id }. */
function fbvOrdersOpen(figure, whose) {
  const items = (FBA.shown || []).filter(x => (whose.id ? fgiRowId(x.r) === whose.id : obUC(x.r.sku) === whose.sku))
    .filter(x => fbvPiecesOf(x, figure) > 0);
  if (!items.length) return;
  const sku = obUC(items[0].r.sku), found = FBV_FIGURES.find(f => f[0] === figure);
  ptOpenDialog({
    title: found ? `Orders for the pieces: ${found[1]}` : 'Orders for the pieces sent',
    subtitle: [sku, fbvWhat(fgiMaster(sku))].filter(Boolean).join(' · '),
    note: `${nf(fbvSum(items, x => fbvPiecesOf(x, figure)))} piece(s) in ${nf(items.length)} dispatch(es).`
      + (items.some(x => x.s.returned) ? ' A return names no order, so returned pieces are counted for the last orders a dispatch names.' : ''),
    wide: true,
    html: fgaOrdersTable(['Pieces'], fbvOrders(items, figure).map(fbvOrderRow)),
  });
}

/* ---- a search that finds nothing ---- */
/** Why a search does not list what was typed, or ''. A whole SKU code is judged first. rows: the dispatches listed. */
function fbvSearchNote(typed, rows) {
  const text = typed.trim(), code = obUC(text);
  if (!code || rows.some(x => obUC(x.r.sku) === code)) return '';
  if (fbaAll().some(r => obUC(r.sku) === code)) return `SKU ${code} is in FBA Dispatch but hidden by the filters.`;
  if (mdbOf(code)) return `SKU ${code} is not in FBA Dispatch.`;
  return rows.length ? '' : fbvNoMatchNote(text);
}
/** Why a search that is no SKU's code lists nothing. "Does not exist" is said only when the Master Database was read. */
function fbvNoMatchNote(text) {
  const q = text.toLowerCase(), master = PTG.mdb || [];
  if (fbaAll().some(r => fbaMatches(r, q))) return 'Matching dispatches are in FBA Dispatch but hidden by the filters.';
  if (master.some(m => fgiMatches(m, q))) return 'Matching products are not in FBA Dispatch.';
  if (!master.length) return `"${text}" could not be checked — the Master Database was not read. Press Refresh to try again.`;
  if (/^FBA[0-9A-Z]{6,}$/i.test(text)) return `No dispatch carries the shipment id ${obUC(text)}.`;
  /* Words are not a SKU code, so they are not called a missing SKU: a code has no space and holds a digit or a dash. */
  return /^\S*[\d-]\S*$/.test(text) ? `SKU ${obUC(text)} does not exist.` : `Nothing in the Master Database matches "${text}".`;
}

/* ---- accepted and not shipped: how long, and whose ---- */
function fbvChip(attr, key, label, pieces, picked) {
  return `<button class="ghost" ${attr}="${esc(key)}" aria-pressed="${picked}" style="width:auto;padding:2px 10px;margin:0 6px 4px 0;font-size:12px`
    + `${picked ? ';background:var(--accent-bg);color:var(--accent);font-weight:700' : ''}">${esc(label)}: <b>${nf(pieces)}</b></button>`;
}
function fbvAgeChips(rows, status) {
  return FBV_AGES.concat(FBV_AGE_UNKNOWN).map(a => {
    const pieces = fbvSum(rows.filter(x => fbvAgeOf(x.r) === a.key), x => x.s.open), picked = status === 'accepted' && FBV.age === a.key;
    return pieces || picked || a !== FBV_AGE_UNKNOWN ? fbvChip('data-fbv-age', a.key, a.label, pieces, picked) : '';
  }).join('');
}
function fbvAccountChips(rows, status) {
  return Object.values(FGA_STORE_OF).map(s => [s, s]).concat([[FBV_NO_ACCOUNT, 'not named']]).map(([key, label]) => {
    const pieces = fbvSum(rows.filter(x => fbvAccountOf(x.r) === key), x => x.s.open);
    const picked = status === 'accepted' && $('fbvAccount').value === key;
    return pieces || picked || key !== FBV_NO_ACCOUNT ? fbvChip('data-fbv-acct', key, label, pieces, picked) : '';
  }).join('');
}
/** Each count follows the search, brand and dates, and the other pick, so a press lists exactly the pieces it says. */
function fbvDrawAges() {
  const byAge = fbaRows({ status: 'accepted', age: '' }), byAccount = fbaRows({ status: 'accepted', account: '' });
  const status = $('fbaStatus').value;
  $('fbvAges').classList.toggle('hide', !byAge.length && !byAccount.length);
  $('fbvAges').innerHTML = '<b>Accepted, not shipped</b> <span class="muted">— press a figure to list those pieces, then Export or Ship them. Pressing changes nothing.</span>'
    + `<div style="margin-top:6px"><span class="muted">Days since sent </span>${fbvAgeChips(byAge, status)}</div>`
    + `<div><span class="muted">FBA account </span>${fbvAccountChips(byAccount, status)}</div>`;
}
/** A press on the accepted line: list those pieces, or take the pick off again. */
function fbvAgesClick(e) {
  const age = e.target.closest('[data-fbv-age]'), account = e.target.closest('[data-fbv-acct]');
  if (!age && !account) return;
  const accepted = $('fbaStatus').value === 'accepted';
  if (age) {
    const key = age.getAttribute('data-fbv-age');
    FBV.age = accepted && FBV.age === key ? '' : key;
  } else {
    const key = account.getAttribute('data-fbv-acct');
    $('fbvAccount').value = accepted && $('fbvAccount').value === key ? '' : key;
    if (!accepted) FBV.age = '';
  }
  $('fbaStatus').value = 'accepted';
  renderFba();
}

/* ---- presses on the table ---- */
function fbvTickArticle(sku, on) {
  const article = fbvArticles(FBA.shown || []).find(a => a.sku === sku);
  if (!article) return;
  fbvInside(article).filter(fbaActionable).forEach(x => { if (on) FBA_PICK.add(fgiRowId(x.r)); else FBA_PICK.delete(fgiRowId(x.r)); });
}
function fbvTableClick(e) {
  const open = e.target.closest('[data-fbv-open]');
  if (open) {
    const sku = open.getAttribute('data-fbv-open');
    if (!FBV.open.delete(sku)) FBV.open.add(sku);
    return renderFba();
  }
  const pick = e.target.closest('[data-fbv-pick]');
  if (pick) { fbvTickArticle(pick.getAttribute('data-fbv-pick'), pick.checked); return renderFba(); }
  const fig = e.target.closest('[data-fbv-fig]');
  if (fig) fbvOrdersOpen(fig.getAttribute('data-fbv-fig'), { sku: fig.getAttribute('data-fbv-sku'), id: fig.getAttribute('data-fbv-id') });
}
$('fbaTable').addEventListener('click', fbvTableClick);
$('fbvAges').addEventListener('click', fbvAgesClick);
['fbvView', 'fbvBrand', 'fbvAccount'].forEach(id => $(id).addEventListener('change', renderFba));
