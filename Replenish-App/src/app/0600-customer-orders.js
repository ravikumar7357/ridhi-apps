/* ================= CUSTOMER ORDERS =================
 *
 * Shopify and Amazon orders, and the one decision each line needs: where is it coming from.
 *
 * THE WATERFALL, in the order the tool states it: Amazon first, then India finished goods, then an
 * adjustment, then production. Amazon first because a piece already at Amazon ships tomorrow and a
 * piece in Jaipur does not.
 *
 * BOTH FIGURES ARE LIVE HERE, and that is the difference from the old tool. Amazon comes from this
 * app's own replenishment snapshot — the FBA quantity it already carries — instead of a spreadsheet
 * somebody uploaded. India comes from the finished-goods store on the next tab. So the two numbers a
 * line is judged on are the same two numbers the rest of the app is working from.
 *
 * FULFILLING FROM INDIA ISSUES THE PIECES. It is not a label: an ISSUE row goes into the
 * finished-goods ledger naming this order, and the store drops by exactly that much. Marking a line
 * without moving the stock is how a store and its orders stop agreeing.
 *
 * WHAT IS NOT HERE, and is not pretended: parked goods with a warehouse and aisle, the printing
 * queue, and the adjustment production floor. None of those nodes has ever been written, so raising
 * an adjustment records the decision and stops there.
 */
const CX_STATUS = {
  'Open': { cls: '' },
  'Fulfilled-Amazon': { cls: 'pill-ok' },
  'Fulfilled-India': { cls: 'pill-ok' },
  'Adjustment Raised': { cls: 'pill-low' },
  'Adjustment Complete': { cls: 'pill-ok' },
  'Production Raised': { cls: 'pill-low' },
  'Production Complete': { cls: 'pill-ok' },
  'Cancelled': { cls: 'pill-out' },
};
const cxN = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const cxNewId = p => p + '_' + Date.now().toString(36) + '_' + (CX_SEQ++).toString(36) + Math.random().toString(36).slice(2, 5);
let CX_SEQ = 0;

let CX = { rows: null, err: '', busy: false, at: '', shown: [] };

async function ensureCx() {
  if (CX.rows === null) {
    CX.busy = true; renderCx();
    if (!PTG.mdb) await ptLoadGates();
    if (FGI.rows === null) { try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { FGI.rows = []; } }
    try { CX.rows = ptList(await ptGet('pt_cxOrders')); CX.err = ''; }
    catch (e) { CX.err = e.message || String(e); CX.rows = CX.rows || []; }
    CX.at = ptStamp(); CX.busy = false;
  }
  renderCx();
}

/** What Amazon is holding for this SKU, less anything already promised to a line since. */
function cxAmz(sku) {
  const m = replRowMap()[obUC(sku)];
  /* totalStock is what FBA holds; `fba` was read here and no snapshot row has ever carried it, so every SKU read
   * as "not in the snapshot" (found 2026-09-26). */
  const have = m ? (Number(m.totalStock != null ? m.totalStock : m.fba) || 0) : null;
  if (have === null) return null;                       // not in the snapshot at all — say so, do not say nil
  const taken = (CX.rows || []).filter(l => l && l.status === 'Fulfilled-Amazon' && obUC(l.sku) === obUC(sku))
    .reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
  return Math.max(0, have - taken);
}
const cxIndia = sku => fgiOf(sku).current;

