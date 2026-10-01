/* ============ ASIN FROM AMAZON ============
 * Where each id comes from, in order of trust:
 *   ASIN   — Amazon's full listings report (pt_amzListings: both brands, every status, one ASIN per SKU, rebuilt daily);
 *            else the Replenishment snapshot (older — on 26 Sep 57 SKUs there still carried a replaced ASIN).
 *   Parent — the snapshot's parent, but ONLY when the snapshot's ASIN is the same one; otherwise Amazon's catalogue is
 *            asked (Pricing-API ?parents=, 20 ASINs a call). Amazon answering "no parent" means a stand-alone listing.
 * Blanks are filled. An id that is already there and differs from Amazon is only changed when the box is ticked. */
const MDB_ASIN_RE = /^[A-Z0-9]{10}$/;
let MDB_ASIN = null;     // the plan on screen, waiting for Write

/** SKU → { asin, parent } from the saved Replenishment snapshot (the full one carries both). */
async function mdbAsinRepl() {
  const m = new Map(); let err = '';
  const take = rows => (rows || []).forEach(r => {
    const k = obUC(r && r.sku); if (!k) return;
    const e = m.get(k) || {};
    const a = obUC(r.asin), p = obUC(r.parent);
    if (MDB_ASIN_RE.test(a) && !e.asin) e.asin = a;
    if (MDB_ASIN_RE.test(p) && !e.parent) e.parent = p;
    m.set(k, e);
  });
  if (['SP', 'CPC'].some(b => REPL[b] && (REPL[b].rows || []).some(r => r && r.asin))) {
    ['SP', 'CPC'].forEach(b => take((REPL[b] || {}).rows));
    return { m, err };
  }
  await Promise.all(['SP', 'CPC'].map(async b => {
    try {
      const meta = await getDoc(doc(db, 'repl', b));
      if (!meta.exists()) return;
      const d = meta.data();
      if (d.chunks) {
        const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'replrows', `${b}_${i}`))));
        got.forEach(x => { if (x.exists()) take(x.data().r); });
      } else take(d.rows);
    } catch (e) { err = e.message || String(e); }
  }));
  return { m, err };
}

