/* ================= MASTER DATABASE: ADDING, EDITING, DELETING =================
 *
 * This is the table every other screen is measured against — what an article is, whether it needs
 * cutting, how much fabric it eats, whether it carries a zip. A wrong row here is wrong everywhere.
 *
 * DELETING IS GUARDED, and that guard is the reason this screen is worth doing carefully. A SKU that
 * appears in Base Data, Cutting, Press, QC or the Order Book cannot be deleted: those rows would be
 * left describing a product that no longer exists, and every count built on them would quietly stop
 * adding up. The refusal says exactly where the references are.
 *
 * CUSTOM SKUs LIVE SOMEWHERE ELSE. `pt_customSkus` is a separate node on purpose — one-off items
 * never amend the real catalogue — so this tab shows them in their own view rather than mixing them
 * into a master list that is supposed to be the durable one.
 */
let MDBX = { custom: null, busy: false, err: '' };

/** Everywhere a SKU is referenced in live data, and how many times. */
function mdbUsage(sku) {
  const k = obUC(sku);
  const b = (PT.base || []).filter(r => obUC(r.sku) === k).length;
  const c = (PT.cut || []).filter(r => obUC(r.sku) === k).length;
  const p = (PTG.press || []).filter(r => obUC(r.sku) === k).length;
  const o = (PTG.ob || []).filter(r => obUC(r.sku) === k).length;
  const q = ((QC.checks || []).filter(r => obUC(r.sku) === k).length)
          + ((QC.issue || []).filter(r => obUC(r.sku) === k).length);
  return { total: b + c + p + o + q,
    breakdown: { 'Job Work Register': b, 'Cutting': c, 'Press': p, 'Order Book': o, 'Quality Control': q } };
}

const mdbNum = v => { const s = String(v == null ? '' : v).trim(); if (s === '') return null; const n = parseFloat(s); return isFinite(n) ? n : null; };
/**
 * METRES, TO TWO PLACES. Ravi, 2026-09-24: consumption showed as 1.2953999999999999 — inches turned
 * into metres and stored as the raw float. The fields that are metres of cloth are rounded on the way
 * in and shown to two places; nothing else is touched.
 */
const MDB_M2 = ['consumption', 'ruffleMeters', 'pipingMeters'];
const mdbM2 = v => { const n = mdbNum(v); return n == null ? null : Math.round(n * 100) / 100; };
/** For a table cell: "1.30", or a dash. */
const mdbM2Txt = v => { const n = mdbM2(v); return n == null ? '' : n.toFixed(2); };

/** The stored shape, built from form values — the same fields and the same nulls as the old tool. */
/**
 * A SKU as typed. The recipe is NOT applied here — mdbRecord serves both add and edit, and on an
 * edit a blank is somebody clearing a value on purpose. New rows go through recipeFill instead.
 */
function mdbRecord(v, isCustom) {
  return {
    sku: obUC(v.sku), articleType: String(v.articleType || '').trim(), subtype: String(v.subtype || '').trim(),
    color: String(v.color || '').trim(), size: String(v.size || '').trim(),
    brand: String(v.brand || '').trim(), packOf: String(v.packOf || '').trim(),
    fabric: String(v.fabric || '').trim(),
    cuttingRequired: v.cuttingRequired !== 'no',
    consumption: mdbM2(v.consumption),
    isZip: v.isZip === 'yes', chainLength: v.isZip === 'yes' ? mdbNum(v.chainLength) : null,
    // How many zips one piece takes. Absent means one — see the note above mdbZipQty.
    zipQty: v.isZip === 'yes' ? (mdbNum(v.zipQty) || 1) : null,
    isRuffle: v.isRuffle === 'yes', ruffleMeters: v.isRuffle === 'yes' ? mdbM2(v.ruffleMeters) : null,
    ruffleFabric: v.isRuffle === 'yes' ? String(v.ruffleFabric || '').trim() : '',
    /* PIPING DORI (Ravi, 2026-09-22: "jisme ruffle nahi h usme piping dori lagti h") — the cord sewn into
     * a piped edge, in metres per piece. */
    isPiping: v.isPiping === 'yes', pipingMeters: v.isPiping === 'yes' ? mdbM2(v.pipingMeters) : null,
    fillerFabricRequired: v.fillerFabricRequired === 'yes',
    standardFillingQty: v.fillerFabricRequired === 'yes' ? mdbNum(v.standardFillingQty) : null,
    inventoryValuationPrice: mdbNum(v.inventoryValuationPrice),
    imageUrl: String(v.imageUrl || '').trim(),
    /* AMAZON'S IDS (Ravi, 2026-09-26). An edit and an import both write the WHOLE record, so a field left out of
     * here is a field every edit wipes. */
    asin: obUC(v.asin), parentAsin: obUC(v.parentAsin),
    isCustom: !!isCustom,
  };
}

