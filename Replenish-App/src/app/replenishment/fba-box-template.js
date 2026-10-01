/* ================= AMAZON'S FBA BOX-CONTENT TEMPLATE, FILLED =================
 *
 * Ravi, 2026-09-23: "packing list se hi fill amazon fba template wala action bhi ho — check pillow
 * tracker app". The flow is Pillow's: press the button on a saved list, pick the template Amazon
 * gave you, and the same file comes back with this list's figures in it.
 *
 * ONE COLUMN PER BOX. Amazon's sheet lists every SKU down column A and every box across from M,
 * and wants a quantity where they meet, plus each box's weight and dimensions in its own rows.
 * Nothing else on the sheet is touched, and no other part of the workbook is even re-encoded.
 *
 * AMAZON'S UNITS, NOT OURS. The template is in pounds and inches; this app keeps kilograms and
 * centimetres. Converting on the way out is the whole reason a person should not be retyping this.
 */
const AMZ_SHEET = 'Box packing information';
const AMZ_FIRST_BOX_COL = 13;                  // M — the first box's column
const AMZ_KG_LB = 2.2046226218, AMZ_CM_IN = 1 / 2.54;

/** A cell's value as the sheet holds it: a number, or a shared string resolved. */
function amzCellVal(xml, shared, ref) {
  const m = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)').exec(xml);
  if (!m) return undefined;
  const attrs = m[1] || '', body = m[2] || '';
  const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  if (/t="s"/.test(attrs)) return v == null ? undefined : shared[Number(v)];
  if (/t="inlineStr"/.test(attrs)) { let t = ''; for (const x of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += x[1]; return pkUnesc(t); }
  return v;
}
const amzNumToCol = n => { let out = ''; while (n > 0) { const m = (n - 1) % 26; out = String.fromCharCode(65 + m) + out; n = (n - m - 1) / 26; } return out; };
const amzNorm = v => String(v == null ? '' : v).trim().toLowerCase();

/**
 * Put a number in a cell, keeping the cell's own style.
 *
 * A cell that is not in the XML at all has to be INSERTED IN COLUMN ORDER — Excel reads a row's
 * cells in order and a cell out of place makes the file unreadable. Its style is borrowed from the
 * header cell of the same column so the figure looks like its neighbours.
 */
function amzSetCell(xml, col, row, value, headRow) {
  const ref = amzNumToCol(col) + row;
  const existing = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  const em = existing.exec(xml);
  if (em) {
    const attrs = (em[1] || '').replace(/\s*t="[^"]*"/, '');     // a number carries no type
    return xml.replace(existing, '<c r="' + ref + '"' + attrs + '><v>' + value + '</v></c>');
  }
  const head = new RegExp('<c r="' + amzNumToCol(col) + headRow + '"([^>]*?)(?:/>|>)').exec(xml);
  const st = head && /s="(\d+)"/.exec(head[1]) ? ' s="' + /s="(\d+)"/.exec(head[1])[1] + '"' : '';
  const cell = '<c r="' + ref + '"' + st + '><v>' + value + '</v></c>';
  const rowRe = new RegExp('(<row r="' + row + '"[^>]*>)([\\s\\S]*?)(</row>)');
  const rm = rowRe.exec(xml);
  if (!rm) return xml.replace('</sheetData>', '<row r="' + row + '">' + cell + '</row></sheetData>');
  const body = rm[2];
  let at = body.length;
  for (const cm of body.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
    if (pkColIx(cm[1]) + 1 > col) { at = cm.index; break; }
  }
  return xml.replace(rowRe, rm[1] + body.slice(0, at) + cell + body.slice(at) + rm[3]);
}

