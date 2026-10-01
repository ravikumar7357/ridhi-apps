/* ================= THE DESIGN SHEET =================
 *
 * Two columns are Ravi's: the group, and whether it is still being made. Every other column is
 * worked out from the registers and read back for nothing — it is there to decide WITH.
 */
const PAL_SHEET_COLS = ['Brand', 'Design', 'Group', 'Continue (no = remove)',
  'Current blocks', 'Required blocks', 'Status', 'Assign to printer',
  'SKUs', 'Ordered', 'Still to make', 'Sold 90d', 'Printing now'];

/** Every design there is, with what the registers say about it. */
function palSheetRows() {
  const rows = [PAL_SHEET_COLS];
  /* THE BRAND PICKED IS THE BRAND WRITTEN (Ravi, 2026-09-27: "CPC par filter lagaya but isne sara data export kar diya"). */
  const brand = ($('palBrand') || {}).value || '';
  palDesigns().filter(d => !brand || d.brand === brand).forEach(d => {
    const inf = palInfoOf(d.key);
    rows.push([d.brand, d.color, d.group || '', d.live ? 'yes' : 'no',
      inf.cur || '', d.blocks || '', inf.status || '', inf.printer ? palAssignName(inf.printer) : '',
      d.skus, Math.round(d.ordered), Math.round(d.open), Math.round(d.l90),
      [...d.now.keys()].join(' / ')]);
  });
  return rows;
}

/** Read a filled sheet back, by column name. */
function palSheetRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  /* A CSV saved back from Excel can start with a byte-order mark, which would hide the Brand column. */
  const head = rows[0].map(h => String(h == null ? '' : h).replace(/^\uFEFF/, '').trim().toLowerCase());
  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iB = at(['brand']), iD = at(['design', 'colour', 'color']);
  const iG = at(['group', 'colour group', 'color group']);
  /* "Continue (no = remove)" is the sheet's own header; a bare "Continue" from an older sheet still reads. A
   * "Remove" column says the same thing the other way round: yes = take it off the list. */
  let iC = at(['continue', 'still making', 'active']);
  if (iC < 0) iC = head.findIndex(h => /^continue\b/.test(h));
  const iR = iC >= 0 ? -1 : head.findIndex(h => /^remove\b/.test(h));
  const iCur = at(['current blocks', 'current block', 'blocks now']), iNeed = at(['required blocks', 'blocks/design', 'blocks per design', 'required block']);
  const iSt = at(['status']), iPr = at(['assign to printer', 'assigned printer', 'printer']);
  if (iB < 0 || iD < 0) return { err: 'The file needs Brand and Design columns. Download the design sheet to see them.' };
  if (iG < 0 && iC < 0 && iR < 0 && iCur < 0 && iNeed < 0 && iSt < 0 && iPr < 0) return { err: 'The file has no Group, Continue, blocks, Status or printer column, so there is nothing in it to read.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    const brand = cell(iB), design = cell(iD);
    if (!brand && !design) continue;
    let cont = cell(iC);
    if (iR >= 0) {
      const r = cell(iR);
      cont = /^(y|yes|true|1|remove|removed|delete|deleted|x)$/i.test(r) ? 'no' : /^(n|no|false|0|keep)$/i.test(r) ? 'yes' : r;
    }
    out.push({ row: i + 1, brand, design, group: cell(iG), cont, hasG: iG >= 0, hasC: iC >= 0 || iR >= 0,
      cur: cell(iCur), need: cell(iNeed), status: cell(iSt), printer: cell(iPr), hasCur: iCur >= 0, hasNeed: iNeed >= 0, hasSt: iSt >= 0, hasPr: iPr >= 0 });
  }
  return { entries: out };
}

/** What the sheet would do, before anything is written. */
function palSheetPlan(entries) {
  const known = new Map(palDesigns().map(d => [d.key, d]));
  const set = [], skip = [], seen = new Map();
  (entries || []).forEach(e => {
    const key = palKey(e.brand, e.design);
    if (seen.has(key)) { skip.push({ row: e.row, key, why: 'the same brand and design is on row ' + seen.get(key) + ' as well.' }); return; }
    seen.set(key, e.row);
    const d = known.get(key);
    /* A DESIGN THE CATALOGUE HAS NEVER SEEN is a typo far more often than it is a new colour, and
     * inventing one here would put a group on something nothing can ever be made of. */
    if (!d) { skip.push({ row: e.row, key, why: 'no SKU in the catalogue is ' + (e.brand || '?') + ' ' + (e.design || '?') + '.' }); return; }
    if (e.hasG) {
      const want = e.group;
      if (want !== (d.group || '')) set.push({ row: e.row, key, d, field: 'group', from: d.group || '', to: want });
    }
    /* THE FOUR FED COLUMNS (2026-09-25). A number that is not one, or a printer nobody is called, is refused. */
    const num = (v, what) => { if (v === '') return 0; const n = Number(String(v).replace(/,/g, '')); return isFinite(n) && n >= 0 && Math.round(n) === n ? n : (skip.push({ row: e.row, key, why: what + ' has to be a whole number, not "' + v + '".' }), null); };
    const inf = palInfoOf(key);
    if (e.hasCur) { const n = num(e.cur, 'Current blocks'); if (n === null) return; if (n !== palNum(inf.cur)) set.push({ row: e.row, key, d, field: 'cur', from: inf.cur ? String(inf.cur) : '', to: n ? String(n) : '', val: n }); }
    if (e.hasNeed) { const n = num(e.need, 'Required blocks'); if (n === null) return; if (n !== palNum(d.blocks)) set.push({ row: e.row, key, d, field: 'need', from: d.blocks ? String(d.blocks) : '', to: n ? String(n) : '', val: n }); }
    if (e.hasSt && e.status !== String(inf.status || '')) set.push({ row: e.row, key, d, field: 'status', from: inf.status || '', to: e.status, val: e.status });
    if (e.hasPr) {
      const code = palAssignPick(e.printer);
      if (code === null) { skip.push({ row: e.row, key, why: 'no printer is called "' + e.printer + '".' }); return; }
      if (code !== String(inf.printer || '')) set.push({ row: e.row, key, d, field: 'printer', from: inf.printer ? palAssignName(inf.printer) : '', to: code ? palAssignName(code) : '', val: code });
    }
    if (e.hasC && e.cont !== '') {
      const yes = /^(y|yes|true|1|continue|on)$/i.test(e.cont);
      const no = /^(n|no|false|0|stop|stopped|off|remove|removed|delete|deleted|x)$/i.test(e.cont);
      if (!yes && !no) { skip.push({ row: e.row, key, why: 'Continue / Remove has to be yes or no, not "' + e.cont + '".' }); return; }
      if (yes !== d.live) set.push({ row: e.row, key, d, field: 'live', from: d.live ? 'yes' : 'no', to: yes ? 'yes' : 'no', on: yes });
    }
  });
  /* A ROW DELETED FROM THE SHEET (Ravi, 2026-09-25: "excel se delete nahi kar pa rha hu"). A colour on the list
   * that the file does not hold is offered for removal. `whole` says whether the file is the whole sheet — at
   * least half of the colours on the list — because a sheet cut down to one brand is not a request to remove
   * every other brand; the preview then leaves them alone unless the person says otherwise. */
  /* ONLY THE BRANDS THE FILE HOLDS: a CPC sheet says nothing about Ridhi's colours. */
  const fileBrands = new Set([...seen.keys()].map(k => (known.get(k) || {}).brand).filter(Boolean));
  const liveAll = [...known.values()].filter(d => d.live && (!fileBrands.size || fileBrands.has(d.brand)));
  const missing = liveAll.filter(d => !seen.has(d.key));
  const inFile = liveAll.length - missing.length;
  return { set, skip, missing, whole: liveAll.length > 0 && inFile >= liveAll.length / 2 };
}

