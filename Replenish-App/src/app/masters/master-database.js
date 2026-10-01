/* ---------------- Master Database ---------------- */

async function ensurePmdb() {
  if (!PTG.mdb) {
    PT.busy.mdb = true; renderPmdb();
    await ptLoadGates();
    PT.busy.mdb = false; PT.err.mdb = PTG.err || ''; PT.at.mdb = ptStamp();
  }
  PT.mdb = PTG.mdb;      // one array, two names — the gates and this tab must never disagree
  renderPmdb();
  /* A recipe copy over a minute old is read again, quietly, and the table redrawn if it changed. */
  if (Date.now() - (PTG.recipeAt || 0) > 60000) {
    try {
      const rec = await ptGet('pt_masters/recipe');
      PTG.recipeAt = Date.now();
      if (rec && JSON.stringify(rec) !== JSON.stringify((PTG.masters || {}).recipe || null)) {
        PTG.masters = Object.assign({}, PTG.masters || {}, { recipe: rec }); RECIPE_IX = { src: null, map: null }; renderPmdb();
      }
    } catch (e) { /* the copy in hand stays */ }
  }
  // Pictures come after the table is on screen: they are a nicety, and the SKUs are what people came for.
  mdbImgFill(false);
}

function pmdbFilters() {
  const v = id => ($(id) || {}).value || '';
  return { brand: v('ptmBrand'), art: v('ptmArt'), sub: v('ptmSub'), col: v('ptmCol'),
    sz: v('ptmSz'), cut: v('ptmCut'), q: v('ptmQ').trim().toLowerCase() };
}

function pmdbApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'brand' && f.brand && !ptCi(r.brand, f.brand)) return false;
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.subtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'cut' && f.cut === 'y' && !r.cuttingRequired) return false;
    if (skip !== 'cut' && f.cut === 'n' && r.cuttingRequired) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.subtype, r.color, r.size, r.fabric, r.brand, r.asin, r.parentAsin].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

const PMDB_MAX = 600;

/**
 * Every SKU on screen with the cloth its size implies: the cut, the roll it comes off, how many
 * across, what is wasted, and the metres one piece takes — beside whatever is stored today.
 */
