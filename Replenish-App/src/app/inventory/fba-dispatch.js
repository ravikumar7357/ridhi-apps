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
 *
 * With switch storeAlloc on, the screen also has a line per article, brand and account filters and the Air / Sea / AWD of
 * each dispatch (fba-dispatch-view.js), coloured status badges, and the FBA lists on top, one button to accept every
 * waiting dispatch, and cards on a phone (fba-dispatch-redesign.js).
 */
const fbaCan = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('fba') >= 0);
const fbaLegacy = r => /^sheet/i.test(String((r && r.source) || '')) && !(r.fbaAcceptedAt || r.fbaShippedAt || fgiNum(r.fbaReturned));
const FBA_PILL = { waiting: ['pill-low', 'waiting'], accepted: ['', 'accepted'], shipped: ['pill-ok', 'shipped'],
  returned: ['pill-out', 'returned'], sheet: ['', 'from the sheet'] };
/* With switch storeAlloc on the badges are coloured by where a dispatch stands: waiting amber, accepted blue, shipped green,
 * returned grey, and "old" red = accepted this many days ago or more and still not shipped (the FBA team's chase list). */
const FBA_OLD_DAYS = 30;
const FBA_PILL_ON = { waiting: ['pill-low', 'waiting'], accepted: ['fbr-acc', 'accepted'], shipped: ['pill-ok', 'shipped'],
  returned: ['fbr-grey', 'returned'], sheet: ['fbr-grey', 'from the sheet'], old: ['pill-out', 'old'] };

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

/** The coloured badge of a dispatch's status. s: its fbaState. An accepted one that has waited FBA_OLD_DAYS is "old". */
function fbaStatusPill(r, s) {
  const days = fbaStale(r), key = s.st === 'accepted' && days >= FBA_OLD_DAYS ? 'old' : s.st;
  const [cls, txt] = FBA_PILL_ON[key];
  const why = key === 'old' ? ` title="Accepted ${nf(days)} days ago and still not shipped"` : '';
  return `<span class="pill ${cls}"${why}>${txt}</span>`;
}

