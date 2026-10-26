/* THE HUB ON THE TEST SITE — hub-web.js, made by tools/build-web.js. Do not edit hub-web.js; edit the hub and rebuild.
 *
 * The local hub is a small Node server (server.js + lib/) that the page talks to over /api/... Here the very same
 * server code runs inside the page instead, so the test site needs nothing started on any computer:
 *   - each server file is wrapped as a module below (a tiny require), with web/config.js, web/store.js and web/util.js
 *     in place of the ones that read keys, write data/db.json and call outside APIs;
 *   - the page's fetch('/api/...') calls are answered by the server's own api() in the page (boot-tail.js);
 *   - the data is kept in this browser (IndexedDB), read before the hub starts.
 * What needs keys is off here: Shopify writes, Amazon MCF (simulated), carrier tracking (simulated), FedEx labels.
 * Shopify orders come from the ERP page, read through its Pricing API (importFromPricing). */
(function () {
  const MODS = {}, CACHE = {};
  const name = n => String(n).replace(/^.*\//, '').replace(/\.js$/, '');
  const noFile = () => { throw new Error('No files on the test site'); };
  const SHIM = {
    fs: { existsSync: () => false, readFileSync: noFile, readFile: (p, cb) => cb(new Error('No files on the test site')), writeFileSync() {}, mkdirSync() {}, renameSync() {}, copyFileSync() {}, statSync: noFile, readdirSync: () => [] },
    path: { join: (...p) => p.join('/').replace(/\/+/g, '/'), resolve: (...p) => p.join('/').replace(/\/+/g, '/'), dirname: p => String(p).replace(/\/[^/]*$/, ''), normalize: p => p, extname: p => (String(p).match(/\.[^./]*$/) || [''])[0] },
    http: { createServer: () => ({ on() { return this; }, listen() { return this; } }) },
    https: {}, zlib: {}, child_process: {},
  };
  const PROC = { env: {}, exit() {} };
  const BUF = { from: () => ({ toString: () => '' }), byteLength: s => String(s).length, concat: () => ({ toString: () => '' }) };
  function require(n) {
    const k = name(n);
    if (SHIM[k]) return SHIM[k];
    if (CACHE[k]) return CACHE[k].exports;
    if (!MODS[k]) throw new Error('hub-web: no module ' + n);
    const m = CACHE[k] = { exports: {} };
    MODS[k](m, m.exports, require, '/shopify-hub/' + (k === 'server' ? '' : 'lib'), PROC, BUF);
    return m.exports;
  }
  window.HUBMOD = (k, f) => { MODS[k] = f; };
  window.HUBREQ = require;
})();

HUBMOD("journey", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * THE JOURNEY — one file, used by the backend (require) and by the page (<script>, as window.J).
 *
 * Every order is split into PARTS. A part walks one road:
 *     PRODUCTION  →  SHIPMENT  →  CARRIER (Amazon MCF / DHL / FedEx / UPS)  →  DELIVERED
 * Its progress is ONE number, `pos` = how many of its steps are done. Everything shown about a
 * part — bars, labels, the one button, the timeline — is worked out from `pos` and these rules,
 * so the screen and the server can never disagree about where a part is.
 * ===================================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const PHASES = ['Production', 'Shipment', 'Carrier', 'Delivered'];
  /* Production: the request waits until the factory starts it, then Cut, Print, Press, Quality check. */
  const STAGES = ['Requested', 'Cut', 'Print', 'Press', 'Quality check'];
  const STAGE_BTN = ['Start', 'Cut done', 'Print done', 'Press done', 'QC passed'];
  const TARGET = [1, 1, 2, 1, 1];                       // days each stage should take
  const CAUSES = ['Waiting for fabric', 'No karigar free', 'Printer busy', 'Dye or colour issue', 'QC rework', 'Other'];
  const RSTEPS = ['Return started', 'On its way back', 'Received at USA warehouse', 'Closed'];
  const CARRIERS = ['DHL Express', 'FedEx', 'UPS'];

  const isMcf = pk => pk.route === 'mcf';
  const prodLen = pk => pk.src === 'make' ? STAGES.length : 1;
  const total = pk => prodLen(pk) + 6;
  /* steps after production: 0 ready · 1 sent/packed · 2 accepted/label · 3 shipped/picked up · 4 in transit · 5 out · 6 delivered */
  const off = pk => pk.pos - prodLen(pk);
  const carName = pk => isMcf(pk) ? 'Amazon MCF' : (pk.car || 'carrier');

  function steps(pk) {
    const prod = pk.src === 'make' ? ['Production requested', 'Cut', 'Print', 'Press', 'Quality check'] : [pk.src === 'fba' ? 'In Amazon FBA stock' : pk.src === 'shop' ? 'Shipped from Shopify' : 'In India stock'];
    const ship = isMcf(pk) ? ['Sent to Amazon MCF', 'Amazon accepted'] : pk.route ? ['Packed', 'Label created'] : ['Packed', 'Booked with a carrier'];
    const carrier = isMcf(pk) ? ['Shipped by Amazon', 'In transit'] : ['Picked up by ' + (pk.car || 'the carrier'), 'In transit'];
    return [prod, ship, carrier, ['Out for delivery', 'Delivered']];
  }
  /* which phase is happening now: 0..3, or 4 when delivered */
  function phaseOf(pk) { if (pk.pos < prodLen(pk)) return 0; const o = off(pk); return o <= 2 ? 1 : o <= 4 ? 2 : o === 5 ? 3 : 4; }
  const stageStart = pk => pk.pos ? pk.ts[pk.pos - 1] : pk.req;
  const inStage = (pk, now) => (now - stageStart(pk)) / DAY;
  const isLateStage = (pk, now) => pk.src === 'make' && pk.pos < prodLen(pk) && inStage(pk, now) > TARGET[pk.pos];

  function statusOf(pk) {
    if (pk.pos < prodLen(pk)) return pk.block ? 'Blocked · ' + pk.block.why : pk.pos === 0 ? 'Waiting to start' : 'In ' + STAGES[pk.pos];
    return ['Ready to ship', isMcf(pk) ? 'Sent to Amazon' : 'Packed', isMcf(pk) ? 'Amazon accepted' : 'Waiting for pickup',
      isMcf(pk) ? 'Shipped by Amazon' : 'Picked up', pk.late ? 'Delayed' : 'In transit', 'Out for delivery', 'Delivered'][off(pk)];
  }
  /* The one thing a person does now. Null = it moves by itself (Amazon / carrier updates). */
  function actionOf(pk) {
    if (pk.pos < prodLen(pk)) return { k: 'stage', t: pk.pos === 0 ? 'Start production' : 'Finish ' + STAGES[pk.pos],
      sub: pk.pos === 0 ? 'The factory has the request; start when work begins' : 'Next: ' + (STAGES[pk.pos + 1] || 'ready to ship'), b: STAGE_BTN[pk.pos] };
    if (off(pk) === 0) return { k: 'ship', t: 'Ship this part', sub: 'Choose DHL, FedEx or UPS and add the tracking number', b: 'Ship…' };
    return null;
  }
  function phaseText(pk, i) {
    const ph = phaseOf(pk);
    if (i === 0) return pk.src !== 'make' ? (pk.src === 'fba' ? 'From FBA stock' : pk.src === 'shop' ? 'Shipped in Shopify' : 'From India stock') : ph === 0 ? (pk.block ? pk.block.why : pk.pos === 0 ? 'Requested' : STAGES[pk.pos] + ' · ' + pk.pos + ' of 4') : 'Made';
    if (i === 1) return ph < 1 ? 'After production' : ph === 1 ? statusOf(pk) : isMcf(pk) ? 'Sent by MCF' : 'Packed';
    if (i === 2) return ph < 2 ? (pk.route ? carName(pk) : 'MCF, DHL or FedEx') : ph === 2 ? statusOf(pk) + ' · ' + carName(pk) : carName(pk);
    return ph === 4 ? null : pk.eta ? 'Expected ' + pk.eta : '—';      // null = "delivered on <date>", which the caller formats
  }
  /* Where a carrier status puts a part (`off` value). */
  const STATUS_OFF = { label_created: 2, picked_up: 3, in_transit: 4, delayed: 4, out_for_delivery: 5, delivered: 6 };
  /* The Shopify delivery status each step sends. */
  const SHOPIFY_EVENT = { 4: 'IN_TRANSIT', 5: 'OUT_FOR_DELIVERY', 6: 'DELIVERED' };

  function retAction(r) {
    if (r.what !== 'return' && r.rep == null) return { k: 'rep', b: 'Send replacement', t: 'Send the replacement' };
    if (r.what === 'replace') return r.pos < 3 ? { k: 'rclose', b: 'Close', t: 'Close the case' } : null;
    if (r.pos === 0) return { k: 'rtrk', b: 'Add return tracking', t: 'Add the return tracking number' };
    if (r.pos === 1) return { k: 'rrecv', b: 'Mark received', t: 'Mark it received at the warehouse' };
    if (r.pos === 2) return { k: 'rclose', b: 'Close', t: 'Close the return' };
    return null;
  }
  const undecided = o => o.items.map((it, i) => i).filter(i => o.items[i].pk == null);

  /* A parcel that needs a person, read from its last scan. 72 h without a scan, not 48: India → US parcels
   * often go two or three days quiet between flights, weekends and customs. */
  const FLAGS = { late: 'Delayed', customs: 'Held at customs', returned: 'Returning to sender', failed: 'Delivery failed', stale: 'No scan for 3 days' };
  function flagOf(pk, now) {
    const x = off(pk); if (pk.pos < prodLen(pk) || x < 3 || x >= 6) return '';
    const t = String((pk.last || {}).text || '');
    if (/return(ed|ing)? to (sender|shipper)|\bRTS\b/i.test(t)) return 'returned';
    if (/customs|clearance|held by/i.test(t)) return 'customs';
    if (/fail|unable to deliver|exception|refused|undeliverable/i.test(t)) return 'failed';
    if (pk.late) return 'late';
    const lastAt = (pk.last && pk.last.at) || pk.ts[pk.pos - 1];
    if (lastAt && now - lastAt > 3 * DAY) return 'stale';
    return '';
  }

  return { DAY, PHASES, STAGES, STAGE_BTN, TARGET, CAUSES, RSTEPS, CARRIERS, STATUS_OFF, SHOPIFY_EVENT, FLAGS,
    isMcf, prodLen, total, off, carName, steps, phaseOf, stageStart, inStage, isLateStage, statusOf, actionOf, phaseText, retAction, undecided, flagOf };
});

});

HUBMOD("csb", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * DISPATCH FILES — what goes in a box today, and the carriers' upload files, with no carrier API.
 * DHL: the CSB-V sheet (below). FedEx: its upload workbook (FX_HEAD). Both are filled from the same shipments,
 * one invoice series; after the upload the carrier's tracking numbers are typed in (actions.dispatchAwb).
 *
 * DHL CSB-V — the courier shipping bill DHL files for an e-commerce export from India.
 *
 * DHL's own template (templates/CSB-V-template.xls, downloaded from the DHL site) has 80 columns on
 * Sheet1, and the ERP's "DHL CSV" export (shared/courier-templates.js → SO_TMPL.dhlc) already writes
 * those same 80 headings. The rules here follow that export, with three changes taken from DHL's own
 * USER GUIDE sheet and sample rows:
 *   - continuation rows leave SVP / Insured / NFEI / order number / order date blank (the samples do);
 *   - IGST % is filled only when the tax option is IGST payment ("conditional mandatory");
 *   - name and address are cleaned to what DHL accepts (35 characters, letters, digits and - , . /).
 *
 * ONE SHIPMENT IS SEVERAL ROWS: the first row carries the shipment and its first item, every further
 * item gets a row with the shipment cells left empty. One row per item would book one parcel per item.
 *
 * The hub builds the rows; the page writes them into DHL's .xls (SheetJS in the browser) so the file
 * keeps DHL's other sheets and goes straight onto the DHL site.
 * ===================================================================================== */
const J = require('./journey');

const HEAD = ['Shipment Number', 'Receiver Name', 'Receiver Attention', 'Receiver Address1',
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
  'Consignee Business Party Type Code'];
const COL = Object.fromEntries(HEAD.map((h, i) => [h, i]));
const SHIP_COLS = COL['SNo'] - 2;              // 49: A..AW are shipment cells; AX (SVP) onward is the item block

/* The same company figures the ERP's DHL exports use (SO_CO in shared/courier-templates.js). */
const CO = {
  regNo: 'AD0803210121871', regType: 'ARN', regIssuer: 'US', partyType: 'DC',
  gstin: '08ABIPR0673D1ZN', hsExport: '63049249', hsImport: '6302512000',
  mfgCountry: 'IN', igstPct: 5, uom: 'PCS', terms: 'DDP', taxOption: 'Against Bond or Undertaking',
  ecommerce: 'Yes', svp: 'No', insured: 0, commodityType: 'Others', boxL: 10, boxW: 10, boxH: 10,
};
const TAX_OPTIONS = ['Against Bond or Undertaking', 'IGST Payment'];
/* The currencies both sheets accept, in FedEx's own words (its StateCodes sheet, read 24 Oct). */
const FX_CUR = { USD: 'US DOLLARS-USD', INR: 'INDIAN RUPEE-INR', EUR: 'EURO-EUR', CAD: 'CANADIAN DOLLARS-CAD', AUD: 'AUSTRALIAN DOLLARS-AUD' };
const CURRENCIES = Object.keys(FX_CUR);
const CARRIERS = ['DHL Express', 'FedEx'];
const PACKAGING = ['FedEx Pak', 'Your Packaging'];

/* FedEx's upload workbook (Pricing-App/templates/Fedex.xls): sheet "Recipient and Invoice Data", one row per shipment,
 * ONE commodity slot (a multi-item box is one combined description with the total quantity, as the ERP's export does),
 * and "MPS Dimension" for each box of a shipment that has more than one. Values written the way FedEx's own filled
 * sample row has them: country "US", state "NH", invoice date "08082026", "US DOLLARS-USD", "IN-INDIA", "PIECE". */
const FX_HEAD = ['Sequence_Number', 'Recipient_Contact Name', 'Recipient_Company Name',
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
  'Duty\nDrawback\nS.No', 'user_field_2'];
const FX_MPS = ['Sequence_Number', 'Package count', 'Weight', 'Length ', 'Width', 'Height'];

/* Shopify gives a 2-letter code; DHL checks the name against its Country Master sheet. From that sheet. */
const CTRY = Object.fromEntries('AD:ANDORRA|AE:UNITED ARAB EMIRATES|AF:AFGHANISTAN|AG:ANTIGUA|AI:ANGUILLA|AL:ALBANIA|AM:ARMENIA|AO:ANGOLA|AR:ARGENTINA|AS:AMERICAN SAMOA|AT:AUSTRIA|AU:AUSTRALIA|AW:ARUBA|AZ:AZERBAIJAN|BA:BOSNIA AND HERZEGOVINA|BB:BARBADOS|BD:BANGLADESH|BE:BELGIUM|BF:BURKINA FASO|BG:BULGARIA|BH:BAHRAIN|BI:BURUNDI|BJ:BENIN|BM:BERMUDA|BN:BRUNEI|BO:BOLIVIA|BR:BRAZIL|BS:BAHAMAS|BT:BHUTAN|BW:BOTSWANA|BY:BELARUS|BZ:BELIZE|CA:CANADA|CD:CONGO, THE DEMOCRATIC REPUBLIC OF|CF:CENTRAL AFRICAN REPUBLIC|CG:CONGO|CH:SWITZERLAND|CI:COTE D IVOIRE|CK:COOK ISLANDS|CL:CHILE|CM:CAMEROON|CN:CHINA, PEOPLES REPUBLIC|CO:COLOMBIA|CR:COSTA RICA|CU:CUBA|CV:CAPE VERDE|CY:CYPRUS|CZ:CZECH REPUBLIC, THE|DE:GERMANY|DJ:DJIBOUTI|DK:DENMARK|DM:DOMINICA|DO:DOMINICAN REPUBLIC|DZ:ALGERIA|EC:ECUADOR|EE:ESTONIA|EG:EGYPT|ER:ERITREA|ES:SPAIN|ET:ETHIOPIA|FI:FINLAND|FJ:FIJI|FK:FALKLAND ISLANDS|FM:MICRONESIA, FEDERATED STATES OF|FO:FAROE ISLANDS|FR:FRANCE|GA:GABON|GB:UNITED KINGDOM|GD:GRENADA|GE:GEORGIA|GF:FRENCH GUYANA|GG:GUERNSEY|GH:GHANA|GI:GIBRALTAR|GL:GREENLAND|GM:GAMBIA|GN:GUINEA REPUBLIC|GP:GUADELOUPE|GQ:GUINEA-EQUATORIAL|GR:GREECE|GT:GUATEMALA|GU:GUAM|GW:GUINEA-BISSAU|GY:GUYANA (BRITISH)|HK:HONG KONG|HN:HONDURAS|HR:CROATIA|HT:HAITI|HU:HUNGARY|IC:CANARY ISLANDS, THE|ID:INDONESIA|IE:IRELAND, REPUBLIC OF|IL:ISRAEL|IN:INDIA|IQ:IRAQ|IR:IRAN (ISLAMIC REPUBLIC OF)|IS:ICELAND|IT:ITALY|JE:JERSEY|JM:JAMAICA|JO:JORDAN|JP:JAPAN|KE:KENYA|KG:KYRGYZSTAN|KH:CAMBODIA|KI:KIRIBATI|KM:COMOROS|KN:ST. KITTS|KP:KOREA, THE D.P.R OF (NORTH K.)|KR:KOREA, REPUBLIC OF (SOUTH K.)|KV:KOSOVO|KW:KUWAIT|KY:CAYMAN ISLANDS|KZ:KAZAKHSTAN|LA:LAO PEOPLES DEMOCRATIC REPUBLIC|LB:LEBANON|LC:ST. LUCIA|LI:LIECHTENSTEIN|LK:SRI LANKA|LR:LIBERIA|LS:LESOTHO|LT:LITHUANIA|LU:LUXEMBOURG|LV:LATVIA|LY:LIBYA|MA:MOROCCO|MD:MOLDOVA, REPUBLIC OF|ME:MONTENEGRO, REPUBLIC OF|MG:MADAGASCAR|MH:MARSHALL ISLANDS|MK:MACEDONIA, REPUBLIC OF|ML:MALI|MM:MYANMAR|MN:MONGOLIA|MO:MACAU|MP:COMMONWEALTH NO. MARIANA ISLANDS|MQ:MARTINIQUE|MR:MAURITANIA|MS:MONTSERRAT|MT:MALTA|MU:MAURITIUS|MV:MALDIVES|MW:MALAWI|MX:MEXICO|MY:MALAYSIA|MZ:MOZAMBIQUE|NA:NAMIBIA|NC:NEW CALEDONIA|NE:NIGER|NG:NIGERIA|NI:NICARAGUA|NL:NETHERLANDS, THE|NO:NORWAY|NP:NEPAL|NR:NAURU, REPUBLIC OF|NU:NIUE|NZ:NEW ZEALAND|OM:OMAN|PA:PANAMA|PE:PERU|PF:TAHITI|PG:PAPUA NEW GUINEA|PH:PHILIPPINES, THE|PK:PAKISTAN|PL:POLAND|PR:PUERTO RICO|PT:PORTUGAL|PW:PALAU|PY:PARAGUAY|QA:QATAR|RE:REUNION, ISLAND OF|RO:ROMANIA|RS:SERBIA, REPUBLIC OF|RU:RUSSIAN FEDERATION, THE|RW:RWANDA|SA:SAUDI ARABIA|SB:SOLOMON ISLANDS|SC:SEYCHELLES|SD:SUDAN|SE:SWEDEN|SG:SINGAPORE|SI:SLOVENIA|SK:SLOVAKIA|SL:SIERRA LEONE|SM:SAN MARINO|SN:SENEGAL|SO:SOMALIA|SR:SURINAME|SS:SOUTH SUDAN|ST:SAO TOME AND PRINCIPE|SV:EL SALVADOR|SY:SYRIA|SZ:SWAZILAND|TC:TURKS AND CAICOS ISLANDS|TD:CHAD|TG:TOGO|TH:THAILAND|TJ:TAJIKISTAN|TL:EAST TIMOR|TN:TUNISIA|TO:TONGA|TR:TURKEY|TT:TRINIDAD AND TOBAGO|TV:TUVALU|TW:TAIWAN|TZ:TANZANIA|UA:UKRAINE|UG:UGANDA|US:UNITED STATES OF AMERICA|UY:URUGUAY|UZ:UZBEKISTAN|VC:ST. VINCENT|VE:VENEZUELA|VG:VIRGIN ISLANDS (BRITISH)|VI:VIRGIN ISLANDS (US)|VN:VIETNAM|VU:VANUATU|WS:SAMOA|XB:BONAIRE|XC:CURACAO|XE:ST. EUSTATIUS|XM:ST. MAARTEN|XN:NEVIS|XS:SOMALILAND, REP OF (NORTH SOMALIA)|XY:ST. BARTHELEMY|YE:YEMEN, REPUBLIC OF|YT:MAYOTTE|ZA:SOUTH AFRICA|ZM:ZAMBIA|ZW:ZIMBABWE'
  .split('|').map(p => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; }));
