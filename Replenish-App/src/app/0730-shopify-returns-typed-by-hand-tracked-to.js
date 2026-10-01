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

/* ================= DELIVERY DAYS FROM THE USA WAREHOUSE =================
 *
 * Ravi, 2026-09-26: "sirf me usa zip code dalu or baha kitne din me delivery ho jayegi wo check kar saku."
 * The zip is placed on the map (a public zip lookup when it answers; the first three digits' state when it does not),
 * the distance to the warehouse zip gives the carrier ZONE, and the zone gives the days ground, priority and express
 * services usually take. AN ESTIMATE FROM DISTANCE ZONES, NOT A CARRIER QUOTE — the screen says so. */
const ZIP3_STATE = [[5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'],
  [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'],
  [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'],
  [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK']];
const STATE_LL = { AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.2, -111.9], AR: [34.9, -92.4], CA: [36.8, -119.4], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5],
  MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.5], PR: [18.2, -66.5] };
const zipState = zip => { const n = parseInt(String(zip).slice(0, 3), 10); const r = ZIP3_STATE.find(x => n >= x[0] && n <= x[1]); return r ? r[2] : ''; };
const ZIP_CACHE = {};
/** Where a zip is: { lat, lng, place, state, src: 'api' | 'state' } — or null for a zip no table knows. */
async function zipLL(zip) {
  const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
  if (z.length !== 5) return null;
  if (ZIP_CACHE[z]) return ZIP_CACHE[z];
  let out = null;
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) { /* nothing to abort */ } }, 5000);
    const r = await fetch('https://api.zippopotam.us/us/' + z, ctl ? { signal: ctl.signal } : {});
    clearTimeout(t);
    if (r && r.ok) {
      const d = await r.json(); const p = d && d.places && d.places[0];
      if (p) out = { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), place: p['place name'] || '', state: p['state abbreviation'] || '', src: 'api' };
    }
  } catch (e) { out = null; }
  if (!out) { const st = zipState(z); if (st && STATE_LL[st]) out = { lat: STATE_LL[st][0], lng: STATE_LL[st][1], place: '', state: st, src: 'state' }; }
  if (out) ZIP_CACHE[z] = out;
  return out;
}
const milesBetween = (a, b) => { const R = 3958.8, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
/** Carrier zone from distance (the USPS / UPS ground bands); 9 for Alaska, Hawaii and Puerto Rico. */
function zoneOf(miles, state) {
  if (['AK', 'HI', 'PR'].indexOf(state) >= 0) return 9;
  return miles <= 50 ? 1 : miles <= 150 ? 2 : miles <= 300 ? 3 : miles <= 600 ? 4 : miles <= 1000 ? 5 : miles <= 1400 ? 6 : miles <= 1800 ? 7 : 8;
}
/** Days each service usually takes for a zone: [ground, priority (2–3 day), express]. */
const ZONE_DAYS = { 1: ['1–2', '1–2', '1'], 2: ['1–2', '1–2', '1'], 3: ['2', '1–2', '1'], 4: ['2–3', '2', '1'], 5: ['3', '2–3', '1–2'], 6: ['3–4', '2–3', '1–2'], 7: ['4', '2–3', '1–2'], 8: ['4–5', '3', '1–2'], 9: ['5–8', '3–5', '2–3'] };
async function daysEstimate(fromZip, toZip) {
  const [a, b] = await Promise.all([zipLL(fromZip), zipLL(toZip)]);
  if (!a) return { err: 'The warehouse zip ' + fromZip + ' is not one I can place.' };
  if (!b) return { err: 'The zip ' + toZip + ' is not one I can place — five digits, USA.' };
  const miles = Math.round(milesBetween(a, b));
  const zone = zoneOf(miles, b.state);
  return { from: a, to: b, miles, zone, days: ZONE_DAYS[zone], rough: a.src === 'state' || b.src === 'state' };
}
/* ================= INDIA → USA BY EXPRESS (Ravi, 2026-09-27) =================
 *
 * "delivery days me kya hum india se check kar sakte h — mere pas DHL Express service h, FedEx Priority service h".
 * Both services clear US customs at a hub and fly on; what decides the days is where in the USA the parcel ends up.
 * Three bands, by the state the zip is in: the big metro states the services reach first; the rest of the lower 48;
 * Alaska, Hawaii and Puerto Rico. Business days from pickup, customs included when the paperwork is clean.
 * AN ESTIMATE FROM THE SERVICES' PUBLISHED BANDS — the exact date needs the carrier's own transit API and account. */
const IN_METRO = ['NY', 'NJ', 'CA', 'IL', 'TX', 'FL', 'GA', 'PA', 'MA', 'WA', 'OH', 'NC', 'VA', 'MD', 'DC', 'CT', 'MI', 'KY', 'TN', 'AZ', 'CO', 'NV', 'OR', 'MN', 'DE'];
const IN_BANDS = {
  metro:  { label: 'Major metro state', dhl: [3, 4], fedex: [3, 4] },
  lower48: { label: 'Rest of the lower 48', dhl: [4, 5], fedex: [4, 5] },
  remote: { label: 'Alaska · Hawaii · Puerto Rico', dhl: [5, 7], fedex: [5, 7] },
};
const inBandOf = st => (['AK', 'HI', 'PR'].indexOf(st) >= 0 ? 'remote' : IN_METRO.indexOf(st) >= 0 ? 'metro' : 'lower48');
/** A date some business days after another (Saturday and Sunday skipped). ISO in, ISO out. */
function addBizDays(iso, n) {
  const d = new Date(String(iso || '').slice(0, 10) + 'T12:00:00');
  if (isNaN(d)) return '';
  let left = n;
  while (left > 0) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) left--; }
  return d.toISOString().slice(0, 10);
}
/** India → a US zip by DHL Express and FedEx International Priority. */
async function indiaDaysEstimate(toZip, pickupIso) {
  const b = await zipLL(toZip);
  if (!b) return { err: 'The zip ' + toZip + ' is not one I can place — five digits, USA.' };
  const band = inBandOf(b.state);
  const B = IN_BANDS[band];
  const pick = String(pickupIso || '').slice(0, 10) || dToday();
  const svc = k => ({ days: B[k], from: addBizDays(pick, B[k][0]), to: addBizDays(pick, B[k][1]) });
  return { to: b, band, bandLabel: B.label, pickup: pick, dhl: svc('dhl'), fedex: svc('fedex'), rough: b.src === 'state' };
}
function daysOpen() {
  let wh = ''; try { wh = localStorage.getItem('shopWhZip') || ''; } catch (e) { wh = ''; }
  let from = 'us'; try { from = localStorage.getItem('shopDaysFrom') || 'us'; } catch (e) { from = 'us'; }
  ptOpenDialog({
    title: 'Delivery days',
    note: 'Estimates, not quotes: the USA warehouse by carrier distance zones; India by DHL Express and FedEx International Priority transit bands. Business days, from the day the parcel is handed over.',
    html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:12.5px">
      <div class="seg" role="tablist" style="grid-column:1/-1;width:max-content">
        <button type="button" class="segbtn${from === 'us' ? ' on' : ''}" data-sd-from="us">From the USA warehouse</button>
        <button type="button" class="segbtn${from === 'in' ? ' on' : ''}" data-sd-from="in">From India · DHL / FedEx</button></div>
      <label id="sdFromWrap"${from === 'in' ? ' class="hide"' : ''}>Warehouse zip (remembered)<input id="sdFrom" value="${esc(wh)}" placeholder="e.g. 07001" inputmode="numeric" maxlength="5"></label>
      <label id="sdPickWrap"${from === 'us' ? ' class="hide"' : ''}>Pickup in India<input id="sdPick" type="date" value="${esc(dToday())}"></label>
      <label>Deliver to zip<input id="sdTo" placeholder="e.g. 90210" inputmode="numeric" maxlength="5" autofocus></label>
      <div style="grid-column:1/-1"><button type="button" id="sdGo">Check</button></div>
      <div id="sdRes" class="sr-res" style="grid-column:1/-1;display:none"></div></div>`,
    saveLabel: 'Close', onSave: async () => '',
  });
  const where = x => [x.place, x.state].filter(Boolean).join(', ') || x.state || '?';
  const dshow = iso => { const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
  const run = async () => {
    const t = ($('sdTo').value || '').trim();
    const box = $('sdRes'); box.style.display = 'block'; box.textContent = 'Looking up…';
    if (from === 'in') {
      const r = await indiaDaysEstimate(t, $('sdPick').value);
      if (r.err) { box.innerHTML = '<span class="err">' + esc(r.err) + '</span>'; return; }
      const row = (name, x) => `<tr><th style="text-align:left">${name}</th><td><b>${x.days[0]}–${x.days[1]}</b> business days</td><td>${esc(dshow(x.from))} – <b>${esc(dshow(x.to))}</b></td></tr>`;
      box.innerHTML = `<div><b class="big">${r.dhl.days[0]}–${r.dhl.days[1]} days</b> India → <b>${esc(where(r.to))}</b> · ${esc(r.bandLabel)}</div>
        <table class="xl" style="margin-top:8px;width:auto"><tr><th></th><th>Transit</th><th>Lands, picked up ${esc(dshow(r.pickup))}</th></tr>
          ${row('DHL Express Worldwide', r.dhl)}${row('FedEx International Priority', r.fedex)}</table>
        <div class="muted" style="margin-top:6px">Customs included when the invoice and HS codes are clean; a hold adds 1–3 days. Pickup after the evening cutoff counts from the next business day.</div>
        ${r.rough ? '<div class="muted" style="margin-top:4px">The zip lookup did not answer, so the state stood in for the exact place.</div>' : ''}`;
      return;
    }
    const f = ($('sdFrom').value || '').trim();
    if (f.length === 5) { try { localStorage.setItem('shopWhZip', f); } catch (e) { /* not remembered */ } }
    const r = await daysEstimate(f, t);
    if (r.err) { box.innerHTML = '<span class="err">' + esc(r.err) + '</span>'; return; }
    box.innerHTML = `<div><b class="big">${esc(r.days[0])} days</b> by ground · zone ${r.zone} · ${nf(r.miles)} miles</div>
      <div style="margin-top:6px">${esc(where(r.from))} → <b>${esc(where(r.to))}</b></div>
      <table class="xl" style="margin-top:8px;width:auto"><tr><th>Ground (USPS Ground Advantage / UPS Ground)</th><td><b>${esc(r.days[0])}</b> business days</td></tr>
        <tr><th>Priority Mail / 2–3 day</th><td><b>${esc(r.days[1])}</b></td></tr><tr><th>Express / overnight</th><td><b>${esc(r.days[2])}</b></td></tr></table>
      ${r.rough ? '<div class="muted" style="margin-top:6px">The zip lookup did not answer, so the state\'s centre stood in for the exact place — the zone may be one off.</div>' : ''}`;
  };
  document.querySelectorAll('[data-sd-from]').forEach(btn => { btn.onclick = () => {
    from = btn.getAttribute('data-sd-from');
    try { localStorage.setItem('shopDaysFrom', from); } catch (e) { /* not remembered */ }
    document.querySelectorAll('[data-sd-from]').forEach(x => x.classList.toggle('on', x === btn));
    if ($('sdFromWrap')) $('sdFromWrap').classList.toggle('hide', from === 'in');
    if ($('sdPickWrap')) $('sdPickWrap').classList.toggle('hide', from !== 'in');
    if ($('sdRes')) $('sdRes').style.display = 'none';
  }; });
  if ($('sdGo')) $('sdGo').onclick = run;
  if ($('sdTo')) $('sdTo').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
}
if ($('soDays')) $('soDays').onclick = () => daysOpen();
$('adjDelete').onclick = () => saveAdj(true);
$('adjCancel').onclick = () => { $('adjModal').classList.add('hide'); ADJ_EDIT = null; };

/**
 * The line's own status, in whoever-typed-it's words.
 *
 * Kept on the ORDER's line (`meta.lines[sku].st`), not on the SKU. Two orders for the same product
 * are at different stages — one cut, one already packed — and storing this per SKU would have the
 * second one overwrite the first with no sign that it happened.
 *
 * Who and when ride along, because "in stitching" is only useful next to the day it was said.
 */
async function soSaveLineStatus(sku, raw) {
  if (!SHOP_EDIT || !sku) return;
  soApplyLineStatus(SHOP_EDIT, sku, raw);
  try { await saveShopMeta(); }
  catch (e) {
    $('soErr').textContent = 'Could not save the line status: ' + (e.message || e);
    $('soErr').classList.remove('hide');
  }
}
/** Record where an order line has got to — in memory, not saved. */
function soApplyLineStatus(orderId, sku, raw) {
  const meta = SHOP_META[orderId] || (SHOP_META[orderId] = {});
  const lines = meta.lines || (meta.lines = {});
  const ln = lines[sku] || (lines[sku] = {});
  const txt = String(raw == null ? '' : raw).trim().slice(0, 40);
  if (txt) { ln.st = txt; ln.stAt = soStamp(); ln.stBy = ME.email; }
  else {
    delete ln.st; delete ln.stAt; delete ln.stBy;
    // Nothing left on this line at all — do not leave an empty record behind for every SKU somebody
    // typed into and cleared again.
    if (ln.q == null && !ln.adj && !(ln.log || []).length) delete lines[sku];
  }
}

/**
 * The order's own Status and Note, saved AS THEY ARE TYPED.
 *
 * They used to be committed only by the Save button, and that quietly lost work: editing the send
 * quantity, the Amazon SKU or the pack size redraws the whole panel through openShopOrder(), which
 * resets these two boxes to whatever was last SAVED. Type a status, touch a quantity, and the status
 * was gone — with nothing on screen to say it had happened (Ravi, 2026-09-03: "kai baar status
 * update kiya but again again remove ho jata h").
 *
 * The bin, the quantity and the line status in this same panel have always saved on the spot. These
 * two now do the same, so a redraw restores what was typed instead of erasing it.
 *
 * The value is put on SHOP_META synchronously, BEFORE the write is awaited — a redraw that happens
 * while Firestore is still answering must already see the new text.
 */
async function soSaveOrderField(key, raw) {
  if (!SHOP_EDIT) return;
  const meta = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
  const txt = String(raw == null ? '' : raw).trim();
  if (txt) meta[key] = txt; else delete meta[key];
  meta.by = ME.email;
  meta.at = soStamp();
  try { await saveShopMeta(); renderShop(); }
  catch (e) {
    $('soErr').textContent = 'Could not save: ' + (e.message || e);
    $('soErr').classList.remove('hide');
  }
}
$('soStatus').addEventListener('change', () => soSaveOrderField('s', $('soStatus').value));
$('soNote').addEventListener('change', () => soSaveOrderField('note', $('soNote').value));

/**
 * Record how many of an order line are at its location — in memory, not saved.
 *
 * The one rule both the order panel and the bulk update follow, so a file cannot record a count the
 * panel would have refused, nor skip the shortfall adjustment the panel would have raised.
 */
function soApplyLineQty(orderId, sku, raw, ordered) {
  const meta = SHOP_META[orderId] || (SHOP_META[orderId] = {});
  const lines = meta.lines || (meta.lines = {});
  const ln = lines[sku] || (lines[sku] = {});
  const o = SHOP.orders.find(x => x.id === orderId);
  const stamp = soStamp();

  if (String(raw).trim() === '') {
    delete lines[sku];
  } else {
    // Clamped, not rejected. A slip of the keyboard should land on the nearest true number rather
    // than throw away what the person was doing.
    const q = Math.max(0, Math.min(Number(ordered) || 0, Math.round(Number(raw) || 0)));
    ln.q = q;
    (ln.log || (ln.log = [])).push({ q, at: stamp, by: ME.email });
    if (ln.log.length > 40) ln.log = ln.log.slice(-40);
    const short = Math.max(0, Number(ordered) - q);
    // An adjustment opened by hand is left alone. It may be a wrong SIZE on a line whose count is
    // complete, and clearing that because the numbers balance would cancel a job already on the
    // production floor.
    if (!ln.adjManual) {
      if (short) {
        ln.adj = soAdjId(o ? o.no : SHOP_EDIT, sku);
        ln.adjQty = short;
        ln.adjReason = ln.adjReason || 'Short';
        const it = o && o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku);
        soAdjSnapshot(ln, o, it);
        // The date the shortfall was FIRST recorded, kept even if the number is corrected later —
        // that is the day the sheet went to production, and back-dating it would hide a delay.
        if (!ln.adjAt) ln.adjAt = stamp;
      } else {
        Object.keys(ln).filter(k => k.indexOf('adj') === 0).forEach(k => delete ln[k]);
      }
    }
  }
}

async function soSaveLineQty(sku, raw, ordered, esc) {
  if (!SHOP_EDIT || !sku) return;
  soApplyLineQty(SHOP_EDIT, sku, raw, ordered);
  const meta = SHOP_META[SHOP_EDIT] || {};
  const lines = meta.lines || {};
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  try {
    await saveShopMeta();
    const cell = $('soItems').querySelector('.soAdjCell[data-sku="' + sku + '"]');
    const item = (o && o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku)) || { qty: ordered };
    if (cell) cell.innerHTML = soAdjHtml(lines[sku] || {}, item, esc);
    soBindAdjButtons();
    const inp = $('soItems').querySelector('.soQty[data-sku="' + sku + '"]');
    if (inp) { inp.value = lines[sku] ? lines[sku].q : ''; inp.title = soLogText(lines[sku] || {}); }
    renderShop();
  } catch (err) {
    $('soErr').textContent = 'Could not save: ' + (err.message || err);
    $('soErr').classList.remove('hide');
  }
}

function openShopOrder(id) {
  const o = SHOP.orders.find(x => x.id === id);
  if (!o) return;
  soIndexNames();          // the pack rule reads product names, and this panel can be drawn on its own
  SHOP_EDIT = id;
  const meta = SHOP_META[id] || {};
  const grams = o.items.reduce((s, i) => s + (i.grams || 0), 0);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  $('soTitle').textContent = 'Order ' + o.no;
  $('soSub').textContent = [o.ship.name, [o.ship.a1, o.ship.city, o.ship.state, o.ship.zip, o.ship.country].filter(Boolean).join(', '),
    o.at, o.ship.phone].filter(Boolean).join(' · ');
  const pcs = o.items.reduce((t, i) => t + (+i.qty || 0), 0);
  $('soFootSum').textContent = o.items.length + ' line' + (o.items.length === 1 ? '' : 's') + ' · ' + nf(pcs) + ' pc' + (pcs === 1 ? '' : 's');

  const m = soMcf(o);
  // The customer's own note, first and unmissable. "Please ship with the quilt ordered the same
  // day" changes what goes in the box, and it is no use buried under a list of SKUs.
  $('soShopNote').innerHTML = o.note
    ? '<div style="background:#fef9c3;color:#854d0e;border-radius:8px;padding:8px 10px;font-size:12.5px">'
      + '<b>Note from Shopify</b><div style="margin-top:2px">' + esc(o.note) + '</div></div>'
    : '';
  $('soShopNote').classList.toggle('hide', !o.note);

  // What Shopify says has already shipped, and on what. Shown ABOVE the shipment fields, because
  // the first thing worth knowing when opening an order is whether it has gone out already.
  const trkList = o.trk || [];
  $('soFf').innerHTML = soFfTag(o.ff)
    + (o.shippedAt ? '<span class="muted">shipped ' + esc(o.shippedAt) + '</span>' : '')
    + (trkList.length
        ? '<span class="so-chip" title="Tracking on Shopify">'
          + (o.trkUrl ? '<a href="' + esc(o.trkUrl) + '" target="_blank" rel="noopener">' + esc(trkList.join(', ')) + '</a>'
                      : esc(trkList.join(', ')))
          + (o.trkCo ? '&nbsp;· ' + esc(o.trkCo) : '')
          + '</span>'
        : '<span class="so-chip">No tracking yet</span>');

  $('soItems').innerHTML = '<table class="xl so-lines" style="font-size:12px">'
    + '<thead><tr><th style="text-align:left" title="The Shopify code, and under it the code Amazon knows this by when it is not the same. Leave the Amazon box blank when they match. The FBA figure and the MCF order both use whatever is there.">Product</th>'
    + '<th class="num">Ordered</th>'
    + '<th class="num" title="Units to actually send to Amazon for THIS order. Blank means send what was ordered. 0 leaves the line out of the MCF order entirely. Stored against this order only, never against the SKU.">Send qty</th>'
    + '<th class="num" title="Stock of this line in this order\'s own Amazon account.">' + soAcctName(soOrdBrand(o)) + ' FBA</th><th title="What happens to THIS line: already sent, cancelled (refunded on Shopify), out of FBA, out of India stock, or made. Same wording as the route on the order itself, so the two cannot disagree.">Route</th>'
    + '<th title="The bin, and how many of the ordered units are actually on that shelf. Every change is logged with the date and time.">Shelf · qty</th>'
    + '<th title="Where THIS line has got to, in your own words — cut, stitched, packed, whatever you use. Typed by you and saved against this order’s line, so it never changes another order carrying the same SKU. Different from the Status column on the left, which the app works out from stock and cannot be edited.">Line status</th>'
    + '<th title="Raised automatically for whatever is short. The id is built from the Shopify order number, so it can never collide and always points back.">Adjustment</th></tr></thead><tbody>'
    + o.items.map(i => {
      const sku = String(i.sku || '').trim().toUpperCase();
      const amz = soAmzSku(sku);
      const amzKey = String(amz || '').toUpperCase();
      const ln = soLine(SHOP_EDIT, sku);
      const st = soLineState(o, i);
      const fit = soPackFit(sku);
      // What goes in the Send box when nobody has typed anything: the units still owed, in AMAZON
      // packs. Same figure the placeholder shows and the same one data-ord compares against, so a
      // person typing the number already shown is correctly read as "no override".
      const dflt = soLive(i) * soPackFactorOf(sku);
      const need = soSendQty(SHOP_EDIT, sku, soLive(i));
      // Filled in for the reader ONLY where the app worked something out that the ordered figures do
      // not show on their own — the Amazon code behind a pack split, and the pack count it becomes.
      // Every other line keeps its blank box: a box filled on every row tells nobody anything.
      const autoAmz = (fit && fit.ok) ? fit.base : '';
      const autoQty = (fit && fit.ok) ? dflt : '';
      const typedQ = ((SHOP_META[SHOP_EDIT] || {}).q || {})[sku];
      return '<tr>'
        /* ONE CELL FOR THE PRODUCT: picture, the whole name, the Shopify code and the Amazon code
         * together — five narrow columns side by side are what pushed the row off the screen. */
        + '<td class="so-prod"><div class="so-pi">' + (i.img
            ? '<img src="' + esc(i.img) + '" loading="lazy" decoding="async" alt="" class="so-img">'
            : '<span class="so-img"></span>')
        + '<div class="so-pt"><div class="so-pn" title="' + esc(i.name + (i.variant ? ' · ' + i.variant : '')) + '">'
          + esc(i.name) + (i.variant ? ' <span class="muted">· ' + esc(i.variant) + '</span>' : '') + '</div>'
        + '<div class="so-ps"><span class="so-code">' + (i.sku ? esc(i.sku) : '<span class="muted">no SKU on Shopify</span>') + '</span>'
        // Editable, and PLACEHOLDERED with the Shopify code — so a blank box still shows what will
        // be sent, and a filled one is visibly a decision. Same pattern as Remark and Req. Qty.
        + '<span class="so-amzw">'
          + (sku
              ? '<input class="soAmz" data-sku="' + esc(sku) + '" maxlength="40"'
                + ' placeholder="' + esc(amz) + '" value="' + esc(soSku(sku).amz || autoAmz) + '"'
                + ' style="width:118px;text-align:center;font-family:ui-monospace,monospace;font-size:11.5px'
                + (autoAmz && !soSku(sku).amz ? ';color:#166534' : '') + '">'
                // WORKED OUT, NOT TYPED, and it says so. A grey placeholder was already what the app
                // would use, but a placeholder reads as "nothing here" — and on the one field that
                // decides which Amazon product ships, "nothing here" is not a thing to leave to
                // interpretation. Shown as a real value, in the accent colour, with the word auto
                // under it: still not stored, so changing the rule cannot leave a stale mapping
                // behind, and typing over it stores a decision exactly as before.
                + (autoAmz && !soSku(sku).amz
                    ? '<div style="font-size:10px;margin-top:1px;color:#166534">auto · from ' + esc(sku) + '</div>'
                    : '')
                // Only where a split is actually in play. Shown on every line it would be clutter;
                // shown here it is the one figure standing between this line and a working mapping.
                + (fit ? '<div style="margin-top:3px;font-size:10.5px" class="muted">'
                    + 'units per pack '
                    + '<input class="soPack" data-sku="' + esc(fit.base) + '" type="number" min="1" step="1"'
                    + ' placeholder="' + (fit.pack || '?') + '"'
                    + ' value="' + esc((SHOP_SKU[fit.base] || {}).pack || '') + '"'
                    + ' title="' + esc(fit.why) + '"'
                    + ' style="width:46px;text-align:center;padding:1px 3px;font-size:10.5px">'
                    + '</div>' : '')
              : '')
        + '</span></div></div></div></td>'
        // Refunded units are named right beside the ordered ones. A line that came back looks
        // exactly like a live one otherwise, and it is the one nobody should be picking.
        + '<td class="num">× ' + i.qty
          + (i.rq ? '<div class="muted" style="font-size:10.5px;color:#991b1b">' + i.rq + ' refunded</div>' : '')
          + '</td>'
        // Placeholdered with the ordered quantity, so a blank box still shows what will go and a
        // filled one is visibly a decision — the same pattern as the Amazon SKU beside it.
        + '<td style="padding:3px 6px;width:90px">'
          + (sku
              ? '<input class="soSend" data-sku="' + esc(sku) + '" data-ord="' + dflt + '" type="number"'
                + ' min="0" step="1" placeholder="' + dflt + '"'
                + ' value="' + (typedQ ?? autoQty) + '"'
                + ' style="width:76px;text-align:center;font-weight:700'
                + (autoQty !== '' && typedQ == null ? ';color:#166534' : '') + '">'
                + (autoQty !== '' && typedQ == null
                    ? '<div style="font-size:10px;margin-top:1px;color:#166534">auto · ' + fit.n
                      + ' ÷ ' + fit.pack + '</div>'
                    : '')
              : '<span class="muted">—</span>')
        + '</td>'
        + '<td class="num">' + soFbaChips(amzKey, need, soOrdBrand(o)) + '</td>'
        + '<td class="so-route" title="' + esc(st.why) + '">' + (SO_LINE_TAG[st.v] || esc(st.label))
          /* ONLY WHERE IT HELPS: a line that cannot be filled as it stands. The same design in
           * another size is offered with the figures behind it, and an adjustment is the person's
           * to raise — the customer bought this size, not that one. */
          /* SHORT, AND IT WRAPS (Ravi, 2026-09-24): one long unbroken line of every other size is what
           * pushed the panel sideways. Two sizes are named, the rest counted; all of them in the tooltip. */
          + (st.v === 'make' ? (alts => {
              if (!alts.length) return '';
              const one = a => esc(a.size || a.sku) + (a.shape ? ' ' + esc(a.shape) : '') + ' ('
                + [a.india ? nf(a.india) + ' India' : '', a.fba ? nf(a.fba) + ' FBA' : ''].filter(Boolean).join(', ') + ')';
              return '<div class="so-alt" title="' + esc('Same design, other sizes in stock: ' + alts.map(a => (a.size || a.sku) + ' — '
                  + [a.india ? a.india + ' India' : '', a.fba ? a.fba + ' FBA' : ''].filter(Boolean).join(', ')).join('; ')
                  + '. Raise an adjustment if the customer will take another size.') + '">'
                + 'In stock: ' + alts.slice(0, 2).map(one).join(', ')
                + (alts.length > 2 ? ' <b>+' + (alts.length - 2) + ' more</b>' : '') + '</div>';
            })(soSizeAlternatives(sku, soOrdBrand(o))) : '')
          + '</td>'
        // An INPUT with a datalist, not a plain dropdown: the twelve bins are one keystroke away,
        // and a new one can still be typed. A closed list would mean a shelf that exists but cannot
        // be recorded, which ends with somebody writing it in the note field instead.
        + '<td style="padding:3px 6px;white-space:nowrap">'
          + (sku
              ? '<input class="soLoc" data-sku="' + esc(sku) + '" list="soLocList" maxlength="12"'
                + ' placeholder="bin" value="' + esc(soLocOf(sku)) + '"'
                + ' style="width:62px;text-align:center;font-weight:600">'
              : '<span class="muted">—</span>')
        /* THE BIN AND WHAT IS ON IT, in one cell: two narrow columns were one more reason to scroll.
         * How many are on that shelf is capped at the ordered quantity — more is a typing slip, and it
         * would become a production order for minus one piece. */
          + (sku
              ? ' <input class="soQty" data-sku="' + esc(sku) + '" data-qty="' + i.qty + '" type="number"'
                + ' min="0" max="' + i.qty + '" step="1" placeholder="—"'
                + ' value="' + (ln.q == null ? '' : ln.q) + '"'
                + ' title="' + esc(soLogText(ln)) + '"'
                + ' style="width:52px;text-align:center;font-weight:600">'
              : '')
        + '</td>'
        /* An INPUT with a datalist, exactly like the bin above it: the usual few are one keystroke
         * away and anything else can still be typed. A closed dropdown would mean a real state of a
         * real line that cannot be recorded, and that always ends up written in the note instead —
         * where nothing can count it. Saved against THIS order's line, never against the SKU: two
         * orders for the same product are at different stages, which is the whole point. */
        + '<td style="padding:3px 6px;width:132px">'
          + (sku
              ? '<input class="soLnSt" data-sku="' + esc(sku) + '" list="soLnStList" maxlength="40"'
                + ' placeholder="—" value="' + esc(ln.st || '') + '"'
                + ' title="' + esc(ln.st ? `${ln.st}${ln.stBy ? ' — ' + ln.stBy : ''}${ln.stAt ? ' · ' + ln.stAt : ''}` : 'Nothing recorded yet.') + '"'
                + ' style="width:120px;font-weight:600">'
              : '<span class="muted">—</span>')
        + '</td>'
        + '<td class="soAdjCell" data-sku="' + esc(sku) + '" style="padding:3px 6px;width:150px">'
          + soAdjHtml(ln, i, esc) + '</td></tr>';
    }).join('') + '</tbody></table>';

  // Saved against the SKU the moment it is typed, so the next order carrying it is already filled
  // in. Deliberately not waiting for Save — this is a fact about the shelf, not about this order.
  $('soItems').querySelectorAll('.soSend').forEach(el => {
    el.onchange = async () => {
      const ord = Number(el.dataset.ord) || 0;
      const raw = el.value.trim();
      if (raw !== '' && !/^\d+$/.test(raw)) {
        $('soErr').textContent = `"${el.value}" is not a quantity — whole units only, or blank to send what was ordered.`;
        $('soErr').classList.remove('hide');
        el.value = ((SHOP_META[SHOP_EDIT] || {}).q || {})[el.dataset.sku] ?? '';
        return;
      }
      try {
        await soSetQty(SHOP_EDIT, el.dataset.sku, raw, ord);
        // Redrawn, because the FBA badge and the MCF readiness tag are both judged on this number.
        openShopOrder(SHOP_EDIT);
        renderShop();
      } catch (err) {
        $('soErr').textContent = 'Could not save the quantity: ' + (err.message || err);
        $('soErr').classList.remove('hide');
      }
    };
  });
  $('soItems').querySelectorAll('.soAmz').forEach(el => {
    el.onchange = async () => {
      const k = el.dataset.sku;
      const v = el.value.trim().toUpperCase();
      el.value = v;
      try {
        // Stored against the SHOPIFY sku and blank when the two match, so the map holds only the
        // real exceptions rather than a copy of every SKU in the catalogue.
        await soSetSku(k, 'amz', v === k ? '' : v);
        // The whole panel is redrawn, not just this cell: the FBA badge, the MCF readiness tag and
        // the order list all read this mapping, and leaving them showing "not in FBA" next to a SKU
        // that has just been mapped is how somebody concludes the mapping did not work.
        openShopOrder(SHOP_EDIT);
        renderShop();
      } catch (err) {
        $('soErr').textContent = 'Could not save the Amazon SKU: ' + (err.message || err);
        $('soErr').classList.remove('hide');
      }
    };
  });
  $('soItems').querySelectorAll('.soPack').forEach(el => {
    el.onchange = async () => {
      const k = el.dataset.sku;                      // the AMAZON code, not the Shopify one
      const raw = el.value.trim();
      if (raw !== '' && !/^\d+$/.test(raw)) {
        $('soErr').textContent = '"' + el.value + '" is not a pack size — whole units only, or blank to use the warehouse workbook.';
        $('soErr').classList.remove('hide');
        // Through soSku, which upper-cases: `k` is now spelled the way AMAZON spells it, and
        // SHOP_SKU is keyed in upper case. Indexing it directly would silently blank the box.
        el.value = soSku(k).pack || '';
        return;
      }
      try {
        // Stored against the AMAZON code, not the Shopify one. A pack size is a fact about the
        // product Amazon ships, so every Shopify code that resolves to it gets the same answer
        // without anybody being asked twice.
        await soSetSku(k, 'pack', raw === '' ? '' : Math.max(1, Math.round(Number(raw))));
        // Redrawn whole: this one figure decides the Amazon code, the send quantity, the FBA badge
        // and the line's status all at once.
        openShopOrder(SHOP_EDIT);
        renderShop();
      } catch (err) {
        $('soErr').textContent = 'Could not save the pack size: ' + (err.message || err);
        $('soErr').classList.remove('hide');
      }
    };
  });
  $('soItems').querySelectorAll('.soLoc').forEach(el => {
    el.onchange = async () => {
      const k = el.dataset.sku, v = el.value.trim().toUpperCase();
      el.value = v;
      try { await soSetSku(k, 'loc', v); renderShop(); }
      catch (err) { $('soErr').textContent = 'Could not save the location: ' + (err.message || err); $('soErr').classList.remove('hide'); }
    };
  });
  $('soItems').querySelectorAll('.soQty').forEach(el => {
    el.onchange = () => soSaveLineQty(el.dataset.sku, el.value, Number(el.dataset.qty), esc);
  });
  $('soItems').querySelectorAll('.soLnSt').forEach(el => {
    el.onchange = () => soSaveLineStatus(el.dataset.sku, el.value);
  });
  soBindAdjButtons();

  $('soStatus').value = meta.s || '';
  $('soNote').value = meta.note || '';
  // Pre-filled from Shopify, then left alone once somebody has typed their own — the parcel on the
  // bench is the authority on weight, not the product record.
  $('soDesc').value = meta.desc || o.items.map(i => `${i.name} x${i.qty}`).join(', ').slice(0, 90);
  $('soWt').value = meta.wt != null ? meta.wt : (grams ? (grams / 1000).toFixed(2) : '');
  $('soVal').value = meta.val != null ? meta.val : (o.total || '');
  // HEAL ANYTHING RAISED BEFORE THE SNAPSHOT EXISTED. Early adjustments carry only the id and the
  // quantity, so they reach the Adjustments tab with no product, no order and no picture — present,
  // but useless to anybody trying to make the thing. The order is open right here, so this is the
  // one moment the missing detail can be filled in without asking Shopify again.
  (async () => {
    let healed = false;
    Object.entries(meta.lines || {}).forEach(([sku, ln]) => {
      if (!ln || !ln.adj || ln.adjOrder) return;
      soAdjSnapshot(ln, o, o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku));
      healed = true;
    });
    if (healed) { try { await saveShopMeta(); } catch (e) { /* shown on the next save */ } }
  })();

  $('soCarrier').value = meta.carrier || '';
  $('soPieces').value = meta.pieces != null ? meta.pieces : 1;
  $('soBoxL').value = meta.boxL != null ? meta.boxL : '';
  $('soBoxW').value = meta.boxW != null ? meta.boxW : '';
  $('soBoxH').value = meta.boxH != null ? meta.boxH : '';
  // INR by default because that is what the invoices are raised in here. Kept per order rather than
  // as a global, so one shipment billed in dollars does not force every other one to change.
  $('soCur').value = meta.cur || 'INR';
  $('soGstInv').value = meta.gstInv || '';
  $('soGstInvDate').value = meta.gstInvDate || '';
  $('soNgstInv').value = meta.ngstInv || '';
  $('soNgstInvDate').value = meta.ngstInvDate || '';
  soRenderCustoms();
  // Statuses already in use become suggestions, so "Packed" does not become three different words.
  const seen = [...new Set(Object.values(SHOP_META).map(x => x && x.s).filter(Boolean))].sort();
  $('soStatusList').innerHTML = seen.map(s => `<option value="${esc(s)}">`).join('');
  // The twelve standard bins, plus any that have actually been used — a shelf added on the floor
  // shows up here on its own rather than waiting for somebody to edit the code.
  const bins = [...new Set(SO_LOC_OPTIONS.concat(
    Object.values(SHOP_SKU).map(x => x && x.loc).filter(Boolean)))].sort();
  $('soLocList').innerHTML = bins.map(s => `<option value="${esc(s)}">`).join('');
  // Which account's FBA to ship from. Guessed from the SKU where the health snapshot knows it, so
  // the common case needs no thought — but left changeable, because a guess is not a fact.
  /* A CPC order goes to the CPC account unless somebody says otherwise — the shop is the better
   * guess than the SKU, because it cannot be fooled by a code both accounts happen to carry. */
  /* THE ORDER'S OWN ACCOUNT (Ravi, 2026-09-24) — a Ridhi order ships from Ridhi, a CPC order from CPC.
   * An order already sent keeps the account it went on, so its status is asked of the right one. */
  $('soMcfBrand').value = (meta.mcfId && meta.mcfBrand) || soOrdBrand(o);
  $('soMcfBrand').onchange = () => { $('soMcfPrev').classList.add('hide'); $('soErr').classList.add('hide'); soRenderMcfBox(); };
  $('soMcfPrev').classList.add('hide');
  $('soMcfPrev').innerHTML = '';
  soRenderMcfBox();

  $('soErr').classList.add('hide');
  $('soModal').classList.remove('hide');
  $('soStatus').focus();
}

/** Which brand's FBA holds these SKUs, from this app's own replenishment snapshot (Sellora asked
 * the listing-health one; both are the same catalogue keyed the same way). '' when it cannot tell,
 * and it only preselects the dropdown — the person sending can always change it. */
function soGuessBrand(o) {
  const skus = o.items.map(i => String(i.sku || '').trim().toUpperCase()).filter(Boolean);
  for (const b of ['SP', 'CPC']) {
    const rows = (REPL[b] && REPL[b].rows) || [];
    if (rows.some(r => skus.includes(String(r.sku || '').trim().toUpperCase()))) return b;
  }
  return '';
}

async function saveShopOrder() {
  if (!SHOP_EDIT) return;
  const was = SHOP_META[SHOP_EDIT] || {};
  const e = {
    s: $('soStatus').value.trim(),
    note: $('soNote').value.trim(),
    desc: $('soDesc').value.trim(),
    wt: $('soWt').value === '' ? null : Number($('soWt').value),
    val: $('soVal').value === '' ? null : Number($('soVal').value),
    carrier: $('soCarrier').value,
    pieces: Number($('soPieces').value) || 1,
    boxL: $('soBoxL').value === '' ? null : Number($('soBoxL').value),
    boxW: $('soBoxW').value === '' ? null : Number($('soBoxW').value),
    boxH: $('soBoxH').value === '' ? null : Number($('soBoxH').value),
    cur: $('soCur').value,
    gstInv: $('soGstInv').value.trim(),
    gstInvDate: $('soGstInvDate').value,
    ngstInv: $('soNgstInv').value.trim(),
    ngstInvDate: $('soNgstInvDate').value,
    by: ME.email,
    at: soStamp(),
  };
  // THE MCF RECORD IS NOT A FORM FIELD AND MUST SURVIVE THIS. It records a parcel Amazon is already
  // shipping; rebuilding the entry from the inputs would drop it, and the next person would send the
  // same order a second time. Amazon would reject the duplicate — but nobody should be relying on
  // that to avoid shipping twice.
  // `lines` belongs here too: it holds the staged quantities, their timestamped log and the
  // adjustment ids already sent to production. All of it is saved as it is typed, so rebuilding the
  // entry from the form would throw away work nobody knew was at risk.
  ['mcfId', 'mcfAt', 'mcfSpeed', 'mcfStatus', 'mcfTrk', 'mcfBrand', 'mcfSkus', 'shopFulfilled', 'lines', 'returns'].forEach(k => {
    if (was[k] != null) e[k] = was[k];
  });
  // An order with nothing recorded against it is removed rather than stored empty, so the document
  // holds only orders somebody has actually touched.
  if (!e.s && !e.note && !e.desc && e.wt == null && e.val == null && !e.carrier && !e.mcfId
      && !Object.keys(e.lines || {}).length) delete SHOP_META[SHOP_EDIT];
  else SHOP_META[SHOP_EDIT] = e;
  try {
    await saveShopMeta();
    $('soModal').classList.add('hide');
    SHOP_EDIT = null;
    renderShop();
  } catch (err) {
    $('soErr').textContent = 'Could not save: ' + (err.message || err);
    $('soErr').classList.remove('hide');
  }
}

/* ---------- MCF: shipping a Shopify order out of FBA ----------
 *
 * Two steps that cannot be collapsed into one. PREVIEW asks Amazon what it would do and places
 * nothing; SEND places a real parcel and costs real money. The send button does not exist until a
 * preview has been read, so nobody can ship by clicking twice in the same place.
 *
 * The fulfilment order id is derived from the Shopify order number on the backend, so a second
 * send is rejected by Amazon rather than by this screen — the guarantee holds even if the button
 * is somehow pressed twice.
 */
async function apiPost(body) {
  if (!PRAPI || !PRAPI.url) throw new Error('No access to the Price Research backend, which is where MCF '
    + 'lives. Its address is in Firestore config/api, and this account has to be allowed to read it.');
  // text/plain deliberately: application/json would trigger a CORS preflight that an Apps Script
  // web app cannot answer. The content is still JSON.
  const r = await fetch(PRAPI.url, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: PRAPI.key }),
  });
  // Same trap as prGet: a visitor the deployment will not run for gets a Google HTML page.
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) {
    throw new Error(/^\s*</.test(text)
      ? 'The backend answered with a Google web page instead of data — this account is not allowed '
        + 'to run it. Apps Script → Deploy → Manage deployments → "Who has access" = Anyone.'
      : 'The backend sent something that is not data: ' + text.slice(0, 120));
  }
  if (!d.ok) throw new Error(d.error || 'Request failed');
  return d;
}

function soMcfPayload(o) {
  return {
    // The Shopify order id travels too, so the backend can move that order to "in progress" once
    // Amazon has accepted it. An IMPORTED order's id looks like "IMP-…" and the backend skips it —
    // it is not an order this Shopify store has ever heard of.
    no: o.no, id: o.id, at: o.at, ship: o.ship, brand: $('soMcfBrand').value,
    /* Which STORE the order lives in — not the same question as which Amazon account ships it. */
    shop: o.shopBrand === 'CPC' ? 'CPC' : '',
    // Amazon is asked for the AMAZON code. This is the one place where sending the Shopify text
    // instead means Amazon rejects the line, or worse, matches nothing and ships short.
    /* ONLY WHAT THIS ACCOUNT HOLDS (Ravi, 2026-09-24). A line Amazon cannot ship from here is left
     * out and named on the panel — sending it made Amazon refuse the whole order. */
    items: soMcfPlan(o, $('soMcfBrand').value).send.map(x => ({ sku: x.amz, qty: x.qty })),
  };
}

/** Which account this order ships from — said, not offered: a Ridhi order is Ridhi's, a CPC one CPC's. */
function soRenderMcfSeg(o) {
  $('soMcfSeg').innerHTML = '<span class="so-chip">From ' + soAcctName($('soMcfBrand').value) + ' FBA</span>';
}

/** What is already known about this order's MCF shipment, if anything. */
function soRenderMcfBox() {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const meta = SHOP_META[SHOP_EDIT] || {};
  const m = soMcf(o);
  if (meta.mcfId) {
    $('soMcfBox').innerHTML = '<span class="st st-approved">Sent to Amazon</span> '
      + '<span class="muted">' + esc(meta.mcfId) + (meta.mcfAt ? ' · ' + esc(meta.mcfAt) : '') + '</span>'
      + (meta.mcfTrk ? '<div style="margin-top:4px">Amazon tracking: <b>' + esc(meta.mcfTrk) + '</b></div>' : '')
      + '<div style="margin-top:6px"><button id="soMcfRefresh" class="ghost" style="padding:3px 10px;font-size:12px">Check status</button></div>';
    $('soMcfRefresh').onclick = soMcfStatus;
    soRenderMcfSeg(o);
    /* One parcel per order: the fulfilment id is built from the order number, so a second one would
     * be refused. The button says so rather than inviting it. */
    $('soMcfPreview').disabled = true; $('soMcfPreview').textContent = 'Already sent to Amazon';
    $('soMcfPreview').classList.add('hide');   // the box above already says it went
    return;
  }
  /* WHAT GOES, AND WHAT STAYS — before anything is clicked. The lines this account can ship are sent
   * as one parcel; the others are named, with the reason, and stay for India or production. */
  const brand = $('soMcfBrand').value;
  const p = soMcfPlan(o, brand);
  const all = p.send.length + p.out.length;
  soRenderMcfSeg(o);
  const btn = $('soMcfPreview');
  btn.disabled = !p.send.length;
  btn.classList.toggle('hide', !p.send.length);
  btn.textContent = p.send.length ? 'Check speeds & cost · ' + p.send.length + ' line' + (p.send.length === 1 ? '' : 's') : 'Nothing this account can ship';
  $('soMcfBox').innerHTML = '<div class="mcf-plan">'
    + '<div class="mcf-h ' + (p.send.length ? 'ok' : 'bad') + '">'
      + (p.send.length ? p.acct + ' FBA can ship ' + p.send.length + ' of ' + all + ' line' + (all === 1 ? '' : 's')
                       : p.acct + ' FBA holds none of these lines — nothing to send to Amazon')
    + '</div>'
    + (p.send.length ? '<div class="mcf-l ok"><b>✓</b><em>Sends</em><span>' + p.send.map(x => esc(x.label) + ' × ' + x.qty).join(', ') + '</span></div>' : '')
    + (p.send.length && p.out.length ? '<div class="mcf-l"><b>–</b><em>Stays out</em><span>' + p.out.map(x => '<span title="' + esc(x.why) + '">' + esc(x.label) + '</span>').join(', ') + '</span></div>' : '')
    + '</div>';
}

$('soMcfPreview').onclick = async () => {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const btn = $('soMcfPreview');
  btn.disabled = true; btn.textContent = 'Asking Amazon…';
  $('soErr').classList.add('hide');
  try {
    const d = await apiPost({ mcf: 'preview', order: soMcfPayload(o) });
    const rows = (d.previews || []).map(p => {
      const why = (p.unfulfillable || []).join(' · ');
      return '<tr>'
        + '<td style="padding:4px 8px"><b>' + esc(p.speed) + '</b></td>'
        + '<td class="num">' + (p.ok ? '$' + p.fee.toFixed(2) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + (p.arriveBy ? 'by ' + esc(p.arriveBy) : '<span class="muted">—</span>') + '</td>'
        + '<td>' + (p.ok
            ? '<button class="ghost" data-mcf-send="' + esc(p.speed) + '" style="padding:3px 10px;font-size:12px">Send</button>'
            : '<span class="fu fu-amber" title="' + esc(why) + '">can\'t ship</span>') + '</td>'
        + '</tr>';
    }).join('');
    $('soMcfPrev').innerHTML = rows
      ? '<table class="xl" style="font-size:12px;width:100%"><tbody>' + rows + '</tbody></table>'
        + '<div class="muted" style="font-size:11.5px;margin-top:6px">Fees are Amazon\'s estimate. '
        + 'Sending places a real shipment on <b>' + esc($('soMcfBrand').selectedOptions[0].textContent)
        + '</b> — it cannot be undone from here.</div>'
      : '<span class="fu fu-amber">Amazon offered no shipping option for this order.</span>';
    $('soMcfPrev').classList.remove('hide');
    $('soMcfPrev').querySelectorAll('[data-mcf-send]').forEach(b => {
      b.onclick = () => soMcfSend(b.dataset.mcfSend, b.closest('tr').querySelector('.num').textContent);
    });
  } catch (e) {
    const pl = soMcfPlan(o, $('soMcfBrand').value);
    $('soErr').innerHTML = mcfErr(e, 'Could not check speeds', { acct: pl.acct, skus: pl.send.map(x => x.amz) });
    $('soErr').classList.remove('hide');
  }
  soRenderMcfBox();
};

/* A 403 from the MCF endpoints is never a bad payload — it is the app not being allowed to place
 * fulfilment orders at all. The raw SP-API JSON says "Access to requested resource is denied" and
 * nothing about what to do, which sends people looking for a bug in the address or the weights.
 *
 * The trap is that 403 does NOT mean "permission missing" on its own — SP-API answers an unrecognised
 * PATH with the identical message. That is what it turned out to be here: the calls were on
 * /fbaOutbound/..., which is the API's name rather than its URL. The role was ticked and the token was
 * current the whole time, and changing either did nothing.
 *
 * So this leads with what it actually knows and offers the credential checks second, in the order
 * they are worth trying — role first, then the token, since a token minted before a role does not
 * carry it and is invisible from the roles screen. */
/**
 * What went wrong, in words — Amazon's own text kept underneath, not in front.
 *
 * Ravi, 2026-09-24: "Preview failed: SP-API 400 on /fba/outbound/... SellerSKU is invalid" — "aisa lag
 * rha h jese koi fake app h". Nobody on the floor can act on that. The message now says what it means
 * and names the SKU where it is a SKU; the raw answer is one click away for whoever needs it.
 */
function mcfErr(e, what, ctx) {
  const raw = String(e && (e.message || e) || '');
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const c = ctx || {}, acct = c.acct || 'this', skus = (c.skus || []).filter(Boolean);
  const tech = '<details class="mcf-raw"><summary>Technical detail</summary><code>' + esc(raw) + '</code></details>';
  const say = (head, body) => '<b>' + esc(what) + ' — ' + head + '.</b>'
    + (body ? '<div style="margin-top:4px;font-weight:400">' + body + '</div>' : '') + tech;
  if (/SellerSKU is invalid|invalid\s+(seller\s*)?sku|sku[^.]{0,30}(not found|is invalid)/i.test(raw)) {
    return say('Amazon does not recognise ' + (skus.length === 1 ? 'this SKU' : 'one of these SKUs') + ' on the ' + esc(acct) + ' account',
      (skus.length ? '<b>' + skus.map(esc).join(', ') + '</b>. ' : '')
      + 'Check the Amazon SKU on the line, or choose the other account if it is stocked there. Nothing was placed.');
  }
  if (/quota|throttl|\b429\b|too many requests/i.test(raw)) return say('Amazon is busy', 'Nothing was placed. Try again in a minute.');
  if (/address|postal|zip ?code|StateOrRegion|\bcity\b|countrycode/i.test(raw)) {
    return say('Amazon could not use the delivery address', 'Correct the address on the order in Shopify, then try again. Nothing was placed.');
  }
  if (/No access to the Price Research backend|Google web page|backend sent/i.test(raw)) {
    return '<b>' + esc(what) + ' — the app could not reach its Amazon connection.</b><div style="margin-top:4px;font-weight:400">' + esc(raw) + '</div>';
  }
  if (!/403|unauthorized|access to requested resource is denied/i.test(raw)) {
    return say(/InvalidInput|\b400\b/i.test(raw) ? 'Amazon did not accept the order as it stands' : 'Amazon could not do this', 'Nothing was placed.');
  }
  return `<b>${esc(what)} — Amazon refused the call (403).</b>`
    + '<div style="margin-top:6px;font-weight:400">Nothing is wrong with the order itself. Worth knowing: '
    + 'SP-API returns this same 403, in these same words, for a request it does not recognise at all — '
    + 'so it does not on its own mean a permission is missing.'
    + '<div style="margin-top:6px">If it persists: the role MCF needs is <b>Amazon Fulfillment</b> '
    + '(“Ship to Amazon, and Amazon ships directly to customer”), not “Shipping”. And a refresh token '
    + 'minted before that role was added does not carry it, so the app has to be re-authorised.</div>'
    + '<div style="margin-top:6px" class="muted">Run <code>mcfCheck()</code> in the Apps Script editor — '
    + 'it uses a read-only endpoint, places nothing, and tells you which brand is affected.</div></div>';
}

async function soMcfSend(speed, fee) {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const who = $('soMcfBrand').selectedOptions[0].textContent;
  const plan = soMcfPlan(o, $('soMcfBrand').value);
  if (!plan.send.length) return;
  // The last gate, and it names the money and the address. A confirm that only says "are you sure"
  // is one nobody reads.
  if (!confirm(`Ship ${o.no} from ${who} FBA?\n\n`
    + `${speed} · ${fee}\n`
    + `To: ${[o.ship.name, o.ship.a1, o.ship.city, o.ship.state, o.ship.zip, o.ship.country].filter(Boolean).join(', ')}\n`
    // Named as AMAZON will receive it. This is the last gate before a real parcel, and a mapped
    // SKU is exactly the case where the code on the Shopify order is not the code being shipped —
    // so showing the Shopify one here would confirm something other than what is about to happen.
    + `${plan.send.map(x => { const i = x.i, amz = x.amz, shop = x.shop, q = x.qty;
        // Compared without case: a code that differs only in capitals is the SAME code, and
        // saying "(Shopify: …)" for it would read as a mapping nobody made.
        return `${amz || i.name}${amz && shop && amz.toUpperCase() !== shop ? ` (Shopify: ${shop})` : ''} x${q}`
          + (q !== i.qty ? ` — ordered ${i.qty}` : '');
      }).join('\n')}\n`
    + (plan.out.length ? `\nNOT in this parcel (they stay for India / production):\n${plan.out.map(x => `${x.label} — ${x.why}`).join('\n')}\n` : '')
    + `\n`
    + `Amazon will pick, pack and ship this. It cannot be cancelled from this app.`)) return;

  $('soMcfPrev').innerHTML = '<span class="muted">Placing the order with Amazon…</span>';
  try {
    const d = await apiPost({ mcf: 'create', order: { ...soMcfPayload(o), speed } });
    const e = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
    e.mcfId = d.mcfId;
    e.mcfAt = soStamp();
    e.mcfSpeed = speed;
    /* WHICH LINES went — so only those read "MCF done" and the rest stay open. */
    e.mcfSkus = plan.send.map(x => x.shop);
    // Remembered, so a later status check asks the SAME account. Asking the other one would come
    // back "no such fulfilment order", which reads as "Amazon lost it".
    e.mcfBrand = $('soMcfBrand').value;
    e.by = ME.email;
    await saveShopMeta();
    $('soMcfPrev').classList.add('hide');
    soRenderMcfBox();
    /* The Shopify half is reported SEPARATELY and never as a failure of the send. The parcel is
     * booked either way; if Shopify would not take the status change, the answer is to fix the token,
     * not to press this button again. */
    const sh = d.shop || {};
    const shopNote = sh.moved && sh.moved.length
        ? ` · Shopify now reads ${sh.moved.map(m => String(m.status || '?').toLowerCase().replace(/_/g, ' ')).join(', ')}.`
      : sh.already ? ' · Shopify had nothing open left to move.'
      : sh.skipped ? ''                       // an imported order — Shopify never had it
      : sh.off ? ''                           // switched off on purpose; not worth a line every time
      : sh.error ? ` · Shopify was NOT updated: ${sh.error}`
      : '';
    soMsg((d.already
      ? `${o.no} was already with Amazon as ${d.mcfId} — nothing was sent twice.`
      : `${o.no} sent to Amazon as ${d.mcfId}. Check status in a few hours for the tracking number.`)
      + shopNote);
  } catch (err) {
    $('soMcfPrev').innerHTML = '<div class="err">' + mcfErr(err, 'Could not send', { acct: plan.acct, skus: plan.send.map(x => x.amz) }) + '</div>';
  }
}

/**
 * Read back what Amazon did, and — once there is a tracking number — tell Shopify.
 *
 * The write-back only happens when a number actually exists. Marking an order fulfilled with no
 * tracking sends the customer a shipping email they cannot act on, which is worse than waiting.
 */
async function soMcfStatus() {
  const meta = SHOP_META[SHOP_EDIT] || {};
  if (!meta.mcfId) return;
  const btn = $('soMcfRefresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try {
    const d = await apiPost({ mcf: 'status', mcfId: meta.mcfId, brand: $('soMcfBrand').value });
    meta.mcfStatus = d.status || '';
    meta.mcfTrk = (d.trk || []).join(', ');
    await saveShopMeta();
    soRenderMcfBox();
    const soO = SHOP.orders.find(x => x.id === SHOP_EDIT);
    const part = Array.isArray(meta.mcfSkus) && soO && meta.mcfSkus.length < soO.items.filter(i => soLive(i) > 0).length;
    /* A PART-ORDER IS NOT FULFILLED. Writing the tracking to Shopify marks the whole order shipped and
     * tells the customer so, while the other lines have not left. */
    if ((d.trk || []).length && part) {
      soMsg(`Amazon shipped ${meta.mcfTrk} for the ${meta.mcfSkus.length} line(s) it carried. Shopify was NOT marked fulfilled — the other lines of this order are not in that parcel. Fulfil them in Shopify when they ship.`, true);
    } else if ((d.trk || []).length && !meta.shopFulfilled) {
      const f = await apiPost({ shopify: 'fulfil', orderId: SHOP_EDIT, trk: d.trk, trkCo: d.trkCo || 'Amazon Logistics',
        shop: (SHOP.orders.find(x => x.id === SHOP_EDIT) || {}).shopBrand === 'CPC' ? 'CPC' : '' });
      meta.shopFulfilled = 1;
      await saveShopMeta();
      // Amazon can hand back several tracking numbers; the write-back sends the first only. Saying
      // "the customer notified" after a partial write is the lie that matters — the customer is
      // waiting on a parcel nobody told them about, and the order reads as fully handled here.
      const held = f.held || [];
      soMsg(f.already
        ? `Amazon shipped ${meta.mcfTrk}. Shopify had nothing left open to fulfil.`
        : held.length
          ? `Amazon shipped ${meta.mcfTrk}. Shopify was told about ${(f.sent || [])[0]} ONLY — ${held.length} further tracking number(s) (${held.join(', ')}) did not go, so the customer knows about 1 parcel of ${1 + held.length}. Send those by hand.`
          : `Amazon shipped ${meta.mcfTrk} — Shopify marked fulfilled and the customer notified.`,
        held.length > 0);
    } else {
      soMsg(`Amazon says: ${d.status || 'no status yet'}${(d.trk || []).length ? '' : ' · no tracking number yet'}`);
    }
  } catch (e) {
    $('soErr').textContent = 'Status check failed: ' + (e.message || e);
    $('soErr').classList.remove('hide');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Check status'; }
}

$('soSave').onclick = saveShopOrder;
$('soCancel').onclick = () => { $('soModal').classList.add('hide'); SHOP_EDIT = null; };
$('soX').onclick = () => $('soCancel').onclick();
$('soGo').onclick = fetchShopOrders;
/* THE SEARCH WAITS FOR A PAUSE IN TYPING (2026-09-26: "shopify orders wala hang ho rha h"): every key redrew the whole
 * 550 KB table. The two lists redraw at once, as they always did. */
['soState', 'soDay'].forEach(id => $(id).addEventListener('input', renderShop));
{ let t = null; $('soFilter').addEventListener('input', () => { clearTimeout(t); t = setTimeout(renderShop, 220); }); }
$('soDay').addEventListener('change', renderShop);

/* The control shows LABELS; the rows carry state codes. Mapped in one place, so nothing downstream
 * has to know the difference and a renamed label cannot silently stop matching. */
const SO_SHIP_STATES = [
  ['sent', 'MCF done (already sent)'],
  ['yes', 'MCF ready'],
  ['part', 'Partly stocked'],
  ['no', 'Not stocked'],
  ['unknown', 'Not in Amazon (or stock not read yet)'],
  ['none', 'Nothing to send (refunded / set to 0)'],
  ['fromIndia', 'Ship from India (MCF cannot)'],
  ['needProd', 'Need from production (neither)'],
];
const SO_LABEL_TO_STATE = Object.fromEntries(SO_SHIP_STATES.map(([v, l]) => [l, v]));
const soMcfPicked = () => msVals('soMcf').map(l => SO_LABEL_TO_STATE[l]).filter(Boolean);
msInit('soMcf', 'shipping states', SO_SHIP_STATES.map(x => x[1]));
MS['soMcf'].onChange = () => renderShop();
/* Declared HERE, next to the filter that uses it — it used to sit down in the import block, which
 * runs later, and a `const` read before its line is a ReferenceError, not an undefined. The channel
 * filter simply never appeared. */
const SO_CHANNELS = ['CPC Shopify', 'Etsy Linen', 'Etsy FCI', 'Etsy Floral', 'Etsy CPC'];
msInit('soChan', 'shops', ['Shopify'].concat(SO_CHANNELS));
MS['soChan'].onChange = () => renderShop();

/* CHANGING A DATE NOW FETCHES.
 *
 * These three decide what the backend is ASKED for, unlike the MCF and text filters above, which
 * only narrow what is already in hand. Leaving them inert meant changing a date visibly did
 * nothing — the list carried on answering the old question, and the honest conclusion from the
 * outside was that date ranges did not work.
 *
 * `change` fires when a date input is committed, not per keystroke, so this is one fetch per edit.
 */
['soFrom', 'soTo', 'soOpen'].forEach(id => $(id).addEventListener('change', () => {
  if (!$('soGo').disabled) fetchShopOrders();
}));


/* ---- from Sellora: Adjustments ---- */
