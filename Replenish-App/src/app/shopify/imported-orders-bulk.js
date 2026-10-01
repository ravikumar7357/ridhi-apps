/* ---------- bulk update: Location, At location, Line status ---------- */
const SO_BULK_COLS = [
  { k: 'chan', t: 'Channel', alias: ['channel', 'shop', 'store'] },
  { k: 'no', t: 'Order', need: 1, alias: ['order', 'order no', 'order number', 'shopify', 'name', 'order #'] },
  { k: 'sku', t: 'SKU', need: 1, alias: ['sku', 'lineitem sku'] },
  { k: 'name', t: 'Product', alias: ['product', 'title'] },
  { k: 'ordered', t: 'Ordered', alias: ['ordered', 'qty', 'quantity'] },
  { k: 'loc', t: 'Location', alias: ['location', 'bin', 'bin number'] },
  { k: 'q', t: 'At location', alias: ['at location', 'qty at location', 'on shelf'] },
  { k: 'st', t: 'Line status', alias: ['line status', 'status'] },
];
const soBulkNo = v => String(v == null ? '' : v).trim().replace(/^#/, '').toUpperCase();

/** One row per line of the given orders, filled with what is recorded today. */
function soBulkSheet(rows) {
  const out = [SO_BULK_COLS.map(c => c.t)];
  rows.forEach(r => (r.items || []).forEach(i => {
    const sku = String(i.sku || '').trim().toUpperCase();
    if (!sku) return;
    const ln = soLine(r.id, sku);
    out.push([r.channel || 'Shopify', r.no, sku, i.name || '', i.qty, soLocOf(sku), ln.q == null ? '' : ln.q, ln.st || '']);
  }));
  return out;
}

/* ---------- writing a .xlsx ---------- */
/* 'OOS' is not a stage like the others — it is the floor saying the stock figure is wrong, and the
 * line has to be made. soLineState reads it, so it is spelled in exactly one place. */
const SO_LNST_OPTIONS = ['In cutting', 'In stitching', 'In printing', 'In washing', 'Ready', 'Packed', 'Short', 'On hold', 'OOS'];
const SO_LNST_OOS = 'OOS';
const soLineIsOos = (orderId, sku) =>
  String(((((SHOP_META[orderId] || {}).lines || {})[String(sku || '').trim().toUpperCase()] || {}).st) || '')
    .trim().toUpperCase() === SO_LNST_OOS;
let SO_CRC_T = null;
function soCrc32(bytes) {
  if (!SO_CRC_T) {
    SO_CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; SO_CRC_T[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = SO_CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/** A zip with every file stored as it is — what a .xlsx needs, and nothing a browser cannot do. */
function soZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  files.forEach(([name, text]) => {
    const nameB = enc.encode(name), data = enc.encode(text), crc = soCrc32(data);
    const head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0));
    parts.push(new Uint8Array(head), nameB, data);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nameB);
    offset += head.length + nameB.length + data.length;
  });
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdSize), u32(offset), u16(0)));
  const all = parts.concat(central, [end]);
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; all.forEach(b => { out.set(b, p); p += b.length; });
  return out;
}
const soXml = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const soColName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * The update sheet as a .xlsx: the rows, a frozen heading, and dropdowns on Location and Line status.
 * Both dropdowns still accept anything typed.
 */
