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

/** The section's rows, grouped by colour (A–Z). mode 'sku': one row per SKU, every order's pieces added up (Ravi, 23 Nov: "same sku me multiple
 * orders h to unko combine krke dekhne ka option"); mode 'order': one row per SKU per order, with the order number. */
const brMode = () => 'sku';   // 23 Nov: "sku grouping yaha karni h report me nahi" — the grouping lives on the board (Group by SKU); the report stays per SKU
function brRows(sec, mode) {
  const m = new Map(), byOrder = (mode || brMode()) === 'order';
  sec.lines.forEach(({ r, pcs }) => {
    const k = obUC(r.sku) + (byOrder ? '|' + r.orderNo : '');
    const e = m.get(k) || { color: String(r.color || '').trim(), sku: String(r.sku || '').trim(), sub: String(r.articleSubtype || '').trim(), size: String(r.size || '').trim(), pcs: 0, late: 0, orders: new Set(),
      order: byOrder ? String(r.shopOrderNo || r.orderNo || '').replace(/^#\s*/, '').replace(/^SHP-/, '') : '' };
    e.pcs += pcs; e.orders.add(r.orderNo); m.set(k, e);
    /* LATE IN RED (Ravi, 23 Nov: "jo order sabse late ho rha h wo red color se highlight hokar jay"): the board's own Late rule (shpbLate) */
    try { if (typeof shpbLate === 'function' && (shpbLate(r) || {}).tone === 'late') e.late += pcs; } catch (x) { /* not late */ }
  });
  return [...m.values()].sort((a, b) => (a.color || '~').localeCompare(b.color || '~') || a.sku.localeCompare(b.sku) || a.order.localeCompare(b.order));
}
const brTot = rows => ({ pcs: rows.reduce((a, x) => a + x.pcs, 0), late: rows.reduce((a, x) => a + (x.late || 0), 0), orders: new Set(rows.flatMap(x => [...x.orders])).size, skus: rows.length });

/* ---------- a small PDF writer: A4 pages of text, rules and filled bars ---------- */
const brPdfTxt = s => String(s == null ? '' : s).replace(/[×✕]/g, 'x').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/·/g, '-')
  .replace(/[^\x20-\x7e\xa0-\xff]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const brFit = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '.' : s; };
function brPdf(title, sub, rows, tot) {
  const W = 595, H = 842, L = 40, R = 555, RH = 14, pages = [], ord = rows.some(x => x.order);
  const col = ord ? { colour: L + 4, sku: 178, order: 280, sub: 352, size: 472, pcs: R - 4, cw: 25, sw: 23 } : { colour: L + 4, sku: 200, sub: 318, size: 462, pcs: R - 4, cw: 30, sw: 27 };
  let ops = null, y = 0;
  let red = false;
  const T = (x, yy, s, bold, size) => ops.push(`${red ? '0.80 0.07 0.07 rg ' : ''}BT /${bold ? 'F2' : 'F1'} ${size || 9} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${brPdfTxt(s)}) Tj ET${red ? ' 0 g' : ''}`);
  const TR = (x, yy, s, bold, size) => T(x - String(s).length * (size || 9) * 0.556, yy, s, bold, size);   // digits: Helvetica 0.556 em
  const bar = (yy, h, rgb) => ops.push(`${rgb} rg ${L} ${yy.toFixed(1)} ${R - L} ${h} re f 0 g`);
  const rule = (x1, x2, yy, rgb) => ops.push(`${rgb} RG 0.8 w ${x1} ${yy.toFixed(1)} m ${x2} ${yy.toFixed(1)} l S 0 G`);
  const head = () => {
    bar(y - 4, RH + 2, '0.78 0.90 0.97');
    T(L + 2, y, 'Colour', true); T(col.sku, y, 'SKU', true); if (ord) T(col.order, y, 'Order', true); T(col.sub, y, 'Subtype', true); T(col.size, y, 'Size', true); TR(col.pcs, y, 'Pieces', true);
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
    if (x.late) { bar(y - 3, RH - 2, '1 0.92 0.92'); }   // the pink band stays clear of the colour rule above it
    if (firstOfColour) T(col.colour, y, brFit(x.color || '(blank)', col.cw), true);
    red = !!x.late;
    T(col.sku, y, brFit(x.sku, 20), true); if (ord) T(col.order, y, brFit(x.order, 13)); T(col.sub, y, brFit(x.sub, col.sw)); T(col.size, y, brFit(x.size, 13)); TR(col.pcs, y, String(x.pcs));
    if (x.late) T(col.pcs - 34, y, x.late < x.pcs ? x.late + ' late' : 'LATE', true, 7);
    red = false;
    prev = x.color;
    const next = rows[i + 1];
    if (!next || next.color !== x.color) rule(L, col.sku - 14, y - 4, '0.30 0.62 0.86');
    y -= RH;
  });
  if (y < 60) page(false);
  bar(y - 4, RH + 2, '0.78 0.90 0.97'); T(L + 2, y, 'Grand Total', true); TR(col.pcs, y, String(tot.pcs), true);
  if (tot.late) { y -= RH + 4; red = true; T(L + 2, y, 'Late (red rows): ' + tot.late + ' pcs - past the date planned for this step, or nothing done for 7 days', true, 8.5); red = false; }
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
    + (tot.late ? `\n*LATE: ${nf(tot.late)} pcs* (red in the PDF)` : '')
    + (top ? `\nMost: ${top}` : '') + '\n(PDF attached)';
}
const brFileName = sec => (brBoardName() + ' ' + sec.title + ' ' + shpbDmy(dToday())).replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') + '.pdf';
function brDownload(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
let BR_LAST = [];
/* the icons (Ravi, 23 Nov: "bas whatsapp ka icon laga do … mail ka bhi icon aay") */
const BR_WA_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="#fff"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91A9.85 9.85 0 0 0 12.04 2Zm5.79 14.06c-.24.68-1.42 1.3-1.95 1.34-.5.05-.97.24-3.27-.68-2.77-1.09-4.52-3.92-4.66-4.1-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 .95-2.28.25-.27.54-.34.72-.34h.52c.17 0 .39-.06.61.47.24.56.8 1.94.87 2.08.07.14.12.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.13-.28.28-.12.55.16.27.71 1.17 1.52 1.9 1.05.93 1.93 1.22 2.2 1.36.27.13.43.11.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.59.75 1.86.89.27.13.45.2.52.31.07.11.07.66-.17 1.34Z"/></svg>';
const BR_MAIL_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
/* ONLY FOR WHOEVER IS GIVEN IT (Ravi, 25 Nov: "ye report har kisi ko show n ho, me jisko access du usi ko dikhe or report bhej sake"): the Access box
 * "Board — Report (see and send)" (perms.bdReport), or an admin. Without it the board has no Report button, the report screen is not drawn, and no PDF is
 * made, shared or mailed from here. */
const brMay = () => !!(typeof ME !== 'undefined' && ME && (ME.admin || ME.bdReport));
function renderShpBoardReport(pend, done) {
  const secs = brSections(pend, done); BR_LAST = secs;
  const btn = 'height:32px;padding:0 12px;border-radius:8px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:none;transform:none;width:auto;';
  const ic = 'width:34px;height:32px;padding:0;border-radius:8px;cursor:pointer;box-shadow:none;transform:none;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;';
  const mode = brMode(), seg = (v, t) => `<button type="button" data-br-mode="${v}" style="${btn}${mode === v ? 'background:#1D4ED8;color:#fff;border:1px solid #1D4ED8' : 'background:#fff;color:#17202B;border:1px solid #D5DCE5'}">${t}</button>`;
  const row = (s, i) => { const rows = brRows(s), t = brTot(rows);
    return `<tr><td style="${SHPB_PAD}text-align:left"><b>${esc(s.step)}</b>${s.who ? ` · ${esc(s.who)}` : ''}</td>`
      + `<td style="${SHPB_PAD}text-align:center">${nf(t.orders)}</td><td style="${SHPB_PAD}text-align:center">${nf(t.skus)}</td><td style="${SHPB_PAD}text-align:center"><b>${nf(t.pcs)}</b>${t.late ? ` <span style="color:#b91c1c;font-weight:700;font-size:12px">· ${nf(t.late)} late</span>` : ''}</td>`
      + `<td style="${SHPB_PAD}text-align:left;white-space:nowrap">${t.pcs ? `<button type="button" class="ghost" data-br-pdf="${i}" style="${btn}">PDF</button> `
        + `<button type="button" data-br-wa="${i}" title="Send on WhatsApp" aria-label="Send on WhatsApp" style="${ic}background:#25D366;border:1px solid #1faa53">${BR_WA_SVG}</button> `
        + `<button type="button" data-br-mail="${i}" title="Send by email" aria-label="Send by email" style="${ic}background:#1D4ED8;border:1px solid #1D4ED8">${BR_MAIL_SVG}</button>` : '<span class="muted">nothing pending</span>'}</td></tr>`; };
  /* A WINDOW OF ITS OWN SIZE (Ravi, 23 Nov: "remove space extra … isko proper window me set karo"): the table only as wide as its columns, no
   * spare width on either side; the how-it-works note goes on the message line, not across the table. renderOrd puts the width back. */
  /* the whole window (Ravi, 23 Nov: "is data ko expand krlo is whole window me"): full width, the columns shared out — step 34%, the three
   * counts 14 / 14 / 16% centred, Send 22% */
  $('odTable').style.width = '';
  const W = ['34%', '14%', '14%', '16%', '22%'], th = (i, t, al) => `<th style="${SHPB_PAD}width:${W[i]};text-align:${al || 'center'};white-space:nowrap">${t}</th>`;
  const m = $('odMsg'); if (m && !SHPB.err) { m.className = 'muted'; m.textContent = 'PDF = what is pending at that step (colour, SKU, subtype, size, pieces; the filters above apply). WhatsApp: on a phone the share sheet opens with the PDF; on a computer the PDF downloads and WhatsApp opens — attach it there. Mail: from the company mailbox, PDF attached.'; }
  $('odTable').innerHTML = `<thead><tr>${th(0, 'Step · who has it', 'left')}${th(1, 'Orders')}${th(2, mode === 'order' ? 'Rows' : 'SKUs')}${th(3, 'Pieces pending')}${th(4, 'Send', 'left')}</tr></thead><tbody>`
    + secs.map(row).join('') + '</tbody>';
}
/* THE PRINTER'S OWN CHAT AND A LINK TO THE PDF (Ravi, 23 Nov: "web whatsapp par bhi on hona chahiye" → both). WhatsApp Web lets no page attach a
 * file, so on a computer: the PDF is put in ERP data's private 'board-reports' store (staff only) and a 30-day link to it goes in the message,
 * WhatsApp opens on the printer's chat (the phone in the vendor master, else the one typed last time for that row), and the PDF downloads too. */
const BR_LINK_DAYS = 30;
function brPhoneOf(s) {
  try { const v = localStorage.getItem('brPhone:' + s.id); if (v) return v; } catch (e) { /* none kept */ }
  if (!s.who) return '';
  let vs = []; try { vs = typeof voAllVendors === 'function' ? voAllVendors() : []; } catch (e) { vs = []; }
  const L = x => String(x || '').trim().toLowerCase(), v = vs.find(x => L(x.desc || x.name) === L(s.who) || L(x.code) === L(s.who));
  return v ? String(v.whatsapp || v.mobile || v.phone || '').trim() : '';
}
const brWaNum = ph => { let d = String(ph || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '0') d = d.slice(1); if (d.length === 10) d = '91' + d; return d.length >= 11 && d.length <= 15 ? d : ''; };
async function brLink(blob, name) {
  const C = window.__R1_DATA || {}; if (!C.url || !C.key) throw new Error('no ERP data address on this page');
  const tok = auth && auth.currentUser ? await auth.currentUser.getIdToken() : ''; if (!tok) throw new Error('not signed in');
  const path = (shpbKind() || 'board') + '/' + new Date().toISOString().slice(0, 10) + '/' + Date.now().toString(36) + '-' + name;
  const h = { apikey: C.key, Authorization: 'Bearer ' + tok };
  const up = await fetch(C.url + '/storage/v1/object/board-reports/' + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, h), body: blob });
  if (!up.ok) throw new Error('upload ' + up.status);
  const sg = await fetch(C.url + '/storage/v1/object/sign/board-reports/' + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify({ expiresIn: BR_LINK_DAYS * 86400 }) });
  const j = await sg.json().catch(() => ({})); const u = j.signedURL || j.signedUrl;
  if (!sg.ok || !u) throw new Error('link ' + sg.status);
  return C.url + '/storage/v1' + (u.charAt(0) === '/' ? u : '/' + u);
}
async function brAct(i, share) {
  const s = BR_LAST[i]; if (!s) return;
  const rows = brRows(s), t = brTot(rows), title = brBoardName() + ' - ' + s.title + ' - pending';
  const blob = brPdf(title, `${shpbDmy(dToday())} - ${nf(t.pcs)} pcs - ${nf(t.skus)} SKUs - ${nf(t.orders)} orders${t.late ? ' - ' + nf(t.late) + ' pcs LATE (red)' : ''}`, rows, t), name = brFileName(s);
  if (!share) return brDownload(blob, name);
  const text = brSummary(s, rows, t);
  /* a phone that shares files: the PDF itself goes, from the share sheet (at once — the tap's permission does not wait for an upload) */
  try {
    const file = new File([blob], name, { type: 'application/pdf' });
    const phone = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent || '');
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }   // the share sheet was closed
  /* a computer: WhatsApp's tab is opened now (a tab opened after the upload would be blocked), then pointed at the printer's chat */
  const w = window.open('', '_blank');
  const msg = $('odMsg'), say = (m, bad) => { if (msg) { msg.className = bad ? 'err' : 'muted'; msg.textContent = m; } };
  say('Making the link to the PDF…');
  let link = '';
  try { link = await brLink(blob, name); } catch (e) { say('The PDF link could not be made (' + (e.message || e) + ') — the PDF is downloaded; attach it in WhatsApp.', true); }
  brDownload(blob, name);
  const num = brWaNum(brPhoneOf(s));
  const body = text.replace('(PDF attached)', link ? 'PDF: ' + link : '(PDF attached)');
  const url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(body);
  if (w && !w.closed) w.location.href = url; else window.open(url, '_blank');
  if (link) say('WhatsApp is open' + (num ? ' on ' + s.who + "'s chat" : ' — pick the chat') + ' with the PDF link (good for ' + BR_LINK_DAYS + ' days); the PDF downloaded too.');
}
/* MAIL (23 Nov): the backend (Pricing-API mailReport_) sends it from the company mailbox with this PDF attached — only for a signed-in
 * person with rights, five addresses at most, a daily limit. The addresses typed are remembered per printer / step on this computer. */
