/* CHANGING QUANTITIES A SHEET AT A TIME.
 *
 * "m bulk me (excel) se kese change kar sakta hu mera current order" — one SKU at a time is right for
 * one change and useless for fifty. The same shape the recipe sheet already has, because it is the
 * shape Ravi already knows: download what is on the screen, fill a column, upload it, and see
 * exactly what it would do before it does it.
 *
 * IT DOES NOT REPEAT THE RULES. Every row goes through soQtyPlan — the same floor, the same "which
 * line does it land on", the same refusals — so the sheet cannot do anything the button cannot, and
 * the two can never drift apart. What is added here is only: reading a sheet, showing the plan, and
 * writing the whole lot in batches.
 *
 * A REFUSED ROW STOPS ITSELF, NOT THE FILE. Fifty rows where three are below what has been made is a
 * sheet with three mistakes in it, not a sheet to throw away — the forty-seven are written and the
 * three are listed with the reason, by row number.
 *
 * THE SAME (order, SKU) TWICE IS REFUSED rather than resolved. Two rows saying 80 and 120 is somebody
 * asking two different things, and picking the later one silently is how the wrong number gets
 * written.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the sheet ---- */
one(`$('sxExport').onclick = () => {`,
`/* ================= A SHEET OF QUANTITY CHANGES =================
 *
 * The columns, in the order they are written. Everything before "New qty" is there to decide with
 * and is read back for nothing: the order and the SKU are the key, the rest is context.
 */
const SO_QTY_COLS = ['Order', 'SKU', 'Article', 'Size', 'On the order', 'Cut', 'Received', 'Pressed',
  'Cannot go below', 'New qty', 'Why'];

/** What is on the screen right now, ready to be edited — approved orders only. */
function soQtyTemplate() {
  const rows = (SOX.shown || []).filter(x => x && soStatus(x.o) === 'approved');
  if (!rows.length) {
    $('sxMsg').className = 'err';
    $('sxMsg').textContent = 'Nothing approved is on the screen to change. Clear the filters, or pick the orders you mean first.';
    return;
  }
  const w = soWork();
  const lines = [SO_QTY_COLS.map(csvCell).join(',')];
  let n = 0;
  rows.forEach(({ o }) => soSkus(o, w).forEach(g => {
    const d = soDoneOn(o._id, g.sku);
    n++;
    lines.push([o._id, g.sku, g.article || '', g.size || '', g.qty, d.cut, d.made, d.pressed, d.floor, '', '']
      .map(csvCell).join(','));
  }));
  ptDownload('order-quantities', lines);
  $('sxMsg').className = 'muted';
  $('sxMsg').textContent = \`\${nf(n)} line(s) written. Fill in "New qty" and "Why" on the ones you want to change and \`
    + 'leave the rest empty — an empty New qty means "leave this one alone".';
}

/** Read a filled sheet back, by column name. */
function soQtySheetRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const iO = colIdx(head, ['order', 'order no', 'order number']);
  const iS = colIdx(head, ['sku']);
  const iQ = colIdx(head, ['new qty', 'new quantity', 'qty', 'quantity']);
  const iW = colIdx(head, ['why', 'reason', 'remark', 'remarks']);
  if (iO < 0 || iS < 0 || iQ < 0)
    return { err: 'The file needs Order, SKU and "New qty" columns. Download the template to see them.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const order = cellAt(rows[i], iO), sku = cellAt(rows[i], iS), qty = cellAt(rows[i], iQ);
    if (!order && !sku) continue;
    /* AN EMPTY New qty MEANS "LEAVE THIS ONE ALONE". Most of a 2,800-row sheet comes back untouched,
     * and reading an empty box as zero would close every order somebody did not mean to touch. */
    if (qty === '') continue;
    out.push({ row: i + 1, order, sku, qty, why: iW >= 0 ? cellAt(rows[i], iW) : '' });
  }
  return { entries: out };
}

/** What the sheet would do, row by row, before anything is written. */
function soQtyBulkPlan(entries) {
  const ok = [], skip = [];
  const seen = new Map();
  (entries || []).forEach(e => {
    const key = obUC(e.order) + '|' + obUC(e.sku);
    /* THE SAME LINE TWICE IS TWO DIFFERENT ANSWERS, not a later one. */
    if (seen.has(key)) {
      skip.push({ row: e.row, key, why: 'the same order and SKU is on row ' + seen.get(key) + ' as well.' });
      return;
    }
    seen.set(key, e.row);
    const o = (SOX.rows || []).find(x => obUC(x._id) === obUC(e.order));
    if (!o) { skip.push({ row: e.row, key, why: 'there is no order called ' + (e.order || '(blank)') + '.' }); return; }
    if (!String(e.why || '').trim()) {
      skip.push({ row: e.row, key, why: 'say why it is changing — the Why column is empty.' });
      return;
    }
    const plan = soQtyPlan(o, e.sku, e.qty);
    if (plan.err) { skip.push({ row: e.row, key, why: plan.err }); return; }
    ok.push({ row: e.row, key, o, sku: plan.sku, from: plan.from, to: plan.to, delta: plan.delta,
      moves: plan.moves, book: plan.book, why: String(e.why).trim() });
  });
  return { ok, skip };
}

/**
 * Write what the plan showed, and nothing else.
 *
 * Built from the plan rather than worked out again, so what lands is what was agreed to. In batches,
 * because one sheet can carry hundreds of rows and a row-at-a-time write took minutes on the
 * approvals screen for the same reason.
 */
async function soQtyBulkRun(plan) {
  if (!soCanApprove()) return { err: SO_NO_APPROVE };
  const rows = (plan && plan.ok) || [];
  if (!rows.length) return { err: 'There is nothing to write.' };
  const now = new Date().toISOString();
  const all = [];
  rows.forEach(r => {
    const base = 'pt_salesOrders/' + r.o._id + '/';
    const patch = {};
    r.moves.forEach(m => {
      patch[base + 'lines/' + m.i + '/qty'] = m.to;
      patch[base + 'lines/' + m.i + '/previousQty'] = m.from;
    });
    const logId = 'adj_' + Date.now() + '_' + String(all.length).padStart(4, '0') + '_' + Math.random().toString(36).slice(2, 6);
    patch[base + 'qtyAdjustments/' + logId] = { id: logId, sku: r.sku, from: r.from, to: r.to,
      why: r.why, by: ME.email, at: now, via: 'sheet' };
    patch[base + 'updatedAt'] = now;
    if (r.book != null) patch['pt_orderBook/' + soBookId(r.o._id, r.sku) + '/qty'] = r.to;
    all.push({ r, patch });
  });
  let done = 0, stopped = null;
  for (let i = 0; i < all.length; i += 100) {
    const batch = all.slice(i, i + 100);
    const patch = {};
    batch.forEach(x => Object.assign(patch, x.patch));
    try { await ptPatch(patch); }
    catch (e) { stopped = e; break; }
    /* THE SCREEN FROM WHAT WAS WRITTEN, one order at a time — the same rule as the single change. */
    batch.forEach(x => {
      const base = 'pt_salesOrders/' + x.r.o._id + '/';
      const o = (SOX.rows || []).find(y => y._id === x.r.o._id) || x.r.o;
      const lines = soLines(o).map((l, j) => (x.patch[base + 'lines/' + j + '/qty'] === undefined ? l
        : Object.assign({}, l, { qty: x.patch[base + 'lines/' + j + '/qty'],
          previousQty: x.patch[base + 'lines/' + j + '/previousQty'] })));
      const adj = Object.assign({}, o.qtyAdjustments || {});
      Object.keys(x.patch).forEach(k => {
        if (k.indexOf(base + 'qtyAdjustments/') === 0) adj[k.slice((base + 'qtyAdjustments/').length)] = x.patch[k];
      });
      const next = Object.assign({}, o, { lines, qtyAdjustments: adj, updatedAt: now });
      SOX.rows = (SOX.rows || []).map(y => (y._id === o._id ? next : y));
      const bp = 'pt_orderBook/' + soBookId(x.r.o._id, x.r.sku) + '/qty';
      if (x.patch[bp] !== undefined) PTG.ob = (PTG.ob || []).map(rr =>
        (rr && rr.id === soBookId(x.r.o._id, x.r.sku) ? Object.assign({}, rr, { qty: x.patch[bp] }) : rr));
      done++;
    });
    ptDlgMsg(\`Writing… \${nf(done)} of \${nf(all.length)} line(s).\`);
  }
  return { err: stopped ? 'Stopped after ' + nf(done) + ' of ' + nf(all.length) + ' line(s): '
    + (stopped.message || stopped) + ' The ones already written are done; upload the rest again.' : '', done };
}

$('sxExport').onclick = () => {`, 'the sheet, the plan and the write');

