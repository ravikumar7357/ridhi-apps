/* ================= ACCESSORIES, AND THE ZIPPERS THEY PAY FOR =================
 *
 * Two parts: a master of items (a zipper's code IS its chain length — that is how the master
 * database points at it) and a ledger of movements. The balance is the ledger's sum, never a stored
 * number, same as fabric.
 *
 * THIS SCREEN REMOVES A FENCE. Until now a zip SKU could not be issued once an accessories master
 * existed: the check was ported but the CONSUMPTION was not, and letting an issue through would have
 * overstated zipper stock every single time. That consumption is now here — an issue of a zip SKU
 * writes its own OUT row — so the fence comes down and the two halves match again.
 *
 * The auto row carries `srcEntryId`, so deleting the issue takes the consumption with it. A stock
 * figure that keeps counting a zipper for an entry that no longer exists is worse than no figure.
 */
/* RETURN is not IN. Both put stock back, but a return is a thing coming BACK from the person it was
 * lent to, and "who still has it" is the sum of what went out to them less what came back. */
const ACC_SIGN = { OPENING: 1, IN: 1, OUT: -1, RETURN: 1, ADJUST: 1 };
const ACC_TYPES = ['OPENING', 'IN', 'OUT', 'RETURN', 'ADJUST'];
/* What an item is, so thread and a pair of scissors are not treated as the same kind of thing. */
const ACC_CATS = ['Zipper', 'Thread', 'Label', 'Tool', 'Packing', 'Other'];
const accCat = it => String((it && it.category) || '').trim() || 'Other';
const accUnit = it => String((it && it.unit) || '').trim() || 'pcs';
/* A tool is lent and expected back. Thread is spent. The default follows the category unless the
 * item says otherwise, because nobody wants to tick a box on four hundred reels of thread. */
const accReturnable = it => (it && it.returnable !== undefined) ? it.returnable === true : accCat(it) === 'Tool';
/* Who a movement went to, or came back from. */
const accWho = r => String((r && r.issuedTo) || '').trim();
const accSign = tt => (ACC_SIGN[tt] === undefined ? 0 : ACC_SIGN[tt]);
const accKnown = tt => ACC_SIGN[tt] !== undefined;
const accQty = r => { const n = parseFloat(r && r.qty); return isFinite(n) ? n : 0; };
const accMove = r => accQty(r) * accSign(r && r.txnType);

let ACC = { items: null, ledger: null, err: '', busy: false, at: '', shown: [] };

async function ensureAcc() {
  if (ACC.items === null) {
    ACC.busy = true; renderAcc();
    if (!PTG.masters) await ptLoadGates();
    try {
      ACC.items = ptList((PTG.masters || {}).accessories);
      ACC.ledger = ptList(await ptGet('pt_accLedger'));
      ACC.err = '';
    } catch (e) { ACC.err = e.message || String(e); ACC.items = ACC.items || []; ACC.ledger = ACC.ledger || []; }
    // The issue gate reads these two, so keep the one copy everything uses.
    PTE.acc = ACC.items; PTE.accLedger = ACC.ledger;
    ACC.at = ptStamp(); ACC.busy = false;
  }
  renderAcc();
}

const accCode = c => String(c == null ? '' : c).trim().toUpperCase();
function accBalances() {
  const b = {};
  (ACC.items || []).forEach(it => { b[accCode(it.code)] = { code: it.code, name: it.name || '',
    reorderLevel: it.reorderLevel, inQty: 0, outQty: 0, qty: 0, n: 0 }; });
  (ACC.ledger || []).forEach(r => {
    const k = accCode(r.itemCode);
    // A movement against an item nobody has entered still exists and still counts — showing it as an
    // orphan is how it gets fixed, hiding it is how the balance quietly goes wrong.
    if (!b[k]) b[k] = { code: r.itemCode || '(unknown)', name: '', orphan: true, inQty: 0, outQty: 0, qty: 0, n: 0 };
    const e = b[k], m = accMove(r);
    e.n++;
    if (m >= 0) e.inQty += m; else e.outQty += -m;
    e.qty += m;
  });
  return Object.values(b).sort((a, b2) => String(a.code).localeCompare(String(b2.code)));
}
const accLow = it => { const n = parseFloat(it && it.reorderLevel); return isFinite(n) && n > 0 ? n : 1000; };

/**
 * What is out with people, by person and item: issued less returned.
 *
 * Only OUT and RETURN count — an adjustment is a correction to the shelf, not something somebody is
 * holding. A row with nobody named is gathered under one heading rather than dropped, because stock
 * that left with no name on it is exactly the thing worth seeing.
 */
function accOutWith() {
  const by = new Map();
  (ACC.ledger || []).forEach(r => {
    if (r.txnType !== 'OUT' && r.txnType !== 'RETURN') return;
    const who = accWho(r) || '(nobody named)';
    const code = accCode(r.itemCode);
    const k = who.toLowerCase() + '|' + code;
    const it = (ACC.items || []).find(x => accCode(x.code) === code);
    const e = by.get(k) || { who, code: r.itemCode || code, name: (it && it.name) || '',
      unit: accUnit(it), cat: accCat(it), returnable: accReturnable(it),
      out: 0, back: 0, n: 0, last: '' };
    if (r.txnType === 'OUT') e.out += accQty(r); else e.back += accQty(r);
    e.n++;
    if (String(r.date || '') > e.last) e.last = String(r.date || '');
    by.set(k, e);
  });
  return [...by.values()].map(e => Object.assign(e, { held: e.out - e.back }))
    .sort((a, b) => b.held - a.held || String(a.who).localeCompare(String(b.who)));
}

