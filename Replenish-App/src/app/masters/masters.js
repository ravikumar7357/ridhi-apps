/* ================= MASTERS =================
 *
 * The lists every entry form is checked against: article types, subtypes, colours, sizes, fabrics.
 * Without these the factory cannot take on a new colour or a new size at all — every form would
 * refuse it — so this is the one screen that has to exist before the old tool can be switched off.
 *
 * A MASTER ROW IS MATCHED BY ITS CODE *OR* ITS DESCRIPTION, case-insensitively (validateAgainstMasters).
 * Records store the human text, so renaming a row that is already in use leaves those records saying
 * the old thing. This screen counts exactly how many before it lets anyone rename, and says so.
 *
 * NOTHING IS EVER DELETED — a row is made inactive. A deleted colour would leave a thousand records
 * naming something that, as far as the app is concerned, never existed.
 *
 * ELEVEN of the tool's twenty masters have NEVER been written (employee, designation, location,
 * courierPartner and the rest). They are not listed here: an empty screen for a list nothing uses
 * would be a promise this app cannot keep. Accessories has its own tab, and vendors theirs.
 */
const MASTERS = [
  ['articleType', 'Article type', 'What kind of thing it is — Tablecloth, Pillow Cover, Table Runner.'],
  ['articleSubtype', 'Article subtype', 'The shape within a type. Belongs to one article type.', 'articleType'],
  ['colour', 'Colour', 'Every print and colour name the factory uses.'],
  ['size', 'Size', 'Every size, written the way the SKUs write it.'],
  ['fabricType', 'Fabric type', 'Used by cutting and the master database.'],
  ['packOf', 'Pack of', 'How many pieces go in a pack.'],
  ['employmentType', 'Employment type', 'Drives the contractor / employee split in Job Work Register and payout.'],
  ['department', 'Department', 'Used by the employee list.'],
  /* Not a code-and-name list: a rule of four things, drawn by renderRuffleRules. */
  ['ruffleRule', 'Ruffle fabric', 'What a ruffle piece takes: the fabric its ruffle is cut from, and the metres per piece.'],
  /* Nor this one: one rule per article and subtype, drawn by renderPrintRules. */
  ['printRule', 'Printing rule', 'Whether an article is printed at all, on which cloth, which way round, and whether the printer is given running cloth or cut pieces.'],
];

let MST = { key: 'colour', err: '', busy: false, at: '' };

/* The printing rules save on the keystroke too. Forty rules behind forty dialogs never get filled. */
$('mstTable').addEventListener('change', async e => {
  const el = e.target;
  if (MST.key !== 'printRule' || !el.getAttribute) return;
  const key = el.getAttribute('data-prno') || el.getAttribute('data-prfab')
    || el.getAttribute('data-prdir') || el.getAttribute('data-prissue') || el.getAttribute('data-prpanels')
    || el.getAttribute('data-prlay');
  if (!key) return;
  const patch = el.hasAttribute('data-prno')
    ? { print: el.value === '' ? '' : el.value === 'yes' }
    : el.hasAttribute('data-prfab') ? { fabric: el.value }
    : el.hasAttribute('data-prdir') ? { dir: el.value }
    : el.hasAttribute('data-prpanels') ? { panels: el.value }
    : el.hasAttribute('data-prlay') ? { lay: el.value }
    : { issueAs: el.value };
  const err = await printRuleSave(key, patch);
  $('mstMsg').className = err ? 'err' : 'muted';
  $('mstMsg').textContent = err || 'Saved.';
  if (!err) renderPrintRules();
});

/* And whether a colour is printed at all. */
$('mstTable').addEventListener('change', async e => {
  const k = e.target.getAttribute && e.target.getAttribute('data-colprint');
  if (!k || MST.key !== 'colour') return;
  const err = await colourPrintSave(k, e.target.value === 'yes');
  if (err) { $('mstMsg').className = 'err'; $('mstMsg').textContent = err; }
});

/* A rule is saved the moment a box changes: the fabric, or the metres. One listener on the table. */
$('mstTable').addEventListener('change', async e => {
  const el = e.target;
  const k = el.getAttribute && (el.getAttribute('data-ruf-fab') || el.getAttribute('data-ruf-m'));
  if (!k || MST.key !== 'ruffleRule') return;
  const [subtype, size] = k.split('|');
  const g = ruffleCombos().find(x => x.subtype === subtype && x.size === size);
  if (!g) return;
  const fabric = el.hasAttribute('data-ruf-fab') ? el.value : g.fabric;
  const meters = el.hasAttribute('data-ruf-m') ? el.value : g.meters;
  const err = await ruffleRuleSave(subtype, size, fabric, meters);
  $('mstMsg').className = err ? 'err' : 'muted';
  $('mstMsg').textContent = err || `${subtype} ${size}: ${fabric || '—'}${meters !== '' ? ', ' + meters + ' m a piece' : ''}. Saved.`;
  if (!err) renderRuffleRules();
});

