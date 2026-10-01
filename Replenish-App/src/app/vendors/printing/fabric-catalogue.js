/* ================= THE PRINTER'S FABRIC CATALOGUE =================
 *
 * One line per colour, base fabric, width and print direction — the cloth a printer is actually sent,
 * with the SKU worked out rather than typed, and a picture from the product it belongs to so the
 * printer can see what they are printing.
 */

/** The shapes on offer. Cambric carries no width or direction; sheeting carries both. */
const FS_BRANDS = [
  { key: 'CPC', name: 'CPC', cambric: 'CPCF', sheeting: 'CPCSF' },
  { key: 'RBP', name: 'Ridhi', cambric: 'RBP', sheeting: 'RBPSF' },
];
const FS_WIDTHS = ['62', '72', '82', '92', '112'];
const FS_DIRS = [['V', 'Vertical'], ['H', 'Horizontal']];
/* Voil (quilt cloth) and canvas, by brand. Only the brands listed here have them. */
/* CPC follows its own quilt SKUs (CPCQ005-Q, CPCQ005-T) as Ridhi's fabric follows RQL (2026-09-22). */
const FS_QUILT = { RBP: { voil: 'RQL', canvas: 'RBP-CANVAS-' }, CPC: { voil: 'CPCQ', canvas: 'CPC-CANVAS-' } };
/* The only voil widths and directions made, and the quilt size letter each is cut for. */
const FS_VOIL = [['92', 'Horizontal', 'T'], ['92', 'Vertical', 'Q'], ['112', 'Horizontal', 'K']];
const FS_SIDES = ['Front', 'Back'];

/** Which brand family a product SKU belongs to — the colour codes are only unique inside one. */
const fsFamily = prefix => (/^CPC/.test(prefix) ? 'CPC' : (/^R/.test(prefix) ? 'RBP' : ''));
/** The colour code inside a product SKU: the letters, then the digits. */
function fsCodeOf(sku) {
  const m = String(sku || '').trim().toUpperCase().match(/^([A-Z]+)(\d{1,4})/);
  if (!m) return null;
  const fam = fsFamily(m[1]);
  return fam ? { family: fam, code: m[2] } : null;
}

/**
 * Every colour code the master database knows, and what colour it means.
 *
 * A CODE CAN DISAGREE WITH ITSELF. 004 is Emerald Green on 82 rows and Agate Green on one; 351 is
 * Dark Salmon Pink on 60 and two other colours on eleven. The commonest wins and the rest are
 * reported, because a catalogue generated from a wrong reading is worse than one that says which
 * lines to look at.
 */
