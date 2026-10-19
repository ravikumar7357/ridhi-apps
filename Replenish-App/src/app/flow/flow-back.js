/* ================= BACK TO THE SALES TEAM =================
 * Ravi, 15 Oct: "back to sale team function bhi add karo yadi order me koi problem h to". PPC finds a line it cannot plan —
 * the SKU is wrong, the master has no fabric / consumption / colour, the quantity or the details are wrong — and sends it
 * back with a reason. The line leaves PPC and waits in "Back to sales team" (a bucket of this screen) and on top of Sales
 * Orders, where the sales team puts the order or the master right and sends it to PPC again. The Order Console says so on
 * the line too.
 *
 * Nothing is deleted. It is written on the line's order-book rows, the way a close is (orders/close-lines.js):
 *   ppcBack = { at, by, why, note, doneAt?, doneBy?, doneNote?, log: [{ act: 'back' | 'again', why?, note, at, by }] }
 * A line is with the sales team while ppcBack.at is set and ppcBack.doneAt is not. Only a line PPC has not planned can go
 * back: a planned one has its plan undone in PPC completed first. */
const FLOW_BACK_WHY = [
  ['sku', 'SKU wrong, or not in the master'],
  ['master', 'Master incomplete — fabric, consumption, colour or size missing'],
  ['qty', 'Quantity wrong'],
  ['detail', 'Order details missing or unclear'],
  ['customer', 'Check with the customer — change or cancel'],
  ['other', 'Other — write why'],
];
const flowBackTxt = w => (FLOW_BACK_WHY.find(x => x[0] === w) || [, w || 'Other'])[1];
/** Is the line with the sales team now? */
const flowIsBack = r => !!(r && r.ppcBack && r.ppcBack.at && !r.ppcBack.doneAt);
/** PPC sends back; the sales team (Sales Orders, Order Console, Shopify Orders) sends again — and PPC may take it back itself. */
const flowCanBack = () => !!(ME.admin || (ME.tabs || []).includes('flppc'));
const flowCanAgain = () => !!(ME.admin || ['flppc', 'so', 'ord', 'shop'].some(t => (ME.tabs || []).includes(t)));
/** Who has it, in a few words, for a pill or a cell. */
const flowBackSays = b => flowBackTxt(b.why) + (b.note ? ' — ' + b.note : '');

/** Write the new ppcBack on every order-book row of each line. items: [{orderNo, sku}]; mk(old) → the new ppcBack. */
async function flowBackWrite(items, mk) {
  const patch = {}, touched = new Map();
  items.forEach(({ orderNo, sku }) => {
    (PTG.ob || []).filter(r => r && obUC(r.orderNo) === obUC(orderNo) && obUC(r.sku) === obUC(sku)).forEach(r => {
      const key = r.id || r._key; if (!key) return;
      const nb = mk(r.ppcBack || null);
      patch['pt_orderBook/' + key + '/ppcBack'] = nb; touched.set(key, nb);
    });
  });
  if (!touched.size) return 'Its order-book row is gone — press Refresh.';
  try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
  PTG.ob = (PTG.ob || []).map(r => { const k = r && (r.id || r._key); return k && touched.has(k) ? Object.assign({}, r, { ppcBack: touched.get(k) }) : r; });
  return '';
}

