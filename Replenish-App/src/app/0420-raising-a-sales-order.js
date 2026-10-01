/* ================= RAISING A SALES ORDER =================
 *
 * The whole life of an order, run from here: raise it, place it, have it reviewed, and — on
 * approval — have it written into the order book, which is the moment production is told about it.
 *
 * WHO MAY DO WHAT. The production tool has three roles; this app has two. Anyone who can see this
 * section may raise an order and edit THEIR OWN while it is a draft or has been returned to them.
 * An admin here stands in for the Super Admin: review, approve, return, and edit or delete anything.
 * That is stated on the form rather than left to be discovered.
 *
 * THE ORDER NUMBER IS ONE SERIES: CHANNEL-DDMMYYYY-SEQ, e.g. AMZ-01092026-01. The sequence is taken
 * across sales orders AND the order book together, so it can never land on a number the book already
 * uses. A draft renumbers if its channel or date changes; once placed the number is frozen, because
 * by then it is written on cutting slips and press entries.
 *
 * APPROVAL IS THE ONLY THING THAT WRITES THE ORDER BOOK, and it writes ONE ROW PER SKU with a
 * deterministic key — ob_so_{ORDER}_{SKU}. Two people approving at once, or a double-click, land on
 * the same key and the second write simply repeats the first. The old tool learnt this the hard way:
 * random row ids duplicated production lines. Same key here, for the same reason.
 */

const SO_RESERVED_PREFIXES = ['LEG', 'PRD', 'ADJ', 'SO', 'ORD', 'SHP'];

/** The channels an order can be raised on. The master is empty today, so the tool's own fallback. */
function soChannels() {
  const rows = ((PTG.masters && PTG.masters.orderChannel) || []).filter(r => r && r.active !== false && (r.code || r.desc));
  let list = rows.map(r => ({ code: String(r.code || r.desc).trim().toUpperCase(), name: String(r.desc || r.code).trim() }));
  if (!list.length) list = [{ code: 'AMZ', name: 'Amazon' }, { code: 'SPY', name: 'Shopify' },
    { code: 'ONL', name: 'Online' }, { code: 'B2B', name: 'B2B' }];
  const seen = new Set();
  // LEG-, PRD-, ADJ- belong to other order namespaces; a channel using one would collide with them.
  return list.filter(c => c.code && SO_RESERVED_PREFIXES.indexOf(c.code) < 0 && !seen.has(c.code) && seen.add(c.code));
}

const soDateTag = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + m[2] + m[1] : ''; };

/** The next free number for this channel and date, checked against every order number in use. */
function soGenId(channel, dateISO, ignoreId) {
  const ch = String(channel || '').trim().toUpperCase(), tag = soDateTag(dateISO);
  if (!ch || !tag) return '';
  const prefix = ch + '-' + tag + '-';
  const taken = new Set();
  (SOX.rows || []).forEach(s => { if (s && s._id && s._id !== ignoreId) taken.add(obUC(s._id)); });
  (PTG.ob || []).forEach(r => { if (r && r.orderNo) taken.add(obUC(r.orderNo)); });
  let n = 1;
  taken.forEach(id => { if (id.indexOf(prefix) === 0) { const s = parseInt(id.slice(prefix.length), 10); if (s >= n) n = s + 1; } });
  let id;
  do { id = prefix + String(n).padStart(2, '0'); n++; } while (taken.has(id));
  return id;
}

/**
 * THE NUMBER, CHECKED AGAINST THE DATABASE AND NOT ONLY THIS SCREEN'S COPY (2026-10-01). soGenId counts the orders
 * this page read when it opened, so two people raising the same channel on the same day both got "-01", and the
 * second save replaced the first order without a word. One fresh read of that number moves to the next free one.
 * A failed read keeps the number, as before — it never blocks a save.
 */
async function soFreeId(id, channel, orderDate, ignoreId) {
  for (let i = 0; i < 20 && id; i++) {
    let there = null;
    try { there = await ptGet('pt_salesOrders/' + id); } catch (e) { return id; }
    if (!there || typeof there !== 'object' || !Object.keys(there).length) return id;
    SOX.rows = SOX.rows || [];
    if (!SOX.rows.some(o => o && o._id === id)) SOX.rows.push(Object.assign({}, there, { _id: id }));
    id = soGenId(channel, orderDate, ignoreId);
  }
  return id;
}

/** What is on order for a SKU today. A negative line is a correction and needs something to subtract from. */
/**
 * WHAT HAS ALREADY BEEN DONE against one order and one SKU, and the number the order may not go
 * below.
 *
 * THE LARGEST OF THE THREE, NOT THE SUM: they are three views of the same pieces walking through
 * the factory, and adding them would say 300 pieces exist where 100 do.
 *
 * Finished goods are deliberately not a fourth. A piece reaches the store by being pressed, so
 * pressed already covers it — and the finished-goods ledger would have to be loaded on a screen that
 * does not otherwise need it, to change an answer it cannot change.
 */
function soDoneOn(orderNo, sku) {
  const cut = obCutQty(orderNo, sku);
  const b = obBaseIndex().get(obKeyOf(orderNo, sku));
  const made = b ? b.received : 0;
  const pressed = obPressQty(orderNo, sku);
  return { cut, made, pressed, floor: Math.max(cut, made, pressed) };
}

/** The lines of one order that carry one SKU, with where each sits in the stored array. */
const soLinesOf = (o, sku) => soLines(o)
  .map((l, i) => ({ l, i }))
  .filter(x => obUC(x.l.sku) === obUC(sku));

/** What this order says it wants of one SKU today. */
const soQtyOf = (o, sku) => soLinesOf(o, sku).reduce((a, x) => a + (parseFloat(x.l.qty) || 0), 0);

/** The order-book row an approved sales order writes for one SKU — the id soApproveRun uses. */
const soBookId = (orderNo, sku) => 'ob_so_' + obUC(orderNo) + '_' + obUC(sku);

function soCurrentNetQty(sku, typeKey) {
  const S = obUC(sku), tk = typeKey === 'newdev' ? 'newdev' : 'regular';
  let net = 0;
  (SOX.rows || []).filter(s => s.status === 'approved').forEach(s => {
    const headerKey = s.orderTypeKey === 'newdev' ? 'newdev' : 'regular';
    soLines(s).forEach(l => {
      if (obUC(l.sku) !== S) return;
      const ltk = (l.orderTypeKey === 'newdev' || l.orderTypeKey === 'regular') ? l.orderTypeKey : headerKey;
      if (ltk === tk) net += parseFloat(l.qty) || 0;
    });
  });
  return net;
}

const soMine = o => String(o.buyerEmail || '').toLowerCase() === String(ME.email || '').toLowerCase();
/** A buyer edits their own order only while it is a draft or has come back to them. */
const soCanEdit = o => !o || ME.admin || (soMine(o) && (soStatus(o) === 'draft' || soStatus(o) === 'returned'));

/**
 * Where a change has got to. A record written before this existed applied on the spot, so it is
 * applied — reading those as pending would ask the floor to approve what is already on a machine.
 */
const soQtyStage = a => String((a && a.stage) || 'applied');

/**
 * MOVE A SKU'S QUANTITY ON AN ORDER THAT IS ALREADY OUT — the sales order and the order book together.
 *
 * Returns a plan rather than writing, so the dialog can show exactly what would happen before it
 * happens: which lines move, what the book row becomes, and why it is refused when it is.
 */