function fsColourCodes() {
  const by = new Map();
  (PTG.mdb || []).forEach(r => {
    const c = fsCodeOf(r && r.sku);
    const col = String((r && r.color) || '').trim();
    if (!c || !col) return;
    const k = c.family + '|' + c.code;
    let g = by.get(k);
    if (!g) g = { family: c.family, code: c.code, colours: new Map(), skus: [] }, by.set(k, g);
    g.colours.set(col, (g.colours.get(col) || 0) + 1);
    if (g.skus.length < 6) g.skus.push(r.sku);
  });
  return [...by.values()].map(g => {
    const sorted = [...g.colours.entries()].sort((a, b) => b[1] - a[1]);
    return {
      family: g.family, code: g.code,
      colour: sorted[0][0], rows: sorted[0][1],
      /* Named so the disagreement can be looked at, not hidden. */
      alsoCalled: sorted.slice(1).map(([c, n]) => c + ' ×' + n),
      skus: g.skus,
    };
  }).sort((a, b) => a.family.localeCompare(b.family)
    || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

/** The SKU for one line of the catalogue, built the way Ravi's sheet builds it. */
function fsSku(brandKey, code, fabric, dir, side) {
  const b = FS_BRANDS.find(x => x.key === brandKey);
  if (!b || !code) return '';
  if (String(fabric).toUpperCase() === 'CAMBRIC') return b.cambric + code;
  const q = FS_QUILT[brandKey];
  if (/^CANVAS$/i.test(String(fabric).trim())) return q ? q.canvas + code : '';
  if (/^VOIL/i.test(String(fabric).trim())) {
    const w = String(fabric).replace(/[^0-9]/g, '');
    const v = FS_VOIL.find(x => x[0] === w && x[1] === dir);
    const sd = FS_SIDES.find(x => x.toLowerCase() === String(side || '').toLowerCase());
    return q && v && sd ? q.voil + code + '-' + v[2] + '-' + sd : '';
  }
  const w = String(fabric).replace(/[^0-9]/g, '');
  if (!w) return '';
  return b.sheeting + code + '-' + (dir === 'Horizontal' ? 'H' : 'V') + '-' + w;
}

/**
 * The whole catalogue for one colour code: cambric, then every width, each way up.
 *
 * ELEVEN LINES PER COLOUR. Cambric has one — cloth that is not sheeting has no width to print across
 * — and each of the five sheeting widths is printed vertically or horizontally.
 */
function fsLinesFor(brandKey, code, colour) {
  const out = [{ fabric: 'Cambric', width: '', dir: 'Vertical',
    sku: fsSku(brandKey, code, 'Cambric', 'Vertical') }];
  FS_WIDTHS.forEach(w => FS_DIRS.forEach(([, dir]) => {
    out.push({ fabric: 'Sheeting ' + w, width: w, dir, sku: fsSku(brandKey, code, 'Sheeting ' + w, dir) });
  }));
  /* Voil comes as a Front and a Back for each quilt size; canvas is one line, printed vertically. */
  if (FS_QUILT[brandKey]) {
    FS_VOIL.forEach(([w, dir]) => FS_SIDES.forEach(side => {
      out.push({ fabric: 'Voil ' + w, width: w, dir, side, sku: fsSku(brandKey, code, 'Voil ' + w, dir, side) });
    }));
    out.push({ fabric: 'Canvas', width: '', dir: 'Vertical', sku: fsSku(brandKey, code, 'Canvas', 'Vertical') });
  }
  return out.map(l => Object.assign({ brand: brandKey, code, colour }, l));
}

/**
 * A picture for a colour code, taken from a real product in that colour.
 *
 * The printer is not being sent a photograph of cloth — nobody has one. What they need is the design
 * they are printing, and the product photo of anything made in it shows exactly that. The first SKU
 * of that code with a picture on record wins.
 */
function fsImageFor(codeRow) {
  const list = (codeRow && codeRow.skus) || [];
  for (const s of list) { const u = ptImgOf(s); if (u) return { url: u, from: s }; }
  /* Nothing on the six it remembered — look wider before giving up. */
  const c = codeRow && codeRow.code, fam = codeRow && codeRow.family;
  const more = (PTG.mdb || []).filter(r => {
    const k = fsCodeOf(r && r.sku);
    return k && k.code === c && k.family === fam;
  });
  for (const r of more) { const u = ptImgOf(r.sku); if (u) return { url: u, from: r.sku }; }
  return { url: '', from: (more[0] && more[0].sku) || list[0] || '' };
}

/** Every line of the printer's catalogue, for the brands and colours the master database knows. */
function fsRows(filter) {
  const f = filter || {};
  const codes = fsColourCodes();
  const out = [];
  codes.forEach(c => {
    if (f.brand && c.family !== f.brand) return;
    if (f.colour && String(c.colour).toLowerCase() !== String(f.colour).toLowerCase()) return;
    const img = fsImageFor(c);
    fsLinesFor(c.family, c.code, c.colour).forEach(l => {
      if (f.dir && l.dir !== f.dir) return;
      if (f.q) {
        const hay = [l.sku, c.colour, c.code, l.fabric, l.dir].join(' ').toLowerCase();
        if (hay.indexOf(f.q) < 0) return;
      }
      out.push(Object.assign({}, l, { imageUrl: img.url, imageFrom: img.from,
        alsoCalled: c.alsoCalled, brandName: (FS_BRANDS.find(b => b.key === c.family) || {}).name || c.family }));
    });
  });
  /* AND THE ONES ADDED BY HAND (Ravi, 2026-09-25), under the same filters. */
  const built = new Set(out.map(r => r.sku.toUpperCase()));
  fsManual().forEach(r => {
    if (built.has(r.sku)) return;
    if (f.brand && r.brand !== f.brand) return;
    if (f.colour && String(r.colour).toLowerCase() !== String(f.colour).toLowerCase()) return;
    if (f.dir && r.dir !== f.dir) return;
    if (f.q && [r.sku, r.colour, r.code, r.fabric, r.dir, r.note].join(' ').toLowerCase().indexOf(f.q) < 0) return;
    out.push(r);
  });
  return out;
}

/** What one fabric SKU is — the lookup a printing order needs when somebody types a code in. */
function fsOf(sku) {
  const want = String(sku || '').trim().toUpperCase();
  if (!want) return null;
  return fsRows({ q: want.toLowerCase() }).find(r => r.sku.toUpperCase() === want) || null;
}

function renderMdbFabric() {
  const f = {
    brand: $('ptmBrandFs').value, colour: $('ptmCol').value, dir: $('ptmDir').value,
    q: String($('ptmQ').value || '').trim().toLowerCase(),
  };
  const rows = fsRows(f);
  const codes = fsColourCodes();
  const muddled = codes.filter(c => c.alsoCalled.length);
  PTE.fsRows = rows;

  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Fabric for printing</span>
      <span class="kpiwhen">built from the master database · ${nf(codes.length)} colour code(s)</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Fabric SKUs</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => r.code)).size)}</div><div class="l">Colours</div></div>
      <div class="metric"><div class="v">${nf(rows.filter(r => r.imageUrl).length)}</div><div class="l">With a picture</div></div>
      ${muddled.length ? `<div class="metric" title="These codes are used for more than one colour in the master database. The commonest is used here."><div class="v" style="color:#7f6000">${nf(muddled.length)}</div><div class="l">Codes to check</div></div>` : ''}
    </div></div>`;

  const head = '<thead><tr>' + ['Colour code', 'Colour', 'Brand', 'Fabric', 'Print direction', 'SKU', 'Reference']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('ptmTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
    + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.code)}</td>`
    + `<td style="text-align:left">${esc(r.colour)}${r.alsoCalled.length
        ? ` <span class="pill pill-low" title="Also called ${esc(r.alsoCalled.join(', '))} on other rows">check</span>` : ''}</td>`
    + `<td>${esc(r.brandName)}</td>`
    + `<td style="text-align:left">${esc(r.fabric)}${r.side ? ` <span class="muted" style="font-size:11.5px">· ${esc(r.side)}</span>` : ''}</td>`
    + `<td>${esc(r.dir)}</td>`
    + `<td style="text-align:left;font-family:ui-monospace,monospace;font-weight:700">${esc(r.sku)}${r.manual
        ? ` <span class="pill" title="Added by hand${r.note ? ' — ' + esc(r.note) : ''}">added</span>${mdbCanEdit() ? ` <button class="ghost" data-fs-edit="${esc(r.sku)}" style="padding:2px 8px;font-size:11px">Edit</button>` : ''}` : ''}</td>`
    + (r.imageUrl
      ? `<td title="From ${esc(r.imageFrom)}"><img src="${esc(ptImgSrc(r.imageUrl, 38))}" alt="" loading="lazy"
           style="width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"></td>`
      : '<td class="muted">—</td>')
    + '</tr>').join('') + '</tbody>';

  $('ptmMsg').className = muddled.length ? 'err' : 'muted';
  $('ptmMsg').textContent = `${nf(rows.length)} fabric SKU(s) · ${nf(codes.length)} colour code(s) · `
    + 'cambric, five sheeting widths each way up, voil (front and back) and canvas'
    + (muddled.length ? ` · ${nf(muddled.length)} code(s) are used for more than one colour in the master database — the commonest is shown, marked "check"` : '');
  /* The pictures come from the products, so ask for the ones that are still unknown. */
  ptImgFill(rows.slice(0, 600).map(r => r.imageFrom).filter(Boolean), false, ptImgPatch);
}