/** "Back to sales" — the lines picked (ticked in the dialog), one reason and a note for them all. */
function flowBackOpen(keys) {
  if (!flowCanBack()) return;
  const rows = flowRows().filter(x => keys.includes(x.s.key) && x.s.bucket === 'ppc' && !x.r.__t);
  if (!rows.length) return;
  ptOpenDialog({
    title: rows.length > 1 ? `Back to the sales team — ${nf(rows.length)} lines` : `Back to the sales team — ${rows[0].r.orderNo} · ${rows[0].r.sku}`,
    subtitle: 'The line leaves PPC and waits with the sales team (Sales Orders) until they put it right and send it again.',
    html: (rows.length > 1 ? `<div style="max-height:220px;overflow:auto;margin-bottom:10px">${rows.map(x =>
        `<label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" data-flbk="${esc(x.s.key)}" checked style="width:auto"> ${esc(x.r.orderNo)} · <b>${esc(x.r.sku)}</b> · ${nf(x.r.qty)}</label>`).join('')}</div>` : '')
      + `<label>What is wrong<select id="flbkWhy">${FLOW_BACK_WHY.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>`
      + '<label>Note for the sales team<textarea id="flbkNote" rows="3" placeholder="What needs fixing — e.g. no consumption on the master for 5x4.5x5"></textarea></label>',
    saveLabel: 'Send back',
    onSave: async () => {
      const why = $('flbkWhy').value, note = $('flbkNote').value.trim();
      if (why === 'other' && !note) return 'Write why it goes back.';
      const picked = rows.length > 1 ? rows.filter(x => { const b = document.querySelector(`[data-flbk="${x.s.key}"]`); return !b || b.checked; }) : rows;
      if (!picked.length) return 'Tick at least one line.';
      const at = new Date().toISOString(), by = ME.email || '';
      const err = await flowBackWrite(picked.map(x => x.r), old => ({ at, by, why, note,
        log: (old && Array.isArray(old.log) ? old.log.slice(-19) : []).concat([{ act: 'back', why, note, at, by }]) }));
      if (err) return err;
      renderFlow();
      return '';
    },
  });
}

/** "Send to PPC again" — the sales team has put it right (or PPC takes it back). A note says what was done. */
function flowAgainOpen(items) {
  if (!flowCanAgain() || !items.length) return;
  const one = items[0];
  ptOpenDialog({
    title: items.length > 1 ? `Send ${nf(items.length)} lines to PPC again` : `Send to PPC again — ${one.orderNo} · ${one.sku}`,
    subtitle: 'The line goes back into PPC, to be planned. What PPC said stays in its history.',
    html: '<label>What was done<textarea id="flagNote" rows="3" placeholder="e.g. consumption added on the master; quantity corrected on the sales order"></textarea></label>',
    saveLabel: 'Send to PPC',
    onSave: async () => {
      const note = $('flagNote').value.trim(); if (!note) return 'Say what was put right.';
      const at = new Date().toISOString(), by = ME.email || '';
      const err = await flowBackWrite(items, old => Object.assign({}, old || {}, { doneAt: at, doneBy: by, doneNote: note,
        log: (old && Array.isArray(old.log) ? old.log.slice(-19) : []).concat([{ act: 'again', note, at, by }]) }));
      if (err) return err;
      try { if (typeof renderFlow === 'function' && $('flTable')) renderFlow(); } catch (e) { /* the flow is not open */ }
      try { if (typeof renderSox === 'function' && SOX.rows) renderSox(); } catch (e) { /* the sales orders are not open */ }
      try { if (typeof renderOrd === 'function') renderOrd(); } catch (e) { /* the console is not open */ }
      return '';
    },
  });
}

/** Every line with the sales team now, newest first — for Sales Orders. */
function flowBackLines() {
  return (typeof ordLines === 'function' ? ordLines() : []).filter(l => l.open !== false && flowIsBack(l))
    .sort((a, b) => String(b.ppcBack.at).localeCompare(String(a.ppcBack.at)));
}

/** The card on top of Sales Orders: what PPC sent back, and the button that sends it again. Empty when nothing is back. */
function flowBackCard() {
  const rows = flowBackLines();
  if (!rows.length) return '';
  const can = flowCanAgain();
  return `<div class="card" style="border-left:4px solid #b91c1c;margin-top:10px;padding:10px 14px">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="color:#b91c1c">Sent back by PPC · ${nf(rows.length)}</b>
      <span class="muted" style="font-size:12.5px">PPC cannot plan these. Put the order or the master right, then send the line to PPC again.</span></div>
    <div class="xlwrap" style="margin-top:8px"><table class="xl xl-dense"><thead><tr><th class="frz">Order</th><th>SKU</th><th class="num">Qty</th><th>What is wrong</th><th>Sent back</th><th></th></tr></thead><tbody>
    ${rows.map(l => { const b = l.ppcBack, so = (SOX.rows || []).some(o => o && obUC(o._id) === obUC(l.orderNo));
      return `<tr><td class="frz" style="text-align:left;font-weight:600">${esc(l.orderNo)}</td>
        <td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b><div class="muted" style="font-size:11.5px">${esc([l.articleSubtype || l.articleType, l.color, l.size].filter(Boolean).join(' · '))}</div></td>
        <td class="num">${nf(l.qty)}</td>
        <td style="text-align:left;white-space:normal;max-width:360px"><b>${esc(flowBackTxt(b.why))}</b>${b.note ? `<div style="font-size:12.5px">${esc(b.note)}</div>` : ''}</td>
        <td class="muted" style="font-size:12px;white-space:nowrap">${esc(String(b.at).slice(0, 10))}<br>${esc(String(b.by || '').split('@')[0])}</td>
        <td style="white-space:nowrap">${so ? `<button class="ghost" data-so-open="${esc(l.orderNo)}" style="padding:3px 9px;font-size:12px">Open order</button> ` : ''}${can
          ? `<button data-flagain="${esc(l.orderNo + '|' + l.sku)}" style="padding:3px 9px;font-size:12px">Fixed — send to PPC</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
}

/** The pill the Order Console puts in front of a line that is with the sales team. */
const flowBackPill = r => flowIsBack(r) ? `<span class="pill pill-out" title="${esc('Sent back by ' + String(r.ppcBack.by || '').split('@')[0] + ' on ' + String(r.ppcBack.at).slice(0, 10) + ': ' + flowBackSays(r.ppcBack))}">Back with sales · ${esc(flowBackTxt(r.ppcBack.why))}</span> ` : '';

if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('[data-flagain]'); if (!a) return;
  e.preventDefault();
  const [orderNo, sku] = String(a.dataset.flagain).split('|');
  flowAgainOpen([{ orderNo, sku }]);
});