function renderCx() {
  if (CX.busy) { $('cxMsg').className = 'muted'; $('cxMsg').textContent = 'Reading the customer orders…'; ptEmpty('cxTable', 'Loading…'); return; }
  if (CX.err) { $('cxMsg').className = 'err'; $('cxMsg').textContent = 'Could not read it: ' + CX.err; ptEmpty('cxTable', 'Nothing to show.'); $('cxKpis').innerHTML = ''; return; }
  const all = CX.rows || [];

  ptFillSelect('cxChan', [...new Set(all.map(r => String(r.channel || '').trim()).filter(Boolean))].sort().map(c => [c, c]), 'All channels');
  const fSt = $('cxStat').value, fCh = $('cxChan').value, q = $('cxQ').value.trim().toLowerCase();
  const rows = all
    .filter(r => !fSt || (r.status || 'Open') === fSt)
    .filter(r => !fCh || String(r.channel || '').trim() === fCh)
    .filter(r => !q || [r.orderNo, r.sku, r.articleType, r.color, r.size, r.channel, r.remarks].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(b.orderDate || '').localeCompare(String(a.orderDate || ''))
      || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  CX.shown = rows;

  const open = all.filter(r => (r.status || 'Open') === 'Open');
  const c = s => all.filter(r => (r.status || 'Open') === s).length;
  /* Of the open lines, how many could go today and from where. */
  let fromAmz = 0, fromIndia = 0, nowhere = 0;
  open.forEach(r => {
    const q0 = parseInt(r.qty, 10) || 0;
    if ((cxAmz(r.sku) || 0) >= q0) fromAmz++;
    else if (cxIndia(r.sku) >= q0) fromIndia++;
    else nowhere++;
  });
  $('cxKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Customer orders</span>
      <span class="kpiwhen">Amazon stock from this app's snapshot · India stock from Finished Goods${CX.at ? ' · ' + esc(CX.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(all.length)}</div><div class="l">Lines</div></div>
      <div class="metric"><div class="v" style="color:#7f6000">${nf(open.length)}</div><div class="l">Still open</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(fromAmz)}</div><div class="l">Amazon can cover</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(fromIndia)}</div><div class="l">India can cover</div></div>
      <div class="metric"><div class="v"${nowhere ? ' style="color:var(--bad)"' : ''}>${nf(nowhere)}</div><div class="l">Neither — needs making</div></div>
      <div class="metric"><div class="v">${nf(c('Fulfilled-Amazon') + c('Fulfilled-India'))}</div><div class="l">Fulfilled</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Order', 'Date', 'Channel', 'SKU', 'Image', 'Item', 'Qty', 'At Amazon', 'In India', 'Status', 'Where from', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 6 && i <= 8 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('cxTable').innerHTML = head + '<tbody>' + (rows.length ? rows.slice(0, 600).map(r => {
    const q0 = parseInt(r.qty, 10) || 0, st = r.status || 'Open';
    const a = cxAmz(r.sku), i = cxIndia(r.sku);
    const cell = (v, need) => v === null ? '<span class="muted">not listed</span>'
      : `<span style="font-weight:700;color:${v >= need ? 'var(--accent)' : (v > 0 ? '#7f6000' : 'var(--muted)')}">${nf(v)}</span>`;
    return `<tr${st === 'Cancelled' ? ' style="opacity:.55"' : ''}>`
      + `<td class="frz" style="text-align:left;font-weight:600">${esc(r.orderNo)}</td>`
      + `<td>${esc(r.orderDate)}</td><td>${esc(r.channel)}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}`
      + `${r.skuResolved === false ? ' <span class="pill pill-out">not in the master DB</span>' : ''}</td>`
      + ptImgCell(r.sku)
      + `<td style="text-align:left;font-size:11.5px">${esc([r.articleType, r.color, r.size].filter(Boolean).join(' · '))}</td>`
      + `<td class="num" style="font-weight:700">${nf(q0)}</td>`
      + `<td class="num">${cell(a, q0)}</td><td class="num">${cell(i, q0)}</td>`
      + `<td><span class="pill ${(CX_STATUS[st] || {}).cls || ''}">${esc(st)}</span></td>`
      + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(r.routeRef)}</td>`
      + `<td>${ME.admin ? `<button class="ghost" data-cx="${esc(r.id || r._key)}" style="padding:3px 10px;font-size:12px">${st === 'Open' ? 'Decide' : 'Open'}</button>` : ''}</td></tr>`;
  }).join('') : `<tr><td colspan="12" class="muted" style="padding:16px">No customer orders yet — upload a file to start.</td></tr>`) + '</tbody>';

  $('cxMsg').className = nowhere ? 'err' : 'muted';
  $('cxMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} line(s)`
    + (rows.length > 600 ? ' · showing the first 600' : '')
    + ' · Amazon first, then India — a piece already at Amazon ships tomorrow'
    + (nowhere ? ` · ${nf(nowhere)} open line(s) have neither and have to be made` : '');
  ptImgFill(rows.slice(0, 600).map(r => r.sku), false, ptImgPatch);
}

