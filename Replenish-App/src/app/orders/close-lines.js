/* ================= CLOSING SHOPIFY / ONLINE PRODUCTION LINES =================
 *
 * Ravi, 2026-10-08: "need more way to close these order" → "Saare 10 tareeke banao", and the shipping team may close too.
 * Since 5 Oct a make-to-order line (SHP- / ONL-) ends only when production hands it to shipping, and what Shopify says
 * (shopSays) closes nothing. This is the deliberate way out, by a person, with a reason:
 *   1 a "close" link where Shopify says shipped / cancelled / refunded       2 close every Shopify-done line at once
 *   3 tick any open line and give a reason                                   4 close at what was handed over (partial)
 *   5 an Excel sheet of every open line, Close / Reason filled, uploaded back 6 "Ready to close" on lines Shopify shipped
 *   7 "shipped from stock" (India / FBA / MCF) as a reason                     8 a filter for lines opened long ago
 *   9 close from shipping's own "From production" tab                        10 reopen a line closed by hand
 * One write for all of them: shopDoneAt / shopDoneWhy on the line's order-book rows (the fields a Shopify close already
 * used before 5 Oct, so every screen already reads them), plus who, the note and a log. Nothing booked against the line
 * — cut, issued, received, QC, handed — is touched. Reopening clears the close and keeps the log.
 */
const ORD_CLOSE_WHY = [
  ['shopify', 'Shopify done — shipped / cancelled / refunded on Shopify'],
  ['stock', 'Shipped from stock (India / FBA / MCF), not from production'],
  ['partial', 'Rest not needed — close at what was handed over'],
  ['cancelled', 'Cancelled by the customer'],
  ['refunded', 'Refunded'],
  ['outside', 'Made outside / bought in'],
  ['duplicate', 'Duplicate line'],
  ['other', 'Other — write why'],
];
const ordCanClose = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('ord') >= 0 || (ME.tabs || []).indexOf('shop') >= 0);
const ORD_CLOSE_NO = 'Closing lines needs the Order Console or the Shopify Orders tab.';
/** What a close says on screen, by the reason it was given. */
const ORD_CLOSE_TXT = { stock: 'Shipped from stock', partial: 'Closed at what was handed over', outside: 'Made outside', duplicate: 'Duplicate — closed', other: 'Closed by hand' };

/** The order-book rows behind one order and SKU (a line can be more than one row). */
const ordCloseRows = (orderNo, sku) => (PTG.ob || []).filter(r => r && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku));
const ordCloseLineIx = () => { const m = new Map(); ordLines().forEach(l => m.set(l.orderNo + '|' + l.sku, l)); return m; };
const ordHandedOf = l => l.handedAt ? l.qty : Math.min(l.qty, Number(((typeof spOf === 'function' ? spOf(l.orderNo, l.sku) : null) || {}).handedQty) || 0);

/**
 * Close lines. items: [{orderNo, sku}] (or "ORDER|SKU" strings); why: a key of ORD_CLOSE_WHY. One reason for all, or a
 * Map key → {why, note} (the Excel). Returns { err } or { closed, skipped: [text] }.
 */
