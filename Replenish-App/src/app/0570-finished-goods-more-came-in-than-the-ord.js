/* ================= FINISHED GOODS: MORE CAME IN THAN THE ORDER ASKED FOR =================
 *
 * A receipt against an Order Console order that takes the order past what it asked for is saved with
 * overQty (the extra pieces), overOrdered, overReason (required at entry) and overStatus 'open'. It
 * shows in "Received more than ordered", and as a purple count in the sidebar, for anybody who can edit
 * finished goods — until one of them marks it reviewed. The pieces stay in stock either way: extra is
 * real stock, the flag is about knowing why it exists.
 */
const fgiOverOpen = () => (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && fgiNum(r.overQty) > 0 && r.overStatus === 'open');

function fgiOverBadge() {
  const el = $('fgiOverBadge'); if (!el) return;
  const n = fgiCanEdit() ? fgiOverOpen().length : 0;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

function fgiRenderOver() {
  const all = (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && fgiNum(r.overQty) > 0)
    .sort((a, b) => (a.overStatus === 'open' ? 0 : 1) - (b.overStatus === 'open' ? 0 : 1) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  FGI.shown = all;
  const can = fgiCanEdit();
  const head = '<thead><tr>' + ['When', 'SKU', 'Image', 'Order', 'Ordered', 'This receipt', 'Extra', 'Why', 'By', 'Status', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 4 && i <= 6 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (all.length ? all.map(r => '<tr>'
    + `<td class="frz">${esc(String(r.createdAt || '').slice(0, 16).replace('T', ' '))}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(obUC(r.sku))}</td>`
    + ptImgCell(r.sku)
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.orderNo || '')}</td>`
    + `<td class="num">${nf(fgiNum(r.overOrdered))}</td>`
    + `<td class="num">${nf(fgiNum(r.qty))}</td>`
    + `<td class="num" style="font-weight:700;color:var(--bad)">${nf(fgiNum(r.overQty))}</td>`
    + `<td style="text-align:left;white-space:normal;max-width:260px">${esc(r.overReason || '')}</td>`
    + `<td>${esc(String(r.createdBy || '').split('@')[0])}</td>`
    + `<td>${r.overStatus === 'open' ? '<span class="pill pill-out">to review</span>'
      : `<span class="pill pill-ok">reviewed</span><div class="muted" style="font-size:10.5px">${esc(String(r.overReviewedBy || '').split('@')[0])}</div>`}</td>`
    + `<td>${can && r.overStatus === 'open' ? `<button class="ghost" data-fgoverok="${esc(fgiRowId(r))}" style="padding:2px 9px;font-size:12px">Mark reviewed</button>` : ''}</td>`
    + '</tr>').join('') : '<tr><td colspan="11" class="muted" style="padding:16px">Nothing has come in above its order.</td></tr>') + '</tbody>';
  const open = all.filter(r => r.overStatus === 'open');
  $('fgMsg').className = open.length ? 'err' : 'muted';
  $('fgMsg').textContent = `${nf(open.length)} receipt(s) above their order waiting for review · ${nf(open.reduce((t, r) => t + fgiNum(r.overQty), 0))} extra piece(s)`
    + ` · ${nf(all.length - open.length)} already reviewed · the extra pieces are in stock either way`;
  ptImgFill(all.map(r => r.sku), false, ptImgPatch);
}

async function fgiOverReview(id) {
  if (!fgiCanEdit()) return FGI_NO_EDIT;
  const r = (FGI.rows || []).find(x => fgiRowId(x) === id); if (!r) return 'That receipt is gone.';
  if (r.overStatus !== 'open') return 'That one is already reviewed.';
  const at = new Date().toISOString();
  await ptPatch({ ['pt_fgiLedger/' + id + '/overStatus']: 'reviewed', ['pt_fgiLedger/' + id + '/overReviewedBy']: ME.email,
    ['pt_fgiLedger/' + id + '/overReviewedAt']: at });
  Object.assign(r, { overStatus: 'reviewed', overReviewedBy: ME.email, overReviewedAt: at });
  fgiOverBadge();
  renderFgi();
  return '';
}

/* ================= FINISHED GOODS: EXTERNAL ORDERS =================
 *
 * Ravi: "abhi bhi external order ke liye koi identifier nahi h". A receive now says where its order came
 * from — Order Console or External — as a choice on the form, and an external order carries its own
 * identity: the number (the customer's or platform's, or one made here as EXT-DDMMYYYY-NN), who placed it
 * (extOrderFrom), and, if known, how many pieces it asked for (extOrderQty). With a quantity, receiving
 * past it needs a reason and is flagged exactly like an Order Console order.
 */

/** An external order as the store knows it: the quantity typed now, else the one saved with an earlier receipt. */
function fgiExtOrder(orderNo, sku, typedQty) {
  const no = obUC(orderNo); if (!no) return null;
  const rows = (FGI.rows || []).filter(r => r && r.txnType === 'RECEIVE' && obUC(r.orderNo) === no && obUC(r.sku) === obUC(sku));
  const saved = rows.map(r => parseInt(r.extOrderQty, 10)).find(n => n >= 1) || 0;
  const qty = parseInt(typedQty, 10) >= 1 ? parseInt(typedQty, 10) : saved;
  const got = rows.reduce((t, r) => t + fgiNum(r.qty), 0);
  return { orderNo: no, qty, got, left: qty ? Math.max(0, qty - got) : 0, from: (rows.find(r => r.extOrderFrom) || {}).extOrderFrom || '' };
}

/** A number for an external order that came without one: EXT-DDMMYYYY-NN, the next free for that day. */
function fgiExtNewNo(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  const p = n => String(n).padStart(2, '0');
  const base = `EXT-${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}-`;
  const used = new Set((FGI.rows || []).map(r => obUC(r && r.orderNo)).filter(n => n.startsWith(base)));
  let i = 1;
  while (used.has(base + p(i))) i++;
  return base + p(i);
}

/* ================= FINISHED GOODS: SCANNING =================
 *
 * Ravi: "mujhe inventory in out ke liye scanner use krna h … FNSKU".
 *
 * ANY USB OR BLUETOOTH SCANNER IN KEYBOARD (HID) MODE WORKS — it types the code and presses Enter,
 * which is all this screen waits for. Nothing is installed, and no scanner is talked to directly.
 *
 * WHAT IS ON THE LABEL IS THE FNSKU (X00…), not the SKU, so a scan is resolved through a map:
 *   pt_fnskuMap = { at, by, n, src, list: "FNSKU\tSKU\n…" }
 * It is filled either from Amazon's FBA Inventory Planning report through the backend ("Refresh from
 * Amazon" — the report carries the fnsku column), or by uploading / pasting that report when the
 * backend cannot be reached. A scan that is neither a known SKU nor a known FNSKU is never guessed:
 * it is listed as unknown and counted, so nobody finds out at the end of a shift.
 *
 * ONE SCAN IS ONE PIECE (or whatever "pieces per scan" says). Every scan adds to a line per SKU; the
 * lines are saved together as one PATCH — one ledger row per SKU, exactly like typing them in, with
 * the same rules: an issue or a dispatch cannot take more than the store holds, a receive needs its
 * order, and pieces past the order need their reason.
 */
let FN = { map: null, at: '', n: 0, src: '' };
let FGS = { type: 'RECEIVE', rows: new Map(), unknown: new Map(), last: '' };

function fnParse(idx) {
  const m = new Map();
  String((idx && idx.list) || '').split('\n').forEach(line => {
    if (!line) return;
    const [f, s] = line.split('\t');
    if (f && s) m.set(obUC(f), obUC(s));
  });
  return m;
}
async function fnLoad() {
  try {
    const v = await ptGet('pt_fnskuMap');
    FN = { map: fnParse(v), at: (v && v.at) || '', n: (v && v.n) || 0, src: (v && v.src) || '' };
  } catch (e) { FN.map = FN.map || new Map(); }
  return FN.map;
}
/** What a scanned code is: a SKU we know, an FNSKU we can translate, or nothing. */
function fgiScanResolve(code) {
  const c = obUC(code);
  if (!c) return { sku: '', how: '' };
  if ((PTG.mdb || []).some(r => r && obUC(r.sku) === c)) return { sku: c, how: 'sku' };
  const byFn = (FN.map || new Map()).get(c);
  if (byFn) return { sku: byFn, how: 'fnsku' };
  return { sku: '', how: '' };
}

/** Amazon's FBA Inventory Planning report, through the backend: it is the only place the FNSKU is. */
async function fnRefresh(say) {
  if (!(PRAPI && PRAPI.url)) return 'This account cannot reach the Amazon backend — upload the report instead.';
  const tell = t => { if (say) say(t); };
  const lines = [];
  let sawColumn = false;
  for (const brand of ['SP', 'CPC']) {
    tell(`Asking Amazon for the ${brand === 'SP' ? 'Ridhi' : 'CPC'} inventory report…`);
    const cr = await prGet({ age: 'create', brand });
    let done = null;
    for (let i = 0; i < 180 && !done; i++) {
      await new Promise(r => setTimeout(r, 10000));
      const p = await prGet({ age: 'poll', brand, id: cr.reportId });
      if (p.status === 'done') done = p;
      else tell(`${brand === 'SP' ? 'Ridhi' : 'CPC'} inventory report is being built… ${i + 1}`);
    }
    if (!done) throw new Error(`Amazon did not finish the ${brand} inventory report in time.`);
    (done.rows || []).forEach(r => {
      if (!r || !r.sku) return;
      if (r.fnsku) { sawColumn = true; lines.push(obUC(r.fnsku) + '\t' + obUC(r.sku)); }
    });
  }
  if (!sawColumn) return 'The backend answered without an FNSKU column — it has not been updated yet. Upload the report instead, or ask for the backend to be pushed.';
  const at = new Date().toISOString();
  await ptPut('pt_fnskuMap', { at, by: ME.email, n: lines.length, src: 'Amazon FBA inventory report', list: lines.join('\n') });
  FN = { map: fnParse({ list: lines.join('\n') }), at, n: lines.length, src: 'Amazon FBA inventory report' };
  return '';
}

/** The same report as a file or as pasted text: any two columns named like sku and fnsku. */
function fnFromRows(rows) {
  if (!rows || !rows.length) return { lines: [], why: 'The file had no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const fi = head.findIndex(h => /^fn.?sku$/.test(h) || h === 'fulfillment-channel-sku' || h === 'fulfilment-channel-sku');
  const si = head.findIndex(h => h === 'sku' || h === 'seller-sku' || h === 'msku' || h === 'merchant-sku');
  if (fi < 0 || si < 0) return { lines: [], why: 'Could not find an "fnsku" column and a "sku" column in the first row.' };
  const lines = [];
  rows.slice(1).forEach(r => {
    const f = obUC(r[fi]), s = obUC(r[si]);
    if (f && s) lines.push(f + '\t' + s);
  });
  return { lines, why: lines.length ? '' : 'No rows carried both an FNSKU and a SKU.' };
}
async function fnSave(lines, src) {
  const at = new Date().toISOString();
  await ptPut('pt_fnskuMap', { at, by: ME.email, n: lines.length, src, list: lines.join('\n') });
  FN = { map: fnParse({ list: lines.join('\n') }), at, n: lines.length, src };
}

/* ---- the scanning screen ---- */
function fgiScanOpen() {
  if (!fgiCanEntry()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = FGI_NO_ENTRY; return; }
  FGS = { type: 'RECEIVE', rows: new Map(), unknown: new Map(), last: '', q: null };
  ptOpenDialog({
    title: 'Scan stock in or out',
    subtitle: 'Any scanner in keyboard mode: it types the code and presses Enter',
    note: 'Scan the FNSKU label on the piece (or type a SKU). Each scan adds pieces to that SKU. Nothing is '
      + 'saved until "Save all" — then one entry per SKU, with the same checks as the entry form.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label><span>Type <b style="color:var(--bad)">*</b></span><select id="fgsType">${Object.keys(FGI_KINDS).map(t =>
          `<option value="${t}"${t === 'RECEIVE' ? ' selected' : ''}>${esc(FGI_KINDS[t].label)}</option>`).join('')}</select></label>
        <label>Date<input id="fgsDate" type="date" value="${esc(dToday())}"></label>
        <label><span>Pieces per scan</span><input id="fgsPer" type="number" min="1" step="1" value="1"></label>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:7px">
          <input id="fgsAuto" type="checkbox" checked style="width:auto">
          <span style="font-size:12.5px">Enter each scan straight away</span></label>
      </div>
      <div id="fgsOrdWrap" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;padding:10px;border:1px solid var(--line);border-radius:10px">
        <label><span>Order from <b style="color:var(--bad)">*</b></span><select id="fgsOrdSrc">
          <option value="console">Order Console</option><option value="external">External order</option></select></label>
        <label><span id="fgsOrdLbl">Order No <b style="color:var(--bad)">*</b></span>
          <input id="fgsOrd" list="fgsOrdList" style="font-family:ui-monospace,monospace;text-transform:uppercase">
          <datalist id="fgsOrdList"></datalist></label>
        <label id="fgsExtWrap" class="hide"><span>Customer / platform <b style="color:var(--bad)">*</b></span>
          <input id="fgsExtFrom" placeholder="e.g. Etsy, Walmart"></label>
      </div>
      <div id="fgsOutWrap" class="hide" style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">
        <label id="fgsWhoWrap"><span><span id="fgsWhoLbl">Issued to</span> <b style="color:var(--bad)">*</b></span><input id="fgsWho" placeholder="a name"></label>
        <label id="fgsAcctWrap" class="hide"><span>FBA account <b style="color:var(--bad)">*</b></span>
          <select id="fgsAcct">${['', ...FGI_FBA_ACCOUNTS].map(a => `<option value="${esc(a)}">${esc(a || '— pick the account —')}</option>`).join('')}</select></label>
        <label id="fgsHandWrap" class="hide"><span>Handover to</span><input id="fgsHand" placeholder="who took the pieces"></label>
      </div>
      <div style="margin-top:12px;padding:10px;border:2px solid var(--accent,#0f172a);border-radius:10px">
        <div id="fgsMode" style="font-weight:800;font-size:13px;letter-spacing:.04em;margin-bottom:8px"></div>
        <label style="display:block"><span style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--muted)">Scan here</span>
          <input id="fgsCode" placeholder="scan the label, or type a SKU and press Enter" style="font-family:ui-monospace,monospace;font-size:16px"></label>
        <div id="fgsMsg" class="muted" style="margin-top:6px;font-size:12.5px"></div>
      </div>
      <div class="xlwrap" style="max-height:38vh;margin-top:10px"><table class="xl" id="fgsTable"></table></div>
      <div id="fgsFn" class="muted" style="margin-top:8px;font-size:12px"></div>`,
    onSave: () => fgiScanSave(),
    saveLabel: 'Save all',
  });
  const t = $('fgsType');
  if (t && t.addEventListener) t.addEventListener('change', () => { FGS.type = t.value; fgiScanRender(); });
  const src = $('fgsOrdSrc');
  if (src && src.addEventListener) src.addEventListener('change', fgiScanRender);
  const au = $('fgsAuto');
  if (au && au.addEventListener) au.addEventListener('change', fgiScanRender);
  const box = $('fgsCode');
  if (box && box.addEventListener) box.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.preventDefault) e.preventDefault();
    fgiScanAdd(box.value);
    box.value = '';
  });
  fgiScanRender();
  if (box && box.focus) box.focus();
}