function renderAcc() {
  if (ACC.busy) { $('acMsg').className = 'muted'; $('acMsg').textContent = 'Reading the accessories…'; ptEmpty('acTable', 'Loading…'); return; }
  if (ACC.err) { $('acMsg').className = 'err'; $('acMsg').textContent = 'Could not read it: ' + ACC.err; ptEmpty('acTable', 'Nothing to show.'); $('acKpis').innerHTML = ''; return; }

  const view = $('acView').value;
  const q = $('acQ').value.trim().toLowerCase();
  const cat = ($('acCat') || {}).value || '';
  /* THE DATES BELONG TO THE MOVEMENT REGISTER AND NOWHERE ELSE.
   *
   * "Stock balance" and "Who has what" are both running totals of the whole ledger — what is on the
   * shelf now, what is out in somebody's name now. Narrowing the ledger under them would still
   * produce a tidy-looking figure, and that figure would be movement-in-a-window wearing the word
   * "In stock". So the boxes are hidden on those two views rather than quietly ignored: a control
   * that is on screen and does nothing is the same lie, told more slowly. */
  const acDates = view === 'ledger';
  ['acDLab', 'acD1', 'acD2'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !acDates); });
  const [acD1, acD2] = acDates ? ptRangeOf('acD1', 'acD2') : ['', ''];
  if ($('acCat')) {
    const cats = [...new Set((ACC.items || []).map(accCat))].sort();
    const want = $('acCat').value;
    $('acCat').innerHTML = '<option value="">All kinds</option>'
      + cats.map(c => `<option value="${esc(c)}"${c === want ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('acCat').value = cats.indexOf(want) >= 0 ? want : '';
  }
  const itemOf = code => (ACC.items || []).find(x => accCode(x.code) === accCode(code));
  const inCat = code => !cat || accCat(itemOf(code)) === cat;
  const bal = accBalances().filter(b => inCat(b.code));
  const low = bal.filter(b => !b.orphan && b.qty <= accLow(b));
  const out = accOutWith().filter(e => inCat(e.code));
  const held = out.filter(e => e.held > 0);
  $('acKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Accessories</span>
      <span class="kpiwhen">read live${ACC.at ? ' · ' + esc(ACC.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf((ACC.items || []).length)}</div><div class="l">Items</div></div>
      <div class="metric"><div class="v">${nf((ACC.ledger || []).length)}</div><div class="l">Movements</div></div>
      <div class="metric"><div class="v">${nf(bal.reduce((s, b) => s + b.qty, 0))}</div><div class="l">In stock</div></div>
      <div class="metric"><div class="v" style="color:${low.length ? 'var(--bad)' : 'var(--accent)'}">${nf(low.length)}</div><div class="l">At or below re-order level</div></div>
      <div class="metric"><div class="v"${bal.some(b => b.orphan) ? ' style="color:var(--bad)"' : ''}>${nf(bal.filter(b => b.orphan).length)}</div><div class="l">Codes not in the master</div></div>
      <div class="metric pt-kpi" data-acgo="who"><div class="v">${nf(held.reduce((t, e) => t + e.held, 0))}</div><div class="l">Out with people</div></div>
      <div class="metric pt-kpi" data-acgo="who"><div class="v">${nf(new Set(held.map(e => e.who.toLowerCase())).size)}</div><div class="l">People holding something</div></div>
    </div></div>`;

  if (view === 'stock') {
    const rows = bal.filter(b => !q || [b.code, b.name].join(' ').toLowerCase().includes(q));
    ACC.shown = rows;
    const head = '<thead><tr>' + ['Code', 'Name', 'Kind', 'In', 'Out', 'Balance', 'Re-order at', 'Movements', 'Out with people', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([3, 4, 5, 6, 7, 8].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('acTable').innerHTML = head + '<tbody>' + rows.map(b => {
      const isLow = !b.orphan && b.qty <= accLow(b);
      return '<tr>'
        + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(b.code)}`
        + `${b.orphan ? ' <span class="pill pill-out">not in master</span>' : ''}</td>`
        + `<td style="text-align:left">${esc(b.name) || '<span class="muted">—</span>'}</td>`
        + `<td>${esc(accCat(itemOf(b.code)))}<div class="muted" style="font-size:10.5px">${esc(accUnit(itemOf(b.code)))}</div></td>`
        + `<td class="num" style="color:#166534">${nf(b.inQty)}</td>`
        + `<td class="num" style="color:var(--bad)">${nf(b.outQty)}</td>`
        + `<td class="num" style="font-weight:700${b.qty < 0 || isLow ? ';color:var(--bad)' : ''}">${nf(b.qty)}</td>`
        + `<td class="num muted">${b.orphan ? '—' : nf(accLow(b))}</td>`
        + `<td class="num muted">${nf(b.n)}</td>`
        /* What is out in somebody's name, for this item. The shelf says what is HERE; this says what
         * is somewhere else with a name on it, which is the difference between lost and lent. */
        + (h => `<td class="num">${h ? nf(h) : '<span class="muted">—</span>'}</td>`)(
            out.filter(e => accCode(e.code) === accCode(b.code) && e.held > 0).reduce((t, e) => t + e.held, 0))
        + `<td>${b.orphan ? '<span class="muted">—</span>'
          : `<button class="ghost" data-acc-item="${esc(b.code)}" style="padding:3px 10px;font-size:12px">Edit</button>`}</td></tr>`;
    }).join('') + '</tbody>';
  } else if (view === 'who') {
    /* ISSUED LESS RETURNED, by person. A pair of scissors is lent, not spent — this is the list you
     * read when one goes missing, and the list you hand somebody when they leave. */
    const rows = out.filter(e => !q || [e.who, e.code, e.name].join(' ').toLowerCase().includes(q));
    ACC.shown = rows;
    const head = '<thead><tr>' + ['Who', 'Code', 'Item', 'Kind', 'Issued', 'Returned', 'Still with them', 'Movements', 'Last movement', '']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([4, 5, 6, 7].indexOf(i) >= 0 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';
    $('acTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(e => '<tr>'
      + `<td class="frz" style="text-align:left;font-weight:600">${esc(e.who)}</td>`
      + `<td style="font-family:ui-monospace,monospace">${esc(e.code)}</td>`
      + `<td style="text-align:left">${esc(e.name) || '<span class="muted">—</span>'}</td>`
      + `<td>${esc(e.cat)}${e.returnable ? ' <span class="pill pill-low">comes back</span>' : ''}</td>`
      + `<td class="num">${nf(e.out)}</td>`
      + `<td class="num" style="color:#166534">${e.back ? nf(e.back) : '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="font-weight:700${e.held > 0 && e.returnable ? ';color:var(--bad)' : ''}">${nf(e.held)} <span class="muted" style="font-weight:400">${esc(e.unit)}</span></td>`
      + `<td class="num muted">${nf(e.n)}</td>`
      + `<td class="muted">${esc(e.last) || '—'}</td>`
      + `<td>${e.held > 0 && e.who !== '(nobody named)'
        ? `<button class="ghost" data-acc-ret="${esc(e.who)}|${esc(e.code)}" style="padding:3px 10px;font-size:12px">Take back</button>`
        : '<span class="muted">—</span>'}</td></tr>`).join('')
      : `<tr><td colspan="10" class="muted" style="padding:16px">Nothing is out with anybody${cat ? ' in ' + esc(cat) : ''} — every issue has come back, or none has a name on it yet.</td></tr>`) + '</tbody>';
  } else {
    const rows = (ACC.ledger || [])
      .filter(r => inCat(r.itemCode))
      .filter(r => ptInRange(r && r.date, acD1, acD2))
      .filter(r => !q || [r.itemCode, r.ref, r.remarks, r.issuedTo].join(' ').toLowerCase().includes(q))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b._id || '').localeCompare(String(a._id || '')));
    ACC.shown = rows;
    const head = '<thead><tr>' + ['Date', 'Movement', 'Item', 'Qty', 'Effect', 'Issued to / back from', 'Reference', 'Remarks', 'Entered by', 'Edit']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 || i === 4 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    $('acTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => {
      const m = accMove(r);
      return '<tr>'
        + `<td class="frz" style="text-align:left">${esc(r.date)}</td>`
        + `<td>${esc(r.txnType)}${accKnown(r.txnType) ? '' : ' <span class="pill pill-out">unknown</span>'}`
        + `${r.auto ? ' <span class="pill pill-ok">auto</span>' : ''}</td>`
        + `<td style="font-family:ui-monospace,monospace">${esc(r.itemCode)}</td>`
        + `<td class="num">${nf(accQty(r))}</td>`
        + `<td class="num" style="font-weight:700;color:${m > 0 ? '#166534' : (m < 0 ? 'var(--bad)' : 'var(--muted)')}">${m > 0 ? '+' : ''}${nf(m)}</td>`
        /* WHO. An issue with no name on it is stock that walked out of the door unattributed, so it
         * is said in as many words rather than left as an empty cell. */
        + `<td style="text-align:left">${accWho(r) ? esc(accWho(r))
          : ((r.txnType === 'OUT' || r.txnType === 'RETURN') ? '<span class="err">nobody named</span>' : '<span class="muted">—</span>')}</td>`
        + `<td style="text-align:left">${esc(r.ref) || '<span class="muted">—</span>'}</td>`
        + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
        + `<td style="text-align:left">${esc(String(r.createdBy || '').split('@')[0])}</td>`
        /* An automatic row belongs to its issue; editing it here would put the two out of step. */
        + `<td>${r.auto ? '<span class="muted">auto</span>'
          : `<button class="ghost" data-acc-txn="${esc(r._id)}" style="padding:3px 10px;font-size:12px">Edit</button>`}</td></tr>`;
    }).join('') + '</tbody>';
  }

  $('acMsg').className = 'muted';
  $('acMsg').textContent = `${nf(ACC.shown.length)} row(s)`
    + ((ACC.items || []).length ? '' : ' · no accessories master yet');
  $('acMsg').title = 'The balance is the sum of the ledger, never a stored figure.'
    + ((ACC.items || []).length ? '' : ' Add an item to start tracking zipper stock.');
}

