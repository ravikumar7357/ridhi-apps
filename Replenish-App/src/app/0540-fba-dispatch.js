/* ================= FBA DISPATCH =================
 *
 * Ravi: "FBA ke liye ek section banana jaha fba team ko issue wali inventory dikhe or team accept kar
 * pay or shipped kar pay in bulk or single and yadi nahi bhej rahi fba team inventory ko to return
 * kar pay".
 *
 * WHAT IT SHOWS: every "Send to FBA" movement the store makes. The store has already taken those
 * pieces out of its stock the moment it sent them; this screen is what happens to them next.
 *
 *   waiting   → sent by the store, nobody on the FBA team has taken them yet
 *   accepted  → the FBA team has the pieces in hand
 *   shipped   → gone to Amazon, with the shipment id
 *   returned  → the FBA team gave every piece back to the store
 *
 * A dispatch may be shipped straight from waiting — shipping them is proof they were received.
 *
 * RETURNING PUTS THE PIECES BACK IN THE STORE, as a movement of its own: an FBA_RETURN row naming the
 * dispatch (`linkedFbaId`), which adds to stock exactly as a receive does, and counts against "To FBA".
 * The dispatch keeps `fbaReturned` — the running total — so a return, or a partial one, can be checked
 * against what is still open without reading the whole ledger again. Both are written in ONE PATCH.
 * A partial return leaves the rest open; a ship of fewer pieces than are open returns the remainder.
 *
 * EVERY ACTION READS THE DISPATCH AGAIN FIRST. Two people on the FBA team work the same list, and a
 * screen drawn ten minutes ago must not accept or return what somebody else has already shipped.
 *
 * THE 712 DISPATCHES IMPORTED FROM THE READY GOODS SHEET (`source: 'sheet: …'`) are history — they
 * went to Amazon long before this screen existed. They are shown as "from the sheet" and are never
 * put in front of the FBA team as work.
 *
 * WHO: the FBA Dispatch tab is the right. The person who packs a shipment needs nothing else.
 */
const fbaCan = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('fba') >= 0);
const fbaLegacy = r => /^sheet/i.test(String((r && r.source) || '')) && !(r.fbaAcceptedAt || r.fbaShippedAt || fgiNum(r.fbaReturned));
const FBA_PILL = { waiting: ['pill-low', 'waiting'], accepted: ['', 'accepted'], shipped: ['pill-ok', 'shipped'],
  returned: ['pill-out', 'returned'], sheet: ['', 'from the sheet'] };

let FBA = { busy: false, shown: [] };
let FBA_PICK = new Set();

function fbaState(r) {
  const qty = fgiNum(r.qty), returned = Math.min(qty, Math.max(0, fgiNum(r.fbaReturned)));
  const open = qty - returned;
  let st = 'waiting';
  if (fbaLegacy(r)) st = 'sheet';
  else if (open <= 0) st = 'returned';
  else if (r.fbaShippedAt) st = 'shipped';
  else if (r.fbaAcceptedAt) st = 'accepted';
  return { st, qty, returned, open };
}

function fbaAll() { return (FGI.rows || []).filter(r => r && r.txnType === 'FBA'); }

async function ensureFba() {
  if (FGI.rows === null) { FBA.busy = true; renderFba(); await fgiLoad(); FBA.busy = false; }
  renderFba();
}

