/* ================= SHIP FROM EXCEL ================= */
const FBA_STALE_DAYS = 3;
/** Accepted this many days ago or more and still not shipped. */
const fbaStale = r => { const s = fbaState(r); if (s.st !== 'accepted') return 0;
  const ms = Date.parse(r.fbaAcceptedAt || ''); return ms ? Math.floor((Date.now() - ms) / 864e5) : 0; };

/**
 * The rows of a shipment file, read into { row, shipment, sku, qty, date }. Two shapes:
 *   Seller Central's shipment contents — "Shipment ID" beside its value somewhere above a table that has
 *   "Merchant SKU" and "Shipped" (or "Units expected");
 *   our template — Shipment ID, SKU, Pieces, Ship date as columns.
 */
function fbaShipXlRead(rows) {
  const cells = r => (r || []).map(c => String(c == null ? '' : c).replace(/^\uFEFF/, '').trim());
  const R = (rows || []).map(cells);
  const hi = R.findIndex(r => r.some(c => /^(merchant sku|sku|seller sku)$/i.test(c)));
  if (hi < 0) return { err: 'No SKU column was found — the file needs a "SKU" or "Merchant SKU" column.' };
  const H = R[hi].map(c => c.toLowerCase());
  const col = names => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iSku = col(['merchant sku', 'sku', 'seller sku']);
  const iQty = col(['shipped', 'units shipped', 'pieces', 'pcs', 'qty', 'quantity', 'units expected', 'units', 'boxed quantity']);
  const iShp = col(['shipment id', 'shipment', 'fba shipment id']);
  const iDate = col(['ship date', 'date', 'shipped on']);
  if (iQty < 0) return { err: 'No pieces column was found — the file needs "Shipped", "Units expected" or "Pieces".' };
  /* A Seller Central file names its shipment once, above the table. */
  let fileShp = '';
  for (let i = 0; i < hi; i++) { const r = R[i]; const k = r.findIndex(c => /^shipment id$/i.test(c)); if (k >= 0 && r[k + 1]) { fileShp = r[k + 1]; break; } }
  if (iShp < 0 && !fileShp) return { err: 'No shipment id was found — put a "Shipment ID" column, or use the file Seller Central gives for the shipment.' };
  const out = [];
  for (let i = hi + 1; i < R.length; i++) {
    const r = R[i], sku = obUC(r[iSku] || '');
    if (!sku) continue;
    out.push({ row: i + 1, sku, qty: r[iQty] || '', shipment: String((iShp >= 0 ? r[iShp] : '') || fileShp).trim(), date: iDate >= 0 ? r[iDate] || '' : '' });
  }
  if (!out.length) return { err: 'The file has no rows under its headings.' };
  return { entries: out };
}