/* ---- the decision ---- */
function cxOpen(id) {
  const l = (CX.rows || []).find(x => (x.id || x._key) === id); if (!l) return;
  const q0 = parseInt(l.qty, 10) || 0, st = l.status || 'Open';
  const a = cxAmz(l.sku), i = cxIndia(l.sku);
  const line = (label, v, ok) => `<div style="display:flex;justify-content:space-between;padding:6px 0">
    <span>${esc(label)}</span><b style="color:${ok ? 'var(--accent)' : 'var(--muted)'}">${v === null ? 'not listed on Amazon' : nf(v) + ' piece(s)'}</b></div>`;
  ptOpenDialog({
    title: l.orderNo + ' · ' + obUC(l.sku),
    subtitle: [l.channel, l.articleType, l.color, l.size].filter(Boolean).join(' · ') + '  ·  ' + nf(q0) + ' piece(s)',
    note: st !== 'Open'
      ? `This line is already ${st}${l.routeRef ? ' — ' + l.routeRef : ''}.`
      : 'Amazon first: a piece already there ships tomorrow. India next, which issues the pieces out '
        + 'of the finished-goods store. If neither covers it, raise an adjustment so it is on record.',
    html: `<div class="ptbox"><div class="ptbox-t">What could cover it</div>
        ${line('At Amazon', a, a !== null && a >= q0)}
        ${line('In India, finished goods', i, i >= q0)}
      </div>${l.remarks ? `<div class="muted" style="margin-top:8px;font-size:12.5px">Remarks: ${esc(l.remarks)}</div>` : ''}`
      + (st === 'Open' ? `<div class="toolbar" style="margin-top:12px">
        <button id="cxwAmz"${a !== null && a >= q0 ? '' : ' disabled'}>Fulfil from Amazon</button>
        <button id="cxwInd"${i >= q0 ? '' : ' disabled'}>Fulfil from India</button>
        <button id="cxwAdj" class="ghost">Raise an adjustment</button>
        <button id="cxwCxl" class="ghost" style="color:var(--bad)">Cancel this line</button>
      </div><div id="cxwMsg" class="muted" style="margin-top:8px;font-size:12.5px"></div>` : ''),
    onDelete: ME.admin ? (() => cxDelete(id)) : null,
    deleteWhat: `${l.orderNo} · ${obUC(l.sku)} · ${nf(q0)} piece(s)`
      + (st === 'Fulfilled-India' ? ' — its issue from the store is NOT undone by this' : ''),
  });
  if (st !== 'Open') return;
  const run = async fn => {
    ['cxwAmz', 'cxwInd', 'cxwAdj', 'cxwCxl'].forEach(b => { if ($(b)) $(b).disabled = true; });
    $('cxwMsg').className = 'muted'; $('cxwMsg').textContent = 'Saving…';
    try { const err = await fn(); if (err) { $('cxwMsg').className = 'err'; $('cxwMsg').textContent = err; }
      else ptDlgClose(); }
    catch (e) { $('cxwMsg').className = 'err'; $('cxwMsg').textContent = 'Not saved: ' + (e.message || e); }
    ['cxwAmz', 'cxwInd', 'cxwAdj', 'cxwCxl'].forEach(b => { if ($(b)) $(b).disabled = false; });
  };
  $('cxwAmz').onclick = () => run(() => cxSet(id, 'Fulfilled-Amazon', 'Amazon FBA'));
  $('cxwInd').onclick = () => run(() => cxFromIndia(id));
  $('cxwAdj').onclick = () => run(() => cxSet(id, 'Adjustment Raised', 'raised, not yet on the floor'));
  $('cxwCxl').onclick = () => run(() => cxSet(id, 'Cancelled', ''));
}

