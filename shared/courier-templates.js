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