function soBulkXlsx(rows, bins) {
  const cell = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    const s = String(v == null ? '' : v);
    if (s === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(s)}</t></is></c>`;
  };
  const sheetRows = rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, soColName(j) + (i + 1), i === 0)).join('')}</row>`).join('');
  const widths = [10, 10, 20, 34, 9, 12, 12, 16];
  const last = Math.max(rows.length, 2) + 500;       // room for lines added by hand below
  const colOf = t => soColName(rows[0].indexOf(t));
  const list = (col, name) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0" sqref="${col}2:${col}${last}"><formula1>${name}</formula1></dataValidation>`;
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + sheetRows + '</sheetData>'
    + `<dataValidations count="2">${list(colOf('Location'), 'Bins')}${list(colOf('Line status'), 'LineStatus')}</dataValidations>`
    + '</worksheet>';
  const listRows = Math.max(bins.length, SO_LNST_OPTIONS.length);
  let lr = '';
  for (let i = 0; i < listRows; i++) lr += `<row r="${i + 1}">${cell(bins[i] == null ? '' : String(bins[i]), 'A' + (i + 1))}${cell(SO_LNST_OPTIONS[i] || '', 'B' + (i + 1))}</row>`;
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + lr + '</sheetData></worksheet>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Update" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets>'
    + `<definedNames><definedName name="Bins">Lists!$A$1:$A$${Math.max(bins.length, 1)}</definedName>`
    + `<definedName name="LineStatus">Lists!$B$1:$B$${SO_LNST_OPTIONS.length}</definedName></definedNames>`
    + '</workbook>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '</styleSheet>';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet1],
    ['xl/worksheets/sheet2.xml', sheet2],
    ['xl/styles.xml', styles],
  ]);
}
/** Every bin the order panel offers: the standard ones and any already in use. */
function soBinList() {
  return [...new Set(SO_LOC_OPTIONS.concat(Object.values(SHOP_SKU).map(x => x && x.loc).filter(Boolean)))].sort();
}

/**
 * Read a bulk-update file into a plan. Nothing is changed.
 *
 * Every row names an order and a SKU on it; a blank cell leaves that field as it is and "-" clears it.
 * A row that names no known order, a SKU that order does not carry, or a count that is not a whole
 * number is set aside with the reason, never guessed at.
 */
function soBulkPlan(csvRows) {
  if (!csvRows || csvRows.length < 2) return { err: 'That file has no rows.' };
  const head = csvRows[0].map(h => String(h).trim().toLowerCase());
  const at = {};
  SO_BULK_COLS.forEach(c => {
    let idx = head.indexOf(c.t.toLowerCase());
    if (idx < 0) for (const a of c.alias) { const i = head.indexOf(a); if (i >= 0) { idx = i; break; } }
    if (idx >= 0) at[c.k] = idx;
  });
  const missing = SO_BULK_COLS.filter(c => c.need && at[c.k] == null).map(c => c.t);
  if (missing.length) return { err: 'These columns were not found: ' + missing.join(', ') + '. Download the update sheet to see the names it looks for.' };
  if (at.loc == null && at.q == null && at.st == null) return { err: 'The file has no Location, At location or Line status column, so there is nothing to update.' };

  const ALL = SHOP.orders.concat(soImpLive());
  const cell = (row, k) => (at[k] == null ? '' : String(row[at[k]] == null ? '' : row[at[k]]).trim());
  const plan = { loc: new Map(), lines: [], skipped: [] };
  for (let r = 1; r < csvRows.length; r++) {
    const row = csvRows[r];
    const no = soBulkNo(cell(row, 'no')), sku = cell(row, 'sku').toUpperCase();
    if (!no && !sku) continue;
    const where = `row ${r + 1}`;
    if (!no || !sku) { plan.skipped.push(`${where}: needs both an order and a SKU`); continue; }
    const chan = cell(row, 'chan').toLowerCase();
    let hits = ALL.filter(o => soBulkNo(o.no) === no && (o.items || []).some(i => String(i.sku || '').trim().toUpperCase() === sku));
    if (chan && hits.length > 1) hits = hits.filter(o => String(o.channel || 'Shopify').toLowerCase() === chan);
    if (!hits.length) {
      const known = ALL.some(o => soBulkNo(o.no) === no);
      plan.skipped.push(`${where}: ${known ? sku + ' is not on order ' + no : 'order ' + no + ' is not loaded'}`);
      continue;
    }
    if (hits.length > 1) { plan.skipped.push(`${where}: order ${no} is in more than one shop — fill in the Channel column`); continue; }
    const o = hits[0];
    const item = o.items.find(i => String(i.sku || '').trim().toUpperCase() === sku);

    const locRaw = cell(row, 'loc');
    if (locRaw) {
      const v = locRaw === '-' ? '' : locRaw.toUpperCase().slice(0, 12);
      if (v !== soLocOf(sku)) plan.loc.set(sku, v);
    }
    const qRaw = cell(row, 'q'), stRaw = cell(row, 'st');
    const ln = soLine(o.id, sku);
    const line = { id: o.id, no: o.no, sku, ordered: Number(item.qty) || 0 };
    if (qRaw) {
      if (qRaw !== '-' && !/^\d+$/.test(qRaw)) { plan.skipped.push(`${where}: "${qRaw}" is not a whole number for At location`); continue; }
      const want = qRaw === '-' ? '' : String(Math.min(line.ordered, Number(qRaw)));
      if (want !== (ln.q == null ? '' : String(ln.q))) line.q = qRaw === '-' ? '' : qRaw;
    }
    if (stRaw) {
      const want = stRaw === '-' ? '' : stRaw.slice(0, 40);
      if (want !== (ln.st || '')) line.st = want;
    }
    if (line.q != null || line.st != null) plan.lines.push(line);
  }
  return plan;
}

