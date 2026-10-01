/* ================= FINISHED GOODS: THE OTHER MOVEMENTS =================
 *
 * Press is not the only way stock arrives, and a shipment is not the same thing as an issue. Three
 * more movements, and the ability to undo any of them.
 *
 *   RECEIVE  stock arriving from anywhere that is not the press — a return, a rework, a purchase.
 *   FBA      pieces dispatched to Amazon. An issue in every arithmetic sense, kept as its own type
 *            so "how much went to Amazon this month" is one filter and not a guess at a free-text
 *            destination field.
 *
 * DELETING A MOVEMENT MOVES THE STOCK BACK, because the stock IS the movements — there is no stored
 * balance to correct. That is the whole reason this is a ledger.
 */
const FGI_IN = ['OPENING', 'RECEIVE'];
const FGI_OUT = ['ISSUE', 'FBA'];

/* ---- one entry form, the way the pillow tracker does it ----
 *
 * ONE FORM, A TYPE AT THE TOP: Receive (in), Issue (out), Send to FBA (out). Three buttons for what
 * is one decision made people pick the button before they had thought about the movement.
 *
 * TWO WARNINGS BEFORE IT SAVES, both carried over from the pillow tracker because both catch a real
 * mistake people actually make:
 *   · the SAME SKU, the SAME type, to the SAME person, ALREADY entered today — almost always the
 *     same delivery being written down twice;
 *   · this SKU was already moved the OTHER WAY today — a receive on a day it was issued is usually
 *     the wrong type picked, not a genuine round trip.
 * Neither blocks. Both say exactly what is already there, and let the person decide.
 */
const FGI_KINDS = {
  RECEIVE: { label: 'Receive · in', dir: 1, who: 'Received from', verb: 'Receive them' },
  ISSUE: { label: 'Issue · out', dir: -1, who: 'Issued to', verb: 'Issue them' },
  FBA: { label: 'Send to FBA · out', dir: -1, who: 'FBA account', verb: 'Send them' },
};

/** The FBA accounts a dispatch can go to. */
const FGI_FBA_ACCOUNTS = ['Ridhi FBA', 'CPC FBA'];
/** The account a SKU's brand ships to: CPC → CPC FBA, RBP (Ridhi) → Ridhi FBA; anything else is left to pick. */
function fgiFbaAcctFor(sku) {
  const b = String((mdbOf(sku) || {}).brand || '').trim().toUpperCase();
  if (b === 'CPC') return 'CPC FBA';
  if (b === 'RBP' || /RIDHI/.test(b)) return 'Ridhi FBA';
  return '';
}

/** Everything anyone has typed into these boxes before, so the second entry is a pick, not a retype. */
const fgiSeen = field => [...new Set((FGI.rows || []).map(r => String((r && r[field]) || '').trim()).filter(Boolean))].sort();

