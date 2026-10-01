/* ================= FINISHED GOODS =================
 *
 * Ready stock: what has come off the press, been counted into the store, and not yet gone out.
 *
 * IT IS A LEDGER, NOT A BALANCE. Nothing anywhere holds "current stock" as a number — every movement
 * is a row, and the balance is what those rows add up to. A stored balance is a number that can be
 * wrong on its own; a ledger can only be wrong if a movement is wrong, and then you can see which.
 *
 *   OPENING          what was already in the store the day this started
 *   TRANSFER_IN      pieces sent from Press Inventory — NOT stock yet
 *   RECEIPT_CONFIRM  a marker saying a transfer was counted in. Its quantity is informational and
 *                    is deliberately NOT added: the transfer row itself becomes `confirmed`.
 *   ISSUE            pieces going out, to a shipment or anywhere else
 *   RETURN_TO_PRESS  a marker; the real reversal is `reversed: true` on the transfer
 *
 *   stock = opening + received − issued
 *
 * A TRANSFER IS PENDING UNTIL SOMEBODY COUNTS IT. Pieces in transit are not stock — that gap is
 * where losses show up, and a store that counts them as stock can never find one. Confirming
 * requires the count to MATCH what was sent; a mismatch is refused and has to be looked at, not
 * absorbed.
 *
 * PRESS IS THE SOURCE. A press row carries `transferredQty`, so what is left there is
 * `pieces − transferredQty`. Partial transfers are fine; the remainder stays open in Press.
 */
const FGI_TYPES = ['OPENING', 'RECEIVE', 'TRANSFER_IN', 'RECEIPT_CONFIRM', 'ISSUE', 'FBA', 'RETURN_TO_PRESS', 'FBA_RETURN'];
/* A counter, not just the clock and three random characters. Writing 2,200 opening rows in one
 * go draws 2,200 ids inside the same millisecond, and three base-36 characters is 46,656 values —
 * about 50 of them collide, and a collision here is one row silently overwriting another and the
 * store coming out short. The counter makes that impossible. */
let FGI_SEQ = 0;
const fgiNewId = p => (p || 'FGI') + '-' + Date.now().toString(36).toUpperCase()
  + '-' + (FGI_SEQ++).toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();

let FGI = { rows: null, err: '', busy: false, at: '', view: 'stock', shown: [], recips: null, set: {} };

async function ensureFgi() {
  if (FGI.rows === null) { FGI.busy = true; renderFgi(); await fgiLoad(); }
  renderFgi();
}

/** Read the ledger, the recipients and the settings. Finished Goods and FBA Dispatch both draw from it. */
async function fgiLoad() {
  FGI.busy = true;
  if (!PTG.mdb) await ptLoadGates();
  try {
    const [led, rec, set] = await Promise.all([ptGet('pt_fgiLedger'), ptGet('pt_issueRecipients'), ptGet('pt_fgiSettings')]);
    FGI.rows = ptList(led);
    FGI.set = set || {};
    FGI.recips = ptList(rec).filter(r => r && r.active !== false).map(r => r.name).filter(Boolean).sort();
    FGI.err = '';
  } catch (e) { FGI.err = e.message || String(e); FGI.rows = FGI.rows || []; FGI.recips = FGI.recips || []; }
  FGI.at = ptStamp(); FGI.busy = false;
  /* A tick on a row that has just been read again may point at nothing now. */
  FGI_PICK = { stock: new Set(), ledger: new Set() };
  fbaBadge();
  await lstLoad();
  await fgiCorrLoad();
  await fnLoad();
  fgiOverBadge();
  lstMaybeRefresh();
}

const fgiNum = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/** Every SKU the ledger has ever touched, and what it adds up to. */
function fgiStock() {
  const by = new Map();
  const get = sku => {
    if (!by.has(sku)) by.set(sku, { sku, opening: 0, pending: 0, received: 0, issued: 0, fba: 0, moves: 0, last: '' });
    return by.get(sku);
  };
  (FGI.rows || []).slice()
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    .forEach(r => {
      const sku = obUC(r.sku); if (!sku) return;
      const b = get(sku); b.moves++; b.last = r.createdAt || b.last;
      const q = fgiNum(r.qty);
      if (r.txnType === 'OPENING') b.opening += q;
      else if (r.txnType === 'RECEIVE') b.received += q;   // arrived from somewhere that is not the press
      else if (r.txnType === 'TRANSFER_IN') {
        if (r.reversed === true) return;            // sent back to press: neither stock nor pending
        if (r.confirmed === true) b.received += q; else b.pending += q;
      } else if (r.txnType === 'ISSUE') b.issued += q;
      else if (r.txnType === 'FBA') { b.issued += q; b.fba += q; }
      /* Pieces the FBA team did not send, back in the store. They come off what went out, so "To FBA"
       * stays what actually left for Amazon. */
      else if (r.txnType === 'FBA_RETURN') { b.issued -= q; b.fba -= q; }
      // RECEIPT_CONFIRM and RETURN_TO_PRESS are markers. Counting their quantity would double it.
    });
  by.forEach(b => { b.current = b.opening + b.received - b.issued; });
  return by;
}

const fgiOf = sku => fgiStock().get(obUC(sku)) || { current: 0, pending: 0, opening: 0, received: 0, issued: 0, fba: 0 };
const fgiMaster = sku => mdbOf(sku) || {};
/** What is left on a press row after whatever has already gone to the store. */
const fgiPressLeft = r => Math.max(0, (parseInt(r.pieces, 10) || 0) - fgiNum(r.transferredQty));
const fgiPending = () => (FGI.rows || []).filter(r => r && r.txnType === 'TRANSFER_IN' && r.confirmed !== true && r.reversed !== true);