/* Countries where DHL needs a state / a postcode ("conditional mandatory"). */
const NEEDS_STATE = ['US', 'CA', 'AU', 'MX', 'BR', 'IN'];

/* ---------------- small helpers ---------------- */
/* DHL accepts letters, digits, spaces and - , . / in names and addresses. Accents become plain letters,
 * "&" becomes "and", anything else becomes a space. */
const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^A-Za-z0-9 \-,./]/g, ' ').replace(/\s+/g, ' ').trim();
const r2 = n => Math.round(n * 100) / 100;
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
/* Up to three 35-character address lines, broken at spaces. */
function wrap35(text) {
  const out = [];
  let cur = '';
  clean(text).split(' ').filter(Boolean).forEach(w => {
    while (w.length > 35) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, 35)); w = w.slice(35); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= 35) cur += ' ' + w; else { out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  return out;
}
/* Today as yyyy-mm-dd in India time — the date the invoice is raised. */
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const isoDay = ms => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
/* "262721950" → "262721951", "RHL/26-27/0099" → "RHL/26-27/0100": the last run of digits goes up by one, same width. */
function nextInv(s) {
  const m = String(s || '').match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return '';
  const n = String(Number(m[2]) + 1).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}

/* ---------------- what is ready to ship ---------------- */
function state(db) {
  if (!db.csb) db.csb = { nextInv: '', sku: {}, batches: [] };
  return db.csb;
}
/**
 * Where one line of an order stands for shipping from India. `ok` = it can go in a box today:
 * made (production finished), India stock already picked, or not routed yet but India has the stock.
 * Everything else says why not — in production (which stage, or the hold), already in a file waiting for its
 * tracking number, already shipped, or going by Amazon MCF.
 */
function lineState(o, i) {
  const it = o.items[i], pk = it.pk == null ? null : o.pkgs[it.pk];
  if (!pk) return (it.india || 0) >= it.q ? { k: 'india', ok: true, why: `India stock (${it.india})` } : { k: 'route', ok: false, why: 'Not routed — no India stock; route it on the order (Make)' };
  if (J.isMcf(pk)) return { k: 'mcf', ok: false, why: 'Goes by Amazon MCF' };
  if (pk.booked && !pk.route) return { k: 'booked', ok: false, why: `In ${pk.booked.id} (${pk.booked.car}) — waiting for its tracking number` };
  if (J.phaseOf(pk) === 0) return { k: 'prod', ok: false, why: pk.block ? `On hold at ${J.STAGES[pk.pos]}: ${pk.block.why}` : pk.pos === 0 ? 'Production not started' : `In production — ${J.STAGES[pk.pos]} (${pk.pos} of 4 done)` };
  if (J.off(pk) === 0) return pk.src === 'fba' ? { k: 'mcf', ok: false, why: 'In FBA stock' } : { k: 'ready', ok: true, why: pk.src === 'make' ? 'Made — ready' : 'India stock picked' };
  return { k: 'shipped', ok: false, why: `Shipped · ${J.carName(pk)} ${pk.trk[0] || ''}`.trim() };
}
/** Orders with at least one line that can go today, every line with its state (so "2 ready, 1 not ready" shows). */
function candidates(db) {
  return db.orders.map(o => {
    const lines = o.items.map((it, i) => Object.assign({ i, sku: it.sku, t: it.t, v: it.v, q: it.q, price: it.price }, lineState(o, i)));
    return { no: o.no, store: o.store, at: o.at, source: o.source, cust: o.cust.n, country: o.addr.country, lines, ready: lines.filter(l => l.ok).length };
  }).filter(c => c.ready > 0).sort((a, b) => a.at - b.at);
}
const ddmmyyyy = iso => { const [y, m, d] = String(iso).split('-'); return d + m + y; };

/* ---------------- the rows ---------------- */
/**
 * draft = { cur, tax, ships: [{ no, car: 'DHL Express' | 'FedEx', pack, phone, contents, inv, invDate,
 *   boxes: [{kg,l,w,h}], lines: [{i, on, desc, hs, rate, box}] }] }
 * Whole lines go (the ordered quantity); a line ticked off (on: false) stays for a later box.
 * Returns DHL's rows, FedEx's rows (and its extra-box rows), and per shipment the problems that would make the
 * carrier refuse it. `opts.again` rebuilds a file already made, whose lines are booked by it.
 */
function build(db, draft, opts) {
  const st = state(db);
  const cur = CURRENCIES.includes(draft.cur) ? draft.cur : 'USD';
  const tax = TAX_OPTIONS.includes(draft.tax) ? draft.tax : CO.taxOption;
  const rows = [], fxRows = [], fxMps = [], report = [];
  let seq = 0, fxSeq = 0, nx = String(draft.nextInv || st.nextInv || '').trim();
  (draft.ships || []).forEach(sd => {
    const o = db.orders.find(x => x.no === sd.no);
    const bad = [], warn = [], info = [];
    const car = CARRIERS.includes(sd.car) ? sd.car : 'DHL Express', fx = car === 'FedEx';
    if (!o) { report.push({ no: sd.no, car, bad: ['This order is no longer in the hub'], warn, rows: 0 }); return; }
    const lines = (sd.lines || []).filter(l => l.on !== false && o.items[l.i]).map(l => Object.assign({}, l, { qty: o.items[l.i].q }));
    if (!lines.length) bad.push('No items ticked — tick what goes in this box');
    if (!(opts && opts.again)) lines.forEach(l => { const s = lineState(o, l.i); if (!s.ok) bad.push(`${o.items[l.i].sku || o.items[l.i].t}: not ready — ${s.why}`); });

    /* Boxes: weights and sizes. More than one box is written the way DHL's sample does: "5,5,5". */
    const boxes = (sd.boxes && sd.boxes.length ? sd.boxes : [{}]).map(b => ({ kg: num(b.kg, 0), l: num(b.l, CO.boxL), w: num(b.w, CO.boxW), h: num(b.h, CO.boxH) }));
    boxes.forEach((b, k) => { if (!(b.kg > 0)) bad.push(`Weigh ${boxes.length > 1 ? 'box ' + (k + 1) : 'the box'} — the actual weight (kg) is mandatory`); });
    lines.forEach(l => { l.box = Math.min(boxes.length - 1, Math.max(0, Math.floor(num(l.box, 0)))); });
    lines.sort((a, b) => a.box - b.box);

    /* Line weight: each box's weight shared over its units, the last line taking the rounding. */
    boxes.forEach((b, k) => {
      const mine = lines.filter(l => l.box === k), units = mine.reduce((s, l) => s + l.qty, 0);
      if (!mine.length) { bad.push(`Box ${k + 1} has no items in it`); return; }
      let left = r2(b.kg);
      mine.forEach((l, n) => { l.kg = n === mine.length - 1 ? r2(left) : r2(b.kg * l.qty / units); left = r2(left - l.kg); });
    });

    /* Receiver. */
    const a = o.addr || {}, code = String(a.country || '').toUpperCase().slice(0, 2);
    const name = clean(o.cust.n);
    if (!name) bad.push('No receiver name');
    if (name.length > 35) warn.push('Receiver name cut to 35 characters');
    const addr = wrap35([a.a1, a.a2].filter(Boolean).join(' '));
    if (!addr.length) bad.push('No street address');
    if (addr.length > 3) bad.push(`Address is longer than ${car}'s three 35-character lines — shorten it in the order`);
    /* Address2 is mandatory on DHL's sheet; a one-line address gets the city line there. FedEx's sample leaves it empty. */
    if (addr.length === 1 && !fx) addr.push(clean([a.city, a.state, a.zip].filter(Boolean).join(' ')).slice(0, 35));
    if (!a.city) bad.push('No city');
    if (!CTRY[code]) bad.push(`Country "${a.country || '?'}" is not on the carrier's country list`);
    if (NEEDS_STATE.includes(code) && !a.state) bad.push(`No state — ${car} needs it for this country`);
    if (!a.zip) bad.push('No postcode');
    const phone = String(sd.phone || a.phone || o.cust.ph || '').replace(/[^0-9+()\- ]/g, '').trim();
    if (!phone) bad.push(`No phone number — ${car} makes it mandatory (type one in the Phone box)`);

    /* Invoice. */
    const inv = String(sd.inv || '').trim() || (o.source === 'test' ? 'TEST-' + o.no : ''), invDate = sd.invDate || todayIST();
    if (o.source === 'test' && !String(sd.inv || '').trim()) info.push(`Test order — invoice ${inv}, the real series is not used`);
    else if (!inv && nx) { info.push(`GST invoice ${nx} is given to it when the file is made`); nx = nextInv(nx); }
    else if (!inv) warn.push('No GST invoice no — set the next number at the top, or type one here');
    /* Contents: typed, or the item names — whole words only, 35 characters at most. */
    let contents = clean(sd.contents || lines.map(l => o.items[l.i].t).join(', '));
    if (contents.length > 35) { contents = contents.slice(0, 36); contents = contents.slice(0, Math.max(contents.lastIndexOf(' '), 1)).replace(/[ ,.\-/]+$/, ''); }
    if (!contents) bad.push('Contents is mandatory');

    /* Items. */
    const items = lines.map(l => {
      const it = o.items[l.i], mem = st.sku[it.sku] || {};
      const desc = clean(l.desc || mem.desc || [it.t, it.v].filter(Boolean).join(' ')).slice(0, 200);
      const hs = String(l.hs || mem.hs || CO.hsExport).replace(/\D/g, '');
      const rate = r2(num(l.rate, it.price));
      if (hs.length !== 8) bad.push(`${it.sku || it.t}: HS code must be 8 digits`);
      if (!(rate > 0)) bad.push(`${it.sku || it.t}: no invoice rate`);
      if (!desc) bad.push(`${it.sku || it.t}: no description`);
      return { l, it, desc, hs, rate };
    });

    const kgAll = boxes.map(b => r2(b.kg)), multi = boxes.length > 1;
    const value = r2(items.reduce((s, x) => s + x.rate * x.l.qty, 0)), units = lines.reduce((s, l) => s + l.qty, 0);
    if (fx) {
      /* FedEx: one row; the box's goods as one description; extra boxes on "MPS Dimension". */
      fxSeq++;
      const kg = r2(kgAll.reduce((s, k) => s + k, 0)), digits = phone.replace(/\D/g, '');
      const desc = clean(sd.contents || [...new Set(items.map(x => x.desc))].join(', ')).toUpperCase().slice(0, 100);
      const gst = tax === 'IGST Payment' ? r2(value * CO.igstPct / 100) : '';
      const pack = PACKAGING.includes(sd.pack) ? sd.pack : kg <= 2.5 && !multi ? 'FedEx Pak' : 'Your Packaging';
      const row = [fxSeq, name.slice(0, 35), name.slice(0, 35), addr[0] || '', addr[1] || '', addr[2] || '',
        code, clean(a.city), clean(a.state), String(a.zip || '').trim(), digits.length && digits.length <= 15 ? Number(digits) : phone, '', '', o.cust.e || '',
        CO.gstin, '', '', '', '', /^\d+$/.test(inv) ? Number(inv) : inv, ddmmyyyy(invDate), boxes.length, kg,
        multi ? '' : boxes[0].l, multi ? '' : boxes[0].w, multi ? '' : boxes[0].h, '', '', '', gst, '', '', value,
        FX_CUR[cur], 'IN-INDIA', desc, Number(CO.hsImport), 'Rajasthan', 'Jaipur', units, 'PIECE',
        units ? r2(value / units) : '', units ? r2(kg / units) : '', tax === 'IGST Payment' ? CO.igstPct : '', gst,
        o.no, pack, CO.terms, '', ''];
      fxRows.push(row);
      if (multi) boxes.forEach(b => fxMps.push([fxSeq, 1, r2(b.kg), b.l, b.w, b.h]));
      report.push({ no: o.no, car, bad, warn, info, rows: 1, units, value, cur, seq: fxSeq, inv });
      return;
    }
    seq++;
    items.forEach((x, n) => {
      const row = new Array(HEAD.length).fill('');
      const set = (h, v) => { row[COL[h]] = v; };
      if (n === 0) {
        set('Shipment Number', seq);
        set('Receiver Name', name.slice(0, 35)); set('Receiver Attention', name.slice(0, 35));
        set('Receiver Address1', addr[0] || ''); set('Receiver Address2', addr[1] || ''); set('Receiver Address3', addr[2] || '');
        set('City', clean(a.city)); set('State', clean(a.state)); set('Zipcode', String(a.zip || '').trim());
        set('Country Name', CTRY[code] || ''); set('Receiver Phone', phone); set('Receiver Email', o.cust.e || '');
        set('Registration Number', CO.regNo); set('Registration Number Type Code', CO.regType);
        set('Number Issuer Country Code', CO.regIssuer); set('Business Party Type Code', CO.partyType);
        set('Shipper Reference Number', CO.gstin); set('Shipment Currency', cur);
        set('Actual Weight (Kg)', multi ? kgAll.join(',') : kgAll[0]); set('Contents', contents);
        set('Number Of Pieces', boxes.length);
        set('Length(Cm)', multi ? boxes.map(b => b.l).join(',') : boxes[0].l);
        set('Width(Cm)', multi ? boxes.map(b => b.w).join(',') : boxes[0].w);
        set('Height(Cm)', multi ? boxes.map(b => b.h).join(',') : boxes[0].h);
        set('Terms of Trade', CO.terms); set('Exporter Using Ecommerce', CO.ecommerce); set('Tax Payment Option', tax);
        set('GST Invoice No', inv); set('GST Invoice Date', { date: invDate });
        set('SVP (Shipment Value Protection)', CO.svp); set('Insured Amount', CO.insured);
        set('NFEI FLAG', 'NO'); set('OrderNumber', o.no); set('OrderDate', { date: isoDay(o.at) });
      }
      set('SNo', n + 1); set('Piece No', x.l.box + 1); set('Commodity Type', CO.commodityType);
      set('Item Description', x.desc); set('HS Code (Export)', Number(x.hs) || x.hs); set('Commodity Code (Import)', CO.hsImport);
      set('Weight (Kg)', x.l.kg); set('Quantity', x.l.qty); set('UOM', CO.uom); set('Invoice Rate per Unit', x.rate);
      if (tax === 'IGST Payment') set('IGST Percentage', CO.igstPct);
      set('Total Item FOB value', r2(x.rate * x.l.qty)); set('Total Item CESS', 0);
      set('Manufacturing country Code', CO.mfgCountry); set('SKUNo', x.it.sku || '');
      rows.push(row);
    });
    report.push({ no: o.no, car, bad, warn, info, rows: items.length, units, value, cur, seq, inv });
  });
  return { head: HEAD, rows, fx: { head: FX_HEAD, rows: fxRows, mpsHead: FX_MPS, mps: fxMps }, report, ready: report.length > 0 && report.every(r => !r.bad.length) };
}

/** The check before anything is made: throws with the first problem of each shipment that has one. */
function mustBeReady(db, draft) {
  const check = build(db, draft);
  if (!check.ready) throw new Error('Fix the problems shown in red first: ' + check.report.filter(r => r.bad.length).map(r => `#${r.no}: ${r.bad[0]}`).join(' · '));
}
/** Make the files: give each shipment without one the next GST invoice number, remember descriptions and
 * HS codes per SKU, and keep the batch so it can be downloaded again and its shipments get their tracking numbers.
 * Called by actions.dispatchMake after it has checked the draft and booked the parts (`parts[k]` = shipment k's parts). */
function make(db, draft, parts) {
  const st = state(db);
  let next = String(draft.nextInv || st.nextInv || '').trim();
  const ships = draft.ships.map(s => {
    let inv = String(s.inv || '').trim();
    /* A temp test or demo order never takes a number from the real GST invoice series. */
    const o = db.orders.find(x => x.no === s.no);
    if (!inv && o && o.source === 'test') inv = 'TEST-' + s.no;
    if (!inv) { if (!next) throw new Error(`#${s.no} has no GST invoice number — set the next invoice number above, or type one on the shipment`); inv = next; next = nextInv(next); }
    return Object.assign({}, s, { inv, invDate: s.invDate || todayIST() });
  });
  if (next) st.nextInv = next;
  ships.forEach(s => {
    const o = db.orders.find(x => x.no === s.no);
    (s.lines || []).forEach(l => {
      const it = o && o.items[l.i]; if (!it || !it.sku) return;
      const m = st.sku[it.sku] || (st.sku[it.sku] = {});
      if (l.desc) m.desc = clean(l.desc);
      if (l.hs) m.hs = String(l.hs).replace(/\D/g, '');
    });
  });
  const final = build(db, Object.assign({}, draft, { ships }), { again: true });
  const id = 'DSP-' + todayIST().replace(/-/g, '') + '-' + String(st.batches.length + 1).padStart(3, '0');
  const batch = { id, at: Date.now(), cur: draft.cur, tax: draft.tax, files: {},
    ships: ships.map((s, k) => ({ no: s.no, car: CARRIERS.includes(s.car) ? s.car : 'DHL Express', pack: s.pack || '', inv: s.inv, invDate: s.invDate, phone: s.phone || '', contents: s.contents || '', boxes: s.boxes,
      parts: (parts && parts[k]) || [], awb: '',
      lines: (s.lines || []).filter(l => l.on !== false).map(l => ({ i: l.i, desc: l.desc || '', hs: l.hs || '', rate: l.rate, box: l.box || 0 })) })) };
  st.batches.unshift(batch);
  ships.forEach(s => { const o = db.orders.find(x => x.no === s.no); if (o) o.tl.push({ t: Date.now(), who: 'APP', m: `${s.car === 'FedEx' ? 'FedEx upload file' : 'DHL CSB-V'} made (${id}) · GST invoice ${s.inv} · waiting for the tracking number` }); });
  return Object.assign({ batch }, files(final));
}
const files = r => ({ dhl: r.rows.length ? { head: r.head, rows: r.rows } : null, fedex: r.fx.rows.length ? r.fx : null });
/** A batch made earlier, rebuilt from what was saved (same invoice numbers, same lines). */
function again(db, id) {
  const b = state(db).batches.find(x => x.id === id);
  if (!b) throw new Error('No such file batch ' + id);
  return Object.assign({ batch: b }, files(build(db, b, { again: true })));
}

module.exports = { HEAD, FX_HEAD, FX_MPS, CO, TAX_OPTIONS, CURRENCIES, CARRIERS, PACKAGING, candidates, lineState, build, mustBeReady, make, again, state, nextInv, todayIST };

});

HUBMOD("queue", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * THE SEND-TO-SHOPIFY QUEUE. Every change Shopify must hear about is written here first, then sent.
 * Nothing is lost when Shopify is down or says no: the item stays, is retried, and shows on Setup.
 *
 * Item status:
 *   waiting  will be sent on the next run
 *   sent     Shopify said yes
 *   failed   Shopify said no five times — read `last` for why
 *   held     not sent because Shopify is not connected for that store, or sending is switched off
 *            (shopify.allowWrites = false). NEVER sent by itself later: turning sending on must not fire off
 *            every change made while testing. Only "Send the Shopify queue now" sends them; "Discard held" drops them.
 *   test     a temp test order — never sent anywhere; the text says what WOULD have been sent
 * ===================================================================================== */
const shopify = require('./shopify');
const config = require('./config');
const { clip } = require('./util');

function enqueue(db, order, kind, data, desc) {
  const item = { id: (db.seq = (db.seq || 0) + 1), at: Date.now(), orderNo: order.no, store: order.store, kind, data: data || {}, desc,
    status: order.source === 'shopify' ? 'waiting' : 'test', tries: 0, last: order.source === 'shopify' ? '' : 'Temp test order — not in Shopify, so nothing is sent' };
  db.queue.push(item);
  if (db.queue.length > 500) db.queue = db.queue.filter(q => q.status !== 'sent' && q.status !== 'test').concat(db.queue.filter(q => q.status === 'sent' || q.status === 'test').slice(-300));
  return item;
}

async function run(db, opts) {
  const sendHeld = !!(opts && opts.sendHeld), out = { sent: 0, failed: 0, held: 0 };
  for (const q of db.queue) {
    if (q.status !== 'waiting' && !(sendHeld && q.status === 'held')) continue;
    const o = db.orders.find(x => x.no === q.orderNo);
    if (!o) { q.status = 'failed'; q.last = 'The order is no longer in the hub'; continue; }
    if (!config.shopify(q.store)) { q.status = 'held'; q.last = `Shopify (${q.store}) is not connected`; out.held++; continue; }
    if (!config.shopifyWrites()) { q.status = 'held'; q.last = config.WEB ? 'Sending to Shopify is switched off on the test ERP' : 'Sending is switched off (shopify.allowWrites = false)'; out.held++; continue; }
    /* The test-site copy sends only some kinds of change (web/shopify.js); the rest wait for the hub on a computer. */
    if (shopify.canSend && !shopify.canSend(q.kind)) { q.status = 'held'; q.last = 'Not sent from the test site — only marking lines shipped is'; out.held++; continue; }
    const pk = q.data.part != null ? o.pkgs[q.data.part] : null;
    try {
      if (q.kind === 'mcf') {
        pk.foId = await shopify.splitAndProgress(o.store, o.gid, q.data.lines);
        await shopify.appendNote(o.store, o.gid, q.data.note);
        await shopify.addTags(o.store, o.gid, ['MCF']);
      } else if (q.kind === 'tags') {
        await shopify.removeTags(o.store, o.gid, q.data.remove || []);
        await shopify.addTags(o.store, o.gid, q.data.add || []);
      } else if (q.kind === 'note') {
        await shopify.appendNote(o.store, o.gid, q.data.line);
      } else if (q.kind === 'fulfil') {
        const r = await shopify.fulfil(o.store, o.gid, q.data.lines, q.data.company, q.data.numbers, q.data.notify !== false);
        if (r.id) pk.fulfilId = r.id;
        if (r.already) q.last = 'Shopify had nothing left open on these lines';
      } else if (q.kind === 'unfulfil') {
        await shopify.cancelFulfilment(o.store, q.data.fulfilId);
      } else if (q.kind === 'event') {
        if (!pk.fulfilId) { q.last = 'Waiting for the fulfilment to be sent first'; continue; }
        await shopify.deliveryEvent(o.store, pk.fulfilId, q.data.status, q.data.at, q.data.message);
      }
      q.status = 'sent'; q.sentAt = Date.now(); if (!q.last) q.last = 'Shopify said yes'; out.sent++;
    } catch (e) {
      q.tries++; q.last = clip(e.message, 300);
      if (q.tries >= 5) { q.status = 'failed'; out.failed++; }
    }
  }
  return out;
}

/** Drop the changes held while sending was off (and any that failed for good). They stay listed, marked discarded. */
function discard(db) {
  let n = 0;
  db.queue.forEach(q => { if (q.status === 'held' || q.status === 'failed') { q.status = 'discarded'; q.last = 'Discarded by hand — not sent'; n++; } });
  return n;
}

module.exports = { enqueue, run, discard };

});

