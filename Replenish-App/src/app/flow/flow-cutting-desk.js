/* ================= THE CUTTING DESK =================
 * Ravi, 25 Nov: "redesign the complete page of to cut production flow, rename it with something relatable that defines its
 * function ... I can do cut entry from that same place, it should show all the fields of what to fill there only according to
 * the order ... check have they cut or not and how many are actually left to cut". Then, on the picture: no Waiting, no
 * Status, issue to karigar stays in the Job Work page, one Item column (picture, SKU, article, size, fabric), and the
 * cutting entry in a pop-up card.
 *
 * WHAT IT IS: the same lines as "To cut · Production flow" inside Cutting Data (cloth is back, cutting not finished), shown
 * as a desk: three tiles, quick filters (All / Not started / Part cut), 50 lines a page, and "Enter cutting" on each line.
 * A line leaves the desk when it is fully cut; its pieces are then issued from the Job Work Register, as before.
 *
 * NOTHING NEW IS STORED. The pop-up fills Cutting Data's own form and presses its Save (shpbDrive, the way the SHP board's
 * Cut does), so the order's cap, a frozen month and the fabric master answer here exactly as they do there.
 *
 * WHEN SOMETHING GOES WRONG:
 *   loud, in the pop-up — a cutting entry that is refused or not saved; the pop-up stays open with the form's own message.
 *   loud, on the desk — the print window blocked by the browser.
 *   quiet, with a console line — the switch (storage blocked: the old list shows) and the earlier-entries note.
 *
 * BEHIND A SWITCH, OFF: a branch's test link, the TEST ERP and this PC's localhost show the desk; localStorage cuttingDesk = '1'
 * turns it on for one computer, '0' off. Everybody else keeps the old "To cut" list. The way back is that same '0', or
 * CDK_DEFAULT = false. A branch's test link saves for real: a cutting entry made there is a real entry. */
const CDK_DEFAULT = false;
const CDK_NAME = 'Cutting Desk';
const CDK_PAGE = 50;
const CDK_PICKS = [['', 'All'], ['none', 'Not started'], ['part', 'Part cut']];
const CDK = { pick: '', page: 0 };
/* the boxes of Cutting Data's form the pop-up fills in; the SKU first, because the order list follows it */
const CDK_FORM = ['cwSku', 'cwOrd', 'cwPcs', 'cwFabric', 'cwDate', 'cwUsed', 'cwWaste', 'cwWasteW', 'cwRemarks'];

/** Is the desk on for this PC? localStorage wins ('1' on, '0' off); else the default, plus a branch's test link, the TEST ERP and localhost. */
function cdkSwitchOn() {
  try { const v = localStorage.getItem('cuttingDesk'); if (v === '1') return true; if (v === '0') return false; }
  catch (e) { console.warn('Cutting Desk: this browser blocks saved settings, so the switch uses its default.'); }
  const testLink = typeof window !== 'undefined' && (!!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));
  const branchLink = typeof baseOnPreview === 'function' && baseOnPreview();
  return CDK_DEFAULT || testLink || branchLink;
}

/* ---- the figures of one line ---- */
const cdkCut = x => Math.max(0, +x.s.cut || 0);
const cdkLeft = x => Math.max(0, (+x.r.qty || 0) - cdkCut(x));
const cdkStage = x => (cdkCut(x) > 0 ? 'part' : 'none');
const cdkArticle = x => String(x.r.articleSubtype || x.r.articleType || x.r.itemName || '').trim();
/** The fabric the line is cut from: the PPC plan's, else the master row's — spelt the way the Fabric Type master spells it,
 *  so one cloth is not saved under two spellings. */
function cdkFabric(x) {
  const m = typeof cutSkuOf === 'function' ? cutSkuOf(x.r.sku) : null;
  const name = String((x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || (m && m.fabric) || '').trim();
  const inMaster = (typeof cutFabrics === 'function' ? cutFabrics() : []).find(f => String(f).toLowerCase() === name.toLowerCase());
  return inMaster || name;
}

/** The three tiles: pieces left to cut on the whole list, and the lines not started and part cut. */
function cdkTiles(rows) {
  const t = { left: 0, lines: rows.length, noneLines: 0, nonePcs: 0, partLines: 0, partPcs: 0 };
  rows.forEach(x => { const left = cdkLeft(x); t.left += left;
    if (cdkStage(x) === 'part') { t.partLines++; t.partPcs += left; } else { t.noneLines++; t.nonePcs += left; } });
  return t;
}
const cdkFilter = (rows, pick) => (pick ? rows.filter(x => cdkStage(x) === pick) : rows);
/** One page of the list; a page past the end (a filter made the list shorter) falls back to the last one. */
function cdkPageOf(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / CDK_PAGE)), at = Math.min(Math.max(0, page | 0), pages - 1);
  return { at, pages, from: at * CDK_PAGE, rows: rows.slice(at * CDK_PAGE, (at + 1) * CDK_PAGE) };
}