async function ensureMst() {
  if (!PTG.masters) { MST.busy = true; renderMst(); await ptLoadGates(); MST.busy = false; MST.at = ptStamp(); }
  renderMst();
}

const mstRows = key => ptList((PTG.masters || {})[key]);
const mstDef = key => MASTERS.find(m => m[0] === key) || MASTERS[0];

/** Keys run r0, r1, r2… — one past the highest. A guess that collided would overwrite a real row. */
function mstNextKey(key) {
  const ks = Object.keys((PTG.masters || {})[key] || {});
  const ns = ks.map(k => (/^r(\d+)$/.test(k) ? +k.slice(1) : -1));
  if (ks.length && ns.every(n => n >= 0)) return 'r' + (Math.max(...ns) + 1);
  if (!ks.length) return 'r0';
  return 'm_' + Date.now().toString(36);
}

/** How many records would keep saying the old text if this row were renamed. */
/* COUNTED ONCE, not once per row: the colour list walked the master, Base Data, Cutting and Press for each of its
 * 300 rows — 542 ms a draw (measured 2026-09-26). The index lives until one of the four lists is replaced. */
let MST_USE_IX = { sig: null, map: null };
function mstUsageIx() {
  const sig = [PTG.mdb, PT.base, PT.cut, PTG.press];
  if (MST_USE_IX.map && sig.every((x, i) => x === MST_USE_IX.sig[i])) return MST_USE_IX.map;
  const map = new Map();
  const add = (key, v) => { const t = String(v || '').trim().toLowerCase(); if (!t) return; const k = key + '|' + t; map.set(k, (map.get(k) || 0) + 1); };
  (PTG.mdb || []).forEach(r => { if (!r) return; add('articleType', r.articleType); add('articleSubtype', r.subtype); add('colour', r.color);
    add('size', r.size); add('fabricType', r.fabric); add('packOf', r.packOf); });
  [PT.base, PT.cut, PTG.press].forEach(list => (list || []).forEach(r => { if (!r) return;
    add('articleType', r.articleType); add('articleSubtype', r.articleSubtype); add('colour', r.color); add('size', r.size); }));
  (PT.base || []).forEach(r => { if (r) add('employmentType', r.empType); });
  MST_USE_IX = { sig, map };
  return map;
}
function mstUsage(key, value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 0;
  return mstUsageIx().get(key + '|' + v) || 0;
}

/**
 * Every ruffle subtype and size the catalogue actually has, with the rule for each — set or not.
 *
 * Built from the master database rather than typed in, so a size nobody remembered is still on the
 * list, and a rule nobody needs is not.
 */
function ruffleCombos() {
  const by = new Map();
  (PTG.mdb || []).forEach(m => {
    if (!ptIsRuffle(m)) return;
    const k = ptRufKey(m.subtype, m.size);
    let g = by.get(k);
    if (!g) g = { key: k, subtype: String(m.subtype || '').trim(), size: String(m.size || '').trim(), skus: 0, own: 0 }, by.set(k, g);
    g.skus++;
    if (String(m.ruffleFabric || '').trim() && parseFloat(m.ruffleMeters) > 0) g.own++;
  });
  const rules = ptRuffleRules();
  return [...by.values()].map(g => {
    const r = rules.find(x => ptRufKey(x.subtype, x.size) === g.key) || {};
    return Object.assign(g, { fabric: String(r.fabric || '').trim(), meters: r.meters == null ? '' : r.meters });
  }).sort((a, b) => a.subtype.localeCompare(b.subtype)
    || a.size.localeCompare(b.size, undefined, { numeric: true }));
}

/**
 * Save one rule. The whole list is written, as every master list is — it is small, and a partial write
 * of a list is how two people's changes end up merged into nonsense.
 */