/** One scan: a piece of something, or a code nobody knows. */
function fgiScanAdd(code, per) {
  const c = obUC(code); if (!c) return '';
  const n = Math.max(1, parseInt(per != null ? per : (($('fgsPer') || {}).value), 10) || 1);
  const hit = fgiScanResolve(c);
  if (!hit.sku) {
    FGS.unknown.set(c, (FGS.unknown.get(c) || 0) + n);
    FGS.last = `NOT KNOWN: ${c} — not a SKU, and not an FNSKU in the list`;
    fgiScanRender();
    return '';
  }
  const row = FGS.rows.get(hit.sku) || { sku: hit.sku, qty: 0, how: hit.how, over: '' };
  row.qty += n;
  FGS.rows.set(hit.sku, row);
  const m = fgiMaster(hit.sku);
  FGS.last = `${hit.sku} +${nf(n)} = ${nf(row.qty)}${hit.how === 'fnsku' ? ` (from FNSKU ${c})` : ''}`
    + ` · ${[m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')}`;
  if (fgiScanAuto()) FGS.q = Promise.resolve(FGS.q).then(() => fgiScanFlush(hit.sku)).then(() => fgiScanRender());
  fgiScanRender();
  return hit.sku;
}

/** Is each scan entered on its own, or does the whole list wait for "Save all"? */
function fgiScanAuto() {
  const b = $('fgsAuto');
  return b ? !!b.checked : true;
}