/** What the file would ship: each row matched to its SKU's open dispatches, oldest first, whole dispatches only. */
function fbaShipXlPlan(entries) {
  const taken = new Set();
  const open = sku => fbaAll().filter(r => obUC(r.sku) === sku && ['waiting', 'accepted'].indexOf(fbaState(r).st) >= 0 && !taken.has(fgiRowId(r)))
    .sort((a, b) => (ptDtMs(a.date) || Date.parse(a.createdAt || '') || 0) - (ptDtMs(b.date) || Date.parse(b.createdAt || '') || 0)
      || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  const items = (entries || []).map(e => {
    const it = { e, picks: [], pcs: 0, left: 0, err: '', note: '' };
    const qty = Number(String(e.qty).replace(/,/g, ''));
    if (!e.shipment) { it.err = 'no shipment id'; return it; }
    if (!(qty > 0) || Math.round(qty) !== qty) { it.err = `pieces "${e.qty}" is not a whole number`; return it; }
    let left = qty;
    const list = open(e.sku);
    for (const r of list) {
      const o = fbaState(r).open;
      if (o > left) { if (left > 0) it.note = `the next dispatch of ${e.sku} has ${nf(o)} open — more than the ${nf(left)} left, so it is not split; ship it on its row`; break; }
      it.picks.push(r); taken.add(fgiRowId(r)); it.pcs += o; left -= o;
      if (!left) break;
    }
    it.left = left;
    if (!list.length) it.err = `no open dispatch of ${e.sku} — nothing the store sent is waiting to ship`;
    return it;
  });
  return { items, ids: items.flatMap(it => it.picks.map(fgiRowId)) };
}

/** Write it: every matched dispatch shipped under its row's shipment id, in one patch, each re-read first. */
async function fbaShipXlRun(plan) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can ship a dispatch.';
  const pairs = plan.items.flatMap(it => it.picks.map(r => [fgiRowId(r), it.e]));
  if (!pairs.length) return 'Nothing in the file matches an open dispatch.';
  const fresh = await fbaFresh(pairs.map(p => p[0]));
  const now = new Date().toISOString(), updates = {}, done = [], skipped = [];
  fresh.forEach(({ id, row }, i) => {
    const e = pairs[i][1];
    if (!row) return skipped.push({ id, why: 'deleted from the store' });
    const st = fbaState(row).st;
    if (st !== 'waiting' && st !== 'accepted') return skipped.push({ id, why: 'already ' + FBA_PILL[st][1] });
    const iso = e.date ? (ptIsoDate(e.date) || '') : '';
    const set = { fbaShippedAt: now, fbaShippedBy: ME.email, fbaShipment: e.shipment, fbaShipDate: fgiDmy(iso || dToday()) || fgiDmy(dToday()), fbaShipVia: 'excel' };
    if (!row.fbaAcceptedAt) { set.fbaAcceptedAt = now; set.fbaAcceptedBy = ME.email; }
    Object.keys(set).forEach(f => { updates['pt_fgiLedger/' + id + '/' + f] = set[f]; });
    done.push([row, set]);
  });
  fbaForget(fresh);
  if (!done.length) { renderFba(); return 'Nothing was shipped' + fbaSkipText(skipped) + '.'; }
  await ptPatch(updates);
  done.forEach(([r, set]) => Object.assign(r, set));
  renderFba();
  const shp = [...new Set(done.map(([, set]) => set.fbaShipment))];
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = `${nf(done.length)} dispatch(es) · ${nf(done.reduce((t, [r]) => t + fbaState(r).open, 0))} piece(s) shipped as ${shp.join(', ')}` + fbaSkipText(skipped) + '.';
  return '';
}

async function fbaShipXlFile(file) {
  if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer()))
      : ((t => parseCsv(t, /\t/.test(t.split('\n').slice(0, 12).join('\n')) ? '\t' : undefined))(await file.text()));
    const read = fbaShipXlRead(rows);
    if (read.err) { $('fbaMsg').className = 'err'; $('fbaMsg').textContent = read.err; return; }
    const plan = fbaShipXlPlan(read.entries);
    const ok = plan.items.filter(it => it.picks.length), bad = plan.items.filter(it => !it.picks.length || it.left);
    const pcs = ok.reduce((t, it) => t + it.pcs, 0);
    ptOpenDialog({
      title: 'Ship from Excel',
      subtitle: `${nf(plan.ids.length)} dispatch(es) · ${nf(pcs)} piece(s) · shipment ${[...new Set(ok.map(it => it.e.shipment))].join(', ') || '—'}`,
      wide: true,
      note: 'Each SKU in the file is matched to the dispatches the store sent of it and are still open, oldest first — whole dispatches only. '
        + 'Nothing is split and nothing goes back to the store from here; what does not match is listed below, to ship on its own row.',
      html: '<div class="xlwrap" style="max-height:48vh;border:1px solid var(--line);border-radius:10px"><table class="xl"><thead><tr>'
        + '<th>Row</th><th>Shipment</th><th>SKU</th><th class="num">In file</th><th class="num">Matched</th><th class="num">Dispatches</th><th>Left over</th></tr></thead><tbody>'
        + plan.items.map(it => `<tr><td>${it.e.row}</td><td style="font-family:ui-monospace,monospace">${esc(it.e.shipment)}</td>`
          + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(it.e.sku)}</td><td class="num">${esc(String(it.e.qty))}</td>`
          + `<td class="num">${it.pcs ? '<b>' + nf(it.pcs) + '</b>' : '—'}</td><td class="num">${nf(it.picks.length)}</td>`
          + `<td style="text-align:left;font-size:12px${it.err || it.left ? ';color:var(--bad)' : ''}">${it.err ? esc(it.err) : (it.left ? nf(it.left) + ' not matched' + (it.note ? ' — ' + esc(it.note) : '') : '<span class="muted">—</span>')}</td></tr>`).join('')
        + '</tbody></table></div>'
        + (bad.length ? `<div class="err" style="margin-top:8px;font-size:12.5px">${nf(bad.length)} row(s) not fully matched — the matched part still ships.</div>` : ''),
      saveLabel: plan.ids.length ? `Ship ${nf(plan.ids.length)} dispatch(es)` : 'Nothing to ship',
      onSave: () => fbaShipXlRun(plan),
    });
  } catch (e) { $('fbaMsg').className = 'err'; $('fbaMsg').textContent = 'Could not read the file: ' + (e.message || e); }
}

function fbaShipOpen(ids) {
  if (!fbaCan() || !ids.length) return;
  const rows = ids.map(id => (FGI.rows || []).find(x => fgiRowId(x) === id)).filter(Boolean);
  const one = rows.length === 1 ? rows[0] : null;
  const open = rows.reduce((t, r) => t + fbaState(r).open, 0);
  ptOpenDialog({
    title: one ? `Ship ${obUC(one.sku)}` : `Ship ${nf(rows.length)} dispatch(es)`,
    subtitle: `${nf(open)} piece(s) open`,
    note: one
      ? 'Put in the Amazon shipment id. If fewer pieces are going than are open, the rest go back to the store — say why.'
      : 'Every ticked dispatch ships in full under the same shipment id. To ship part of one, use Ship on its row.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Shipment id<input id="fbsShipment" type="text" placeholder="FBA15…" style="font-family:ui-monospace,monospace"></label>
        <label>Ship date<input id="fbsDate" type="date" value="${esc(dToday())}"></label>
        ${one ? `<label>Pieces shipped<input id="fbsQty" type="number" min="1" step="1" value="${esc(fbaState(one).open)}"></label>
        <label>If fewer — why the rest come back<input id="fbsReason" type="text" placeholder="e.g. damaged, not in the plan"></label>` : ''}
        <label style="grid-column:1/-1">Note<input id="fbsRemarks" type="text" placeholder="optional"></label>
      </div>`,
    onSave: () => fbaShipSave(ids),
    saveLabel: 'Mark shipped',
  });
}

