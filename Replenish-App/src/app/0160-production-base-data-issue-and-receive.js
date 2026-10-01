/* ================= PRODUCTION: BASE DATA — ISSUE AND RECEIVE =================
 *
 * The factory's main loop: pieces go out to a worker, and later come back — some good, some
 * rejected, some still out. Everything else (payroll, what may be pressed, what an order still owes)
 * is counted off this register, so the arithmetic here has to be the old tool's arithmetic exactly.
 *
 * THE ISSUE GATE IS NOT THE ORDER CAP ALONE. Three things must hold, and the second is the one that
 * is easy to miss:
 *
 *   1. Ordered − consumed. "Consumed" is NOT issued-so-far: it is what is still OPEN with contractors
 *      (issued − received) PLUS everything already pressed. A received piece is not counted twice,
 *      because once it is processed it shows up as pressed stock instead. Issuable = ordered −
 *      pressed − open.
 *   2. A piece must be CUT before it can be issued. For a SKU that needs cutting, the issue is also
 *      capped at the net cut against that same order — with pressed used as a floor, because every
 *      pressed piece was cut once and old records are incomplete. The exception is deliberate: a
 *      legacy `LEG-` order with no cutting recorded at all has unknown cut history, and freezing it
 *      would block real work; the ordered cap still protects it.
 *   3. Zipper stock, for SKUs with a chain length — see ptZipCheck.
 *
 * Receiving is its own arithmetic, and it is guarded too: received + rejected can never exceed what
 * was issued, and the row freezes itself the moment nothing is left pending.
 */

/* The employee list is [type, name, department, phone]. Rows whose NAME is an employment type are
 * bad data the old tool skips rather than shows — same here. */
const PT_EMP_TYPE_NAMES = ['Company Contractor', 'External Contractor'];

let PTE = { emp: null, acc: null, accLedger: null, custom: null, priority: null };

async function ptLoadEmp(force) {
  if (PTE.emp && !force) return;
  const [emp, ledger] = await Promise.all([ptGet('pt_empList'), ptGet('pt_accLedger')]);
  PTE.emp = ptList(emp).map(r => (Array.isArray(r) ? r : [r[0], r[1], r[2], r[3]]))
    .filter(e => e && e[1] && !PT_EMP_TYPE_NAMES.includes(String(e[1]).trim()));
  PTE.accLedger = ptList(ledger);
  PTE.acc = ptList((PTG.masters || {}).accessories);
}

const ptEmpTypes = () => [...new Set((PTE.emp || []).map(e => String(e[0] || '').trim()).filter(Boolean))].sort();
const ptEmpsOfType = t => (PTE.emp || []).filter(e => !t || String(e[0] || '').trim() === t);

/** Pressed pieces against an order line. */
function obPressQty(orderNo, sku, exclId) {
  if (!exclId) return obPressIndex().get(obKeyOf(orderNo, sku)) || 0;
  const o = obUC(orderNo), s = obUC(sku);
  return (PTG.press || []).filter(r => r && obUC(r.orderNo) === o && obUC(r.sku) === s)
    .filter(r => !exclId || r.id !== exclId)   // the row being edited does not count against itself
    .reduce((a, r) => a + (parseInt(r.pieces, 10) || 0), 0);
}

/** What an order line has already consumed of its issue allowance: open with contractors + pressed. */
function obIssueUsed(orderNo, sku, exclId) {
  /* The ordinary case comes off the index. The excluding case — one row being edited — keeps the
   * walk, so that rule lives in exactly one place. */
  if (!exclId) {
    const b = obBaseIndex().get(obKeyOf(orderNo, sku));
    return Math.max(0, (b ? b.issued : 0) - (b ? b.received : 0)) + obPressQty(orderNo, sku);
  }
  const o = obUC(orderNo), s = obUC(sku);
  let iss = 0, recv = 0;
  (PT.base || []).forEach(r => {
    if (!r || obUC(r.orderNo) !== o || obUC(r.sku) !== s) return;
    if (exclId && r.id === exclId) return;      // the row being edited does not count against itself
    iss += parseInt(r.issuePieces, 10) || 0;
    recv += parseInt(r.receivedPieces, 10) || 0;
  });
  return Math.max(0, iss - recv) + obPressQty(orderNo, sku);
}

/**
 * The accessories list and the ledger, from whichever copy is actually loaded.
 *
 * THIS IS THE WHOLE BUG. PTE.acc is filled once a session out of PTG.masters.accessories; when the
 * masters had not loaded by that moment it stayed empty for the rest of the session, and every
 * zipper looked like "not an accessory" — which the gate read as "nothing to check". Asking three
 * places instead of one costs nothing and removes the case where the guard is blind and cheerful.
 */
