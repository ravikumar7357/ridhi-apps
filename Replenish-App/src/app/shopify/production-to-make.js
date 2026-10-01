/* ---------- what production has to make ----------
 *
 * ONE print builder, driven by the Adjustments tab. The Shopify tab's button now walks over there
 * rather than gathering its own list: two builders would eventually disagree about which jobs are
 * open, and the one on the factory floor would be the wrong one.
 *
 * Opened as a plain printable page in its own tab rather than a modal. The app's stylesheet is
 * built for a screen — printing it gives grey panels and cut columns, and a sheet somebody has to
 * squint at on a factory floor is not a sheet.
 */
$('soAdj').onclick = () => showTab('adj');

$('ajPrint').onclick = () => {
  const rows = ajPicked().length ? ajPicked() : ajRows();
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  if (!rows.length) {
    $('ajMsg').textContent = 'Nothing to print. Tick some rows, or widen the filters.';
    $('ajMsg').className = 'err';
    return;
  }
  const byDay = {};
  rows.forEach(r => (byDay[r.day || 'undated'] || (byDay[r.day || 'undated'] = [])).push(r));
  const days = Object.keys(byDay).sort().reverse();
  // A CARD PER JOB, not a table row. The picture is the point: production reads the photo first and
  // the words second, so it gets the space, and everything else arranges itself around it.
  const body = days.map(d => {
    const list = byDay[d];
    const units = list.reduce((s, r) => s + Number(r.qty || 0), 0);
    return '<section><h2>' + esc(d) + ' <span class="sub">' + list.length + ' job(s) · ' + units + ' piece(s) to make</span></h2>'
      + list.map(r => '<div class="job">'
        + '<div class="pic">' + (r.img
            ? '<img src="' + esc(r.img) + '" alt="">'
            : '<div class="nopic">no picture</div>') + '</div>'
        + '<div class="det">'
          + '<div class="hdr"><span class="id big">' + esc(r.id) + '</span>'
            + '<span class="qty">' + r.qty + ' pc' + (r.qty === 1 ? '' : 's') + '</span></div>'
          + '<div class="name">' + esc(r.name) + '</div>'
          + '<table class="kv"><tbody>'
            + '<tr><th>SKU</th><td class="id">' + esc(r.sku) + '</td>'
              + '<th>Shopify order</th><td>' + esc(r.order) + ' · ' + esc(r.orderDate) + '</td></tr>'
            + '<tr><th>Sending</th><td class="sz">' + esc(r.send || '—') + '</td>'
              + '<th>Make in</th><td class="sz want">' + esc(r.want || '—') + '</td></tr>'
            + '<tr><th>Reason</th><td>' + esc(r.reason || '—') + '</td>'
              + '<th>Bin</th><td>' + esc(r.loc || '—') + '</td></tr>'
            + '<tr><th>Ordered</th><td>' + (r.ordered == null ? '—' : r.ordered) + ' · '
              + (r.staged == null ? '—' : r.staged) + ' at location</td>'
              + '<th>Raised</th><td>' + esc(r.at) + '</td></tr>'
            // Printed only once production has committed to a date, so a fresh sheet does not carry
            // an empty promise line for somebody to fill in with a pen and nobody to record.
            + (r.due ? '<tr><th>Promised</th><td><b>' + esc(r.due) + '</b>'
                + (r.accBy ? ' · ' + esc(r.accBy) : '') + '</td><th>State</th><td>' + esc(r.state) + '</td></tr>' : '')
            + (r.note ? '<tr><th>Note</th><td colspan="3">' + esc(r.note) + '</td></tr>' : '')
          + '</tbody></table>'
          + '<div class="sign">Accepted by ________________ &nbsp; Ready by ____________'
            + ' &nbsp;&nbsp;|&nbsp;&nbsp; Made by ________________ &nbsp; Date __________ &nbsp; Qty ______</div>'
        + '</div></div>').join('')
      + '</section>';
  }).join('');

  const w = window.open('', '_blank');
  if (!w) { soMsg('The browser blocked the print tab — allow pop-ups for this site.', true); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Production adjustments</title>'
    + '<style>'
    + 'body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}'
    + 'h1{font-size:18px;margin:0 0 2px}'
    + 'h2{font-size:16px;margin:0 0 10px;padding-bottom:5px;border-bottom:2px solid #111}'
    + 'h2 .sub{font-weight:400;font-size:12px;color:#555}'
    + '.head{color:#555;font-size:12px;margin-bottom:14px}'
    + '.job{display:flex;gap:16px;border:1.5px solid #333;border-radius:8px;padding:12px;margin-bottom:12px}'
    // 62mm of picture. Small enough that two jobs fit a page, big enough to tell two prints apart
    // across a workbench, which is the whole reason it is on the sheet.
    + '.pic{flex:0 0 62mm}'
    + '.pic img{width:62mm;height:62mm;object-fit:contain;border:1px solid #bbb;border-radius:6px;background:#fafafa}'
    + '.nopic{width:62mm;height:62mm;border:1px dashed #bbb;border-radius:6px;display:flex;'
    + 'align-items:center;justify-content:center;color:#999;font-size:12px}'
    + '.det{flex:1;min-width:0}'
    + '.hdr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px}'
    + '.qty{font-size:22px;font-weight:800;border:2px solid #111;border-radius:6px;padding:1px 12px;white-space:nowrap}'
    + '.name{font-size:15px;font-weight:600;margin-bottom:8px}'
    + 'table.kv{border-collapse:collapse;width:100%}'
    + 'table.kv th,table.kv td{border:1px solid #bbb;padding:4px 7px;text-align:left;vertical-align:top;font-size:12px}'
    + 'table.kv th{background:#f0f0f0;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;width:66px;white-space:nowrap}'
    + '.sz{font-size:15px;font-weight:700}'
    + '.want{background:#fff3c4}'
    + '.id{font-family:ui-monospace,Consolas,monospace}'
    + '.big{font-size:14px;font-weight:700}'
    + '.sign{margin-top:10px;font-size:12px;color:#333}'
    // Each day starts a fresh page, because the sheets are handed over a day at a time.
    + '@media print{body{margin:10mm}section{page-break-before:always}'
    + 'section:first-of-type{page-break-before:auto}.job{page-break-inside:avoid}}'
    + '</style></head><body>'
    + '<h1>Production adjustments</h1>'
    + '<div class="head">' + rows.length + ' job(s)'
    + ' · printed ' + soStamp() + '</div>'
    + body + '</body></html>');
  w.document.close();
  w.focus();
  // WAIT FOR THE PICTURES. Printing on a fixed delay produced sheets with empty boxes where the
  // photo should be — the one thing on the page production actually needs. The timeout is only a
  // fallback for an image that never loads, and the guard stops it printing twice.
  let printed = false;
  const go = () => { if (printed) return; printed = true; w.print(); };
  w.onload = go;
  setTimeout(go, 4000);
};