HUBMOD("shop-track", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * SHOPIFY'S OWN TRACKING — no DHL or FedEx key needed.
 *
 * Once an order is fulfilled in Shopify with a tracking number and an exact carrier name ("DHL Express", "FedEx",
 * "UPS", "USPS", "Amazon Logistics US"), Shopify follows the parcel itself: status, scans with place and time,
 * expected and delivered dates. Checked on the real stores on 24 Oct (DHL Express parcels: 11–15 scans each).
 * This file turns a Shopify fulfilment into the same shape the carriers' own APIs give the hub
 * ({ status, eta, events: [{ at, status, place, text }] }), so the rest of the hub does not care where it came from.
 * ===================================================================================== */
const J = require('./journey');

/* Shopify's words → the hub's carrier statuses (J.STATUS_OFF) */
/* CONFIRMED is the carrier saying it has the parcel (its scan reads "Package has shipped") — picked up, not waiting. */
const STATUS = { LABEL_PRINTED: 'label_created', LABEL_PURCHASED: 'label_created', CONFIRMED: 'picked_up', SUBMITTED: 'label_created',
  FULFILLED: 'label_created', MARKED_AS_FULFILLED: 'label_created', CARRIER_PICKED_UP: 'picked_up', PICKED_UP: 'picked_up',
  IN_TRANSIT: 'in_transit', DELAYED: 'delayed', OUT_FOR_DELIVERY: 'out_for_delivery', ATTEMPTED_DELIVERY: 'out_for_delivery',
  READY_FOR_PICKUP: 'out_for_delivery', DELIVERED: 'delivered', FAILURE: 'in_transit', NOT_DELIVERED: 'in_transit' };
/* What a scan says when Shopify gives no message — failed deliveries keep words the flags recognise. */
const WORDS = { ATTEMPTED_DELIVERY: 'Delivery attempted', FAILURE: 'Delivery failed', NOT_DELIVERED: 'Delivery failed — not delivered',
  DELAYED: 'Delayed', READY_FOR_PICKUP: 'Ready for pickup', CARRIER_PICKED_UP: 'Picked up by the carrier', LABEL_PURCHASED: 'Label created',
  LABEL_PRINTED: 'Label printed', CONFIRMED: 'Shipment confirmed', IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', PICKED_UP: 'Picked up' };
const word = s => WORDS[s] || String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

/** One Shopify fulfilment → { status, eta, events, numbers, company, id }. */
function read(f) {
  const events = ((f.events && f.events.nodes) || []).map(e => ({
    at: Date.parse(e.happenedAt), status: STATUS[e.status] || 'in_transit',
    place: [e.city, e.province, e.country].filter(Boolean).join(', '), text: e.message || word(e.status),
  })).filter(e => !isNaN(e.at)).sort((a, b) => b.at - a.at);
  let status = STATUS[f.displayStatus] || (events[0] ? events[0].status : 'label_created');
  if (f.deliveredAt) status = 'delivered';
  /* A failed delivery is not a step forward: keep it where it was, and let the scan's words raise the flag. */
  if (/FAILURE|NOT_DELIVERED/.test(f.displayStatus) && !events.length) events.push({ at: Date.now(), status: 'in_transit', place: '', text: word(f.displayStatus) });
  return { id: f.id, status, eta: f.estimatedDeliveryAt ? f.estimatedDeliveryAt.slice(0, 10) : '', events,
    company: ((f.trackingInfo || [])[0] || {}).company || '', numbers: (f.trackingInfo || []).map(t => t.number).filter(Boolean),
    canceled: /CANCEL|VOIDED/.test(f.displayStatus || '') || f.status === 'CANCELLED' };
}

/**
 * A part for lines your team already shipped in Shopify (before the hub saw the order): it shows on the order with
 * its carrier and Shopify's tracking, and is never offered for shipping again.
 */
function partFrom(o, f, items) {
  const t = read(f);
  const pk = { src: 'shop', items, pos: 1, route: 'courier', car: t.company || 'Carrier', trk: t.numbers, eta: t.eta, late: t.status === 'delayed', ts: [], ev: {},
    rep: false, block: null, req: Date.parse(f.createdAt) || Date.now(), rush: false, mcfId: '', mcfReal: false, fulfilId: f.id, fulfilQueued: true, fromShopify: true,
    id: o.no + '-' + (o.pkgs.length + 1) };
  pk.ts[0] = pk.req;
  const target = Math.max(2, J.STATUS_OFF[t.status] || 2);
  for (let x = 1; x <= target && pk.pos < J.total(pk); x++) {
    const ev = t.events.slice().reverse().find(e => (J.STATUS_OFF[e.status] || 0) >= x) || {};
    pk.ts[pk.pos] = x <= 2 ? pk.req : ev.at || (x === 6 && Date.parse(f.deliveredAt)) || pk.req;
    pk.ev[pk.pos] = ev.place || '';
    pk.pos++;
  }
  if (t.events.length) { pk.scans = t.events.slice(0, 20).map(e => ({ at: e.at, place: e.place, text: e.text })); pk.last = pk.scans[0]; }
  if (J.off(pk) >= 6) pk.eta = '';
  return pk;
}

module.exports = { read, partFrom };

});

HUBMOD("seed", function (module, exports, require, __dirname, process, Buffer) {
/* TEMP ORDERS for testing. Numbers start with T so they can never be mistaken for real Shopify orders.
 * They live only in data/db.json; "Reset temp orders" on the Setup page puts them back. Orders pulled
 * from a connected Shopify store are kept when the temp orders are reset. */
const J = require('./journey');
const DAY = J.DAY;

function build() {
  const NOW = Date.now();
  const ago = (d, h) => NOW - d * DAY - (h || 0) * 3600000;
  const I = (t, v, sku, price, fba, india, q) => ({ lid: null, t, v, sku, price, q: q || 1, fba, india, pk: null });
  const C = (n, e, ph, k) => ({ n, e, ph, k });
  const A = (a1, city, state, zip) => ({ a1, a2: '', city, state, zip, country: 'US', phone: '' });
  const O = (no, store, at, cust, addr, ship, items, extra) => Object.assign({ no, store, at, cust, addr, ship, items, pkgs: [], note: '', tl: [], rets: [], source: 'test', gid: null }, extra || {});
  /* a part already under way; `since` = days it has been in its current step */
  const P = (o, src, items, pos, extra) => {
    const pk = Object.assign({ src, items, pos, route: null, car: '', trk: [], eta: '', late: false, ts: [], ev: {}, rep: false, block: null, req: 0, rush: false, mcfId: '', mcfReal: false, fulfilId: '', fulfilQueued: false }, extra || {});
    const since = pk.since == null ? 0.5 : pk.since; delete pk.since;
    let t = NOW - since * DAY;
    for (let i = pk.pos - 1; i >= 0; i--) { pk.ts[i] = t; t -= (i < J.prodLen(pk) ? 1.2 : 0.6) * DAY; }
    pk.req = pk.pos ? pk.ts[0] - 0.5 * DAY : NOW - since * DAY;
    if (pk.src === 'make') for (let i = 1; i < Math.min(pk.pos, J.prodLen(pk)); i++) pk.ev[i] = 'Ridhi factory, Jaipur';
    pk.id = o.no + '-' + (o.pkgs.length + 1);
    if (pk.route === 'mcf') { pk.mcfId = 'SHOP-' + o.no + '-' + (o.pkgs.length + 1); pk.fulfilQueued = J.off(pk) >= 3; }
    if (pk.route === 'courier') pk.fulfilQueued = true;
    o.pkgs.push(pk); items.forEach(i => { o.items[i].pk = o.pkgs.length - 1; });
    if (pk.pos === J.total(pk)) pk.eta = '';
    return pk;
  };
  const list = [], add = o => (list.push(o), o);

  add(O('T4876', 'Ridhi', ago(0, 2), C('Emily Carter', 'emily.carter@example.com', '+1 512 555 0142', 2), A('1802 Oakmont Dr', 'Austin', 'TX', '78704'), 0,
    [I('Kantha quilt, Queen', 'Indigo', 'RH-KQ-Q-IND', 129, 14, 3), I('Cushion cover set', 'Indigo', 'RH-CC-SET-IND', 45, 6, 25), I('Block-print throw', 'Rust', 'RH-BT-RST', 40, 0, 0)],
    { note: 'Gift — please leave out the invoice.' }));
  add(O('T7912', 'CPC', ago(0, 4), C('Olivia Brooks', 'olivia.b@example.com', '+1 303 555 0118', 1), A('44 Pearl St', 'Denver', 'CO', '80203'), 6.95,
    [I('Table runner, 72"', 'Sage', 'CPC-TR72-SGE', 34, 22, 30)]));
  add(O('T4880', 'Ridhi', ago(0, 1), C('Daniel Wood', 'daniel.w@example.com', '+1 617 555 0102', 1), A('12 Beacon St', 'Boston', 'MA', '02108'), 9.5,
    [I('Duvet cover, Queen', 'Sage', 'RH-DC-Q-SGE', 139, 0, 6), I('Pillow shams, pair', 'Sage', 'RH-PS-SGE', 39, 11, 2)]));
  const o4871 = add(O('T4871', 'Ridhi', ago(1, 3), C('Sophia Turner', 'sophia.t@example.com', '+1 919 555 0170', 4), A('9 Glenwood Ave', 'Raleigh', 'NC', '27603'), 0,
    [I('Duvet cover, King', 'Ivory', 'RH-DC-K-IVR', 149, 9, 4), I('Pillow shams, pair', 'Ivory', 'RH-PS-IVR', 39, 30, 12)]));
  P(o4871, 'fba', [0, 1], 3, { route: 'mcf', eta: 'in 4 days', since: 0.4 });
  const o4869 = add(O('T4869', 'Ridhi', ago(1, 6), C('Liam Patel', 'liam.patel@example.com', '+1 732 555 0109', 1), A('210 Plainfield Ave', 'Edison', 'NJ', '08817'), 9.5,
    [I('Quilted bedspread, Queen', 'Mustard', 'RH-QB-Q-MST', 119, 0, 3)]));
  P(o4869, 'india', [0], 1, { since: 0.6 });
  const o7904 = add(O('T7904', 'CPC', ago(5), C('Ava Nguyen', 'ava.n@example.com', '+1 813 555 0133', 3), A('501 Bayshore Blvd', 'Tampa', 'FL', '33606'), 6.95,
    [I('Napkins, set of 6', 'Rose', 'CPC-NP6-RSE', 28, 0, 0), I('Tablecloth, 60x90', 'Rose', 'CPC-TC6090-RSE', 58, 0, 2)]));
  P(o7904, 'make', [0, 1], 3, { since: 3.4, block: { why: 'Waiting for fabric', at: ago(3) } });
  const o4850 = add(O('T4850', 'Ridhi', ago(6), C('Harper Scott', 'harper.s@example.com', '+1 404 555 0110', 1), A('33 Peachtree St', 'Atlanta', 'GA', '30303'), 0,
    [I('Kantha quilt, Queen', 'Rust', 'RH-KQ-Q-RST', 129, 0, 0)]));
  P(o4850, 'make', [0], 3, { since: 2.8, block: { why: 'Waiting for fabric', at: ago(2, 18) } });
  const o7893 = add(O('T7893', 'CPC', ago(5, 4), C('Lucas Green', 'lucas.g@example.com', '+1 615 555 0129', 2), A('400 Broadway', 'Nashville', 'TN', '37203'), 6.95,
    [I('Table runner, 90"', 'Rose', 'CPC-TR90-RSE', 39, 0, 0)]));
  P(o7893, 'make', [0], 3, { since: 1.9 });
  const o4858 = add(O('T4858', 'Ridhi', ago(4), C('Grace Miller', 'grace.m@example.com', '+1 503 555 0150', 1), A('88 Burnside St', 'Portland', 'OR', '97209'), 0,
    [I('Kantha quilt, Twin', 'Sage', 'RH-KQ-T-SGE', 109, 0, 0)]));
  P(o4858, 'make', [0], 2, { since: 1.2 });
  const o7899 = add(O('T7899', 'CPC', ago(7), C('Ethan Wright', 'ethan.w@example.com', '+1 608 555 0174', 2), A('12 State St', 'Madison', 'WI', '53703'), 6.95,
    [I('Apron', 'Mustard', 'CPC-APR-MST', 24, 0, 6)]));
  P(o7899, 'make', [0], 4, { since: 1.6, block: { why: 'QC rework', at: ago(1, 1) } });
  const o4847 = add(O('T4847', 'Ridhi', ago(2, 18), C('Zoe Adams', 'zoe.a@example.com', '+1 720 555 0181', 1), A('9 Larimer Sq', 'Denver', 'CO', '80202'), 9.5,
    [I('Bedspread, King', 'Indigo', 'RH-BS-K-IND', 139, 0, 0)]));
  P(o4847, 'make', [0], 0, { since: 2.4, block: { why: 'No karigar free', at: ago(2) } });
  const o7890 = add(O('T7890', 'CPC', ago(2), C('Ella King', 'ella.k@example.com', '+1 206 555 0177', 1), A('200 Pike St', 'Seattle', 'WA', '98101'), 6.95,
    [I('Napkins, set of 6', 'Sage', 'CPC-NP6-SGE', 28, 0, 0)]));
  P(o7890, 'make', [0], 1, { since: 0.7 });
  const o4861 = add(O('T4861', 'Ridhi', ago(11), C('Noah Kim', 'noah.kim@example.com', '+1 614 555 0187', 1), A('77 Hamilton Rd', 'Columbus', 'OH', '43213'), 9.5,
    [I('Kantha quilt, King', 'Rust', 'RH-KQ-K-RST', 139, 0, 1)]));
  P(o4861, 'make', [0], 9, { route: 'courier', car: 'DHL Express', trk: ['4417802211'], eta: 'late (was 2 days ago)', late: true, since: 3.5 });
  const o7902 = add(O('T7902', 'CPC', ago(4, 2), C('Mia Lopez', 'mia.lopez@example.com', '+1 214 555 0191', 2), A('3100 Elm St', 'Dallas', 'TX', '75226'), 6.95,
    [I('Placemats, set of 4', 'Mustard', 'CPC-PM4-MST', 32, 40, 12)]));
  P(o7902, 'india', [0], 6, { route: 'courier', car: 'FedEx', trk: ['779044210093'], eta: 'Today', since: 0.2 });
  const o4844 = add(O('T4844', 'Ridhi', ago(11, 2), C('James Reed', 'james.reed@example.com', '+1 208 555 0123', 1), A('15 Harrison Blvd', 'Boise', 'ID', '83702'), 0,
    [I('Cushion covers, pair', 'Sage', 'RH-CCP-SGE', 36, 18, 5), I('Bolster cover', 'Sage', 'RH-BC-SGE', 22, 7, 0)]));
  P(o4844, 'fba', [0, 1], 7, { route: 'mcf', trk: ['TBA314998120332'], since: 4 });
  const o7880 = add(O('T7880', 'CPC', ago(13), C('Chloe Davis', 'chloe.d@example.com', '+1 469 555 0166', 1), A('820 Main St', 'Frisco', 'TX', '75034'), 6.95,
    [I('Tablecloth, 60x120', 'Indigo', 'CPC-TC60120-IND', 64, 5, 2)]));
  P(o7880, 'fba', [0], 7, { route: 'mcf', trk: ['TBA314871102214'], since: 5 });
  o4844.rets.push({ items: [1], why: 'Wrong size', what: 'return', pos: 1, car: 'USPS', trk: '9205590164917312345', rep: null, at: ago(2) });
  o7880.rets.push({ items: [0], why: 'Arrived damaged', what: 'both', pos: 0, car: '', trk: '', rep: null, at: ago(0, 16) });
  list.forEach(o => o.tl.push({ t: o.at, who: 'SHOPIFY', m: 'Order placed (temp test order)' }));
  return list;
}

/* The order Present mode tells its story with: a fresh Shopify-style order, half of it in India stock (ships now by
 * DHL), the throw not in stock anywhere (goes to production). A TEST order — nothing about it ever reaches Shopify. */
function demoOrder() {
  const now = Date.now();
  const o = { no: 'D1001', store: 'Ridhi', at: now - 20 * 60000, source: 'test', gid: null, demo: true,
    cust: { n: 'Sarah Mitchell', e: 'sarah.mitchell@example.com', ph: '+1 512 555 0199', k: 1 },
    addr: { a1: '2200 Lake Austin Blvd', a2: '', city: 'Austin', state: 'TX', zip: '78703', country: 'US', phone: '' },
    ship: 0, note: '', pkgs: [], tl: [], rets: [],
    items: [
      { lid: null, t: 'Kantha quilt, Queen', v: 'Indigo', sku: 'RH-KQ-Q-IND', price: 129, q: 1, fba: 0, india: 3, pk: null },
      { lid: null, t: 'Cushion cover set', v: 'Indigo', sku: 'RH-CC-SET-IND', price: 45, q: 1, fba: 0, india: 25, pk: null },
      { lid: null, t: 'Block-print throw', v: 'Rust', sku: 'RH-BT-RST', price: 40, q: 1, fba: 0, india: 0, pk: null },
    ] };
  o.tl.push({ t: o.at, who: 'SHOPIFY', m: 'Order placed · Online Store (demo order)' });
  return o;
}

/* Stock used by the Decide table and the Stock page, per SKU. Edit data/db.json → stock to try other numbers.
 * When Amazon is connected, FBA stock for orders pulled from Shopify is read live instead. */
const STOCK = [
  ['Kantha quilt, Queen', 'Indigo', 'RH-KQ-Q-IND', 'Ridhi', 6, 14, 3, 31], ['Cushion cover set', 'Indigo', 'RH-CC-SET-IND', 'Ridhi', 18, 6, 25, 22],
  ['Block-print throw', 'Rust', 'RH-BT-RST', 'Ridhi', 0, 0, 0, 12], ['Duvet cover, King', 'Ivory', 'RH-DC-K-IVR', 'Ridhi', 11, 9, 4, 14],
  ['Duvet cover, Queen', 'Sage', 'RH-DC-Q-SGE', 'Ridhi', 4, 0, 6, 10], ['Kantha quilt, King', 'Rust', 'RH-KQ-K-RST', 'Ridhi', 2, 0, 1, 9],
  ['Quilted bedspread, Queen', 'Mustard', 'RH-QB-Q-MST', 'Ridhi', 7, 0, 3, 6], ['Table runner, 72"', 'Sage', 'CPC-TR72-SGE', 'CPC', 40, 22, 30, 18],
  ['Napkins, set of 6', 'Rose', 'CPC-NP6-RSE', 'CPC', 3, 0, 0, 15], ['Tablecloth, 60x90', 'Rose', 'CPC-TC6090-RSE', 'CPC', 1, 0, 2, 11],
  ['Placemats, set of 4', 'Mustard', 'CPC-PM4-MST', 'CPC', 26, 40, 12, 20], ['Apron', 'Mustard', 'CPC-APR-MST', 'CPC', 9, 0, 6, 4],
].map(r => ({ t: r[0], v: r[1], sku: r[2], store: r[3], shop: r[4], fba: r[5], india: r[6], sold: r[7] }));

module.exports = { build, STOCK, demoOrder };

});