/** Everything the dialog says about this batch, read once and checked once, so the scan that enters
 *  itself and the list that waits for "Save all" ask exactly the same questions. */
function fgiScanHead() {
  const t = ($('fgsType') || {}).value || FGS.type;
  const k = FGI_KINDS[t];
  if (!k) return { err: 'Pick what kind of movement this is.' };
  const iso = ($('fgsDate') || {}).value || dToday();
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const h = { t, k, err: '', date: m ? `${m[3]}/${m[2]}/${m[1]}` : iso, who: '', hand: '', orderNo: '', orderSource: '', extFrom: '' };
  if (t === 'FBA') {
    h.who = String(($('fgsAcct') || {}).value || '').trim();
    if (FGI_FBA_ACCOUNTS.indexOf(h.who) < 0) return { err: `Pick the FBA account — ${FGI_FBA_ACCOUNTS.join(' or ')}.` };
    h.hand = String(($('fgsHand') || {}).value || '').trim();
  } else if (k.dir < 0) {
    h.who = String(($('fgsWho') || {}).value || '').trim();
    if (!h.who) return { err: 'Say who or what these are for.' };
  } else {
    h.who = String(($('fgsWho') || {}).value || '').trim() || 'Scanned in';
    h.orderNo = obUC(($('fgsOrd') || {}).value);
    h.orderSource = ($('fgsOrdSrc') || {}).value === 'external' ? 'external' : 'console';
    if (!h.orderNo) return { err: h.orderSource === 'external' ? 'Put in the external order number.' : 'Pick the Order Console order these pieces were received against.' };
    if (h.orderSource === 'external') {
      if (fgiOrderKnown(h.orderNo)) return { err: `${h.orderNo} is an Order Console order — choose "Order Console".` };
      h.extFrom = String(($('fgsExtFrom') || {}).value || '').trim();
      if (!h.extFrom) return { err: 'Say who placed the external order.' };
    }
  }
  return h;
}