/**
 * A PICK SHEET for one order — the same shape as the Adjustments print, for the same reason.
 *
 * Whoever packs this reads the photo first and the words second, so the picture gets the space and
 * everything else arranges itself around it. What is on the line is what a picker actually has to
 * decide: which code to pull, how many, and where it is.
 *
 * SEND QTY, NOT ORDERED QTY, is the big number. Those two differ exactly when somebody has decided to
 * ship something other than what was ordered, and a sheet printing the ordered figure there would
 * quietly undo that decision at the bench. The ordered quantity is still shown beside it when they
 * differ, so the difference is visible rather than hidden.
 */
/* ONE order as a printable section. One builder, used by both the single-order button and the
 * many-order one — two copies of a pick sheet would drift, and the half nobody checks is the one
 * that goes to the bench. */
function soPrintSection(o) {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const meta = SHOP_META[o.id] || {};
  const lines = o.items.filter(i => soSendQty(o.id, i.sku, soLive(i)) > 0);
  if (!lines.length) return '';
  const addr = [o.ship.name, o.ship.a1, o.ship.a2, o.ship.city, o.ship.state, o.ship.zip, o.ship.country]
    .filter(Boolean).join(', ');
  const units = lines.reduce((s, i) => s + soSendQty(o.id, i.sku, soLive(i)), 0);

  const body = lines.map(i => {
    const shop = String(i.sku || '').trim().toUpperCase();
    const amz = soAmzSku(i.sku);
    const send = soSendQty(o.id, i.sku, soLive(i));
    const fbaKey = String(amz || '').toUpperCase();
    const fba = fbaKey ? soOrdFba(o, fbaKey) : null;
    const ind = soIndiaOf(i.sku);
    const ln = soLine(o.id, shop);
    return '<div class="job">'
      + '<div class="pic">' + (i.img ? '<img src="' + esc(i.img) + '" alt="">' : '<div class="nopic">no picture</div>') + '</div>'
      + '<div class="det">'
        + '<div class="hdr"><span class="id big">' + esc(shop || i.name) + '</span>'
          + '<span class="qty">' + send + ' pc' + (send === 1 ? '' : 's') + '</span></div>'
        + '<div class="name">' + esc(i.name + (i.variant ? ' \u00b7 ' + i.variant : '')) + '</div>'
        + '<table class="kv"><tbody>'
          + '<tr><th>SKU</th><td class="id">' + (shop ? esc(shop) : '\u2014') + '</td>'
            + '<th>Amazon SKU</th><td class="id">' + (amz && amz !== shop ? esc(amz) : '\u2014') + '</td></tr>'
          + '<tr><th>Ordered</th><td' + (send !== i.qty ? ' class="want"' : '') + '>' + i.qty
            + (send !== i.qty ? ' \u2014 <b>sending ' + send + '</b>' : '') + '</td>'
            + '<th>Bin</th><td class="sz">' + (soLocOf(shop) ? esc(soLocOf(shop)) : '\u2014') + '</td></tr>'
          + '<tr><th>FBA</th><td>' + (fba == null ? 'not in FBA' : fba + ' available') + '</td>'
            + '<th>India</th><td>' + (ind ? ind[0] + ' sellable' + (ind[2] > 1 ? ' (' + ind[1] + ' pcs, pack ' + ind[2] + ')' : '') : 'not listed') + '</td></tr>'
          + (ln && ln.q != null ? '<tr><th>At location</th><td colspan="3">' + ln.q + ' of ' + i.qty + ' already on the shelf</td></tr>' : '')
        + '</tbody></table>'
        + '<div class="sign">Picked ______  Checked ______  Packed ______</div>'
      + '</div></div>';
  }).join('');

  return '<section>'
    + '<h1>' + esc(o.no) + '</h1>'
    + '<div class="head">' + esc(o.at) + ' \u00b7 ' + lines.length + ' line(s) \u00b7 ' + units + ' piece(s)</div>'
    + '<div class="ship"><b>' + esc(o.ship.name || 'Customer') + '</b><br>' + esc(addr)
      + (o.ship.phone ? '<br>' + esc(o.ship.phone) : '')
      + (o.note ? '<br><br><b>Customer note:</b> ' + esc(o.note) : '')
      + (meta.note ? '<br><b>Our note:</b> ' + esc(meta.note) : '')
      + '</div>'
    + body
    + '</section>';
}

