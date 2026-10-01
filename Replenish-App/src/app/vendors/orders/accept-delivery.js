/* ================= ACCEPTING A DELIVERY =================
 *
 * A printer recording "I sent 19" and 19 pieces actually arriving are two different facts, and until
 * now only the first was written down. Ravi, 2026-09-07: "mera challan guy accept kre ki haan actual
 * me goods receive hua h".
 *
 * So a delivery now has two sides. The printer's claim is what they typed in their portal and it is
 * never overwritten — it stays exactly as they said it. Acceptance is added ALONGSIDE it:
 *
 *     ok: { qty, by, at, note }
 *
 * WHAT COUNTS AS DELIVERED. Once accepted, the accepted figure is the truth; until then the claim
 * is. Deliberately that way round: 177 deliveries are already on record and none of them has been
 * accepted, so requiring acceptance first would show every order as nothing-received overnight.
 * Nothing changes until somebody accepts, and then the number can only get more true.
 *
 * A DIFFERENT COUNT IS NOT AN ERROR — it is the point. The challan says 19, nineteen are counted at
 * the gate, and sometimes eighteen. The accepted quantity is editable for exactly that reason, and
 * the claim beside it shows what was said, so a shortfall is visible rather than argued about later.
 */

/** Who may confirm that goods actually arrived. Whoever is given the History section — that is what
 *  it is for — and any admin. A vendor never holds it. */
/* HAVING THE TAB IS NOT A PERMISSION. This read ME.tabs, so anybody who could look at what printers
 * have sent could accept it — and an acceptance creates fabric stock and settles what that printer
 * is paid. It is a grant of its own now; everybody who had the tab at the split was given it. */
const vlCanAccept = () => vlogCanAccept();

/** The accepted record on a delivery, if it has one. */
const vlOk = d => (d && d.ok && isFinite(parseFloat(d.ok.qty))) ? d.ok : null;
/**
 * How much more was taken in than the printer wrote on the challan, if any.
 *
 * Read back off the two figures rather than trusting the stored one, so deliveries accepted before
 * this existed — and any row where the stored number and the counts have drifted apart — still
 * answer correctly. The stored figure is for looking at; this is the one anything decides on.
 */
const vlOver = d => {
  const k = vlOk(d); if (!k) return 0;
  const got = (parseFloat(k.qty) || 0) + (parseFloat(k.rej) || 0);
  return Math.max(0, got - (parseFloat(d && d.qty) || 0));
};
/**
 * Marked as never having arrived. A printer's portal entry is a claim, not a receipt; this is the
 * answer to it that is not "accept". Kept apart from an acceptance of nought, which would say the
 * goods came and none were kept — a different and false statement.
 */
const vlNo = d => (d && d.no && !vlOk(d)) ? d.no : null;
/**
 * What a delivery is worth: nothing if it never arrived, what was accepted if somebody accepted it,
 * and — until then — what the printer claimed.
 */
const vlQtyOf = d => {
  if (vlNo(d)) return 0;
  const k = vlOk(d);
  return k ? (parseFloat(k.qty) || 0) : (parseFloat(d && d.qty) || 0);
};

/** Find one delivery again from the row the screen is showing. */
function vlFind(r) {
  const o = (VO.rows || []).find(x => x && x.vendorCode === r.vendorCode && x.id === r.id);
  if (!o) return null;
  const lines = voLines(o);
  const l = lines[r.li];
  if (!l) return null;
  const dels = voDels(l);
  const d = dels[r.di];
  if (!d) return null;
  return { o, lines, l, dels, d };
}

/**
 * Write acceptance onto one or more deliveries.
 *
 * The whole order is rewritten, the way every other change to a vendor order is — the deliveries sit
 * inside its lines, and a targeted write into an array that may be stored as an object is the kind
 * of path that works until the day it does not.
 */
async function vlAcceptWrite(rows, qtyFor, note, rejFor) {
  if (!vlCanAccept()) return VLOG_NO_ACCEPT;
  if (!rows.length) return '';
  const now = new Date().toISOString();
  /* Grouped by order: one write each, however many of its deliveries are being accepted. */
  const byOrder = new Map();
  rows.forEach(r => { const k = r.vendorCode + '/' + r.id; if (!byOrder.has(k)) byOrder.set(k, []); byOrder.get(k).push(r); });

  for (const [key, list] of byOrder) {
    const found = vlFind(list[0]);
    if (!found) return 'That delivery is no longer there — press Refresh.';
    const lines = found.lines.map(l => Object.assign({}, l));
    let touched = 0;
    list.forEach(r => {
      const l = lines[r.li]; if (!l) return;
      const dels = voDels(l).map(x => Object.assign({}, x));
      const d = dels[r.di]; if (!d) return;
      const asked = qtyFor(r, d);
      if (!(asked >= 0)) return;
      /* NEVER MORE THAN THE ORDER (Ravi, 2026-09-28: "accept sirf order ke equal hi ho"). What the other deliveries on
       * the line are worth comes off first; anything past the order stays on this delivery as `beyond` — seen by
       * everybody, credited to nobody. Bulk accepts are capped the same way, row after row on the same line. */
      const lineOrd = voQty(found.o, l);
      /* Earlier deliveries fill the order first: they count at what they are worth; a LATER one counts only once it is
       * accepted, so of two challans past the order it is the later one that is cut, whatever order they are ticked in. */
      const others = dels.reduce((a, x, i) => a + (i === r.di ? 0 : i < r.di ? vlQtyOf(x) : (vlOk(x) ? vlQtyOf(x) : 0)), 0);
      const q = lineOrd > 0 ? Math.min(asked, Math.max(0, lineOrd - others)) : asked;
      const beyond = Math.max(0, asked - q);
      /* WHAT WAS SAID BEFORE IS KEPT. This figure decides what a printer is owed and paid for, so a
       * correction has to leave a trail — otherwise there is nothing to settle an argument with.
       * Capped at ten, oldest dropped: a trail, not an archive. */
      const prev = vlOk(d);
      const was = (prev && Array.isArray(prev.was) ? prev.was.slice() : []);
      if (prev) {
        was.push({ qty: parseFloat(prev.qty) || 0, rej: parseFloat(prev.rej) || 0,
          by: prev.by || '', at: prev.at || '' });
        while (was.length > 10) was.shift();
      }
      d.ok = { qty: q, by: ME.email, at: now };
      if (beyond > 0) d.ok.beyond = Math.round(beyond * 100) / 100;
      if (was.length) d.ok.was = was;
      /* Pieces looked at and sent back. Stored beside the good figure, never inside it — the printer
       * is credited with ok.qty alone, so a returned piece stays owed and has to be made again. */
      const rj = rejFor ? rejFor(r, d) : 0;
      if (rj > 0) d.ok.rej = rj;
      /* MORE THAN THE CHALLAN SAID. Worked out here rather than passed in, so it cannot disagree
       * with the figures it is the difference between. It is stored because it is the one direction
       * that costs money — the printer is credited with what was kept — and a row that quietly
       * credits two extra pieces is a row nobody can question a month later. */
      const over = (q + rj) - (parseFloat(d.qty) || 0);
      if (over > 0) d.ok.over = over;
      if (note) d.ok.note = String(note).slice(0, 200);
      l.deliveries = dels;
      /* The two cached totals the staff screens read are rewritten from the deliveries, never added
       * to — the same rule the portal follows when it records one. */
      l.vendorQty = dels.reduce((s, x) => s + vlQtyOf(x), 0);
      l.dispatchedQty = l.vendorQty;
      lines[r.li] = l;
      touched++;
    });
    if (!touched) continue;
    const next = Object.assign({}, found.o, { lines, staffUpdatedAt: now, staffUpdatedBy: ME.email });
    delete next.vendorCode;
    const cut = key.indexOf('/');
    await ptPut('pt_vendorOrders/' + key.slice(0, cut) + '/' + key.slice(cut + 1), next);
    VO.rows = (VO.rows || []).map(x => (x.id === found.o.id && x.vendorCode === found.o.vendorCode
      ? Object.assign({ vendorCode: found.o.vendorCode }, next) : x));
  }
  return '';
}