async function ruffleRuleSave(subtype, size, fabric, meters) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const f = String(fabric || '').trim();
  const mt = String(meters == null ? '' : meters).trim();
  if (f && cutFabrics().indexOf(f) < 0) return `"${f}" is not in the Fabric Type master.`;
  if (mt !== '' && !(parseFloat(mt) > 0)) return 'The metres a piece takes must be more than nothing.';
  const k = ptRufKey(subtype, size);
  const rest = ptRuffleRules().filter(x => ptRufKey(x.subtype, x.size) !== k);
  const next = (f || mt !== '')
    ? rest.concat([{ subtype: String(subtype).trim(), size: String(size).trim(), fabric: f,
        meters: mt === '' ? '' : Math.round(parseFloat(mt) * 1000) / 1000,
        by: ME.email, at: new Date().toISOString() }])
    : rest;
  try { await ptPut('pt_masters/ruffleRule', next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.masters = PTG.masters || {};
  PTG.masters.ruffleRule = next;
  return '';
}

/**
 * Every article type and subtype the catalogue has, with the pieces still to make against each and
 * the rule if one exists. Open work is counted so the list sorts by what is actually costing money.
 */
function printCombos() {
  const by = new Map();
  const touch = (at, sub) => {
    const k = ptPrintKey(at, sub);
    if (!by.has(k)) by.set(k, { key: k, articleType: String(at || '').trim(), subtype: String(sub || '').trim(),
      skus: 0, toMake: 0 });
    return by.get(k);
  };
  (PTG.mdb || []).forEach(m => { if (m && (m.articleType || m.subtype)) touch(m.articleType, m.subtype).skus++; });
  /* Open work, so a subtype with 10,000 pieces waiting is not buried under one with two. */
  ordLines().forEach(l => {
    const left = Math.max(0, ptNum(l.pendingMake));
    if (!left) return;
    const m = mdbOf(l.sku) || {};
    if (!m.articleType && !m.subtype) return;
    touch(m.articleType, m.subtype).toMake += left;
  });
  const rules = ptPrintRules();
  return [...by.values()].map(c => Object.assign(c, {
    rule: rules.find(r => ptPrintKey(r.articleType, r.subtype) === c.key) || null,
  })).sort((a, b) => b.toMake - a.toMake || b.skus - a.skus
    || String(a.subtype).localeCompare(String(b.subtype)));
}

const PRINT_ISSUE = [['running', 'Running cloth (metres)'], ['cut', 'Cut pieces']];
const PRINT_DIRS = [['Horizontal', 'Horizontal'], ['Vertical', 'Vertical']];

/** Write one rule. Only the field that changed moves; the rest of the row is kept. */
async function printRuleSave(key, patch) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const c = printCombos().find(x => x.key === key);
  if (!c) return 'That article is not in the master database any more.';
  const f = String((patch && patch.fabric) !== undefined ? patch.fabric : (c.rule && c.rule.fabric) || '').trim();
  if (f && f !== PRINT_BY_WIDTH && cutFabrics().indexOf(f) < 0) return `"${f}" is not in the Fabric Type master.`;
  const row = Object.assign({ articleType: c.articleType, subtype: c.subtype },
    c.rule || {}, patch || {}, { by: ME.email, at: new Date().toISOString() });
  /* An empty box means "nothing said", which is not the same as a rule that says nothing. */
  ['fabric', 'dir', 'issueAs', 'lay'].forEach(k => { if (String(row[k] || '').trim() === '') delete row[k]; });
  if (row.print === '') delete row.print;
  if (row.panels !== undefined) {
    const pn = parseFloat(row.panels);
    if (String(row.panels).trim() === '') delete row.panels;
    else if (!(pn > 0 && pn <= 20)) return 'Panels a piece is how many rectangles one piece takes — 1 for a tablecloth, 2 for a quilt.';
    else row.panels = pn;
  }
  const said = row.print !== undefined || row.fabric || row.dir || row.issueAs || row.panels || row.lay;
  const rest = ptPrintRules().filter(r => ptPrintKey(r.articleType, r.subtype) !== key);
  const next = said ? rest.concat([row]) : rest;
  try { await ptPut('pt_masters/printRule', next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.masters = PTG.masters || {};
  PTG.masters.printRule = next;
  return '';
}

/** Whether a colour is ever printed. It lives on the colour, because the colour is what decides. */
async function colourPrintSave(rkey, prints) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const r = mstRows('colour').find(x => x._key === rkey);
  if (!r) return 'That colour is not on the list any more.';
  const row = Object.assign({}, r, { modifiedAt: new Date().toISOString(), modifiedBy: ME.email });
  delete row._key;
  if (prints) delete row.noPrint; else row.noPrint = true;
  await ptPut('pt_masters/colour/' + rkey, row);
  PTG.masters.colour = PTG.masters.colour || {};
  PTG.masters.colour[rkey] = row;
  CPRINT_IX = { src: null, set: null };
  renderMst();
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = prints
    ? `${r.desc || r.code} is printed again — its pieces count towards the printers.`
    : `${r.desc || r.code} is never printed. Its pieces leave the printer requirement.`;
  return '';
}

function renderPrintRules() {
  const q = String($('mstQ').value || '').trim().toLowerCase();
  const all = printCombos();
  const rows = all.filter(c => !q || (c.articleType + ' ' + c.subtype).toLowerCase().includes(q));
  const set = all.filter(c => c.rule);
  const openUnruled = all.filter(c => !c.rule && c.toMake > 0);
  $('mstKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Printing rule</span>
      <span class="kpiwhen">one rule per article and subtype — it decides what the printers are asked for</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(all.length)}</div><div class="l">Article × subtype</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(set.length)}</div><div class="l">Set</div></div>
      <div class="metric"><div class="v"${openUnruled.length ? ' style="color:var(--bad)"' : ''}>${nf(openUnruled.length)}</div><div class="l">Unruled, with work open</div></div>
      <div class="metric"><div class="v">${nf(Math.round(openUnruled.reduce((a, c) => a + c.toMake, 0)))}</div><div class="l">Pieces waiting on a rule</div></div>
    </div>
    <div class="muted" style="margin-top:8px;font-size:12px">An article with no rule is treated as
      printed, on whatever cloth its own master row names. Nothing is dropped for being unruled —
      but nothing is right either, so the ones with work open are the ones to fill in.</div>
  </div>`;

  const fabs = cutFabrics();
  const can = ptCanEdit();
  const sel = (attr, key, opts, cur, blank) => can
    ? `<select data-${attr}="${esc(key)}" style="width:100%"><option value="">${esc(blank)}</option>${
        opts.map(([v, t]) => `<option value="${esc(v)}"${String(cur || '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
    : (esc(cur) || '<span class="muted">—</span>');

  const head = '<thead><tr>' + ['Article', 'Subtype', 'SKUs', 'To make', 'Printed?', 'On which cloth', 'Direction', 'Which way it is laid', 'Given to the printer as', 'Panels a piece', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([2, 3].indexOf(i) >= 0 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';

  $('mstTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(c => {
    const r = c.rule || {};
    const noPrint = r.print === false;
    const done = r.print === false || (r.fabric || r.issueAs);
    return `<tr${c.toMake > 0 && !c.rule ? ' style="background:rgba(220,38,38,.04)"' : ''}>`
      + `<td class="frz" style="text-align:left">${esc(c.articleType) || '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left;font-weight:600">${esc(c.subtype) || '<span class="muted">—</span>'}</td>`
      + `<td class="num">${nf(c.skus)}</td>`
      + `<td class="num">${c.toMake ? '<b>' + nf(Math.round(c.toMake)) + '</b>' : '<span class="muted">—</span>'}</td>`
      + `<td style="min-width:110px">${sel('prno', c.key, [['yes', 'Printed'], ['no', 'No printing']],
          r.print === false ? 'no' : (r.print === true ? 'yes' : ''), 'not said')}</td>`
      + `<td style="min-width:150px">${noPrint ? '<span class="muted">—</span>'
          : sel('prfab', c.key, [[PRINT_BY_WIDTH, 'Whichever wastes least (by width)']].concat(fabs.map(f => [f, f])),
              r.fabric, 'each SKU’s own')}</td>`
      + `<td style="min-width:110px">${noPrint ? '<span class="muted">—</span>' : sel('prdir', c.key, PRINT_DIRS, r.dir, '—')}</td>`
      /* Not the same as Direction: this one decides whether the cutter may turn the piece on the
       * cloth, which is what picks the roll. */
      + `<td style="min-width:170px">${noPrint ? '<span class="muted">—</span>'
          : sel('prlay', c.key, PT_LAYS.slice(1), r.lay, PT_LAYS[0][1])}</td>`
      + `<td style="min-width:150px">${noPrint ? '<span class="muted">—</span>' : sel('prissue', c.key, PRINT_ISSUE, r.issueAs, 'not said')}</td>`
      /* How many rectangles one finished piece takes — a front and a back are two. The cloth
       * calculator multiplies by this, and treats a blank as one. */
      + `<td class="num">${noPrint ? '<span class="muted">—</span>' : (can
          ? `<input data-prpanels="${esc(c.key)}" type="number" min="1" max="20" step="0.01" value="${esc(r.panels == null ? '' : r.panels)}" placeholder="1" style="width:78px">`
          : (r.panels ? nf(r.panels) : '<span class="muted">1</span>'))}</td>`
      + `<td>${done ? '<span class="pill pill-ok">set</span>' : '<span class="pill pill-out">blank</span>'}</td></tr>`;
  }).join('') : `<tr><td colspan="9" class="muted" style="padding:16px">Nothing matches.</td></tr>`) + '</tbody>';
  $('mstMsg').className = 'muted';
  if (!$('mstMsg').textContent) $('mstMsg').textContent = '';
}

