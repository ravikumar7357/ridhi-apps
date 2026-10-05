/* ================= SHOPIFY BULK ENTRY =================
 *
 * Ravi: "jab me single single entry kar raha hu to bahut jyada time lag rha h. Aisa set up krna
 * padega jisase bulk wale me hi mera banda entry kare, jab wo auto particular order wise entry ho jay,
 * or upload se bhi kar sake, but dropdown me sara data hona chahiye."
 *
 * One figure per SKU — cut, issued to a karigar, received back from a karigar, pressed — and the app
 * shares it across that SKU's open Shopify orders, OLDEST ORDER FIRST, as far as each order has room.
 * Every piece still goes through the same single-entry functions and the same caps, so a bulk entry
 * can record nothing a single entry would have refused. Quilts are left out: they are counted, not
 * registered, and have their own entry.
 */
let SP_QUIET = false;                     // true while a bulk entry runs: one redraw at the end, not one per piece
let SP_BULK_VALS = {};                    // what has been typed into the grid, by "SKU|field"

/** The lines a bulk entry for one SKU is shared across: open Shopify lines, not quilts, oldest first. */
function spBulkLines(sku) {
  return (shppLines() || []).filter(l => obUC(l.sku) === obUC(sku) && l.open && !spIsQuilt(l))
    .sort((a, b) => String(a.orderDate || '').localeCompare(String(b.orderDate || '')) || a.orderNo.localeCompare(b.orderNo));
}

/** What each of those lines has room for right now, from the same figures the caps use. */
function spBulkState(sku) {
  const s = obUC(sku);
  const m = cutSkuOf(s);
  const cutReq = !m || m.cuttingRequired !== false;
  const lines = spBulkLines(s).map(l => {
    const open = spBaseRows(l.orderNo, s).filter(r => !r.frozen && ptNum(r.pendingPieces) > 0);
    const holders = {};
    open.forEach(r => { const k = String(r.empName || '').trim(); if (k) holders[k] = (holders[k] || 0) + ptNum(r.pendingPieces); });
    return { l, orderNo: l.orderNo, shop: l.shopOrderNo || l.orderNo, date: l.orderDate,
      ordered: obOrderedQty(l.orderNo, s), cut: obCutQty(l.orderNo, s), used: obIssueUsed(l.orderNo, s),
      pressed: obPressQty(l.orderNo, s), received: ptNum(l.received), holders };
  });
  const room = {
    cut: x => x.ordered - x.cut,
    issue: x => Math.min(x.ordered - x.used, cutReq ? Math.max(x.cut, x.pressed) - x.used : Infinity),
    press: x => Math.min(x.ordered - x.pressed, x.received - x.pressed),
  };
  const sum = f => lines.reduce((a, x) => a + Math.max(0, f(x)), 0);
  const holders = {};
  lines.forEach(x => Object.entries(x.holders).forEach(([k, v]) => { holders[k] = (holders[k] || 0) + v; }));
  return { sku: s, cutReq, lines, room, holders,
    toCut: sum(room.cut), toIssue: sum(room.issue), toPress: sum(room.press),
    /* Still to make on THESE orders — the by-SKU total also counts orders already handed over. */
    toMake: sum(x => x.ordered - x.received),
    /* Every Shopify line of this SKU, handed over or not — so 22 against the table's 30 explains itself. */
    allLines: (shppLines() || []).filter(l => obUC(l.sku) === s).length,
    allPcs: (shppLines() || []).filter(l => obUC(l.sku) === s).reduce((a, l) => a + ptNum(l.qty), 0),
    out: Object.values(holders).reduce((a, v) => a + v, 0) };
}

