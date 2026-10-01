/* ---------- the adjustment dialog ---------- */
let ADJ_EDIT = null;                       // SKU being adjusted on the order that is open

function openAdj(sku) {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const item = o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku);
  if (!item) return;
  const ln = soLine(SHOP_EDIT, sku);
  ADJ_EDIT = sku;

  $('adjTitle').textContent = o.no + ' · ' + sku;
  $('adjSub').textContent = item.name + (item.variant ? ' · ' + item.variant : '')
    + ' · ' + item.qty + ' ordered' + (ln.q != null ? ', ' + ln.q + ' at location' : '');
  const img = ln.adjImg || item.img || '';
  $('adjImg').src = img;
  $('adjImg').style.visibility = img ? 'visible' : 'hidden';

  $('adjReason').value = ln.adjReason || (ln.q != null && item.qty - ln.q > 0 ? 'Short' : 'Wrong size');
  // The variant Shopify already knows is the best first guess at what was wanted — it is the size
  // the customer actually bought.
  $('adjSend').value = ln.adjSend || '';
  $('adjWant').value = ln.adjWant || item.variant || '';
  $('adjQty').value = ln.adjQty || Math.max(1, Number(item.qty) - Number(ln.q || 0)) || 1;
  $('adjNote').value = ln.adjNote || '';
  $('adjQty').max = item.qty;

  // Sizes already used anywhere, so the same size is not spelt three ways across three sheets.
  const sizes = new Set();
  Object.values(SHOP_META).forEach(m => Object.values((m && m.lines) || {}).forEach(l => {
    if (l.adjSend) sizes.add(l.adjSend);
    if (l.adjWant) sizes.add(l.adjWant);
  }));
  SHOP.orders.forEach(x => x.items.forEach(it => { if (it.variant) sizes.add(it.variant); }));
  $('adjSizeList').innerHTML = [...sizes].sort()
    .map(s => `<option value="${String(s).replace(/"/g, '&quot;')}">`).join('');

  $('adjErr').classList.add('hide');
  $('adjDelete').style.display = ln.adj ? '' : 'none';
  $('adjModal').classList.remove('hide');
  $('adjSend').focus();
}

async function saveAdj(remove) {
  if (!ADJ_EDIT || !SHOP_EDIT) return;
  const sku = ADJ_EDIT;
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  const item = o && o.items.find(x => String(x.sku || '').trim().toUpperCase() === sku);
  const meta = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
  const lines = meta.lines || (meta.lines = {});
  const ln = lines[sku] || (lines[sku] = {});
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  if (remove) {
    Object.keys(ln).filter(k => k.indexOf('adj') === 0).forEach(k => delete ln[k]);
    if (ln.q == null && !(ln.log || []).length) delete lines[sku];
  } else {
    const q = Math.max(1, Math.round(Number($('adjQty').value) || 1));
    ln.adj = ln.adj || soAdjId(o ? o.no : SHOP_EDIT, sku);
    ln.adjQty = q;
    ln.adjReason = $('adjReason').value;
    ln.adjSend = $('adjSend').value.trim();
    ln.adjWant = $('adjWant').value.trim();
    ln.adjNote = $('adjNote').value.trim();
    // The picture is COPIED, not linked to the live order. A Shopify image that is swapped later
    // would otherwise change the sheet already on the production floor.
    if (!ln.adjAt) ln.adjAt = soStamp();
    soAdjSnapshot(ln, o, item);
    // Raised by hand, so the quantity box must stop managing it — a wrong-size adjustment is valid
    // even when the count is complete, and an auto-clear would delete a job already sent out.
    ln.adjManual = 1;
  }

  try {
    await saveShopMeta();
    $('adjModal').classList.add('hide');
    ADJ_EDIT = null;
    const cell = $('soItems').querySelector('.soAdjCell[data-sku="' + sku + '"]');
    if (cell && item) cell.innerHTML = soAdjHtml(lines[sku] || {}, item, esc);
    soBindAdjButtons();
    renderShop();
    // It is already IN the Adjustments tab — both read the same record, so there is nothing to
    // copy across and nothing that can fall out of step. What was missing is anybody being told,
    // so the message says where it went and offers to go there. Deliberately not an automatic
    // jump: that would throw away the order somebody is still working through.
    if (!remove && lines[sku] && lines[sku].adj) {
      soMsg('');
      const m = $('soMsg');
      m.className = 'muted';
      m.innerHTML = lines[sku].adj + ' is on the Adjustments tab · '
        + '<a href="#" id="soGoAdj">open it</a>';
      const a = $('soGoAdj');
      if (a) a.onclick = (ev) => { ev.preventDefault(); $('soModal').classList.add('hide'); SHOP_EDIT = null; showTab('adj'); };
    }
  } catch (err) {
    $('adjErr').textContent = 'Could not save: ' + (err.message || err);
    $('adjErr').classList.remove('hide');
  }
}

