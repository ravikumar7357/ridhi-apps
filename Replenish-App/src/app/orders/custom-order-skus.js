/* ==== CUSTOM-ORDER SKUs ONTO REAL ONES (Ravi, 2026-09-28) ====
 * "abhi tak custom order me jo mal bana h m uska sku change krna chahta hu to track our orders". Custom Order made a code
 * per entry (TC-CUST-260820-09); 312 of them sit in the master and more in the registers. Each is put on the real SKU:
 *   the real SKU exists  → MERGE: every register row moves to it; the custom master row stays, marked mergedInto
 *   it does not exist    → RENAME, the ordinary Change SKU: the custom master row becomes the new code
 * The sheet suggests the real SKU where one master SKU has the same article, subtype, colour and size. */
const CUST_RE = /-CUST-/i;
function custFixSuggest(r) {
  const key = [r.articleType, r.subtype, r.color, r.size].map(ptNorm).join('|');
  if (!r || key.split('|').some(x => !x)) return '';
  const hits = (PTG.mdb || []).filter(m => m && m.sku && !CUST_RE.test(m.sku) && [m.articleType, m.subtype, m.color, m.size].map(ptNorm).join('|') === key);
  return hits.length === 1 ? obUC(hits[0].sku) : '';
}
/** Every custom-order code in use: the master's and the registers', with what was made on it. */
function custFixRows() {
  const by = new Map();
  const get = sku => { const k = obUC(sku); let e = by.get(k); if (!e) by.set(k, e = { sku: k, m: null, issued: 0, pressed: 0, orders: new Set() }); return e; };
  (PTG.mdb || []).forEach(m => { if (m && CUST_RE.test(m.sku || '')) get(m.sku).m = m; });
  (PT.base || []).forEach(r => { if (r && CUST_RE.test(r.sku || '')) { const e = get(r.sku); e.issued += Number(r.issuePieces) || 0; if (r.orderNo) e.orders.add(obUC(r.orderNo)); } });
  (PTG.press || []).forEach(r => { if (r && CUST_RE.test(r.sku || '')) { const e = get(r.sku); e.pressed += Number(r.pieces) || 0; if (r.orderNo) e.orders.add(obUC(r.orderNo)); } });
  (PTG.ob || []).forEach(r => { if (r && CUST_RE.test(r.sku || '')) get(r.sku).orders.add(obUC(r.orderNo)); });
  return [...by.values()].filter(e => !(e.m && e.m.mergedInto)).map(e => {
    const x = e.m || (PT.base || []).find(r => obUC(r && r.sku) === e.sku) || {};
    const r = { articleType: x.articleType || '', subtype: x.subtype || x.articleSubtype || '', color: x.color || '', size: x.size || '' };
    return Object.assign(e, r, { brand: (e.m && e.m.brand) || '', suggest: custFixSuggest(r) });
  }).sort((a, b) => b.issued - a.issued || a.sku.localeCompare(b.sku));
}
const CUST_FIX_COLS = ['Custom SKU', 'Article', 'Subtype', 'Colour', 'Size', 'Brand', 'Pcs issued', 'Pcs pressed', 'Orders', 'Suggested SKU', 'New SKU'];
const custFixSheet = rows => [CUST_FIX_COLS].concat(rows.map(e => [e.sku, e.articleType, e.subtype, e.color, e.size, e.brand, e.issued, e.pressed, [...e.orders].join(' '), e.suggest, e.suggest]));
/** What a filled sheet would do: merges, renames, and every row that cannot be done, with why. */
function custFixPlan(rows) {
  const h = (rows[0] || []).map(x => String(x == null ? '' : x).trim().toLowerCase());
  const ci = { from: h.indexOf('custom sku'), to: h.indexOf('new sku'), brand: h.indexOf('brand') };
  if (ci.from < 0 || ci.to < 0) return { err: 'That sheet has no "Custom SKU" and "New SKU" columns. Download the sheet to see the shape.' };
  const master = new Set((PTG.mdb || []).map(m => obUC(m && m.sku)));
  const out = { merge: [], rename: [], create: [], errs: [] }, seenTo = new Map();
  const info = new Map(custFixRows().map(e => [e.sku, e]));
  rows.slice(1).forEach((r, i) => {
    const from = obUC(r[ci.from]), to = obUC(r[ci.to]), at = 'Row ' + (i + 2) + ': ';
    if (!from || !to) return;
    if (!CUST_RE.test(from)) { out.errs.push(at + from + ' is not a custom-order code.'); return; }
    if (CUST_RE.test(to)) { out.errs.push(at + to + ' is itself a custom-order code — give the real SKU.'); return; }
    if (from === to) return;
    if (master.has(to)) { out.merge.push({ from, to }); return; }
    /* A NEW real code takes over the custom master row — once. Two custom codes onto one new code is a merge into a
     * code that does not exist yet: rename the first, and the rest merge into it. */
    if (seenTo.has(to)) { out.merge.push({ from, to, after: true }); return; }
    /* No master row to rename: the new SKU is ADDED to the master from what was made on the custom code, and the register
     * rows move onto it. */
    if (!master.has(from)) {
      const e = info.get(from) || {};
      if (!e.articleType || !e.subtype || !e.size) { out.errs.push(at + from + ' has no article, subtype and size to build ' + to + ' from.'); return; }
      seenTo.set(to, from);
      out.create.push({ from, to, articleType: e.articleType, subtype: e.subtype, color: e.color, size: e.size, brand: String(r[ci.brand] || e.brand || '').trim() });
      return;
    }
    seenTo.set(to, from); out.rename.push({ from, to });
  });
  return out;
}
/** Every register row of `from` moves to `to`; the custom master row is marked, never removed. */
function custMergePaths(from, to, upd) {
  const before = Object.keys(upd).length;
  const touch = (node, list) => (list || []).filter(r => r && obUC(r.sku) === from)
    .forEach(r => { const k = r.id || r._key || r._id; if (k) { upd[`${node}/${k}/sku`] = to; upd[`${node}/${k}/skuWas`] = from; } });
  touch('pt_baseData', PT.base || []); touch('pt_cuttingData', PT.cut || []); touch('pt_pressInventory', PTG.press || []);
  touch('pt_qcChecks', QC.checks || []); touch('pt_qcIssuance', QC.issue || []); touch('pt_fgiLedger', FGI.rows || []);
  touch('pt_accLedger', ACC.ledger || []);
  (PTG.ob || []).filter(r => r && obUC(r.sku) === from).forEach(r => { upd[`pt_orderBook/${r.id || r._key}/sku`] = to; upd[`pt_orderBook/${r.id || r._key}/skuWas`] = from; });
  (SOX.rows || []).forEach(o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {}))
    .forEach((l, i) => { if (l && obUC(l.sku) === from) upd[`pt_salesOrders/${o._id}/lines/${i}/sku`] = to; }));
  (VO.rows || []).forEach(o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {}))
    .forEach((l, i) => { if (l && obUC(l.sku) === from) upd[`pt_vendorOrders/${o.vendorCode}/${o.id}/lines/${i}/sku`] = to; }));
  const row = (PTG.mdb || []).find(r => obUC(r && r.sku) === from);
  if (row && row._key) {
    upd[`pt_masterDB/${row._key}/mergedInto`] = to;
    upd[`pt_masterDB/${row._key}/mergedAt`] = new Date().toISOString();
    upd[`pt_masterDB/${row._key}/mergedBy`] = ME.email;
  }
  return Object.keys(upd).length - before;
}
/** A master row for a new SKU: the other fields from a master SKU of the same article, subtype and size (never its
 * picture or Amazon ids), this product's colour and brand. */