HUBMOD("amazon", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * AMAZON — SP-API: MCF (preview, create, status), package tracking, FBA stock.
 * Same calls the Pricing-API script makes (Mcf.gs), so moving this to Apps Script later is a copy.
 *
 * CREATE IS GUARDED TWICE: amazon.allowRealMcf must be true in config.local.json, and the order must
 * come from a real store. Otherwise the MCF order is simulated — no parcel, no fee.
 * ===================================================================================== */
const { request, clip } = require('./util');
const config = require('./config');

const TOKENS = {};
async function token(store) {
  const a = config.amazon(store);
  if (!a) throw new Error(`Amazon (${store}) is not connected — fill amazon.accounts.${store} in config.local.json`);
  const t = TOKENS[store];
  if (t && t.exp > Date.now() + 60000) return { a, at: t.at };
  const r = await request('POST', 'https://api.amazon.com/auth/o2/token', { form: { grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: a.clientId, client_secret: a.clientSecret } });
  if (r.status !== 200 || !r.json || !r.json.access_token) throw new Error(`Amazon login refused (${r.status}): ${clip(r.text, 200)}`);
  TOKENS[store] = { at: r.json.access_token, exp: Date.now() + (r.json.expires_in || 3600) * 1000 };
  return { a, at: r.json.access_token };
}
async function sp(store, method, path, body) {
  const { a, at } = await token(store);
  const r = await request(method, `https://${a.host}${path}`, { headers: { 'x-amz-access-token': at }, body });
  if (r.status >= 300) {
    const msg = r.json && r.json.errors ? r.json.errors.map(e => e.code + ': ' + e.message).join('; ') : r.text;
    const err = new Error(`Amazon ${r.status}: ${clip(msg, 300)}`); err.code = r.status; err.body = msg; throw err;
  }
  return r.json || {};
}

const mcfId = (orderNo, n) => `SHOP-${String(orderNo).replace(/[^A-Za-z0-9]/g, '').toUpperCase()}-${n}`;
function body(order, lines) {
  const a = order.addr || {};
  if (!a.a1 || !a.city || !a.country) throw new Error('The order has no usable shipping address.');
  return {
    destinationAddress: { name: String(order.cust.n).slice(0, 50), addressLine1: String(a.a1).slice(0, 60), addressLine2: a.a2 ? String(a.a2).slice(0, 60) : undefined,
      city: String(a.city).slice(0, 50), stateOrRegion: a.state || '', postalCode: a.zip || '', countryCode: String(a.country).slice(0, 2).toUpperCase(), phone: a.phone || undefined },
    items: lines.map((l, i) => ({ sellerSku: l.sku, sellerFulfillmentOrderItemId: String(i + 1), quantity: l.q })),
  };
}
async function check(store) {
  await token(store);
  const r = await sp(store, 'GET', '/fba/outbound/2020-07-01/fulfillmentOrders?queryStartDate=' + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()));
  return { mcf: true, recent: ((r.payload || {}).fulfillmentOrders || []).length };
}
async function preview(store, order, lines) {
  const b = body(order, lines), a = config.amazon(store);
  const r = await sp(store, 'POST', '/fba/outbound/2020-07-01/fulfillmentOrders/preview', { marketplaceId: a.marketplaceId, address: b.destinationAddress, items: b.items, shippingSpeedCategories: ['Standard', 'Expedited', 'Priority'] });
  return ((r.payload || {}).fulfillmentPreviews || []).map(p => ({
    speed: p.shippingSpeedCategory, ok: p.isFulfillable !== false,
    fee: Math.round((p.estimatedFees || []).reduce((s, f) => s + Number((f.amount && f.amount.value) || 0), 0) * 100) / 100,
    by: ((p.fulfillmentPreviewShipments || []).map(s => String(s.latestArrivalDate || '').slice(0, 10)).sort().pop()) || '',
  }));
}
/** Place the shipment. The id comes from the order number, so a repeat is refused by Amazon, not doubled. */
async function create(store, order, lines, speed, id) {
  const b = body(order, lines), a = config.amazon(store);
  try {
    await sp(store, 'POST', '/fba/outbound/2020-07-01/fulfillmentOrders', { marketplaceId: a.marketplaceId, sellerFulfillmentOrderId: id,
      displayableOrderId: String(order.no).slice(0, 40), displayableOrderDate: new Date(order.at).toISOString(), displayableOrderComment: 'Thank you for your order.',
      shippingSpeedCategory: speed || 'Standard', destinationAddress: b.destinationAddress, items: b.items });
  } catch (e) {
    if (String(e.body || e.message).includes('DuplicateRequest')) return { id, already: true };
    throw e;
  }
  return { id, already: false };
}
/** What Amazon has done: status, tracking numbers, package numbers, and each package's latest scan. */
async function status(store, id) {
  const r = await sp(store, 'GET', '/fba/outbound/2020-07-01/fulfillmentOrders/' + encodeURIComponent(id));
  const p = r.payload || {}, st = String((p.fulfillmentOrder || {}).fulfillmentOrderStatus || '').toUpperCase();
  const pk = [];
  (p.fulfillmentShipments || []).forEach(s => (s.fulfillmentShipmentPackage || []).forEach(k => pk.push({ no: k.packageNumber, trk: k.trackingNumber, car: k.carrierCode })));
  const scans = [];
  for (const k of pk.slice(0, 5)) {
    try {
      const t = (await sp(store, 'GET', '/fba/outbound/2020-07-01/tracking?packageNumber=' + encodeURIComponent(k.no))).payload || {};
      scans.push({ cur: String(t.currentStatus || '').toUpperCase(), eta: t.estimatedArrivalDate || '', events: (t.trackingEvents || []).map(e => ({ at: Date.parse(e.eventDate), code: e.eventCode, text: e.eventDescription || e.eventCode,
        place: [e.eventAddress && e.eventAddress.city, e.eventAddress && e.eventAddress.state].filter(Boolean).join(', ') })) });
    } catch (e) { /* tracking for one package missing is not a failure of the order */ }
  }
  return { status: st, packages: pk, scans };
}
/** Where an MCF part is, in the hub's common words. */
function normalise(s) {
  const all = s.scans.map(x => x.cur);
  if (all.length && all.every(x => x === 'DELIVERED')) return 'delivered';
  if (all.includes('OUT_FOR_DELIVERY')) return 'out_for_delivery';
  if (all.some(x => x === 'IN_TRANSIT' || x === 'DELIVERED')) return 'in_transit';
  if (s.status === 'COMPLETE' || s.status === 'COMPLETE_PARTIALLED' || s.packages.length) return 'picked_up';
  if (['RECEIVED', 'PLANNING', 'PROCESSING'].includes(s.status)) return 'accepted';
  if (['INVALID', 'UNFULFILLABLE', 'CANCELLED'].includes(s.status)) return 'problem';
  return 'sent';
}
/** FBA stock per SKU (fulfillable units), for the "Decide" table. */
async function fbaStock(store, skus) {
  const a = config.amazon(store), out = {};
  for (let i = 0; i < skus.length; i += 50) {
    const q = `/fba/inventory/v1/summaries?details=false&granularityType=Marketplace&granularityId=${a.marketplaceId}&marketplaceIds=${a.marketplaceId}&sellerSkus=${encodeURIComponent(skus.slice(i, i + 50).join(','))}`;
    const r = await sp(store, 'GET', q);
    ((r.payload || {}).inventorySummaries || []).forEach(s => { out[s.sellerSku] = Number(s.totalQuantity != null ? s.totalQuantity : s.inventoryDetails && s.inventoryDetails.fulfillableQuantity) || 0; });
  }
  return out;
}

module.exports = { check, preview, create, status, normalise, fbaStock, mcfId };

});

HUBMOD("carriers", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * CARRIERS — DHL Express, FedEx, UPS. Each one is read and turned into ONE common shape:
 *     { status, eta, events: [{ at, status, place, text }] }
 *     status = label_created | picked_up | in_transit | delayed | out_for_delivery | delivered | unknown
 * so the hub and Shopify never care where the news came from. A carrier with no keys is left to the
 * simulator (or to the fallbacks in the README: Shopify read-back, carrier e-mails, a CSV upload).
 * ===================================================================================== */
const { request, clip } = require('./util');
const config = require('./config');

/* ---------------- DHL: Shipment Tracking – Unified ---------------- */
async function dhl(c, trk) {
  const r = await request('GET', 'https://api-eu.dhl.com/track/shipments?trackingNumber=' + encodeURIComponent(trk), { headers: { 'DHL-API-Key': c.apiKey, Accept: 'application/json' } });
  if (r.status === 404) return { status: 'unknown', events: [], note: 'DHL does not know this number yet' };
  if (r.status >= 300) throw new Error(`DHL ${r.status}: ${clip(r.text, 200)}`);
  const s = ((r.json || {}).shipments || [])[0] || {};
  const map = x => {
    const code = String((x.statusCode || '')).toLowerCase(), text = String(x.description || x.status || '');
    if (code === 'delivered') return 'delivered';
    if (/out for delivery|with delivery courier/i.test(text)) return 'out_for_delivery';
    if (code === 'failure' || /customs|delay|exception|held/i.test(text)) return 'delayed';
    if (code === 'pre-transit') return /picked up|collected/i.test(text) ? 'picked_up' : 'label_created';
    if (code === 'transit') return /picked up|collected/i.test(text) ? 'picked_up' : 'in_transit';
    return 'unknown';
  };
  const place = x => { const a = (x.location || {}).address || {}; return [a.addressLocality, a.countryCode].filter(Boolean).join(', '); };
  const events = (s.events || []).map(e => ({ at: Date.parse(e.timestamp), status: map(e), place: place(e), text: e.description || e.status || '' }));
  return { status: s.status ? map(s.status) : (events[0] ? events[0].status : 'unknown'), eta: s.estimatedTimeOfDelivery || '', events };
}

/* ---------------- FedEx: Track API (OAuth) ---------------- */
const FX = {};
async function fedex(c, trk) {
  const host = c.sandbox ? 'https://apis-sandbox.fedex.com' : 'https://apis.fedex.com';
  if (!FX.at || FX.exp < Date.now() + 60000) {
    const t = await request('POST', host + '/oauth/token', { form: { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret } });
    if (t.status !== 200) throw new Error(`FedEx login refused (${t.status}): ${clip(t.text, 200)}`);
    FX.at = t.json.access_token; FX.exp = Date.now() + (t.json.expires_in || 3600) * 1000;
  }
  const r = await request('POST', host + '/track/v1/trackingnumbers', { headers: { Authorization: 'Bearer ' + FX.at, 'X-locale': 'en_US' },
    body: { includeDetailedScans: true, trackingInfo: [{ trackingNumberInfo: { trackingNumber: trk } }] } });
  if (r.status === 401 || r.status === 403) throw new Error('FedEx refused tracking: the login works, but the FedEx project these keys belong to does not include the Track API. On developer.fedex.com → My Projects → that project, add "Track API" (or make a new project with it) and use its keys.');
  if (r.status >= 300) throw new Error(`FedEx ${r.status}: ${clip(r.text, 200)}`);
  const tr =((((r.json || {}).output || {}).completeTrackResults || [])[0] || {}).trackResults;
  const t = (tr || [])[0] || {};
  if (t.error) return { status: 'unknown', events: [], note: t.error.message };
  const map = code => ({ DL: 'delivered', OD: 'out_for_delivery', IT: 'in_transit', AR: 'in_transit', DP: 'in_transit', PU: 'picked_up', OC: 'label_created', DE: 'delayed', SE: 'delayed', CA: 'delayed', HL: 'in_transit' }[code] || 'unknown');
  const place = l => [l && l.city, l && l.countryCode].filter(Boolean).join(', ');
  const events = (t.scanEvents || []).map(e => ({ at: Date.parse(e.date), status: map(e.derivedStatusCode || e.eventType), place: place(e.scanLocation), text: e.eventDescription || '' }));
  const eta = ((t.dateAndTimes || []).find(d => d.type === 'ESTIMATED_DELIVERY') || {}).dateTime || '';
  return { status: map((t.latestStatusDetail || {}).code), eta, events };
}

/* ---------------- UPS: Tracking API (OAuth) ---------------- */
const UP = {};
async function ups(c, trk) {
  const host = c.sandbox ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com';
  if (!UP.at || UP.exp < Date.now() + 60000) {
    const t = await request('POST', host + '/security/v1/oauth/token', { form: { grant_type: 'client_credentials' },
      headers: { Authorization: 'Basic ' + Buffer.from(c.id + ':' + c.secret).toString('base64') } });
    if (t.status !== 200) throw new Error(`UPS login refused (${t.status}): ${clip(t.text, 200)}`);
    UP.at = t.json.access_token; UP.exp = Date.now() + (Number(t.json.expires_in) || 3600) * 1000;
  }
  const r = await request('GET', `${host}/api/track/v1/details/${encodeURIComponent(trk)}?locale=en_US`, {
    headers: { Authorization: 'Bearer ' + UP.at, transId: String(Date.now()), transactionSrc: 'ridhi-hub' } });
  if (r.status === 404) return { status: 'unknown', events: [], note: 'UPS does not know this number yet' };
  if (r.status >= 300) throw new Error(`UPS ${r.status}: ${clip(r.text, 200)}`);
  const p = (((((r.json || {}).trackResponse || {}).shipment || [])[0] || {}).package || [])[0] || {};
  const map = s => ({ D: 'delivered', O: 'out_for_delivery', I: 'in_transit', P: 'picked_up', M: 'label_created', X: 'delayed', RS: 'delayed' }[s && s.type] || 'unknown');
  const when = (d, t) => d ? Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${(t || '000000').slice(0, 2)}:${(t || '000000').slice(2, 4)}:00Z`) : NaN;
  const events = (p.activity || []).map(a => ({ at: when(a.date, a.time), status: map(a.status), place: [(a.location || {}).address && a.location.address.city, (a.location || {}).address && a.location.address.countryCode].filter(Boolean).join(', '), text: (a.status || {}).description || '' }));
  /* UPS lists the newest activity first; that is where the parcel is now. */
  return { status: events.length ? events[0].status : 'unknown', eta: ((p.deliveryDate || [])[0] || {}).date || '', events };
}

/** Track one parcel, or null when that carrier has no keys (then the simulator / fallbacks take over). */
async function track(carrierName, trk) {
  const c = config.carrier(carrierName);
  if (!c) return null;
  if (carrierName === 'DHL Express') return dhl(c, trk);
  if (carrierName === 'FedEx') return fedex(c, trk);
  if (carrierName === 'UPS') return ups(c, trk);
  return null;
}
/** A login check for the Setup page (DHL has no login; its key is checked on the first real number). */
async function check(name) {
  const c = config.carrier(name);
  if (!c) return { ok: false, mode: 'test' };
  if (name === 'DHL Express') return { ok: true, note: 'key filled — checked on the first real tracking number' };
  /* The check tracks one of FedEx's own test numbers, so it proves tracking works — not only the login. */
  if (name === 'FedEx') { FX.at = null; await fedex(c, '122816215025810').catch(e => { if (/login refused|refused tracking/.test(e.message)) throw e; }); return { ok: true, note: 'Login and tracking both work' }; }
  if (name === 'UPS') { UP.at = null; await ups(c, '1Z12345E0205271688').catch(e => { if (/login refused/.test(e.message)) throw e; }); return { ok: true }; }
  return { ok: false };
}

module.exports = { track, check };

});

HUBMOD("fedex-ship", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * FEDEX SHIPPING — create the shipment from the order: prices, label, tracking number, invoice, cancel.
 *
 * FedEx keeps this in a different project from tracking (config: carriers.fedexShip, not carriers.fedex).
 * In the sandbox every label says "TEST LABEL - DO NOT SHIP": no parcel, no charge. With sandbox false
 * it is a real shipment on the account, so actions.js only allows that for orders pulled from Shopify.
 *
 * What goes to FedEx comes from the order (receiver), from config (sender, GSTIN, IEC) and from the Ship
 * dialog (box weight and size, customs description, HS code and value per line — the same figures the
 * DHL CSB uses, remembered per SKU in db.csb.sku).
 * ===================================================================================== */
const fs = require('fs'), path = require('path');
const config = require('./config');
const { request, clip } = require('./util');
const csb = require('./csb');

const LABELS = path.join(__dirname, '..', 'labels');
const host = c => c.sandbox ? 'https://apis-sandbox.fedex.com' : 'https://apis.fedex.com';
const NAMES = { FEDEX_INTERNATIONAL_CONNECT_PLUS: 'International Connect Plus', INTERNATIONAL_ECONOMY: 'International Economy',
  FEDEX_INTERNATIONAL_PRIORITY: 'International Priority', FEDEX_INTERNATIONAL_PRIORITY_EXPRESS: 'International Priority Express', INTERNATIONAL_FIRST: 'International First' };
const r2 = n => Math.round(n * 100) / 100;
const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

let tok = { key: '', value: '', until: 0 };
async function token(c) {
  if (tok.key === c.id && Date.now() < tok.until) return tok.value;
  const t = await request('POST', host(c) + '/oauth/token', { form: { grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret } });
  if (t.status !== 200) throw new Error(`FedEx shipping login refused (${t.status}) — check carriers.fedexShip in config.local.json`);
  tok = { key: c.id, value: t.json.access_token, until: Date.now() + ((t.json.expires_in || 3600) - 120) * 1000 };
  return tok.value;
}
/* FedEx answers errors as { errors: [{ code, message }] }; show those words, not the raw JSON. */
function why(r) {
  const e = ((r.json || {}).errors || []).map(x => x.message || x.code).filter(Boolean);
  return e.length ? clip(e.join('; '), 400) : `HTTP ${r.status} ${clip(r.text, 300)}`;
}
async function call(c, method, p, body) {
  const r = await request(method, host(c) + p, { headers: { Authorization: 'Bearer ' + await token(c), 'X-locale': 'en_US', 'Content-Type': 'application/json' }, body, timeout: 45000 });
  if (r.status === 401) { tok.until = 0; }
  return r;
}

/* ---------------- what is sent ---------------- */
function sender(c) {
  const s = c.shipper || {}, test = c.sandbox;
  const need = ['person', 'phone', 'street', 'city', 'state', 'zip'].filter(k => !String(s[k] || '').trim());
  if (need.length && !test) throw new Error('Fill the sender in config.local.json → carriers.fedexShip.shipper: ' + need.join(', '));
  const tins = [{ number: csb.CO.gstin, tinType: 'BUSINESS_NATIONAL' }];
  if (String(s.iec || '').trim()) tins.push({ number: String(s.iec).trim(), tinType: 'BUSINESS_UNION' });
  return { contact: { personName: cut(s.person || 'Ridhi Test', 35), companyName: cut(s.company || 'Ridhi Home and Living', 35), phoneNumber: cut(s.phone || '9876543210', 15) },
    address: { streetLines: [cut(s.street || '1 Test Road, Sanganer', 35)], city: s.city || 'Jaipur', stateOrProvinceCode: s.state || 'RJ', postalCode: s.zip || '302029', countryCode: 'IN' }, tins };
}
function receiver(o) {
  const a = o.addr || {}, code = String(a.country || '').toUpperCase().slice(0, 2);
  const phone = String(a.phone || o.cust.ph || '').replace(/[^0-9+]/g, '');
  const miss = [!o.cust.n && 'name', !a.a1 && 'street', !a.city && 'city', !code && 'country', !a.zip && 'postcode', !phone && 'phone'].filter(Boolean);
  if (miss.length) throw new Error(`#${o.no} is missing the customer's ${miss.join(', ')} — FedEx needs it`);
  const lines = [a.a1, a.a2].filter(Boolean).map(x => cut(x, 35));
  const address = { streetLines: lines, city: cut(a.city, 35), postalCode: String(a.zip).trim(), countryCode: code, residential: true };
  if (a.state) address.stateOrProvinceCode = String(a.state).trim().slice(0, 2);
  return { contact: { personName: cut(o.cust.n, 35), phoneNumber: phone.slice(-15), emailAddress: o.cust.e || undefined }, address };
}
/**
 * The lines going, with what customs needs. `lines` (a.customs) = [{ i, desc, hs, rate }] from the dialog; anything left
 * out comes from what was remembered for that SKU, then the Shopify title and price.
 */
function goods(db, o, items, lines, box, cur) {
  const mem = csb.state(db).sku, by = {};
  (lines || []).forEach(l => { by[l.i] = l; });
  const units = items.reduce((n, i) => n + o.items[i].q, 0);
  let kgLeft = r2(box.kg);
  return items.map((i, n) => {
    const it = o.items[i], l = by[i] || {}, m = mem[it.sku] || {};
    const desc = cut(l.desc || m.desc || [it.t, it.v].filter(Boolean).join(' '), 450);
    const hs = String(l.hs || m.hs || csb.CO.hsExport).replace(/\D/g, '');
    const rate = r2(Number(l.rate != null && l.rate !== '' ? l.rate : it.price) || 0);
    if (hs.length !== 8) throw new Error(`${it.sku || it.t}: the HS code must be 8 digits`);
    if (!(rate > 0)) throw new Error(`${it.sku || it.t}: the customs value per unit must be more than 0`);
    const kg = n === items.length - 1 ? Math.max(0.01, r2(kgLeft)) : Math.max(0.01, r2(box.kg * it.q / units));
    kgLeft = r2(kgLeft - kg);
    return { i, sku: it.sku, desc, hs, rate, q: it.q, kg,
      fx: { description: desc, countryOfManufacture: 'IN', quantity: it.q, quantityUnits: 'PCS', unitPrice: { amount: rate, currency: cur },
        customsValue: { amount: r2(rate * it.q), currency: cur }, weight: { units: 'KG', value: kg }, harmonizedCode: hs } };
  });
}
function checkBox(box) {
  const b = { kg: Number(box && box.kg), l: Math.round(Number(box && box.l) || 0), w: Math.round(Number(box && box.w) || 0), h: Math.round(Number(box && box.h) || 0) };
  if (!(b.kg > 0)) throw new Error('Weigh the box — FedEx needs the weight in kg');
  if (!(b.l > 0 && b.w > 0 && b.h > 0)) throw new Error('Type the box size (L × W × H in cm)');
  return b;
}
function base(c, o, g, box, cur, refs) {
  const acct = { value: c.account }, payer = { paymentType: 'SENDER', payor: { responsibleParty: { accountNumber: acct } } };
  return {
    shipper: sender(c), recipients: [receiver(o)], pickupType: 'USE_SCHEDULED_PICKUP', packagingType: 'YOUR_PACKAGING',
    customsClearanceDetail: { dutiesPayment: payer, isDocumentOnly: false,
      commercialInvoice: { shipmentPurpose: 'SOLD', termsOfSale: csb.CO.terms, customerReferences: refs.inv ? [{ customerReferenceType: 'INVOICE_NUMBER', value: refs.inv }] : undefined },
      commodities: g.map(x => x.fx), totalCustomsValue: { amount: r2(g.reduce((s, x) => s + x.rate * x.q, 0)), currency: cur } },
    requestedPackageLineItems: [{ weight: { units: 'KG', value: r2(box.kg) }, dimensions: { length: box.l, width: box.w, height: box.h, units: 'CM' },
      customerReferences: [{ customerReferenceType: 'CUSTOMER_REFERENCE', value: cut('#' + o.no, 30) }].concat(refs.inv ? [{ customerReferenceType: 'INVOICE_NUMBER', value: cut(refs.inv, 30) }] : []) }],
    payer,
  };
}

/* ---------------- prices ---------------- */
async function rates(db, o, items, a) {
  const c = config.fedexShip(); if (!c) throw new Error('FedEx shipping is not set up — fill carriers.fedexShip in config.local.json');
  const box = checkBox(a.box), cur = a.cur || 'USD', g = goods(db, o, items, a.customs, box, cur), b = base(c, o, g, box, cur, {});
  const r = await call(c, 'POST', '/rate/v1/rates/quotes', { accountNumber: { value: c.account }, rateRequestControlParameters: { returnTransitTimes: true },
    requestedShipment: { shipper: { address: b.shipper.address }, recipient: { address: b.recipients[0].address }, pickupType: b.pickupType,
      rateRequestType: ['ACCOUNT', 'LIST'], customsClearanceDetail: b.customsClearanceDetail, requestedPackageLineItems: b.requestedPackageLineItems } });
  if (r.status !== 200) throw new Error('FedEx prices: ' + why(r));
  return ((r.json.output || {}).rateReplyDetails || []).map(x => {
    const d = (x.ratedShipmentDetails || []).find(y => y.rateType === 'ACCOUNT') || (x.ratedShipmentDetails || [])[0] || {};
    const by = (x.commit && x.commit.dateDetail && x.commit.dateDetail.dayFormat) || (x.operationalDetail && (x.operationalDetail.deliveryDate || x.operationalDetail.transitTime)) || '';
    return { type: x.serviceType, name: NAMES[x.serviceType] || x.serviceName || x.serviceType, amount: d.totalNetCharge, currency: d.currency || '', by: String(by).replace('T', ' ').slice(0, 16) };
  }).sort((p, q) => (p.amount || 0) - (q.amount || 0));
}

/* ---------------- create ---------------- */
function saveDoc(trk, kind, b64) {
  fs.mkdirSync(LABELS, { recursive: true });
  const name = `${String(trk).replace(/\W/g, '')}-${kind}.pdf`;
  fs.writeFileSync(path.join(LABELS, name), Buffer.from(b64, 'base64'));
  return 'labels/' + name;
}
/**
 * Books it with FedEx. Returns { trk, service, label, invoice, transactionId, sandbox, etd }.
 * Asks for FedEx's electronic invoice (ETD) and a printable commercial invoice; if FedEx will not do ETD
 * for this account or lane, it books again without it and says so.
 */
async function create(db, o, items, a) {
  const c = config.fedexShip(); if (!c) throw new Error('FedEx shipping is not set up — fill carriers.fedexShip in config.local.json');
  const box = checkBox(a.box), cur = a.cur || 'USD', g = goods(db, o, items, a.customs, box, cur);
  const b = base(c, o, g, box, cur, { inv: a.inv });
  const payer = b.payer; delete b.payer;
  const shipment = (etd) => ({ accountNumber: { value: c.account }, labelResponseOptions: 'LABEL', requestedShipment: Object.assign(b, {
    shipDatestamp: csb.todayIST(), serviceType: a.service || 'FEDEX_INTERNATIONAL_PRIORITY', shippingChargesPayment: payer,
    labelSpecification: { imageType: 'PDF', labelStockType: 'PAPER_85X11_TOP_HALF_LABEL' },
    shippingDocumentSpecification: { shippingDocumentTypes: ['COMMERCIAL_INVOICE'], commercialInvoiceDetail: { documentFormat: { stockType: 'PAPER_LETTER', docType: 'PDF' } } },
    shipmentSpecialServices: etd ? { specialServiceTypes: ['ELECTRONIC_TRADE_DOCUMENTS'], etdDetail: { requestedDocumentTypes: ['COMMERCIAL_INVOICE'] } } : undefined }) });
  let etd = true, r = await call(c, 'POST', '/ship/v1/shipments', shipment(true));
  /* FedEx refusing the electronic invoice — by name, or as its catch-all "unexpected problem" — books it without. */
  if (r.status !== 200 && (/ETD|ELECTRONIC|TRADE/i.test(why(r)) || r.status >= 500)) { etd = false; r = await call(c, 'POST', '/ship/v1/shipments', shipment(false)); }
  if (r.status !== 200) throw new Error('FedEx did not book it: ' + why(r));
  const ts = ((r.json.output || {}).transactionShipments || [])[0] || {};
  const trk = ts.masterTrackingNumber || (((ts.pieceResponses || [])[0] || {}).trackingNumber);
  if (!trk) throw new Error('FedEx answered without a tracking number: ' + clip(r.text, 300));
  const lab = (((ts.pieceResponses || [])[0] || {}).packageDocuments || []).find(d => d.encodedLabel);
  const inv = (ts.shipmentDocuments || []).find(d => /INVOICE/i.test(d.contentType || d.docType || '') && d.encodedLabel);
  const alerts = ((r.json.output || {}).alerts || ts.alerts || []).map(x => x.message).filter(Boolean);
  return { trk, service: ts.serviceType || a.service, label: lab ? saveDoc(trk, 'label', lab.encodedLabel) : '', invoice: inv ? saveDoc(trk, 'invoice', inv.encodedLabel) : '',
    transactionId: r.json.transactionId || '', sandbox: c.sandbox, etd, alerts: alerts.slice(0, 3),
    lines: g.map(x => ({ i: x.i, sku: x.sku, desc: x.desc, hs: x.hs, rate: x.rate, kg: x.kg })), box, cur, at: Date.now() };
}

/* ---------------- cancel (before FedEx has it) ---------------- */
async function cancel(trk) {
  const c = config.fedexShip(); if (!c) throw new Error('FedEx shipping is not set up');
  const r = await call(c, 'PUT', '/ship/v1/shipments/cancel', { accountNumber: { value: c.account }, trackingNumber: String(trk), deletionControl: 'DELETE_ALL_PACKAGES', emailShipment: false, senderCountryCode: 'IN' });
  if (r.status !== 200) throw new Error('FedEx did not cancel it: ' + why(r));
  const out = r.json.output || {};
  if (out.cancelledShipment === false) throw new Error('FedEx says it cannot be cancelled any more' + (out.message ? ': ' + out.message : ''));
  return true;
}

async function check() {
  const c = config.fedexShip(); if (!c) throw new Error('not set up');
  tok.until = 0; await token(c);
  return `Login works · ${c.sandbox ? 'SANDBOX — test labels only, no charge' : 'PRODUCTION — real shipments on account ending ' + c.account.slice(-3)}`;
}

module.exports = { rates, create, cancel, check, LABELS, NAMES };

});