/** The checks the old tool makes, in the order it makes them. */
function mdbValidate(v, existingSku) {
  if (!obUC(v.sku)) return 'SKU is required.';
  if (!String(v.articleType || '').trim()) return 'Article type is required.';
  if (!String(v.subtype || '').trim()) return 'Article subtype is required.';
  if (!String(v.color || '').trim()) return 'Colour is required.';
  if (!String(v.size || '').trim()) return 'Size is required.';
  if (String(v.asin || '').trim() && !MDB_ASIN_RE.test(obUC(v.asin))) return `ASIN "${String(v.asin).trim()}" is not an ASIN — ten letters and digits, like B0CHW5KTPB.`;
  if (String(v.parentAsin || '').trim() && !MDB_ASIN_RE.test(obUC(v.parentAsin))) return `Parent ASIN "${String(v.parentAsin).trim()}" is not an ASIN — ten letters and digits.`;
  if (obUC(v.sku) !== obUC(existingSku || '') && (PTG.mdb || []).some(r => obUC(r.sku) === obUC(v.sku)))
    return `SKU "${obUC(v.sku)}" is already in the master database.`;
  if (v.isZip === 'yes' && !(mdbNum(v.chainLength) > 0)) return 'Zip size (chain length) is required when zip is Yes.';
  // Blank is allowed and means one; a number that is there must be a real one.
  if (v.isZip === 'yes' && String(v.zipQty || '').trim() !== '' && !(mdbNum(v.zipQty) > 0))
    return 'Zip quantity must be a number greater than zero.';
  if (v.isRuffle === 'yes' && !(mdbNum(v.ruffleMeters) > 0) && !(mdbNum((recipeOf(v) || {}).ruffleMeters) > 0))
    return 'Ruffle metres are required when ruffle is Yes (or fill them in the recipe for this product and size).';
  if (v.isPiping === 'yes' && !(mdbNum(v.pipingMeters) > 0)) return 'Piping dori metres are required when piping dori is Yes.';
  if (v.fillerFabricRequired === 'yes' && !(mdbNum(v.standardFillingQty) > 0))
    return 'Standard filling quantity is required when filler fabric is Yes.';
  const p = mdbNum(v.inventoryValuationPrice);
  if (v.inventoryValuationPrice !== '' && v.inventoryValuationPrice != null && (p == null || p < 0))
    return 'Inventory valuation price must be a number that is not negative.';
  return '';
}

