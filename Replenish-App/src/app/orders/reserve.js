/* ================= RESERVE =================
 *
 * What the approved sales orders need, that no printer has been given. Computed, never stored — a
 * SKU is in reserve exactly while nobody has ordered it, and it drops off when an order is placed.
 *
 * Split three ways, because "short of a printer order" and "can be given to a printer" are not the
 * same thing and treating them as one would be believable and wrong. Only tablecloths and table
 * runners can be ordered as cut pieces (voCutAllowed — the printers' own limit); everything else is
 * printed as running fabric in metres, which is ordered by fabric and colour and never by SKU.
 */
const RES_GROUP = { ready: 'ready', metres: 'metres', unknown: 'unknown' };
let RES_PICK = new Set();

/**
 * Where a SKU's need came from, per channel. The sales order's own number carries it — AMZ-…, SHP-…,
 * B2B-… — so this is the same demand voDemandMap() counts, only kept apart instead of added up.
 *
 * SHP- is the order raised automatically from a Shopify order marked "required from production".
 * Those have always been part of Needed; this is what makes that visible.
 */
function resSourceMap() {
  const names = {};
  soChannels().forEach(c => { names[c.code] = c.name; });
  names.SHP = names.SHP || 'Shopify';
  const m = new Map();
  (SOX.rows || []).filter(o => o && o.status === 'approved').forEach(o => {
    const code = (String(o._id || o._key || '').toUpperCase().match(/^[A-Z]+/) || ['?'])[0];
    const label = names[code] || code;
    soLines(o).forEach(l => {
      const s = obUC(l.sku); if (!s) return;
      let e = m.get(s); if (!e) { e = new Map(); m.set(s, e); }
      e.set(label, (e.get(label) || 0) + (parseFloat(l.qty) || 0));
    });
  });
  return m;
}
/** "Amazon 271 · Shopify 21", biggest first. */
/** The same split across a whole list, so the header can state it without recounting by hand. */
function resTotals(rows) {
  const t = new Map();
  (rows || []).forEach(r => {
    if (!r.src) return;
    /* Apportioned by what is STILL to place, not by the whole demand — the header has to add up to
     * the number beside it, or it is just a second, different figure sitting next to the first. */
    const need = r.need || 0;
    r.src.forEach((q, k) => t.set(k, (t.get(k) || 0) + (need ? r.left * (q / need) : 0)));
  });
  const out = new Map();
  t.forEach((v, k) => out.set(k, Math.round(v)));
  return out;
}
const resSrcText = src => !src ? ''
  : [...src.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + nf(v)).join(' · ');

/** Every SKU short of a printer order, with what it is and which pile it belongs in. */
function resRows() {
  const demand = voDemandMap(), existing = voExistingMap(), src = resSourceMap();
  const out = [];
  demand.forEach((need, sku) => {
    const on = existing.get(sku) || 0;
    const left = need - on;
    if (left <= 1e-9) return;                       // fully with a printer already
    const m = mdbOf(sku);
    const group = !m ? RES_GROUP.unknown
      : (voCutAllowed(m.articleType, m.subtype) ? RES_GROUP.ready : RES_GROUP.metres);
    out.push({ sku, need, on, left, m: m || null, group, src: src.get(sku) || null });
  });
  return out.sort((a, b) => b.left - a.left || a.sku.localeCompare(b.sku));
}

/** Which printers already hold some of this SKU — so a second order is a knowing choice. */
function resWho(sku) {
  const s = obUC(sku), names = new Set();
  (VO.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled' || (o.demandSource || 'bulk') !== 'bulk') return;
    if (!voLines(o).some(l => l && !l.cancelled && voKind(l) === 'cut' && obUC(l.sku) === s)) return;
    names.add(voName(o.vendorCode) || o.vendorCode);
  });
  return [...names];
}

