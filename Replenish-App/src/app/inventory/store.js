/* ================= THE STORE =================
 *
 * Ravi, 2026-09-22: "jo goods mujhe received hua printers se wo direct yaha aakar store hona chahiye …
 * ek cross check ka option … current store me jitna bhi goods pada h (jo ki pcs me aata h) wo me manually
 * upload kar dunga … store stock balance ka in out job work register se … fabric ka in out cutting data se
 * … cutting se wastage bachega wo bhi again store me aana chahiye."
 *
 * WHAT THE STORE HOLDS: what the factory has BEFORE stitching — printed cloth in metres, and pieces
 * ready to be given out. Finished Goods stays what it is: what is made, pressed, checked and shipped.
 *
 * NOTHING HERE IS TYPED TWICE. Four of the five movements are read off registers the floor already
 * keeps, and worked out fresh on every draw, so correcting a cutting entry corrects the store:
 *
 *   IN   a printer's delivery        — accepted figure if the office has answered it, else what they sent
 *   IN   pieces cut                  — only where the cloth was printed first (a cut-printed piece comes
 *                                      back from the printer instead, and counting both would count twice)
 *   IN   cutting waste               — the strip left on the table, with how wide it is
 *   OUT  cut cloth                   — metres the cutting table took, where the cloth was printed first
 *   OUT  pieces issued to a karigar  — the Job Work Register's issue. What comes BACK is not a store
 *                                      movement: Ravi's rule, because it goes on to press, QC and FG.
 *
 * and the fifth is typed: the opening stock, and any correction, in pt_storeLedger.
 *
 * FROM WHEN: from the first opening entry. Before that the registers describe a store this screen was
 * not keeping, and counting them would produce a balance nobody recognises. With no opening stock at
 * all, from ST_FROM_NO_OPENING — the day the store was set up.
 */
let STORE = { rows: null, checks: null, err: '', busy: false, at: '' };
/**
 * The day the store was set up. With no opening stock, nothing before it is counted.
 *
 * Counting from the beginning of time made every karigar issue ever booked an OUT against a store
 * that never had the IN for it: 1,401 of 1,669 items below zero, -43,122 pieces, and a table that took
 * the page down with it. From here, a printer's delivery received today still shows — which is what
 * counting without an opening stock was for — and the years before the store existed do not.
 */
const ST_FROM_NO_OPENING = '2026-09-22';
const ST_UNITS = { pcs: 'pcs', m: 'm' };
/* Rows drawn in the balance table — the ceiling every other register here uses. */
const ST_MAX_ROWS = 600;
const stNum = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const stKey = r => (r.unit === 'pcs' ? 'P|' + obUC(r.sku) : 'M|' + fabKey(r.fabric) + '|' + fabKey(r.colour));
const stName = r => (r.unit === 'pcs' ? obUC(r.sku) : [String(r.fabric || '').trim(), String(r.colour || '').trim()].filter(Boolean).join(' · '));

/**
 * Read the store, ONCE, however many things ask at the same time.
 *
 * This was a loop that took the page down. It drew the screen to say "loading" before it had marked
 * itself as loading, drawing the screen is renderStore, and renderStore — finding the store still
 * empty — asked for it again. Fifteen hundred levels deep, until the stack ran out, and then every
 * level started its own reads: 7,594 of them for one open of the tab, the 2.2 MB Job Work register
 * 1,518 times over. That is the "Failed to fetch" and the frozen machine. Now the load is marked
 * before anything is drawn, and a second caller waits on the first.
 */
let STORE_LOADING = null;
async function ensureStore(force) {
  if (STORE_LOADING) return STORE_LOADING;
  if (STORE.rows !== null && !force) { renderFab(); return; }
  STORE_LOADING = ensureStoreRead().finally(() => { STORE_LOADING = null; });
  return STORE_LOADING;
}
async function ensureStoreRead() {
  STORE.busy = true;                       // BEFORE anything is drawn — see above
  renderFab();
  const errs = [];
  try { STORE.rows = ptList(await ptGet('pt_storeLedger')); } catch (e) { errs.push('the store book (' + (e.message || e) + ')'); STORE.rows = STORE.rows || []; }
  try { STORE.checks = (await ptGet('pt_storeChecks')) || {}; } catch (e) { STORE.checks = STORE.checks || {}; }
  if (!PTG.mdb) { try { await ptLoadGates(); } catch (e) { errs.push('the master database'); } }
  if (!PT.base) { try { PT.base = ptList(await ptGet('pt_baseData')); } catch (e) { errs.push('the Job Work Register'); } }
  if (VO.rows === null) { try { await ensureVo(); } catch (e) { errs.push('the printers\' orders'); } }
  STORE.err = errs.length ? 'Could not read ' + errs.join(' or ') + '.' : '';
  STORE.at = ptStamp(); STORE.busy = false;
  renderFab();
}

/** Is this SKU made by a printer (any live cut line for it)? Unknown — false — while the printers' orders are not read. */
const stPrinterSku = sku => {
  const s = obUC(sku);
  return !!s && (VO.rows || []).some(o => o && o.status !== 'Cancelled' && voLines(o).some(l => l && !l.cancelled && voKind(l) === 'cut' && obUC(l.sku) === s));
};

/** The day the store opened: the first opening entry anybody typed. '' while there is none. */
function stStart() {
  let first = '';
  (STORE.rows || []).forEach(r => {
    if (!r || r.kind !== 'OPENING') return;
    const t = String(r.at || '');
    if (t && (!first || t < first)) first = t;
  });
  return first;
}

/** The cloth and the metres one cutting entry took, and the pieces it made. */
function stCutting(c) {
  const pcs = stNum(c.pieces);
  const m = mdbOf(c.sku);
  /* A piece whose cloth is printed AFTER cutting leaves the store when the printer is given it, and
   * comes back as the printer's delivery — so the cutting itself moves nothing here. */
  const running = !!m && ptPrintIssueAs(m) === 'running';
  const typed = parseFloat(c.fabricUsed);
  let fabric = String(c.fabricWidth || '').trim(), metres = isFinite(typed) && typed > 0 ? typed : 0;
  if (!metres || !fabric) {
    const p = m ? ptConsPlan(m) : { why: 'no master row' };
    if (!p.why) { fabric = fabric || p.fabric; if (!metres) metres = Math.round(p.metres * pcs * 100) / 100; }
  }
  return { running, pcs, fabric, colour: c.color || '', metres: Math.round(metres * 100) / 100, waste: stNum(c.fabricWaste), wasteWidth: stNum(c.fabricWasteWidth) };
}