async function ordCloseRun(items, why, note) {
  if (!ordCanClose()) return { err: ORD_CLOSE_NO };
  const per = why instanceof Map ? why : null;
  const ix = ordCloseLineIx(), now = new Date().toISOString(), patch = {}, skipped = [], touched = [];
  let closed = 0;
  [...new Set((items || []).map(i => typeof i === 'string' ? i : (obUC(i.orderNo) + '|' + obUC(i.sku))))].forEach(k => {
    const [no, sku] = k.split('|');
    const w = per ? (per.get(k) || {}).why : why, n = String((per ? (per.get(k) || {}).note : note) || '').trim();
    const l = ix.get(no + '|' + sku);
    if (!ORD_CLOSE_WHY.some(x => x[0] === w)) { skipped.push(`${no} ${sku}: pick a reason`); return; }
    if (w === 'other' && !n) { skipped.push(`${no} ${sku}: "Other" needs a note saying why`); return; }
    if (!l) { skipped.push(`${no} ${sku}: not in the order book`); return; }
    if (!ordIsMto(l.orderNo)) { skipped.push(`${no} ${sku}: only Shopify and Online lines are closed here`); return; }
    if (!l.open) { skipped.push(`${no} ${sku}: already closed`); return; }
    let stored = w;
    if (w === 'shopify') { if (!l.shopSays) { skipped.push(`${no} ${sku}: Shopify has not said it is done`); return; } stored = l.shopSays; }
    const handed = ordHandedOf(l);
    if (w === 'partial' && !handed) { skipped.push(`${no} ${sku}: nothing handed over yet — pick another reason`); return; }
    const rows = ordCloseRows(no, sku);
    if (!rows.length) { skipped.push(`${no} ${sku}: its order-book row is gone — press Refresh`); return; }
    rows.forEach(r => {
      const key = r.id || r._key; if (!key) return;
      const log = (Array.isArray(r.shopDoneLog) ? r.shopDoneLog.slice(-19) : []).concat([{ act: 'close', why: stored, note: n, at: now, by: ME.email, handed }]);
      Object.assign(patch, { ['pt_orderBook/' + key + '/shopDoneAt']: now, ['pt_orderBook/' + key + '/shopDoneWhy']: stored,
        ['pt_orderBook/' + key + '/shopDoneBy']: ME.email, ['pt_orderBook/' + key + '/shopDoneNote']: n || null,
        ['pt_orderBook/' + key + '/shopDoneHanded']: handed, ['pt_orderBook/' + key + '/shopDoneLog']: log });
      touched.push([key, { shopDoneAt: now, shopDoneWhy: stored, shopDoneBy: ME.email, shopDoneNote: n || '', shopDoneHanded: handed, shopDoneLog: log }]);
    });
    closed++;
  });
  if (!closed) return { closed: 0, skipped };
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 300) {
    const part = {}; keys.slice(i, i + 300).forEach(k => { part[k] = patch[k]; });
    try { await ptPatch(part); } catch (e) { return { err: 'Stopped after ' + nf(i / 6) + ' row(s): ' + (e.message || e) }; }
  }
  ordCloseApply(touched);
  return { closed, skipped };
}
/** Reopen lines closed by hand or by Shopify — never one production handed over. A note is required. */
async function ordReopenRun(items, note) {
  if (!ordCanClose()) return { err: ORD_CLOSE_NO };
  const n = String(note || '').trim();
  if (!n) return { err: 'Say why it is reopened.' };
  const ix = ordCloseLineIx(), now = new Date().toISOString(), patch = {}, skipped = [], touched = [];
  let opened = 0;
  [...new Set((items || []).map(i => typeof i === 'string' ? i : (obUC(i.orderNo) + '|' + obUC(i.sku))))].forEach(k => {
    const [no, sku] = k.split('|'), l = ix.get(no + '|' + sku);
    if (!l || l.open || !l.shopDoneAt) { skipped.push(`${no} ${sku}: not closed by hand or by Shopify`); return; }
    if (l.handedAt) { skipped.push(`${no} ${sku}: production handed it over — that is not undone here`); return; }
    ordCloseRows(no, sku).forEach(r => {
      const key = r.id || r._key; if (!key) return;
      const log = (Array.isArray(r.shopDoneLog) ? r.shopDoneLog.slice(-19) : []).concat([{ act: 'reopen', note: n, at: now, by: ME.email, was: r.shopDoneWhy || '' }]);
      Object.assign(patch, { ['pt_orderBook/' + key + '/shopDoneAt']: null, ['pt_orderBook/' + key + '/shopDoneWhy']: null, ['pt_orderBook/' + key + '/shopDoneBy']: null,
        ['pt_orderBook/' + key + '/shopDoneNote']: null, ['pt_orderBook/' + key + '/shopDoneHanded']: null, ['pt_orderBook/' + key + '/shopDoneLog']: log });
      touched.push([key, { shopDoneAt: '', shopDoneWhy: '', shopDoneBy: '', shopDoneNote: '', shopDoneHanded: null, shopDoneLog: log }]);
    });
    opened++;
  });
  if (!opened) return { opened: 0, skipped };
  await ptPatch(patch);
  ordCloseApply(touched);
  return { opened, skipped };
}
/** Keep the screen in step: a new order-book array, so every cache keyed on it rebuilds. */
function ordCloseApply(touched) {
  const by = new Map(touched);
  PTG.ob = (PTG.ob || []).map(r => { const k = r && (r.id || r._key); return k && by.has(k) ? Object.assign({}, r, by.get(k)) : r; });
}