/* ---------------- Cutting Data ---------------- */

async function ensurePcut() { if (PT.cut === null) await ptLoad('cut', 'pt_cuttingData', renderPcut); else renderPcut(); }

function pcutFilters() {
  const v = id => ($(id) || {}).value || '';
  return { art: v('pcArt'), sub: v('pcSub'), col: v('pcCol'), sz: v('pcSz'),
    ord: v('pcOrd'), q: v('pcQ').trim().toLowerCase(), d1: v('pcD1'), d2: v('pcD2'), who: v('pcWho') };
}

function pcutApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'ord' && f.ord && !ptCi(r.orderNo, f.ord)) return false;
    if (skip !== 'who' && f.who && whoTouched(r).indexOf(String(f.who).toLowerCase()) < 0) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size, r.orderNo, r.fabricWidth].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (skip !== 'date' && f.d1) { const d = ptDate(r.cutDate); if (!d || d < new Date(f.d1 + 'T00:00:00')) return false; }
    if (skip !== 'date' && f.d2) { const d = ptDate(r.cutDate); if (!d || d > new Date(f.d2 + 'T23:59:59')) return false; }
    return true;
  });
}

function renderPcut() {
  $('pcMore').innerHTML = '';
  if (PT.busy.cut) { $('pcMsg').className = 'muted'; $('pcMsg').textContent = 'Reading the production database…'; ptEmpty('pcTable', 'Loading…'); return; }
  if (PT.err.cut) {
    $('pcMsg').className = 'err'; $('pcMsg').textContent = 'Could not read it: ' + PT.err.cut;
    ptEmpty('pcTable', 'Nothing to show.'); $('pcKpis').innerHTML = ''; return;
  }
  const all = PT.cut || [];
  if (!all.length) { $('pcMsg').className = 'muted'; $('pcMsg').textContent = ''; $('pcKpis').innerHTML = ''; ptEmpty('pcTable', 'No cutting entries.'); return; }

  const f = pcutFilters();
  ptFill('pcArt', pcutApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('pcSub', pcutApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('pcCol', pcutApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('pcSz', pcutApply(all, f, 'sz').map(r => r.size), 'All sizes');
  ptFill('pcOrd', pcutApply(all, f, 'ord').map(r => r.orderNo), 'All orders');
  ptFill('pcWho', whoList(pcutApply(all, f, 'who')), "Anyone's entry");

  const rows = pcutApply(all, f).sort((a, b) => {
    const d = ptDtMs(b.cutDate) - ptDtMs(a.cutDate);
    return d || String(b.id || '').localeCompare(String(a.id || ''));
  });
  PT._pcutRows = rows;

  const pieces = rows.reduce((s, r) => s + ptNum(r.pieces), 0);
  $('pcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Cutting Data</span>
      <span class="kpiwhen">read live${PT.at.cut ? ' · ' + esc(PT.at.cut) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Cut entries</div></div>
      <div class="metric"><div class="v">${nf(pieces)}</div><div class="l">Pieces cut</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.sku || '').trim().toUpperCase()).filter(Boolean)).size)}</div><div class="l">SKUs</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.orderNo || '').trim()).filter(Boolean)).size)}</div><div class="l">Orders</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.fabricWidth || '').trim()).filter(Boolean)).size)}</div><div class="l">Fabrics</div></div>
      ${(() => {
        /* COUNTED OVER THE ENTRIES THAT CARRY A FIGURE, and the rest are named rather than averaged
         * in as nought — a waste rate worked out over entries nobody measured is not a waste rate. */
        const meas = rows.filter(r => ptNum(r.fabricUsed) > 0);
        const used = meas.reduce((a, r) => a + ptNum(r.fabricUsed), 0);
        const waste = meas.reduce((a, r) => a + ptNum(r.fabricWaste), 0);
        const pct = used > 0 ? (waste / used) * 100 : 0;
        return `<div class="metric"><div class="v">${used ? nf(Math.round(used)) : '—'}</div><div class="l">Fabric used (m)</div></div>
          <div class="metric"><div class="v"${pct > 10 ? ' style="color:var(--bad)"' : ''}>${waste ? nf(Math.round(waste * 10) / 10) : '—'}</div><div class="l">Waste (m)${
            used ? ' · ' + pct.toFixed(1) + '%' : ''}</div></div>
          <div class="metric"><div class="v"${meas.length < rows.length ? ' style="color:var(--muted)"' : ''}>${nf(meas.length)} / ${nf(rows.length)}</div><div class="l">Entries measured</div></div>`;
      })()}
    </div></div>`;

  const head = '<thead><tr>' + ['Cut Date', 'Order No', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Pieces', 'Fabric used (m)', 'Waste (m)', 'Waste width (in)', 'Waste %', 'Remarks', 'Entered by', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([9, 10, 11, 12, 13].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const shown = rows.slice(0, PC_CAP);
  const body = shown.map(r => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(r.cutDate)}</td>`
    + `<td style="text-align:left">${esc(r.orderNo) || '<span class="muted">—</span>'}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku)
    + `<td>${esc(r.articleType)}</td><td>${esc(r.articleSubtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
    + `<td>${esc(r.fabricWidth)}</td><td class="num" style="font-weight:700">${nf(ptNum(r.pieces))}</td>`
    /* MEASURED OR NOT MEASURED. An entry nobody measured shows a dash, never a nought — the two
     * would add up identically and mean opposite things. */
    + (u => `<td class="num">${u > 0 ? nf(u) : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricUsed))
    + (w => `<td class="num">${w > 0 ? nf(w) : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricWaste))
    /* HOW WIDE what is left is: wide enough to cut from, or rag. */
    + (x => `<td class="num">${x > 0 ? nf(x) + '"' : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricWasteWidth))
    + ((u, w) => `<td class="num"${u > 0 && w / u > 0.1 ? ' style="color:var(--bad)"' : ''}>${
        u > 0 && w > 0 ? ((w / u) * 100).toFixed(1) + '%' : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricUsed), ptNum(r.fabricWaste))
    + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
    + whoCell(r)
    + `<td>${ptCanEdit() ? `<button class="ghost" data-cut-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>`
      : '<span class="muted">—</span>'}</td></tr>`).join('');
  $('pcTable').innerHTML = head + '<tbody>' + body + '</tbody>';

  $('pcMsg').className = 'muted';
  $('pcMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} cut entr${all.length === 1 ? 'y' : 'ies'}`
    + (rows.length > PC_CAP ? ` · showing the newest ${nf(PC_CAP)} · Export covers all of them` : '');
  $('pcMore').innerHTML = ptMoreBtn('data-pcmore', rows.length, PC_CAP);
  ptImgFill(shown.map(r => r.sku), false, ptIfTab('pcut', renderPcut));
}

/* ---------------- wiring ---------------- */

['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut'].forEach(id => $(id).addEventListener('change', renderPmdb));
['pbType', 'pbEmp', 'pbArt', 'pbSub', 'pbCol', 'pbSz', 'pbStatus', 'pbDBy', 'pbD1', 'pbD2'].forEach(id => $(id).addEventListener('change', renderPbase));
['pcArt', 'pcSub', 'pcCol', 'pcSz', 'pcOrd', 'pcD1', 'pcD2'].forEach(id => $(id).addEventListener('change', renderPcut));
/* The cloth the cut costs follows the pieces and the SKU as they are typed. renderCutFab, NOT
 * renderCutForm: the form rebuilds four dropdowns off the master list, and doing that on every
 * keystroke of a piece count is what made the Job Work form lag. */
['cwPcs', 'cwSku'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', renderCutFab); });
['cwAt', 'cwSub', 'cwCol', 'cwSz'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', renderCutFab); });
/* A figure somebody types wins over the one worked out, until the form is cleared. */
['cwUsed', 'cwWaste', 'cwWasteW'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { el.dataset.typed = String(el.value).trim() ? '1' : ''; renderCutFab(); });
});

/* Typing a filter would otherwise re-render a 4,500-row table on every keystroke. */
function ptDebounce(id, fn) {
  let t = null;
  $(id).addEventListener('input', () => { clearTimeout(t); t = setTimeout(fn, 220); });
}
ptDebounce('ptmQ', renderPmdb); ptDebounce('pbQ', renderPbase); ptDebounce('pcQ', renderPcut);

$('ptmClear').onclick = () => { ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ'].forEach(id => $(id).value = ''); renderPmdb(); };
if ($('audGo')) {
  $('audGo').onclick = () => audLoad();
  $('audView').onchange = () => { if ($('audView').value === 'bin' ? !AUD.bin : !AUD.rows) audLoad(); else audRender(); };
  $('audQ').addEventListener('input', () => audRender());
  $('audBody').addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('[data-aud-restore]'); if (!b) return;
    const id = b.getAttribute('data-aud-restore');
    const t = (AUD.bin || []).find(x => x._id === id);
    if (!confirm('Put this record back?\n\n' + (t ? audWhat(t.path, t.value) : id))) return;
    b.disabled = true;
    const err = await auditRestore(id);
    if (err) { $('audMsg').className = 'err'; $('audMsg').textContent = err; b.disabled = false; return; }
    if (t) t.restoredAt = new Date().toISOString();
    audRender();
    $('audMsg').className = 'muted'; $('audMsg').textContent = 'Restored. The screen it belongs to shows it after its next refresh.';
  });
}
/* MOVE COMPLETED ENTRIES (admins; core/job-work-split.js). Nothing leaves any screen: the register is still read as one. */
if ($('pbArchive')) $('pbArchive').onclick = async () => {
  const plan = baseArchivePlan(PT.base || []);
  if (!plan.rows.length) { $('pbMsg').className = 'muted'; $('pbMsg').textContent = 'Nothing to move: no complete entry came back more than ' + BASE_MOVE_AFTER_DAYS + ' days ago.'; return; }
  const per = Object.entries(plan.byMonth).map(([m, l]) => m + ': ' + nf(l.length)).join(', ');
  if (!confirm(`Move ${nf(plan.rows.length)} complete entries to the completed section (${per})?\n\n`
    + 'They stay on every screen, in every total, payout and report. Only where they are kept changes, so they are no '
    + 'longer downloaded on every page load. Their orders are not touched.')) return;
  $('pbArchive').disabled = true;
  try {
    const res = await baseArchiveRun((n, all) => { $('pbMsg').className = 'muted'; $('pbMsg').textContent = `Moving… ${nf(n)} of ${nf(all)}`; });
    if (res.err) { $('pbMsg').className = 'err'; $('pbMsg').textContent = res.err; return; }
    await ptLoad('base', 'pt_baseData', renderPbase);
    $('pbMsg').className = 'muted';
    $('pbMsg').textContent = `${nf(res.moved)} complete entries moved to the completed section (${res.months.join(', ')}). Every screen still shows them.`;
  } catch (e) {
    $('pbMsg').className = 'err'; $('pbMsg').textContent = 'Stopped: ' + (e.message || e) + ' — whatever moved before this is safe in the completed section; press again to carry on.';
  } finally { $('pbArchive').disabled = false; }
};
$('pbMore').addEventListener('click', e => { if (!e.target.closest('[data-pbmore]')) return; PB_CAP += PT_CAP_STEP; renderPbase(); });
$('pcMore').addEventListener('click', e => { if (!e.target.closest('[data-pcmore]')) return; PC_CAP += PT_CAP_STEP; renderPcut(); });
$('pbClear').onclick = () => { ['pbType', 'pbEmp', 'pbWho', 'pbArt', 'pbSub', 'pbCol', 'pbSz', 'pbStatus', 'pbQ', 'pbDBy', 'pbD1', 'pbD2'].forEach(id => $(id).value = ''); PT_BD_KPI = ''; renderPbase(); };
$('pcClear').onclick = () => { ['pcArt', 'pcSub', 'pcCol', 'pcSz', 'pcOrd', 'pcWho', 'pcQ', 'pcD1', 'pcD2'].forEach(id => $(id).value = ''); renderPcut(); };