/** Open a print window holding whatever sections were built. */
function soPrintWindow(sections, title, subtitle) {
  const w = window.open('', '_blank');
  if (!w) {
    soMsg('The browser blocked the print tab — allow pop-ups for this site.', true);
    return;
  }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title>'
    + '<style>'
    + 'body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}'
    + 'h1{font-size:20px;margin:0 0 2px}'
    + '.head{color:#555;font-size:12px;margin-bottom:6px}'
    + '.ship{border:1.5px solid #111;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px}'
    + '.ship b{font-size:14px}'
    + '.job{display:flex;gap:16px;border:1.5px solid #333;border-radius:8px;padding:12px;margin-bottom:12px}'
    + '.pic{flex:0 0 62mm}'
    + '.pic img{width:62mm;height:62mm;object-fit:contain;border:1px solid #bbb;border-radius:6px;background:#fafafa}'
    + '.nopic{width:62mm;height:62mm;border:1px dashed #bbb;border-radius:6px;display:flex;'
    + 'align-items:center;justify-content:center;color:#999;font-size:12px}'
    + '.det{flex:1;min-width:0}'
    + '.hdr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px}'
    + '.qty{font-size:22px;font-weight:800;border:2px solid #111;border-radius:6px;padding:1px 12px;white-space:nowrap}'
    + '.name{font-size:15px;font-weight:600;margin-bottom:8px}'
    + 'table.kv{border-collapse:collapse;width:100%}'
    + 'table.kv th,table.kv td{border:1px solid #bbb;padding:4px 7px;text-align:left;vertical-align:top;font-size:12px}'
    + 'table.kv th{background:#f0f0f0;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;width:74px;white-space:nowrap}'
    + '.sz{font-size:15px;font-weight:700}'
    + '.want{background:#fff3c4}'
    + '.id{font-family:ui-monospace,Consolas,monospace}'
    + '.big{font-size:14px;font-weight:700}'
    + '.sign{margin-top:10px;font-size:12px;color:#333}'
    // EVERY ORDER STARTS A NEW PAGE. These sheets are handed over one order at a time, and two orders
    // sharing a page is how a picker packs half of one into the other's box.
    + '@media print{body{margin:10mm}.job{page-break-inside:avoid}'
    + 'section{page-break-before:always}section:first-of-type{page-break-before:auto}}'
    + 'section{margin-bottom:26px}'
    + '</style></head><body>'
    + (subtitle ? '<div class="head">' + subtitle + ' \u00b7 printed ' + soStamp() + '</div>' : '')
    + sections.join('') + '</body></html>');
  w.document.close();
  w.focus();
  // WAIT FOR THE PICTURES — same reason as the Adjustments sheet: printing on a fixed delay produced
  // sheets with empty boxes where the photo should be, which is the one thing the packer needs.
  // Longer here, because a batch of orders carries a lot more of them.
  let printed = false;
  const go = () => { if (printed) return; printed = true; w.print(); };
  w.onload = go;
  setTimeout(go, Math.min(15000, 4000 + sections.length * 800));
}