/** Everybody a piece can be issued to, as "Name · Type" — the text the dropdowns offer. */
function spBulkPeople() {
  return (PTE.emp || []).filter(e => e && e[1]).map(e => ({ type: String(e[0] || '').trim(), name: String(e[1]).trim() }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
const spBulkWhoText = p => p.name + ' · ' + p.type;
/** Why somebody makes more than the order: the usual answers, and anything else can be typed. */
const SP_EXTRA_REASONS = ['Wastage / rejection cover', 'Fabric left on the roll', 'Stock for coming orders', 'Minimum lot size', 'Sample / photo shoot', 'Replacement for a damaged piece'];
/** "Name · Type", or a name alone when only one person has it, to the employee it means. */
function spBulkWho(text) {
  const t = String(text || '').trim();
  if (!t) return { err: 'no karigar' };
  const [n, ty] = t.split(' · ').map(x => String(x || '').trim());
  const hits = spBulkPeople().filter(p => p.name.toLowerCase() === n.toLowerCase() && (!ty || p.type.toLowerCase() === ty.toLowerCase()));
  if (hits.length === 1) return hits[0];
  if (!hits.length) return { err: `"${t}" is not on the employee list` };
  return { err: `"${n}" is on the list more than once — pick the one with the type` };
}

/** A typed count: '' is nothing, a whole number is itself, anything else is a mistake worth naming. */
const spBulkNum = v => { const s = String(v == null ? '' : v).trim(); return !s ? 0 : /^\d+$/.test(s) ? parseInt(s, 10) : NaN; };
/** A date as typed, pasted or read from Excel, to YYYY-MM-DD. */
function spBulkDate(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {                  // an Excel date serial
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  return '';
}

/**
 * Turn entries — one per SKU — into the single entries they stand for. Nothing is written.
 *
 * entry: { sku, cut, fabric, issue, karigar, recv, from, press, date, remarks }
 * Within one SKU the four happen in order — cut, then issue, then receive, then press — so pieces cut
 * in the same entry can be issued in it. Whatever no order has room for is reported, never forced.
 */
function spBulkPlan(entries, defaultDate) {
  const ops = [], problems = [];
  let skus = 0;
  const fabrics = cutFabrics();
  (entries || []).forEach(en => {
    const sku = obUC(en && en.sku);
    if (!sku) return;
    const n = { cut: spBulkNum(en.cut), issue: spBulkNum(en.issue), recv: spBulkNum(en.recv), press: spBulkNum(en.press) };
    const label = { cut: 'cut', issue: 'issue', recv: 'receive', press: 'press' };
    const bad = Object.keys(n).filter(k => Number.isNaN(n[k]));
    if (bad.length) { problems.push(`${sku}: "${en[bad[0]]}" is not a whole number of pieces to ${label[bad[0]]}.`); return; }
    if (!n.cut && !n.issue && !n.recv && !n.press) return;
    const date = spBulkDate(en.date, defaultDate || dToday());
    if (!date) { problems.push(`${sku}: "${en.date}" is not a date.`); return; }
    const st = spBulkState(sku);
    if (!st.lines.length) {
      const any = (shppLines() || []).some(l => obUC(l.sku) === sku);
      problems.push(`${sku}: ${any ? 'no open Shopify order is waiting for it (a quilt, or every order is done)' : 'no Shopify order carries this SKU'}.`);
      return;
    }
    skus++;
    const remarks = String(en.remarks || '').trim();
    const share = (kind, total, roomOf, extra, after) => {
      let left = total;
      st.lines.forEach(x => {
        if (left <= 0) return;
        const take = Math.min(Math.max(0, roomOf(x)), left);
        if (take <= 0) return;
        ops.push(Object.assign({ kind, orderNo: x.orderNo, shop: x.shop, sku, pcs: take, date, remarks }, extra));
        left -= take;
        after(x, take);
      });
      return left;
    };
    const unplaced = (what, total, left, why) => {
      if (left > 0) problems.push(`${sku}: ${nf(left)} of the ${nf(total)} to ${what} could not be placed — ${why}.`);
    };
    /* MORE THAN THE ORDERS ASK FOR goes on only with a reason, and is marked extra on every row. */
    const reason = String(en.reason || '').trim();
    const newest = [st.lines[st.lines.length - 1]];
    const extraOn = (kind, left, lines, roomOf, extra, after) => {
      let l = left;
      lines.forEach(x => {
        if (l <= 0) return;
        const take = Math.min(Math.max(0, roomOf(x)), l);
        if (take <= 0) return;
        ops.push(Object.assign({ kind, orderNo: x.orderNo, shop: x.shop, sku, pcs: take, date, remarks, extraReason: reason }, extra));
        l -= take; after(x, take);
      });
      return l;
    };
    const needReason = (what, left) => problems.push(`${sku}: ${nf(left)} more than the open orders need to ${what} — pick a reason in "Extra reason" to make extra.`);

    if (n.cut) {
      const fabric = String(en.fabric || '').trim();
      if (fabric && fabrics.indexOf(fabric) < 0) problems.push(`${sku}: fabric "${fabric}" is not in the Fabric Type master — cutting not saved.`);
      else if (cutMonthFrozen(date)) problems.push(`${sku}: ${ptMonthKey(date)} is frozen — cutting not saved.`);
      else {
        const left = share('cut', n.cut, st.room.cut, { fabric }, (x, t) => { x.cut += t; });
        if (left > 0 && !reason) needReason('cut', left);
        else if (left > 0) extraOn('cut', left, newest, () => Infinity, { fabric }, (x, t) => { x.cut += t; });
      }
    }
    if (n.issue) {
      const who = spBulkWho(en.karigar);
      if (who.err) problems.push(`${sku}: ${who.err === 'no karigar' ? 'which karigar are the ' + nf(n.issue) + ' going to?' : who.err} — issue not saved.`);
      else {
        const extraRoom = x => (st.cutReq ? Math.max(x.cut, x.pressed) - x.used : Infinity);
        let left = share('issue', n.issue, st.room.issue, { empType: who.type, empName: who.name }, (x, t) => { x.used += t; });
        /* Beyond the orders: only cut pieces nobody has, oldest order first. */
        const free = st.lines.reduce((a, x) => a + Math.max(0, Math.min(1e9, extraRoom(x))), 0);
        if (left > 0 && free > 0 && !reason) { needReason('issue', Math.min(left, free)); left -= Math.min(left, free); }
        else if (left > 0 && reason) left = extraOn('issue', left, st.cutReq ? st.lines : newest, extraRoom, { empType: who.type, empName: who.name }, (x, t) => { x.used += t; });
        unplaced('issue', n.issue, left, st.cutReq ? 'not enough cut pieces — cut them first' : 'the open orders are fully issued');
      }
    }
    if (n.recv) {
      let from = String(en.from || '').trim().split(' · ')[0].trim();
      const names = Object.keys(st.holders);
      if (!from && names.length === 1) from = names[0];
      if (!from) problems.push(`${sku}: which karigar returned the ${nf(n.recv)}? ${names.length ? 'Held by ' + names.join(', ') : 'Nobody has any out'} — receipt not saved.`);
      else {
        const key = names.find(k => k.toLowerCase() === from.toLowerCase());
        if (!key) problems.push(`${sku}: ${from} has none of it out — receipt not saved.`);
        else unplaced('receive', n.recv,
          share('recv', n.recv, x => x.holders[key] || 0, { empName: key }, (x, t) => { x.holders[key] -= t; x.received += t; x.used -= t; }),
          `${key} has only ${nf(st.holders[key])} out`);
      }
    }
    if (n.press) {
      let left = share('press', n.press, st.room.press, {}, (x, t) => { x.pressed += t; x.used += t; });
      const back = x => x.received - x.pressed;
      const free = st.lines.reduce((a, x) => a + Math.max(0, back(x)), 0);
      if (left > 0 && free > 0 && !reason) { needReason('press', Math.min(left, free)); left -= Math.min(left, free); }
      else if (left > 0 && reason) left = extraOn('press', left, st.lines, back, {}, (x, t) => { x.pressed += t; x.used += t; });
      unplaced('press', n.press, left, 'no more has come back from the karigars on the open orders');
    }
  });
  const pieces = k => ops.filter(o => o.kind === k).reduce((a, o) => a + o.pcs, 0);
  return { ops, problems, skus, orders: new Set(ops.map(o => o.orderNo)).size,
    totals: { cut: pieces('cut'), issue: pieces('issue'), recv: pieces('recv'), press: pieces('press') },
    extra: ops.filter(o => o.extraReason).reduce((a, o) => a + o.pcs, 0) };
}

/** Write a plan, one single entry at a time, through the functions a single entry uses. */
async function spBulkApply(plan, onProgress) {
  if (!ptCanEdit()) return { done: 0, failed: [PT_NO_EDIT] };
  const failed = [];
  let done = 0;
  const word = { cut: 'cut', issue: 'issue', recv: 'receive', press: 'press' };
  SP_QUIET = true;
  try {
    for (let i = 0; i < plan.ops.length; i++) {
      const op = plan.ops[i];
      let err = '';
      try {
        if (op.kind === 'cut') err = await spCutReal(op.orderNo, op.sku, op.pcs, op.date, op.fabric, op.remarks, op.extraReason);
        else if (op.kind === 'issue') err = await spIssueReal(op.orderNo, op.sku, op.empType, op.empName, op.pcs, op.date, op.remarks, op.extraReason);
        else if (op.kind === 'recv') err = await spReceiveReal(op.orderNo, op.sku, op.pcs, op.date, op.empName);
        else if (op.kind === 'press') err = await spPressReal(op.orderNo, op.sku, op.pcs, op.date, op.remarks, op.extraReason);
      } catch (e) { err = e.message || String(e); }
      if (err) failed.push(`${op.sku} · ${op.shop} · ${word[op.kind]} ${nf(op.pcs)}: ${err}`); else done++;
      if (onProgress) onProgress(i + 1, plan.ops.length);
    }
  } finally {
    SP_QUIET = false;
    ORD_IX = {};
    renderOrd();
    renderPbase();
  }
  return { done, failed };
}

/** The SKUs the grid and the sheet offer: the ones shown, that still have work on an open order. */
function spBulkSkus() {
  return (ORD.rows || []).filter(r => r && r.sku && (r.orders || []).some(o => o.open))
    .map(r => ({ r, st: spBulkState(r.sku) }))
    .filter(x => x.st.lines.length);
}

function spBulkRender() {
  const box = $('spBulkBox'); if (!box) return;
  if (box.classList.contains('hide')) return;
  const list = spBulkSkus().slice(0, 300);
  const people = spBulkPeople();
  $('spBulkWhoList').innerHTML = people.map(p => `<option value="${esc(spBulkWhoText(p))}">`).join('');
  if ($('spBulkReasonList')) $('spBulkReasonList').innerHTML = SP_EXTRA_REASONS.map(t => `<option value="${esc(t)}">`).join('');
  const fabrics = cutFabrics();
  const v = (sku, f) => esc(SP_BULK_VALS[sku + '|' + f] || '');
  /* Never disabled: a figure beyond the room is extra, and takes a reason. The grey number is the room. */
  const num = (sku, f, max) => `<input class="spb-in" type="number" min="0" step="1" data-spb="${esc(sku)}|${f}" value="${v(sku, f)}" placeholder="${nf(max || 0)}" title="Room on the open orders: ${nf(max || 0)}. More than that needs an Extra reason.">`;
  const sel = (sku, f, opts, blank) => `<select class="spb-sel" data-spb="${esc(sku)}|${f}"><option value="">${blank}</option>`
    + opts.map(o => `<option value="${esc(o[0])}"${(SP_BULK_VALS[sku + '|' + f] || '') === o[0] ? ' selected' : ''}>${esc(o[1])}</option>`).join('') + '</select>';
  const date = SP_BULK_VALS.__date || dToday();
  box.innerHTML = `<div class="card" style="padding:12px 14px">
    <div class="toolbar">
      <b style="flex:0 0 auto">Bulk entry</b>
      <span class="muted" style="font-size:12.5px;flex:1 1 300px">One figure per SKU. It is shared across that SKU's open Shopify orders, oldest order first, and every piece passes the same checks as a single entry. The grey number is what the open orders have room for.</span>
      <label class="muted" style="font-size:12.5px;flex:0 0 auto">Date <input id="spBulkDate" type="date" value="${esc(date)}" style="width:auto"></label>
      <button id="spBulkSave" style="flex:0 0 auto">Save all</button>
      <button id="spBulkClear" class="ghost" style="flex:0 0 auto">Clear typed</button>
      <button id="spBulkClose" class="ghost" style="flex:0 0 auto">Close</button>
    </div>
    <div id="spBulkMsg" class="muted" style="margin-top:6px;font-size:12.5px"></div>
    <div class="xlwrap" style="margin-top:8px;max-height:65vh"><table class="xl spb">
      <thead><tr><th class="frz" style="text-align:left">SKU</th><th class="num">Orders</th><th class="num">Still to make</th>
        <th class="num spb-g1">Cut</th><th class="spb-g1">Fabric</th>
        <th class="num spb-g2">Issue</th><th class="spb-g2">To karigar</th>
        <th class="num spb-g3">Receive</th><th class="spb-g3">From karigar</th>
        <th class="num spb-g4">Press</th><th title="Only needed when a figure is more than the open orders need">Extra reason</th></tr></thead>
      <tbody>${list.map(({ r, st }) => {
        const holders = Object.entries(st.holders).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        return `<tr><td class="frz" style="text-align:left"><span style="font-family:ui-monospace,monospace">${esc(r.sku)}</span>
            <div class="muted" style="font-size:11px">${esc([r.articleSubtype, r.color, r.size].filter(Boolean).join(' · '))}</div></td>
          <td class="num">${nf(st.lines.length)}${st.allLines > st.lines.length ? `<div class="muted" style="font-size:10.5px" title="The other orders are handed over or done">of ${nf(st.allLines)}</div>` : ''}</td>
          <td class="num">${nf(st.toMake)}${st.allPcs > st.toMake ? `<div class="muted" style="font-size:10.5px" title="${nf(st.allPcs)} pieces on all ${nf(st.allLines)} orders; the rest are handed over or already made">of ${nf(st.allPcs)} ordered</div>` : ''}</td>
          <td class="num spb-g1">${st.cutReq ? num(r.sku, 'cut', st.toCut) : '<span class="muted" title="No cutting needed for this SKU">—</span>'}</td>
          <td class="spb-g1">${st.cutReq ? sel(r.sku, 'fabric', fabrics.map(f => [f, f]), 'Fabric…') : ''}</td>
          <td class="num spb-g2">${num(r.sku, 'issue', st.toIssue)}</td>
          <td class="spb-g2"><input class="spb-who" list="spBulkWhoList" data-spb="${esc(r.sku)}|karigar" value="${v(r.sku, 'karigar')}" placeholder="Karigar…"></td>
          <td class="num spb-g3">${num(r.sku, 'recv', st.out)}</td>
          <td class="spb-g3">${holders.length ? sel(r.sku, 'from', holders.map(([k, n]) => [k, `${k} (${nf(n)})`]), holders.length === 1 ? holders[0][0] + ' (only one)' : 'From…') : '<span class="muted">nobody has any</span>'}</td>
          <td class="num spb-g4">${num(r.sku, 'press', st.toPress)}</td>
          <td><input class="spb-who" list="spBulkReasonList" data-spb="${esc(r.sku)}|reason" value="${v(r.sku, 'reason')}" placeholder="Only for extra…"></td></tr>`;
      }).join('') || '<tr><td colspan="11" class="muted" style="padding:14px">Nothing shown has work left on an open order. Widen the filters above.</td></tr>'}</tbody>
    </table></div></div>`;
}

/** The typed grid, as entries. */
function spBulkEntries() {
  const by = {};
  Object.entries(SP_BULK_VALS).forEach(([k, val]) => {
    const i = k.lastIndexOf('|'); if (i < 0) return;
    const sku = k.slice(0, i), f = k.slice(i + 1);
    (by[sku] = by[sku] || { sku })[f] = val;
  });
  return Object.values(by);
}

/** Say what a plan will do, ask, and do it. */
async function spBulkRun(plan, source) {
  const msg = t => { const el = $('spBulkMsg') || $('odMsg'); if (el) { el.className = 'muted'; el.textContent = t; } };
  if (!plan.ops.length) {
    const el = $('spBulkMsg') || $('odMsg');
    if (el) { el.className = plan.problems.length ? 'err' : 'muted'; el.textContent = plan.problems.length ? plan.problems.slice(0, 6).join('  ·  ') : 'Nothing typed to save.'; }
    return false;
  }
  const t = plan.totals;
  const lines = [t.cut && `${nf(t.cut)} cut`, t.issue && `${nf(t.issue)} issued`, t.recv && `${nf(t.recv)} received`, t.press && `${nf(t.press)} pressed`].filter(Boolean).join(', ');
  if (!confirm(`Save ${source}?\n\n${lines} — ${nf(plan.skus)} SKU(s) across ${nf(plan.orders)} order(s), ${nf(plan.ops.length)} entr${plan.ops.length === 1 ? 'y' : 'ies'}.`
    + (plan.extra ? `\n\n${nf(plan.extra)} of those pieces are EXTRA — more than the orders asked for — and carry their reason.` : '')
    + (plan.problems.length ? `\n\nNot saved (${plan.problems.length}):\n` + plan.problems.slice(0, 10).join('\n') + (plan.problems.length > 10 ? `\n…and ${plan.problems.length - 10} more` : '') : ''))) return false;
  const res = await spBulkApply(plan, (i, of) => msg(`Saving ${i} of ${of}…`));
  const el = $('spBulkMsg') || $('odMsg');
  const bad = res.failed.concat(plan.problems);
  if (el) {
    el.className = bad.length ? 'err' : 'muted';
    el.textContent = `Saved ${nf(res.done)} of ${nf(plan.ops.length)} entr${plan.ops.length === 1 ? 'y' : 'ies'} (${lines}).`
      + (bad.length ? ` Not saved: ${bad.slice(0, 5).join('  ·  ')}${bad.length > 5 ? ` …and ${bad.length - 5} more` : ''}` : '');
  }
  return true;
}

/* ---------- the sheet ---------- */
const SP_BULK_COLS = [
  { k: 'sku', t: 'SKU' }, { k: 'item', t: 'Item' }, { k: 'orders', t: 'Open orders' }, { k: 'make', t: 'Still to make' },
  { k: 'toCut', t: 'Room to cut' }, { k: 'cut', t: 'Cut pcs' }, { k: 'fabric', t: 'Fabric' },
  { k: 'toIssue', t: 'Room to issue' }, { k: 'issue', t: 'Issue pcs' }, { k: 'karigar', t: 'To karigar' },
  { k: 'out', t: 'With karigars' }, { k: 'recv', t: 'Receive pcs' }, { k: 'from', t: 'From karigar' },
  { k: 'toPress', t: 'Room to press' }, { k: 'press', t: 'Press pcs' }, { k: 'reason', t: 'Extra reason' }, { k: 'date', t: 'Date' }, { k: 'remarks', t: 'Remarks' },
];
function spBulkSheetRows() {
  const rows = [SP_BULK_COLS.map(c => c.t)];
  spBulkSkus().forEach(({ r, st }) => {
    const holders = Object.entries(st.holders).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
    rows.push([r.sku, [r.articleSubtype, r.color, r.size].filter(Boolean).join(' · '), st.lines.length, st.toMake,
      st.cutReq ? st.toCut : 'no cutting', '', '', st.toIssue, '', '', holders || 0, '', '', st.toPress, '', '', '', '']);
  });
  return rows;
}
/** Read a filled sheet back into entries, by column name. */
function spBulkSheetEntries(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const at = {};
  SP_BULK_COLS.forEach(c => { const i = head.indexOf(c.t.toLowerCase()); if (i >= 0) at[c.k] = i; });
  if (at.sku == null) return { err: 'The file has no SKU column. Download the entry sheet to see the columns it reads.' };
  if (['cut', 'issue', 'recv', 'press'].every(k => at[k] == null)) return { err: 'The file has no Cut pcs, Issue pcs, Receive pcs or Press pcs column.' };
  const cell = (row, k) => (at[k] == null ? '' : String(row[at[k]] == null ? '' : row[at[k]]).trim());
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const e = {};
    ['sku', 'cut', 'fabric', 'issue', 'karigar', 'recv', 'from', 'press', 'reason', 'date', 'remarks'].forEach(k => { e[k] = cell(rows[i], k); });
    if (e.sku) entries.push(e);
  }
  return { entries };
}
/** The entry sheet as .xlsx, with Fabric, To karigar and From karigar as dropdowns. */
function spBulkXlsx(rows) {
  const fabrics = cutFabrics(), people = spBulkPeople().map(spBulkWhoText);
  const names = [...new Set(spBulkPeople().map(p => p.name))].sort();
  const col = t => soColName(rows[0].indexOf(t));
  const last = Math.max(rows.length, 2) + 500;
  const cellX = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    const s = String(v == null ? '' : v); if (s === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(s)}</t></is></c>`;
  };
  const dv = (c, name) => `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${c}2:${c}${last}"><formula1>${name}</formula1></dataValidation>`;
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + rows[0].map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${[18, 30, 8, 9, 9, 9, 16, 9, 9, 26, 22, 9, 22, 9, 9, 26, 12, 20][i] || 12}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellX(v, soColName(j) + (i + 1), i === 0)).join('')}</row>`).join('') + '</sheetData>'
    + `<dataValidations count="4">${dv(col('Fabric'), 'Fabrics')}${dv(col('To karigar'), 'Karigars')}${dv(col('From karigar'), 'Names')}${dv(col('Extra reason'), 'Reasons')}</dataValidations></worksheet>`;
  const n = Math.max(fabrics.length, people.length, names.length, SP_EXTRA_REASONS.length, 1);
  let lr = '';
  for (let i = 0; i < n; i++) lr += `<row r="${i + 1}">${cellX(fabrics[i] || '', 'A' + (i + 1))}${cellX(people[i] || '', 'B' + (i + 1))}${cellX(names[i] || '', 'C' + (i + 1))}${cellX(SP_EXTRA_REASONS[i] || '', 'D' + (i + 1))}</row>`;
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + lr + '</sheetData></worksheet>';
  const rng = (c, len) => `Lists!$${c}$1:$${c}$${Math.max(len, 1)}`;
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Entry" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets>'
    + `<definedNames><definedName name="Fabrics">${rng('A', fabrics.length)}</definedName><definedName name="Karigars">${rng('B', people.length)}</definedName><definedName name="Names">${rng('C', names.length)}</definedName><definedName name="Reasons">${rng('D', SP_EXTRA_REASONS.length)}</definedName></definedNames></workbook>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2], ['xl/styles.xml', styles],
  ]);
}

