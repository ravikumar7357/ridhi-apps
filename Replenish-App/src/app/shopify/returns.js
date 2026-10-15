/* ================= SHOPIFY RETURNS & REPLACEMENTS — typed by hand, tracked to the USA warehouse =================
 *
 * Ravi, 2026-09-26: "koi ek order h jisme 4 line item me order aaya tha but buyer ne usme se 2 return kar diye to
 * m manually feed karu ki konse order return aaye h kis tracking number ki according h — mera usa me warehouse h
 * baha return jayega."
 *
 * A return is a record on the ORDER's own entry in audit/shoporders (SHOP_META[orderId].returns[id]) — the one place
 * this tab already writes, with the same rights. It names the lines and how many of each came back, the return's
 * tracking number and carrier, why, and where it has got to: started → on its way → received at the warehouse →
 * closed. No unit can be returned twice: the cap is what the order held less what earlier returns already took.
 *
 * REPLACEMENTS (2026-10-14, from Umesh's returns design, taken into the app as Ravi asked: "integrate its features
 * into our plan"). A case now says WHAT the customer gets — `what`: return (default, and every record saved before
 * today), replace (the customer keeps it, a new one goes out) or both. A replacement has its own leg, `rep`:
 * where it ships from (this order's FBA by MCF, India, or production) and whether it has gone. Sending it uses the
 * app's own MCF send and production bucket, each under its OWN reference — "<order>-R<n>" — so it can never be
 * taken for the original order: Amazon would refuse a second MCF order with the original's id, and production
 * would add the quantity onto the original's line. The Shopify order itself is never touched.
 *
 * The screen has the Shopify orders look: the Both / Ridhi / CPC switch and one button per stage. */
let SR = { lane: '', q: '', store: null };
const SR_STATUS = {
  started: ['Return started', 'pill-low'], transit: ['On its way to the warehouse', 'pill-low'],
  received: ['Received at the warehouse', 'pill-ok'], closed: ['Closed', 'pill-out'],
};
const SR_NEXT = { started: 'transit', transit: 'received', received: 'closed' };
const SR_CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'Amazon', 'Other'];
const SR_REASONS = ['Damaged', 'Wrong item', 'Did not like it', 'Size / fit', 'Arrived late', 'Lost in transit', 'Other'];
const SR_WHAT = { return: 'Return', replace: 'Replacement', both: 'Return + replacement' };
const SR_FROM = { fba: 'FBA · MCF', india: 'India', prod: 'Production' };
/** The stage buttons, in the order the work is done: a customer waiting on a replacement comes first. */
const SR_LANES = [
  { k: 'send', t: 'Replacement to send', tone: 'bad' },
  { k: 'started', t: 'Return started', tone: 'warn' },
  { k: 'transit', t: 'On its way back', tone: 'warn' },
  { k: 'received', t: 'At the warehouse', tone: 'ok' },
  { k: 'sent', t: 'Replacement sent', tone: 'ok' },
  { k: 'closed', t: 'Closed', tone: 'mute' },
];
const srOrders = () => (SHOP.orders || []).concat(soImpLive()).filter(o => o && o.id);
const srOrderOf = oid => srOrders().find(o => String(o.id) === String(oid)) || null;
const srWhat = r => (SR_WHAT[r && r.what] ? r.what : 'return');
/** Which store a case belongs to — the same rule as the store switch on Shopify orders. */
const srStore = r => (/cpc/i.test(String((r && r.shop) || '')) ? 'CPC' : 'Ridhi');
/** Which stage button a case sits under. */
function srLane(r) {
  if (r.status === 'closed') return 'closed';
  if (r.rep && r.rep.st === 'todo') return 'send';
  if (srWhat(r) === 'replace') return 'sent';
  return SR_STATUS[r.status] ? r.status : 'started';
}
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
/** Stock for one SKU of a case: FBA of the ORDER's own Amazon account (never the other one) and India sellable units.
 *  null where it is not known yet — the stock is read when Shopify orders are fetched. */