function renderFgi() {
  if (FGI.busy) { $('fgMsg').className = 'muted'; $('fgMsg').textContent = 'Reading the finished-goods ledger…'; ptEmpty('fgTable', 'Loading…'); return; }
  if (FGI.err) { $('fgMsg').className = 'err'; $('fgMsg').textContent = 'Could not read it: ' + FGI.err; ptEmpty('fgTable', 'Nothing to show.'); $('fgKpis').innerHTML = ''; return; }

  const stock = fgiStock();
  const all = [...stock.values()];
  const tot = f => all.reduce((s, b) => s + f(b), 0);
  const pend = fgiPending();
  /* A tile stays lit only while the screen still shows what it counted. Changing the view or the
   * tick by hand puts it out — a highlight that claims to be filtering a list it is not is worse
   * than no highlight. */
  const vNow = $('fgView').value, zNow = !!$('fgZero').checked;
  if (FGI_KPI && vNow !== 'ledger') FGI_KPI = '';
  const litOk = { skus: vNow === 'stock' && !zNow, in: vNow === 'stock' && zNow, stock: vNow === 'stock' && zNow,
    press: vNow === 'pending' }[FGI_KPI_ON];
  if (FGI_KPI_ON && (litOk === false || (litOk === undefined && FGI_KPI !== FGI_KPI_ON))) FGI_KPI_ON = '';
  $('fgKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Finished goods</span>
      <span class="kpiwhen">read live${FGI.at ? ' · ' + esc(FGI.at) : ''}</span></div>
    <div class="metrics">
      ${[
        ['skus', nf(all.length), 'SKUs on record', ''],
        ['in', nf(all.filter(b => b.current > 0).length), 'SKUs in stock', ''],
        ['opening', nf(tot(b => b.opening)), 'Opening stock', ''],
        ['received', nf(tot(b => b.received)), 'Came in, all time', ''],
        ['out', nf(tot(b => b.issued)), 'Gone out, all time', ''],
        ['fba', nf(tot(b => b.fba || 0)), 'Of that, to FBA', ''],
        ['press', nf(tot(b => b.pending)), 'Sent from press, not counted in', pend.length ? 'color:#7f6000' : ''],
        ['stock', nf(tot(b => b.current)), 'Pieces in stock', 'color:var(--accent)'],
      ].map(([k, v, label, style]) => `<div class="metric" data-fgkpi="${k}" title="Show the rows behind this figure"
        style="cursor:pointer${FGI_KPI_ON === k ? ';box-shadow:inset 0 -2px 0 var(--accent)' : ''}">
        <div class="v"${style ? ` style="${style}"` : ''}>${v}</div><div class="l">${label}</div></div>`).join('')}
    </div></div>`;
  $('fgPendBadge').textContent = pend.length ? nf(pend.length) : '';
  $('fgPendBadge').classList.toggle('hide', !pend.length);

  const view = $('fgView').value;
  ['fgD1', 'fgD2'].forEach(i => $(i).classList.toggle('hide', view !== 'ledger'));
  ['fgBrand', 'fgStat', 'fgTag', 'fgAmz'].forEach(i => $(i).classList.toggle('hide', view !== 'stock'));
  $('fgLstRefresh').classList.toggle('hide', !lstCanRefresh());
  $('fgLstRefresh').disabled = !!LST.busy;
  // The label has its own id rather than being reached through the checkbox's parent — a wrapper
  // that changes shape would otherwise break this silently.
  $('fgZeroWrap').classList.toggle('hide', view !== 'stock');
  $('fgEntry').classList.toggle('hide', !fgiCanEntry());
  ['fgiLstBadge', 'fgiCorrBadge', 'fgiOverBadge'].forEach(id => { const b = $(id); if (b && b.dataset) b.classList.toggle('on', b.dataset.fgview === $('fgView').value); });
  ['fgRecvXl', 'fgIssXl'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !fgiCanEntry()); });
  $('fgScan').classList.toggle('hide', !fgiCanEntry());
  $('fgOpening').classList.toggle('hide', !fgiCanEdit());
  fgiPickCount();
  if (view === 'ledger') return fgiRenderLedger();
  if (view === 'pending') return fgiRenderPending();
  if (view === 'alerts') return lstRenderAlerts();
  if (view === 'corr') return fgiRenderCorr();
  if (view === 'over') return fgiRenderOver();
  fgiRenderStock(stock);
}

function fgiRenderStock(stock) {
  const q = $('fgQ').value.trim().toLowerCase();
  /* THE LIST IS THE STORE'S REGISTER, not its shelf. A SKU that came in and went out the same
   * morning still gets its line, with what came in and where it went; ticking the box narrows the
   * list to what is actually left. */
  const onlyStock = $('fgZero').checked;
  const fBrand = $('fgBrand').value, fStat = $('fgStat').value, fTag = $('fgTag').value;
  const rows = [...stock.values()].map(b => {
    const m = fgiMaster(b.sku);
    const st = fgiStatus(b.sku, b.current);
    const set = (FGI.set || {})[b.sku] || {};
    const price = parseFloat(m.inventoryValuationPrice);
    return Object.assign({
      brand: String(m.brand || '').trim(), articleType: m.articleType || '', subtype: m.subtype || '',
      color: m.color || '', size: m.size || '', status: st, remark: set.remark || '',
      reorder: set.reorder == null ? '' : set.reorder,
      price: isFinite(price) ? price : null, value: isFinite(price) ? b.current * price : null,
    }, b);
  })
    /* Negative stock is never hidden. The message below warns about it, and a warning about
     * something the filter has just removed from the table is worse than no warning. */
    .filter(r => !onlyStock || r.current !== 0 || r.pending > 0)
    .filter(r => !fBrand || r.brand === fBrand)
    .filter(r => !fStat || r.status.txt === fStat)
    .filter(r => !fTag || (fTag === '_none' ? !r.remark : r.remark === fTag))
    .filter(r => !$('fgAmz').value || lstOf(r.sku).st === $('fgAmz').value)
    .filter(r => !q || [r.sku, r.articleType, r.subtype, r.color, r.size, r.remark].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.current - a.current || a.sku.localeCompare(b.sku));
  FGI.shown = rows;

  ptFillSelect('fgBrand', [...new Set([...stock.values()].map(b => String(fgiMaster(b.sku).brand || '').trim()).filter(Boolean))]
    .sort().map(b => [b, b]), 'All brands');

  const canEd = fgiCanEdit();
  const shownSkus = rows.slice(0, 600).map(r => r.sku);
  const allOn = canEd && shownSkus.length > 0 && shownSkus.every(s => FGI_PICK.stock.has(s));
  const head = '<thead><tr>' + (canEd ? `<th><input type="checkbox" data-fgall="stock"${allOn ? ' checked' : ''} title="Tick every SKU shown"></th>` : '')
    + ['SKU', 'Image', 'Brand', 'Item', 'Colour', 'Size', 'Opening', 'Received',
    'Issued', 'To FBA', 'In stock', 'Amazon', 'Tag', 'Rate', 'Value', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 6 && i <= 10 ? ' class="num"' : (i === 13 || i === 14 ? ' class="num"' : ''))}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
    + (canEd ? `<td><input type="checkbox" data-fgpick="${esc(r.sku)}"${FGI_PICK.stock.has(r.sku) ? ' checked' : ''}></td>` : '')
    + `<td class="frz" style="text-align:left"><button class="ghost" data-fgmoves="${esc(r.sku)}" title="Every movement of this SKU"
        style="font-family:ui-monospace,monospace;padding:2px 7px;font-size:12.5px">${esc(r.sku)}</button></td>`
    + ptImgCell(r.sku)
    + `<td>${esc(r.brand)}</td>`
    + `<td>${esc(r.subtype || r.articleType) || '<span class="muted">not in the master DB</span>'}</td>`
    + `<td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
    + `<td class="num">${r.opening ? nf(r.opening) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${r.received ? nf(r.received) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${r.issued ? nf(r.issued) : '<span class="muted">—</span>'}</td>`
    + `<td class="num">${r.fba ? nf(r.fba) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700;color:${r.current > 0 ? 'var(--accent)' : (r.current < 0 ? 'var(--bad)' : 'var(--muted)')}">${nf(r.current)}</td>`
    /* "Not counted in" and "Status" were taken off this table on 15 Sept, at Ravi's request. */
    + (st => `<td><span class="pill ${LST_PILL[st.st][0]}"${st.asin ? ` title="${esc(st.asin)}"` : ''}>${LST_PILL[st.st][1]}</span></td>`)(lstOf(r.sku))
    + `<td>${r.remark ? esc(r.remark) : '<span class="muted">—</span>'}</td>`
    /* A missing price is shown as missing. A zero would quietly value the stock at nothing. */
    + `<td class="num">${r.price === null ? '<span class="muted">none</span>' : nf(r.price)}</td>`
    + `<td class="num" style="font-weight:700">${r.value === null ? '<span class="muted">—</span>' : nf(Math.round(r.value))}</td>`
    + `<td style="white-space:nowrap">${fgiCanEntry() ? `<button class="ghost" data-fgentry="${esc(r.sku)}" style="padding:3px 9px;font-size:12px">Entry</button>` : ''}${canEd
      ? ` <button class="ghost" data-fgskued="${esc(r.sku)}" style="padding:3px 9px;font-size:12px" title="Correct the count, re-order level and tag">Edit</button>`
        + ` <button class="ghost" data-fgskudel="${esc(r.sku)}" style="padding:3px 9px;font-size:12px;color:var(--bad)" title="Delete every movement of this SKU">Delete</button>` : ''}</td>`
    + '</tr>').join('') + '</tbody>';

  const neg = rows.filter(r => r.current < 0);
  const low = rows.filter(r => r.status.txt === 'low').length;
  const val = rows.reduce((s, r) => s + (r.value || 0), 0);
  const noPrice = rows.filter(r => r.current > 0 && r.price === null).length;
  $('fgMsg').className = neg.length ? 'err' : 'muted';
  const held = rows.filter(r => r.current !== 0 || r.pending > 0).length;
  $('fgMsg').textContent = `${nf(rows.length)} SKU(s)`
    + (onlyStock ? ' in stock now' : ` on record · ${nf(held)} with pieces left`)
    + (rows.length > 600 ? ' · showing the first 600 · Export covers all of them' : '')
    + (val ? ` · ${nf(Math.round(val))} rupees of stock` : '')
    + (noPrice ? ` · ${nf(noPrice)} in stock have no rate, so they are in the pieces and not in the value` : '')
    + (low ? ` · ${nf(low)} at or below their re-order level` : '')
    + (neg.length ? ` · ${nf(neg.length)} SKU(s) are NEGATIVE, meaning more has gone out than ever came in` : '')
    + ' · stock is opening plus what came in, less what went out — pieces still in transit from press are not stock';
  ptImgFill(rows.slice(0, 600).map(r => r.sku), false, ptImgPatch);
}

