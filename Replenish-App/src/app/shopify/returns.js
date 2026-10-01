/* ================= SHOPIFY RETURNS — typed by hand, tracked to the USA warehouse =================
 *
 * Ravi, 2026-09-26: "koi ek order h jisme 4 line item me order aaya tha but buyer ne usme se 2 return kar diye to
 * m manually feed karu ki konse order return aaye h kis tracking number ki according h — mera usa me warehouse h
 * baha return jayega."
 *
 * A return is a record on the ORDER's own entry in audit/shoporders (SHOP_META[orderId].returns[id]) — the one place
 * this tab already writes, with the same rights. It names the lines and how many of each came back, the return's
 * tracking number and carrier, why, and where it has got to: started → on its way → received at the warehouse →
 * closed. No unit can be returned twice: the cap is what the order held less what earlier returns already took. */
let SR = { tab: 'open', q: '' };
const SR_STATUS = {
  started: ['Return started', 'pill-low'], transit: ['On its way to the warehouse', 'pill-low'],
  received: ['Received at the warehouse', 'pill-ok'], closed: ['Closed', 'pill-out'],
};
const SR_NEXT = { started: 'transit', transit: 'received', received: 'closed' };
const SR_CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Amazon', 'Other'];
const SR_REASONS = ['Damaged', 'Wrong item', 'Did not like it', 'Size / fit', 'Arrived late', 'Other'];
const srOrders = () => (SHOP.orders || []).concat(soImpLive()).filter(o => o && o.id);
const srOrderOf = oid => srOrders().find(o => String(o.id) === String(oid)) || null;
/** Every return on record, newest first. */
function srAll() {
  const out = [];
  Object.entries(SHOP_META || {}).forEach(([oid, m]) => Object.entries((m && m.returns) || {}).forEach(([id, r]) => {
    if (r && typeof r === 'object') out.push(Object.assign({ id, orderId: oid }, r));
  }));
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
/** Units of one line already on a return (any return but the one being edited). */
function srReturnedQty(orderId, lid, exceptId) {
  let n = 0;
  Object.entries(((SHOP_META || {})[orderId] || {}).returns || {}).forEach(([id, r]) => {
    if (!r || id === exceptId) return;
    (r.items || []).forEach(it => { if (String(it.lid) === String(lid)) n += parseInt(it.qty, 10) || 0; });
  });
  return n;
}
/** What may still come back on each line of an order: ordered − refunded-already-known − returned here. */
function srLineRoom(o, exceptId) {
  return (o.items || []).map(it => {
    const back = srReturnedQty(o.id, it.lid, exceptId);
    return { lid: it.lid, sku: it.sku, name: it.name, variant: it.variant || '', qty: it.qty, back, room: Math.max(0, (it.qty || 0) - back) };
  });
}
/** Write one return (new or edited). Returns '' or why not. */
async function srSave(orderId, rec, id) {
  const o = srOrderOf(orderId);
  if (!o) return 'Pick an order that is loaded on this screen.';
  const room = srLineRoom(o, id);
  const items = (rec.items || []).map(it => ({ lid: String(it.lid), qty: parseInt(it.qty, 10) || 0 })).filter(it => it.qty > 0)
    .map(it => { const l = room.find(x => String(x.lid) === it.lid); return l ? Object.assign(it, { sku: l.sku, name: l.name, variant: l.variant }) : it; });
  if (!items.length) return 'Tick at least one line and say how many came back.';
  for (const it of items) {
    const l = room.find(x => String(x.lid) === it.lid);
    if (!l) return 'That line is not on the order.';
    if (it.qty > l.room) return `${l.sku || l.name}: only ${nf(l.room)} of ${nf(l.qty)} can still come back${l.back ? ' — ' + nf(l.back) + ' already on a return' : ''}.`;
  }
  const status = SR_STATUS[rec.status] ? rec.status : 'started';
  const now = new Date().toISOString();
  const prev = id ? (((SHOP_META[orderId] || {}).returns || {})[id] || {}) : {};
  const out = Object.assign({}, prev, {
    orderNo: o.no || '', shop: o.shopBrand || o.chan || '', customer: (o.ship && o.ship.name) || o.name || '', orderAt: o.at || '',
    items, trk: String(rec.trk || '').trim(), carrier: String(rec.carrier || '').trim(), reason: String(rec.reason || '').trim(),
    note: String(rec.note || '').trim(), status, date: String(rec.date || '').trim() || dToday(),
    at: prev.at || now, by: prev.by || ME.email, updAt: now, updBy: ME.email,
    log: (prev.log || []).concat([{ at: now, by: ME.email, what: (id ? 'edited' : 'started') + ' · ' + SR_STATUS[status][0] }]),
  });
  const rid = id || ('ret_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  SHOP_META[orderId] = Object.assign({}, SHOP_META[orderId] || {}, { returns: Object.assign({}, (SHOP_META[orderId] || {}).returns || {}, { [rid]: out }) });
  try { await saveShopMeta(); } catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}
/** Move a return along: started → on its way → received → closed. */
async function srSetStatus(orderId, id, status, note) {
  const r = (((SHOP_META || {})[orderId] || {}).returns || {})[id];
  if (!r) return 'That return is gone — press Refresh.';
  if (!SR_STATUS[status]) return 'Not a stage.';
  const now = new Date().toISOString();
  const next = Object.assign({}, r, { status, updAt: now, updBy: ME.email, log: (r.log || []).concat([{ at: now, by: ME.email, what: SR_STATUS[status][0] + (note ? ' — ' + note : '') }]) });
  if (status === 'received') next.receivedAt = next.receivedAt || dToday();
  if (status === 'closed') next.closedAt = dToday();
  if (note) next.note = [r.note, note].filter(Boolean).join(' · ');
  SHOP_META[orderId] = Object.assign({}, SHOP_META[orderId], { returns: Object.assign({}, SHOP_META[orderId].returns, { [id]: next }) });
  try { await saveShopMeta(); } catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}
function srRows() {
  const q = SR.q.trim().toLowerCase();
  return srAll().filter(r => (SR.tab === 'all' || (SR.tab === 'open' ? (r.status !== 'closed' && r.status !== 'received') : r.status === SR.tab))
    && (!q || [r.orderNo, r.customer, r.trk, r.carrier, r.reason, r.note].concat((r.items || []).map(i => i.sku + ' ' + i.name)).join(' ').toLowerCase().includes(q)));
}
function srRender() {
  const all = srAll();
  const n = st => all.filter(r => r.status === st).length;
  const lab = { open: `Open · ${nf(all.filter(r => r.status === 'started' || r.status === 'transit').length)}`, received: `At the warehouse · ${nf(n('received'))}`, all: `All · ${nf(all.length)}` };
  document.querySelectorAll('[data-srtab]').forEach(b => { b.textContent = lab[b.getAttribute('data-srtab')]; b.classList.toggle('on', b.getAttribute('data-srtab') === SR.tab); });
  const rows = srRows();
  const head = '<thead><tr>' + ['Order', 'Customer', 'Came back', 'Return tracking', 'Why', 'Stage', 'Started', 'Received', ''].map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const body = rows.map(r => { const st = SR_STATUS[r.status] || ['?', 'pill-low']; const nx = SR_NEXT[r.status]; return '<tr>'
    + `<td class="frz" style="text-align:left"><b>${esc(r.orderNo || r.orderId)}</b><div class="muted" style="font-size:10.5px">${esc(r.shop || '')}${r.orderAt ? ' · ' + esc(r.orderAt) : ''}</div></td>`
    + `<td style="text-align:left">${esc(r.customer || '—')}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:260px">${(r.items || []).map(i => `<b>${nf(i.qty)}</b> × ${esc(i.sku || i.name)}${i.sku && i.name ? ' <span class="muted">' + esc(i.name) + '</span>' : ''}`).join('<br>')}</td>`
    + `<td style="text-align:left;font-family:ui-monospace,monospace">${esc(r.trk || '—')}${r.carrier ? '<div class="muted" style="font-size:10.5px;font-family:inherit">' + esc(r.carrier) + '</div>' : ''}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.reason || '—')}${r.note ? '<div class="muted" style="font-size:10.5px">' + esc(r.note) + '</div>' : ''}</td>`
    + `<td><span class="pill ${st[1]}">${esc(st[0])}</span></td>`
    + `<td>${esc(r.date || ptIsoDate(r.at) || '')}<div class="muted" style="font-size:10.5px">${esc(String(r.by || '').split('@')[0])}</div></td>`
    + `<td>${esc(r.receivedAt || '')}</td>`
    + `<td style="white-space:nowrap">${nx ? `<button type="button" class="jw-btn jw-primary" data-sr-next="${esc(r.orderId)}|${esc(r.id)}|${nx}" style="padding:4px 10px;font-size:12px">${esc(nx === 'transit' ? 'On its way' : nx === 'received' ? 'Received' : 'Close')}</button> ` : ''}`
    + `<button type="button" class="ghost" data-sr-edit="${esc(r.orderId)}|${esc(r.id)}" style="padding:4px 10px;font-size:12px">Edit</button></td></tr>`; }).join('');
  if ($('srTable')) $('srTable').innerHTML = head + '<tbody>' + (body || '<tr><td colspan="9" class="muted" style="padding:14px">No return here yet — press + New return.</td></tr>') + '</tbody>';
}
function srOpen() {
  if (!Object.keys(SHOP_META).length) loadShopMeta().then(() => srRender()).catch(() => {});
  const all = srAll();
  ptOpenDialog({
    title: 'Returns', wide: true, boxClass: 'vo-band',
    titleExtra: `<div class="shb-band"><span class="shb-t">Returns — to the USA warehouse</span>
        <div class="shb-n"><b>${nf(all.filter(r => r.status === 'started' || r.status === 'transit').length)}</b><span>on their way</span></div>
        <div class="shb-n"><b>${nf(all.filter(r => r.status === 'received').length)}</b><span>at the warehouse</span></div>
        <div class="shb-n"><b>${nf(all.reduce((a, r) => a + (r.items || []).reduce((x, i) => x + (parseInt(i.qty, 10) || 0), 0), 0))}</b><span>units back, all time</span></div>
        <button type="button" id="srNew">+ New return</button></div>`,
    html: `<div class="shb-bar"><div class="seg" role="tablist">
        <button type="button" class="segbtn" data-srtab="open"></button><button type="button" class="segbtn" data-srtab="received"></button><button type="button" class="segbtn" data-srtab="all"></button></div>
        <input id="srQ" placeholder="Search order / customer / tracking / SKU" value="${esc(SR.q)}"></div>
      <div class="xlwrap shb-wrap"><table class="xl" id="srTable"></table></div>`,
    saveLabel: 'Close',
    onSave: async () => '',
  });
  document.querySelectorAll('[data-srtab]').forEach(b => { b.onclick = () => { SR.tab = b.getAttribute('data-srtab'); srRender(); }; });
  let t = null;
  if ($('srQ')) $('srQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { SR.q = $('srQ').value; srRender(); }, 180); };
  if ($('srNew')) $('srNew').onclick = () => srNewOpen('', '');
  if ($('srTable')) $('srTable').onclick = async e => {
    const nx = e.target.closest('[data-sr-next]');
    if (nx) {
      const [oid, id, st] = nx.getAttribute('data-sr-next').split('|');
      if (st === 'closed' || st === 'received') {
        return ptOpenDialog({ title: st === 'received' ? 'Received at the warehouse' : 'Close this return',
          fields: [{ key: 'note', label: st === 'received' ? 'Condition / remarks' : 'Why it is closed (refunded, restocked, written off…)', span: true, value: '' }],
          saveLabel: st === 'received' ? 'Received' : 'Close',
          onSave: async v => { const err = await srSetStatus(oid, id, st, v.note); if (!err) srOpen(); return err; } });
      }
      const err = await srSetStatus(oid, id, st, '');
      if (err) soMsg(err, true); else srRender();
      return;
    }
    const ed = e.target.closest('[data-sr-edit]');
    if (ed) { const [oid, id] = ed.getAttribute('data-sr-edit').split('|'); return srNewOpen(oid, id); }
  };
  srRender();
}
/** The form: which order, which lines and how many, the return's tracking, why. */
function srNewOpen(orderId, id) {
  const orders = srOrders().slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const prev = id ? (((SHOP_META[orderId] || {}).returns || {})[id] || {}) : {};
  const o = orderId ? srOrderOf(orderId) : null;
  const linesHtml = ord => !ord ? '<div class="muted" style="font-size:12.5px;margin:8px 0">Pick an order above and its lines appear here.</div>'
    : `<div class="sr-lines"><table class="xl"><thead><tr><th></th><th>SKU</th><th>Item</th><th class="num">Ordered</th><th class="num">Already back</th><th class="num">Came back now</th></tr></thead><tbody>${
      srLineRoom(ord, id).map(l => { const was = (prev.items || []).find(i => String(i.lid) === String(l.lid)); return `<tr>
        <td><input type="checkbox" data-sr-tick="${esc(l.lid)}"${was ? ' checked' : ''}${l.room <= 0 && !was ? ' disabled' : ''}></td>
        <td style="font-family:ui-monospace,monospace;text-align:left">${esc(l.sku || '—')}</td><td style="text-align:left">${esc(l.name)}${l.variant ? ' <span class="muted">' + esc(l.variant) + '</span>' : ''}</td>
        <td class="num">${nf(l.qty)}</td><td class="num">${l.back ? nf(l.back) : '<span class="muted">—</span>'}</td>
        <td class="num"><input type="number" min="0" max="${l.room}" step="1" data-sr-qty="${esc(l.lid)}" value="${was ? was.qty : (l.room > 0 ? l.room : 0)}"${l.room <= 0 && !was ? ' disabled' : ''}></td></tr>`; }).join('')
    }</tbody></table></div>`;
  ptOpenDialog({
    title: id ? 'Edit return' : 'New return', wide: true,
    subtitle: o ? `${o.no} · ${esc((o.ship && o.ship.name) || '')} · ${o.at}` : 'Which order came back?',
    html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:12.5px">
      <label style="grid-column:1/-1">Order<input id="srOrd" list="srOrdList" placeholder="Type the order number" value="${esc(o ? o.no : '')}" autocomplete="off"${id ? ' readonly' : ''}>
        <datalist id="srOrdList">${orders.slice(0, 1500).map(x => `<option value="${esc(x.no)}">${esc([(x.ship && x.ship.name) || '', x.at, x.shopBrand || ''].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
      <div id="srLines" style="grid-column:1/-1">${linesHtml(o)}</div>
      <label>Return tracking number<input id="srTrk" value="${esc(prev.trk || '')}" placeholder="from the return label" style="font-family:ui-monospace,monospace"></label>
      <label>Carrier<select id="srCar">${SR_CARRIERS.map(c => `<option${(prev.carrier || 'USPS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Why<select id="srWhy">${SR_REASONS.map(c => `<option${(prev.reason || '') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Return started on<input id="srDate" type="date" value="${esc(prev.date || dToday())}"></label>
      <label>Stage<select id="srSt">${Object.entries(SR_STATUS).map(([k, v]) => `<option value="${k}"${(prev.status || 'started') === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label style="grid-column:1/-1">Remarks<input id="srNote" value="${esc(prev.note || '')}" placeholder="anything the warehouse should know"></label>
    </div>`,
    saveLabel: id ? 'Save' : 'Record the return',
    onSave: async () => {
      const no = ($('srOrd') || {}).value || '';
      const ord = o || orders.find(x => String(x.no).toLowerCase() === no.trim().toLowerCase());
      if (!ord) return 'Pick an order that is loaded on this screen (fetch the date range first).';
      const items = [...document.querySelectorAll('[data-sr-tick]')].filter(t => t.checked).map(t => { const lid = t.getAttribute('data-sr-tick'); const q = document.querySelector('[data-sr-qty="' + lid + '"]'); return { lid, qty: q ? q.value : 0 }; });
      const err = await srSave(String(ord.id), { items, trk: $('srTrk').value, carrier: $('srCar').value, reason: $('srWhy').value, date: $('srDate').value, status: $('srSt').value, note: $('srNote').value }, id);
      if (err) return err;
      setTimeout(srOpen, 0);
      return '';
    },
  });
  /* The lines follow the order typed. */
  if ($('srOrd') && !id) $('srOrd').onchange = () => {
    const ord = orders.find(x => String(x.no).toLowerCase() === $('srOrd').value.trim().toLowerCase());
    if ($('srLines')) $('srLines').innerHTML = linesHtml(ord);
  };
}
if ($('soReturns')) $('soReturns').onclick = () => srOpen();

