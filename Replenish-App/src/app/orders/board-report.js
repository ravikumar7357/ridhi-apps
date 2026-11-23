/* ================= BOARD REPORT — what is pending at each step, as a PDF to send on WhatsApp =================
 *
 * Ravi, 23 Nov: "every step par ek auto whatsapp summary report bhejni h like attached pdf — board me report ka bucket add kar dena usme
 * sabhi step like each printer (individual) and every action like cut, issue, rec. ko me pdf send kar saku". His answers: a button that
 * shares the PDF (there is no WhatsApp API key, so nothing is sent by itself); on all four boards; each report = what is PENDING at that step.
 *
 * The PDF is Bagru.pdf's shape: Colour | SKU | Subtype | Size | Pieces, colour shown once per group with a rule under it, Grand Total.
 * It is written here, by hand (no PDF library is loaded on the page): A4, Helvetica, WinAnsi text.
 * Share: a phone that can share files (Android Chrome) opens its share sheet with the PDF — pick WhatsApp. Elsewhere the PDF downloads
 * and WhatsApp (web) opens with the summary text; attach the PDF there. */

/** The sections of the report: To plan, Printer receive one per printer, Cut, Issue, Receive, QC pass, Press, Shipping to accept. */
function brSections(pend, done) {
  const out = [], stOf = r => shpbStages([r]);
  shpbStagesShown().forEach(x => {
    const src = x[0] === 'hand' ? done.filter(r => r.open) : pend;
    const ls = src.map(r => ({ r, pcs: +stOf(r)[x[3]] || 0 })).filter(y => y.pcs > 0);
    if (x[0] === 'prcv') {
      const by = new Map();
      ls.forEach(y => { const p = String(shpbPrinterOf(y.r) || '').trim() || 'Printer not named'; (by.get(p) || by.set(p, []).get(p)).push(y); });
      [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([p, ys]) => out.push({ id: 'prcv:' + p, step: 'Printer receive', who: p, title: 'Printer receive · ' + p, lines: ys }));
      if (!by.size) out.push({ id: 'prcv', step: 'Printer receive', who: '', title: 'Printer receive', lines: [] });
    } else out.push({ id: x[0], step: x[1], who: '', title: x[1], lines: ls });
  });
  return out;
}

/** The section's rows: one per SKU, grouped by colour (A–Z), pieces added up. */
function brRows(sec) {
  const m = new Map();
  sec.lines.forEach(({ r, pcs }) => {
    const k = obUC(r.sku);
    const e = m.get(k) || { color: String(r.color || '').trim(), sku: String(r.sku || '').trim(), sub: String(r.articleSubtype || '').trim(), size: String(r.size || '').trim(), pcs: 0, orders: new Set() };
    e.pcs += pcs; e.orders.add(r.orderNo); m.set(k, e);
  });
  return [...m.values()].sort((a, b) => (a.color || '~').localeCompare(b.color || '~') || a.sku.localeCompare(b.sku));
}
const brTot = rows => ({ pcs: rows.reduce((a, x) => a + x.pcs, 0), orders: new Set(rows.flatMap(x => [...x.orders])).size, skus: rows.length });

/* ---------- a small PDF writer: A4 pages of text, rules and filled bars ---------- */
const brPdfTxt = s => String(s == null ? '' : s).replace(/[×✕]/g, 'x').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-')
  .replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const brFit = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '.' : s; };