function renderMdbCons() {
  const all = PT.mdb || [];
  if (!all.length) { $('ptmMsg').textContent = ''; $('ptmKpis').innerHTML = ''; return ptEmpty('ptmTable', 'The master database is empty.'); }
  const f = pmdbFilters();
  ptFill('ptmBrand', pmdbApply(all, f, 'brand').map(r => r.brand), 'All brands');
  ptFill('ptmArt', pmdbApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('ptmSub', pmdbApply(all, f, 'sub').map(r => r.subtype), 'All subtypes');
  ptFill('ptmCol', pmdbApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('ptmSz', pmdbApply(all, f, 'sz').map(r => r.size), 'All sizes');

  const rows = pmdbApply(all, f).map(r => Object.assign({ row: r, stored: parseFloat(r.consumption) || 0 }, { plan: ptConsPlan(r) }))
    .sort((a, b) => String(a.row.sku || '').localeCompare(String(b.row.sku || '')));
  PT._consRows = rows;

  const done = rows.filter(x => !x.plan.why);
  const blocked = rows.filter(x => x.plan.why);
  const changed = done.filter(x => Math.abs(x.plan.metres - x.stored) > 0.005);
  const blank = done.filter(x => !(x.stored > 0));
  const zeroWaste = done.filter(x => x.plan.waste < 0.005);
  const noPanels = done.filter(x => x.plan.panels === 1 && !ptPrintRuleOf(x.row));

  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Cloth per piece</span>
      <span class="kpiwhen">${PT_MARGIN_IN}" stitching margin, then the roll that wastes least across its width</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">SKUs shown</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(done.length)}</div><div class="l">Worked out</div></div>
      <div class="metric"><div class="v"${blocked.length ? ' style="color:var(--bad)"' : ''}>${nf(blocked.length)}</div><div class="l">Cannot be worked out</div></div>
      <div class="metric"><div class="v">${nf(blank.length)}</div><div class="l">No figure stored yet</div></div>
      <div class="metric"><div class="v">${nf(changed.length)}</div><div class="l">Would change</div></div>
      <div class="metric"><div class="v">${nf(zeroWaste.length)}</div><div class="l">At 0% waste</div></div>
    </div>
    <div class="muted" style="margin-top:8px;font-size:12px">A front and a back are two rectangles, not
      one. Where an article takes more than one panel, put the number on <b>Masters → Printing rule</b>
      — until it is there, the figure below is for a single rectangle${noPanels.length
        ? `, which is what ${nf(noPanels.length)} of these still are` : ''}.</div>
  </div>`;

  const head = '<thead><tr>' + ['SKU', 'Article', 'Size', 'Raw cut', 'Off which roll', 'Across', 'Waste',
    'Panels', 'Cloth a piece', 'Stored now', 'Change'].map((h, i) =>
    `<th${i === 0 ? ' class="frz"' : ([5, 6, 7, 8, 9, 10].indexOf(i) >= 0 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';

  const m3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
  $('ptmTable').innerHTML = head + '<tbody>' + (rows.length ? rows.slice(0, 600).map(x => {
    const r = x.row, p = x.plan;
    if (p.why) {
      return `<tr><td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.sku)}</td>`
        + `<td style="text-align:left">${esc(r.subtype || r.articleType || '—')}</td>`
        + `<td>${esc(r.size) || '<span class="muted">—</span>'}</td>`
        + `<td colspan="7" class="err" style="text-align:left">${esc(p.why)}</td>`
        + `<td class="num">${x.stored > 0 ? m3(x.stored) : '<span class="muted">—</span>'}</td></tr>`;
    }
    const d = p.metres - x.stored;
    const big = x.stored > 0 && Math.abs(d) > 0.25 * x.stored;
    return '<tr>'
      + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.sku)}</td>`
      + `<td style="text-align:left">${esc(r.subtype || r.articleType || '—')}</td>`
      + `<td>${esc(r.size)}</td>`
      + `<td>${p.cut.w}" × ${p.cut.l}"${p.cut.round ? '<div class="muted" style="font-size:10.5px">from a round</div>' : ''}</td>`
      + `<td style="text-align:left"><b>${esc(p.fabric)}</b> <span class="muted">${p.widthIn}"</span>${
          p.fromRule ? '' : '<div class="muted" style="font-size:10.5px">chosen — nothing said</div>'}${
          p.fromRule && p.best.fabric !== p.fabric && p.best.waste < p.waste - 0.005
            ? `<div class="muted" style="font-size:10.5px">${esc(p.best.fabric)} would waste ${Math.round(p.best.waste * 100)}%</div>` : ''}${
          p.namedUnfit ? `<div class="err" style="font-size:10.5px">${esc(p.named)} is too narrow for this cut</div>` : ''}</td>`
      + `<td class="num">${p.across}${p.turned ? '<div class="muted" style="font-size:10.5px">turned</div>' : ''}${
          p.lay ? `<div class="muted" style="font-size:10.5px">${p.lay === 'width' ? 'width across' : 'length across'}</div>` : ''}</td>`
      + `<td class="num"${p.waste > 0.15 ? ' style="color:var(--bad)"' : (p.waste < 0.005 ? ' style="color:#166534"' : '')}>${Math.round(p.waste * 100)}%</td>`
      + `<td class="num">${p.panels > 1 ? '×' + p.panels : '<span class="muted">1</span>'}</td>`
      + `<td class="num"><b>${m3(p.metres)}</b> m</td>`
      + `<td class="num">${x.stored > 0 ? m3(x.stored) : '<span class="muted">none</span>'}</td>`
      + `<td class="num"${big ? ' style="color:var(--bad)"' : ''}>${x.stored > 0
          ? (d >= 0 ? '+' : '') + m3(d) : '<span class="muted">—</span>'}</td>`
      + '</tr>';
  }).join('') : `<tr><td colspan="11" class="muted" style="padding:16px">Nothing matches.</td></tr>`) + '</tbody>';

  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = rows.length > 600
    ? `Showing the first 600 of ${nf(rows.length)}. Apply works on all ${nf(rows.length)}.` : '';
}

/** Write the worked-out figures onto the SKUs on screen — after saying what that would do. */
async function mdbConsApply() {
  if (!ptCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = PT_NO_EDIT; return; }
  const rows = (PT._consRows || []).filter(x => !x.plan.why);
  const change = rows.filter(x => Math.abs(x.plan.metres - x.stored) > 0.005);
  if (!change.length) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Nothing to change — every SKU on screen already carries the worked-out figure.'; return; }
  const blank = change.filter(x => !(x.stored > 0)).length;
  const big = change.filter(x => x.stored > 0 && Math.abs(x.plan.metres - x.stored) > 0.25 * x.stored);

  ptOpenDialog({
    title: 'Write the worked-out cloth onto these SKUs?',
    subtitle: `${nf(change.length)} SKU(s) would change`,
    note: `${nf(blank)} have no figure at all today. ${nf(big.length)} would move by more than a quarter — `
      + (big.length ? big.slice(0, 5).map(x => `${x.row.sku} ${x.stored} → ${x.plan.metres}`).join(', ')
        + (big.length > 5 ? ` and ${nf(big.length - 5)} more` : '') : 'none')
      + '. Everything else on the master row is left exactly as it is.',
    fields: [],
    saveLabel: 'Write them',
    onSave: async () => {
      const upd = {};
      change.forEach(x => { if (x.row._key) upd['pt_masterDB/' + x.row._key + '/consumption'] = mdbM2(x.plan.metres); });
      const missing = change.filter(x => !x.row._key).length;
      if (!Object.keys(upd).length) return 'None of these rows has a key to write to.';
      try { await ptPatch(upd); } catch (e) { return 'Not written: ' + (e.message || e); }
      change.forEach(x => { if (x.row._key) x.row.consumption = mdbM2(x.plan.metres); });
      MDB_IX = { src: null, n: -1, map: null };
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(change.length - missing)} SKU(s) updated.`
        + (missing ? ` ${nf(missing)} had no key and were left alone.` : '');
      return '';
    },
  });
}