const accListNow = () => {
  const a = (typeof ACC !== 'undefined' && ACC && ACC.items) ? ACC.items : null;
  if (a && a.length) return a;
  if (PTE.acc && PTE.acc.length) return PTE.acc;
  return ptList((PTG.masters || {}).accessories);
};
const accLedgerNow = () => {
  const a = (typeof ACC !== 'undefined' && ACC && ACC.ledger) ? ACC.ledger : null;
  if (a && a.length) return a;
  return PTE.accLedger || [];
};

/** Zipper stock. Balance = OPENING + IN − OUT ± ADJUST, as the accessories ledger defines it. */
function ptAccBalance(code, exceptId) {
  if (!code) return 0;
  const k = String(code).trim().toUpperCase();
  return accLedgerNow().reduce((b, r) => {
    if (!r || String(r.itemCode || '').trim().toUpperCase() !== k) return b;
    /* The row being edited must not count against itself, or raising an issue from 5 to 6 would be
     * measured as though the 5 were still out as well. */
    if (exceptId && r._id === exceptId) return b;
    const q = parseFloat(r.qty) || 0;
    if (r.txnType === 'OPENING' || r.txnType === 'IN' || r.txnType === 'RETURN') return b + q;
    if (r.txnType === 'OUT') return b - q;
    if (r.txnType === 'ADJUST') return b + q;
    return b;
  }, 0);
}

/**
 * THE ZIPPER GATE: a zip SKU cannot be issued out of a shelf that has not got the zippers on it.
 *
 * Nothing about this is new in intent — the old tool refused it too. What is new is that it refuses
 * in the two cases it used to wave through, and both of them are how Zipper 30 reached −150:
 *
 *   · a zipper length NOT on the accessories list. It used to be added automatically and the issue
 *     allowed anyway, on the reasoning that a negative figure was "the true state of it". It is not:
 *     a shelf nobody has counted is a shelf nobody has counted, and nine issues went out against it
 *     before anybody typed a figure. Now it is a refusal, and it names what to add.
 *   · a list that had not loaded, which read as "not an accessory" and so as "nothing to check".
 *     accListNow asks every copy rather than the one that may be empty.
 *
 * The number checked is what is actually being handed over — the typed figure where the form has
 * one, otherwise the master row's zips-per-piece — because refusing an issue over a quantity nobody
 * intends to hand over is noise.
 */
function ptZipCheck(sku, qty, zipsIssued) {
  const m = cutSkuOf(sku);
  if (!m || m.isZip !== true) return '';
  const chain = m.chainLength;
  if (chain == null || isNaN(parseFloat(chain))) return '';
  const code = String(chain).trim();
  const need = (zipsIssued === null || zipsIssued === undefined || !isFinite(zipsIssued))
    ? (parseInt(qty, 10) || 0) * mdbZipQty(m) : zipsIssued;
  if (need <= 0) return '';                   // nought zippers cannot overdraw anything
  const item = accListNow().find(it => String(it.code || '').trim().toUpperCase() === code.toUpperCase());
  if (!item)
    return `Zipper "${code}" is not on the accessories list, so there is no stock to issue ${nf(need)} from. `
      + `Add it in Accessories and enter what is on the shelf, then make this entry.`;
  const bal = ptAccBalance(item.code);
  if (bal - need < 0)
    return `Cannot issue ${nf(need)} zipper(s) — "${item.code}" has ${nf(bal)} in stock`
      + (bal < 0 ? ' (already short)' : '') + `. Issuing ${nf(need)} would leave ${nf(bal - need)}. `
      + `Take in stock first.`;
  // The consumption is posted on save (ptConsumeZippers), so there is nothing left to hold back for.
  return '';
}

/** The old tool's obGuard('bd'), number for number. */
function bdGuard(orderNo, sku, qty, exclId, allowExtra) {
  const ordered = obOrderedQty(orderNo, sku);
  if (!ordered) return `Order ${orderNo} has no line for SKU ${obUC(sku)} — pick the correct Order ID.`;
  const used = obIssueUsed(orderNo, sku, exclId);
  const want = parseInt(qty, 10) || 0;
  /* EXTRA passes the ordered cap only. What has not been cut still cannot be issued. */
  if (!allowExtra && used + want > ordered)
    return `Order ${orderNo} · ${obUC(sku)}: ordered ${ordered} pcs, already issued ${used} pcs `
      + `(received or not) — at most ${ordered - used} more allowed. Entry blocked.`;

  const m = cutSkuOf(sku);
  const cutReq = !m || m.cuttingRequired !== false;
  if (cutReq) {
    const cutNet = obCutQty(orderNo, sku);
    // A legacy order with no cutting recorded at all has unknown cut history — the ordered cap still
    // protects it, so do not freeze real work over missing paperwork.
    const legacyUnknownCut = /^LEG-/.test(obUC(orderNo)) && cutNet <= 0;
    if (!legacyUnknownCut) {
      const effCut = Math.max(cutNet, obPressQty(orderNo, sku));
      const avail = effCut - used;
      if (want > avail)
        return `Order ${orderNo} · ${obUC(sku)}: only ${Math.max(0, avail)} cut piece(s) available to `
          + `issue — ${effCut} cut so far, ${used} already issued/finished. Cut more pieces first.`;
    }
  }
  return '';
}