/* ---- the desk on the page ---- */
function cdkTopHtml(all) {
  const t = cdkTiles(all), n = { '': all.length, none: t.noneLines, part: t.partLines };
  const tile = (name, big, small) => `<div class="card" style="flex:1 1 180px;padding:10px 14px;margin:0"><div class="muted" style="font-size:12px">${name}</div>`
    + `<div style="font-size:22px;font-weight:700">${big}</div><div class="muted" style="font-size:12px">${small}</div></div>`;
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">`
    + tile('Left to cut', nf(t.left) + ' pcs', 'on ' + nf(t.lines) + ' line(s)')
    + tile('Not started', nf(t.noneLines) + ' line(s)', nf(t.nonePcs) + ' pcs')
    + tile('Part cut', nf(t.partLines) + ' line(s)', nf(t.partPcs) + ' pcs left') + '</div>'
    + `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px">`
    + CDK_PICKS.map(([k, l]) => `<button type="button" data-cdkpick="${k}" class="${k === CDK.pick ? '' : 'ghost'}" style="width:auto;padding:5px 14px;font-size:13px">${l} <b style="margin-left:4px">${nf(n[k])}</b></button>`).join('')
    + `<span style="flex:1"></span><button type="button" class="ghost" data-cdkprint="1" style="width:auto;padding:5px 14px;font-size:13px">Print</button></div>`;
}
/** Picture, SKU, article, size and fabric of the line, in one cell. */
function cdkItemHtml(x) {
  const under = [[cdkArticle(x), x.r.size].filter(Boolean).join(' · '), cdkFabric(x)].filter(Boolean);
  return `<div style="display:flex;gap:10px;align-items:center">${typeof ptImgSpan === 'function' ? ptImgSpan(x.r.sku, 44) : ''}<div style="line-height:1.5">`
    + `<b style="font-family:ui-monospace,monospace">${esc(x.r.sku)}</b>${under.map(t => `<div class="muted" style="font-size:12px">${esc(t)}</div>`).join('')}</div></div>`;
}
function cdkTableHtml(rows) {
  const head = '<thead><tr>' + ['PO', 'Item', 'Ordered', 'Cut', 'Left to cut', ''].map((h, i) => `<th${i === 1 || i === 0 ? ' style="text-align:left"' : ''}>${h}</th>`).join('') + '</tr></thead>';
  if (!rows.length) return head + '<tbody><tr><td colspan="6" class="muted" style="padding:16px">No line is waiting to be cut.</td></tr></tbody>';
  return head + '<tbody>' + rows.map(x => `<tr><td style="text-align:left;vertical-align:middle"><a href="#" data-ordj="${esc(x.r.orderNo)}" style="font-weight:600">${esc(x.r.orderNo)}</a></td>`
    + `<td style="text-align:left">${cdkItemHtml(x)}</td><td class="num">${nf(+x.r.qty || 0)}</td><td class="num">${nf(cdkCut(x))}</td>`
    + `<td class="num"><b style="font-size:15px">${nf(cdkLeft(x))}</b></td>`
    + `<td><button type="button" data-cdkcut="${esc(x.s.key)}" style="width:auto;padding:4px 12px;font-size:12.5px">Enter cutting</button></td></tr>`).join('') + '</tbody>';
}
function cdkPagerHtml(pg, total) {
  const shown = total ? `Showing ${nf(pg.from + 1)} to ${nf(pg.from + pg.rows.length)} of ${nf(total)}, oldest order first` : '';
  const btn = (step, label, off) => `<button type="button" class="ghost" data-cdkpage="${step}" style="width:auto;padding:5px 14px;font-size:13px"${off ? ' disabled' : ''}>${label}</button>`;
  return `<div style="display:flex;gap:8px;align-items:center;margin-top:10px"><span class="muted" style="font-size:12.5px">${shown}</span><span style="flex:1"></span>`
    + (pg.pages > 1 ? btn(-1, 'Previous', pg.at === 0) + btn(1, 'Next', pg.at >= pg.pages - 1) : '') + '</div>';
}

