/* ================= ADJUSTMENTS TAB =================
 *
 * The same records the order dialog writes, read straight out of SHOP_META rather than copied into
 * a list of their own. One place a job can exist means it cannot be open here and closed there.
 *
 * It works without fetching Shopify at all: everything a job needs was copied onto it when it was
 * raised, because the jobs that matter most are the old ones nobody is looking at.
 *
 * Four states, in the order they actually happen:
 *   raised    somebody found the problem
 *   sent      the sheet went to production
 *   accepted  production took it on and named a date
 *   received  shipping has the pieces back
 */
const AJ_STATE = {
  raised:   '<span class="st st-draft">Raised</span>',
  sent:     '<span class="st st-pending">With production</span>',
  accepted: '<span class="st st-pending">Accepted</span>',
  received: '<span class="st st-approved">Received</span>',
};
let AJ_PICKED = new Set();

async function ensureAdj() {
  if (!Object.keys(SHOP_META).length) await loadShopMeta();
  if (!Object.keys(SHOP_SKU).length) await loadShopSku();
  if (!$('ajFrom').value) {
    // Reaches TOMORROW. A job raised late in the day is the one somebody is chasing, and a window
    // that stops at "today" is exactly where it disappears.
    $('ajTo').value = sdShift(sdToday(), 1);
    $('ajFrom').value = sdShift(sdToday(), -30);
  }
  renderAdj();

  /* Bring the Order Console up to date with every adjustment, not just the one somebody last
   * saved. This is what reaches the ones raised before any of this existed, and the ones raised on
   * somebody else's screen. It writes nothing when there is nothing to do, so opening this tab
   * twice costs one read. Reported here rather than thrown: the tab itself is fine either way. */
  if (typeof shpSyncSoon === 'function') await shpSyncSoon('adj');   // the Replenish app's Order Console; Sellora has none
}

/** Every adjustment ever raised, flattened out of the per-order records. */
function ajAll() {
  const out = [];
  Object.entries(SHOP_META).forEach(([orderId, m]) => {
    Object.entries((m && m.lines) || {}).forEach(([sku, ln]) => {
      if (!ln || !ln.adj) return;
      out.push({
        orderId, sku, ln,
        id: ln.adj,
        at: ln.adjAt || '',
        day: String(ln.adjAt || '').slice(0, 10),
        order: ln.adjOrder || '',
        orderDate: ln.adjOrderDate || '',
        customer: ln.adjCustomer || '',
        name: ln.adjName || '',
        qty: Number(ln.adjQty) || 0,
        send: ln.adjSend || '', want: ln.adjWant || '',
        reason: ln.adjReason || '', note: ln.adjNote || '',
        img: ln.adjImg || '', loc: ln.adjLoc || soLocOf(sku),
        ordered: ln.adjOrdered, staged: ln.adjStaged,
        state: ln.adjState || 'raised',
        sentAt: ln.adjSentAt || '',
        accBy: ln.adjAccBy || '', accAt: ln.adjAccAt || '', due: ln.adjDue || '',
        recBy: ln.adjRecBy || '', recAt: ln.adjRecAt || '', recQty: ln.adjRecQty,
      });
    });
  });
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out;
}