function soBindAdjButtons() {
  $('soItems').querySelectorAll('[data-adj]').forEach(b => { b.onclick = () => openAdj(b.dataset.adj); });
}
$('adjSave').onclick = () => saveAdj(false);
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
  const meta = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
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
  try { await saveShopMeta(); }
  catch (e) {
    $('soErr').textContent = 'Could not save the line status: ' + (e.message || e);
    $('soErr').classList.remove('hide');
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

async function soSaveLineQty(sku, raw, ordered, esc) {
  if (!SHOP_EDIT || !sku) return;
  const meta = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
  const lines = meta.lines || (meta.lines = {});
  const ln = lines[sku] || (lines[sku] = {});
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
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

  $('soTitle').textContent = o.no + ' · ' + o.at;
  $('soSub').textContent = [o.ship.name, o.ship.a1, o.ship.city, o.ship.state, o.ship.zip, o.ship.country]
    .filter(Boolean).join(', ') + (o.ship.phone ? ' · ' + o.ship.phone : '');

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
    + (o.shippedAt ? ' <span class="muted" style="font-size:12px">shipped ' + esc(o.shippedAt) + '</span>' : '')
    + (trkList.length
        ? '<div style="margin-top:6px;font-size:12.5px">'
          + (o.trkUrl ? '<a href="' + esc(o.trkUrl) + '" target="_blank" rel="noopener">' + esc(trkList.join(', ')) + '</a>'
                      : esc(trkList.join(', ')))
          + (o.trkCo ? ' <span class="muted">· ' + esc(o.trkCo) + '</span>' : '')
          + '</div>'
        : '<div class="muted" style="margin-top:6px;font-size:12.5px">No tracking number on Shopify yet.</div>');

  $('soItems').innerHTML = '<table class="xl" style="font-size:12px">'
    + '<thead><tr><th></th><th>SKU</th>'
    + '<th title="The code Amazon knows this by, when it is not the same as the Shopify one. Leave it blank when they match. The FBA figure and the MCF order both use whatever is here.">Amazon SKU</th>'
    + '<th>Product</th><th class="num">Ordered</th>'
    + '<th class="num" title="Units to actually send to Amazon for THIS order. Blank means send what was ordered. 0 leaves the line out of the MCF order entirely. Stored against this order only, never against the SKU.">Send qty</th>'
    + '<th class="num">FBA</th><th title="What happens to THIS line: already sent, cancelled (refunded on Shopify), out of FBA, out of India stock, or made. Same wording as the route on the order itself, so the two cannot disagree.">Status</th><th>Location</th>'
    + '<th class="num" title="How many of the ordered units are actually on that shelf. Every change is logged with the date and time.">At location</th>'
    + '<th title="Where THIS line has got to, in your own words — cut, stitched, packed, whatever you use. Typed by you and saved against this order’s line, so it never changes another order carrying the same SKU. Different from the Status column on the left, which the app works out from stock and cannot be edited.">Line status</th>'
    + '<th title="Raised automatically for whatever is short. The id is built from the Shopify order number, so it can never collide and always points back.">Adjustment</th></tr></thead><tbody>'
    + o.items.map(i => {
      const sku = String(i.sku || '').trim().toUpperCase();
      const amz = soAmzSku(sku);
      const amzKey = String(amz || '').toUpperCase();
      const have = amzKey && (amzKey in SHOP_STOCK) ? SHOP_STOCK[amzKey] : null;
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
        + '<td style="padding:3px 6px;width:52px">' + (i.img
            ? '<img src="' + esc(i.img) + '" loading="lazy" decoding="async" alt=""'
              + ' style="width:44px;height:44px;object-fit:cover;border-radius:6px;background:#f1f5f9">'
            : '<span class="muted" style="font-size:10px">—</span>') + '</td>'
        + '<td>' + esc(i.sku || '—') + '</td>'
        // Editable, and PLACEHOLDERED with the Shopify code — so a blank box still shows what will
        // be sent, and a filled one is visibly a decision. Same pattern as Remark and Req. Qty.
        + '<td style="padding:3px 6px;width:130px">'
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
              : '<span class="muted">—</span>')
        + '</td>'
        + '<td title="' + esc(i.name + (i.variant ? ' · ' + i.variant : '')) + '">'
          + esc(String(i.name).slice(0, 30)) + '</td>'
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
        + '<td class="num">' + (have == null ? '<span class="muted">not in FBA</span>'
            : have >= need ? '<span class="st st-approved">' + have + ' in FBA</span>'
            : '<span class="st st-rejected">only ' + have + '</span>') + '</td>'
        + '<td title="' + esc(st.why) + '">' + (SO_LINE_TAG[st.v] || esc(st.label)) + '</td>'
        // An INPUT with a datalist, not a plain dropdown: the twelve bins are one keystroke away,
        // and a new one can still be typed. A closed list would mean a shelf that exists but cannot
        // be recorded, which ends with somebody writing it in the note field instead.
        + '<td style="padding:3px 6px;width:96px">'
          + (sku
              ? '<input class="soLoc" data-sku="' + esc(sku) + '" list="soLocList" maxlength="12"'
                + ' placeholder="—" value="' + esc(soLocOf(sku)) + '"'
                + ' style="width:84px;text-align:center;font-weight:600">'
              : '<span class="muted">—</span>')
        + '</td>'
        // How many of the ordered units are actually ON that shelf. Capped at the ordered quantity:
        // more than was ordered is not a picking fact, it is a typing slip, and it would generate a
        // negative shortfall that reads as a production order for minus one piece.
        + '<td style="padding:3px 6px;width:86px">'
          + (sku
              ? '<input class="soQty" data-sku="' + esc(sku) + '" data-qty="' + i.qty + '" type="number"'
                + ' min="0" max="' + i.qty + '" step="1" placeholder="—"'
                + ' value="' + (ln.q == null ? '' : ln.q) + '"'
                + ' title="' + esc(soLogText(ln)) + '"'
                + ' style="width:72px;text-align:center;font-weight:600">'
              : '<span class="muted">—</span>')
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
    }).join('') + '</tbody></table>'
    + '<div class="muted" style="font-size:11.5px;margin-top:6px">' + esc(m.why) + '</div>';

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
  $('soMcfBrand').value = meta.mcfBrand || soGuessBrand(o) || 'SP';
  $('soMcfPrev').classList.add('hide');
  $('soMcfPrev').innerHTML = '';
  soRenderMcfBox();

  $('soErr').classList.add('hide');
  $('soModal').classList.remove('hide');
  $('soStatus').focus();
}

/** Which brand's FBA holds these SKUs, from the listing-health snapshot. '' when it cannot tell. */
function soGuessBrand(o) {
  const skus = o.items.map(i => String(i.sku || '').trim().toUpperCase()).filter(Boolean);
  for (const b of ['SP', 'CPC']) {
    const rows = (HEALTH[b] && HEALTH[b].rows) || [];
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
  ['mcfId', 'mcfAt', 'mcfSpeed', 'mcfStatus', 'mcfTrk', 'mcfBrand', 'shopFulfilled', 'lines'].forEach(k => {
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