const YESNO = ['yes', 'no'];
/** The Fabric Type master, with whatever this row already says kept at the top of it. */
const fabListOr = cur => [...new Set([String(cur || '').trim()].filter(Boolean).concat(cutFabrics()))];
/** The dialog's fields, shared by add and edit so the two cannot drift. */
function mdbFields(r) {
  const m = (k, d) => (r ? (r[k] == null ? d : r[k]) : d);
  const yn = b => (b ? 'yes' : 'no');
  const mastersOf = k => ptList((PTG.masters || {})[k]).map(x => x.desc || x.code).filter(Boolean).sort();
  const listOr = (k, cur) => { const l = mastersOf(k); return [...new Set([cur].filter(Boolean).concat(l))]; };
  return [
    { key: 'sku', label: 'SKU', value: m('sku', '') },
    { key: 'brand', label: 'Brand', value: m('brand', '') },
    { key: 'asin', label: 'ASIN', value: m('asin', '') },
    { key: 'parentAsin', label: 'Parent ASIN', value: m('parentAsin', '') },
    { key: 'articleType', label: 'Article type', type: 'select', value: m('articleType', ''),
      options: [''].concat(listOr('articleType', m('articleType', ''))) },
    { key: 'subtype', label: 'Article subtype', type: 'select', value: m('subtype', ''),
      options: [''].concat(listOr('articleSubtype', m('subtype', ''))) },
    { key: 'color', label: 'Colour', type: 'select', value: m('color', ''),
      options: [''].concat(listOr('colour', m('color', ''))) },
    { key: 'size', label: 'Size', type: 'select', value: m('size', ''),
      options: [''].concat(listOr('size', m('size', ''))) },
    /* FROM THE FABRIC TYPE MASTER — the same list, by the same rule, that Cutting picks from. A
     * spelling typed here used to become a fabric nobody had agreed to, with no width and no ledger.
     * The row's own spelling is kept at the top of the list so an edit can never change its cloth. */
    { key: 'fabric', label: 'Fabric', type: 'select', value: m('fabric', ''),
      options: [''].concat(fabListOr(m('fabric', ''))) },
    { key: 'packOf', label: 'Pack of', value: m('packOf', '') },
    { key: 'consumption', label: 'Consumption (m)', type: 'number', step: '0.01', value: mdbM2Txt(m('consumption', '')) },
    { key: 'cuttingRequired', label: 'Cutting required', type: 'select', value: yn(m('cuttingRequired', true)), options: YESNO },
    { key: 'isZip', label: 'Zip', type: 'select', value: yn(m('isZip', false)), options: YESNO },
    { key: 'chainLength', label: 'Zip size / chain length (in)', type: 'number', step: '0.1', value: m('chainLength', '') },
    { key: 'zipQty', label: 'Zips per piece', type: 'number', step: '1', min: 1, value: m('zipQty', '') },
    { key: 'isRuffle', label: 'Ruffle', type: 'select', value: yn(m('isRuffle', false)), options: YESNO },
    { key: 'ruffleMeters', label: 'Ruffle fabric consumption (m)', type: 'number', step: '0.01', value: m('ruffleMeters', '') },
    /* The ruffle cloth is written onto the fabric ledger as it stands, so it is picked too. */
    { key: 'ruffleFabric', label: 'Ruffle fabric', type: 'select', value: m('ruffleFabric', ''),
      options: [''].concat(fabListOr(m('ruffleFabric', ''))) },
    { key: 'isPiping', label: 'Piping dori', type: 'select', value: yn(m('isPiping', false)), options: YESNO },
    { key: 'pipingMeters', label: 'Piping dori per piece (m)', type: 'number', step: '0.01', value: m('pipingMeters', '') },
    { key: 'fillerFabricRequired', label: 'Filler fabric', type: 'select', value: yn(m('fillerFabricRequired', false)), options: YESNO },
    { key: 'standardFillingQty', label: 'Standard filling qty', type: 'number', step: '0.01', value: m('standardFillingQty', '') },
    { key: 'inventoryValuationPrice', label: 'Valuation price', type: 'number', step: '0.01', value: m('inventoryValuationPrice', '') },
    { key: 'imageUrl', label: 'Image link', value: m('imageUrl', ''), span: true },
  ];
}

