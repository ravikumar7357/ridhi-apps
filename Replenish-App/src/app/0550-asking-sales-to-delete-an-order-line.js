/* ================= ASKING SALES TO DELETE AN ORDER LINE =================
 *
 * Ravi: "ye mujhe system se delete krna h but I don't have option so give an option to send back to
 * sales team, ask for delete, they will delete it".
 *
 * THE ORDER CONSOLE ASKS; THE SALES TEAM DECIDES. A line in the order book is somebody's sales order,
 * so production does not delete it. It ticks the line(s), says why, and the request lands in Sales
 * Orders → Deletion requests. There the sales team deletes it, or keeps it with a note.
 *
 * WHERE: pt_obDeleteReqs/<odr_ORDER_SKU>. One id per order line, so asking twice cannot file two
 * requests. Asking again after a "keep" reopens the same record, and the earlier answer is kept on it.
 *
 * WHAT DELETING DOES, in ONE PATCH:
 *   · every pt_orderBook row for that order + SKU is removed — found by reading the order book again,
 *     by its stored key. The key is not rebuilt from the SKU: renamed SKUs still sit under their old
 *     key (ob_so_AMZ-25082026-01_CPC-SC-005 holds CPC-SWC-005);
 *   · the SKU's lines come off the sales order itself (pt_salesOrders/<order>/lines), and what was
 *     removed is logged on it as removedLines. Without this, approving the order again would put the
 *     line straight back — approval fills whatever is missing;
 *   · the request is marked deleted, with who and when.
 *
 * WORK ALREADY RECORDED against the line (cut, issued, received, pressed) is NOT deleted. Those rows
 * keep their Order ID and simply stop counting against a line. Both the request and the delete say
 * how much there is, so nobody removes a half-made line without seeing it.
 *
 * WHO: asking needs the Order Console (tab `ord`); answering needs Sales Orders (tab `so`). Admins can
 * do both.
 */
let ODR = { rows: null, pick: new Set() };

const odrId = (no, sku) => 'odr_' + (obUC(no) + '_' + obUC(sku)).replace(/[.#$\[\]\/\s]/g, '-');
const odrCanAsk = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('ord') >= 0);
const odrCanAnswer = () => !spIsVendor() && !!(ME.admin || (ME.tabs || []).indexOf('so') >= 0);
const odrPending = () => (ODR.rows || []).filter(r => r && r.status === 'pending');
const odrPendingOf = (no, sku) => odrPending().find(r => r.id === odrId(no, sku)) || null;

async function odrLoad(force) {
  if (ODR.rows && !force) return ODR.rows;
  try { ODR.rows = ptList(await ptGet('pt_obDeleteReqs')).filter(r => r && r.id); }
  catch (e) { ODR.rows = ODR.rows || []; }
  odrBadge();
  return ODR.rows;
}

/** The count on Sales Orders — only for somebody who can answer. */
function odrBadge() {
  const n = odrCanAnswer() ? odrPending().length : 0;
  const el = $('soDelBadge');
  if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('hide', !n); }
  /* The quantity sheet writes quantities, so it is the approvers' button, like the single change. */
  ['sxQtyTpl', 'sxQtyImp'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !soCanApprove()); });
  const b = $('sxDelReqs');
  if (b) { b.textContent = n ? `Deletion requests (${nf(n)})` : 'Deletion requests'; b.classList.toggle('hide', !odrCanAnswer()); }
}

/** The work booked against a line right now, or what the request saw if the line is gone. */
function odrWork(r) {
  const l = ordLines().find(x => x.orderNo === obUC(r.orderNo) && x.sku === obUC(r.sku));
  const w = l ? { cut: l.cut, issued: l.issued, received: l.received, pressed: l.pressed, qty: l.qty, live: true }
    : Object.assign({ cut: 0, issued: 0, received: 0, pressed: 0, qty: r.qty, live: false }, r.work || {});
  w.any = (w.cut || 0) + (w.issued || 0) + (w.received || 0) + (w.pressed || 0) > 0;
  w.text = [w.cut && `${nf(w.cut)} cut`, w.issued && `${nf(w.issued)} issued`, w.received && `${nf(w.received)} received`,
    w.pressed && `${nf(w.pressed)} pressed`].filter(Boolean).join(' · ');
  return w;
}