/**
 * Two rights, the same split Finished Goods already uses.
 *
 * Recording what left the shelf is the store's daily work — a zipper issue, a cutter lent out, a
 * reel of thread gone to Packing. CHANGING one somebody already recorded moves a balance that other
 * figures are built on, and is a different question about a different person. A vendor never has
 * either: this is the company's own store.
 */
const accCanEntry = () => !spIsVendor() && !!(ME.admin || ME.accEdit || ME.accEntry);
const accCanEdit = () => !spIsVendor() && !!(ME.admin || ME.accEdit);
const ACC_NO_ENTRY = 'Recording an accessory movement needs permission. Ask an admin to switch on '
  + '"Can record accessory movements" for your account.';
const ACC_NO_EDIT = 'Changing the accessories record needs permission. Ask an admin to switch on '
  + '"Can edit accessories" for your account — you may still record movements.';

/**
 * Write the accessories list — merged with what the database holds NOW.
 *
 * The list is one array, saved whole. Saving whatever this browser held meant a browser holding an
 * empty or stale copy wrote that copy back: on 22 Sep "New accessory" turned a list of seven into a
 * list of one, the six zippers vanished from it, and every zipper deduction after that failed. So the
 * list is read again first, and any item on it that this save did not mean to remove is kept.
 *
 * `removed` names the codes this save really does take away — a delete, or a code renamed.
 */
async function accSaveItems(removed) {
  let fresh;
  try { fresh = ptList(await ptGet('pt_masters/accessories')); }
  catch (e) { throw new Error('Could not read the accessories list to save it safely: ' + (e.message || e)); }
  const gone = new Set((removed || []).map(accCode));
  const mine = new Set((ACC.items || []).map(it => accCode(it && it.code)));
  const kept = (fresh || []).filter(it => it && it.code != null && !mine.has(accCode(it.code)) && !gone.has(accCode(it.code)));
  if (kept.length) ACC.items = (ACC.items || []).concat(kept);
  return ptPut('pt_masters/accessories', ACC.items);
}

const ACC_CSV_HEAD = ['Code', 'Name', 'Kind', 'Unit', 'Re-order level', 'Movement', 'Qty', 'Date', 'Issued to', 'Reference', 'Remarks'];

/**
 * Read an accessories file. One line is one movement, and a code the master has never heard of
 * becomes an item — which is the whole point: four hundred thread shades are not going to be typed
 * into a dialog one at a time.
 *
 * A line with no movement on it is an ITEM ONLY: it puts the thing on the list without pretending
 * any stock arrived.
 */
function accCsvRows(text) {
  const grid = parseCsv(text);
  if (!grid.length) return { rows: [], bad: ['The file is empty.'] };
  const head = grid[0].map(h => String(h || '').trim().toLowerCase());
  const ix = n => head.indexOf(String(n).toLowerCase());
  if (ix('Code') < 0) return { rows: [], bad: ['The file needs a Code column.'] };
  const rows = [], bad = [];
  grid.slice(1).forEach((r, i) => {
    const line = i + 2;                       // the header is line 1, as a spreadsheet counts
    if (!r.some(c => String(c || '').trim())) return;
    const get = n => { const k = ix(n); return k < 0 ? '' : String(r[k] == null ? '' : r[k]).trim(); };
    const code = get('Code');
    if (!code) { bad.push(`Line ${line}: no code.`); return; }
    const kindRaw = get('Movement').toUpperCase();
    const txnType = kindRaw ? (ACC_TYPES.indexOf(kindRaw) >= 0 ? kindRaw : '') : '';
    if (kindRaw && !txnType) { bad.push(`Line ${line}: "${get('Movement')}" is not one of ${ACC_TYPES.join(', ')}.`); return; }
    const qtyRaw = get('Qty');
    const qty = qtyRaw === '' ? null : parseFloat(qtyRaw);
    if (txnType && (qty === null || !isFinite(qty) || qty === 0)) { bad.push(`Line ${line}: "${qtyRaw}" is not a quantity.`); return; }
    if (txnType && qty < 0 && txnType !== 'ADJUST') { bad.push(`Line ${line}: only an adjustment can be negative.`); return; }
    const who = get('Issued to');
    if ((txnType === 'OUT' || txnType === 'RETURN') && !who) { bad.push(`Line ${line}: an ${txnType} needs a name in "Issued to".`); return; }
    const cat = get('Kind');
    if (cat && !ACC_CATS.some(c => c.toLowerCase() === cat.toLowerCase())) {
      bad.push(`Line ${line}: "${cat}" is not one of ${ACC_CATS.join(', ')}.`); return;
    }
    rows.push({ line, code, name: get('Name'),
      category: cat ? ACC_CATS.find(c => c.toLowerCase() === cat.toLowerCase()) : '',
      unit: get('Unit'), reorderLevel: get('Re-order level'),
      txnType, qty, date: get('Date') || dToday(), issuedTo: who,
      ref: get('Reference'), remarks: get('Remarks'),
      isNew: !(ACC.items || []).some(x => accCode(x.code) === accCode(code)) });
  });
  return { rows, bad };
}