/** Which worksheet file holds Amazon's box sheet. */
async function amzSheetPath(bytes) {
  const f = await pkUnzip(bytes, n => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels');
  if (!f['xl/workbook.xml']) throw new Error('That is not a workbook — it has no xl/workbook.xml in it.');
  const wb = PK_TD.decode(f['xl/workbook.xml']);
  let rid = '';
  for (const m of wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g)) {
    if (m[1] === AMZ_SHEET) { rid = m[2]; break; }
  }
  if (!rid) throw new Error('That file has no "' + AMZ_SHEET + '" sheet — it is not Amazon\'s box-content template.');
  const rels = PK_TD.decode(f['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const rm = new RegExp('<Relationship[^>]*Id="' + rid + '"[^>]*Target="([^"]*)"').exec(rels);
  if (!rm) throw new Error('The workbook names that sheet but does not say where it is.');
  let t = rm[1].replace(/^\//, '');
  return t.startsWith('xl/') ? t : 'xl/' + t;
}

/** Work out what goes where, and say what could not be placed. Writes nothing. */
function amzPlan(xml, shared, list) {
  const val = ref => amzCellVal(xml, shared, ref);
  let head = -1;
  for (let r = 1; r <= 20 && head < 0; r++) if (amzNorm(val('A' + r)) === 'sku') head = r;
  if (head < 0) throw new Error('The template has no SKU column where one is expected (column A, in the first 20 rows).');

  /* How many box columns Amazon has made room for — a list with more boxes than that cannot be
   * filled, and saying so is better than writing into a column Amazon will not read. */
  let boxes = null;
  for (let r = 1; r < head && boxes == null; r++) {
    for (let c = 1; c <= 28 && boxes == null; c++) {
      if (amzNorm(val(amzNumToCol(c) + r)).indexOf('total box count') !== 0) continue;
      for (let cc = c + 1; cc <= c + 8; cc++) {
        const v = val(amzNumToCol(cc) + r);
        if (v != null && v !== '' && !isNaN(+v)) { boxes = Math.round(+v); break; }
      }
    }
  }
  if (boxes == null) throw new Error('The template does not say its "Total box count", so there is no way to know how many box columns it has.');

  const skuRow = {};
  for (let r = head + 1; r <= head + 400; r++) {
    const a = val('A' + r);
    if (a == null) break;
    if (amzNorm(a) === 'name of box') break;
    skuRow[amzNorm(a)] = r;
  }
  const rows = { weight: -1, width: -1, length: -1, height: -1 };
  for (let r = head + 1; r <= head + 420; r++) {
    const a = amzNorm(val('A' + r));
    if (!a) continue;
    if (a.indexOf('box weight') === 0) rows.weight = r;
    else if (a.indexOf('box width') === 0) rows.width = r;
    else if (a.indexOf('box length') === 0) rows.length = r;
    else if (a.indexOf('box height') === 0) rows.height = r;
  }

  const sets = [], missing = {};
  let used = 0;
  (list.boxes || []).forEach(b => {
    const no = pkNum(b.n);
    used = Math.max(used, no);
    if (!(no >= 1) || no > boxes) return;
    const col = AMZ_FIRST_BOX_COL + no - 1;
    (b.items || []).forEach(it => {
      const key = amzNorm(it.sku), qty = pkNum(it.qty);
      if (!key || !qty) return;
      if (skuRow[key] != null) sets.push({ col, row: skuRow[key], value: qty, what: 'qty' });
      else missing[it.sku] = (missing[it.sku] || 0) + qty;
    });
    const c = pkCalc(b, list.pkgWt, list.volDiv);
    const kg = v => Math.round(v * AMZ_KG_LB * 10) / 10;
    const cm = v => Math.round(pkNum(v) * AMZ_CM_IN);
    if (rows.weight > 0) sets.push({ col, row: rows.weight, value: kg(c.gross), what: 'weight' });
    if (rows.width > 0) sets.push({ col, row: rows.width, value: cm(b.W), what: 'width' });
    if (rows.length > 0) sets.push({ col, row: rows.length, value: cm(b.L), what: 'length' });
    if (rows.height > 0) sets.push({ col, row: rows.height, value: cm(b.H), what: 'height' });
  });
  return { head, boxes, used, sets, missing: Object.keys(missing).map(k => ({ sku: k, qty: missing[k] })) };
}

let PK_AMZ_ID = '';
function pkAmzAsk(id) {
  const p = PK.find(x => x.id === id);
  if (!p) return;
  if (!(p.boxes || []).length) { pkMsg('That list has no boxes in it yet.', true); return; }
  PK_AMZ_ID = id;
  const el = $('pkAmzFile');
  el.value = '';
  pkMsg('Pick the box-content template you downloaded from Amazon (.xlsx).');
  el.click();
}
async function pkAmzFill(file) {
  const p = PK.find(x => x.id === PK_AMZ_ID);
  if (!p || !file) return;
  try {
    pkMsg('Reading the template…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const path = await amzSheetPath(bytes);
    const f = await pkUnzip(bytes, n => n === path || n === 'xl/sharedStrings.xml');
    const shared = [];
    if (f['xl/sharedStrings.xml']) {
      const sx = PK_TD.decode(f['xl/sharedStrings.xml']);
      sx.split('<si>').slice(1).forEach(si => {
        let t = '';
        for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += m[1];
        shared.push(pkUnesc(t));
      });
    }
    let xml = PK_TD.decode(f[path]);
    const plan = amzPlan(xml, shared, p);
    plan.sets.forEach(x => { xml = amzSetCell(xml, x.col, x.row, x.value, plan.head); });
    const blob = await pkZipReplace(bytes, path, xml);
    const name = 'Amazon-FBA-' + String(p.title || 'packing').replace(/[^a-z0-9-]/gi, '_').slice(0, 32)
      + '-' + (p.date || '') + '.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    /* WHAT WENT IN, AND WHAT COULD NOT. A SKU the template has never heard of is the whole failure
     * mode of this job, so it is named rather than counted. */
    const bits = [nf(plan.sets.filter(x => x.what === 'qty').length) + ' quantity cell(s) filled'];
    if (plan.used > plan.boxes) {
      bits.push('your list goes up to box ' + nf(plan.used) + ' but the template only has ' + nf(plan.boxes)
        + ' — raise its Total box count and fill again');
    }
    if (plan.missing.length) {
      bits.push(nf(plan.missing.length) + ' SKU(s) are not in the template and were left out: '
        + plan.missing.slice(0, 6).map(x => x.sku + ' (' + nf(x.qty) + ')').join(', ')
        + (plan.missing.length > 6 ? ' and ' + nf(plan.missing.length - 6) + ' more' : ''));
    }
    pkMsg(bits.join(' · '), plan.missing.length > 0 || plan.used > plan.boxes);
  } catch (e) {
    pkMsg('That template could not be filled: ' + (e.message || e), true);
  }
}

async function pkDelete(id) {
  const p = PK.find(x => x.id === id); if (!p) return;
  if (!confirm(`Delete the packing list \u201c${p.title || id}\u201d? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'packlist', id));
    PK = PK.filter(x => x.id !== id);
    renderPack();
    pkMsg('Deleted.');
  } catch (e) { pkMsg('Could not delete it: ' + (e.message || e), true); }
}

['pkSearch', 'pkAccount', 'pkFrom', 'pkTo', 'pkStatus'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', () => renderPack());
});
$('pkClear').onclick = () => {
  ['pkSearch', 'pkFrom', 'pkTo'].forEach(id => { $(id).value = ''; });
  $('pkAccount').value = ''; $('pkStatus').value = 'open';
  renderPack();
};

/* ---------- new list from a file ---------- */
const PK_DEF = { L: 56, W: 43, H: 28, pkgWt: 1.5, volDiv: 5000, material: '100% COTTON' };

$('pkNew').onclick = () => $('pkFile').click();
$('pkAmzFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) pkAmzFill(f); };
$('pkFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  $('pkImpErr').classList.add('hide');
  $('pkImpMsg').textContent = '';
  try {
    const rows = await pkReadFile(file);
    if (!rows.length) throw new Error('That file has no rows in it.');
    const m = pkMatch(rows);
    const built = pkBuild(rows, m, PK_DEF);
    PK_STAGED = { file: file.name, m, ...built };
    $('pkFileName').textContent = file.name + ' \u00b7 ' + rows.length + ' row(s) read';
    $('pkTitle').value = (file.name.replace(/\.(xlsx|csv)$/i, '') || '').slice(0, 60);
    $('pkInvoice').value = '';
    $('pkAcc').value = (PK[0] && PK[0].account) || '';
    $('pkDate').value = pkToday();
    pkRenderPreview();
    $('pkModal').classList.remove('hide');
  } catch (err) {
    pkMsg('Could not read that file: ' + (err.message || err), true);
  }
};

function pkRenderPreview() {
  const g = PK_STAGED; if (!g) return;
  const found = PK_COLS.filter(([k]) => g.m.idx[k] != null)
    .map(([k]) => `<b>${k}</b> \u2192 \u201c${esc(String(g.m.head[g.m.idx[k]] || '').trim())}\u201d`);
  const missReq = g.m.need;
  const missOpt = PK_COLS.filter(([k, req]) => !req && g.m.idx[k] == null).map(([k]) => k);
  const bits = [];
  bits.push(`<div>Header found on <b>row ${g.m.row + 1}</b>. Matched: ${found.join(' \u00b7 ') || '<b>nothing</b>'}</div>`);
  if (missOpt.length) bits.push(`<div class="muted">Not in the file, so taken from the catalogue or defaulted: ${missOpt.join(', ')}.</div>`);
  const noWt = new Set();
  g.boxes.forEach(b => b.items.forEach(it => { if (!pkNum(it.perPcsWt)) noWt.add(it.sku); }));
  if (noWt.size) bits.push(`<div class="muted">${noWt.size} SKU(s) have no per-piece weight yet, so the net weight will read 0 until one is typed — Open the list after saving and fill them in once.</div>`);
  if (g.dropped) bits.push(`<div class="muted">${g.dropped} row(s) skipped \u2014 no SKU or no quantity on them.</div>`);
  if (g.unknown.length) bits.push(`<div class="muted">${g.unknown.length} SKU(s) are not in this app's snapshot, so their description came from the file only: ${esc(g.unknown.slice(0, 6).join(', '))}${g.unknown.length > 6 ? '\u2026' : ''}</div>`);
  if (missReq.length) {
    // A header that arrived as ONE cell is not a naming problem, it is a separator problem — the
    // file is split on something this reader did not recognise. Saying "rename the column" there
    // sends somebody renaming columns that were right all along, which is where a whole afternoon
    // went on 2026-08-24. Named separately, in the words that lead to the actual fix.
    const oneCell = g.m.head.filter(c => String(c || '').trim()).length === 1;
    bits.push(`<div class="err" style="margin-top:6px">No column matched for <b>${missReq.join(', ')}</b>, and without those there is no packing list. `
      + `The file's header row reads: ${esc(g.m.head.filter(Boolean).slice(0, 12).join(' | ')) || '(empty)'}. `
      + (oneCell
        ? `<b>That whole line arrived as a single column</b>, so the columns were never separated — the file is not split on a comma, a semicolon or a tab. Open it in Excel and use <b>Save As → CSV UTF-8 (Comma delimited)</b>.`
        : `Rename the column, or use the Template button for a sheet with the names this reads.`)
      + `</div>`);
  }
  $('pkMatch').innerHTML = bits.join('');
  $('pkSave').disabled = missReq.length > 0 || !g.boxes.length;

  const t = pkTotals({ boxes: g.boxes, pkgWt: PK_DEF.pkgWt, volDiv: PK_DEF.volDiv });
  $('pkPreview').innerHTML = '<thead><tr><th>Box</th><th>SKU</th><th>Description</th><th>Size</th>'
    + '<th class="num">Qty</th><th class="num">Per pcs wt</th><th class="num">Net wt (kg)</th></tr></thead><tbody>'
    + g.boxes.flatMap(b => b.items.map((it, i) => `<tr>
        <td>${i === 0 ? '<b>' + esc(String(b.label)) + '</b>' : ''}</td>
        <td>${esc(it.sku)}</td><td>${esc(it.desc)}</td><td>${esc(it.size || '\u2014')}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${it.perPcsWt ? it.perPcsWt.toFixed(3) : '\u2014'}</td>
        <td class="num">${it.perPcsWt ? (it.qty * it.perPcsWt).toFixed(2) : '\u2014'}</td></tr>`))
      .join('')
    + `<tr><td colspan="4"><b>${t.boxes} box(es)</b></td><td class="num"><b>${t.qty}</b></td>
        <td></td><td class="num"><b>${t.net.toFixed(2)}</b></td></tr></tbody>`;
}

$('pkCancel').onclick = () => { $('pkModal').classList.add('hide'); PK_STAGED = null; };
$('pkSave').onclick = async () => {
  const g = PK_STAGED; if (!g) return;
  const btn = $('pkSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const p = {
      id: pkId(),
      date: $('pkDate').value || pkToday(),
      invoice: $('pkInvoice').value.trim(),
      title: $('pkTitle').value.trim(),
      account: $('pkAcc').value.trim(),
      // A list just built from a real file is WORK IN PROGRESS, not a draft — a draft is something
      // nobody has started. Draft stays selectable for one being set up by hand.
      status: 'progress',
      pkgWt: PK_DEF.pkgWt, volDiv: PK_DEF.volDiv,
      boxes: g.boxes.map(b => ({ n: b.n, L: b.L, W: b.W, H: b.H,
        grossWtOverride: b.grossWtOverride ?? '', items: b.items })),
      source: g.file,
      by: ME.email || '',
      createdAt: pkToday(),
    };
    /* THE FIRST FILE TEACHES THE MASTER.
     *
     * Nothing carries a per-piece weight — not the catalogue, not the FBA report — so the master
     * starts empty and the weights have to be typed into the sheet once. Writing them back here is
     * what makes that ONCE: the next shipment of the same goods can leave those columns blank.
     *
     * Only where the master holds nothing. A figure already recorded was either weighed or corrected
     * by somebody, and an older spreadsheet must not quietly overwrite it. */
    const learn = {};
    Object.entries(g.fileWt || {}).forEach(([sku, w]) => { if (!pkNum(PK_WT[sku]) && w) learn[sku] = w; });
    if (Object.keys(learn).length) { try { await savePkWt(learn); } catch (e) { /* the list still saves */ } }
    await savePkOne(p);
    $('pkModal').classList.add('hide');
    PK_STAGED = null;
    renderPack();
    const learned = Object.keys(learn).length;
    pkMsg(`Saved \u201c${p.title}\u201d \u00b7 ${p.boxes.length} box(es).`
      + (learned ? ` ${learned} per-piece weight(s) recorded against their SKUs \u2014 the next file can leave those columns blank.` : '')
      + ` Open it to check the box sizes and weights, then print.`);
  } catch (e) {
    $('pkImpErr').textContent = 'Could not save: ' + (e.message || e);
    $('pkImpErr').classList.remove('hide');
  }
  btn.disabled = false; btn.textContent = 'Save packing list';
};

/* A blank sheet with EXACTLY the column names the reader looks for. The alternative is somebody
 * guessing at them and finding out from a preview that matched nothing. */
$('pkTemplate').onclick = () => {
  /* BOX, SKU and QTY are all that is REQUIRED. The weights are here because nothing can work them
   * out: the catalogue carries no per-piece weight and the weight master starts empty, so the first
   * file is where they come from. After that they are remembered per SKU and these columns can be
   * left blank.
   *
   * NET is the LINE (this SKU, this box). GROSS is the WHOLE BOX on a scale, so it goes on the box's
   * first row only — repeating it down the box would read as one box weighed twice. L/W/H are the
   * box too; blank uses 56 × 43 × 28 and the editor can change them all at once.
   */
  const head = ['Box', 'SKU', 'Qty', 'Net wt', 'Gross wt', 'L', 'W', 'H'];
  const sample = [
    ['1', 'RCNB355', '48', '2.64', '9.90', '56', '43', '28'],
    ['1', 'RCNE298', '24', '1.32', '', '', '', ''],
    ['2', 'RCNB355', '60', '3.30', '10.80', '56', '43', '28'],
  ];
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '\ufeff' + [head, ...sample].map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'packing-list-template.csv'; a.click(); URL.revokeObjectURL(a.href);
  pkMsg('Template downloaded. Only Box, SKU and Qty are needed — description, size and material come '
    + 'from the catalogue. Net wt is the LINE; Gross wt and L/W/H are the BOX, so put those on its first row only. '
    + 'A weight given here is remembered against the SKU, so the next file can leave the weight columns empty. '
    + 'Your own sheet may also use Description, Size, Material and Per pcs wt.');
};

/* ---------- editing a saved list ---------- */
function pkOpen(id) {
  const p = PK.find(x => x.id === id); if (!p) return;
  PK_EDIT = JSON.parse(JSON.stringify(p));       // a working copy; Close throws it away
  $('pkEdTitle').textContent = p.title || 'Packing list';
  $('pkEdTitleIn').value = p.title || '';
  $('pkEdInv').value = p.invoice || '';
  $('pkEdAcc').value = p.account || '';
  $('pkEdDate').value = p.date || pkToday();
  $('pkEdStatus').value = p.status || 'draft';
  $('pkEdPkg').value = p.pkgWt ?? PK_DEF.pkgWt;
  $('pkEdVdiv').value = p.volDiv ?? PK_DEF.volDiv;
  $('pkEdL').value = ''; $('pkEdW').value = ''; $('pkEdH').value = '';
  $('pkEdErr').classList.add('hide');
  $('pkEdMsg').textContent = '';
  pkRenderBoxes();
  pkRenderWt();
  $('pkEditModal').classList.remove('hide');
}
/* The per-SKU weights behind THIS list.
 *
 * A weight is a fact about the SKU, not about the box it happens to be in, so it is edited once here
 * and written to every box that carries that SKU — and into the master, so the next packing list
 * starts with it already filled. Editing it box by box is how the same product ends up with two
 * different weights in one shipment.
 */
function pkRenderWt() {
  const p = PK_EDIT; if (!p) return;
  const agg = new Map();
  (p.boxes || []).forEach(b => (b.items || []).forEach(it => {
    const k = String(it.sku || '').toUpperCase();
    if (!agg.has(k)) agg.set(k, { sku: k, desc: it.desc || '', size: it.size || '', qty: 0, wt: pkNum(it.perPcsWt) });
    const a = agg.get(k);
    a.qty += pkNum(it.qty);
    if (!a.wt) a.wt = pkNum(it.perPcsWt);
  }));
  const rows = [...agg.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  const missing = rows.filter(r => !r.wt).length;
  $('pkEdWt').innerHTML = '<thead><tr><th>SKU</th><th>Description</th><th>Size</th>'
    + '<th class="num">Qty</th><th class="num">Per pcs wt (kg)</th><th class="num">Net (kg)</th></tr></thead><tbody>'
    + rows.map(r => `<tr>
        <td class="mono">${esc(r.sku)}</td>
        <td style="padding:2px 4px"><input class="pkDesc" data-sku="${esc(r.sku)}" data-f="desc"
          value="${esc(r.desc)}" placeholder="${esc(r.sku)}"
          title="Goes on the packing list and on the box label. Typed here it is remembered for this SKU."
          style="width:100%;min-width:220px;padding:3px 6px;font-size:12px${r.desc && r.desc !== r.sku ? '' : ';background:#fef9c3'}"></td>
        <td style="padding:2px 4px"><input class="pkDesc" data-sku="${esc(r.sku)}" data-f="size"
          value="${esc(r.size)}" placeholder="—" style="width:90px;padding:3px 6px;font-size:12px"></td>
        <td class="num">${r.qty}</td>
        <td class="num" style="padding:2px 4px">
          <input class="pkWt" data-sku="${esc(r.sku)}" type="number" step="0.001" min="0"
                 value="${r.wt || ''}" placeholder="—"
                 style="width:88px;text-align:right${r.wt ? '' : ';background:#fee2e2'}"></td>
        <td class="num" style="padding:2px 4px">
          <input class="pkNet" data-sku="${esc(r.sku)}" data-qty="${r.qty}" type="number" step="0.01" min="0"
                 value="${r.wt ? (r.qty * r.wt).toFixed(2) : ''}" placeholder="—"
                 title="Type the whole line's weight off the scale and the per-piece figure is worked back out of it."
                 style="width:88px;text-align:right"></td>
      </tr>`).join('')
    + (missing ? `<tr><td colspan="6" class="muted" style="padding:8px">`
        + `${missing} SKU(s) have no weight recorded, so they add nothing to the net weight and the `
        + `gross is just the packing weight. Type them once — they are remembered for every list after this.`
        + `</td></tr>` : '')
    + '</tbody>';
  /* EITHER FIGURE CAN BE TYPED, and the other follows.
   *
   * A scale gives you the line, not the piece. Offering only a per-piece box makes somebody divide in
   * their head and round, and a rounded per-piece weight multiplied back up no longer equals what was
   * weighed. Whichever is typed is the one that was measured; the other is derived from it. */
  /* A DESCRIPTION IS ALSO A FACT ABOUT THE SKU. A code the snapshot has never heard of describes
   * itself by its own code, and that code is what would be printed on the packing list and on the
   * customs label. Typed once here it is remembered, and it is never recomputed away on a later
   * import — a correction that a refresh undoes is not a correction. */
  $('pkEdWt').querySelectorAll('.pkDesc').forEach(el => {
    el.onchange = () => {
      const k = String(el.dataset.sku || '').toUpperCase(), f = el.dataset.f, v = el.value.trim();
      PK_EDIT.boxes.forEach(b => b.items.forEach(it => {
        if (String(it.sku || '').toUpperCase() === k) it[f] = v;
      }));
      PK_META[k] = { ...(PK_META[k] || {}), [f]: v };
      PK_EDIT._metaDirty = Object.assign(PK_EDIT._metaDirty || {}, { [k]: { ...(PK_EDIT._metaDirty || {})[k], [f]: v } });
      pkRenderBoxes();
      pkRenderWt();
      $('pkEdMsg').textContent = f + ' set for ' + k + '. Press Save to keep it for the next list too.';
    };
  });
  $('pkEdWt').querySelectorAll('.pkNet').forEach(el => {
    el.onchange = () => {
      const qty = pkNum(el.dataset.qty);
      if (!qty) { pkRenderWt(); return; }
      pkSetWt(el.dataset.sku, pkNum(el.value) / qty);
    };
  });
  $('pkEdWt').querySelectorAll('.pkWt').forEach(el => {
    el.onchange = () => pkSetWt(el.dataset.sku, pkNum(el.value));
  });
}
function pkSetWt(sku, perPcs) {
  if (!PK_EDIT) return;
  const k = String(sku || '').toUpperCase();
  const v = pkNum(perPcs);
  PK_EDIT.boxes.forEach(b => b.items.forEach(it => {
    if (String(it.sku || '').toUpperCase() === k) it.perPcsWt = v;
  }));
  PK_WT[k] = v;
  PK_EDIT._wtDirty = Object.assign(PK_EDIT._wtDirty || {}, { [k]: v });
  pkRenderBoxes();
  pkRenderWt();
  $('pkEdMsg').textContent = 'Weight set for ' + k + ' (' + v.toFixed(3) + ' kg a piece). '
    + 'Press Save to keep it for the next list too.';
}

function pkRenderBoxes() {
  const p = PK_EDIT; if (!p) return;
  p.pkgWt = pkNum($('pkEdPkg').value);
  p.volDiv = pkNum($('pkEdVdiv').value) || 5000;
  const t = pkTotals(p);
  $('pkEdBoxes').innerHTML = '<thead><tr><th>Box</th><th>Contents</th><th class="num">Qty</th>'
    + '<th class="num">L</th><th class="num">W</th><th class="num">H</th>'
    + '<th class="num">Net</th><th class="num">Gross</th><th class="num">Vol wt</th><th class="num">CBM</th></tr></thead><tbody>'
    + p.boxes.map((b, i) => {
      const c = pkCalc(b, p.pkgWt, p.volDiv);
      const items = b.items.map(it => `${esc(it.sku)} \u00d7 ${it.qty}`).join(', ');
      const dim = (k, v) => `<td class="num" style="padding:2px 4px"><input class="pkDim" data-i="${i}" data-k="${k}" type="number" step="0.1" min="0" value="${v}" style="width:62px;text-align:right"></td>`;
      return `<tr>
        <td><b>${b.n}</b></td>
        <td title="${esc(items)}" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(items)}</td>
        <td class="num">${c.qty}</td>
        ${dim('L', b.L)}${dim('W', b.W)}${dim('H', b.H)}
        <td class="num">${c.net.toFixed(2)}</td>
        <td class="num" style="padding:2px 4px">
          <input class="pkDim" data-i="${i}" data-k="grossWtOverride" type="number" step="0.01" min="0"
                 placeholder="${c.autoGross.toFixed(2)}" value="${b.grossWtOverride || ''}"
                 title="Blank uses net + packing weight. Fill it in only from a scale."
                 style="width:70px;text-align:right"></td>
        <td class="num">${c.vol.toFixed(2)}</td>
        <td class="num">${c.cbm.toFixed(4)}</td>
      </tr>`;
    }).join('')
    + `<tr><td colspan="2"><b>${t.boxes} box(es)</b></td><td class="num"><b>${t.qty}</b></td>
        <td colspan="3"></td><td class="num"><b>${t.net.toFixed(2)}</b></td>
        <td class="num"><b>${t.gross.toFixed(2)}</b></td><td class="num"><b>${t.vol.toFixed(2)}</b></td>
        <td class="num"><b>${t.cbm.toFixed(4)}</b></td></tr></tbody>`;
  $('pkEdBoxes').querySelectorAll('.pkDim').forEach(el => {
    el.onchange = () => {
      const b = PK_EDIT.boxes[Number(el.dataset.i)]; if (!b) return;
      const k = el.dataset.k;
      b[k] = el.value === '' ? (k === 'grossWtOverride' ? '' : 0) : pkNum(el.value);
      pkRenderBoxes();
    };
  });
}
['pkEdPkg', 'pkEdVdiv'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', pkRenderBoxes); });
$('pkEdApplyDim').onclick = () => {
  if (!PK_EDIT) return;
  const L = pkNum($('pkEdL').value), W = pkNum($('pkEdW').value), H = pkNum($('pkEdH').value);
  if (!L && !W && !H) { $('pkEdMsg').textContent = 'Type at least one of L, W, H first.'; return; }
  PK_EDIT.boxes.forEach(b => { if (L) b.L = L; if (W) b.W = W; if (H) b.H = H; });
  pkRenderBoxes();
  $('pkEdMsg').textContent = 'Applied to all ' + PK_EDIT.boxes.length + ' box(es). Not saved yet.';
};
$('pkEdClose').onclick = () => { $('pkEditModal').classList.add('hide'); PK_EDIT = null; };
$('pkEdSave').onclick = async () => {
  const p = PK_EDIT; if (!p) return;
  p.title = $('pkEdTitleIn').value.trim();
  p.invoice = $('pkEdInv').value.trim();
  p.account = $('pkEdAcc').value.trim();
  p.date = $('pkEdDate').value || pkToday();
  p.status = $('pkEdStatus').value;
  p.pkgWt = pkNum($('pkEdPkg').value);
  p.volDiv = pkNum($('pkEdVdiv').value) || 5000;
  const btn = $('pkEdSave'); btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    // The weights go to the MASTER as well as onto this list, so the next shipment of the same goods
    // starts with them already filled in. That is the whole point of typing them once.
    const wtD = (p._wtDirty && Object.keys(p._wtDirty).length) ? p._wtDirty : null;
    const mtD = (p._metaDirty && Object.keys(p._metaDirty).length) ? p._metaDirty : null;
    if (wtD || mtD) { await savePkWt(wtD, mtD); delete p._wtDirty; delete p._metaDirty; }
    await savePkOne(p);
    renderPack();
    $('pkEdMsg').textContent = 'Saved.';
    $('pkEdErr').classList.add('hide');
  } catch (e) {
    $('pkEdErr').textContent = 'Could not save: ' + (e.message || e);
    $('pkEdErr').classList.remove('hide');
  }
  btn.disabled = false; btn.textContent = 'Save';
};
$('pkEdPrint').onclick = () => { if (PK_EDIT) pkPrintList(PK_EDIT); };
$('pkEdLabels').onclick = () => { if (PK_EDIT) pkLabelsAsk(PK_EDIT); };

/* ---------- Code 128-B, drawn as SVG ----------
 *
 * Written out because this app loads no external scripts, and because a barcode is the one thing on
 * a label nobody can proof-read: a wrong check digit scans as nothing, or as something else. The
 * table is the standard one and the check digit is the standard weighted sum.
 */
const PK_C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
'221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
'221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
'212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
'231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
'231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
'314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
'112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
'111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
'214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
'114131','311141','411131','211412','211214','211232','2331112'];
function pkBarcode(text, height) {
  const h = height || 38;
  const vals = [104];
  let sum = 104, i = 0;
  for (const ch of String(text || '')) {
    const c = ch.charCodeAt(0);
    // Outside printable ASCII there is no Code 128-B value. Dropped rather than substituted: a
    // swapped character makes a barcode that scans cleanly as the wrong text.
    if (c < 32 || c > 126) continue;
    i++; vals.push(c - 32); sum += (c - 32) * i;
  }
  vals.push(sum % 103); vals.push(106);
  const mods = vals.flatMap(v => PK_C128[v].split('').map(Number));
  const quiet = 10, total = mods.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet, bar = true, rects = '';
  for (const w of mods) {
    if (bar) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + h + '" fill="#000"/>';
    x += w; bar = !bar;
  }
  return '<svg viewBox="0 0 ' + total + ' ' + h + '" preserveAspectRatio="none"'
    + ' xmlns="http://www.w3.org/2000/svg" style="width:100%;height:' + h + 'px">' + rects + '</svg>';
}

/** Opened in its own tab rather than a modal: the app's stylesheet is built for a screen, and a
 *  packing list printed through it comes out with grey panels and cut columns. */
function pkWindow(html, what) {
  const w = window.open('', '_blank');
  if (!w) { pkMsg('The browser blocked the new tab — allow pop-ups for this site, then press ' + what + ' again.', true); return; }
  w.document.write(html); w.document.close();
}

function pkPrintList(p) {
  if (!p || !(p.boxes || []).length) { pkMsg('That list has no boxes in it.', true); return; }
  PK_HOUSE = pkHouseOf(p);
  const t = pkTotals(p);
  const boxHtml = p.boxes.map(b => {
    const c = pkCalc(b, p.pkgWt, p.volDiv);
    const rows = b.items.map((it, ii) => '<tr>'
      + (ii === 0 ? '<td rowspan="' + b.items.length + '" class="ctr">' + b.n + '</td>'
                  + '<td rowspan="' + b.items.length + '" class="ctr">' + b.n + '</td>' : '')
      + '<td>' + esc(it.desc || '') + '</td>'
      + '<td class="ctr mono">' + esc(it.sku || '') + '</td>'
      + '<td class="ctr">' + esc(it.material || '') + '</td>'
      + '<td class="ctr mono">' + esc(it.size || '') + '</td>'
      + '<td class="num">' + pkNum(it.qty) + '</td>'
      + '<td class="num">' + pkNum(it.perPcsWt).toFixed(2) + '</td>'
      + '<td class="num">' + (pkNum(it.qty) * pkNum(it.perPcsWt)).toFixed(2) + '</td></tr>').join('');
    return '<tr class="box-head"><td colspan="9"><b>Box ' + b.n + ' of ' + p.boxes.length + '</b></td></tr>' + rows
      + '<tr class="box-foot"><td colspan="6" class="r"><b>Box Dimension (L×W×H):</b> '
        + b.L + ' × ' + b.W + ' × ' + b.H + ' cm</td>'
        + '<td colspan="2" class="r"><b>NET WEIGHT:</b></td><td class="num"><b>' + c.net.toFixed(2) + ' kg</b></td></tr>'
      + '<tr class="box-foot"><td colspan="8" class="r"><b>GROSS WEIGHT:</b></td><td class="num"><b>' + c.gross.toFixed(2) + ' kg</b></td></tr>'
      + '<tr class="box-foot"><td colspan="8" class="r"><b>VOLUME WEIGHT:</b></td><td class="num"><b>' + c.vol.toFixed(2) + ' kg</b></td></tr>'
      + '<tr class="box-foot"><td colspan="8" class="r"><b>CBM:</b></td><td class="num"><b>' + c.cbm.toFixed(4) + ' m³</b></td></tr>';
  }).join('');

  const css = 'body{font-family:Arial,sans-serif;margin:0;padding:18px;color:#000;font-size:12px}'
    + '.top{display:flex;justify-content:space-between;align-items:center;border:2px solid #000;padding:10px}'
    + '.top .l{font-size:28px;font-weight:bold;width:150px;text-align:center;border-right:2px solid #000;padding-right:12px}'
    + '.top .c{flex:1;text-align:center;font-size:24px;font-weight:bold;letter-spacing:.04em}'
    + '.top .r{text-align:right;font-size:12px;line-height:1.6;width:230px;border-left:2px solid #000;padding-left:12px}'
    + '.top .r b{display:inline-block;width:74px}'
    + 'table.pk{width:100%;border-collapse:collapse}'
    + 'table.pk th,table.pk td{border:1px solid #000;padding:4px 6px;vertical-align:middle;font-size:11.5px}'
    + 'table.pk th{background:#eee;text-align:center;font-weight:bold;font-size:11px}'
    + 'table.pk td.ctr{text-align:center}table.pk td.num{text-align:right;font-family:monospace}'
    + 'table.pk td.mono{font-family:monospace}table.pk td.r{text-align:right;background:#fafafa}'
    + 'table.pk tr.box-head td{background:#e0e0e0;font-size:12.5px;padding:6px}'
    + 'table.pk tr.box-foot td{background:#f5f5f5;font-size:11px}'
    + '.totals{margin-top:14px;border:2px solid #000;padding:10px;display:grid;'
    + 'grid-template-columns:repeat(5,1fr);gap:10px;text-align:center;font-size:13px}'
    + '.totals b{display:block;font-size:18px;margin-top:2px}'
    + '@media print{.no-print{display:none}body{padding:8px}}';

  pkWindow('<!doctype html><html><head><meta charset="utf-8"><title>Packing List — ' + esc(p.title || '')
    + '</title><style>' + css + '</style></head><body>'
    + '<div class="top"><div class="l">' + esc(PK_HOUSE) + '</div>'
    + '<div class="c">Packing List</div><div class="r">'
    + '<div><b>Date:</b> ' + esc(p.date || '') + '</div>'
    + '<div><b>Invoice:</b> ' + esc(p.invoice || '—') + '</div></div></div>'
    + '<table class="pk"><thead><tr>'
    + '<th style="width:5%">From</th><th style="width:5%">To</th>'
    + '<th>Description of Goods</th><th style="width:12%">Item Code / Style</th>'
    + '<th style="width:11%">Material</th><th style="width:8%">Size</th>'
    + '<th style="width:7%">Qty</th><th style="width:8%">Per Pcs Wt</th><th style="width:9%">Net Wt (kg)</th>'
    + '</tr></thead><tbody>' + boxHtml + '</tbody></table>'
    + '<div class="totals">'
    + '<div>Total Boxes <b>' + t.boxes + '</b></div>'
    + '<div>Total Qty <b>' + t.qty.toLocaleString('en-US') + ' pcs</b></div>'
    + '<div>Total Net Weight <b>' + t.net.toFixed(2) + ' kg</b></div>'
    + '<div>Total Gross Weight <b>' + t.gross.toFixed(2) + ' kg</b></div>'
    + '<div>Total CBM <b>' + t.cbm.toFixed(4) + ' m³</b></div></div>'
    + '<table style="width:100%;border-collapse:collapse;margin-top:14px"><tr>'
    + '<td style="border:1px dashed #5b8c3a;padding:14px;width:50%;vertical-align:middle;'
    + 'font-size:11.5px;font-style:italic">We declare that this Invoice shows the actual price of the'
    + ' goods described and that all particulars are true and correct.</td>'
    + '<td style="border:1px solid #000;padding:0;width:25%;vertical-align:middle;text-align:center;background:#fff">'
    + '<div style="padding:24px 8px;font-weight:bold;font-size:18px;letter-spacing:.08em">' + esc(PK_HOUSE) + '</div></td>'
    + '<td style="width:25%;padding:14px;vertical-align:bottom;text-align:center;border-bottom:1px solid #000">'
    + '<b style="font-size:12px">Authorised Signatory</b></td></tr></table>'
    + '<div class="no-print" style="margin-top:14px;text-align:center">'
    + '<button onclick="window.print()" style="padding:10px 24px;border:none;border-radius:6px;'
    + 'background:#111827;color:#fff;font-size:14px;cursor:pointer">Print / Save as PDF</button></div>'
    + '</body></html>', 'Packing list');
}

/* ---------- box labels, 4 x 6 inch, one page per box ---------- */
function pkLabelsAsk(p) {
  if (!p || !(p.boxes || []).length) { pkMsg('That list has no boxes in it.', true); return; }
  PK_LBL = p;
  let last = {};
  try { last = JSON.parse(localStorage.getItem(PK_LS) || '{}') || {}; } catch (e) { last = {}; }
  $('pkLblInv').value = p.invoice || last.inv || '';
  $('pkLblCons').value = last.cons || 'HGR6  Amazon';
  $('pkLblPort').value = last.port || 'USA';
  $('pkLblMade').value = last.made || 'INDIA';
  $('pkLblExp').value = last.exp || 'Ridhi';
  $('pkLblContent').value = '';
  $('pkLblErr').classList.add('hide');
  $('pkLblModal').classList.remove('hide');
}
$('pkLblCancel').onclick = () => { $('pkLblModal').classList.add('hide'); PK_LBL = null; };
$('pkLblGo').onclick = () => {
  const p = PK_LBL; if (!p) return;
  const inv = $('pkLblInv').value.trim();
  const cons = $('pkLblCons').value.trim();
  const port = $('pkLblPort').value.trim() || 'USA';
  const made = $('pkLblMade').value.trim() || 'INDIA';
  const exp = $('pkLblExp').value.trim() || 'Ridhi';
  const over = $('pkLblContent').value.trim();
  const bar = $('pkLblBar').checked;
  // Both are printed onto a physical box and neither can be corrected afterwards, so neither is
  // allowed to be blank.
  if (!inv || !cons) {
    $('pkLblErr').textContent = 'Invoice number and consignee are both needed — they go on the box and cannot be fixed once it is sealed.';
    $('pkLblErr').classList.remove('hide');
    return;
  }
  try { localStorage.setItem(PK_LS, JSON.stringify({ inv, cons, port, made, exp })); } catch (e) { /* private mode */ }

  const total = p.boxes.length;
  const pages = p.boxes.map(b => {
    const c = pkCalc(b, p.pkgWt, p.volDiv);
    const descs = [...new Set(b.items.map(it => (it.desc || '').trim()).filter(Boolean))];
    const desc = over || (descs.length ? descs.join(' / ') : '—');
    return '<div class="label">'
      + '<div class="boxno">' + b.n + ' Of ' + total + '</div>'
      + '<div class="line"><b>Invoice Number :-</b> ' + esc(inv) + '</div>'
      + '<div class="line"><b>PORT OF DISCHARGE :-</b> ' + esc(port) + '</div>'
      + '<div class="line"><b>Made In ' + esc(made) + '</b></div>'
      + '<div class="line"><b>Content:-</b> ' + esc(desc) + '</div>'
      + '<div class="sep"></div>'
      + '<div class="line"><b>No of Pieces :-</b> ' + c.qty + '</div>'
      + '<div class="line"><b>Box Size In CM :-</b> ' + b.L + 'x' + b.W + 'x' + b.H + '</div>'
      + '<div class="line cbm">(' + c.cbm.toFixed(6) + ')</div>'
      + '<div class="sep"></div>'
      + '<div class="line"><b>Exporter/ Shipper :-</b> ' + esc(exp) + '</div>'
      + '<div class="line"><b>Consignee :-</b> ' + esc(cons) + '</div>'
      + (bar ? '<div class="bar">' + pkBarcode(inv + ' ' + b.n + '/' + total, 34)
             + '<div class="barTxt">' + esc(inv) + ' ' + b.n + '/' + total + '</div></div>' : '')
      + '</div>';
  }).join('');

  const css = '@page{size:4in 6in;margin:0}'
    + '*{box-sizing:border-box}'
    + 'html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}'
    + '.label{width:4in;height:6in;padding:.20in .18in;page-break-after:always;display:flex;'
    + 'flex-direction:column;justify-content:flex-start;overflow:hidden;border:1px solid #000}'
    + '.label:last-child{page-break-after:auto}'
    + '.boxno{text-align:center;font-weight:bold;font-size:20pt;margin:0 0 8px;letter-spacing:.04em}'
    + '.line{font-size:11pt;line-height:1.45;text-align:center;margin:2px 0}'
    + '.line b{font-weight:bold}.line.cbm{font-size:9.5pt;color:#222}'
    + '.sep{height:1px;background:#000;margin:7px 0;opacity:.3}'
    + '.bar{margin-top:auto;padding-top:6px}'
    + '.barTxt{text-align:center;font-family:monospace;font-size:9pt;letter-spacing:.06em;margin-top:2px}'
    + '@media screen{body{background:#eee;padding:14px;padding-top:56px}'
    + '.label{margin:8px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.1)}'
    + '.toolbar{position:fixed;top:0;left:0;right:0;background:#111827;color:#fff;padding:10px 16px;'
    + 'text-align:center;z-index:100;font-size:13px}'
    + '.toolbar button{padding:7px 18px;background:#fff;color:#111827;border:none;border-radius:6px;'
    + 'font-weight:bold;cursor:pointer;margin-left:14px}}'
    + '@media print{.toolbar{display:none}body{padding:0;background:#fff}'
    + '.label{margin:0;box-shadow:none;border:none}}';

  pkWindow('<!doctype html><html><head><meta charset="utf-8"><title>Box labels — ' + esc(p.title || '')
    + '</title><style>' + css + '</style></head><body>'
    + '<div class="toolbar">' + total + ' label' + (total > 1 ? 's' : '') + ' · Invoice ' + esc(inv)
    + ' · ' + esc(cons)
    + '<button onclick="window.print()">Print</button></div>'
    + pages + '</body></html>', 'Box labels');

  $('pkLblModal').classList.add('hide');
  PK_LBL = null;
};