HUBMOD("actions", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * WHAT PEOPLE DO — every button on the screens ends up in one of these.
 * Each one: checks the request, changes the order, writes the Activity line, and queues what
 * Shopify must hear. Amazon MCF is called here (for real only when allowed; see amazon.js).
 * A refusal throws an Error whose message is shown to the person as it is.
 * ===================================================================================== */
const J = require('./journey');
const queue = require('./queue');
const config = require('./config');
const amazon = require('./amazon');
const shopify = require('./shopify');
const fedex = require('./fedex-ship');
const csb = require('./csb');
const shopTrack = require('./shop-track');

const H = 3600000;
/* Shopify names Ridhi's orders "# RBP7518" — the order number is "RBP7518", with no "#" and no space, so it reads
 * the same in the carriers' files and matches when tracking numbers are pasted back. */
const cleanNo = s => String(s || '').replace(/^\s*#?\s*/, '').trim();
function find(db, no) { const o = db.orders.find(x => x.no === no); if (!o) throw new Error('No order ' + no); return o; }
function note(o, who, m, t) { o.tl.push({ t: t || Date.now(), who, m }); }
function advance(pk, n, place, at) { for (let i = 0; i < (n || 1); i++) { pk.ts[pk.pos] = (at || Date.now()) + i; if (place) pk.ev[pk.pos] = place; pk.pos++; } }
const itemsText = (o, pk) => pk.items.map(i => o.items[i].t).join(' + ');
const skus = (o, items) => items.map(i => o.items[i].sku).join(', ');
const lineGids = (o, items) => items.map(i => o.items[i].lid).filter(Boolean);

function newPart(o, src, items) {
  const pk = { src, items: items.slice(), pos: src === 'make' ? 0 : 1, route: null, car: '', trk: [], eta: '', late: false, ts: [], ev: {}, rep: false, block: null,
    req: Date.now(), rush: false, mcfId: '', mcfReal: false, fulfilId: '', fulfilQueued: false, id: o.no + '-' + (o.pkgs.length + 1) };
  if (src !== 'make') pk.ts[0] = Date.now();
  o.pkgs.push(pk);
  items.forEach(i => { o.items[i].pk = o.pkgs.length - 1; });
  return pk;
}
function checkLines(o, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Pick at least one line.');
  lines.forEach(i => { if (!o.items[i]) throw new Error('No such line.'); if (o.items[i].pk != null) throw new Error(o.items[i].t + ' has already been sent.'); });
}
/* Before anything is done to a real order, ask Shopify how it is NOW. */
async function freshCheck(o) {
  if (o.source !== 'shopify' || !config.shopify(o.store)) return;
  const f = await shopify.freshOrder(o.store, o.gid);
  if (f.cancelledAt) throw new Error(`#${o.no} was cancelled in Shopify — nothing was done.`);
}

/* ---------------- deciding each line ---------------- */
async function sendMcf(db, o, lines, speed, isRep) {
  if (!isRep) lines.forEach(i => { if ((o.items[i].fba || 0) < o.items[i].q) throw new Error(`FBA does not have ${o.items[i].q} of ${o.items[i].t}.`); });
  await freshCheck(o);
  const n = o.pkgs.length + 1, id = amazon.mcfId(o.no, n);
  const real = o.source === 'shopify' && config.realMcf() && !!config.amazon(o.store);
  if (real) await amazon.create(o.store, o, lines.map(i => ({ sku: o.items[i].sku, q: o.items[i].q })), speed, id);
  const pk = isRep ? null : newPart(o, 'fba', lines);
  return { pk, id, real };
}
async function decide(db, a) {
  const o = find(db, a.no);
  checkLines(o, a.lines);
  if (a.route === 'mcf') {
    const r = await sendMcf(db, o, a.lines, a.speed);
    const pk = r.pk; pk.route = 'mcf'; pk.mcfId = r.id; pk.mcfReal = r.real; pk.eta = a.speed === 'Expedited' ? 'in 2–3 days' : a.speed === 'Priority' ? 'in 1–2 days' : 'in 4–5 days';
    advance(pk, 1, 'Amazon FBA');
    note(o, 'APP', `Sent by Amazon MCF (${r.id}) · ${a.lines.length} line(s) · ${a.speed || 'Standard'}${r.real ? '' : ' · SIMULATED, no real shipment'}`);
    queue.enqueue(db, o, 'mcf', { part: o.pkgs.indexOf(pk), lines: lineGids(o, a.lines), note: `MCF done for ${skus(o, a.lines)} (${r.id})` },
      `Split #${o.no}: ${skus(o, a.lines)} on their own, mark them in progress, add note "MCF done for ${skus(o, a.lines)}", tag MCF`);
    return `Sent by MCF${r.real ? '' : ' (simulated — no real Amazon order)'}`;
  }
  if (a.route === 'make') {
    await freshCheck(o);
    const pk = newPart(o, 'make', a.lines); pk.rush = !!a.rush;
    note(o, 'APP', `Production requested${a.rush ? ' (rush)' : ''}: ${a.lines.map(i => o.items[i].t).join(', ')} · SHP-${o.no}`);
    if (a.note) note(o, 'APP', 'Note for the factory: ' + String(a.note).slice(0, 300));
    queue.enqueue(db, o, 'tags', { add: ['In production'] }, `Tag #${o.no} "In production"`);
    return 'Production requested';
  }
  if (a.route === 'india') {
    a.lines.forEach(i => { if ((o.items[i].india || 0) < o.items[i].q) throw new Error(`India does not have ${o.items[i].q} of ${o.items[i].t}.`); });
    if (!J.CARRIERS.includes(a.car)) throw new Error('Pick the carrier.');
    if (!String(a.trk || '').trim()) throw new Error('Type the tracking number.');
    await freshCheck(o);
    const pk = newPart(o, 'india', a.lines);
    note(o, 'APP', `Picked from India stock: ${a.lines.map(i => o.items[i].t).join(', ')}`);
    return shipPart(db, o, pk, a.car, a.trk, a.notify);
  }
  throw new Error('Unknown route.');
}

/* The order's plan, accepted in one go (Ravi, 26 Oct: "the order can divide itself into sections … and we accept it").
 * The page suggests each line's section from stock (FBA → MCF, else India stock → India, else Production); here:
 * MCF lines go to Amazon (first: the one step that can be refused), production lines are requested, and India lines are
 * picked — a part "ready to ship" that waits in Bulk order / Dispatch for its DHL or FedEx box. */
async function plan(db, a) {
  const o = find(db, a.no), pick = k => (Array.isArray(a[k]) ? a[k] : []).map(Number);
  const mcf = pick('mcf'), make = pick('make'), india = pick('india'), all = mcf.concat(make, india);
  checkLines(o, all);
  if (new Set(all).size !== all.length) throw new Error('A line is in two sections.');
  india.forEach(i => { if ((o.items[i].india || 0) < o.items[i].q) throw new Error(`India does not have ${o.items[i].q} of ${o.items[i].t}.`); });
  const done = [];
  if (mcf.length) done.push(await decide(db, { no: o.no, route: 'mcf', lines: mcf, speed: a.speed || 'Standard' }));
  if (make.length) done.push(await decide(db, { no: o.no, route: 'make', lines: make, rush: !!a.rush, note: a.note }));
  if (india.length) {
    if (!mcf.length && !make.length) await freshCheck(o);
    newPart(o, 'india', india);
    note(o, 'APP', `Picked from India stock: ${india.map(i => o.items[i].t).join(', ')} — waiting in Bulk order for its box`);
    done.push(`${india.length} from India stock, ready to ship`);
  }
  return done.join(' · ');
}

/* Settings kept with the hub's data. autoMcf (off unless switched on, on the order page's MCF card): when a NEW order comes
 * in, the items Amazon FBA has go to MCF by themselves, at standard speed. Orders already in the hub are never touched. */
function prefs(db, a) {
  db.prefs = Object.assign({}, db.prefs, { autoMcf: a.autoMcf === true });
  return db.prefs.autoMcf ? 'Auto-send to MCF is on for new orders' : 'Auto-send to MCF is off';
}
async function autoRoute(db, o) {
  if (!(db.prefs && db.prefs.autoMcf)) return;
  const lines = J.undecided(o).filter(i => (o.items[i].fba || 0) >= o.items[i].q);
  if (!lines.length) return;
  try { await decide(db, { no: o.no, route: 'mcf', lines, speed: 'Standard' }); note(o, 'APP', 'Auto-sent to MCF: the items Amazon FBA has'); }
  catch (e) { note(o, 'APP', 'Auto-send to MCF did not go: ' + e.message); }
}

/* ---------------- production ---------------- */
function stage(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part];
  if (!pk || pk.src !== 'make' || pk.pos >= J.prodLen(pk)) throw new Error('This part is not in production.');
  const st = J.STAGES[pk.pos]; pk.block = null;
  advance(pk, 1, 'Ridhi factory, Jaipur');
  note(o, 'FACTORY', `${itemsText(o, pk)}: ${st === 'Requested' ? 'production started' : st + ' done'}${pk.pos === J.prodLen(pk) ? ' — ready to ship' : ''}`);
  if (pk.pos === J.prodLen(pk)) queue.enqueue(db, o, 'tags', { remove: ['In production'], add: ['Ready to ship'] }, `Tag #${o.no}: "In production" → "Ready to ship"`);
  return pk.pos === J.prodLen(pk) ? 'Made — ready to ship' : 'Now in ' + J.STAGES[pk.pos];
}
function block(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part];
  if (!pk || J.phaseOf(pk) !== 0) throw new Error('Only a part in production can be blocked.');
  if (!J.CAUSES.includes(a.why)) throw new Error('Pick a reason.');
  pk.block = { why: a.why, at: Date.now() };
  note(o, 'BLOCKED', `${itemsText(o, pk)} held at ${J.STAGES[pk.pos]}: ${a.why}`);
  return 'Marked blocked';
}
function unblock(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part];
  if (!pk || !pk.block) throw new Error('This part is not blocked.');
  note(o, 'FACTORY', `${itemsText(o, pk)}: problem cleared (${pk.block.why})`); pk.block = null;
  return 'Problem cleared';
}

/* ---------------- shipping by courier ---------------- */
function shipPart(db, o, pk, car, trk, notify) {
  if (!J.CARRIERS.includes(car)) throw new Error('Pick the carrier.');
  trk = String(trk || '').trim(); if (!trk) throw new Error('Type the tracking number.');
  pk.route = 'courier'; pk.car = car; pk.trk = [trk]; pk.eta = 'in 5–7 days';
  advance(pk, 2, 'Ridhi warehouse, New Delhi');
  pk.fulfilQueued = true;
  note(o, 'APP', `Packed and booked with ${car} · ${trk}`);
  queue.enqueue(db, o, 'fulfil', { part: o.pkgs.indexOf(pk), lines: lineGids(o, pk.items), company: car === 'DHL Express' ? 'DHL Express' : car, numbers: [trk], notify: notify !== false },
    `Mark ${skus(o, pk.items)} fulfilled with ${car} ${trk}${notify !== false ? ', email the customer' : ''}`);
  return `Shipped with ${car}`;
}
async function ship(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part];
  if (!pk || J.actionOf(pk) == null || J.actionOf(pk).k !== 'ship') throw new Error('This part is not ready to ship.');
  await freshCheck(o);
  return shipPart(db, o, pk, a.car, a.trk, a.notify);
}

/* ---------------- FedEx: create the shipment from the order ----------------
 * `lines` = India lines not decided yet (they become a part here), or `part` = a part that is ready to ship
 * (made in production, or India stock picked earlier). Either way FedEx gives back the tracking number and
 * the label, and from there it is the same as typing the number in: fulfil in Shopify, then tracking. */