/* ---------- the printer sheet ----------
 *
 * One row per SKU on screen, a Printer column with every printer in a dropdown, and nothing else to
 * fill in. Ticking a hundred SKUs by hand is what this replaces.
 */
const SP_PRN_COLS = ['SKU', 'What', 'Open lines', 'Now with', 'Printer'];

function spPrintSheetRows() {
  const rows = [SP_PRN_COLS.slice()];
  (ORD.rows || []).forEach(r => {
    const keys = spSkuKeys(r);
    if (!keys.length) return;                       // nothing open — nobody to give it to
    /* Who has it now. More than one printer across a SKU's orders is a real state and is said as
     * such rather than picking the first. */
    const now = [...new Set(keys.map(k => spPrinter(k.slice(0, k.indexOf('|')), r.sku)).filter(Boolean))]
      .map(c => voName(c)).join(', ');
    rows.push([r.sku, [r.articleSubtype, r.color, r.size].filter(Boolean).join(' · '),
      keys.length, now || '', '']);
  });
  return rows;
}

/** Read a filled sheet back: one SKU, one printer. */
function spPrintSheetEntries(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const iSku = head.indexOf('sku'), iPrn = head.indexOf('printer');
  if (iSku < 0) return { err: 'The file has no SKU column. Download the printer sheet to see the columns it reads.' };
  if (iPrn < 0) return { err: 'The file has no Printer column. Download the printer sheet to see the columns it reads.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const sku = String(rows[i][iSku] == null ? '' : rows[i][iSku]).trim();
    const prn = String(rows[i][iPrn] == null ? '' : rows[i][iPrn]).trim();
    /* A BLANK PRINTER IS NOT AN INSTRUCTION. Most rows of a sheet come back untouched, and reading
     * those as "take the printer off" would strip every line somebody did not mean to touch. */
    if (sku && prn) out.push({ sku, printer: prn, row: i + 1 });
  }
  return { entries: out };
}

/**
 * What the sheet would do, worked out before anything is written.
 *
 * Every refusal is kept with its row number, because a hundred-row sheet with three bad lines is
 * three lines to fix, and a bare count is a file to search by hand.
 */
function spPrintPlan(entries) {
  const assign = [], same = [], skip = [];
  const bySku = new Map();
  (ORD.rows || []).forEach(r => { if (r && r.sku) bySku.set(obUC(r.sku), r); });
  (entries || []).forEach(e => {
    const v = spPrinterByText(e.printer);
    if (!v) {
      /* Named a karigar? Say so in those words — the employee list is a different thing entirely and
       * "not in the vendor master" tells nobody why. */
      const isPerson = (PTE.emp || []).some(p => p && String(p[1] || '').trim().toLowerCase() === String(e.printer).trim().toLowerCase());
      skip.push({ row: e.row, sku: e.sku, why: isPerson
        ? `"${e.printer}" is a karigar, not a printer. Printing is given to a printer; a karigar is given work in the entry sheet.`
        : `"${e.printer}" is not a printer in the vendor master.` });
      return;
    }
    const r = bySku.get(obUC(e.sku));
    if (!r) { skip.push({ row: e.row, sku: e.sku, why: 'that SKU is not on screen — clear the filters, or take the row out.' }); return; }
    const keys = spSkuKeys(r);
    if (!keys.length) { skip.push({ row: e.row, sku: e.sku, why: 'every order for it is already finished.' }); return; }
    keys.forEach(k => {
      const no = k.slice(0, k.indexOf('|'));
      if (!spCanAssignOrder(no)) { skip.push({ row: e.row, sku: e.sku, why: spNoAssignFor(no) }); return; }
      if (spPrinter(no, e.sku) === v.code) { same.push({ no, sku: e.sku, code: v.code }); return; }
      assign.push({ no, sku: e.sku, code: v.code, row: e.row });
    });
  });
  return { assign, same, skip };
}

/**
 * Do it, one line at a time.
 *
 * Deliberately through spAssign rather than a single patch: each line has to be checked on its own
 * queue, and the printer's own copy of it has to be written into their branch or the work never
 * appears on their portal. That is a read and a write per line, so a big sheet takes a while — and
 * saying so while it runs is better than a screen that looks frozen.
 */
async function spPrintRun(plan, name) {
  if (!spCanAssign() && !bkCanAssign()) return SP_NO_ASSIGN;
  if (!plan.assign.length) {
    return plan.same.length
      ? `Nothing to do — all ${nf(plan.same.length)} line(s) in ${name || 'that sheet'} already have the printer named.`
      : `Nothing in ${name || 'that sheet'} could be assigned.`;
  }
  const done = [], failed = [];
  for (let i = 0; i < plan.assign.length; i++) {
    const a = plan.assign[i];
    $('odMsg').className = 'muted';
    $('odMsg').textContent = `Assigning… ${nf(i + 1)} of ${nf(plan.assign.length)} line(s)`;
    const err = await spAssign(a.no, a.sku, a.code, { noRender: true });
    if (err) failed.push(`row ${a.row} (${a.sku}): ${err}`); else done.push(a);
  }
  ORD_IX = {};
  renderOrd();
  const byPrinter = new Map();
  done.forEach(a => byPrinter.set(a.code, (byPrinter.get(a.code) || 0) + 1));
  $('odMsg').className = failed.length ? 'err' : 'muted';
  $('odMsg').textContent = `${nf(done.length)} line(s) given to ${nf(byPrinter.size)} printer(s) — `
    + [...byPrinter].map(([c, n]) => `${voName(c)} ${nf(n)}`).join(', ') + '.'
    + (plan.same.length ? ` ${nf(plan.same.length)} already had theirs.` : '')
    + (plan.skip.length ? ` ${nf(plan.skip.length)} row(s) skipped.` : '')
    + (failed.length ? ` ${nf(failed.length)} failed — ${failed.slice(0, 2).join(' · ')}`
      + (failed.length > 2 ? ` and ${nf(failed.length - 2)} more.` : '.') : '');
  return '';
}