function fbaBadge() {
  const el = $('fbaBadge'); if (!el) return;
  const n = FGI.rows ? fbaAll().filter(r => fbaState(r).st === 'waiting').length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

function fbaRows() {
  const f = $('fbaStatus').value, q = $('fbaQ').value.trim().toLowerCase();
  const d1 = $('fbaD1').value, d2 = $('fbaD2').value;
  const from = d1 ? new Date(d1 + 'T00:00:00').getTime() : 0;
  const to = d2 ? new Date(d2 + 'T23:59:59').getTime() : Infinity;
  return fbaAll().map(r => Object.assign({ s: fbaState(r) }, { r }))
    .filter(x => f === 'todo' ? (x.s.st === 'waiting' || x.s.st === 'accepted') : (!f || x.s.st === f))
    .filter(x => { const m = ptDtMs(x.r.date) || ptDtMs(x.r.createdAt); return !m || (m >= from && m <= to); })
    .filter(x => {
      if (!q) return true;
      const m = fgiMaster(x.r.sku);
      return [x.r.sku, x.r.issuedFor, x.r.reason, x.r.remarks, x.r.fbaShipment, m.color, m.size, m.articleType, m.subtype]
        .join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => String(b.r.createdAt || '').localeCompare(String(a.r.createdAt || '')));
}

function renderFba() {
  if (FBA.busy || FGI.busy) { $('fbaMsg').className = 'muted'; $('fbaMsg').textContent = 'Reading what the store has sent to FBA…'; ptEmpty('fbaTable', 'Loading…'); return; }
  if (FGI.err) { $('fbaMsg').className = 'err'; $('fbaMsg').textContent = 'Could not read it: ' + FGI.err; ptEmpty('fbaTable', 'Nothing to show.'); $('fbaKpis').innerHTML = ''; return; }
  const can = fbaCan();
  const all = fbaAll().map(r => fbaState(r));
  const sum = (st, f) => all.filter(s => s.st === st).reduce((t, s) => t + f(s), 0);
  const cnt = st => all.filter(s => s.st === st).length;
  const sheet = cnt('sheet');
  $('fbaKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Sent to FBA</span>
      <span class="kpiwhen">read live${FGI.at ? ' · ' + esc(FGI.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v"${cnt('waiting') ? ' style="color:#7f6000"' : ''}>${nf(sum('waiting', s => s.open))}</div><div class="l">Pieces waiting · ${nf(cnt('waiting'))} dispatch(es)</div></div>
      <div class="metric"><div class="v">${nf(sum('accepted', s => s.open))}</div><div class="l">Accepted, not shipped · ${nf(cnt('accepted'))}</div></div>
      ${(st => st.length ? `<div class="metric" title="Accepted ${FBA_STALE_DAYS} or more days ago and still not marked shipped — press Ship with the shipment id, or Ship from Excel with the shipment's file"><div class="v" style="color:var(--bad)">${nf(st.length)}</div><div class="l">Accepted ${FBA_STALE_DAYS}+ days ago, not shipped</div></div>` : '')(fbaAll().filter(r => fbaStale(r) >= FBA_STALE_DAYS))}
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(sum('shipped', s => s.open))}</div><div class="l">Shipped · ${nf(cnt('shipped'))}</div></div>
      <div class="metric"><div class="v">${nf(all.filter(s => s.st !== 'sheet').reduce((t, s) => t + s.returned, 0))}</div><div class="l">Returned to the store</div></div>
    </div></div>`;

  const rows = fbaRows();
  FBA.shown = rows;
  const live = new Set(rows.map(x => fgiRowId(x.r)));
  [...FBA_PICK].forEach(id => { if (!live.has(id)) FBA_PICK.delete(id); });
  const actionable = x => x.s.st === 'waiting' || x.s.st === 'accepted';
  const shownRows = rows.slice(0, 600);
  const allTicked = shownRows.some(actionable) && shownRows.filter(actionable).every(x => FBA_PICK.has(fgiRowId(x.r)));
  const head = '<thead><tr>'
    + (can ? `<th><input type="checkbox" data-fba-all${allTicked ? ' checked' : ''} title="Tick every row that can still be accepted, shipped or returned"></th>` : '')
    + ['Sent', 'SKU', 'Image', 'Item', 'Pieces', 'FBA account', 'Sent by', 'Status', 'Accepted', 'Shipped', 'Returned', '']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 4 || i === 10 ? ' class="num"' : '')}>${h}</th>`).join('')
    + '</tr></thead>';
  const who = e => esc(String(e || '').split('@')[0]);
  const btn = (attr, id, label, bad) => `<button class="ghost" ${attr}="${esc(id)}" style="padding:2px 9px;font-size:12px${bad ? ';color:var(--bad)' : ''}">${label}</button>`;
  $('fbaTable').innerHTML = head + '<tbody>' + (shownRows.length ? shownRows.map(({ r, s }) => {
    const id = fgiRowId(r), m = fgiMaster(r.sku), [cls, txt] = FBA_PILL[s.st];
    return '<tr>'
      + (can ? `<td>${actionable({ s }) ? `<input type="checkbox" data-fba-pick="${esc(id)}"${FBA_PICK.has(id) ? ' checked' : ''}>` : ''}</td>` : '')
      + `<td class="frz">${esc(r.date || String(r.createdAt || '').slice(0, 10))}</td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(obUC(r.sku))}</td>`
      + ptImgCell(r.sku)
      + `<td style="text-align:left">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}`
      + (fgiOutParts(r).length ? `<div class="muted" style="font-size:10.5px">for ${esc(fgiOutTxt(fgiOutParts(r)))}</div>`
        : (r.noOrderWhy ? `<div class="muted" style="font-size:10.5px">no order · ${esc(r.noOrderWhy)}</div>` : '')) + '</td>'
      + `<td class="num" style="font-weight:700">${nf(s.qty)}${s.returned && s.st !== 'returned' ? `<div class="muted" style="font-size:10.5px;font-weight:400">${nf(s.open)} open</div>` : ''}</td>`
      + `<td style="text-align:left">${esc(r.issuedFor || '')}${(r.handoverTo || r.reason) ? `<div class="muted" style="font-size:10.5px">${r.handoverTo ? 'handed to ' + esc(r.handoverTo) : esc(r.reason)}</div>` : ''}</td>`
      + `<td>${who(r.createdBy)}</td>`
      + `<td><span class="pill ${cls}">${txt}</span>${fbaStale(r) >= FBA_STALE_DAYS ? `<div style="font-size:10.5px;color:var(--bad)">${nf(fbaStale(r))} days, not shipped</div>` : ''}</td>`
      + `<td style="font-size:12px">${r.fbaAcceptedAt ? `${who(r.fbaAcceptedBy)}<div class="muted" style="font-size:10.5px">${esc(String(r.fbaAcceptedAt).slice(0, 10))}</div>` : '<span class="muted">—</span>'}</td>`
      + `<td style="font-size:12px;text-align:left">${r.fbaShippedAt ? `<b>${esc(r.fbaShipment || '')}</b><div class="muted" style="font-size:10.5px">${esc(r.fbaShipDate || String(r.fbaShippedAt).slice(0, 10))} · ${who(r.fbaShippedBy)}</div>` : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${s.returned ? `<span style="font-weight:700;color:var(--bad)">${nf(s.returned)}</span>` : '<span class="muted">—</span>'}</td>`
      + `<td style="white-space:nowrap">${!can ? '' : (s.st === 'waiting'
          ? btn('data-fba-ok', id, 'Accept') + ' ' + btn('data-fba-ship', id, 'Ship') + ' ' + btn('data-fba-ret', id, 'Return', true)
          : s.st === 'accepted'
            ? btn('data-fba-ship', id, 'Ship') + ' ' + btn('data-fba-ret', id, 'Return', true) + ' ' + btn('data-fba-undo', id, 'Undo accept')
            : s.st === 'shipped' ? btn('data-fba-undo', id, 'Undo ship') : '')}</td>`
      + '</tr>';
  }).join('') : `<tr><td colspan="${can ? 13 : 12}" class="muted" style="padding:16px">Nothing here.`
    + `${$('fbaStatus').value === 'todo' ? ' Everything the store has sent to FBA has been shipped or returned.' : ''}</td></tr>`) + '</tbody>';

  const n = FBA_PICK.size;
  ['fbaAccept', 'fbaShip', 'fbaReturn'].forEach(b => { $(b).classList.toggle('hide', !can); $(b).disabled = !n; });
  if ($('fbaShipXl')) $('fbaShipXl').classList.toggle('hide', !can);
  $('fbaAccept').textContent = n ? `Accept ${nf(n)}` : 'Accept ticked';
  $('fbaShip').textContent = n ? `Ship ${nf(n)}` : 'Ship ticked';
  $('fbaReturn').textContent = n ? `Return ${nf(n)}` : 'Return ticked';
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = `${nf(rows.length)} dispatch(es), newest first`
    + ` · ${nf(rows.reduce((t, x) => t + x.s.open, 0))} piece(s) not returned`
    + (rows.length > 600 ? ' · showing the first 600' : '')
    + (sheet ? ` · ${nf(sheet)} older dispatch(es) came in with the Ready Goods sheet and are history, not work` : '')
    + ' · the store took these pieces out when it sent them; a return puts them back';
  fbaBadge();
  ptImgFill(shownRows.map(x => x.r.sku), false, ptImgPatch);
}

/** The dispatches, read again from the database — somebody on the team may have acted on them since. */
async function fbaFresh(ids) {
  const got = await Promise.all(ids.map(id => ptGet('pt_fgiLedger/' + id)));
  return ids.map((id, i) => {
    const fresh = got[i];
    const mem = (FGI.rows || []).find(x => fgiRowId(x) === id);
    if (!fresh || fresh.txnType !== 'FBA') return { id, row: null, mem };
    if (mem) Object.keys(mem).forEach(k => { if (k !== '_key' && k !== '_id' && !(k in fresh)) delete mem[k]; });
    return { id, row: mem ? Object.assign(mem, fresh) : Object.assign({ _id: id }, fresh), mem };
  });
}

function fbaSkipText(skipped) {
  if (!skipped.length) return '';
  const by = {};
  skipped.forEach(s => { by[s.why] = (by[s.why] || 0) + 1; });
  return ' · left alone: ' + Object.entries(by).map(([w, c]) => `${nf(c)} ${w}`).join(', ');
}

function fbaForget(fresh) {
  /* A row somebody deleted from the store is dropped from this screen as well. */
  const goneIds = new Set(fresh.filter(f => !f.row).map(f => f.id));
  if (goneIds.size) FGI.rows = (FGI.rows || []).filter(x => !goneIds.has(fgiRowId(x)));
}

async function fbaAccept(ids) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can accept a dispatch.';
  if (!ids.length) return 'Tick at least one dispatch.';
  const fresh = await fbaFresh(ids);
  const now = new Date().toISOString(), updates = {}, done = [], skipped = [];
  fresh.forEach(({ id, row }) => {
    if (!row) return skipped.push({ id, why: 'deleted from the store' });
    const st = fbaState(row).st;
    if (st !== 'waiting') return skipped.push({ id, why: 'already ' + (FBA_PILL[st] || [0, st])[1] });
    updates['pt_fgiLedger/' + id + '/fbaAcceptedAt'] = now;
    updates['pt_fgiLedger/' + id + '/fbaAcceptedBy'] = ME.email;
    done.push(row);
  });
  fbaForget(fresh);
  if (done.length) await ptPatch(updates);
  done.forEach(r => { r.fbaAcceptedAt = now; r.fbaAcceptedBy = ME.email; });
  ids.forEach(id => FBA_PICK.delete(id));
  renderFba();
  $('fbaMsg').className = done.length ? 'muted' : 'err';
  $('fbaMsg').textContent = `${nf(done.length)} dispatch(es) accepted · ${nf(done.reduce((t, r) => t + fbaState(r).open, 0))} piece(s)`
    + fbaSkipText(skipped) + '.';
  return done.length ? '' : 'Nothing was accepted' + fbaSkipText(skipped) + '.';
}

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

