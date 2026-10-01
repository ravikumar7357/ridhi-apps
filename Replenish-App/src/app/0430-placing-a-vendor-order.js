/* ================= PLACING A VENDOR ORDER =================
 *
 * An order to a printer. Two shapes, and they never mix in one order: RUNNING FABRIC is metres of
 * cloth (fabric type, colour, print direction) and CUT FABRIC is pieces of a finished SKU. The order
 * carries the shape as `orderType`, and switching shape clears the draft, because a half-metres,
 * half-pieces order has no total anybody could read.
 *
 * CUT LINES ARE CAPPED AT DEMAND +10%. Demand is what approved sales orders ask for, per SKU; what
 * has already been ordered to every vendor counts against it. The tool calls this pool "Production
 * Order". There is a second pool in the tool for CX and adjustment production — `pt_productionOrders`
 * and `pt_adjustmentOrders` — and NEITHER NODE EXISTS in this database, so there is nothing to check
 * against and no picker is offered. If those ever start being written, voDemandMap is the one place
 * that has to learn about them.
 *
 * ONLY TABLECLOTHS AND TABLE RUNNERS can be cut-fabric lines. That is the printers' own limit, and
 * it is checked against the master database rather than trusted from the typist.
 */
const VO_CUT_SUBTYPES = ['rectangular tablecloth', 'round tablecloth', 'square tablecloth'];

/**
 * The kinds of firm this factory buys work from.
 *
 * "Printer" is left spelled exactly as it is, because all six vendors in the master carry that word
 * today and renaming a value in live data to make a list read better is how references break. It
 * means block printing; the others are named for what they are.
 */
const VENDOR_CATS = ['Printer', 'Digital printer', 'Screen printer', 'Marble printer',
  'Embroidery', 'Fabricator', 'Filling', 'Mill', 'Processor'];

/** Every vendor, whatever kind of firm they are. What the rate list is built on. */
function voAllVendors() {
  return ptList((PTG.masters || {}).vendor)
    .filter(v => v && v.active !== false)
    .sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''))
      || String(a.desc || a.name || a.code || '').toLowerCase().localeCompare(String(b.desc || b.name || b.code || '').toLowerCase()));
}
const voCatOf = code => {
  const v = ptList((PTG.masters || {}).vendor).find(x => x && String(x.code) === String(code));
  return v ? String(v.category || '').trim() : '';
};

/**
 * Block printers only — what a vendor ORDER may be raised on. Deliberately still narrow: raising a
 * cutting order on a filling firm is a different piece of work, and the order form's whole model
 * (running metres, cut pieces, the printer cap) is built for printers.
 */
function voVendors() {
  return ptList((PTG.masters || {}).vendor)
    .filter(v => v && v.active !== false && String(v.category || '').trim().toLowerCase() === 'printer')
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

/** A master list where there is one, and whatever the master database actually uses where there is not. */
function voMasterList(key, mdbField) {
  const m = ptList((PTG.masters || {})[key]).filter(r => r && r.active !== false)
    .map(r => r.desc || r.code).filter(Boolean);
  if (m.length) return [...new Set(m)].sort();
  return [...new Set((PTG.mdb || []).map(r => r && r[mdbField]).filter(Boolean))].sort();
}

const voCutAllowed = (at, sub) => {
  const a = String(at || '').trim().toLowerCase(), s = String(sub || '').trim().toLowerCase();
  return a === 'table runner' || s.indexOf('table runner') >= 0 || VO_CUT_SUBTYPES.indexOf(s) >= 0;
};

/** What the factory is actually asked for, per SKU: the approved sales orders. */
function voDemandMap() {
  const m = new Map();
  (SOX.rows || []).filter(o => o && o.status === 'approved').forEach(o =>
    soLines(o).forEach(l => { const s = obUC(l.sku); if (!s) return; m.set(s, (m.get(s) || 0) + (parseFloat(l.qty) || 0)); }));
  return m;
}

/**
 * What an order is for. An order raised before this existed is block printing, because that is the
 * only kind there was.
 */
const voServiceOf = o => String((o && o.service) || 'Block print').trim();
const voIsPrinting = o => /print$/i.test(voServiceOf(o));
/* Is the order BEING BUILT printing? The printer cap, the cut-fabric list and the vendor check all
 * turn on it, and they must all give the same answer. */
const voDraftPrinting = () => voIsPrinting({ service: VOF && VOF.service });
/** The work a vendor of this kind usually does — the form's opening guess, never a rule. */
const VO_SVC_BY_CAT = { 'Printer': 'Block print', 'Digital printer': 'Digital print',
  'Screen printer': 'Screen print', 'Marble printer': 'Marble print',
  'Embroidery': 'Embroidery', 'Fabricator': 'Cutting', 'Filling': 'Filling' };

/**
 * What has already been promised to PRINTERS, per SKU. A cancelled order or line does not count.
 *
 * Printing only. This total is the printer cap — how much of a SKU may still be sent out to be
 * printed against approved demand. Job work is a different pool: a hundred quilts sent to be filled
 * say nothing about how many tablecloths may go to a block printer, and counting them together would
 * refuse a real printing order for being over a cap it never touched.
 */
function voExistingMap(excludeOrderId) {
  const m = new Map();
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled' || (excludeOrderId && o.id === excludeOrderId)) return;
    if ((o.demandSource || 'bulk') !== 'bulk') return;
    if (!voIsPrinting(o)) return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled || voKind(l) !== 'cut') return;
      const s = obUC(l.sku); if (!s) return;
      m.set(s, (m.get(s) || 0) + (parseFloat(l.qty) || 0));
    });
  });
  return m;
}