/** The printer sheet as .xlsx, with the printers as a dropdown on the Printer column. */
function spPrintXlsx(rows) {
  const names = spPrinters().map(v => (v.desc || v.name || v.code) + ' (' + v.code + ')');
  const last = Math.max(rows.length, 2) + 500;
  const cellX = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    const t = String(v == null ? '' : v); if (t === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`;
  };
  const prnCol = soColName(rows[0].indexOf('Printer'));
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + rows[0].map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${[18, 34, 11, 26, 30][i] || 14}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellX(v, soColName(j) + (i + 1), i === 0)).join('')}</row>`).join('') + '</sheetData>'
    + `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${prnCol}2:${prnCol}${last}"><formula1>Printers</formula1></dataValidation></dataValidations></worksheet>`;
  let lr = '';
  for (let i = 0; i < Math.max(names.length, 1); i++) lr += `<row r="${i + 1}">${cellX(names[i] || '', 'A' + (i + 1))}</row>`;
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + lr + '</sheetData></worksheet>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Printers" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets>'
    + `<definedNames><definedName name="Printers">Lists!$A$1:$A$${Math.max(names.length, 1)}</definedName></definedNames></workbook>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2], ['xl/styles.xml', styles],
  ]);
}

/* ---------- wiring ---------- */
$('spBulkOpen').onclick = () => {
  const box = $('spBulkBox');
  box.classList.toggle('hide');
  spBulkRender();
};
$('spBulkBox').addEventListener('input', e => {
  const el = e.target.closest('[data-spb]');
  if (el) { const k = el.getAttribute('data-spb'); if (el.value) SP_BULK_VALS[k] = el.value; else delete SP_BULK_VALS[k]; return; }
  if (e.target.id === 'spBulkDate') SP_BULK_VALS.__date = e.target.value;
});
$('spBulkBox').addEventListener('change', e => {
  const el = e.target.closest('[data-spb]');
  if (el) { const k = el.getAttribute('data-spb'); if (el.value) SP_BULK_VALS[k] = el.value; else delete SP_BULK_VALS[k]; }
  if (e.target.id === 'spBulkDate') SP_BULK_VALS.__date = e.target.value;
});
$('spBulkBox').addEventListener('click', async e => {
  const id = e.target && e.target.id;
  if (id === 'spBulkClose') { $('spBulkBox').classList.add('hide'); return; }
  if (id === 'spBulkClear') { const d = SP_BULK_VALS.__date; SP_BULK_VALS = d ? { __date: d } : {}; spBulkRender(); return; }
  if (id === 'spBulkSave') {
    const b = e.target; b.disabled = true;
    try {
      const plan = spBulkPlan(spBulkEntries(), SP_BULK_VALS.__date || dToday());
      if (await spBulkRun(plan, 'the bulk entry')) {
        const d = SP_BULK_VALS.__date; SP_BULK_VALS = d ? { __date: d } : {};
        const keep = $('spBulkMsg') ? $('spBulkMsg').textContent : '', cls = $('spBulkMsg') ? $('spBulkMsg').className : '';
        spBulkRender();
        if ($('spBulkMsg')) { $('spBulkMsg').textContent = keep; $('spBulkMsg').className = cls; }
      }
    } finally { if ($('spBulkSave')) $('spBulkSave').disabled = false; }
  }
});
$('spBulkSheet').onclick = () => {
  const rows = spBulkSheetRows();
  if (rows.length < 2) { $('odMsg').className = 'muted'; $('odMsg').textContent = 'Nothing shown has work left on an open order — nothing to put on a sheet.'; return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([spBulkXlsx(rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `shopify-entry-sheet-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `Entry sheet written for ${nf(rows.length - 1)} SKU(s). Fill Cut / Issue / Receive / Press pcs, pick Fabric and karigars from the dropdowns, then Upload entry sheet.`;
};
$('spPrnSheet').onclick = () => {
  const rows = spPrintSheetRows();
  if (rows.length < 2) {
    $('odMsg').className = 'muted';
    $('odMsg').textContent = 'Nothing shown has an open order left — there is nothing to give a printer.';
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([spPrintXlsx(rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `printer-sheet-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('odMsg').className = 'muted';
  $('odMsg').textContent = `Printer sheet written for ${nf(rows.length - 1)} SKU(s). Pick a printer from the `
    + 'dropdown on the rows you want, leave the rest blank, then Upload printer sheet. A blank row is '
    + 'left exactly as it is.';
};
$('spPrnUp').onclick = () => $('spPrnFile').click();
$('spPrnFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = spPrintSheetEntries(rows);
    if (read.err) { $('odMsg').className = 'err'; $('odMsg').textContent = read.err; return; }
    const plan = spPrintPlan(read.entries);
    if (!plan.assign.length) {
      $('odMsg').className = plan.skip.length ? 'err' : 'muted';
      $('odMsg').textContent = (plan.same.length
        ? `Nothing to do — all ${nf(plan.same.length)} line(s) already have the printer named. `
        : 'Nothing in that sheet could be assigned. ')
        + (plan.skip.length ? plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ` and ${nf(plan.skip.length - 3)} more.` : '') : '');
      return;
    }
    /* SHOWN BEFORE IT IS WRITTEN, grouped by printer — "give 412 lines to Choudhary" is the thing
     * being agreed to, and a row count alone does not say it. */
    const byPrinter = new Map();
    plan.assign.forEach(a => byPrinter.set(a.code, (byPrinter.get(a.code) || 0) + 1));
    ptOpenDialog({
      title: 'Give this printing out?',
      subtitle: `${nf(plan.assign.length)} line(s) across ${nf(new Set(plan.assign.map(a => a.sku)).size)} SKU(s)`,
      note: 'Each line goes to the printer named and appears on their portal. A line that already has '
        + 'that printer is left alone; one with another printer is moved.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + [...byPrinter].map(([c, n]) => `<b>${esc(voName(c))}</b> — ${nf(n)} line(s)`).join('<br>')
        + (plan.same.length ? `<br><br>${nf(plan.same.length)} line(s) already have theirs.` : '')
        + (plan.skip.length ? `<br><br><b style="color:var(--bad)">${nf(plan.skip.length)} row(s) skipped</b><br>`
          + plan.skip.slice(0, 8).map(x => 'row ' + x.row + ' (' + esc(x.sku) + '): ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 8 ? `<br>…and ${nf(plan.skip.length - 8)} more.` : '') : '')
        + '</div>',
      saveLabel: `Assign ${nf(plan.assign.length)} line(s)`,
      onSave: async () => { await spPrintRun(plan, file.name); return ''; },
    });
  } catch (err) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read the sheet: ' + (err.message || err); }
};

$('spBulkUp').onclick = () => $('spBulkFile').click();
$('spBulkFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = spBulkSheetEntries(rows);
    if (read.err) { $('odMsg').className = 'err'; $('odMsg').textContent = read.err; return; }
    await spBulkRun(spBulkPlan(read.entries, dToday()), file.name);
  } catch (err) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read the sheet: ' + (err.message || err); }
};

/**
 * Working a Shopify line: cut it, give it to somebody, take it back, press it.
 *
 * ONE ACT AT A TIME, because each one is a row in a different register and each has its own date —
 * cutting on Tuesday, issued to Ramesh on Wednesday, back on Friday. The four figures that used to
 * sit here together were a summary nobody could be paid from.
 */
/**
 * Hand a quilt line to the quilt team, or take the handover back.
 *
 * Stamped on the line's own record with who and when — the quilt team is not a karigar and has no row
 * in Base Data, so this is where the fact that they have it lives.
 */
async function spQuiltHand(orderNo, sku, on) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return 'That line is no longer on the order.';
  if (!spIsQuilt(line)) return 'Only a quilt goes to the quilt team.';
  const key = spKey(orderNo, sku);
  if (!spKeySafe(key)) return 'That order and SKU cannot be made into a database key.';
  const was = spOf(orderNo, sku) || {};
  if (on && was.quiltAt) return 'It is already with the quilt team.';
  if (!on && !was.quiltAt) return 'It was never handed to the quilt team.';
  const rec = Object.assign({}, was, { orderNo: obUC(orderNo), sku: obUC(sku),
    quiltAt: on ? new Date().toISOString() : '', quiltBy: on ? ME.email : '' });
  try { await ptPut('pt_shopProd/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.shopProd = PTG.shopProd || {};
  PTG.shopProd[key] = rec;
  ORD_IX = {};
  renderOrd();
  return '';
}

/**
 * A quilt line's entry: the three counters it always had, and nothing about a karigar.
 */
function spOpenQuilt(orderNo, sku, line) {
  const sp = spOf(orderNo, sku) || {};
  ptOpenDialog({
    title: 'Quilt — ' + (line.shopOrderNo || line.orderNo),
    subtitle: `${line.sku}  ·  ${[line.articleType, line.articleSubtype, line.color, line.size].filter(Boolean).join(' · ')}  ·  ${nf(line.qty)} piece(s)${line.pcsPer > 1 ? ` (${nf(line.packs)} × pack of ${nf(line.pcsPer)})` : ''}`,
    note: 'A quilt goes to the quilt team as a job, not to a karigar by the piece, so it is counted here '
      + 'rather than issued in Job Work Register. Each figure is bounded by the one before it.',
    fields: [
      { key: 'cut', label: 'Cut', type: 'number', value: sp.cut == null ? '' : sp.cut },
      { key: 'issued', label: 'Issued', type: 'number', value: sp.issued == null ? '' : sp.issued },
      { key: 'received', label: 'Received', type: 'number', value: sp.received == null ? '' : sp.received },
      { key: 'remarks', label: 'Remarks', value: sp.remarks || '', span: true },
    ],
    onSave: v => spSave(orderNo, sku, Object.assign({}, v, { pressed: sp.pressed || 0 })),
    saveLabel: 'Save',
  });
}

function spOpen(orderNo, sku) {
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return;
  /* QUILTS STAY AS THEY WERE: three counters, no karigar. */
  if (spIsQuilt(line)) return spOpenQuilt(orderNo, sku, line);
  const rows = spBaseRows(orderNo, sku);
  const issued = spIssuedReal(orderNo, sku), back = spRecvReal(orderNo, sku);
  const out = rows.filter(r => !r.frozen && ptNum(r.pendingPieces) > 0);
  const types = [...new Set((PTE.emp || []).map(e => String(e[0] || '').trim()).filter(Boolean))].sort();

  ptOpenDialog({
    /* A B2B order is not a Shopify one; the dialog is the same, and says which it is. */
    title: (line.src === 'SHP' || line.shopOrderNo ? 'Shopify production — ' : 'Production — ') + (line.shopOrderNo || line.orderNo),
    subtitle: `${line.sku}  ·  ${[line.articleType, line.articleSubtype, line.color, line.size].filter(Boolean).join(' · ')}  ·  ${nf(line.qty)} piece(s)${line.pcsPer > 1 ? ` (${nf(line.packs)} × pack of ${nf(line.pcsPer)})` : ''}`,
    note: 'This writes the SAME registers the factory\u2019s own orders use — cutting data, Job Work Register '
      + 'and press inventory — so the karigar\u2019s pieces count towards their pay, and the caps that '
      + 'protect any other order protect this one.',
    html: `<div style="display:grid;gap:12px">
      <div class="ptnote">Cut <b>${nf(obCutQty(orderNo, sku))}</b> · issued <b>${nf(issued)}</b> ·
        back <b>${nf(back)}</b> · still out <b>${nf(Math.max(0, issued - back))}</b> ·
        pressed <b>${nf(obPressQty(orderNo, sku))}</b>
        ${out.length ? '<br>Out with: ' + out.map(r => esc(r.empName) + ' ×' + nf(ptNum(r.pendingPieces))).join(', ') : ''}</div>

      <div style="border:1px solid var(--line);border-radius:8px;padding:10px">
        <b style="font-size:13px">Cut</b>
        <div class="toolbar" style="margin-top:6px">
          <input id="spCutPcs" type="number" min="1" step="1" placeholder="Pieces" style="flex:0 0 110px">
          <input id="spCutDate" type="date" value="${esc(dToday())}" style="flex:0 0 150px">
          <input id="spCutFab" placeholder="Fabric (optional)" style="flex:1 1 120px;min-width:0">
          <button id="spCutGo" class="ghost">Record cutting</button>
        </div>
      </div>

      <div style="border:1px solid var(--line);border-radius:8px;padding:10px">
        <b style="font-size:13px">Issue to a karigar</b>
        <div class="toolbar" style="margin-top:6px">
          <select id="spIssType" style="flex:0 0 170px"><option value="">Employment type</option>${
            types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
          <input id="spIssEmp" list="spIssEmpList" placeholder="Karigar" style="flex:0 0 180px">
          <datalist id="spIssEmpList"></datalist>
          <input id="spIssPcs" type="number" min="1" step="1" placeholder="Pieces" style="flex:0 0 110px">
          <input id="spIssDate" type="date" value="${esc(dToday())}" style="flex:0 0 150px">
          <button id="spIssGo" class="ghost">Issue</button>
        </div>
      </div>

      <div style="border:1px solid var(--line);border-radius:8px;padding:10px">
        <b style="font-size:13px">Receive back</b>
        <div class="toolbar" style="margin-top:6px">
          <input id="spRecPcs" type="number" min="1" step="1" placeholder="Pieces" style="flex:0 0 110px">
          <input id="spRecDate" type="date" value="${esc(dToday())}" style="flex:0 0 150px">
          <span class="muted" style="font-size:12px;flex:1 1 auto">Oldest issue first — whoever has been waiting longest.</span>
          <button id="spRecGo" class="ghost">Receive</button>
        </div>
      </div>

      <div style="border:1px solid var(--line);border-radius:8px;padding:10px">
        <b style="font-size:13px">Press</b>
        <div class="toolbar" style="margin-top:6px">
          <input id="spPrsPcs" type="number" min="1" step="1" placeholder="Pieces" style="flex:0 0 110px">
          <input id="spPrsDate" type="date" value="${esc(dToday())}" style="flex:0 0 150px">
          <button id="spPrsGo" class="ghost">Record pressing</button>
        </div>
      </div>
    </div>`,
    saveLabel: '',
  });

  const say = (t, bad) => ptDlgMsg(t, bad);
  const after = (err, good) => { if (err) return say(err, true); say(good); spOpen(orderNo, sku); };

  /* The karigar list follows the employment type, the way it does on Base Data. */
  const fillEmps = () => {
    const t = $('spIssType').value;
    $('spIssEmpList').innerHTML = ptEmpsOfType(t).map(e => `<option value="${esc(e[1])}">`).join('');
  };
  $('spIssType').addEventListener('change', fillEmps);
  fillEmps();

  $('spCutGo').onclick = async () => after(
    await spCutReal(orderNo, sku, $('spCutPcs').value, $('spCutDate').value, $('spCutFab').value, ''),
    `${nf(ptNum($('spCutPcs').value))} piece(s) cut.`);
  $('spIssGo').onclick = async () => after(
    await spIssueReal(orderNo, sku, $('spIssType').value, $('spIssEmp').value, $('spIssPcs').value, $('spIssDate').value, ''),
    `${nf(ptNum($('spIssPcs').value))} piece(s) issued to ${$('spIssEmp').value}.`);
  $('spRecGo').onclick = async () => after(
    await spReceiveReal(orderNo, sku, $('spRecPcs').value, $('spRecDate').value),
    `${nf(ptNum($('spRecPcs').value))} piece(s) back.`);
  $('spPrsGo').onclick = async () => after(
    await spPressReal(orderNo, sku, $('spPrsPcs').value, $('spPrsDate').value, ''),
    `${nf(ptNum($('spPrsPcs').value))} piece(s) pressed.`);
}

$('odTable').addEventListener('click', e => {
  const rm = e.target && e.target.closest ? e.target.closest('[data-demrm]') : null;
  if (rm) {
    const k = rm.getAttribute('data-demrm');
    Object.keys(ORD.demBasket || {}).forEach(c => { ORD.demBasket[c] = (ORD.demBasket[c] || []).filter(x => x.key !== k); });
    return renderOrd();
  }
  const b = e.target && e.target.closest ? e.target.closest('[data-demrun]') : null;
  if (!b) return;
  const key = b.getAttribute('data-demrun'), pk = (ORD.demPick || {})[key] || {};
  /* A printer picked on the row: add to that printer's order. None: the full form, as before. */
  /* What the row's list SHOWS — a pick kept from before can be a printer the list no longer offers. */
  const sel = b.parentNode.querySelector('[data-demprn]'), prn = sel ? sel.value : pk.prn;
  if (!prn) return demRunGive(key);
  const err = demBasketAdd(key, prn,pk.dir != null ? pk.dir : ((b.parentNode.querySelector('[data-demdir]') || {}).value || ''));
  if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
});
$('odTable').addEventListener('change', e => {
  /* The printer and direction picked on a totals row, kept until Give. */
  const pr = e.target.closest && e.target.closest('[data-demprn],[data-demdir]');
  if (pr) {
    ORD.demPick = ORD.demPick || {};
    const k = pr.getAttribute('data-demprn') || pr.getAttribute('data-demdir');
    const cur = ORD.demPick[k] || {};
    if (pr.hasAttribute('data-demprn')) cur.prn = pr.value; else cur.dir = pr.value;
    ORD.demPick[k] = cur;
    return;
  }
  /* A fabric · colour row stands for its lines with no printer yet. */
  const dc = e.target.closest('[data-demtot]');
  if (dc) {
    ORD.pick = ORD.pick || new Set();
    const ks = ((ORD.demKeys || new Map()).get(dc.getAttribute('data-demtot'))) || [];
    ks.forEach(k => (dc.checked ? ORD.pick.add(k) : ORD.pick.delete(k)));
    return renderOrd();
  }
  /* A SKU row stands for every open line behind it, so its box is answered by spSkuToggle rather
   * than by adding one key. */
  const g = e.target.closest('[data-spskupick]');
  if (g) return spSkuToggle(g.getAttribute('data-spskupick'));
  const t = e.target.closest('[data-sppick]');
  if (!t) return;
  ORD.pick = ORD.pick || new Set();
  const k = t.getAttribute('data-sppick');
  if (t.checked) ORD.pick.add(k); else ORD.pick.delete(k);
  renderOrd();
});

/** The printer's own form: one figure, and the only one they may touch. */
function spPrintOpen(orderNo, sku) {
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return;
  ptOpenDialog({
    title: 'Printing — ' + (line.shopOrderNo || line.orderNo),
    subtitle: `${line.sku}  ·  ${[line.articleType, line.articleSubtype, line.color, line.size].filter(Boolean).join(' · ')}  ·  ${nf(line.qty)} piece(s)${line.pcsPer > 1 ? ` (${nf(line.packs)} × pack of ${nf(line.pcsPer)})` : ''}`,
    note: 'How many pieces of this have been printed. Nothing else on the line is yours to change, '
      + 'and nothing can be cut from it until this is recorded.',
    fields: [{ key: 'printed', label: 'Printed', type: 'number', value: line.printed || '' }],
    onSave: v => spPrint(orderNo, sku, v.printed),
    saveLabel: 'Save',
  });
}

/**
 * Give every ticked line to one printer.
 *
 * Lines that printer already has are left as they are. A line another printer has already printed on
 * is moved like a single one would be — its printed figure stays on the record with the old name.
 */
async function spAssignPicked(code) {
  /* Either queue is enough to start; every line is then checked against the queue IT is in, so a
   * selection spanning both refuses exactly the half this account may not touch. */
  if (!spCanAssign() && !bkCanAssign()) return SP_NO_ASSIGN;
  const want = String(code || '').trim();
  if (!want) return 'Choose the printer first.';
  if (!voMasterRow(want)) return 'That printer is not in the vendor master.';
  const picked = [...(ORD.pick || new Set())];
  if (!picked.length) return 'Tick the line(s) first.';
  const done = [], same = [], left = [];
  for (const k of picked) {
    const i = k.indexOf('|');
    const no = k.slice(0, i), sku = k.slice(i + 1);
    if (spPrinter(no, sku) === want) { same.push(k); continue; }
    const err = await spAssign(no, sku, want, { noRender: true });
    if (err) left.push((sku || no) + ': ' + err); else done.push(k);
  }
  done.concat(same).forEach(k => ORD.pick.delete(k));
  ORD_IX = {};
  renderOrd();
  $('odMsg').className = left.length ? 'err' : 'muted';
  $('odMsg').textContent = `${nf(done.length)} line(s) given to ${voName(want)}`
    + (done.length ? ` — on their order ${spShopOrderNo(want)} in Vendor Orders (it sits at the top of the list).` : '.')
    + (same.length ? ` ${nf(same.length)} already had them.` : '')
    + (left.length ? ` ${nf(left.length)} not assigned — ${left.slice(0, 2).join(' · ')}`
      + (left.length > 2 ? ` and ${nf(left.length - 2)} more.` : '.') : '');
  return '';
}
function spAssignPickedOpen() {
  const n = (ORD.pick || new Set()).size;
  if (!n) return;
  const printers = voAllVendors().filter(v => /print/i.test(String(v.category || '')));
  ptOpenDialog({
    title: `Who prints these ${nf(n)} line(s)?`,
    note: 'Every ticked line goes to this printer and shows on their portal. Lines they already have '
      + 'are left as they are; a line with another printer is moved to this one.',
    fields: [{ key: 'printer', label: 'Printer', type: 'select', value: '',
      options: [['', '— choose —']].concat(printers.map(v => [v.code, (v.desc || v.name || v.code) + ' (' + v.code + ')'])) }],
    onSave: v => spAssignPicked(v.printer),
    saveLabel: `Assign ${nf(n)}`,
  });
}

/** Which printer a line goes to. Ravi's alone — a printer who could assign could take somebody else's work. */
function spAssignOpen(orderNo, sku) {
  const line = (ordLines() || []).find(l => obUC(l.orderNo) === obUC(orderNo) && obUC(l.sku) === obUC(sku));
  if (!line) return;
  const printers = voAllVendors().filter(v => /print/i.test(String(v.category || '')));
  ptOpenDialog({
    title: 'Who prints this?',
    subtitle: `${line.sku}  ·  ${[line.articleType, line.articleSubtype, line.color, line.size].filter(Boolean).join(' · ')}  ·  ${nf(line.qty)} piece(s)${line.pcsPer > 1 ? ` (${nf(line.packs)} × pack of ${nf(line.pcsPer)})` : ''}`,
    note: 'The printer you choose is the only one who sees this line, and the only one who records '
      + 'its printing. Nothing can be cut from it until they have.',
    fields: [{ key: 'printer', label: 'Printer', type: 'select', value: line.printer || '',
      options: [['', '— nobody —']].concat(printers.map(v => [v.code, (v.desc || v.name || v.code) + ' (' + v.code + ')'])) }],
    onSave: v => spAssign(orderNo, sku, v.printer),
    saveLabel: 'Save',
  });
}

$('odTable').addEventListener('click', async e => {
  const oj = e.target.closest('[data-ordj]');
  if (oj) { e.preventDefault(); return ordJourney(oj.getAttribute('data-ordj')); }
  const split = el => { const v = el.getAttribute(el.hasAttribute('data-sp') ? 'data-sp'
    : el.hasAttribute('data-spprint') ? 'data-spprint'
    : el.hasAttribute('data-spassign') ? 'data-spassign'
    : el.hasAttribute('data-sphand') ? 'data-sphand' : 'data-spback');
    const i = String(v).indexOf('|'); return [String(v).slice(0, i), String(v).slice(i + 1)]; };
  const pr = e.target.closest('[data-spprint]');
  if (pr) { const [no, sku] = split(pr); return spPrintOpen(no, sku); }
  const qt = e.target.closest('[data-spquilt]');
  if (qt) {
    const v = qt.getAttribute('data-spquilt'), i = v.indexOf('|');
    const err = await spQuiltHand(v.slice(0, i), v.slice(i + 1), qt.getAttribute('data-on') === '1');
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
    return;
  }
  const as = e.target.closest('[data-spassign]');
  if (as) { const [no, sku] = split(as); return spAssignOpen(no, sku); }
  const b = e.target.closest('[data-sp]');
  if (b) { const [no, sku] = split(b); return spOpen(no, sku); }
  const h = e.target.closest('[data-sphand]');
  if (h) {
    const [no, sku] = split(h);
    /* Named, not "are you sure?" — this is what takes the line off the production list. */
    if (!confirm('Hand this line to the shipping team?\n\nIt comes off the production list. '
      + 'It can be undone if it was too early.')) return;
    h.disabled = true;
    const err = await spHandover(no, sku, true);
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
    return;
  }
  const u = e.target.closest('[data-spback]');
  if (u) {
    const [no, sku] = split(u);
    u.disabled = true;
    const err = await spHandover(no, sku, false);
    if (err) { $('odMsg').className = 'err'; $('odMsg').textContent = err; }
  }
});

/** Which view the Order Console is showing. */
const ordView = () => (($('odView') || {}).value || 'shopsku');

function renderOrd() {
  /* The brands that appear on the book, so the filter never offers one with nothing behind it. */
  if ($('odBrand')) ptFillSelect('odBrand', [...new Set((PTG.ob || []).map(r => ordBrandOf(r && r.sku)).filter(Boolean))]
    .sort().map(b => [b, b]), 'All brands');
  if (ORD.busy) { $('odMsg').className = 'muted'; $('odMsg').textContent = 'Reading the order book…'; ptEmpty('odTable', 'Loading…'); return; }
  if (PTG.err) { $('odMsg').className = 'err'; $('odMsg').textContent = 'Could not read it: ' + PTG.err; ptEmpty('odTable', 'Nothing to show.'); $('odKpis').innerHTML = ''; return; }

  /* The order dropdown lists every order in the book — six hundred of them are Shopify — and it
   * means nothing at all once rows are combined by SKU. Hidden on the Shopify views rather than
   * left there filtering something the reader cannot see. */
  let v = ordView();
  /* A Shopify-only account can never be shown the order book, whatever the picker says — the option
   * is removed above, and this is the second lock, because a stale value would otherwise open it. */
  if (SHOP_ONLY() && (v === 'book' || v === 'bookdone')) { v = 'shopsku'; if ($('odView')) $('odView').value = v; }
  const isBook = v === 'book' || v === 'bookdone';
  if ($('odDone') && v !== 'shopsku' && v !== 'shoporder') $('odDone').classList.add('hide');
  const ow = $('odOrd'); if (ow) ow.style.display = isBook ? '' : 'none';
  /* THE BAR IS FOR BOTH JOBS NOW. It used to appear only for somebody who may record production,
   * which hid the printer sheet from the very people whose job is giving the printing out. */
  /* ENTRIES ARE MADE WHERE THEY BELONG (Ravi, 2026-09-28): cutting, issue, receive and press in the Job Work register;
   * printing given out by a vendor order or a vendor order request. The bulk-entry and printer sheets are not offered here. */
  const bulkOk = false;
  if ($('spBulkBar')) $('spBulkBar').classList.toggle('hide', !bulkOk);
  /* Each half of the bar answers its own right: the entry buttons to whoever records production,
   * the printer buttons to whoever gives the printing out. */
  ['spBulkOpen', 'spBulkSheet', 'spBulkUp', 'spBulkNote'].forEach(id => {
    if ($(id)) $(id).classList.toggle('hide', !(v === 'shopsku' && ptCanEdit()));
  });
  ['spPrnSheet', 'spPrnUp'].forEach(id => {
    if ($(id)) $(id).classList.toggle('hide', !(v === 'shopsku' && spCanAssign()));
  });
  if (!bulkOk && $('spBulkBox')) $('spBulkBox').classList.add('hide');
  /* The demand view is neither the book nor a Shopify list: it is the book added up by fabric. */
  if (v === 'demand') return renderOrdDemand();
  if (v === 'democol') return renderOrdDemandCol();
  if (v === 'demtot') return renderOrdDemandTot();
  if (v === 'orders') return renderOrdSheet();
  if (v === 'track') return renderOrdTrack();
  if (v === 'shppipe') return renderOrdPipe();
  if (v === 'team') return renderOrdTeam();
  if (v === 'prnplat') return renderOrdPrnPlat();
  if (!isBook) { const out = renderOrdShopify(v === 'shopsku', v === 'shopdone' || (v === 'shopsku' && !!ORD.skuDone)); if (bulkOk) spBulkRender(); return out; }

  /* PENDING HERE, FINISHED IN THEIR OWN VIEW (Ravi, 2026-09-24): a line that is Complete or handed over is
   * not work, so it is not on the pending book and it counts in no "to make". */
  const doneView = v === 'bookdone';
  const all = ordLines().filter(r => (doneView ? !r.open : r.open));
  if (!all.length) { $('odMsg').className = 'muted'; $('odMsg').textContent = ''; $('odKpis').innerHTML = '';
    ptEmpty('odTable', doneView ? 'Nothing is complete or handed over yet.' : 'Nothing is pending — every order line is complete.'); return; }

  const f = ordFilters();
  ptFill('odOrd', ordApply(all, f, 'ord').map(r => r.orderNo), 'All orders');
  ptFill('odArt', ordApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('odSub', ordApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('odCol', ordApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('odSz', ordApply(all, f, 'sz').map(r => r.size), 'All sizes');

  /* The tiles count what the dropdowns let through; the tile somebody picked then narrows the table. */
  const shown = ordApply(all, f);
  const rows = ordNewest(ordKpiApply(shown));
  ORD.rows = rows;

  const s = fn => shown.reduce((a, r) => a + fn(r), 0);
  const orphan = ordOrphans();
  const orphanTotal = orphan.base + orphan.cut + orphan.press;
  $('odKpis').innerHTML = ordSrcChips() + ordKpiCards(doneView ? 'Order Console — complete & handed over' : 'Order Console — pending', [
    [nf(new Set(shown.map(r => r.orderNo)).size), 'Orders', 'doc', 'blue', 'read live' + (ORD.at ? ' · ' + esc(ORD.at) : '')],
    [nf(shown.length), 'Lines', 'list', 'blue', 'one order, one SKU'],
    [nf(s(r => r.qty)), 'Ordered', 'box', 'blue', 'pieces asked for'],
  ], s);

  /* "Raised from" sits next to the order number because that is where somebody looks to ask what an
   * order IS. One column rather than two: the Shopify order number and the adjustment id are read
   * together or not at all, and every other row in this book has neither. The numeric columns move
   * one to the right with it — a header and its cells that disagree by one puts every column after
   * it over the wrong data, which has happened on this table before. */
  /* "Like Shopify orders, I can assign a printer" — on every order in the book. Ticking is only for
   * somebody who may give work to a printer; the handover is Shopify's and is not offered here. */
  const bkAssign = false;   // printers are given work by vendor orders only (2026-09-28)
  const bkPick = bkAssign || odrCanAsk();
  const bkPrint = rows.some(r => r.printer || ordVendorOf(r.orderNo, r.sku)) || bkAssign;
  /* ONE CELL FOR THE ORDER AND ONE FOR THE PRODUCT, as the Job Work table reads them. The nine
   * columns they replace said the same things in nine narrow strips, and pushed the figures off
   * the right of the screen. */
  const head = ordHead([['Order', ''], ['Item', ''], ['Ordered', 'num'], ['Cut', 'num'], ['Issued', 'num'],
    ['Received', 'num'], ['QC', 'num'], ['Made', 'num'], ['In store', 'num'], ['To FBA', 'num'],
    ['To cut', 'num'], ['To make', 'num'], ['Status', '']]
    .concat(bkPrint ? [['Printing', '']] : [])
    /* The actions had no heading at all when nothing on the page was printed, which left every
     * heading one cell to the left of its data. */
    .concat([['', '']]),
    bkPick ? '<input type="checkbox" id="spPickAll" style="width:auto;margin:0" title="Tick every line shown">' : '');

  const body = rows.slice(0, ORD_CAP).map(r => {
    const pk = r.orderNo + '|' + r.sku, k = esc(pk);
    const status = ordStatePill(r)
      + (r.unrecorded ? `<div><span class="pill pill-low" title="${esc(nf(r.unrecorded) + ' of these ' + nf(r.qty)
        + ' piece(s) were handed to shipping with nothing in the registers to say they were made.')}">${nf(r.unrecorded)} never recorded</span></div>` : '')
      /* THE QUANTITY MOVED, SAID WHERE THE WORK IS DONE. It was written on the sales order, and
       * nobody on this floor opens one. */
      + ordQtyAdj(r.orderNo, r.sku).slice(0, 3).map(a => {
        const st = soQtyStage(a);
        /* WAITING is the loud one: nothing has moved yet and somebody has to answer. Applied is
         * history and rejected is a dead end — both are quiet. */
        const look = st === 'pending' ? 'background:#fef3c7;color:#7c2d12;border:1px solid #fbbf24'
          : (st === 'rejected' ? 'background:var(--chip);color:var(--muted);border:1px solid var(--line);text-decoration:line-through'
          : 'background:var(--chip);color:var(--muted);border:1px solid var(--line)');
        return `<div><span class="pill" style="${look}"`
          + ` title="${esc('Asked by ' + String(a.by || '').split('@')[0] + ' on ' + (ptIsoDate(a.at) || '')
            + (a.why ? ' — ' + a.why : '') + (a.via === 'sheet' ? ' (from a sheet)' : '')
            + (st === 'pending' ? '. Nothing has moved: it is waiting to be approved here.'
              : (st === 'rejected' ? '. Turned down by ' + String(a.decidedBy || '').split('@')[0]
                + (a.decidedWhy ? ' — ' + a.decidedWhy : '') + '.'
                : '. Approved by ' + String(a.decidedBy || '').split('@')[0] + ' on ' + (ptIsoDate(a.decidedAt) || '') + '.')))}">`
          + (st === 'pending' ? 'qty asked ' : (st === 'rejected' ? 'qty refused ' : 'qty ')) + ordQtyPill(a) + '</span>'
          + (st === 'pending' ? ' <a href="#" data-ordqtyopen style="font-size:10.5px">Answer</a>' : '')
          + '</div>';
      }).join('')
      + (odrPendingOf(r.orderNo, r.sku)
        ? `<div><span class="pill pill-out" title="${esc('Asked by ' + String(odrPendingOf(r.orderNo, r.sku).by || '').split('@')[0] + ': ' + (odrPendingOf(r.orderNo, r.sku).why || ''))}">delete asked</span></div>`
        : (o => (o && o.status === 'kept'
          ? `<div class="muted" style="font-size:10.5px" title="${esc(o.note || '')}">sales kept it: ${esc(String(o.note || '').slice(0, 40))}</div>` : ''))(
          (ODR.rows || []).find(x => x && x.id === odrId(r.orderNo, r.sku))));
    const cutCell = !r.cutReq ? '<span class="muted">n/a</span>'
      : `${nf(r.cut)}<div class="muted" style="font-size:11px">${r.cutPct.toFixed(0)}%${r.cutDone ? ' ✓' : ''}</div>`;
    return '<tr>'
      + (bkPick ? `<td class="frz"><input type="checkbox" data-sppick="${k}"${
          (ORD.pick || new Set()).has(pk) ? ' checked' : ''} style="width:auto;margin:0"></td>` : '')
      + ordOrderCell(r, !bkPick)
      + ordItemCell(r)
      + `<td class="num" style="font-weight:700">${nf(r.qty)}</td>`
      + `<td class="num">${cutCell}</td>`
      + `<td class="num">${nf(r.issued)}</td>`
      + `<td class="num"${r.overRecv ? ' style="color:#7f6000;font-weight:700" title="' + nf(r.overRecv)
          + ' more than this line ordered — either more was made than asked for, or a receipt went against the wrong order."' : ' class="muted"'}>${nf(r.received)}</td>`
      + (q => `<td class="num"` + (q && q.worked && !(q.rej || q.alt)
          ? ' title="' + nf(q.worked) + ' of these checks named no order, so they are shared out by SKU — never beyond what this order received, oldest order first."'
          : '') + (q && (q.rej || q.alt)
          ? ' title="' + (q.worked ? nf(q.worked) + ' of these named no order and are shared out by SKU. ' : '') + nf(q.checked) + ' checked · ' + nf(q.ok) + ' passed · ' + nf(q.rej) + ' rejected'
            + (q.alt ? ' · ' + nf(q.alt) + ' for alteration' : '') + '"' : '')
          + '>'
          /* One column, both numbers: what passed and what came back. A line checked before QC
           * carried an order number answers nothing at all, rather than a zero that reads as a fail. */
          + (q ? `<span style="color:#166534;font-weight:700">${nf(q.ok)}</span>`
              + (q.rej ? ` <span style="color:var(--bad)">${nf(q.rej)} ✗</span>` : '')
              + (q.alt ? `<div class="muted" style="font-size:10.5px">${nf(q.alt)} alt</div>` : '')
            : '<span class="muted">—</span>')
          + '</td>')(ordQcOf(r.orderNo, r.sku))
      + `<td class="num" style="color:#166534">${nf(r.pressed)}</td>`
      + (g => `<td class="num"${g ? ` title="${esc(nf(g.in) + ' of this order came into the India Store and ' + nf(g.out) + ' have gone out, so ' + nf(g.store) + ' are there now.'
            + (g.fbaOpen ? ' A further ' + nf(g.fbaOpen) + ' are dispatched to FBA and not yet shipped, so ' + nf(g.store + g.fbaOpen) + ' are still the factory\'s.' : '')
            + (g.worked ? ' The store keeps stock by SKU, so ' + nf(g.worked) + ' of the outward pieces name no order and are shared out by SKU — oldest order first, never beyond what this order received.' : ''))}"` : ''}>`
          + (g && g.store ? `<b>${nf(g.store)}</b>` : '<span class="muted">—</span>')
          + (g && g.fbaOpen ? `<div class="muted" style="font-size:10.5px">+${nf(g.fbaOpen)} held for FBA</div>` : '')
          + '</td>'
          /* THE LAST LEG. Pieces that left the store for Amazon, and whether they have actually gone. */
          + `<td class="num"${g && g.fba ? ` title="${esc(nf(g.fba) + ' dispatched to FBA'
            + (g.fbaOpen ? ', of which ' + nf(g.fbaOpen) + ' are still waiting to be shipped' : ' and all shipped'))}"` : ''}>`
          + (g && g.fba ? `<b style="color:#166534">${nf(g.fba)}</b>`
              + (g.fbaOpen ? `<div class="muted" style="font-size:10.5px">${nf(g.fbaOpen)} waiting</div>` : '')
            : '<span class="muted">—</span>') + '</td>')(ordFgAt(r.orderNo, r.sku))
      + `<td class="num"${r.pendingCut ? ' style="color:#7f6000;font-weight:700"' : ''}>${r.pendingCut ? nf(r.pendingCut) : '<span class="muted">—</span>'}</td>`
      + `<td class="num"${r.pendingMake ? ' style="color:var(--bad);font-weight:700"' : ''}>${r.pendingMake ? nf(r.pendingMake) : '<span class="muted">—</span>'}</td>`
      + `<td>${status}</td>`
      + (!bkPrint ? '' : `<td style="text-align:left;font-size:12px">${r.printer
          ? `<b>${nf(r.printed)}</b> <span class="muted">of ${nf(r.qty)}</span>`
            + `<div class="muted" style="font-size:11px">${esc(voName(r.printer))}</div>`
          /* WHAT A VENDOR ORDER ALREADY GAVE OUT. This cell used to know only a printer put on the line from
           * this screen, and said "not printed" on cloth that had been at the printer for a week. */
          : (v => (v
            ? `<span title="${esc(v.parts.map(p => p.vpo + ' · ' + voName(p.vendorCode) + ' · ' + nf(p.qty) + ' given, ' + nf(p.back) + ' back' + (p.due ? ' · promised ' + p.due : '')).join('\n')
                + (v.shared ? '\n\nThis SKU is on more than one order, so the vendor\u2019s pieces are shared out between them once — open orders first, oldest first.' : ''))}">`
              + `<b>${nf(v.back)}</b> <span class="muted">back of ${nf(v.given)} given</span>`
              + (v.given < r.qty ? ` <span class="muted">· ${nf(r.qty - v.given)} not given</span>` : '')
              + `<div class="muted" style="font-size:11px">${esc([...new Set(v.parts.map(p => voName(p.vendorCode)))].join(', '))}${v.shared ? ' · shared' : (v.parts.every(p => p.stamped) ? ' · for this order' : '')}</div></span>`
            : '<span class="muted">not given to a vendor</span>'))(ordVendorOf(r.orderNo, r.sku))}</td>`)
        /* THE ACTIONS CELL IS ALWAYS THERE, whether or not the Printing column is — its heading always is (2026-09-28). */
        /* ENTRY BELONGS ON EVERY ORDER, NOT ONLY SHOPIFY'S (Ravi, 2026-09-23: "jo hum shopify ke orders
         * ke liye yahi se karigar ko issue rec. karte h to wesa hi system B2B orders ke liye bana do").
         * The dialog was never Shopify's: it writes the cutting data, the Job Work Register and press
         * inventory, the same registers the factory's own orders use. Only the button was missing here,
         * so a B2B order had to be recorded from three other screens. */
        + `<td><div class="jw-acts">${[
            spCanPrint(r.orderNo, r.sku) ? `<button class="jw-btn" data-spprint="${k}">Printed</button>` : '',
            /* No Entry button: the Job Work register is where production is recorded (2026-09-28). */
            (!spIsVendor() && ptCanEdit() && spIsQuilt(r)) ? ((q => q.quiltAt
              ? `<button class="jw-btn" data-spquilt="${k}" data-on="0">Undo quilt</button>`
              : `<button class="jw-btn" data-spquilt="${k}" data-on="1" style="color:#166534">To quilt team</button>`)(spOf(r.orderNo, r.sku) || {})) : '',
            bkAssign ? `<button class="jw-btn" data-spassign="${k}">${r.printer ? 'Printer' : 'Assign'}</button>` : '',
          ].filter(Boolean).join('') || '<span class="muted">—</span>'}</div></td>`
      + '</tr>';
  }).join('');
  $('odTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  const bar = $('odPickBar');
  if (bar) {
    const n = (ORD.pick || new Set()).size;
    bar.classList.toggle('hide', !bkPick || !n);
    bar.innerHTML = !bkPick ? '' : (n
      ? `<span class="muted" style="font-size:12.5px"><b>${nf(n)}</b> line(s) ticked</span>`
        + (bkAssign ? `<button id="spAssignAll" class="ghost">Assign printer to ${nf(n)}</button>` : '')
        + (odrCanAsk() ? `<button id="odrAskAll" class="ghost" style="color:var(--bad)">Ask sales to delete ${nf(n)}</button>` : '')
        + '<button id="spPickClear" class="ghost">Clear</button>'
      : '');
    if ($('spAssignAll')) $('spAssignAll').onclick = () => spAssignPickedOpen();
    if ($('odrAskAll')) $('odrAskAll').onclick = () => odrAskOpen();
    if ($('spPickClear')) $('spPickClear').onclick = () => { ORD.pick = new Set(); renderOrd(); };
    if ($('spPickAll')) $('spPickAll').onchange = e => {
      ORD.pick = ORD.pick || new Set();
      if (!e.target.checked) ORD.pick = new Set();
      else rows.slice(0, ORD_CAP).forEach(x => ORD.pick.add(x.orderNo + '|' + x.sku));
      renderOrd();
    };
  }

  /* SAID AT THE TOP, NOT ONLY ON THE ROW. A pill halfway down 1,300 lines is not news, and "production
   * ko pata hi nahi chala" is the whole complaint. This is the ORDER BOOK view because that is where a
   * sales order's lines are — a quantity change cannot happen to a Shopify line.
   *
   * ONE innerHTML, and everything that came out of the data is escaped on the way in. Setting
   * textContent afterwards would wipe the markup, which is exactly what I did first. */
  /* ONE LINE AND A BUTTON. A paragraph of red naming three orders and "and 54 more" is a wall
   * nobody reads — and the answer to it is a window, not a sentence. */
  const unseen = ordQtyUnseenAll();
  $('odMsg').className = orphanTotal ? 'err' : 'muted';
  $('odMsg').innerHTML = (unseen.length
    ? '<button data-ordqtyopen style="padding:3px 10px;font-size:12px;margin-right:8px">'
      + nf(unseen.length) + ' quantity change' + (unseen.length > 1 ? 's' : '') + ' to approve</button>' : '')
    + (ORD.adjErr ? esc('The quantity changes could not be read (' + ORD.adjErr + '). · ') : '')
    + esc(`${nf(rows.length)} of ${nf(all.length)} line(s)`
      + (rows.length > ORD_CAP ? ` · showing the newest ${nf(ORD_CAP)}` : '')
      + ordKpiNote()
      /* The number is news — those pieces are made and belong to nobody — so it stays. What it
       * means, and where it is split, is in the tooltip. */
      + (orphanTotal ? ` · ${nf(orphanTotal)} row(s) with no order` : ''));
  $('odMsg').title = orphanTotal
    ? `${nf(orphanTotal)} row(s) carry NO Order ID and are counted against nothing here `
      + `(Job Work Register ${nf(orphan.base)}, cutting ${nf(orphan.cut)}, press ${nf(orphan.press)}) — `
      + 'those pieces were made, they just cannot be attributed to an order.'
    : '';
  ordMoreBtn(rows.length);
  ptImgFill(rows.slice(0, ORD_CAP).map(r => r.sku), false, ptIfTab('ord', renderOrd));
}

['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus'].forEach(id => $(id).addEventListener('change', renderOrd));
if ($('odSort')) $('odSort').addEventListener('change', () => { ORD_CAP = 600; renderOrd(); });
ptDebounce('odQ', renderOrd);
/* Clear means clear. Source and brand were added later and never joined this list, so Clear left two
 * of its own filters set and the screen kept hiding rows somebody had just asked to see. */
$('odClear').onclick = () => { ['odOrd', 'odArt', 'odSub', 'odCol', 'odSz', 'odStatus', 'odSrc', 'odBrand', 'odQ', 'odD1', 'odD2'].forEach(id => { if ($(id)) $(id).value = ''; }); ORD_KPI = ''; renderOrd(); };
function ordKpiClick(e) {
  const t = e.target.closest('[data-odkpi]');
  if (!t) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (e.type === 'keydown') e.preventDefault();
  const key = t.getAttribute('data-odkpi');
  ORD_KPI = ORD_KPI === key ? '' : key;
  renderOrd();
}
/* SOMEBODY ON THE FLOOR SAYS THEY SAW IT, and the person who changed the figure can read that back
 * on the order. Delivered and read are different things. */
/**
 * THE WINDOW, the way a sales order gets one.
 *
 * Everything the answer needs is on it: what the order says now, what is being asked for, what has
 * already been made against the line — because that is what decides whether it can be granted — who
 * asked and why. Tick and approve, or tick and turn down with a reason.
 */
function ordQtyListOpen() {
  const rows = ordQtyUnseenAll();
  ORD.qtyPick = new Set([...(ORD.qtyPick || [])].filter(k => rows.some(r => r.orderNo + '|' + r.id === k)));
  ptOpenDialog({
    title: 'Quantity changes to approve',
    subtitle: rows.length ? `${nf(rows.length)} change(s) the sales team has asked for` : 'Nothing is waiting',
    note: 'Nothing has moved yet. Approving a change moves the sales order AND the order book together, '
      + 'so the figure you work to changes at that moment and not before. Turning one down needs a reason — '
      + 'the sales team reads it on the order. A change cannot take a line below what has already been '
      + 'cut, received or pressed, and that is checked again now, not when it was asked for.',
    html: rows.length ? `<div class="xlwrap" style="max-height:44vh"><table class="xl"><thead><tr>
        <th><input type="checkbox" data-ordqty-all style="width:auto;margin:0" title="Tick every change"></th>
        <th>Order</th><th>SKU</th><th class="num">Now</th><th class="num">Asked</th><th class="num">Made so far</th><th>Why</th><th>Asked by</th></tr></thead><tbody>
        ${rows.map(r => {
          const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(r.orderNo));
          const nowQty = o ? soQtyOf(o, r.sku) : r.from;
          const d = soDoneOn(r.orderNo, r.sku);
          const blocked = r.to < d.floor;
          return `<tr${blocked ? ' style="background:var(--bad-bg)"' : ''}>`
            + `<td><input type="checkbox" data-ordqty-pick="${esc(r.orderNo + '|' + r.id)}"${
              (ORD.qtyPick || new Set()).has(r.orderNo + '|' + r.id) ? ' checked' : ''} style="width:auto;margin:0"></td>`
            + `<td style="text-align:left">${esc(r.orderNo)}</td>`
            + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
            + `<td class="num">${nf(nowQty)}</td>`
            + `<td class="num" style="font-weight:700;color:${r.to > nowQty ? '#166534' : 'var(--bad)'}">${nf(r.to)}</td>`
            + `<td class="num"${blocked ? ' style="color:var(--bad);font-weight:700"' : ''}>${nf(d.floor)}`
            + (blocked ? '<div style="font-size:10.5px">cannot go below this</div>' : '') + '</td>'
            + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.why || '')}${
              r.via === 'sheet' ? '<div class="muted" style="font-size:10.5px">from a sheet</div>' : ''}</td>`
            + `<td style="font-size:12px">${esc(String(r.by || '').split('@')[0])}<div class="muted" style="font-size:10.5px">${esc(ptIsoDate(r.at) || '')}</div></td>`
            + '</tr>';
        }).join('')}
      </tbody></table></div>
      <label style="display:block;margin-top:10px">Reason, if you are turning them down<input id="ordQtyWhy" type="text" placeholder="e.g. already cut for the 25th, cannot drop it now"></label>`
      : '<div class="muted">Nothing is waiting.</div>',
    onSave: rows.length ? () => ordQtyAnswerRun([...(ORD.qtyPick || [])], false) : null,
    saveLabel: 'Approve ticked',
    alt: rows.length ? { label: 'Turn down ticked',
      run: () => ordQtyAnswerRun([...(ORD.qtyPick || [])], true, (($('ordQtyWhy') || {}).value) || '') } : null,
  });
}