/**
 * Write the file. Items first, in ONE save — a hundred separate writes to the same master row is a
 * hundred chances for two of them to overwrite each other — then the movements in one patch.
 */
async function accCsvRun(rows) {
  if (!accCanEdit()) throw new Error(ACC_NO_EDIT);
  const items = (ACC.items || []).slice();
  const seen = new Map(items.map((x, i) => [accCode(x.code), i]));
  rows.forEach(r => {
    const k = accCode(r.code);
    const at = seen.get(k);
    const was = at === undefined ? null : items[at];
    /* A blank column leaves what is already there alone — a movement file is not a chance to wipe
     * the names off every item it mentions. */
    const rec = {
      code: was ? was.code : r.code,
      name: r.name || (was && was.name) || '',
      category: r.category || (was && was.category) || (/^\d+$/.test(String(r.code).trim()) ? 'Zipper' : 'Other'),
      unit: r.unit || (was && was.unit) || 'pcs',
      reorderLevel: r.reorderLevel !== '' ? mdbNum(r.reorderLevel) : (was ? was.reorderLevel : null),
    };
    if (was && was.returnable !== undefined) rec.returnable = was.returnable;
    if (at === undefined) { seen.set(k, items.length); items.push(rec); } else items[at] = rec;
  });
  ACC.items = items;
  await accSaveItems();
  PTE.acc = ACC.items;
  if (PTG.masters) PTG.masters.accessories = ACC.items;

  const moves = rows.filter(r => r.txnType);
  const upd = {}, recs = [];
  moves.forEach((r, i) => {
    const rec = { _id: 'acc_csv_' + Date.now().toString(36) + '_' + i, txnType: r.txnType,
      itemCode: r.code, qty: r.qty, date: r.date, issuedTo: r.issuedTo,
      ref: r.ref, remarks: r.remarks, createdBy: ME.email, createdAt: new Date().toISOString() };
    upd['pt_accLedger/' + rec._id] = rec; recs.push(rec);
  });
  if (recs.length) await ptPatch(upd);
  ACC.ledger = (ACC.ledger || []).concat(recs);
  PTE.accLedger = ACC.ledger;
  return { items: rows.filter(r => r.isNew).length, moves: recs.length };
}

$('acTemplate').onclick = () => ptDownload('accessories-template', [ACC_CSV_HEAD.map(csvCell).join(','),
  ['T-WHITE', 'Thread White', 'Thread', 'reel', '50', 'OPENING', '200', dToday(), '', '', 'opening stock'].map(csvCell).join(','),
  ['CUTTER-01', 'Rotary cutter', 'Tool', 'pcs', '2', 'OUT', '1', dToday(), 'Ramesh', '', 'given for the week'].map(csvCell).join(','),
  ['L-CARE', 'Care label', 'Label', 'pcs', '5000', '', '', '', '', '', 'item only — no movement'].map(csvCell).join(',')]);

$('acImport').onclick = () => $('acFile').click();
$('acFile').onchange = async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  const { rows, bad } = accCsvRows(text);
  const fresh = rows.filter(r => r.isNew);
  const moves = rows.filter(r => r.txnType);
  ptOpenDialog({
    title: 'Bulk upload — ' + file.name,
    subtitle: `${nf(rows.length)} line(s) read${bad.length ? `, ${nf(bad.length)} it cannot read` : ''}`,
    note: 'Nothing is written until you press Upload. A code the master has not seen becomes a new '
      + 'item; a line with no Movement only adds the item, without pretending any stock arrived. '
      + 'Blank columns leave what is already on an item alone.',
    html: `<div style="display:grid;gap:10px">
      <div class="ptnote"><b>${nf(fresh.length)}</b> new item(s) · <b>${nf(moves.length)}</b> movement(s)${
        moves.length ? ' · ' + Object.entries(moves.reduce((m, r) => (m[r.txnType] = (m[r.txnType] || 0) + 1, m), {}))
          .map(([k, n]) => `${nf(n)} × ${k}`).join(', ') : ''}</div>
      ${bad.length ? `<div class="err" style="white-space:normal">${bad.slice(0, 8).map(esc).join('<br>')}${
        bad.length > 8 ? `<br>…and ${nf(bad.length - 8)} more` : ''}</div>` : ''}
      ${rows.length ? `<div class="xlwrap" style="max-height:40vh;border:1px solid var(--line);border-radius:8px">
        <table class="xl"><thead><tr>${['Line', 'Code', 'Name', 'Kind', 'Movement', 'Qty', 'Issued to']
          .map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 200).map(r => `<tr>
          <td>${nf(r.line)}</td>
          <td style="text-align:left;font-family:ui-monospace,monospace">${esc(r.code)}${r.isNew ? ' <span class="pill pill-low">new</span>' : ''}</td>
          <td style="text-align:left">${esc(r.name)}</td><td>${esc(r.category)}</td>
          <td>${esc(r.txnType) || '<span class="muted">item only</span>'}</td>
          <td class="num">${r.qty == null ? '<span class="muted">—</span>' : nf(r.qty)}</td>
          <td style="text-align:left">${esc(r.issuedTo)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`,
    saveLabel: rows.length ? `Upload ${nf(rows.length)} line(s)` : '',
    onSave: async () => {
      if (!rows.length) return 'There is nothing to upload.';
      let res;
      try { res = await accCsvRun(rows); } catch (err) { return 'Not written: ' + (err.message || err); }
      renderAcc();
      $('acMsg').className = 'muted';
      $('acMsg').textContent = `${nf(res.items)} new item(s) and ${nf(res.moves)} movement(s) uploaded from ${file.name}.`;
      return '';
    },
  });
};

/**
 * Names worth offering when something is issued: everybody who has been given something before, and
 * everybody on the employee list. Offered, not enforced — "Packing" and "Cutting" are perfectly good
 * answers and are on no employee list.
 */
function accWhoList() {
  const out = new Set();
  (ACC.ledger || []).forEach(r => { const w = accWho(r); if (w) out.add(w); });
  (PTE.emp || []).forEach(e => { const n = String((e && e[1]) || '').trim(); if (n) out.add(n); });
  return [...out];
}

/** One accessory row, from the dialog. Kept in one place so New and Edit cannot drift apart. */
function accItemRec(v, code) {
  const rec = { code, name: String(v.name || '').trim(), reorderLevel: mdbNum(v.reorderLevel),
    category: ACC_CATS.indexOf(String(v.category || '').trim()) >= 0 ? String(v.category).trim() : 'Other',
    unit: String(v.unit || '').trim() || 'pcs' };
  /* "follow the kind" is the absence of an answer, not an answer — a tool comes back, thread does
   * not, and only somebody overriding that writes a flag. */
  const ret = String(v.returnable || '').trim();
  if (/^yes/.test(ret)) rec.returnable = true;
  else if (/^no/.test(ret)) rec.returnable = false;
  return rec;
}