/* REFRESH READS THE RECIPES TOO (2026-09-25). Ruffle, zip and cloth figures fall back to the recipe; a recipe
 * uploaded after this screen was opened (another tab, another person) was never seen until a full reload. */
async function pmdbRefresh() {
  try { const m = await ptGet('pt_masters'); if (m) { PTG.masters = m; PTG.recipeAt = Date.now(); RECIPE_IX = { src: null, map: null }; } } catch (e) { /* the SKUs still load */ }
  await ptLoad('mdb', 'pt_masterDB', renderPmdb);
  /* ONE ARRAY, TWO NAMES — as ensurePmdb keeps them. A refresh that set only PT.mdb left every other screen on
   * the old rows, and without mdbYnFix the "yes" text rows read differently here than everywhere else. */
  if (!PT.err.mdb && PT.mdb) { PT.mdb = PT.mdb.map(mdbYnFix); PTG.mdb = PT.mdb; renderPmdb(); }
}
$('ptmGo').onclick = () => pmdbRefresh();
$('pbGo').onclick = () => ptLoad('base', 'pt_baseData', renderPbase);
$('pcGo').onclick = () => ptLoad('cut', 'pt_cuttingData', renderPcut);

/* The KPI cards are written with innerHTML, and this file is a module — an inline onclick would be
 * looking for a global that does not exist. Delegated instead. */
