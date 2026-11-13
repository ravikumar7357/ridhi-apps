/* ================= VENDOR PORTAL · VENDOR SENT FROM EXCEL =================
 * Ravi, 12 Nov 2026: "vendor bhi bulk me order sent ki entry excel se kar sake — kis order ke against me bhej raha h usko
 * excel se sent mark kar sake".
 * The printer's own sign-in downloads a sheet of every open line it holds (one row per order line, with what is left),
 * types "Sending now" against the lines going out, and uploads it. Each filled row becomes one Vendor sent batch on that
 * order line — exactly what the Add box beside a line writes (vendor-portal.js vpVsAdd):
 *   pt_vendorOrders/<code>/<id>/vSent/<key> = { lineId, sku, color, fabricType, printDirection, qty, unit, at, by, via: 'excel' }
 * Nothing is saved until the printer has seen the list and pressed Save. A row asking for more than is left, a row for a
 * line that is no longer open, or a part piece, is refused and named — the rest go through.
 * Main functions: vsxSheet, vsxRead, vsxUpload, vsxSync. */
const VSX_COLS = ['Line key', 'Order', 'For order', 'Article / fabric', 'SKU', 'Colour', 'Size', 'Unit', 'Ordered', 'Already sent', 'Left', 'Sending now'];

/** Every open line of this printer's orders, with what it has said it sent and what is left. */
function vsxLines() {
  const out = [];
  (typeof vpVisible === 'function' ? vpVisible(VP.rows || []) : []).forEach(o => voLines(o).forEach((l, i) => {
    if (!l || l.cancelled) return;
    const run = o.orderType === 'running', unit = run ? 'm' : 'pcs', ord = vpQty(o, l);
    const sent = vpVsSum(vpVsOf(o, l)), left = Math.max(0, Math.round((ord - sent) * 100) / 100);
    if (!(left > 0)) return;
    const forOrd = (vpIsShop(o) && (l.shopRef || l.shopOrderNo)) ? (l.shopRef || l.shopOrderNo)
      : (Array.isArray(l.forOrders) ? l.forOrders.map(x => x && x.orderNo).filter(Boolean).join(', ') : '');
    out.push({ key: o.id + '#' + i, o, l, i, run, unit, ord, sent, left, forOrd,
      what: run ? [l.fabricType, l.printDirection].filter(Boolean).join(' · ') : (l.articleSubtype || l.articleType || '') });
  }));
  out.sort((a, b) => String(a.o.orderNo || a.o.id).localeCompare(String(b.o.orderNo || b.o.id)) || a.i - b.i);
  return out;
}

/** The sheet to fill: open lines only, "Sending now" left blank. */
function vsxSheet() {
  if (!vpVsCan()) return vpSay(null, 'Only the printer\'s own sign-in records what was sent.', true);
  const lines = vsxLines();
  if (!lines.length) return vpSay(null, 'Nothing is open — every line is already marked as sent.', true);
  const rows = [VSX_COLS].concat(lines.map(x => [x.key, x.o.orderNo || x.o.id, x.forOrd, x.what, x.l.sku || '', x.l.color || '',
    x.l.size || '', x.unit, x.ord, x.sent, x.left, '']));
  const bytes = recipeXlsx(rows, { name: 'Vendor sent', freeze: 2, cols: {} });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'vendor-sent-' + (VP.code || 'printer') + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  vpSay(null, `Sheet downloaded: ${nf(lines.length)} open line(s). Type what you are sending in "Sending now", then use "Upload sent sheet".`);
}

/** The filled sheet → { ok: [{ x, qty }], bad: [{ row, why }] } — nothing written. */
function vsxRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const H = rows[0].map(h => String(h == null ? '' : h).replace(/^﻿/, '').trim().toLowerCase());
  const iK = H.indexOf('line key'), iQ = H.indexOf('sending now');
  if (iK < 0 || iQ < 0) return { err: 'The file needs the "Line key" and "Sending now" columns — download the sent sheet and fill that one.' };
  const byKey = new Map(vsxLines().map(x => [x.key, x]));
  const ok = [], bad = [], seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [], key = String(row[iK] == null ? '' : row[iK]).trim(), raw = String(row[iQ] == null ? '' : row[iQ]).trim();
    if (!raw) continue;
    const n = parseFloat(raw), name = key || ('row ' + (r + 1));
    if (!(n > 0)) { bad.push({ row: r + 1, name, why: `"${raw}" is not a quantity` }); continue; }
    const x = byKey.get(key);
    if (!x) { bad.push({ row: r + 1, name, why: 'this line is not open on your orders any more (fully sent, cancelled or changed) — download a new sheet' }); continue; }
    if (seen.has(key)) { bad.push({ row: r + 1, name, why: 'the same line is on the sheet twice — put it on one row' }); continue; }
    seen.add(key);
    if (!x.run && n !== Math.floor(n)) { bad.push({ row: r + 1, name, why: 'pieces are whole numbers' }); continue; }
    const qty = x.run ? Math.round(n * 100) / 100 : n;
    if (qty > x.left) { bad.push({ row: r + 1, name, why: `only ${nf(x.left)} ${x.unit} is left on this line, the sheet says ${nf(qty)}` }); continue; }
    ok.push({ x, qty });
  }
  return { ok, bad };
}