/** Draws the desk in the Cutting Data flow tab and answers the lines its quick filter keeps (what Excel and Print take). */
function cdkRender(tab, rows) {
  const tbl = $('flEmbT_' + tab), box = $('flEmb_' + tab);
  if (!$('cdkTop') && tbl.parentElement && tbl.parentElement.insertAdjacentHTML) {
    tbl.parentElement.insertAdjacentHTML('beforebegin', '<div id="cdkTop"></div>');
    tbl.parentElement.insertAdjacentHTML('afterend', '<div id="cdkPager"></div>');
    box.addEventListener('click', cdkClick);
  }
  const kept = cdkFilter(rows, CDK.pick), pg = cdkPageOf(kept, CDK.page);
  CDK.page = pg.at; CDK.rows = kept;
  if ($('cdkTop')) $('cdkTop').innerHTML = cdkTopHtml(rows);
  tbl.innerHTML = cdkTableHtml(pg.rows);
  if ($('cdkPager')) $('cdkPager').innerHTML = cdkPagerHtml(pg, kept.length);
  if (typeof ptImgFill === 'function') ptImgFill(pg.rows.map(x => x.r.sku), false, ptIfTab('pcut', ptImgPatch));
  return kept;
}
function cdkClick(e) {
  const hit = name => e.target.closest && e.target.closest('[data-' + name + ']');
  const pick = hit('cdkpick'); if (pick) { CDK.pick = pick.dataset.cdkpick; CDK.page = 0; return flowEmbedRender('pcut'); }
  const page = hit('cdkpage'); if (page) { CDK.page += +page.dataset.cdkpage; return flowEmbedRender('pcut'); }
  if (hit('cdkprint')) { const er = cdkPrint(CDK.rows || []); const m = $('flEmbMsg_pcut'); if (er && m) m.textContent = er; return; }
  const cut = hit('cdkcut'); if (cut) cdkCutOpen(cut.dataset.cdkcut);
}

/** The list as filtered, on a plain sheet in a new window, ready to print. */
function cdkPrint(rows) {
  if (!rows.length) return 'No line to print.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  const cells = x => [x.r.orderNo, x.r.sku, cdkArticle(x), x.r.size || '', cdkFabric(x), nf(+x.r.qty || 0), nf(cdkCut(x)), nf(cdkLeft(x))];
  w.document.open();
  w.document.write(`<html><head><title>${CDK_NAME} ${esc(dToday())}</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}`
    + `th,td{border:1px solid #999;padding:4px 6px;text-align:left}@media print{.noprint{display:none}}</style></head><body><h3>${CDK_NAME} — ${esc(dToday())} — ${nf(rows.length)} line(s)</h3>`
    + '<table><tr>' + ['PO', 'SKU', 'Article', 'Size', 'Fabric', 'Ordered', 'Cut', 'Left to cut'].map(h => `<th>${h}</th>`).join('') + '</tr>'
    + rows.map(x => '<tr>' + cells(x).map(c => `<td>${esc(c)}</td>`).join('') + '</tr>').join('') + '</table>'
    + '<div style="margin-top:20px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div></body></html>');
  w.document.close();
  return '';
}