$('acNewItem').onclick = () => {
  if (!accCanEdit()) { $('acMsg').className = 'err'; $('acMsg').textContent = ACC_NO_EDIT; return; }
  ptOpenDialog({
  title: 'New accessory',
  note: 'For a zipper the CODE must be its chain length — that is what a SKU points at in the master '
    + 'database, and how an issue knows which zipper it uses.',
  fields: [
    { key: 'code', label: 'Code', value: '' },
    { key: 'name', label: 'Name', value: '' },
    { key: 'category', label: 'Kind', type: 'select', options: ACC_CATS, value: 'Other' },
    { key: 'unit', label: 'Unit', value: 'pcs' },
    { key: 'reorderLevel', label: 'Re-order level', type: 'number', step: '1', value: '' },
    { key: 'returnable', label: 'Comes back?', type: 'select', options: ['follow the kind', 'yes — it is lent', 'no — it is used up'], value: 'follow the kind', span: true },
  ],
  onSave: async v => {
    if (!accCanEdit()) return ACC_NO_EDIT;
    const code = String(v.code || '').trim();
    if (!code) return 'Enter the code.';
    if ((ACC.items || []).some(x => accCode(x.code) === accCode(code))) return `${code} already exists.`;
    ACC.items = (ACC.items || []).concat([accItemRec(v, code)]);
    await accSaveItems();
    PTE.acc = ACC.items;
    if (PTG.masters) PTG.masters.accessories = ACC.items;
    renderAcc();
    return '';
  },
  });
};

/**
 * Bring a lent thing back: a RETURN for what that person still holds, filled in and ready to change.
 * The whole amount is offered because most of the time all of it comes back — and when it does not,
 * the number is right there to correct.
 */
function accTakeBack(who, code) {
  if (!accCanEntry()) { $('acMsg').className = 'err'; $('acMsg').textContent = ACC_NO_ENTRY; return; }
  const e = accOutWith().find(x => x.who === who && accCode(x.code) === accCode(code));
  if (!e || e.held <= 0) { $('acMsg').className = 'muted'; $('acMsg').textContent = 'Nothing is out with ' + who + ' for that item.'; return; }
  ptOpenDialog({
    title: 'Take it back',
    subtitle: `${e.who}  ·  ${e.code}${e.name ? ' — ' + e.name : ''}`,
    note: `${nf(e.out)} issued, ${nf(e.back)} already back, so ${nf(e.held)} ${e.unit} is still with them. `
      + 'Enter what is actually coming back — the rest stays out in their name.',
    fields: [
      { key: 'qty', label: 'Coming back', type: 'number', step: 'any', value: e.held },
      { key: 'date', label: 'Date', type: 'date', value: dToday() },
      { key: 'remarks', label: 'Remarks', value: '', span: true },
    ],
    saveLabel: 'Take it back',
    onSave: async v => {
      const q = parseFloat(v.qty);
      if (!isFinite(q) || q <= 0) return 'Enter how much is coming back.';
      if (q > e.held) return `Only ${nf(e.held)} ${e.unit} is out with ${e.who} — more than that cannot come back.`;
      if (!String(v.date || '').trim()) return 'Enter the date.';
      const rec = { _id: 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        txnType: 'RETURN', itemCode: e.code, qty: q, date: v.date,
        issuedTo: e.who, ref: '', remarks: String(v.remarks || '').trim(),
        createdBy: ME.email, createdAt: new Date().toISOString() };
      await ptPut('pt_accLedger/' + rec._id, rec);
      ACC.ledger = (ACC.ledger || []).concat(rec);
      PTE.accLedger = ACC.ledger;
      renderAcc();
      $('acMsg').className = 'muted';
      $('acMsg').textContent = `${nf(q)} ${e.unit} of ${e.code} taken back from ${e.who}.`;
      return '';
    },
  });
}

function accEditItem(code) {
  if (!accCanEdit()) { $('acMsg').className = 'err'; $('acMsg').textContent = ACC_NO_EDIT; return; }
  const i = (ACC.items || []).findIndex(x => accCode(x.code) === accCode(code));
  const it = (ACC.items || [])[i]; if (!it) return;
  const used = (ACC.ledger || []).filter(r => accCode(r.itemCode) === accCode(code)).length;
  ptOpenDialog({
    title: 'Edit accessory',
    subtitle: `${it.code}${it.name ? '  ·  ' + it.name : ''}`,
    note: used ? `${nf(used)} movement(s) are recorded against this code.` : 'No movements against it yet.',
    fields: [
      { key: 'code', label: 'Code', value: it.code, readonly: used > 0 },
      { key: 'name', label: 'Name', value: it.name || '' },
      { key: 'category', label: 'Kind', type: 'select', options: ACC_CATS, value: accCat(it) },
      { key: 'unit', label: 'Unit', value: accUnit(it) },
      { key: 'reorderLevel', label: 'Re-order level', type: 'number', step: '1', value: it.reorderLevel == null ? '' : it.reorderLevel },
      { key: 'returnable', label: 'Comes back?', type: 'select', options: ['follow the kind', 'yes — it is lent', 'no — it is used up'],
        value: it.returnable === true ? 'yes — it is lent' : (it.returnable === false ? 'no — it is used up' : 'follow the kind'), span: true },
    ],
    deleteWhat: `the accessory ${it.code}${it.name ? ' (' + it.name + ')' : ''}`,
    onSave: async v => {
      /* Renaming a code that movements point at would orphan every one of them, so it is locked. */
      const code = used ? it.code : String(v.code || '').trim();
      if (!code) return 'Enter the code.';
      ACC.items[i] = accItemRec(v, code);
      await accSaveItems(accCode(code) !== accCode(it.code) ? [it.code] : []);
      PTE.acc = ACC.items;
      if (PTG.masters) PTG.masters.accessories = ACC.items;
      renderAcc();
      return '';
    },
    onDelete: async () => {
      if (used) return `${it.code} cannot be removed — ${nf(used)} movement(s) point at it.`;
      ACC.items = ACC.items.filter((_, j) => j !== i);
      await accSaveItems([it.code]);
      PTE.acc = ACC.items;
      if (PTG.masters) PTG.masters.accessories = ACC.items;
      renderAcc();
      return '';
    },
  });
}