function ajRows() {
  const st = $('ajState').value;
  const q = $('ajFilter').value.trim().toLowerCase();
  const from = $('ajFrom').value, to = $('ajTo').value;
  const today = sdToday();
  return ajAll().filter(r => {
    if (from && r.day && r.day < from) return false;
    if (to && r.day && r.day > to) return false;
    if (st === 'OPEN' && r.state === 'received') return false;
    else if (st === 'LATE' && !(r.state !== 'received' && r.due && r.due < today)) return false;
    else if (st !== 'ALL' && st !== 'OPEN' && st !== 'LATE' && r.state !== st) return false;
    if (q && !(r.id + ' ' + r.order + ' ' + r.sku + ' ' + r.name + ' ' + r.customer
      + ' ' + r.send + ' ' + r.want).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderAdj() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const rows = ajRows();
  const today = sdToday();

  const n = s => rows.filter(r => r.state === s).length;
  const late = rows.filter(r => r.state !== 'received' && r.due && r.due < today).length;
  const pcs = rows.reduce((s, r) => s + r.qty, 0);
  const tile = (l, v, c) => `<div class="metric"><div class="v"${c ? ` style="color:${c}"` : ''}>${v}</div><div class="l">${l}</div></div>`;
  $('ajKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Adjustments</span>
      <span class="kpiwhen">${rows.length} shown of ${ajAll().length} ever raised</span></div>
    <div class="metrics">
      ${tile('Pieces to make', pcs)}
      ${tile('Raised', n('raised'))}
      ${tile('With production', n('sent'), '#92400e')}
      ${tile('Accepted', n('accepted'), '#1e40af')}
      ${tile('Received back', n('received'), '#166534')}
      ${tile('Past promised date', late, late ? 'var(--bad)' : '')}
    </div></div>`;

  const head = '<thead><tr>'
    + '<th style="width:28px"><input type="checkbox" id="ajAll" title="Tick every row on screen"></th>'
    + '<th style="width:52px"></th><th>Adjustment</th><th>Order</th><th>SKU</th><th>Product</th>'
    + '<th>Sending &rarr; make in</th><th class="num">Qty</th><th>Reason</th><th>Bin</th>'
    + '<th>Raised</th><th>State</th><th>Promised</th><th>Back</th></tr></thead>';

  const body = rows.map(r => {
    const overdue = r.state !== 'received' && r.due && r.due < today;
    return '<tr' + (overdue ? ' style="background:#fef2f2"' : '') + '>'
      + '<td><input type="checkbox" class="ajPick" data-k="' + esc(r.orderId + '|' + r.sku) + '"'
        + (AJ_PICKED.has(r.orderId + '|' + r.sku) ? ' checked' : '') + '></td>'
      + '<td style="padding:2px 6px">' + (r.img
          ? '<img src="' + esc(r.img) + '" loading="lazy" decoding="async" alt=""'
            + ' style="width:38px;height:38px;object-fit:cover;border-radius:5px;background:#f1f5f9">'
          : '<span class="muted">—</span>') + '</td>'
      + '<td style="font-family:ui-monospace,monospace;font-size:11px">' + esc(r.id) + '</td>'
      + '<td>' + esc(r.order) + '<div class="muted" style="font-size:10.5px">' + esc(r.customer) + '</div></td>'
      + '<td style="font-family:ui-monospace,monospace;font-size:11px">' + esc(r.sku) + '</td>'
      + '<td title="' + esc(r.name) + '">' + esc(String(r.name).slice(0, 26)) + '</td>'
      + '<td style="white-space:nowrap">' + esc(r.send || '—') + ' &rarr; <b>' + esc(r.want || '—') + '</b></td>'
      + '<td class="num" style="font-weight:700">' + r.qty + '</td>'
      + '<td>' + esc(r.reason || '—') + '</td>'
      + '<td>' + esc(r.loc || '—') + '</td>'
      + '<td style="white-space:nowrap;font-size:11px">' + esc(r.at) + '</td>'
      + '<td>' + (AJ_STATE[r.state] || esc(r.state))
        + (r.accBy ? '<div class="muted" style="font-size:10px">' + esc(r.accBy) + '</div>' : '') + '</td>'
      + '<td style="white-space:nowrap">' + (r.due
          ? (overdue ? '<span class="sd-dn">' + esc(r.due) + '</span>' : esc(r.due))
          : '<span class="muted">—</span>') + '</td>'
      + '<td style="white-space:nowrap;font-size:11px">' + (r.recAt
          ? esc(r.recAt) + (r.recQty != null ? '<div class="muted" style="font-size:10px">' + r.recQty + ' pc</div>' : '')
          : '<span class="muted">—</span>') + '</td>'
      + '</tr>';
  }).join('');

  $('ajTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="14" class="muted" style="padding:14px">Nothing matches. Adjustments are raised inside an order on the Shopify Orders tab.</td></tr>')
    + '</tbody>';

  $('ajTable').querySelectorAll('.ajPick').forEach(cb => {
    cb.onchange = () => { cb.checked ? AJ_PICKED.add(cb.dataset.k) : AJ_PICKED.delete(cb.dataset.k); ajMsgPicked(); };
  });
  const all = $('ajAll');
  if (all) all.onchange = () => {
    $('ajTable').querySelectorAll('.ajPick').forEach(cb => {
      cb.checked = all.checked;
      all.checked ? AJ_PICKED.add(cb.dataset.k) : AJ_PICKED.delete(cb.dataset.k);
    });
    ajMsgPicked();
  };
  ajMsgPicked();
}

function ajMsgPicked() {
  const m = $('ajMsg');
  m.className = 'muted';
  m.textContent = AJ_PICKED.size
    ? `${AJ_PICKED.size} ticked · Print, Mark sent, Accept or Received apply to these.`
    : 'Tick rows to print them or move them along. Nothing here changes an order — only what production owes.';
}
['ajState', 'ajFrom', 'ajTo'].forEach(id => $(id).addEventListener('change', renderAdj));
let AJ_FT = null;
$('ajFilter').addEventListener('input', () => { clearTimeout(AJ_FT); AJ_FT = setTimeout(renderAdj, 250); });

/** The ticked rows, as live records. */
function ajPicked() {
  return ajAll().filter(r => AJ_PICKED.has(r.orderId + '|' + r.sku));
}
async function ajApply(fn) {
  const picked = ajPicked();
  if (!picked.length) { $('ajMsg').textContent = 'Tick some rows first.'; $('ajMsg').className = 'err'; return false; }
  picked.forEach(r => fn(SHOP_META[r.orderId].lines[r.sku], r));
  try { await saveShopMeta(); renderAdj(); return true; }
  catch (e) { $('ajMsg').textContent = 'Could not save: ' + (e.message || e); $('ajMsg').className = 'err'; return false; }
}

$('ajSent').onclick = async () => {
  const stamp = soStamp();
  // Only forward. Marking a job "sent" that production has already accepted would quietly undo
  // their promised date, and that date is the only thing anybody downstream is planning against.
  const ok = await ajApply(ln => {
    if (ln.adjState === 'raised' || !ln.adjState) { ln.adjState = 'sent'; ln.adjSentAt = stamp; }
  });
  if (ok) $('ajMsg').textContent = 'Marked sent. Anything already accepted was left as it was.';
};

let AJW_MODE = null;
function ajOpenW(mode) {
  if (!ajPicked().length) { $('ajMsg').textContent = 'Tick some rows first.'; $('ajMsg').className = 'err'; return; }
  AJW_MODE = mode;
  const picked = ajPicked();
  const pcs = picked.reduce((s, r) => s + r.qty, 0);
  $('ajwTitle').textContent = mode === 'accept' ? 'Production accepts' : 'Received back from production';
  $('ajwSub').textContent = `${picked.length} job(s) · ${pcs} piece(s) · ${picked.map(r => r.id).slice(0, 3).join(', ')}${picked.length > 3 ? '…' : ''}`;
  $('ajwDateLbl').textContent = mode === 'accept' ? 'Will be ready by' : 'Received on';
  $('ajwDate').value = mode === 'accept' ? '' : sdToday();
  // On a single job the quantity is known, so it is filled in. On a batch it is left blank rather
  // than guessed — writing the same number against every job would be a fiction.
  $('ajwQtyWrap').style.display = mode === 'accept' ? 'none' : '';
  $('ajwQty').value = (mode === 'receive' && picked.length === 1) ? picked[0].qty : '';
  const who = [...new Set(ajAll().flatMap(r => [r.accBy, r.recBy]).filter(Boolean))].sort();
  $('ajwWhoList').innerHTML = who.map(w => `<option value="${String(w).replace(/"/g, '&quot;')}">`).join('');
  $('ajwWho').value = '';
  $('ajwNote').value = '';
  $('ajwErr').classList.add('hide');
  $('ajwModal').classList.remove('hide');
  $('ajwDate').focus();
}
$('ajAccept').onclick = () => ajOpenW('accept');
$('ajRecv').onclick = () => ajOpenW('receive');
$('ajwCancel').onclick = () => { $('ajwModal').classList.add('hide'); AJW_MODE = null; };

$('ajwSave').onclick = async () => {
  const date = $('ajwDate').value, who = $('ajwWho').value.trim(), note = $('ajwNote').value.trim();
  if (!date) {
    $('ajwErr').textContent = AJW_MODE === 'accept'
      ? 'A promised date is the whole point of accepting — without it nothing can be chased.'
      : 'When did it come back?';
    $('ajwErr').classList.remove('hide');
    return;
  }
  const stamp = soStamp();
  const qty = $('ajwQty').value === '' ? null : Math.max(0, Math.round(Number($('ajwQty').value)));
  const ok = await ajApply((ln, r) => {
    if (AJW_MODE === 'accept') {
      ln.adjState = 'accepted'; ln.adjDue = date; ln.adjAccBy = who; ln.adjAccAt = stamp;
      if (note) ln.adjAccNote = note;
    } else {
      ln.adjState = 'received'; ln.adjRecAt = date; ln.adjRecBy = who;
      ln.adjRecQty = qty == null ? r.qty : qty;
      if (note) ln.adjRecNote = note;
    }
  });
  if (ok) {
    $('ajwModal').classList.add('hide');
    AJW_MODE = null;
    AJ_PICKED.clear();
    renderAdj();
  }
};

$('ajExport').onclick = () => {
  const rows = ajRows();
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Adjustment ID', 'Raised', 'Shopify order', 'Order date', 'Customer', 'SKU', 'Product',
    'Sending', 'Make in', 'Qty', 'Reason', 'Bin', 'Ordered', 'At location', 'State',
    'Sent', 'Accepted by', 'Accepted', 'Promised', 'Received by', 'Received', 'Qty received', 'Note'];
  const lines = [head.map(cell).join(',')];
  rows.forEach(r => lines.push([r.id, r.at, r.order, r.orderDate, r.customer, r.sku, r.name,
    r.send, r.want, r.qty, r.reason, r.loc, r.ordered, r.staged, r.state,
    r.sentAt, r.accBy, r.accAt, r.due, r.recBy, r.recAt, r.recQty, r.note].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'adjustments-' + sdToday() + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

