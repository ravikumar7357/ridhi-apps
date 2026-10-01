/* ================= ADJUSTMENTS TAB =================
 *
 * The same records the order dialog writes, read straight out of SHOP_META rather than copied into
 * a list of their own. One place a job can exist means it cannot be open here and closed there.
 *
 * It works without fetching Shopify at all: everything a job needs was copied onto it when it was
 * raised, because the jobs that matter most are the old ones nobody is looking at.
 *
 * Four states, in the order they actually happen:
 *   raised    somebody found the problem
 *   sent      the sheet went to production
 *   accepted  production took it on and named a date
 *   received  shipping has the pieces back
 */
const AJ_STATE = {
  raised:   '<span class="st st-draft">Raised</span>',
  sent:     '<span class="st st-pending">With production</span>',
  accepted: '<span class="st st-pending">Accepted</span>',
  received: '<span class="st st-approved">Received</span>',
};
let AJ_PICKED = new Set();

async function ensureAdj() {
  if (!Object.keys(SHOP_META).length) await loadShopMeta();
  if (!Object.keys(SHOP_SKU).length) await loadShopSku();
  if (!$('ajFrom').value) {
    // Reaches TOMORROW. A job raised late in the day is the one somebody is chasing, and a window
    // that stops at "today" is exactly where it disappears.
    $('ajTo').value = sdShift(sdToday(), 1);
    $('ajFrom').value = sdShift(sdToday(), -30);
  }
  renderAdj();

  /* Bring the Order Console up to date with every adjustment, not just the one somebody last
   * saved. This is what reaches the ones raised before any of this existed, and the ones raised on
   * somebody else's screen. It writes nothing when there is nothing to do, so opening this tab
   * twice costs one read. Reported here rather than thrown: the tab itself is fine either way. */
  await shpSyncSoon('adj');
}

/** Every adjustment ever raised, flattened out of the per-order records. */
function ajAll() {
  const out = [];
  Object.entries(SHOP_META).forEach(([orderId, m]) => {
    Object.entries((m && m.lines) || {}).forEach(([sku, ln]) => {
      if (!ln || !ln.adj) return;
      out.push({
        orderId, sku, ln,
        id: ln.adj,
        at: ln.adjAt || '',
        day: String(ln.adjAt || '').slice(0, 10),
        order: ln.adjOrder || '',
        orderDate: ln.adjOrderDate || '',
        customer: ln.adjCustomer || '',
        name: ln.adjName || '',
        qty: Number(ln.adjQty) || 0,
        send: ln.adjSend || '', want: ln.adjWant || '',
        reason: ln.adjReason || '', note: ln.adjNote || '',
        img: ln.adjImg || '', loc: ln.adjLoc || soLocOf(sku),
        ordered: ln.adjOrdered, staged: ln.adjStaged,
        state: ln.adjState || 'raised',
        sentAt: ln.adjSentAt || '',
        accBy: ln.adjAccBy || '', accAt: ln.adjAccAt || '', due: ln.adjDue || '',
        recBy: ln.adjRecBy || '', recAt: ln.adjRecAt || '', recQty: ln.adjRecQty,
      });
    });
  });
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out;
}