/** The pieces scanned for one SKU that are not in the ledger yet, entered now. The first scan makes
 *  the entry; every scan after it adds to that same entry, so one batch leaves one row per SKU.
 *  Anything the form would refuse is refused here too — those pieces stay on the screen, unentered,
 *  with the reason on the row, and go in the moment the reason is given. */
async function fgiScanFlush(sku) {
  const r = FGS.rows.get(sku);
  if (!r) return '';
  const n = fgiNum(r.qty) - fgiNum(r.saved);
  if (n <= 0) { r.why = ''; return ''; }
  const stop = why => { r.why = why; FGS.last = `${sku}: ${why}`; return why; };
  if (!fgiCanEntry()) return stop(FGI_NO_ENTRY);
  const h = fgiScanHead();
  if (h.err) return stop(h.err);
  if (!(PTG.mdb || []).some(x => x && obUC(x.sku) === sku)) return stop(`${sku} is not in the master database.`);
  let over = 0, ordered = 0;
  if (h.k.dir < 0) {
    const have = fgiOf(sku).current;
    if (n > have) return stop(`You don't have enough stock — ${sku} has ${nf(have)} piece(s) in the India Store`
      + ` and this scan asks for ${nf(n)}.`);
  } else if (h.orderSource === 'console') {
    const o = fgiOrdersFor(sku).find(x => x.orderNo === h.orderNo);
    if (!o) return stop(`${h.orderNo} has no line for ${sku}. Take it off the list, or pick the right order.`);
    if (o.got + n > o.qty) {
      over = Math.min(n, o.got + n - o.qty);
      ordered = o.qty;
      if (!String(r.over || '').trim()) return stop(`${nf(over)} piece(s) more than ${h.orderNo} ordered — say why, then they go in.`);
    }
  }
  const old = r.id ? (FGI.rows || []).find(x => fgiRowId(x) === r.id) : null;
  /* A SCAN LEAVES FOR ORDERS TOO (2026-09-25), dealt the Auto way; more scans of the same SKU add to the same parts. */
  const al = h.k.dir < 0 ? fgiOutAlloc(sku, n, h.t, '') : null;
  if (old) {
    const next = { qty: fgiNum(old.qty) + n };
    if (al && al.orders.length) {
      const m = new Map(fgiOutParts(old).map(p => [p.orderNo, p.qty]));
      al.orders.forEach(p => m.set(p.orderNo, (m.get(p.orderNo) || 0) + p.qty));
      next.orders = [...m].map(([orderNo, qty]) => ({ orderNo, qty }));
    }
    if (over) {
      next.overQty = fgiNum(old.overQty) + over;
      next.overOrdered = ordered;
      next.overReason = String(r.over).trim();
      next.overStatus = 'open';
    }
    const patch = {};
    Object.keys(next).forEach(f => { patch[`pt_fgiLedger/${r.id}/${f}`] = next[f]; });
    await ptPatch(patch);
    Object.assign(old, next);
  } else {
    const rec = { _id: fgiNewId(h.t === 'FBA' ? 'FBA' : (h.t === 'ISSUE' ? 'ISS' : 'RCP')),
      txnType: h.t, sku, qty: n, date: h.date, reason: '', scanned: true,
      ...(al && al.orders.length ? { orders: al.orders } : {}),
      ...(h.t === 'FBA' && h.hand ? { handoverTo: h.hand } : {}),
      ...(h.orderNo ? { orderNo: h.orderNo, orderSource: h.orderSource } : {}),
      ...(h.orderSource === 'external' ? { extOrderFrom: h.extFrom } : {}),
      ...(over ? { overQty: over, overOrdered: ordered, overReason: String(r.over).trim(), overStatus: 'open' } : {}),
      [h.k.dir < 0 ? 'issuedFor' : 'receivedFrom']: h.who,
      remarks: 'scanned', createdAt: new Date().toISOString(), createdBy: ME.email };
    await ptPatch({ ['pt_fgiLedger/' + rec._id]: rec });
    FGI.rows = (FGI.rows || []).concat([rec]);
    r.id = rec._id;
  }
  r.saved = fgiNum(r.qty);
  r.why = '';
  FGS.last = `${sku} — ${h.t === 'FBA' ? 'sent to FBA' : (h.k.dir < 0 ? 'issued' : 'received')} ${nf(n)}, ${nf(r.saved)} in this batch`;
  const line = await lstAlertFor(sku, h.t, n);
  if (line) FGS.last += ' ⚠ not listed on Amazon — the listing team has been told';
  fbaBadge(); fgiOverBadge();
  return '';
}