function pbKpiClick(e) {
  const el = e.target.closest('.pt-kpi'); if (!el) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (e.type === 'keydown') e.preventDefault();
  const k = el.getAttribute('data-kpi') || '';
  PT_BD_KPI = (PT_BD_KPI === k) ? '' : k;
  renderPbase();
}
$('pbKpis').addEventListener('click', pbKpiClick);
$('pbKpis').addEventListener('keydown', pbKpiClick);

$('ptmExport').onclick = () => {
  /* The recipes are their own table and export as themselves — the SKU export would hand back 4,730
   * rows when 319 are on screen. */
  if (($('ptmView') || {}).value === 'recipe') {
    const rows = recipeSheetRows();
    if (rows.length < 2) return;
    ptDownload('recipes', rows.map(r => r.map(csvCell).join(',')));
    return;
  }
  if (($('ptmView') || {}).value === 'skucode') {
    const rows = skcSheetRows();
    if (rows.length < 2) return;
    ptDownload('sku-codes' + (SKC.code ? '-' + SKC.code : ''), rows.map(r => r.map(csvCell).join(',')));
    return;
  }
  const rows = PT._pmdbRows || []; if (!rows.length) return;
  const lines = [['SKU', 'Brand', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Consumption', 'Pack of',
    'Cutting required', 'Zip', 'Zips per piece', 'Zip size', 'Ruffle', 'Ruffle metres', 'Ruffle fabric', 'Piping dori', 'Piping dori metres',
    'Filler fabric', 'Filling qty', 'Valuation price', 'Image', 'ASIN', 'Parent ASIN'].map(csvCell).join(',')];
  const b = v => v ? 'Yes' : 'No';
  rows.forEach(r => lines.push([r.sku, r.brand, r.articleType, r.subtype, r.color, r.size, r.fabric,
    mdbM2(r.consumption), r.packOf, b(r.cuttingRequired),
    b(r.isZip), r.isZip ? mdbZipQty(r) : '', r.isZip ? r.chainLength : '',
    b(r.isRuffle), r.isRuffle ? r.ruffleMeters : '', r.isRuffle ? r.ruffleFabric : '',
    b(r.isPiping), r.isPiping ? r.pipingMeters : '',
    b(r.fillerFabricRequired), r.fillerFabricRequired && r.standardFillingQty != null ? r.standardFillingQty : '',
    r.inventoryValuationPrice == null ? '' : r.inventoryValuationPrice, r.imageUrl || MDBIMG.map[obUC(r.sku)] || '',
    r.asin || '', r.parentAsin || '']
    .map(csvCell).join(',')));
  ptDownload('master-database', lines);
};