/** One delivery, checked against the challan. */
function vlAcceptOne(rowKey) {
  const r = (VLOG.rows || []).find(x => x.key2 === rowKey);
  if (!r) return;
  const f = vlFind(r);
  if (!f) { $('vlMsg').className = 'err'; $('vlMsg').textContent = 'That delivery is no longer there — press Refresh.'; return; }
  const claimed = parseFloat(r.qty) || 0;
  /* Already accepted? Then this is a correction — rejects turn up on the table, not at the gate. */
  const prev = r.ok || null;
  const wasQty = prev ? (parseFloat(prev.qty) || 0) : claimed;
  const wasRej = prev ? (parseFloat(prev.rej) || 0) : 0;
  /* WHAT THE ORDER ITSELF STILL HAS ROOM FOR. Taking in more than the challan is one thing; taking
   * in more than was ever ordered is a bigger one, because those pieces were never asked for and
   * will still be paid for. The other deliveries on this line are counted at what they are worth —
   * accepted where accepted, claimed where not — so the figure matches what the order screen shows. */
  const lineOrdered = voQty(f.o, f.l);
  const otherDone = f.dels.reduce((a, x, i) => a + (i === r.di ? 0 : i < r.di ? vlQtyOf(x) : (vlOk(x) ? vlQtyOf(x) : 0)), 0);
  const roomOnOrder = Math.max(0, lineOrdered - otherDone);
  const proposed = prev ? wasQty : Math.min(claimed, roomOnOrder);
  ptOpenDialog({
    title: prev ? 'Change what was received' : 'Goods received?',
    subtitle: `${r.vendor}  ·  ${r.orderNo}  ·  ${r.sku || r.what}`,
    note: `The printer recorded ${nf(claimed)} ${r.unit} on ${r.day || 'a date that could not be read'}. `
      + 'Put in what you kept, and separately what you sent back. RETURNED is not the same as short: '
      + 'short means the pieces never arrived, returned means they did and were rejected. The printer '
      + 'is credited with what you kept, so anything returned stays owed and has to be made again.'
      + ` If MORE arrived than the ${nf(claimed)} on the challan, put in what you actually took — say why `
      + 'in the note. Nothing past the order is ever accepted: '
      + (claimed > roomOnOrder ? `the printer sent ${nf(claimed)} ${r.unit} and the order has room for ${nf(roomOnOrder)}, so `
        + `${nf(claimed - roomOnOrder)} ${r.unit} are recorded as delivered beyond the order and not credited.` : 'anything beyond it is recorded as delivered, not credited.')
      + (prev ? ` This was accepted as ${nf(wasQty)} kept${wasRej ? ' and ' + nf(wasRej) + ' returned' : ''} `
        + `by ${String(prev.by || '').split('@')[0] || 'somebody'}. Change it if pieces were rejected `
        + 'afterwards — what it said before is kept on the record.' : ''),
    fields: [
      { key: 'vlq', label: `Received — kept (${r.unit})`, type: 'number', min: 0, value: proposed },
      { key: 'vlroom', label: 'This line still has room for', type: 'text', readonly: true,
        value: nf(roomOnOrder) + ' ' + r.unit + ' of the ' + nf(lineOrdered) + ' ordered' },
      { key: 'vlr', label: `Returned — sent back (${r.unit})`, type: 'number', min: 0, value: wasRej || '' },
      { key: 'vln', label: 'Note — challan number, or why it differs', value: (prev && prev.note) || '', span: true },
    ],
    saveLabel: prev ? 'Save the change' : 'Accept',
    onSave: async () => {
      const q = parseFloat(($('ptf_vlq') || {}).value);
      const rjRaw = String(($('ptf_vlr') || {}).value || '').trim();
      const rj = rjRaw === '' ? 0 : parseFloat(rjRaw);
      const note = String(($('ptf_vln') || {}).value || '').trim();
      if (!isFinite(q) || q < 0) return 'Put in how many you kept.';
      if (!isFinite(rj) || rj < 0) return 'Returned must be a number, or blank for none.';
      /* MORE THAN THE CHALLAN IS ALLOWED, AND HAS TO BE EXPLAINED. This used to be refused flat, and
       * refusing it did not make the extra pieces go away — it left them uncounted and unpaid. The
       * note is the whole safeguard: it is what somebody reads in a month when the printer's bill is
       * two pieces bigger than the challan they were sent. */
      const over = q + rj - claimed;
      if (over > 0 && !note) return `${nf(q + rj)} ${r.unit} is ${nf(over)} more than the ${nf(claimed)} `
        + `the printer recorded. That is allowed — ${r.vendor} gets credited for it — but write the `
        + 'challan number or the reason in the note first.';
      const err = await vlAcceptWrite([r], () => q, note, () => rj);
      if (err) return err;
      renderVlog();
      const beyondN = Math.max(0, q - roomOnOrder);
      const shortBy = claimed - q - rj;
      /* SAID OUT LOUD AFTERWARDS TOO, and the harder fact with it: whether this pushes the line past
       * what was ever ordered. A gate that took in two extra pieces has done nothing wrong; an order
       * that is now being paid for more than it asked for is somebody's decision to make. */
      const overOrder = Math.max(0, otherDone + q - lineOrdered);
      $('vlMsg').className = overOrder > 0 ? 'err' : 'muted';
      $('vlMsg').textContent = `${nf(Math.min(q, roomOnOrder))} ${r.unit} kept against ${r.orderNo}`
        + (beyondN > 0 ? ` (the order had room for no more — ${nf(beyondN)} ${r.unit} recorded as delivered beyond it, not credited)` : '')
        + (rj ? `, ${nf(rj)} returned` : '')
        + (over > 0 ? `, ${nf(over)} MORE than the ${nf(claimed)} the printer recorded — ${r.vendor} is credited for it.`
          : shortBy > 0 ? `, ${nf(shortBy)} short of the ${nf(claimed)} the printer recorded.` : '.')
        + (overOrder > 0 ? ` This line is now ${nf(overOrder)} ${r.unit} over the ${nf(lineOrdered)} `
          + 'that were ordered.' : '')
        + (prev && rj > wasRej ? ` ${nf(rj - wasRej)} ${r.unit} moved back onto what ${r.vendor} still owes.` : '');
      return '';
    },
  });
}

/**
 * Mark a delivery as never arrived — or take that back when it turns up.
 *
 * The whole order is rewritten, the way every other change to one is, and the two cached totals are
 * rebuilt from the deliveries rather than adjusted, so a claim that counts for nothing stops counting
 * everywhere at once.
 */
async function vlNoWrite(r, note, undo) {
  if (!vlCanAccept()) return VLOG_NO_ACCEPT;
  const found = vlFind(r);
  if (!found) return 'That delivery is no longer there — press Refresh.';
  const lines = found.lines.map(l => Object.assign({}, l));
  const l = lines[r.li];
  if (!l) return 'That delivery is no longer there — press Refresh.';
  const dels = voDels(l).map(x => Object.assign({}, x));
  const d = dels[r.di];
  if (!d) return 'That delivery is no longer there — press Refresh.';
  if (undo) delete d.no;
  else {
    d.no = { by: ME.email, at: new Date().toISOString() };
    if (note) d.no.note = String(note).slice(0, 200);
    /* An acceptance and a did-not-arrive cannot both stand. Saying it never came undoes any figure
     * somebody had accepted for it. */
    delete d.ok;
  }
  l.deliveries = dels;
  l.vendorQty = dels.reduce((s, x) => s + vlQtyOf(x), 0);
  l.dispatchedQty = l.vendorQty;
  lines[r.li] = l;
  const next = Object.assign({}, found.o, { lines, staffUpdatedAt: new Date().toISOString(), staffUpdatedBy: ME.email });
  delete next.vendorCode;
  await ptPut('pt_vendorOrders/' + r.vendorCode + '/' + r.id, next);
  VO.rows = (VO.rows || []).map(x => (x.id === r.id && x.vendorCode === r.vendorCode
    ? Object.assign({ vendorCode: r.vendorCode }, next) : x));
  return '';
}