function fgiEntryOpen(type, sku) {
  const k = FGI_KINDS[type] || FGI_KINDS.RECEIVE;
  ptOpenDialog({
    title: 'Stock entry',
    subtitle: sku ? obUC(sku) + ' · ' + [fgiMaster(sku).articleType, fgiMaster(sku).color, fgiMaster(sku).size].filter(Boolean).join(' · ') : '',
    note: 'Receive adds to the store, issue and FBA take out of it. Nothing here changes a stored '
      + 'number — the entry itself is the stock, which is why deleting one puts it back.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label>Type<select id="fgmType">${Object.keys(FGI_KINDS).map(t =>
          `<option value="${t}"${t === type ? ' selected' : ''}>${esc(FGI_KINDS[t].label)}</option>`).join('')}</select></label>
        <label>Date<input id="fgmDate" type="date" value="${esc(dToday())}"></label>
        <label style="grid-column:1/-1"><span>SKU <b style="color:var(--bad)">*</b></span><input id="fgmSku" list="fgmSkuList" value="${esc(sku ? obUC(sku) : '')}"
          placeholder="type or pick" style="font-family:ui-monospace,monospace;text-transform:uppercase">
          <datalist id="fgmSkuList">${(PTG.mdb || []).slice(0, 4000).map(r =>
            `<option value="${esc(obUC(r.sku))}">${esc([r.articleType, r.color, r.size].filter(Boolean).join(' · '))}</option>`).join('')}</datalist></label>
        <div id="fgmOrdWrap" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;
          padding:10px;border:1px solid var(--line);border-radius:10px">
          <label><span>Order from <b style="color:var(--bad)">*</b></span><select id="fgmOrdSrc">
            <option value="console">Order Console</option>
            <option value="external">External order</option></select></label>
          <label><span id="fgmOrdLbl">Order No <b style="color:var(--bad)">*</b></span>
            <input id="fgmOrd" list="fgmOrdList" placeholder="pick from the list" style="font-family:ui-monospace,monospace;text-transform:uppercase">
            <datalist id="fgmOrdList"></datalist></label>
          <label id="fgmExtFromWrap" class="hide"><span>Customer / platform <b style="color:var(--bad)">*</b></span>
            <input id="fgmExtFrom" list="fgmExtFromList" placeholder="e.g. Etsy, Walmart, a B2B buyer">
            <datalist id="fgmExtFromList">${fgiSeen('extOrderFrom').map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
          <label id="fgmExtQtyWrap" class="hide"><span>External order qty (pcs)</span>
            <input id="fgmExtQty" type="number" min="1" step="1" placeholder="if known"></label>
          <div id="fgmExtNewWrap" class="hide" style="display:flex;align-items:flex-end">
            <button type="button" id="fgmExtNew" class="ghost" style="width:100%" title="For an external order that came with no number of its own">Make a number</button></div>
          <div id="fgmOrdQty" class="hide" style="grid-column:1/-1;padding:8px 10px;border-radius:8px;background:var(--hover,#f1f5f9);font-size:13px;font-weight:400"></div>
        </div>
        <div id="fgmOutWrap" class="hide" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;
          padding:10px;border:1px solid var(--line);border-radius:10px">
          <label style="grid-column:1/-1"><span>For which order <b style="color:var(--bad)">*</b></span><select id="fgmOutOrd"><option value="">Auto — oldest orders first</option></select></label>
          <label id="fgmOutWhyWrap" class="hide" style="grid-column:1/-1"><span>Why is it for no order? <b style="color:var(--bad)">*</b></span>
            <input id="fgmOutWhy" type="text" placeholder="e.g. sample, damaged, photo shoot"></label>
          <label id="fgmInvWrap" class="hide">Invoice no<input id="fgmInv" type="text" placeholder="if billed"></label>
          <label id="fgmTransWrap" class="hide">Transporter / courier<input id="fgmTrans" type="text" list="fgmTransList" placeholder="who carries it">
            <datalist id="fgmTransList">${fgiSeen('transporter').map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
          <label id="fgmLrWrap" class="hide">LR / AWB / tracking no<input id="fgmLr" type="text" placeholder="the docket number"></label>
          <div id="fgmOutPlan" style="grid-column:1/-1;padding:8px 10px;border-radius:8px;background:var(--hover,#f1f5f9);font-size:13px;font-weight:400"></div>
        </div>
        <label><span>Pieces <b style="color:var(--bad)">*</b></span><input id="fgmQty" type="number" min="1" step="1"></label>
        <label id="fgmWhoWrap"><span><span id="fgmWhoLbl">${esc(k.who)}</span> <b style="color:var(--bad)">*</b></span><input id="fgmWho" type="text"
          list="fgmWhoList" placeholder="a name"><datalist id="fgmWhoList">${
            [...new Set(fgiSeen('issuedFor').concat(fgiSeen('receivedFrom')).concat(FGI.recips || []))]
              .map(r => `<option value="${esc(r)}">`).join('')}</datalist>
          <select id="fgmFbaAcct" class="hide">${['', ...FGI_FBA_ACCOUNTS].map(a => `<option value="${esc(a)}">${esc(a || '— pick the account —')}</option>`).join('')}</select></label>
        <label><span id="fgmReasonLbl">Reason</span><input id="fgmReason" type="text" list="fgmReasonList" placeholder="why">
          <datalist id="fgmReasonList">${fgiSeen('reason').map(r => `<option value="${esc(r)}">`).join('')}</datalist>
          <datalist id="fgmHandList">${fgiSeen('handoverTo').map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
        <label id="fgmOverWrap" class="hide" style="grid-column:1/-1;color:var(--bad)"><span>Why did more come than the order? <b>*</b></span>
          <input id="fgmOver" type="text" placeholder="e.g. printer sent extra, cut extra for rejects" style="border-color:var(--bad)"></label>
        <label style="grid-column:1/-1">Note<input id="fgmRemarks" type="text" placeholder="optional"></label>
      </div>
      <div id="fgmInfo" class="muted" style="margin-top:8px;font-size:12.5px"></div>`,
    onSave: () => fgiEntrySave(),
    saveLabel: 'Save the entry',
  });
  const info = () => {
    const s = obUC($('fgmSku').value), el = $('fgmInfo'), t = $('fgmType').value;
    $('fgmWhoLbl').textContent = (FGI_KINDS[t] || FGI_KINDS.RECEIVE).who;
    /* SEND TO FBA (Ravi, 15 Sept): the account is Ridhi FBA or CPC FBA, picked, and filled from the SKU's
     * brand; "Reason" becomes "Handover to" — the person the pieces were handed to. */
    const fbaT = t === 'FBA';
    if ($('fgmWho')) $('fgmWho').classList.toggle('hide', fbaT);
    if ($('fgmFbaAcct')) {
      $('fgmFbaAcct').classList.toggle('hide', !fbaT);
      if (fbaT && !$('fgmFbaAcct').value) $('fgmFbaAcct').value = fgiFbaAcctFor(obUC($('fgmSku').value));
    }
    if ($('fgmReasonLbl')) $('fgmReasonLbl').textContent = fbaT ? 'Handover to' : 'Reason';
    if ($('fgmReason')) {
      $('fgmReason').placeholder = fbaT ? 'who took the pieces' : 'why';
      if ($('fgmReason').setAttribute) $('fgmReason').setAttribute('list', fbaT ? 'fgmHandList' : 'fgmReasonList');
    }
    if ($('fgmOrdWrap')) $('fgmOrdWrap').classList.toggle('hide', t !== 'RECEIVE');
    /* WHICH ORDER THESE PIECES LEAVE FOR (2026-09-25). Auto deals them oldest first — Amazon orders first for FBA. */
    const outT = t === 'FBA' || t === 'ISSUE';
    if ($('fgmOutWrap')) $('fgmOutWrap').classList.toggle('hide', !outT);
    ['fgmInvWrap', 'fgmTransWrap', 'fgmLrWrap'].forEach(i => { if ($(i)) $(i).classList.toggle('hide', t !== 'ISSUE'); });
    if (outT && $('fgmOutOrd')) {
      const cand = s ? fgiOutOrders(s, t) : [], was = $('fgmOutOrd').value || '';
      $('fgmOutOrd').innerHTML = '<option value="">Auto — oldest orders first</option>'
        + cand.map(x => `<option value="${esc(x.orderNo)}">${esc(x.orderNo)} · ${nf(x.store)} in store${x.ext ? ' · external' : ''}</option>`).join('')
        + '<option value="__none">Not for an order (sample, damaged…)</option>';
      $('fgmOutOrd').value = was === '__none' || cand.some(x => x.orderNo === was) ? was : '';
      const none = $('fgmOutOrd').value === '__none';
      if ($('fgmOutWhyWrap')) $('fgmOutWhyWrap').classList.toggle('hide', !none);
      const q = parseInt(($('fgmQty') || {}).value, 10) || 0, box = $('fgmOutPlan');
      if (box) {
        if (none) box.innerHTML = 'These pieces will be recorded as for <b>no order</b>, with the reason you give.';
        else if (!s) box.innerHTML = 'Put in the SKU to see which orders have pieces in the store.';
        else if (!cand.length) box.innerHTML = '<span style="color:var(--bad)">No order has pieces of this SKU in the store</span> — they will leave as stock that is on no order.';
        else if (!q) box.innerHTML = nf(cand.length) + ' order(s) have pieces of this SKU in the store. Put in the pieces to see where they go.';
        else { const a = fgiOutAlloc(s, q, t, $('fgmOutOrd').value);
          box.innerHTML = a.err ? '<span style="color:var(--bad)">' + esc(a.err) + '</span>'
            : 'These pieces go to: <b>' + esc(fgiOutTxt(a.orders)) + '</b>' + (a.loose ? ` · ${nf(a.loose)} from stock that is on no order` : ''); }
      }
    }
    if (t !== 'RECEIVE' && $('fgmOverWrap')) $('fgmOverWrap').classList.add('hide');
    const ords = t === 'RECEIVE' ? fgiOrdFill(s) : [];
    const src = ($('fgmOrdSrc') || {}).value === 'external' ? 'external' : 'console';
    ['fgmExtFromWrap', 'fgmExtQtyWrap', 'fgmExtNewWrap'].forEach(i => { if ($(i)) $(i).classList.toggle('hide', src !== 'external'); });
    if ($('fgmOrdLbl')) $('fgmOrdLbl').innerHTML = (src === 'external' ? 'External order no' : 'Order No') + ' <b style="color:var(--bad)">*</b>';
    if ($('fgmOrd')) $('fgmOrd').placeholder = src === 'external' ? "the customer's or platform's order number" : 'pick from the list';
    if (!s) { el.className = 'muted'; el.textContent = ''; return; }
    const m = (PTG.mdb || []).find(r => r && obUC(r.sku) === s);
    if (!m) { el.className = 'err'; el.textContent = s + ' is not in the master database.'; return; }
    const b = fgiOf(s);
    el.className = 'muted';
    el.textContent = [m.articleType, m.subtype, m.color, m.size].filter(Boolean).join(' · ')
      + ` · ${nf(b.current)} piece(s) in stock now`
      + (b.pending ? ` · ${nf(b.pending)} sent from press and not yet counted in` : '');
    if (t === 'RECEIVE') {
      const typed = obUC(($('fgmOrd') || {}).value);
      const o = src === 'external' ? fgiExtOrder(typed, s, ($('fgmExtQty') || {}).value) : ords.find(x => x.orderNo === typed);
      const q = parseInt(($('fgmQty') || {}).value, 10) || 0;
      const box = $('fgmOrdQty'), over = o && o.qty ? Math.max(0, o.got + q - o.qty) : 0;
      if (box) {
        box.classList.toggle('hide', !(o || (src === 'external' && typed)));
        if (o && !o.qty) box.innerHTML = `<span class="pill">EXTERNAL</span> <b>${esc(typed)}</b> — no order quantity given`
          + (o.got ? ` · ${nf(o.got)} already received against it` : '') + ' · put in the order qty to check for extra pieces';
        else if (o) box.innerHTML = (src === 'external' ? '<span class="pill">EXTERNAL</span> ' : '') + `<b>${esc(o.orderNo)}</b> — order: <b>${nf(o.qty)}</b> pcs · already received: <b>${nf(o.got)}</b> · `
          + (o.left ? `you can receive <b>${nf(o.left)}</b> more` : '<b style="color:var(--bad)">nothing left to receive on this order</b>')
          + (over ? `<div style="color:var(--bad);margin-top:3px">${nf(Math.min(q, over))} of these ${nf(q)} are MORE than the order — give the reason below; it will be flagged.</div>` : '');
      }
      if ($('fgmOverWrap')) $('fgmOverWrap').classList.toggle('hide', !over);
      if (src === 'console') el.textContent += typed && !o
        ? (fgiOrderKnown(typed) ? ` · ${typed} has no line for ${s} in the Order Console` : ` · ${typed} is not in the Order Console — choose "External order" if it came from outside`)
        : (!ords.length ? ' · no order in the Order Console has this SKU — choose "External order"' : '');
      else if (fgiOrderKnown(typed)) { el.className = 'err'; el.textContent += ` · ${typed} is an Order Console order — choose "Order Console"`; }
    }
    const az = lstOf(s);
    if (az.st === 'not') { el.className = 'err'; el.textContent += ' · NOT LISTED on Amazon — saving will alert the listing team'; }
    else if (az.st !== 'unknown') el.textContent += ' · Amazon: ' + LST_PILL[az.st][1].toLowerCase();
  };
  $('fgmSku').addEventListener('input', info);
  $('fgmType').addEventListener('change', info);
  if ($('fgmOrd')) $('fgmOrd').addEventListener('input', () => { if ($('fgmOrd').dataset) $('fgmOrd').dataset.auto = ''; info(); });
  if ($('fgmQty')) $('fgmQty').addEventListener('input', info);
  if ($('fgmOutOrd')) $('fgmOutOrd').addEventListener('change', info);
  if ($('fgmOrdSrc')) $('fgmOrdSrc').addEventListener('change', () => {
    if ($('fgmOrdSrc').dataset) $('fgmOrdSrc').dataset.touched = '1';
    if ($('fgmOrd')) { $('fgmOrd').value = ''; if ($('fgmOrd').dataset) $('fgmOrd').dataset.auto = ''; }
    info();
  });
  if ($('fgmExtQty')) $('fgmExtQty').addEventListener('input', info);
  if ($('fgmExtNew')) $('fgmExtNew').addEventListener('click', () => {
    $('fgmOrd').value = fgiExtNewNo(($('fgmDate') || {}).value);
    if ($('fgmOrd').dataset) $('fgmOrd').dataset.auto = '';
    info();
  });
  info();
}

/**
 * Can the store give this many? The form and the Excel issue both ask here (Ravi, 2026-09-25: the same
 * process). `already` is what earlier rows of the same sheet take out of that SKU, so the store cannot be
 * emptied twice by two rows that each see the whole shelf.
 */
function fgiOutCheck(sku, qty, type, already) {
  const took = already || 0, have = fgiOf(sku).current - took;
  if (qty > have) return `You don't have enough stock — ${sku} has ${nf(Math.max(0, have))} piece(s) in the India Store`
    + (took ? ` after the ${nf(took)} the rows above take` : '')
    + ` and this ${type === 'FBA' ? 'dispatch' : 'issue'} asks for ${nf(qty)}.`;
  return '';
}

/**
 * The order side of a receipt — which order, of which kind, and whether more came than it asked for.
 *
 * Lifted out of fgiEntrySave, word for word, so the Stock entry dialog and the Excel upload run ONE check
 * (Ravi, 2026-09-24: "process must be same"). v: { sku, qty, orderNo, pick: 'console' | 'external' | '',
 * extFrom, extQty, over }. A blank pick behaves as a form that was never drawn: the number decides.
 * `batch(orderNo, sku)` is what earlier rows of the same upload already brought in against that order —
 * so ten rows of one order cannot each see the whole order as still open.
 */
function fgiRecvOrderCheck(v, batch) {
  const sku = obUC(v.sku), qty = parseInt(v.qty, 10) || 0;
  const orderNo = obUC(v.orderNo);
  const pick = v.pick || '';
  const more = (no) => (batch ? batch(no, sku) || 0 : 0);
  const withBatch = o => (o ? Object.assign({}, o, { got: o.got + more(o.orderNo), left: Math.max(0, o.left - more(o.orderNo)) }) : o);
  let orderSource = '', extFrom = '', extQty = 0, overQty = 0, overReason = '', overOrdered = 0;
  /* Which kind of order is the person's choice, not a guess from whether the number is known. A form
   * that was never drawn (no picker) falls back to the number, as it always did. */
  const wantExt = pick === 'external' || (!pick && orderNo && !fgiOrdersFor(sku).some(o => o.orderNo === orderNo) && !fgiOrderKnown(orderNo));
  if (!wantExt) {
    if (!orderNo) return { err: 'Pick the Order Console order these pieces were received against — or choose "External order".' };
    if (fgiOrdersFor(sku).some(o => o.orderNo === orderNo)) orderSource = 'console';
    else if (fgiOrderKnown(orderNo)) return { err: `${orderNo} is in the Order Console but has no line for ${sku}. Pick one of this SKU's orders.` };
    else return { err: `${orderNo} is not in the Order Console. If it came from outside, choose "External order".` };
  } else {
    if (!orderNo) return { err: 'Put in the external order number — or press "No number? Make one".' };
    if (fgiOrderKnown(orderNo)) return { err: `${orderNo} is an Order Console order — choose "Order Console", not "External order".` };
    orderSource = 'external';
    extFrom = String(v.extFrom || '').trim();
    if (pick === 'external' && !extFrom) return { err: 'Say who placed the external order — a customer or a platform.' };
    const eq = String(v.extQty == null ? '' : v.extQty).trim();
    if (eq && !(parseInt(eq, 10) >= 1)) return { err: 'The external order qty has to be a whole number, 1 or more.' };
    extQty = fgiExtOrder(orderNo, sku, eq).qty || 0;
  }
  /* MORE THAN THE ORDER. Ravi: "yadi extra inventory aay to uska reason h and flag me … mark mandatory".
   * It is not refused — extra pieces are real and have to be recorded — but it cannot be saved without
   * saying why, and the row carries the extra so it shows up in "Received more than ordered". */
  if (orderSource === 'console' || extQty) {
    const o = withBatch(orderSource === 'console' ? fgiOrdersFor(sku).find(x => x.orderNo === orderNo) : fgiExtOrder(orderNo, sku, extQty));
    if (o && o.qty && o.got + qty > o.qty) {
      overQty = Math.min(qty, o.got + qty - o.qty);
      overReason = String(v.over || '').trim();
      overOrdered = o.qty;
      if (!overReason) {
        return { needOver: true, err: `${orderNo} ordered ${nf(o.qty)} of ${sku} and ${nf(o.got)} are already received, so only ${nf(o.left)} more can come in against it. `
          + `${nf(overQty)} of these ${nf(qty)} are extra — say why in "Why did more come than the order?" (required).` };
      }
    }
  }
  return { orderNo, orderSource, overQty, overReason, overOrdered, extFrom, extQty };
}

async function fgiEntrySave() {
  if (!fgiCanEntry()) return FGI_NO_ENTRY;
  const type = $('fgmType').value;
  const k = FGI_KINDS[type]; if (!k) return 'Pick what kind of movement this is.';
  const sku = obUC(($('fgmSku') || {}).value);
  const qty = parseInt(($('fgmQty') || {}).value, 10);
  /* A drawn form has the account picker; for a dispatch that is where the name comes from. */
  const fbaForm = type === 'FBA' && !!$('fgmFbaAcct');
  const who = String((fbaForm ? $('fgmFbaAcct') : ($('fgmWho') || {})).value || '').trim();
  const reason = String(($('fgmReason') || {}).value || '').trim();
  if (fbaForm && FGI_FBA_ACCOUNTS.indexOf(who) < 0) return `Pick the FBA account — ${FGI_FBA_ACCOUNTS.join(' or ')}.`;
  const iso = ($('fgmDate') || {}).value || '';
  if (!sku) return 'Put in the SKU.';
  if (!(PTG.mdb || []).some(r => r && obUC(r.sku) === sku)) return `${sku} is not in the master database.`;
  if (!isFinite(qty) || qty < 1) return 'Put in how many pieces.';
  if (!who) return k.dir < 0
    ? 'Say who or what these are for — a movement with nobody on it cannot be traced.'
    : 'Say where these came from.';
  let orderNo = '', orderSource = '', overQty = 0, overReason = '', overOrdered = 0, extFrom = '', extQty = 0;
  if (type === 'RECEIVE') {
    /* THE SAME CHECK THE EXCEL UPLOAD RUNS — one function, so the two can never drift apart. */
    const r = fgiRecvOrderCheck({ sku, qty, orderNo: ($('fgmOrd') || {}).value, pick: ($('fgmOrdSrc') || {}).value,
      extFrom: ($('fgmExtFrom') || {}).value, extQty: ($('fgmExtQty') || {}).value, over: ($('fgmOver') || {}).value });
    if (r.err) {
      if (r.needOver && $('fgmOverWrap')) $('fgmOverWrap').classList.remove('hide');
      return r.err;
    }
    ({ orderNo, orderSource, overQty, overReason, overOrdered, extFrom, extQty } = r);
  }
  let out = null;
  if (k.dir < 0) {
    /* Read again at save: the figure on screen could be minutes old, and the store cannot go short. */
    const short = fgiOutCheck(sku, qty, type);
    if (short) return short;
    out = fgiOutOrderCheck({ sku, qty, type, order: ($('fgmOutOrd') || {}).value, why: ($('fgmOutWhy') || {}).value,
      inv: ($('fgmInv') || {}).value, trans: ($('fgmTrans') || {}).value, lr: ($('fgmLr') || {}).value });
    if (out.err) return out.err;
  }
  // Day-first, like every other date this database keeps.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? `${m[3]}/${m[2]}/${m[1]}` : iso;

  /* The two warnings. Both describe what is already recorded and let the person judge — a hard block
   * here would stop a second genuine delivery on a busy day. */
  const sameDay = (FGI.rows || []).filter(r => r && r.date === date && obUC(r.sku) === sku);
  const twin = sameDay.find(r => r.txnType === type
    && String(r.issuedFor || r.receivedFrom || '').trim().toLowerCase() === who.toLowerCase());
  if (twin && !FGI._ok) {
    FGI._ok = true;
    return `${sku} was already ${k.dir < 0 ? 'sent to' : 'received from'} "${who}" today — `
      + `${nf(fgiNum(twin.qty))} piece(s)${twin.createdAt ? ' at ' + String(twin.createdAt).slice(11, 16) : ''}. `
      + 'If this is a second, separate movement, press save again.';
  }
  const otherWay = sameDay.find(r => FGI_KINDS[r.txnType] && FGI_KINDS[r.txnType].dir !== k.dir);
  if (otherWay && !FGI._ok2) {
    FGI._ok2 = true;
    return `${sku} was already ${FGI_KINDS[otherWay.txnType].dir > 0 ? 'received' : 'sent out'} today `
      + `— ${nf(fgiNum(otherWay.qty))} piece(s). Moving it the other way on the same day is usually the `
      + 'wrong type picked. Press save again if it is right.';
  }
  FGI._ok = false; FGI._ok2 = false; FGI._ok3 = false;

  const rec = { _id: fgiNewId(type === 'FBA' ? 'FBA' : (type === 'ISSUE' ? 'ISS' : 'RCP')),
    txnType: type, sku, qty, date, reason: fbaForm ? '' : reason,
    ...(fbaForm && reason ? { handoverTo: reason } : {}),
    ...(orderNo ? { orderNo, orderSource } : {}),
    ...(orderSource === 'external' ? { extOrderFrom: extFrom, ...(extQty ? { extOrderQty: extQty } : {}) } : {}),
    ...(overQty ? { overQty, overReason, overOrdered, overStatus: 'open' } : {}),
    ...(out ? out.fields : {}),
    [k.dir < 0 ? 'issuedFor' : 'receivedFrom']: who,
    remarks: String(($('fgmRemarks') || {}).value || '').trim(),
    createdAt: new Date().toISOString(), createdBy: ME.email };
  await ptPut('pt_fgiLedger/' + rec._id, rec);
  FGI.rows = (FGI.rows || []).concat(rec);
  renderFgi();
  $('fgMsg').className = 'muted';
  $('fgMsg').textContent = `${nf(qty)} piece(s) of ${sku} ${type === 'FBA' ? 'sent to FBA' : (type === 'ISSUE' ? 'issued' : 'received')}`
    + (orderNo ? ` against ${orderNo}${orderSource === 'external' ? ` (external order${extFrom ? ' · ' + extFrom : ''})` : ''}` : '')
    + (out && out.fields.orders ? ' for ' + fgiOutTxt(out.fields.orders) : '')
    + (out && out.fields.noOrderWhy ? ' — for no order (' + out.fields.noOrderWhy + ')' : '')
    + ` · ${nf(fgiOf(sku).current)} now in stock.`
    + (overQty ? ` ⚠ ${nf(overQty)} piece(s) more than the order — flagged for review.` : '')
    + (type === 'FBA' ? ' It is waiting for the FBA team in FBA Dispatch.' : '');
  fbaBadge();
  fgiOverBadge();
  if (overQty) $('fgMsg').className = 'err';
  const lstLine = await lstAlertFor(sku, type, qty);
  if (lstLine) { $('fgMsg').className = 'err'; $('fgMsg').textContent += lstLine; }
  return '';
}