async function cxSet(id, status, route) {
  if (!ME.admin) return 'Only an admin can act on a line.';
  const l = (CX.rows || []).find(x => (x.id || x._key) === id); if (!l) return 'That line is gone.';
  if ((l.status || 'Open') !== 'Open') return 'That line has already been decided.';
  if (status === 'Fulfilled-Amazon') {
    /* Read again at the moment of saving — the figure on screen could be minutes old. */
    const a = cxAmz(l.sku), q0 = parseInt(l.qty, 10) || 0;
    if (a === null || a < q0) return `Amazon has ${a === null ? 'no record of' : nf(a) + ' piece(s) of'} ${obUC(l.sku)} now, and this line needs ${nf(q0)}.`;
  }
  const next = Object.assign({}, l, { status, routeRef: route, actedBy: ME.email, actedAt: new Date().toISOString() });
  await ptPut('pt_cxOrders/' + (l.id || l._key), next);
  CX.rows = (CX.rows || []).map(x => ((x.id || x._key) === id ? next : x));
  renderCx();
  $('cxMsg').className = 'muted';
  $('cxMsg').textContent = `${l.orderNo} · ${obUC(l.sku)} → ${status}.`;
  return '';
}

/** India means the store actually gives the pieces up — an ISSUE row, not a label. */
async function cxFromIndia(id) {
  if (!ME.admin) return 'Only an admin can act on a line.';
  const l = (CX.rows || []).find(x => (x.id || x._key) === id); if (!l) return 'That line is gone.';
  if ((l.status || 'Open') !== 'Open') return 'That line has already been decided.';
  const q0 = parseInt(l.qty, 10) || 0;
  const have = cxIndia(l.sku);
  if (have < q0) return `You don't have enough stock — ${obUC(l.sku)} has ${nf(have)} piece(s) in the India Store`
    + ` and this line needs ${nf(q0)}.`;
  const now = new Date().toISOString();
  const d = new Date(), p = x => String(x).padStart(2, '0');
  const issue = { _id: fgiNewId('CXO'), txnType: 'ISSUE', sku: obUC(l.sku), qty: q0,
    date: p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(),
    issuedFor: 'Customer order ' + l.orderNo, reason: l.channel || '',
    remarks: 'Issued from the Customer Orders screen', cxOrderId: l.id || l._key,
    createdAt: now, createdBy: ME.email };
  const next = Object.assign({}, l, { status: 'Fulfilled-India', routeRef: 'issued from the store',
    fgiIssueId: issue._id, actedBy: ME.email, actedAt: now });
  /* Both in one write: a fulfilled line whose pieces never left, or pieces gone with no line to
   * explain them, are each worse than the change not happening. */
  await ptPatch({ ['pt_fgiLedger/' + issue._id]: issue, ['pt_cxOrders/' + (l.id || l._key)]: next });
  FGI.rows = (FGI.rows || []).concat(issue);
  CX.rows = (CX.rows || []).map(x => ((x.id || x._key) === id ? next : x));
  renderCx();
  $('cxMsg').className = 'muted';
  $('cxMsg').textContent = `${nf(q0)} piece(s) of ${obUC(l.sku)} issued from the store for ${l.orderNo} — `
    + `${nf(cxIndia(l.sku))} left. The issue is in Finished Goods, under this order's number.`;
  return '';
}

async function cxDelete(id) {
  if (!ME.admin) return 'Only an admin can delete a line.';
  const l = (CX.rows || []).find(x => (x.id || x._key) === id); if (!l) return 'That line is gone already.';
  await ptDelete('pt_cxOrders/' + (l.id || l._key));
  CX.rows = (CX.rows || []).filter(x => (x.id || x._key) !== id);
  renderCx();
  $('cxMsg').className = l.status === 'Fulfilled-India' ? 'err' : 'muted';
  /* Deleting the line does not put the pieces back. Saying so is the difference between a tidy-up
   * and a store that quietly disagrees with itself. */
  $('cxMsg').textContent = `${l.orderNo} · ${obUC(l.sku)} deleted.`
    + (l.status === 'Fulfilled-India' ? ' Its issue from the store is still there — delete that in Finished Goods too if the pieces really did not go.' : '');
  return '';
}

