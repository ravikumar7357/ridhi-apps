/* ================= IMPORTED ORDERS =================
 * Shops this app has no API key for: CPC's Shopify store and the four Etsy shops. Their orders are
 * brought in from a CSV and then behave EXACTLY like a fetched one — same columns, same MCF, the same
 * pick sheet. That is the whole point: a second, lesser view of an order is a second place to look.
 *
 * They are stored, not held in memory, because nobody wants to re-import to reopen the tab. Chunked
 * for the same reason the other lists are: one Firestore document will not hold them.
 *
 * An import REPLACES that channel's orders. A merge would need a rule for "the same order arriving
 * twice with different contents", and every rule for that is a guess; a full picture per file is a
 * thing a person can actually verify.
 */
const SO_IMP_CHUNK = 120;

async function loadShopImported() {
  if (SHOP_IMP_LOADED) return;
  SHOP_IMP_LOADED = true;
  try {
    const meta = await getDoc(doc(db, 'shop', 'imported'));
    if (!meta.exists()) return;
    const d = meta.data();
    SHOP_IMP_AT = d.at || {};
    let rows = [];
    if (d.chunks) {
      const got = await Promise.all(Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, 'shopimp', String(i)))));
      got.forEach(x => { if (x.exists()) rows = rows.concat(x.data().r || []); });
    }
    SHOP_IMP = rows;
  } catch (e) { SHOP_IMP = []; }
}

async function saveShopImported(rows) {
  const chunks = Math.ceil(rows.length / SO_IMP_CHUNK) || 1;
  for (let i = 0; i < chunks; i++) {
    await setDoc(doc(db, 'shopimp', String(i)), { r: rows.slice(i * SO_IMP_CHUNK, (i + 1) * SO_IMP_CHUNK) });
  }
  await setDoc(doc(db, 'shop', 'imported'),
    { chunks, n: rows.length, at: SHOP_IMP_AT, by: ME.email, saved: serverTimestamp() });
}

/* The canonical columns. Aliases cover what Shopify and Etsy actually call them in their own exports,
 * so a file downloaded from either usually imports without being edited first. */
const SO_IMP_COLS = [
  { k: 'no', t: 'Order', need: 1, alias: ['order', 'order number', 'name', 'order id', 'sale id', 'receipt id', 'order #'] },
  { k: 'at', t: 'Date', need: 1, alias: ['date', 'order date', 'created at', 'sale date', 'paid on'] },
  { k: 'sku', t: 'SKU', need: 1, alias: ['sku', 'lineitem sku', 'product sku', 'item sku'] },
  { k: 'qty', t: 'Qty', need: 1, alias: ['qty', 'quantity', 'lineitem quantity', 'number of items'] },
  { k: 'name', t: 'Product', alias: ['product', 'item name', 'lineitem name', 'title', 'product name'] },
  { k: 'variant', t: 'Variant', alias: ['variant', 'variations', 'lineitem variant', 'options'] },
  { k: 'price', t: 'Unit price', alias: ['unit price', 'price', 'lineitem price', 'item price'] },
  { k: 'total', t: 'Order total', alias: ['order total', 'total', 'order value', 'order net'] },
  { k: 'cur', t: 'Currency', alias: ['currency', 'currency code'] },
  { k: 'img', t: 'Image URL', alias: ['image url', 'image', 'photo', 'picture'] },
  { k: 'shipName', t: 'Ship to name', need: 1, alias: ['ship to name', 'name', 'shipping name', 'ship name', 'recipient'] },
  { k: 'a1', t: 'Address 1', need: 1, alias: ['address 1', 'shipping address1', 'ship address1', 'street 1', 'address'] },
  { k: 'a2', t: 'Address 2', alias: ['address 2', 'shipping address2', 'ship address2', 'street 2'] },
  { k: 'city', t: 'City', need: 1, alias: ['city', 'shipping city', 'ship city'] },
  { k: 'state', t: 'State', alias: ['state', 'province', 'shipping province', 'ship state'] },
  { k: 'zip', t: 'Zip', need: 1, alias: ['zip', 'postcode', 'postal code', 'shipping zip', 'ship zipcode'] },
  { k: 'country', t: 'Country', need: 1, alias: ['country', 'shipping country', 'ship country', 'country code'] },
  { k: 'phone', t: 'Phone', alias: ['phone', 'shipping phone', 'ship phone', 'buyer phone'] },
  { k: 'email', t: 'Email', alias: ['email', 'buyer email', 'customer email'] },
  { k: 'note', t: 'Note', alias: ['note', 'notes', 'message from buyer', 'buyer note', 'gift message'] },
];