$('ptDlgBody').addEventListener('change', e => {
  const all = e.target.closest('[data-ordqty-all]');
  if (all) {
    ORD.qtyPick = all.checked ? new Set(ordQtyUnseenAll().map(r => r.orderNo + '|' + r.id)) : new Set();
    return ordQtyListOpen();
  }
  const p = e.target.closest('[data-ordqty-pick]');
  if (!p) return;
  const k = p.getAttribute('data-ordqty-pick');
  ORD.qtyPick = ORD.qtyPick || new Set();
  if (p.checked) ORD.qtyPick.add(k); else ORD.qtyPick.delete(k);
});

/* The window opens from the button at the top and from the Answer link on any waiting line — the two
 * places it appears, rather than a listener on the whole document. */
function ordQtyOpenClick(e) {
  const b = e.target.closest('[data-ordqtyopen]');
  if (!b) return;
  e.preventDefault();
  if (!ordQtyCanApprove()) {
    $('odMsg').className = 'err';
    $('odMsg').textContent = 'Answering a quantity change needs the Order Console.';
    return;
  }
  ordQtyListOpen();
}
$('odMsg').addEventListener('click', ordQtyOpenClick);
$('odMsg').addEventListener('click', e => { if (!e.target.closest('[data-ordmore]')) return; ORD_CAP += 600; renderOrd(); });
$('odTable').addEventListener('click', ordQtyOpenClick);

$('odKpis').addEventListener('click', ordKpiClick);
$('odKpis').addEventListener('keydown', ordKpiClick);
['odSrc', 'odBrand', 'odD1', 'odD2'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', renderOrd); });
$('odGo').onclick = async () => { await ptLoadGates(true); ORD.req = null; QC.checks = null; FGI.rows = null; await ensureOrd(); };
$('odView').addEventListener('change', () => { ORD.pick = new Set(); renderOrd(); });
/** A SKU's priority tag (P1–P4), '' when it has none. */
const ordPri = sku => { const v = (PTE.priority || {})[obUC(sku)];
  return String((v && typeof v === 'object' ? v.priority || v.value : v) || '').trim().toUpperCase(); };