/* ---- asking, from the Order Console ---- */
function odrAskOpen() {
  if (!odrCanAsk()) return;
  const keys = [...(ORD.pick || new Set())];
  if (!keys.length) return;
  const all = new Map(ordLines().map(l => [l.orderNo + '|' + l.sku, l]));
  const lines = keys.map(k => all.get(k)).filter(Boolean);
  const busy = lines.filter(l => l.cut || l.issued || l.received || l.pressed);
  const asked = lines.filter(l => odrPendingOf(l.orderNo, l.sku));
  ptOpenDialog({
    title: `Ask sales to delete ${nf(lines.length)} line(s)`,
    subtitle: [...new Set(lines.map(l => l.orderNo))].slice(0, 4).join(', ') + (new Set(lines.map(l => l.orderNo)).size > 4 ? '…' : ''),
    note: 'The lines stay in the order book until the sales team answers in Sales Orders → Deletion requests. '
      + 'If they delete them, the line comes off the sales order too, so approving it again cannot bring it back.',
    html: `<div style="font-size:12.5px">
        ${busy.length ? `<div class="err">${nf(busy.length)} of these already have work booked against them — deleting the line does not delete that work, it just stops counting against an order.</div>` : ''}
        ${asked.length ? `<div class="muted">${nf(asked.length)} already have a request waiting and will be skipped.</div>` : ''}
        <label style="display:block;margin-top:8px">Why should these go?<input id="odrWhy" type="text" placeholder="e.g. Amazon cancelled, duplicate line, wrong SKU"></label>
        <div class="xlwrap" style="max-height:30vh;margin-top:8px"><table class="xl"><thead><tr><th>Order</th><th>SKU</th><th class="num">Ordered</th><th>Work booked</th></tr></thead><tbody>
        ${lines.slice(0, 200).map(l => `<tr><td style="text-align:left">${esc(l.orderNo)}</td><td style="font-family:ui-monospace,monospace;text-align:left">${esc(l.sku)}</td>`
          + `<td class="num">${nf(l.qty)}</td><td style="text-align:left">${esc(odrWork(l).text) || '<span class="muted">none</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>`,
    onSave: () => odrAskSave(keys),
    saveLabel: 'Send to the sales team',
  });
}

async function odrAskSave(keys) {
  if (!odrCanAsk()) return 'Only somebody with the Order Console can ask for a line to be deleted.';
  const why = String((($('odrWhy') || {}).value) || '').trim();
  if (!why) return 'Say why — the sales team has to decide from that.';
  if (!keys.length) return 'Tick the line(s) first.';
  await odrLoad(true);
  const all = new Map(ordLines().map(l => [l.orderNo + '|' + l.sku, l]));
  const now = new Date().toISOString(), updates = {}, recs = [], skipped = [];
  keys.forEach(k => {
    const l = all.get(k);
    if (!l) return skipped.push('not in the order book any more');
    if (odrPendingOf(l.orderNo, l.sku)) return skipped.push('already asked');
    const id = odrId(l.orderNo, l.sku);
    const old = (ODR.rows || []).find(r => r.id === id);
    const rec = { id, status: 'pending', orderNo: l.orderNo, sku: l.sku, qty: l.qty, orderDate: l.orderDate || '',
      articleType: l.articleType || '', articleSubtype: l.articleSubtype || '', color: l.color || '', size: l.size || '',
      src: l.src || '', work: { cut: l.cut || 0, issued: l.issued || 0, received: l.received || 0, pressed: l.pressed || 0 },
      why, by: ME.email, at: now };
    if (old) rec.previous = (Array.isArray(old.previous) ? old.previous : [])
      .concat({ status: old.status, why: old.why || '', by: old.by || '', at: old.at || '',
        answeredBy: old.answeredBy || '', answeredAt: old.answeredAt || '', note: old.note || '' });
    updates['pt_obDeleteReqs/' + id] = rec;
    recs.push(rec);
  });
  const skipText = skipped.length ? ` · ${nf(skipped.length)} skipped (${[...new Set(skipped)].join(', ')})` : '';
  if (!recs.length) return 'Nothing was sent' + skipText + '.';
  await ptPatch(updates);
  const ids = new Set(recs.map(r => r.id));
  ODR.rows = (ODR.rows || []).filter(r => !ids.has(r.id)).concat(recs);
  ORD.pick = new Set();
  odrBadge();
  renderOrd();
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `${nf(recs.length)} line(s) sent to the sales team to delete${skipText}. `
    + 'They stay in the order book until somebody in Sales Orders answers.';
  return '';
}

/* ---- answering, from Sales Orders ---- */
function odrListOpen() {
  if (!odrCanAnswer()) return;
  const rows = odrPending().slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  ODR.pick = new Set([...ODR.pick].filter(id => rows.some(r => r.id === id)));
  ptOpenDialog({
    title: 'Deletion requests',
    subtitle: rows.length ? `${nf(rows.length)} order line(s) production has asked you to delete` : 'Nothing is waiting',
    note: 'Delete removes the line from the order book AND from its sales order, so approving the order again '
      + 'will not bring it back. Work already booked against it (cut, issued, pressed) stays where it is. '
      + 'Keep sends it back with your note.',
    html: rows.length ? `<div class="xlwrap" style="max-height:44vh"><table class="xl"><thead><tr>
        <th><input type="checkbox" data-odr-all style="width:auto;margin:0" title="Tick every request"></th>
        <th>Order</th><th>SKU</th><th>Item</th><th class="num">Ordered</th><th>Work booked</th><th>Why</th><th>Asked by</th></tr></thead><tbody>
        ${rows.map(r => { const w = odrWork(r); return `<tr>`
          + `<td><input type="checkbox" data-odr-pick="${esc(r.id)}"${ODR.pick.has(r.id) ? ' checked' : ''} style="width:auto;margin:0"></td>`
          + `<td style="text-align:left">${esc(r.orderNo)}</td>`
          + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
          + `<td style="text-align:left">${esc([r.articleSubtype || r.articleType || r.itemName, r.color, r.size].filter(Boolean).join(' · '))}</td>`
          + `<td class="num" style="font-weight:700">${nf(w.qty)}</td>`
          + `<td style="text-align:left${w.any ? ';color:var(--bad)' : ''}">${esc(w.text) || '<span class="muted">none</span>'}${w.live ? '' : '<div class="muted" style="font-size:10.5px">already gone from the order book</div>'}</td>`
          + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.why)}</td>`
          + `<td style="font-size:12px">${esc(String(r.by || '').split('@')[0])}<div class="muted" style="font-size:10.5px">${esc(String(r.at || '').slice(0, 10))}</div></td>`
          + '</tr>'; }).join('')}
      </tbody></table></div>
      <label style="display:block;margin-top:10px">Note for production (needed to keep a line)<input id="odrNote" type="text" placeholder="e.g. still needed for the September shipment"></label>`
      : '<div class="muted">Nothing is waiting.</div>',
    onSave: rows.length ? () => odrDeleteRun([...ODR.pick]) : null,
    saveLabel: 'Delete ticked',
    alt: rows.length ? { label: 'Keep ticked', run: () => odrKeepRun([...ODR.pick]) } : null,
  });
}

$('ptDlgBody').addEventListener('change', e => {
  const p = e.target.closest('[data-odr-pick]');
  if (p) { const id = p.getAttribute('data-odr-pick'); if (p.checked) ODR.pick.add(id); else ODR.pick.delete(id); return; }
  const a = e.target.closest('[data-odr-all]');
  if (a) {
    document.querySelectorAll('[data-odr-pick]').forEach(x => {
      x.checked = a.checked;
      const id = x.getAttribute('data-odr-pick');
      if (a.checked) ODR.pick.add(id); else ODR.pick.delete(id);
    });
  }
});

async function odrDeleteRun(ids) {
  if (!odrCanAnswer()) return 'Only the sales team (the Sales Orders tab) can delete an order line.';
  if (!ids.length) return 'Tick at least one request.';
  await odrLoad(true);
  const reqs = ids.map(id => odrPending().find(r => r.id === id)).filter(Boolean);
  if (!reqs.length) return 'Those requests are no longer waiting — somebody has answered them.';

  /* Read again: the order book and every sales order involved. A line may have been re-added, a
   * sales order edited, since the request was made. */
  const ob = ptList(await ptGet('pt_orderBook'));
  const orders = [...new Set(reqs.map(r => obUC(r.orderNo)))];
  const sos = await Promise.all(orders.map(no => ptGet('pt_salesOrders/' + no)));
  const soNext = new Map();
  orders.forEach((no, i) => {
    const so = sos[i];
    if (so && typeof so === 'object' && (so.lines || so.status))
      soNext.set(no, { lines: soLines(so), removed: Array.isArray(so.removedLines) ? so.removedLines.slice() : [], changed: false });
  });

  const now = new Date().toISOString(), updates = {}, goneKeys = new Set();
  let rowsGone = 0, soPieces = 0;
  const notes = [];
  reqs.forEach(r => {
    const no = obUC(r.orderNo), sku = obUC(r.sku);
    const w = odrWork(r);
    const rows = ob.filter(x => x && obUC(x.orderNo) === no && obUC(x.sku) === sku && x._key);
    rows.forEach(x => { updates['pt_orderBook/' + x._key] = null; goneKeys.add(x._key); });
    rowsGone += rows.length;
    const s = soNext.get(no);
    let q = 0;
    if (s) {
      const hit = s.lines.filter(l => obUC(l.sku) === sku);
      q = hit.reduce((t, l) => t + (parseFloat(l.qty) || 0), 0);
      if (hit.length) {
        s.lines = s.lines.filter(l => obUC(l.sku) !== sku);
        s.removed.push({ sku, qty: q, at: now, by: ME.email, reqId: r.id, why: r.why || '', askedBy: r.by || '' });
        s.changed = true;
        soPieces += q;
      }
    } else notes.push(`${no} is not a sales order in this app, so only its order-book row was removed`);
    Object.assign(updates, {
      ['pt_obDeleteReqs/' + r.id + '/status']: 'deleted',
      ['pt_obDeleteReqs/' + r.id + '/answeredBy']: ME.email,
      ['pt_obDeleteReqs/' + r.id + '/answeredAt']: now,
      ['pt_obDeleteReqs/' + r.id + '/obRowsRemoved']: rows.length,
      ['pt_obDeleteReqs/' + r.id + '/soQtyRemoved']: q,
      ['pt_obDeleteReqs/' + r.id + '/workAtDelete']: { cut: w.cut || 0, issued: w.issued || 0, received: w.received || 0, pressed: w.pressed || 0 },
    });
  });
  soNext.forEach((s, no) => {
    if (!s.changed) return;
    updates['pt_salesOrders/' + no + '/lines'] = s.lines;
    updates['pt_salesOrders/' + no + '/removedLines'] = s.removed;
    updates['pt_salesOrders/' + no + '/updatedAt'] = now;
  });
  await ptPatch(updates);

  /* A new array, so every index built on the order book knows it moved. */
  if (PTG.ob) PTG.ob = PTG.ob.filter(x => !(x && goneKeys.has(x._key)));
  if (SOX.rows) SOX.rows = SOX.rows.map(o => {
    const s = soNext.get(obUC(o._id || o._key));
    return s && s.changed ? Object.assign({}, o, { lines: s.lines, removedLines: s.removed, updatedAt: now }) : o;
  });
  const done = new Set(reqs.map(r => r.id));
  ODR.rows = (ODR.rows || []).map(r => (done.has(r.id) ? Object.assign({}, r, { status: 'deleted', answeredBy: ME.email, answeredAt: now }) : r));
  ODR.pick = new Set();
  odrBadge();
  if ($('sxMsg')) {
    $('sxMsg').className = 'muted';
    $('sxMsg').textContent = `${nf(reqs.length)} order line(s) deleted · ${nf(rowsGone)} order-book row(s) removed`
      + ` · ${nf(soPieces)} piece(s) taken off their sales order(s)`
      + (notes.length ? ' · ' + [...new Set(notes)].join('; ') : '') + '.';
  }
  try { renderSox(); } catch (e) { /* the screen may not be open */ }
  return '';
}

async function odrKeepRun(ids) {
  if (!odrCanAnswer()) return 'Only the sales team (the Sales Orders tab) can answer a request.';
  if (!ids.length) return 'Tick at least one request.';
  const note = String((($('odrNote') || {}).value) || '').trim();
  if (!note) return 'Say why these lines stay — production asked for a reason, and gets one back.';
  await odrLoad(true);
  const reqs = ids.map(id => odrPending().find(r => r.id === id)).filter(Boolean);
  if (!reqs.length) return 'Those requests are no longer waiting — somebody has answered them.';
  const now = new Date().toISOString(), updates = {};
  reqs.forEach(r => Object.assign(updates, {
    ['pt_obDeleteReqs/' + r.id + '/status']: 'kept',
    ['pt_obDeleteReqs/' + r.id + '/answeredBy']: ME.email,
    ['pt_obDeleteReqs/' + r.id + '/answeredAt']: now,
    ['pt_obDeleteReqs/' + r.id + '/note']: note,
  }));
  await ptPatch(updates);
  const done = new Set(reqs.map(r => r.id));
  ODR.rows = (ODR.rows || []).map(r => (done.has(r.id) ? Object.assign({}, r, { status: 'kept', answeredBy: ME.email, answeredAt: now, note }) : r));
  ODR.pick = new Set();
  odrBadge();
  if ($('sxMsg')) { $('sxMsg').className = 'muted'; $('sxMsg').textContent = `${nf(reqs.length)} line(s) kept · production can see your note on them.`; }
  return '';
}

$('sxDelReqs').onclick = async () => { await odrLoad(true); if (!PTG.ob) await ptLoadGates(); odrListOpen(); };

$('sxQtyTpl').onclick = soQtyTemplate;
$('sxQtyImp').onclick = () => $('sxQtyFile').click();
$('sxQtyFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = soQtySheetRead(rows);
    if (read.err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = read.err; return; }
    const plan = soQtyBulkPlan(read.entries);
    if (!plan.ok.length) {
      $('sxMsg').className = plan.skip.length ? 'err' : 'muted';
      $('sxMsg').textContent = plan.skip.length
        ? `Nothing to write. ${nf(plan.skip.length)} row(s) refused: `
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ` and ${nf(plan.skip.length - 3)} more.` : '')
        : 'Every row in that file already says what the order says.';
      return;
    }
    const up = plan.ok.filter(x => x.delta > 0), down = plan.ok.filter(x => x.delta < 0);
    const show = list => list.slice(0, 12).map(x => esc(x.o._id) + ' · ' + esc(x.sku) + ': '
      + nf(x.from) + ' → <b>' + nf(x.to) + '</b>' + (x.book == null ? ' <i>(not in the order book)</i>' : '')).join('<br>');
    ptOpenDialog({
      title: 'Change these quantities?',
      subtitle: `${nf(plan.ok.length)} line(s) · ${nf(up.length)} up · ${nf(down.length)} down`,
      /* THE ORDER BOOK MOVES WITH THEM — said here, because that is the part that reaches the floor. */
      note: 'The order book moves with the sales order, in the same write. A line the order book never '
        + 'got changes on the order only. Nothing goes below what has already been cut, received or pressed.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (up.length ? `<b style="color:#166534">Going up</b><br>${show(up)}`
          + (up.length > 12 ? `<br>…and ${nf(up.length - 12)} more.` : '') + '<br><br>' : '')
        + (down.length ? `<b style="color:var(--bad)">Coming down</b><br>${show(down)}`
          + (down.length > 12 ? `<br>…and ${nf(down.length - 12)} more.` : '') + '<br><br>' : '')
        + (plan.skip.length ? `<b style="color:var(--bad)">${nf(plan.skip.length)} row(s) refused, and not written</b><br>`
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 10 ? `<br>…and ${nf(plan.skip.length - 10)} more.` : '') : '')
        + '</div>',
      saveLabel: `Change ${nf(plan.ok.length)} line(s)`,
      onSave: async () => {
        const out = await soQtyBulkRun(plan);
        renderSox();
        if (out.err) return out.err;
        $('sxMsg').className = 'muted';
        $('sxMsg').textContent = `${nf(out.done)} quantit${out.done > 1 ? 'ies' : 'y'} changed, and the order book says the same.`
          + (plan.skip.length ? ` ${nf(plan.skip.length)} row(s) were refused and left alone.` : '');
        return '';
      },
    });
  } catch (err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = 'Could not read it: ' + (err.message || err); }
};

/* ================= IS IT LISTED ON AMAZON? =================
 *
 * Ravi: "listing status like listed or not listed … amazon data se check hokr … jese hi entry kre koi
 * sku yadi wo amazon par list ho to listed other wise not listed; if not listed team will get a alert".
 *
 * THE ANSWER COMES FROM AMAZON, never from the SKU name. The source is GET_MERCHANT_LISTINGS_ALL_DATA,
 * the same report Listing Health uses, pulled for both brands through the Price Research backend
 * (?lh=create / ?lh=poll). It lists every listing on the US marketplace, active and inactive.
 *
 * WHY NOT READ THE LISTING HEALTH SNAPSHOT? Two reasons, both real:
 *   · it drops merchant-fulfilled listings and RB* bundles, so absence from it is not proof. An MFN
 *     listing is still a listing, and calling it "not listed" would send the team to list it again;
 *   · it lives in Firestore behind perms.repl, and the store team's accounts are factory-only.
 * So the full report is boiled down to one index in the production database, pt_amzListings, which
 * every factory account can read:
 *   { at, by, brands: { SP: {n}, CPC: {n} }, list: "SKU\tstatus\tchannel\tasin\n…" }
 * One string, not a keyed object: SKUs can contain characters a database key cannot.
 *
 * THREE ANSWERS, and the difference matters:
 *   listed    at least one row for the SKU is Active
 *   inactive  it is on Amazon but not live (out of stock, suppressed, incomplete) — still LISTED
 *   not       Amazon has no row for it at all → this is the one that raises an alert
 *   unknown   there is no index yet. Nothing is alerted on no evidence.
 *
 * WHO REFRESHES IT: any account that can reach the backend (not factory-only). It refreshes by itself
 * when that person opens Finished Goods and the index is more than 24 hours old, and a button does it
 * on demand. The report takes several minutes to build, so a lock (pt_amzListings/refreshing) stops two
 * people ordering it at once.
 *
 * THE ALERT: saving a stock entry for a SKU that is `not` listed writes pt_listingAlerts/<SKU> (once —
 * later entries only update it) and says so on screen. The team sees a red count on Finished Goods in
 * the sidebar and the "Needs listing on Amazon" view. An alert closes itself when a later index shows
 * the SKU listed, or somebody closes it by hand with a note.
 */
let LST = { at: '', map: null, alerts: null, refreshing: null, busy: false, err: '' };
const LST_STALE_MS = 24 * 3600 * 1000;
const lstKey = sku => obUC(sku).replace(/[.#$\[\]\/]/g, '_');

function lstParse(idx) {
  const map = new Map();
  String((idx && idx.list) || '').split('\n').forEach(line => {
    if (!line) return;
    const [s, st, ch, asin] = line.split('\t');
    const k = obUC(s); if (!k) return;
    const e = map.get(k) || { active: false, rows: 0, channels: new Set(), asin: '' };
    e.rows++;
    if (/^active$/i.test(String(st || '').trim())) e.active = true;
    if (ch) e.channels.add(ch);
    if (asin && !e.asin) e.asin = asin;
    map.set(k, e);
  });
  return map;
}

/** What Amazon says about a SKU: { st: 'listed' | 'inactive' | 'not' | 'unknown', asin }. */
function lstOf(sku) {
  if (!LST.map || !LST.map.size) return { st: 'unknown', asin: '' };
  const e = LST.map.get(obUC(sku));
  if (!e) return { st: 'not', asin: '' };
  return { st: e.active ? 'listed' : 'inactive', asin: e.asin };
}
const LST_PILL = { listed: ['pill-ok', 'Listed'], inactive: ['pill-low', 'Listed · inactive'], not: ['pill-out', 'Not listed'], unknown: ['', '—'] };

async function lstLoad() {
  try {
    const [idx, al] = await Promise.all([ptGet('pt_amzListings'), ptGet('pt_listingAlerts')]);
    LST.at = (idx && idx.at) || '';
    LST.refreshing = (idx && idx.refreshing) || null;
    LST.map = lstParse(idx);
    LST.alerts = al && typeof al === 'object' ? al : {};
    LST.err = '';
  } catch (e) { LST.err = e.message || String(e); LST.map = LST.map || new Map(); LST.alerts = LST.alerts || {}; }
  lstBadge();
}

async function lstLoadAlerts() {
  try { const al = await ptGet('pt_listingAlerts'); LST.alerts = al && typeof al === 'object' ? al : {}; } catch (e) { /* the badge waits */ }
  lstBadge();
}

/** Open alerts that Amazon still does not list — the ones somebody has to act on. */
function lstOpen() {
  return Object.values(LST.alerts || {}).filter(a => a && a.status === 'open' && lstOf(a.sku).st !== 'listed' && lstOf(a.sku).st !== 'inactive');
}

function lstBadge() {
  const el = $('fgiLstBadge'); if (!el) return;
  const n = lstOpen().length;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

const lstCanRefresh = () => !spIsVendor() && !!(PRAPI && PRAPI.url);

/**
 * Ask Amazon for the listings of both brands, and write the index.
 * Alerts whose SKU is now on Amazon close in the same write.
 */
async function lstRefresh(say) {
  if (!lstCanRefresh()) return 'This account cannot reach the Amazon backend — ask somebody with Replenishment access to refresh.';
  if (LST.busy) return 'Already refreshing.';
  const tell = t => { if (say) say(t); };
  const now = Date.now();
  const lock = LST.refreshing;
  if (lock && lock.at && now - Date.parse(lock.at) < 20 * 60 * 1000 && lock.by !== ME.email)
    return `${String(lock.by || '').split('@')[0]} started a refresh at ${String(lock.at).slice(11, 16)} — it will land in a few minutes.`;
  LST.busy = true;
  try {
    await ptPatch({ 'pt_amzListings/refreshing': { by: ME.email, at: new Date().toISOString() } });
    const lines = [], brands = {};
    for (const brand of ['SP', 'CPC']) {
      tell(`Asking Amazon for ${brand === 'SP' ? 'Ridhi' : 'CPC'} listings…`);
      const cr = await prGet({ lh: 'create', brand });
      let done = null;
      for (let i = 0; i < 180 && !done; i++) {
        await new Promise(r => setTimeout(r, LST_POLL_MS));
        const p = await prGet({ lh: 'poll', brand, id: cr.reportId });
        if (p.status === 'done') done = p;
        else tell(`${brand === 'SP' ? 'Ridhi' : 'CPC'} listings report is being built by Amazon… ${i + 1}`);
      }
      if (!done) throw new Error(`Amazon did not finish the ${brand} listings report in time.`);
      const rows = done.rows || [];
      /* The backend caps what it returns. A capped list would call real listings "not listed". */
      if ((done.total || rows.length) > rows.length)
        throw new Error(`The ${brand} report has ${done.total} listings but only ${rows.length} came back — refusing to write a partial list.`);
      rows.forEach(r => { if (r && r.sku) lines.push([String(r.sku).replace(/[\t\n]/g, ' '), r.status || '', r.channel || '', r.asin || ''].join('\t')); });
      brands[brand] = { n: rows.length };
    }
    if (!lines.length) throw new Error('Amazon returned no listings at all — the index was left as it was.');
    const at = new Date().toISOString();
    const idx = { at, by: ME.email, brands, list: lines.join('\n') };
    LST.map = lstParse(idx); LST.at = at;
    const updates = { pt_amzListings: Object.assign({}, idx, { refreshing: null }) };
    let closed = 0;
    Object.entries(LST.alerts || {}).forEach(([k, a]) => {
      if (!a || a.status !== 'open') return;
      const st = lstOf(a.sku).st;
      if (st === 'listed' || st === 'inactive') {
        updates['pt_listingAlerts/' + k + '/status'] = 'listed';
        updates['pt_listingAlerts/' + k + '/closedAt'] = at;
        updates['pt_listingAlerts/' + k + '/closedBy'] = 'Amazon listings ' + at.slice(0, 10);
        closed++;
      }
    });
    await ptPatch(updates);
    Object.keys(updates).forEach(p => {
      const m = p.match(/^pt_listingAlerts\/([^/]+)\/(.+)$/);
      if (m && LST.alerts[m[1]]) LST.alerts[m[1]][m[2]] = updates[p];
    });
    LST.refreshing = null;
    lstBadge();
    tell(`Amazon listings refreshed · ${nf(lines.length)} listing(s)` + (closed ? ` · ${nf(closed)} alert(s) closed — those SKUs are on Amazon now` : '') + '.');
    return '';
  } catch (e) {
    try { await ptPatch({ 'pt_amzListings/refreshing': null }); } catch (e2) { /* the lock expires by itself */ }
    return 'Amazon listings not refreshed: ' + (e.message || e);
  } finally { LST.busy = false; }
}
let LST_POLL_MS = 10000;

/** Refresh in the background when the index is missing or a day old, for somebody who can. */
function lstMaybeRefresh() {
  if (!lstCanRefresh() || LST.busy) return;
  const age = LST.at ? Date.now() - Date.parse(LST.at) : Infinity;
  if (age < LST_STALE_MS) return;
  const onFg = () => typeof TAB_NOW === 'undefined' || TAB_NOW === 'fgi';
  lstRefresh(t => { if (onFg() && $('fgView').value === 'alerts') { $('fgMsg').className = 'muted'; $('fgMsg').textContent = t; } })
    .then(why => { if (why && onFg()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; } else renderFgi(); });
}

/** After a stock entry is saved: alert if Amazon does not list the SKU. Returns the line to show. */
async function lstAlertFor(sku, type, qty) {
  const s = obUC(sku), a = lstOf(s);
  if (a.st !== 'not') return '';
  const k = lstKey(s), now = new Date().toISOString();
  const cur = (LST.alerts || {})[k];
  const rec = cur && cur.status === 'open'
    ? Object.assign({}, cur, { lastAt: now, lastBy: ME.email, lastType: type, lastQty: qty, entries: (cur.entries || 1) + 1 })
    : { sku: s, status: 'open', firstAt: now, by: ME.email, lastAt: now, lastBy: ME.email, lastType: type, lastQty: qty, entries: 1,
        listingsAt: LST.at || '' };
  try { await ptPut('pt_listingAlerts/' + k, rec); }
  catch (e) { return ` ${s} is NOT listed on Amazon, and the alert could not be saved (${e.message || e}) — tell the listing team.`; }
  LST.alerts = Object.assign({}, LST.alerts || {}, { [k]: rec });
  lstBadge();
  return cur && cur.status === 'open'
    ? ` ${s} is still NOT listed on Amazon — the listing team already has an alert for it.`
    : ` ⚠ ${s} is NOT listed on Amazon — the listing team has been alerted.`;
}

/** Close an alert by hand, with a note. */
async function lstClose(k, note) {
  const a = (LST.alerts || {})[k]; if (!a) return 'That alert is gone.';
  if (!String(note || '').trim()) return 'Say what was done — listed under another SKU, not for Amazon, …';
  const now = new Date().toISOString();
  await ptPatch({ ['pt_listingAlerts/' + k + '/status']: 'closed', ['pt_listingAlerts/' + k + '/closedAt']: now,
    ['pt_listingAlerts/' + k + '/closedBy']: ME.email, ['pt_listingAlerts/' + k + '/note']: String(note).trim() });
  Object.assign(a, { status: 'closed', closedAt: now, closedBy: ME.email, note: String(note).trim() });
  lstBadge();
  return '';
}

function lstRenderAlerts() {
  const q = $('fgQ').value.trim().toLowerCase();
  const all = Object.entries(LST.alerts || {}).map(([k, a]) => Object.assign({ k }, a)).filter(a => a && a.sku);
  const rows = all.filter(a => a.status === 'open')
    .filter(a => { const m = fgiMaster(a.sku); return !q || [a.sku, m.color, m.size, m.articleType, m.subtype].join(' ').toLowerCase().includes(q); })
    .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
  FGI.shown = rows;
  const head = '<thead><tr>' + ['SKU', 'Image', 'Item', 'In stock', 'Amazon now', 'First alerted', 'Last entry', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(a => {
    const m = fgiMaster(a.sku), st = lstOf(a.sku), [cls, txt] = LST_PILL[st.st];
    return '<tr>'
      + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(a.sku)}</td>`
      + ptImgCell(a.sku)
      + `<td style="text-align:left">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}</td>`
      + `<td class="num" style="font-weight:700">${nf(fgiOf(a.sku).current)}</td>`
      + `<td><span class="pill ${cls}">${txt}</span></td>`
      + `<td style="font-size:12px">${esc(String(a.firstAt || '').slice(0, 10))}<div class="muted" style="font-size:10.5px">${esc(String(a.by || '').split('@')[0])}</div></td>`
      + `<td style="font-size:12px">${esc(String(a.lastAt || '').slice(0, 10))}<div class="muted" style="font-size:10.5px">${esc(String(a.lastType || '').toLowerCase())} ${a.lastQty ? nf(a.lastQty) : ''} · ${nf(a.entries || 1)} entr${(a.entries || 1) === 1 ? 'y' : 'ies'}</div></td>`
      + `<td><button class="ghost" data-lstclose="${esc(a.k)}" style="padding:2px 9px;font-size:12px">Close</button></td>`
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="muted" style="padding:16px">No SKU is waiting to be listed on Amazon.</td></tr>') + '</tbody>';
  const done = all.filter(a => a.status !== 'open').length;
  $('fgMsg').className = rows.length ? 'err' : 'muted';
  $('fgMsg').textContent = `${nf(rows.length)} SKU(s) had stock entered but are NOT listed on Amazon`
    + (done ? ` · ${nf(done)} alert(s) already closed` : '')
    + (LST.at ? ` · Amazon listings as of ${String(LST.at).slice(0, 16).replace('T', ' ')}` : ' · the Amazon listings have never been fetched')
    + (lstCanRefresh() ? '' : ' · an alert closes by itself once the listings are refreshed and show the SKU');
  ptImgFill(rows.map(a => a.sku), false, ptImgPatch);
}

function lstCloseOpen(k) {
  const a = (LST.alerts || {})[k]; if (!a) return;
  ptOpenDialog({
    title: 'Close the alert for ' + a.sku,
    subtitle: 'Amazon still shows no listing for it',
    note: 'An alert closes by itself when the Amazon listings next show this SKU. Close it by hand only when it will not be '
      + 'listed under this SKU — say why, so the next person knows.',
    fields: [{ key: 'note', label: 'Why', value: '', span: true }],
    onSave: async v => { const why = await lstClose(k, v.note); if (why) return why; renderFgi(); return ''; },
    saveLabel: 'Close it',
  });
}