/* ---- 2. the buttons ---- */
one(`          <button id="sxExport" class="ghost">Export</button>
          <button id="sxGo">Refresh</button>`,
`          <button id="sxExport" class="ghost">Export</button>
          <button id="sxQtyTpl" class="ghost hide" title="Every approved line on the screen, with what has been made against it, ready to edit.">Qty sheet</button>
          <button id="sxQtyImp" class="ghost hide" title="Read a filled quantity sheet back. You are shown what it would do before anything is written.">Qty import</button>
          <input id="sxQtyFile" type="file" accept=".xlsx,.csv,text/csv" style="display:none">
          <button id="sxGo">Refresh</button>`, 'the buttons');

one(`$('sxDelReqs').onclick = async () => { await odrLoad(true); if (!PTG.ob) await ptLoadGates(); odrListOpen(); };`,
`$('sxDelReqs').onclick = async () => { await odrLoad(true); if (!PTG.ob) await ptLoadGates(); odrListOpen(); };

$('sxQtyTpl').onclick = soQtyTemplate;
$('sxQtyImp').onclick = () => $('sxQtyFile').click();
$('sxQtyFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = soQtySheetRead(rows);
    if (read.err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = read.err; return; }
    const plan = soQtyBulkPlan(read.entries);
    if (!plan.ok.length) {
      $('sxMsg').className = plan.skip.length ? 'err' : 'muted';
      $('sxMsg').textContent = plan.skip.length
        ? \`Nothing to write. \${nf(plan.skip.length)} row(s) refused: \`
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? \` and \${nf(plan.skip.length - 3)} more.\` : '')
        : 'Every row in that file already says what the order says.';
      return;
    }
    const up = plan.ok.filter(x => x.delta > 0), down = plan.ok.filter(x => x.delta < 0);
    const show = list => list.slice(0, 12).map(x => esc(x.o._id) + ' · ' + esc(x.sku) + ': '
      + nf(x.from) + ' → <b>' + nf(x.to) + '</b>' + (x.book == null ? ' <i>(not in the order book)</i>' : '')).join('<br>');
    ptOpenDialog({
      title: 'Change these quantities?',
      subtitle: \`\${nf(plan.ok.length)} line(s) · \${nf(up.length)} up · \${nf(down.length)} down\`,
      /* THE ORDER BOOK MOVES WITH THEM — said here, because that is the part that reaches the floor. */
      note: 'The order book moves with the sales order, in the same write. A line the order book never '
        + 'got changes on the order only. Nothing goes below what has already been cut, received or pressed.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (up.length ? \`<b style="color:#166534">Going up</b><br>\${show(up)}\`
          + (up.length > 12 ? \`<br>…and \${nf(up.length - 12)} more.\` : '') + '<br><br>' : '')
        + (down.length ? \`<b style="color:var(--bad)">Coming down</b><br>\${show(down)}\`
          + (down.length > 12 ? \`<br>…and \${nf(down.length - 12)} more.\` : '') + '<br><br>' : '')
        + (plan.skip.length ? \`<b style="color:var(--bad)">\${nf(plan.skip.length)} row(s) refused, and not written</b><br>\`
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 10 ? \`<br>…and \${nf(plan.skip.length - 10)} more.\` : '') : '')
        + '</div>',
      saveLabel: \`Change \${nf(plan.ok.length)} line(s)\`,
      onSave: async () => {
        const out = await soQtyBulkRun(plan);
        renderSox();
        if (out.err) return out.err;
        $('sxMsg').className = 'muted';
        $('sxMsg').textContent = \`\${nf(out.done)} quantit\${out.done > 1 ? 'ies' : 'y'} changed, and the order book says the same.\`
          + (plan.skip.length ? \` \${nf(plan.skip.length)} row(s) were refused and left alone.\` : '');
        return '';
      },
    });
  } catch (err) { $('sxMsg').className = 'err'; $('sxMsg').textContent = 'Could not read it: ' + (err.message || err); }
};`, 'wired');

/* ---- 3. only for somebody who may approve an order ---- */
one(`  const b = $('sxDelReqs');`,
`  /* The quantity sheet writes quantities, so it is the approvers' button, like the single change. */
  ['sxQtyTpl', 'sxQtyImp'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !soCanApprove()); });
  const b = $('sxDelReqs');`, 'and only for an approver');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