/** Every movement of the store, oldest first. Built, never stored. */
function stMoves() {
  const start = stStart();
  const out = [];
  const day = at => ptIsoDate(at) || String(at || '').slice(0, 10);
  (STORE.rows || []).forEach(r => {
    if (!r) return;
    const q = stNum(r.qty);
    if (!q) return;
    out.push({ src: 'typed', id: r.id || r._key, unit: r.unit === 'm' ? 'm' : 'pcs', sku: r.sku || '', fabric: r.fabric || '', colour: r.colour || '',
      qty: r.kind === 'OUT' ? -Math.abs(q) : (r.kind === 'ADJUST' ? q : Math.abs(q)),
      what: r.kind === 'OPENING' ? 'Opening stock' : r.kind === 'OUT' ? 'Taken out by hand' : r.kind === 'ADJUST' ? 'Correction' : 'Taken in by hand',
      date: r.date || day(r.at), at: r.at || '', who: r.by || '', remark: r.remark || '' });
  });
  /* NO OPENING STOCK IS NOT A REASON TO RECORD NOTHING. Without one, the register still holds
   * everything that has moved — it simply is not the shelf yet, and the screen says so. Movements
   * before the opening stock ARE dropped, because the opening figure already contains them. */
  /* THE PRINTERS' GOODS ARE COUNTED FROM THEIR FIRST DELIVERY ON RECORD (2026-09-26). The 22 Sep start left 29 pieces
   * delivered the week before uncounted, and every issue after it read as a hole. With an opening stock typed, what
   * came before it is still dropped — the opening figure already holds it. */
  const from = start || '';
  /* ---- what the printers sent ---- */
  voLogRows().forEach(r => {
    const at = String((r.ok && r.ok.at) || r.at || '');
    if (!at || at <= from) return;
    const q = r.ok ? stNum(r.ok.qty) : stNum(r.qty);
    if (!(q > 0)) return;
    out.push({ src: 'printer', id: r.key2, checkKey: r.key2, unit: r.unit, sku: r.sku, fabric: r.fabric, colour: r.colour || '', printer: r.vendor || '',
      qty: q, what: 'From ' + r.vendor + (r.ok ? ' · accepted' : ' · as sent'), date: r.day || day(at), at, who: (r.ok && r.ok.by) || r.by || '', remark: r.orderNo || '' });
  });
  /* ---- the cutting table ---- */
  (PT.cut || []).forEach(c => {
    const at = String(c.addedAt || '');
    if (!at || at <= from) return;
    const k = stCutting(c);
    if (k.running && k.metres > 0 && k.fabric) {
      out.push({ src: 'cut', id: 'cut-' + c.id, unit: 'm', fabric: k.fabric, colour: k.colour, sku: '',
        qty: -k.metres, what: 'Cut ' + nf(k.pcs) + ' × ' + (c.articleSubtype || c.sku || ''), date: ptIsoDate(c.cutDate) || day(at), at, who: c.addedBy || '', remark: c.orderNo || '' });
      out.push({ src: 'cut', id: 'cutp-' + c.id, unit: 'pcs', sku: c.sku, fabric: '', colour: '',
        qty: k.pcs, what: 'Cut from ' + k.fabric, date: ptIsoDate(c.cutDate) || day(at), at, who: c.addedBy || '', remark: c.orderNo || '' });
    }
    if (k.waste > 0 && k.fabric) {
      out.push({ src: 'waste', id: 'waste-' + c.id, unit: 'm', fabric: k.fabric, colour: k.colour, sku: '',
        qty: k.waste, what: 'Waste back from cutting' + (k.wasteWidth > 0 ? ' · ' + nf(k.wasteWidth) + '" wide' : ''),
        date: ptIsoDate(c.cutDate) || day(at), at, who: c.addedBy || '', remark: c.orderNo || '' });
    }
  });
  /* ---- pieces given to a karigar ---- */
  (PT.base || []).forEach(r => {
    const at = String(r.addedAt || '');
    if (!at || at <= from) return;
    const q = stNum(r.issuePieces);
    if (!(q > 0)) return;
    out.push({ src: 'jobwork', id: 'jw-' + r.id, unit: 'pcs', sku: r.sku, fabric: '', colour: '',
      qty: -q, what: 'Issued to ' + (r.empName || 'a karigar'), date: ptIsoDate(r.issueDate) || day(at), at, who: r.addedBy || '', remark: r.orderNo || '' });
  });
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** One line per thing that has moved, with where it came from and where it went, source by source. */
function stBalances(moves) {
  const by = new Map();
  (moves || []).forEach(mv => {
    const k = stKey(mv);
    let e = by.get(k);
    if (!e) { e = { key: k, unit: mv.unit, sku: mv.sku, fabric: mv.fabric, colour: mv.colour, name: stName(mv), inQty: 0, outQty: 0, qty: 0, n: 0, last: '',
      fromPrinter: 0, cutIn: 0, cutOut: 0, issued: 0, typed: 0, beyond: 0, printers: new Set() }; by.set(k, e); }
    e.n++;
    if (mv.qty >= 0) e.inQty += mv.qty; else e.outQty += -mv.qty;
    /* AN ISSUE TAKES ONLY WHAT THE PRINTERS' GOODS HOLD. Pieces given to a karigar beyond that came from somewhere
     * else — older stock, or the same SKU cut and stitched from white in-house — and are counted as "beyond", never
     * as a shelf below zero. Movements arrive oldest first, so an issue before the first delivery is all beyond. A
     * figure somebody typed (opening, out by hand, correction) goes exactly where it was typed. */
    if (mv.qty < 0 && (mv.src === 'jobwork' || mv.src === 'cut')) {
      const take = Math.min(-mv.qty, Math.max(0, e.qty));
      e.qty -= take; e.beyond += (-mv.qty - take);
    } else e.qty += mv.qty;
    if (mv.src === 'printer') { e.fromPrinter += mv.qty; if (mv.printer) e.printers.add(mv.printer); }
    else if (mv.src === 'cut') { if (mv.qty >= 0) e.cutIn += mv.qty; else e.cutOut += -mv.qty; }
    else if (mv.src === 'waste') e.cutIn += mv.qty;
    else if (mv.src === 'jobwork') e.issued += -mv.qty;
    else if (mv.src === 'typed') e.typed += mv.qty;
    if (String(mv.at) > e.last) e.last = String(mv.at);
    if (!e.sku && mv.sku) e.sku = mv.sku;
  });
  const r2 = v => Math.round(v * 100) / 100;
  return [...by.values()].map(e => Object.assign(e, { qty: r2(e.qty), inQty: r2(e.inQty), outQty: r2(e.outQty),
      fromPrinter: r2(e.fromPrinter), cutIn: r2(e.cutIn), cutOut: r2(e.cutOut), issued: r2(e.issued), typed: r2(e.typed), beyond: r2(e.beyond), printers: [...e.printers] }))
    .sort((a, b) => a.unit.localeCompare(b.unit) || a.name.localeCompare(b.name));
}
/**
 * THE STORE IS WHAT CAME FROM THE PRINTERS (Ravi, 2026-09-26: "sirf printer se aaye maal ka hisab kitab"). An item that
 * no printer ever delivered — pieces issued to karigars out of older or in-house stock, cloth cut that never arrived
 * here — is not on this shelf. Counted apart, so it is not a hole in the balance and not a secret either. A line
 * somebody typed in by hand (opening, in, correction) is the shelf by definition.
 */
const stFromPrinter = b => !!b && (b.fromPrinter > 0 || b.typed !== 0 || (b.n > 0 && b.inQty === 0 && b.outQty === 0));
const stNotFromPrinter = bal => (bal || []).filter(b => !stFromPrinter(b));

/** A printer's delivery the store has not put eyes on yet. */
const stChecked = key => !!((STORE.checks || {})[key]);
const stToCheck = moves => (moves || []).filter(mv => mv.src === 'printer' && !stChecked(mv.checkKey));
async function stCheckSet(key, on) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const rec = on ? { by: ME.email, at: new Date().toISOString() } : null;
  try { await ptPut('pt_storeChecks/' + String(key).replace(/\//g, '__'), rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  STORE.checks = Object.assign({}, STORE.checks || {});
  if (on) STORE.checks[key] = rec; else delete STORE.checks[key];
  return '';
}

/* ---- typing one in ---- */
const ST_KINDS = [['OPENING', 'Opening stock — what is on the shelf today'], ['IN', 'Taken in by hand'],
  ['OUT', 'Taken out by hand'], ['ADJUST', 'Correction (+ or −)']];

async function stSave(rec) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const kind = String(rec.kind || '').trim();
  if (!ST_KINDS.some(k => k[0] === kind)) return 'Pick what this entry is.';
  const unit = rec.unit === 'm' ? 'm' : 'pcs';
  const qty = parseFloat(rec.qty);
  if (!isFinite(qty) || (kind !== 'ADJUST' && qty <= 0)) return unit === 'pcs' ? 'How many pieces?' : 'How many metres?';
  if (kind === 'ADJUST' && qty === 0) return 'A correction of nothing is not a correction.';
  const row = { id: 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, unit, qty,
    sku: '', fabric: '', colour: String(rec.colour || '').trim(), date: String(rec.date || '').trim() || attToday(),
    remark: String(rec.remark || '').trim(), by: ME.email, at: new Date().toISOString() };
  if (unit === 'pcs') {
    row.sku = obUC(rec.sku);
    if (!row.sku) return 'Which SKU?';
    const m = mdbOf(row.sku);
    if (!m) return `SKU ${row.sku} is not in the master database.`;
    if (Math.round(qty) !== qty) return 'Pieces have to be a whole number.';
    row.colour = m.color || row.colour;
  } else {
    row.fabric = String(rec.fabric || '').trim();
    if (!row.fabric) return 'Which fabric?';
  }
  try { await ptPut('pt_storeLedger/' + row.id, row); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  STORE.rows = (STORE.rows || []).concat([Object.assign({ _key: row.id }, row)]);
  return '';
}

function stEntryOpen(pre) {
  if (!ptCanEdit()) { $('fbMsg').className = 'err'; $('fbMsg').textContent = PT_NO_EDIT; return; }
  pre = pre && typeof pre === 'object' && !pre.target ? pre : {};
  const fabrics = [...new Set((FAB.rows || []).map(r => String(r.fabricType || '').trim()).concat(cutFabrics()).filter(Boolean))].sort();
  ptOpenDialog({
    title: 'Store entry',
    subtitle: 'What is on the shelf, and anything the registers cannot know',
    note: 'Pieces go in by SKU, cloth by fabric and colour. What the printers send, what cutting takes and what '
      + 'is issued to karigars is counted on its own — those are not typed here.',
    fields: [
      { key: 'kind', label: 'What this is', type: 'select', value: pre.kind || 'OPENING', options: ST_KINDS },
      { key: 'unit', label: 'Pieces or cloth', type: 'select', value: pre.unit || 'pcs', options: [['pcs', 'Pieces (by SKU)'], ['m', 'Cloth (metres)']] },
      { key: 'sku', label: 'SKU (for pieces)', value: pre.sku || '', list: (PTG.mdb || []).slice(0, 4000).map(r => r.sku) },
      { key: 'fabric', label: 'Fabric (for cloth)', value: pre.fabric || '', list: fabrics },
      { key: 'colour', label: 'Colour (for cloth)', value: pre.colour || '' },
      { key: 'qty', label: 'How many', type: 'number', step: '0.01', value: pre.qty == null ? '' : pre.qty },
      { key: 'date', label: 'Date', type: 'date', value: attToday() },
      { key: 'remark', label: 'Remark', value: '', span: true },
    ],
    saveLabel: 'Save entry',
    onSave: async v => { const err = await stSave(v); if (!err) renderFab(); return err; },
  });
}

/* ---- the opening stock, a sheet at a time ---- */
const ST_COLS = ['Pieces or cloth', 'SKU', 'Fabric', 'Colour', 'Quantity', 'Remark'];
function stSheetEntries(grid) {
  if (!grid || !grid.length) return { err: 'The file is empty.' };
  const hi = grid.findIndex(r => (r || []).some(c => /^quantity$|^qty$/i.test(String(c || '').trim())));
  if (hi < 0) return { err: 'The file needs a Quantity column (and SKU for pieces, or Fabric and Colour for cloth).' };
  const head = grid[hi].map(h => String(h || '').trim().toLowerCase());
  const ix = n => head.findIndex(h => n.includes(h));
  const at = { unit: ix(['pieces or cloth', 'unit', 'type']), sku: ix(['sku']), fabric: ix(['fabric']), colour: ix(['colour', 'color']),
    qty: ix(['quantity', 'qty']), remark: ix(['remark', 'remarks']) };
  const entries = [], bad = [];
  grid.slice(hi + 1).forEach((r, k) => {
    const g = i => (i < 0 ? '' : String((r || [])[i] == null ? '' : r[i]).trim());
    if (!(r || []).some(c => String(c || '').trim())) return;
    const line = hi + k + 2;
    const sku = g(at.sku), fabric = g(at.fabric);
    const unit = /^(m|metre|meters|metres|cloth|fabric)$/i.test(g(at.unit)) ? 'm' : (g(at.unit) ? 'pcs' : (sku ? 'pcs' : 'm'));
    const qty = parseFloat(g(at.qty));
    if (!isFinite(qty) || qty <= 0) { bad.push(`line ${line}: "${g(at.qty)}" is not a quantity`); return; }
    entries.push({ line, unit, sku, fabric, colour: g(at.colour), qty, remark: g(at.remark) });
  });
  return { entries, bad };
}
function stSheetPlan(entries) {
  const ok = [], bad = [];
  (entries || []).forEach(e => {
    if (e.unit === 'pcs') {
      if (!obUC(e.sku)) { bad.push(`line ${e.line}: no SKU`); return; }
      if (!mdbOf(e.sku)) { bad.push(`line ${e.line}: ${obUC(e.sku)} is not in the master database`); return; }
      if (Math.round(e.qty) !== e.qty) { bad.push(`line ${e.line}: ${obUC(e.sku)} — pieces have to be whole`); return; }
    } else if (!String(e.fabric || '').trim()) { bad.push(`line ${e.line}: no fabric`); return; }
    ok.push(e);
  });
  return { ok, bad };
}
async function stSheetRun(list) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const now = new Date().toISOString(), t = Date.now().toString(36), patch = {}, added = [];
  (list || []).forEach((e, i) => {
    const id = 'st_' + t + '_' + String(i).padStart(4, '0');
    const row = { id, kind: 'OPENING', unit: e.unit, qty: e.qty, sku: e.unit === 'pcs' ? obUC(e.sku) : '',
      fabric: e.unit === 'm' ? String(e.fabric).trim() : '', colour: String(e.colour || '').trim(),
      date: attToday(), remark: e.remark || 'Opening stock', by: ME.email, at: now };
    patch['pt_storeLedger/' + id] = row;
    added.push(Object.assign({ _key: id }, row));
  });
  if (!added.length) return 'Nothing to write.';
  try { await ptPatch(patch); } catch (e) { return 'Not saved: ' + (e.message || e); }
  STORE.rows = (STORE.rows || []).concat(added);
  return '';
}

/* ---- the screens ---- */
function renderStore(view) {
  if (STORE.rows === null && !STORE.busy) { ensureStore(); }
  if (STORE.busy) { $('fbMsg').className = 'muted'; $('fbMsg').textContent = 'Reading the store…'; ptEmpty('fbTable', 'Loading…'); $('fbKpis').innerHTML = ''; return; }
  if (view === 'storeord') return renderStoreOrd();
  const moves = stMoves();
  const start = stStart();
  const f = fabFilters();
  const pick = mv => (!f.q || [stName(mv), mv.what, mv.remark, mv.who].join(' ').toLowerCase().includes(f.q))
    && (!f.fab || ptCi(mv.fabric, f.fab)) && (!f.col || ptCi(mv.colour, f.col))
    && (!f.d1 || String(mv.date || '') >= f.d1) && (!f.d2 || String(mv.date || '') <= f.d2);
  const shown = moves.filter(pick);
  const balAll = stBalances(view === 'store' ? moves.filter(mv => !f.q || pick(mv)) : shown);
  /* THE SHELF IS THE PRINTERS' GOODS. What nothing ever arrived for is set apart, counted, and said. */
  const bal = balAll.filter(stFromPrinter), apart = stNotFromPrinter(balAll);
  const toCheck = stToCheck(moves);
  const pcs = bal.filter(b => b.unit === 'pcs'), met = bal.filter(b => b.unit === 'm');
  const sum = (list, k) => Math.round(list.reduce((a, b) => a + b[k], 0) * 10) / 10;
  const apartPcs = sum(apart.filter(b => b.unit === 'pcs'), 'issued');
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Store — the printers' goods, before stitching</span>
      <span class="kpiwhen">read live${STORE.at ? ' · ' + esc(STORE.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v" style="color:#166534">${nf(sum(pcs, 'fromPrinter'))}</div><div class="l">Pieces from printers</div></div>
      <div class="metric"><div class="v">${nf(sum(pcs, 'issued'))}</div><div class="l">Issued to karigars</div>${sum(pcs, 'beyond') ? `<div class="l muted" title="Pieces issued that the printers' goods did not hold — older stock, or the same SKU stitched from white in-house. Not a hole in the shelf.">${nf(sum(pcs, 'beyond'))} beyond the printers' goods</div>` : ''}</div>
      <div class="metric"><div class="v"${sum(pcs, 'qty') < 0 ? ' style="color:var(--bad)"' : ''}>${nf(sum(pcs, 'qty'))}</div><div class="l">Pieces in store</div><div class="l muted">${nf(pcs.length)} SKU(s)</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(sum(met, 'fromPrinter'))}</div><div class="l">Printed cloth from printers (m)</div></div>
      <div class="metric"><div class="v"${sum(met, 'qty') < 0 ? ' style="color:var(--bad)"' : ''}>${nf(sum(met, 'qty'))}</div><div class="l">Cloth in store (m)</div><div class="l muted">${nf(met.length)} fabric &amp; colour</div></div>
      <div class="metric"><div class="v"${toCheck.length ? ' style="color:#b45309"' : ''}>${nf(toCheck.length)}</div><div class="l">To cross-check</div></div>
      <div class="metric" title="Pieces issued to karigars, and cloth cut, that no printer delivered here — older or in-house stock. Not on this shelf; not a hole in it either."><div class="v muted">${nf(apart.length)}</div><div class="l">Not from a printer</div>${apartPcs ? `<div class="l muted">${nf(apartPcs)} pcs issued</div>` : ''}</div>
    </div></div>`;
  if (view === 'storemov') {
    const head = '<thead><tr>' + ['Date', 'What', 'Item', 'In', 'Out', 'Who', 'Cross-check']
      .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([3, 4].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
    const rows = shown.slice().reverse().slice(0, 600);
    $('fbTable').innerHTML = head + '<tbody>' + rows.map(mv => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(mv.date || '')}</td>`
      + `<td style="text-align:left">${esc(mv.what)}${mv.remark ? `<div class="muted" style="font-size:11px">${esc(mv.remark)}</div>` : ''}</td>`
      + `<td style="text-align:left">${esc(stName(mv))} <span class="muted" style="font-size:11px">${ST_UNITS[mv.unit]}</span></td>`
      + `<td class="num" style="color:#166534">${mv.qty > 0 ? nf(Math.round(mv.qty * 100) / 100) : ''}</td>`
      + `<td class="num" style="color:var(--bad)">${mv.qty < 0 ? nf(Math.round(-mv.qty * 100) / 100) : ''}</td>`
      + `<td style="text-align:left;font-size:12px">${esc(String(mv.who || '').split('@')[0])}</td>`
      + `<td>${mv.src !== 'printer' ? '<span class="muted">—</span>'
        : stChecked(mv.checkKey) ? `<span class="pill pill-ok" title="Checked by ${esc(String((STORE.checks[mv.checkKey] || {}).by || '').split('@')[0])}">✓ checked</span>`
          + (ptCanEdit() ? ` <button class="ghost" data-st-uncheck="${esc(mv.checkKey)}" style="padding:2px 8px;font-size:11px">undo</button>` : '')
        : ptCanEdit() ? `<button data-st-check="${esc(mv.checkKey)}" style="padding:3px 10px;font-size:12px">Mark checked</button>`
          : '<span class="pill pill-low">not checked</span>'}</td>`
      + '</tr>').join('') + '</tbody>';
    $('fbMsg').className = STORE.err ? 'err' : 'muted';
    $('fbMsg').title = start ? ''
      : 'Every movement is here, but the balance is not the shelf until the opening stock is uploaded.';
    $('fbMsg').innerHTML = esc(`${nf(rows.length)} of ${nf(moves.length)} movement(s)`)
      + (start ? '' : ' · from the first delivery on record')
      + (STORE.err ? ' · ' + esc(STORE.err) : '');
    FAB.shown = shown;
    return;
  }
  /* WHERE IT CAME FROM AND WHERE IT WENT, on the row (Ravi: "printer ke goods ka full track"): the printers' deliveries,
   * what cutting made or took, what the karigars were given, and the shelf. Track opens the item's own movements. */
  const head = '<thead><tr>' + ['Item', 'Kind', 'From printers', 'Cut', 'Issued / cut out', 'By hand', 'Balance', 'Last', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([2, 3, 4, 5, 6].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  /* The same ceiling as every other register. The totals above still count every item. */
  const drawn = bal.slice(0, ST_MAX_ROWS);
  const z = v => (v ? nf(v) : '<span class="muted">—</span>');
  $('fbTable').innerHTML = head + '<tbody>' + drawn.map(b => '<tr>'
    + `<td class="frz" style="text-align:left">${b.unit === 'pcs' ? ptImgSpan(b.sku, 28) + ' ' : ''}${esc(b.name)}${b.printers.length ? `<div class="muted" style="font-size:11px">${esc(b.printers.join(', '))}</div>` : ''}</td>`
    + `<td>${b.unit === 'pcs' ? 'Pieces' : 'Cloth'}</td>`
    + `<td class="num" style="color:#166534">${z(b.fromPrinter)}</td>`
    + `<td class="num">${z(b.unit === 'pcs' ? b.cutIn : b.cutIn)}</td>`
    + `<td class="num" style="color:var(--bad)">${z(b.unit === 'pcs' ? b.issued : b.cutOut)}${b.beyond ? `<div class="muted" style="font-size:10.5px;white-space:nowrap" title="Issued beyond what the printers delivered — older stock, or the same SKU stitched from white in-house.">${nf(b.beyond)} beyond</div>` : ''}</td>`
    + `<td class="num">${b.typed ? nf(b.typed) : '<span class="muted">—</span>'}</td>`
    + `<td class="num" style="font-weight:700${b.qty < 0 ? ';color:var(--bad)' : ''}"${b.qty < 0 ? ' title="Below zero only by a figure somebody typed — check the Out by hand / correction entries."' : ''}>${nf(b.qty)}</td>`
    + `<td style="font-size:12px">${esc(ptIsoDate(b.last) || '')}</td>`
    + `<td><button class="ghost" data-st-track="${esc(b.name)}" style="padding:3px 10px;font-size:12px" title="Every movement of this item — which printer, which order, which karigar, when">Track</button></td></tr>`).join('') + '</tbody>';
  FAB.shown = bal;
  $('fbMsg').className = STORE.err ? 'err' : 'muted';
  $('fbMsg').title = 'The balance is the sum of the movements, never a stored figure.'
    + (start ? '' : ' With no opening stock this is what has MOVED since the first entry, not what is on the shelf.'
      + ' Upload the opening stock and it becomes the shelf.');
  $('fbMsg').innerHTML = esc(drawn.length < bal.length
      ? `${nf(drawn.length)} of ${nf(bal.length)} item(s) shown — search to find the rest`
      : `${nf(bal.length)} item(s) from the printers`)
    + (apart.length ? ` · <span title="${esc(apart.slice(0, 12).map(b => b.name + ' ' + nf(b.unit === 'pcs' ? b.issued : b.cutOut) + ' ' + b.unit).join(' · '))}">${nf(apart.length)} item(s) moved that no printer delivered — not counted</span>` : '')
    + (start ? '' : ' · counting the printers\' goods from their first delivery on record')
    + (toCheck.length ? ` · <a href="#" id="stToCheck">${nf(toCheck.length)} delivery(ies) to cross-check</a>` : '')
    + (STORE.err ? ' · ' + esc(STORE.err) : '');
  /* PICTURES ARE PATCHED IN, NOT A REASON TO REDRAW. The lookup used to end with renderFab, which
   * worked the whole store out again and asked for the next 120 pictures — fourteen full rebuilds for
   * 1,576 SKUs. Now it fills the cells already on screen and stops. */
  ptImgFill(drawn.filter(b => b.unit === 'pcs').map(b => b.sku).filter(Boolean), false, ptIfTab('fab', ptImgPatch));
}

/* ================= THE STORE BY ORDER NUMBER =================
 *
 * Ravi, 2026-10-03: "is system ko order number base banao yadi hamare pas base rahega ki ye mal kis order number ke
 * against me aaya h apan easily track kar payenge … har koi bhi order banta h to uska ek order number banta h usi se
 * track karo".
 *
 * The SKU-wide shelf said 11,066 pieces went to karigars "beyond" what the printers delivered, and could not say why.
 * Read order by order, most of it has a name: the printer still holds pieces for that very order (the delivery is
 * not entered yet — 142 issued on 1 Oct for AMZ-25082026-01, the 162 entered on 3 Oct), no printer order was ever
 * placed for it, or the issue named no order at all. Totals per order, not a running balance through time, so a
 * delivery entered late settles itself the moment it is entered.
 *
 * Per (order, SKU) of every printer-made SKU:
 *   Given / Back — the printers' lines for that order: a Shopify line names its order; the rest are the Order
 *                  Console's own share (ordVendorAlloc — stamped orders first, then open orders oldest first).
 *                  Back that no order in the book wants is kept on a "no order" row, never dropped.
 *   Cut          — cutting entries naming the order.
 *   Issued       — Job Work issues naming the order; issues naming none sit on the "no order" row.
 *   Available    — what the store got for the order: the printer's pieces, or — for an SKU printed as running cloth
 *                  and cut here — what was cut.
 */
function stOrderRows() {
  const lines = typeof ordLines === 'function' ? ordLines() : [];
  const book = new Map(lines.map(r => [r.orderNo + '|' + r.sku, r]));
  const g = new Map();
  const at = (orderNo, sku) => {
    const k = (orderNo || '') + '|' + sku;
    let e = g.get(k);
    if (!e) {
      const l = orderNo ? book.get(k) : null;
      e = { orderNo: orderNo || '', sku, ordered: l ? l.qty : null, open: l ? !!l.open : null, inBook: !!l,
        given: 0, back: 0, cut: 0, issued: 0, issues: 0, vpos: new Set() };
      g.set(k, e);
    }
    return e;
  };
  /* ---- the printers ---- */
  const printerSku = new Set(), pileBack = new Map();
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled') return;
    voLines(o).forEach(l => {
      if (!l || l.cancelled || voKind(l) !== 'cut') return;
      const sku = obUC(l.sku), qty = parseFloat(l.qty) || 0;
      if (!sku || !(qty > 0)) return;
      printerSku.add(sku);
      const back = voDels(l).reduce((t, d) => { const ok = vlOk(d); return t + (ok ? (parseFloat(ok.qty) || 0) : 0); }, 0);
      if (l.shopKey || l.shopOrderNo) {
        /* A Shopify line was placed FOR one order and says which. */
        const e = at(obUC(l.shopOrderNo || String(l.shopKey).split('__')[0]), sku);
        e.given += qty; e.back += Math.min(back, qty); e.vpos.add(o.orderNo || o.id);
      } else {
        pileBack.set(sku, (pileBack.get(sku) || 0) + Math.min(back, qty));
      }
    });
  });
  const dealtBack = new Map();
  (typeof ordVendorAlloc === 'function' ? ordVendorAlloc() : new Map()).forEach((v, k) => {
    const i = k.lastIndexOf('|'), orderNo = k.slice(0, i), sku = k.slice(i + 1);
    if (!printerSku.has(sku)) return;
    const e = at(orderNo, sku);
    e.given += v.given; e.back += v.back;
    (v.parts || []).forEach(p => e.vpos.add(p.vpo));
    dealtBack.set(sku, (dealtBack.get(sku) || 0) + v.back);
  });
  /* What came back that no order in the book is waiting for — real pieces, kept on the no-order row. */
  pileBack.forEach((back, sku) => {
    const left = Math.round((back - (dealtBack.get(sku) || 0)) * 100) / 100;
    if (left > 0) at('', sku).back += left;
  });
  /* ---- the floor ---- */
  (PT.cut || []).forEach(c => {
    const sku = obUC(c && c.sku);
    if (!sku || !printerSku.has(sku)) return;
    at(obUC(c.orderNo), sku).cut += stNum(c.pieces);
  });
  (PT.base || []).forEach(r => {
    const sku = obUC(r && r.sku);
    if (!sku || !printerSku.has(sku)) return;
    const q = stNum(r.issuePieces);
    if (!(q > 0)) return;
    const e = at(obUC(r.orderNo), sku);
    e.issued += q; e.issues++;
  });
  /* ---- per row: what the store got for it, what is left, how far beyond, and why ---- */
  const running = new Map();
  return [...g.values()].map(e => {
    if (!running.has(e.sku)) { const m = mdbOf(e.sku); running.set(e.sku, !!m && ptPrintIssueAs(m) === 'running'); }
    e.running = running.get(e.sku);
    e.avail = e.running ? e.cut : e.back;
    e.left = Math.max(0, e.avail - e.issued);
    e.beyond = Math.max(0, e.issued - e.avail);
    e.atPrinter = Math.max(0, e.given - e.back);
    e.vpos = [...e.vpos].filter(Boolean);
    e.why = !e.beyond ? (e.left ? 'In store' : (e.issued || e.avail ? 'Balanced' : 'Nothing moved yet'))
      : !e.orderNo ? 'Issued with no order number'
      : e.running ? 'Issued more than was cut for this order'
      : e.atPrinter >= e.beyond ? 'Printer delivery not entered yet'
      : e.atPrinter > 0 ? 'Part not entered yet, part never given to a printer'
      : e.given ? 'Issued more than the printer was given for this order'
      : 'No printer order for this order';
    return e;
  }).filter(e => e.given || e.back || e.cut || e.issued);
}

function renderStoreOrd() {
  const f = fabFilters();
  const all = stOrderRows();
  const rows = all.filter(e => !f.q || [e.orderNo || 'no order', e.sku, e.why, e.vpos.join(' ')].join(' ').toLowerCase().includes(f.q));
  /* Worst first: the most pieces issued beyond, then the most waiting in store. */
  rows.sort((a, b) => (b.beyond - a.beyond) || (b.left - a.left) || String(a.orderNo).localeCompare(String(b.orderNo)));
  const sum = (list, k) => list.reduce((t, e) => t + (e[k] || 0), 0);
  const bad = rows.filter(e => e.beyond > 0);
  const byWhy = w => sum(bad.filter(e => e.why === w), 'beyond');
  const late = byWhy('Printer delivery not entered yet') + byWhy('Part not entered yet, part never given to a printer');
  const noOrder = byWhy('Issued with no order number');
  const noPrinter = byWhy('No printer order for this order') + byWhy('Issued more than the printer was given for this order');
  const orders = new Set(rows.filter(e => e.orderNo).map(e => e.orderNo));
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Store by order number — the printers' goods, order by order</span>
      <span class="kpiwhen">read live${STORE.at ? ' · ' + esc(STORE.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(orders.size)}</div><div class="l">Orders</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(sum(rows, 'avail'))}</div><div class="l">Came in for them</div><div class="l muted">from printers, or cut here</div></div>
      <div class="metric"><div class="v">${nf(sum(rows, 'issued'))}</div><div class="l">Issued to karigars</div></div>
      <div class="metric"><div class="v">${nf(sum(rows, 'left'))}</div><div class="l">In store, by order</div></div>
      <div class="metric"><div class="v"${sum(bad, 'beyond') ? ' style="color:var(--bad)"' : ''}>${nf(sum(bad, 'beyond'))}</div><div class="l">Issued beyond their order</div><div class="l muted">${nf(bad.length)} order line(s)</div></div>
      <div class="metric" title="The printer still holds pieces for that very order — the delivery has not been entered in the app yet."><div class="v" style="color:#b45309">${nf(late)}</div><div class="l">Delivery not entered yet</div></div>
      <div class="metric" title="No printer order was placed for that order, or less than was issued."><div class="v">${nf(noPrinter)}</div><div class="l">No printer order for it</div></div>
      <div class="metric" title="The Job Work issue named no order — it cannot be matched to anything."><div class="v">${nf(noOrder)}</div><div class="l">Issued with no order number</div></div>
    </div></div>`;
  const head = '<thead><tr>' + ['Order', 'SKU', 'Ordered', 'Given to printer', 'Back from printer', 'Cut', 'Issued', 'In store', 'Issued beyond', 'Why', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([2, 3, 4, 5, 6, 7, 8].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const z = v => (v ? nf(v) : '<span class="muted">—</span>');
  const drawn = rows.slice(0, 300);                 // 600 rows came to 643 KB of table — half that, search for the rest
  $('fbTable').innerHTML = head + '<tbody>' + drawn.map(e => '<tr>'
    + `<td class="frz" style="text-align:left">${e.orderNo ? `<a href="#" data-ordj="${esc(e.orderNo)}">${esc(e.orderNo)}</a>` : '<span class="muted">no order</span>'}`
      + `${e.vpos.length ? `<div class="muted" style="font-size:11px" title="${esc(e.vpos.join(', '))}">${esc(e.vpos.slice(0, 2).join(', '))}${e.vpos.length > 2 ? ' +' + (e.vpos.length - 2) : ''}</div>` : ''}</td>`
    + `<td style="text-align:left">${ptImgSpan(e.sku, 24)} ${esc(e.sku)}</td>`
    + `<td class="num">${e.ordered == null ? '<span class="muted" title="Not in the order book">—</span>' : nf(e.ordered)}</td>`
    + `<td class="num">${z(e.given)}${e.atPrinter ? `<div class="muted" style="font-size:10.5px">${nf(e.atPrinter)} still there</div>` : ''}</td>`
    + `<td class="num" style="color:#166534">${z(e.back)}</td>`
    + `<td class="num">${z(e.cut)}</td>`
    + `<td class="num" style="color:var(--bad)">${z(e.issued)}</td>`
    + `<td class="num" style="font-weight:700">${z(e.left)}</td>`
    + `<td class="num"${e.beyond ? ' style="font-weight:700;color:var(--bad)"' : ''}>${z(e.beyond)}</td>`
    + `<td style="text-align:left;font-size:12.5px${e.beyond ? ';color:var(--bad)' : ''}">${esc(e.why)}</td>`
    + `<td><button class="ghost" data-st-track="${esc(e.sku)}" style="padding:3px 10px;font-size:12px" title="Every movement of this SKU — printer, order, karigar, date">Track</button></td></tr>`).join('') + '</tbody>';
  FAB.shown = rows;
  $('fbMsg').className = STORE.err ? 'err' : 'muted';
  $('fbMsg').title = 'Totals per order, not a running balance — a delivery entered late settles the moment it is entered.';
  $('fbMsg').innerHTML = esc(drawn.length < rows.length ? `${nf(drawn.length)} of ${nf(rows.length)} order line(s) shown — search an order or SKU to find the rest`
      : `${nf(rows.length)} order line(s)`)
    + ' · printer pieces are shared to orders the same way as on the Order Console (named orders first, then open orders, oldest first)'
    + (STORE.err ? ' · ' + esc(STORE.err) : '');
  ptImgFill(drawn.map(e => e.sku), false, ptIfTab('fab', ptImgPatch));
}

$('fbTable').addEventListener('click', async e => {
  /* An order number opens that order's whole journey (2026-10-03, the by-order view). */
  const oj = e.target.closest('[data-ordj]');
  if (oj) { e.preventDefault(); try { ordJourney(oj.getAttribute('data-ordj')); } catch (err) { /* the order book is not readable here */ } return; }
  /* TRACK: the item's own movements, newest first — printer, order, date, karigar. */
  const tr = e.target.closest('[data-st-track]');
  if (tr) { if ($('fbQ')) $('fbQ').value = tr.getAttribute('data-st-track'); $('fbView').value = 'storemov'; renderFab(); return; }
  const on = e.target.closest('[data-st-check]'), off = e.target.closest('[data-st-uncheck]');
  if (!on && !off) return;
  const key = (on || off).getAttribute(on ? 'data-st-check' : 'data-st-uncheck');
  const err = await stCheckSet(key, !!on);
  if (err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = err; return; }
  renderFab();
});
$('fbMsg').addEventListener('click', e => {
  if (!e.target.closest('#stToCheck')) return;
  e.preventDefault();
  $('fbView').value = 'storemov';
  renderFab();
});
$('fbStoreFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const grid = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = stSheetEntries(grid);
    if (read.err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = read.err; return; }
    const plan = stSheetPlan(read.entries);
    const bad = (read.bad || []).concat(plan.bad);
    if (!plan.ok.length) {
      $('fbMsg').className = 'err';
      $('fbMsg').textContent = 'Nothing to write. ' + bad.slice(0, 4).join(' · ');
      return;
    }
    const pcsN = plan.ok.filter(x => x.unit === 'pcs').length;
    ptOpenDialog({
      title: 'Put this on the shelf?',
      subtitle: `${nf(pcsN)} piece line(s) · ${nf(plan.ok.length - pcsN)} cloth line(s)${bad.length ? ' · ' + nf(bad.length) + ' refused' : ''}`,
      note: 'Each line becomes an opening entry. The registers — printers, cutting, job work — start counting from the first one.',
      html: '<div style="max-height:45vh;overflow:auto;font-size:12.5px">'
        + plan.ok.slice(0, 300).map(x => `${esc(x.unit === 'pcs' ? obUC(x.sku) : [x.fabric, x.colour].filter(Boolean).join(' · '))}: <b>${nf(x.qty)}</b> ${ST_UNITS[x.unit]}`).join('<br>')
        + (bad.length ? '<br><span style="color:var(--bad)">' + bad.map(esc).join('<br>') + '</span>' : '') + '</div>',
      saveLabel: 'Write ' + nf(plan.ok.length),
      onSave: async () => {
        const err = await stSheetRun(plan.ok);
        if (!err) { renderFab(); $('fbMsg').className = 'muted'; $('fbMsg').textContent = `Opening stock written for ${nf(plan.ok.length)} line(s).`; }
        return err;
      },
    });
  } catch (err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = 'Could not read the file: ' + (err.message || err); }
};
$('fbStoreNew').onclick = () => stEntryOpen({});

const RECIPE_FIELDS = [
  /* FIRST, because it is the first thing anybody asks about a product. 'fab' is text picked from the
   * Fabric Type master rather than typed: see RECIPE_FAB below. */
  ['fabric', 'Fabric', 'fab'],
  ['consumption', 'Consumption (m)', 'num'],
  ['packOf', 'Pack of', 'txt'],
  ['cuttingRequired', 'Cutting required', 'yn'],
  ['isZip', 'Zip', 'yn'],
  ['zipQty', 'Zips per piece', 'num'],
  ['chainLength', 'Zip size', 'num'],
  ['isRuffle', 'Ruffle', 'yn'],
  ['ruffleMeters', 'Ruffle metres', 'num'],
  ['ruffleFabric', 'Ruffle fabric', 'fab'],
  ['isPiping', 'Piping dori', 'yn'],
  ['pipingMeters', 'Piping dori metres', 'num'],
  ['fillerFabricRequired', 'Filler fabric', 'yn'],
  ['standardFillingQty', 'Filling qty', 'num'],
];
/* A YES/NO ON A SKU IS NEVER BLANK — mdbRecord writes true or false — so "nobody has said" and "no"
 * cannot be told apart on the SKU. A recipe CAN be silent about one, which is why these are stored
 * as the strings 'yes', 'no' or '' rather than as booleans. */
const RECIPE_YN = RECIPE_FIELDS.filter(f => f[2] === 'yn').map(f => f[0]);
/* THE CLOTH FIELDS. Stored as text like any other, but only ever a spelling the Fabric Type master
 * already has — anywhere one can be typed, it is checked against that list first. */
const RECIPE_FAB = RECIPE_FIELDS.filter(f => f[2] === 'fab').map(f => f[0]);

/* ONE SPELLING OF A SIZE. "16x16", "16X16", "16 × 16" and "16 x 16" are one size, and a recipe typed
 * one way has to be found by a SKU written the other (Ravi, 2026-09-23: a short-template import filled
 * nothing in). The × is what a spreadsheet leaves behind when it tidies up. */
const recNorm = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ')
  .replace(/\s*[x×]\s*/g, 'x');
/** The one key. Article, subtype and size — brand was tested and does not help. */
const recKey = m => [recNorm(m && m.articleType), recNorm(m && m.subtype), recNorm(m && m.size)].join('|');
const recSaid = v => v !== undefined && v !== null && String(v).trim() !== '';

let RECIPE_IX = { src: null, map: null };
/** Every recipe, by key, built once per change of the master. */
function recipeMap() {
  const src = (PTG.masters || {}).recipe;
  if (RECIPE_IX.src === src && RECIPE_IX.map) return RECIPE_IX.map;
  const map = new Map();
  ptList(src).forEach(r => { if (r) map.set(recKey(r), r); });
  RECIPE_IX = { src, map };
  return map;
}
const recipeRows = () => ptList((PTG.masters || {}).recipe).filter(Boolean);
/** The recipe for a SKU — or for a bare {articleType, subtype, size}. */
const recipeOf = m => recipeMap().get(recKey(m)) || null;

/**
 * What a SKU's field should be, given the recipe behind it.
 *
 * The SKU wins wherever it has said something. A recipe is a default, not an override: somebody who
 * typed 2.7 on one row meant to, even when forty-two of its siblings say 2.8, and silently replacing
 * it would be this tool deciding a question that belongs to Ravi.
 */
function recipeValue(m, field) {
  if (recSaid(m && m[field])) return m[field];
  const r = recipeOf(m);
  if (!r || !recSaid(r[field])) return null;
  if (RECIPE_YN.indexOf(field) >= 0) return recNorm(r[field]) === 'yes';
  const spec = RECIPE_FIELDS.find(f => f[0] === field);
  return spec && spec[2] === 'num' ? (MDB_M2.indexOf(field) >= 0 ? mdbM2(r[field]) : mdbNum(r[field])) : String(r[field]).trim();
}

/**
 * A brand-new SKU, filled in from its recipe.
 *
 * ONLY ON THE WAY IN. Applied to a record being created — from the New SKU form or from an import —
 * never to one being edited, because on an edit a blank is somebody clearing a value on purpose.
 *
 * The yes/no fields are taken from the recipe outright. They are the ones a SKU cannot be silent
 * about — mdbRecord turns them into true or false whatever the form said — so on a new row the
 * choice is between the recipe's answer and whatever the form happened to default to, and the
 * recipe is the one somebody thought about.
 */
function recipeFill(rec) {
  const r = recipeOf(rec);
  if (!r) return { rec, from: [] };
  const out = Object.assign({}, rec), from = [];
  RECIPE_FIELDS.forEach(([f, , kind]) => {
    if (!recSaid(r[f])) return;
    if (kind === 'yn') {
      const want = recNorm(r[f]) === 'yes';
      if (out[f] !== want) { out[f] = want; from.push(f); }
      return;
    }
    if (recSaid(out[f])) return;                  // the row said something; leave it alone
    out[f] = kind === 'num' ? mdbNum(r[f]) : String(r[f]).trim();
    from.push(f);
  });
  /* A zip that is off carries no size and no count, and a ruffle that is off carries no metres — the
   * same tidying mdbRecord does, so a recipe cannot leave a contradiction behind it. */
  if (out.isZip !== true) { out.chainLength = null; out.zipQty = null; }
  else if (!(mdbNum(out.zipQty) > 0)) out.zipQty = 1;
  if (out.isRuffle !== true) { out.ruffleMeters = null; out.ruffleFabric = ''; }
  if (out.isPiping !== true) out.pipingMeters = null;
  if (out.fillerFabricRequired !== true) out.standardFillingQty = null;
  return { rec: out, from };
}

/**
 * What the SKUs of one combination currently say about one field.
 *
 * { values: [{ value, n }], said, blank, agreed, conflict } — the counts travel with it because
 * "forty-two say 2.8 and one says 2.7" is the whole story and a bare "conflict" is not.
 */
function recipeSays(rows, field) {
  const by = new Map();
  let said = 0, blank = 0;
  rows.forEach(m => {
    const v = m[field];
    /* A yes/no is never blank on a SKU, so all of them count as having spoken. */
    if (RECIPE_YN.indexOf(field) >= 0) { said++; const k = v === true ? 'yes' : 'no'; by.set(k, (by.get(k) || 0) + 1); return; }
    if (!recSaid(v)) { blank++; return; }
    said++;
    const k = MDB_M2.indexOf(field) >= 0 && mdbM2(v) != null ? String(mdbM2(v)) : String(v).trim();
    by.set(k, (by.get(k) || 0) + 1);
  });
  const values = [...by].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
  return { values, said, blank, agreed: values.length === 1 ? values[0].value : null,
    conflict: values.length > 1 };
}

/** Every combination in the catalogue, with its recipe and what its SKUs say. */
function recipeCombos() {
  const by = new Map();
  (PTG.mdb || []).forEach(m => {
    if (!m) return;
    const k = recKey(m);
    if (!by.has(k)) by.set(k, { key: k, articleType: String(m.articleType || '').trim(),
      subtype: String(m.subtype || '').trim(), size: String(m.size || '').trim(), rows: [] });
    by.get(k).rows.push(m);
  });
  return [...by.values()].map(c => {
    const says = {};
    RECIPE_FIELDS.forEach(([f]) => { says[f] = recipeSays(c.rows, f); });
    return Object.assign(c, { n: c.rows.length, recipe: recipeMap().get(c.key) || null, says });
  }).sort((a, b) => b.n - a.n
    || a.articleType.localeCompare(b.articleType) || a.subtype.localeCompare(b.subtype)
    || a.size.localeCompare(b.size));
}

/**
 * What a seed would write, and what it would leave alone.
 *
 * ONLY WHERE EVERY SKU THAT HAS SPOKEN SAYS THE SAME THING. Forty-two against one is not a majority
 * to this — it is a question, and it goes on the list for Ravi rather than being decided here. A
 * recipe that already says something is never overwritten either.
 */
function recipeSeedPlan() {
  const rows = [], skipped = [];
  recipeCombos().forEach(c => {
    const rec = Object.assign({}, c.recipe || {}, { articleType: c.articleType, subtype: c.subtype, size: c.size });
    let filled = 0;
    RECIPE_FIELDS.forEach(([f]) => {
      if (recSaid(rec[f])) return;                        // the recipe has already been told
      const s = c.says[f];
      if (s.conflict) { skipped.push({ key: c.key, field: f, values: s.values, n: c.n }); return; }
      if (!s.agreed) return;                              // nobody has said anything
      rec[f] = RECIPE_YN.indexOf(f) >= 0 ? s.agreed : String(s.agreed);
      filled++;
    });
    if (filled) rows.push({ key: c.key, rec, filled, n: c.n });
  });
  return { rows, skipped };
}

/**
 * Write what recipeApplyPlan showed, and nothing else.
 *
 * Built from the plan rather than worked out again, so what is written is what was agreed to — a
 * second pass over a catalogue that may have been edited in between would write something nobody saw.
 */
async function recipeApplyRun(plan) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const bySku = new Map();
  plan.fill.concat(plan.change).forEach(x => {
    if (!bySku.has(x.sku)) bySku.set(x.sku, {});
    bySku.get(x.sku)[x.field] = x.to;
  });
  if (!bySku.size) return 'There is nothing to write.';
  const patch = {}, next = [];
  (PTG.mdb || []).forEach(m => {
    const ch = bySku.get(m.sku);
    if (!ch) { next.push(m); return; }
    const row = Object.assign({}, m, ch);
    MDB_M2.forEach(f => { if (f in ch && ch[f] != null && ch[f] !== '') row[f] = mdbM2(ch[f]); });
    /* The same tidying mdbRecord does, so an applied recipe cannot leave a contradiction behind. */
    if (row.isZip !== true) { row.chainLength = null; row.zipQty = null; }
    else if (!(mdbNum(row.zipQty) > 0)) row.zipQty = 1;
    if (row.isRuffle !== true) { row.ruffleMeters = null; row.ruffleFabric = ''; }
    if (row.isPiping !== true) row.pipingMeters = null;
    if (row.fillerFabricRequired !== true) row.standardFillingQty = null;
    next.push(row);
    const key = m._key || m.sku;
    Object.keys(ch).forEach(f => { patch['pt_masterDB/' + key + '/' + f] = row[f]; });
  });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.mdb = next;
  if (typeof PT !== 'undefined' && PT) PT.mdb = next;
  return '';
}

/** The key a recipe is stored under — safe for a database path. */
const recPath = k => String(k).replace(/[.#$\[\]\/]/g, '_');

/**
 * FILL THE BLANKS OF THESE COMBINATIONS' SKUs FROM THEIR RECIPES (2026-09-25, the permanent fix). Called by every
 * recipe save and upload, so a recipe never again sits apart from the SKUs it describes. Only empty fields are
 * written; a SKU that says something keeps it. Returns { skus, fields } or { err }.
 */
async function recipeFillBlanks(keys) {
  const want = new Set(keys || []);
  const rows = (PTG.mdb || []).filter(m => m && want.has(recKey(m)));
  if (!rows.length) return { skus: 0, fields: 0 };
  const plan = recipeApplyPlan(rows);
  if (!plan.fill.length) return { skus: 0, fields: 0 };
  const err = await recipeApplyRun({ fill: plan.fill, change: [] });
  if (err) return { err };
  return { skus: new Set(plan.fill.map(x => x.sku)).size, fields: plan.fill.length };
}
/** What the last save or upload filled, for the message that follows it. */
let RECIPE_FILLED = null;
const recipeFilledTxt = f => !f ? '' : (f.err ? ' The SKUs could not be filled from it: ' + f.err
  : (f.skus ? ` ${nf(f.skus)} SKU(s) had ${nf(f.fields)} blank field(s) filled from it.` : ''));

async function recipeSave(rec) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const k = recKey(rec);
  if (k === '||') return 'A recipe needs an article, a subtype and a size.';
  const next = Object.assign({}, rec, { articleType: String(rec.articleType || '').trim(),
    subtype: String(rec.subtype || '').trim(), size: String(rec.size || '').trim(),
    editedBy: ME.email, editedAt: new Date().toISOString() });
  RECIPE_FIELDS.forEach(([f, , kind]) => {
    if (!recSaid(next[f])) { delete next[f]; return; }
    next[f] = kind === 'yn' ? (recNorm(next[f]) === 'yes' ? 'yes' : 'no')
      : (MDB_M2.indexOf(f) >= 0 && mdbM2(next[f]) != null ? String(mdbM2(next[f])) : String(next[f]).trim());
  });
  try { await ptPut('pt_masters/recipe/' + recPath(k), next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const masters = Object.assign({}, PTG.masters || {});
  masters.recipe = Object.assign({}, masters.recipe || {}, { [recPath(k)]: next });
  PTG.masters = masters;
  RECIPE_IX = { src: null, map: null };
  RECIPE_FILLED = await recipeFillBlanks([k]);
  return '';
}

/** Write a whole seed in one go — a hundred separate saves is a hundred chances to stop halfway. */
async function recipeSeedRun(rows) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  if (!rows.length) return 'There is nothing to seed.';
  const now = new Date().toISOString();
  const patch = {}, keep = {};
  rows.forEach(({ key, rec }) => {
    const next = Object.assign({}, rec, { seededBy: ME.email, seededAt: now });
    RECIPE_FIELDS.forEach(([f, , kind]) => {
      if (!recSaid(next[f])) { delete next[f]; return; }
      next[f] = kind === 'yn' ? (recNorm(next[f]) === 'yes' ? 'yes' : 'no')
        : (MDB_M2.indexOf(f) >= 0 && mdbM2(next[f]) != null ? String(mdbM2(next[f])) : String(next[f]).trim());
    });
    patch['pt_masters/recipe/' + recPath(key)] = next;
    keep[recPath(key)] = next;
  });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const masters = Object.assign({}, PTG.masters || {});
  masters.recipe = Object.assign({}, masters.recipe || {}, keep);
  PTG.masters = masters;
  RECIPE_IX = { src: null, map: null };
  return '';
}

/**
 * What applying the recipes to the SKUs would change, SKU by SKU.
 *
 * Shown before anything is written, the way the worked-out consumption already is. A blank filled in
 * and a value contradicted are different things and are counted apart: filling a blank is what this
 * is for, and changing 2.7 to 2.8 is a decision.
 */
function recipeApplyPlan(rows) {
  const fill = [], change = [];
  (rows || PTG.mdb || []).forEach(m => {
    const r = recipeOf(m);
    if (!r) return;
    RECIPE_FIELDS.forEach(([f, label, kind]) => {
      if (!recSaid(r[f])) return;
      const want = kind === 'yn' ? (recNorm(r[f]) === 'yes')
        : kind === 'num' ? mdbNum(r[f]) : String(r[f]).trim();
      const had = m[f];
      if (kind === 'yn') {
        if (had === want) return;
        change.push({ sku: m.sku, field: f, label, from: had === true ? 'yes' : 'no', to: want ? 'yes' : 'no' });
        return;
      }
      if (!recSaid(had)) { fill.push({ sku: m.sku, field: f, label, from: '', to: want }); return; }
      if (String(had).trim() === String(want).trim()) return;
      change.push({ sku: m.sku, field: f, label, from: had, to: want });
    });
  });
  return { fill, change };
}

