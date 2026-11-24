/* ================= PRINTER'S PORTAL · CLOTH SENT TO YOU — the RFD challans we sent this printer =================
 * Vishesh, 23 Nov: "when I open the printer portal and search for that order I should be able to see that order under that
 * printer"; "under printer portal it should be visible"; the printer presses received.
 * Each RFD challan to a printer leaves a copy in the printer's own branch, pt_vendorChallans/<code>/<no> with kind 'cloth'
 * (flow-challan.js, CLOTH ON ITS WAY TO THE PRINTER). Above the Bulk orders the portal lists them: challan, date, our orders
 * and SKUs, metres, and In transit / Received. With nothing searched only the ones in transit show; a search (order no., SKU,
 * challan no., fabric) shows every match, received ones too.
 * "Cloth received" is pressed by the printer's own sign-in, or by an admin looking at the portal as that printer; it writes
 * received = { at, by } on the copy, and the Greige Desk then stops counting those metres as in transit.
 * Errors: reading is a view -- a failed read says so in the list's place and the orders below still show. Pressing "Cloth
 * received" is stock: a refusal is said on screen and nothing is marked; the button is off while it saves, and a copy already
 * received is never written again (safe to press twice). */
const PCL = { code: null, rows: null, err: '', busy: '' };   // rows: this printer's copies, newest first; busy: the challan being saved

/* ON THE ORDER'S OWN ROW (Ravi, 24 Nov: "printer portal par jab fabric bhej de idhar se to order neeche … aise show hone chahiye as it
 * is, isme hi fabric / cut pcs receive ka option de do"): the separate "Cloth sent to you" list is gone. The copies are still read
 * here, and each order line shows under its order number what we sent for it, with "Cloth received" (pclLineHtml, below). */
let PCL_LIST_SHOWN = false;   // the tests switch the old list back on to check it
/** Reads the copies for the printer on screen; the old list above the Bulk orders only when PCL_LIST_SHOWN. */
function pclSection(q) {
  if (!VP.code) return '';
  if (PCL.code !== VP.code) { pclLoad(VP.code); return ''; }
  if (!PCL_LIST_SHOWN) return '';
  if (PCL.err) return `<div class="card muted" style="padding:10px 14px;margin-bottom:10px;font-size:12.5px">Cloth sent to you: ${esc(PCL.err)}</div>`;
  const list = pclShown(PCL.rows || [], q);
  if (!list.length) return '';
  const may = pclMayReceive();
  return `<div class="card" style="padding:12px 14px;margin-bottom:12px"><div style="font-weight:700;margin-bottom:6px">Cloth sent to you`
    + ` <span class="muted" style="font-weight:400;font-size:12px">· ${q ? 'matching your search' : 'still on its way'}</span></div>`
    + `<div class="ff-grid"><table class="xl" style="width:100%"><thead><tr><th style="text-align:left">Challan</th><th style="text-align:left">Our order</th>`
    + `<th style="text-align:left">SKUs</th><th>Sent</th><th style="text-align:left">Status</th><th></th></tr></thead><tbody>`
    + list.map(c => pclRow(c, may)).join('') + '</tbody></table></div></div>';
}
/** In transit ones when nothing is searched; every match when something is. */
function pclShown(rows, q) {
  return rows.filter(c => (q ? pclHay(c).includes(q) : !c.received));
}
const pclHay = c => [c.no, c.date, ...(c.lines || []).flatMap(l => [l.orderNo, l.sku, l.fabric])].filter(Boolean).join(' ').toLowerCase();
function pclRow(c, may) {
  const orders = [...new Set((c.lines || []).map(l => l.orderNo).filter(Boolean))], skus = (c.lines || []).map(l => l.sku).filter(Boolean);
  const fabrics = [...new Set((c.lines || []).map(l => l.fabric).filter(Boolean))].join(', ');
  const status = c.received
    ? `<span style="background:#dcfce7;color:#166534;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600">Received ${esc(String(c.received.at || '').slice(0, 10))}</span>`
    : '<span style="background:#fef3c7;color:#92400e;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600">In transit</span>';
  const btn = !c.received && may
    ? `<button type="button" data-pclrecv="${esc(c.no)}"${PCL.busy === c.no ? ' disabled' : ''}>${PCL.busy === c.no ? 'Saving…' : 'Cloth received'}</button>` : '';
  return `<tr><td style="text-align:left"><b class="mono">${esc(c.no)}</b><div class="muted" style="font-size:11.5px">${esc(c.date || '')}${fabrics ? ' · ' + esc(fabrics) : ''}</div></td>`
    + `<td style="text-align:left" class="mono">${esc(orders.join(', '))}</td><td style="text-align:left;font-size:12px">${esc(skus.join(', '))}</td>`
    + `<td class="num">${pclSentTxt(c)}</td><td style="text-align:left">${status}</td><td>${btn}</td></tr>`;
}
/* CUT PIECES IN PIECES (Ravi, 24 Nov: "running h to same aise hi dikhe but cut pcs me h to pcs me show ho"): a copy says per line
 * what the printer got — unit 'pcs' (cut pieces, printed on the SKU itself) or 'm' (running cloth); a copy made before carries no
 * unit and is metres. Both kinds on one challan: "20 pcs · 31.6 m". */