function ajRows() {
  const st = $('ajState').value;
  const q = $('ajFilter').value.trim().toLowerCase();
  const from = $('ajFrom').value, to = $('ajTo').value;
  const today = sdToday();
  return ajAll().filter(r => {
    if (from && r.day && r.day < from) return false;
    if (to && r.day && r.day > to) return false;
    if (st === 'OPEN' && r.state === 'received') return false;
    else if (st === 'LATE' && !(r.state !== 'received' && r.due && r.due < today)) return false;
    else if (st !== 'ALL' && st !== 'OPEN' && st !== 'LATE' && r.state !== st) return false;
    if (q && !(r.id + ' ' + r.order + ' ' + r.sku + ' ' + r.name + ' ' + r.customer
      + ' ' + r.send + ' ' + r.want).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderAdj() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const rows = ajRows();
  const today = sdToday();

  const n = s => rows.filter(r => r.state === s).length;
  const late = rows.filter(r => r.state !== 'received' && r.due && r.due < today).length;
  const pcs = rows.reduce((s, r) => s + r.qty, 0);
  const tile = (l, v, c) => `<div class="metric"><div class="v"${c ? ` style="color:${c}"` : ''}>${v}</div><div class="l">${l}</div></div>`;
  $('ajKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Adjustments</span>
      <span class="kpiwhen">${rows.length} shown of ${ajAll().length} ever raised</span></div>
    <div class="metrics">
      ${tile('Pieces to make', pcs)}
      ${tile('Raised', n('raised'))}
      ${tile('With production', n('sent'), '#92400e')}
      ${tile('Accepted', n('accepted'), '#1e40af')}
      ${tile('Received back', n('received'), '#166534')}
      ${tile('Past promised date', late, late ? 'var(--bad)' : '')}
    </div></div>`;

  const head = '<thead><tr>'
    + '<th style="width:28px"><input type="checkbox" id="ajAll" title="Tick every row on screen"></th>'
    + '<th style="width:52px"></th><th>Adjustment</th><th>Order</th><th>SKU</th><th>Product</th>'
    + '<th>Sending &rarr; make in</th><th class="num">Qty</th><th>Reason</th><th>Bin</th>'
    + '<th>Raised</th><th>State</th><th>Promised</th><th>Back</th></tr></thead>';

  const body = rows.map(r => {
    const overdue = r.state !== 'received' && r.due && r.due < today;
    return '<tr' + (overdue ? ' style="background:#fef2f2"' : '') + '>'
      + '<td><input type="checkbox" class="ajPick" data-k="' + esc(r.orderId + '|' + r.sku) + '"'
        + (AJ_PICKED.has(r.orderId + '|' + r.sku) ? ' checked' : '') + '></td>'
      + '<td style="padding:2px 6px">' + (r.img
          ? '<img src="' + esc(r.img) + '" loading="lazy" decoding="async" alt=""'
            + ' style="width:38px;height:38px;object-fit:cover;border-radius:5px;background:#f1f5f9">'
          : '<span class="muted">—</span>') + '</td>'
      + '<td style="font-family:ui-monospace,monospace;font-size:11px">' + esc(r.id) + '</td>'
      + '<td>' + esc(r.order) + '<div class="muted" style="font-size:10.5px">' + esc(r.customer) + '</div></td>'
      + '<td style="font-family:ui-monospace,monospace;font-size:11px">' + esc(r.sku) + '</td>'
      + '<td title="' + esc(r.name) + '">' + esc(String(r.name).slice(0, 26)) + '</td>'
      + '<td style="white-space:nowrap">' + esc(r.send || '—') + ' &rarr; <b>' + esc(r.want || '—') + '</b></td>'
      + '<td class="num" style="font-weight:700">' + r.qty + '</td>'
      + '<td>' + esc(r.reason || '—') + '</td>'
      + '<td>' + esc(r.loc || '—') + '</td>'
      + '<td style="white-space:nowrap;font-size:11px">' + esc(r.at) + '</td>'
      + '<td>' + (AJ_STATE[r.state] || esc(r.state))
        + (r.accBy ? '<div class="muted" style="font-size:10px">' + esc(r.accBy) + '</div>' : '') + '</td>'
      + '<td style="white-space:nowrap">' + (r.due
          ? (overdue ? '<span class="sd-dn">' + esc(r.due) + '</span>' : esc(r.due))
          : '<span class="muted">—</span>') + '</td>'
      + '<td style="white-space:nowrap;font-size:11px">' + (r.recAt
          ? esc(r.recAt) + (r.recQty != null ? '<div class="muted" style="font-size:10px">' + r.recQty + ' pc</div>' : '')
          : '<span class="muted">—</span>') + '</td>'
      + '</tr>';
  }).join('');

  $('ajTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="14" class="muted" style="padding:14px">Nothing matches. Adjustments are raised inside an order on the Shopify Orders tab.</td></tr>')
    + '</tbody>';

  $('ajTable').querySelectorAll('.ajPick').forEach(cb => {
    cb.onchange = () => { cb.checked ? AJ_PICKED.add(cb.dataset.k) : AJ_PICKED.delete(cb.dataset.k); ajMsgPicked(); };
  });
  const all = $('ajAll');
  if (all) all.onchange = () => {
    $('ajTable').querySelectorAll('.ajPick').forEach(cb => {
      cb.checked = all.checked;
      all.checked ? AJ_PICKED.add(cb.dataset.k) : AJ_PICKED.delete(cb.dataset.k);
    });
    ajMsgPicked();
  };
  ajMsgPicked();
}

function ajMsgPicked() {
  const m = $('ajMsg');
  m.className = 'muted';
  m.textContent = AJ_PICKED.size
    ? `${AJ_PICKED.size} ticked · Print, Mark sent, Accept or Received apply to these.`
    : 'Tick rows to print them or move them along. Nothing here changes an order — only what production owes.';
}
['ajState', 'ajFrom', 'ajTo'].forEach(id => $(id).addEventListener('change', renderAdj));
let AJ_FT = null;
$('ajFilter').addEventListener('input', () => { clearTimeout(AJ_FT); AJ_FT = setTimeout(renderAdj, 250); });

/** The ticked rows, as live records. */
function ajPicked() {
  return ajAll().filter(r => AJ_PICKED.has(r.orderId + '|' + r.sku));
}
async function ajApply(fn) {
  const picked = ajPicked();
  if (!picked.length) { $('ajMsg').textContent = 'Tick some rows first.'; $('ajMsg').className = 'err'; return false; }
  picked.forEach(r => fn(SHOP_META[r.orderId].lines[r.sku], r));
  try { await saveShopMeta(); renderAdj(); return true; }
  catch (e) { $('ajMsg').textContent = 'Could not save: ' + (e.message || e); $('ajMsg').className = 'err'; return false; }
}

$('ajSent').onclick = async () => {
  const stamp = soStamp();
  // Only forward. Marking a job "sent" that production has already accepted would quietly undo
  // their promised date, and that date is the only thing anybody downstream is planning against.
  const ok = await ajApply(ln => {
    if (ln.adjState === 'raised' || !ln.adjState) { ln.adjState = 'sent'; ln.adjSentAt = stamp; }
  });
  if (ok) $('ajMsg').textContent = 'Marked sent. Anything already accepted was left as it was.';
};

let AJW_MODE = null;
function ajOpenW(mode) {
  if (!ajPicked().length) { $('ajMsg').textContent = 'Tick some rows first.'; $('ajMsg').className = 'err'; return; }
  AJW_MODE = mode;
  const picked = ajPicked();
  const pcs = picked.reduce((s, r) => s + r.qty, 0);
  $('ajwTitle').textContent = mode === 'accept' ? 'Production accepts' : 'Received back from production';
  $('ajwSub').textContent = `${picked.length} job(s) · ${pcs} piece(s) · ${picked.map(r => r.id).slice(0, 3).join(', ')}${picked.length > 3 ? '…' : ''}`;
  $('ajwDateLbl').textContent = mode === 'accept' ? 'Will be ready by' : 'Received on';
  $('ajwDate').value = mode === 'accept' ? '' : sdToday();
  // On a single job the quantity is known, so it is filled in. On a batch it is left blank rather
  // than guessed — writing the same number against every job would be a fiction.
  $('ajwQtyWrap').style.display = mode === 'accept' ? 'none' : '';
  $('ajwQty').value = (mode === 'receive' && picked.length === 1) ? picked[0].qty : '';
  const who = [...new Set(ajAll().flatMap(r => [r.accBy, r.recBy]).filter(Boolean))].sort();
  $('ajwWhoList').innerHTML = who.map(w => `<option value="${String(w).replace(/"/g, '&quot;')}">`).join('');
  $('ajwWho').value = '';
  $('ajwNote').value = '';
  $('ajwErr').classList.add('hide');
  $('ajwModal').classList.remove('hide');
  $('ajwDate').focus();
}
$('ajAccept').onclick = () => ajOpenW('accept');
$('ajRecv').onclick = () => ajOpenW('receive');
$('ajwCancel').onclick = () => { $('ajwModal').classList.add('hide'); AJW_MODE = null; };

$('ajwSave').onclick = async () => {
  const date = $('ajwDate').value, who = $('ajwWho').value.trim(), note = $('ajwNote').value.trim();
  if (!date) {
    $('ajwErr').textContent = AJW_MODE === 'accept'
      ? 'A promised date is the whole point of accepting — without it nothing can be chased.'
      : 'When did it come back?';
    $('ajwErr').classList.remove('hide');
    return;
  }
  const stamp = soStamp();
  const qty = $('ajwQty').value === '' ? null : Math.max(0, Math.round(Number($('ajwQty').value)));
  const ok = await ajApply((ln, r) => {
    if (AJW_MODE === 'accept') {
      ln.adjState = 'accepted'; ln.adjDue = date; ln.adjAccBy = who; ln.adjAccAt = stamp;
      if (note) ln.adjAccNote = note;
    } else {
      ln.adjState = 'received'; ln.adjRecAt = date; ln.adjRecBy = who;
      ln.adjRecQty = qty == null ? r.qty : qty;
      if (note) ln.adjRecNote = note;
    }
  });
  if (ok) {
    $('ajwModal').classList.add('hide');
    AJW_MODE = null;
    AJ_PICKED.clear();
    renderAdj();
  }
};

$('ajExport').onclick = () => {
  const rows = ajRows();
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['Adjustment ID', 'Raised', 'Shopify order', 'Order date', 'Customer', 'SKU', 'Product',
    'Sending', 'Make in', 'Qty', 'Reason', 'Bin', 'Ordered', 'At location', 'State',
    'Sent', 'Accepted by', 'Accepted', 'Promised', 'Received by', 'Received', 'Qty received', 'Note'];
  const lines = [head.map(cell).join(',')];
  rows.forEach(r => lines.push([r.id, r.at, r.order, r.orderDate, r.customer, r.sku, r.name,
    r.send, r.want, r.qty, r.reason, r.loc, r.ordered, r.staged, r.state,
    r.sentAt, r.accBy, r.accAt, r.due, r.recBy, r.recAt, r.recQty, r.note].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'adjustments-' + sdToday() + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
};


/* ---- from Sellora: Courier & MCF templates ---- */
/* ================= Courier & MCF upload templates =================
 *
 * The four column lists below are transcribed from the workbooks in `templates/`, in their exact
 * order and spelling — including the ones that read like mistakes (`UOM1` with no space, two
 * different columns both called `Account #`, the line break inside FedEx's `Duty Drawback S.No`).
 * They are what each uploader matches on, so a "tidier" heading is a rejected file.
 *
 * ONE SHIPMENT IS NOT ONE ROW. Three of the four repeat an order across several rows when it has
 * more than one commodity line: the first row carries everything, the continuation rows carry only
 * the item block and leave every shipment-level cell blank. Writing one flat row per line item
 * instead would book one PARCEL per line — six shipments where one was meant.
 */

/** Shopify gives a 2-letter code; DHL validates against its own Country Master. From that sheet. */
const SO_CTRY = Object.fromEntries('AD:ANDORRA|AE:UNITED ARAB EMIRATES|AF:AFGHANISTAN|AG:ANTIGUA|AI:ANGUILLA|AL:ALBANIA|AM:ARMENIA|AO:ANGOLA|AR:ARGENTINA|AS:AMERICAN SAMOA|AT:AUSTRIA|AU:AUSTRALIA|AW:ARUBA|AZ:AZERBAIJAN|BA:BOSNIA AND HERZEGOVINA|BB:BARBADOS|BD:BANGLADESH|BE:BELGIUM|BF:BURKINA FASO|BG:BULGARIA|BH:BAHRAIN|BI:BURUNDI|BJ:BENIN|BM:BERMUDA|BN:BRUNEI|BO:BOLIVIA|BR:BRAZIL|BS:BAHAMAS|BT:BHUTAN|BW:BOTSWANA|BY:BELARUS|BZ:BELIZE|CA:CANADA|CD:CONGO, THE DEMOCRATIC REPUBLIC OF|CF:CENTRAL AFRICAN REPUBLIC|CG:CONGO|CH:SWITZERLAND|CI:COTE D IVOIRE|CK:COOK ISLANDS|CL:CHILE|CM:CAMEROON|CN:CHINA, PEOPLES REPUBLIC|CO:COLOMBIA|CR:COSTA RICA|CU:CUBA|CV:CAPE VERDE|CY:CYPRUS|CZ:CZECH REPUBLIC, THE|DE:GERMANY|DJ:DJIBOUTI|DK:DENMARK|DM:DOMINICA|DO:DOMINICAN REPUBLIC|DZ:ALGERIA|EC:ECUADOR|EE:ESTONIA|EG:EGYPT|ER:ERITREA|ES:SPAIN|ET:ETHIOPIA|FI:FINLAND|FJ:FIJI|FK:FALKLAND ISLANDS|FM:MICRONESIA, FEDERATED STATES OF|FO:FAROE ISLANDS|FR:FRANCE|GA:GABON|GB:UNITED KINGDOM|GD:GRENADA|GE:GEORGIA|GF:FRENCH GUYANA|GG:GUERNSEY|GH:GHANA|GI:GIBRALTAR|GL:GREENLAND|GM:GAMBIA|GN:GUINEA REPUBLIC|GP:GUADELOUPE|GQ:GUINEA-EQUATORIAL|GR:GREECE|GT:GUATEMALA|GU:GUAM|GW:GUINEA-BISSAU|GY:GUYANA (BRITISH)|HK:HONG KONG|HN:HONDURAS|HR:CROATIA|HT:HAITI|HU:HUNGARY|IC:CANARY ISLANDS, THE|ID:INDONESIA|IE:IRELAND, REPUBLIC OF|IL:ISRAEL|IN:INDIA|IQ:IRAQ|IR:IRAN (ISLAMIC REPUBLIC OF)|IS:ICELAND|IT:ITALY|JE:JERSEY|JM:JAMAICA|JO:JORDAN|JP:JAPAN|KE:KENYA|KG:KYRGYZSTAN|KH:CAMBODIA|KI:KIRIBATI|KM:COMOROS|KN:ST. KITTS|KP:KOREA, THE D.P.R OF (NORTH K.)|KR:KOREA, REPUBLIC OF (SOUTH K.)|KV:KOSOVO|KW:KUWAIT|KY:CAYMAN ISLANDS|KZ:KAZAKHSTAN|LA:LAO PEOPLES DEMOCRATIC REPUBLIC|LB:LEBANON|LC:ST. LUCIA|LI:LIECHTENSTEIN|LK:SRI LANKA|LR:LIBERIA|LS:LESOTHO|LT:LITHUANIA|LU:LUXEMBOURG|LV:LATVIA|LY:LIBYA|MA:MOROCCO|MD:MOLDOVA, REPUBLIC OF|ME:MONTENEGRO, REPUBLIC OF|MG:MADAGASCAR|MH:MARSHALL ISLANDS|MK:MACEDONIA, REPUBLIC OF|ML:MALI|MM:MYANMAR|MN:MONGOLIA|MO:MACAU|MP:COMMONWEALTH NO. MARIANA ISLANDS|MQ:MARTINIQUE|MR:MAURITANIA|MS:MONTSERRAT|MT:MALTA|MU:MAURITIUS|MV:MALDIVES|MW:MALAWI|MX:MEXICO|MY:MALAYSIA|MZ:MOZAMBIQUE|NA:NAMIBIA|NC:NEW CALEDONIA|NE:NIGER|NG:NIGERIA|NI:NICARAGUA|NL:NETHERLANDS, THE|NO:NORWAY|NP:NEPAL|NR:NAURU, REPUBLIC OF|NU:NIUE|NZ:NEW ZEALAND|OM:OMAN|PA:PANAMA|PE:PERU|PF:TAHITI|PG:PAPUA NEW GUINEA|PH:PHILIPPINES, THE|PK:PAKISTAN|PL:POLAND|PR:PUERTO RICO|PT:PORTUGAL|PW:PALAU|PY:PARAGUAY|QA:QATAR|RE:REUNION, ISLAND OF|RO:ROMANIA|RS:SERBIA, REPUBLIC OF|RU:RUSSIAN FEDERATION, THE|RW:RWANDA|SA:SAUDI ARABIA|SB:SOLOMON ISLANDS|SC:SEYCHELLES|SD:SUDAN|SE:SWEDEN|SG:SINGAPORE|SI:SLOVENIA|SK:SLOVAKIA|SL:SIERRA LEONE|SM:SAN MARINO|SN:SENEGAL|SO:SOMALIA|SR:SURINAME|SS:SOUTH SUDAN|ST:SAO TOME AND PRINCIPE|SV:EL SALVADOR|SY:SYRIA|SZ:SWAZILAND|TC:TURKS AND CAICOS ISLANDS|TD:CHAD|TG:TOGO|TH:THAILAND|TJ:TAJIKISTAN|TL:EAST TIMOR|TN:TUNISIA|TO:TONGA|TR:TURKEY|TT:TRINIDAD AND TOBAGO|TV:TUVALU|TW:TAIWAN|TZ:TANZANIA|UA:UKRAINE|UG:UGANDA|US:UNITED STATES OF AMERICA|UY:URUGUAY|UZ:UZBEKISTAN|VC:ST. VINCENT|VE:VENEZUELA|VG:VIRGIN ISLANDS (BRITISH)|VI:VIRGIN ISLANDS (US)|VN:VIETNAM|VU:VANUATU|WS:SAMOA|XB:BONAIRE|XC:CURACAO|XE:ST. EUSTATIUS|XM:ST. MAARTEN|XN:NEVIS|XS:SOMALILAND, REP OF (NORTH SOMALIA)|XY:ST. BARTHELEMY|YE:YEMEN, REPUBLIC OF|YT:MAYOTTE|ZA:SOUTH AFRICA|ZM:ZAMBIA|ZW:ZIMBABWE'
  .split('|').map(p => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }));
const soCode = r => String(r.ship.country || '').trim().toUpperCase().slice(0, 2);
const soCtryName = r => SO_CTRY[soCode(r)] || String(r.ship.country || '');

/* Everything that is the same on every shipment, read off the test entries already in the
 * workbooks. One place, so a changed AD code or HS code is one edit and not a hunt. */
const SO_CO = {
  regNo: 'AD0803210121871', regType: 'ARN', regIssuer: 'US', partyType: 'DC',
  gstin: '08ABIPR0673D1ZN', adCode: '63905195000009',
  hsExport: '63049249', hsImport: '6302512000',
  mfgCountry: 'IN', originState: 'Rajasthan', originDistrict: 'Jaipur',
  igstPct: 5, uom: 'PCS', fedexUom: 'PIECE', terms: 'DDP',
  taxOption: 'Against Bond or Undertaking', ecommerce: 'Yes',
  svp: 'No', insured: 0, commodityType: 'Others',
  pieces: 1, boxL: 10, boxW: 10, boxH: 10,
  fedexCurrency: 'US DOLLARS-USD', fedexOrigin: 'IN-INDIA', fedexPackaging: 'FedEx Pak',
  // FedEx's sheet spells its currencies out and ships no list to check against, so this one is a
  // guess from the pattern of the dollar entry. Confirm it against a FedEx upload before trusting it.
  fedexCurrencyInr: 'INDIAN RUPEES-INR',
  marketplaceId: 'ATVPDKIKX0DER',
};

/* Per-order box, falling back to the standing defaults where nothing was typed. */
function soBox(meta) {
  return {
    n: meta.pieces || SO_CO.pieces,
    l: meta.boxL != null ? meta.boxL : SO_CO.boxL,
    w: meta.boxW != null ? meta.boxW : SO_CO.boxW,
    h: meta.boxH != null ? meta.boxH : SO_CO.boxH,
  };
}
/* Per-SKU customs figures, with the old constants as the fallback so an unfilled SKU still exports
 * something plausible rather than an empty mandatory cell. */
const soHs = sku => soSku(sku).hs || SO_CO.hsExport;
const soGst = sku => (soSku(sku).gst != null ? soSku(sku).gst : SO_CO.igstPct);
const soRate = i => (soSku(i.sku).rate != null ? soSku(i.sku).rate : (i.price || ''));

/**
 * What the invoice adds up to, from the per-SKU rates.
 *
 * `gstPct` is returned only when EVERY line carries the same rate. FedEx has one GST_% cell for the
 * whole shipment, and printing one line's rate against a mixed invoice would understate or overstate
 * the tax on everything else — so a mixed shipment leaves it blank rather than lying about it.
 */
function soInvoiceTotals(r) {
  let goods = 0, tax = 0;
  const rates = new Set();
  const seen = new Set();
  r.items.forEach(i => {
    const k = String(i.sku || '').trim().toUpperCase();
    const rate = Number(soRate(i)) || 0;
    // The units GOING, not the units ordered. An invoice that totals a refunded line overstates the
    // declared value of the parcel, and the declared value is the figure customs works from.
    const line = rate * soShipQty(r.id, i);
    goods += line;
    const g = Number(soGst(k)) || 0;
    tax += line * g / 100;
    if (k && !seen.has(k)) { seen.add(k); rates.add(g); }
  });
  return {
    goods: Math.round(goods * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    gstPct: rates.size === 1 ? [...rates][0] : null,
  };
}

/* Units of a line AS THEY LEAVE INDIA — Shopify's own units, not Amazon packs.
 *
 * Every one of these files asks "how many", and the answer is not the same number in all of them.
 * An MCF request counts AMAZON PACKS: RCNB355-12 goes as 3 × RCNB355. A DHL or FedEx invoice counts
 * what is physically in the box for the customer: one set of twelve. Writing Amazon's figure on a
 * customs invoice understates the contents by the pack size — which is a customs problem, not a
 * rounding one.
 *
 * The Send qty box is in AMAZON units (its own tooltip says so), so a typed figure is brought back
 * through the same factor rather than being read as if it were pieces.
 */
function soShipQty(orderId, item) {
  const f = soPackFactorOf(item.sku) || 1;
  const amz = soSendQty(orderId, item.sku, soLive(item));
  return f > 1 ? Math.round(amz / f) : amz;
}
/** The line's weight for the units actually going, not for the units ordered. */
function soShipKg(orderId, item) {
  const q = Number(item.qty) || 0;
  const g = Number(item.grams) || 0;
  if (!g) return 0;
  return (q > 0 ? g * soShipQty(orderId, item) / q : g) / 1000;
}

const SO_TMPL = {
  mcf: {
    file: 'mcf-fulfillment-request',
    head: ['MerchantFulfillmentOrderID', 'DisplayableOrderID', 'DisplayableOrderDate', 'MerchantSKU',
      'Quantity', 'MerchantFulfillmentOrderItemID', 'GiftMessage', 'DisplayableComment',
      'PerUnitDeclaredValue', 'DisplayableOrderComment', 'DeliverySLA', 'AddressName',
      'AddressFieldOne', 'AddressFieldTwo', 'AddressFieldThree', 'AddressCity', 'AddressCountryCode',
      'AddressStateOrRegion', 'AddressPostalCode', 'AddressPhoneNumber', 'NotificationEmail',
      'FulfillmentAction', 'MarketplaceID', 'CarrierPreferences', 'IsOverboxRequired',
      'IsPackingSlipRequired'],
    rows: (r) => {
      const id = 'SHOP-' + String(r.no).replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
      /* AMAZON'S CODE AND AMAZON'S COUNT, exactly as the in-app MCF order sends them.
       *
       * This file used to carry the SHOPIFY sku and the ORDERED quantity while the button beside it
       * sent the mapped code and the send quantity — two ways of placing the same order that did not
       * agree. Amazon does not know RCNB355-12, and a line the customer had refunded still went.
       * Lines that are not going (refunded, removed, set to 0) drop out entirely, so the item
       * numbering below counts what is in the file rather than what was ordered. */
      return r.items
        .filter(i => i.sku && soSendQty(r.id, i.sku, soLive(i)) > 0)
        .map((i, n) => {
        const amzSku = soAmzSku(i.sku);
        const amzQty = soSendQty(r.id, i.sku, soLive(i));
        // Only the FIRST line of an order carries the order; the rest add a SKU to it.
        if (n > 0) return [id, '', '', amzSku, amzQty, String(n + 1), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
        return [id, r.no, r.at + 'T00:00:00', amzSku, amzQty, '1', '', '',
          i.price || '', '', 'Standard', r.ship.name,
          r.ship.a1, r.ship.a2, '', r.ship.city, soCode(r),
          r.ship.state, r.ship.zip, r.ship.phone, r.email,
          'Ship', SO_CO.marketplaceId, 'AllowAMZL', 'No', 'No'];
      });
    },
  },

  dhlh: {
    file: 'dhl-hybrid',
    head: ['Shipment Number', 'Receiver Name', 'Receiver Attention', 'Receiver Address1',
      'Receiver Address2', 'Receiver Address3', 'City', 'State', 'Zipcode', 'Country Name',
      'Receiver Phone', 'Receiver Email', 'Registration Number', 'Registration Number Type Code',
      'Number Issuer Country Code', 'Business Party Type Code', 'Shipper Reference Number',
      'Actual Weight (Kg)', 'Contents', 'Number Of Pieces', 'Length(Cm)', 'Width(Cm)', 'Height(Cm)',
      'Exporter Using Ecommerce', 'GST Invoice No', 'GST Invoice Date', 'NonGST Invoice No',
      'NonGST Invoice Date', 'Bank AD Code', 'Date of Supply', 'Payer VAT / TAX ID',
      'SVP (Shipment Value Protection)', 'Insured Amount', 'SNo', 'Piece No', 'Commodity Type',
      'Item Description', 'HS Code (Export)', 'Commodity Code (Import)', 'Weight (Kg)', 'Quantity',
      'UOM', 'Invoice Rate per Unit', 'Discount Amount', 'IGST Percentage',
      'Manufacturing country Code', 'Duty Drawback Serial Number', 'DutyAccountNumber',
      'Special Service'],
    rows: (r, seq, meta) => {
      // WHAT IS ACTUALLY GOING IN THE BOX. A refunded or removed line is not in the parcel, so it has
      // no business on the customs invoice either — and an order left with nothing to ship writes no
      // rows at all rather than a phantom one. soExport names those; it does not drop them quietly.
      const going = r.items.filter(i => soShipQty(r.id, i) > 0);
      const items = r.items.length ? going : [{ name: meta.desc || '', qty: r.units, price: 0, grams: 0 }];
      if (!items.length) return [];
      const kg = meta.wt != null ? meta.wt : r.kg;
      const box = soBox(meta);
      const item = (i, n) => [SO_CO.svp, SO_CO.insured, n + 1, 1, SO_CO.commodityType,
        i.name || i.sku || '', soHs(i.sku), SO_CO.hsImport,
        i.grams ? soShipKg(r.id, i).toFixed(2) : '', soShipQty(r.id, i), SO_CO.uom,
        soRate(i), '', soGst(i.sku), SO_CO.mfgCountry, '', '', ''];
      return items.map((i, n) => n === 0
        ? [seq, r.ship.name, r.ship.name, r.ship.a1, r.ship.a2, '', r.ship.city, r.ship.state,
           r.ship.zip, soCtryName(r), r.ship.phone, r.email, SO_CO.regNo, SO_CO.regType,
           SO_CO.regIssuer, SO_CO.partyType, 'other', kg ? kg.toFixed(2) : '',
           meta.desc || '', box.n, box.l, box.w, box.h, SO_CO.ecommerce,
           meta.gstInv || '', meta.gstInvDate || '', meta.ngstInv || '', meta.ngstInvDate || '',
           SO_CO.adCode, '', ''].concat(item(i, n))
        // A continuation row: everything before SVP stays empty, exactly as the workbook has it.
        : new Array(31).fill('').concat(item(i, n)));
    },
  },

  dhlc: {
    file: 'dhl-csv',
    head: ['Shipment Number', 'Receiver Name', 'Receiver Attention', 'Receiver Address1',
      'Receiver Address2', 'Receiver Address3', 'City', 'State', 'Zipcode', 'Country Name',
      'Receiver Phone', 'Receiver Email', 'Registration Number', 'Registration Number Type Code',
      'Number Issuer Country Code', 'Business Party Type Code', 'Shipper Reference Number',
      'Shipment Currency', 'Actual Weight (Kg)', 'Contents', 'Number Of Pieces', 'Length(Cm)',
      'Width(Cm)', 'Height(Cm)', 'Terms of Trade', 'Exporter Using Ecommerce', 'Tax Payment Option',
      'GST Invoice No', 'GST Invoice Date', 'NonGST Invoice No', 'NonGST Invoice Date', 'Bank IFSC',
      'Place of Supply', 'Date of Supply', 'Bill to_Company Name', 'Bill to_Name',
      'Bill to_Address1', 'Bill to_Address2', 'Bill to_Address3', 'Bill to_City',
      'Bill to_Post code', 'Bill to_State/suburb', 'Bill to_Country', 'Bill to_Phone',
      'Payer VAT / TAX ID', 'Invoice Value (In Words)', 'Reverse Charge', 'Freight Charges',
      'Insurance Charges', 'SVP (Shipment Value Protection)', 'Insured Amount', 'SNo', 'Piece No',
      'Commodity Type', 'Item Description', 'HS Code (Export)', 'Commodity Code (Import)',
      'Weight (Kg)', 'Quantity', 'UOM', 'Invoice Rate per Unit', 'Discount Amount',
      'IGST Percentage', 'Total Item FOB value', 'Total Item CESS', 'Manufacturing country Code',
      'NFEI FLAG', 'Destination_Duty_VAT Charges', 'Special Service', 'DutyAccountNumber',
      'EcomOperatorName', 'PaymentTxnID', 'OrderNumber', 'OrderDate', 'SKUNo', 'TypeofJwellery',
      'Consignee Tax ID Number', 'Consignee Tax ID Type code', 'Consignee Number Issuer Country Code',
      'Consignee Business Party Type Code'],
    rows: (r, seq, meta) => {
      // WHAT IS ACTUALLY GOING IN THE BOX. A refunded or removed line is not in the parcel, so it has
      // no business on the customs invoice either — and an order left with nothing to ship writes no
      // rows at all rather than a phantom one. soExport names those; it does not drop them quietly.
      const going = r.items.filter(i => soShipQty(r.id, i) > 0);
      const items = r.items.length ? going : [{ name: meta.desc || '', qty: r.units, price: 0, grams: 0 }];
      if (!items.length) return [];
      const kg = meta.wt != null ? meta.wt : r.kg;
      const box = soBox(meta);
      const item = (i, n) => {
        const rate = soRate(i);
        return [SO_CO.svp, SO_CO.insured, n + 1, 1, SO_CO.commodityType,
          i.name || i.sku || '', soHs(i.sku), SO_CO.hsImport,
          i.grams ? soShipKg(r.id, i).toFixed(2) : '', soShipQty(r.id, i), SO_CO.uom,
          rate, '', soGst(i.sku),
          rate ? (rate * soShipQty(r.id, i)).toFixed(2) : '', 0, SO_CO.mfgCountry, 'NO',
          '', '', '', '', '', r.no, r.at, i.sku || '', '', '', '', '', ''];
      };
      return items.map((i, n) => n === 0
        ? [seq, r.ship.name, r.ship.name, r.ship.a1, r.ship.a2, '', r.ship.city, r.ship.state,
           r.ship.zip, soCtryName(r), r.ship.phone, r.email, SO_CO.regNo, SO_CO.regType,
           SO_CO.regIssuer, SO_CO.partyType, SO_CO.gstin, meta.cur || 'INR',
           kg ? kg.toFixed(2) : '', meta.desc || '', box.n, box.l, box.w,
           box.h, SO_CO.terms, SO_CO.ecommerce, SO_CO.taxOption,
           meta.gstInv || '', meta.gstInvDate || '', meta.ngstInv || '', meta.ngstInvDate || '',
           '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
          ].concat(item(i, n))
        : new Array(49).fill('').concat(item(i, n)));
    },
  },

  fedex: {
    file: 'fedex',
    head: ['Sequence_Number', 'Recipient_Contact Name', 'Recipient_Company Name',
      'Recipient_Address Line 1', 'Recipient_Address Line 2', 'Recipient_Address Line 3',
      'Recipient_Country', 'Recipient_City', 'Recipient_State', 'Recipient_Postal code',
      'Recipient_Phone Number', 'Recipient_Phone_Ext.', 'Recipient_Tax Number', 'Recipient_Email',
      'Reference_1', 'Bill Shipment To', 'Account #', 'Bill Duties & Taxes To', 'Account #',
      'Invoice Number', 'Invoice Date', 'Total No of Package', 'Total Shipment weight', 'Pkg_length',
      'Pkg_width', 'Pkg_height', 'Freight_charges', 'Insurance_charges', 'Tax_amount',
      'Total GST Amt', 'FOB Value', 'Carriage Value', 'Invoice Value', 'CURRENCY',
      'Country of Manufacture', 'COMMODITY', 'HS CODE 1', 'St. of Origin of goods',
      'Dis. Of Origin of goods', 'QUANTITY 1', 'UOM1', 'UNIT_VALUE 1', 'UNIT_Weight 1', 'GST _%',
      'GST_Amount', 'Additional Shipment/Invoice info. (If any)', 'Packaging', 'Terms_Of_Sales',
      'Duty\nDrawback\nS.No', 'user_field_2'],
    // ONE ROW PER SHIPMENT. This sheet has a single commodity slot — HS CODE 1, QUANTITY 1, UOM1 —
    // and no second one, so a multi-line order is collapsed into the Contents description with the
    // total quantity and weight. That is a real limitation of the template, not a shortcut.
    rows: (r, seq, meta) => {
      const kg = meta.wt != null ? meta.wt : r.kg;
      const box = soBox(meta);
      // Goods and tax from the customs lines, so the declared value is the one the invoice adds up
      // to — not Shopify's retail total, which is a different number in a different currency.
      const inv = soInvoiceTotals(r);
      const val = inv.goods || (meta.val != null ? meta.val : r.total);
      const cur = (meta.cur || 'INR') === 'INR' ? SO_CO.fedexCurrencyInr : SO_CO.fedexCurrency;
      return [[seq, r.ship.name, r.ship.company || r.ship.name, r.ship.a1, r.ship.a2, '',
        soCode(r), r.ship.city, r.ship.state, r.ship.zip, r.ship.phone, '', '', r.email,
        SO_CO.gstin, '', '', '', '', meta.gstInv || meta.ngstInv || '',
        meta.gstInvDate || meta.ngstInvDate || '', box.n, kg ? kg.toFixed(2) : '',
        box.l, box.w, box.h, '', '', '', inv.tax ? inv.tax.toFixed(2) : '', '', '', val || '',
        cur, SO_CO.fedexOrigin, meta.desc || '', SO_CO.hsImport,
        SO_CO.originState, SO_CO.originDistrict, r.shipUnits, SO_CO.fedexUom,
        r.shipUnits ? (Number(val || 0) / r.shipUnits).toFixed(2) : '', kg ? kg.toFixed(2) : '',
        inv.gstPct == null ? '' : inv.gstPct, inv.tax ? inv.tax.toFixed(2) : '',
        r.no, SO_CO.fedexPackaging, SO_CO.terms, '', '']];
    },
  },
};

/* ---------- what production has to make ----------
 *
 * ONE print builder, driven by the Adjustments tab. The Shopify tab's button now walks over there
 * rather than gathering its own list: two builders would eventually disagree about which jobs are
 * open, and the one on the factory floor would be the wrong one.
 *
 * Opened as a plain printable page in its own tab rather than a modal. The app's stylesheet is
 * built for a screen — printing it gives grey panels and cut columns, and a sheet somebody has to
 * squint at on a factory floor is not a sheet.
 */
$('soAdj').onclick = () => showTab('adj');

$('ajPrint').onclick = () => {
  const rows = ajPicked().length ? ajPicked() : ajRows();
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  if (!rows.length) {
    $('ajMsg').textContent = 'Nothing to print. Tick some rows, or widen the filters.';
    $('ajMsg').className = 'err';
    return;
  }
  const byDay = {};
  rows.forEach(r => (byDay[r.day || 'undated'] || (byDay[r.day || 'undated'] = [])).push(r));
  const days = Object.keys(byDay).sort().reverse();
  // A CARD PER JOB, not a table row. The picture is the point: production reads the photo first and
  // the words second, so it gets the space, and everything else arranges itself around it.
  const body = days.map(d => {
    const list = byDay[d];
    const units = list.reduce((s, r) => s + Number(r.qty || 0), 0);
    return '<section><h2>' + esc(d) + ' <span class="sub">' + list.length + ' job(s) · ' + units + ' piece(s) to make</span></h2>'
      + list.map(r => '<div class="job">'
        + '<div class="pic">' + (r.img
            ? '<img src="' + esc(r.img) + '" alt="">'
            : '<div class="nopic">no picture</div>') + '</div>'
        + '<div class="det">'
          + '<div class="hdr"><span class="id big">' + esc(r.id) + '</span>'
            + '<span class="qty">' + r.qty + ' pc' + (r.qty === 1 ? '' : 's') + '</span></div>'
          + '<div class="name">' + esc(r.name) + '</div>'
          + '<table class="kv"><tbody>'
            + '<tr><th>SKU</th><td class="id">' + esc(r.sku) + '</td>'
              + '<th>Shopify order</th><td>' + esc(r.order) + ' · ' + esc(r.orderDate) + '</td></tr>'
            + '<tr><th>Sending</th><td class="sz">' + esc(r.send || '—') + '</td>'
              + '<th>Make in</th><td class="sz want">' + esc(r.want || '—') + '</td></tr>'
            + '<tr><th>Reason</th><td>' + esc(r.reason || '—') + '</td>'
              + '<th>Bin</th><td>' + esc(r.loc || '—') + '</td></tr>'
            + '<tr><th>Ordered</th><td>' + (r.ordered == null ? '—' : r.ordered) + ' · '
              + (r.staged == null ? '—' : r.staged) + ' at location</td>'
              + '<th>Raised</th><td>' + esc(r.at) + '</td></tr>'
            // Printed only once production has committed to a date, so a fresh sheet does not carry
            // an empty promise line for somebody to fill in with a pen and nobody to record.
            + (r.due ? '<tr><th>Promised</th><td><b>' + esc(r.due) + '</b>'
                + (r.accBy ? ' · ' + esc(r.accBy) : '') + '</td><th>State</th><td>' + esc(r.state) + '</td></tr>' : '')
            + (r.note ? '<tr><th>Note</th><td colspan="3">' + esc(r.note) + '</td></tr>' : '')
          + '</tbody></table>'
          + '<div class="sign">Accepted by ________________ &nbsp; Ready by ____________'
            + ' &nbsp;&nbsp;|&nbsp;&nbsp; Made by ________________ &nbsp; Date __________ &nbsp; Qty ______</div>'
        + '</div></div>').join('')
      + '</section>';
  }).join('');

  const w = window.open('', '_blank');
  if (!w) { soMsg('The browser blocked the print tab — allow pop-ups for this site.', true); return; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Production adjustments</title>'
    + '<style>'
    + 'body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}'
    + 'h1{font-size:18px;margin:0 0 2px}'
    + 'h2{font-size:16px;margin:0 0 10px;padding-bottom:5px;border-bottom:2px solid #111}'
    + 'h2 .sub{font-weight:400;font-size:12px;color:#555}'
    + '.head{color:#555;font-size:12px;margin-bottom:14px}'
    + '.job{display:flex;gap:16px;border:1.5px solid #333;border-radius:8px;padding:12px;margin-bottom:12px}'
    // 62mm of picture. Small enough that two jobs fit a page, big enough to tell two prints apart
    // across a workbench, which is the whole reason it is on the sheet.
    + '.pic{flex:0 0 62mm}'
    + '.pic img{width:62mm;height:62mm;object-fit:contain;border:1px solid #bbb;border-radius:6px;background:#fafafa}'
    + '.nopic{width:62mm;height:62mm;border:1px dashed #bbb;border-radius:6px;display:flex;'
    + 'align-items:center;justify-content:center;color:#999;font-size:12px}'
    + '.det{flex:1;min-width:0}'
    + '.hdr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px}'
    + '.qty{font-size:22px;font-weight:800;border:2px solid #111;border-radius:6px;padding:1px 12px;white-space:nowrap}'
    + '.name{font-size:15px;font-weight:600;margin-bottom:8px}'
    + 'table.kv{border-collapse:collapse;width:100%}'
    + 'table.kv th,table.kv td{border:1px solid #bbb;padding:4px 7px;text-align:left;vertical-align:top;font-size:12px}'
    + 'table.kv th{background:#f0f0f0;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;width:66px;white-space:nowrap}'
    + '.sz{font-size:15px;font-weight:700}'
    + '.want{background:#fff3c4}'
    + '.id{font-family:ui-monospace,Consolas,monospace}'
    + '.big{font-size:14px;font-weight:700}'
    + '.sign{margin-top:10px;font-size:12px;color:#333}'
    // Each day starts a fresh page, because the sheets are handed over a day at a time.
    + '@media print{body{margin:10mm}section{page-break-before:always}'
    + 'section:first-of-type{page-break-before:auto}.job{page-break-inside:avoid}}'
    + '</style></head><body>'
    + '<h1>Production adjustments</h1>'
    + '<div class="head">' + rows.length + ' job(s)'
    + ' · printed ' + soStamp() + '</div>'
    + body + '</body></html>');
  w.document.close();
  w.focus();
  // WAIT FOR THE PICTURES. Printing on a fixed delay produced sheets with empty boxes where the
  // photo should be — the one thing on the page production actually needs. The timeout is only a
  // fallback for an image that never loads, and the guard stops it printing twice.
  let printed = false;
  const go = () => { if (printed) return; printed = true; w.print(); };
  w.onload = go;
  setTimeout(go, 4000);
};

/**
 * A PICK SHEET for one order — the same shape as the Adjustments print, for the same reason.
 *
 * Whoever packs this reads the photo first and the words second, so the picture gets the space and
 * everything else arranges itself around it. What is on the line is what a picker actually has to
 * decide: which code to pull, how many, and where it is.
 *
 * SEND QTY, NOT ORDERED QTY, is the big number. Those two differ exactly when somebody has decided to
 * ship something other than what was ordered, and a sheet printing the ordered figure there would
 * quietly undo that decision at the bench. The ordered quantity is still shown beside it when they
 * differ, so the difference is visible rather than hidden.
 */
/* ONE order as a printable section. One builder, used by both the single-order button and the
 * many-order one — two copies of a pick sheet would drift, and the half nobody checks is the one
 * that goes to the bench. */
function soPrintSection(o) {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const meta = SHOP_META[o.id] || {};
  const lines = o.items.filter(i => soSendQty(o.id, i.sku, soLive(i)) > 0);
  if (!lines.length) return '';
  const addr = [o.ship.name, o.ship.a1, o.ship.a2, o.ship.city, o.ship.state, o.ship.zip, o.ship.country]
    .filter(Boolean).join(', ');
  const units = lines.reduce((s, i) => s + soSendQty(o.id, i.sku, soLive(i)), 0);

  const body = lines.map(i => {
    const shop = String(i.sku || '').trim().toUpperCase();
    const amz = soAmzSku(i.sku);
    const send = soSendQty(o.id, i.sku, soLive(i));
    const fbaKey = String(amz || '').toUpperCase();
    const fba = fbaKey ? soOrdFba(o, fbaKey) : null;
    const ind = soIndiaOf(i.sku);
    const ln = soLine(o.id, shop);
    return '<div class="job">'
      + '<div class="pic">' + (i.img ? '<img src="' + esc(i.img) + '" alt="">' : '<div class="nopic">no picture</div>') + '</div>'
      + '<div class="det">'
        + '<div class="hdr"><span class="id big">' + esc(shop || i.name) + '</span>'
          + '<span class="qty">' + send + ' pc' + (send === 1 ? '' : 's') + '</span></div>'
        + '<div class="name">' + esc(i.name + (i.variant ? ' \u00b7 ' + i.variant : '')) + '</div>'
        + '<table class="kv"><tbody>'
          + '<tr><th>SKU</th><td class="id">' + (shop ? esc(shop) : '\u2014') + '</td>'
            + '<th>Amazon SKU</th><td class="id">' + (amz && amz !== shop ? esc(amz) : '\u2014') + '</td></tr>'
          + '<tr><th>Ordered</th><td' + (send !== i.qty ? ' class="want"' : '') + '>' + i.qty
            + (send !== i.qty ? ' \u2014 <b>sending ' + send + '</b>' : '') + '</td>'
            + '<th>Bin</th><td class="sz">' + (soLocOf(shop) ? esc(soLocOf(shop)) : '\u2014') + '</td></tr>'
          + '<tr><th>FBA</th><td>' + (fba == null ? 'not in FBA' : fba + ' available') + '</td>'
            + '<th>India</th><td>' + (ind ? ind[0] + ' sellable' + (ind[2] > 1 ? ' (' + ind[1] + ' pcs, pack ' + ind[2] + ')' : '') : 'not listed') + '</td></tr>'
          + (ln && ln.q != null ? '<tr><th>At location</th><td colspan="3">' + ln.q + ' of ' + i.qty + ' already on the shelf</td></tr>' : '')
        + '</tbody></table>'
        + '<div class="sign">Picked ______  Checked ______  Packed ______</div>'
      + '</div></div>';
  }).join('');

  return '<section>'
    + '<h1>' + esc(o.no) + '</h1>'
    + '<div class="head">' + esc(o.at) + ' \u00b7 ' + lines.length + ' line(s) \u00b7 ' + units + ' piece(s)</div>'
    + '<div class="ship"><b>' + esc(o.ship.name || 'Customer') + '</b><br>' + esc(addr)
      + (o.ship.phone ? '<br>' + esc(o.ship.phone) : '')
      + (o.note ? '<br><br><b>Customer note:</b> ' + esc(o.note) : '')
      + (meta.note ? '<br><b>Our note:</b> ' + esc(meta.note) : '')
      + '</div>'
    + body
    + '</section>';
}

/** Open a print window holding whatever sections were built. */
function soPrintWindow(sections, title, subtitle) {
  const w = window.open('', '_blank');
  if (!w) {
    soMsg('The browser blocked the print tab — allow pop-ups for this site.', true);
    return;
  }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + title + '</title>'
    + '<style>'
    + 'body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}'
    + 'h1{font-size:20px;margin:0 0 2px}'
    + '.head{color:#555;font-size:12px;margin-bottom:6px}'
    + '.ship{border:1.5px solid #111;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px}'
    + '.ship b{font-size:14px}'
    + '.job{display:flex;gap:16px;border:1.5px solid #333;border-radius:8px;padding:12px;margin-bottom:12px}'
    + '.pic{flex:0 0 62mm}'
    + '.pic img{width:62mm;height:62mm;object-fit:contain;border:1px solid #bbb;border-radius:6px;background:#fafafa}'
    + '.nopic{width:62mm;height:62mm;border:1px dashed #bbb;border-radius:6px;display:flex;'
    + 'align-items:center;justify-content:center;color:#999;font-size:12px}'
    + '.det{flex:1;min-width:0}'
    + '.hdr{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:2px}'
    + '.qty{font-size:22px;font-weight:800;border:2px solid #111;border-radius:6px;padding:1px 12px;white-space:nowrap}'
    + '.name{font-size:15px;font-weight:600;margin-bottom:8px}'
    + 'table.kv{border-collapse:collapse;width:100%}'
    + 'table.kv th,table.kv td{border:1px solid #bbb;padding:4px 7px;text-align:left;vertical-align:top;font-size:12px}'
    + 'table.kv th{background:#f0f0f0;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;width:74px;white-space:nowrap}'
    + '.sz{font-size:15px;font-weight:700}'
    + '.want{background:#fff3c4}'
    + '.id{font-family:ui-monospace,Consolas,monospace}'
    + '.big{font-size:14px;font-weight:700}'
    + '.sign{margin-top:10px;font-size:12px;color:#333}'
    // EVERY ORDER STARTS A NEW PAGE. These sheets are handed over one order at a time, and two orders
    // sharing a page is how a picker packs half of one into the other's box.
    + '@media print{body{margin:10mm}.job{page-break-inside:avoid}'
    + 'section{page-break-before:always}section:first-of-type{page-break-before:auto}}'
    + 'section{margin-bottom:26px}'
    + '</style></head><body>'
    + (subtitle ? '<div class="head">' + subtitle + ' \u00b7 printed ' + soStamp() + '</div>' : '')
    + sections.join('') + '</body></html>');
  w.document.close();
  w.focus();
  // WAIT FOR THE PICTURES — same reason as the Adjustments sheet: printing on a fixed delay produced
  // sheets with empty boxes where the photo should be, which is the one thing the packer needs.
  // Longer here, because a batch of orders carries a lot more of them.
  let printed = false;
  const go = () => { if (printed) return; printed = true; w.print(); };
  w.onload = go;
  setTimeout(go, Math.min(15000, 4000 + sections.length * 800));
}

$('soPrint').onclick = () => {
  const o = SHOP.orders.find(x => x.id === SHOP_EDIT);
  if (!o) return;
  const sec = soPrintSection(o);
  if (!sec) {
    $('soErr').textContent = 'Every line on this order is set to send 0 — there is nothing to pick.';
    $('soErr').classList.remove('hide');
    return;
  }
  soPrintWindow([sec], o.no, '');
};

/* The ticked orders, or everything on screen when nothing is ticked — the same rule the Adjustments
 * print uses, so the two behave alike. */
$('soPrintMany').onclick = () => {
  const shown = soRows();
  const picked = shown.filter(r => SO_PICKED.has(r.id));
  const use = picked.length ? picked : shown;
  if (!use.length) { soMsg('Nothing to print — widen the filters, or fetch some orders.', true); return; }
  const sections = [], empty = [];
  use.forEach(r => {
    const o = SHOP.orders.find(x => x.id === r.id);
    const sec = o ? soPrintSection(o) : '';
    if (sec) sections.push(sec); else empty.push(r.no);
  });
  if (!sections.length) { soMsg('Every order chosen has all its lines set to send 0.', true); return; }
  soPrintWindow(sections, sections.length + ' orders',
    sections.length + ' order(s)'
      // Named, not silently skipped. An order missing from a batch of pick sheets is otherwise
      // discovered at the bench, by its absence.
      + (empty.length ? ' \u00b7 skipped ' + empty.length + ' with nothing to send: ' + empty.join(', ') : ''));
  soMsg(`Printing ${sections.length} order(s)${picked.length ? ' (ticked)' : ' (everything shown)'}.`);
};


/* Quoted-CSV reader, lifted from the Replenishment app rather than written again. A hand-rolled
 * split(',') is fine right up until an address contains a comma, which every address list does. */
/* parseCsv is NOT repeated here: this app already declares it at line 4623 of its own
 * module, character for character. A second one is a SyntaxError, and a SyntaxError in a module
 * stops every tab in the app rather than just this screen. */


/* ---- from Sellora: Imported orders ---- */