/** Orders carrying this SKU, with what may still be issued on each. */
function bdOrdersFor(sku) {
  if (!sku) return [];
  const seen = new Set();
  return obLines().filter(l => l.sku === obUC(sku)).filter(l => {
    if (seen.has(l.orderNo)) return false; seen.add(l.orderNo); return true;
  }).map(l => {
    const ordered = obOrderedQty(l.orderNo, sku), used = obIssueUsed(l.orderNo, sku);
    const cutNet = obCutQty(l.orderNo, sku);
    const effCut = Math.max(cutNet, obPressQty(l.orderNo, sku));
    const m = cutSkuOf(sku);
    const cutReq = !m || m.cuttingRequired !== false;
    const legacy = /^LEG-/.test(l.orderNo) && cutNet <= 0;
    const byOrder = Math.max(0, ordered - used);
    const byCut = (cutReq && !legacy) ? Math.max(0, effCut - used) : byOrder;
    return { orderNo: l.orderNo, ordered, used, cut: effCut, left: Math.min(byOrder, byCut), byOrder, byCut };
  }).sort((a, b) => (b.left - a.left) || a.orderNo.localeCompare(b.orderNo));
}

/* ---- Base Data entry, the production app's own method ----
 *
 * ORDER ID FIRST, then the item. Picking the order narrows Article / Subtype / Colour / Size to what
 * that order still needs, and the SKU falls out of the four of them. Typing a SKU straight in works
 * too and fills the four backwards — the old tool allows both and so does this.
 *
 * CUSTOM ORDER is the escape hatch: a one-off with no existing SKU. Colour and Size become free text,
 * no Order ID is required, and a disposable SKU is minted — but only after checking whether an
 * existing product already matches that Article/Subtype/Colour/Size, in which case that SKU is reused.
 * Minting a second code for a product that already has one is how a catalogue quietly doubles.
 */