/** Which tile is open, and which movements it counts. '' is everything.
 *  A tile is not a second search box — it is the rows behind the figure that was clicked. */
let FGI_KPI = '';
/** The tile that is open. Declared beside the filter it drives, so the render can never read it
 *  before it exists. */
let FGI_KPI_ON = '';
const FGI_KPI_ROWS = {
  opening: { label: 'opening stock', is: r => r.txnType === 'OPENING' && !r.adjust },
  count: { label: 'count corrections', is: r => r.txnType === 'OPENING' && !!r.adjust },
  received: { label: 'what came in', is: r => r.txnType === 'RECEIVE' || (r.txnType === 'TRANSFER_IN' && r.confirmed === true) },
  out: { label: 'what went out', is: r => r.txnType === 'ISSUE' || r.txnType === 'FBA' || r.txnType === 'FBA_RETURN' },
  fba: { label: 'what went to FBA', is: r => r.txnType === 'FBA' || r.txnType === 'FBA_RETURN' },
};

function fgiRenderLedger() {
  const q = $('fgQ').value.trim().toLowerCase();
  const d1 = $('fgD1').value, d2 = $('fgD2').value;
  /* The row's own date is day-first; the pickers are ISO. Compared as milliseconds so neither
   * format has to be trusted to sort as text. */
  const ms = r => ptDtMs(r.date) || ptDtMs(r.createdAt);
  const from = d1 ? new Date(d1 + 'T00:00:00').getTime() : 0;
  const to = d2 ? new Date(d2 + 'T23:59:59').getTime() : Infinity;
  const kpi = FGI_KPI_ROWS[FGI_KPI];
  const rows = (FGI.rows || [])
    .filter(r => !kpi || kpi.is(r))
    .filter(r => { const m = ms(r); return !m || (m >= from && m <= to); })
    .filter(r => !$('fgStat').value || true)
    .filter(r => !q || [r.sku, r.txnType, r.issuedFor, r.receivedFrom, r.reason, r.remarks, r.createdBy].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  FGI.shown = rows;
  const pill = { OPENING: '', TRANSFER_IN: 'pill-low', RECEIPT_CONFIRM: 'pill-ok', ISSUE: 'pill-out', RETURN_TO_PRESS: 'pill-out', FBA: 'pill-out', FBA_RETURN: 'pill-ok' };
  const canEd = fgiCanEdit();
  const pickable = rows.slice(0, 600).filter(r => !fgiIsMarker(r)).map(fgiRowId);
  const allOn = canEd && pickable.length > 0 && pickable.every(id => FGI_PICK.ledger.has(id));
  const head = '<thead><tr>' + (canEd ? `<th><input type="checkbox" data-fgall="ledger"${allOn ? ' checked' : ''} title="Tick every movement shown"></th>` : '')
    + ['When', 'What', 'SKU', 'Image', 'Qty', 'For / from', 'Reason', 'By', 'Remarks', 'State', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 4 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const what = r => r.txnType === 'OPENING' && r.adjust ? 'count correction'
    : (r.txnType === 'FBA_RETURN' ? 'back from FBA' : String(r.txnType || '').replace(/_/g, ' ').toLowerCase());
  $('fgTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
    + (canEd ? `<td>${fgiIsMarker(r) ? '' : `<input type="checkbox" data-fgpick="${esc(fgiRowId(r))}"${FGI_PICK.ledger.has(fgiRowId(r)) ? ' checked' : ''}>`}</td>` : '')
    + `<td class="frz">${esc(String(r.createdAt || '').slice(0, 16).replace('T', ' '))}</td>`
    + `<td><span class="pill ${pill[r.txnType] || ''}">${esc(what(r))}</span>${(r.edits && r.edits.length) ? `<div class="muted" style="font-size:10px">edited</div>` : ''}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku)
    + `<td class="num" style="font-weight:700">${nf(fgiNum(r.qty))}</td>`
    + `<td style="text-align:left">${esc(r.issuedFor || r.receivedFrom || r.fromPress || '')}${r.orderNo
      ? `<div class="muted" style="font-size:10.5px;font-family:ui-monospace,monospace">${r.orderSource === 'external' ? '<span class="pill" style="font-size:9.5px;padding:0 5px">EXT</span> ' : ''}${esc(r.orderNo)}${r.orderSource === 'external' && r.extOrderFrom ? ' · ' + esc(r.extOrderFrom) : ''}</div>` : ''}</td>`
    + `<td style="text-align:left">${esc(r.reason || (r.handoverTo ? 'handed to ' + r.handoverTo : '')) || '<span class="muted">—</span>'}</td>`
    + `<td>${esc(String(r.createdBy || '').split('@')[0])}</td>`
    + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(r.remarks)}</td>`
    + `<td>${r.txnType === 'FBA'
      ? (s => `<span class="pill ${FBA_PILL[s.st][0]}">${FBA_PILL[s.st][1]}</span>`
          + (s.returned && s.st !== 'returned' ? `<div class="muted" style="font-size:10px">${nf(s.returned)} back</div>` : ''))(fbaState(r))
      : r.txnType !== 'TRANSFER_IN' ? '<span class="muted">—</span>'
      : (r.reversed ? '<span class="pill pill-out">returned</span>'
        : (r.confirmed ? '<span class="pill pill-ok">counted in</span>' : '<span class="pill pill-low">waiting</span>'))}</td>`
    + `<td style="white-space:nowrap">${canEd && !fgiIsMarker(r)
      ? `<button class="ghost" data-fged="${esc(fgiRowId(r))}" style="padding:2px 9px;font-size:12px">Edit</button>`
        + ` <button class="ghost" data-fgdel="${esc(fgiRowId(r))}" style="padding:2px 9px;font-size:12px;color:var(--bad)">Delete</button>` : ''}${fgiCorrCell(r)}</td>`
    + '</tr>').join('') + '</tbody>';
  $('fgMsg').className = 'muted';
  const inn = rows.filter(r => FGI_KINDS[r.txnType] ? FGI_KINDS[r.txnType].dir > 0 : (r.txnType === 'OPENING' || r.txnType === 'FBA_RETURN'))
    .reduce((s, r) => s + fgiNum(r.qty), 0);
  const out = rows.filter(r => FGI_KINDS[r.txnType] && FGI_KINDS[r.txnType].dir < 0).reduce((s, r) => s + fgiNum(r.qty), 0);
  $('fgMsg').textContent = `${nf(rows.length)} movement(s), newest first`
    + (kpi ? ` · ${kpi.label} only — press the same tile again for everything` : '')
    + ` · ${nf(inn)} in, ${nf(out)} out`
    + ((d1 || d2) ? ' · in the dates chosen' : '')
    + (rows.length > 600 ? ' · showing the first 600' : '')
    + ' · a receipt row is a marker; its quantity is not added again';
}

function fgiRenderPending() {
  const rows = fgiPending().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  FGI.shown = rows;
  const head = '<thead><tr>' + ['Sent', 'SKU', 'Image', 'Item', 'Pieces sent', 'Sent by', 'Remarks', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 4 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(r => '<tr>'
    + `<td class="frz">${esc(String(r.createdAt || '').slice(0, 16).replace('T', ' '))}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku)
    + `<td>${esc([fgiMaster(r.sku).subtype, fgiMaster(r.sku).color, fgiMaster(r.sku).size].filter(Boolean).join(' · '))}</td>`
    + `<td class="num" style="font-weight:700">${nf(fgiNum(r.qty))}</td>`
    + `<td>${esc(String(r.createdBy || '').split('@')[0])}</td>`
    + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(r.remarks)}</td>`
    + `<td>${fgiCanEdit() ? `<button data-fgrcv="${esc(r._id || r.id)}" style="padding:3px 9px;font-size:12px">Count it in</button>` : ''}</td>`
    + '</tr>').join('') : '<tr><td colspan="8" class="muted" style="padding:16px">Nothing is waiting to be counted in.</td></tr>') + '</tbody>';
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = rows.length
    ? `${nf(rows.length)} transfer(s) sent from press and not yet counted into the store. Until they are, they are not stock.`
    : 'Everything sent from press has been counted in.';
  ptImgFill(rows.map(r => r.sku), false, ptImgPatch);
}

/* ---- press → the store ---- */
let FGT = { picked: new Map() };

async function fgiTransferOpen() {
  if (!ME.admin) return;
  if (!PTG.press) await ptLoadGates();
  FGT = { picked: new Map() };
  const rows = (PTG.press || []).filter(r => r && fgiPressLeft(r) > 0)
    .sort((a, b) => ptDtMs(b.entryDate || b.addedAt) - ptDtMs(a.entryDate || a.addedAt));
  ptOpenDialog({
    title: 'Send finished pieces to the store',
    subtitle: `${nf(rows.length)} press entr${rows.length === 1 ? 'y has' : 'ies have'} pieces still to send`,
    note: 'Put in how many of each you are sending. Less than the whole row is fine — the rest stays '
      + 'open in Press. Nothing becomes stock until somebody counts it in at the store.',
    html: `<input id="fgtQ" type="text" placeholder="Search SKU / order / colour" style="width:100%;margin-bottom:8px">
      <div class="xlwrap" style="max-height:46vh;border:1px solid var(--line);border-radius:10px">
        <table class="xl" id="fgtTable"></table></div>
      <div id="fgtTot" class="muted" style="margin-top:8px;font-size:12.5px"></div>
      <label style="display:block;margin-top:8px">Remarks<input id="fgtRemarks" type="text" placeholder="optional"></label>`,
    onSave: fgiTransferSave,
    saveLabel: 'Send to the store',
  });
  ptDebounce('fgtQ', () => fgiTransferRows(rows));
  fgiTransferRows(rows);
}

function fgiTransferRows(rows) {
  const q = ($('fgtQ') || {}).value ? $('fgtQ').value.trim().toLowerCase() : '';
  const shown = rows.filter(r => !q || [r.sku, r.orderNo, r.articleType, r.color, r.size].join(' ').toLowerCase().includes(q));
  $('fgtTable').innerHTML = '<thead><tr>'
    + ['SKU', 'Item', 'Order', 'Pressed', 'Already sent', 'Left', 'Sending now'].map((h, i) =>
      `<th${i >= 3 ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + shown.slice(0, 400).map(r => {
      const left = fgiPressLeft(r), id = r.id || r._key;
      return '<tr>'
        + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
        + `<td style="text-align:left;font-size:11.5px">${esc([r.articleSubtype || r.articleType || r.itemName, r.color, r.size].filter(Boolean).join(' · '))}</td>`
        + `<td>${esc(r.orderNo) || '<span class="muted">none</span>'}</td>`
        + `<td class="num">${nf(parseInt(r.pieces, 10) || 0)}</td>`
        + `<td class="num">${fgiNum(r.transferredQty) ? nf(fgiNum(r.transferredQty)) : '<span class="muted">—</span>'}</td>`
        + `<td class="num" style="font-weight:700">${nf(left)}</td>`
        + `<td class="num"><input data-fgt="${esc(id)}" type="number" min="0" max="${left}" step="1"`
        + ` value="${esc(FGT.picked.get(id) || '')}" placeholder="0" style="width:84px;text-align:right"></td></tr>`;
    }).join('') + '</tbody>';
  if (shown.length > 400) $('fgtTot').textContent = `Showing the first 400 of ${nf(shown.length)} rows — narrow the search to reach the rest.`;
  fgiTransferTotal();
}

function fgiTransferTotal() {
  let n = 0, pcs = 0;
  FGT.picked.forEach(v => { const q = parseInt(v, 10) || 0; if (q > 0) { n++; pcs += q; } });
  const el = $('fgtTot'); if (el && !/Showing the first/.test(el.textContent || ''))
    el.textContent = n ? `${nf(n)} row(s) · ${nf(pcs)} piece(s) to send` : 'Nothing entered yet.';
}

async function fgiTransferSave() {
  const picks = [];
  FGT.picked.forEach((v, id) => { const q = parseInt(v, 10) || 0; if (q > 0) picks.push({ id, qty: q }); });
  if (!picks.length) return 'Put a quantity against at least one row.';
  const remarks = String(($('fgtRemarks') || {}).value || '').trim();
  const now = new Date().toISOString();
  const updates = {}, added = [];
  for (const p of picks) {
    const r = (PTG.press || []).find(x => (x.id || x._key) === p.id);
    if (!r) return 'One of those press rows is no longer there — refresh and try again.';
    const left = fgiPressLeft(r);
    /* Checked again at save: the browser could have been open while somebody else sent the same row. */
    if (p.qty > left) return `${obUC(r.sku)} has only ${nf(left)} piece(s) left on that press entry, not ${nf(p.qty)}.`;
    const rec = { _id: fgiNewId('TRF'), txnType: 'TRANSFER_IN', sku: obUC(r.sku), qty: p.qty,
      fromPress: r.id || r._key, orderNo: r.orderNo || '', remarks,
      confirmed: false, createdAt: now, createdBy: ME.email };
    updates['pt_fgiLedger/' + rec._id] = rec;
    // The press row remembers how much of it has gone, so it can never be sent twice.
    updates['pt_pressInventory/' + (r.id || r._key) + '/transferredQty'] = fgiNum(r.transferredQty) + p.qty;
    added.push({ rec, r, qty: p.qty });
  }
  await ptPatch(updates);
  added.forEach(({ rec, r, qty }) => {
    FGI.rows = (FGI.rows || []).concat(rec);
    r.transferredQty = fgiNum(r.transferredQty) + qty;
  });
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(picks.length)} transfer(s) sent, ${nf(picks.reduce((s, p) => s + p.qty, 0))} piece(s). `
    + 'They are not stock until they are counted in — see "Waiting to be counted in".';
  return '';
}

/* ---- counting a transfer into the store ---- */
function fgiReceiveOpen(id) {
  const tr = (FGI.rows || []).find(r => (r._id || r.id) === id); if (!tr) return;
  const sent = fgiNum(tr.qty);
  ptOpenDialog({
    title: 'Count in ' + obUC(tr.sku),
    subtitle: `${nf(sent)} piece(s) sent from press on ${String(tr.createdAt || '').slice(0, 10)}`
      + `${tr.createdBy ? ' by ' + String(tr.createdBy).split('@')[0] : ''}`,
    note: 'Count what actually arrived. If it does not match what was sent, this will not go through — '
      + 'a difference is a real thing to look into, not something to write over.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Pieces sent<input type="text" value="${nf(sent)}" readonly style="background:var(--hover);color:var(--muted)"></label>
        <label>Pieces counted<input id="fgrGot" type="number" min="0" step="1" placeholder="count them"></label>
        <label style="grid-column:1/-1">Remarks<input id="fgrRemarks" type="text" placeholder="optional"></label>
      </div>`,
    onSave: () => fgiReceiveSave(id),
    saveLabel: 'Count it in',
    alt: { label: 'Send it back to press', run: () => fgiReturnSave(id) },
  });
}

async function fgiReceiveSave(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const tr = (FGI.rows || []).find(r => (r._id || r.id) === id); if (!tr) return 'That transfer is gone.';
  const got = parseInt(($('fgrGot') || {}).value, 10);
  if (!isFinite(got) || got < 0) return 'Put in how many pieces you counted.';
  const sent = fgiNum(tr.qty);
  if (got !== sent) return `${nf(sent)} were sent and ${nf(got)} were counted. Find the difference first — `
    + 'send the transfer back to press if it was wrong, or count again.';
  const now = new Date().toISOString();
  const marker = { _id: fgiNewId('RCV'), txnType: 'RECEIPT_CONFIRM', sku: obUC(tr.sku), qty: got,
    linkedTransferId: tr._id || tr.id, remarks: String(($('fgrRemarks') || {}).value || '').trim(),
    receivedBy: ME.email, createdAt: now, createdBy: ME.email };
  /* Both in one PATCH: a confirmed transfer with no marker, or a marker with an unconfirmed
   * transfer, would each leave the ledger telling two different stories. */
  await ptPatch({
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/confirmed']: true,
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/confirmedAt']: now,
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/receivedBy']: ME.email,
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/receivedQty']: got,
    ['pt_fgiLedger/' + marker._id]: marker,
  });
  tr.confirmed = true; tr.confirmedAt = now; tr.receivedBy = ME.email; tr.receivedQty = got;
  FGI.rows = (FGI.rows || []).concat(marker);
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(got)} piece(s) of ${obUC(tr.sku)} counted into the store. They are stock now.`;
  return '';
}

async function fgiReturnSave(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const tr = (FGI.rows || []).find(r => (r._id || r.id) === id); if (!tr) return 'That transfer is gone.';
  const why = String(($('fgrRemarks') || {}).value || '').trim();
  if (!why) return 'Say why it is going back — that remark is the only record of what was wrong.';
  const now = new Date().toISOString();
  const marker = { _id: fgiNewId('RET'), txnType: 'RETURN_TO_PRESS', sku: obUC(tr.sku), qty: fgiNum(tr.qty),
    linkedTransferId: tr._id || tr.id, remarks: why, createdAt: now, createdBy: ME.email };
  const press = (PTG.press || []).find(x => (x.id || x._key) === tr.fromPress);
  const updates = {
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/reversed']: true,
    ['pt_fgiLedger/' + (tr._id || tr.id) + '/reversedAt']: now,
    ['pt_fgiLedger/' + marker._id]: marker,
  };
  // The pieces become available on the press row again, or they are lost to both sides.
  if (press) updates['pt_pressInventory/' + (press.id || press._key) + '/transferredQty'] = Math.max(0, fgiNum(press.transferredQty) - fgiNum(tr.qty));
  await ptPatch(updates);
  tr.reversed = true; tr.reversedAt = now;
  if (press) press.transferredQty = Math.max(0, fgiNum(press.transferredQty) - fgiNum(tr.qty));
  FGI.rows = (FGI.rows || []).concat(marker);
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(fgiNum(tr.qty))} piece(s) of ${obUC(tr.sku)} sent back to press`
    + (press ? ' and available there again.' : '. The original press entry could not be found, so nothing was given back to it — check Press Inventory.');
  return '';
}

/* ---- the old two-part issue form is replaced by the one entry form below ---- */
const fgiIssueOpen = sku => fgiEntryOpen('ISSUE', sku);
const fgiFbaOpen = sku => fgiEntryOpen('FBA', sku);
const fgiReceiveNewOpen = () => fgiEntryOpen('RECEIVE', '');

/* ---- opening stock ---- */
function fgiOpeningOpen() {
  ptOpenDialog({
    title: 'Opening stock',
    subtitle: 'What was already in the store before this ledger started',
    note: 'One line per SKU, as "SKU, pieces" — paste it straight out of a spreadsheet if you like. '
      + 'An opening entry is also how a miscount is corrected: a negative number takes stock away.',
    html: `<label style="display:block">SKU and pieces
        <textarea id="fgoText" rows="10" placeholder="RPC165-2020, 120&#10;RTC627-6060, 45"
          style="width:100%;font-family:ui-monospace,monospace;font-size:12.5px"></textarea></label>
      <label style="display:block;margin-top:8px">Remarks<input id="fgoRemarks" type="text" placeholder="what this count was"></label>
      <div id="fgoPrev" class="muted" style="margin-top:8px;font-size:12.5px"></div>`,
    onSave: fgiOpeningSave,
    saveLabel: 'Add to the ledger',
  });
  ptDebounce('fgoText', fgiOpeningPreview);
}

/** Split on commas, tabs or runs of spaces, so a paste from anywhere works. */
function fgiOpeningParse(text) {
  const out = [], bad = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    const s = line.trim(); if (!s) return;
    const parts = s.split(/[,\t]|\s{2,}|\s+(?=-?\d+(?:\.\d+)?$)/).map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) { bad.push(`Line ${i + 1}: "${s}" has no quantity.`); return; }
    const sku = obUC(parts[0]), qty = parseFloat(parts[parts.length - 1]);
    if (!sku) { bad.push(`Line ${i + 1}: no SKU.`); return; }
    if (!isFinite(qty) || qty === 0) { bad.push(`Line ${i + 1}: "${parts[parts.length - 1]}" is not a quantity.`); return; }
    out.push({ sku, qty });
  });
  return { out, bad };
}

function fgiOpeningPreview() {
  const { out, bad } = fgiOpeningParse(($('fgoText') || {}).value);
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const unknown = out.filter(r => !known.has(r.sku)).map(r => r.sku);
  const el = $('fgoPrev'); if (!el) return;
  el.className = (bad.length || unknown.length) ? 'err' : 'muted';
  el.textContent = bad.length ? bad.slice(0, 4).join(' ')
    : `${nf(out.length)} line(s) · ${nf(out.reduce((s, r) => s + r.qty, 0))} piece(s)`
      + (unknown.length ? ` · not in the master database: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ''}` : '');
}

async function fgiOpeningSave() {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const { out, bad } = fgiOpeningParse(($('fgoText') || {}).value);
  if (bad.length) return bad.slice(0, 4).join(' ');
  if (!out.length) return 'Nothing to add.';
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const unknown = [...new Set(out.filter(r => !known.has(r.sku)).map(r => r.sku))];
  /* A SKU the master does not know would sit in the store with no name, size or picture for ever. */
  if (unknown.length) return `Not in the master database: ${unknown.slice(0, 6).join(', ')}`
    + `${unknown.length > 6 ? ` and ${unknown.length - 6} more` : ''}. Add them there first, or take those lines out.`;
  const remarks = String(($('fgoRemarks') || {}).value || '').trim();
  const now = new Date().toISOString();
  const updates = {}, recs = [];
  out.forEach(r => {
    const rec = { _id: fgiNewId('OPN'), txnType: 'OPENING', sku: r.sku, qty: r.qty, remarks,
      createdAt: now, createdBy: ME.email };
    updates['pt_fgiLedger/' + rec._id] = rec; recs.push(rec);
  });
  await ptPatch(updates);
  FGI.rows = (FGI.rows || []).concat(recs);
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(recs.length)} opening line(s) added, ${nf(out.reduce((s, r) => s + r.qty, 0))} piece(s).`;
  return '';
}

/* ---- wiring ---- */
$('fgTable').addEventListener('click', e => {
  const pk = e.target.closest('[data-fgpick]');
  if (pk) {
    const set = $('fgView').value === 'stock' ? FGI_PICK.stock : FGI_PICK.ledger;
    const k = pk.getAttribute('data-fgpick');
    if (pk.checked) set.add(k); else set.delete(k);
    fgiPickCount();
    return;
  }
  const al = e.target.closest('[data-fgall]');
  if (al) {
    const stockView = al.getAttribute('data-fgall') === 'stock';
    const set = stockView ? FGI_PICK.stock : FGI_PICK.ledger;
    (FGI.shown || []).slice(0, 600).forEach(r => {
      if (!stockView && fgiIsMarker(r)) return;
      const k = stockView ? r.sku : fgiRowId(r);
      if (al.checked) set.add(k); else set.delete(k);
    });
    renderFgi();
    return;
  }
  const lc = e.target.closest('[data-lstclose]'); if (lc) return lstCloseOpen(lc.getAttribute('data-lstclose'));
  const ov = e.target.closest('[data-fgoverok]');
  if (ov) return fgiOverReview(ov.getAttribute('data-fgoverok')).then(why => { if (why) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; } });
  const cq = e.target.closest('[data-fgcreq]'); if (cq) return fgiCorrOpen(cq.getAttribute('data-fgcreq'));
  const cok = e.target.closest('[data-fgcok]');
  if (cok) return fgiCorrApprove(cok.getAttribute('data-fgcok')).then(why => { if (why) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; } });
  const cno = e.target.closest('[data-fgcno]'); if (cno) return fgiCorrRejectOpen(cno.getAttribute('data-fgcno'));
  const ed = e.target.closest('[data-fged]'); if (ed) return fgiEditOpen(ed.getAttribute('data-fged'));
  const se = e.target.closest('[data-fgskued]'); if (se) return fgiSkuEditOpen(se.getAttribute('data-fgskued'));
  const sd = e.target.closest('[data-fgskudel]'); if (sd) return fgiSkuDeleteAsk([sd.getAttribute('data-fgskudel')]);
  const mv = e.target.closest('[data-fgmoves]');
  if (mv) {
    /* One SKU, everything that ever happened to it — the question this screen is opened with. */
    $('fgView').value = 'ledger';
    $('fgQ').value = mv.getAttribute('data-fgmoves');
    $('fgD1').value = ''; $('fgD2').value = '';
    return renderFgi();
  }
  const n = e.target.closest('[data-fgentry]'); if (n) return fgiEntryOpen('ISSUE', n.getAttribute('data-fgentry'));
  const s = e.target.closest('[data-fgset]'); if (s) return fgiSetOpen(s.getAttribute('data-fgset'));
  const r = e.target.closest('[data-fgrcv]'); if (r) return fgiReceiveOpen(r.getAttribute('data-fgrcv'));
  const d = e.target.closest('[data-fgdel]'); if (d) return fgiDeleteAsk(d.getAttribute('data-fgdel'));
});
$('fgEntry').onclick = () => fgiEntryOpen('RECEIVE', '');
if ($('fgRecvXl')) $('fgRecvXl').onclick = () => fgiRecvXlOpen();
if ($('fgIssXl')) $('fgIssXl').onclick = () => fgiXlOpen('ISSUE');
$('fgScan').onclick = () => fgiScanOpen();
$('fgEditPicked').onclick = () => ($('fgView').value === 'stock' ? fgiSkuBulkEditOpen() : fgiBulkEditOpen());
$('fgDelPicked').onclick = () => ($('fgView').value === 'stock' ? fgiSkuDeleteAsk([...FGI_PICK.stock]) : fgiBulkDeleteAsk());
/* "Fetch live stock", "Start over" and "Send from press" were taken off this screen on 12 Sept: the
 * register is entered here and nowhere else now. fgiSeedOpen, fgiWipeOpen and fgiTransferOpen are
 * left defined on purpose — they are the only written description of how the seeding worked, and a
 * button can be put back in one line if it is ever wanted. */
['fgBrand', 'fgStat', 'fgTag', 'fgAmz', 'fgD1', 'fgD2'].forEach(id => $(id).addEventListener('change', renderFgi));
$('fgLstRefresh').onclick = async () => {
  $('fgLstRefresh').disabled = true;
  const why = await lstRefresh(t => { $('fgMsg').className = 'muted'; $('fgMsg').textContent = t; });
  $('fgLstRefresh').disabled = false;
  if (why) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; return; }
  const said = $('fgMsg').textContent;
  renderFgi();
  $('fgMsg').className = 'muted'; $('fgMsg').textContent = said;
};
$('ptDlgBody').addEventListener('input', e => {
  const el = e.target.closest('[data-fgt]');
  if (el) { FGT.picked.set(el.getAttribute('data-fgt'), el.value); fgiTransferTotal(); }
});
$('fgView').addEventListener('change', renderFgi);
if ($('fgAlerts')) $('fgAlerts').addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('[data-fgview]') : null;
  if (!b) return;
  $('fgView').value = $('fgView').value === b.dataset.fgview ? 'stock' : b.dataset.fgview;   // pressed again: back to the store
  renderFgi();
});
$('fgKpis').addEventListener('click', e => {
  const t = e.target.closest('[data-fgkpi]');
  if (!t) return;
  const k = t.getAttribute('data-fgkpi');
  /* The same tile again is the way back to everything — no second control to find. */
  const off = FGI_KPI_ON === k;
  FGI_KPI_ON = off ? '' : k;
  FGI_KPI = '';
  $('fgQ').value = '';
  if (off) { $('fgView').value = 'stock'; $('fgZero').checked = false; return renderFgi(); }
  if (k === 'skus') { $('fgView').value = 'stock'; $('fgZero').checked = false; }
  else if (k === 'in' || k === 'stock') { $('fgView').value = 'stock'; $('fgZero').checked = true; }
  else if (k === 'press') { $('fgView').value = 'pending'; }
  else { $('fgView').value = 'ledger'; $('fgD1').value = ''; $('fgD2').value = ''; FGI_KPI = k; }
  renderFgi();
});
$('fgZero').addEventListener('change', renderFgi);
ptDebounce('fgQ', renderFgi);

