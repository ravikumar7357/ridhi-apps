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

/* ================= OPEN A WHOLE PENDING SHEET (Ravi, 17 Oct) =================
 * "jo sheet di wo actual production required h to … whole sheet production me open karna padega". The team's Shopify export
 * of unfulfilled lines (Name · Lineitem quantity · Lineitem name · Lineitem sku · Lineitem fulfillment status) IS what has to
 * be made: every pending line is opened, the stock's opinion aside (reason "on the pending sheet"). Each row is found on the
 * fetched order by the Shopify SKU, else by the line's own name (the export writes it as Shopify does), and goes through
 * shpBucketRun — the same duplicate guard read from the database, the same order numbers. What cannot be opened is said,
 * row by row: an order not fetched (widen From), a line with no SKU to make it against, already open, shipped. */
const shpNameKey = v => String(v == null ? '' : v).toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, '');
/** rows (with the header) → { store, from, lines:[{row, nm, qty, name, sku, st, key, x, why}] } or { err } */
function shpSheetMatch(rows, storeWant) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const H = rows[0].map(h => String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().toLowerCase());
  const col = n => H.indexOf(n);
  const iN = col('name'), iQ = col('lineitem quantity'), iT = col('lineitem name'), iS = col('lineitem sku'), iF = col('lineitem fulfillment status'), iD = col('created at');
  if (iN < 0 || iT < 0) return { err: 'This is not the Shopify orders export — it needs the "Name" and "Lineitem name" columns.' };
  const cell = (r, j) => (j >= 0 && r[j] != null ? String(r[j]).trim() : '');
  const body = rows.slice(1).map((r, k) => ({ r: r || [], row: k + 2 })).filter(x => cell(x.r, iN));
  /* Which store: the one picked in the bucket, else the SKUs' brand (CPC… is CPC). The two stores both number from 1. */
  const skus = body.map(x => obUC(cell(x.r, iS))).filter(Boolean);
  const store = storeWant || (skus.filter(s => /^CPC/.test(s)).length * 2 >= skus.length ? 'CPC' : 'Ridhi');
  const orders = new Map();
  (SO_ALL_ROWS || []).forEach(o => { if (o && o.id && shbStore(o) === store) orders.set(shpNameKey(o.no).toUpperCase(), o); });
  const byKey = new Map(shpBucketAll().map(x => [x.key, x]));
  const opened = new Set((PTG.ob || []).filter(x => x && x.shopOrderId).map(x => String(x.shopOrderId) + '|' + obUC(x.sku)));
  const used = new Set(), lines = [];
  let from = '';
  body.forEach(({ r, row }) => {
    const nm = cell(r, iN), no = shpNameKey(nm).toUpperCase(), name = cell(r, iT), sku = obUC(cell(r, iS)), qty = Number(cell(r, iQ)) || 0;
    const L = { row, nm, qty, name, sku, st: '', key: '', why: '' };
    lines.push(L);
    if (/^ful/i.test(cell(r, iF))) { L.st = 'gone'; L.why = 'fulfilled on the sheet'; return; }
    if (!/^#/.test(nm)) { L.st = 'other'; L.why = nm + ' is not a Shopify order (open it as an Online order)'; return; }
    const dv = iD >= 0 ? r[iD] : null;
    /* the export's date: text "2026-09-21 10:00:00 +0530", or an Excel day number once the sheet was saved in Excel */
    const d = !dv ? '' : dv instanceof Date ? dv.toISOString().slice(0, 10)
      : /^\d+(\.\d+)?$/.test(String(dv)) ? new Date(Math.round((Number(dv) - 25569) * 86400000)).toISOString().slice(0, 10) : String(dv).slice(0, 10);
    const o = orders.get(no);
    if (!o) { L.st = 'nofetch'; L.why = 'order not fetched' + (d ? ' (' + d + ')' : ''); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!from || d < from)) from = d; return; }
    if (o.cancelled) { L.st = 'gone'; L.why = 'cancelled on Shopify'; return; }
    /* the line on the order: its Shopify SKU, else its name (title + variant, as the export joins them) */
    const items = o.items || [], nk = shpNameKey(name);
    const full = i => shpNameKey(String(i.name || '') + ' ' + (i.variant || ''));
    const it = (sku && items.find(i => obUC(i.sku) === sku)) || (nk && items.find(i => full(i) === nk))
      || (nk && items.find(i => { const a = full(i), b = shpNameKey(i.name); return a.startsWith(nk) || nk.startsWith(a) || (b.length > 8 && nk.startsWith(b) && !items.some(j => j !== i && shpNameKey(j.name) === b)); }));
    if (!it) { L.st = 'noline'; L.why = 'no such line on ' + nm; return; }
    if (shpLineShipped(it)) { L.st = 'gone'; L.why = 'Shopify says this line has shipped'; return; }
    const code = shpLineCode(o.id, it).sku;
    const keys = [...new Set([code, obUC(it.sku)].filter(Boolean))].map(s => String(o.id) + '|' + s);
    const k = keys.find(x => byKey.has(x));
    if (k) { L.key = k; L.x = byKey.get(k); L.sku = L.x.sku; if (used.has(k)) { L.st = 'dup'; L.why = 'same line as an earlier row'; } else { used.add(k); L.st = 'open'; } return; }
    if (keys.some(x => opened.has(x))) { L.st = 'already'; L.why = 'already in production'; return; }
    /* THE SHEET'S OWN SKU (17 Oct: 98 lines had none on Shopify). Written in "Lineitem sku" for a line Shopify sent without
     * one, it is typed on the order exactly as the order dialog's box does (SHOP_META[id].mk), then the line opens. Only a
     * SKU the master database or the custom list knows — a typo is not turned into a product. */
    if (!code && sku && !obUC(it.sku)) {
      const known = new Set((PTG.mdb || []).map(x => obUC(x && x.sku)).concat((SHP_CUSTOM || []).map(x => obUC(x && x.sku))));
      if (known.size && !known.has(sku)) { L.st = 'badsku'; L.why = sku + ' is not in the master database'; return; }
      L.st = 'type'; L.o = o; L.it = it; L.why = 'SKU from the sheet: ' + sku; return;
    }
    if (!code) { L.st = 'nosku'; L.why = 'no SKU — write it in "Lineitem sku" on the sheet (or type it on the order), then upload again'; return; }
    L.st = 'noneed'; L.why = 'nothing left to make on it';
  });
  /* One day earlier than the sheet says: the fetch counts days in the marketplace's zone, the sheet in the store's (17 Oct:
   * #5575, created 27 Jul 04:50, was not fetched with From = 27 Jul). */
  if (from) { const t = new Date(from + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); from = t.toISOString().slice(0, 10); }
  return { store, from, lines };
}
/** Every row of the last pending sheet, with what happened to it — to fill the missing SKUs and upload again. */
function shpSheetListOut(m) {
  const ST = { open: 'Will open', type: 'Opens with the sheet SKU', nosku: 'No SKU', badsku: 'SKU not in master', already: 'Already in production', gone: 'Shipped / cancelled / fulfilled',
    noline: 'Not found on the order', noneed: 'Nothing left to make', dup: 'Repeat of a row above', other: 'Not a Shopify order', nofetch: 'Order not fetched' };
  const rows = [['Name', 'Lineitem quantity', 'Lineitem name', 'Lineitem sku', 'Status', 'Why', 'Sheet row']]
    .concat(m.lines.map(l => [l.nm, l.qty, l.name, l.st === 'nosku' ? '' : l.sku, ST[l.st] || l.st, l.why || '', l.row]));
  const bytes = recipeXlsx(rows, { name: 'Pending sheet', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'pending-sheet-check-' + dToday() + '.xlsx';
  a.click(); URL.revokeObjectURL(a.href);
}
async function shpSheetIn(file) {
  if (!file) return;
  let rows;
  try { rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text()); }
  catch (e) { soMsg('Could not read the file: ' + (e.message || e), true); return; }
  const storeWant = SHB.store || '';
  const m = shpSheetMatch(rows, storeWant);
  if (m.err) { soMsg(m.err, true); return; }
  SHB.sheetLast = m;
  const by = st => m.lines.filter(l => l.st === st), go = by('open'), typed = by('type');
  const keys = go.map(l => l.key), why = 'on the pending sheet ' + file.name + ' (' + dToday() + ')';
  const grp = (st, label) => { const ls = by(st); return ls.length ? `<div style="margin-top:6px"><b>${nf(ls.length)}</b> ${label}: <span class="muted">${esc(ls.slice(0, 8).map(l => l.nm + ' ' + (l.sku || l.name.slice(0, 40))).join(' · '))}${ls.length > 8 ? ' …' : ''}</span></div>` : ''; };
  ptOpenDialog({
    title: 'Open the pending sheet',
    subtitle: `${file.name} · store ${m.store} · ${nf(m.lines.length)} row(s)`,
    note: 'Every pending line on the sheet is opened in production — the stock is not asked. A line already open is skipped; nothing else of the orders is touched.',
    html: '<div style="font-size:12.5px;line-height:1.7">'
      + `<div><b>${nf(go.length)}</b> line(s) · ${nf(new Set(go.map(l => l.x.id)).size)} order(s) · ${nf(go.reduce((t, l) => t + (l.x.qty || 0), 0))} qty will be opened</div>`
      + (typed.length ? `<div><b>${nf(typed.length)}</b> more with the SKU written on the sheet — it is saved on their order, then they open: <span class="muted">${esc(typed.slice(0, 8).map(l => l.nm + ' ' + l.sku).join(' · '))}${typed.length > 8 ? ' …' : ''}</span></div>` : '')
      + `<div style="margin-top:4px"><button type="button" id="shbSheetList">Download the list (every row and why)</button></div>`
      + (m.from ? `<div class="err">${nf(by('nofetch').length)} row(s) are on orders not fetched. Put <b>From = ${esc(m.from)}</b>, press Fetch orders, then upload the sheet again.</div>` : '')
      + grp('nosku', 'with no SKU (write it in "Lineitem sku" and upload again)') + grp('badsku', 'with a SKU the master does not know') + grp('already', 'already in production') + grp('gone', 'shipped / cancelled / fulfilled')
      + grp('noline', 'not found on their order') + grp('noneed', 'nothing left to make') + grp('dup', 'repeat a line above') + grp('other', 'not Shopify orders')
      + '</div>',
    saveLabel: go.length + typed.length ? `Open ${nf(go.length + typed.length)} line(s)` : 'Nothing to open',
    onSave: async () => {
      if (!keys.length && !typed.length) return 'Nothing on the sheet can be opened now — see the list.';
      let all = keys;
      if (typed.length) {
        typed.forEach(l => { const meta = SHOP_META[l.o.id] || (SHOP_META[l.o.id] = {}); (meta.mk || (meta.mk = {}))[shpNoSkuKey(l.it)] = l.sku; });
        try { await saveShopMeta(); } catch (e) { return 'Could not save the SKUs on the orders: ' + (e.message || e) + ' — nothing opened.'; }
        soApplyTypedSkus(SO_ALL_ROWS);
        SHP_BUCKET_IX = { sig: null, list: null };
        const m2 = shpSheetMatch(rows, storeWant);
        all = m2.err ? keys : m2.lines.filter(l => l.st === 'open').map(l => l.key);
      }
      const err = await shpBucketRun(all, new Map(all.map(k => [k, why])));
      if (err) return err;
      const L = SHP_BUCKET_LAST || {};
      soMsg(`Pending sheet: opened ${nf(L.lines || 0)} production line(s) · ${nf(L.pcs || 0)} piece(s) across ${nf(L.orders || 0)} order(s).`
        + ((L.skipped || []).length ? ' Skipped: ' + L.skipped.join(' · ') : ''));
      try { renderShop(); } catch (e) { /* not on that tab */ }
      return '';
    },
  });
  if ($('shbSheetList')) $('shbSheetList').onclick = () => shpSheetListOut(m);
}

/** The bucket, on screen — design 7, the header band. SHB holds the tab, the filters and what is ticked. */
let SHB = { tab: 'make', q: '', store: '', date: '', from: '', nos: '', picked: new Set(), sku: {} };
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
/** The Without SKU tab's footer and Save button: how many lines have a SKU typed. */
function shbNosFoot(nos) {
  nos = nos || shpNoSkuLines();
  const typed = nos.filter(x => String(SHB.sku[x.key] || '').trim()).length, none = nos.filter(x => !x.guess).length;
  if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = `<span class="vo-tot"><b>${nf(typed)} typed</b> · ${nf(none)} line(s) cannot open · a typed SKU must be in the Master Database; saved, the line moves to Needs production</span>`;
  if ($('ptDlgSave')) { $('ptDlgSave').textContent = typed ? `Save ${nf(typed)} SKU${typed === 1 ? '' : 's'}` : 'Save typed SKUs'; $('ptDlgSave').disabled = !typed; }
}
/** Save the SKUs typed on the Without SKU tab, each on its own order exactly as the order dialog's box saves it
 * (SHOP_META[id].mk). Only a SKU the master database or the custom list knows — one it does not stops the save, so a
 * typo is never turned into a product and nothing is half-written. '' when saved; SHP_NOSKU_LAST says how many. */
let SHP_NOSKU_LAST = 0;
async function shpNoSkuSave(typed) {
  const byKey = new Map(shpNoSkuLines().map(x => [x.key, x]));
  const want = Object.entries(typed || {}).map(([key, v]) => ({ x: byKey.get(key), sku: obUC(v).replace(/\s+/g, '') })).filter(w => w.x && w.sku);
  if (!want.length) return 'Type a SKU on at least one line first.';
  if (SHP_CUSTOM === null) { try { SHP_CUSTOM = ptList(await ptGet('pt_customSkus')); } catch (e) { SHP_CUSTOM = []; } }
  const known = new Set((PTG.mdb || []).map(x => obUC(x && x.sku)).concat((SHP_CUSTOM || []).map(x => obUC(x && x.sku))));
  const bad = want.filter(w => known.size && !known.has(w.sku));
  if (bad.length) return 'Not in the Master Database: ' + bad.map(w => w.sku + ' (' + w.x.o.no + ')').join(' · ') + ' — correct or clear them. Nothing saved.';
  const was = JSON.stringify(SHOP_META);
  want.forEach(w => { const meta = SHOP_META[w.x.id] || (SHOP_META[w.x.id] = {}); (meta.mk || (meta.mk = {}))[w.x.k] = w.sku; });
  try { await saveShopMeta(); }
  catch (e) { SHOP_META = JSON.parse(was); return 'Could not save the SKUs: ' + (e.message || e) + ' — nothing saved.'; }
  soApplyTypedSkus(SO_ALL_ROWS);
  SHP_BUCKET_IX = { sig: null, list: null };          // the bucket is cached on SHOP_META's identity
  SHP_NOSKU_LAST = want.length;
  return '';
}
function shbRender() {
  const list = SHB.list || [];
  const nMake = list.filter(x => x.kind === 'make').length, nCov = list.filter(x => x.kind === 'covered').length, done = shbOpenedToday();
  const nos = shpNoSkuLines();
  document.querySelectorAll('[data-shbtab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-shbtab') === SHB.tab));
  const lab = { make: `Needs production · ${nf(nMake)}`, covered: `Stock says it can fill · ${nf(nCov)}`, done: `Opened today · ${nf(done.length)}`,
    nosku: `Without SKU · ${nf(nos.length)}` };
  document.querySelectorAll('[data-shbtab]').forEach(b => { b.textContent = lab[b.getAttribute('data-shbtab')]; });
  if ($('shbNosN')) $('shbNosN').textContent = nf(nos.length);
  if ($('shbWhyWrap')) $('shbWhyWrap').classList.toggle('hide', SHB.tab !== 'covered');
  if ($('shbFrom')) $('shbFrom').classList.toggle('hide', SHB.tab !== 'covered');
  if ($('shbNos')) $('shbNos').classList.toggle('hide', SHB.tab !== 'nosku');
  const stockCell = (n, need) => n == null ? '<span class="muted">—</span>' : `<b class="${n >= need ? 'ok' : 'no'}">${nf(n)}</b>`;
  const itemCell = (name, img, sub) => `<div class="shb-item">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<div><b>${esc(name || '—')}</b>${sub ? `<div class="muted" style="font-size:11px">${esc(sub)}</div>` : ''}</div></div>`;
  let head, body;
  if (SHB.tab === 'nosku') {
    /* WITHOUT SKU: the line as Shopify names it, and a box for its SKU. A title the master matched is offered as the
     * placeholder; "use" puts it in the box. Nothing is written until Save typed SKUs. */
    const q = String(SHB.q || '').trim().toLowerCase(), now = Date.now();
    const days = { today: 1, d7: 7, d30: 30 }[SHB.date], older = SHB.date === 'older7';
    const rows = nos.filter(x => (!SHB.store || shbStore(x.o) === SHB.store)
      && (!SHB.nos || (SHB.nos === 'title' ? !!x.guess : !x.guess))
      && (!q || [x.o.no, x.name, x.variant, x.guess, SHB.sku[x.key]].join(' ').toLowerCase().includes(q))
      && (!SHB.date || (ms => !ms ? true : older ? now - ms > 7 * 864e5 : now - ms <= days * 864e5)(ptDtMs(x.o.at))));
    SHB.nshown = rows;
    head = '<th>Shopify order</th><th>Item in Shopify</th><th class="num">Qty</th><th>SKU</th><th>Status</th><th></th>';
    body = rows.slice(0, 300).map(x => {
      const url = typeof repShopOrderUrl === 'function' ? repShopOrderUrl(shbStore(x.o) === 'CPC' ? 'CPC' : 'SP', x.id) : '';
      const st = !x.guess ? '<span class="st st-rejected" title="Nothing in the Master Database matched the title — production cannot open it until it has a SKU">No SKU · cannot open</span>'
        : `<span class="st st-pending" title="The app read ${esc(x.guess)} from the title">SKU from title</span><div class="muted" style="font-size:10.5px">${x.inProd ? 'in production as ' : 'opens as '}${esc(x.guess)}</div>`;
      return `<tr><td style="text-align:left;white-space:nowrap"><b>${esc(x.o.no)}</b><div class="muted" style="font-size:11px">${esc(String(x.o.at || '').slice(0, 10))} · ${shbStore(x.o)}</div></td>`
        + `<td>${itemCell(x.name, x.img, x.variant)}</td><td class="num"><b>${nf(x.qty)}</b></td>`
        + `<td style="white-space:nowrap"><input data-shbsku="${esc(x.key)}" maxlength="40" value="${esc(SHB.sku[x.key] || '')}" placeholder="${esc(x.guess || 'Type SKU')}"`
        + ` style="width:170px;height:34px;font-family:ui-monospace,monospace;font-size:12px;text-transform:uppercase">`
        + (x.guess ? ` <a href="#" data-shbuse="${esc(x.key)}" style="font-size:12px" title="Put ${esc(x.guess)} in the box">use</a>` : '') + '</td>'
        + `<td style="text-align:left">${st}</td>`
        + `<td>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" style="font-size:12px">Open in Shopify</a>` : ''}</td></tr>`;
    }).join('') + (rows.length > 300 ? `<tr><td colspan="6" class="muted" style="padding:10px">Showing the newest 300 of ${nf(rows.length)} — narrow it with the search, store or date.</td></tr>` : '');
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
  $('shbTable').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="10" class="muted" style="padding:16px">${SHB.tab === 'done' ? 'Nothing opened from the bucket today.' : SHB.tab === 'nosku' ? 'No line without a SKU.' : 'Nothing here.'}</td></tr>`}</tbody>`;
  if (SHB.tab === 'nosku') return shbNosFoot(nos);
  const picked = list.filter(x => SHB.picked.has(x.key));
  const pcs = picked.reduce((t, x) => t + (Number(x.qty) || 0), 0), cov = picked.filter(x => x.kind === 'covered').length;
  if ($('ptDlgFootL')) $('ptDlgFootL').innerHTML = `<span class="vo-tot"><b>${nf(picked.length)} ticked</b> · ${nf(pcs)} pcs${cov ? ` · ${nf(cov)} stock-covered (reason needed)` : ''} · a line already open is skipped, never opened twice</span>`;
  if ($('ptDlgSave')) { $('ptDlgSave').textContent = picked.length ? `Open ${nf(picked.length)} production line${picked.length === 1 ? '' : 's'}` : 'Open ticked production lines'; $('ptDlgSave').disabled = !picked.length; }
}
async function shpBucketOpen() {
  /* THE ORDER BOOK FIRST (Ravi, 24 Oct: "refresh karte hai need production qty grow ho jati hai"). "Already open" is
   * read from the order book, and the Shopify tab never reads it — so after a page refresh the bucket counted every
   * line production already has as still needing production, and From production / Handed over / Opened today read 0.
   * Read once here (the same read "Open ticked production lines" makes); a wrong count is never shown in its place. */
  if (ptLack(PTG_ALL, 'ob')) {
    const btn = $('soBucket');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    soMsg('Reading the production order book…');
    try { await ptNeed(PTG_ALL, { why: 'bucket' }); } catch (e) { PTG.err = PTG.err || e.message || String(e); }
    if (btn) btn.disabled = false;
    if (ptLack(PTG_ALL, 'ob') || PTG.err) { soMsg('The production order book could not be read, so the bucket cannot say what is already open: ' + (PTG.err || 'nothing came back') + '. Try again.', true); return; }
    soMsg('');
  }
  /* A SKU NEEDS NO STOCK: without the stock read, the bucket still opens on its Without SKU tab; the tabs that judge
   * stock wait for it. (From production and Handed over were taken out on 2 Nov — shipping hands over in the Order Console.) */
  const stockOk = SHOP_STOCK_LOADED && SHOP_INDIA_LOADED && !SHOP_INDIA_ERR;
  const nNos = shpNoSkuLines().length;
  if (!stockOk && !nNos) { soMsg(SHOP_STOCK_DENIED ? SHOP_STOCK_DENIED_TXT : 'Stock has not been read yet — press Fetch orders, then open the bucket.', true); return; }
  if (!stockOk) SHB.tab = 'nosku';

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
        <div class="shb-n"><b id="shbNosN">${nf(nNos)}</b><span>without SKU</span></div>
        <button type="button" id="shbXlOut">Download Excel</button>
        <button type="button" id="shbSheetIn" title="Upload the team's Shopify export of pending lines — every line on it is opened in production">Open from pending sheet</button><input type="file" id="shbSheetFile" accept=".xlsx,.csv" class="hide"></div>`,
    html: `<div class="shb-bar"><div class="seg" role="tablist">
        <button type="button" class="segbtn" data-shbtab="make"></button><button type="button" class="segbtn" data-shbtab="covered"></button><button type="button" class="segbtn" data-shbtab="done"></button><button type="button" class="segbtn" data-shbtab="nosku" title="Lines Shopify sent with no SKU — type the SKU here and the line moves to Needs production"></button></div>
        <input id="shbQ" placeholder="Search order / SKU / item" value="${esc(SHB.q)}">
        <select id="shbStore"><option value="">All stores</option><option value="Ridhi">Ridhi</option><option value="CPC">CPC</option></select>
        <select id="shbFrom" title="Where the stock that can fill it is"><option value="">FBA or India</option><option value="fba">FBA can fill (MCF)</option><option value="india">India can fill</option></select>
        <select id="shbNos" class="hide" style="flex-basis:190px" title="Did the app read a SKU from the title?"><option value="">No SKU or from title</option><option value="none">No SKU (cannot open)</option><option value="title">SKU from title</option></select>
        <select id="shbDate"><option value="">Any date</option><option value="today">Today</option><option value="d7">Last 7 days</option><option value="d30">Last 30 days</option><option value="older7">Older than 7 days</option></select>
      </div>
      <label id="shbWhyWrap" class="shb-why hide"><span>Why make these anyway</span>
        <input id="shbWhy" placeholder="e.g. India stock is not really there — needed for every stock-covered line you tick"></label>
      <div class="xlwrap shb-wrap"><table class="xl" id="shbTable"></table></div>`,
    saveLabel: 'Open ticked production lines',
    onSave: async () => {
      if (SHB.tab === 'nosku') {
        const err = await shpNoSkuSave(SHB.sku);
        if (err) return err;
        SHB.sku = {};
        soMsg(`Saved the SKU on ${nf(SHP_NOSKU_LAST)} line(s) — they are in Needs production now.`);
        try { renderShop(); } catch (e) { /* not on that tab */ }
        setTimeout(() => shpBucketOpen(), 0);   // the window closes on a save; open it again, the saved lines gone from this tab
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
  if ($('shbSheetIn')) $('shbSheetIn').onclick = () => $('shbSheetFile').click();
  if ($('shbSheetFile')) $('shbSheetFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; shpSheetIn(f); };
  if ($('shbXlIn')) $('shbXlIn').onclick = () => $('shbXlFile').click();
  if ($('shbXlFile')) $('shbXlFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; shpBucketXlIn(f); };
  let shbT = null;
  if ($('shbQ')) $('shbQ').oninput = () => { clearTimeout(shbT); shbT = setTimeout(() => { SHB.q = $('shbQ').value; shbRender(); }, 180); };
  if ($('shbStore')) $('shbStore').onchange = () => { SHB.store = $('shbStore').value; shbRender(); };
  if ($('shbFrom')) $('shbFrom').onchange = () => { SHB.from = $('shbFrom').value; shbRender(); };
  if ($('shbNos')) { $('shbNos').value = SHB.nos || ''; $('shbNos').onchange = () => { SHB.nos = $('shbNos').value; shbRender(); }; }
  if ($('shbDate')) $('shbDate').onchange = () => { SHB.date = $('shbDate').value; shbRender(); };
  document.querySelectorAll('[data-shbtab]').forEach(b => { b.onclick = () => { SHB.tab = b.getAttribute('data-shbtab'); shbRender(); }; });
  /* A typed SKU is kept as it is typed, without redrawing the table (the box would lose the cursor); only the footer follows. */
  $('shbTable').oninput = e => { const t = e.target; if (t.getAttribute && t.getAttribute('data-shbsku')) { SHB.sku[t.getAttribute('data-shbsku')] = t.value; shbNosFoot(); } };
  $('shbTable').onclick = e => {
    const a = e.target && e.target.closest ? e.target.closest('[data-shbuse]') : null;
    if (!a) return;
    e.preventDefault();
    const x = (SHB.nshown || []).find(y => y.key === a.getAttribute('data-shbuse'));
    if (x) { SHB.sku[x.key] = x.guess; shbRender(); }
  };
  $('shbTable').onchange = e => {
    const t = e.target;
    if (t.getAttribute('data-shbsku')) return;
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
    /* A REPLACEMENT's line (returns.js, 2026-10-14) carries "REPL-…", not a Shopify id — Shopify has no such order to
     * find, and asking for it would only add calls to every sync. It is closed by production like any line. */
    if (!id || seen.has(id) || /^REPL-/.test(id)) return;
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

/** What a run did, in one line.
 * auto — the run that happens by itself on opening Shopify Orders. It no longer repeats the two standing notes, "N lines
 * are fulfilled on Shopify and stay open" and "N lines have no SKU" (Ravi, 14 Oct: "remove this"): they came up on every
 * visit and said the same thing each time. A run somebody starts (opening orders from the bucket) still says them. */
function shpSyncMsg(t, auto) {
  if (!t) return '';
  if (t.cancelled) return 'Nothing was sent to production.';
  if (t.err) return 'The Order Console could not be brought up to date: ' + t.err;
  const bits = [];
  if (t.done && !auto) bits.push(`${nf(t.done)} open production line(s) are fulfilled, cancelled or marked done on Shopify — they stay open until production hands them over`);
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
    if (noCode.length && !auto) {
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
  /* The returns team (returns-team.js) looks at orders; it never opens or closes production lines. */
  if (typeof SHOP_RET_ONLY === 'function' && SHOP_RET_ONLY()) return;
  if (SHP_BUSY) { SHP_AGAIN = where || SHP_AGAIN || ''; return; }
  if (!SHOP_STOCK_LOADED || !SHOP_INDIA_LOADED || SHOP_INDIA_ERR) return;
  if (!(SO_ALL_ROWS || []).length) return;
  SHP_BUSY = true;
  try {
    /* THE AUTOMATIC RUN OPENS NOTHING (Ravi, 2026-09-26) — it completes what Shopify has closed. Opening is the bucket's. */
    const t = await shpSyncAll({ maintain: true });
    let msg = shpSyncMsg(t, true);
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

