/* ================================================================
 * PPC REPORT (Ravi, 28 Oct: "a report system so that a person can download it on the basis of days or choosing the date
 * from calendar — this is the ppc report of it", in the layout of Sheet3 of his WIP workbook: one row a line, then the
 * Row Labels / Sum of PCS summary). Nothing is read for it but the sales orders' due dates: the lines, plans, print orders,
 * challans and Job Work issues are the ones the PPC screen has already read, so opening it costs the database nothing.
 *
 *   Planned on    the day the plan was FIRST saved (plan.firstAt, kept from 28 Oct). A plan saved before then has only its
 *                 last save (plan.at) — the report says so on that line ("last saved").
 *   Submit by     the plan's Ready date — PPC must give one to save a plan (28 Oct).
 *   Due date      the sales order's delivery date; for a Shopify / online line, 5 working days from when it opened (the
 *                 made-to-order rule of Production to Shipping); for the rest (Amazon), the Ready date — Amazon gives none.
 *   Delay         today against the due date, for a line not yet made; a made line says "made".
 *   Who           admins, and whoever holds the Reports right.
 * ================================================================ */
const FLOW_REP = { from: '', to: '', on: 'planned', by: 'sku', soErr: '' };
const flowRepAllowed = () => !!(ME.admin || (ME.tabs || []).includes('rep'));
/* Made — passed QC: nothing left to be late on. */
const FLOW_REP_MADE = ['ship', 'fgin', 'done'];
const flowRepPad = n => String(n).padStart(2, '0');
/** A saved time (ISO, UTC) as the calendar day it was here. */
const flowRepDay = at => { if (!at) return ''; const d = new Date(at); return isNaN(d) ? String(at).slice(0, 10) : d.getFullYear() + '-' + flowRepPad(d.getMonth() + 1) + '-' + flowRepPad(d.getDate()); };
const flowRepShow = iso => { const q = String(iso || '').slice(0, 10).split('-'); return q.length === 3 && q[0] ? q[2] + '/' + q[1] + '/' + q[0] : ''; };
const flowRepAdd = (iso, n) => { const q = String(iso).split('-').map(Number), d = new Date(q[0], q[1] - 1, q[2] + n); return d.getFullYear() + '-' + flowRepPad(d.getMonth() + 1) + '-' + flowRepPad(d.getDate()); };
const flowRepDaysBetween = (a, b) => { const p = s => { const q = String(s).split('-').map(Number); return Date.UTC(q[0], q[1] - 1, q[2]); }; return Math.round((p(b) - p(a)) / 864e5); };
const FLOW_REP_CHANNEL = { AMZ: 'Amazon', SHP: 'Shopify', ONL: 'Online', B2B: 'B2B', SO: 'Sales order', FBA: 'Amazon' };
const flowRepChannel = r => { const pre = obUC(String(r.orderNo || '').split('-')[0]); return FLOW_REP_CHANNEL[pre] || FLOW_REP_CHANNEL[obUC(r.src)] || String(r.src || pre || ''); };

/** The quick choices: [label, from, to]. */
function flowRepRanges() {
  const t = dToday(), m = t.slice(0, 8) + '01';
  return [['Today', t, t], ['Yesterday', flowRepAdd(t, -1), flowRepAdd(t, -1)], ['Last 7 days', flowRepAdd(t, -6), t], ['Last 30 days', flowRepAdd(t, -29), t], ['This month', m, t]];
}