function resRender() {
  const rows = resRows();
  const ready = rows.filter(r => r.group === RES_GROUP.ready);
  const metres = rows.filter(r => r.group === RES_GROUP.metres);
  const unknown = rows.filter(r => r.group === RES_GROUP.unknown);
  const pcs = a => a.reduce((s, r) => s + r.left, 0);
  const desc = r => r.m ? [r.m.articleType, r.m.subtype, r.m.color, r.m.size].filter(Boolean).join(' · ')
    : '<span class="err">not in the master database</span>';

  const pickable = ready.map(r => {
    const who = resWho(r.sku);
    return '<tr>'
      + `<td><input type="checkbox" class="res-pick" data-res="${esc(r.sku)}" style="width:auto"${RES_PICK.has(r.sku) ? ' checked' : ''}></td>`
      + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
      + `<td style="text-align:left">${desc(r)}</td>`
      + `<td class="num">${nf(r.need)}</td>`
      + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(resSrcText(r.src))}</td>`
      + `<td class="num">${r.on ? nf(r.on) : '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="font-weight:700">${nf(r.left)}</td>`
      + `<td style="text-align:left;font-size:11.5px" class="muted">${who.length ? esc(who.join(', ')) : 'nobody yet'}</td>`
      + '</tr>';
  }).join('');

  const plain = list => list.slice(0, 300).map(r => '<tr>'
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + `<td style="text-align:left">${desc(r)}</td>`
    + `<td class="num" style="font-weight:700">${nf(r.left)}</td></tr>`).join('');

  const picked = ready.filter(r => RES_PICK.has(r.sku));
  $('ptDlgBody').innerHTML = `
    <div class="muted" style="font-size:12.5px;margin-bottom:10px">
      ${nf(rows.length)} SKU(s) the approved sales orders still need, ${nf(pcs(rows))} pcs in all.
      This list is worked out live — a SKU leaves it the moment an order covers it.
      <br><b>Needed</b> is the approved sales orders — every channel, Shopify included:
      ${esc(resSrcText(resTotals(rows))) || 'nothing outstanding'}.</div>

    <div style="font-weight:700;margin:4px 0 6px">Ready to give a printer — ${nf(ready.length)} SKU(s), ${nf(pcs(ready))} pcs</div>
    ${ready.length ? `<div class="toolbar" style="margin-bottom:8px">
        <button id="resAll" class="ghost" style="padding:4px 10px;font-size:12px">Select all</button>
        <button id="resNone" class="ghost" style="padding:4px 10px;font-size:12px">Clear</button>
        <span style="flex:1"></span>
        <span class="muted" style="font-size:12px">${nf(picked.length)} picked · ${nf(pcs(picked))} pcs</span>
        <button id="resSend"${picked.length ? '' : ' disabled'}>Send to a printer</button>
      </div>
      <div class="xlwrap" style="max-height:38vh"><table class="xl">
        <thead><tr><th></th><th>SKU</th><th>Item</th><th class="num">Needed</th><th>Needed by</th><th class="num">With printers</th><th class="num">Still to place</th><th>Who has it</th></tr></thead>
        <tbody>${pickable}</tbody></table></div>`
      : '<div class="muted" style="padding:10px 4px">Nothing — every tablecloth and table runner the sales orders need is already on a printer\'s order.</div>'}

    ${metres.length ? `<div style="font-weight:700;margin:16px 0 4px">Printed as running fabric, not as a SKU — ${nf(metres.length)} SKU(s), ${nf(pcs(metres))} pcs</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Only tablecloths and table runners can be ordered from a printer as cut pieces. These are printed
        as running fabric in metres, which is ordered by fabric and colour — so there is no per-SKU order to place here.
        Raise those with <b>+ New vendor order → Running fabric</b>.</div>
      <div class="xlwrap" style="max-height:26vh"><table class="xl">
        <thead><tr><th>SKU</th><th>Item</th><th class="num">Still to place</th></tr></thead>
        <tbody>${plain(metres)}</tbody></table></div>${metres.length > 300 ? `<div class="muted" style="font-size:12px;margin-top:4px">showing the first 300 of ${nf(metres.length)}</div>` : ''}` : ''}

    ${unknown.length ? `<div style="font-weight:700;margin:16px 0 4px">Not in the master database — ${nf(unknown.length)} SKU(s), ${nf(pcs(unknown))} pcs</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">A sales order asks for these, but nothing here knows what they are, so no order can name them.
        Add them under Master Database and they move into one of the lists above.</div>
      <div class="xlwrap" style="max-height:22vh"><table class="xl">
        <thead><tr><th>SKU</th><th>Item</th><th class="num">Still to place</th></tr></thead>
        <tbody>${plain(unknown)}</tbody></table></div>` : ''}`;

  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('resAll', () => { ready.forEach(r => RES_PICK.add(r.sku)); resRender(); });
  on('resNone', () => { RES_PICK.clear(); resRender(); });
  on('resSend', () => resSend());
}

/** Hand the picked SKUs to the ordinary order form, already filled in. */
async function resSend() {
  const rows = resRows().filter(r => r.group === RES_GROUP.ready && RES_PICK.has(r.sku));
  if (!rows.length) return;
  /* The form's own dialog replaces this one, so the picks are read out first. */
  await voFormOpen();
  voSetKind('cut');
  VOF.lines = rows.map(r => ({
    lineId: 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    kind: 'cut', sku: r.sku,
    articleType: (r.m && r.m.articleType) || '', articleSubtype: (r.m && r.m.subtype) || '',
    color: (r.m && r.m.color) || '', size: (r.m && r.m.size) || '',
    /* Whole pieces: a printer cannot make a third of a tablecloth. */
    qty: Math.ceil(r.left), deliveryDate: '', priority: '', notes: '', dispatchedQty: 0,
  }));
  voDraft();
  RES_PICK.clear();
  ptDlgMsg(`${nf(VOF.lines.length)} line(s) brought over from Reserve — pick the printer above, then Save.`);
}

async function resOpen() {
  if (VO.rows === null) await ensureVo();
  if (!PTG.mdb) await ptLoadGates();
  if (SOX.rows === null) { try { SOX.rows = ptList(await ptGet('pt_salesOrders')); } catch (e) { SOX.rows = SOX.rows || []; } }
  RES_PICK.clear();
  ptOpenDialog({
    title: 'Reserve',
    subtitle: 'What the approved sales orders need that no printer has been given yet',
    note: 'Nothing here is stored. A SKU sits in reserve exactly while no order covers it, and leaves '
      + 'the moment one does — so this cannot drift out of step with the orders.',
    html: '<div id="resBody"></div>',
  });
  resRender();
}

/* The tick boxes are redrawn on every render, so they are caught by delegation rather than bound. */
$('ptDlgBody').addEventListener('change', e => {
  const b = e.target.closest('[data-res]');
  if (!b) return;
  const sku = b.getAttribute('data-res');
  if (b.checked) RES_PICK.add(sku); else RES_PICK.delete(sku);
  resRender();
});

$('voReserve').onclick = () => resOpen();