function renderRuffleRules() {
  const q = String($('mstQ').value || '').trim().toLowerCase();
  const all = ruffleCombos();
  const rows = all.filter(g => !q || (g.subtype + ' ' + g.size + ' ' + g.fabric).toLowerCase().includes(q));
  const set = all.filter(g => g.fabric && parseFloat(g.meters) > 0);
  const skusAll = all.reduce((a, g) => a + g.skus, 0), skusSet = set.reduce((a, g) => a + g.skus, 0);
  $('mstKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Ruffle fabric</span>
      <span class="kpiwhen">one rule per subtype and size — it covers every colour</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(all.length)}</div><div class="l">Subtype × size</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(set.length)}</div><div class="l">Set</div></div>
      <div class="metric"><div class="v"${all.length - set.length ? ' style="color:var(--bad)"' : ''}>${nf(all.length - set.length)}</div><div class="l">Still blank</div></div>
      <div class="metric"><div class="v">${nf(skusSet)} / ${nf(skusAll)}</div><div class="l">SKUs covered</div></div>
    </div></div>`;

  const fabs = cutFabrics();
  const can = ptCanEdit();
  const head = '<thead><tr>' + ['Subtype', 'Size', 'SKUs', 'Ruffle fabric', 'Metres per piece', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 2 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('mstTable').innerHTML = head + '<tbody>' + rows.map(g => {
    const k = esc(g.subtype + '|' + g.size);
    const done = g.fabric && parseFloat(g.meters) > 0;
    return '<tr>'
      + `<td class="frz" style="text-align:left">${esc(g.subtype)}</td>`
      + `<td>${esc(g.size)}</td>`
      + `<td class="num">${nf(g.skus)}</td>`
      + `<td>${can ? `<select data-ruf-fab="${k}" style="width:170px"><option value="">—</option>${
          fabs.map(f => `<option value="${esc(f)}"${f === g.fabric ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>`
          : esc(g.fabric) || '<span class="muted">—</span>'}</td>`
      + `<td>${can ? `<input data-ruf-m="${k}" type="number" min="0" step="0.01" value="${esc(g.meters)}" placeholder="0.00" style="width:100px">`
          : (g.meters === '' ? '<span class="muted">—</span>' : esc(g.meters))}</td>`
      + `<td>${done ? '<span class="pill pill-ok">set</span>' : '<span class="pill pill-out">blank</span>'}${
          g.own ? ` <span class="muted" style="font-size:11px" title="These SKUs carry their own ruffle figures on the master row, which win over this rule.">${nf(g.own)} own</span>` : ''}</td>`
      + '</tr>';
  }).join('') + '</tbody>';
  $('mstMsg').className = all.length - set.length ? 'err' : 'muted';
  $('mstMsg').textContent = all.length - set.length
    ? `${nf(all.length - set.length)} subtype and size combination(s) still have no ruffle fabric, so issuing those SKUs deducts no ruffle.`
    : 'Every ruffle size has its fabric and metres.';
  MST.shown = rows;
}