/** Apply a plan and save it, once for the SKUs and once for the orders. */
async function soBulkApply(plan) {
  plan.loc.forEach((v, sku) => {
    const rec = SHOP_SKU[sku] || (SHOP_SKU[sku] = {});
    if (v) rec.loc = v; else delete rec.loc;
    if (!Object.keys(rec).length) delete SHOP_SKU[sku];
  });
  plan.lines.forEach(l => {
    if (l.q != null) soApplyLineQty(l.id, l.sku, l.q, l.ordered);
    if (l.st != null) soApplyLineStatus(l.id, l.sku, l.st);
  });
  if (plan.loc.size) await saveShopSku();
  if (plan.lines.length) await saveShopMeta();
  renderShop();
  return `Updated ${plan.loc.size} location(s) and ${plan.lines.length} order line(s).`
    + (plan.skipped.length ? ` ${plan.skipped.length} row(s) set aside — ${plan.skipped.slice(0, 3).join(' · ')}`
      + (plan.skipped.length > 3 ? ` and ${plan.skipped.length - 3} more.` : '.') : '');
}

$('soBulkSheet').onclick = () => {
  const shown = soRows();
  const picked = shown.filter(r => SO_PICKED.has(r.id));
  const rows = picked.length ? picked : shown;
  if (!rows.length) { soMsg('Nothing to write — widen the filters, or fetch some orders.', true); return; }
  const bytes = soBulkXlsx(soBulkSheet(rows), soBinList());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `order-location-update-${sdToday()}.xlsx`;
  a.click(); URL.revokeObjectURL(a.href);
  soMsg(`Update sheet written for ${rows.length} order(s)${picked.length ? ' (the ticked ones)' : ''}. Pick Location and Line status from the dropdowns (or type a new one), fill At location, save, then Bulk update. A blank cell is left as it is; "-" clears it.`);
};
$('soBulkPick').onclick = () => $('soBulkFile').click();
$('soBulkFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const plan = soBulkPlan(/\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text()));
    if (plan.err) { soMsg(plan.err, true); return; }
    if (!plan.loc.size && !plan.lines.length) {
      soMsg('Nothing in that file differs from what is recorded.' + (plan.skipped.length ? ' ' + plan.skipped.length + ' row(s) set aside — ' + plan.skipped.slice(0, 3).join(' · ') : ''), !!plan.skipped.length);
      return;
    }
    const q = plan.lines.filter(l => l.q != null).length, st = plan.lines.filter(l => l.st != null).length;
    if (!confirm(`Update from ${file.name}?\n\n${plan.loc.size} location(s)\n${q} At location figure(s)\n${st} line status(es)`
      + (plan.skipped.length ? `\n\n${plan.skipped.length} row(s) will be set aside:\n${plan.skipped.slice(0, 8).join('\n')}` : ''))) return;
    soMsg(await soBulkApply(plan), plan.skipped.length > 0);
  } catch (err) { soMsg('Could not update: ' + (err.message || err), true); }
};