function fedexItems(o, a) {
  if (a.part != null) {
    const pk = o.pkgs[a.part];
    if (!pk || J.actionOf(pk) == null || J.actionOf(pk).k !== 'ship') throw new Error('This part is not ready to ship.');
    return { pk, items: pk.items };
  }
  checkLines(o, a.lines);
  a.lines.forEach(i => { if ((o.items[i].india || 0) < o.items[i].q) throw new Error(`India does not have ${o.items[i].q} of ${o.items[i].t}.`); });
  return { pk: null, items: a.lines };
}
async function fedexRates(db, a) {
  const o = find(db, a.no);
  return fedex.rates(db, o, fedexItems(o, a).items, a);
}
async function fedexShip(db, a) {
  const o = find(db, a.no), c = config.fedexShip();
  if (!c) throw new Error('FedEx shipping is not set up — fill carriers.fedexShip in config.local.json');
  if (!c.sandbox && o.source !== 'shopify') throw new Error('Real FedEx shipments are only made for orders pulled from Shopify — this is a temp test order.');
  const { pk: ready, items } = fedexItems(o, a);
  await freshCheck(o);
  /* GST invoice numbers come from the same series as the DHL CSB — but only a real shipment uses one up. */
  const st = csb.state(db);
  let inv = String(a.inv || '').trim();
  if (!inv && !c.sandbox) { if (!st.nextInv) throw new Error('Type the GST invoice no, or set the next number on the DHL CSB tab.'); inv = st.nextInv; }
  if (!inv) inv = 'TEST-' + o.no;
  const r = await fedex.create(db, o, items, Object.assign({}, a, { inv }));
  if (!c.sandbox && inv === st.nextInv) st.nextInv = csb.nextInv(inv);
  r.lines.forEach(l => { if (!l.sku) return; const m = st.sku[l.sku] || (st.sku[l.sku] = {}); m.desc = l.desc; m.hs = l.hs; });
  let pk = ready;
  if (!pk) { pk = newPart(o, 'india', items); note(o, 'APP', `Picked from India stock: ${items.map(i => o.items[i].t).join(', ')}`); }
  const msg = shipPart(db, o, pk, 'FedEx', r.trk, a.notify);
  pk.fedex = Object.assign(r, { inv });
  note(o, 'APP', `FedEx shipment created · ${fedex.NAMES[r.service] || r.service} · ${r.trk} · GST invoice ${inv}${r.sandbox ? ' · SANDBOX test label, not a real parcel' : ''}${r.etd ? '' : ' · FedEx did not take the electronic invoice: print the invoice and put it in the pouch'}`);
  return `${msg} · FedEx ${r.trk}${r.sandbox ? ' (sandbox test label)' : ''}`;
}
async function fedexCancel(db, a) {
  const o = find(db, a.no), n = +a.part, pk = o.pkgs[n];
  if (!pk || !pk.fedex) throw new Error('This part has no FedEx shipment made by the hub.');
  if (J.off(pk) > 2) throw new Error('FedEx already has the parcel — it can no longer be cancelled from here.');
  await fedex.cancel(pk.fedex.trk);
  const trk = pk.fedex.trk;
  /* Shopify changes not sent yet are dropped; one already sent is taken back with its own change. */
  db.queue.forEach(q => { if (q.orderNo === o.no && q.data && q.data.part === n && ['fulfil', 'event'].includes(q.kind) && ['waiting', 'held', 'test'].includes(q.status)) { q.status = 'discarded'; q.last = 'FedEx shipment cancelled'; } });
  if (pk.fulfilId) { queue.enqueue(db, o, 'unfulfil', { part: n, fulfilId: pk.fulfilId }, `Cancel the fulfilment of ${skus(o, pk.items)} (FedEx ${trk} cancelled)`); pk.fulfilId = ''; }
  /* Back to "ready to ship", as it was before the label. */
  for (let i = 0; i < 2; i++) { pk.pos--; delete pk.ts[pk.pos]; delete pk.ev[pk.pos]; }
  pk.route = null; pk.car = ''; pk.trk = []; pk.eta = ''; pk.late = false; pk.fulfilQueued = false;
  (pk.cancelled = pk.cancelled || []).push(Object.assign({}, pk.fedex, { cancelledAt: Date.now() })); pk.fedex = null;
  note(o, 'APP', `FedEx shipment ${trk} cancelled — the part is ready to ship again`);
  return `FedEx ${trk} cancelled`;
}

/* ---------------- dispatch: files for DHL and FedEx, then their tracking numbers — no carrier API ----------------
 * Make files → each shipment's lines are booked ("Packed · waiting for the tracking number"): India-stock lines become
 * a part, and when only some lines of a ready part go, that part is split so the rest stays behind. After the upload,
 * each tracking number typed in (or pasted as "order number  tracking number" lines) ships its part: Shopify is told
 * (lines fulfilled with the carrier and number, customer e-mailed) and from then on Shopify follows the parcel. */
function splitPart(o, pk, sel) {
  const np = JSON.parse(JSON.stringify(pk));
  np.items = sel.slice(); np.id = o.no + '-' + (o.pkgs.length + 1); np.fedex = null; np.booked = null;
  pk.items = pk.items.filter(i => !sel.includes(i));
  o.pkgs.push(np); sel.forEach(i => { o.items[i].pk = o.pkgs.length - 1; });
  note(o, 'APP', `Shipping now: ${sel.map(i => o.items[i].t).join(', ')} · staying for later: ${pk.items.map(i => o.items[i].t).join(', ')}`);
  return np;
}
async function dispatchMake(db, draft) {
  csb.mustBeReady(db, draft);
  const st = csb.state(db);
  const ships = draft.ships || [];
  if (ships.some(s => !String(s.inv || '').trim() && (db.orders.find(o => o.no === s.no) || {}).source !== 'test') && !String(draft.nextInv || st.nextInv || '').trim()) throw new Error('Set the next GST invoice number at the top (or type one on each shipment) — every file needs one.');
  for (const sd of ships) await freshCheck(find(db, sd.no));
  /* Nothing has changed yet: everything that can refuse has been asked. Now book the parts. */
  const parts = ships.map(sd => {
    const o = find(db, sd.no), on = (sd.lines || []).filter(l => l.on !== false).map(l => l.i), out = [];
    /* Sorted before anything changes: lines already in a part, and lines still to be picked from India stock. */
    const byPart = {}, india = on.filter(i => o.items[i].pk == null);
    on.filter(i => o.items[i].pk != null).forEach(i => { (byPart[o.items[i].pk] = byPart[o.items[i].pk] || []).push(i); });
    Object.keys(byPart).forEach(k => { const pk = o.pkgs[k], sel = byPart[k]; out.push(sel.length === pk.items.length ? pk : splitPart(o, pk, sel)); });
    if (india.length) { out.push(newPart(o, 'india', india)); note(o, 'APP', `Picked from India stock: ${india.map(i => o.items[i].t).join(', ')}`); }
    out.forEach(pk => { pk.booked = { id: '', car: sd.car, at: Date.now() }; advance(pk, 1, 'Ridhi, Jaipur'); });
    return out;
  });
  const r = csb.make(db, draft, parts.map(l => l.map(pk => pk.id)));
  parts.forEach(l => l.forEach(pk => { pk.booked.id = r.batch.id; }));
  return r;
}
function awbOne(db, b, s, trk) {
  const o = find(db, s.no);
  const going = s.parts.map(id => o.pkgs.find(p => p.id === id)).filter(pk => pk && !pk.route);
  going.forEach(pk => {
    pk.route = 'courier'; pk.car = s.car; pk.trk = [trk]; pk.eta = '';
    while (J.off(pk) < 2) advance(pk, 1, '');
    pk.fulfilQueued = true;
    /* The carrier name exactly as Shopify knows it, so Shopify follows the parcel itself. */
    queue.enqueue(db, o, 'fulfil', { part: o.pkgs.indexOf(pk), lines: lineGids(o, pk.items), company: s.car, numbers: [trk], notify: true },
      `Mark ${skus(o, pk.items)} fulfilled with ${s.car} ${trk}, email the customer`);
  });
  s.awb = trk; s.awbAt = Date.now();
  note(o, 'APP', `${s.car} tracking number ${trk} (${b.id}) · ${going.length} part(s) shipped`);
}
const AWB = /^[A-Za-z0-9]{8,30}$/;
function dispatchAwb(db, a) {
  const st = csb.state(db);
  if (a.text != null) {
    /* Pasted lines: "#8020  4417802211", "8020,4417802211", "T4880 4417800001" … the order number, then the tracking number. */
    const done = [], miss = [];
    String(a.text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      const m = l.match(/^#?\s*([A-Za-z0-9-]+)[\s,;:|\t]+([A-Za-z0-9]+)\s*$/);
      if (!m || !AWB.test(m[2])) return miss.push(l);
      let hit = null;
      st.batches.forEach(b => b.ships.forEach(s => { if (!hit && !s.awb && (s.parts || []).length && cleanNo(s.no).toUpperCase() === cleanNo(m[1]).toUpperCase()) hit = { b, s }; }));
      if (!hit) return miss.push(l);
      awbOne(db, hit.b, hit.s, m[2]); done.push('#' + hit.s.no);
    });
    if (!done.length) throw new Error('No line matched an order waiting for its tracking number. Write each as: order number, then the tracking number.' + (miss.length ? ' Not used: ' + miss.slice(0, 3).join(' | ') : ''));
    return `${done.length} tracking number(s) saved (${done.join(', ')})${miss.length ? ` · ${miss.length} line(s) not used: ${miss.slice(0, 3).join(' | ')}` : ''}`;
  }
  const b = st.batches.find(x => x.id === a.id), s = b && b.ships.find(x => x.no === a.no);
  if (!s) throw new Error('That shipment is not in this file.');
  if (s.awb) throw new Error(`#${s.no} already has ${s.awb}.`);
  const trk = String(a.trk || '').trim().replace(/\s+/g, '');
  if (!AWB.test(trk)) throw new Error('A tracking number is 8 to 30 letters and digits.');
  awbOne(db, b, s, trk);
  return `#${s.no} shipped with ${s.car} ${trk}`;
}
/* Take a file back (it was not uploaded, or was made wrong): its parts go back to ready. Not once a tracking number is in. */
function dispatchForget(db, a) {
  const st = csb.state(db), b = st.batches.find(x => x.id === a.id);
  if (!b) throw new Error('No such file batch ' + a.id);
  const shipped = b.ships.filter(s => s.awb);
  if (shipped.length) throw new Error(`${shipped.map(s => '#' + s.no).join(', ')} already have tracking numbers — those are shipped, so this file cannot be taken back.`);
  b.ships.forEach(s => {
    const o = db.orders.find(x => x.no === s.no); if (!o) return;
    /* Back to "ready to ship" — every step since, undone (also a part an earlier version moved two steps). */
    (s.parts || []).forEach(id => { const pk = o.pkgs.find(p => p.id === id); if (pk && pk.booked && !pk.route) { while (J.off(pk) > 0) { pk.pos--; delete pk.ts[pk.pos]; delete pk.ev[pk.pos]; } pk.booked = null; } });
    note(o, 'APP', `${b.id} taken back — ready to ship again`);
  });
  /* The newest file gives its GST invoice numbers back when they were the last ones handed out, so the series has
   * no gap (a GST invoice series must run without holes). An older file's numbers stay used. */
  let back = '';
  if (st.batches[0] === b && b.ships.length) {
    let n = b.ships[0].inv; b.ships.forEach(s => { if (s.inv === n) n = csb.nextInv(n); else n = null; });
    if (n && n === st.nextInv) { st.nextInv = b.ships[0].inv; back = ` · invoice numbers ${b.ships[0].inv}–${b.ships[b.ships.length - 1].inv} given back`; }
  }
  st.batches = st.batches.filter(x => x !== b);
  return `${b.id} taken back — its orders are ready to ship again${back}`;
}
/* A step marked by hand (no carrier key, and Shopify is not following this parcel). */
function markStep(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part], to = Number(a.to);
  if (!pk || !pk.route) throw new Error('This part has not shipped.');
  if (!(to >= 3 && to <= 6) || to <= J.off(pk)) throw new Error('That step is already done.');
  const moved = require('./track').moveTo(db, o, pk, to, { place: String(a.place || '').slice(0, 60), fromShopify: pk.trackedBy === 'Shopify' });
  if (to === 4) pk.late = false;
  return `#${o.no}: ${J.statusOf(pk)}${moved > 1 ? ` (${moved} steps)` : ''}`;
}

/* ---------------- returns ---------------- */
function returnStart(db, a) {
  const o = find(db, a.no);
  if (!Array.isArray(a.items) || !a.items.length) throw new Error('Tick an item.');
  if (!['return', 'both', 'replace'].includes(a.what)) throw new Error('Say what the customer gets.');
  o.rets.push({ items: a.items, why: String(a.why || 'Other').slice(0, 60), what: a.what, pos: 0, car: '', trk: '', rep: null, at: Date.now() });
  note(o, 'APP', `Return started: ${a.items.map(i => o.items[i].t).join(', ')} · ${a.why}`);
  queue.enqueue(db, o, 'note', { line: `Return started: ${skus(o, a.items)} — ${a.why}` }, `Add note to #${o.no}: "Return started: ${skus(o, a.items)} — ${a.why}"`);
  return 'Return started';
}
async function returnStep(db, a) {
  const o = find(db, a.no), r = o.rets[a.ret];
  if (!r) throw new Error('No such return.');
  const want = J.retAction(r); if (!want || want.k !== a.kind) throw new Error('That is not the next step for this return.');
  if (a.kind === 'rtrk') {
    if (!String(a.trk || '').trim()) throw new Error('Type the return tracking number.');
    r.car = a.car || 'USPS'; r.trk = String(a.trk).trim(); r.pos = 1; note(o, 'APP', `Return on its way back · ${r.car} ${r.trk}`);
    queue.enqueue(db, o, 'note', { line: `Return on its way back: ${r.car} ${r.trk}` }, `Add note to #${o.no}: return tracking ${r.car} ${r.trk}`);
  }
  if (a.kind === 'rrecv') { r.pos = 2; note(o, 'WAREHOUSE', 'Return received at the USA warehouse'); }
  if (a.kind === 'rclose') { r.pos = 3; note(o, 'APP', 'Return closed'); queue.enqueue(db, o, 'note', { line: 'Return closed' }, `Add note to #${o.no}: "Return closed"`); }
  if (a.kind === 'rep') {
    const it = o.items[r.items[0]];
    let pk;
    if ((it.fba || 0) > 0) {
      const res = await sendMcf(db, o, r.items, 'Standard', true);
      pk = newPart(o, 'fba', []); pk.items = r.items.slice(); pk.route = 'mcf'; pk.mcfId = res.id; pk.mcfReal = res.real; pk.eta = 'in 4–5 days'; advance(pk, 1, 'Amazon FBA');
    } else { pk = newPart(o, 'make', []); pk.items = r.items.slice(); }
    pk.rep = true; r.rep = o.pkgs.indexOf(pk);
    note(o, 'APP', `Replacement for ${it.t}: ${pk.route === 'mcf' ? 'sent by MCF from FBA stock' : 'production requested'}`);
  }
  return 'Done';
}
function comment(db, a) {
  const o = find(db, a.no), t = String(a.text || '').trim().slice(0, 500);
  if (!t) throw new Error('Type the note.');
  note(o, 'YOU', t); return 'Note added';
}
/* The same note on every ticked order (Orders → tick → Add a note). It goes to Shopify too. */
function bulkNote(db, a) {
  const t = String(a.text || '').trim().slice(0, 500);
  if (!t) throw new Error('Type the note.');
  const list = (a.nos || []).map(no => find(db, no));
  list.forEach(o => { note(o, 'YOU', t); queue.enqueue(db, o, 'note', { line: t }, `Add note to #${o.no}: "${t}"`); });
  return `Note added to ${list.length} order(s)`;
}
/* A late parcel was chased with the carrier: kept on the order, so the row stops asking. */
function chase(db, a) {
  const o = find(db, a.no), pk = o.pkgs[a.part];
  if (!pk || !pk.route) throw new Error('This part has not shipped.');
  pk.chased = Date.now();
  const said = String(a.said || '').trim().slice(0, 300);
  note(o, 'YOU', `Chased ${J.carName(pk)} about ${pk.trk[0] || pk.mcfId || 'the parcel'}${said ? ': ' + said : ''}`);
  return `#${o.no} marked followed up`;
}

/* ---------------- Shopify: pull orders in, make a test order ---------------- */
async function importOrders(db) {
  let added = 0; const notes = [];
  for (const store of ['Ridhi', 'CPC']) {
    if (!config.shopify(store)) { notes.push(`${store}: not connected`); continue; }
    const list = await shopify.recentOrders(store, 14);
    for (const s of list) {
      if (db.orders.some(o => o.gid === s.id)) continue;
      const lines = s.lineItems.nodes.filter(l => (l.currentQuantity == null ? l.quantity : l.currentQuantity) > 0);
      if (!lines.length) continue;
      const a = s.shippingAddress || {}, stock = sku => db.stock.find(x => x.sku === sku) || {};
      const o = { no: cleanNo(s.name), store, at: Date.parse(s.createdAt), source: 'shopify', gid: s.id,
        /* No customer record: it needs read_customers, which the ERP's token does not have (Pricing-API stopped asking too). */
        cust: { n: a.name || 'Customer', e: s.email || '', ph: s.phone || a.phone || '', k: 1 },
        addr: { a1: a.address1 || '', a2: a.address2 || '', city: a.city || '', state: a.provinceCode || '', zip: a.zip || '', country: a.countryCodeV2 || '', phone: a.phone || '' },
        ship: Number(((s.totalShippingPriceSet || {}).shopMoney || {}).amount) || 0, note: s.note || '', pkgs: [], tl: [], rets: [],
        items: lines.map(l => ({ lid: l.id, t: l.title, v: l.variantTitle || '', sku: l.sku || '', price: Number(l.originalUnitPriceSet.shopMoney.amount) || 0,
          q: l.currentQuantity == null ? l.quantity : l.currentQuantity, fba: stock(l.sku).fba || 0, india: stock(l.sku).india || 0, pk: null })) };
      if (config.amazon(store)) {
        try { const f = await amazon.fbaStock(store, o.items.map(i => i.sku).filter(Boolean)); o.items.forEach(i => { if (f[i.sku] != null) i.fba = f[i.sku]; }); }
        catch (e) { notes.push(`${store}: FBA stock not read (${e.message})`); }
      }
      o.tl.push({ t: o.at, who: 'SHOPIFY', m: `Order placed · pulled from ${store} Shopify` });
      shippedInShopify(o, s, lines);
      db.orders.push(o); added++;
      await autoRoute(db, o);
    }
  }
  return `${added} new order(s) pulled from Shopify${notes.length ? ' · ' + notes.join(' · ') : ''}`;
}
/* The same pull, through the ERP's Pricing API instead of the hub's own Shopify tokens (Ravi, 26 Oct: "pricing api has
 * shopify access also … make this read that access"). The ERP page (shopify-hub-local.js) reads ?shopify=orders for both
 * stores with the signed-in user's access and hands the answer to this page; no key ever reaches the hub. Read only:
 * marking lines shipped still goes through the hub's queue (and its allowWrites switch).
 * `got` = { Ridhi: <Pricing API answer>, CPC: <…> } — each answer's orders as Shopify.gs shopifyOrders_ shapes them. */
async function importFromPricing(db, got) {
  let added = 0; const notes = [], since = Date.now() - 14 * 86400000;
  for (const store of ['Ridhi', 'CPC']) {
    const ans = got && got[store];
    if (!ans) { notes.push(`${store}: not read`); continue; }
    if (ans.error) { notes.push(`${store}: ${String(ans.error).slice(0, 120)}`); continue; }
    for (const s of Array.isArray(ans.orders) ? ans.orders : []) {
      if (!s || !/^\d+$/.test(String(s.id)) || s.gone || s.cancelledAt || String(s.ff).toLowerCase() === 'fulfilled') continue;
      const gid = 'gid://shopify/Order/' + s.id, at = Date.parse(s.at + 'T12:00:00Z');
      if (!(at >= since) || db.orders.some(o => o.gid === gid)) continue;
      /* What is left on each line after refunds and order edits (cq), and how much of it Shopify still has to ship (fq). */
      const lines = (s.items || []).map(l => Object.assign({}, l, { left: l.cq != null ? Number(l.cq) : Math.max(0, (Number(l.qty) || 0) - (Number(l.rq) || 0)) })).filter(l => l.left > 0);
      if (!lines.length) continue;
      const open = l => l.fq == null ? l.left : Math.min(l.left, Number(l.fq) || 0);
      if (lines.every(l => open(l) === 0)) continue;
      const a = s.ship || {}, stock = sku => db.stock.find(x => x.sku === sku) || {};
      const o = { no: cleanNo(s.no), store, at, source: 'shopify', gid, via: 'pricing-api',
        cust: { n: a.name || 'Customer', e: s.email || '', ph: a.phone || '', k: 1 },
        addr: { a1: a.a1 || '', a2: a.a2 || '', city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || '', phone: a.phone || '' },
        ship: 0, note: s.note || '', pkgs: [], tl: [], rets: [],
        items: lines.map(l => ({ lid: 'gid://shopify/LineItem/' + l.lid, t: l.name || l.sku || 'Item', v: l.variant || '', sku: String(l.sku || ''), price: Number(l.price) || 0,
          q: l.left, fba: stock(l.sku).fba || 0, india: stock(l.sku).india || 0, pk: null })) };
      if (config.amazon(store)) {
        try { const f = await amazon.fbaStock(store, o.items.map(i => i.sku).filter(Boolean)); o.items.forEach(i => { if (f[i.sku] != null) i.fba = f[i.sku]; }); }
        catch (e) { notes.push(`${store}: FBA stock not read (${e.message})`); }
      }
      o.tl.push({ t: o.at, who: 'SHOPIFY', m: `Order placed · pulled from ${store} Shopify (through the ERP's Pricing API)` });
      /* Lines already shipped in Shopify. This answer has the order's tracking numbers but not which parcel holds which
       * line, so they become one part; Shopify's own tracking of it is read later, as for any shipped part. */
      const shipped = lines.map((l, i) => open(l) === 0 ? i : -1).filter(i => i >= 0);
      if (shipped.length) {
        const pk = shopTrack.partFrom(o, { id: '', status: 'SUCCESS', displayStatus: '', createdAt: s.shippedAt ? s.shippedAt + 'T12:00:00Z' : '',
          trackingInfo: (s.trk || []).map(n => ({ company: s.trkCo || '', number: n })), events: { nodes: [] } }, shipped);
        o.pkgs.push(pk); shipped.forEach(i => { o.items[i].pk = o.pkgs.length - 1; });
        note(o, 'SHOPIFY', `Already shipped in Shopify: ${shipped.map(i => o.items[i].t).join(', ')} · ${pk.car} ${pk.trk.join(', ') || '(no tracking number)'}`, pk.req);
      }
      const part = lines.filter(l => open(l) > 0 && open(l) < l.left);
      if (part.length) note(o, 'SHOPIFY', `Shipped in part in Shopify: ${part.map(l => `${l.sku || l.name} (${open(l)} of ${l.left} still to ship)`).join(', ')}`);
      db.orders.push(o); added++;
      await autoRoute(db, o);
    }
    if (ans.more) notes.push(`${store}: more orders than one read — press Fetch again`);
  }
  return `${added} new order(s) pulled from Shopify through the ERP${notes.length ? ' · ' + notes.join(' · ') : ''}`;
}
/* Lines your team already shipped in Shopify become a part with Shopify's carrier, number and tracking, so the hub
 * shows them and never offers them for shipping again. A line shipped only in part stays open (Shopify still has
 * units left on it), with a note. */