/**
 * WHAT EACH VIEW CAN DO, and therefore what it shows.
 *
 * Every control on this toolbar, named once per view. Anything missing from a view's list is hidden
 * on it — which is the whole point: the old code toggled a few ids at a time and left the rest
 * wherever the previous view had put them.
 *
 * The buttons that change data appear only for somebody who may change it; the rest are for reading
 * and are always there.
 */
const PMDB_TOOLS = {
  master: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmNew', 'ptmAsin', 'ptmImgs', 'ptmClear', 'ptmTemplate', 'ptmTplShort', 'ptmImport', 'ptmRename', 'ptmCustFix', 'ptmExport', 'ptmGo'],
  /* A one-off item never amends the real catalogue, so Change SKU — which rewrites a code across
   * every register — is not offered from here. */
  custom: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmNew', 'ptmLookalike', 'ptmImgs', 'ptmClear', 'ptmTemplate', 'ptmTplShort', 'ptmImport', 'ptmExport', 'ptmGo'],
  /* The printer's cloth is grouped by fabric and colour; article and size say nothing about it. */
  fabric: ['ptmBrandFs', 'ptmDir', 'ptmCol', 'ptmQ', 'ptmNew', 'ptmTemplate', 'ptmImport', 'ptmClear', 'ptmExport', 'ptmGo'],
  cons: ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
    'ptmConsApply', 'ptmClear', 'ptmExport', 'ptmGo'],
  /* A recipe has no brand, no colour and no picture. Its key is the three boxes that are left. */
  recipe: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmRecSeed', 'ptmRecApply',
    'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmExport', 'ptmGo'],
  /* The base codes are per article, subtype and size; the colour is picked on the screen itself. */
  skucode: ['ptmArt', 'ptmSub', 'ptmSz', 'ptmQ', 'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmExport', 'ptmGo'],
};
/** The ones that write, so they are shown only to somebody who may. */
const PMDB_WRITES = ['ptmNew', 'ptmLookalike', 'ptmAsin', 'ptmImport', 'ptmRename', 'ptmCustFix', 'ptmConsApply', 'ptmRecSeed', 'ptmRecApply'];
/* NAMED OUTRIGHT, not gathered from the lists above. Derived from them, a control dropped from
 * every view fell out of this set and so was never hidden — it stayed wherever the last view left
 * it, which is the very thing this function exists to stop. */