function accTxnFields(r) {
  const codes = (ACC.items || []).map(x => x.code).filter(Boolean);
  return [
    { key: 'txnType', label: 'Movement', type: 'select', value: r ? r.txnType : 'IN', options: ACC_TYPES },
    { key: 'itemCode', label: 'Item', type: 'select', value: r ? r.itemCode : '', options: [''].concat([...new Set([(r || {}).itemCode].filter(Boolean).concat(codes))]) },
    { key: 'qty', label: 'Quantity', type: 'number', step: '1', value: r ? accQty(r) : '' },
    { key: 'date', label: 'Date', type: 'date', value: r ? (r.date || '') : dToday() },
    /* WHO IT WENT TO. Typed, not picked: a cutter goes to a karigar, a reel of thread goes to a
     * department, and a label goes to packing — no one list has all three. */
    { key: 'issuedTo', label: 'Issued to / back from', value: r ? (r.issuedTo || '') : '', list: accWhoList() },
    { key: 'ref', label: 'Reference', value: r ? (r.ref || '') : '' },
    { key: 'remarks', label: 'Remarks', value: r ? (r.remarks || '') : '', span: true },
  ];
}
function accTxnCheck(v, exceptId) {
  if (!String(v.itemCode || '').trim()) return 'Pick the item.';
  const q = parseFloat(v.qty);
  if (!isFinite(q) || q === 0) return 'Enter a quantity.';
  /* Only an adjustment may be negative — a negative receipt or issue is somebody using the wrong
   * movement type, and it would read as the opposite of what happened. */
  if (q < 0 && v.txnType !== 'ADJUST') return 'Only an adjustment can carry a negative quantity.';
  if (!String(v.date || '').trim()) return 'Enter the date.';
  /* An issue with nobody's name on it is stock leaving the building unaccounted for, and a return
   * from nobody cannot be matched against anything. */
  if ((v.txnType === 'OUT' || v.txnType === 'RETURN') && !String(v.issuedTo || '').trim())
    return v.txnType === 'OUT' ? 'Say who it is being issued to.' : 'Say who it is coming back from.';
  /* NOTHING LEAVES A SHELF THAT HAS NOT GOT IT. The same rule the zipper gate applies, put on the
   * movement anybody can type — an issue of 150 against 139 is 150 pieces that are not there.
   *
   * An adjustment is held to it as well. A correction that lands below nought is not a correction:
   * the shelf cannot hold less than nothing, and the figure it produces is one nobody can act on.
   * Adjusting UPWARDS out of a shortfall is exactly how this gets fixed, and stays allowed. */
  const move = accMove({ txnType: v.txnType, qty: q });
  if (move < 0) {
    const bal = ptAccBalance(String(v.itemCode).trim(), exceptId);
    if (bal + move < 0)
      return `${v.txnType === 'OUT' ? 'Cannot issue' : 'Cannot adjust by'} ${nf(Math.abs(move))} — `
        + `"${String(v.itemCode).trim()}" has ${nf(bal)} in stock${bal < 0 ? ' (already short)' : ''}. `
        + `That would leave ${nf(bal + move)}. Take in stock first.`;
  }
  return '';
}

$('acNewTxn').onclick = () => {
  if (!accCanEntry()) { $('acMsg').className = 'err'; $('acMsg').textContent = ACC_NO_ENTRY; return; }
  ptOpenDialog({
  title: 'New accessory movement',
  note: 'Opening and In add to stock, Out takes away, and an Adjustment carries its own sign — so a '
    + 'correction of −20 is entered as −20.',
  fields: accTxnFields(null),
  onSave: async v => {
    if (!accCanEntry()) return ACC_NO_ENTRY;
    const err = accTxnCheck(v); if (err) return err;
    const rec = { _id: 'acc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      txnType: v.txnType, itemCode: String(v.itemCode).trim(), qty: parseFloat(v.qty),
      date: v.date, ref: String(v.ref || '').trim(), remarks: String(v.remarks || '').trim(),
      issuedTo: String(v.issuedTo || '').trim(),
      createdBy: ME.email, createdAt: new Date().toISOString() };
    await ptPut('pt_accLedger/' + rec._id, rec);
    ACC.ledger = (ACC.ledger || []).concat(rec);
    PTE.accLedger = ACC.ledger;
    renderAcc();
    return '';
  },
  });
};

function accEditTxn(id) {
  if (!accCanEdit()) { $('acMsg').className = 'err'; $('acMsg').textContent = ACC_NO_EDIT; return; }
  const r = (ACC.ledger || []).find(x => x._id === id); if (!r) return;
  ptOpenDialog({
    title: 'Edit accessory movement',
    subtitle: `${r.txnType} · ${r.itemCode} · ${r.date}`,
    fields: accTxnFields(r),
    deleteWhat: `${r.txnType} of ${nf(accQty(r))} × ${r.itemCode} on ${r.date}`,
    onSave: async v => {
      /* Its own id is passed so the row being changed does not count against itself. */
      const err = accTxnCheck(v, r._id); if (err) return err;
      const next = Object.assign({}, r, { txnType: v.txnType, itemCode: String(v.itemCode).trim(),
        qty: parseFloat(v.qty), date: v.date, ref: String(v.ref || '').trim(),
        remarks: String(v.remarks || '').trim(), editedBy: ME.email, editedAt: new Date().toISOString() });
      delete next._key;
      await ptPut('pt_accLedger/' + r._id, next);
      ACC.ledger = ACC.ledger.map(x => (x._id === r._id ? next : x));
      PTE.accLedger = ACC.ledger;
      renderAcc();
      return '';
    },
    onDelete: async () => {
      await ptDelete('pt_accLedger/' + r._id);
      ACC.ledger = ACC.ledger.filter(x => x._id !== r._id);
      PTE.accLedger = ACC.ledger;
      renderAcc();
      return '';
    },
  });
}

$('acTable').addEventListener('click', e => {
  const a = e.target.closest('[data-acc-item]'); if (a) return accEditItem(a.getAttribute('data-acc-item'));
  const b = e.target.closest('[data-acc-txn]'); if (b) return accEditTxn(b.getAttribute('data-acc-txn'));
  const c = e.target.closest('[data-acc-ret]');
  if (c) {
    /* The name is split off the LAST bar, because a person's name may contain one and an accessory
     * code may not. */
    const v = c.getAttribute('data-acc-ret'), at = v.lastIndexOf('|');
    return accTakeBack(v.slice(0, at), v.slice(at + 1));
  }
});
['acView', 'acCat'].forEach(id => $(id).addEventListener('change', renderAcc));
/* The two cards about what is out with people open the view that shows it. */
$('acKpis').addEventListener('click', e => {
  const k = e.target.closest('[data-acgo]');
  if (!k) return;
  $('acView').value = k.getAttribute('data-acgo');
  renderAcc();
});
['acD1', 'acD2'].forEach(id => $(id).addEventListener('change', renderAcc));
$('acClear').onclick = () => {
  ['acQ', 'acD1', 'acD2'].forEach(id => $(id).value = '');
  if ($('acCat')) $('acCat').value = '';
  renderAcc();
};
ptDebounce('acQ', renderAcc);
$('acGo').onclick = async () => { ACC.items = null; await ptLoadGates(true); await ensureAcc(); };
$('acExport').onclick = () => {
  const view = $('acView').value, rows = ACC.shown || []; if (!rows.length) return;
  const itemOf = code => (ACC.items || []).find(x => accCode(x.code) === accCode(code));
  if (view === 'who') {
    ptDownload('accessories-out-with-people',
      [['Who', 'Code', 'Item', 'Kind', 'Unit', 'Issued', 'Returned', 'Still with them', 'Movements', 'Last movement']
        .map(csvCell).join(',')].concat(rows.map(e =>
        [e.who, e.code, e.name, e.cat, e.unit, e.out, e.back, e.held, e.n, e.last].map(csvCell).join(','))));
    return;
  }
  const stock = view === 'stock';
  const head = stock ? ['Code', 'Name', 'Kind', 'Unit', 'In', 'Out', 'Balance', 'Re-order at', 'Movements']
    : ['Date', 'Movement', 'Item', 'Qty', 'Effect', 'Issued to / back from', 'Reference', 'Remarks', 'Entered by'];
  const body = stock
    ? rows.map(b => { const it = itemOf(b.code);
        return [b.code, b.name, accCat(it), accUnit(it), b.inQty, b.outQty, b.qty, b.orphan ? '' : accLow(b), b.n]; })
    : rows.map(r => [r.date, r.txnType, r.itemCode, accQty(r), accMove(r), accWho(r), r.ref, r.remarks, r.createdBy]);
  ptDownload(stock ? 'accessories-stock' : 'accessories-ledger',
    [head.map(csvCell).join(',')].concat(body.map(b => b.map(csvCell).join(','))));
};