$('fgOpening').onclick = () => fgiOpeningOpen();
$('fgExport').onclick = () => {
  const view = $('fgView').value;
  if (view === 'stock') {
    const rows = FGI.shown || []; if (!rows.length) return;
    ptDownload('finished-goods-stock', [['SKU', 'Brand', 'Item', 'Subtype', 'Colour', 'Size', 'Opening', 'Received',
      'Issued', 'To FBA', 'In stock', 'Not counted in', 'Status', 'Re-order level', 'Amazon', 'Tag', 'Rate', 'Value'].map(csvCell).join(',')]
      .concat(rows.map(r => [r.sku, r.brand, r.articleType, r.subtype, r.color, r.size, r.opening, r.received,
        r.issued, r.fba, r.current, r.pending, r.status.txt, r.reorder, LST_PILL[lstOf(r.sku).st][1], r.remark,
        r.price === null ? '' : r.price, r.value === null ? '' : Math.round(r.value)].map(csvCell).join(','))));
    return;
  }
  const rows = FGI.shown || []; if (!rows.length) return;
  ptDownload('finished-goods-ledger', [['When', 'Date', 'What', 'SKU', 'Qty', 'For / from', 'Order No', 'Order source', 'Reason', 'By', 'Remarks', 'Confirmed', 'Reversed', 'FBA status', 'Shipment', 'Edited'].map(csvCell).join(',')]
    .concat(rows.map(r => [r.createdAt, r.date || '', r.adjust ? 'COUNT_CORRECTION' : r.txnType, r.sku, fgiNum(r.qty),
      r.issuedFor || r.receivedFrom || r.fromPress || '', r.orderNo || '', r.orderSource || '', r.reason || '',
      r.createdBy, r.remarks, r.confirmed === true ? 'yes' : '', r.reversed === true ? 'yes' : '',
      r.txnType === 'FBA' ? FBA_PILL[fbaState(r).st][1] : '', r.fbaShipment || '',
      (r.edits && r.edits.length) ? r.edits.length : ''].map(csvCell).join(','))));
};