/* ---------- the dialog: every way in one place ---------- */
let ORD_CLOSE = { show: 'says', q: '', days: 0, picked: new Set(), pre: null };
function ordCloseCandidates() {
  const all = ordLines().filter(l => ordIsMto(l.orderNo));
  const q = String(ORD_CLOSE.q || '').trim().toLowerCase(), now = Date.now();
  const age = l => { const ms = Date.parse((l.mtoOpen || l.openIso || l.orderDate || '') + 'T00:00:00'); return ms ? Math.floor((now - ms) / 864e5) : 0; };
  let rows = ORD_CLOSE.show === 'closed' ? all.filter(l => !l.open && l.shopDoneAt && !l.handedAt)
    : all.filter(l => l.open && (ORD_CLOSE.show !== 'says' || l.shopSays));
  if (ORD_CLOSE.pre && ORD_CLOSE.show === 'pick') rows = rows.filter(l => ORD_CLOSE.pre.has(l.orderNo + '|' + l.sku)).concat(rows.filter(l => !ORD_CLOSE.pre.has(l.orderNo + '|' + l.sku)));
  if (ORD_CLOSE.days > 0) rows = rows.filter(l => age(l) >= ORD_CLOSE.days);
  if (q) rows = rows.filter(l => [l.orderNo, l.shopOrderNo, l.sku, l.articleSubtype, l.color, l.size, l.shopSays].join(' ').toLowerCase().includes(q));
  return rows.map(l => ({ l, key: l.orderNo + '|' + l.sku, age: age(l), handed: ordHandedOf(l) }));
}
function ordCloseOpen(preKeys, show) {
  if (!ordCanClose()) { if ($('odMsg')) { $('odMsg').className = 'err'; $('odMsg').textContent = ORD_CLOSE_NO; } return; }
  ORD_CLOSE = { show: show || (preKeys && preKeys.length ? 'pick' : 'says'), q: '', days: 0, picked: new Set(preKeys || []), pre: preKeys && preKeys.length ? new Set(preKeys) : null };
  if (ORD_CLOSE.show === 'says' && !preKeys) ordCloseCandidates().forEach(x => ORD_CLOSE.picked.add(x.key));
  const reasonDefault = preKeys && preKeys.length === 1 ? (() => { const l = ordCloseLineIx().get(preKeys[0]); return l && l.shopSays ? 'shopify' : 'stock'; })() : 'shopify';
  ptOpenDialog({
    title: 'Close Shopify / Online lines', wide: true,
    subtitle: 'A closed line leaves production. What was cut, issued, made, passed or handed over stays as it is.',
    html: `<div class="toolbar" style="gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <select id="ocShow" style="flex:0 0 250px">
          <option value="says">Shopify says done (ready to close)</option>
          <option value="pick">Every open line</option>
          <option value="closed">Closed by hand or by Shopify — reopen</option></select>
        <select id="ocDays" style="flex:0 0 190px" title="How long ago the line was opened in production">
          <option value="0">Opened any time</option><option value="15">Opened 15+ days ago</option>
          <option value="30">Opened 30+ days ago</option><option value="60">Opened 60+ days ago</option></select>
        <input id="ocQ" placeholder="Search order / Shopify no / SKU" style="flex:1 1 200px;min-width:0">
        <button type="button" class="ghost" id="ocTpl" title="Every open line, with Close and Reason columns to fill">Excel template</button>
        <button type="button" class="ghost" id="ocUp">Upload filled sheet</button>
        <input type="file" id="ocFile" accept=".csv,.xlsx" style="display:none"></div>
      <div id="ocList" style="max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px"></div>
      <div class="ptgrid" style="margin-top:10px">
        <label id="ocWhyWrap">Reason<select id="ocWhy">${ORD_CLOSE_WHY.map(([k, t]) => `<option value="${k}"${k === reasonDefault ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label style="grid-column:span 2">Note<input id="ocNote" placeholder="who said so, tracking, invoice — optional, needed for Other and for reopening"></label></div>
      <div id="ocMsg" class="muted" style="margin-top:6px;font-size:12.5px"></div>`,
    saveLabel: 'Close the ticked lines',
    onSave: async () => {
      const keys = [...ORD_CLOSE.picked];
      if (!keys.length) return 'Tick at least one line.';
      const r = ORD_CLOSE.show === 'closed' ? await ordReopenRun(keys, $('ocNote').value) : await ordCloseRun(keys, $('ocWhy').value, $('ocNote').value);
      if (r.err) return r.err;
      const n = r.closed != null ? r.closed : r.opened;
      if (!n) return 'Nothing changed: ' + r.skipped.slice(0, 5).join(' · ');
      try { renderOrd(); } catch (e) { /* not on that tab */ }
      try { if (typeof renderShop === 'function') renderShop(); } catch (e) { /* not on that tab */ }
      if (r.skipped.length) { ORD_CLOSE.picked.clear(); ordCloseDraw(); ordCloseSay(`${r.closed != null ? 'Closed' : 'Reopened'} ${nf(n)} line(s). Left as they were: ${r.skipped.slice(0, 6).join(' · ')}`); return 'Done — see the note above the reason.'; }
      return '';
    },
  });
  $('ocShow').value = ORD_CLOSE.show;
  $('ocShow').onchange = () => { ORD_CLOSE.show = $('ocShow').value; ORD_CLOSE.picked = new Set(ORD_CLOSE.show === 'says' ? ordCloseCandidates().map(x => x.key) : []); ordCloseDraw(); };
  $('ocDays').onchange = () => { ORD_CLOSE.days = +$('ocDays').value || 0; ordCloseDraw(); };
  $('ocQ').oninput = () => { ORD_CLOSE.q = $('ocQ').value; ordCloseDraw(); };
  $('ocTpl').onclick = ordCloseTemplate;
  $('ocUp').onclick = () => $('ocFile').click();
  $('ocFile').onchange = async () => {
    const f = $('ocFile').files && $('ocFile').files[0]; $('ocFile').value = ''; if (!f) return;
    let rows; try { rows = await pkReadFile(f); } catch (e) { return ordCloseSay('Could not read that file: ' + (e.message || e), true); }
    const r = await ordCloseSheetRun(rows);
    if (r.err) return ordCloseSay(r.err, true);
    try { renderOrd(); } catch (e) { /* not on that tab */ }
    ordCloseDraw();
    ordCloseSay(`Closed ${nf(r.closed)} line(s) from the sheet.` + (r.skipped.length ? ' Left as they were: ' + r.skipped.slice(0, 6).join(' · ') : ''));
  };
  $('ocList').onclick = e => {
    const c = e.target.closest && e.target.closest('[data-ocpick],[data-ocall]'); if (!c) return;
    const rows = ordCloseCandidates();
    if (c.hasAttribute('data-ocall')) { if (c.checked) rows.slice(0, 500).forEach(x => ORD_CLOSE.picked.add(x.key)); else ORD_CLOSE.picked.clear(); }
    else { const k = c.getAttribute('data-ocpick'); if (c.checked) ORD_CLOSE.picked.add(k); else ORD_CLOSE.picked.delete(k); }
    ordCloseDraw();
  };
  ordCloseDraw();
}
function ordCloseSay(m, bad) { if ($('ocMsg')) { $('ocMsg').className = bad ? 'err' : 'muted'; $('ocMsg').textContent = m; } }
function ordCloseDraw() {
  const rows = ordCloseCandidates(), reopen = ORD_CLOSE.show === 'closed';
  if ($('ocWhyWrap')) $('ocWhyWrap').classList.toggle('hide', reopen);
  if ($('ptDlgSave')) $('ptDlgSave').textContent = reopen ? 'Reopen the ticked lines' : 'Close the ticked lines';
  const on = rows.filter(x => ORD_CLOSE.picked.has(x.key)).length;
  const says = w => (typeof SHP_SAYS_TXT === 'function' && SHP_SAYS_TXT(w)) || '';
  $('ocList').innerHTML = `<table class="xl" style="font-size:12.5px;width:100%"><thead><tr>
      <th><input type="checkbox" data-ocall="1"${rows.length && on === Math.min(rows.length, 500) ? ' checked' : ''} style="width:auto" title="Tick every line shown (up to 500)"></th>
      <th>Order</th><th>SKU</th><th>Item</th><th class="num">Qty</th><th class="num">QC passed</th><th class="num">Handed over</th><th class="num">Days open</th><th>${reopen ? 'Closed as' : 'Shopify says'}</th></tr></thead><tbody>`
    + (rows.slice(0, 500).map(x => `<tr${ORD_CLOSE.picked.has(x.key) ? ' class="on"' : ''}><td><input type="checkbox" data-ocpick="${esc(x.key)}"${ORD_CLOSE.picked.has(x.key) ? ' checked' : ''} style="width:auto"></td>`
      + `<td style="text-align:left;white-space:nowrap"><b>${esc(x.l.shopOrderNo || x.l.orderNo)}</b><div class="muted" style="font-size:11px">${esc(x.l.orderNo)}</div></td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(x.l.sku)}</td><td style="text-align:left">${esc([x.l.articleSubtype || x.l.articleType, x.l.color, x.l.size].filter(Boolean).join(' · '))}</td>`
      + `<td class="num">${nf(x.l.qty)}</td><td class="num">${nf(Math.min(x.l.qty, x.l.pressed || 0))}</td><td class="num">${x.handed ? nf(x.handed) : '<span class="muted">—</span>'}</td><td class="num">${nf(x.age)}</td>`
      + `<td style="text-align:left;font-size:12px">${reopen ? esc((ORD_CLOSE_TXT[x.l.shopDoneWhy] || SHP_DONE_TXT(x.l.shopDoneWhy)) + (x.l.shopDoneNote ? ' — ' + x.l.shopDoneNote : '')) : (x.l.shopSays ? `<span class="pill pill-ok">Ready to close</span> ${esc(says(x.l.shopSays))}` : '<span class="muted">—</span>')}</td></tr>`).join('')
      || `<tr><td colspan="9" class="muted" style="padding:14px">${reopen ? 'Nothing closed by hand or by Shopify matches.' : 'No open line matches.'}</td></tr>`) + '</tbody></table>'
    + (rows.length > 500 ? `<div class="muted" style="padding:6px 10px">Showing 500 of ${nf(rows.length)} — narrow it with the search or the age, or use the Excel template.</div>` : '');
  ordCloseSay(`${nf(on)} of ${nf(rows.length)} ticked` + (reopen ? ' · reopening needs a note' : ''));
}

/* ---------- 5: the Excel ---------- */
const ORD_CLOSE_COLS = ['Order', 'Shopify order', 'SKU', 'Item', 'Qty', 'QC passed', 'Handed over', 'Days open', 'Shopify says', 'Close (Y)', 'Reason', 'Note'];
function ordCloseTemplate() {
  const keep = ORD_CLOSE.show; ORD_CLOSE.show = 'pick';
  const rows = ordCloseCandidates(); ORD_CLOSE.show = keep;
  ptDownload('close-shopify-lines', [ORD_CLOSE_COLS.map(csvCell).join(',')].concat(rows.map(x => [x.l.orderNo, x.l.shopOrderNo, x.l.sku,
    [x.l.articleSubtype || x.l.articleType, x.l.color, x.l.size].filter(Boolean).join(' · '), x.l.qty, Math.min(x.l.qty, x.l.pressed || 0), x.handed, x.age,
    x.l.shopSays || '', x.l.shopSays ? 'Y' : '', x.l.shopSays ? 'shopify' : '', ''].map(csvCell).join(',')),
    ['', '', '', 'Reasons: ' + ORD_CLOSE_WHY.map(w => w[0]).join(' / '), '', '', '', '', '', 'Y closes the line', 'one of the reasons', 'needed for other'].map(csvCell).join(',')));
}
async function ordCloseSheetRun(rows) {
  if (!ordCanClose()) return { err: ORD_CLOSE_NO };
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const at = n => head.indexOf(n), iO = at('order'), iS = at('sku'), iC = at('close (y)') >= 0 ? at('close (y)') : at('close'), iR = at('reason'), iN = at('note');
  if (iO < 0 || iS < 0 || iC < 0 || iR < 0) return { err: 'The sheet needs Order, SKU, Close (Y) and Reason columns — download the template.' };
  const per = new Map(), bad = [];
  for (let i = 1; i < rows.length; i++) {
    const c = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    if (!/^(y|yes|1|close|true)$/i.test(c(iC))) continue;
    const reason = c(iR).toLowerCase(), w = (ORD_CLOSE_WHY.find(x => x[0] === reason || x[1].toLowerCase().startsWith(reason)) || [])[0];
    if (!w) { bad.push(`row ${i + 1}: reason "${c(iR)}" is not one of ${ORD_CLOSE_WHY.map(x => x[0]).join(', ')}`); continue; }
    if (w === 'other' && !c(iN)) { bad.push(`row ${i + 1}: "other" needs a note`); continue; }
    per.set(obUC(c(iO)) + '|' + obUC(c(iS)), { why: w, note: c(iN) });
  }
  if (bad.length) return { err: 'Nothing was closed. ' + bad.slice(0, 6).join(' · ') + (bad.length > 6 ? ` …and ${nf(bad.length - 6)} more` : '') };
  if (!per.size) return { err: 'No row has Y in Close.' };
  return ordCloseRun([...per.keys()], per);
}

/* ---------- 1, 6, 9, 10: the links on the other screens ---------- */
/* Wherever a close / reopen link is drawn — Order Console, the Shopify order, shipping's From production tab. */
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('[data-ordclose],[data-ordreopen]'); if (!a) return;
  e.preventDefault(); e.stopPropagation();
  if (a.hasAttribute('data-ordreopen')) return ordCloseOpen([a.getAttribute('data-ordreopen')], 'closed');
  ordCloseOpen([a.getAttribute('data-ordclose')]);
}, true);

if ($('odClose')) $('odClose').onclick = () => ordCloseOpen();