/** What the recipe for the article, subtype and size in the form would fill in, said before saving. */
function mdbRecipeSays() {
  const v = k => { const el = $('ptf_' + k); return el ? String(el.value || '').trim() : ''; };
  const m = { articleType: v('articleType'), subtype: v('subtype'), size: v('size') };
  if (!m.articleType || !m.subtype || !m.size) return 'Pick the article, subtype and size — the recipe for them fills the rest in.';
  const r = recipeOf(m);
  const what = [m.articleType, m.subtype, m.size].join(' · ');
  if (!r) return 'No recipe for ' + what + ' yet. Type the fields below, and Master database → Recipes can remember them for next time.';
  /* Only the blanks are filled: what is typed here always wins. */
  const fills = RECIPE_FIELDS.filter(([f]) => recSaid(r[f]) && !v(f === 'cuttingRequired' || f === 'isZip' || f === 'isRuffle' || f === 'isPiping' || f === 'fillerFabricRequired' ? '' : f))
    .map(([f, label]) => label + ' ' + String(r[f]).trim());
  return fills.length ? 'Recipe for ' + what + ' fills in: ' + fills.join(' · ') + '. Anything you type here is kept.'
    : 'The recipe for ' + what + ' says nothing to fill in.';
}

function mdbAddNew() {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  ptOpenDialog({
    title: 'New SKU',
    /* THE RECIPE, SAID BEFORE IT HAPPENS (Ravi, 2026-09-22: "new sku add krna h to ye auto kaise recipe se
     * feed hoga"). The same three boxes that key a recipe are watched, and the line says what will be
     * filled in — so nobody saves first to find out. */
    note: 'Chain length, ruffle metres, piping dori metres and filling quantity are each required only when their '
      + 'Yes is picked — a Yes with no number is what makes a SKU look complete and behave as if it were not.',
    fields: mdbFields(null),
    onSave: async v => {
      const err = mdbValidate(v, '');
      if (err) return err;
      /* THE RECIPE FILLS WHAT THE FORM LEFT UNSAID. This is the whole of "repeat article sub article
       * aate h to again sabka data feed krna padta h" — the fifteenth colour of a 60x60 tablecloth
       * should not need its cloth, its pack, its zip and its ruffle typed again. What WAS typed is
       * kept; only the blanks are filled, and the screen says which. */
      const filled = recipeFill(mdbRecord(v, false));
      const rec = filled.rec;
      const key = 'mdb_' + Date.now();
      await ptPut('pt_masterDB/' + key, rec);
      PTG.mdb = (PTG.mdb || []).concat(Object.assign({ _key: key }, rec));
      PT.mdb = PTG.mdb;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `Added ${rec.sku} to the master database.`
        + (filled.from.length
          ? ` ${nf(filled.from.length)} field(s) came from the recipe for ${[rec.articleType, rec.subtype, rec.size].filter(Boolean).join(' · ')}: `
            + filled.from.map(f => (RECIPE_FIELDS.find(x => x[0] === f) || [f, f])[1]).join(', ') + '.'
          : '');
      return '';
    },
  });
  /* The boxes exist only once the dialog is drawn, so the watching starts here. */
  const show = () => ptDlgMsg(mdbRecipeSays());
  ['articleType', 'subtype', 'size'].forEach(k => {
    const el = $('ptf_' + k);
    if (el) { el.addEventListener('change', show); el.addEventListener('input', show); }
  });
  show();
}

function mdbEdit(sku) {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const r = mdbOf(sku);
  if (!r) return;
  const use = mdbUsage(r.sku);
  ptOpenDialog({
    title: 'Edit SKU',
    subtitle: `${r.sku}${r.brand ? '  ·  ' + r.brand : ''}`,
    note: use.total
      ? `In use in ${use.total} live row(s) — ${Object.entries(use.breakdown).filter(([, n]) => n > 0).map(([k, n]) => k + ' ' + n).join(', ')}. `
        + 'Changing the description here changes what those rows are taken to be.'
      : 'Not referenced in any live row yet.',
    fields: mdbFields(r),
    deleteWhat: `the SKU ${r.sku} — ${[r.articleType, r.subtype, r.color, r.size].filter(Boolean).join(' · ')}`,
    onSave: async v => {
      const err = mdbValidate(v, r.sku);
      if (err) return err;
      const rec = mdbRecord(v, r.isCustom === true);
      await ptPut('pt_masterDB/' + r._key, rec);
      PTG.mdb = (PTG.mdb || []).map(x => (x._key === r._key ? Object.assign({ _key: r._key }, rec) : x));
      PT.mdb = PTG.mdb;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `Updated ${rec.sku}.`;
      return '';
    },
    onDelete: async () => {
      /* Deleting a SKU that live rows point at would leave them describing nothing. Named, not vague. */
      const u = mdbUsage(r.sku);
      if (u.total > 0)
        return `${r.sku} cannot be deleted — it is used in `
          + Object.entries(u.breakdown).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(', ')
          + `. Remove or reassign those ${u.total} row(s) first.`;
      // Duplicates of the same SKU can exist under different keys; take them all, as the old tool does.
      const keys = (PTG.mdb || []).filter(x => obUC(x.sku) === obUC(r.sku)).map(x => x._key);
      for (const k of keys) await ptDelete('pt_masterDB/' + k);
      PTG.mdb = (PTG.mdb || []).filter(x => obUC(x.sku) !== obUC(r.sku));
      PT.mdb = PTG.mdb;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `Deleted ${r.sku}${keys.length > 1 ? ` (${keys.length} records)` : ''}.`;
      return '';
    },
  });
}