/** Scanned the wrong thing? The entry this batch made for that SKU goes away again, pieces and all.
 *  It is only ever this batch's own row, which is why it does not need the right to edit. */
async function fgiScanUndo(sku) {
  const r = FGS.rows.get(sku);
  if (!r) return '';
  if (r.id) {
    const rec = (FGI.rows || []).find(x => fgiRowId(x) === r.id);
    if (rec && String(rec.createdBy || '') !== ME.email && !fgiCanEdit()) return 'Somebody else made that entry.';
    await ptPatch({ ['pt_fgiLedger/' + r.id]: null });
    FGI.rows = (FGI.rows || []).filter(x => fgiRowId(x) !== r.id);
    FGS.last = `${sku} — the entry for ${nf(fgiNum(r.saved))} piece(s) has been taken back.`;
    fbaBadge(); fgiOverBadge();
    renderFgi();
  }
  FGS.rows.delete(sku);
  fgiScanRender();
  return '';
}

/** What the ledger actually holds for this scanned SKU, said on its row. */
function fgiScanState(r) {
  if (r.why) return `<div class="err" style="font-size:11px">${esc(r.why)}</div>`;
  if (r.id && fgiNum(r.saved) >= fgiNum(r.qty)) return `<div style="font-size:11px;color:var(--accent)">entered · ${nf(fgiNum(r.saved))} pc</div>`;
  return '<div class="muted" style="font-size:11px">waiting</div>';
}