const PMDB_ALL = ['ptmTplShort', 'ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ',
  'ptmBrandFs', 'ptmDir', 'ptmConsApply', 'ptmRecSeed', 'ptmRecApply', 'ptmNew', 'ptmLookalike', 'ptmCustFix', 'ptmAsin', 'ptmImgs',
  'ptmClear', 'ptmTemplate', 'ptmImport', 'ptmRename', 'ptmExport', 'ptmGo'];

function pmdbTools(view) {
  const on = PMDB_TOOLS[view] || PMDB_TOOLS.master;
  if ($('ptmNew')) $('ptmNew').textContent = view === 'fabric' ? '+ Fabric SKU' : '+ New SKU';
  PMDB_ALL.forEach(id => {
    const el = $(id); if (!el) return;
    const show = on.indexOf(id) >= 0 && !(PMDB_WRITES.indexOf(id) >= 0 && !mdbCanEdit());
    el.classList.toggle('hide', !show);
  });
  /* Template and Import belong to whichever view is open, so they say which one. */
  const rec = view === 'recipe', skc = view === 'skucode';
  if ($('ptmTemplate')) $('ptmTemplate').textContent = rec ? 'Recipe template' : skc ? 'Base code template' : 'Template';
  if ($('ptmImport')) $('ptmImport').textContent = rec ? 'Upload recipes' : skc ? 'Upload base codes' : 'Import';
}