/* SIX COLUMNS, and the recipe does the rest — the file for adding a colour's SKUs in bulk. */
const MDB_SHORT_COLS = ['SKU', 'Brand', 'Article', 'Subtype', 'Color', 'Size'];
$('ptmTplShort').onclick = () => {
  const ex = [['RPC377-1818', 'Ridhi', 'Pillow Cover', 'Piping Flap Pillow Cover', 'Sage Green', '18x18'],
    ['RTC377-6060', 'Ridhi', 'Tablecloth', 'Square Tablecloth', 'Sage Green', '60x60']];
  const bytes = recipeXlsx([MDB_SHORT_COLS].concat(ex), { name: 'New SKUs', freeze: 1, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `new-sku-short-template-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = 'Short template written — six columns. Everything else comes from the recipe for that article, '
    + 'subtype and size when you Import it. Updating SKUs already here? Keep only the columns you want changed.';
};

$('ptmNew').onclick = async () => {
  if (!PTG.mdb) { $('ptmMsg').textContent = 'Reading the master database…'; await ptLoadGates(); }
  if (($('ptmView') || {}).value === 'fabric') return fsManualEdit('');
  mdbAddNew();
};
$('ptmTable').addEventListener('click', e => {
  const fe = e.target.closest('[data-fs-edit]');
  if (fe) return fsManualEdit(fe.getAttribute('data-fs-edit'));
  const b = e.target.closest('[data-mdb-edit]'); if (!b) return;
  mdbEdit(b.getAttribute('data-mdb-edit'));
});

/* The printer's catalogue is worked out from what is already loaded, so its two filters only have to
 * redraw. */
['ptmBrandFs', 'ptmDir'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('change', renderPmdb);
});

/* ---- the custom SKU list, which is a different node on purpose ---- */
$('ptmConsApply').onclick = () => mdbConsApply();
$('ptmView').addEventListener('change', async () => {
  if ($('ptmView').value === 'custom' && MDBX.custom === null) {
    MDBX.busy = true; renderPmdb();
    try { MDBX.custom = ptList(await ptGet('pt_customSkus')); MDBX.err = ''; }
    catch (e) { MDBX.err = e.message || String(e); MDBX.custom = []; }
    MDBX.busy = false;
  }
  renderPmdb();
});

/* ---- Master Database: zip detail, ruffle detail, and pictures ----
 *
 * ZIP was one number, `chainLength`, and that number is doing two jobs: it is the zip's SIZE and it
 * is the accessory CODE the zipper stock is kept under. It stays exactly as it is for that reason.
 * What was missing is HOW MANY zips a piece takes — a cushion with two zips ate one from stock.
 * `zipQty` is that, and the stock check now asks for `pieces × zipQty`.
 *
 * `zipQty` DEFAULTS TO 1 WHERE IT IS ABSENT, on purpose. 157 SKUs already carry a zip with no
 * quantity recorded; demanding one before they could be saved would have made every one of them
 * uneditable until somebody typed a number they already knew.
 *
 * RUFFLE had metres but not WHICH fabric, so a ruffle in a different cloth was invisible.
 * `ruffleFabric` is free text and optional — it describes, it does not gate anything, and making it
 * compulsory would block the existing rows the same way.
 *
 * PICTURES come from Amazon, through the Price Research backend: SKU → ASIN (the Catalog tab) →
 * catalogue image. They are fetched only for what is on screen and only when asked for, because that
 * is 4,479 lookups otherwise. A production SKU that Amazon has never heard of has no picture, and
 * the backend says why rather than leaving an empty box to be read as "this product has no photo".
 */
let MDBIMG = { map: {}, busy: false, msg: '' };
/* How many unknown SKUs one render may ask about. Forty per call to a script that takes seconds. */
const IMG_MAX_PASS = 120;
/* SKU → picture, shared through the production database rather than through Firestore.
 *
 * The Firestore cache needs perms.repl, and a printer does not have it — so the Vendor Portal could
 * never show a picture, whatever it did. This node is in a database every account already reads, and
 * it holds nothing private: an Amazon CDN address. */
let PTIMG = { map: {}, loaded: false, dirty: {} };
async function ptImgShared() {
  if (PTIMG.loaded) return;
  PTIMG.loaded = true;                       // one attempt: a failure must not retry on every render
  try { PTIMG.map = (await ptGet('pt_skuImages')) || {}; }
  catch (e) { PTIMG.map = {}; }
  /* Seed the in-memory map with EVERY answer already on record, including the empty ones. An empty
   * answer means "asked, Amazon has none", and it is what stops the same question being asked on
   * every load for the 93% of factory codes Amazon has never heard of. */
  Object.keys(PTIMG.map).forEach(k => {
    if (MDBIMG.map[k] === undefined) MDBIMG.map[k] = PTIMG.map[k] === IMG_NONE ? '' : PTIMG.map[k];
  });
}
/* What is stored for "asked, and Amazon has nothing". A real empty string would be indistinguishable
 * from a key that was never written. */
const IMG_NONE = '-';
/** Put back anything newly learned, so the next reader — printer or not — does not have to ask. */
async function ptImgSharePut() {
  const keys = Object.keys(PTIMG.dirty);
  if (!keys.length) return;
  const patch = {};
  keys.forEach(k => { patch['pt_skuImages/' + k] = PTIMG.dirty[k]; });
  PTIMG.dirty = {};
  try { await ptPatch(patch); } catch (e) { /* the pictures still show this session */ }
}

/* How many zips one piece takes. Absent means one: 157 SKUs already carry a zip with no
 * quantity recorded, and treating those as zero would have made the stock check ask for none. */
const mdbZipQty = r => { const n = parseFloat(r && r.zipQty); return isFinite(n) && n > 0 ? n : 1; };


/* ---- Pictures: fetched once, remembered, and shown without being asked ----
 *
 * The column was empty until somebody pressed a button, which reads as a broken feature rather than
 * as a cost decision. It now fills itself when the tab opens.
 *
 * What makes that affordable is the cache: every answer — including "Amazon has never heard of this
 * code" — is written to Firestore, so a SKU is looked up ONCE, ever, not once per session. The
 * negative answers matter as much as the positive ones; without them the 1,600-odd production-only
 * codes would be re-asked on every visit forever.
 */
const IMG_CHUNK = 1200;
let IMG_CACHE_LOADED = false, IMG_DIRTY = false;

async function mdbImgCacheLoad() {
  if (IMG_CACHE_LOADED) return;
  IMG_CACHE_LOADED = true;                 // one attempt: a denial must not retry on every render
  try {
    const meta = await getDoc(doc(db, 'repl', 'skuimg'));
    if (!meta.exists()) return;
    const n = meta.data().chunks || 0;
    const got = await Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, 'repl_skuimg', String(i)))));
    got.forEach(s => { if (s.exists()) Object.assign(MDBIMG.map, s.data().m || {}); });
  } catch (e) {
    // No access to the cache is not a reason to show nothing — it just means asking Amazon again.
    console.warn('[img] cache not read:', e.message || e);
  }
}

async function mdbImgCacheSave() {
  if (!IMG_DIRTY) return;
  IMG_DIRTY = false;
  try {
    const keys = Object.keys(MDBIMG.map).sort();
    const chunks = Math.max(1, Math.ceil(keys.length / IMG_CHUNK));
    for (let i = 0; i < chunks; i++) {
      const m = {};
      keys.slice(i * IMG_CHUNK, (i + 1) * IMG_CHUNK).forEach(k => { m[k] = MDBIMG.map[k]; });
      await setDoc(doc(db, 'repl_skuimg', String(i)), { m });
    }
    await setDoc(doc(db, 'repl', 'skuimg'), { chunks, n: keys.length, at: serverTimestamp(), by: ME.email });
  } catch (e) {
    console.warn('[img] cache not saved:', e.message || e);
  }
}

/** The master tab's own list, handed to the shared filler. */
function mdbImgFill(force) {
  return ptImgFill((PT._pmdbRows || []).slice(0, PMDB_MAX).map(r => r.sku), force, ptIfTab('pmdb', renderPmdb));
}
$('ptmImgs').onclick = () => mdbImgFill(true);

/* ---- Master Database: bulk import, a picture by link, and renaming a SKU ----
 *
 * IMPORT IS A PREVIEW FIRST. A bulk write to the table every other screen is measured against is not
 * something to discover the result of afterwards, so the file is read, checked row by row, and what
 * it WOULD do is shown — how many are new, how many change, which rows are refused and why — before
 * anything is written.
 *
 * A PICTURE CAN JUST BE A LINK. Amazon only knows the SKUs it sells; the factory's own codes have no
 * catalogue entry and never will. `imageUrl` on the row wins over the Amazon lookup, so a picture can
 * be pasted in for anything.
 *
 * RENAMING A SKU IS THE DANGEROUS ONE, and it is why this is not simply an edit of the SKU field.
 * The code appears in Base Data, Cutting, Press, QC and the Order Book. Changing it in the master
 * row alone would leave every one of those rows pointing at a product that no longer exists — the
 * caps would stop matching, the totals would split in two, and nothing would say so. So the rename
 * rewrites every reference in ONE multi-path update: they all change together, or none do.
 */

const MDB_IMPORT_COLS = ['SKU', 'Brand', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Consumption',
  'Pack of', 'Cutting required', 'Zip', 'Zips per piece', 'Zip size', 'Ruffle', 'Ruffle metres',
  'Ruffle fabric', 'Piping dori', 'Piping dori metres', 'Filler fabric', 'Filling qty', 'Valuation price', 'Image', 'ASIN', 'Parent ASIN'];

/** The recipe template: every combination, its recipe so far, and what its SKUs say. */
function recipeTemplateDownload() {
  const rows = recipeSheetRows();
  if (rows.length < 2) {
    $('ptmMsg').className = 'muted';
    $('ptmMsg').textContent = 'The master database is empty, so there are no combinations to make recipes for.';
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([recipeXlsx(rows)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `recipes-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = `Recipe sheet written for ${nf(rows.length - 1)} combination(s). Fill the fields you `
    + 'know and leave the rest blank — a blank says nothing about that field, it does not clear it. '
    + 'The "SKUs say" columns are there to read, not to fill.';
}

$('ptmRecFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = recipeSheetEntries(rows);
    if (read.err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = read.err; return; }
    const plan = recipeUploadPlan(read.entries);
    if (!plan.set.length && !plan.change.length) {
      $('ptmMsg').className = plan.skip.length ? 'err' : 'muted';
      $('ptmMsg').textContent = (plan.skip.length
        ? `Nothing written. ${nf(plan.skip.length)} row(s) refused: `
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ` and ${nf(plan.skip.length - 3)} more.` : '')
        : 'Every recipe in that file already says exactly what it says here.');
      return;
    }
    const show = list => list.slice(0, 10).map(x => esc(x.key.replace(/\|/g, ' · ')) + ' — ' + esc(x.label)
      + ': ' + (x.from === '' ? '<i>not set</i>' : esc(x.from)) + ' → <b>' + esc(x.to) + '</b>').join('<br>');
    ptOpenDialog({
      title: 'Write these recipes?',
      subtitle: `${nf(plan.set.length)} field(s) set · ${nf(plan.change.length)} changed`,
      /* SETTING AND CHANGING ARE DIFFERENT THINGS. Filling an empty recipe is what the sheet is for;
       * overwriting one somebody already decided deserves to be read before it happens. */
      note: 'A blank cell says nothing about that field and leaves it alone. This does not touch the '
        + 'SKUs — press Apply recipes for that.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (plan.set.length ? `<b>Set for the first time</b><br>${show(plan.set)}`
          + (plan.set.length > 10 ? `<br>…and ${nf(plan.set.length - 10)} more.` : '') + '<br><br>' : '')
        + (plan.change.length ? `<b style="color:var(--bad)">Changed</b><br>${show(plan.change)}`
          + (plan.change.length > 10 ? `<br>…and ${nf(plan.change.length - 10)} more.` : '') + '<br><br>' : '')
        + (plan.skip.length ? `<b style="color:var(--bad)">${nf(plan.skip.length)} row(s) refused</b><br>`
          + plan.skip.slice(0, 8).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 8 ? `<br>…and ${nf(plan.skip.length - 8)} more.` : '') : '')
        + '</div>',
      saveLabel: `Write ${nf(plan.set.length + plan.change.length)} field(s)`,
      onSave: async () => {
        const err = await recipeUploadRun(plan);
        if (err) return err;
        renderPmdb();
        $('ptmMsg').className = 'muted';
        $('ptmMsg').textContent = `${nf(plan.set.length)} field(s) set and ${nf(plan.change.length)} changed `
          + `across ${nf(new Set(plan.set.concat(plan.change).map(x => x.key)).size)} combination(s).`
          + (recipeFilledTxt(RECIPE_FILLED) || ' No SKU of these had a blank to fill.')
          + ' A figure a SKU already had is left as it was — Apply recipes changes those, after you see them.';
        return '';
      },
    });
  } catch (err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read the sheet: ' + (err.message || err); }
};