function srStock(shop, sku) {
  const brand = /cpc/i.test(String(shop || '')) ? 'CPC' : 'SP';
  let fba = null, india = null;
  try { if (SHOP_STOCK_LOADED) { const v = soFbaIn(brand, soAmzKey(sku)); fba = v == null ? 0 : v; } } catch (e) { /* not known */ }
  try { const i = soIndiaOf(sku); india = i ? Number(i[0]) || 0 : null; } catch (e) { /* not known */ }
  return { fba, india };
}
/** Where a replacement should go from: this order's FBA if it holds enough of every line, else India, else production. */
function srBestFrom(shop, items) {
  const all = f => items.length && items.every(it => { const s = srStock(shop, it.sku)[f]; return s != null && s >= (parseInt(it.qty, 10) || 0); });
  return all('fba') ? 'fba' : all('india') ? 'india' : 'prod';
}
/** Write one return (new or edited). Returns '' or why not. */
async function srSave(orderId, rec, id) {
  const o = srOrderOf(orderId);
  if (!o) return 'Pick an order that is loaded on this screen.';
  const room = srLineRoom(o, id);
  const items = (rec.items || []).map(it => ({ lid: String(it.lid), qty: parseInt(it.qty, 10) || 0 })).filter(it => it.qty > 0)
    .map(it => { const l = room.find(x => String(x.lid) === it.lid); return l ? Object.assign(it, { sku: l.sku, name: l.name, variant: l.variant }) : it; });
  if (!items.length) return 'Tick at least one line and say how many.';
  for (const it of items) {
    const l = room.find(x => String(x.lid) === it.lid);
    if (!l) return 'That line is not on the order.';
    if (it.qty > l.room) return `${l.sku || l.name}: only ${nf(l.room)} of ${nf(l.qty)} can still go on a case${l.back ? ' — ' + nf(l.back) + ' already on one' : ''}.`;
  }
  const what = SR_WHAT[rec.what] ? rec.what : 'return';
  const status = SR_STATUS[rec.status] ? rec.status : 'started';
  const now = new Date().toISOString();
  const prev = id ? (((SHOP_META[orderId] || {}).returns || {})[id] || {}) : {};
  /* The replacement leg. Once it has gone it is not edited from the form — what went, went. */
  let rep = null;
  if (what !== 'return') {
    rep = prev.rep && prev.rep.st === 'sent' ? prev.rep
      : { st: 'todo', from: SR_FROM[rec.from] ? rec.from : srBestFrom(o.shopBrand, items) };
  }
  const out = Object.assign({}, prev, {
    orderNo: o.no || '', shop: o.shopBrand || o.chan || '', customer: (o.ship && o.ship.name) || o.name || '', orderAt: o.at || '',
    items, what, rep, trk: String(rec.trk || '').trim(), carrier: String(rec.carrier || '').trim(), reason: String(rec.reason || '').trim(),
    note: String(rec.note || '').trim(), status, date: String(rec.date || '').trim() || dToday(),
    at: prev.at || now, by: prev.by || ME.email, updAt: now, updBy: ME.email,
    log: (prev.log || []).concat([{ at: now, by: ME.email, what: (id ? 'edited' : 'opened') + ' · ' + SR_WHAT[what]
      + (what === 'replace' ? '' : ' · ' + SR_STATUS[status][0]) + (rep && rep.st === 'todo' ? ' · replacement from ' + SR_FROM[rep.from] : '') }]),
  });
  const rid = id || ('ret_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  SHOP_META[orderId] = Object.assign({}, SHOP_META[orderId] || {}, { returns: Object.assign({}, (SHOP_META[orderId] || {}).returns || {}, { [rid]: out }) });
  try { await saveShopMeta(); } catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}
/** Move a return along: started → on its way → received → closed. */
async function srSetStatus(orderId, id, status, note, extra) {
  const r = (((SHOP_META || {})[orderId] || {}).returns || {})[id];
  if (!r) return 'That return is gone — press Refresh.';
  if (!SR_STATUS[status]) return 'Not a stage.';
  const now = new Date().toISOString();
  const next = Object.assign({}, r, extra || {}, { status, updAt: now, updBy: ME.email, log: (r.log || []).concat([{ at: now, by: ME.email, what: SR_STATUS[status][0] + (note ? ' — ' + note : '') }]) });
  if (status === 'received') next.receivedAt = next.receivedAt || dToday();
  if (status === 'closed') next.closedAt = dToday();
  if (note) next.note = [r.note, note].filter(Boolean).join(' · ');
  SHOP_META[orderId] = Object.assign({}, SHOP_META[orderId], { returns: Object.assign({}, SHOP_META[orderId].returns, { [id]: next }) });
  try { await saveShopMeta(); } catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}
/** The replacement's own reference: "<order>-R1", "-R2"… one per replacement on that order, never reused. */
function srRepRef(orderId, id) {
  const r = (((SHOP_META || {})[orderId] || {}).returns || {})[id] || {};
  if (r.rep && r.rep.ref) return r.rep.ref;
  const used = Object.values(((SHOP_META || {})[orderId] || {}).returns || {}).filter(x => x && x.rep && x.rep.ref).length;
  return String(r.orderNo || orderId).replace(/^#/, '') + '-R' + (used + 1);
}
/**
 * SEND THE REPLACEMENT. Returns '' or why not.
 *   fba   — an MCF order on THIS order's Amazon account, under the replacement's own reference. The backend makes the
 *           fulfilment id from that reference, so pressing twice is refused by Amazon as a duplicate, not shipped twice.
 *           The id sent is not a Shopify id, so the backend leaves the Shopify order alone.
 *   prod  — a production line under the replacement's own number, opened the way the bucket opens a forced line.
 *   india — recorded; it is packed from the India shelf like any India order.
 */
async function srSendRep(orderId, id, speed) {
  const r = (((SHOP_META || {})[orderId] || {}).returns || {})[id];
  if (!r || !r.rep) return 'That case has no replacement.';
  if (r.rep.st === 'sent') return '';
  const o = srOrderOf(orderId);
  if (!o) return 'The order is not loaded — set the dates on Shopify orders to include it, press Fetch, then try again.';
  const ref = srRepRef(orderId, id), now = new Date().toISOString(), from = r.rep.from;
  const items = (r.items || []).filter(it => it.sku && (parseInt(it.qty, 10) || 0) > 0);
  if (!items.length) return 'No line on this case has a SKU.';
  const rep = Object.assign({}, r.rep, { st: 'sent', ref, sentAt: now, sentBy: ME.email });
  let said = '';
  if (from === 'fba') {
    const brand = o.shopBrand === 'CPC' ? 'CPC' : 'SP';
    const lines = items.map(it => ({ sku: soAmzSku(it.sku) || it.sku, qty: parseInt(it.qty, 10) || 0 }));
    for (const l of lines) {
      const have = soFbaIn(brand, soAmzKey(l.sku));
      if (have == null || have < l.qty) return `${l.sku}: ${have == null ? 'not in' : 'only ' + have + ' in'} ${soAcctName(brand)} FBA — pick India or Production instead.`;
    }
    let d;
    try {
      d = await apiPost({ mcf: 'create', order: { no: ref, id: 'REPL-' + o.id, at: dToday(), ship: o.ship, brand,
        shop: o.shopBrand === 'CPC' ? 'CPC' : '', items: lines, speed: speed || 'Standard',
        comment: 'Replacement for order ' + o.no + '. Sorry for the trouble.' } });
    } catch (err) { return 'Not sent — ' + String(mcfErr(err, 'Replacement', { acct: soAcctName(brand), skus: lines.map(l => l.sku) })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
    Object.assign(rep, { mcfId: d.mcfId, mcfBrand: brand, speed: speed || 'Standard' });
    said = (d.already ? 'already with Amazon as ' : 'sent to Amazon as ') + d.mcfId;
  } else if (from === 'prod') {
    await ptLoadGates();
    if (PTG.err) return 'Could not read the production database: ' + PTG.err;
    const pseudo = { id: 'REPL-' + o.id + '-' + id, no: ref, at: dToday(), items: [] };
    const no = shpAssignNo(pseudo, shpTakenNumbers());
    const exists = await Promise.all(items.map(it => ptGet('pt_orderBook/ob_shp_' + no + '_' + obUC(it.sku)).catch(() => null)));
    if (exists.some(Boolean)) return 'Production already has ' + no + ' open — nothing was opened twice.';
    const force = new Map(items.map(it => [obUC(it.sku), { qty: parseInt(it.qty, 10) || 0, why: 'replacement for Shopify ' + o.no + (r.reason ? ' · ' + r.reason : ''), name: it.name || '' }]));
    const p = shpPlanOrder(pseudo, false, no, { only: new Set(), force });
    if (p.err) return p.err;
    if (!p.rows.length) return 'Nothing could be opened: ' + (p.skipped || []).map(s => s.sku + ' — ' + s.why).join(' · ');
    if (SHP_CUSTOM === null) { try { SHP_CUSTOM = ptList(await ptGet('pt_customSkus')); } catch (e) { SHP_CUSTOM = []; } }
    const haveSku = new Set((SHP_CUSTOM || []).map(x => obUC(x && x.sku)).concat((PTG.mdb || []).map(x => obUC(x && x.sku))));
    p.needSku.forEach(w => { if (haveSku.has(w.sku)) return; const rec = shpCustomRec(w, w.sku, now); p.patch['pt_customSkus/' + w.sku] = rec; SHP_CUSTOM.push(rec); });
    try { await ptPatch(p.patch); } catch (e) { return 'Not opened: ' + (e.message || e) + ' — nothing changed.'; }
    p.rows.forEach(row => { const i = (PTG.ob || []).findIndex(x => x && x.id === row.id); if (i >= 0) PTG.ob[i] = row; else PTG.ob.push(row); });
    PTG.ob = (PTG.ob || []).slice();
    if (typeof SOX !== 'undefined' && Array.isArray(SOX.rows)) { SOX.rows = SOX.rows.filter(x => !(x && x._id === p.no)); if (p.rec) SOX.rows.push(p.rec); }
    Object.assign(rep, { prodNo: no });
    said = 'opened in production as ' + no;
  } else {
    said = 'to be packed from India';
  }
  const next = Object.assign({}, r, { rep, updAt: now, updBy: ME.email,
    log: (r.log || []).concat([{ at: now, by: ME.email, what: 'Replacement ' + ref + ' ' + said }]) });
  SHOP_META[orderId] = Object.assign({}, SHOP_META[orderId], { returns: Object.assign({}, SHOP_META[orderId].returns, { [id]: next }) });
  try { await saveShopMeta(); } catch (e) { return 'Sent, but the case could not be updated: ' + (e.message || e) + ' — do NOT press Send again; tell an admin.'; }
  soMsg('Replacement ' + ref + ' ' + said + '.');
  return '';
}
function srRows() {
  const q = SR.q.trim().toLowerCase();
  return srAll().filter(r => (!SR.store || srStore(r) === SR.store)
    && (!q || [r.orderNo, r.customer, r.trk, r.carrier, r.reason, r.note, r.rep && r.rep.ref].concat((r.items || []).map(i => i.sku + ' ' + i.name)).join(' ').toLowerCase().includes(q)));
}
/** Days a case has been open, from its date. */
const srAge = r => { const a = Date.parse(String(r.date || '').slice(0, 10)), b = Date.parse(dToday()); return isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 864e5)); };
function srRender() {
  const pool = srRows();
  const n = { '': pool.length };
  pool.forEach(r => { const L = srLane(r); n[L] = (n[L] || 0) + 1; });
  if ($('srStore')) $('srStore').querySelectorAll('[data-srstore]').forEach(b => b.classList.toggle('on', (b.getAttribute('data-srstore') || '') === (SR.store || '')));
  if ($('srLanes')) $('srLanes').innerHTML = [{ k: '', t: 'All' }].concat(SR_LANES).map(l =>
    `<button type="button" class="so-lb${SR.lane === l.k ? ' on' : ''}${n[l.k] ? '' : ' zero'}" data-srlane="${l.k}">${l.tone ? `<i class="so-dot so-dot-${l.tone}"></i>` : ''}${l.t}<b>${nf(n[l.k] || 0)}</b></button>`).join('');
  const rows = pool.filter(r => !SR.lane || srLane(r) === SR.lane);
  if ($('srAt')) $('srAt').innerHTML = typeof soStockStamp === 'function' ? soStockStamp() : '';
  const stockCell = (shop, sku, qty) => { const s = srStock(shop, sku); const c = v => v == null ? '<span class="muted">—</span>' : `<b style="color:${v >= qty ? 'var(--accent)' : 'var(--bad)'}">${nf(v)}</b>`;
    return `<span class="muted" style="font-size:10.5px;white-space:nowrap">FBA ${c(s.fba)} · India ${c(s.india)}</span>`; };
  const head = '<thead><tr>' + ['Order', 'Customer · why', 'Items · stock', 'What', 'Stage', ''].map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  const body = rows.map(r => {
    const L = srLane(r), what = srWhat(r), age = srAge(r);
    const st = L === 'send' ? ['Replacement to send', 'pill-out'] : L === 'sent' ? [r.rep && r.rep.from === 'prod' ? 'Replacement in production' : 'Replacement sent', 'pill-ok']
      : (SR_STATUS[r.status] || ['?', 'pill-low']);
    const nx = L === 'send' || L === 'closed' ? null : L === 'sent' ? 'closed' : SR_NEXT[r.status];
    return '<tr>'
    + `<td class="frz" style="text-align:left"><b>${esc(r.orderNo || r.orderId)}</b><div class="muted" style="font-size:10.5px">${esc(srStore(r))} · ${esc(r.date || '')}`
      + (L !== 'closed' ? ` <span class="sr-age${age >= 10 ? ' old' : ''}" title="${nf(age)} day(s) open">${nf(age)}d</span>` : '') + '</div></td>'
    + `<td style="text-align:left;white-space:normal;max-width:200px">${esc(r.customer || '—')}<div class="muted" style="font-size:10.5px">${esc(r.reason || '—')}${r.note ? ' · ' + esc(r.note) : ''}</div></td>`
    + `<td style="text-align:left;white-space:normal;max-width:240px">${(r.items || []).map(i => `<span style="white-space:nowrap"><b>${nf(i.qty)}</b> × ${esc(i.sku || i.name)}</span>${L !== 'closed' ? '<br>' + stockCell(r.shop, i.sku, parseInt(i.qty, 10) || 0) : ''}`).join('<br>')}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:260px">${SR_WHAT[what]}${r.rep ? `<div class="muted" style="font-size:10.5px">replacement from ${esc(SR_FROM[r.rep.from] || '')}${r.rep.ref ? ' · ' + esc(r.rep.ref) : ''}${r.rep.mcfId ? ' · ' + esc(r.rep.mcfId) : ''}${r.rep.prodNo ? ' · ' + esc(r.rep.prodNo) : ''}</div>` : ''}<div class="muted" style="font-size:10.5px">${what === 'replace' ? 'customer keeps it' : 'back: ' + (r.trk ? esc(r.carrier ? r.carrier + ' · ' : '') + '<span style="font-family:ui-monospace,monospace">' + esc(r.trk) + '</span>' : 'no tracking yet')}</div></td>`
    + `<td><span class="pill ${st[1]}">${esc(st[0])}</span></td>`
    + `<td style="white-space:nowrap">`
      + (L === 'send' ? `<button type="button" class="jw-btn jw-primary" data-sr-send="${esc(r.orderId)}|${esc(r.id)}" style="padding:4px 10px;font-size:12px">Send replacement</button> ` : '')
      + (nx ? `<button type="button" class="jw-btn jw-primary" data-sr-next="${esc(r.orderId)}|${esc(r.id)}|${nx}" style="padding:4px 10px;font-size:12px">${esc(nx === 'transit' ? 'On its way' : nx === 'received' ? 'Received' : 'Close')}</button> ` : '')
      + `<button type="button" class="ghost" data-sr-edit="${esc(r.orderId)}|${esc(r.id)}" style="padding:4px 10px;font-size:12px">Edit</button></td></tr>`;
  }).join('');
  if ($('srTable')) $('srTable').innerHTML = head + '<tbody>' + (body || `<tr><td colspan="6" class="muted" style="padding:14px">${SR.lane ? 'Nothing here — pick another stage above, or All.' : 'No case yet — press + New.'}</td></tr>`) + '</tbody>';
}
function srOpen() {
  if (!Object.keys(SHOP_META).length) loadShopMeta().then(() => srRender()).catch(() => {});
  if (SR.store === null) SR.store = typeof SO_STORE === 'string' ? SO_STORE : '';
  const all = srAll(), open = all.filter(r => r.status !== 'closed');
  ptOpenDialog({
    /* Live since 15 Oct (Ravi: "shopify ko test se live kardo"); it ran a day as TEST first. */
    title: 'Returns & replacements', wide: true, boxClass: 'vo-band',
    titleExtra: `<div class="shb-band"><span class="shb-t">Returns &amp; replacements</span>
        <div class="shb-n"><b>${nf(open.filter(r => srLane(r) === 'send').length)}</b><span>replacements to send</span></div>
        <div class="shb-n"><b>${nf(open.filter(r => srWhat(r) !== 'replace' && (r.status === 'started' || r.status === 'transit')).length)}</b><span>coming back</span></div>
        <div class="shb-n"><b>${nf(open.filter(r => srLane(r) === 'received').length)}</b><span>at the warehouse</span></div>
        <button type="button" id="srNew">+ New</button></div>`,
    html: `<div class="shb-bar"><div class="seg" id="srStore" title="Show Ridhi's cases, CPC's cases, or both">
        <button type="button" class="segbtn" data-srstore="">Both</button><button type="button" class="segbtn" data-srstore="Ridhi">Ridhi</button><button type="button" class="segbtn" data-srstore="CPC">CPC</button></div>
        <input id="srQ" placeholder="Search order / customer / tracking / SKU" value="${esc(SR.q)}"></div>
      <div class="so-lanes" id="srLanes" style="margin:0 0 10px"></div>
      <div class="muted" id="srAt" style="font-size:11.5px;margin:-4px 0 8px"></div>
      <div class="xlwrap shb-wrap"><table class="xl" id="srTable"></table></div>`,
  });
  if ($('srStore')) $('srStore').onclick = e => { const b = e.target.closest('[data-srstore]'); if (!b) return; SR.store = b.getAttribute('data-srstore') || ''; srRender(); };
  if ($('srLanes')) $('srLanes').onclick = e => { const b = e.target.closest('[data-srlane]'); if (!b) return; SR.lane = b.getAttribute('data-srlane') || ''; srRender(); };
  let t = null;
  if ($('srQ')) $('srQ').oninput = () => { clearTimeout(t); t = setTimeout(() => { SR.q = $('srQ').value; srRender(); }, 180); };
  if ($('srNew')) $('srNew').onclick = () => srNewOpen('', '');
  if ($('srTable')) $('srTable').onclick = async e => {
    const sd = e.target.closest('[data-sr-send]');
    if (sd) { const [oid, id] = sd.getAttribute('data-sr-send').split('|'); return srSendOpen(oid, id); }
    const nx = e.target.closest('[data-sr-next]');
    if (nx) {
      const [oid, id, st] = nx.getAttribute('data-sr-next').split('|');
      if (st === 'closed' || st === 'received') {
        return ptOpenDialog({ title: st === 'received' ? 'Received at the warehouse' : 'Close this case',
          fields: [{ key: 'note', label: st === 'received' ? 'Condition / remarks' : 'Why it is closed (refunded, restocked, written off, replacement delivered…)', span: true, value: '' }],
          saveLabel: st === 'received' ? 'Received' : 'Close', onCancel: srOpen,
          onSave: async v => { const err = await srSetStatus(oid, id, st, v.note); if (!err) srOpen(); return err; } });
      }
      /* ON ITS WAY MEANS A PARCEL WITH A NUMBER (2026-10-14). It used to move the case with no tracking at all, and the
       * warehouse then had nothing to match the box against. */
      if (st === 'transit') {
        const r = (((SHOP_META || {})[oid] || {}).returns || {})[id] || {};
        return ptOpenDialog({ title: 'On its way back', subtitle: (r.orderNo || '') + ' · ' + (r.customer || ''),
          fields: [{ key: 'trk', label: 'Return tracking number', value: r.trk || '', span: true },
            { key: 'carrier', label: 'Carrier', type: 'select', options: SR_CARRIERS, value: r.carrier || 'USPS' }],
          saveLabel: 'On its way', onCancel: srOpen,
          onSave: async v => { const t = String(v.trk || '').trim(); if (!t) return 'Type the tracking number from the return label — it is how the warehouse knows the parcel.';
            const err = await srSetStatus(oid, id, 'transit', '', { trk: t, carrier: v.carrier || 'USPS' }); if (!err) setTimeout(srOpen, 0); return err; } });
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
/** The last look before a replacement goes: what, from where, to whom. An MCF send is real money and a real parcel. */
function srSendOpen(orderId, id) {
  const r = (((SHOP_META || {})[orderId] || {}).returns || {})[id];
  if (!r || !r.rep) return;
  const o = srOrderOf(orderId), from = r.rep.from, ref = srRepRef(orderId, id);
  const to = o && o.ship ? [o.ship.name, o.ship.a1, o.ship.city, o.ship.state, o.ship.zip, o.ship.country].filter(Boolean).join(', ') : '';
  ptOpenDialog({
    title: 'Send replacement ' + ref,
    subtitle: `${r.orderNo || ''} · ${r.customer || ''} · from ${from === 'fba' ? soAcctName(r.shop === 'CPC' ? 'CPC' : 'SP') + ' FBA by MCF' : SR_FROM[from]}`,
    html: `<div style="font-size:13px;line-height:1.6">
        ${(r.items || []).map(i => `<div><b>${nf(i.qty)}</b> × ${esc(i.sku || i.name)}</div>`).join('')}
        ${to ? `<div class="muted" style="margin-top:8px">To: ${esc(to)}</div>` : '<div class="err" style="margin-top:8px">The order is not loaded, so there is no address. Fetch its dates on Shopify orders first.</div>'}
        ${from === 'fba' ? `<label style="margin-top:10px;max-width:220px">Speed<select id="srSpeed"><option>Standard</option><option>Expedited</option><option>Priority</option></select></label>
          <div class="warn" style="margin-top:10px">Amazon will pick, pack and ship this as a new order, ${esc(ref)}. It cannot be cancelled from this app. The original Shopify order is not changed.</div>`
        : from === 'prod' ? `<div class="warn" style="margin-top:10px">Opens a production line under its own number for ${esc(ref)}, so it is never added onto the original order's line.</div>`
        : '<div class="muted" style="margin-top:10px">Marks it to be packed from the India shelf.</div>'}
      </div>`,
    onCancel: srOpen,
    saveLabel: from === 'fba' ? 'Send by MCF' : from === 'prod' ? 'Open in production' : 'Mark sent from India',
    onSave: async () => { const err = await srSendRep(orderId, id, ($('srSpeed') || {}).value); if (!err) setTimeout(srOpen, 0); return err; },
  });
}
/** The form: which order, which lines and how many, what the customer gets, the return's tracking, why. */
function srNewOpen(orderId, id) {
  const orders = srOrders().slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const prev = id ? (((SHOP_META[orderId] || {}).returns || {})[id] || {}) : {};
  const o = orderId ? srOrderOf(orderId) : null;
  const sent = !!(prev.rep && prev.rep.st === 'sent');
  const linesHtml = ord => !ord ? '<div class="muted" style="font-size:12.5px;margin:8px 0">Pick an order above and its lines appear here.</div>'
    : `<div class="sr-lines"><table class="xl"><thead><tr><th></th><th>SKU</th><th>Item</th><th class="num">Ordered</th><th class="num">Already on a case</th><th class="num">This case</th><th>Stock</th></tr></thead><tbody>${
      srLineRoom(ord, id).map(l => { const was = (prev.items || []).find(i => String(i.lid) === String(l.lid)); const s = srStock(ord.shopBrand, l.sku); return `<tr>
        <td><input type="checkbox" data-sr-tick="${esc(l.lid)}"${was ? ' checked' : ''}${l.room <= 0 && !was ? ' disabled' : ''}></td>
        <td style="font-family:ui-monospace,monospace;text-align:left">${esc(l.sku || '—')}</td><td style="text-align:left">${esc(l.name)}${l.variant ? ' <span class="muted">' + esc(l.variant) + '</span>' : ''}</td>
        <td class="num">${nf(l.qty)}</td><td class="num">${l.back ? nf(l.back) : '<span class="muted">—</span>'}</td>
        <td class="num"><input type="number" min="0" max="${l.room}" step="1" data-sr-qty="${esc(l.lid)}" value="${was ? was.qty : ''}" placeholder="—"${l.room <= 0 && !was ? ' disabled' : ''}></td>
        <td style="white-space:nowrap;font-size:11.5px">${soAcctName(ord.shopBrand === 'CPC' ? 'CPC' : 'SP')} FBA <b>${s.fba == null ? '—' : nf(s.fba)}</b> · India <b>${s.india == null ? '—' : nf(s.india)}</b></td></tr>`; }).join('')
    }</tbody></table></div>`;
  const what0 = srWhat(prev), from0 = prev.rep ? prev.rep.from : '';
  ptOpenDialog({
    title: id ? 'Edit case' : 'New return / replacement', wide: true,
    subtitle: o ? `${o.no} · ${(o.ship && o.ship.name) || ''} · ${o.at}` : 'Which order is it?',
    html: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;font-size:12.5px">
      <label style="grid-column:1/-1">Order<input id="srOrd" list="srOrdList" placeholder="Type the order number" value="${esc(o ? o.no : '')}" autocomplete="off"${id ? ' readonly' : ''}>
        <datalist id="srOrdList">${orders.slice(0, 1500).map(x => `<option value="${esc(x.no)}">${esc([(x.ship && x.ship.name) || '', x.at, x.shopBrand || ''].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
      <div id="srLines" style="grid-column:1/-1">${linesHtml(o)}</div>
      <label>What does the customer get?<select id="srWhat"${sent ? ' disabled' : ''}>${Object.entries(SR_WHAT).map(([k, v]) => `<option value="${k}"${what0 === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label id="srFromW">Replacement ships from<select id="srFrom"${sent ? ' disabled' : ''}><option value="">Suggest from stock</option>${Object.entries(SR_FROM).map(([k, v]) => `<option value="${k}"${from0 === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Why<select id="srWhy">${SR_REASONS.map(c => `<option${(prev.reason || '') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Case opened on<input id="srDate" type="date" value="${esc(prev.date || dToday())}"></label>
      <label class="srRet">Return tracking number<input id="srTrk" value="${esc(prev.trk || '')}" placeholder="from the return label — can be added later" style="font-family:ui-monospace,monospace"></label>
      <label class="srRet">Carrier<select id="srCar">${SR_CARRIERS.map(c => `<option${(prev.carrier || 'USPS') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="srRet">Return stage<select id="srSt">${Object.entries(SR_STATUS).map(([k, v]) => `<option value="${k}"${(prev.status || 'started') === k ? ' selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      <label style="grid-column:1/-1">Remarks<input id="srNote" value="${esc(prev.note || '')}" placeholder="anything the warehouse should know"></label>
    </div>`,
    saveLabel: id ? 'Save' : 'Save the case', onCancel: srOpen,
    onSave: async () => {
      const no = ($('srOrd') || {}).value || '';
      const ord = o || orders.find(x => String(x.no).toLowerCase() === no.trim().toLowerCase());
      if (!ord) return 'Pick an order that is loaded on this screen (fetch the date range first).';
      const items = [...document.querySelectorAll('[data-sr-tick]')].filter(t => t.checked).map(t => { const lid = t.getAttribute('data-sr-tick'); const q = document.querySelector('[data-sr-qty="' + lid + '"]'); return { lid, qty: q ? q.value : 0 }; });
      const what = $('srWhat').value;
      /* A replacement-only case has no return leg; it is closed, not moved along, once the new one has gone. */
      const status = what === 'replace' ? (prev.status === 'closed' ? 'closed' : 'started') : $('srSt').value;
      const err = await srSave(String(ord.id), { items, what, from: $('srFrom').value, trk: what === 'replace' ? '' : $('srTrk').value,
        carrier: $('srCar').value, reason: $('srWhy').value, date: $('srDate').value, status, note: $('srNote').value }, id);
      if (err) return err;
      setTimeout(srOpen, 0);
      return '';
    },
  });
  /* Show only what the choice needs: no return fields for a replacement the customer keeps, no "ships from" for a plain return. */
  const syncWhat = () => {
    const w = ($('srWhat') || {}).value || 'return';
    document.querySelectorAll('.srRet').forEach(el => el.classList.toggle('hide', w === 'replace'));
    if ($('srFromW')) $('srFromW').classList.toggle('hide', w === 'return');
  };
  if ($('srWhat')) $('srWhat').onchange = syncWhat;
  syncWhat();
  /* A LINE'S QUANTITY IS BLANK UNTIL IT IS TICKED (2026-10-14): a 1 on every line read as if the whole order were on
   * the case. Ticking puts 1 in, unticking clears it, and typing a number ticks the line. */
  if ($('srLines')) $('srLines').addEventListener('change', e => {
    const t = e.target, tick = t.getAttribute && t.getAttribute('data-sr-tick'), qty = t.getAttribute && t.getAttribute('data-sr-qty');
    if (tick) { const q = document.querySelector('[data-sr-qty="' + tick + '"]'); if (q) q.value = t.checked ? (Number(q.value) > 0 ? q.value : 1) : ''; }
    if (qty) { const c = document.querySelector('[data-sr-tick="' + qty + '"]'); if (c && !c.disabled) c.checked = Number(t.value) > 0; }
  });
  /* The lines follow the order typed. */
  if ($('srOrd') && !id) $('srOrd').onchange = () => {
    const ord = orders.find(x => String(x.no).toLowerCase() === $('srOrd').value.trim().toLowerCase());
    if ($('srLines')) $('srLines').innerHTML = linesHtml(ord);
  };
}
if ($('soReturns')) $('soReturns').onclick = () => srOpen();