/** The dialog behind "Didn't arrive". */
function vlNoOne(rowKey) {
  const r = (VLOG.rows || []).find(x => x.key2 === rowKey);
  if (!r) return;
  const marked = r.del && r.del.no && !r.ok;
  ptOpenDialog({
    title: marked ? 'It turned up after all?' : 'This never arrived?',
    subtitle: `${r.vendor}  ·  ${r.orderNo}  ·  ${r.sku || r.what}`,
    note: marked
      ? `This was marked as never arrived by ${String((r.del.no.by) || '').split('@')[0] || 'somebody'}. `
        + 'Taking that back puts it back among the deliveries waiting to be accepted, at the figure the '
        + 'printer recorded.'
      : `The printer recorded ${nf(r.qty)} ${r.unit} on ${r.day || 'a date that could not be read'}, from `
        + 'their own portal. Marking it as never arrived makes it count for nothing — the order goes back '
        + 'to owing those pieces. It is not the same as accepting nought, which would say the goods came '
        + 'and none were kept. This can be undone the day they turn up.',
    fields: marked ? [] : [{ key: 'nno', label: 'Note — what was said, or who was asked', value: '', span: true }],
    saveLabel: marked ? 'It arrived — put it back' : 'It never arrived',
    onSave: async () => {
      const err = await vlNoWrite(r, marked ? '' : (($('ptf_nno') || {}).value || ''), marked);
      if (err) return err;
      renderVlog();
      $('vlMsg').className = 'muted';
      $('vlMsg').textContent = marked
        ? `${r.orderNo} · ${r.sku || r.what} is back among the deliveries waiting to be accepted.`
        : `${nf(r.qty)} ${r.unit} on ${r.orderNo} marked as never arrived — ${r.vendor} still owes them.`;
      return '';
    },
  });
}

/** Everything ticked, accepted at exactly what the printer said. */
async function vlAcceptPicked() {
  if (!vlCanAccept()) { $('vlMsg').className = 'err'; $('vlMsg').textContent = 'You do not have access to accept deliveries.'; return; }
  /* A row somebody has said never arrived must not be swept into a bulk accept. */
  const rows = (VLOG.rows || []).filter(r => VL_PICKED.has(r.key2) && !vlOk(r.del) && !vlNo(r.del));
  if (!rows.length) return;
  const pcs = rows.filter(r => !r.run).reduce((n, r) => n + r.qty, 0);
  const mtr = rows.filter(r => r.run).reduce((n, r) => n + r.qty, 0);
  /* Bulk accepts AT THE CLAIMED FIGURE — there is no per-row count to type here. Anything that has
   * to be corrected is accepted on its own, which is why the confirmation says so. */
  if (!confirm(`Accept ${nf(rows.length)} delivery(ies) exactly as the printer recorded them?\n\n`
    + (pcs ? nf(pcs) + ' pcs' : '') + (pcs && mtr ? ' and ' : '') + (mtr ? nf(mtr) + ' m' : '')
    + '\n\nUse this when the challan matches — nothing returned, nothing short. Anything with a return '
    + 'or a shortfall should be accepted on its own row, where both counts can be typed.')) return;
  $('vlMsg').className = 'muted'; $('vlMsg').textContent = 'Accepting…';
  const err = await vlAcceptWrite(rows, (r, d) => parseFloat(d.qty) || 0, '');
  VL_PICKED = new Set();
  renderVlog();
  if (err) { $('vlMsg').className = 'err'; $('vlMsg').textContent = err; return; }
  $('vlMsg').className = 'muted';
  $('vlMsg').textContent = `${nf(rows.length)} delivery(ies) accepted.`;
}

let VLOG = { rows: [] };
let VL_PICKED = new Set();

/**
 * The pieces actually in hand for a delivery: what was kept once somebody accepted it, and what the
 * printer says until then. One definition, so the cloth column and its totals cannot disagree.
 */
const vlInHand = r => (r && r.ok) ? (parseFloat(r.ok.qty) || 0) : (parseFloat(r && r.qty) || 0);

/** The window the History tab is showing. Blank ends mean "as far back as there is". */
function vlogFilters() {
  return {
    vendor: ($('vlVendor') || {}).value || '',
    type: ($('vlType') || {}).value || '',
    from: ($('vlFrom') || {}).value || '',
    to: ($('vlTo') || {}).value || '',
    q: (($('vlQ') || {}).value || '').trim().toLowerCase(),
    state: ($('vlState') || {}).value || '',
  };
}

function vlogApply(rows, f) {
  /* The date inputs are ISO; the deliveries are day-first. Both are compared as yyyymmdd so neither
   * has to be reformatted into the other and misread on the way. */
  const isoKey = s => String(s || '').slice(0, 10).replace(/-/g, '');
  const from = isoKey(f.from), to = isoKey(f.to);
  return rows.filter(r => {
    if (f.vendor && r.vendorCode !== f.vendor) return false;
    if (f.type && (r.run ? 'running' : 'cut') !== f.type) return false;
    /* A row whose date could not be read is kept whenever no window is asked for, and dropped the
     * moment one is — it cannot honestly be said to fall inside a range. */
    if (from || to) { if (!r.key) return false;
      if (from && r.key < from) return false;
      if (to && r.key > to) return false; }
    if (f.state === 'pending' && r.ok) return false;
    if (f.state === 'accepted' && !r.ok) return false;
    if (f.state === 'short' && !(r.ok && (parseFloat(r.ok.qty) || 0) < r.qty)) return false;
    if (f.state === 'returned' && !(r.ok && (parseFloat(r.ok.rej) || 0) > 0)) return false;
    if (f.state === 'never' && !(r.del && r.del.no && !r.ok)) return false;
    /* A row marked as never arrived is not "waiting" — nobody is waiting for it. */
    if (f.state === 'pending' && r.del && r.del.no && !r.ok) return false;
    if (f.q && ![r.vendor, r.orderNo, r.sku, r.what, r.day, r.by].join(' ').toLowerCase().includes(f.q)) return false;
    return true;
  });
}