/* A line carries its own kind, and the order-level orderType is only the shape it was raised as.
 * The cap counts cut pieces, so it reads the line, not the order. */
const voKind = l => (l && l.kind === 'running' ? 'running' : (l && l.kind === 'custom' ? 'custom' : 'cut'));

/** Every SKU that would break the cap, not just the first — a 500-row file should fail once. */
/**
 * Which orders are holding a SKU's pieces, and for whom.
 *
 * Same rule as voExistingMap — if it counts towards the cap, it is listed here. Newest first, because
 * the one raised last is usually the one being asked about.
 */
function voHolders(sku, excludeOrderId) {
  const s = obUC(sku), out = [];
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled' || (excludeOrderId && o.id === excludeOrderId)) return;
    if ((o.demandSource || 'bulk') !== 'bulk') return;
    if (!voIsPrinting(o)) return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled || voKind(l) !== 'cut' || obUC(l.sku) !== s) return;
      const qty = parseFloat(l.qty) || 0;
      if (!qty) return;
      out.push({ orderNo: o.orderNo || o.id, vendor: voName(o.vendorCode) || o.vendorName || o.vendorCode,
        qty, orderDate: o.orderDate || '' });
    });
  });
  return out.sort((a, b) => b.qty - a.qty);
}

function voValidateCut(additions, excludeOrderId) {
  const by = new Map();
  (additions || []).forEach(a => { const s = obUC(a.sku); if (!s) return; by.set(s, (by.get(s) || 0) + (parseFloat(a.qty) || 0)); });
  const demand = voDemandMap(), existing = voExistingMap(excludeOrderId), out = [];
  by.forEach((adding, sku) => {
    const d = demand.get(sku) || 0, cap = d * 1.1, was = existing.get(sku) || 0, total = was + adding;
    if (total > cap + 1e-9) out.push({ sku, demand: d, cap: Math.floor(cap), existing: was, adding, total,
      holders: voHolders(sku, excludeOrderId) });
  });
  return out;
}
/**
 * The refusal, and WHO IS HOLDING THE PIECES.
 *
 * "15 is already on order" is true and useless: the pieces are usually on another printer's order,
 * so cancelling everything with the printer in front of you changes nothing and there is no hint
 * where to look. The orders are named, with the vendor, so the next step is obvious — cancel that
 * one, or raise a smaller quantity here.
 */
const voCapMsg = v => {
  const held = (v.holders || []).slice(0, 3)
    .map(h => `${nf(h.qty)} with ${h.vendor} on ${h.orderNo}${h.orderDate ? ' (' + h.orderDate + ')' : ''}`);
  const more = (v.holders || []).length - held.length;
  return `${v.sku}: approved orders ask for ${nf(v.demand)}, so the most that may go to printers is `
    + `${nf(v.cap)} (+10%). ${nf(v.existing)} is already on order and this adds ${nf(v.adding)}, making ${nf(v.total)}.`
    + (held.length ? ` Held by — ${held.join('; ')}${more > 0 ? ` and ${nf(more)} more` : ''}.` : '');
};

/** VPO-YYMMDD-XXX, re-rolled if that number is somehow already in use. */
function voNewOrderNo() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const pfx = 'VPO-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-';
  const taken = new Set((VO.rows || []).map(o => obUC(o.orderNo)));
  for (let i = 0; i < 50; i++) {
    const id = pfx + Math.random().toString(36).slice(2, 5).toUpperCase();
    if (!taken.has(id)) return id;
  }
  return pfx + Date.now().toString(36).slice(-3).toUpperCase();
}
const voTodayDMY = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };

/* ---- the form ---- */
let VOF = { kind: 'running', lines: [] };

