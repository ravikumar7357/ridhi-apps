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
        $('soErr').textContent = '"' + el.value + '" is not a pack size — whole units only, or blank to use the production master.';
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
  try { soRenderProdBox(o); } catch (e) { /* the production box is a nicety on this dialog, never a blocker */ }

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