function renderVlog() {
  if (VO.busy) { $('vlMsg').className = 'muted'; $('vlMsg').textContent = 'Reading the vendor orders…'; ptEmpty('vlTable', 'Loading…'); return; }
  if (VO.err) { $('vlMsg').className = 'err'; $('vlMsg').textContent = 'Could not read it: ' + VO.err; ptEmpty('vlTable', 'Nothing to show.'); $('vlKpis').innerHTML = ''; return; }

  const all = voLogRows();
  ptFillSelect('vlVendor', [...new Set(all.map(r => r.vendorCode))].sort().map(c => [c, voName(c)]), 'All printers');
  const rows = vlogApply(all, vlogFilters());
  VLOG.rows = rows;

  if (!rows.length) {
    $('vlMsg').className = 'muted';
    $('vlMsg').textContent = all.length
      ? 'Nothing in this window. Widen the dates, or clear the filters.'
      : 'Nothing has been recorded as received yet. A delivery appears here the moment a printer '
        + 'records it in their portal.';
    $('vlKpis').innerHTML = ''; ptEmpty('vlTable', 'No deliveries.');
    return;
  }

  const byDay = new Map();
  rows.forEach(r => { const k = r.key || 'zzz'; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); });
  const days = [...byDay.keys()].sort().reverse();
  const sum = (list, run) => list.filter(r => r.run === run).reduce((n, r) => n + r.qty, 0);
  const pcs = sum(rows, false), mtr = sum(rows, true);
  /* What went back. Never netted off "Received" — that figure is what the printer sent, and the
   * return is a separate thing that happened to it afterwards. */
  const vlRet = rows.reduce((n, r) => n + (r.ok ? (parseFloat(r.ok.rej) || 0) : 0), 0);
  /* Taken in over the challan. Its own figure and never netted against the shortfalls — two pieces
   * extra on Monday and two missing on Tuesday are two things to ask about, not nothing. */
  const vlOverN = rows.filter(r => vlOver(r.del) > 0).length;
  const vlOverQ = rows.reduce((n, r) => n + vlOver(r.del), 0);
  /* The cloth, and how many rows could not be worked out. A total quietly missing a quarter of its
   * rows is worse than one that admits it: 914 SKUs use a fabric with no width in its name, and 640
   * carry no consumption figure. */
  const sqmVals = rows.map(r => voSqm(r, vlInHand(r)));
  const vlSqm = sqmVals.filter(v => v != null).reduce((a, b) => a + b, 0);
  const vlSqmMiss = sqmVals.filter(v => v == null).length;
  /* Never-arrived rows are not waiting for anybody, so they come out of that count rather than
   * sitting in it forever. */
  const vlNever = rows.filter(r => r.del && r.del.no && !r.ok).length;
  const vlWait = rows.filter(r => !r.ok && !(r.del && r.del.no)).length;
  const undated = rows.filter(r => !r.day).length;

  $('vlKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Received from printers</span>
      <span class="kpiwhen">read live${VO.at ? ' · ' + esc(VO.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(days.length)}</div><div class="l">Days</div></div>
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Deliveries</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => r.vendorCode)).size)}</div><div class="l">Printers</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => r.orderNo)).size)}</div><div class="l">Orders</div></div>
      <div class="metric"><div class="v"${vlWait ? ' style="color:var(--bad)"' : ''}>${nf(vlWait)}</div><div class="l">Waiting to be accepted</div></div>
      ${vlNever ? `<div class="metric" title="A printer recorded these in their own portal and somebody has said the goods never came. They count for nothing and are still owed."><div class="v" style="color:var(--bad)">${nf(vlNever)}</div><div class="l">Never arrived</div></div>` : ''}
      <div class="metric"><div class="v" style="color:#166534">${nf(pcs)} <span style="font-size:12px;font-weight:400">pcs</span></div><div class="l">Received · cut</div></div>
      ${vlRet ? `<div class="metric"><div class="v" style="color:var(--bad)">${nf(vlRet)}</div><div class="l">Returned to printers</div></div>` : ''}
      ${vlOverN ? `<div class="metric" title="More arrived than the challan said, on ${nf(vlOverN)} delivery(ies). The printer is credited with what was taken in, so this is cloth or pieces being paid for beyond what they wrote down."><div class="v" style="color:#7f6000">${nf(vlOverQ)}</div><div class="l">Over the challan · ${nf(vlOverN)} delivery(ies)</div></div>` : ''}
      ${vlSqm ? `<div class="metric" title="${vlSqmMiss ? nf(vlSqmMiss) + ' delivery(ies) are not in this total — their SKU has no consumption figure, or the fabric name carries no width.' : 'Every delivery on screen is in this total.'}"><div class="v">${nf(Math.round(vlSqm))} <span style="font-size:12px;font-weight:400">m²</span></div><div class="l">Fabric received${vlSqmMiss ? ' · ' + nf(vlSqmMiss) + ' unknown' : ''}</div></div>` : ''}
      ${mtr ? `<div class="metric"><div class="v" style="color:#166534">${nf(mtr)} <span style="font-size:12px;font-weight:400">m</span></div><div class="l">Received · running</div></div>` : ''}
    </div></div>`;

  /* The tick column is only there for somebody who can act on it. */
  const canOk = vlCanAccept();
  const cols = ['Day', 'Printer', 'Order', 'SKU', 'What', 'Printer says', 'Received', 'Returned', 'Fabric m\u00b2', 'Recorded by'];
  const head = '<thead><tr>'
    + (canOk ? '<th style="width:30px"><input type="checkbox" data-vl-all title="Tick every delivery on screen"></th>' : '')
    + cols.map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 5 && i <= 8 ? ' class="num"' : '')}`
        + `${h.indexOf('Fabric') === 0 ? ' title="Cloth in the pieces actually in hand — what was kept once accepted, what the printer says until then. A tablecloth or runner by its own size (60x90 in = 3.48 m² a piece); anything else pieces x consumption x the fabric width."' : ''}>${h}</th>`).join('')
    + (canOk ? '<th></th>' : '') + '</tr></thead>';

  const body = days.map(k => {
    const list = byDay.get(k);
    const day = list[0].day;
    const p = sum(list, false), m = sum(list, true);
    /* The day's cloth. Rows it cannot work out are left out of the total rather than counted as nil. */
    const dayS = list.map(r => voSqm(r, vlInHand(r))).filter(v => v != null);
    const daySqm = dayS.length ? dayS.reduce((a, b) => a + b, 0) : null;
    /* The day's own subtotal, above its rows, so a day can be read without adding anything up. */
    const waiting = list.filter(r => !r.ok).length;
    const bar = '<tr style="background:var(--hover,#f1f5f9)">'
      + (canOk ? '<td style="background:var(--hover,#f1f5f9)"></td>' : '')
      + `<td class="frz" style="text-align:left;font-weight:700;background:var(--hover,#f1f5f9)">`
      + `${day ? esc(day) : '<span class="muted">no usable date</span>'}</td>`
      + `<td colspan="4" class="muted" style="text-align:left">${nf(list.length)} delivery(ies)`
      + `${waiting ? ' · <b style="color:var(--bad)">' + nf(waiting) + ' waiting to be accepted</b>' : ' · all accepted'}`
      + `${day ? '' : ' · the date written on these could not be read'}</td>`
      + `<td class="num" style="font-weight:700">${p ? nf(p) + ' pcs' : ''}${p && m ? ' · ' : ''}${m ? nf(m) + ' m' : ''}</td>`
      + `<td class="num" style="font-weight:700">${daySqm == null ? '' : nf(Math.round(daySqm)) + ' m²'}</td>`
      + '<td></td><td></td><td></td>' + (canOk ? '<td></td>' : '') + '</tr>';
    return bar + list.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).map(r => {
      const okQty = r.ok ? (parseFloat(r.ok.qty) || 0) : null;
      const rej = r.ok ? (parseFloat(r.ok.rej) || 0) : 0;
      /* THREE different numbers, and none of them stands in for another: what the printer said, what
       * was kept, what was sent back — and whatever is left over never arrived at all. */
      const beyond = r.ok ? (parseFloat(r.ok.beyond) || 0) : 0;
      const shortBy = r.ok ? Math.max(0, r.qty - okQty - rej - beyond) : 0;
      const over = vlOver(r.del);
      const never = r.del && r.del.no && !r.ok;
      const acc = never
        ? `<span class="pill pill-out">did not arrive</span>`
          + `<div class="muted" style="font-size:10.5px">${esc(String(r.del.no.by || '').split('@')[0])}`
          + `${r.del.no.note ? ' · ' + esc(r.del.no.note) : ''}</div>`
        : r.ok
        /* THREE COLOURS, because there are three different things to notice: short of the challan,
         * exactly the challan, and more than it. Amber for the last one — it is not an error, but it
         * is the one that costs money and it should not look identical to a clean receipt. */
        ? `<span style="font-weight:700;color:${over > 0 ? '#7f6000' : (okQty + rej < r.qty ? 'var(--bad)' : '#166534')}">${nf(okQty)}</span>`
          + (over > 0 ? `<div style="font-size:10.5px;color:#7f6000;font-weight:600" title="The printer's challan said ${nf(r.qty)} ${esc(r.unit)}. More was taken in, and they are credited for it.">+${nf(over)} over the challan</div>` : '')
          + (beyond > 0 ? `<div style="font-size:10.5px;color:#7f6000;font-weight:600" title="The printer delivered ${nf(r.qty)} ${esc(r.unit)}; the order had room for ${nf(okQty + rej)}. The rest is recorded, not credited.">${nf(beyond)} beyond the order — not accepted</div>` : '')
          + `<div class="muted" style="font-size:10.5px">${esc(String(r.ok.by || '').split('@')[0])}`
          + `${shortBy ? ' · ' + nf(shortBy) + ' short' : ''}</div>`
          + (r.ok.note ? `<div class="muted" style="font-size:10.5px">${esc(r.ok.note)}</div>` : '')
          /* Somebody changed their mind about this delivery, and that is worth seeing. */
          + ((r.ok.was && r.ok.was.length)
            ? `<div class="muted" style="font-size:10.5px" title="${esc(r.ok.was.map(w =>
                `${nf(w.qty)} kept${w.rej ? ', ' + nf(w.rej) + ' returned' : ''} — ${String(w.by || '').split('@')[0]}${w.at ? ' on ' + String(w.at).slice(0, 10) : ''}`).join(' · '))}">changed ${nf(r.ok.was.length)}×</div>`
            : '')
        : '<span class="pill pill-low">waiting</span>';
      const retCell = !r.ok ? '<span class="muted">—</span>'
        : (rej ? `<span style="font-weight:700;color:var(--bad)">${nf(rej)}</span>`
          : '<span class="muted">—</span>');
      /* Cloth in the pieces actually in hand — the kept figure once accepted, the printer's until then. */
      const sqm = voSqm(r, vlInHand(r));
      return '<tr>'
      + (canOk ? `<td>${(r.ok || never) ? '' : `<input type="checkbox" data-vl-pick="${esc(r.key2)}"${VL_PICKED.has(r.key2) ? ' checked' : ''}>`}</td>` : '')
      + '<td class="frz"></td>'
      + `<td style="text-align:left">${esc(r.vendor)}</td>`
      + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(r.orderNo)}</td>`
      + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(r.sku) || '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left">${esc(r.what)}</td>`
      + `<td class="num" style="font-weight:600">${nf(r.qty)} <span class="muted" style="font-weight:400">${esc(r.unit)}</span></td>`
      + `<td class="num">${acc}</td>`
      + `<td class="num">${retCell}</td>`
      + `<td class="num">${voSqmTxt(sqm)}</td>`
      + `<td class="muted" style="text-align:left;font-size:12px">${esc(String(r.by || '').split('@')[0]) || '—'}</td>`
      /* An accepted row is not finished with: a reject found on the table this afternoon has to be
       * recordable this afternoon. */
      + (canOk ? `<td style="white-space:nowrap">${never
          ? `<button class="ghost" data-vl-no="${esc(r.key2)}" style="padding:2px 9px;font-size:12px" title="It turned up after all — put it back among the deliveries waiting to be accepted">↺ It arrived</button>`
          : `<button class="ghost" data-vl-ok="${esc(r.key2)}" style="padding:2px 9px;font-size:12px"`
            + `${r.ok ? ' title="Change what was recorded — for pieces rejected after they were taken in"' : ''}>`
            + `${r.ok ? 'Change' : 'Accept'}</button>`
            + (r.ok ? '' : ` <button class="ghost" data-vl-no="${esc(r.key2)}" style="padding:2px 9px;font-size:12px;color:var(--bad)" title="Nothing came for this line — it counts for nothing and the printer still owes it">Didn't arrive</button>`)}</td>` : '')
      + '</tr>';
    }).join('');
  }).join('');

  $('vlTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  $('vlMsg').className = undated ? 'err' : 'muted';
  const waitingAll = rows.filter(r => !r.ok).length;
  $('vlMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} delivery(ies) · ${nf(days.length)} day(s)`
    + (waitingAll ? ` · ${nf(waitingAll)} still waiting for somebody to confirm the goods arrived` : ' · all accepted')
    + (undated ? ` · ${nf(undated)} could not have their date read and are grouped at the bottom` : '')
    + ' · cut is counted in pieces and running in metres, never added together';
}

$('vlTable').addEventListener('click', e => {
  const t = e.target.closest('[data-vl-pick]');
  if (t) {
    const k = t.getAttribute('data-vl-pick');
    if (t.checked) VL_PICKED.add(k); else VL_PICKED.delete(k);
    const b = $('vlAccept');
    if (b) { b.disabled = !VL_PICKED.size; b.textContent = VL_PICKED.size ? 'Accept ' + VL_PICKED.size : 'Accept ticked'; }
    return;
  }
  const a = e.target.closest('[data-vl-all]');
  if (a) {
    /* Only what is still waiting — an already-accepted delivery has nothing to tick. */
    (VLOG.rows || []).filter(r => !r.ok).forEach(r => { if (a.checked) VL_PICKED.add(r.key2); else VL_PICKED.delete(r.key2); });
    renderVlog();
    return;
  }
  const nn = e.target.closest('[data-vl-no]');
  if (nn) return vlNoOne(nn.getAttribute('data-vl-no'));
  const o = e.target.closest('[data-vl-ok]');
  if (o) return vlAcceptOne(o.getAttribute('data-vl-ok'));
});
$('vlAccept').onclick = vlAcceptPicked;

async function ensureVlog() {
  if (VO.rows === null) await ensureVo();
  renderVlog();
  /* THE MASTER NAMES THE CLOTH (Ravi, 2026-09-29: "tablecloth ki sizes ke liye bhi Fabric m² lagao"). A cut line's
   * square metres come from its SKU's master row, and this screen never loaded the master — so every tablecloth
   * showed a dash while running cloth, which needs no master, showed its figure. Read it, then draw again. */
  if (!PTG.mdb) { try { await ptLoadGates(); renderVlog(); } catch (e) { /* the dashes stay */ } }
}
['vlVendor', 'vlType', 'vlFrom', 'vlTo', 'vlState'].forEach(id => $(id).addEventListener('change', renderVlog));
ptDebounce('vlQ', renderVlog);
$('vlClear').onclick = () => {
  ['vlVendor', 'vlType', 'vlFrom', 'vlTo', 'vlQ', 'vlState'].forEach(id => { if ($(id)) $(id).value = ''; });
  renderVlog();
};
$('vlGo').onclick = async () => { VO.rows = null; await ensureVo(); renderVlog(); };
$('vlExport').onclick = () => {
  const rows = VLOG.rows || []; if (!rows.length) return;
  const out = [['Day', 'Printer', 'Vendor code', 'Order', 'Type', 'SKU', 'What', 'Printer says',
    'Received', 'Returned', 'Short by', 'Unit', 'Fabric m2', 'Accepted by', 'Accepted at', 'Note', 'Changed from',
    'Recorded by', 'Recorded at',
    'Date as written'].map(csvCell).join(',')];
  rows.slice().sort((a, b) => String(b.key).localeCompare(String(a.key)) || String(a.at).localeCompare(String(b.at)))
    .forEach(r => { const q = r.ok ? (parseFloat(r.ok.qty) || 0) : null;
      const rj = r.ok ? (parseFloat(r.ok.rej) || 0) : 0;
      /* Short is what is left after BOTH — kept and returned. It is not the same as either. */
      out.push([r.day, r.vendor, r.vendorCode, r.orderNo, r.run ? 'running' : 'cut', r.sku, r.what,
        r.qty, q == null ? '' : q, q == null ? '' : rj, q == null ? '' : Math.max(0, r.qty - q - rj), r.unit,
        (() => { const v = voSqm(r, vlInHand(r)); return v == null ? '' : Math.round(v * 100) / 100; })(),
        r.ok ? r.ok.by : '', r.ok ? r.ok.at : '', r.ok ? (r.ok.note || '') : '',
        r.ok && r.ok.was ? r.ok.was.map(w => `${w.qty}/${w.rej || 0} ${String(w.by || '').split('@')[0]}`).join(' | ') : '',
        r.by, r.at, r.raw].map(csvCell).join(',')); });
  ptDownload('vendor-received-by-day', out);
};

/** A printer's standing order — the one Order Console assignments go on (VPO-SHOP-<code>). */
const voIsStanding = o => /^vpo_shop_/.test(String((o && o.id) || ''));
/**
 * Where an order sits in the list: when it was raised — or, for a printer's standing order, when lines
 * were last put on it. It is raised once and filled for weeks; sorted by its first day it sank below every
 * order raised since, and a line assigned this morning looked as if it had gone nowhere.
 */
function voSortMs(o) {
  const raised = ptDtMs(o && o.orderDate) || 0;
  if (!voIsStanding(o)) return raised;
  const t = Date.parse((o && o.staffUpdatedAt) || '');
  return Math.max(raised, isFinite(t) ? t : 0);
}

function renderVo() {
  /* The same button, named for what it will do for this account. */
  if ($('voNew')) $('voNew').textContent = vrqCanApprove() ? '+ New vendor order' : '+ Request vendor order';
  if (VO.busy) { $('voMsg').className = 'muted'; $('voMsg').textContent = 'Reading the vendor orders…'; ptEmpty('voTable', 'Loading…'); return; }
  if (VO.err) { $('voMsg').className = 'err'; $('voMsg').textContent = 'Could not read it: ' + VO.err; ptEmpty('voTable', 'Nothing to show.'); $('voKpis').innerHTML = ''; return; }
  const all = VO.rows || [];
  if (!all.length) { $('voMsg').className = 'muted'; $('voMsg').textContent = ''; $('voKpis').innerHTML = ''; ptEmpty('voTable', 'No vendor orders.'); return; }

  // Both pickers are filled from the data — a status the tool starts using tomorrow appears on its own.
  /* Every vendor who has placed an order — filling firms and fabricators as much as printers, now
   * that job work goes out on the same orders. */
  ptFillSelect('voVendor', [...new Set(all.map(o => o.vendorCode))].sort().map(c => [c, voName(c)]), 'All vendors');
  /* CANCELLED IS ALWAYS OFFERED, even when nothing is cancelled today — it is the one status
   * somebody comes here looking for, and a picker that hides it depending on the data is a picker
   * you cannot rely on. */
  ptFillSelect('voStatus', [...new Set(all.map(o => o.status).filter(Boolean).concat(['Cancelled']))].sort().map(s => [s, s]),
    'All except cancelled');

  const db = $('voDelPicked'); if (db) db.style.display = ME.admin ? '' : 'none';

  const vf = $('voVendor').value, sf = $('voStatus').value, tf = $('voType').value;
  const q = $('voQ').value.trim().toLowerCase();
  const rows = all
    /* A cancelled order is not part of today's work, so it does not sit in the middle of it — every
     * count and every scroll would carry something nobody is doing. Ask for it by name and it is
     * there; nothing is deleted and nothing is hidden. */
    .filter(o => (sf ? o.status === sf : o.status !== 'Cancelled'))
    .filter(o => (!vf || o.vendorCode === vf) && (!tf || (o.orderType || 'cut') === tf))
    .map(o => ({ o, s: voSummary(o) }))
    .filter(({ o }) => !q || [o.orderNo, o.id, o.vendorCode, voName(o.vendorCode), o.status].join(' ').toLowerCase().includes(q)
      || voLines(o).some(l => [l.sku, l.color, l.fabricType, l.articleSubtype].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => voSortMs(b.o) - voSortMs(a.o) || String(a.o.orderNo || '').localeCompare(String(b.o.orderNo || '')));
  VO.shown = rows;

  const tot = run => rows.filter(({ o }) => voRunning(o) === run)
    .reduce((a, { s }) => ({ o: a.o + s.ordered, d: a.d + s.done }), { o: 0, d: 0 });
  const pcs = tot(false), mtr = tot(true);
  const stale = rows.reduce((n, { s }) => n + s.stale, 0);
  const unknown = [...new Set(rows.map(x => x.o.vendorCode).filter(c => !voKnown(c)))];

  /* THE CARD OF EIGHT BIG FIGURES IS GONE. Filtered to one order it was that order's own line
   * repeated without its number, and the card below says it better because it says which order it is
   * about. Its totals live on the count line now — one line, not a hundred pixels. */
  $('voKpis').innerHTML = '';

  /* The attribute pickers are filled from the lines that are actually on screen, so a colour nobody
   * has ordered is never offered. */
  const shownLines = rows.flatMap(({ o }) => voLines(o));
  ptFillSelect('voAt', [...new Set(shownLines.map(l => l.articleType).filter(Boolean))].sort().map(x => [x, x]), 'All article types');
  ptFillSelect('voSub', [...new Set(shownLines.map(l => l.articleSubtype).filter(Boolean))].sort().map(x => [x, x]), 'All subtypes');
  ptFillSelect('voCol', [...new Set(shownLines.map(l => l.color).filter(Boolean))].sort().map(x => [x, x]), 'All colours');
  ptFillSelect('voSz', [...new Set(shownLines.map(l => l.size).filter(Boolean))].sort().map(x => [x, x]), 'All sizes');
  ptFillSelect('voPri', [...new Set(shownLines.map(l => String(l.priority || '').trim().toUpperCase()).filter(Boolean))].sort().map(x => [x, x]), 'All priorities');

  const cards = ($('voView') || {}).value === 'cards';
  $('voAttrRow').classList.toggle('hide', !cards);
  $('voTableWrap').classList.toggle('hide', cards);
  $('voCards').classList.toggle('hide', !cards);
  if (cards) { renderVoCards(rows); return; }

  /* The tick column exists only for somebody who can act on it. Offering it to a reader would be a
   * control that does nothing, which this app treats as a bug elsewhere and should here too. */
  const pick = !!ME.admin;
  const head = '<thead><tr>'
    + (pick ? '<th style="width:30px"><input type="checkbox" data-vo-all title="Tick every order on screen"'
        + ((VO.shown || []).length && (VO.shown || []).every(({ o }) => VO_PICKED.has(o.vendorCode + '/' + o.id)) ? ' checked' : '')
        + '></th>' : '')
    + ['Vendor', 'Order', 'Type', 'Status', 'Raised', 'Last dispatch', 'Lines', 'Ordered', 'Delivered', 'Owed', 'Progress', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 6 && i <= 9 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('voTable').innerHTML = head + '<tbody>' + rows.map(({ o, s }) => {
    const u = `<span class="muted" style="font-size:11px">${voUnit(o)}</span>`;
    // Nothing left owing reads as done; "Placed" is not started; anything else is under way.
    const cls = s.owed <= 0 ? 'pill-ok' : (o.status === 'Placed' ? '' : 'pill-low');
    const key = o.vendorCode + '/' + o.id;
    return '<tr>'
      + (pick ? `<td><input type="checkbox" data-vo-pick="${esc(key)}"${VO_PICKED.has(key) ? ' checked' : ''}></td>` : '')
      + `<td class="frz" style="text-align:left;font-weight:600">${esc(voName(o.vendorCode))}`
      + `${voKnown(o.vendorCode) ? '' : ' <span class="pill pill-out">unknown code</span>'}</td>`
      + `<td style="text-align:left">${esc(o.orderNo || o.id)}</td>`
      + `<td>${esc(o.orderType || 'cut')}</td>`
      + `<td><span class="pill ${cls}">${esc(o.status || '—')}</span></td>`
      + `<td>${esc(o.orderDate) || '<span class="muted">—</span>'}${voIsStanding(o) ? `<div><span class="pill" title="The printer's standing order: every line given to them from the Order Console goes on it">assigned lines</span>${o.staffUpdatedAt ? ` <span class="muted" style="font-size:11px">added ${esc(new Date(o.staffUpdatedAt).toLocaleDateString('en-GB'))}</span>` : ''}</div>` : ''}</td>`
      + `<td>${esc(o.lastDispatchDate || o.dispatchDate) || '<span class="muted">not yet</span>'}</td>`
      + `<td class="num">${nf(s.live)}${s.cancelled ? ` <span class="pill pill-out">${nf(s.cancelled)} cancelled</span>` : ''}</td>`
      + `<td class="num" style="font-weight:700">${nf(s.ordered)} ${u}</td>`
      + `<td class="num" style="color:#166534">${nf(s.done)} ${u}</td>`
      + `<td class="num"${s.owed ? ' style="color:var(--bad);font-weight:700"' : ''}>${s.owed ? nf(s.owed) + ' ' + u : '<span class="muted">nothing</span>'}</td>`
      + `<td><div style="font-weight:700">${s.pct}%</div>`
      + `<div style="height:4px;background:var(--line);border-radius:3px;margin-top:3px">`
      + `<div style="height:4px;width:${Math.min(100, s.pct)}%;background:#166534;border-radius:3px"></div></div></td>`
      + `<td style="white-space:nowrap">`
      + voMovePill(o)
      + `<button class="ghost" data-vo-open="${esc(o.vendorCode + '/' + o.id)}" style="padding:3px 9px;font-size:12px">${ME.admin ? 'Open / edit' : 'Open'}</button>`
      + `${ME.admin && o.status !== 'Received' && o.status !== 'Cancelled' ? ` <button class="ghost" data-vo-recv="${esc(o.vendorCode + '/' + o.id)}" style="padding:3px 9px;font-size:12px">Received</button>` : ''}`
      + `${ME.admin && o.status !== 'Cancelled' ? ` <button class="ghost" data-vo-move="${esc(o.vendorCode + '/' + o.id)}" style="padding:3px 9px;font-size:12px">Move</button>` : ''}`
      + `${ME.admin && o.status !== 'Cancelled' ? ` <button class="ghost" data-vo-cxl="${esc(o.vendorCode + '/' + o.id)}" style="padding:3px 9px;font-size:12px;color:var(--bad)">Cancel</button>` : ''}`
      + `</td></tr>`;
  }).join('') + '</tbody>';

  $('voMsg').className = (stale || unknown.length) ? 'err' : 'muted';
  /* The count, and then only what is actually wrong. The two sentences that used to sit here every
   * time — how delivered is worked out, and that pieces and metres are never added — were written for
   * a first read and printed on every one after it. */
  /* What the cards below cannot tell you: the total across all of them, and how many vendors that
   * is. Pieces and metres stay apart — added together they would be a number of nothing. */
  const sum = (o, d, u) => o ? ` · ${nf(o)} ${u} ordered, ${nf(d)} delivered, ${nf(Math.max(0, o - d))} owed` : '';
  const vend = new Set(rows.map(x => x.o.vendorCode)).size;
  $('voMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} order(s) · `
    + `${nf(rows.reduce((n, x) => n + x.s.lines, 0))} line(s)`
    + (rows.length > 1 ? ` · ${nf(vend)} vendor(s)` : '')
    + sum(pcs.o, pcs.d, 'pcs') + sum(mtr.o, mtr.d, 'm')
    + (stale ? ` · on ${nf(stale)} line(s) the stored figure disagrees with the deliveries, and the deliveries are trusted` : '')
    + (unknown.length ? ` · vendor code(s) ${unknown.join(', ')} are not in the vendor list, so only the code can be shown` : '');
}

function voOpen(key) {
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id); if (!o) return;
  const s = voSummary(o), run = voRunning(o), u = voUnit(o);
  const lines = voLines(o).slice(0, 500);
  const editable = !!ME.admin && o.status !== 'Cancelled';
  const dels = voDeliveredCount(o);
  /* The dialog's own copy of which lines are cancelled, so a row can be toggled and redrawn without
   * a checkbox to lose. Seeded from the order as it stands. */
  VOE = { key: o.vendorCode + '/' + o.id, lines: null,
    cancel: new Set(voLines(o).map((l, i) => (l.cancelled ? i : -1)).filter(i => i >= 0)) };

  /* The tracker's columns, in the tracker's order, plus Delivery — which voEditRow draws, so this
   * header and the card's have to carry it or every row runs one cell past its heading. */
  const head = (run ? ['Fabric', 'Colour', 'Print'] : ['SKU', 'Image', 'Article'])
    .concat(['Priority', 'Ordered', 'Vendor Qty', 'Balance', 'Delivery', 'Inwards Conf.', '\u0394'])
    .concat(editable ? ['Line'] : [])
    .map(h => `<th${['Ordered', 'Vendor Qty', 'Balance', 'Inwards Conf.', '\u0394'].indexOf(h) >= 0 ? ' class="num"' : ''}>${h}</th>`).join('');
  const tableHtml = () => `<table class="xl"><thead><tr>${head}</tr></thead><tbody>`
    + lines.map((l, i) => voEditRow(o, l, i, editable)).join('') + '</tbody></table>';
  ptOpenDialog({
    title: 'Vendor order ' + (o.orderNo || o.id),
    subtitle: `${voName(o.vendorCode)}  ·  ${o.orderType || 'cut'}  ·  raised ${o.orderDate || '—'}`
      + `${o.createdBy ? '  ·  by ' + String(o.createdBy).split('@')[0] : ''}`,
    note: `${nf(s.live)} live line(s) · ordered ${nf(s.ordered)} ${u} · delivered ${nf(s.done)} ${u} · still owed ${nf(s.owed)} ${u}.`
      + (s.cancelled ? ` ${nf(s.cancelled)} line(s) worth ${nf(s.cancelledQty)} ${u} were cancelled and are shown greyed, not removed.` : '')
      + (s.stale ? ` On ${nf(s.stale)} line(s) the stored dispatched figure disagrees with the deliveries; the deliveries are used.` : '')
      + (o.notes ? ` Notes: ${o.notes}` : ''),
    html: `<div class="xlwrap" id="voeWrap" style="max-height:52vh;border:1px solid var(--line);border-radius:10px">`
      + tableHtml() + '</div>'
      + (voLines(o).length > 500 ? `<div class="muted" style="margin-top:8px;font-size:12px">Showing the first 500 of ${nf(voLines(o).length)} lines. Export gives you all of them.</div>` : '')
      /* Where the two right-hand columns come from, said once. The tracker keeps a line-level
       * confirmedQty; this app accepts a challan round by round in the History tab, and both are
       * read — so a delivery accepted in either tool shows here. */
      + '<div class="muted" style="margin-top:8px;font-size:12px">'
      + '<b>Delivery</b> is the date the VENDOR promised, with what we asked for underneath — planning runs '
      + 'on theirs, because it is the only date anybody agreed to. A line they have not answered says so, '
      + 'and one they have moved says how often. '
      + '<b>Vendor Qty</b> is what the printer says it sent, across its rounds. <b>Inwards Conf.</b> is what '
      + 'was actually accepted, and <b>&Delta;</b> is the gap between the two. Accepting a delivery is done in '
      + 'the History tab, against the challan — so this column is read-only here.'
      + (editable ? ' Changing a quantity changes what the printer sees in their own portal.' : '')
      + '</div>',
    /* A FILLING ORDER CAN BE TOLD ITS FILLER AFTER THE FACT. The order form asks for it now, but every
     * filling order raised before it did carries none, and a firm that prices two fillers cannot be
     * paid for a line that does not say which. */
    fields: editable ? (voIsFilling(o) ? [{ key: 'filler', label: o.filler ? 'Filler' : 'Filler — NOT SET, so these lines are priced by nothing',
      value: o.filler || '', list: prKnown('filler') }] : [])
      .concat([{ key: 'notes', label: 'Notes for this order', value: o.notes || '', span: true }]) : [],
    onSave: editable ? voEditSave : null,
    saveLabel: 'Save changes',
    /* Delete is offered only where it destroys nothing: an order that has taken a delivery keeps the
     * receiving logbook honest, and Cancel is the right answer for it. */
    onDelete: (ME.admin && !dels) ? (async () => {
      if (!confirm('Delete ' + (o.orderNo || o.id) + '?\n\nIt disappears from this list and from the '
        + 'printer\'s portal. Nothing has been delivered against it, so no receiving history is lost. '
        + 'This cannot be undone.')) return 'stay';
      const err = await voDelete(o.vendorCode + '/' + o.id);
      if (err) return err;
      $('voMsg').className = 'muted';
      $('voMsg').textContent = (o.orderNo || o.id) + ' deleted.';
      return '';
    }) : null,
    adminNote: dels
      ? `${nf(dels)} delivery(ies) are recorded against this order, so it cannot be deleted — that would `
        + 'take them out of the receiving logbook too. Cancel it instead.'
      : 'Changing a quantity changes what the printer sees in their own portal.',
  });
  /* A line is cancelled or restored in place: the flag lives in VOE.cancel and the table is redrawn,
   * so the Ordered boxes already typed into are re-read from the DOM first and not lost. */
  const redraw = () => {
    const typed = {};
    document.querySelectorAll('[data-voe]').forEach(el => { typed[el.getAttribute('data-voe')] = el.value; });
    const wrap = $('voeWrap'); if (!wrap) return;
    wrap.innerHTML = tableHtml();
    document.querySelectorAll('[data-voe]').forEach(el => {
      const k = el.getAttribute('data-voe');
      if (typed[k] !== undefined) el.value = typed[k];
    });
    if (!run) ptImgFill(lines.map(l => l.sku), false, ptImgPatch);
  };
  const wrap = $('voeWrap');
  if (wrap && editable) {
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-voetog]'); if (!b) return;
      const i = parseInt(b.getAttribute('data-voetog'), 10);
      if (VOE.cancel.has(i)) VOE.cancel.delete(i); else VOE.cancel.add(i);
      redraw();
    });
  }
  if (!run) ptImgFill(lines.map(l => l.sku), false, ptImgPatch);
}