function renderPmdb() {
  if (PT.busy.mdb) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the production database…'; ptEmpty('ptmTable', 'Loading…'); return; }
  if (PT.err.mdb) {
    $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read it: ' + PT.err.mdb;
    ptEmpty('ptmTable', 'Nothing to show.'); $('ptmKpis').innerHTML = ''; return;
  }
  /* The printer's cloth is worked out rather than stored, so it has its own drawing — and the two
   * filters only it needs appear with it and go away again. */
  const view = ($('ptmView') || {}).value || 'master';
  pmdbTools(view);
  if (view === 'recipe') return renderMdbRecipe();
  if (view === 'skucode') return renderSkuCode();
  if (view === 'fabric') return renderMdbFabric();
  if (view === 'cons') return renderMdbCons();

  const custom = $('ptmView') && $('ptmView').value === 'custom';
  if (custom && MDBX.busy) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = 'Reading the custom SKUs…'; ptEmpty('ptmTable', 'Loading…'); return; }
  if (custom && MDBX.err) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = 'Could not read the custom SKUs: ' + MDBX.err; ptEmpty('ptmTable', 'Nothing to show.'); $('ptmKpis').innerHTML = ''; return; }
  const all = (custom ? (MDBX.custom || []) : (PT.mdb || []));
  if (!all.length) { $('ptmMsg').className = 'muted'; $('ptmMsg').textContent = ''; $('ptmKpis').innerHTML = ''; ptEmpty('ptmTable', custom ? 'No custom SKUs.' : 'The master database is empty.'); return; }

  const f = pmdbFilters();
  ptFill('ptmBrand', pmdbApply(all, f, 'brand').map(r => r.brand), 'All brands');
  ptFill('ptmArt', pmdbApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('ptmSub', pmdbApply(all, f, 'sub').map(r => r.subtype), 'All subtypes');
  ptFill('ptmCol', pmdbApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('ptmSz', pmdbApply(all, f, 'sz').map(r => r.size), 'All sizes');

  const rows = pmdbApply(all, f).sort((a, b) => String(a.sku || '').localeCompare(String(b.sku || '')));
  PT._pmdbRows = rows;

  const cnt = p => rows.filter(p).length;
  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Master Database</span>
      <span class="kpiwhen">read live${PT.at.mdb ? ' · ' + esc(PT.at.mdb) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">SKUs shown</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.articleType || '').trim()).filter(Boolean)).size)}</div><div class="l">Article types</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.color || '').trim()).filter(Boolean)).size)}</div><div class="l">Colors</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.cuttingRequired))}</div><div class="l">Cutting required</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.isZip))}</div><div class="l">With zip</div></div>
      <div class="metric"><div class="v">${nf(cnt(r => r.isRuffle))}</div><div class="l">Ruffle</div></div>
      ${(n => n ? `<div class="metric" title="Ruffle SKUs whose metres are neither on the SKU nor in its recipe — fill Ruffle metres and fabric in the Recipe for that article · subtype · size"><div class="v" style="color:var(--bad)">${nf(n)}</div><div class="l">Ruffle, no metres</div></div>` : '')(cnt(r => r.isRuffle && !ptRuffleOf(r)))}
      <div class="metric"><div class="v">${nf(cnt(r => r.fillerFabricRequired))}</div><div class="l">Needs filler</div></div>
      ${(n => `<div class="metric" title="SKUs with no ASIN yet. ASIN from Amazon fills the ones Amazon lists; the rest are not on Amazon."><div class="v"${n ? ' style="color:var(--bad)"' : ''}>${nf(n)}</div><div class="l">No ASIN</div></div>`)(cnt(r => !String(r.asin || '').trim()))}
    </div></div>`;

  const yn = v => v ? '<span class="pill pill-ok">Yes</span>' : '<span class="muted">—</span>';
  const head = '<thead><tr>' + ['SKU', 'Image', 'ASIN', 'Parent ASIN', 'Brand', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Consumption', 'Pack of', 'Cutting', 'Zip', 'Ruffle', 'Piping', 'Filler', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 10 || i === 11 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const asinCell = v => String(v || '').trim() ? `<td style="font-family:ui-monospace,monospace">${esc(v)}</td>` : '<td><span class="muted">—</span></td>';
  const zipCell = r => !r.isZip ? '<span class="muted">—</span>'
    : `<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">${nf(mdbZipQty(r))} × ${esc(r.chainLength == null ? '?' : r.chainLength)}"</div>`;
  const pipCell = r => !r.isPiping ? '<span class="muted">—</span>'
    : `<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">${r.pipingMeters == null ? '?' : esc(r.pipingMeters)}m dori</div>`;
  /* What the cutting issue and the demand will use — the SKU's own figures, else its recipe — and a word
   * saying which, so a figure that is not typed on the SKU is not mistaken for one that is. */
  const rufCell = r => {
    if (!r.isRuffle) return '<span class="muted">—</span>';
    const u = ptRuffleOf(r);
    const txt = u ? mdbM2Txt(u.meters) + 'm · ' + esc(u.fabric) + (u.from === 'sku' ? '' : ' <span title="Not typed on this SKU — taken from its ' + u.from + '">(' + u.from + ')</span>')
      : '<span style="color:var(--bad)" title="Neither this SKU nor a recipe for ' + esc([r.articleType, r.subtype, r.size].filter(Boolean).join(' · '))
        + ' gives ruffle metres and fabric. Fill them in Recipe.">' + (recipeOf(r) ? 'recipe has no ruffle' : 'no recipe') + '</span>';
    return '<span class="pill pill-ok">Yes</span><div class="muted" style="font-size:11px;margin-top:2px">' + txt + '</div>';
  };
  const body = rows.slice(0, PMDB_MAX).map(r => '<tr>'
    + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku, 44)
    + asinCell(r.asin) + asinCell(r.parentAsin)
    + `<td>${esc(r.brand)}</td><td>${esc(r.articleType)}</td><td>${esc(r.subtype)}</td>`
    + `<td>${esc(r.color)}</td><td>${esc(r.size)}</td><td>${esc(r.fabric)}</td>`
    + `<td class="num">${mdbM2Txt(r.consumption) === '' ? '<span class="muted">—</span>' : esc(mdbM2Txt(r.consumption))}</td>`
    + `<td class="num">${esc(r.packOf)}</td><td>${yn(r.cuttingRequired)}</td><td>${zipCell(r)}</td>`
    + `<td>${rufCell(r)}</td><td>${pipCell(r)}</td><td>${yn(r.fillerFabricRequired)}</td>`
    + `<td>${custom ? '<span class="muted">—</span>'
      : `<button class="ghost" data-mdb-edit="${esc(r.sku)}" style="padding:3px 10px;font-size:12px">Edit</button>`}</td></tr>`).join('');
  $('ptmTable').innerHTML = head + '<tbody>' + body + '</tbody>';

  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} SKU(s)`
    + (rows.length > PMDB_MAX ? ` · showing the first ${PMDB_MAX} · Export covers all of them` : '')
    + (custom ? ' · custom SKUs, kept apart from the catalogue.' : '')
    + (MDBIMG.msg ? ' · ' + MDBIMG.msg : '');
}