/** Due date and where it came from — the sales order's, the made-to-order rule's, or PPC's own Ready date. */
function flowRepDue(r, p, soDue) {
  const so = soDue && soDue.get(obUC(r.orderNo) + '|' + obUC(r.sku));
  if (so) return { due: so, from: 'sales order' };
  if (r.mtoDue) return { due: String(r.mtoDue).slice(0, 10), from: 'Shopify · 5 working days' };
  const ready = p && p.dates && p.dates.ready;
  if (ready) return { due: String(ready).slice(0, 10), from: 'PPC ready date' };
  return { due: '', from: '' };
}
/** "LATE · 2 days" / "3 days left" / "due today" / "made" / "no date set" — and the days late as a number (0 when not late). */
function flowRepDelay(due, made, today) {
  if (made) return { txt: 'made', late: 0 };
  if (!due) return { txt: 'no date set', late: 0 };
  const d = flowRepDaysBetween(due, today);
  if (d > 0) return { txt: `LATE · ${d} day${d > 1 ? 's' : ''}`, late: d };
  if (d === 0) return { txt: 'due today', late: 0 };
  return { txt: `${-d} day${d < -1 ? 's' : ''} left`, late: 0 };
}
/** Who has the work: the printer (or embroiderer / outside vendor) on the plan, then the karigars Job Work issued it to. */
function flowRepWho(r, p) {
  const out = [];
  if (p && p.printer && (p.printer.name || p.printer.code)) out.push(p.printer.name || p.printer.code);
  if (p && p.emb && (p.emb.name || p.emb.code)) out.push(p.emb.name || p.emb.code);
  if (p && p.route === 'outsource' && String(p.outVendor || '').trim()) out.push(String(p.outVendor).trim());
  const kar = new Map();
  (PT.base || []).forEach(b => { const n = +(b && b.issuePieces) || 0;
    if (n > 0 && obUC(b.orderNo) === obUC(r.orderNo) && obUC(b.sku) === obUC(r.sku)) { const w = String(b.empName || '').trim() || 'karigar'; kar.set(w, (kar.get(w) || 0) + n); } });
  kar.forEach((n, w) => out.push(`${w} (${n})`));
  return out.join(', ');
}
/* Where the line is now, in the words the floor uses — one name a bucket (Demand is one place here, not its tabs). */
const FLOW_REP_WHERE = { ppc: 'PPC', back: 'Back to sales team', demand: 'Demand (fabric / accessories)', vendor: 'Not given to a printer yet', fabric: 'With the printer',
  emb: 'Embroidery', cut: 'To cut', raw: 'Raw cutting in store', wip: 'WIP · with karigars', qcb: 'Quality Control', ship: 'Ready — hand to shipping',
  fgin: 'Finished Goods — to accept', out: 'Made outside', done: 'Done' };
const flowRepWhere = s => FLOW_REP_WHERE[s.bucket] || String(s.bucket || '');

/** The report's lines: o = { from, to, on: planned|came|waiting, today, soDue }. Real orders only — never a TEST line. */
function flowRepLines(o) {
  const today = o.today || dToday(), soDue = o.soDue || null;
  const mdb = new Map(((typeof PTG !== 'undefined' && PTG.mdb) || []).map(m => [obUC(m && m.sku), m]));
  const po = flowPoIndex(), ch = flowChIndex();
  const lines = FLOW_REAL ? ordLines() : flowMtoLines();
  const inRange = d => !!d && d >= o.from && d <= o.to;
  const out = [];
  (lines || []).forEach(r => {
    if (!r || r.__t) return;
    const s = flowState(r), p = s.plan || null;
    const first = p ? flowRepDay(p.firstAt || p.at) : '', last = p ? flowRepDay(p.at) : '';
    const keep = o.on === 'waiting' ? s.bucket === 'ppc'
      : o.on === 'came' ? inRange(ptIsoDate(r.orderDate))
      : !!p && inRange(first);
    if (!keep) return;
    const m = mdb.get(obUC(r.sku)) || cutSkuOf(r.sku) || {};
    const due = flowRepDue(r, p, soDue), made = FLOW_REP_MADE.includes(s.bucket), dl = flowRepDelay(due.due, made, today);
    const route = p ? flowRouteOf(p) : '';
    const doc = po[s.key] || (ch[s.key] && ch[s.key].no) || '';
    out.push({
      key: s.key, planned: first, plannedKnown: !!(p && p.firstAt), lastSaved: last, orderNo: String(r.orderNo || ''), orderDate: ptIsoDate(r.orderDate) || '',
      channel: flowRepChannel(r), sku: obUC(r.sku),
      category: String(m.articleType || r.articleType || ''), subCategory: String(m.subtype || m.articleSubtype || r.articleSubtype || ''),
      parent: String(m.parentAsin || ''), colour: String(m.color || r.color || ''), size: String(m.size || r.size || ''),
      fabric: String((p && p.fabric && p.fabric.name) || m.fabric || ''), pcs: +r.qty || 0, metres: p && p.fabric ? +p.fabric.metres || 0 : 0,
      process: route ? ((FLOW_ROUTES.find(x => x[0] === route) || [])[2] || route) : '', who: flowRepWho(r, p), doc,
      buyer: (typeof ordBuyerOf === 'function' ? ordBuyerOf(r.orderNo) : '') || String(r.shopOrderNo || ''),
      where: flowRepWhere(s), submitBy: p && p.dates && p.dates.ready ? String(p.dates.ready).slice(0, 10) : '',
      due: due.due, dueFrom: due.from, delay: dl.txt, late: dl.late, made, waitDays: s.bucket === 'ppc' && r.orderDate ? Math.max(0, flowRepDaysBetween(ptIsoDate(r.orderDate), today)) : 0,
    });
  });
  return out.sort((a, b) => (a.planned || a.orderDate).localeCompare(b.planned || b.orderDate) || a.orderNo.localeCompare(b.orderNo) || a.sku.localeCompare(b.sku));
}