$('voTable').addEventListener('click', e => {
  /* The tick box is not a row click — ticking an order must not also open it. */
  const t = e.target.closest('[data-vo-pick]');
  if (t) {
    const k = t.getAttribute('data-vo-pick');
    if (t.checked) VO_PICKED.add(k); else VO_PICKED.delete(k);
    const n = VO_PICKED.size;
    const db = $('voDelPicked');
    if (db) { db.disabled = !n; db.textContent = n ? 'Delete ' + n : 'Delete'; }
    return;
  }
  const a = e.target.closest('[data-vo-all]');
  if (a) {
    (VO.shown || []).forEach(({ o }) => { const k = o.vendorCode + '/' + o.id;
      if (a.checked) VO_PICKED.add(k); else VO_PICKED.delete(k); });
    renderVo();
    return;
  }
  const b = e.target.closest('[data-vo-open]'); if (b) return voOpen(b.getAttribute('data-vo-open'));
  const r = e.target.closest('[data-vo-recv]');
  if (r) return voConfirmStatus(r.getAttribute('data-vo-recv'), 'Received');
  const mv = e.target.closest('[data-vo-move]');
  if (mv) return voMoveOpen(mv.getAttribute('data-vo-move'));
  const c = e.target.closest('[data-vo-cxl]');
  if (c) return voConfirmStatus(c.getAttribute('data-vo-cxl'), 'Cancelled');
});