/* ---- the consumption that lets the fence come down ---- */

/** Post the zipper OUT for one Base Data issue. Silent when the SKU has no zip. */
/**
 * What goes to the karigar WITH the pieces: zippers off the accessories shelf, ruffle cloth off the
 * fabric ledger. Worked out, never written — ptConsumeZippers and ptConsumeRuffle do the writing,
 * and both read the same master fields, so the preview cannot promise something the save will not do.
 *
 * Returns [] for a SKU that takes neither, which is most of them.
 */
function bdMaterialsFor(sku, pcs) {
  const m = cutSkuOf(sku);
  const n = parseInt(pcs, 10) || 0;
  if (!m || n <= 0) return [];
  const out = [];

  if (m.isZip === true) {
    const chain = m.chainLength;
    if (chain == null || isNaN(parseFloat(chain))) {
      out.push({ kind: 'zip', why: 'this is a zip SKU but its master row has no chain length, so no zipper can be deducted' });
    } else {
      const per = mdbZipQty(m);
      const item = (PTE.acc || []).find(it => accCode(it.code) === accCode(chain));
      /* The shelf figure, where the accessories ledger has been read. Silence is not zero: a stock
       * that has not been loaded must not read as "none left". */
      /* accBalances() is a LIST, one row per accessory — not a map. Reading it as a map answered
       * undefined for every item and would have shown every shelf as empty. */
      const shelf = (ACC.ledger || PTE.accLedger)
        ? (accBalances() || []).find(x => accCode(x.code) === accCode(chain)) : null;
      const have = shelf ? ptNum(shelf.qty) : null;
      out.push({ kind: 'zip', what: `Zipper ${chain} inch`, qty: n * per, unit: 'pcs',
        per, have, missing: !item });
    }
  }

  if (ptIsRuffle(m)) {
    const r = ptRuffleOf(m);
    if (!r) {
      out.push({ kind: 'ruffle', why: `no ruffle metres for ${m.subtype || '?'} ${m.size || '?'} — fill Ruffle metres and Ruffle fabric in its recipe` });
    } else {
      out.push({ kind: 'ruffle', what: r.fabric, qty: Math.round(n * r.meters * 100) / 100, unit: 'm',
        per: r.meters, have: null });
    }
  }
  return out;
}

/** The same thing in one line, for a form or a row. */
function bdMaterialsTxt(sku, pcs) {
  const list = bdMaterialsFor(sku, pcs);
  if (!list.length) return '';
  return list.map(x => x.why
    ? '⚠ ' + x.why
    : `${nf(x.qty)} ${x.unit} ${x.what}`
      + (x.have != null ? ` (shelf ${nf(x.have)})` : '')
      + (x.missing ? ' — not on the accessories list yet' : '')).join(' · ');
}

async function ptConsumeZippers(entry) {
  const m = cutSkuOf(entry.sku);
  if (!m || m.isZip !== true) return '';
  const chain = m.chainLength;
  if (chain == null || isNaN(parseFloat(chain))) return '';
  /* The entry wins where it has one. Not a second opinion about the master row — a record of what
   * the store actually handed over, which is the only figure the shelf will agree with. */
  const said = parseFloat(entry.zipsIssued);
  const need = isFinite(said) && said >= 0 ? said : (parseInt(entry.issuePieces, 10) || 0) * mdbZipQty(m);
  if (need <= 0) return '';
  const item = accListNow().find(it => accCode(it.code) === accCode(chain));
  const added = '';
  /* THE LAST GATE, and the one no caller can go around. ptZipCheck stops this at the form, but a
   * deduction that writes itself is a deduction that can arrive from somewhere else later — and the
   * whole −150 happened through this function, not through a typed movement.
   *
   * The automatic add that used to sit here is gone. It created the item, let the issue through, and
   * left the stock to go negative "until somebody enters what is on the shelf" — which is exactly
   * what nobody did for four days. A length nobody has stocked is now refused by name. */
  if (!item)
    throw new Error(`Zipper "${chain}" is not on the accessories list. Add it in Accessories and enter `
      + `what is on the shelf before issuing this SKU.`);
  if (ptAccBalance(item.code) - need < 0)
    throw new Error(`Zipper "${item.code}" has ${nf(ptAccBalance(item.code))} in stock and this issue needs `
      + `${nf(need)}. Take in stock first.`);
  const rec = { _id: 'acc_auto_' + entry.id, txnType: 'OUT', itemCode: item.code, qty: need,
    date: String(entry.issueDate || '').slice(0, 10) || dToday(),
    /* The karigar's name as a FIELD, not only inside the sentence below — "who has what" reads the
     * field, and a zipper issue is an issue to a person like any other. */
    issuedTo: String(entry.empName || '').trim(),
    ref: 'AUTO · ' + entry.sku,
    remarks: `Automatic zipper consumption — ${nf(entry.issuePieces)} piece(s) issued to ${entry.empName || ''}`,
    auto: true, srcEntryId: entry.id, createdBy: ME.email, createdAt: new Date().toISOString() };
  await ptPut('pt_accLedger/' + rec._id, rec);
  if (ACC.ledger) { ACC.ledger = ACC.ledger.filter(r => r._id !== rec._id).concat(rec); PTE.accLedger = ACC.ledger; }
  else if (PTE.accLedger) PTE.accLedger = PTE.accLedger.filter(r => r._id !== rec._id).concat(rec);
  return added;
}

