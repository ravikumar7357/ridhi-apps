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
  if (!API || !API.url) throw new Error('Backend not configured — ' + (API_ERR || 'config/api was not read'));
  // text/plain deliberately: application/json would trigger a CORS preflight that an Apps Script
  // web app cannot answer. The content is still JSON.
  const r = await fetch(API.url, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: API.key }),
  });
  // Same trap as baCall: a visitor the deployment will not run for gets a Google HTML page.
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
    // Amazon is asked for the AMAZON code. This is the one place where sending the Shopify text
    // instead means Amazon rejects the line, or worse, matches nothing and ships short.
    items: o.items.map(i => ({ sku: soAmzSku(i.sku), qty: soSendQty(o.id, i.sku, soLive(i)) }))
      .filter(i => i.qty > 0),                 // a line set to 0 is a line deliberately not sent
  };
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
    return;
  }
  // Stock is stated before anything is clicked. "Not stocked" and a live Send button on the same
  // screen is an invitation to place an order Amazon will only reject later.
  $('soMcfBox').innerHTML = m.v === 'yes'
    ? '<span class="muted">FBA has stock for every line. Check the speeds before sending.</span>'
    : '<span class="fu fu-amber">' + esc(m.why) + '</span>'
      + '<div class="muted" style="margin-top:2px">Amazon can only ship what it holds — a preview will say exactly which line is short.</div>';
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
    $('soErr').innerHTML = mcfErr(e, 'Preview failed');
    $('soErr').classList.remove('hide');
  }
  btn.disabled = false; btn.textContent = 'Check speeds & cost';
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
function mcfErr(e, what) {
  const raw = String(e && (e.message || e) || '');
  const esc = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  if (!/403|unauthorized|access to requested resource is denied/i.test(raw)) {
    return esc(what + ': ' + raw);
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
  // The last gate, and it names the money and the address. A confirm that only says "are you sure"
  // is one nobody reads.
  if (!confirm(`Ship ${o.no} from ${who} FBA?\n\n`
    + `${speed} · ${fee}\n`
    + `To: ${[o.ship.name, o.ship.a1, o.ship.city, o.ship.state, o.ship.zip, o.ship.country].filter(Boolean).join(', ')}\n`
    // Named as AMAZON will receive it. This is the last gate before a real parcel, and a mapped
    // SKU is exactly the case where the code on the Shopify order is not the code being shipped —
    // so showing the Shopify one here would confirm something other than what is about to happen.
    + `${o.items.map(i => { const amz = soAmzSku(i.sku), shop = String(i.sku || '').trim().toUpperCase();
        const q = soSendQty(o.id, i.sku, soLive(i));
        // Compared without case: a code that differs only in capitals is the SAME code, and
        // saying "(Shopify: …)" for it would read as a mapping nobody made.
        return `${amz || i.name}${amz && shop && amz.toUpperCase() !== shop ? ` (Shopify: ${shop})` : ''} x${q}`
          + (q !== i.qty ? ` — ordered ${i.qty}` : '');
      }).join('\n')}\n\n`
    + `Amazon will pick, pack and ship this. It cannot be cancelled from this app.`)) return;

  $('soMcfPrev').innerHTML = '<span class="muted">Placing the order with Amazon…</span>';
  try {
    const d = await apiPost({ mcf: 'create', order: { ...soMcfPayload(o), speed } });
    const e = SHOP_META[SHOP_EDIT] || (SHOP_META[SHOP_EDIT] = {});
    e.mcfId = d.mcfId;
    e.mcfAt = soStamp();
    e.mcfSpeed = speed;
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
    $('soMcfPrev').innerHTML = '<span class="err">' + mcfErr(err, 'Could not send') + '</span>';
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
    if ((d.trk || []).length && !meta.shopFulfilled) {
      const f = await apiPost({ shopify: 'fulfil', orderId: SHOP_EDIT, trk: d.trk, trkCo: d.trkCo || 'Amazon Logistics' });
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
$('soGo').onclick = fetchShopOrders;
['soState', 'soFilter', 'soDay'].forEach(id => $(id).addEventListener('input', renderShop));
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