/**
 * Write what the plan showed, in ONE record.
 *
 * Both maps go together: written apart, a group edit landing between them would carry the old stop
 * list back over the new one.
 */
async function palSheetRun(plan, dropMissing) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const rows = ((plan && plan.set) || []).concat(dropMissing
    ? ((plan && plan.missing) || []).map(d => ({ key: d.key, d, field: 'live', on: false })) : []);
  if (!rows.length) return 'There is nothing to write.';
  const map = Object.assign({}, (PAL.groups || {}).map || {});
  const live = Object.assign({}, (PAL.groups || {}).live || {});
  const need = Object.assign({}, (PAL.need || {}).map || {});
  const info = JSON.parse(JSON.stringify((PAL.need || {}).info || {}));
  let g = false, b = false;
  rows.forEach(r => {
    if (r.field === 'group') { g = true; if (r.to) map[r.key] = r.to; else delete map[r.key]; }
    else if (r.field === 'live') { g = true; if (r.on) delete live[r.key]; else live[r.key] = false; }
    else if (r.field === 'need') { b = true; if (r.val) need[r.key] = r.val; else delete need[r.key]; }
    else {
      b = true;
      const e = Object.assign({}, info[r.key] || {});
      if (r.val === '' || r.val === 0) delete e[r.field]; else e[r.field] = r.val;
      if (Object.keys(e).length) info[r.key] = e; else delete info[r.key];
    }
  });
  try {
    if (g) await palPutGroups(map, live);
    if (b) await palPutNeed(need, info);
  } catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}