function fbaBadge() {
  const el = $('fbaBadge'); if (!el) return;
  const n = FGI.rows ? fbaAll().filter(r => fbaState(r).st === 'waiting').length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

/** Does a dispatch carry the searched text (in lower case)? */
function fbaMatches(r, q) {
  const m = fgiMaster(r.sku);
  return [r.sku, r.issuedFor, r.reason, r.remarks, r.fbaShipment, m.color, m.size, m.articleType, m.subtype]
    .join(' ').toLowerCase().includes(q);
}

/** The dispatches the filters leave, newest first. over: filter values to count with in place of the screen's. */
function fbaRows(over = {}) {
  const f = over.status !== undefined ? over.status : $('fbaStatus').value, q = $('fbaQ').value.trim().toLowerCase();
  const d1 = $('fbaD1').value, d2 = $('fbaD2').value;
  const from = d1 ? new Date(d1 + 'T00:00:00').getTime() : 0;
  const to = d2 ? new Date(d2 + 'T23:59:59').getTime() : Infinity;
  const more = typeof fbvOn === 'function' && fbvOn();
  return fbaAll().map(r => Object.assign({ s: fbaState(r) }, { r }))
    .filter(x => f === 'todo' ? (x.s.st === 'waiting' || x.s.st === 'accepted') : (!f || x.s.st === f))
    .filter(x => { const m = ptDtMs(x.r.date) || ptDtMs(x.r.createdAt); return !m || (m >= from && m <= to); })
    .filter(x => !q || fbaMatches(x.r, q))
    .filter(x => !more || fbvKeeps(x.r, over))
    .sort((a, b) => String(b.r.createdAt || '').localeCompare(String(a.r.createdAt || '')));
}

const FBA_LIST_LIMIT = 600;   // the most lines a table draws; Export covers them all
const fbaActionable = x => x.s.st === 'waiting' || x.s.st === 'accepted';
const fbaWho = e => esc(String(e || '').split('@')[0]);
/** The dispatches the tick-all box covers: the ones the table holds that can still be acted on. */
function fbaTickable(rows) {
  const held = typeof fbvByArticle === 'function' && fbvByArticle() ? fbvHeld(rows) : rows.slice(0, FBA_LIST_LIMIT);
  return held.filter(fbaActionable);
}
function fbaTickAll(rows) {
  const can = fbaTickable(rows);
  const all = can.length > 0 && can.every(x => FBA_PICK.has(fgiRowId(x.r)));
  return `<input type="checkbox" data-fba-all${all ? ' checked' : ''} title="Tick every row that can still be accepted, shipped or returned">`;
}

/** The headings of the dispatch table. view: { can, on (switch storeAlloc) }; tick: what heads the tick column. */
function fbaDispatchCols(view) {
  const cols = ['Sent', 'SKU', 'Image', 'Item', 'Pieces', 'FBA account', 'Sent by', 'Status', 'Accepted', 'Shipped', 'Returned', ''];
  if (view.on) cols.splice(cols.indexOf('Pieces') + 1, 0, FBV_LANE_HEAD);
  return cols;
}
function fbaDispatchHead(view, tick) {
  return '<thead><tr>'
    + (view.can ? `<th>${tick}</th>` : '')
    + fbaDispatchCols(view)
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (h === 'Pieces' || h === 'Returned' ? ' class="num"' : '')}>${h}</th>`).join('')
    + '</tr></thead>';
}

/** One dispatch's line. */
function fbaDispatchRow({ r, s }, view) {
  const id = fgiRowId(r), m = fgiMaster(r.sku), [cls, txt] = FBA_PILL[s.st];
  const pill = view.on ? fbaStatusPill(r, s) : `<span class="pill ${cls}">${txt}</span>`;
  const pieces = (kind, n) => (view.on ? fbvDispatchFigure(kind, id, n) : nf(n));
  return '<tr>'
    + (view.can ? `<td>${fbaActionable({ s }) ? `<input type="checkbox" data-fba-pick="${esc(id)}"${FBA_PICK.has(id) ? ' checked' : ''}>` : ''}</td>` : '')
    + `<td class="frz">${esc(r.date || String(r.createdAt || '').slice(0, 10))}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(obUC(r.sku))}</td>`
    + ptImgCell(r.sku)
    + `<td style="text-align:left">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}`
    + (fgiOutParts(r).length ? `<div class="muted" style="font-size:10.5px">for ${esc(fgiOutTxt(fgiOutParts(r)))}</div>`
      : (r.noOrderWhy ? `<div class="muted" style="font-size:10.5px">no order · ${esc(r.noOrderWhy)}</div>` : '')) + '</td>'
    + `<td class="num" style="font-weight:700">${pieces('sent', s.qty)}${s.returned && s.st !== 'returned' ? `<div class="muted" style="font-size:10.5px;font-weight:400">${nf(s.open)} open</div>` : ''}</td>`
    + (view.on ? `<td>${esc(fbvLanesOf(r, view.sales).join(', '))}</td>` : '')
    + `<td style="text-align:left">${esc(r.issuedFor || '')}${(r.handoverTo || r.reason) ? `<div class="muted" style="font-size:10.5px">${r.handoverTo ? 'handed to ' + esc(r.handoverTo) : esc(r.reason)}</div>` : ''}</td>`
    + `<td>${fbaWho(r.createdBy)}</td>`
    + `<td>${pill}${fbaStale(r) >= FBA_STALE_DAYS ? `<div style="font-size:10.5px;color:var(--bad)">${nf(fbaStale(r))} days, not shipped</div>` : ''}</td>`
    + `<td style="font-size:12px">${r.fbaAcceptedAt ? `${fbaWho(r.fbaAcceptedBy)}<div class="muted" style="font-size:10.5px">${esc(String(r.fbaAcceptedAt).slice(0, 10))}</div>` : '<span class="muted">—</span>'}</td>`
    + `<td style="font-size:12px;text-align:left">${r.fbaShippedAt ? `<b>${esc(r.fbaShipment || '')}</b><div class="muted" style="font-size:10.5px">${esc(r.fbaShipDate || String(r.fbaShippedAt).slice(0, 10))} · ${fbaWho(r.fbaShippedBy)}</div>` : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${s.returned ? `<span style="font-weight:700;color:var(--bad)">${pieces('returned', s.returned)}</span>` : '<span class="muted">—</span>'}</td>`
    + `<td style="white-space:nowrap">${view.can ? fbaRowActions(r, s, id) : ''}</td>`
    + '</tr>';
}
/** The buttons of a dispatch's line, by where it stands. */
function fbaRowActions(r, s, id) {
  const btn = (attr, id, label, bad) => `<button class="ghost" ${attr}="${esc(id)}" style="padding:2px 9px;font-size:12px${bad ? ';color:var(--bad)' : ''}">${label}</button>`;
  return s.st === 'waiting'
    ? btn('data-fba-ok', id, 'Accept') + ' ' + btn('data-fba-ship', id, 'Ship') + ' ' + btn('data-fba-ret', id, 'Return', true)
    : s.st === 'accepted'
      ? btn('data-fba-ship', id, 'Ship') + ' ' + btn('data-fba-ret', id, 'Return', true) + ' ' + btn('data-fba-undo', id, 'Undo accept')
      : s.st === 'shipped' ? (typeof fblRecordGone === 'function' && fblRecordGone(r)
        ? btn('data-fba-ret', id, 'Return', true) : btn('data-fba-undo', id, 'Undo ship')) : '';
}

/** The line a table shows when the filters leave nothing. sought: why a search found nothing, or ''. */
function fbaNothingRow(cols, sought) {
  const done = $('fbaStatus').value === 'todo' ? ' Everything the store has sent to FBA has been shipped or returned.' : '';
  return `<tr><td colspan="${cols}" class="muted" style="padding:16px">${sought ? esc(sought) : 'Nothing here.' + done}</td></tr>`;
}
/** What every view says after its own count. history: dispatches that came in with the sheet. */
const fbaNoteEnd = history => (history ? ` · ${nf(history)} older dispatch(es) came in with the Ready Goods sheet and are history, not work` : '')
  + ' · the store took these pieces out when it sent them; a return puts them back';

/** The line above the table of every dispatch. */
const fbaDispatchNote = (rows, view) => `${nf(rows.length)} dispatch(es), newest first`
  + ` · ${nf(rows.reduce((t, x) => t + x.s.open, 0))} piece(s) not returned`
  + (rows.length > FBA_LIST_LIMIT ? ` · showing the first ${FBA_LIST_LIMIT}` : '')
  + fbaNoteEnd(view.history);

/** The table with every dispatch. Answers { note: the line above it, skus: whose pictures it shows }. */
function fbaDrawDispatches(rows, view) {
  const shown = rows.slice(0, FBA_LIST_LIMIT);
  $('fbaTable').innerHTML = fbaDispatchHead(view, view.can ? fbaTickAll(rows) : '') + '<tbody>'
    + (shown.length ? shown.map(x => fbaDispatchRow(x, view)).join('')
      : fbaNothingRow(fbaDispatchCols(view).length + (view.can ? 1 : 0), view.sought)) + '</tbody>';
  return { note: fbaDispatchNote(rows, view), skus: shown.map(x => x.r.sku) };
}

/** Draw the dispatches the way the screen is set: cards on a phone, a line per article, or every dispatch. */
function fbaDrawRows(rows, view) {
  const phone = view.on && typeof fbrNarrow === 'function' && fbrNarrow();
  if (view.on) $('fbaTable').className = phone ? 'fbr-cards' : 'xl';
  if (phone) return fbrDrawCards(rows, view);
  return view.on && fbvByArticle() ? fbvDrawArticles(rows, view) : fbaDrawDispatches(rows, view);
}

function renderFba() {
  if (typeof fblvRender === 'function') fblvRender();
  if (typeof fbvToolbar === 'function') fbvToolbar();
  if (FBA.busy || FGI.busy) { $('fbaMsg').className = 'muted'; $('fbaMsg').textContent = 'Reading what the store has sent to FBA…'; ptEmpty('fbaTable', 'Loading…'); return; }
  if (FGI.err) { $('fbaMsg').className = 'err'; $('fbaMsg').textContent = 'Could not read it: ' + FGI.err; ptEmpty('fbaTable', 'Nothing to show.'); $('fbaKpis').innerHTML = ''; return; }
  const can = fbaCan(), on = typeof fbvOn === 'function' && fbvOn();
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

  if (on) fbvFillBrands();
  const rows = fbaRows();
  FBA.shown = rows;
  const live = new Set(rows.map(x => fgiRowId(x.r)));
  [...FBA_PICK].forEach(id => { if (!live.has(id)) FBA_PICK.delete(id); });
  const view = { can, on, history: sheet, sought: on ? fbvSearchNote($('fbaQ').value, rows) : '', sales: on ? fbvSalesByNo() : null };
  const drawn = fbaDrawRows(rows, view);

  const n = FBA_PICK.size;
  ['fbaAccept', 'fbaShip', 'fbaReturn'].forEach(b => { $(b).classList.toggle('hide', !can); $(b).disabled = !n; });
  if ($('fbaShipXl')) $('fbaShipXl').classList.toggle('hide', !can);
  $('fbaAccept').textContent = n ? `Accept ${nf(n)}` : 'Accept ticked';
  $('fbaShip').textContent = n ? `Ship ${nf(n)}` : 'Ship ticked';
  $('fbaReturn').textContent = n ? `Return ${nf(n)}` : 'Return ticked';
  $('fbaMsg').className = 'muted';
  $('fbaMsg').textContent = (view.sought ? view.sought + ' · ' : '') + drawn.note + (on ? fbvSalesNote() : '');
  if (on) fbvDrawAges();
  if (on && typeof fbrToolbar === 'function') fbrToolbar(view);
  fbaBadge();
  ptImgFill(drawn.skus, false, ptImgPatch);
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

/** Accept these dispatches, each read again first. Answers { done: the rows accepted, skipped: [{ id, why }] }. Draws nothing. */
async function fbaAcceptStep(ids) {
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
  return { done, skipped };
}

async function fbaAccept(ids) {
  if (!fbaCan()) return 'Only the FBA team (the FBA Dispatch tab) can accept a dispatch.';
  if (!ids.length) return 'Tick at least one dispatch.';
  const { done, skipped } = await fbaAcceptStep(ids);
  renderFba();
  $('fbaMsg').className = done.length ? 'muted' : 'err';
  $('fbaMsg').textContent = `${nf(done.length)} dispatch(es) accepted · ${nf(done.reduce((t, r) => t + fbaState(r).open, 0))} piece(s)`
    + fbaSkipText(skipped) + '.';
  return done.length ? '' : 'Nothing was accepted' + fbaSkipText(skipped) + '.';
}

