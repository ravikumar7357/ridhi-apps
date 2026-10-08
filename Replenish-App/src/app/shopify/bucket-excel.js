/* ================= THE BUCKET IN EXCEL ================= */
const SHB_XL_COLS = ['Line ID', 'Section', 'Shopify order', 'Order date', 'Store', 'SKU', 'Item', 'Qty', 'In FBA', 'In India', 'Why', 'Open', 'Reason (stock-covered lines)'];
function shpBucketSheetRows(list) {
  return [SHB_XL_COLS].concat((list || shpBucket()).map(x => [x.key, x.kind === 'make' ? 'Needs production' : 'Stock says it can fill',
    x.o.no || '', String(x.o.at || '').slice(0, 10), x.o.shopBrand === 'CPC' || /cpc/i.test(String(x.o.channel || '')) ? 'CPC' : 'Ridhi',
    x.sku, x.name || '', x.qty, x.fba == null ? '' : x.fba, x.india == null ? '' : x.india, x.why || '', '', '']));
}
function shpBucketXlOut() {
  const rows = shpBucketSheetRows();
  const bytes = recipeXlsx(rows, { name: 'Bucket', freeze: 2, cols: {}, list: { name: 'OpenYN', values: ['yes', 'no'], cols: [SHB_XL_COLS.indexOf('Open')] } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'production-bucket-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
/** A filled sheet → { keys, reasons, skipped } — rows marked yes, each with its own reason. */
function shpBucketXlRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const H = rows[0].map(h => String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().toLowerCase());
  const iK = H.indexOf('line id'), iO = H.indexOf('open'), iR = H.findIndex(h => /^reason/.test(h));
  const iOrd = H.indexOf('shopify order'), iSku = H.indexOf('sku');
  if (iK < 0 || iO < 0) return { err: 'The file needs the "Line ID" and "Open" columns — download the bucket as Excel and fill that one.' };
  const inBucket = new Map(shpBucket().map(x => [x.key, x]));
  const keys = [], reasons = new Map(), skipped = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [], cell = j => (j >= 0 && r[j] != null ? String(r[j]).trim() : '');
    const key = cell(iK);
    if (!key || !/^(y|yes|open|1|true)$/i.test(cell(iO))) continue;
    if (!inBucket.has(key)) { skipped.push('row ' + (i + 1) + ' (' + (cell(iOrd) || '?') + ' ' + (cell(iSku) || '') + ') is not in the bucket any more — already open, shipped or cancelled'); continue; }
    keys.push(key);
    if (cell(iR)) reasons.set(key, cell(iR));
  }
  return { keys, reasons, skipped, list: keys.map(k => inBucket.get(k)) };
}
async function shpBucketXlIn(file) {
  if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const rd = shpBucketXlRead(rows);
    if (rd.err) { soMsg(rd.err, true); return; }
    if (!rd.keys.length) { soMsg('No row in that file says Open = yes' + (rd.skipped.length ? ' · ' + rd.skipped.length + ' row(s) are no longer in the bucket' : '') + '.', true); return; }
    const cov = rd.list.filter(x => x.kind === 'covered'), miss = cov.filter(x => !rd.reasons.get(x.key));
    ptOpenDialog({
      title: 'Open from Excel',
      subtitle: `${nf(rd.keys.length)} line(s) · ${nf(new Set(rd.list.map(x => x.id)).size)} Shopify order(s) · ${nf(rd.list.reduce((t, x) => t + x.qty, 0))} qty`,
      note: 'Each line goes through the same check as ticking it: a line already open is skipped, and a stock-covered line needs its reason.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + `<b>${nf(rd.keys.length - cov.length)}</b> need production · <b>${nf(cov.length)}</b> stock says it can fill`
        + (miss.length ? `<div class="err">${nf(miss.length)} stock-covered line(s) have no reason — fill "Reason" for them, or they will not open: ${esc(miss.slice(0, 6).map(x => x.o.no + ' ' + x.sku).join(', '))}${miss.length > 6 ? ' …' : ''}</div>` : '')
        + (rd.skipped.length ? `<div style="margin-top:6px">${nf(rd.skipped.length)} row(s) left alone: ${esc(rd.skipped.slice(0, 5).join(' · '))}${rd.skipped.length > 5 ? ' …' : ''}</div>` : '')
        + '</div>',
      saveLabel: `Open ${nf(rd.keys.length)} line(s)`,
      onSave: async () => {
        const err = await shpBucketRun(rd.keys, rd.reasons);
        if (err) return err;
        const L = SHP_BUCKET_LAST || {};
        soMsg(`Opened ${nf(L.lines || 0)} production line(s) · ${nf(L.pcs || 0)} piece(s) across ${nf(L.orders || 0)} Shopify order(s) from Excel.`
          + ((L.skipped || []).length ? ' Skipped: ' + L.skipped.join(' · ') : ''));
        try { renderShop(); } catch (e) { /* not on that tab */ }
        return '';
      },
    });
  } catch (e) { soMsg('Could not read the file: ' + (e.message || e), true); }
}