function voDraft() {
  const unit = VOF.kind === 'running' ? 'm' : 'pcs';
  $('vof_table').innerHTML = '<thead><tr><th>Item</th><th class="num">Qty</th><th>Delivery</th><th>Priority</th><th>Notes</th><th></th></tr></thead><tbody>'
    + (VOF.lines.length ? VOF.lines.map(l => '<tr>'
      + `<td style="text-align:left">${esc(voKind(l) === 'running'
        ? (l.sku ? '[' + l.sku + '] ' : '') + [l.fabricType, l.color, l.printDirection ? 'print ' + l.printDirection : ''].filter(Boolean).join(' · ')
        : '[' + l.sku + '] ' + [l.articleType, l.articleSubtype, l.color, l.size].filter(Boolean).join(' · '))}</td>`
      + `<td class="num" style="font-weight:700">${nf(voKind(l) === 'running' ? l.meters : l.qty)} <span class="muted" style="font-size:11px">${unit}</span></td>`
      + `<td>${esc(l.deliveryDate) || '<span class="muted">—</span>'}</td>`
      + `<td>${esc(l.priority) || '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left;font-size:11.5px" class="muted">${esc(l.notes)}</td>`
      + `<td><button class="ghost" data-vofdel="${esc(l.lineId)}" style="padding:2px 8px;color:var(--bad)">✕</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="muted" style="padding:14px">No lines added yet.</td></tr>')
    + '</tbody>';
  const tot = VOF.lines.reduce((s, l) => s + (parseFloat(voKind(l) === 'running' ? l.meters : l.qty) || 0), 0);
  const to = (($('vof_vendor') || {}).selectedOptions || [])[0];
  $('vof_tot').innerHTML = `<b>${nf(VOF.lines.length)} line(s) · ${nf(tot)} ${unit}</b>${to && to.value ? ' to ' + esc(String(to.textContent).replace(/\s*\(.*\)\s*$/, '')) : ''}`;
}

$('ptDlgBody').addEventListener('click', async e => {
  const k = e.target.closest('[data-pinlink]');
  if (k) {
    const code = k.getAttribute('data-pinlink');
    k.disabled = true;
    ptDlgMsg('Linking…');
    try { const err = await pinLink(code); ptDlgMsg(err || $('voMsg').textContent, !!err); }
    catch (err) { ptDlgMsg('Not linked: ' + (err.message || err), true); }
    k.disabled = false;
    return;
  }
  const g = e.target.closest('[data-pin]');
  if (g) {
    const code = g.getAttribute('data-pin');
    if (!confirm('Create a phone login for this printer?\n\nA six-digit PIN is generated and shown '
      + 'to you once. It is their password — pass it on in person or on a call, not in writing where '
      + 'it will sit forever.')) return;
    g.disabled = true;
    ptDlgMsg('Setting it up…');
    try { const err = await pinGrant(code); ptDlgMsg(err || $('voMsg').textContent, !!err); }
    catch (err) { ptDlgMsg('Not done: ' + (err.message || err), true); }
    g.disabled = false;
    return;
  }
  const d = e.target.closest('[data-vofdel]');
  if (d) { VOF.lines = VOF.lines.filter(l => l.lineId !== d.getAttribute('data-vofdel')); voDraft(); }
});

/* ---- lines from a file ---- */
function voTemplate(kind) {
  if (kind === 'running') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([voRunningXlsx()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'vendor-order-running-' + dToday() + '.xlsx';
    a.click(); URL.revokeObjectURL(a.href);
    return;
  }
  ptDownload('vendor-order-' + kind, [['SKU', 'Quantity (Pcs)', 'Delivery Date', 'Priority', 'Notes'].map(csvCell).join(','),
    ['RTC0009-5270', 100, '25-09-2026', 'P1', ''].map(csvCell).join(',')]);
}

/**
 * The running-fabric sheet, as .xlsx with dropdowns.
 *
 * Ravi: "dropdown me bhi detail available ho, aur main custom bhi add kar sakun." So:
 *   Fabric SKU       — every catalogue SKU with what it is: "RBPSF004-V-82 | Emerald Green · Sheeting 82 · Vertical"
 *   Fabric Type      — the Fabric Type master     ┐ filled from the SKU by formula when one is picked,
 *   Color            — the Colour master          │ and each still a dropdown of its own
 *   Print Direction  — Horizontal / Vertical      ┘
 *   Priority         — P1–P4
 * None of the dropdowns refuses a value that is not on its list, so a custom fabric or colour can be
 * typed straight in. The upload reads the SKU before the " | ", so a picked entry and a typed SKU are
 * the same thing.
 */
const VO_XLSX_ROWS = 300;
function voRunningXlsx() {
  const cat = [...voFabricCatalogue().values()];
  const show = r => r.sku + ' | ' + [r.colour, r.fabric, r.width ? r.dir : '', r.side || ''].filter(Boolean).join(' · ');
  const fabrics = voMasterList('fabricType', 'fabric'), colours = voMasterList('colour', 'color');
  const dirs = ['Horizontal', 'Vertical'], pris = ['P1', 'P2', 'P3', 'P4'];
  const head = ['Fabric SKU', 'Fabric Type', 'Color', 'Print Direction', 'Quantity (Meters)', 'Delivery Date', 'Priority', 'Notes'];
  const str = (v, ref, st) => { const t = String(v == null ? '' : v); return t === '' ? '' : `<c r="${ref}" t="inlineStr"${st ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`; };
  const fx = (ref, f) => `<c r="${ref}" t="str"><f>${soXml(f)}</f></c>`;
  const look = (r, n) => `IF($A${r}="","",IFERROR(VLOOKUP($A${r},FabricInfo,${n},FALSE),IFERROR(VLOOKUP(UPPER($A${r}),FabricInfoSku,${n},FALSE),"")))`;
  let rowsX = `<row r="1">${head.map((h, i) => str(h, soColName(i) + '1', true)).join('')}</row>`;
  for (let r = 2; r <= VO_XLSX_ROWS + 1; r++) rowsX += `<row r="${r}">${fx('B' + r, look(r, 2))}${fx('C' + r, look(r, 3))}${fx('D' + r, look(r, 4))}</row>`;
  const last = VO_XLSX_ROWS + 1;
  const dv = (c, name, prompt) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" promptTitle="${soXml(head[c.charCodeAt(0) - 65])}" prompt="${soXml(prompt)}" sqref="${c}2:${c}${last}"><formula1>${name}</formula1></dataValidation>`;
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + [44, 16, 22, 16, 17, 15, 9, 30].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rowsX + '</sheetData>'
    + '<dataValidations count="5">'
    + dv('A', 'FabricSkus', 'Pick a fabric SKU — fabric type, colour and direction fill in. Or type a SKU.')
    + dv('B', 'FabricTypes', 'Pick, or type your own fabric.')
    + dv('C', 'Colours', 'Pick, or type your own colour.')
    + dv('D', 'Directions', 'Horizontal or Vertical.')
    + dv('G', 'Priorities', 'P1 is the most urgent.')
    + '</dataValidations></worksheet>';
  const n = Math.max(cat.length, fabrics.length, colours.length, 4, 1);
  let lr = '';
  for (let i = 0; i < n; i++) {
    const c = cat[i], r = i + 1;
    lr += `<row r="${r}">`
      + (c ? str(show(c), 'A' + r) + str(c.fabric, 'B' + r) + str(c.colour, 'C' + r) + str(c.dir, 'D' + r)
          + str(c.sku, 'F' + r) + str(c.fabric, 'G' + r) + str(c.colour, 'H' + r) + str(c.dir, 'I' + r) : '')
      + str(fabrics[i], 'K' + r) + str(colours[i], 'L' + r) + str(dirs[i], 'M' + r) + str(pris[i], 'N' + r)
      + '</row>';
  }
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + lr + '</sheetData></worksheet>';
  const rng = (c1, c2, len) => `Lists!$${c1}$1:$${c2}$${Math.max(len, 1)}`;
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Running fabric" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames>'
    + `<definedName name="FabricSkus">${rng('A', 'A', cat.length)}</definedName>`
    + `<definedName name="FabricInfo">${rng('A', 'D', cat.length)}</definedName>`
    + `<definedName name="FabricInfoSku">${rng('F', 'I', cat.length)}</definedName>`
    + `<definedName name="FabricTypes">${rng('K', 'K', fabrics.length)}</definedName>`
    + `<definedName name="Colours">${rng('L', 'L', colours.length)}</definedName>`
    + `<definedName name="Directions">${rng('M', 'M', 2)}</definedName>`
    + `<definedName name="Priorities">${rng('N', 'N', 4)}</definedName>`
    + '</definedNames><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2], ['xl/styles.xml', styles],
  ]);
}

/* A SHOPIFY ORDER GOES THROUGH (2026-09-28). For "For: Shopify / CPC Shopify" a SKU the master lacks is taken with its
 * look-alike's article, colour and size and put on the Custom SKUs list when the order is placed; a non-cut item (a
 * napkin, a quilt) may go to a printer; and the printer cap — measured against the order book — is not applied, because a
 * Shopify order's pieces are not on the book until production opens them. */
const voForShopify = () => /Shopify/.test(String(($('vof_channel') || {}).value || ''));
function voCustomLine(sku) {
  const g = skuLookalike(sku) || {};
  return { sku: obUC(sku), articleType: g.articleType || '', subtype: g.subtype || '', color: g.color || '', size: g.size || '',
    brand: /^CPC/.test(obUC(sku)) ? 'CPC' : 'Ridhi', isCustomNew: true };
}
/** The Custom SKUs records a placed order still needs: one per new SKU nobody has catalogued yet. */
function voCustomRecs(lines) {
  const have = new Set((PTG.mdb || []).map(r => obUC(r && r.sku)).concat(((typeof MDBX !== 'undefined' && MDBX.custom) || []).map(r => obUC(r && r.sku))));
  const out = {}, now = new Date().toISOString();
  (lines || []).forEach(l => {
    const k = obUC(l && l.sku);
    if (!l || !l.customNew || !k || have.has(k) || out['pt_customSkus/' + k]) return;
    out['pt_customSkus/' + k] = { sku: k, articleType: l.articleType || '', subtype: l.articleSubtype || '', color: l.color || '', size: l.size || '',
      brand: l.brand || '', cuttingRequired: true, isCustom: true, fromVendorOrder: true, addedBy: ME.email, addedAt: now,
      lookalikeFrom: (skuLookalike(k) || {}).basis || '' };
  });
  return out;
}
/** The check file: every row of the upload, right or wrong, and why. */
function voCheckFileRows(report) {
  return [['Row', 'SKU / fabric', 'Quantity', 'Result', 'Why']].concat((report || []).map(x => [x.row, x.what, x.qty, x.ok ? 'Right' : 'Wrong', x.why || '']));
}
let VO_UP = { report: [], good: [], name: '' };

async function voBulkFile(file, kind) {
  ptDlgMsg('Reading ' + file.name + '…');
  let rows;
  try { rows = await pkReadFile(file); }
  catch (e) { ptDlgMsg('Could not read that file: ' + (e.message || e), true); return; }
  const head = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
  const ix = n => colIdx(head, n);
  const c = kind === 'running'
    ? { fsku: ix(['fabric sku', 'fabricsku', 'sku']), fab: ix(['fabric type', 'fabrictype']), col: ix(['color', 'colour']), pd: ix(['print direction', 'printdirection']),
        qty: ix(['quantity (meters)', 'quantity', 'qty', 'meters']), dd: ix(['delivery date', 'delivery']),
        pr: ix(['priority', 'priority (p1-p4)']), nt: ix(['notes']) }
    : { sku: ix(['sku']), qty: ix(['quantity (pcs)', 'quantity', 'qty', 'pieces']), dd: ix(['delivery date', 'delivery']),
        pr: ix(['priority', 'priority (p1-p4)']), nt: ix(['notes']) };
  if ((kind === 'cut' && c.sku < 0) || c.qty < 0) {
    ptDlgMsg('That file does not have the columns this order needs. Download the template to see the shape.', true); return;
  }

  const out = [], errors = [], report = [];
  const shop = voForShopify();
  rows.slice(1).forEach((r, n) => {
    const at = i => (i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : '');
    const row = 'Row ' + (n + 2) + ': ';
    /* EVERY ROW IS REPORTED, right or wrong (2026-09-28). */
    const e0 = errors.length, o0 = out.length;
    const what = kind === 'running' ? [at(c.fsku), at(c.fab), at(c.col)].filter(Boolean).join(' · ') : obUC(at(c.sku));
    const note = () => {
      if (errors.length > e0) report.push({ row: n + 2, what, qty: at(c.qty), ok: false, why: errors[errors.length - 1].replace(row, '') });
      else if (out.length > o0) report.push({ row: n + 2, what, qty: at(c.qty), ok: true, why: out[out.length - 1].customNew ? 'new SKU — goes on the Custom SKUs list' : '', line: out[out.length - 1] });
    };
    const qty = parseFloat(at(c.qty)) || 0;
    const ddRaw = at(c.dd);
    /* Excel stores a typed date as a day number (46290 = 25 Sep 2026); the sheet it gave us is read raw. */
    const dd = ddRaw ? (/^\d{5}(\.\d+)?$/.test(ddRaw) ? spBulkDate(ddRaw) : soParseDMY(ddRaw)) : '';
    if (at(c.dd) && !dd) { errors.push(row + 'the delivery date must be DD-MM-YYYY, not "' + at(c.dd) + '".'); note(); return; }
    const prRaw = at(c.pr).toUpperCase(), priority = /^P[1-4]$/.test(prRaw) ? prRaw : '';
    const id = 'ln_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + n;
    (() => {
    if (kind === 'running') {
      const fsku = at(c.fsku).split('|')[0].trim().toUpperCase();
      const fr = fsku ? voFabricCatalogue().get(fsku) : null;
      if (fsku && !fr) { errors.push(row + fsku + ' is not a fabric SKU in the catalogue.'); return; }
      /* A fabric SKU fills whatever the row left blank, and must agree with whatever it did not. */
      const fab = at(c.fab) || (fr ? fr.fabric : ''), col = at(c.col) || (fr ? fr.colour : ''), pd = at(c.pd) || (fr ? fr.dir : '');
      if (!fab && !col && !qty) return;                       // a blank row is not an error
      if (!fab || !col || !pd) { errors.push(row + 'fabric type, colour and print direction are all required — or a Fabric SKU.'); return; }
      if (fr && (fab.toLowerCase() !== String(fr.fabric).toLowerCase() || col.toLowerCase() !== String(fr.colour).toLowerCase() || (fr.width && pd.toLowerCase() !== fr.dir.toLowerCase()))) {
        errors.push(row + fsku + ' is ' + fr.colour + ' · ' + fr.fabric + (fr.width ? ' · ' + fr.dir : '') + ', but the row says ' + col + ' · ' + fab + ' · ' + pd + '.'); return; }
      if (qty <= 0) { errors.push(row + 'the quantity in metres must be more than zero.'); return; }
      out.push(Object.assign({ lineId: id, kind: 'running', fabricType: fab, color: col, printDirection: pd,
        meters: qty, deliveryDate: dd, priority, notes: at(c.nt), dispatchedQty: 0 },
        fr ? { sku: fr.sku, img: fr.imageUrl || '', brand: fr.brandName || '' } : {}));
    } else {
      const sku = obUC(at(c.sku));
      if (!sku && !qty) return;
      if (!sku) { errors.push(row + 'no SKU.'); return; }
      let m = (PTG.mdb || []).find(x => x && obUC(x.sku) === sku);
      if (!m && shop) m = voCustomLine(sku);
      if (!m) { errors.push(row + sku + ' is not in the master database. (For a Shopify order, pick Shopify in "For" first — it will go on the Custom SKUs list.)'); return; }
      /* The cut-fabric list is the PRINTERS' limit. A quilt cannot be sent to a block printer as cut
       * fabric; sending it to be filled is the entire point of a filling order. A Shopify order is exempt. */
      if (!shop && voDraftPrinting() && !voCutAllowed(m.articleType, m.subtype)) {
        errors.push(row + sku + ' is not a cut-fabric item, and this is a printing order.'); return; }
      if (qty < 1) { errors.push(row + 'the quantity in pieces must be at least one for ' + sku + '.'); return; }
      out.push(Object.assign({ lineId: id, kind: 'cut', sku, articleType: m.articleType || '', articleSubtype: m.subtype || '',
        color: m.color || '', size: m.size || '', brand: m.brand || '', qty, deliveryDate: dd, priority, notes: at(c.nt), dispatchedQty: 0 },
        m.isCustomNew ? { customNew: true } : {}));
    }
    })();
    note();
  });
  /* The cap is checked across the whole file at once, so a 500-row file reports every SKU that is
   * over rather than one per re-upload. */
  if (kind === 'cut' && !shop && voDraftPrinting()) {
    /* Over the cap is a fact about a SKU; every row of that SKU is marked with it. */
    voValidateCut(out.map(l => ({ sku: l.sku, qty: l.qty }))).forEach(v => {
      errors.push(voCapMsg(v));
      report.forEach(x => { if (x.ok && x.line && obUC(x.line.sku) === obUC(v.sku)) { x.ok = false; x.why = voCapMsg(v); } });
    });
  }
  VO_UP = { report, good: report.filter(x => x.ok).map(x => x.line), name: file.name };
  if (errors.length) {
    const right = VO_UP.good.length, wrong = report.filter(x => !x.ok).length;
    ptDlgMsg(`${nf(right)} line(s) right, ${nf(wrong)} wrong — nothing loaded yet. ` + errors.slice(0, 2).join(' ')
      + (errors.length > 2 ? ' …' : ''), true);
    /* TWO WAYS ON: the check file, to fix the wrong rows; or take the right ones now. */
    const m = $('ptDlgMsg');
    if (m) {
      m.innerHTML += ` <button type="button" data-vochk="1" style="padding:3px 10px;font-size:12px;margin-left:6px">Download the check file</button>`
        + (right ? ` <button type="button" data-voload="1" class="ghost" style="padding:3px 10px;font-size:12px">Load the ${nf(right)} right line(s)</button>` : '');
      m.onclick = e => {
        const t = e.target && e.target.closest ? e.target.closest('[data-vochk],[data-voload]') : null;
        if (!t) return;
        if (t.hasAttribute('data-vochk')) return ptDownload('vendor-lines-check', voCheckFileRows(VO_UP.report).map(r => r.map(csvCell).join(',')));
        VOF.lines = VOF.lines.concat(VO_UP.good); voDraft();
        ptDlgMsg(`Loaded the ${nf(VO_UP.good.length)} right line(s) from ${VO_UP.name}. The wrong ones are in the check file.`);
      };
    }
    return;
  }
  if (!out.length) { ptDlgMsg('That file has no usable rows.', true); return; }
  VOF.lines = VOF.lines.concat(out);
  voDraft();
  const fresh = out.filter(l => l.customNew).length;
  ptDlgMsg(`Loaded ${nf(out.length)} line(s) from ${file.name}.` + (fresh ? ` ${nf(fresh)} new SKU(s) will go on the Custom SKUs list when it is sent.` : ''));
}

/* ---- placing it ---- */
/* THE SALES CHANNEL AN ORDER IS FOR (Ravi, 2026-09-28: "jab hum vendor order de to sales channel add kare ki kiske liye
 * chahiye"). Asked on the form, kept on the order (and on a request, and so on the order it becomes), shown to the printer,
 * and it decides whose orders the lines are stamped against: Shopify → Ridhi's Shopify orders, CPC Shopify → CPC's,
 * Amazon → the sales orders, B2B → the wholesale ones. */
const VO_CHANNELS = ['Shopify', 'CPC Shopify', 'Amazon', 'B2B'];
const VO_CHANNEL_SRC = { 'Shopify': 'SHP', 'CPC Shopify': 'SHP', 'Amazon': 'AMZ', 'B2B': 'B2B' };
const voSkuIsCpc = sku => /CPC/i.test(String(((typeof mdbOf === 'function' ? mdbOf(sku) : null) || {}).brand || '')) || /^CPC/.test(obUC(sku));
const voChannelWants = (channel, r) => {
  const src = VO_CHANNEL_SRC[channel];
  if (!src) return true;
  if (ordSrcOf(r.orderNo) !== src) return false;
  return channel === 'CPC Shopify' ? voSkuIsCpc(r.sku) : channel === 'Shopify' ? !voSkuIsCpc(r.sku) : true;
};

async function voPlace(given) {
  /* GIVEN, the quick Give on the Order Console's totals (Ravi, 2026-09-25): the vendor and notes come in the call
   * rather than from the form; everything after — the checks, request or order, the write — is the same. */
  const G = given || {};
  const code = String(G.code != null ? G.code : (($('vof_vendor') || {}).value || '')).trim();
  if (!code) return 'Pick the vendor this order is going to.';
  if (!VOF.lines.length) return 'Add at least one line.';
  const svcRec = prSvc(VOF.service);
  const filler = String(G.filler != null ? G.filler : (($('vof_filler') || {}).value || '')).trim();
  if (svcRec && svcRec.fill && !filler) return 'Say which filler this order is for — the firm prices each one apart.';
  /* EVERY ACTIVE VENDOR, not only the printers. This looked in voVendors() — block printers alone —
   * so a filling order could be built line by line and then refused at the last press. */
  const vend = voAllVendors().find(v => String(v.code) === code);
  if (!vend) return 'That vendor is not active in the vendor master any more.';
  /* Asked on the form; a quick Give from the Demand totals passes its own (or none). */
  const chEl = $('vof_channel');
  const channel = String(G.channel != null ? G.channel : ((chEl || {}).value || '')).trim();
  if (G.code == null && chEl && !channel) return 'Pick who this order is for — Shopify, CPC Shopify, Amazon or B2B.';

  if (VOF.kind === 'cut' && voDraftPrinting() && !/Shopify/.test(channel)) {
    const bad = voValidateCut(VOF.lines.filter(l => voKind(l) === 'cut').map(l => ({ sku: l.sku, qty: l.qty })));
    if (bad.length) return `Over the cap: ` + bad.slice(0, 3).map(voCapMsg).join(' ')
      + (bad.length > 3 ? ` And ${nf(bad.length - 3)} more SKU(s).` : '');
  }

  /* THE SAME COLOUR AGAIN — for lines that came in by upload, or were added before this check existed.
   * A colour already answered while adding lines is not asked about twice. */
  if (VOF.kind === 'running') {
    const seenCloth = new Set();
    for (const l of VOF.lines.filter(x => voKind(x) === 'running' && String(x.color || '').trim())) {
      const id = [l.color, l.fabricType, l.printDirection].map(x => String(x || '').trim().toLowerCase()).join('|');
      if (seenCloth.has(id)) continue; seenCloth.add(id);
      if (!voDupAsk(l.color, [], l.fabricType, l.printDirection))
        return `Not placed — ${voDupWhat(l.color, l.fabricType, l.printDirection)} is already given for printing on an open order. Remove that line, or place again and answer OK.`;
    }
  }

  /* NEW SKUs FOR A SHOPIFY ORDER JOIN THE CUSTOM SKUs LIST (2026-09-28), request or order alike. A refused write does
   * not stop the order: the SKU can still be added by hand. */
  { const recs = voCustomRecs(VOF.lines);
    if (Object.keys(recs).length) { try { await ptPatch(recs); if (typeof MDBX !== 'undefined' && Array.isArray(MDBX.custom)) Object.values(recs).forEach(r => MDBX.custom.push(r)); } catch (e) { /* added by hand later */ } } }
  /* A REQUEST STOPS HERE — checked exactly as an order is, and stored where no vendor can read it. */
  if (VOF.mode === 'request') {
    const err = await vrqSubmit({ code, vend, service: String(VOF.service || 'Block print'), kind: VOF.kind, channel,
      filler: svcRec && svcRec.fill ? filler : '',
      notes: String(G.notes != null ? G.notes : (($('vof_notes') || {}).value || '')).trim(),
      why: String(G.why != null ? G.why : (($('vof_why') || {}).value || '')).trim(),
      lines: VOF.lines });
    if (!err) VOF = { kind: VOF.kind, lines: [], mode: VOF.mode };
    return err;
  }
  /* And nobody without the right places an order directly, whatever the form was opened as. */
  if (!vrqCanApprove()) return VRQ_NO_APPROVE;

  const now = new Date().toISOString();
  const order = {
    id: 'vpo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    orderNo: voNewOrderNo(),
    vendorCode: code, vendorName: vend.desc || vend.name || code,
    /* WHAT THIS ORDER IS FOR. Everything raised before this existed is block printing, and reads as
     * that — voServiceOf says so, so the printer cap keeps counting the orders it always counted. */
    service: String(VOF.service || 'Block print'),
    ...(channel ? { channel } : {}),
    orderType: VOF.kind,
    orderDate: voTodayDMY(),
    status: 'Placed',
    /* Only a filling order carries one; nothing else is priced on what is inside it. */
    ...(svcRec && svcRec.fill ? { filler } : {}),
    notes: String(G.notes != null ? G.notes : (($('vof_notes') || {}).value || '')).trim(),
    lines: VOF.lines.map(l => Object.assign({}, l)),
    createdBy: ME.email, createdAt: now,
  };
  if (VOF.kind === 'cut') order.demandSource = 'bulk';
  /* EVERY LINE SAYS WHICH SALES ORDERS IT IS FOR. The order book is needed to say it; if it cannot be
   * read the order is still placed — an unstamped line is shared out by rule, as every older one is —
   * because refusing to order cloth over a missing annotation would be the wrong way round. */
  try { if (!PTG.ob) await ptLoadGates(); order.lines = voStampOrders(order.lines, channel); } catch (e) { /* placed unstamped */ }

  await ptPut('pt_vendorOrders/' + code + '/' + order.id, order);
  /* The vendor list the portal reads is a separate node, and it only gets written when the master
   * carries an email. No vendor in the master has one today — which is exactly why VND005 places
   * orders but shows as an unknown code on the Vendor Orders screen. */
  if (vend.email) {
    try { await ptPut('pt_vendorMap/' + code, { email: String(vend.email).toLowerCase(), name: vend.name || code });
      VO.map[code] = { email: String(vend.email).toLowerCase(), name: vend.name || code }; } catch (e) { /* the order is placed regardless */ }
  }
  VO.rows = (VO.rows || []).concat(Object.assign({ vendorCode: code }, order));
  VOF = { kind: VOF.kind, lines: [] };
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${order.orderNo} placed with ${order.vendorName} · ${nf(order.lines.length)} line(s)`
    + (vend.email ? '' : ' · no email on file');
  $('voMsg').title = vend.email ? ''
    : `${vend.name || code} has no email in the vendor master, so they cannot be given portal access until one is added.`;
  return '';
}

/* ---- order status, and cancelling a line without losing it ---- */
async function voSetStatus(key, status) {
  const cut = String(key).indexOf('/');
  const code = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === code && x.id === id); if (!o) return 'That order is gone.';
  if (!ME.admin) return 'Only an admin can change a vendor order’s status.';
  const next = Object.assign({}, o, { status, staffUpdatedAt: new Date().toISOString() });
  delete next.vendorCode;
  await ptPut('pt_vendorOrders/' + code + '/' + id, next);
  VO.rows = (VO.rows || []).map(x => (x.id === id && x.vendorCode === code ? Object.assign({ vendorCode: code }, next) : x));
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${o.orderNo || id} is now ${status}.`
    + (status === 'Cancelled' ? ' It stops counting against the printer cap, and the vendor sees it as cancelled.' : '');
  return '';
}

/**
 * Every move this order has been through. Kept on the order, so the record travels with the thing it
 * is about rather than living in a log somebody has to know exists.
 */
const voMoveLog = o => (o && Array.isArray(o.moves) ? o.moves.filter(Boolean) : []);

/**
 * The mark on a row that has been moved: who had it before, with the whole history in the tooltip.
 *
 * On the row rather than only inside the dialog, because the question it answers — "why is THIS
 * printer holding it?" — is asked while looking at the list.
 */
function voMovePill(o) {
  const log = voMoveLog(o);
  if (!log.length) return '';
  const last = log[log.length - 1];
  const title = log.map(m => (ptIsoDate(m.at) || m.at || '') + ': ' + (m.fromName || m.from)
    + ' \u2192 ' + (m.toName || m.to) + (m.why ? ' (' + m.why + ')' : '')
    + (m.by ? ' [' + String(m.by).split('@')[0] + ']' : '')).join('  \u00b7  ');
  return '<span class="pill" title="' + esc(title) + '" style="font-size:11px;margin-right:6px">'
    + 'moved ' + (log.length > 1 ? nf(log.length) + '\u00d7 ' : '') + 'from ' + esc(last.fromName || last.from) + '</span>';
}

/**
 * Move an order to another printer.
 *
 * The order keeps its number, its lines and its dates — the only thing that changes is whose portal
 * it is in, and that is not a field: it is which branch of pt_vendorOrders it lives under.
 */
async function voMoveTo(key, toCode, why) {
  if (!ME.admin) return 'Only an admin can move an order to another printer.';
  const cut = String(key).indexOf('/');
  const from = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === from && x.id === id);
  if (!o) return 'That order is gone — press Refresh.';
  const to = String(toCode || '').trim();
  if (!to) return 'Pick the printer it is going to.';
  if (to === from) return 'That is the printer it is already with.';
  if (!voMasterRow(to)) return 'That printer is not in the vendor master.';
  if (o.status === 'Cancelled') return 'That order is cancelled. Raise a new one for the other printer.';

  /* ANYTHING ALREADY SENT STAYS WHERE IT WAS SENT FROM. */
  const sent = voLines(o).filter(l => l && !l.cancelled && voDone(l) > 0);
  if (sent.length) {
    const u = voRunning(o) ? 'm' : 'pcs';
    return `${voName(from)} has already sent against this order — `
      + sent.slice(0, 3).map(l => `${nf(voDone(l))} ${u} of ${l.sku || l.fabricType || 'a line'}`).join(', ')
      + (sent.length > 3 ? ` and ${nf(sent.length - 3)} more line(s)` : '')
      + '. Moving it would hand their dispatches to somebody else. Cancel what is left on this order '
      + 'and raise a new one for the other printer.';
  }

  const now = new Date().toISOString();
  const next = Object.assign({}, o, {
    vendorName: voName(to),
    staffUpdatedAt: now, staffUpdatedBy: ME.email,
    /* WHO HAD IT BEFORE, AND WHY IT MOVED. Every move, in order. */
    moves: voMoveLog(o).concat([{ from, fromName: voName(from), to, toName: voName(to),
      at: now, by: ME.email, why: String(why || '').trim() }]),
  });
  delete next.vendorCode;                     // the code is the branch it sits under, not a field

  /* The new copy first: a failure here leaves everything exactly as it was. */
  try { await ptPut('pt_vendorOrders/' + to + '/' + id, next); }
  catch (e) { return 'Not moved: ' + (e.message || e); }
  /* And only then take it off the old printer. If THIS fails the order is in both portals, which is
   * visible and fixable — losing it would not be. */
  try { await ptDelete('pt_vendorOrders/' + from + '/' + id); }
  catch (e) {
    await ensureVo();
    return `Written to ${voName(to)}, but it could not be taken off ${voName(from)}: ${e.message || e}. `
      + 'Both printers can see it until that is done — press Refresh and try again.';
  }

  VO.rows = (VO.rows || []).filter(x => !(x.id === id && x.vendorCode === from))
    .concat([Object.assign({ vendorCode: to }, next)]);
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${o.orderNo || id} moved from ${voName(from)} to ${voName(to)}. `
    + `It is off ${voName(from)}'s portal and on ${voName(to)}'s.`;
  return '';
}

/**
 * The dialog: where it is going, and why.
 *
 * The reason is optional and asked for anyway — a move somebody has to explain a month later is the
 * reason the record exists at all.
 */
function voMoveOpen(key) {
  const cut = String(key).indexOf('/');
  const from = String(key).slice(0, cut), id = String(key).slice(cut + 1);
  const o = (VO.rows || []).find(x => x.vendorCode === from && x.id === id);
  if (!o) return;
  const others = voAllVendors().filter(v => String(v.code) !== from);
  const past = voMoveLog(o);
  ptOpenDialog({
    title: 'Move this order to another printer',
    subtitle: `${o.orderNo || id}  ·  now with ${voName(from)}`,
    note: 'The order keeps its number and its lines. It disappears from ' + voName(from)
      + '\u2019s portal and appears in the other printer\u2019s, and the move is written on the order.',
    html: `<div style="display:grid;gap:10px">
      <label>Move it to
        <select id="voMoveTo">${others.map(v => `<option value="${esc(v.code)}">${esc(v.name || v.code)}</option>`).join('')}</select>
      </label>
      <label>Why (optional, kept on the order)
        <input id="voMoveWhy" placeholder="e.g. Bagru is full this week">
      </label>
      ${past.length ? `<div class="ptnote"><b>Already moved ${nf(past.length)} time(s):</b><br>${
        past.map(m => `${esc(ptIsoDate(m.at) || m.at || '')} — ${esc(m.fromName || m.from)} → ${esc(m.toName || m.to)}`
          + (m.why ? ' · ' + esc(m.why) : '') + (m.by ? ' <span class="muted">(' + esc(String(m.by).split('@')[0]) + ')</span>' : '')).join('<br>')
      }</div>` : ''}
    </div>`,
    saveLabel: 'Move it',
    /* Its boxes are its own HTML, not declared fields, so they are read by id. */
    onSave: async () => voMoveTo(key, ($('voMoveTo') || {}).value || '', ($('voMoveWhy') || {}).value || ''),
  });
}

/* ---- the way in ---- */
$('voNew').onclick = () => voFormOpen();