function shippedInShopify(o, s, lines) {
  const at = gid => lines.findIndex(l => l.id === gid);
  (s.fulfillments || []).forEach(f => {
    if (/CANCEL/.test(f.displayStatus || '') || f.status === 'CANCELLED') return;
    const items = [...new Set(((f.fulfillmentLineItems || {}).nodes || []).map(n => at(n.lineItem.id)).filter(i => i >= 0 && o.items[i].pk == null && !(lines[i].unfulfilledQuantity > 0)))];
    if (!items.length) return;
    const pk = shopTrack.partFrom(o, f, items);
    o.pkgs.push(pk); items.forEach(i => { o.items[i].pk = o.pkgs.length - 1; });
    note(o, 'SHOPIFY', `Already shipped in Shopify: ${items.map(i => o.items[i].t).join(', ')} · ${pk.car} ${pk.trk.join(', ') || '(no tracking number)'}`, pk.req);
  });
  const part = lines.filter(l => l.unfulfilledQuantity > 0 && l.unfulfilledQuantity < (l.currentQuantity == null ? l.quantity : l.currentQuantity));
  if (part.length) note(o, 'SHOPIFY', `Shipped in part in Shopify: ${part.map(l => `${l.sku || l.title} (${l.unfulfilledQuantity} of ${l.currentQuantity} still to ship)`).join(', ')}`);
}
async function testOrder(db, a) {
  const store = a.store === 'CPC' ? 'CPC' : 'Ridhi';
  if (!config.shopify(store)) throw new Error(`Connect the ${store} Shopify store first (Setup → Connections).`);
  if (!config.shopifyWrites()) throw new Error('Sending to Shopify is switched off (shopify.allowWrites = false in config.local.json).');
  const ord = await shopify.createTestOrder(store, { email: 'hub-test@example.com',
    address: { firstName: 'Hub', lastName: 'Test', address1: '1802 Oakmont Dr', city: 'Austin', provinceCode: 'TX', zip: '78704', countryCode: 'US' },
    lines: [{ title: 'Kantha quilt, Queen — Indigo', sku: 'RH-KQ-Q-IND', price: 129 }, { title: 'Block-print throw — Rust', sku: 'RH-BT-RST', price: 40 }] });
  const msg = await importOrders(db);
  return `Test order ${ord.name} made in the ${store} store · ${msg}`;
}

/* ---------------- MCF fees for the Send dialog ---------------- */
async function mcfPreview(db, a) {
  const o = find(db, a.no);
  if (o.source === 'shopify' && config.amazon(o.store)) {
    const p = await amazon.preview(o.store, o, a.lines.map(i => ({ sku: o.items[i].sku, q: o.items[i].q })));
    return { real: true, options: p };
  }
  return { real: false, options: [{ speed: 'Standard', ok: true, fee: 8.40, by: '4–5 days' }, { speed: 'Expedited', ok: true, fee: 13.10, by: '2–3 days' }, { speed: 'Priority', ok: true, fee: 21.75, by: '1–2 days' }] };
}

module.exports = { cleanNo, decide, plan, prefs, stage, block, unblock, ship, fedexRates, fedexShip, fedexCancel, dispatchMake, dispatchAwb, dispatchForget, markStep, returnStart, returnStep, comment, bulkNote, chase, importOrders, importFromPricing, testOrder, mcfPreview, note, advance, find, H };

});

HUBMOD("track", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * TRACKING — what the 30-minute check does. For every part on the road it asks where it is:
 *   Amazon MCF  → SP-API (when the part is a real MCF order and Amazon is connected)
 *   DHL / FedEx / UPS → their tracking APIs (when that carrier has keys)
 *   then, for a real Shopify order → Shopify's own tracking of the parcel (no carrier key needed; shop-track.js)
 *   anything else → nothing, unless "Simulate" was pressed: then it moves one step, like a real update would.
 * The part moves forward only (never back), each step gets its time and place, and the Shopify
 * changes are queued: the fulfilment with every tracking number when Amazon ships, and the
 * in transit / out for delivery / delivered events.
 * ===================================================================================== */
const J = require('./journey');
const amazon = require('./amazon');
const carriers = require('./carriers');
const queue = require('./queue');
const config = require('./config');
const { note } = require('./actions');
const shopify = require('./shopify');
const shopTrack = require('./shop-track');

const SIM_PLACE = { mcf: ['Fort Worth, TX', 'Oklahoma City, OK'], 'DHL Express': ['New Delhi, India', 'Leipzig, Germany'], FedEx: ['New Delhi, India', 'Memphis, TN'], UPS: ['Mumbai, India', 'Louisville, KY'] };
const lineGids = (o, items) => items.map(i => o.items[i].lid).filter(Boolean);

/** Move a part forward to `target` (an off value), recording each step and queuing what Shopify must hear. */
function moveTo(db, o, pk, target, info) {
  info = info || {};
  /* A scan from before this part was handed over cannot be ours: a mistyped or reused number (or FedEx's sandbox,
   * which answers with scans from 2023). Those are left out; if they are all there is, the answer is not about
   * this parcel and nothing moves. */
  const shipped = pk.ts[J.prodLen(pk)] || pk.req || 0;
  const evs = (info.events || []).filter(e => e && e.at && !isNaN(e.at) && e.at >= shipped - J.DAY).sort((a, b) => b.at - a.at);
  if ((info.events || []).length && !evs.length) { pk.checkedAt = Date.now(); return 0; }
  let moved = 0;
  while (J.off(pk) < target && pk.pos < J.total(pk)) {
    const x = J.off(pk) + 1;                                        // the step being reached
    const ev = evs.find(e => (J.STATUS_OFF[e.status] || 0) === x) || {};
    pk.ts[pk.pos] = ev.at && !isNaN(ev.at) ? ev.at : Date.now() + moved;
    pk.ev[pk.pos] = ev.place || info.place || '';
    pk.pos++; moved++;
    const name = J.steps(pk).flat()[pk.pos - 1];
    note(o, J.isMcf(pk) ? 'AMAZON' : 'CARRIER', `${J.carName(pk)}: ${name}${pk.ev[pk.pos - 1] ? ' · ' + pk.ev[pk.pos - 1] : ''}`, pk.ts[pk.pos - 1]);
    /* Amazon has shipped: Shopify gets the fulfilment with EVERY tracking number. */
    if (J.isMcf(pk) && x === 3 && !pk.fulfilQueued) {
      pk.fulfilQueued = true;
      /* "Amazon Logistics US", exactly: Shopify tracks parcels under that name and not under "Amazon Logistics" (seen on 24 Oct). */
      queue.enqueue(db, o, 'fulfil', { part: o.pkgs.indexOf(pk), lines: lineGids(o, pk.items), company: 'Amazon Logistics US', numbers: pk.trk.slice(), notify: true },
        `Mark ${pk.items.map(i => o.items[i].sku).join(', ')} fulfilled with ${pk.trk.length} Amazon tracking number(s): ${pk.trk.join(', ')}`);
    }
    /* Not when the news came from Shopify itself: it already has it, and would show every step twice. */
    if (J.SHOPIFY_EVENT[x] && pk.fulfilQueued && !info.fromShopify) {
      queue.enqueue(db, o, 'event', { part: o.pkgs.indexOf(pk), status: J.SHOPIFY_EVENT[x], at: pk.ts[pk.pos - 1], message: name },
        `Delivery status on #${o.no} (${J.carName(pk)}): ${J.SHOPIFY_EVENT[x].replace(/_/g, ' ').toLowerCase()}${x === 6 ? ' with the date' : ''}`);
    }
    if (x === 6) pk.eta = '';
    if (x === 5) pk.eta = 'Today';
  }
  /* The last scan, in the carrier's own words, and the last 20 — what "Where it is now" and the flags read. */
  if (evs.length) {
    pk.scans = evs.slice(0, 20).map(e => ({ at: e.at, place: e.place || '', text: e.text || e.status || '' }));
    pk.last = pk.scans[0];
  } else if (moved) pk.last = { at: pk.ts[pk.pos - 1], place: pk.ev[pk.pos - 1] || '', text: J.steps(pk).flat()[pk.pos - 1] };
  pk.checkedAt = Date.now();
  return moved;
}

/** One simulated update: the next step, as a real carrier scan would bring it. */
function simulate(db, o, pk) {
  const x = J.off(pk); if (x < 1 || x > 5) return 0;
  if (J.isMcf(pk) && x === 2 && !pk.trk.length) pk.trk = pk.items.length > 1 ? ['TBA' + Date.now().toString().slice(-12), 'TBA' + (Date.now() + 7).toString().slice(-12)] : ['TBA' + Date.now().toString().slice(-12)];
  const P = SIM_PLACE[J.isMcf(pk) ? 'mcf' : pk.car] || ['On the way', 'On the way'];
  const place = x === 1 ? 'Amazon' : x === 2 ? P[0] : x === 3 ? P[1] : o.addr.city ? `${o.addr.city}, ${o.addr.state}` : '';
  if (x === 4) pk.late = false;
  return moveTo(db, o, pk, x + 1, { place });
}

/** Shopify's tracking of this part's parcel, if Shopify has a fulfilment with one of its numbers. Read-only. */
async function fromShopify(o, pk, cache) {
  if (o.source !== 'shopify' || !o.gid || !config.shopify(o.store) || !pk.trk.length) return null;
  if (!cache[o.no]) cache[o.no] = await shopify.fulfilments(o.store, o.gid);
  const f = cache[o.no].find(x => (x.trackingInfo || []).some(t => pk.trk.includes(t.number)));
  if (!f) return null;
  const t = shopTrack.read(f);
  return t.canceled ? null : t;
}

async function run(db, opts) {
  const sim = !!(opts && opts.simulate), only = opts && opts.no ? opts : null, out = { moved: 0, checked: 0, errors: [] };
  const nos = opts && Array.isArray(opts.nos) ? new Set(opts.nos) : null;     // "Check tracking now" on ticked orders
  const cache = {};                                                          // one Shopify read per order per run
  /* Where Shopify is read many orders at a time (the test site, through the Pricing API), read them all first. */
  if (shopify.fulfilmentsMany) {
    for (const store of ['Ridhi', 'CPC']) {
      const want = db.orders.filter(o => o.store === store && o.source === 'shopify' && o.gid && config.shopify(store) && (!nos || nos.has(o.no)) && (!only || o.no === only.no)
        && o.pkgs.some(pk => !J.isMcf(pk) && pk.trk.length && J.off(pk) >= 1 && J.off(pk) <= 5 && !config.carrier(pk.car)));
      if (!want.length) continue;
      try { const got = await shopify.fulfilmentsMany(store, want.map(o => o.gid)); want.forEach(o => { cache[o.no] = got[o.gid] || []; }); }
      catch (e) { out.errors.push(`${store} Shopify: ${e.message}`); want.forEach(o => { cache[o.no] = []; }); }
    }
  }
  for (const o of db.orders) for (const pk of o.pkgs) {
    if (only && (o.no !== only.no || o.pkgs.indexOf(pk) !== Number(only.part))) continue;
    if (nos && !nos.has(o.no)) continue;
    const x = J.off(pk); if (x < 1 || x > 5) continue;
    try {
      if (J.isMcf(pk) && pk.mcfReal && config.amazon(o.store)) {
        out.checked++;
        const s = await amazon.status(o.store, pk.mcfId), st = amazon.normalise(s);
        const nums = [...new Set(s.packages.map(p => p.trk).filter(Boolean))];
        if (nums.length) pk.trk = nums;
        const target = { sent: 1, accepted: 2, picked_up: 3, in_transit: 4, out_for_delivery: 5, delivered: 6 }[st];
        if (st === 'problem') { note(o, 'AMAZON', `Amazon reports a problem with ${pk.mcfId}: ${s.status}`); continue; }
        const events = s.scans.flatMap(sc => sc.events.map(e => ({ at: e.at, place: e.place, status: /DELIVERED/.test(e.code) ? 'delivered' : /OUT_FOR/.test(e.code) ? 'out_for_delivery' : 'in_transit' })));
        out.moved += moveTo(db, o, pk, target || x, { events });
      } else if (!J.isMcf(pk)) {
        const shipped = pk.ts[J.prodLen(pk)] || pk.req || 0;
        /* An answer is about this parcel only when it is not empty and not someone else's old scans (see moveTo). */
        const ours = t => t && t.status !== 'unknown' && (!(t.events || []).length || t.events.some(e => e.at >= shipped - J.DAY));
        let t = null, viaShopify = false;
        if (config.carrier(pk.car)) { out.checked++; t = await carriers.track(pk.car, pk.trk[0]); }
        if (!ours(t)) { const s = await fromShopify(o, pk, cache); if (s) { if (!config.carrier(pk.car)) out.checked++; t = s; viaShopify = true; if (s.id) pk.fulfilId = pk.fulfilId || s.id; } }
        if (!ours(t)) { pk.checkedAt = Date.now(); if (sim) out.moved += simulate(db, o, pk); continue; }   // "Simulate" still walks a test parcel
        pk.late = t.status === 'delayed';
        if (t.eta) pk.eta = String(t.eta).slice(0, 10);
        pk.trackedBy = viaShopify ? 'Shopify' : pk.car;
        out.moved += moveTo(db, o, pk, J.STATUS_OFF[t.status] || x, { events: t.events, fromShopify: viaShopify });
      } else if (sim) {
        out.moved += simulate(db, o, pk);
      }
    } catch (e) { out.errors.push(`#${o.no}: ${e.message}`); }
  }
  db.lastTrack = { at: Date.now(), ...out, simulate: sim };
  return out;
}

module.exports = { run, moveTo };

});

HUBMOD("config", function (module, exports, require, __dirname, process, Buffer) {
/* THE HUB ON THE TEST SITE — in place of lib/config.js (tools/build-web.js swaps it in).
 * No keys at all: a published page can hold none. Shopify is reached through the ERP page around the hub, which asks the
 * Pricing API with the signed-in person's access (web/shopify.js): so a store counts as connected while the hub is open
 * inside the ERP, and sending to Shopify is on only when the ERP says the test ERP lets writes through. Amazon, the
 * carriers and FedEx labels are off: MCF and carrier tracking are simulated; Shopify's own tracking is real. */
const CFG = { shopify: { stores: {}, allowWrites: false }, amazon: { accounts: {}, allowRealMcf: false }, carriers: {}, tracking: {} };
const viaErp = () => !!HUB_WEB.erp;
module.exports = {
  WEB: true, load: () => CFG, cfg: () => CFG,
  shopify: store => (viaErp() ? { domain: `${store} · through the ERP's Pricing API`, bridge: true } : null),
  amazon: () => null, carrier: () => null, fedexShip: () => null,
  shopifyWrites: () => viaErp() && !!HUB_WEB.writes, realMcf: () => false, trackMinutes: () => 30, port: () => 0, shopDomain: s => String(s || ''),
};

});