function fgiScanRender() {
  const t = ($('fgsType') || {}).value || FGS.type || 'RECEIVE';
  FGS.type = t;
  const out = FGI_KINDS[t] && FGI_KINDS[t].dir < 0;
  const src = ($('fgsOrdSrc') || {}).value === 'external' ? 'external' : 'console';
  if ($('fgsOrdWrap')) $('fgsOrdWrap').classList.toggle('hide', t !== 'RECEIVE');
  if ($('fgsOutWrap')) $('fgsOutWrap').classList.toggle('hide', !out);
  if ($('fgsExtWrap')) $('fgsExtWrap').classList.toggle('hide', src !== 'external');
  if ($('fgsOrdLbl')) $('fgsOrdLbl').innerHTML = (src === 'external' ? 'External order no' : 'Order No') + ' <b style="color:var(--bad)">*</b>';
  if ($('fgsWhoWrap')) $('fgsWhoWrap').classList.toggle('hide', t === 'FBA');
  if ($('fgsAcctWrap')) $('fgsAcctWrap').classList.toggle('hide', t !== 'FBA');
  if ($('fgsHandWrap')) $('fgsHandWrap').classList.toggle('hide', t !== 'FBA');
  if ($('fgsWhoLbl')) $('fgsWhoLbl').textContent = (FGI_KINDS[t] || FGI_KINDS.ISSUE).who;

  /* The orders these scanned SKUs belong to, so the box can be picked rather than typed. */
  const list = $('fgsOrdList');
  if (list) {
    const seen = new Map();
    [...FGS.rows.keys()].forEach(sku => fgiOrdersFor(sku).forEach(o => { if (!seen.has(o.orderNo)) seen.set(o.orderNo, o); }));
    list.innerHTML = [...seen.values()].map(o => `<option value="${esc(o.orderNo)}">${esc(o.date || '')}</option>`).join('');
  }
  const auto = fgiScanAuto();
  if ($('fgsMode')) {
    $('fgsMode').innerHTML = `<span style="color:${t === 'RECEIVE' ? 'var(--accent)' : 'var(--bad)'}">`
      + `${t === 'RECEIVE' ? '▼ RECEIVING · in' : (t === 'FBA' ? '▲ FBA OUT' : '▲ ISSUE · out')}</span>`
      + `<span class="muted" style="font-weight:400;margin-left:10px">`
      + `${auto ? 'every scan is entered the moment it is scanned' : 'nothing is entered until "Save all"'}</span>`;
  }
  const ord = obUC(($('fgsOrd') || {}).value);
  const rows = [...FGS.rows.values()];
  const head = '<thead><tr>' + ['SKU', 'Item', 'Pieces', t === 'RECEIVE' ? 'Order' : 'In stock', auto ? 'Entry' : 'Note', '']
    .map((h, i) => `<th${i === 2 ? ' class="num"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  $('fgsTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(r => {
    const m = fgiMaster(r.sku), have = fgiOf(r.sku).current;
    const o = t === 'RECEIVE' && src === 'console' && ord ? fgiOrdersFor(r.sku).find(x => x.orderNo === ord) : null;
    /* What is entered already counts on the order and against the store, so only the pieces still
     * waiting are weighed here — otherwise a scan is held against itself. */
    const want = auto ? fgiNum(r.qty) - fgiNum(r.saved) : r.qty;
    const over = o ? Math.max(0, o.got + want - o.qty) : 0;
    const short = FGI_KINDS[t] && FGI_KINDS[t].dir < 0 && want > have;
    return '<tr>'
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}${r.how === 'fnsku' ? '<div class="muted" style="font-size:10px">by FNSKU</div>' : ''}</td>`
      + `<td style="text-align:left">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}</td>`
      + `<td class="num">${auto ? nf(r.qty) : `<input data-fgsqty="${esc(r.sku)}" type="number" min="1" step="1" value="${r.qty}" style="width:80px">`}</td>`
      + `<td style="text-align:left;font-size:12px">${t === 'RECEIVE'
        ? (o ? `ordered ${nf(o.qty)} · received ${nf(o.got)} · left ${nf(o.left)}` : (src === 'external' ? '<span class="muted">external</span>' : '<span class="err">not on this order</span>'))
        : `${nf(have)}${short ? ' <span class="err">— not enough</span>' : ''}`}</td>`
      + `<td style="text-align:left">${over ? `<input data-fgsover="${esc(r.sku)}" value="${esc(r.over || '')}" placeholder="why ${nf(over)} extra? *" style="border-color:var(--bad);min-width:160px">` : ''}${auto ? fgiScanState(r) : ''}</td>`
      + `<td><button class="ghost" data-fgsdel="${esc(r.sku)}" title="${auto ? 'take this entry back' : 'take it off the list'}" style="padding:1px 8px;font-size:13px;color:var(--bad)">×</button></td>`
      + '</tr>';
  }).join('') : '<tr><td colspan="6" class="muted" style="padding:14px">Nothing scanned yet.</td></tr>')
    + [...FGS.unknown.entries()].map(([c, n]) => `<tr><td colspan="6" class="err" style="text-align:left">Unknown code: ${esc(c)} × ${nf(n)}`
      + ` <button class="ghost" data-fgsforget="${esc(c)}" style="padding:1px 8px;font-size:12px">forget</button></td></tr>`).join('') + '</tbody>';
  const total = rows.reduce((s, r) => s + r.qty, 0);
  $('fgsMsg').className = /NOT KNOWN/.test(FGS.last) ? 'err' : 'muted';
  $('fgsMsg').textContent = FGS.last || 'Waiting for a scan…';
  $('fgsFn').innerHTML = `${nf(rows.length)} SKU(s) · ${nf(total)} piece(s) scanned`
    + (auto ? ` · ${nf(rows.filter(r => r.id).length)} entered` : '')
    + ` · FNSKU list: ${FN.n ? `${nf(FN.n)} codes, ${esc(String(FN.at).slice(0, 10))}` : '<b class="err">empty — scans of FNSKU labels will not be recognised</b>'}`
    + ` <button class="ghost" id="fgsFnFix" style="padding:1px 8px;font-size:12px">FNSKU list</button>`;
  if ($('fgsFnFix')) $('fgsFnFix').onclick = () => fnOpen();
}