async function voFormOpen(mode) {
  if (VO.rows === null) await ensureVo();
  if (!PTG.mdb) await ptLoadGates();
  if (SOX.rows === null) { try { SOX.rows = ptList(await ptGet('pt_salesOrders')); } catch (e) { SOX.rows = SOX.rows || []; } }
  /* REQUEST OR ORDER. Somebody who may approve places the order; everybody else asks for it, and
   * the same form builds the request so every check below applies to both. */
  VOF = { kind: 'running', lines: [], service: 'Block print', fs: null,
    mode: mode === 'request' || mode === 'place' ? mode : (vrqCanApprove() ? 'place' : 'request') };
  const asking = VOF.mode === 'request';
  /* EVERY vendor. Job work goes out to filling firms and fabricators as much as printing goes to
   * printers, and an order is the only way to tell them what is coming. */
  const vends = voAllVendors();
  /* DESIGN 10 — the header band (Ravi, 2026-09-25). The vendor, the work and running-or-cut sit in the band;
   * the long note that opened the form is gone — the cap is said where it bites, on the line. */
  ptOpenDialog({
    title: asking ? 'Request a vendor order — goes to an approver first' : 'New vendor order',
    wide: true,
    boxClass: 'vo-band',
    titleExtra: `<div class="vo-bandrow">
        <label class="vo-bf">Vendor<select id="vof_vendor">
          <option value="">— pick a vendor —</option>
          ${vends.map(v => `<option value="${esc(v.code)}" data-cat="${esc(v.category || '')}">${esc(v.desc || v.name || v.code)} (${esc(v.category || 'vendor')})</option>`).join('')}
        </select></label>
        <label class="vo-bf">For<select id="vof_channel" title="Which sales channel this order is for — its lines go to that channel's orders first">
          <option value="">— sales channel —</option>
          ${VO_CHANNELS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select></label>
        <label class="vo-bf">Work<select id="vof_service">
          ${PR_SERVICES.map(s => `<option value="${esc(s.key)}">${esc(s.key)}</option>`).join('')}
        </select></label>
        <label id="vof_fillerWrap" class="vo-bf hide">Filler
          <input id="vof_filler" list="vofFillerList" placeholder="e.g. Surgical Cotton" autocomplete="off">
          <datalist id="vofFillerList"></datalist></label>
        <div class="seg vo-seg" role="group" aria-label="What is sent">
          <button type="button" id="vof_kr" class="segbtn">Running · metres</button>
          <button type="button" id="vof_kc" class="segbtn">Cut · pieces</button></div>
      </div>`,
    html: (vends.length ? '' : '<div class="err" style="margin-bottom:10px">There are no active vendors in the vendor master, so there is nobody to order from.</div>')
      + `<div id="vof_form"></div>
      <div class="vo-lineshead"><span class="lb" style="flex:1">Lines</span>
        <button id="vof_fetch" class="hide" style="padding:6px 12px;font-size:12.5px" title="Bring in this channel's open orders, SKU by SKU — what they still need that no vendor holds">Fetch orders</button>
        <button id="vof_tmpl" class="ghost" style="padding:6px 12px;font-size:12.5px">Template</button>
        <button id="vof_up" class="ghost" style="padding:6px 12px;font-size:12.5px">Upload lines</button>
        <input id="vof_file" type="file" accept=".csv,.xlsx,text/csv" style="display:none"></div>
      <div class="xlwrap vo-lines"><table class="xl" id="vof_table"></table></div>
      <label style="display:block;margin-top:12px">Notes for the vendor
        <input id="vof_notes" type="text" placeholder="optional"></label>
      ${asking ? `<label style="display:block;margin-top:10px">Why this is needed — for the approver
        <input id="vof_why" type="text" placeholder="e.g. Amazon order, 400 pcs due 30 Sep"></label>` : ''}`,
    footLeft: '<span id="vof_tot" class="vo-tot"></span>',
    onSave: () => voPlace(),
    saveLabel: asking ? 'Send for approval' : 'Place order',
  });
  $('vof_kr').onclick = () => voSetKind('running');
  $('vof_kc').onclick = () => voSetKind('cut');
  $('vof_tmpl').onclick = () => voTemplate(VOF.kind);
  $('vof_up').onclick = () => $('vof_file').click();
  $('vof_file').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) voBulkFile(f, VOF.kind); e.target.value = ''; };
  /* Picking the vendor guesses the work from what kind of firm they are, and the work decides whether
   * metres are even on offer — only printing is bought by the metre. */
  $('vof_vendor').addEventListener('change', voOnVendorPick);
  $('vof_service').addEventListener('change', voOnServicePick);
  if ($('vof_channel')) $('vof_channel').addEventListener('change', voFetchLabel);
  if ($('vof_fetch')) $('vof_fetch').onclick = () => voFetchRun();
  voOnServicePick();
  voFetchLabel();
}