/* ---- the screen ---- */
function renderPal() {
  /* The sheet writes groups and stop decisions, so it is the same right that ticks them by hand. */
  ['palSheet', 'palImport', 'palClear'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !palCanEdit()); });
  const view = ($('palView') || {}).value || PAL.view || 'design';
  PAL.view = view;
  const brand = ($('palBrand') || {}).value || '';
  const q = obUC(($('palQ') || {}).value);

  /* FILLED WHENEVER THE BRANDS CHANGE, not only the first time (Ravi, 2026-09-25: "brand not showing in filter").
   * The first draw can come before the master database has loaded, and a list filled then held only "All brands"
   * for the rest of the session. The pick survives a refill. */
  if ($('palBrand')) {
    const brands = [...new Set((PTG.mdb || []).map(r => palBrandOf(r.brand)).filter(b => b && b !== '?'))].sort();
    const sig = brands.join('|');
    if (PAL.brandSig !== sig || !$('palBrand').innerHTML) {
      const was = $('palBrand').value || '';
      $('palBrand').innerHTML = '<option value="">All brands</option>'
        + brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
      $('palBrand').value = brands.indexOf(was) >= 0 ? was : '';
      PAL.brandSig = sig;
    }
  }

  /* ONE PRINTER'S SHARE (Ravi, 2026-09-28: "1 vendor ke pas total kitni design h"). The designs, groups and pieces
   * shown are that printer's; the plan — capacity and what is not covered — is still worked out over everybody. */
  const prnOpts0 = palAssignable();
  if ($('palPrn')) {
    const sig = prnOpts0.map(x => x.join('=')).join('|');
    if (PAL.prnSig !== sig || !$('palPrn').innerHTML) {
      const was = $('palPrn').value || '';
      $('palPrn').innerHTML = '<option value="">All printers</option>'
        + prnOpts0.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')
        + '<option value="__none">Not given to anybody</option>';
      $('palPrn').value = was === '__none' || prnOpts0.some(x => x[0] === was) ? was : '';
      PAL.prnSig = sig;
    }
  }
  const prn = ($('palPrn') || {}).value || '';
  const prnName = prn === '__none' ? 'not given to anybody' : ((prnOpts0.find(x => x[0] === prn) || [])[1] || prn);

  const all = palDesigns();
  /* A COLOUR THAT IS NOT BEING CONTINUED LEAVES THE LIST (Ravi, 2026-09-25). It is only counted and shown under
   * "Removed colours", where it can be brought back. */
  const designsAll = all.filter(d => d.live && (!brand || d.brand === brand));
  const designs = !prn ? designsAll : designsAll.filter(d => (palInfoOf(d.key).printer || '__none') === prn);
  const removed = all.filter(d => !d.live && (!brand || d.brand === brand));
  if (!removed.length) PAL.showOff = false;
  if ($('palOff')) {
    $('palOff').classList.toggle('hide', !removed.length && !PAL.showOff);
    $('palOff').textContent = PAL.showOff ? '← Back to the list' : `Removed colours (${nf(removed.length)})`;
  }
  const plan = palPlan(designsAll);
  const groups = palGroups(designs);
  const totMake = designs.reduce((s, d) => s + d.toMake, 0);
  const tot90 = designs.reduce((s, d) => s + d.l90, 0);
  const cap = plan.printers.reduce((s, p) => s + palNum(p.pcsMonth), 0);
  const short = plan.rows.reduce((s, r) => s + r.short, 0);
  const hit = s => !q || obUC(s).indexOf(q) >= 0;

  if (!$('palStatusList') && document.body && document.createElement) {
    const dl = document.createElement('datalist'); dl.id = 'palStatusList';
    dl.innerHTML = PAL_STATUS.map(x => `<option value="${esc(x)}">`).join('');
    document.body.appendChild(dl);
  }
  if ($('palGroupList')) {
    $('palGroupList').innerHTML = [...new Set(all.map(d => d.group).filter(Boolean))].sort()
      .map(g => `<option value="${esc(g)}">`).join('');
  }

  $('palKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Printer allocation${brand ? ' · ' + esc(brand) : ''}${prn ? ' · <b>' + esc(prnName) + '</b>' : ''}</span>
      <span class="kpiwhen">order book live${PAL.at ? ' · ' + esc(PAL.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(designs.length)}</div><div class="l">Designs</div></div>
      <div class="metric"><div class="v">${nf(groups.length)}</div><div class="l">Colour groups</div></div>
      <div class="metric"><div class="v" style="color:var(--accent)">${nf(Math.round(totMake))}</div><div class="l">Pieces to make</div></div>
      <div class="metric"><div class="v">${nf(cap)}</div><div class="l">Capacity a month</div></div>
      <div class="metric"><div class="v"${short > 0 ? ' style="color:var(--bad)"' : ''}>${nf(Math.round(short))}</div><div class="l">Not covered</div></div>
      <div class="metric"><div class="v">${tot90 ? nf(Math.round(tot90)) : '—'}</div><div class="l">Sold, 90 days</div></div>
    </div></div>`;

  const canEdit = palCanEdit();
  let head = '', body = '';
  /* Each view owns the footer; a sentence left over from another one would explain the wrong table. */
  if ($('palFoot')) { $('palFoot').innerHTML = ''; $('palFoot').classList.add('hide'); }

  if (PAL.showOff) {
    const rows = removed.filter(d => hit(d.color) || hit(d.group) || hit(d.brand));
    PAL.shown = rows;
    head = ['Brand', 'Removed colour', 'Group', 'SKUs', 'Ordered', 'Still open on orders', 'Sold 90d', ''];
    body = rows.map(d => '<tr>'
      + `<td>${esc(d.brand)}</td>`
      + `<td style="text-align:left">${esc(d.color)}</td>`
      + `<td style="text-align:left">${esc(d.group || '—')}</td>`
      + `<td class="num">${nf(d.skus)}</td>`
      + `<td class="num">${nf(Math.round(d.ordered))}</td>`
      + `<td class="num">${d.open ? nf(Math.round(d.open)) : '—'}</td>`
      + `<td class="num">${d.l90 ? nf(Math.round(d.l90)) : '—'}</td>`
      + `<td>${canEdit ? `<button class="ghost" data-palon="${esc(d.key)}">Bring back</button>` : ''}</td>`
      + '</tr>').join('');
  } else if (view === 'design') {
    /* TWO PANES (Ravi, 2026-09-27: layout 2, "system hang na ho"). Groups on the left; the chosen one on the right with
     * its printer split and ONLY its colours — one group's rows at a time, not every colour of every group. */
    const gl = groups.map(g => ({ g, cols: (hit(g.name) || hit(g.brand)) ? g.designs : g.designs.filter(d => hit(d.color) || hit(d.brand)) }))
      .filter(x => x.cols.length);
    if (!gl.some(x => x.g.name === PAL.pick)) PAL.pick = gl.length ? gl[0].g.name : '';
    const cur = gl.find(x => x.g.name === PAL.pick);
    PAL.shown = cur ? cur.cols : [];
    const prnOpts = palAssignable();
    /* One colour per printer, the same on the bar, the tiles and the rows. */
    const PAL_TONES = [['#3b6fd4', '#e3ecfb'], ['#d98a1c', '#fbefdc'], ['#1f9d62', '#dff4ea'], ['#8a4fd1', '#efe6fb'], ['#c2362b', '#fde7e4'], ['#0e8a96', '#dcf3f5']];
    const toneOf = (() => { const m = new Map(); prnOpts.forEach(([v], i) => m.set(v, PAL_TONES[i % PAL_TONES.length])); return v => m.get(v) || ['#667085', '#eef1f5']; })();
    const dot = v => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${toneOf(v)[0]};margin-right:5px"></span>`;
    const barOf = g => { const sp = palGroupSplit(g), tot = g.toMake || 1;
      return '<div class="pal2-bar">' + sp.parts.map(x => `<i style="width:${(x.pcs / tot * 100).toFixed(1)}%;background:${toneOf(x.printer)[0]}"></i>`).join('') + '</div>'; };
    const left = gl.map(({ g }) => `<div class="pal2-g${g.name === PAL.pick ? ' on' : ''}" data-palpick="${esc(g.name)}" role="button" tabindex="0">`
      + `<div class="r"><b>${esc(g.name)}</b><b style="font-variant-numeric:tabular-nums">${nf(Math.round(g.toMake))}</b></div>`
      + `<div class="r muted" style="font-size:12px"><span>${nf(g.designs.length)} colour${g.designs.length === 1 ? '' : 's'}${g.grouped ? '' : ' · guessed'}</span><span>${totMake > 0 ? (g.toMake / totMake * 100).toFixed(1) + '%' : '—'}</span></div>`
      + barOf(g) + '</div>').join('') || '<div class="muted" style="padding:14px">No group matches.</div>';
    let right = '<div class="muted" style="padding:14px">Pick a group on the left.</div>';
    if (cur) {
      const g = cur.g, sp = palGroupSplit(g);
      const who = new Set(g.designs.map(d => palInfoOf(d.key).printer || ''));
      const oneP = who.size === 1 ? [...who][0] : '__mixed';
      /* A TILE IS A FILTER (Ravi, 2026-09-27: "AR par click karu to AR ka data show ho"): click a printer, see only its
       * colours; click it again, or pick another group, and every colour is back. "Not given" shows the ones nobody has. */
      if (PAL.tileG !== g.name) { PAL.tileG = g.name; PAL.tileF = ''; }
      const tf = PAL.tileF || '';
      const ring = on => (on ? ';box-shadow:0 0 0 2px currentColor' : '') + (tf && !on ? ';opacity:.55' : '');
      const tiles = sp.parts.map(x => { const t = toneOf(x.printer); return `<div class="pal2-t" data-paltile="${esc(x.printer)}" role="button" tabindex="0" title="${tf === x.printer ? 'Show every colour again' : 'Show only the colours given to ' + esc(palAssignName(x.printer))}" style="cursor:pointer;background:${t[1]};color:${t[0]}${ring(tf === x.printer)}"><b>${esc(palAssignName(x.printer))}</b>`
          + `<div class="v">${nf(Math.round(x.pcs))} pcs</div><div style="font-size:12px">${nf(x.colours)} colour${x.colours === 1 ? '' : 's'} · ${g.toMake ? Math.round(x.pcs / g.toMake * 100) : 0}%</div></div>`; }).join('')
        + `<div class="pal2-t" data-paltile="__none" role="button" tabindex="0" style="cursor:pointer;background:${sp.noneN ? 'var(--bad-bg,#fde7e4)' : 'var(--hover,#f3f5f8)'};color:${sp.noneN ? 'var(--bad,#c2362b)' : 'var(--muted)'}${ring(tf === '__none')}"><b>Not given</b><div class="v">${nf(Math.round(sp.none))}</div><div style="font-size:12px">${sp.noneN ? nf(sp.noneN) + ' colour(s) have no printer' : 'every colour has a printer'}</div></div>`;
      const shownCols = !tf ? cur.cols : cur.cols.filter(d => (palInfoOf(d.key).printer || '') === (tf === '__none' ? '' : tf));
      const rows = shownCols.map(d => { const inf = palInfoOf(d.key); const short = d.blocks && inf.cur != null ? Math.max(0, d.blocks - palNum(inf.cur)) : 0;
        return '<tr>'
          + `<td style="text-align:left">${inf.printer ? dot(inf.printer) : ''}<b>${esc(d.color)}</b><div class="muted" style="font-size:11px">${nf(d.skus)} SKUs · ${d.l90 ? nf(Math.round(d.l90)) + ' sold 90d' : 'no sales read'}</div></td>`
          + `<td class="num"><b>${nf(Math.round(d.toMake))}</b><div class="muted" style="font-size:11px">of ${nf(Math.round(d.ordered))}</div></td>`
          + `<td class="num">${canEdit ? `<input data-palcur="${esc(d.key)}" type="number" min="0" step="1" value="${inf.cur || ''}" style="width:62px${short ? ';border-color:var(--bad)' : ''}">` : (inf.cur || '—')}`
          + ` / ${canEdit ? `<input data-palneed="${esc(d.key)}" type="number" min="0" step="1" value="${d.blocks || ''}" style="width:62px">` : (d.blocks || '—')}${short ? `<div style="font-size:10px;color:var(--bad)">${nf(short)} short</div>` : ''}</td>`
          + `<td style="text-align:left">${canEdit ? `<input data-palst="${esc(d.key)}" list="palStatusList" value="${esc(inf.status || '')}" placeholder="—" style="min-width:120px">` : esc(inf.status || '—')}</td>`
          + `<td style="text-align:left">${canEdit ? `<select data-palasg="${esc(d.key)}" style="min-width:150px"><option value="">— pick —</option>${prnOpts.map(([v, l]) => `<option value="${esc(v)}"${v === inf.printer ? ' selected' : ''}>${esc(l)}</option>`).join('')}${inf.printer && !prnOpts.some(o => o[0] === inf.printer) ? `<option value="${esc(inf.printer)}" selected>${esc(inf.printer)}</option>` : ''}</select>` : esc(inf.printer ? palAssignName(inf.printer) : '—')}</td>`
          + `<td style="text-align:left;font-size:12px">${d.now.size ? [...d.now.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${esc(w)} <span class="muted">${nf(Math.round(n))}</span>`).join('<br>') : '<span class="muted">nobody</span>'}</td>`
          + (canEdit ? `<td style="text-align:left"><input data-palgrp="${esc(d.key)}" list="palGroupList" value="${esc(d.group)}" placeholder="${esc(palFamily(d.color) ? palBrandOf(d.brand) + ' ' + palFamily(d.color) : 'name a group')}" style="min-width:130px"></td>`
            + `<td><button class="ghost" data-paloff="${esc(d.key)}" title="Not continuing this colour — take it off the list. Its orders are not touched." style="color:var(--bad);padding:2px 9px">×</button></td>` : '')
          + '</tr>'; }).join('');
      right = `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap"><div style="text-align:left"><div style="font-size:20px;font-weight:800">${esc(g.name)}</div>`
        + `<div class="muted">${nf(g.designs.length)} colour${g.designs.length === 1 ? '' : 's'} · ${nf(g.skus)} SKUs · ${nf(Math.round(g.toMake))} to make of ${nf(Math.round(g.ordered))} · ${g.l90 ? nf(Math.round(g.l90)) + ' sold 90d' : 'no sales read'}${g.blocks ? ' · ' + nf(g.blocks) + ' blocks' : ''}</div></div><span style="flex:1"></span>`
        + (canEdit ? `<select data-palgasg="${esc(g.name)}" style="min-width:190px;font-weight:600" title="Give every colour of this group to one printer. To split it, change a colour's printer below.">`
          + `${oneP === '__mixed' ? `<option value="__mixed" selected>Split · ${nf(sp.parts.length)} printer(s)</option>` : ''}<option value=""${oneP === '' ? ' selected' : ''}>— whole group to… —</option>`
          + prnOpts.map(([v, l]) => `<option value="${esc(v)}"${v === oneP ? ' selected' : ''}>${esc(l)}</option>`).join('') + '</select>' : '') + '</div>'
        + `<div class="pal2-tiles">${tiles}</div>`
        + (tf ? `<div class="muted" style="font-size:12.5px;margin:-4px 0 8px">Showing ${nf(shownCols.length)} of ${nf(cur.cols.length)} colours — ${tf === '__none' ? 'not given to anybody' : 'given to ' + esc(palAssignName(tf))} · <a href="#" data-paltile="${esc(tf)}">show all</a></div>` : '')
        + `<div class="xlwrap" style="max-height:52vh"><table class="xl"><thead><tr><th style="text-align:left">Colour</th><th class="num">To make</th><th class="num">Blocks now / needed</th><th>Status</th><th>Printer</th><th>Printing now</th>${canEdit ? '<th>Move to group</th><th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    head = []; body = `<tr><td style="padding:0;text-align:left;white-space:normal"><div class="pal2"><div class="pal2-l">${left}</div><div class="pal2-d">${right}</div></div></td></tr>`;
  } else if (view === 'group') {
    const rows = groups.filter(g => hit(g.name));
    PAL.shown = rows;
    head = ['Group', 'Brand', 'Designs', 'SKUs', 'To make', 'Share', 'Sold 90d', 'Printers needed', 'Printing now', 'Blocks/printer'];
    body = rows.map(g => {
      const p = plan.rows.find(r => r.group.name === g.name) || { picks: [], short: 0 };
      const share = totMake > 0 ? (g.toMake / totMake) * 100 : 0;
      return '<tr>'
        + `<td style="text-align:left"><b>${esc(g.name)}</b>${g.grouped ? '' : ' <span class="muted" style="font-size:10.5px">(guessed)</span>'}</td>`
        + `<td>${esc(g.brand)}</td>`
        + `<td class="num">${nf(g.designs.length)}</td>`
        + `<td class="num">${nf(g.skus)}</td>`
        + `<td class="num"><b>${nf(Math.round(g.toMake))}</b></td>`
        + `<td class="num">${share >= 0.05 ? share.toFixed(1) + '%' : '—'}</td>`
        + `<td class="num">${g.l90 ? nf(Math.round(g.l90)) : '—'}</td>`
        + `<td class="num">${g.toMake > 0 ? `<b>${nf(p.picks.length)}</b>${p.short > 0 ? ` <span class="err">+${nf(Math.round(p.short))} short</span>` : ''}` : '—'}</td>`
        + `<td style="text-align:left;font-size:12px">${g.now.size ? [...g.now.keys()].map(esc).join(', ') : '<span class="muted">nobody</span>'}</td>`
        + `<td class="num">${g.blocks ? nf(g.blocks) : '<span class="muted">not fed</span>'}</td>`
        + '</tr>';
    }).join('');
  } else if (view === 'printer') {
    const rows = plan.printers.concat(palPrinters().filter(p => p.active === false)).filter(p => hit(p.name));
    PAL.shown = rows;
    head = ['Printer', 'Tables', 'Capacity/month', 'Given', 'Load', 'Groups', 'Blocks needed', 'Has', 'To make', ''];
    body = rows.length ? rows.map(p => {
      const given = palNum(plan.load.get(p.key));
      /* MEASURED, AND IT SAYS SO. A capacity nobody can account for is one nobody should plan
       * against, so the cell carries where the figure came from. */
      const c = (plan.cap && plan.cap.get(p.key)) || palCapacity(p);
      const capN = palNum(c.pcs);
      const pct = capN > 0 ? (given / capN) * 100 : 0;
      const mine = plan.rows.filter(r => r.picks.some(x => x.key === p.key));
      /* WHAT THEY WERE GIVEN, not what the plan happened to use: a group they take and have no work
       * on this month is still theirs, and showing "nothing yet" for it reads as a missing decision. */
      const takes = (Array.isArray(p.groups) ? p.groups : []).slice().sort((a, b) => a.localeCompare(b));
      let need = 0, has = 0;
      mine.forEach(r => { const b = palGroupBlocks(p.key, r.group); need += b.need; has += b.have; });
      return '<tr>'
        + `<td style="text-align:left"><b>${esc(p.name)}</b>${p.active === false ? ' <span class="muted">(not taking work)</span>' : ''}`
        + `${p.note ? `<div class="muted" style="font-size:10.5px">${esc(p.note)}</div>` : ''}</td>`
        + `<td class="num">${palNum(p.tables) ? nf(palNum(p.tables)) : '—'}</td>`
        + `<td class="num" title="${esc(palCapWhy(c))}">${nf(capN)}`
        + `<div class="muted" style="font-size:10.5px">${c.from === 'own'
            ? 'measured' + (c.partMonth ? ' · part month' : '')
            : (c.from === 'tables' ? 'tables × rate' : 'typed in')}</div></td>`
        + `<td class="num">${nf(Math.round(given))}</td>`
        + `<td class="num">${capN ? `<span class="${pct > 99 ? 'err' : ''}">${pct.toFixed(0)}%</span>` : '—'}</td>`
        + `<td style="text-align:left;font-size:12px">${takes.length
            ? takes.map(n => esc(n) + (mine.some(r => r.group.name === n) ? '' : ' <span class="muted">(no work)</span>')).join('<br>')
            : '<span class="muted">none picked — give them one</span>'}</td>`
        + `<td class="num">${need ? nf(need) : '—'}</td>`
        + `<td class="num">${has ? nf(has) : '—'}</td>`
        + `<td class="num">${need > has ? `<b class="err">${nf(need - has)}</b>` : '—'}</td>`
        + `<td style="white-space:nowrap">${canEdit
          ? `<button class="ghost" data-paledit="${esc(p.key)}" style="padding:2px 9px;font-size:12px">Edit</button>`
            + ` <button class="ghost" data-palblk="${esc(p.key)}" style="padding:2px 9px;font-size:12px">Blocks</button>`
          : ''}</td>`
        + '</tr>';
    }).join('') : `<tr><td colspan="10" class="muted" style="padding:16px">No printer yet. "+ Printer" adds one — name, tables and the pieces a month they can finish.</td></tr>`;
  } else if (view === 'hist') {
    /* MEASURED, not fed: square metres actually delivered, by the week they arrived — and beside it
     * WHAT HAS TO BE PRINTED, which is the question this screen could not answer before. */
    const h = pafHistory(($('palWeeks') || {}).value || 8);
    const need = pafNeed();
    const split = palNeedSplit(need, h);
    const sq = v => nf(Math.round(v));
    const weeksInHand = h.perWeek > 0 ? need.sqm / h.perWeek : null;
    const vend = h.vendors.filter(v => hit(v.name) || hit(v.code));
    PAL.shown = vend;

    /* THE REQUIREMENT, on the same screen as the capacity. */
    $('palKpis').innerHTML += `<div class="kpi" style="flex-basis:100%">
      <div class="kpihead"><span class="kpiname">What the printers have to print</span>
        <span class="kpiwhen">everything still "to make" on the open order book, turned into cloth</span></div>
      <div class="metrics">
        <div class="metric"><div class="v" style="color:var(--accent)">${sq(need.sqm)}</div><div class="l">m² needed</div></div>
        <div class="metric"><div class="v">${nf(need.pieces)}</div><div class="l">pieces to make</div></div>
        <div class="metric"><div class="v" style="color:#1D4ED8">${sq(h.vendors.reduce((t, v) => t + (v.weeks.get(h.keys.length > 1 ? h.keys[h.keys.length - 2] : h.keys[0]) || 0), 0))}</div><div class="l">m² printed last week (${esc(repWkRange(h.keys.length > 1 ? h.keys[h.keys.length - 2] : h.keys[0]))}), all printers</div></div>
        <div class="metric"><div class="v">${sq(h.perWeek)}</div><div class="l">m² a week, all printers — average</div></div>
        <div class="metric"><div class="v"${weeksInHand != null && weeksInHand > 4 ? ' style="color:var(--bad)"' : ''}>${
          weeksInHand == null ? '—' : (Math.round(weeksInHand * 10) / 10)}</div><div class="l">weeks of printing in hand</div></div>
        <div class="metric"><div class="v">${nf(h.vendors.length)}</div><div class="l">printers delivering</div></div>
      </div>
      ${need.byFab.length ? `<div style="margin-top:10px">
        <div class="muted" style="font-size:12px;margin-bottom:5px">What to order, fabric by fabric — this is the list you place with a printer:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${need.byFab.slice(0, 10).map(f => `<span
          style="border:1px solid var(--line);border-radius:6px;padding:3px 8px;font-size:12px"><b>${esc(f.fabric)}</b>
          ${sq(f.sqm)} m² <span class="muted">· ${nf(f.pcs)} pcs</span></span>`).join('')}${
          need.byFab.length > 10 ? `<span class="muted" style="font-size:12px;padding:3px 4px">and ${nf(need.byFab.length - 10)} more</span>` : ''}</div>
      </div>` : ''}
    </div>`;

    /* LAST WEEK, IN m², ON ITS OWN (Ravi, 2026-09-29): the last FINISHED week — the one running now is only part
     * of a week — is each printer's capacity as it stands, and every figure here says its unit. */
    const lastWk = h.keys.length > 1 ? h.keys[h.keys.length - 2] : h.keys[0];
    const thisWk = h.keys[h.keys.length - 1];
    const m2 = v => `${sq(v)} <span class="muted" style="font-size:10.5px;font-weight:400">m²</span>`;
    const lastTot = h.vendors.reduce((t, v) => t + (v.weeks.get(lastWk) || 0), 0);
    head = ['Printer', 'Last week · ' + repWkRange(lastWk) + ' · m²'].concat(h.keys.map(k => repWkRange(k) + (k === thisWk ? ' (so far)' : '') + ' · m²'),
      ['Average · m² a week', 'Best week · m²', 'Weeks worked', 'Share of the need', 'Weeks at this rate', 'Unpriced', 'Fed capacity']);
    body = vend.length ? vend.map(v => {
      /* The typed figure, for the same printer, so the two can be read off one row. Pieces a month
       * against square metres a week are different units on purpose — they are different promises. */
      const fed = palPrinters().find(p => obUC(p.name) === obUC(v.name));
      const n = split.map.get(v.code) || {};
      return '<tr>'
        + `<td style="text-align:left"><b>${esc(v.name || v.code)}</b></td>`
        + `<td class="num" style="background:#EEF5FF">${v.weeks.get(lastWk) ? `<b style="font-size:15px;color:#1D4ED8">${sq(v.weeks.get(lastWk))}</b> <span class="muted" style="font-size:10.5px">m²</span>` : '<span class="muted">nothing delivered</span>'}</td>`
        + h.keys.map(k => `<td class="num">${v.weeks.get(k) ? m2(v.weeks.get(k)) : '<span class="muted">—</span>'}</td>`).join('')
        + `<td class="num"><b>${m2(v.avg)}</b></td>`
        + `<td class="num">${m2(v.best)}</td>`
        + `<td class="num">${nf(v.ranWeeks)}</td>`
        + `<td class="num">${n.sqm ? `<b>${sq(n.sqm)}</b> m²<div class="muted" style="font-size:10.5px">${(n.share * 100).toFixed(0)}% of the need</div>`
          : '<span class="muted">—</span>'}</td>`
        + `<td class="num">${n.weeks == null ? '<span class="muted">—</span>'
          : `<span${n.weeks > 4 ? ' class="err"' : ''}>${(Math.round(n.weeks * 10) / 10)}</span>`}</td>`
        + `<td class="num">${v.unpriced ? `<span class="err" title="Delivered, but no width or consumption to price it with">${nf(Math.round(v.unpriced))}</span>` : '<span class="muted">—</span>'}</td>`
        + `<td class="num">${fed ? nf(palNum(fed.pcsMonth)) + '<div class="muted" style="font-size:10.5px">pcs a month</div>' : '<span class="muted">not fed</span>'}</td>`
        + '</tr>';
    }).join('')
      + '<tr style="font-weight:700;border-top:2px solid var(--line)">'
      + '<td style="text-align:left">All printers</td>'
      + `<td class="num" style="background:#EEF5FF;color:#1D4ED8">${m2(lastTot)}</td>`
      + h.keys.map(k => `<td class="num">${m2(h.vendors.reduce((t, v) => t + (v.weeks.get(k) || 0), 0))}</td>`).join('')
      + `<td class="num">${m2(h.perWeek)}</td><td class="num">—</td><td class="num">—</td>`
      + `<td class="num">${sq(need.sqm)} m²</td>`
      + `<td class="num">${weeksInHand == null ? '—' : (Math.round(weeksInHand * 10) / 10)}</td>`
      + '<td class="num">—</td><td class="num">—</td></tr>'
      : `<tr><td colspan="${h.keys.length + 9}" class="muted" style="padding:16px">No deliveries recorded in this window — nothing has been logged in Vendor Orders → History.</td></tr>`;

    /* AND WHAT THE SPLIT IS NOT. A share worked out from delivery rates reads exactly like an
     * allocation unless somebody says it is not one. */
    const why = palNeedWhy(need);
    $('palFoot').innerHTML = '<b>Share of the need</b> is the m² total divided between the printers in '
      + 'proportion to what each one actually delivers — it says how much to place with whom while they '
      + 'are all busy, not who has been given what.'
      + (why.length ? '<br>To make it a real allocation: ' + why.map(w => esc(w)).join('; ') + '.' : '');
    $('palFoot').classList.remove('hide');
  } else {
    const rows = plan.rows.filter(r => r.group.toMake > 0 && (hit(r.group.name) || r.picks.some(p => hit(p.name))));
    PAL.shown = rows;
    head = ['Group', 'To make', 'Printer', 'Pieces', 'Why this printer', 'Blocks needed', 'Has', 'To make'];
    body = rows.length ? rows.map(r => {
      const n = Math.max(1, r.picks.length) + (r.short > 0 ? 1 : 0);
      const first = `<td rowspan="${n}" style="text-align:left;vertical-align:top"><b>${esc(r.group.name)}</b>`
        + `<div class="muted" style="font-size:10.5px">${nf(r.group.designs.length)} design(s)</div></td>`
        + `<td rowspan="${n}" class="num" style="vertical-align:top">${nf(Math.round(r.group.toMake))}</td>`;
      const lines = r.picks.map((p, i) => '<tr>' + (i === 0 ? first : '')
        + `<td style="text-align:left">${esc(p.name)}</td>`
        + `<td class="num">${nf(Math.round(p.pcs))}</td>`
        + `<td style="text-align:left;font-size:12px">${p.knows ? 'prints this colour already' : (p.have > 0 ? 'has some of the blocks' : 'has room')}</td>`
        + `<td class="num">${p.need ? nf(p.need) : '<span class="muted">not fed</span>'}</td>`
        + `<td class="num">${p.have ? nf(p.have) : '—'}</td>`
        + `<td class="num">${p.gap ? `<b class="err">${nf(p.gap)}</b>` : '—'}</td>`
        + '</tr>').join('');
      const none = r.picks.length ? '' : `<tr>${first}<td colspan="6" class="err" style="text-align:left">No printer has room for this.</td></tr>`;
      const rest = r.short > 0 && r.picks.length
        ? `<tr><td colspan="6" class="err" style="text-align:left">${nf(Math.round(r.short))} piece(s) have nowhere to go — every printer is full.</td></tr>`
        : '';
      return lines + none + rest;
    }).join('') : '<tr><td colspan="8" class="muted" style="padding:16px">Nothing to allocate — either no open order lines, or no printer with capacity.</td></tr>';
  }

  $('palTable').innerHTML = (head.length ? '<thead><tr>'
    + head.map((h, i) => `<th${/^(SKUs|Ordered|To make|Share|Sold|Blocks|Current blocks|Required blocks|Capacity|Given|Load|Pieces|Has|Tables|Printers)/.test(h) ? ' class="num"' : ''}>${esc(h)}</th>`).join('')
    + '</tr></thead>' : '') + '<tbody>' + (body || '<tr><td colspan="10" class="muted" style="padding:16px">Nothing matches.</td></tr>') + '</tbody>';

  $('palMsg').className = PAL.err ? 'err' : 'muted';
  $('palMsg').textContent = PAL.err ? PAL.err
    : PAL.busy ? 'Reading…'
      : `${nf(designs.length)} design(s) in ${nf(groups.length)} group(s) · ${nf(Math.round(totMake))} piece(s) still to make`
        + ` · capacity ${nf(cap)} a month${short > 0 ? ` · ${nf(Math.round(short))} not covered` : ''}`
        + (canEdit ? '' : ` · ${PAL_NO_EDIT}`);
}

function palExport() {
  const view = PAL.view;
  if (view === 'design') {
    const rows = PAL.shown || [];
    const tot = rows.reduce((s, d) => s + d.toMake, 0);
    csvDownload('printer-allocation-designs',
      ['Brand', 'Design', 'Group', 'SKUs', 'Ordered', 'To make', 'Share %', 'Sold 90d', 'Blocks per design', 'Printing now'],
      rows.map(d => [d.brand, d.color, d.group, d.skus, Math.round(d.ordered), Math.round(d.toMake),
        tot > 0 ? ((d.toMake / tot) * 100).toFixed(2) : '', Math.round(d.l90), d.blocks || '',
        [...d.now.keys()].join(' / ')]));
    return;
  }
  if (view === 'group') {
    const rows = PAL.shown || [];
    const plan = palPlan(palDesigns());
    csvDownload('printer-allocation-groups',
      ['Group', 'Brand', 'Designs', 'SKUs', 'To make', 'Sold 90d', 'Printers needed', 'Short', 'Blocks per printer', 'Printing now'],
      rows.map(g => {
        const p = plan.rows.find(r => r.group.name === g.name) || { picks: [], short: 0 };
        return [g.name, g.brand, g.designs.length, g.skus, Math.round(g.toMake), Math.round(g.l90),
          p.picks.length, Math.round(p.short), g.blocks, [...g.now.keys()].join(' / ')];
      }));
    return;
  }
  const plan = palPlan(palDesigns());
  if (view === 'printer') {
    csvDownload('printer-allocation-printers',
      ['Printer', 'Tables', 'Capacity per month', 'Given', 'Load %', 'Groups', 'Blocks needed', 'Blocks held'],
      plan.printers.map(p => {
        const given = palNum(plan.load.get(p.key));
        const mine = plan.rows.filter(r => r.picks.some(x => x.key === p.key));
        let need = 0, has = 0;
        mine.forEach(r => { const b = palGroupBlocks(p.key, r.group); need += b.need; has += b.have; });
        return [p.name, palNum(p.tables), palNum(p.pcsMonth), Math.round(given),
          palNum(p.pcsMonth) ? Math.round((given / palNum(p.pcsMonth)) * 100) : '', mine.map(r => r.group.name).join(' / '), need, has];
      }));
    return;
  }
  const out = [];
  plan.rows.forEach(r => r.picks.forEach(p => out.push([r.group.name, Math.round(r.group.toMake), p.name,
    Math.round(p.pcs), p.knows ? 'prints it already' : (p.have > 0 ? 'has blocks' : 'has room'), p.need, p.have, p.gap])));
  csvDownload('printer-allocation-plan',
    ['Group', 'Group to make', 'Printer', 'Pieces', 'Why', 'Blocks needed', 'Blocks held', 'Blocks to make'], out);
}

/* ---- wiring ---- */
$('palView').addEventListener('change', () => renderPal());
$('palWeeks').addEventListener('change', () => renderPal());
$('palBrand').addEventListener('change', () => renderPal());
if ($('palPrn')) $('palPrn').addEventListener('change', () => renderPal());
$('palQ').addEventListener('input', () => renderPal());
$('palPrinterAdd').onclick = () => palPrinterOpen('');
$('palExport').onclick = () => palExport();

$('palSheet').onclick = () => {
  const rows = palSheetRows();
  if (rows.length < 2) {
    $('palMsg').className = 'err';
    $('palMsg').textContent = 'There are no designs to write — the master database has no colours in it yet.';
    return;
  }
  ptDownload('designs', rows.map(r => r.map(csvCell).join(',')));
  $('palMsg').className = 'muted';
  $('palMsg').textContent = nf(rows.length - 1) + ' design(s) written. Fill in Group, and Continue (no = remove from the list); '
    + 'every other column is worked out from the registers and is read back for nothing.';
};
$('palImport').onclick = () => $('palFile').click();
if ($('palClear')) $('palClear').onclick = () => palClearOpen();
$('palFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const read = palSheetRead(rows);
    if (read.err) { $('palMsg').className = 'err'; $('palMsg').textContent = read.err; return; }
    const plan = palSheetPlan(read.entries);
    const miss = plan.missing || [];
    if (!plan.set.length && !miss.length) {
      $('palMsg').className = plan.skip.length ? 'err' : 'muted';
      $('palMsg').textContent = plan.skip.length
        ? nf(plan.skip.length) + ' row(s) refused, and nothing written: '
          + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
          + (plan.skip.length > 3 ? ' and ' + nf(plan.skip.length - 3) + ' more.' : '')
        : 'Every row in that file already says what the screen says.';
      return;
    }
    const gs = plan.set.filter(x => x.field !== 'live'), ls = plan.set.filter(x => x.field === 'live');
    const show = list => list.slice(0, 12).map(x => esc(x.d.brand + ' · ' + x.d.color) + ': '
      + (x.field === 'live' ? (x.on ? '<b>bring back</b>' : '<b style="color:var(--bad)">remove from the list</b>')
        : ({ cur: 'current blocks ', need: 'required blocks ', status: 'status ', printer: 'printer ' }[x.field] || '') + (x.from === '' ? '<i>not set</i>' : esc(x.from)) + ' → <b>' + (x.to === '' ? '<i>cleared</i>' : esc(x.to)) + '</b>')).join('<br>');
    const offN = ls.filter(x => !x.on).length, onN = ls.length - offN;
    ptOpenDialog({
      title: 'Write these decisions?',
      subtitle: nf(gs.length) + ' group(s) · ' + nf(offN) + ' removed · ' + nf(onN) + ' brought back',
      /* WHAT REMOVING ONE DOES, said before it is done. */
      note: 'A removed colour leaves this list and stops counting towards what has to be made; it waits under '
        + 'Removed colours and can be brought back. Its orders are not touched. '
        + 'Only Group and Continue (or Remove) are read; every other column on the sheet is worked out here.',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + (gs.length ? '<b>Group, blocks, status, printer</b><br>' + show(gs) + (gs.length > 12 ? '<br>…and ' + nf(gs.length - 12) + ' more.' : '') + '<br><br>' : '')
        + (miss.length ? `<b style="color:var(--bad)">${nf(miss.length)} colour(s) on the list are not in this file</b> — deleted rows are removed, if you choose so below${plan.whole ? '' : ' (this file holds less than half the list, so they are left alone unless you choose)'}:<br>`
          + miss.slice(0, 15).map(d => esc(d.brand + ' · ' + d.color)).join('<br>') + (miss.length > 15 ? '<br>…and ' + nf(miss.length - 15) + ' more.' : '') + '<br><br>' : '')
        + (ls.length ? '<b>Removed / brought back</b><br>' + show(ls) + (ls.length > 12 ? '<br>…and ' + nf(ls.length - 12) + ' more.' : '') + '<br><br>' : '')
        + (plan.skip.length ? '<b style="color:var(--bad)">' + nf(plan.skip.length) + ' row(s) refused, and not written</b><br>'
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>')
          + (plan.skip.length > 10 ? '<br>…and ' + nf(plan.skip.length - 10) + ' more.' : '') : '')
        + '</div>',
      fields: miss.length ? [{ key: 'drop', label: 'Colours not in this file', type: 'select', span: true, value: plan.whole ? 'remove' : 'keep',
        options: [['remove', `Remove these ${nf(miss.length)} from the list`], ['keep', 'Leave them as they are']] }] : [],
      saveLabel: 'Write the changes',
      onSave: async v => {
        const drop = !!miss.length && (v || {}).drop === 'remove';
        if (!plan.set.length && !drop) return 'Nothing to write — choose "Remove these" to take the missing colours off the list.';
        const err = await palSheetRun(plan, drop);
        if (err) return err;
        renderPal();
        $('palMsg').className = 'muted';
        $('palMsg').textContent = nf(plan.set.length) + ' decision(s) written.'
          + (drop ? ' ' + nf(miss.length) + ' colour(s) not in the file removed — they are under Removed colours.' : '')
          + (plan.skip.length ? ' ' + nf(plan.skip.length) + ' row(s) were refused and left alone.' : '');
        return '';
      },
    });
  } catch (err) { $('palMsg').className = 'err'; $('palMsg').textContent = 'Could not read it: ' + (err.message || err); }
};
if ($('palOff')) $('palOff').onclick = () => { PAL.showOff = !PAL.showOff; renderPal(); };
$('palRefresh').onclick = async () => { PAL.printers = null; await ensurePal(); };

/** One place saves what is typed into a table, whichever table it is. */
async function palCellSave(el) {
  const grp = el.getAttribute ? el.getAttribute('data-palgrp') : null;
  const need = el.getAttribute ? el.getAttribute('data-palneed') : null;
  const have = el.getAttribute ? el.getAttribute('data-palhave') : null;
  const cur = el.getAttribute ? el.getAttribute('data-palcur') : null;
  const st = el.getAttribute ? el.getAttribute('data-palst') : null;
  const asg = el.getAttribute ? el.getAttribute('data-palasg') : null;
  const gasg = el.getAttribute ? el.getAttribute('data-palgasg') : null;
  let why = '';
  if (gasg) {
    if (el.value === '__mixed') return '';
    const g = palGroups(palDesigns().filter(d => d.live)).find(x => x.name === gasg);
    why = g ? await palSetGroupPrinter(g.designs.map(d => d.key), el.value) : 'That group is gone — refresh.';
    $('palMsg').className = why ? 'err' : 'muted';
    if (why) { $('palMsg').textContent = why; return why; }
    renderPal();
    $('palMsg').textContent = g ? `${g.name}: all ${nf(g.designs.length)} colour(s) ${el.value ? 'given to ' + palAssignName(el.value) : 'cleared'}. To split it, change a colour's own printer.` : '';
    return '';
  }
  if (grp) why = await palSetGroup(grp, el.value);
  else if (cur) why = await palSetInfo(cur, 'cur', el.value);
  else if (st) why = await palSetInfo(st, 'status', el.value);
  else if (asg) why = await palSetInfo(asg, 'printer', el.value);
  else if (need) why = await palSetBlocks(need, el.value);
  else if (have) why = await palSetHave(el.getAttribute('data-palprn'), have, el.value);
  else return '';
  $('palMsg').className = why ? 'err' : 'muted';
  if (why) { $('palMsg').textContent = why; return why; }
  renderPal();
  return '';
}
$('palTable').addEventListener('change', e => {
  const el = e.target.closest('[data-palgrp],[data-palneed],[data-palhave],[data-palcur],[data-palst],[data-palasg],[data-palgasg]');
  if (el) palCellSave(el);
});
$('ptDlgBody').addEventListener('change', e => {
  const el = e.target.closest('[data-palneed],[data-palhave]');
  if (el) palCellSave(el);
});
$('palTable').addEventListener('click', async e => {
  const off = e.target.closest('[data-paloff],[data-palon]');
  if (off) {
    const key = off.getAttribute('data-paloff') || off.getAttribute('data-palon');
    const on = off.hasAttribute('data-palon');
    const d = palDesigns().find(x => x.key === key);
    off.disabled = true;
    const why = await palSetLive(key, on);
    renderPal();
    $('palMsg').className = why ? 'err' : 'muted';
    $('palMsg').textContent = why || `${d ? d.brand + ' ' + d.color : key} ${on ? 'is back on the list' : 'removed — it is under Removed colours if it is ever needed again'}.`;
    return;
  }
  /* A group on the left opens on the right. */
  const pk = e.target.closest('[data-palpick]');
  if (pk) { PAL.pick = pk.getAttribute('data-palpick'); return renderPal(); }
  const tl = e.target.closest('[data-paltile]');
  if (tl) { e.preventDefault(); const v = tl.getAttribute('data-paltile'); PAL.tileF = PAL.tileF === v ? '' : v; return renderPal(); }
  const ed = e.target.closest('[data-paledit]');
  if (ed) return palPrinterOpen(ed.getAttribute('data-paledit'));
  const bl = e.target.closest('[data-palblk]');
  if (bl) return palBlocksOpen(bl.getAttribute('data-palblk'));
});