async function fgiScanSave() {
  if (!fgiCanEntry()) return FGI_NO_ENTRY;
  if (FGS.unknown.size) return `${nf(FGS.unknown.size)} scanned code(s) are not known — remove them (×) or add them to the FNSKU list first.`;
  const auto = fgiScanAuto();
  const rows = [...FGS.rows.values()].filter(r => fgiNum(r.qty) > (auto ? fgiNum(r.saved) : 0));

  /* Every scan went in as it was made; all that can be left is what a missing reason held back. */
  if (auto) {
    const all = [...FGS.rows.values()];
    if (!rows.length && !all.some(r => r.id)) return 'Nothing is scanned yet.';
    for (const r of rows) {
      const why = await fgiScanFlush(r.sku);
      if (why) { fgiScanRender(); return `${r.sku}: ${why}`; }
    }
    const total = all.reduce((sum, r) => sum + fgiNum(r.saved), 0);
    const over = all.filter(r => String(r.over || '').trim()).length;
    FGS.rows = new Map(); FGS.unknown = new Map(); FGS.last = '';
    fbaBadge(); fgiOverBadge();
    renderFgi();
    $('fgMsg').className = over ? 'err' : 'muted';
    $('fgMsg').textContent = `Scanned ${nf(total)} piece(s) across ${nf(all.length)} SKU(s) — each one entered as it was scanned.`
      + (over ? ` ⚠ ${nf(over)} SKU(s) came in above the order — flagged for review.` : '');
    return '';
  }

  if (!rows.length) return 'Nothing is scanned yet.';
  const h = fgiScanHead();
  if (h.err) return h.err;

  const updates = {}, recs = [];
  for (const r of rows) {
    if (!(PTG.mdb || []).some(x => x && obUC(x.sku) === r.sku)) return `${r.sku} is not in the master database.`;
    const al = h.k.dir < 0 ? fgiOutAlloc(r.sku, r.qty, h.t, '') : null;
    let overQty = 0, overOrdered = 0;
    if (h.k.dir < 0) {
      const have = fgiOf(r.sku).current;
      if (r.qty > have) return `You don't have enough stock — ${r.sku} has ${nf(have)} piece(s) in the India Store`
        + ` and the scan says ${nf(r.qty)}.`;
    } else if (h.orderSource === 'console') {
      const o = fgiOrdersFor(r.sku).find(x => x.orderNo === h.orderNo);
      if (!o) return `${h.orderNo} has no line for ${r.sku}. Take it off the list, or pick the right order.`;
      if (o.got + r.qty > o.qty) {
        overQty = Math.min(r.qty, o.got + r.qty - o.qty);
        overOrdered = o.qty;
        if (!String(r.over || '').trim()) return `${r.sku}: ${nf(overQty)} piece(s) more than ${h.orderNo} ordered — say why in the row.`;
      }
    }
    const rec = { _id: fgiNewId(h.t === 'FBA' ? 'FBA' : (h.t === 'ISSUE' ? 'ISS' : 'RCP')),
      txnType: h.t, sku: r.sku, qty: r.qty, date: h.date, reason: '', scanned: true,
      ...(al && al.orders.length ? { orders: al.orders } : {}),
      ...(h.t === 'FBA' && h.hand ? { handoverTo: h.hand } : {}),
      ...(h.orderNo ? { orderNo: h.orderNo, orderSource: h.orderSource } : {}),
      ...(h.orderSource === 'external' ? { extOrderFrom: h.extFrom } : {}),
      ...(overQty ? { overQty, overOrdered, overReason: String(r.over).trim(), overStatus: 'open' } : {}),
      [h.k.dir < 0 ? 'issuedFor' : 'receivedFrom']: h.who,
      remarks: 'scanned', createdAt: new Date().toISOString(), createdBy: ME.email };
    updates['pt_fgiLedger/' + rec._id] = rec;
    recs.push(rec);
  }
  await ptPatch(updates);
  FGI.rows = (FGI.rows || []).concat(recs);
  const notListed = [];
  for (const rec of recs) { const line = await lstAlertFor(rec.sku, h.t, rec.qty); if (line) notListed.push(rec.sku); }
  FGS.rows = new Map(); FGS.unknown = new Map(); FGS.last = '';
  fbaBadge(); fgiOverBadge();
  renderFgi();
  const total = recs.reduce((sum, r) => sum + r.qty, 0);
  const over = recs.filter(r => r.overQty).length;
  $('fgMsg').className = over || notListed.length ? 'err' : 'muted';
  $('fgMsg').textContent = `Scanned ${nf(total)} piece(s) across ${nf(recs.length)} SKU(s) — ${h.t === 'FBA' ? 'sent to FBA' : (h.t === 'ISSUE' ? 'issued' : 'received')}`
    + (h.orderNo ? ` against ${h.orderNo}` : '') + '.'
    + (over ? ` ⚠ ${nf(over)} SKU(s) came in above the order — flagged for review.` : '')
    + (notListed.length ? ` ⚠ ${nf(notListed.length)} SKU(s) are not listed on Amazon — the listing team has been alerted.` : '');
  return '';
}