async function fbaShipSave(ids) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can ship a dispatch.';
  const v = id => String((($(id) || {}).value) || '').trim();
  const shipment = v('fbsShipment');
  if (!shipment) return 'Put in the shipment id — a shipment nobody can trace is not a shipment.';
  const shipDate = fgiDmy(v('fbsDate')) || fgiDmy(dToday());
  const note = v('fbsRemarks');
  const single = ids.length === 1;
  const fresh = await fbaFresh(ids);
  const now = new Date().toISOString(), updates = {}, done = [], skipped = [], backs = [];
  for (const { id, row } of fresh) {
    if (!row) { skipped.push({ id, why: 'deleted from the store' }); continue; }
    const s = fbaState(row);
    if (s.st !== 'waiting' && s.st !== 'accepted') { skipped.push({ id, why: 'already ' + FBA_PILL[s.st][1] }); continue; }
    let shipQty = s.open;
    if (single && v('fbsQty') !== '') {
      shipQty = parseInt(v('fbsQty'), 10);
      if (!isFinite(shipQty) || shipQty < 1) return 'Put in how many pieces are shipping.';
      if (shipQty > s.open) return `Only ${nf(s.open)} piece(s) of this dispatch are open.`;
      if (shipQty < s.open && !v('fbsReason')) return `${nf(s.open - shipQty)} piece(s) would come back to the store — say why.`;
    }
    const set = { fbaShippedAt: now, fbaShippedBy: ME.email, fbaShipment: shipment, fbaShipDate: shipDate };
    if (!row.fbaAcceptedAt) { set.fbaAcceptedAt = now; set.fbaAcceptedBy = ME.email; }
    if (note) set.fbaNote = note;
    if (shipQty < s.open) {
      const back = s.open - shipQty;
      const rec = fbaReturnRec(row, back, v('fbsReason'), 'not shipped in ' + shipment);
      updates['pt_fgiLedger/' + rec._id] = rec;
      set.fbaReturned = s.returned + back;
      backs.push(rec);
    }
    Object.keys(set).forEach(f => { updates['pt_fgiLedger/' + id + '/' + f] = set[f]; });
    done.push([row, set]);
  }
  fbaForget(fresh);
  if (!done.length) { renderFba(); return 'Nothing was shipped' + fbaSkipText(skipped) + '.'; }
  await ptPatch(updates);
  done.forEach(([r, set]) => Object.assign(r, set));
  if (backs.length) FGI.rows = (FGI.rows || []).concat(backs);
  ids.forEach(id => FBA_PICK.delete(id));
  renderFba();
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = `${nf(done.length)} dispatch(es) shipped as ${shipment}`
    + ` · ${nf(done.reduce((t, [r]) => t + fbaState(r).open, 0))} piece(s)`
    + (backs.length ? ` · ${nf(backs.reduce((t, b) => t + b.qty, 0))} piece(s) back in the store` : '')
    + fbaSkipText(skipped) + '.';
  return '';
}

