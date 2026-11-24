/* ================= SKU CODES — A NEW COLOUR'S SKUS =================
 *
 * Ravi, 2026-09-22: "mujhe ek SKU recipe bhi banani h" — with the sheet his team keeps by hand:
 * Color Code and Color typed, everything else following. Every article, subtype and size has a BASE
 * code; a colour's SKU is that base with the colour's code put in:
 *
 *     RTC-6060   + 327  →  RTC327-6060     (in front of the first dash)
 *     R-BB-      + 327  →  R-BB-327        (a base that ends in a dash takes it at the end)
 *     RTME--8    + 327  →  RTME-327-8      (a double dash is where it goes)
 *     RCNB       + 327  →  RCNB327         (no dash at all: at the end)
 *
 * All 90 rows of that sheet come out exactly as it has them, and so do the 95 Light Steel Blue SKUs
 * already in the master (tests/prod-test.js checks both).
 *
 * The base codes live in pt_masters/skuCode, one row per article + subtype + size. Picking a colour
 * finds its code from the SKUs it already has (the code that turns the most base codes into its own
 * SKUs), so an existing colour does not have to be looked up; a code that another colour's SKUs
 * already carry is refused, because two colours under one code is two products under one SKU.
 *
 * "Create the new ones" writes only what is not already in the master, and copies everything else —
 * brand, cloth, consumption, pack, zip, ruffle, filling, valuation — from the same article, subtype
 * and size in another colour, then lets the Recipe fill whatever is still blank. The picture is never
 * copied: another colour's picture is the wrong picture.
 */
const SKC_COLS = ['Article', 'Subtype', 'Size', 'Base Code'];
/* THE BRAND IS TYPED, not copied (Ravi, same day: "brand name which is manual field"): a new colour
 * can go out under a different brand from the colours before it. */
let SKC = { col: '', code: '', brand: '', auto: true };