/* ---- the FNSKU list ---- */
function fnOpen() {
  ptOpenDialog({
    title: 'FNSKU list',
    subtitle: FN.n ? `${nf(FN.n)} codes · ${esc(String(FN.at).replace('T', ' ').slice(0, 16))} · ${esc(FN.src || '')}` : 'empty',
    note: 'The label on a piece carries its FNSKU (X00…), not its SKU. This list turns one into the other. '
      + 'Amazon keeps it in the FBA Inventory Planning report: pull it here, or download it from Seller Central '
      + '(Reports → Fulfilment → Inventory Planning) and upload it.',
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
        <label><span>Paste the report (or any two columns with headers "fnsku" and "sku")</span>
          <textarea id="fnPaste" rows="4" placeholder="fnsku&#9;sku&#10;X001ABCDEF&#9;RTC327-5270"></textarea></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" id="fnUp" class="ghost">Upload the report file</button>
        <input id="fnFile" type="file" accept=".csv,.tsv,.txt,.xlsx" class="hide">
        <button type="button" id="fnPull" class="ghost">Refresh from Amazon</button>
      </div>
      <div id="fnMsg" class="muted" style="margin-top:8px;font-size:12.5px"></div>`,
    onSave: () => fnSaveFromPaste(),
    saveLabel: 'Save the pasted list',
  });
  const say = (t, bad) => { if ($('fnMsg')) { $('fnMsg').className = bad ? 'err' : 'muted'; $('fnMsg').textContent = t; } };
  if ($('fnUp')) $('fnUp').onclick = () => $('fnFile') && $('fnFile').click && $('fnFile').click();
  if ($('fnFile')) $('fnFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    say('Reading ' + f.name + '…');
    try {
      const rows = await pkReadFile(f);
      const got = fnFromRows(rows);
      if (!got.lines.length) return say(got.why, true);
      await fnSave(got.lines, 'file: ' + f.name);
      say(`${nf(got.lines.length)} codes saved.`);
      fgiScanRender();
    } catch (err) { say('Could not read it: ' + (err.message || err), true); }
  };
  if ($('fnPull')) $('fnPull').onclick = async () => {
    say('Asking Amazon — the report takes a few minutes…');
    try {
      const why = await fnRefresh(t => say(t));
      if (why) return say(why, true);
      say(`${nf(FN.n)} codes saved from Amazon.`);
      fgiScanRender();
    } catch (err) { say('Not refreshed: ' + (err.message || err), true); }
  };
}

async function fnSaveFromPaste() {
  const text = String((($('fnPaste') || {}).value) || '').trim();
  if (!text) return 'Paste the report first, or use Upload / Refresh.';
  const rows = text.split(/\r?\n/).map(l => l.split(/\t|,/));
  const got = fnFromRows(rows);
  if (!got.lines.length) return got.why;
  await fnSave(got.lines, 'pasted');
  fgiScanRender();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `FNSKU list saved — ${nf(got.lines.length)} codes.`;
  return '';
}

$('ptDlgBody').addEventListener('click', e => {
  const d = e.target.closest('[data-fgsdel]');
  if (d) {
    const sku = d.getAttribute('data-fgsdel');
    if (fgiScanAuto()) { FGS.q = Promise.resolve(FGS.q).then(() => fgiScanUndo(sku)); return; }
    FGS.rows.delete(sku);
    return fgiScanRender();
  }
  const f = e.target.closest('[data-fgsforget]');
  if (f) { FGS.unknown.delete(f.getAttribute('data-fgsforget')); return fgiScanRender(); }
});
$('ptDlgBody').addEventListener('input', e => {
  const q = e.target.closest('[data-fgsqty]');
  if (q) {
    const r = FGS.rows.get(q.getAttribute('data-fgsqty'));
    if (r) r.qty = Math.max(0, parseInt(q.value, 10) || 0);
    return;
  }
  const o = e.target.closest('[data-fgsover]');
  if (o) { const r = FGS.rows.get(o.getAttribute('data-fgsover')); if (r) r.over = o.value; }
});
$('ptDlgBody').addEventListener('change', e => {
  const o = e.target.closest('[data-fgsover]');
  if (!o || !fgiScanAuto()) return;
  const r = FGS.rows.get(o.getAttribute('data-fgsover'));
  if (!r) return;
  r.over = o.value;
  FGS.q = Promise.resolve(FGS.q).then(() => fgiScanFlush(r.sku)).then(() => fgiScanRender());
});