/* Picking a vendor guesses the work from what kind of firm they are — an opening guess, changeable. */
function voOnVendorPick() {
  const sel = $('vof_vendor'); if (!sel) return;
  const v = voMasterRow(sel.value);
  const guess = v ? VO_SVC_BY_CAT[String(v.category || '').trim()] : null;
  if (guess && $('vof_service')) { $('vof_service').value = guess; voOnServicePick(); }
}
/* The work decides whether metres are even offered: only printing is bought by the metre. */
function voOnServicePick() {
  const s = String(($('vof_service') || {}).value || 'Block print');
  VOF.service = s;
  const svc = prSvc(s);
  /* A FILLING ORDER NAMES ITS FILLER. The firm has one rate card per filler, and an order that does
   * not say which one is an order nobody can price. Offered from the fillers the rate list knows. */
  const wrap = $('vof_fillerWrap');
  if (wrap) {
    wrap.classList.toggle('hide', !(svc && svc.fill));
    const dl = $('vofFillerList');
    if (dl) dl.innerHTML = prKnown('filler').map(f => `<option value="${esc(f)}">`).join('');
  }
  const runOk = !svc || svc.kinds.indexOf('running') >= 0;
  const kr = $('vof_kr');
  if (kr) { kr.style.display = runOk ? '' : 'none'; }
  if (!runOk && VOF.kind === 'running') voSetKind('cut');
  else voSetKind(VOF.kind);
}