/* ---- uploading a day's orders ---- */
function cxUploadOpen() {
  ptOpenDialog({
    title: 'Upload customer orders',
    subtitle: 'One row per SKU line',
    note: 'Order No and Qty are required. Give either a SKU, or the full Article Type, Colour and '
      + 'Size so the SKU can be found. A line already on this screen is skipped, so re-uploading the '
      + 'same file adds nothing twice.',
    html: `<div class="toolbar"><button id="cxuTmpl" class="ghost">Template</button>
        <button id="cxuPick">Choose a file</button>
        <input id="cxuFile" type="file" accept=".csv,.xlsx,text/csv" style="display:none">
      </div><div id="cxuInfo" class="muted" style="margin-top:10px;font-size:12.5px"></div>`,
    onSave: () => cxUploadSave(),
    saveLabel: 'Add the lines',
  });
  CXU = { rows: null, name: '', dupes: 0, unknown: 0 };
  $('cxuTmpl').onclick = () => ptDownload('customer-orders', [
    ['Order No', 'Order Date', 'Channel', 'SKU', 'Article Type', 'Color', 'Size', 'Qty', 'Remarks'].map(csvCell).join(','),
    ['SHOP-1188', '08-08-2026', 'Shopify', 'RTC301-6090', '', '', '', 2, ''].map(csvCell).join(','),
    ['SHOP-1189', '08-08-2026', 'Shopify', '', 'Tablecloth', 'Bubblegum Pink', '60 Round', 1, 'gift wrap'].map(csvCell).join(','),
  ]);
  $('cxuPick').onclick = () => $('cxuFile').click();
  $('cxuFile').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) cxUploadRead(f); e.target.value = ''; };
}

let CXU = { rows: null, name: '', dupes: 0, unknown: 0 };

async function cxUploadRead(file) {
  ptDlgMsg('Reading ' + file.name + '…');
  let rows;
  try { rows = await pkReadFile(file); }
  catch (e) { ptDlgMsg('Could not read that file: ' + (e.message || e), true); return; }
  let h = -1;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const low = (rows[i] || []).map(x => cxN(x));
    if (low.some(x => /^order ?no|order number|order id$/.test(x))) { h = i; break; }
  }
  if (h < 0) { ptDlgMsg('That file has no "Order No" column. Download the template to see the shape.', true); return; }
  const low = rows[h].map(cxN);
  const at = names => { for (const n of names) { const i = low.findIndex(x => x === n); if (i >= 0) return i; } return -1; };
  const c = { no: at(['order no', 'orderno', 'order number', 'order id']), date: at(['order date', 'date']),
    chan: at(['channel', 'platform', 'source']), sku: at(['sku']),
    art: at(['article type', 'articletype', 'article']), sub: at(['article subtype', 'subtype']),
    col: at(['color', 'colour']), size: at(['size']),
    qty: at(['qty', 'quantity', 'pieces', 'pcs', 'qty (production facing)']), rem: at(['remarks', 'notes', 'note']) };
  if (c.qty < 0) { ptDlgMsg('That file has no quantity column.', true); return; }

  const errors = [], out = [], seen = new Set();
  let dupes = 0, unknown = 0;
  const have = new Set((CX.rows || []).map(l => cxN(l.orderNo) + '|' + cxN(l.sku || (l.articleType + l.color + l.size))));
  rows.slice(h + 1).forEach((r, n) => {
    const g = i => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '');
    const no = g(c.no), qtyRaw = g(c.qty);
    let sku = obUC(g(c.sku)), art = g(c.art), sub = g(c.sub), col = g(c.col), size = g(c.size);
    if (!no && !qtyRaw && !sku && !art) return;                       // a blank row is not an error
    const row = 'Row ' + (n + h + 2) + ': ';
    if (!no) { errors.push(row + 'no order number.'); return; }
    if (!/^\d+$/.test(qtyRaw) || +qtyRaw <= 0) { errors.push(row + `the quantity must be a whole number, not "${qtyRaw}".`); return; }
    const qty = +qtyRaw;
    let resolved = false;
    if (sku) {
      const m = (PTG.mdb || []).find(x => x && obUC(x.sku) === sku);
      if (m) { art = m.articleType || ''; sub = m.subtype || ''; col = m.color || ''; size = m.size || ''; resolved = true; }
      else unknown++;
    } else if (art && col && size) {
      /* Find the SKU from the combination, the same way every other screen here does. */
      const m = (PTG.mdb || []).find(x => x && ptNorm(x.articleType) === ptNorm(art)
        && ptNorm(x.color) === ptNorm(col) && ptNorm(x.size) === ptNorm(size)
        && (!sub || ptNorm(x.subtype) === ptNorm(sub)));
      if (m) { sku = obUC(m.sku); sub = m.subtype || sub; resolved = true; } else unknown++;
    } else { errors.push(row + 'give either a SKU, or the article type, colour and size together.'); return; }
    if (!resolved && !(art && col && size)) {
      errors.push(row + `${sku} is not in the master database — give the article type, colour and size as well.`); return;
    }
    const key = cxN(no) + '|' + cxN(sku || (art + col + size));
    if (seen.has(key) || have.has(key)) { dupes++; return; }
    seen.add(key);
    out.push({ id: cxNewId('cxo'), orderNo: no, orderDate: g(c.date) || dToday(), channel: g(c.chan),
      sku, skuResolved: resolved, articleType: art, articleSubtype: sub, color: col, size,
      qty, remarks: g(c.rem), status: 'Open', routeRef: '',
      uploadedBy: ME.email, uploadedAt: new Date().toISOString() });
  });
  /* One bad row rejects the file — a part-loaded day is worse than none, because nobody can tell
   * which orders are missing. */
  if (errors.length) { ptDlgMsg('Nothing was loaded. ' + errors.slice(0, 5).join(' ')
    + (errors.length > 5 ? ` …and ${nf(errors.length - 5)} more.` : ''), true); return; }
  CXU = { rows: out, name: file.name, dupes, unknown };
  ptDlgMsg('');
  $('cxuInfo').className = unknown ? 'err' : 'muted';
  $('cxuInfo').innerHTML = `<b>${esc(file.name)}</b> · ${nf(out.length)} new line(s), `
    + `${nf(out.reduce((s, r) => s + r.qty, 0))} piece(s).`
    + (dupes ? ` ${nf(dupes)} line(s) are already on this screen and were skipped.` : '')
    + (unknown ? `<br>${nf(unknown)} line(s) name a SKU the master database does not have; they come in `
      + 'flagged, so they can be seen and fixed rather than quietly dropped.' : '');
}