const brBase64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });
function brMailTo(s) {
  try { const v = localStorage.getItem('brMail:' + s.id); if (v) return v; } catch (e) { /* none kept */ }
  if (!s.who) return '';
  let vs = []; try { vs = typeof voAllVendors === 'function' ? voAllVendors() : []; } catch (e) { vs = []; }
  const L = x => String(x || '').trim().toLowerCase(), v = vs.find(x => L(x.desc || x.name) === L(s.who) || L(x.code) === L(s.who));
  return v ? String(v.email || '').trim() : '';
}
function brMail(i) {
  const s = BR_LAST[i]; if (!s) return;
  const rows = brRows(s), t = brTot(rows);
  ptOpenDialog({
    title: 'Mail · ' + s.title,
    note: `${nf(t.pcs)} pcs pending · ${nf(t.skus)} ${brMode() === 'order' ? 'rows' : 'SKUs'} · ${nf(t.orders)} orders. The PDF goes attached, from the company mailbox.`,
    fields: [
      { key: 'to', label: 'To (comma between addresses)', span: true, value: brMailTo(s) },
      { key: 'cc', label: 'Cc', span: true, value: '' },
      { key: 'msg', label: 'Message (optional)', span: true, value: '' },
    ],
    saveLabel: 'Send mail',
    onSave: async v => {
      const list = x => String(x || '').split(/[,;\s]+/).map(y => y.trim()).filter(Boolean), to = list(v.to), cc = list(v.cc);
      if (!to.length) return 'Who is it going to?';
      const bad = to.concat(cc).find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)); if (bad) return `"${bad}" is not an email address.`;
      if (to.length + cc.length > 5) return 'Five addresses at most.';
      const title = brBoardName() + ' - ' + s.title + ' - pending';
      const blob = brPdf(title, `${shpbDmy(dToday())} - ${nf(t.pcs)} pcs - ${nf(t.skus)} SKUs - ${nf(t.orders)} orders${t.late ? ' - ' + nf(t.late) + ' pcs LATE (red)' : ''}`, rows, t);
      try {
        const idToken = auth && auth.currentUser ? await auth.currentUser.getIdToken() : '';
        await apiPost({ mail: 'report', to: to.join(','), cc: cc.join(','), title: title.slice(0, 120), fileName: brFileName(s), pdf: await brBase64(blob), greetName: s.who || '',
          message: String(v.msg || '').slice(0, 1500), fromName: 'Ridhi Home & Living', summary: brSummary(s, rows, t).replace(/\*/g, ''), idToken });
      } catch (e) { return 'Not sent: ' + (e.message || e); }
      try { localStorage.setItem('brMail:' + s.id, to.join(', ')); } catch (e) { /* not kept */ }
      const m = $('odMsg'); if (m) { m.className = 'muted'; m.textContent = 'Mailed: ' + s.title + ' to ' + to.join(', ') + '.'; }
      return '';
    },
  });
}
if ($('odTable') && $('odTable').addEventListener) $('odTable').addEventListener('click', e => {
  if (!brMay()) return;
  const md = e.target.closest && e.target.closest('[data-br-mode]'); if (md) { SHPB.brMode = md.getAttribute('data-br-mode'); renderShpBoard(); return; }
  const ml = e.target.closest && e.target.closest('[data-br-mail]'); if (ml) { brMail(+ml.getAttribute('data-br-mail')); return; }
  const b = e.target.closest && e.target.closest('[data-br-pdf],[data-br-wa]'); if (!b) return;
  brAct(+(b.getAttribute('data-br-pdf') ?? b.getAttribute('data-br-wa')), b.hasAttribute('data-br-wa'));
});