/** Read the file, show what will be recorded, and save on the printer's word. */
async function vsxUpload(file) {
  if (!file) return;
  if (!vpVsCan()) return vpSay(null, 'Only the printer\'s own sign-in records what was sent.', true);
  let rows;
  try { rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text()); }
  catch (e) { return vpSay(null, 'Could not read that file: ' + (e.message || e), true); }
  const rd = vsxRead(rows);
  if (rd.err) return vpSay(null, rd.err, true);
  if (!rd.ok.length) return vpSay(null, rd.bad.length ? 'Nothing can be recorded: ' + rd.bad.map(b => b.name + ' — ' + b.why).join(' · ') : 'No row has a quantity in "Sending now".', true);
  const tot = u => rd.ok.filter(y => y.x.unit === u).reduce((a, y) => a + y.qty, 0);
  const sums = [tot('pcs') ? nf(tot('pcs')) + ' pcs' : '', tot('m') ? nf(Math.round(tot('m') * 100) / 100) + ' m' : ''].filter(Boolean).join(' · ');
  const html = '<table class="xl" style="width:100%;font-size:12.5px"><thead><tr><th>Order</th><th>For order</th><th style="text-align:left">Article / SKU</th><th>Colour</th><th>Size</th><th class="num">Left</th><th class="num">Sending now</th></tr></thead><tbody>'
    + rd.ok.map(({ x, qty }) => `<tr><td>${esc(x.o.orderNo || x.o.id)}</td><td>${esc(x.forOrd)}</td><td style="text-align:left">${esc(x.what)}<div class="muted" style="font-size:11px">${esc(x.l.sku || '')}</div></td>`
      + `<td>${esc(x.l.color || '')}</td><td>${esc(x.l.size || '')}</td><td class="num">${nf(x.left)} ${x.unit}</td><td class="num"><b>${nf(qty)} ${x.unit}</b></td></tr>`).join('')
    + '</tbody></table>'
    + (rd.bad.length ? `<div class="err" style="margin-top:10px;font-size:12.5px"><b>${nf(rd.bad.length)} row(s) will NOT be recorded:</b><br>`
      + rd.bad.map(b => `Row ${b.row} (${esc(b.name)}): ${esc(b.why)}`).join('<br>') + '</div>' : '');
  ptOpenDialog({ title: 'Record as sent — from your sheet', subtitle: `${nf(rd.ok.length)} line(s) · ${sums} · today, ${vpVsWhen(new Date().toISOString())}`,
    html, saveLabel: 'Save ' + nf(rd.ok.length) + ' line(s) as sent',
    onSave: async () => {
      const now = new Date().toISOString(), done = [];
      for (const { x, qty } of rd.ok) {
        const key = 'vs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const rec = { lineId: x.l.lineId || '', sku: x.l.sku || '', color: x.l.color || '', fabricType: x.l.fabricType || '',
          printDirection: x.l.printDirection || '', qty, unit: x.unit, at: now, by: ME.email || '', via: 'excel' };
        try { await ptPut('pt_vendorOrders/' + VP.code + '/' + x.o.id + '/vSent/' + key, rec); }
        catch (e) {
          renderVp();
          return `Saved ${nf(done.length)} of ${nf(rd.ok.length)} line(s); stopped at ${x.o.orderNo || x.o.id} (${x.l.sku || x.what}): ${e.message || e}. Upload the sheet again for the rest — the saved ones are no longer open for that much.`;
        }
        x.o.vSent = Object.assign({}, x.o.vSent, { [key]: rec });
        done.push(x);
      }
      renderVp();
      vpSay(null, `${nf(done.length)} line(s) recorded as sent from your sheet (${sums}).`);
      return '';
    } });
}

/** The two buttons: the printer's own sign-in, on the order tabs only. */
function vsxSync() {
  const show = vpVsCan() && !['rfd', 'dch', 'hist'].includes(VP.tab);
  ['vpVsxDl', 'vpVsxUp'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', !show); });
}
if ($('vpVsxDl')) $('vpVsxDl').onclick = vsxSheet;
if ($('vpVsxUp')) $('vpVsxUp').onclick = () => { const f = $('vpVsxFile'); if (f) { f.value = ''; f.click(); } };
if ($('vpVsxFile')) $('vpVsxFile').onchange = e => vsxUpload(e.target.files && e.target.files[0]);