function soQtyPlan(o, sku, want, exceptId) {
  if (!o) return { err: 'That order is gone.' };
  if (soStatus(o) !== 'approved') return { err: 'Only an approved order has anything in the order book to change. Edit a draft on the order itself.' };
  const mine = soLinesOf(o, sku);
  if (!mine.length) return { err: 'That SKU is not on this order.' };
  const now = soQtyOf(o, sku);
  const n = parseFloat(want);
  if (!isFinite(n) || n < 0) return { err: 'What should the new quantity be?' };
  if (Math.round(n) !== n) return { err: 'Pieces have to be a whole number.' };
  if (n === now) return { err: 'That is what it already says.' };
  /* ONE ASK AT A TIME PER LINE. Two requests waiting on the same SKU, one saying 80 and one saying
   * 120, is two different answers and whichever is approved second would quietly undo the first. */
  /* NOT COUNTING THE ONE BEING ANSWERED. Approving re-runs this plan, and a request that refused
   * itself for being a request is a request nobody can ever grant. */
  const waiting = Object.values(o.qtyAdjustments || {})
    .find(a => a && a.id !== exceptId && obUC(a.sku) === obUC(sku) && soQtyStage(a) === 'pending');
  if (waiting) return { err: 'A change to ' + nf(waiting.to) + ' is already waiting for production to approve. '
    + 'They have to answer that one first.' };
  const done = soDoneOn(o._id, sku);
  /* THE FLOOR. Reducing below what is already made does not un-make it — it leaves the registers
   * describing pieces on the floor as pieces nobody ordered. */
  if (n < done.floor) {
    const which = [done.cut === done.floor && 'cut', done.made === done.floor && 'received',
      done.pressed === done.floor && 'pressed'].filter(Boolean).join(' / ');
    return { err: nf(done.floor) + ' piece(s) have already been ' + which + ' against this order, so it '
      + 'cannot go below ' + nf(done.floor) + '. Set it to ' + nf(done.floor) + ' to close it at what was made.' };
  }
  /* WHERE IT LANDS. Extra onto the latest promise; a cut off the latest first, so the earliest
   * delivery date keeps its pieces. */
  const order = mine.slice().sort((a, b) =>
    String(a.l.deliveryDate || '').localeCompare(String(b.l.deliveryDate || '')) || a.i - b.i);
  const moves = [];
  let delta = n - now;
  if (delta > 0) {
    const last = order[order.length - 1];
    moves.push({ i: last.i, from: parseFloat(last.l.qty) || 0, to: (parseFloat(last.l.qty) || 0) + delta });
  } else {
    let cut = -delta;
    for (let j = order.length - 1; j >= 0 && cut > 0; j--) {
      const q = parseFloat(order[j].l.qty) || 0;
      const take = Math.min(q, cut);
      if (!take) continue;
      cut -= take;
      moves.push({ i: order[j].i, from: q, to: q - take });
    }
  }
  const book = (PTG.ob || []).find(r => r && r.id === soBookId(o._id, sku));
  return { err: '', sku: obUC(sku), from: now, to: n, delta: n - now, done, moves,
    book: book ? (parseFloat(book.qty) || 0) : null };
}

/**
 * ASK FOR A QUANTITY TO CHANGE. It does not change anything.
 *
 * The sales-order line and the order book both stay exactly where they are until somebody on the
 * floor approves it — the same way a sales order does nothing until it is approved. The plan is run
 * here only to refuse an ask that could never be granted, so nobody waits on an answer of no.
 */
async function soQtyRun(o, sku, want, why) {
  if (!soCanApprove()) return SO_NO_APPROVE;
  const plan = soQtyPlan(o, sku, want);
  if (plan.err) return plan.err;
  const reason = String(why || '').trim();
  /* A CHANGE WITH NO REASON IS THE ONE NOBODY CAN EXPLAIN LATER. */
  if (!reason) return 'Say why it is changing — it goes on the order beside the figure.';
  const now = new Date().toISOString();
  /* PADDED SO IT SORTS AS A NUMBER, and strictly after everything the order already holds. Two asks
   * in one millisecond tie on `at`, and then five random characters decide which reads as the later
   * one — which is the order somebody answers them in. The bulk writer has always done this. */
  const logId = 'adj_' + Date.now() + '_'
    + String(Object.keys(o.qtyAdjustments || {}).length).padStart(4, '0') + '_'
    + Math.random().toString(36).slice(2, 6);
  const log = { id: logId, sku: plan.sku, from: plan.from, to: plan.to, why: reason,
    by: ME.email, at: now, stage: 'pending' };
  const base = 'pt_salesOrders/' + o._id + '/';
  const patch = { [base + 'qtyAdjustments/' + logId]: log, [base + 'updatedAt']: now };
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const adj = Object.assign({}, o.qtyAdjustments || {});
  adj[logId] = patch[base + 'qtyAdjustments/' + logId];
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id
    ? Object.assign({}, x, { qtyAdjustments: adj, updatedAt: patch[base + 'updatedAt'] }) : x));
  return '';
}