function renderMst() {
  if (MST.busy) { $('mstMsg').className = 'muted'; $('mstMsg').textContent = 'Reading the masters…'; ptEmpty('mstTable', 'Loading…'); return; }
  const cur = $('mstPick').value || MST.key;
  MST.key = cur;
  ptFillSelect('mstPick', MASTERS.map(m => [m[0], m[0] === 'ruffleRule'
    ? `${m[1]} · ${nf(ptRuffleRules().length)} set`
    : m[0] === 'printRule'
      ? `${m[1]} · ${nf(printCombos().filter(c => c.rule).length)} of ${nf(printCombos().length)} set`
      : `${m[1]} · ${nf(mstRows(m[0]).length)}`]), 'Pick a list');
  if (!$('mstPick').value) $('mstPick').value = cur;
  /* The sheet is for code-and-name lists, and changes them, so it is for an admin. */
  ['mstTpl', 'mstImp'].forEach(id => { const el = $(id); if (el) el.classList.toggle('hide', !ME.admin || MST_SHEET_OFF.indexOf(cur) >= 0); });
  /* The ruffle rules are a different shape of list, and draw themselves. */
  if (cur === 'ruffleRule') {
    ['mstNew', 'mstOffWrap'].forEach(id => { const el = $(id); if (el) el.classList.add('hide'); });
    return renderRuffleRules();
  }
  if (cur === 'printRule') {
    ['mstNew', 'mstOffWrap'].forEach(id => { const el = $(id); if (el) el.classList.add('hide'); });
    return renderPrintRules();
  }
  ['mstNew', 'mstOffWrap'].forEach(id => { const el = $(id); if (el) el.classList.remove('hide'); });

  const def = mstDef(cur);
  const rows = mstRows(cur);
  $('mstKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">${esc(def[1])}</span>
      <span class="kpiwhen">${esc(def[2])}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.filter(r => r.active !== false).length)}</div><div class="l">In use</div></div>
      <div class="metric"><div class="v" style="color:var(--muted)">${nf(rows.filter(r => r.active === false).length)}</div><div class="l">Retired</div></div>
    </div></div>`;

  const q = $('mstQ').value.trim().toLowerCase();
  const showOff = $('mstOff').checked;
  const parents = def[3] ? mstRows(def[3]) : null;
  const shown = rows
    .filter(r => showOff || r.active !== false)
    .filter(r => !q || [r.code, r.desc].join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(a.desc || a.code || '').localeCompare(String(b.desc || b.code || '')));

  /* A fabric's width is what turns pieces into square metres. It is typed here and nowhere else. */
  const isFab = cur === 'fabricType';
  /* Some colours are never printed — white ones. That is a fact about the colour, so it lives here. */
  const isCol = cur === 'colour';
  const head = '<thead><tr>' + ['Code', 'Name'].concat(def[3] ? ['Belongs to'] : [])
    .concat(isFab ? ['Width (inches)', 'Greige name (what the mill is sent)'] : [])
    .concat(isCol ? ['Printed?'] : [])
    .concat(['In records', 'State', '']).map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
  $('mstTable').innerHTML = head + '<tbody>' + (shown.length ? shown.map(r => {
    const used = mstUsage(cur, r.desc || r.code);
    const p = parents && parents.find(x => String(x.code) === String(r.parentCode));
    return `<tr${r.active === false ? ' style="opacity:.55"' : ''}>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.code)}</td>`
      + `<td style="text-align:left;font-weight:600">${esc(r.desc)}</td>`
      + (def[3] ? `<td>${esc(p ? (p.desc || p.code) : r.parentCode) || '<span class="muted">—</span>'}</td>` : '')
      + (isFab ? `<td class="num">${ME.admin
          ? `<input data-fabw="${esc(r._key)}" type="number" min="1" max="200" step="0.5" value="${esc(r.widthIn == null ? '' : r.widthIn)}" placeholder="—" style="width:78px">`
          : (r.widthIn ? nf(r.widthIn) : '<span class="muted">—</span>')}${
          !r.widthIn && !voFabWidthM(r.desc || r.code)
            ? '<div class="err" style="font-size:10.5px;font-weight:400">no width — its cloth cannot be measured</div>'
            : (!r.widthIn ? `<div class="muted" style="font-size:10.5px">from the name</div>` : '')}</td>` : '')
      + (isFab ? `<td>${ME.admin
          ? `<input data-fabg="${esc(r._key)}" type="text" value="${esc(r.greige || '')}" placeholder="e.g. Greige Sheeting 67" style="width:180px">`
          : (r.greige ? esc(r.greige) : '<span class="muted">—</span>')}</td>` : '')
      + (isCol ? `<td>${ME.admin
          ? `<select data-colprint="${esc(r._key)}" style="width:118px"><option value="yes"${r.noPrint === true ? '' : ' selected'}>Printed</option><option value="no"${r.noPrint === true ? ' selected' : ''}>No printing</option></select>`
          : (r.noPrint === true ? '<span class="pill pill-out">no printing</span>' : '<span class="muted">printed</span>')}</td>` : '')
      + `<td class="num">${used ? nf(used) : '<span class="muted">—</span>'}</td>`
      + `<td>${r.active === false ? '<span class="pill pill-out">retired</span>' : '<span class="pill pill-ok">in use</span>'}</td>`
      + `<td>${ME.admin ? `<button class="ghost" data-mst="${esc(r._key)}" style="padding:2px 9px;font-size:12px">Edit</button>` : ''}</td></tr>`;
  }).join('') : `<tr><td colspan="6" class="muted" style="padding:16px">Nothing in this list yet.</td></tr>`) + '</tbody>';

  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = `${nf(shown.length)} of ${nf(rows.length)} row(s)`
    + ' · a form accepts a value that matches either the code or the name'
    + ' · "In records" is how many existing records would keep the old text if this row were renamed';
}

function mstEdit(rkey) {
  const key = MST.key, def = mstDef(key);
  const r = mstRows(key).find(x => x._key === rkey);
  const isNew = !r;
  const parents = def[3] ? mstRows(def[3]).filter(x => x.active !== false) : null;
  const used = r ? mstUsage(key, r.desc || r.code) : 0;
  ptOpenDialog({
    title: (isNew ? 'New ' : 'Edit ') + def[1].toLowerCase(),
    subtitle: def[2],
    note: isNew ? 'The code is the short form, the name is what people read. A form accepts either.'
      : (used ? `${nf(used)} existing record(s) carry "${r.desc || r.code}". Renaming this row does NOT `
          + 'change them — they will still say the old thing. Retiring it and adding a new row is usually '
          + 'the safer move.'
        : 'Nothing uses this row yet, so it can be renamed freely.'),
    fields: [
      { key: 'code', label: 'Code', value: r ? r.code : '' },
      { key: 'desc', label: 'Name', value: r ? r.desc : '' },
    ].concat(key === 'fabricType' ? [{ key: 'widthIn', label: 'Width (inches)',
        value: r && r.widthIn != null ? String(r.widthIn) : '' }] : [])
      .concat(parents ? [{ key: 'parentCode', label: 'Belongs to', type: 'select',
        options: [''].concat(parents.map(p => p.code)), value: r ? r.parentCode : '', span: true }] : [])
      .concat([{ key: 'active', label: 'State', type: 'select', options: ['in use', 'retired'],
        value: (r && r.active === false) ? 'retired' : 'in use', span: true }]),
    onSave: v => mstSave(rkey, v),
    saveLabel: isNew ? 'Add it' : 'Save',
  });
}

async function mstSave(rkey, v) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const key = MST.key, def = mstDef(key);
  const code = String(v.code || '').trim();
  const desc = String(v.desc || '').trim();
  if (!code) return 'Give it a code.';
  if (!desc) return 'Give it a name.';
  /* A code becomes part of a database key nowhere here, but it IS what a subtype points its parent
   * at — two rows sharing one code would make that pointer ambiguous. */
  const clash = mstRows(key).find(x => x._key !== rkey && String(x.code || '').trim().toLowerCase() === code.toLowerCase());
  if (clash) return `The code "${code}" is already used by "${clash.desc || clash.code}".`;
  if (def[3] && !String(v.parentCode || '').trim()) return `Pick which ${mstDef(def[3])[1].toLowerCase()} this belongs to.`;

  const existing = rkey ? mstRows(key).find(x => x._key === rkey) : null;
  /* Retiring a parent would leave its children pointing at something no form will offer. */
  if (existing && v.active === 'retired' && existing.active !== false) {
    const kids = MASTERS.filter(m => m[3] === key)
      .flatMap(m => mstRows(m[0]).filter(x => x.active !== false && String(x.parentCode) === String(existing.code)));
    if (kids.length) return `${nf(kids.length)} ${mstDef(MASTERS.find(m => m[3] === key)[0])[1].toLowerCase()}(s) still belong to `
      + `"${existing.desc || existing.code}": ${kids.slice(0, 4).map(k => k.desc || k.code).join(', ')}`
      + `${kids.length > 4 ? ` and ${kids.length - 4} more` : ''}. Retire those first.`;
  }

  const now = new Date().toISOString();
  const k = rkey || mstNextKey(key);
  const row = Object.assign({}, existing || { createdAt: now, createdBy: ME.email }, {
    code, desc, active: v.active !== 'retired', modifiedAt: now, modifiedBy: ME.email,
  });
  if (def[3]) row.parentCode = String(v.parentCode || '').trim();
  if (key === 'fabricType') {
    const txt = String(v.widthIn == null ? '' : v.widthIn).trim();
    const w = parseFloat(txt);
    if (txt && !(w > 0 && w <= 200)) return 'A width is in inches — something between 1 and 200, or leave it empty.';
    if (txt) row.widthIn = w; else delete row.widthIn;
    FABW_IX = { src: null, map: null };
  }
  delete row._key;
  await ptPut('pt_masters/' + key + '/' + k, row);
  PTG.masters[key] = PTG.masters[key] || {};
  PTG.masters[key][k] = row;
  renderMst();
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = existing
    ? `"${desc}" saved.` + (row.active ? '' : ' It is retired, so no form will offer it any more — records that already use it are untouched.')
    : `"${desc}" added to ${def[1].toLowerCase()}. Every entry form will accept it from now on.`;
  return '';
}

$('mstTable').addEventListener('click', e => {
  const b = e.target.closest('[data-mst]'); if (b) mstEdit(b.getAttribute('data-mst'));
});
/* The width saves the moment it is typed — one field, no dialog to open and close 9 times. */
$('mstTable').addEventListener('change', async e => {
  const k = e.target.getAttribute && e.target.getAttribute('data-fabw');
  if (!k) return;
  const err = await fabWidthSave(k, e.target.value);
  $('mstMsg').className = err ? 'err' : 'muted';
  if (err) $('mstMsg').textContent = err;
});

$('mstTable').addEventListener('change', async e => {
  const k = e.target.getAttribute && e.target.getAttribute('data-fabg');
  if (!k) return;
  const err = await fabGreigeSave(k, e.target.value);
  $('mstMsg').className = err ? 'err' : 'muted';
  if (err) $('mstMsg').textContent = err;
});

/**
 * The name this fabric's greige is bought under. One greige name belongs to one fabric — two would
 * leave "RFD received" not knowing which it had become.
 */
async function fabGreigeSave(rkey, value) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const r = mstRows('fabricType').find(x => x._key === rkey);
  if (!r) return 'That fabric is not on the list any more.';
  const txt = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  const clash = txt && mstRows('fabricType').find(x => x._key !== rkey && x.active !== false
    && String(x.greige || '').trim().toLowerCase() === txt.toLowerCase());
  if (clash) return `${txt} is already the greige of ${clash.desc || clash.code}. One greige name, one fabric.`;
  const row = Object.assign({}, r, { modifiedAt: new Date().toISOString(), modifiedBy: ME.email });
  delete row._key;
  if (txt) row.greige = txt; else delete row.greige;
  await ptPut('pt_masters/fabricType/' + rkey, row);
  PTG.masters.fabricType = PTG.masters.fabricType || {};
  PTG.masters.fabricType[rkey] = row;
  renderMst();
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = txt ? `${r.desc || r.code} is bought as ${txt}.` : `${r.desc || r.code} has no greige name — it cannot go on a greige PO.`;
  return '';
}

/** Put a width on one fabric. Nothing else on the row is touched. */
async function fabWidthSave(rkey, value) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const r = mstRows('fabricType').find(x => x._key === rkey);
  if (!r) return 'That fabric is not on the list any more.';
  const txt = String(value == null ? '' : value).trim();
  const w = parseFloat(txt);
  if (txt && !(w > 0 && w <= 200)) return 'A width is in inches — something between 1 and 200, or empty for none.';
  const row = Object.assign({}, r, { modifiedAt: new Date().toISOString(), modifiedBy: ME.email });
  delete row._key;
  if (txt) row.widthIn = w; else delete row.widthIn;
  await ptPut('pt_masters/fabricType/' + rkey, row);
  PTG.masters.fabricType = PTG.masters.fabricType || {};
  PTG.masters.fabricType[rkey] = row;
  FABW_IX = { src: null, map: null };
  renderMst();
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = txt
    ? `${r.desc || r.code} is ${nf(w)} inches wide. Every square-metre figure now counts its cloth.`
    : `${r.desc || r.code} has no width again — its cloth will not be counted.`;
  return '';
}
$('mstPick').addEventListener('change', renderMst);
$('mstOff').addEventListener('change', renderMst);
ptDebounce('mstQ', renderMst);
$('mstNew').onclick = () => mstEdit(null);
$('mstGo').onclick = async () => { PTG.masters = null; PTG.mdb = null; await ptLoadGates(); MST.at = ptStamp(); renderMst(); };