$('ptmTemplate').onclick = () => {
  /* Each view's own template. On Recipes the SKU template is the wrong file entirely. */
  if (($('ptmView') || {}).value === 'recipe') return recipeTemplateDownload();
  if (($('ptmView') || {}).value === 'fabric') return fsManualTemplate();
  if (($('ptmView') || {}).value === 'skucode') return ptDownload('sku-base-codes-template', [SKC_COLS, ['Tablecloth', 'Square Tablecloth', '60x60', 'RTC-6060'],
    ['Home and Kitchen', 'Apron', 'Free', 'RKA-']].map(r => r.map(csvCell).join(',')));
  const ex = ['RPC123-1818', 'Ridhi', 'Pillow Cover', 'Piping Pillow Cover', 'Indigo Blue', '18X18',
    'Sheeting 82', 0.28, '2', 'Yes', 'Yes', 1, 18, 'No', '', '', 'Yes', 2.1, 'No', '', '', '', '', ''];
  /* AN EXCEL SHEET, with Yes/No and the cloth as dropdowns, so a spelling nobody agreed to cannot be
   * typed into it. Import reads .xlsx and .csv alike. */
  const ix = h => MDB_IMPORT_COLS.indexOf(h);
  const bytes = recipeXlsx([MDB_IMPORT_COLS, ex], { name: 'SKUs', freeze: 1,
    cols: { yn: ['Cutting required', 'Zip', 'Ruffle', 'Piping dori', 'Filler fabric'].map(ix), fab: ['Fabric', 'Ruffle fabric'].map(ix) } });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `master-database-template-${dToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = 'Template written. Fill a row per SKU and upload it with Import — the columns are the ones Import reads, '
    + 'and a SKU already in the master is updated rather than added.';
};