function soImpFill() {
  $('soImpChan').innerHTML = SO_CHANNELS.map(c =>
    `<option value="${c}">${c}${SHOP_IMP_AT[c] ? ' — last imported ' + SHOP_IMP_AT[c] : ''}</option>`).join('');
}

$('soImp').onclick = async () => {
  await loadShopImported();
  SO_IMP_STAGED = null;
  $('soImpPrev').classList.add('hide');
  $('soImpErr').classList.add('hide');
  $('soImpSave').disabled = true;
  soImpFill();
  $('soImpModal').classList.remove('hide');
};
$('soImpCancel').onclick = () => $('soImpModal').classList.add('hide');
$('soImpModal').onclick = e => { if (e.target === $('soImpModal')) $('soImpModal').classList.add('hide'); };
$('soImpChan').onchange = () => { SO_IMP_STAGED = null; $('soImpPrev').classList.add('hide'); $('soImpSave').disabled = true; };

$('soImpTemplate').onclick = () => {
  const cell = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const head = SO_IMP_COLS.map(c => c.t);
  // One example order over TWO rows, because a multi-line order is the shape people get wrong.
  const ex = [
    ['1001', '2026-08-20', 'RPC327-1616', '2', 'Piping Flap Pillow', 'Blue / 16x16', '24.99', '74.97',
     'USD', '', 'Jane Doe', '12 Main St', 'Apt 4', 'Austin', 'TX', '73301', 'US', '5125550100',
     'jane@example.com', 'leave at door'],
    ['1001', '2026-08-20', 'RQL72-Q', '1', 'Asparagus Quilt', '', '24.99', '', '', '', '', '', '', '',
     '', '', '', '', '', ''],
  ];
  const lines = [head.map(cell).join(',')].concat(ex.map(r => r.map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'order-import-template.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

$('soImpPick').onclick = () => $('soImpFile').click();

$('soImpFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const chan = $('soImpChan').value;
  const err = t => { $('soImpErr').textContent = t; $('soImpErr').classList.remove('hide'); };
  $('soImpErr').classList.add('hide');
  try {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { err('That file has no rows.'); return; }
    const head = rows[0].map(h => String(h).trim().toLowerCase());

    /* MATCHED BY NAME, with the names Shopify and Etsy actually use. Position matching would break
     * on the first file with an extra column, and break silently — every value one place out. */
    const at = {};
    SO_IMP_COLS.forEach(c => {
      let idx = head.indexOf(c.t.toLowerCase());
      if (idx < 0) for (const a of c.alias) { const i = head.indexOf(a); if (i >= 0) { idx = i; break; } }
      if (idx >= 0) at[c.k] = idx;
    });
    const missing = SO_IMP_COLS.filter(c => c.need && at[c.k] == null).map(c => c.t);
    if (missing.length) {
      err('These columns are required and were not found: ' + missing.join(', ')
        + '. The file has: ' + head.filter(Boolean).slice(0, 18).join(', ')
        + '. Download the template to see the names it looks for.');
      return;
    }

    /* ONE ORDER, MANY ROWS. Every export writes a multi-line order as several rows, and the later
     * rows usually carry only the line — Shopify blanks the order columns outright. So an order's
     * details are taken from the FIRST row that has them, and later rows only add lines. */
    const cellOf = (row, k) => (at[k] == null ? '' : String(row[at[k]] == null ? '' : row[at[k]]).trim());
    const byNo = new Map();
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const no = cellOf(row, 'no');
      const sku = cellOf(row, 'sku');
      if (!no && !sku) continue;                    // a blank separator row
      if (!no) { skipped++; continue; }             // a line with no order to belong to
      let o = byNo.get(no);
      if (!o) {
        o = {
          id: 'IMP-' + chan.replace(/[^A-Za-z0-9]+/g, '') + '-' + no.replace(/[^A-Za-z0-9]+/g, ''),
          no: no, channel: chan, imported: 1,
          at: soImpDate(cellOf(row, 'at')),
          cancelledAt: '', cancelReason: '', fin: 'paid', ff: 'unfulfilled',
          trk: [], trkCo: '', trkUrl: '', shippedAt: '',
          cur: cellOf(row, 'cur') || 'USD',
          total: Number(String(cellOf(row, 'total')).replace(/[^0-9.\-]/g, '')) || 0,
          note: cellOf(row, 'note'), tags: '',
          ship: {
            name: cellOf(row, 'shipName'), company: '',
            a1: cellOf(row, 'a1'), a2: cellOf(row, 'a2'),
            city: cellOf(row, 'city'), state: cellOf(row, 'state'),
            zip: cellOf(row, 'zip'), country: cellOf(row, 'country'),
            phone: cellOf(row, 'phone'),
          },
          email: cellOf(row, 'email'),
          items: [],
        };
        byNo.set(no, o);
      } else {
        // Fill anything the first row left blank — some exports put the address on the LAST line.
        ['a1', 'a2', 'city', 'state', 'zip', 'country', 'phone'].forEach(k => {
          if (!o.ship[k]) o.ship[k] = cellOf(row, k);
        });
        if (!o.ship.name) o.ship.name = cellOf(row, 'shipName');
        if (!o.email) o.email = cellOf(row, 'email');
        if (!o.total) o.total = Number(String(cellOf(row, 'total')).replace(/[^0-9.\-]/g, '')) || 0;
        if (!o.note) o.note = cellOf(row, 'note');
      }
      if (!sku) continue;                            // an order row carrying no line
      const qty = Math.max(0, Math.round(Number(String(cellOf(row, 'qty')).replace(/[^0-9.\-]/g, '')) || 0));
      o.items.push({
        sku: sku, name: cellOf(row, 'name') || sku, variant: cellOf(row, 'variant'),
        qty: qty || 1,
        price: Number(String(cellOf(row, 'price')).replace(/[^0-9.\-]/g, '')) || 0,
        grams: 0, img: cellOf(row, 'img'), pid: '', vid: '',
      });
    }

    const list = [...byNo.values()];
    if (!list.length) { err('No usable orders found in that file.'); return; }

    /* SAID BEFORE ANYTHING IS SAVED. An address missing a line is not a bad row to drop — the order
     * is real and somebody has to deal with it — but MCF will happily ship to an incomplete address,
     * so it has to be visible BEFORE these become orders somebody acts on. */
    const badAddr = list.filter(o => !o.ship.a1 || !o.ship.city || !o.ship.country);
    const noSku = list.filter(o => !o.items.length);
    const noImg = list.reduce((n, o) => n + o.items.filter(i => !i.img).length, 0);
    const lines = list.reduce((n, o) => n + o.items.length, 0);

    SO_IMP_STAGED = { chan, list };
    $('soImpPrev').classList.remove('hide');
    $('soImpPrev').innerHTML =
      `<div><b>${list.length} order(s)</b>, ${lines} line(s), for <b>${esc0(chan)}</b>.</div>`
      + `<div class="muted" style="font-size:12px;margin-top:4px">`
      + `Matched columns: ${SO_IMP_COLS.filter(c => at[c.k] != null).map(c => esc0(c.t)).join(', ')}.</div>`
      + (skipped ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${skipped} row(s) had a line but no order number — those lines are lost. Check the file.</div>` : '')
      + (badAddr.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${badAddr.length} order(s) have an incomplete address (${badAddr.slice(0, 3).map(o => esc0(o.no)).join(', ')}${badAddr.length > 3 ? '…' : ''}). They will import, but MCF must not be used on them until the address is fixed.</div>` : '')
      + (noSku.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${noSku.length} order(s) have no SKU at all — nothing can be shipped or costed for them.</div>` : '')
      + `<div class="muted" style="font-size:12px;margin-top:4px">${noImg} line(s) have no picture in the file — those will be looked up from the SKU when you import.</div>`
      + `<div class="muted" style="font-size:12px;margin-top:6px">This REPLACES everything previously imported for ${esc0(chan)}.</div>`;
    $('soImpSave').disabled = false;
  } catch (e2) { err('Could not read that file: ' + (e2.message || e2)); }
};

/** Dates arrive in every shape a spreadsheet can produce. Anything unreadable stays BLANK rather
 *  than becoming today — a made-up date would put the order in the wrong day's counts. */
function soImpDate(v) {
  const t = String(v || '').trim();
  if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  // Ambiguous by nature. Shopify and Etsy both export month first, so that is the reading — and the
  // day/month pair only matters at the edges of a month, where being wrong is at most a day out.
  if (m) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
  const d = new Date(t);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const esc0 = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

$('soImpSave').onclick = async () => {
  if (!SO_IMP_STAGED) return;
  const { chan, list } = SO_IMP_STAGED;
  const btn = $('soImpSave'); btn.disabled = true; btn.textContent = 'Importing…';
  try {
    // Pictures for the lines that arrived without one. Asked once, for the distinct SKUs, and stored
    // on the line — resolving per render would be twenty catalogue calls every time the tab opened.
    const want = [...new Set(list.flatMap(o => o.items.filter(i => !i.img).map(i => i.sku.toUpperCase())))];
    // A missing picture must never fail the import — but it must not pass in silence either. An empty
    // box reads as "this product has no photo"; the reason it is empty is the thing worth knowing.
    let picWhy = '';
    if (want.length) {
      btn.textContent = 'Finding pictures…';
      for (let i = 0; i < want.length; i += 40) {
        try {
          const r = await prGet({ imgsku: want.slice(i, i + 40).join(',') });
          const got = r.d || {};
          if (!picWhy && r.why) picWhy = r.why;
          list.forEach(o => o.items.forEach(it => {
            if (!it.img && got[it.sku.toUpperCase()]) it.img = got[it.sku.toUpperCase()];
          }));
        } catch (e) { if (!picWhy) picWhy = 'The picture lookup itself failed: ' + (e.message || e); }
      }
    }
    btn.textContent = 'Saving…';
    const keep = SHOP_IMP.filter(o => o.channel !== chan);
    const next = keep.concat(list);
    SHOP_IMP_AT = { ...SHOP_IMP_AT, [chan]: soStamp() };
    await saveShopImported(next);
    SHOP_IMP = next;
    $('soImpModal').classList.add('hide');
    renderShop();
    // Asked for N distinct SKUs and got none back is the signature of a lookup that never worked at
    // all (a renamed Catalog column, the wrong tab) — that one is said in red. A few SKUs the
    // catalogue simply does not carry is ordinary, and stays a note.
    const noPic = list.reduce((n, o) => n + o.items.filter(i => !i.img).length, 0);
    const stillNo = new Set(list.flatMap(o => o.items.filter(i => !i.img).map(i => i.sku.toUpperCase())));
    const picBroke = want.length > 0 && stillNo.size >= want.length;
    soMsg(`${list.length} order(s) imported for ${chan}. They behave like any other order from here on.` +
      (noPic ? `  ·  ${noPic} line(s) have no picture${picWhy ? ' — ' + picWhy : ''}` : ''), picBroke);
  } catch (e) {
    $('soImpErr').textContent = 'Could not save: ' + (e.message || e);
    $('soImpErr').classList.remove('hide');
  }
  btn.disabled = false; btn.textContent = 'Import';
};

$('soImpClear').onclick = async () => {
  const chan = $('soImpChan').value;
  const have = SHOP_IMP.filter(o => o.channel === chan).length;
  if (!have) { $('soImpErr').textContent = 'Nothing imported for ' + chan + ' yet.'; $('soImpErr').classList.remove('hide'); return; }
  if (!confirm(`Remove all ${have} imported order(s) for ${chan}?`)) return;
  const next = SHOP_IMP.filter(o => o.channel !== chan);
  delete SHOP_IMP_AT[chan];
  await saveShopImported(next);
  SHOP_IMP = next;
  soImpFill();
  renderShop();
  soMsg(`${have} imported order(s) removed for ${chan}.`);
};


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

$('soExport').onclick = () => {
  /* TICKED FIRST, EVERYTHING SHOWN OTHERWISE — the same rule as Print orders, deliberately.
   *
   * Export used to ignore the ticks entirely, so the one control that says "these ones" worked for
   * the printer and not for the file. Somebody ticking four orders and pressing Export got all 466,
   * and nothing on screen had said it would. Two buttons sitting next to each other must not read
   * the same tick differently. */
  const shownRows = soRows();
  const pickedRows = shownRows.filter(r => SO_PICKED.has(r.id));
  const rows = pickedRows.length ? pickedRows : shownRows;
  const usedTicks = pickedRows.length > 0;
  if (!rows.length) { soMsg('Nothing to export \u2014 widen the filters, or fetch some orders.', true); return; }
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const pick = $('soTmpl').value;
  const T = SO_TMPL[pick];
  if (T) {
    // SAID BEFORE THE FILE IS WRITTEN, not after the uploader rejects it. DHL's own guide makes one
    // complete invoice pair mandatory, and an HS code mandatory on every line — both are things
    // only a person can supply, and both are invisible until the upload fails.
    if (pick === 'dhlh' || pick === 'dhlc') {
      const noInv = [], noHs = new Set();
      rows.forEach(r => {
        const m = SHOP_META[r.id] || {};
        const pair = (m.gstInv && m.gstInvDate) || (m.ngstInv && m.ngstInvDate);
        if (!pair) noInv.push(r.no);
        r.items.forEach(i => { if (i.sku && !soSku(i.sku).hs) noHs.add(String(i.sku).toUpperCase()); });
      });
      if (noInv.length || noHs.size) {
        soMsg('Not written — DHL would reject it. '
          + (noInv.length ? noInv.length + ' order(s) have no complete invoice pair (' + noInv.slice(0, 4).join(', ') + (noInv.length > 4 ? '…' : '') + '). ' : '')
          + (noHs.size ? noHs.size + ' SKU(s) have no HS code (' + [...noHs].slice(0, 4).join(', ') + (noHs.size > 4 ? '…' : '') + ').' : '')
          + ' Open the order and fill them under Invoice & customs.', true);
        return;
      }
    }
    const lines = [T.head.map(cell).join(',')];
    let seq = 0;
    // NAMED, NOT SILENTLY MISSING. An order whose every line is refunded, removed or set to 0 writes
    // no rows — which is right, but an order absent from a courier file is otherwise discovered at
    // the counter, by its absence.
    const nothing = [];
    rows.forEach(r => {
      seq++;
      const meta = SHOP_META[r.id] || {};
      const built = T.rows(r, seq, meta);
      if (!built.length) { nothing.push(r.no); return; }
      built.forEach(line => {
        // Padded to the template's own width. A short row shifts every later column by one, and the
        // uploader reads the shifted value rather than refusing it.
        const out = line.slice(0, T.head.length);
        while (out.length < T.head.length) out.push('');
        lines.push(out.map(cell).join(','));
      });
    });
    const blob0 = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a0 = document.createElement('a'); a0.href = URL.createObjectURL(blob0);
    a0.download = T.file + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    a0.click(); URL.revokeObjectURL(a0.href);
    // DHL HYBRID CARRIES NO CURRENCY COLUMN AT ALL.
    //
    // Its own bundled user guide calls "Shipment Currency" mandatory — but that guide is the CSV
    // template's, pasted into the Hybrid workbook, and Hybrid's Sheet1 has no such column (nor
    // Terms of Trade, Tax Payment Option or Total Item FOB value). So the rates in a Hybrid file are
    // read in whatever currency the DHL account is set to, and nothing in the file says which.
    //
    // Getting that backwards is not a rounding error: INR read as USD is out by a factor of about
    // eighty. The app cannot check it, so it says so rather than letting the file leave quietly.
    const curNote = (pick === 'dhlh' && (rows[0] && (SHOP_META[rows[0].id] || {}).cur) !== 'USD')
      ? ' NOTE: the Hybrid sheet has no currency column — DHL will read these rates in whatever'
        + ' currency your account is set to. Confirm with DHL that it is INR.'
      : '';
    soMsg(`${T.file}: ${lines.length - 1} row(s) for ${rows.length} order(s)${usedTicks ? ' (ticked)' : ' (everything shown)'}. `
      + `Invoice numbers and dates are deliberately blank — fill them in before uploading.`
      + (nothing.length ? ` Left out ${nothing.length} order(s) with nothing left to ship: ${nothing.slice(0, 6).join(', ')}${nothing.length > 6 ? '…' : ''}.` : '')
      + curNote,
      !!curNote || nothing.length > 0);
    return;
  }
  /* ONE ROW PER LINE ITEM by default, with the order's own fields REPEATED on every row.
   *
   * Shopify's own export blanks the order columns on continuation rows, and that shape is only safe
   * for as long as nobody sorts the file. One sort and a line has lost the order it belonged to.
   * This file exists to be filtered, sorted and pivoted, so every row carries its own order.
   *
   * "One row per order" stays available for anything that counts ORDERS rather than pieces — on a
   * line item file the same order would be counted once per line.
   */
  const perOrder = pick === 'plainOrder';
  const ORDER_COLS = ['Shop', 'Order', 'Date', 'Ship to', 'Company', 'Address 1', 'Address 2', 'City', 'State',
    'Zip', 'Country', 'Phone', 'Email', 'Order units', 'Weight kg', 'Order value', 'Currency',
    'Location', 'To make', 'Ship from', 'MCF', 'India', 'Shopify status', 'Shipped on', 'Tracking',
    'Tracking carrier', 'Status', 'Our note', 'Shopify note', 'Ship via', 'Contents', 'Declared value'];
  /* A STATUS PER LINE, not one per order.
   *
   * "Required from production" on an order says nothing about the line inside it that is in FBA and
   * could go today — and it is the LINE that somebody picks, costs and chases. Same wording and the
   * same order of preference as the order-level route, so a line and its order cannot disagree.
   * `Qty refunded` sits beside it because a cancelled line is almost always a refunded one, and the
   * number is what makes the status checkable rather than something to be taken on trust. */
  const LINE_COLS = ['SKU', 'Amazon SKU', 'Product', 'Variant', 'Qty ordered', 'Qty refunded',
    'Qty removed', 'Qty to send', 'Unit price', 'Line total', 'Bin', 'FBA available',
    'India sellable', 'Comments'];

  /* IN THE BY-LINE FILE, "Ship from" ANSWERS FOR THE LINE.
   *
   * Every row in that file IS a line, so a "Ship from" column repeating the order's summary was the
   * one column somebody would read per line and be wrong about: an order reading "Need from
   * production" carries lines that are sitting in FBA and could go today. The order's own verdict
   * keeps its place beside it under its own name — nothing is lost, and where a line and its order
   * differ the file now shows both instead of hiding one.
   *
   * The by-ORDER file is unchanged: there, one row is one order and the summary is the answer.
   */
  const SHIP_AT = ORDER_COLS.indexOf('Ship from');
  const head = perOrder
    ? ORDER_COLS.concat(['Items'])
    : ORDER_COLS.slice(0, SHIP_AT + 1)
        .concat(['Order ship from'], ORDER_COLS.slice(SHIP_AT + 1), LINE_COLS);
  const lines = [head.map(cell).join(',')];
  const orderCells = (r, meta) => [r.channel, r.no, r.at, r.ship.name, r.ship.company, r.ship.a1, r.ship.a2,
    r.ship.city, r.ship.state, r.ship.zip, r.ship.country, r.ship.phone, r.email, r.units,
    r.kg ? r.kg.toFixed(2) : '', r.total, r.cur, r.locTxt || '', r.makeQty || '', r.route, r.mcf, r.india,
    r.ff || '', r.shippedAt || '', r.trkTxt || '', r.trkCo || '', r.status, r.note, r.shopNote,
    r.carrier, meta.desc || '', meta.val == null ? '' : meta.val];
  let lineCount = 0;
  rows.forEach(r => {
    const meta = SHOP_META[r.id] || {};
    if (perOrder) {
      lines.push(orderCells(r, meta).concat([
        // The bin travels with each line, so the list is readable on its own.
        // The bin AND the line's own status travel with each line, so the one-row-per-order file is
        // still readable on its own and does not have to be joined back to the line file.
        r.items.map(i => `${i.sku || i.name} x${i.qty}${soLocOf(i.sku) ? ' @' + soLocOf(i.sku) : ''}`
          + ` [${soLineState(r, i).label}]`).join(' | '),
      ]).map(cell).join(','));
      return;
    }
    // An order with NO line items still gets one row. Dropping it would make the file quietly
    // disagree with the order count on screen, and the missing order is exactly the odd one.
    const items = r.items.length ? r.items : [null];
    // The line's own verdict takes the "Ship from" slot; the order's slides one to the right.
    const base = orderCells(r, meta);
    const shipCells = lineRoute => base.slice(0, SHIP_AT)
      .concat([lineRoute, base[SHIP_AT]], base.slice(SHIP_AT + 1));
    items.forEach(i => {
      lineCount++;
      if (!i) { lines.push(shipCells('').concat(LINE_COLS.map(() => '')).map(cell).join(',')); return; }
      const shop = String(i.sku || '').trim().toUpperCase();
      const amz = soAmzSku(i.sku);
      const send = soSendQty(r.id, i.sku, soLive(i));
      const ind = soIndiaOf(i.sku);
      const fbaK = String(amz || '').toUpperCase();
      const fba = fbaK ? (soOrdFba(r, fbaK) ?? '') : '';
      const st = soLineState(r, i);
      lines.push(shipCells(st.label).concat([
        shop, amz && amz !== shop ? amz : '', i.name || '', i.variant || '',
        i.qty, i.rq || '', soRemovedQty(i) || '', send, i.price == null ? '' : i.price,
        i.price == null ? '' : Math.round(i.price * i.qty * 100) / 100,
        soLocOf(shop) || '', fba, ind ? ind[0] : '', st.why,
      ]).map(cell).join(','));
    });
  });
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'shopify-orders-' + (perOrder ? 'by-order-' : 'by-line-')
    + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
  const how = usedTicks ? ' (ticked)' : ' (everything shown)';
  soMsg(perOrder
    ? `${rows.length} order(s) written, one row each${how}.`
    : `${lineCount} line(s) across ${rows.length} order(s)${how} \u2014 one row per line item, order repeated on each.`);
};