/* ---- ruffle fabric ----
 *
 * The strip on a ruffle product is cut from a fabric of its own, and how much goes on a piece depends
 * on the subtype and the size — not the colour. So the rule lives per subtype and size, and 64 of
 * them cover the 818 ruffle SKUs.
 */

/** Is this a ruffle product? The subtype says so on 818 SKUs; the flag says so on four. */
const ptIsRuffle = m => !!(m && (m.isRuffle === true || /ruffle/i.test(String(m.subtype || ''))));

/** The rules: [{ subtype, size, fabric, meters }], in pt_masters/ruffleRule. */
const ptRuffleRules = () => ptList((PTG.masters || {}).ruffleRule).filter(Boolean);
const ptRufKey = (sub, size) => String(sub || '').trim().toLowerCase() + '|'
  + String(size || '').trim().toLowerCase().replace(/\s+/g, '');

/**
 * What ruffle a SKU takes: its own figures if the master row has them, else its RECIPE (article ·
 * subtype · size), else the older ruffle rule for its subtype and size. Null when none says — which is
 * reported, not guessed. A SKU that has its own metres but no cloth (or the other way round) takes the
 * missing half from the recipe: what it did say is still what counts.
 */
function ptRuffleOf(m) {
  if (!ptIsRuffle(m)) return null;
  const ownFab = String(m.ruffleFabric || '').trim(), ownM = parseFloat(m.ruffleMeters);
  if (ownFab && ownM > 0) return { fabric: ownFab, meters: ownM, from: 'sku' };
  /* THE RECIPE (Ravi, 2026-09-24): filled once per product and size, it is where the ruffle metres now
   * live — the SKU rows were imported without them. */
  const rec = typeof recipeOf === 'function' ? recipeOf(m) : null;
  if (rec && recNorm(rec.isRuffle) !== 'no') {
    const rm = ownM > 0 ? ownM : parseFloat(rec.ruffleMeters), rf = ownFab || String(rec.ruffleFabric || '').trim();
    if (rf && rm > 0) return { fabric: rf, meters: Math.round(rm * 100) / 100, from: 'recipe' };
  }
  const r = ptRuffleRules().find(x => ptRufKey(x.subtype, x.size) === ptRufKey(m.subtype, m.size));
  const rm = r ? parseFloat(r.meters) : NaN;
  if (r && String(r.fabric || '').trim() && rm > 0) return { fabric: String(r.fabric).trim(), meters: rm, from: 'rule' };
  return null;
}

/**
 * Take the ruffle fabric off the fabric ledger when a ruffle piece goes to the tailor.
 *
 * Keyed on the Base Data row, like the zippers: saving the same issue twice cannot deduct twice, and
 * deleting the issue gives the cloth back.
 */
/** The recipes and this SKU's row, read again from the database, then its ruffle. Null if still none. */
async function ptRuffleFresh(m) {
  try {
    const key = m && (m._key || (m.sku ? 'mdb_' + m.sku : ''));
    const [rec, row] = await Promise.all([ptGet('pt_masters/recipe'), key ? ptGet('pt_masterDB/' + key) : null]);
    if (rec) { PTG.masters = Object.assign({}, PTG.masters || {}, { recipe: rec }); RECIPE_IX = { src: null, map: null }; PTG.recipeAt = Date.now(); }
    if (row && typeof row === 'object') Object.assign(m, mdbYnFix(row));
  } catch (e) { /* the answer stays what it was */ }
  return ptRuffleOf(m);
}
async function ptConsumeRuffle(entry) {
  const m = cutSkuOf(entry.sku);
  if (!ptIsRuffle(m)) return '';
  const pcs = parseInt(entry.issuePieces, 10) || 0;
  if (pcs <= 0) return '';
  /* What the form said, where it said it: a fabric and a number of metres for this issue. This is
   * what lets a ruffle whose rule has never been set be issued at all — before, it refused and sent
   * you to Masters, and the register filled up with warnings instead of deductions. */
  const saidM = parseFloat(entry.ruffleMetres);
  const saidF = String(entry.ruffleFabricUsed || '').trim();
  let r = ptRuffleOf(m);
  /* LOOK AGAIN BEFORE GIVING UP (2026-09-25). This session's recipes and SKU row may be older than somebody's save. */
  if (!r && !(isFinite(saidM) && saidM > 0 && saidF)) r = await ptRuffleFresh(m);
  if (isFinite(saidM) && saidM <= 0) return '';          // told: nothing went with these pieces
  if (!r && !(isFinite(saidM) && saidM > 0 && saidF))
    return ` Ruffle fabric was NOT deducted: neither the SKU, its recipe nor a ruffle rule gives metres for ${m.subtype || '?'} ${m.size || '?'}, `
      + 'and no fabric and metres were entered on the issue. Fill Ruffle metres and Ruffle fabric in its recipe.';
  const fab = saidF || r.fabric;
  const qty = isFinite(saidM) && saidM > 0 ? Math.round(saidM * 100) / 100
    : Math.round(pcs * r.meters * 100) / 100;
  const id = 'fab_ruf_' + entry.id;
  const row = { _id: id, id, date: String(entry.issueDate || '').slice(0, 10) || dToday(),
    txnType: 'ISSUE_TO_STITCHERS', fabricType: fab, colour: '', qty, form: 'RUNNING', state: 'RFD',
    counterparty: 'STITCHING', counterpartyName: entry.empName || '', orderNo: entry.orderNo || '',
    remarks: `Ruffle for ${nf(pcs)} × ${entry.sku} `
      + (isFinite(saidM) && saidM > 0 ? '(entered on the issue)' : `(${r.meters} m each)`), status: 'CLOSED',
    auto: true, srcEntryId: entry.id, createdBy: ME.email, createdAt: new Date().toISOString() };
  await ptPut('pt_fabInvLedger/' + id, row);
  if (typeof FAB !== 'undefined' && FAB && FAB.rows) FAB.rows = FAB.rows.filter(x => x._id !== id).concat([Object.assign({ _key: id }, row)]);
  return '';
}

/** And give it back when the issue is deleted. */
async function ptUnconsumeRuffle(entryId) {
  if (!entryId) return;
  const id = 'fab_ruf_' + entryId;
  try { await ptDelete('pt_fabInvLedger/' + id); } catch (e) { /* nothing was posted for it */ }
  if (typeof FAB !== 'undefined' && FAB && FAB.rows) FAB.rows = FAB.rows.filter(x => x._id !== id);
}

/** Take the consumption back when its issue is deleted, or the zipper stays spent forever. */
async function ptUnconsumeZippers(entryId) {
  if (!entryId) return;
  const id = 'acc_auto_' + entryId;
  try { await ptDelete('pt_accLedger/' + id); } catch (e) { /* nothing posted for it */ }
  if (ACC.ledger) { ACC.ledger = ACC.ledger.filter(r => r._id !== id); PTE.accLedger = ACC.ledger; }
  else if (PTE.accLedger) PTE.accLedger = PTE.accLedger.filter(r => r._id !== id);
}