/* Both of these are visible to the vendor and change what counts against the printer cap, so the
 * confirmation says what happens rather than asking "are you sure?". */
async function voConfirmStatus(key, status) {
  if (!confirm(status === 'Cancelled'
    ? 'Cancel this order?\n\nThe vendor will see it as cancelled, and its pieces stop counting against '
      + 'what may still be ordered for those SKUs.'
    : 'Mark this order as fully received?\n\nIt stays on the list with everything it was ordered for.')) return;
  const err = await voSetStatus(key, status);
  if (err) { $('voMsg').className = 'err'; $('voMsg').textContent = err; }
}
['voVendor', 'voStatus', 'voType', 'voView', 'voAt', 'voSub', 'voCol', 'voSz', 'voPri']
  .forEach(id => $(id).addEventListener('change', renderVo));
$('voAttrClear').onclick = () => {
  ['voAt', 'voSub', 'voCol', 'voSz', 'voPri'].forEach(id => { $(id).value = ''; });
  renderVo();
};
/* The cards carry their own Open / edit buttons, and they are redrawn on every filter change. */
/* Which lines are ticked, per order. Kept outside the render because the render redraws every row,
 * and a checkbox would lose its state the moment anything else changed. */
$('voCards').addEventListener('change', e => {
  const one = e.target.closest('[data-vopick]');
  if (one) {
    const key = one.getAttribute('data-vopick'), i = parseInt(one.getAttribute('data-i'), 10);
    VO.pick = VO.pick || {};
    const set = VO.pick[key] || (VO.pick[key] = new Set());
    if (one.checked) set.add(i); else set.delete(i);
    if (!set.size) delete VO.pick[key];
    renderVo();
    return;
  }
  const all = e.target.closest('[data-vopickall]');
  if (all) {
    const key = all.getAttribute('data-vopickall');
    VO.pick = VO.pick || {};
    if (!all.checked) { delete VO.pick[key]; renderVo(); return; }
    /* WHAT IS SHOWN, not every line of the order: a filtered card showing four of a hundred lines
     * must not quietly tick the other ninety-six. */
    const set = new Set();
    document.querySelectorAll(`[data-vopick="${key}"]`).forEach(el => set.add(parseInt(el.getAttribute('data-i'), 10)));
    VO.pick[key] = set;
    renderVo();
  }
});