function brPdf(title, sub, rows, tot) {
  const W = 595, H = 842, L = 40, R = 555, RH = 14, pages = [];
  const col = { colour: L + 4, sku: 200, sub: 318, size: 462, pcs: R - 4 };
  let ops = null, y = 0;
  const T = (x, yy, s, bold, size) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size || 9} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${brPdfTxt(s)}) Tj ET`);
  const TR = (x, yy, s, bold, size) => T(x - String(s).length * (size || 9) * 0.556, yy, s, bold, size);   // digits: Helvetica 0.556 em
  const bar = (yy, h, rgb) => ops.push(`${rgb} rg ${L} ${yy.toFixed(1)} ${R - L} ${h} re f 0 g`);
  const rule = (x1, x2, yy, rgb) => ops.push(`${rgb} RG 0.8 w ${x1} ${yy.toFixed(1)} m ${x2} ${yy.toFixed(1)} l S 0 G`);
  const head = () => {
    bar(y - 4, RH + 2, '0.78 0.90 0.97');
    T(L + 2, y, 'Colour', true); T(col.sku, y, 'SKU', true); T(col.sub, y, 'Subtype', true); T(col.size, y, 'Size', true); TR(col.pcs, y, 'Pieces', true);
    y -= RH + 4;
  };
  const page = first => {
    ops = []; pages.push(ops); y = H - 46;
    if (first) { T(L, y, title, true, 14); y -= 18; T(L, y, sub, false, 9.5); y -= 22; }
    head();
  };
  page(true);
  let prev = null;
  rows.forEach((x, i) => {
    if (y < 60) { page(false); prev = null; }
    const firstOfColour = x.color !== prev;
    if (firstOfColour) T(col.colour, y, brFit(x.color || '(blank)', 30), true);
    T(col.sku, y, brFit(x.sku, 22), true); T(col.sub, y, brFit(x.sub, 27)); T(col.size, y, brFit(x.size, 14)); TR(col.pcs, y, String(x.pcs));
    prev = x.color;
    const next = rows[i + 1];
    if (!next || next.color !== x.color) rule(L, col.sku - 14, y - 4, '0.30 0.62 0.86');
    y -= RH;
  });
  if (y < 60) page(false);
  bar(y - 4, RH + 2, '0.78 0.90 0.97'); T(L + 2, y, 'Grand Total', true); TR(col.pcs, y, String(tot.pcs), true);
  /* the file */
  const objs = [], add = s => { objs.push(s); return objs.length; };
  const catalog = add(null), pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = pages.map((o, i) => {
    const body = o.concat([`BT /F1 8 Tf ${L} 24 Td (${brPdfTxt(title + '  -  page ' + (i + 1) + ' of ' + pages.length)}) Tj ET`]).join('\n');
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return new Blob([bytes], { type: 'application/pdf' });
}

/* ---------- the bucket on the board ---------- */
const brBoardName = () => ({ shp: 'SHP board', amz: 'AMZ board', b2b: 'B2B board', spy: 'SPY board' }[shpbKind()] || 'Board');
function brSummary(sec, rows, tot) {
  const byCol = new Map(); rows.forEach(x => byCol.set(x.color || '(blank)', (byCol.get(x.color || '(blank)') || 0) + x.pcs));
  const top = [...byCol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => c + ' ' + nf(n)).join(', ');
  return `*${brBoardName()} - ${sec.title}*\nPending on ${shpbDmy(dToday())}: ${nf(tot.pcs)} pcs - ${nf(tot.skus)} SKUs - ${nf(tot.orders)} orders`
    + (top ? `\nMost: ${top}` : '') + '\n(PDF attached)';
}
const brFileName = sec => (brBoardName() + ' ' + sec.title + ' ' + shpbDmy(dToday())).replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.pdf';
function brDownload(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
let BR_LAST = [];
function renderShpBoardReport(pend, done) {
  const secs = brSections(pend, done); BR_LAST = secs;
  const btn = 'height:30px;padding:0 12px;border-radius:8px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:none;transform:none;width:auto;';
  const row = (s, i) => { const rows = brRows(s), t = brTot(rows);
    return `<tr><td style="${SHPB_PAD}text-align:left"><b>${esc(s.step)}</b>${s.who ? ` · ${esc(s.who)}` : ''}</td>`
      + `<td class="num" style="${SHPB_PAD}">${nf(t.orders)}</td><td class="num" style="${SHPB_PAD}">${nf(t.skus)}</td><td class="num" style="${SHPB_PAD}"><b>${nf(t.pcs)}</b></td>`
      + `<td style="${SHPB_PAD}text-align:left;white-space:nowrap">${t.pcs ? `<button type="button" class="ghost" data-br-pdf="${i}" style="${btn}">PDF</button> `
        + `<button type="button" data-br-wa="${i}" style="${btn}background:#15803D;border:1px solid #15803D;color:#fff">WhatsApp</button>` : '<span class="muted">nothing pending</span>'}</td></tr>`; };
  $('odTable').innerHTML = `<thead><tr><th style="${SHPB_PAD}text-align:left">Step · who has it</th><th class="num" style="${SHPB_PAD}">Orders</th><th class="num" style="${SHPB_PAD}">SKUs</th><th class="num" style="${SHPB_PAD}">Pieces pending</th><th style="${SHPB_PAD}text-align:left">Send</th></tr></thead><tbody>`
    + secs.map(row).join('')
    + `<tr><td colspan="5" class="muted" style="${SHPB_PAD}text-align:left;font-size:12px">The PDF lists what is pending at that step — colour, SKU, subtype, size, pieces — for the lines on this board (the filters above apply). `
    + `WhatsApp: on a phone the share sheet opens with the PDF (pick WhatsApp); on a computer the PDF downloads and WhatsApp opens with the summary — attach the PDF there.</td></tr></tbody>`;
}
async function brAct(i, share) {
  const s = BR_LAST[i]; if (!s) return;
  const rows = brRows(s), t = brTot(rows), title = brBoardName() + ' - ' + s.title + ' - pending';
  const blob = brPdf(title, `${shpbDmy(dToday())} - ${nf(t.pcs)} pcs - ${nf(t.skus)} SKUs - ${nf(t.orders)} orders`, rows, t), name = brFileName(s);
  if (!share) return brDownload(blob, name);
  const text = brSummary(s, rows, t);
  try {
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }   // the share sheet was closed
  brDownload(blob, name);
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}
if ($('odTable') && $('odTable').addEventListener) $('odTable').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-br-pdf],[data-br-wa]'); if (!b) return;
  brAct(+(b.getAttribute('data-br-pdf') ?? b.getAttribute('data-br-wa')), b.hasAttribute('data-br-wa'));
});