/* ---- B2B ---- */
const soIsB2B = ch => String(ch || '').trim().toUpperCase() === 'B2B';
/* ONLINE takes a SKU the master does not have: it goes on the Custom SKUs list when the order is saved (2026-09-30). */
const soIsOnl = ch => String(ch || '').trim().toUpperCase() === 'ONL';
/** What a SKU the master lacks probably is, from the master SKUs it looks like: { articleType, subtype, color, size }. */
function soGuessOf(sku) {
  const g = (typeof skuLookalike === 'function' ? skuLookalike(sku) : null) || {};
  const pa = !g.articleType && typeof ptCustomPrefixArt === 'function' ? ptCustomPrefixArt(sku) : null;
  return { articleType: g.articleType || (pa && pa.articleType) || '', subtype: g.subtype || (pa && pa.subtype) || '',
    color: g.color || '', size: g.size || '' };
}
/** What a B2B line carries beyond SKU and quantity. */
const SO_B2B_KEYS = ['brand', 'img', 'itemName', 'label', 'material', 'size', 'customization', 'extra'];
/** Ravi's sheet, column by column, with the names people actually type. */
const SO_B2B_COLS = [
  { k: 'brand', t: 'Brand Name', alias: ['brand name', 'brand'] },
  { k: 'img', t: 'Image Link', alias: ['image link', 'image', 'image url', 'photo', 'picture'] },
  { k: 'sku', t: 'SKU', alias: ['sku'] },
  { k: 'itemName', t: 'Item Name', alias: ['item name', 'item', 'product name', 'product'] },
  { k: 'label', t: 'LABEL', alias: ['label', 'label details'] },
  { k: 'material', t: 'Material', alias: ['material', 'fabric'] },
  { k: 'size', t: 'Size', alias: ['size'] },
  { k: 'qty', t: 'Qty', alias: ['qty', 'quantity'] },
  { k: 'customization', t: 'Customization', alias: ['customization', 'customisation', 'custom', 'customization details', 'customisation details'] },
  { k: 'deliveryDate', t: 'Delivery Date', alias: ['delivery date'] },
];
/** A code for a B2B item that has none: the brand's initials, CUST, the date, a free number. */
function soB2BMint(brand, taken) {
  const words = String(brand || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const p = (words.length > 1 ? words.map(w => w[0]).join('') : (words[0] || '')).slice(0, 4) || 'B2B';
  const d = new Date();
  const tag = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const pre = p + '-CUST-' + tag + '-';
  const used = new Set([...(PTG.mdb || []).map(r => obUC(r && r.sku)), ...(taken || [])].filter(Boolean));
  let n = 1;
  used.forEach(s => { if (s.indexOf(pre) === 0) { const k = parseInt(s.slice(pre.length), 10); if (k >= n) n = k + 1; } });
  let sku;
  do { sku = pre + String(n).padStart(2, '0'); n++; } while (used.has(sku));
  return sku;
}
/** What the form says under a B2B SKU. */
function soB2BMeta(sku) {
  const s = obUC(sku);
  if (!s) return '<span class="muted">a code is given on save — Custom SKUs list</span>';
  const m = (PTG.mdb || []).find(r => r && obUC(r.sku) === s);
  return m ? esc([m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">in the master DB</span>'
    : '<span style="color:#7f6000;font-weight:600">new — goes on the Custom SKUs list</span>';
}

/* ---- the form ---- */
let SOF = { id: null, lines: [], page: 0 };
const SOF_PAGE = 200;

function soSkuMeta(sku) {
  const s = obUC(sku);
  if (!s) return { html: '<span class="muted">—</span>', ok: false };
  const m = (PTG.mdb || []).find(r => r && obUC(r.sku) === s);
  if (!m && soIsOnl(($('sof_channel') || {}).value)) {
    const g = soGuessOf(s), what = [g.subtype || g.articleType, g.color, g.size].filter(Boolean).join(' · ');
    return { html: '<span style="color:#7f6000;font-weight:600">new — goes on the Custom SKUs list</span>' + (what ? ' · ' + esc(what) : ''), ok: true };
  }
  return m
    ? { html: esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">in the master DB</span>', ok: true }
    : { html: '<span class="miss">not in master</span>', ok: false };
}

function soFormOpen(id) {
  const editing = (SOX.rows || []).find(x => x._id === id) || null;
  if (id && !editing) return;
  const canEdit = soCanEdit(editing);
  const today = dToday();
  const o = editing || { _id: '', orderDate: today, orderTypeKey: 'regular', deliveryMode: 'complete', deliveryDate: '', lines: [], status: 'draft' };
  SOF = { id: editing ? editing._id : null, page: 0,
    lines: soLines(o).map(l => Object.assign({ sku: l.sku || '', qty: l.qty == null ? '' : l.qty, deliveryDate: l.deliveryDate || '',
      orderTypeKey: l.orderTypeKey || o.orderTypeKey || 'regular', priority: l.priority || '' },
      SO_B2B_KEYS.reduce((a, k) => { if (l[k] != null && l[k] !== '') a[k] = l[k]; return a; }, {}))) };
  if (!SOF.lines.length) SOF.lines = [{ sku: '', qty: '', deliveryDate: '', orderTypeKey: 'regular', priority: '' }];

  const ro = canEdit ? '' : ' disabled';
  const chans = soChannels();
  const nd = o.orderTypeKey === 'newdev';
  /* ONE ROW: channel, date, type, delivery, reference. Order type is two buttons — there are only two
   * answers — with the value kept in sof_type, which is what the save reads. A <div>, not a <label>:
   * a label forwards every click inside it to its first button. */
  const head = `<div class="sof-grid">
    <label>Channel<select id="sof_channel"${ro}>
      <option value="">— pick one —</option>
      ${chans.map(c => `<option value="${esc(c.code)}"${o.channel === c.code ? ' selected' : ''}>${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
    </select></label>
    <label>Order date<input id="sof_date" type="date" value="${esc(o.orderDate || today)}"${ro}></label>
    <div class="sof-f">Order type<input id="sof_type" type="hidden" value="${nd ? 'newdev' : 'regular'}">
      <div class="sof-seg" role="group" aria-label="Order type">
        <button type="button" data-softype="regular" class="${nd ? '' : 'on'}"${ro}>Regular</button>
        <button type="button" data-softype="newdev" class="${nd ? 'on' : ''}"${ro}>New development</button>
      </div></div>
    <label>Delivery<input id="sof_delivery" type="date" value="${esc(o.deliveryDate || '')}"${ro}></label>
    <label>Reference<input id="sof_legacy" type="text" value="${esc(o.legacyOrderId || '')}" placeholder="optional"${ro}></label>
  </div>`;

  /* What the paragraph beside these buttons used to say is their tooltip now. */
  const tools = `<div class="sof-bar"><span class="sof-h">Order lines</span><span style="flex:1"></span>${canEdit ? `
      <button id="sof_add" class="ghost" type="button">+ Add line</button>
      <button id="sof_tmpl" class="ghost" type="button" title="A file to fill in: SKU, quantity, delivery date.">Template</button>
      <button id="sof_up" class="ghost" type="button" title="A file replaces or adds to the lines below. One unknown SKU rejects the whole file. A negative quantity subtracts from what is already on order.">Upload</button>
      <input id="sof_file" type="file" accept=".csv,.xlsx,text/csv" style="display:none">` : ''}
    </div>`;

  ptOpenDialog({
    title: editing ? (canEdit ? 'Edit order' : 'Order') : 'New sales order',
    wide: true,
    titleExtra: '<span id="sof_id" class="sof-no none">—</span>',
    footLeft: '<span id="sof_tot" class="sof-tot"></span>',
    altPrimary: true,
    saveLabel: canEdit ? 'Save draft' : '',
    /* Only what is true of THIS order. The standing sentence about drafts and approval is gone. */
    subtitle: editing
      ? `${(SO_STATUS[soStatus(editing)] || {}).label || soStatus(editing)}`
        + `${editing.buyerName ? '  ·  raised by ' + editing.buyerName : ''}`
      : '',
    note: !canEdit
      ? 'This order is not yours to change: a buyer may edit their own order only while it is a draft or has been returned to them.'
      : (editing && soStatus(editing) === 'returned' && editing.saRemarks
        ? 'Returned to you: ' + editing.saRemarks
        : ''),
    html: head + tools
      + `<div class="sof-lines"><table class="sof-t" id="sof_table"></table></div>`
      + `<div id="sof_pager" class="muted" style="margin-top:8px;font-size:12px"></div>`,
    onSave: canEdit ? (() => soFormSave(false)) : null,
    alt: canEdit ? { label: editing && soStatus(editing) === 'draft' ? 'Place order' : (editing ? 'Place order' : 'Place order'),
      run: () => soFormSave(true) } : null,
    onDelete: editing && ME.admin ? (() => soDeleteOrder(editing._id)) : null,
    deleteWhat: editing ? `Sales order ${editing._id} · ${nf(soLines(editing).length)} line(s)`
      + (soStatus(editing) === 'approved' ? ' · its order-book lines are NOT removed with it' : '') : '',
  });
  soFormLines();
  soIdPreview();
  if (canEdit) {
    ['sof_channel', 'sof_date'].forEach(i => $(i).addEventListener('change', soIdPreview));
    /* B2B lines have their own columns: the table follows the channel. */
    $('sof_channel').addEventListener('change', () => soFormLines());
    $('sof_add').onclick = () => { SOF.lines.push({ sku: '', qty: '', deliveryDate: '', orderTypeKey: $('sof_type').value, priority: '' });
      SOF.page = Math.floor((SOF.lines.length - 1) / SOF_PAGE); soFormLines(); };
    $('sof_tmpl').onclick = soTemplate;
    $('sof_up').onclick = () => $('sof_file').click();
    $('sof_file').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) soBulkFile(f); e.target.value = ''; };
  }
}

function soIdPreview() {
  const el = $('sof_id'); if (!el) return;
  const o = (SOX.rows || []).find(x => x._id === SOF.id);
  // Once an order is placed its number is on cutting slips and press entries. It never moves again.
  /* A CHIP BESIDE THE TITLE. What each state means is its tooltip, not a sentence on the form. */
  const put = (txt, tip, none) => { el.textContent = txt; el.title = tip; el.className = 'sof-no' + (none ? ' none' : ''); };
  if (o && soStatus(o) !== 'draft' && soStatus(o) !== 'returned')
    return put(o._id, 'Fixed now that the order has been placed.');
  const ch = ($('sof_channel') || {}).value || '', dt = ($('sof_date') || {}).value || '';
  if (!ch || !dt) return put('Order no. —', 'Pick a channel and an order date.', true);
  const cur = o ? o._id : '';
  const pfx = ch.toUpperCase() + '-' + soDateTag(dt) + '-';
  if (cur && obUC(cur).indexOf(pfx) === 0) return put(cur, 'This order\'s number.');
  put(soGenId(ch, dt, cur), 'Claimed when you save.');
}

function soFormLines() {
  const total = SOF.lines.length;
  const pages = Math.max(1, Math.ceil(total / SOF_PAGE));
  if (SOF.page > pages - 1) SOF.page = pages - 1;
  const from = SOF.page * SOF_PAGE, slice = SOF.lines.slice(from, from + SOF_PAGE);
  const ro = !soCanEdit((SOX.rows || []).find(x => x._id === SOF.id) || null);
  const d = ro ? ' disabled' : '';
  if ($('sof_up')) $('sof_up').title = soIsB2B(($('sof_channel') || {}).value)
    ? 'B2B: Template gives the buyer columns. A SKU not in the Master Database, or a blank one, goes on the Custom SKUs list with its brand. Any extra column in the file is kept on the line.'
    : 'A file replaces or adds to the lines below. One unknown SKU rejects the whole file. A negative quantity subtracts from what is already on order.';
  soFormTotals();
  if (soIsB2B(($('sof_channel') || {}).value)) {
    const inp = (i, f, l, w, ph) => `<input data-sof="${f}" data-i="${i}" value="${esc(l[f] == null ? '' : l[f])}" placeholder="${ph || ''}"${d} style="width:${w}px">`;
    $('sof_table').innerHTML = '<thead><tr>'
      + ['#', 'Image', 'Brand', 'SKU', 'Item name', 'Label', 'Material', 'Size', 'Customization', 'Qty', 'Delivery', ''].map((h, i) =>
        `<th${i === 9 ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>'
      + slice.map((l, k) => {
        const i = from + k;
        const extra = l.extra && Object.keys(l.extra).length ? Object.entries(l.extra).map(([a, b]) => a + ': ' + b).join(' · ') : '';
        return `<tr><td class="muted">${i + 1}</td>`
          + `<td style="padding:3px 6px">${l.img ? `<img src="${esc(l.img)}" alt="" loading="lazy" style="width:40px;height:40px;object-fit:cover;border-radius:6px;display:block;margin-bottom:2px">` : ''}${inp(i, 'img', l, 110, 'image link')}</td>`
          + `<td>${inp(i, 'brand', l, 110, 'brand')}</td>`
          + `<td><input data-sof="sku" data-i="${i}" value="${esc(l.sku)}" placeholder="blank = new code"${d} style="width:140px;font-family:ui-monospace,monospace;text-transform:uppercase">`
          + `<div id="sof_meta_${i}" style="font-size:10.5px;text-align:left">${soB2BMeta(l.sku)}</div></td>`
          + `<td>${inp(i, 'itemName', l, 160, 'item name')}</td>`
          + `<td>${inp(i, 'label', l, 120, 'No, or the details')}</td>`
          + `<td>${inp(i, 'material', l, 100, 'material')}</td>`
          + `<td>${inp(i, 'size', l, 80, 'size')}</td>`
          + `<td>${inp(i, 'customization', l, 140, 'No, or the details')}${extra ? `<div class="muted" style="font-size:10.5px;max-width:160px;white-space:normal">${esc(extra)}</div>` : ''}</td>`
          + `<td class="num"><input data-sof="qty" data-i="${i}" type="number" step="1" min="0" value="${esc(l.qty)}"${d} style="width:80px;text-align:right"></td>`
          + `<td><input data-sof="deliveryDate" data-i="${i}" type="date" value="${esc(l.deliveryDate)}"${d}></td>`
          + `<td>${ro ? '' : `<button class="ghost" data-sofdel="${i}" style="padding:2px 8px;color:var(--bad)">✕</button>`}</td></tr>`;
      }).join('') + '</tbody>';
    $('sof_pager').innerHTML = pages > 1 ? `Showing ${nf(from + 1)}–${nf(Math.min(total, from + SOF_PAGE))} of ${nf(total)}
          <button class="ghost" data-sofpg="-1" style="padding:2px 10px"${SOF.page ? '' : ' disabled'}>Back</button>
          <button class="ghost" data-sofpg="1" style="padding:2px 10px"${SOF.page >= pages - 1 ? ' disabled' : ''}>Next</button>` : '';
    return;
  }
  /* ONE ROW PER LINE THAT FITS: the picture, the SKU and what it is share a cell, so nothing is left
   * off the right-hand edge — the old table scrolled sideways and hid Qty and Delivery. */
  $('sof_table').innerHTML = '<thead><tr>'
    + ['#', 'Product', 'Type', 'Priority', 'Qty', 'Delivery', ''].map((h, i) =>
      `<th${i === 4 ? ' class="num"' : ''}${i === 0 ? ' style="width:36px"' : ''}>${h}</th>`).join('') + '</tr></thead><tbody>'
    + slice.map((l, k) => {
      const i = from + k, meta = soSkuMeta(l.sku);
      return `<tr${obUC(l.sku) && !meta.ok ? ' class="bad"' : ''}><td class="muted">${i + 1}</td>`
        + `<td><div class="sof-prod"><span id="sof_img_${i}">${soThumb(l.sku)}</span><div style="min-width:0">`
        + `<input class="sof-sku" data-sof="sku" data-i="${i}" value="${esc(l.sku)}" placeholder="SKU"${d}>`
        + `<div id="sof_meta_${i}" class="sof-meta">${meta.html}</div></div></div></td>`
        + `<td><select data-sof="orderTypeKey" data-i="${i}"${d}>`
        + `<option value="regular"${l.orderTypeKey !== 'newdev' ? ' selected' : ''}>Regular</option>`
        + `<option value="newdev"${l.orderTypeKey === 'newdev' ? ' selected' : ''}>New dev</option></select></td>`
        + `<td><select data-sof="priority" data-i="${i}"${d}><option value="">—</option>`
        + ['P1', 'P2', 'P3', 'P4'].map(p => `<option value="${p}"${l.priority === p ? ' selected' : ''}>${p}</option>`).join('')
        + `</select></td>`
        + `<td class="num"><input class="sof-qty" data-sof="qty" data-i="${i}" type="number" step="1" value="${esc(l.qty)}"${d}`
        + ` title="Positive adds. Negative subtracts from what is already on order."></td>`
        + `<td><input data-sof="deliveryDate" data-i="${i}" type="date" value="${esc(l.deliveryDate)}"${d}></td>`
        + `<td>${ro ? '' : `<button class="sof-del" type="button" data-sofdel="${i}" aria-label="Remove line ${i + 1}" title="Remove this line">×</button>`}</td></tr>`;
    }).join('') + '</tbody>';

  $('sof_pager').innerHTML = pages > 1 ? `Showing ${nf(from + 1)}–${nf(Math.min(total, from + SOF_PAGE))} of ${nf(total)}
        <button class="ghost" data-sofpg="-1" style="padding:2px 10px"${SOF.page ? '' : ' disabled'}>Back</button>
        <button class="ghost" data-sofpg="1" style="padding:2px 10px"${SOF.page >= pages - 1 ? ' disabled' : ''}>Next</button>` : '';
}

/** The product's picture, or an empty tile of the same size — never a word where a picture goes. */
function soThumb(sku) {
  const u = obUC(sku) ? ptImgOf(sku) : '';
  return u ? `<img class="sof-th" src="${esc(ptImgSrc(u, 44))}" alt="" loading="lazy">` : '<span class="sof-th"></span>';
}

/** Lines and pieces, in the footer, as they are typed. A line counts once anything is on it — a B2B
 * line may have no SKU yet (it is given one), but it has a quantity or a name. */
function soFormTotals() {
  const el = $('sof_tot'); if (!el || !SOF) return;
  const lines = (SOF.lines || []).filter(l => obUC(l.sku) || String(l.qty == null ? '' : l.qty).trim() || String(l.itemName || '').trim());
  const pcs = lines.reduce((a, l) => a + (parseFloat(l.qty) || 0), 0);
  el.innerHTML = `<span>${nf(lines.length)} line${lines.length === 1 ? '' : 's'}</span><span>${nf(pcs)} pcs</span>`;
}

/* One listener on the dialog body, so re-rendering the table never leaves a dead handler behind. */
$('ptDlgBody').addEventListener('input', e => {
  const el = e.target.closest('[data-sof]'); if (!el) return;
  const i = +el.getAttribute('data-i'), f = el.getAttribute('data-sof');
  SOF.lines[i][f] = el.value;
  // Only this row's meta cell is redrawn — redrawing the table would take the focus out of the box.
  if (f === 'sku' && $('sof_meta_' + i)) {
    const b2b = soIsB2B(($('sof_channel') || {}).value), meta = b2b ? null : soSkuMeta(el.value);
    $('sof_meta_' + i).innerHTML = b2b ? soB2BMeta(el.value) : meta.html;
    if (!b2b && $('sof_img_' + i)) $('sof_img_' + i).innerHTML = soThumb(el.value);
    const tr = el.closest && el.closest('tr');
    if (tr && !b2b) tr.classList.toggle('bad', !!obUC(el.value) && !meta.ok);
  }
  if (f === 'sku' || f === 'qty') soFormTotals();
});
$('ptDlgBody').addEventListener('change', e => {
  const el = e.target.closest('[data-sof]'); if (!el) return;
  SOF.lines[+el.getAttribute('data-i')][el.getAttribute('data-sof')] = el.value;
});
$('ptDlgBody').addEventListener('click', e => {
  /* Order type is two buttons; the value the save reads is kept in sof_type. */
  const ty = e.target.closest('[data-softype]');
  if (ty && !ty.disabled) {
    if ($('sof_type')) $('sof_type').value = ty.getAttribute('data-softype');
    [...ty.parentNode.children].forEach(b => b.classList.toggle('on', b === ty));
    return;
  }
  /* The SKU table lives inside the order's own dialog, so this one replaces it with the quantity
   * dialog and the order is reopened underneath when that is done with. */
  const q = e.target.closest('[data-so-qty]');
  if (q) { const [id, sku] = q.getAttribute('data-so-qty').split('|'); return soQtyOpen(id, sku); }
  const del = e.target.closest('[data-sofdel]');
  if (del) {
    SOF.lines.splice(+del.getAttribute('data-sofdel'), 1);
    if (!SOF.lines.length) SOF.lines = [{ sku: '', qty: '', deliveryDate: '', orderTypeKey: 'regular', priority: '' }];
    soFormLines(); return;
  }
  const pg = e.target.closest('[data-sofpg]');
  if (pg) { SOF.page += +pg.getAttribute('data-sofpg'); soFormLines(); }
});

/* ---- lines from a file ---- */
function soTemplate() {
  if (soIsB2B(($('sof_channel') || {}).value)) {
    ptDownload('b2b-order-lines', [
      SO_B2B_COLS.map(c => c.t).map(csvCell).join(','),
      ['Crate & Barrel', 'https://example.com/photo.jpg', 'RTC23-6060', 'Square Tablecloth Indigo', 'Yes - woven brand label at hem', 'Cotton cambric', '60x60', 120, 'No', '10-11-2026'].map(csvCell).join(','),
      ['Crate & Barrel', '', '', 'Napkin set of 4 with embroidery', 'No', 'Linen', '20x20', 300, 'Yes - logo embroidered in corner', ''].map(csvCell).join(','),
      [].join(','),
      ['A SKU not in the Master Database goes on the Custom SKUs list with its brand. A blank SKU is given a code.'].map(csvCell).join(','),
      ['Label and Customization: write No, or the details. Any other column you add is kept on the line.'].map(csvCell).join(','),
      ['Order date, order type and channel are picked on the form; Delivery Date is optional, DD-MM-YYYY.'].map(csvCell).join(','),
    ]);
    return;
  }
  ptDownload('sales-order-lines', [
    ['SKU', 'Qty', 'Priority', 'Order Type', 'Order Date', 'Delivery Date', 'Legacy Order ID'].map(csvCell).join(','),
    ['RPC72-1818', 100, 'P1', 'Regular', '25-05-2026', '10-06-2026', 'OLD-SYS-2041'].map(csvCell).join(','),
    ['CPCC004', 50, 'P3', 'New Development', '25-05-2026', '25-06-2026', ''].map(csvCell).join(','),
    [].join(','),
    ['Order Date must be the SAME on every row, and both dates are DD-MM-YYYY.'].map(csvCell).join(','),
    ['Order Type is "Regular" or "New Development". Priority is blank or P1-P4.'].map(csvCell).join(','),
    ['Legacy Order ID is your own reference only — this app always assigns the real order number.'].map(csvCell).join(','),
  ]);
}

const soNormType = v => {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (['regular', 'reg', 'r'].indexOf(s) >= 0) return 'regular';
  if (['new development', 'new dev', 'newdev', 'development', 'dev', 'nd'].indexOf(s) >= 0) return 'newdev';
  return null;
};

/** DD-MM-YYYY to ISO, with a real calendar check — 31-02-2026 is not a date. */
function soParseDMY(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (!m) return null;
  let d = +m[1], mo = +m[2], y = +m[3];
  if (m[3].length === 2) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

async function soBulkFile(file) {
  ptDlgMsg('Reading ' + file.name + '…');
  let rows;
  try { rows = await pkReadFile(file); }
  catch (e) { ptDlgMsg('Could not read that file: ' + (e.message || e), true); return; }
  if (soIsB2B(($('sof_channel') || {}).value)) return soB2BFile(file, rows);
  const head = (rows[0] || []).map(h => String(h || '').trim());
  const ix = {
    sku: colIdx(head.map(h => h.toLowerCase()), ['sku']),
    qty: colIdx(head.map(h => h.toLowerCase()), ['qty', 'quantity']),
    pr: colIdx(head.map(h => h.toLowerCase()), ['priority', 'priority tier']),
    ot: colIdx(head.map(h => h.toLowerCase()), ['order type', 'ordertype', 'type']),
    od: colIdx(head.map(h => h.toLowerCase()), ['order date', 'orderdate']),
    dd: colIdx(head.map(h => h.toLowerCase()), ['delivery date', 'deliverydate']),
    lg: colIdx(head.map(h => h.toLowerCase()), ['legacy order id', 'legacy order Id', 'legacy id']),
  };
  if (ix.sku < 0 || ix.qty < 0) { ptDlgMsg('That file has no SKU and Qty columns. Download the template to see the shape.', true); return; }

  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const onl = soIsOnl(($('sof_channel') || {}).value), newSkus = new Set();
  const parsed = [], errors = [], dates = new Set();
  let legacy = '';
  rows.slice(1).forEach((r, n) => {
    const at = i => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '');
    const sku = obUC(at(ix.sku)), qtyRaw = at(ix.qty), otRaw = at(ix.ot), odRaw = at(ix.od), ddRaw = at(ix.dd);
    if (!sku && !qtyRaw && !otRaw && !odRaw && !ddRaw) return;          // a blank row is not an error
    const row = 'Row ' + (n + 2) + ': ';
    if (at(ix.lg) && !legacy) legacy = at(ix.lg);
    if (!sku) { errors.push(row + 'no SKU.'); return; }
    const qty = parseFloat(qtyRaw) || 0;
    if (!qty) { errors.push(row + 'the quantity is zero or missing for ' + sku + '. Positive adds, negative subtracts.'); return; }
    const ot = soNormType(otRaw);
    if (!ot) { errors.push(row + 'order type must be "Regular" or "New Development" for ' + sku + (otRaw ? ', not "' + otRaw + '".' : ', and it is blank.')); return; }
    const od = soParseDMY(odRaw);
    if (!od) { errors.push(row + 'the order date must be DD-MM-YYYY for ' + sku + (odRaw ? ', not "' + odRaw + '".' : ', and it is blank.')); return; }
    const dd = soParseDMY(ddRaw);
    if (!dd) { errors.push(row + 'the delivery date must be DD-MM-YYYY for ' + sku + (ddRaw ? ', not "' + ddRaw + '".' : ', and it is blank.')); return; }
    /* ONLINE takes a SKU the master lacks — it goes on the Custom SKUs list when the order is saved (2026-09-30). */
    if (!known.has(sku) && !onl) { errors.push(row + sku + ' is not in the master database.'); return; }
    if (!known.has(sku)) newSkus.add(sku);
    if (qty < 0 && soCurrentNetQty(sku, ot) <= 0) { errors.push(row + sku + ' has nothing on order to subtract from.'); return; }
    dates.add(od);
    const pr = at(ix.pr).toUpperCase();
    parsed.push({ sku, qty, deliveryDate: dd, orderTypeKey: ot, priority: /^P[1-4]$/.test(pr) ? pr : '' });
  });
  if (dates.size > 1) errors.push('Every row must carry the same order date. This file has ' + dates.size + ': ' + [...dates].sort().join(', ') + '.');
  /* One bad row rejects the file. A part-loaded order is worse than none — nobody can tell what is missing. */
  if (errors.length) { ptDlgMsg('Nothing was loaded. ' + errors.slice(0, 6).join(' ')
    + (errors.length > 6 ? ' …and ' + nf(errors.length - 6) + ' more problem(s).' : ''), true); return; }
  if (!parsed.length) { ptDlgMsg('That file has no usable rows.', true); return; }

  if (dates.size === 1) $('sof_date').value = [...dates][0];
  if (legacy) $('sof_legacy').value = legacy;
  const real = SOF.lines.filter(l => String(l.sku || '').trim()).length;
  SOF.lines = real && confirm(`Add ${nf(parsed.length)} line(s) to the ${nf(real)} already here?\n\nOK adds them. Cancel replaces everything.`)
    ? SOF.lines.filter(l => String(l.sku || '').trim()).concat(parsed)
    : parsed;
  SOF.page = 0;
  soFormLines(); soIdPreview();
  ptDlgMsg(`Loaded ${nf(parsed.length)} line(s) from ${file.name}.`
    + (newSkus.size ? ` ${nf(newSkus.size)} SKU(s) are not in the master — they go on the Custom SKUs list when the order is saved.` : ''));
}

/**
 * Read a B2B sheet into lines. Columns by name; anything the sheet has beyond them is kept on the line.
 * One bad row rejects the file, as every other upload here does.
 */
function soB2BRows(rows) {
  const head = (rows[0] || []).map(h => String(h == null ? '' : h).trim());
  const low = head.map(h => h.toLowerCase());
  const at = {};
  SO_B2B_COLS.forEach(c => {
    let i = low.indexOf(c.t.toLowerCase());
    if (i < 0) for (const a of c.alias) { i = low.indexOf(a); if (i >= 0) break; }
    if (i < 0 && c.k === 'customization') i = low.findIndex(h => h.indexOf('custom') === 0);
    if (i >= 0) at[c.k] = i;
  });
  if (at.qty == null || (at.sku == null && at.itemName == null))
    return { err: 'That file needs a Qty column and a SKU or Item Name column. Download the B2B template to see the shape.' };
  const used = new Set(Object.values(at));
  const extraCols = head.map((h, i) => [h, i]).filter(([h, i]) => h && !used.has(i));
  const lines = [], errors = [];
  rows.slice(1).forEach((r, n) => {
    const cell = k => (at[k] == null ? '' : String(r[at[k]] == null ? '' : r[at[k]]).trim());
    if (!r.some(v => String(v == null ? '' : v).trim())) return;
    const where = 'Row ' + (n + 2) + ': ';
    const sku = obUC(cell('sku')), item = cell('itemName'), qtyRaw = cell('qty');
    if (!sku && !item) { errors.push(where + 'no SKU and no item name.'); return; }
    const qty = Number(qtyRaw);
    if (!(qty > 0) || !Number.isInteger(qty)) { errors.push(where + `the quantity for ${sku || item} must be a whole number above 0${qtyRaw ? ', not "' + qtyRaw + '"' : ''}.`); return; }
    let dd = '';
    if (cell('deliveryDate')) { dd = soParseDMY(cell('deliveryDate')); if (!dd) { errors.push(where + `the delivery date for ${sku || item} must be DD-MM-YYYY, not "${cell('deliveryDate')}".`); return; } }
    const extra = {};
    extraCols.forEach(([h, i]) => { const v = String(r[i] == null ? '' : r[i]).trim(); if (v) extra[h] = v; });
    const line = { sku, qty, deliveryDate: dd || '', orderTypeKey: ($('sof_type') || {}).value || 'regular', priority: '' };
    ['brand', 'img', 'itemName', 'label', 'material', 'size', 'customization'].forEach(k => { const v = cell(k); if (v) line[k] = v; });
    if (Object.keys(extra).length) line.extra = extra;
    lines.push(line);
  });
  return { lines, errors };
}
async function soB2BFile(file, rows) {
  const got = soB2BRows(rows);
  if (got.err) { ptDlgMsg(got.err, true); return; }
  if (got.errors.length) { ptDlgMsg('Nothing was loaded. ' + got.errors.slice(0, 6).join(' ') + (got.errors.length > 6 ? ' …and ' + nf(got.errors.length - 6) + ' more problem(s).' : ''), true); return; }
  if (!got.lines.length) { ptDlgMsg('That file has no usable rows.', true); return; }
  const real = SOF.lines.filter(l => String(l.sku || l.itemName || '').trim()).length;
  SOF.lines = real && confirm(`Add ${nf(got.lines.length)} line(s) to the ${nf(real)} already here?\n\nOK adds them. Cancel replaces everything.`)
    ? SOF.lines.filter(l => String(l.sku || l.itemName || '').trim()).concat(got.lines) : got.lines;
  SOF.page = 0;
  soFormLines(); soIdPreview();
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const fresh = got.lines.filter(l => !l.sku || !known.has(l.sku)).length;
  ptDlgMsg(`Loaded ${nf(got.lines.length)} line(s) from ${file.name}.` + (fresh ? ` ${nf(fresh)} are not in the Master Database and go on the Custom SKUs list when you save.` : ''));
}

/* ---- saving ---- */
async function soFormSave(place) {
  const orderDate = $('sof_date').value || '';
  if (!orderDate) return 'Pick the order date.';
  const channel = String($('sof_channel').value || '').trim().toUpperCase();
  if (!channel) return 'Pick the channel this order came in on.';
  const headerType = $('sof_type').value || 'regular';

  const b2b = soIsB2B(channel);
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  /* A B2B LINE WITH NO CODE IS GIVEN ONE, and keeps it: it is written back onto the form, so saving
   * twice does not mint twice. */
  if (b2b) {
    const minted = new Set();
    SOF.lines.forEach(l => {
      if (obUC(l.sku) || !String(l.itemName || '').trim() || !(parseFloat(l.qty) > 0)) return;
      l.sku = soB2BMint(l.brand, [...minted, ...SOF.lines.map(x => obUC(x.sku))]);
      minted.add(l.sku);
    });
  }
  const lines = SOF.lines.map(l => Object.assign({
    sku: obUC(l.sku), qty: parseFloat(l.qty) || 0, deliveryDate: l.deliveryDate || '',
    orderTypeKey: (l.orderTypeKey === 'newdev' || l.orderTypeKey === 'regular') ? l.orderTypeKey : headerType,
    priority: /^P[1-4]$/.test(l.priority || '') ? l.priority : '',
  }, b2b ? SO_B2B_KEYS.reduce((a, k) => { if (l[k] != null && l[k] !== '' && !(k === 'extra' && !Object.keys(l[k] || {}).length)) a[k] = k === 'extra' ? l[k] : String(l[k]).trim(); return a; }, {}) : {}))
    .filter(l => l.sku && l.qty !== 0);
  if (!lines.length) return b2b ? 'Add at least one line with a SKU or an item name, and a quantity.' : 'Add at least one line with a SKU and a quantity that is not zero.';
  if (b2b && lines.some(l => l.qty < 0)) return 'A B2B line is a quantity to make — it cannot be negative.';

  /* B2B: a code the master does not know is a new item for the Custom SKUs list, not a mistake. */
  const onl = soIsOnl(channel);
  const bad = (b2b || onl) ? [] : [...new Set(lines.filter(l => !known.has(l.sku)).map(l => l.sku))];
  if (bad.length) return `Not in the master database: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` and ${bad.length - 8} more` : ''}. Fix or remove those lines.`;
  /* A key with a dot or a slash in it cannot be written to this database at all. Better said here
   * than as a failed write halfway through the order book. */
  const unwritable = [...new Set(lines.filter(l => /[.$#\[\]\/]/.test(l.sku)).map(l => l.sku))];
  if (unwritable.length) return `These SKUs contain a character the production database cannot use in a key: ${unwritable.join(', ')}.`;
  const negBad = [...new Set(lines.filter(l => l.qty < 0 && soCurrentNetQty(l.sku, l.orderTypeKey) <= 0).map(l => l.sku))];
  if (negBad.length) return `A negative line subtracts from an existing order, and these have nothing on order: ${negBad.join(', ')}.`;

  const existing = (SOX.rows || []).find(x => x._id === SOF.id) || null;
  if (existing && !soCanEdit(existing)) return 'This order is no longer yours to change.';
  const now = new Date().toISOString();
  const rec = existing ? Object.assign({}, existing) : { _id: '', createdAt: now, createdBy: ME.email };

  const oldId = existing ? existing._id : '';
  const mayRenumber = !existing || soStatus(existing) === 'draft' || soStatus(existing) === 'returned';
  const wantPfx = channel + '-' + soDateTag(orderDate) + '-';
  if (!existing) rec._id = soGenId(channel, orderDate);
  else if (mayRenumber && obUC(oldId).indexOf(wantPfx) !== 0) rec._id = soGenId(channel, orderDate, oldId);
  if (!rec._id) return 'Could not work out the order number — check the channel and the order date.';
  if (rec._id !== oldId) rec._id = await soFreeId(rec._id, channel, orderDate, oldId);

  rec.channel = channel;
  rec.orderDate = orderDate;
  rec.legacyOrderId = String($('sof_legacy').value || '').trim();
  rec.orderTypeKey = headerType;
  rec.deliveryDate = $('sof_delivery').value || '';
  // A date on any line makes the whole order per-line; the approver confirms it either way.
  rec.deliveryMode = lines.some(l => l.deliveryDate) ? 'lines' : (existing && existing.deliveryMode ? existing.deliveryMode : 'complete');
  rec.lines = lines;
  rec.buyerEmail = existing ? existing.buyerEmail : ME.email;
  rec.buyerName = existing ? existing.buyerName : (ME.email || '').split('@')[0];
  rec.status = place ? 'submitted' : 'draft';
  if (place) { rec.submittedAt = now; rec.saRemarks = ''; }
  rec.updatedAt = now;

  await ptPut('pt_salesOrders/' + rec._id, rec);
  if (oldId && oldId !== rec._id) {
    // The draft renumbered. Its old node has to go, or the same order sits under two numbers.
    try { await ptDelete('pt_salesOrders/' + oldId); } catch (e) { /* already gone */ }
    SOX.rows = (SOX.rows || []).filter(s => s._id !== oldId);
  }
  const i = (SOX.rows || []).findIndex(s => s._id === rec._id);
  if (i >= 0) SOX.rows[i] = rec; else SOX.rows = (SOX.rows || []).concat(rec);

  // Priority tags are a SKU-wide master in this database, not a property of the line.
  const tags = {};
  lines.forEach(l => { if (l.priority) tags[l.sku] = l.priority; });
  if (Object.keys(tags).length) {
    try { await ptPatch(Object.keys(tags).reduce((m, k) => (m['pt_skuPriority/' + k] = tags[k], m), {})); }
    catch (e) { /* the order is saved; a tag that did not stick is not worth losing it over */ }
  }
  SOF.id = rec._id;
  /* NEW B2B ITEMS go on the Custom SKUs list, once each, with what the buyer said about them. One
   * already on the list is left as it is — somebody may have completed it. */
  /* customUnread (2026-10-01): a SKU whose Custom SKUs entry could not be READ is not written — writing blind put
   * blank fields over an entry somebody else had just completed. The order still saves; the message says to retry. */
  let customAdded = 0, customUnread = 0;
  if (b2b) {
    const fresh = new Map();
    lines.forEach(l => { if (!known.has(l.sku) && !fresh.has(l.sku)) fresh.set(l.sku, l); });
    if (fresh.size) {
      const patch = {};
      const nowIso = new Date().toISOString();
      for (const [sku, l] of fresh) {
        let was = null;
        try { was = await ptGet('pt_customSkus/' + sku); } catch (e) { customUnread++; continue; }
        if (was && typeof was === 'object' && Object.keys(was).length) continue;
        patch['pt_customSkus/' + sku] = {
          sku, articleType: '', subtype: '', color: '', size: l.size || '',
          brand: l.brand || '', packOf: '', fabric: '', cuttingRequired: true, consumption: 0,
          isZip: false, chainLength: null, zipQty: null, isRuffle: false, ruffleMeters: null, ruffleFabric: '',
          fillerFabricRequired: false, standardFillingQty: null, inventoryValuationPrice: 0,
          imageUrl: l.img || '', isCustom: true,
          fromB2B: true, b2bOrder: rec._id, shopName: l.itemName || '', material: l.material || '',
          label: l.label || '', customization: l.customization || '',
          addedBy: ME.email, addedAt: nowIso,
        };
      }
      if (Object.keys(patch).length) {
        try { await ptPatch(patch); customAdded = Object.keys(patch).length; }
        catch (e) { /* the order is saved; say so below rather than lose it */ customAdded = -1; }
      }
    }
  }
  /* NEW ONLINE ITEMS go on the Custom SKUs list the same way, described by their look-alikes. */
  if (onl) {
    const fresh = [...new Set(lines.filter(l => !known.has(l.sku)).map(l => l.sku))];
    const patch = {}, nowIso = new Date().toISOString();
    for (const sku of fresh) {
      let was = null;
      try { was = await ptGet('pt_customSkus/' + sku); } catch (e) { customUnread++; continue; }
      if (was && typeof was === 'object' && Object.keys(was).length) continue;
      const g = soGuessOf(sku);
      patch['pt_customSkus/' + sku] = {
        sku, articleType: g.articleType, subtype: g.subtype, color: g.color, size: g.size,
        brand: '', packOf: '', fabric: '', cuttingRequired: true, consumption: 0,
        isZip: false, chainLength: null, zipQty: null, isRuffle: false, ruffleMeters: null, ruffleFabric: '',
        fillerFabricRequired: false, standardFillingQty: null, inventoryValuationPrice: 0, imageUrl: '', isCustom: true,
        fromOnline: true, onlineOrder: rec._id, addedBy: ME.email, addedAt: nowIso,
      };
    }
    if (Object.keys(patch).length) {
      try { await ptPatch(patch); customAdded = Object.keys(patch).length; }
      catch (e) { customAdded = -1; }
    }
  }
  renderSox();
  $('sxMsg').className = 'muted';
  $('sxMsg').textContent = place
    ? `${rec._id} placed — it is now waiting for approval, and nothing is in the order book until then.`
    : `${rec._id} saved as a draft. It is not in production until it is placed and approved.`;
  if (customAdded > 0) $('sxMsg').textContent += ` ${nf(customAdded)} new item(s) went on the Custom SKUs list${onl ? '' : ' with their brand'} — complete them in Master Database → Custom SKUs.`;
  if (customAdded < 0 || customUnread) { $('sxMsg').className = 'err'; $('sxMsg').textContent += ' The new items could NOT be put on the Custom SKUs list — save again to retry.'; }
  return '';
}

async function soDeleteOrder(id) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone already.';
  if (!ME.admin) return 'Only an admin can delete a sales order.';
  await ptDelete('pt_salesOrders/' + id);
  SOX.rows = (SOX.rows || []).filter(s => s._id !== id);
  renderSox();
  $('sxMsg').className = soStatus(o) === 'approved' ? 'err' : 'muted';
  /* Deleting the order does NOT unwind the order book. Saying so is the difference between a
   * tidy-up and a silent hole in the caps. */
  $('sxMsg').textContent = `${id} deleted.` + (soStatus(o) === 'approved'
    ? ' It was approved, so its order-book lines are still there and production can still work against them — remove those in the Order Console if that is what you meant.'
    : '');
  return '';
}

/* ---- review: approve into production, or send it back ---- */
function soReview(id) {
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return;
  if (!ME.admin) return;
  const w = soWork(), s = soSummary(o, w);
  const perLine = o.deliveryMode === 'lines' || o.deliveryMode === 'partial';
  ptOpenDialog({
    title: 'Review ' + o._id,
    subtitle: `${o.channel || ''}  ·  ${o.buyerName || o.buyerEmail || ''}  ·  raised ${o.orderDate || '—'}`,
    note: `${nf(s.skus)} SKU(s) · ${nf(s.qty)} piece(s). Approving writes one order-book line per SKU, `
      + 'and from that moment every cap in this app measures against them.'
      + (soStatus(o) === 'approved' ? ' This order is already approved; approving again only fills in lines that are missing.' : ''),
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
        <label>Delivery<select id="sor_mode">
          <option value="complete"${perLine ? '' : ' selected'}>One date for the whole order</option>
          <option value="lines"${perLine ? ' selected' : ''}>The date already on each line</option>
        </select></label>
        <label>That date<input id="sor_date" type="date" value="${esc(o.deliveryDate || '')}"></label>
        <label style="grid-column:1/-1">Remarks<input id="sor_remarks" type="text"
          value="${esc(o.saRemarks || '')}" placeholder="Required to send it back; optional to approve"></label>
      </div>
      <div class="xlwrap" style="max-height:34vh;border:1px solid var(--line);border-radius:10px;margin-top:10px">
        <table class="xl"><thead><tr><th>SKU</th><th>Image</th>${soIsB2B(o.channel) ? '<th>Brand</th><th>Item</th><th>Label</th><th>Material</th><th>Size</th><th>Customization</th>' : ''}<th class="num">Qty</th><th>Delivery</th><th>In order book</th></tr></thead>
        <tbody>${s.groups.slice(0, 300).map(g => { const bl = soIsB2B(o.channel) ? (soLines(o).find(x => obUC(x.sku) === obUC(g.sku)) || {}) : null; return `<tr><td style="font-family:ui-monospace,monospace;text-align:left">${esc(g.sku)}${bl && !(PTG.mdb || []).some(m => obUC(m.sku) === obUC(g.sku)) ? '<div style="font-size:10px;color:#7f6000">custom SKU</div>' : ''}</td>`
          + (bl && bl.img ? ptImgCellSrc(g.sku, bl.img) : ptImgCell(g.sku))
          + (bl ? ['brand', 'itemName', 'label', 'material', 'size', 'customization'].map(k => `<td style="text-align:left;white-space:normal;max-width:180px;font-size:12px">${esc(bl[k] || '') || '<span class="muted">—</span>'}</td>`).join('') : '')
          + `<td class="num" style="font-weight:700">${nf(g.qty)}</td>`
          + `<td>${esc(g.delivery) || '<span class="muted">—</span>'}</td>`
          + `<td>${g.inBook ? '<span class="pill pill-ok">already</span>' : '<span class="muted">will be added</span>'}</td></tr>`; }).join('')}</tbody>
      </table></div>`
      + (s.groups.length > 300 ? `<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 300 of ${nf(s.groups.length)} SKUs. All of them are approved.</div>` : ''),
    onSave: () => soApproveRun(o._id),
    saveLabel: 'Approve into production',
    alt: { label: 'Send back to the buyer', run: () => soReturnRun(o._id) },
  });
  ptImgFill(s.groups.slice(0, 300).map(g => g.sku), false, ptImgPatch);
}

async function soReturnRun(id) {
  /* Sending an approved order back takes work off the floor, which is the same decision as putting
   * it there. One grant for both. */
  if (!soCanApprove()) return SO_NO_APPROVE;
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';
  const remarks = String($('sor_remarks').value || '').trim();
  if (!remarks) return 'Say what the buyer needs to change — that remark is the whole point of sending it back.';
  const now = new Date().toISOString();
  const next = Object.assign({}, o, { status: 'returned', saRemarks: remarks, reviewedAt: now, reviewedBy: ME.email });
  await ptPut('pt_salesOrders/' + id, next);
  SOX.rows = (SOX.rows || []).map(s => (s._id === id ? next : s));
  renderSox();
  $('sxMsg').className = 'muted';
  $('sxMsg').textContent = `${id} sent back to ${next.buyerName || next.buyerEmail || 'the buyer'}. Nothing has gone into production.`;
  return '';
}

async function soApproveRun(id) {
  if (!soCanApprove()) return SO_NO_APPROVE;
  const o = (SOX.rows || []).find(x => x._id === id); if (!o) return 'That order is gone.';
  const mode = $('sor_mode').value;
  let lines = soLines(o).slice();
  if (mode === 'complete') {
    const d = $('sor_date').value;
    if (!d) return 'Set the delivery date for the order, or switch to the date already on each line.';
    lines = lines.map(l => Object.assign({}, l, { deliveryDate: d }));
  } else {
    const missing = lines.filter(l => !l.deliveryDate).length;
    if (missing) return `${nf(missing)} line(s) have no delivery date, so there is nothing to approve them against.`;
  }
  const now = new Date().toISOString();
  const next = Object.assign({}, o, {
    lines, status: 'approved', saRemarks: String($('sor_remarks').value || '').trim(),
    approvedAt: now, approvedBy: ME.email,
    deliveryMode: mode === 'complete' ? 'complete' : 'partial',
    deliveryDate: mode === 'complete' ? $('sor_date').value : '',
  });

  /* The order book, one row per SKU, at a key derived from the order and the SKU. Approve twice and
   * the second write lands on the same keys and changes nothing — which is exactly what stopped the
   * old tool duplicating production lines. */
  const per = new Map();
  lines.forEach(l => { const s = obUC(l.sku); if (!s) return; per.set(s, (per.get(s) || 0) + (parseFloat(l.qty) || 0)); });
  /* A B2B line's own description, for the order-book row — the first line of each SKU speaks for it. */
  const firstOf = new Map();
  lines.forEach(l => { const s = obUC(l.sku); if (s && !firstOf.has(s)) firstOf.set(s, l); });
  const have = new Set((PTG.ob || []).filter(r => r && obUC(r.orderNo) === obUC(o._id)).map(r => obUC(r.sku)));
  const mdbBy = new Map((PTG.mdb || []).map(r => [obUC(r.sku), r]));
  const recs = [];
  per.forEach((v, s) => {
    const qty = Math.round(v);
    if (qty <= 0 || have.has(s)) return;
    const m = mdbBy.get(s) || {};
    const l = firstOf.get(s) || {};
    const b2bBits = soIsB2B(o.channel) ? [l.brand, l.itemName, l.material && 'Material: ' + l.material,
      l.label && !/^no$/i.test(l.label) && 'Label: ' + l.label,
      l.customization && !/^no$/i.test(l.customization) && 'Customization: ' + l.customization].filter(Boolean) : [];
    recs.push(Object.assign({ id: 'ob_so_' + obUC(o._id) + '_' + s, orderNo: o._id, orderDate: o.orderDate || now.slice(0, 10),
      sku: s, articleType: String(m.articleType || ''), articleSubtype: String(m.subtype || ''),
      color: String(m.color || ''), size: String(m.size || l.size || ''), qty,
      remarks: 'From approved Sales Order' + (o.buyerName ? ' · ' + o.buyerName : '') + (b2bBits.length ? ' · ' + b2bBits.join(' · ') : ''), src: 'SO',
      uploadedBy: ME.email, uploadedAt: now },
      soIsB2B(o.channel) ? { needsSku: !mdbBy.has(s), shopImg: String(l.img || ''), brand: String(l.brand || ''),
        itemName: String(l.itemName || ''), label: String(l.label || ''), material: String(l.material || ''), customization: String(l.customization || '') } : {}));
  });

  await ptPut('pt_salesOrders/' + id, next);
  SOX.rows = (SOX.rows || []).map(s => (s._id === id ? next : s));

  let added = 0, stopped = null;
  // 200 at a time: one order can carry 1,200 SKUs, and a row-at-a-time write took minutes.
  for (let i = 0; i < recs.length; i += 200) {
    const batch = recs.slice(i, i + 200);
    const patch = {};
    batch.forEach(r => { patch['pt_orderBook/' + r.id] = r; });
    try { await ptPatch(patch); }
    catch (e) { stopped = e; break; }
    batch.forEach(r => { if (!(PTG.ob || []).some(x => x && x.id === r.id)) { PTG.ob.push(r); added++; } });
    ptDlgMsg(`Approving… ${nf(Math.min(i + 200, recs.length))} of ${nf(recs.length)} line(s) written.`);
  }
  renderSox();
  if (stopped) {
    /* The order IS approved and part of it IS in the book. Saying "failed" would be a lie, and would
     * make someone re-approve blind — which is safe here, but only because the keys are fixed. */
    $('sxMsg').className = 'err';
    $('sxMsg').textContent = `${id} is approved, but the order book stopped after ${nf(added)} of ${nf(recs.length)} line(s): `
      + (stopped.message || stopped) + ' Approving it again is safe — the lines already written are skipped.';
    return 'Approved, but the order book was only part-written: ' + (stopped.message || stopped);
  }
  $('sxMsg').className = 'muted';
  $('sxMsg').textContent = `${id} approved · ${nf(added)} order-book line(s) written`
    + (recs.length !== added ? '' : '') + '. Production can now cut, issue and press against it.';
  return '';
}

/* ---- the way in ---- */
$('sxNew').onclick = async () => { if (SOX.rows === null) await ensureSox(); soFormOpen(null); };