HUBMOD("store", function (module, exports, require, __dirname, process, Buffer) {
/* THE HUB ON THE TEST SITE — in place of lib/store.js (tools/build-web.js swaps it in).
 * The same calls, but the data lives in this browser (IndexedDB "shopify-hub"), not in data/db.json: each person's
 * test hub is their own, on their own computer, and nothing is saved anywhere else. boot.js reads the saved copy
 * before the hub starts (HUB_WEB.preload) and writes each save back (HUB_WEB.put). */
let db = null;
let ver = Date.now();

function load() {
  if (db) return db;
  db = HUB_WEB.preload || null;
  return db;
}
function save() { HUB_WEB.put(db); ver++; }
function replace(next) { db = next; save(); return db; }
const get = () => db;

/* One change at a time, as in lib/store.js. */
let chain = Promise.resolve();
function serial(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

module.exports = { load, save, replace, get, serial, FILE: 'this browser', version: () => ver };

});

HUBMOD("util", function (module, exports, require, __dirname, process, Buffer) {
/* THE HUB ON THE TEST SITE — in place of lib/util.js (tools/build-web.js swaps it in).
 * No outside calls from the published page: every API that needs a key (Shopify's own, Amazon, the carriers, FedEx
 * labels) answers with this instead. With no keys in web/config.js nothing should get this far. */
function request(method, url) {
  let host = url; try { host = new URL(url).hostname; } catch (e) { /* keep it as it is */ }
  return Promise.reject(new Error(`Not on the test site — ${host} needs keys that only the hub on your computer has.`));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => String(s == null ? '' : s).slice(0, n || 300);

module.exports = { request, sleep, clip };

});

HUBMOD("shopify", function (module, exports, require, __dirname, process, Buffer) {
/* THE HUB ON THE TEST SITE — in place of lib/shopify.js (tools/build-web.js swaps it in).
 *
 * The test site holds no Shopify token. What the hub needs from Shopify goes through the ERP page around it, which
 * asks the Pricing API (Pricing-API/ShopifyHub.gs) with the signed-in person's access:
 *   freshOrder                      is the order still live (read)                 → ?shopify=orders&ids= (exists)
 *   fulfilments / fulfilmentsMany   Shopify's own tracking of each parcel (read)   → ?shopify=tracking
 *   previewFulfil                   what "mark shipped" would send (read)          → ?shopify=fulfilCheck
 *   fulfil                          mark only these lines shipped, every number   → POST fulfilLines (only when the
 *                                   test ERP lets writes through; queue.js holds it otherwise)
 * Everything else the local hub can do in Shopify (notes, tags, the MCF split, delivery events, cancelling a
 * fulfilment, test orders) is not offered here: canSend() keeps those changes "held" in the queue. */
const ask = (kind, args) => HUB_WEB.ask(kind, args);
const num = gid => String(gid || '').replace(/^.*\//, '');
const NEED_SCOPES = ['read_orders', 'read_merchant_managed_fulfillment_orders', 'write_merchant_managed_fulfillment_orders'];
const NEED_FOR_TEST_ORDERS = [];
const SENDS = ['fulfil'];
const notHere = what => () => Promise.reject(new Error(`${what} is not done from the test site — only marking lines shipped is.`));

/** Shopify's tracking of many orders in one go (50 a call): { <gid>: [fulfilment, …] }. */
async function fulfilmentsMany(store, gids) {
  const out = {};
  for (let i = 0; i < gids.length; i += 50) {
    const part = gids.slice(i, i + 50), d = await ask('track', { store, ids: part.map(num) });
    part.forEach(g => { out[g] = (d.orders || {})[num(g)] || []; });
  }
  return out;
}
async function fulfilments(store, gid) { return (await fulfilmentsMany(store, [gid]))[gid]; }

/** The order as Shopify has it now — checked before a file is made or a parcel booked (actions.js freshCheck). Read
 * through the Pricing API's existing order read, by id. */
async function freshOrder(store, gid) {
  const d = await ask('order', { store, id: num(gid) }), o = (d.orders || []).find(x => String(x.id) === num(gid));
  if (!o) throw new Error('Shopify has no such order any more');
  return { id: gid, name: o.no, cancelledAt: o.cancelledAt || null, note: o.note || '', tags: o.tags || '' };
}
async function previewFulfil(store, gid, lineGids, company, numbers) {
  const d = await ask('fulfilCheck', { store, orderId: num(gid), lines: lineGids.map(num), company, numbers });
  if (d.already) return { ok: false, note: d.note };
  return { ok: true, note: d.note };
}
async function fulfil(store, gid, lineGids, company, numbers, notify) {
  const d = await ask('fulfil', { store, orderId: num(gid), lines: lineGids.map(num), company, numbers, notify: notify !== false });
  return d.already ? { already: true } : { id: d.id };
}
async function check() {
  throw new Error('Checked through the ERP: the Pricing API holds this store\'s token. Use "Check with Shopify (read only)" to try it.');
}

module.exports = {
  check, NEED_SCOPES, NEED_FOR_TEST_ORDERS, freshOrder, fulfilments, fulfilmentsMany, previewFulfil, fulfil,
  canSend: kind => SENDS.includes(kind),
  recentOrders: notHere('Reading orders with a token'),
  appendNote: notHere('Adding a note'), addTags: notHere('Tagging'), removeTags: notHere('Tagging'),
  splitAndProgress: notHere('The MCF split'), cancelFulfilment: notHere('Cancelling a fulfilment'),
  deliveryEvent: notHere('A delivery event'), createTestOrder: notHere('A test order'),
};

});

HUBMOD("server", function (module, exports, require, __dirname, process, Buffer) {
/* =====================================================================================
 * SHOPIFY HUB — local backend. No packages: plain Node.
 *
 *   node shopify-hub/server.js          → http://localhost:8790/
 *
 * It serves the Shopify section (public/) and the API the screens call (/api/...). Everything it
 * knows is kept in data/db.json. API keys go in config.local.json — see README.md. Anything without
 * keys runs in TEST MODE: temp orders, simulated MCF, simulated tracking, nothing sent anywhere.
 * Listens on this computer only (127.0.0.1); nobody else on the network can reach it.
 * ===================================================================================== */
const http = require('http'), fs = require('fs'), path = require('path');
const config = require('./lib/config');
const store = require('./lib/store');
const seed = require('./lib/seed');
const actions = require('./lib/actions');
const queue = require('./lib/queue');
const track = require('./lib/track');
const shopify = require('./lib/shopify');
const amazon = require('./lib/amazon');
const carriers = require('./lib/carriers');
const csb = require('./lib/csb');
const J = require('./lib/journey');
const fedex = require('./lib/fedex-ship');

config.load();
if (!store.load()) store.replace({ orders: seed.build(), stock: seed.STOCK, queue: [], seq: 0, health: {} });
const db = () => store.get();
/* Orders pulled before 24 Oct kept Shopify's "# RBP7518" as " RBP7518" (with a space). Tidy them once, everywhere the
 * number is used — the order, its parts, the Shopify queue and the dispatch files — so nothing points at the old form. */
(function tidyOrderNumbers() {
  const d = db(), map = {};
  d.orders.forEach(o => { const n = actions.cleanNo(o.no); if (n !== o.no) { map[o.no] = n; o.pkgs.forEach(pk => { if (pk.id) pk.id = pk.id.replace(o.no, n); }); o.no = n; } });
  if (!Object.keys(map).length) return;
  d.queue.forEach(q => { if (map[q.orderNo]) q.orderNo = map[q.orderNo]; });
  ((d.csb || {}).batches || []).forEach(b => b.ships.forEach(s => { if (map[s.no]) { s.parts = (s.parts || []).map(id => id.replace(s.no, map[s.no])); s.no = map[s.no]; } }));
  store.save();
  console.log(`Tidied ${Object.keys(map).length} order number(s) (removed the space after "#")`);
})();
/* A part booked in a dispatch file and still waiting for its tracking number is at "Packed" (one step past ready).
 * One version of 24 Oct moved India-stock parts two steps; put any such part back to "Packed". */
(function tidyBookedParts() {
  let n = 0;
  db().orders.forEach(o => o.pkgs.forEach(pk => { if (pk.booked && !pk.route) while (J.off(pk) > 1) { pk.pos--; delete pk.ts[pk.pos]; delete pk.ev[pk.pos]; n++; } }));
  if (n) { store.save(); console.log(`Put ${n} booked part step(s) back to "Packed"`); }
})();
/* Scans from before a parcel was handed over are someone else's (FedEx's sandbox answered with scans from 2023 before
 * the tracking check learned to leave those out) — drop any that were kept, so no parcel shows a false "no scan" flag. */
(function tidyOldScans() {
  let n = 0;
  db().orders.forEach(o => o.pkgs.forEach(pk => {
    const shipped = (pk.ts || [])[J.prodLen(pk)] || pk.req || 0;
    /* Steps those scans moved it to are not its own either: back to the last step it really reached. */
    for (let i = J.prodLen(pk) + 1; i < pk.pos; i++) if (pk.ts[i] && pk.ts[i] < shipped - J.DAY) { while (pk.pos > i) { pk.pos--; delete pk.ts[pk.pos]; delete pk.ev[pk.pos]; } pk.late = false; n++; break; }
    if (pk.scans && pk.scans.some(s => s.at < shipped - J.DAY)) { pk.scans = pk.scans.filter(s => s.at >= shipped - J.DAY); n++; }
    if (pk.last && pk.last.at < shipped - J.DAY) { pk.last = (pk.scans || [])[0] || null; n++; }
  }));
  if (n) { store.save(); console.log(`Dropped old carrier scans on ${n} part(s)`); }
})();

/* ---------------- what the screens get ---------------- */
function connections() {
  const c = {};
  ['Ridhi', 'CPC'].forEach(s => {
    c['Shopify ' + s] = config.shopify(s) ? 'live' : 'test';
    c['Amazon ' + s] = config.amazon(s) ? 'live' : 'test';
  });
  ['DHL Express', 'FedEx', 'UPS'].forEach(n => { c[n] = config.carrier(n) ? 'live' : 'test'; });
  c['FedEx shipping'] = config.fedexShip() ? 'live' : 'test';
  return c;
}
function state() {
  const d = db();
  return { ok: true, now: Date.now(), v: store.version(), orders: d.orders, stock: d.stock, prefs: d.prefs || {}, queue: d.queue.slice(-200).reverse(), lastTrack: d.lastTrack || null,
    connections: connections(), health: d.health || {}, customs: csb.state(d).sku, hsDefault: csb.CO.hsExport, nextInv: csb.state(d).nextInv,
    settings: { web: !!config.WEB, writes: config.shopifyWrites(), realMcf: config.realMcf(), trackMinutes: config.trackMinutes(),
      fedexShip: config.fedexShip() ? { on: true, sandbox: config.fedexShip().sandbox } : { on: false } } };
}

function csbState() {
  const st = csb.state(db());
  return { ok: true, candidates: csb.candidates(db()), nextInv: st.nextInv, sku: st.sku, today: csb.todayIST(),
    taxOptions: csb.TAX_OPTIONS, currencies: csb.CURRENCIES, carriers: csb.CARRIERS, packaging: csb.PACKAGING, hsDefault: csb.CO.hsExport,
    batches: st.batches.slice(0, 40).map(b => ({ id: b.id, at: b.at, files: b.files || {}, ships: b.ships.map(s => ({ no: s.no, car: s.car || 'DHL Express', inv: s.inv, awb: s.awb || '',
      items: s.lines.map(l => { const o = db().orders.find(x => x.no === s.no); return o && o.items[l.i] ? o.items[l.i].t + ' × ' + o.items[l.i].q : ''; }).filter(Boolean) })) })) };
}

/* ---------------- background work ---------------- */
let queueTimer = null;
function runQueueSoon() {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(() => store.serial(async () => { await queue.run(db()); store.save(); }).catch(e => console.error('queue:', e.message)), 300);
}
/* Shopify counts: a connected store's own tracking follows DHL / FedEx / UPS parcels with no carrier key. */
const anyLiveTracking = () => ['Ridhi', 'CPC'].some(s => config.amazon(s) || config.shopify(s)) || ['DHL Express', 'FedEx', 'UPS'].some(n => config.carrier(n));
setInterval(() => {
  if (!anyLiveTracking()) return;
  store.serial(async () => { await track.run(db(), { simulate: false }); store.save(); }).then(runQueueSoon).catch(e => console.error('tracking:', e.message));
}, config.trackMinutes() * 60000);

/* ---------------- the API ---------------- */
const ACTIONS = {
  decide: actions.decide, plan: actions.plan, prefs: actions.prefs, stage: actions.stage, block: actions.block, unblock: actions.unblock, ship: actions.ship,
  returnStart: actions.returnStart, returnStep: actions.returnStep, comment: actions.comment,
  fedexShip: actions.fedexShip, fedexCancel: actions.fedexCancel, bulkNote: actions.bulkNote, chase: actions.chase,
  dispatchAwb: actions.dispatchAwb, dispatchForget: actions.dispatchForget, markStep: actions.markStep,
};
async function api(route, body) {
  if (route === 'GET /api/state') return state();
  if (route === 'GET /api/ver') return { ok: true, v: store.version() };
  if (route === 'POST /api/action') {
    const fn = ACTIONS[body.type]; if (!fn) throw new Error('Unknown action ' + body.type);
    const msg = await store.serial(async () => { const m = await fn(db(), body); store.save(); return m; });
    runQueueSoon();
    return Object.assign(state(), { msg });
  }
  if (route === 'POST /api/fedex/rates') return { ok: true, options: await actions.fedexRates(db(), body) };
  if (route === 'POST /api/mcf-preview') return Object.assign({ ok: true }, await actions.mcfPreview(db(), body));
  if (route === 'POST /api/simulate') {
    const r = await store.serial(async () => { const x = await track.run(db(), { simulate: true, no: body.no, part: body.part }); store.save(); return x; });
    runQueueSoon();
    return Object.assign(state(), { msg: r.moved ? `${r.moved} step(s) moved on, as real updates would` : 'Nothing on the road to move' });
  }
  if (route === 'POST /api/track') {
    const r = await store.serial(async () => { const x = await track.run(db(), { simulate: false, nos: body.nos }); store.save(); return x; });
    runQueueSoon();
    return Object.assign(state(), { msg: `Checked ${r.checked} live parcel(s), ${r.moved} step(s) moved${r.errors.length ? ' · problems: ' + r.errors.join(' · ') : ''}` });
  }
  if (route === 'POST /api/queue/run') {
    const r = await store.serial(async () => { const x = await queue.run(db(), { sendHeld: true }); store.save(); return x; });
    return Object.assign(state(), { msg: `Sent ${r.sent} · still held ${r.held} · failed ${r.failed}` });
  }
  if (route === 'POST /api/queue/discard') {
    const n = await store.serial(async () => { const x = queue.discard(db()); store.save(); return x; });
    return Object.assign(state(), { msg: `${n} held change(s) discarded — they will never be sent` });
  }
  if (route === 'POST /api/reset') {
    await store.serial(async () => {
      const d = db(), real = d.orders.filter(o => o.source === 'shopify');
      d.orders = seed.build().concat(real); d.stock = seed.STOCK; d.queue = d.queue.filter(q => q.status !== 'test');
      store.save();
    });
    return Object.assign(state(), { msg: 'Temp orders put back as they started' });
  }
  /* Present mode: a fresh demo order (D1001) — any earlier one, its files and its queue lines go first. */
  if (route === 'POST /api/demo/start') {
    await store.serial(async () => {
      const d = db(), st = csb.state(d);
      d.orders = d.orders.filter(o => !o.demo).concat([seed.demoOrder()]);
      d.queue = d.queue.filter(q => q.orderNo !== 'D1001');
      st.batches = st.batches.filter(b => !b.ships.every(s => s.no === 'D1001'));
      store.save();
    });
    return Object.assign(state(), { msg: 'A new Shopify order: #D1001' });
  }
  if (route === 'POST /api/shopify/import') {
    const msg = await store.serial(async () => { const m = await actions.importOrders(db()); store.save(); return m; });
    return Object.assign(state(), { msg });
  }
  /* Orders the ERP page read through its Pricing API (shopify-hub-local.js → this page → here). */
  if (route === 'POST /api/shopify/import-pr') {
    const msg = await store.serial(async () => { const m = await actions.importFromPricing(db(), body.got); store.save(); return m; });
    return Object.assign(state(), { msg });
  }
  if (route === 'POST /api/shopify/test-order') {
    const msg = await store.serial(async () => { const m = await actions.testOrder(db(), body); store.save(); return m; });
    return Object.assign(state(), { msg });
  }
  /* ---- DHL CSB-V: pick orders and counts, the hub builds DHL's rows, the page writes them into DHL's .xls ---- */
  if (route === 'GET /api/csb') return csbState();
  if (route === 'POST /api/csb/check') return Object.assign({ ok: true }, csb.build(db(), body.draft || {}));
  if (route === 'POST /api/csb/make') {
    const r = await store.serial(async () => { const x = await actions.dispatchMake(db(), body.draft || {}); store.save(); return x; });
    const n = c => r.batch.ships.filter(s => s.car === c).length;
    return Object.assign(state(), csbState(), r, { msg: `${r.batch.id} made · ${n('DHL Express')} DHL · ${n('FedEx')} FedEx — upload, then type the tracking numbers` });
  }
  if (route === 'POST /api/csb/again') return Object.assign(csbState(), csb.again(db(), body.id));
  if (route === 'POST /api/csb/awb' || route === 'POST /api/csb/forget') {
    const fn = route.endsWith('awb') ? actions.dispatchAwb : actions.dispatchForget;
    const msg = await store.serial(async () => { const m = fn(db(), body); store.save(); return m; });
    runQueueSoon();
    return Object.assign(state(), csbState(), { msg });
  }
  /* DRY RUN: for every change waiting to mark lines shipped in Shopify, read Shopify (only read) and say exactly what
   * would be sent — or why it would be refused. Nothing is written. */
  if (route === 'POST /api/queue/preview') {
    const d = db(), items = d.queue.filter(q => q.kind === 'fulfil' && ['waiting', 'held'].includes(q.status));
    let ok = 0, bad = 0;
    for (const q of items) {
      const o = d.orders.find(x => x.no === q.orderNo);
      try { const p = await shopify.previewFulfil(o.store, o.gid, q.data.lines, q.data.company, q.data.numbers); q.preview = { ok: p.ok, note: p.note, at: Date.now() }; p.ok ? ok++ : bad++; }
      catch (e) { q.preview = { ok: false, note: e.message, at: Date.now() }; bad++; }
    }
    await store.serial(async () => store.save());
    return Object.assign(state(), { msg: items.length ? `Checked ${items.length} change(s) against Shopify (read only): ${ok} would go through · ${bad} would not` : 'Nothing waiting to be marked shipped in Shopify' });
  }
  if (route === 'POST /api/csb/next') {
    await store.serial(async () => { csb.state(db()).nextInv = String(body.nextInv || '').trim(); store.save(); });
    return csbState();
  }
  if (route === 'POST /api/csb/save') {
    /* A copy of each file the page made, in shopify-hub/csb-files/, so it can be found without the browser's Downloads. */
    const id = String(body.id || '').replace(/[^A-Za-z0-9-]/g, ''), kind = body.kind === 'fedex' ? 'fedex' : 'dhl';
    const b = csb.state(db()).batches.find(x => x.id === id);
    if (!b) throw new Error('No such file batch ' + id);
    const dir = path.join(__dirname, 'csb-files'), name = `${id}-${kind === 'fedex' ? 'FedEx' : 'DHL-CSB'}.xls`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(body.b64 || ''), 'base64'));
    await store.serial(async () => { b.files = Object.assign({}, b.files, { [kind]: 'csb-files/' + name }); store.save(); });
    return { ok: true, file: path.join(dir, name) };
  }
  if (route === 'POST /api/check') {
    const h = {};
    for (const s of ['Ridhi', 'CPC']) {
      if (config.shopify(s)) {
        try {
          const c = await shopify.check(s), miss = shopify.NEED_SCOPES.filter(x => !c.scopes.includes(x)), missT = shopify.NEED_FOR_TEST_ORDERS.filter(x => !c.scopes.includes(x));
          h['Shopify ' + s] = { ok: !miss.length, note: `${c.name} (${c.domain})` + (miss.length ? ` · missing permissions: ${miss.join(', ')}` : ' · all permissions present') + (missT.length ? ` · for test orders also: ${missT.join(', ')}` : '') };
        } catch (e) { h['Shopify ' + s] = { ok: false, note: e.message }; }
      }
      if (config.amazon(s)) {
        try { const c = await amazon.check(s); h['Amazon ' + s] = { ok: true, note: `Login works · MCF allowed · ${c.recent} MCF order(s) in the last 7 days` }; }
        catch (e) { h['Amazon ' + s] = { ok: false, note: e.code === 403 ? 'Login works but MCF is not allowed for this app (role missing) — ' + e.message : e.message }; }
      }
    }
    for (const n of ['DHL Express', 'FedEx', 'UPS']) {
      if (!config.carrier(n)) continue;
      try { const c = await carriers.check(n); h[n] = { ok: true, note: c.note || 'Login works' }; } catch (e) { h[n] = { ok: false, note: e.message }; }
    }
    if (config.fedexShip()) { try { h['FedEx shipping'] = { ok: true, note: await fedex.check() }; } catch (e) { h['FedEx shipping'] = { ok: false, note: e.message }; } }
    Object.keys(h).forEach(k => { h[k].at = Date.now(); });
    await store.serial(async () => { db().health = h; store.save(); });
    return Object.assign(state(), { msg: Object.keys(h).length ? 'Connections checked' : 'Nothing to check — no keys filled in config.local.json yet' });
  }
  return null;
}

/* ---------------- the web server ---------------- */
const PUBLIC = path.join(__dirname, 'public');
const EXTRA = { '/journey.js': path.join(__dirname, 'lib', 'journey.js'),
  '/csb/template.xls': path.join(__dirname, 'templates', 'CSB-V-template.xls'), '/fedex/template.xls': path.join(__dirname, 'templates', 'FedEx-template.xls') };
const TYPES = { '.pdf': 'application/pdf', '.xls': 'application/vnd.ms-excel', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local'), p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/')) {
    let body = {};
    if (req.method === 'POST') {
      /* Only this page posts here, always as JSON. Another web site can send a plain-text POST to localhost without asking,
       * but not a JSON one — so a POST that is not JSON is refused before anything is read. */
      if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'Send JSON.' });
      const raw = await new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 2e7) req.destroy(); }); req.on('end', () => r(s)); });
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return send(res, 400, { ok: false, error: 'The request was not JSON.' }); }
    }
    try {
      const out = await api(req.method + ' ' + p, body);
      if (!out) return send(res, 404, { ok: false, error: 'No such API route: ' + p });
      return send(res, 200, out);
    } catch (e) {
      console.error(p, '-', e.message);
      return send(res, 200, { ok: false, error: e.message });
    }
  }
  /* FedEx labels and invoices the hub saved (labels/<tracking>-label.pdf), opened from the order to print. */
  const lab = p.match(/^\/labels\/([A-Za-z0-9]+-(?:label|invoice)\.pdf)$/);
  let file = lab ? path.join(fedex.LABELS, lab[1]) : EXTRA[p] || path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!lab && !EXTRA[p] && !file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log(`The hub is already running on http://localhost:${config.port()}/ — open that.`); process.exit(0); }
  throw e;
});
server.listen(config.port(), '127.0.0.1', () => {
  const c = connections(), live = Object.keys(c).filter(k => c[k] === 'live');
  console.log(`Shopify hub: http://localhost:${config.port()}/`);
  console.log(live.length ? 'Live: ' + live.join(', ') : 'TEST MODE — no keys in config.local.json yet. Temp orders, simulated MCF and tracking.');
  console.log(`Sending to Shopify: ${config.shopifyWrites() ? 'ON' : 'off'} · Real MCF orders: ${config.realMcf() ? 'ON' : 'off'}`);
});

/* The test-site copy (tools/build-web.js) runs this same file inside the page and calls api() directly. */
module.exports = { api };

});

/* THE HUB ON THE TEST SITE — start it, and answer the page's /api/... calls with the server's own api(). */
(function () {
  const open = () => new Promise((ok, no) => {
    const r = indexedDB.open('shopify-hub', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const step = (mode, fn) => open().then(d => new Promise((ok, no) => { const q = fn(d.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }));
  /* Saves go one after another, newest last; a failed save is said once, and the hub keeps working from memory. */
  let saving = Promise.resolve(), warned = false;
  /* Talking to Shopify through the ERP page around the hub: a question goes up, its answer comes back with the same id.
   * Only the page this one sits in is listened to, and only from the ERP's addresses. */
  const ERP_ORIGIN = /^(https:\/\/ravikumar7357\.github\.io|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;
  const waiting = {};
  let askN = 0, erpOrigin = '';
  window.addEventListener('message', e => {
    if (window.parent === window || e.source !== window.parent || !ERP_ORIGIN.test(e.origin) || !e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'shub-erp') { HUB_WEB.erp = true; HUB_WEB.writes = e.data.writes === true; erpOrigin = e.origin; }
    if (e.data.type === 'shub-answer' && waiting[e.data.id]) {
      const w = waiting[e.data.id]; delete waiting[e.data.id]; clearTimeout(w.t);
      e.data.ok ? w.ok(e.data.data || {}) : w.no(new Error(e.data.error || 'The ERP said no'));
    }
  });
  window.HUB_WEB = {
    preload: null, erp: false, writes: false,
    ask(kind, args) {
      if (!HUB_WEB.erp) return Promise.reject(new Error('Open the hub from the ERP (Shopify → Shopify hub (test)) — Shopify is reached through it.'));
      const id = ++askN;
      return new Promise((ok, no) => {
        waiting[id] = { ok, no, t: setTimeout(() => { delete waiting[id]; no(new Error('The ERP did not answer in 3 minutes')); }, 180000) };
        window.parent.postMessage({ type: 'shub-ask', id, kind, args }, erpOrigin);
      });
    },
    put(db) {
      const copy = JSON.parse(JSON.stringify(db));
      saving = saving.then(() => step('readwrite', s => s.put(copy, 'db'))).catch(e => { if (!warned) { warned = true; console.warn('Shopify hub: could not save in this browser —', e && e.message); } });
    },
  };
  const ready = (async () => {
    try { window.HUB_WEB.preload = (await step('readonly', s => s.get('db'))) || null; } catch (e) { console.warn('Shopify hub: nothing saved could be read —', e && e.message); }
    return HUBREQ('server');
  })();

  const realFetch = window.fetch.bind(window);
  const answer = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/')) {
      const server = await ready;
      const method = ((init && init.method) || 'GET').toUpperCase();
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { return answer({ ok: false, error: 'The request was not JSON.' }); }
      try { return answer((await server.api(method + ' ' + url.split('?')[0], body)) || { ok: false, error: 'No such API route: ' + url }); }
      catch (e) { console.error(url, '-', e.message); return answer({ ok: false, error: e.message }); }
    }
    if (url === '/csb/template.xls') return realFetch('templates/CSB-V-template.xls', init);
    if (url === '/fedex/template.xls') return realFetch('templates/FedEx-template.xls', init);
    return realFetch(input, init);
  };
})();