function fbaReturnRec(row, qty, reason, remarks) {
  return { _id: fgiNewId('FBR'), txnType: 'FBA_RETURN', sku: obUC(row.sku), qty,
    date: fgiDmy(dToday()), linkedFbaId: fgiRowId(row), receivedFrom: 'FBA team', reason: reason || '',
    remarks: remarks || '', createdAt: new Date().toISOString(), createdBy: ME.email };
}

function fbaReturnOpen(ids) {
  if (!fbaCan() || !ids.length) return;
  const rows = ids.map(id => (FGI.rows || []).find(x => fgiRowId(x) === id)).filter(Boolean);
  const one = rows.length === 1 ? rows[0] : null;
  const open = rows.reduce((t, r) => t + fbaState(r).open, 0);
  ptOpenDialog({
    title: one ? `Return ${obUC(one.sku)} to the store` : `Return ${nf(rows.length)} dispatch(es) to the store`,
    subtitle: `${nf(open)} piece(s) open`,
    note: 'Returned pieces go back into Finished Goods stock straight away, as a movement of their own. '
      + (one ? 'Return fewer than are open and the rest stay with the FBA team.' : 'Every ticked dispatch is returned in full.'),
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${one ? `<label>Pieces coming back<input id="fbrQty" type="number" min="1" step="1" value="${esc(fbaState(one).open)}"></label>` : ''}
        <label>Why they are not going<input id="fbrReason" type="text" placeholder="e.g. not in the shipment plan"></label>
        <label style="grid-column:1/-1">Note<input id="fbrRemarks" type="text" placeholder="optional"></label>
      </div>`,
    onSave: () => fbaReturnSave(ids),
    saveLabel: 'Return to the store',
  });
}

async function fbaReturnSave(ids) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can return a dispatch.';
  const v = id => String((($(id) || {}).value) || '').trim();
  const reason = v('fbrReason');
  if (!reason) return 'Say why these are not going to Amazon.';
  const single = ids.length === 1;
  const fresh = await fbaFresh(ids);
  const now = new Date().toISOString(), updates = {}, done = [], skipped = [];
  for (const { id, row } of fresh) {
    if (!row) { skipped.push({ id, why: 'deleted from the store' }); continue; }
    const s = fbaState(row);
    if (s.st !== 'waiting' && s.st !== 'accepted') { skipped.push({ id, why: 'already ' + FBA_PILL[s.st][1] }); continue; }
    let q = s.open;
    if (single && v('fbrQty') !== '') {
      q = parseInt(v('fbrQty'), 10);
      if (!isFinite(q) || q < 1) return 'Put in how many pieces are coming back.';
      if (q > s.open) return `Only ${nf(s.open)} piece(s) of this dispatch are open.`;
    }
    const rec = fbaReturnRec(row, q, reason, v('fbrRemarks'));
    updates['pt_fgiLedger/' + rec._id] = rec;
    updates['pt_fgiLedger/' + id + '/fbaReturned'] = s.returned + q;
    updates['pt_fgiLedger/' + id + '/fbaReturnedAt'] = now;
    updates['pt_fgiLedger/' + id + '/fbaReturnedBy'] = ME.email;
    done.push([row, rec, s.returned + q]);
  }
  fbaForget(fresh);
  if (!done.length) { renderFba(); return 'Nothing was returned' + fbaSkipText(skipped) + '.'; }
  await ptPatch(updates);
  done.forEach(([r, rec, tot]) => { r.fbaReturned = tot; r.fbaReturnedAt = now; r.fbaReturnedBy = ME.email; });
  FGI.rows = (FGI.rows || []).concat(done.map(d => d[1]));
  ids.forEach(id => FBA_PICK.delete(id));
  renderFba();
  const pcs = done.reduce((t, d) => t + d[1].qty, 0);
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = `${nf(pcs)} piece(s) from ${nf(done.length)} dispatch(es) returned to the store`
    + (done.length === 1 ? ` · ${done[0][1].sku} now reads ${nf(fgiOf(done[0][1].sku).current)} in Finished Goods` : '')
    + fbaSkipText(skipped) + '.';
  return '';
}

/** One step back: shipped → accepted, accepted → waiting. A return is undone by deleting it in Finished Goods. */
async function fbaUndo(id) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can change a dispatch.';
  const [{ row }] = await fbaFresh([id]);
  if (!row) { fbaForget([{ id, row: null }]); renderFba(); return 'That dispatch was deleted from the store.'; }
  const s = fbaState(row), updates = {};
  let what = '';
  if (s.st === 'shipped') {
    ['fbaShippedAt', 'fbaShippedBy', 'fbaShipment', 'fbaShipDate'].forEach(f => { updates['pt_fgiLedger/' + id + '/' + f] = null; });
    what = 'no longer shipped — back to accepted';
  } else if (s.st === 'accepted') {
    ['fbaAcceptedAt', 'fbaAcceptedBy'].forEach(f => { updates['pt_fgiLedger/' + id + '/' + f] = null; });
    what = 'no longer accepted — back to waiting';
  } else return `This dispatch is ${FBA_PILL[s.st][1]}; there is no step to undo here.`;
  await ptPatch(updates);
  Object.keys(updates).forEach(p => { delete row[p.split('/').pop()]; });
  renderFba();
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = `${obUC(row.sku)}: ${what}.`;
  return '';
}

$('fbaTable').addEventListener('click', e => {
  const p = e.target.closest('[data-fba-pick]');
  if (p) { const id = p.getAttribute('data-fba-pick'); if (p.checked) FBA_PICK.add(id); else FBA_PICK.delete(id); renderFba(); return; }
  const a = e.target.closest('[data-fba-all]');
  if (a) {
    (FBA.shown || []).slice(0, 600).filter(x => x.s.st === 'waiting' || x.s.st === 'accepted')
      .forEach(x => { if (a.checked) FBA_PICK.add(fgiRowId(x.r)); else FBA_PICK.delete(fgiRowId(x.r)); });
    renderFba(); return;
  }
  const ok = e.target.closest('[data-fba-ok]'); if (ok) return fbaAccept([ok.getAttribute('data-fba-ok')]);
  const sh = e.target.closest('[data-fba-ship]'); if (sh) return fbaShipOpen([sh.getAttribute('data-fba-ship')]);
  const rt = e.target.closest('[data-fba-ret]'); if (rt) return fbaReturnOpen([rt.getAttribute('data-fba-ret')]);
  const un = e.target.closest('[data-fba-undo]');
  if (un) return fbaUndo(un.getAttribute('data-fba-undo')).then(why => { if (why) { $('fbaMsg').className = 'err'; $('fbaMsg').textContent = why; } });
});
$('fbaAccept').onclick = () => fbaAccept([...FBA_PICK]);
$('fbaShip').onclick = () => fbaShipOpen([...FBA_PICK]);
if ($('fbaShipXl')) $('fbaShipXl').onclick = () => $('fbaShipFile').click();
if ($('fbaShipFile')) $('fbaShipFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; fbaShipXlFile(f); };
$('fbaReturn').onclick = () => fbaReturnOpen([...FBA_PICK]);
$('fbaGo').onclick = () => { FGI.rows = null; ensureFba(); };
['fbaStatus', 'fbaD1', 'fbaD2'].forEach(id => $(id).addEventListener('change', renderFba));
ptDebounce('fbaQ', renderFba);
$('fbaExport').onclick = () => {
  const rows = FBA.shown || []; if (!rows.length) return;
  ptDownload('fba-dispatch', [['Sent', 'SKU', 'Item', 'Colour', 'Size', 'Pieces', 'Returned', 'Open', 'FBA account', 'Handover to / reason',
    'Sent by', 'Status', 'Accepted by', 'Accepted at', 'Shipment', 'Ship date', 'Shipped by', 'Id'].map(csvCell).join(',')]
    .concat(rows.map(({ r, s }) => {
      const m = fgiMaster(r.sku);
      return [r.date || '', obUC(r.sku), m.subtype || m.articleType || '', m.color || '', m.size || '', s.qty, s.returned, s.open,
        r.issuedFor || '', r.handoverTo || r.reason || '', r.createdBy || '', FBA_PILL[s.st][1], r.fbaAcceptedBy || '', r.fbaAcceptedAt || '',
        r.fbaShipment || '', r.fbaShipDate || '', r.fbaShippedBy || '', fgiRowId(r)].map(csvCell).join(',');
    })));
};