$('voCards').addEventListener('click', async e => {
  const b = e.target.closest('[data-vo-open]');
  if (b) return voOpen(b.getAttribute('data-vo-open'));

  const clr = e.target.closest('[data-voclearpick]');
  if (clr) { if (VO.pick) delete VO.pick[clr.getAttribute('data-voclearpick')]; return renderVo(); }

  /* The whole order: the same two acts the one-row list offers, said the same way. */
  const rv = e.target.closest('[data-vo-recv]');
  if (rv) return voConfirmStatus(rv.getAttribute('data-vo-recv'), 'Received');
  const cx = e.target.closest('[data-vo-cxl]');
  if (cx) return voConfirmStatus(cx.getAttribute('data-vo-cxl'), 'Cancelled');

  const q = e.target.closest('[data-voqtysave]');
  if (q) {
    q.disabled = true;
    const err = await voSaveQty(q.getAttribute('data-voqtysave'));
    if (err) { $('voMsg').className = 'err'; $('voMsg').textContent = err; }
    const again = document.querySelector(`[data-voqtysave="${q.getAttribute('data-voqtysave')}"]`);
    if (again) again.disabled = false;
    return;
  }

  const c = e.target.closest('[data-vocancel]'), rs = e.target.closest('[data-vorestore]');
  if (!c && !rs) return;
  const on = !!c;
  const key = (c || rs).getAttribute(on ? 'data-vocancel' : 'data-vorestore');
  const picked = voPicked(key);
  if (!picked || !picked.size) return;
  /* Named, not "are you sure?" — a cancelled line stops being counted anywhere, and the vendor sees
   * it struck through in their portal the next time they look. */
  if (on && !confirm(`Cancel ${nf(picked.size)} line(s) on this order?\n\n`
    + 'They stop counting toward the order, and the vendor sees them struck through in their portal.'
    + '\n\nThe rest of the order is untouched.')) return;
  (c || rs).disabled = true;
  const err = await voCancelPicked(key, on);
  if (err) { $('voMsg').className = 'err'; $('voMsg').textContent = err; }
  const btn = document.querySelector(`[data-${on ? 'vocancel' : 'vorestore'}="${key}"]`);
  if (btn) btn.disabled = false;
});
$('voDelPicked').onclick = voDeletePicked;
ptDebounce('voQ', renderVo);
$('voGo').onclick = async () => { VO.rows = null; await ensureVo(); };
$('voExport').onclick = () => {
  const rows = VO.shown || []; if (!rows.length) return;
  /* THE LINES ON SCREEN. In "Current orders — with lines" the article, colour, size and priority
   * pickers narrow the lines inside each order; the file follows them, or a P1-only view would
   * download every priority. */
  const f = voAttrF(), on = ($('voView') || {}).value === 'cards' && voAttrOn(f);
  const out = [['Vendor', 'Vendor code', 'Order', 'Type', 'Order status', 'Raised', 'SKU', 'Fabric', 'Item',
    'Colour', 'Size', 'Priority', 'Unit', 'Ordered', 'Delivered', 'Owed', 'Due', "Vendor's date", 'Deliveries', 'Cancelled'].map(csvCell).join(',')];
  rows.forEach(({ o }) => voLines(o).filter(l => !on || voLineMatches(l, f)).forEach(l => {
    const q0 = voQty(o, l), d0 = voDone(l);
    out.push([voName(o.vendorCode), o.vendorCode, o.orderNo || o.id, o.orderType || 'cut', o.status,
      o.orderDate, l.sku, l.fabricType, l.articleSubtype || l.articleType, l.color, l.size,
      String(l.priority || '').trim().toUpperCase(), voUnit(o),
      q0, d0, l.cancelled ? 0 : Math.max(0, q0 - d0), l.deliveryDate, voProm(l),
      voDels(l).map(d => d.date + ':' + d.qty).join(' | '), l.cancelled ? 'yes' : 'no'].map(csvCell).join(','));
  }));
  if (out.length < 2) return;
  ptDownload('vendor-orders', out);
};