const CUSTOM_SKU_PREFIX_MAP = {
  'tablecloth': 'TC', 'table runner': 'TR', 'runner': 'RN', 'pillow cover': 'PC',
  'cushion cover': 'CC', 'quilt': 'QT', 'napkin': 'NP', 'placemat': 'PM',
  'bedsheet': 'BS', 'bed sheet': 'BS', 'curtain': 'CT', 'apron': 'AP', 'coaster': 'CO',
  'towel': 'TW', 'duvet cover': 'DC', 'throw': 'TH', 'bag': 'BG',
};
function ptCustomPrefix(articleType) {
  const key = String(articleType || '').trim().toLowerCase();
  if (CUSTOM_SKU_PREFIX_MAP[key]) return CUSTOM_SKU_PREFIX_MAP[key];
  const initials = key.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 3);
  return initials || 'CU';
}
function ptNextCustomSeq(prefix, dateStr) {
  const re = new RegExp('^' + prefix + '-CUST-' + dateStr + '-(\\d+)$', 'i');
  let max = 0;
  (PTG.mdb || []).forEach(r => { const m = re.exec(String((r && r.sku) || '')); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return String(max + 1).padStart(2, '0');
}
function ptGenCustomSku(articleType) {
  const d = new Date();
  const dateStr = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const p = ptCustomPrefix(articleType);
  return `${p}-CUST-${dateStr}-${ptNextCustomSeq(p, dateStr)}`;
}
const ptNorm = s => String(s == null ? '' : s).trim().toLowerCase();
/** An existing product with exactly this Article/Subtype/Colour/Size, if there is one. */
function ptFindExistingSku(at, sub, col, sz) {
  if (!at || !sub || !String(col || '').trim() || !String(sz || '').trim()) return null;
  const key = [at, sub, col, sz].map(ptNorm).join('|');
  const hit = (PTG.mdb || []).find(r => r && r.sku
    && [r.articleType, r.subtype, r.color, r.size].map(ptNorm).join('|') === key);
  return hit ? String(hit.sku) : null;
}

/** Orders with an open balance for issuing, oldest first. */
function bdOpenOrders() {
  const m = {};
  obLines().forEach(l => { (m[l.orderNo] = m[l.orderNo] || { skus: new Set(), date: l.date }).skus.add(l.sku); });
  return Object.keys(m).map(no => {
    const skus = [...m[no].skus];
    const bal = skus.reduce((a, s) => a + Math.max(0, obOrderedQty(no, s) - obIssueUsed(no, s)), 0);
    return { orderNo: no, skus, bal, date: m[no].date };
  }).filter(o => o.bal > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.orderNo.localeCompare(b.orderNo));
}

const bdIsCustom = () => $('bwCustom').checked === true;

/** The master rows in play: everything in Custom mode, otherwise only what the picked order needs. */
function bdScope() {
  const all = PTG.mdb || [];
  if (bdIsCustom()) return all;
  const o = obUC($('bwOrd').value);
  if (!o) return all;
  const open = new Set(obLines().filter(l => l.orderNo === o).map(l => l.sku));
  return all.filter(r => open.has(obUC(r.sku)));
}

function bdFill(id, values, label) {
  const sel = $(id), cur = sel.value;
  const seen = [...new Set(values.map(v => String(v == null ? '' : v).trim()).filter(Boolean))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  sel.innerHTML = `<option value="">${esc(label)}</option>`
    + seen.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = cur;
  if (sel.value !== cur) sel.value = '';
}

function bdFormMsg(t, bad) { const m = $('bwMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/** The whole form redrawn from its own state — order → article → subtype → colour → size → SKU. */
function renderBdForm() {
  const custom = bdIsCustom();
  $('bwOrdWrap').classList.toggle('hide', custom);
  // In Custom mode colour and size are typed, not chosen — that is the point of the mode.
  $('bwCol').classList.toggle('hide', custom);
  $('bwSz').classList.toggle('hide', custom);
  $('bwColTxt').classList.toggle('hide', !custom);
  $('bwSzTxt').classList.toggle('hide', !custom);

  bdFill('bwType', ptEmpTypes(), 'Employment type…');
  $('bwEmpList').innerHTML = ptEmpsOfType($('bwType').value).map(e => `<option value="${esc(e[1])}">`).join('');

  /* THE ORDER LIST FOLLOWS THE TYPED SKU. Name a SKU and only the orders that still want it are
   * offered, each showing what can be issued against IT — not the order's total, which belongs to
   * every other SKU on that order as much as to this one. Orders already fulfilled for this SKU drop
   * out; orders waiting on cutting stay, because "none issuable yet" and "not on this order" are
   * different answers and the line under the box says which. */
  const bdTypedSku = (!custom && $('bwSku').dataset.typed) ? $('bwSku').value.trim() : '';
  const bdOrds = bdTypedSku ? bdOrdersFor(bdTypedSku).filter(o => o.byOrder > 0) : null;
  if (!custom) {
    const cur = $('bwOrd').value;
    const opts = bdOrds
      ? bdOrds.map(o => `<option value="${esc(o.orderNo)}">${esc(o.orderNo)} — ${o.left > 0
          ? nf(o.left) + ' pcs issuable' : 'awaiting cutting'}</option>`)
      : bdOpenOrders().map(o => `<option value="${esc(o.orderNo)}">${esc(o.orderNo)} — ${nf(o.bal)} pcs open</option>`);
    $('bwOrd').innerHTML = '<option value="">— Select Order ID —</option>' + opts.join('');
    $('bwOrd').value = cur;
    if ($('bwOrd').value !== cur) $('bwOrd').value = '';
  }

  const scope = bdScope();
  const at = $('bwAt').value, sub = $('bwSub').value;
  const col = custom ? $('bwColTxt').value.trim() : $('bwCol').value;
  const sz = custom ? $('bwSzTxt').value.trim() : $('bwSz').value;

  bdFill('bwAt', scope.map(r => r.articleType), '-- Article type --');
  bdFill('bwSub', scope.filter(r => !at || ptNorm(r.articleType) === ptNorm(at)).map(r => r.subtype), '-- Subtype --');
  if (!custom) {
    bdFill('bwCol', scope.filter(r => (!at || ptNorm(r.articleType) === ptNorm(at))
      && (!sub || ptNorm(r.subtype) === ptNorm(sub))).map(r => r.color), '-- Colour --');
    bdFill('bwSz', scope.filter(r => (!at || ptNorm(r.articleType) === ptNorm(at))
      && (!sub || ptNorm(r.subtype) === ptNorm(sub))
      && (!col || ptNorm(r.color) === ptNorm(col))).map(r => r.size), '-- Size --');
  }

  /* The SKU. In Custom mode it is minted (or an existing match reused); otherwise it is whatever
   * single master row the four fields land on. A typed SKU is left alone — see bdSkuTyped. */
  if (!$('bwSku').dataset.typed) {
    if (custom) {
      const existing = ptFindExistingSku(at, sub, col, sz);
      $('bwSku').value = (at && sub) ? (existing || ptGenCustomSku(at)) : '';
      $('bwSkuNote').textContent = !at || !sub ? ''
        : existing ? 'Matches an existing SKU — reusing it instead of minting a duplicate.'
        : (col && sz ? 'New custom SKU — nothing existing matches this colour and size.' : '');
    } else {
      const hit = scope.filter(r => ptNorm(r.articleType) === ptNorm(at) && ptNorm(r.subtype) === ptNorm(sub)
        && ptNorm(r.color) === ptNorm(col) && ptNorm(r.size) === ptNorm(sz));
      $('bwSku').value = (at && sub && col && sz && hit.length === 1) ? hit[0].sku : '';
      $('bwSkuNote').textContent = (at && sub && col && sz && hit.length > 1)
        ? `${hit.length} SKUs share this description — pick the SKU directly.` : '';
    }
  }

  const sku = $('bwSku').value.trim();
  const m = cutSkuOf(sku);
  $('bwWho').textContent = m
    ? `${m.articleType || '—'} · ${m.subtype || '—'} · ${m.color || '—'} · ${m.size || '—'}`
      + (m.cuttingRequired === false ? '  ·  no cutting needed' : '  ·  cutting required')
    : (sku && !custom ? 'Not in the master database.' : '');
  $('bwWho').className = (m || custom || !sku) ? 'muted' : 'err';

  const o = (!custom && sku) ? bdOrdersFor(sku).find(x => x.orderNo === obUC($('bwOrd').value)) : null;
  /* An empty dropdown with nothing said beside it reads as an app still loading, not as an answer.
   * If the SKU is on no open order, say so — a fact about the order book, not a fault. */
  const bdNone = !!(bdOrds && !bdOrds.length);
  $('bwLeft').textContent = custom ? 'Custom order — saves without an Order ID.'
    : o ? (o.byCut < o.byOrder
      ? `${nf(o.left)} issuable — held down by cutting: ${nf(o.cut)} cut so far, ${nf(o.used)} already issued or finished.`
      : `${nf(o.left)} issuable — ${nf(o.ordered)} ordered, ${nf(o.used)} already issued or finished.`)
    : bdNone ? `No open order is waiting for ${obUC(bdTypedSku)} — tick Custom Order for a one-off.` : '';
  $('bwLeft').className = ((o && o.left <= 0) || bdNone) ? 'err' : 'muted';

  /* AND WHAT ELSE GOES WITH IT — its own boxes, filled in but yours to change. */
  bdMatFill();
}

/**
 * Fill the "also issued with these pieces" boxes from the master row, and say what is known about
 * them. Cheap on purpose: this runs on every keystroke in the pieces box, and rebuilding the four
 * dropdowns there — which is what renderBdForm does — is what made typing a piece count lag.
 *
 * A box the person has typed in is left alone. Changing the SKU un-types them, because a different
 * product takes different materials and carrying the old number over would be a lie.
 */
function bdMatFill() {
  const wrap = $('bwMat');
  if (!wrap) return;
  const sku = ($('bwSku').value || '').trim();
  const pcs = parseInt($('bwPcs').value, 10) || 0;
  const list = bdMaterialsFor(sku, pcs);
  const zip = list.find(x => x.kind === 'zip'), ruf = list.find(x => x.kind === 'ruffle');
  const m = cutSkuOf(sku);
  const isZip = !!(m && m.isZip === true), isRuf = ptIsRuffle(m);

  /* A new SKU means new materials: forget what was typed for the last one. */
  if (BD_MAT_SKU !== obUC(sku)) {
    BD_MAT_SKU = obUC(sku);
    ['bwZip', 'bwRuf', 'bwRufFab'].forEach(id => { $(id).dataset.typed = ''; $(id).value = ''; });
  }

  wrap.classList.toggle('hide', !(isZip || isRuf));
  $('bwZipWrap').classList.toggle('hide', !isZip);
  $('bwRufWrap').classList.toggle('hide', !isRuf);
  if (!isZip && !isRuf) { $('bwMatNote').textContent = ''; return; }

  const notes = [];

  if (isZip) {
    $('bwZipName').textContent = zip && zip.what ? zip.what : 'Zippers';
    if (!$('bwZip').dataset.typed) $('bwZip').value = zip && zip.qty != null ? zip.qty : '';
    if (zip && zip.why) notes.push('⚠ ' + zip.why + ' — type how many went');
    else if (zip) {
      if (zip.have != null) notes.push('shelf ' + nf(zip.have));
      if (zip.missing) notes.push('not on the accessories list yet — it will be added on save');
      const typed = parseFloat($('bwZip').value);
      if ($('bwZip').dataset.typed && isFinite(typed) && typed !== zip.qty)
        notes.push('worked out ' + nf(zip.qty) + ', you have typed ' + nf(typed));
    }
  }

  if (isRuf) {
    const fabs = cutFabrics();
    const want = $('bwRufFab').dataset.typed ? $('bwRufFab').value : (ruf && ruf.what) || '';
    $('bwRufFab').innerHTML = '<option value="">— Ruffle fabric —</option>'
      + fabs.map(f => `<option value="${esc(f)}"${f === want ? ' selected' : ''}>${esc(f)}</option>`).join('')
      + (want && fabs.indexOf(want) < 0 ? `<option value="${esc(want)}" selected>${esc(want)}</option>` : '');
    $('bwRufFab').value = want;
    if (!$('bwRuf').dataset.typed) $('bwRuf').value = ruf && ruf.qty != null ? ruf.qty : '';
    if (ruf && ruf.why) notes.push('no ruffle rule for this subtype and size — type the fabric and the metres, or set the rule under Masters → Ruffle fabric');
    else if (ruf) notes.push(nf(ruf.per) + ' m a piece by the rule');
  }

  $('bwMatNote').textContent = notes.join(' · ');
  $('bwMatNote').className = notes.some(n => /⚠|no ruffle rule|not on the accessories/.test(n)) ? 'err' : 'muted';
  $('bwMatNote').style.fontSize = '12px';
}
/** Which SKU the boxes were last filled for, so a change can clear what was typed for the old one. */
let BD_MAT_SKU = '';

/** The zipper count the form is actually asking to issue: what was typed, else nothing said. */
function bdZipTyped() {
  const el = $('bwZip');
  if (!el || el.classList.contains('hide')) return null;
  if ($('bwZipWrap').classList.contains('hide') || !el.dataset.typed) return null;
  const n = parseFloat(el.value);
  return isFinite(n) && n >= 0 ? n : null;
}

/**
 * What the form says goes out with the pieces, as fields on the entry — only where a box is showing
 * and has a figure in it. Nothing is written for a SKU that takes neither, and nothing is written
 * where the box simply holds the worked-out number, so those issues keep following the master row
 * even if the rule is corrected afterwards.
 */
function bdMatEntry() {
  const out = {};
  const z = bdZipTyped();
  if (z !== null) out.zipsIssued = z;
  if (!$('bwRufWrap').classList.contains('hide')) {
    const typedM = $('bwRuf').dataset.typed, typedF = $('bwRufFab').dataset.typed;
    const m = parseFloat($('bwRuf').value), f = String($('bwRufFab').value || '').trim();
    if (typedM && isFinite(m) && m >= 0) out.ruffleMetres = m;
    if (typedF && f) out.ruffleFabricUsed = f;
    /* A ruffle with no rule only works if BOTH came from the form — half of it deducts nothing. */
    if (out.ruffleMetres > 0 && !out.ruffleFabricUsed && f) out.ruffleFabricUsed = f;
    if (out.ruffleFabricUsed && out.ruffleMetres === undefined && isFinite(m) && m >= 0) out.ruffleMetres = m;
  }
  return out;
}

/** A SKU typed by hand wins, and fills the four fields backwards from the master row. */
function bdSkuTyped() {
  const sku = $('bwSku').value.trim();
  $('bwSku').dataset.typed = sku ? '1' : '';
  /* The SKU lookup is a map read, so filling the article boxes in happens on the keystroke — that is
   * the part somebody is watching for. */
  const m = cutSkuOf(sku);
  if (m && !bdIsCustom()) {
    $('bwAt').value = m.articleType || ''; $('bwSub').value = m.subtype || '';
    $('bwCol').value = m.color || ''; $('bwSz').value = m.size || '';
  }
  /* The REST of the form — the order list and five dropdowns rebuilt from the master database and
   * the order book — waits until the typing stops. Doing it per character is what made a five-letter
   * SKU take five rebuilds of everything, and none of the first four were ever looked at. */
  clearTimeout(BD_FORM_T);
  BD_FORM_T = setTimeout(renderBdForm, 180);
}
let BD_FORM_T = null;

function bdClearForm() {
  ['bwEmp', 'bwSku', 'bwPcs', 'bwRemarks', 'bwColTxt', 'bwSzTxt'].forEach(id => { $(id).value = ''; });
  ['bwOrd', 'bwAt', 'bwSub', 'bwCol', 'bwSz'].forEach(id => { $(id).value = ''; });
  $('bwSku').dataset.typed = '';
  $('bwSkuNote').textContent = '';
  /* And the materials boxes — a number left behind from the last issue would go out with the next. */
  ['bwZip', 'bwRuf', 'bwRufFab'].forEach(id => { $(id).value = ''; $(id).dataset.typed = ''; });
  BD_MAT_SKU = '';
  $('bwDate').value = dToday();
  renderBdForm();
  bdFormMsg('');
}

async function ensureBdForm() {
  if (!PTG.mdb) { bdFormMsg('Reading the master database and the order book…'); await ptLoadGates(); }
  await ptEnsureCustom();
  if (!PTE.emp) await ptLoadEmp();
  if (PTG.err) { bdFormMsg('Could not read what the checks need: ' + PTG.err, true); return; }
  if (!$('bwDate').value) $('bwDate').value = dToday();
  renderBdForm();
}

$('bwToggle').onclick = async () => {
  const box = $('bwBox');
  const open = box.classList.contains('hide');
  box.classList.toggle('hide', !open);
  $('bwToggle').textContent = open ? 'Close' : '+ New Job Work';
  if (open) await ensureBdForm();
};
/* Back to how the form opened — Custom Order included. bdClearForm alone does not untick it, and
 * must not: it also runs after a save, and a run of custom entries would re-tick it every time. */
$('bwClear').onclick = () => {
  $('bwCustom').checked = false;
  bdClearForm();
  bdFormMsg('Cleared — nothing was saved.');
};
['bwCustom', 'bwOrd', 'bwType', 'bwAt', 'bwSub', 'bwCol', 'bwSz', 'bwColTxt', 'bwSzTxt'].forEach(id => {
  // Changing anything above the SKU means the typed SKU no longer stands.
  const reset = () => { if (id !== 'bwType') $('bwSku').dataset.typed = ''; renderBdForm(); };
  $(id).addEventListener('change', reset);
  $(id).addEventListener('input', reset);
});
$('bwSku').addEventListener('input', bdSkuTyped);
/* The pieces decide how many zippers and how much ruffle go with them, so the boxes follow the count
 * as it is typed. bdMatFill, NOT renderBdForm: renderBdForm rebuilds the article, subtype, colour and
 * size dropdowns off the master list, and doing that on every keystroke of a piece count is what made
 * this form lag. */
$('bwPcs').addEventListener('input', bdMatFill);
/* A figure somebody types wins over the one worked out, and is remembered until the SKU changes. */
['bwZip', 'bwRuf', 'bwRufFab'].forEach(id => {
  const typed = () => { $(id).dataset.typed = String($(id).value).trim() ? '1' : ''; bdMatFill(); };
  $(id).addEventListener('input', typed);
  $(id).addEventListener('change', typed);
});

/** An identical issue — karigar, SKU, order, pieces — saved in the last two minutes, or null. */
function bdTwinOf(entry) {
  const now = Date.now();
  return (PT.base || []).find(r => r && r.empName === entry.empName && obUC(r.sku) === obUC(entry.sku)
    && String(r.orderNo || '') === String(entry.orderNo || '') && ptNum(r.issuePieces) === ptNum(entry.issuePieces)
    && now - (Date.parse(r.addedAt || '') || 0) < 120000) || null;
}

$('bwSave').onclick = async () => {
  const custom = bdIsCustom();
  const type = $('bwType').value.trim();
  const name = $('bwEmp').value.trim();
  const sku = $('bwSku').value.trim();
  const orderNo = custom ? '' : $('bwOrd').value.trim();
  const pcs = parseInt($('bwPcs').value, 10);
  const date = $('bwDate').value;
  /* On the Custom SKUs list and not in the master: what it is comes off the list (its selects cannot hold a size like
   * "40*40 cm" that no master row has). */
  const cm = !custom && sku && !mdbOf(sku) ? ptCustomOf(sku) : null;
  const at = $('bwAt').value || (cm ? cm.articleType : ''), sub = $('bwSub').value || (cm ? cm.subtype : '');
  const col = custom ? $('bwColTxt').value.trim() : ($('bwCol').value || (cm ? cm.color : ''));
  const sz = custom ? $('bwSzTxt').value.trim() : ($('bwSz').value || (cm ? cm.size : ''));

  if (!type) return bdFormMsg('Select the employment type.', true);
  if (!name) return bdFormMsg('Enter the employee.', true);
  const emp = ptEmpsOfType(type).find(e => String(e[1]).trim().toLowerCase() === name.toLowerCase());
  if (!emp) return bdFormMsg(`"${name}" is not on the ${type} list.`, true);
  if (!at) return bdFormMsg('Select the article type.', true);
  if (!sub) return bdFormMsg('Select the article subtype.', true);
  if (!col) return bdFormMsg(custom ? 'Type the colour.' : 'Select the colour.', true);
  if (!sz) return bdFormMsg(custom ? 'Type the size.' : 'Select the size.', true);
  if (!sku) return bdFormMsg('No SKU — pick the item, or type the SKU directly.', true);
  if (!pcs || pcs < 1) return bdFormMsg('Enter how many pieces are being issued.', true);
  if (!date) return bdFormMsg('Enter the issue date.', true);

  if (!custom) {
    const m = cutSkuOf(sku);
    if (!m) return bdFormMsg(`SKU ${sku} is not in the master database, nor on the Custom SKUs list.`, true);
    const mErr = m._custom ? [] : validateAgainstMasters(at, sub, col, sz);
    if (mErr.length) return bdFormMsg(mErr[0], true);
    if (!orderNo) return bdFormMsg('Select an Order ID — every issue is recorded against an order.', true);
    /* When editing, this row's own pieces must not count against itself. */
    const gErr = bdGuard(orderNo, sku, pcs);
    if (gErr) return bdFormMsg(gErr, true);
    /* The zipper check asks about the number that is actually going out, which is the typed one
     * when there is one — refusing an issue over a figure nobody intends to hand over is noise. */
    const zErr = ptZipCheck(sku, pcs, bdZipTyped());
    if (zErr) return bdFormMsg(zErr, true);
  }

  const entry = {
    id: 'bd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    empType: type, empName: emp[1], sku: obUC(sku),
    articleType: at, articleSubtype: sub, color: col, size: sz,
    orderNo,
    issuePieces: pcs, issueDate: ptStampDate(date),
    receivedPieces: 0, rejectionPieces: 0, receivingDate: '', pendingPieces: pcs,
    remarks: $('bwRemarks').value.trim(),
    /* What went out WITH the pieces, as entered. Absent means "whatever the master row says", which
     * is how every issue made before these boxes existed still reads correctly. */
    ...bdMatEntry(),
    frozen: false,
    isCustom: custom || (cm ? true : undefined),
    addedBy: ME.email, addedAt: new Date().toISOString(),
  };

  /* THE SAME ISSUE, AGAIN, INSIDE TWO MINUTES. Eleven pairs like this are in the live register — same karigar,
   * SKU, order and pieces, 0 to 47 seconds apart, ten of them already paid in a frozen fortnight. A second
   * identical issue can be real, so it is asked about, not refused. */
  const twin = bdTwinOf(entry);
  if (twin && !confirm(`${nf(pcs)} piece(s) of ${entry.sku} were issued to ${entry.empName}${orderNo ? ' against ' + orderNo : ''} `
    + `${Math.max(1, Math.round((Date.now() - Date.parse(twin.addedAt)) / 1000))} second(s) ago.

This would be a SECOND, identical issue — and a second payment. OK saves it anyway.`))
    return bdFormMsg('Not saved — that exact issue was already saved a moment ago. It is in the register below.', true);

  $('bwSave').disabled = true;
  bdFormMsg('Saving…');
  try {
    await ptPut('pt_baseData/' + entry.id, entry);
    PT.base = (PT.base || []).concat(Object.assign({ _key: entry.id }, entry));
    // A zip SKU spends zippers. Posting it here keeps the accessory ledger honest without a second step.
    let zipNote = '', rufNote = '';
    try { zipNote = await ptConsumeZippers(entry); } catch (e) { zipNote = 'The zipper deduction did not save: ' + (e.message || e); }
    /* THE RUFFLE GOES WITH IT, the way the zipper does — a ruffle tablecloth takes both. */
    try { rufNote = await ptConsumeRuffle(entry); } catch (e) { rufNote = ' The ruffle fabric deduction did not save: ' + (e.message || e); }
    bdClearForm();
    renderPbase();
    const matNote = (zipNote + rufNote).trim();
    bdFormMsg(`Issued — ${nf(pcs)} piece(s) of ${obUC(sku)} to ${emp[1]}${orderNo ? ' against ' + orderNo : ' (custom order)'}.`
      + (matNote ? ' ' + matNote : ''), /NOT|could not|did not/.test(matNote));
  } catch (e) {
    bdFormMsg('Not saved: ' + (e.message || e), true);
  }
  $('bwSave').disabled = false;
};