function custNewMasterRec(c) {
  const sib = (PTG.mdb || []).find(m => m && m.sku && !CUST_RE.test(m.sku) && ptNorm(m.articleType) === ptNorm(c.articleType)
    && ptNorm(m.subtype) === ptNorm(c.subtype) && ptNorm(m.size) === ptNorm(c.size));
  const rec = sib ? Object.assign({}, sib) : { cuttingRequired: true };
  delete rec._key; delete rec.asin; delete rec.parentAsin; delete rec.renamedFrom; delete rec.mergedInto;
  return Object.assign(rec, { sku: c.to, articleType: c.articleType, subtype: c.subtype, color: c.color, size: c.size,
    brand: c.brand || rec.brand || '', imageUrl: '', isCustom: false, createdFrom: c.from, createdAt: new Date().toISOString(), createdBy: ME.email });
}
async function custFixRun(plan) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const upd = {}, t = Date.now().toString(36), added = [];
  (plan.create || []).forEach((c, i) => {
    const key = 'mdb_' + t + '_c' + String(i).padStart(3, '0'), rec = custNewMasterRec(c);
    upd['pt_masterDB/' + key] = rec; added.push(Object.assign({ _key: key }, rec));
    custMergePaths(c.from, c.to, upd);
  });
  plan.rename.forEach(p => mdbRenamePaths(p.from, p.to, upd));
  plan.merge.forEach(p => custMergePaths(p.from, p.to, upd));
  await ptPatch(upd);
  plan.rename.forEach(p => mdbRenameLocal(p.from, p.to));
  const fix = list => (list || []).map(r => { const pm = r && plan.merge.find(p => p.from === obUC(r.sku)); return pm ? Object.assign({}, r, { sku: pm.to, skuWas: pm.from }) : r; });
  PT.base = fix(PT.base); PT.cut = fix(PT.cut); PTG.press = fix(PTG.press); PTG.ob = fix(PTG.ob);
  QC.checks = fix(QC.checks); QC.issue = fix(QC.issue); FGI.rows = fix(FGI.rows); ACC.ledger = fix(ACC.ledger);
  PTG.mdb = (PTG.mdb || []).map(r => { const pm = r && plan.merge.find(p => p.from === obUC(r.sku)); return pm ? Object.assign({}, r, { mergedInto: pm.to }) : r; }).concat(added);
  if ((plan.create || []).length) {
    const fixC = list => (list || []).map(r => { const pc = r && plan.create.find(p => p.from === obUC(r.sku)); return pc ? Object.assign({}, r, { sku: pc.to, skuWas: pc.from }) : r; });
    PT.base = fixC(PT.base); PT.cut = fixC(PT.cut); PTG.press = fixC(PTG.press); PTG.ob = fixC(PTG.ob);
  }
  return '';
}
let CUSTFIX = { plan: null };
async function custFixOpen() {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading every register…';
  try { await ptLoadGates(); if (typeof mdbRenameLoadAll === 'function') await mdbRenameLoadAll(); } catch (e) { /* read what can be read */ }
  $('ptmMsg').textContent = '';
  const rows = custFixRows();
  const sugg = rows.filter(r => r.suggest).length, pcs = rows.reduce((a, r) => a + r.issued, 0);
  CUSTFIX = { plan: null };
  ptOpenDialog({
    title: 'Custom-order SKUs → real SKUs',
    subtitle: `${nf(rows.length)} custom-order code(s) in use · ${nf(pcs)} pcs issued on them · a real SKU suggested for ${nf(sugg)}`,
    note: '1 · Download the sheet. "New SKU" is filled where one master SKU has the same article, subtype, colour and size — check it, '
      + 'and type the rest (leave it blank to skip a row). 2 · Upload it: you see what it would do before anything is written. '
      + 'Onto a SKU that exists, every register row moves to it and the custom code is marked merged, not deleted. Onto a new code, the custom master row becomes it.',
    html: '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="cfxDl">Download the sheet</button>'
      + '<button type="button" id="cfxUp" class="ghost">Upload the filled sheet</button><input id="cfxFile" type="file" accept=".xlsx,.csv,text/csv" style="display:none"></div>'
      + '<div id="cfxOut" class="muted" style="margin-top:10px;font-size:13px;line-height:1.6"></div>',
    fields: [],
    saveLabel: 'Change them',
    onSave: async () => {
      const pl = CUSTFIX.plan;
      if (!pl || !(pl.merge.length + pl.rename.length + (pl.create || []).length)) return 'Upload the filled sheet first.';
      if (pl.errs.length) return 'Fix the rows the check found, and upload again.';
      try { await custFixRun(pl); } catch (e) { return 'Not changed: ' + (e.message || e) + ' — nothing was written.'; }
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(pl.merge.length)} custom code(s) moved onto existing SKUs, ${nf(pl.rename.length)} renamed, ${nf((pl.create || []).length)} added to the master as new SKUs. Their orders now track on the real SKUs.`;
      return '';
    },
  });
  if ($('cfxDl')) $('cfxDl').onclick = () => ptDownload('custom-order-skus', custFixSheet(rows).map(r => r.map(csvCell).join(',')));
  if ($('cfxUp')) $('cfxUp').onclick = () => $('cfxFile').click();
  if ($('cfxFile')) $('cfxFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    let rs; try { rs = await pkReadFile(f); } catch (er) { $('cfxOut').textContent = 'Could not read that file: ' + (er.message || er); return; }
    const pl = custFixPlan(rs);
    e.target.value = '';
    if (pl.err) { $('cfxOut').className = 'err'; $('cfxOut').textContent = pl.err; return; }
    CUSTFIX.plan = pl;
    const upd = {}; let refs = 0;
    pl.merge.forEach(p => { refs += custMergePaths(p.from, p.to, {}); });
    pl.rename.forEach(p => { refs += mdbRenamePaths(p.from, p.to, upd); });
    (pl.create || []).forEach(p => { refs += custMergePaths(p.from, p.to, {}); });
    $('cfxOut').className = pl.errs.length ? 'err' : 'muted';
    $('cfxOut').innerHTML = `<b>${nf(pl.merge.length)}</b> onto an existing SKU · <b>${nf(pl.rename.length)}</b> renamed to a new code · <b>${nf((pl.create || []).length)}</b> new SKU(s) added to the master · about ${nf(refs)} register rows move.`
      + (pl.errs.length ? '<br>' + pl.errs.slice(0, 8).map(esc).join('<br>') + (pl.errs.length > 8 ? `<br>…and ${nf(pl.errs.length - 8)} more.` : '') : '<br>Press "Change them" to write it.');
  };
}
if ($('ptmCustFix')) $('ptmCustFix').onclick = () => custFixOpen();

/* ---- renaming a SKU, references and all ---- */

/**
 * Read every register a SKU could appear in. A rename can only move what it can see, and a tab the
 * user happens not to have opened must never be the reason a reference is left behind.
 */
async function mdbRenameLoadAll() {
  const load = async (cond, node, set) => { if (cond) return; try { set(ptList(await ptGet(node))); } catch (e) { /* reported by the caller */ } };
  await Promise.all([
    load(QC.checks, 'pt_qcChecks', v => { QC.checks = v; }),
    load(QC.issue, 'pt_qcIssuance', v => { QC.issue = v; }),
    load(FGI.rows, 'pt_fgiLedger', v => { FGI.rows = v; }),
    load(SOX.rows, 'pt_salesOrders', v => { SOX.rows = v; }),
    load(PTE.custom, 'pt_customSkus', v => { PTE.custom = v; }),
    load(ACC.ledger, 'pt_accLedger', v => { ACC.ledger = v; }),
    (async () => { if (!PTE.priority) { try { PTE.priority = (await ptGet('pt_skuPriority')) || {}; } catch (e) { PTE.priority = {}; } } })(),
    (async () => { if (VO.rows) return; try {
      const raw = await ptGet('pt_vendorOrders') || {}; VO.rows = [];
      Object.entries(raw).forEach(([code, orders]) => Object.values(orders || {})
        .forEach(o => { if (o) VO.rows.push(Object.assign({ vendorCode: code }, o)); }));
    } catch (e) { /* reported by the caller */ } })(),
  ]);
}

/**
 * Everything ONE rename has to move, added to a shared patch. Returns how many live rows it touches.
 * Shared by the single rename and the bulk one so neither can start reaching fewer registers.
 */
function mdbRenamePaths(from, to, upd) {
  const before = Object.keys(upd).length;
  const row = (PTG.mdb || []).find(r => obUC(r.sku) === from);
  upd[`pt_masterDB/${row._key}/sku`] = to;
  upd[`pt_masterDB/${row._key}/renamedFrom`] = from;
  upd[`pt_masterDB/${row._key}/renamedAt`] = new Date().toISOString();
  upd[`pt_masterDB/${row._key}/renamedBy`] = ME.email;
  /* Registers key their rows differently: the old ones carry an `id` field, ptList adds `_key` from
   * the node key, and the finished-goods and accessory ledgers use `_id`. A row created in this
   * session has only the last of those, so leaving it out would write to "undefined". */
  const touch = (node, list) => (list || []).filter(r => r && obUC(r.sku) === from)
    .forEach(r => { const k = r.id || r._key || r._id; if (k) upd[`${node}/${k}/sku`] = to; });
  touch('pt_baseData', PT.base || []);
  touch('pt_cuttingData', PT.cut || []);
  touch('pt_pressInventory', PTG.press || []);
  touch('pt_qcChecks', QC.checks || []);
  touch('pt_qcIssuance', QC.issue || []);
  touch('pt_fgiLedger', FGI.rows || []);
  touch('pt_customSkus', PTE.custom || []);
  touch('pt_accLedger', ACC.ledger || []);
  (PTG.ob || []).filter(r => obUC(r.sku) === from)
    .forEach(r => { upd[`pt_orderBook/${r.id || r._key}/sku`] = to; });
  /* An order's lines are nested inside it, so each one is addressed by its own index. Firebase
   * stores an array as an object keyed 0, 1, 2… which is exactly what these paths need. */
  (SOX.rows || []).forEach(o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {}))
    .forEach((l, i) => { if (l && obUC(l.sku) === from) upd[`pt_salesOrders/${o._id}/lines/${i}/sku`] = to; }));
  (VO.rows || []).forEach(o => (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {}))
    .forEach((l, i) => { if (l && obUC(l.sku) === from) upd[`pt_vendorOrders/${o.vendorCode}/${o.id}/lines/${i}/sku`] = to; }));
  /* The priority list is keyed BY the SKU, so the old key is removed and a new one written. */
  if (PTE.priority && PTE.priority[from] !== undefined) {
    upd['pt_skuPriority/' + to] = PTE.priority[from];
    upd['pt_skuPriority/' + from] = null;
  }
  return Object.keys(upd).length - before - 4;      // less the four written on the master row itself
}

/** Move the copies held in memory, so nothing on screen still shows the old code. */
function mdbRenameLocal(from, to) {
  const fix = list => (list || []).map(r => (obUC(r.sku) === from ? Object.assign({}, r, { sku: to }) : r));
  PTG.mdb = (PTG.mdb || []).map(r => (obUC(r.sku) === from ? Object.assign({}, r, { sku: to, renamedFrom: from }) : r));
  PT.mdb = PTG.mdb;
  PT.base = fix(PT.base); PT.cut = fix(PT.cut);
  PTG.press = fix(PTG.press); PTG.ob = fix(PTG.ob);
  QC.checks = fix(QC.checks); QC.issue = fix(QC.issue);
  FGI.rows = fix(FGI.rows); ACC.ledger = fix(ACC.ledger); PTE.custom = fix(PTE.custom);
  const fixLines = o => Object.assign({}, o, { lines: (Array.isArray(o.lines) ? o.lines : Object.values(o.lines || {}))
    .map(l => (l && obUC(l.sku) === from ? Object.assign({}, l, { sku: to }) : l)) });
  if (SOX.rows) SOX.rows = SOX.rows.map(fixLines);
  if (VO.rows) VO.rows = VO.rows.map(fixLines);
  if (PTE.priority && PTE.priority[from] !== undefined) { PTE.priority[to] = PTE.priority[from]; delete PTE.priority[from]; }
  if (MDBIMG.map[from] !== undefined && MDBIMG.map[to] === undefined) MDBIMG.map[to] = MDBIMG.map[from];
}

/** Why one pair cannot be renamed on its own terms — '' when it can. */
function mdbRenameWhyBad(from, to) {
  if (!from || !to) return 'Both the old and the new SKU are needed.';
  if (from === to) return `${from}: the two codes are the same.`;
  if (!(PTG.mdb || []).some(r => obUC(r.sku) === from)) return `${from} is not in the master database.`;
  return '';
}

/**
 * Check a whole file of renames against the master database AND against each other, and return every
 * problem rather than the first. A 200-row file should fail once, with the full list.
 */
function mdbRenamePlan(pairs) {
  const errs = [], froms = new Map(), tos = new Map(), clean = [];
  (pairs || []).forEach((p, i) => {
    const at = 'Row ' + (i + 2) + ': ';
    const from = obUC(p.from), to = obUC(p.to);
    const why = mdbRenameWhyBad(from, to);
    if (why) { errs.push(at + why); return; }
    /* The same code renamed twice — which row wins would be an accident of order. */
    if (froms.has(from)) { errs.push(`${at}${from} is renamed twice (also row ${froms.get(from) + 2}).`); return; }
    /* Two products collapsing into one code is a MERGE, not a rename. Its arithmetic — two histories
     * added together — is nothing like this, and doing it by accident is unrecoverable. */
    if (tos.has(to)) { errs.push(`${at}${to} is the new code for two SKUs (also row ${tos.get(to) + 2}) — that is a merge, not a rename.`); return; }
    froms.set(from, i); tos.set(to, i);
    clean.push({ from, to });
  });
  /* A new code that already belongs to something else — unless that something is itself moving away
   * in this same file, which makes the code free by the time the write lands. */
  clean.forEach(p => {
    if ((PTG.mdb || []).some(r => obUC(r.sku) === p.to) && !froms.has(p.to)) {
      errs.push(`${p.from} → ${p.to}: ${p.to} already exists in the master database.`);
    }
  });
  /* Chains and swaps: A → B where B is also being renamed. Top-down A becomes C, bottom-up it stays
   * B, and neither reading is obviously the one that was meant. */
  clean.forEach(p => {
    if (froms.has(p.to)) errs.push(`${p.from} → ${p.to}: ${p.to} is itself being renamed in this file. Do it in two passes.`);
  });
  return { pairs: clean, errs };
}

/** Every rename in the file, as one all-or-nothing write. */
async function mdbRenameRun(pairs) {
  /* Change SKU rewrites a code across every record that carries it — the order book, cutting, the
   * job work register, the ledger. It is the most far-reaching write on this screen. */
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const upd = {};
  let refs = 0;
  pairs.forEach(p => { refs += mdbRenamePaths(p.from, p.to, upd); });
  await ptPatch(upd);
  pairs.forEach(p => mdbRenameLocal(p.from, p.to));
  renderPmdb();
  return refs;
}

/** old,new out of a file — the same two columns the template offers. */
function mdbRenameFromRows(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const low = (rows[i] || []).map(x => String(x == null ? '' : x).trim().toLowerCase());
    if (low.some(x => /^old ?sku$/.test(x))) { h = i; break; }
  }
  if (h < 0) return { err: 'That file has no "Old SKU" column. Download the template to see the shape.' };
  const low = rows[h].map(x => String(x == null ? '' : x).trim().toLowerCase());
  const at = names => { for (const n of names) { const i = low.indexOf(n); if (i >= 0) return i; } return -1; };
  const ci = { from: at(['old sku', 'oldsku', 'from']), to: at(['new sku', 'newsku', 'to']) };
  if (ci.to < 0) return { err: 'That file has no "New SKU" column.' };
  const out = [];
  rows.slice(h + 1).forEach(r => {
    const from = String(r[ci.from] == null ? '' : r[ci.from]).trim();
    const to = String(r[ci.to] == null ? '' : r[ci.to]).trim();
    if (!from && !to) return;                        // a blank row is not an error
    out.push({ from, to });
  });
  return { rows: out };
}

let MDBREN = { pairs: null, name: '' };

/** What the file would do, before it does it. */
function mdbRenamePreview() {
  const info = $('renInfo'); if (!info) return;
  if (!MDBREN.pairs || !MDBREN.pairs.length) { info.className = 'muted'; info.textContent = ''; return; }
  const upd = {};
  let refs = 0;
  MDBREN.pairs.forEach(p => { refs += mdbRenamePaths(p.from, p.to, upd); });
  info.className = 'muted';
  info.innerHTML = `<b>${esc(MDBREN.name)}</b> · ${nf(MDBREN.pairs.length)} rename(s), `
    + `${nf(refs)} live row(s) would move with them.<br>`
    + MDBREN.pairs.slice(0, 8).map(p => esc(p.from) + ' → ' + esc(p.to)).join(' · ')
    + (MDBREN.pairs.length > 8 ? ` … and ${nf(MDBREN.pairs.length - 8)} more` : '');
}

const MDB_RENAME_MAX = 200;

$('ptmRename').onclick = async () => {
  if (!PTG.mdb) { $('ptmMsg').textContent = 'Reading the master database…'; await ptLoadGates(); }
  MDBREN = { pairs: null, name: '' };
  ptOpenDialog({
    title: 'Change a SKU code',
    note: 'The old code is rewritten everywhere it appears — Job Work Register, Cutting, Press, Quality Control, '
      + 'the Order Book, Finished Goods, sales orders, vendor orders, custom SKUs and the priority list — '
      + 'in one go. Changing it only in the master row would leave those rows pointing at a product that '
      + 'no longer exists.',
    html: `<div class="toolbar" style="margin:0 0 10px">
        <button id="renTmpl" class="ghost" style="padding:4px 10px;font-size:12px">Template</button>
        <button id="renUp" class="ghost" style="padding:4px 10px;font-size:12px">Rename in bulk from a file</button>
        <input id="renFile" type="file" accept=".csv,.xlsx,text/csv" style="display:none">
      </div>
      <div id="renInfo" class="muted" style="font-size:12px;margin-bottom:10px"></div>`,
    fields: [
      { key: 'from', label: 'Old SKU', value: '', span: true },
      { key: 'to', label: 'New SKU', value: '', span: true },
    ],
    onSave: async v => {
      /* A rename can only move what it can see, so everything it touches is read first. */
      ptDlgMsg('Reading every register the SKU could appear in…');
      await mdbRenameLoadAll();
      ptDlgMsg('');

      /* A file, if one was chosen — otherwise the two boxes. */
      const pairs = (MDBREN.pairs && MDBREN.pairs.length)
        ? MDBREN.pairs
        : [{ from: obUC(v.from), to: obUC(v.to) }];
      if (pairs.length === 1 && (!pairs[0].from || !pairs[0].to)) return 'Enter both the old and the new SKU, or choose a file.';
      if (pairs.length > MDB_RENAME_MAX) return `${nf(pairs.length)} renames in one file is too many to write as a single `
        + `all-or-nothing update. Split it into files of ${nf(MDB_RENAME_MAX)} or fewer.`;

      const plan = mdbRenamePlan(pairs);
      /* ONE BAD ROW REFUSES THE FILE. A half-applied rename leaves the same product counted under two
       * codes, with nothing on either to say so. */
      if (plan.errs.length) return 'Nothing was changed. ' + plan.errs.slice(0, 5).join(' ')
        + (plan.errs.length > 5 ? ` …and ${nf(plan.errs.length - 5)} more.` : '');
      if (!plan.pairs.length) return 'That file has no renames in it.';

      const refs = await mdbRenameRun(plan.pairs);
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = plan.pairs.length === 1
        ? `${plan.pairs[0].from} is now ${plan.pairs[0].to} — ${nf(refs)} live row(s) moved with it.`
        : `${nf(plan.pairs.length)} SKUs renamed — ${nf(refs)} live row(s) moved with them.`;
      MDBREN = { pairs: null, name: '' };
      return '';
    },
  });

  $('renTmpl').onclick = () => ptDownload('sku-rename-template',
    ['Old SKU,New SKU', 'RPC72-1616,RPC072-1616']);
  $('renUp').onclick = () => $('renFile').click();
  $('renFile').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    ptDlgMsg('Reading ' + f.name + '…');
    let rows;
    try { rows = await pkReadFile(f); }
    catch (err) { ptDlgMsg('Could not read that file: ' + (err.message || err), true); return; }
    const got = mdbRenameFromRows(rows);
    if (got.err) { ptDlgMsg(got.err, true); return; }
    if (!got.rows.length) { ptDlgMsg('That file has no rows under the header.', true); return; }
    ptDlgMsg('');
    /* The master database has to be in memory before the preview can count what moves. */
    if (!PTG.mdb) await ptLoadGates();
    await mdbRenameLoadAll();
    MDBREN = { pairs: got.rows, name: f.name };
    const plan = mdbRenamePlan(got.rows);
    if (plan.errs.length) {
      MDBREN = { pairs: null, name: '' };
      $('renInfo').className = 'err';
      $('renInfo').innerHTML = 'Nothing will be changed — ' + esc(plan.errs.slice(0, 6).join(' '))
        + (plan.errs.length > 6 ? esc(` …and ${nf(plan.errs.length - 6)} more.`) : '');
      return;
    }
    mdbRenamePreview();
    ptDlgMsg(`${nf(got.rows.length)} rename(s) ready — press Save to apply them as one write.`);
  };
};

/* ---- The picture, available to every register ----
 *
 * One cell, used by Master Database, Base Data, Cutting, Press and Quality Control — and by whatever
 * is built next. A register that drew its own would drift from the others the first time the rule
 * changed, and the rule here is not obvious: a link typed on the master row BEATS whatever Amazon
 * answered, because Amazon only knows the codes it sells and the factory's own codes are not among
 * them.
 *
 * Three states, and they are not the same thing:
 *   a url  — this is the picture
 *   ''     — asked, Amazon has none. Says "none".
 *   undefined — never asked. Says "—", or "…" while a lookup is running.
 * Collapsing the last two into an empty box is what makes a working feature look broken.
 */
let _imgOwnMap = null, _imgOwnFor = null;
/** sku -> a link typed on its master row. Rebuilt only when the master database itself changes. */
function ptImgOwn() {
  if (_imgOwnMap && _imgOwnFor === PTG.mdb) return _imgOwnMap;
  const m = new Map();
  (PTG.mdb || []).forEach(r => { if (r && r.imageUrl) m.set(obUC(r.sku), r.imageUrl); });
  _imgOwnMap = m; _imgOwnFor = PTG.mdb;
  return m;
}
function ptImgOf(sku) {
  const k = obUC(sku);
  if (!k) return undefined;
  /* The shared node comes AFTER the two that need the backend, so an account that has one still
   * gets the freshest answer, and one that has neither still gets a picture. */
  const own = ptImgOwn().get(k);
  if (own) return own;
  if (MDBIMG.map[k]) return MDBIMG.map[k];
  const shared = PTIMG.map[k];
  if (shared === IMG_NONE) return '';        // asked, and Amazon has none — not a picture
  return shared;
}

/**
 * The picture at the size it is about to be DRAWN at, rather than the size it was uploaded at.
 *
 * Measured on the pictures actually stored: 530 KB and 1,237 KB, both painted into a 38-pixel box.
 * The same two at width=80 are 4 KB each. Nothing in this app draws a picture larger than 44px.
 *
 * Both hosts resize on request, so this only rewrites the ADDRESS — the stored URL is untouched and
 * an export still carries the original. A host with no known resize is returned as it came: guessing
 * a parameter that does not exist turns a slow picture into a missing one.
 */
function ptImgSrc(u, px) {
  const raw = String(u || '');
  if (!raw) return raw;
  /* Three times the box, so it stays sharp on a high-density screen and still costs a few KB. */
  const want = Math.max(80, Math.min(400, Math.round((px || 38) * 3)));
  try {
    const url = new URL(raw);
    const host = url.host.toLowerCase();
    /* Shopify — both the shared CDN and a shop's own domain, which serves the same /cdn/shop/ paths. */
    if (host === 'cdn.shopify.com' || url.pathname.indexOf('/cdn/shop/') >= 0) {
      url.searchParams.set('width', String(want));
      url.searchParams.delete('height');       // a height beside a new width would crop, not scale
      return url.toString();
    }
    /* Amazon's image server takes a size modifier in the filename: 51sx3A0mf1L._SL120_.jpg. One is
     * only added where there is none — an address that already carries modifiers was built by
     * somebody who meant them. */
    if (/(^|\.)media-amazon\.com$/.test(host) || /(^|\.)ssl-images-amazon\.com$/.test(host)) {
      const m = url.pathname.match(/^(.*\/[^/.]+)\.(jpg|jpeg|png|webp)$/i);
      if (m) { url.pathname = m[1] + '._SL' + want + '_.' + m[2]; return url.toString(); }
    }
  } catch (e) { /* not a URL this can take apart — hand it back untouched */ }
  return raw;
}

function ptImgInner(sku, px) {
  const u = ptImgOf(sku), s = px || 38;
  if (u) return `<img src="${esc(ptImgSrc(u, s))}" alt="" loading="lazy" title="${esc(sku)}"`
    + ` style="width:${s}px;height:${s}px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">`;
  return `<span class="muted" style="font-size:11px">${u === '' ? 'none' : (MDBIMG.busy ? '…' : '—')}</span>`;
}
/* The cell carries its SKU so a lookup that finishes later can fill THIS cell instead of rebuilding
 * the table around it. Repainting 600 rows fifteen times over is what made the app feel stuck. */
/** The picture alone, to sit inside a cell that carries other text as well. */
function ptImgSpan(sku, px) {
  return `<span data-img="${esc(obUC(sku))}" data-imgpx="${px || 38}" style="flex:0 0 auto;line-height:0">${ptImgInner(sku, px)}</span>`;
}
function ptImgCell(sku, px) {
  return `<td data-img="${esc(obUC(sku))}" data-imgpx="${px || 38}">${ptImgInner(sku, px)}</td>`;
}
/**
 * The same cell, but for a line that came with its OWN picture — a Shopify order line.
 *
 * It carries no data-img, so the background lookup leaves it alone: there is nothing to look up, the
 * answer arrived with the order. Without a picture it falls back to the ordinary cell rather than
 * showing a blank, because the catalogue's photo is better than none.
 */
function ptImgCellSrc(sku, url, px) {
  const u = String(url || '').trim();
  if (!u) return ptImgCell(sku, px);
  const s = px || 38;
  return `<td><img src="${esc(ptImgSrc(u, s))}" alt="" loading="lazy" title="${esc(sku)}"`
    + ` style="width:${s}px;height:${s}px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"></td>`;
}
function ptImgPatch() {
  /* A cell of its own, or a picture inside a cell that says more (the Job Work "Item" column). */
  document.querySelectorAll('[data-img]').forEach(td => {
    const sku = td.getAttribute('data-img');
    if (ptImgOf(sku) === undefined && !MDBIMG.busy) return;   // still unknown and nothing running
    td.innerHTML = ptImgInner(sku, Number(td.getAttribute('data-imgpx')) || 38);
  });
}

/**
 * Look up the pictures a screen needs. Safe to call at the end of any render: it returns at once
 * when there is nothing new to ask about, and while it is running the re-render it triggers finds
 * MDBIMG.busy set and does not start a second one.
 */
/**
 * Run this only while that screen is still the one on show.
 *
 * The picture lookup below takes seconds and asks for a whole re-render when it lands. Landing after
 * somebody has moved on, it drew a table nobody was looking at — a megabyte of it — and put back
 * exactly what tabShed had just cleared away.
 *
 * TAB_NOW is declared with the navigation, which the test harness does not evaluate, so it is asked
 * for by typeof the way the Finished Goods listener already does.
 */
const ptIfTab = (tab, fn) => () => {
  if (typeof TAB_NOW === 'undefined' || !TAB_NOW || TAB_NOW === tab) fn();
};

async function ptImgFill(skus, force, after) {
  if (MDBIMG.busy) return;
  await mdbImgCacheLoad();
  const own = new Set((PTG.mdb || []).filter(r => r.imageUrl).map(r => obUC(r.sku)));
  let want = [...new Set((skus || []).map(obUC)
    .filter(s => s && !own.has(s) && (force || MDBIMG.map[s] === undefined)))];
  if (!want.length) return;
  /* A CEILING ON ONE PASS. Each batch of forty is a separate call to a Google Apps Script, seconds
   * apiece — six hundred unknown SKUs is fifteen of them in a row, and a cold cache was ninety-six.
   * Whatever is left is picked up on the next visit, by which time these are on record and free. */
  if (want.length > IMG_MAX_PASS) {
    MDBIMG.msg = `looking up ${nf(IMG_MAX_PASS)} of ${nf(want.length)} pictures — the rest follow`;
    want = want.slice(0, IMG_MAX_PASS);
  }
  if (!PRAPI || !PRAPI.url) {
    // Say it once rather than on every render, and only where it can be read.
    if (!MDBIMG.msg) { MDBIMG.msg = 'Pictures need the Price Research backend, which this account cannot read.'; if (after) after(); }
    return;
  }
  MDBIMG.busy = true;
  let got = 0; const why = [];
  try {
    for (let i = 0; i < want.length; i += 40) {
      const chunk = want.slice(i, i + 40);
      MDBIMG.msg = `looking up pictures… ${nf(i)} of ${nf(want.length)}`;
      // Only the picture cells are touched between batches — not the whole table.
      ptImgPatch();
      const d = await prGet({ imgsku: chunk.join(',') });
      // '' is a real answer — "asked, Amazon has none" — and it is what stops the re-asking.
      chunk.forEach(s => {
        MDBIMG.map[s] = (d.d && d.d[s]) || '';
        /* BOTH answers are shared. A picture is obviously worth keeping — but so is "Amazon has
         * none", and that is the one that matters: most of these are factory codes Amazon has never
         * listed, and without recording the nothing they were asked for again on every single load. */
        PTIMG.map[s] = MDBIMG.map[s] || IMG_NONE;
        PTIMG.dirty[s] = PTIMG.map[s];
      });
      got += Object.keys(d.d || {}).length;
      if (d.why && !why.length) why.push(d.why);
      IMG_DIRTY = true;
    }
    /* Written ONCE, after the loop. It was inside it, so a screen that looked up six hundred SKUs
     * also wrote to the database fifteen times over. */
    ptImgSharePut();
    const none = want.length - got;
    MDBIMG.msg = none
      ? `${nf(none)} of ${nf(want.length)} SKU(s) have no Amazon picture — ${why[0] || 'those codes are not in the Catalog tabs.'}`
      : '';
  } catch (e) {
    MDBIMG.msg = 'Could not fetch pictures: ' + (e.message || e);
  }
  MDBIMG.busy = false;
  if (after) after();
  mdbImgCacheSave();
}