function pclSentTxt(c) {
  const ls = c.lines || [], pcs = ls.filter(l => l.unit === 'pcs').reduce((a, l) => a + (+l.pcs || 0), 0);
  const m = ls.filter(l => l.unit !== 'pcs').reduce((a, l) => a + (+l.metres || 0), 0);
  if (!ls.length || !ls.some(l => l.unit)) return `${nf(+c.metres || 0)} m`;   // a copy from before 24 Nov: metres, as it always said
  return [pcs > 0 ? `${nf(pcs)} pcs` : '', m > 0.005 ? `${nf(Math.round(m * 100) / 100)} m` : ''].filter(Boolean).join(' · ') || '—';
}
/** The challan copies that carried cloth or cut pieces for one Vendor Order line: its parts (flowPart "<order>__<sku>|<what>")
 *  matched to the copy lines by the same key. [{ c, qty, unit }] — qty in the unit the printer got. */
function pclForLine(o, l) {
  if (!PCL.rows || PCL.code !== VP.code || !l) return [];
  const parts = Array.isArray(l.parts) ? l.parts : String(l.flowPart || '').split('+').filter(Boolean);
  const keys = new Set(parts.map(p => String(p).split('|')[0]).filter(Boolean));
  if (!keys.size || typeof flowKey !== 'function') return [];
  const out = [];
  PCL.rows.forEach(c => {
    if (!c || c.cancelled) return;
    const ls = (c.lines || []).filter(x => x && keys.has(flowKey(x.orderNo, x.sku)));
    if (!ls.length) return;
    const pcs = ls.filter(x => x.unit === 'pcs').reduce((a, x) => a + (+x.pcs || 0), 0), m = ls.filter(x => x.unit !== 'pcs').reduce((a, x) => a + (+x.metres || 0), 0);
    out.push({ c, txt: [pcs > 0 ? nf(pcs) + ' pcs' : '', m > 0.005 ? nf(Math.round(m * 100) / 100) + ' m' : ''].filter(Boolean).join(' · ') || '—' });
  });
  return out;
}
/** Under the order number on the order sheet: each challan that brought this line's cloth / cut pieces — in transit with
 *  "Cloth received", or received with its date. '' when we sent nothing for it (an older order, or the copies not read). */
function pclLineHtml(o, l) {
  const may = pclMayReceive();
  return pclForLine(o, l).map(({ c, txt }) => c.received
    ? `<div style="font-size:10.5px;font-weight:600;color:#166534;margin-top:3px">✓ ${esc(txt)} received · ${esc(c.no)} · ${esc(String(c.received.at || '').slice(0, 10))}</div>`
    : `<div style="font-size:10.5px;font-weight:600;color:#92400e;margin-top:3px">${esc(txt)} sent to you · ${esc(c.no)} · ${esc(c.date || '')} · in transit</div>`
      + (may ? `<button type="button" data-pclrecv="${esc(c.no)}"${PCL.busy === c.no ? ' disabled' : ''} style="width:auto;height:28px;padding:0 10px;font-size:11.5px;margin-top:3px">${PCL.busy === c.no ? 'Saving…' : 'Cloth received'}</button>` : '')).join('');
}
/** The printer's own sign-in, or an admin looking as the printer. Someone who may only look does not mark cloth received. */
const pclMayReceive = () => !!((typeof NAV_IS_VENDOR !== 'undefined' && NAV_IS_VENDOR) || (ME && ME.admin));

/** Reads this printer's copies once, then draws the portal again. Never throws. */
async function pclLoad(code) {
  PCL.code = code; PCL.rows = []; PCL.err = '';
  try { PCL.rows = pclCopies(await ptGet('pt_vendorChallans/' + code)); }
  catch (e) { PCL.err = /permission|denied/i.test(String(e.message || e)) ? 'not readable from this sign-in yet.' : 'could not be read (' + (e.message || e) + ').'; console.warn(`Cloth sent to ${code}: ${PCL.err}`); }
  if (VP.code === code) renderVp();
}
/** The 'cloth' copies of a branch, newest first. */
function pclCopies(branch) {
  return ptList(branch || {}).filter(c => c && c.kind === 'cloth').sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.no).localeCompare(String(a.no)));
}

/** "Cloth received": marks the copy received. Returns '' when saved, else what went wrong in words. */
async function pclReceive(no) {
  const code = VP.code, c = (PCL.rows || []).find(x => x.no === no);
  if (!c) return `Challan ${no} is not in your list — press Refresh.`;
  if (c.received) return '';
  if (!pclMayReceive()) return 'Only the printer marks cloth received.';
  const rec = { at: new Date().toISOString(), by: ME.email || '' };
  try { await ptPut(`pt_vendorChallans/${code}/${no}/received`, rec); }
  catch (e) { return `Challan ${no} was not marked received: ${e.message || e}. Try again.`; }
  PCL.rows = PCL.rows.map(x => (x.no === no ? Object.assign({}, x, { received: rec }) : x));
  if (typeof FLOW !== 'undefined' && FLOW && FLOW.cloth && FLOW.cloth[code] && FLOW.cloth[code][no]) FLOW.cloth[code][no] = Object.assign({}, FLOW.cloth[code][no], { received: rec });
  return '';
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', async e => {
  const t = e.target && e.target.closest && e.target.closest('[data-pclrecv]'); if (!t || PCL.busy) return;
  const no = t.dataset.pclrecv;
  PCL.busy = no; renderVp();
  const er = await pclReceive(no);
  PCL.busy = '';
  if (er) toast(er);
  renderVp();
});