/** The bucket, on screen — design 7, the header band. SHB holds the tab, the filters and what is ticked. */
let SHB = { tab: 'make', q: '', store: '', date: '', from: '', ship: '', picked: new Set(), rpicked: new Set(), rqty: {} };
const shbStore = o => (o.shopBrand === 'CPC' || /cpc/i.test(String(o.channel || '')) ? 'CPC' : 'Ridhi');
/** Lines opened from the bucket today, for the third tab. */
function shbOpenedToday() {
  const today = dToday();
  const seen = new Set();
  return (PTG.ob || []).filter(r => r && r.openedFrom === 'bucket' && ptIsoDate(r.openedAt) === today && !seen.has(r.id) && seen.add(r.id));
}
function shbRows(list) {
  const q = SHB.q.trim().toLowerCase(), now = Date.now();
  const days = { today: 1, d7: 7, d30: 30 }[SHB.date], older = SHB.date === 'older7';
  return list.filter(x => (x.kind === SHB.tab)
    && (!SHB.store || shbStore(x.o) === SHB.store)
    /* WHERE THE STOCK IS (Ravi, 2026-09-27: "jo order FBA se fulfill kar rahe uska filter"). Only the stock-covered tab
     * has an answer; on the others the filter is hidden and ignored. */
    && (SHB.tab !== 'covered' || !SHB.from || x.from === SHB.from)
    && (!q || [x.o.no, x.sku, x.name, x.why].join(' ').toLowerCase().includes(q))
    && (!SHB.date || (ms => !ms ? true : older ? now - ms > 7 * 864e5 : now - ms <= days * 864e5)(ptDtMs(x.o.at))));
}
function shbRender() {
  const list = SHB.list || [];
  const nMake = list.filter(x => x.kind === 'make').length, nCov = list.filter(x => x.kind === 'covered').length, done = shbOpenedToday();
  const ready = typeof shpReadyLines === 'function' ? shpReadyLines() : [];
  const hand = typeof shpHandRegister === 'function' ? shpHandRegister() : [];
  document.querySelectorAll('[data-shbtab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-shbtab') === SHB.tab));
  const lab = { make: `Needs production · ${nf(nMake)}`, covered: `Stock says it can fill · ${nf(nCov)}`, done: `Opened today · ${nf(done.length)}`,
    recv: `From production · ${nf(ready.length)}`, hand: `Handed over · ${nf(hand.length)}` };
  document.querySelectorAll('[data-shbtab]').forEach(b => { b.textContent = lab[b.getAttribute('data-shbtab')]; });
  if ($('shbWhyWrap')) $('shbWhyWrap').classList.toggle('hide', SHB.tab !== 'covered');
  if ($('shbFrom')) $('shbFrom').classList.toggle('hide', SHB.tab !== 'covered');
  if ($('shbShip')) $('shbShip').classList.toggle('hide', SHB.tab !== 'hand');
  if ($('shbHandTot')) $('shbHandTot').classList.toggle('hide', SHB.tab !== 'hand');
  if ($('ptDlgSave')) $('ptDlgSave').classList.toggle('hide', SHB.tab === 'hand');
  const stockCell = (n, need) => n == null ? '<span class="muted">—</span>' : `<b class="${n >= need ? 'ok' : 'no'}">${nf(n)}</b>`;
  const itemCell = (name, img, sub) => `<div class="shb-item">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<div><b>${esc(name || '—')}</b>${sub ? `<div class="muted" style="font-size:11px">${esc(sub)}</div>` : ''}</div></div>`;
  let head, body;
  if (SHB.tab === 'hand') {
    /* THE HANDED-OVER REGISTER: every hand-over to shipping, the day it happened, and whether the parcel has left. */
    if (typeof ORD !== 'undefined' && !ORD.shopTrk && !ORD.shopTrkBusy && typeof ordTrackShopLoad === 'function') {
      ordTrackShopLoad().then(() => { if (SHB.tab === 'hand' && $('shbTable')) shbRender(); }).catch(() => {});
    }
    const q = String(SHB.q || '').trim().toLowerCase(), now = Date.now();
    const days = { today: 1, d7: 7, d30: 30 }[SHB.date], older = SHB.date === 'older7', today = dToday();
    const rows = hand.filter(h => (!SHB.store || h.store === SHB.store)
      && (!q || [h.shop, h.orderNo, h.sku, h.item, h.by, h.acceptedBy].join(' ').toLowerCase().includes(q))
      && (!SHB.date || (SHB.date === 'today' ? h.day === today : !h.ms ? true : older ? now - h.ms > 7 * 864e5 : now - h.ms <= days * 864e5))
      && (!SHB.ship || (s => SHB.ship === 'waiting' ? s === 'waiting' || s === 'unknown' : s === SHB.ship)(shpHandShip(h).state)));
    SHB.hshown = rows;
    const t = shpHandTotals(hand), ts = shpHandTotals(rows);
    if ($('shbHandTot')) $('shbHandTot').innerHTML = `<div class="shb-n"><b>${nf(t.todayPcs)}</b><span>pcs today · ${nf(t.todayN)} hand-over(s)</span></div>`
      + `<div class="shb-n"><b>${nf(t.weekPcs)}</b><span>pcs this week (from ${esc(typeof dShow === 'function' ? dShow(t.weekFrom) : t.weekFrom)})</span></div>`
      + `<div class="shb-n"><b style="color:${t.waitPcs ? '#9a3412' : 'inherit'}">${nf(t.waitPcs)}</b><span>pcs handed over, not shipped · ${nf(t.waitLines)} line(s)</span></div>`
      + (t.unknown ? `<div class="shb-n"><b class="muted">${nf(t.unknown)}</b><span>line(s) Shopify has not answered for yet</span></div>` : '')
      + `<span class="muted" style="font-size:12px">${nf(rows.length)} shown · ${nf(ts.weekPcs)} pcs of them this week</span>`
      + '<button type="button" id="shbHandXl">Download Excel</button>';
    if ($('shbHandXl')) $('shbHandXl').onclick = () => shpHandXlOut(SHB.hshown || rows);
    const tone = { shipped: '#166534', cancelled: '#991b1b', waiting: '#9a3412', unknown: '#6b7280' };
    head = '<th>Handed over</th><th>Shopify order</th><th>Store</th><th>SKU</th><th>Item</th><th class="num">Pcs</th><th>By</th><th>Accepted by</th><th>Shopify</th><th>Tracking</th>';
    body = rows.slice(0, 400).map(h => {
      const s = shpHandShip(h);
      return `<tr><td style="white-space:nowrap">${esc(h.day ? (typeof dShow === 'function' ? dShow(h.day) : h.day) : '—')} <span class="muted">${esc(String(h.at || '').slice(11, 16))}</span></td>`
        + `<td style="text-align:left;white-space:nowrap"><b>${esc(h.shop)}</b><div class="muted" style="font-size:11px">${esc(h.orderNo)}</div></td>`
        + `<td>${esc(h.store)}</td><td style="font-family:ui-monospace,monospace">${esc(h.sku)}</td>`
        + `<td>${itemCell(h.item, h.img, h.lineDone ? '' : 'part — ' + nf(h.qty) + ' ordered')}</td><td class="num"><b>${nf(h.pcs)}</b></td>`
        + `<td>${h.by ? esc(ordWho(h.by)) + '<div class="muted" style="font-size:10.5px">Completed in Order Console</div>' : '<span class="muted">—</span>'}</td>`
        + `<td>${h.acceptedBy ? esc(ordWho(h.acceptedBy)) : '<span class="muted">—</span>'}</td>`
        + `<td style="color:${tone[s.state]};font-weight:600;white-space:nowrap">${esc(s.word)}</td>`
        + `<td style="text-align:left;font-size:12px">${s.w && typeof soTrkCell === 'function' ? soTrkCell(s.w, esc) : '<span class="muted">—</span>'}</td></tr>`;
    }).join('') + (rows.length > 400 ? `<tr><td colspan="10" class="muted" style="padding:10px">Showing the newest 400 of ${nf(rows.length)} — narrow it with the date or search, or download Excel (it has all of them).</td></tr>` : '');
  } else if (SHB.tab === 'recv') {
    /* WHAT PRODUCTION HAS READY, for the shipping team to take. */
    const q = String(SHB.q || '').trim().toLowerCase();
    const rows = ready.filter(x => !q || [x.shop, x.orderNo, x.sku, x.l.articleSubtype, x.l.color].join(' ').toLowerCase().includes(q));
    SHB.rshown = rows;
    SHB.rpicked = new Set([...(SHB.rpicked || new Set())].filter(k => rows.some(x => x.key === k)));
    SHB.rqty = SHB.rqty || {};
    const allOn = rows.length && rows.every(x => SHB.rpicked.has(x.key));
    head = `<th><input type="checkbox" data-shbrall="1"${allOn ? ' checked' : ''} title="Tick every line shown" style="width:auto"></th>`
      + '<th>Shopify order</th><th>SKU</th><th>Item</th><th class="num">Ordered</th><th class="num">Made</th><th class="num">Taken so far</th><th class="num">Arrived now</th><th></th>';
    body = rows.slice(0, 300).map(x => `<tr${SHB.rpicked.has(x.key) ? ' class="on"' : ''}><td><input type="checkbox" data-shbr="${esc(x.key)}"${SHB.rpicked.has(x.key) ? ' checked' : ''} style="width:auto"></td>`
      + `<td style="text-align:left;white-space:nowrap"><b>${esc(x.shop)}</b><div class="muted" style="font-size:11px">${esc(x.orderNo)}</div></td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(x.sku)}</td>`
      + `<td>${itemCell([x.l.articleSubtype || x.l.articleType || x.l.itemName, x.l.color, x.l.size].filter(Boolean).join(' · '), x.l.shopImg, '')}</td>`
      + `<td class="num">${nf(x.qty)}</td><td class="num" style="color:#166534;font-weight:700">${nf(x.made)}</td><td class="num">${x.got ? nf(x.got) : '<span class="muted">—</span>'}</td>`
      + `<td class="num"><input type="number" min="0" max="${x.qty - x.got}" step="1" data-shbq="${esc(x.key)}" value="${esc(SHB.rqty[x.key] != null ? SHB.rqty[x.key] : x.ready)}" style="width:72px;text-align:right"></td>`
      + `<td>${typeof ordCanClose === 'function' && ordCanClose() ? `<a href="#" data-ordclose="${esc(obUC(x.orderNo) + '|' + obUC(x.sku))}" style="font-size:12px" title="Sent to the customer from stock, or not needed — close the production line">close</a>` : ''}</td></tr>`).join('');
  } else if (SHB.tab === 'done') {
    head = '<th>Shopify order</th><th>SKU</th><th>Item</th><th class="num">Qty</th><th>Opened by</th><th>Note</th>';
    body = done.map(r => `<tr><td style="text-align:left"><b>${esc(r.shopOrderNo || r.orderNo)}</b><div class="muted" style="font-size:11px">${esc(r.orderNo)}</div></td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(r.sku)}</td><td>${itemCell([r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · '), r.shopImg, '')}</td>`
      + `<td class="num"><b>${nf(r.qty)}</b></td><td>${esc(String(r.openedBy || '').split('@')[0])} <span class="muted">${esc(String(r.openedAt || '').slice(11, 16))}</span></td>`
      + `<td style="text-align:left;font-size:12px;white-space:normal">${r.forced ? '<span class="pill pill-low">opened anyway</span> ' + esc(r.forcedWhy || '') : ''}</td></tr>`).join('');
  } else {
    const rows = shbRows(list);
    SHB.shown = rows;
    const allOn = rows.length && rows.every(x => SHB.picked.has(x.key));
    head = `<th><input type="checkbox" data-shball="1"${allOn ? ' checked' : ''} title="Tick every line shown" style="width:auto"></th>`
      + '<th>Shopify order</th><th>SKU</th><th>Item</th><th class="num">Qty</th><th class="num">In FBA</th><th class="num">In India</th><th>Why</th>';
    body = rows.slice(0, 300).map(x => `<tr${SHB.picked.has(x.key) ? ' class="on"' : ''}><td><input type="checkbox" data-shb="${esc(x.key)}"${SHB.picked.has(x.key) ? ' checked' : ''} style="width:auto"></td>`
      + `<td style="text-align:left;white-space:nowrap"><b>${esc(x.o.no)}</b><div class="muted" style="font-size:11px">${esc(String(x.o.at || '').slice(0, 10))} · ${shbStore(x.o)}</div></td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(x.sku)}${x.adj ? '<div class="muted" style="font-size:10.5px">' + esc(x.adj) + '</div>' : ''}</td>`
      + `<td>${itemCell(x.name, x.img, '')}</td><td class="num"><b>${nf(x.qty)}</b></td>`
      + `<td class="num shb-stock">${stockCell(x.fba, x.qty)}</td><td class="num shb-stock">${stockCell(x.india, x.qty)}</td>`
      + `<td style="text-align:left;white-space:normal;font-size:12px;min-width:200px" class="muted">${esc(x.why)}</td></tr>`).join('')
      + (rows.length > 300 ? `<tr><td colspan="8" class="muted" style="padding:10px">Showing the first 300 of ${nf(rows.length)} — narrow it with the search, store or date, or use Excel. Tick all ticks every line that matches, not only these.</td></tr>` : '');
  }
  $('shbTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="10" class="muted" style="padding:16px">${SHB.tab === 'done' ? 'Nothing opened from the bucket today.' : SHB.tab === 'hand' ? 'Nothing handed over that matches.' : 'Nothing here.'}</td></tr>`}</tbody>`;
  if (SHB.tab === 'hand') {
    if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = '<span class="vo-tot">A record of what shipping has taken — nothing to save here. Partial receipts each show on their own day.</span>';
    return;
  }
  if ($('shbWhyWrap') && SHB.tab === 'recv') $('shbWhyWrap').classList.add('hide');
  if (SHB.tab === 'recv') {
    const rp = (SHB.rshown || []).filter(x => SHB.rpicked.has(x.key));
    const pcsR = rp.reduce((t, x) => t + (Number(SHB.rqty[x.key] != null ? SHB.rqty[x.key] : x.ready) || 0), 0);
    if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = `<span class="vo-tot"><b>${nf(rp.length)} ticked</b> · ${nf(pcsR)} pcs arriving · a line is handed over once all of it is in</span>`;
    if ($('ptDlgSave')) { $('ptDlgSave').textContent = rp.length ? `Accept ${nf(pcsR)} pcs` : 'Accept ticked'; $('ptDlgSave').disabled = !rp.length; }
    return;
  }
  const picked = list.filter(x => SHB.picked.has(x.key));
  const pcs = picked.reduce((t, x) => t + (Number(x.qty) || 0), 0), cov = picked.filter(x => x.kind === 'covered').length;
  if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = `<span class="vo-tot"><b>${nf(picked.length)} ticked</b> · ${nf(pcs)} pcs${cov ? ` · ${nf(cov)} stock-covered (reason needed)` : ''} · a line already open is skipped, never opened twice</span>`;
  if ($('ptDlgSave')) { $('ptDlgSave').textContent = picked.length ? `Open ${nf(picked.length)} production line${picked.length === 1 ? '' : 's'}` : 'Open ticked production lines'; $('ptDlgSave').disabled = !picked.length; }
}
function shpHandXlOut(rows) {
  const bytes = recipeXlsx(shpHandSheetRows(rows), { name: 'Handed over', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'handed-over-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
function shpBucketOpen() {
  /* TAKING GOODS FROM PRODUCTION NEEDS NO STOCK (2026-09-28): without the stock read, the bucket still opens on its
   * From production tab; only the two tabs that judge stock wait for it. */
  const stockOk = SHOP_STOCK_LOADED && SHOP_INDIA_LOADED && !SHOP_INDIA_ERR;
  const nReady = typeof shpReadyLines === 'function' ? shpReadyLines().length : 0;
  const nHand = typeof shpHandRegister === 'function' ? shpHandRegister().length : 0;
  if (!stockOk && !nReady && !nHand) { soMsg(SHOP_STOCK_DENIED ? SHOP_STOCK_DENIED_TXT : 'Stock has not been read yet — press Fetch orders, then open the bucket.', true); return; }
  if (!stockOk && SHB.tab !== 'hand') SHB.tab = nReady ? 'recv' : 'hand';

  const list = stockOk ? shpBucket() : [];
  SHB = Object.assign(SHB, { list, picked: new Set([...SHB.picked].filter(k => list.some(x => x.key === k))) });
  const nMake = list.filter(x => x.kind === 'make').length, nCov = list.filter(x => x.kind === 'covered').length;
  ptOpenDialog({
    title: 'Shopify → production',
    wide: true,
    boxClass: 'vo-band',
    titleExtra: `<div class="shb-band"><span class="shb-t">Production bucket</span>
        <div class="shb-n"><b>${nf(nMake)}</b><span>need production</span></div>
        <div class="shb-n"><b>${nf(nCov)}</b><span>stock says it can fill</span></div>
        <div class="shb-n"><b>${nf(shbOpenedToday().length)}</b><span>opened today</span></div>
        <button type="button" id="shbXlOut">Download Excel</button></div>`,
    html: `<div class="shb-bar"><div class="seg" role="tablist">
        <button type="button" class="segbtn" data-shbtab="make"></button><button type="button" class="segbtn" data-shbtab="covered"></button><button type="button" class="segbtn" data-shbtab="done"></button><button type="button" class="segbtn" data-shbtab="recv" title="What production has made and pressed — fill in what arrived and accept"></button><button type="button" class="segbtn" data-shbtab="hand" title="Every hand-over to shipping: the day, the pieces, who took them, and whether Shopify has shipped it"></button></div>
        <input id="shbQ" placeholder="Search order / SKU / item" value="${esc(SHB.q)}">
        <select id="shbStore"><option value="">All stores</option><option value="Ridhi">Ridhi</option><option value="CPC">CPC</option></select>
        <select id="shbFrom" title="Where the stock that can fill it is"><option value="">FBA or India</option><option value="fba">FBA can fill (MCF)</option><option value="india">India can fill</option></select>
        <select id="shbShip" class="hide" title="Has the parcel left?"><option value="">Shipped or not</option><option value="waiting">Handed over, not shipped</option><option value="shipped">Shipped</option><option value="cancelled">Cancelled</option></select>
        <select id="shbDate"><option value="">Any date</option><option value="today">Today</option><option value="d7">Last 7 days</option><option value="d30">Last 30 days</option><option value="older7">Older than 7 days</option></select>
      </div>
      <label id="shbWhyWrap" class="shb-why hide"><span>Why make these anyway</span>
        <input id="shbWhy" placeholder="e.g. India stock is not really there — needed for every stock-covered line you tick"></label>
      <div id="shbHandTot" class="shb-band shb-handtot hide"></div>
      <div class="xlwrap shb-wrap"><table class="xl" id="shbTable"></table></div>`,
    saveLabel: 'Open ticked production lines',
    onSave: async () => {
      if (SHB.tab === 'recv') {
        const items = (SHB.rshown || []).filter(x => SHB.rpicked.has(x.key)).map(x => ({ orderNo: x.orderNo, sku: x.sku, qty: SHB.rqty[x.key] != null ? SHB.rqty[x.key] : x.ready }));
        const err = await shpReceive(items);
        if (err) return err;
        const pcs = items.reduce((t, x) => t + (Number(x.qty) || 0), 0);
        SHB.rpicked = new Set(); SHB.rqty = {};
        soMsg(`Taken from production: ${nf(pcs)} pcs on ${nf(items.length)} line(s). Lines with everything in are handed over.`);
        try { renderShop(); } catch (e) { /* not on that tab */ }
        return '';
      }
      const keys = [...SHB.picked];
      const err = await shpBucketRun(keys, ($('shbWhy') || {}).value);
      if (err) return err;
      SHB.picked = new Set();
      const L = SHP_BUCKET_LAST || {};
      soMsg(`Opened ${nf(L.lines || 0)} production line(s) · ${nf(L.pcs || 0)} piece(s) across ${nf(L.orders || 0)} Shopify order(s) — they are in the Order Console.`
        + ((L.skipped || []).length ? ' Skipped: ' + L.skipped.join(' · ') : ''));
      try { renderShop(); } catch (e) { /* not on that tab */ }
      return '';
    },
  });
  if ($('shbStore')) $('shbStore').value = SHB.store;
  if ($('shbFrom')) $('shbFrom').value = SHB.from;
  if ($('shbDate')) $('shbDate').value = SHB.date;
  if ($('shbXlOut')) $('shbXlOut').onclick = () => shpBucketXlOut();
  if ($('shbXlIn')) $('shbXlIn').onclick = () => $('shbXlFile').click();
  if ($('shbXlFile')) $('shbXlFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; shpBucketXlIn(f); };
  let shbT = null;
  if ($('shbQ')) $('shbQ').oninput = () => { clearTimeout(shbT); shbT = setTimeout(() => { SHB.q = $('shbQ').value; shbRender(); }, 180); };
  if ($('shbStore')) $('shbStore').onchange = () => { SHB.store = $('shbStore').value; shbRender(); };
  if ($('shbFrom')) $('shbFrom').onchange = () => { SHB.from = $('shbFrom').value; shbRender(); };
  if ($('shbShip')) { $('shbShip').value = SHB.ship || ''; $('shbShip').onchange = () => { SHB.ship = $('shbShip').value; shbRender(); }; }
  if ($('shbDate')) $('shbDate').onchange = () => { SHB.date = $('shbDate').value; shbRender(); };
  document.querySelectorAll('[data-shbtab]').forEach(b => { b.onclick = () => { SHB.tab = b.getAttribute('data-shbtab'); shbRender(); }; });
  $('shbTable').oninput = e => { const t = e.target; if (t.getAttribute && t.getAttribute('data-shbq')) { SHB.rqty = SHB.rqty || {}; SHB.rqty[t.getAttribute('data-shbq')] = t.value; } };
  $('shbTable').onchange = e => {
    const t = e.target;
    if (t.getAttribute('data-shbq')) { SHB.rqty[t.getAttribute('data-shbq')] = t.value; return shbRender(); }
    if (t.getAttribute('data-shbrall')) { SHB.rpicked = SHB.rpicked || new Set(); (SHB.rshown || []).forEach(x => { if (t.checked) SHB.rpicked.add(x.key); else SHB.rpicked.delete(x.key); }); return shbRender(); }
    if (t.getAttribute('data-shbr')) { SHB.rpicked = SHB.rpicked || new Set(); const k = t.getAttribute('data-shbr'); if (t.checked) SHB.rpicked.add(k); else SHB.rpicked.delete(k); return shbRender(); }
    if (t.getAttribute('data-shball')) { (SHB.shown || []).forEach(x => { if (t.checked) SHB.picked.add(x.key); else SHB.picked.delete(x.key); }); }
    else if (t.getAttribute('data-shb')) { const k = t.getAttribute('data-shb'); if (t.checked) SHB.picked.add(k); else SHB.picked.delete(k); }
    shbRender();
  };
  shbRender();
}

/** Where each Shopify order's production is, for the Shopify team: one index per version of the order book. */
let SO_PROD_IX = { lines: null, map: null };
function soProdStatus(o) {
  let lines;
  try { lines = ordLines(); } catch (e) { return null; }
  if (SO_PROD_IX.lines !== lines) {
    const m = new Map();
    lines.forEach(l => { if (!l.shopOrderId) return; const k = String(l.shopOrderId); if (!m.has(k)) m.set(k, []); m.get(k).push(l); });
    SO_PROD_IX = { lines, map: m };
  }
  const ls = SO_PROD_IX.map.get(String(o && o.id)) || [];
  if (!ls.length) return null;
  const open = ls.filter(l => l.open).length, n = ls.length;
  if (!open) {
    if (ls.every(l => l.shopDoneAt && !l.handedAt)) return { tone: 'done', txt: typeof SHP_DONE_TXT === 'function' ? SHP_DONE_TXT(ls[0].shopDoneWhy) : 'Fulfilled by shipping team' };
    if (ls.every(l => l.handedAt)) return { tone: 'done', txt: 'Production handed over' };
    return { tone: 'done', txt: 'Production complete' };
  }
  const made = ls.reduce((t, l) => t + Math.min(l.qty, l.pressed || 0), 0), qty = ls.reduce((t, l) => t + l.qty, 0);
  const taken = ls.reduce((t, l) => t + Math.min(l.qty, Number(((typeof spOf === 'function' ? spOf(l.orderNo, l.sku) : null) || {}).handedQty) || 0), 0);
  const says = ls.filter(l => l.open && l.shopSays).length;
  return { tone: 'prog', txt: `In production · ${nf(n - open)} of ${nf(n)} line(s) done` + (qty ? ` · ${nf(made)} of ${nf(qty)} pcs made` : '')
    + (made > taken ? ` · ${nf(made - taken)} ready to take` : '')
    + (says ? ` · Shopify already closed ${nf(says)} line(s) — still open until production hands them over` : '') };
}

/** How many NEW production orders a plan would open before it is allowed to run unattended. */
const SHP_ASK_OVER = 50;

async function shpSyncAll(opts) {
  opts = opts || {};
  const tot = await shpPlanAll(opts);
  if (tot.err) return tot;

  /* A large first run is confirmed, once. Six hundred orders appearing in the Order Console without
   * anybody being told is not something to do quietly, however correct it is. */
  if (!opts.force && tot.newOrders > SHP_ASK_OVER) {
    const ok = confirm(`Open ${nf(tot.newOrders)} production order(s), `
      + `for ${nf(tot.written)} line(s) and ${nf(tot.pieces)} piece(s)?\n\n`
      + `These are Shopify orders neither Amazon nor India can fill. Each opens under its own Shopify `
      + `number (SHP-…) so it can be tracked, and they appear on the Shopify Production tab.\n\n`
      + ((tot.custom || []).length ? `${nf(tot.custom.length)} SKU(s) are not in the Master Database yet. `
        + `Their orders still open, and the codes go on the Custom SKUs list for you to complete: `
        + `${tot.custom.slice(0, 8).join(', ')}${tot.custom.length > 8 ? ` and ${nf(tot.custom.length - 8)} more` : ''}.\n\n` : '')
      + `They close themselves again when the stock arrives or the order ships.`);
    if (!ok) { tot.err = ''; tot.cancelled = true; return tot; }
  }

  const keys = Object.keys(tot.patch);
  for (let i = 0; i < keys.length; i += 200) {
    const slice = {};
    keys.slice(i, i + 200).forEach(k => { slice[k] = tot.patch[k]; });
    try { await ptPatch(slice); }
    catch (e) { tot.err = 'The order book stopped after ' + nf(i) + ' write(s): ' + (e.message || e); return tot; }
  }

  /* Keep what is already in memory in step, so the Order Console shows this without a reload.
   * KEPT ROWS ARE NOT DROPPED: they are still in the database, and a list rebuilt without them
   * would disagree with what production is working from. */
  tot.plans.forEach(p => {
  /* Apply the DIFFERENCE to what is on screen: delete exactly what was deleted, upsert exactly
   * what was written, and leave every other row alone. Rebuilding the order's rows from this run
   * instead dropped lines it had deliberately not judged — the ones belonging to an order outside
   * the fetched window, which are still in the database and still being worked on. */
  const gone = new Set(Object.keys(p.patch)
    .filter(k => p.patch[k] === null && k.indexOf('pt_orderBook/') === 0)
    .map(k => k.slice('pt_orderBook/'.length)));
  if (gone.size) PTG.ob = (PTG.ob || []).filter(x => !(x && gone.has(x.id)));
  p.rows.forEach(row => {
    const i = (PTG.ob || []).findIndex(x => x && x.id === row.id);
    if (i >= 0) PTG.ob[i] = row; else PTG.ob.push(row);
  });
    if (Array.isArray(SOX.rows)) {
      SOX.rows = SOX.rows.filter(s => !(s && s._id === p.no));
      if (p.rec && !p.drop) SOX.rows.push(p.rec);
    }
  });
  return tot;
}

/** Make one Shopify order's production order match it — used when an adjustment is saved. */
async function shpSyncOrder(o, opts) {
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) {
    return { no: '', written: 0, removed: 0, kept: [], skipped: [], err: 'Stock has not been read yet, so what has to be made cannot be worked out. Press Fetch orders first.' };
  }
  await ptLoadGates();
  if (PTG.err) return { no: '', written: 0, removed: 0, kept: [], skipped: [], err: 'Could not read the production database: ' + PTG.err };
  const p = shpPlanOrder(o, !!(o && o.items), shpAssignNo(o, shpTakenNumbers()), opts);
  if (p.err) return p;
  if (Object.keys(p.patch).length) await ptPatch(p.patch);
  /* Apply the DIFFERENCE to what is on screen: delete exactly what was deleted, upsert exactly
   * what was written, and leave every other row alone. Rebuilding the order's rows from this run
   * instead dropped lines it had deliberately not judged — the ones belonging to an order outside
   * the fetched window, which are still in the database and still being worked on. */
  const gone = new Set(Object.keys(p.patch)
    .filter(k => p.patch[k] === null && k.indexOf('pt_orderBook/') === 0)
    .map(k => k.slice('pt_orderBook/'.length)));
  if (gone.size) PTG.ob = (PTG.ob || []).filter(x => !(x && gone.has(x.id)));
  p.rows.forEach(row => {
    const i = (PTG.ob || []).findIndex(x => x && x.id === row.id);
    if (i >= 0) PTG.ob[i] = row; else PTG.ob.push(row);
  });
  if (Array.isArray(SOX.rows)) {
    SOX.rows = SOX.rows.filter(s => !(s && s._id === p.no));
    if (p.rec && !p.drop) SOX.rows.push(p.rec);
  }
  return p;
}

/**
 * The orders this app still has open work for AND did not see in the fetch.
 *
 * Returns shopify order id → the oldest date known for it, so the reach can be worked out without
 * asking Shopify for everything since the beginning of time.
 */
function shpUnseen() {
  const seen = new Set((SO_ALL_ROWS || []).map(r => r && r.id).filter(Boolean));
  const want = new Map();
  const note = (id, d) => {
    id = String(id || ''); d = String(d || '').slice(0, 10);
    if (!id || seen.has(id)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = '';
    const had = want.get(id);
    if (had === undefined || (d && (!had || d < had))) want.set(id, d || had || '');
  };
  (PTG.ob || []).forEach(r => { if (r && String(r.src || '') === 'SHP') note(r.shopOrderId, r.orderDate); });
  Object.keys(SHOP_META || {}).forEach(id => {
    const lines = (SHOP_META[id] || {}).lines || {};
    Object.keys(lines).forEach(k => {
      const ln = lines[k];
      if (ln && ln.adj && adjOpen(ln)) note(id, ln.adjOrderDate || ln.adjAt);
    });
  });
  return want;
}

/**
 * Ask Shopify about those orders, and close the ones that have gone.
 *
 * IT ONLY EVER CLOSES. An order that comes back still open is left exactly as it was: this pass runs
 * outside the stock context a full judgement needs, and "I fetched it in a hurry" is not grounds for
 * opening production work. Shipped and cancelled are the two answers it acts on, and both of them
 * only ever take work away.
 *
 * Nothing is destroyed. An adjustment keeps its own state on the Adjustments tab; only the production
 * row goes, and it can be raised again.
 */
async function shpCloseShipped(opts) {
  const M = !!(opts && opts.maintain);
  const want = shpUnseen();
  if (!want.size) return { looked: 0, closed: 0, opened: 0, removed: 0, written: 0, err: '' };
  const out = { looked: want.size, closed: 0, opened: 0, removed: 0, written: 0, err: '' };

  let from = '';
  want.forEach(d => { if (d && (!from || d < from)) from = d; });
  /* No date on any of them means no idea how far back to reach, and asking Shopify for everything is
   * not a fix. The floor is the same one the window uses. */
  const floor = sdShift(sdToday(), -SHP_REACH_MAX_DAYS);
  if (!from || from < floor) from = floor;

  /* ASK FOR THE DAYS THE MISSING ORDERS ARE ACTUALLY ON, BOTH STORES (2026-09-23).
   *
   * This used to ask for the whole reach — up to 150 days — in one call. The shop does three thousand
   * orders in two months, one page does not hold them, and the answer came back truncated: the very
   * orders being looked for sat at the far end of it, so 82 lines that had shipped weeks ago were
   * still being asked of production. It also asked the Ridhi store alone, so a CPC order could never
   * close at all.
   *
   * shpUnseen already knows the day each missing order was placed. So the windows are built from
   * those days — a fortnight each, only where there is something to find — and both stores are asked
   * for each. An order with no date falls back to walking back from today. */
  const SPAN = 14, MAX_CALLS = 24;
  const today1 = sdShift(sdToday(), 1);
  const days = [...new Set([...want.values()].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= floor))].sort();
  const windows = [];
  days.forEach(d => {
    const last = windows[windows.length - 1];
    if (last && d <= last.end) return;                    // already covered by the window before it
    windows.push({ start: d, end: (x => (x > today1 ? today1 : x))(sdShift(d, SPAN)) });
  });
  /* Nobody knew when these were placed, so the only honest reach is backwards from today. */
  if (days.length < want.size) {
    let end = today1;
    for (let k = 0; k < 6 && end > from; k++) {
      const start = (x => (x < from ? from : x))(sdShift(end, -SPAN));
      windows.push({ start, end });
      end = sdShift(start, -1);
    }
  }

  let orders = [], calls = 0;
  const found = new Set();
  try {
    for (const w of windows) {
      if (calls >= MAX_CALLS || found.size >= want.size) break;
      const [mine, cpc] = await Promise.all([
        prGet({ shopify: 'orders', start: w.start, end: w.end, open: '0' }),
        prGet({ shopify: 'orders', shop: 'CPC', start: w.start, end: w.end, open: '0' }).catch(() => ({ orders: [] })),
      ]);
      calls++;
      (mine.orders || []).concat(cpc.orders || []).forEach(o => {
        const id = String((o && o.id) || '');
        if (!id || !want.has(id) || found.has(id)) return;
        found.add(id);
        orders.push(o);
      });
      /* A window that came back truncated is not an answer about the orders it left out; it is split
       * and the second half asked on the next pass rather than quietly skipped. */
      if (mine.more || cpc.more) out.err = 'Some days had more orders than one page could hold; the next run carries on.';
    }
    if (found.size < want.size && calls >= MAX_CALLS) out.err = 'Some older orders were not reached this time; the next run carries on.';
  } catch (e) { out.err = 'Could not ask Shopify: ' + (e.message || e); return out; }

  const taken = shpTakenNumbers();
  const patch = {};
  const plans = [];
  /* AND THE ONES THAT HAVE NOT SHIPPED ARE JUDGED TOO (Ravi, 2026-09-23: "aise order jo ship nahi hue
   * h or production se required h unko production order me open kardo").
   *
   * This pass used to close and nothing else. But an order from August that is half shipped, and
   * whose remaining lines have since run out of stock, is never in the fetched window again — so the
   * pieces it needs were never asked for. #3873 was exactly that: four lines still to send, one row
   * in the Order Console.
   *
   * Judging needs the stock maps, and shpSyncSoon has already refused to run without them; the guard
   * is repeated here because this function is also callable on its own. */
  const canJudge = SHOP_STOCK_LOADED && SHOP_INDIA_LOADED && !SHOP_INDIA_ERR;
  orders.forEach(o => {
    if (!o || !want.has(String(o.id))) return;
    const f = soFlags(o, SHOP_META[o.id] || {});
    const done = f.shipped || f.cancelled;
    if (!done && !canJudge) return;                        // nothing can be decided without the stock
    const p = shpPlanOrder(Object.assign({}, o, f), true, shpAssignNo(o, taken), M ? { maintain: true } : undefined);
    if (p.err || !Object.keys(p.patch).length) return;
    Object.assign(patch, p.patch);
    plans.push(p);
    if (M) { out.closed += p.done ? 1 : 0; out.done = (out.done || 0) + (p.done || 0); }
    else if (done) out.closed++; else out.opened++;
    out.removed += p.removed; out.written += p.written;
  });
  if (!plans.length) return out;

  try { await ptPatch(patch); }
  catch (e) { out.err = 'The order book could not be brought up to date: ' + (e.message || e); return out; }

  /* Same as a sync: delete exactly what was deleted, upsert exactly what was written. */
  plans.forEach(p => {
    const gone = new Set(Object.keys(p.patch)
      .filter(k => p.patch[k] === null && k.indexOf('pt_orderBook/') === 0)
      .map(k => k.slice('pt_orderBook/'.length)));
    if (gone.size) PTG.ob = (PTG.ob || []).filter(x => !(x && gone.has(x.id)));
    p.rows.forEach(row => {
      const i = (PTG.ob || []).findIndex(x => x && x.id === row.id);
      if (i >= 0) PTG.ob[i] = row; else PTG.ob.push(row);
    });
    if (Array.isArray(SOX.rows)) {
      SOX.rows = SOX.rows.filter(s => !(s && s._id === p.no));
      if (p.rec && !p.drop) SOX.rows.push(p.rec);
    }
  });
  return out;
}

/** What a run did, in one line. */
function shpSyncMsg(t) {
  if (!t) return '';
  if (t.cancelled) return 'Nothing was sent to production.';
  if (t.err) return 'The Order Console could not be brought up to date: ' + t.err;
  const bits = [];
  if (t.done) bits.push(`${nf(t.done)} open production line(s) are fulfilled, cancelled or marked done on Shopify — they stay open until production hands them over`);
  if (t.written) bits.push(`${nf(t.written)} line(s) · ${nf(t.pieces)} piece(s) in the Order Console across ${nf(t.orders)} order(s)`);
  if (t.removed) bits.push(`${nf(t.removed)} closed (now fillable, shipped, or marked done on Shopify)`);
  if (t.dupes) bits.push(`${nf(t.dupes)} duplicate row(s) removed — they were doubling a quantity`);
  if (t.kept.length) bits.push(`${nf(t.kept.length)} left open because production has already worked against them`);
  if ((t.custom || []).length) {
    bits.push(`${nf(t.custom.length)} new SKU(s) put on the Custom SKUs list to be completed: `
      + t.custom.slice(0, 6).join(', ') + (t.custom.length > 6 ? ` and ${nf(t.custom.length - 6)} more` : ''));
  }
  if (t.skipped.length) {
    /* The codeless ones are gathered, because there are dozens of them and they all need the same
     * thing done in the same place. Everything else is still named individually. */
    const noCode = t.skipped.filter(s => s.sku === '(no code)');
    const rest = t.skipped.filter(s => s.sku !== '(no code)');
    if (noCode.length) {
      bits.push(`${nf(noCode.length)} line(s) have NO SKU on the Shopify variant, so nothing can be `
        + `made for them — ${noCode.slice(0, 2).map(s => (s.why.match(/^"([^"]+)"/) || [, '?'])[1]).join(', ')}`
        + (noCode.length > 2 ? ` and ${nf(noCode.length - 2)} more` : '')
        + '. Set the SKU on the product in Shopify.');
    }
    if (rest.length) {
      bits.push(`${nf(rest.length)} line(s) could not be ordered: `
        + rest.slice(0, 3).map(s => s.sku + ' — ' + s.why).join('; '));
    }
  }
  if (!bits.length) return '';
  return 'Production: ' + bits.join(' · ');
}

/* One run at a time, and only where both stock maps are in. Called after a fetch and again when
 * India stock lands, because those are the two moments the answer can change. */
let SHP_CUSTOM = null;      // pt_customSkus, read once per session
let SHP_BUSY = false;
/* A SECOND ASK WHILE ONE IS RUNNING IS NOT A DUPLICATE — IT IS THE ONE THAT MATTERS.
 *
 * Ravi, 2026-09-23: a CPC order said "Need from production" and no production order opened for it.
 *
 * Opening the tab starts two things: the India stock read, which calls this when it lands, and the
 * order fetch, which calls it again when ITS orders arrive. Coming back to a tab that already had
 * orders on it, India usually lands first — so a sync runs over the OLD list, and the call that
 * carries the newly fetched orders arrives while that one is still going and was simply dropped.
 * The new orders were then never judged at all, and sat there needing production with nothing in
 * the Order Console, until something else happened to trigger a sync.
 *
 * So a call that arrives mid-run is remembered and made once the run finishes. */
let SHP_AGAIN = null;
async function shpSyncSoon(where) {
  if (SHP_BUSY) { SHP_AGAIN = where || SHP_AGAIN || ''; return; }
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return;
  if (!(SO_ALL_ROWS || []).length) return;
  SHP_BUSY = true;
  try {
    /* THE AUTOMATIC RUN OPENS NOTHING (Ravi, 2026-09-26) — it completes what Shopify has closed. Opening is the bucket's. */
    const t = await shpSyncAll({ maintain: true });
    let msg = shpSyncMsg(t);
    /* AND THEN THE ONES THAT WERE NOT IN THE WINDOW. Without this an order that shipped in July is
     * demanded again every time the app is opened, because nobody ever fetched far enough back to
     * find out that it shipped. */
    let reach = null;
    if (!t.err && !t.cancelled) {
      try { reach = await shpCloseShipped({ maintain: true }); } catch (e) { reach = { err: e.message || String(e) }; }
      if (reach && (reach.closed || reach.opened)) {
        const bits = [];
        if (reach.closed) bits.push(`${nf(reach.closed)} older order(s) have shipped or been cancelled on Shopify — their production lines stay open until handed over`);
        if (reach.opened) bits.push(`${nf(reach.opened)} older order(s) brought up to date — ${nf(reach.written)} line(s) they still need are now in the Order Console`);
        msg = (msg ? msg + ' · ' : 'Production: ') + bits.join(' · ');
      }
      if (reach && reach.err) msg = (msg ? msg + ' · ' : '') + reach.err;
    }
    const el = $(where === 'adj' ? 'ajMsg' : 'soMsg');
    if (el && msg) { el.className = t.err ? 'err' : 'muted'; el.textContent = msg; }
    if (t.written || t.removed || (reach && reach.closed)) { try { renderShop(); } catch (e) { /* not on that tab */ } }
  } catch (e) {
    const el = $(where === 'adj' ? 'ajMsg' : 'soMsg');
    if (el) { el.className = 'err'; el.textContent = 'The Order Console could not be brought up to date: ' + (e.message || e); }
  } finally {
    SHP_BUSY = false;
    /* The ask that came in mid-run, now that there is nothing in its way. Once, not in a loop: the
     * flag is taken before the call, so a third ask during THIS one queues itself again rather
     * than stacking. */
    if (SHP_AGAIN !== null) { const again = SHP_AGAIN; SHP_AGAIN = null; await shpSyncSoon(again); }
  }
}


function soBindAdjButtons() {
  $('soItems').querySelectorAll('[data-adj]').forEach(b => { b.onclick = () => openAdj(b.dataset.adj); });
}
$('adjSave').onclick = () => saveAdj(false);
if ($('soBucket')) $('soBucket').onclick = () => shpBucketOpen();