/* The line sheet, in the order of Sheet3 of the WIP workbook (date, papers, process, who, SKU and what it is, pieces, order). */
const FLOW_REP_COLS = [
  ['Planned on', x => flowRepShow(x.planned) + (x.planned && !x.plannedKnown ? ' (last saved)' : '')], ['Last changed', x => flowRepShow(x.lastSaved)],
  ['Order no', x => x.orderNo], ['Order date', x => flowRepShow(x.orderDate)], ['Channel', x => x.channel], ['SKU', x => x.sku],
  ['Category', x => x.category], ['Sub-category', x => x.subCategory], ['Parent ASIN', x => x.parent], ['Colour', x => x.colour], ['Size', x => x.size],
  ['Fabric', x => x.fabric], ['PCS', x => x.pcs], ['Fabric mtr', x => x.metres], ['Process', x => x.process], ['Printer / karigar', x => x.who],
  ['PO / challan no', x => x.doc], ['Buyer ref', x => x.buyer], ['Where now', x => x.where], ['Submit by', x => flowRepShow(x.submitBy)],
  ['Due date', x => flowRepShow(x.due)], ['Due from', x => x.dueFrom], ['Delay', x => x.delay], ['Days late', x => x.late || 0]];
const FLOW_REP_BY = [['sku', 'SKU'], ['order', 'SKU and order'], ['day', 'Day and SKU'], ['who', 'Printer / karigar'], ['category', 'Category']];
/** The summary: Row Labels / Sum of PCS (and lines, late lines), grouped as asked. */
function flowRepSummary(lines, by) {
  const label = x => by === 'order' ? x.sku + ' · ' + x.orderNo : by === 'day' ? flowRepShow(x.planned || x.orderDate) + ' · ' + x.sku
    : by === 'who' ? (x.who || '(nobody yet)') : by === 'category' ? (x.category || '(no category)') : x.sku;
  const m = new Map();
  lines.forEach(x => { const k = label(x), e = m.get(k) || { label: k, pcs: 0, lines: 0, late: 0 }; e.pcs += x.pcs; e.lines++; if (x.late > 0) e.late++; m.set(k, e); });
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Two sheets, the lines and the summary — the app's own writer (no library), numbers as numbers, the header row bold. */
function flowRepXlsx(sheets) {
  const cell = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${head ? ' s="1"' : ''}><v>${v}</v></c>`;
    const t = String(v == null ? '' : v); if (t === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`; };
  const ws = rows => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + (rows[0] || []).map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(30, Math.max(10, String(h).length + 4))}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, soColName(j) + (i + 1), i === 0)).join('')}</row>`).join('') + '</sheetData></worksheet>';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml', rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${soXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ...sheets.map((s, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', ws(s.rows)]),
    ['xl/styles.xml', styles]]);
}
/** The workbook's two sheets as rows (the header first) — what the download writes. */
function flowRepSheets(lines, by) {
  const sum = flowRepSummary(lines, by), tot = lines.reduce((a, x) => a + x.pcs, 0), byName = (FLOW_REP_BY.find(b => b[0] === by) || FLOW_REP_BY[0])[1];
  return [
    { name: 'Lines', rows: [FLOW_REP_COLS.map(c => c[0])].concat(lines.map(x => FLOW_REP_COLS.map(c => c[1](x)))) },
    { name: 'Summary', rows: [['Row Labels (' + byName + ')', 'Sum of PCS', 'Lines', 'Late lines']].concat(sum.map(e => [e.label, e.pcs, e.lines, e.late]), [['Grand Total', tot, lines.length, lines.filter(x => x.late > 0).length]]) }];
}

/* ---- the panel ---- */
const FLOW_REP_ON = [['planned', 'Planned in PPC (plans first saved on these days)'], ['came', 'Came into PPC (orders dated these days)'], ['waiting', 'Still waiting in PPC (today — the dates do not apply)']];
function flowRepSoDue() { try { return typeof SOX !== 'undefined' && SOX.rows && typeof ordDueIndex === 'function' ? ordDueIndex() : null; } catch (e) { return null; } }
function flowRepNow() { return flowRepLines({ from: FLOW_REP.from, to: FLOW_REP.to, on: FLOW_REP.on, soDue: flowRepSoDue() }); }
function flowRepBody() {
  const lines = flowRepNow(), sum = flowRepSummary(lines, FLOW_REP.by), tot = lines.reduce((a, x) => a + x.pcs, 0);
  const late = lines.filter(x => x.late > 0).length, orders = new Set(lines.map(x => x.orderNo)).size, old = lines.filter(x => x.planned && !x.plannedKnown).length;
  const rng = FLOW_REP.on === 'waiting' ? 'waiting in PPC today' : `${flowRepShow(FLOW_REP.from)} – ${flowRepShow(FLOW_REP.to)}`;
  const cols = FLOW_REP_COLS.filter(c => !['Last changed', 'Due from', 'Days late'].includes(c[0]));
  const td = (v, c) => `<td style="white-space:nowrap${typeof v === 'number' ? ';text-align:right' : ''}${c === 'Delay' && /^LATE/.test(v) ? ';color:var(--bad);font-weight:600' : ''}">${esc(typeof v === 'number' ? nf(v) : v)}</td>`;
  return `<div style="display:flex;gap:22px;flex-wrap:wrap;background:var(--hover,#f8fafc);border-radius:8px;padding:8px 12px;margin:6px 0 10px">
      <div><b style="font-size:15px">${nf(sum.length)}</b> rows</div><div><b style="font-size:15px">${nf(tot)}</b> pieces</div><div><b style="font-size:15px">${nf(orders)}</b> orders</div>
      <div><b style="font-size:15px;${late ? 'color:var(--bad)' : ''}">${nf(late)}</b> late</div><div><b>${esc(rng)}</b></div></div>`
    + (FLOW_REP.soErr ? `<div class="muted" style="font-size:12px;margin-bottom:6px">⚠ ${esc(FLOW_REP.soErr)}</div>` : '')
    + (old ? `<div class="muted" style="font-size:12px;margin-bottom:6px">${nf(old)} plan(s) were saved before 28 Oct 2026: their "planned on" is the day they were last saved.</div>` : '')
    + (lines.length ? `<div style="overflow:auto;max-height:46vh"><table class="xl" style="font-size:12px"><thead><tr>${cols.map(c => `<th style="white-space:nowrap">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>`
      + lines.slice(0, 300).map(x => `<tr>${cols.map(c => td(c[1](x), c[0])).join('')}</tr>`).join('')
      + `</tbody></table></div>${lines.length > 300 ? `<div class="muted" style="font-size:12px">Showing 300 of ${nf(lines.length)} lines — the Excel has them all.</div>` : ''}`
      : '<div class="muted" style="padding:14px 0">No lines for these days.</div>');
}
function flowRepPaint() {
  const box = $('flRepOut'); if (box) box.innerHTML = flowRepBody();
  document.querySelectorAll('[data-flrepq]').forEach(b => { const r = flowRepRanges()[+b.dataset.flrepq]; b.className = r && r[1] === FLOW_REP.from && r[2] === FLOW_REP.to ? '' : 'ghost'; });
}
async function flowRepOpen() {
  if (!flowRepAllowed()) return;
  if (!FLOW_REP.from) { const r = flowRepRanges()[2]; FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; }
  const sel = (id, list, v) => `<select id="${id}" style="width:auto">${list.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  ptOpenDialog({
    title: 'PPC report', wide: true,
    subtitle: 'Pick the days, check the lines, download the Excel (Lines + Summary).',
    html: `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${flowRepRanges().map((r, i) => `<button type="button" class="ghost" data-flrepq="${i}" style="width:auto;padding:4px 12px;font-size:12.5px">${esc(r[0])}</button>`).join('')}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:13px">
        From <input type="date" id="flRepFrom" value="${esc(FLOW_REP.from)}" style="width:auto"> To <input type="date" id="flRepTo" value="${esc(FLOW_REP.to)}" style="width:auto">
        <span style="margin-left:8px">Report on</span> ${sel('flRepOn', FLOW_REP_ON, FLOW_REP.on)} <span>Summary by</span> ${sel('flRepBy', FLOW_REP_BY, FLOW_REP.by)}</div>
      <div id="flRepOut">${flowRepBody()}</div>`,
    saveLabel: 'Download Excel',
    onSave: async () => {
      const lines = flowRepNow();
      if (!lines.length) return 'Nothing to download for these days.';
      const bytes = flowRepXlsx(flowRepSheets(lines, FLOW_REP.by));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = 'ppc-report-' + (FLOW_REP.on === 'waiting' ? 'waiting-' + dToday() : FLOW_REP.from + '-to-' + FLOW_REP.to) + '.xlsx';
      a.click(); URL.revokeObjectURL(a.href);
      return '';
    },
  });
  const day = () => { const f = $('flRepFrom').value, t = $('flRepTo').value; if (f && t) { FLOW_REP.from = f <= t ? f : t; FLOW_REP.to = f <= t ? t : f; } flowRepPaint(); };
  $('flRepFrom').onchange = day; $('flRepTo').onchange = day;
  $('flRepOn').onchange = () => { FLOW_REP.on = $('flRepOn').value; flowRepPaint(); };
  $('flRepBy').onchange = () => { FLOW_REP.by = $('flRepBy').value; flowRepPaint(); };
  document.querySelectorAll('[data-flrepq]').forEach(b => { b.onclick = () => { const r = flowRepRanges()[+b.dataset.flrepq];
    FLOW_REP.from = r[1]; FLOW_REP.to = r[2]; $('flRepFrom').value = r[1]; $('flRepTo').value = r[2]; flowRepPaint(); }; });
  flowRepPaint();
  /* The sales orders' delivery dates: read once, only here, and only when no other screen has read them already. */
  if (typeof SOX !== 'undefined' && SOX.rows == null) {
    try { SOX.rows = ptList(await ptGet('pt_salesOrders')); FLOW_REP.soErr = ''; }
    catch (e) { FLOW_REP.soErr = 'Could not read the sales orders, so their due dates are missing here (' + (e.message || e) + ').'; }
    flowRepPaint();
  }
}
/** The toolbar button: on the Production flow screen, for admins and the Reports right. */
function flowRepBtn() { const b = $('flRep'); if (b && b.classList) b.classList.toggle('hide', !flowRepAllowed()); }
if ($('flRep')) $('flRep').onclick = () => { flowRepOpen().catch(e => { $('flMsg').className = 'err'; $('flMsg').textContent = 'Could not open the report: ' + (e.message || e); }); };