async function cxUploadSave() {
  if (!ME.admin) return 'Only an admin can upload orders.';
  if (!CXU.rows || !CXU.rows.length) return 'Choose a file first.';
  const upd = {};
  CXU.rows.forEach(r => { upd['pt_cxOrders/' + r.id] = r; });
  await ptPatch(upd);
  CX.rows = (CX.rows || []).concat(CXU.rows);
  renderCx();
  $('cxMsg').className = 'muted';
  $('cxMsg').textContent = `${nf(CXU.rows.length)} line(s) added from ${CXU.name}.`
    + (CXU.dupes ? ` ${nf(CXU.dupes)} already here and skipped.` : '')
    + (CXU.unknown ? ` ${nf(CXU.unknown)} carry a SKU the master database does not have.` : '');
  CXU = { rows: null, name: '', dupes: 0, unknown: 0 };
  return '';
}

$('cxTable').addEventListener('click', e => {
  const b = e.target.closest('[data-cx]'); if (b) cxOpen(b.getAttribute('data-cx'));
});
['cxStat', 'cxChan'].forEach(id => $(id).addEventListener('change', renderCx));
ptDebounce('cxQ', renderCx);
$('cxGo').onclick = async () => { CX.rows = null; FGI.rows = null; await ensureCx(); };
$('cxUpload').onclick = () => cxUploadOpen();
$('cxExport').onclick = () => {
  const rows = CX.shown || []; if (!rows.length) return;
  ptDownload('customer-orders', [['Order', 'Date', 'Channel', 'SKU', 'Article', 'Colour', 'Size', 'Qty',
    'At Amazon', 'In India', 'Status', 'Where from', 'Acted by'].map(csvCell).join(',')]
    .concat(rows.map(r => [r.orderNo, r.orderDate, r.channel, r.sku, r.articleType, r.color, r.size,
      r.qty, cxAmz(r.sku), cxIndia(r.sku), r.status || 'Open', r.routeRef, r.actedBy].map(csvCell).join(','))));
};