$('soPrint').onclick = () => {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const sec = soPrintSection(o);
  if (!sec) {
    $('soErr').textContent = 'Every line on this order is set to send 0 — there is nothing to pick.';
    $('soErr').classList.remove('hide');
    return;
  }
  soPrintWindow([sec], o.no, '');
};

/* The ticked orders, or everything on screen when nothing is ticked — the same rule the Adjustments
 * print uses, so the two behave alike. */
$('soPrintMany').onclick = () => {
  const shown = soRows();
  const picked = shown.filter(r => SO_PICKED.has(r.id));
  const use = picked.length ? picked : shown;
  if (!use.length) { soMsg('Nothing to print — widen the filters, or fetch some orders.', true); return; }
  const sections = [], empty = [];
  use.forEach(r => {
    const o = SHOP.orders.find(x => x.id === r.id);
    const sec = o ? soPrintSection(o) : '';
    if (sec) sections.push(sec); else empty.push(r.no);
  });
  if (!sections.length) { soMsg('Every order chosen has all its lines set to send 0.', true); return; }
  soPrintWindow(sections, sections.length + ' orders',
    sections.length + ' order(s)'
      // Named, not silently skipped. An order missing from a batch of pick sheets is otherwise
      // discovered at the bench, by its absence.
      + (empty.length ? ' \u00b7 skipped ' + empty.length + ' with nothing to send: ' + empty.join(', ') : ''));
  soMsg(`Printing ${sections.length} order(s)${picked.length ? ' (ticked)' : ' (everything shown)'}.`);
};


/* Quoted-CSV reader, lifted from the Replenishment app rather than written again. A hand-rolled
 * split(',') is fine right up until an address contains a comma, which every address list does. */
/* parseCsv is NOT repeated here: this app already declares it at line 4623 of its own
 * module, character for character. A second one is a SyntaxError, and a SyntaxError in a module
 * stops every tab in the app rather than just this screen. */


/* ---- from Sellora: Imported orders ---- */