/** Brands the master already uses — offered, never enforced. */
function skcBrands() {
  const seen = new Map();
  (PTG.mdb || []).forEach(m => { const b = String((m && m.brand) || '').trim(); if (b && !seen.has(b.toLowerCase())) seen.set(b.toLowerCase(), b); });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/* EACH BRAND ITS OWN BASE CODES (Ravi, 17 Nov: "cpc ke liye base code diffrent h, yaha me jese hi brand change karu auto base code change
 * hona chahiye"). The base codes typed or uploaded so far are Ridhi's (R…, no brand on the row). A row saved with a brand belongs to that
 * brand. A brand with no rows of its own gets them worked out of its own SKUs in the master — CPC038-60120 → CPC-60120, CPCN007 → CPCN,
 * CPCLS-CO-002 → CPCLS-CO- — each kept only if base + its colour code gives that SKU back exactly. */
const skcSort = list => list.sort((a, b) => String(a.base).localeCompare(String(b.base)) || String(a.size || '').localeCompare(String(b.size || '')));
const skcStored = () => ptList((PTG.masters || {}).skuCode).filter(r => r && String(r.base || '').trim());
const skcIsRidhi = b => !b || /^ridhi\b/i.test(String(b).trim());
let SKC_DER = { src: null, brand: null, rows: [] };
function skcDerived(brand) {
  const src = PTG.mdb || [], br = String(brand || '').trim().toLowerCase();
  if (SKC_DER.src === src && SKC_DER.brand === br) return SKC_DER.rows;
  const by = new Map();
  src.forEach(m => {
    if (!m || !m.sku || m.isCustom || String(m.brand || '').trim().toLowerCase() !== br) return;
    const sku = obUC(m.sku), x = sku.match(/^([A-Z]+(?:-[A-Z]+)*-?)(\d{1,5})(.*)$/);
    if (!x) return;
    const pre = x[1], rest = x[3];
    const base = rest ? pre + rest : pre;
    if (skcFull(base, x[2]) !== sku) return;                      // only a base that gives the SKU back exactly
    const e = by.get(base) || { base, n: 0, what: new Map() };
    e.n++;
    const w = [m.articleType || '', m.subtype || '', m.size || ''].join('|');
    e.what.set(w, (e.what.get(w) || 0) + 1);
    by.set(base, e);
  });
  const rows = [...by.values()].map(e => {
    const [article, subtype, size] = [...e.what.entries()].sort((a, b) => b[1] - a[1])[0][0].split('|');
    return { base: e.base, article, subtype, size, brand: brand, derived: true, n: e.n };
  });
  /* ONE BASE PER ARTICLE + SUBTYPE + SIZE (Ravi, 17 Nov: "duplicate size ke liye sku nahi chahiye with same article same subtype — common
   * base sku format dekho"). Old SKUs gave two bases for one product (132 Round: CPC-12R and CPC-132; 72x190: CPC-131 and CPC-14). The
   * one most of that product's SKUs follow is kept; the others are named on it, never offered to make new SKUs with. */
  const best = new Map();
  rows.forEach(r => { const k = [r.article, r.subtype, r.size].map(x => String(x || '').trim().toLowerCase()).join('|'), b = best.get(k);
    if (!b) { best.set(k, Object.assign(r, { alt: [] })); return; }
    const win = r.n > b.n || (r.n === b.n && r.base.length < b.base.length) ? r : b, lose = win === r ? b : r;
    win.alt = (win.alt || []).concat([lose.base], lose.alt || []); best.set(k, win); });
  SKC_DER = { src, brand: br, rows: skcSort([...best.values()]) };
  return SKC_DER.rows;
}
/** The base rows for the brand typed: its own saved rows; for Ridhi the rows with no brand; for another brand with none saved, its SKUs'. */
function skcRows() {
  const b = String((SKC && SKC.brand) || '').trim(), all = skcStored();
  if (skcIsRidhi(b)) return skcSort(all.filter(r => skcIsRidhi(r.brand)));
  const own = all.filter(r => String(r.brand || '').trim().toLowerCase() === b.toLowerCase());
  return own.length ? skcSort(own) : skcDerived(b);
}

/** A colour's SKU out of a base code. '' when either is missing. */
function skcFull(base, code) {
  const b = String(base || '').trim().toUpperCase(), c = String(code || '').trim().toUpperCase();
  if (!b || !c) return '';
  if (b.indexOf('--') >= 0) return b.replace('--', '-' + c + '-');
  if (b.endsWith('-')) return b + c;
  const i = b.indexOf('-');
  return i < 0 ? b + c : b.slice(0, i) + c + b.slice(i);
}

/** The colours in the Colour master, by their description. */
function skcColours() {
  const seen = new Map();
  ptList((PTG.masters || {}).colour).forEach(c => {
    if (!c || c.active === false) return;
    const n = String(c.desc || c.code || '').trim();
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The code a colour's SKUs already carry — the one that turns the most base codes into its own SKUs. */
function skcCodeOf(colour) {
  const col = String(colour || '').trim().toLowerCase();
  if (!col) return '';
  const mine = new Set((PTG.mdb || []).filter(m => String(m.color || '').trim().toLowerCase() === col).map(m => obUC(m.sku)));
  if (!mine.size) return '';
  const cands = new Set();
  mine.forEach(sku => (sku.match(/\d+/g) || []).forEach(d => cands.add(d)));
  const bases = skcRows();
  let best = '', n = 0;
  cands.forEach(c => {
    const k = bases.reduce((a, r) => a + (mine.has(skcFull(r.base, c)) ? 1 : 0), 0);
    if (k > n || (k === n && k > 0 && c.length > best.length)) { n = k; best = c; }
  });
  return best;
}

/** Another colour already under this code? Its name, or ''. */
function skcCodeOwner(code, colour) {
  if (!String(code || '').trim()) return '';
  const col = String(colour || '').trim().toLowerCase();
  for (const r of skcRows()) {
    const m = mdbOf(skcFull(r.base, code));
    if (m && String(m.color || '').trim().toLowerCase() !== col) return String(m.color || '').trim() || '(no colour)';
  }
  return '';
}

/* IS THE CODE FREE (Ravi, 17 Nov: "ye bhi show kare ki ye 632 color code available h ya nahi ya fir same sku duplicate to nahi ho").
 * Every SKU in the master database and on the Custom SKUs list whose colour code (the first number in it) is this code, by colour:
 * { free, mine, others: [{ colour, n, eg }], have } — "have" is how many of this colour's SKUs under the code are already made. */
function skcCodeCheck(code, colour, brand) {
  /* Within the brand typed (17 Nov): Ridhi's 632 and CPC's 632 are two brands' own numbering, not a clash. A SKU with no brand counts. */
  const c = String(code || '').trim(), col = String(colour || '').trim().toLowerCase(), br = String(brand || '').trim().toLowerCase();
  if (!c) return null;
  const num = n => String(Number(n));
  const by = new Map(); let have = 0;
  const custom = (typeof MDBX !== 'undefined' && MDBX.custom) || [];
  (PTG.mdb || []).concat(custom).forEach(m => {
    if (!m || !m.sku) return;
    if (br && String(m.brand || '').trim() && String(m.brand).trim().toLowerCase() !== br) return;
    const d = (String(m.sku).toUpperCase().match(/^[A-Z]+(?:-[A-Z]+)*-?(\d{1,5})/) || [])[1];
    if (!d || (d !== c && num(d) !== num(c))) return;
    const mc = String(m.color || '').trim();
    if (mc.toLowerCase() === col) { have++; return; }
    const k = mc.toLowerCase() || '(no colour)', e = by.get(k) || { colour: mc || '(no colour)', n: 0, eg: obUC(m.sku) };
    e.n++; by.set(k, e);
  });
  const others = [...by.values()].sort((a, b) => b.n - a.n);
  return { free: !others.length && !have, mine: have > 0, others, have };
}

/** The table: every base row, with its full code for this colour and whether the master has it. */
function skcTable(colour, code) {
  const col = String(colour || '').trim().toLowerCase();
  return skcRows().map(r => {
    const full = skcFull(r.base, code);
    const m = full ? mdbOf(full) : null;
    const state = !full ? '' : !m ? 'new' : String(m.color || '').trim().toLowerCase() === col ? 'have' : 'taken';
    return { r, full, m, state };
  });
}

/** The SKU of the same article, subtype and size in another colour — it already says everything but the colour. */
function skcSibling(r) {
  const ci = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const mdb = (PTG.mdb || []).filter(m => m && !m.isCustom);
  const byBase = mdb.find(m => (String(m.sku || '').match(/\d+/g) || []).some(d => skcFull(r.base, d) === obUC(m.sku)));
  return byBase || mdb.find(m => ci(m.articleType, r.article) && ci(m.subtype, r.subtype) && ci(m.size, r.size)) || null;
}

/** What "Create the new ones" would write, and what it would not, with the reason. */
function skcPlanNew(colour, code, brand) {
  const col = String(colour || '').trim(), brd = String(brand || '').trim(), out = [], skip = [];
  if (!brd) return { out, skip, err: 'Type the brand.' };
  if (!col) return { out, skip, err: 'Pick the colour.' };
  if (!String(code || '').trim()) return { out, skip, err: 'Type the colour code.' };
  /* A NEW COLOUR JOINS THE COLOUR MASTER BY ITSELF (Ravi, 17 Nov: "jab bhi m koi naya sku create krta hu to jese hi create sku kiya
   * jay wo auto masterdata me add ho jay"). It was refused — "Add it under Masters first". Now Create adds it to the Colour master
   * in the same write as the SKUs (skcCreate); the plan only says so. */
  const newColour = !skcColours().some(c => c.toLowerCase() === col.toLowerCase());
  /* THE MASTER'S OWN FORMAT (17 Nov: "jo formatting hamare masterdata me bahi rakhni h"): a new colour is written Title Case, as every
   * colour in the master database is (Sage Leaf Green), whatever case it was typed in. A colour already on the list keeps its spelling. */
  const colT = newColour ? col.toLowerCase().replace(/\s+/g, ' ').replace(/(^|[\s\-\/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : (skcColours().find(c => c.toLowerCase() === col.toLowerCase()) || col);
  /* ONLY THE SKUs STILL FREE (Ravi, 20 Nov: "sare sku bane hue nahi h but main code available h to is case me sirf bache hue sku hi data
   * me add ho"). A code another colour already uses on SOME SKUs no longer stops the whole colour: every full code that already
   * exists — in the master or on the Custom SKUs list — is left as it is and listed as not made, with whose it is; the rest are made. */
  const custom = new Map(((typeof MDBX !== 'undefined' && MDBX.custom) || []).filter(m => m && m.sku).map(m => [obUC(m.sku), m]));
  const seen = new Set();
  skcTable(col, code).forEach(({ r, full, m, state }) => {
    const label = [r.article, r.subtype, r.size].filter(Boolean).join(' · ');
    if (state === 'taken') { skip.push({ full, label, why: 'already ' + (String((m && m.color) || '').trim() || 'another colour') + ' — its SKU, left as it is' }); return; }
    if (state !== 'new') return;
    if (custom.has(full)) { skip.push({ full, label, why: 'already on the Custom SKUs list (' + (String(custom.get(full).color || '').trim() || 'no colour') + ')' }); return; }
    if (seen.has(full)) { skip.push({ full, label, why: 'two base rows give this same code' }); return; }
    seen.add(full);
    if (!String(r.article || '').trim() || !String(r.subtype || '').trim()) { skip.push({ full, label, why: 'the base row has no article or subtype' }); return; }
    if (!String(r.size || '').trim()) { skip.push({ full, label, why: 'the base row has no size — the master needs one' }); return; }
    const bad = validateAgainstMasters(r.article, r.subtype, col, r.size).filter(e => !(newColour && /^Colou?r\b/i.test(e)));
    if (bad.length) { skip.push({ full, label, why: bad[0] }); return; }
    const sib = skcSibling(r);
    const base = sib ? Object.assign({}, sib) : { brand: '', cuttingRequired: true };
    delete base._key; delete base.asin; delete base.parentAsin;     // the sibling's listing is not this SKU's
    const rec = Object.assign(base, { sku: full, articleType: String(r.article).trim(), subtype: String(r.subtype).trim(),
      color: colT, size: String(r.size).trim(), brand: brd, imageUrl: '', isCustom: false });
    const filled = recipeFill(rec);
    out.push({ rec: filled.rec, label, from: sib ? sib.sku : '', recipe: filled.from.length });
  });
  return { out, skip, err: '', newColour, colour: colT };
}

async function skcCreate(colour, code, brand) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const plan = skcPlanNew(colour, code, brand);
  if (plan.err) return plan.err;
  if (!plan.out.length) return 'Nothing to create — every SKU of this colour is already in the master.';
  const t = Date.now(), patch = {}, added = [];
  /* the colour first, in the same write: the Colour master's own row shape (masters.js mstSave) */
  let colKey = '', colRow = null;
  if (plan.newColour) {
    const col = plan.colour || String(colour).trim(), now = new Date().toISOString();
    const taken = ptList((PTG.masters || {}).colour).some(x => x && String(x.code || '').trim().toLowerCase() === col.toLowerCase());
    colKey = typeof mstNextKey === 'function' ? mstNextKey('colour') : 'm_' + t.toString(36);
    colRow = { code: (taken ? col + ' ' + String(code).trim() : col).toUpperCase(), desc: col,   // the master's codes are the name in capitals active: true, createdAt: now, createdBy: ME.email,
      modifiedAt: now, modifiedBy: ME.email, addedFrom: 'SKU codes — colour code ' + String(code).trim() };
    patch['pt_masters/colour/' + colKey] = colRow;
  }
  plan.out.forEach((x, i) => {
    const key = 'mdb_' + t + '_' + String(i).padStart(3, '0');
    patch['pt_masterDB/' + key] = x.rec;
    added.push(Object.assign({ _key: key }, x.rec));
  });
  try { await ptPatch(patch); } catch (e) { return 'Not saved: ' + (e.message || e); }
  if (colRow) { PTG.masters = Object.assign({}, PTG.masters || {}); PTG.masters.colour = Object.assign({}, PTG.masters.colour || {}, { [colKey]: colRow }); }
  PTG.mdb = (PTG.mdb || []).concat(added);
  PT.mdb = PTG.mdb;
  return '';
}

/** One base row: add or change. Keyed by its base code, which is what makes it one. */
async function skcSaveRow(id, v) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const rec = { article: String(v.article || '').trim(), subtype: String(v.subtype || '').trim(),
    size: String(v.size || '').trim(), base: String(v.base || '').trim().toUpperCase() };
  if (!rec.base) return 'Type the base code.';
  if (!rec.article || !rec.subtype) return 'Article and subtype are both needed.';
  if (/\d{3}/.test(rec.base.split('-')[0]) && !rec.base.includes('--')) return 'That looks like a full SKU — the base code has no colour code in it (e.g. RTC-6060, not RTC327-6060).';
  const dup = ptList((PTG.masters || {}).skuCode).find(r => r && r._key !== id && String(r.base || '').trim().toUpperCase() === rec.base);
  if (dup) return `${rec.base} is already the base code of ${[dup.article, dup.subtype, dup.size].filter(Boolean).join(' · ')}.`;
  const key = id || 'skc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const brd = String((SKC && SKC.brand) || '').trim();
  if (!skcIsRidhi(brd)) rec.brand = brd;          // a brand's own base code (17 Nov); Ridhi's rows stay without one
  rec.by = ME.email; rec.at = new Date().toISOString();
  try { await ptPut('pt_masters/skuCode/' + key, rec); } catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.masters = Object.assign({}, PTG.masters || {});
  PTG.masters.skuCode = Object.assign({}, PTG.masters.skuCode || {}, { [key]: rec });
  return '';
}

function skcEditOpen(id) {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const cur = id ? ptList((PTG.masters || {}).skuCode).find(r => r._key === id) : null;
  const listOf = k => [...new Set(ptList((PTG.masters || {})[k]).map(x => x.desc || x.code).filter(Boolean))];
  ptOpenDialog({
    title: cur ? 'Edit base code' : 'New base code',
    note: 'The base code is the SKU without the colour code: RTC-6060 for RTC327-6060, R-BB- for R-BB-327, RTME--8 for RTME-327-8.',
    fields: [
      { key: 'article', label: 'Article', value: cur ? cur.article : '', list: listOf('articleType') },
      { key: 'subtype', label: 'Subtype', value: cur ? cur.subtype : '', list: listOf('articleSubtype') },
      { key: 'size', label: 'Size', value: cur ? cur.size : '', list: listOf('size') },
      { key: 'base', label: 'Base code', value: cur ? cur.base : '' },
    ],
    deleteWhat: cur ? `the base code ${cur.base}` : '',
    onSave: async v => { const err = await skcSaveRow(id, v); if (!err) renderPmdb(); return err; },
    onDelete: cur ? async () => {
      try { await ptDelete('pt_masters/skuCode/' + id); } catch (e) { return 'Not deleted: ' + (e.message || e); }
      const m = Object.assign({}, (PTG.masters || {}).skuCode || {}); delete m[id];
      PTG.masters = Object.assign({}, PTG.masters || {}, { skuCode: m });
      renderPmdb();
      return '';
    } : null,
  });
}

/** Rows of a sheet into base rows — his own sheet works as it is: the colour columns are simply not read. */
function skcSheetEntries(grid) {
  if (!grid || !grid.length) return { err: 'The file is empty.' };
  /* His sheet has a row of "Manual / Auto" above the real header; the header is the row that names the base code. */
  const hi = grid.findIndex(r => (r || []).some(c => /^base\s*code$/i.test(String(c || '').trim())));
  if (hi < 0) return { err: 'The file needs a "Base Code" column (and Article, Subtype, Size).' };
  const head = grid[hi].map(h => String(h || '').trim().toLowerCase());
  const ix = n => head.indexOf(n);
  const at = { article: ix('article'), subtype: ix('subtype'), size: ix('size'), base: ix('base code') };
  if (at.article < 0 || at.subtype < 0) return { err: 'The file needs Article and Subtype columns.' };
  const entries = [];
  grid.slice(hi + 1).forEach((r, k) => {
    const get = i => (i < 0 ? '' : String((r || [])[i] == null ? '' : r[i]).trim());
    if (!get(at.base) && !get(at.article)) return;
    entries.push({ row: hi + k + 2, article: get(at.article), subtype: get(at.subtype), size: get(at.size), base: get(at.base).toUpperCase() });
  });
  return { entries };
}

/** What an upload would add and change, by base code; rows it cannot take are named. */
function skcUploadPlan(entries) {
  const have = new Map(ptList((PTG.masters || {}).skuCode).map(r => [String(r.base || '').trim().toUpperCase(), r]));
  const add = [], change = [], skip = [], seen = new Set();
  (entries || []).forEach(e => {
    if (!e.base) { skip.push({ row: e.row, why: 'no base code' }); return; }
    if (!e.article || !e.subtype) { skip.push({ row: e.row, why: 'no article or subtype' }); return; }
    if (seen.has(e.base)) { skip.push({ row: e.row, why: e.base + ' is on the sheet twice' }); return; }
    seen.add(e.base);
    const cur = have.get(e.base);
    const rec = { article: e.article, subtype: e.subtype, size: e.size, base: e.base };
    if (!cur) add.push(rec);
    else if (['article', 'subtype', 'size'].some(k => String(cur[k] || '').trim() !== rec[k])) change.push(Object.assign({ _key: cur._key }, rec));
  });
  return { add, change, skip };
}

async function skcUploadRun(plan) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const t = Date.now().toString(36), patch = {}, now = new Date().toISOString();
  plan.add.forEach((r, i) => { patch['pt_masters/skuCode/skc_' + t + '_' + i] = Object.assign({}, r, { by: ME.email, at: now }); });
  plan.change.forEach(r => { const x = Object.assign({}, r, { by: ME.email, at: now }); delete x._key; patch['pt_masters/skuCode/' + r._key] = x; });
  if (!Object.keys(patch).length) return '';
  try { await ptPatch(patch); } catch (e) { return 'Not saved: ' + (e.message || e); }
  const m = Object.assign({}, (PTG.masters || {}).skuCode || {});
  Object.keys(patch).forEach(p => { m[p.split('/').pop()] = patch[p]; });
  PTG.masters = Object.assign({}, PTG.masters || {}, { skuCode: m });
  return '';
}

/** The export: his sheet's own columns, with the colour and code filled in. */
function skcSheetRows() {
  const out = [['Brand', 'Color Code', 'Color', 'Article', 'Subtype', 'Size', 'Base Code', 'Full Code', 'In master']];
  (SKC.shown || []).forEach(x => out.push([skcBrandOf(x), SKC.code, SKC.col, x.r.article || '', x.r.subtype || '', x.r.size || '', x.r.base || '', x.full,
    x.state === 'have' ? 'Yes' : x.state === 'taken' ? 'Taken by ' + (x.m && x.m.color) : x.state === 'new' ? 'New' : '']));
  return out;
}

function renderSkuCode() {
  if (ptLack(PTG_MASTER, ['mdb', 'masters'])) {
    $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the master database…';
    ptNeed(PTG_MASTER, { why: 'sku codes' }).then(() => { if (PTG.mdb) renderPmdb(); });
    return;
  }
  const all = skcRows();
  ptFill('ptmArt', all.map(r => r.article), 'All articles');
  ptFill('ptmSub', all.filter(r => !$('ptmArt').value || r.article === $('ptmArt').value).map(r => r.subtype), 'All subtypes');
  ptFill('ptmSz', all.map(r => r.size), 'All sizes');
  /* The picker is drawn once and kept, so typing in it does not lose the cursor on every key. */
  if (!$('skcCol')) {
    const edit = mdbCanEdit();
    $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">SKU codes for a colour</span>
        <span class="kpiwhen">base code + colour code = SKU</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:8px">
        <label style="flex:0 0 160px">Brand <input id="skcBrand" list="skcBrandList" placeholder="e.g. Ridhi" value="${esc(SKC.brand)}">
          <datalist id="skcBrandList">${skcBrands().map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
        <label style="flex:1 1 220px">Colour <input id="skcCol" list="skcColList" placeholder="Pick or type the colour" value="${esc(SKC.col)}">
          <datalist id="skcColList">${skcColours().map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label style="flex:0 0 140px">Colour code <input id="skcCode" placeholder="e.g. 327" value="${esc(SKC.code)}">
          <div id="skcCodeSays" style="font-size:11.5px;font-weight:600;margin-top:3px;min-height:14px"></div></label>
        ${edit ? '<button id="skcMake" type="button">Create the new SKUs</button><button id="skcAdd" type="button" class="ghost">+ Base code</button>' : ''}
      </div>
      <div id="skcSays" class="muted" style="margin-top:8px;font-size:12.5px"></div></div>`;
    const colEl = $('skcCol'), codeEl = $('skcCode');
    const onCol = () => {
      SKC.col = colEl.value.trim();
      /* An existing colour's code is found from its own SKUs, until somebody types one. */
      if (SKC.auto || !codeEl.value.trim()) { const c = skcCodeOf(SKC.col); if (c || SKC.auto) { codeEl.value = c; SKC.code = c; SKC.auto = true; } }
      skcDraw();
    };
    colEl.addEventListener('change', onCol);
    colEl.addEventListener('input', () => { if (skcColours().some(c => c === colEl.value)) onCol(); });
    codeEl.addEventListener('input', () => { SKC.code = codeEl.value.trim(); SKC.auto = !SKC.code; skcDraw(); });
    $('skcBrand').addEventListener('input', () => { SKC.brand = $('skcBrand').value.trim(); skcDraw(); });
    if ($('skcAdd')) $('skcAdd').onclick = () => skcEditOpen('');
    if ($('skcMake')) $('skcMake').onclick = () => {
      const plan = skcPlanNew(SKC.col, SKC.code, SKC.brand);
      if (plan.err || !plan.out.length) { $('skcSays').className = 'err'; $('skcSays').textContent = plan.err || 'Nothing to create — every SKU of this colour is already in the master.'; return; }
      ptOpenDialog({
        title: `Create ${nf(plan.out.length)} SKU(s) in ${SKC.col}?`,
        subtitle: 'Brand ' + SKC.brand + ' · code ' + SKC.code + (plan.newColour ? ` · "${SKC.col}" is new — it is added to the Colour master as well` : ''),
        note: 'Each takes the brand typed above, and copies cloth, consumption, pack, zip, ruffle and filling from the same article, subtype and size in another colour; the Recipe fills what is still blank. No picture is copied.',
        html: '<div class="xlwrap" style="max-height:50vh"><table class="xl"><thead><tr><th>SKU</th><th>Item</th><th>Copied from</th></tr></thead><tbody>'
          + plan.out.map(x => `<tr><td><b>${esc(x.rec.sku)}</b></td><td>${esc(x.label)}</td><td>${esc(x.from) || '<span class="muted">nothing — recipe only</span>'}</td></tr>`).join('')
          + plan.skip.map(x => `<tr><td style="color:var(--bad)">${esc(x.full)}</td><td>${esc(x.label)}</td><td style="color:var(--bad);white-space:normal">not made: ${esc(x.why)}</td></tr>`).join('')
          + '</tbody></table></div>',
        saveLabel: 'Create ' + nf(plan.out.length),
        onSave: async () => {
          const err = await skcCreate(SKC.col, SKC.code, SKC.brand);
          if (!err) { skcDraw(); $('skcSays').className = 'muted'; $('skcSays').textContent = `Created ${nf(plan.out.length)} SKU(s) in ${SKC.col}.`; }
          return err;
        },
      });
    };
  }
  skcDraw();
}

/** What a row's brand is: the master's own for a SKU it has, the typed one for a SKU still to be made. */
const skcBrandOf = x => (x && x.state === 'have' && x.m ? String(x.m.brand || '') : SKC.brand);

/** The table and the one line under the picker — the part that changes as the colour and code are typed. */
function skcDraw() {
  const q = String(($('ptmQ') || {}).value || '').trim().toLowerCase();
  const fa = ($('ptmArt') || {}).value || '', fs2 = ($('ptmSub') || {}).value || '', fz = ($('ptmSz') || {}).value || '';
  const rows = skcTable(SKC.col, SKC.code).filter(({ r, full }) => (!fa || r.article === fa) && (!fs2 || r.subtype === fs2) && (!fz || r.size === fz)
    && (!q || [r.article, r.subtype, r.size, r.base, full].join(' ').toLowerCase().includes(q)));
  SKC.shown = rows;
  const n = k => rows.filter(x => x.state === k).length;
  const owner = SKC.code ? skcCodeOwner(SKC.code, SKC.col) : '';
  const says = $('skcSays');
  if (says) {
    says.className = 'muted';
    says.textContent = !skcRows().length ? 'No base codes yet — add them with "+ Base code" or "Upload base codes".'
      : !SKC.code ? 'Pick a colour — an existing one brings its code — or type a new code.'
        : owner ? `Code ${SKC.code} is also used by ${owner} on ${nf(n('taken'))} SKU(s) — those stay as they are · ${nf(n('have'))} already in the master · ${nf(n('new'))} still free`
          + (n('new') ? ' — "Create the new SKUs" makes only the free ones' : '')
          : `${nf(n('have'))} already in the master · ${nf(n('new'))} new` + (n('new') ? (SKC.brand ? ' — "Create the new SKUs" adds them under ' + SKC.brand : ' — type the brand, then "Create the new SKUs"') : '');
  }
  /* the code, checked as it is typed */
  const cs = $('skcCodeSays'), ck = SKC.code ? skcCodeCheck(SKC.code, SKC.col, SKC.brand) : null;
  if (cs) {
    if (!ck) { cs.textContent = ''; }
    else if (ck.others.length) {
      cs.style.color = '#b45309';
      cs.textContent = `⚠ ${SKC.code} is partly used — only the free SKUs are made · ${ck.others.slice(0, 2).map(o => o.colour + ' (' + nf(o.n) + ' SKU' + (o.n === 1 ? '' : 's') + ', e.g. ' + o.eg + ')').join(', ')}${ck.others.length > 2 ? ' +' + (ck.others.length - 2) + ' more' : ''}`;
    } else if (ck.mine) {
      cs.style.color = '#b45309';
      cs.textContent = `${SKC.col || 'This colour'}'s own code — ${nf(ck.have)} SKU(s) already made, only the missing ones are created`;
    } else { cs.style.color = '#15803d'; cs.textContent = `✓ ${SKC.code} is free — no SKU uses it yet`; }
  }
  const edit = mdbCanEdit();
  const head = '<thead><tr>' + ['Brand', 'Color Code', 'Color', 'Article', 'Subtype', 'Size', 'Base Code', 'Full Code', 'In master'].concat(edit ? [''] : [])
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('ptmTable').innerHTML = head + '<tbody>' + rows.map(({ r, full, m, state }) => '<tr>'
    + `<td class="frz">${esc(skcBrandOf({ m, state })) || '<span class="muted">—</span>'}</td>`
    + `<td>${esc(SKC.code) || '<span class="muted">—</span>'}</td><td>${esc(SKC.col) || '<span class="muted">—</span>'}</td>`
    + `<td>${esc(r.article)}</td><td>${esc(r.subtype)}</td><td>${esc(r.size) || '<span class="muted">—</span>'}</td>`
    + `<td style="font-family:ui-monospace,monospace">${esc(r.base)}</td>`
    + `<td style="font-family:ui-monospace,monospace;font-weight:700">${esc(full) || '<span class="muted">—</span>'}</td>`
    + `<td>${state === 'have' ? '<span class="pill pill-ok">In master</span>' : state === 'new' ? '<span class="pill pill-low">New</span>'
      : state === 'taken' ? `<span class="pill pill-out" title="That code is already a SKU of another colour">${esc(m.color || '?')}</span>` : ''}</td>`
    + (edit ? (r.derived ? `<td class="muted" style="font-size:11px" title="Worked out from ${esc(String(r.n))} ${esc(r.brand)} SKU(s) in the master${r.alt && r.alt.length ? ' · not used: ' + esc(r.alt.join(', ')) + ' (fewer SKUs follow it)' : ''}">from SKUs${r.alt && r.alt.length ? ' · ' + esc(r.alt.length) + ' other' : ''}</td>` : `<td style="white-space:nowrap"><button class="ghost" data-skc-edit="${esc(r._key)}" style="padding:3px 10px">Edit</button> <button class="ghost" data-skc-del="${esc(r._key)}" style="padding:3px 10px;color:var(--bad)" title="Remove this base code — SKUs already made stay as they are">Delete</button></td>`) : '')
    + '</tr>').join('') + '</tbody>';
  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = `${nf(rows.length)} of ${nf(skcRows().length)} base code(s)`;
}

$('ptmTable').addEventListener('click', async e => {
  /* REMOVE A BASE CODE (Ravi, 17 Nov: "base code remove/edit karne ka option bhi de dena"): the row only — every SKU already made with it stays. */
  const d = e.target.closest('[data-skc-del]');
  if (d) {
    if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
    const id = d.getAttribute('data-skc-del'), r = ptList((PTG.masters || {}).skuCode).find(x => x._key === id);
    if (!r || !confirm(`Remove the base code ${r.base} (${[r.article, r.subtype, r.size].filter(Boolean).join(' · ')})?

SKUs already made with it are not touched.`)) return;
    try { await ptDelete('pt_masters/skuCode/' + id); } catch (er) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Not deleted: ' + (er.message || er); return; }
    const m = Object.assign({}, (PTG.masters || {}).skuCode || {}); delete m[id];
    PTG.masters = Object.assign({}, PTG.masters || {}, { skuCode: m });
    renderPmdb();
    $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = `Base code ${r.base} removed — a copy is in the recycle bin.`;
    return;
  }
  const b = e.target.closest('[data-skc-edit]'); if (!b) return;
  skcEditOpen(b.getAttribute('data-skc-edit'));
});
/* Leaving the view drops the picker, so coming back draws it fresh with the colour kept. */
$('ptmView').addEventListener('change', () => { if ($('ptmView').value !== 'skucode' && $('skcCol')) $('ptmKpis').innerHTML = ''; });

$('ptmSkcFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const grid = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = skcSheetEntries(grid);
    if (read.err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = read.err; return; }
    const plan = skcUploadPlan(read.entries);
    if (!plan.add.length && !plan.change.length) {
      $('ptmMsg').className = plan.skip.length ? 'err' : 'muted';
      $('ptmMsg').textContent = plan.skip.length ? 'Nothing written. ' + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
        : 'Every base code in that file is already here, saying the same.';
      return;
    }
    ptOpenDialog({
      title: 'Write these base codes?',
      subtitle: `${nf(plan.add.length)} new · ${nf(plan.change.length)} changed${plan.skip.length ? ' · ' + nf(plan.skip.length) + ' refused' : ''}`,
      html: '<div style="max-height:50vh;overflow:auto;font-size:12.5px">'
        + plan.add.slice(0, 200).map(r => `+ <b>${esc(r.base)}</b> — ${esc([r.article, r.subtype, r.size].filter(Boolean).join(' · '))}`).join('<br>')
        + (plan.change.length ? '<br>' + plan.change.map(r => `~ <b>${esc(r.base)}</b> — ${esc([r.article, r.subtype, r.size].filter(Boolean).join(' · '))}`).join('<br>') : '')
        + (plan.skip.length ? '<br><span style="color:var(--bad)">' + plan.skip.map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>') + '</span>' : '')
        + '</div>',
      saveLabel: 'Write them',
      onSave: async () => { const err = await skcUploadRun(plan); if (!err) renderPmdb(); return err; },
    });
  } catch (err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read the file: ' + (err.message || err); }
};