function voSetKind(k) {
  // Switching shape empties the draft: metres and pieces cannot share one order, or one total.
  if (VOF.kind !== k && VOF.lines.length
    && !confirm('Switching to ' + (k === 'running' ? 'running fabric' : 'cut fabric')
      + ' clears the ' + nf(VOF.lines.length) + ' line(s) already added, because one order cannot hold both.\n\nOK clears them.')) return;
  if (VOF.kind !== k) VOF.lines = [];
  VOF.kind = k;
  $('vof_kr').classList.toggle('on', k === 'running');
  $('vof_kc').classList.toggle('on', k === 'cut');

  const pri = `<select id="vof_pri"><option value="">—</option>${['P1', 'P2', 'P3', 'P4'].map(p => `<option value="${p}">${p}</option>`).join('')}</select>`;
  /* ONE ROW TO ADD A LINE (design 10). The fabric SKU fills fabric, colour and direction, as before. */
  $('vof_form').innerHTML = k === 'running'
    ? `<div class="vo-entry">
        <label>Fabric SKU <input id="vof_fsku" list="vofFskuList" placeholder="type or pick" autocomplete="off"
          style="font-family:ui-monospace,monospace;text-transform:uppercase">
          <datalist id="vofFskuList"></datalist></label>
        <label>Fabric *<select id="vof_fab"><option value="">— pick —</option>
          ${voMasterList('fabricType', 'fabric').map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
        <label>Colour *<select id="vof_col"><option value="">— pick —</option>
          ${voMasterList('colour', 'color').map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>
        <label>Direction *<select id="vof_pd"><option value="">—</option><option>Horizontal</option><option>Vertical</option></select></label>
        <label>Metres *<input id="vof_qty" type="number" min="0" step="0.01"></label>
        <label>Delivery<input id="vof_deliv" type="date"></label>
        <label>Priority${pri}</label>
      </div>
      <div class="vo-entry2"><label style="flex:1">Line note<input id="vof_lnotes" type="text" placeholder="optional"></label>
        <button id="vof_add">Add line</button></div>
      <div id="vof_info" class="muted" style="font-size:12px;margin-top:6px"></div>`
    : `<div class="vo-entry cut">
        <label>SKU *<input id="vof_sku" list="vofSkuList" placeholder="type or pick" autocomplete="off"
          style="font-family:ui-monospace,monospace;text-transform:uppercase">
          <datalist id="vofSkuList">${(PTG.mdb || []).filter(r => r && voCutAllowed(r.articleType, r.subtype)).slice(0, 4000)
            .map(r => `<option value="${esc(obUC(r.sku))}">${esc([r.articleType, r.color, r.size].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
        <label>Pieces *<input id="vof_qty" type="number" min="1" step="1"></label>
        <label>Delivery<input id="vof_deliv" type="date"></label>
        <label>Priority${pri}</label>
      </div>
      <div class="vo-entry2"><label style="flex:1">Line note<input id="vof_lnotes" type="text" placeholder="optional"></label>
        <button id="vof_add">Add line</button><button id="vof_check" class="ghost">Check quantities</button></div>
      <div id="vof_info" class="muted" style="font-size:12px;margin-top:6px"></div>
      <div class="muted" style="font-size:11.5px;margin-top:4px">Cut fabric covers rectangular, round and square
        tablecloths and table runners only. Each SKU is capped at what approved sales orders ask for, plus 10%.</div>`;
  $('vof_add').onclick = voAddLine;
  if (k === 'running') {
    /* The list of 2,673 fabric SKUs is built when somebody reaches for it, not every time the form opens. */
    $('vof_fsku').addEventListener('focus', () => { const dl = $('vofFskuList'); if (dl && !dl.dataset.filled) { dl.innerHTML = voFabricOptions(); dl.dataset.filled = '1'; } });
    $('vof_fsku').addEventListener('input', voFabricSkuTyped);
    ['vof_fab', 'vof_col', 'vof_pd'].forEach(id => $(id).addEventListener('change', voFabricFromFields));
  }
  if (k === 'cut') {
    $('vof_sku').addEventListener('input', voSkuInfo);
    $('vof_check').onclick = voCheckDraft;
  }
  voDraft();
}

/** What this SKU is, and whether a printer may be asked to cut it at all. */
function voSkuInfo() {
  const s = obUC(($('vof_sku') || {}).value || ''), el = $('vof_info');
  if (!el) return null;
  if (!s) { el.textContent = ''; el.className = 'muted'; return null; }
  const m0 = (PTG.mdb || []).find(r => r && obUC(r.sku) === s);
  if (!m0 && voForShopify()) {
    const g = voCustomLine(s);
    el.className = 'muted';
    el.textContent = s + ' is not in the master — ' + ([g.articleType, g.subtype, g.color, g.size].filter(Boolean).join(' · ') || 'nothing like it either')
      + ' · it goes on the Custom SKUs list when the order is sent.';
    return g;
  }
  const m = m0;
  if (!m) { el.className = 'err'; el.textContent = s + ' is not in the master database. For a Shopify order, pick Shopify in "For" first.'; return null; }
  /* THE PRINTERS' LIMIT, not everybody's. A quilt cannot be sent to a block printer as cut fabric;
   * sending it to be filled is the entire point of a filling order. */
  const printing = voDraftPrinting();
  if (printing && !voForShopify() && !voCutAllowed(m.articleType, m.subtype)) {
    el.className = 'err';
    el.textContent = `${m.subtype || m.articleType || s} is not a cut-fabric item. Only rectangular, round and square tablecloths and table runners can be ordered cut from a printer.`;
    return null;
  }
  el.className = 'muted';
  const what = [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · ');
  if (!printing) {
    /* No cap on job work: the printer cap measures printing against approved demand, and this is
     * neither. What is sent out is a decision, not an allowance. */
    el.textContent = what + ' · job work — the printer cap does not apply.';
    return m;
  }
  const d = voDemandMap().get(s) || 0, was = voExistingMap().get(s) || 0;
  el.textContent = what
    + ` · approved orders ask for ${nf(d)}, ${nf(was)} already with printers, ${nf(Math.max(0, Math.floor(d * 1.1) - was))} left within the cap.`;
  return m;
}

/* ---- running fabric by SKU ----
 *
 * Ravi, 2026-09-15: "fabric ke liye SKU feed kar diye hain — iska order bhi SKU wise create hona
 * chahiye, aur uske according detail fill honi chahiye."
 *
 * The fabric SKUs are the printer's catalogue (Master Database → Fabric): RBP004 is cambric in colour
 * 004, RBPSF004-V-82 is sheeting 82 printed vertically. A SKU typed or picked here fills the fabric
 * type, the colour and the print direction; choosing those three fills the SKU back. The SKU and the
 * design's picture travel on the line, so the printer sees the code and the print.
 *
 * The catalogue is built once when the form opens — it walks every colour code and its pictures, and
 * doing that per keystroke would be felt.
 */
function voFabricCatalogue() {
  /* Keyed in capitals: every lookup here upper-cases what was typed, and RQL327-T-Front is not. */
  if (!VOF.fs) VOF.fs = new Map(fsRows({}).map(r => [r.sku.toUpperCase(), r]));
  return VOF.fs;
}
/* ---- fabric SKUs added by hand (Ravi, 2026-09-25) ---- */
/** The columns of the sheet, and the names they may go by. */
const FS_MAN_COLS = [
  ['sku', 'SKU', ['sku', 'fabric sku']],
  ['brand', 'Brand', ['brand']],
  ['code', 'Colour code', ['colour code', 'color code', 'code']],
  ['colour', 'Colour', ['colour', 'color']],
  ['fabric', 'Fabric', ['fabric', 'fabric type']],
  ['dir', 'Print direction', ['print direction', 'direction', 'dir']],
  ['side', 'Side', ['side']],
  ['imageUrl', 'Picture URL', ['picture url', 'picture', 'image url', 'image']],
  ['note', 'Note', ['note', 'remarks', 'remark']],
];
/** Every fabric SKU somebody added by hand, as rows of the catalogue. */
function fsManual() {
  return ptList((PTG.masters || {}).fabricSku).filter(r => r && r.sku).map(r => {
    const brand = String(r.brand || '').trim();
    return { manual: true, brand, code: String(r.code || '').trim(), colour: String(r.colour || '').trim(),
      fabric: String(r.fabric || '').trim(), width: String(r.fabric || '').replace(/[^0-9]/g, ''),
      dir: String(r.dir || '').trim(), side: String(r.side || '').trim(), sku: String(r.sku).trim().toUpperCase(),
      imageUrl: String(r.imageUrl || '').trim(), imageFrom: 'added by hand', alsoCalled: [], note: String(r.note || ''),
      brandName: (FS_BRANDS.find(b => b.key === brand) || {}).name || brand || '—' };
  });
}
/** The brand as the catalogue keys it: CPC, RBP (Ridhi), or '' when none is said. */
const fsBrandKey = v => { const t = String(v || '').trim().toUpperCase(); return !t ? '' : (/^CPC/.test(t) ? 'CPC' : (/^(RBP|RIDHI)/.test(t) ? 'RBP' : '?')); };
const fsDirOf = v => { const t = String(v || '').trim().toLowerCase(); return !t ? '' : (/^v/.test(t) ? 'Vertical' : (/^h/.test(t) ? 'Horizontal' : '?')); };

/**
 * One row, checked. `taken` holds the SKUs the worked-out catalogue already makes (never overwritten by hand);
 * `seen` the ones earlier in the same sheet. Returns { err } or { rec }.
 */
function fsManualCheck(v, taken, seen) {
  const sku = String(v.sku || '').trim().toUpperCase();
  if (!sku) return { err: 'Put in the fabric SKU.' };
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(sku)) return { err: `${sku}: a fabric SKU is letters, digits and dashes only.` };
  if (taken && taken.has(sku)) return { err: `${sku} is already in the catalogue — it is built from the master database and cannot be added again.` };
  if (seen && seen.has(sku)) return { err: `${sku} is in the sheet twice.` };
  const brand = fsBrandKey(v.brand);
  if (brand === '?') return { err: `${sku}: brand is CPC or Ridhi (or blank).` };
  const colour = String(v.colour || '').trim(), fabric = String(v.fabric || '').trim();
  if (!colour) return { err: `${sku}: put in the colour.` };
  if (!fabric) return { err: `${sku}: put in the fabric.` };
  const dir = fsDirOf(v.dir);
  if (dir === '?') return { err: `${sku}: print direction is Vertical or Horizontal (or blank).` };
  const side = String(v.side || '').trim();
  if (side && !/^(front|back)$/i.test(side)) return { err: `${sku}: side is Front or Back (or blank).` };
  return { rec: { sku, brand, code: String(v.code || '').trim(), colour, fabric, dir,
    side: side ? side[0].toUpperCase() + side.slice(1).toLowerCase() : '',
    imageUrl: String(v.imageUrl || '').trim(), note: String(v.note || '').trim() } };
}
/** The SKUs the catalogue works out on its own — the ones a hand-added row may not take. */
const fsBuiltSkus = () => new Set(fsRows({}).filter(r => !r.manual).map(r => r.sku.toUpperCase()));
const fsManKey = sku => String(sku).trim().toUpperCase().replace(/[.#$\[\]\/]/g, '_');

/** Write rows added or changed by hand, in one go. */
async function fsManualSave(recs) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  if (!recs.length) return 'There is nothing to save.';
  const cur = (PTG.masters || {}).fabricSku || {};
  const now = new Date().toISOString(), patch = {}, keep = {};
  recs.forEach(r => {
    const k = fsManKey(r.sku), was = cur[k];
    const row = Object.assign({}, was || {}, r, was ? { editedBy: ME.email, editedAt: now } : { addedBy: ME.email, addedAt: now });
    patch['pt_masters/fabricSku/' + k] = row; keep[k] = row;
  });
  try { await ptPatch(patch); } catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.masters = Object.assign({}, PTG.masters || {}, { fabricSku: Object.assign({}, cur, keep) });
  if (typeof VOF !== 'undefined' && VOF) VOF.fs = null;          // the vendor form's list is built again
  return '';
}

/** One fabric SKU, typed in — or an added one, changed. */
function fsManualEdit(sku) {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const k = sku ? fsManKey(sku) : '';
  const cur = k ? (((PTG.masters || {}).fabricSku || {})[k] || {}) : {};
  const colours = typeof voMasterList === 'function' ? voMasterList('colour', 'color') : [];
  ptOpenDialog({
    title: sku ? 'Fabric SKU ' + sku : 'New fabric SKU',
    note: 'A fabric SKU the catalogue does not work out on its own. It is listed with the rest and can be ordered from a printer. '
      + 'A SKU the catalogue already builds from the master database cannot be added again.',
    fields: [
      { key: 'sku', label: 'Fabric SKU *', value: cur.sku || '', readonly: !!sku },
      { key: 'brand', label: 'Brand', type: 'select', value: cur.brand || '', options: [['', '—'], ['CPC', 'CPC'], ['RBP', 'Ridhi']] },
      { key: 'code', label: 'Colour code', value: cur.code || '' },
      { key: 'colour', label: 'Colour *', value: cur.colour || '', list: colours },
      { key: 'fabric', label: 'Fabric *', value: cur.fabric || '', list: fabListOr(cur.fabric) },
      { key: 'dir', label: 'Print direction', type: 'select', value: cur.dir || '', options: [['', '—'], ['Vertical', 'Vertical'], ['Horizontal', 'Horizontal']] },
      { key: 'side', label: 'Side', type: 'select', value: cur.side || '', options: [['', '—'], ['Front', 'Front'], ['Back', 'Back']] },
      { key: 'imageUrl', label: 'Picture URL', value: cur.imageUrl || '', span: true },
      { key: 'note', label: 'Note', value: cur.note || '', span: true },
    ],
    onSave: async v => {
      const r = fsManualCheck(Object.assign({}, v, sku ? { sku } : {}), fsBuiltSkus(), null);
      if (r.err) return r.err;
      if (!sku && ((PTG.masters || {}).fabricSku || {})[fsManKey(r.rec.sku)]) return `${r.rec.sku} is already added — find it in the list and press Edit.`;
      const err = await fsManualSave([r.rec]);
      if (err) return err;
      renderPmdb();
      $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = `${r.rec.sku} ${sku ? 'saved' : 'added to the fabric catalogue'}.`;
      return '';
    },
    saveLabel: sku ? 'Save' : 'Add',
  });
}

function fsManualTemplate() {
  const head = FS_MAN_COLS.map(c => c[1]);
  const bytes = recipeXlsx([head, ['CPCSF999-V-62', 'CPC', '999', '[colour]', 'Sheeting 62', 'Vertical', '', '', '']],
    { name: 'Fabric SKUs', freeze: 1, cols: {}, list: { name: 'Direction', values: ['Vertical', 'Horizontal'], cols: [FS_MAN_COLS.findIndex(c => c[0] === 'dir')] } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `fabric-skus-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = 'Fabric SKU sheet written — replace the example row with yours. A SKU already added by hand is updated; one the catalogue builds itself is refused.';
}

/** The sheet, read and checked. { add, upd, bad, rows } — nothing is written here. */
function fsManualPlan(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(15, (rows || []).length); i++) {
    const low = (rows[i] || []).map(x => String(x == null ? '' : x).trim().toLowerCase());
    if ((low.indexOf('sku') >= 0 || low.indexOf('fabric sku') >= 0) && (low.indexOf('fabric') >= 0 || low.indexOf('fabric type') >= 0)) { h = i; break; }
  }
  if (h < 0) return { err: 'No header row with SKU and Fabric — download the template and fill that.' };
  const low = rows[h].map(x => String(x == null ? '' : x).trim().toLowerCase());
  const ix = {};
  FS_MAN_COLS.forEach(([k, , names]) => { ix[k] = -1; for (const n of names) { const i = low.indexOf(n); if (i >= 0) { ix[k] = i; break; } } });
  const taken = fsBuiltSkus(), seen = new Set(), have = (PTG.masters || {}).fabricSku || {};
  const add = [], upd = [], bad = [];
  rows.slice(h + 1).forEach((r, i) => {
    if (!(r || []).some(x => String(x == null ? '' : x).trim())) return;
    const v = {}; FS_MAN_COLS.forEach(([k]) => { v[k] = ix[k] >= 0 ? String(r[ix[k]] == null ? '' : r[ix[k]]).trim() : ''; });
    const c = fsManualCheck(v, taken, seen);
    if (c.err) { bad.push('row ' + (h + 2 + i) + ': ' + c.err); return; }
    seen.add(c.rec.sku);
    (have[fsManKey(c.rec.sku)] ? upd : add).push(c.rec);
  });
  return { add, upd, bad };
}

async function fsManualFile(file) {
  let rows;
  try { rows = await pkReadFile(file); } catch (e) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read that file: ' + (e.message || e); return; }
  const p = fsManualPlan(rows);
  if (p.err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = p.err; return; }
  /* ALL OR NOTHING, as every other sheet here: one bad row and nothing is written, so fixing and uploading again
   * cannot leave half the file in twice. */
  ptOpenDialog({
    title: 'Fabric SKUs from ' + file.name,
    note: p.bad.length ? 'Fix these rows in the sheet and choose it again — nothing is written while any row is wrong.'
      : 'Nothing is written until you press Save.',
    html: `<div style="font-size:13px"><b>${nf(p.add.length)}</b> new · <b>${nf(p.upd.length)}</b> already added (updated)`
      + (p.bad.length ? ` · <b style="color:var(--bad)">${nf(p.bad.length)} to fix</b>` : '') + '</div>'
      + (p.bad.length ? '<div class="err" style="margin-top:8px;white-space:normal">' + p.bad.slice(0, 20).map(esc).join('<br>')
        + (p.bad.length > 20 ? '<br>… and ' + nf(p.bad.length - 20) + ' more' : '') + '</div>' : ''),
    onSave: async () => {
      if (p.bad.length) return nf(p.bad.length) + ' row(s) need fixing — nothing has been saved.';
      const err = await fsManualSave(p.add.concat(p.upd));
      if (err) return err;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(p.add.length)} fabric SKU(s) added, ${nf(p.upd.length)} updated.`;
      return '';
    },
    saveLabel: 'Save',
  });
}

function voFabricOptions() {
  return [...voFabricCatalogue().values()].map(r =>
    `<option value="${esc(r.sku)}">${esc([r.brandName, r.colour, r.fabric, r.width ? r.dir : '', r.side || ''].filter(Boolean).join(' · '))}</option>`).join('');
}
/**
 * A select's option whose text matches, regardless of case — and if the masters do not have it yet,
 * the value is offered anyway, marked.
 *
 * Ravi, 2026-09-24: "inko jab tak ke liye custom sku list me add krdo, i will add after — open the
 * order for this". A fabric SKU that IS in the catalogue was being refused an order because the
 * colour master had not caught up with it, which is a dropdown holding up a printing programme.
 * The catalogue is the thing that says this cloth exists; the master is a list somebody maintains,
 * and it is allowed to be behind.
 */
function voPickOption(id, text) {
  const el = $(id); if (!el || !text) return false;
  const want = String(text).trim().toLowerCase();
  const o = [...(el.options || [])].find(x => String(x.value).trim().toLowerCase() === want);
  if (o) { el.value = o.value; return true; }
  /* Offered, and SAID to be missing — on the option itself, so nobody can pick it later believing
   * the masters have it. Dropped again on the next fill: it belongs to this line, not to the list. */
  const add = document.createElement('option');
  add.value = String(text).trim();
  add.textContent = add.value + ' — not in Masters yet';
  add.dataset.adhoc = '1';
  el.appendChild(add);
  el.value = add.value;
  return false;
}
const voFabricInfo = (t, bad) => { const el = $('vof_info'); if (el) { el.className = bad ? 'err' : 'muted'; el.textContent = t; } };
function voFabricSkuTyped() {
  const sku = String(($('vof_fsku') || {}).value || '').trim().toUpperCase();
  if (!sku) { voFabricInfo(''); return null; }
  const r = voFabricCatalogue().get(sku);
  if (!r) { voFabricInfo(`${sku} is not a fabric SKU in the catalogue (Master Database → Fabric).`, true); return null; }
  const missing = [];
  if (!voPickOption('vof_fab', r.fabric)) missing.push(`fabric type "${r.fabric}"`);
  if (!voPickOption('vof_col', r.colour)) missing.push(`colour "${r.colour}"`);
  voPickOption('vof_pd', r.dir);
  /* NOT A REFUSAL ANY MORE. The line is ordered with what the catalogue says, and the missing
   * master is named so it can be added afterwards — the printing does not wait on a list. */
  voFabricInfo(`${sku} · ${r.brandName} · ${r.colour} · ${r.fabric}${r.width ? ' · ' + r.dir : ''}`
    + (missing.length ? ` — ${missing.join(' and ')} is not in Masters yet; the line can still be ordered, add it under Masters when you can.` : ''),
    false);
  return r;
}
/** The fields chosen by hand: the one catalogue SKU they describe, if there is exactly one. */
function voFabricFromFields() {
  const fab = ($('vof_fab') || {}).value || '', col = ($('vof_col') || {}).value || '', pd = ($('vof_pd') || {}).value || '';
  const el = $('vof_fsku'); if (!el) return;
  if (!fab || !col) { el.value = ''; return; }
  const n = v => String(v || '').trim().toLowerCase();
  const cambric = n(fab) === 'cambric';
  const hits = [...voFabricCatalogue().values()].filter(r => n(r.fabric) === n(fab) && n(r.colour) === n(col) && (cambric || !pd || r.dir === pd));
  if (hits.length === 1 && (cambric || pd)) { el.value = hits[0].sku; voFabricInfo(`${hits[0].sku} · ${hits[0].brandName}`); }
  else {
    el.value = '';
    voFabricInfo(hits.length > 1 && (cambric || pd) ? `${hits.length} fabric SKUs fit — ${hits.map(h => h.sku).join(', ')} — pick one in the Fabric SKU box.`
      : (hits.length ? '' : `No fabric SKU in the catalogue for ${fab} · ${col}${pd ? ' · ' + pd : ''} — the line can still be ordered without one.`));
  }
}