/* ---- the cutting entry, in a pop-up card ---- */
/** The cutting entries already saved against this line, oldest first, as "20/11 cut 150". */
function cdkEarlier(r) {
  try {
    return ((typeof PT !== 'undefined' && PT.cut) || []).filter(c => obUC(c.orderNo) === obUC(r.orderNo) && obUC(c.sku) === obUC(r.sku))
      .map(c => String(c.cutDate || '').split(',')[0].trim() + ' cut ' + nf(+c.pieces || 0));
  } catch (e) { console.warn('Cutting Desk: earlier cutting entries could not be listed.', e); return []; }
}
function cdkCardHtml(x) {
  const earlier = cdkEarlier(x.r);
  return `<div style="display:flex;gap:12px;align-items:center;padding:10px 12px;margin-bottom:12px;border:1px solid var(--line);border-radius:10px">`
    + `<div style="flex:1;min-width:0">${cdkItemHtml(x)}</div><div style="text-align:right"><div class="muted" style="font-size:12px">Left to cut</div>`
    + `<div style="font-size:17px;font-weight:700">${nf(cdkLeft(x))} of ${nf(+x.r.qty || 0)}</div></div></div>`
    + (earlier.length ? `<div class="muted" style="font-size:12.5px;margin-bottom:12px">Earlier on this order: ${esc(earlier.join(' · '))}</div>` : '');
}
/** Metres of cloth one piece is planned to take, or 0 when the master cannot work it out. */
function cdkPerPiece(sku) {
  const m = typeof cutSkuOf === 'function' ? cutSkuOf(sku) : null, p = m && typeof ptConsPlan === 'function' ? ptConsPlan(m) : null;
  return p && !p.why && +p.metres > 0 ? +p.metres : 0;
}
function cdkCutOpen(key) {
  const x = flowRows().find(y => y.s.key === key); if (!x) return;
  if (x.r.__t) return flowTestCutOpen(x.r.orderNo, x.r.sku);   // a test line has no register entry: its own stand-in form
  if (!flowMay('pcut')) { const m = $('flEmbMsg_pcut'); if (m) m.textContent = 'Cutting Data is not open to this account — ask for the Cutting right.'; return; }
  const own = cdkFabric(x), fabs = (typeof cutFabrics === 'function' ? cutFabrics() : []).filter(f => String(f).toLowerCase() !== own.toLowerCase());
  const per = cdkPerPiece(x.r.sku), pf = flowCutFabricOf(x.r, x.s.plan);
  ptOpenDialog({ title: 'Cutting entry', subtitle: x.r.orderNo + ' · saved in Cutting Data, against this order.', html: cdkCardHtml(x),
    fields: [{ key: 'pcs', label: 'Pieces cut', type: 'number', min: 1, step: 1, value: flowCutNow(x.r, x.s) || '' },
      { key: 'date', label: 'Cutting date', type: 'date', value: dToday() },
      { key: 'fabric', label: 'Fabric', type: 'select', options: (own ? [[own, own + ' — this line\'s fabric']] : [['', '— pick —']]).concat(fabs.map(f => [f, f])), value: own },
      { key: 'used', label: per ? `Cloth used (m) — blank takes ${per} m a piece` : 'Cloth used (m)', type: 'number', min: 0, step: 0.01, value: '' },
      { key: 'waste', label: 'Waste back (m)', type: 'number', min: 0, step: 0.01, value: '' },
      { key: 'wasteW', label: 'Waste width (in)', type: 'number', min: 0, step: 0.25, value: '' },
      { key: 'remarks', label: 'Remarks', value: pf.code ? 'Printed fabric ' + pf.code : '', span: true }],
    saveLabel: 'Save cutting', onSave: v => cdkCutSave(x, v) });
}
/** Saves through Cutting Data's own form. A refusal comes back as text and keeps the pop-up open; '' means saved. */
async function cdkCutSave(x, v) {
  const pcs = parseInt(v.pcs, 10), r = x.r;
  if (!(pcs > 0)) return 'Type how many pieces were cut.';
  if (!v.fabric) return 'Pick the fabric this was cut from.';
  const per = cdkPerPiece(r.sku), typed = String(v.used == null ? '' : v.used).trim();
  const used = typed !== '' ? typed : (per ? String(Math.round(per * pcs * 100) / 100) : '');   // rounded once, here, as the form does
  await ensureCutForm();
  /* Whatever somebody had half typed in Cutting Data's form is kept aside and put back, saved or refused. */
  const before = CDK_FORM.map(id => [id, $(id).value]), typedSku = $('cwSku').dataset.typed, typedUsed = $('cwUsed').dataset.typed;
  $('cwSku').value = r.sku; $('cwSku').dataset.typed = '1'; renderCutPick(); renderCutForm();
  $('cwUsed').dataset.typed = '1';   // the form must keep the metres put in below, not work them out again
  const sel = $('cwFabric');   // the form's list may not carry the line's own fabric yet: add it, so the pick is not lost
  if (sel && sel.options && ![...sel.options].some(o => o.value === v.fabric)) { const o = document.createElement('option'); o.value = o.textContent = v.fabric; sel.appendChild(o); }
  CUT_OWN_OK = v.fabric === cdkFabric(x) ? v.fabric : '';   // the line's own fabric is allowed even where the master does not list it
  let err = '';
  try {
    err = await shpbDrive({ cwOrd: r.orderNo, cwPcs: String(pcs), cwFabric: v.fabric, cwDate: v.date || dToday(), cwUsed: used,
      cwWaste: String(v.waste == null ? '' : v.waste).trim(), cwWasteW: String(v.wasteW == null ? '' : v.wasteW).trim(), cwRemarks: String(v.remarks || '').trim() }, 'cwSave', 'cwMsg');
  } finally {
    CUT_OWN_OK = '';
    $('cwSku').value = before[0][1]; $('cwSku').dataset.typed = typedSku; $('cwUsed').dataset.typed = typedUsed;
    renderCutPick(); renderCutForm();   // the order list follows the SKU, so it is drawn before the order is put back
    before.forEach(([id, was]) => { $(id).value = was; });
  }
  if (err) cutFormMsg(''); else flowEmbedRefresh();   // the refusal is shown in the pop-up; the form is not left saying it
  return err;
}