$('pbExport').onclick = () => {
  const rows = PT._pbaseRows || []; if (!rows.length) return;
  const lines = [['Issue Date', 'Employee', 'Employment type', 'SKU', 'Article', 'Subtype', 'Color', 'Size',
    'Issued', 'Received', 'Rejected', 'Pending', 'Receiving Date', 'Status', 'Remarks', 'Entered by'].map(csvCell).join(',')];
  rows.forEach(r => lines.push([r.issueDate, r.empName, r.empType, r.sku, r.articleType, r.articleSubtype,
    r.color, r.size, ptNum(r.issuePieces), ptNum(r.receivedPieces), ptNum(r.rejectionPieces), ptNum(r.pendingPieces),
    r.receivingDate, r.frozen ? 'Done' : 'Open', r.remarks, r.addedBy].map(csvCell).join(',')));
  ptDownload('base-data', lines);
};

$('pcExport').onclick = () => {
  const rows = PT._pcutRows || []; if (!rows.length) return;
  const lines = [['Cut Date', 'Order No', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Pieces',
    'Fabric used (m)', 'Waste (m)', 'Waste width (in)', 'Waste %', 'Remarks', 'Entered by'].map(csvCell).join(',')];
  rows.forEach(r => {
    /* Blank where nobody measured, so a spreadsheet cannot average a missing figure as a nought. */
    const u = ptNum(r.fabricUsed), w = ptNum(r.fabricWaste);
    const ww = ptNum(r.fabricWasteWidth);
    lines.push([r.cutDate, r.orderNo, r.sku, r.articleType, r.articleSubtype, r.color, r.size,
      r.fabricWidth, ptNum(r.pieces), u > 0 ? u : '', w > 0 ? w : '', ww > 0 ? ww : '',
      u > 0 && w > 0 ? ((w / u) * 100).toFixed(1) : '', r.remarks, r.addedBy].map(csvCell).join(','));
  });
  ptDownload('cutting-data', lines);
};