/** Parent ASIN per ASIN from Amazon's catalogue. { parents: Map, single: Set, notFound: Set, err }. */
async function mdbAsinAskParents(asins, progress) {
  const out = { parents: new Map(), single: new Set(), notFound: new Set(), err: '' };
  if (!asins.length) return out;
  if (!PRAPI || !PRAPI.url) { out.err = 'this account cannot reach the Amazon backend'; return out; }
  const chunks = [];
  for (let i = 0; i < asins.length; i += 20) chunks.push(asins.slice(i, i + 20));
  let next = 0, done = 0;
  const worker = async () => {
    while (next < chunks.length && !out.err) {
      const c = chunks[next++];
      try {
        const d = await prGet({ parents: c.join(',') });
        if (!d.parents) throw new Error('the backend does not know this request yet (it needs the latest Pricing-API)');
        Object.entries(d.parents).forEach(([a, p]) => { if (MDB_ASIN_RE.test(obUC(p))) out.parents.set(obUC(a), obUC(p)); });
        (d.single || []).forEach(a => out.single.add(obUC(a)));
        (d.notFound || []).forEach(a => out.notFound.add(obUC(a)));
      } catch (e) { out.err = e.message || String(e); }
      done++;
      if (progress) progress(done, chunks.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

async function mdbAsinCheck() {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const btn = $('ptmAsin'); btn.disabled = true;
  const say = t => { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = t; };
  try {
    say('Reading Amazon\'s listings report and the Replenishment snapshot…');
    const [, R] = await Promise.all([lstLoad(), mdbAsinRepl()]);
    const L = LST.map || new Map();
    if (!L.size && !R.m.size) throw new Error('neither Amazon\'s listings report nor the Replenishment snapshot could be read'
      + (LST.err ? ' (' + LST.err + ')' : '') + (R.err ? ' (' + R.err + ')' : ''));

    /* The snapshot's parent belongs to the snapshot's ASIN — never carried over to a different one. */
    const replParent = new Map();
    R.m.forEach(e => { if (e.asin && e.parent && !replParent.has(e.asin)) replParent.set(e.asin, e.parent); });

    const rows = (PTG.mdb || []).filter(r => r && obUC(r.sku));
    const plan = [];
    rows.forEach(r => {
      const k = obUC(r.sku);
      const la = obUC((L.get(k) || {}).asin), ra = obUC((R.m.get(k) || {}).asin);
      const amz = MDB_ASIN_RE.test(la) ? la : MDB_ASIN_RE.test(ra) ? ra : '';
      plan.push({ r, cur: obUC(r.asin), curP: obUC(r.parentAsin), amz, src: amz ? (amz === la ? 'lst' : 'repl') : '' });
    });

    /* Which ASINs still need a parent from Amazon: every one this could end up writing, whose snapshot has none. */
    const need = new Set();
    plan.forEach(x => {
      [x.amz, x.cur].forEach(a => { if (MDB_ASIN_RE.test(a) && !replParent.has(a)) need.add(a); });
    });
    say(`Asking Amazon's catalogue for the parent of ${nf(need.size)} ASIN(s)…`);
    const A = await mdbAsinAskParents([...need], (d, n) => say(`Asking Amazon's catalogue for parents… ${nf(d)} of ${nf(n)} batches`));
    const parentOf = a => replParent.get(a) || A.parents.get(a) || '';

    MDB_ASIN = { plan, parentOf, replParent, A, at: LST.at };
    mdbAsinShow();
    say('');
  } catch (e) {
    $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'ASIN from Amazon stopped: ' + (e.message || e);
  }
  btn.disabled = false;
}

/** What Write would do, with the box ticked or not. */
function mdbAsinWrites(fix) {
  const P = MDB_ASIN, w = [];
  P.plan.forEach(x => {
    let asin = x.cur, why = '';
    if (x.amz && !x.cur) { asin = x.amz; why = 'fill'; }
    else if (x.amz && x.cur !== x.amz && fix) { asin = x.amz; why = 'fix'; }
    const par = MDB_ASIN_RE.test(asin) ? P.parentOf(asin) : '';
    const o = {};
    if (asin !== x.cur) o.asin = asin;
    if (par && (!x.curP || (fix && x.curP !== par) || o.asin)) { if (par !== x.curP) o.parentAsin = par; }
    /* A corrected ASIN that Amazon says stands alone takes the old parent with it. */
    if (!par && o.asin && x.curP && P.A.single.has(asin)) o.parentAsin = '';
    if (Object.keys(o).length) w.push({ r: x.r, o, why, src: x.src });
  });
  return w;
}

function mdbAsinShow() {
  const P = MDB_ASIN; if (!P) return;
  const fix = !!($('ptmAsinFix') || {}).checked;
  const w = mdbAsinWrites(fix);
  const nA = w.filter(x => 'asin' in x.o).length, nP = w.filter(x => 'parentAsin' in x.o).length;
  const aLst = w.filter(x => 'asin' in x.o && x.src === 'lst').length;
  const pAmz = w.filter(x => 'parentAsin' in x.o && !P.replParent.has(x.o.asin || obUC(x.r.asin))).length;
  const notOn = P.plan.filter(x => !x.amz && !x.cur);
  const differ = P.plan.filter(x => x.amz && x.cur && x.cur !== x.amz);
  const finalAsins = P.plan.map(x => ((!x.cur || (fix && differ.includes(x))) ? x.amz : x.cur)).filter(a => MDB_ASIN_RE.test(a));
  const single = new Set(finalAsins.filter(a => P.A.single.has(a))), unknown = new Set(finalAsins.filter(a => P.A.notFound.has(a)));
  const stillNoParent = new Set(finalAsins.filter(a => !P.parentOf(a) && !P.A.single.has(a) && !P.A.notFound.has(a)));
  const when = P.at ? ' (built ' + new Date(P.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ')' : '';
  const li = [];
  li.push(`<b>ASIN:</b> ${nf(nA)} to write — ${nf(aLst)} from Amazon's listings report${esc(when)}, ${nf(nA - aLst)} from the Replenishment snapshot.`);
  li.push(`<b>Parent ASIN:</b> ${nf(nP)} to write — ${nf(nP - pAmz)} from the Replenishment snapshot, ${nf(pAmz)} asked from Amazon's catalogue just now.`);
  if (single.size) li.push(`${nf(single.size)} ASIN(s) have no parent on Amazon — stand-alone listings, so Parent ASIN stays blank.`);
  if (unknown.size) li.push(`${nf(unknown.size)} ASIN(s) Amazon's catalogue did not return — left without a parent.`);
  if (P.A.err) li.push(`<span style="color:var(--bad)">Amazon's catalogue did not answer: ${esc(P.A.err)}. ${nf(stillNoParent.size)} ASIN(s) keep a blank parent until it does — run this again then.</span>`);
  li.push(`<b>${nf(notOn.length)}</b> SKU(s) have no listing on Amazon in either brand, so Amazon has no ASIN to give — Download lists them.`);
  $('ptmAsinSum').innerHTML = li.map(t => `<div style="margin-top:4px">${t}</div>`).join('');
  $('ptmAsinFixWrap').classList.toggle('hide', !differ.length);
  if (differ.length) $('ptmAsinFixTxt').textContent = `Also correct ${nf(differ.length)} ASIN(s) already in the master that differ from Amazon's listing — e.g. `
    + differ.slice(0, 2).map(x => `${x.r.sku}: ${x.cur} → ${x.amz}`).join(', ');
  $('ptmAsinGo').disabled = !w.length;
  $('ptmAsinGo').textContent = w.length ? `Write ${nf(w.length)} SKU(s) to the master` : 'Nothing to write';
  $('ptmAsinNot').classList.toggle('hide', !notOn.length);
  $('ptmAsinBox').classList.remove('hide');
}

async function mdbAsinWrite() {
  const P = MDB_ASIN; if (!P) return;
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const w = mdbAsinWrites(!!$('ptmAsinFix').checked);
  if (!w.length) return;
  const patch = {};
  w.forEach(x => Object.entries(x.o).forEach(([f, v]) => { patch['pt_masterDB/' + x.r._key + '/' + f] = v; }));
  $('ptmAsinGo').disabled = true;
  try {
    await ptPatch(patch);        // one write: every row changes, or none does
    const byKey = new Map(w.map(x => [x.r._key, x.o]));
    PTG.mdb = (PTG.mdb || []).map(r => (byKey.has(r._key) ? Object.assign({}, r, byKey.get(r._key)) : r));
    PT.mdb = PTG.mdb;
    MDB_ASIN = null;
    $('ptmAsinBox').classList.add('hide');
    renderPmdb();
    $('ptmMsg').className = 'muted';
    $('ptmMsg').textContent = `Written: ${nf(w.filter(x => 'asin' in x.o).length)} ASIN(s) and ${nf(w.filter(x => 'parentAsin' in x.o).length)} Parent ASIN(s), from Amazon.`;
  } catch (e) {
    $('ptmAsinGo').disabled = false;
    $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Nothing was written: ' + (e.message || e);
  }
}

$('ptmAsin').onclick = () => mdbAsinCheck();
$('ptmAsinFix').onchange = () => mdbAsinShow();
$('ptmAsinGo').onclick = () => mdbAsinWrite();
$('ptmAsinCancel').onclick = () => { MDB_ASIN = null; $('ptmAsinBox').classList.add('hide'); };
$('ptmAsinNot').onclick = () => {
  const P = MDB_ASIN; if (!P) return;
  const rows = P.plan.filter(x => !x.amz && !x.cur).map(x => x.r);
  ptDownload('skus-not-on-amazon', [['SKU', 'Brand', 'Article', 'Subtype', 'Color', 'Size'].map(csvCell).join(',')]
    .concat(rows.map(r => [r.sku, r.brand, r.articleType, r.subtype, r.color, r.size].map(csvCell).join(','))));
};

const mdbYes = v => { const s = String(v == null ? '' : v).trim().toLowerCase(); return s === 'yes' || s === 'y' || s === 'true' || s === '1'; };

/** Turn one CSV row into the same shape the dialog produces, so both go through mdbValidate. */
/**
 * One row of a file, in the shape the dialog produces.
 *
 * A COLUMN THE FILE DOES NOT HAVE SAYS NOTHING — it comes back undefined, not blank (Ravi, 2026-09-22:
 * "mujhe sara data fill n karna pade"). A file of SKU, Article, Subtype, Colour and Size is then a
 * perfectly good file: a new SKU takes the rest from its recipe, and one already in the master keeps
 * every field the file left out instead of having it wiped.
 */
function mdbFromCsv(row, ix) {
  const has = n => ix[n] >= 0;
  const g = n => (has(n) ? String(row[ix[n]] == null ? '' : row[ix[n]]).trim() : undefined);
  const yn = (n, blank) => (has(n) ? (g(n) === '' ? (blank || 'no') : (mdbYes(g(n)) ? 'yes' : 'no')) : undefined);
  return {
    sku: g('sku'), brand: g('brand'), articleType: g('article'), subtype: g('subtype'),
    color: g('color'), size: g('size'), fabric: g('fabric'), consumption: g('consumption'),
    packOf: g('pack'),
    /* Cutting blank has always meant yes: it is the ordinary case, and a file that says nothing about it
     * on a NEW SKU means "the usual". On one already here, an absent COLUMN still changes nothing. */
    cuttingRequired: yn('cutting', 'yes'),
    isZip: yn('zip'), zipQty: g('zipqty'), chainLength: g('zipsize'),
    isRuffle: yn('ruffle'), ruffleMeters: g('rufflem'), ruffleFabric: g('rufflefab'),
    isPiping: yn('piping'), pipingMeters: g('pipingm'),
    fillerFabricRequired: yn('filler'), standardFillingQty: g('fillqty'),
    inventoryValuationPrice: g('valprice'), imageUrl: g('image'),
    asin: g('asin'), parentAsin: g('parent'),
  };
}

/**
 * A yes/no on a master row, as true or false. 1,128 rows (every CPCRU/ruffle row among them) were
 * written with the TEXT "yes" in isRuffle — true to anything that only asks "is it set", but "no" to
 * every check that asks === true: the recipe's count of what its SKUs say, the apply plan, the tidy
 * that clears ruffle metres. Read once here, so no screen has to know there are two spellings.
 */
const MDB_YN = ['cuttingRequired', 'isZip', 'isRuffle', 'isPiping', 'fillerFabricRequired', 'isCustom'];
function mdbYnFix(r) {
  if (!r || !MDB_YN.some(f => typeof r[f] === 'string')) return r;
  const o = Object.assign({}, r);
  MDB_YN.forEach(f => { if (typeof o[f] === 'string') o[f] = mdbYes(o[f]); });
  return o;
}

/** A master row as the form would hold it — the other half of "a column that is not there says nothing". */
function mdbFormOf(r) {
  const yn = b => (b ? 'yes' : 'no'), s = v => (v == null ? '' : String(v));
  return { sku: s(r.sku), brand: s(r.brand), articleType: s(r.articleType), subtype: s(r.subtype), color: s(r.color),
    size: s(r.size), fabric: s(r.fabric), consumption: s(r.consumption), packOf: s(r.packOf),
    cuttingRequired: yn(r.cuttingRequired !== false), isZip: yn(r.isZip), zipQty: s(r.zipQty), chainLength: s(r.chainLength),
    isRuffle: yn(r.isRuffle), ruffleMeters: s(r.ruffleMeters), ruffleFabric: s(r.ruffleFabric),
    isPiping: yn(r.isPiping), pipingMeters: s(r.pipingMeters),
    fillerFabricRequired: yn(r.fillerFabricRequired), standardFillingQty: s(r.standardFillingQty),
    inventoryValuationPrice: s(r.inventoryValuationPrice), imageUrl: s(r.imageUrl),
    asin: s(r.asin), parentAsin: s(r.parentAsin) };
}
/** What the file says, over what the SKU already says. */
function mdbMerge(v, existing) {
  const out = existing ? mdbFormOf(existing) : {};
  Object.keys(v).forEach(k => { if (v[k] !== undefined) out[k] = v[k]; });
  return out;
}

let MDB_IMP = null;      // the checked file, waiting to be applied

if ($('ptmFsFile')) $('ptmFsFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) fsManualFile(f); };
$('ptmImport').onclick = () => {
  if (($('ptmView') || {}).value === 'recipe') return $('ptmRecFile').click();
  if (($('ptmView') || {}).value === 'fabric') return $('ptmFsFile').click();
  if (($('ptmView') || {}).value === 'skucode') return $('ptmSkcFile').click();
  $('ptmFile').click();
};
$('ptmFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    /* AN EXCEL FILE TOO (Ravi, 2026-09-22, uploading the highlighted copy): read as text, an .xlsx is a
     * zip, and the screen could only say there was no SKU column. The first sheet is the one read. */
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    if (rows.length < 2) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'That file has no rows under the header.'; return; }
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    const ix = {
      sku: colIdx(head, ['sku']), brand: colIdx(head, ['brand']),
      article: colIdx(head, ['article', 'article type', 'articletype']),
      subtype: colIdx(head, ['subtype', 'article subtype']),
      color: colIdx(head, ['color', 'colour']), size: colIdx(head, ['size']),
      fabric: colIdx(head, ['fabric']), consumption: colIdx(head, ['consumption']),
      pack: colIdx(head, ['pack of', 'packof', 'pack']),
      cutting: colIdx(head, ['cutting required', 'cutting', 'cut required']),
      zip: colIdx(head, ['zip']), zipqty: colIdx(head, ['zips per piece', 'zip qty', 'zipqty']),
      zipsize: colIdx(head, ['zip size', 'chain length', 'chainlength']),
      ruffle: colIdx(head, ['ruffle']), rufflem: colIdx(head, ['ruffle metres', 'ruffle meters', 'ruffle m']),
      rufflefab: colIdx(head, ['ruffle fabric']),
      piping: colIdx(head, ['piping dori', 'piping']), pipingm: colIdx(head, ['piping dori metres', 'piping metres', 'piping dori per piece (m)']),
      filler: colIdx(head, ['filler fabric', 'filler']), fillqty: colIdx(head, ['filling qty', 'standard filling qty']),
      valprice: colIdx(head, ['valuation price', 'inventory valuation price']),
      image: colIdx(head, ['image', 'image url', 'picture']),
      asin: colIdx(head, ['asin', 'child asin']), parent: colIdx(head, ['parent asin', 'parentasin', 'parent']),
    };
    if (ix.sku < 0) {
      $('ptmMsg').className = 'err';
      $('ptmMsg').textContent = 'No SKU column in that file (its first row reads: '
        + (rows[0] || []).slice(0, 6).map(h => String(h).slice(0, 20)).join(' | ') + '). The header must carry: ' + MDB_IMPORT_COLS.join(', ');
      return;
    }

    const add = [], upd = [], bad = [], seen = new Set();
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i].length || rows[i].every(c => String(c).trim() === '')) continue;
      const v = mdbFromCsv(rows[i], ix);
      const key = obUC(v.sku);
      if (!key) { bad.push(`row ${i + 1}: no SKU`); continue; }
      // A file that lists the same SKU twice would write one and silently lose the other.
      if (seen.has(key)) { bad.push(`row ${i + 1}: ${key} appears more than once in this file`); continue; }
      seen.add(key);
      const existing = (PTG.mdb || []).find(r => obUC(r.sku) === key);
      /* Checked as it would be WRITTEN: what the file says, over what the SKU already says. */
      const merged = mdbMerge(v, existing);
      const err = mdbValidate(merged, existing ? existing.sku : '');
      if (err) { bad.push(`row ${i + 1} (${key}): ${err}`); continue; }
      (existing ? upd : add).push({ v: merged, existing });
    }

    MDB_IMP = { add, upd, bad, name: file.name };
    /* WHICH NEW ROWS HAVE A RECIPE BEHIND THEM. A file of five columns leans on it entirely, so a
     * combination with no recipe has to be said here rather than discovered as blank columns later. */
    const noRec = add.filter(x => !recipeOf(mdbRecord(x.v, false)));
    const lines = [`${file.name}: ${nf(add.length)} new SKU(s), ${nf(upd.length)} to update`];
    if (add.length) lines.push(noRec.length
      ? `${nf(add.length - noRec.length)} of them take fabric, consumption, zip, ruffle and piping from a recipe — `
        + `${nf(noRec.length)} have NO recipe for their article, subtype and size and will be added with only what the file says`
      : 'all of them take fabric, consumption, pack, zip, ruffle and piping from the recipe for their article, subtype and size');
    if (upd.length) lines.push('a column your file does not have is left exactly as it is');
    if (bad.length) lines.push(`${nf(bad.length)} refused`);
    $('ptmImpMsg').innerHTML = esc(lines.join(' · '))
      + (noRec.length ? '<div class="muted" style="margin-top:6px;font-size:12px">No recipe yet for: '
          + [...new Set(noRec.map(x => [x.v.articleType, x.v.subtype, x.v.size].filter(Boolean).join(' · ')))].slice(0, 8).map(esc).join('<br>')
          + '<br>Master Database → Recipes → "Seed from the SKUs", or fill the recipe sheet, then these fill in by themselves.</div>' : '')
      + (bad.length ? '<div class="muted" style="margin-top:6px;font-size:12px">'
          + bad.slice(0, 8).map(esc).join('<br>') + (bad.length > 8 ? `<br>…and ${nf(bad.length - 8)} more` : '') + '</div>' : '');
    $('ptmImpMsg').className = bad.length && !add.length && !upd.length ? 'err' : 'muted';
    $('ptmImpBox').classList.toggle('hide', !(add.length || upd.length));
  } catch (err) {
    $('ptmMsg').className = 'err';
    $('ptmMsg').textContent = 'Could not read that file: ' + (err.message || err);
  }
};

$('ptmImpCancel').onclick = () => { MDB_IMP = null; $('ptmImpBox').classList.add('hide'); $('ptmImpMsg').textContent = ''; };

$('ptmImpGo').onclick = async () => {
  if (!MDB_IMP) return;
  const { add, upd } = MDB_IMP;
  $('ptmImpGo').disabled = true;
  let done = 0;
  try {
    for (const { v } of add) {
      /* A NEW ROW TAKES ITS RECIPE, the same as one typed into the form. An import of the fifteenth
       * colour of a size already in the catalogue should not need every figure repeated in the file. */
      const rec = recipeFill(mdbRecord(v, false)).rec;
      if (v.imageUrl) rec.imageUrl = v.imageUrl;
      const key = 'mdb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      await ptPut('pt_masterDB/' + key, rec);
      PTG.mdb.push(Object.assign({ _key: key }, rec));
      done++;
      $('ptmImpMsg').textContent = `Saving… ${nf(done)} of ${nf(add.length + upd.length)}`;
    }
    for (const { v, existing } of upd) {
      const rec = mdbRecord(v, existing.isCustom === true);
      rec.imageUrl = v.imageUrl || existing.imageUrl || '';
      await ptPut('pt_masterDB/' + existing._key, rec);
      PTG.mdb = PTG.mdb.map(x => (x._key === existing._key ? Object.assign({ _key: existing._key }, rec) : x));
      done++;
      $('ptmImpMsg').textContent = `Saving… ${nf(done)} of ${nf(add.length + upd.length)}`;
    }
    PT.mdb = PTG.mdb;
    MDB_IMP = null;
    $('ptmImpBox').classList.add('hide');
    $('ptmImpMsg').className = 'muted';
    const still = PTG.mdb.filter(m => add.some(x => obUC(x.v.sku) === obUC(m.sku)) && !String(m.fabric || '').trim());
    $('ptmImpMsg').textContent = `Imported — ${nf(add.length)} added, ${nf(upd.length)} updated.`
      + (still.length ? ` ${nf(still.length)} of the new ones have no cloth on them: there is no recipe for their article, subtype and size yet.` : '');
    renderPmdb();
  } catch (e) {
    $('ptmImpMsg').className = 'err';
    $('ptmImpMsg').textContent = `Stopped after ${nf(done)} row(s): ${e.message || e}`;
    renderPmdb();
  }
  $('ptmImpGo').disabled = false;
};

